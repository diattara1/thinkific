'use strict';

const crypto = require('crypto');
const { query } = require('../db');

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
  await query(
    `UPDATE coupons SET current_uses = current_uses + 1 WHERE UPPER(code) = UPPER($1)`,
    [code]
  );
}

module.exports = {
  buildOrderRef,
  computeFinalPrice,
  findActiveProductBySlug,
  findActiveProductByCourseId,
  findApplicableCoupon,
  incrementCouponUsage,
};
