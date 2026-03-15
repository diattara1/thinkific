'use strict';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatPrice(cents, currency) {
  return `${Number(cents).toLocaleString('fr-FR')} ${escapeHtml(currency)}`;
}

function statusBadge(status) {
  const map = {
    pending:   ['badge-yellow', 'En attente'],
    paid:      ['badge-blue',   'Payé'],
    enrolled:  ['badge-green',  'Inscrit'],
    cancelled: ['badge-gray',   'Annulé'],
    failed:    ['badge-red',    'Échoué'],
  };
  const [cls, label] = map[status] || ['badge-gray', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

module.exports = { escapeHtml, formatPrice, statusBadge };
