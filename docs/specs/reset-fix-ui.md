# Spec: reset-fix-ui

Scope: feature

## Overview
Fix the `--reset` double-counting bug, add GitHub OAuth (device flow for CLI + web), add real-time pricing engine, add real-time session delta tracking, add CLI self-update mechanism, enhance the UI with a logo and stats bar, and make refresh intervals user-configurable.

## 1. Fix: Server-Side Session Deduplication

### Problem
`--reset` deletes `~/.config/token-leaderboard/uploaded`. All sessions look "new" on next run. The server `ON CONFLICT DO UPDATE SET col = col + delta` double-counts everything.

### Solution
- Add `session_ids TEXT` column (JSON array) to the `uploads` table
- On upload: load existing IDs for this nickname, filter incoming sessions to truly-new only, compute delta totals from the subset
- The local `uploaded` file becomes a performance hint only; server is authoritative
- Migration: `ALTER TABLE uploads ADD COLUMN session_ids TEXT DEFAULT '[]'` on startup

## 2. GitHub OAuth (Device Flow)

### Why
- Replaces trust-based nicknames with real GitHub identity
- No passwords — uses GitHub's device authorization grant
- Same UX as `gh auth login`, `heroku login`

### Server Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/auth/github/device` | Request device code from GitHub |
| POST | `/api/auth/github/poll` | Poll `{device_code}` for auth status |
| GET | `/api/auth/github/callback` | OAuth web callback (browser) |
| GET | `/api/auth/me` | Return current user from `Authorization` header |
| POST | `/api/auth/logout` | Revoke session |

### DB Changes
- New `accounts` table: `github_id`, `nickname`, `avatar_url`, `access_token`, timestamps
- `uploads.uploader_github_id INTEGER REFERENCES accounts(github_id)`

### CLI Flow
`token-leaderboard --login` → prints device code URL + code → polls server → stores `GITHUB_TOKEN` in config

### Web Flow
"Login with GitHub" button → OAuth redirect → callback → session cookie

## 3. Real-Time Pricing Engine

### Data Sources
- LiteLLM model cost map: `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`
- OpenRouter models: `https://openrouter.ai/api/v1/models`
- Custom overrides: `~/.config/token-leaderboard/custom-pricing.json`

### Resolution Strategy
1. Custom pricing overrides (exact match)
2. LiteLLM exact match
3. OpenRouter exact match
4. Alias resolution (friendly names)
5. Provider prefix stripping
6. Version normalization
7. Fuzzy matching on model name

### Endpoint
`GET /api/pricing?model=deepseek-v4-flash-free` → `{input, output, cache_read, cache_write, source, updated_at}`

### Dashboard
- Model cost tooltips showing per-token rate
- "Cost per 1M tokens" column in Detailed tab

## 4. Real-Time Session Delta Tracking

### Key Insight
OpenCode writes token counts to `opencode.db` in real-time. `time_updated` changes as sessions progress. No need to wait for session completion.

### New State File
`~/.config/token-leaderboard/session_state` — one line per session:
```
session_id|{last_input,last_output,last_cache_read,last_cache_write,last_reasoning,last_updated}
```

### CLI Upload Logic
1. Query ALL sessions with tokens (not just new)
2. For each session, check `session_state`:
   - **New**: full upload, add to state
   - **Updated** (`time_updated` higher, tokens changed): upload delta, update state
   - **Unchanged**: skip
3. Session marked delta upload: `{session_id, delta_input, delta_output, ..., delta: true}`
4. Server adds delta to existing per‑session accumulators
5. Archived sessions (`time_archived IS NOT NULL`) skip re-checks

### Performance
<10ms sqlite3 query. One HTTP POST per run. `AUTO_INTERVAL` defaults to 60s.

## 5. CLI Self-Update

- `SCRIPT_VERSION=2.0` in CLI header
- Server: `GET /api/cli/version` → `{latest, url, sha256}`
- `token-leaderboard --update` → downloads new script, verifies SHA256, atomic self-replace with `mv`
- Auto-check during `--auto` mode (opt-out via `AUTO_UPDATE=0`)

## 6. UI Enhancements

### Logo & Branding
- Inline SVG token icon (interlocking hexagons) in header
- SVG favicon

### Stats Bar
- 5 summary cards: total tokens, total cost, total sessions, active users, 7d active
- Powered by `GET /api/stats`

### Settings Panel
- Gear icon in header → slide-out panel
- Refresh interval slider: 10s–300s, persisted in localStorage as `tl_refresh_interval`
- Default: 60s

### Visual Polish
- Winner pulse animation (CSS `@keyframes`)
- Expandable per-user rows in Home tab (click → model breakdown)
- Hover tooltips on token/cost cells with per-model rates
- Dynamic "last updated Xs ago" in footer
- Loading skeletons (shimmer placeholders)
- Login button (GitHub icon + "Login with GitHub")
- Pricing source badge in Detailed tab

## 7. Configurable Intervals

- CLI config: `AUTO_INTERVAL` (seconds, default 60 for real-time, 900 fallback)
- Web UI: settings slider → localStorage `tl_refresh_interval` (default 60s)
- Config file: `REFRESH_INTERVAL` as server-recommended default
