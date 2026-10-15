/**
 * Procedural dusk-lit architecture illustrations. Used whenever a property has no uploaded
 * photos, so listings always look finished. Deterministic per seed.
 */
let uid = 0;

function rng(seed) {
  let s = (seed * 2654435761) % 4294967296;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

const SKIES = [
  ['#0a1626', '#1f3354', '#7d6a80', '#e7a56a', '#f7d39a'],
  ['#0b1828', '#243d62', '#5f7392', '#d99a68', '#f3c98e'],
  ['#08121f', '#1a2c4a', '#4c5d80', '#c4865e', '#eebd86'],
];

function glass(id) {
  return `<linearGradient id="${id}-glow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe2a8"/><stop offset=".55" stop-color="#f0b465"/><stop offset="1" stop-color="#b5733a"/></linearGradient>
  <linearGradient id="${id}-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d8bb0"/><stop offset=".5" stop-color="#2c4668"/><stop offset="1" stop-color="#16263d"/></linearGradient>
  <linearGradient id="${id}-concrete" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4efe6"/><stop offset="1" stop-color="#c9c0b1"/></linearGradient>
  <linearGradient id="${id}-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d5c78"/><stop offset="1" stop-color="#0e2233"/></linearGradient>
  <linearGradient id="${id}-pool" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fc3d6"/><stop offset="1" stop-color="#1f6e88"/></linearGradient>`;
}

function palm(x, y, s, flip = 1) {
  const fr = (a, l) => `<path d="M${x} ${y - 90 * s} q ${Math.cos(a) * l * 0.5 * s} ${Math.sin(a) * l * 0.3 * s - 18 * s} ${Math.cos(a) * l * s} ${Math.sin(a) * l * s}" stroke="#0d1d17" stroke-width="${7 * s}" fill="none" stroke-linecap="round"/>`;
  return `<path d="M${x} ${y} q ${8 * s * flip} ${-45 * s} 0 ${-90 * s}" stroke="#121c16" stroke-width="${5 * s}" fill="none"/>${[-2.6, -2.1, -1.5, -0.9, -0.4, 0.2].map((a) => fr(a * flip + (flip < 0 ? Math.PI : 0), 62)).join('')}`;
}

function tree(x, y, s, c = '#13261c') {
  return `<ellipse cx="${x}" cy="${y - 34 * s}" rx="${26 * s}" ry="${34 * s}" fill="${c}"/><rect x="${x - 2 * s}" y="${y - 10 * s}" width="${4 * s}" height="${10 * s}" fill="#0d1a13"/>`;
}

function windows(x, y, w, h, cols, rows, r, lit = 0.6, id) {
  let o = '';
  const cw = w / cols;
  const rh = h / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const on = r() < lit;
      o += `<rect x="${(x + i * cw + cw * 0.18).toFixed(1)}" y="${(y + j * rh + rh * 0.2).toFixed(1)}" width="${(cw * 0.64).toFixed(1)}" height="${(rh * 0.6).toFixed(1)}" fill="${on ? `url(#${id}-glow)` : '#1c2c42'}" opacity="${on ? 0.95 : 0.85}"/>`;
    }
  }
  return o;
}

function slab(x, y, w, h, id, r, mullion = 34) {
  let o = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id}-glow)"/>`;
  for (let m = x + mullion; m < x + w - 4; m += mullion) {
    o += `<rect x="${m}" y="${y}" width="2.4" height="${h}" fill="#3a2a1c" opacity=".75"/>`;
    if (r() < 0.25) o += `<rect x="${m + 2.4}" y="${y}" width="${mullion - 2.4}" height="${h}" fill="#2a2f3a" opacity=".55"/>`;
  }
  o += `<rect x="${x - 14}" y="${y - 12}" width="${w + 28}" height="12" fill="url(#${id}-concrete)"/>`;
  o += `<rect x="${x - 14}" y="${y + h}" width="${w + 28}" height="8" fill="#d8d0c2"/>`;
  return o;
}

