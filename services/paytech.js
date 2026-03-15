'use strict';

const crypto = require('crypto');
const axios = require('axios');
const config = require('../config/env');

const PAYTECH_API_URL = 'https://paytech.sn/api/payment/request-payment';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function verifyIpnSignature(payload) {
  const sentKey = payload.api_key_sha256;
  const sentSecret = payload.api_secret_sha256;
  return (
    sentKey && sentKey === sha256(config.PAYTECH_API_KEY) &&
    sentSecret && sentSecret === sha256(config.PAYTECH_API_SECRET)
  );
}

function buildCancelRedirectUrl(productSlug) {
  const base = String(config.CANCEL_REDIRECT_URL || '').replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(productSlug)}`;
}

function extractRedirectUrl(data) {
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

function extractToken(data) {
  return data?.token || data?.payment_token || data?.data?.token || null;
}

/**
 * Creates a PayTech payment request and returns { redirectUrl, token }.
 * Throws an Error with a message on failure.
 */
async function createPaymentRequest({ product, coupon, finalPrice, orderRef, customerData, successUrl }) {
  const customField = {
    order_ref: orderRef,
    product_slug: product.slug,
    thinkific_course_id: product.thinkific_course_id,
    email: customerData.email,
    first_name: customerData.first_name,
    last_name: customerData.last_name,
    phone: customerData.phone || null,
    coupon_code: coupon?.code || null,
  };

  const payload = {
    item_name: product.title,
    item_price: finalPrice,
    ref_command: orderRef,
    command_name: `Achat ${product.title}`,
    currency: product.currency,
    env: config.PAYTECH_ENV,
    ipn_url: `${config.APP_BASE_URL}/paytech/ipn`,
    success_url: successUrl,
    cancel_url: buildCancelRedirectUrl(product.slug),
    custom_field: JSON.stringify(customField),
  };

  if (config.PAYTECH_TARGET_PAYMENT) payload.target_payment = config.PAYTECH_TARGET_PAYMENT;

  const resp = await axios.post(PAYTECH_API_URL, payload, {
    headers: {
      'API_KEY': config.PAYTECH_API_KEY,
      'API_SECRET': config.PAYTECH_API_SECRET,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });

  const redirectUrl = extractRedirectUrl(resp.data);
  if (!redirectUrl) {
    throw new Error(`Réponse PayTech inattendue : ${JSON.stringify(resp.data)}`);
  }

  return { redirectUrl, token: extractToken(resp.data) };
}

module.exports = { createPaymentRequest, verifyIpnSignature, buildCancelRedirectUrl, sha256 };
