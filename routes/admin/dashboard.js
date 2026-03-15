'use strict';

const express = require('express');
const { query } = require('../../db');
const { adminPage } = require('../../views/layout');
const { escapeHtml, statusBadge, formatPrice } = require('../../views/helpers');

const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    const [ordersRes, productsRes, couponsRes, revenueRes] = await Promise.all([
      query(`SELECT COUNT(*) FROM orders`),
      query(`SELECT COUNT(*) FROM products WHERE active = TRUE`),
      query(`SELECT COUNT(*) FROM coupons WHERE active = TRUE`),
      query(`SELECT COALESCE(SUM(final_price_cents), 0) AS total FROM orders WHERE status IN ('paid', 'enrolled')`),
    ]);

    const recentOrders = await query(
      `SELECT o.order_ref, o.customer_email, o.customer_first_name, o.customer_last_name,
              o.final_price_cents, o.currency, o.status, o.created_at, p.title AS product_title
       FROM orders o JOIN products p ON p.id = o.product_id
       ORDER BY o.created_at DESC LIMIT 10`
    );

    const total = Number(revenueRes.rows[0].total);

    const body = `
    <div class="card">
      <div class="grid3">
        <div class="stat"><div class="val">${ordersRes.rows[0].count}</div><div class="lbl">Commandes totales</div></div>
        <div class="stat"><div class="val">${productsRes.rows[0].count}</div><div class="lbl">Produits actifs</div></div>
        <div class="stat"><div class="val">${couponsRes.rows[0].count}</div><div class="lbl">Coupons actifs</div></div>
      </div>
    </div>
    <div class="card">
      <div class="stat"><div class="val">${total.toLocaleString('fr-FR')} FCFA</div><div class="lbl">Revenus confirmés (payé + inscrit)</div></div>
    </div>
    <div class="card">
      <h2 style="font-size:16px;margin:0 0 16px">Dernières commandes</h2>
      <table>
        <thead><tr><th>Réf</th><th>Client</th><th>Produit</th><th>Montant</th><th>Statut</th><th>Date</th></tr></thead>
        <tbody>
        ${recentOrders.rows.map(o => `<tr>
          <td><code style="font-size:11px">${escapeHtml(o.order_ref)}</code></td>
          <td>${escapeHtml(o.customer_first_name)} ${escapeHtml(o.customer_last_name)}<br>
              <small style="color:#64748b">${escapeHtml(o.customer_email)}</small></td>
          <td>${escapeHtml(o.product_title)}</td>
          <td style="white-space:nowrap">${formatPrice(o.final_price_cents, o.currency)}</td>
          <td>${statusBadge(o.status)}</td>
          <td style="white-space:nowrap;font-size:12px">${new Date(o.created_at).toLocaleString('fr-FR')}</td>
        </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

    res.send(adminPage('Tableau de bord', 'dashboard', body));
  } catch (err) { next(err); }
});

module.exports = router;
