'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { db, insert } = require('./index');
const { now, addDays, addMonths, round } = require('../lib/util');
const { hashPassword } = require('../lib/auth');
const { setCms, DEFAULT_SETTINGS } = require('../lib/services');
const { returnTerms } = require('../lib/engine');

const LEGAL_NOTE = 'Template placeholder. Replace this text with the version approved by your legal counsel before enabling public investment.';

const CMS = {
  site: {
    brand: 'EstateInvest', tagline: 'Real estate investment platform',
    email: 'invest@estateinvest.example', phone: '+234 800 000 0000', whatsapp: '2348000000000',
    address: '12 Admiralty Way, Lekki Phase 1, Lagos, Nigeria', hours: 'Monday to Friday, 9:00–17:00 WAT',
    registration: 'Company registration and licensing details will appear here once supplied.',
  },
  home: {
    hero_title: 'Invest in real estate. Build long-term wealth.',
    hero_subtitle: 'Access carefully structured real estate investment opportunities and track your portfolio from one secure platform.',
    stats: [
      { value: '$250M+', label: 'Assets under management' }, { value: '5,000+', label: 'Investors worldwide' },
      { value: '20+', label: 'Properties' }, { value: '10+', label: 'Countries' },
    ],
    stats_note: 'Figures are supplied by EstateInvest and must be verified before publication.',
  },
  about: {
    intro: 'EstateInvest connects investors with professionally managed residential, commercial and hospitality developments across West Africa.',
    history: 'Founded by a team of developers, surveyors and fund managers, EstateInvest grew out of a simple observation: quality property projects in fast-growing cities often struggle to reach investors who want transparent, well-documented opportunities.',
    mission: 'To make well-structured real estate opportunities accessible, with clear terms, honest risk disclosure and reporting investors can rely on.',
    model: 'We source and assess projects, structure investment plans with fixed durations, and report on progress through the investor dashboard. Plans, returns and terms are set out in documents approved by our legal advisers before any opportunity is opened to investors.',
    licensing: 'Registration and licensing information will be published here once supplied by the company.',
    team: [
      { name: 'Adaeze Okonkwo', role: 'Chief Executive Officer', bio: 'Twenty years in property development and project finance.' },
      { name: 'Tunde Bakare', role: 'Head of Investments', bio: 'Former fund manager focused on income-producing real estate.' },
      { name: 'Grace Mensah', role: 'Head of Compliance', bio: 'Leads KYC, AML and investor protection.' },
      { name: 'Ifeanyi Eze', role: 'Head of Development', bio: 'Chartered surveyor overseeing construction and delivery.' },
    ],
  },
  how_it_works: {
    steps: [
      { title: 'Create your account', body: 'Register with your email and verify it. It takes about two minutes.' },
      { title: 'Verify your identity', body: 'Upload a government ID, proof of address and a selfie. Our compliance team reviews them, usually within two business days.' },
      { title: 'Choose a property and plan', body: 'Review the property, its documents and risks, then pick a plan duration and amount that suits you.' },
      { title: 'Pay with cryptocurrency', body: 'Send USDT, BTC, ETH or TON to the address shown. We confirm the payment on the blockchain and activate your investment.' },
      { title: 'Track to maturity', body: 'Follow your investment, documents and transactions in your dashboard. At maturity, request redemption to your wallet.' },
    ],
  },
  faqs: [
    { q: 'Who can invest?', a: 'Adults aged 18 or over who complete identity verification and meet the eligibility rules in our Investment Terms.', category: 'Getting started' },
    { q: 'Which payment methods do you accept?', a: 'Cryptocurrency only: USDT, BTC, ETH and TON on the networks shown at checkout. Bank transfers are not supported.', category: 'Payments' },
    { q: 'How long does payment confirmation take?', a: 'Usually minutes after the required number of blockchain confirmations. Your dashboard updates once your payment is verified.', category: 'Payments' },
    { q: 'What happens if I send the wrong amount?', a: 'Underpayments are held for manual review. Contact support with your transaction hash and our team will help.', category: 'Payments' },
    { q: 'What returns can I expect?', a: 'Any return structure is set out in the plan terms approved by our legal advisers. Returns are not guaranteed and you could lose some or all of your investment.', category: 'Investing' },
    { q: 'Can I withdraw early?', a: 'Redemption is available at maturity. Early redemption is only possible where the plan terms allow it and is subject to review.', category: 'Investing' },
    { q: 'How is my data protected?', a: 'Documents are stored privately and only reviewed by our compliance team. Read our Privacy Policy for details.', category: 'Security' },
    { q: 'How do I contact support?', a: 'Use the contact form, open a ticket from your dashboard, email us, or message us on WhatsApp.', category: 'Support' },
  ],
  testimonials: [
    { name: 'Chidi A.', role: 'Investor since 2023', quote: 'The documents for each property were thorough, and I could follow my investment at every step.' },
    { name: 'Fatima B.', role: 'Investor since 2024', quote: 'Verification was quick, and support answered my payment question within the hour.' },
    { name: 'Kwame O.', role: 'Investor since 2022', quote: 'Clear terms, clear dates. I always know where my money is.' },
  ],
  disclosures: {
    footer: 'Investing in real estate involves risk, including the loss of capital. Past performance is not a reliable indicator of future results. Cryptocurrency payments are irreversible and their value can change quickly. Read the Risk Disclosure before investing.',
  },
  legal: {
    terms: { title: 'Terms & Conditions', body: `${LEGAL_NOTE}\n\n## 1. About these terms\nThese terms govern your use of the EstateInvest website and investor portal.\n\n## 2. Eligibility\nYou must be at least 18 and complete identity verification to invest.\n\n## 3. Your account\nKeep your password secure. You are responsible for activity on your account.\n\n## 4. Limitation of liability\nTo be supplied by counsel.` },
    privacy: { title: 'Privacy Policy', body: `${LEGAL_NOTE}\n\n## What we collect\nIdentity, contact, verification and transaction information.\n\n## Why we collect it\nTo verify your identity, meet anti-money-laundering obligations and manage your investments.\n\n## Your rights\nYou can request access to or correction of your data by contacting us.` },
    investment_terms: { title: 'Investment Terms', body: `${LEGAL_NOTE}\n\n## Plans\nEach plan has a fixed duration, minimum and maximum amount, and terms set out on the plan page.\n\n## Returns\nReturn structures are only shown once approved. Returns are not guaranteed.\n\n## Maturity\nYour maturity date is calculated from the date your payment is confirmed.` },
    risk: { title: 'Risk Disclosure', body: `${LEGAL_NOTE}\n\n## Capital at risk\nYou could lose some or all of the money you invest.\n\n## Property risks\nConstruction delays, cost overruns, market downturns, regulatory changes and tenant default can all affect outcomes.\n\n## Liquidity\nYou may not be able to withdraw before maturity.\n\n## Cryptocurrency risks\nCrypto transfers are irreversible. Prices are volatile, and sending to the wrong address or network can result in permanent loss.` },
    kyc_aml: { title: 'KYC / AML Policy', body: `${LEGAL_NOTE}\n\n## Verification\nWe verify every investor's identity, address and source of funds before accepting investments.\n\n## Monitoring\nWe monitor transactions and may request more information or suspend accounts where required by law.` },
    redemption: { title: 'Redemption & Refund Policy', body: `${LEGAL_NOTE}\n\n## At maturity\nYou can request redemption to a wallet in your name once your investment matures.\n\n## Review\nRequests are reviewed and may require additional security checks.\n\n## Refunds\nPayments for cancelled investments are refunded in line with this policy, less network fees.` },
    investor_agreement: { title: 'Investor Agreement', body: `${LEGAL_NOTE}\n\nThe investor agreement will be published here.` },
    crypto: { title: 'Crypto Payment Disclosure', body: `${LEGAL_NOTE}\n\n## Supported assets\nOnly the cryptocurrencies and networks shown at checkout are supported.\n\n## Exchange rates\nThe USD value of your payment is fixed at the rate shown when you start the investment.\n\n## Wrong network or address\nFunds sent on an unsupported network or to an address not shown in your dashboard may be lost permanently.` },
  },
};

