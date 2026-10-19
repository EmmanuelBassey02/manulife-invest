'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../config');

function clean(params) {
  return (params || []).map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
}

async function makeSqlite() {
  // Silence the one-time ExperimentalWarning for node:sqlite only.
  const emit = process.emitWarning;
  process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : emit.call(process, w, ...a));
  const { DatabaseSync } = await import('node:sqlite');
  process.emitWarning = emit;
  if (config.SQLITE_PATH !== ':memory:') fs.mkdirSync(path.dirname(config.SQLITE_PATH), { recursive: true });
  const db = new DatabaseSync(config.SQLITE_PATH);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const cache = new Map();
  const st = (s) => {
    let x = cache.get(s);
    if (!x) { x = db.prepare(s); cache.set(s, x); }
    return x;
  };
  const api = {
    kind: 'sqlite',
    async all(s, p) { return st(s).all(...clean(p)).map((r) => ({ ...r })); },
    async get(s, p) { const r = st(s).get(...clean(p)); return r ? { ...r } : null; },
    async run(s, p) { const r = st(s).run(...clean(p)); return { changes: Number(r.changes) }; },
    async exec(s) { db.exec(s); },
  };
  let chain = Promise.resolve();
  api.tx = (fn) => {
    const go = async () => {
      db.exec('BEGIN IMMEDIATE');
      try { const r = await fn(api); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
    };
    const p = chain.then(go, go);
    chain = p.catch(() => {});
    return p;
  };
  return api;
}

function makePg() {
  let pg;
  try { pg = require('pg'); } catch {
    throw new Error('DATABASE_URL points to PostgreSQL but the "pg" package is not installed. Run: npm install pg');
  }
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined,
    max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000, keepAlive: true,
  });
  // Without a listener, a connection the server dropped while idle would crash the process.
  pool.on('error', (error) => console.error('[pg] idle connection error:', error.message));
  // node-postgres returns COUNT/SUM as strings; parse numerics as JS numbers.
  pg.types.setTypeParser(20, (v) => Number(v));
  pg.types.setTypeParser(1700, (v) => Number(v));
  const conv = (s) => { let i = 0; return s.replace(/\?/g, () => '$' + ++i); };
  const transient = (e) => /Connection terminated|ECONNRESET|EPIPE|ETIMEDOUT|server closed the connection/i.test(String(e && e.message)) || ['57P01', '08006', '08003', '08001'].includes(e && e.code);
  // A pooled connection can be dead by the time it is reused; retry once on a fresh one.
  const attempt = async (retry, fn) => { try { return await fn(); } catch (e) { if (retry && transient(e)) return fn(); throw e; } };
  const wrap = (q, retry = false) => ({
    kind: 'pg',
    async all(s, p) { return attempt(retry, async () => (await q.query(conv(s), clean(p))).rows); },
    async get(s, p) { return attempt(retry, async () => (await q.query(conv(s), clean(p))).rows[0] || null); },
    async run(s, p) { return attempt(retry, async () => ({ changes: (await q.query(conv(s), clean(p))).rowCount })); },
    async exec(s) { await attempt(retry, () => q.query(s)); },
  });
  const api = wrap(pool, true);
  api.pool = pool;
  api.tx = async (fn) => {
    const c = await pool.connect();
    try { await c.query('BEGIN'); const r = await fn(wrap(c)); await c.query('COMMIT'); return r; }
    catch (e) { await c.query('ROLLBACK'); throw e; }
    finally { c.release(); }
  };
  return api;
}

function schemaFor(kind) {
  const sql = fs.readFileSync(path.join(config.root, 'server', 'db', 'schema.sql'), 'utf8');
  if (kind !== 'pg') return sql;
  return sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY').replace(/\bREAL\b/g, 'DOUBLE PRECISION');
}

const db = {
  driver: null,
  async init() {
    if (config.isVercel && !config.DATABASE_URL) {
      throw new Error('Vercel deployments require a persistent PostgreSQL DATABASE_URL. SQLite is not supported.');
    }
    this.driver = /^postgres(ql)?:\/\//.test(config.DATABASE_URL) ? makePg() : await makeSqlite();
    await this.driver.exec(schemaFor(this.driver.kind));
    await this.ensureColumn('plans', 'description', 'TEXT');
  },
  /** Adds a column to a database created before the column existed. */
  async ensureColumn(table, column, type) {
    if (this.driver.kind === 'pg') { await this.driver.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`); return; }
    const columns = await this.driver.all(`PRAGMA table_info(${table})`);
    if (!columns.some((c) => c.name === column)) await this.driver.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  },
  get kind() { return this.driver.kind; },
  all(s, p) { return this.driver.all(s, p); },
  get(s, p) { return this.driver.get(s, p); },
  run(s, p) { return this.driver.run(s, p); },
  tx(fn) { return this.driver.tx(fn); },
};

const ident = (k) => { if (!/^[a-z_][a-z0-9_]*$/.test(k)) throw new Error('Invalid identifier ' + k); return k; };

/** Insert a row and return its id. Works with db or a tx handle. */
async function insert(h, table, obj) {
  const keys = Object.keys(obj).map(ident);
  const row = await h.get(
    `INSERT INTO ${ident(table)} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')}) RETURNING id`,
    keys.map((k) => obj[k]),
  );
  return Number(row.id);
}

async function update(h, table, id, obj) {
  const keys = Object.keys(obj).map(ident);
  if (!keys.length) return;
  await h.run(`UPDATE ${ident(table)} SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`, [...keys.map((k) => obj[k]), id]);
}

module.exports = { db, insert, update, schemaFor, makePg };
