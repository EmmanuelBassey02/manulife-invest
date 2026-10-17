import { api } from './api.js';
import { esc, icon, BRAND_MARK, initials, toast } from './ui.js';
import { applyLanguage, languagePicker, LANGUAGES, resetTranslations } from './i18n.js';
import * as Pub from './pages/public.js';
import * as Auth from './pages/auth.js';
import * as Inv from './pages/investor.js';
import * as Adm from './pages/admin.js';

export const state = { user: null, site: null, unread: 0 };

const routes = [
  ['/', Pub.home, 'public'], ['/properties', Pub.properties, 'public'], ['/properties/:slug', Pub.property, 'public'],
  ['/plans', Pub.plans, 'public'], ['/how-it-works', Pub.howItWorks, 'public'], ['/about', Pub.about, 'public'],
  ['/faqs', Pub.faqs, 'public'], ['/contact', Pub.contact, 'public'], ['/legal/:doc', Pub.legal, 'public'],
  ['/news', Pub.news, 'public'], ['/news/:slug', Pub.post, 'public'],

  ['/login', Auth.login, 'auth'], ['/register', Auth.register, 'auth'], ['/forgot-password', Auth.forgot, 'auth'],
  ['/reset-password', Auth.reset, 'auth'], ['/verify-email', Auth.verifyEmail, 'auth'], ['/verify-pending', Auth.verifyPending, 'auth', 'user'],

  ['/app', Inv.dashboard, 'app', 'investor'], ['/app/investments', Inv.investments, 'app', 'investor'], ['/app/investments/:id', Inv.investment, 'app', 'investor'],
  ['/app/invest', Inv.invest, 'app', 'investor'], ['/app/properties', Inv.properties, 'app', 'investor'], ['/app/properties/:slug', Inv.properties, 'app', 'investor'], ['/app/transactions', Inv.transactions, 'app', 'investor'],
  ['/app/documents', Inv.documents, 'app', 'investor'], ['/app/redemptions', Inv.redemptions, 'app', 'investor'], ['/app/notifications', Inv.notifications, 'app', 'investor'],
  ['/app/kyc', Inv.kyc, 'app', 'investor'], ['/app/support', Inv.support, 'app', 'investor'], ['/app/support/:id', Inv.ticket, 'app', 'investor'],
  ['/app/settings', Inv.settings, 'app', 'investor'],

  ['/admin', Adm.dashboard, 'admin', 'admin'], ['/admin/investors', Adm.investors, 'admin', 'admin'], ['/admin/investors/:id', Adm.investor, 'admin', 'admin'],
  ['/admin/kyc', Adm.kycList, 'admin', 'admin'], ['/admin/kyc/:id', Adm.kycReview, 'admin', 'admin'], ['/admin/investments', Adm.investments, 'admin', 'admin'],
  ['/admin/investments/:id', Adm.investment, 'admin', 'admin'], ['/admin/properties', Adm.properties, 'admin', 'admin'], ['/admin/properties/:id', Adm.propertyEdit, 'admin', 'admin'],
  ['/admin/plans', Adm.plans, 'admin', 'admin'], ['/admin/payments', Adm.payments, 'admin', 'admin'], ['/admin/redemptions', Adm.redemptions, 'admin', 'admin'],
  ['/admin/support', Adm.tickets, 'admin', 'admin'], ['/admin/support/:id', Adm.ticket, 'admin', 'admin'], ['/admin/documents', Adm.documents, 'admin', 'admin'],
  ['/admin/content', Adm.content, 'admin', 'admin'], ['/admin/news', Adm.news, 'admin', 'admin'], ['/admin/reports', Adm.reports, 'admin', 'admin'],
  ['/admin/audit', Adm.audit, 'admin', 'admin'], ['/admin/admins', Adm.admins, 'admin', 'super'], ['/admin/settings', Adm.settings, 'admin', 'super'],
  ['/admin/emails', Adm.emails, 'admin', 'super'], ['/admin/account', Adm.account, 'admin', 'admin'], ['/admin/notifications', Inv.notifications, 'admin', 'admin'],
].map(([path, page, layout, guard]) => {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { path, page, layout, guard, re, keys };
});