const PROPERTIES = [
  { name: 'Lagos Waterfront Residences', type: 'residential', city: 'Lagos', country: 'Nigeria', dev_status: 'under_development', featured: 1, min: 5000, target: 12000000, seed: 11,
    summary: 'A premium residential development offering modern living spaces in a prime waterfront location.',
    description: 'Lagos Waterfront Residences is a premium residential development designed to offer modern living spaces with world-class amenities in a strategic waterfront location.\n\nThe development comprises 84 apartments and 12 penthouses across three terraced blocks, with a marina promenade, residents’ club, infinity pool and 24-hour security.',
    details: { 'Property type': 'Residential', 'Development status': 'Under development', Units: '96 apartments', 'Site area': '2.4 hectares', 'Expected completion': 'Q4 2027', Developer: 'EstateInvest Developments Ltd' },
    highlights: ['Direct lagoon frontage with private marina', 'Infinity pool and residents’ club', 'Phase 1 structural works complete'] },
  { name: 'Eko Business Tower', type: 'commercial', city: 'Lagos', country: 'Nigeria', dev_status: 'under_development', featured: 1, min: 10000, target: 25000000, seed: 27,
    summary: 'A 22-storey Grade A office tower in the heart of Eko Atlantic’s business district.',
    description: 'Eko Business Tower offers 38,000 m² of Grade A office space with floor-to-ceiling glazing, backup power and smart building systems.\n\nPre-letting discussions are under way with financial services and technology tenants.',
    details: { 'Property type': 'Commercial', 'Development status': 'Under development', Floors: '22', 'Lettable area': '38,000 m²', 'Expected completion': 'Q2 2028', Developer: 'EstateInvest Developments Ltd' },
    highlights: ['Grade A specification', 'Located in Eko Atlantic City', 'LEED certification targeted'] },
  { name: 'Abuja Green City', type: 'mixed_use', city: 'Abuja', country: 'Nigeria', dev_status: 'planning', featured: 1, min: 7500, target: 18000000, seed: 43,
    summary: 'A walkable mixed-use neighbourhood combining homes, offices and retail around a central park.',
    description: 'Abuja Green City is a mixed-use community planned around a 4-hectare park, combining 300 homes with offices, shops and a medical centre.\n\nThe project is in final planning stage with permits in progress.',
    details: { 'Property type': 'Mixed use', 'Development status': 'Planning', Homes: '300', 'Commercial space': '12,000 m²', 'Expected completion': '2029', Developer: 'Green City Partners' },
    highlights: ['Solar-powered common areas', 'Central park and cycle network', 'Close to the Central Business District'] },
  { name: 'Lekki Pearl Hotel & Suites', type: 'hospitality', city: 'Lagos', country: 'Nigeria', dev_status: 'operational', featured: 0, min: 5000, target: 9000000, seed: 58,
    summary: 'An operating 140-key boutique hotel undergoing refurbishment and expansion.',
    description: 'Lekki Pearl Hotel & Suites is an established boutique hotel. Investment funds the refurbishment of all rooms and the addition of 40 serviced suites.',
    details: { 'Property type': 'Hospitality', 'Development status': 'Operational', Keys: '140 + 40 suites', 'Occupancy (trailing 12m)': 'To be supplied', Operator: 'Pearl Hospitality Ltd' },
    highlights: ['Operating asset', 'Refurbishment programme under way', 'Beachfront location'] },
  { name: 'Ikoyi Crest Apartments', type: 'residential', city: 'Lagos', country: 'Nigeria', dev_status: 'completed', featured: 0, min: 2500, target: 6000000, seed: 71,
    summary: 'Completed luxury apartments in Ikoyi let to corporate tenants.',
    description: 'Ikoyi Crest is a completed block of 36 luxury apartments let on corporate leases. Investment supports the acquisition and refinancing of the building.',
    details: { 'Property type': 'Residential', 'Development status': 'Completed', Units: '36 apartments', Occupancy: 'To be supplied', Developer: 'Crest Homes' },
    highlights: ['Completed and let', 'Corporate tenants', 'Prime Ikoyi address'] },
  { name: 'Accra Ridge Offices', type: 'commercial', city: 'Accra', country: 'Ghana', dev_status: 'under_development', featured: 0, min: 5000, target: 11000000, seed: 86,
    summary: 'Boutique office campus in Accra’s Ridge district.',
    description: 'Three low-rise office pavilions set in landscaped grounds, aimed at embassies, NGOs and professional firms.',
    details: { 'Property type': 'Commercial', 'Development status': 'Under development', Buildings: '3 pavilions', 'Lettable area': '14,500 m²', 'Expected completion': 'Q1 2028' },
    highlights: ['Diplomatic district location', 'Landscaped campus', 'Flexible floor plates'] },
];

