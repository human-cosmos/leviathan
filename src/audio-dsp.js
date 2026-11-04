// Sound department — DSP toolkit shared by the score and the effects.
// Everything here is deterministic: noise comes from seeded RNGs, never Math.random.
import { Rng, clamp, lerp } from './util.js';

export const SR = 48000;
export const TAU = Math.PI * 2;

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// 'Bb4' | 'F#3' | 'C5' -> midi number (C4 = 60)
export function nm(s) {
  if (typeof s === 'number') return s;
  const m = /^([A-G])([b#]?)(-?\d)$/.exec(s);
  if (!m) throw new Error('bad note ' + s);
  return PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (parseInt(m[3], 10) + 1) * 12;
}
export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-12));

// ------------------------------------------------------------------ buses
// A full-length stereo float bus. Effects write into a "dry" bus and a
// "send" bus (which the Web Audio graph feeds into a convolution reverb).
export class Bus {
  constructor(n) { this.n = n; this.L = new Float32Array(n); this.R = new Float32Array(n); }
}
export function panGains(p) { const a = (clamp(p, -1, 1) + 1) * Math.PI / 4; return [Math.cos(a), Math.sin(a)]; }

// out = { dry: Bus, send: Bus }.  o = { gain, pan, send (0..1+), width (stereo decorrelation 0..1) }
export function put(out, t0, sig, o = {}) {
  const g = o.gain ?? 1, pan = o.pan ?? 0, send = o.send ?? 0.2;
  const [gl, gr] = panGains(pan);
  const s0 = Math.round(t0 * SR);
  const n = out.dry.n;
  const dL = out.dry.L, dR = out.dry.R, sL = out.send.L, sR = out.send.R;
  const i0 = Math.max(0, -s0), i1 = Math.min(sig.length, n - s0);
  for (let i = i0; i < i1; i++) {
    const v = sig[i] * g, j = s0 + i;
    dL[j] += v * gl; dR[j] += v * gr;
    if (send) { sL[j] += v * gl * send; sR[j] += v * gr * send; }
  }
}
// stereo signal [L, R]
export function put2(out, t0, L, R, o = {}) {
  const g = o.gain ?? 1, send = o.send ?? 0.2;
  const s0 = Math.round(t0 * SR), n = out.dry.n;
  const i0 = Math.max(0, -s0), i1 = Math.min(L.length, n - s0);
  for (let i = i0; i < i1; i++) {
    const j = s0 + i, l = L[i] * g, r = R[i] * g;
    out.dry.L[j] += l; out.dry.R[j] += r;
    if (send) { out.send.L[j] += l * send; out.send.R[j] += r * send; }
  }
}