export function navigate(to, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', to);
  else history.pushState({}, '', to);
  render();
}

export async function refreshUser() {
  try { state.user = (await api.get('/api/auth/me')).user; } catch { state.user = null; }
  return state.user;
}

export async function refreshUnread() {
  if (!state.user) return false;
  const prev = state.unread;
  try { state.unread = (await api.get('/api/me/notifications')).unread; } catch { /* ignore */ }
  document.querySelectorAll('[data-unread]').forEach((el) => { el.textContent = state.unread; el.hidden = !state.unread; });
  return state.unread !== prev;
}

// Re-renders the page when the polled data changes.
export function liveReload(ctx, url, pick, initial) {
  let last = JSON.stringify(pick(initial));
  return async () => {
    const sig = JSON.stringify(pick(await api.get(url)));
    if (sig === last) return;
    last = sig;
    if (!document.querySelector('.modal')) ctx.reload();
  };
}

let liveTimer = null;

// Pages whose data changes when an admin confirms a payment.
const LIVE = /^\/app(\/investments(\/\d+)?|\/transactions)?$/;
async function livePoll() {
  if (!state.user || document.hidden) return;
  const changed = await refreshUnread();
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (changed && LIVE.test(path) && !typing && !document.querySelector('.modal')) render();
}

export async function logout() {
  try { await api.post('/api/auth/logout'); } catch { /* ignore */ }
  state.user = null;
  toast('You are signed out.');
  navigate('/');
}

const isAdmin = (u) => u && (u.role === 'admin' || u.role === 'super_admin');
const homeFor = (u) => (!u ? '/' : isAdmin(u) ? '/admin' : '/app');

/* ------------------------------------------------------------------ layouts */
function publicLayout(content, path) {
  const s = state.site?.site || {};
  const nav = [['/properties', 'Properties'], ['/plans', 'Investment Plans'], ['/how-it-works', 'How It Works'], ['/about', 'About'], ['/faqs', 'FAQs'], ['/contact', 'Contact']];
  const solid = path !== '/';
  const disclosure = state.site?.disclosures?.footer || '';
  return `<a class="skip" href="#main">Skip to content</a>
  <header class="site-head ${solid ? 'site-head--solid' : ''}">
    <div class="wrap site-head__in">
      <a class="brand" href="/">${BRAND_MARK}</a>
      <nav class="site-nav" id="site-nav" aria-label="Main">
        ${nav.map(([h, l]) => `<a href="${h}" ${path.startsWith(h) ? 'aria-current="page"' : ''}>${l}</a>`).join('')}
        <div class="site-nav__cta">${languagePicker()}${state.user
          ? `<a class="btn btn--gold" href="${homeFor(state.user)}">Go to dashboard</a>`
          : '<a class="btn btn--outline-light" href="/login">Login</a><a class="btn btn--gold" href="/register">Start Investing</a>'}</div>
      </nav>
      <div class="site-nav-scrim" data-nav-close></div>
      <button class="icon-btn site-head__toggle" aria-expanded="false" aria-controls="site-nav" data-nav-toggle aria-label="Open menu">${icon('menu')}</button>
    </div>
  </header>
  <main id="main" tabindex="-1">${content}</main>
  <footer class="site-foot">
    <div class="wrap site-foot__grid">
      <div class="site-foot__brand">
        <a class="brand" href="/">${BRAND_MARK}</a>
        <p>${esc(s.address || '')}</p>
        <p><a href="mailto:${esc(s.email || '')}">${esc(s.email || '')}</a><br>${esc(s.phone || '')}</p>
        ${s.whatsapp ? `<a class="btn btn--outline-light btn--sm" href="https://wa.me/${esc(String(s.whatsapp).replace(/\D/g, ''))}" target="_blank" rel="noopener">${icon('chat')} Chat on WhatsApp</a>` : ''}
      </div>
      <div><h4>Invest</h4><a href="/properties">Properties</a><a href="/plans">Investment plans</a><a href="/how-it-works">How it works</a><a href="/register">Create account</a></div>
      <div><h4>Company</h4><a href="/about">About us</a><a href="/news">News</a><a href="/faqs">FAQs</a><a href="/contact">Contact</a></div>
      <div><h4>Legal</h4><a href="/legal/terms">Terms &amp; Conditions</a><a href="/legal/privacy">Privacy Policy</a><a href="/legal/risk">Risk Disclosure</a><a href="/legal/kyc_aml">KYC / AML Policy</a><a href="/legal/redemption">Redemption Policy</a><a href="/legal/crypto">Crypto Payment Disclosure</a></div>
    </div>
    <div class="wrap site-foot__legal"><p>${esc(disclosure)}</p><p>${esc(s.registration || '')}</p><p>© ${new Date().getFullYear()} ${esc(s.brand || 'EstateInvest')}. All rights reserved.</p></div>
  </footer>`;
}

