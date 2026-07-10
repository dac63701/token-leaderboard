import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcrypt";
import { Router } from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SALT_ROUNDS = 12;
const ADMIN_PW_LENGTH = 16;
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;
const SESSION_CLEANUP_INTERVAL = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const RATE_LIMIT_LOCKOUT = 15 * 60 * 1000;

let adminHash = null;
const sessions = new Map();
const rateLimit = new Map();

const PW_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

function generatePassword() {
  let pw = "";
  for (let i = 0; i < ADMIN_PW_LENGTH; i++) {
    pw += PW_CHARS[crypto.randomInt(0, PW_CHARS.length)];
  }
  return pw;
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function loadAdminFile() {
  const p = path.join(__dirname, "data", "admin.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function writeAdminFile(data) {
  const p = path.join(__dirname, "data", "admin.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), { mode: 0o600 });
  return data;
}

export function initAdmin() {
  const existing = loadAdminFile();
  if (existing && existing.hash) {
    adminHash = existing.hash;
    console.log("Admin credentials loaded from data/admin.json");
    return null;
  }

  const password = generatePassword();
  adminHash = bcrypt.hashSync(password, SALT_ROUNDS);
  writeAdminFile({ hash: adminHash, created_at: Date.now() });

  const border = "═".repeat(46);
  console.log(`╔${border}╗`);
  console.log(`║  ADMIN CREDENTIALS                               ║`);
  console.log(`║  Password: ${password.padEnd(36)}║`);
  console.log(`║  Save this! It will not be shown again.          ║`);
  console.log(`╚${border}╝`);

  return password;
}

export function checkPassword(password) {
  if (!adminHash) return false;
  try {
    return bcrypt.compareSync(password, adminHash);
  } catch {
    return false;
  }
}

export function createSession() {
  const token = generateToken();
  sessions.set(token, { createdAt: Date.now(), lastUsed: Date.now() });
  return token;
}

export function verifySession(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_EXPIRY_MS) {
    sessions.delete(token);
    return false;
  }
  session.lastUsed = Date.now();
  return true;
}

export function deleteSession(token) {
  sessions.delete(token);
}

function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || "unknown";
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimit.get(ip);

  if (entry) {
    if (entry.lockoutUntil && now < entry.lockoutUntil) {
      return { allowed: false, retryAfter: Math.ceil((entry.lockoutUntil - now) / 1000) };
    }
    if (now - entry.windowStart > RATE_LIMIT_WINDOW) {
      rateLimit.set(ip, { windowStart: now, count: 1, lockoutUntil: null });
      return { allowed: true };
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
      entry.lockoutUntil = now + RATE_LIMIT_LOCKOUT;
      return { allowed: false, retryAfter: RATE_LIMIT_LOCKOUT / 1000 };
    }
    return { allowed: true };
  }

  rateLimit.set(ip, { windowStart: now, count: 1, lockoutUntil: null });
  return { allowed: true };
}

function resetRateLimit(ip) {
  rateLimit.delete(ip);
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_EXPIRY_MS) {
      sessions.delete(token);
    }
  }
  for (const [ip, entry] of rateLimit) {
    if (entry.lockoutUntil && now > entry.lockoutUntil) {
      rateLimit.delete(ip);
    } else if (!entry.lockoutUntil && now - entry.windowStart > RATE_LIMIT_WINDOW) {
      rateLimit.delete(ip);
    }
  }
}, SESSION_CLEANUP_INTERVAL);

export default function createAdminRouter(db) {
  const router = Router();

  router.post("/admin/login", (req, res) => {
    try {
      const ip = getClientIp(req);
      const rl = checkRateLimit(ip);
      if (!rl.allowed) {
        return res.status(429).json({ error: `Too many attempts. Retry in ${rl.retryAfter}s.` });
      }

      const { password } = req.body;
      if (!password || typeof password !== "string") {
        return res.status(400).json({ error: "password is required" });
      }

      if (!checkPassword(password)) {
        return res.status(401).json({ error: "Invalid password" });
      }

      resetRateLimit(ip);
      const token = createSession();
      res.json({ token });
    } catch (err) {
      console.error("POST /admin/login error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/admin/logout", (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(400).json({ error: "Missing Authorization header" });
      }
      deleteSession(authHeader.slice(7));
      res.json({ status: "ok" });
    } catch (err) {
      console.error("POST /admin/logout error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/admin/session", (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.json({ valid: false });
      }
      res.json({ valid: verifySession(authHeader.slice(7)) });
    } catch (err) {
      console.error("GET /admin/session error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/admin/delete", (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing or invalid Authorization header" });
      }
      if (!verifySession(authHeader.slice(7))) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      const { nickname } = req.body;
      if (!nickname || typeof nickname !== "string" || nickname.trim().length === 0) {
        return res.status(400).json({ error: "nickname is required and must be a non-empty string" });
      }

      const cleanNick = nickname.trim();
      const existing = db.prepare("SELECT * FROM uploads WHERE nickname = ?").get(cleanNick);
      if (!existing) {
        return res.status(404).json({ error: "User not found" });
      }

      db.prepare("DELETE FROM uploads WHERE nickname = ?").run(cleanNick);
      res.json({ status: "ok", nickname: cleanNick });
    } catch (err) {
      console.error("POST /admin/delete error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/admin/users", (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing or invalid Authorization header" });
      }
      if (!verifySession(authHeader.slice(7))) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      const rows = db.prepare("SELECT nickname, total_input, total_output, total_cost, session_count, time_uploaded FROM uploads ORDER BY nickname ASC").all();
      res.json(rows);
    } catch (err) {
      console.error("GET /admin/users error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
