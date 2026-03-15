require('dotenv').config();

const config = require('./config/env'); // validates all required env vars on startup

const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const { publicLimiter, ipnLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:'],
    },
  },
}));

// ── Logging ───────────────────────────────────────────────────────────────────
app.use(morgan('tiny'));

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ type: ['application/json', 'text/plain', 'application/*+json'] }));
app.use(cookieParser(config.COOKIE_SECRET));

// ── Trust proxy (needed for rate-limiter on Render/Heroku) ───────────────────
app.set('trust proxy', 1);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use(publicLimiter);
app.use('/', require('./routes/payment'));
app.use('/paytech/ipn', ipnLimiter, require('./routes/ipn'));
app.use('/admin', require('./routes/admin/index'));

// ── Global error handler ──────────────────────────────────────────────────────
app.use(errorHandler);

// ── Unhandled rejections ──────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// ── Cron jobs ─────────────────────────────────────────────────────────────────
require('./jobs/cleanupPendingOrders').start();

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(config.PORT, '0.0.0.0', () => {
  console.log(`Serveur démarré sur le port ${config.PORT} [${config.NODE_ENV}]`);
});
