/* BUVA storefront — talks to the BUVA Node API at /api */
(() => {
"use strict";

/* ---------------- helpers ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (paise) => "₹" + (Number(paise || 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const label = (v) => String(v || "").replaceAll("_", " ");
const fmtDate = (v) => new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const FREE_DELIVERY = 150000, DELIVERY_FEE = 9900;   // mirrors the API (₹1,500 / ₹99)
const TOKEN_KEY = "buvaCustomerToken";                // same key as invoices.html
const CART_KEY = "buvaCartToken";

const store = {
  get(k, area = localStorage) { try { return area.getItem(k); } catch { return null; } },
  set(k, v, area = localStorage) { try { area.setItem(k, v); } catch {} },
  del(k, area = localStorage) { try { area.removeItem(k); } catch {} },
};
const getToken = () => store.get(TOKEN_KEY, sessionStorage) || store.get(TOKEN_KEY) || "";
const setToken = (t) => { store.set(TOKEN_KEY, t, sessionStorage); store.set(TOKEN_KEY, t); };
const clearToken = () => { store.del(TOKEN_KEY, sessionStorage); store.del(TOKEN_KEY); };

async function api(path, opts = {}) {
  try { return await apiOnce(path, opts); }
  catch (err) {
    // an expired session shouldn't block guest actions such as checkout or support
    if (err.status === 401 && opts.auth === "optional" && getToken()) { clearToken(); state.account = null; updateBadges(); return apiOnce(path, opts); }
    throw err;
  }
}
async function apiOnce(path, { method = "GET", body, auth = false } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token && (auth || auth === "optional")) headers.Authorization = "Bearer " + token;
  const res = await fetch("/api" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return null;
  let data = null; try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error((data && data.error) || `Something went wrong (${res.status})`);
    err.status = res.status;
    if (res.status === 401 && token && auth === true) { clearToken(); state.account = null; updateBadges(); }
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600); }

/* product image: use the light .webp copy for bundled photos, fall back to original */
function picture(url, alt, cls = "") {
  if (!url) return bottleSvg();
  const webp = /^\/img\/buva\/[a-z0-9-]+\.png$/.test(url) ? url.replace(/\.png$/, ".webp") : null;
  const img = `<img src="${esc(url)}" alt="${esc(alt || "")}" loading="lazy" class="${cls}" onerror="this.onerror=null;this.replaceWith(document.createRange().createContextualFragment(window.__buvaBottle()))">`;
  return webp ? `<picture><source srcset="${esc(webp)}" type="image/webp">${img}</picture>` : img;
}
function bottleSvg() {
  return `<svg viewBox="0 0 120 220" aria-hidden="true"><rect x="44" y="8" width="32" height="40" rx="3" fill="#1d1417"/><rect x="50" y="48" width="20" height="12" fill="#2b2023"/><rect x="22" y="60" width="76" height="152" rx="10" fill="#c9a36b" opacity=".85"/><rect x="34" y="118" width="52" height="36" rx="2" fill="#f2eadf"/><text x="60" y="140" text-anchor="middle" font-family="Cormorant Garamond,serif" font-size="12" letter-spacing="3" fill="#3a1f2b">BUVA</text></svg>`;
}
window.__buvaBottle = bottleSvg;
const heartSvg = `<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>`;
const stars = (r) => { const n = Math.round(r); return "★".repeat(n) + "☆".repeat(5 - n); };

/* ---------------- state ---------------- */
const state = {
  products: [], categories: [],
  filter: { family: "all", q: "", sort: "featured", price: "any", minRating: 0, inStock: false, onDeal: false },
  cart: null, account: null, razorpay: { configured: false, keyId: null },
  couponCode: null, quote: null, offers: { combos: [], deals: [], giftWrapFeePaise: 4900, points: {} },
  checkout: { giftWrap: false, giftMessage: "", usePoints: false },
};
const wished = (id) => !!state.account?.wishlist?.some((w) => Number(w.productId) === Number(id));
const famName = (slug) => state.categories.find((c) => c.slug === slug)?.name || label(slug);
const RECENT_KEY = "buvaRecentlyViewed";
const recent = {
  list() { try { return JSON.parse(store.get(RECENT_KEY) || "[]").filter((x) => typeof x === "string").slice(0, 12); } catch { return []; } },
  add(slug) { store.set(RECENT_KEY, JSON.stringify([slug, ...recent.list().filter((x) => x !== slug)].slice(0, 12))); },
};

/* live countdowns for deals: any element with data-ends="<ISO time>" */
function timeLeft(iso) {
  const ms = new Date(iso) - Date.now();
  if (!(ms > 0)) return "Deal ended";
  const d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24, m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return d ? `Ends in ${d}d ${h}h` : h ? `Ends in ${h}h ${m}m` : `Ends in ${m}m ${String(sec).padStart(2, "0")}s`;
}
setInterval(() => $$("[data-ends]").forEach((el) => { el.textContent = timeLeft(el.dataset.ends); }), 1000);

/* ---------------- overlays ---------------- */
function openModal(html, narrow = false) {
  $("#mbox").className = "mbox" + (narrow ? " narrow" : "");
  $("#mbox").innerHTML = `<button class="close" data-close aria-label="Close">×</button>` + html;
  $("#modal").classList.add("show"); $("#overlay").classList.add("show"); document.body.style.overflow = "hidden";
  $("#cartDrawer").classList.remove("show");
}
function closeAll() {
  $("#modal").classList.remove("show"); $("#cartDrawer").classList.remove("show"); $("#overlay").classList.remove("show");
  document.body.style.overflow = "";
  if (location.hash === "#account") history.replaceState(null, "", location.pathname + location.search);
}
document.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeAll(); });
$("#overlay").addEventListener("click", closeAll);
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeAll(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeAll(); $("#ask").classList.remove("open"); } });

/* ---------------- catalogue ---------------- */
const PRICE_BANDS = { any: [null, null], u1500: [null, 149999], b1500: [150000, 250000], a2500: [250001, null] };
async function loadCatalogue() {
  const f = state.filter, qs = new URLSearchParams({ sort: f.sort });
  if (f.family !== "all" && f.family !== "wishlist") qs.set("family", f.family);
  if (f.q) qs.set("q", f.q);
  const [min, max] = PRICE_BANDS[f.price] || PRICE_BANDS.any;
  if (min !== null) qs.set("minPrice", min);
  if (max !== null) qs.set("maxPrice", max);
  if (f.minRating) qs.set("minRating", f.minRating);
  if (f.inStock) qs.set("inStock", "true");
  if (f.onDeal) qs.set("onDeal", "true");
  const { products } = await api("/products?" + qs);
  return products;
}

async function renderGrid() {
  const grid = $("#grid");
  grid.innerHTML = Array.from({ length: 4 }, () => `<div class="card skeleton"><div class="media"></div><div class="line" style="width:60%"></div><div class="line" style="width:85%"></div></div>`).join("");
  let list;
  try {
    list = await loadCatalogue();
  } catch (err) {
    grid.innerHTML = `<div class="empty">Couldn't load fragrances (${esc(err.message)}). Please refresh.</div>`; return;
  }
  if (state.filter.family === "wishlist") list = list.filter((p) => wished(p.id));
  $("#count").textContent = `${list.length} ${list.length === 1 ? "fragrance" : "fragrances"}`;
  const active = activeFilterCount();
  $("#clearFilters").hidden = !active;
  grid.innerHTML = list.length ? list.map(cardHtml).join("") : `<div class="empty">No fragrances match${active ? " these filters" : ""}. ${active ? `<button class="linkbtn" data-clear-filters>Clear filters</button>` : "Try another family or search."}</div>`;
}
const activeFilterCount = () => ["price", "minRating", "inStock", "onDeal"].filter((k) => k === "price" ? state.filter.price !== "any" : !!state.filter[k]).length;

function cardHtml(p) {
  const out = p.availableQuantity <= 0;
  const deal = !out && p.dealEndsAt && new Date(p.dealEndsAt) > Date.now();
  const off = p.compareAtPricePaise > p.pricePaise ? Math.round((1 - p.pricePaise / p.compareAtPricePaise) * 100) : 0;
  const tag = out ? `<span class="tag soldout">Sold out</span>` : deal ? `<span class="tag deal">${off ? `${off}% off · ` : ""}Deal</span>` : off ? `<span class="tag">${off}% off</span>` : p.featured ? `<span class="tag">Signature</span>` : "";
  return `<article class="card">
    <div class="media" data-open="${esc(p.slug)}">${tag}${picture(p.imageUrl, p.imageAlt || p.name)}
      ${out ? `<button class="quick notify" data-open="${esc(p.slug)}">Notify me</button>` : `<button class="quick" data-add="${p.id}">Add to bag · ${inr(p.pricePaise)}</button>`}
    </div>
    <button class="wish ${wished(p.id) ? "on" : ""}" data-wish="${p.id}" aria-label="Save ${esc(p.name)} to wishlist" aria-pressed="${wished(p.id)}">${heartSvg}</button>
    <div class="info">
      <div class="fam-label">${esc(famName(p.scentFamily))} · ${esc(p.concentration)} · ${p.sizeMl} ml${p.variantGroup ? " · more sizes" : ""}</div>
      <h4 data-open="${esc(p.slug)}">${esc(p.name)}</h4>
      <div class="notes">${esc(p.shortDescription || "")}</div>
      <div class="row"><span class="price">${inr(p.pricePaise)}${p.compareAtPricePaise > p.pricePaise ? `<s>${inr(p.compareAtPricePaise)}</s>` : ""}</span>
        ${p.reviewCount ? `<span class="stars">${stars(p.averageRating)}<small>(${p.reviewCount})</small></span>` : ""}</div>
      ${deal ? `<div class="deal-timer" data-ends="${esc(p.dealEndsAt)}">${timeLeft(p.dealEndsAt)}</div>` : ""}
      ${!out && p.availableQuantity <= 5 ? `<div class="low">Only ${p.availableQuantity} left</div>` : ""}
    </div></article>`;
}

/* every product grid on the page shares one click handler */
function onCardsClick(e) {
  const add = e.target.closest("[data-add]"), w = e.target.closest("[data-wish]"), o = e.target.closest("[data-open]"), clr = e.target.closest("[data-clear-filters]");
  if (clr) { clearFilters(); return; }
  if (add) { e.stopPropagation(); addToCart(add.dataset.add, 1, add); return; }
  if (w) { toggleWish(w.dataset.wish); return; }
  if (o) openProduct(o.dataset.open);
}
["#grid", "#dealsGrid", "#recentGrid"].forEach((sel) => { const el = $(sel); if (el) el.addEventListener("click", onCardsClick); });

