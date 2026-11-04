// Sound department — the soundtrack for LEVIATHAN. Fully synthesized in an
// OfflineAudioContext: 48 kHz stereo, exactly DURATION seconds, timed to CUES.
//
//   music  (audio-music.js)  -> cathedral hall -> ducking -> channels 0/1
//   sfx    (audio-sfx.js)    -> open air -------------   -> channels 2/3
//   under  (underwater bus)  -> dark closed space ------ -> into 2/3
// The offline render keeps music and effects apart so stems can be measured. Then:
// underwater muffling per shot, carved gaps, sum, high-pass, mono lows, balance EQ, glue,
// transient lift on the story hits, soft clip, normalise to TARGET_LUFS (BS.1770), brickwall
// limit to CEILING_DB, final fade. tools/render-audio.mjs compares the result with the reference.
import { CUES, DURATION, SHOTS, shotAt } from './shots.js';
import { SR, Bus, Biquad, makeIR, lufs, shortTerm, peakOf, limit, encodeWav, gainToDb, dbToGain } from './audio-dsp.js';
import { glue, softClip, monoLows, sweepLP, carve, eq, hitCurve } from './audio-master.js';
import { buildMusic } from './audio-music.js';
import { buildSfx } from './audio-sfx.js';

export const TARGET_LUFS = -14;
export const CEILING_DB = -1.85;      // sample ceiling; leaves room for inter-sample overs (true peak < -1)
export const LENGTH = Math.round(DURATION * SR);

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// the score going behind water: lowpass cutoff per shot (Hz). The pierce run stays open: the
// picture is underwater but the score is the point of view there.
const MUFFLE_M = { s17: 900, s27: 1100, s29: 700, s22: 1500, s31: 6000, s32: 5200, s33: 2400, s34: 3200, s35: 7000, s36: 7000, s37: 3600 };
const MUFFLE_S = { s17: 800, s27: 900, s29: 600, s31: 4200, s32: 3400, s33: 1400, s34: 1500, s35: 3600, s36: 3200, s37: 1800 };
const curveHz = (table, def = 20000) => {
  const rate = 500, n = Math.ceil(DURATION * rate) + 2, a = new Float32Array(n), k = 1 - Math.exp(-1 / (0.03 * rate));
  let y = Math.log(def);
  for (let i = 0; i < n; i++) { const s = SHOTS[shotAt(i / rate)]; y += (Math.log(table[s.id] ?? def) - y) * k; a[i] = y; }
  return (t) => Math.exp(a[Math.min(n - 1, Math.round(t * rate))]);
};

// music gain curve: short ducks under the key effects (attack 60 ms, release 350 ms)
function duckCurve(ducks, rate = 200) {
  const n = Math.ceil(DURATION * rate) + 1, db = new Float32Array(n);
  for (const [t0, t1, d] of ducks) {
    if (!d) continue;
    for (let i = Math.max(0, Math.floor((t0 - 0.06) * rate)); i < Math.min(n, Math.ceil((t1 + 0.35) * rate)); i++) {
      const t = i / rate, k = t < t0 ? (t - (t0 - 0.06)) / 0.06 : t <= t1 ? 1 : 1 - (t - t1) / 0.35;
      db[i] = Math.min(db[i], d * Math.max(0, Math.min(1, k)));
    }
  }
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = dbToGain(db[i]);
  return g;
}
function toBuffer(ctx, bus) {
  const b = ctx.createBuffer(2, LENGTH, SR);
  b.copyToChannel(bus.L.subarray(0, LENGTH), 0); b.copyToChannel(bus.R.subarray(0, LENGTH), 1);
  return b;
}
function play(ctx, buffer, dst) { const s = ctx.createBufferSource(); s.buffer = buffer; s.connect(dst); s.start(0); return s; }
const addBus = (a, b) => { for (let i = 0; i < LENGTH; i++) { a.L[i] += b.L[i]; a.R[i] += b.R[i]; } };

