import { api } from './api.js';

export const LANGUAGES = [
  ['en', 'English', 'GB'], ['fr', 'Français', 'FR'], ['es', 'Español', 'ES'], ['pt', 'Português', 'PT'], ['de', 'Deutsch', 'DE'],
];

/** BCP 47 locale used for dates in each language. */
export const LOCALES = { en: 'en-GB', fr: 'fr-FR', es: 'es-ES', pt: 'pt-BR', de: 'de-DE' };

const flag = (country) => String.fromCodePoint(...country.split('').map((letter) => 127397 + letter.charCodeAt(0)));

export function language() {
  try {
    const saved = localStorage.getItem('ei_language');
    return LANGUAGES.some(([code]) => code === saved) ? saved : 'en';
  } catch { return 'en'; }
}

export function languagePicker() {
  const selected = language();
  const current = LANGUAGES.find(([code]) => code === selected) || LANGUAGES[0];
  const image = (country) => `<img class="language-picker__flag" src="/assets/img/flags/${country.toLowerCase()}.svg" alt="" aria-hidden="true">`;
  return `<div class="language-picker" data-language-picker data-no-translate>
    <button class="language-picker__trigger" type="button" data-language-toggle aria-haspopup="listbox" aria-expanded="false" aria-label="Choose language: ${current[1]}"><span>${current[1]}</span>${image(current[2])}<span class="language-picker__caret" aria-hidden="true"></span></button>
    <div class="language-picker__menu" role="listbox" aria-label="Choose language" hidden>${LANGUAGES.map(([code, name, country]) => `<button class="language-picker__option" type="button" role="option" aria-selected="${code === selected}" data-language-option="${code}"><span>${name}</span>${image(country)}</button>`).join('')}</div>
  </div>`;
}

let observer;
let pending = new Set();
let scheduled = false;
let languageRun = 0;
let queuedText = new WeakSet();
let queuedAttributes = new WeakMap();
const originalText = new WeakMap();
const originalAttributes = new WeakMap();
let written = new WeakMap(); // node -> Map(slot -> text we wrote), so translated text isn't treated as new text
const translationCache = new Map();
const catalogLoads = new Map();
const patterns = new Map(); // lang -> [{ re, translation, literal }]
const serverOff = new Set(); // languages the server cannot translate further this session
const BATCH_SIZE = 20;
const CONCURRENT_BATCHES = 4;
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Catalog keys may contain placeholders such as "{0} unread"; they become patterns. */
function addPattern(lang, key, translation) {
  const parts = key.split(/\{\d\}/);
  const order = [...key.matchAll(/\{(\d)\}/g)].map((m) => Number(m[1]));
  const re = new RegExp(`^${parts.map(escapeRe).join('([\\s\\S]+?)')}$`);
  const list = patterns.get(lang) || [];
  const literal = parts.join('').length;
  list.push({ re, order, translation, literal, generic: literal <= 4 && /^\{\d\}/.test(key) && /\{\d\}$|\{\d\}\)$/.test(key) });
  patterns.set(lang, list);
}

function loadCatalog(lang) {
  if (!catalogLoads.has(lang)) {
    const load = fetch(`/assets/i18n/${lang}.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load ${lang} translations.`);
        return response.json();
      })
      .then((catalog) => {
        for (const [text, translated] of Object.entries(catalog)) {
          if (/\{\d\}/.test(text)) addPattern(lang, text, translated);
          else translationCache.set(`${lang}\0${text}`, translated);
        }
        patterns.get(lang)?.sort((a, b) => b.literal - a.literal);
      })
      .catch((error) => {
        catalogLoads.delete(lang);
        throw error;
      });
    catalogLoads.set(lang, load);
  }
  return catalogLoads.get(lang);
}

