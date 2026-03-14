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

function buildCancelRedirectUrl(productSlug) {
  const base = String(CANCEL_REDIRECT_URL || '').replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(productSlug)}`;
}

function renderCheckoutPage(product, coupon, message = '', user = {}) {
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
          <input name="first_name" value="${escapeHtml(user.first_name || '')}" required />
        </div>
        <div>
          <label>Nom</label>
          <input name="last_name" value="${escapeHtml(user.last_name || '')}" required />
        </div>
      </div>
      <label>Email</label>
      <input type="email" name="email" value="${escapeHtml(user.email || '')}" readonly required />
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

  const courseId = Number(req.query.product);

  const {
    coupon: couponCode,
    email,
    first_name,
    last_name,
    phone
  } = req.query;

  if (!courseId)
    return res.status(400).send('Paramètre product invalide');

  const product = await findActiveProductByCourseId(courseId);

  if (!product)
    return res.status(404).send('Produit introuvable');

  const coupon = couponCode
    ? await findApplicableCoupon(couponCode, product.id)
    : null;

  const shouldAutoRedirect = Boolean(email && first_name && last_name);

  if (shouldAutoRedirect) {
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
      success_url: `${SUCCESS_REDIRECT_URL}`,
      cancel_url: buildCancelRedirectUrl(product.slug),
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
      return res.status(500).send(renderCheckoutPage(product, coupon, `Erreur PayTech: ${message}`, {
        email,
        first_name,
        last_name,
      }));
    }
  }

  return res.status(200).send(
    renderCheckoutPage(
      product,
      coupon,
      '',
      {
        email,
        first_name,
        last_name
      }
    )
  );

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
    cancel_url: buildCancelRedirectUrl(product.slug),
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
  const payload = typeof req.body === "string"
    ? JSON.parse(req.body)
    : req.body || {};
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
  res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(PUBLIC_SITE_NAME)}</title></head><body><h1>${escapeHtml(PUBLIC_SITE_NAME)}</h1><p>Service de paiement actif.</p><p>Utilisez <code>/pay?product=COURSE_ID</code></p><p><a href="/admin">Administration</a></p></body></html>`);
});

// ─── ADMIN ────────────────────────────────────────────────────────────────────

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function adminAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const [scheme, encoded] = auth.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const [, pass] = decoded.split(':');
    if (pass === ADMIN_PASSWORD) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin"');
  return res.status(401).send('Accès refusé');
}

const ADMIN_CSS = `
  *{box-sizing:border-box}
  body{font-family:system-ui,Arial,sans-serif;background:#f1f5f9;margin:0;color:#1e293b}
  nav{background:#1e293b;color:#fff;padding:12px 24px;display:flex;gap:24px;align-items:center}
  nav a{color:#94a3b8;text-decoration:none;font-size:14px}
  nav a:hover,nav a.active{color:#fff}
  nav .brand{color:#fff;font-weight:700;font-size:16px;margin-right:auto}
  .container{max-width:1100px;margin:0 auto;padding:24px}
  h1{font-size:22px;margin:0 0 20px}
  .card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:24px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th{text-align:left;padding:10px 12px;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:600;white-space:nowrap}
  td{padding:9px 12px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#fafafa}
  .badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:12px;font-weight:600}
  .badge-green{background:#dcfce7;color:#166534}
  .badge-yellow{background:#fef9c3;color:#854d0e}
  .badge-red{background:#fee2e2;color:#991b1b}
  .badge-blue{background:#dbeafe;color:#1d4ed8}
  .badge-gray{background:#f1f5f9;color:#475569}
  input,select,textarea{padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;width:100%}
  input:focus,select:focus,textarea:focus{outline:2px solid #3b82f6;border-color:transparent}
  .btn{display:inline-block;padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-size:14px;font-weight:600;text-decoration:none}
  .btn-primary{background:#1e293b;color:#fff}
  .btn-primary:hover{background:#0f172a}
  .btn-danger{background:#ef4444;color:#fff}
  .btn-danger:hover{background:#dc2626}
  .btn-sm{padding:5px 10px;font-size:12px}
  .btn-outline{background:transparent;border:1px solid #cbd5e1;color:#475569}
  .btn-outline:hover{background:#f8fafc}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
  .form-group{margin-bottom:14px}
  .form-group label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
  .stat{text-align:center;padding:16px}
  .stat .val{font-size:32px;font-weight:800;color:#1e293b}
  .stat .lbl{font-size:13px;color:#64748b;margin-top:4px}
  .alert{padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:14px}
  .alert-success{background:#dcfce7;color:#166534}
  .alert-error{background:#fee2e2;color:#991b1b}
  .actions{display:flex;gap:8px;flex-wrap:wrap}
  .edit-row{display:none;background:#fffbeb}
  @media(max-width:640px){.grid2,.grid3{grid-template-columns:1fr}}
`;

