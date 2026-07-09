# Spec: leaderboard-spec

Scope: feature

# Token Leaderboard — Feature Spec

## Overview
A minimal token usage leaderboard system. CLI reads OpenCode's local SQLite database, aggregates token usage, and uploads to a central server with a web dashboard.

## Components

### 1. CLI: Bash Script (`cli/token-leaderboard`)
- Single executable bash script, ~80 lines
- Reads `~/.local/share/opencode/opencode.db` via `sqlite3`
- Queries session table for: `tokens_input`, `tokens_output`, `tokens_cache_read`, `tokens_cache_write`, `tokens_reasoning`, `model`, `time_created`, `id`
- Aggregates total + per-model token counts
- Config file at `~/.config/token-leaderboard/config` stores:
  - `NICKNAME` (user-chosen display name)
  - `SERVER_URL` (default: `http://localhost:3456`)
  - `AUTO=0|1` (auto-upload on shell start)
- Prompts for nickname on first run if not set
- Prompts for server URL on first run if not set
- `--help` flag shows usage
- `--config` flag shows current config
- Uploads JSON payload via `curl -X POST`
- Stores a hash of the last-uploaded session IDs to avoid re-uploading (file: `~/.config/token-leaderboard/uploaded`)
- Returns success/failure message

### 2. Server (`server/`)
- Node.js Express server with SQLite (better-sqlite3)
- Default port: 3456
- Single table schema:
  ```sql
  CREATE TABLE uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT NOT NULL,
    total_input INTEGER DEFAULT 0,
    total_output INTEGER DEFAULT 0,
    total_cache_read INTEGER DEFAULT 0,
    total_cache_write INTEGER DEFAULT 0,
    total_reasoning INTEGER DEFAULT 0,
    session_count INTEGER DEFAULT 0,
    models_used TEXT, -- JSON array of {model, input, output, cache_read, cache_write, reasoning, sessions}
    time_uploaded INTEGER NOT NULL,
    time_from INTEGER, -- earliest session timestamp
    time_to INTEGER    -- latest session timestamp
  );
  ```
- POST `/api/upload` — receive token payload, upsert by nickname (merge cumulative totals)
- GET `/api/leaderboard` — returns simple ranked list: `[{rank, nickname, total_tokens, total_cost, session_count}]`
- GET `/api/leaderboard/detailed` — returns per-model breakdown for each user
- GET `/api/leaderboard/history` — optional, returns uploads over time
- Serves static files from `public/`

### 3. Frontend (`server/public/`)
- Single HTML file (`index.html`) with embedded CSS and JS (or split into style.css + app.js)
- Two tabs: **Home** and **Detailed**
- **Home tab**: Ranked list of users by total tokens. Shows: rank, nickname, total tokens, total cost, session count. Winner highlighted.
- **Detailed tab**: Table with columns: nickname, model, input, output, cache read, cache write, reasoning, sessions. Sortable by any column.
- Auto-refreshes every 60 seconds
- Responsive, works on mobile
- Light/dark theme via `prefers-color-scheme`
- Nickname is read-only displayed from query param `?nickname=NICKNAME` or falls back to localStorage

### 4. Config & Auto-start
- CLI stores config in `~/.config/token-leaderboard/config`
- For auto-run on shell start: user adds one line to `.zshrc`/`.bashrc`:
  ```bash
  [[ -f ~/.local/bin/token-leaderboard ]] && source <(token-leaderboard --auto)
  ```
- The `--auto` flag reads config and uploads silently (no prompts) if `AUTO=1`

### 5. GitHub Repo
- Repo name: `token-leaderboard`
- Public repo at github.com/USER/token-leaderboard
- README.md with install, usage, screenshots, run-on-start guide

## Constraints
- CLI must be a single bash script with zero dependencies beyond sqlite3 + curl
- Server must be lightweight, runnable on any Node 18+ host
- Frontend must be vanilla (no frameworks)
- No authentication — trust-based nickname system
- No Docker required but can be added later