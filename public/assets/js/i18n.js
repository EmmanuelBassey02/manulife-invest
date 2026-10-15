import { api } from './api.js';

export const LANGUAGES = [
  ['en', 'English', 'GB'], ['fr', 'French', 'FR'], ['es', 'Spanish', 'ES'], ['ar', 'Arabic', 'SA'], ['pt', 'Portuguese', 'PT'],
  ['de', 'German', 'DE'], ['ga', 'Irish', 'IE'], ['hi', 'Hindi', 'IN'], ['it', 'Italian', 'IT'], ['ja', 'Japanese', 'JP'],
  ['ko', 'Korean', 'KR'], ['ru', 'Russian', 'RU'], ['zh', 'Chinese (Simplified)', 'CN'],
];

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
let failedLanguage = '';
let languageRun = 0;
let queuedText = new WeakSet();
let queuedAttributes = new WeakMap();
const originalText = new WeakMap();
const originalAttributes = new WeakMap();
const translationCache = new Map();
const BATCH_SIZE = 20;
const CONCURRENT_BATCHES = 8;

function addText(node) {
  if (!node || !node.nodeValue.trim() || queuedText.has(node) || node.parentElement?.closest('script,style,noscript,code,pre,textarea,[contenteditable="true"],[data-no-translate]')) return;
  queuedText.add(node);
  if (!originalText.has(node)) originalText.set(node, node.nodeValue);
  pending.add({ node, read: () => node.nodeValue, write: (value) => { node.nodeValue = value; } });
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
    if (!original?.trim() || queued.has(attr)) continue;
    queued.add(attr);
    if (!originals.has(attr)) originals.set(attr, original);
    pending.add({ node: element, read: () => element.getAttribute(attr), write: (value) => element.setAttribute(attr, value), original });
  }
}

function collect(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) addText(walker.currentNode);
  const elements = [...(root.matches?.('[aria-label],[alt],[placeholder],[title]') ? [root] : []), ...root.querySelectorAll('[aria-label],[alt],[placeholder],[title]')];
  elements.forEach(addAttributes);
}

async function translateBatch(lang, texts) {
  const { translations } = await api.post('/api/public/translate', { target: lang, texts });
  if (!Array.isArray(translations) || translations.length !== texts.length) throw new Error('Translation response was incomplete.');
  return translations.map((value) => new DOMParser().parseFromString(value, 'text/html').body.textContent);
}

function applyJob(job, original, translated) {
  if (job.node.isConnected && job.read() === original && translated) job.write(translated);
}

function schedule(root, lang, run = languageRun) {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(async () => {
    try {
      if (lang !== language() || languageRun !== run) return;
      const jobs = [...pending].filter((job) => job.node.isConnected);
      pending.clear();
      const grouped = new Map();
      for (const job of jobs) {
        const original = job.original ?? job.read();
        const key = `${lang}\0${original}`;
        const cached = translationCache.get(key);
        if (cached) {
          applyJob(job, original, cached);
          continue;
        }
        if (!grouped.has(original)) grouped.set(original, []);
        grouped.get(original).push(job);
      }
      const originals = [...grouped.keys()];
      let failed = false;
      for (let i = 0; i < originals.length; i += BATCH_SIZE * CONCURRENT_BATCHES) {
        if (lang !== language() || languageRun !== run) return;
        const chunks = [];
        for (let start = i; start < Math.min(i + BATCH_SIZE * CONCURRENT_BATCHES, originals.length); start += BATCH_SIZE) {
          chunks.push(originals.slice(start, start + BATCH_SIZE));
        }
        const results = await Promise.allSettled(chunks.map((texts) => translateBatch(lang, texts)));
        for (let index = 0; index < results.length; index++) {
          const result = results[index];
          if (result.status === 'rejected') { failed = true; continue; }
          chunks[index].forEach((original, itemIndex) => {
            const translated = result.value[itemIndex];
            translationCache.set(`${lang}\0${original}`, translated);
            if (translationCache.size > 5000) translationCache.delete(translationCache.keys().next().value);
            for (const job of grouped.get(original)) applyJob(job, original, translated);
          });
        }
        if (failed) break;
      }
      if (failed) {
        if (failedLanguage !== lang) {
          failedLanguage = lang;
          window.dispatchEvent(new CustomEvent('translationerror', { detail: new Error('Some text could not be translated. Check that LibreTranslate is still running.') }));
        }
      } else failedLanguage = '';
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
}