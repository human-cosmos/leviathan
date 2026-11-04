// Render the soundtrack: out/soundtrack.wav (48 kHz, 16-bit stereo, exactly 83.000 s).
//   node tools/render-audio.mjs [--out out/soundtrack.wav] [--stems] [--no-check] [--no-spectrum]
// 1. opens audio.html headless and renders the OfflineAudioContext mix.
// 2. writes the WAV and the cue sheet (out/audio/cuesheet.txt).
// 3. verifies duration (ffprobe), peak (volumedetect), loudness and true peak (ebur128).
// 4. draws annotated spectrograms and a side by side with the reference (out/audio/*.jpg).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, serve, launch } from './env.mjs';

const args = process.argv.slice(2);
const opt = { out: 'out/soundtrack.wav', stems: false, check: true, spectrum: true };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') opt.out = args[++i];
  else if (a === '--stems') opt.stems = true;
  else if (a === '--no-check') opt.check = false;
  else if (a === '--no-spectrum') opt.spectrum = false;
  else { console.error('unknown option ' + a); process.exit(2); }
}
const OUT = path.resolve(ROOT, opt.out), ADIR = path.join(ROOT, 'out', 'audio');
fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.mkdirSync(ADIR, { recursive: true });
const T0 = Date.now(), log = (m) => console.log(`[audio ${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}`);

