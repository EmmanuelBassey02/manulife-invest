'use strict';
const config = require('../config');
const { db, insert } = require('../db');
const { now, round, parseJSON, HttpError, NotFound, assert } = require('../lib/util');
const { check } = require('../lib/validate');
const A = require('../lib/auth');
const S = require('../lib/services');
const E = require('../lib/engine');
const { Raw } = require('../lib/http');
const { serializeProperty, serializePlan, planAvailable } = require('./public');
const { walletProblem } = require('../lib/wallets');

const FUNDED = ['payment_confirmed', 'active', 'maturing', 'matured', 'completed', 'redeemed'];
const inList = (arr) => arr.map((s) => `'${s}'`).join(',');

const TX_HASH_RE = /^(0x)?[A-Za-z0-9_-]{20,128}$/;

function serializeInvestment(i) {
  return {
    id: i.id, ref: i.ref, user_id: i.user_id, property_id: i.property_id, plan_id: i.plan_id,
    property_name: i.property_name, property_slug: i.property_slug, property_type: i.property_type, art_seed: i.art_seed,
    plan_name: i.plan_name, amount_usd: Number(i.amount_usd), currency: i.currency, network: i.network,
    crypto_amount: Number(i.crypto_amount), status: i.status, status_label: E.LABELS[i.status],
    start_date: i.start_date, maturity_date: i.maturity_date, return_terms: parseJSON(i.return_terms, null),
    expected_return: i.expected_return != null ? Number(i.expected_return) : null, tx_hash: i.tx_hash || null,
    investor_name: i.first_name ? `${i.first_name} ${i.last_name}` : undefined, investor_email: i.email,
    created_at: i.created_at, updated_at: i.updated_at,
  };
}

const INV_SELECT = `SELECT i.*, p.name AS property_name, p.slug AS property_slug, p.type AS property_type, p.art_seed, pl.name AS plan_name,
  (SELECT tx_hash FROM payments x WHERE x.investment_id=i.id AND x.kind='deposit' AND x.tx_hash IS NOT NULL ORDER BY x.id DESC LIMIT 1) AS tx_hash
  FROM investments i JOIN properties p ON p.id=i.property_id JOIN plans pl ON pl.id=i.plan_id`;

function serializePayment(p) {
  return {
    id: p.id, ref: p.ref, kind: p.kind, investment_id: p.investment_id, investment_ref: p.investment_ref, redemption_id: p.redemption_id,
    currency: p.currency, network: p.network, amount_crypto: Number(p.amount_crypto), amount_usd: Number(p.amount_usd), rate_usd: Number(p.rate_usd),
    wallet_address: p.wallet_address, tx_hash: p.tx_hash, confirmations: p.confirmations, status: p.status, verification: p.verification,
    provider: p.provider, note: p.note, expires_at: p.expires_at, verified_at: p.verified_at, created_at: p.created_at,
    investor_name: p.first_name ? `${p.first_name} ${p.last_name}` : undefined, investor_email: p.email,
  };
}

