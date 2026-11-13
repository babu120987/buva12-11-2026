# Deploying BUVA to Kubernetes

Images are built by GitHub Actions (`.github/workflows/build-images.yml`) on every push to `main`:

| Image | Contents |
|---|---|
| `ghcr.io/babu120987/buva12-11-2026-web` | Nginx + storefront, `/admin`, invoice pages |
| `ghcr.io/babu120987/buva12-11-2026-api` | BUVA Node API |
| `ghcr.io/babu120987/buva12-11-2026-db`  | Postgres 16 + DR backup + migrations — **contains customer data, keep private** |

If your repo is not named `babu120987/buva12-11-2026`, change the three `image:` lines in
`db.yaml`, `api.yaml` and `web.yaml` to `ghcr.io/<owner>/<repo>-db|api|web`.

## 1. One-time setup on the cluster

```bash
kubectl apply -f k8s/namespace.yaml

# a) Pull secret for the private images
#    GitHub → Settings → Developer settings → Personal access tokens (classic) → scope: read:packages
kubectl -n buva create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io --docker-username=babu120987 --docker-password=<PAT>

# b) App secrets — straight from your .env (DB_PASSWORD, ADMIN_API_KEY, RAZORPAY_*, GOOGLE_*, GMAIL_*)
kubectl -n buva create secret generic buva-secrets --from-env-file=.env
```

Requirements already on your old cluster: nginx ingress controller, `local-path` storage class,
cert-manager with the `letsencrypt-prod` ClusterIssuer.

## 2. Deploy

```bash
kubectl apply -k k8s/
kubectl -n buva get pods -w        # buva-db-0, buva-api-…, buva-web-… → Running / Ready
```

First start restores the 22 Aug 2026 backup into the new `data-buva-db-0` volume (≈10 s).

## 3. Update after a code change

Push to `main` → wait for the **Build images** action to finish → then:

```bash
kubectl -n buva rollout restart deployment/buva-api deployment/buva-web
```

## 4. Change a secret (e.g. add Razorpay keys)

```bash
kubectl -n buva create secret generic buva-secrets --from-env-file=.env \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n buva rollout restart deployment/buva-api
```
`DB_PASSWORD` is only read when the database volume is first created — don't change it afterwards.

## Useful

```bash
kubectl -n buva logs deploy/buva-api -f
kubectl -n buva exec -it buva-db-0 -- psql -U buva -d buva
kubectl -n buva exec buva-db-0 -- pg_dump -U buva -Fc buva > buva-$(date +%F).dump    # backup
kubectl -n buva port-forward svc/web 9090:80                                           # test without ingress
```

## Public access options

- **Ingress on a public IP** — point `buva.shop` DNS at the ingress controller; cert-manager issues HTTPS.
- **Through Oracle NPM + Tailscale** (no open ports) — in NPM, forward `buva.shop` to the ingress
  node's Tailscale IP, port 80, with `proxy_set_header Host buva.shop;`. Then delete the `tls`
  block and cert-manager annotation from `ingress.yaml` (NPM handles the certificate).
