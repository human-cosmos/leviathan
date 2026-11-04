import * as THREE from 'three';
import { Rng } from './util.js';

const INK = '#2a2236';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { mips = true, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.premultiplyAlpha = false;
  t.anisotropy = 8;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ foliage
// 4x6 atlas of painted clumps. r = tone, g = hue variation,
// b = blossom (128 = first blossom colour, 255 = second).
// Cells (index = col + row * 4, row 0 at the bottom of the texture):
//   0 round tree   1 bush        2 grass tuft   3 hanging vines
//   4 moss pad     5 flowers     6 sapling      7 bird nest
//   8 zelkova      9 pine        10 willow      11 twin young trees
//   12 reeds       13 ivy drape  14 bamboo      15 spreading shrub
//   16 hydrangea   17 flowering vine curtain    18 camphor giant  19 blossom tree
//   20 grass bank with wildflowers               21 morning-glory trellis
export function makeFoliageAtlas() {
  const cols = 4, rows = 6, S = 512;
  const [c, g] = canvas(cols * S, rows * S);
  const rng = new Rng(4242);
  const L = [-0.55, -0.7, 0.45];
  const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
  const toneVal = [0.12, 0.37, 0.62, 0.87];

  const cellOrigin = (idx) => {
    const cx = idx % cols, cyFromBottom = Math.floor(idx / cols);
    return [cx * S, (rows - 1 - cyFromBottom) * S];
  };
  const dab = (x, y, tone, hue, size, ang, bloom = 0, stretch = 0.45) => {
    g.fillStyle = `rgb(${Math.round(toneVal[tone] * 255)},${Math.round(hue * 255)},${bloom === 2 ? 255 : bloom ? 128 : 0})`;
    g.beginPath();
    g.ellipse(x, y, size, size * stretch, ang, 0, Math.PI * 2);
    g.fill();
  };
  // a mound made of spherical blobs, shaded by the light dir and quantised
  const clump = (ox, oy, blobs, o = {}) => {
    const dabs = [];
    for (const b of blobs) {
      // keep every billow inside its cell: a crown clipped by the cell edge reads as a
      // flat-topped block (the 'voxel' look); drapes get a rounded, scalloped top instead
      const topY = b.y - b.r * (b.sq ?? 1) * 1.04 - 14;
      if (topY < 0) b.y -= topY;
      const n = Math.floor(b.r * b.r * (o.density ?? 0.11) * (b.dens ?? 1));
      const sq = b.sq ?? 1;
      for (let i = 0; i < n; i++) {
        const a = rng.next() * Math.PI * 2, rr = Math.sqrt(rng.next()) * b.r * 1.04;
        const x = b.x + Math.cos(a) * rr, y = b.y + Math.sin(a) * rr * sq;
        const nx = (x - b.x) / b.r, ny = (y - b.y) / (b.r * sq);
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        let s = nx * L[0] + ny * L[1] + nz * L[2];
        s += rng.range(-0.18, 0.18) - (y - S * 0.5) / S * (o.vgrad ?? 0.35) + (b.lift ?? 0);
        // inner occlusion between blobs
        s -= (1 - nz) * 0.12;
        const tone = s < -0.05 ? 0 : s < 0.32 ? 1 : s < 0.62 ? 2 : 3;
        const size = rng.range(o.leafMin ?? 5, o.leafMax ?? 13) * (tone === 3 ? 0.9 : 1);
        dabs.push([x, y, tone, rng.next() * 0.3 + (b.hue ?? 0), size, rng.range(-0.9, 0.9) + (o.leafAng ?? 0), (o.bloom && tone >= 2 && rng.next() < o.bloom) ? 1 : 0, o.stretch ?? 0.45]);
      }
    }
    dabs.sort((p, q) => p[2] - q[2] || p[1] - q[1]);
    for (const d of dabs) dab(ox + d[0], oy + d[1], d[2], d[3], d[4], d[5], d[6], d[7]);
  };
  // trunks/branches painted in the darkest tone (r=20 -> tone 0 band)
  const limb = (ox, oy, pts, w0, w1) => {
    g.strokeStyle = 'rgb(20,40,0)'; g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      g.lineWidth = w0 + (w1 - w0) * (i / (pts.length - 1));
      g.beginPath(); g.moveTo(ox + pts[i - 1][0], oy + pts[i - 1][1]); g.lineTo(ox + pts[i][0], oy + pts[i][1]); g.stroke();
    }
  };
  const branchy = (ox, oy, x0, y0, ang, len, w, depth, spread, out) => {
    const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
    const mx = (x0 + x1) / 2 + rng.range(-1, 1) * len * 0.12, my = (y0 + y1) / 2;
    limb(ox, oy, [[x0, y0], [mx, my], [x1, y1]], w, w * 0.7);
    if (depth <= 0) { out.push([x1, y1]); return; }
    const n = 2 + (rng.next() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = ang + (i - (n - 1) / 2) * spread + rng.range(-0.25, 0.25);
      branchy(ox, oy, x1, y1, a, len * rng.range(0.6, 0.8), w * 0.62, depth - 1, spread * 0.9, out);
    }
  };

  // 0: big round tree canopy with a trunk
  {
    const [ox, oy] = cellOrigin(0);
    g.strokeStyle = 'rgb(20,40,0)'; g.lineCap = 'round';
    g.lineWidth = 22; g.beginPath(); g.moveTo(ox + 256, oy + 510); g.quadraticCurveTo(ox + 246, oy + 420, ox + 262, oy + 330); g.stroke();
    g.lineWidth = 10; g.beginPath(); g.moveTo(ox + 256, oy + 420); g.lineTo(ox + 200, oy + 350); g.moveTo(ox + 258, oy + 390); g.lineTo(ox + 320, oy + 330); g.stroke();
    const blobs = [];
    for (let i = 0; i < 9; i++) blobs.push({ x: 256 + rng.range(-120, 120), y: 230 + rng.range(-120, 70), r: rng.range(70, 115) });
    blobs.push({ x: 256, y: 160, r: 110 });
    clump(ox, oy, blobs);
  }
  // 1: low bush mound
  {
    const [ox, oy] = cellOrigin(1);
    const blobs = [];
    for (let i = 0; i < 10; i++) blobs.push({ x: 256 + rng.range(-170, 170), y: 380 + rng.range(-70, 60), r: rng.range(55, 95) });
    clump(ox, oy, blobs);
  }
  // 2: grass tuft — vertical blades
  {
    const [ox, oy] = cellOrigin(2);
    const blades = [];
    for (let i = 0; i < 160; i++) {
      const x = 256 + rng.gauss() * 90, h = rng.range(140, 400), lean = rng.range(-60, 60);
      blades.push([x, h, lean, rng.next()]);
    }
    blades.sort((a, b) => a[3] - b[3]);
    for (const [x, h, lean, k] of blades) {
      const tone = k < 0.25 ? 0 : k < 0.55 ? 1 : k < 0.85 ? 2 : 3;
      g.fillStyle = `rgb(${Math.round(toneVal[tone] * 255)},${Math.round(rng.next() * 76)},0)`;
      g.beginPath();
      g.moveTo(ox + x - 7, oy + 512);
      g.quadraticCurveTo(ox + x + lean * 0.3, oy + 512 - h * 0.6, ox + x + lean, oy + 512 - h);
      g.quadraticCurveTo(ox + x + lean * 0.3 + 4, oy + 512 - h * 0.55, ox + x + 7, oy + 512);
      g.fill();
    }
  }
  // 3: hanging vines / ivy curtain
  {
    const [ox, oy] = cellOrigin(3);
    for (let s = 0; s < 26; s++) {
      const x0 = rng.range(30, 482), len = rng.range(180, 500);
      let x = x0;
      for (let y = 70; y < len; y += 6) {
        x += rng.range(-1.5, 1.5);
        const k = rng.next();
        const tone = k < 0.3 ? 0 : k < 0.65 ? 1 : k < 0.9 ? 2 : 3;
        dab(ox + x + rng.range(-9, 9), oy + y, tone, rng.next() * 0.3, rng.range(5, 10) * (1 - y / len * 0.5), rng.range(-1, 1));
      }
    }
    clump(ox, oy, [{ x: 256, y: 30, r: 120 }, { x: 120, y: 20, r: 90 }, { x: 400, y: 25, r: 95 }]);
  }
  // 4: moss pad — wide flat clump
  {
    const [ox, oy] = cellOrigin(4);
    const blobs = [];
    for (let i = 0; i < 14; i++) blobs.push({ x: 256 + rng.range(-200, 200), y: 430 + rng.range(-40, 40), r: rng.range(35, 65) });
    clump(ox, oy, blobs, { leafMin: 3, leafMax: 7, density: 0.2 });
  }
  // 5: flowering bush (white & yellow wildflowers)
  {
    const [ox, oy] = cellOrigin(5);
    const blobs = [];
    for (let i = 0; i < 9; i++) blobs.push({ x: 256 + rng.range(-150, 150), y: 360 + rng.range(-90, 70), r: rng.range(55, 90) });
    clump(ox, oy, blobs, { bloom: 0.06 });
  }
  // 6: sapling — thin trunk, airy crown
  {
    const [ox, oy] = cellOrigin(6);
    g.strokeStyle = 'rgb(20,40,0)'; g.lineCap = 'round';
    g.lineWidth = 9; g.beginPath(); g.moveTo(ox + 256, oy + 512); g.bezierCurveTo(ox + 270, oy + 420, ox + 236, oy + 330, ox + 252, oy + 220); g.stroke();
    g.lineWidth = 5; g.beginPath(); g.moveTo(ox + 254, oy + 330); g.lineTo(ox + 330, oy + 250); g.moveTo(ox + 250, oy + 300); g.lineTo(ox + 180, oy + 240); g.stroke();
    const blobs = [{ x: 250, y: 170, r: 85 }, { x: 330, y: 230, r: 60 }, { x: 175, y: 225, r: 58 }, { x: 260, y: 100, r: 60 }];
    clump(ox, oy, blobs, { leafMin: 6, leafMax: 14 });
  }
  // 7: bird nest — woven twigs (brown palette material)
  {
    const [ox, oy] = cellOrigin(7);
    for (let i = 0; i < 900; i++) {
      const a = rng.range(Math.PI * 0.05, Math.PI * 0.95);
      const r = rng.range(0.55, 1.0);
      const x = 256 + Math.cos(a) * 200 * r * rng.sign();
      const y = 330 + Math.sin(a) * 110 * r - 30;
      const sy = (y - 300) / 110;
      const s = -sy * 0.6 + rng.range(-0.4, 0.4) - (x - 256) / 400;
      const tone = s < -0.35 ? 0 : s < 0.05 ? 1 : s < 0.4 ? 2 : 3;
      g.strokeStyle = `rgb(${Math.round(toneVal[tone] * 255)},${Math.round(rng.next() * 76)},0)`;
      g.lineWidth = rng.range(2.5, 5);
      const ang = rng.range(-0.5, 0.5), len = rng.range(30, 80);
      g.beginPath(); g.moveTo(ox + x - Math.cos(ang) * len / 2, oy + y - Math.sin(ang) * len / 2);
      g.quadraticCurveTo(ox + x, oy + y + rng.range(-8, 8), ox + x + Math.cos(ang) * len / 2, oy + y + Math.sin(ang) * len / 2);
      g.stroke();
    }
    // dark hollow
    g.fillStyle = `rgb(${Math.round(toneVal[0] * 255)},20,0)`;
    g.beginPath(); g.ellipse(ox + 256, oy + 262, 150, 34, 0, 0, Math.PI * 2); g.fill();
  }
  // 8: zelkova — vase of upward branches, fan of small clumps
  {
    const [ox, oy] = cellOrigin(8);
    const tips = [];
    limb(ox, oy, [[256, 512], [252, 460], [258, 400]], 20, 15);
    for (let i = 0; i < 5; i++) branchy(ox, oy, 256, 400, -Math.PI / 2 + (i - 2) * 0.32 + rng.range(-0.1, 0.1), rng.range(80, 110), 10, 2, 0.32, tips);
    const blobs = tips.map(([x, y]) => ({ x: x + rng.range(-12, 12), y: y + rng.range(-8, 14), r: rng.range(34, 58), hue: rng.range(0, 0.12) }));
    blobs.push({ x: 256, y: 150, r: 95 }, { x: 180, y: 190, r: 70 }, { x: 330, y: 185, r: 72 });
    clump(ox, oy, blobs, { leafMin: 4, leafMax: 10, density: 0.13 });
  }
  // 9: pine — crooked trunk, layered horizontal cloud pads
  {
    const [ox, oy] = cellOrigin(9);
    const trunk = [[250, 512], [262, 450], [240, 390], [266, 320], [244, 250], [258, 170]];
    limb(ox, oy, trunk, 18, 7);
    const pads = [[160, 330, 95], [350, 290, 100], [190, 220, 80], [320, 175, 75], [250, 110, 70], [120, 260, 55]];
    for (const [x, y] of pads) limb(ox, oy, [[256, y + 30], [(x + 256) / 2, y + 8], [x, y]], 6, 3);
    const blobs = [];
    for (const [x, y, w] of pads) for (let k = 0; k < 4; k++) blobs.push({ x: x + rng.range(-w * 0.5, w * 0.5), y: y + rng.range(-8, 6), r: rng.range(w * 0.35, w * 0.55), sq: 0.45, lift: 0.08 });
    clump(ox, oy, blobs, { leafMin: 3, leafMax: 8, density: 0.3, stretch: 0.3, leafAng: 0 });
  }
  // 10: willow — arching limbs, hanging fronds
  {
    const [ox, oy] = cellOrigin(10);
    limb(ox, oy, [[256, 512], [250, 430], [262, 340], [255, 280]], 22, 12);
    const anchors = [];
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.42;
      const x1 = 256 + Math.cos(a) * 150, y1 = 280 + Math.sin(a) * 140;
      limb(ox, oy, [[256, 300], [(256 + x1) / 2, Math.min(300, y1) - 30], [x1, y1]], 8, 3);
      anchors.push([x1, y1]);
    }
    clump(ox, oy, [{ x: 256, y: 150, r: 120, sq: 0.6 }, { x: 160, y: 185, r: 80, sq: 0.6 }, { x: 352, y: 185, r: 80, sq: 0.6 }], { leafMin: 4, leafMax: 9, density: 0.12 });
    for (let s = 0; s < 60; s++) {
      const [ax, ay] = anchors[s % anchors.length];
      let x = ax + rng.range(-70, 70);
      const y0 = ay + rng.range(-20, 40), len = rng.range(150, 330);
      for (let y = y0; y < Math.min(505, y0 + len); y += 5) {
        x += rng.range(-1, 1) + 0.15;
        const k = rng.next();
        const tone = k < 0.25 ? 0 : k < 0.6 ? 1 : k < 0.88 ? 2 : 3;
        dab(ox + x, oy + y, tone, 0.1 + rng.next() * 0.25, rng.range(3, 6), Math.PI / 2 + rng.range(-0.3, 0.3), 0, 0.35);
      }
    }
  }
  // 11: twin young trees
  {
    const [ox, oy] = cellOrigin(11);
    limb(ox, oy, [[220, 512], [214, 420], [196, 300], [190, 220]], 11, 5);
    limb(ox, oy, [[290, 512], [300, 430], [326, 330], [338, 250]], 10, 5);
    const blobs = [{ x: 180, y: 200, r: 75 }, { x: 150, y: 270, r: 55 }, { x: 225, y: 150, r: 60 },
      { x: 345, y: 230, r: 70 }, { x: 380, y: 290, r: 50 }, { x: 320, y: 170, r: 55 }, { x: 262, y: 230, r: 45 }];
    clump(ox, oy, blobs, { leafMin: 5, leafMax: 12, density: 0.12 });
  }
  // 12: reeds — thin blades with seed heads
  {
    const [ox, oy] = cellOrigin(12);
    const blades = [];
    for (let i = 0; i < 120; i++) blades.push([256 + rng.gauss() * 110, rng.range(200, 480), rng.range(-50, 50), rng.next()]);
    blades.sort((a, b) => a[3] - b[3]);
    for (const [x, h, lean, k] of blades) {
      const tone = k < 0.3 ? 0 : k < 0.6 ? 1 : k < 0.88 ? 2 : 3;
      g.fillStyle = `rgb(${Math.round(toneVal[tone] * 255)},${Math.round(60 + rng.next() * 76)},0)`;
      g.beginPath();
      g.moveTo(ox + x - 3.5, oy + 512);
      g.quadraticCurveTo(ox + x + lean * 0.4, oy + 512 - h * 0.6, ox + x + lean, oy + 512 - h);
      g.quadraticCurveTo(ox + x + lean * 0.4 + 2, oy + 512 - h * 0.55, ox + x + 3.5, oy + 512);
      g.fill();
      if (k > 0.75) dab(ox + x + lean, oy + 512 - h + 10, 2, 0.5, 6, Math.PI / 2 + lean * 0.004, 0, 0.35);
    }
  }
  // 13: ivy drape — dense crown, ragged strands
  {
    const [ox, oy] = cellOrigin(13);
    for (let s = 0; s < 40; s++) {
      let x = rng.range(20, 492);
      const len = rng.range(120, 470) * (0.6 + 0.4 * Math.sin(x / 70) ** 2);
      for (let y = 78; y < len; y += 5) {
        x += rng.range(-1.2, 1.2);
        const k = rng.next();
        const tone = k < 0.3 ? 0 : k < 0.62 ? 1 : k < 0.9 ? 2 : 3;
        dab(ox + x + rng.range(-10, 10), oy + y, tone, rng.next() * 0.35, rng.range(5, 11) * (1 - y / len * 0.4), rng.range(-1, 1));
      }
    }
    clump(ox, oy, [{ x: 256, y: 40, r: 110, sq: 0.5 }, { x: 110, y: 35, r: 95, sq: 0.5 }, { x: 400, y: 38, r: 100, sq: 0.5 }], { leafMin: 5, leafMax: 11 });
  }
  // 14: bamboo clump
  {
    const [ox, oy] = cellOrigin(14);
    const culms = [];
    for (let i = 0; i < 16; i++) culms.push([256 + rng.gauss() * 60, rng.range(-0.12, 0.12) + (rng.next() - 0.5) * 0.25, rng.range(330, 500)]);
    for (const [x, lean, h] of culms) {
      g.strokeStyle = `rgb(${rng.next() < 0.5 ? 95 : 160},${Math.round(80 + rng.next() * 60)},0)`;
      g.lineWidth = rng.range(4, 7); g.lineCap = 'butt';
      g.beginPath(); g.moveTo(ox + x, oy + 512); g.quadraticCurveTo(ox + x + lean * h * 0.3, oy + 512 - h * 0.6, ox + x + lean * h, oy + 512 - h); g.stroke();
    }
    const blobs = culms.map(([x, lean, h]) => ({ x: x + lean * h, y: 512 - h + 50, r: rng.range(40, 60), sq: 1.3, hue: 0.15 }));
    clump(ox, oy, blobs, { leafMin: 6, leafMax: 12, density: 0.1, stretch: 0.25, leafAng: 0.6 });
  }
  // 15: spreading shrub — low, wide, ragged
  {
    const [ox, oy] = cellOrigin(15);
    const blobs = [];
    for (let i = 0; i < 12; i++) blobs.push({ x: 256 + rng.range(-200, 200), y: 420 + rng.range(-60, 40), r: rng.range(45, 80), sq: 0.7, hue: rng.range(0, 0.2) });
    clump(ox, oy, blobs, { leafMin: 4, leafMax: 10, density: 0.14, bloom: 0.015 });
  }

  // flower heads: dense round clusters of small florets, shaded like the clumps
  const flowerHead = (ox, oy, x, y, r, which, n = 60) => {
    const ds = [];
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2, rr = Math.sqrt(rng.next()) * r;
      const fx = x + Math.cos(a) * rr, fy = y + Math.sin(a) * rr * 0.85;
      const nx = (fx - x) / r, ny = (fy - y) / r;
      const s = nx * L[0] + ny * L[1] + Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * L[2] + rng.range(-0.15, 0.15);
      const tone = s < 0.0 ? 1 : s < 0.45 ? 2 : 3;
      ds.push([fx, fy, tone, rng.range(r * 0.16, r * 0.3)]);
    }
    ds.sort((p, q) => p[2] - q[2]);
    for (const [fx, fy, tone, sz] of ds) dab(ox + fx, oy + fy, tone, rng.next() * 0.2, sz, rng.range(0, 3), which, 0.8);
  };
  // 16: hydrangea bush — dark glossy leaves, big blue/violet flower heads
  {
    const [ox, oy] = cellOrigin(16);
    const blobs = [];
    for (let i = 0; i < 9; i++) blobs.push({ x: 256 + rng.range(-170, 170), y: 360 + rng.range(-80, 70), r: rng.range(60, 95) });
    clump(ox, oy, blobs, { leafMin: 9, leafMax: 18, stretch: 0.6 });
    for (let i = 0; i < 11; i++) {
      const x = 256 + rng.range(-185, 185), y = 330 + rng.range(-110, 80);
      flowerHead(ox, oy, x, y, rng.range(30, 46), rng.next() < 0.7 ? 1 : 2);
    }
  }
  // 17: flowering vine curtain — morning glories hanging from a parapet
  {
    const [ox, oy] = cellOrigin(17);
    for (let s = 0; s < 34; s++) {
      let x = rng.range(20, 492);
      const len = rng.range(140, 480) * (0.55 + 0.45 * Math.sin(x / 60 + 1) ** 2);
      for (let y = 78; y < len; y += 5) {
        x += rng.range(-1.4, 1.4);
        const k = rng.next();
        const tone = k < 0.28 ? 0 : k < 0.6 ? 1 : k < 0.88 ? 2 : 3;
        dab(ox + x + rng.range(-10, 10), oy + y, tone, rng.next() * 0.35, rng.range(6, 12) * (1 - y / len * 0.4), rng.range(-1, 1), 0, 0.55);
        if (rng.next() < 0.03) {
          const fx = ox + x + rng.range(-12, 12), fy = oy + y, fr = rng.range(6, 10), which = rng.next() < 0.7 ? 1 : 2;
          dab(fx, fy, 2, 0.1, fr, 0, which, 1.0);
          dab(fx - fr * 0.2, fy - fr * 0.2, 3, 0.1, fr * 0.55, 0, which, 1.0);
          if (which === 1) dab(fx, fy, 3, 0.1, fr * 0.22, 0, 2, 1.0);
        }
      }
    }
    clump(ox, oy, [{ x: 256, y: 40, r: 115, sq: 0.5 }, { x: 110, y: 35, r: 95, sq: 0.5 }, { x: 400, y: 38, r: 100, sq: 0.5 }], { leafMin: 6, leafMax: 12 });
  }
  // 18: camphor giant — huge billowing crown (the Ghibli tree), short thick trunk
  {
    const [ox, oy] = cellOrigin(18);
    limb(ox, oy, [[250, 512], [244, 450], [256, 390]], 34, 22);
    const tips = [];
    for (let i = 0; i < 6; i++) branchy(ox, oy, 252, 395, -Math.PI / 2 + (i - 2.5) * 0.42 + rng.range(-0.1, 0.1), rng.range(70, 100), 14, 1, 0.4, tips);
    const blobs = tips.map(([x, y]) => ({ x: x + rng.range(-15, 15), y: y + rng.range(-10, 10), r: rng.range(55, 80) }));
    for (let i = 0; i < 14; i++) {
      const a = rng.range(Math.PI * 1.05, Math.PI * 1.95), rr = rng.range(0.45, 1.0);
      blobs.push({ x: 256 + Math.cos(a) * 190 * rr, y: 260 + Math.sin(a) * 200 * rr, r: rng.range(55, 88) });
    }
    blobs.push({ x: 256, y: 200, r: 120 }, { x: 160, y: 270, r: 95 }, { x: 352, y: 268, r: 95 });
    clump(ox, oy, blobs, { leafMin: 5, leafMax: 11, density: 0.11, vgrad: 0.5 });
  }
  // 19: blossom tree — crape myrtle crown dusted with pink flower sprays
  {
    const [ox, oy] = cellOrigin(19);
    const tips = [];
    limb(ox, oy, [[256, 512], [262, 450], [250, 380]], 16, 11);
    for (let i = 0; i < 4; i++) branchy(ox, oy, 252, 385, -Math.PI / 2 + (i - 1.5) * 0.5 + rng.range(-0.1, 0.1), rng.range(80, 105), 8, 2, 0.35, tips);
    const blobs = tips.map(([x, y]) => ({ x: x + rng.range(-12, 12), y: y + rng.range(-8, 12), r: rng.range(38, 60) }));
    blobs.push({ x: 256, y: 170, r: 100 }, { x: 175, y: 215, r: 72 }, { x: 337, y: 210, r: 74 });
    clump(ox, oy, blobs, { leafMin: 4, leafMax: 10, density: 0.12 });
    for (let i = 0; i < 16; i++) {
      const b = blobs[Math.floor(rng.next() * blobs.length)];
      flowerHead(ox, oy, b.x + rng.range(-b.r * 0.6, b.r * 0.6), b.y - b.r * rng.range(0.1, 0.7), rng.range(22, 36), rng.next() < 0.8 ? 1 : 2, 45);
    }
  }
  // 20: grass bank with wildflowers — wide low tuft
  {
    const [ox, oy] = cellOrigin(20);
    const blades = [];
    for (let i = 0; i < 260; i++) blades.push([256 + rng.range(-240, 240), rng.range(60, 230), rng.range(-40, 40), rng.next()]);
    blades.sort((a, b) => a[3] - b[3]);
    for (const [x, h, lean, k] of blades) {
      const tone = k < 0.25 ? 0 : k < 0.55 ? 1 : k < 0.85 ? 2 : 3;
      g.fillStyle = `rgb(${Math.round(toneVal[tone] * 255)},${Math.round(rng.next() * 76)},0)`;
      g.beginPath();
      g.moveTo(ox + x - 6, oy + 512);
      g.quadraticCurveTo(ox + x + lean * 0.3, oy + 512 - h * 0.6, ox + x + lean, oy + 512 - h);
      g.quadraticCurveTo(ox + x + lean * 0.3 + 4, oy + 512 - h * 0.55, ox + x + 6, oy + 512);
      g.fill();
      if (k > 0.8 && rng.next() < 0.4) dab(ox + x + lean, oy + 512 - h, 3, 0.1, rng.range(6, 10), 0, rng.next() < 0.5 ? 1 : 2, 1.0);
    }
  }
  // 21: morning-glory trellis — a leafy screen with many blue trumpets
  {
    const [ox, oy] = cellOrigin(21);
    const blobs = [];
    for (let i = 0; i < 12; i++) blobs.push({ x: 256 + rng.range(-190, 190), y: 300 + rng.range(-170, 170), r: rng.range(50, 80) });
    clump(ox, oy, blobs, { leafMin: 8, leafMax: 15, stretch: 0.7, density: 0.1 });
    for (let i = 0; i < 46; i++) {
      const b = blobs[Math.floor(rng.next() * blobs.length)];
      const fx = ox + b.x + rng.range(-b.r, b.r), fy = oy + b.y + rng.range(-b.r, b.r), fr = rng.range(6, 9.5);
      if (rng.next() < 0.8) {
        // morning glory: a blue trumpet face with a pale throat
        dab(fx, fy, 2, 0.1, fr, 0, 1, 1.0);
        dab(fx - fr * 0.2, fy - fr * 0.2, 3, 0.1, fr * 0.6, 0, 1, 1.0);
        dab(fx, fy, 3, 0.1, fr * 0.22, 0, 2, 1.0);
      } else dab(fx, fy, 3, 0.1, fr * 0.8, 0, 2, 1.0);
    }
  }
  const t = tex(c);
  return { texture: t, cols, rows };
}

