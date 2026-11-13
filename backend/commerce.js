// BUVA commerce features: pricing engine (coupons, combos, points, gift wrap), product extras
// (gallery, sizes, bought-together, similar), search suggestions, review photos & helpful votes,
// back-in-stock / price-drop alerts, timed deals and BUVA points — plus their admin endpoints.
import crypto from "node:crypto";
import multer from "multer";

const envInt = (name, fallback) => {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

export const commerceConfig = {
  freeShippingFromPaise: 150000,
  shippingFeePaise: 9900,
  giftWrapPaise: envInt("GIFT_WRAP_FEE_PAISE", 4900),
  pointsPer100Rupees: envInt("POINTS_PER_100_RUPEES", 1),
  pointValuePaise: envInt("POINT_VALUE_PAISE", 100),
  maxRedeemPercent: Math.min(envInt("POINTS_MAX_REDEEM_PERCENT", 20), 100),
  minRedeemPoints: envInt("POINTS_MIN_REDEEM", 50),
  pointsFrom: process.env.POINTS_FROM || "2026-11-13"
};

export const initCommerce = ({
  app, pool, ApiError, asyncRoute, requireAdmin, getCustomerSession, getCart, sendEmail,
  productSelect, uploadsDir, withTransaction, siteUrl = "https://buva.shop"
}) => {
  const cfg = commerceConfig;
  const inr = (paise) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(paise) / 100)}`;
  const productUrl = (slug) => `${siteUrl.replace(/\/$/, "")}/?product=${encodeURIComponent(slug)}`;
  const isEmail = (v) => typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const text = (value, label, { min = 0, max = 200, optional = true } = {}) => {
    const t = typeof value === "string" ? value.trim() : "";
    if (optional && !t) return null;
    if (t.length < Math.max(min, optional ? 0 : 1) || t.length > max) throw new ApiError(400, `${label} must be ${min}-${max} characters`);
    return t;
  };
  const positiveInt = (value, label, { min = 1, max = 100_000_000 } = {}) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new ApiError(400, `${label} must be a whole number between ${min} and ${max}`);
    return n;
  };
  const optionalDate = (value, label) => {
    if (value === undefined || value === null || value === "") return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new ApiError(400, `${label} is not a valid date`);
    return d.toISOString();
  };

  // ---------------------------------------------------------------------------------------------
  // Pricing engine — used by both the bag preview (quote) and checkout, so totals always agree.
  // items: [{ product_id|productId, unit_price_paise|pricePaise, quantity, scent_family|scentFamily }]
  // ---------------------------------------------------------------------------------------------
  const pointsBalance = async (client, customerId, lock = false) => {
    if (lock) await client.query("SELECT id FROM customers WHERE id=$1 FOR UPDATE", [customerId]);
    const r = await client.query("SELECT COALESCE(SUM(points),0)::INTEGER AS balance FROM loyalty_ledger WHERE customer_id=$1", [customerId]);
    return r.rows[0].balance;
  };

  const activeCombos = async (client) => (await client.query(`
    SELECT id, title, min_quantity, scent_family, discount_type, discount_value, stack_with_coupons
    FROM combo_offers
    WHERE active AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at > NOW())
    ORDER BY id`)).rows;

  const comboDiscountFor = (combo, lines) => {
    const eligible = lines.filter((l) => !combo.scent_family || l.family === combo.scent_family);
    const qty = eligible.reduce((s, l) => s + l.quantity, 0);
    const amount = eligible.reduce((s, l) => s + l.price * l.quantity, 0);
    if (qty < combo.min_quantity || amount <= 0) return { qty, amount, discount: 0 };
    const discount = combo.discount_type === "percentage"
      ? Math.floor(amount * combo.discount_value / 100)
      : Math.min(combo.discount_value, amount);
    return { qty, amount, discount };
  };

  const computePricing = async (client, {
    items, customer = null, couponCode = null, redeemPoints = 0, giftWrap = false, strict = false, lock = false
  }) => {
    const lines = items.map((i) => ({
      price: Number(i.unit_price_paise ?? i.pricePaise),
      quantity: Number(i.quantity),
      family: i.scent_family ?? i.scentFamily ?? null
    }));
    const subtotalPaise = lines.reduce((s, l) => s + l.price * l.quantity, 0);
    const notes = [];

    // coupon (same rules as before)
    let coupon = null, couponDiscountPaise = 0, couponError = null;
    if (couponCode) {
      const r = await client.query(`
        SELECT c.id, c.code, c.discount_type, c.discount_value, c.minimum_order_paise, c.usage_limit,
          (SELECT COUNT(*)::INTEGER FROM orders o WHERE o.coupon_id = c.id AND o.status <> 'cancelled') AS usage_count
        FROM coupons c
        WHERE c.code = $1 AND c.active = TRUE
          AND (c.starts_at IS NULL OR c.starts_at <= NOW()) AND (c.ends_at IS NULL OR c.ends_at >= NOW())
        ${lock ? "FOR UPDATE OF c" : ""}`, [String(couponCode).toUpperCase()]);
      const c = r.rows[0];
      if (!c) couponError = "Coupon is invalid or expired";
      else if (subtotalPaise < c.minimum_order_paise) couponError = `Coupon requires a minimum order of ₹${Math.ceil(c.minimum_order_paise / 100)}`;
      else if (c.usage_limit !== null && c.usage_count >= c.usage_limit) couponError = "Coupon usage limit has been reached";
      else {
        coupon = c;
        couponDiscountPaise = c.discount_type === "percentage"
          ? Math.min(subtotalPaise, Math.floor(subtotalPaise * c.discount_value / 100))
          : Math.min(c.discount_value, subtotalPaise);
      }
      if (couponError && strict) throw new ApiError(400, couponError);
    }

    // best combo offer, plus a nudge towards the nearest one not yet reached
    let combo = null, comboDiscountPaise = 0, comboNudge = null;
    for (const c of await activeCombos(client)) {
      const res = comboDiscountFor(c, lines);
      if (res.discount > comboDiscountPaise) { combo = c; comboDiscountPaise = res.discount; }
      else if (!res.discount && res.qty > 0 && (!comboNudge || c.min_quantity - res.qty < comboNudge.needed)) {
        comboNudge = {
          id: c.id, title: c.title, needed: c.min_quantity - res.qty, scentFamily: c.scent_family,
          discountType: c.discount_type, discountValue: c.discount_value
        };
      }
    }
    if (combo && coupon && !combo.stack_with_coupons) {
      if (couponDiscountPaise >= comboDiscountPaise) {
        notes.push(`“${combo.title}” can’t be combined with coupons — your coupon saves more, so it was applied instead.`);
        combo = null; comboDiscountPaise = 0;
      } else {
        notes.push(`Coupon ${coupon.code} can’t be combined with “${combo.title}”, which saves you more.`);
        couponError = couponError || `Not combinable with “${combo.title}”`;
        coupon = null; couponDiscountPaise = 0;
        if (strict) { /* checkout silently keeps the better offer */ }
      }
    }

    // BUVA points
    const afterOffers = Math.max(0, subtotalPaise - couponDiscountPaise - comboDiscountPaise);
    let pointsBalanceNow = 0, pointsRedeemed = 0, pointsDiscountPaise = 0, maxRedeemablePoints = 0;
    if (customer) {
      pointsBalanceNow = await pointsBalance(client, customer.id, lock);
      const capPaise = Math.floor(afterOffers * cfg.maxRedeemPercent / 100);
      maxRedeemablePoints = cfg.pointValuePaise > 0 ? Math.min(pointsBalanceNow, Math.floor(capPaise / cfg.pointValuePaise)) : 0;
      const requested = Number.isInteger(Number(redeemPoints)) ? Math.max(0, Number(redeemPoints)) : 0;
      if (requested > 0) {
        if (maxRedeemablePoints < cfg.minRedeemPoints) {
          if (strict) throw new ApiError(400, `You need at least ${cfg.minRedeemPoints} redeemable points`);
        } else {
          pointsRedeemed = Math.min(requested, maxRedeemablePoints);
          if (pointsRedeemed < cfg.minRedeemPoints) pointsRedeemed = 0;
          pointsDiscountPaise = pointsRedeemed * cfg.pointValuePaise;
        }
      }
    } else if (Number(redeemPoints) > 0 && strict) {
      throw new ApiError(401, "Sign in to redeem BUVA points");
    }

    const discountPaise = couponDiscountPaise + comboDiscountPaise + pointsDiscountPaise;
    const shippingPaise = subtotalPaise === 0 || subtotalPaise >= cfg.freeShippingFromPaise ? 0 : cfg.shippingFeePaise;
    const giftWrapPaise = giftWrap ? cfg.giftWrapPaise : 0;
    const totalPaise = Math.max(0, subtotalPaise - discountPaise) + shippingPaise + giftWrapPaise;
    const pointsToEarn = Math.floor(Math.max(0, subtotalPaise - discountPaise) / 10000) * cfg.pointsPer100Rupees;

    return {
      subtotalPaise, couponId: coupon?.id || null, couponCode: coupon?.code || null, couponDiscountPaise, couponError,
      comboOfferId: combo?.id || null, comboTitle: combo?.title || null, comboDiscountPaise, comboNudge,
      pointsBalance: pointsBalanceNow, maxRedeemablePoints, pointsRedeemed, pointsDiscountPaise, pointsToEarn,
      discountPaise, shippingPaise, freeShippingFromPaise: cfg.freeShippingFromPaise,
      giftWrap: !!giftWrap, giftWrapPaise, giftWrapFeePaise: cfg.giftWrapPaise, totalPaise, notes
    };
  };

  // called inside the checkout transaction after the order row exists
  const recordOrderExtras = async (client, orderId, customer, pricing, giftMessage) => {
    await client.query(`UPDATE orders SET coupon_discount_paise=$2, combo_discount_paise=$3, combo_offer_id=$4,
        points_redeemed=$5, points_discount_paise=$6, gift_wrap=$7, gift_message=$8, gift_wrap_paise=$9 WHERE id=$1`,
      [orderId, pricing.couponDiscountPaise, pricing.comboDiscountPaise, pricing.comboOfferId, pricing.pointsRedeemed,
        pricing.pointsDiscountPaise, pricing.giftWrap, pricing.giftWrap ? giftMessage : null, pricing.giftWrapPaise]);
    if (customer && pricing.pointsRedeemed > 0) {
      await client.query(`INSERT INTO loyalty_ledger (customer_id, order_id, kind, points, note) VALUES ($1,$2,'redeem',$3,'Redeemed at checkout')`,
        [customer.id, orderId, -pricing.pointsRedeemed]);
    }
  };

  const parseGiftMessage = (body = {}) => text(body.giftMessage, "Gift message", { max: 200 });

  // ---------------------------------------------------------------------------------------------
  // Bag preview, offers, coupons
  // ---------------------------------------------------------------------------------------------
  app.post("/api/carts/:sessionToken/quote", asyncRoute(async (request, response) => {
    const cart = await getCart(request.params.sessionToken);
    if (!cart) throw new ApiError(404, "Cart not found or expired");
    let customer = null;
    try { customer = await getCustomerSession(request); } catch { customer = null; }
    const pricing = await computePricing(pool, {
      items: cart.items, customer,
      couponCode: typeof request.body?.couponCode === "string" && request.body.couponCode.trim() ? request.body.couponCode.trim() : null,
      redeemPoints: request.body?.redeemPoints, giftWrap: request.body?.giftWrap === true
    });
    response.json({ quote: pricing, signedIn: !!customer, pointValuePaise: cfg.pointValuePaise, minRedeemPoints: cfg.minRedeemPoints });
  }));

  app.get("/api/coupons/available", asyncRoute(async (request, response) => {
    const token = typeof request.query.sessionToken === "string" ? request.query.sessionToken : "";
    const cart = token ? await getCart(token) : null;
    const subtotal = cart?.subtotalPaise || 0;
    const r = await pool.query(`
      SELECT c.code, c.description, c.discount_type AS "discountType", c.discount_value AS "discountValue",
        c.minimum_order_paise AS "minimumOrderPaise", c.ends_at AS "endsAt"
      FROM coupons c
      WHERE c.active AND c.show_in_store
        AND (c.starts_at IS NULL OR c.starts_at <= NOW()) AND (c.ends_at IS NULL OR c.ends_at >= NOW())
        AND (c.usage_limit IS NULL OR (SELECT COUNT(*) FROM orders o WHERE o.coupon_id=c.id AND o.status <> 'cancelled') < c.usage_limit)
      ORDER BY c.minimum_order_paise, c.code`);
    response.json({
      coupons: r.rows.map((c) => {
        const eligible = subtotal >= c.minimumOrderPaise;
        const discountPaise = !eligible ? 0 : c.discountType === "percentage"
          ? Math.floor(subtotal * c.discountValue / 100) : Math.min(c.discountValue, subtotal);
        return {
          ...c,
          label: c.discountType === "percentage" ? `${c.discountValue}% off` : `${inr(c.discountValue)} off`,
          eligible, shortfallPaise: eligible ? 0 : c.minimumOrderPaise - subtotal, discountPaise
        };
      })
    });
  }));

  app.get("/api/offers", asyncRoute(async (_request, response) => {
    const [combos, deals] = await Promise.all([
      activeCombos(pool),
      pool.query(`${productSelect} WHERE p.active AND c.active AND deal."dealEndsAt" IS NOT NULL ORDER BY deal."dealEndsAt" LIMIT 12`)
    ]);
    response.json({
      combos: combos.map((c) => ({
        id: c.id, title: c.title, minQuantity: c.min_quantity, scentFamily: c.scent_family,
        discountType: c.discount_type, discountValue: c.discount_value, stackWithCoupons: c.stack_with_coupons
      })),
      deals: deals.rows,
      giftWrapFeePaise: cfg.giftWrapPaise,
      points: { pointsPer100Rupees: cfg.pointsPer100Rupees, pointValuePaise: cfg.pointValuePaise, maxRedeemPercent: cfg.maxRedeemPercent, minRedeemPoints: cfg.minRedeemPoints }
    });
  }));

  // ---------------------------------------------------------------------------------------------
  // Product extras, reviews, search suggestions
  // ---------------------------------------------------------------------------------------------
  const cardsByIds = async (ids) => {
    if (!ids.length) return [];
    const r = await pool.query(`${productSelect} WHERE p.id = ANY($1::BIGINT[]) AND p.active AND c.active`, [ids]);
    const byId = new Map(r.rows.map((row) => [String(row.id), row]));
    return ids.map((id) => byId.get(String(id))).filter(Boolean);
  };

  app.get("/api/products/:slug/extras", asyncRoute(async (request, response) => {
    const base = await pool.query("SELECT id, variant_group, scent_family FROM products WHERE slug=$1 AND active", [request.params.slug]);
    if (!base.rowCount) throw new ApiError(404, "Product not found");
    const p = base.rows[0];

    const [images, variants, together, summary, deal] = await Promise.all([
      pool.query(`SELECT id, image_url AS "url", alt_text AS "alt" FROM product_images WHERE product_id=$1 ORDER BY display_order, id`, [p.id]),
      p.variant_group ? pool.query(`
        SELECT p.id, p.slug, p.size_ml AS "sizeMl", p.concentration, p.price_paise AS "pricePaise",
          p.compare_at_price_paise AS "compareAtPricePaise", COALESCE(i.quantity - i.reserved_quantity, 0) AS "availableQuantity"
        FROM products p LEFT JOIN inventory i ON i.product_id=p.id
        WHERE p.variant_group=$1 AND p.active ORDER BY p.size_ml, p.price_paise`, [p.variant_group]) : { rows: [] },
      pool.query(`
        SELECT oi2.product_id, COUNT(DISTINCT oi2.order_id) AS n
        FROM order_items oi1
        JOIN orders o ON o.id = oi1.order_id AND o.status NOT IN ('cancelled')
        JOIN order_items oi2 ON oi2.order_id = oi1.order_id AND oi2.product_id <> oi1.product_id
        JOIN products p2 ON p2.id = oi2.product_id AND p2.active
        WHERE oi1.product_id = $1 AND (p2.variant_group IS NULL OR p2.variant_group IS DISTINCT FROM $2)
        GROUP BY oi2.product_id ORDER BY n DESC, oi2.product_id LIMIT 3`, [p.id, p.variant_group]),
      pool.query(`SELECT rating, COUNT(*)::INTEGER AS n FROM product_reviews WHERE product_id=$1 AND status='approved' GROUP BY rating`, [p.id]),
      pool.query(`SELECT d.title, d.ends_at AS "endsAt", d.deal_price_paise AS "dealPricePaise", d.original_price_paise AS "originalPricePaise"
        FROM deals d WHERE d.product_id=$1 AND d.status='active' AND d.ends_at > NOW() LIMIT 1`, [p.id])
    ]);

    // bought together: real co-purchases first, then best-rated items from other families (in stock)
    let togetherIds = together.rows.map((r) => String(r.product_id));
    if (togetherIds.length < 2) {
      const fill = await pool.query(`
        SELECT p.id FROM products p JOIN categories c ON c.id=p.category_id AND c.active
        LEFT JOIN inventory i ON i.product_id=p.id
        WHERE p.active AND p.id <> $1 AND p.scent_family <> $2 AND COALESCE(i.quantity - i.reserved_quantity,0) > 0
          AND (p.variant_group IS NULL OR p.variant_group IS DISTINCT FROM $3) AND NOT (p.id::TEXT = ANY($4::TEXT[]))
        ORDER BY p.featured DESC, p.price_paise ASC, p.id LIMIT $5`, [p.id, p.scent_family, p.variant_group, togetherIds, 2 - togetherIds.length]);
      togetherIds = togetherIds.concat(fill.rows.map((r) => String(r.id)));
    }
    const similar = await pool.query(`
      SELECT p.id FROM products p JOIN categories c ON c.id=p.category_id AND c.active
      WHERE p.active AND p.id <> $1 AND (p.variant_group IS NULL OR p.variant_group IS DISTINCT FROM $2)
      ORDER BY (p.scent_family = $3) DESC, p.featured DESC, p.id LIMIT 8`, [p.id, p.variant_group, p.scent_family]);

    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const r of summary.rows) counts[r.rating] = r.n;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const average = total ? Math.round((Object.entries(counts).reduce((s, [k, v]) => s + Number(k) * v, 0) / total) * 10) / 10 : 0;

    response.json({
      images: images.rows,
      variants: variants.rows,
      boughtTogether: await cardsByIds(togetherIds),
      similar: await cardsByIds(similar.rows.map((r) => String(r.id))),
      reviewSummary: { average, total, counts },
      deal: deal.rows[0] || null
    });
  }));

  const voterKey = (request, customer) => customer
    ? `c:${customer.id}`
    : "a:" + crypto.createHash("sha256").update(`${request.ip}|${request.get("user-agent") || ""}`).digest("hex").slice(0, 32);

  app.get("/api/products/:slug/reviews", asyncRoute(async (request, response) => {
    const sort = { helpful: `"helpfulCount" DESC, r.created_at DESC`, newest: "r.created_at DESC", highest: "r.rating DESC, r.created_at DESC", lowest: "r.rating ASC, r.created_at DESC" }[request.query.sort] || `"helpfulCount" DESC, r.created_at DESC`;
    const rating = Number(request.query.rating);
    const values = [request.params.slug];
    let filter = "";
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) { values.push(rating); filter += ` AND r.rating = $${values.length}`; }
    if (request.query.withPhotos === "1") filter += " AND EXISTS (SELECT 1 FROM review_photos rp WHERE rp.review_id = r.id)";
    let customer = null;
    try { customer = await getCustomerSession(request); } catch { customer = null; }
    values.push(voterKey(request, customer));
    const r = await pool.query(`
      SELECT r.id, r.rating, r.review_text AS "reviewText", r.created_at AS "createdAt",
        LEFT(cu.full_name, 1) || '***' AS "reviewerName", TRUE AS "verifiedPurchase",
        (SELECT COUNT(*)::INTEGER FROM review_votes v WHERE v.review_id = r.id) AS "helpfulCount",
        EXISTS (SELECT 1 FROM review_votes v WHERE v.review_id = r.id AND v.voter_key = $${values.length}) AS "votedHelpful",
        COALESCE((SELECT json_agg(rp.image_url ORDER BY rp.id) FROM review_photos rp WHERE rp.review_id = r.id), '[]') AS photos
      FROM product_reviews r JOIN products p ON p.id = r.product_id JOIN customers cu ON cu.id = r.customer_id
      WHERE p.slug = $1 AND r.status = 'approved' ${filter}
      ORDER BY ${sort} LIMIT 60`, values);
    response.json({ reviews: r.rows });
  }));

  app.post("/api/reviews/:reviewId/helpful", asyncRoute(async (request, response) => {
    const id = String(request.params.reviewId || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(400, "Invalid review");
    const exists = await pool.query("SELECT 1 FROM product_reviews WHERE id=$1 AND status='approved'", [id]);
    if (!exists.rowCount) throw new ApiError(404, "Review not found");
    let customer = null;
    try { customer = await getCustomerSession(request); } catch { customer = null; }
    await pool.query("INSERT INTO review_votes (review_id, voter_key) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, voterKey(request, customer)]);
    const n = await pool.query("SELECT COUNT(*)::INTEGER AS n FROM review_votes WHERE review_id=$1", [id]);
    response.json({ helpfulCount: n.rows[0].n, votedHelpful: true });
  }));

  // photo uploads (review photos from customers, gallery photos from admin)
  const imageTypes = new Map([["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"]]);
  const makeUpload = (maxFiles) => multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadsDir),
      filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${imageTypes.get(file.mimetype) || ".bin"}`)
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: maxFiles },
    fileFilter: (_req, file, cb) => imageTypes.has(file.mimetype) ? cb(null, true) : cb(new ApiError(400, "Only JPEG, PNG and WebP images are allowed"))
  });
  const uploadReviewPhotos = makeUpload(3);
  const uploadGallery = makeUpload(10);
  const withUpload = (mw, field, max) => (request, response, next) => mw.array(field, max)(request, response, (err) => {
    if (!err) return next();
    if (err instanceof ApiError) return next(err);
    next(new ApiError(400, err.code === "LIMIT_FILE_SIZE" ? "Each photo must be 5 MB or smaller" : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE" ? `Upload at most ${max} photos` : "Upload failed"));
  });

  app.post("/api/account/reviews/:reviewId/photos", withUpload(uploadReviewPhotos, "photos", 3), asyncRoute(async (request, response) => {
    const customer = await getCustomerSession(request, pool, true);
    const files = request.files || [];
    if (!files.length) throw new ApiError(400, "Choose at least one photo");
    const owned = await pool.query("SELECT id FROM product_reviews WHERE id=$1 AND customer_id=$2", [request.params.reviewId, customer.id]);
    if (!owned.rowCount) throw new ApiError(404, "Review not found");
    const existing = await pool.query("SELECT COUNT(*)::INTEGER AS n FROM review_photos WHERE review_id=$1", [request.params.reviewId]);
    if (existing.rows[0].n + files.length > 3) throw new ApiError(400, "A review can have at most 3 photos");
    for (const f of files) await pool.query("INSERT INTO review_photos (review_id, image_url) VALUES ($1,$2)", [request.params.reviewId, `/uploads/${f.filename}`]);
    response.status(201).json({ photos: files.map((f) => `/uploads/${f.filename}`) });
  }));

  app.get("/api/search/suggest", asyncRoute(async (request, response) => {
    const q = typeof request.query.q === "string" ? request.query.q.trim().slice(0, 60) : "";
    if (q.length < 2) return response.json({ products: [], families: [] });
    const like = `%${q}%`;
    const [products, families] = await Promise.all([
      pool.query(`
        SELECT p.slug, p.name, p.size_ml AS "sizeMl", p.short_description AS "shortDescription", p.price_paise AS "pricePaise",
          (SELECT image_url FROM product_images WHERE product_id=p.id ORDER BY display_order, id LIMIT 1) AS "imageUrl"
        FROM products p JOIN categories c ON c.id=p.category_id AND c.active
        WHERE p.active AND (p.name ILIKE $1 OR p.short_description ILIKE $1 OR p.description ILIKE $1)
        ORDER BY (p.name ILIKE $2) DESC, (p.name ILIKE $1) DESC, p.featured DESC, p.name LIMIT 6`, [like, `${q}%`]),
      pool.query(`SELECT slug, name FROM categories WHERE active AND (name ILIKE $1 OR description ILIKE $1) ORDER BY display_order LIMIT 3`, [like])
    ]);
    response.json({ products: products.rows, families: families.rows });
  }));

  // ---------------------------------------------------------------------------------------------
  // Alerts: back in stock, price drop
  // ---------------------------------------------------------------------------------------------
  app.post("/api/alerts", asyncRoute(async (request, response) => {
    const kind = request.body?.kind;
    if (!["back_in_stock", "price_drop"].includes(kind)) throw new ApiError(400, "Invalid alert type");
    const productId = positiveInt(request.body?.productId, "productId");
    let customer = null;
    try { customer = await getCustomerSession(request); } catch { customer = null; }
    const email = (typeof request.body?.email === "string" && request.body.email.trim() ? request.body.email.trim() : customer?.email || "").toLowerCase();
    if (!isEmail(email)) throw new ApiError(400, "A valid email is required");
    const p = await pool.query("SELECT p.price_paise FROM products p WHERE p.id=$1 AND p.active", [productId]);
    if (!p.rowCount) throw new ApiError(404, "Product not found");
    const dup = await pool.query("SELECT 1 FROM stock_alerts WHERE product_id=$1 AND lower(email)=$2 AND kind=$3 AND notified_at IS NULL", [productId, email, kind]);
    if (!dup.rowCount) {
      await pool.query("INSERT INTO stock_alerts (product_id, email, customer_id, kind, price_at_request_paise) VALUES ($1,$2,$3,$4,$5)",
        [productId, email, customer?.id || null, kind, p.rows[0].price_paise]);
    }
    response.status(201).json({ ok: true, email, kind });
  }));

  // ---------------------------------------------------------------------------------------------
  // BUVA points
  // ---------------------------------------------------------------------------------------------
  app.get("/api/account/points", asyncRoute(async (request, response) => {
    const customer = await getCustomerSession(request, pool, true);
    const [balance, history] = await Promise.all([
      pointsBalance(pool, customer.id),
      pool.query(`SELECT l.kind, l.points, l.note, l.created_at AS "createdAt", o.order_number AS "orderNumber"
        FROM loyalty_ledger l LEFT JOIN orders o ON o.id=l.order_id WHERE l.customer_id=$1 ORDER BY l.created_at DESC, l.id DESC LIMIT 50`, [customer.id])
    ]);
    response.json({
      balance, valuePaise: balance * cfg.pointValuePaise, history: history.rows,
      rules: { pointsPer100Rupees: cfg.pointsPer100Rupees, pointValuePaise: cfg.pointValuePaise, maxRedeemPercent: cfg.maxRedeemPercent, minRedeemPoints: cfg.minRedeemPoints }
    });
  }));

  app.get("/api/account/price-alerts", asyncRoute(async (request, response) => {
    const customer = await getCustomerSession(request, pool, true);
    const r = await pool.query("SELECT price_alerts FROM notification_preferences WHERE customer_id=$1", [customer.id]);
    response.json({ enabled: r.rows[0]?.price_alerts !== false });
  }));
  app.put("/api/account/price-alerts", asyncRoute(async (request, response) => {
    const customer = await getCustomerSession(request, pool, true);
    if (typeof request.body?.enabled !== "boolean") throw new ApiError(400, "enabled must be true or false");
    await pool.query(`INSERT INTO notification_preferences (customer_id, price_alerts) VALUES ($1,$2)
      ON CONFLICT (customer_id) DO UPDATE SET price_alerts=EXCLUDED.price_alerts, updated_at=NOW()`, [customer.id, request.body.enabled]);
    response.json({ enabled: request.body.enabled });
  }));

  const settlePoints = async (orderId = null) => {
    const filter = orderId ? "AND o.id = $2" : "";
    const params = orderId ? [cfg.pointsFrom, orderId] : [cfg.pointsFrom];
    // earn when delivered
    await pool.query(`
      INSERT INTO loyalty_ledger (customer_id, order_id, kind, points, note)
      SELECT o.customer_id, o.id, 'earn',
        (FLOOR(GREATEST(o.subtotal_paise - o.discount_paise, 0) / 10000.0) * ${cfg.pointsPer100Rupees})::INTEGER,
        'Earned on order ' || o.order_number
      FROM orders o
      WHERE o.status = 'delivered' AND o.customer_id IS NOT NULL AND o.created_at >= $1::DATE ${filter}
        AND FLOOR(GREATEST(o.subtotal_paise - o.discount_paise, 0) / 10000.0) * ${cfg.pointsPer100Rupees} > 0
      ON CONFLICT (order_id, kind) WHERE order_id IS NOT NULL AND kind <> 'adjust' DO NOTHING`, params);
    // cancelled / returned: give back redeemed points, take back earned points
    const back = orderId ? "AND o.id = $1" : "";
    const backParams = orderId ? [orderId] : [];
    await pool.query(`
      INSERT INTO loyalty_ledger (customer_id, order_id, kind, points, note)
      SELECT l.customer_id, l.order_id, 'refund', -l.points, 'Points returned — order ' || o.order_number || ' ' || o.status
      FROM loyalty_ledger l JOIN orders o ON o.id = l.order_id
      WHERE l.kind = 'redeem' AND o.status IN ('cancelled', 'returned') ${back}
      ON CONFLICT (order_id, kind) WHERE order_id IS NOT NULL AND kind <> 'adjust' DO NOTHING`, backParams);
    await pool.query(`
      INSERT INTO loyalty_ledger (customer_id, order_id, kind, points, note)
      SELECT l.customer_id, l.order_id, 'reverse', -l.points, 'Points removed — order ' || o.order_number || ' ' || o.status
      FROM loyalty_ledger l JOIN orders o ON o.id = l.order_id
      WHERE l.kind = 'earn' AND o.status IN ('cancelled', 'returned') ${back}
      ON CONFLICT (order_id, kind) WHERE order_id IS NOT NULL AND kind <> 'adjust' DO NOTHING`, backParams);
  };
  const onOrderStatusChanged = (orderId) => settlePoints(orderId).catch((e) => console.error("Points settlement failed:", e));

  // ---------------------------------------------------------------------------------------------
  // Deals scheduler: swap prices in at start, restore at end
  // ---------------------------------------------------------------------------------------------
  const endDeal = async (client, deal, status = "ended") => {
    if (deal.status === "active") {
      await client.query("UPDATE products SET price_paise=$2, compare_at_price_paise=$3, updated_at=NOW() WHERE id=$1",
        [deal.product_id, deal.original_price_paise, deal.original_compare_paise]);
    }
    await client.query("UPDATE deals SET status=$2, updated_at=NOW() WHERE id=$1", [deal.id, status]);
  };
  const runDeals = async () => {
    const due = await pool.query(`SELECT id FROM deals WHERE (status='active' AND ends_at <= NOW()) OR (status='scheduled' AND ends_at <= NOW())`);
    for (const { id } of due.rows) {
      await withTransaction(async (client) => {
        const d = (await client.query("SELECT * FROM deals WHERE id=$1 FOR UPDATE", [id])).rows[0];
        if (d && ["active", "scheduled"].includes(d.status) && new Date(d.ends_at) <= new Date()) await endDeal(client, d);
      });
    }
    const start = await pool.query(`SELECT id FROM deals WHERE status='scheduled' AND starts_at <= NOW() AND ends_at > NOW() ORDER BY starts_at`);
    for (const { id } of start.rows) {
      await withTransaction(async (client) => {
        const d = (await client.query("SELECT * FROM deals WHERE id=$1 FOR UPDATE", [id])).rows[0];
        if (!d || d.status !== "scheduled") return;
        const running = await client.query("SELECT 1 FROM deals WHERE product_id=$1 AND status='active'", [d.product_id]);
        if (running.rowCount) return;                         // wait until the current deal ends
        const p = (await client.query("SELECT price_paise, compare_at_price_paise FROM products WHERE id=$1 FOR UPDATE", [d.product_id])).rows[0];
        if (!p) return;
        if (d.deal_price_paise >= p.price_paise) { await client.query("UPDATE deals SET status='cancelled', updated_at=NOW() WHERE id=$1", [d.id]); return; }
        await client.query("UPDATE deals SET status='active', original_price_paise=$2, original_compare_paise=$3, updated_at=NOW() WHERE id=$1",
          [d.id, p.price_paise, p.compare_at_price_paise]);
        await client.query("UPDATE products SET price_paise=$2, compare_at_price_paise=$3, updated_at=NOW() WHERE id=$1",
          [d.product_id, d.deal_price_paise, Math.max(p.price_paise, p.compare_at_price_paise || 0)]);
      });
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Alert emails
  // ---------------------------------------------------------------------------------------------
  const runAlerts = async () => {
    const pending = await pool.query(`
      SELECT a.id, a.email, a.kind, a.price_at_request_paise, p.name, p.slug, p.price_paise,
        COALESCE(i.quantity - i.reserved_quantity, 0) AS available
      FROM stock_alerts a JOIN products p ON p.id=a.product_id AND p.active LEFT JOIN inventory i ON i.product_id=p.id
      WHERE a.notified_at IS NULL
        AND ((a.kind='back_in_stock' AND COALESCE(i.quantity - i.reserved_quantity, 0) > 0)
          OR (a.kind='price_drop' AND p.price_paise < a.price_at_request_paise AND COALESCE(i.quantity - i.reserved_quantity, 0) > 0))
      ORDER BY a.id LIMIT 100`);
    for (const a of pending.rows) {
      const subject = a.kind === "back_in_stock" ? `${a.name} is back in stock at BUVA` : `Price drop: ${a.name} is now ${inr(a.price_paise)}`;
      const body = a.kind === "back_in_stock"
        ? `Good news — ${a.name} is available again (${a.available} in stock). Shop it here: ${productUrl(a.slug)}`
        : `${a.name} dropped from ${inr(a.price_at_request_paise)} to ${inr(a.price_paise)}. Shop it here: ${productUrl(a.slug)}`;
      const sent = await sendEmail({ to: a.email, subject, text: `${body}\n\n— BUVA Chennai` });
      if (sent?.accepted) {
        await pool.query("UPDATE stock_alerts SET notified_at=NOW() WHERE id=$1", [a.id]);
      }
    }
    // wishlist price drops (customers who keep price alerts on)
    await pool.query(`UPDATE wishlists w SET price_alert_paise = p.price_paise FROM products p WHERE p.id=w.product_id AND w.price_alert_paise IS NULL`);
    const drops = await pool.query(`
      SELECT w.customer_id, w.product_id, w.price_alert_paise, p.name, p.slug, p.price_paise, cu.email
      FROM wishlists w JOIN products p ON p.id=w.product_id AND p.active JOIN customers cu ON cu.id=w.customer_id AND cu.active
      LEFT JOIN notification_preferences np ON np.customer_id=w.customer_id
      WHERE p.price_paise < w.price_alert_paise AND COALESCE(np.price_alerts, TRUE)
      LIMIT 100`);
    for (const d of drops.rows) {
      const sent = await sendEmail({
        to: d.email, subject: `Price drop on your wishlist: ${d.name} is now ${inr(d.price_paise)}`,
        text: `${d.name} on your BUVA wishlist dropped from ${inr(d.price_alert_paise)} to ${inr(d.price_paise)}.\nShop it here: ${productUrl(d.slug)}\n\nYou can turn off price alerts in My account → Profile.\n— BUVA Chennai`
      });
      if (sent?.accepted) {
        await pool.query("UPDATE wishlists SET price_alert_paise=$3 WHERE customer_id=$1 AND product_id=$2", [d.customer_id, d.product_id, d.price_paise]);
      }
    }
    // price went back up: track the new level so the next real drop is noticed
    await pool.query(`UPDATE wishlists w SET price_alert_paise = p.price_paise FROM products p WHERE p.id=w.product_id AND p.price_paise > w.price_alert_paise`);
  };

  const safe = (name, fn) => async () => { try { await fn(); } catch (e) { console.error(`${name} job failed:`, e.message); } };
  const startJobs = () => {
    const deals = safe("Deals", runDeals), alerts = safe("Alerts", runAlerts), points = safe("Points", () => settlePoints());
    setTimeout(async () => { await deals(); await points(); await alerts(); }, 3000);
    setInterval(deals, 60 * 1000);
    setInterval(points, 10 * 60 * 1000);
    setInterval(alerts, 5 * 60 * 1000);
  };

  // ---------------------------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------------------------
  const admin = (method, route, ...handlers) => app[method](`/api/admin/commerce${route}`, requireAdmin, ...handlers);

  admin("get", "/overview", asyncRoute(async (_request, response) => {
    const [products, deals, combos, coupons, alerts, photos, points] = await Promise.all([
      pool.query(`SELECT p.id, p.slug, p.name, p.size_ml AS "sizeMl", p.price_paise AS "pricePaise", p.variant_group AS "variantGroup",
          p.active, COALESCE(i.quantity - i.reserved_quantity, 0) AS "availableQuantity",
          COALESCE((SELECT json_agg(json_build_object('id', pi.id, 'url', pi.image_url, 'alt', pi.alt_text, 'order', pi.display_order) ORDER BY pi.display_order, pi.id)
            FROM product_images pi WHERE pi.product_id=p.id), '[]') AS images
        FROM products p LEFT JOIN inventory i ON i.product_id=p.id ORDER BY p.name, p.size_ml`),
      pool.query(`SELECT d.id, d.product_id AS "productId", p.name AS "productName", d.title, d.deal_price_paise AS "dealPricePaise",
          d.original_price_paise AS "originalPricePaise", d.starts_at AS "startsAt", d.ends_at AS "endsAt", d.status
        FROM deals d JOIN products p ON p.id=d.product_id ORDER BY (d.status IN ('active','scheduled')) DESC, d.starts_at DESC LIMIT 100`),
      pool.query(`SELECT id, title, min_quantity AS "minQuantity", scent_family AS "scentFamily", discount_type AS "discountType",
          discount_value AS "discountValue", stack_with_coupons AS "stackWithCoupons", active, starts_at AS "startsAt", ends_at AS "endsAt"
        FROM combo_offers ORDER BY active DESC, id DESC`),
      pool.query(`SELECT id, code, description, discount_type AS "discountType", discount_value AS "discountValue",
          minimum_order_paise AS "minimumOrderPaise", active, show_in_store AS "showInStore", ends_at AS "endsAt" FROM coupons ORDER BY code`),
      pool.query(`SELECT p.name, a.kind, COUNT(*)::INTEGER AS waiting FROM stock_alerts a JOIN products p ON p.id=a.product_id
        WHERE a.notified_at IS NULL GROUP BY p.name, a.kind ORDER BY waiting DESC`),
      pool.query(`SELECT rp.id, rp.image_url AS url, r.rating, r.status, p.name AS "productName", rp.created_at AS "createdAt"
        FROM review_photos rp JOIN product_reviews r ON r.id=rp.review_id JOIN products p ON p.id=r.product_id ORDER BY rp.created_at DESC LIMIT 60`),
      pool.query(`SELECT COALESCE(SUM(points) FILTER (WHERE points > 0), 0)::INTEGER AS issued, COALESCE(-SUM(points) FILTER (WHERE points < 0), 0)::INTEGER AS used,
          COALESCE(SUM(points),0)::INTEGER AS outstanding FROM loyalty_ledger`)
    ]);
    response.json({
      products: products.rows, deals: deals.rows, combos: combos.rows, coupons: coupons.rows,
      alerts: alerts.rows, reviewPhotos: photos.rows, points: { ...points.rows[0], rules: cfg }
    });
  }));

  admin("patch", "/products/:productId", asyncRoute(async (request, response) => {
    const id = positiveInt(request.params.productId, "productId");
    const raw = request.body?.variantGroup;
    const group = raw === null || raw === "" ? null : text(raw, "Size group", { min: 2, max: 60, optional: false });
    if (group && !/^[a-z0-9-]+$/i.test(group)) throw new ApiError(400, "Size group may only contain letters, numbers and dashes");
    const r = await pool.query("UPDATE products SET variant_group=$2, updated_at=NOW() WHERE id=$1 RETURNING id", [id, group ? group.toLowerCase() : null]);
    if (!r.rowCount) throw new ApiError(404, "Product not found");
    response.json({ ok: true });
  }));

  admin("post", "/products/:productId/images", withUpload(uploadGallery, "photos", 10), asyncRoute(async (request, response) => {
    const id = positiveInt(request.params.productId, "productId");
    const files = request.files || [];
    if (!files.length) throw new ApiError(400, "Choose at least one photo");
    const p = await pool.query("SELECT name FROM products WHERE id=$1", [id]);
    if (!p.rowCount) throw new ApiError(404, "Product not found");
    const max = await pool.query("SELECT COALESCE(MAX(display_order), -1) AS m FROM product_images WHERE product_id=$1", [id]);
    let order = Number(max.rows[0].m) + 1;
    for (const f of files) {
      await pool.query("INSERT INTO product_images (product_id, image_url, alt_text, display_order) VALUES ($1,$2,$3,$4)",
        [id, `/uploads/${f.filename}`, `${p.rows[0].name} by BUVA`, order++]);
    }
    response.status(201).json({ ok: true, added: files.length });
  }));

  admin("patch", "/images/:imageId", asyncRoute(async (request, response) => {
    const id = positiveInt(request.params.imageId, "imageId");
    const sets = [], vals = [id];
    if (request.body?.displayOrder !== undefined) { vals.push(positiveInt(request.body.displayOrder, "Order", { min: 0, max: 1000 })); sets.push(`display_order=$${vals.length}`); }
    if (request.body?.altText !== undefined) { vals.push(text(request.body.altText, "Alt text", { min: 2, max: 160, optional: false })); sets.push(`alt_text=$${vals.length}`); }
    if (!sets.length) throw new ApiError(400, "Nothing to update");
    const r = await pool.query(`UPDATE product_images SET ${sets.join(", ")} WHERE id=$1 RETURNING id`, vals);
    if (!r.rowCount) throw new ApiError(404, "Image not found");
    response.json({ ok: true });
  }));

  admin("delete", "/images/:imageId", asyncRoute(async (request, response) => {
    const id = positiveInt(request.params.imageId, "imageId");
    const img = await pool.query("SELECT product_id FROM product_images WHERE id=$1", [id]);
    if (!img.rowCount) throw new ApiError(404, "Image not found");
    const count = await pool.query("SELECT COUNT(*)::INTEGER AS n FROM product_images WHERE product_id=$1", [img.rows[0].product_id]);
    if (count.rows[0].n <= 1) throw new ApiError(409, "A product needs at least one photo");
    await pool.query("DELETE FROM product_images WHERE id=$1", [id]);
    response.json({ ok: true });
  }));

  admin("post", "/deals", asyncRoute(async (request, response) => {
    const productId = positiveInt(request.body?.productId, "Product");
    const dealPricePaise = positiveInt(request.body?.dealPricePaise, "Deal price");
    const startsAt = optionalDate(request.body?.startsAt, "Start") || new Date().toISOString();
    const endsAt = optionalDate(request.body?.endsAt, "End");
    if (!endsAt || new Date(endsAt) <= new Date(startsAt)) throw new ApiError(400, "End must be after the start");
    if (new Date(endsAt) <= new Date()) throw new ApiError(400, "End must be in the future");
    const p = await pool.query("SELECT price_paise FROM products WHERE id=$1", [productId]);
    if (!p.rowCount) throw new ApiError(404, "Product not found");
    if (dealPricePaise >= p.rows[0].price_paise) throw new ApiError(400, `Deal price must be below the current price (${inr(p.rows[0].price_paise)})`);
    const title = text(request.body?.title, "Title", { max: 80 }) || "Limited-time deal";
    const r = await pool.query("INSERT INTO deals (product_id, title, deal_price_paise, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [productId, title, dealPricePaise, startsAt, endsAt]);
    await runDeals();
    response.status(201).json({ id: r.rows[0].id });
  }));

  admin("delete", "/deals/:dealId", asyncRoute(async (request, response) => {
    const id = positiveInt(request.params.dealId, "dealId");
    await withTransaction(async (client) => {
      const d = (await client.query("SELECT * FROM deals WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!d) throw new ApiError(404, "Deal not found");
      if (["active", "scheduled"].includes(d.status)) await endDeal(client, d, "cancelled");
    });
    response.json({ ok: true });
  }));

  const parseCombo = (b = {}) => {
    const discountType = b.discountType;
    if (!["percentage", "fixed"].includes(discountType)) throw new ApiError(400, "Discount type must be percentage or fixed");
    const family = b.scentFamily ? String(b.scentFamily).toLowerCase() : null;
    if (family && !["floral", "fresh", "woody", "mist", "sets"].includes(family)) throw new ApiError(400, "Invalid scent family");
    return {
      title: text(b.title, "Title", { min: 3, max: 80, optional: false }),
      minQuantity: positiveInt(b.minQuantity, "Minimum items", { min: 2, max: 20 }),
      family, discountType,
      discountValue: positiveInt(b.discountValue, discountType === "percentage" ? "Percent" : "Amount", { min: 1, max: discountType === "percentage" ? 90 : 10_000_000 }),
      stack: b.stackWithCoupons === true, active: b.active !== false,
      startsAt: optionalDate(b.startsAt, "Start"), endsAt: optionalDate(b.endsAt, "End")
    };
  };
  admin("post", "/combos", asyncRoute(async (request, response) => {
    const c = parseCombo(request.body);
    const r = await pool.query(`INSERT INTO combo_offers (title, min_quantity, scent_family, discount_type, discount_value, stack_with_coupons, active, starts_at, ends_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [c.title, c.minQuantity, c.family, c.discountType, c.discountValue, c.stack, c.active, c.startsAt, c.endsAt]);
    response.status(201).json({ id: r.rows[0].id });
  }));
  admin("patch", "/combos/:comboId", asyncRoute(async (request, response) => {
    const id = positiveInt(request.params.comboId, "comboId");
    if (Object.keys(request.body || {}).length === 1 && typeof request.body.active === "boolean") {
      const r = await pool.query("UPDATE combo_offers SET active=$2, updated_at=NOW() WHERE id=$1 RETURNING id", [id, request.body.active]);
      if (!r.rowCount) throw new ApiError(404, "Combo not found");
      return response.json({ ok: true });
    }
    const c = parseCombo(request.body);
    const r = await pool.query(`UPDATE combo_offers SET title=$2, min_quantity=$3, scent_family=$4, discount_type=$5, discount_value=$6,
      stack_with_coupons=$7, active=$8, starts_at=$9, ends_at=$10, updated_at=NOW() WHERE id=$1 RETURNING id`,
      [id, c.title, c.minQuantity, c.family, c.discountType, c.discountValue, c.stack, c.active, c.startsAt, c.endsAt]);
    if (!r.rowCount) throw new ApiError(404, "Combo not found");
    response.json({ ok: true });
  }));

  admin("patch", "/coupons/:couponId", asyncRoute(async (request, response) => {
    const id = positiveInt(request.params.couponId, "couponId");
    const showInStore = request.body?.showInStore;
    if (typeof showInStore !== "boolean") throw new ApiError(400, "showInStore must be true or false");
    const description = text(request.body?.description, "Description", { max: 140 });
    const r = await pool.query("UPDATE coupons SET show_in_store=$2, description=$3, updated_at=NOW() WHERE id=$1 RETURNING id", [id, showInStore, description]);
    if (!r.rowCount) throw new ApiError(404, "Coupon not found");
    response.json({ ok: true });
  }));

  admin("delete", "/review-photos/:photoId", asyncRoute(async (request, response) => {
    const id = positiveInt(request.params.photoId, "photoId");
    const r = await pool.query("DELETE FROM review_photos WHERE id=$1 RETURNING id", [id]);
    if (!r.rowCount) throw new ApiError(404, "Photo not found");
    response.json({ ok: true });
  }));

  admin("post", "/points/adjust", asyncRoute(async (request, response) => {
    const email = String(request.body?.email || "").trim().toLowerCase();
    if (!isEmail(email)) throw new ApiError(400, "A valid customer email is required");
    const points = Number(request.body?.points);
    if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 100000) throw new ApiError(400, "Points must be a non-zero whole number");
    const note = text(request.body?.note, "Note", { min: 3, max: 120, optional: false });
    const c = await pool.query("SELECT id FROM customers WHERE lower(email)=$1", [email]);
    if (!c.rowCount) throw new ApiError(404, "No customer with that email");
    const bal = await pointsBalance(pool, c.rows[0].id);
    if (bal + points < 0) throw new ApiError(400, `Customer has only ${bal} points`);
    await pool.query("INSERT INTO loyalty_ledger (customer_id, kind, points, note) VALUES ($1,'adjust',$2,$3)", [c.rows[0].id, points, note]);
    response.json({ balance: bal + points });
  }));

  return { computePricing, recordOrderExtras, parseGiftMessage, onOrderStatusChanged, startJobs, config: cfg };
};
