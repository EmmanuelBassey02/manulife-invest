'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('../server/config');

const allLocales = ['fr', 'es', 'pt', 'de'];
const locales = process.env.LOCALES ? process.env.LOCALES.split(',').filter((code) => allLocales.includes(code)) : allLocales;
const sourcePath = path.join(config.root, 'messages', 'catalog-source.json');
const outputDir = path.join(config.root, 'messages');
const batchSize = 20;
const concurrency = 1;

async function translate(locale, texts) {
  const response = await fetch(config.LIBRETRANSLATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: texts, source: 'en', target: locale, format: 'text', ...(config.LIBRETRANSLATE_API_KEY ? { api_key: config.LIBRETRANSLATE_API_KEY } : {}) }),
    signal: AbortSignal.timeout(90000),
  });
  const data = await response.json().catch(() => null);
  const result = Array.isArray(data?.translatedText) ? data.translatedText : [data?.translatedText];
  if (!response.ok || result.length !== texts.length || result.some((text) => typeof text !== 'string')) {
    throw new Error(`LibreTranslate failed for ${locale}: HTTP ${response.status} ${JSON.stringify(data)}`);
  }
  return result;
}

async function main() {
  if (!fs.existsSync(sourcePath)) throw new Error('Create messages/catalog-source.json before generating catalogs.');
  const source = [...new Set(JSON.parse(fs.readFileSync(sourcePath, 'utf8')).filter((text) => typeof text === 'string' && text.trim()))];
  const keys = Object.fromEntries(source.map((text, index) => [text, `m${String(index + 1).padStart(4, '0')}`]));
  const english = Object.fromEntries(source.map((text) => [keys[text], text]));
  const catalogs = { en: { legacy: english } };
  for (const locale of allLocales) {
    if (!locales.includes(locale)) {
      try { catalogs[locale] = JSON.parse(fs.readFileSync(path.join(outputDir, `${locale}.json`), 'utf8')); } catch {}
    }
  }
  fs.mkdirSync(outputDir, { recursive: true });
  for (const locale of locales) {
    const translated = Array(source.length);
    const chunks = [];
    for (let start = 0; start < source.length; start += batchSize) chunks.push({ start, texts: source.slice(start, start + batchSize) });
    for (let start = 0; start < chunks.length; start += concurrency) {
      const group = chunks.slice(start, start + concurrency);
      const results = await Promise.all(group.map((chunk) => translate(locale, chunk.texts)));
      group.forEach((chunk, index) => results[index].forEach((text, item) => { translated[chunk.start + item] = text; }));
      process.stdout.write(`\r${locale}: ${Math.min(start + concurrency, chunks.length)}/${chunks.length} batches`);
    }
    process.stdout.write('\n');
    catalogs[locale] = { legacy: Object.fromEntries(source.map((text, index) => [keys[text], translated[index]])) };
  }
  fs.writeFileSync(path.join(outputDir, 'keys.json'), JSON.stringify(keys, null, 2) + '\n');
  for (const [locale, messages] of Object.entries(catalogs)) {
    fs.writeFileSync(path.join(outputDir, `${locale}.json`), JSON.stringify(messages, null, 2) + '\n');
  }
  console.log(`Generated draft catalogs for ${Object.keys(catalogs).length} locales with ${source.length} messages.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});