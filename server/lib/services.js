'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { db, insert } = require('../db');
const { HttpError, now, parseJSON } = require('./util');

/* ------------------------------------------------------------------ settings */

const DEFAULT_SETTINGS = {
  payments: {
    mode: 'manual', // manual = admin verifies tx hash; provider = webhook-confirmed
    window_minutes: 60,
    required_confirmations: 3,
    auto_activate: true,
    demo_addresses: true,
    rates_updated_at: null,
    currencies: [
      { code: 'USDT', name: 'Tether', rate_usd: 1, decimals: 2, enabled: true, networks: [
        { code: 'TRC20', name: 'Tron (TRC20)', address: 'TDemoAddrReplaceBeforeLaunchTRC20x01' },
        { code: 'ERC20', name: 'Ethereum (ERC20)', address: '0xDemoAddrReplaceBeforeLaunchERC20000001' },
      ] },
      { code: 'BTC', name: 'Bitcoin', rate_usd: 65000, decimals: 8, enabled: true, networks: [
        { code: 'BTC', name: 'Bitcoin', address: 'bc1qdemoaddrreplacebeforelaunch0000btc' },
      ] },
      { code: 'ETH', name: 'Ethereum', rate_usd: 3200, decimals: 6, enabled: true, networks: [
        { code: 'ERC20', name: 'Ethereum mainnet', address: '0xDemoAddrReplaceBeforeLaunchETH00000001' },
      ] },
      { code: 'TON', name: 'Toncoin', rate_usd: 5.5, decimals: 4, enabled: true, networks: [
        { code: 'TON', name: 'TON', address: 'UQDemoAddrReplaceBeforeLaunchTON0000000000000001' },
      ] },
    ],
  },
  investing: {
    enabled: true,
    kyc_required: true,
    maturing_window_days: 14,
    redemptions_enabled: true,
    early_redemption: false,
  },
};

async function getSetting(key) {
  const row = await db.get('SELECT value FROM settings WHERE key=?', [key]);
  return { ...DEFAULT_SETTINGS[key], ...parseJSON(row && row.value, {}) };
}
async function setSetting(key, value, actorId) {
  await db.run(
    'INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at',
    [key, JSON.stringify(value), actorId || null, now()],
  );
}
async function getCms(key, fallback) {
  const row = await db.get('SELECT value FROM cms WHERE key=?', [key]);
  return parseJSON(row && row.value, fallback);
}
async function setCms(key, value, actorId) {
  await db.run(
    'INSERT INTO cms (key, value, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at',
    [key, JSON.stringify(value), actorId || null, now()],
  );
}

/* --------------------------------------------------------------------- audit */

async function audit(ctx, action, entity, entityId, before, after) {
  const u = ctx && ctx.user;
  await insert(db, 'audit_logs', {
    actor_id: u ? u.id : null, actor_email: u ? u.email : null, action, entity: entity || null,
    entity_id: entityId != null ? String(entityId) : null,
    before_data: before ? JSON.stringify(before).slice(0, 8000) : null,
    after_data: after ? JSON.stringify(after).slice(0, 8000) : null,
    ip: ctx ? ctx.ip : null, created_at: now(),
  });
}

/* ---------------------------------------------------------------------- mail */

async function sendMail(to, subject, text) {
  const id = await insert(db, 'emails', { to_email: to, subject, body_text: text, status: 'queued', created_at: now() });
  if (!config.RESEND_API_KEY) {
    await db.run('UPDATE emails SET status=? WHERE id=?', ['logged', id]);
    if (!config.isProd && process.env.QUIET_MAIL !== '1') console.log(`\n[mail] to=${to} subject="${subject}"\n${text}\n`);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.MAIL_FROM, to: [to], subject, text, html: mailHtml(subject, text) }),
    });
    if (!res.ok) throw new Error(`Provider responded ${res.status}`);
    await db.run('UPDATE emails SET status=? WHERE id=?', ['sent', id]);
  } catch (e) {
    await db.run('UPDATE emails SET status=?, error=? WHERE id=?', ['failed', String(e.message).slice(0, 500), id]);
  }
}

function mailHtml(subject, text) {
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const body = esc(text).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color:#16834a">$1</a>').replace(/\n/g, '<br>');
  return `<div style="background:#f1f7f3;padding:32px;font-family:Arial,sans-serif"><div style="max-width:560px;margin:auto;background:#fff;border-radius:10px;overflow:hidden"><div style="background:#123825;color:#ffffff;padding:20px 28px;font-size:20px;font-weight:700;font-family:Arial,sans-serif">Manulife Financial Investment</div><div style="padding:28px;color:#1d2735;line-height:1.6"><h2 style="font-family:Georgia,serif;margin-top:0">${esc(subject)}</h2>${body}</div></div></div>`;
}

/* ------------------------------------------------------------- notifications */

async function notify(userId, { type, title, body, link, email = true }) {
  await insert(db, 'notifications', { user_id: userId, type, title, body: body || null, link: link || null, created_at: now() });
  if (email) {
    const u = await db.get('SELECT email, first_name FROM users WHERE id=?', [userId]);
    if (u) {
      const url = link ? `\n\nView it here: ${config.APP_URL}${link}` : '';
      await sendMail(u.email, title, `Hi ${u.first_name},\n\n${body || title}${url}\n\nManulife Financial Investment`);
    }
  }
}

