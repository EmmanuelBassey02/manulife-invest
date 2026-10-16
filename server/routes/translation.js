'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { HttpError } = require('../lib/util');

const LANGUAGES = new Set(['fr', 'es', 'pt', 'de']);
const cache = new Map();
const catalogs = new Map();

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(config.root, 'messages', file), 'utf8')); } catch { return null; }
}

// Pre-generated catalogs (scripts/generate-next-intl-catalogs.js) avoid needing a live LibreTranslate.
function catalogLookup(target) {
  if (!catalogs.has('keys')) catalogs.set('keys', readJson('keys.json') || {});
  if (!catalogs.has(target)) catalogs.set(target, readJson(`${target}.json`)?.legacy || {});
  const keys = catalogs.get('keys');
  const messages = catalogs.get(target);
  return (text) => messages[keys[text]];
}

function register(r) {
  r.post('/api/public/translate', async (ctx) => {
    ctx.rateLimit('translate', 30, 60);
    const body = ctx.body || {};
    if (!LANGUAGES.has(body.target) || !Array.isArray(body.texts) || body.texts.length > 20) {
      throw new HttpError(422, 'Invalid translation request.');
    }
    const texts = body.texts;
    if (texts.some((text) => typeof text !== 'string' || text.length > 5000) || texts.join('').length > 12000) {
      throw new HttpError(422, 'Translation request is too large.');
    }
    const translations = Array(texts.length);
    const missing = [];
    const fromCatalog = catalogLookup(body.target);
    texts.forEach((text, index) => {
      const key = `${body.target}\0${text}`;
      const prebuilt = fromCatalog(text);
      if (typeof prebuilt === 'string') translations[index] = prebuilt;
      else if (cache.has(key)) translations[index] = cache.get(key);
      else if (config.isVercel && !process.env.LIBRETRANSLATE_URL) translations[index] = text;
      else missing.push({ index, key, text });
    });
    if (missing.length) {
      let response;
      try {
        response = await fetch(config.LIBRETRANSLATE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            q: missing.map((item) => item.text), source: 'en', target: body.target, format: 'text',
            ...(config.LIBRETRANSLATE_API_KEY ? { api_key: config.LIBRETRANSLATE_API_KEY } : {}),
          }),
          signal: AbortSignal.timeout(90000),
        });
      } catch {
        throw new HttpError(502, 'Could not reach LibreTranslate. Start the service and check LIBRETRANSLATE_URL.');
      }
      const result = await response.json().catch(() => null);
      const translatedTexts = Array.isArray(result?.translatedText) ? result.translatedText : [result?.translatedText];
      if (!response.ok || translatedTexts.length !== missing.length || translatedTexts.some((text) => typeof text !== 'string')) {
        console.error('[translation] LibreTranslate request failed:', response.status);
        throw new HttpError(502, 'LibreTranslate could not translate this request. Check that the target language model is installed.');
      }
      translatedTexts.forEach((translated, index) => {
        const entry = missing[index];
        translations[entry.index] = translated;
        cache.set(entry.key, translated);
        if (cache.size > 10000) cache.delete(cache.keys().next().value);
      });
    }
    return { translations };
  });
}

module.exports = { register };