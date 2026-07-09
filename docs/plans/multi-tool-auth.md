---
plan name: multi-tool-auth
plan description: Auth, minutes, multi-tool readers
plan status: active
---

## Idea
Update install.sh to require GitHub OAuth during installation (blocking device flow, nickname from GitHub), change AUTO_INTERVAL to minutes (10m default, stored as minutes), remove server install option, and add multi-tool support: read token data from Claude Code (JSONL), Codex CLI (JSONL), and GitHub Copilot (JSONL debug logs) in addition to OpenCode (SQLite). Auto-detect available tools and aggregate tokens from all sources.

## Implementation
- Overhaul install.sh: remove server setup prompt, add blocking GitHub OAuth device flow (talks to $SERVER_URL/api/auth/github/device), auto-populate NICKNAME from GitHub username after auth, prompt AUTO_INTERVAL in minutes (default 10), save config with minutes-based interval
- Update CLI token-leaderboard: change AUTO_INTERVAL config to minutes (multiply by 60 for sleep), update --help and config display to show minutes, update save_config and auto loop
- Add Claude Code reader: parse ~/.claude/projects/**/*.jsonl for type:result records with usage totals (input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, total_cost_usd), extract model from assistant messages, aggregate per-model
- Add Codex CLI reader: parse ~/.codex/sessions/**/*.jsonl for event_msg with type=token_count, extract total_token_usage accumulators (input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens), aggregate per-session
- Add GitHub Copilot reader: parse VS Code workspace debug logs (macOS: ~/Library/Application Support/Code/User/workspaceStorage/*/GitHub.copilot-chat/debug-logs/**/main.jsonl) for llm_request entries with inputTokens, outputTokens, cachedTokens, model, aggregate per-model
- Add CLI auto-detect: check which tool DB/JSONL directories exist, aggregate tokens from all found sources, include source field in session payload
- Update server.js to accept and store source field per session, update GET /api/leaderboard/detailed to return source info
- Update UI to show source badges (color-coded tags per model row in Detailed tab)
- Verify: bash syntax, server node check, functional test with sample JSONL data
- Commit and push all changes

## Required Specs
<!-- SPECS_START -->
- reset-fix-ui
<!-- SPECS_END -->