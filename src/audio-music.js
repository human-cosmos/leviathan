// Sound department — the score for LEVIATHAN. Original music in B minor / Phrygian.
//   Arrow theme      B - F# - A - B    rising fifth, a reach and an arrival (horns, trumpets)
//   Leviathan theme  B - C - B - G     a semitone that will not resolve, then the drop (low brass, men)
//   The held tones sit on B4 / B5 (494 / 988 Hz) above a B pedal at 45-90 Hz.
// A heartbeat at about 108 BPM runs under the whole film (beatGrid), and the taiko, the spiccato and
// the low orchestra all lock to it: that pulse is what makes the 83 s read as one piece.
// Every time below hangs off CUES, so the score re-times itself when a beat moves.
import { clamp, smooth } from './util.js';
import { SR, TAU, mtof, nm, put, put2, pws, Biquad } from './audio-dsp.js';
import { ensemble } from './audio-master.js';
import { section, brassNote, stringNote, choirNote, choirFormants, taiko, timpani, boom, crash, cymbalSwell, tamtam, anvil, shepard, heart } from './audio-inst.js';

const list = (x) => [].concat(x);
const cresc = (u) => u * u * (3 - 2 * u);
const dim = (u) => 1 - cresc(u);
const hairpin = (u) => Math.sin(Math.PI * clamp(u));
const fp = (u) => (u < 0.08 ? 1 - u * 8 * 0.75 : 0.25 + 0.75 * cresc((u - 0.08) / 0.92));

// heartbeat level across the film
const PULSE = [[0, 0.72], [6, 0.72], [9.17, 0.8], [13.6, 1], [13.8, 0.9], [15, 0.7], [15.4, 0.95], [18, 0.7], [19.8, 0.3], [20, 0.16], [21.4, 0.16], [21.6, 1], [23.1, 0.9], [23.4, 0.6], [26.9, 0.6], [28.4, 0.76], [31.1, 0.9], [33.3, 1], [42.3, 1], [42.5, 0.74], [45, 0.9], [49.3, 1], [51.2, 1], [51.4, 0.3], [52.5, 0.5], [52.7, 0.8], [57, 0.82], [57.73, 0.9], [59.9, 1], [60.1, 0], [60.85, 0], [60.9, 1], [66.8, 1], [67, 0.7], [68.2, 0.95], [72.2, 0.95], [72.4, 0.7], [74.7, 0.7], [74.8, 0.85], [82, 1], [82.4, 0], [83, 0]];

// how far the pedal falls between beats (1 = held). The reference drops to about a third.
const PUMP = [[0, 0.3], [13.6, 0.4], [15.4, 0.46], [21.6, 0.34], [33.4, 0.42], [35.5, 0.62], [42.3, 0.62], [42.5, 0.36], [45, 0.56], [51.3, 0.5], [52.6, 0.3], [60.9, 0.4], [61.5, 0.62], [66.8, 0.62], [67, 0.36], [70.2, 0.5], [77, 0.62], [83, 0.62]];

// The pulse: one low heartbeat runs under the whole film, about 108 BPM (a beat of 0.558 s, the
// tempo the reference breathes at). This tempo map bends it a few percent per section so that
// every story hit lands exactly on a beat. [time, beats until the next anchor]
export function beatGrid(C) {
  const w = C.cloudSplit + 0.6;
  const A = [[0.36, 2], [C.drawHold, 5], [4.37, 9], [9.17, 5], [C.chargeFull, 4], [C.release, 3], [w, 10], [C.sonicFlash, 1], [C.shadowInSea, 8], [C.whalesDive, 9], [C.lures, 4], [C.mawRises, 4], [C.breach, 7], [C.breachTop, 5], [C.belly, 5], [C.bigWave, 4], [C.shipStands, 4], [49.33, 4], [C.reentry, 1], [C.reentry + 0.4, 1], [C.plasma, 15], [C.impact, 4], [C.pierce, 11], [C.tipOut, 2], [C.rockBurst, 8], [C.surfaceBurst, 4], [C.flip, 4], [C.crash, 7], [C.end, 0]];
  const g = [];
  for (let i = 0; i + 1 < A.length; i++) for (let k = 0; k < A[i][1]; k++) g.push(A[i][0] + (A[i + 1][0] - A[i][0]) * k / A[i][1]);
  g.push(C.end);
  return g;
}

