import { api, qs } from '../api.js';
import { esc, icon, money, date, md, bindForm, field, toast, modal, TYPE_LABEL, DEV_LABEL, duration, empty, fileSize, debounce } from '../ui.js';
import { propertyVisual } from '../art.js';
import { state, navigate } from '../app.js';

const site = () => state.site || {};

/* ---------------------------------------------------------------- shared bits */
export function propertyCard(p, base = '/properties') {
  const ribbon = p.accepting ? '<span class="ribbon ribbon--ok">Accepting investments</span>' : `<span class="ribbon">${esc(DEV_LABEL[p.dev_status])}</span>`;
  return `<article class="pcard">
    <a class="pcard__media" href="${base}/${esc(p.slug)}" tabindex="-1" aria-hidden="true">${propertyVisual(p)}${ribbon}</a>
    <div class="pcard__body">
      <h3 class="pcard__title"><a href="${base}/${esc(p.slug)}">${esc(p.name)}</a></h3>
      <p class="pcard__meta">${icon('pin')} ${esc(p.city)}, ${esc(p.country)}</p>
      <p class="pcard__meta">${icon('building')} ${esc(TYPE_LABEL[p.type])} · ${esc(DEV_LABEL[p.dev_status])}</p>
      <div class="pcard__foot"><div><small>Starting from</small><strong>${money(p.min_investment)}</strong></div>
      <a class="btn btn--gold btn--sm" href="${base}/${esc(p.slug)}">View opportunity ${icon('arrow')}</a></div>
    </div></article>`;
}

function returnText(r) {
  if (r && r.approved) return `${r.rate}% ${r.type === 'fixed_annual' ? 'per year' : 'over the term'}`;
  return 'Pending legal approval';
}

export function plansTable(plans, { action } = {}) {
  if (!plans.length) return empty('No plans available', 'Investment plans will appear here once they are published.');
  return `<div class="table-wrap"><table class="table table--plans"><thead><tr><th>Plan</th><th>Duration</th><th>Minimum</th><th>Maximum</th><th>Return structure</th><th>Status</th>${action ? '<th><span class="sr-only">Action</span></th>' : ''}</tr></thead><tbody>
    ${plans.map((p) => `<tr><td><strong>${esc(p.name)}</strong>${p.property_name ? `<br><small class="muted">${esc(p.property_name)} only</small>` : ''}</td><td>${esc(duration(p))}</td><td>${money(p.min_amount)}</td><td>${p.max_amount ? money(p.max_amount) : 'No limit'}</td>
    <td>${p.returns.approved ? esc(returnText(p.returns)) : `<span class="muted">${esc(returnText(p.returns))}</span>`}</td><td><span class="badge badge--ok">Open</span></td>${action ? `<td>${action(p)}</td>` : ''}</tr>`).join('')}
  </tbody></table></div>`;
}

const pageHead = (title, sub, crumbs = '') => `<section class="page-head"><div class="wrap">${crumbs}<h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div></section>`;

function investHref(propertyId, planId) {
  const u = state.user;
  const target = `/app/invest${qs({ property: propertyId, plan: planId })}`;
  if (!u) return `/register?next=${encodeURIComponent(target)}`;
  return target;
}

