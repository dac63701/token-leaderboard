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
#  2. Nickname
# ===============================================================
configure_nickname() {
  if $NONINTERACTIVE; then
    NICKNAME="$DEFAULT_NICKNAME"
  else
    prompt "Enter your display name for the leaderboard" "$DEFAULT_NICKNAME" NICKNAME
  fi
  echo "  → Nickname: $NICKNAME"
  echo ""
}

# ===============================================================
#  3. Server URL
# ===============================================================
configure_server_url() {
  if $NONINTERACTIVE; then
    SERVER_URL="$DEFAULT_SERVER_URL"
  else
    prompt "Enter leaderboard server URL" "$DEFAULT_SERVER_URL" SERVER_URL
  fi
  # Strip trailing slash
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
  else
    local yn
    echo ""
    echo "  Auto-upload runs token-leaderboard every 15 minutes in the"
    echo "  background, keeping your leaderboard stats up to date."
    prompt_yn "Enable auto-upload (every 15 min)? [y/N]" "n" yn
    AUTO="$yn"
  fi
  if $AUTO; then
    echo "  → Auto-upload: enabled (every 15 minutes)"
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

  # Validate source exists
  if [ ! -f "$CLI_SOURCE" ]; then
    echo ""
    echo "  ERROR: CLI script not found at:"
    echo "         $CLI_SOURCE"
    echo "  Ensure 'cli/token-leaderboard' exists in the project."
    exit 1
  fi

  # Create target bin directory
  mkdir -p "$BIN_DIR"

  # Copy and make executable
  cp "$CLI_SOURCE" "$CLI_TARGET"
  chmod +x "$CLI_TARGET"

  echo "  ✓ Installed to: $CLI_TARGET"

  # Check PATH
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

  # Determine shell rc file
  local shell_name rc_file
  shell_name="$(basename "${SHELL:-/bin/zsh}")"
  case "$shell_name" in
    zsh) rc_file="${HOME}/.zshrc" ;;
    bash) rc_file="${HOME}/.bashrc" ;;
    *)   rc_file="${HOME}/.profile" ;;
  esac

  local hook_line='(while true; do ~/.local/bin/token-leaderboard --auto 2>/dev/null; sleep 900; done &) 2>/dev/null'
  local marker="# Token Leaderboard auto-upload (every 15min)"

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

  # Check for existing hook to avoid duplicates
  if [ -f "$rc_file" ] && grep -qF "$marker" "$rc_file" 2>/dev/null; then
    echo "  ✓ Shell hook already present in $rc_file"
  else
    # Remove old-style hook if present
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
  echo "  │  Auto-upload will run in the background every 15 minutes. │"
  echo "  │  It only uploads when new session data is available.     │"
  echo "  └──────────────────────────────────────────────────────────┘"
  echo ""
}

# ===============================================================
#  7. Server setup prompt
# ===============================================================
server_setup_prompt() {
  if $NONINTERACTIVE; then
    SETUP_SERVER=false
    return
  fi

  local yn
  prompt_yn "Start the leaderboard server locally? [y/N]" "n" yn
  SETUP_SERVER="$yn"

  if $SETUP_SERVER; then
    echo ""
    echo "  To start the server:"
    echo "    cd server && npm install && npm start"
    echo "  Then open http://localhost:3456"
    echo ""
  fi
}

# ===============================================================
#  Save config
# ===============================================================
save_config() {
  mkdir -p "$CONFIG_DIR"

  # Preserve existing config values not being overwritten
  local old_uploaded=""
  if [ -f "$CONFIG_FILE" ]; then
    old_uploaded="$(grep '^UPLOADED_FILE=' "$CONFIG_FILE" || true)"
  fi

  {
    echo "# Token Leaderboard configuration"
    echo "# Generated by install.sh — $(date)"
    echo ""
    echo "NICKNAME=${NICKNAME}"
    echo "SERVER_URL=${SERVER_URL}"
    if $AUTO; then echo "AUTO=1"; else echo "AUTO=0"; fi
    [ -n "$old_uploaded" ] && echo "$old_uploaded"
  } > "$CONFIG_FILE"

  echo "  ✓ Config saved to: $CONFIG_FILE"
  echo ""
}

# ===============================================================
#  8. Summary
# ===============================================================
print_summary() {
  local auto_status
  if $AUTO; then auto_status="enabled"; else auto_status="disabled"; fi

  echo "╔══════════════════════════════════════╗"
  echo "║         Installation Complete         ║"
  echo "╚══════════════════════════════════════╝"
  echo ""
  echo "  Config:  ${CONFIG_DIR}/config"
  echo "  CLI:     ${CLI_TARGET}"
  echo "  Server:  ${SERVER_URL}"
  echo "  Auto:    ${auto_status}"
  echo ""
  echo "  Run 'token-leaderboard' to upload your tokens."
  echo ""
}

# ===============================================================
#  Main
# ===============================================================
main() {
  print_banner
  detect_opencode_db
  configure_nickname
  configure_server_url
  configure_auto_upload
  install_cli
  install_shell_hook
  server_setup_prompt
  save_config
  print_summary
}

main "$@"
