'use strict';
const crypto = require('node:crypto');
const { db, insert, update } = require('../db');
const { now, round, parseJSON, HttpError, NotFound, slugify, paginate } = require('../lib/util');
const { check, passwordProblem } = require('../lib/validate');
const A = require('../lib/auth');
const S = require('../lib/services');
const E = require('../lib/engine');
const { Raw } = require('../lib/http');
const { serializeProperty, serializePlan, raisedFor } = require('./public');
const { serializeInvestment, serializePayment, INV_SELECT, FUNDED, inList } = require('./investor');

const PROPERTY_TYPES = ['residential', 'commercial', 'mixed_use', 'hospitality'];
const DEV_STATUSES = ['planning', 'under_development', 'completed', 'operational'];

const likeParam = (q) => `%${String(q).toLowerCase().slice(0, 80)}%`;

function monthKey(d) { const x = new Date(d); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`; }

function register(r) {
  /* --------------------------------------------------------------- dashboard */
  r.get('/api/admin/dashboard', async (ctx) => {
    A.requireAdmin(ctx);
    const year = Number(ctx.query.year) || new Date().getUTCFullYear();
    const one = async (sql, p) => Number((await db.get(sql, p)).n);
    const startMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const [investors, investorsPrev, activeInv, activePrev, totalInvested, totalPrev, pendingKyc, maturing, matured, pendingRed, paymentsReview] = await Promise.all([
      one("SELECT COUNT(*) AS n FROM users WHERE role='investor' AND status<>'deleted'"),
      one("SELECT COUNT(*) AS n FROM users WHERE role='investor' AND status<>'deleted' AND created_at < ?", [startMonth]),
      one("SELECT COUNT(*) AS n FROM investments WHERE status IN ('active','maturing')"),
      one("SELECT COUNT(*) AS n FROM investments WHERE status IN ('active','maturing') AND start_date < ?", [startMonth]),
      one(`SELECT COALESCE(SUM(amount_usd),0) AS n FROM investments WHERE status IN (${inList(FUNDED)})`),
      one(`SELECT COALESCE(SUM(amount_usd),0) AS n FROM investments WHERE status IN (${inList(FUNDED)}) AND created_at < ?`, [startMonth]),
      one("SELECT COUNT(*) AS n FROM users WHERE role='investor' AND status<>'deleted' AND kyc_status='pending_review'"),
      one("SELECT COUNT(*) AS n FROM investments WHERE status='maturing'"),
      one("SELECT COUNT(*) AS n FROM investments WHERE status='matured'"),
      one("SELECT COUNT(*) AS n FROM redemptions WHERE status IN ('requested','under_review','approved')"),
      one("SELECT COUNT(*) AS n FROM payments WHERE status='submitted'"),
    ]);
    const pct = (a, b) => (b ? round(((a - b) / b) * 100, 1) : null);
    const funded = await db.all(`SELECT amount_usd, created_at FROM investments WHERE status IN (${inList(FUNDED)}) AND created_at >= ? AND created_at < ?`, [`${year}-01-01`, `${year + 1}-01-01`]);
    const activity = Array.from({ length: 12 }, (_, m) => ({ month: m, count: 0, amount: 0 }));
    for (const f of funded) { const m = new Date(f.created_at).getUTCMonth(); activity[m].count++; activity[m].amount += Number(f.amount_usd); }
    const recent = await db.all('SELECT p.*, u.first_name, u.last_name, u.email, i.ref AS investment_ref FROM payments p JOIN users u ON u.id=p.user_id LEFT JOIN investments i ON i.id=p.investment_id ORDER BY p.id DESC LIMIT 8');
    return {
      stats: {
        investors, investors_change: pct(investors, investorsPrev), active_investments: activeInv, active_change: pct(activeInv, activePrev),
        total_invested: totalInvested, invested_change: pct(totalInvested, totalPrev), pending_kyc: pendingKyc, maturing, matured,
        pending_redemptions: pendingRed, payments_review: paymentsReview,
      },
      activity, year, recent: recent.map(serializePayment),
    };
  });

  /* --------------------------------------------------------------- investors */
  r.get('/api/admin/investors', async (ctx) => {
    A.requireAdmin(ctx, 'investors');
    const { page, size, offset } = paginate(ctx.query);
    const where = ["u.role='investor'", "u.status<>'deleted'"];
    const p = [];
    if (ctx.query.q) { where.push("(LOWER(u.first_name || ' ' || u.last_name) LIKE ? OR LOWER(u.email) LIKE ? OR u.phone LIKE ?)"); const l = likeParam(ctx.query.q); p.push(l, l, l); }
    if (['active', 'suspended'].includes(ctx.query.status)) { where.push('u.status=?'); p.push(ctx.query.status); }
    if (['not_started', 'pending_review', 'approved', 'rejected', 'requires_info'].includes(ctx.query.kyc)) { where.push('u.kyc_status=?'); p.push(ctx.query.kyc); }
    const w = where.join(' AND ');
    const total = Number((await db.get(`SELECT COUNT(*) AS n FROM users u WHERE ${w}`, p)).n);
    const items = await db.all(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.country, u.status, u.kyc_status, u.email_verified_at, u.created_at, u.last_login_at,
        (SELECT COALESCE(SUM(amount_usd),0) FROM investments i WHERE i.user_id=u.id AND i.status IN (${inList(FUNDED)})) AS invested,
        (SELECT COUNT(*) FROM investments i WHERE i.user_id=u.id AND i.status IN ('active','maturing')) AS active_count
       FROM users u WHERE ${w} ORDER BY u.created_at DESC LIMIT ${size} OFFSET ${offset}`, p,
    );
    return { items: items.map((x) => ({ ...x, invested: Number(x.invested), active_count: Number(x.active_count) })), total, page, size };
  });

  r.get('/api/admin/investors/:id', async (ctx) => {
    A.requireAdmin(ctx, 'investors');
    const u = await db.get("SELECT * FROM users WHERE id=? AND role='investor' AND status<>'deleted'", [Number(ctx.params.id) || 0]);
    if (!u) throw NotFound('Investor');
    const [invs, pays, docs, tickets, kyc, reds, wallets] = await Promise.all([
      db.all(`${INV_SELECT} WHERE i.user_id=? ORDER BY i.id DESC`, [u.id]),
      db.all('SELECT p.*, i.ref AS investment_ref FROM payments p LEFT JOIN investments i ON i.id=p.investment_id WHERE p.user_id=? ORDER BY p.id DESC', [u.id]),
      db.all('SELECT * FROM documents WHERE user_id=? ORDER BY id DESC', [u.id]),
      db.all('SELECT * FROM tickets WHERE user_id=? ORDER BY id DESC', [u.id]),
      db.get('SELECT * FROM kyc_submissions WHERE user_id=?', [u.id]),
      db.all('SELECT r.*, i.ref AS investment_ref FROM redemptions r JOIN investments i ON i.id=r.investment_id WHERE r.user_id=? ORDER BY r.id DESC', [u.id]),
      db.all('SELECT id, currency, network, address, updated_at FROM payout_wallets WHERE user_id=? ORDER BY currency, network', [u.id]),
    ]);
    return {
      investor: A.publicUser(u), investments: invs.map(serializeInvestment), payments: pays.map(serializePayment), documents: docs,
      tickets, redemptions: reds, wallets, kyc: kyc ? { status: kyc.status, personal: parseJSON(kyc.personal, {}), submitted_at: kyc.submitted_at, admin_note: kyc.admin_note } : null,
    };
  });

  r.post('/api/admin/investors/:id/status', async (ctx) => {
    A.requireAdmin(ctx, 'investors');
    const b = check(ctx.body, { status: { type: 'enum', required: true, values: ['active', 'suspended'] }, reason: { required: true, max: 500 } });
    const u = await db.get("SELECT * FROM users WHERE id=? AND role='investor' AND status<>'deleted'", [Number(ctx.params.id) || 0]);
    if (!u) throw NotFound('Investor');
    await db.run('UPDATE users SET status=?, updated_at=? WHERE id=?', [b.status, now(), u.id]);
    if (b.status === 'suspended') await db.run('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', [now(), u.id]);
    await S.audit(ctx, `investor.${b.status === 'active' ? 'activate' : 'suspend'}`, 'user', u.id, { status: u.status }, { status: b.status, reason: b.reason });
    await S.sendMail(u.email, b.status === 'active' ? 'Your account is active' : 'Your account has been suspended',
      `Hi ${u.first_name},\n\n${b.status === 'active' ? 'Your Manulife Financial Investment account has been reactivated.' : `Your Manulife Financial Investment account has been suspended. Reason: ${b.reason}\n\nContact support if you have questions.`}`);
    return { ok: true };
  });

  r.delete('/api/admin/investors/:id', async (ctx) => {
    A.requireAdmin(ctx, 'investors');
    const id = Number(ctx.params.id) || 0;
    const u = await db.get("SELECT id, status FROM users WHERE id=? AND role='investor' AND status<>'deleted'", [id]);
    if (!u) throw NotFound('Investor');
    const t = now();
    await db.tx(async (h) => {
      const result = await h.run("UPDATE users SET first_name='Deleted', last_name='Member', email=?, phone=NULL, country=NULL, password_hash=?, email_verified_at=NULL, last_login_at=NULL, status='deleted', updated_at=? WHERE id=? AND role='investor' AND status<>'deleted'", [
        `deleted-${id}@deleted.invalid`, A.hashPassword(crypto.randomBytes(32).toString('hex')), t, id,
      ]);
      if (!result.changes) throw NotFound('Investor');
      await h.run('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', [t, id]);
      await h.run('UPDATE tokens SET used_at=? WHERE user_id=? AND used_at IS NULL', [t, id]);
      await h.run('UPDATE upload_tokens SET used_at=?, expires_at=? WHERE user_id=? AND used_at IS NULL', [t, t, id]);
    });
    await S.audit(ctx, 'investor.delete', 'user', id, { status: u.status }, { status: 'deleted' });
    return { ok: true };
  });

  /* --------------------------------------------------------------------- KYC */
  r.get('/api/admin/kyc', async (ctx) => {
    A.requireAdmin(ctx, 'kyc');
    const status = ['pending_review', 'approved', 'rejected', 'requires_info', 'not_started'].includes(ctx.query.status) ? ctx.query.status : 'pending_review';
    const items = await db.all(
      `SELECT k.*, u.first_name, u.last_name, u.email, u.country FROM kyc_submissions k JOIN users u ON u.id=k.user_id WHERE k.status=? AND u.status<>'deleted' ORDER BY COALESCE(k.submitted_at, k.updated_at) DESC LIMIT 200`, [status],
    );
    const counts = await db.all("SELECT k.status, COUNT(*) AS n FROM kyc_submissions k JOIN users u ON u.id=k.user_id WHERE u.status<>'deleted' GROUP BY k.status");
    return { items: items.map((k) => ({ user_id: k.user_id, name: `${k.first_name} ${k.last_name}`, email: k.email, country: k.country, status: k.status, submitted_at: k.submitted_at, reviewed_at: k.reviewed_at })), counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])) };
  });

  r.get('/api/admin/kyc/:userId', async (ctx) => {
    A.requireAdmin(ctx, 'kyc');
    const u = await db.get('SELECT * FROM users WHERE id=?', [Number(ctx.params.userId) || 0]);
    if (!u) throw NotFound('Investor');
    const k = await db.get('SELECT * FROM kyc_submissions WHERE user_id=?', [u.id]);
    const docs = await db.all('SELECT d.id, d.kind, d.status, d.created_at, f.id AS file_id, f.mime, f.original_name, f.size FROM kyc_documents d JOIN files f ON f.id=d.file_id WHERE d.user_id=? ORDER BY d.id DESC', [u.id]);
    return {
      investor: A.publicUser(u),
      kyc: k ? { status: k.status, personal: parseJSON(k.personal, {}), id_doc_type: k.id_doc_type, source_of_funds: parseJSON(k.source_of_funds, {}), suitability: parseJSON(k.suitability, {}), admin_note: k.admin_note, submitted_at: k.submitted_at, reviewed_at: k.reviewed_at } : null,
      documents: docs.map((d) => ({ ...d, url: `/api/files/${d.file_id}` })),
    };
  });

  r.post('/api/admin/kyc/:userId/decision', async (ctx) => {
    A.requireAdmin(ctx, 'kyc');
    const b = check(ctx.body, {
      decision: { type: 'enum', required: true, values: ['approved', 'rejected', 'requires_info'] }, note: { type: 'text', max: 2000 },
      documents: { type: 'object' },
    });
    if (b.decision !== 'approved' && !b.note) throw new HttpError(422, 'Check the highlighted fields.', { note: 'Tell the investor what is wrong or what you need.' });
    const u = await db.get('SELECT * FROM users WHERE id=?', [Number(ctx.params.userId) || 0]);
    const k = u && (await db.get('SELECT * FROM kyc_submissions WHERE user_id=?', [u.id]));
    if (!k) throw NotFound('KYC submission');
    if (k.status !== 'pending_review' && b.decision !== 'requires_info') throw new HttpError(409, 'Only submissions pending review can be approved or rejected.');
    await db.tx(async (h) => {
      await h.run('UPDATE kyc_submissions SET status=?, admin_note=?, reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=?', [b.decision, b.note || null, ctx.user.id, now(), now(), k.id]);
      await h.run('UPDATE users SET kyc_status=?, updated_at=? WHERE id=?', [b.decision, now(), u.id]);
      for (const [docId, st] of Object.entries(b.documents || {})) {
        if (['verified', 'rejected', 'pending'].includes(st)) await h.run("UPDATE kyc_documents SET status=? WHERE id=? AND user_id=? AND status<>'replaced'", [st, Number(docId), u.id]);
      }
      if (b.decision === 'approved') await h.run("UPDATE kyc_documents SET status='verified' WHERE user_id=? AND status='pending'", [u.id]);
    });
    await S.audit(ctx, `kyc.${b.decision}`, 'user', u.id, { status: k.status }, { status: b.decision, note: b.note });
    const msg = {
      approved: ['Identity verified', 'Your identity verification was approved. You can now invest.'],
      rejected: ['Identity verification was not approved', `Your verification was not approved. ${b.note || ''}`],
      requires_info: ['We need more information', `Please update your verification. ${b.note || ''}`],
    }[b.decision];
    await S.notify(u.id, { type: 'kyc', title: msg[0], body: msg[1], link: '/app/kyc' });
    return { ok: true };
  });

  /* ------------------------------------------------------------- investments */
  r.get('/api/admin/investments', async (ctx) => {
    A.requireAdmin(ctx, 'investments');
    const { page, size, offset } = paginate(ctx.query);
    const where = ['1=1'];
    const p = [];
    if (ctx.query.q) {
      where.push("(LOWER(i.ref) LIKE ? OR LOWER(u.first_name || ' ' || u.last_name) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(pr.name) LIKE ?)");
      const l = likeParam(ctx.query.q); p.push(l, l, l, l);
    }
    if (E.STATUSES.includes(ctx.query.status)) { where.push('i.status=?'); p.push(ctx.query.status); }
    const base = `FROM investments i JOIN users u ON u.id=i.user_id JOIN properties pr ON pr.id=i.property_id JOIN plans pl ON pl.id=i.plan_id WHERE ${where.join(' AND ')}`;
    const total = Number((await db.get(`SELECT COUNT(*) AS n ${base}`, p)).n);
    const rows = await db.all(`SELECT i.*, pr.name AS property_name, pr.slug AS property_slug, pr.type AS property_type, pr.art_seed, pl.name AS plan_name, u.first_name, u.last_name, u.email ${base} ORDER BY i.id DESC LIMIT ${size} OFFSET ${offset}`, p);
    return { items: rows.map(serializeInvestment), total, page, size };
  });

  r.get('/api/admin/investments/:id', async (ctx) => {
    A.requireAdmin(ctx, 'investments');
    const i = await db.get(`${INV_SELECT} WHERE i.id=?`, [Number(ctx.params.id) || 0]);
    if (!i) throw NotFound('Investment');
    const [u, payments, history, plan, reds, docs] = await Promise.all([
      db.get('SELECT * FROM users WHERE id=?', [i.user_id]),
      db.all('SELECT * FROM payments WHERE investment_id=? ORDER BY id DESC', [i.id]),
      db.all('SELECT h.*, a.email AS actor_email FROM investment_status_history h LEFT JOIN users a ON a.id=h.actor_id WHERE h.investment_id=? ORDER BY h.id', [i.id]),
      db.get('SELECT * FROM plans WHERE id=?', [i.plan_id]),
      db.all('SELECT * FROM redemptions WHERE investment_id=? ORDER BY id DESC', [i.id]),
      db.all('SELECT * FROM documents WHERE investment_id=? ORDER BY id DESC', [i.id]),
    ]);
    return {
      investment: serializeInvestment(i), investor: A.publicUser(u), payments: payments.map(serializePayment), plan: serializePlan(plan),
      history: history.map((h) => ({ ...h, to_label: E.LABELS[h.to_status] })), redemptions: reds, documents: docs,
      allowed: E.TRANSITIONS[i.status].map((s) => ({ value: s, label: E.LABELS[s] })),
    };
  });

  r.post('/api/admin/investments/:id/status', async (ctx) => {
    A.requireAdmin(ctx, 'investments');
    const b = check(ctx.body, { status: { type: 'enum', required: true, values: E.STATUSES }, reason: { required: true, max: 500 } });
    const inv = await db.get('SELECT * FROM investments WHERE id=?', [Number(ctx.params.id) || 0]);
    if (!inv) throw NotFound('Investment');
    const next = await db.tx((h) => E.transition(h, inv, b.status, { actor: ctx.user, reason: b.reason }));
    await S.audit(ctx, 'investment.status', 'investment', inv.id, { status: inv.status }, { status: b.status, reason: b.reason });
    await E.announce(next);
    return { ok: true };
  });

  r.post('/api/admin/investments', async (ctx) => {
    A.requireAdmin(ctx, 'investments');
    const b = check(ctx.body, {
      user_id: { type: 'int', required: true, label: 'investor' }, property_id: { type: 'int', required: true, label: 'property' },
      plan_id: { type: 'int', required: true, label: 'plan' }, amount_usd: { type: 'number', required: true, min: 1, label: 'amount' },
      currency: { required: true, max: 10 }, network: { required: true, max: 20 },
      tx_hash: { required: true, max: 130, pattern: /^(0x)?[A-Za-z0-9_-]{20,128}$/, message: 'Enter a valid transaction hash.', label: 'transaction hash' },
      note: { required: true, max: 500, label: 'reason for manual entry' },
    });
    const u = await db.get("SELECT * FROM users WHERE id=? AND role='investor'", [b.user_id]);
    if (!u) throw new HttpError(422, 'Check the highlighted fields.', { user_id: 'Choose an existing investor.' });
    const prop = await db.get('SELECT * FROM properties WHERE id=?', [b.property_id]);
    const plan = await db.get('SELECT * FROM plans WHERE id=?', [b.plan_id]);
    if (!prop || !plan) throw new HttpError(422, 'Choose a valid property and plan.');
    const pay = await S.getSetting('payments');
    const cur = pay.currencies.find((c) => c.code === b.currency);
    const net = cur && cur.networks.find((n) => n.code === b.network);
    if (!cur || !net) throw new HttpError(422, 'Choose a supported cryptocurrency and network.');
    const used = await db.get("SELECT id FROM payments WHERE tx_hash=? AND status IN ('submitted','confirmed')", [b.tx_hash]);
    if (used) throw new HttpError(409, 'This transaction hash is already linked to a payment.');
    const t = now();
    const ids = await db.tx(async (h) => {
      const invId = await insert(h, 'investments', {
        user_id: u.id, property_id: prop.id, plan_id: plan.id, amount_usd: round(b.amount_usd), currency: cur.code, network: net.code,
        crypto_amount: round(b.amount_usd / cur.rate_usd, cur.decimals ?? 6), status: 'payment_awaiting', return_terms: JSON.stringify(E.returnTerms(plan)), created_at: t, updated_at: t,
      });
      await S.assignRef(h, 'investments', 'INV', invId);
      await insert(h, 'investment_status_history', { investment_id: invId, to_status: 'payment_awaiting', reason: `Manual entry: ${b.note}`, actor_id: ctx.user.id, created_at: t });
      const payId = await insert(h, 'payments', {
        kind: 'deposit', user_id: u.id, investment_id: invId, currency: cur.code, network: net.code, amount_crypto: round(b.amount_usd / cur.rate_usd, cur.decimals ?? 6),
        amount_usd: round(b.amount_usd), rate_usd: cur.rate_usd, wallet_address: net.address, tx_hash: b.tx_hash, status: 'submitted', provider: 'manual', note: b.note, created_at: t, updated_at: t,
      });
      await S.assignRef(h, 'payments', 'TX', payId, 900);
      return { invId, payId };
    });
    const payment = await db.get('SELECT * FROM payments WHERE id=?', [ids.payId]);
    await S.audit(ctx, 'investment.manual_create', 'investment', ids.invId, null, { user_id: u.id, amount_usd: b.amount_usd, tx_hash: b.tx_hash, note: b.note });
    await E.confirmPayment(payment, { actor: ctx.user, txHash: b.tx_hash, note: b.note, ctx });
    return { ok: true, id: ids.invId };
  });

  /* ---------------------------------------------------------------- payments */
  r.get('/api/admin/payments', async (ctx) => {
    A.requireAdmin(ctx, 'payments');
    const { page, size, offset } = paginate(ctx.query);
    const where = ['1=1'];
    const p = [];
    if (['awaiting', 'submitted', 'confirmed', 'rejected', 'expired'].includes(ctx.query.status)) { where.push('p.status=?'); p.push(ctx.query.status); }
    if (['deposit', 'redemption'].includes(ctx.query.kind)) { where.push('p.kind=?'); p.push(ctx.query.kind); }
    if (ctx.query.q) { where.push("(LOWER(p.ref) LIKE ? OR LOWER(p.tx_hash) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.first_name || ' ' || u.last_name) LIKE ?)"); const l = likeParam(ctx.query.q); p.push(l, l, l, l); }
    const base = `FROM payments p JOIN users u ON u.id=p.user_id LEFT JOIN investments i ON i.id=p.investment_id WHERE ${where.join(' AND ')}`;
    const total = Number((await db.get(`SELECT COUNT(*) AS n ${base}`, p)).n);
    const rows = await db.all(`SELECT p.*, u.first_name, u.last_name, u.email, i.ref AS investment_ref ${base} ORDER BY CASE WHEN p.status='submitted' THEN 0 ELSE 1 END, p.id DESC LIMIT ${size} OFFSET ${offset}`, p);
    return { items: rows.map(serializePayment), total, page, size };
  });

  r.post('/api/admin/payments/:id/verify', async (ctx) => {
    A.requireAdmin(ctx, 'payments');
    const b = check(ctx.body, {
      decision: { type: 'enum', required: true, values: ['confirm', 'reject'] }, note: { max: 500 },
      tx_hash: { max: 130, pattern: /^(0x)?[A-Za-z0-9_-]{20,128}$/, message: 'Enter a valid transaction hash.', label: 'transaction hash' },
      confirmations: { type: 'int', min: 0, max: 100000 },
    });
    const p = await db.get('SELECT * FROM payments WHERE id=?', [Number(ctx.params.id) || 0]);
    if (!p) throw NotFound('Payment');
    if (p.kind !== 'deposit') throw new HttpError(409, 'Withdrawal payouts are managed from Withdrawals.');
    if (b.decision === 'confirm') await E.confirmPayment(p, { actor: ctx.user, txHash: b.tx_hash, confirmations: b.confirmations, note: b.note, ctx });
    else {
      if (!b.note) throw new HttpError(422, 'Check the highlighted fields.', { note: 'Explain why the payment is rejected.' });
      await E.rejectPayment(p, { actor: ctx.user, note: b.note, ctx });
    }
    return { ok: true };
  });

  /* ------------------------------------------------------------- redemptions */
  r.get('/api/admin/redemptions', async (ctx) => {
    A.requireAdmin(ctx, 'redemptions');
    const where = ['1=1'];
    const p = [];
    if (['requested', 'under_review', 'approved', 'rejected', 'paid'].includes(ctx.query.status)) { where.push('r.status=?'); p.push(ctx.query.status); }
    const items = await db.all(`SELECT r.*, i.ref AS investment_ref, i.amount_usd AS principal, i.expected_return, u.first_name, u.last_name, u.email FROM redemptions r JOIN investments i ON i.id=r.investment_id JOIN users u ON u.id=r.user_id WHERE ${where.join(' AND ')} ORDER BY r.id DESC LIMIT 200`, p);
    return { items };
  });

  r.post('/api/admin/redemptions/:id/decision', async (ctx) => {
    A.requireAdmin(ctx, 'redemptions');
    const b = check(ctx.body, {
      decision: { type: 'enum', required: true, values: ['under_review', 'approved', 'rejected', 'paid'] }, note: { max: 1000 },
      tx_hash: { max: 130, pattern: /^(0x)?[A-Za-z0-9_-]{20,128}$/, message: 'Enter a valid transaction hash.', label: 'transaction hash' },
      amount_crypto: { type: 'number', min: 0 },
    });
    const red = await db.get('SELECT * FROM redemptions WHERE id=?', [Number(ctx.params.id) || 0]);
    if (!red) throw NotFound('Withdrawal');
    const flow = { requested: ['under_review', 'approved', 'rejected'], under_review: ['approved', 'rejected'], approved: ['paid', 'rejected'], rejected: [], paid: [] };
    if (!flow[red.status].includes(b.decision)) throw new HttpError(409, `A ${red.status.replace('_', ' ')} request cannot be marked ${b.decision.replace('_', ' ')}.`);
    if (b.decision === 'rejected' && !b.note) throw new HttpError(422, 'Check the highlighted fields.', { note: 'Explain why the request is rejected.' });
    if (b.decision === 'paid' && (!b.tx_hash || !b.amount_crypto)) throw new HttpError(422, 'Check the highlighted fields.', { tx_hash: b.tx_hash ? undefined : 'Enter the payout transaction hash.', amount_crypto: b.amount_crypto ? undefined : 'Enter the amount sent.' });
    await db.tx(async (h) => {
      await h.run('UPDATE redemptions SET status=?, admin_note=COALESCE(?, admin_note), tx_hash=COALESCE(?, tx_hash), reviewed_by=?, updated_at=? WHERE id=?', [b.decision, b.note || null, b.tx_hash || null, ctx.user.id, now(), red.id]);
      if (b.decision === 'paid') {
        const pay = await S.getSetting('payments');
        const cur = pay.currencies.find((c) => c.code === red.currency) || { rate_usd: 1 };
        const payId = await insert(h, 'payments', {
          kind: 'redemption', user_id: red.user_id, investment_id: red.investment_id, redemption_id: red.id, currency: red.currency, network: red.network,
          amount_crypto: b.amount_crypto, amount_usd: red.amount_usd, rate_usd: cur.rate_usd, wallet_address: red.destination_wallet, tx_hash: b.tx_hash,
          status: 'confirmed', verification: 'verified', provider: 'manual', verified_by: ctx.user.id, verified_at: now(), note: b.note || null, created_at: now(), updated_at: now(),
        });
        await S.assignRef(h, 'payments', 'TX', payId, 900);
        const inv = await h.get('SELECT * FROM investments WHERE id=?', [red.investment_id]);
        if (inv.status === 'matured') await E.transition(h, inv, 'redeemed', { actor: ctx.user, reason: `Withdrawal ${red.ref} paid` });
        else if (['active', 'maturing'].includes(inv.status)) await E.transition(h, inv, 'redeemed', { actor: ctx.user, reason: `Early withdrawal ${red.ref} paid`, force: true });
      }
    });
    await S.audit(ctx, `redemption.${b.decision}`, 'redemption', red.id, { status: red.status }, { status: b.decision, note: b.note, tx_hash: b.tx_hash });
    const msg = {
      under_review: 'Your withdrawal request is under review.', approved: 'Your withdrawal request was approved. We will send the payout shortly.',
      rejected: `Your withdrawal request was not approved. ${b.note || ''}`, paid: `Your withdrawal payout was sent. Transaction hash: ${b.tx_hash}`,
    }[b.decision];
    await S.notify(red.user_id, { type: 'redemption', title: `Withdrawal ${red.ref} update`, body: msg, link: '/app/withdrawals' });
    return { ok: true };
  });

  /* -------------------------------------------------------------- properties */
  const propSpec = (partial) => ({
    name: { required: !partial, max: 120 }, type: { type: 'enum', required: !partial, values: PROPERTY_TYPES },
    city: { required: !partial, max: 80 }, country: { required: !partial, max: 80 }, summary: { max: 300 }, description: { type: 'text', max: 10000 },
    dev_status: { type: 'enum', values: DEV_STATUSES, label: 'development status' }, status: { type: 'enum', values: ['draft', 'published', 'archived'] },
    accepting: { type: 'bool' }, featured: { type: 'bool' }, min_investment: { type: 'number', min: 0, label: 'minimum investment' },
    target_raise: { type: 'number', min: 0, label: 'target raise' }, details: { type: 'object' }, highlights: { type: 'array', max: 20 },
    risks: { type: 'text', max: 5000 }, art_seed: { type: 'int', min: 1, max: 999 },
  });
  function propRow(b) {
    const o = { ...b };
    if ('details' in o) o.details = JSON.stringify(o.details || {});
    if ('highlights' in o) o.highlights = JSON.stringify((o.highlights || []).map((x) => String(x).slice(0, 120)));
    return o;
  }

  r.get('/api/admin/properties', async (ctx) => {
    A.requireAdmin(ctx, 'properties');
    const rows = await db.all('SELECT * FROM properties ORDER BY id DESC');
    const out = [];
    for (const p of rows) out.push(serializeProperty(p, await raisedFor(p.id)));
    return { items: out };
  });
  r.get('/api/admin/properties/:id', async (ctx) => {
    A.requireAdmin(ctx, 'properties');
    const p = await db.get('SELECT * FROM properties WHERE id=?', [Number(ctx.params.id) || 0]);
    if (!p) throw NotFound('Property');
    const docs = await db.all('SELECT d.*, f.mime, f.size FROM property_documents d JOIN files f ON f.id=d.file_id WHERE d.property_id=? ORDER BY d.id', [p.id]);
    const plans = await db.all('SELECT * FROM plans WHERE property_id=? ORDER BY sort', [p.id]);
    return { property: serializeProperty(p, await raisedFor(p.id)), documents: docs.map((d) => ({ ...d, url: `/api/files/${d.file_id}` })), plans: plans.map(serializePlan) };
  });
  r.post('/api/admin/properties', async (ctx) => {
    A.requireAdmin(ctx, 'properties');
    const b = check(ctx.body, propSpec(false));
    let slug = slugify(b.name);
    if (await db.get('SELECT id FROM properties WHERE slug=?', [slug])) slug = `${slug}-${Date.now().toString(36)}`;
    const id = await insert(db, 'properties', { ...propRow(b), slug, dev_status: b.dev_status || 'planning', status: b.status || 'published', art_seed: b.art_seed || (Math.floor(Math.random() * 900) + 1), created_at: now(), updated_at: now() });
    await S.audit(ctx, 'property.create', 'property', id, null, b);
    return { ok: true, id };
  });
  r.put('/api/admin/properties/:id', async (ctx) => {
    A.requireAdmin(ctx, 'properties');
    const p = await db.get('SELECT * FROM properties WHERE id=?', [Number(ctx.params.id) || 0]);
    if (!p) throw NotFound('Property');
    const b = check(ctx.body, propSpec(true));
    await update(db, 'properties', p.id, { ...propRow(b), updated_at: now() });
    await S.audit(ctx, 'property.update', 'property', p.id, serializeProperty(p), b);
    return { ok: true };
  });
  r.post('/api/admin/properties/:id/images', async (ctx) => {
    A.requireAdmin(ctx, 'properties');
    const p = await db.get('SELECT * FROM properties WHERE id=?', [Number(ctx.params.id) || 0]);
    if (!p) throw NotFound('Property');
    const imgs = parseJSON(p.images, []);
    if (imgs.length >= 12) throw new HttpError(422, 'A property can have up to 12 images.');
    const f = await S.saveUpload(ctx.body && ctx.body.file, ctx.user.id, 'property_image', 'public', ['image/jpeg', 'image/png', 'image/webp']);
    imgs.push(f.id);
    await db.run('UPDATE properties SET images=?, updated_at=? WHERE id=?', [JSON.stringify(imgs), now(), p.id]);
    await S.audit(ctx, 'property.image_add', 'property', p.id, null, { file_id: f.id });
    return { ok: true, file: f };
  });
  r.post('/api/admin/properties/:id/images/remove', async (ctx) => {
    A.requireAdmin(ctx, 'properties');
    const p = await db.get('SELECT * FROM properties WHERE id=?', [Number(ctx.params.id) || 0]);
    if (!p) throw NotFound('Property');
    const fid = Number(ctx.body && ctx.body.file_id);
    const imgs = parseJSON(p.images, []).filter((x) => x !== fid);
    await db.run('UPDATE properties SET images=?, updated_at=? WHERE id=?', [JSON.stringify(imgs), now(), p.id]);
    await S.audit(ctx, 'property.image_remove', 'property', p.id, { file_id: fid }, null);
    return { ok: true };
  });
  r.post('/api/admin/properties/:id/documents', async (ctx) => {
    A.requireAdmin(ctx, 'properties');
    const p = await db.get('SELECT * FROM properties WHERE id=?', [Number(ctx.params.id) || 0]);
    if (!p) throw NotFound('Property');
    const b = check(ctx.body, { title: { required: true, max: 160 }, is_public: { type: 'bool' }, file: { type: 'object', required: true } });
    const f = await S.saveUpload(b.file, ctx.user.id, 'property_document', b.is_public ? 'public' : 'private');
    const id = await insert(db, 'property_documents', { property_id: p.id, title: b.title, file_id: f.id, is_public: b.is_public ? 1 : 0, created_at: now() });
    await S.audit(ctx, 'property.document_add', 'property', p.id, null, { title: b.title, file_id: f.id });
    return { ok: true, id };
  });
  r.post('/api/admin/property-documents/:id/remove', async (ctx) => {
    A.requireAdmin(ctx, 'properties');
    const d = await db.get('SELECT * FROM property_documents WHERE id=?', [Number(ctx.params.id) || 0]);
    if (!d) throw NotFound('Document');
    await db.run('DELETE FROM property_documents WHERE id=?', [d.id]);
    await S.audit(ctx, 'property.document_remove', 'property', d.property_id, d, null);
    return { ok: true };
  });

  /* ------------------------------------------------------------------- plans */
  const planSpec = (partial) => ({
    name: { required: !partial, max: 100 }, description: { max: 300 }, duration_months: { type: 'int', min: 1, max: 240, label: 'duration (months)' },
    duration_days: { type: 'int', min: 1, max: 7300, label: 'duration (days)' },
    min_amount: { type: 'number', required: !partial, min: 1, label: 'minimum amount' }, max_amount: { type: 'number', min: 1, label: 'maximum amount' },
    return_type: { type: 'enum', values: ['pending', 'fixed_total', 'fixed_annual', 'fixed_weekly'], label: 'return type' }, return_rate: { type: 'number', min: 0, max: 1000, label: 'return rate' },
    return_note: { max: 500, label: 'return note' }, return_approved: { type: 'bool' }, terms: { type: 'text', max: 10000 }, risk_info: { type: 'text', max: 5000 },
    required_docs: { max: 500, label: 'required documents' }, property_id: { type: 'int', label: 'property' }, available_from: { type: 'date' }, available_to: { type: 'date' },
    status: { type: 'enum', values: ['active', 'inactive'] }, sort: { type: 'int', min: 0, max: 1000 },
  });
  function planChecks(b, existing = {}) {
    const m = { ...existing, ...b };
    const errors = {};
    if (!m.duration_months && !m.duration_days) errors.duration_months = 'Set a duration in months or days.';
    if (m.max_amount != null && m.min_amount != null && Number(m.max_amount) < Number(m.min_amount)) errors.max_amount = 'Maximum must be greater than the minimum.';
    if (m.return_approved && (!m.return_type || m.return_type === 'pending' || m.return_rate == null)) errors.return_rate = 'Set a return type and rate before marking it approved.';
    if (Object.keys(errors).length) throw new HttpError(422, 'Check the highlighted fields.', errors);
  }
  r.get('/api/admin/plans', async (ctx) => {
    A.requireAdmin(ctx, 'plans');
    const rows = await db.all('SELECT pl.*, p.name AS property_name, (SELECT COUNT(*) FROM investments i WHERE i.plan_id=pl.id) AS investment_count FROM plans pl LEFT JOIN properties p ON p.id=pl.property_id ORDER BY pl.sort, pl.id');
    return { items: rows.map((x) => ({ ...serializePlan(x), investment_count: Number(x.investment_count) })) };
  });
  r.post('/api/admin/plans', async (ctx) => {
    A.requireAdmin(ctx, 'plans');
    const b = check(ctx.body, planSpec(false));
    planChecks(b);
    const id = await insert(db, 'plans', { ...b, return_type: b.return_type || 'pending', status: b.status || 'active', sort: b.sort || 0, created_at: now(), updated_at: now() });
    await S.audit(ctx, 'plan.create', 'plan', id, null, b);
    return { ok: true, id };
  });
  r.put('/api/admin/plans/:id', async (ctx) => {
    A.requireAdmin(ctx, 'plans');
    const pl = await db.get('SELECT * FROM plans WHERE id=?', [Number(ctx.params.id) || 0]);
    if (!pl) throw NotFound('Plan');
    const b = check(ctx.body, planSpec(true));
    planChecks(b, pl);
    await update(db, 'plans', pl.id, { ...b, updated_at: now() });
    await S.audit(ctx, 'plan.update', 'plan', pl.id, pl, b);
    return { ok: true };
  });
  r.delete('/api/admin/plans/:id', async (ctx) => {
    A.requireAdmin(ctx, 'plans');
    const pl = await db.get('SELECT * FROM plans WHERE id=?', [Number(ctx.params.id) || 0]);
    if (!pl) throw NotFound('Plan');
    const used = await db.get('SELECT COUNT(*) AS n FROM investments WHERE plan_id=?', [pl.id]);
    if (Number(used.n) > 0) throw new HttpError(409, 'This plan has investments and cannot be deleted. Set its status to inactive instead.');
    await db.run('DELETE FROM plans WHERE id=?', [pl.id]);
    await S.audit(ctx, 'plan.delete', 'plan', pl.id, { name: pl.name }, null);
    return { ok: true };
  });

  /* ----------------------------------------------------------------- support */
  r.get('/api/admin/tickets', async (ctx) => {
    A.requireAdmin(ctx, 'support');
    const where = ['1=1'];
    const p = [];
    if (['open', 'pending', 'resolved', 'closed'].includes(ctx.query.status)) { where.push('t.status=?'); p.push(ctx.query.status); }
    const items = await db.all(`SELECT t.*, pr.name AS property_name FROM tickets t LEFT JOIN properties pr ON pr.id=t.property_id WHERE ${where.join(' AND ')} ORDER BY t.updated_at DESC LIMIT 300`, p);
    return { items };
  });
  r.get('/api/admin/tickets/:id', async (ctx) => {
    A.requireAdmin(ctx, 'support');
    const t = await db.get('SELECT t.*, pr.name AS property_name FROM tickets t LEFT JOIN properties pr ON pr.id=t.property_id WHERE t.id=?', [Number(ctx.params.id) || 0]);
    if (!t) throw NotFound('Ticket');
    const messages = await db.all('SELECT m.*, u.first_name, u.last_name FROM ticket_messages m LEFT JOIN users u ON u.id=m.author_id WHERE m.ticket_id=? ORDER BY m.id', [t.id]);
    return { ticket: t, messages };
  });
  r.post('/api/admin/tickets/:id/messages', async (ctx) => {
    A.requireAdmin(ctx, 'support');
    const t = await db.get('SELECT * FROM tickets WHERE id=?', [Number(ctx.params.id) || 0]);
    if (!t) throw NotFound('Ticket');
    const b = check(ctx.body, { message: { type: 'text', required: true, min: 2, max: 5000 } });
    await insert(db, 'ticket_messages', { ticket_id: t.id, author_id: ctx.user.id, author_type: 'admin', body: b.message, created_at: now() });
    await db.run("UPDATE tickets SET status='pending', updated_at=? WHERE id=?", [now(), t.id]);
    if (t.user_id) await S.notify(t.user_id, { type: 'support', title: `Reply to ${t.ref}`, body: b.message.slice(0, 300), link: `/app/support/${t.id}` });
    else await S.sendMail(t.email, `Re: ${t.subject} (${t.ref})`, `Hi ${t.name},\n\n${b.message}\n\nManulife Financial Investment Support`);
    await S.audit(ctx, 'ticket.reply', 'ticket', t.id);
    return { ok: true };
  });
  r.post('/api/admin/tickets/:id/status', async (ctx) => {
    A.requireAdmin(ctx, 'support');
    const b = check(ctx.body, { status: { type: 'enum', required: true, values: ['open', 'pending', 'resolved', 'closed'] } });
    const t = await db.get('SELECT * FROM tickets WHERE id=?', [Number(ctx.params.id) || 0]);
    if (!t) throw NotFound('Ticket');
    await db.run('UPDATE tickets SET status=?, updated_at=? WHERE id=?', [b.status, now(), t.id]);
    await S.audit(ctx, 'ticket.status', 'ticket', t.id, { status: t.status }, { status: b.status });
    return { ok: true };
  });

  /* --------------------------------------------------------------------- CMS */
  const CMS_KEYS = ['site', 'home', 'about', 'how_it_works', 'faqs', 'testimonials', 'legal', 'disclosures'];
  r.get('/api/admin/cms', async (ctx) => {
    A.requireAdmin(ctx, 'content');
    const out = {};
    for (const k of CMS_KEYS) out[k] = await S.getCms(k, null);
    return { content: out };
  });
  r.put('/api/admin/cms/:key', async (ctx) => {
    A.requireAdmin(ctx, 'content');
    if (!CMS_KEYS.includes(ctx.params.key)) throw NotFound('Content section');
    const value = ctx.body && ctx.body.value;
    if (value == null || typeof value !== 'object') throw new HttpError(422, 'Content must be an object or list.');
    if (JSON.stringify(value).length > 200000) throw new HttpError(413, 'This content is too large.');
    const before = await S.getCms(ctx.params.key, null);
    await S.setCms(ctx.params.key, value, ctx.user.id);
    await S.audit(ctx, 'cms.update', 'cms', ctx.params.key, before, value);
    return { ok: true };
  });
  r.post('/api/admin/uploads', async (ctx) => {
    A.requireAdmin(ctx, 'content');
    const f = await S.saveUpload(ctx.body && ctx.body.file, ctx.user.id, 'cms_image', 'public', ['image/jpeg', 'image/png', 'image/webp']);
    await S.audit(ctx, 'cms.upload', 'file', f.id);
    return { ok: true, file: f };
  });

  r.get('/api/admin/posts', async (ctx) => { A.requireAdmin(ctx, 'content'); return { items: await db.all('SELECT * FROM posts ORDER BY id DESC') }; });
  r.post('/api/admin/posts', async (ctx) => {
    A.requireAdmin(ctx, 'content');
    const b = check(ctx.body, { title: { required: true, max: 160 }, excerpt: { max: 300 }, body: { type: 'text', required: true, max: 50000 }, status: { type: 'enum', values: ['draft', 'published'] } });
    let slug = slugify(b.title);
    if (await db.get('SELECT id FROM posts WHERE slug=?', [slug])) slug = `${slug}-${Date.now().toString(36)}`;
    const id = await insert(db, 'posts', { ...b, slug, status: b.status || 'draft', published_at: b.status === 'published' ? now() : null, created_at: now(), updated_at: now() });
    await S.audit(ctx, 'post.create', 'post', id, null, { title: b.title });
    return { ok: true, id };
  });
  r.put('/api/admin/posts/:id', async (ctx) => {
    A.requireAdmin(ctx, 'content');
    const p = await db.get('SELECT * FROM posts WHERE id=?', [Number(ctx.params.id) || 0]);
    if (!p) throw NotFound('Article');
    const b = check(ctx.body, { title: { max: 160 }, excerpt: { max: 300 }, body: { type: 'text', max: 50000 }, status: { type: 'enum', values: ['draft', 'published'] } });
    const patch = { ...b, updated_at: now() };
    if (b.status === 'published' && !p.published_at) patch.published_at = now();
    await update(db, 'posts', p.id, patch);
    await S.audit(ctx, 'post.update', 'post', p.id, { title: p.title, status: p.status }, b);
    return { ok: true };
  });
  r.delete('/api/admin/posts/:id', async (ctx) => {
    A.requireAdmin(ctx, 'content');
    const p = await db.get('SELECT * FROM posts WHERE id=?', [Number(ctx.params.id) || 0]);
    if (!p) throw NotFound('Article');
    await db.run('DELETE FROM posts WHERE id=?', [p.id]);
    await S.audit(ctx, 'post.delete', 'post', p.id, { title: p.title }, null);
    return { ok: true };
  });

  /* --------------------------------------------------------------- documents */
  r.get('/api/admin/documents', async (ctx) => {
    A.requireAdmin(ctx, 'documents');
    const items = await db.all('SELECT d.*, u.first_name, u.last_name, u.email, i.ref AS investment_ref FROM documents d LEFT JOIN users u ON u.id=d.user_id LEFT JOIN investments i ON i.id=d.investment_id ORDER BY d.id DESC LIMIT 300');
    return { items: items.map((d) => ({ ...d, url: d.file_id ? `/api/files/${d.file_id}` : null })) };
  });
  r.post('/api/admin/documents', async (ctx) => {
    A.requireAdmin(ctx, 'documents');
    const b = check(ctx.body, {
      user_id: { type: 'int', label: 'investor' }, investment_id: { type: 'int', label: 'investment' }, title: { required: true, max: 160 },
      category: { type: 'enum', required: true, values: ['agreement', 'terms', 'risk', 'property', 'receipt', 'certificate', 'redemption', 'statement', 'other'] },
      file: { type: 'object', required: true },
    });
    if (b.investment_id) {
      const inv = await db.get('SELECT user_id FROM investments WHERE id=?', [b.investment_id]);
      if (!inv) throw new HttpError(422, 'Check the highlighted fields.', { investment_id: 'That investment does not exist.' });
      b.user_id = inv.user_id;
    }
    if (b.user_id && !(await db.get("SELECT id FROM users WHERE id=? AND role='investor'", [b.user_id]))) throw new HttpError(422, 'Check the highlighted fields.', { user_id: 'That investor does not exist.' });
    const f = await S.saveUpload(b.file, b.user_id || ctx.user.id, 'investor_document', 'private', undefined, ctx.user.id);
    const id = await insert(db, 'documents', { user_id: b.user_id || null, investment_id: b.investment_id || null, category: b.category, title: b.title, file_id: f.id, created_by: ctx.user.id, created_at: now() });
    await S.audit(ctx, 'document.issue', 'document', id, null, { title: b.title, user_id: b.user_id || 'all investors' });
    if (b.user_id) await S.notify(b.user_id, { type: 'document', title: 'New document available', body: `${b.title} has been added to your documents.`, link: '/app/documents' });
    return { ok: true, id };
  });

  /* ----------------------------------------------------------------- reports */
  r.get('/api/admin/reports/:type', async (ctx) => {
    A.requireAdmin(ctx, 'reports');
    const from = ctx.query.from ? new Date(ctx.query.from) : new Date('2000-01-01');
    const to = ctx.query.to ? new Date(new Date(ctx.query.to).getTime() + 86400000) : new Date('2999-01-01');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new HttpError(422, 'Enter valid dates.');
    const range = [from.toISOString(), to.toISOString()];
    const defs = {
      investors: {
        sql: `SELECT u.*, (SELECT COALESCE(SUM(amount_usd),0) FROM investments i WHERE i.user_id=u.id AND i.status IN (${inList(FUNDED)})) AS invested FROM users u WHERE u.role='investor' AND u.status<>'deleted' AND u.created_at>=? AND u.created_at<? ORDER BY u.id`,
        cols: [{ label: 'ID', key: 'id' }, { label: 'First name', key: 'first_name' }, { label: 'Last name', key: 'last_name' }, { label: 'Email', key: 'email' }, { label: 'Phone', key: 'phone' }, { label: 'Country', key: 'country' }, { label: 'Status', key: 'status' }, { label: 'KYC', key: 'kyc_status' }, { label: 'Email verified', get: (r2) => (r2.email_verified_at ? 'yes' : 'no') }, { label: 'Invested (USD)', key: 'invested' }, { label: 'Registered', key: 'created_at' }],
      },
      investments: {
        sql: 'SELECT i.*, u.email, u.first_name, u.last_name, p.name AS property_name, pl.name AS plan_name FROM investments i JOIN users u ON u.id=i.user_id JOIN properties p ON p.id=i.property_id JOIN plans pl ON pl.id=i.plan_id WHERE i.created_at>=? AND i.created_at<? ORDER BY i.id',
        cols: [{ label: 'Investment ID', key: 'ref' }, { label: 'Investor', get: (x) => `${x.first_name} ${x.last_name}` }, { label: 'Email', key: 'email' }, { label: 'Property', key: 'property_name' }, { label: 'Plan', key: 'plan_name' }, { label: 'Amount (USD)', key: 'amount_usd' }, { label: 'Currency', key: 'currency' }, { label: 'Crypto amount', key: 'crypto_amount' }, { label: 'Status', get: (x) => E.LABELS[x.status] }, { label: 'Start', key: 'start_date' }, { label: 'Maturity', key: 'maturity_date' }, { label: 'Expected return (USD)', key: 'expected_return' }, { label: 'Created', key: 'created_at' }],
      },
      payments: {
        sql: 'SELECT p.*, u.email, i.ref AS investment_ref FROM payments p JOIN users u ON u.id=p.user_id LEFT JOIN investments i ON i.id=p.investment_id WHERE p.created_at>=? AND p.created_at<? ORDER BY p.id',
        cols: [{ label: 'Reference', key: 'ref' }, { label: 'Type', key: 'kind' }, { label: 'Investor email', key: 'email' }, { label: 'Investment', key: 'investment_ref' }, { label: 'Currency', key: 'currency' }, { label: 'Network', key: 'network' }, { label: 'Amount', key: 'amount_crypto' }, { label: 'USD value', key: 'amount_usd' }, { label: 'Wallet', key: 'wallet_address' }, { label: 'Tx hash', key: 'tx_hash' }, { label: 'Confirmations', key: 'confirmations' }, { label: 'Status', key: 'status' }, { label: 'Verification', key: 'verification' }, { label: 'Date', key: 'created_at' }],
      },
      redemptions: {
        sql: 'SELECT r.*, u.email, i.ref AS investment_ref FROM redemptions r JOIN users u ON u.id=r.user_id JOIN investments i ON i.id=r.investment_id WHERE r.created_at>=? AND r.created_at<? ORDER BY r.id',
        cols: [{ label: 'Reference', key: 'ref' }, { label: 'Investor email', key: 'email' }, { label: 'Investment', key: 'investment_ref' }, { label: 'Amount (USD)', key: 'amount_usd' }, { label: 'Currency', key: 'currency' }, { label: 'Network', key: 'network' }, { label: 'Destination wallet', key: 'destination_wallet' }, { label: 'Status', key: 'status' }, { label: 'Payout tx hash', key: 'tx_hash' }, { label: 'Requested', key: 'created_at' }],
      },
    };
    const def = defs[ctx.params.type];
    if (!def) throw NotFound('Report');
    const rows = await db.all(def.sql, range);
    await S.audit(ctx, 'report.export', 'report', ctx.params.type, null, { rows: rows.length, from: ctx.query.from, to: ctx.query.to });
    if (ctx.query.format === 'json') return { rows: rows.length, preview: rows.slice(0, 10).map((x) => Object.fromEntries(def.cols.map((c) => [c.label, typeof c.get === 'function' ? c.get(x) : x[c.key]]))) };
    return new Raw(S.toCSV(rows, def.cols), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="${ctx.params.type === 'redemptions' ? 'withdrawals' : ctx.params.type}-report-${new Date().toISOString().slice(0, 10)}.csv"` });
  });

  /* -------------------------------------------------------------- audit logs */
  r.get('/api/admin/audit-logs', async (ctx) => {
    A.requireAdmin(ctx);
    const { page, size, offset } = paginate(ctx.query, 50);
    const where = ['1=1'];
    const p = [];
    if (ctx.query.q) { where.push('(LOWER(action) LIKE ? OR LOWER(actor_email) LIKE ? OR LOWER(entity) LIKE ?)'); const l = likeParam(ctx.query.q); p.push(l, l, l); }
    const total = Number((await db.get(`SELECT COUNT(*) AS n FROM audit_logs WHERE ${where.join(' AND ')}`, p)).n);
    const items = await db.all(`SELECT * FROM audit_logs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${size} OFFSET ${offset}`, p);
    return { items, total, page, size };
  });

  /* -------------------------------------------------------- super admin only */
  r.get('/api/admin/admins', async (ctx) => {
    A.requireSuper(ctx);
    const rows = await db.all("SELECT * FROM users WHERE role IN ('admin','super_admin') ORDER BY id");
    return { items: rows.map(A.publicUser), permissions: A.ADMIN_PERMISSIONS };
  });
  r.post('/api/admin/admins', async (ctx) => {
    A.requireSuper(ctx);
    const b = check(ctx.body, {
      first_name: { required: true, max: 60, label: 'first name' }, last_name: { required: true, max: 60, label: 'last name' }, email: { type: 'email', required: true },
      password: { required: true, max: 128 }, role: { type: 'enum', required: true, values: ['admin', 'super_admin'] }, permissions: { type: 'array', max: 20 },
    });
    const pw = passwordProblem(b.password);
    if (pw) throw new HttpError(422, 'Check the highlighted fields.', { password: pw });
    if (await db.get('SELECT id FROM users WHERE email=?', [b.email])) throw new HttpError(409, 'An account with this email already exists.', { email: 'This email is already registered.' });
    const perms = (b.permissions || []).filter((x) => A.ADMIN_PERMISSIONS.includes(x));
    const id = await insert(db, 'users', {
      role: b.role, first_name: b.first_name, last_name: b.last_name, email: b.email, password_hash: A.hashPassword(b.password), email_verified_at: now(),
      status: 'active', kyc_status: 'not_started', permissions: b.role === 'admin' ? JSON.stringify(perms) : null, created_at: now(), updated_at: now(),
    });
    await S.audit(ctx, 'admin.create', 'user', id, null, { email: b.email, role: b.role, permissions: perms });
    return { ok: true, id };
  });
  r.put('/api/admin/admins/:id', async (ctx) => {
    A.requireSuper(ctx);
    const u = await db.get("SELECT * FROM users WHERE id=? AND role IN ('admin','super_admin')", [Number(ctx.params.id) || 0]);
    if (!u) throw NotFound('Administrator');
    const b = check(ctx.body, { role: { type: 'enum', values: ['admin', 'super_admin'] }, permissions: { type: 'array', max: 20 }, status: { type: 'enum', values: ['active', 'suspended'] } });
    if (u.id === ctx.user.id && (b.status === 'suspended' || b.role === 'admin')) throw new HttpError(409, 'You cannot suspend or demote your own account.');
    const patch = { updated_at: now() };
    if (b.role) patch.role = b.role;
    if (b.status) patch.status = b.status;
    if (b.permissions) patch.permissions = JSON.stringify(b.permissions.filter((x) => A.ADMIN_PERMISSIONS.includes(x)));
    if ((b.role || u.role) === 'super_admin') patch.permissions = null;
    await update(db, 'users', u.id, patch);
    if (b.status === 'suspended') await db.run('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', [now(), u.id]);
    await S.audit(ctx, 'admin.update', 'user', u.id, { role: u.role, status: u.status, permissions: u.permissions }, patch);
    return { ok: true };
  });

  r.get('/api/admin/settings', async (ctx) => {
    A.requireSuper(ctx);
    return { payments: await S.getSetting('payments'), investing: await S.getSetting('investing') };
  });
  r.put('/api/admin/settings/:key', async (ctx) => {
    A.requireSuper(ctx);
    const key = ctx.params.key;
    if (!['payments', 'investing'].includes(key)) throw NotFound('Settings section');
    const v = ctx.body && ctx.body.value;
    if (!v || typeof v !== 'object') throw new HttpError(422, 'Settings must be an object.');
    let clean;
    if (key === 'investing') {
      clean = check(v, { enabled: { type: 'bool' }, kyc_required: { type: 'bool' }, redemptions_enabled: { type: 'bool' }, early_redemption: { type: 'bool' }, maturing_window_days: { type: 'int', required: true, min: 1, max: 90, label: 'maturing window' } });
    } else {
      clean = check(v, {
        mode: { type: 'enum', required: true, values: ['manual', 'provider'] }, window_minutes: { type: 'int', required: true, min: 10, max: 1440, label: 'payment window' },
        required_confirmations: { type: 'int', required: true, min: 0, max: 100, label: 'required confirmations' }, auto_activate: { type: 'bool' }, demo_addresses: { type: 'bool' },
        currencies: { type: 'array', required: true, max: 20 },
      });
      const errors = {};
      clean.currencies = clean.currencies.map((c, idx) => {
        const cc = { code: String(c.code || '').toUpperCase().slice(0, 10), name: String(c.name || '').slice(0, 40), rate_usd: Number(c.rate_usd), decimals: Math.min(18, Math.max(0, parseInt(c.decimals, 10) || 2)), enabled: !!c.enabled, networks: Array.isArray(c.networks) ? c.networks : [] };
        if (!/^[A-Z0-9]{2,10}$/.test(cc.code)) errors[`currencies.${idx}.code`] = 'Use 2–10 letters or digits.';
        if (!(cc.rate_usd > 0)) errors[`currencies.${idx}.rate_usd`] = `Set a USD rate above 0 for ${cc.code || 'this currency'}.`;
        cc.networks = cc.networks.slice(0, 10).map((n, j) => {
          const nn = { code: String(n.code || '').toUpperCase().slice(0, 20), name: String(n.name || '').slice(0, 60), address: String(n.address || '').trim().slice(0, 120) };
          if (!nn.code) errors[`currencies.${idx}.networks.${j}.code`] = 'Network code is required.';
          if (nn.address && !/^[A-Za-z0-9:_-]{20,120}$/.test(nn.address)) errors[`currencies.${idx}.networks.${j}.address`] = `The ${cc.code} ${nn.code} address does not look valid.`;
          return nn;
        });
        return cc;
      });
      if (Object.keys(errors).length) throw new HttpError(422, Object.values(errors)[0], errors);
      clean.rates_updated_at = now();
    }
    const before = await S.getSetting(key);
    const merged = { ...before, ...clean };
    await S.setSetting(key, merged, ctx.user.id);
    await S.audit(ctx, `settings.${key}`, 'settings', key, before, merged);
    return { ok: true };
  });

  r.get('/api/admin/emails', async (ctx) => {
    A.requireSuper(ctx);
    return { items: await db.all('SELECT * FROM emails ORDER BY id DESC LIMIT 100') };
  });

  // Lookups for admin forms.
  r.get('/api/admin/lookups', async (ctx) => {
    A.requireAdmin(ctx);
    const [investors, properties, plans, pay] = await Promise.all([
      db.all("SELECT id, first_name, last_name, email FROM users WHERE role='investor' AND status<>'deleted' ORDER BY first_name LIMIT 1000"),
      db.all('SELECT id, name FROM properties ORDER BY name'),
      db.all('SELECT id, name, property_id FROM plans ORDER BY sort'),
      S.getSetting('payments'),
    ]);
    return { investors, properties, plans, currencies: pay.currencies.map((c) => ({ code: c.code, name: c.name, networks: c.networks.map((n) => ({ code: n.code, name: n.name })) })) };
  });
}

module.exports = { register, monthKey };
