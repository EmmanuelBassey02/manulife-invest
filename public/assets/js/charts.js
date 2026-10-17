import { esc, money } from './ui.js';

let cid = 0;
const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};

export function lineChart(points, { height = 240, format = (v) => money(v, { compact: true }) } = {}) {
  const id = `lc${++cid}`;
  const W = 640, H = height, L = 56, R = 16, T = 18, B = 32;
  const max = niceMax(Math.max(...points.map((p) => p.value), 0) * 1.1);
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, points.length - 1);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const pts = points.map((p, i) => [x(i), y(p.value)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1)} ${H - B} L${L} ${H - B} Z`;
  let grid = '';
  for (let k = 0; k <= 4; k++) {
    const v = (max * k) / 4;
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="chart__grid"/><text x="${L - 10}" y="${y(v) + 4}" text-anchor="end" class="chart__axis">${esc(format(v))}</text>`;
  }
  const labels = points.map((p, i) => `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" class="chart__axis">${esc(p.label)}</text>`).join('');
  const dots = pts.map((p, i) => `<g class="chart__pt" tabindex="0"><circle cx="${p[0]}" cy="${p[1]}" r="14" fill="transparent"/><circle cx="${p[0]}" cy="${p[1]}" r="4" class="chart__dot"/>
    <g class="chart__tip" transform="translate(${Math.min(Math.max(p[0], L + 44), W - R - 44)} ${Math.max(p[1] - 40, 4)})"><rect x="-44" y="0" width="88" height="30" rx="6"/><text x="0" y="19" text-anchor="middle">${esc(format(points[i].value))}</text></g></g>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--chart-1)" stop-opacity=".22"/><stop offset="1" stop-color="var(--chart-1)" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path d="${area}" fill="url(#${id})"/><path d="${line}" class="chart__line"/>${labels}${dots}</svg>`;
}

export const PALETTE = ['#14532d', '#16834a', '#248653', '#3c9b66', '#67b982', '#9bd2ad'];

export function donut(items, { center = '', sub = '' } = {}) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const r = 70, C = 2 * Math.PI * r;
  let off = 0;
  const segs = items.map((it, i) => {
    const len = (it.value / total) * C;
    const s = `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="26" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 100 100)"><title>${esc(it.label)}: ${Math.round((it.value / total) * 100)}%</title></circle>`;
    off += len;
    return s;
  }).join('');
  const legend = items.map((it, i) => `<li><span class="dot" style="background:${PALETTE[i % PALETTE.length]}"></span><span>${esc(it.label)}</span><strong>${Math.round((it.value / total) * 100)}%</strong></li>`).join('');
  return `<div class="donut"><svg viewBox="0 0 200 200" role="img" aria-label="Allocation chart"><circle cx="100" cy="100" r="${r}" fill="none" stroke="var(--line)" stroke-width="26"/>${segs}
    <text x="100" y="98" text-anchor="middle" class="donut__value">${esc(center)}</text><text x="100" y="120" text-anchor="middle" class="donut__sub">${esc(sub)}</text></svg><ul class="legend">${legend}</ul></div>`;
}

export function bars(items, { height = 260, format = (v) => money(v, { compact: true }), secondary } = {}) {
  const W = 680, H = height, L = 56, R = 16, T = 16, B = 30;
  const max = niceMax(Math.max(...items.map((i) => i.value), 0) * 1.1);
  const bw = (W - L - R) / items.length;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  let grid = '';
  for (let k = 0; k <= 4; k++) {
    const v = (max * k) / 4;
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="chart__grid"/><text x="${L - 10}" y="${y(v) + 4}" text-anchor="end" class="chart__axis">${esc(format(v))}</text>`;
  }
  const b = items.map((it, i) => {
    const h = H - B - y(it.value);
    const cx = L + i * bw + bw / 2;
    return `<g class="chart__pt" tabindex="0"><rect x="${(cx - bw * 0.3).toFixed(1)}" y="${y(it.value).toFixed(1)}" width="${(bw * 0.6).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="3" class="chart__bar"/>
      <text x="${cx}" y="${H - 10}" text-anchor="middle" class="chart__axis">${esc(it.label)}</text>
      <g class="chart__tip" transform="translate(${Math.min(Math.max(cx, L + 60), W - R - 60)} ${Math.max(y(it.value) - 40, 2)})"><rect x="-60" y="0" width="120" height="30" rx="6"/><text x="0" y="19" text-anchor="middle">${esc(format(it.value))}${secondary ? ` · ${esc(secondary(it))}` : ''}</text></g></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart">${grid}${b}</svg>`;
}
