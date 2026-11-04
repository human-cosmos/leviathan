// Sound department — the effects and ambience timeline for LEVIATHAN, keyed to CUES and
// SHOTS. Perspective changes on the cut. Pans follow the frame (see CONTRACT shot table).
import { Rng, clamp, smooth, invLerp } from './util.js';
import { SR, TAU, Drift, pws, mtof, nm } from './audio-dsp.js';
import { SHOTS, shotAt, DURATION } from './shots.js';
import { K, tex, tone, grains, impact, put1, putGr, sonicBoom, thunder, crackle, arc, friction, HULL, BOWWOOD, STEEL, clang, splash, boil, whale, roar, horn } from './audio-sfxlib.js';

const D = DURATION;
// control curve at 1 kHz with optional smoothing
function ctl(fn, sm = 0) {
  const rate = 1000, n = Math.ceil(D * rate) + 2, a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = fn(i / rate);
  if (sm > 0) { const k = 1 - Math.exp(-1 / (sm * rate)); let y = a[0]; for (let i = 0; i < n; i++) { y += (a[i] - y) * k; a[i] = y; } }
  return (t) => { const x = t * rate; if (x <= 0) return a[0]; const i = Math.floor(x); if (i >= n - 1) return a[n - 1]; return a[i] + (a[i + 1] - a[i]) * (x - i); };
}
const shotOf = (t) => SHOTS[shotAt(t)];
// per-shot gain table by shot id, with a 40 ms blend across the cut; default by set
const byShot = (table, sets = {}, def = 0) => ctl((t) => { const s = shotOf(t); return table[s.id] ?? sets[s.set] ?? def; }, 0.04);

// The recurring whale phrase: a slow rise, a hanging fall, then a lonely upward cry.
// Written in semitones around `base` so it can be sung high, low, hurt or dying.
export function whalePhrase(base = 233, stretch = 1, drop = 0) {
  const st = (n) => base * Math.pow(2, n / 12);
  const c = [[0, st(0)], [0.55, st(5)], [1.2, st(12)], [1.65, st(10)], [2.2, st(3)], [2.9, st(-2 - drop)], [3.15, st(-2 - drop)], [3.7, st(14 - drop)], [4.5, st(9 - drop * 2)]].map(([t, f]) => [t * stretch, f]);
  const g = [[0, 0], [0.3, 0.75], [1.1, 1], [1.7, 0.75], [2.7, 0.55], [3.0, 0.04], [3.2, 0.1], [3.65, 1], [4.2, 0.6], [4.5, 0]].map(([t, v]) => [t * stretch, v]);
  return [c, g];
}