// ---------------------------------------------------------------- filters
// Topology-preserving state-variable filter (Zavalishin). Cheap to modulate.
export class SVF {
  constructor(f = 1000, q = 0.707) { this.ic1 = 0; this.ic2 = 0; this.lp = 0; this.bp = 0; this.hp = 0; this.set(f, q); }
  set(f, q = this.q) {
    this.q = q;
    const g = Math.tan(Math.PI * clamp(f, 5, SR * 0.46) / SR), k = 1 / q;
    this.k = k; this.a1 = 1 / (1 + g * (g + k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  run(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2; this.bp = v1; this.hp = x - this.k * v1 - v2;
    return v2;
  }
}
export class OnePole { // lowpass
  constructor(f) { this.y = 0; this.set(f); }
  set(f) { this.a = Math.exp(-TAU * f / SR); }
  run(x) { this.y = x + (this.y - x) * this.a; return this.y; }
}
export class Biquad { // direct form I with given coefficients (a0 = 1)
  constructor(b0, b1, b2, a1, a2) { Object.assign(this, { b0, b1, b2, a1, a2 }); this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  run(x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
  static hp(f, q = 0.707) { const w = TAU * f / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al; return new Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0); }
  static lp(f, q = 0.707) { const w = TAU * f / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al; return new Biquad((1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, -2 * c / a0, (1 - al) / a0); }
  static hishelf(f, db) { const A = Math.pow(10, db / 40), w = TAU * f / SR, c = Math.cos(w), al = Math.sin(w) * Math.SQRT1_2, q = 2 * Math.sqrt(A) * al, a0 = (A + 1) - (A - 1) * c + q; return new Biquad(A * ((A + 1) + (A - 1) * c + q) / a0, -2 * A * ((A - 1) + (A + 1) * c) / a0, A * ((A + 1) + (A - 1) * c - q) / a0, 2 * ((A - 1) - (A + 1) * c) / a0, ((A + 1) - (A - 1) * c - q) / a0); }
  static peak(f, q, db) { const A = Math.pow(10, db / 40), w = TAU * f / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al / A; return new Biquad((1 + al * A) / a0, -2 * c / a0, (1 - al * A) / a0, -2 * c / a0, (1 - al / A) / a0); }
}
export function filterInPlace(sig, flt) { for (let i = 0; i < sig.length; i++) sig[i] = flt.run(sig[i]); return sig; }

// ------------------------------------------------------------------ noise
export class Noise {
  constructor(seed) { this.r = new Rng(seed); this.b = [0, 0, 0, 0, 0, 0, 0]; this.br = 0; }
  white() { return this.r.next() * 2 - 1; }
  pink() { // Paul Kellet
    const w = this.white(), b = this.b;
    b[0] = 0.99886 * b[0] + w * 0.0555179; b[1] = 0.99332 * b[1] + w * 0.0750759; b[2] = 0.969 * b[2] + w * 0.153852;
    b[3] = 0.8665 * b[3] + w * 0.3104856; b[4] = 0.55 * b[4] + w * 0.5329522; b[5] = -0.7616 * b[5] - w * 0.016898;
    const o = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362; b[6] = w * 0.115926;
    return o * 0.11;
  }
  brown() { this.br = (this.br + 0.02 * this.white()) / 1.02; return this.br * 3.5; }
}
// smooth deterministic random curve (for gusts / drifts): value noise with cosine interpolation
export class Drift {
  constructor(seed, rate) { this.r = new Rng(seed); this.rate = rate; this.k = []; for (let i = 0; i < 4096; i++) this.k.push(this.r.next() * 2 - 1); }
  at(t) { const x = t * this.rate, i = Math.floor(x), f = x - i, u = (1 - Math.cos(f * Math.PI)) / 2; const n = this.k.length; return lerp(this.k[((i % n) + n) % n], this.k[(((i + 1) % n) + n) % n], u); }
}

// ------------------------------------------------------------ primitives
export const buf = (sec) => new Float32Array(Math.max(1, Math.ceil(sec * SR)));

// Minnaert bubble (van den Doel): rising-pitch damped sine. Adds into `out` at sample `at`.
export function bubble(out, at, f0, amp, rise = 0.1) {
  const d = 0.13 * f0 + 0.0072 * Math.pow(f0, 1.5);
  const len = Math.min(Math.ceil(SR * 7 / d), out.length - at);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    ph += TAU * f0 * (1 + rise * d * t) / SR;
    const att = i < 24 ? i / 24 : 1;
    out[at + i] += amp * att * Math.sin(ph) * Math.exp(-d * t);
  }
}

// filtered-noise burst with a swept bandpass. env: attack a (s), decay tau (s); f0 -> f1 sweep
export function noiseBurst(out, at, o, nz) {
  const len = Math.min(Math.ceil((o.a + o.tau * 7) * SR), out.length - at);
  const f = new SVF(o.f0, o.q ?? 1.2);
  const hp = o.hp ? new SVF(o.hp, 0.7) : null;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    if ((i & 31) === 0) f.set(o.f1 !== undefined ? o.f0 * Math.pow(o.f1 / o.f0, Math.min(1, t / (o.sweep ?? (o.a + o.tau * 2)))) : o.f0);
    const e = t < o.a ? Math.pow(t / o.a, o.ac ?? 1) : Math.exp(-(t - o.a) / o.tau);
    f.run(nz.white());
    let v = o.mode === 'lp' ? f.lp : o.mode === 'hp' ? f.hp : f.bp;
    if (hp) { hp.run(v); v = hp.hp; }
    out[at + i] += v * e * o.amp;
  }
}

// damped resonant "ping" (metal), partials [[ratio, amp, decaySec]]
export function ping(out, at, f0, amp, partials, phase = 0) {
  for (const [r, a, dec] of partials) {
    const f = f0 * r; if (f > SR * 0.45) continue;
    const w = TAU * f / SR, rr = Math.exp(-6.91 / (dec * SR));
    const len = Math.min(Math.ceil(dec * SR * 1.1), out.length - at);
    // damped resonator recursion: y[n] = 2 r cos w y[n-1] - r^2 y[n-2]
    const c1 = 2 * rr * Math.cos(w), c2 = -rr * rr;
    let y1 = Math.sin(phase) * amp * a, y2 = Math.sin(phase - w) * amp * a / rr;
    for (let i = 0; i < len; i++) { const y = c1 * y1 + c2 * y2; out[at + i] += y1 * (i < 12 ? i / 12 : 1); y2 = y1; y1 = y; }
  }
}

// ------------------------------------------------------------- envelopes
// piecewise-linear envelope from [[t, v], ...]
export function pwl(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [t0, v0] = keys[i - 1], [t1, v1] = keys[i]; return v0 + (v1 - v0) * (t - t0) / Math.max(1e-9, t1 - t0); }
  return keys[keys.length - 1][1];
}
// smooth (cosine) version
export function pws(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [t0, v0] = keys[i - 1], [t1, v1] = keys[i]; const u = (t - t0) / Math.max(1e-9, t1 - t0); return v0 + (v1 - v0) * (1 - Math.cos(u * Math.PI)) / 2; }
  return keys[keys.length - 1][1];
}

// ----------------------------------------------------- impulse responses
// Generated stereo IR. o = { dur, rt60, pre, fHi, fLo, darken, fadeIn, early:[[t, gain, pan, lp]], seed, diffuse }
export function makeIR(ctx, o) {
  const len = Math.floor(o.dur * SR);
  const ir = ctx.createBuffer(2, len, SR);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    const nz = new Noise((o.seed ?? 1) * 7 + ch * 1013);
    const lp = new OnePole(o.fHi ?? 9000), lp2 = new OnePole(o.fHi ?? 9000);
    const pre = o.pre ?? 0.01, fadeIn = o.fadeIn ?? 0.03, diffuse = o.diffuse ?? 1;
    for (let i = 0; i < len; i++) {
      const t = i / SR; if (t < pre) continue;
      const tt = t - pre;
      if ((i & 63) === 0) { const fc = (o.fLo ?? 1500) + ((o.fHi ?? 9000) - (o.fLo ?? 1500)) * Math.exp(-tt / (o.darken ?? 0.6)); lp.set(fc); lp2.set(fc); }
      const env = Math.exp(-6.91 * tt / o.rt60) * Math.min(1, tt / fadeIn);
      d[i] = lp2.run(lp.run(nz.white())) * env * diffuse;
    }
    // discrete early reflections / echoes off buildings
    for (const [et, eg, ep, elp] of o.early || []) {
      const [gl, gr] = panGains(ep ?? 0);
      const g = eg * (ch === 0 ? gl : gr) * 1.41;
      const at = Math.floor(et * SR), f = new OnePole(elp ?? 6000), f2 = new OnePole(elp ?? 6000);
      const blen = Math.floor(SR * 0.025);
      for (let i = 0; i < blen && at + i < len; i++) {
        const e = Math.exp(-i / (SR * 0.004)) * (i < 8 ? i / 8 : 1);
        d[at + i] += f2.run(f.run(nz.white() * e)) * g * 9;
      }
    }
  }
  // normalise: unit energy per channel so send level == wet level
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch); let e = 0;
    for (let i = 0; i < len; i++) e += d[i] * d[i];
    const k = 1 / Math.sqrt(e || 1);
    for (let i = 0; i < len; i++) d[i] *= k;
  }
  return ir;
}

