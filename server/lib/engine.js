'use strict';
const { db, insert } = require('../db');
const { HttpError, now, addDays, addMonths, round, parseJSON } = require('./util');
const { getSetting, notify, sendMail, audit } = require('./services');

const STATUSES = [
  'pending', 'payment_awaiting', 'payment_confirmed', 'active', 'maturing', 'matured', 'completed', 'redeemed',
  'cancelled', 'suspended', 'under_review', 'disputed',
];

const TRANSITIONS = {
  pending: ['payment_awaiting', 'cancelled', 'under_review'],
  payment_awaiting: ['payment_confirmed', 'cancelled', 'under_review', 'disputed'],
  payment_confirmed: ['active', 'under_review', 'cancelled'],
  active: ['maturing', 'matured', 'suspended', 'under_review', 'disputed'],
  maturing: ['matured', 'suspended', 'under_review', 'disputed'],
  matured: ['completed', 'redeemed', 'under_review', 'disputed'],
  suspended: ['active', 'under_review', 'cancelled'],
  under_review: ['payment_awaiting', 'payment_confirmed', 'active', 'suspended', 'cancelled', 'matured'],
  disputed: ['under_review', 'active', 'cancelled', 'matured'],
  completed: [],
  redeemed: [],
  cancelled: [],
};

const LABELS = {
  pending: 'Pending', payment_awaiting: 'Awaiting payment', payment_confirmed: 'Payment confirmed', active: 'Active',
  maturing: 'Maturing', matured: 'Matured', completed: 'Completed', redeemed: 'Redeemed', cancelled: 'Cancelled',
  suspended: 'Suspended', under_review: 'Under review', disputed: 'Disputed',
};

/** Plan duration -> maturity date from a start date. */
function computeMaturity(plan, start) {
  if (plan.duration_months) return addMonths(start, plan.duration_months);
  if (plan.duration_days) return addDays(start, plan.duration_days);
  throw new HttpError(422, 'This plan has no duration configured.');
}

/**
 * Expected return comes ONLY from administrator-defined, legally approved rules.
 * If the plan's return structure is not approved, no figure is produced.
 */
function returnTerms(plan) {
  const approved = !!plan.return_approved && plan.return_type !== 'pending' && plan.return_rate != null;
  return {
    approved,
    type: approved ? plan.return_type : 'pending',
    rate: approved ? Number(plan.return_rate) : null,
    note: plan.return_note || (approved ? null : 'Return structure pending legal approval.'),
  };
}

function expectedReturn(terms, amount, start, maturity) {
  if (!terms.approved) return null;
  if (terms.type === 'fixed_total') return round((amount * terms.rate) / 100);
  if (terms.type === 'fixed_weekly') {
    const weeks = (new Date(maturity) - new Date(start)) / (7 * 86400000);
    return round(((amount * terms.rate) / 100) * weeks);
  }
  if (terms.type === 'fixed_annual') {
    const days = (new Date(maturity) - new Date(start)) / 86400000;
    return round(((amount * terms.rate) / 100) * (days / 365));
  }
  return null;
}

/** Validated, audited status change. Use within or outside a transaction. */
async function transition(h, inv, to, { reason, actor, force = false } = {}) {
  if (!STATUSES.includes(to)) throw new HttpError(422, 'Unknown status.');
  if (inv.status === to) return inv;
  if (!force && !(TRANSITIONS[inv.status] || []).includes(to)) {
    throw new HttpError(409, `An investment that is ${LABELS[inv.status].toLowerCase()} cannot move to ${LABELS[to].toLowerCase()}.`);
  }
  const patch = { status: to, updated_at: now() };
  if (to === 'active' && !inv.start_date) {
    const plan = await h.get('SELECT * FROM plans WHERE id=?', [inv.plan_id]);
    const start = now();
    const maturity = computeMaturity(plan, start);
    const terms = parseJSON(inv.return_terms, returnTerms(plan));
    patch.start_date = start;
    patch.maturity_date = maturity;
    patch.expected_return = expectedReturn(terms, inv.amount_usd, start, maturity);
  }
  const keys = Object.keys(patch);
  await h.run(`UPDATE investments SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`, [...keys.map((k) => patch[k]), inv.id]);
  await insert(h, 'investment_status_history', {
    investment_id: inv.id, from_status: inv.status, to_status: to, reason: reason || null, actor_id: actor ? actor.id : null, created_at: now(),
  });
  return { ...inv, ...patch };
}

const MESSAGES = {
  active: (i) => ['Your investment is active', `Investment ${i.ref} is now active. It matures on ${fmtDate(i.maturity_date)}.`],
  maturing: (i) => ['Your investment matures soon', `Investment ${i.ref} matures on ${fmtDate(i.maturity_date)}.`],
  matured: (i) => ['Your investment has matured', `Investment ${i.ref} has reached maturity. You can now review redemption options in your dashboard.`],
  payment_confirmed: (i) => ['Payment confirmed', `We confirmed your payment for investment ${i.ref}.`],
  cancelled: (i) => ['Investment cancelled', `Investment ${i.ref} was cancelled.`],
  suspended: (i) => ['Investment suspended', `Investment ${i.ref} has been suspended. Contact support for details.`],
  under_review: (i) => ['Investment under review', `Investment ${i.ref} is under review by our team.`],
  disputed: (i) => ['Investment marked as disputed', `Investment ${i.ref} has been marked as disputed. Our team will contact you.`],
  completed: (i) => ['Investment completed', `Investment ${i.ref} is complete.`],
  redeemed: (i) => ['Investment redeemed', `Investment ${i.ref} has been redeemed.`],
};

