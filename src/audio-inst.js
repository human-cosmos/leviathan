// Sound department — the orchestra of LEVIATHAN. Everything is modelled in pure
// JS so a render is sample-identical: brass sections, choir, strings, taiko,
// timpani, trailer booms, cymbals, tam-tam, anvils, Shepard risers.
import { Rng, clamp, smooth } from './util.js';
import { SR, TAU, mtof, SVF, Noise, Drift, ping, panGains } from './audio-dsp.js';

const C2F = Math.LN2 / 1200;
const blep = (t, dt) => { if (t < dt) { const x = t / dt; return x + x - x * x - 1; } if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; } return 0; };
export const section = (n) => ({ L: new Float32Array(n), R: new Float32Array(n) });

// A unison stack of band-limited saws: every player has their own detune, vibrato,
// seat in the section and start lag. env(tt) is the amplitude, pm(tt) pitch in semitones.
export function stack(L, R, t0, dur, m, o) {
  const f0 = mtof(m), nv = o.n ?? 4, r = new Rng(o.seed ?? 1);
  const i0 = Math.max(0, Math.round(t0 * SR)), i1 = Math.min(L.length, Math.round((t0 + dur) * SR));
  if (i1 <= i0) return;
  const base = (i0 - t0 * SR) / SR;
  const V = [];
  for (let k = 0; k < nv; k++) {
    const u = nv > 1 ? (k / (nv - 1)) * 2 - 1 : 0, [gl, gr] = panGains((o.pan ?? 0) + u * (o.spread ?? 0.5));
    V.push({ ph: r.next(), det: u * (o.det ?? 9) + (r.next() - 0.5) * (o.jit ?? 4), gl, gr, lag: Math.round(r.next() * (o.lag ?? 0.02) * SR), vr: (o.vibHz ?? 5) * (0.9 + 0.2 * r.next()), vp: r.next() * TAU, inc: f0 / SR });
  }
  const vd = o.vib ?? 6, vdel = o.vibDelay ?? 0.3, env = o.env, pm = o.pm, tri = o.tri ?? 0, norm = 1 / Math.sqrt(nv);
  let g = env(base) * norm, dg = 0;
  for (let i = i0; i < i1; i++) {
    const c = i - i0;
    if ((c & 31) === 0) {
      const tt = base + c / SR, p = pm ? pm(tt) * 100 : 0, vb = vd * smooth(tt / vdel);
      for (let v = 0; v < nv; v++) { const q = V[v]; q.inc = f0 * Math.exp((q.det + p + vb * Math.sin(TAU * q.vr * tt + q.vp)) * C2F) / SR; }
      dg = (env(tt + 32 / SR) * norm - g) / 32;
    }
    let sl = 0, sr = 0;
    for (let v = 0; v < nv; v++) {
      const q = V[v]; if (c < q.lag) continue;
      let p = q.ph + q.inc; if (p >= 1) p -= 1; q.ph = p;
      let s = 2 * p - 1 - blep(p, q.inc);
      if (tri) s = s * (1 - tri) + tri * (1 - 2 * Math.abs(s));
      sl += s * q.gl; sr += s * q.gr;
    }
    L[i] += sl * g; R[i] += sr * g; g += dg;
  }
}

