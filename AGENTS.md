# Token Leaderboard — Implementation Plan

## Conventions

**Versioning**: Use semver (patch bump for bugfixes/minor tweaks, minor for features, major for breaking).
On each meaningful code change, bump both:
- `server/package.json` → `"version": "x.y.z"`
- `cli/token-leaderboard` → `VERSION="x.y.z"`
Keep them in sync. The version is displayed in `token-leaderboard --help` and `/api/version`.

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
- Update mechanism: `--update` fetches `/api/cli/version` from server, compares SHA256 of running script with server's GitHub-fetched SHA256

## Server API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Receive token payload, upsert by nickname |
| GET | `/api/leaderboard` | Simple ranked list (total tokens + cost) |
| GET | `/api/leaderboard/detailed` | Per-model breakdown per user |
| GET | `/api/version` | Server version + git commit |
| GET | `/api/cli/version` | Latest CLI SHA256 + download URL (always fetches fresh from GitHub) |
| GET | `/api/cli/download` | Download CLI script (cached copy or GitHub redirect) |

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