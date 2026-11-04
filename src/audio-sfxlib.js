// Sound department — synthesis for LEVIATHAN's effects. Every function is
// deterministic (seeded noise only). Generic engines first, then the creatures and machines.
import { Rng, clamp, smooth } from './util.js';
import { SR, TAU, SVF, Noise, Drift, panGains, ping, bubble, pws } from './audio-dsp.js';

export const K = (keys) => (t) => pws(keys, t);

// ---- tex: the workhorse. Filtered stereo noise with f(t), g(t), pan(t) in film seconds.
// wind, sea, roar, whoosh, plasma, steam are all this with different curves.
// o: { t0,t1, seed, color w|p|b, mode lp|bp|hp, f, q, g, pan, width 0..1, send, hp }
export function tex(G, o) {
  const N = G.dry.n, i0 = Math.max(0, Math.round(o.t0 * SR)), i1 = Math.min(N, Math.round(o.t1 * SR));
  const a = new Noise(o.seed ?? 1), b = new Noise((o.seed ?? 1) + 7717);
  const color = o.color ?? 'p', mode = o.mode ?? 'lp', q = o.q ?? 0.7, w = o.width ?? 0.8, send = o.send ?? 0.2;
  const src = color === 'w' ? (n) => n.white() : color === 'b' ? (n) => n.brown() : (n) => n.pink();
  const f = typeof o.f === 'function' ? o.f : () => o.f, g = typeof o.g === 'function' ? o.g : () => o.g ?? 1, pan = o.pan;
  const fa = new SVF(f(o.t0), q), fb = new SVF(f(o.t0), q), hpa = o.hp ? new SVF(o.hp, 0.7) : null, hpb = o.hp ? new SVF(o.hp, 0.7) : null;
  let gl = 0, gr = 0, dl = 0, dr = 0;
  const dL = G.dry.L, dR = G.dry.R, sL = G.send.L, sR = G.send.R;
  for (let i = i0; i < i1; i++) {
    if (((i - i0) & 63) === 0) {
      const t = i / SR, fc = f(t + 32 / SR), v = g(t + 64 / SR) * Math.SQRT2;
      fa.set(fc, q); fb.set(fc, q);
      const [pl, pr] = panGains(pan ? pan(t) : 0);
      dl = (v * pl - gl) / 64; dr = (v * pr - gr) / 64;
    }
    const x = src(a), y = x * (1 - w) + src(b) * w;
    fa.run(x); fb.run(y);
    let vL = mode === 'lp' ? fa.lp : mode === 'hp' ? fa.hp : fa.bp, vR = mode === 'lp' ? fb.lp : mode === 'hp' ? fb.hp : fb.bp;
    if (hpa) { hpa.run(vL); hpb.run(vR); vL = hpa.hp; vR = hpb.hp; }
    gl += dl; gr += dr;
    const end = i1 - i < 192 ? (i1 - i) / 192 : 1, l = vL * gl * end, r = vR * gr * end;
    dL[i] += l; dR[i] += r;
    if (send) { sL[i] += l * send; sR[i] += r * send; }
  }
}

// ---- tone: a pitch contour through a harmonic table (whines, sirens, doppler streaks)
export function tone(G, o) {
  const N = G.dry.n, i0 = Math.max(0, Math.round(o.t0 * SR)), i1 = Math.min(N, Math.round(o.t1 * SR)), H = o.h ?? [1];
  const f = o.f, g = o.g, pan = o.pan, send = o.send ?? 0.25, dr = new Drift(o.seed ?? 3, 7), jit = o.jit ?? 0;
  let ph = 0, gl = 0, gr = 0, dl = 0, dg = 0, ff = f(o.t0);
  for (let i = i0; i < i1; i++) {
    if (((i - i0) & 31) === 0) {
      const t = i / SR, v = g(t + 32 / SR) * Math.SQRT2, [pl, pr] = panGains(pan ? pan(t) : 0);
      ff = f(t) * (1 + jit * dr.at(t)); dl = (v * pl - gl) / 32; dg = (v * pr - gr) / 32;
    }
    ph += ff / SR; ph -= Math.floor(ph);
    let s = 0; for (let h = 0; h < H.length; h++) if (ff * (h + 1) < 20000) s += H[h] * Math.sin(TAU * (h + 1) * ph);
    gl += dl; gr += dg;
    const end = i1 - i < 192 ? (i1 - i) / 192 : 1, a = s * gl * end, b = s * gr * end;
    G.dry.L[i] += a; G.dry.R[i] += b; G.send.L[i] += a * send; G.send.R[i] += b * send;
  }
}

