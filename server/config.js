'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const env = process.env;
const PORT = Number(env.PORT) || 3000;
const NODE_ENV = env.NODE_ENV || 'development';

module.exports = {
  root,
  PORT,
  NODE_ENV,
  isProd: NODE_ENV === 'production',
  APP_URL: (env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, ''),
  DATABASE_URL: env.DATABASE_URL || '',
  SQLITE_PATH: env.SQLITE_PATH || path.join(root, 'data', 'estateinvest.db'),
  UPLOAD_DIR: env.UPLOAD_DIR || path.join(root, 'data', 'uploads'),
  SESSION_DAYS: Number(env.SESSION_DAYS) || 7,
  TRUST_PROXY: env.TRUST_PROXY === '1',
  PAYMENT_WEBHOOK_SECRET: env.PAYMENT_WEBHOOK_SECRET || '',
  LIBRETRANSLATE_URL: env.LIBRETRANSLATE_URL || 'http://127.0.0.1:5000/translate',
  LIBRETRANSLATE_API_KEY: env.LIBRETRANSLATE_API_KEY || '',
  RESEND_API_KEY: env.RESEND_API_KEY || '',
  MAIL_FROM: env.MAIL_FROM || 'EstateInvest <no-reply@estateinvest.example>',
  SEED_ADMIN_EMAIL: env.SEED_ADMIN_EMAIL || 'admin@estateinvest.com',
  SEED_ADMIN_PASSWORD: env.SEED_ADMIN_PASSWORD || 'Admin@12345',
  SEED_DEMO_DATA: env.SEED_DEMO_DATA !== '0',
};
