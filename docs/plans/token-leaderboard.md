---
plan name: token-leaderboard
plan description: Lightweight token usage leaderboard
plan status: done
---

## Idea
Build a minimal token leaderboard system with two parts: (1) a bash CLI script that reads token usage from OpenCode's local SQLite DB and uploads it to (2) a lightweight Vite + SQLite web server that displays a public leaderboard with Home (ranked totals) and Detailed (per-model breakdown) tabs. Users pick nicknames, no accounts needed. The CLI is a single ~80-line bash script using only sqlite3 + curl — zero dependencies.

## Implementation
- Create project directory structure with cli/, server/, server/public/
- Write bash CLI script (cli/token-leaderboard) that reads opencode DB, aggregates token usage per model, prompts for nickname, uploads via curl POST
- Write server/package.json with Express, better-sqlite3, and Vite dev dependency
- Write server/server.js with POST /api/upload and GET /api/leaderboard (simple + detailed) endpoints
- Write public/index.html as a two-tab SPA with Home and Detailed views
- Write public/style.css for clean minimal leaderboard styling
- Write public/app.js for client-side fetch rendering and localStorage nickname
- Create AGENTS.md describing project structure, build commands, and conventions
- Create README.md with install instructions, usage, GitHub repo creation guide, and run-on-start setup
- Initialize git repo, create .gitignore, and add instructions for first push to public GitHub repo

## Required Specs
<!-- SPECS_START -->
- leaderboard-spec
- reset-fix-ui
<!-- SPECS_END -->