import { api, qs } from '../api.js';
import {
  esc, icon, money, num, date, dateTime, ago, badge, bindForm, field, check, toast, modal, confirmDialog, TYPE_LABEL, duration, pctText, returnPeriod,
  empty, uploadFile, uploadMany, fileSize, copyText, shortHash, statusText, sentence, label,
} from '../ui.js';
import { propertyVisual } from '../art.js';
import { qrSvg } from '../qr.js';
import { lineChart, donut } from '../charts.js';
import { state, navigate, refreshUser, refreshUnread, liveReload } from '../app.js';
import * as Pub from './public.js';
import { COUNTRIES } from './auth.js';

const head = (title, sub = '', actions = '') => `<div class="page__head"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${actions ? `<div class="page__actions">${actions}</div>` : ''}</div>`;
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

function kycBanner() {
  const s = state.user.kyc_status;
  if (s === 'approved') return '';
  const map = {
    not_started: ['Verify your identity to start investing', 'It takes about five minutes. Have your ID and a recent proof of address ready.', 'Start verification'],
    requires_info: ['We need more information', 'Our compliance team asked you to update your verification.', 'Update verification'],
    rejected: ['Verification was not approved', 'Review the reason and contact support if you have questions.', 'View details'],
    pending_review: ['Verification under review', 'We’re reviewing your documents. This usually takes 1–2 business days.', 'View status'],
  }[s];
  return `<div class="callout ${s === 'pending_review' ? '' : 'callout--warn'}">${icon('shield')}<div><strong>${map[0]}</strong><p>${map[1]}</p></div><a class="btn btn--gold btn--sm" href="/app/kyc">${map[2]}</a></div>`;
}

function invRow(i) {
  return `<tr><td><a href="/app/investments/${i.id}"><strong>${esc(i.ref)}</strong></a></td><td>${esc(i.property_name)}</td><td>${esc(i.plan_name)}</td>
  <td class="num">${money(i.amount_usd)}</td><td>${esc(i.currency)}</td><td>${badge(i.status, i.status_label)}</td><td>${date(i.maturity_date)}</td></tr>`;
}
const invTable = (items) => `<div class="table-wrap"><table class="table"><thead><tr><th>ID</th><th>Property</th><th>Plan</th><th class="num">Amount</th><th>Currency</th><th>Status</th><th>Maturity</th></tr></thead><tbody>${items.map(invRow).join('')}</tbody></table></div>`;

/* ------------------------------------------------------------------ dashboard */
export async function dashboard() {
  const d = await api.get('/api/me/dashboard');
  const s = d.stats;
  const alloc = Object.entries(d.allocation).map(([k, v]) => ({ label: TYPE_LABEL[k] || k, value: v })).sort((a, b) => b.value - a.value);
  const nm = s.next_maturity;
  return {
    title: 'Overview',
    html: `${head(`${greeting()}, ${state.user.first_name}`, 'Here’s an overview of your investments.', '<a class="btn btn--gold" href="/app/invest">' + icon('plus') + ' New investment</a>')}
    ${kycBanner()}
    <div class="stats">
      <div class="stat"><span class="stat__ico stat__ico--green">${icon('wallet')}</span><div><p>Total invested</p><strong>${money(s.total_invested)}</strong>${s.change_pct ? `<small class="${s.change_pct > 0 ? 'up' : 'down'}">${icon('trend')} ${s.change_pct > 0 ? '+' : ''}${s.change_pct}% vs last month</small>` : '<small class="muted">Across all funded investments</small>'}</div></div>
      <div class="stat"><span class="stat__ico stat__ico--blue">${icon('building')}</span><div><p>Active investments</p><strong>${s.active}</strong><small class="muted">${s.completed} matured or completed</small></div></div>
      <div class="stat"><span class="stat__ico stat__ico--red">${icon('card')}</span><div><p>Pending payments</p><strong>${s.pending_payments}</strong>${s.pending_payments ? '<small><a href="/app/transactions">Review payments</a></small>' : '<small class="muted">Nothing outstanding</small>'}</div></div>
      <div class="stat"><span class="stat__ico stat__ico--gold">${icon('clock')}</span><div><p>Next maturity</p><strong>${nm ? date(nm.date) : '—'}</strong>${nm ? `<small><a href="/app/investments/${nm.id}">${esc(nm.ref)}</a></small>` : '<small class="muted">No active investments</small>'}</div></div>
    </div>
    <div class="grid grid--dash">
      <section class="card"><header class="card__head"><h2 class="card__title">Portfolio value</h2><span class="muted small">Principal invested · last 8 months</span></header>${lineChart(d.series)}</section>
      <section class="card"><header class="card__head"><h2 class="card__title">Investment allocation</h2></header>${alloc.length ? donut(alloc, { center: money(s.current_principal, { compact: true }), sub: 'Total invested' }) : empty('No allocation yet', 'Your allocation appears once an investment is funded.')}</section>
    </div>
    <div class="grid grid--dash">
      <section class="card"><header class="card__head"><h2 class="card__title">Recent investments</h2><a class="link-arrow" href="/app/investments">View all ${icon('arrow')}</a></header>
        ${d.investments.length ? invTable(d.investments) : empty('No investments yet', 'Browse properties to make your first investment.', '<a class="btn btn--gold" href="/app/properties">Browse properties</a>')}</section>
      <section class="card"><header class="card__head"><h2 class="card__title">Latest updates</h2><a class="link-arrow" href="/app/notifications">All ${icon('arrow')}</a></header>
        ${d.notifications.length ? `<ul class="feed">${d.notifications.map((n) => `<li class="${n.read_at ? '' : 'is-unread'}"><span class="feed__dot"></span><div><strong>${esc(n.title)}</strong><p>${esc(n.body || '')}</p><small>${ago(n.created_at)}</small></div></li>`).join('')}</ul>` : '<p class="muted">You’re all caught up.</p>'}</section>
    </div>`,
  };
}

/* ---------------------------------------------------------------- investments */
export async function investments(ctx) {
  const { items } = await api.get('/api/me/investments');
  const groups = { all: () => true, active: (i) => ['active', 'maturing', 'payment_confirmed'].includes(i.status), awaiting: (i) => ['payment_awaiting', 'pending', 'under_review'].includes(i.status), matured: (i) => ['matured'].includes(i.status), closed: (i) => ['completed', 'redeemed', 'cancelled', 'suspended', 'disputed'].includes(i.status) };
  const f = groups[ctx.query.f] ? ctx.query.f : 'all';
  const list = items.filter(groups[f]);
  const tabs = [['all', 'All'], ['active', 'Active'], ['awaiting', 'Awaiting payment'], ['matured', 'Matured'], ['closed', 'Closed']];
  return {
    title: 'Investments',
    html: `${head('Investments', 'Every investment you’ve made, with its status and dates.', `<a class="btn btn--gold" href="/app/invest">${icon('plus')} New investment</a>`)}
    <nav class="tabs" aria-label="Filter">${tabs.map(([k, l]) => `<a class="tabs__tab" href="/app/investments${k === 'all' ? '' : `?f=${k}`}" ${f === k ? 'aria-current="page"' : ''}>${l} <span class="count">${items.filter(groups[k]).length}</span></a>`).join('')}</nav>
    <section class="card card--table">${list.length ? invTable(list) : empty('Nothing here', 'No investments match this filter.')}</section>`,
  };
}