/* ----------------------------------------------------------------------- home */
export async function home() {
  const [props, plans] = await Promise.all([api.get('/api/public/properties?featured=1'), api.get('/api/public/plans')]);
  const h = site().home || {};
  const steps = (await api.get('/api/public/pages/how_it_works')).content?.steps || [];
  const faqs = ((await api.get('/api/public/pages/faqs')).content || []).slice(0, 4);
  const t = site().testimonials || [];
  return {
    title: 'Real estate investment platform',
    html: `
    <section class="hero">
      <div class="hero__art"><img src="/assets/img/properties/lagos-waterfront-residences-1.jpg" alt="Luxury waterfront mansion"></div>
      <div class="hero__shade"></div>
      <div class="wrap hero__in">
        <p class="hero__kicker">Real estate investment platform</p>
        <h1 class="hero__title">${(() => { const [a, ...b] = (h.hero_title || 'Invest in real estate. Build long-term wealth.').split(/(?<=\.)\s+/); return `${esc(a)}<br><span class="hero__gold">${esc(b.join(' '))}</span>`; })()}</h1>
        <p class="hero__sub">${esc(h.hero_subtitle || '')}</p>
        <div class="hero__cta"><a class="btn btn--gold btn--lg" href="/properties">Explore investments ${icon('arrow')}</a><a class="btn btn--outline-light btn--lg" href="/how-it-works"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="m10 8 6 4-6 4Z" fill="#0b1829"/></svg> How it works</a></div>
        <ul class="hero__feats">
          <li><span>${icon('shield')}</span><div><strong>Secure &amp; Regulated</strong><small>KYC verified investors</small></div></li>
          <li><span>${icon('wallet')}</span><div><strong>Crypto Payments Only</strong><small>USDT, BTC, ETH, TON &amp; more</small></div></li>
          <li><span>${icon('file')}</span><div><strong>Transparent Records</strong><small>Full investment history</small></div></li>
          <li><span>${icon('chart')}</span><div><strong>Premium Opportunities</strong><small>Real-world properties</small></div></li>
        </ul>
        ${(h.stats || []).length ? `<dl class="hero__stats">${h.stats.map((s, i) => `<div><span class="hero__stat-ico">${icon(['layers', 'users', 'building', 'globe'][i % 4])}</span><dd>${esc(s.value)}</dd><dt>${esc(s.label)}</dt></div>`).join('')}</dl>` : ''}
      </div>
    </section>

    <section class="section section--cream">
      <div class="wrap">
        <div class="section__head"><div><p class="kicker">Featured properties</p><h2>Featured properties</h2><p>Each opportunity comes with its documents, risks and plan terms set out before you invest.</p></div><a class="link-arrow" href="/properties">All properties ${icon('arrow')}</a></div>
        <div class="grid grid--3">${props.items.slice(0, 3).map((p) => propertyCard(p)).join('') || empty('No featured properties yet', 'Check back soon.')}</div>
      </div>
    </section>

    <section class="section section--navy section--plans">
      <div class="wrap">
        <div class="section__head"><div><p class="kicker">Investment plans</p><h2>Investment plans</h2><p>Choose a fixed duration that suits you. Every plan is linked to real property and documented terms.</p></div><a class="link-arrow" href="/plans">Compare plans ${icon('arrow')}</a></div>
        ${plansTable(plans.items)}
        <p class="note">${icon('info')} Return structures are published only after legal approval. Returns are never guaranteed and your capital is at risk.</p>
      </div>
    </section>

    <section class="section section--cream howit">
      <div class="wrap split">
        <div class="howit__lead"><p class="kicker">How it works</p><h2>How investing works</h2><p class="lead">From sign-up to maturity in five clear steps, all from your dashboard.</p><a class="btn btn--gold btn--lg" href="/register">Create your account ${icon('arrow')}</a><img class="howit__img" src="/assets/img/properties/lagos-waterfront-residences-3.jpg" alt="" loading="lazy"></div>
        <ol class="steps">${steps.map((s) => `<li><h3>${esc(s.title)}</h3><p>${esc(s.body)}</p></li>`).join('')}</ol>
      </div>
    </section>

    <section class="section section--navy">
      <div class="wrap trust">
        <div><span class="trust__ico">${icon('shield')}</span><h3>Verified investors only</h3><p>Every account completes identity, address and source-of-funds checks before investing.</p></div>
        <div><span class="trust__ico">${icon('file')}</span><h3>Documents up front</h3><p>Property documents, plan terms and risk disclosures are available before you commit.</p></div>
        <div><span class="trust__ico">${icon('wallet')}</span><h3>Crypto payments, recorded</h3><p>Pay in USDT, BTC, ETH or TON. Every transaction hash is recorded against your investment.</p></div>
        <div><span class="trust__ico">${icon('audit')}</span><h3>Full audit trail</h3><p>Every status change and payment decision is logged and never silently overwritten.</p></div>
      </div>
    </section>

    ${t.length ? `<section class="section section--cream"><div class="wrap"><div class="section__head"><div><p class="kicker">Testimonials</p><h2>What investors say</h2></div></div><div class="grid grid--3 quotes">${t.map((q) => `<figure class="quote"><span class="quote__mark" aria-hidden="true">“</span><blockquote>${esc(q.quote)}</blockquote><figcaption><strong>${esc(q.name)}</strong><span>${esc(q.role)}</span></figcaption></figure>`).join('')}</div></div></section>` : ''}

    <section class="section section--cream">
      <div class="wrap split">
        <div><p class="kicker">Questions, answered</p><h2>Questions, answered</h2><p class="lead">The essentials before you invest.</p><a class="link-arrow" href="/faqs">All FAQs ${icon('arrow')}</a></div>
        <div class="faq">${faqs.map((f) => `<details><summary>${esc(f.q)}${icon('chevron')}</summary><p>${esc(f.a)}</p></details>`).join('')}</div>
      </div>
    </section>

    <section class="cta-band"><img class="cta-band__img" src="/assets/img/properties/lagos-waterfront-residences-1.jpg" alt="" loading="lazy"><div class="wrap cta-band__in"><div><p class="kicker">Get started</p><h2>Start with a verified account</h2><p>Registration takes two minutes. Verification usually completes within two business days.</p></div><a class="btn btn--gold btn--lg" href="/register">Start investing ${icon('arrow')}</a></div></section>`,
  };
}