export function buildMusic(C, out) {
  const N = out.dry.n;
  let seed = 100; const S = () => ++seed;
  const report = [], cue = (t, l) => report.push([+t.toFixed(3), l]);
  const sec = { lo: section(N), hi: section(N), f: section(N), m: section(N), vn: section(N), vc: section(N) };

  // ---- section helpers: t, duration, note(s), velocity, options
  const LB = (t, d, ns, v, o = {}) => list(ns).forEach((n, i) => brassNote(sec.lo, t + i * 0.006, d, nm(n), v, { n: 6, gain: 0.17, pan: -0.14, spread: 0.3, maxCut: 2800, drive: 3.8, ...o, seed: S() }));
  const HB = (t, d, ns, v, o = {}) => list(ns).forEach((n, i) => brassNote(sec.hi, t + i * 0.008, d, nm(n), v, { n: 5, gain: 0.1, pan: 0.2, spread: 0.42, maxCut: 6400, drive: 2.8, ...o, seed: S() }));
  const CF = (t, d, ns, v, o = {}) => list(ns).forEach((n) => choirNote(sec.f, t, d, nm(n), v, { gain: 0.34, ...o, seed: S() }));
  const CM = (t, d, ns, v, o = {}) => list(ns).forEach((n) => choirNote(sec.m, t, d, nm(n), v, { gain: 0.34, ...o, seed: S() }));
  const VN = (t, d, ns, v, o = {}) => list(ns).forEach((n) => stringNote(sec.vn, t, d, nm(n), v, { pan: -0.26, gain: 0.1, ...o, seed: S() }));
  const VC = (t, d, ns, v, o = {}) => list(ns).forEach((n) => stringNote(sec.vc, t, d, nm(n), v, { pan: 0.24, gain: 0.13, bright: 5, ...o, seed: S() }));
  const SPIC = (t, n, v, o = {}) => VC(t, 0.07, n, v, { att: 0.006, rel: 0.075, n: 3, vib: 0, gain: 0.16, bright: 7, ...o });
  const SPICH = (t, n, v, o = {}) => VN(t, 0.06, n, v, { att: 0.005, rel: 0.07, n: 3, vib: 0, gain: 0.1, bright: 6, ...o });
  // perc
  const TK = (t, v, big = 1, pan = 0) => put(out, t, taiko(v, S(), big), { gain: 0.8, pan, send: 0.32 });
  const TP = (t, n, v) => put(out, t, timpani(nm(n), v, S()), { pan: -0.2, send: 0.34, gain: 0.9 });
  const BM = (t, v, o = {}) => put(out, t, boom(o, S()), { gain: 0.8 * v, send: 0.08 });
  const CR = (t, v, ring = 3.4) => put(out, t, crash(v, S(), ring), { pan: 0.18, send: 0.5 });
  const CS = (tPeak, rise, ring, v) => put(out, tPeak - rise, cymbalSwell(rise, ring, v, S()), { pan: -0.15, send: 0.55 });
  const TT = (t, v, dur = 6) => put(out, t, tamtam(v, S(), dur), { pan: -0.1, send: 0.6, gain: 1 });
  const AV = (t, v) => put(out, t, anvil(v, S()), { pan: 0.3, send: 0.5, gain: 0.5 });
  const ROLL = (t0, t1, n, v0, v1, rate = 15) => { for (let t = t0; t < t1; t += 1 / rate) TP(t, n, v0 + (v1 - v0) * (t - t0) / (t1 - t0)); };
  // the beat grid: B(t) = index of the beat at or after t; OST walks `div` slots per beat
  const GRID = beatGrid(C);
  const B = (t) => { let i = 0; while (i < GRID.length - 1 && GRID[i] < t - 1e-4) i++; return i; };
  const q = (t) => { const i = B(t); return i > 0 && t - GRID[i - 1] < GRID[i] - t ? GRID[i - 1] : GRID[i]; };   // nearest beat
  const OST = (t0, t1, div, fn) => {
    const slots = [];
    for (let i = Math.max(0, B(t0) - 1); i + 1 < GRID.length && GRID[i] < t1; i++) for (let k = 0; k < div; k++) { const t = GRID[i] + (GRID[i + 1] - GRID[i]) * k / div; if (t >= t0 - 1e-4 && t < t1) slots.push(t); }
    slots.forEach((t, i) => fn(i, t, (t - t0) / Math.max(1e-6, t1 - t0)));
  };
  const TUTTI = (t, lo, hi, v, o = {}) => {
    LB(t, o.d ?? 1, lo, v, { rel: 0.6, att: 0.014, scoop: 0.35 });
    HB(t, o.d ?? 1, hi, v * 0.92, { rel: 0.5, att: 0.016 });
    BM(t, v, { f0: 125, f1: 31, tau: o.tau ?? 1.2, dur: 4.2 });
    TK(t, v, 1.5); CR(t, v * 0.8, o.ring ?? 4);
  };

  // ---- the sub pedal: one solid line, always centre. [t, note, level, ramp]
  const SUB = [];
  const sb = (t, n, l, ramp = 0.03) => SUB.push([t, nm(n), l, ramp]);

  // ================================================== I. THE DRAW (0 .. release)
  const r = C.release, cs = C.chargeStart, cf = C.chargeFull;
  sb(0, 'B0', 0.8, 0.4); sb(3.1, 'B0', 0.5, 0.15); sb(C.drawHold + 2.9, 'B0', 1, 0.03); sb(cs + 0.15, 'B0', 0.42, 0.2);
  // heavy low brass, like the planet breathing in
  LB(0.02, 2.5, ['B1', 'F#2', 'B2'], 0.56, { swell: cresc, att: 0.5 });
  VC(0.1, 6.0, ['B1', 'B2'], 0.34, { att: 1 });
  CM(0.3, 5.5, ['B2', 'F#3'], 0.62, { att: 0.9, rel: 0.6 });
  LB(4.37, 1.8, ['G1', 'D2', 'B2'], 0.66, { swell: dim, att: 0.03 }); TK(4.37, 0.7, 1.6); BM(4.37, 0.6, { tau: 0.9 });
  TK(C.drawHold, 0.5, 1.6); BM(C.drawHold, 0.5, { tau: 0.7 });
  // the held tones: choir and muted horn on B, leaning on C
  CF(0.15, 3.3, ['B4', 'B5'], 1, { att: 0.7 }); HB(0.3, 3.0, ['F#4', 'B4'], 0.52, { att: 0.6, swell: hairpin, maxCut: 1500 });
  CF(3.5, 1.0, ['C5', 'C6'], 0.95, { att: 0.15, rel: 0.25 });
  CF(4.5, 1.7, ['B4', 'B5'], 1.04, { att: 0.2 });
  // charge: the bass falls away, strings tremble upward, the choir thins into a high cluster
  const ln = [[q(cs), 'B2', 'B4', 'D5'], [q(cs + 1.1), 'C3', 'C5', 'E5'], [q(cs + 2.1), 'D3', 'D5', 'F#5'], [9.17, 'E3', 'E5', 'G5'], [q(cs + 4.2), 'G3', 'F#5', 'A5'], [q(cs + 4.75), 'C3', 'G5', 'B5'], [cf, 'G2', 'B5', 'D6'], [q(r - 0.5), 'F#2', 'A#5', 'C#6']];
  ln.forEach(([t, lo, a, b], i) => {
    const d = (i + 1 < ln.length ? ln[i + 1][0] : r) - t, v = 0.62 + i * 0.055;
    VC(t, d + 0.03, lo, v, { att: 0.1, rel: 0.05, trem: 13 }); VN(t, d + 0.03, [a, b], v * 0.86, { att: 0.08, rel: 0.05, trem: 13, bright: 6 });
  });
  LB(q(cs + 1.1), 9.17 - q(cs + 1.1), ['C2', 'G2', 'C3'], 0.56, { att: 0.5, swell: cresc, maxCut: 1100, rel: 0.08 });
  CF(cs + 0.1, 1.5, ['F#5', 'B5', 'E6'], 0.94, { att: 0.5, rel: 0.5 });
  CF(cs + 1.5, 1.7, ['G5', 'C6', 'E6', 'A6'], 0.92, { att: 0.5, rel: 0.5 });
  HB(cs + 2.0, 1.2, ['B4'], 0.5, { att: 0.4, swell: hairpin, maxCut: 2200 });
  // from the wide shot the bass comes back as a driving pulse
  const s7 = cs + 3.17;
  sb(s7 - 0.3, 'E1', 0.75, 0.15); sb(q(cs + 4.2), 'G1', 0.75); sb(q(cs + 4.75), 'C1', 0.85); sb(cf, 'G1', 0.9); sb(q(r - 0.5), 'F#1', 1); sb(r - 0.01, 'B0', 0, 0.006);
  LB(s7, 1.0, ['E2', 'B2', 'E3', 'G3'], 0.66, { att: 0.03 }); TK(s7, 0.85, 1.5); BM(s7, 0.7);
  LB(q(cs + 4.2), 0.5, ['G2', 'B2', 'D3'], 0.7, { att: 0.05 });
  LB(q(cs + 4.75), 1.05, ['C2', 'G2', 'C3', 'E3'], 0.72, { att: 0.03 }); TK(q(cs + 4.75), 0.85, 1.4);
  LB(cf, q(r - 0.5) - cf + 0.02, ['G1', 'D2', 'G2', 'B2', 'D3'], 0.78, { att: 0.02, swell: cresc, rel: 0.06 }); HB(cf, q(r - 0.5) - cf + 0.02, ['G3', 'D4', 'B4'], 0.66, { att: 0.03, swell: cresc, rel: 0.06 }); TK(cf, 1, 1.5); BM(cf, 0.8);
  CF(cf, r - cf, ['B5', 'D6', 'G6'], 0.68, { att: 0.1, rel: 0.03, swell: cresc });
  CM(cf, r - cf, ['B3', 'D4', 'G4'], 0.62, { att: 0.1, rel: 0.03, swell: cresc });
  LB(q(r - 0.5), r - q(r - 0.5) - 0.01, ['F#1', 'C#2', 'F#2', 'A#2', 'C#3'], 0.92, { att: 0.02, swell: cresc, rel: 0.012 }); HB(q(r - 0.5), r - q(r - 0.5) - 0.01, ['F#3', 'C#4', 'E4', 'A#4'], 0.84, { att: 0.02, swell: cresc, rel: 0.012 });
  OST(s7, cf, 3, (i, t, u) => SPIC(t, i % 4 === 2 ? 'E3' : 'E2', i % 4 === 0 ? 0.85 : 0.5 + 0.25 * u));
  OST(cf, r - 0.01, 4, (i, t, u) => { SPIC(t, i % 4 === 2 ? 'B2' : 'B1', i % 4 === 0 ? 0.95 : 0.6 + 0.3 * u); SPICH(t, i % 2 ? 'B4' : 'F#5', 0.46 + 0.4 * u); });
  ROLL(cf + 0.1, r - 0.02, 'F#2', 0.28, 0.95, 16);
  CS(r, 2.6, 0.15, 0.85);
  put(out, r - 3.4, shepard(3.4, { base: 55, octaves: 2.2, gain: 0.1, curve: 2 }, S()), { send: 0.25 });
  // RELEASE: dead stop, then the whole orchestra as one hammer blow
  TUTTI(r, ['B0', 'B1', 'F#2', 'B2', 'D3'], ['F#3', 'B3', 'D4', 'F#4'], 1, { d: 0.75, tau: 1.3 });
  CM(r, 0.7, ['B2', 'F#3', 'B3'], 1, { att: 0.02, rel: 0.5 }); CF(r, 0.7, ['F#5', 'B5', 'D6'], 1, { att: 0.02, rel: 0.5 });
  TT(r, 1.1, 3.2); cue(r, 'release: tutti hit');
  sb(r + 0.1, 'B0', 0.95, 0.03);
  [1, 2].forEach((d, i) => { const t = GRID[B(r) + d]; LB(t, 0.34, ['B1', 'B2'], 0.74 - i * 0.04, { rel: 0.3, att: 0.015 }); BM(t, 0.74, { tau: 0.5, dur: 1.6 }); TK(t, 0.8, 1.6); });

  // ================================================== II. THE SKY OPENS
  const w = C.cloudSplit + 0.6, T = GRID[B(w) + 1] - GRID[B(w)];    // w: the whoosh lands, straight out of the gap
  sb(w - 0.3, 'G1', 0, 0.008); sb(w, 'G1', 1, 0.006);
  const arrow = (t, n, v, o = {}) => { HB(t, T * 1.02, n[0], v, o); HB(t + T, T * 1.02, n[1], v, o); HB(t + 2 * T, T * 0.52, n[2], v * 0.92, o); HB(t + 2.5 * T, o.last ?? T * 1.8, n[3], v * 1.04, { ...o, rel: 0.5 }); };
  TUTTI(w, ['G1', 'D2', 'G2', 'B2', 'D3'], ['G3', 'D4'], 0.96, { d: 2.1, tau: 1.0 });
  arrow(w, [['B3', 'B4'], ['F#4', 'F#5'], ['A4', 'A5'], ['B4', 'B5']], 0.9, { n: 6 });
  CF(w, 2.2, ['B4', 'D5', 'G5'], 0.74, { att: 0.08 }); CM(w, 2.2, ['G3', 'D4', 'B3'], 0.74, { att: 0.08 });
  VN(w, 2.2, ['G5', 'B5', 'D6'], 0.74, { att: 0.05, trem: 12, bright: 6 });
  [0, 1, 2, 2.5, 3].forEach((b) => TK(w + b * T, b ? 0.66 : 1, 1.3));
  OST(w, w + 2.25, 4, (i, t) => SPIC(t, i % 4 === 2 ? 'D3' : 'G2', i % 4 === 0 ? 0.9 : 0.62));
  const u = w + 4 * T + 0.06;                // second statement, a fifth up, already thinning with the air
  sb(u, 'D1', 0.8, 0.05);
  LB(u, 1.1, ['D2', 'A2', 'D3', 'F#3'], 0.76, { att: 0.05, swell: dim }); BM(u, 0.7, { tau: 0.8 });
  arrow(u, [['F#4', 'F#5'], ['C#5', 'C#6'], ['E5', 'E6'], ['F#5', 'F#6']], 0.74, { n: 6, last: 1.2, maxCut: 7400 });
  CF(u, 1.3, ['A5', 'D6', 'F#6'], 0.74, { att: 0.08 }); VN(u, 1.3, ['A5', 'D6', 'F#6'], 0.66, { att: 0.05, trem: 13, bright: 7 });
  const ua = u + 1.14;
  sb(ua, 'A1', 0.5, 0.05); LB(ua, 0.8, ['A1', 'E2', 'A2'], 0.56, { att: 0.05, swell: dim });
  CF(ua, 1.3, ['A5', 'C#6', 'E6'], 0.68, { att: 0.08 }); VN(ua, 1.5, ['A5', 'C#6', 'E6'], 0.54, { att: 0.05, trem: 13, bright: 7 });
  [0, 1, 1.5, 2].forEach((b) => TK(u + b * T, 0.52 - b * 0.06, 1.2));
  // ORBIT: the air is gone. One high thread.
  const orbit = 19.9;
  sb(orbit - 0.5, 'A1', 0, 0.25);
  VN(orbit - 0.3, 1.7, ['B6', 'F#6'], 0.36, { att: 0.3, rel: 0.5, n: 3, bright: 2.2 });
  CF(orbit - 0.2, 1.5, ['B5'], 0.42, { att: 0.5, rel: 0.5 });
  const fl = C.sonicFlash;
  TT(fl, 0.8, 4); BM(fl, 0.84, { f0: 80, f1: 31, tau: 0.8, dur: 2.6, nf: 180 }); TP(fl, 'B1', 0.8); cue(fl, 'sonic flash: tam-tam + boom');
  CF(fl, 0.9, ['F#5', 'B5', 'E6'], 0.56, { att: 0.04, rel: 0.7 });

  // ================================================== III. THE DEEP
  const sh = C.shadowInSea;
  sb(sh - 0.1, 'B0', 0.86, 0.5); sb(C.whalesRise - 0.2, 'B0', 0.32, 0.5);
  // two sub tones a semitone apart: the shadow beats slowly under the fleet
  const beat = new Float32Array(N); {
    const i0 = Math.round((sh - 0.2) * SR), i1 = Math.round((C.whalesRise + 0.4) * SR), f = mtof(nm('C2')); let p = 0;
    for (let i = i0; i < i1; i++) { p += f / SR; const u0 = (i - i0) / (i1 - i0); beat[i] = Math.sin(TAU * p) * Math.sin(Math.PI * Math.min(1, u0 * 1.1)) * 0.2; }
    put(out, 0, beat, { gain: 1, send: 0 });
  }
  LB(sh, C.whalesRise - sh + 0.3, ['B1', 'C2', 'F#2'], 0.56, { att: 0.7, swell: hairpin, maxCut: 900 });
  VC(sh, C.whalesRise - sh + 0.2, ['B1'], 0.5, { att: 0.6 }); CF(sh + 0.1, C.whalesRise - sh - 0.2, ['B4', 'C5'], 0.8, { att: 0.5, rel: 0.5 }); HB(sh + 0.2, C.whalesRise - sh - 0.4, ['F#4'], 0.42, { att: 0.5, swell: hairpin, maxCut: 1400 });
  // whales: awe, not menace. Open fifths in the choir, a soft horn answering the song.
  const wr = C.whalesRise, wd = C.whalesDive;
  CF(wr - 0.1, 1.6, ['E4', 'B4', 'F#5'], 0.94, { att: 0.5 }); CM(wr - 0.1, 1.6, ['E3', 'B3'], 0.8, { att: 0.5 }); VN(wr, 1.5, ['G4', 'B4'], 0.44, { att: 0.6, bright: 3 }); VC(wr, 1.5, ['E2', 'B2'], 0.5, { att: 0.5 });
  CF(wr + 1.45, 1.3, ['E4', 'B4', 'G5'], 0.94, { att: 0.4 }); CM(wr + 1.45, 1.3, ['C3', 'G3'], 0.8, { att: 0.4 }); VN(wr + 1.45, 1.3, ['G4', 'C5'], 0.44, { att: 0.4, bright: 3 }); VC(wr + 1.45, 1.3, ['C2', 'G2'], 0.5, { att: 0.4 });
  sb(wr + 1.4, 'C1', 0.4, 0.3); sb(wd - 0.1, 'B0', 0.44, 0.3);
  HB(wr + 0.5, 0.9, 'B4', 0.34, { att: 0.2, maxCut: 1800, n: 3 }); HB(wr + 1.4, 0.7, 'E5', 0.38, { att: 0.15, maxCut: 1800, n: 3 }); HB(wr + 2.1, 0.7, 'D5', 0.34, { att: 0.15, maxCut: 1800, n: 3 });
  CF(wd - 0.05, 0.6, ['D#4', 'B4', 'F#5'], 0.58, { att: 0.2, rel: 0.4 }); VC(wd - 0.05, 0.5, ['B1', 'F#2'], 0.56, { att: 0.2 });
  // the tail comes down
  const tail = wd + 0.45;
  sb(tail, 'C1', 1, 0.02); LB(tail, 0.55, ['C2', 'G2', 'C3'], 1, { att: 0.012, rel: 0.5 }); HB(tail, 0.4, ['G3', 'C4'], 0.8, { att: 0.012, rel: 0.4 }); BM(tail, 0.9, { tau: 0.8 }); TK(tail, 1, 1.5); TT(tail, 0.5, 3); sb(tail + 0.7, 'B0', 0.5, 0.2);
  cue(tail, 'whale tail: low hit');
  // bridge wing / under: a pulse has started, nobody has noticed yet
  const sb16 = 26.97;
  OST(sb16 + 0.2, 31.1, 1, (i, t, u0) => { SPIC(t, 'B1', 0.56 + 0.3 * u0, { bright: 3 }); if (i % 2 === 0) TP(t, 'B1', 0.36 + 0.3 * u0); });
  LB(sb16 + 0.3, 1.1, ['C2', 'C3'], 0.44, { att: 0.3, swell: hairpin, maxCut: 800 });
  CM(28.4, 2.7, ['B2', 'F#3'], 0.66, { att: 0.8 }); VC(28.4, 2.7, ['B2', 'C3'], 0.44, { att: 0.8, bright: 3 });
  CF(29.1, 2.0, ['B4', 'C5'], 0.42, { att: 0.8, swell: cresc });
  // lures: something is wrong. Cluster, roll, crescendo ... then nothing.
  const lu = C.lures, m = C.mawRises;
  sb(lu - 0.2, 'B0', 0.72, 0.2); sb(m - 0.42, 'B0', 0.05, 0.03);
  VN(lu, m - lu - 0.42, ['B4', 'C5', 'F5'], 0.6, { att: 0.2, rel: 0.02, trem: 14, swell: cresc, bright: 6 });
  VC(lu, m - lu - 0.42, ['B2', 'C3'], 0.66, { att: 0.2, rel: 0.02, trem: 14, swell: cresc });
  LB(lu, m - lu - 0.42, ['B1', 'C2', 'F2'], 0.74, { att: 0.3, swell: cresc, rel: 0.03 });
  CF(lu + 0.3, m - lu - 0.72, ['C5', 'F5', 'B5'], 0.7, { att: 0.5, swell: cresc, rel: 0.03 });
  ROLL(lu + 0.4, m - 0.44, 'B1', 0.2, 0.8, 15); CS(m - 0.42, 1.8, 0.1, 0.5);

  // ================================================== IV. THE BREACH
  const br = C.breach, top = C.breachTop;
  // the Leviathan theme: B C B | G
  sb(m, 'B0', 1, 0.02);
  CR(m, 0.7); TT(m, 1, 5); cue(m, 'maw rises: Leviathan theme');
  const lev = (t, ns, d, v) => { LB(t, d, ns, v, { att: 0.05, rel: 0.25, n: 7 }); CM(t, d, ns.map((n) => nm(n) + 12), v * 0.9, { att: 0.09, rel: 0.2 }); TK(t, v, 1.7); BM(t, v * 0.85, { tau: 0.85, dur: 2.4 }); };
  lev(m, ['B1', 'F#2', 'B2'], 0.86, 0.9); sb(m + 0.9, 'C1', 1); lev(m + 0.9, ['C2', 'G2', 'C3'], 0.66, 0.92); sb(m + 1.6, 'B0', 1); lev(m + 1.6, ['B1', 'F#2', 'B2'], 0.46, 0.95);
  HB(m + 0.9, 0.66, ['C5', 'G5'], 0.72, { att: 0.05 }); HB(m + 1.6, 0.46, ['B4', 'F#5'], 0.78, { att: 0.05 });
  // tutti, slow and heavy, a chord the size of the animal
  const ch = [
    [br, 'B0', GRID[B(br) + 4] - br, ['B1', 'F#2', 'B2', 'D3', 'F#3'], ['B3', 'F#4', 'B4'], ['D5', 'F#5', 'B5'], ['B2', 'F#3', 'B3'], 1],
    [GRID[B(br) + 4], 'G1', GRID[B(br) + 6] - GRID[B(br) + 4], ['G1', 'D2', 'G2', 'B2', 'D3'], ['G3', 'D4', 'B4'], ['D5', 'G5', 'B5'], ['G2', 'D3', 'B3'], 0.94],
    [GRID[B(br) + 6], 'A1', top - GRID[B(br) + 6], ['A1', 'E2', 'A2', 'C#3', 'E3'], ['A3', 'E4', 'C#5'], ['E5', 'A5', 'C#6'], ['A2', 'E3', 'C#4'], 0.97],
    [top, 'C1', GRID[B(top) + 3] - top, ['C2', 'G2', 'C3', 'E3', 'G3'], ['C4', 'G4', 'E5'], ['G5', 'C6', 'E6'], ['C3', 'G3', 'E4'], 1],
    [GRID[B(top) + 3], 'F#1', C.belly - GRID[B(top) + 3], ['F#1', 'C#2', 'F#2', 'A#2', 'C#3'], ['F#3', 'C#4', 'A#4'], ['C#5', 'F#5', 'A#5'], ['F#2', 'C#3', 'A#3'], 0.86],
  ];
  ch.forEach(([t, root, d, lo, hi, f, mm, v]) => {
    sb(t, root, 1, 0.02); LB(t, d, lo, v, { att: 0.03, rel: 0.3 }); HB(t, d, hi, v * 0.86, { att: 0.04, rel: 0.3 });
    CF(t, d, f, v * 0.92, { att: 0.1, rel: 0.3 }); CM(t, d, mm, v * 0.9, { att: 0.1, rel: 0.3 }); VN(t, d, f, v * 0.74, { att: 0.05, trem: 12, bright: 6, rel: 0.2 });
  });
  TUTTI(br, ['B0'], ['F#4'], 1, { d: 1.8, tau: 1.3, ring: 5 }); TT(br, 0.9, 6); cue(br, 'breach: tutti');
  BM(GRID[B(br) + 4], 0.86); BM(top, 1, { tau: 1.4 }); CR(top, 0.72, 5); TT(top, 0.7, 4); cue(top, 'breach top: Neapolitan C');
  // heavy taiko: DUM .. dum-dum | DUM ..
  OST(br, C.belly - 0.4, 2, (i, t) => { const n = i % 8; if (n === 0 || n === 4) TK(t, 1, 1.5); else if (n === 2 || n === 6) TK(t, 0.74, 1.3, 0.2); else if (n === 5 || n === 7) TK(t, 0.6, 1.3, -0.2); if (n % 4 === 0) TP(t, 'B1', 0.6); });
  const roots = (t) => (t < GRID[B(br) + 4] ? ['B1', 'B2'] : t < GRID[B(br) + 6] ? ['G1', 'G2'] : t < top ? ['A1', 'A2'] : t < GRID[B(top) + 3] ? ['C2', 'C3'] : ['F#1', 'F#2']);
  OST(br, C.belly - 0.1, 4, (i, t) => { const [a, b] = roots(t); SPIC(t, i % 4 === 2 ? b : a, i % 4 === 0 ? 1 : 0.68); });
  // the high horn call over the top
  HB(GRID[B(br) + 1], 1.4, ['B5'], 0.84, { att: 0.05, pan: -0.3, n: 4 }); HB(GRID[B(br) + 4], 0.95, ['B5'], 0.8, { pan: -0.3, n: 4 }); HB(GRID[B(br) + 6], 0.95, ['C#6'], 0.84, { pan: -0.3, n: 4 });
  HB(top, 1.45, ['E6'], 0.9, { pan: -0.3, n: 4 });
  // its belly slides past the windows: the score goes behind glass
  const be = C.belly;
  sb(be, 'B0', 0.7, 0.2);
  LB(be, 2.0, ['B1', 'F#2'], 0.62, { att: 0.2, swell: hairpin, maxCut: 700 }); CM(be, 2.0, ['B2', 'F#3'], 0.72, { att: 0.3 }); VC(be, 2.0, ['B2', 'C3'], 0.5, { att: 0.3, trem: 10, bright: 2.5 });
  CF(be + 0.5, 1.5, ['F#4', 'G4'], 0.42, { att: 0.5 });
  const w2 = C.bigWave, pre = w2 - 0.65;     // the hit before the swell
  sb(pre, 'C1', 1, 0.02); LB(pre, 0.55, ['C2', 'G2', 'C3'], 0.9, { att: 0.02, rel: 0.2 }); BM(pre, 0.96, { tau: 1 }); TK(pre, 1, 1.6);

  // ================================================== V. THE SWELL
  const st = C.shipStands, e2 = (st - w2) / 2;
  const cl = [[w2, 'B0', ['B1', 'F#2', 'B2', 'D3'], ['F#3', 'B3', 'D4'], 'B1', 'B2', 0.78], [w2 + e2, 'C1', ['C2', 'G2', 'C3', 'E3'], ['G3', 'C4', 'E4'], 'C2', 'C3', 0.84], [st, 'G1', ['G1', 'D2', 'G2', 'B2', 'D3'], ['G3', 'D4', 'G4', 'B4'], 'G1', 'G2', 1], [st + 2 * e2 * 0.5, 'F#1', ['F#1', 'C#2', 'F#2', 'A#2'], ['F#3', 'C#4', 'F#4', 'A#4'], 'F#1', 'F#2', 0.86]];
  cl.forEach(([t, rt, lo, hi, a, b, v], i) => {
    const d = i + 1 < cl.length ? cl[i + 1][0] - t : 49.33 - t;
    sb(t, rt, 0.95, 0.02); LB(t, d, lo, v, { att: 0.05, rel: 0.2 }); HB(t, d, hi, v * 0.84, { att: 0.06, rel: 0.2 });
    CM(t, d, hi.map((n) => nm(n) - 12), v * 0.84, { att: 0.15, rel: 0.2 }); CF(t, d, hi.map((n) => nm(n) + 12), v * 0.8, { att: 0.15, rel: 0.2 });
    TK(t, v, 1.5); BM(t, v * 0.8, { tau: 0.8, dur: 2.2 });
    OST(t, t + d, 4, (j, tt) => SPIC(tt, j % 4 === 2 ? b : a, j % 4 === 0 ? 0.92 : 0.6));
  });
  // the climbing line, a step a chord, on the strings and the top of the brass
  OST(w2, st, 4, (j, t, u0) => SPICH(t, nm('B4') + [0, 3, 7, 12][j % 4] + Math.floor(u0 * 8), 0.5 + 0.4 * u0));
  CR(st, 0.9, 5); TT(st, 1, 5); BM(st, 1, { tau: 1.3 }); HB(st, 1.0, ['D6'], 0.84, { att: 0.05, pan: -0.3, n: 4 }); cue(st, 'ship stands: G tutti');
  // fog: everything drops to the bottom of the orchestra and stays there
  const fg = 49.33, rn = C.reentry;
  sb(fg, 'B0', 1, 0.03); LB(fg, rn - fg + 0.02, ['B0', 'B1', 'F#2', 'B2'], 0.92, { att: 0.04, rel: 0.03, swell: (u0) => 0.72 + 0.28 * u0 }); CM(fg, rn - fg + 0.02, ['B2', 'F#3'], 0.8, { att: 0.2, rel: 0.03 });
  TK(fg, 1, 1.7); BM(fg, 0.9, { tau: 1 }); [1, 2, 3].forEach((d) => TK(GRID[B(fg) + d], 0.7, 1.6));
  sb(rn + 0.05, 'B0', 0, 0.015);

  // ================================================== VI. THE RETURN (the opening, come back wrong)
  const pl = C.plasma, thump = rn + 0.4;
  sb(thump, 'B0', 0.9, 0.012); sb(thump + 0.16, 'B0', 0.2, 0.04); BM(thump, 0.9, { tau: 0.3, dur: 1.2 }); TK(thump, 0.9, 1.6); LB(thump, 0.25, ['B1', 'B2', 'F#3'], 0.9, { att: 0.012, rel: 0.3 });
  sb(pl - 0.1, 'B0', 0.72, 0.25);
  CF(pl, 2.65, ['B4', 'B5'], 1, { att: 0.5 }); HB(pl + 0.1, 2.4, ['F#4', 'B4'], 0.52, { att: 0.5, swell: hairpin, maxCut: 1500 });
  LB(pl, 2.4, ['B1', 'F#2', 'B2'], 0.56, { att: 0.5, swell: cresc });
  VC(pl, 5, ['B1', 'B2'], 0.42, { att: 0.8 }); [2, 4, 5, 6].forEach((d) => { TK(GRID[B(pl) + d], 0.66, 1.6); BM(GRID[B(pl) + d], 0.56, { tau: 0.5, dur: 1.5 }); });
  CF(pl + 2.7, 1.0, ['C5', 'C6'], 0.95, { att: 0.15, rel: 0.25 }); CF(pl + 3.75, 1.6, ['B4', 'B5'], 1, { att: 0.2 });
  HB(pl + 2.7, 1.0, ['C5'], 0.52, { att: 0.2, maxCut: 1600 });
  sb(pl + 3.6, 'B0', 0.03, 0.5);              // the bass drains away
  const ps = 57.73, im = C.impact;
  CF(pl + 4.6, ps - pl - 4.6, ['F#5', 'B5', 'E6', 'A6'], 0.86, { att: 0.4 });
  // arrow in the sky: the charge music again, faster, and this time it comes for us
  sb(ps, 'C1', 0.72, 0.1); sb(ps + 0.8, 'D1', 0.76); sb(ps + 1.3, 'E1', 0.8); sb(ps + 1.8, 'F#1', 0.74); sb(59.9, 'F#1', 0.05, 0.14);
  [[ps, 'C3', 'C5', 'G5', 0.8], [ps + 0.8, 'D3', 'D5', 'A5', 0.5], [ps + 1.3, 'E3', 'E5', 'B5', 0.5], [ps + 1.8, 'F#3', 'F#5', 'C#6', 0.44]].forEach(([t, lo, a, b, d], i) => {
    VC(t, d, lo, 0.6 + i * 0.1, { att: 0.05, rel: 0.05, trem: 14 }); VN(t, d, [a, b], 0.54 + i * 0.1, { att: 0.05, rel: 0.05, trem: 14, bright: 7 });
    LB(t, d, [nm(lo) - 12, nm(lo) - 5], 0.62 + i * 0.08, { att: 0.04, rel: 0.05 });
  });
  OST(ps, 60.15, 4, (i, t, u0) => SPIC(t, i % 4 === 2 ? 'B2' : 'B1', 0.62 + 0.3 * u0));
  put(out, ps, shepard(2.5, { base: 55, octaves: 1.9, gain: 0.1, curve: 2 }, S()), { send: 0.3 });
  // near silence: one thread of harmonics, then the world stops
  VN(60.0, im - 60.0, ['B6'], 0.34, { att: 0.2, rel: 0.02, n: 3, bright: 2 });

  // ================================================== VII. IMPACT AND PIERCE
  const pq = C.pierce, pb = (n) => GRID[B(pq) + n];
  sb(im, 'C1', 1, 0.008);
  TUTTI(im, ['C1', 'C2', 'G2', 'C3', 'E3'], ['G3', 'C4', 'E4', 'G4'], 1, { d: 1.05, tau: 1.6, ring: 5 }); TT(im, 1.1, 5); AV(im, 0.8); cue(im, 'impact: tutti hit on the Neapolitan');
  CM(im, 1.0, ['C3', 'G3', 'E4'], 1, { att: 0.02, rel: 0.3 }); CF(im, 1.0, ['G5', 'C6', 'E6'], 1, { att: 0.02, rel: 0.3 });
  const up = im + 1.05;                       // the plume climbs on a dominant
  sb(up, 'F#1', 0.95, 0.02);
  LB(up, pq - up, ['F#1', 'C#2', 'F#2', 'A#2', 'C#3'], 0.92, { att: 0.05, rel: 0.02, swell: cresc }); HB(up, pq - up, ['F#3', 'C#4', 'A#4', 'C#5'], 0.8, { att: 0.05, rel: 0.02, swell: cresc });
  CM(up, pq - up, ['F#3', 'C#4'], 0.84, { att: 0.1, rel: 0.02, swell: cresc }); CF(up, pq - up, ['A#4', 'F#5', 'C#6'], 0.84, { att: 0.1, rel: 0.02, swell: cresc });
  ROLL(up, pq - 0.02, 'F#2', 0.34, 1, 17); CS(pq, 0.85, 0.1, 0.8);
  OST(up, pq - 0.01, 6, (i, t, u0) => SPIC(t, i % 2 ? 'F#2' : 'F#1', 0.7 + 0.3 * u0));
  // PIERCE: the two themes finally collide
  sb(pq, 'B0', 1, 0.006);
  TUTTI(pq, ['B0', 'B1', 'F#2', 'B2', 'D3', 'F#3'], ['B3', 'D4', 'F#4', 'B4'], 1.04, { d: pb(2) - pq, tau: 1.8, ring: 6 }); TT(pq, 1.2, 6); AV(pq, 1); AV(pq + 0.03, 0.8); cue(pq, 'pierce: the colossal hit');
  CM(pq, pb(2) - pq, ['B2', 'F#3', 'B3'], 1, { att: 0.02, rel: 0.3 }); CF(pq, pb(2) - pq, ['B4', 'F#5', 'B5', 'D6'], 1, { att: 0.02, rel: 0.3 });
  const pc = [[pb(2), 'C1', pb(4) - pb(2), ['C2', 'G2', 'C3', 'E3'], ['C4', 'G4', 'E5'], 'C2', 'C3', 0.96], [pb(4), 'G1', pb(5) - pb(4), ['G1', 'D2', 'G2', 'B2'], ['B3', 'G4', 'D5'], 'G1', 'G2', 0.92], [pb(5), 'F#1', 66.83 - pb(5), ['F#1', 'C#2', 'F#2', 'A#2'], ['A#3', 'F#4', 'C#5'], 'F#1', 'F#2', 0.9]];
  pc.forEach(([t, rt, d, lo, hi, a, b, v]) => { sb(t, rt, 1, 0.02); LB(t, d, lo, v, { att: 0.03, rel: 0.2 }); HB(t, d, hi, v * 0.88, { att: 0.04, rel: 0.2 }); CM(t, d, hi.map((n) => nm(n) - 12), v * 0.86, { att: 0.08, rel: 0.2 }); CF(t, d, hi.map((n) => nm(n) + 12), v * 0.84, { att: 0.08, rel: 0.2 }); OST(t, t + d, 4, (j, tt) => SPIC(tt, j % 4 === 2 ? b : a, j % 4 === 0 ? 0.92 : 0.6)); });
  OST(pq, pb(2), 4, (j, tt) => SPIC(tt, j % 4 === 2 ? 'B2' : 'B1', j % 4 === 0 ? 1 : 0.7));
  OST(pq, 66.7, 1, (b, t) => TK(t, b % 4 === 0 ? 1 : b % 2 === 0 ? 0.84 : 0.68, b % 4 === 0 ? 1.5 : 1.2, b % 2 ? 0.15 : -0.15));
  // the Arrow theme turned over, falling, high above it
  [[pb(1), 'B5'], [pb(2), 'C6'], [pb(3), 'B5'], [pb(4), 'G5'], [pb(5), 'F#5']].forEach(([t, n], i, a) => HB(t, (i + 1 < a.length ? a[i + 1][0] : 66.8) - t, [n], 0.88, { att: 0.04, pan: -0.3, n: 4 }));
  // the wide shot: it all drops away for one breath
  const so = 66.83, mo = 68.17, tp = C.tipOut, rb = C.rockBurst;
  sb(so, 'B0', 0.5, 0.1); CM(so, mo - so, ['B2', 'F#3'], 0.7, { att: 0.3 }); VC(so, mo - so, ['B1', 'B2'], 0.56, { att: 0.3, trem: 12 }); CF(so + 0.2, mo - so - 0.2, ['B4', 'C5'], 0.52, { att: 0.4, swell: cresc }); LB(so, mo - so, ['B1', 'F#2'], 0.6, { att: 0.3, swell: hairpin, maxCut: 900 });
  sb(mo, 'C1', 0.95, 0.03); LB(mo, tp - mo, ['C2', 'G2', 'C3'], 0.86, { att: 0.04, rel: 0.02, swell: cresc }); CM(mo, tp - mo, ['C3', 'G3'], 0.8, { att: 0.05, rel: 0.02, swell: cresc });
  OST(mo, tp - 0.01, 6, (i, t, u0) => SPIC(t, i % 2 ? 'C3' : 'C2', 0.66 + 0.3 * u0)); ROLL(mo + 0.2, tp - 0.02, 'C2', 0.3, 0.9, 16);
  // TIP OUT and ROCK BURST
  sb(tp, 'G1', 1, 0.01); TUTTI(tp, ['G1', 'D2', 'G2', 'B2', 'D3'], ['G3', 'D4', 'B4'], 0.98, { d: 0.8, tau: 1.0 }); AV(tp, 1); cue(tp, 'tip out: tutti G');
  sb(rb, 'B0', 1, 0.01); TUTTI(rb, ['B0', 'B1', 'F#2', 'B2', 'D3'], ['F#3', 'B3', 'D4', 'F#4'], 1.02, { d: 1.05, tau: 1.5, ring: 5 }); TT(rb, 1, 4); cue(rb, 'rock burst: tutti Bm');
  CF(rb, 1, ['F#5', 'B5', 'D6'], 0.96, { att: 0.02, rel: 0.5 }); CM(rb, 1, ['B2', 'F#3', 'B3'], 0.96, { att: 0.02, rel: 0.5 });
  OST(rb + 0.05, rb + 1.1, 2, (i, t) => TK(t, 0.8, 1.4));
  // elegy: the whale song, taken up by the orchestra
  const rt = 72.3, sb2 = C.surfaceBurst;
  sb(rb + 1.6, 'B0', 0.55, 0.3); sb(rt, 'G1', 0.6, 0.2); sb(rt + 1.25, 'E1', 0.6, 0.2);
  VC(rb + 1, rt - rb - 1, ['B1', 'F#2'], 0.5, { att: 0.3 }); LB(rb + 1.1, rt - rb - 1.1, ['B1', 'F#2'], 0.5, { att: 0.3, swell: dim, maxCut: 900 });
  CF(rt, 1.25, ['B4', 'D5', 'G5'], 0.66, { att: 0.3 }); CM(rt, 1.25, ['G2', 'D3', 'B3'], 0.68, { att: 0.3 }); VC(rt, 1.25, ['G2', 'D3'], 0.54, { att: 0.3 });
  CF(rt + 1.25, 1.2, ['B4', 'E5', 'G5'], 0.66, { att: 0.3 }); CM(rt + 1.25, 1.2, ['E2', 'B2', 'B3'], 0.68, { att: 0.3 }); VC(rt + 1.25, 1.2, ['E2', 'B2'], 0.54, { att: 0.3 });
  VN(rt + 0.1, 0.8, 'B5', 0.7, { att: 0.15, bright: 4 }); VN(rt + 0.9, 0.7, 'E6', 0.74, { att: 0.1, bright: 4 }); VN(rt + 1.6, 0.6, 'D6', 0.7, { att: 0.1, bright: 4 }); VN(rt + 2.2, 0.5, 'B5', 0.64, { att: 0.1, bright: 4 });
  HB(rt + 0.1, 0.8, 'B4', 0.56, { att: 0.15, maxCut: 2400, n: 4 }); HB(rt + 0.9, 0.7, 'E5', 0.62, { att: 0.1, maxCut: 2400, n: 4 }); HB(rt + 1.6, 0.6, 'D5', 0.58, { att: 0.1, maxCut: 2400, n: 4 }); HB(rt + 2.2, 0.5, 'B4', 0.52, { att: 0.1, maxCut: 2400, n: 4 });

  // ================================================== VIII. THE MOUNTAIN AND THE WALL
  const fp0 = C.flip, cr = C.crash;
  sb(sb2 - 0.1, 'F#1', 0.84, 0.15);
  LB(sb2 - 0.1, fp0 - sb2 + 0.1, ['F#1', 'C#2', 'F#2', 'A#2'], 0.92, { att: 0.2, swell: cresc, rel: 0.02 }); HB(sb2 + 0.4, fp0 - sb2 - 0.4, ['C#4', 'F#4', 'A#4'], 0.78, { att: 0.2, swell: cresc, rel: 0.02 });
  CM(sb2, fp0 - sb2, ['F#2', 'C#3', 'A#3'], 0.84, { att: 0.3, swell: cresc, rel: 0.02 }); CF(sb2 + 0.4, fp0 - sb2 - 0.4, ['A#4', 'C#5', 'F#5'], 0.8, { att: 0.3, swell: cresc, rel: 0.02 });
  ROLL(sb2 + 0.3, fp0 - 0.02, 'F#2', 0.3, 1, 16); CS(fp0, 1.4, 0.1, 0.8);
  OST(sb2 + 0.2, fp0 - 0.01, 4, (i, t, u0) => { SPIC(t, i % 2 ? 'F#2' : 'F#1', 0.6 + 0.36 * u0); SPICH(t, nm('F#4') + (i % 3) * 5 + Math.floor(u0 * 12), 0.4 + 0.5 * u0); });
  put(out, sb2 + 0.2, shepard(fp0 - sb2 - 0.2, { base: 55, octaves: 1.6, gain: 0.08, curve: 2 }, S()), { send: 0.3 });
  const fin = [[fp0, 'G1', 1, ['G1', 'D2', 'G2', 'B2', 'D3'], ['G3', 'D4', 'B4'], ['D5', 'G5', 'B5'], 0.98], [fp0 + 1, 'A1', 1, ['A1', 'E2', 'A2', 'C#3', 'E3'], ['A3', 'E4', 'C#5'], ['E5', 'A5', 'C#6'], 1]];
  fin.forEach(([t, rt0, d, lo, hi, f, v]) => { sb(t, rt0, 1, 0.012); TUTTI(t, lo, hi, v, { d, tau: 0.9 }); CF(t, d, f, v, { att: 0.04, rel: 0.2 }); CM(t, d, hi.map((n) => nm(n) - 12), v, { att: 0.04, rel: 0.2 }); VN(t, d, f, v * 0.8, { att: 0.04, trem: 13, bright: 7, rel: 0.1 }); });
  OST(fp0, cr - 0.01, 4, (i, t) => SPIC(t, (t < fp0 + 1 ? ['G1', 'G2'] : ['A1', 'A2'])[i % 4 === 2 ? 1 : 0], i % 4 === 0 ? 1 : 0.7));
  OST(fp0 + 0.1, cr - 0.05, 2, (i, t) => TK(t, i % 2 ? 0.72 : 0.9, 1.3));
  // the wall: B major, the last brightness, swallowed by the water
  const fh = GRID[B(cr) + 6], hold = fh - cr - 0.03, lo3 = ['B0', 'B1', 'F#2', 'B2', 'D#3', 'F#3'], hi3 = ['B3', 'D#4', 'F#4', 'B4'], f3 = ['D#5', 'F#5', 'B5', 'D#6'];
  sb(cr, 'B0', 1, 0.01); cue(cr, 'crash: B major');
  TUTTI(cr, lo3, hi3, 1.04, { d: hold, tau: 2, ring: 7 }); TT(cr, 1.3, 6); CF(cr, hold, f3, 1, { att: 0.04, rel: 0.06 }); CM(cr, hold, ['B2', 'F#3', 'B3', 'D#4'], 1, { att: 0.04, rel: 0.06 }); VN(cr, hold, f3, 0.82, { att: 0.04, trem: 13, bright: 7, rel: 0.05 });
  const a2 = 0.62;
  HB(cr + 0.5, a2, ['B4', 'B5'], 0.96, { att: 0.04, n: 6 }); HB(cr + 0.5 + a2, a2, ['F#5', 'F#6'], 0.96, { att: 0.04, n: 6, maxCut: 7400 }); HB(cr + 0.5 + 2 * a2, a2 * 0.5, ['A#5', 'A#6'], 0.92, { att: 0.04, n: 6, maxCut: 7400 }); HB(cr + 0.5 + 2.5 * a2, fh - (cr + 0.5 + 2.5 * a2) - 0.03, ['B5', 'B6'], 1, { att: 0.05, n: 6, maxCut: 7400, rel: 0.06 });
  OST(cr, fh - 0.05, 1, (i, t) => TK(t, 0.9, 1.4, (i % 2) * 0.3 - 0.15));
  OST(cr, fh - 0.05, 4, (i, t) => SPIC(t, i % 4 === 2 ? 'B2' : 'B1', i % 4 === 0 ? 1 : 0.7));
  [cr + 2, cr + 3].forEach((t) => { BM(t, 0.9); CR(t, 0.6, 3); });
  TUTTI(fh, ['B0', 'B1', 'F#2', 'B2'], ['B3', 'F#4', 'B4'], 1, { d: 0.26, tau: 0.8, ring: 3 }); TT(fh, 1, 3); cue(fh, 'last accent');
  CM(fh, 0.26, ['B2', 'F#3', 'B3'], 1, { att: 0.02, rel: 0.4 }); CF(fh, 0.26, ['B4', 'F#5', 'B5'], 1, { att: 0.02, rel: 0.4 }); sb(fh, 'B0', 0.9, 0.01); sb(fh + 0.32, 'B0', 0, 0.12);

  // ---- sub pedal
  SUB.sort((a, b) => a[0] - b[0]);
  const sub = new Float32Array(N); let k = 0, lvl = 0, tgt = 0, coef = 0.001, f = mtof(nm('B1')), ftg = f, ph = 0, bi = 0, pump = 1, pmp = 1;
  const pumpA = new Float32Array(N), phA = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if ((i & 15) === 0) { const t = i / SR; while (k < SUB.length && SUB[k][0] <= t) { ftg = mtof(SUB[k][1] < 29 ? SUB[k][1] + 12 : SUB[k][1]); tgt = SUB[k][2]; coef = 1 - Math.exp(-16 / (Math.max(0.004, SUB[k][3]) * SR)); k++; }
      while (bi + 1 < GRID.length && GRID[bi + 1] <= t + 0.04) bi++;
      const dt = t - GRID[bi], fl = pws(PUMP, t); pump = fl + (1 - fl) * (dt < 0 ? smooth((dt + 0.04) / 0.04) : Math.exp(-dt / 0.17)); }
    lvl += (tgt - lvl) * (coef / 16); f += (ftg - f) * 0.002; ph += f / SR; if (ph > 1) ph -= 1; phA[i] = ph;
    sub[i] = Math.tanh((Math.sin(TAU * ph) + 0.28 * Math.sin(2 * TAU * ph) + 0.1 * Math.sin(3 * TAU * ph)) * lvl * pmp * 1.5) * 0.4;
    pmp += (pump - pmp) * 0.02; pumpA[i] = pmp;
  }
  put(out, 0, sub, { gain: 1, send: 0 });

  // ---- the heartbeat: on every beat of the film, in the key of the pedal. It rests on the big hits
  // (they carry their own low end) and on the held breaths.
  const rootAt = (t) => { let n = SUB[0][1]; for (const s of SUB) { if (s[0] > t + 0.02) break; if (s[2] > 0.02) n = s[1]; } return n; };
  const HITS = [C.drawHold, 4.37, 9.17, C.chargeFull, C.reentry + 0.4, C.release, w, C.sonicFlash, C.whalesDive + 0.45, C.mawRises, C.breach, C.breachTop, C.bigWave - 0.65, C.shipStands, 49.33, C.impact, C.pierce, C.tipOut, C.rockBurst, C.flip, C.crash];
  for (let i = 0; i < GRID.length - 1; i++) {
    const t = GRID[i], v = pws(PULSE, t);
    if (v < 0.02 || HITS.some((h) => Math.abs(h - t) < 0.14)) continue;
    const acc = (t > C.plasma && t < C.impact) || (t > C.chargeStart && t < 11.8) ? (i % 3 === 0 ? 1 : 0.7) : (i % 2 === 0 ? 1 : 0.82);
    const m0 = rootAt(t), bn = m0 < 29 ? m0 + 12 : m0;       // lands between 45 and 90 Hz
    // locked to the pedal's phase (less the pitch drop's head start), so a beat can never cancel it
    put(out, t - 0.012, heart(mtof(bn), v * acc, S(), phA[Math.max(0, Math.round((t - 0.012) * SR))] - 0.0064 * mtof(bn)), { gain: 1, send: 0.05 });
    SPIC(t, bn + 12, 0.8 * v * acc, { bright: 3, rel: 0.16 });
  }
  // ================================================== mix the sections
  const vowelF = (t) => (t < 16 ? ['ah', 'oh', 0] : t < 21.6 ? ['ah', 'oo', smooth((t - 16) / 3)] : t < 31 ? ['oo', 'oh', 0.2] : t < 33 ? ['oh', 'ah', smooth(t - 31)] : t < 52 ? ['ah', 'eh', 0.15] : t < 60 ? ['oh', 'ah', 0.3] : ['ah', 'eh', 0.2]);
  const vowelM = (t) => (t < 23 ? ['ah', 'oh', 0.3] : t < 33 ? ['oo', 'oh', 0.4] : ['ah', 'oh', 0.2]);
  choirFormants(sec.f, 'f', vowelF, 0.014, 21); choirFormants(sec.m, 'm', vowelM, 0.012, 22);
  const hpf = (s, f) => { for (const ch0 of [s.L, s.R]) { const b = Biquad.hp(f, 0.7); for (let i = 0; i < N; i++) ch0[i] = b.run(ch0[i]); } };
  hpf(sec.lo, 28); hpf(sec.vc, 36); hpf(sec.m, 70); hpf(sec.f, 150); hpf(sec.vn, 120); hpf(sec.hi, 90);
  // the low orchestra breathes with the pulse, the way the pedal does
  const breathe = (x, d) => { for (let i = 0; i < N; i++) { const g = 1 - d * (1 - pumpA[i]); x.L[i] *= g; x.R[i] *= g; } };
  breathe(sec.lo, 0.8); breathe(sec.vc, 0.55); breathe(sec.m, 0.3);
  // many players in one room: the straight lines of the partials smear into a section
  ensemble(sec.hi.L, sec.hi.R, { seed: 1, depth: 0.0011 }); ensemble(sec.f.L, sec.f.R, { seed: 2, depth: 0.0018 }); ensemble(sec.m.L, sec.m.R, { seed: 3, depth: 0.0018 }); ensemble(sec.vn.L, sec.vn.R, { seed: 4, depth: 0.0015 });
  // the choir is a colour, not the lead: the formant bank has a peak gain of Q, so it comes way down;
  // the strings carry the drive and the low brass carries the weight
  const MIX = { lo: 1.3, hi: 1.7, f: 0.26, m: 0.5, vn: 3.2, vc: 4.4 };
  put2(out, 0, sec.lo.L, sec.lo.R, { gain: MIX.lo, send: 0.3 });
  put2(out, 0, sec.hi.L, sec.hi.R, { gain: MIX.hi, send: 0.5 });
  put2(out, 0, sec.f.L, sec.f.R, { gain: MIX.f, send: 0.75 });
  put2(out, 0, sec.m.L, sec.m.R, { gain: MIX.m, send: 0.6 });
  put2(out, 0, sec.vn.L, sec.vn.R, { gain: MIX.vn, send: 0.5 });
  put2(out, 0, sec.vc.L, sec.vc.R, { gain: MIX.vc, send: 0.35 });

  report.sort((a, b) => a[0] - b[0]);
  return report;
}
