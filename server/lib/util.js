'use strict';
const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const now = () => new Date().toISOString();
const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86400000).toISOString();

/** Calendar-correct month addition (Jan 31 + 1 month = Feb 28/29). */
function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}

function parseJSON(v, fallback) {
  if (v == null || v === '') return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const round = (n, dp = 2) => Math.round(Number(n) * 10 ** dp) / 10 ** dp;

function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 80) || 'item';
}

const assert = (cond, status, msg) => { if (!cond) throw new HttpError(status, msg); };
const NotFound = (what = 'Resource') => new HttpError(404, `${what} not found`);

function paginate(query, defSize = 20) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(query.size, 10) || defSize));
  return { page, size, offset: (page - 1) * size };
}

module.exports = { HttpError, now, addDays, addMonths, parseJSON, sha256, randomToken, round, slugify, assert, NotFound, paginate };
