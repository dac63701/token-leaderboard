import express from "express";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT, 10) || 3456;

// ── Database ────────────────────────────────────────────────────────────────
const dbPath = path.join(__dirname, "leaderboard.db");
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

// Prepared statements
const upsertStmt = db.prepare(`
  INSERT INTO uploads (nickname, total_input, total_output, total_cache_read, total_cache_write,
    total_reasoning, total_cost, session_count, models_used, time_uploaded, time_from, time_to)
  VALUES (@nickname, @total_input, @total_output, @total_cache_read, @total_cache_write,
    @total_reasoning, @total_cost, @session_count, @models_used, @time_uploaded, @time_from, @time_to)
  ON CONFLICT(nickname) DO UPDATE SET
    total_input       = total_input       + @total_input,
    total_output      = total_output      + @total_output,
    total_cache_read  = total_cache_read  + @total_cache_read,
    total_cache_write = total_cache_write + @total_cache_write,
    total_reasoning   = total_reasoning   + @total_reasoning,
    total_cost        = total_cost        + @total_cost,
    session_count     = session_count     + @session_count,
    models_used       = @models_used,
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
      });
    }
    const entry = modelMap.get(model);
    entry.input += s.input || 0;
    entry.output += s.output || 0;
    entry.cache_read += s.cache_read || 0;
    entry.cache_write += s.cache_write || 0;
    entry.reasoning += s.reasoning || 0;
    entry.sessions += 1;
  }

  return Array.from(modelMap.values());
}

// merge new models with existing (stored) models
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
    } else {
      merged.set(m.model, { ...m });
    }
  }

  return Array.from(merged.values());
}

// ── Express App ─────────────────────────────────────────────────────────────
const app = express();

// CORS - allow all origins
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

// ── POST /api/upload ────────────────────────────────────────────────────────
app.post("/api/upload", (req, res) => {
  try {
    const { nickname, sessions } = req.body;

    if (!nickname || typeof nickname !== "string" || nickname.trim().length === 0) {
      return res.status(400).json({ error: "nickname is required and must be a non-empty string" });
    }
    if (!Array.isArray(sessions)) {
      return res.status(400).json({ error: "sessions must be an array" });
    }

    const cleanNick = nickname.trim();
    const totals = computeTotals(sessions);
    const now = Date.now();

    // Merge models with existing data if present
    const existingRow = db.prepare("SELECT models_used FROM uploads WHERE nickname = ?").get(cleanNick);
    let mergedModels;
    if (existingRow) {
      let existingModels = [];
      try {
        existingModels = JSON.parse(existingRow.models_used || "[]");
      } catch {
        existingModels = [];
      }
      mergedModels = mergeModels(existingModels, sessions);
    } else {
      mergedModels = computeModels(sessions);
    }

    upsertStmt.run({
      nickname: cleanNick,
      total_input: totals.total_input,
      total_output: totals.total_output,
      total_cache_read: totals.total_cache_read,
      total_cache_write: totals.total_cache_write,
      total_reasoning: totals.total_reasoning,
      total_cost: totals.total_cost,
      session_count: sessions.length,
      models_used: JSON.stringify(mergedModels),
      time_uploaded: now,
      time_from: totals.time_from ?? null,
      time_to: totals.time_to ?? null,
    });

    return res.json({ status: "ok", sessions_uploaded: sessions.length });
  } catch (err) {
    console.error("POST /api/upload error:", err);
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

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Token Leaderboard server running on http://localhost:${PORT}`);
});