// ---- grains: a random event cloud. density(t) per second; ev(mono, at, rng, t) writes one event.
export function grains(t0, t1, density, ev, seed, tail = 0.5) {
  const len = Math.ceil((t1 - t0 + tail) * SR), L = new Float32Array(len), R = new Float32Array(len), r = new Rng(seed);
  let t = t0;
  while (t < t1) {
    const d = Math.max(0.05, density(t)); t += -Math.log(1 - r.next() * 0.9999) / d;
    if (t >= t1) break;
    if (r.next() * d > density(t) + 1e-6) continue;
    const pan = r.range(-1, 1), [gl, gr] = panGains(pan * 0.8), at = Math.round((t - t0) * SR), s = r.next() < gl * gl ? L : R;
    ev(s, at, r, t, pan, s === L ? gl : gr);
  }
  return { L, R, t0 };
}

// ---- impact: sub drop + body + crack. size 0..1.5 is how far the ground moves
export function impact(G, t, o = {}) {
  const size = o.size ?? 1, seed = o.seed ?? 1, pan = o.pan ?? 0, dur = 1.4 + 2.6 * size, len = Math.ceil(dur * SR), out = new Float32Array(len);
  const nz = new Noise(seed), lo = new SVF(o.body ?? 340, 0.7), hi = new SVF(o.crack ?? 2600, 0.7), f1 = Math.max(41, (o.f1 ?? 30) * 1.45), f0 = o.f0 ?? 120, tau = 0.32 + 0.55 * size;
  let p = 0;
  for (let i = 0; i < len; i++) {
    const tt = i / SR, f = f1 + (f0 - f1) * Math.exp(-tt / 0.07); p += f / SR;
    const w = nz.white(); lo.run(w); hi.run(w);
    const e = Math.exp(-tt / tau) * (tt < 0.002 ? tt / 0.002 : 1);
    const body = lo.lp * 2.4 * Math.exp(-tt / (0.1 + 0.22 * size));
    const crack = hi.hp * 0.8 * Math.exp(-tt / (o.crackT ?? 0.012));
    out[i] = Math.tanh((Math.sin(TAU * p) * 1.4 * e + body) * (1 + size)) * 0.5 * size + crack * size;
    if (i > len - 2400) out[i] *= (len - i) / 2400;
  }
  put1(G, t, out, { gain: o.gain ?? 1, pan, send: o.send ?? 0.3 });
}
export function put1(G, t0, sig, o = {}) {
  const g = o.gain ?? 1, [gl, gr] = panGains(o.pan ?? 0), send = o.send ?? 0.2, s0 = Math.round(t0 * SR), n = G.dry.n;
  for (let i = Math.max(0, -s0); i < Math.min(sig.length, n - s0); i++) {
    const v = sig[i] * g, j = s0 + i, a = v * gl, b = v * gr;
    G.dry.L[j] += a; G.dry.R[j] += b; G.send.L[j] += a * send; G.send.R[j] += b * send;
  }
}
export function putGr(G, g, o = {}) {
  const gain = o.gain ?? 1, send = o.send ?? 0.25, s0 = Math.round(g.t0 * SR), n = G.dry.n;
  for (let i = 0; i < Math.min(g.L.length, n - s0); i++) {
    const a = g.L[i] * gain, b = g.R[i] * gain, j = s0 + i;
    G.dry.L[j] += a; G.dry.R[j] += b; G.send.L[j] += a * send; G.send.R[j] += b * send;
  }
}

// ---- sonic boom: the double crack of an N-wave, then the sky rolling
export function sonicBoom(G, t, o = {}) {
  const size = o.size ?? 1, len = Math.ceil(0.5 * SR), out = new Float32Array(len), nz = new Noise(o.seed ?? 9), hp = new SVF(500, 0.7);
  const gap = o.gap ?? 0.13, pulse = (tt) => (tt > 0 && tt < 0.022 ? Math.sin(Math.PI * tt / 0.022) : 0);
  for (let i = 0; i < len; i++) {
    const tt = i / SR, w = nz.white(); hp.run(w);
    const e = Math.exp(-tt / 0.012) + Math.exp(-Math.max(0, tt - gap) / 0.018) * (tt > gap ? 1 : 0);
    out[i] = (pulse(tt) - pulse(tt - gap) * 1.1) * 1.1 + hp.hp * e * 0.6;
  }
  put1(G, t, out, { gain: size * (o.gain ?? 1), pan: o.pan ?? 0, send: 0.7 });
}

