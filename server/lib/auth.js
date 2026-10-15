'use strict';
const crypto = require('crypto');
const config = require('../config');
const { db, insert } = require('../db');
const { HttpError, now, addDays, sha256, randomToken, parseJSON } = require('./util');

const COOKIE = 'ei_session';
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(pw, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const got = crypto.scryptSync(String(pw), Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
    return crypto.timingSafeEqual(expected, got);
  } catch { return false; }
}

// A dummy hash so failed lookups take the same time as real ones.
const DUMMY_HASH = hashPassword('timing-equaliser-' + randomToken(8));

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(token, maxAgeSec) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (config.isProd) parts.push('Secure');
  return parts.join('; ');
}

async function createSession(ctx, user) {
  const token = randomToken(32);
  const t = now();
  await insert(db, 'sessions', {
    user_id: user.id, token_hash: sha256(token), ip: ctx.ip, user_agent: String(ctx.req.headers['user-agent'] || '').slice(0, 300),
    created_at: t, last_seen_at: t, expires_at: addDays(t, config.SESSION_DAYS),
  });
  ctx.setHeader('Set-Cookie', sessionCookie(token, config.SESSION_DAYS * 86400));
  return token;
}

async function loadSession(ctx) {
  const token = parseCookies(ctx.req.headers.cookie)[COOKIE];
  if (!token || token.length > 100) return;
  const s = await db.get('SELECT * FROM sessions WHERE token_hash=?', [sha256(token)]);
  if (!s || s.revoked_at || s.expires_at < now()) return;
  const user = await db.get('SELECT * FROM users WHERE id=?', [s.user_id]);
  if (!user || user.status !== 'active') return;
  ctx.session = s;
  ctx.user = user;
  // Touch at most once a minute to keep writes low.
  if (Date.now() - new Date(s.last_seen_at).getTime() > 60000) {
    await db.run('UPDATE sessions SET last_seen_at=? WHERE id=?', [now(), s.id]);
  }
}

async function destroySession(ctx) {
  if (ctx.session) await db.run('UPDATE sessions SET revoked_at=? WHERE id=?', [now(), ctx.session.id]);
  ctx.setHeader('Set-Cookie', sessionCookie('', 0));
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, role: u.role, first_name: u.first_name, last_name: u.last_name, email: u.email, phone: u.phone,
    country: u.country, email_verified: !!u.email_verified_at, status: u.status, kyc_status: u.kyc_status,
    permissions: parseJSON(u.permissions, null), created_at: u.created_at, last_login_at: u.last_login_at,
  };
}

const isAdmin = (u) => u && (u.role === 'admin' || u.role === 'super_admin');

const ADMIN_PERMISSIONS = ['investors', 'kyc', 'properties', 'plans', 'investments', 'payments', 'redemptions', 'support', 'content', 'documents', 'reports'];

function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Sign in to continue.');
}
function requireInvestor(ctx) {
  requireUser(ctx);
  if (ctx.user.role !== 'investor') throw new HttpError(403, 'This area is for investor accounts.');
  if (!ctx.user.email_verified_at) throw new HttpError(403, 'Verify your email address to continue.');
}
function requireAdmin(ctx, permission) {
  requireUser(ctx);
  if (!isAdmin(ctx.user)) throw new HttpError(403, 'You do not have access to the admin area.');
  if (permission && ctx.user.role !== 'super_admin') {
    const perms = parseJSON(ctx.user.permissions, null);
    if (Array.isArray(perms) && !perms.includes(permission)) throw new HttpError(403, `Your role does not include ${permission} access.`);
  }
}
function requireSuper(ctx) {
  requireUser(ctx);
  if (ctx.user.role !== 'super_admin') throw new HttpError(403, 'Only a super admin can do this.');
}

async function issueToken(userId, type, hours) {
  const token = randomToken(32);
  await db.run('UPDATE tokens SET used_at=? WHERE user_id=? AND type=? AND used_at IS NULL', [now(), userId, type]);
  await insert(db, 'tokens', {
    user_id: userId, type, token_hash: sha256(token), created_at: now(),
    expires_at: new Date(Date.now() + hours * 3600000).toISOString(),
  });
  return token;
}

async function consumeToken(token, type) {
  if (typeof token !== 'string' || token.length > 100) return null;
  const t = await db.get('SELECT * FROM tokens WHERE token_hash=? AND type=?', [sha256(token), type]);
  if (!t || t.used_at || t.expires_at < now()) return null;
  await db.run('UPDATE tokens SET used_at=? WHERE id=?', [now(), t.id]);
  return t;
}

module.exports = {
  hashPassword, verifyPassword, DUMMY_HASH, createSession, loadSession, destroySession, publicUser, isAdmin,
  requireUser, requireInvestor, requireAdmin, requireSuper, issueToken, consumeToken, ADMIN_PERMISSIONS,
};
