import express from "express";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { initPricingEngine, lookupPricing } from "./pricing.js";
import createAuthRouter from "./auth.js";
import createAdminRouter, { initAdmin } from "./admin.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT, 10) || 3456;

// ── Database ────────────────────────────────────────────────────────────────
const dbDir = path.join(__dirname, "data");
fs.mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, "leaderboard.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT NOT NULL UNIQUE,
    total_input INTEGER DEFAULT 0,
    total_output INTEGER DEFAULT 0,
    total_cache_read INTEGER DEFAULT 0,
    total_cache_write INTEGER DEFAULT 0,
    total_reasoning INTEGER DEFAULT 0,
    total_cost REAL DEFAULT 0,
    session_count INTEGER DEFAULT 0,
    models_used TEXT DEFAULT '[]',
    time_uploaded INTEGER NOT NULL,
    time_from INTEGER,
    time_to INTEGER
  )
`);

// Migrate: add new columns (ignore if already exist)
try {
  db.exec("ALTER TABLE uploads ADD COLUMN session_ids TEXT DEFAULT '[]'");
} catch {
  /* column already exists */
}
try {
  db.exec(
    "ALTER TABLE uploads ADD COLUMN uploader_github_id INTEGER REFERENCES accounts(github_id)",
  );
} catch {
  /* column already exists */
}

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

// Prepared statements
const upsertStmt = db.prepare(`
  INSERT INTO uploads (nickname, total_input, total_output, total_cache_read, total_cache_write,
    total_reasoning, total_cost, session_count, models_used, session_ids, uploader_github_id,
    time_uploaded, time_from, time_to)
  VALUES (@nickname, @total_input, @total_output, @total_cache_read, @total_cache_write,
    @total_reasoning, @total_cost, @session_count, @models_used, @session_ids, @uploader_github_id,
    @time_uploaded, @time_from, @time_to)
  ON CONFLICT(nickname) DO UPDATE SET
    total_input       = total_input       + @total_input,
    total_output      = total_output      + @total_output,
    total_cache_read  = total_cache_read  + @total_cache_read,
    total_cache_write = total_cache_write + @total_cache_write,
    total_reasoning   = total_reasoning   + @total_reasoning,
    total_cost        = total_cost        + @total_cost,
    session_count     = session_count     + @session_count,
    models_used       = @models_used,
    session_ids       = @session_ids,
    uploader_github_id = CASE
                          WHEN @uploader_github_id IS NOT NULL THEN @uploader_github_id
                          ELSE uploader_github_id
                        END,
    time_uploaded     = @time_uploaded,
    time_from         = CASE
                          WHEN uploads.time_from IS NULL OR @time_from < uploads.time_from
                          THEN @time_from ELSE uploads.time_from
                        END,
    time_to           = CASE
                          WHEN uploads.time_to IS NULL OR @time_to > uploads.time_to
                          THEN @time_to ELSE uploads.time_to
                        END
