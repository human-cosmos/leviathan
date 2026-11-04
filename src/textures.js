import * as THREE from 'three';
import { Rng } from './util.js';

// Painted markings for Alphonse: hand-lettered names, panel lines, bolts,
// unit numbers, the visor glass. Everything is drawn like an animation
// colour-key sheet, then roughened so nothing looks typeset.

const INK = '#2a2236';
const SEAM_LIGHT = 'rgba(255,255,255,0.75)';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.premultiplyAlpha = false;
  t.anisotropy = 8;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  return t;
}

// ------------------------------------------------------------ brush lettering
// Glyph skeletons in a 1-tall box (y down). Each glyph: [advance, strokes].
const ell = (cx, cy, rx, ry, a0 = 0, a1 = Math.PI * 2, n = 22) =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
const GLYPHS = {
  A: [0.62, [[[0, 1], [0.31, 0], [0.62, 1]], [[0.13, 0.64], [0.49, 0.64]]]],
  L: [0.44, [[[0, 0], [0, 1], [0.44, 1]]]],
  P: [0.5, [[[0, 1], [0, 0], [0.3, 0], [0.45, 0.07], [0.5, 0.24], [0.45, 0.41], [0.3, 0.49], [0, 0.49]]]],
  H: [0.52, [[[0, 0], [0, 1]], [[0.52, 0], [0.52, 1]], [[0, 0.5], [0.52, 0.5]]]],
  O: [0.56, [ell(0.28, 0.5, 0.28, 0.5, -Math.PI / 2, Math.PI * 1.5, 28)]],
  N: [0.52, [[[0, 1], [0, 0], [0.52, 1], [0.52, 0]]]],
  S: [0.5, [[[0.48, 0.13], [0.36, 0.02], [0.16, 0.0], [0.03, 0.1], [0.04, 0.3], [0.24, 0.46], [0.44, 0.6], [0.5, 0.8], [0.4, 0.96], [0.18, 1.0], [0.0, 0.87]]]],
  E: [0.44, [[[0.44, 0], [0, 0], [0, 1], [0.44, 1]], [[0, 0.5], [0.36, 0.5]]]],
  V: [0.58, [[[0, 0], [0.29, 1], [0.58, 0]]]],
  I: [0.06, [[[0.03, 0], [0.03, 1]]]],
  G: [0.56, [ell(0.28, 0.5, 0.28, 0.5, -0.45, Math.PI * 1.62, 24).reverse().concat([[0.56, 0.58], [0.56, 0.58], [0.32, 0.58]])]],
  R: [0.52, [[[0, 1], [0, 0], [0.32, 0], [0.47, 0.08], [0.5, 0.24], [0.45, 0.4], [0.3, 0.48], [0, 0.48]], [[0.24, 0.48], [0.52, 1]]]],
  M: [0.66, [[[0, 1], [0, 0], [0.33, 0.66], [0.66, 0], [0.66, 1]]]],
  9: [0.5, [ell(0.25, 0.27, 0.25, 0.27, 0, Math.PI * 2, 22), [[0.5, 0.27], [0.49, 0.66], [0.36, 0.94], [0.16, 1.0], [0.02, 0.9]]]],
  8: [0.5, [ell(0.25, 0.24, 0.21, 0.24, Math.PI / 2, Math.PI * 2.5, 22), ell(0.25, 0.73, 0.25, 0.27, -Math.PI / 2, Math.PI * 1.5, 22)]],
  1: [0.3, [[[0.02, 0.18], [0.24, 0], [0.24, 1]]]],
  2: [0.5, [[[0.02, 0.22], [0.12, 0.05], [0.3, 0], [0.46, 0.1], [0.48, 0.3], [0.36, 0.52], [0, 1], [0.5, 1]]]],
  '-': [0.34, [[[0.04, 0.55], [0.3, 0.55]]]],
  ' ': [0.3, []],
};

