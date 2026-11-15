# BUVA — buva.shop (3-tier Docker)

New plum-and-gold storefront on top of your **existing BUVA backend**, restored from the
**22 Aug 2026 DR backup**.

```
Browser ─▶ web  (Nginx)        Tier 1 · new storefront, /admin panel, invoice pages      :9090
             │ /api, /uploads
             ▼
           api  (Node/Express)  Tier 2 · your BUVA API (unchanged): carts, checkout, Razorpay,
             │                           accounts, Google sign-in, invoices, admin, emails
             ▼
           db   (PostgreSQL 16) Tier 3 · DR data + migrations 001–007
```

## What's included

| Area | Source |
|---|---|
| 9 products, 4 categories, stock, coupon `WELCOME10`, 7 customers, 6 orders | DR backup `buva-postgres.sql.gz` (22 Aug 2026) |
| API, invoices, order emails, migrations 001–006 | `github.com/babu120987/buva` (`backend/`) |
| Migration 007 `return_requests` | **New** — the table existed on the old server but was missing from the repo |
| Admin panel `/admin`, invoice pages, product photos, favicons | `github.com/babu120987/buva` (`frontend/`) |
| Storefront `index.html`, `css/buva.css`, `js/buva.js` | **New design** |

Storefront features: catalogue from the API (family filter, search, sort), product details with
reviews, server-side bag, coupons, checkout (cash on delivery + Razorpay), accounts (email/phone
+ password, Google sign-in), orders with status, courier tracking, invoices, reviews and return
requests, wishlist, saved addresses, profile, support tickets, newsletter, AI assistant, scent finder.

Old links keep working: `product.html?slug=x` → `/?product=x`, `about.html` → `/#story`,
`contact.html` → `/#contact`, and `bhuva.duckdns.org` → `https://buva.shop` (same path).

## Shopping features (added 13 Nov 2026)

| Shoppers see | Managed in |
|---|---|
| **Photo gallery** with hover zoom and full-screen viewer | Admin → Offers & catalogue → Photos & sizes |
| **Size options** (30 / 50 / 100 ml) — each size is its own product with its own price and stock, linked by a *size group* | Main admin (create the size) + Photos & sizes (set the group) |
| **Frequently bought together** (real co-purchases, then top picks) with "Add all to bag"; **You may also like**; **Recently viewed** | Automatic |
| **Search suggestions** as you type; filters for price, rating, in stock, on deal | Automatic |
| **Reviews**: star breakdown, verified-buyer badge, photos, "helpful" votes, sort and filter | Main admin → Reviews (approve); review photos under Offers & catalogue |
| **Deals** with countdown — price drops at the start and is restored automatically at the end | Offers & catalogue → Deals |
| **Combo offers** ("Buy any 2, save 10%"), applied automatically with an "add 1 more" nudge | Offers & catalogue → Combo offers |
| **Coupons listed in the bag** with one-tap Apply | Main admin → Marketing (create) + Offers & catalogue → Coupons in bag |
| **Back-in-stock and price-drop emails**, plus price-drop emails for wishlisted perfumes | Automatic (needs Gmail in `.env`) |
| **Gift wrap** with a message at checkout | `GIFT_WRAP_FEE_PAISE` in `.env` |
| **BUVA points**: earned when an order is delivered, redeemable at checkout, returned on cancellation | `POINTS_*` in `.env`; manual adjustments under Points & alerts |

The bag preview and checkout use the same server-side pricing (`backend/commerce.js`), so the
total shown is always the total charged. Gift wrap is invoiced under shipping & handling.

**Upgrading an existing database** (your data is kept): migration 008 runs automatically only on
a fresh volume. On a database that's already running, apply it once:
```bash
docker compose exec -T db psql -U buva -d buva < backend/migrations/008_commerce_features.sql
docker compose up -d --build
```

## BUVA Assistant knowledge (added 15 Nov 2026)