// ---- brass: the filter opens with the breath, the tone tears at ff.
// o.swell(u) (0..1 across the note) reshapes dynamics into fp / crescendo.
export function brassNote(sec, t0, dur, m, vel, o = {}) {
  const f0 = mtof(m), rel = o.rel ?? 0.32, att = o.att ?? (0.045 + 0.14 * (1 - vel)), tot = dur + rel + 0.04;
  const swell = o.swell, len = Math.ceil(tot * SR), tL = new Float32Array(len), tR = new Float32Array(len), seed = o.seed ?? 1;
  const dyn = (tt) => (swell ? swell(clamp(tt / dur)) : 1);
  const env = (tt) => (tt < att ? tt / att : 1) * (tt > dur ? Math.exp(-(tt - dur) / (rel * 0.4)) : 1) * (0.55 + 0.45 * dyn(tt)) * (tt > dur + rel ? Math.max(0, 1 - (tt - dur - rel) / 0.04) : 1);
  stack(tL, tR, 0, tot, m, { n: o.n ?? 5, det: o.det ?? 7, spread: o.spread ?? 0.35, pan: o.pan ?? 0, vib: o.vib ?? 3.5, vibDelay: 0.6, vibHz: 4.6, lag: o.lag ?? 0.03, env, seed, pm: (tt) => -(o.scoop ?? 0.55) * Math.exp(-tt / 0.045) });
  const fc = clamp(f0 * (1.7 + 8 * vel * vel), 260, o.maxCut ?? 6200), floor = f0 * 1.15;
  const a = new SVF(fc, 0.8), b = new SVF(fc, 0.8), drive = 1.1 + (o.drive ?? 3.2) * vel * vel, nd = 1 / Math.tanh(drive);
  const out = (o.gain ?? 0.13) * vel, s0 = Math.round(t0 * SR), n = sec.L.length;
  const nz = new Noise(seed + 31), blat = new SVF(Math.min(5000, f0 * 3.2), 1.6), blatN = Math.round(0.06 * SR);
  for (let i = 0; i < len; i++) {
    const j = s0 + i; if (j >= n) break;
    if ((i & 63) === 0) {
      const tt = i / SR;
      let k = tt < att * 1.5 ? Math.pow(tt / (att * 1.5), 1.4) : 1 - 0.22 * smooth((tt - att * 1.5) / 0.7);
      k *= 0.45 + 0.55 * dyn(tt);
      if (tt > dur) k *= Math.exp(-(tt - dur) / (rel * 0.6));
      const f = floor + (fc - floor) * k; a.set(f, 0.8); b.set(f, 0.8);
    }
    let bl = 0;
    if (i < blatN) { blat.run(nz.white()); bl = blat.bp * 0.5 * vel * Math.exp(-i / (0.016 * SR)); }
    a.run(tL[i] + bl); b.run(tR[i] + bl);
    if (j >= 0) { sec.L[j] += Math.tanh(a.lp * drive) * nd * out; sec.R[j] += Math.tanh(b.lp * drive) * nd * out; }
  }
}

// ---- strings: a section of bowed saws; o.trem adds measured tremolo (strokes per second)
export function stringNote(sec, t0, dur, m, vel, o = {}) {
  const f0 = mtof(m), att = o.att ?? 0.25, rel = o.rel ?? 0.4, tot = dur + rel, swell = o.swell, trem = o.trem ?? 0, seed = o.seed ?? 1;
  const tr = new Drift(seed + 3, 6), len = Math.ceil(tot * SR), tL = new Float32Array(len), tR = new Float32Array(len);
  const env = (tt) => {
    let e = (tt < att ? tt / att : 1) * (tt > dur ? Math.max(0, 1 - (tt - dur) / rel) : 1);
    e *= swell ? 0.15 + 0.85 * swell(clamp(tt / dur)) : 1;
    if (trem) { const ph = (tt * trem + 0.25 * tr.at(tt)) % 1; e *= 0.45 + 0.55 * Math.pow(Math.max(0, 1 - ph * 1.6), 1.6); }
    return e;
  };
  stack(tL, tR, 0, tot, m, { n: o.n ?? 5, det: o.det ?? 10, jit: 5, spread: o.spread ?? 0.45, pan: o.pan ?? 0, vib: o.vib ?? 7, vibDelay: 0.25, vibHz: 5.4, lag: att < 0.05 ? 0.008 : 0.05, env, seed });
  const fc = clamp(f0 * (o.bright ?? 4.5) * (0.6 + 0.6 * vel), 500, o.maxCut ?? 7200), a = new SVF(fc, 0.72), b = new SVF(fc, 0.72);
  const g = (o.gain ?? 0.09) * vel, s0 = Math.round(t0 * SR), n = sec.L.length;
  for (let i = 0; i < len; i++) { const j = s0 + i; if (j >= n) break; a.run(tL[i]); b.run(tR[i]); if (j >= 0) { sec.L[j] += a.lp * g; sec.R[j] += b.lp * g; } }
}