// ---- thunder: first the rip, then irregular rolls in the low air
export function thunder(G, t, o = {}) {
  const dur = o.dur ?? 3.5, r = new Rng(o.seed ?? 5), n = 7, peaks = []; for (let i = 0; i < n; i++) peaks.push([r.range(0.04, dur * 0.72), r.range(0.3, 1), r.range(0.09, 0.42)]);
  const env = (tt) => { let e = 0; for (const [p, a, w] of peaks) { const x = (tt - p) / w; e += a * Math.exp(-x * x); } return Math.min(1.4, e) * (1 - smooth((tt - dur * 0.75) / (dur * 0.25))); };
  tex(G, { t0: t, t1: t + dur, seed: (o.seed ?? 5) + 1, color: 'b', mode: 'lp', f: (x) => 90 + 420 * Math.exp(-(x - t) / 0.7), g: (x) => 1.5 * (o.gain ?? 1) * env(x - t), pan: () => o.pan ?? 0, width: 0.6, send: 0.5 });
  tex(G, { t0: t, t1: t + 0.35, seed: (o.seed ?? 5) + 2, color: 'w', mode: 'hp', f: 1500, g: (x) => 0.22 * (o.gain ?? 1) * Math.exp(-(x - t) / 0.05), pan: () => o.pan ?? 0, send: 0.6 });
}

// ---- crackle: arcs of static. density(t) events per second
export function crackle(G, t0, t1, density, o = {}) {
  const f0 = o.lo ?? 1800, f1 = o.hi ?? 8000;
  const g = grains(t0, t1, density, (s, at, r, t, pan, pg) => {
    const n = Math.ceil(r.range(0.0006, 0.009) * SR), f = new SVF(r.range(f0, f1), 1.1), nz = new Noise(at + 3), a = r.range(0.2, 1) * pg;
    for (let i = 0; i < n && at + i < s.length; i++) { f.run(nz.white()); s[at + i] += (f.bp * 1.3 + (r.next() < 0.06 ? r.sign() * 0.6 : 0)) * a * (1 - i / n); }
  }, o.seed ?? 4, 0.05);
  putGr(G, g, { gain: o.gain ?? 0.5, send: o.send ?? 0.35 });
}

// ---- arc: a fat electrical buzz, ragged and mains-like, ending in a snap
export function arc(G, t, o = {}) {
  const dur = o.dur ?? 0.4, len = Math.ceil(dur * SR), out = new Float32Array(len), seed = o.seed ?? 3, nz = new Noise(seed), dr = new Drift(seed, 60), hp = new SVF(o.hp ?? 700, 0.7), f = o.f ?? 110;
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const tt = i / SR, u = tt / dur; ph += f * (1 + 0.4 * dr.at(tt)) / SR; ph -= Math.floor(ph);
    const x = (2 * ph - 1) + 0.9 * nz.white() * (dr.at(tt * 1.7) > 0 ? 1 : 0.2); hp.run(x);
    out[i] = Math.tanh(hp.hp * 2.4) * (u < 0.05 ? u / 0.05 : 1) * Math.pow(1 - u, 0.7) * (dr.at(tt + 7) > -0.2 ? 1 : 0.3);
  }
  put1(G, t, out, { gain: o.gain ?? 0.4, pan: o.pan ?? 0, send: 0.4 });
}

