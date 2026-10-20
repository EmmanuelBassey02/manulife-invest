'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { db } = require('./db');
const { Router, readBody, Raw } = require('./lib/http');
const { HttpError } = require('./lib/util');
const { loadSession } = require('./lib/auth');
const engine = require('./lib/engine');
const { seed } = require('./db/seed');
const { ensurePartnershipPlans } = require('./db/plans');
const { runMigrations } = require('./db/migrations');

const router = new Router();
for (const m of ['public', 'auth', 'investor', 'admin', 'webhooks', 'translation']) require(`./routes/${m}`).register(router);

const PUBLIC_DIR = path.join(config.root, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self'", "frame-ancestors 'none'",
    "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join('; '),
};
if (config.isProd) SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';

/* --------------------------------------------------------------- rate limit */
const buckets = new Map();
function hit(key, max, windowSec) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < t) { b = { count: 0, reset: t + windowSec * 1000 }; buckets.set(key, b); }
  b.count++;
  return b.count <= max ? 0 : Math.ceil((b.reset - t) / 1000);
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k); }, 60000).unref();

function clientIp(req) {
  if (config.TRUST_PROXY) {
    const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (f) return f;
  }
  return req.socket.remoteAddress || 'unknown';
}

const UPLOAD_ROUTES = /\/(kyc\/document|images|documents|uploads)$/;

function send(res, status, body, type, extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, ...extra });
  res.end(body);
}

async function handleApi(req, res, url) {
  const ctx = {
    req, res, query: Object.fromEntries(url.searchParams), ip: clientIp(req), headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    rateLimit(name, max, windowSec) {
      const wait = hit(`${name}:${this.ip}`, max, windowSec);
      if (wait) throw new HttpError(429, `Too many attempts. Try again in ${wait > 90 ? Math.ceil(wait / 60) + ' minutes' : wait + ' seconds'}.`);
    },
  };
  try {
    const globalWait = hit(`global:${ctx.ip}`, 600, 60);
    if (globalWait) throw new HttpError(429, 'Too many requests. Slow down and try again shortly.');
    const m = router.match(req.method, url.pathname);
    if (!m) throw new HttpError(404, 'Endpoint not found.');
    ctx.params = m.params;
    const isWebhook = url.pathname.startsWith('/api/webhooks/');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // CSRF defence: SameSite=Strict cookie + custom header that cross-site forms cannot send.
      if (!isWebhook && req.headers['x-requested-with'] !== 'fetch') throw new HttpError(403, 'Request blocked.');
      const raw = await readBody(req, UPLOAD_ROUTES.test(url.pathname) ? 15 * 1024 * 1024 : 1024 * 1024);
      ctx.rawBody = raw;
      if (raw.length) {
        if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Send JSON.');
        try { ctx.body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'The request body is not valid JSON.'); }
      } else ctx.body = {};
    }
    await loadSession(ctx);
    const out = await m.handler(ctx);
    if (out instanceof Raw) return send(res, 200, out.body, out.type, { ...ctx.headers, ...out.headers });
    send(res, 200, JSON.stringify(out === undefined ? { ok: true } : out), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store', ...ctx.headers });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    const body = { error: status === 500 ? 'Something went wrong on our side. Try again in a moment.' : e.message };
    if (e.fields) body.fields = Object.fromEntries(Object.entries(e.fields).filter(([, v]) => v));
    send(res, status, JSON.stringify(body), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store', ...ctx.headers });
  }
}

const indexHtml = () => fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'));

function handleStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'Bad request', 'text/plain'); }
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (file.startsWith(PUBLIC_DIR + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file).toLowerCase();
    const cache = rel.startsWith('/assets/') ? 'public, max-age=300' : 'no-cache';
    return send(res, 200, req.method === 'HEAD' ? '' : fs.readFileSync(file), MIME[ext] || 'application/octet-stream', { 'Cache-Control': cache });
  }
  if (path.extname(rel)) return send(res, 404, 'Not found', 'text/plain');
  // SPA fallback
  send(res, 200, req.method === 'HEAD' ? '' : indexHtml(), MIME['.html'], { 'Cache-Control': 'no-cache' });
}

async function start() {
  await db.init();
  await seed();
  await ensurePartnershipPlans();
  await runMigrations();
  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, 'Bad request', 'text/plain'); }
    if (url.pathname.startsWith('/api/')) handleApi(req, res, url);
    else handleStatic(req, res, url);
  });
  server.headersTimeout = 30000;
  server.requestTimeout = 60000;
  await new Promise((resolve) => server.listen(config.PORT, resolve));
  console.log(`SapronLife Financial Investment running at ${config.APP_URL} (${db.kind})`);
  const runTick = () => engine.tick().catch((e) => console.error('[scheduler]', e));
  runTick();
  setInterval(runTick, 60000).unref();
  return server;
}

if (require.main === module) {
  start().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { start };
