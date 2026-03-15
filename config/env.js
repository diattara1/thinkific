'use strict';

const required = [
  'APP_BASE_URL',
  'PAYTECH_API_KEY',
  'PAYTECH_API_SECRET',
  'THINKIFIC_API_KEY',
  'THINKIFIC_SUBDOMAIN',
  'SUCCESS_REDIRECT_URL',
  'CANCEL_REDIRECT_URL',
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Variable d'environnement obligatoire manquante : ${key}`);
  }
}

module.exports = Object.freeze({
  PORT: Number(process.env.PORT || 10000),
  NODE_ENV: process.env.NODE_ENV || 'development',

  APP_BASE_URL: process.env.APP_BASE_URL,
  PUBLIC_SITE_NAME: process.env.PUBLIC_SITE_NAME || 'Mon école',

  PAYTECH_API_KEY: process.env.PAYTECH_API_KEY,
  PAYTECH_API_SECRET: process.env.PAYTECH_API_SECRET,
  PAYTECH_ENV: process.env.PAYTECH_ENV || 'test',
  PAYTECH_TARGET_PAYMENT: process.env.PAYTECH_TARGET_PAYMENT || '',

  THINKIFIC_API_KEY: process.env.THINKIFIC_API_KEY,
  THINKIFIC_SUBDOMAIN: process.env.THINKIFIC_SUBDOMAIN,
  THINKIFIC_SEND_WELCOME_EMAIL: String(process.env.THINKIFIC_SEND_WELCOME_EMAIL || 'true') === 'true',

  SUCCESS_REDIRECT_URL: process.env.SUCCESS_REDIRECT_URL,
  CANCEL_REDIRECT_URL: process.env.CANCEL_REDIRECT_URL,

  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',

  POST_PAYMENT_WEBHOOK_URL: process.env.POST_PAYMENT_WEBHOOK_URL || '',
  COOKIE_SECRET: process.env.COOKIE_SECRET || 'change-this-secret-in-production',
});
