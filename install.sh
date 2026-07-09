#!/usr/bin/env bash
#
# Token Leaderboard — Interactive Installer
# ==========================================

set -euo pipefail

# ---- Paths ----
CONFIG_DIR="${HOME}/.config/token-leaderboard"
CONFIG_FILE="${CONFIG_DIR}/config"
CLI_SOURCE="$(cd "$(dirname "$0")" && pwd)/cli/token-leaderboard"
CLI_TARGET="${HOME}/.local/bin/token-leaderboard"
BIN_DIR="${HOME}/.local/bin"
OPENCODE_DB="${HOME}/.local/share/opencode/opencode.db"

# ---- Defaults ----
DEFAULT_NICKNAME="${HOSTNAME:-$(hostname 2>/dev/null || echo "anonymous")}"
DEFAULT_SERVER_URL="https://token.dac63701.com"
NONINTERACTIVE=false

# ---- Parse flags ----
for arg in "$@"; do
  case "$arg" in
    --yes) NONINTERACTIVE=true ;;
    --help|-h)
      echo "Usage: install.sh [--yes]"
      echo ""
      echo "  --yes   Non-interactive mode — use all defaults"
      exit 0
      ;;
  esac
done

# ---- Utility functions ----
prompt() {
  local msg="$1" default="$2" var_name="$3"
  local input
  if [ -n "$default" ]; then
    read -r -p "$msg [$default]: " input
  else
    read -r -p "$msg: " input
  fi
  if [ -z "$input" ] && [ -n "$default" ]; then
    input="$default"
  fi
  printf -v "$var_name" "%s" "$input"
}

prompt_yn() {
  local msg="$1" default="$2" var_name="$3"
  local input result
  read -r -p "$msg " input
  input="$(echo "${input:-$default}" | tr '[:upper:]' '[:lower:]')"
  case "$input" in
    y|yes) result=true ;;
    *)     result=false ;;
  esac
  printf -v "$var_name" "%s" "$result"
}

print_banner() {
  echo ""
  echo "╔══════════════════════════════════════╗"
  echo "║     Token Leaderboard Installer      ║"
  echo "╚══════════════════════════════════════╝"
  echo ""
}

# ===============================================================
#  1. Detect OpenCode DB
# ===============================================================
detect_opencode_db() {
  if [ -f "$OPENCODE_DB" ]; then
    echo "  ✓ OpenCode database found at:"
    echo "    $OPENCODE_DB"
  else
    echo "  ! OpenCode database not found at:"
    echo "    $OPENCODE_DB"
    echo "    (Install OpenCode or configure the path later in the CLI script.)"
  fi
  echo ""
}

# ===============================================================
#  2. Server URL
# ===============================================================
configure_server_url() {
  if $NONINTERACTIVE; then
    SERVER_URL="$DEFAULT_SERVER_URL"
  else
    prompt "Enter leaderboard server URL" "$DEFAULT_SERVER_URL" SERVER_URL
  fi
  SERVER_URL="${SERVER_URL%/}"
  echo "  → Server URL: $SERVER_URL"
  echo ""
}

# ===============================================================
#  4. Auto-upload
# ===============================================================
configure_auto_upload() {
  if $NONINTERACTIVE; then
    AUTO=false
    AUTO_INTERVAL=10
    AUTO_UPDATE=true
  else
    local yn
    echo ""
    echo "  Auto-upload runs token-leaderboard --auto in the background,"
    echo "  keeping your leaderboard stats up to date in real-time."
    prompt_yn "Enable auto-upload? [y/N]" "n" yn
    AUTO="$yn"

    if $AUTO; then
      prompt "Upload interval in minutes" "10" AUTO_INTERVAL
      prompt_yn "Auto-update CLI when new version is available? [Y/n]" "y" yn
      AUTO_UPDATE="$yn"
    else
      AUTO_INTERVAL=10
      AUTO_UPDATE=true
    fi
  fi
  if $AUTO; then
    echo "  → Auto-upload: enabled (every ${AUTO_INTERVAL}m)"
    echo "  → Auto-update: $AUTO_UPDATE"
  else
    echo "  → Auto-upload: disabled"
  fi
  echo ""
}

