'use strict';
// One-time, idempotent content updates for databases created before these changes.
// Each step records a marker in `settings` so it never runs twice and never overwrites later admin edits.
const { db } = require('./index');
const { now, parseJSON } = require('../lib/util');

const BRAND = 'Manulife Financial Investment';

// Order matters: longer phrases first.
const TEXT_REPLACEMENTS = [
  [/SapronLife Financial Investment Services/g, BRAND],
  [/SapronLife Financial Investment/g, BRAND],
  [/SapronLife [Ff]inancial [Ss]ervices/g, BRAND],
  [/SapronLife/g, 'Manulife'],
  [/sapronlife\.example/g, 'manulife.example'],
  [/Manulife Financial Investment Services/g, BRAND],
  [/Manulife [Ff]inancial [Ss]ervices/g, BRAND],
  [/EstateInvest/g, 'Manulife'],
  [/\bRedemptions\b/g, 'Withdrawals'],
  [/(?<![/\w-])redemptions\b/g, 'withdrawals'], // skip URLs such as /legal/redemption
  [/\bRedemption\b/g, 'Withdrawal'],
  [/(?<![/\w-])request redemption\b/g, 'request a withdrawal'],
  [/(?<![/\w-])redemption\b/g, 'withdrawal'],
];

function rewrite(value) {
  if (typeof value === 'string') return TEXT_REPLACEMENTS.reduce((text, [re, to]) => text.replace(re, to), value);
  if (Array.isArray(value)) return value.map(rewrite);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]));
  return value;
}

async function once(marker, fn) {
  if (await db.get('SELECT value FROM settings WHERE key=?', [marker])) return false;
  return db.tx(async (h) => {
    if (h.kind === 'pg') await h.get('SELECT pg_advisory_xact_lock(727202) AS locked');
    if (await h.get('SELECT value FROM settings WHERE key=?', [marker])) return false;
    await fn(h);
    await h.run('INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?)', [marker, JSON.stringify({ done: true }), null, now()]);
    return true;
  });
}

/** Renames the company to Manulife Financial Investment and "Redemption" to "Withdrawal" in website content. */
async function brandAndWithdrawalContent(h) {
  const rows = await h.all('SELECT key, value FROM cms');
  for (const row of rows) {
    const before = parseJSON(row.value, null);
    if (before == null) continue;
    let after = rewrite(before);
    if (row.key === 'site' && after && typeof after === 'object' && !Array.isArray(after)) after = { ...after, brand: BRAND };
    const next = JSON.stringify(after);
    if (next !== row.value) await h.run('UPDATE cms SET value=?, updated_at=? WHERE key=?', [next, now(), row.key]);
  }
}

/** Ensures any existing content with SapronLife is rebranded to Manulife. */
async function brandManulifeContent(h) {
  const rows = await h.all('SELECT key, value FROM cms');
  for (const row of rows) {
    const before = parseJSON(row.value, null);
    if (before == null) continue;
    let after = rewrite(before);
    if (row.key === 'site' && after && typeof after === 'object' && !Array.isArray(after)) after = { ...after, brand: BRAND };
    const next = JSON.stringify(after);
    if (next !== row.value) await h.run('UPDATE cms SET value=?, updated_at=? WHERE key=?', [next, now(), row.key]);
  }
  const props = await h.all('SELECT id, details FROM properties');
  for (const p of props) {
    const det = parseJSON(p.details, null);
    if (det && det.Developer && det.Developer.includes('SapronLife')) {
      det.Developer = det.Developer.replace(/SapronLife/g, 'Manulife');
      await h.run('UPDATE properties SET details=?, updated_at=? WHERE id=?', [JSON.stringify(det), now(), p.id]);
    }
  }
}

/** Listings used to be saved as Draft by default, so ones marked "Feature on the homepage" never appeared. Publish those. */
async function publishFeaturedDrafts(h) {
  const res = await h.run("UPDATE properties SET status='published', updated_at=? WHERE status='draft' AND featured=1", [now()]);
  if (res.changes) console.log(`Published ${res.changes} featured propert${res.changes === 1 ? 'y' : 'ies'} that had been saved as Draft.`);
}

async function runMigrations() {
  await once('migration.sapronlife_withdrawals', brandAndWithdrawalContent);
  const ran = await once('migration.manulife_brand', brandManulifeContent);
  if (ran) console.log('Updated website content to Manulife Financial Investment.');
  await once('migration.publish_featured_drafts', publishFeaturedDrafts);
}

module.exports = { runMigrations, rewrite, BRAND };