/** Exact match first, then a pattern such as "{0} unread". Values inside a pattern are translated when known. */
function lookup(lang, text, depth = 0) {
  const exact = translationCache.get(`${lang}\0${text}`);
  if (exact !== undefined) return exact;
  if (depth > 2) return undefined;
  for (const p of patterns.get(lang) || []) {
    const m = text.match(p.re);
    if (!m) continue;
    let known = 0;
    const values = m.slice(1).map((v) => { const t = lookup(lang, v.trim(), depth + 1); if (t !== undefined) known += 1; return t ?? v; });
    // Separator-only patterns such as "{0} · {1}" apply only when part of the text is actually translated.
    if (p.generic && !known) continue;
    return p.translation.replace(/\{(\d)\}/g, (_, i) => values[p.order.indexOf(Number(i))] ?? '');
  }
  return undefined;
}

/** Codes, amounts, references, hashes, e-mail addresses and file names are left as they are. */
function worthTranslating(text) {
  if (!/[A-Za-zÀ-ÿ]{2}/.test(text)) return false;
  if (!/\s/.test(text) && text.length >= 12) return false;
  if (/^[A-Z0-9][A-Z0-9 ._\-:/()+…·,$%]*$/.test(text)) return false;
  if (/^[\d.,\s]+[A-Z]{2,6}$/.test(text)) return false;
  if (/^\S+@\S+\.\S+$/.test(text)) return false;
  if (/^[\w.-]+\.(png|jpe?g|webp|pdf)$/i.test(text)) return false;
  return true;
}

const wasWritten = (node, slot, value) => written.get(node)?.get(slot) === value;
function remember(node, slot, value) {
  let m = written.get(node);
  if (!m) { m = new Map(); written.set(node, m); }
  m.set(slot, value);
}

function addText(node) {
  if (node && wasWritten(node, '#text', node.nodeValue)) return;
  if (!node || !node.nodeValue.trim() || queuedText.has(node) || node.parentElement?.closest('script,style,noscript,code,pre,textarea,[contenteditable="true"],[data-no-translate]')) return;
  queuedText.add(node);
  if (!originalText.has(node)) originalText.set(node, node.nodeValue);
  pending.add({ node, read: () => node.nodeValue, write: (value) => { node.nodeValue = value; remember(node, '#text', value); } });
}

function addAttributes(element) {
  if (element.closest('[data-no-translate]')) return;
  const attrs = ['aria-label', 'alt', 'placeholder', 'title'];
  let queued = queuedAttributes.get(element);
  if (!queued) { queued = new Set(); queuedAttributes.set(element, queued); }
  let originals = originalAttributes.get(element);
  if (!originals) { originals = new Map(); originalAttributes.set(element, originals); }
  for (const attr of attrs) {
    const original = element.getAttribute(attr);
    if (!original?.trim() || queued.has(attr) || wasWritten(element, attr, original)) continue;
    queued.add(attr);
    if (!originals.has(attr)) originals.set(attr, original);
    pending.add({ node: element, read: () => element.getAttribute(attr), write: (value) => { element.setAttribute(attr, value); remember(element, attr, value); }, original });
  }
}

function collect(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) addText(walker.currentNode);
  const elements = [...(root.matches?.('[aria-label],[alt],[placeholder],[title]') ? [root] : []), ...root.querySelectorAll('[aria-label],[alt],[placeholder],[title]')];
  elements.forEach(addAttributes);
}

/** Asks the server for text missing from the catalog (e.g. content added by an administrator). */
async function translateBatch(lang, texts) {
  const res = await api.post('/api/public/translate', { target: lang, texts });
  if (!Array.isArray(res?.translations) || res.translations.length !== texts.length) throw new Error('Translation response was incomplete.');
  if (res.provider === false) serverOff.add(lang);
  return res.translations.map((value) => new DOMParser().parseFromString(value, 'text/html').body.textContent);
}

function applyJob(job, original, translated) {
  if (job.node.isConnected && job.read() === original && translated) job.write(translated);
}