function authLayout(content) {
  return `<a class="skip" href="#main">Skip to content</a><div class="auth">
    <aside class="auth__art" aria-hidden="true"><div class="auth__art-img" data-auth-art></div><div class="auth__art-copy">
      <div class="auth__top-l"><a class="brand brand--light" href="/">${BRAND_MARK}</a><span class="auth__tag">Secure <i>•</i> Transparent <i>•</i> Premium</span></div>
      <div class="auth__pitch">
        <p class="auth__kicker">Real estate investment platform</p>
        <h2 class="auth__h">Invest in<br><span>Real Assets.</span></h2>
        <p class="auth__sub">Carefully structured real estate opportunities, tracked from one secure and transparent platform.</p>
        <ul class="auth__feats"><li><span>${icon('shield')}</span>Secure &amp; Regulated</li><li><span>${icon('chart')}</span>Transparent Records</li><li><span>${icon('building')}</span>Premium Opportunities</li></ul>
      </div>
      <blockquote class="auth__quote-card"><p>“Real estate creates generational wealth.”</p><small>Invest today. Build tomorrow.</small></blockquote></div></aside>
    <main id="main" class="auth__main" tabindex="-1"><div class="auth__language">${languagePicker()}</div><a class="brand auth__brand-m" href="/">${BRAND_MARK}</a>${content}</main></div>`;
}

const INVESTOR_NAV = [
  ['/app', 'Overview', 'home'], ['/app/investments', 'Investments', 'chart'], ['/app/properties', 'Properties', 'building'],
  ['/app/transactions', 'Transactions', 'list'], ['/app/documents', 'Documents', 'file'], ['/app/redemptions', 'Redemptions', 'refresh'],
  ['/app/notifications', 'Notifications', 'bell', true], ['/app/kyc', 'Verification', 'shield'], ['/app/support', 'Support', 'help'],
];
const ADMIN_NAV = [
  ['/admin', 'Dashboard', 'home'], ['/admin/investors', 'Investors', 'users', null, 'investors'], ['/admin/kyc', 'KYC Reviews', 'shield', null, 'kyc'],
  ['/admin/investments', 'Investments', 'chart', null, 'investments'], ['/admin/properties', 'Properties', 'building', null, 'properties'],
  ['/admin/plans', 'Investment Plans', 'layers', null, 'plans'], ['/admin/payments', 'Payments', 'card', null, 'payments'],
  ['/admin/redemptions', 'Redemptions', 'refresh', null, 'redemptions'], ['/admin/support', 'Support', 'help', null, 'support'],
  ['/admin/documents', 'Documents', 'file', null, 'documents'], ['/admin/content', 'Website Content', 'edit', null, 'content'],
  ['/admin/news', 'News', 'globe', null, 'content'], ['/admin/reports', 'Reports', 'report', null, 'reports'], ['/admin/audit', 'Audit Logs', 'audit'],
];
const SUPER_NAV = [['/admin/admins', 'Administrators', 'key'], ['/admin/settings', 'Platform Settings', 'settings'], ['/admin/emails', 'Email Log', 'mail']];