export function buildSfx(C, G) {
  const report = [], ducks = [], cue = (t, l) => report.push([+t.toFixed(3), l]), duck = (a, b, d) => ducks.push([a, b, d]);
  let seed = 5000; const S = () => ++seed;
  const { amb, key, under, uhi } = G;
  const r = C.release, im = C.impact, pq = C.pierce;

  // ===================================================== BEDS (level follows the camera)
  const gust = new Drift(11, 0.45), gust2 = new Drift(12, 1.1), swell = new Drift(13, 0.22);
  const windG = byShot({ s01: 0.9, s02: 0.9, s03: 2, s04: 0.9, s05: 1.3, s06: 0.8, s07: 2.2, s08: 1.3, s09: 1.8, s10: 0.34, s11: 1, s12: 0, s13: 0, s14: 0.8, s15: 0.55, s16: 1.2, s25: 1.1, s26: 0, s28: 0.5, s30: 0.5 }, { ocean: 0.5, under: 0, bridge: 0.06, orbit: 0 }, 0.5);
  const windK = ctl((t) => 1 + 0.9 * smooth(invLerp(C.chargeStart + 2.4, C.chargeFull, t)) * (t < r ? 1 : 0), 0.1);
  tex(amb, { t0: 0, t1: D, seed: S(), color: 'p', mode: 'bp', q: 0.55, f: (t) => 640 + 280 * gust.at(t), g: (t) => 0.3 * windG(t) * windK(t) * (0.75 + 0.3 * gust.at(t + 3)), width: 0.9, send: 0.08 });
  tex(amb, { t0: 0, t1: D, seed: S(), color: 'w', mode: 'bp', q: 3, f: (t) => 2300 + 900 * gust2.at(t), g: (t) => 0.018 * windG(t) * windK(t) * Math.max(0, 0.4 + gust2.at(t + 9)), width: 1, send: 0.1 });
  const seaG = byShot({ s03: 2.1, s05: 2.2, s07: 2, s09: 1.6, s11: 0.1, s14: 0.35, s16: 0.9, s28: 0, s25: 0.05, s26: 0, s30: 0.65 }, { coast: 0.5, deck: 0.8, ocean: 0.8, bridge: 0.12, under: 0, orbit: 0, sky: 0.08 }, 0.5);
  tex(amb, { t0: 0, t1: D, seed: S(), color: 'p', mode: 'lp', f: (t) => 520 + 420 * swell.at(t), g: (t) => 0.56 * seaG(t) * (0.8 + 0.35 * swell.at(t + 5)), width: 0.9, send: 0.1 });
  tex(amb, { t0: 0, t1: D, seed: S(), color: 'w', mode: 'hp', f: 3400, g: (t) => 0.024 * seaG(t) * (0.8 + 0.5 * swell.at(t + 1.3)), width: 1, send: 0.1 });
  // surf breaking on the headland
  [[1.72, 0.9, -0.5], [4.5, 1.1, 0.25], [7.3, 0.5, -0.3], [9.4, 1.2, -0.4], [11.6, 1, 0.3]].forEach(([t, v, p]) => tex(amb, { t0: t, t1: t + 2.3, seed: S(), color: 'w', mode: 'bp', q: 0.5, f: K([[t, 500], [t + 0.5, 1800], [t + 2.3, 900]]), g: K([[t, 0], [t + 0.4, 0.5 * v], [t + 2.3, 0]]), pan: () => p, send: 0.2 }));
  // underwater: pressure, a far churn above, air
  const uG = byShot({ s17: 1, s27: 0.55, s29: 0.8, s31: 0.5, s32: 0.5, s33: 0.8, s34: 0.6, s35: 0.4, s36: 0.4, s37: 0.7 }, {}, 0);
  tex(under, { t0: 0, t1: D, seed: S(), color: 'b', mode: 'lp', f: 170, g: (t) => 0.9 * uG(t), width: 0.6, send: 0.2 });
  tex(under, { t0: 0, t1: D, seed: S(), color: 'p', mode: 'bp', q: 0.8, f: (t) => 430 + 120 * swell.at(t), g: (t) => 0.17 * uG(t), width: 0.9, send: 0.4 });
  boil(under, 28.4, 31.1, (t) => 26, { seed: S(), lo: 220, hi: 1300, gain: 0.32, send: 0.6 });
  boil(under, 54, 57.73, (t) => 13, { seed: S(), lo: 160, hi: 800, gain: 0.32, send: 0.6 });
  boil(under, 62.9, 74.73, (t) => 18, { seed: S(), lo: 200, hi: 1100, gain: 0.3, send: 0.5 });

  // a reef's worth of tiny clicks: the high end of real water, so under is never dead air
  [[28.4, 31.1, 1], [54, 57.5, 0.8], [59.57, 60.2, 0.5], [66.83, 68.17, 0.8], [72.3, 74.73, 0.6]].forEach(([a, b, v]) => crackle(uhi, a, b, (t) => 46 * v * Math.min(1, (t - a) / 0.2, (b - t) / 0.2) + 0.5, { seed: S(), gain: 0.05 * v, lo: 2400, hi: 7600, send: 0 }));

  // ===================================================== I. THE DRAW
  // steel fingers closing on the grip; bow limb loading
  const bow = (t, d, o) => put1(key, t, friction(d, { modes: BOWWOOD, rate: o.rate, env: o.env, gain: o.gain ?? 0.34, drive: 1.2 }, S()), { pan: o.pan ?? 0, send: 0.3 });
  bow(0.02, 0.62, { rate: (u) => 14 + 30 * u, env: (u) => Math.sin(Math.PI * u), pan: 0.18 });
  bow(0.72, 0.76, { rate: (u) => 10 + 8 * Math.sin(u * 9), env: (u) => Math.sin(Math.PI * u) * 1.1, pan: -0.28, gain: 0.4 });
  bow(C.drawHold + 0.1, 1.0, { rate: (u) => 7 + 22 * u, env: (u) => 0.4 * Math.sin(Math.PI * u), pan: 0.3 });
  bow(2.6, 1.77, { rate: (u) => 8 + 42 * u * u, env: (u) => Math.pow(Math.sin(Math.PI * u), 0.6) * 1.2, pan: -0.22, gain: 0.46 });
  // string tension: the cable sings a little higher as it loads
  const tens = (t0, t1, f0, f1, g, p, sd) => tone(key, { t0, t1, seed: sd, h: [1, 0.5, 0.26, 0.18, 0.1, 0.06], f: (t) => f0 * Math.pow(f1 / f0, smooth(invLerp(t0, t1, t))), g: K([[t0, 0], [t0 + 0.2, g * 0.4], [t1 - 0.2, g], [t1, 0]]), pan: () => p, jit: 0.006, send: 0.4 });
  tens(0.67, 1.47, 311, 349, 0.018, -0.25, S()); tens(2.6, 4.37, 349, 466, 0.03, -0.2, S()); tens(5.8, r, 466, 554, 0.018, -0.2, S());
  // servos in the draw arm
  [[2.68, 0.9, 0.22], [3.7, 0.6, -0.1], [5.9, 0.6, 0.2]].forEach(([t, d, p]) => tone(key, { t0: t, t1: t + d, seed: S(), h: [1, 0.5, 0.3, 0.2, 0.12], f: K([[t, 240], [t + d * 0.3, 410], [t + d, 300]]), g: K([[t, 0], [t + 0.05, 0.02], [t + d * 0.8, 0.014], [t + d, 0]]), pan: () => p, send: 0.2 }));
  // the foot: 110 m of steel settling into surf
  const ft = 4.42;
  impact(key, ft, { size: 0.72, f0: 80, f1: 34, body: 240, crack: 900, crackT: 0.04, seed: S(), pan: 0.1 }); put1(key, ft, friction(1.3, { modes: HULL(1.2), rate: (u) => 18 - 10 * u, env: (u) => Math.exp(-u * 2.4), gain: 0.5, drive: 1.3 }, S()), { pan: 0.1, send: 0.3 });
  splash(key, ft + 0.05, { size: 0.5, seed: S(), pan: 0.15, gain: 0.8 });
  { const g = grains(ft, ft + 1.3, (t) => 34 * Math.exp(-(t - ft) * 1.4) + 2, (s, at, q, t, p, pg) => { const n = Math.ceil(q.range(0.004, 0.02) * SR); const f = q.range(1300, 4800); for (let i = 0; i < n && at + i < s.length; i++) s[at + i] += Math.sin(TAU * f * i / SR) * Math.exp(-i / (n * 0.25)) * q.range(0.04, 0.16) * pg; }, S(), 0.1); putGr(key, g, { gain: 1, send: 0.3 }); }

  // ---- charge: a rising whine, an electrical hum that thickens, static on every edge
  const cs = C.chargeStart, cf = C.chargeFull;
  const whine = (t) => 330 * Math.pow(23, Math.pow(invLerp(cs, r - 0.02, t), 1.2));
  const whG = K([[cs, 0], [cs + 1.2, 0.04], [cf, 0.06], [r - 0.08, 0.075], [r - 0.012, 0.075], [r, 0]]);
  tone(key, { t0: cs, t1: r, seed: S(), h: [1, 0.3, 0.42, 0.1, 0.16], f: whine, g: whG, pan: (t) => 0.2 * Math.sin(t * 2.1), jit: 0.004, send: 0.4 });
  tone(key, { t0: cs, t1: r, seed: S(), h: [1, 0.2, 0.1], f: (t) => whine(t) * 1.007, g: (t) => whG(t) * 0.7, pan: (t) => -0.2 * Math.sin(t * 2.1), jit: 0.004, send: 0.4 });
  tone(key, { t0: cs, t1: r, seed: S(), h: [1, 0.85, 0.7, 0.55, 0.42, 0.36, 0.28, 0.2, 0.16, 0.12], f: () => 98, g: K([[cs, 0], [cs + 2, 0.022], [cf, 0.036], [r - 0.012, 0.05], [r, 0]]), send: 0.15 });
  crackle(key, cs + 0.4, r, (t) => 3 + 90 * Math.pow(invLerp(cs, r, t), 2.2), { seed: S(), gain: 0.42 });
  // plates locking along the arm as the light passes, the chest taking the load
  [[6.5, 720, -0.2], [7.3, 610, -0.08], [8.05, 540, 0.04], [8.7, 430, 0.14]].forEach(([t, f, p]) => clang(key, t, { f, ring: 0.8, gain: 0.6, pan: p, seed: S(), send: 0.5 }));
  [[C.chargeFull - 2.1, 0.6], [C.chargeFull - 1, 0.5]].forEach(([t]) => arc(key, t, { dur: 0.35, gain: 0.2, pan: -0.25, seed: S(), f: 137 }));
  arc(key, cf, { dur: 0.8, gain: 0.3, seed: S(), f: 98 });
  // ---- RELEASE: the string, the crack, the thrum of the limbs, the air tearing
  const snap = new Rng(77);
  impact(key, r, { size: 1, f0: 170, f1: 36, body: 520, crack: 1700, crackT: 0.02, seed: S(), gain: 1, send: 0.45 });
  clang(key, r, { f: 96, ring: 1.6, gain: 1, seed: S(), pan: -0.15 }); clang(key, r + 0.004, { f: 233, ring: 1.1, gain: 0.5, seed: S(), pan: 0.15 });
  tone(key, { t0: r, t1: r + 1.5, seed: S(), h: [1, 0.5, 0.3, 0.2], f: (t) => 62 + 26 * Math.exp(-(t - r) / 0.11), g: (t) => 0.13 * Math.exp(-(t - r) / 0.5) * (1 + 0.7 * Math.sin(TAU * 11 * (t - r))), send: 0.3 });
  sonicBoom(key, r + 0.09, { size: 1, gain: 1.9, seed: S(), pan: 0.1 }); duck(r, r + 0.34, -3);
  tex(key, { t0: r, t1: r + 1.4, seed: S(), color: 'w', mode: 'bp', q: 0.6, f: K([[r, 4800], [r + 0.5, 1200], [r + 1.4, 400]]), g: K([[r, 0.5], [r + 0.5, 0.3], [r + 1.4, 0]]), pan: K([[r, -0.2], [r + 1.2, 0.8]]), width: 0.5, send: 0.4 });
  tex(key, { t0: r + 0.1, t1: r + 2.5, seed: S(), color: 'b', mode: 'lp', f: 300, g: K([[r + 0.1, 0], [r + 0.3, 0.95], [r + 2.5, 0]]), send: 0.2 });
  // the shockwave flattens the sea in a ring
  tex(key, { t0: r + 0.15, t1: 14.53, seed: S(), color: 'w', mode: 'hp', f: 1800, g: K([[r + 0.15, 0], [r + 0.3, 0.09], [14.53, 0.02]]), width: 1, send: 0.3 });
  cue(r, 'release: string crack, sonic boom');

  // ===================================================== II. SKY
  const w = C.cloudSplit + 0.6;    // the whoosh lands out of the gap
  // on deck, lashings tick in a sudden wrong stillness; a building pressure
  { const g = grains(14.53, w, () => 7, (s, at, q, t, p, pg) => { const n = Math.ceil(0.03 * SR), f = q.range(1400, 4200); for (let i = 0; i < n && at + i < s.length; i++) s[at + i] += Math.sin(TAU * f * i / SR) * Math.exp(-i / 200) * 0.09 * pg; }, S(), 0.1); putGr(amb, g, { send: 0.4 }); }
  tex(key, { t0: C.cloudSplit - 0.15, t1: w, seed: S(), color: 'p', mode: 'bp', q: 0.9, f: K([[C.cloudSplit - 0.15, 300], [w, 4000]]), g: K([[C.cloudSplit - 0.15, 0], [w - 0.02, 0.5], [w, 0.5]]), pan: K([[14.8, 0.6], [w, 0]]), send: 0.4 });
  // sky tear: a long rip that opens the clouds
  impact(key, w, { size: 1.05, f0: 150, f1: 34, body: 500, crack: 1300, crackT: 0.05, seed: S(), send: 0.5 });
  tex(key, { t0: w, t1: w + 2.6, seed: S(), color: 'w', mode: 'bp', q: 0.45, f: K([[w, 6500], [w + 0.5, 3000], [w + 1.4, 1000], [w + 2.6, 380]]), g: K([[w, 1.3], [w + 0.4, 0.85], [w + 1.5, 0.4], [w + 2.6, 0]]), pan: K([[w, -0.3], [w + 1.5, 0.5], [w + 2.6, 0.2]]), width: 0.7, send: 0.5 });
  tex(key, { t0: w, t1: w + 3.2, seed: S(), color: 'b', mode: 'lp', f: K([[w, 900], [w + 3.2, 180]]), g: K([[w, 1.3], [w + 3.2, 0]]), width: 0.5, send: 0.3 });
  crackle(key, w, w + 1.6, (t) => 80 * Math.exp(-(t - w) * 2.5) + 3, { seed: S(), gain: 0.34, lo: 900, hi: 4200 });
  thunder(key, w + 0.45, { dur: 3.2, gain: 1.1, pan: 0.25, seed: S() });
  cue(w, 'sky tear');
  // climb: the arrow's own shriek, thinning as the air runs out
  const s11 = 16.8, s12 = 19.9;
  tex(key, { t0: s11 - 0.1, t1: s12, seed: S(), color: 'w', mode: 'bp', q: 1, f: K([[s11, 1300], [s12, 5400]]), g: K([[s11 - 0.1, 0], [s11 + 0.12, 0.95], [s12 - 1, 0.42], [s12, 0.03]]), pan: (t) => 0.22 * Math.sin(t * 3), send: 0.25 });
  tone(key, { t0: s11, t1: s12, seed: S(), h: [1, 0.4, 0.2], f: K([[s11, 620], [s12, 2300]]), g: K([[s11, 0], [s11 + 0.3, 0.035], [s12 - 0.7, 0.015], [s12, 0]]), jit: 0.02, send: 0.3 });
  [[s11 + 0.25, -0.7, 0.8], [s11 + 1.2, 0.7, 0.55]].forEach(([t, p, v]) => tex(key, { t0: t, t1: t + 1, seed: S(), color: 'w', mode: 'bp', q: 0.8, f: K([[t, 800], [t + 0.25, 2600], [t + 1, 500]]), g: K([[t, 0], [t + 0.26, 0.3 * v], [t + 1, 0]]), pan: K([[t, p], [t + 1, -p]]), send: 0.25 }));
  // orbit: silence, a suit-radio hush, the glint; then the flash arrives as a pressure
  tex(key, { t0: s12, t1: 21.57, seed: S(), color: 'w', mode: 'bp', q: 8, f: 7200, g: K([[s12, 0], [s12 + 0.4, 0.008], [21.5, 0.006], [21.57, 0]]), width: 1, send: 0.5 });
  const fl = C.sonicFlash;
  impact(key, fl, { size: 0.8, f0: 70, f1: 30, body: 200, crack: 5000, crackT: 0.012, seed: S(), send: 0.7 });
  tone(key, { t0: fl, t1: fl + 0.5, seed: S(), h: [1, 0.3], f: (t) => 3400 * Math.exp(-(t - fl) * 3), g: (t) => 0.05 * Math.exp(-(t - fl) * 8), send: 0.7 });
  cue(fl, 'sonic flash');

  // ===================================================== III. THE DEEP
  const sh = C.shadowInSea;
  tex(key, { t0: sh, t1: 23.17, seed: S(), color: 'b', mode: 'lp', f: 110, g: K([[sh, 0], [22.6, 1.3], [23.17, 0]]), width: 0.2, send: 0.1 });
  // deck: the ship is a living machine
  const deckG = byShot({ s10: 0.5, s15: 0.8, s16: 1 }, {}, 0);
  tone(amb, { t0: 14.5, t1: 28.4, seed: S(), h: [1, 0.6, 0.34, 0.2], f: () => 41.2, g: (t) => 0.1 * deckG(t), send: 0.04 });
  tex(amb, { t0: 14.5, t1: 28.4, seed: S(), color: 'p', mode: 'bp', q: 3, f: 165, g: (t) => 0.14 * deckG(t) * (1 + 0.5 * Math.sin(TAU * 3.1 * t)), send: 0.05 });
  // gulls wheeling, small and bright against all that scale
  const gull = (t, p, sc, sd) => { const d = 0.26 * sc; tone(amb, { t0: t, t1: t + d, seed: sd, h: [1, 0.5, 0.3, 0.16], f: K([[t, 1500], [t + d * 0.3, 2500], [t + d, 1300]]), g: K([[t, 0], [t + 0.03, 0.022], [t + d, 0]]), pan: () => p, send: 0.5 }); };
  [[23.45, -0.5, 1], [23.9, -0.42, 0.8], [24.28, -0.3, 1.1], [25.3, 0.5, 1], [25.62, 0.56, 0.9]].forEach(([t, p, q]) => gull(t, p, q, S()));
  // whales: the rise, the blows, the song
  const wr = C.whalesRise, wd = C.whalesDive;
  [[wr, -0.5, 0.75], [wr + 0.55, -0.15, 0.9], [wr + 1.0, 0.25, 0.7], [wr + 1.5, 0.55, 0.7]].forEach(([t, p, v]) => {
    splash(key, t, { size: 0.7 * v, seed: S(), pan: p, gain: 0.7 });
    tex(key, { t0: t + 0.4, t1: t + 1.25, seed: S(), color: 'w', mode: 'bp', q: 0.7, f: K([[t + 0.4, 1000], [t + 0.56, 2600], [t + 1.25, 1500]]), g: K([[t + 0.4, 0], [t + 0.5, 0.24 * v], [t + 1.25, 0]]), pan: () => p, send: 0.4 });
  });
  const song = (t, base, stretch, drop, gain, pan, send, target = key) => { const [c, g] = whalePhrase(base, stretch, drop); put1(target, t, whale(c, g, { gain }, S()), { pan, send }); };
  song(wr + 0.2, 233, 0.95, 0, 0.17, -0.25, 1.0); song(wr + 1.3, 311, 0.85, 0, 0.1, 0.5, 1.1);
  cue(wr, 'whales rise, song');
  [[wd, -0.3, 1], [wd + 0.2, 0.35, 0.8]].forEach(([t, p, v]) => tex(key, { t0: t, t1: t + 1.6, seed: S(), color: 'w', mode: 'bp', q: 0.6, f: 1200, g: K([[t, 0], [t + 0.3, 0.22 * v], [t + 1.6, 0]]), pan: () => p, send: 0.35 }));
  const tail = wd + 0.45;
  splash(key, tail, { size: 1.2, seed: S(), pan: -0.1, gain: 1 }); cue(tail, 'tail slam');
  // bridge wing: gale, spray, lashings ringing, the ship answers
  const s16 = 26.97, s17 = 28.4;
  put1(amb, s16 + 0.1, horn(1.1, mtof(nm('B2')), { gain: 0.3, lp: 1000 }, S()), { pan: 0.35, send: 1.1 }); cue(s16 + 0.1, 'ship horn');
  { const g = grains(s16, s17, () => 15, (s, at, q, t, p, pg) => { const n = Math.ceil(0.08 * SR), f = q.range(620, 2100), d = q.range(50, 170); for (let i = 0; i < n && at + i < s.length; i++) s[at + i] += (Math.sin(TAU * f * i / SR) + 0.5 * Math.sin(TAU * f * 2.76 * i / SR)) * Math.exp(-i / d) * q.range(0.03, 0.12) * pg; }, S(), 0.2); putGr(amb, g, { send: 0.3 }); }
  [[s16 + 0.35, -0.3], [s16 + 0.95, 0.4]].forEach(([t, p]) => tex(key, { t0: t, t1: t + 0.8, seed: S(), color: 'w', mode: 'hp', f: 1100, g: K([[t, 0], [t + 0.06, 0.24], [t + 0.8, 0]]), pan: () => p, send: 0.3 }));
  put1(key, s16 + 0.1, friction(1.2, { modes: HULL(1), rate: (u) => 11 + 6 * u, env: (u) => Math.sin(Math.PI * u), gain: 0.42, drive: 1.2 }, S()), { pan: -0.2, send: 0.4 });
  // below: the song, close and enormous, inside the water
  song(s17 + 0.15, 165, 1.2, 0, 0.14, -0.2, 1.1, under); song(s17 + 1.35, 247, 0.85, 0, 0.075, 0.45, 1.2, under);
  tex(under, { t0: s17, t1: 31.1, seed: S(), color: 'p', mode: 'bp', q: 3, f: 75, g: (t) => 0.24 * (1 + 0.8 * Math.sin(TAU * 7 * t)), send: 0.2 });
  // lures: the sea begins to boil
  const lu = C.lures, ma = C.mawRises;
  boil(key, lu, 35.6, (t) => 80 + 260 * invLerp(lu, ma, t), { seed: S(), lo: 120, hi: 720, gain: 0.5 });
  tex(key, { t0: lu - 0.1, t1: 35.6, seed: S(), color: 'w', mode: 'bp', q: 0.6, f: K([[lu, 700], [ma, 1900]]), g: K([[lu - 0.1, 0.1], [ma, 0.34], [35.5, 0.42]]), send: 0.25 });
  [[lu + 0.1, -0.5], [lu + 0.42, -0.15], [lu + 0.8, 0.2], [lu + 1.15, 0.52]].forEach(([t, p]) => {
    splash(key, t, { size: 0.5, seed: S(), pan: p, gain: 0.7 });
    tex(key, { t0: t, t1: t + 1.5, seed: S(), color: 'w', mode: 'bp', q: 0.5, f: 2400, g: K([[t, 0], [t + 0.3, 0.13], [t + 1.5, 0]]), pan: () => p, send: 0.3 });
  });
  // the four sing, thin and wrong: a phrase a semitone flat of itself
  song(lu + 0.45, 277, 0.7, 1, 0.13, -0.5, 1); song(lu + 0.7, 262, 0.7, 1, 0.13, 0.5, 1);

  // ===================================================== IV. BREACH
  // the ring of teeth comes up: rock-grinding, torrents off bone, a closing door the size of a city
  tex(key, { t0: ma, t1: C.breach, seed: S(), color: 'b', mode: 'lp', f: 420, g: K([[ma, 0.5], [C.breach, 1.5]]), width: 0.5, send: 0.2 });
  put1(key, ma + 0.05, friction(2.0, { modes: HULL(0.72), rate: (u) => 9 + 9 * u, env: (u) => Math.sin(Math.PI * u), gain: 0.7, drive: 1.5 }, S()), { send: 0.5 });
  put1(key, ma + 0.35, roar(1.7, { f: (u) => 38 + 8 * u, env: (u) => Math.sin(Math.PI * Math.pow(u, 0.7)), gain: 0.72, drive: 1.9 }, S()), { send: 0.7 });
  impact(key, C.breach - 0.12, { size: 0.7, f0: 80, f1: 32, body: 220, crack: 600, crackT: 0.05, seed: S(), send: 0.5 });
  const be = C.breach, top = C.breachTop, bl = C.belly;
  impact(key, be, { size: 1.15, f0: 110, f1: 29, body: 420, crack: 900, crackT: 0.05, seed: S(), send: 0.5 }); cue(be, 'breach: water erupts');
  // a mountain of white water: slow to rise, enormous, then a sky of it falling back
  tex(key, { t0: be, t1: bl + 0.2, seed: S(), color: 'b', mode: 'lp', f: K([[be, 900], [top, 560], [bl, 300]]), g: K([[be, 1.9], [top, 1.5], [bl - 0.2, 1.05], [bl + 0.2, 0]]), width: 0.7, send: 0.3 });
  tex(key, { t0: be, t1: bl + 0.2, seed: S(), color: 'w', mode: 'bp', q: 0.45, f: K([[be, 2600], [top, 1500], [bl, 1100]]), g: K([[be, 0.85], [be + 0.3, 0.7], [top, 0.34], [bl - 0.2, 0.42], [bl + 0.2, 0]]), width: 1, send: 0.35 });
  tex(key, { t0: top - 0.8, t1: bl + 0.2, seed: S(), color: 'w', mode: 'hp', f: 2600, g: K([[top - 0.8, 0], [top + 1, 0.13], [bl - 0.1, 0.16], [bl + 0.2, 0]]), width: 1, send: 0.35 });
  put1(key, be + 0.5, roar(4.6, { f: K([[0, 34], [0.3, 46], [0.62, 52], [1, 30]]), env: (u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05)), 0.7), gain: 0.92, drive: 2.1, form: [[120, 3, 1], [270, 3.2, 1], [610, 4, 0.7], [1350, 4.5, 0.34], [2500, 5, 0.12]], move: 0.3 }, S()), { send: 0.9 }); cue(be + 0.5, 'leviathan roar');
  // ships screaming small against it
  put1(amb, be + 1.1, horn(1.0, mtof(nm('F#2')), { gain: 0.34, lp: 1000 }, S()), { pan: -0.55, send: 1 });
  put1(amb, be + 2.3, horn(0.9, mtof(nm('C3')), { gain: 0.3, lp: 1000 }, S()), { pan: 0.6, send: 1.1 });
  [[be + 0.8, -0.45, 180], [be + 1.8, 0.4, 220], [top + 0.3, -0.2, 143]].forEach(([t, p, f]) => clang(key, t, { f, ring: 1, gain: 0.3, pan: p, seed: S() }));
  // falling chunks of the sea
  [[top + 0.6, -0.4, 1], [top + 1.1, 0.3, 0.9], [top + 1.7, -0.1, 1.2], [top + 2.3, 0.5, 1]].forEach(([t, p, v]) => splash(key, t, { size: v, seed: S(), pan: p, gain: 0.6 }));
  // belly: heard through the glass of the bridge. Everything is in the steel now.
  const bridge = byShot({ s22: 1 }, {}, 0);
  tex(key, { t0: bl, t1: 45.1, seed: S(), color: 'b', mode: 'lp', f: 130, g: (t) => 1.5 * bridge(t), width: 0.4, send: 0.1 });
  put1(key, bl + 0.1, roar(2.6, { f: K([[0, 28], [0.5, 34], [1, 26]]), env: (u) => Math.sin(Math.PI * u), gain: 0.6, drive: 1.4, grit: 0.4, form: [[90, 3, 1], [190, 3, 0.8], [360, 3.5, 0.36]], move: 0 }, S()), { pan: 0, send: 0.2 });
  tex(key, { t0: bl, t1: 45.1, seed: S(), color: 'p', mode: 'bp', q: 1.2, f: 240, g: K([[bl, 0.1], [bl + 1, 0.4], [45.1, 0.1]]), pan: K([[bl, -0.7], [45.1, 0.7]]), send: 0.1 });
  { const g = grains(bl, 45.1, (t) => 26 * bridge(t), (s, at, q, t, p, pg) => { const n = Math.ceil(0.012 * SR), f = q.range(2100, 6200); for (let i = 0; i < n && at + i < s.length; i++) s[at + i] += Math.sin(TAU * f * i / SR) * Math.exp(-i / 90) * q.range(0.02, 0.09) * pg; }, S(), 0.1); putGr(key, g, { send: 0.08 }); }
  // the ship's general alarm, tinny, somewhere behind you
  for (let t = bl + 0.25; t < 45; t += 0.32) tone(amb, { t0: t, t1: t + 0.2, seed: S(), h: [1, 0, 0.5, 0, 0.3], f: () => 880, g: K([[t, 0], [t + 0.01, 0.03], [t + 0.19, 0.03], [t + 0.2, 0]]), pan: () => -0.45, send: 0.16 });
  put1(key, bl + 0.3, friction(2.2, { modes: HULL(1.1), rate: (u) => 12 + 7 * u, env: (u) => Math.sin(Math.PI * u), gain: 0.46, drive: 1.3 }, S()), { pan: 0.3, send: 0.2 });
  impact(key, C.bigWave - 0.65, { size: 0.9, f0: 90, f1: 30, body: 260, crack: 700, crackT: 0.03, seed: S(), send: 0.3 });

  // ===================================================== V. THE SWELL
  const bw = C.bigWave, ss = C.shipStands, fg = 49.33, rn = C.reentry;
  tex(key, { t0: bw, t1: fg, seed: S(), color: 'b', mode: 'lp', f: K([[bw, 300], [ss, 640], [fg, 360]]), g: K([[bw, 0.8], [ss, 1.7], [fg, 1.15]]), width: 0.7, send: 0.25 });
  tex(key, { t0: bw, t1: fg, seed: S(), color: 'w', mode: 'bp', q: 0.5, f: K([[bw, 800], [ss, 1900], [fg, 1000]]), g: K([[bw, 0.08], [ss, 0.34], [fg, 0.2]]), width: 1, send: 0.3 });
  put1(key, bw + 0.2, friction(2.1, { modes: HULL(0.9), rate: (u) => 8 + 12 * u, env: (u) => 0.4 + 0.6 * u, gain: 0.54, drive: 1.5 }, S()), { pan: -0.2, send: 0.5 });
  put1(key, ss - 0.1, friction(1.9, { modes: STEEL, rate: (u) => 90 + 230 * u * u, env: (u) => Math.sin(Math.PI * u), gain: 0.34, drive: 1.6, jit: 0.22 }, S()), { pan: 0.1, send: 0.7 }); cue(ss, 'ship stands: steel scream');
  put1(key, ss, friction(2.1, { modes: HULL(0.66), rate: (u) => 7 + 6 * u, env: (u) => Math.sin(Math.PI * u), gain: 0.74, drive: 1.5 }, S()), { pan: 0.05, send: 0.5 });
  [[0.3, 0.1, 150, 1], [0.62, -0.3, 201, 0.9], [0.9, 0.35, 127, 1.1], [1.15, -0.1, 171, 0.9], [1.4, 0.2, 113, 1], [1.65, -0.4, 193, 0.8]].forEach(([d, p, f, v]) => { clang(key, ss + d, { f, ring: 1.3, gain: 0.64 * v, pan: p, seed: S() }); splash(key, ss + d + 0.55, { size: 0.5 * v, seed: S(), pan: p, gain: 0.55 }); });
  // fog: the wet roar of it, the ridge going under, a groan from far down
  tex(key, { t0: fg, t1: rn + 0.04, seed: S(), color: 'w', mode: 'hp', f: 2000, g: K([[fg, 0.1], [50.5, 0.06], [rn, 0.08]]), width: 1, send: 0.45 });
  tex(key, { t0: fg, t1: rn + 0.04, seed: S(), color: 'b', mode: 'lp', f: 240, g: K([[fg, 1.2], [rn, 1]]), width: 0.5, send: 0.2 });
  put1(key, fg + 0.2, roar(1.8, { f: K([[0, 36], [1, 26]]), env: (u) => Math.sin(Math.PI * u), gain: 0.85, drive: 1.5, grit: 0.5 }, S()), { pan: -0.15, send: 0.9 });

  // ===================================================== VI. THE RETURN
  // port: thin high air; a falling whistle crosses the whole sky, wide
  const th = rn + 0.4, pl = C.plasma, ps = 57.73;
  tone(key, { t0: rn + 0.32, t1: pl + 0.1, seed: S(), h: [1, 0.26, 0.1], f: K([[rn + 0.32, 3300], [pl, 1100]]), g: K([[rn + 0.32, 0], [rn + 0.7, 0.04], [pl + 0.1, 0.05]]), pan: K([[rn + 0.32, -0.8], [pl, 0.8]]), jit: 0.01, send: 0.5 });
  tex(key, { t0: rn + 0.32, t1: pl + 0.1, seed: S(), color: 'w', mode: 'bp', q: 1.4, f: K([[rn + 0.32, 4200], [pl, 1400]]), g: K([[rn + 0.32, 0], [pl, 0.17]]), pan: K([[rn + 0.32, -0.9], [pl, 0.9]]), width: 0.5, send: 0.4 });
  // plasma: the arrow is on fire and the sky is the fuel
  const roarP = (t0, t1, g0, f0, f1) => { tex(key, { t0, t1, seed: S(), color: 'w', mode: 'bp', q: 0.45, f: K([[t0, f0], [t1, f1]]), g: K([[t0, 0], [t0 + 0.08, g0], [t1 - 0.05, g0 * 1.2], [t1, 0]]), width: 0.8, send: 0.3 }); tex(key, { t0, t1, seed: S(), color: 'b', mode: 'lp', f: 420, g: K([[t0, 0], [t0 + 0.1, 1.25 * g0 * 2], [t1, 0.9 * g0 * 2]]), width: 0.5, send: 0.2 }); };
  roarP(pl, 54, 0.8, 1700, 900); crackle(key, pl, 54, (t) => 140, { seed: S(), gain: 0.34, lo: 1400, hi: 6000 });
  tone(key, { t0: pl, t1: 54, seed: S(), h: [1, 0.5, 0.3, 0.14], f: K([[pl, 320], [54, 208]]), g: K([[pl, 0], [pl + 0.1, 0.05], [54, 0.05]]), jit: 0.02, send: 0.3 });
  // canyon: the flank moving past stone, slower than geology
  const s27 = 54;
  put1(under, s27 + 0.25, roar(3.4, { f: K([[0, 26], [0.5, 33], [1, 22]]), env: (u) => Math.sin(Math.PI * u), gain: 0.34, drive: 1.4, grit: 0.45, form: [[100, 3, 1], [210, 3, 0.8], [420, 3.5, 0.3]] }, S()), { pan: 0.2, send: 0.5 });
  put1(under, s27 + 0.5, friction(2.8, { modes: HULL(0.62), rate: (u) => 7 + 5 * Math.sin(u * 6), env: (u) => Math.sin(Math.PI * u), gain: 0.3, drive: 1.3 }, S()), { pan: -0.3, send: 0.6 });
  { const g = grains(s27 + 0.3, ps - 0.2, () => 9, (s, at, q, t, p, pg) => { const n = Math.ceil(0.16 * SR), f = q.range(60, 190); for (let i = 0; i < n && at + i < s.length; i++) s[at + i] += Math.sin(TAU * f * i / SR) * Math.exp(-i / 2600) * q.range(0.06, 0.18) * pg; }, S(), 0.3); putGr(under, g, { send: 0.5 }); }
  song(s27 + 0.9, 131, 1.15, 1, 0.1, 0.45, 1.4, under); cue(s27 + 0.9, 'whale song, far down');
  // the arrow again: the sound arrives before it does
  roarP(ps, 59.57, 0.56, 1200, 3600); crackle(key, ps, 59.57, (t) => 160, { seed: S(), gain: 0.34, lo: 1400, hi: 6000 });
  tone(key, { t0: ps, t1: 59.57, seed: S(), h: [1, 0.4, 0.2], f: K([[ps, 310], [59.57, 2100]]), g: K([[ps, 0], [ps + 0.2, 0.05], [59.5, 0.08], [59.57, 0]]), jit: 0.012, send: 0.3 });
  // monster head: the last whale running. Then the water holds its breath.
  song(59.62, 311, 0.42, 2, 0.17, -0.5, 1.2, under);
  // nearly nothing before the hit: one rising thread, a held breath

  // ===================================================== VII. IMPACT AND PIERCE
  impact(key, im, { size: 1.25, f0: 150, f1: 28, body: 540, crack: 1400, crackT: 0.05, seed: S(), send: 0.6 }); sonicBoom(key, im, { size: 1, seed: S(), gain: 0.9 }); duck(im, im + 0.22, -1.5);
  cue(im, 'IMPACT');
  thunder(key, im + 0.2, { dur: 2.4, gain: 0.8, seed: S() });
  tex(key, { t0: im, t1: pq, seed: S(), color: 'b', mode: 'lp', f: K([[im, 800], [pq, 340]]), g: K([[im, 1.8], [pq, 1.3]]), width: 0.7, send: 0.3 });
  tex(key, { t0: im + 0.1, t1: pq, seed: S(), color: 'w', mode: 'bp', q: 0.5, f: K([[im, 3000], [pq, 1400]]), g: K([[im, 0.4], [pq, 0.26]]), width: 1, send: 0.35 });
  // pierce: a steel lance through a living wall
  impact(key, pq, { size: 1.35, f0: 170, f1: 27, body: 560, crack: 1600, crackT: 0.04, seed: S(), send: 0.6 }); duck(pq, pq + 0.25, -1.5);
  put1(key, pq, friction(1.3, { modes: STEEL, rate: (u) => 420 - 260 * u, env: (u) => Math.exp(-u * 2.2), gain: 0.4, drive: 2, jit: 0.3 }, S()), { send: 0.7 }); cue(pq, 'PIERCE: lance, lightning');
  put1(key, pq + 0.05, roar(3.4, { f: K([[0, 62], [0.1, 74], [0.5, 46], [1, 28]]), env: (u) => Math.pow(1 - u, 0.8) * Math.min(1, u * 14), gain: 0.92, drive: 2.5, form: [[150, 3, 1], [330, 3.2, 1], [720, 4, 0.8], [1500, 4.5, 0.5], [2800, 5, 0.2]], move: -0.3 }, S()), { send: 0.9 }); cue(pq + 0.05, 'leviathan scream');
  // lightning all along the body
  const LN = [0.02, 0.18, 0.31, 0.62, 0.85, 1.2, 1.46, 1.9, 2.25, 2.6, 3.1, 3.55];
  LN.forEach((d, i) => { const p = ((i * 37) % 11 - 5) / 7; arc(key, pq + d, { dur: 0.16 + (i % 3) * 0.1, gain: 0.32, pan: p, seed: S(), f: 80 + (i % 4) * 27 }); });
  crackle(key, pq, 66.83, (t) => 220 * Math.exp(-(t - pq) * 0.5) + 30, { seed: S(), gain: 0.5, lo: 1200, hi: 8000 });
  thunder(key, pq + 0.25, { dur: 3.6, gain: 1, pan: -0.1, seed: S() }); thunder(key, pq + 2.1, { dur: 2.2, gain: 0.7, pan: 0.3, seed: S() });
  // claws: stone torn up by something that is dying
  const cl = 65.23;
  put1(key, cl + 0.05, friction(1.4, { modes: HULL(1.7), rate: (u) => 34 - 18 * u, env: (u) => Math.sin(Math.PI * u), gain: 0.56, drive: 1.6 }, S()), { pan: 0.25, send: 0.4 });
  { const g = grains(cl, 66.83, () => 26, (s, at, q, t, p, pg) => { const n = Math.ceil(0.09 * SR), f = q.range(90, 340); for (let i = 0; i < n && at + i < s.length; i++) s[at + i] += Math.sin(TAU * f * i / SR) * Math.exp(-i / 900) * q.range(0.1, 0.32) * pg; }, S(), 0.2); putGr(key, g, { send: 0.3 }); }
  // the mound: belly dragged across rock
  const mo = 68.17, tp = C.tipOut, rb = C.rockBurst;
  put1(under, mo, friction(tp - mo + 0.1, { modes: HULL(0.8), rate: (u) => 10 + 15 * u, env: (u) => 0.5 + 0.5 * u, gain: 0.62, drive: 1.6 }, S()), { pan: 0, send: 0.5 });
  tex(under, { t0: mo, t1: tp, seed: S(), color: 'b', mode: 'lp', f: 230, g: K([[mo, 0.4], [tp, 1.4]]), width: 0.4, send: 0.2 });
  // tip out: the barbs tear through, the point goes into stone
  impact(key, tp, { size: 1.1, f0: 190, f1: 34, body: 640, crack: 2000, crackT: 0.03, seed: S(), send: 0.5 });
  put1(key, tp, friction(0.72, { modes: STEEL, rate: (u) => 620 - 400 * u, env: (u) => Math.exp(-u * 3), gain: 0.42, drive: 2.2, jit: 0.3 }, S()), { send: 0.7 }); clang(key, tp + 0.02, { f: 311, ring: 1.4, gain: 0.8, seed: S() }); cue(tp, 'tip out: steel into stone');
  [0.02, 0.26, 0.5].forEach((d, i) => arc(key, tp + d, { dur: 0.25, gain: 0.3, seed: S(), pan: (i - 1) * 0.4, f: 117 }));
  // rock burst: the mound lets go; boulders come apart in the water
  impact(key, rb, { size: 1.3, f0: 130, f1: 29, body: 480, crack: 1100, crackT: 0.05, seed: S(), send: 0.6 }); cue(rb, 'rock burst');
  tex(key, { t0: rb, t1: rb + 2.1, seed: S(), color: 'b', mode: 'lp', f: K([[rb, 900], [rb + 2.1, 200]]), g: K([[rb, 2], [rb + 2.1, 0]]), width: 0.8, send: 0.3 });
  [[0.25, -0.5, 1], [0.5, 0.45, 1.1], [0.62, -0.15, 0.8], [0.84, 0.2, 1], [1.1, -0.4, 0.8], [1.35, 0.5, 0.7], [1.6, -0.1, 0.6]].forEach(([d, p, v]) => impact(key, rb + d, { size: 0.74 * v, f0: 120, f1: 40, body: 420, crack: 1100, crackT: 0.03, seed: S(), pan: p, send: 0.5 }));
  { const g = grains(rb + 0.1, rb + 2, (t) => 60 * Math.exp(-(t - rb)), (s, at, q, t, p, pg) => { const n = Math.ceil(0.05 * SR), f = q.range(160, 900); for (let i = 0; i < n && at + i < s.length; i++) s[at + i] += Math.sin(TAU * f * i / SR) * Math.exp(-i / 500) * q.range(0.08, 0.26) * pg; }, S(), 0.2); putGr(key, g, { send: 0.45 }); }
  // run through: the dying song; the body sinking and rising on its own lightning
  const rt = 72.3;
  { const [c, g] = whalePhrase(98, 0.86, 3); put1(key, rt - 0.2, whale(c, g, { gain: 0.26, rough: 0.9, f1: 260, f2: 620, f3: 1400 }, S()), { pan: 0, send: 1.1 }); }
  cue(rt, 'the dying song');
  [0.4, 1.1, 1.7].forEach((d, i) => arc(key, rt + d, { dur: 0.3, gain: 0.2, seed: S(), pan: (i - 1) * 0.5, f: 87 }));
  crackle(key, rt, 74.73, () => 26, { seed: S(), gain: 0.22, lo: 1000, hi: 5000 });

  // ===================================================== VIII. THE MOUNTAIN AND THE WALL
  const sb2 = C.surfaceBurst, fp = C.flip, cr = C.crash;
  // a calm sea, for one second. Then the whole horizon starts to rise.
  tex(key, { t0: sb2 - 0.1, t1: fp, seed: S(), color: 'b', mode: 'lp', f: K([[sb2, 200], [fp, 760]]), g: K([[sb2 - 0.1, 0.2], [sb2 + 1, 1], [fp, 2.1]]), width: 0.7, send: 0.3 });
  tex(key, { t0: sb2 + 0.6, t1: fp, seed: S(), color: 'w', mode: 'bp', q: 0.5, f: K([[sb2 + 0.6, 500], [fp, 2200]]), g: K([[sb2 + 0.4, 0], [fp, 0.85]]), width: 1, send: 0.4 });
  impact(key, sb2, { size: 0.9, f0: 90, f1: 28, body: 240, crack: 500, crackT: 0.07, seed: S(), send: 0.5 }); cue(sb2, 'water mountain rises');
  put1(key, fp - 1.9, roar(1.8, { f: K([[0, 24], [1, 40]]), env: (u) => u * u, gain: 0.6, drive: 1.5, grit: 0.7 }, S()), { send: 0.7 });
  // flip: it rolls over in the air, screaming, lit by its own death
  impact(key, fp, { size: 1, f0: 110, f1: 30, body: 380, crack: 1000, crackT: 0.05, seed: S(), send: 0.5 });
  put1(key, fp + 0.1, roar(2.0, { f: K([[0, 42], [0.4, 58], [1, 26]]), env: (u) => Math.pow(Math.sin(Math.PI * u), 0.6), gain: 0.92, drive: 2.3, form: [[140, 3, 1], [320, 3.2, 1], [700, 4, 0.8], [1450, 4.5, 0.42], [2700, 5, 0.16]], move: -0.4 }, S()), { send: 0.9 }); cue(fp + 0.1, 'final roar');
  tex(key, { t0: fp, t1: cr + 0.05, seed: S(), color: 'b', mode: 'lp', f: 620, g: K([[fp, 1.6], [cr, 1.9]]), width: 0.8, send: 0.35 });
  tex(key, { t0: fp, t1: cr + 0.05, seed: S(), color: 'w', mode: 'bp', q: 0.5, f: 1800, g: K([[fp, 0.3], [cr, 0.46]]), width: 1, send: 0.35 });
  [0.1, 0.46, 0.8, 1.15, 1.45, 1.8].forEach((d, i) => arc(key, fp + d, { dur: 0.26, gain: 0.3, seed: S(), pan: ((i * 5) % 7 - 3) / 4, f: 97 }));
  crackle(key, fp, cr + 3, (t) => 110, { seed: S(), gain: 0.42, lo: 1200, hi: 7000 });
  thunder(key, fp + 0.3, { dur: 3, gain: 1, pan: -0.3, seed: S() }); thunder(key, cr + 0.4, { dur: 3.2, gain: 1, pan: 0.25, seed: S() });
  // crash: it comes down; the wall takes everything, and then the wall is all there is
  impact(key, cr, { size: 1.4, f0: 120, f1: 27, body: 520, crack: 1100, crackT: 0.06, seed: S(), send: 0.6 }); duck(cr, cr + 0.3, -1.5); cue(cr, 'CRASH: the wall');
  tex(key, { t0: cr, t1: D, seed: S(), color: 'b', mode: 'lp', f: K([[cr, 900], [D, 620]]), g: K([[cr, 2], [cr + 1.5, 1.9], [D, 2.4]]), width: 0.8, send: 0.35 });
  tex(key, { t0: cr, t1: D, seed: S(), color: 'w', mode: 'bp', q: 0.45, f: K([[cr, 2400], [D, 1500]]), g: K([[cr, 1], [cr + 1.5, 1], [D, 1.9]]), width: 1, send: 0.4 });
  tex(key, { t0: cr + 0.2, t1: D, seed: S(), color: 'w', mode: 'hp', f: 3000, g: K([[cr + 0.2, 0.08], [D, 0.5]]), width: 1, send: 0.35 });
  [[0.2, 0.3, 139], [0.45, -0.4, 196], [0.7, 0.2, 117], [0.95, -0.25, 165], [1.3, 0.45, 208], [1.75, -0.1, 147], [2.2, 0.35, 123]].forEach(([d, p, f]) => clang(key, cr + d, { f, ring: 1.2, gain: 0.5, pan: p, seed: S() }));
  put1(key, cr + 0.2, friction(2.4, { modes: STEEL, rate: (u) => 160 + 260 * u, env: (u) => Math.sin(Math.PI * u), gain: 0.32, drive: 1.6, jit: 0.25 }, S()), { pan: 0.2, send: 0.7 });
  put1(key, cr + 0.3, friction(2.8, { modes: HULL(0.7), rate: (u) => 12 - 4 * u, env: (u) => Math.sin(Math.PI * u), gain: 0.66, drive: 1.5 }, S()), { pan: -0.15, send: 0.5 });
  put1(amb, cr + 0.85, horn(1.2, mtof(nm('B2')), { gain: 0.42, lp: 800 }, S()), { pan: 0.45, send: 1.1 });
  duck(cr + 1.6, D, -4);    // the orchestra gives way: the last thing heard is water

  report.sort((a, b) => a[0] - b[0]);
  return { report, ducks };
}
