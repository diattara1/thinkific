'use strict';

const { query } = require('../db');

async function createOrder({ orderRef, token, productId, customerData, basePriceCents, finalPriceCents, currency, couponCode }) {
  await query(
    `INSERT INTO orders
      (order_ref, paytech_token, product_id, customer_email, customer_first_name, customer_last_name,
       customer_phone, coupon_code, base_price_cents, final_price_cents, currency, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')`,
    [
      orderRef,
      token,
      productId,
      customerData.email,
      customerData.first_name,
      customerData.last_name,
      customerData.phone || null,
      couponCode || null,
      basePriceCents,
      finalPriceCents,
      currency,
    ]
  );
}

async function findOrderByRef(orderRef) {
  const result = await query(
    `SELECT o.*, p.thinkific_course_id, p.slug AS product_slug, p.title AS product_title
     FROM orders o
     JOIN products p ON p.id = o.product_id
     WHERE o.order_ref = $1
     LIMIT 1`,
    [orderRef]
  );
  return result.rows[0] || null;
}

async function markOrderPaid({ orderRef, paymentMethod, rawIpn }) {
  await query(
    `UPDATE orders
     SET status = 'paid',
         paytech_payment_method = $2,
         paytech_raw_ipn = $3,
         paid_at = NOW()
     WHERE order_ref = $1`,
    [orderRef, paymentMethod || null, rawIpn]
  );
}

async function markOrderCancelled({ orderRef, rawIpn }) {
  await query(
    `UPDATE orders SET status = 'cancelled', paytech_raw_ipn = $2 WHERE order_ref = $1`,
    [orderRef, rawIpn]
  );
}

async function markOrderEnrolled({ orderRef, thinkificUserId, enrollmentId, rawIpn }) {
  await query(
    `UPDATE orders
     SET status = 'enrolled',
         thinkific_user_id = $2,
         thinkific_enrollment_id = $3,
         enrolled_at = NOW(),
         paytech_raw_ipn = $4
     WHERE order_ref = $1`,
    [orderRef, thinkificUserId || null, enrollmentId || null, rawIpn]
  );
}

async function markOrderErrored({ orderRef, rawIpn }) {
  await query(
    `UPDATE orders SET paytech_raw_ipn = $2 WHERE order_ref = $1`,
    [orderRef, rawIpn]
  );
}

module.exports = {
  createOrder,
  findOrderByRef,
  markOrderPaid,
  markOrderCancelled,
  markOrderEnrolled,
  markOrderErrored,
};