// ---- friction: stick-slip pulses through metal modes. Bow creak, hull groan, steel scream.
// o.rate(u) pulses/s, o.modes [[f, Q, amp]], o.env(u)
export function friction(dur, o, seed = 1) {
  const len = Math.ceil(dur * SR), out = new Float32Array(len), r = new Rng(seed), dr = new Drift(seed, o.jitHz ?? 17), jit = o.jit ?? 0.45;
  const M = o.modes.map(([f, q, a]) => { const rr = Math.exp(-Math.PI * f / (q * SR)); return { c1: 2 * rr * Math.cos(TAU * f / SR), c2: -rr * rr, a, y1: 0, y2: 0, g: (1 - rr) * 12 }; });
  let ph = 0, rate = 1, e = 0, pulse = 0;
  for (let i = 0; i < len; i++) {
    const u = i / len;
    if ((i & 63) === 0) { rate = o.rate(u) * (1 + jit * dr.at(i / SR)); e = o.env(u); }
    ph += rate / SR; pulse *= 0.86;
    if (ph >= 1) { ph -= 1; pulse += r.range(0.4, 1) * r.sign(); }
    const ex = pulse * e;
    let s = 0;
    for (const q of M) { const y = q.c1 * q.y1 + q.c2 * q.y2 + ex * q.g; q.y2 = q.y1; q.y1 = y; s += y * q.a; }
    out[i] = Math.tanh(s * (o.drive ?? 1)) * (o.gain ?? 0.5);
  }
  return out;
}
export const HULL = (lo = 1) => [[68 * lo, 26, 1], [103 * lo, 34, 0.8], [151 * lo, 40, 0.7], [233 * lo, 44, 0.5], [347 * lo, 50, 0.32], [512 * lo, 60, 0.2], [788 * lo, 70, 0.1]];
export const BOWWOOD = [[187, 18, 0.9], [311, 22, 1], [523, 26, 0.7], [877, 30, 0.45], [1390, 32, 0.22], [2240, 34, 0.1]];
export const STEEL = [[412, 90, 1], [633, 110, 0.8], [947, 120, 0.7], [1413, 130, 0.5], [2204, 140, 0.32], [3380, 150, 0.2]];

// ---- metal hit: a container, a plate, a lashing rod
export function clang(G, t, o = {}) {
  const f0 = o.f ?? 180, len = Math.ceil((o.ring ?? 1.2) * 1.2 * SR), out = new Float32Array(len), seed = o.seed ?? 8, d = o.ring ?? 1.2;
  ping(out, 0, f0, 0.28, [[1, 1, d], [1.59, 0.7, d * 0.8], [2.14, 0.6, d * 0.6], [2.65, 0.44, d * 0.5], [3.6, 0.3, d * 0.3], [4.9, 0.2, d * 0.2], [6.7, 0.1, d * 0.12]], seed);
  const nz = new Noise(seed), f = new SVF(f0 * 7, 0.8), lo = new SVF(f0 * 1.5, 0.8);
  for (let i = 0; i < Math.min(len, 2400); i++) { const w = nz.white(); f.run(w); lo.run(w); out[i] += (f.bp * 0.6 + lo.lp * 0.9) * Math.exp(-i / 340); }
  put1(G, t, out, { gain: o.gain ?? 0.6, pan: o.pan ?? 0, send: o.send ?? 0.35 });
}

// ---- splash: the thump, the sheet, and the rain falling back
export function splash(G, t, o = {}) {
  const size = o.size ?? 1, seed = o.seed ?? 2, pan = o.pan ?? 0, d = 0.5 + 1.8 * size, P = () => pan;
  impact(G, t, { size: 0.28 * size, f0: 90, f1: 42, crack: 1500, crackT: 0.02, seed, pan, gain: o.gain ?? 1, send: 0.2 });
  tex(G, { t0: t, t1: t + d, seed: seed + 1, color: 'w', mode: 'bp', q: 0.6, f: (x) => 2600 - 1900 * Math.min(1, (x - t) / d), g: (x) => (o.gain ?? 1) * 0.5 * size * Math.exp(-(x - t) / (d * 0.26)) * Math.min(1, (x - t) / 0.012), pan: P, send: 0.3 });
  tex(G, { t0: t + 0.1, t1: t + d * 1.3, seed: seed + 2, color: 'w', mode: 'hp', f: 3200, g: (x) => (o.gain ?? 1) * 0.12 * size * Math.sin(Math.PI * clamp((x - t - 0.1) / (d * 1.2))), pan: P, width: 1, send: 0.3 });
}

// ---- bubble clouds: boiling sea, air rising past the camera
export function boil(G, t0, t1, density, o = {}) {
  const lo = o.lo ?? 160, hi = o.hi ?? 900;
  const g = grains(t0, t1, density, (s, at, r) => bubble(s, at, lo * Math.pow(hi / lo, r.next()), r.range(0.02, 0.09), r.range(0.05, 0.2)), o.seed ?? 6, 0.4);
  putGr(G, g, { gain: o.gain ?? 1, send: o.send ?? 0.3 });
}