async function notifyAdmins(title, body, link, { email = false } = {}) {
  const admins = await db.all("SELECT id FROM users WHERE role IN ('admin','super_admin') AND status='active'");
  for (const a of admins) await notify(a.id, { type: 'admin', title, body, link, email });
}

/* ------------------------------------------------------------------- uploads */

const ALLOWED = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP',
  'application/pdf': (b) => b.slice(0, 5).toString() === '%PDF-',
};
const MAX_UPLOAD = 10 * 1024 * 1024;

async function readStoredUpload(stored) {
  if (config.isVercel) {
    const { get } = await import('@vercel/blob');
    const result = await get(stored, { access: 'private', useCache: false });
    return result?.statusCode === 200 ? Buffer.from(await new Response(result.stream).arrayBuffer()) : null;
  }
  const filePath = path.join(config.UPLOAD_DIR, path.basename(stored));
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
}

async function writeStoredUpload(stored, buf, mime) {
  if (config.isVercel) {
    const { put } = await import('@vercel/blob');
    const result = await put(stored, buf, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: mime });
    return result.pathname;
  }
  fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(config.UPLOAD_DIR, path.basename(stored)), buf, { mode: 0o600 });
  return stored;
}

async function findUploadToken(pathname, uploaderId, kind) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const token = await db.get('SELECT * FROM upload_tokens WHERE pathname=? AND user_id=? AND purpose=? AND used_at IS NULL AND expires_at>?', [pathname, uploaderId, kind, now()]);
    if (token) return token;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function saveUpload(file, ownerId, kind, visibility = 'private', allowed = Object.keys(ALLOWED), uploaderId = ownerId) {
  const input = file || {};
  let { data, name, mime } = input;
  let buf;
  let stored;
  let uploadToken;
  if (typeof input.pathname === 'string' && input.pathname && config.isVercel) {
    uploadToken = await findUploadToken(input.pathname, uploaderId, kind);
    const safeInputName = String(input.name || 'file').replace(/[^\w.\- ]/g, '_').slice(0, 120);
    if (!uploadToken || uploadToken.original_name !== safeInputName || uploadToken.mime !== input.mime || Number(uploadToken.size) !== Number(input.size)) {
      throw new HttpError(403, 'This uploaded file is not authorized for this account or action.');
    }
    name = uploadToken.original_name;
    mime = uploadToken.mime;
    stored = uploadToken.pathname;
    buf = await readStoredUpload(stored);
  } else if (typeof data === 'string' && data) {
    buf = Buffer.from(data.replace(/^data:[^,]+,/, ''), 'base64');
  } else {
    throw new HttpError(422, 'Choose a file to upload.');
  }
  if (!buf) throw new HttpError(404, 'Uploaded file was not found.');
  if (uploadToken && buf.length !== Number(uploadToken.size)) throw new HttpError(422, 'Uploaded file size does not match its authorization.');
  if (!allowed.includes(mime) || !ALLOWED[mime]) throw new HttpError(422, `Upload a ${allowed.map((m) => m.split('/')[1].toUpperCase()).join(', ')} file.`);
  if (!buf.length) throw new HttpError(422, 'The file is empty.');
  if (buf.length > MAX_UPLOAD) throw new HttpError(413, 'Files must be 10 MB or smaller.');
  if (!ALLOWED[mime](buf)) throw new HttpError(422, 'The file content does not match its type. Upload a real JPG, PNG, WEBP or PDF.');
  if (!stored) stored = config.isVercel ? `files/${crypto.randomBytes(20).toString('hex')}` : crypto.randomBytes(20).toString('hex');
  if (!uploadToken) stored = await writeStoredUpload(stored, buf, mime);
  if (uploadToken) await db.run('UPDATE upload_tokens SET used_at=? WHERE upload_id=? AND used_at IS NULL', [now(), uploadToken.upload_id]);
  const safeName = String(name || 'file').replace(/[^\w.\- ]/g, '_').slice(0, 120);
  const id = await insert(db, 'files', {
    owner_id: ownerId || null, kind, original_name: safeName, stored_name: stored, mime, size: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'), visibility, created_at: now(),
  });
  return { id, name: safeName, mime, size: buf.length, url: `/api/files/${id}` };
}

function readUpload(file) { return readStoredUpload(file.stored_name); }

/* ----------------------------------------------------------------------- csv */

function toCSV(rows, columns) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula injection guard
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','));
  return '\ufeff' + [head, ...body].join('\r\n');
}

/* ------------------------------------------------------------------- refs */

async function assignRef(h, table, prefix, id, base = 10000) {
  const ref = `${prefix}-${base + id}`;
  await h.run(`UPDATE ${table} SET ref=? WHERE id=?`, [ref, id]);
  return ref;
}

module.exports = {
  DEFAULT_SETTINGS, getSetting, setSetting, getCms, setCms, audit, sendMail, notify, notifyAdmins,
  saveUpload, readUpload, toCSV, assignRef,
};
