import * as THREE from 'three';
import { Geo, addTube } from './lev-mat.js';
import { Rng } from './util.js';

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Limbs are modelled straight along +z (root 0 .. tip len), chord along x with +x the leading
// edge. topY = +1 / -1 says which local y is the dorsal face, so left and right mirror properly.

// Closed lens-section blade from a planform: fn(u) -> { x0 (trailing), x1 (leading), t (half thickness) }
export function addBlade(g, len, fn, o) {
  const R = o.rings ?? 70, C = o.chord ?? 22, first = g.count, part = o.part ?? 0, topY = o.topY ?? 1;
  const row = 2 * C;
  for (let i = 0; i <= R; i++) {
    const u = i / R, F = fn(u), z = u * len;
    for (let side = 0; side < 2; side++) {
      for (let j = 0; j < C; j++) {
        const w = side === 0 ? j / C : 1 - j / C;      // 0 trailing .. 1 leading
        const x = F.x0 + (F.x1 - F.x0) * w;
        const prof = Math.pow(Math.sin(Math.PI * Math.min(1, w + 1e-3)), 0.55) * (0.65 + 0.35 * (1 - Math.abs(2 * w - 1.4)));
        const y = (side === 0 ? 1 : -1) * topY * F.t * prof;
        g.v(x, y + (F.y ?? 0), z, u, w, 0, part, x * 0.6, side === 0 ? (o.top ?? 0.2) : (o.under ?? 0.85));
      }
    }
  }
  for (let i = 0; i < R; i++) for (let j = 0; j < row; j++) {
    const a = first + i * row + j, b = first + i * row + (j + 1) % row;
    if (topY > 0) g.quad(a, b, b + row, a + row); else g.quad(a, a + row, b + row, b);
  }
}

// The monster's arm: a thick wing-like arm opening into a webbed hand with claws
export function buildHandFlipper(o) {
  const g = new Geo(), len = o.len, W = o.chord, topY = o.topY, r = new Rng(o.seed ?? 5);
  // arm + palm blade with tubercles along the leading edge
  addBlade(g, len * 0.62, (u) => {
    const wid = 0.55 + 0.55 * ss(0.1, 0.95, u);
    const tub = 1 + 0.07 * Math.sin(u * 44) * ss(0.1, 0.3, u);
    return { x0: -W * wid * (0.9 + 0.35 * ss(0.3, 1, u)), x1: W * wid * tub * 0.92, t: (W * 0.55) * (1 - 0.62 * ss(0, 1, u)) };
  }, { part: 0, topY, top: 0.24, under: 0.42, rings: 60, chord: 20 });
  // knuckle mass
  for (const k of [0.1, 0.23, 0.36, 0.49]) {
    addTube(g, [[W * 0.22, 0, len * k], [W * 0.28, 0, len * (k + 0.05)], [W * 0.3, 0, len * (k + 0.11)]], [W * 0.1, W * 0.2, W * 0.06], { seg: 8, flat: 1.1, belly: 0.24, part: 0 });
  }
  // fingers radiating from the wrist, each ending in a hooked claw
  const wrist = [W * 0.1, 0, len * 0.45];
  const tips = [[W * 1.15, len * 0.93], [W * 0.5, len * 1.05], [-W * 0.3, len * 1.03], [-W * 1.15, len * 0.9], [-W * 1.85, len * 0.68]];
  const fingers = tips.map(([tx, tz], fi) => {
    const pts = [], rad = [], N = 12;
    for (let i = 0; i <= N; i++) {
      const u = i / N, bow = Math.sin(u * Math.PI) * 0.1 * (fi - 2);
      pts.push([wrist[0] + (tx - wrist[0]) * u + bow * W, (u * u) * topY * -6, wrist[2] + (tz - wrist[2]) * u]);
      const kn = 1 + 0.2 * Math.max(0, Math.sin(u * Math.PI * 6 - 1));
      rad.push(W * (0.17 - 0.11 * u) * kn);
    }
    addTube(g, pts, rad, { seg: 9, flat: 0.75, belly: 0.26, part: 0, around: fi * 13 });
    // claw
    const a = pts[N], b = pts[N - 2];
    const dx = a[0] - b[0], dz = a[2] - b[2], dl = Math.hypot(dx, dz), clawL = W * 0.72;
    const cp = [], cr = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      cp.push([a[0] + (dx / dl) * clawL * u, a[1] + topY * (u * u) * clawL * 0.42, a[2] + (dz / dl) * clawL * u]);
      cr.push(Math.max(0.2, W * 0.095 * Math.pow(1 - u, 0.7)));
    }
    addTube(g, cp, cr, { seg: 8, part: 4, flat: 0.8, belly: 0.5 });
    return pts;
  });
  // web between the fingers, scalloped and torn; two skins so top and underside differ
  for (const [skin, off] of [[0.3, 1], [0.86, -1]]) {
    for (let fi = 0; fi < fingers.length - 1; fi++) {
      const A = fingers[fi], B = fingers[fi + 1], Nr = 12, Nc = 12, first = g.count;
      for (let i = 0; i <= Nr; i++) for (let j = 0; j <= Nc; j++) {
        const w = j / Nc, u = i / Nr;
        const sc = 0.76 + 0.2 * Math.abs(2 * w - 1) ** 2 + 0.03 * Math.sin(w * 31 + fi * 3);
        const v = u * sc * 12, i0 = Math.min(11, Math.floor(v)), f = v - i0;
        const ax = A[i0][0] + (A[i0 + 1][0] - A[i0][0]) * f, ay = A[i0][1] + (A[i0 + 1][1] - A[i0][1]) * f, az = A[i0][2] + (A[i0 + 1][2] - A[i0][2]) * f;
        const bx = B[i0][0] + (B[i0 + 1][0] - B[i0][0]) * f, by = B[i0][1] + (B[i0 + 1][1] - B[i0][1]) * f, bz = B[i0][2] + (B[i0 + 1][2] - B[i0][2]) * f;
        g.v(ax + (bx - ax) * w, ay + (by - ay) * w + off * topY * 0.9 - topY * 7 * Math.sin(w * Math.PI) * u, az + (bz - az) * w, u, (fi + w) / 4, 0, 6, ax * 0.5, skin);
      }
      const row = Nc + 1;
      for (let i = 0; i < Nr; i++) for (let j = 0; j < Nc; j++) {
        const a = first + i * row + j, b = a + 1, c = a + row, d = c + 1;
        g.quad(a, b, d, c);
      }
    }
  }
  void r;
  return g.build();
}

