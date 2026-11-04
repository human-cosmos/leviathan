// Build dist/sunshower.html: one self-contained page that plays Sunshower offline.
//
//   node tools/build-player.mjs                               out/sunshower.mp4 -> dist/sunshower.html
//   node tools/build-player.mjs --poster-shot rainbow@0.7     poster from 70 % into the 'rainbow' shot
//   node tools/build-player.mjs --video out/test.mp4 --out dist/test.html
//
// The MP4 goes into the page as base64 inside <script type="text/plain" id="reel"> and is turned
// into a Blob URL at load; the poster is a JPEG data URI cut from the master video at an exact
// film frame. The page template is player/player.html (%%POSTER%%, %%POSTER_ALT%%, %%DURATION%%,
// %%DURATION_S%%, %%REEL%%).
//
// Poster: by default film time 33.5 s (inside the 'rainbow' shot, the rainbow nearly full).
// Film frames are mapped to video frames through the manifest tools/render.mjs writes next to the
// video (out/<name>.json), so a partial render works too; when the poster frame is not in the
// video, the middle frame is used and a warning is printed.
//
// Size: the master (crf 16, with per-frame grain) can be large. When it is bigger than --max-mb,
// a web copy is made with two-pass x264 at the bitrate that fits (out/delivery/web/, cached), so
// the page stays well below GitHub's 100 MB file limit. The player adds its own live grain on top.
//
// Options
//   --video FILE        master video                       (default out/sunshower.mp4)
//   --out FILE          page to write                      (default dist/sunshower.html)
//   --poster-time S     film second for the poster         (default 33.5)
//   --poster-frame N    film frame for the poster
//   --poster-shot NAME[@F]  fraction F (default 0.67) into shot NAME of src/shots.js
//   --poster FILE       use this JPEG as the poster instead
//   --max-mb M          budget for the embedded MP4 in MB  (default 60 -> page ~ 80 MB)
//   --crf N             web copy at constant quality N instead of a size budget
//   --copy              embed the master as it is
//   --preset P          x264 preset for the web copy       (default slow)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const o = { video: 'out/leviathan.mp4', out: 'dist/leviathan.html', posterTime: 41.0, posterFrame: null, posterShot: null, poster: null,
  maxMb: 60, crf: null, copy: false, preset: 'slow' };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], v = () => argv[++i];
  if (a === '--video') o.video = v();
  else if (a === '--out') o.out = v();
  else if (a === '--poster-time') o.posterTime = parseFloat(v());
  else if (a === '--poster-frame') o.posterFrame = parseInt(v(), 10);
  else if (a === '--poster-shot') o.posterShot = v();
  else if (a === '--poster') o.poster = v();
  else if (a === '--max-mb') o.maxMb = parseFloat(v());
  else if (a === '--crf') o.crf = parseFloat(v());
  else if (a === '--copy') o.copy = true;
  else if (a === '--preset') o.preset = v();
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\nimport ')[0].replace(/^\/\/ ?/gm, '')); process.exit(0); }
  else { console.error(`unknown option ${a} (see --help)`); process.exit(2); }
}
const T0 = Date.now();
const rel = (f) => path.relative(ROOT, f);
const MB = (n) => (n / 1e6).toFixed(1) + ' MB';
const video = path.resolve(ROOT, o.video);
if (!fs.existsSync(video)) { console.error(`no video at ${rel(video)} - run tools/render.mjs first`); process.exit(1); }
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });

// ------------------------------------------------------------------ probe
function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-show_entries',
    'stream=codec_type,codec_name,width,height,r_frame_rate,bit_rate,nb_read_packets:format=duration,size', '-of', 'json', file], { encoding: 'utf8' }));
  const vs = j.streams.find((s) => s.codec_type === 'video'), as = j.streams.find((s) => s.codec_type === 'audio');
  const [n, d] = vs.r_frame_rate.split('/').map(Number);
  return { duration: parseFloat(j.format.duration), size: parseInt(j.format.size, 10), fps: n / (d || 1), frames: parseInt(vs.nb_read_packets, 10),
    w: vs.width, h: vs.height, vcodec: vs.codec_name, audio: as ? { codec: as.codec_name, bitrate: parseInt(as.bit_rate || '256000', 10) } : null };
}
const src = probe(video);
console.log(`master ${rel(video)}: ${src.w}x${src.h} ${src.vcodec} @ ${src.fps} fps, ${src.frames} frames, ${src.duration.toFixed(2)} s, ${MB(src.size)}, ${src.audio ? 'audio ' + src.audio.codec : 'no audio'}`);
if (src.vcodec !== 'h264') console.warn('  warning: the master is not H.264; browsers may not play it');
if (!src.audio) console.warn('  note: the master has no soundtrack (render with out/soundtrack.wav present to mux one)');