/* ----------------------------------------------------------------- properties */
export async function properties(ctx, { base = '/properties', inApp = false } = {}) {
  const q = ctx.query;
  const data = await api.get(`/api/public/properties${qs({ type: q.type, q: q.q, sort: q.sort })}`);
  const tabs = [['', 'All'], ['residential', 'Residential'], ['commercial', 'Commercial'], ['mixed_use', 'Mixed use'], ['hospitality', 'Hospitality']];
  const link = (patch) => `${ctx.path}${qs({ ...q, ...patch })}`;
  const body = `
    <div class="toolbar">
      <nav class="tabs" aria-label="Property type">${tabs.map(([v, l]) => `<a href="${link({ type: v })}" class="tabs__tab" ${(q.type || '') === v ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
      <div class="toolbar__right">
        <label class="search"><span class="sr-only">Search properties</span>${icon('search')}<input type="search" data-q value="${esc(q.q || '')}" placeholder="Search by name or city"></label>
        <label class="select-inline"><span>Sort by</span><select data-sort><option value="">Featured</option><option value="newest" ${q.sort === 'newest' ? 'selected' : ''}>Newest</option><option value="min_asc" ${q.sort === 'min_asc' ? 'selected' : ''}>Lowest minimum</option><option value="min_desc" ${q.sort === 'min_desc' ? 'selected' : ''}>Highest minimum</option></select></label>
      </div>
    </div>
    <div class="grid grid--3">${data.items.map((p) => propertyCard(p, base)).join('')}</div>
    ${data.items.length ? '' : empty('No properties match', 'Try a different type or search term.', `<a class="btn btn--ghost" href="${ctx.path}">Clear filters</a>`)}`;
  return {
    title: 'Properties',
    html: inApp ? `<div class="page__head"><div><h1>Properties</h1><p>Opportunities currently on the platform.</p></div></div>${body}`
      : `${pageHead('Our properties', 'Carefully selected real estate opportunities in prime locations.')}<section class="section section--tight"><div class="wrap">${body}</div></section>`,
    mount(root) {
      const go = debounce((v) => navigate(link({ q: v }), { replace: true }), 450);
      root.querySelector('[data-q]').addEventListener('input', (e) => go(e.target.value.trim()));
      root.querySelector('[data-sort]').addEventListener('change', (e) => navigate(link({ sort: e.target.value })));
      const input = root.querySelector('[data-q]');
      if (q.q) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    },
  };
}

export async function property(ctx, { inApp = false } = {}) {
  const { property: p, plans, documents } = await api.get(`/api/public/properties/${encodeURIComponent(ctx.params.slug)}`);
  const pct = p.target_raise ? Math.min(100, Math.round((p.raised / p.target_raise) * 100)) : null;
  const gallery = Array.from({ length: Math.max(5, p.images.length) }, (_, i) => i).slice(0, Math.max(5, p.images.length));
  const crumbs = `<nav class="crumbs" aria-label="Breadcrumb"><a href="${inApp ? '/app/properties' : '/properties'}">Properties</a>${icon('chevronRight')}<span>${esc(p.name)}</span></nav>`;
  const enquire = state.user ? '/app/support' : null;
  const html = `
  <section class="section section--tight"><div class="wrap">
    ${crumbs}
    <div class="pdetail">
      <div class="gallery">
        <div class="gallery__main" data-main>${propertyVisual(p, 0)}</div>
        <div class="gallery__thumbs">${gallery.map((i) => `<button class="gallery__thumb" data-thumb="${i}" aria-label="Show image ${i + 1}" ${i === 0 ? 'aria-current="true"' : ''}>${propertyVisual(p, i)}</button>`).join('')}</div>
      </div>
      <aside class="pdetail__info">
        ${p.accepting ? '<span class="badge badge--ok">Accepting investments</span>' : '<span class="badge badge--muted">Not accepting investments</span>'}
        <h1>${esc(p.name)}</h1>
        <p class="pdetail__loc">${icon('pin')} ${esc(p.city)}, ${esc(p.country)}</p>
        <p>${esc(p.summary || '')}</p>
        <dl class="facts">
          <div>${icon('building')}<dt>Property type</dt><dd>${esc(TYPE_LABEL[p.type])}</dd></div>
          <div>${icon('clock')}<dt>Status</dt><dd>${esc(DEV_LABEL[p.dev_status])}</dd></div>
          <div>${icon('wallet')}<dt>Minimum</dt><dd>${money(p.min_investment)}</dd></div>
        </dl>
        ${pct != null ? `<div class="progress" aria-label="Funding progress"><div class="progress__bar"><span style="width:${pct}%"></span></div><p><strong>${money(p.raised, { compact: true })}</strong> raised of ${money(p.target_raise, { compact: true })} target · ${p.investors} investor${p.investors === 1 ? '' : 's'}</p></div>` : ''}
        <div class="pdetail__cta">
          ${p.accepting && site().investing_enabled ? `<a class="btn btn--gold btn--lg" href="${investHref(p.id)}">Invest now ${icon('arrow')}</a>` : ''}
          ${enquire ? `<a class="btn btn--ghost btn--lg" href="${enquire}">Enquire</a>` : '<button class="btn btn--ghost btn--lg" data-enquire>Enquire</button>'}
        </div>
      </aside>
    </div>

    <div class="ptabs" data-tabs>
      <div class="tabs tabs--line" role="tablist">
        ${['Overview', 'Investment plans', 'Property details', 'Documents', 'Risks & disclosures'].map((t, i) => `<button role="tab" class="tabs__tab" id="tab-${i}" aria-controls="panel-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${t}</button>`).join('')}
      </div>
      <div role="tabpanel" id="panel-0" aria-labelledby="tab-0" class="ptabs__panel">
        <div class="cols-2-1"><div class="prose">${md(p.description || '')}${p.highlights.length ? `<h3>Highlights</h3><ul class="ticks">${p.highlights.map((x) => `<li>${icon('check')} ${esc(x)}</li>`).join('')}</ul>` : ''}</div>
        <div class="card card--flat"><h3 class="card__title">Key information</h3><dl class="kv">${Object.entries(p.details).slice(0, 6).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div></div>
      </div>
      <div role="tabpanel" id="panel-1" aria-labelledby="tab-1" class="ptabs__panel" hidden>
        ${plansTable(plans, { action: (pl) => (p.accepting && site().investing_enabled ? `<a class="btn btn--gold btn--sm" href="${investHref(p.id, pl.id)}">Select</a>` : '') })}
        <p class="note">${icon('info')} Maturity is calculated from the date your payment is confirmed. Returns are not guaranteed.</p>
      </div>
      <div role="tabpanel" id="panel-2" aria-labelledby="tab-2" class="ptabs__panel" hidden>
        <dl class="kv kv--wide">${Object.entries(p.details).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('') || '<p class="muted">Details will be published soon.</p>'}</dl>
      </div>
      <div role="tabpanel" id="panel-3" aria-labelledby="tab-3" class="ptabs__panel" hidden>
        ${documents.length ? `<ul class="doclist">${documents.map((d) => `<li>${icon('file')}<div><strong>${esc(d.title)}</strong><small>${esc(d.mime === 'application/pdf' ? 'PDF' : 'Image')} · ${fileSize(d.size)}</small></div><a class="btn btn--ghost btn--sm" href="${d.url}" target="_blank" rel="noopener">View</a></li>`).join('')}</ul>`
          : empty('No public documents yet', 'Property documents will be published here. Verified investors receive additional documents in their dashboard.')}
      </div>
      <div role="tabpanel" id="panel-4" aria-labelledby="tab-4" class="ptabs__panel" hidden>
        <div class="callout callout--warn">${icon('alert')}<div><strong>Your capital is at risk</strong><p>${esc(p.risks || 'Risk information will be published before this opportunity opens.')}</p></div></div>
        <p><a class="link-arrow" href="/legal/risk">Read the full Risk Disclosure ${icon('arrow')}</a></p>
      </div>
    </div>
  </div></section>`;
  return {
    title: p.name,
    html,
    mount(root) {
      const main = root.querySelector('[data-main]');
      root.querySelectorAll('[data-thumb]').forEach((b) => b.addEventListener('click', () => {
        main.innerHTML = propertyVisual(p, Number(b.dataset.thumb));
        root.querySelectorAll('[data-thumb]').forEach((x) => x.removeAttribute('aria-current'));
        b.setAttribute('aria-current', 'true');
      }));
      bindTabs(root.querySelector('[data-tabs]'));
      root.querySelector('[data-enquire]')?.addEventListener('click', () => enquiryModal(p));
    },
  };
}

export function bindTabs(el) {
  if (!el) return;
  const tabs = [...el.querySelectorAll('[role=tab]')];
  const select = (t) => {
    tabs.forEach((x) => {
      const on = x === t;
      x.setAttribute('aria-selected', String(on));
      x.tabIndex = on ? 0 : -1;
      el.querySelector(`#${x.getAttribute('aria-controls')}`).hidden = !on;
    });
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { const n = tabs[(i + d + tabs.length) % tabs.length]; n.focus(); select(n); }
    });
  });
}