- **Admin → Assistant knowledge** (`/admin/knowledge.html`): add, edit, switch off or delete the shop documents the assistant answers from (delivery, returns, payments, points, invoices, care, contact). Drop in `.txt`/`.md` files, or paste text from Word/PDF. "Try a question" shows exactly what shoppers will get.
- Ten drafts are added on the first start, marked **Needs your check**. They're written only from the shop's own settings and website text.
- With `GEMINI_API_KEY` set, Gemini writes short answers (in the shopper's language) from those documents plus the live catalogue. Without it, or if Gemini fails, the best-matching paragraph is shown. Product prices, notes and stock always come from the live catalogue.
- Documents live in the `knowledge_documents` table, so the nightly database backup includes them. AI answers are limited to 12 a minute per visitor and 300 an hour in total.

## Kubernetes

See **[k8s/README.md](k8s/README.md)** — GitHub Actions builds private images to GHCR on every
push to `main`; deploy with `kubectl apply -k k8s/`.

> This repository contains the DR backup with customer data (`db/initdb/00-dr-backup-20260822.sql`).
> Keep the repository **and** its GHCR packages **private**.

## Run it (WSL)

1. **Stop the earlier demo** — it uses the same port 9090:
   ```bash
   cd ~/buva && docker compose down
   ```
2. **Start BUVA:**
   ```bash
   cd ~/buva-shop
   cp .env.example .env
   nano .env            # set DB_PASSWORD, ADMIN_API_KEY at minimum
   docker compose up -d --build
   docker compose ps    # db (healthy), api (healthy), web (running)
   ```
3. Open **http://localhost:9090** — admin panel at **http://localhost:9090/admin/** (sign in with `ADMIN_API_KEY`).

The first start restores the DR backup automatically (takes ~10 s). Your existing Tailscale
Funnel (`localhost:9090`) and Oracle NPM forwarding keep working unchanged.

## Secrets in `.env`

| Setting | Needed for | Where to get it |
|---|---|---|
| `DB_PASSWORD`, `ADMIN_API_KEY` | always | make up long random values |
| `RAZORPAY_KEY_ID` / `_SECRET` | online payments (otherwise COD only) | Razorpay Dashboard → API Keys |
| `RAZORPAY_WEBHOOK_SECRET` | payment webhooks | Razorpay → Webhooks → URL `https://buva.shop/api/payments/razorpay/webhook`, events `payment.captured`, `payment.failed`, `payment.refunded` |
| `GOOGLE_CLIENT_ID` / `_SECRET` | "Continue with Google" | Google Cloud Console → OAuth client; redirect URI `https://buva.shop/api/auth/google/callback` |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | order & support emails | Google Account → Security → App passwords |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | push notifications (optional) | Firebase project `buva-90d4b` |

After editing `.env`: `docker compose up -d` (restarts the API with the new values).

## Domain: buva.shop

1. DNS: point `buva.shop` (A record) to your Oracle VM `140.238.249.9`.
2. Nginx Proxy Manager → Proxy Host `buva.shop`: forward to `access.tail58b685.ts.net`,
   scheme **https**, port **443**, with these lines on the **Advanced** tab:
   ```nginx
   proxy_set_header Host access.tail58b685.ts.net;
   proxy_ssl_server_name on;
   proxy_ssl_name access.tail58b685.ts.net;
   ```
   (Funnel only answers to its own `ts.net` name, so the Host header must stay as above.)
   SSL tab → request a Let's Encrypt certificate, Force SSL.
3. Old domain: in NPM delete the `bhuva.duckdns.org` proxy host and add it under
   **Hosts → Redirection Hosts** instead: forward domain `buva.shop`, scheme `https`,
   HTTP code `301`, **Preserve Path** on, with its own Let's Encrypt certificate.
   Old links like `bhuva.duckdns.org/product.html?slug=rose-oud` then land on the right product.

## Day-to-day

```bash
docker compose logs -f api                                   # API logs
docker compose exec db psql -U buva -d buva                  # SQL shell
docker compose exec db pg_dump -U buva -Fc buva > buva-$(date +%F).dump   # backup
docker compose down        # stop (data kept)
docker compose down -v     # stop AND wipe DB + uploads (re-restores the DR backup next start)
```

Restore a newer dump (e.g. the 26 Sep `buva-production.dump`) instead of the DR backup:
```bash
docker compose down -v && docker compose up -d db && sleep 10
docker compose exec -T db pg_restore -U buva -d buva --clean --if-exists --no-owner < buva-production.dump
docker compose exec -T db psql -U buva -d buva < backend/migrations/007_return_requests.sql
docker compose up -d
```

## Known gaps

- **Data is from 22 Aug 2026.** Products added later (Boss Girl, Gentle Man, Berry…) and
  September orders/customers aren't in it — restore a newer dump to get them.
- `perfume.jpg` (default image for new admin products) shows a **Guerlain** bottle — replace it
  with a BUVA image, or always upload a photo when adding a product.
- Browser push opt-in (Firebase) isn't shown on the new storefront yet; order emails still work.
- Products using the same photo (e.g. Royal Tuberose / Madurai Jasmine) — upload individual
  photos from **Admin → Products** when ready.
