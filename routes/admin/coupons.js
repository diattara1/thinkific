'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../../db');
const { adminPage } = require('../../views/layout');
const { escapeHtml } = require('../../views/helpers');

const router = express.Router();

const couponValidation = [
  body('code').trim().toUpperCase().notEmpty().withMessage('Le code est obligatoire'),
  body('discount_type').isIn(['percent', 'fixed']).withMessage('Type invalide'),
  body('discount_value').isInt({ min: 0 }).withMessage('Valeur invalide'),
];

function flashAlert(req) {
  const flash = req.cookies?.flash_msg;
  if (!flash) return '';
  const decoded = Buffer.from(flash, 'base64').toString('utf8');
  return `<div class="alert alert-success">${escapeHtml(decoded)}</div>`;
}

function setFlash(res, msg) {
  res.cookie('flash_msg', Buffer.from(msg).toString('base64'), {
    maxAge: 5000, httpOnly: true, sameSite: 'lax',
  });
}

const toInputDate = (d) => d ? new Date(d).toISOString().slice(0, 10) : '';

router.get('/', async (req, res, next) => {
  try {
    const flash = flashAlert(req);
    res.clearCookie('flash_msg');
    const coupons = await query(`SELECT * FROM coupons ORDER BY created_at DESC`);

    const rows = coupons.rows.map(c => {
      const starts = c.starts_at ? new Date(c.starts_at).toLocaleDateString('fr-FR') : '–';
      const ends = c.ends_at ? new Date(c.ends_at).toLocaleDateString('fr-FR') : '–';
      const usage = c.max_uses ? `${c.current_uses}/${c.max_uses}` : `${c.current_uses}/∞`;
      const discount = c.discount_type === 'percent'
        ? `${c.discount_value}%`
        : `${Number(c.discount_value).toLocaleString('fr-FR')} FCFA`;

      return `
      <tr id="row-${c.id}">
        <td><strong>${escapeHtml(c.code)}</strong></td>
        <td>${discount}</td>
        <td style="white-space:nowrap">${starts} → ${ends}</td>
        <td>${usage}</td>
        <td>${c.active ? '<span class="badge badge-green">Actif</span>' : '<span class="badge badge-gray">Inactif</span>'}</td>
        <td class="actions">
          <button class="btn btn-outline btn-sm" onclick="toggleEdit(${c.id})">Éditer</button>
          <form method="post" action="/admin/coupons/${c.id}/toggle" style="display:inline" onsubmit="return confirm('Confirmer ?')">
            <button class="btn btn-sm ${c.active ? 'btn-danger' : 'btn-primary'}">${c.active ? 'Désactiver' : 'Activer'}</button>
          </form>
        </td>
      </tr>
      <tr class="edit-row" id="edit-${c.id}">
        <td colspan="6">
          <form method="post" action="/admin/coupons/${c.id}" style="padding:12px">
            <div class="grid3">
              <div class="form-group"><label>Code</label><input name="code" value="${escapeHtml(c.code)}" required></div>
              <div class="form-group"><label>Type</label>
                <select name="discount_type">
                  <option value="percent" ${c.discount_type === 'percent' ? 'selected' : ''}>Pourcentage (%)</option>
                  <option value="fixed" ${c.discount_type === 'fixed' ? 'selected' : ''}>Montant fixe (FCFA)</option>
                </select>
              </div>
              <div class="form-group"><label>Valeur</label><input type="number" name="discount_value" value="${c.discount_value}" required></div>
            </div>
            <div class="grid3">
              <div class="form-group"><label>Début</label><input type="date" name="starts_at" value="${toInputDate(c.starts_at)}"></div>
              <div class="form-group"><label>Fin</label><input type="date" name="ends_at" value="${toInputDate(c.ends_at)}"></div>
              <div class="form-group"><label>Max utilisations (vide = illimité)</label><input type="number" name="max_uses" value="${c.max_uses || ''}"></div>
            </div>
            <div class="actions">
              <button class="btn btn-primary" type="submit">Enregistrer</button>
              <button class="btn btn-outline" type="button" onclick="toggleEdit(${c.id})">Annuler</button>
            </div>
          </form>
        </td>
      </tr>`;
    }).join('');

    const body = `
    ${flash}
    <div class="card">
      <h2 style="font-size:16px;margin:0 0 16px">Nouveau coupon</h2>
      <form method="post" action="/admin/coupons">
        <div class="grid3">
          <div class="form-group"><label>Code (ex : PROMO20)</label><input name="code" required placeholder="PROMO20"></div>
          <div class="form-group"><label>Type de remise</label>
            <select name="discount_type">
              <option value="percent">Pourcentage (%)</option>
              <option value="fixed">Montant fixe (FCFA)</option>
            </select>
          </div>
          <div class="form-group"><label>Valeur (ex : 20 pour 20 %)</label><input type="number" name="discount_value" required placeholder="20"></div>
        </div>
        <div class="grid3">
          <div class="form-group"><label>Date début (optionnel)</label><input type="date" name="starts_at"></div>
          <div class="form-group"><label>Date fin (optionnel)</label><input type="date" name="ends_at"></div>
          <div class="form-group"><label>Max utilisations (vide = illimité)</label><input type="number" name="max_uses" placeholder="100"></div>
        </div>
        <button class="btn btn-primary" type="submit">Créer le coupon</button>
      </form>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Code</th><th>Remise</th><th>Période</th><th>Utilisations</th><th>Statut</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <script>
      function toggleEdit(id) {
        const row = document.getElementById('edit-' + id);
        row.style.display = row.style.display === 'table-row' ? 'none' : 'table-row';
      }
    </script>`;

    res.send(adminPage('Coupons', 'coupons', body));
  } catch (err) { next(err); }
});

router.post('/', couponValidation, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).send(errors.array()[0].msg);

    const { code, discount_type, discount_value, starts_at, ends_at, max_uses } = req.body;
    await query(
      `INSERT INTO coupons (code, discount_type, discount_value, starts_at, ends_at, max_uses, active)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
      [code, discount_type, Number(discount_value), starts_at || null, ends_at || null, max_uses ? Number(max_uses) : null]
    );
    setFlash(res, 'Coupon créé avec succès');
    res.redirect('/admin/coupons');
  } catch (err) { next(err); }
});

router.post('/:id', couponValidation, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).send(errors.array()[0].msg);

    const { code, discount_type, discount_value, starts_at, ends_at, max_uses } = req.body;
    await query(
      `UPDATE coupons SET code=$1, discount_type=$2, discount_value=$3, starts_at=$4, ends_at=$5, max_uses=$6 WHERE id=$7`,
      [code, discount_type, Number(discount_value), starts_at || null, ends_at || null, max_uses ? Number(max_uses) : null, req.params.id]
    );
    setFlash(res, 'Coupon mis à jour');
    res.redirect('/admin/coupons');
  } catch (err) { next(err); }
});

router.post('/:id/toggle', async (req, res, next) => {
  try {
    await query(`UPDATE coupons SET active = NOT active WHERE id = $1`, [req.params.id]);
    setFlash(res, 'Statut modifié');
    res.redirect('/admin/coupons');
  } catch (err) { next(err); }
});

module.exports = router;