// ------------------------------------------------------------- props atlas
// Painted signs, the konbini fascia, the koban plate, the stop sign and the
// floating lily / algae patches. Returns { texture, rects } with rects as
// [u0, v0, u1, v1] (texture space, v up).
export function makePropAtlas() {
  const W = 2048, H = 4096;
  const [c, g] = canvas(W, H);
  const rng = new Rng(9911);
  const rects = {};
  const reg = (name, x, y, w, h) => { rects[name] = [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H]; };
  const JP = '"Yu Gothic", "YuGothic", "Meiryo", "MS Gothic", sans-serif';
  const weather = (x, y, w, h, amt = 1) => {
    // faded sun bleaching, rust drips, grime at the bottom
    const grd = g.createLinearGradient(x, y, x, y + h);
    grd.addColorStop(0, `rgba(255,248,235,${0.18 * amt})`); grd.addColorStop(0.6, 'rgba(255,255,255,0)'); grd.addColorStop(1, `rgba(60,48,40,${0.28 * amt})`);
    g.fillStyle = grd; g.fillRect(x, y, w, h);
    for (let i = 0; i < 6 * amt; i++) {
      const rx = x + rng.range(0.05, 0.95) * w, ry = y + rng.range(0, 0.5) * h, rl = rng.range(0.1, 0.5) * h;
      const gr = g.createLinearGradient(rx, ry, rx, ry + rl);
      gr.addColorStop(0, 'rgba(120,64,40,0.55)'); gr.addColorStop(1, 'rgba(120,64,40,0)');
      g.fillStyle = gr; g.fillRect(rx, ry, rng.range(2, 6), rl);
    }
    for (let i = 0; i < 30 * amt; i++) {
      g.fillStyle = `rgba(${rng.next() < 0.5 ? '70,60,55' : '240,235,225'},${rng.range(0.05, 0.18)})`;
      g.beginPath(); g.ellipse(x + rng.next() * w, y + rng.next() * h, rng.range(3, 14), rng.range(2, 9), rng.next() * 3, 0, Math.PI * 2); g.fill();
    }
  };
  // vertical signboards (tategaki), 120 x 480 px each
  const vsigns = [
    ['薬', '#d9473b', '#fff6e8', 'ドラッグ'], ['歯科', '#f1ece0', '#2f62a8', '山本'], ['ラーメン', '#e8c23a', '#b3261e'],
    ['居酒屋', '#2b2a33', '#f2e3c4'], ['カラオケ', '#2f6fb0', '#fff7e0'], ['不動産', '#f3efe6', '#1f6b4a'],
    ['美容室', '#f0e1d6', '#b04a6b'], ['喫茶', '#6b4130', '#f6e7c8'], ['質', '#1d3f73', '#f4f0e6'],
    ['ホテル', '#efe9dc', '#7a2f8a'], ['整骨院', '#ffffff', '#1d7a52'], ['麻雀', '#1f6b3a', '#f7f1d8'],
    ['学習塾', '#f6efe0', '#d0412f'], ['酒', '#f3e9d2', '#2b2a33', '田中'], ['クリーニング', '#3a8fc8', '#ffffff'], ['そば', '#2a2c3a', '#f2e6c9'],
  ];
  vsigns.forEach(([txt, bg, fg, sub], i) => {
    const x = 16 + (i % 8) * 136, y = 16 + Math.floor(i / 8) * 500, w = 120, h = 480;
    g.fillStyle = bg; g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(40,34,48,0.55)'; g.lineWidth = 6; g.strokeRect(x + 3, y + 3, w - 6, h - 6);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const chars = [...txt];
    const top = sub ? 70 : 34;
    const step = Math.min(96, (h - top - 30) / chars.length);
    g.font = `700 ${Math.round(step * 0.86)}px ${JP}`;
    chars.forEach((ch, k) => g.fillText(ch, x + w / 2, y + top + step * (k + 0.5)));
    if (sub) { g.font = `600 30px ${JP}`; g.fillText(sub, x + w / 2, y + 36); }
    weather(x, y, w, h, 1);
    reg('v' + i, x, y, w, h);
  });
  // konbini fascia (fictional chain), 900 x 140
  {
    const x = 16, y = 1020, w = 900, h = 140;
    g.fillStyle = '#f4f1e8'; g.fillRect(x, y, w, h);
    g.fillStyle = '#2f9a72'; g.fillRect(x, y + 18, w, 26);
    g.fillStyle = '#f2a33a'; g.fillRect(x, y + 50, w, 14);
    g.fillStyle = '#2f9a72'; g.fillRect(x, y + h - 30, w, 12);
    g.fillStyle = '#25424a'; g.font = `800 56px ${JP}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('ひまわりマート', x + 40, y + 98);
    g.fillStyle = '#d9473b'; g.font = `800 52px ${JP}`; g.fillText('24H', x + w - 150, y + 98);
    weather(x, y, w, h, 1.5);
    reg('konbini', x, y, w, h);
  }
  // koban plate: 交番 / KOBAN
  {
    const x = 940, y = 1020, w = 360, h = 140;
    g.fillStyle = '#f2efe6'; g.fillRect(x, y, w, h);
    g.fillStyle = '#1f2f5c'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 64px ${JP}`; g.fillText('交番', x + w / 2, y + 52);
    g.font = '700 38px "Arial Narrow", Arial, sans-serif'; g.fillText('K O B A N', x + w / 2, y + 108);
    weather(x, y, w, h, 1);
    reg('koban', x, y, w, h);
  }
  // stop sign: red inverted triangle with 止まれ
  {
    const x = 1320, y = 1020, w = 300, h = 270;
    g.fillStyle = '#f3efe8';
    g.beginPath(); g.moveTo(x + 4, y + 4); g.lineTo(x + w - 4, y + 4); g.lineTo(x + w / 2, y + h - 4); g.closePath(); g.fill();
    g.fillStyle = '#c8312c';
    g.beginPath(); g.moveTo(x + 22, y + 16); g.lineTo(x + w - 22, y + 16); g.lineTo(x + w / 2, y + h - 26); g.closePath(); g.fill();
    g.fillStyle = '#f7f2ea'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 66px ${JP}`; g.fillText('止まれ', x + w / 2, y + 86);
    g.save(); g.beginPath(); g.moveTo(x + 4, y + 4); g.lineTo(x + w - 4, y + 4); g.lineTo(x + w / 2, y + h - 4); g.closePath(); g.clip();
    weather(x, y, w, h, 0.8); g.restore();
    reg('stop', x, y, w, h);
  }
  // shop shutters / small horizontal shop signs
  const hsigns = [['たばこ', '#c8312c', '#fff4e4'], ['理容', '#f0ece2', '#2a4f9a'], ['定食', '#f1d77a', '#3a2a24'], ['駐車場', '#2a64b0', '#ffffff'], ['ビル', '#e9e3d6', '#383340']];
  hsigns.forEach(([txt, bg, fg], i) => {
    const x = 16 + i * 330, y = 1180, w = 310, h = 96;
    g.fillStyle = bg; g.fillRect(x, y, w, h);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `800 64px ${JP}`; g.fillText(txt, x + w / 2, y + h / 2 + 2);
    weather(x, y, w, h, 1);
    reg('h' + i, x, y, w, h);
  });
  // floating lily pads + algae scum (top-down, alpha): notched pads with veins and a
  // lit rim, a few white / pink water lilies with yellow hearts
  const waterLily = (cx, cy, rr, r, pink) => {
    const petals = 9 + r.int(0, 3);
    for (let layer = 0; layer < 2; layer++) {
      const R = rr * (layer ? 0.62 : 1), a0 = r.next() * 6.28;
      for (let k = 0; k < petals; k++) {
        const a = a0 + (k / petals) * Math.PI * 2;
        const base = pink ? (layer ? '#f7c9d6' : '#ef9fb9') : (layer ? '#ffffff' : '#eef0f2');
        g.fillStyle = base;
        g.beginPath(); g.ellipse(cx + Math.cos(a) * R * 0.55, cy + Math.sin(a) * R * 0.55, R * 0.55, R * 0.2, a, 0, Math.PI * 2); g.fill();
        g.strokeStyle = pink ? 'rgba(170,70,110,0.5)' : 'rgba(150,160,190,0.55)'; g.lineWidth = 1.2; g.stroke();
      }
    }
    g.fillStyle = '#f3c84a'; g.beginPath(); g.arc(cx, cy, rr * 0.2, 0, 6.28); g.fill();
    g.fillStyle = '#d99a2b'; for (let k = 0; k < 7; k++) { const a = k * 0.9; g.beginPath(); g.arc(cx + Math.cos(a) * rr * 0.12, cy + Math.sin(a) * rr * 0.12, 1.6, 0, 6.28); g.fill(); }
  };
  const lily = (x0, y0, w, h, seed) => {
    const r = new Rng(seed);
    // algae film
    for (let i = 0; i < 160; i++) {
      const cx = x0 + w / 2 + r.gauss() * w * 0.22, cy = y0 + h / 2 + r.gauss() * h * 0.22;
      g.fillStyle = `rgba(${Math.round(r.range(80, 125))},${Math.round(r.range(118, 158))},${Math.round(r.range(66, 92))},${r.range(0.45, 0.85)})`;
      g.beginPath(); g.ellipse(cx, cy, r.range(6, 26), r.range(5, 18), r.next() * 3, 0, Math.PI * 2); g.fill();
    }
    // duckweed specks
    for (let i = 0; i < 260; i++) {
      const cx = x0 + w / 2 + r.gauss() * w * 0.26, cy = y0 + h / 2 + r.gauss() * h * 0.26;
      g.fillStyle = r.next() < 0.5 ? '#9cc35e' : '#7aa64c';
      g.beginPath(); g.ellipse(cx, cy, r.range(1.5, 3.5), r.range(1.2, 2.6), r.next() * 3, 0, Math.PI * 2); g.fill();
    }
    // pads
    const flowers = [];
    for (let i = 0; i < 40; i++) {
      const cx = x0 + w / 2 + r.gauss() * w * 0.24, cy = y0 + h / 2 + r.gauss() * h * 0.24;
      const rr = r.range(11, 30), a = r.next() * 6.28;
      if (cx < x0 + rr + 6 || cx > x0 + w - rr - 6 || cy < y0 + rr + 6 || cy > y0 + h - rr - 6) continue;
      const tone = r.next();
      const fill = tone < 0.25 ? '#3b6a46' : tone < 0.65 ? '#5a8c4c' : '#86b05a';
      g.fillStyle = 'rgba(30,60,50,0.35)';
      g.beginPath(); g.moveTo(cx + 2, cy + 3); g.arc(cx + 2, cy + 3, rr, a + 0.3, a + Math.PI * 2 - 0.05); g.closePath(); g.fill();
      g.fillStyle = fill;
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, rr, a + 0.3, a + Math.PI * 2 - 0.05); g.closePath(); g.fill();
      // veins
      g.strokeStyle = 'rgba(210,235,170,0.4)'; g.lineWidth = 1;
      for (let k = 1; k < 7; k++) { const va = a + 0.3 + k * (Math.PI * 2 - 0.35) / 7; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(va) * rr * 0.9, cy + Math.sin(va) * rr * 0.9); g.stroke(); }
      // lit rim + sheen
      g.strokeStyle = 'rgba(225,245,180,0.55)'; g.lineWidth = 1.6;
      g.beginPath(); g.arc(cx, cy, rr - 1, a + 0.3, a + 2.2); g.stroke();
      g.fillStyle = 'rgba(220,240,190,0.28)';
      g.beginPath(); g.ellipse(cx - rr * 0.25, cy - rr * 0.3, rr * 0.4, rr * 0.22, -0.5, 0, 6.28); g.fill();
      if (r.next() < 0.22) flowers.push([cx + rr * 0.25, cy - rr * 0.1, r.range(9, 15), r.next() < 0.45]);
    }
    for (const [fx, fy, fr, pink] of flowers) waterLily(fx, fy, fr, r, pink);
  };
  for (let i = 0; i < 4; i++) { lily(16 + i * 300, 1300, 290, 290, 500 + i); reg('lily' + i, 16 + i * 300, 1300, 290, 290); }

  // ------------------------------------------------------------ road paint
  // White shapes on transparent; 'up' in the texture = the direction of travel.
  const WHITE = '#ffffff';
  {
    // 止まれ, stacked along the lane (止 farthest from the driver = top)
    const x = 16, y = 1620, w = 150, h = 420;
    g.fillStyle = WHITE; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 132px ${JP}`;
    ['止', 'ま', 'れ'].forEach((ch, k) => g.fillText(ch, x + w / 2, y + 72 + k * 138));
    reg('rm_stop', x, y, w, h);
  }
  {
    const x = 186, y = 1620, w = 130, h = 420;
    g.fillStyle = WHITE; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 100px ${JP}`;
    ['バ', 'ス', '専', '用'].forEach((ch, k) => g.fillText(ch, x + w / 2, y + 56 + k * 102));
    reg('rm_bus', x, y, w, h);
  }
  {
    const x = 336, y = 1620, w = 220, h = 300;
    g.fillStyle = WHITE; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 250px "Arial Narrow", Arial, sans-serif`;
    g.fillText('40', x + w / 2, y + h / 2 + 10);
    reg('rm_40', x, y, w, h);
  }
  const arrowHead = (tx, ty, dx, dy, len, half) => {
    // tip at (tx, ty), pointing along (dx, dy)
    const px = -dy, py = dx;
    g.beginPath(); g.moveTo(tx, ty);
    g.lineTo(tx - dx * len + px * half, ty - dy * len + py * half);
    g.lineTo(tx - dx * len - px * half, ty - dy * len - py * half);
    g.closePath(); g.fill();
  };
  {
    const x = 576, y = 1620, w = 120, h = 420;
    g.fillStyle = WHITE;
    g.fillRect(x + w / 2 - 17, y + 150, 34, h - 160);
    arrowHead(x + w / 2, y + 8, 0, -1, 160, 56);
    reg('rm_str', x, y, w, h);
  }
  {
    // right turn (for left-hand traffic the innermost lane)
    const x = 716, y = 1620, w = 170, h = 420;
    g.fillStyle = WHITE;
    g.fillRect(x + 30, y + 150, 32, h - 160);
    g.lineCap = 'butt'; g.strokeStyle = WHITE; g.lineWidth = 32;
    g.beginPath(); g.moveTo(x + 46, y + 160); g.quadraticCurveTo(x + 46, y + 70, x + 110, y + 70); g.stroke();
    arrowHead(x + w - 4, y + 70, 1, 0, 64, 46);
    reg('rm_right', x, y, w, h);
  }
  {
    // straight + left
    const x = 906, y = 1620, w = 190, h = 420;
    g.fillStyle = WHITE;
    g.fillRect(x + w - 62, y + 150, 32, h - 160);
    arrowHead(x + w - 46, y + 8, 0, -1, 150, 50);
    g.strokeStyle = WHITE; g.lineWidth = 30; g.lineCap = 'butt';
    g.beginPath(); g.moveTo(x + w - 46, y + 290); g.quadraticCurveTo(x + w - 46, y + 210, x + 80, y + 210); g.stroke();
    arrowHead(x + 6, y + 210, -1, 0, 74, 44);
    reg('rm_sl', x, y, w, h);
  }
  // decorative manhole covers (full colour, round alpha)
  const manhole = (x, y, S, kind) => {
    const cx = x + S / 2, cy = y + S / 2, R = S / 2 - 6;
    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, 6.28); g.clip();
    g.fillStyle = '#4c4f58'; g.fillRect(x, y, S, S);
    if (kind === 0) {
      // waves + hydrangea, the city's flower
      g.fillStyle = '#3c74b8'; g.fillRect(x, cy + 10, S, S);
      g.strokeStyle = '#9fd0f0'; g.lineWidth = 7;
      for (let k = 0; k < 4; k++) { g.beginPath(); for (let i = -2; i < 9; i++) { const bx = x + i * 40, by = cy + 30 + k * 26; g.moveTo(bx, by); g.quadraticCurveTo(bx + 20, by - 22, bx + 40, by); } g.stroke(); }
      for (let k = 0; k < 26; k++) {
        const a = rng.next() * 6.28, rr = Math.sqrt(rng.next()) * 62;
        const fx = cx - 10 + Math.cos(a) * rr, fy = cy - 30 + Math.sin(a) * rr * 0.8;
        g.fillStyle = rng.next() < 0.5 ? '#9b8be6' : '#d48ad6';
        for (let p = 0; p < 4; p++) { g.beginPath(); g.ellipse(fx + Math.cos(p * 1.57) * 7, fy + Math.sin(p * 1.57) * 7, 7, 5, p * 1.57, 0, 6.28); g.fill(); }
        g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(fx, fy, 2.5, 0, 6.28); g.fill();
      }
      g.fillStyle = '#4f8a4a';
      for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(cx + 60 - k * 70, cy + 4, 26, 12, 0.4 - k * 0.3, 0, 6.28); g.fill(); }
    } else {
      // standard grid cover with a raised lattice
      g.strokeStyle = '#6d717a'; g.lineWidth = 6;
      for (let k = -6; k <= 6; k++) { g.beginPath(); g.moveTo(cx + k * 22 - 200, cy - 200); g.lineTo(cx + k * 22 + 200, cy + 200); g.stroke(); g.beginPath(); g.moveTo(cx + k * 22 + 200, cy - 200); g.lineTo(cx + k * 22 - 200, cy + 200); g.stroke(); }
      g.fillStyle = '#4c4f58'; g.beginPath(); g.arc(cx, cy, 42, 0, 6.28); g.fill();
      g.fillStyle = '#80848e'; g.font = `800 40px ${JP}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('下水', cx, cy + 2);
    }
    // rust and grime
    for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(${rng.next() < 0.5 ? '150,80,50' : '40,40,44'},${rng.range(0.1, 0.3)})`; g.beginPath(); g.arc(x + rng.next() * S, y + rng.next() * S, rng.range(4, 18), 0, 6.28); g.fill(); }
    g.restore();
    g.strokeStyle = '#8a8d94'; g.lineWidth = 10; g.beginPath(); g.arc(cx, cy, R - 5, 0, 6.28); g.stroke();
    g.strokeStyle = '#2f3138'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, R - 0.5, 0, 6.28); g.stroke();
  };
  manhole(1116, 1620, 280, 0); reg('mh0', 1116, 1620, 280, 280);
  manhole(1416, 1620, 280, 1); reg('mh1', 1416, 1620, 280, 280);
  // bus stop sign disc + timetable
  {
    const x = 1716, y = 1620, S = 200;
    g.fillStyle = '#f4f2ea'; g.beginPath(); g.arc(x + S / 2, y + S / 2, S / 2 - 4, 0, 6.28); g.fill();
    g.strokeStyle = '#2f7d4f'; g.lineWidth = 16; g.beginPath(); g.arc(x + S / 2, y + S / 2, S / 2 - 14, 0, 6.28); g.stroke();
    g.fillStyle = '#2f7d4f'; g.fillRect(x + 20, y + 78, S - 40, 44);
    g.fillStyle = '#ffffff'; g.font = `800 34px ${JP}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('バス停', x + S / 2, y + 101);
    g.fillStyle = '#2f3a4a'; g.font = `700 26px ${JP}`; g.fillText('駅前通り', x + S / 2, y + 58); g.fillText('のりば', x + S / 2, y + 148);
    weather(x, y, S, S, 0.6);
    reg('busstop', x, y, S, S);
    const tx = 1716, ty = 1836, tw = 150, th = 200;
    g.fillStyle = '#eef1f2'; g.fillRect(tx, ty, tw, th);
    g.fillStyle = '#2f7d4f'; g.fillRect(tx, ty, tw, 30);
    g.fillStyle = '#3a3f4a';
    for (let k = 0; k < 9; k++) for (let j = 0; j < 4; j++) g.fillRect(tx + 12 + j * 34, ty + 42 + k * 17, 22, 7);
    weather(tx, ty, tw, th, 0.8);
    reg('bustable', tx, ty, tw, th);
  }
  // mamachari bicycles, side view (they lie on the street floor)
  const bike = (x, y, w, h, col) => {
    const wr = 70, y0 = y + h - 84, x1 = x + 90, x2 = x + w - 90;
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const wx of [x1, x2]) {
      g.strokeStyle = '#2d2f36'; g.lineWidth = 15; g.beginPath(); g.arc(wx, y0, wr, 0, 6.28); g.stroke();
      g.strokeStyle = '#a9adb5'; g.lineWidth = 3; g.beginPath(); g.arc(wx, y0, wr - 7, 0, 6.28); g.stroke();
      g.lineWidth = 2.4; for (let k = 0; k < 16; k++) { const a = k * 0.3927; g.beginPath(); g.moveTo(wx, y0); g.lineTo(wx + Math.cos(a) * (wr - 6), y0 + Math.sin(a) * (wr - 6)); g.stroke(); }
      g.fillStyle = '#c7cbd2'; g.beginPath(); g.arc(wx, y0, 7, 0, 6.28); g.fill();
    }
    const bb = [x + w * 0.46, y0 + 8], seat = [x + w * 0.38, y0 - 100], head = [x2 - 34, y0 - 112];
    g.strokeStyle = col; g.lineWidth = 17;
    g.beginPath(); g.moveTo(x1, y0); g.lineTo(bb[0], bb[1]); g.lineTo(seat[0], seat[1]); g.stroke();
    g.beginPath(); g.moveTo(x1, y0); g.lineTo(seat[0] + 4, seat[1] + 16); g.stroke();
    g.beginPath(); g.moveTo(bb[0], bb[1]); g.quadraticCurveTo(x + w * 0.62, y0 - 70, head[0], head[1] + 12); g.stroke();
    g.beginPath(); g.moveTo(head[0], head[1]); g.lineTo(x2, y0); g.stroke();
    // chain guard, saddle, bars, basket, rear carrier
    g.fillStyle = col; g.beginPath(); g.ellipse((x1 + bb[0]) / 2, y0 + 4, (bb[0] - x1) / 2, 10, 0, 0, 6.28); g.fill();
    g.fillStyle = '#3a3036'; g.beginPath(); g.ellipse(seat[0], seat[1] - 6, 30, 10, 0, 0, 6.28); g.fill();
    g.strokeStyle = '#9da2aa'; g.lineWidth = 7; g.beginPath(); g.moveTo(head[0], head[1]); g.lineTo(head[0] - 12, head[1] - 26); g.lineTo(head[0] - 48, head[1] - 30); g.stroke();
    g.strokeStyle = '#b8bcc4'; g.lineWidth = 3; g.strokeRect(x2 - 40, head[1] - 18, 64, 46);
    for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(x2 - 40 + k * 13, head[1] - 18); g.lineTo(x2 - 40 + k * 13, head[1] + 28); g.stroke(); }
    g.strokeStyle = '#8f949c'; g.lineWidth = 6; g.beginPath(); g.moveTo(x1 - 30, y0 - 78); g.lineTo(seat[0] - 12, y0 - 78); g.moveTo(x1 - 10, y0 - 78); g.lineTo(x1, y0); g.stroke();
  };
  bike(16, 2060, 420, 300, '#c9ccd2'); reg('bike0', 16, 2060, 420, 300);
  bike(456, 2060, 420, 300, '#ef8fb0'); reg('bike1', 456, 2060, 420, 300);
  bike(896, 2060, 420, 300, '#5aa9de'); reg('bike2', 896, 2060, 420, 300);
  // vending machines (front panel)
  const vend = (x, y, w, h, body, accent) => {
    g.fillStyle = body; g.fillRect(x, y, w, h);
    g.fillStyle = '#e9f4fb'; g.fillRect(x + 12, y + 14, w - 24, h * 0.5);
    const cols = ['#d8402f', '#f2c94c', '#2f86c6', '#3fae6a', '#f08a3c', '#ffffff', '#8a4fc0', '#e65d8f'];
    for (let r0 = 0; r0 < 3; r0++) for (let k = 0; k < 6; k++) {
      const cx = x + 22 + k * ((w - 44) / 6), cy = y + 22 + r0 * (h * 0.5 / 3);
      g.fillStyle = cols[(k * 3 + r0 * 5) % cols.length]; g.fillRect(cx, cy + 8, (w - 44) / 6 - 6, h * 0.5 / 3 - 26);
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(cx + 3, cy + 10, 4, h * 0.5 / 3 - 30);
      g.fillStyle = k % 3 ? '#3b8de0' : '#e04040'; g.fillRect(cx + 4, cy + h * 0.5 / 3 - 14, 12, 6);
    }
    g.fillStyle = accent; g.fillRect(x + 12, y + h * 0.5 + 24, w - 24, 40);
    g.fillStyle = '#ffffff'; g.font = `800 26px ${JP}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('つめた〜い', x + w / 2, y + h * 0.5 + 45);
    g.fillStyle = '#2b2a33'; g.fillRect(x + w - 60, y + h * 0.5 + 80, 30, 50);
    g.fillStyle = '#1d1c24'; g.fillRect(x + 20, y + h - 90, w - 40, 60);
    g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(x + 20, y + h - 90, w - 40, 6);
    weather(x, y, w, h, 1.2);
  };
  vend(1336, 2060, 200, 400, '#d8402f', '#2f86c6'); reg('vend0', 1336, 2060, 200, 400);
  vend(1556, 2060, 200, 400, '#2f6fb8', '#d8402f'); reg('vend1', 1556, 2060, 200, 400);
  // outdoor AC unit front + red postbox front
  {
    const x = 1776, y = 2060, w = 220, h = 160;
    g.fillStyle = '#e8e7e1'; g.fillRect(x, y, w, h);
    g.strokeStyle = '#b9b8b2'; g.lineWidth = 3; g.strokeRect(x + 3, y + 3, w - 6, h - 6);
    const cx = x + 82, cy = y + h / 2;
    g.fillStyle = '#3a3c44'; g.beginPath(); g.arc(cx, cy, 62, 0, 6.28); g.fill();
    g.strokeStyle = '#c9c8c2'; g.lineWidth = 3;
    for (let k = 1; k < 6; k++) { g.beginPath(); g.arc(cx, cy, k * 12, 0, 6.28); g.stroke(); }
    for (let k = 0; k < 8; k++) { g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(k * 0.785) * 62, cy + Math.sin(k * 0.785) * 62); g.stroke(); }
    g.fillStyle = '#c9c8c2';
    for (let k = 0; k < 9; k++) g.fillRect(x + 158, y + 22 + k * 13, 48, 5);
    weather(x, y, w, h, 1.3);
    reg('ac', x, y, w, h);
    const px = 1776, py = 2240, pw = 160, ph = 220;
    g.fillStyle = '#d83a30'; g.fillRect(px, py, pw, ph);
    g.fillStyle = '#2b2a33'; g.fillRect(px + 30, py + 40, pw - 60, 14);
    g.fillStyle = '#ffffff'; g.font = `900 64px ${JP}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('〒', px + pw / 2, py + 118);
    g.fillStyle = '#f4efe2'; g.fillRect(px + 30, py + 160, pw - 60, 34);
    weather(px, py, pw, ph, 1.0);
    reg('post', px, py, pw, ph);
  }
  // roller shutters with faded graffiti
  const tags = ['SUNNY', 'AV98', 'MIZU', 'KAPPA', 'NAMI', 'YO!', 'RAIN', 'NEKO'];
  const tagCols = [['#f06aa8', '#ffe56b'], ['#47c6e6', '#ffffff'], ['#ffd23f', '#f05a3c'], ['#9b6bf0', '#7ef0c8'], ['#5fd06a', '#f8f0a0']];
  const graffiti = (x, y, w, h, n, alpha) => {
    for (let k = 0; k < n; k++) {
      const txt = rng.pick(tags), [fill, hi] = rng.pick(tagCols);
      const fs = rng.range(h * 0.24, h * 0.42);
      const tx = x + rng.range(0.1, 0.9) * w, ty = y + rng.range(0.3, 0.75) * h;
      g.save(); g.translate(tx, ty); g.rotate(rng.range(-0.18, 0.12)); g.globalAlpha = alpha * rng.range(0.6, 1);
      g.font = `900 ${Math.round(fs)}px "Arial Black", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineJoin = 'round'; g.strokeStyle = '#2a2236'; g.lineWidth = fs * 0.22; g.strokeText(txt, 0, 0);
      g.fillStyle = fill; g.fillText(txt, 0, 0);
      g.fillStyle = hi; g.globalAlpha *= 0.7; g.fillText(txt, -fs * 0.04, -fs * 0.06);
      // spray drips
      g.globalAlpha = alpha * 0.7; g.fillStyle = fill;
      for (let d = 0; d < 5; d++) { const dx = rng.range(-fs, fs), dl = rng.range(8, 34); g.fillRect(dx, fs * 0.3, 3, dl); }
      g.restore();
    }
    g.globalAlpha = 1;
  };
  const shutter = (x, y, w, h, base) => {
    g.fillStyle = base; g.fillRect(x, y, w, h);
    for (let k = 0; k < h; k += 9) {
      g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x, y + k, w, 2);
      g.fillStyle = 'rgba(40,40,50,0.18)'; g.fillRect(x, y + k + 6, w, 3);
    }
    g.fillStyle = 'rgba(60,60,70,0.55)'; g.fillRect(x, y, w, 14);
    g.fillStyle = 'rgba(60,60,70,0.4)'; g.fillRect(x, y + h - 10, w, 10);
    graffiti(x, y, w, h, 2, 0.75);
    weather(x, y, w, h, 1.6);
  };
  ['#c7ccd0', '#b9c6c0', '#d2c8b6', '#a9b9c9'].forEach((b, i) => { shutter(16 + i * 420, 2480, 400, 280, b); reg('sh' + i, 16 + i * 420, 2480, 400, 280); });
  // taxi roof lamp (andon)
  {
    const x = 1700, y = 2480, w = 300, h = 110;
    g.fillStyle = '#f4f1e6'; g.fillRect(x, y, w, h);
    g.fillStyle = '#e46a2c'; g.fillRect(x, y + h - 26, w, 26);
    g.fillStyle = '#1f2f5c'; g.font = `900 64px "Arial Black", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TAXI', x + w / 2, y + 44);
    reg('andon', x, y, w, h);
  }
  // shop fascias (horizontal)
  const fascias = [
    ['ラーメン', '一番', '#c8312c', '#fff4e4'], ['喫茶', 'ひまわり', '#5a3a2a', '#f6e7c8'], ['薬', 'ドラッグ ミドリ', '#f4f1e8', '#1f7a52'],
    ['不動産', 'ハナミズキ', '#24539a', '#ffffff'], ['コインランドリー', '24h', '#3fa4d8', '#ffffff'], ['居酒屋', 'たぬき', '#2b2a33', '#f2d27a'],
  ];
  fascias.forEach(([big, small, bg, fg], i) => {
    const x = 16 + (i % 3) * 680, y = 2780 + Math.floor(i / 3) * 130, w = 660, h = 112;
    g.fillStyle = bg; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x, y + 6, w, 8);
    g.strokeStyle = 'rgba(30,26,40,0.5)'; g.lineWidth = 5; g.strokeRect(x + 3, y + 3, w - 6, h - 6);
    g.fillStyle = fg; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = `900 ${big.length > 4 ? 66 : 80}px ${JP}`; g.fillText(big, x + 28, y + h / 2 + 4);
    const bw = g.measureText(big).width;
    g.font = `700 40px ${JP}`; g.fillText(small, x + 50 + bw, y + h / 2 + 10);
    weather(x, y, w, h, 1.3);
    reg('fa' + i, x, y, w, h);
  });
  // rooftop billboards
  const boards = [
    { bg: '#3d8fd6', draw: (x, y, w, h) => {
      g.fillStyle = '#bfe6ff'; for (let k = 0; k < 26; k++) { g.beginPath(); g.arc(x + 420 + rng.next() * 220, y + rng.next() * h, rng.range(3, 12), 0, 6.28); g.fill(); }
      g.fillStyle = '#e9f7ff'; g.beginPath(); g.roundRect(x + 470, y + 40, 70, 180, 18); g.fill();
      g.fillStyle = '#5cc0f0'; g.fillRect(x + 476, y + 100, 58, 60);
      g.fillStyle = '#ffffff'; g.font = `900 92px ${JP}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('夏は', x + 30, y + 80);
      g.fillStyle = '#ffe14d'; g.fillText('サイダー', x + 30, y + 178);
    } },
    { bg: '#f4f1e6', draw: (x, y, w, h) => {
      g.fillStyle = '#2f9a5a'; g.beginPath(); g.arc(x + 110, y + h / 2, 80, 0, 6.28); g.fill();
      g.fillStyle = '#ffd23f'; for (let k = 0; k < 12; k++) { const a = k * 0.5236; g.beginPath(); g.ellipse(x + 110 + Math.cos(a) * 52, y + h / 2 + Math.sin(a) * 52, 26, 10, a, 0, 6.28); g.fill(); }
      g.fillStyle = '#6b3b1f'; g.beginPath(); g.arc(x + 110, y + h / 2, 30, 0, 6.28); g.fill();
      g.fillStyle = '#1f6b3a'; g.font = `900 96px ${JP}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('ひまわり銀行', x + 210, y + h / 2 + 6);
    } },
    { bg: '#d8402f', draw: (x, y, w, h) => {
      g.fillStyle = '#ffffff'; g.font = `900 104px ${JP}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('カメラのキタ', x + 34, y + 100);
      g.fillStyle = '#ffe14d'; g.font = `800 50px ${JP}`; g.fillText('駅前 2F  ▶ 50m', x + 40, y + 190);
    } },
  ];
  boards.forEach((b, i) => {
    const x = 16 + (i % 3) * 680, y = 3060, w = 660, h = 250;
    g.fillStyle = b.bg; g.fillRect(x, y, w, h);
    b.draw(x, y, w, h);
    g.strokeStyle = 'rgba(30,26,40,0.55)'; g.lineWidth = 8; g.strokeRect(x + 4, y + 4, w - 8, h - 8);
    weather(x, y, w, h, 1.6);
    reg('bb' + i, x, y, w, h);
  });
  // floating leaves and petals (top-down, alpha)
  const leafCell = (x, y, S, seed, kind) => {
    const r = new Rng(seed);
    const n = kind === 2 ? 26 : 9;
    for (let k = 0; k < n; k++) {
      const cx = x + S / 2 + r.gauss() * S * 0.22, cy = y + S / 2 + r.gauss() * S * 0.22;
      const a = r.next() * 6.28;
      if (kind === 2) {
        // crape-myrtle petals: crinkled pink scraps
        const pr = r.range(4, 8);
        if (cx < x + pr + 2 || cx > x + S - pr - 2 || cy < y + pr + 2 || cy > y + S - pr - 2) continue;
        g.fillStyle = r.next() < 0.6 ? '#f39cc0' : '#fbd0e0';
        g.beginPath(); g.ellipse(cx, cy, pr, pr * 0.7, a, 0, 6.28); g.fill();
      } else {
        const L = r.range(14, 26);
        if (cx < x + L + 2 || cx > x + S - L - 2 || cy < y + L + 2 || cy > y + S - L - 2) continue;
        const cols = kind === 1 ? ['#d9b443', '#c98a3a', '#e2c35a'] : ['#5f9a46', '#86b45a', '#4c7d40'];
        g.fillStyle = r.pick(cols);
        g.beginPath(); g.ellipse(cx, cy, L, L * 0.42, a, 0, 6.28); g.fill();
        g.strokeStyle = 'rgba(240,250,210,0.5)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(cx - Math.cos(a) * L, cy - Math.sin(a) * L); g.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); g.stroke();
      }
    }
  };
  for (let i = 0; i < 4; i++) { leafCell(16 + i * 140, 3330, 128, 900 + i, i === 3 ? 2 : i === 2 ? 1 : 0); reg('leaf' + i, 16 + i * 140, 3330, 128, 128); }
  // wall graffiti (transparent background)
  for (let i = 0; i < 3; i++) {
    const x = 600 + i * 480, y = 3330, w = 460, h = 220;
    graffiti(x, y, w, h, 2, 0.85);
    reg('gr' + i, x, y, w, h);
  }
  const t = tex(c);
  return { texture: t, rects };
}
