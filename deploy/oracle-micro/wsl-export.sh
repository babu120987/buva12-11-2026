#!/usr/bin/env bash
# Run in WSL from your BUVA folder (the one with docker-compose.yml and .env):
#   bash deploy/oracle-micro/wsl-export.sh
# Pauses the shop here, copies the live database + uploaded photos + .env, and sends them
# to the Oracle VM over Tailscale. Undo with:  docker compose start api web
set -euo pipefail
TARGET="${1:-webserver}"
[ -f docker-compose.yml ] && [ -f .env ] || { echo "Run this from the BUVA folder (needs docker-compose.yml and .env)."; exit 1; }
KIT="deploy/oracle-micro"
tailscale status >/dev/null 2>&1 || { echo "Tailscale isn't running in WSL."; exit 1; }
tailscale status | grep -qw "$TARGET" || { echo "Can't see '$TARGET' on your tailnet. Finish step 1 on the VM first."; exit 1; }

WORK="$(mktemp -d)"; OUT="$WORK/buva-move"; mkdir -p "$OUT"; trap 'rm -rf "$WORK"' EXIT
echo "1/4 Pausing the shop on this PC (no new orders during the move)..."
docker compose stop web api
echo "2/4 Copying the database..."
docker compose exec -T db pg_dump -U buva -d buva -Fc > "$OUT/buva.dump"
[ -s "$OUT/buva.dump" ] || { echo "Database copy is empty - stopping. Restart the shop with: docker compose start api web"; exit 1; }
UPVOL="$(docker volume ls -q | grep -E '(^|_)buva_uploads$' | head -1 || true)"
if [ -n "$UPVOL" ]; then
  echo "3/4 Copying uploaded photos ($UPVOL)..."
  docker run --rm -v "$UPVOL":/u:ro alpine tar czf - -C /u . > "$OUT/uploads.tgz"
else
  echo "3/4 No uploads volume found - skipping photos."
fi
cp .env "$OUT/buva.env"
cp "$KIT/docker-compose.yml" "$KIT/vm-install.sh" "$KIT/backup.sh" "$OUT/"
tar czf "$WORK/buva-move.tgz" -C "$WORK" buva-move
echo "4/4 Sending to $TARGET over Tailscale (encrypted)..."
sudo tailscale file cp "$WORK/buva-move.tgz" "$TARGET:"
echo
echo "Sent ($(du -h "$WORK/buva-move.tgz" | cut -f1)). The shop on this PC stays paused."
echo "If you need to go back:  docker compose start api web"
