'use strict';

const { escapeHtml } = require('../views/helpers');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[error]', err.message || err);

  const isApi = req.path.startsWith('/paytech') || req.headers.accept?.includes('application/json');

  if (isApi) {
    return res.status(err.status || 500).json({ ok: false, message: err.message || 'Erreur serveur' });
  }

  return res.status(err.status || 500).send(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
    <title>Erreur</title>
    <style>body{font-family:system-ui;background:#f8fafc;padding:40px;color:#1e293b}
    .box{max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 16px rgba(0,0,0,.08)}
    h1{color:#dc2626;font-size:20px}p{color:#64748b;font-size:14px}</style></head>
    <body><div class="box"><h1>Une erreur est survenue</h1>
    <p>${escapeHtml(err.message || 'Erreur interne du serveur.')}</p>
    <a href="javascript:history.back()" style="font-size:14px;color:#3b82f6">Retour</a>
    </div></body></html>`);
}

module.exports = errorHandler;
