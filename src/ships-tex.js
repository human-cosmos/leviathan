import * as THREE from 'three';
import { Rng } from './util.js';

// Painted surfaces for the fleet: hull sides, container logos, foam masks.

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Hull side, two rows: top row is the side seen with the bow on the right, bottom
// row with the bow on the left. y range -14 .. +26 m, z range -150 .. +150 m.
export const HULL_MAP = { y0: -14, y1: 26 };
export function hullTexture(o = {}) {
  const W = 4096, RH = 512;
  const [c, g] = canvas(W, RH * 2);
  const hull = o.hull ?? '#1c49a0', anti = o.anti ?? '#c43a2b', boot = o.boot ?? '#f4efe2', line = o.line ?? 'KAIYO', ship = o.name ?? 'KAIYO STAR';
  const rng = new Rng(o.seed ?? 7);
  const drawRow = (top, bowRight) => {
    const yy = (m) => top + (HULL_MAP.y1 - m) / (HULL_MAP.y1 - HULL_MAP.y0) * RH;
    const xx = (z) => (bowRight ? (z + 150) : (150 - z)) / 300 * W;
    g.save();
    g.beginPath(); g.rect(0, top, W, RH); g.clip();
    g.fillStyle = hull; g.fillRect(0, top, W, RH);
    // a lighter tone along the sheer, sun bleached
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, yy(26), W, yy(13) - yy(26));
    g.fillStyle = 'rgba(0,0,10,0.16)'; g.fillRect(0, yy(4.6), W, yy(2.4) - yy(4.6));
    // anti-fouling, boot top
    g.fillStyle = anti; g.fillRect(0, yy(2.0), W, RH);
    g.fillStyle = boot; g.fillRect(0, yy(2.5), W, yy(2.0) - yy(2.5));
    g.fillStyle = 'rgba(40,0,0,0.25)';
    for (let i = 0; i < 40; i++) { const x = rng.range(0, W); g.fillRect(x, yy(1.7), rng.range(30, 160), rng.range(2, 6)); }
    // plate seams and frames
    g.strokeStyle = 'rgba(6,10,30,0.35)'; g.lineWidth = 1.2;
    for (let y = -12; y < 26; y += 3.1) { g.beginPath(); g.moveTo(0, yy(y)); g.lineTo(W, yy(y)); g.stroke(); }
    g.strokeStyle = 'rgba(6,10,30,0.22)';
    for (let z = -150; z < 150; z += 11.5) { g.beginPath(); g.moveTo(xx(z), yy(26)); g.lineTo(xx(z), yy(-14)); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 1;
    for (let y = -12; y < 26; y += 3.1) { g.beginPath(); g.moveTo(0, yy(y) + 1.6); g.lineTo(W, yy(y) + 1.6); g.stroke(); }
    // deck edge strake
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(0, yy(15.3), W, 3);
    // rust runs from scuppers and hawse
    for (let i = 0; i < 90; i++) {
      const x = rng.range(0, W), y0 = yy(rng.range(4, 15)), h = rng.range(20, 150), w = rng.range(2, 8);
      g.fillStyle = `rgba(${130 + rng.int(0, 50)},${50 + rng.int(0, 30)},30,${rng.range(0.25, 0.6)})`;
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x + w, y0); g.lineTo(x + w * 0.6, y0 + h); g.lineTo(x + w * 0.2, y0 + h * 0.8); g.fill();
    }
    // chafe marks where tugs and fenders pushed
    for (let i = 0; i < 14; i++) {
      const x = rng.range(100, W - 100), y0 = yy(rng.range(3, 10));
      g.fillStyle = `rgba(190,190,200,${rng.range(0.12, 0.3)})`;
      for (let k = 0; k < 7; k++) g.fillRect(x + rng.range(-40, 40), y0 + rng.range(-16, 16), rng.range(6, 50), rng.range(1, 3));
    }
    // big company lettering
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 104px Impact, "Arial Black", sans-serif`;
    const lx = xx(-10);
    g.save(); g.translate(lx, yy(8.8)); g.scale(1.9, 1); g.fillText(line, 0, 0); g.restore();
    // bow name
    g.font = `700 26px "Arial Black", Arial, sans-serif`;
    g.fillText(ship, xx(112), yy(21));
    // bow thruster mark
    const bx = xx(126), by = yy(5.5);
    g.strokeStyle = '#ffffff'; g.lineWidth = 4;
    g.beginPath(); g.arc(bx, by, 24, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(bx - 17, by - 17); g.lineTo(bx + 17, by + 17); g.moveTo(bx + 17, by - 17); g.lineTo(bx - 17, by + 17); g.stroke();
    // draft marks
    g.font = `700 13px Arial, sans-serif`;
    for (const z of [-140, 2, 135]) {
      for (let m = -10; m <= 8; m += 2) {
        g.fillStyle = m < 2 ? '#ffffff' : '#ffffff';
        g.fillText(String(m + 12) + 'M', xx(z), yy(m));
        g.fillRect(xx(z) - 16, yy(m + 0.9), 7, 1.6);
      }
    }
    // plimsoll
    const px = xx(4), py = yy(6);
    g.strokeStyle = '#fff'; g.lineWidth = 2.4;
    g.beginPath(); g.arc(px, py, 13, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#fff'; g.fillRect(px - 22, py - 1.5, 44, 3);
    g.restore();
  };
  drawRow(0, true);
  drawRow(RH, false);
  return tex(c);
}

// Fictional shipping lines, one logo per row; row 7 holds the door codes.
const LINES = [
  ['KAIYO', 0], ['TRITON', 1], ['NEREID', 2], ['ORCADIA', 0], ['MARLIN', 1], ['TETHYS', 2], ['HOKUTO', 0],
];
export function logoAtlas() {
  const W = 2048, R = 256;
  const [c, g] = canvas(W, R * 8);
  g.clearRect(0, 0, W, R * 8);
  g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  g.textBaseline = 'middle';
  LINES.forEach(([name, style], i) => {
    const y = (i + 1) * R + R / 2;
    if (style === 0) {
      g.font = `900 190px Impact, "Arial Black", sans-serif`;
      g.textAlign = 'center';
      g.save(); g.translate(W / 2, y); g.scale(1.5, 1); g.fillText(name, 0, 4); g.restore();
    } else if (style === 1) {
      g.beginPath(); g.arc(250, y, 105, 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.moveTo(170, y + 80); g.bezierCurveTo(240, y - 60, 300, y + 60, 355, y - 70); g.lineWidth = 34; g.stroke();
      g.globalCompositeOperation = 'source-over';
      g.font = `900 170px Impact, "Arial Black", sans-serif`;
      g.textAlign = 'left';
      g.save(); g.translate(410, y); g.scale(1.38, 1); g.fillText(name, 0, 4); g.restore();
    } else {
      g.font = `italic 900 170px "Arial Black", Impact, sans-serif`;
      g.textAlign = 'center';
      g.save(); g.translate(W / 2, y - 18); g.scale(1.1, 1); g.fillText(name, 0, 0); g.restore();
      g.fillRect(250, y + 86, W - 500, 18);
    }
  });
  // row 7 of the shader = canvas row 0 flipped: door lettering lives at the top of the canvas
  g.clearRect(0, 0, W, R);
  g.textAlign = 'right';
  g.font = `700 92px Arial, sans-serif`;
  g.fillText('CERU 428361 7', W - 60, 62);
  g.font = `700 70px Arial, sans-serif`;
  g.fillText('45G1', W - 60, 168);
  g.fillText('MAX 30480', W - 460, 168);
  return tex(c);
}

// Foam mask around a ship in plan view. u along the ship (bow at u = 0),
// v across. Plane covers x ±130, z from +190 (ahead) to -1010 (astern).
export const WAKE = { xw: 130, zAhead: 190, zAstern: -1010 };
export function wakeTexture(halfBeam) {
  const W = 2048, Hh = 512;
  const [c, g] = canvas(W, Hh);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, Hh);
  const X = (z) => (WAKE.zAhead - z) / (WAKE.zAhead - WAKE.zAstern) * W;
  const Y = (x) => (x + WAKE.xw) / (2 * WAKE.xw) * Hh;
  const stroke = (pts, w, a, blur) => {
    g.filter = `blur(${blur}px)`;
    g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(X(z), Y(x)) : g.moveTo(X(z), Y(x)))); g.stroke();
    g.filter = 'none';
  };
  // collar hugging the hull at the waterline
  for (const s of [-1, 1]) {
    const pts = [];
    for (let z = 147; z >= -146; z -= 8) pts.push([s * (halfBeam(z, 0) + 2.5), z]);
    stroke(pts, 7, 0.95, 3);
    // bow wave: a thrown-out moustache that falls away down the first third of the hull
    const pts2 = [];
    for (let z = 150; z >= 40; z -= 8) { const u = (150 - z) / 110; pts2.push([s * (halfBeam(z, 0) + 6 + 9 * Math.sqrt(u)), z]); }
    stroke(pts2, 14, 0.8, 6);
    // the diverging wave: soft broad patches that widen, curve and die, never a ruled line
    for (let k = 0; k < 9; k++) {
      const u = k / 8, z0 = 120 - k * 60, z1 = z0 - 54;
      const x0 = halfBeam(Math.max(z0, -140), 0) + 8 + 92 * Math.pow(u, 0.75), x1 = halfBeam(Math.max(z1, -140), 0) + 8 + 92 * Math.pow(u + 0.11, 0.75);
      stroke([[s * x0, z0], [s * (x0 + x1) * 0.5 + s * 3, (z0 + z1) * 0.5], [s * x1, z1]], 10 + 26 * u, 0.5 * (1 - u) * (1 - u) + 0.05, 8 + 8 * u);
    }
  }
  // churned track astern, narrow at the rudder and fanning out
  for (let k = 0; k < 7; k++) {
    const z0 = -150 - k * 70, z1 = z0 - 90, u = k / 6;
    stroke([[0, z0], [0, z1]], 26 + 70 * u, 0.62 * (1 - u) + 0.08, 8 + 8 * u);
  }
  // fade to nothing far astern
  const gr = g.createLinearGradient(X(-250), 0, X(WAKE.zAstern), 0);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
  const t = tex(c);
  t.flipY = false;
  return t;
}
