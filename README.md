# Token Leaderboard

A lightweight token usage leaderboard for OpenCode users. Track how many tokens you and your friends are burning through.

**Two parts:**
- **CLI** — a single bash script that reads OpenCode's local SQLite DB and uploads token usage to a leaderboard server
- **Server** — a lightweight Express + SQLite web server with a two-tab dashboard

## Quick Start

### 1. Install the CLI

```bash
git clone https://github.com/dac63701/token-leaderboard.git
cd token-leaderboard
./install.sh
```

Or copy manually:

```bash
cp cli/token-leaderboard ~/.local/bin/
chmod +x ~/.local/bin/token-leaderboard
```

### 2. Start the server

```bash
cd server
npm install
npm start
```

Open http://localhost:3456 in your browser.

### 3. Upload your tokens

```bash
token-leaderboard
```

On first run, you'll be prompted for a nickname and server URL. After that, it reads your OpenCode database and uploads all new sessions.

## Usage

```bash
token-leaderboard           # Upload new sessions (interactive)
token-leaderboard --auto    # Upload silently (for shell hooks / cron)
token-leaderboard --config  # Show current configuration
token-leaderboard --reset   # Clear uploaded sessions, re-upload everything
token-leaderboard --help    # Show help
```

## Auto-upload on Shell Start

Add to your `.zshrc` or `.bashrc`:

```bash
# Token Leaderboard auto-upload
[[ -f ~/.local/bin/token-leaderboard ]] && source <(token-leaderboard --auto)
```

The `install.sh` wizard can do this for you automatically.

## Configuration

Stored at `~/.config/token-leaderboard/config`:

```
NICKNAME=my-name
SERVER_URL=http://localhost:3456
AUTO=0
```

## Server API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Upload token usage data |
| GET | `/api/leaderboard` | Ranked leaderboard (total tokens) |
| GET | `/api/leaderboard/detailed` | Per-model breakdown per user |

## Dashboard

The web dashboard has two tabs:

- **Home** — ranked leaderboard with total tokens, cost, and session count. Winner gets a 🏆.
- **Detailed** — per-model breakdown with sortable columns (input, output, cache, reasoning, sessions).

Auto-refreshes every 60 seconds. Light/dark theme follows your system preference.

## Docker

A Dockerfile is included for easy deployment:

```bash
# Build and run locally
docker build -t token-leaderboard server/
docker run -d -p 3456:3456 token-leaderboard
```

### Automated Docker Hub publish (via GitHub Action)

On every push to `main` that changes files in `server/`, a GitHub Action automatically:
1. Builds the Docker image
2. Pushes it to Docker Hub as `dac63701/token-leaderboard`

To set this up for your own Docker Hub account:

1. Fork the repo
2. Go to Settings → Secrets and variables → Actions
3. Add two secrets:
   - `DOCKER_USERNAME` — your Docker Hub username
   - `DOCKER_PASSWORD` — your Docker Hub password or access token
4. Update `DOCKER_IMAGE` in `.github/workflows/docker-publish.yml` to your username

You can also trigger it manually from the Actions tab in GitHub.

Pull the latest image anytime:
```bash
docker run -d -p 3456:3456 dac63701/token-leaderboard
```

### Docker Compose (Portainer-ready)

```yaml
version: '3.8'

networks:
  tl-net:
    name: token-leaderboard-net
    driver: bridge

services:
  leaderboard:
    image: dac63701/token-leaderboard:latest
    container_name: token-leaderboard
    restart: unless-stopped
    ports:
      - "3456:3456"
    environment:
      - PORT=3456
      - NODE_ENV=production
    volumes:
      - tl-data:/app/data
    networks:
      - tl-net

volumes:
  tl-data:
```

Deploy in Portainer as a stack.

## Deploying the Server

The server is a single Node.js process. Deploy anywhere that supports Node 18+:

```bash
# Clone on your server
git clone https://github.com/dac63701/token-leaderboard.git
cd token-leaderboard/server
npm install --production

# Run with a process manager (e.g., pm2)
PORT=3456 node server.js
```

Or use a VPS.

## Uninstall

From the cloned repo (removes CLI, config, and shell hooks with confirmation):
```bash
./uninstall.sh
```

Or via the CLI itself (no confirmation, run from anywhere):
```bash
token-leaderboard --uninstall
```

Both do the same thing: remove the binary from `~/.local/bin/token-leaderboard`, delete `~/.config/token-leaderboard/`, and clean up auto-upload hooks from your shell rc files.

To also remove the cloned repository:
```bash
cd .. && rm -rf token-leaderboard
```

## Privacy

- No accounts, no emails, no passwords
- Just a nickname you choose
- Only token counts and model names are uploaded
- Session titles are included (you can see what sessions were about)
- No message content, no code, no prompts

## Requirements

- **CLI**: bash, sqlite3, curl (all preinstalled on macOS and most Linux)
- **Server**: Node.js 18+

## Creating Your GitHub Repo

```bash
# From the project directory
git init
git add .
git commit -m "Initial commit: token leaderboard CLI + server"

# Create a repo on GitHub (or use gh CLI)
gh repo create token-leaderboard --public --push --source=.

# Or manually:
# 1. Create github.com/YOUR_USERNAME/token-leaderboard on GitHub
# 2. git remote add origin git@github.com:YOUR_USERNAME/token-leaderboard.git
# 3. git push -u origin main
```

## License

MIT
