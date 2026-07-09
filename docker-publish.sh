#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# docker-publish.sh — Build, tag, push Docker image + commit & push to GitHub
# Usage: ./docker-publish.sh [DOCKER_USERNAME] [IMAGE_TAG]
#
# Defaults:
#   DOCKER_USERNAME = (from `docker info` or prompt)
#   IMAGE_TAG       = latest
# ──────────────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── Config ───────────────────────────────────────────────────
DOCKER_USERNAME="${1:-}"
IMAGE_TAG="${2:-latest}"
IMAGE_NAME="token-leaderboard"

# ── Detect or prompt for Docker username ─────────────────────
if [ -z "$DOCKER_USERNAME" ]; then
  if command -v docker &>/dev/null; then
    DOCKER_USERNAME=$(docker info 2>/dev/null | grep Username | awk '{print $2}' || true)
  fi
  if [ -z "$DOCKER_USERNAME" ]; then
    read -r -p "Enter Docker Hub username: " DOCKER_USERNAME
  fi
fi

FULL_IMAGE="${DOCKER_USERNAME}/${IMAGE_NAME}:${IMAGE_TAG}"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║   Token Leaderboard — Docker Build & Publish             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  Image:   ${FULL_IMAGE}"
echo "  Context: ${REPO_ROOT}/server"
echo ""

# ── 1. Build Docker image ───────────────────────────────────
echo "▸ Step 1/5: Building Docker image..."
docker build -t "${FULL_IMAGE}" -t "${DOCKER_USERNAME}/${IMAGE_NAME}:latest" \
  -f "${REPO_ROOT}/server/Dockerfile" "${REPO_ROOT}/server"
echo "  ✓ Build complete"
echo ""

# ── 2. Test the image runs ────────────────────────────────────
echo "▸ Step 2/5: Testing image starts correctly..."
CONTAINER_ID=$(docker run -d -p 3457:3456 "${FULL_IMAGE}")
sleep 3
if curl -sf http://localhost:3457/api/leaderboard > /dev/null 2>&1; then
  echo "  ✓ Server responded OK"
else
  echo "  ! Server did not respond — checking logs..."
  docker logs "$CONTAINER_ID" 2>&1 || true
  docker rm -f "$CONTAINER_ID" >/dev/null 2>&1
  echo "  ✗ Test failed. Aborting."
  exit 1
fi
docker rm -f "$CONTAINER_ID" >/dev/null 2>&1
echo "  ✓ Container test passed"
echo ""

# ── 3. Push to Docker Hub ─────────────────────────────────────
echo "▸ Step 3/5: Pushing to Docker Hub..."
docker push "${FULL_IMAGE}"
docker push "${DOCKER_USERNAME}/${IMAGE_NAME}:latest"
echo "  ✓ Push complete"
echo ""

# ── 4. Git commit ─────────────────────────────────────────────
echo "▸ Step 4/5: Committing and pushing to GitHub..."
cd "$REPO_ROOT"

# Stage any new/changed files (Dockerfile, this script, etc.)
git add -A

# Check if there's anything to commit
if git diff --cached --quiet; then
  echo "  Nothing new to commit."
else
  git commit -m "Add Docker support for server deployment"
  echo "  ✓ Committed"
fi

echo ""

# Push to GitHub
if git remote -v | grep -q origin; then
  git push origin main
  echo "  ✓ Pushed to GitHub"
else
  echo "  ! No git remote 'origin' configured."
  echo "    Create a repo on GitHub and run:"
  echo "      git remote add origin git@github.com:YOUR_USER/token-leaderboard.git"
  echo "      git push -u origin main"
fi
echo ""

# ── 5. Summary ────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   Done!                                                  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  Docker Hub:  ${FULL_IMAGE}"
echo "  GitHub:      $(git remote get-url origin 2>/dev/null || echo '(set up remote)')"
echo ""
echo "  Run anywhere:"
echo "    docker run -d -p 3456:3456 ${FULL_IMAGE}"
echo ""
echo "  Then point your CLI at the server URL and upload."
echo ""