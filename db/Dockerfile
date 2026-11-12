# Postgres with the BUVA DR backup + migrations baked in.
# On first start (empty volume) it restores the 22 Aug 2026 data, then applies migrations 001-007.
# Contains customer data: keep this image PRIVATE.
FROM postgres:16-alpine
COPY initdb/ /docker-entrypoint-initdb.d/
