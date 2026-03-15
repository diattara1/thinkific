'use strict';

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const config = require('../config/env');
const { findActiveProductByCourseId, findActiveProductBySlug, findApplicableCoupon, computeFinalPrice, buildOrderRef } = require('../services/couponService');
const { createPaymentRequest } = require('../services/paytech');
const { createOrder } = require('../services/orderService');
const { renderCheckoutPage } = require('../views/checkout');
const { query: dbQuery } = require('../db');

const router = express.Router();

// ── Health check ──────────────────────────────────────────────────────────────

router.get('/health', async (_req, res) => {
  const db = await dbQuery('SELECT NOW()');
  res.json({ ok: true, time: db.rows[0].now });
});

// ── Homepage ──────────────────────────────────────────────────────────────────

router.get('/', (_req, res) => {
  const name = config.PUBLIC_SITE_NAME;
  res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${name}</title>
    <style>body{font-family:system-ui;background:#f8fafc;padding:40px;color:#1e293b}
    .box{max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 16px rgba(0,0,0,.08)}
    h1{font-size:22px;font-weight:800}p{color:#64748b;font-size:14px}code{background:#f1f5f9;padding:2px 6px;border-radius:4px}
    a{color:#3b82f6}</style></head>
    <body><div class="box"><h1>${name}</h1>
    <p>Service de paiement actif.</p>
    <p>Utilisez <code>/pay?product=COURSE_ID</code> pour démarrer un paiement.</p>
    <p><a href="/admin">Administration</a></p>
    </div></body></html>`);
});

// ── GET /pay ──────────────────────────────────────────────────────────────────

router.get(
  '/pay',
  [query('product').isInt({ min: 1 }).withMessage('Paramètre product invalide')],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).send(errors.array()[0].msg);

    try {
      const courseId = Number(req.query.product);
      const { coupon: couponCode, email, first_name, last_name, phone } = req.query;

      const product = await findActiveProductByCourseId(courseId);
      if (!product) return res.status(404).send('Produit introuvable');

      const coupon = couponCode ? await findApplicableCoupon(couponCode, product.id) : null;
      const shouldAutoRedirect = Boolean(email && first_name && last_name);

      if (shouldAutoRedirect) {
        const finalPrice = computeFinalPrice(product.price_cents, coupon);
        const orderRef = buildOrderRef(product.slug);

        const { redirectUrl, token } = await createPaymentRequest({
          product,
          coupon,
          finalPrice,
          orderRef,
          customerData: { email, first_name, last_name, phone },
          successUrl: config.SUCCESS_REDIRECT_URL,
        });

        await createOrder({
          orderRef, token, productId: product.id,
          customerData: { email, first_name, last_name, phone },
          basePriceCents: product.price_cents,
          finalPriceCents: finalPrice,
          currency: product.currency,
          couponCode: coupon?.code || null,
        });

        return res.redirect(302, redirectUrl);
      }

      return res.status(200).send(
        renderCheckoutPage(product, coupon, '', { email, first_name, last_name, phone })
      );
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /checkout ─────────────────────────────────────────────────────────────

router.post(
  '/checkout',
  [
    body('email').isEmail().normalizeEmail().withMessage('Email invalide'),
    body('first_name').trim().notEmpty().withMessage('Le prénom est obligatoire'),
    body('last_name').trim().notEmpty().withMessage('Le nom est obligatoire'),
    body('product_slug').trim().notEmpty().withMessage('Produit manquant'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).send(errors.array()[0].msg);

    try {
      const { product_slug, product_course_id, email, first_name, last_name, phone, coupon_code } = req.body;

      const product = product_course_id
        ? await findActiveProductByCourseId(product_course_id)
        : await findActiveProductBySlug(product_slug);
      if (!product) return res.status(404).send('Produit introuvable');

      const coupon = coupon_code ? await findApplicableCoupon(coupon_code, product.id) : null;
      const finalPrice = computeFinalPrice(product.price_cents, coupon);
      const orderRef = buildOrderRef(product.slug);

      const { redirectUrl, token } = await createPaymentRequest({
        product, coupon, finalPrice, orderRef,
        customerData: { email, first_name, last_name, phone },
        successUrl: `${config.SUCCESS_REDIRECT_URL}?order_ref=${encodeURIComponent(orderRef)}`,
      });

      await createOrder({
        orderRef, token, productId: product.id,
        customerData: { email, first_name, last_name, phone },
        basePriceCents: product.price_cents,
        finalPriceCents: finalPrice,
        currency: product.currency,
        couponCode: coupon?.code || null,
      });

      return res.redirect(302, redirectUrl);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