/* filters */
function syncFilterInputs() {
  $("#fPrice").value = state.filter.price; $("#fRating").value = String(state.filter.minRating);
  $("#fStock").checked = state.filter.inStock; $("#fDeal").checked = state.filter.onDeal;
}
function clearFilters() { Object.assign(state.filter, { price: "any", minRating: 0, inStock: false, onDeal: false }); syncFilterInputs(); renderGrid(); }
$("#fPrice").addEventListener("change", (e) => { state.filter.price = e.target.value; renderGrid(); });
$("#fRating").addEventListener("change", (e) => { state.filter.minRating = Number(e.target.value); renderGrid(); });
$("#fStock").addEventListener("change", (e) => { state.filter.inStock = e.target.checked; renderGrid(); });
$("#fDeal").addEventListener("change", (e) => { state.filter.onDeal = e.target.checked; renderGrid(); });
$("#clearFilters").addEventListener("click", clearFilters);

function renderChips() {
  const chips = [{ slug: "all", name: "All" }, ...state.categories];
  $("#chips").innerHTML = chips.map((c) => `<button class="chip ${state.filter.family === c.slug ? "active" : ""}" data-f="${esc(c.slug)}">${esc(c.name)}</button>`).join("")
    + (state.account?.wishlist?.length ? `<button class="chip ${state.filter.family === "wishlist" ? "active" : ""}" data-f="wishlist">♥ Wishlist (${state.account.wishlist.length})</button>` : "");
}
$("#chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-f]"); if (!b) return;
  state.filter.family = b.dataset.f; renderChips(); renderGrid();
});
$("#sortSel").addEventListener("change", (e) => { state.filter.sort = e.target.value; renderGrid(); });

function showFamily(slug) {
  state.filter.family = slug; state.filter.q = ""; $("#searchInput").value = "";
  renderChips(); renderGrid(); document.getElementById("shop").scrollIntoView();
}
document.addEventListener("click", (e) => { const b = e.target.closest("button[data-family]"); if (b) showFamily(b.dataset.family); });

function renderFamilies(allProducts) {
  $("#famGrid").innerHTML = state.categories.map((c) => {
    const p = allProducts.find((x) => x.scentFamily === c.slug && x.imageUrl) || {};
    return `<button class="fam" data-family="${esc(c.slug)}">${picture(p.imageUrl, c.name)}
      <small>${c.productCount} ${c.productCount === 1 ? "fragrance" : "fragrances"}</small><h3>${esc(c.name)}</h3><span>${esc(c.description || "")}</span></button>`;
  }).join("");
}

/* search with suggestions */
let searchTimer, suggestTimer, suggestSeq = 0;
const suggestBox = $("#suggest");
$("#searchBtn").addEventListener("click", () => { const bar = $("#searchbar"); bar.classList.toggle("open"); if (bar.classList.contains("open")) setTimeout(() => $("#searchInput").focus(), 200); else hideSuggest(); });
function hideSuggest() { suggestBox.hidden = true; suggestBox.innerHTML = ""; }
function runSearch(q) {
  state.filter.q = q;
  if (q) { state.filter.family = "all"; renderChips(); document.getElementById("shop").scrollIntoView(); }
  renderGrid();
}
$("#searchInput").addEventListener("input", (e) => {
  const q = e.target.value.trim();
  clearTimeout(searchTimer); clearTimeout(suggestTimer);
  searchTimer = setTimeout(() => runSearch(q), 450);
  if (q.length < 2) { hideSuggest(); return; }
  suggestTimer = setTimeout(async () => {
    const seq = ++suggestSeq;
    let r; try { r = await api("/search/suggest?q=" + encodeURIComponent(q)); } catch { return; }
    if (seq !== suggestSeq) return;
    if (!r.products.length && !r.families.length) { suggestBox.innerHTML = `<div class="sg-empty">No matches for “${esc(q)}”</div>`; suggestBox.hidden = false; return; }
    suggestBox.innerHTML = r.products.map((p) => `<button class="sg-item" data-sg-product="${esc(p.slug)}"><span class="media">${picture(p.imageUrl, p.name)}</span><span><b>${esc(p.name)}</b><small>${p.sizeMl} ml · ${esc(p.shortDescription || "")}</small></span><em>${inr(p.pricePaise)}</em></button>`).join("")
      + r.families.map((f) => `<button class="sg-item sg-fam" data-sg-family="${esc(f.slug)}">See all <b>${esc(f.name)}</b> fragrances →</button>`).join("");
    suggestBox.hidden = false;
  }, 160);
});
$("#searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { clearTimeout(searchTimer); hideSuggest(); runSearch(e.target.value.trim()); }
  if (e.key === "Escape") hideSuggest();
  if (e.key === "ArrowDown") { const first = suggestBox.querySelector("button"); if (first) { e.preventDefault(); first.focus(); } }
});
suggestBox.addEventListener("keydown", (e) => {
  const items = $$("button", suggestBox), i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown" && i < items.length - 1) { e.preventDefault(); items[i + 1].focus(); }
  if (e.key === "ArrowUp") { e.preventDefault(); (i > 0 ? items[i - 1] : $("#searchInput")).focus(); }
  if (e.key === "Escape") { hideSuggest(); $("#searchInput").focus(); }
});
suggestBox.addEventListener("click", (e) => {
  const p = e.target.closest("[data-sg-product]"), f = e.target.closest("[data-sg-family]");
  if (p) { hideSuggest(); openProduct(p.dataset.sgProduct); }
  if (f) { hideSuggest(); $("#searchInput").value = ""; state.filter.q = ""; showFamily(f.dataset.sgFamily); }
});
document.addEventListener("click", (e) => { if (!e.target.closest("#searchbar")) hideSuggest(); });
$("#menuBtn").addEventListener("click", () => $("#navlinks").classList.toggle("open"));
$("#navlinks").addEventListener("click", () => $("#navlinks").classList.remove("open"));

/* ---------------- product detail ---------------- */
const miniCard = (p) => `<button class="mini" data-open-mini="${esc(p.slug)}"><span class="media">${picture(p.imageUrl, p.name)}</span><b>${esc(p.name)}</b><span class="price">${inr(p.pricePaise)}${p.compareAtPricePaise > p.pricePaise ? `<s>${inr(p.compareAtPricePaise)}</s>` : ""}</span>${p.reviewCount ? `<span class="stars">${stars(p.averageRating)}<small>(${p.reviewCount})</small></span>` : ""}</button>`;