// ----------------------------------------------------------- loudness etc
// ITU-R BS.1770-4 integrated loudness (LUFS) of a stereo signal at 48 kHz.
export function lufs(L, R) {
  const kw = (x) => {
    const s1 = new Biquad(1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585);
    const s2 = new Biquad(1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621);
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) y[i] = s2.run(s1.run(x[i]));
    return y;
  };
  const kl = kw(L), kr = kw(R);
  const blk = Math.round(0.4 * SR), hop = Math.round(0.1 * SR);
  // prefix sums of squares
  const n = kl.length, cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + kl[i] * kl[i] + kr[i] * kr[i];
  const z = [];
  for (let s = 0; s + blk <= n; s += hop) z.push((cs[s + blk] - cs[s]) / blk);
  const ld = (v) => -0.691 + 10 * Math.log10(Math.max(v, 1e-12));
  let g1 = z.filter((v) => ld(v) > -70);
  if (!g1.length) return -120;
  const mean1 = g1.reduce((a, b) => a + b, 0) / g1.length;
  const rel = ld(mean1) - 10;
  const g2 = g1.filter((v) => ld(v) > rel);
  const mean2 = g2.reduce((a, b) => a + b, 0) / g2.length;
  return ld(mean2);
}
// short-term loudness curve (3 s windows) every `step` s, for reporting
export function shortTerm(L, R, step = 1) {
  const s1 = [new Biquad(1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585), new Biquad(1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585)];
  const s2 = [new Biquad(1, -2, 1, -1.99004745483398, 0.99007225036621), new Biquad(1, -2, 1, -1.99004745483398, 0.99007225036621)];
  const n = L.length, cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { const a = s2[0].run(s1[0].run(L[i])), b = s2[1].run(s1[1].run(R[i])); cs[i + 1] = cs[i] + a * a + b * b; }
  const out = []; const w = 3 * SR;
  for (let t = 0; t <= n / SR; t += step) { const e = Math.min(n, Math.round(t * SR) + w / 2), s = Math.max(0, e - w); out.push(+(-0.691 + 10 * Math.log10(Math.max((cs[e] - cs[s]) / Math.max(1, e - s), 1e-12))).toFixed(1)); }
  return out;
}