function enquiryModal(p) {
  modal({
    title: `Enquire about ${p.name}`,
    body: `<form class="form" data-f novalidate><div class="form-grid">
      ${field({ name: 'name', label: 'Full name', required: true, attrs: 'autocomplete="name" maxlength="120"' })}
      ${field({ name: 'email', label: 'Email', type: 'email', required: true, attrs: 'autocomplete="email"' })}
      ${field({ name: 'phone', label: 'Phone', type: 'tel', attrs: 'autocomplete="tel" maxlength="40"' })}
      ${field({ name: 'message', label: 'Your question', type: 'textarea', required: true, full: true, attrs: 'minlength="10" maxlength="5000"' })}
      </div><p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Send enquiry</button></div></form>`,
    onMount(panel, close) {
      bindForm(panel.querySelector('[data-f]'), async (d) => {
        const r = await api.post('/api/public/contact', { ...d, subject: `Enquiry: ${p.name}`, category: 'property_enquiry', property_id: p.id });
        close();
        toast(`Enquiry sent. Your reference is ${r.ref}.`);
      });
    },
  });
}

/* ---------------------------------------------------------------------- plans */
export async function plans() {
  const { items } = await api.get('/api/public/plans');
  return {
    title: 'Investment plans',
    html: `${pageHead('Investment plans', 'Compare plan durations, minimums and terms.')}
    <section class="section section--tight"><div class="wrap">
      <div class="plan-cards">${items.map((p) => `<article class="plan"><header><h3>${esc(p.name)}</h3><p>${esc(duration(p))}</p></header>
        <dl><div><dt>Minimum</dt><dd>${money(p.min_amount)}</dd></div><div><dt>Maximum</dt><dd>${p.max_amount ? money(p.max_amount) : 'No limit'}</dd></div><div><dt>Return structure</dt><dd>${esc(returnText(p.returns))}</dd></div><div><dt>Required</dt><dd>${esc(p.required_docs || 'Identity verification')}</dd></div></dl>
        <p class="plan__terms">${esc(p.terms || '')}</p>
        <a class="btn btn--gold btn--block" href="${state.user ? `/app/invest?plan=${p.id}` : `/register?next=${encodeURIComponent(`/app/invest?plan=${p.id}`)}`}">Choose ${esc(p.name)}</a></article>`).join('') || empty('No plans available', 'Plans will be published soon.')}</div>
      <div class="callout">${icon('info')}<div><strong>About returns</strong><p>Return structures are set by the company and published only once legally approved. No return is guaranteed. Your maturity date is calculated from the day your payment is confirmed.</p></div></div>
    </div></section>`,
  };
}