function navLink([href, label, ico, unread], path) {
  const root = href === '/app' || href === '/admin';
  const cur = root ? path === href : path === href || path.startsWith(href + '/');
  return `<a href="${href}" class="side-nav__link" ${cur ? 'aria-current="page"' : ''}>${icon(ico)}<span>${label}</span>${unread ? `<b class="pill" data-unread ${state.unread ? '' : 'hidden'}>${state.unread}</b>` : ''}</a>`;
}

function appLayout(content, path, kind) {
  const u = state.user;
  const perms = u.permissions;
  let links = kind === 'admin' ? ADMIN_NAV.filter((l) => !l[4] || u.role === 'super_admin' || !Array.isArray(perms) || perms.includes(l[4])) : INVESTOR_NAV;
  if (kind === 'admin' && u.role === 'super_admin') links = [...links, ...SUPER_NAV];
  const settingsHref = kind === 'admin' ? '/admin/account' : '/app/settings';
  const roleLabel = u.role === 'super_admin' ? 'Super Admin' : u.role === 'admin' ? 'Admin' : 'Investor';
  return `<a class="skip" href="#main">Skip to content</a><div class="shell shell--${kind}">
  <aside class="side" id="side" aria-label="Sidebar">
    <a class="brand brand--light" href="${kind === 'admin' ? '/admin' : '/app'}">${BRAND_MARK}</a>
    <nav class="side-nav">${links.map((l) => navLink(l, path)).join('')}</nav>
    <nav class="side-nav side-nav--foot">
      ${kind === 'app' ? `<a href="/app/invest" class="btn btn--gold btn--block side__cta">${icon('plus')} New investment</a>` : ''}
      ${navLink([settingsHref, 'Settings', 'settings'], path)}
      <a href="/" class="side-nav__link">${icon('globe')}<span>View website</span></a>
      <button class="side-nav__link" data-logout>${icon('logout')}<span>Logout</span></button>
    </nav>
  </aside>
  <div class="side-scrim" data-side-close></div>
  <div class="shell__main">
    <header class="top">
      <button class="icon-btn top__menu" data-side-open aria-label="Open navigation" aria-controls="side">${icon('menu')}</button>
      <form class="top__search" role="search" data-top-search><label class="sr-only" for="top-q">Search</label>${icon('search')}<input id="top-q" name="q" type="search" placeholder="${kind === 'admin' ? 'Search investors…' : 'Search properties…'}" autocomplete="off"></form>
      <div class="top__right">
        ${kind === 'app' ? languagePicker() : ''}
        <a class="icon-btn top__bell" href="${kind === 'admin' ? '/admin/notifications' : '/app/notifications'}" aria-label="Notifications">${icon('bell')}<b class="pill pill--dot" data-unread ${state.unread ? '' : 'hidden'}>${state.unread}</b></a>
        <div class="menu">
          <button class="top__user" data-menu aria-haspopup="true" aria-expanded="false"><span class="avatar">${esc(initials(u))}</span><span class="top__who"><strong>${esc(u.first_name)} ${esc(u.last_name)}</strong><small>${roleLabel}</small></span>${icon('chevron')}</button>
          <div class="menu__pop" hidden><a href="${settingsHref}">${icon('user')} Account settings</a>${kind === 'app' ? `<a href="/app/kyc">${icon('shield')} Verification</a>` : ''}<button data-logout>${icon('logout')} Logout</button></div>
        </div>
      </div>
    </header>
    <main id="main" class="page" tabindex="-1">${content}</main>
  </div></div>`;
}

const loading = '<div class="loading" role="status"><span class="spinner"></span><span class="sr-only">Loading</span></div>';