export function peakOf(L, R) { let p = 0; for (let i = 0; i < L.length; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > p) p = a; if (b > p) p = b; } return p; }

// Look-ahead brickwall limiter (in place). Guaranteed |x| <= ceiling for samples.
export function limit(L, R, ceiling, la = 0.004, rel = 0.12) {
  const n = L.length, W = Math.max(2, Math.round(la * SR));
  const req = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = Math.max(Math.abs(L[i]), Math.abs(R[i])); req[i] = p > ceiling ? ceiling / p : 1; }
  // forward sliding minimum over [i, i+W] (monotonic deque)
  const g1 = new Float32Array(n), dq = new Int32Array(n + W + 1); let h = 0, tl = 0;
  for (let j = 0; j < n + W; j++) {
    if (j < n) { while (tl > h && req[dq[tl - 1]] >= req[j]) tl--; dq[tl++] = j; }
    const i = j - W; if (i < 0) continue;
    while (dq[h] < i) h++;
    g1[i] = req[dq[h]];
  }
  // release smoothing (never above g1)
  const rc = 1 - Math.exp(-1 / (rel * SR));
  let g = 1;
  for (let i = 0; i < n; i++) { const t = g1[i]; g = t < g ? t : g + (t - g) * rc; g1[i] = g; }
  // box average over the previous W samples keeps it smooth and still safe
  let acc = 0; const box = new Float32Array(n);
  for (let i = 0; i < n; i++) { acc += g1[i]; if (i >= W) acc -= g1[i - W]; box[i] = acc / Math.min(i + 1, W); }
  let gr = 1;
  for (let i = 0; i < n; i++) { const k = Math.min(box[i], g1[i] < 1 ? box[i] : 1); L[i] *= k; R[i] *= k; if (k < gr) gr = k; }
  return gainToDb(gr);
}

// 16-bit PCM WAV with TPDF dither
export function encodeWav(chans, seed = 99) {
  const n = chans[0].length, nc = chans.length;
  const ab = new ArrayBuffer(44 + n * nc * 2), dv = new DataView(ab);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * nc * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nc, true); dv.setUint32(24, SR, true);
  dv.setUint32(28, SR * nc * 2, true); dv.setUint16(32, nc * 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * nc * 2, true);
  const r = new Rng(seed); let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
    const x = chans[c][i] * 32767 + (r.next() - r.next());
    dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(x))), true); o += 2;
  }
  return new Uint8Array(ab);
}