/* ---------------------------------------------------------------- how it works */
export async function howItWorks() {
  const c = (await api.get('/api/public/pages/how_it_works')).content || { steps: [] };
  const cur = site().currencies || [];
  return {
    title: 'How it works',
    html: `${pageHead('How it works', 'Investing on the platform, step by step.')}
    <section class="section section--tight"><div class="wrap narrow">
      <ol class="steps steps--big">${c.steps.map((s) => `<li><h3>${esc(s.title)}</h3><p>${esc(s.body)}</p></li>`).join('')}</ol>
      <h2>Supported cryptocurrencies</h2>
      <p>Payments are accepted only in cryptocurrency. Bank transfers are not supported.</p>
      <div class="coins">${cur.map((c2) => `<div class="coin"><span class="coin__mark coin__mark--${esc(c2.code.toLowerCase())}">${esc(c2.code.slice(0, 1))}</span><div><strong>${esc(c2.name)}</strong><small>${esc(c2.code)} · ${c2.networks.map((n) => esc(n.name)).join(', ')}</small></div></div>`).join('')}</div>
      <div class="callout callout--warn">${icon('alert')}<div><strong>Send on the right network</strong><p>Always send the exact amount, on the network shown, to the address in your dashboard. Funds sent on another network may be lost permanently.</p></div></div>
      <p class="center"><a class="btn btn--gold btn--lg" href="/register">Create your account ${icon('arrow')}</a></p>
    </div></section>`,
  };
}