function paymentPanel(p, inv, networkName, demo) {
  const left = Math.max(0, new Date(p.expires_at).getTime() - Date.now());
  return `<section class="card pay" data-pay="${p.id}">
    <header class="card__head"><h2 class="card__title">Payment details</h2>${badge(p.status)}</header>
    ${demo ? `<div class="callout callout--warn">${icon('alert')}<div><strong>Demo wallet address</strong><p>This address is a placeholder. Do not send real funds until the platform owner configures live wallets.</p></div></div>` : ''}
    <div class="pay__grid">
      <div class="pay__fields">
        <div class="pay__row"><div><small>Amount to pay</small><strong class="pay__amt">${num(p.amount_crypto, 8)} ${esc(p.currency)}</strong><small class="muted">≈ ${money(p.amount_usd, { cents: true })}</small></div>
        <div><small>Network</small><strong>${esc(networkName || p.network)}</strong></div></div>
        <div class="field"><label for="addr-${p.id}">Wallet address</label><div class="copy"><input id="addr-${p.id}" readonly value="${esc(p.wallet_address)}"><button class="btn btn--primary btn--sm" data-copy="${esc(p.wallet_address)}">${icon('copy')} Copy</button></div></div>
        ${p.status === 'awaiting' ? `<p class="pay__timer" data-expires="${esc(p.expires_at)}">${icon('clock')} <span>${left ? 'Time remaining: <b></b>' : 'This payment window has expired.'}</span></p>` : ''}
      </div>
      <div class="pay__qr"><small>Scan QR code</small>${qrSvg(p.wallet_address)}</div>
    </div>
    <div class="callout">${icon('info')}<div><p>Send exactly <strong>${num(p.amount_crypto, 8)} ${esc(p.currency)}</strong> on <strong>${esc(networkName || p.network)}</strong> to the address above. Sending a different asset or using another network may result in permanent loss.</p></div></div>
    ${p.status === 'awaiting' ? `<form class="form pay__form" data-txform novalidate>
      ${field({ name: 'tx_hash', label: 'Transaction hash (TxID)', required: true, placeholder: 'Paste it from your wallet after sending', hint: 'We use it to find and verify your payment on the blockchain.', attrs: 'maxlength="130" autocomplete="off" spellcheck="false"' })}
      <p class="form-error" hidden></p>
      <div class="form__actions"><button class="btn btn--ghost" type="button" data-cancel="${inv.id}">Cancel investment</button><button class="btn btn--gold" type="submit">I’ve sent the payment</button></div>
    </form>` : ''}
    ${p.status === 'submitted' ? `<div class="callout callout--ok">${icon('check')}<div><strong>Payment submitted</strong><p>We’re verifying transaction <code>${esc(shortHash(p.tx_hash, 10))}</code>. You’ll be notified when it’s confirmed.</p></div></div>` : ''}
  </section>`;
}

function bindPayment(root, onDone) {
  root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy)));
  const timer = root.querySelector('[data-expires]');
  if (timer && timer.querySelector('b')) {
    const end = new Date(timer.dataset.expires).getTime();
    const tick = () => {
      if (!document.body.contains(timer)) return clearInterval(iv);
      const s = Math.max(0, Math.round((end - Date.now()) / 1000));
      timer.querySelector('b').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (!s) { clearInterval(iv); timer.innerHTML = `${icon('alert')} <span>This payment window has expired. Start a new investment if you still want to invest.</span>`; root.querySelector('[data-txform]')?.remove(); }
    };
    const iv = setInterval(tick, 1000);
    tick();
  }
  const form = root.querySelector('[data-txform]');
  if (form) {
    bindForm(form, async (d) => {
      await api.post(`/api/me/payments/${root.querySelector('[data-pay]').dataset.pay}/submit`, d);
      toast('Payment submitted for verification.');
      onDone('submitted');
    });
  }
  root.querySelector('[data-cancel]')?.addEventListener('click', async (e) => {
    const ok = await confirmDialog({ title: 'Cancel this investment?', message: 'Only cancel if you have not sent any funds. This cannot be undone.', confirm: 'Cancel investment', tone: 'danger' });
    if (!ok) return;
    try { await api.post(`/api/me/investments/${e.target.closest('[data-cancel]').dataset.cancel}/cancel`); toast('Investment cancelled.'); onDone('cancelled'); }
    catch (err) { toast(err.message, 'bad'); }
  });
}

