import { api, qs } from '../api.js';
import {
  esc, icon, money, num, date, dateTime, ago, badge, bindForm, field, check, toast, modal, confirmDialog, TYPE_LABEL, DEV_LABEL,
  duration, empty, uploadFile, fileSize, copyText, shortHash, sentence, pager, initials, debounce, statusText,
} from '../ui.js';
import { propertyVisual } from '../art.js';
import { bars } from '../charts.js';
import { state, navigate, liveReload } from '../app.js';
import { settings as accountSettings } from './investor.js';

const head = (title, sub = '', actions = '') => `<div class="page__head"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${actions ? `<div class="page__actions">${actions}</div>` : ''}</div>`;
const pct = (v) => (v == null || v === 0 ? '<small class="muted">No change this month</small>' : `<small class="${v > 0 ? 'up' : 'down'}">${icon('trend')} ${v > 0 ? '+' : ''}${v}% this month</small>`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const INV_STATUSES = ['pending', 'payment_awaiting', 'payment_confirmed', 'active', 'maturing', 'matured', 'completed', 'redeemed', 'cancelled', 'suspended', 'under_review', 'disputed'];
const isSuper = () => state.user.role === 'super_admin';

function filterBar(ctx, { search = true, placeholder = 'Search…', selects = [] }) {
  return `<form class="filters" data-filters>
    ${search ? `<label class="search">${icon('search')}<span class="sr-only">Search</span><input type="search" name="q" value="${esc(ctx.query.q || '')}" placeholder="${esc(placeholder)}"></label>` : ''}
    ${selects.map((s) => `<label class="select-inline"><span class="sr-only">${esc(s.label)}</span><select name="${s.name}">${s.options.map(([v, l]) => `<option value="${esc(v)}" ${String(ctx.query[s.name] || '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`).join('')}
  </form>`;
}
function bindFilters(root, ctx) {
  const f = root.querySelector('[data-filters]');
  if (!f) return;
  const go = () => {
    const d = Object.fromEntries(new FormData(f));
    navigate(`${ctx.path}${qs({ ...d, page: undefined })}`, { replace: true });
  };
  f.addEventListener('submit', (e) => { e.preventDefault(); go(); });
  f.querySelectorAll('select').forEach((s) => s.addEventListener('change', go));
  const q = f.querySelector('[name=q]');
  if (q) {
    q.addEventListener('input', debounce(go, 450));
    if (ctx.query.q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }
}
const pageLink = (ctx) => (p) => `${ctx.path}${qs({ ...ctx.query, page: p })}`;
const person = (name, email) => `<div class="person"><span class="avatar avatar--sm">${esc(initials({ first_name: name.split(' ')[0], last_name: name.split(' ')[1] }))}</span><div><strong>${esc(name)}</strong><small>${esc(email || '')}</small></div></div>`;

/* ------------------------------------------------------------------ dashboard */
export async function dashboard(ctx) {
  const year = Number(ctx.query.year) || new Date().getFullYear();
  const d = await api.get(`/api/admin/dashboard?year=${year}`);
  const s = d.stats;
  const tile = (href, label, value, tone) => `<a class="mini ${tone ? `mini--${tone}` : ''}" href="${href}"><span>${label}</span><strong>${value}</strong></a>`;
  return {
    title: 'Dashboard',
    html: `${head('Dashboard', 'Overview of platform activity.')}
    <div class="stats">
      <div class="stat"><span class="stat__ico stat__ico--blue">${icon('users')}</span><div><p>Total investors</p><strong>${num(s.investors)}</strong>${pct(s.investors_change)}</div></div>
      <div class="stat"><span class="stat__ico stat__ico--green">${icon('building')}</span><div><p>Active investments</p><strong>${num(s.active_investments)}</strong>${pct(s.active_change)}</div></div>
      <div class="stat"><span class="stat__ico stat__ico--gold">${icon('wallet')}</span><div><p>Total invested</p><strong>${money(s.total_invested, { compact: true })}</strong>${pct(s.invested_change)}</div></div>
      <div class="stat"><span class="stat__ico stat__ico--red">${icon('shield')}</span><div><p>Pending KYC</p><strong>${num(s.pending_kyc)}</strong><small><a href="/admin/kyc">Review now</a></small></div></div>
    </div>
    <div class="minis">
      ${tile('/admin/payments?status=submitted', 'Payments to verify', s.payments_review, s.payments_review ? 'warn' : '')}
      ${tile('/admin/investments?status=maturing', 'Maturing soon', s.maturing)}
      ${tile('/admin/investments?status=matured', 'Matured', s.matured)}
      ${tile('/admin/redemptions?status=requested', 'Redemption requests', s.pending_redemptions, s.pending_redemptions ? 'warn' : '')}
    </div>
    <div class="grid grid--dash">
      <section class="card"><header class="card__head"><h2 class="card__title">Investment activity</h2>
        <label class="select-inline"><span class="sr-only">Year</span><select data-year>${[0, 1, 2].map((k) => new Date().getFullYear() - k).map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></label></header>
        ${bars(d.activity.map((a) => ({ label: MONTHS[a.month], value: a.amount, count: a.count })), { secondary: (it) => `${it.count} inv.` })}</section>
      <section class="card card--table"><header class="card__head"><h2 class="card__title">Recent transactions</h2><a class="link-arrow" href="/admin/payments">View all ${icon('arrow')}</a></header>
        <div class="table-wrap"><table class="table table--compact"><thead><tr><th>ID</th><th>Investor</th><th class="num">Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>
        ${d.recent.map((p) => `<tr><td>${esc(p.ref)}</td><td>${esc(p.investor_name)}</td><td class="num">${num(p.amount_crypto, 6)} ${esc(p.currency)}</td><td>${badge(p.status)}</td><td>${date(p.created_at)}</td></tr>`).join('')}</tbody></table></div></section>
    </div>`,
    mount(root) { root.querySelector('[data-year]').addEventListener('change', (e) => navigate(`/admin?year=${e.target.value}`)); },
  };
}

/* ------------------------------------------------------------------ investors */
export async function investors(ctx) {
  const d = await api.get(`/api/admin/investors${qs(ctx.query)}`);
  return {
    title: 'Investors',
    html: `${head('Investors', 'Search, review and manage investor accounts.', `<a class="btn btn--ghost" href="/api/admin/reports/investors" data-native>${icon('download')} Export CSV</a>`)}
    ${filterBar(ctx, { placeholder: 'Search name, email or phone', selects: [
      { name: 'status', label: 'Status', options: [['', 'All statuses'], ['active', 'Active'], ['suspended', 'Suspended']] },
      { name: 'kyc', label: 'KYC', options: [['', 'All KYC'], ['approved', 'Approved'], ['pending_review', 'Pending review'], ['requires_info', 'Needs information'], ['rejected', 'Rejected'], ['not_started', 'Not started']] }] })}
    <section class="card card--table">${d.items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Investor</th><th>Country</th><th>KYC</th><th>Account</th><th class="num">Invested</th><th class="num">Active</th><th>Joined</th></tr></thead><tbody>
      ${d.items.map((u) => `<tr data-href="/admin/investors/${u.id}"><td><a href="/admin/investors/${u.id}">${person(`${u.first_name} ${u.last_name}`, u.email)}</a></td><td>${esc(u.country || '—')}</td><td>${badge(u.kyc_status)}</td><td>${badge(u.status)}${u.email_verified_at ? '' : '<br><small class="muted">Email unverified</small>'}</td><td class="num">${money(u.invested)}</td><td class="num">${u.active_count}</td><td>${date(u.created_at)}</td></tr>`).join('')}
    </tbody></table></div>${pager(d.page, d.size, d.total, pageLink(ctx))}` : empty('No investors found', 'Try a different search or filter.')}</section>`,
    mount(root) { bindFilters(root, ctx); },
  };
}

export async function investor(ctx) {
  const d = await api.get(`/api/admin/investors/${encodeURIComponent(ctx.params.id)}`);
  const u = d.investor;
  const totalInv = d.investments.filter((i) => ['payment_confirmed', 'active', 'maturing', 'matured', 'completed', 'redeemed'].includes(i.status)).reduce((s, i) => s + i.amount_usd, 0);
  return {
    title: `${u.first_name} ${u.last_name}`,
    html: `<nav class="crumbs"><a href="/admin/investors">Investors</a>${icon('chevronRight')}<span>${esc(u.first_name)} ${esc(u.last_name)}</span></nav>
    ${head(`${u.first_name} ${u.last_name}`, u.email, `${u.status === 'active' ? '<button class="btn btn--danger-ghost" data-status="suspended">Suspend account</button>' : '<button class="btn btn--gold" data-status="active">Reactivate account</button>'}<button class="btn btn--ghost" data-doc>${icon('upload')} Issue document</button>`)}
    <div class="grid grid--profile">
      <section class="card profile"><span class="avatar avatar--lg">${esc(initials(u))}</span><h2>${esc(u.first_name)} ${esc(u.last_name)}</h2><p class="muted">${esc(u.email)}</p>
        <dl class="kv"><div><dt>Phone</dt><dd>${esc(u.phone || '—')}</dd></div><div><dt>Country</dt><dd>${esc(u.country || '—')}</dd></div><div><dt>Account</dt><dd>${badge(u.status)}</dd></div>
        <div><dt>Email</dt><dd>${u.email_verified ? badge('verified') : badge('unverified')}</dd></div><div><dt>KYC</dt><dd>${badge(u.kyc_status)} <a href="/admin/kyc/${u.id}">Review</a></dd></div>
        <div><dt>Joined</dt><dd>${date(u.created_at)}</dd></div><div><dt>Last login</dt><dd>${dateTime(u.last_login_at)}</dd></div><div><dt>Total invested</dt><dd><strong>${money(totalInv)}</strong></dd></div></dl></section>
      <section class="card card--table"><header class="card__head"><h2 class="card__title">Investments</h2></header>${d.investments.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>ID</th><th>Property</th><th>Plan</th><th class="num">Amount</th><th>Status</th><th>Maturity</th></tr></thead><tbody>
        ${d.investments.map((i) => `<tr><td><a href="/admin/investments/${i.id}">${esc(i.ref)}</a></td><td>${esc(i.property_name)}</td><td>${esc(i.plan_name)}</td><td class="num">${money(i.amount_usd)}</td><td>${badge(i.status, i.status_label)}</td><td>${date(i.maturity_date)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted pad">No investments yet.</p>'}</section>
    </div>
    <section class="card card--table"><header class="card__head"><h2 class="card__title">Transactions</h2></header>${d.payments.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Ref</th><th>Type</th><th>Investment</th><th class="num">Amount</th><th>Tx hash</th><th>Status</th><th>Date</th></tr></thead><tbody>
      ${d.payments.map((p) => `<tr><td>${esc(p.ref)}</td><td>${esc(sentence(p.kind))}</td><td>${esc(p.investment_ref || '—')}</td><td class="num">${num(p.amount_crypto, 8)} ${esc(p.currency)}</td><td class="mono">${esc(shortHash(p.tx_hash))}</td><td>${badge(p.status)}</td><td>${date(p.created_at)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted pad">No transactions.</p>'}</section>
    <div class="grid grid--dash">
      <section class="card"><h2 class="card__title">Documents issued</h2>${d.documents.length ? `<ul class="doclist">${d.documents.map((x) => `<li>${icon('file')}<div><strong>${esc(x.title)}</strong><small>${esc(sentence(x.category))} · ${date(x.created_at)}</small></div>${x.file_id ? `<a class="btn btn--ghost btn--sm" target="_blank" href="/api/files/${x.file_id}">View</a>` : ''}</li>`).join('')}</ul>` : '<p class="muted">None yet.</p>'}</section>
      <section class="card"><h2 class="card__title">Support tickets</h2>${d.tickets.length ? `<ul class="doclist">${d.tickets.map((t) => `<li>${icon('help')}<div><strong><a href="/admin/support/${t.id}">${esc(t.ref)}</a> · ${esc(t.subject)}</strong><small>${ago(t.updated_at)}</small></div>${badge(t.status)}</li>`).join('')}</ul>` : '<p class="muted">None.</p>'}</section>
    </div>`,
    mount(root) {
      root.querySelector('[data-status]')?.addEventListener('click', async (e) => {
        const status = e.currentTarget.dataset.status;
        const reason = await confirmDialog({ title: status === 'suspended' ? 'Suspend this account?' : 'Reactivate this account?', message: status === 'suspended' ? 'The investor will be signed out and unable to sign in. Their investments are not changed.' : 'The investor will be able to sign in again.', confirm: status === 'suspended' ? 'Suspend' : 'Reactivate', tone: status === 'suspended' ? 'danger' : 'gold', reason: true });
        if (!reason) return;
        try { await api.post(`/api/admin/investors/${u.id}/status`, { status, reason }); toast(status === 'suspended' ? 'Account suspended.' : 'Account reactivated.'); ctx.reload(); }
        catch (err) { toast(err.message, 'bad'); }
      });
      root.querySelector('[data-doc]').addEventListener('click', () => issueDocModal({ userId: u.id, investments: d.investments }, () => ctx.reload()));
    },
  };
}

function issueDocModal({ userId = null, investments = [], investors = null }, done) {
  modal({
    title: 'Issue a document',
    body: `<form class="form" data-f novalidate><div class="form-grid">
      ${investors ? field({ name: 'user_id', label: 'Investor', full: true, options: [['', 'All investors (shared document)'], ...investors.map((i) => [i.id, `${i.first_name} ${i.last_name} · ${i.email}`])] }) : `<input type="hidden" name="user_id" value="${userId}">`}
      ${investments.length ? field({ name: 'investment_id', label: 'Investment', full: true, options: [['', 'Not linked to an investment'], ...investments.map((i) => [i.id, `${i.ref} · ${i.property_name}`])] }) : ''}
      ${field({ name: 'category', label: 'Category', required: true, options: [['agreement', 'Investment agreement'], ['terms', 'Terms'], ['risk', 'Risk disclosure'], ['property', 'Property document'], ['statement', 'Statement'], ['receipt', 'Receipt'], ['certificate', 'Certificate'], ['redemption', 'Redemption confirmation'], ['other', 'Other']] })}
      ${field({ name: 'title', label: 'Title', required: true, attrs: 'maxlength="160"' })}
      <div class="field field--full"><label for="docfile">File</label><input id="docfile" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required><p class="field__hint">PDF, JPG, PNG or WEBP up to 10 MB.</p><p class="field__error" hidden></p></div>
    </div><p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Issue document</button></div></form>`,
    onMount(panel, close) {
      const form = panel.querySelector('[data-f]');
      bindForm(form, async (d) => {
        let file;
        try { file = await uploadFile(form.querySelector('#docfile').files[0], { purpose: 'investor_document' }); } catch (e) { throw { fields: {}, message: e.message }; }
        await api.post('/api/admin/documents', { ...d, user_id: d.user_id ? Number(d.user_id) : null, investment_id: d.investment_id ? Number(d.investment_id) : null, file });
        close(); toast('Document issued.'); done();
      });
    },
  });
}

/* ------------------------------------------------------------------------ KYC */
export async function kycList(ctx) {
  const status = ctx.query.status || 'pending_review';
  const d = await api.get(`/api/admin/kyc?status=${encodeURIComponent(status)}`);
  const tabs = [['pending_review', 'Pending review'], ['requires_info', 'Needs information'], ['approved', 'Approved'], ['rejected', 'Rejected']];
  return {
    title: 'KYC reviews',
    html: `${head('KYC reviews', 'Review and verify investor identity documents.')}
    <nav class="tabs">${tabs.map(([k, l]) => `<a class="tabs__tab" href="/admin/kyc?status=${k}" ${status === k ? 'aria-current="page"' : ''}>${l} <span class="count">${d.counts[k] || 0}</span></a>`).join('')}</nav>
    <section class="card card--table">${d.items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Investor</th><th>Country</th><th>Status</th><th>Submitted</th><th>Reviewed</th><th></th></tr></thead><tbody>
      ${d.items.map((k) => `<tr><td>${person(k.name, k.email)}</td><td>${esc(k.country || '—')}</td><td>${badge(k.status)}</td><td>${dateTime(k.submitted_at)}</td><td>${date(k.reviewed_at)}</td><td><a class="btn btn--gold btn--sm" href="/admin/kyc/${k.user_id}">Review</a></td></tr>`).join('')}</tbody></table></div>` : empty('Queue is clear', 'No submissions with this status.')}</section>`,
  };
}

export async function kycReview(ctx) {
  const d = await api.get(`/api/admin/kyc/${encodeURIComponent(ctx.params.id)}`);
  const u = d.investor;
  const k = d.kyc;
  const current = d.documents.filter((x) => x.status !== 'replaced');
  const p = k?.personal || {};
  const sf = k?.source_of_funds || {};
  const su = k?.suitability || {};
  const labels = { identity: 'Identity document', address: 'Proof of address', selfie: 'Selfie / liveness' };
  const viewer = (doc) => (doc.mime === 'application/pdf'
    ? `<a class="doc-pdf" href="${doc.url}" target="_blank" rel="noopener">${icon('file')}<span>Open PDF · ${esc(doc.original_name)}</span></a>`
    : `<a href="${doc.url}" target="_blank" rel="noopener"><img src="${doc.url}" alt="${esc(labels[doc.kind])}"></a>`);
  return {
    title: 'KYC review',
    html: `<nav class="crumbs"><a href="/admin/kyc">KYC reviews</a>${icon('chevronRight')}<span>${esc(u.first_name)} ${esc(u.last_name)}</span></nav>
    ${head('KYC review', 'Review and verify investor identity documents.')}
    ${!k ? empty('Nothing submitted', 'This investor has not started verification.') : `
    <div class="kyc-review">
      <section class="card"><h2 class="card__title">Investor information</h2>
        <div class="person person--lg"><span class="avatar avatar--lg">${esc(initials(u))}</span><div><strong>${esc(u.first_name)} ${esc(u.last_name)}</strong><small>${esc(u.email)}</small><small>ID: ${u.id}</small></div></div>
        <dl class="kv"><div><dt>Date of birth</dt><dd>${date(p.dob)}</dd></div><div><dt>Nationality</dt><dd>${esc(p.nationality || '—')}</dd></div><div><dt>Residence</dt><dd>${esc(p.country || '—')}</dd></div>
        <div><dt>Address</dt><dd>${esc([p.address, p.city, p.postal_code].filter(Boolean).join(', ') || '—')}</dd></div><div><dt>Occupation</dt><dd>${esc(p.occupation || '—')}</dd></div><div><dt>Phone</dt><dd>${esc(u.phone || '—')}</dd></div>
        <div><dt>ID type</dt><dd>${esc(sentence(k.id_doc_type || '—'))}</dd></div><div><dt>Status</dt><dd>${badge(k.status)}</dd></div></dl>
        <h3 class="card__sub">Source of funds & suitability</h3>
        <dl class="kv"><div><dt>Source</dt><dd>${esc(sentence(sf.source || '—'))}</dd></div><div><dt>Details</dt><dd>${esc(sf.details || '—')}</dd></div><div><dt>Annual income</dt><dd>${esc((su.annual_income || '—').replace(/_/g, ' '))}</dd></div>
        <div><dt>Experience</dt><dd>${esc(sentence(su.experience || '—'))}</dd></div><div><dt>Risk tolerance</dt><dd>${esc(sentence(su.risk_tolerance || '—'))}</dd></div><div><dt>PEP</dt><dd>${su.pep ? '<span class="text-bad">Yes — enhanced due diligence</span>' : 'No'}</dd></div></dl>
      </section>
      <section class="card"><h2 class="card__title">Documents</h2>
        ${current.length ? `<div class="doc-viewer">${current.map((doc) => `<figure><figcaption>${esc(labels[doc.kind])} ${badge(doc.status)}</figcaption>${viewer(doc)}<small class="muted">${esc(doc.original_name)} · ${fileSize(doc.size)} · ${date(doc.created_at)}</small></figure>`).join('')}</div>` : '<p class="muted">No documents uploaded.</p>'}
      </section>
      <section class="card"><h2 class="card__title">Verification status</h2>
        <form class="form" data-f novalidate>
          <ul class="verify-list">${current.map((doc) => `<li><span>${esc(labels[doc.kind])}</span><select name="doc_${doc.id}" aria-label="${esc(labels[doc.kind])} status"><option value="pending" ${doc.status === 'pending' ? 'selected' : ''}>Pending</option><option value="verified" ${doc.status === 'verified' ? 'selected' : ''}>Verified</option><option value="rejected" ${doc.status === 'rejected' ? 'selected' : ''}>Rejected</option></select></li>`).join('')}
            <li><span>Source of funds</span>${sf.source ? badge('submitted', 'Provided') : badge('not_started', 'Not provided')}</li><li><span>Suitability</span>${su.risk_tolerance ? badge('submitted', 'Provided') : badge('not_started', 'Not provided')}</li></ul>
          ${field({ name: 'note', label: 'Note to investor', type: 'textarea', rows: 3, hint: 'Required when rejecting or requesting information. The investor sees this message.', value: k.admin_note || '', attrs: 'maxlength="2000"' })}
          <p class="form-error" hidden></p>
          <div class="kyc-actions"><button class="btn btn--ok" type="submit" name="decision" value="approved" ${k.status !== 'pending_review' ? 'disabled' : ''}>${icon('check')} Approve</button>
          <button class="btn btn--gold" type="submit" name="decision" value="requires_info">Request information</button>
          <button class="btn btn--danger" type="submit" name="decision" value="rejected" ${k.status !== 'pending_review' ? 'disabled' : ''}>Reject</button></div>
        </form>
      </section>
    </div>`}`,
    mount(root) {
      const form = root.querySelector('[data-f]');
      if (!form) return;
      let decision = null;
      form.querySelectorAll('[name=decision]').forEach((b) => b.addEventListener('click', () => { decision = b.value; }));
      bindForm(form, async (data) => {
        const documents = {};
        Object.entries(data).forEach(([key, v]) => { if (key.startsWith('doc_')) documents[key.slice(4)] = v; });
        await api.post(`/api/admin/kyc/${u.id}/decision`, { decision, note: data.note, documents });
        toast(decision === 'approved' ? 'KYC approved.' : decision === 'rejected' ? 'KYC rejected.' : 'Information requested.');
        navigate('/admin/kyc');
      });
    },
  };
}

/* ---------------------------------------------------------------- investments */
export async function investments(ctx) {
  const d = await api.get(`/api/admin/investments${qs(ctx.query)}`);
  return {
    title: 'Investments',
    html: `${head('Investments', 'Manage all investor investments.', `<button class="btn btn--gold" data-create>${icon('plus')} Record investment</button><a class="btn btn--ghost" href="/api/admin/reports/investments" data-native>${icon('download')} Export</a>`)}
    ${filterBar(ctx, { placeholder: 'Search ID, investor or property', selects: [{ name: 'status', label: 'Status', options: [['', 'All statuses'], ...INV_STATUSES.map((s) => [s, statusText(s)])] }] })}
    <section class="card card--table">${d.items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>ID</th><th>Investor</th><th>Property</th><th>Plan</th><th class="num">Amount</th><th>Status</th><th>Maturity</th><th></th></tr></thead><tbody>
      ${d.items.map((i) => `<tr><td><a href="/admin/investments/${i.id}"><strong>${esc(i.ref)}</strong></a></td><td>${esc(i.investor_name)}</td><td>${esc(i.property_name)}</td><td>${esc(i.plan_name)}</td><td class="num">${num(i.crypto_amount, 6)} ${esc(i.currency)}<br><small class="muted">${money(i.amount_usd)}</small></td><td>${badge(i.status, i.status_label)}</td><td>${date(i.maturity_date)}</td><td><a class="icon-btn" href="/admin/investments/${i.id}" aria-label="Open ${esc(i.ref)}">${icon('chevronRight')}</a></td></tr>`).join('')}
    </tbody></table></div>${pager(d.page, d.size, d.total, pageLink(ctx))}` : empty('No investments found', 'Try a different search or filter.')}</section>`,
    mount(root) {
      bindFilters(root, ctx);
      root.querySelector('[data-create]').addEventListener('click', async () => {
        const L = await api.get('/api/admin/lookups');
        modal({
          title: 'Record an investment manually',
          body: `<p class="muted">Use this only for payments received outside the checkout flow. The payment is recorded as confirmed and fully audited.</p>
          <form class="form" data-f novalidate><div class="form-grid">
            ${field({ name: 'user_id', label: 'Investor', required: true, full: true, options: [['', 'Select investor'], ...L.investors.map((i) => [i.id, `${i.first_name} ${i.last_name} · ${i.email}`])] })}
            ${field({ name: 'property_id', label: 'Property', required: true, options: [['', 'Select'], ...L.properties.map((p) => [p.id, p.name])] })}
            ${field({ name: 'plan_id', label: 'Plan', required: true, options: [['', 'Select'], ...L.plans.map((p) => [p.id, p.name])] })}
            ${field({ name: 'amount_usd', label: 'Amount (USD)', type: 'number', required: true, attrs: 'min="1" step="0.01"' })}
            ${field({ name: 'currency', label: 'Currency', required: true, options: L.currencies.map((c) => [c.code, c.code]) })}
            ${field({ name: 'network', label: 'Network', required: true, options: L.currencies[0].networks.map((n) => [n.code, n.name]) })}
            ${field({ name: 'tx_hash', label: 'Transaction hash', required: true, attrs: 'maxlength="130"' })}
            ${field({ name: 'note', label: 'Reason for manual entry', required: true, full: true, attrs: 'maxlength="500"' })}
          </div><p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Record investment</button></div></form>`,
          onMount(panel, close) {
            const form = panel.querySelector('[data-f]');
            form.currency.addEventListener('change', () => { const c = L.currencies.find((x) => x.code === form.currency.value); form.network.innerHTML = c.networks.map((n) => `<option value="${esc(n.code)}">${esc(n.name)}</option>`).join(''); });
            bindForm(form, async (v) => {
              const r = await api.post('/api/admin/investments', { ...v, user_id: Number(v.user_id), property_id: Number(v.property_id), plan_id: Number(v.plan_id) });
              close(); toast('Investment recorded.'); navigate(`/admin/investments/${r.id}`);
            });
          },
        });
      });
    },
  };
}

export async function investment(ctx) {
  const d = await api.get(`/api/admin/investments/${encodeURIComponent(ctx.params.id)}`);
  const i = d.investment;
  const rt = i.return_terms || {};
  return {
    title: i.ref,
    html: `<nav class="crumbs"><a href="/admin/investments">Investments</a>${icon('chevronRight')}<span>${esc(i.ref)}</span></nav>
    ${head(i.ref, `${i.property_name} · ${i.plan_name}`, badge(i.status, i.status_label))}
    <div class="grid grid--dash">
      <section class="card"><h2 class="card__title">Details</h2><dl class="kv kv--wide">
        <div><dt>Investor</dt><dd><a href="/admin/investors/${d.investor.id}">${esc(d.investor.first_name)} ${esc(d.investor.last_name)}</a><br><small class="muted">${esc(d.investor.email)}</small></dd></div>
        <div><dt>Amount</dt><dd>${money(i.amount_usd, { cents: true })}<br><small class="muted">${num(i.crypto_amount, 8)} ${esc(i.currency)} · ${esc(i.network)}</small></dd></div>
        <div><dt>Plan</dt><dd>${esc(i.plan_name)} (${esc(duration(d.plan))})</dd></div><div><dt>Created</dt><dd>${dateTime(i.created_at)}</dd></div>
        <div><dt>Start</dt><dd>${date(i.start_date)}</dd></div><div><dt>Maturity</dt><dd>${date(i.maturity_date)}</dd></div>
        <div><dt>Return terms (at investment)</dt><dd>${rt.approved ? `${rt.rate}% ${rt.type === 'fixed_annual' ? 'p.a.' : 'total'}` : esc(rt.note || 'Pending approval')}</dd></div>
        <div><dt>Expected return</dt><dd>${i.expected_return != null ? money(i.expected_return, { cents: true }) : '—'}</dd></div>
        <div><dt>Tx hash</dt><dd class="mono">${esc(shortHash(i.tx_hash, 12))}</dd></div></dl></section>
      <section class="card"><h2 class="card__title">Change status</h2>
        ${d.allowed.length ? `<form class="form" data-f novalidate>${field({ name: 'status', label: 'New status', required: true, options: [['', 'Select'], ...d.allowed.map((a) => [a.value, a.label])] })}
        ${field({ name: 'reason', label: 'Reason (recorded in the audit log)', type: 'textarea', required: true, rows: 3, attrs: 'maxlength="500"' })}<p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Update status</button></div></form>`
          : '<p class="muted">This investment is in a final state and cannot change.</p>'}
        <h3 class="card__sub">Status history</h3><ol class="timeline">${d.history.map((h) => `<li><span class="timeline__dot"></span><div><strong>${esc(h.to_label)}</strong>${h.reason ? `<p>${esc(h.reason)}</p>` : ''}<small>${dateTime(h.created_at)} · ${esc(h.actor_email || 'System')}</small></div></li>`).join('')}</ol></section>
    </div>
    <section class="card card--table"><header class="card__head"><h2 class="card__title">Payments</h2></header><div class="table-wrap"><table class="table"><thead><tr><th>Ref</th><th>Type</th><th class="num">Amount</th><th>Wallet</th><th>Tx hash</th><th>Confirmations</th><th>Status</th><th>Date</th></tr></thead><tbody>
      ${d.payments.map((p) => `<tr><td>${esc(p.ref)}</td><td>${esc(sentence(p.kind))}</td><td class="num">${num(p.amount_crypto, 8)} ${esc(p.currency)}</td><td class="mono">${esc(shortHash(p.wallet_address))}</td><td class="mono">${esc(shortHash(p.tx_hash))}</td><td>${p.confirmations}</td><td>${badge(p.status)}</td><td>${date(p.created_at)}</td></tr>`).join('')}</tbody></table></div></section>`,
    mount(root) {
      const f = root.querySelector('[data-f]');
      if (f) bindForm(f, async (v) => { await api.post(`/api/admin/investments/${i.id}/status`, v); toast('Status updated.'); ctx.reload(); });
    },
  };
}

/* ------------------------------------------------------------------ payments */
export async function payments(ctx) {
  const d = await api.get(`/api/admin/payments${qs(ctx.query)}`);
  return {
    title: 'Payments',
    html: `${head('Payments', 'Review and verify crypto transactions.', `<a class="btn btn--ghost" href="/api/admin/reports/payments" data-native>${icon('download')} Export</a>`)}
    ${filterBar(ctx, { placeholder: 'Search ref, tx hash or investor', selects: [
      { name: 'status', label: 'Status', options: [['', 'All statuses'], ['submitted', 'Verifying'], ['awaiting', 'Awaiting payment'], ['confirmed', 'Confirmed'], ['rejected', 'Rejected'], ['expired', 'Expired']] },
      { name: 'kind', label: 'Type', options: [['', 'All types'], ['deposit', 'Deposits'], ['redemption', 'Payouts']] }] })}
    <section class="card card--table">${d.items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Ref</th><th>Investor</th><th>Investment</th><th class="num">Amount</th><th>Network / wallet</th><th>Tx hash</th><th>Status</th><th>Date</th><th></th></tr></thead><tbody>
      ${d.items.map((p) => `<tr><td><strong>${esc(p.ref)}</strong><br><small class="muted">${esc(sentence(p.kind))}</small></td><td>${esc(p.investor_name)}</td><td>${p.investment_id ? `<a href="/admin/investments/${p.investment_id}">${esc(p.investment_ref)}</a>` : '—'}</td>
      <td class="num">${num(p.amount_crypto, 8)} ${esc(p.currency)}<br><small class="muted">${money(p.amount_usd)}</small></td><td>${esc(p.network)}<br><small class="mono muted">${esc(shortHash(p.wallet_address, 6))}</small></td>
      <td class="mono">${p.tx_hash ? `<button class="link mono" data-copy="${esc(p.tx_hash)}" title="Copy">${esc(shortHash(p.tx_hash))}</button>` : '—'}</td><td>${badge(p.status)}${p.note ? `<br><small class="muted">${esc(p.note)}</small>` : ''}</td><td>${date(p.created_at)}</td>
      <td>${p.kind === 'deposit' && ['awaiting', 'submitted'].includes(p.status) ? `<button class="btn btn--gold btn--sm" data-verify="${p.id}">Review</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>${pager(d.page, d.size, d.total, pageLink(ctx))}` : empty('No payments found', 'Try a different filter.')}</section>`,
    mount(root) {
      bindFilters(root, ctx);
      root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy)));
      root.querySelectorAll('[data-verify]').forEach((b) => b.addEventListener('click', () => {
        const p = d.items.find((x) => x.id === Number(b.dataset.verify));
        modal({
          title: `Review payment ${p.ref}`,
          body: `<dl class="kv"><div><dt>Investor</dt><dd>${esc(p.investor_name)}</dd></div><div><dt>Expected</dt><dd><strong>${num(p.amount_crypto, 8)} ${esc(p.currency)}</strong> on ${esc(p.network)}</dd></div><div><dt>Receiving wallet</dt><dd class="mono wrap-any">${esc(p.wallet_address)}</dd></div><div><dt>Submitted hash</dt><dd class="mono wrap-any">${esc(p.tx_hash || 'Not submitted yet')}</dd></div></dl>
          <div class="callout">${icon('info')}<div><p>Check the transaction on a block explorer: correct receiving address, exact amount, correct network and enough confirmations.</p></div></div>
          <form class="form" data-f novalidate><div class="form-grid">${field({ name: 'tx_hash', label: 'Transaction hash', value: p.tx_hash || '', full: true, attrs: 'maxlength="130"' })}${field({ name: 'confirmations', label: 'Confirmations', type: 'number', attrs: 'min="0"' })}${field({ name: 'note', label: 'Note', hint: 'Required when rejecting.', attrs: 'maxlength="500"' })}</div>
          <p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--danger-ghost" type="submit" value="reject" name="decision">Reject</button><button class="btn btn--ok" type="submit" value="confirm" name="decision">${icon('check')} Confirm payment</button></div></form>`,
          onMount(panel, close) {
            const form = panel.querySelector('[data-f]');
            let decision = 'confirm';
            form.querySelectorAll('[name=decision]').forEach((x) => x.addEventListener('click', () => { decision = x.value; }));
            bindForm(form, async (v) => {
              await api.post(`/api/admin/payments/${p.id}/verify`, { decision, tx_hash: v.tx_hash || undefined, confirmations: v.confirmations ?? undefined, note: v.note || undefined });
              close(); toast(decision === 'confirm' ? 'Payment confirmed. The investor has been notified.' : 'Payment rejected.'); ctx.reload();
            });
          },
        });
      }));
    },
  };
}

