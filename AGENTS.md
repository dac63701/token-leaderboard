# Token Leaderboard — Implementation Plan

## Tech Stack
- **CLI**: Bash script (zero dependencies, uses sqlite3 + curl)
- **Server**: Node.js + Express + better-sqlite3
- **Frontend**: Vanilla HTML/CSS/JS (no frameworks), two-tab SPA
- **Database**: SQLite (server-side, `leaderboard.db`)
- **Auth**: None — trust-based nickname system

---

## Project Structure

```
token-leaderboard/
├── cli/
│   └── token-leaderboard       # Bash script — reads opencode DB, uploads to server
├── server/
│   ├── package.json
│   ├── server.js               # Express server with SQLite
│   ├── leaderboard.db          # SQLite (auto-created on first run)
│   └── public/
│       ├── index.html           # Two-tab SPA: Home + Detailed
│       ├── style.css
│       └── app.js
├── install.sh                  # One-command install script
├── AGENTS.md                   # This file
├── README.md                   # Full usage and GitHub instructions
└── .gitignore
```

---

## CLI Design (`cli/token-leaderboard`)

- Reads `~/.local/share/opencode/opencode.db` via `sqlite3`
- Aggregates tokens per nickname per model
- Config stored in `~/.config/token-leaderboard/config`:
  - `NICKNAME=my-name`
  - `SERVER_URL=http://localhost:3456`
  - `AUTO=0|1`
- Uploads JSON via `curl -X POST`
- Flags: `--help`, `--config`, `--auto`, `--reset`
- Tracks uploaded session IDs in `~/.config/token-leaderboard/uploaded` to avoid duplicates

## Server API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Receive token payload, upsert by nickname |
| GET | `/api/leaderboard` | Simple ranked list (total tokens + cost) |
| GET | `/api/leaderboard/detailed` | Per-model breakdown per user |

## Frontend

- **Home tab**: Ranked leaderboard — rank, nickname, total tokens, cost, sessions. Winner highlighted with trophy icon.
- **Detailed tab**: Per-model table — nickname, model, input/output/cache/reasoning tokens, sessions. Clickable column headers for sorting.
- Auto-refresh every 60s
- Light/dark theme via `prefers-color-scheme`
- Responsive layout

## GitHub & README

- Public repo: `github.com/USER/token-leaderboard`
- README includes: install (curl + bash), usage, server deploy, run-on-start setup, privacy notes

## Build & Run

```bash
# Install CLI
./install.sh
# Or: cp cli/token-leaderboard ~/.local/bin/

# Run server
cd server && npm install && npm start

# Upload tokens
token-leaderboard

# View leaderboard
open http://localhost:3456

# Auto-run on shell start (add to .zshrc/.bashrc)
[[ -f ~/.local/bin/token-leaderboard ]] && source <(token-leaderboard --auto)
```