// film frame -> video frame, via the manifest render.mjs writes (out/<name>.json)
const manifest = (() => { try { return JSON.parse(fs.readFileSync(path.join(path.dirname(video), path.basename(video, '.mp4').replace(/_video$/, '') + '.json'), 'utf8')); } catch { return null; } })();
const ranges = manifest?.ranges ?? [[0, src.frames]];
const fps = manifest?.fps ?? src.fps;
function videoIndex(f) { let off = 0; for (const [a, b] of ranges) { if (f >= a && f < b) return off + f - a; off += b - a; } return -1; }
if (manifest?.filmFrames && ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] === manifest.filmFrames) console.log(`  the whole film (${manifest.filmFrames} frames)`);
else if (manifest) console.log(`  partial render: film frames ${ranges.map(([a, b]) => `[${a}, ${b})`).join(' ')}`);

// shots from src/shots.js (parsed as text: importing it would pull in three.js)
const shots = (() => {
  try {
    const s = fs.readFileSync(path.join(ROOT, 'src/shots.js'), 'utf8'), list = [];
    for (const m of s.matchAll(/name:\s*'([^']+)'[^\n]*?start:\s*([\d.]+)[^\n]*?end:\s*([\d.]+)/g)) list.push({ name: m[1], start: +m[2], end: +m[3] });
    return list;
  } catch { return []; }
})();
const shotAt = (t) => shots.find((s) => t >= s.start && t < s.end)?.name ?? '?';

