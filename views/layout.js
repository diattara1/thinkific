'use strict';

const { escapeHtml } = require('./helpers');

const ADMIN_CSS = `
  *{box-sizing:border-box}
  body{font-family:system-ui,Arial,sans-serif;background:#f1f5f9;margin:0;color:#1e293b}
  nav{background:#1e293b;color:#fff;padding:12px 24px;display:flex;gap:24px;align-items:center}
  nav a{color:#94a3b8;text-decoration:none;font-size:14px}
  nav a:hover,nav a.active{color:#fff}
  nav .brand{color:#fff;font-weight:700;font-size:16px;margin-right:auto}
  .container{max-width:1100px;margin:0 auto;padding:24px}
  h1{font-size:22px;margin:0 0 20px}
  .card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:24px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th{text-align:left;padding:10px 12px;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:600;white-space:nowrap}
  td{padding:9px 12px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#fafafa}
  .badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:12px;font-weight:600}
  .badge-green{background:#dcfce7;color:#166534}
  .badge-yellow{background:#fef9c3;color:#854d0e}
  .badge-red{background:#fee2e2;color:#991b1b}
  .badge-blue{background:#dbeafe;color:#1d4ed8}
  .badge-gray{background:#f1f5f9;color:#475569}
  input,select,textarea{padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;width:100%}
  input:focus,select:focus,textarea:focus{outline:2px solid #3b82f6;border-color:transparent}
  .btn{display:inline-block;padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-size:14px;font-weight:600;text-decoration:none}
  .btn-primary{background:#1e293b;color:#fff}
  .btn-primary:hover{background:#0f172a}
  .btn-danger{background:#ef4444;color:#fff}
  .btn-danger:hover{background:#dc2626}
  .btn-sm{padding:5px 10px;font-size:12px}
  .btn-outline{background:transparent;border:1px solid #cbd5e1;color:#475569}
  .btn-outline:hover{background:#f8fafc}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
  .form-group{margin-bottom:14px}
  .form-group label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
  .stat{text-align:center;padding:16px}
  .stat .val{font-size:32px;font-weight:800;color:#1e293b}
  .stat .lbl{font-size:13px;color:#64748b;margin-top:4px}
  .alert{padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:14px}
  .alert-success{background:#dcfce7;color:#166534}
  .alert-error{background:#fee2e2;color:#991b1b}
  .actions{display:flex;gap:8px;flex-wrap:wrap}
  .edit-row{display:none;background:#fffbeb}
  @media(max-width:640px){.grid2,.grid3{grid-template-columns:1fr}}
`;

function adminNav(active) {
  return `<nav>
    <span class="brand">&#9881; Admin</span>
    <a href="/admin" class="${active === 'dashboard' ? 'active' : ''}">Tableau de bord</a>
    <a href="/admin/products" class="${active === 'products' ? 'active' : ''}">Produits</a>
    <a href="/admin/coupons" class="${active === 'coupons' ? 'active' : ''}">Coupons</a>
    <a href="/admin/orders" class="${active === 'orders' ? 'active' : ''}">Commandes</a>
  </nav>`;
}

function adminPage(title, active, body) {
  return `<!doctype html><html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} – Admin</title>
<style>${ADMIN_CSS}</style></head>
<body>
${adminNav(active)}
<div class="container">
<h1>${escapeHtml(title)}</h1>
${body}
</div>
</body></html>`;
}

module.exports = { adminPage, adminNav, ADMIN_CSS };