function residential(id, r, W, H) {
  const hz = 330;
  const bx = 150 + r() * 40;
  let o = `<rect x="0" y="${hz}" width="${W}" height="${H - hz}" fill="#0f1d17"/>`;
  o += `<rect x="${bx - 30}" y="${hz - 6}" width="${W - bx}" height="10" fill="#cfc6b6"/>`;
  // Ground floor, cantilevered first floor, recessed top floor
  o += slab(bx, hz - 78, 420, 72, id, r, 36);
  o += `<rect x="${bx + 300}" y="${hz - 78}" width="60" height="72" fill="#6b4a2f"/>`;
  for (let k = 0; k < 7; k++) o += `<rect x="${bx + 302 + k * 8}" y="${hz - 78}" width="3" height="72" fill="#4f3521"/>`;
  o += slab(bx + 70, hz - 172, 470, 72, id, r, 40);
  o += slab(bx + 150, hz - 248, 240, 54, id, r, 30);
  o += `<rect x="${bx + 560}" y="${hz - 100}" width="16" height="94" fill="#2a3240"/>`;
  // Pool with reflection
  o += `<rect x="${bx - 60}" y="${hz + 22}" width="${560}" height="62" fill="url(#${id}-pool)"/>`;
  o += `<rect x="${bx - 60}" y="${hz + 22}" width="560" height="4" fill="#e9e1d1"/>`;
  for (let k = 0; k < 9; k++) o += `<rect x="${bx + k * 46}" y="${hz + 30 + (k % 3) * 9}" width="${24 + r() * 18}" height="3" fill="#ffd89a" opacity=".55"/>`;
  o += `<rect x="0" y="${hz + 84}" width="${W}" height="${H}" fill="#0b1712"/>`;
  o += palm(70, hz + 30, 1.25) + palm(W - 70, hz + 40, 1.35, -1) + palm(W - 150, hz + 10, 0.9, -1);
  o += tree(bx - 40, hz, 0.9) + tree(bx + 610, hz - 2, 1.05);
  return o;
}

function commercial(id, r, W, H) {
  const hz = 400;
  let o = '';
  const t1x = 280 + r() * 40;
  o += `<rect x="${t1x}" y="60" width="150" height="${hz - 60}" fill="url(#${id}-glass)"/>`;
  o += windows(t1x + 6, 74, 138, hz - 90, 6, 22, r, 0.42, id);
  o += `<path d="M${t1x - 6} 60 L${t1x + 75} 28 L${t1x + 156} 60 Z" fill="#1a2b42"/>`;
  o += `<rect x="${t1x + 160}" y="140" width="120" height="${hz - 140}" fill="url(#${id}-glass)" opacity=".95"/>`;
  o += windows(t1x + 166, 152, 108, hz - 170, 5, 17, r, 0.36, id);
  o += `<rect x="${t1x - 150}" y="230" width="120" height="${hz - 230}" fill="#1b2c44"/>`;
  o += windows(t1x - 144, 240, 108, hz - 255, 5, 9, r, 0.3, id);
  for (let k = 0; k < 22; k++) o += `<rect x="${t1x + 2}" y="${74 + k * ((hz - 90) / 22)}" width="146" height="1.2" fill="#9fb6d1" opacity=".35"/>`;
  o += `<rect x="0" y="${hz}" width="${W}" height="${H - hz}" fill="#121821"/>`;
  o += `<rect x="0" y="${hz + 28}" width="${W}" height="3" fill="#f0c27c" opacity=".35"/>`;
  for (let k = 0; k < 7; k++) o += tree(40 + k * 120 + r() * 30, hz + 12, 0.7 + r() * 0.2, '#16281d');
  return o;
}

function mixed(id, r, W, H) {
  const hz = 380;
  let o = '';
  const blocks = [[90, 210, 170], [270, 150, 200], [480, 230, 150], [640, 190, 130]];
  for (const [x, top, w] of blocks) {
    o += `<rect x="${x}" y="${top}" width="${w}" height="${hz - top}" fill="url(#${id}-concrete)"/>`;
    o += windows(x + 6, top + 14, w - 12, hz - top - 20, Math.round(w / 28), Math.round((hz - top) / 30), r, 0.55, id);
    for (let k = 0; k < Math.round(w / 26); k++) o += `<circle cx="${x + 12 + k * 26}" cy="${top - 6}" r="${9 + r() * 5}" fill="#1f4a32"/>`;
  }
  o += `<rect x="0" y="${hz}" width="${W}" height="${H - hz}" fill="#14251b"/>`;
  o += `<ellipse cx="${W / 2}" cy="${hz + 70}" rx="${W / 2.2}" ry="40" fill="#1a3324"/>`;
  for (let k = 0; k < 9; k++) o += tree(30 + k * 92 + r() * 20, hz + 40 + r() * 30, 0.8 + r() * 0.4, k % 2 ? '#183a26' : '#122c1e');
  return o;
}