async function announce(inv) {
  const m = MESSAGES[inv.status];
  if (!m) return;
  const [title, body] = m(inv);
  await notify(inv.user_id, { type: 'investment', title, body, link: `/app/investments/${inv.id}` });
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

/** Payment confirmed: record it, move the investment forward, activate per settings. */
async function confirmPayment(payment, { actor, txHash, confirmations, note, ctx }) {
  const settings = await getSetting('payments');
  const result = await db.tx(async (t) => {
    const p = await t.get('SELECT * FROM payments WHERE id=?', [payment.id]);
    if (!['awaiting', 'submitted'].includes(p.status)) throw new HttpError(409, 'This payment has already been processed.');
    const hash = txHash || p.tx_hash;
    if (!hash) throw new HttpError(422, 'A transaction hash is required to confirm a payment.');
    const dupe = await t.get("SELECT id FROM payments WHERE tx_hash=? AND id<>? AND status='confirmed'", [hash, p.id]);
    if (dupe) throw new HttpError(409, 'This transaction hash is already linked to another confirmed payment.');
    await t.run('UPDATE payments SET status=?, verification=?, tx_hash=?, confirmations=?, verified_by=?, verified_at=?, note=?, updated_at=? WHERE id=?', [
      'confirmed', 'verified', hash, confirmations ?? Math.max(p.confirmations, settings.required_confirmations), actor ? actor.id : null, now(), note || p.note, now(), p.id,
    ]);
    let inv = await t.get('SELECT * FROM investments WHERE id=?', [p.investment_id]);
    if (inv) {
      if (inv.status === 'pending') inv = await transition(t, inv, 'payment_awaiting', { actor, reason: 'Payment received' });
      if (inv.status === 'payment_awaiting' || inv.status === 'under_review') {
        inv = await transition(t, inv, 'payment_confirmed', { actor, reason: `Payment ${p.ref} verified`, force: inv.status === 'under_review' });
      }
      if (settings.auto_activate && inv.status === 'payment_confirmed') {
        inv = await transition(t, inv, 'active', { actor, reason: 'Activated automatically after payment confirmation' });
      }
    }
    return { p, inv };
  });
  await audit(ctx, 'payment.confirm', 'payment', payment.id, { status: payment.status }, { status: 'confirmed', tx_hash: txHash || payment.tx_hash });
  await notify(payment.user_id, {
    type: 'payment', title: 'Payment received',
    body: `We verified your payment of ${result.p.amount_crypto} ${result.p.currency} (${result.p.ref}).`, link: '/app/transactions',
  });
  if (result.inv) await announce(result.inv);
  return result;
}

async function rejectPayment(payment, { actor, note, ctx }) {
  await db.tx(async (t) => {
    const p = await t.get('SELECT * FROM payments WHERE id=?', [payment.id]);
    if (!['awaiting', 'submitted'].includes(p.status)) throw new HttpError(409, 'This payment has already been processed.');
    await t.run('UPDATE payments SET status=?, verification=?, verified_by=?, verified_at=?, note=?, updated_at=? WHERE id=?', [
      'rejected', 'failed', actor ? actor.id : null, now(), note || null, now(), p.id,
    ]);
    const inv = await t.get('SELECT * FROM investments WHERE id=?', [p.investment_id]);
    if (inv && inv.status === 'payment_awaiting') await transition(t, inv, 'under_review', { actor, reason: note || 'Payment could not be verified' });
  });
  await audit(ctx, 'payment.reject', 'payment', payment.id, { status: payment.status }, { status: 'rejected', note });
  await notify(payment.user_id, {
    type: 'payment', title: 'We could not verify your payment',
    body: `Payment ${payment.ref} could not be verified${note ? ': ' + note : '.'} Contact support if you believe this is wrong.`, link: '/app/transactions',
  });
}

/** Periodic housekeeping: expire unpaid invoices, move investments through maturity. */
async function tick() {
  const t = now();
  const expired = await db.all("SELECT * FROM payments WHERE status='awaiting' AND kind='deposit' AND expires_at IS NOT NULL AND expires_at < ?", [t]);
  for (const p of expired) {
    await db.tx(async (h) => {
      await h.run("UPDATE payments SET status='expired', updated_at=? WHERE id=? AND status='awaiting'", [t, p.id]);
      const inv = await h.get('SELECT * FROM investments WHERE id=?', [p.investment_id]);
      if (inv && inv.status === 'payment_awaiting') {
        const done = await transition(h, inv, 'cancelled', { reason: 'Payment window expired' });
        await notify(done.user_id, { type: 'payment', title: 'Payment window expired', body: `No payment was received for ${done.ref}, so it was cancelled. You can start a new investment any time.`, link: '/app/investments', email: true });
      }
    });
  }
  const inv = await getSetting('investing');
  const windowEnd = addDays(t, inv.maturing_window_days);
  const soon = await db.all("SELECT * FROM investments WHERE status='active' AND maturity_date IS NOT NULL AND maturity_date <= ?", [windowEnd]);
  for (const i of soon) {
    const next = await db.tx((h) => transition(h, i, i.maturity_date <= t ? 'matured' : 'maturing', { reason: 'Scheduled maturity check' }));
    await announce(next);
  }
  const due = await db.all("SELECT * FROM investments WHERE status='maturing' AND maturity_date <= ?", [t]);
  for (const i of due) {
    const next = await db.tx((h) => transition(h, i, 'matured', { reason: 'Maturity date reached' }));
    await announce(next);
  }
}

module.exports = {
  STATUSES, TRANSITIONS, LABELS, computeMaturity, returnTerms, expectedReturn, transition, announce,
  confirmPayment, rejectPayment, tick, fmtDate, sendMail,
};
