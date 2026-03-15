'use strict';

const crypto = require('crypto');
const config = require('../config/env');

function adminAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const [scheme, encoded] = auth.split(' ');

  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex !== -1) {
      const user = decoded.slice(0, colonIndex);
      const pass = decoded.slice(colonIndex + 1);

      const expectedUser = Buffer.from(config.ADMIN_USERNAME);
      const expectedPass = Buffer.from(config.ADMIN_PASSWORD);
      const givenUser   = Buffer.from(user);
      const givenPass   = Buffer.from(pass);

      // Constant-time comparison prevents timing attacks
      const userMatch =
        givenUser.length === expectedUser.length &&
        crypto.timingSafeEqual(givenUser, expectedUser);
      const passMatch =
        givenPass.length === expectedPass.length &&
        crypto.timingSafeEqual(givenPass, expectedPass);

      if (userMatch && passMatch) return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Admin", charset="UTF-8"');
  return res.status(401).send('Accès refusé');
}

module.exports = adminAuth;
