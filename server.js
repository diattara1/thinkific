require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const axios = require('axios');
const { query } = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 10000);

const APP_BASE_URL = process.env.APP_BASE_URL;
const PAYTECH_API_KEY = process.env.PAYTECH_API_KEY;
const PAYTECH_API_SECRET = process.env.PAYTECH_API_SECRET;
const PAYTECH_ENV = process.env.PAYTECH_ENV || 'test';
const PAYTECH_TARGET_PAYMENT = process.env.PAYTECH_TARGET_PAYMENT || '';
const THINKIFIC_API_KEY = process.env.THINKIFIC_API_KEY;
const THINKIFIC_SUBDOMAIN = process.env.THINKIFIC_SUBDOMAIN;
const THINKIFIC_SEND_WELCOME_EMAIL = String(process.env.THINKIFIC_SEND_WELCOME_EMAIL || 'true') === 'true';
const SUCCESS_REDIRECT_URL = process.env.SUCCESS_REDIRECT_URL;
const CANCEL_REDIRECT_URL = process.env.CANCEL_REDIRECT_URL;
const PUBLIC_SITE_NAME = process.env.PUBLIC_SITE_NAME || 'Mon école';

if (!APP_BASE_URL || !PAYTECH_API_KEY || !PAYTECH_API_SECRET || !THINKIFIC_API_KEY || !THINKIFIC_SUBDOMAIN || !SUCCESS_REDIRECT_URL || !CANCEL_REDIRECT_URL) {
  throw new Error('Variables d\'environnement obligatoires manquantes. Consulte .env.example');
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('tiny'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ type: ['application/json', 'text/plain', 'application/*+json'] }));

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildOrderRef(slug) {
  const rand = crypto.randomBytes(4).toString('hex');
  return `CMD_${slug}_${Date.now()}_${rand}`;
}

function computeFinalPrice(basePriceCents, coupon) {
  if (!coupon) return basePriceCents;
  if (coupon.discount_type === 'percent') {
    const discount = Math.floor((basePriceCents * coupon.discount_value) / 100);
    return Math.max(0, basePriceCents - discount);
  }
  return Math.max(0, basePriceCents - coupon.discount_value);
}

async function findActiveProductBySlug(slug) {
  const result = await query(
    `SELECT * FROM products WHERE slug = $1 AND active = TRUE LIMIT 1`,
    [slug]
  );
  return result.rows[0] || null;
}
async function findActiveProductByCourseId(courseId) {
  const result = await query(
    `SELECT * FROM products WHERE thinkific_course_id = $1 AND active = TRUE LIMIT 1`,
    [courseId]
  );
  return result.rows[0] || null;
}
async function findApplicableCoupon(code, productId) {
  if (!code) return null;
  const result = await query(
    `SELECT c.*
     FROM coupons c
     LEFT JOIN coupon_products cp ON cp.coupon_id = c.id
     WHERE UPPER(c.code) = UPPER($1)
       AND c.active = TRUE
       AND (c.starts_at IS NULL OR c.starts_at <= NOW())
       AND (c.ends_at IS NULL OR c.ends_at >= NOW())
       AND (c.max_uses IS NULL OR c.current_uses < c.max_uses)
       AND (cp.product_id IS NULL OR cp.product_id = $2)
     LIMIT 1`,
    [code, productId]
  );
  return result.rows[0] || null;
}

async function incrementCouponUsage(code) {
  if (!code) return;
  await query(`UPDATE coupons SET current_uses = current_uses + 1 WHERE UPPER(code) = UPPER($1)`, [code]);
}

function paytechRequestUrl() {
  return 'https://paytech.sn/api/payment/request-payment';
}

function extractPaytechRedirectUrl(data) {
  return (
    data?.redirect_url ||
    data?.redirectUrl ||
    data?.payment_url ||
    data?.redirect_to ||
    data?.url ||
    data?.data?.redirect_url ||
    data?.success_url ||
    null
  );
}

function extractPaytechToken(data) {
  return data?.token || data?.payment_token || data?.data?.token || null;
}