const PLANS = [
  { name: '1 Month', duration_months: 1, min_amount: 1000, max_amount: 50000, sort: 1 },
  { name: '3 Months', duration_months: 3, min_amount: 2500, max_amount: 100000, sort: 2 },
  { name: '6 Months', duration_months: 6, min_amount: 5000, max_amount: 250000, sort: 3 },
  { name: '1 Year', duration_months: 12, min_amount: 10000, max_amount: 500000, sort: 4 },
  { name: '2 Years', duration_months: 24, min_amount: 25000, max_amount: 1000000, sort: 5 },
  { name: 'Custom (3 Years)', duration_months: 36, min_amount: 50000, max_amount: null, sort: 6 },
];

const RISK_TEXT = 'Your capital is at risk. Property projects can be delayed or cost more than planned, and values can fall. You may not be able to withdraw before maturity. Read the Risk Disclosure before investing.';
const PROPERTY_RISKS = 'Construction and completion risk; market and valuation risk; regulatory and permitting risk; currency and cryptocurrency price risk; liquidity risk — you may not be able to exit before maturity. Full details are in the Risk Disclosure.';

/* Tiny PNG encoder used to create placeholder KYC images for demo accounts. */
function png(w, h, draw) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = draw(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function storeFile(buf, ownerId, kind, name, mime = 'image/png') {
  fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
  const stored = crypto.randomBytes(20).toString('hex');
  fs.writeFileSync(path.join(config.UPLOAD_DIR, stored), buf);
  return insert(db, 'files', { owner_id: ownerId, kind, original_name: name, stored_name: stored, mime, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), visibility: 'private', created_at: now() });
}