/* --------------------------------------------------------------- redemptions */
export async function redemptions(ctx) {
  const { items } = await api.get(`/api/admin/redemptions${qs({ status: ctx.query.status })}`);
  const tabs = [['', 'All'], ['requested', 'Requested'], ['under_review', 'Under review'], ['approved', 'Approved'], ['paid', 'Paid'], ['rejected', 'Rejected']];
  const next = { requested: ['under_review', 'approved', 'rejected'], under_review: ['approved', 'rejected'], approved: ['paid', 'rejected'] };
  return {
    title: 'Redemptions',
    html: `${head('Redemptions', 'Review requests and record payouts.', `<a class="btn btn--ghost" href="/api/admin/reports/redemptions" data-native>${icon('download')} Export</a>`)}
    <nav class="tabs">${tabs.map(([k, l]) => `<a class="tabs__tab" href="/admin/redemptions${k ? `?status=${k}` : ''}" ${(ctx.query.status || '') === k ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <section class="card card--table">${items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Ref</th><th>Investor</th><th>Investment</th><th class="num">Amount</th><th>Destination</th><th>Status</th><th>Requested</th><th></th></tr></thead><tbody>
      ${items.map((r) => `<tr><td><strong>${esc(r.ref)}</strong></td><td>${esc(r.first_name)} ${esc(r.last_name)}</td><td><a href="/admin/investments/${r.investment_id}">${esc(r.investment_ref)}</a></td><td class="num">${money(r.amount_usd)}<br><small class="muted">principal ${money(r.principal)}</small></td>
      <td><span class="mono">${esc(shortHash(r.destination_wallet))}</span><br><small class="muted">${esc(r.currency)} · ${esc(r.network)}</small></td><td>${badge(r.status)}${r.tx_hash ? `<br><small class="mono muted">${esc(shortHash(r.tx_hash))}</small>` : ''}</td><td>${date(r.created_at)}</td>
      <td>${next[r.status] ? `<button class="btn btn--gold btn--sm" data-act="${r.id}">Update</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('No redemption requests', 'Requests from investors will appear here.')}</section>`,
    mount(root) {
      root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
        const r = items.find((x) => x.id === Number(b.dataset.act));
        modal({
          title: `Update ${r.ref}`,
          body: `<dl class="kv"><div><dt>Amount</dt><dd>${money(r.amount_usd, { cents: true })} in ${esc(r.currency)} (${esc(r.network)})</dd></div><div><dt>Destination wallet</dt><dd class="mono wrap-any">${esc(r.destination_wallet)} <button class="icon-btn icon-btn--sm" type="button" data-copy="${esc(r.destination_wallet)}" aria-label="Copy wallet">${icon('copy')}</button></dd></div></dl>
          <form class="form" data-f novalidate>${field({ name: 'decision', label: 'Action', required: true, options: next[r.status].map((s) => [s, { under_review: 'Mark under review', approved: 'Approve', rejected: 'Reject', paid: 'Mark as paid' }[s]]) })}
          <div data-paid hidden class="form-grid">${field({ name: 'amount_crypto', label: `Amount sent (${r.currency})`, type: 'number', attrs: 'min="0" step="any"' })}${field({ name: 'tx_hash', label: 'Payout transaction hash', attrs: 'maxlength="130"' })}</div>
          ${field({ name: 'note', label: 'Note', type: 'textarea', rows: 3, hint: 'Shared with the investor. Required when rejecting.', attrs: 'maxlength="1000"' })}
          <p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Save</button></div></form>`,
          onMount(panel, close) {
            const form = panel.querySelector('[data-f]');
            panel.querySelector('[data-copy]').addEventListener('click', (e) => copyText(e.currentTarget.dataset.copy));
            const sync = () => { panel.querySelector('[data-paid]').hidden = form.decision.value !== 'paid'; };
            form.decision.addEventListener('change', sync); sync();
            bindForm(form, async (v) => {
              await api.post(`/api/admin/redemptions/${r.id}/decision`, { decision: v.decision, note: v.note || undefined, tx_hash: v.tx_hash || undefined, amount_crypto: v.amount_crypto ?? undefined });
              close(); toast('Redemption updated.'); ctx.reload();
            });
          },
        });
      }));
    },
  };
}

/* ---------------------------------------------------------------- properties */
export async function properties() {
  const { items } = await api.get('/api/admin/properties');
  return {
    title: 'Properties',
    html: `${head('Properties', 'Create, edit and publish property listings.', `<a class="btn btn--gold" href="/admin/properties/new">${icon('plus')} Add property</a>`)}
    <section class="card card--table">${items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Property</th><th>Type</th><th>Development</th><th>Listing</th><th class="num">Min.</th><th class="num">Raised</th><th></th></tr></thead><tbody>
      ${items.map((p) => `<tr><td><div class="prop-cell"><span class="prop-cell__img">${propertyVisual(p)}</span><div><a href="/admin/properties/${p.id}"><strong>${esc(p.name)}</strong></a><small class="muted">${esc(p.city)}, ${esc(p.country)}</small></div></div></td><td>${esc(TYPE_LABEL[p.type])}</td><td>${esc(DEV_LABEL[p.dev_status])}</td>
      <td>${badge(p.status)}${p.accepting ? '' : '<br><small class="muted">Not accepting</small>'}${p.featured ? '<br><small class="muted">Featured</small>' : ''}</td><td class="num">${money(p.min_investment)}</td><td class="num">${money(p.raised, { compact: true })}${p.target_raise ? `<br><small class="muted">of ${money(p.target_raise, { compact: true })}</small>` : ''}</td>
      <td><a class="btn btn--ghost btn--sm" href="/admin/properties/${p.id}">Edit</a></td></tr>`).join('')}</tbody></table></div>` : empty('No properties yet', 'Add your first property listing.', '<a class="btn btn--gold" href="/admin/properties/new">Add property</a>')}</section>`,
  };
}

export async function propertyEdit(ctx) {
  const isNew = ctx.params.id === 'new';
  const d = isNew ? { property: { name: '', type: 'residential', city: '', country: 'Nigeria', summary: '', description: '', dev_status: 'planning', status: 'draft', accepting: true, featured: false, min_investment: 1000, target_raise: null, details: {}, highlights: [], risks: '', art_seed: Math.floor(Math.random() * 900) + 1, images: [], image_ids: [] }, documents: [], plans: [] } : await api.get(`/api/admin/properties/${encodeURIComponent(ctx.params.id)}`);
  const p = d.property;
  return {
    title: isNew ? 'Add property' : p.name,
    html: `<nav class="crumbs"><a href="/admin/properties">Properties</a>${icon('chevronRight')}<span>${isNew ? 'New property' : esc(p.name)}</span></nav>
    ${head(isNew ? 'Add property' : p.name, isNew ? 'New listings are saved as drafts until you publish them.' : '', !isNew && p.status === 'published' ? `<a class="btn btn--ghost" href="/properties/${esc(p.slug)}" target="_blank">${icon('external')} View live</a>` : '')}
    <div class="grid grid--edit">
      <form class="card form" data-f novalidate>
        <h2 class="card__title">Listing details</h2>
        <div class="form-grid">
          ${field({ name: 'name', label: 'Project name', required: true, full: true, value: p.name, attrs: 'maxlength="120"' })}
          ${field({ name: 'type', label: 'Type', required: true, value: p.type, options: Object.entries(TYPE_LABEL) })}
          ${field({ name: 'dev_status', label: 'Development status', required: true, value: p.dev_status, options: Object.entries(DEV_LABEL) })}
          ${field({ name: 'city', label: 'City', required: true, value: p.city, attrs: 'maxlength="80"' })}
          ${field({ name: 'country', label: 'Country', required: true, value: p.country, attrs: 'maxlength="80"' })}
          ${field({ name: 'min_investment', label: 'Minimum investment (USD)', type: 'number', required: true, value: p.min_investment, attrs: 'min="0" step="1"' })}
          ${field({ name: 'target_raise', label: 'Target raise (USD)', type: 'number', value: p.target_raise ?? '', attrs: 'min="0" step="1"' })}
          ${field({ name: 'summary', label: 'Short summary', full: true, value: p.summary || '', hint: 'Shown on listing cards. Up to 300 characters.', attrs: 'maxlength="300"' })}
          ${field({ name: 'description', label: 'Description', type: 'textarea', full: true, rows: 6, value: p.description || '', hint: 'Supports simple formatting: ## heading, - bullet, **bold**.' })}
          ${field({ name: 'highlights', label: 'Highlights (one per line)', type: 'textarea', full: true, rows: 3, value: (p.highlights || []).join('\n') })}
          ${field({ name: 'details', label: 'Key information (one “Label: value” per line)', type: 'textarea', full: true, rows: 5, value: Object.entries(p.details || {}).map(([k, v]) => `${k}: ${v}`).join('\n') })}
          ${field({ name: 'risks', label: 'Risks & disclosures', type: 'textarea', full: true, rows: 4, value: p.risks || '' })}
          ${field({ name: 'status', label: 'Listing status', required: true, value: p.status, options: [['draft', 'Draft'], ['published', 'Published'], ['archived', 'Archived']] })}
          ${field({ name: 'art_seed', label: 'Illustration style (1–999)', type: 'number', value: p.art_seed, hint: 'Used when no photos are uploaded.', attrs: 'min="1" max="999"' })}
        </div>
        ${check({ name: 'accepting', label: 'Accepting investments', checked: p.accepting })}
        ${check({ name: 'featured', label: 'Feature on the homepage', checked: p.featured })}
        <p class="form-error" hidden></p><div class="form__actions"><a class="btn btn--ghost" href="/admin/properties">Cancel</a><button class="btn btn--gold" type="submit">${isNew ? 'Create property' : 'Save changes'}</button></div>
      </form>
      <div class="stack">
        <section class="card"><h2 class="card__title">Images</h2>${isNew ? '<p class="muted">Save the property first, then add images.</p>' : `
          <div class="thumbs">${p.images.length ? p.images.map((src, idx) => `<figure class="thumb"><img src="${src}" alt=""><button class="icon-btn icon-btn--sm" data-rmimg="${p.image_ids[idx]}" aria-label="Remove image">${icon('trash')}</button></figure>`).join('') : `<div class="thumb thumb--art">${propertyVisual(p)}</div><p class="muted small">No photos yet — a generated illustration is shown instead.</p>`}</div>
          <label class="btn btn--ghost btn--block">${icon('upload')} Upload image<input type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" data-img></label>`}</section>
        <section class="card"><h2 class="card__title">Documents</h2>${isNew ? '<p class="muted">Save the property first, then add documents.</p>' : `
          ${d.documents.length ? `<ul class="doclist">${d.documents.map((x) => `<li>${icon('file')}<div><strong>${esc(x.title)}</strong><small>${x.is_public ? 'Public' : 'Private'} · ${fileSize(x.size)}</small></div><a class="icon-btn icon-btn--sm" target="_blank" href="${x.url}" aria-label="View">${icon('eye')}</a><button class="icon-btn icon-btn--sm" data-rmdoc="${x.id}" aria-label="Remove">${icon('trash')}</button></li>`).join('')}</ul>` : '<p class="muted">No documents.</p>'}
          <button class="btn btn--ghost btn--block" data-adddoc>${icon('plus')} Add document</button>`}</section>
        ${!isNew ? `<section class="card"><h2 class="card__title">Plans for this property</h2>${d.plans.length ? `<ul class="doclist">${d.plans.map((pl) => `<li>${icon('layers')}<div><strong>${esc(pl.name)}</strong><small>${esc(duration(pl))} · min ${money(pl.min_amount)}</small></div>${badge(pl.status)}</li>`).join('')}</ul>` : '<p class="muted small">All general plans apply. Assign property-specific plans under Investment Plans.</p>'}<a class="link-arrow" href="/admin/plans">Manage plans ${icon('arrow')}</a></section>` : ''}
      </div>
    </div>`,
    mount(root) {
      bindForm(root.querySelector('[data-f]'), async (v) => {
        const details = {};
        String(v.details || '').split('\n').forEach((line) => { const i = line.indexOf(':'); if (i > 0) details[line.slice(0, i).trim()] = line.slice(i + 1).trim(); });
        const body = { ...v, details, highlights: String(v.highlights || '').split('\n').map((x) => x.trim()).filter(Boolean), target_raise: v.target_raise || null };
        if (isNew) { const r = await api.post('/api/admin/properties', body); toast('Property created.'); navigate(`/admin/properties/${r.id}`, { replace: true }); }
        else { await api.put(`/api/admin/properties/${p.id}`, body); toast('Changes saved.'); ctx.reload(); }
      });
      root.querySelector('[data-img]')?.addEventListener('change', async (e) => {
        try { const file = await uploadFile(e.target.files[0], { types: ['image/jpeg', 'image/png', 'image/webp'], purpose: 'property_image' }); await api.post(`/api/admin/properties/${p.id}/images`, { file }); toast('Image uploaded.'); ctx.reload(); }
        catch (err) { toast(err.message, 'bad'); }
      });
      root.querySelectorAll('[data-rmimg]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Remove this image?', message: 'It will no longer appear on the listing.', confirm: 'Remove', tone: 'danger' }))) return;
        await api.post(`/api/admin/properties/${p.id}/images/remove`, { file_id: Number(b.dataset.rmimg) }); ctx.reload();
      }));
      root.querySelectorAll('[data-rmdoc]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Remove this document?', message: 'Investors will no longer see it.', confirm: 'Remove', tone: 'danger' }))) return;
        await api.post(`/api/admin/property-documents/${b.dataset.rmdoc}/remove`); ctx.reload();
      }));
      root.querySelector('[data-adddoc]')?.addEventListener('click', () => modal({
        title: 'Add property document',
        body: `<form class="form" data-df novalidate>${field({ name: 'title', label: 'Title', required: true, attrs: 'maxlength="160"' })}
          <div class="field"><label for="pdoc">File</label><input id="pdoc" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required><p class="field__error" hidden></p></div>
          ${check({ name: 'is_public', label: 'Show on the public property page', checked: true })}<p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Upload</button></div></form>`,
        onMount(panel, close) {
          const f = panel.querySelector('[data-df]');
          bindForm(f, async (v) => {
            let file;
            try { file = await uploadFile(f.querySelector('#pdoc').files[0], { purpose: 'property_document' }); } catch (e) { throw { fields: {}, message: e.message }; }
            await api.post(`/api/admin/properties/${p.id}/documents`, { ...v, file }); close(); toast('Document added.'); ctx.reload();
          });
        },
      }));
    },
  };
}

/* ---------------------------------------------------------------------- plans */
export async function plans(ctx) {
  const [{ items }, L] = await Promise.all([api.get('/api/admin/plans'), api.get('/api/admin/lookups')]);
  const open = (pl) => modal({
    title: pl ? `Edit ${pl.name}` : 'Create plan',
    size: 'wide',
    body: `<form class="form" data-f novalidate><div class="form-grid">
      ${field({ name: 'name', label: 'Plan name', required: true, value: pl?.name || '', attrs: 'maxlength="100"' })}
      ${field({ name: 'property_id', label: 'Property', value: pl?.property_id || '', options: [['', 'All properties'], ...L.properties.map((p) => [p.id, p.name])] })}
      ${field({ name: 'duration_months', label: 'Duration (months)', type: 'number', value: pl?.duration_months ?? '', hint: 'Use months, or days for custom terms.', attrs: 'min="1" max="240"' })}
      ${field({ name: 'duration_days', label: 'Duration (days)', type: 'number', value: pl?.duration_days ?? '', attrs: 'min="1" max="7300"' })}
      ${field({ name: 'min_amount', label: 'Minimum (USD)', type: 'number', required: true, value: pl?.min_amount ?? '', attrs: 'min="1"' })}
      ${field({ name: 'max_amount', label: 'Maximum (USD)', type: 'number', value: pl?.max_amount ?? '', attrs: 'min="1"' })}
      ${field({ name: 'return_type', label: 'Return structure', value: pl?.return_type || 'pending', options: [['pending', 'Pending approval'], ['fixed_total', 'Fixed % over the term'], ['fixed_annual', 'Fixed % per year (pro-rated)']] })}
      ${field({ name: 'return_rate', label: 'Return rate (%)', type: 'number', value: pl?.return_rate ?? '', attrs: 'min="0" max="1000" step="0.01"' })}
      ${field({ name: 'return_note', label: 'Return note shown to investors', full: true, value: pl?.return_note || '', attrs: 'maxlength="500"' })}
      ${field({ name: 'terms', label: 'Plan terms', type: 'textarea', full: true, rows: 3, value: pl?.terms || '' })}
      ${field({ name: 'risk_info', label: 'Risk information', type: 'textarea', full: true, rows: 3, value: pl?.risk_info || '' })}
      ${field({ name: 'required_docs', label: 'Required documents', value: pl?.required_docs || '', attrs: 'maxlength="500"' })}
      ${field({ name: 'sort', label: 'Display order', type: 'number', value: pl?.sort ?? 0, attrs: 'min="0" max="1000"' })}
      ${field({ name: 'available_from', label: 'Available from', type: 'date', value: pl?.available_from ? pl.available_from.slice(0, 10) : '' })}
      ${field({ name: 'available_to', label: 'Available until', type: 'date', value: pl?.available_to ? pl.available_to.slice(0, 10) : '' })}
      ${field({ name: 'status', label: 'Status', value: pl?.status || 'active', options: [['active', 'Active'], ['inactive', 'Inactive']] })}
    </div>
    ${check({ name: 'return_approved', label: 'The return structure has been approved by legal counsel and may be shown to investors', checked: !!pl?.return_approved })}
    <div class="callout callout--warn">${icon('alert')}<div><p>Only enter return figures supplied and legally approved by the company. Unapproved figures are never shown to investors.</p></div></div>
    <p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">${pl ? 'Save plan' : 'Create plan'}</button></div></form>`,
    onMount(panel, close) {
      bindForm(panel.querySelector('[data-f]'), async (v) => {
        const body = { ...v, property_id: v.property_id ? Number(v.property_id) : null, available_from: v.available_from || null, available_to: v.available_to || null };
        if (pl) await api.put(`/api/admin/plans/${pl.id}`, body); else await api.post('/api/admin/plans', body);
        close(); toast(pl ? 'Plan saved.' : 'Plan created.'); ctx.reload();
      });
    },
  });
  return {
    title: 'Investment plans',
    html: `${head('Investment plans', 'Configure durations, limits and approved return rules.', `<button class="btn btn--gold" data-new>${icon('plus')} Create plan</button>`)}
    <section class="card card--table"><div class="table-wrap"><table class="table"><thead><tr><th>Plan</th><th>Duration</th><th class="num">Min</th><th class="num">Max</th><th>Return</th><th>Property</th><th>Status</th><th class="num">Investments</th><th></th></tr></thead><tbody>
      ${items.map((pl) => `<tr><td><strong>${esc(pl.name)}</strong></td><td>${esc(duration(pl))}</td><td class="num">${money(pl.min_amount)}</td><td class="num">${pl.max_amount ? money(pl.max_amount) : '—'}</td>
      <td>${pl.return_approved ? `${pl.return_rate}% ${pl.return_type === 'fixed_annual' ? 'p.a.' : 'total'} ${badge('approved')}` : `<span class="muted">${pl.return_rate != null ? `${pl.return_rate}% (not approved)` : 'Pending'}</span>`}</td>
      <td>${esc(pl.property_name || 'All')}</td><td>${badge(pl.status)}</td><td class="num">${pl.investment_count}</td><td><button class="btn btn--ghost btn--sm" data-edit="${pl.id}">Edit</button> <button class="btn btn--ghost btn--sm" data-del="${pl.id}">Delete</button></td></tr>`).join('')}
    </tbody></table></div></section>`,
    mount(root) {
      root.querySelector('[data-new]').addEventListener('click', () => open(null));
      root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Delete this plan?', message: 'It will be removed from the website. This cannot be undone.', confirm: 'Delete', tone: 'danger' }))) return;
        try { await api.del(`/api/admin/plans/${b.dataset.del}`); toast('Plan deleted.'); ctx.reload(); } catch (e) { toast(e.message, 'bad'); }
      }));
      root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => open(items.find((x) => x.id === Number(b.dataset.edit)))));
    },
  };
}

