'use strict';
const config = require('../config');
const { db, insert } = require('../db');
const { now, HttpError } = require('../lib/util');
const { check, passwordProblem } = require('../lib/validate');
const A = require('../lib/auth');
const { sendMail, audit, notify } = require('../lib/services');

async function sendVerification(user) {
  const token = await A.issueToken(user.id, 'verify_email', 48);
  await sendMail(user.email, 'Verify your email address',
    `Hi ${user.first_name},\n\nConfirm your email address to activate your SapronLife Financial Investment account:\n${config.APP_URL}/verify-email?token=${token}\n\nThis link expires in 48 hours. If you did not create an account, ignore this email.`);
}

function register(r) {
  r.get('/api/auth/me', async (ctx) => ({ user: A.publicUser(ctx.user) }));

  r.post('/api/auth/register', async (ctx) => {
    ctx.rateLimit('register', 10, 3600);
    const b = check(ctx.body, {
      first_name: { required: true, max: 60, label: 'first name' },
      last_name: { required: true, max: 60, label: 'last name' },
      email: { type: 'email', required: true },
      phone: { required: true, max: 30, pattern: /^\+?[\d\s()-]{7,30}$/, message: 'Enter a valid phone number.' },
      country: { required: true, max: 60 },
      password: { required: true, max: 128 },
      accept_terms: { type: 'bool' }, accept_privacy: { type: 'bool' }, accept_risk: { type: 'bool' },
    });
    const errors = {};
    const pwErr = passwordProblem(b.password);
    if (pwErr) errors.password = pwErr;
    if (!b.accept_terms) errors.accept_terms = 'Accept the Terms & Conditions to continue.';
    if (!b.accept_privacy) errors.accept_privacy = 'Accept the Privacy Policy to continue.';
    if (!b.accept_risk) errors.accept_risk = 'Confirm you have read the Risk Disclosure.';
    if (Object.keys(errors).length) throw new HttpError(422, 'Check the highlighted fields.', errors);
    const exists = await db.get('SELECT id FROM users WHERE email=?', [b.email]);
    if (exists) throw new HttpError(409, 'An account with this email already exists. Sign in instead.', { email: 'This email is already registered.' });
    const t = now();
    const id = await insert(db, 'users', {
      role: 'investor', first_name: b.first_name, last_name: b.last_name, email: b.email, phone: b.phone, country: b.country,
      password_hash: A.hashPassword(b.password), status: 'active', kyc_status: 'not_started', email_verified_at: t, terms_accepted_at: t, created_at: t, updated_at: t,
    });
    const user = await db.get('SELECT * FROM users WHERE id=?', [id]);
    await audit({ ...ctx, user }, 'user.register', 'user', id, null, { email: b.email });
    await notify(id, { type: 'account', title: 'Welcome to SapronLife Financial Investment', body: 'Complete identity verification to start investing.', link: '/app', email: false });
    return { ok: true };
  });

  r.post('/api/auth/login', async (ctx) => {
    ctx.rateLimit('login', 10, 900);
    const b = check(ctx.body, { email: { type: 'email', required: true }, password: { required: true, max: 128 } });
    const user = await db.get('SELECT * FROM users WHERE email=?', [b.email]);
    const ok = A.verifyPassword(b.password, user ? user.password_hash : A.DUMMY_HASH);
    if (!user || !ok) {
      await audit(ctx, 'auth.login_failed', 'user', user ? user.id : null, null, { email: b.email });
      throw new HttpError(401, 'The email or password is incorrect.');
    }
    if (user.status !== 'active') throw new HttpError(403, 'This account is suspended. Contact support for help.');
    const isNewDevice = !(await db.get('SELECT id FROM sessions WHERE user_id=? AND user_agent=? AND ip=?', [user.id, String(ctx.req.headers['user-agent'] || '').slice(0, 300), ctx.ip]));
    await A.createSession(ctx, user);
    await db.run('UPDATE users SET last_login_at=? WHERE id=?', [now(), user.id]);
    await audit({ ...ctx, user }, 'auth.login', 'user', user.id);
    if (isNewDevice && user.last_login_at) {
      await sendMail(user.email, 'New sign-in to your account',
        `Hi ${user.first_name},\n\nYour account was accessed from a new device or location (IP ${ctx.ip}) at ${new Date().toUTCString()}.\nIf this wasn't you, reset your password now: ${config.APP_URL}/forgot-password`);
    }
    return { user: A.publicUser(user) };
  });

  r.post('/api/auth/logout', async (ctx) => { await A.destroySession(ctx); return { ok: true }; });

  r.post('/api/auth/verify-email', async (ctx) => {
    ctx.rateLimit('verify', 20, 3600);
    const t = await A.consumeToken(ctx.body && ctx.body.token, 'verify_email');
    if (!t) throw new HttpError(400, 'This verification link is invalid or has expired. Request a new one from your dashboard.');
    await db.run('UPDATE users SET email_verified_at=?, updated_at=? WHERE id=? AND email_verified_at IS NULL', [now(), now(), t.user_id]);
    await audit(ctx, 'user.email_verified', 'user', t.user_id);
    return { ok: true };
  });

  r.post('/api/auth/resend-verification', async (ctx) => {
    A.requireUser(ctx);
    ctx.rateLimit('resend', 3, 3600);
    if (ctx.user.email_verified_at) return { ok: true, already: true };
    await sendVerification(ctx.user);
    return { ok: true };
  });

  r.post('/api/auth/forgot-password', async (ctx) => {
    ctx.rateLimit('forgot', 5, 3600);
    const b = check(ctx.body, { email: { type: 'email', required: true } });
    const user = await db.get('SELECT * FROM users WHERE email=?', [b.email]);
    if (user && user.status === 'active') {
      const token = await A.issueToken(user.id, 'reset_password', 1);
      await sendMail(user.email, 'Reset your password',
        `Hi ${user.first_name},\n\nUse this link to choose a new password:\n${config.APP_URL}/reset-password?token=${token}\n\nThe link expires in 1 hour. If you didn't ask for this, you can ignore this email.`);
    }
    // Same response either way so emails can't be enumerated.
    return { ok: true };
  });

  r.post('/api/auth/reset-password', async (ctx) => {
    ctx.rateLimit('reset', 10, 3600);
    const b = check(ctx.body, { token: { required: true, max: 100 }, password: { required: true, max: 128 } });
    const pwErr = passwordProblem(b.password);
    if (pwErr) throw new HttpError(422, 'Check the highlighted fields.', { password: pwErr });
    const t = await A.consumeToken(b.token, 'reset_password');
    if (!t) throw new HttpError(400, 'This reset link is invalid or has expired. Request a new one.');
    await db.run('UPDATE users SET password_hash=?, updated_at=? WHERE id=?', [A.hashPassword(b.password), now(), t.user_id]);
    await db.run('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', [now(), t.user_id]);
    await audit(ctx, 'auth.password_reset', 'user', t.user_id);
    await notify(t.user_id, { type: 'security', title: 'Your password was changed', body: 'Your password was reset and all devices were signed out. If this was not you, contact support immediately.' });
    return { ok: true };
  });

  r.post('/api/auth/change-password', async (ctx) => {
    A.requireUser(ctx);
    ctx.rateLimit('changepw', 10, 3600);
    const b = check(ctx.body, { current_password: { required: true, max: 128, label: 'current password' }, new_password: { required: true, max: 128, label: 'new password' } });
    if (!A.verifyPassword(b.current_password, ctx.user.password_hash)) throw new HttpError(422, 'Check the highlighted fields.', { current_password: 'Your current password is incorrect.' });
    const pwErr = passwordProblem(b.new_password);
    if (pwErr) throw new HttpError(422, 'Check the highlighted fields.', { new_password: pwErr });
    await db.run('UPDATE users SET password_hash=?, updated_at=? WHERE id=?', [A.hashPassword(b.new_password), now(), ctx.user.id]);
    await db.run('UPDATE sessions SET revoked_at=? WHERE user_id=? AND id<>? AND revoked_at IS NULL', [now(), ctx.user.id, ctx.session.id]);
    await audit(ctx, 'auth.password_changed', 'user', ctx.user.id);
    await notify(ctx.user.id, { type: 'security', title: 'Your password was changed', body: 'Your password was changed and other devices were signed out.' });
    return { ok: true };
  });

  r.get('/api/auth/sessions', async (ctx) => {
    A.requireUser(ctx);
    const rows = await db.all('SELECT id, ip, user_agent, created_at, last_seen_at FROM sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY last_seen_at DESC', [ctx.user.id, now()]);
    return { items: rows.map((s) => ({ ...s, current: s.id === ctx.session.id })) };
  });

  r.post('/api/auth/sessions/revoke-others', async (ctx) => {
    A.requireUser(ctx);
    const res = await db.run('UPDATE sessions SET revoked_at=? WHERE user_id=? AND id<>? AND revoked_at IS NULL', [now(), ctx.user.id, ctx.session.id]);
    await audit(ctx, 'auth.sessions_revoked', 'user', ctx.user.id, null, { count: res.changes });
    return { ok: true, revoked: res.changes };
  });
}

module.exports = { register };