function renderCheckoutPage(product, coupon, message = '') {
  const base = product.price_cents;
  const final = computeFinalPrice(base, coupon);
  const promo = coupon ? `<p><strong>Coupon:</strong> ${escapeHtml(coupon.code)}</p>` : '';
  const msg = message ? `<p style="color:#b91c1c"><strong>${escapeHtml(message)}</strong></p>` : '';

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(product.title)} - Paiement</title>
  <style>
    body { font-family: Arial, sans-serif; background:#f7f7f7; margin:0; padding:24px; color:#111; }
    .wrap { max-width:720px; margin:0 auto; background:#fff; border-radius:16px; padding:24px; box-shadow:0 8px 30px rgba(0,0,0,.08); }
    input, button { width:100%; padding:12px 14px; border-radius:10px; border:1px solid #d1d5db; margin-top:8px; box-sizing:border-box; }
    button { background:#111827; color:#fff; border:none; cursor:pointer; font-weight:700; }
    .row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .muted { color:#6b7280; font-size:14px; }
    .price { font-size:28px; font-weight:800; margin:8px 0; }
    @media (max-width:640px) { .row { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(product.title)}</h1>
    <p class="muted">${escapeHtml(product.description || '')}</p>
    <div class="price">${final.toLocaleString('fr-FR')} ${escapeHtml(product.currency)}</div>
    ${promo}
    ${msg}
    <form method="post" action="/checkout">
      <input type="hidden" name="product_slug" value="${escapeHtml(product.slug)}" />
      <input type="hidden" name="product_course_id" value="${product.thinkific_course_id}" />
      <div class="row">
        <div>
          <label>Prénom</label>
          <input name="first_name" required />
        </div>
        <div>
          <label>Nom</label>
          <input name="last_name" required />
        </div>
      </div>
      <label>Email</label>
      <input type="email" name="email" required />
      <label>Téléphone (ex: 22177xxxxxxx)</label>
      <input name="phone" />
      <label>Code promo</label>
      <input name="coupon_code" placeholder="Optionnel" value="${coupon ? escapeHtml(coupon.code) : ''}" />
      <button type="submit">Payer maintenant</button>
    </form>
    <p class="muted" style="margin-top:16px">Propulsé par ${escapeHtml(PUBLIC_SITE_NAME)} + PayTech + Thinkific</p>
  </div>
</body>
</html>`;
}

app.get('/health', async (req, res) => {
  const db = await query('SELECT NOW()');
  res.json({ ok: true, time: db.rows[0].now });
});

app.get('/pay', async (req, res) => {

  const { product: courseId, coupon: couponCode } = req.query;

  if (!courseId)
    return res.status(400).send('Paramètre product manquant');

  const product = await findActiveProductByCourseId(courseId);

  if (!product)
    return res.status(404).send('Produit introuvable');

  const coupon = couponCode
    ? await findApplicableCoupon(couponCode, product.id)
    : null;

  return res.status(200).send(renderCheckoutPage(product, coupon));

});

app.post('/checkout', async (req, res) => {
  const { product_slug, product_course_id, email, first_name, last_name, phone, coupon_code } = req.body;

  if (!product_slug || !email || !first_name || !last_name) {
    return res.status(400).send('Champs obligatoires manquants');
  }

  let product;

  if (product_course_id) {
    product = await findActiveProductByCourseId(product_course_id);
  } else {
    product = await findActiveProductBySlug(product_slug);
  }
  if (!product) return res.status(404).send('Produit introuvable');

  const coupon = coupon_code ? await findApplicableCoupon(coupon_code, product.id) : null;
  const finalPrice = computeFinalPrice(product.price_cents, coupon);
  const orderRef = buildOrderRef(product.slug);

  const customField = {
    order_ref: orderRef,
    product_slug: product.slug,
    thinkific_course_id: product.thinkific_course_id,
    email,
    first_name,
    last_name,
    phone: phone || null,
    coupon_code: coupon?.code || null,
  };

  const payload = {
    item_name: product.title,
    item_price: finalPrice,
    ref_command: orderRef,
    command_name: `Achat ${product.title}`,
    currency: product.currency,
    env: PAYTECH_ENV,
    ipn_url: `${APP_BASE_URL}/paytech/ipn`,
    success_url: `${SUCCESS_REDIRECT_URL}?order_ref=${encodeURIComponent(orderRef)}`,
    cancel_url: `${CANCEL_REDIRECT_URL}?order_ref=${encodeURIComponent(orderRef)}`,
    custom_field: JSON.stringify(customField),
  };

  if (PAYTECH_TARGET_PAYMENT) payload.target_payment = PAYTECH_TARGET_PAYMENT;

  try {
    const paytechResp = await axios.post(paytechRequestUrl(), payload, {
      headers: {
        'API_KEY': PAYTECH_API_KEY,
        'API_SECRET': PAYTECH_API_SECRET,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });

    const redirectUrl = extractPaytechRedirectUrl(paytechResp.data);
    const token = extractPaytechToken(paytechResp.data);

    if (!redirectUrl) {
      return res.status(502).send(`Réponse PayTech inattendue: ${JSON.stringify(paytechResp.data)}`);
    }

    await query(
      `INSERT INTO orders
        (order_ref, paytech_token, product_id, customer_email, customer_first_name, customer_last_name, customer_phone, coupon_code, base_price_cents, final_price_cents, currency, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')`,
      [
        orderRef,
        token,
        product.id,
        email,
        first_name,
        last_name,
        phone || null,
        coupon?.code || null,
        product.price_cents,
        finalPrice,
        product.currency,
      ]
    );

    return res.redirect(302, redirectUrl);
  } catch (error) {
    const message = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    return res.status(500).send(renderCheckoutPage(product, coupon, `Erreur PayTech: ${message}`));
  }
});

async function thinkificHeaders() {
  return {
    'X-Auth-API-Key': THINKIFIC_API_KEY,
    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
    'Content-Type': 'application/json',
  };
}

async function createThinkificUser({ firstName, lastName, email }) {
  const resp = await axios.post(
    'https://api.thinkific.com/api/public/v1/users',
    {
      first_name: firstName,
      last_name: lastName,
      email,
      send_welcome_email: THINKIFIC_SEND_WELCOME_EMAIL,
    },
    { headers: await thinkificHeaders(), timeout: 30000 }
  );
  return resp.data;
}

async function listThinkificUsersByEmail(email) {
  const headers = await thinkificHeaders();
  const candidates = [
    `https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(email)}`,
    `https://api.thinkific.com/api/public/v1/users?email=${encodeURIComponent(email)}`,
    `https://api.thinkific.com/api/public/v1/users?query=${encodeURIComponent(email)}`,
  ];

  for (const url of candidates) {
    try {
      const resp = await axios.get(url, { headers, timeout: 30000 });
      const rows = Array.isArray(resp.data?.items)
        ? resp.data.items
        : Array.isArray(resp.data)
        ? resp.data
        : [];
      const found = rows.find((u) => String(u.email || '').toLowerCase() === String(email).toLowerCase());
      if (found) return found;
    } catch (err) {
      // continue
    }
  }
  return null;
}

async function ensureThinkificUser(order) {
  try {
    const created = await createThinkificUser({
      firstName: order.customer_first_name,
      lastName: order.customer_last_name,
      email: order.customer_email,
    });
    return created;
  } catch (error) {
    const status = error.response?.status;
    if (status === 422 || status === 400 || status === 409) {
      const existing = await listThinkificUsersByEmail(order.customer_email);
      if (existing) return existing;
    }
    throw new Error(`Erreur création utilisateur Thinkific: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
  }
}

async function createThinkificEnrollment({ userId, courseId }) {
  const resp = await axios.post(
    'https://api.thinkific.com/api/public/v1/enrollments',
    {
      user_id: userId,
      course_id: Number(courseId),
      activated: true,
    },
    { headers: await thinkificHeaders(), timeout: 30000 }
  );
  return resp.data;
}

async function ensureThinkificEnrollment(order, thinkificUserId, courseId) {
  try {
    return await createThinkificEnrollment({ userId: thinkificUserId, courseId });
  } catch (error) {
    const status = error.response?.status;
    if (status === 422 || status === 409) {
      return { id: null, message: 'Déjà inscrit ou inscription existante' };
    }
    throw new Error(`Erreur inscription Thinkific: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
  }
}

async function markOrderPaid({ orderRef, payload }) {
  await query(
    `UPDATE orders
     SET status = 'paid',
         paytech_payment_method = $2,
         paytech_raw_ipn = $3,
         paid_at = NOW()
     WHERE order_ref = $1`,
    [orderRef, payload.payment_method || null, payload]
  );
}

async function markOrderCancelled({ orderRef, payload }) {
  await query(
    `UPDATE orders
     SET status = 'cancelled', paytech_raw_ipn = $2
     WHERE order_ref = $1`,
    [orderRef, payload]
  );
}

app.post('/paytech/ipn', async (req, res) => {
  const payload = req.body || {};
  await query(`INSERT INTO webhook_logs (provider, payload) VALUES ('paytech', $1)`, [payload]);

  const sentApiKeySha = payload.api_key_sha256;
  const sentApiSecretSha = payload.api_secret_sha256;
  const validKey = sentApiKeySha && sentApiKeySha === sha256(PAYTECH_API_KEY);
  const validSecret = sentApiSecretSha && sentApiSecretSha === sha256(PAYTECH_API_SECRET);

  if (!validKey || !validSecret) {
    return res.status(401).json({ ok: false, message: 'Signature IPN invalide' });
  }

  const orderRef = payload.ref_command;
  const eventType = payload.type_event;

  if (!orderRef) {
    return res.status(400).json({ ok: false, message: 'ref_command manquant' });
  }

  const orderResult = await query(
    `SELECT o.*, p.thinkific_course_id, p.slug AS product_slug, p.title AS product_title
     FROM orders o
     JOIN products p ON p.id = o.product_id
     WHERE o.order_ref = $1
     LIMIT 1`,
    [orderRef]
  );

  const order = orderResult.rows[0];
  if (!order) return res.status(404).json({ ok: false, message: 'Commande inconnue' });

  if (eventType === 'sale_canceled') {
    await markOrderCancelled({ orderRef, payload });
    return res.status(200).json({ ok: true, message: 'Commande annulée' });
  }

  if (eventType !== 'sale_complete') {
    return res.status(200).json({ ok: true, message: 'Événement ignoré' });
  }

  try {
    await markOrderPaid({ orderRef, payload });
    if (order.coupon_code) await incrementCouponUsage(order.coupon_code);

    const thinkificUser = await ensureThinkificUser(order);
    const enrollment = await ensureThinkificEnrollment(order, thinkificUser.id, order.thinkific_course_id);

    await query(
      `UPDATE orders
       SET status = 'enrolled',
           thinkific_user_id = $2,
           thinkific_enrollment_id = $3,
           enrolled_at = NOW(),
           paytech_raw_ipn = $4
       WHERE order_ref = $1`,
      [orderRef, thinkificUser.id || null, enrollment.id || null, payload]
    );

    if (process.env.POST_PAYMENT_WEBHOOK_URL) {
      axios.post(process.env.POST_PAYMENT_WEBHOOK_URL, {
        order_ref: orderRef,
        email: order.customer_email,
        product_slug: order.product_slug,
        status: 'enrolled',
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, message: 'Paiement traité et étudiant inscrit' });
  } catch (error) {
    await query(
      `UPDATE orders SET paytech_raw_ipn = $2 WHERE order_ref = $1`,
      [orderRef, { ...payload, enrollment_error: error.message }]
    );
    return res.status(500).json({ ok: false, message: error.message });
  }
});

app.get('/', (req, res) => {
  res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(PUBLIC_SITE_NAME)}</title></head><body><h1>${escapeHtml(PUBLIC_SITE_NAME)}</h1><p>Service de paiement actif.</p><p>Utilisez <code>/pay?product=formation-ia</code></p></body></html>`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
