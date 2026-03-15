'use strict';

const cron = require('node-cron');
const { query } = require('../db');

function start() {
  // Every day at 03:00 — delete pending orders older than 3 months
  cron.schedule('0 3 * * *', async () => {
    try {
      const result = await query(`
        DELETE FROM orders
        WHERE status = 'pending'
          AND created_at < NOW() - INTERVAL '3 months'
      `);
      console.log(`[cron] cleanup: ${result.rowCount} commande(s) pending supprimée(s)`);
    } catch (err) {
      console.error('[cron] cleanup error:', err.message);
    }
  });

  console.log('[cron] Nettoyage automatique des commandes programmé (quotidien à 03h00)');
}

module.exports = { start };
