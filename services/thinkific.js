'use strict';

const axios = require('axios');
const config = require('../config/env');

function thinkificHeaders() {
  return {
    'X-Auth-API-Key': config.THINKIFIC_API_KEY,
    'X-Auth-Subdomain': config.THINKIFIC_SUBDOMAIN,
    'Content-Type': 'application/json',
  };
}

async function createUser({ firstName, lastName, email }) {
  const resp = await axios.post(
    'https://api.thinkific.com/api/public/v1/users',
    {
      first_name: firstName,
      last_name: lastName,
      email,
      send_welcome_email: config.THINKIFIC_SEND_WELCOME_EMAIL,
    },
    { headers: thinkificHeaders(), timeout: 30000 }
  );
  return resp.data;
}

async function findUserByEmail(email) {
  const headers = thinkificHeaders();
  const endpoints = [
    `https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(email)}`,
    `https://api.thinkific.com/api/public/v1/users?email=${encodeURIComponent(email)}`,
    `https://api.thinkific.com/api/public/v1/users?query=${encodeURIComponent(email)}`,
  ];

  // Thinkific has inconsistent endpoint formats across API versions — try each until one returns the user
  for (const url of endpoints) {
    try {
      const resp = await axios.get(url, { headers, timeout: 30000 });
      const rows = Array.isArray(resp.data?.items)
        ? resp.data.items
        : Array.isArray(resp.data)
        ? resp.data
        : [];
      const found = rows.find(
        (u) => String(u.email || '').toLowerCase() === String(email).toLowerCase()
      );
      if (found) return found;
    } catch {
      // try next endpoint
    }
  }
  return null;
}

async function ensureUser({ firstName, lastName, email }) {
  try {
    return await createUser({ firstName, lastName, email });
  } catch (error) {
    const status = error.response?.status;
    if (status === 422 || status === 400 || status === 409) {
      const existing = await findUserByEmail(email);
      if (existing) return existing;
    }
    throw new Error(
      `Erreur création utilisateur Thinkific : ${
        error.response?.data ? JSON.stringify(error.response.data) : error.message
      }`
    );
  }
}

async function ensureEnrollment({ userId, courseId }) {
  try {
    const resp = await axios.post(
      'https://api.thinkific.com/api/public/v1/enrollments',
      { user_id: userId, course_id: Number(courseId), activated: true },
      { headers: thinkificHeaders(), timeout: 30000 }
    );
    return resp.data;
  } catch (error) {
    const status = error.response?.status;
    if (status === 422 || status === 409) {
      return { id: null, message: 'Déjà inscrit ou inscription existante' };
    }
    throw new Error(
      `Erreur inscription Thinkific : ${
        error.response?.data ? JSON.stringify(error.response.data) : error.message
      }`
    );
  }
}

module.exports = { ensureUser, ensureEnrollment };