// ---- whale song: a gliding voice with a rough throat, formants and a long way to travel.
// contour [[t, Hz]], gain [[t, g]]. Harmonics grow with level, so soft moans stay pure.
export function whale(contour, levels, o = {}, seed = 1) {
  const dur = contour[contour.length - 1][0], len = Math.ceil((dur + 0.3) * SR), out = new Float32Array(len), dr = new Drift(seed, 5), gr = new Drift(seed + 1, 34), nz = new Noise(seed + 2);
  const F = [new SVF(o.f1 ?? 340, 2.4), new SVF(o.f2 ?? 880, 3.2), new SVF(o.f3 ?? 1900, 3.4)];
  const rough = o.rough ?? 0.5;
  let ph = 0, f = contour[0][1], a = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    if ((i & 31) === 0) { f = pws(contour, t) * (1 + 0.012 * dr.at(t) + (o.wob ?? 0.006) * Math.sin(TAU * 5.3 * t)); a = pws(levels, t); }
    ph += f / SR; ph -= Math.floor(ph);
    const b = 0.35 + 0.65 * a;
    let s = Math.sin(TAU * ph) + 0.55 * b * Math.sin(2 * TAU * ph + 0.4) + 0.32 * b * Math.sin(3 * TAU * ph + 1.1) + 0.18 * b * b * Math.sin(4 * TAU * ph) + 0.1 * b * b * Math.sin(5 * TAU * ph + 2);
    s *= 1 + rough * b * gr.at(t);
    const w = 0.05 * b * nz.white();
    F[0].run(s + w); F[1].run(s + w); F[2].run(s + w);
    out[i] = (s * 0.42 + F[0].bp * 0.5 + F[1].bp * 0.5 + F[2].bp * 0.26) * a * (o.gain ?? 0.34) * (i > len - 960 ? (len - i) / 960 : 1);
  }
  return out;
}

// ---- roar: a throat the size of a cathedral. Glottal pulses, huge formants, torn noise.
export function roar(dur, o, seed = 1) {
  const len = Math.ceil(dur * SR), out = new Float32Array(len), nz = new Noise(seed), jit = new Drift(seed, 41), sh = new Drift(seed + 1, 23), wob = new Drift(seed + 2, 3.7);
  const F = (o.form ?? [[150, 3, 1], [340, 3.4, 0.9], [760, 4, 0.55], [1600, 4.5, 0.26]]).map(([f, q, a]) => ({ s: new SVF(f, q), a, f, q }));
  const env = o.env, pitch = o.f, gr = o.grit ?? 0.8, mv = o.move ?? 0;
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR, u = t / dur, e = env(u);
    const f0 = pitch(u) * (1 + 0.12 * jit.at(t) + 0.05 * wob.at(t));
    ph += f0 / SR;
    if (ph >= 1) ph -= 1;
    const g = Math.pow(1 - ph, 5) * 2 - 0.5, n = nz.white();
    const src = g * (1 + 0.55 * sh.at(t)) + n * gr * (0.3 + Math.pow(1 - ph, 3));
    let s = 0;
    if ((i & 127) === 0 && mv) for (const q of F) q.s.set(q.f * (1 + mv * (u - 0.5)), q.q);
    for (const q of F) { q.s.run(src); s += q.s.bp * q.a; }
    out[i] = Math.tanh(s * (o.drive ?? 1.6) * e) * (o.gain ?? 0.6) * (i > len - 2400 ? (len - i) / 2400 : 1);
  }
  return out;
}

// ---- ship horn: a pair of tones through a long brass throat, big and far
export function horn(dur, m0, o = {}, seed = 1) {
  const len = Math.ceil((dur + 0.5) * SR), out = new Float32Array(len), lp = new SVF(o.lp ?? 900, 0.8), f = [m0, m0 * 1.498, m0 * 1.003];
  const ph = [0, 0, 0], dr = new Drift(seed, 2);
  for (let i = 0; i < len; i++) {
    const t = i / SR, a = Math.min(1, t / 0.22) * (t > dur ? Math.exp(-(t - dur) / 0.14) : 1);
    let s = 0;
    for (let k = 0; k < 3; k++) { ph[k] += f[k] * (1 + 0.002 * dr.at(t)) * (1 - 0.03 * Math.exp(-t / 0.12)) / SR; ph[k] -= Math.floor(ph[k]); s += (2 * ph[k] - 1) * (k === 1 ? 0.7 : 1); }
    lp.run(s); out[i] = Math.tanh(lp.lp * 1.8) * a * (o.gain ?? 0.34);
  }
  return out;
}