function adminNav(active) {
  return `<nav>
    <span class="brand">⚙ Admin</span>
    <a href="/admin" class="${active==='dashboard'?'active':''}">Tableau de bord</a>
    <a href="/admin/products" class="${active==='products'?'active':''}">Produits</a>
    <a href="/admin/coupons" class="${active==='coupons'?'active':''}">Coupons</a>
    <a href="/admin/orders" class="${active==='orders'?'active':''}">Commandes</a>
  </nav>`;
}

function adminPage(title, active, body) {
  return `<!doctype html><html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} – Admin</title>
<style>${ADMIN_CSS}</style></head>
<body>
${adminNav(active)}
<div class="container">
<h1>${escapeHtml(title)}</h1>
${body}
</div>
</body></html>`;
}

function statusBadge(status) {
  const map = {
    pending: ['badge-yellow', 'En attente'],
    paid: ['badge-blue', 'Payé'],
    enrolled: ['badge-green', 'Inscrit'],
    cancelled: ['badge-gray', 'Annulé'],
    failed: ['badge-red', 'Échoué'],
  };
  const [cls, label] = map[status] || ['badge-gray', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

// Dashboard
app.get('/admin', adminAuth, async (_req, res) => {
  const [ordersRes, productsRes, couponsRes, revenueRes] = await Promise.all([
    query(`SELECT COUNT(*) FROM orders`),
    query(`SELECT COUNT(*) FROM products WHERE active=TRUE`),
    query(`SELECT COUNT(*) FROM coupons WHERE active=TRUE`),
    query(`SELECT COALESCE(SUM(final_price_cents),0) AS total FROM orders WHERE status IN ('paid','enrolled')`),
  ]);
  const recentOrders = await query(
    `SELECT o.order_ref, o.customer_email, o.customer_first_name, o.customer_last_name,
            o.final_price_cents, o.currency, o.status, o.created_at, p.title AS product_title
     FROM orders o JOIN products p ON p.id=o.product_id
     ORDER BY o.created_at DESC LIMIT 10`
  );

  const total = Number(revenueRes.rows[0].total);
  const body = `
  <div class="card">
    <div class="grid3">
      <div class="stat"><div class="val">${ordersRes.rows[0].count}</div><div class="lbl">Commandes</div></div>
      <div class="stat"><div class="val">${productsRes.rows[0].count}</div><div class="lbl">Produits actifs</div></div>
      <div class="stat"><div class="val">${couponsRes.rows[0].count}</div><div class="lbl">Coupons actifs</div></div>
    </div>
  </div>
  <div class="card">
    <div class="stat"><div class="val">${total.toLocaleString('fr-FR')} FCFA</div><div class="lbl">Revenus (payé + inscrit)</div></div>
  </div>
  <div class="card">
    <h2 style="font-size:16px;margin:0 0 16px">Dernières commandes</h2>
    <table>
      <thead><tr><th>Réf</th><th>Client</th><th>Produit</th><th>Montant</th><th>Statut</th><th>Date</th></tr></thead>
      <tbody>
      ${recentOrders.rows.map(o => `<tr>
        <td><code style="font-size:11px">${escapeHtml(o.order_ref)}</code></td>
        <td>${escapeHtml(o.customer_first_name)} ${escapeHtml(o.customer_last_name)}<br><small style="color:#64748b">${escapeHtml(o.customer_email)}</small></td>
        <td>${escapeHtml(o.product_title)}</td>
        <td>${Number(o.final_price_cents).toLocaleString('fr-FR')} ${escapeHtml(o.currency)}</td>
        <td>${statusBadge(o.status)}</td>
        <td style="white-space:nowrap;font-size:12px">${new Date(o.created_at).toLocaleString('fr-FR')}</td>
      </tr>`).join('')}
      </tbody>
    </table>
  </div>`;

  res.send(adminPage('Tableau de bord', 'dashboard', body));
});

// ── PRODUCTS ──────────────────────────────────────────────────────────────────

app.get('/admin/products', adminAuth, async (req, res) => {
  const flash = req.query.flash ? `<div class="alert alert-success">${escapeHtml(req.query.flash)}</div>` : '';
  const products = await query(`SELECT * FROM products ORDER BY created_at DESC`);

  const rows = products.rows.map(p => `
    <tr id="row-${p.id}">
      <td>${escapeHtml(p.slug)}</td>
      <td>${escapeHtml(p.title)}</td>
      <td>${escapeHtml(String(p.thinkific_course_id))}</td>
      <td>${Number(p.price_cents).toLocaleString('fr-FR')} ${escapeHtml(p.currency)}</td>
      <td>${p.active ? '<span class="badge badge-green">Actif</span>' : '<span class="badge badge-gray">Inactif</span>'}</td>
      <td class="actions">
        <button class="btn btn-outline btn-sm" onclick="toggleEdit(${p.id})">Éditer</button>
        <form method="post" action="/admin/products/${p.id}/toggle" style="display:inline" onsubmit="return confirm('Confirmer ?')">
          <button class="btn btn-sm ${p.active ? 'btn-danger' : 'btn-primary'}">${p.active ? 'Désactiver' : 'Activer'}</button>
        </form>
      </td>
    </tr>
    <tr class="edit-row" id="edit-${p.id}">
      <td colspan="6">
        <form method="post" action="/admin/products/${p.id}" style="padding:12px">
          <div class="grid3">
            <div class="form-group"><label>Slug</label><input name="slug" value="${escapeHtml(p.slug)}" required></div>
            <div class="form-group"><label>Titre</label><input name="title" value="${escapeHtml(p.title)}" required></div>
            <div class="form-group"><label>Course ID Thinkific</label><input name="thinkific_course_id" value="${escapeHtml(String(p.thinkific_course_id))}" required></div>
          </div>
          <div class="grid3">
            <div class="form-group"><label>Prix (centimes)</label><input type="number" name="price_cents" value="${p.price_cents}" required></div>
            <div class="form-group"><label>Devise</label><input name="currency" value="${escapeHtml(p.currency)}" required></div>
            <div class="form-group"><label>Description</label><input name="description" value="${escapeHtml(p.description || '')}"></div>
          </div>
          <div class="actions">
            <button class="btn btn-primary" type="submit">Enregistrer</button>
            <button class="btn btn-outline" type="button" onclick="toggleEdit(${p.id})">Annuler</button>
          </div>
        </form>
      </td>
    </tr>`).join('');

  const body = `
  ${flash}
  <div class="card">
    <h2 style="font-size:16px;margin:0 0 16px">Nouveau produit</h2>
    <form method="post" action="/admin/products">
      <div class="grid3">
        <div class="form-group"><label>Slug (ex: formation-ia)</label><input name="slug" required placeholder="formation-ia"></div>
        <div class="form-group"><label>Titre</label><input name="title" required placeholder="Formation IA"></div>
        <div class="form-group"><label>Course ID Thinkific</label><input name="thinkific_course_id" required placeholder="123456"></div>
      </div>
      <div class="grid3">
        <div class="form-group"><label>Prix (centimes, ex: 10000)</label><input type="number" name="price_cents" required placeholder="10000"></div>
        <div class="form-group"><label>Devise</label><input name="currency" value="XOF" required></div>
        <div class="form-group"><label>Description</label><input name="description" placeholder="Optionnel"></div>
      </div>
      <button class="btn btn-primary" type="submit">Créer le produit</button>
    </form>
  </div>
  <div class="card">
    <table>
      <thead><tr><th>Slug</th><th>Titre</th><th>Course ID</th><th>Prix</th><th>Statut</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <script>
    function toggleEdit(id) {
      const row = document.getElementById('edit-'+id);
      row.style.display = row.style.display === 'table-row' ? 'none' : 'table-row';
    }
  </script>`;

  res.send(adminPage('Produits', 'products', body));
});

app.post('/admin/products', adminAuth, async (req, res) => {
  const { slug, title, thinkific_course_id, price_cents, currency, description } = req.body;
  await query(
    `INSERT INTO products (slug, title, thinkific_course_id, price_cents, currency, description, active)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
    [slug.trim(), title.trim(), Number(thinkific_course_id), Number(price_cents), (currency || 'XOF').trim(), description?.trim() || null]
  );
  res.redirect('/admin/products?flash=Produit+créé');
});

app.post('/admin/products/:id', adminAuth, async (req, res) => {
  const { slug, title, thinkific_course_id, price_cents, currency, description } = req.body;
  await query(
    `UPDATE products SET slug=$1, title=$2, thinkific_course_id=$3, price_cents=$4, currency=$5, description=$6 WHERE id=$7`,
    [slug.trim(), title.trim(), Number(thinkific_course_id), Number(price_cents), (currency || 'XOF').trim(), description?.trim() || null, req.params.id]
  );
  res.redirect('/admin/products?flash=Produit+mis+à+jour');
});

app.post('/admin/products/:id/toggle', adminAuth, async (req, res) => {
  await query(`UPDATE products SET active = NOT active WHERE id=$1`, [req.params.id]);
  res.redirect('/admin/products?flash=Statut+modifié');
});

// ── COUPONS ───────────────────────────────────────────────────────────────────

app.get('/admin/coupons', adminAuth, async (req, res) => {
  const flash = req.query.flash ? `<div class="alert alert-success">${escapeHtml(req.query.flash)}</div>` : '';
  const coupons = await query(`SELECT * FROM coupons ORDER BY created_at DESC`);

  const rows = coupons.rows.map(c => {
    const starts = c.starts_at ? new Date(c.starts_at).toLocaleDateString('fr-FR') : '–';
    const ends = c.ends_at ? new Date(c.ends_at).toLocaleDateString('fr-FR') : '–';
    const usage = c.max_uses ? `${c.current_uses}/${c.max_uses}` : `${c.current_uses}/∞`;
    const discount = c.discount_type === 'percent' ? `${c.discount_value}%` : `${Number(c.discount_value).toLocaleString('fr-FR')} FCFA`;

    const toInputDate = (d) => d ? new Date(d).toISOString().slice(0,10) : '';
    return `
    <tr id="row-${c.id}">
      <td><strong>${escapeHtml(c.code)}</strong></td>
      <td>${discount}</td>
      <td>${starts} → ${ends}</td>
      <td>${usage}</td>
      <td>${c.active ? '<span class="badge badge-green">Actif</span>' : '<span class="badge badge-gray">Inactif</span>'}</td>
      <td class="actions">
        <button class="btn btn-outline btn-sm" onclick="toggleEdit(${c.id})">Éditer</button>
        <form method="post" action="/admin/coupons/${c.id}/toggle" style="display:inline" onsubmit="return confirm('Confirmer ?')">
          <button class="btn btn-sm ${c.active ? 'btn-danger' : 'btn-primary'}">${c.active ? 'Désactiver' : 'Activer'}</button>
        </form>
      </td>
    </tr>
    <tr class="edit-row" id="edit-${c.id}">
      <td colspan="6">
        <form method="post" action="/admin/coupons/${c.id}" style="padding:12px">
          <div class="grid3">
            <div class="form-group"><label>Code</label><input name="code" value="${escapeHtml(c.code)}" required></div>
            <div class="form-group"><label>Type</label>
              <select name="discount_type">
                <option value="percent" ${c.discount_type==='percent'?'selected':''}>Pourcentage (%)</option>
                <option value="fixed" ${c.discount_type==='fixed'?'selected':''}>Montant fixe (FCFA)</option>
              </select>
            </div>
            <div class="form-group"><label>Valeur</label><input type="number" name="discount_value" value="${c.discount_value}" required></div>
          </div>
          <div class="grid3">
            <div class="form-group"><label>Début</label><input type="date" name="starts_at" value="${toInputDate(c.starts_at)}"></div>
            <div class="form-group"><label>Fin</label><input type="date" name="ends_at" value="${toInputDate(c.ends_at)}"></div>
            <div class="form-group"><label>Utilisations max (vide = illimité)</label><input type="number" name="max_uses" value="${c.max_uses || ''}"></div>
          </div>
          <div class="actions">
            <button class="btn btn-primary" type="submit">Enregistrer</button>
            <button class="btn btn-outline" type="button" onclick="toggleEdit(${c.id})">Annuler</button>
          </div>
        </form>
      </td>
    </tr>`;
  }).join('');

  const body = `
  ${flash}
  <div class="card">
    <h2 style="font-size:16px;margin:0 0 16px">Nouveau coupon</h2>
    <form method="post" action="/admin/coupons">
      <div class="grid3">
        <div class="form-group"><label>Code (ex: PROMO20)</label><input name="code" required placeholder="PROMO20"></div>
        <div class="form-group"><label>Type de remise</label>
          <select name="discount_type">
            <option value="percent">Pourcentage (%)</option>
            <option value="fixed">Montant fixe (FCFA)</option>
          </select>
        </div>
        <div class="form-group"><label>Valeur (ex: 20 pour 20%)</label><input type="number" name="discount_value" required placeholder="20"></div>
      </div>
      <div class="grid3">
        <div class="form-group"><label>Date début (optionnel)</label><input type="date" name="starts_at"></div>
        <div class="form-group"><label>Date fin (optionnel)</label><input type="date" name="ends_at"></div>
        <div class="form-group"><label>Max utilisations (vide = illimité)</label><input type="number" name="max_uses" placeholder="100"></div>
      </div>
      <button class="btn btn-primary" type="submit">Créer le coupon</button>
    </form>
  </div>
  <div class="card">
    <table>
      <thead><tr><th>Code</th><th>Remise</th><th>Période</th><th>Utilisations</th><th>Statut</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <script>
    function toggleEdit(id) {
      const row = document.getElementById('edit-'+id);
      row.style.display = row.style.display === 'table-row' ? 'none' : 'table-row';
    }
  </script>`;

  res.send(adminPage('Coupons', 'coupons', body));
});

app.post('/admin/coupons', adminAuth, async (req, res) => {
  const { code, discount_type, discount_value, starts_at, ends_at, max_uses } = req.body;
  await query(
    `INSERT INTO coupons (code, discount_type, discount_value, starts_at, ends_at, max_uses, active)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
    [
      code.trim().toUpperCase(),
      discount_type,
      Number(discount_value),
      starts_at || null,
      ends_at || null,
      max_uses ? Number(max_uses) : null,
    ]
  );
  res.redirect('/admin/coupons?flash=Coupon+créé');
});

app.post('/admin/coupons/:id', adminAuth, async (req, res) => {
  const { code, discount_type, discount_value, starts_at, ends_at, max_uses } = req.body;
  await query(
    `UPDATE coupons SET code=$1, discount_type=$2, discount_value=$3, starts_at=$4, ends_at=$5, max_uses=$6 WHERE id=$7`,
    [
      code.trim().toUpperCase(),
      discount_type,
      Number(discount_value),
      starts_at || null,
      ends_at || null,
      max_uses ? Number(max_uses) : null,
      req.params.id,
    ]
  );
  res.redirect('/admin/coupons?flash=Coupon+mis+à+jour');
});

app.post('/admin/coupons/:id/toggle', adminAuth, async (req, res) => {
  await query(`UPDATE coupons SET active = NOT active WHERE id=$1`, [req.params.id]);
  res.redirect('/admin/coupons?flash=Statut+modifié');
});

// ── ORDERS ────────────────────────────────────────────────────────────────────

app.get('/admin/orders', adminAuth, async (req, res) => {
  const status = req.query.status || '';
  const search = req.query.search || '';
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = 25;
  const offset = (page - 1) * limit;

  let where = [];
  let params = [];
  if (status) { params.push(status); where.push(`o.status=$${params.length}`); }
  if (search) { params.push(`%${search}%`); where.push(`(o.customer_email ILIKE $${params.length} OR o.order_ref ILIKE $${params.length})`); }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const countRes = await query(`SELECT COUNT(*) FROM orders o ${whereClause}`, params);
  const total = Number(countRes.rows[0].count);
  const pages = Math.ceil(total / limit);

  params.push(limit, offset);
  const orders = await query(
    `SELECT o.*, p.title AS product_title
     FROM orders o JOIN products p ON p.id=o.product_id
     ${whereClause}
     ORDER BY o.created_at DESC
     LIMIT $${params.length-1} OFFSET $${params.length}`,
    params
  );

  const statusOptions = ['', 'pending', 'paid', 'enrolled', 'cancelled', 'failed'].map(s =>
    `<option value="${s}" ${status===s?'selected':''}>${s||'Tous les statuts'}</option>`
  ).join('');

  const rows = orders.rows.map(o => `
    <tr>
      <td style="font-size:11px"><code>${escapeHtml(o.order_ref)}</code></td>
      <td>${escapeHtml(o.customer_first_name)} ${escapeHtml(o.customer_last_name)}<br><small style="color:#64748b">${escapeHtml(o.customer_email)}</small></td>
      <td>${escapeHtml(o.product_title)}</td>
      <td style="white-space:nowrap">${Number(o.final_price_cents).toLocaleString('fr-FR')} ${escapeHtml(o.currency)}</td>
      <td>${o.coupon_code ? `<span class="badge badge-blue">${escapeHtml(o.coupon_code)}</span>` : '–'}</td>
      <td>${statusBadge(o.status)}</td>
      <td style="white-space:nowrap;font-size:12px">${new Date(o.created_at).toLocaleString('fr-FR')}</td>
    </tr>`).join('');

  const pagination = pages > 1 ? `<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
    ${Array.from({length:pages},(_,i)=>`<a href="/admin/orders?page=${i+1}&status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}" class="btn btn-sm ${page===i+1?'btn-primary':'btn-outline'}">${i+1}</a>`).join('')}
  </div>` : '';

  const body = `
  <form method="get" action="/admin/orders" style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
    <input name="search" value="${escapeHtml(search)}" placeholder="Email ou référence…" style="max-width:280px">
    <select name="status" style="max-width:200px">${statusOptions}</select>
    <button class="btn btn-primary" type="submit">Filtrer</button>
    <a href="/admin/orders" class="btn btn-outline">Réinitialiser</a>
  </form>
  <div class="card">
    <div style="margin-bottom:12px;font-size:14px;color:#64748b">${total} commande(s)</div>
    <table>
      <thead><tr><th>Référence</th><th>Client</th><th>Produit</th><th>Montant</th><th>Coupon</th><th>Statut</th><th>Date</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${pagination}
  </div>`;

  res.send(adminPage('Commandes', 'orders', body));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});