/* ------------------------------------------------------------------- render */
let renderSeq = 0;
export async function render() {
  const seq = ++renderSeq;
  const url = new URL(location.href);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  let match = null;
  let params = {};
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) { match = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; }
  }
  if (!match) { match = { page: Pub.notFound, layout: 'public' }; params = {}; }

  // Guards
  const u = state.user;
  if (match.guard) {
    if (!u) return navigate(`/login?next=${encodeURIComponent(path + url.search)}`, { replace: true });
    if (match.guard === 'investor') {
      if (isAdmin(u)) return navigate('/admin', { replace: true });
    }
    if (match.guard === 'admin' && !isAdmin(u)) return navigate('/app', { replace: true });
    if (match.guard === 'super' && u.role !== 'super_admin') return navigate('/admin', { replace: true });
  }
  if (match.layout === 'auth' && u && !match.guard && ['/login', '/register'].includes(path)) return navigate(homeFor(u), { replace: true });

  const root = document.getElementById('app');
  const kind = match.layout;
  const wrapIn = (html) => (kind === 'public' ? publicLayout(html, path) : kind === 'auth' ? authLayout(html) : appLayout(html, path, kind));
  const sameShell = root.dataset.layout === kind && kind !== 'public' && kind !== 'auth' && root.querySelector('#main');
  closeMobileNavigation();
  if (sameShell) {
    root.querySelector('#main').innerHTML = loading;
    root.querySelectorAll('.side-nav__link').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href) return;
      const isRoot = href === '/app' || href === '/admin';
      const cur = isRoot ? path === href : path === href || path.startsWith(href + '/');
      if (cur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  } else {
    root.innerHTML = wrapIn(loading);
    root.dataset.layout = kind;
    bindShell(root);
  }

  const ctx = { params, query: Object.fromEntries(url.searchParams), path, state, navigate, reload: () => render() };
  clearInterval(liveTimer);
  let view;
  try {
    view = await match.page(ctx);
  } catch (e) {
    if (seq !== renderSeq) return;
    if (e.status === 401) return;
    view = { title: 'Something went wrong', html: `<section class="wrap section"><div class="empty">${icon('alert')}<h3>We couldn't load this page</h3><p>${esc(e.message || 'Unexpected error.')}</p><button class="btn btn--primary" data-retry>Try again</button></div></section>` };
  }
  if (seq !== renderSeq) return;
  document.title = `${view.title ? view.title + ' · ' : ''}${state.site?.site?.brand || 'EstateInvest'}`;
  const main = root.querySelector('#main');
  main.innerHTML = view.html;
  main.querySelector('[data-retry]')?.addEventListener('click', () => render());
  if (kind === 'auth') {
    const host = root.querySelector('[data-auth-art]');
    if (host && !host.firstChild) import('./art.js').then((m) => { host.innerHTML = '<img src="/assets/img/properties/lagos-waterfront-residences-1.jpg" alt="">'; });
  }
  if (view.mount) {
    try { await view.mount(main, ctx); } catch (e) { console.error(e); toast(e.message || 'Something went wrong.', 'bad'); }
  }
  applyLanguage(root);
  if (!location.hash) window.scrollTo(0, 0);
  if (view.live) {
    liveTimer = setInterval(() => {
      if (seq !== renderSeq || document.hidden) return;
      Promise.resolve(view.live(main)).catch(() => {});
    }, 5000);
  }
  if (!sameShell || document.activeElement === document.body) main.focus({ preventScroll: true });
}

function bindShell(root) {
  root.querySelector('[data-nav-toggle]')?.addEventListener('click', (e) => {
    const open = document.body.classList.toggle('nav-open');
    setNavigationToggle(e.currentTarget, open);
  });
  root.querySelector('[data-nav-close]')?.addEventListener('click', closeMobileNavigation);
  root.querySelectorAll('[data-logout]').forEach((b) => b.addEventListener('click', logout));
  root.querySelector('[data-side-open]')?.addEventListener('click', (e) => {
    const open = document.body.classList.toggle('side-open');
    setNavigationToggle(e.currentTarget, open);
  });
  root.querySelector('[data-side-close]')?.addEventListener('click', closeMobileNavigation);
  const menuBtn = root.querySelector('[data-menu]');
  if (menuBtn) {
    const pop = menuBtn.nextElementSibling;
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      pop.hidden = !pop.hidden;
      menuBtn.setAttribute('aria-expanded', String(!pop.hidden));
    });
    document.addEventListener('click', () => { pop.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); });
  }
  root.querySelector('[data-top-search]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = new FormData(e.currentTarget).get('q');
    navigate(`${root.dataset.layout === 'admin' ? '/admin/investors' : '/app/properties'}?q=${encodeURIComponent(q || '')}`);
  });
}

