'use strict';

const { escapeHtml } = require('./helpers');
const config = require('../config/env');

function renderCheckoutPage(product, coupon, message = '', user = {}) {
  const base = product.price_cents;
  const final = coupon
    ? (coupon.discount_type === 'percent'
        ? Math.max(0, base - Math.floor((base * coupon.discount_value) / 100))
        : Math.max(0, base - coupon.discount_value))
    : base;

  const promo = coupon
    ? `<p class="coupon-tag">Coupon appliqué : <strong>${escapeHtml(coupon.code)}</strong></p>`
    : '';
  const msg = message
    ? `<p class="error-msg">${escapeHtml(message)}</p>`
    : '';

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(product.title)} – Paiement</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, Arial, sans-serif;
      background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
      min-height: 100vh;
      padding: 32px 16px;
      color: #1e293b;
    }
    .wrap {
      max-width: 520px;
      margin: 0 auto;
      background: #fff;
      border-radius: 20px;
      padding: 36px 32px;
      box-shadow: 0 4px 32px rgba(0,0,0,.10);
    }
    .site-name {
      font-size: 13px;
      color: #94a3b8;
      font-weight: 600;
      letter-spacing: .06em;
      text-transform: uppercase;
      margin-bottom: 24px;
    }
    h1 { font-size: 22px; font-weight: 800; margin-bottom: 6px; }
    .description { color: #64748b; font-size: 14px; margin-bottom: 20px; }
    .price-block {
      background: #f8fafc;
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 24px;
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .price { font-size: 32px; font-weight: 800; color: #0f172a; }
    .currency { font-size: 16px; color: #64748b; }
    .coupon-tag {
      font-size: 13px;
      color: #166534;
      background: #dcfce7;
      padding: 6px 12px;
      border-radius: 8px;
      margin-bottom: 16px;
    }
    .error-msg {
      font-size: 14px;
      color: #991b1b;
      background: #fee2e2;
      padding: 10px 14px;
      border-radius: 8px;
      margin-bottom: 16px;
    }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { margin-bottom: 14px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 5px; }
    input {
      width: 100%;
      padding: 11px 14px;
      border: 1.5px solid #e2e8f0;
      border-radius: 10px;
      font-size: 15px;
      color: #1e293b;
      background: #fff;
      transition: border-color .15s;
    }
    input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.15); }
    input[readonly] { background: #f8fafc; color: #64748b; cursor: not-allowed; }
    .btn-pay {
      width: 100%;
      margin-top: 8px;
      padding: 14px;
      background: #1e293b;
      color: #fff;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: background .15s;
      letter-spacing: .02em;
    }
    .btn-pay:hover { background: #0f172a; }
    .footer-note { font-size: 12px; color: #94a3b8; text-align: center; margin-top: 20px; }
    @media (max-width: 560px) { .wrap { padding: 24px 18px; } .row { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="site-name">${escapeHtml(config.PUBLIC_SITE_NAME)}</div>
    <h1>${escapeHtml(product.title)}</h1>
    ${product.description ? `<p class="description">${escapeHtml(product.description)}</p>` : ''}
    <div class="price-block">
      <span class="price">${final.toLocaleString('fr-FR')}</span>
      <span class="currency">${escapeHtml(product.currency)}</span>
    </div>
    ${promo}
    ${msg}
    <form method="post" action="/checkout">
      <input type="hidden" name="product_slug" value="${escapeHtml(product.slug)}" />
      <input type="hidden" name="product_course_id" value="${escapeHtml(String(product.thinkific_course_id))}" />
      <div class="row">
        <div class="field">
          <label for="first_name">Prénom</label>
          <input id="first_name" name="first_name" value="${escapeHtml(user.first_name || '')}" required autocomplete="given-name" />
        </div>
        <div class="field">
          <label for="last_name">Nom</label>
          <input id="last_name" name="last_name" value="${escapeHtml(user.last_name || '')}" required autocomplete="family-name" />
        </div>
      </div>
      <div class="field">
        <label for="email">Adresse e-mail</label>
        <input id="email" type="email" name="email" value="${escapeHtml(user.email || '')}" ${user.email ? 'readonly' : ''} required autocomplete="email" />
      </div>
      <div class="field">
        <label for="phone">Téléphone <span style="font-weight:400;color:#94a3b8">(ex : 22177xxxxxxx)</span></label>
        <input id="phone" name="phone" value="${escapeHtml(user.phone || '')}" autocomplete="tel" />
      </div>
      <div class="field">
        <label for="coupon_code">Code promo</label>
        <input id="coupon_code" name="coupon_code" placeholder="Optionnel" value="${coupon ? escapeHtml(coupon.code) : ''}" />
      </div>
      <button class="btn-pay" type="submit">Payer maintenant</button>
    </form>
    <p class="footer-note">Paiement sécurisé via PayTech &middot; ${escapeHtml(config.PUBLIC_SITE_NAME)}</p>
  </div>
</body>
</html>`;
}

module.exports = { renderCheckoutPage };