function catmull(pts, steps = 6) {
  if (pts.length < 3) return pts;
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    // corners (repeated or sharp turns) stay sharp: only smooth gentle bends
    const sharp = Math.abs(Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) - Math.atan2(p1[1] - p0[1], p1[0] - p0[0])) > 1.1;
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      if (sharp && pts.length > 4) { out.push([p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]); continue; }
      out.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// One pen stroke: dense dabs whose width swells and tapers like a brush.
function brushStroke(g, pts, width, rng, color = INK) {
  const path = catmull(pts, 8);
  let total = 0;
  const seg = [];
  for (let i = 1; i < path.length; i++) { const d = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); seg.push(d); total += d; }
  g.fillStyle = color;
  const press = rng.range(0.9, 1.1);
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1], [x1, y1] = path[i];
    const n = Math.max(1, Math.ceil(seg[i - 1] / (width * 0.18)));
    for (let k = 0; k < n; k++) {
      const t = k / n, u = (acc + seg[i - 1] * t) / Math.max(total, 1e-6);
      const taper = Math.min(1, u / 0.08, (1 - u) / 0.1) * 0.35 + 0.65;
      const w = width * press * taper * (0.92 + 0.16 * Math.sin(u * 9 + press * 7));
      g.beginPath(); g.arc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, 0, Math.PI * 2); g.fill();
    }
    acc += seg[i - 1];
  }
}

// Hand-lettered word. h = cap height (px), slant = forward lean.
function letter(g, text, x, y, h, rng, { width = h * 0.085, slant = 0.1, track = 0.16, color = INK, squash = 1 } = {}) {
  let cx = x;
  for (const ch of text) {
    const [adv, strokes] = GLYPHS[ch] || GLYPHS[' '];
    const jx = rng.range(-0.01, 0.01) * h, jy = rng.range(-0.02, 0.02) * h, js = rng.range(0.97, 1.03);
    for (const s of strokes) {
      const pts = s.map(([px, py]) => {
        const X = cx + jx + px * h * squash * js + (1 - py) * h * slant + rng.range(-0.006, 0.006) * h;
        const Y = y + jy + py * h * js + rng.range(-0.006, 0.006) * h;
        return [X, Y];
      });
      brushStroke(g, pts, width, rng, color);
    }
    cx += (adv * squash + track) * h;
  }
  return cx - x;
}
function measure(text, h, { track = 0.16, squash = 1 } = {}) {
  let w = 0;
  for (const ch of text) w += ((GLYPHS[ch] || GLYPHS[' '])[0] * squash + track) * h;
  return w - track * h;
}

// Roughen: wobble the whole drawing with low-frequency noise and break the
// paint edge a little, like a painted marking on metal.
function handPaint(c, seed, amp = 1.6, erode = 0.18) {
  const g = c.getContext('2d');
  const { width: W, height: H } = c;
  const src = g.getImageData(0, 0, W, H), dst = g.createImageData(W, H);
  const rng = new Rng(seed);
  const ph = [rng.range(0, 6), rng.range(0, 6), rng.range(0, 6), rng.range(0, 6)];
  const n2 = (x, y) => Math.sin(x * 0.043 + ph[0]) * Math.cos(y * 0.051 + ph[1]) + 0.5 * Math.sin(x * 0.11 + y * 0.07 + ph[2]);
  const hash = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233 + ph[3]) * 43758.5453; return s - Math.floor(s); };
  const S = src.data, D = dst.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = Math.round(n2(x, y) * amp), dy = Math.round(n2(y + 37, x + 11) * amp);
      const sx = Math.min(W - 1, Math.max(0, x + dx)), sy = Math.min(H - 1, Math.max(0, y + dy));
      const si = (sy * W + sx) * 4, di = (y * W + x) * 4;
      D[di] = S[si]; D[di + 1] = S[si + 1]; D[di + 2] = S[si + 2];
      let a = S[si + 3];
      if (a > 0 && a < 255) a = a * (1 - erode * hash(x, y));
      else if (a === 255 && hash(x >> 1, y >> 1) < erode * 0.06) a = 120;
      D[di + 3] = a;
    }
  }
  g.putImageData(dst, 0, 0);
}