function setNavigationToggle(button, open) {
  if (!button) return;
  button.innerHTML = icon(open ? 'x' : 'menu');
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
}

function closeMobileNavigation() {
  document.body.classList.remove('nav-open', 'side-open');
  document.querySelectorAll('[data-nav-toggle], [data-side-open]').forEach((button) => setNavigationToggle(button, false));
}

/* --------------------------------------------------------------------- boot */
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const href = a.getAttribute('href');
  if (!href || !href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/') || a.target || a.hasAttribute('download') || a.dataset.native !== undefined) return;
  e.preventDefault();
  closeMobileNavigation();
  const target = new URL(href, location.origin);
  if (target.pathname === location.pathname && target.search === location.search && target.hash) {
    document.getElementById(target.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  navigate(href);
});
window.addEventListener('popstate', () => { closeMobileNavigation(); render(); });

document.addEventListener('click', (e) => {
  const option = e.target.closest('[data-language-option]');
  if (option) {
    const next = option.dataset.languageOption;
    const selected = LANGUAGES.find(([code]) => code === next);
    if (!selected) return;
    const root = document.getElementById('app');
    resetTranslations(root);
    try { localStorage.setItem('ei_language', next); } catch { /* ignore */ }
    document.querySelectorAll('[data-language-picker]').forEach((picker) => {
      const trigger = picker.querySelector('[data-language-toggle]');
      const label = trigger.querySelector('span');
      const flag = trigger.querySelector('.language-picker__flag');
      label.textContent = selected[1];
      flag.src = `/assets/img/flags/${selected[2].toLowerCase()}.svg`;
      trigger.setAttribute('aria-label', `Choose language: ${selected[1]}`);
      trigger.setAttribute('aria-expanded', 'false');
      picker.querySelector('.language-picker__menu').hidden = true;
      picker.querySelectorAll('[data-language-option]').forEach((item) => item.setAttribute('aria-selected', String(item.dataset.languageOption === next)));
    });
    applyLanguage(root);
    return;
  }
  const toggle = e.target.closest('[data-language-toggle]');
  if (toggle) {
    const picker = toggle.closest('[data-language-picker]');
    const menu = picker.querySelector('.language-picker__menu');
    const open = menu.hidden;
    document.querySelectorAll('.language-picker__menu').forEach((item) => { item.hidden = true; });
    document.querySelectorAll('[data-language-toggle]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    return;
  }
  if (!e.target.closest('[data-language-picker]')) {
    document.querySelectorAll('.language-picker__menu').forEach((menu) => { menu.hidden = true; });
    document.querySelectorAll('[data-language-toggle]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeMobileNavigation();
  document.querySelectorAll('.language-picker__menu').forEach((menu) => { menu.hidden = true; });
  document.querySelectorAll('[data-language-toggle]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
});

window.addEventListener('translationerror', (e) => toast(e.detail?.message || 'Translation is unavailable. Check translation service configuration.', 'bad'));

// Stop trackpad/mouse wheel from changing a focused number field.
document.addEventListener('wheel', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'number' && document.activeElement === e.target) e.target.blur();
}, { passive: true });

api.onUnauthorized = () => {
  const path = location.pathname;
  if (state.user && (path.startsWith('/app') || path.startsWith('/admin'))) {
    state.user = null;
    toast('Your session ended. Sign in again.', 'bad');
    navigate(`/login?next=${encodeURIComponent(path)}`, { replace: true });
  }
};

(async function boot() {
  const [site] = await Promise.all([api.get('/api/public/site').catch(() => null), refreshUser()]);
  state.site = site;
  await render();
  if (state.user) refreshUnread();
  setInterval(livePoll, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) livePoll(); });
})();
