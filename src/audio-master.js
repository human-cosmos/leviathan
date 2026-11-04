// Sound department — master bus processing for LEVIATHAN (all in place, deterministic).
import { SR, SVF, Drift, dbToGain } from './audio-dsp.js';

// Stereo-linked RMS compressor with soft knee and a little look-ahead. The thing that
// makes the mix feel like one enormous object rather than a pile of layers.
export function glue(L, R, o = {}) {
  const thr = o.thr ?? -18, ratio = o.ratio ?? 2.5, knee = o.knee ?? 8, n = L.length;
  const ca = Math.exp(-1 / ((o.att ?? 0.03) * SR)), cr = Math.exp(-1 / ((o.rel ?? 0.3) * SR));
  const rc = Math.exp(-1 / (0.012 * SR)), mk = dbToGain(o.makeup ?? 0), la = Math.round((o.look ?? 0.005) * SR);
  const gain = new Float32Array(n);
  let e = 1e-9, g = 0, maxGr = 0;
  for (let i = 0; i < n; i++) {
    const p = (L[i] * L[i] + R[i] * R[i]) * 0.5;
    e = p + (e - p) * rc;
    const db = 10 * Math.log10(e + 1e-12), over = db - thr;
    let red = 0;
    if (over > knee / 2) red = over * (1 - 1 / ratio);
    else if (over > -knee / 2) { const x = over + knee / 2; red = (1 - 1 / ratio) * x * x / (2 * knee); }
    g = red > g ? red + (g - red) * ca : red + (g - red) * cr;
    if (g > maxGr) maxGr = g;
    gain[i] = g;
  }
  for (let i = 0; i < n; i++) { const k = mk * Math.pow(10, -gain[Math.min(n - 1, i + la)] / 20); L[i] *= k; R[i] *= k; }
  return maxGr;
}

// tanh soft clip: only touches what comes near full scale
export function softClip(L, R, knee = 0.7) {
  const r = 1 - knee;
  const f = (x) => { const a = Math.abs(x); return a <= knee ? x : Math.sign(x) * (knee + r * Math.tanh((a - knee) / r)); };
  for (let i = 0; i < L.length; i++) { L[i] = f(L[i]); R[i] = f(R[i]); }
}

// sum everything under fc to mono so the sub is solid and translates
export function monoLows(L, R, fc = 110) {
  const a = new SVF(fc, 0.707);
  for (let i = 0; i < L.length; i++) {
    const m = (L[i] + R[i]) * 0.5, s = (L[i] - R[i]) * 0.5;
    a.run(s); const sh = s - a.lp;
    L[i] = m + sh; R[i] = m - sh;
  }
}

// time-varying lowpass; cutoff fn(t) read every 32 samples, bypassed at >= 17 kHz.
// leak lets a trace of the highs through, so going under water is a veil and not a wall.
export function sweepLP(L, R, fn, leak = 0) {
  const a = new SVF(18000, 0.6), b = new SVF(18000, 0.6);
  let w = 0;        // blends in from the bypass, so a cut under water never ticks
  for (let i = 0; i < L.length; i++) {
    if ((i & 31) === 0) { const f = fn(i / SR); w = Math.max(0, Math.min(1, (17000 - f) / 6000)); a.set(f, 0.6); b.set(f, 0.6); }
    a.run(L[i]); b.run(R[i]);
    if (w > 0) { const x = L[i], y = R[i]; L[i] = x + (a.lp + (x - a.lp) * leak - x) * w; R[i] = y + (b.lp + (y - b.lp) * leak - y) * w; }
  }
}

// ensemble: three slowly wandering delay lines per channel, dry kept for the attack. What turns
// a stack of oscillators into a section of players in a room.
export function ensemble(L, R, o = {}) {
  const n = L.length, base = [0.0137, 0.0193, 0.0271], dep = o.depth ?? 0.0015, dry = o.dry ?? 0.76, wet = o.wet ?? 0.37;
  [L, R].forEach((x, ch) => {
    const y = new Float32Array(n);
    base.forEach((b, v) => {
      const d1 = new Drift(1000 + (o.seed ?? 0) * 40 + ch * 7 + v, 0.61 + v * 0.27), d2 = new Drift(2000 + (o.seed ?? 0) * 40 + ch * 7 + v, 4.7 + v * 0.8);
      let dl = b * SR, dd = 0;
      for (let i = 0; i < n; i++) {
        if ((i & 63) === 0) { const t = i / SR, tgt = (b + dep * d1.at(t) + dep * 0.14 * d2.at(t)) * SR; dd = (tgt - dl) / 64; }
        dl += dd;
        const p = i - dl, k = Math.floor(p), f = p - k;
        if (k >= 0) y[i] += x[k] + (x[k + 1] - x[k]) * f;
      }
    });
    for (let i = 0; i < n; i++) x[i] = x[i] * dry + y[i] * wet;
  });
}
// run a chain of biquads over a channel in place: fs = () => [Biquad, ...]
export function eq(L, R, make) {
  for (const x of [L, R]) { const c = make(); for (let i = 0; i < x.length; i++) { let v = x[i]; for (let k = 0; k < c.length; k++) v = c[k].run(v); x[i] = v; } }
}
// transient lift on the story hits: [[t, db, tau]], instant rise, exponential fall, 1 kHz control rate
export function hitCurve(hits, n) {
  const m = Math.ceil(n / SR * 1000) + 2, db = new Float32Array(m);
  for (const [t, d, tau] of hits) for (let i = Math.max(0, Math.floor((t - 0.002) * 1000)); i < m; i++) { const u = i / 1000 - t, v = d * Math.exp(-Math.max(0, u) / tau); if (v < 0.01) break; if (v > db[i]) db[i] = v; }
  return (t) => { const x = t * 1000, i = Math.floor(x), a = db[Math.min(m - 1, i)], b = db[Math.min(m - 1, i + 1)]; return Math.pow(10, (a + (b - a) * (x - i)) / 20); };
}

// gaps: [[t0, t1, db, rampIn, rampOut]] carve the mix after the reverbs so the silence is real.
// rampOut stays short: anything longer eats the attack of the hit behind the gap.
export function carve(L, R, gaps) {
  for (const [t0, t1, db, ramp = 0.006, rampOut = ramp] of gaps) {
    const g = dbToGain(db), a = Math.round((t0 - ramp) * SR), b = Math.round(t0 * SR), c = Math.round(t1 * SR), d = Math.round((t1 + rampOut) * SR);
    for (let i = Math.max(0, a); i < Math.min(L.length, d); i++) {
      const k = i < b ? 1 + (g - 1) * (i - a) / Math.max(1, b - a) : i < c ? g : g + (1 - g) * (i - c) / Math.max(1, d - c);
      L[i] *= k; R[i] *= k;
    }
  }
}
