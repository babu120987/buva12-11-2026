#!/usr/bin/env bash
# Run on the Oracle VM:  cd ~/buva && sudo bash vm-install.sh
set -euo pipefail
cd "$(dirname "$0")"
[ "$(id -u)" = 0 ] || { echo "Run with sudo."; exit 1; }
say(){ printf '\n== %s\n' "$*"; }

say "Swap (needed on 1 GB)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -q vm.swappiness=30; echo 'vm.swappiness=30' > /etc/sysctl.d/90-buva.conf
swapon --show

say "Docker"
command -v docker >/dev/null || { apt-get update -q && apt-get install -y -q docker.io; }
if ! docker compose version >/dev/null 2>&1; then
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
    https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi
docker compose version

say "Settings"
if [ -f buva.env ]; then mv buva.env .env; fi
[ -f .env ] || { echo "Missing .env (send it from WSL with wsl-export.sh)."; exit 1; }
chmod 600 .env

say "Network shared with Nginx Proxy Manager"
docker network inspect buva-proxy >/dev/null 2>&1 || docker network create buva-proxy >/dev/null
NPM="$(docker ps --format '{{.Names}} {{.Image}}' | awk '/nginx-proxy-manager/{print $1; exit}')"
if [ -n "$NPM" ]; then
  docker network connect buva-proxy "$NPM" 2>/dev/null || true
  echo "Connected $NPM to buva-proxy"
else
  echo "WARNING: Nginx Proxy Manager container not found - connect it later: docker network connect buva-proxy <name>"
fi

say "Pulling images (private - needs a GitHub token with read:packages)"
if ! docker compose pull 2>/dev/null; then
  echo "Log in to GitHub Container Registry. Username: babu120987   Password: your token (not shown as you type)"
  docker login ghcr.io -u babu120987
  docker compose pull
fi

say "Database"
docker compose up -d db
# first start: Postgres sets up, restarts once, then is ready - wait for 3 good answers in a row
ok=0; for i in $(seq 1 90); do
  if docker exec buva-db psql -U buva -d buva -tAc 'select 1' >/dev/null 2>&1; then ok=$((ok+1)); [ $ok -ge 3 ] && break; else ok=0; fi; sleep 2
done
HAS="$(docker exec buva-db psql -U buva -d buva -tAc "select to_regclass('public.products') is not null")"
if [ "$HAS" != "t" ]; then
  [ -f buva.dump ] || { echo "Empty database and no buva.dump - send the data from WSL first."; exit 1; }
  echo "Restoring your shop data..."
  docker exec -i buva-db pg_restore -U buva -d buva --no-owner --no-privileges < buva.dump \
    || echo "(pg_restore printed warnings - checking the data below)"
else
  echo "Database already has data - not restoring again."
fi
docker exec buva-db psql -U buva -d buva -tAc \
  "select 'products: '||(select count(*) from products)||'   orders: '||(select count(*) from orders)||'   customers: '||(select count(*) from customers)"

say "Uploaded photos"
if [ -f uploads.tgz ]; then
  docker volume create buva_uploads >/dev/null
  if [ -z "$(docker run --rm -v buva_uploads:/u alpine ls -A /u)" ]; then
    docker run --rm -i -v buva_uploads:/u alpine sh -c 'tar xzf - -C /u && chown -R 1000:1000 /u' < uploads.tgz
    echo "Photos restored."
  else
    echo "Photos already there - skipped."
  fi
fi

say "Starting the shop"
docker compose up -d
for i in $(seq 1 45); do curl -fs http://127.0.0.1:9091/health >/dev/null 2>&1 && break; sleep 2; done
if curl -fs http://127.0.0.1:9091/health >/dev/null; then echo "Shop is up on the VM."; else echo "Shop didn't answer yet - see: docker compose logs --tail 50 api"; fi

say "Nightly backup (02:30 India time, keeps 7 days)"
chmod +x backup.sh
echo "0 21 * * * root $(pwd)/backup.sh >> /var/log/buva-backup.log 2>&1" > /etc/cron.d/buva-backup
mkdir -p backups && chmod 700 backups
[ -f buva.dump ] && mv buva.dump "backups/moved-from-wsl.dump"
[ -f uploads.tgz ] && mv uploads.tgz "backups/moved-from-wsl-uploads.tgz"

say "Memory now"
free -m
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}'
echo
echo "Next: in Nginx Proxy Manager, edit buva.shop -> Forward Hostname: buva-web  Port: 80"
