'use strict';
const { Router, readBody, Raw } = require('./lib/http');
const { HttpError } = require('./lib/util');
const { db } = require('./db');
const { loadSession } = require('./lib/auth');
const { seed } = require('./db/seed');
const { ensurePartnershipPlans } = require('./db/plans');
const { runMigrations } = require('./db/migrations');

const router = new Router();
for (const moduleName of ['public', 'auth', 'investor', 'admin', 'webhooks', 'translation', 'cron']) {
  require(`./routes/${moduleName}`).register(router);
}

const securityHeaders = {
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

const buckets = new Map();
let initialization;

function initialize() {
  if (!initialization) {
    initialization = db.init().then(() => process.env.VERCEL ? undefined : seed()).then(() => ensurePartnershipPlans()).then(() => runMigrations()).catch((error) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

function hit(key, max, windowSec) {
  const timestamp = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.reset < timestamp) {
    bucket = { count: 0, reset: timestamp + windowSec * 1000 };
    buckets.set(key, bucket);
  }
  bucket.count++;
  return bucket.count <= max ? 0 : Math.ceil((bucket.reset - timestamp) / 1000);
}

function headerObject(headers) {
  const out = {};
  headers.forEach((value, key) => { out[key.toLowerCase()] = value; });
  return out;
}

async function handleApiRequest(request) {
  let url;
  try { url = new URL(request.url); } catch { return new Response('Bad request', { status: 400 }); }
  const headersIn = headerObject(request.headers);
  const forwardedIp = headersIn['x-forwarded-for']?.split(',')[0].trim();
  const ip = process.env.TRUST_PROXY === '1' && forwardedIp ? forwardedIp : forwardedIp || 'unknown';
  const headersOut = {};
  const ctx = {
    req: { headers: headersIn, socket: { remoteAddress: ip } },
    query: Object.fromEntries(url.searchParams),
    ip,
    headers: headersOut,
    setHeader(name, value) { headersOut[name] = value; },
    rateLimit(name, max, windowSec) {
      const wait = hit(`${name}:${ip}`, max, windowSec);
      if (wait) throw new HttpError(429, `Too many attempts. Try again in ${wait > 90 ? Math.ceil(wait / 60) + ' minutes' : wait + ' seconds'}.`);
    },
  };

  try {
    const globalWait = hit(`global:${ip}`, 600, 60);
    if (globalWait) throw new HttpError(429, 'Too many requests. Slow down and try again shortly.');
    const match = router.match(request.method, url.pathname);
    if (!match) throw new HttpError(404, 'Endpoint not found.');
    ctx.params = match.params;
    const isWebhook = url.pathname.startsWith('/api/webhooks/');
    if (!['GET', 'HEAD'].includes(request.method)) {
      if (!isWebhook && headersIn['x-requested-with'] !== 'fetch') throw new HttpError(403, 'Request blocked.');
      const body = Buffer.from(await request.arrayBuffer());
      const isUpload = /\/(kyc\/document|images|documents|uploads)$/.test(url.pathname);
      const limit = isUpload ? 15 * 1024 * 1024 : 1024 * 1024;
      if (body.length > limit) throw new HttpError(413, 'The request is too large.');
      ctx.rawBody = body;
      if (body.length) {
        if (!(headersIn['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Send JSON.');
        try { ctx.body = JSON.parse(body.toString('utf8')); } catch { throw new HttpError(400, 'The request body is not valid JSON.'); }
      } else ctx.body = {};
    }
    await initialize();
    await loadSession(ctx);
    const result = await match.handler(ctx);
    const responseHeaders = new Headers({ ...securityHeaders, ...headersOut });
    if (result instanceof Raw) {
      responseHeaders.set('Content-Type', result.type);
      for (const [name, value] of Object.entries(result.headers)) responseHeaders.set(name, value);
      return new Response(result.body, { status: 200, headers: responseHeaders });
    }
    responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
    responseHeaders.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify(result === undefined ? { ok: true } : result), { status: 200, headers: responseHeaders });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    const body = { error: status === 500 ? 'Something went wrong on our side. Try again in a moment.' : error.message };
    if (error.fields) body.fields = Object.fromEntries(Object.entries(error.fields).filter(([, value]) => value));
    return Response.json(body, { status, headers: { ...securityHeaders, 'Cache-Control': 'no-store', ...headersOut } });
  }
}

module.exports = { handleApiRequest, initialize };