`);

const selectUploads = db.prepare("SELECT * FROM uploads");

// ── Helpers ─────────────────────────────────────────────────────────────────

function computeTotals(sessions) {
  const totals = {
    total_input: 0,
    total_output: 0,
    total_cache_read: 0,
    total_cache_write: 0,
    total_reasoning: 0,
    total_cost: 0,
    time_from: null,
    time_to: null,
  };

  for (const s of sessions) {
    totals.total_input += s.input || 0;
    totals.total_output += s.output || 0;
    totals.total_cache_read += s.cache_read || 0;
    totals.total_cache_write += s.cache_write || 0;
    totals.total_reasoning += s.reasoning || 0;
    totals.total_cost += s.cost || 0;

    const created = s.time_created;
    if (created) {
      if (totals.time_from === null || created < totals.time_from) {
        totals.time_from = created;
      }
      if (totals.time_to === null || created > totals.time_to) {
        totals.time_to = created;
      }
    }
  }

  return totals;
}

function computeModels(sessions) {
  const modelMap = new Map();

  for (const s of sessions) {
    const model = s.model_id || "unknown";
    if (!modelMap.has(model)) {
      modelMap.set(model, {
        model,
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
        reasoning: 0,
        sessions: 0,
        sources: [],
      });
    }
    const entry = modelMap.get(model);
    entry.input += s.input || 0;
    entry.output += s.output || 0;
    entry.cache_read += s.cache_read || 0;
    entry.cache_write += s.cache_write || 0;
    entry.reasoning += s.reasoning || 0;
    entry.sessions += 1;
    // Track unique sources
    if (s.source && !entry.sources.includes(s.source)) {
      entry.sources.push(s.source);
    }
  }

  return Array.from(modelMap.values());
}

function mergeModels(existingModels, newSessions) {
  const newModels = computeModels(newSessions);
  const merged = new Map();

  for (const m of existingModels) {
    merged.set(m.model, { ...m });
  }

  for (const m of newModels) {
    if (merged.has(m.model)) {
      const existing = merged.get(m.model);
      existing.input += m.input;
      existing.output += m.output;
      existing.cache_read += m.cache_read;
      existing.cache_write += m.cache_write;
      existing.reasoning += m.reasoning;
      existing.sessions += m.sessions;
      // Merge sources without duplicates
      for (const src of m.sources || []) {
        if (!existing.sources.includes(src)) {
          existing.sources.push(src);
        }
      }
    } else {
      merged.set(m.model, { ...m });
    }
  }

  return Array.from(merged.values());
}

function parseSessionIds(row) {
  try {
    const val = row ? row.session_ids : null;
    return val ? JSON.parse(val) : [];
  } catch {
    return [];
  }
}

function lookupGithubId(token) {
  if (!token) return null;
  const session = db
    .prepare("SELECT github_id FROM sessions WHERE session_token = ?")
    .get(token);
  return session ? session.github_id : null;
}

// ── Express App ─────────────────────────────────────────────────────────────
const app = express();

// CORS - allow all origins
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json({ limit: "1mb" }));

// Static files
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// ── Auth routes ─────────────────────────────────────────────────────────────
app.use("/api", createAuthRouter(db));

// ── Admin routes ────────────────────────────────────────────────────────────
app.use("/api", createAdminRouter(db));

// ── POST /api/upload ────────────────────────────────────────────────────────
app.post("/api/upload", (req, res) => {
  try {
    const { nickname, sessions } = req.body;

    if (
      !nickname ||
      typeof nickname !== "string" ||
      nickname.trim().length === 0
    ) {
      return res
        .status(400)
        .json({
          error: "nickname is required and must be a non-empty string",
        });
    }
    if (!Array.isArray(sessions)) {
      return res.status(400).json({ error: "sessions must be an array" });
    }

    const cleanNick = nickname.trim();
    const now = Date.now();

    // Resolve uploader from auth header
    const authHeader = req.headers.authorization;
    const bearerToken =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;
    const uploaderGithubId = lookupGithubId(bearerToken);

    // Look up existing row
    const existingRow = db
      .prepare("SELECT * FROM uploads WHERE nickname = ?")
      .get(cleanNick);

    // Parse existing session IDs
    const existingIds = new Set(parseSessionIds(existingRow));

    // Filter to truly new sessions
    const newSessions = sessions.filter((s) => !existingIds.has(s.id));

    if (newSessions.length === 0) {
      // No new data — just touch time_uploaded
      if (existingRow) {
        db.prepare(
          "UPDATE uploads SET time_uploaded = ?, uploader_github_id = COALESCE(?, uploader_github_id) WHERE nickname = ?",
        ).run(now, uploaderGithubId, cleanNick);
      }
      return res.json({ status: "ok", sessions_uploaded: 0 });
    }

    // Merge session IDs
    const allSessionIds = [...existingIds, ...newSessions.map((s) => s.id)];
    const sessionIdsJson = JSON.stringify(allSessionIds);

    // Compute totals for new sessions only
    const totals = computeTotals(newSessions);

    // Merge models with existing data
    let mergedModels;
    if (existingRow) {
      let existingModels = [];
      try {
        existingModels = JSON.parse(existingRow.models_used || "[]");
      } catch {
        existingModels = [];
      }
      mergedModels = mergeModels(existingModels, newSessions);
    } else {
      mergedModels = computeModels(newSessions);
    }

    upsertStmt.run({
      nickname: cleanNick,
      total_input: totals.total_input,
      total_output: totals.total_output,
      total_cache_read: totals.total_cache_read,
      total_cache_write: totals.total_cache_write,
      total_reasoning: totals.total_reasoning,
      total_cost: totals.total_cost,
      session_count: newSessions.length,
      models_used: JSON.stringify(mergedModels),
      session_ids: sessionIdsJson,
      uploader_github_id: uploaderGithubId,
      time_uploaded: now,
      time_from: totals.time_from ?? null,
      time_to: totals.time_to ?? null,
    });

    return res.json({ status: "ok", sessions_uploaded: newSessions.length });
  } catch (err) {
    console.error("POST /api/upload error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/upload/delta ──────────────────────────────────────────────────
app.post("/api/upload/delta", (req, res) => {
  try {
    const {
      nickname,
      session_id,
      delta_input,
      delta_output,
      delta_cache_read,
      delta_cache_write,
      delta_reasoning,
      delta_cost,
    } = req.body;

    if (!nickname || typeof nickname !== "string") {
      return res.status(400).json({ error: "nickname is required" });
    }

    const cleanNick = nickname.trim();
    const now = Date.now();

    const existingRow = db
      .prepare("SELECT * FROM uploads WHERE nickname = ?")
      .get(cleanNick);

    let sessionIds = parseSessionIds(existingRow);
    const sessionIdSet = new Set(sessionIds);
    let sessionAdded = false;

    if (session_id && !sessionIdSet.has(session_id)) {
      sessionIds.push(session_id);
      sessionAdded = true;
    }

    const di = delta_input || 0;
    const dout = delta_output || 0;
    const dcr = delta_cache_read || 0;
    const dcw = delta_cache_write || 0;
    const dr = delta_reasoning || 0;
    const dc = delta_cost || 0;

    if (existingRow) {
      db.prepare(
        `UPDATE uploads SET
          total_input       = total_input       + ?,
          total_output      = total_output      + ?,
          total_cache_read  = total_cache_read  + ?,
          total_cache_write = total_cache_write + ?,
          total_reasoning   = total_reasoning   + ?,
          total_cost        = total_cost        + ?,
          session_count     = session_count     + ?,
          session_ids       = ?,
          time_uploaded     = ?
        WHERE nickname = ?`,
      ).run(
        di,
        dout,
        dcr,
        dcw,
        dr,
        dc,
        sessionAdded ? 1 : 0,
        JSON.stringify(sessionIds),
        now,
        cleanNick,
      );
    } else {
      db.prepare(
        `INSERT INTO uploads
          (nickname, total_input, total_output, total_cache_read, total_cache_write,
           total_reasoning, total_cost, session_count, session_ids, models_used,
           time_uploaded)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
      ).run(
        cleanNick,
        di,
        dout,
        dcr,
        dcw,
        dr,
        dc,
        sessionAdded ? 1 : 0,
        JSON.stringify(sessionIds),
        now,
      );
    }

    return res.json({ status: "ok" });
  } catch (err) {
    console.error("POST /api/upload/delta error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/leaderboard ────────────────────────────────────────────────────
app.get("/api/leaderboard", (_req, res) => {
  try {
    const rows = selectUploads.all();

    const leaderboard = rows
      .map((row) => {
        const total_tokens =
          row.total_input +
          row.total_output +
          row.total_cache_read +
          row.total_cache_write +
          row.total_reasoning;
        return {
          nickname: row.nickname,
          total_tokens,
          total_input: row.total_input,
          total_output: row.total_output,
          total_cache_read: row.total_cache_read,
          total_cache_write: row.total_cache_write,
          total_reasoning: row.total_reasoning,
          total_cost: row.total_cost || 0,
          session_count: row.session_count,
        };
      })
      .sort((a, b) => b.total_tokens - a.total_tokens)
      .map((entry, index) => ({ rank: index + 1, ...entry }));

    return res.json(leaderboard);
  } catch (err) {
    console.error("GET /api/leaderboard error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/leaderboard/detailed ───────────────────────────────────────────
app.get("/api/leaderboard/detailed", (_req, res) => {
  try {
    const rows = selectUploads.all();

    const detailed = rows.map((row) => {
      let models = [];
      try {
        models = JSON.parse(row.models_used || "[]");
      } catch {
        models = [];
      }
      return { nickname: row.nickname, models };
    });

    return res.json(detailed);
  } catch (err) {
    console.error("GET /api/leaderboard/detailed error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/stats ──────────────────────────────────────────────────────────
app.get("/api/stats", (_req, res) => {
  try {
    const rows = selectUploads.all();
    const now = Date.now();
    const day24 = now - 86400000;
    const day7 = now - 604800000;

    let total_tokens = 0;
    let total_cost = 0;
    let total_sessions = 0;
    let active_24h = 0;
    let active_7d = 0;

    for (const row of rows) {
      total_tokens +=
        row.total_input +
        row.total_output +
        row.total_cache_read +
        row.total_cache_write +
        row.total_reasoning;
      total_cost += row.total_cost || 0;
      total_sessions += row.session_count || 0;

      if (row.time_uploaded > day24) active_24h++;
      if (row.time_uploaded > day7) active_7d++;
    }

    res.json({
      total_tokens,
      total_cost,
      total_sessions,
      active_users: rows.length,
      active_24h,
      active_7d,
    });
  } catch (err) {
    console.error("GET /api/stats error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/pricing ────────────────────────────────────────────────────────
app.get("/api/pricing", (req, res) => {
  try {
    const model = req.query.model;
    if (!model) {
      return res.status(400).json({ error: "model query parameter is required" });
    }
    const result = lookupPricing(model);
    res.json(result);
  } catch (err) {
    console.error("GET /api/pricing error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /install.sh ─────────────────────────────────────────────────────────
app.get("/install.sh", (_req, res) => {
  const installPath = path.join(__dirname, "..", "install.sh");
  if (fs.existsSync(installPath)) {
    res.setHeader("Content-Type", "text/x-shellscript");
    res.sendFile(installPath);
  } else {
    res.redirect(
      302,
      "https://raw.githubusercontent.com/dac63701/token-leaderboard/main/install.sh",
    );
  }
});

// ── GET /api/cli/version ────────────────────────────────────────────────────
app.get("/api/cli/version", (_req, res) => {
  res.json({
    latest: "2.0",
    url: "https://raw.githubusercontent.com/dac63701/token-leaderboard/main/cli/token-leaderboard",
    sha256: "",
  });
});

// ── Start ───────────────────────────────────────────────────────────────────
initAdmin();
initPricingEngine().then(() => {
  console.log("Pricing engine initialized");
});

app.listen(PORT, () => {
  console.log(`Token Leaderboard server running on http://localhost:${PORT}`);
});