# ===============================================================
#  5. Install CLI
# ===============================================================
install_cli() {
  echo "  Installing CLI script …"

  if [ ! -f "$CLI_SOURCE" ]; then
    echo ""
    echo "  ERROR: CLI script not found at:"
    echo "         $CLI_SOURCE"
    echo "  Ensure 'cli/token-leaderboard' exists in the project."
    exit 1
  fi

  mkdir -p "$BIN_DIR"
  cp "$CLI_SOURCE" "$CLI_TARGET"
  chmod +x "$CLI_TARGET"

  echo "  ✓ Installed to: $CLI_TARGET"

  case ":${PATH}:" in
    *:"${BIN_DIR}":*) ;;
    *)
      echo "  ! WARNING: ${BIN_DIR} is not in your PATH."
      echo "    Add the following to your shell profile:"
      echo "      export PATH=\"\${HOME}/.local/bin:\${PATH}\""
      ;;
  esac
  echo ""
}

# ===============================================================
#  6. Shell hook (if auto-upload chosen)
# ===============================================================
install_shell_hook() {
  if ! $AUTO; then
    echo "  Skipping shell hook (auto-upload disabled)."
    echo ""
    return
  fi

  local shell_name rc_file
  shell_name="$(basename "${SHELL:-/bin/zsh}")"
  case "$shell_name" in
    zsh) rc_file="${HOME}/.zshrc" ;;
    bash) rc_file="${HOME}/.bashrc" ;;
    *)   rc_file="${HOME}/.profile" ;;
  esac

  local hook_line="(while true; do ~/.local/bin/token-leaderboard --auto 2>/dev/null; sleep $((AUTO_INTERVAL * 60)); done &) 2>/dev/null"
  local marker="# Token Leaderboard auto-upload"

  if $NONINTERACTIVE; then
    INSTALL_HOOK=false
  else
    local yn
    prompt_yn "Add auto-upload to $(basename "$rc_file")? [Y/n]" "y" yn
    INSTALL_HOOK="$yn"
  fi

  if ! $INSTALL_HOOK; then
    echo "  Skipping shell hook."
    echo ""
    return
  fi

  if [ -f "$rc_file" ] && grep -qF "$marker" "$rc_file" 2>/dev/null; then
    echo "  ✓ Shell hook already present in $rc_file"
  else
    if [ -f "$rc_file" ]; then
      sed -i '' '/# Token Leaderboard auto-upload/d' "$rc_file" 2>/dev/null || true
      sed -i '' '/token-leaderboard --auto/d' "$rc_file" 2>/dev/null || true
    fi
    {
      echo ""
      echo "$marker"
      echo "$hook_line"
    } >> "$rc_file"
    echo "  ✓ Added auto-upload hook to $rc_file"
  fi
  echo ""
  echo "  ┌──────────────────────────────────────────────────────────┐"
  echo "  │  Auto-upload runs token-leaderboard --auto in a loop.   │"
  echo "  │  It only uploads when new or updated session data exists.│"
  echo "  └──────────────────────────────────────────────────────────┘"
  echo ""
}