// A humpback flipper: long, knobbly, smooth (for whales)
export function addWhaleFlipper(g, len, W, topY, part = 8) {
  addBlade(g, len, (u) => {
    const tub = 1 + 0.1 * Math.sin(u * 30) * ss(0.25, 0.4, u);
    const w = W * (0.55 + 0.45 * ss(0, 0.28, u)) * Math.pow(1 - u, 0.42) ;
    return { x0: -w * 0.8, x1: w * tub, t: W * 0.34 * Math.pow(1 - u * 0.86, 0.9) };
  }, { part, topY, top: 0.15, under: 0.5, rings: 46, chord: 14 });
}

// Flukes: rest along z (0 trailing notch .. chord at the root), chained so they can flap
export function addFluke(g, span, chord, thick, o) {
  const C = 48, S = 40, part = o.part ?? 0, rough = o.rough ?? 0, first = g.count;
  const rng = new Rng(9);
  const jag = Array.from({ length: S + 2 }, () => rng.next());
  const lead = (u) => chord * (1 - 0.95 * Math.pow(u, 1.5));
  const trail = (u) => {
    const notch = 0.2 * chord * Math.exp(-u * u / 0.012);
    const belly = 0.1 * chord * Math.sin(u * Math.PI) ** 2;
    return chord * 0.05 * u + notch * 0 + chord * 0.13 * (1 - u) * 0.4 + belly + notch - rough * chord * 0.06 * (jag[Math.floor(u * S)] - 0.5) * Math.sin(u * Math.PI);
  };
  for (const skin of [1, -1]) for (const sd of [1, -1]) {
    const f0 = g.count;
    for (let i = 0; i <= S; i++) {
      const u = i / S, x = sd * u * span * (1 + 0.02 * Math.sin(u * 7));
      for (let j = 0; j <= C; j++) {
        const w = j / C, z = trail(u) + (lead(u) - trail(u)) * w;
        const prof = Math.pow(Math.sin(Math.PI * Math.min(1, w * 0.98 + 0.01)), 0.6);
        const t = thick * Math.pow(1 - u, 0.65) * prof + 0.4;
        const lift = -chord * 0.32 * u * u;  // tips droop a little
        g.v(x, skin * t + lift, z, u, w, 0, part, x, skin > 0 ? 0.22 : 0.86);
      }
    }
    const row = C + 1;
    for (let i = 0; i < S; i++) for (let j = 0; j < C; j++) {
      const a = f0 + i * row + j, b = a + 1, c = a + row, d = c + 1;
      if (skin * sd > 0) g.quad(a, b, d, c); else g.quad(a, c, d, b);
    }
  }
  void first;
}