/* ------------------------------------------------------------------- support */
export async function tickets(ctx) {
  const { items } = await api.get(`/api/admin/tickets${qs({ status: ctx.query.status })}`);
  const tabs = [['', 'All'], ['open', 'Open'], ['pending', 'Awaiting investor'], ['resolved', 'Resolved'], ['closed', 'Closed']];
  return {
    title: 'Support',
    live: liveReload(ctx, `/api/admin/tickets${qs({ status: ctx.query.status })}`, (d) => d.items.map((t) => [t.id, t.status, t.updated_at]), { items }),
    html: `${head('Support requests', 'Messages, enquiries and tickets from investors and visitors.')}
    <nav class="tabs">${tabs.map(([k, l]) => `<a class="tabs__tab" href="/admin/support${k ? `?status=${k}` : ''}" ${(ctx.query.status || '') === k ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <section class="card card--table">${items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Ref</th><th>From</th><th>Subject</th><th>Topic</th><th>Status</th><th>Updated</th></tr></thead><tbody>
      ${items.map((t) => `<tr><td><a href="/admin/support/${t.id}"><strong>${esc(t.ref)}</strong></a></td><td>${person(t.name, t.email)}</td><td>${esc(t.subject)}${t.property_name ? `<br><small class="muted">${esc(t.property_name)}</small>` : ''}</td><td>${esc(sentence(t.category))}</td><td>${badge(t.status, t.status === 'pending' ? 'Awaiting investor' : null)}</td><td>${ago(t.updated_at)}</td></tr>`).join('')}
    </tbody></table></div>` : empty('No requests', 'New messages will appear here.')}</section>`,
  };
}

export async function ticket(ctx) {
  const { ticket: t, messages } = await api.get(`/api/admin/tickets/${encodeURIComponent(ctx.params.id)}`);
  const msgHtml = (m) => `<li class="thread__msg ${m.author_type === 'admin' ? 'thread__msg--staff' : ''}"><header><strong>${m.author_type === 'admin' ? `${esc(m.first_name || 'Admin')} (staff)` : esc(t.name)}</strong><small>${dateTime(m.created_at)}</small></header><p>${esc(m.body).replace(/\n/g, '<br>')}</p></li>`;
  let count = messages.length;
  return {
    title: t.ref,
    async live(root) {
      const d = await api.get(`/api/admin/tickets/${encodeURIComponent(ctx.params.id)}`);
      if (d.messages.length === count) return;
      count = d.messages.length;
      root.querySelector('.thread').innerHTML = d.messages.map(msgHtml).join('');
    },
    html: `<nav class="crumbs"><a href="/admin/support">Support</a>${icon('chevronRight')}<span>${esc(t.ref)}</span></nav>
    ${head(t.subject, `${t.ref} · ${t.name} · ${t.email}${t.phone ? ` · ${t.phone}` : ''}`, `<label class="select-inline"><span>Status</span><select data-st>${['open', 'pending', 'resolved', 'closed'].map((s) => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s === 'pending' ? 'Awaiting investor' : sentence(s)}</option>`).join('')}</select></label>`)}
    <section class="card"><ol class="thread">${messages.map(msgHtml).join('')}</ol>
    <form class="form" data-f novalidate>${field({ name: 'message', label: t.user_id ? 'Reply (the investor is notified)' : 'Reply (sent by email)', type: 'textarea', required: true, rows: 4, attrs: 'minlength="2" maxlength="5000"' })}<p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Send reply</button></div></form></section>`,
    mount(root) {
      bindForm(root.querySelector('[data-f]'), async (v) => { await api.post(`/api/admin/tickets/${t.id}/messages`, v); toast('Reply sent.'); ctx.reload(); });
      root.querySelector('[data-st]').addEventListener('change', async (e) => { await api.post(`/api/admin/tickets/${t.id}/status`, { status: e.target.value }); toast('Status updated.'); });
    },
  };
}

/* ----------------------------------------------------------------- documents */
export async function documents(ctx) {
  const [{ items }, L] = await Promise.all([api.get('/api/admin/documents'), api.get('/api/admin/lookups')]);
  return {
    title: 'Documents',
    html: `${head('Investor documents', 'Agreements, statements and other documents issued to investors.', `<button class="btn btn--gold" data-new>${icon('upload')} Issue document</button>`)}
    <section class="card card--table">${items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Title</th><th>Category</th><th>Investor</th><th>Investment</th><th>Issued</th><th></th></tr></thead><tbody>
      ${items.map((x) => `<tr><td><strong>${esc(x.title)}</strong></td><td>${esc(sentence(x.category))}</td><td>${x.user_id ? `${esc(x.first_name)} ${esc(x.last_name)}` : '<span class="muted">All investors</span>'}</td><td>${esc(x.investment_ref || '—')}</td><td>${date(x.created_at)}</td><td>${x.url ? `<a class="btn btn--ghost btn--sm" target="_blank" href="${x.url}">View</a>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : empty('No documents issued', 'Upload agreements, statements or notices for investors.')}</section>
    <p class="note">${icon('info')} Certificates and payment receipts are generated automatically for every funded investment.</p>`,
    mount(root) { root.querySelector('[data-new]').addEventListener('click', () => issueDocModal({ investors: L.investors }, () => ctx.reload())); },
  };
}

/* ---------------------------------------------------------------- CMS editor */
function listEditor(name, items, fields) {
  const row = (it = {}) => `<div class="rep__row">${fields.map((f) => field({ name: `${name}.${f.key}`, label: f.label, type: f.type || 'text', value: it[f.key] || '', rows: 2, full: f.full })).join('')}<button type="button" class="icon-btn" data-rm aria-label="Remove">${icon('trash')}</button></div>`;
  return `<div class="rep" data-rep="${name}">${items.map(row).join('')}<template>${row()}</template><button type="button" class="btn btn--ghost btn--sm" data-add>${icon('plus')} Add</button></div>`;
}
function readList(root, name, keys) {
  return [...root.querySelectorAll(`[data-rep="${name}"] > .rep__row`)].map((r) => Object.fromEntries(keys.map((k) => [k, r.querySelector(`[name="${name}.${k}"]`).value.trim()]))).filter((o) => Object.values(o).some(Boolean));
}
function bindLists(root) {
  root.querySelectorAll('[data-rep]').forEach((rep) => {
    rep.addEventListener('click', (e) => {
      if (e.target.closest('[data-rm]')) e.target.closest('.rep__row').remove();
      if (e.target.closest('[data-add]')) rep.querySelector('[data-add]').insertAdjacentHTML('beforebegin', rep.querySelector('template').innerHTML);
    });
  });
}

export async function content(ctx) {
  const { content: c } = await api.get('/api/admin/cms');
  const tab = ctx.query.tab || 'site';
  const tabs = [['site', 'Company & contact'], ['home', 'Homepage'], ['about', 'About'], ['how_it_works', 'How it works'], ['faqs', 'FAQs'], ['testimonials', 'Testimonials'], ['legal', 'Legal pages'], ['disclosures', 'Disclosures']];
  const s = c.site || {}, h = c.home || {}, a = c.about || {}, hw = c.how_it_works || { steps: [] }, lg = c.legal || {};
  const forms = {
    site: `<div class="form-grid">${['brand:Brand name', 'tagline:Tagline', 'email:Email', 'phone:Phone', 'whatsapp:WhatsApp number (digits only)', 'hours:Opening hours'].map((x) => { const [k, l] = x.split(':'); return field({ name: k, label: l, value: s[k] || '' }); }).join('')}
      ${field({ name: 'address', label: 'Address', full: true, value: s.address || '' })}${field({ name: 'registration', label: 'Registration & licensing statement', type: 'textarea', full: true, rows: 3, value: s.registration || '' })}</div>`,
    home: `${field({ name: 'hero_title', label: 'Hero headline', value: h.hero_title || '' })}${field({ name: 'hero_subtitle', label: 'Hero text', type: 'textarea', rows: 2, value: h.hero_subtitle || '' })}
      <h3 class="card__sub">Statistics</h3><div class="callout callout--warn">${icon('alert')}<div><p>Only publish figures you can verify.</p></div></div>${listEditor('stats', h.stats || [], [{ key: 'value', label: 'Value' }, { key: 'label', label: 'Label' }])}`,
    about: `${['intro:Introduction', 'history:History', 'mission:Mission', 'model:Business model', 'licensing:Registration & licensing'].map((x) => { const [k, l] = x.split(':'); return field({ name: k, label: l, type: 'textarea', rows: 3, value: a[k] || '' }); }).join('')}
      <h3 class="card__sub">Team</h3>${listEditor('team', a.team || [], [{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'bio', label: 'Bio', full: true }])}`,
    how_it_works: listEditor('steps', hw.steps || [], [{ key: 'title', label: 'Step title' }, { key: 'body', label: 'Description', type: 'textarea', full: true }]),
    faqs: listEditor('faqs', c.faqs || [], [{ key: 'q', label: 'Question' }, { key: 'category', label: 'Category' }, { key: 'a', label: 'Answer', type: 'textarea', full: true }]),
    testimonials: `<div class="callout callout--warn">${icon('alert')}<div><p>Publish only genuine testimonials with the investor’s permission.</p></div></div>${listEditor('testimonials', c.testimonials || [], [{ key: 'name', label: 'Name' }, { key: 'role', label: 'Detail' }, { key: 'quote', label: 'Quote', type: 'textarea', full: true }])}`,
    legal: Object.entries({ terms: 'Terms & Conditions', privacy: 'Privacy Policy', investment_terms: 'Investment Terms', risk: 'Risk Disclosure', kyc_aml: 'KYC / AML Policy', redemption: 'Redemption & Refund Policy', investor_agreement: 'Investor Agreement', crypto: 'Crypto Payment Disclosure' })
      .map(([k, l]) => `<details class="acc"><summary>${esc(lg[k]?.title || l)}${icon('chevron')}</summary>${field({ name: `${k}.title`, label: 'Title', value: lg[k]?.title || l })}${field({ name: `${k}.body`, label: 'Content', type: 'textarea', rows: 10, value: lg[k]?.body || '', hint: 'Formatting: ## heading, - bullet, **bold**.' })}</details>`).join(''),
    disclosures: field({ name: 'footer', label: 'Footer risk disclosure', type: 'textarea', rows: 4, value: c.disclosures?.footer || '' }),
  };
  return {
    title: 'Website content',
    html: `${head('Website content', 'Edit the public website. Changes go live as soon as you save.')}
    <nav class="tabs tabs--scroll">${tabs.map(([k, l]) => `<a class="tabs__tab" href="/admin/content?tab=${k}" ${tab === k ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <form class="card form" data-f novalidate>${forms[tab]}<p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Save ${esc(tabs.find((x) => x[0] === tab)[1].toLowerCase())}</button></div></form>`,
    mount(root) {
      bindLists(root);
      const form = root.querySelector('[data-f]');
      bindForm(form, async (v) => {
        let value;
        if (tab === 'site') value = v;
        else if (tab === 'home') value = { ...h, hero_title: v.hero_title, hero_subtitle: v.hero_subtitle, stats: readList(form, 'stats', ['value', 'label']) };
        else if (tab === 'about') value = { intro: v.intro, history: v.history, mission: v.mission, model: v.model, licensing: v.licensing, team: readList(form, 'team', ['name', 'role', 'bio']) };
        else if (tab === 'how_it_works') value = { steps: readList(form, 'steps', ['title', 'body']) };
        else if (tab === 'faqs') value = readList(form, 'faqs', ['q', 'a', 'category']);
        else if (tab === 'testimonials') value = readList(form, 'testimonials', ['name', 'role', 'quote']);
        else if (tab === 'legal') { value = {}; Object.keys(v).forEach((key) => { const [doc, part] = key.split('.'); (value[doc] = value[doc] || {})[part] = v[key]; }); }
        else value = { footer: v.footer };
        await api.put(`/api/admin/cms/${tab}`, { value });
        state.site = await api.get('/api/public/site');
        toast('Content saved and published.');
      });
    },
  };
}

/* ---------------------------------------------------------------------- news */
export async function news(ctx) {
  const { items } = await api.get('/api/admin/posts');
  const open = (p) => modal({
    title: p ? 'Edit article' : 'New article', size: 'wide',
    body: `<form class="form" data-f novalidate>${field({ name: 'title', label: 'Title', required: true, value: p?.title || '', attrs: 'maxlength="160"' })}${field({ name: 'excerpt', label: 'Summary', value: p?.excerpt || '', attrs: 'maxlength="300"' })}
      ${field({ name: 'body', label: 'Article', type: 'textarea', required: true, rows: 10, value: p?.body || '', hint: 'Formatting: ## heading, - bullet, **bold**.' })}${field({ name: 'status', label: 'Status', value: p?.status || 'draft', options: [['draft', 'Draft'], ['published', 'Published']] })}
      <p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Save article</button></div></form>`,
    onMount(panel, close) {
      bindForm(panel.querySelector('[data-f]'), async (v) => { if (p) await api.put(`/api/admin/posts/${p.id}`, v); else await api.post('/api/admin/posts', v); close(); toast('Article saved.'); ctx.reload(); });
    },
  });
  return {
    title: 'News',
    html: `${head('News & updates', 'Publish project updates and company news.', `<button class="btn btn--gold" data-new>${icon('plus')} New article</button>`)}
    <section class="card card--table">${items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Title</th><th>Status</th><th>Published</th><th></th></tr></thead><tbody>
      ${items.map((p) => `<tr><td><strong>${esc(p.title)}</strong><br><small class="muted">${esc(p.excerpt || '')}</small></td><td>${badge(p.status)}</td><td>${date(p.published_at)}</td><td class="nowrap"><button class="btn btn--ghost btn--sm" data-edit="${p.id}">Edit</button> <button class="icon-btn" data-del="${p.id}" aria-label="Delete">${icon('trash')}</button></td></tr>`).join('')}
    </tbody></table></div>` : empty('No articles', 'Write your first update.')}</section>`,
    mount(root) {
      root.querySelector('[data-new]').addEventListener('click', () => open(null));
      root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => open(items.find((x) => x.id === Number(b.dataset.edit)))));
      root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Delete this article?', message: 'This cannot be undone.', confirm: 'Delete', tone: 'danger' }))) return;
        await api.del(`/api/admin/posts/${b.dataset.del}`); toast('Article deleted.'); ctx.reload();
      }));
    },
  };
}

/* ------------------------------------------------------------------- reports */
export async function reports() {
  const types = [['investors', 'Investors', 'All registered investors with KYC status and total invested.'], ['investments', 'Investments', 'Every investment with amounts, status and dates.'], ['payments', 'Payments', 'All deposits and payouts with transaction hashes.'], ['redemptions', 'Redemptions', 'Redemption requests and payout details.']];
  return {
    title: 'Reports',
    html: `${head('Reports', 'Export platform data as CSV (opens in Excel, Numbers and Google Sheets).')}
    <form class="filters" data-range><label class="field field--inline"><span>From</span><input type="date" name="from"></label><label class="field field--inline"><span>To</span><input type="date" name="to"></label></form>
    <div class="grid grid--2">${types.map(([k, l, dsc]) => `<section class="card report"><h2 class="card__title">${l} report</h2><p class="muted">${dsc}</p><p class="small" data-count="${k}"></p><div class="form__actions form__actions--left"><button class="btn btn--ghost btn--sm" data-preview="${k}">Count rows</button><a class="btn btn--gold btn--sm" data-dl="${k}" href="/api/admin/reports/${k}" data-native>${icon('download')} Download CSV</a></div></section>`).join('')}</div>`,
    mount(root) {
      const range = () => Object.fromEntries(new FormData(root.querySelector('[data-range]')));
      const sync = () => root.querySelectorAll('[data-dl]').forEach((a) => { a.href = `/api/admin/reports/${a.dataset.dl}${qs(range())}`; });
      root.querySelector('[data-range]').addEventListener('change', sync);
      root.querySelectorAll('[data-preview]').forEach((b) => b.addEventListener('click', async () => {
        try { const r = await api.get(`/api/admin/reports/${b.dataset.preview}${qs({ ...range(), format: 'json' })}`); root.querySelector(`[data-count="${b.dataset.preview}"]`).textContent = `${num(r.rows)} row${r.rows === 1 ? '' : 's'} in this range.`; }
        catch (e) { toast(e.message, 'bad'); }
      }));
    },
  };
}

/* ----------------------------------------------------------------- audit log */
export async function audit(ctx) {
  const d = await api.get(`/api/admin/audit-logs${qs(ctx.query)}`);
  return {
    title: 'Audit logs',
    html: `${head('Audit logs', 'Append-only record of security and financial actions.')}
    ${filterBar(ctx, { placeholder: 'Search action, admin email or entity' })}
    <section class="card card--table"><div class="table-wrap"><table class="table table--compact"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>IP</th><th>Change</th></tr></thead><tbody>
      ${d.items.map((l) => `<tr><td class="nowrap">${dateTime(l.created_at)}</td><td>${esc(l.actor_email || 'System')}</td><td><code>${esc(l.action)}</code></td><td>${esc(l.entity || '')} ${esc(l.entity_id || '')}</td><td class="mono">${esc(l.ip || '')}</td>
      <td>${l.before_data || l.after_data ? `<details class="diff"><summary>View</summary>${l.before_data ? `<p><strong>Before</strong></p><pre>${esc(pretty(l.before_data))}</pre>` : ''}${l.after_data ? `<p><strong>After</strong></p><pre>${esc(pretty(l.after_data))}</pre>` : ''}</details>` : '—'}</td></tr>`).join('')}
    </tbody></table></div>${pager(d.page, d.size, d.total, pageLink(ctx))}</section>`,
    mount(root) { bindFilters(root, ctx); },
  };
}
const pretty = (s) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };

/* -------------------------------------------------------------- super admin */
export async function admins(ctx) {
  const { items, permissions } = await api.get('/api/admin/admins');
  const permBoxes = (cur = []) => `<fieldset class="perm-grid"><legend>Permissions (for admins)</legend>${permissions.map((p) => `<label class="check-inline"><input type="checkbox" name="permissions" data-group value="${p}" ${cur.includes(p) ? 'checked' : ''}> ${esc(sentence(p))}</label>`).join('')}</fieldset>`;
  return {
    title: 'Administrators',
    html: `${head('Administrators', 'Manage admin accounts, roles and permissions.', `<button class="btn btn--gold" data-new>${icon('plus')} Add administrator</button>`)}
    <section class="card card--table"><div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Role</th><th>Permissions</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>
      ${items.map((u) => `<tr><td>${person(`${u.first_name} ${u.last_name}`, u.email)}</td><td>${u.role === 'super_admin' ? 'Super admin' : 'Admin'}</td><td class="small">${u.role === 'super_admin' ? 'Everything' : Array.isArray(u.permissions) ? esc(u.permissions.map(sentence).join(', ') || 'None') : 'All areas'}</td><td>${badge(u.status)}</td><td>${dateTime(u.last_login_at)}</td><td>${u.id !== state.user.id ? `<button class="btn btn--ghost btn--sm" data-edit="${u.id}">Edit</button>` : '<span class="muted small">You</span>'}</td></tr>`).join('')}
    </tbody></table></div></section>`,
    mount(root) {
      root.querySelector('[data-new]').addEventListener('click', () => modal({
        title: 'Add administrator',
        body: `<form class="form" data-f novalidate><div class="form-grid">${field({ name: 'first_name', label: 'First name', required: true })}${field({ name: 'last_name', label: 'Last name', required: true })}
          ${field({ name: 'email', label: 'Email', type: 'email', required: true })}${field({ name: 'password', label: 'Temporary password', type: 'password', required: true, attrs: 'minlength="8" autocomplete="new-password"' })}
          ${field({ name: 'role', label: 'Role', required: true, options: [['admin', 'Admin'], ['super_admin', 'Super admin']] })}</div>${permBoxes(permissions)}
          <p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Create administrator</button></div></form>`,
        onMount(panel, close) { bindForm(panel.querySelector('[data-f]'), async (v) => { await api.post('/api/admin/admins', v); close(); toast('Administrator created.'); ctx.reload(); }); },
      }));
      root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
        const u = items.find((x) => x.id === Number(b.dataset.edit));
        modal({
          title: `Edit ${u.first_name} ${u.last_name}`,
          body: `<form class="form" data-f novalidate><div class="form-grid">${field({ name: 'role', label: 'Role', value: u.role, options: [['admin', 'Admin'], ['super_admin', 'Super admin']] })}${field({ name: 'status', label: 'Status', value: u.status, options: [['active', 'Active'], ['suspended', 'Suspended']] })}</div>
            ${permBoxes(Array.isArray(u.permissions) ? u.permissions : permissions)}<p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Save</button></div></form>`,
          onMount(panel, close) { bindForm(panel.querySelector('[data-f]'), async (v) => { await api.put(`/api/admin/admins/${u.id}`, v); close(); toast('Administrator updated.'); ctx.reload(); }); },
        });
      }));
    },
  };
}

export async function settings(ctx) {
  const { payments: p, investing: iv } = await api.get('/api/admin/settings');
  const curRow = (c, i) => `<fieldset class="cur" data-cur="${i}"><legend><strong>${esc(c.code)}</strong> ${esc(c.name)}</legend><div class="form-grid form-grid--4">
    ${field({ name: `c${i}.code`, label: 'Code', value: c.code, required: true, attrs: 'maxlength="10"' })}${field({ name: `c${i}.name`, label: 'Name', value: c.name, required: true })}
    ${field({ name: `c${i}.rate_usd`, label: 'USD rate', type: 'number', value: c.rate_usd, required: true, attrs: 'min="0" step="any"' })}${field({ name: `c${i}.decimals`, label: 'Decimals', type: 'number', value: c.decimals, attrs: 'min="0" max="18"' })}</div>
    ${check({ name: `c${i}.enabled`, label: 'Accept this currency', checked: c.enabled })}
    ${c.networks.map((n, j) => `<div class="form-grid form-grid--net">${field({ name: `c${i}.n${j}.code`, label: 'Network code', value: n.code })}${field({ name: `c${i}.n${j}.name`, label: 'Network name', value: n.name })}${field({ name: `c${i}.n${j}.address`, label: 'Receiving address (public)', value: n.address, attrs: 'maxlength="120" spellcheck="false"' })}</div>`).join('')}
  </fieldset>`;
  return {
    title: 'Platform settings',
    html: `${head('Platform settings', 'Investment rules and crypto payment configuration.')}
    <form class="card form" data-inv novalidate><h2 class="card__title">Investing</h2>
      ${check({ name: 'enabled', label: 'Allow new investments (keep off until legal and regulatory approvals are in place)', checked: iv.enabled })}
      ${check({ name: 'kyc_required', label: 'Require approved KYC before investing', checked: iv.kyc_required })}
      ${check({ name: 'redemptions_enabled', label: 'Allow redemption requests', checked: iv.redemptions_enabled })}
      ${check({ name: 'early_redemption', label: 'Allow early redemption requests (before maturity)', checked: iv.early_redemption })}
      ${field({ name: 'maturing_window_days', label: '“Maturing” notice window (days)', type: 'number', required: true, value: iv.maturing_window_days, attrs: 'min="1" max="90"' })}
      <p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Save investing rules</button></div></form>
    <form class="card form" data-pay novalidate><h2 class="card__title">Crypto payments</h2>
      <div class="callout">${icon('lock')}<div><p>Only public receiving addresses are stored. Never enter private keys or seed phrases. Rates last updated: ${dateTime(p.rates_updated_at)}.</p></div></div>
      <div class="form-grid">${field({ name: 'mode', label: 'Verification mode', value: p.mode, options: [['manual', 'Manual — admins verify transaction hashes'], ['provider', 'Provider — confirmed via webhook']] })}
      ${field({ name: 'window_minutes', label: 'Payment window (minutes)', type: 'number', required: true, value: p.window_minutes, attrs: 'min="10" max="1440"' })}
      ${field({ name: 'required_confirmations', label: 'Required confirmations', type: 'number', required: true, value: p.required_confirmations, attrs: 'min="0" max="100"' })}</div>
      ${check({ name: 'auto_activate', label: 'Activate investments automatically when payment is confirmed', checked: p.auto_activate })}
      ${check({ name: 'demo_addresses', label: 'Show “demo address” warning to investors (turn off once live wallets are set)', checked: p.demo_addresses })}
      ${p.currencies.map(curRow).join('')}
      <p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Save payment settings</button></div></form>`,
    mount(root) {
      bindForm(root.querySelector('[data-inv]'), async (v) => { await api.put('/api/admin/settings/investing', { value: v }); state.site = await api.get('/api/public/site'); toast('Investing rules saved.'); });
      bindForm(root.querySelector('[data-pay]'), async (v) => {
        const currencies = p.currencies.map((c, i) => ({
          code: v[`c${i}.code`], name: v[`c${i}.name`], rate_usd: v[`c${i}.rate_usd`], decimals: v[`c${i}.decimals`], enabled: v[`c${i}.enabled`],
          networks: c.networks.map((n, j) => ({ code: v[`c${i}.n${j}.code`], name: v[`c${i}.n${j}.name`], address: v[`c${i}.n${j}.address`] })),
        }));
        await api.put('/api/admin/settings/payments', { value: { mode: v.mode, window_minutes: v.window_minutes, required_confirmations: v.required_confirmations, auto_activate: v.auto_activate, demo_addresses: v.demo_addresses, currencies } });
        state.site = await api.get('/api/public/site');
        toast('Payment settings saved.');
        ctx.reload();
      });
    },
  };
}

export async function emails() {
  const { items } = await api.get('/api/admin/emails');
  return {
    title: 'Email log',
    html: `${head('Email log', 'Recent outgoing emails. Without an email provider configured, messages are logged here instead of being sent.')}
    <section class="card card--table">${items.length ? `<div class="table-wrap"><table class="table table--compact"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th><th>Body</th></tr></thead><tbody>
      ${items.map((m) => `<tr><td class="nowrap">${dateTime(m.created_at)}</td><td>${esc(m.to_email)}</td><td>${esc(m.subject)}</td><td>${badge(m.status === 'sent' ? 'confirmed' : m.status === 'failed' ? 'failed' : 'pending', sentence(m.status))}${m.error ? `<br><small class="text-bad">${esc(m.error)}</small>` : ''}</td><td><details class="diff"><summary>View</summary><pre>${esc(m.body_text)}</pre></details></td></tr>`).join('')}
    </tbody></table></div>` : empty('No emails yet', 'Outgoing emails will appear here.')}</section>`,
  };
}

export async function account(ctx) { return accountSettings(ctx); }
