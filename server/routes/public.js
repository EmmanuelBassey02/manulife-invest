'use strict';
const { db, insert } = require('../db');
const { now, parseJSON, NotFound, HttpError } = require('../lib/util');
const { check } = require('../lib/validate');
const { getCms, getSetting, readUpload, notifyAdmins, assignRef, sendMail } = require('../lib/services');
const { returnTerms } = require('../lib/engine');
const { isAdmin } = require('../lib/auth');
const { Raw } = require('../lib/http');

function serializeProperty(p, extra = {}) {
  if (!p) return null;
  return {
    id: p.id, slug: p.slug, name: p.name, type: p.type, city: p.city, country: p.country, summary: p.summary,
    description: p.description, dev_status: p.dev_status, status: p.status, accepting: !!p.accepting, featured: !!p.featured,
    min_investment: Number(p.min_investment), target_raise: p.target_raise != null ? Number(p.target_raise) : null,
    details: parseJSON(p.details, {}), highlights: parseJSON(p.highlights, []), risks: p.risks, art_seed: p.art_seed,
    images: (parseJSON(p.images, []) || []).map((id) => `/api/files/${id}`), image_ids: parseJSON(p.images, []),
    created_at: p.created_at, updated_at: p.updated_at, ...extra,
  };
}

function serializePlan(pl) {
  return {
    id: pl.id, name: pl.name, duration_months: pl.duration_months, duration_days: pl.duration_days,
    min_amount: Number(pl.min_amount), max_amount: pl.max_amount != null ? Number(pl.max_amount) : null,
    returns: returnTerms(pl), terms: pl.terms, risk_info: pl.risk_info, required_docs: pl.required_docs,
    property_id: pl.property_id, property_name: pl.property_name || null, available_from: pl.available_from,
    available_to: pl.available_to, status: pl.status, sort: pl.sort,
    return_type: pl.return_type, return_rate: pl.return_rate, return_note: pl.return_note, return_approved: !!pl.return_approved,
  };
}

function planAvailable(pl) {
  const t = now();
  return pl.status === 'active' && (!pl.available_from || pl.available_from <= t) && (!pl.available_to || pl.available_to >= t);
}

async function raisedFor(propertyId) {
  const r = await db.get(
    "SELECT COALESCE(SUM(amount_usd),0) AS s, COUNT(DISTINCT user_id) AS n FROM investments WHERE property_id=? AND status IN ('payment_confirmed','active','maturing','matured','completed','redeemed')",
    [propertyId],
  );
  return { raised: Number(r.s), investors: Number(r.n) };
}

async function plansFor(propertyId) {
  const rows = await db.all('SELECT * FROM plans WHERE (property_id=? OR property_id IS NULL) ORDER BY sort, duration_months', [propertyId]);
  return rows.filter(planAvailable).map(serializePlan);
}