// ---- choir: voices go into a section buffer; the shared formant bank makes them sing
export function choirNote(sec, t0, dur, m, vel, o = {}) {
  const att = o.att ?? 0.5, rel = o.rel ?? 0.7, tot = dur + rel, swell = o.swell;
  const env = (tt) => (o.gain ?? 0.11) * vel * (tt < att ? smooth(tt / att) : 1) * (tt > dur ? Math.max(0, 1 - (tt - dur) / rel) : 1) * (swell ? 0.2 + 0.8 * swell(clamp(tt / dur)) : 1);
  stack(sec.L, sec.R, t0, tot, m, { n: o.n ?? 7, det: o.det ?? 14, jit: 7, spread: o.spread ?? 0.7, pan: o.pan ?? 0, vib: o.vib ?? 16, vibDelay: 0.5, vibHz: 5.1, lag: 0.08, env, seed: o.seed ?? 1, tri: 0.15 });
}
const VOWEL = {
  f: { ah: [[830, 1], [1180, 0.55], [2850, 0.28], [3850, 0.14]], oh: [[470, 1], [830, 0.5], [2830, 0.14], [3800, 0.08]], oo: [[350, 1], [720, 0.32], [2700, 0.07], [3800, 0.04]], eh: [[560, 1], [1750, 0.42], [2600, 0.3], [3600, 0.12]] },
  m: { ah: [[660, 1], [1080, 0.5], [2650, 0.2], [2950, 0.12]], oh: [[400, 1], [800, 0.42], [2600, 0.1], [2850, 0.06]], oo: [[300, 1], [650, 0.3], [2300, 0.05], [2800, 0.03]], eh: [[420, 1], [1700, 0.34], [2500, 0.2], [3000, 0.1]] },
};
// in place: vowelAt(t) -> [vowelA, vowelB, mix]
export function choirFormants(sec, kind, vowelAt, breath = 0.012, seed = 7) {
  const T = VOWEL[kind], Lb = [0, 1, 2, 3].map(() => new SVF(800, 7)), Rb = [0, 1, 2, 3].map(() => new SVF(800, 7));
  const nz = new Noise(seed), n = sec.L.length, gn = [1, 1, 1, 1];
  for (let i = 0; i < n; i++) {
    if ((i & 255) === 0) {
      const [a, b, x] = vowelAt(i / SR);
      for (let k = 0; k < 4; k++) {
        const f = T[a][k][0] + (T[b][k][0] - T[a][k][0]) * x, q = 5 + f / 500;
        Lb[k].set(f, q); Rb[k].set(f, q); gn[k] = T[a][k][1] + (T[b][k][1] - T[a][k][1]) * x;
      }
    }
    const xL = sec.L[i], xR = sec.R[i], e = (Math.abs(xL) + Math.abs(xR)) * breath * nz.white();
    let oL = 0, oR = 0;
    for (let k = 0; k < 4; k++) { Lb[k].run(xL + e); Rb[k].run(xR + e); oL += Lb[k].bp * gn[k]; oR += Rb[k].bp * gn[k]; }
    sec.L[i] = oL; sec.R[i] = oR;
  }
}

