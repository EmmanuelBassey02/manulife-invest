/* ---------------------------------------------------------------- escaping */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const attr = esc;

/* -------------------------------------------------------------- formatting */
export const money = (n, opts = {}) => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  if (opts.compact && Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (opts.compact && Math.abs(v) >= 1e4) return `$${Math.round(v / 1e3)}K`;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: opts.cents ? 2 : 0, minimumFractionDigits: opts.cents ? 2 : 0 });
};
export const num = (n, dp = 0) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: dp }));
export const crypto = (n, code) => (n == null ? '—' : `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${esc(code)}`);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const date = (d) => { if (!d) return '—'; const x = new Date(d); return Number.isNaN(x.getTime()) ? '—' : `${String(x.getDate()).padStart(2, '0')} ${MON[x.getMonth()]} ${x.getFullYear()}`; };
export const dateTime = (d) => { if (!d) return '—'; const x = new Date(d); return Number.isNaN(x.getTime()) ? '—' : `${date(x)}, ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };
export const ago = (d) => {
  if (!d) return '';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return date(d);
};
export const shortHash = (h, n = 8) => (!h ? '—' : h.length <= n * 2 + 1 ? h : `${h.slice(0, n)}…${h.slice(-6)}`);
export const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const sentence = (s) => { const t = String(s || '').replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
export const duration = (p) => (p.duration_months ? (p.duration_months % 12 === 0 && p.duration_months >= 12 ? `${p.duration_months / 12} year${p.duration_months > 12 ? 's' : ''}` : `${p.duration_months} month${p.duration_months > 1 ? 's' : ''}`) : `${p.duration_days} days`);
export const TYPE_LABEL = { residential: 'Residential', commercial: 'Commercial', mixed_use: 'Mixed use', hospitality: 'Hospitality' };
export const DEV_LABEL = { planning: 'Planning', under_development: 'Under development', completed: 'Completed', operational: 'Operational' };

/* ------------------------------------------------------------------ status */
const TONES = {
  active: 'ok', approved: 'ok', confirmed: 'ok', verified: 'ok', completed: 'info', redeemed: 'info', paid: 'ok', resolved: 'ok', published: 'ok',
  matured: 'info', maturing: 'warn', pending: 'warn', pending_review: 'warn', payment_awaiting: 'warn', awaiting: 'warn', submitted: 'warn',
  requested: 'warn', under_review: 'warn', open: 'warn', requires_info: 'warn', payment_confirmed: 'info', draft: 'muted', closed: 'muted', inactive: 'muted',
  not_started: 'muted', expired: 'muted', cancelled: 'muted', archived: 'muted', unverified: 'muted',
  rejected: 'bad', suspended: 'bad', disputed: 'bad', failed: 'bad',
};
const STATUS_TEXT = {
  payment_awaiting: 'Awaiting payment', payment_confirmed: 'Payment confirmed', pending_review: 'Pending review', requires_info: 'Needs information',
  not_started: 'Not started', under_review: 'Under review', awaiting: 'Awaiting payment', submitted: 'Verifying',
};
export const statusText = (s) => STATUS_TEXT[s] || sentence(s);
export const badge = (s, label) => `<span class="badge badge--${TONES[s] || 'muted'}">${esc(label || statusText(s))}</span>`;

/* ------------------------------------------------------------------- icons */
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M16 13.5h2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 3.1a4 4 0 0 1 0 7.8M22 21a7 7 0 0 0-4-6.3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/>',
  report: '<path d="M4 3h16v18H4z"/><path d="M8 17v-4M12 17V9M16 17v-6"/>',
  audit: '<path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.8 7L3 21l2-6A8 8 0 1 1 21 12Z"/>',
  pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12Z"/><circle cx="12" cy="9" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01"/>',
  camera: '<path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
  pie: '<path d="M21 12A9 9 0 1 1 12 3v9Z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15Z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
};
export const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

export const BRAND_MARK = '<img class="brand__logo" src="/assets/img/logo.png" alt="Manulife Financial Investment Services">';

/* ------------------------------------------------------------------- toast */
export function toast(message, tone = 'ok') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast--${tone}`;
  el.innerHTML = `${icon(tone === 'bad' ? 'alert' : 'check')}<span>${esc(message)}</span>`;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('toast--out'); setTimeout(() => el.remove(), 300); }, 4200);
}