export async function renderSoundtrack(opts = {}) {
  const log = opts.log || (() => {});
  const T0 = now(), tm = {};
  const ctx = new OfflineAudioContext({ numberOfChannels: 4, length: LENGTH, sampleRate: SR });
  ctx.destination.channelInterpretation = 'discrete';

  // ---------------- graph
  const mDry = ctx.createGain(), mSend = ctx.createGain(), mDuck = ctx.createGain();
  const hall = ctx.createConvolver(); hall.normalize = false;
  hall.buffer = makeIR(ctx, { dur: 5.2, rt60: 3.6, pre: 0.034, fHi: 6400, fLo: 900, darken: 1.2, fadeIn: 0.06, seed: 3,
    early: [[0.041, 0.3, -0.6, 5000], [0.063, 0.26, 0.55, 4500], [0.097, 0.2, -0.3, 4000], [0.14, 0.14, 0.4, 3000]] });
  const hallRet = ctx.createGain(); hallRet.gain.value = 0.6;
  mDry.connect(mDuck); mSend.connect(hall); hall.connect(hallRet); hallRet.connect(mDuck);

  const sDry = ctx.createGain(), sSend = ctx.createGain(), sOut = ctx.createGain();
  const air = ctx.createConvolver(); air.normalize = false;
  // open sea: a wide diffuse tail with slow returns off the far ships and cliffs
  air.buffer = makeIR(ctx, { dur: 3.2, rt60: 2.0, pre: 0.02, fHi: 5200, fLo: 700, darken: 0.5, diffuse: 0.6, fadeIn: 0.03, seed: 11,
    early: [[0.13, 0.42, -0.5, 3500], [0.24, 0.32, 0.6, 3000], [0.39, 0.22, -0.2, 2400], [0.62, 0.14, 0.4, 2000], [0.9, 0.08, -0.6, 1500]] });
  const airRet = ctx.createGain(); airRet.gain.value = 0.5;
  sDry.connect(sOut); sSend.connect(air); air.connect(airRet); airRet.connect(sOut);
  const uDry = ctx.createGain(), uSend = ctx.createGain();
  const deep = ctx.createConvolver(); deep.normalize = false;
  // inside the water: no highs at all, long and close
  deep.buffer = makeIR(ctx, { dur: 3.6, rt60: 2.6, pre: 0.01, fHi: 1200, fLo: 260, darken: 0.4, fadeIn: 0.05, seed: 23 });
  const deepRet = ctx.createGain(); deepRet.gain.value = 0.7;
  uDry.connect(sOut); uSend.connect(deep); deep.connect(deepRet); deepRet.connect(sOut);

  const merger = ctx.createChannelMerger(4), spM = ctx.createChannelSplitter(2), spS = ctx.createChannelSplitter(2);
  mDuck.connect(spM); spM.connect(merger, 0, 0); spM.connect(merger, 1, 1);
  sOut.connect(spS); spS.connect(merger, 0, 2); spS.connect(merger, 1, 3);
  merger.connect(ctx.destination);

  // ---------------- music
  let t = now();
  const music = { dry: new Bus(LENGTH), send: new Bus(LENGTH) };
  const musicReport = buildMusic(CUES, music);
  play(ctx, toBuffer(ctx, music.dry), mDry); play(ctx, toBuffer(ctx, music.send), mSend);
  tm.music = now() - t; log(`music built in ${(tm.music / 1000).toFixed(1)} s`);

  // ---------------- effects
  t = now();
  const send = new Bus(LENGTH), uSendB = new Bus(LENGTH);
  const G = { amb: { dry: new Bus(LENGTH), send }, key: { dry: new Bus(LENGTH), send }, under: { dry: new Bus(LENGTH), send: uSendB }, uhi: { dry: new Bus(LENGTH), send: new Bus(LENGTH) } };
  const fx = buildSfx(CUES, G);
  const sfxDry = new Bus(LENGTH);
  addBus(sfxDry, G.amb.dry); addBus(sfxDry, G.key.dry);
  play(ctx, toBuffer(ctx, sfxDry), sDry); play(ctx, toBuffer(ctx, send), sSend);
  play(ctx, toBuffer(ctx, G.under.dry), uDry); play(ctx, toBuffer(ctx, uSendB), uSend);
  tm.sfx = now() - t; log(`effects built in ${(tm.sfx / 1000).toFixed(1)} s`);

  // ---------------- ducking
  const curve = duckCurve(fx.ducks);
  mDuck.gain.value = curve[0];
  mDuck.gain.setValueCurveAtTime(curve, 0, DURATION);

  const stemLoud = { amb: shortTerm(G.amb.dry.L, G.amb.dry.R, 1), key: shortTerm(G.key.dry.L, G.key.dry.R, 1), under: shortTerm(G.under.dry.L, G.under.dry.R, 1) };

  // ---------------- render
  t = now();
  const out = await ctx.startRendering();
  tm.render = now() - t; log(`offline render ${(tm.render / 1000).toFixed(1)} s`);
  const mL = out.getChannelData(0), mR = out.getChannelData(1), sL = out.getChannelData(2), sR = out.getChannelData(3);

  // ---------------- perspective and silence (after the reverbs, so the gaps are real)
  t = now();
  sweepLP(mL, mR, curveHz(MUFFLE_M), 0.05); sweepLP(sL, sR, curveHz(MUFFLE_S), 0.03);
  // what lives in the water itself sits behind no surface, so it goes in after the muffling
  for (let i = 0; i < LENGTH; i++) { sL[i] += G.uhi.dry.L[i]; sR[i] += G.uhi.dry.R[i]; }
  const C = CUES, w = C.cloudSplit + 0.6;
  const GAPS = [
    [w - 0.26, w - 0.012, -34, 0.008],                       // the sky holds its breath, then the whoosh
    [C.mawRises - 0.4, C.mawRises - 0.015, -22, 0.01],       // the intake before the maw
    [C.belly - 0.26, C.belly - 0.012, -13, 0.03, 0.008],            // the score lets go, then the glass
    [49.33 - 0.18, 49.33 - 0.01, -11, 0.02, 0.006],                 // the crest hangs before the fog
    [C.reentry + 0.06, C.reentry + 0.38, -28, 0.01],         // gap, thump, the long fall
    [57.1, 57.72, -8, 0.3, 0.008],                                  // the canyon empties before the plasma cut
    [C.impact - 0.42, C.impact - 0.012, -22, 0.1, 0.008],           // near silence before the hit
    // a blink of nothing in front of every big hit: the hit is only as big as the drop into it
    ...[[C.release, -7, 0.09], [C.breach, -6, 0.09], [C.breachTop, -4, 0.07], [C.shipStands, -5, 0.09], [C.whalesDive + 0.45, -6, 0.11], [C.pierce, -8, 0.12], [C.rockBurst, -6, 0.1], [C.flip, -6, 0.1]].map(([t, d, w0]) => [t - w0, t - 0.01, d, 0.02, 0.008]),
    [C.tipOut - 0.17, C.tipOut - 0.01, -15, 0.02, 0.008],           // one held breath, then the barbs
    [C.surfaceBurst - 0.1, C.surfaceBurst - 0.01, -9, 0.06, 0.008], // a calm sea for a moment
    [C.crash - 0.24, C.crash - 0.01, -11, 0.03, 0.008],             // it hangs; then the wall
  ];
  carve(mL, mR, GAPS); carve(sL, sR, GAPS);
  stemLoud.music = shortTerm(mL, mR, 1); stemLoud.sfx = shortTerm(sL, sR, 1);

  // ---------------- master
  const L = new Float32Array(LENGTH), R = new Float32Array(LENGTH);
  // everything below 32 Hz only eats headroom: the weight of this film lives at 45-90 Hz
  { const hl = [Biquad.hp(32, 0.54), Biquad.hp(32, 1.31)], hr = [Biquad.hp(32, 0.54), Biquad.hp(32, 1.31)]; for (let i = 0; i < LENGTH; i++) { L[i] = hl[1].run(hl[0].run(mL[i] + sL[i])); R[i] = hr[1].run(hr[0].run(mR[i] + sR[i])); } }
  monoLows(L, R, 100);
  // the reference's balance: tame the throat of the brass and choir, take the hiss off the water
  eq(L, R, () => [Biquad.peak(46, 1.4, -2), Biquad.peak(300, 0.9, -1.8), Biquad.peak(650, 1.3, -3.2), Biquad.hishelf(8000, -4.5)]);
  const rawLufs = lufs(L, R), rawPeak = gainToDb(peakOf(L, R));
  { const k = dbToGain(-18 - rawLufs); for (let i = 0; i < LENGTH; i++) { L[i] *= k; R[i] *= k; } }
  const grGlue = glue(L, R, { thr: -21, ratio: 2.2, knee: 10, att: 0.03, rel: 0.28, look: 0.006 });
  const ceil = dbToGain(CEILING_DB);
  // the order of importance: impact, pierce and crash stand above everything else in the film
  const hg = hitCurve([[C.release, 2, 0.22], [w, 1, 0.28], [C.sonicFlash, 2, 0.2], [C.mawRises, 0.8, 0.3], [C.breach, 1, 0.4], [C.breachTop, 0.6, 0.3], [C.shipStands, 0.8, 0.3], [C.whalesDive + 0.45, 1.5, 0.25], [C.impact, 4.8, 0.36], [C.pierce, 4.4, 0.42], [C.rockBurst, 0.8, 0.3], [C.tipOut, -0.8, 0.2], [C.flip, 0.8, 0.3], [C.crash, 3, 0.5]], LENGTH);
  { for (let i = 0; i < LENGTH; i += 1) { const k = hg(i / SR); L[i] *= k; R[i] *= k; } }
  let g = dbToGain(TARGET_LUFS - lufs(L, R)), outL, outR, gr = 0, meas = 0;
  for (let it = 0; it < 6; it++) {
    outL = new Float32Array(LENGTH); outR = new Float32Array(LENGTH);
    for (let i = 0; i < LENGTH; i++) { outL[i] = L[i] * g; outR[i] = R[i] * g; }
    softClip(outL, outR, 0.72);
    gr = limit(outL, outR, ceil, 0.004, 0.12);
    meas = lufs(outL, outR);
    if (Math.abs(meas - TARGET_LUFS) < 0.05) break;
    g *= dbToGain(TARGET_LUFS - meas);
  }
  // final cut: the picture ends on the wall of water, so the sound goes with it
  const fi = Math.round(0.01 * SR), f0 = Math.round((DURATION - 0.46) * SR);
  for (let i = 0; i < fi; i++) { const k = i / fi; outL[i] *= k; outR[i] *= k; }
  for (let i = f0; i < LENGTH; i++) { const u = (i - f0) / (LENGTH - 1 - f0), k = Math.cos(u * Math.PI / 2) ** 2; outL[i] *= k; outR[i] *= k; }
  outL[LENGTH - 1] = 0; outR[LENGTH - 1] = 0;
  const finalLufs = lufs(outL, outR), finalPeak = gainToDb(peakOf(outL, outR));
  tm.master = now() - t;

  const report = {
    sampleRate: SR, samples: LENGTH, seconds: LENGTH / SR,
    lufs: +finalLufs.toFixed(2), peakDb: +finalPeak.toFixed(2), masterGainDb: +gainToDb(g).toFixed(2), limiterGrDb: +gr.toFixed(2), glueGrDb: +grGlue.toFixed(2),
    rawLufs: +rawLufs.toFixed(2), rawPeakDb: +rawPeak.toFixed(2),
    shortTerm: shortTerm(outL, outR, 1), stems: stemLoud,
    musicStemLufs: +lufs(mL, mR).toFixed(2), sfxStemLufs: +lufs(sL, sR).toFixed(2),
    ducks: fx.ducks.map((d) => d.map((x) => +(+x).toFixed(3))),
    cues: [...musicReport.map(([x, l]) => [x, 'MUSIC', l]), ...fx.report.map(([x, l]) => [x, 'SFX', l])].sort((a, b) => a[0] - b[0]),
    gaps: GAPS.map((x) => x.map((y) => +y.toFixed(3))),
    shots: SHOTS.map((s) => [s.name, s.start, s.end]),
    timingsMs: { ...tm, total: now() - T0 },
  };
  const res = { report, wav: encodeWav([outL, outR]), L: outL, R: outR };
  if (opts.stems) {
    const st = (a, b) => { const x = new Float32Array(LENGTH), y = new Float32Array(LENGTH), k = dbToGain(-18 - rawLufs) * g; for (let i = 0; i < LENGTH; i++) { x[i] = a[i] * k; y[i] = b[i] * k; } return encodeWav([x, y]); };
    res.stems = { music: st(mL, mR), sfx: st(sL, sR) };
  }
  return res;
}
