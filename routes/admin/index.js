'use strict';

const express = require('express');
const adminAuth = require('../../middleware/adminAuth');
const { adminLimiter } = require('../../middleware/rateLimiter');

const router = express.Router();

// Apply auth and rate limiting to all admin routes
router.use(adminLimiter);
router.use(adminAuth);

router.use('/', require('./dashboard'));
router.use('/products', require('./products'));
router.use('/coupons', require('./coupons'));
router.use('/orders', require('./orders'));

module.exports = router;