function hospitality(id, r, W, H) {
  const hz = 340;
  let o = '';
  o += `<rect x="110" y="170" width="580" height="${hz - 170}" fill="url(#${id}-concrete)"/>`;
  for (let f = 0; f < 5; f++) {
    const y = 182 + f * 31;
    o += `<rect x="104" y="${y + 22}" width="592" height="5" fill="#e9e3d8"/>`;
    o += windows(118, y, 564, 22, 18, 1, r, 0.7, id);
  }
  o += `<rect x="96" y="160" width="608" height="12" fill="#efe9de"/>`;
  o += `<rect x="0" y="${hz}" width="${W}" height="${H - hz}" fill="#e2cf9f" opacity=".9"/>`;
  o += `<rect x="0" y="${hz + 70}" width="${W}" height="${H}" fill="url(#${id}-water)"/>`;
  o += `<rect x="200" y="${hz + 14}" width="400" height="40" rx="18" fill="url(#${id}-pool)"/>`;
  o += palm(70, hz + 40, 1.2) + palm(150, hz + 30, 0.9) + palm(W - 60, hz + 46, 1.3, -1) + palm(W - 150, hz + 30, 0.95, -1);
  return o;
}

export function propertyArt(seed = 1, type = 'residential', { variant = 0, label = '' } = {}) {
  const id = `art${++uid}`;
  const r = rng(seed * 31 + variant * 7 + 3);
  const W = 800;
  const H = 500;
  const sky = SKIES[(seed + variant) % SKIES.length];
  const sunX = 120 + r() * 560;
  let skyline = '';
  for (let x = 0; x < W; x += 30 + r() * 40) {
    const h = 30 + r() * 110;
    skyline += `<rect x="${x.toFixed(0)}" y="${(330 - h).toFixed(0)}" width="${(18 + r() * 30).toFixed(0)}" height="${h.toFixed(0)}" fill="#1a2840" opacity=".55"/>`;
  }
  const scene = { commercial, mixed_use: mixed, hospitality }[type] || residential;
  return `<svg class="art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${label ? label.replace(/"/g, '') + ' illustration' : 'Property illustration'}">
  <defs>
    <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${sky[0]}"/><stop offset=".35" stop-color="${sky[1]}"/><stop offset=".62" stop-color="${sky[2]}"/><stop offset=".8" stop-color="${sky[3]}"/><stop offset="1" stop-color="${sky[4]}"/>
    </linearGradient>
    <radialGradient id="${id}-sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe7b8" stop-opacity=".9"/><stop offset="1" stop-color="#ffe7b8" stop-opacity="0"/></radialGradient>
    ${glass(id)}
  </defs>
  <rect width="${W}" height="${H}" fill="url(#${id}-sky)"/>
  <circle cx="${sunX.toFixed(0)}" cy="330" r="190" fill="url(#${id}-sun)"/>
  ${skyline}
  ${scene(id, r, W, H)}
</svg>`;
}

const BUNDLED = new Set(['lagos-waterfront-residences', 'eko-business-tower', 'abuja-green-city', 'lekki-pearl-hotel-and-suites', 'ikoyi-crest-apartments', 'accra-ridge-offices']);

/** Bundled demo photo for a known property slug (3 per property). */
export function photoFor(slug, variant = 0) {
  return BUNDLED.has(slug) ? `/assets/img/properties/${slug}-${(variant % 3) + 1}.jpg` : null;
}

/** Uploaded photo, else bundled demo photo, else generated art. */
export function propertyVisual(p, variant = 0) {
  const img = (p.images && p.images[variant % Math.max(1, p.images.length)]) || photoFor(p.slug, variant);
  if (img) return `<img src="${img}" alt="${String(p.name).replace(/"/g, '')}" loading="lazy">`;
  return propertyArt(p.art_seed || 1, p.type, { variant, label: p.name });
}