/* ------------------------------------------------------------------- modal */
export function modal({ title, body, size = '', onMount, actions, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `<div class="modal__backdrop" data-close></div>
    <div class="modal__panel ${size ? 'modal__panel--' + size : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header class="modal__head"><h2 id="modal-title">${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></header>
      <div class="modal__body">${body}</div>
      ${actions ? `<footer class="modal__foot">${actions}</footer>` : ''}
    </div>`;
  const prevFocus = document.activeElement;
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('no-scroll');
    if (prevFocus && prevFocus.focus) prevFocus.focus();
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  document.body.classList.add('no-scroll');
  const first = wrap.querySelector('input:not([type=hidden]), select, textarea, button:not([data-close])');
  if (first) first.focus();
  if (onMount) onMount(wrap.querySelector('.modal__panel'), close);
  return close;
}

export function confirmDialog({ title, message, confirm = 'Confirm', tone = 'primary', reason = false, reasonLabel = 'Reason' }) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title,
      body: `<p class="muted">${esc(message)}</p>${reason ? `<div class="field"><label for="cd-reason">${esc(reasonLabel)}</label><textarea id="cd-reason" rows="3" maxlength="500" required></textarea><p class="field__error" hidden></p></div>` : ''}`,
      actions: `<button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--${tone}" data-ok>${esc(confirm)}</button>`,
      onClose() { if (!done) resolve(false); },
      onMount(panel, closeFn) {
        panel.querySelector('[data-ok]').addEventListener('click', () => {
          let val = true;
          if (reason) {
            const ta = panel.querySelector('#cd-reason');
            if (!ta.value.trim()) {
              const er = panel.querySelector('.field__error');
              er.textContent = `Enter a ${reasonLabel.toLowerCase()}.`;
              er.hidden = false;
              ta.focus();
              return;
            }
            val = ta.value.trim();
          }
          done = true;
          resolve(val);
          closeFn();
        });
      },
    });
  });
}

/* ------------------------------------------------------------------- forms */
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.group) { (out[el.name] = out[el.name] || []); if (el.checked) out[el.name].push(el.value); }
      else out[el.name] = el.checked;
    } else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.type === 'file') continue;
    else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

export function clearErrors(form) {
  form.querySelectorAll('.field__error').forEach((e) => { e.hidden = true; e.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
  const g = form.querySelector('.form-error');
  if (g) { g.hidden = true; g.textContent = ''; }
}

export function showErrors(form, err) {
  clearErrors(form);
  const fields = (err && err.fields) || {};
  let first = null;
  for (const [name, msg] of Object.entries(fields)) {
    const el = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!el) continue;
    el.setAttribute('aria-invalid', 'true');
    const holder = el.closest('.field, .check');
    const box = holder && holder.querySelector('.field__error');
    if (box) { box.textContent = msg; box.hidden = false; }
    if (!first) first = el;
  }
  const g = form.querySelector('.form-error');
  const unplaced = Object.keys(fields).filter((n) => !form.querySelector(`[name="${CSS.escape(n)}"]`));
  if (g && (!Object.keys(fields).length || unplaced.length)) {
    g.textContent = unplaced.length ? fields[unplaced[0]] : (err && err.message) || 'Something went wrong.';
    g.hidden = false;
  } else if (!g && (!first)) toast((err && err.message) || 'Something went wrong.', 'bad');
  if (first) first.focus();
}

/** Wire a form: validates with the browser, disables submit while busy, maps API field errors. */
export function bindForm(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    if (!form.checkValidity()) {
      for (const el of form.elements) {
        if (el.willValidate && !el.checkValidity()) {
          el.setAttribute('aria-invalid', 'true');
          const box = el.closest('.field, .check')?.querySelector('.field__error');
          if (box) { box.textContent = el.validationMessage; box.hidden = false; }
        }
      }
      form.querySelector('[aria-invalid]')?.focus();
      return;
    }
    const btn = form.querySelector('[type=submit]');
    btn?.setAttribute('disabled', '');
    btn?.classList.add('is-busy');
    try { await handler(formData(form), form); }
    catch (err) { showErrors(form, err); }
    finally { btn?.removeAttribute('disabled'); btn?.classList.remove('is-busy'); }
  });
}

