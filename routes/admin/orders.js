'use strict';

const express = require('express');
const { query } = require('../../db');
const { adminPage } = require('../../views/layout');
const { escapeHtml, statusBadge, formatPrice } = require('../../views/helpers');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status || '';
    const search = req.query.search || '';
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = 25;
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];
    if (status) { params.push(status); where.push(`o.status = $${params.length}`); }
    if (search) { params.push(`%${search}%`); where.push(`(o.customer_email ILIKE $${params.length} OR o.order_ref ILIKE $${params.length})`); }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const countRes = await query(`SELECT COUNT(*) FROM orders o ${whereClause}`, params);
    const total = Number(countRes.rows[0].count);
    const pages = Math.ceil(total / limit);

    params.push(limit, offset);
    const orders = await query(
      `SELECT o.*, p.title AS product_title
       FROM orders o JOIN products p ON p.id = o.product_id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const statusOptions = ['', 'pending', 'paid', 'enrolled', 'cancelled', 'failed'].map(s =>
      `<option value="${s}" ${status === s ? 'selected' : ''}>${s || 'Tous les statuts'}</option>`
    ).join('');

    const rows = orders.rows.map(o => `
      <tr>
        <td style="font-size:11px"><code>${escapeHtml(o.order_ref)}</code></td>
        <td>${escapeHtml(o.customer_first_name)} ${escapeHtml(o.customer_last_name)}<br>
            <small style="color:#64748b">${escapeHtml(o.customer_email)}</small></td>
        <td>${escapeHtml(o.product_title)}</td>
        <td style="white-space:nowrap">${formatPrice(o.final_price_cents, o.currency)}</td>
        <td>${o.coupon_code ? `<span class="badge badge-blue">${escapeHtml(o.coupon_code)}</span>` : '–'}</td>
        <td>${statusBadge(o.status)}</td>
        <td style="white-space:nowrap;font-size:12px">${new Date(o.created_at).toLocaleString('fr-FR')}</td>
      </tr>`).join('');

    const pagination = pages > 1
      ? `<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          ${Array.from({ length: pages }, (_, i) =>
            `<a href="/admin/orders?page=${i + 1}&status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}"
                class="btn btn-sm ${page === i + 1 ? 'btn-primary' : 'btn-outline'}">${i + 1}</a>`
          ).join('')}
         </div>`
      : '';

    const body = `
    <form method="get" action="/admin/orders" style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
      <input name="search" value="${escapeHtml(search)}" placeholder="Email ou référence…" style="max-width:280px">
      <select name="status" style="max-width:200px">${statusOptions}</select>
      <button class="btn btn-primary" type="submit">Filtrer</button>
      <a href="/admin/orders" class="btn btn-outline">Réinitialiser</a>
    </form>
    <div class="card">
      <div style="margin-bottom:12px;font-size:14px;color:#64748b">${total} commande(s)</div>
      <table>
        <thead><tr><th>Référence</th><th>Client</th><th>Produit</th><th>Montant</th><th>Coupon</th><th>Statut</th><th>Date</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${pagination}
    </div>`;

    res.send(adminPage('Commandes', 'orders', body));
  } catch (err) { next(err); }
});

module.exports = router;
