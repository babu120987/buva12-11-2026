#!/usr/bin/env bash
# Nightly copy of the BUVA database and uploaded photos. Keeps 7 days.
set -euo pipefail
B="$(dirname "$(readlink -f "$0")")/backups"; mkdir -p "$B"; chmod 700 "$B"
TS="$(date +%Y%m%d-%H%M)"
docker exec buva-db pg_dump -U buva -d buva -Fc > "$B/buva-$TS.dump"
docker run --rm -v buva_uploads:/u:ro alpine tar czf - -C /u . > "$B/uploads-$TS.tgz"
chmod 600 "$B"/*
find "$B" -type f -name 'buva-2*' -mtime +7 -delete
find "$B" -type f -name 'uploads-2*' -mtime +7 -delete
echo "$(date) backup ok: buva-$TS.dump"