export async function investment(ctx) {
  const d = await api.get(`/api/me/investments/${encodeURIComponent(ctx.params.id)}`);
  const i = d.investment;
  const site = state.site || {};
  const pay = d.payments.find((p) => p.kind === 'deposit' && ['awaiting', 'submitted'].includes(p.status));
  const netName = (site.currencies || []).find((c) => c.code === i.currency)?.networks.find((n) => n.code === i.network)?.name;
  const canWithdraw = i.status === 'matured' && site.redemptions_enabled && !d.redemptions.some((r) => ['requested', 'under_review', 'approved'].includes(r.status));
  const rt = i.return_terms || {};
  return {
    title: i.ref,
    html: `<nav class="crumbs"><a href="/app/investments">Investments</a>${icon('chevronRight')}<span>${esc(i.ref)}</span></nav>
    ${head(i.ref, `${i.property_name} · ${i.plan_name}`, `${badge(i.status, i.status_label)}${canWithdraw ? `<button class="btn btn--gold" data-withdraw>${icon('wallet')} Withdraw</button>` : ''}`)}
    ${pay ? paymentPanel(pay, i, netName, site.demo_addresses) : ''}
    <div class="grid grid--dash">
      <section class="card"><h2 class="card__title">Investment details</h2>
        <dl class="kv kv--wide">
          <div><dt>Investment ID</dt><dd>${esc(i.ref)}</dd></div><div><dt>Property</dt><dd>${esc(i.property_name)}</dd></div>
          <div><dt>Plan</dt><dd>${esc(i.plan_name)} (${esc(duration(d.plan))})</dd></div><div><dt>Amount</dt><dd>${money(i.amount_usd, { cents: true })}</dd></div>
          <div><dt>Paid with</dt><dd><span data-no-translate>${num(i.crypto_amount, 8)} ${esc(i.currency)}</span> on <span data-no-translate>${esc(netName || i.network)}</span></dd></div>
          <div><dt>Transaction hash</dt><dd class="mono">${i.tx_hash ? `<span title="${esc(i.tx_hash)}">${esc(shortHash(i.tx_hash, 12))}</span> <button class="icon-btn icon-btn--sm" data-copy="${esc(i.tx_hash)}" aria-label="Copy hash">${icon('copy')}</button>` : '—'}</dd></div>
          <div><dt>Payment date</dt><dd>${dateTime(d.payments.find((p) => p.status === 'confirmed' && p.kind === 'deposit')?.verified_at)}</dd></div>
          <div><dt>Start date</dt><dd>${date(i.start_date)}</dd></div><div><dt>Maturity date</dt><dd>${date(i.maturity_date)}</dd></div>
          <div><dt>Return terms</dt><dd>${rt.approved ? `${pctText(rt.rate)} ${returnPeriod(rt.type)}` : esc(rt.note || 'Pending legal approval')}</dd></div>
          <div><dt>Expected return</dt><dd>${i.expected_return != null ? money(i.expected_return, { cents: true }) : '—'}</dd></div>
        </dl>
      </section>
      <section class="card"><h2 class="card__title">Status history</h2>
        <ol class="timeline">${d.history.map((h) => `<li><span class="timeline__dot"></span><div><strong>${esc(h.to_label)}</strong>${h.reason ? `<p>${esc(h.reason)}</p>` : ''}<small>${dateTime(h.created_at)}</small></div></li>`).join('')}</ol>
      </section>
    </div>
    <section class="card"><header class="card__head"><h2 class="card__title">Documents</h2></header>
      <ul class="doclist">
        ${['payment_confirmed', 'active', 'maturing', 'matured', 'completed', 'redeemed'].includes(i.status) ? `<li>${icon('file')}<div><strong>Investment certificate</strong><small>Generated</small></div><a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="/api/me/investments/${i.id}/certificate">View</a></li>` : ''}
        ${d.payments.filter((p) => p.status === 'confirmed').map((p) => `<li>${icon('file')}<div><strong>${p.kind === 'redemption' ? 'Withdrawal confirmation' : 'Payment receipt'} ${esc(p.ref)}</strong><small>${date(p.verified_at)}</small></div><a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="/api/me/payments/${p.id}/receipt">View</a></li>`).join('')}
        ${d.documents.map((x) => `<li>${icon('file')}<div><strong>${esc(x.title)}</strong><small>${esc(label(x.category))} · ${date(x.created_at)}</small></div><a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="/api/files/${x.file_id}">View</a></li>`).join('')}
        <li>${icon('file')}<div><strong>Investment Terms</strong><small>Applies to this plan</small></div><a class="btn btn--ghost btn--sm" target="_blank" href="/legal/investment_terms">View</a></li>
        <li>${icon('file')}<div><strong>Risk Disclosure</strong><small>Accepted at investment</small></div><a class="btn btn--ghost btn--sm" target="_blank" href="/legal/risk">View</a></li>
      </ul>
    </section>
    ${d.redemptions.length ? `<section class="card card--table"><header class="card__head"><h2 class="card__title">Withdrawals</h2></header><div class="table-wrap"><table class="table"><thead><tr><th>Reference</th><th class="num">Amount</th><th>To wallet</th><th>Status</th><th>Requested</th></tr></thead><tbody>
      ${d.redemptions.map((r) => `<tr><td>${esc(r.ref)}</td><td class="num">${money(r.amount_usd)}</td><td class="mono">${esc(shortHash(r.destination_wallet, 8))} (${esc(r.currency)})</td><td>${badge(r.status)}</td><td>${date(r.created_at)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`,
    mount(root) {
      root.querySelectorAll('[data-copy]').forEach((b) => { if (!b.closest('[data-pay]')) b.addEventListener('click', () => copyText(b.dataset.copy)); });
      if (pay) bindPayment(root, () => ctx.reload());
      root.querySelector('[data-withdraw]')?.addEventListener('click', async () => {
        const { items: wallets } = await api.get('/api/me/wallets');
        withdrawalModal(i, wallets, () => navigate('/app/withdrawals'));
      });
    },
  };
}

/* ------------------------------------------------------------------ invest flow */
const STEPS = ['Select plan', 'Enter amount', 'Choose crypto', 'Payment', 'Confirmation'];
const stepper = (n) => `<ol class="stepper">${STEPS.map((s, i) => `<li class="${i < n ? 'is-done' : i === n ? 'is-current' : ''}"><span>${i < n ? icon('check') : i + 1}</span><em>${s}</em></li>`).join('')}</ol><p class="stepper__caption"><span>Step ${Math.min(n, STEPS.length - 1) + 1} of ${STEPS.length}</span> · <em>${STEPS[Math.min(n, STEPS.length - 1)]}</em></p>`;

export async function invest(ctx) {
  const o = await api.get('/api/me/invest-options');
  if (!o.enabled) return { title: 'New investment', html: `${head('Make an investment')}<div class="callout callout--warn">${icon('alert')}<div><strong>New investments are paused</strong><p>Investing is temporarily unavailable. Existing investments are not affected.</p></div></div>` };
  if (o.kyc_required && o.kyc_status !== 'approved') {
    return { title: 'New investment', html: `${head('Make an investment')}${stepper(0)}${kycBanner() || ''}<section class="card center"><span class="big-ico">${icon('shield')}</span><h2>Identity verification required</h2><p class="muted">For your protection and to meet anti-money-laundering rules, we verify every investor before accepting funds.</p><a class="btn btn--gold" href="/app/kyc">Go to verification</a></section>` };
  }
  const st = {
    step: 0, property: o.properties.find((p) => String(p.id) === ctx.query.property) || null,
    plan: o.plans.find((p) => String(p.id) === ctx.query.plan) || null, amount: null, currency: null, network: null, result: null,
  };
  const plansFor = (p) => o.plans.filter((pl) => !pl.property_id || (p && pl.property_id === p.id));
  const minFor = () => Math.max(st.plan?.min_amount || 0, st.property?.min_investment || 0);

  function view() {
    if (st.step === 0) {
      const planList = st.property ? plansFor(st.property) : o.plans;
      return `<section class="card"><h2 class="card__title">1. Choose a plan</h2>
        <p class="muted small">These are the same plans shown on our website. Estimated profits are based on each plan's minimum investment.</p>
        <div data-plans>${Pub.plansTable(planList, { selectedId: st.plan?.id, action: (pl, selected) => `<button type="button" class="btn btn--sm ${selected ? 'btn--gold' : 'btn--ghost'}" data-pick-plan="${pl.id}" aria-pressed="${selected}">${selected ? `${icon('check')} Selected` : 'Select'}</button>` })}</div>
        <h2 class="card__title" id="choose-property">2. Choose a property</h2>
        <div class="choice-grid">${o.properties.map((p) => `<label class="choice choice--prop"><input type="radio" name="property" value="${p.id}" ${st.property?.id === p.id ? 'checked' : ''}><span class="choice__media">${propertyVisual(p)}</span><span class="choice__body"><strong data-no-translate>${esc(p.name)}</strong><small>${esc(p.city)} · ${esc(TYPE_LABEL[p.type])} · from ${money(p.min_investment)}</small></span></label>`).join('') || empty('No properties are accepting investments', 'Check back soon.')}</div>
        <p class="form-error" data-err hidden></p>
        <div class="form__actions"><a class="btn btn--ghost" href="/app">Cancel</a><button class="btn btn--gold" data-next>Continue ${icon('arrow')}</button></div></section>`;
    }
    if (st.step === 1) {
      const min = minFor();
      return `<section class="card"><h2 class="card__title">How much would you like to invest?</h2>
        <form class="form" data-amt novalidate>
          <div class="summary"><div><small>Property</small><strong>${esc(st.property.name)}</strong></div><div><small>Plan</small><strong><span>${esc(st.plan.name)}</span> · ${esc(duration(st.plan))}</strong></div><div><small>Limits</small><strong>${money(min)} – ${st.plan.max_amount ? money(st.plan.max_amount) : 'no maximum'}</strong></div></div>
          <div class="field field--money"><label for="amt">Amount (USD)</label><div class="money-input"><span>$</span><input id="amt" name="amount_usd" type="number" inputmode="decimal" required min="${min}" ${st.plan.max_amount ? `max="${st.plan.max_amount}"` : ''} step="0.01" value="${st.amount ?? ''}" placeholder="${min}"></div><p class="field__hint">Your maturity date is set when your payment is confirmed.</p><p class="field__error" hidden></p></div>
          ${check({ name: 'accept_terms', required: true, checked: st.accept, html: true, label: 'I have read and accept the <a href="/legal/investment_terms" target="_blank">Investment Terms</a>, <a href="/legal/risk" target="_blank">Risk Disclosure</a> and <a href="/legal/crypto" target="_blank">Crypto Payment Disclosure</a>. I understand returns are not guaranteed.' })}
          <p class="form-error" hidden></p>
          <div class="form__actions"><button type="button" class="btn btn--ghost" data-back>${icon('arrowLeft')} Back</button><button class="btn btn--gold" type="submit">Continue ${icon('arrow')}</button></div>
        </form></section>`;
    }
    if (st.step === 2) {
      const cur = o.currencies.find((c) => c.code === st.currency) || o.currencies[0];
      const nets = cur.networks;
      const est = (c) => (st.amount / c.rate_usd).toLocaleString('en-US', { maximumFractionDigits: c.decimals ?? 6 });
      return `<section class="card"><h2 class="card__title">Select cryptocurrency</h2>
        <form class="form" data-cur novalidate>
        <div class="coin-pick">${o.currencies.map((c) => `<label class="coin-opt"><input type="radio" name="currency" value="${esc(c.code)}" ${c.code === cur.code ? 'checked' : ''}><span class="coin__mark coin__mark--${esc(c.code.toLowerCase())}">${esc(c.code.slice(0, 1))}</span><span><strong>${esc(c.name)}</strong><small>${esc(c.code)}</small></span><span class="coin-opt__est">≈ ${esc(est(c))}</span></label>`).join('')}</div>
        <div class="form-grid">
          ${field({ name: 'network', label: 'Network', required: true, options: nets.map((n) => [n.code, n.name]), value: st.network || nets[0].code })}
          <div class="field"><label>You will send</label><p class="readout"><strong data-send>${esc(est(cur))} ${esc(cur.code)}</strong><small class="muted">Rate: 1 ${esc(cur.code)} = ${money(cur.rate_usd, { cents: cur.rate_usd < 100 })}</small></p></div>
        </div>
        <div class="summary"><div><small>Property</small><strong>${esc(st.property.name)}</strong></div><div><small>Plan</small><strong>${esc(st.plan.name)}</strong></div><div><small>Amount</small><strong>${money(st.amount, { cents: true })}</strong></div></div>
        <p class="form-error" hidden></p>
        <div class="form__actions"><button type="button" class="btn btn--ghost" data-back>${icon('arrowLeft')} Back</button><button class="btn btn--gold" type="submit">Get payment details ${icon('arrow')}</button></div>
        </form></section>`;
    }
    if (st.step === 3) return paymentPanel(st.result.payment, { id: st.result.investment_id }, st.result.network_name, st.result.demo_addresses);
    return `<section class="card center"><span class="big-ico big-ico--ok">${icon('check')}</span><h2>Payment submitted</h2><p class="muted">Investment <strong>${esc(st.result.ref)}</strong> is awaiting blockchain verification. We’ll notify you by email as soon as it’s confirmed and your investment is active.</p>
      <div class="form__actions form__actions--center"><a class="btn btn--ghost" href="/app">Back to overview</a><a class="btn btn--gold" href="/app/investments/${st.result.investment_id}">View investment</a></div></section>`;
  }

  function draw(root, { keepScroll = false } = {}) {
    root.querySelector('[data-flow]').innerHTML = stepper(st.step) + view();
    const area = root.querySelector('[data-flow]');
    if (st.step === 0) {
      area.querySelectorAll('input[name=property]').forEach((r) => r.addEventListener('change', () => {
        st.property = o.properties.find((p) => p.id === Number(r.value));
        if (st.plan && !plansFor(st.property).some((x) => x.id === st.plan.id)) st.plan = null;
        draw(root, { keepScroll: true });
      }));
      area.querySelectorAll('[data-pick-plan]').forEach((b) => b.addEventListener('click', () => {
        const pl = o.plans.find((p) => p.id === Number(b.dataset.pickPlan));
        st.plan = pl;
        // A plan tied to one property selects that property.
        if (pl.property_id) st.property = o.properties.find((p) => p.id === pl.property_id) || st.property;
        draw(root, { keepScroll: true });
        if (!st.property) root.querySelector('#choose-property')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));
      area.querySelector('[data-next]')?.addEventListener('click', () => {
        const err = area.querySelector('[data-err]');
        if (!st.plan || !st.property) { err.textContent = !st.plan ? 'Choose a plan to continue.' : 'Choose a property to continue.'; err.hidden = false; return; }
        st.step = 1; draw(root);
      });
    }
    if (st.step === 1) {
      bindForm(area.querySelector('[data-amt]'), async (d, form) => {
        const min = minFor();
        if (d.amount_usd < min || (st.plan.max_amount && d.amount_usd > st.plan.max_amount)) {
          throw { fields: { amount_usd: d.amount_usd < min ? `The minimum is ${money(min)}.` : `The maximum is ${money(st.plan.max_amount)}.` } };
        }
        void form;
        st.amount = d.amount_usd; st.accept = d.accept_terms; st.step = 2; draw(root);
      });
    }
    if (st.step === 2) {
      const form = area.querySelector('[data-cur]');
      form.querySelectorAll('input[name=currency]').forEach((r) => r.addEventListener('change', () => { st.currency = r.value; st.network = null; draw(root); }));
      form.querySelector('[name=network]').addEventListener('change', (e) => { st.network = e.target.value; });
      bindForm(form, async (d) => {
        st.currency = d.currency; st.network = d.network;
        st.result = await api.post('/api/me/investments', { property_id: st.property.id, plan_id: st.plan.id, amount_usd: st.amount, currency: d.currency, network: d.network, accept_terms: !!st.accept });
        st.step = 3; draw(root);
        refreshUnread();
      });
    }
    if (st.step === 3) bindPayment(area, (what) => { if (what === 'cancelled') navigate('/app/investments'); else { st.step = 4; draw(root); } });
    area.querySelector('[data-back]')?.addEventListener('click', () => { st.step -= 1; draw(root); });
    if (!keepScroll) area.scrollIntoView({ block: 'start' });
  }

  return {
    title: 'New investment',
    html: `${head('Make an investment', 'Choose a property and plan, then pay with cryptocurrency.')}<div data-flow class="flow"></div>`,
    mount(root) { draw(root); },
  };
}

/* ------------------------------------------------------------------ properties */
export async function properties(ctx) {
  if (ctx.params.slug) return Pub.property(ctx, { inApp: true });
  return Pub.properties(ctx, { base: '/app/properties', inApp: true });
}

/* ---------------------------------------------------------------- transactions */
export async function transactions() {
  const { items } = await api.get('/api/me/transactions');
  return {
    title: 'Transactions',
    html: `${head('Transactions', 'All deposits and payouts on your account.')}
    <section class="card card--table">${items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Reference</th><th>Type</th><th>Investment</th><th class="num">Amount</th><th>Network</th><th>Tx hash</th><th>Status</th><th>Date</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${items.map((p) => `<tr><td><strong>${esc(p.ref)}</strong></td><td>${p.kind === 'redemption' ? 'Payout' : 'Deposit'}</td><td>${p.investment_id ? `<a href="/app/investments/${p.investment_id}">${esc(p.investment_ref)}</a>` : '—'}</td>
      <td class="num">${num(p.amount_crypto, 8)} ${esc(p.currency)}<br><small class="muted">${money(p.amount_usd)}</small></td><td>${esc(p.network)}</td><td class="mono">${p.tx_hash ? `<span title="${esc(p.tx_hash)}">${esc(shortHash(p.tx_hash))}</span>` : '—'}</td>
      <td>${badge(p.status)}<br><small class="muted">${p.confirmations ? `${p.confirmations} confirmations` : ''}</small></td><td>${date(p.created_at)}</td>
      <td>${p.status === 'confirmed' ? `<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="/api/me/payments/${p.id}/receipt">Receipt</a>` : p.status === 'awaiting' ? `<a class="btn btn--gold btn--sm" href="/app/investments/${p.investment_id}">Pay now</a>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : empty('No transactions yet', 'Your deposits and payouts will appear here.')}</section>`,
  };
}

/* ------------------------------------------------------------------ documents */
export async function documents() {
  const { items } = await api.get('/api/me/documents');
  const legal = [['investment_terms', 'Investment Terms'], ['risk', 'Risk Disclosure'], ['investor_agreement', 'Investor Agreement'], ['terms', 'Terms & Conditions'], ['privacy', 'Privacy Policy'], ['redemption', 'Withdrawal Policy']];
  return {
    title: 'Documents',
    html: `${head('Documents', 'Agreements, certificates, receipts and statements.')}
    <div class="grid grid--dash">
      <section class="card"><h2 class="card__title">Your documents</h2>${items.length ? `<ul class="doclist">${items.map((d) => `<li>${icon('file')}<div><strong>${esc(d.title)}</strong><small>${esc(label(d.category))}${d.investment_ref ? ` · ${esc(d.investment_ref)}` : ''} · ${date(d.created_at)}</small></div>${d.url ? `<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="${esc(d.url)}">View</a>` : ''}</li>`).join('')}</ul>` : empty('No documents yet', 'Certificates and receipts appear once an investment is funded.')}</section>
      <section class="card"><h2 class="card__title">Policies & disclosures</h2><ul class="doclist">${legal.map(([k, l]) => `<li>${icon('file')}<div><strong>${l}</strong></div><a class="btn btn--ghost btn--sm" target="_blank" href="/legal/${k}">Read</a></li>`).join('')}</ul></section>
    </div>`,
  };
}

/* ---------------------------------------------------------------- withdrawals */
const OPEN_WITHDRAWAL = ['requested', 'under_review', 'approved'];
const payoutOptions = () => (state.site?.currencies || []).flatMap((c) => c.networks.map((n) => ({ code: c.code, name: c.name, network: n.code, networkName: n.name })));
const optionKey = (code, network) => `${code}|${network}`;
const withdrawable = (i) => round2(i.amount_usd + (i.expected_return || 0));
function round2(n) { return Math.round(Number(n) * 100) / 100; }

/** Withdraw a matured investment. Defaults to the crypto and network the investor paid with, and to their saved wallet. */
function withdrawalModal(inv, wallets, done) {
  const options = payoutOptions();
  if (!options.length) { toast('Withdrawals are not available at the moment.', 'bad'); return; }
  const saved = Object.fromEntries(wallets.map((w) => [optionKey(w.currency, w.network), w.address]));
  const same = options.find((o) => o.code === inv.currency && o.network === inv.network);
  const first = same || options[0];
  const max = withdrawable(inv);
  modal({
    title: `Withdraw ${inv.ref}`,
    body: `<form class="form" data-f novalidate>
      <div class="summary summary--2"><div><small>Investment</small><strong>${esc(inv.ref)} · ${esc(inv.property_name)}</strong></div><div><small>Available to withdraw</small><strong>${money(max, { cents: true })}</strong></div></div>
      <div class="form-grid">
        ${field({ name: 'amount_usd', label: 'Amount (USD)', type: 'number', required: true, value: max, attrs: `min="1" max="${max}" step="0.01" inputmode="decimal"` })}
        ${field({ name: 'payout', label: 'Receive in', required: true, value: optionKey(first.code, first.network), options: options.map((o) => [optionKey(o.code, o.network), `${o.name} (${o.code}) · ${o.networkName}${same && o === same ? ' — same as your deposit' : ''}`]) })}
        ${field({ name: 'destination_wallet', label: 'Wallet address', required: true, full: true, value: saved[optionKey(first.code, first.network)] || '', attrs: 'maxlength="120" autocomplete="off" autocapitalize="off" spellcheck="false"' })}
      </div>
      <p class="field__hint" data-wallet-hint></p>
      <div data-save-wrap>${check({ name: 'save_wallet', label: 'Save this address for future withdrawals', checked: true })}</div>
      ${field({ name: 'password', label: 'Confirm with your password', type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
      <div class="callout">${icon('info')}<div><p>Double-check the address and network. Crypto sent to a wrong address or network cannot be recovered. Requests are reviewed by our team before payout.</p></div></div>
      <p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">${icon('wallet')} Request withdrawal</button></div></form>`,
    onMount(panel, close) {
      const form = panel.querySelector('[data-f]');
      const hint = panel.querySelector('[data-wallet-hint]');
      const saveWrap = panel.querySelector('[data-save-wrap]');
      const sync = (fill) => {
        const key = form.payout.value;
        const o = options.find((x) => optionKey(x.code, x.network) === key);
        const savedAddress = saved[key];
        if (fill) form.destination_wallet.value = savedAddress || '';
        const usingSaved = savedAddress && form.destination_wallet.value.trim() === savedAddress;
        hint.textContent = usingSaved ? `Using your saved ${o.code} (${o.networkName}) wallet.` : `Enter a ${o.code} wallet address on the ${o.networkName} network.`;
        saveWrap.hidden = !!usingSaved;
      };
      form.payout.addEventListener('change', () => sync(true));
      form.destination_wallet.addEventListener('input', () => sync(false));
      sync(false);
      bindForm(form, async (d) => {
        const [currency, network] = String(d.payout).split('|');
        if (d.amount_usd > max) throw { fields: { amount_usd: `The most you can withdraw is ${money(max, { cents: true })}.` } };
        const r = await api.post('/api/me/redemptions', {
          investment_id: inv.id, amount_usd: d.amount_usd, currency, network, destination_wallet: String(d.destination_wallet).trim(),
          save_wallet: !saveWrap.hidden && !!d.save_wallet, password: d.password,
        });
        close();
        toast(`Withdrawal request ${r.ref} submitted.`);
        done();
      });
    },
  });
}

function walletModal(option, current, done) {
  modal({
    title: `${current ? 'Change' : 'Add'} ${option.code} wallet`,
    body: `<form class="form" data-f novalidate>
      <p class="muted">Network: <strong>${esc(option.networkName)}</strong>. Withdrawals in ${esc(option.code)} on this network will be sent to this address.</p>
      ${field({ name: 'address', label: 'Wallet address', required: true, value: current || '', attrs: 'maxlength="120" autocomplete="off" autocapitalize="off" spellcheck="false"' })}
      ${field({ name: 'password', label: 'Confirm with your password', type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
      <p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Save wallet</button></div></form>`,
    onMount(panel, close) {
      bindForm(panel.querySelector('[data-f]'), async (d) => {
        await api.put('/api/me/wallets', { currency: option.code, network: option.network, address: String(d.address).trim(), password: d.password });
        close();
        toast('Wallet saved.');
        done();
      });
    },
  });
}

export async function withdrawals(ctx) {
  const [{ items }, inv, { items: wallets }] = await Promise.all([api.get('/api/me/redemptions'), api.get('/api/me/investments'), api.get('/api/me/wallets')]);
  const open = new Set(items.filter((r) => OPEN_WITHDRAWAL.includes(r.status)).map((r) => r.investment_id));
  const eligible = inv.items.filter((i) => i.status === 'matured' && !open.has(i.id));
  const upcoming = inv.items.filter((i) => ['active', 'maturing'].includes(i.status) && i.maturity_date).sort((a, b) => a.maturity_date.localeCompare(b.maturity_date))[0];
  const enabled = !!state.site?.redemptions_enabled;
  const options = payoutOptions();
  const savedBy = Object.fromEntries(wallets.map((w) => [optionKey(w.currency, w.network), w]));
  const withdrawButton = enabled && eligible.length
    ? `<button class="btn btn--gold" data-withdraw="${eligible[0].id}">${icon('wallet')} Withdraw</button>`
    : `<button class="btn btn--gold" type="button" disabled title="Available when an investment matures">${icon('wallet')} Withdraw</button>`;
  const readyRows = eligible.map((i) => `<li class="ready-item">
      <div class="ready-item__main"><strong>${esc(i.ref)}</strong><span>${esc(i.property_name)} · ${esc(i.plan_name)}</span><small class="muted">Matured ${date(i.maturity_date)} · paid with ${esc(i.currency)} (${esc(i.network)})</small></div>
      <div class="ready-item__amt"><small>Available</small><strong>${money(withdrawable(i), { cents: true })}</strong></div>
      <button class="btn btn--gold btn--sm" data-withdraw="${i.id}">${icon('wallet')} Withdraw</button></li>`).join('');
  return {
    title: 'Withdrawals',
    live: liveReload(ctx, '/api/me/redemptions', (d) => d.items.map((r) => [r.id, r.status]), { items }),
    html: `${head('Withdrawals', 'Withdraw matured investments to your crypto wallet.', withdrawButton)}
    ${!enabled ? `<div class="callout callout--warn">${icon('info')}<div><p>Withdrawals are currently unavailable. Contact support if you need help.</p></div></div>` : ''}
    ${enabled && eligible.length ? `<section class="card"><header class="card__head"><h2 class="card__title">Ready to withdraw</h2><span class="badge badge--ok">${eligible.length} matured</span></header><ul class="ready-list">${readyRows}</ul></section>`
      : enabled ? `<div class="callout">${icon('clock')}<div><strong>Nothing to withdraw yet</strong><p>You can withdraw an investment once it matures.${upcoming ? ` Your next maturity is <a href="/app/investments/${upcoming.id}">${esc(upcoming.ref)}</a> on ${date(upcoming.maturity_date)}.` : ''}</p></div></div>` : ''}
    <section class="card card--table"><header class="card__head"><h2 class="card__title">Withdrawal requests</h2></header>${items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Reference</th><th>Investment</th><th class="num">Amount</th><th>To wallet</th><th>Status</th><th>Payout tx</th><th>Requested</th></tr></thead><tbody>
      ${items.map((r) => `<tr><td><strong>${esc(r.ref)}</strong></td><td><a href="/app/investments/${r.investment_id}">${esc(r.investment_ref)}</a></td><td class="num">${money(r.amount_usd)}</td><td class="mono"><span title="${esc(r.destination_wallet)}">${esc(shortHash(r.destination_wallet))}</span><br><small class="muted">${esc(r.currency)} · ${esc(r.network)}</small></td><td>${badge(r.status)}${r.admin_note ? `<br><small class="muted">${esc(r.admin_note)}</small>` : ''}</td><td class="mono">${esc(shortHash(r.tx_hash))}</td><td>${date(r.created_at)}</td></tr>`).join('')}
    </tbody></table></div>` : empty('No withdrawal requests', 'Requests you make will be tracked here.')}</section>
    <section class="card"><header class="card__head"><div><h2 class="card__title">Payout wallets</h2><p class="muted small">Save a wallet for each cryptocurrency to make withdrawals quicker. You confirm the wallet every time you withdraw.</p></div></header>
      ${options.length ? `<ul class="wallet-list">${options.map((o) => {
        const w = savedBy[optionKey(o.code, o.network)];
        return `<li class="wallet-item"><span class="coin__mark coin__mark--${esc(o.code.toLowerCase())}">${esc(o.code.slice(0, 1))}</span>
          <div class="wallet-item__main"><strong>${esc(o.name)} (${esc(o.code)})</strong><small class="muted">${esc(o.networkName)}</small>${w ? `<span class="mono wallet-item__addr">${esc(w.address)}</span>` : '<span class="muted small">Not set</span>'}</div>
          <div class="wallet-item__actions"><button class="btn btn--ghost btn--sm" data-wallet="${esc(optionKey(o.code, o.network))}">${w ? 'Change' : 'Add'}</button>${w ? `<button class="icon-btn icon-btn--sm" data-wallet-remove="${w.id}" aria-label="Remove ${esc(o.code)} wallet">${icon('trash')}</button>` : ''}</div></li>`;
      }).join('')}</ul>` : '<p class="muted">No cryptocurrencies are available for payouts at the moment.</p>'}
    </section>`,
    mount(root) {
      root.querySelectorAll('[data-withdraw]').forEach((b) => b.addEventListener('click', () => {
        const i = eligible.find((x) => x.id === Number(b.dataset.withdraw));
        if (i) withdrawalModal(i, wallets, () => ctx.reload());
      }));
      root.querySelectorAll('[data-wallet]').forEach((b) => b.addEventListener('click', () => {
        const o = options.find((x) => optionKey(x.code, x.network) === b.dataset.wallet);
        walletModal(o, savedBy[b.dataset.wallet]?.address, () => ctx.reload());
      }));
      root.querySelectorAll('[data-wallet-remove]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Remove this wallet?', message: 'You can add it again at any time. Pending withdrawal requests are not affected.', confirm: 'Remove', tone: 'danger' }))) return;
        try { await api.del(`/api/me/wallets/${b.dataset.walletRemove}`); toast('Wallet removed.'); ctx.reload(); }
        catch (err) { toast(err.message, 'bad'); }
      }));
    },
  };
}

/* ----------------------------------------------------------- investment plans */
export async function plans() {
  const { items } = await api.get('/api/public/plans');
  return {
    title: 'Investment plans',
    html: `${head('Investment plans', 'The same partnership plans shown on our website. Choose one to start investing.', `<a class="btn btn--gold" href="/app/invest">${icon('plus')} New investment</a>`)}
    <section class="card card--table">${Pub.plansTable(items, { action: (p) => `<a class="btn btn--gold btn--sm" href="/app/invest?plan=${p.id}">Invest</a>` })}</section>
    ${Pub.plansNote()}`,
  };
}

/* -------------------------------------------------------------- notifications */
export async function notifications(ctx) {
  const { items, unread } = await api.get('/api/me/notifications');
  return {
    title: 'Notifications',
    live: liveReload(ctx, '/api/me/notifications', (d) => [d.unread, d.items.map((n) => [n.id, n.read_at])], { items, unread }),
    html: `${head('Notifications', unread ? `${unread} unread` : 'You’re all caught up.', unread ? '<button class="btn btn--ghost" data-all>Mark all as read</button>' : '')}
    <section class="card">${items.length ? `<ul class="feed feed--full">${items.map((n) => `<li class="${n.read_at ? '' : 'is-unread'}"><span class="feed__dot"></span><div><strong>${esc(n.title)}</strong><p>${esc(n.body || '')}</p><small>${dateTime(n.created_at)}</small></div>${n.link ? `<a class="btn btn--ghost btn--sm" href="${esc(n.link)}" data-read="${n.id}">Open</a>` : ''}</li>`).join('')}</ul>` : empty('No notifications', 'Updates about your account and investments will appear here.')}</section>`,
    mount(root) {
      root.querySelector('[data-all]')?.addEventListener('click', async () => { await api.post('/api/me/notifications/read'); await refreshUnread(); ctx.reload(); });
      root.querySelectorAll('[data-read]').forEach((a) => a.addEventListener('click', () => { api.post('/api/me/notifications/read', { id: Number(a.dataset.read) }).then(refreshUnread).catch(() => {}); }));
    },
  };
}

/* ------------------------------------------------------------------------ KYC */
const KYC_STEPS = ['Personal info', 'Identity document', 'Proof of address', 'Selfie', 'Source of funds', 'Review'];
const IMG = ['image/jpeg', 'image/png', 'image/webp'];
const IMG_PDF = [...IMG, 'application/pdf'];
const KYC_MAX_FILES = 5;

const uploadedItem = (d) => `<li data-doc-id="${d.id}">${icon('file')}<div><strong>${esc(d.original_name)}</strong><small>${fileSize(d.size)}</small></div>${badge(d.status)}<button type="button" class="icon-btn icon-btn--sm" data-remove="${d.id}" aria-label="Remove file">${icon('trash')}</button></li>`;

function uploader(kind, existing, { accept, title, hint, docTypes }) {
  return `<div class="upload-wrap">
    ${docTypes ? `<fieldset class="doc-types"><legend>Accepted documents</legend>${docTypes.map(([v, l, ic], i) => `<label class="doc-type"><input type="radio" name="doc_type" value="${v}" ${i === 0 ? 'checked' : ''}>${icon(ic)}<span>${l}</span></label>`).join('')}</fieldset>` : ''}
    <label class="drop" data-drop="${kind}">
      <input type="file" accept="${accept.join(',')}" ${kind === 'selfie' ? 'capture="user"' : 'multiple'} class="sr-only" data-file="${kind}">
      ${icon(kind === 'selfie' ? 'camera' : 'upload')}<strong>${title}</strong><span class="muted small">${hint}</span>
      <span class="drop__status" data-status="${kind}"></span>
    </label>
    <ul class="doclist doclist--compact" data-list="${kind}">${existing.map(uploadedItem).join('')}</ul>
  </div>`;
}

export async function kyc(ctx) {
  const { kyc: k, documents } = await api.get('/api/me/kyc');
  const docs = { identity: [], address: [], selfie: [] };
  for (const d of documents) (docs[d.kind] ||= []).push(d);
  const locked = ['pending_review', 'approved'].includes(k.status);
  if (locked) {
    return {
      title: 'Verification',
      html: `${head('KYC verification', 'Your identity verification status.')}
      <section class="card center kyc-status"><span class="big-ico ${k.status === 'approved' ? 'big-ico--ok' : ''}">${icon(k.status === 'approved' ? 'check' : 'clock')}</span>
        <h2>${k.status === 'approved' ? 'Your identity is verified' : 'Verification under review'}</h2>
        <p class="muted">${k.status === 'approved' ? `Approved on ${date(k.reviewed_at)}. You can invest in any open opportunity.` : `Submitted ${dateTime(k.submitted_at)}. Reviews usually take 1–2 business days. We’ll email you when it’s done.`}</p>
        ${k.status === 'approved' ? '<a class="btn btn--gold" href="/app/invest">Make an investment</a>' : ''}
        <ul class="doclist doclist--compact">${documents.map((d) => `<li>${icon('file')}<div><strong>${esc(sentence(d.kind === 'address' ? 'proof of address' : d.kind === 'identity' ? 'identity document' : 'selfie'))}</strong><small>${esc(d.original_name)}</small></div>${badge(d.status)}</li>`).join('')}</ul>
      </section>`,
    };
  }
  const p = k.personal || {};
  const sf = k.source_of_funds || {};
  const su = k.suitability || {};
  const done = [!!k.personal?.dob, !!docs.identity.length, !!docs.address.length, !!docs.selfie.length, !!sf.source];
  let step = Math.min(Number(ctx.query.step) || done.findIndex((x) => !x), 5);
  if (step < 0) step = 5;

  const panels = [
    `<form class="form" data-step="personal" novalidate><div class="form-grid">
      ${field({ name: 'dob', label: 'Date of birth', type: 'date', required: true, value: p.dob ? p.dob.slice(0, 10) : '', attrs: `max="${new Date(Date.now() - 18 * 365.25 * 864e5).toISOString().slice(0, 10)}"` })}
      ${field({ name: 'nationality', label: 'Nationality', required: true, value: p.nationality || '', options: [['', 'Select'], ...COUNTRIES.map((c) => [c, c])] })}
      ${field({ name: 'country', label: 'Country of residence', required: true, value: p.country || state.user.country || '', options: [['', 'Select'], ...COUNTRIES.map((c) => [c, c])] })}
      ${field({ name: 'occupation', label: 'Occupation', required: true, value: p.occupation || '', attrs: 'maxlength="100"' })}
      ${field({ name: 'address', label: 'Residential address', required: true, full: true, value: p.address || '', attrs: 'autocomplete="street-address" maxlength="200"' })}
      ${field({ name: 'city', label: 'City', required: true, value: p.city || '', attrs: 'autocomplete="address-level2" maxlength="80"' })}
      ${field({ name: 'postal_code', label: 'Postal code', value: p.postal_code || '', attrs: 'autocomplete="postal-code" maxlength="20"' })}
    </div><p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Continue ${icon('arrow')}</button></div></form>`,
    `<h2 class="card__title">Upload identity document</h2><p class="muted">Upload a valid government-issued ID. All four corners must be visible and the text readable.</p>
      ${uploader('identity', docs.identity, { accept: IMG_PDF, title: 'Click to upload or drag and drop', hint: 'JPG, PNG, WEBP or PDF. Photos are resized automatically; PDFs up to 3 MB. You can upload several files.', docTypes: [['passport', 'Passport', 'globe'], ['national_id', 'National ID card', 'card'], ['drivers_license', 'Driver’s license', 'card']] })}`,
    `<h2 class="card__title">Upload proof of address</h2><p class="muted">A utility bill, bank statement or tenancy agreement dated within the last 3 months, showing your name and address.</p>
      ${uploader('address', docs.address, { accept: IMG_PDF, title: 'Click to upload or drag and drop', hint: 'JPG, PNG, WEBP or PDF. Photos are resized automatically; PDFs up to 3 MB. You can upload several files.', docTypes: [['utility_bill', 'Utility bill', 'file'], ['bank_statement', 'Bank statement', 'file'], ['tenancy', 'Tenancy agreement', 'home']] })}`,
    `<h2 class="card__title">Take a selfie</h2><p class="muted">Take a clear photo of your face in good light, without glasses or hats. On mobile this opens your camera.</p>
      ${uploader('selfie', docs.selfie, { accept: IMG, title: 'Take or upload a selfie', hint: 'JPG, PNG or WEBP. Photos are resized automatically. Use the button again to add more photos.' })}`,
    `<form class="form" data-step="funds" novalidate><div class="form-grid">
      ${field({ name: 'source', label: 'Main source of funds', required: true, value: sf.source || '', options: [['', 'Select'], ['employment', 'Employment income'], ['business', 'Business income'], ['investments', 'Investment returns'], ['savings', 'Savings'], ['inheritance', 'Inheritance or gift'], ['property_sale', 'Sale of property'], ['other', 'Other']] })}
      ${field({ name: 'annual_income', label: 'Annual income (USD)', required: true, value: su.annual_income || '', options: [['', 'Select'], ['under_25k', 'Under $25,000'], ['25k_100k', '$25,000 – $100,000'], ['100k_250k', '$100,000 – $250,000'], ['250k_1m', '$250,000 – $1M'], ['over_1m', 'Over $1M']] })}
      ${field({ name: 'experience', label: 'Investment experience', required: true, value: su.experience || '', options: [['', 'Select'], ['none', 'None'], ['some', 'Some'], ['experienced', 'Experienced']] })}
      ${field({ name: 'risk_tolerance', label: 'Risk tolerance', required: true, value: su.risk_tolerance || '', options: [['', 'Select'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] })}
      ${field({ name: 'details', label: 'Tell us more about your source of funds', type: 'textarea', full: true, value: sf.details || '', rows: 3, attrs: 'maxlength="1000"' })}
      </div>
      ${check({ name: 'pep', label: 'I am a politically exposed person (PEP), or a close relative or associate of one', checked: !!su.pep })}
      ${check({ name: 'understands_risk', required: true, label: 'I understand that real estate investments carry risk and I could lose some or all of my money', checked: !!su.understands_risk })}
      <p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Continue ${icon('arrow')}</button></div></form>`,
    `<h2 class="card__title">Review and submit</h2><ul class="checklist">${['Personal information', 'Identity document', 'Proof of address', 'Selfie', 'Source of funds'].map((l, i) => `<li class="${done[i] ? 'is-done' : ''}">${icon(done[i] ? 'check' : 'x')}<span>${l}</span>${done[i] ? '' : `<a href="/app/kyc?step=${i}">Complete</a>`}</li>`).join('')}</ul>
      <p class="muted">By submitting, you confirm the information is accurate and consent to us verifying it under our <a href="/legal/kyc_aml" target="_blank">KYC/AML Policy</a> and <a href="/legal/privacy" target="_blank">Privacy Policy</a>.</p>
      <div class="form__actions"><button class="btn btn--gold" data-submit ${done.every(Boolean) ? '' : 'disabled'}>Submit for review</button></div>`,
  ];

  return {
    title: 'Verification',
    html: `${head('KYC verification', 'Verify your identity to start investing.')}
    ${k.status === 'requires_info' || k.status === 'rejected' ? `<div class="callout callout--warn">${icon('alert')}<div><strong>${k.status === 'rejected' ? 'Verification not approved' : 'Update needed'}</strong><p>${esc(k.admin_note || '')}</p></div></div>` : ''}
    <ol class="stepper stepper--links">${KYC_STEPS.map((s, i) => `<li class="${i === step ? 'is-current' : done[i] ? 'is-done' : ''}"><a href="/app/kyc?step=${i}"><span>${done[i] && i !== step ? icon('check') : i + 1}</span><em>${s}</em></a></li>`).join('')}</ol><p class="stepper__caption"><span>Step ${step + 1} of ${KYC_STEPS.length}</span> · <em>${KYC_STEPS[step]}</em></p>
    <div class="kyc-grid"><section class="card">${panels[step]}
      ${step >= 1 && step <= 3 ? `<div class="form__actions">${step > 0 ? `<a class="btn btn--ghost" href="/app/kyc?step=${step - 1}">${icon('arrowLeft')} Back</a>` : ''}<a class="btn btn--gold" href="/app/kyc?step=${step + 1}" data-continue>Continue ${icon('arrow')}</a></div>` : ''}
    </section>
    <aside class="card card--flat kyc-aside">${icon('lock')}<h3>Your information is secure</h3><p class="muted small">Documents are encrypted in transit, stored privately and only reviewed by our compliance team for verification.</p></aside></div>`,
    mount(root) {
      const go = (n) => navigate(`/app/kyc?step=${n}`);
      const pf = root.querySelector('[data-step=personal]');
      if (pf) bindForm(pf, async (d) => { await api.post('/api/me/kyc/personal', d); toast('Personal information saved.'); go(1); });
      const ff = root.querySelector('[data-step=funds]');
      if (ff) bindForm(ff, async (d) => { await api.post('/api/me/kyc/funds', d); toast('Source of funds saved.'); go(5); });
      root.querySelectorAll('[data-file]').forEach((input) => {
        const kind = input.dataset.file;
        const drop = root.querySelector(`[data-drop="${kind}"]`);
        const status = root.querySelector(`[data-status="${kind}"]`);
        const list = root.querySelector(`[data-list="${kind}"]`);
        const refresh = () => drop.classList.toggle('is-done', list.children.length > 0);
        refresh();
        const upload = async (fileList) => {
          const files = [...fileList];
          if (!files.length) return;
          if (list.children.length + files.length > KYC_MAX_FILES) {
            status.innerHTML = `<span class="text-bad">${icon('alert')} You can upload up to ${KYC_MAX_FILES} files here.</span>`;
            return;
          }
          drop.classList.add('is-busy');
          drop.setAttribute('aria-busy', 'true');
          status.innerHTML = `<span class="spinner spinner--sm"></span> Preparing ${files.length} ${files.length === 1 ? 'file' : 'files'}…`;
          const docType = root.querySelector('input[name=doc_type]:checked')?.value || (kind === 'selfie' ? 'selfie' : undefined);
          let done = [];
          let error = null;
          try {
            ({ done, error } = await uploadMany(files, { types: kind === 'selfie' ? IMG : IMG_PDF, purpose: `kyc_${kind}` }, async (f, file, index) => {
              status.innerHTML = `<span class="spinner spinner--sm"></span> Uploading file ${index + 1} of ${files.length}…`;
              const res = await api.post('/api/me/kyc/document', { kind, doc_type: docType, file: f }, { timeout: 90000 });
              list.insertAdjacentHTML('beforeend', uploadedItem(res.document));
              return res;
            }));
          } catch (uploadError) {
            error = uploadError;
          } finally {
            drop.classList.remove('is-busy');
            drop.removeAttribute('aria-busy');
          }
          refresh();
          status.innerHTML = error ? `<span class="text-bad">${icon('alert')} ${esc(error.message)}</span>` : `${icon('check')} ${done.length} ${done.length === 1 ? 'file' : 'files'} uploaded`;
          if (done.length) toast(done.length === 1 ? 'Document uploaded.' : `${done.length} documents uploaded.`);
        };
        input.addEventListener('change', () => { upload(input.files); input.value = ''; });
        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
        drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); upload(kind === 'selfie' ? [...e.dataTransfer.files].slice(0, 1) : e.dataTransfer.files); });
        list.addEventListener('click', async (e) => {
          const button = e.target.closest('[data-remove]');
          if (!button) return;
          button.disabled = true;
          try { await api.del(`/api/me/kyc/document/${button.dataset.remove}`); button.closest('li').remove(); refresh(); status.innerHTML = ''; }
          catch (err) { button.disabled = false; toast(err.message, 'bad'); }
        });
      });
      root.querySelector('[data-continue]')?.addEventListener('click', (e) => {
        const kind = ['', 'identity', 'address', 'selfie'][step];
        if (kind && !root.querySelector(`[data-list="${kind}"]`).children.length) {
          e.preventDefault();
          e.stopPropagation();
          toast('Upload the document before continuing.', 'bad');
        }
      }, true);
      root.querySelector('[data-submit]')?.addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try { await api.post('/api/me/kyc/submit'); await refreshUser(); toast('Verification submitted.'); ctx.reload(); }
        catch (err) { toast(err.message, 'bad'); e.target.disabled = false; }
      });
    },
  };
}

/* -------------------------------------------------------------------- support */
export async function support(ctx) {
  const { items } = await api.get('/api/me/tickets');
  const s = state.site?.site || {};
  return {
    title: 'Support',
    live: liveReload(ctx, '/api/me/tickets', (d) => d.items.map((t) => [t.id, t.status, t.updated_at]), { items }),
    html: `${head('Support', 'Get help from our team.', '<button class="btn btn--gold" data-new>' + icon('plus') + ' New ticket</button>')}
    <div class="grid grid--dash">
      <section class="card card--table"><header class="card__head"><h2 class="card__title">Your tickets</h2></header>${items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Reference</th><th>Subject</th><th>Topic</th><th>Status</th><th>Updated</th></tr></thead><tbody>
        ${items.map((t) => `<tr><td><a href="/app/support/${t.id}"><strong>${esc(t.ref)}</strong></a></td><td>${esc(t.subject)}</td><td>${esc(label(t.category))}</td><td>${badge(t.status, t.status === 'pending' ? 'Replied' : null)}</td><td>${ago(t.updated_at)}</td></tr>`).join('')}</tbody></table></div>` : empty('No tickets yet', 'Open a ticket and our team will reply by email and here.')}</section>
      <aside class="card"><h2 class="card__title">Other ways to reach us</h2>
        <div class="contact__item">${icon('mail')}<div><strong>Email</strong><a href="mailto:${esc(s.email || '')}">${esc(s.email || '')}</a></div></div>
        <div class="contact__item">${icon('phone')}<div><strong>Phone</strong><span>${esc(s.phone || '')}</span></div></div>
        ${s.whatsapp ? `<a class="btn btn--primary btn--block" target="_blank" rel="noopener" href="https://wa.me/${esc(String(s.whatsapp).replace(/\D/g, ''))}">${icon('chat')} Chat on WhatsApp</a>` : ''}
        <p class="small muted"><a href="/faqs">Read the FAQs</a></p></aside>
    </div>`,
    mount(root) {
      root.querySelector('[data-new]').addEventListener('click', () => modal({
        title: 'New support ticket',
        body: `<form class="form" data-f novalidate>${field({ name: 'category', label: 'Topic', required: true, options: [['investment', 'Investment'], ['payment', 'Payment'], ['kyc', 'Verification'], ['redemption', 'Withdrawal'], ['account', 'Account'], ['general', 'Other']] })}
          ${field({ name: 'subject', label: 'Subject', required: true, attrs: 'maxlength="160"' })}${field({ name: 'message', label: 'Message', type: 'textarea', required: true, rows: 5, attrs: 'minlength="10" maxlength="5000"' })}
          <p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Open ticket</button></div></form>`,
        onMount(panel, close) {
          bindForm(panel.querySelector('[data-f]'), async (d) => { const r = await api.post('/api/me/tickets', d); close(); toast(`Ticket ${r.ref} opened.`); navigate(`/app/support/${r.id}`); });
        },
      }));
    },
  };
}

export async function ticket(ctx) {
  const { ticket: t, messages } = await api.get(`/api/me/tickets/${encodeURIComponent(ctx.params.id)}`);
  const msgHtml = (m) => `<li class="thread__msg ${m.author_type === 'admin' ? 'thread__msg--staff' : ''}"><header><strong>${m.author_type === 'admin' ? 'Manulife Support' : 'You'}</strong><small>${dateTime(m.created_at)}</small></header><p>${esc(m.body).replace(/\n/g, '<br>')}</p></li>`;
  let count = messages.length;
  return {
    title: t.ref,
    async live(root) {
      const d = await api.get(`/api/me/tickets/${encodeURIComponent(ctx.params.id)}`);
      if (d.messages.length === count) return;
      count = d.messages.length;
      root.querySelector('.thread').innerHTML = d.messages.map(msgHtml).join('');
    },
    html: `<nav class="crumbs"><a href="/app/support">Support</a>${icon('chevronRight')}<span>${esc(t.ref)}</span></nav>${head(t.subject, `${t.ref} · ${label(t.category)}`, badge(t.status, t.status === 'pending' ? 'Replied' : null))}
    <section class="card"><ol class="thread">${messages.map(msgHtml).join('')}</ol>
    ${t.status !== 'closed' ? `<form class="form" data-f novalidate>${field({ name: 'message', label: 'Reply', type: 'textarea', required: true, rows: 4, attrs: 'minlength="2" maxlength="5000"' })}<p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Send reply</button></div></form>` : '<p class="muted">This ticket is closed.</p>'}</section>`,
    mount(root) {
      const f = root.querySelector('[data-f]');
      if (f) bindForm(f, async (d) => { await api.post(`/api/me/tickets/${t.id}/messages`, d); toast('Reply sent.'); ctx.reload(); });
    },
  };
}

/* ------------------------------------------------------------------- settings */
export async function settings(ctx) {
  const u = state.user;
  const { items: sessions } = await api.get('/api/auth/sessions');
  const locked = u.kyc_status === 'approved';
  return {
    title: 'Settings',
    html: `${head('Account settings', 'Manage your profile, password and signed-in devices.')}
    <div class="grid grid--dash">
      <section class="card"><h2 class="card__title">Profile</h2>
        <form class="form" data-profile novalidate><div class="form-grid">
          ${field({ name: 'first_name', label: 'First name', required: true, value: u.first_name, attrs: `maxlength="60" ${locked ? 'readonly' : ''}` })}
          ${field({ name: 'last_name', label: 'Last name', required: true, value: u.last_name, attrs: `maxlength="60" ${locked ? 'readonly' : ''}` })}
          ${field({ name: 'phone', label: 'Phone', type: 'tel', required: true, value: u.phone || '', attrs: 'maxlength="30"' })}
          ${field({ name: 'country', label: 'Country of residence', required: true, value: u.country || '', options: COUNTRIES.map((c) => [c, c]) })}
        </div>${locked ? '<p class="field__hint">Your name is locked after verification. Contact support to change it.</p>' : ''}
        <p class="field__hint">Email: ${esc(u.email)}</p><p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Save profile</button></div></form>
      </section>
      <section class="card"><h2 class="card__title">Change password</h2>
        <form class="form" data-pw novalidate>
          ${field({ name: 'current_password', label: 'Current password', type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
          ${field({ name: 'new_password', label: 'New password', type: 'password', required: true, hint: 'At least 8 characters, with letters and numbers.', attrs: 'autocomplete="new-password" minlength="8" maxlength="128"' })}
          <p class="form-error" hidden></p><div class="form__actions"><button class="btn btn--gold" type="submit">Update password</button></div></form>
      </section>
    </div>
    <section class="card card--table"><header class="card__head"><h2 class="card__title">Signed-in devices</h2>${sessions.length > 1 ? '<button class="btn btn--ghost btn--sm" data-revoke>Sign out other devices</button>' : ''}</header>
      <div class="table-wrap"><table class="table"><thead><tr><th>Device</th><th>IP address</th><th>Signed in</th><th>Last active</th></tr></thead><tbody>
      ${sessions.map((s) => `<tr><td>${esc(deviceName(s.user_agent))}${s.current ? ' <span class="badge badge--ok">This device</span>' : ''}</td><td class="mono">${esc(s.ip || '—')}</td><td>${dateTime(s.created_at)}</td><td>${ago(s.last_seen_at)}</td></tr>`).join('')}</tbody></table></div></section>`,
    mount(root) {
      bindForm(root.querySelector('[data-profile]'), async (d) => { await api.put('/api/me/profile', d); await refreshUser(); toast('Profile saved.'); ctx.reload(); });
      const pw = root.querySelector('[data-pw]');
      bindForm(pw, async (d) => { await api.post('/api/auth/change-password', d); pw.reset(); toast('Password updated. Other devices were signed out.'); ctx.reload(); });
      root.querySelector('[data-revoke]')?.addEventListener('click', async () => { const r = await api.post('/api/auth/sessions/revoke-others'); toast(`Signed out ${r.revoked} other device${r.revoked === 1 ? '' : 's'}.`); ctx.reload(); });
    },
  };
}

export function deviceName(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const o = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return `${b} on ${o}`;
}

export { statusText };
