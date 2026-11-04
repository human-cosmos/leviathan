import { Rng } from './util.js';

// Towering summer cumulus, in sky degrees (az, el): rows of billows, cauliflower buds
// on the rims and a flat lavender base. The sky shader shades the union.
function cloudTower(rng, o) {
  const puffs = [];
  const R0 = o.r ?? 3.4;
  const rows = Math.max(1, Math.round(o.h / (R0 * 0.9)));
  const prof = o.prof ?? ((f) => 1 - 0.42 * f * f);
  for (let k = 0; k <= rows; k++) {
    const f = rows ? k / rows : 0;
    const y = o.base + R0 * 0.55 + f * (o.h - R0 * 1.35);
    const width = Math.max(R0 * 0.6, o.w * prof(f));
    const n = Math.max(1, Math.round(width / (R0 * 1.12)));
    for (let i = 0; i < n; i++) {
      const uu = n === 1 ? 0 : i / (n - 1) - 0.5;
      const x = o.az + (o.lean ?? 0) * f * o.h + uu * (width - R0) + rng.range(-0.3, 0.3) * R0;
      const r = R0 * rng.range(0.8, 1.15) * (1 - 0.2 * f);
      const z = (1 - f) * R0 * 1.6 + (0.5 - Math.abs(uu)) * R0 * 1.3 + rng.range(0, 0.5) * R0;
      puffs.push([x, y + rng.range(-0.3, 0.3) * R0, r, z]);
    }
  }
  const body = puffs.length;
  for (let i = 0; i < body * 1.6 && puffs.length < 96; i++) {
    const [x, y, r, z] = puffs[i % body];
    if (y < o.base + o.h * 0.25 || rng.next() < 0.35) continue;
    const a = rng.range(0.25, Math.PI - 0.25);
    puffs.push([x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.8, r * rng.range(0.32, 0.5), z + r * 0.35]);
  }
  const topY = o.base + o.h - R0 * 0.7;
  const topW = Math.max(R0, o.w * prof(1));
  const nc = Math.max(2, Math.round(topW / (R0 * 0.7)));
  for (let i = 0; i < nc; i++) {
    const uu = i / (nc - 1) - 0.5;
    puffs.push([o.az + (o.lean ?? 0) * o.h + uu * topW * 0.85, topY - Math.abs(uu) * R0 * 1.1 + rng.range(-0.2, 0.3) * R0, R0 * rng.range(0.5, 0.72), rng.range(-0.3, 0.2) * R0]);
  }
  return { puffs: puffs.slice(0, 110), cut: o.cut ?? o.base + R0 * 0.3, haze: o.haze ?? 0 };
}

export function makeClouds() {
  const rng = new Rng(7310);
  const T = [];
  const add = (o) => T.push(cloudTower(rng, o));
  // a great wall of nyudo-gumo all round the horizon: every view of the sea has a castle in it
  add({ az: -66, base: -3, w: 30, h: 36, r: 2.9, lean: 0.06 });
  add({ az: 34, base: -3, w: 32, h: 40, r: 3.0, lean: -0.05 });
  add({ az: -24, base: -1.5, w: 14, h: 13, r: 2.5 });
  add({ az: 4, base: -0.5, w: 10, h: 8, r: 1.9 });
  add({ az: -44, base: -0.5, w: 10, h: 8, r: 2 });
  add({ az: 64, base: -2, w: 16, h: 16, r: 2.2 });
  add({ az: 112, base: -3, w: 28, h: 31, r: 2.8, lean: 0.04 });
  add({ az: 186, base: -3, w: 26, h: 28, r: 2.7, lean: -0.04 });
  add({ az: 146, base: -1.5, w: 18, h: 15, r: 2.8, lean: 0.03 });
  add({ az: 164, base: 2.5, w: 7, h: 5, r: 1.4 });
  add({ az: 131, base: 1.5, w: 8, h: 6, r: 1.6 });
  add({ az: 84, base: -2, w: 20, h: 22, r: 2.6 });
  add({ az: 232, base: -2, w: 30, h: 31, r: 2.9 });
  add({ az: 282, base: -2, w: 26, h: 25, r: 2.7 });
  add({ az: -104, base: -2, w: 24, h: 22, r: 2.6 });
  // fair-weather cumulus higher up
  for (const [az, el, w] of [[-50, 14, 5], [-8, 18, 6], [18, 13, 4], [-30, 27, 5], [140, 14, 5], [158, 17, 4], [118, 19, 5], [176, 13, 4], [70, 16, 6], [205, 15, 5], [-90, 15, 6], [250, 17, 5]]) {
    add({ az, base: el, w, h: w * 0.55, r: w * 0.24, cut: el + w * 0.06 });
  }
  return { towers: T };
}