function demoDoc(kind) {
  const W = 360, H = 230;
  return png(W, H, (x, y) => {
    if (kind === 'selfie') {
      const dx = x - 180, dy = y - 100;
      if (dx * dx + dy * dy < 55 * 55) return [196, 150, 120];
      if (y > 160 && Math.abs(dx) < 110 - (y - 160) * -0.6) return [40, 60, 90];
      return [222, 228, 236];
    }
    const border = x < 6 || y < 6 || x > W - 7 || y > H - 7;
    if (border) return [201, 164, 92];
    if (kind === 'identity' && x > 24 && x < 120 && y > 50 && y < 180) return [150, 160, 175];
    if (y % 22 > 18 && x > 140 && x < 330 && y > 50 && y < 200) return [120, 130, 145];
    if (y < 36) return [13, 27, 42];
    return [246, 243, 236];
  });
}

function rng(seed) { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); }
const hex = (r, n) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');

async function seed() {
  const has = await db.get('SELECT COUNT(*) AS n FROM users');
  if (Number(has.n) > 0) return;
  console.log('Seeding database…');
  for (const [k, v] of Object.entries(CMS)) await setCms(k, v);
  const t0 = now();
  await insert(db, 'users', {
    role: 'super_admin', first_name: 'Admin', last_name: 'User', email: config.SEED_ADMIN_EMAIL.toLowerCase(), password_hash: hashPassword(config.SEED_ADMIN_PASSWORD),
    email_verified_at: t0, status: 'active', kyc_status: 'not_started', created_at: t0, updated_at: t0,
  });
  if (!config.SEED_DEMO_DATA) return;

  const propIds = [];
  for (const p of PROPERTIES) {
    propIds.push(await insert(db, 'properties', {
      slug: p.name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name: p.name, type: p.type, city: p.city, country: p.country,
      summary: p.summary, description: p.description, dev_status: p.dev_status, status: 'published', accepting: p.dev_status === 'completed' ? 0 : 1, featured: p.featured,
      min_investment: p.min, target_raise: p.target, details: JSON.stringify(p.details), highlights: JSON.stringify(p.highlights), risks: PROPERTY_RISKS,
      art_seed: p.seed, images: '[]', created_at: addDays(t0, -200 + propIds.length * 10), updated_at: t0,
    }));
  }
  const plans = [];
  for (const pl of PLANS) {
    const id = await insert(db, 'plans', {
      ...pl, return_type: 'pending', return_rate: null, return_note: 'Return structure pending legal approval.', return_approved: 0,
      terms: 'Funds are committed for the full plan duration. Maturity is calculated from the date your payment is confirmed. Full terms are in the Investment Terms.',
      risk_info: RISK_TEXT, required_docs: 'Approved identity verification', status: 'active', created_at: t0, updated_at: t0,
    });
    plans.push({ ...pl, id, return_type: 'pending', return_approved: 0 });
  }

  const pw = hashPassword('Investor@123');
  const people = [
    ['John', 'Doe', 'john@example.com', 'Nigeria', 'approved'], ['Sarah', 'Doe', 'sarah@example.com', 'United Kingdom', 'approved'],
    ['Michael', 'Lee', 'michael@example.com', 'Ghana', 'approved'], ['Emily', 'Davis', 'emily@example.com', 'United States', 'approved'],
    ['David', 'Wilson', 'david@example.com', 'Kenya', 'approved'], ['Amaka', 'Okafor', 'amaka@example.com', 'Nigeria', 'pending_review'],
    ['John', 'Smith', 'john.smith@example.com', 'Nigeria', 'pending_review'], ['Lerato', 'Dlamini', 'lerato@example.com', 'South Africa', 'requires_info'],
    ['Omar', 'Haddad', 'omar@example.com', 'UAE', 'not_started'],
  ];
  const users = [];
  for (const [i, [fn, ln, email, country, kyc]] of people.entries()) {
    const created = addDays(t0, -300 + i * 25);
    const id = await insert(db, 'users', {
      role: 'investor', first_name: fn, last_name: ln, email, phone: `+234 801 234 ${5670 + i}`, country, password_hash: pw, email_verified_at: created,
      status: 'active', kyc_status: kyc, terms_accepted_at: created, created_at: created, updated_at: created, last_login_at: addDays(t0, -i),
    });
    users.push({ id, fn, ln, kyc, created });
    if (kyc !== 'not_started') {
      const personal = { dob: '1990-03-12T00:00:00.000Z', nationality: country, country, address: '14 Bourdillon Road', city: 'Lagos', postal_code: '101233', occupation: 'Engineer' };
      await insert(db, 'kyc_submissions', {
        user_id: id, status: kyc, personal: JSON.stringify(personal), id_doc_type: 'passport',
        source_of_funds: JSON.stringify({ source: 'employment', details: 'Salary and savings' }),
        suitability: JSON.stringify({ annual_income: '100k_250k', experience: 'some', risk_tolerance: 'medium', pep: false, understands_risk: true }),
        admin_note: kyc === 'requires_info' ? 'Your proof of address is older than 3 months. Upload a recent document.' : null,
        submitted_at: addDays(created, 1), reviewed_at: kyc === 'approved' ? addDays(created, 2) : null, created_at: created, updated_at: created,
      });
      for (const kind of ['identity', 'address', 'selfie']) {
        const fid = await storeFile(demoDoc(kind), id, `kyc_${kind}`, `${kind}.png`);
        await insert(db, 'kyc_documents', { user_id: id, kind, file_id: fid, status: kyc === 'approved' ? 'verified' : 'pending', created_at: addDays(created, 1) });
      }
    }
  }

  const r = rng(7);
  const cur = DEFAULT_SETTINGS.payments.currencies;
  const year = new Date().getUTCFullYear();
  const nowMonth = new Date().getUTCMonth();
  let invCount = 0;
  async function makeInvestment(u, { propIdx, plan, amount, created, status, curIdx = 0 }) {
    const c = cur[curIdx];
    const net = c.networks[0];
    const crypto_amount = round(amount / c.rate_usd, c.decimals);
    const terms = returnTerms(plan);
    const start = ['pending', 'payment_awaiting', 'cancelled'].includes(status) ? null : addDays(created, 0.02);
    const maturity = start ? addMonths(start, plan.duration_months) : null;
    const invId = await insert(db, 'investments', {
      ref: null, user_id: u.id, property_id: propIds[propIdx], plan_id: plan.id, amount_usd: amount, currency: c.code, network: net.code, crypto_amount,
      status, start_date: start, maturity_date: maturity, return_terms: JSON.stringify(terms), expected_return: null, created_at: created, updated_at: created,
    });
    await db.run('UPDATE investments SET ref=? WHERE id=?', [`INV-${10000 + invId}`, invId]);
    const chain = { payment_awaiting: ['pending', 'payment_awaiting'], cancelled: ['pending', 'payment_awaiting', 'cancelled'] }[status]
      || ['pending', 'payment_awaiting', 'payment_confirmed', 'active', ...(status === 'maturing' ? ['maturing'] : []), ...(['matured', 'redeemed', 'completed'].includes(status) ? ['matured'] : []), ...(['redeemed', 'completed'].includes(status) ? [status] : [])];
    let prev = null;
    for (const s of chain) {
      await insert(db, 'investment_status_history', { investment_id: invId, from_status: prev, to_status: s, reason: s === 'pending' ? 'Investment created' : null, actor_id: null, created_at: created });
      prev = s;
    }
    const payStatus = status === 'payment_awaiting' ? 'awaiting' : status === 'cancelled' ? 'expired' : 'confirmed';
    const payId = await insert(db, 'payments', {
      kind: 'deposit', user_id: u.id, investment_id: invId, currency: c.code, network: net.code, amount_crypto: crypto_amount, amount_usd: amount, rate_usd: c.rate_usd,
      wallet_address: net.address, tx_hash: payStatus === 'confirmed' ? `0xdemo${hex(r, 58)}` : null, confirmations: payStatus === 'confirmed' ? 24 : 0,
      status: payStatus, verification: payStatus === 'confirmed' ? 'verified' : 'unverified', provider: 'manual', verified_at: payStatus === 'confirmed' ? addDays(created, 0.02) : null,
      expires_at: payStatus === 'awaiting' ? addDays(now(), 1 / 24) : addDays(created, 1 / 24), created_at: created, updated_at: created,
    });
    await db.run('UPDATE payments SET ref=? WHERE id=?', [`TX-${900 + payId}`, payId]);
    invCount++;
    return invId;
  }

  const john = users[0];
  // John: mirrors the dashboard mock-up — 4 active, 1 matured, 1 awaiting payment.
  await makeInvestment(john, { propIdx: 0, plan: plans[4], amount: 50000, created: addMonths(t0, -7), status: 'active', curIdx: 0 });
  await makeInvestment(john, { propIdx: 1, plan: plans[3], amount: 37500, created: addMonths(t0, -5), status: 'active', curIdx: 2 });
  await makeInvestment(john, { propIdx: 2, plan: plans[3], amount: 25000, created: addMonths(t0, -3), status: 'active', curIdx: 1 });
  await makeInvestment(john, { propIdx: 3, plan: plans[0], amount: 6250, created: addDays(t0, -20), status: 'maturing', curIdx: 3 });
  await makeInvestment(john, { propIdx: 4, plan: plans[1], amount: 6250, created: addMonths(addDays(t0, -2), -3), status: 'matured', curIdx: 0 });
  await makeInvestment(john, { propIdx: 0, plan: plans[2], amount: 10000, created: addDays(t0, 0), status: 'payment_awaiting', curIdx: 0 });

  // Platform activity across the current year for the admin dashboard.
  const approved = users.filter((u) => u.kyc === 'approved').slice(1);
  for (let m = 0; m <= nowMonth; m++) {
    const n = 2 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const u = approved[Math.floor(r() * approved.length)];
      const plan = plans[Math.floor(r() * 5)];
      const amount = Math.max(plan.min_amount, Math.round((plan.min_amount + r() * 40000) / 500) * 500);
      const created = new Date(Date.UTC(year, m, 1 + Math.floor(r() * 26), 9 + Math.floor(r() * 8))).toISOString();
      if (created > t0) continue;
      const maturity = addMonths(created, plan.duration_months);
      let status = maturity < t0 ? (r() > 0.5 ? 'redeemed' : 'matured') : 'active';
      if (status === 'active' && maturity < addDays(t0, 14)) status = 'maturing';
      await makeInvestment(u, { propIdx: Math.floor(r() * 6) % 5, plan, amount, created, status, curIdx: Math.floor(r() * 4) });
    }
  }
  // A submitted payment waiting for admin verification.
  const sarah = users[1];
  const subId = await makeInvestment(sarah, { propIdx: 1, plan: plans[2], amount: 10000, created: addDays(t0, -0.01), status: 'payment_awaiting', curIdx: 2 });
  await db.run("UPDATE payments SET status='submitted', tx_hash=? WHERE investment_id=?", [`0xdemo${hex(r, 58)}`, subId]);

  // A redemption request on a matured investment.
  const matured = await db.get("SELECT * FROM investments WHERE status='matured' AND user_id<>? ORDER BY id LIMIT 1", [john.id]);
  if (matured) {
    const rid = await insert(db, 'redemptions', {
      user_id: matured.user_id, investment_id: matured.id, amount_usd: matured.amount_usd, currency: 'USDT', network: 'TRC20',
      destination_wallet: 'TDemoInvestorWalletAddressForPayout01', status: 'requested', created_at: addDays(t0, -1), updated_at: addDays(t0, -1),
    });
    await db.run('UPDATE redemptions SET ref=? WHERE id=?', [`RED-${3000 + rid}`, rid]);
  }

  // Notifications and a support ticket for John.
  for (const [type, title, body, link] of [
    ['investment', 'Your investment matures soon', 'An investment in Lekki Pearl Hotel & Suites matures within the next two weeks.', '/app/investments'],
    ['payment', 'Payment instructions for your investment', 'Send the exact amount shown to complete your latest investment.', '/app/investments'],
    ['kyc', 'Identity verified', 'Your identity verification was approved. You can now invest.', '/app/kyc'],
  ]) await insert(db, 'notifications', { user_id: john.id, type, title, body, link, created_at: addDays(t0, -invCount % 3) });
  const tid = await insert(db, 'tickets', { user_id: john.id, name: 'John Doe', email: 'john@example.com', subject: 'Question about maturity payout', category: 'redemption', status: 'pending', created_at: addDays(t0, -3), updated_at: addDays(t0, -2) });
  await db.run('UPDATE tickets SET ref=? WHERE id=?', [`SUP-${5000 + tid}`, tid]);
  await insert(db, 'ticket_messages', { ticket_id: tid, author_id: john.id, author_type: 'investor', body: 'When my investment matures, can I choose which network the payout is sent on?', created_at: addDays(t0, -3) });
  await insert(db, 'ticket_messages', { ticket_id: tid, author_id: 1, author_type: 'admin', body: 'Yes — when you request redemption you can choose any supported currency and network. We send to the wallet you specify after security checks.', created_at: addDays(t0, -2) });

  await insert(db, 'posts', {
    slug: 'lagos-waterfront-phase-one-complete', title: 'Lagos Waterfront Residences: phase 1 structure complete',
    excerpt: 'The first of three residential blocks has reached roof level, on schedule.', status: 'published', published_at: addDays(t0, -12), created_at: addDays(t0, -12), updated_at: addDays(t0, -12),
    body: 'Construction of Block A at Lagos Waterfront Residences reached roof level this month, keeping phase 1 on programme.\n\n## What comes next\nFacade installation starts next quarter, followed by mechanical and electrical fit-out.\n\nInvestors can follow progress updates in the property documents section.',
  });
  console.log(`Seeded ${users.length} investors, ${PROPERTIES.length} properties, ${PLANS.length} plans, ${invCount} investments.`);
}

module.exports = { seed };
