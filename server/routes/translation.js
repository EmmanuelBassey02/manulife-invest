'use strict';
// Translates text that is not in the built-in catalogs (public/assets/i18n/*.json), such as properties,
// plans, news and website content added by administrators. Results are stored in the `translations`
// table, so each sentence is sent to the translation service only once.
//
// Services (optional): DEEPL_API_KEY (recommended; the free plan is enough) or LIBRETRANSLATE_URL.
// Without one, untranslated text simply stays in English.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const { db } = require('../db');
const { HttpError, now } = require('../lib/util');

const LANGUAGES = new Set(['fr', 'es', 'pt', 'de']);
const DEEPL_TARGET = { fr: 'FR', es: 'ES', pt: 'PT-BR', de: 'DE' };
const catalogs = new Map();
const memory = new Map();

function catalog(lang) {
  if (!catalogs.has(lang)) {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(path.join(config.root, 'public', 'assets', 'i18n', `${lang}.json`), 'utf8')); } catch { /* none */ }
    catalogs.set(lang, data);
  }
  return catalogs.get(lang);
}

function provider() {
  if (process.env.DEEPL_API_KEY) return 'deepl';
  if (process.env.LIBRETRANSLATE_URL) return 'libretranslate';
  return null;
}

/* Only text that appears in our own content or code is sent to the paid service (prevents misuse of the key). */
let corpus = { text: '', names: new Set(), at: 0 };
function readSources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) readSources(full, out);
    else if (entry.name.endsWith('.js')) out.push(fs.readFileSync(full, 'utf8'));
  }
  return out;
}
async function contentCorpus(userId, fresh = false) {
  if (Date.now() - corpus.at > (fresh ? 10 * 1000 : 5 * 60 * 1000)) {
    const parts = [];
    for (const dir of ['public/assets/js', 'server']) { try { parts.push(...readSources(path.join(config.root, dir))); } catch { /* not bundled */ } }
    const rows = await Promise.all([
      db.all("SELECT name, summary, description, details, highlights, risks, city, country FROM properties WHERE status='published'"),
      db.all("SELECT name, description, terms, risk_info, return_note, required_docs FROM plans WHERE status='active'"),
      db.all("SELECT title, excerpt, body FROM posts WHERE status='published'"),
      db.all('SELECT value FROM cms'),
    ]);
    for (const list of rows) for (const row of list) parts.push(Object.values(row).filter(Boolean).join('\n'));
    // Property names and the brand are proper names: they are shown as written.
    const names = new Set(['Manulife', 'Manulife Financial Investment', ...rows[0].map((p) => p.name)]);
    corpus = { text: parts.join('\n'), names, at: Date.now() };
  }
  let text = corpus.text;
  if (userId) {
    const own = await db.all('SELECT title, body FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 200', [userId]);
    text += own.map((n) => `${n.title}\n${n.body || ''}`).join('\n');
  }
  return text;
}

async function viaDeepl(texts, lang) {
  const key = process.env.DEEPL_API_KEY;
  const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const res = await fetch(`${host}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texts, source_lang: 'EN', target_lang: DEEPL_TARGET[lang], preserve_formatting: true }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => null);
  const out = data?.translations?.map((t) => t.text);
  if (!res.ok || !Array.isArray(out) || out.length !== texts.length) throw new Error(`DeepL responded ${res.status}`);
  return out;
}

async function viaLibre(texts, lang) {
  const res = await fetch(process.env.LIBRETRANSLATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: texts, source: 'en', target: lang, format: 'text', ...(config.LIBRETRANSLATE_API_KEY ? { api_key: config.LIBRETRANSLATE_API_KEY } : {}) }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => null);
  const out = Array.isArray(data?.translatedText) ? data.translatedText : [data?.translatedText];
  if (!res.ok || out.length !== texts.length || out.some((t) => typeof t !== 'string')) throw new Error(`LibreTranslate responded ${res.status}`);
  return out;
}

const hash = (lang, text) => crypto.createHash('sha256').update(`${lang}\0${text}`).digest('hex');

function register(r) {
  r.post('/api/public/translate', async (ctx) => {
    ctx.rateLimit('translate', 240, 60);
    const body = ctx.body || {};
    if (!LANGUAGES.has(body.target) || !Array.isArray(body.texts) || body.texts.length > 20) throw new HttpError(422, 'Invalid translation request.');
    const texts = body.texts;
    if (texts.some((text) => typeof text !== 'string' || text.length > 5000) || texts.join('').length > 20000) throw new HttpError(422, 'Translation request is too large.');
    const lang = body.target;
    const fixed = catalog(lang);
    const translations = Array(texts.length);
    const missing = [];
    for (const [index, text] of texts.entries()) {
      const key = `${lang}\0${text}`;
      if (typeof fixed[text] === 'string') translations[index] = fixed[text];
      else if (memory.has(key)) translations[index] = memory.get(key);
      else missing.push({ index, text, key, id: hash(lang, text) });
    }
    if (missing.length) {
      const stored = await db.all(`SELECT source_hash, translated FROM translations WHERE lang=? AND source_hash IN (${missing.map(() => '?').join(',')})`, [lang, ...missing.map((m) => m.id)]);
      const byHash = new Map(stored.map((row) => [row.source_hash, row.translated]));
      for (const m of missing) if (byHash.has(m.id)) { translations[m.index] = byHash.get(m.id); memory.set(m.key, byHash.get(m.id)); }
    }
    let todo = missing.filter((m) => translations[m.index] === undefined);
    const service = provider();
    if (todo.length && service) {
      let known = await contentCorpus(ctx.user?.id);
      // Content an administrator has just added may not be in the cached list yet.
      if (todo.some((m) => !known.includes(m.text))) known = await contentCorpus(ctx.user?.id, true);
      const allowed = todo.filter((m) => known.includes(m.text) && !corpus.names.has(m.text));
      for (const m of todo) if (!allowed.includes(m)) translations[m.index] = m.text;
      todo = allowed;
      if (todo.length) {
        try {
          const out = await (service === 'deepl' ? viaDeepl : viaLibre)(todo.map((m) => m.text), lang);
          for (const [i, m] of todo.entries()) {
            translations[m.index] = out[i];
            memory.set(m.key, out[i]);
            await db.run(
              'INSERT INTO translations (lang, source_hash, source, translated, provider, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT (lang, source_hash) DO NOTHING',
              [lang, m.id, m.text, out[i], service, now()],
            );
          }
        } catch (error) {
          console.error('[translation]', error.message);
          for (const m of todo) translations[m.index] = m.text;
          return { translations, provider: false };
        }
      }
    }
    for (const [i, t] of translations.entries()) if (t === undefined) translations[i] = texts[i];
    if (memory.size > 20000) memory.clear();
    return { translations, provider: !!service };
  });
}

module.exports = { register };
