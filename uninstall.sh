#!/usr/bin/env bash
#
# Token Leaderboard — Uninstaller
# =================================

set -euo pipefail

CONFIG_DIR="${HOME}/.config/token-leaderboard"
CLI_TARGET="${HOME}/.local/bin/token-leaderboard"
BIN_DIR="${HOME}/.local/bin"

print_banner() {
  echo ""
  echo "╔══════════════════════════════════════╗"
  echo "║    Token Leaderboard Uninstaller     ║"
  echo "╚══════════════════════════════════════╝"
  echo ""
}

confirm() {
  local msg="$1"
  local input
  read -r -p "$msg [y/N] " input
  case "${input:-n}" in
    y|Y|yes|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

remove_cli() {
  if [ -f "$CLI_TARGET" ]; then
    rm -f "$CLI_TARGET"
    echo "  ✓ Removed CLI: $CLI_TARGET"
  else
    echo "  - CLI not found at $CLI_TARGET"
  fi

  # Remove empty bin dir if it exists and is empty
  if [ -d "$BIN_DIR" ] && [ -z "$(ls -A "$BIN_DIR" 2>/dev/null)" ]; then
    rmdir "$BIN_DIR" 2>/dev/null || true
    echo "  ✓ Removed empty bin directory: $BIN_DIR"
  fi
}

remove_config() {
  if [ -d "$CONFIG_DIR" ]; then
    rm -rf "$CONFIG_DIR"
    echo "  ✓ Removed config directory: $CONFIG_DIR"
  else
    echo "  - Config directory not found at $CONFIG_DIR"
  fi
}

remove_shell_hooks() {
  local marker="# Token Leaderboard auto-upload"
  local count=0

  for rc_file in "${HOME}/.zshrc" "${HOME}/.bashrc" "${HOME}/.profile"; do
    if [ -f "$rc_file" ] && grep -qF "$marker" "$rc_file" 2>/dev/null; then
      sed -i '' '/# Token Leaderboard auto-upload/d' "$rc_file" 2>/dev/null || true
      sed -i '' '/token-leaderboard --auto/d' "$rc_file" 2>/dev/null || true
      sed -i '' '/token-leaderboard --update/d' "$rc_file" 2>/dev/null || true
      echo "  ✓ Removed auto-upload hook from $rc_file"
      count=$((count + 1))
    fi
  done

  if [ "$count" -eq 0 ]; then
    echo "  - No shell hooks found"
  fi
}

print_summary() {
  echo ""
  echo "╔══════════════════════════════════════╗"
  echo "║        Uninstall Complete             ║"
  echo "╚══════════════════════════════════════╝"
  echo ""
  echo "  Token Leaderboard has been removed."
  echo ""
  echo "  To also remove the cloned repository, run:"
  echo "    rm -rf $(cd "$(dirname "$0")" && pwd)"
  echo ""
}

main() {
  print_banner

  if ! confirm "Remove Token Leaderboard CLI, config, and shell hooks?"; then
    echo "Cancelled."
    exit 0
  fi

  echo ""
  remove_cli
  remove_config
  remove_shell_hooks
  print_summary
}

main "$@"