/* ----------------------------------------------------------------------- about */
export async function about() {
  const c = (await api.get('/api/public/pages/about')).content || {};
  const s = site().site || {};
  return {
    title: 'About us',
    html: `${pageHead('About EstateInvest', c.intro || '')}
    <section class="section section--tight"><div class="wrap">
      <div class="about-grid">
        <div class="prose"><h2>Our story</h2><p>${esc(c.history || '')}</p><h2>Our mission</h2><p>${esc(c.mission || '')}</p><h2>How we work</h2><p>${esc(c.model || '')}</p></div>
        <div class="about-art"><img src="/assets/img/properties/eko-business-tower-1.jpg" alt="City skyline with office towers"></div>
      </div>
      ${(c.team || []).length ? `<h2>Leadership</h2><div class="team">${c.team.map((m) => `<div class="member"><span class="avatar avatar--lg">${esc(m.name.split(' ').map((x) => x[0]).join('').slice(0, 2))}</span><h3>${esc(m.name)}</h3><p class="member__role">${esc(m.role)}</p><p>${esc(m.bio || '')}</p></div>`).join('')}</div>` : ''}
      <div class="grid grid--2 about-foot">
        <div class="card card--flat"><h3 class="card__title">Registration & licensing</h3><p>${esc(c.licensing || s.registration || '')}</p></div>
        <div class="card card--flat"><h3 class="card__title">Contact</h3><p>${esc(s.address || '')}</p><p><a href="mailto:${esc(s.email || '')}">${esc(s.email || '')}</a> · ${esc(s.phone || '')}</p><p class="muted">${esc(s.hours || '')}</p></div>
      </div>
    </div></section>`,
  };
}