let productSeq = 0;
async function openProduct(slug) {
  const seq = ++productSeq;
  let data, extras;
  try {
    [data, extras] = await Promise.all([
      api("/products/" + encodeURIComponent(slug)),
      api("/products/" + encodeURIComponent(slug) + "/extras").catch(() => ({ images: [], variants: [], boughtTogether: [], similar: [], reviewSummary: { total: 0, counts: {} }, deal: null })),
    ]);
  } catch (err) { toast(err.status === 404 ? "That fragrance is no longer available" : err.message); return; }
  if (seq !== productSeq) return;
  const p = data.product;
  const out = p.availableQuantity <= 0;
  const images = extras.images.length ? extras.images : [{ url: p.imageUrl, alt: p.imageAlt || p.name }];
  const together = extras.boughtTogether.filter((x) => x.availableQuantity > 0).slice(0, 2);
  const rv = { list: null, sort: "helpful", rating: 0, withPhotos: false };
  const ui = { q: 1, img: 0, alert: null, fbt: new Set([String(p.id), ...together.map((x) => String(x.id))]) };
  const seenCards = onePerPerfume(recent.list().map((sl) => state.products.find((x) => x.slug === sl)).filter((x) => x && x.slug !== slug && (!p.variantGroup || x.variantGroup !== p.variantGroup)));
  recent.add(slug);
  const off = p.compareAtPricePaise > p.pricePaise ? Math.round((1 - p.pricePaise / p.compareAtPricePaise) * 100) : 0;

  const reviewsBlock = () => {
    const sum = extras.reviewSummary;
    if (!sum.total) return `<div class="reviews-list"><h4>Ratings &amp; reviews</h4><p class="sub">No reviews yet. Customers can review after their order is delivered.</p></div>`;
    const bars = [5, 4, 3, 2, 1].map((n) => {
      const c = sum.counts[n] || 0, pct = sum.total ? Math.round((c / sum.total) * 100) : 0;
      return `<button class="bar ${rv.rating === n ? "on" : ""}" data-rv-rating="${n}"><span>${n}★</span><i><em style="width:${pct}%"></em></i><span>${c}</span></button>`;
    }).join("");
    const list = rv.list === null ? `<p class="sub">Loading reviews…</p>` : rv.list.length ? rv.list.map((r) => `
      <div class="rev">
        <div><span class="stars">${stars(r.rating)}</span> ${r.verifiedPurchase ? `<span class="verified">✓ Verified buyer</span>` : ""}</div>
        ${r.reviewText ? `<p>${esc(r.reviewText)}</p>` : ""}
        ${r.photos?.length ? `<div class="rev-photos">${r.photos.map((u) => `<button data-zoom="${esc(u)}"><img src="${esc(u)}" alt="Customer photo" loading="lazy"></button>`).join("")}</div>` : ""}
        <div class="sub">${esc(r.reviewerName)} · ${fmtDate(r.createdAt)} · <button class="helpful ${r.votedHelpful ? "on" : ""}" data-helpful="${esc(r.id)}" ${r.votedHelpful ? "disabled" : ""}>👍 Helpful${r.helpfulCount ? ` (${r.helpfulCount})` : ""}</button></div>
      </div>`).join("") : `<p class="sub">No reviews match.</p>`;
    return `<div class="reviews-list">
      <h4>Ratings &amp; reviews</h4>
      <div class="rv-summary"><div class="rv-avg"><b>${sum.average}</b><span class="stars">${stars(sum.average)}</span><small>${sum.total} rating${sum.total === 1 ? "" : "s"}</small></div><div class="bars">${bars}</div></div>
      <div class="rv-tools">
        <select id="rvSort" aria-label="Sort reviews"><option value="helpful" ${rv.sort === "helpful" ? "selected" : ""}>Most helpful</option><option value="newest" ${rv.sort === "newest" ? "selected" : ""}>Newest</option><option value="highest" ${rv.sort === "highest" ? "selected" : ""}>Highest rated</option><option value="lowest" ${rv.sort === "lowest" ? "selected" : ""}>Lowest rated</option></select>
        <label class="check" style="margin:0"><input type="checkbox" id="rvPhotos" ${rv.withPhotos ? "checked" : ""}> With photos</label>
        ${rv.rating ? `<button class="linkbtn" data-rv-rating="0">Show all ratings</button>` : ""}
      </div>${list}</div>`;
  };
  const loadReviews = async () => {
    if (!extras.reviewSummary.total) return;
    const qs = new URLSearchParams({ sort: rv.sort }); if (rv.rating) qs.set("rating", rv.rating); if (rv.withPhotos) qs.set("withPhotos", "1");
    try { rv.list = (await api(`/products/${encodeURIComponent(slug)}/reviews?${qs}`, { auth: "optional" })).reviews; } catch { rv.list = []; }
    const box = $("#rvBox"); if (box) { box.innerHTML = reviewsBlock(); wireReviews(); }
  };
  const wireReviews = () => {
    const box = $("#rvBox"); if (!box) return;
    $$("[data-zoom]", box).forEach((b) => b.onclick = () => openLightbox([b.dataset.zoom], 0));
    $$("[data-rv-rating]", box).forEach((b) => b.onclick = () => { const n = Number(b.dataset.rvRating); rv.rating = rv.rating === n ? 0 : n; rv.list = null; box.innerHTML = reviewsBlock(); wireReviews(); loadReviews(); });
    const so = $("#rvSort", box); if (so) so.onchange = () => { rv.sort = so.value; loadReviews(); };
    const ph = $("#rvPhotos", box); if (ph) ph.onchange = () => { rv.withPhotos = ph.checked; loadReviews(); };
    $$("[data-helpful]", box).forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try { const r = await api(`/reviews/${b.dataset.helpful}/helpful`, { method: "POST", auth: "optional" }); const item = rv.list.find((x) => x.id === b.dataset.helpful); if (item) { item.helpfulCount = r.helpfulCount; item.votedHelpful = true; } b.classList.add("on"); b.textContent = `👍 Helpful (${r.helpfulCount})`; }
      catch (ex) { b.disabled = false; toast(ex.message); }
    });
  };

  const alertForm = (kind) => `<form class="alert-form" id="alertForm">
      <label for="alEmail">${kind === "back_in_stock" ? "Email me when it's back in stock" : "Email me if the price drops below " + inr(p.pricePaise)}</label>
      <div class="promo"><input id="alEmail" type="email" required placeholder="Your email" value="${esc(state.account?.customer?.email || "")}"><button type="submit">Notify me</button></div>
      <div class="msg" id="alMsg" role="status"></div></form>`;

  const fbtBlock = () => {
    if (!together.length) return "";
    const items = [p, ...together];
    const chosen = items.filter((x) => ui.fbt.has(String(x.id)));
    const total = chosen.reduce((s2, x) => s2 + x.pricePaise, 0);
    return `<div class="fbt"><h4>Frequently bought together</h4>
      <div class="fbt-row">${items.map((x, k) => `${k ? `<span class="plus">+</span>` : ""}<span class="fbt-img ${ui.fbt.has(String(x.id)) ? "" : "off"}">${picture(x.imageUrl, x.name)}</span>`).join("")}</div>
      ${items.map((x, k) => `<label class="check fbt-item"><input type="checkbox" data-fbt="${x.id}" ${ui.fbt.has(String(x.id)) ? "checked" : ""}> <span>${k ? "" : "<b>This item:</b> "}${esc(x.name)}</span><span class="price">${inr(x.pricePaise)}</span></label>`).join("")}
      <div class="row" style="margin-top:12px"><span>Total for ${chosen.length}: <b>${inr(total)}</b></span><button class="btn btn-sm btn-gold" id="fbtAdd" ${chosen.length ? "" : "disabled"}>Add ${chosen.length > 1 ? `all ${chosen.length}` : chosen.length ? "1" : ""} to bag</button></div>
      ${state.offers.combos.length ? `<div class="sub" style="margin-top:6px">✦ ${esc(state.offers.combos[0].title)} — applied automatically in your bag</div>` : ""}</div>`;
  };

  const draw = () => {
    const cur = images[ui.img] || images[0];
    openModal(`<div class="pd">
      <div class="gallery">
        <div class="gallery-main media" id="gMain" tabindex="0" aria-label="Product photo — click to enlarge">${off ? `<span class="tag ${extras.deal ? "deal" : ""}">${off}% off${extras.deal ? " · Deal" : ""}</span>` : ""}${picture(cur.url, cur.alt || p.name, "zoomable")}<span class="zoom-hint">Hover to zoom · click to enlarge</span></div>
        ${images.length > 1 ? `<div class="thumbs">${images.map((im, k) => `<button class="${k === ui.img ? "on" : ""}" data-img="${k}" aria-label="Photo ${k + 1}">${picture(im.url, im.alt || p.name)}</button>`).join("")}</div>` : ""}
      </div>
      <div class="body">
        <div class="fam-label">${esc(famName(p.scentFamily))}</div>
        <h2>${esc(p.name)}</h2>
        ${p.reviewCount ? `<button class="stars linkstars" id="toReviews">${stars(p.averageRating)}<small> ${p.averageRating} · ${p.reviewCount} review${p.reviewCount === 1 ? "" : "s"}</small></button>` : ""}
        <p class="desc">${esc(p.description || p.shortDescription || "")}</p>
        <div class="specs">
          <div><b>Notes</b>${esc(p.shortDescription || "—")}</div>
          <div><b>Strength</b>${esc(p.concentration)}</div>
          <div><b>Size</b>${p.sizeMl} ml</div>
        </div>
        ${extras.variants.length > 1 ? `<div class="lbl">Size</div><div class="sizes">${extras.variants.map((v) => `<button class="size ${v.slug === p.slug ? "active" : ""}" data-variant="${esc(v.slug)}" ${v.slug === p.slug ? 'aria-current="true"' : ""}><b>${v.sizeMl} ml</b><span>${inr(v.pricePaise)}</span>${v.availableQuantity <= 0 ? "<small>Sold out</small>" : ""}</button>`).join("")}</div>` : ""}
        ${extras.deal ? `<div class="deal-box"><b>${esc(extras.deal.title)}</b><span data-ends="${esc(extras.deal.endsAt)}">${timeLeft(extras.deal.endsAt)}</span></div>` : ""}
        <div class="bigprice">${inr(p.pricePaise)}${p.compareAtPricePaise > p.pricePaise ? `<s>${inr(p.compareAtPricePaise)}</s> <span class="save">Save ${inr(p.compareAtPricePaise - p.pricePaise)}</span>` : ""}</div>
        <div class="buyrow">
          ${out ? `<button class="btn btn-dark" disabled>Sold out</button>` : `
          <div class="qty"><button data-q="-1" aria-label="Decrease">−</button><span>${ui.q}</span><button data-q="1" aria-label="Increase">+</button></div>
          <button class="btn btn-dark" id="pdAdd">Add to bag · ${inr(p.pricePaise * ui.q)}</button>`}
          <button class="wish ${wished(p.id) ? "on" : ""}" id="pdWish" aria-label="Wishlist">${heartSvg}</button>
        </div>
        ${!out && p.availableQuantity <= 5 ? `<div class="low">Only ${p.availableQuantity} left in stock</div>` : ""}
        ${out ? alertForm("back_in_stock") : ui.alert === "price_drop" ? alertForm("price_drop") : `<button class="linkbtn alert-link" id="priceAlert">🔔 Tell me if the price drops</button>`}
        <div class="perks"><span>✦ Free delivery across India above ₹1,500</span><span>✦ Pay by UPI, card or cash on delivery</span><span>✦ Earn BUVA points on every order</span>${state.offers.giftWrapFeePaise >= 0 ? `<span>✦ Gift wrap with a message${state.offers.giftWrapFeePaise ? ` (${inr(state.offers.giftWrapFeePaise)})` : " — free"}</span>` : ""}</div>
        ${fbtBlock()}
      </div></div>
      <div class="pd-below">
        <div id="rvBox">${reviewsBlock()}</div>
        ${extras.similar.length ? `<div class="rowsec"><h4>You may also like</h4><div class="minirow">${extras.similar.map(miniCard).join("")}</div></div>` : ""}
        ${seenCards.length ? `<div class="rowsec"><h4>Recently viewed</h4><div class="minirow">${seenCards.map(miniCard).join("")}</div></div>` : ""}
      </div>`);
    const box = $("#mbox");
    $$("[data-q]", box).forEach((b) => b.onclick = () => { ui.q = Math.max(1, Math.min(Math.min(20, p.availableQuantity), ui.q + Number(b.dataset.q))); draw(); });
    $$("[data-img]", box).forEach((b) => b.onclick = () => { ui.img = Number(b.dataset.img); draw(); });
    $$("[data-variant]", box).forEach((b) => b.onclick = () => { if (b.dataset.variant !== p.slug) openProduct(b.dataset.variant); });
    $$("[data-open-mini]", box).forEach((b) => b.onclick = () => openProduct(b.dataset.openMini));
    $$("[data-fbt]", box).forEach((c) => c.onchange = () => { c.checked ? ui.fbt.add(c.dataset.fbt) : ui.fbt.delete(c.dataset.fbt); draw(); });
    const fa = $("#fbtAdd"); if (fa) fa.onclick = async () => {
      fa.disabled = true; let ok = 0;
      for (const id of ui.fbt) if (await addToCart(id, 1, null, true)) ok++;
      if (ok) { toast(`${ok} item${ok > 1 ? "s" : ""} added to your bag`); closeAll(); openCart(); } else fa.disabled = false;
    };
    const add = $("#pdAdd"); if (add) add.onclick = async () => { if (await addToCart(p.id, ui.q, add)) { closeAll(); openCart(); } };
    $("#pdWish").onclick = async () => { await toggleWish(p.id); $("#pdWish").classList.toggle("on", wished(p.id)); };
    const tr = $("#toReviews"); if (tr) tr.onclick = () => $("#rvBox").scrollIntoView({ behavior: "smooth" });
    const pa = $("#priceAlert"); if (pa) pa.onclick = () => { ui.alert = "price_drop"; draw(); $("#alEmail")?.focus(); };
    const af = $("#alertForm");
    if (af) af.onsubmit = async (ev) => {
      ev.preventDefault(); const email = $("#alEmail").value.trim(), m = $("#alMsg");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { m.className = "msg err"; m.textContent = "Please enter a valid email."; return; }
      try {
        await api("/alerts", { method: "POST", auth: "optional", body: { productId: Number(p.id), kind: out ? "back_in_stock" : "price_drop", email } });
        m.className = "msg ok"; m.textContent = out ? `We'll email ${email} as soon as it's back.` : `We'll email ${email} if the price drops.`;
        af.querySelector("button").disabled = true;
      } catch (ex) { m.className = "msg err"; m.textContent = ex.message; }
    };
    // hover zoom + click to enlarge
    const main = $("#gMain");
    if (main) {
      const img = main.querySelector("img.zoomable");
      main.onmousemove = (ev) => { if (!img || matchMedia("(hover: none)").matches) return; const r = main.getBoundingClientRect(); img.style.transformOrigin = `${((ev.clientX - r.left) / r.width) * 100}% ${((ev.clientY - r.top) / r.height) * 100}%`; main.classList.add("zooming"); };
      main.onmouseleave = () => main.classList.remove("zooming");
      main.onclick = () => openLightbox(images.map((x) => x.url), ui.img);
      main.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); main.click(); } };
    }
    wireReviews();
  };
  draw();
  loadReviews();
  const url = new URL(location.href); url.searchParams.set("product", slug); history.replaceState(null, "", url);
  if (getToken()) api("/account/view-history", { method: "POST", body: { productId: p.id }, auth: true }).catch(() => {});
  renderRecent();
}
// drop ?product= when the modal closes
document.addEventListener("click", (e) => { if (e.target.closest("[data-close]") || e.target.id === "overlay" || e.target.id === "modal") { const u = new URL(location.href); if (u.searchParams.has("product")) { u.searchParams.delete("product"); history.replaceState(null, "", u); } } });

