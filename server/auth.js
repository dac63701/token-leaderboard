import { Router } from "express";
import crypto from "crypto";

const GITHUB_CLIENT_ID =
  process.env.GITHUB_CLIENT_ID || "dev_client_id_placeholder";
const GITHUB_CLIENT_SECRET =
  process.env.GITHUB_CLIENT_SECRET || "dev_client_secret_placeholder";

const deviceStore = new Map();

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

export default function createAuthRouter(db) {
  const router = Router();

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      github_id INTEGER PRIMARY KEY,
      nickname TEXT,
      avatar_url TEXT,
      access_token TEXT,
      time_created INTEGER,
      time_updated INTEGER
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_token TEXT PRIMARY KEY,
      github_id INTEGER NOT NULL,
      time_created INTEGER
    )
  `);

  router.get("/auth/github/device", async (_req, res) => {
    try {
      if (!GITHUB_CLIENT_ID || GITHUB_CLIENT_ID === "dev_client_id_placeholder") {
        return res.status(400).json({
          error: "GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET environment variables.",
        });
      }

      const resp = await fetch("https://github.com/login/device/code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          scope: "read:user",
        }),
      });
      const data = await resp.json();

      if (data.error) {
        return res
          .status(400)
          .json({ error: data.error_description || data.error });
      }

      deviceStore.set(data.device_code, {
        interval: data.interval || 5,
        created_at: Date.now(),
        expires_in: data.expires_in || 900,
      });

      res.json({
        device_code: data.device_code,
        user_code: data.user_code,
        verification_uri: data.verification_uri,
        interval: data.interval || 5,
      });
    } catch (err) {
      console.error("Device code error:", err);
      res.status(500).json({ error: "Failed to request device code" });
    }
  });

  router.post("/auth/github/poll", async (req, res) => {
    try {
      const { device_code } = req.body;
      if (!device_code) {
        return res.status(400).json({ error: "device_code is required" });
      }

      const stored = deviceStore.get(device_code);
      if (!stored) {
        return res.status(400).json({ error: "Invalid device_code" });
      }

      if (Date.now() - stored.created_at > stored.expires_in * 1000) {
        deviceStore.delete(device_code);
        return res.json({ status: "expired" });
      }

      const resp = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      const data = await resp.json();

      if (data.error === "authorization_pending") {
        return res.json({ status: "pending" });
      }
      if (data.error === "slow_down") {
        return res.json({ status: "pending", slow_down: true });
      }
      if (data.error === "expired_token" || data.error === "access_denied") {
        deviceStore.delete(device_code);
        return res.json({ status: "expired" });
      }

      const accessToken = data.access_token;
      if (!accessToken) {
        return res.json({ status: "pending" });
      }

      deviceStore.delete(device_code);

      const userResp = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const userData = await userResp.json();
      const githubId = userData.id;
      const now = Date.now();

      const existingAccount = db
        .prepare("SELECT * FROM accounts WHERE github_id = ?")
        .get(githubId);
      if (existingAccount) {
        db.prepare(
          "UPDATE accounts SET access_token = ?, avatar_url = ?, nickname = ?, time_updated = ? WHERE github_id = ?",
        ).run(accessToken, userData.avatar_url, userData.login, now, githubId);
      } else {
        db.prepare(
          "INSERT INTO accounts (github_id, nickname, avatar_url, access_token, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(githubId, userData.login, userData.avatar_url, accessToken, now, now);
      }

      const sessionToken = generateSessionToken();
      db.prepare(
        "INSERT INTO sessions (session_token, github_id, time_created) VALUES (?, ?, ?)",
      ).run(sessionToken, githubId, now);

      res.json({
        status: "complete",
        token: sessionToken,
        nickname: userData.login,
        avatar: userData.avatar_url,
      });
    } catch (err) {
      console.error("Poll error:", err);
      res.status(500).json({ error: "Failed to poll for token" });
    }
  });

  router.get("/auth/github/callback", async (req, res) => {
    try {
      const { code } = req.query;
      if (!code) {
        return res.status(400).json({ error: "code is required" });
      }

      const resp = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          code,
        }),
      });
      const data = await resp.json();
      const accessToken = data.access_token;
      if (!accessToken) {
        return res
          .status(400)
          .json({ error: "Failed to get access token", details: data });
      }

      const userResp = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const userData = await userResp.json();
      const githubId = userData.id;
      const now = Date.now();

      const existingAccount = db
        .prepare("SELECT * FROM accounts WHERE github_id = ?")
        .get(githubId);
      if (existingAccount) {
        db.prepare(
          "UPDATE accounts SET access_token = ?, avatar_url = ?, nickname = ?, time_updated = ? WHERE github_id = ?",
        ).run(accessToken, userData.avatar_url, userData.login, now, githubId);
      } else {
        db.prepare(
          "INSERT INTO accounts (github_id, nickname, avatar_url, access_token, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(githubId, userData.login, userData.avatar_url, accessToken, now, now);
      }

      const sessionToken = generateSessionToken();
      db.prepare(
        "INSERT INTO sessions (session_token, github_id, time_created) VALUES (?, ?, ?)",
      ).run(sessionToken, githubId, now);

      res.json({
        status: "complete",
        token: sessionToken,
        nickname: userData.login,
        avatar: userData.avatar_url,
      });
    } catch (err) {
      console.error("Callback error:", err);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });

  router.get("/auth/me", (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res
          .status(401)
          .json({ error: "Missing or invalid Authorization header" });
      }
      const token = authHeader.slice(7);
      const session = db
        .prepare(
          "SELECT github_id, time_created FROM sessions WHERE session_token = ?",
        )
        .get(token);
      if (!session) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }
      const account = db
        .prepare(
          "SELECT github_id, nickname, avatar_url FROM accounts WHERE github_id = ?",
        )
        .get(session.github_id);
      if (!account) {
        return res.status(401).json({ error: "Account not found" });
      }
      res.json(account);
    } catch (err) {
      console.error("GET /auth/me error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/auth/logout", (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res
          .status(400)
          .json({ error: "Missing Authorization header" });
      }
      const token = authHeader.slice(7);
      db.prepare("DELETE FROM sessions WHERE session_token = ?").run(token);
      res.json({ status: "ok" });
    } catch (err) {
      console.error("POST /auth/logout error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