/* ------------------------------------------------------------------------ FAQs */
export async function faqs() {
  const items = (await api.get('/api/public/pages/faqs')).content || [];
  const groups = {};
  items.forEach((f) => { (groups[f.category || 'General'] = groups[f.category || 'General'] || []).push(f); });
  return {
    title: 'FAQs',
    html: `${pageHead('Frequently asked questions', 'Can’t find what you need? Contact our team.')}
    <section class="section section--tight"><div class="wrap faqpage">
      <aside class="faqpage__side">
        <p class="kicker">Browse topics</p>
        <nav class="faqpage__nav" aria-label="FAQ topics">${Object.keys(groups).map((g, i) => `<a href="#faq-${i}">${esc(g)}<span>${groups[g].length}</span></a>`).join('')}</nav>
        <div class="faqpage__help"><span>${icon('help')}</span><h3>Still have a question?</h3><p>Our team replies within one business day.</p><a class="btn btn--gold btn--block" href="/contact">Contact us ${icon('arrow')}</a></div>
      </aside>
      <div class="faqpage__main">
        ${Object.entries(groups).map(([g, list], i) => `<section id="faq-${i}" class="faqpage__group"><p class="kicker">${esc(g)}</p><div class="faq faq--cards">${list.map((f) => `<details><summary>${esc(f.q)}<span class="faq__chev">${icon('chevron')}</span></summary><p>${esc(f.a)}</p></details>`).join('')}</div></section>`).join('')}
      </div>
    </div></section>`,
  };
}

/* --------------------------------------------------------------------- contact */
export async function contact(ctx) {
  const s = site().site || {};
  const u = state.user;
  return {
    title: 'Contact',
    html: `${pageHead('Contact us', 'Our team replies within one business day.')}
    <section class="section section--tight"><div class="wrap contact">
      <form class="card form" data-f novalidate>
        <h2 class="card__title">Send a message</h2>
        <div class="form-grid">
          ${field({ name: 'name', label: 'Full name', required: true, value: u ? `${u.first_name} ${u.last_name}` : '', attrs: 'autocomplete="name" maxlength="120"' })}
          ${field({ name: 'email', label: 'Email', type: 'email', required: true, value: u?.email || '', attrs: 'autocomplete="email"' })}
          ${field({ name: 'phone', label: 'Phone', type: 'tel', value: u?.phone || '', attrs: 'autocomplete="tel" maxlength="40"' })}
          ${field({ name: 'category', label: 'Topic', options: [['general', 'General question'], ['investment', 'Investing'], ['support', 'Account support'], ['partnership', 'Partnerships']], value: ctx.query.topic || 'general' })}
          ${field({ name: 'subject', label: 'Subject', required: true, full: true, attrs: 'maxlength="160"' })}
          ${field({ name: 'message', label: 'Message', type: 'textarea', required: true, full: true, rows: 6, attrs: 'minlength="10" maxlength="5000"' })}
        </div>
        <p class="form-error" hidden></p>
        <div class="form__actions"><button class="btn btn--gold" type="submit">Send message</button></div>
      </form>
      <aside class="contact__side">
        <div class="contact__item">${icon('mail')}<div><strong>Email</strong><a href="mailto:${esc(s.email || '')}">${esc(s.email || '')}</a></div></div>
        <div class="contact__item">${icon('phone')}<div><strong>Phone</strong><span>${esc(s.phone || '')}</span></div></div>
        <div class="contact__item">${icon('pin')}<div><strong>Office</strong><span>${esc(s.address || '')}</span></div></div>
        <div class="contact__item">${icon('clock')}<div><strong>Hours</strong><span>${esc(s.hours || '')}</span></div></div>
        ${s.whatsapp ? `<a class="btn btn--primary btn--block" href="https://wa.me/${esc(String(s.whatsapp).replace(/\D/g, ''))}" target="_blank" rel="noopener">${icon('chat')} Chat on WhatsApp</a>` : ''}
      </aside>
    </div></section>`,
    mount(root) {
      const form = root.querySelector('[data-f]');
      bindForm(form, async (d) => {
        const r = await api.post('/api/public/contact', d);
        form.innerHTML = `<div class="success">${icon('check')}<h2>Message sent</h2><p>Your reference is <strong>${esc(r.ref)}</strong>. We’ve emailed you a copy and will reply within one business day.</p><a class="btn btn--ghost" href="/">Back to home</a></div>`;
      });
    },
  };
}