// ------------------------------------------------------------------ the embedded MP4
const WEB = path.join(ROOT, 'out/delivery/web');
let embed = video, how = 'master as is';
const budget = o.maxMb * 1e6;
if (!o.copy && (o.crf != null || src.size > budget)) {
  fs.mkdirSync(WEB, { recursive: true });
  const st = fs.statSync(video);
  const key = crypto.createHash('sha1').update(JSON.stringify([video, st.size, st.mtimeMs, o.crf, o.crf == null ? o.maxMb : 0, o.preset, 3])).digest('hex').slice(0, 10);
  const webFile = path.join(WEB, `${path.basename(video, '.mp4')}_web_${key}.mp4`);
  const common = ['-tune', 'animation', '-preset', o.preset, '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', String(Math.round(src.fps * 2)),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
  if (fs.existsSync(webFile)) how = 'cached web copy';
  else {
    const t = Date.now();
    const tmp = webFile.replace(/\.mp4$/, '.part.mp4');
    const audioArgs = src.audio ? ['-map', '0:a:0', '-c:a', src.audio.codec === 'aac' ? 'copy' : 'aac', ...(src.audio.codec === 'aac' ? [] : ['-b:a', '256k'])] : [];
    if (o.crf != null) {
      console.log(`web copy: x264 crf ${o.crf}, ${o.preset} ...`);
      ff(['-i', video, '-map', '0:v:0', ...audioArgs, '-c:v', 'libx264', '-crf', String(o.crf), ...common, '-movflags', '+faststart', tmp]);
    } else {
      const audioBits = src.audio ? (src.audio.codec === 'aac' ? src.audio.bitrate : 256000) : 0;
      const kbps = Math.floor((budget * 8 * 0.965 / src.duration - audioBits) / 1000);
      if (kbps < 500) { console.error(`--max-mb ${o.maxMb} is too small for ${src.duration.toFixed(0)} s of video`); process.exit(1); }
      console.log(`web copy: two-pass x264 at ${kbps} kb/s to fit ${o.maxMb} MB, ${o.preset} ...`);
      const plog = path.join(WEB, `pass_${key}`);
      const rate = ['-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 2.2)}k`, '-bufsize', `${Math.round(kbps * 4)}k`];
      ff(['-i', video, '-map', '0:v:0', '-c:v', 'libx264', ...rate, ...common, '-pass', '1', '-passlogfile', plog, '-an', '-f', 'null', '-']);
      ff(['-i', video, '-map', '0:v:0', ...audioArgs, '-c:v', 'libx264', ...rate, ...common, '-pass', '2', '-passlogfile', plog, '-movflags', '+faststart', tmp]);
      for (const f of fs.readdirSync(WEB)) if (f.startsWith(`pass_${key}`)) fs.rmSync(path.join(WEB, f), { force: true });
    }
    fs.renameSync(tmp, webFile);
    how = `web copy made in ${((Date.now() - t) / 1000).toFixed(0)} s`;
  }
  embed = webFile;
}
const web = probe(embed);
console.log(`embedding ${rel(embed)} (${how}): ${MB(web.size)}, ${(web.size * 8 / web.duration / 1e6).toFixed(2)} Mb/s`);

// ------------------------------------------------------------------ poster (from the master, not the web copy)
let posterBuf, posterFilm = null;
if (o.poster) posterBuf = fs.readFileSync(path.resolve(ROOT, o.poster));
else {
  if (o.posterFrame != null) posterFilm = o.posterFrame;
  else if (o.posterShot) {
    const [nm, fr] = o.posterShot.split('@');
    const s = shots.find((x) => x.name === nm);
    if (!s) { console.error(`no shot '${nm}' in src/shots.js (have: ${shots.map((x) => x.name).join(', ')})`); process.exit(2); }
    posterFilm = Math.round((s.start + (s.end - s.start) * (fr ? parseFloat(fr) : 0.67)) * fps);
  } else posterFilm = Math.round(o.posterTime * fps);
  let idx = videoIndex(posterFilm);
  if (idx < 0) {
    idx = Math.floor(src.frames / 2);
    let k = idx, f = idx; for (const [a, b] of ranges) { if (k < b - a) { f = a + k; break; } k -= b - a; }
    console.warn(`  poster frame ${posterFilm} is not in this video; using video frame ${idx} (film frame ${f})`); posterFilm = f;
  }
  fs.mkdirSync(WEB, { recursive: true });
  const pf = path.join(WEB, 'poster.jpg');
  // select by decoded frame number: exact, whatever the keyframe layout or audio priming
  ff(['-i', video, '-map', '0:v:0', '-vf', `select=eq(n\\,${idx}),scale=in_color_matrix=bt709:in_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=rgb24`,
    '-frames:v', '1', '-q:v', '2', '-update', '1', pf]);
  posterBuf = fs.readFileSync(pf);
  const t = posterFilm / fps;
  console.log(`poster: film frame ${posterFilm} (${t.toFixed(2)} s, shot '${shotAt(t)}', video frame ${idx}), ${(posterBuf.length / 1024).toFixed(0)} KB -> ${rel(pf)}`);
}

// ------------------------------------------------------------------ write the page
const tpl = fs.readFileSync(path.join(ROOT, 'player/player.html'), 'utf8');
for (const slot of ['%%POSTER%%', '%%POSTER_ALT%%', '%%DURATION%%', '%%REEL%%']) if (!tpl.includes(slot)) { console.error(`player/player.html has no ${slot} slot`); process.exit(1); }
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const filled = tpl
  .replace('%%POSTER%%', posterBuf.toString('base64'))
  .replaceAll('%%POSTER_ALT%%', 'A colossal sea monster breaches through a fleet of container ships under a bright blue sky')
  .replaceAll('%%DURATION_S%%', String(Math.round(web.duration)))
  .replaceAll('%%DURATION%%', fmt(web.duration));
const [head, tail] = filled.split('%%REEL%%');
const out = path.resolve(ROOT, o.out);
fs.mkdirSync(path.dirname(out), { recursive: true });
const tmpOut = out + '.part';
const fd = fs.openSync(tmpOut, 'w');
fs.writeSync(fd, head);
const bytes = fs.readFileSync(embed);
const CH = 3 * (1 << 20);                    // multiple of 3: chunked base64 concatenates cleanly
for (let i = 0; i < bytes.length; i += CH) fs.writeSync(fd, bytes.subarray(i, i + CH).toString('base64'));
fs.writeSync(fd, tail);
fs.closeSync(fd);
fs.renameSync(tmpOut, out);
const size = fs.statSync(out).size;
console.log(`wrote ${rel(out)}: ${MB(size)} (video ${MB(bytes.length)}, poster ${(posterBuf.length / 1024).toFixed(0)} KB) in ${((Date.now() - T0) / 1000).toFixed(1)} s`);
if (size > 100e6) console.warn('  note: over 100 MB - GitHub will not accept this file; lower --max-mb');
