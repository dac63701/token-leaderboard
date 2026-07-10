#!/usr/bin/env bash
#
# Token Leaderboard — Uninstaller
# =================================

set -euo pipefail

BIN_DIR="${HOME}/.local/bin"
CLI_TARGET="${BIN_DIR}/token-leaderboard"
CONFIG_DIR="${HOME}/.config/token-leaderboard"

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

remove_empty_bin_dir() {
  if [ -d "$BIN_DIR" ] && [ -z "$(ls -A "$BIN_DIR" 2>/dev/null)" ]; then
    rmdir "$BIN_DIR" 2>/dev/null || true
    echo "  ✓ Removed empty bin directory: $BIN_DIR"
  fi
}

print_summary() {
  echo ""
  echo "╔══════════════════════════════════════╗"
  echo "║        Uninstall Complete             ║"
  echo "╚══════════════════════════════════════╝"
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

  # Delegate to installed CLI if available (handles binary, config, shell hooks)
  if [ -f "$CLI_TARGET" ] || [ -d "$CONFIG_DIR" ]; then
    if [ -f "$CLI_TARGET" ]; then
      echo "  Uninstalling via token-leaderboard --uninstall ..."
      "$CLI_TARGET" --uninstall
    else
      # Config exists but CLI doesn't — clean up config directly
      rm -rf "$CONFIG_DIR"
      echo "  ✓ Removed config: $CONFIG_DIR"
      # Still try to clean shell hooks via a direct invocation
      if command -v token-leaderboard &>/dev/null; then
        token-leaderboard --uninstall
      else
        local marker="# Token Leaderboard auto-upload"
        for rc_file in "${HOME}/.zshrc" "${HOME}/.bashrc" "${HOME}/.profile"; do
          if [ -f "$rc_file" ] && grep -qF "$marker" "$rc_file" 2>/dev/null; then
            sed -i '' '/# Token Leaderboard auto-upload/d' "$rc_file" 2>/dev/null || true
            sed -i '' '/token-leaderboard --auto/d' "$rc_file" 2>/dev/null || true
            sed -i '' '/token-leaderboard --update/d' "$rc_file" 2>/dev/null || true
            echo "  ✓ Removed shell hook from $rc_file"
          fi
        done
      fi
    fi
  else
    echo "  Nothing to uninstall — Token Leaderboard not found."
    exit 0
  fi

  remove_empty_bin_dir
  print_summary
}

main "$@"
