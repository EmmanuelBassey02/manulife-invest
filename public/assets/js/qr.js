/**
 * Minimal QR Code encoder: byte mode, error correction level M, versions 1–6
 * (up to 106 bytes — ample for wallet addresses and payment URIs).
 */
const EC_M = { 1: [10, 1, 16], 2: [16, 1, 28], 3: [26, 1, 44], 4: [18, 2, 32], 5: [24, 2, 43], 6: [16, 4, 27] }; // [ec/block, blocks, data/block]

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

function rsRemainder(data, divisor) {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ r.shift();
    r.push(0);
    divisor.forEach((c, i) => { r[i] ^= gfMul(c, factor); });
  }
  return r;
}

export function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 0;
  for (let v = 1; v <= 6; v++) {
    const [, blocks, dpb] = EC_M[v];
    if (4 + 8 + bytes.length * 8 <= blocks * dpb * 8) { ver = v; break; }
  }
  if (!ver) throw new Error('Text too long for QR');
  const [ecLen, blocks, dpb] = EC_M[ver];
  const capacity = blocks * dpb * 8;

  // Bit stream
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, 8);
  bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  // Blocks + EC, interleaved
  const div = rsDivisor(ecLen);
  const dBlocks = [];
  const eBlocks = [];
  for (let b = 0; b < blocks; b++) {
    const d = data.slice(b * dpb, (b + 1) * dpb);
    dBlocks.push(d);
    eBlocks.push(rsRemainder(d, div));
  }
  const final = [];
  for (let i = 0; i < dpb; i++) dBlocks.forEach((d) => final.push(d[i]));
  for (let i = 0; i < ecLen; i++) eBlocks.forEach((e) => final.push(e[i]));

  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };

  // Timing
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  // Finders + separators
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx; const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  // Alignment
  if (ver >= 2) {
    const p = size - 7;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(p + dx, p + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // Format info (reserve now, fill after masking)
  const mask = 0;
  const fmtData = (0b00 << 3) | mask; // level M = 00
  let rem = fmtData;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const fbits = ((fmtData << 10) | rem) ^ 0x5412;
  const bit = (i) => ((fbits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);

  // Data placement (zig-zag)
  const dataBits = [];
  final.forEach((b) => { for (let i = 7; i >= 0; i--) dataBits.push((b >>> i) & 1); });
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x]) {
          m[y][x] = k < dataBits.length ? dataBits[k] === 1 : false;
          k++;
          if ((x + y) % 2 === 0) m[y][x] = !m[y][x]; // mask 0
        }
      }
    }
  }
  return m;
}

export function qrSvg(text, { size = 168, dark = '#0d1b2a', light = '#ffffff' } = {}) {
  const m = qrMatrix(text);
  const n = m.length;
  const q = 4; // quiet zone
  let path = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) path += `M${x + q} ${y + q}h1v1h-1z`;
  return `<svg class="qr" width="${size}" height="${size}" viewBox="0 0 ${n + q * 2} ${n + q * 2}" shape-rendering="crispEdges" role="img" aria-label="QR code for the wallet address"><rect width="100%" height="100%" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