function register(r) {
  r.get('/api/public/site', async () => {
    const [site, home, payments, investing, testimonials, disclosures] = await Promise.all([
      getCms('site', {}), getCms('home', {}), getSetting('payments'), getSetting('investing'), getCms('testimonials', []), getCms('disclosures', {}),
    ]);
    return {
      site, home, testimonials, disclosures,
      investing_enabled: !!investing.enabled,
      redemptions_enabled: !!investing.redemptions_enabled,
      demo_addresses: !!payments.demo_addresses,
      currencies: payments.currencies.filter((c) => c.enabled).map((c) => ({ code: c.code, name: c.name, networks: c.networks.map((n) => ({ code: n.code, name: n.name })) })),
    };
  });

  r.get('/api/public/properties', async (ctx) => {
    const q = ctx.query;
    const where = ["status='published'"];
    const params = [];
    if (q.type && ['residential', 'commercial', 'mixed_use', 'hospitality'].includes(q.type)) { where.push('type=?'); params.push(q.type); }
    if (q.q) {
      where.push('(LOWER(name) LIKE ? OR LOWER(city) LIKE ? OR LOWER(country) LIKE ?)');
      const like = `%${String(q.q).toLowerCase().slice(0, 60)}%`;
      params.push(like, like, like);
    }
    if (q.featured === '1') where.push('featured=1');
    const order = { min_asc: 'min_investment ASC', min_desc: 'min_investment DESC', newest: 'created_at DESC' }[q.sort] || 'featured DESC, created_at DESC';
    const rows = await db.all(`SELECT * FROM properties WHERE ${where.join(' AND ')} ORDER BY ${order}`, params);
    const out = [];
    for (const p of rows) out.push(serializeProperty(p, await raisedFor(p.id)));
    return { items: out };
  });

  r.get('/api/public/properties/:slug', async (ctx) => {
    const p = await db.get("SELECT * FROM properties WHERE slug=? AND status='published'", [ctx.params.slug]);
    if (!p) throw NotFound('Property');
    const docs = await db.all('SELECT d.id, d.title, d.file_id, f.mime, f.size FROM property_documents d JOIN files f ON f.id=d.file_id WHERE d.property_id=? AND d.is_public=1 ORDER BY d.id', [p.id]);
    return {
      property: serializeProperty(p, await raisedFor(p.id)),
      plans: await plansFor(p.id),
      documents: docs.map((d) => ({ id: d.id, title: d.title, mime: d.mime, size: d.size, url: `/api/files/${d.file_id}` })),
    };
  });

  r.get('/api/public/plans', async () => {
    const rows = await db.all('SELECT pl.*, p.name AS property_name FROM plans pl LEFT JOIN properties p ON p.id=pl.property_id ORDER BY pl.sort, pl.duration_months');
    return { items: rows.filter(planAvailable).map(serializePlan) };
  });

  r.get('/api/public/pages/:key', async (ctx) => {
    const allowed = ['about', 'how_it_works', 'faqs', 'legal'];
    if (!allowed.includes(ctx.params.key)) throw NotFound('Page');
    return { content: await getCms(ctx.params.key, null) };
  });

  r.get('/api/public/posts', async () => {
    const rows = await db.all("SELECT id, slug, title, excerpt, published_at FROM posts WHERE status='published' ORDER BY published_at DESC LIMIT 50");
    return { items: rows };
  });
  r.get('/api/public/posts/:slug', async (ctx) => {
    const p = await db.get("SELECT * FROM posts WHERE slug=? AND status='published'", [ctx.params.slug]);
    if (!p) throw NotFound('Article');
    return { post: p };
  });

  r.post('/api/public/contact', async (ctx) => {
    ctx.rateLimit('contact', 5, 3600);
    const b = check(ctx.body, {
      name: { required: true, max: 120 }, email: { type: 'email', required: true }, phone: { max: 40 },
      subject: { required: true, max: 160 }, message: { type: 'text', required: true, min: 10, max: 5000 },
      category: { type: 'enum', values: ['general', 'investment', 'property_enquiry', 'support', 'partnership'] },
      property_id: { type: 'int' },
    });
    if (b.property_id) {
      const p = await db.get("SELECT id FROM properties WHERE id=? AND status='published'", [b.property_id]);
      if (!p) throw new HttpError(422, 'That property is no longer available.');
    }
    const t = now();
    const id = await insert(db, 'tickets', {
      user_id: ctx.user ? ctx.user.id : null, property_id: b.property_id || null, name: b.name, email: b.email, phone: b.phone || null,
      subject: b.subject, category: b.category || (b.property_id ? 'property_enquiry' : 'general'), status: 'open', created_at: t, updated_at: t,
    });
    const ref = await assignRef(db, 'tickets', 'SUP', id, 5000);
    await insert(db, 'ticket_messages', { ticket_id: id, author_id: ctx.user ? ctx.user.id : null, author_type: ctx.user ? 'investor' : 'guest', body: b.message, created_at: t });
    await sendMail(b.email, `We received your message (${ref})`, `Hi ${b.name},\n\nThanks for getting in touch. Your reference is ${ref}. Our team replies within one business day.\n\nEstateInvest`);
    await notifyAdmins(`New ${b.property_id ? 'property enquiry' : 'message'} ${ref}`, b.subject, `/admin/support/${id}`);
    return { ok: true, ref };
  });

  r.get('/api/files/:id', async (ctx) => {
    const f = await db.get('SELECT * FROM files WHERE id=?', [Number(ctx.params.id) || 0]);
    if (!f) throw NotFound('File');
    if (f.visibility !== 'public') {
      if (!ctx.user) throw new HttpError(401, 'Sign in to view this file.');
      let allowed = isAdmin(ctx.user) || f.owner_id === ctx.user.id;
      if (!allowed) {
        const doc = await db.get('SELECT id FROM documents WHERE file_id=? AND (user_id=? OR user_id IS NULL)', [f.id, ctx.user.id]);
        allowed = !!doc;
      }
      if (!allowed) throw new HttpError(403, 'You do not have access to this file.');
    }
    const buf = readUpload(f);
    if (!buf) throw NotFound('File');
    const disp = ctx.query.download === '1' ? 'attachment' : 'inline';
    return new Raw(buf, f.mime, {
      'Content-Disposition': `${disp}; filename="${f.original_name.replace(/"/g, '')}"`,
      'Cache-Control': f.visibility === 'public' ? 'public, max-age=86400' : 'private, no-store',
    });
  });
}

module.exports = { register, serializeProperty, serializePlan, planAvailable, raisedFor };