const srv = await serve();
const browser = await launch();
let errors = [];
try {
  // ------------------------------------------------ 1. render
  const page = await browser.newPage();
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${t}`); else if (m.type() === 'log') log('page: ' + t); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(`${srv.url}/audio.html?headless=1`, { waitUntil: 'load', timeout: 600000 });
  await page.waitForFunction('window.AUDIO_READY === true', { timeout: 120000 });
  const res = await page.evaluate((o) => window.AUDIO.render(o), { stems: opt.stems });
  const fetchB64 = async (which) => {
    const n = await page.evaluate((w) => window.AUDIO.size(w), which), parts = [];
    for (let i = 0; i < n; i += 4_000_000) parts.push(await page.evaluate((i, w) => window.AUDIO.chunk(i, 4_000_000, w), i, which));
    return Buffer.from(parts.join(''), 'base64');
  };
  fs.writeFileSync(OUT, await fetchB64('mix'));
  log(`wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB)`);
  if (opt.stems) for (const k of ['music', 'sfx']) fs.writeFileSync(path.join(ADIR, `stem_${k}.wav`), await fetchB64(k));
  const rep = res.report;
  fs.writeFileSync(path.join(ADIR, 'report.json'), JSON.stringify(rep, null, 1));
  const sheet = [
    `LEVIATHAN — soundtrack cue sheet`,
    `${rep.seconds.toFixed(3)} s, ${rep.sampleRate} Hz stereo; ${rep.lufs} LUFS integrated, sample peak ${rep.peakDb} dBFS (limiter ${rep.limiterGrDb} dB)`,
    `glue ${rep.glueGrDb} dB, limiter ${rep.limiterGrDb} dB; music stem ${rep.musicStemLufs} LUFS, sfx stem ${rep.sfxStemLufs} LUFS`,
    '', ...rep.cues.map(([t, k, l]) => `${t.toFixed(2).padStart(6)}  ${k.padEnd(5)}  ${l}`),
  ].join('\n');
  fs.writeFileSync(path.join(ADIR, 'cuesheet.txt'), sheet + '\n');
  console.log('\n' + sheet + '\n');
  console.log('short-term LUFS (1 s):', rep.shortTerm.join(' '));
  for (const [k, v] of Object.entries(rep.stems)) console.log(`  stem ${k.padEnd(5)}:`, v.join(' '));
  console.log(`stems integrated: music ${rep.musicStemLufs} LUFS, sfx ${rep.sfxStemLufs} LUFS (pre-master)`);
  console.log('timings (ms):', JSON.stringify(rep.timingsMs));
  await page.close();
} finally {
  await browser.close(); srv.close();
}
if (errors.length) { console.log(`\npage console errors/warnings (${errors.length}):\n  ` + errors.join('\n  ')); }
else console.log('\npage console: 0 errors, 0 warnings');

// ------------------------------------------------ 3. verify with ffmpeg
const ff = (a) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
if (opt.check) {
  const pr = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,channels,duration_ts,duration,bits_per_sample,codec_name', '-of', 'json', OUT], { encoding: 'utf8' });
  const s = JSON.parse(pr).streams[0];
  console.log(`ffprobe: ${s.codec_name} ${s.sample_rate} Hz ${s.channels} ch ${s.bits_per_sample}-bit, ${s.duration_ts} samples = ${s.duration} s`);
  const vd = ff(['-i', OUT, '-af', 'volumedetect', '-f', 'null', '-']).stderr;
  console.log('volumedetect:', (vd.match(/(mean_volume|max_volume): [-\d.]+ dB/g) || []).join(', '));
  const eb = ff(['-i', OUT, '-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr;
  const sum = eb.slice(eb.lastIndexOf('Summary:'));
  console.log('ebur128:', sum.replace(/\s+/g, ' ').trim());
}
// ------------------------------------------------ 4. annotated spectrograms + reference comparison
if (opt.spectrum) {
  const { CUES, SHOTS, DURATION } = await import(pathToFileURL(path.join(ROOT, 'src/shots.js')).href);
  const font = 'C\\:/Windows/Fonts/arial.ttf';
  const REF = path.join(ADIR, 'ref', 'ref.wav');
  const views = [['full', 0, DURATION, 2520], ['a_0-16', 0, 16, 2100], ['b_14-34', 14, 34, 2100], ['c_33-52', 33, 52, 2100], ['d_51-66', 51, 66, 2100], ['e_65-83', 65, 83, 2100]];
  for (const [name, a, b, w] of views) {
    const h = 760, png = path.join(ADIR, `spectrum_${name}.png`), jpg = path.join(ADIR, `spectrum_${name}.jpg`);
    const sp = `showspectrumpic=s=${w}x${h}:legend=0:mode=combined:scale=log:fscale=log:color=intensity:drange=100:win_func=hann`;
    const r1 = ff(['-y', '-ss', String(a), '-t', String(b - a), '-i', OUT, '-lavfi', sp, png]);
    if (r1.status !== 0) { console.log('spectrum failed:', r1.stderr.slice(-400)); break; }
    const X = (t) => Math.round((t - a) / (b - a) * w), f = [];
    SHOTS.forEach((s) => { if (s.start > a && s.start < b) f.push(`drawbox=x=${X(s.start)}:y=0:w=2:h=ih:color=white@0.5:t=fill`); if (name !== 'full' && s.end > a && s.start < b) f.push(`drawtext=fontfile='${font}':text='${s.id}':x=${Math.max(4, X(Math.max(a, s.start)) + 5)}:y=6:fontsize=18:fontcolor=white`); });
    Object.entries(CUES).forEach(([n, t], i) => { if (t > a && t < b) { f.push(`drawbox=x=${X(t)}:y=${h - 150}:w=2:h=150:color=yellow@0.9:t=fill`); f.push(`drawtext=fontfile='${font}':text='${n}':x=${X(t) + 4}:y=${h - 148 + (i % 4) * 30}:fontsize=${name === 'full' ? 13 : 17}:fontcolor=yellow:box=1:boxcolor=black@0.5`); } });
    const script = path.join(ADIR, `spectrum_${name}.filter`);
    fs.writeFileSync(script, f.join(String.fromCharCode(44, 10)));
    const r2 = ff(['-y', '-i', png, '-/vf', script, '-q:v', '3', jpg]);
    if (r2.status !== 0) console.log('annotate failed:', r2.stderr.slice(-600)); else { fs.unlinkSync(png); console.log('spectrogram', path.relative(ROOT, jpg)); }
  }
  if (fs.existsSync(REF)) {
    const cmp = path.join(ADIR, 'compare_ref.jpg');
    const r = ff(['-y', '-i', OUT, '-i', REF, '-filter_complex', '[0:a]showspectrumpic=s=2300x420:legend=0:mode=combined:scale=log:fscale=log:color=intensity:drange=100,format=rgb24[a];[1:a]showspectrumpic=s=2300x420:legend=0:mode=combined:scale=log:fscale=log:color=intensity:drange=100,format=rgb24[b];[0:a]showwavespic=s=2300x170:split_channels=0:colors=0x6db7ea,format=rgb24[c];[1:a]showwavespic=s=2300x170:split_channels=0:colors=0xf08a5d,format=rgb24[d];[c][a][d][b]vstack=inputs=4', '-frames:v', '1', '-q:v', '3', cmp]);
    console.log(r.status === 0 ? 'comparison ' + path.relative(ROOT, cmp) : 'comparison failed: ' + r.stderr.slice(-500));
  }
}
// ------------------------------------------------ 5. loudness envelope against the reference
{
  const REF = path.join(ADIR, 'ref', 'ref.wav');
  if (opt.spectrum && fs.existsSync(REF)) {
    const curve = (f) => { const r = ff(['-i', f, '-af', 'ebur128=framelog=info', '-f', 'null', '-']).stderr, o = []; for (const m of r.matchAll(/t:\s*([\d.]+)\s+TARGET.*?M:\s*(-?[\d.]+)/g)) o.push([+m[1], +m[2]]); return o; };
    const a = curve(OUT), b = curve(REF), n = Math.min(a.length, b.length), rows = ['sec   ours    ref   diff (momentary LUFS, 400 ms, mean per second)'];
    const mean = (c, t) => { const v = c.filter(([x]) => x >= t && x < t + 1).map(([, y]) => y); return v.reduce((p, q) => p + q, 0) / Math.max(1, v.length); };
    for (let t = 0; t < 83; t++) { const x = mean(a, t), y = mean(b, t); rows.push(`${String(t).padStart(3)} ${x.toFixed(1).padStart(6)} ${y.toFixed(1).padStart(6)} ${(x - y).toFixed(1).padStart(6)}`); }
    const X = a.slice(0, n).map((p) => Math.max(-40, p[1])), Y = b.slice(0, n).map((p) => Math.max(-40, p[1])), mx = X.reduce((p, q) => p + q, 0) / n, my = Y.reduce((p, q) => p + q, 0) / n;
    let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (X[i] - mx) * (Y[i] - my); sxx += (X[i] - mx) ** 2; syy += (Y[i] - my) ** 2; }
    rows.push(`correlation of the momentary curves: ${(sxy / Math.sqrt(sxx * syy)).toFixed(3)}`);
    fs.writeFileSync(path.join(ADIR, 'envelope_compare.txt'), rows.join('\n') + '\n'); console.log('envelope out/audio/envelope_compare.txt, ' + rows[rows.length - 1]);
  }
}
log('done');