// ---- taiko: pitch-dropping membrane, stick crack
export function taiko(vel, seed = 1, big = 1) {
  const len = Math.ceil(1.5 * SR), out = new Float32Array(len), nz = new Noise(seed), f = new SVF(1800 + vel * 2200, 0.8), lo = new SVF(420, 0.8);
  const f0 = (74 + (seed % 5) * 1.5) / big;
  let p1 = 0, p2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR, d = 1 + 1.9 * Math.exp(-t / 0.02);
    p1 += f0 * d / SR; p2 += f0 * 1.59 * (1 + 0.8 * Math.exp(-t / 0.018)) / SR;
    const body = Math.sin(TAU * p1) * Math.exp(-t / (0.3 * big)) + 0.36 * Math.sin(TAU * p2) * Math.exp(-t / 0.095);
    f.run(nz.white()); lo.run(nz.white());
    const crack = f.bp * 0.42 * Math.exp(-t / 0.007) + lo.lp * 0.85 * Math.exp(-t / 0.04);
    out[i] = Math.tanh((body * 0.95 + crack) * (1.1 + vel)) * 0.55 * vel * (i > len - 1200 ? (len - i) / 1200 : 1);
  }
  return out;
}
export function timpani(m, vel, seed) {
  const f0 = mtof(m), out = new Float32Array(Math.ceil(3.2 * SR));
  ping(out, 0, f0, 0.6 * vel, [[0.62, 0.5, 0.3], [1, 1, 2.6], [1.5, 0.55, 1.7], [1.98, 0.35, 1.25], [2.44, 0.22, 0.9], [2.9, 0.12, 0.6]], seed * 0.37);
  const nz = new Noise(seed), f = new SVF(900 + vel * 1500, 0.7);
  for (let i = 0; i < 1400; i++) { f.run(nz.white()); out[i] += f.lp * 0.3 * vel * Math.exp(-i / 260); }
  return out;
}
// ---- trailer boom: sweeping sine, saturated, long sub tail
export function boom(o = {}, seed = 1) {
  const dur = o.dur ?? 3.5, len = Math.ceil(dur * SR), out = new Float32Array(len), f0 = o.f0 ?? 110, f1 = Math.max(o.f1 ?? 43, 41), sw = o.sweep ?? 0.09, tau = o.tau ?? 0.9, drive = o.drive ?? 2.2;
  const nz = new Noise(seed), lo = new SVF(o.nf ?? 260, 0.7);
  let p = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR, f = f1 + (f0 - f1) * Math.exp(-t / sw); p += f / SR;
    lo.run(nz.white());
    const e = Math.exp(-t / tau) * (t < 0.003 ? t / 0.003 : 1) * (i > len - 2400 ? (len - i) / 2400 : 1);
    out[i] = Math.tanh(Math.sin(TAU * p) * drive * e + lo.lp * 1.7 * Math.exp(-t / 0.06)) * (o.gain ?? 0.8) * Math.min(1, e * 2.5);
  }
  return out;
}
// ---- heart: the low pulse under the film. A soft-edged bass stroke with a fast thud and a body
// that breathes out; the harmonics are what make it audible on small speakers.
export function heart(f0, vel, seed = 1, p0 = 0) {
  const len = Math.ceil(0.62 * SR), out = new Float32Array(len), nz = new Noise(seed), lo = new SVF(170, 0.8);
  let p = p0;
  for (let i = 0; i < len; i++) {
    const t = i / SR, f = f0 * (1 + 0.32 * Math.exp(-t / 0.02)); p += f / SR;
    lo.run(nz.white());
    const a = smooth(t / 0.022), e = a * (0.72 * Math.exp(-t / 0.13) + 0.28 * Math.exp(-t / 0.42)), s = Math.sin(TAU * p);
    const x = (s + 0.42 * Math.sin(2 * TAU * p) + 0.2 * Math.sin(3 * TAU * p + 0.6)) * e * (1.2 + 1.1 * vel) + lo.lp * 1.3 * Math.exp(-t / 0.03);
    out[i] = Math.tanh(x) * 0.62 * vel * (i > len - 1600 ? (len - i) / 1600 : 1);
  }
  return out;
}
// ---- crash cymbal: dense inharmonic shimmer over filtered noise
export function crash(vel, seed = 1, ring = 3.4) {
  const len = Math.ceil(ring * 1.25 * SR), out = new Float32Array(len), nz = new Noise(seed), r = new Rng(seed);
  const hp = new SVF(3400, 0.7), b1 = new SVF(5200, 2.2), b2 = new SVF(8700, 2.6), b3 = new SVF(2900, 2);
  for (let i = 0; i < len; i++) {
    const t = i / SR, w = nz.white();
    hp.run(w); b1.run(w); b2.run(w); b3.run(w);
    const e = Math.exp(-t / (ring * 0.28)), a = t < 0.002 ? t / 0.002 : 1;
    out[i] = (hp.hp * (0.28 * e + 0.5 * Math.exp(-t / 0.05)) + (b1.bp * 0.6 + b2.bp * 0.5) * e + b3.bp * 0.4 * Math.exp(-t / (ring * 0.15))) * a * vel * 0.34;
  }
  for (let k = 0; k < 30; k++) ping(out, Math.round(r.next() * 200), r.range(900, 9000), 0.012 * vel, [[1, 1, r.range(0.3, ring * 0.5)]], r.next() * 6);
  return out;
}
// ---- swell on a suspended cymbal, peaking `rise` seconds in
export function cymbalSwell(rise, ring, vel, seed) {
  const len = Math.ceil((rise + ring) * SR), out = new Float32Array(len);
  const nz = new Noise(seed), b1 = new SVF(4300, 3), b2 = new SVF(6900, 4), b3 = new SVF(9600, 2), hp = new SVF(2800, 0.7);
  for (let i = 0; i < len; i++) {
    const t = i / SR, w = nz.white();
    b1.run(w); b2.run(w); b3.run(w); hp.run(w);
    const e = t < rise ? (Math.exp(3.2 * t / rise) - 1) / (Math.exp(3.2) - 1) : Math.exp(-(t - rise) / (ring * 0.3));
    out[i] = (b1.bp * 0.6 + b2.bp * 0.5 + b3.bp * 0.35 + hp.hp * 0.12) * e * vel * 0.22;
  }
  return out;
}
// ---- tam-tam: slow bloom of low inharmonic metal
export function tamtam(vel, seed = 1, dur = 6) {
  const len = Math.ceil(dur * SR), out = new Float32Array(len), r = new Rng(seed), nz = new Noise(seed), bp = new SVF(620, 0.9), bh = new SVF(3200, 1.2);
  for (let k = 0; k < 42; k++) ping(out, 0, 70 * Math.pow(46, r.next()), 0.014 * vel, [[1, 1, r.range(1.6, dur * 0.8)]], r.next() * 6);
  for (let i = 0; i < len; i++) {
    const t = i / SR, w = nz.white(); bp.run(w); bh.run(w);
    const bloom = smooth(t / 0.22) * Math.exp(-t / (dur * 0.26));
    out[i] = (out[i] + (bp.bp * 0.4 + bh.bp * 0.22) * bloom * vel * 0.34) * (t < 0.003 ? t / 0.003 : 1) * (i > len - 4800 ? (len - i) / 4800 : 1);
  }
  return out;
}
// ---- anvil: a hard struck steel accent
export function anvil(vel, seed = 1) {
  const out = new Float32Array(Math.ceil(2.2 * SR)), nz = new Noise(seed), f = new SVF(5200, 1);
  ping(out, 0, 1046, 0.28 * vel, [[1, 1, 1.1], [1.52, 0.62, 0.8], [2.76, 0.5, 0.5], [3.4, 0.3, 0.36], [5.2, 0.2, 0.16], [8.3, 0.1, 0.07]], seed);
  for (let i = 0; i < 700; i++) { f.run(nz.white()); out[i] += f.bp * 0.5 * vel * Math.exp(-i / 90); }
  return out;
}
// ---- Shepard riser: endless climb, octave stack under a sine window
export function shepard(dur, o = {}, seed = 1) {
  const len = Math.ceil(dur * SR), out = new Float32Array(len), nv = o.voices ?? 7, oct = o.octaves ?? 2.2, fb = o.base ?? 55, r = new Rng(seed);
  const ph = new Float64Array(nv).map(() => r.next());
  for (let i = 0; i < len; i++) {
    const u = i / len, t = i / SR; let s = 0;
    for (let v = 0; v < nv; v++) {
      const x = ((v + u * oct) % nv) / nv, f = fb * Math.pow(2, x * nv);
      ph[v] += f / SR; ph[v] -= Math.floor(ph[v]);
      const w = Math.sin(Math.PI * x);
      s += (Math.sin(TAU * ph[v]) + 0.3 * Math.sin(2 * TAU * ph[v])) * w * w;
    }
    out[i] = s * Math.pow(u, o.curve ?? 2) * (o.gain ?? 0.18) * (i > len - 120 ? (len - i) / 120 : 1) * (t < 0.01 ? t / 0.01 : 1);
  }
  return out;
}