# ===============================================================
#  7. GitHub OAuth device flow (blocking)
# ===============================================================
github_login_prompt() {
  if $NONINTERACTIVE; then
    echo "  Skipping GitHub auth (non-interactive mode)."
    echo ""
    return
  fi

  echo ""
  echo "  === GitHub Authentication ==="
  echo ""
  echo "  Token Leaderboard uses GitHub for identity. You'll need to authenticate."
  echo ""

  local response user_code device_code verification_uri interval

  response="$(curl -s "$SERVER_URL/api/auth/github/device")"

  user_code="$(echo "$response" | grep -o '"user_code":"[^"]*"' | sed 's/"user_code":"//;s/"//')"
  device_code="$(echo "$response" | grep -o '"device_code":"[^"]*"' | sed 's/"device_code":"//;s/"//')"
  verification_uri="$(echo "$response" | grep -o '"verification_uri":"[^"]*"' | sed 's/"verification_uri":"//;s/"//')"
  interval="$(echo "$response" | grep -o '"interval":[0-9]*' | sed 's/"interval"://')"

  if [ -z "$user_code" ] || [ -z "$device_code" ]; then
    echo "  ERROR: Failed to start GitHub device auth. Server response:"
    echo "         $response"
    echo ""
    exit 1
  fi

  echo "  Open this URL: ${verification_uri:-https://github.com/login/device}"
  echo "  Enter code:    $user_code"
  echo ""

  local poll_interval="${interval:-5}"
  echo "  Waiting for authentication …"

  while true; do
    sleep "$poll_interval"
    local poll_result
    poll_result="$(curl -s "$SERVER_URL/api/auth/github/poll" \
      -H "Content-Type: application/json" \
      -d "{\"device_code\":\"$device_code\"}")"

    local status
    status="$(echo "$poll_result" | grep -o '"status":"[^"]*"' | sed 's/"status":"//;s/"//')"

    case "$status" in
      complete)
        local token nickname
        token="$(echo "$poll_result" | grep -o '"token":"[^"]*"' | sed 's/"token":"//;s/"//')"
        nickname="$(echo "$poll_result" | grep -o '"nickname":"[^"]*"' | sed 's/"nickname":"//;s/"//')"
        GITHUB_TOKEN="$token"
        NICKNAME="$nickname"
        echo "  ✓ Authenticated as: $NICKNAME"
        echo ""
        return
        ;;
      expired|error)
        local error_desc
        error_desc="$(echo "$poll_result" | grep -o '"error_description":"[^"]*"' | sed 's/"error_description":"//;s/"//')"
        echo "  Error: ${error_desc:-$status}"
        echo ""
        exit 1
        ;;
      *)
        # Still waiting — continue polling
        ;;
    esac
  done
}



# ===============================================================
#  Save config
# ===============================================================
save_config() {
  mkdir -p "$CONFIG_DIR"

  {
    echo "# Token Leaderboard configuration"
    echo "# Generated by install.sh — $(date)"
    echo ""
    echo "NICKNAME=${NICKNAME}"
    echo "SERVER_URL=${SERVER_URL}"
    echo "AUTO=$($AUTO && echo 1 || echo 0)"
    echo "AUTO_INTERVAL=${AUTO_INTERVAL:-10}"
    echo "AUTO_UPDATE=$($AUTO_UPDATE && echo 1 || echo 0)"
    echo "GITHUB_TOKEN=${GITHUB_TOKEN}"
  } > "$CONFIG_FILE"

  echo "  ✓ Config saved to: $CONFIG_FILE"
  echo ""
}

# ===============================================================
#  Summary
# ===============================================================
print_summary() {
  local auto_status
  if $AUTO; then auto_status="enabled (every ${AUTO_INTERVAL}m)"; else auto_status="disabled"; fi

  echo "╔══════════════════════════════════════╗"
  echo "║         Installation Complete         ║"
  echo "╚══════════════════════════════════════╝"
  echo ""
  echo "  Config:  ${CONFIG_DIR}/config"
  echo "  CLI:     ${CLI_TARGET}"
  echo "  Server:  ${SERVER_URL}"
  echo "  Nickname: ${NICKNAME} (from GitHub)"
  echo "  Auto:    ${auto_status}"
  echo ""
  echo "  Run 'token-leaderboard' to upload your tokens."
  echo "  Run 'token-leaderboard --help' for all options."
  echo ""
}

# ===============================================================
#  First upload
# ===============================================================
run_first_upload() {
  echo ""
  echo "  Running first-time upload..."
  if "$CLI_TARGET" --first-run 2>/dev/null; then
    echo "  Your token usage has been uploaded to the leaderboard."
    echo "  Open ${SERVER_URL} in your browser to view it."
  else
    echo "  First upload skipped (no token data found or server unreachable)."
    echo "  Run 'token-leaderboard' later to upload."
  fi
  echo ""
}

# ===============================================================
#  Main
# ===============================================================
main() {
  print_banner
  detect_opencode_db
  configure_server_url
  github_login_prompt
  configure_auto_upload
  install_cli
  install_shell_hook
  save_config
  run_first_upload
  print_summary
}

main "$@"