function preserveWhitespace(original, translated) {
  const leading = original.slice(0, original.length - original.trimStart().length);
  const trailing = original.slice(original.trimEnd().length);
  return `${leading}${translated}${trailing}`;
}

function schedule(root, lang, run = languageRun) {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(async () => {
    try {
      if (lang !== language() || languageRun !== run) return;
      await loadCatalog(lang).catch(() => {});
      if (lang !== language() || languageRun !== run) return;
      const jobs = [...pending].filter((job) => job.node.isConnected);
      pending.clear();
      const grouped = new Map();
      for (const job of jobs) {
        const original = job.original ?? job.read();
        const normalized = original.trim();
        const found = lookup(lang, normalized);
        if (found !== undefined) { applyJob(job, original, preserveWhitespace(original, found)); continue; }
        if (!worthTranslating(normalized) || serverOff.has(lang)) continue;
        if (!grouped.has(normalized)) grouped.set(normalized, []);
        grouped.get(normalized).push(job);
      }
      const originals = [...grouped.keys()];
      for (let i = 0; i < originals.length && !serverOff.has(lang); i += BATCH_SIZE * CONCURRENT_BATCHES) {
        if (lang !== language() || languageRun !== run) return;
        const chunks = [];
        for (let start = i; start < Math.min(i + BATCH_SIZE * CONCURRENT_BATCHES, originals.length); start += BATCH_SIZE) {
          chunks.push(originals.slice(start, start + BATCH_SIZE));
        }
        const results = await Promise.allSettled(chunks.map((texts) => translateBatch(lang, texts)));
        let failed = false;
        results.forEach((result, index) => {
          if (result.status === 'rejected') { failed = true; return; }
          chunks[index].forEach((original, itemIndex) => {
            const translated = result.value[itemIndex];
            translationCache.set(`${lang}\0${original}`, translated);
            if (translationCache.size > 20000) translationCache.delete(translationCache.keys().next().value);
            for (const job of grouped.get(original)) {
              const jobOriginal = job.original ?? job.read();
              applyJob(job, jobOriginal, preserveWhitespace(jobOriginal, translated));
            }
          });
        });
        if (failed) break; // offline or server busy: leave the rest in English rather than retrying endlessly
      }
    } finally {
      scheduled = false;
      if (pending.size) schedule(root, language());
    }
  });
}

export function applyLanguage(root, enabled = true) {
  languageRun++;
  const lang = language();
  document.documentElement.lang = lang;
  document.documentElement.dir = ['ar', 'fa', 'ur', 'he'].includes(lang) ? 'rtl' : 'ltr';
  observer?.disconnect();
  pending.clear();
  queuedText = new WeakSet();
  queuedAttributes = new WeakMap();
  if (!enabled) {
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    return;
  }
  if (lang === 'en') return;
  collect(root);
  const title = document.querySelector('title');
  if (title && !queuedText.has(title)) {
    queuedText.add(title);
    pending.add({ node: title, read: () => title.textContent, write: (value) => { title.textContent = value; } });
  }
  schedule(root, lang, languageRun);
  observer = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType === Node.TEXT_NODE) addText(node);
      else if (node.nodeType === Node.ELEMENT_NODE) collect(node);
    }
    if (pending.size) schedule(root, lang, languageRun);
  });
  observer.observe(root, { childList: true, subtree: true });
}

export function resetTranslations(root) {
  languageRun++;
  observer?.disconnect();
  pending.clear();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (originalText.has(node)) node.nodeValue = originalText.get(node);
  }
  const elements = [...(root.matches?.('[aria-label],[alt],[placeholder],[title]') ? [root] : []), ...root.querySelectorAll('[aria-label],[alt],[placeholder],[title]')];
  for (const element of elements) {
    const originals = originalAttributes.get(element);
    if (originals) for (const [attr, value] of originals) element.setAttribute(attr, value);
  }
  queuedText = new WeakSet();
  queuedAttributes = new WeakMap();
  written = new WeakMap();
}