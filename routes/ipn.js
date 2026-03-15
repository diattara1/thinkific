'use strict';

const express = require('express');
const axios = require('axios');
const config = require('../config/env');
const { verifyIpnSignature } = require('../services/paytech');
const { findOrderByRef, markOrderPaid, markOrderCancelled, markOrderEnrolled, markOrderErrored } = require('../services/orderService');
const { incrementCouponUsage } = require('../services/couponService');
const { ensureUser, ensureEnrollment } = require('../services/thinkific');
const { query } = require('../db');

const router = express.Router();

router.post('/', async (req, res) => {
  const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

  // Validate signature BEFORE logging to prevent flooding webhook_logs
  if (!verifyIpnSignature(payload)) {
    return res.status(401).json({ ok: false, message: 'Signature IPN invalide' });
  }

  await query(`INSERT INTO webhook_logs (provider, payload) VALUES ('paytech', $1)`, [payload]);

  const orderRef = payload.ref_command;
  const eventType = payload.type_event;

  if (!orderRef) {
    return res.status(400).json({ ok: false, message: 'ref_command manquant' });
  }

  const order = await findOrderByRef(orderRef);
  if (!order) return res.status(404).json({ ok: false, message: 'Commande inconnue' });

  if (eventType === 'sale_canceled') {
    await markOrderCancelled({ orderRef, rawIpn: payload });
    return res.status(200).json({ ok: true, message: 'Commande annulée' });
  }

  if (eventType !== 'sale_complete') {
    return res.status(200).json({ ok: true, message: 'Événement ignoré' });
  }

  try {
    await markOrderPaid({ orderRef, paymentMethod: payload.payment_method, rawIpn: payload });

    if (order.coupon_code) await incrementCouponUsage(order.coupon_code);

    const thinkificUser = await ensureUser({
      firstName: order.customer_first_name,
      lastName: order.customer_last_name,
      email: order.customer_email,
    });

    const enrollment = await ensureEnrollment({
      userId: thinkificUser.id,
      courseId: order.thinkific_course_id,
    });

    await markOrderEnrolled({
      orderRef,
      thinkificUserId: thinkificUser.id || null,
      enrollmentId: enrollment.id || null,
      rawIpn: payload,
    });

    if (config.POST_PAYMENT_WEBHOOK_URL) {
      axios.post(config.POST_PAYMENT_WEBHOOK_URL, {
        order_ref: orderRef,
        email: order.customer_email,
        product_slug: order.product_slug,
        status: 'enrolled',
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, message: 'Paiement traité et étudiant inscrit' });
  } catch (error) {
    await markOrderErrored({
      orderRef,
      rawIpn: { ...payload, enrollment_error: error.message },
    });
    return res.status(500).json({ ok: false, message: error.message });
  }
});

module.exports = router;