export const field = ({ name, label, type = 'text', value = '', required = false, placeholder = '', hint = '', attrs = '', options = null, rows = 4, full = false, ico = '' }) => {
  const id = `f-${name}-${Math.random().toString(36).slice(2, 7)}`;
  let control;
  if (options) {
    control = `<select id="${id}" name="${esc(name)}" ${required ? 'required' : ''} ${attrs}>${options.map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(l)}</option>`;
    }).join('')}</select>`;
  } else if (type === 'textarea') {
    control = `<textarea id="${id}" name="${esc(name)}" rows="${rows}" ${required ? 'required' : ''} placeholder="${esc(placeholder)}" ${attrs}>${esc(value)}</textarea>`;
  } else {
    control = `<input id="${id}" name="${esc(name)}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} placeholder="${esc(placeholder)}" ${attrs}>`;
  }
  return `<div class="field ${full ? 'field--full' : ''}"><label for="${id}">${esc(label)}${required ? '' : ' <span class="optional">(optional)</span>'}</label>${ico ? `<div class="inp"><span class="inp__ico">${icon(ico)}</span>${control}</div>` : control}${hint ? `<p class="field__hint">${esc(hint)}</p>` : ''}<p class="field__error" hidden></p></div>`;
};

export const check = ({ name, label, checked = false, required = false, html = false }) =>
  `<div class="check"><label><input type="checkbox" name="${esc(name)}" ${checked ? 'checked' : ''} ${required ? 'required' : ''}><span>${html ? label : esc(label)}</span></label><p class="field__error" hidden></p></div>`;

/* ------------------------------------------------------------------- files */
export function readFile(file, { maxMB = 10, types } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Choose a file to upload.'));
    if (types && !types.includes(file.type)) return reject(new Error(`Upload a ${types.map((t) => t.split('/')[1].toUpperCase()).join(', ')} file.`));
    if (file.size > maxMB * 1024 * 1024) return reject(new Error(`Files must be ${maxMB} MB or smaller.`));
    const r = new FileReader();
    r.onload = () => resolve({ name: file.name, mime: file.type, data: String(r.result).split(',')[1], size: file.size });
    r.onerror = () => reject(new Error('The file could not be read. Try another file.'));
    r.readAsDataURL(file);
  });
}

export async function uploadFile(file, { maxMB = 10, types, purpose } = {}) {
  if (!file) throw new Error('Choose a file to upload.');
  if (types && !types.includes(file.type)) throw new Error(`Upload a ${types.map((t) => t.split('/')[1].toUpperCase()).join(', ')} file.`);
  if (file.size > maxMB * 1024 * 1024) throw new Error(`Files must be ${maxMB} MB or smaller.`);
  if (document.documentElement.dataset.uploadMode === 'blob') {
    if (typeof window.eiBlobUpload !== 'function') throw new Error('Secure upload is still initializing. Refresh the page and try again.');
    return window.eiBlobUpload(file, purpose);
  }
  return readFile(file, { maxMB, types });
}
export const fileSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/* ---------------------------------------------------------------- markdown */
/** Minimal, safe markdown: escapes first, then formats headings, lists, bold, links. */
export function md(src) {
  const lines = esc(src || '').split(/\r?\n/);
  let out = '';
  let list = false;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\[(.+?)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2">$1</a>');
  for (const line of lines) {
    if (/^\s*[-*] /.test(line)) { if (!list) { out += '<ul>'; list = true; } out += `<li>${inline(line.replace(/^\s*[-*] /, ''))}</li>`; continue; }
    if (list) { out += '</ul>'; list = false; }
    if (/^### /.test(line)) out += `<h4>${inline(line.slice(4))}</h4>`;
    else if (/^## /.test(line)) out += `<h3>${inline(line.slice(3))}</h3>`;
    else if (line.trim()) out += `<p>${inline(line)}</p>`;
  }
  if (list) out += '</ul>';
  return out;
}

/* ------------------------------------------------------------------- misc */
export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export const empty = (title, body, action = '') => `<div class="empty">${icon('layers')}<h3>${esc(title)}</h3><p>${esc(body)}</p>${action}</div>`;

export function pager(page, size, total, base) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return `<p class="pager__info">Showing ${total} result${total === 1 ? '' : 's'}</p>`;
  const from = (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  const link = (p, label, dis) => (dis ? `<span class="pager__btn is-disabled">${label}</span>` : `<a class="pager__btn ${p === page ? 'is-current' : ''}" href="${base(p)}">${label}</a>`);
  const nums = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p++) nums.push(link(p, p, false));
  return `<div class="pager"><p class="pager__info">Showing ${from}–${to} of ${num(total)}</p><div class="pager__nav">${link(page - 1, icon('chevronLeft'), page === 1)}${nums.join('')}${link(page + 1, icon('chevronRight'), page === pages)}</div></div>`;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied to clipboard'); } catch { toast('Copy failed. Select the text and copy it manually.', 'bad'); }
    ta.remove();
  }
}

export const initials = (u) => `${(u?.first_name || '?')[0]}${(u?.last_name || '')[0] || ''}`.toUpperCase();