// ------------------------------------------------------------- panel detail
// Engraved seam: dark line with a thin catch-light beside it.
function seam(g, draw, w = 3.2) {
  g.save();
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.translate(1.6, 1.8); g.strokeStyle = SEAM_LIGHT; g.lineWidth = w * 0.7; g.beginPath(); draw(); g.stroke();
  g.restore();
  g.save();
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = INK; g.lineWidth = w; g.globalAlpha = 0.9; g.beginPath(); draw(); g.stroke();
  g.restore();
}
function roundRect(g, x, y, w, h, r) { g.roundRect(x, y, w, h, r); }
function bolt(g, x, y, r) {
  g.fillStyle = '#d9dae6'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#8f8fb4'; g.beginPath(); g.arc(x + r * 0.28, y + r * 0.28, r * 0.78, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c4c5d8'; g.beginPath(); g.arc(x - r * 0.1, y - r * 0.1, r * 0.6, 0, Math.PI * 2); g.fill();
  g.strokeStyle = INK; g.lineWidth = Math.max(1.6, r * 0.28); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(x - r * 0.45, y); g.lineTo(x + r * 0.45, y); g.stroke();
}
function holeCluster(g, cx, cy, r, gap, mirror = 1) {
  // like the reference: 2 + 1 + 2 round ports, dark inside with a lit rim
  const pos = [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]].map(([a, b]) => [cx + a * gap * mirror, cy + b * gap]);
  for (const [x, y] of pos) {
    g.fillStyle = '#c9cbe0'; g.beginPath(); g.arc(x, y, r * 1.18, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#2b2440'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4a4266'; g.beginPath(); g.arc(x - r * 0.25, y - r * 0.25, r * 0.55, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK; g.lineWidth = 3.5; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
  }
}
function smallLabel(g, text, x, y, size, rng, color = INK) {
  g.save();
  g.fillStyle = color; g.textBaseline = 'middle';
  g.font = `700 ${size}px "Yu Gothic", "Meiryo", "MS Gothic", sans-serif`;
  let cx = x;
  for (const ch of text) {
    const w = g.measureText(ch).width;
    g.save(); g.translate(cx + w / 2, y + rng.range(-1, 1)); g.rotate(rng.range(-0.04, 0.04)); g.fillText(ch, -w / 2, 0); g.restore();
    cx += w * 1.02;
  }
  g.restore();
}
// stencil numeral "1" with the red triangle, as on the reference shoulder
function unitOne(g, x, y, h, rng) {
  g.fillStyle = '#d6372f';
  g.beginPath(); g.moveTo(x, y + h * 0.42); g.lineTo(x + h * 0.26, y + h * 0.57); g.lineTo(x, y + h * 0.72); g.closePath(); g.fill();
  g.strokeStyle = INK; g.lineWidth = 4; g.stroke();
  const ox = x + h * 0.42;
  g.fillStyle = INK;
  g.beginPath();
  g.moveTo(ox + h * 0.02, y + h * 0.2); g.lineTo(ox + h * 0.3, y + h * 0.02); g.lineTo(ox + h * 0.42, y + h * 0.02);
  g.lineTo(ox + h * 0.4, y + h * 1.0); g.lineTo(ox + h * 0.2, y + h * 1.0); g.lineTo(ox + h * 0.21, y + h * 0.3); g.lineTo(ox + h * 0.05, y + h * 0.36);
  g.closePath(); g.fill();
  void rng;
}