/* ----------------------------------------------------------------------- legal */
const LEGAL_KEYS = ['terms', 'privacy', 'risk', 'kyc_aml', 'redemption', 'crypto', 'investment_terms', 'investor_agreement'];
export async function legal(ctx) {
  if (!LEGAL_KEYS.includes(ctx.params.doc)) return notFound();
  const all = (await api.get('/api/public/pages/legal')).content || {};
  const d = all[ctx.params.doc] || { title: 'Document', body: 'This document has not been published yet.' };
  return {
    title: d.title,
    html: `${pageHead(d.title, '')}<section class="section section--tight"><div class="wrap legal">
      <nav class="legal__nav" aria-label="Legal documents">${LEGAL_KEYS.filter((k) => all[k]).map((k) => `<a href="/legal/${k}" ${k === ctx.params.doc ? 'aria-current="page"' : ''}>${esc(all[k].title)}</a>`).join('')}</nav>
      <article class="prose">${md(d.body)}</article></div></section>`,
  };
}

/* ------------------------------------------------------------------------ news */
export async function news() {
  const { items } = await api.get('/api/public/posts');
  return {
    title: 'News',
    html: `${pageHead('News & updates', 'Project progress and company news.')}<section class="section section--tight"><div class="wrap narrow">
      ${items.length ? `<div class="posts">${items.map((p) => `<article class="post-row"><time>${date(p.published_at)}</time><h2><a href="/news/${esc(p.slug)}">${esc(p.title)}</a></h2><p>${esc(p.excerpt || '')}</p></article>`).join('')}</div>` : empty('No news yet', 'Updates will appear here.')}
    </div></section>`,
  };
}
export async function post(ctx) {
  const { post: p } = await api.get(`/api/public/posts/${encodeURIComponent(ctx.params.slug)}`);
  return {
    title: p.title,
    html: `<section class="section"><div class="wrap narrow"><nav class="crumbs"><a href="/news">News</a>${icon('chevronRight')}<span>${esc(p.title)}</span></nav><h1 class="post-title">${esc(p.title)}</h1><p class="muted">${date(p.published_at)}</p><article class="prose">${md(p.body)}</article></div></section>`,
  };
}

export async function notFound() {
  return {
    title: 'Page not found',
    html: `<section class="section"><div class="wrap narrow center"><h1 class="display">Page not found</h1><p class="lead">The page you’re looking for doesn’t exist or has moved.</p><a class="btn btn--gold" href="/">Go to homepage</a></div></section>`,
  };
}
