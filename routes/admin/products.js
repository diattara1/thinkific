'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../../db');
const { adminPage } = require('../../views/layout');
const { escapeHtml } = require('../../views/helpers');

const router = express.Router();

const productValidation = [
  body('slug').trim().matches(/^[a-z0-9-]+$/).withMessage('Slug invalide (lettres minuscules, chiffres, tirets)'),
  body('title').trim().notEmpty().withMessage('Le titre est obligatoire'),
  body('thinkific_course_id').isInt({ min: 1 }).withMessage('Course ID invalide'),
  body('price_cents').isInt({ min: 0 }).withMessage('Prix invalide'),
  body('currency').trim().notEmpty().withMessage('Devise obligatoire'),
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

router.get('/', async (req, res, next) => {
  try {
    const flash = flashAlert(req);
    res.clearCookie('flash_msg');
    const products = await query(`SELECT * FROM products ORDER BY created_at DESC`);

    const rows = products.rows.map(p => `
      <tr id="row-${p.id}">
        <td>${escapeHtml(p.slug)}</td>
        <td>${escapeHtml(p.title)}</td>
        <td>${escapeHtml(String(p.thinkific_course_id))}</td>
        <td style="white-space:nowrap">${Number(p.price_cents).toLocaleString('fr-FR')} ${escapeHtml(p.currency)}</td>
        <td>${p.active ? '<span class="badge badge-green">Actif</span>' : '<span class="badge badge-gray">Inactif</span>'}</td>
        <td class="actions">
          <button class="btn btn-outline btn-sm" onclick="toggleEdit(${p.id})">Éditer</button>
          <form method="post" action="/admin/products/${p.id}/toggle" style="display:inline" onsubmit="return confirm('Confirmer ?')">
            <button class="btn btn-sm ${p.active ? 'btn-danger' : 'btn-primary'}">${p.active ? 'Désactiver' : 'Activer'}</button>
          </form>
        </td>
      </tr>
      <tr class="edit-row" id="edit-${p.id}">
        <td colspan="6">
          <form method="post" action="/admin/products/${p.id}" style="padding:12px">
            <div class="grid3">
              <div class="form-group"><label>Slug</label><input name="slug" value="${escapeHtml(p.slug)}" required></div>
              <div class="form-group"><label>Titre</label><input name="title" value="${escapeHtml(p.title)}" required></div>
              <div class="form-group"><label>Course ID Thinkific</label><input name="thinkific_course_id" value="${escapeHtml(String(p.thinkific_course_id))}" required></div>
            </div>
            <div class="grid3">
              <div class="form-group"><label>Prix (centimes)</label><input type="number" name="price_cents" value="${p.price_cents}" required></div>
              <div class="form-group"><label>Devise</label><input name="currency" value="${escapeHtml(p.currency)}" required></div>
              <div class="form-group"><label>Description</label><input name="description" value="${escapeHtml(p.description || '')}"></div>
            </div>
            <div class="actions">
              <button class="btn btn-primary" type="submit">Enregistrer</button>
              <button class="btn btn-outline" type="button" onclick="toggleEdit(${p.id})">Annuler</button>
            </div>
          </form>
        </td>
      </tr>`).join('');

    const body = `
    ${flash}
    <div class="card">
      <h2 style="font-size:16px;margin:0 0 16px">Nouveau produit</h2>
      <form method="post" action="/admin/products">
        <div class="grid3">
          <div class="form-group"><label>Slug (ex : formation-ia)</label><input name="slug" required placeholder="formation-ia"></div>
          <div class="form-group"><label>Titre</label><input name="title" required placeholder="Formation IA"></div>
          <div class="form-group"><label>Course ID Thinkific</label><input name="thinkific_course_id" required placeholder="123456"></div>
        </div>
        <div class="grid3">
          <div class="form-group"><label>Prix (centimes, ex : 10000)</label><input type="number" name="price_cents" required placeholder="10000"></div>
          <div class="form-group"><label>Devise</label><input name="currency" value="XOF" required></div>
          <div class="form-group"><label>Description</label><input name="description" placeholder="Optionnel"></div>
        </div>
        <button class="btn btn-primary" type="submit">Créer le produit</button>
      </form>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Slug</th><th>Titre</th><th>Course ID</th><th>Prix</th><th>Statut</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <script>
      function toggleEdit(id) {
        const row = document.getElementById('edit-' + id);
        row.style.display = row.style.display === 'table-row' ? 'none' : 'table-row';
      }
    </script>`;

    res.send(adminPage('Produits', 'products', body));
  } catch (err) { next(err); }
});

router.post('/', productValidation, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).send(errors.array()[0].msg);

    const { slug, title, thinkific_course_id, price_cents, currency, description } = req.body;
    await query(
      `INSERT INTO products (slug, title, thinkific_course_id, price_cents, currency, description, active)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
      [slug, title, Number(thinkific_course_id), Number(price_cents), currency, description?.trim() || null]
    );
    setFlash(res, 'Produit créé avec succès');
    res.redirect('/admin/products');
  } catch (err) { next(err); }
});

router.post('/:id', productValidation, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).send(errors.array()[0].msg);

    const { slug, title, thinkific_course_id, price_cents, currency, description } = req.body;
    await query(
      `UPDATE products SET slug=$1, title=$2, thinkific_course_id=$3, price_cents=$4, currency=$5, description=$6 WHERE id=$7`,
      [slug, title, Number(thinkific_course_id), Number(price_cents), currency, description?.trim() || null, req.params.id]
    );
    setFlash(res, 'Produit mis à jour');
    res.redirect('/admin/products');
  } catch (err) { next(err); }
});

router.post('/:id/toggle', async (req, res, next) => {
  try {
    await query(`UPDATE products SET active = NOT active WHERE id = $1`, [req.params.id]);
    setFlash(res, 'Statut modifié');
    res.redirect('/admin/products');
  } catch (err) { next(err); }
});

module.exports = router;