// Extra glyphs for this robot's stencils
Object.assign(GLYPHS, {
  T: [0.5, [[[0, 0], [0.5, 0]], [[0.25, 0], [0.25, 1]]]],
  K: [0.5, [[[0, 0], [0, 1]], [[0.48, 0], [0, 0.56]], [[0.14, 0.42], [0.5, 1]]]],
  X: [0.52, [[[0, 0], [0.52, 1]], [[0.52, 0], [0, 1]]]],
  0: [0.5, [ell(0.25, 0.5, 0.25, 0.5, -Math.PI / 2, Math.PI * 1.5, 24)]],
  3: [0.48, [[[0.02, 0.1], [0.2, 0], [0.42, 0.08], [0.44, 0.28], [0.22, 0.46], [0.46, 0.62], [0.46, 0.86], [0.24, 1], [0, 0.9]]]],
  4: [0.5, [[[0.36, 1], [0.36, 0], [0, 0.68], [0.5, 0.68]]]],
  5: [0.48, [[[0.44, 0], [0.06, 0], [0.03, 0.44], [0.28, 0.38], [0.46, 0.54], [0.44, 0.84], [0.24, 1], [0, 0.92]]]],
  7: [0.46, [[[0, 0], [0.46, 0], [0.16, 1]]]],
});

