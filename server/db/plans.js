'use strict';
const { db, insert } = require('./index');
const { now } = require('../lib/util');
const { getCms, setCms } = require('../lib/services');

/** Partnership plans. Weekly profit = minimum × weekly return; monthly = 4 weeks; annual = 52 weeks. */
const PARTNERSHIP_PLANS = [
  { name: 'Starter Plan', description: 'Ideal for new investors starting their journey.', min_amount: 500, return_rate: 2.0 },
  { name: 'Basic Plan', description: 'A solid start for consistent growth.', min_amount: 1000, return_rate: 2.5 },
  { name: 'Growth Plan', description: 'Designed for investors seeking steady growth.', min_amount: 2500, return_rate: 2.5 },
  { name: 'Advanced Plan', description: 'For investors ready to grow further.', min_amount: 5000, return_rate: 2.5 },
  { name: 'Business Plan', description: 'For business-minded investors aiming higher.', min_amount: 10000, return_rate: 2.5 },
  { name: 'Premium Plan', description: 'Built for serious investors with bigger goals.', min_amount: 20000, return_rate: 2.6 },
  { name: 'Executive Plan', description: 'Higher returns for high-value investors.', min_amount: 35000, return_rate: 2.7 },
  { name: 'Elite Plan', description: 'Exclusive plan for experienced investors.', min_amount: 50000, return_rate: 2.8 },
  { name: 'Legacy Plan', description: 'Grow and secure your financial legacy.', min_amount: 75000, return_rate: 2.9 },
  { name: 'VIP Plan', description: 'Our highest tier for maximum growth.', min_amount: 100000, return_rate: 3.0 },
];

const PLAN_TERM_DAYS = 364; // 52 weeks, the basis of the annual profit column
const MIN_PLAN_AMOUNT = PARTNERSHIP_PLANS[0].min_amount;
const LEGACY_PLAN_NAMES = ['1 Month', '3 Months', '6 Months', '1 Year', '2 Years', 'Custom (3 Years)'];
const PLAN_NAMES = PARTNERSHIP_PLANS.map((p) => p.name);

const RISK_TEXT = 'Your capital is at risk. Property projects can be delayed or cost more than planned, and values can fall. You may not be able to withdraw before maturity. Read the Risk Disclosure before investing.';
const TERMS_TEXT = 'Funds are committed for the full 52-week plan term. Estimated weekly profit is calculated on your invested amount and is not guaranteed. Maturity is calculated from the date your payment is confirmed. Full terms are in the Investment Terms.';

const MARKER = 'migration.partnership_plans';
const OLD_STEP_BODY = 'Review the property, its documents and risks, then pick a plan duration and amount that suits you.';
const NEW_STEP_BODY = 'Review the property, its documents and risks, then pick the partnership plan and amount that suits you.';

function planRow(plan, index, t) {
  return {
    name: plan.name, description: plan.description, duration_months: null, duration_days: PLAN_TERM_DAYS,
    min_amount: plan.min_amount, max_amount: null, return_type: 'fixed_weekly', return_rate: plan.return_rate, return_note: null, return_approved: 1,
    terms: TERMS_TEXT, risk_info: RISK_TEXT, required_docs: 'Approved identity verification', status: 'active', sort: index + 1, created_at: t, updated_at: t,
  };
}

/** One-time, idempotent switch to the partnership plans. Existing investments keep their original plan. */
async function ensurePartnershipPlans() {
  const done = await db.get('SELECT value FROM settings WHERE key=?', [MARKER]);
  if (done) return;
  const t = now();
  const ran = await db.tx(async (h) => {
    if (h.kind === 'pg') await h.get('SELECT pg_advisory_xact_lock(727201) AS locked');
    if (await h.get('SELECT value FROM settings WHERE key=?', [MARKER])) return false;
    for (const [index, plan] of PARTNERSHIP_PLANS.entries()) {
      const existing = await h.get('SELECT id FROM plans WHERE name=?', [plan.name]);
      if (!existing) await insert(h, 'plans', planRow(plan, index, t));
    }
    const legacy = LEGACY_PLAN_NAMES.map(() => '?').join(',');
    await h.run(`UPDATE plans SET status='inactive', sort=sort+100, updated_at=? WHERE name IN (${legacy}) AND status='active'`, [t, ...LEGACY_PLAN_NAMES]);
    await h.run('UPDATE properties SET min_investment=?, updated_at=? WHERE min_investment>?', [MIN_PLAN_AMOUNT, t, MIN_PLAN_AMOUNT]);
    await h.run('INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?)', [MARKER, JSON.stringify({ done: true }), null, t]);
    return true;
  });
  if (!ran) return;
  const steps = await getCms('how_it_works', null);
  if (steps && Array.isArray(steps.steps) && steps.steps.some((s) => s.body === OLD_STEP_BODY)) {
    await setCms('how_it_works', { ...steps, steps: steps.steps.map((s) => (s.body === OLD_STEP_BODY ? { ...s, body: NEW_STEP_BODY } : s)) }, null);
  }
  console.log('Switched to the partnership investment plans.');
}

async function partnershipPlans() {
  const rows = await db.all(`SELECT * FROM plans WHERE name IN (${PLAN_NAMES.map(() => '?').join(',')}) ORDER BY sort, id`, PLAN_NAMES);
  return rows;
}

module.exports = { PARTNERSHIP_PLANS, PLAN_TERM_DAYS, MIN_PLAN_AMOUNT, NEW_STEP_BODY, ensurePartnershipPlans, partnershipPlans };