function printable(title, rows, foot) {
  const esc = (s) => String(s == null ? '—' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:Georgia,serif;background:#f1f7f3;color:#1d3025;margin:0;padding:24px}.doc{max-width:720px;margin:auto;background:#fff;border:1px solid #d6e8dc;padding:48px}
h1{font-weight:400;font-size:28px;margin:0 0 4px}.brand{margin-bottom:32px}.brand img{width:200px;height:auto;display:block}table{width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px}
td{padding:10px 0;border-bottom:1px solid #eee;vertical-align:top}td:first-child{color:#6b7685;width:40%}.foot{margin-top:32px;font:12px/1.6 Arial,sans-serif;color:#6b7685}
@media print{body{background:#fff;padding:0}.doc{border:0}button{display:none}}button{margin:24px auto 0;display:block;padding:10px 20px;background:#16834a;color:#fff;border:0;border-radius:6px;font-weight:600;cursor:pointer}</style></head>
<body><div class="doc"><div class="brand"><img src="/assets/img/logo.png" alt="Manulife Financial Investment"></div><h1>${esc(title)}</h1><p style="color:#6b7685;font-family:Arial,sans-serif;font-size:13px">Issued ${esc(E.fmtDate(now()))}</p>
<table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table><p class="foot">${esc(foot)}</p></div><button type="button" data-print>Print or save as PDF</button><script src="/assets/js/print.js"></script></body></html>`;
}

const KYC_MAX_FILES = 5;

function register(r) {
  /* ------------------------------------------------------------- dashboard */
  r.get('/api/me/dashboard', async (ctx) => {
    A.requireInvestor(ctx);
    const uid = ctx.user.id;
    const invs = (await db.all(`${INV_SELECT} WHERE i.user_id=? ORDER BY i.created_at DESC`, [uid])).map(serializeInvestment);
    const funded = invs.filter((i) => FUNDED.includes(i.status));
    const pending = await db.get("SELECT COUNT(*) AS n FROM payments WHERE user_id=? AND kind='deposit' AND status IN ('awaiting','submitted')", [uid]);
    const nextMat = funded.filter((i) => ['active', 'maturing'].includes(i.status) && i.maturity_date).sort((a, b) => a.maturity_date.localeCompare(b.maturity_date))[0];
    // Portfolio value series: cumulative principal funded per month, last 8 months.
    const months = [];
    const d = new Date();
    for (let k = 7; k >= 0; k--) {
      const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k + 1, 1));
      months.push(m.toISOString());
    }
    const series = months.map((end, idx) => {
      const label = new Date(new Date(end).getTime() - 86400000).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
      const v = funded.filter((i) => (i.start_date || i.created_at) < end && !(['completed', 'redeemed'].includes(i.status) && i.updated_at < end)).reduce((s, i) => s + i.amount_usd, 0);
      return { label, value: v, idx };
    });
    const allocation = {};
    for (const i of funded.filter((x) => !['completed', 'redeemed'].includes(x.status))) allocation[i.property_type] = (allocation[i.property_type] || 0) + i.amount_usd;
    const notifications = await db.all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 5', [uid]);
    const prevMonthEnd = months[months.length - 2];
    const prev = series[series.length - 2] ? series[series.length - 2].value : 0;
    const totalActive = funded.filter((i) => !['completed', 'redeemed'].includes(i.status)).reduce((s, i) => s + i.amount_usd, 0);
    return {
      stats: {
        total_invested: funded.reduce((s, i) => s + i.amount_usd, 0),
        current_principal: totalActive,
        change_pct: prev ? round(((totalActive - prev) / prev) * 100, 1) : null,
        active: funded.filter((i) => ['active', 'maturing', 'payment_confirmed'].includes(i.status)).length,
        completed: funded.filter((i) => ['matured', 'completed', 'redeemed'].includes(i.status)).length,
        pending_payments: Number(pending.n),
        next_maturity: nextMat ? { date: nextMat.maturity_date, ref: nextMat.ref, id: nextMat.id } : null,
      },
      series, allocation, prev_month_end: prevMonthEnd,
      investments: invs.slice(0, 6), notifications,
    };
  });

  /* ----------------------------------------------------------- investments */
  r.get('/api/me/investments', async (ctx) => {
    A.requireInvestor(ctx);
    const rows = await db.all(`${INV_SELECT} WHERE i.user_id=? ORDER BY i.created_at DESC`, [ctx.user.id]);
    return { items: rows.map(serializeInvestment) };
  });

  r.get('/api/me/investments/:id', async (ctx) => {
    A.requireInvestor(ctx);
    const i = await db.get(`${INV_SELECT} WHERE i.id=? AND i.user_id=?`, [Number(ctx.params.id) || 0, ctx.user.id]);
    if (!i) throw NotFound('Investment');
    const [payments, history, docs, redemptions, plan] = await Promise.all([
      db.all('SELECT * FROM payments WHERE investment_id=? ORDER BY id DESC', [i.id]),
      db.all('SELECT from_status, to_status, reason, created_at FROM investment_status_history WHERE investment_id=? ORDER BY id', [i.id]),
      db.all('SELECT id, category, title, file_id, created_at FROM documents WHERE investment_id=? ORDER BY id DESC', [i.id]),
      db.all('SELECT * FROM redemptions WHERE investment_id=? ORDER BY id DESC', [i.id]),
      db.get('SELECT * FROM plans WHERE id=?', [i.plan_id]),
    ]);
    return {
      investment: serializeInvestment(i), plan: serializePlan(plan), payments: payments.map(serializePayment),
      history: history.map((h) => ({ ...h, to_label: E.LABELS[h.to_status] })), documents: docs, redemptions,
    };
  });

  r.post('/api/me/investments', async (ctx) => {
    A.requireInvestor(ctx);
    ctx.rateLimit('invest', 20, 3600);
    const investing = await S.getSetting('investing');
    if (!investing.enabled) throw new HttpError(403, 'New investments are paused at the moment. Check back soon.');
    if (investing.kyc_required && ctx.user.kyc_status !== 'approved') throw new HttpError(403, 'Complete identity verification before investing.');
    const b = check(ctx.body, {
      property_id: { type: 'int', required: true, label: 'property' }, plan_id: { type: 'int', required: true, label: 'plan' },
      amount_usd: { type: 'number', required: true, min: 1, label: 'amount' },
      currency: { required: true, max: 10 }, network: { required: true, max: 20 }, accept_terms: { type: 'bool' },
    });
    if (!b.accept_terms) throw new HttpError(422, 'Check the highlighted fields.', { accept_terms: 'Confirm you accept the investment terms and risk disclosure.' });
    const property = await db.get("SELECT * FROM properties WHERE id=? AND status='published'", [b.property_id]);
    if (!property || !property.accepting) throw new HttpError(422, 'This property is not accepting investments.');
    const plan = await db.get('SELECT * FROM plans WHERE id=?', [b.plan_id]);
    if (!plan || !planAvailable(plan) || (plan.property_id && plan.property_id !== property.id)) throw new HttpError(422, 'This plan is not available for the selected property.');
    const min = Math.max(Number(plan.min_amount), Number(property.min_investment));
    if (b.amount_usd < min) throw new HttpError(422, 'Check the highlighted fields.', { amount_usd: `The minimum for this plan is $${min.toLocaleString('en-US')}.` });
    if (plan.max_amount != null && b.amount_usd > Number(plan.max_amount)) throw new HttpError(422, 'Check the highlighted fields.', { amount_usd: `The maximum for this plan is $${Number(plan.max_amount).toLocaleString('en-US')}.` });
    const pay = await S.getSetting('payments');
    const cur = pay.currencies.find((c) => c.enabled && c.code === b.currency);
    const net = cur && cur.networks.find((n) => n.code === b.network);
    if (!cur || !net) throw new HttpError(422, 'Choose a supported cryptocurrency and network.');
    if (!net.address) throw new HttpError(503, 'Payments for this network are not configured yet. Choose another option.');
    const open = await db.get("SELECT COUNT(*) AS n FROM investments WHERE user_id=? AND status='payment_awaiting'", [ctx.user.id]);
    if (Number(open.n) >= 3) throw new HttpError(429, 'You have 3 investments awaiting payment. Complete or cancel one before starting another.');

    const cryptoAmount = round(b.amount_usd / Number(cur.rate_usd), cur.decimals ?? 6);
    const terms = E.returnTerms(plan);
    const t = now();
    const result = await db.tx(async (h) => {
      const invId = await insert(h, 'investments', {
        user_id: ctx.user.id, property_id: property.id, plan_id: plan.id, amount_usd: round(b.amount_usd), currency: cur.code, network: net.code,
        crypto_amount: cryptoAmount, status: 'pending', return_terms: JSON.stringify(terms), created_at: t, updated_at: t,
      });
      const ref = await S.assignRef(h, 'investments', 'INV', invId);
      await insert(h, 'investment_status_history', { investment_id: invId, from_status: null, to_status: 'pending', reason: 'Investment created', actor_id: ctx.user.id, created_at: t });
      let inv = await h.get('SELECT * FROM investments WHERE id=?', [invId]);
      inv = await E.transition(h, inv, 'payment_awaiting', { actor: ctx.user, reason: 'Payment instructions issued' });
      const payId = await insert(h, 'payments', {
        kind: 'deposit', user_id: ctx.user.id, investment_id: invId, currency: cur.code, network: net.code, amount_crypto: cryptoAmount,
        amount_usd: round(b.amount_usd), rate_usd: Number(cur.rate_usd), wallet_address: net.address, status: 'awaiting', verification: 'unverified',
        provider: pay.mode, expires_at: new Date(Date.now() + pay.window_minutes * 60000).toISOString(), created_at: t, updated_at: t,
      });
      await S.assignRef(h, 'payments', 'TX', payId, 900);
      return { invId, payId, ref };
    });
    await S.audit(ctx, 'investment.create', 'investment', result.invId, null, { ref: result.ref, amount_usd: b.amount_usd, currency: cur.code, network: net.code });
    await S.notify(ctx.user.id, {
      type: 'payment', title: 'Payment instructions for your investment',
      body: `Send exactly ${cryptoAmount} ${cur.code} on ${net.name} to complete investment ${result.ref}. The payment window is ${pay.window_minutes} minutes.`,
      link: `/app/investments/${result.invId}`,
    });
    const payment = await db.get('SELECT * FROM payments WHERE id=?', [result.payId]);
    return { investment_id: result.invId, ref: result.ref, payment: serializePayment(payment), network_name: net.name, demo_addresses: !!pay.demo_addresses };
  });

  r.post('/api/me/investments/:id/cancel', async (ctx) => {
    A.requireInvestor(ctx);
    const inv = await db.get('SELECT * FROM investments WHERE id=? AND user_id=?', [Number(ctx.params.id) || 0, ctx.user.id]);
    if (!inv) throw NotFound('Investment');
    const submitted = await db.get("SELECT id FROM payments WHERE investment_id=? AND status='submitted'", [inv.id]);
    if (inv.status !== 'payment_awaiting' || submitted) throw new HttpError(409, 'Only investments awaiting payment, with no payment submitted, can be cancelled.');
    await db.tx(async (h) => {
      await E.transition(h, inv, 'cancelled', { actor: ctx.user, reason: 'Cancelled by investor' });
      await h.run("UPDATE payments SET status='expired', note=?, updated_at=? WHERE investment_id=? AND status='awaiting'", ['Cancelled by investor', now(), inv.id]);
    });
    await S.audit(ctx, 'investment.cancel', 'investment', inv.id, { status: inv.status }, { status: 'cancelled' });
    return { ok: true };
  });

  r.post('/api/me/payments/:id/submit', async (ctx) => {
    A.requireInvestor(ctx);
    ctx.rateLimit('paysubmit', 20, 3600);
    const b = check(ctx.body, { tx_hash: { required: true, max: 130, pattern: TX_HASH_RE, message: 'Enter the transaction hash (ID) exactly as shown in your wallet.', label: 'transaction hash' } });
    const p = await db.get('SELECT * FROM payments WHERE id=? AND user_id=?', [Number(ctx.params.id) || 0, ctx.user.id]);
    if (!p) throw NotFound('Payment');
    if (p.status !== 'awaiting') throw new HttpError(409, p.status === 'expired' ? 'This payment window has expired. Start a new investment.' : 'This payment has already been submitted.');
    const used = await db.get("SELECT id FROM payments WHERE tx_hash=? AND id<>? AND status IN ('submitted','confirmed')", [b.tx_hash, p.id]);
    if (used) throw new HttpError(409, 'This transaction hash has already been used for another payment.');
    await db.run("UPDATE payments SET tx_hash=?, status='submitted', updated_at=? WHERE id=?", [b.tx_hash, now(), p.id]);
    await S.audit(ctx, 'payment.submit', 'payment', p.id, { status: 'awaiting' }, { status: 'submitted', tx_hash: b.tx_hash });
    await S.notifyAdmins(`Payment ${p.ref} submitted for verification`, `${p.amount_crypto} ${p.currency} on ${p.network}`, '/admin/payments');
    await S.notify(ctx.user.id, { type: 'payment', title: 'Payment submitted', body: `We received your transaction hash for ${p.ref}. We'll confirm once it's verified on the blockchain.`, link: '/app/transactions', email: false });
    return { ok: true };
  });

  /* --------------------------------------------------- transactions & docs */
  r.get('/api/me/transactions', async (ctx) => {
    A.requireInvestor(ctx);
    const rows = await db.all('SELECT p.*, i.ref AS investment_ref FROM payments p LEFT JOIN investments i ON i.id=p.investment_id WHERE p.user_id=? ORDER BY p.id DESC', [ctx.user.id]);
    return { items: rows.map(serializePayment) };
  });

  r.get('/api/me/documents', async (ctx) => {
    A.requireInvestor(ctx);
    const uid = ctx.user.id;
    const stored = await db.all(
      'SELECT d.id, d.category, d.title, d.file_id, d.investment_id, d.created_at, i.ref AS investment_ref FROM documents d LEFT JOIN investments i ON i.id=d.investment_id WHERE d.user_id=? OR d.user_id IS NULL ORDER BY d.id DESC',
      [uid],
    );
    const items = stored.map((d) => ({ ...d, url: d.file_id ? `/api/files/${d.file_id}` : null }));
    const invs = await db.all(`SELECT id, ref, created_at, start_date FROM investments WHERE user_id=? AND status IN (${inList(FUNDED)}) ORDER BY id DESC`, [uid]);
    for (const i of invs) items.push({ id: `cert-${i.id}`, category: 'certificate', title: `Investment certificate ${i.ref}`, investment_ref: i.ref, created_at: i.start_date || i.created_at, url: `/api/me/investments/${i.id}/certificate` });
    const pays = await db.all("SELECT id, ref, verified_at, kind FROM payments WHERE user_id=? AND status='confirmed' ORDER BY id DESC", [uid]);
    for (const p of pays) items.push({ id: `rcpt-${p.id}`, category: p.kind === 'redemption' ? 'redemption' : 'receipt', title: `${p.kind === 'redemption' ? 'Withdrawal confirmation' : 'Payment receipt'} ${p.ref}`, created_at: p.verified_at, url: `/api/me/payments/${p.id}/receipt` });
    items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return { items };
  });

  r.get('/api/me/investments/:id/certificate', async (ctx) => {
    A.requireInvestor(ctx);
    const i = await db.get(`${INV_SELECT} WHERE i.id=? AND i.user_id=?`, [Number(ctx.params.id) || 0, ctx.user.id]);
    if (!i || !FUNDED.includes(i.status)) throw NotFound('Certificate');
    const terms = parseJSON(i.return_terms, {});
    return new Raw(printable(`Investment certificate ${i.ref}`, [
      ['Investor', `${ctx.user.first_name} ${ctx.user.last_name}`], ['Investment ID', i.ref], ['Property', i.property_name], ['Plan', i.plan_name],
      ['Amount', `$${Number(i.amount_usd).toLocaleString('en-US', { minimumFractionDigits: 2 })} (${i.crypto_amount} ${i.currency})`],
      ['Transaction hash', i.tx_hash], ['Start date', E.fmtDate(i.start_date)], ['Maturity date', E.fmtDate(i.maturity_date)],
      ['Return terms', terms.approved ? `${terms.rate}% ${{ fixed_annual: 'per year', fixed_weekly: 'per week' }[terms.type] || 'total'}` : (terms.note || 'Pending legal approval')],
      ['Status', E.LABELS[i.status]],
    ], 'This certificate records your participation as held in Manulife Financial Investment records. It is subject to the Investment Terms, Investor Agreement and Risk Disclosure you accepted.'), 'text/html; charset=utf-8');
  });

  r.get('/api/me/payments/:id/receipt', async (ctx) => {
    A.requireInvestor(ctx);
    const p = await db.get("SELECT p.*, i.ref AS investment_ref FROM payments p LEFT JOIN investments i ON i.id=p.investment_id WHERE p.id=? AND p.user_id=? AND p.status='confirmed'", [Number(ctx.params.id) || 0, ctx.user.id]);
    if (!p) throw NotFound('Receipt');
    return new Raw(printable(`${p.kind === 'redemption' ? 'Withdrawal confirmation' : 'Payment receipt'} ${p.ref}`, [
      ['Investor', `${ctx.user.first_name} ${ctx.user.last_name}`], ['Reference', p.ref], ['Investment', p.investment_ref],
      ['Amount', `${p.amount_crypto} ${p.currency}`], ['USD value at rate', `$${Number(p.amount_usd).toLocaleString('en-US', { minimumFractionDigits: 2 })}`],
      ['Network', p.network], [p.kind === 'redemption' ? 'Destination wallet' : 'Receiving wallet', p.wallet_address], ['Transaction hash', p.tx_hash],
      ['Confirmed', E.fmtDate(p.verified_at)],
    ], 'Blockchain transactions are final. Keep this receipt for your records.'), 'text/html; charset=utf-8');
  });

  /* ------------------------------------------------------------ notifications */
  r.get('/api/me/notifications', async (ctx) => {
    A.requireUser(ctx);
    const items = await db.all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100', [ctx.user.id]);
    const unread = await db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL', [ctx.user.id]);
    return { items, unread: Number(unread.n) };
  });
  r.post('/api/me/notifications/read', async (ctx) => {
    A.requireUser(ctx);
    const id = ctx.body && Number(ctx.body.id);
    if (id) await db.run('UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL', [now(), id, ctx.user.id]);
    else await db.run('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL', [now(), ctx.user.id]);
    return { ok: true };
  });

  /* --------------------------------------------------------------------- KYC */
  async function kycRecord(uid) {
    let k = await db.get('SELECT * FROM kyc_submissions WHERE user_id=?', [uid]);
    if (!k) {
      await insert(db, 'kyc_submissions', { user_id: uid, status: 'not_started', created_at: now(), updated_at: now() });
      k = await db.get('SELECT * FROM kyc_submissions WHERE user_id=?', [uid]);
    }
    return k;
  }
  function kycEditable(k) {
    if (['pending_review', 'approved'].includes(k.status)) throw new HttpError(409, k.status === 'approved' ? 'Your identity is already verified.' : 'Your verification is under review. You can edit it if we request more information.');
  }

  r.get('/api/me/kyc', async (ctx) => {
    A.requireInvestor(ctx);
    const k = await kycRecord(ctx.user.id);
    const docs = await db.all("SELECT d.id, d.kind, d.status, d.created_at, f.original_name, f.mime, f.size, f.id AS file_id FROM kyc_documents d JOIN files f ON f.id=d.file_id WHERE d.user_id=? AND d.status<>'replaced' ORDER BY d.id", [ctx.user.id]);
    return {
      kyc: { status: k.status, personal: parseJSON(k.personal, {}), id_doc_type: k.id_doc_type, source_of_funds: parseJSON(k.source_of_funds, {}), suitability: parseJSON(k.suitability, {}), admin_note: k.admin_note, submitted_at: k.submitted_at, reviewed_at: k.reviewed_at },
      documents: docs.map((d) => ({ ...d, url: `/api/files/${d.file_id}` })),
    };
  });

  r.post('/api/me/kyc/personal', async (ctx) => {
    A.requireInvestor(ctx);
    const k = await kycRecord(ctx.user.id);
    kycEditable(k);
    const b = check(ctx.body, {
      dob: { type: 'date', required: true, label: 'date of birth' }, nationality: { required: true, max: 60 },
      country: { required: true, max: 60, label: 'country of residence' }, address: { required: true, max: 200 },
      city: { required: true, max: 80 }, postal_code: { max: 20, label: 'postal code' }, occupation: { required: true, max: 100 },
    });
    const age = (Date.now() - new Date(b.dob).getTime()) / (365.25 * 86400000);
    if (age < 18 || age > 120) throw new HttpError(422, 'Check the highlighted fields.', { dob: 'You must be at least 18 years old to invest.' });
    await db.run('UPDATE kyc_submissions SET personal=?, updated_at=? WHERE id=?', [JSON.stringify(b), now(), k.id]);
    return { ok: true };
  });

  r.post('/api/me/kyc/document', async (ctx) => {
    A.requireInvestor(ctx);
    ctx.rateLimit('kycupload', 30, 3600);
    const k = await kycRecord(ctx.user.id);
    kycEditable(k);
    const b = check(ctx.body, {
      kind: { type: 'enum', required: true, values: ['identity', 'address', 'selfie'] },
      doc_type: { type: 'enum', values: ['passport', 'national_id', 'drivers_license', 'utility_bill', 'bank_statement', 'tenancy', 'selfie'] },
      file: { type: 'object', required: true },
    });
    const allowed = b.kind === 'selfie' ? ['image/jpeg', 'image/png', 'image/webp'] : ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    const count = await db.get("SELECT COUNT(*) AS n FROM kyc_documents WHERE user_id=? AND kind=? AND status<>'replaced'", [ctx.user.id, b.kind]);
    if (Number(count.n) >= KYC_MAX_FILES) throw new HttpError(422, `You can upload up to ${KYC_MAX_FILES} files here. Remove one to add another.`);
    const f = await S.saveUpload(b.file, ctx.user.id, `kyc_${b.kind}`, 'private', allowed);
    const docId = await insert(db, 'kyc_documents', { user_id: ctx.user.id, kind: b.kind, file_id: f.id, status: 'pending', created_at: now() });
    if (b.kind === 'identity' && b.doc_type) await db.run('UPDATE kyc_submissions SET id_doc_type=?, updated_at=? WHERE id=?', [b.doc_type, now(), k.id]);
    const label = { identity: 'identity document', address: 'proof of address', selfie: 'selfie' }[b.kind];
    try {
      await S.notifyAdmins(`Document uploaded: ${label}`, `${ctx.user.first_name} ${ctx.user.last_name} uploaded ${f.name} (${label}).`, `/admin/kyc/${ctx.user.id}`, { email: true });
    } catch (error) { console.error('[kyc] could not notify admins of an upload:', error.message); }
    return { ok: true, file: f, document: { id: docId, kind: b.kind, status: 'pending', original_name: f.name, size: f.size } };
  });

  r.delete('/api/me/kyc/document/:id', async (ctx) => {
    A.requireInvestor(ctx);
    const k = await kycRecord(ctx.user.id);
    kycEditable(k);
    const doc = await db.get("SELECT id, kind FROM kyc_documents WHERE id=? AND user_id=? AND status<>'replaced'", [Number(ctx.params.id) || 0, ctx.user.id]);
    if (!doc) throw NotFound('Document');
    await db.run("UPDATE kyc_documents SET status='replaced' WHERE id=?", [doc.id]);
    return { ok: true };
  });

  r.post('/api/me/kyc/funds', async (ctx) => {
    A.requireInvestor(ctx);
    const k = await kycRecord(ctx.user.id);
    kycEditable(k);
    const b = check(ctx.body, {
      source: { type: 'enum', required: true, values: ['employment', 'business', 'investments', 'savings', 'inheritance', 'property_sale', 'other'], label: 'source of funds' },
      details: { type: 'text', max: 1000 },
      annual_income: { type: 'enum', required: true, values: ['under_25k', '25k_100k', '100k_250k', '250k_1m', 'over_1m'], label: 'annual income' },
      experience: { type: 'enum', required: true, values: ['none', 'some', 'experienced'], label: 'investment experience' },
      risk_tolerance: { type: 'enum', required: true, values: ['low', 'medium', 'high'], label: 'risk tolerance' },
      pep: { type: 'bool' },
    });

    await db.run('UPDATE kyc_submissions SET source_of_funds=?, suitability=?, updated_at=? WHERE id=?', [
      JSON.stringify({ source: b.source, details: b.details || '' }),
      JSON.stringify({ annual_income: b.annual_income, experience: b.experience, risk_tolerance: b.risk_tolerance, pep: !!b.pep, understands_risk: true }), now(), k.id,
    ]);
    return { ok: true };
  });

  r.post('/api/me/kyc/submit', async (ctx) => {
    A.requireInvestor(ctx);
    const k = await kycRecord(ctx.user.id);
    kycEditable(k);
    const kinds = (await db.all("SELECT DISTINCT kind FROM kyc_documents WHERE user_id=? AND status<>'replaced'", [ctx.user.id])).map((x) => x.kind);
    const missing = [];
    if (!k.personal) missing.push('personal information');
    if (!kinds.includes('identity')) missing.push('identity document');
    if (!kinds.includes('address')) missing.push('proof of address');
    if (!kinds.includes('selfie')) missing.push('selfie');
    if (!k.source_of_funds) missing.push('source of funds');
    if (missing.length) throw new HttpError(422, `Complete these steps first: ${missing.join(', ')}.`);
    await db.run("UPDATE kyc_submissions SET status='pending_review', submitted_at=?, updated_at=? WHERE id=?", [now(), now(), k.id]);
    await db.run("UPDATE users SET kyc_status='pending_review', updated_at=? WHERE id=?", [now(), ctx.user.id]);
    await S.audit(ctx, 'kyc.submit', 'user', ctx.user.id, { status: k.status }, { status: 'pending_review' });
    await S.notify(ctx.user.id, { type: 'kyc', title: 'Verification submitted', body: 'We are reviewing your documents. This usually takes 1–2 business days.', link: '/app/kyc' });
    await S.notifyAdmins('New KYC submission', `${ctx.user.first_name} ${ctx.user.last_name} submitted identity verification.`, `/admin/kyc/${ctx.user.id}`);
    return { ok: true };
  });

  /* -------------------------------------------------- withdrawals (stored as redemptions) */
  const enabledCurrencies = async () => (await S.getSetting('payments')).currencies.filter((c) => c.enabled);
  const findNetwork = (currencies, currency, network) => {
    const cur = currencies.find((c) => c.code === currency);
    return cur && cur.networks.find((n) => n.code === network) ? cur : null;
  };
  async function saveWallet(h, userId, currency, network, address) {
    const t = now();
    const existing = await h.get('SELECT id, address FROM payout_wallets WHERE user_id=? AND currency=? AND network=?', [userId, currency, network]);
    if (existing) {
      if (existing.address !== address) await h.run('UPDATE payout_wallets SET address=?, updated_at=? WHERE id=?', [address, t, existing.id]);
      return { id: existing.id, changed: existing.address !== address, previous: existing.address };
    }
    const id = await insert(h, 'payout_wallets', { user_id: userId, currency, network, address, created_at: t, updated_at: t });
    return { id, changed: true, previous: null };
  }

  r.get('/api/me/redemptions', async (ctx) => {
    A.requireInvestor(ctx);
    const items = await db.all('SELECT r.*, i.ref AS investment_ref FROM redemptions r JOIN investments i ON i.id=r.investment_id WHERE r.user_id=? ORDER BY r.id DESC', [ctx.user.id]);
    return { items };
  });

  r.get('/api/me/wallets', async (ctx) => {
    A.requireInvestor(ctx);
    const items = await db.all('SELECT id, currency, network, address, updated_at FROM payout_wallets WHERE user_id=? ORDER BY currency, network', [ctx.user.id]);
    return { items };
  });

  r.put('/api/me/wallets', async (ctx) => {
    A.requireInvestor(ctx);
    ctx.rateLimit('wallets', 20, 3600);
    const b = check(ctx.body, {
      currency: { required: true, max: 10 }, network: { required: true, max: 20 },
      address: { required: true, max: 120, label: 'wallet address' }, password: { required: true, max: 128 },
    });
    if (!findNetwork(await enabledCurrencies(), b.currency, b.network)) throw new HttpError(422, 'Choose a supported cryptocurrency and network.');
    const problem = walletProblem(b.network, b.address);
    if (problem) throw new HttpError(422, 'Check the highlighted fields.', { address: problem });
    if (!A.verifyPassword(b.password, ctx.user.password_hash)) throw new HttpError(422, 'Check the highlighted fields.', { password: 'Your password is incorrect.' });
    const saved = await saveWallet(db, ctx.user.id, b.currency, b.network, b.address);
    if (saved.changed) {
      await S.audit(ctx, 'wallet.save', 'payout_wallet', saved.id, saved.previous ? { address: saved.previous } : null, { currency: b.currency, network: b.network, address: b.address });
      await S.notify(ctx.user.id, { type: 'security', title: 'Payout wallet saved', body: `Your ${b.currency} (${b.network}) withdrawal wallet was set to ${b.address}. If you didn't do this, contact support immediately.`, link: '/app/withdrawals' });
    }
    return { ok: true, id: saved.id };
  });

  r.delete('/api/me/wallets/:id', async (ctx) => {
    A.requireInvestor(ctx);
    const w = await db.get('SELECT * FROM payout_wallets WHERE id=? AND user_id=?', [Number(ctx.params.id) || 0, ctx.user.id]);
    if (!w) throw NotFound('Wallet');
    await db.run('DELETE FROM payout_wallets WHERE id=?', [w.id]);
    await S.audit(ctx, 'wallet.remove', 'payout_wallet', w.id, { currency: w.currency, network: w.network, address: w.address }, null);
    return { ok: true };
  });

  r.post('/api/me/redemptions', async (ctx) => {
    A.requireInvestor(ctx);
    ctx.rateLimit('redeem', 10, 3600);
    const settings = await S.getSetting('investing');
    if (!settings.redemptions_enabled) throw new HttpError(403, 'Withdrawals are not available at the moment.');
    const b = check(ctx.body, {
      investment_id: { type: 'int', required: true, label: 'investment' }, amount_usd: { type: 'number', required: true, min: 1, label: 'amount' },
      currency: { required: true, max: 10 }, network: { required: true, max: 20 },
      destination_wallet: { required: true, max: 120, label: 'wallet address' },
      save_wallet: { type: 'bool' }, password: { required: true, max: 128 },
    });
    const inv = await db.get('SELECT * FROM investments WHERE id=? AND user_id=?', [b.investment_id, ctx.user.id]);
    if (!inv) throw NotFound('Investment');
    const eligible = inv.status === 'matured' || (settings.early_redemption && ['active', 'maturing'].includes(inv.status));
    if (!eligible) throw new HttpError(409, 'This investment can be withdrawn once it matures.');
    const openR = await db.get("SELECT id FROM redemptions WHERE investment_id=? AND status IN ('requested','under_review','approved')", [inv.id]);
    if (openR) throw new HttpError(409, 'A withdrawal request for this investment is already in progress.');
    const cur = findNetwork(await enabledCurrencies(), b.currency, b.network);
    if (!cur) throw new HttpError(422, 'Choose a supported cryptocurrency and network.');
    const problem = walletProblem(b.network, b.destination_wallet);
    if (problem) throw new HttpError(422, 'Check the highlighted fields.', { destination_wallet: problem });
    const max = round(Number(inv.amount_usd) + Number(inv.expected_return || 0));
    if (b.amount_usd > max) throw new HttpError(422, 'Check the highlighted fields.', { amount_usd: `The most you can withdraw is $${max.toLocaleString('en-US')}.` });
    if (!A.verifyPassword(b.password, ctx.user.password_hash)) throw new HttpError(422, 'Check the highlighted fields.', { password: 'Your password is incorrect.' });
    const t = now();
    const result = await db.tx(async (h) => {
      const id = await insert(h, 'redemptions', {
        user_id: ctx.user.id, investment_id: inv.id, amount_usd: round(b.amount_usd), currency: cur.code, network: b.network,
        destination_wallet: b.destination_wallet, status: 'requested', created_at: t, updated_at: t,
      });
      const ref = await S.assignRef(h, 'redemptions', 'WDR', id, 3000);
      const wallet = b.save_wallet ? await saveWallet(h, ctx.user.id, cur.code, b.network, b.destination_wallet) : null;
      return { id, ref, wallet };
    });
    const { id, ref, wallet } = result;
    await S.audit(ctx, 'redemption.request', 'redemption', id, null, { ref, amount_usd: b.amount_usd, currency: cur.code, network: b.network, wallet: b.destination_wallet });
    if (wallet && wallet.changed) await S.audit(ctx, 'wallet.save', 'payout_wallet', wallet.id, wallet.previous ? { address: wallet.previous } : null, { currency: cur.code, network: b.network, address: b.destination_wallet });
    await S.notify(ctx.user.id, { type: 'redemption', title: 'Withdrawal request received', body: `We received withdrawal request ${ref} for ${inv.ref}. Your payout of up to $${round(b.amount_usd).toLocaleString('en-US')} will be sent in ${cur.code} (${b.network}) to ${b.destination_wallet} once approved.`, link: '/app/withdrawals' });
    await S.notifyAdmins(`Withdrawal request ${ref}`, `$${round(b.amount_usd).toLocaleString('en-US')} for ${inv.ref} in ${cur.code} (${b.network})`, '/admin/withdrawals');
    return { ok: true, ref };
  });

  /* ------------------------------------------------------------------ support */
  r.get('/api/me/tickets', async (ctx) => {
    A.requireUser(ctx);
    const items = await db.all('SELECT * FROM tickets WHERE user_id=? ORDER BY updated_at DESC', [ctx.user.id]);
    return { items };
  });
  r.post('/api/me/tickets', async (ctx) => {
    A.requireUser(ctx);
    ctx.rateLimit('ticket', 10, 3600);
    const b = check(ctx.body, {
      subject: { required: true, max: 160 }, message: { type: 'text', required: true, min: 10, max: 5000 },
      category: { type: 'enum', required: true, values: ['investment', 'payment', 'kyc', 'redemption', 'account', 'general'] },
    });
    const t = now();
    const id = await insert(db, 'tickets', { user_id: ctx.user.id, name: `${ctx.user.first_name} ${ctx.user.last_name}`, email: ctx.user.email, phone: ctx.user.phone, subject: b.subject, category: b.category, status: 'open', created_at: t, updated_at: t });
    const ref = await S.assignRef(db, 'tickets', 'SUP', id, 5000);
    await insert(db, 'ticket_messages', { ticket_id: id, author_id: ctx.user.id, author_type: 'investor', body: b.message, created_at: t });
    await S.notifyAdmins(`New support ticket ${ref}`, b.subject, `/admin/support/${id}`);
    return { ok: true, id, ref };
  });
  r.get('/api/me/tickets/:id', async (ctx) => {
    A.requireUser(ctx);
    const tk = await db.get('SELECT * FROM tickets WHERE id=? AND user_id=?', [Number(ctx.params.id) || 0, ctx.user.id]);
    if (!tk) throw NotFound('Ticket');
    const messages = await db.all('SELECT author_type, body, created_at FROM ticket_messages WHERE ticket_id=? ORDER BY id', [tk.id]);
    return { ticket: tk, messages };
  });
  r.post('/api/me/tickets/:id/messages', async (ctx) => {
    A.requireUser(ctx);
    const tk = await db.get('SELECT * FROM tickets WHERE id=? AND user_id=?', [Number(ctx.params.id) || 0, ctx.user.id]);
    if (!tk) throw NotFound('Ticket');
    assert(tk.status !== 'closed', 409, 'This ticket is closed. Open a new one if you need more help.');
    const b = check(ctx.body, { message: { type: 'text', required: true, min: 2, max: 5000 } });
    await insert(db, 'ticket_messages', { ticket_id: tk.id, author_id: ctx.user.id, author_type: 'investor', body: b.message, created_at: now() });
    await db.run("UPDATE tickets SET status='open', updated_at=? WHERE id=?", [now(), tk.id]);
    return { ok: true };
  });

  /* ------------------------------------------------------------------ profile */
  r.put('/api/me/profile', async (ctx) => {
    A.requireUser(ctx);
    const b = check(ctx.body, {
      first_name: { required: true, max: 60, label: 'first name' }, last_name: { required: true, max: 60, label: 'last name' },
      phone: { required: ctx.user.role === 'investor', max: 30, pattern: /^\+?[\d\s()-]{7,30}$/, message: 'Enter a valid phone number.' }, country: { required: ctx.user.role === 'investor', max: 60 },
    });
    if (ctx.user.kyc_status === 'approved' && (b.first_name !== ctx.user.first_name || b.last_name !== ctx.user.last_name)) {
      throw new HttpError(409, 'Your name is locked after identity verification. Contact support to change it.');
    }
    await db.run('UPDATE users SET first_name=?, last_name=?, phone=?, country=?, updated_at=? WHERE id=?', [b.first_name, b.last_name, b.phone, b.country, now(), ctx.user.id]);
    await S.audit(ctx, 'user.profile_update', 'user', ctx.user.id, { phone: ctx.user.phone, country: ctx.user.country }, { phone: b.phone, country: b.country });
    return { ok: true };
  });

  // Investable catalogue for the in-app flow (properties accepting + all available plans).
  r.get('/api/me/invest-options', async (ctx) => {
    A.requireInvestor(ctx);
    const props = await db.all("SELECT * FROM properties WHERE status='published' AND accepting=1 ORDER BY featured DESC, name");
    // Same query as /api/public/plans so the app offers exactly the plans shown on the website.
    const plans = await db.all('SELECT pl.*, p.name AS property_name FROM plans pl LEFT JOIN properties p ON p.id=pl.property_id ORDER BY pl.sort, pl.duration_months');
    const pay = await S.getSetting('payments');
    const investing = await S.getSetting('investing');
    return {
      enabled: !!investing.enabled, kyc_required: !!investing.kyc_required, kyc_status: ctx.user.kyc_status,
      properties: props.map((p) => serializeProperty(p)), plans: plans.filter(planAvailable).map(serializePlan),
      currencies: pay.currencies.filter((c) => c.enabled).map((c) => ({ code: c.code, name: c.name, rate_usd: c.rate_usd, decimals: c.decimals, networks: c.networks.map((n) => ({ code: n.code, name: n.name })) })),
      window_minutes: pay.window_minutes, demo_addresses: !!pay.demo_addresses, app_url: config.APP_URL,
    };
  });
}

module.exports = { register, serializeInvestment, serializePayment, INV_SELECT, FUNDED, inList };