/* full-screen photo viewer */
const lb = { urls: [], i: 0 };
function openLightbox(urls, i = 0) {
  lb.urls = urls.filter(Boolean); lb.i = i; if (!lb.urls.length) return;
  drawLightbox(); $("#lightbox").hidden = false; $("#lbClose").focus();
}
function drawLightbox() {
  const u = lb.urls[lb.i];
  const webp = /^\/img\/buva\/[a-z0-9-]+\.png$/.test(u) ? u.replace(/\.png$/, ".webp") : null;
  $("#lbImg").innerHTML = webp ? `<picture><source srcset="${esc(webp)}" type="image/webp"><img src="${esc(u)}" alt="Product photo, enlarged"></picture>` : `<img src="${esc(u)}" alt="Product photo, enlarged">`;
  $("#lbPrev").hidden = $("#lbNext").hidden = lb.urls.length < 2;
  $("#lbCount").textContent = lb.urls.length > 1 ? `${lb.i + 1} / ${lb.urls.length}` : "";
}
const closeLightbox = () => { $("#lightbox").hidden = true; };
$("#lbClose").addEventListener("click", closeLightbox);
$("#lbPrev").addEventListener("click", () => { lb.i = (lb.i - 1 + lb.urls.length) % lb.urls.length; drawLightbox(); });
$("#lbNext").addEventListener("click", () => { lb.i = (lb.i + 1) % lb.urls.length; drawLightbox(); });
$("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
document.addEventListener("keydown", (e) => {
  if ($("#lightbox").hidden) return;
  if (e.key === "Escape") { e.stopImmediatePropagation(); closeLightbox(); }
  if (e.key === "ArrowLeft") $("#lbPrev").click();
  if (e.key === "ArrowRight") $("#lbNext").click();
}, true);

/* home rows: deals, recently viewed */
function renderDeals() {
  const sec = $("#dealsSec"), deals = (state.offers.deals || []).filter((p) => p.availableQuantity > 0);
  const strip = $("#offerStrip");
  strip.innerHTML = state.offers.combos.map((c) => `<span>✦ ${esc(c.title)}${c.scentFamily ? ` <small>(${esc(famName(c.scentFamily))})</small>` : ""}</span>`).join("");
  strip.hidden = !state.offers.combos.length;
  sec.hidden = !deals.length && !state.offers.combos.length;
  $("#dealsGrid").innerHTML = deals.map(cardHtml).join("");
  $("#dealsGrid").hidden = !deals.length;
}
const onePerPerfume = (list) => { const seen = new Set(); return list.filter((p) => { const k = p.variantGroup || p.slug; if (seen.has(k)) return false; seen.add(k); return true; }); };
function renderRecent() {
  const items = onePerPerfume(recent.list().map((sl) => state.products.find((x) => x.slug === sl)).filter(Boolean)).slice(0, 8);
  $("#recentSec").hidden = !items.length;
  $("#recentGrid").innerHTML = items.map(cardHtml).join("");
}

/* ---------------- wishlist ---------------- */
async function toggleWish(productId) {
  if (!getToken()) { toast("Sign in to save fragrances to your wishlist"); openAccount("login"); return; }
  const on = wished(productId);
  try {
    await api(`/account/wishlist/${productId}`, { method: on ? "DELETE" : "POST", auth: true });
    await loadAccount();
    toast(on ? "Removed from wishlist" : "Saved to wishlist");
    renderChips(); if (state.filter.family === "wishlist" && !state.account?.wishlist?.length) state.filter.family = "all";
    renderGrid();
  } catch (err) { toast(err.message); }
}
const showWishlist = () => {
  if (!getToken()) { toast("Sign in to see your wishlist"); openAccount("login"); return; }
  if (!state.account?.wishlist?.length) { toast("Your wishlist is empty — tap ♥ on any fragrance"); return; }
  state.filter.family = "wishlist"; renderChips(); renderGrid(); document.getElementById("shop").scrollIntoView();
};
$("#wishBtn").addEventListener("click", showWishlist);
$("#footWish").addEventListener("click", showWishlist);

/* ---------------- cart (server-side, token in localStorage) ---------------- */
async function ensureCart() {
  const token = store.get(CART_KEY);
  if (token) {
    try { state.cart = (await api("/carts/" + token)).cart; return state.cart; }
    catch (err) { if (err.status !== 404 && err.status !== 400) throw err; }
  }
  state.cart = (await api("/carts", { method: "POST" })).cart;
  store.set(CART_KEY, state.cart.sessionToken);
  return state.cart;
}
async function refreshCart() {
  const token = store.get(CART_KEY);
  if (!token) { state.cart = null; return updateBadges(); }
  try { state.cart = (await api("/carts/" + token)).cart; }
  catch { state.cart = null; store.del(CART_KEY); }
  updateBadges();
}
async function addToCart(productId, quantity = 1, btn, silent = false) {
  if (btn) btn.disabled = true;
  try {
    const cart = await ensureCart();
    state.cart = (await api(`/carts/${cart.sessionToken}/items`, { method: "POST", body: { productId: Number(productId), quantity } })).cart;
    const item = state.cart.items.find((i) => Number(i.productId) === Number(productId));
    if (!silent) toast(`${item ? item.name : "Fragrance"} added to your bag`);
    updateBadges(); return true;
  } catch (err) { toast(err.message); return false; }
  finally { if (btn) btn.disabled = false; }
}
async function setQty(productId, quantity) {
  try {
    const t = state.cart.sessionToken;
    state.cart = (quantity <= 0
      ? await api(`/carts/${t}/items/${productId}`, { method: "DELETE" })
      : await api(`/carts/${t}/items/${productId}`, { method: "PATCH", body: { quantity } })).cart;
  } catch (err) { toast(err.message); }
  await renderCart(); updateBadges();
}
/* the server prices the bag (coupons, combos, points, gift wrap) — the page only displays it */
async function getQuote(extra = {}) {
  if (!state.cart?.items?.length) { state.quote = null; return null; }
  try {
    const { quote } = await api(`/carts/${state.cart.sessionToken}/quote`, { method: "POST", auth: "optional",
      body: { couponCode: state.couponCode || undefined, redeemPoints: extra.redeemPoints || 0, giftWrap: !!extra.giftWrap } });
    state.quote = quote;
  } catch { state.quote = null; }
  return state.quote;
}
function updateBadges() {
  const n = state.cart?.itemCount || 0;
  $("#cartCount").textContent = n; $("#cartCount").hidden = !n;
  const w = state.account?.wishlist?.length || 0;
  $("#wishCount").textContent = w; $("#wishCount").hidden = !w;
}
const summaryRows = (q) => `
  <div class="sumrow"><span>Subtotal</span><span>${inr(q.subtotalPaise)}</span></div>
  ${q.comboDiscountPaise ? `<div class="sumrow disc"><span>Offer: ${esc(q.comboTitle)}</span><span>−${inr(q.comboDiscountPaise)}</span></div>` : ""}
  ${q.couponDiscountPaise ? `<div class="sumrow disc"><span>Coupon ${esc(q.couponCode)}</span><span>−${inr(q.couponDiscountPaise)}</span></div>` : ""}
  ${q.pointsDiscountPaise ? `<div class="sumrow disc"><span>BUVA points (${q.pointsRedeemed})</span><span>−${inr(q.pointsDiscountPaise)}</span></div>` : ""}
  <div class="sumrow"><span>Delivery</span><span>${q.shippingPaise ? inr(q.shippingPaise) : "Free"}</span></div>
  ${q.giftWrap ? `<div class="sumrow"><span>Gift wrap</span><span>${q.giftWrapPaise ? inr(q.giftWrapPaise) : "Free"}</span></div>` : ""}
  <div class="sumrow total"><span>Total</span><span>${inr(q.totalPaise)}</span></div>
  ${q.discountPaise ? `<div class="saving">You save ${inr(q.discountPaise)} on this order</div>` : ""}`;

async function renderCart() {
  const c = state.cart, items = c?.items || [];
  $("#drawerTitle").textContent = `Your bag${c?.itemCount ? ` (${c.itemCount})` : ""}`;
  const meter = $("#shipMeter");
  meter.hidden = !items.length;
  if (!items.length) {
    $("#cartBody").innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24"><path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg><p>Your bag is empty.</p><br><a class="btn btn-line" href="#shop" data-close>Continue shopping</a></div>`;
    $("#cartFoot").hidden = true; return;
  }
  const [q, cps] = await Promise.all([getQuote(), api("/coupons/available?sessionToken=" + encodeURIComponent(c.sessionToken)).catch(() => ({ coupons: [] }))]);
  const left = (q?.freeShippingFromPaise || 150000) - c.subtotalPaise;
  meter.innerHTML = (left > 0 ? `You're <b>${inr(left)}</b> away from free delivery` : `<b>You've unlocked free delivery ✦</b>`)
    + `<div class="meter"><i style="width:${Math.min(100, (c.subtotalPaise / (q?.freeShippingFromPaise || 150000)) * 100)}%"></i></div>`;
  $("#cartBody").innerHTML = items.map((i) => `
    <div class="line-item">
      <div class="media">${picture(i.imageUrl, i.imageAlt || i.name)}</div>
      <div class="meta">
        <h5>${esc(i.name)}</h5>
        <div class="sub">${esc(i.concentration)} · ${i.sizeMl} ml · ${inr(i.pricePaise)}</div>
        <div class="qty"><button data-qty="${i.productId}" data-to="${i.quantity - 1}" aria-label="Decrease">−</button><span>${i.quantity}</span><button data-qty="${i.productId}" data-to="${i.quantity + 1}" aria-label="Increase" ${i.quantity >= i.availableQuantity ? "disabled" : ""}>+</button></div>
        <button class="linkbtn" data-qty="${i.productId}" data-to="0">Remove</button>
      </div>
      <div class="price">${inr(i.lineTotalPaise)}</div>
    </div>`).join("")
    + (q?.comboNudge ? `<div class="nudge">✦ Add <b>${q.comboNudge.needed}</b> more ${q.comboNudge.scentFamily ? esc(famName(q.comboNudge.scentFamily)).toLowerCase() + " " : ""}fragrance${q.comboNudge.needed > 1 ? "s" : ""} to unlock <b>${esc(q.comboNudge.title)}</b>. <a href="#shop" data-close>Browse</a></div>` : "");
  const coupons = cps.coupons || [];
  $("#cartFoot").hidden = false;
  $("#cartFoot").innerHTML = `
    ${coupons.length ? `<div class="coupons"><div class="h6" style="margin:0 0 6px">Available coupons</div>${coupons.map((cp) => `
      <div class="coupon ${state.couponCode === cp.code ? "on" : ""}"><div><b>${esc(cp.code)}</b> · ${esc(cp.label)}<div class="sub">${esc(cp.description || "")}${cp.eligible ? "" : ` · add ${inr(cp.shortfallPaise)} more to use`}</div></div>
      ${state.couponCode === cp.code ? `<button class="linkbtn" data-coupon-remove>Remove</button>` : `<button class="btn btn-sm btn-line" data-coupon="${esc(cp.code)}" ${cp.eligible ? "" : "disabled"}>Apply</button>`}</div>`).join("")}</div>` : ""}
    <div class="promo"><label class="sr-only" for="promoIn">Coupon code</label><input id="promoIn" placeholder="Have a code?" value="${esc(state.couponCode || "")}" ${state.couponCode ? "disabled" : ""}><button id="promoBtn">${state.couponCode ? "Remove" : "Apply"}</button></div>
    <div class="msg ${q?.couponError ? "err" : q?.couponCode ? "ok" : ""}" id="promoMsg">${q?.couponError ? esc(q.couponError) : q?.couponCode ? `${esc(q.couponCode)} applied — you save ${inr(q.couponDiscountPaise)}` : ""}</div>
    ${(q?.notes || []).map((n) => `<div class="sub" style="margin-bottom:6px">${esc(n)}</div>`).join("")}
    ${q ? summaryRows(q) : `<div class="sumrow total"><span>Subtotal</span><span>${inr(c.subtotalPaise)}</span></div>`}
    ${q?.pointsToEarn ? `<div class="sub" style="margin:-8px 0 12px">✦ ${getToken() ? `Earn <b>${q.pointsToEarn}</b> BUVA points on this order` : `Sign in to earn ${q.pointsToEarn} BUVA points on this order`}</div>` : ""}
    <button class="btn btn-dark full" id="checkoutBtn">Checkout</button>`;
  $("#promoBtn").onclick = () => applyCoupon(state.couponCode ? null : $("#promoIn").value);
  $$("[data-coupon]", $("#cartFoot")).forEach((b) => b.onclick = () => applyCoupon(b.dataset.coupon));
  const rm = $("[data-coupon-remove]", $("#cartFoot")); if (rm) rm.onclick = () => applyCoupon(null);
  $("#checkoutBtn").onclick = openCheckout;
}
$("#cartBody").addEventListener("click", (e) => { const b = e.target.closest("[data-qty]"); if (b) { b.disabled = true; setQty(b.dataset.qty, Number(b.dataset.to)); } });
async function applyCoupon(code) {
  if (code === null) { state.couponCode = null; return renderCart(); }
  code = String(code || "").trim().toUpperCase();
  if (!code) { const m = $("#promoMsg"); m.className = "msg err"; m.textContent = "Enter a coupon code."; return; }
  state.couponCode = code;
  await renderCart();
  if (state.quote?.couponError || !state.quote?.couponCode) {
    const msg = state.quote?.couponError || "Coupon couldn't be applied";
    state.couponCode = null; await renderCart();
    const m = $("#promoMsg"); m.className = "msg err"; m.textContent = msg;
  }
}
async function openCart() {
  await refreshCart();
  $("#cartDrawer").classList.add("show"); $("#overlay").classList.add("show");
  await renderCart();
}
$("#cartBtn").addEventListener("click", openCart);

/* ---------------- checkout ---------------- */
const STATES = ["Tamil Nadu", "Karnataka", "Kerala", "Andhra Pradesh", "Telangana", "Puducherry", "Maharashtra", "Delhi", "Gujarat", "West Bengal", "Uttar Pradesh", "Rajasthan", "Madhya Pradesh", "Punjab", "Haryana", "Odisha", "Bihar", "Assam", "Goa", "Jharkhand", "Chhattisgarh", "Uttarakhand", "Himachal Pradesh", "Jammu and Kashmir", "Chandigarh", "Other"];
const minRedeem = () => state.offers.points?.minRedeemPoints ?? 50;
const pointValue = () => state.offers.points?.pointValuePaise ?? 100;
async function checkoutQuote() {
  const ck = state.checkout;
  const first = await getQuote({ giftWrap: ck.giftWrap, redeemPoints: 0 });
  if (!first || !ck.usePoints || first.maxRedeemablePoints < 1) return first;
  return getQuote({ giftWrap: ck.giftWrap, redeemPoints: first.maxRedeemablePoints });
}
async function openCheckout() {
  const c = state.cart, acc = state.account;
  if (!c?.items?.length) return;
  const me = acc?.customer || {}, addr = acc?.addresses?.find((a) => a.isDefault) || acc?.addresses?.[0] || {};
  const rp = state.razorpay.configured;
  const v = (x) => esc(x || "");
  const q = await checkoutQuote();
  if (!q) { toast("Couldn't price your bag — please try again"); return; }
  const ck = state.checkout, fee = q.giftWrapFeePaise;
  openModal(`<div class="co">
    <form class="co-form" id="coForm" novalidate>
      <h2>Checkout</h2>
      ${acc ? `<p class="sub">Signed in as ${esc(me.email)}</p>` : `<p class="sub">Have an account? <button type="button" class="linkbtn" style="margin:0" id="coLogin">Sign in</button> to earn BUVA points, track orders and get invoices.</p>`}
      <h6>Contact</h6>
      <div class="fgrid">
        <div class="field w2"><label for="cName">Full name</label><input id="cName" name="customerName" autocomplete="name" required value="${v(me.fullName)}"></div>
        <div class="field"><label for="cEmail">Email</label><input id="cEmail" name="email" type="email" autocomplete="email" required value="${v(me.email)}"></div>
        <div class="field"><label for="cPhone">Mobile</label><input id="cPhone" name="phone" type="tel" autocomplete="tel" required value="${v(addr.phone || me.phone)}"></div>
      </div>
      <h6>Delivery address</h6>
      <div class="fgrid">
        <div class="field w2"><label for="cL1">Address</label><input id="cL1" name="line1" autocomplete="address-line1" required value="${v(addr.line1)}"></div>
        <div class="field w2"><label for="cL2">Apartment, landmark (optional)</label><input id="cL2" name="line2" autocomplete="address-line2" value="${v(addr.line2)}"></div>
        <div class="field"><label for="cCity">City</label><input id="cCity" name="city" autocomplete="address-level2" required value="${v(addr.city)}"></div>
        <div class="field"><label for="cPin">PIN code</label><input id="cPin" name="postalCode" inputmode="numeric" maxlength="6" autocomplete="postal-code" required value="${v(addr.postalCode)}"></div>
        <div class="field w2"><label for="cState">State</label><select id="cState" name="state">${STATES.map((s2) => `<option ${s2 === (addr.state || "Tamil Nadu") ? "selected" : ""}>${s2}</option>`).join("")}</select></div>
        <div class="field w2"><label for="cNotes">Delivery instructions (optional)</label><input id="cNotes" name="customerNotes" maxlength="500" placeholder="Landmark, preferred time…"></div>
      </div>
      ${acc ? `<label class="check"><input type="checkbox" name="saveAddress" ${acc.addresses?.length ? "" : "checked"}> Save this address to my account</label>` : ""}
      <h6>Gift wrap</h6>
      <label class="check" style="margin-top:0"><input type="checkbox" id="cGift" ${ck.giftWrap ? "checked" : ""}> Wrap it as a gift${fee ? ` (+${inr(fee)})` : " (free)"} — prices are hidden on the packing slip</label>
      <div class="field" id="giftMsgWrap" ${ck.giftWrap ? "" : "hidden"} style="margin-top:8px"><label for="cGiftMsg">Gift message (optional)</label><textarea id="cGiftMsg" maxlength="200" rows="2" placeholder="Happy birthday! With love…">${esc(ck.giftMessage)}</textarea></div>
      ${acc ? `<h6>BUVA points</h6>${q.maxRedeemablePoints >= minRedeem()
        ? `<label class="check" style="margin-top:0"><input type="checkbox" id="cPoints" ${ck.usePoints ? "checked" : ""}> Use ${q.maxRedeemablePoints} of your ${q.pointsBalance} points — save ${inr(q.maxRedeemablePoints * pointValue())}</label>`
        : `<p class="sub">You have <b>${q.pointsBalance}</b> BUVA points.${q.pointsBalance < minRedeem() ? ` You can redeem once you have ${minRedeem()}.` : ""} You'll earn ${q.pointsToEarn} on this order.</p>`}` : ""}
      <h6>Payment</h6>
      <div class="pay">
        <label class="${rp ? "" : "disabled"}"><input type="radio" name="paymentMethod" value="razorpay" ${rp ? "checked" : "disabled"}> Pay online — UPI, cards, netbanking (Razorpay)${rp ? "" : " · unavailable"}</label>
        <label><input type="radio" name="paymentMethod" value="cod" ${rp ? "" : "checked"}> Cash on delivery</label>
      </div>
      <div class="msg err" id="coErr" role="alert"></div>
      <button class="btn btn-dark full" type="submit" id="coSubmit">Place order · ${inr(q.totalPaise)}</button>
    </form>
    <div class="co-sum">
      <div class="h6" style="margin-top:0">Order summary</div>
      ${c.items.map((i) => `<div class="co-item"><div class="media">${picture(i.imageUrl, i.name)}<i>${i.quantity}</i></div><div class="nm"><b>${esc(i.name)}</b><br><span class="sub">${esc(i.concentration)} · ${i.sizeMl} ml</span></div><span>${inr(i.lineTotalPaise)}</span></div>`).join("")}
      <div style="border-top:1px solid var(--line);margin-top:14px;padding-top:14px" id="coTotals">
        ${summaryRows(q)}
        ${q.pointsToEarn && acc ? `<div class="sub">✦ You'll earn ${q.pointsToEarn} BUVA points when it's delivered</div>` : ""}
        <div class="sub">Prices include GST. A GST invoice is issued with your order.</div>
      </div>
    </div></div>`);
  const login = $("#coLogin"); if (login) login.onclick = () => openAccount("login", true);
  const refresh = async () => {
    const nq = await checkoutQuote(); if (!nq) return;
    $("#coTotals").innerHTML = summaryRows(nq) + (nq.pointsToEarn && acc ? `<div class="sub">✦ You'll earn ${nq.pointsToEarn} BUVA points when it's delivered</div>` : "") + `<div class="sub">Prices include GST. A GST invoice is issued with your order.</div>`;
    const btn = $("#coSubmit"); if (btn && !btn.disabled) btn.textContent = "Place order · " + inr(nq.totalPaise);
  };
  $("#cGift").onchange = (e) => { ck.giftWrap = e.target.checked; $("#giftMsgWrap").hidden = !ck.giftWrap; refresh(); };
  $("#cGiftMsg").oninput = (e) => { ck.giftMessage = e.target.value; };
  const pts = $("#cPoints"); if (pts) pts.onchange = (e) => { ck.usePoints = e.target.checked; refresh(); };
  $("#coForm").addEventListener("submit", placeOrder);
  $("#coForm").addEventListener("input", (e) => e.target.classList.remove("err"));
}

async function placeOrder(e) {
  e.preventDefault();
  const f = e.target, err = $("#coErr"), btn = $("#coSubmit");
  const val = (n) => (f.elements[n]?.value || "").trim();
  let bad = false;
  ["customerName", "email", "phone", "line1", "city", "postalCode"].forEach((n) => {
    const el = f.elements[n]; let ok = !!val(n);
    if (n === "email") ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val(n));
    if (n === "phone") ok = val(n).replace(/\D/g, "").length >= 10;
    if (n === "postalCode") ok = /^[1-9][0-9]{5}$/.test(val(n));
    el.classList.toggle("err", !ok); if (!ok) bad = true;
  });
  if (bad) { err.textContent = "Please check the highlighted fields."; return; }
  err.textContent = ""; btn.disabled = true; btn.textContent = "Placing order…";
  const ck = state.checkout;
  const body = {
    customerName: val("customerName"), email: val("email"), phone: val("phone"),
    shippingAddress: { recipientName: val("customerName"), line1: val("line1"), line2: val("line2"), city: val("city"), state: val("state"), postalCode: val("postalCode"), countryCode: "IN" },
    paymentMethod: f.elements.paymentMethod.value, couponCode: state.couponCode || undefined, customerNotes: val("customerNotes") || undefined,
    saveAddress: !!f.elements.saveAddress?.checked,
    giftWrap: ck.giftWrap, giftMessage: ck.giftWrap ? ck.giftMessage.trim() || undefined : undefined,
    redeemPoints: ck.usePoints && state.quote ? state.quote.pointsRedeemed : 0,
  };
  try {
    const { order, payment } = await api(`/carts/${state.cart.sessionToken}/checkout`, { method: "POST", body, auth: "optional" });
    store.del(CART_KEY); state.cart = null; state.couponCode = null; state.quote = null;
    state.checkout = { giftWrap: false, giftMessage: "", usePoints: false }; updateBadges();
    if (getToken()) loadAccount().catch(() => {});
    if (payment) await payWithRazorpay(order, payment);
    else showSuccess(order);
  } catch (ex) {
    err.textContent = ex.message; btn.disabled = false; btn.textContent = "Place order · " + inr(state.quote?.totalPaise || 0);
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ($(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script"); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("Couldn't load the payment window. Check your connection."));
    document.head.appendChild(s);
  });
}
async function payWithRazorpay(order, payment) {
  try { await loadScript("https://checkout.razorpay.com/v1/checkout.js"); }
  catch (ex) { showSuccess(order, ex.message); return; }
  const rzp = new window.Razorpay({
    key: payment.keyId, amount: payment.amountPaise, currency: payment.currency, order_id: payment.providerOrderId,
    name: "BUVA Chennai", description: `Order ${order.orderNumber}`, image: "/apple-touch-icon.png",
    prefill: { name: order.customerName, email: order.email, contact: order.phone },
    notes: { buva_order: order.orderNumber }, theme: { color: "#3a1f2b" },
    handler: async (r) => {
      openModal(`<div class="success"><h2>Confirming payment…</h2><p>Please don't close this window.</p></div>`, true);
      try {
        const res = await api("/payments/razorpay/verify", { method: "POST", body: { orderId: order.id, razorpayPaymentId: r.razorpay_payment_id, razorpayOrderId: r.razorpay_order_id, razorpaySignature: r.razorpay_signature } });
        showSuccess({ ...order, paymentStatus: res.order.paymentStatus });
      } catch (ex) { showSuccess(order, "We received your payment and are confirming it. If the status doesn't update shortly, contact us with your order number."); }
    },
    modal: { ondismiss: () => showSuccess(order, "Payment wasn't completed. Your order is saved — contact us with the order number to pay, or place a new order with cash on delivery.") },
  });
  rzp.on("payment.failed", () => {});
  rzp.open();
}
function showSuccess(order, note) {
  const paid = order.paymentStatus === "paid", cod = order.paymentMethod === "cod";
  openModal(`<div class="success">
    <div class="tick"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg></div>
    <h2>${note && !paid ? "Order saved" : "Thank you"}${order.customerName ? ", " + esc(order.customerName.split(" ")[0]) : ""}</h2>
    <p>Order <b>${esc(order.orderNumber)}</b> ${paid ? "is paid and" : ""} has been placed.</p>
    <p>${cod ? "Pay in cash when your order arrives." : paid ? "A payment confirmation has been sent to " + esc(order.email) + "." : ""}</p>
    ${note ? `<p style="color:var(--wine)">${esc(note)}</p>` : ""}
    ${order.discountPaise ? `<p>You saved <b>${inr(order.discountPaise)}</b>${order.giftWrap ? " — and it's gift wrapped 🎁" : ""}.</p>` : order.giftWrap ? `<p>It's gift wrapped 🎁</p>` : ""}
    ${order.pointsToEarn ? `<p>${getToken() ? `You'll earn <b>${order.pointsToEarn} BUVA points</b> when it's delivered.` : `Create an account next time to earn ${order.pointsToEarn} BUVA points on orders like this.`}</p>` : ""}
    <p>We'll email updates to ${esc(order.email)}.${getToken() ? " You can track it under My account." : ""}</p><br>
    ${getToken() ? `<button class="btn btn-line" id="goOrders">View my orders</button> ` : ""}<button class="btn btn-dark" data-close>Continue shopping</button>
  </div>`, true);
  const g = $("#goOrders"); if (g) g.onclick = () => openAccount("orders");
}

/* ---------------- account ---------------- */
async function loadAccount() {
  if (!getToken()) { state.account = null; updateBadges(); return null; }
  try { state.account = await api("/account", { auth: true }); }
  catch { state.account = null; }
  updateBadges(); renderChips();
  return state.account;
}
const googleSvg = `<svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

function openAccount(tab = "orders", returnToCheckout = false) {
  if (!getToken()) return renderAuth(tab === "register" ? "register" : "login", returnToCheckout);
  renderAccount(tab);
}
function renderAuth(mode, returnToCheckout) {
  openModal(`<div class="acct">
    <h2 class="mtitle">${mode === "login" ? "Sign in" : "Create your account"}</h2>
    <p class="sub">Track orders, download invoices, save addresses and keep a wishlist.</p><br>
    <a class="google" href="/api/auth/google" id="gBtn">${googleSvg} Continue with Google</a>
    <div class="or">or</div>
    <form id="authForm" novalidate><div class="fgrid">
      ${mode === "register" ? `
        <div class="field w2"><label for="aName">Full name</label><input id="aName" name="fullName" autocomplete="name" required></div>
        <div class="field"><label for="aEmail">Email</label><input id="aEmail" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="aPhone">Mobile</label><input id="aPhone" name="phone" type="tel" autocomplete="tel" required></div>`
      : `<div class="field w2"><label for="aId">Email or mobile</label><input id="aId" name="identifier" autocomplete="username" required></div>`}
      <div class="field w2"><label for="aPw">Password</label><input id="aPw" name="password" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" minlength="8" required></div>
    </div>
    <div class="msg err" id="authErr" role="alert"></div>
    <button class="btn btn-dark full" type="submit">${mode === "login" ? "Sign in" : "Create account"}</button></form>
    <p class="sub center" style="margin-top:16px">${mode === "login" ? `New to BUVA? <button class="linkbtn" style="margin:0" id="swap">Create an account</button>` : `Already have an account? <button class="linkbtn" style="margin:0" id="swap">Sign in</button>`}</p>
  </div>`, true);
  $("#swap").onclick = () => renderAuth(mode === "login" ? "register" : "login", returnToCheckout);
  $("#gBtn").onclick = () => store.set("buvaPostLoginReturn", returnToCheckout ? "checkout" : "account", sessionStorage);
  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("button[type=submit]"), errEl = $("#authErr");
    const data = Object.fromEntries(new FormData(f).entries());
    if ((data.password || "").length < 8) { errEl.textContent = "Password must be at least 8 characters."; return; }
    btn.disabled = true; errEl.textContent = "";
    try {
      const res = await api(mode === "login" ? "/auth/login" : "/auth/register", { method: "POST", body: data });
      setToken(res.session.token); await loadAccount();
      toast(`Welcome${res.customer?.fullName ? ", " + res.customer.fullName.split(" ")[0] : ""}`);
      renderGrid();
      if (returnToCheckout && state.cart?.items?.length) openCheckout(); else renderAccount("orders");
    } catch (ex) { errEl.textContent = ex.message; btn.disabled = false; }
  });
}

async function renderAccount(tab = "orders") {
  if (!state.account || tab === "orders") await loadAccount();   // orders change status — always fetch fresh
  const a = state.account;
  if (!a) return renderAuth("login");
  const tabs = [["orders", "Orders"], ["points", "BUVA points"], ["wishlist", "Wishlist"], ["addresses", "Addresses"], ["support", "Support"], ["profile", "Profile"]];
  const body = {
    orders: () => a.orders.length ? a.orders.map(orderHtml).join("") : `<div class="empty-state"><p>No orders yet.</p><br><a class="btn btn-line" href="#shop" data-close>Start shopping</a></div>`,
    points: () => `<div id="ptsBox"><p class="sub">Loading your points…</p></div>`,
    wishlist: () => a.wishlist.length ? a.wishlist.map((w) => `<div class="wl"><div class="media">${picture(w.imageUrl, w.name)}</div><div class="nm"><b>${esc(w.name)}</b><div class="sub">${inr(w.pricePaise)}</div></div><button class="btn btn-sm btn-dark" data-open-p="${esc(w.slug)}">View</button><button class="linkbtn" data-unwish="${w.productId}">Remove</button></div>`).join("") : `<p class="sub">Tap ♥ on any fragrance to save it here.</p>`,
    addresses: () => (a.addresses.length ? a.addresses.map((x) => `<div class="addr"><b>${esc(x.label)}</b>${x.isDefault ? ` <span class="pill">Default</span>` : ""}<div>${esc(x.recipientName)} · ${esc(x.phone)}</div><div class="sub">${esc(x.line1)}${x.line2 ? ", " + esc(x.line2) : ""}, ${esc(x.city)}, ${esc(x.state)} ${esc(x.postalCode)}</div><div class="actions" style="margin-top:8px">${x.isDefault ? "" : `<button class="linkbtn" style="margin:0 12px 0 0" data-default-addr="${x.id}">Make default</button>`}<button class="linkbtn" style="margin:0" data-del-addr="${x.id}">Delete</button></div></div>`).join("") : `<p class="sub">No saved addresses. Tick “Save this address” at checkout to add one.</p>`),
    support: () => `${a.supportTickets.length ? a.supportTickets.map((s) => `<div class="order"><div class="top"><b>${esc(s.topic)}</b><span class="pill ${s.status === "resolved" ? "delivered" : ""}">${esc(label(s.status))}</span></div><div class="sub">${fmtDate(s.createdAt)}</div><p style="margin-top:6px;font-size:14px">${esc(s.message)}</p>${s.customerReply ? `<p style="margin-top:8px;font-size:14px;border-left:2px solid var(--gold);padding-left:10px"><b>BUVA:</b> ${esc(s.customerReply)}</p>` : ""}</div>`).join("") : `<p class="sub">No support requests yet.</p>`}<br><a class="btn btn-line btn-sm" href="#contact" data-close>New request</a>`,
    profile: () => `<form id="profileForm" class="fgrid">
        <div class="field w2"><label for="pName">Full name</label><input id="pName" name="fullName" value="${esc(a.customer.fullName)}" required></div>
        <div class="field"><label>Email</label><input value="${esc(a.customer.email)}" disabled></div>
        <div class="field"><label for="pPhone">Mobile</label><input id="pPhone" name="phone" value="${esc(a.customer.phone || "")}" required></div>
        <div class="w2"><label class="check"><input type="checkbox" name="orderUpdates" ${a.notificationPreferences.orderUpdates ? "checked" : ""}> Email me order updates</label>
        <label class="check"><input type="checkbox" name="marketing" ${a.notificationPreferences.marketing ? "checked" : ""}> Send me launches and offers</label>
        <label class="check"><input type="checkbox" name="priceAlerts" checked> Email me when a wishlist fragrance drops in price</label></div>
        <div class="w2"><div class="msg" id="pMsg"></div><button class="btn btn-dark" type="submit">Save changes</button> <button class="btn btn-line" type="button" id="logoutBtn">Sign out</button></div>
      </form>`,
  };
  openModal(`<div class="acct">
    <h2 class="mtitle">Hello, ${esc(a.customer.fullName.split(" ")[0])}</h2>
    <p class="sub">${esc(a.customer.email)}</p>
    <div class="tabs" role="tablist">${tabs.map(([k, n]) => `<button role="tab" class="${k === tab ? "on" : ""}" data-tab="${k}">${n}</button>`).join("")}</div>
    <div id="acctBody">${body[tab]()}</div>
  </div>`);
  if (location.hash !== "#account") history.replaceState(null, "", "#account");
  $$("[data-tab]", $("#mbox")).forEach((b) => b.onclick = () => renderAccount(b.dataset.tab));
  wireAccount(tab);
}

const STEP = ["pending", "confirmed", "packed", "shipped", "delivered"];
function orderHtml(o) {
  const items = o.items || [];
  const stepIx = STEP.indexOf(o.status);
  return `<div class="order">
    <div class="top"><b>${esc(o.orderNumber)}</b><span>${inr(o.totalPaise)}</span></div>
    <div><span class="pill ${esc(o.status)}">${esc(label(o.status))}</span> <span class="pill ${esc(o.paymentStatus)}">${esc(o.paymentMethod === "cod" ? "Cash on delivery" : label(o.paymentStatus))}</span> <span class="sub">· ${fmtDate(o.createdAt)}</span></div>
    ${stepIx >= 0 ? `<div class="meter" style="margin-top:10px"><i style="width:${(stepIx / 4) * 100}%"></i></div>` : ""}
    <div class="sub" style="margin-top:8px">${items.map((i) => `${esc(i.name)} × ${i.quantity}`).join(" · ")}</div>
    ${o.trackingNumber ? `<div style="font-size:13px;margin-top:6px">${esc(o.courierName || "Courier")}: <b>${esc(o.trackingNumber)}</b>${o.trackingUrl && /^https?:\/\//.test(o.trackingUrl) ? ` · <a href="${esc(o.trackingUrl)}" target="_blank" rel="noopener" style="text-decoration:underline">Track parcel</a>` : ""}</div>` : ""}
    ${o.returnRequestStatus ? `<div style="font-size:13px;margin-top:6px">Return request: <b>${esc(label(o.returnRequestStatus))}</b>${o.returnAdminNote ? ` — ${esc(o.returnAdminNote)}` : ""}</div>` : ""}
    <div class="actions">
      ${o.invoiceNumber ? `<a class="btn btn-sm btn-line" href="/invoice.html?number=${encodeURIComponent(o.invoiceNumber)}">Invoice</a>` : ""}
      ${o.status === "delivered" ? items.filter((i) => !i.reviewId).map((i) => `<button class="btn btn-sm btn-line" data-review="${esc(o.id)}" data-pid="${i.productId}" data-pname="${esc(i.name)}">Review ${esc(i.name)}</button>`).join("") : ""}
      ${o.status === "delivered" && !o.returnRequestStatus ? `<button class="btn btn-sm btn-line" data-return="${esc(o.id)}">Request return</button>` : ""}
    </div>
    <div class="slot"></div>
  </div>`;
}

function wireAccount(tab) {
  const box = $("#acctBody");
  box.addEventListener("click", async (e) => {
    const t = e.target;
    const op = t.closest("[data-open-p]"); if (op) { openProduct(op.dataset.openP); return; }
    const uw = t.closest("[data-unwish]"); if (uw) { await toggleWish(uw.dataset.unwish); renderAccount("wishlist"); return; }
    const da = t.closest("[data-del-addr]");
    if (da) { try { await api(`/account/addresses/${da.dataset.delAddr}`, { method: "DELETE", auth: true }); await loadAccount(); renderAccount("addresses"); } catch (ex) { toast(ex.message); } return; }
    const df = t.closest("[data-default-addr]");
    if (df) {
      const x = state.account.addresses.find((y) => y.id === df.dataset.defaultAddr);
      try { await api(`/account/addresses/${x.id}`, { method: "PATCH", auth: true, body: { ...x, isDefault: true } }); await loadAccount(); renderAccount("addresses"); } catch (ex) { toast(ex.message); }
      return;
    }
    const rv = t.closest("[data-review]");
    if (rv) {
      const slot = rv.closest(".order").querySelector(".slot");
      slot.innerHTML = `<form class="mini-form"><b style="font-size:13px">Review ${esc(rv.dataset.pname)}</b>
        <select name="rating" aria-label="Rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${"★".repeat(n)} (${n})</option>`).join("")}</select>
        <textarea name="reviewText" rows="3" maxlength="2000" placeholder="How does it wear on you? (optional)"></textarea>
        <label style="font-size:12px">Add up to 3 photos (optional)<input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple></label>
        <div class="msg err"></div><button class="btn btn-sm btn-dark" type="submit">Submit review</button></form>`;
      slot.querySelector("form").onsubmit = async (ev) => {
        ev.preventDefault(); const form = ev.target, fd = new FormData(form), msg = form.querySelector(".msg"), btn = form.querySelector("button[type=submit]");
        const files = [...form.photos.files];
        if (files.length > 3) { msg.textContent = "Choose at most 3 photos."; return; }
        if (files.some((f2) => f2.size > 5 * 1024 * 1024)) { msg.textContent = "Each photo must be 5 MB or smaller."; return; }
        btn.disabled = true;
        try {
          const { review } = await api(`/account/orders/${rv.dataset.review}/reviews`, { method: "POST", auth: true, body: { productId: Number(rv.dataset.pid), rating: Number(fd.get("rating")), reviewText: fd.get("reviewText") } });
          if (files.length) {
            const up = new FormData(); files.forEach((f2) => up.append("photos", f2));
            const res = await fetch(`/api/account/reviews/${review.id}/photos`, { method: "POST", headers: { Authorization: "Bearer " + getToken() }, body: up });
            if (!res.ok) { const d = await res.json().catch(() => ({})); toast("Review saved, but photos failed: " + (d.error || res.status)); }
          }
          toast("Thanks! Your review will appear once approved."); await loadAccount(); renderAccount("orders");
        } catch (ex) { msg.textContent = ex.message; btn.disabled = false; }
      };
      return;
    }
    const rt = t.closest("[data-return]");
    if (rt) {
      const slot = rt.closest(".order").querySelector(".slot");
      slot.innerHTML = `<form class="mini-form"><b style="font-size:13px">Request a return</b>
        <select name="reason" aria-label="Reason"><option>Item arrived damaged</option><option>Wrong item received</option><option>Fragrance not as expected</option><option>Other</option></select>
        <textarea name="customerNote" rows="3" maxlength="1000" placeholder="Anything we should know? (optional)"></textarea>
        <div class="msg err"></div><button class="btn btn-sm btn-dark" type="submit">Send request</button></form>`;
      slot.querySelector("form").onsubmit = async (ev) => {
        ev.preventDefault(); const fd = new FormData(ev.target);
        try {
          await api(`/account/orders/${rt.dataset.return}/return-request`, { method: "POST", auth: true, body: { reason: fd.get("reason"), customerNote: fd.get("customerNote") } });
          toast("Return request sent"); await loadAccount(); renderAccount("orders");
        } catch (ex) { ev.target.querySelector(".msg").textContent = ex.message; }
      };
    }
  });
  if (tab === "points") {
    api("/account/points", { auth: true }).then((d) => {
      const kindLabel = { earn: "Earned", redeem: "Redeemed", refund: "Returned", reverse: "Removed", adjust: "Adjustment" };
      $("#ptsBox").innerHTML = `<div class="pts-card"><div><b>${d.balance}</b><span>BUVA points</span></div><div>Worth <b>${inr(d.valuePaise)}</b> on your next order</div></div>
        <p class="sub" style="margin:10px 0 16px">Earn ${d.rules.pointsPer100Rupees} point for every ₹100 you spend, once your order is delivered. Each point is worth ${inr(d.rules.pointValuePaise)}; use them at checkout for up to ${d.rules.maxRedeemPercent}% of an order (from ${d.rules.minRedeemPoints} points).</p>
        ${d.history.length ? d.history.map((h) => `<div class="pts-row"><span><b>${kindLabel[h.kind] || h.kind}</b> · ${esc(h.note || "")}<br><small class="sub">${fmtDate(h.createdAt)}</small></span><span class="${h.points > 0 ? "plus" : "minus"}">${h.points > 0 ? "+" : ""}${h.points}</span></div>`).join("") : `<p class="sub">No points yet — they'll appear here after your first delivered order.</p>`}`;
    }).catch((ex) => { $("#ptsBox").innerHTML = `<p class="msg err">${esc(ex.message)}</p>`; });
  }
  if (tab === "profile") {
    api("/account/price-alerts", { auth: true }).then((d) => { const cb = $("#profileForm [name=priceAlerts]"); if (cb) cb.checked = d.enabled; }).catch(() => {});
    $("#profileForm").onsubmit = async (e) => {
      e.preventDefault(); const f = e.target, m = $("#pMsg");
      try {
        await api("/account/profile", { method: "PATCH", auth: true, body: { fullName: f.fullName.value, phone: f.phone.value } });
        await api("/account/notification-preferences", { method: "PUT", auth: true, body: { orderUpdates: f.orderUpdates.checked, marketing: f.marketing.checked } });
        await api("/account/price-alerts", { method: "PUT", auth: true, body: { enabled: f.priceAlerts.checked } });
        await loadAccount(); m.className = "msg ok"; m.textContent = "Saved.";
      } catch (ex) { m.className = "msg err"; m.textContent = ex.message; }
    };
    $("#logoutBtn").onclick = async () => {
      try { await api("/auth/logout", { method: "POST", auth: true }); } catch {}
      clearToken(); state.account = null; state.filter.family = state.filter.family === "wishlist" ? "all" : state.filter.family;
      updateBadges(); renderChips(); renderGrid(); closeAll(); toast("Signed out");
    };
  }
}
$("#accountBtn").addEventListener("click", () => openAccount("orders"));
$("#footAccount").addEventListener("click", () => openAccount("orders"));

/* ---------------- scent finder ---------------- */
const QUIZ = [
  { q: "When do you most want to wear it?", o: [["Every day", "Office, errands, all day", { fresh: 2, floral: 1 }], ["Evenings out", "Dinners, parties, dates", { woody: 2, floral: 1 }], ["Celebrations", "Weddings & festivals", { floral: 2, woody: 1 }], ["As a gift", "For someone else", { sets: 3 }]] },
  { q: "Which of these draws you in?", o: [["Fresh flowers", "Jasmine, tuberose, vanilla", { floral: 3 }], ["Warm & deep", "Oud, saffron, patchouli", { woody: 3 }], ["Clean & coastal", "Vetiver, citrus, sea salt", { fresh: 3 }], ["I can't choose", "Let me try several", { sets: 3 }]] },
  { q: "How should it feel on you?", o: [["Soft & close", "Noticed up close", { floral: 1, fresh: 1 }], ["Bold & memorable", "Leaves a trail", { woody: 2 }], ["Light & energising", "A lift to the day", { fresh: 2 }], ["Romantic", "Creamy, glowing", { floral: 2 }]] },
];
let qi = 0, scores = {};
async function renderQuiz() {
  const prog = `<div class="qprog">${QUIZ.map((_, k) => `<i class="${k <= qi ? "on" : ""}"></i>`).join("")}</div>`;
  if (qi < QUIZ.length) {
    const s = QUIZ[qi];
    $("#quiz").innerHTML = `${prog}<div class="fade"><h3>${s.q}</h3><div class="opts">${s.o.map((o, k) => `<button class="opt" data-k="${k}"><b>${o[0]}</b><span>${o[1]}</span></button>`).join("")}</div></div>`;
    $$(".opt", $("#quiz")).forEach((b) => b.onclick = () => { const w = s.o[+b.dataset.k][2]; for (const f in w) scores[f] = (scores[f] || 0) + w[f]; qi++; renderQuiz(); });
    return;
  }
  const fam = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  const p = state.products.filter((x) => x.scentFamily === fam && x.availableQuantity > 0).sort((a, b) => (b.featured - a.featured) || (b.averageRating - a.averageRating))[0]
    || state.products.find((x) => x.scentFamily === fam);
  $("#quiz").innerHTML = `<div class="qprog">${QUIZ.map(() => `<i class="on"></i>`).join("")}</div><div class="fade center">
    <div class="eyebrow" style="color:var(--gold);margin-bottom:6px">Your scent family</div><h3 style="margin-bottom:0">${esc(famName(fam))}</h3>
    ${p ? `<div class="res-card"><div class="media">${picture(p.imageUrl, p.name)}</div><div><div class="fam-label">We recommend</div><h4 style="font-family:var(--serif);font-size:30px;font-weight:500">${esc(p.name)}</h4><p class="sub" style="font-size:14px;margin:6px 0 10px">${esc(p.shortDescription || "")}</p><b>${inr(p.pricePaise)}</b></div></div>
    <button class="btn btn-dark" id="qView">View ${esc(p.name)}</button>` : `<p class="sub">Browse the ${esc(famName(fam))} family in the shop.</p>`}
    <button class="btn btn-line" id="qAgain" style="margin-left:8px">Retake</button></div>`;
  const v = $("#qView"); if (v) v.onclick = () => openProduct(p.slug);
  $("#qAgain").onclick = () => { qi = 0; scores = {}; renderQuiz(); };
}

/* ---------------- support, newsletter, banners ---------------- */
$("#supportForm").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target, m = $("#supportMsg"), btn = f.querySelector("button");
  const data = Object.fromEntries(new FormData(f).entries());
  if (!data.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || data.message.trim().length < 10) {
    m.className = "msg err"; m.textContent = "Please add your name, a valid email and a message of at least 10 characters."; return;
  }
  btn.disabled = true;
  try {
    const { ticket } = await api("/support", { method: "POST", body: data, auth: "optional" });
    m.className = "msg ok"; m.textContent = `Thank you — we've received your message (reference ${String(ticket.id).slice(0, 8).toUpperCase()}). We'll reply by email.`;
    f.message.value = ""; if (getToken()) loadAccount();
  } catch (ex) { m.className = "msg err"; m.textContent = ex.message; }
  btn.disabled = false;
});
$("#newsForm").addEventListener("submit", async (e) => {
  e.preventDefault(); const m = $("#newsMsg"), email = $("#newsEmail").value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { m.textContent = "Please enter a valid email."; return; }
  try { await api("/newsletter", { method: "POST", body: { email } }); m.textContent = "Welcome to the BUVA journal ✦"; $("#newsEmail").value = ""; }
  catch (ex) { m.textContent = ex.message; }
});
async function loadBanners() {
  const render = (b) => `<div class="banner-strip">${esc(b.title)}${b.subtitle ? " · " + esc(b.subtitle) : ""}${b.linkUrl && /^(\/|#|https?:\/\/)/.test(b.linkUrl) ? ` · <a href="${esc(b.linkUrl)}">Shop now</a>` : ""}</div>`;
  try { const { banners } = await api("/banners?placement=home"); if (banners[0]) $("#homeBanner").innerHTML = render(banners[0]); } catch {}
  try { const { banners } = await api("/banners?placement=shop"); if (banners[0]) $("#shopBanner").innerHTML = render(banners[0]).replace('class="banner-strip"', 'class="banner-strip" style="margin-bottom:24px;border-radius:2px"'); } catch {}
}

/* ---------------- assistant ---------------- */
const askBox = $("#ask"), askBtn = $("#askBtn");
askBtn.addEventListener("click", () => { askBox.classList.toggle("open"); askBtn.setAttribute("aria-expanded", askBox.classList.contains("open")); if (askBox.classList.contains("open")) $("#askInput").focus(); });
$("#askClose").addEventListener("click", () => askBox.classList.remove("open"));
$("#askForm").addEventListener("submit", async (e) => {
  e.preventDefault(); const input = $("#askInput"), q = input.value.trim(); if (q.length < 2) return;
  const log = $("#askLog"); input.value = "";
  log.insertAdjacentHTML("beforeend", `<div class="bubble me">${esc(q)}</div><div class="bubble bot" id="typing">…</div>`); log.scrollTop = log.scrollHeight;
  try {
    const r = await api("/assistant", { method: "POST", body: { question: q } });
    $("#typing").outerHTML = `<div class="bubble bot">${esc(r.answer)}${r.products?.length ? `<div class="chips">${r.products.map((p) => `<button class="chip" data-ask-open="${esc(p.slug)}">${esc(p.name)}</button>`).join("")}</div>` : ""}</div>`;
  } catch (ex) { $("#typing").outerHTML = `<div class="bubble bot">Sorry, I couldn't answer that right now (${esc(ex.message)}).</div>`; }
  log.scrollTop = log.scrollHeight;
});
$("#askLog").addEventListener("click", (e) => { const b = e.target.closest("[data-ask-open]"); if (b) openProduct(b.dataset.askOpen); });

/* ---------------- start ---------------- */
async function init() {
  $("#year").textContent = new Date().getFullYear();
  // Google sign-in returns here with ?google_session=<token>
  const params = new URLSearchParams(location.search);
  const g = params.get("google_session");
  if (g && /^[0-9a-f]{64}$/i.test(g)) {
    setToken(g); params.delete("google_session");
    history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : "") + location.hash);
  }
  const [cats, prods, pay, offers] = await Promise.allSettled([api("/categories"), api("/products?sort=featured"), api("/payments/config"), api("/offers")]);
  if (offers.status === "fulfilled") state.offers = offers.value;
  if (cats.status === "fulfilled") state.categories = cats.value.categories;
  if (prods.status === "fulfilled") state.products = prods.value.products;
  if (pay.status === "fulfilled") state.razorpay = pay.value.razorpay;
  if (prods.status === "rejected") { $("#grid").innerHTML = `<div class="empty">The store is temporarily unavailable. Please refresh in a moment.</div>`; }
  renderFamilies(state.products); renderChips(); renderDeals(); renderRecent();
  await Promise.all([loadAccount(), refreshCart()]);
  if (prods.status === "fulfilled") renderGrid();
  renderQuiz(); loadBanners();

  const after = store.get("buvaPostLoginReturn", sessionStorage);
  if (g) {
    store.del("buvaPostLoginReturn", sessionStorage);
    if (state.account) { toast(`Welcome, ${state.account.customer.fullName.split(" ")[0]}`); if (after === "checkout" && state.cart?.items?.length) openCheckout(); else renderAccount("orders"); }
    else toast("Google sign-in didn't complete. Please try again.");
  } else if (params.get("product")) openProduct(params.get("product"));
  else if (location.hash === "#account") openAccount("orders");
}
window.addEventListener("hashchange", () => { if (location.hash === "#account") openAccount("orders"); });
init();
})();