// ---------------------------------------------------------- the detail atlas
// One repeating sheet of animation-colour-key panel work: recursive panel seams,
// tonal blocks, inset hatches, vents, bolts, hand stencils, hazard ticks. Applied
// along every armour plate, so surfaces read as dense at any distance.
export function makePanelAtlas(size = 2048) {
  const rng = new Rng(4242);
  const [c, g] = canvas(size, size);
  const S = size / 2048;
  const WORDS = ['MK-IX', 'A-07', 'R-12', 'S-40', 'L-33', 'NO-5', 'TK-1', 'V-08', 'H-21', 'ARROW', 'E-70', 'P-14'];
  const leaves = [];
  const split = (x, y, w, h, d) => {
    const canSplit = d < 6 && (w > 110 * S || h > 110 * S);
    if (canSplit && (d < 2 || rng.next() < 0.86)) {
      if (w > h * rng.range(0.8, 1.25)) { const k = rng.range(0.32, 0.68) * w; split(x, y, k, h, d + 1); split(x + k, y, w - k, h, d + 1); }
      else { const k = rng.range(0.32, 0.68) * h; split(x, y, w, k, d + 1); split(x, y + k, w, h - k, d + 1); }
    } else leaves.push([x, y, w, h, d]);
  };
  split(0, 0, size, size, 0);

  // tonal blocks first: neighbouring panels are never quite the same metal
  for (const [x, y, w, h] of leaves) {
    const r = rng.next();
    if (r < 0.26) { g.fillStyle = `rgba(52,58,92,${rng.range(0.1, 0.22)})`; g.fillRect(x, y, w, h); }
    else if (r < 0.48) { g.fillStyle = `rgba(255,255,255,${rng.range(0.1, 0.24)})`; g.fillRect(x, y, w, h); }
    else if (r < 0.54) { g.fillStyle = `rgba(160,120,92,${rng.range(0.1, 0.18)})`; g.fillRect(x, y, w, h); }
  }
  // seams
  for (const [x, y, w, h, d] of leaves) {
    const lw = (d < 3 ? 4.2 : 2.8) * S;
    seam(g, () => { g.rect(x, y, w, h); }, lw);
  }
  // furniture inside each panel
  for (const [x, y, w, h] of leaves) {
    const m = 11 * S;
    const r = rng.next();
    const iw = w - m * 2, ih = h - m * 2;
    if (iw < 24 * S || ih < 24 * S) continue;
    if (r < 0.34) {
      const br = rng.range(4.5, 7.5) * S;
      const b = (bx, by) => bolt(g, bx, by, br);
      b(x + m, y + m); b(x + w - m, y + m); b(x + m, y + h - m); b(x + w - m, y + h - m);
      if (w > 190 * S) { b(x + w / 2, y + m); b(x + w / 2, y + h - m); }
      if (h > 190 * S) { b(x + m, y + h / 2); b(x + w - m, y + h / 2); }
    } else if (r < 0.5 && iw > 70 * S && ih > 50 * S) {
      // inset hatch with a darker well
      const ins = rng.range(14, 30) * S;
      g.fillStyle = 'rgba(40,44,74,0.34)';
      g.beginPath(); roundRect(g, x + ins, y + ins, w - ins * 2, h - ins * 2, 8 * S); g.fill();
      seam(g, () => { roundRect(g, x + ins, y + ins, w - ins * 2, h - ins * 2, 8 * S); }, 2.6 * S);
      if (rng.next() < 0.6) { g.fillStyle = '#d9dae6'; g.fillRect(x + w / 2 - 16 * S, y + ins + 7 * S, 32 * S, 6 * S); }
    } else if (r < 0.64 && iw > 60 * S) {
      // louvre vent
      const n = rng.int(3, 7), vw = Math.min(iw * 0.7, 120 * S), vh = 7 * S, gap = 15 * S;
      const vy = y + h / 2 - (n * gap) / 2;
      for (let i = 0; i < n && gap * i < ih - 10 * S; i++) {
        g.fillStyle = '#23263c'; g.fillRect(x + w / 2 - vw / 2, vy + i * gap, vw, vh);
        g.fillStyle = 'rgba(255,255,255,0.65)'; g.fillRect(x + w / 2 - vw / 2, vy + i * gap + vh, vw, 2 * S);
      }
    } else if (r < 0.8 && iw > 90 * S) {
      // stencil
      const word = rng.pick(WORDS);
      const hh = rng.range(16, 28) * S;
      letter(g, word, x + m + 4 * S, y + m + 2 * S, hh, rng, { width: hh * 0.13, color: INK, slant: 0.02, track: 0.2 });
      if (rng.next() < 0.5) { g.fillStyle = 'rgba(42,34,54,0.8)'; g.fillRect(x + m + 4 * S, y + m + hh + 8 * S, rng.range(30, 80) * S, 3 * S); }
    } else if (r < 0.87 && iw > 90 * S) {
      // hazard ticks, sparing colour
      const col = rng.next() < 0.55 ? '#d8402f' : '#e9b23c';
      const n = rng.int(3, 7), tw = 13 * S, th = 22 * S, sx = x + m + 2 * S, sy = y + h - m - th;
      g.fillStyle = col;
      for (let i = 0; i < n; i++) { g.beginPath(); g.moveTo(sx + i * tw * 1.6, sy + th); g.lineTo(sx + i * tw * 1.6 + tw, sy + th); g.lineTo(sx + i * tw * 1.6 + tw * 1.7, sy); g.lineTo(sx + i * tw * 1.6 + tw * 0.7, sy); g.closePath(); g.fill(); }
    } else if (r < 0.93) {
      // pair of round access ports
      holeCluster(g, x + w / 2, y + h / 2, 7 * S, 15 * S, 1);
    }
  }
  // long structural seams that run across panels, like plate welds
  for (let i = 0; i < 16; i++) {
    const x = rng.range(0, size), y = rng.range(0, size), len = rng.range(160, 620) * S;
    seam(g, () => { if (i % 2) { g.moveTo(x, y); g.lineTo(x + len, y); } else { g.moveTo(x, y); g.lineTo(x, y + len); } }, 2 * S);
  }
  // rivet rows
  for (let i = 0; i < 26; i++) {
    const x = rng.range(0, size), y = rng.range(0, size), n = rng.int(6, 16), st = rng.range(18, 30) * S, dirX = rng.next() < 0.5;
    for (let k = 0; k < n; k++) bolt(g, x + (dirX ? k * st : 0), y + (dirX ? 0 : k * st), 3.8 * S);
  }
  // tiny chips, specks and scratches
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rng.next() < 0.6 ? 'rgba(40,36,60,0.55)' : 'rgba(255,255,255,0.55)';
    const s = rng.range(1, 3.2) * S; g.fillRect(rng.range(0, size), rng.range(0, size), s, s * rng.range(0.6, 1.6));
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;
  void unitOne; void smallLabel; void measure; void handPaint;
  return t;
}
