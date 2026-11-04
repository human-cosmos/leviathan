import * as THREE from 'three';
import { COMMON, G, MRT_OUT } from './glsl.js';
import { Rng } from './util.js';
import { celMaterial } from './materials.js';
import { mergeGeometries } from '../vendor/addons/BufferGeometryUtils.js';

// s25: a coastal port city from the stratosphere. A polar height field around the lens (dense
// near, 7800 m out at the rim) carries a painted city sheet: blocks, roads, river, container
// terminals with their moored ships. Everything is built on the first frame that needs it, so
// the other shots never pay for it. The sky above the rim comes from the planet shader.
// Set scale: 1 unit = 18 m of real ground; the camera rides at 1440.

const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vn(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, o = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < o; i++) { s += a * vn(x, y); n += a; const X = x * 0.8 + y * 0.6, Y = -x * 0.6 + y * 0.8; x = X * 2.03 + 1.7; y = Y * 2.03 + 9.2; a *= 0.5; }
  return s / n;
}
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The coast bows toward the lens in the middle, beach crescents sweep away on both sides.
export const shoreZ = (x) => -2250 - 0.000086 * x * x + 60 * Math.sin(x * 0.0021 + 0.4) + 26 * Math.sin(x * 0.0057 + 1.2);
const SHORE_GLSL = /* glsl */ `float shoreZ(float x){ return -2250.0 - 0.000086 * x * x + 60.0 * sin(x * 0.0021 + 0.4) + 26.0 * sin(x * 0.0057 + 1.2); }`;

const ridged = (x, y, o) => { const r = 1 - Math.abs(fbm(x, y, o) * 2 - 1); return r * r; };

function height(x, z) {
  const d = shoreZ(x) - z;
  if (d <= 0) return 0;
  let h = Math.min(d, 900) * 0.012;
  const line = d + 520 * (fbm(x * 0.0006 + 3, 1.2, 3) - 0.5);
  const k = sst(780, 1750, line);
  if (k > 0) {
    const main = ridged(x * 0.00062 + 2, z * 0.0016 + 5, 6);          // the range runs along the coast
    const spur = ridged(x * 0.0034 + 8, z * 0.0011 + 2, 5);            // spurs fall toward the plain
    const soft = fbm(x * 0.0009 + 6, z * 0.0019 + 3, 4);               // rounded shoulders, not alpine spikes
    h += k * (60 + (0.5 * main + 0.5 * soft) * 330 * (0.5 + 0.7 * sst(1000, 2400, line)) + 62 * spur);
    h += k * 24 * (fbm(x * 0.012, z * 0.012, 3) - 0.5);
  }
  const k2 = sst(3000, 4700, d);
  if (k2 > 0) h += k2 * (60 + 90 * ridged(x * 0.00036 + 9, z * 0.0011, 5));
  // a far rim, high enough to meet the planet's horizon
  const r = Math.hypot(x, z - 1570);
  h += sst(5200, 7800, r) * (300 + 170 * ridged(x * 0.00042 + 3, z * 0.0009, 4)) * (0.8 + 0.4 * fbm(x * 0.0008, 7.7, 3));
  return h;
}

// ---- reference framing: pixel of a 1024 x 576 reference frame -> ground point
function ref2w(u, v) {
  const ty = Math.tan((18 * Math.PI) / 180), tx = ty * (1920 / 1040);
  const F = new THREE.Vector3(0, -320, -2170).normalize();
  const Rg = new THREE.Vector3(1, 0, 0);
  const Up = new THREE.Vector3().crossVectors(Rg, F).normalize();
  const d = F.clone().addScaledVector(Rg, (u / 512 - 1) * tx).addScaledVector(Up, (1 - v / 288) * ty);
  const t = 1440 / -d.y;
  return [t * d.x, 1570 + t * d.z];
}

// ---- the painted sheet
const X0 = -3900, X1 = 3900, Z0 = -4500, Z1 = -1250;
function paintCity() {
  const cv = document.createElement('canvas');
  cv.width = 4096; cv.height = 2048;
  const c = cv.getContext('2d');
  const sx = cv.width / (X1 - X0), sz = cv.height / (Z1 - Z0);
  const px = (x) => (x - X0) * sx, pz = (z) => (z - Z0) * sz;
  const rng = new Rng(9125);
  const pick = (a) => a[Math.floor(rng.next() * a.length) % a.length];

  // the port's reclaimed land: the city runs right down to the quays, as in the reference
  const fillPts = [[150, 447], [186, 458], [262, 464], [362, 490], [378, 487], [640, 527], [664, 500], [730, 476], [800, 454], [700, 425], [300, 425]].map(([u, v]) => ref2w(u, v));
  const fill = new Path2D();
  fillPts.forEach(([x, z], i) => { if (i) fill.lineTo(px(x), pz(z)); else fill.moveTo(px(x), pz(z)); });
  fill.closePath();
  c.fillStyle = '#b7b0ae'; c.fill(fill);

  // city fabric on a grid turned to the coast: flat blocks in districts, dark streets between them,
  // and pale boulevards every few blocks, so the grid survives the distance
  const districts = [
    ['#e8ab86', '#dd9672', '#f0c09e', '#d88a6e'],     // terracotta old town
    ['#f6ead2', '#efdfc4', '#fbf6ea', '#e6d6be'],     // cream suburbs
    ['#c6d4e6', '#b2c0da', '#dde3ec', '#a4b4d0'],     // glass and concrete downtown
  ];
  const hot = ['#ef6f4e', '#f6c75b', '#5fc7c9'];
  const angle = -0.16;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const BW = 50, BH = 44, GAP = 6.5;
  for (let v = -130; v < 130; v++) {
    for (let u = -140; u < 140; u++) {
      const x = u * BW * ca - v * BH * sa, z = -3000 + u * BW * sa + v * BH * ca;
      if (x < X0 || x > X1 || z < Z0 || z > Z1) continue;
      const d = shoreZ(x) - z;
      const inFill = c.isPointInPath(fill, px(x), pz(z));
      if (d < 56 && !inFill) continue;
      const n = fbm(x * 0.0016 + 4, z * 0.0016, 4);
      const edge = 1250 + 900 * (n - 0.5) + 240 * Math.sin(x * 0.0017 + 1);
      const dens = inFill ? 1 : sst(edge, edge - 520, d) * sst(0.24, 0.42, n + 0.25);
      if (dens <= 0.02 || height(x, z) > 42) continue;
      c.save();
      c.translate(px(x), pz(z));
      c.scale(sx, sz);
      c.rotate(angle);
      const parks = fbm(x * 0.0048, z * 0.0048 + 9, 3);
      const blvdU = ((u % 8) + 8) % 8 === 0, blvdV = ((v % 7) + 7) % 7 === 0;
      if (dens > 0.45) {
        c.fillStyle = '#6a6a96';                    // streets show between the blocks
        c.fillRect(-BW / 2, -BH / 2, BW, BH);
      }
      const bw = BW - GAP - (blvdU ? 10 : 0), bh = BH - GAP - (blvdV ? 12 : 0);
      const b0 = -BW / 2 + GAP / 2 + (blvdU ? 10 : 0), b1 = -BH / 2 + GAP / 2 + (blvdV ? 12 : 0);
      if (parks > 0.64) {
        c.fillStyle = rng.next() < 0.5 ? '#3fa557' : '#62b850';
        c.fillRect(b0, b1, bw, bh);
      } else if (rng.next() < dens * 1.5) {
        const dv = fbm(x * 0.0011 + 7, z * 0.0014 + 2, 3);
        const pal = districts[dv < 0.46 ? 0 : dv < 0.56 ? 1 : 2];
        const base = rng.next() < 0.04 ? pick(hot) : pick(pal);
        c.fillStyle = base; c.fillRect(b0, b1, bw, bh);
        // a shadowed south edge, one lane down the middle of some blocks
        c.fillStyle = 'rgba(66,66,120,0.42)'; c.fillRect(b0, b1 + bh - 6, bw, 6);
        if (rng.next() < 0.6) { c.fillStyle = 'rgba(90,88,130,0.5)'; c.fillRect(b0 + bw * (0.4 + rng.next() * 0.2), b1, 3, bh - 6); }
        c.fillStyle = pick(pal); c.fillRect(b0 + bw * 0.12, b1 + bh * 0.14, bw * 0.3, bh * 0.36);
      }
      if (dens > 0.45) {                             // boulevards, bright against the dark street net
        c.fillStyle = '#fbf3d8';
        if (blvdU) c.fillRect(-BW / 2 - 1, -BH / 2, 10, BH);
        if (blvdV) c.fillRect(-BW / 2, -BH / 2 - 1, BW, 12);
      }
      c.restore();
    }
  }
  // roads: long pale strokes
  const road = (pts, w, col) => {
    c.beginPath();
    c.moveTo(px(pts[0][0]), pz(pts[0][1]));
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, mz = (pts[i][1] + pts[i + 1][1]) / 2;
      c.quadraticCurveTo(px(pts[i][0]), pz(pts[i][1]), px(mx), pz(mz));
    }
    const e = pts[pts.length - 1];
    c.lineTo(px(e[0]), pz(e[1]));
    c.lineWidth = w * sz; c.strokeStyle = col; c.lineCap = 'round'; c.stroke();
  };
  const coastRoad = (off) => { const p = []; for (let x = -3800; x <= 3800; x += 300) p.push([x, shoreZ(x) - off - 30 * Math.sin(x * 0.002)]); return p; };
  road(coastRoad(150), 11, '#8d8ba2'); road(coastRoad(150), 6.5, '#f4efe4');
  road(coastRoad(620), 9, '#8d8ba2'); road(coastRoad(620), 5, '#f7d98a');
  for (const x0 of [-2400, -1250, -180, 760, 1900, 2800]) {
    const p = [];
    for (let k = 0; k < 8; k++) { const d = 40 + k * 240; const x = x0 + 0.1 * d + 90 * Math.sin(k * 1.3 + x0); p.push([x, shoreZ(x) - d]); }
    road(p, 7, '#8d8ba2'); road(p, 3.6, '#f4efe4');
  }
  // the river: a bright thread out of the mountains
  const riv = [];
  for (let k = 0; k <= 13; k++) { const d = 2300 - k * 192; const x = -760 - 240 * Math.sin(k * 0.8) + 120 * Math.sin(k * 1.9); riv.push([x, shoreZ(x) - d]); }
  road(riv, 34, '#ead9a8'); road(riv, 22, '#39c3d6');

  // ---- the port, placed on the reference's own pixels
  const reds = ['#d8452e', '#e65a35', '#c23a2c', '#ef7d3a', '#d8452e', '#a83a3a', '#f0a13c', '#3d7fc4', '#f4f1ea', '#2fa7a0'];
  function terminal(u0, v0, u1, v1, wd, o = {}) {
    const [x0, z0] = ref2w(u0, v0), [x1, z1] = ref2w(u1, v1);
    const L = Math.hypot(x1 - x0, z1 - z0);
    c.save();
    c.translate(px(x0), pz(z0));
    c.scale(sx, sz);
    c.rotate(Math.atan2(z1 - z0, x1 - x0));
    // apron and quay edge
    c.fillStyle = '#6f6c84'; c.fillRect(-4, -wd * 0.5 - 4, L + 8, wd + 11);
    c.fillStyle = o.pale ? '#dcd6c8' : '#cfc7b6'; c.fillRect(0, -wd * 0.5, L, wd);
    c.fillStyle = '#f5f1e6'; c.fillRect(0, wd * 0.5 - 7, L, 2.4);
    // container yards in blocks with lanes between
    const lanes = Math.max(2, Math.floor(wd / 34));
    for (let j = 0; j < lanes; j++) {
      const y = -wd * 0.5 + 8 + j * ((wd - 22) / lanes);
      const h = (wd - 22) / lanes - 5;
      for (let i = 0; i < L / 60 - 0.8; i++) {
        const bx = 8 + i * 60;
        for (let r = 0; r < 3; r++) for (let q = 0; q < 8; q++) {
          if (rng.next() < 0.1) continue;
          c.fillStyle = o.grey ? pick(['#8996ab', '#c9c3bb', '#dd8f66', '#efe6d4']) : pick(reds);
          c.fillRect(bx + q * 6.6, y + r * (h / 3), 5.8, h / 3 - 0.9);
        }
      }
    }
    // quay cranes as painted shadows, the 3D ones stand on these marks
    c.restore();
    return { x0, z0, x1, z1, L, wd };
  }
  const T = cv.terminals = [];
  T.push(terminal(378, 486, 640, 526, 150));
  T.push(terminal(222, 516, 362, 490, 90));
  T.push(terminal(92, 473, 164, 462, 58, { grey: true }));
  T.push(terminal(170, 462, 262, 460, 54, { pale: true }));
  T.push(terminal(600, 528, 800, 548, 120));
  T.push(terminal(668, 558, 762, 572, 26, { pale: true }));
  T.push(terminal(690, 505, 790, 512, 30, { pale: true }));
  T.push(terminal(790, 521, 822, 527, 14, { pale: true }));
  // stems tying the piers back to the shore
  for (const [u0, v0, u1, v1] of [[610, 520, 600, 556], [360, 492, 372, 480], [240, 505, 252, 470]]) {
    const [x0, z0] = ref2w(u0, v0), [x1, z1] = ref2w(u1, v1);
    c.beginPath(); c.moveTo(px(x0), pz(z0)); c.lineTo(px(x1), pz(z1));
    c.lineWidth = 34 * sz; c.strokeStyle = '#cfc7b6'; c.stroke();
  }
  // moored ships
  const ships = [[553, 540, 590, 552, '#b23a3a', '#f4f1ea'], [612, 544, 648, 552, '#f4f1ea', '#3d7fc4'], [278, 506, 312, 512, '#f4f1ea', '#d8452e'], [85, 474, 125, 468, '#b23a3a', '#ef7d3a']];
  for (const [u0, v0, u1, v1, hull, deck] of ships) {
    const [x0, z0] = ref2w(u0, v0), [x1, z1] = ref2w(u1, v1);
    const L = Math.hypot(x1 - x0, z1 - z0);
    c.save(); c.translate(px(x0), pz(z0)); c.scale(sx, sz); c.rotate(Math.atan2(z1 - z0, x1 - x0));
    c.fillStyle = 'rgba(8,40,110,0.55)'; c.beginPath(); c.ellipse(L / 2, 9, L / 2 + 9, 16, 0, 0, 7); c.fill();
    c.fillStyle = hull; c.beginPath(); c.moveTo(0, -13); c.lineTo(L * 0.9, -13); c.lineTo(L, 0); c.lineTo(L * 0.9, 13); c.lineTo(0, 13); c.closePath(); c.fill();
    c.fillStyle = deck; c.fillRect(L * 0.16, -9, L * 0.62, 18);
    c.fillStyle = '#f7f4ec'; c.fillRect(L * 0.03, -10, L * 0.1, 20);
    c.restore();
  }
  cv.done = true;
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace; tex.flipY = false; tex.needsUpdate = true;
  tex.terminals = T;
  return tex;
}

function buildGeometry() {
  const NR = 540, NA = 900, A = (58 * Math.PI) / 180;
  const pos = new Float32Array((NR + 1) * (NA + 1) * 3);
  let n = 0;
  for (let i = 0; i <= NR; i++) {
    const r = 1500 * Math.pow(7800 / 1500, i / NR);
    for (let j = 0; j <= NA; j++) {
      const a = -A + (2 * A * j) / NA;
      const x = Math.sin(a) * r, z = 1570 - Math.cos(a) * r;
      pos[n++] = x; pos[n++] = height(x, z); pos[n++] = z;
    }
  }
  const idx = new Uint32Array(NR * NA * 6);
  n = 0;
  for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) {
    const a = i * (NA + 1) + j, b = a + 1, c = a + NA + 1, d = c + 1;
    idx[n++] = a; idx[n++] = c; idx[n++] = b; idx[n++] = b; idx[n++] = c; idx[n++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

// red gantries stand along the quays, the one thing in this view tall enough to throw a shape
function cranes(T) {
  const parts = [];
  const CS = 0.62;                                // crane size: they stay tiny from up here
  const box = (x, y, z, w, h, d, ry) => { const b = new THREE.BoxGeometry(w * CS, h * CS, d * CS); b.rotateY(ry); b.translate(x, y * CS, z); parts.push(b); };
  const yard = [];
  for (const t of T) {
    if (t.wd < 80) continue;
    const dx = (t.x1 - t.x0) / t.L, dz = (t.z1 - t.z0) / t.L;
    const nx = -dz, nz = dx;                     // toward the sea side of the quay
    const ry = Math.atan2(-dz, dx);
    for (let s = 40; s < t.L - 30; s += 84) {
      const x = t.x0 + dx * s + nx * t.wd * 0.5, z = t.z0 + dz * s + nz * t.wd * 0.5;
      for (const a of [-5.6, 5.6]) for (const b of [-4.4, 4.4]) box(x + dx * a + nx * b, 12, z + dz * a + nz * b, 2.4, 24, 2.4, ry);
      box(x, 26, z, 20, 3, 18, ry);
      const b = new THREE.BoxGeometry(1.8, 1.6, 40); b.rotateY(ry); b.translate(x + nx * 9, 18, z + nz * 9); parts.push(b);
      yard.push([x, z]);
    }
  }
  const g = mergeGeometries(parts);
  const m = new THREE.Mesh(g, celMaterial({ color: '#f0603c', dark: '#a03048', id: 31, weather: [0, 0, 0, 0] }));
  m.frustumCulled = false; m.userData.noShadow = true;
  return m;
}

function groundMaterial(map) {
  const u = { ...G, uMap: { value: map }, uBox: { value: new THREE.Vector4(X0, Z0, X1 - X0, Z1 - Z0) } };
  const vs = /* glsl */ `
    varying vec3 vWorld, vNormalW, vNormalV;
    varying float vDepth;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      vNormalW = normalize(mat3(modelMatrix) * normal);
      vNormalV = normalize(mat3(viewMatrix) * vNormalW);
      vec4 mv = viewMatrix * wp;
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    ${SHORE_GLSL}
    uniform sampler2D uMap;
    uniform vec4 uBox;
    varying vec3 vWorld, vNormalW, vNormalV;
    varying float vDepth;
    const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);
    float nz(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
    float fb(vec2 p, int o){ float s = 0.0, a = 0.5, n = 0.0; for(int i = 0; i < o; i++){ s += a * nz(p); n += a; p = ROT * p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s / n; }

    void main(){
      if(uPass > 0.5){ oColor = vec4(1.0); oData = vec4(0.0); return; }
      vec3 w = vWorld;
      vec3 V = normalize(cameraPosition - w);
      vec3 s = normalize(uSunDir);
      vec3 N = normalize(vNormalW);
      if(N.y < 0.0) N = -N;
      float dSea = w.z - shoreZ(w.x);          // > 0 over the water
      vec3 col;
      vec2 uv = (w.xz - uBox.xy) / uBox.zw;
      vec4 sheet = (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) ? texture(uMap, uv) : vec4(0.0);
      if(dSea > 0.0){
        // cobalt out at sea, turquoise over the shelf, drawn swell and a silver sun road
        float wob = (fb(w.xz * 0.006, 4) - 0.5) * 120.0;
        float sh = smoothstep(420.0, 30.0, dSea + wob);
        vec3 a = mix(vec3(0.03, 0.27, 0.78), vec3(0.04, 0.44, 0.88), smoothstep(0.42, 0.6, fb(w.xz * 0.0013 + 3.0, 4)));
        col = mix(a, vec3(0.08, 0.63, 0.86), smoothstep(0.1, 0.5, sh));
        col = mix(col, vec3(0.24, 0.86, 0.80), smoothstep(0.62, 0.92, sh));
        vec2 st = mat2(0.98, 0.2, -0.2, 0.98) * w.xz;
        float sw = fb(st * vec2(0.012, 0.05) + fb(st * 0.012, 3) * 3.0, 4);
        col = mix(col, col * vec3(0.84, 0.9, 1.02), smoothstep(0.5, 0.54, sw));
        col = mix(col, col + vec3(0.06, 0.10, 0.08), smoothstep(0.6, 0.63, sw));
        float cap = smoothstep(0.76, 0.8, fb(st * vec2(0.07, 0.3) + 3.0, 2)) * smoothstep(0.5, 0.6, sw);
        col = mix(col, vec3(0.92, 0.97, 1.0), cap * 0.8);
        // surf lines on the sand
        float surf = 1.0 - smoothstep(0.0, 9.0 + 16.0 * nz(w.xz * 0.012), abs(dSea - 7.0 - 7.0 * sin(w.x * 0.014)));
        col = mix(col, vec3(1.0), surf * 0.9);
      } else {
        float d = -dSea;
        float n1 = fb(w.xz * 0.0052 + 5.0, 5), n2 = fb(w.xz * 0.028 + 2.0, 4), n3 = fb(w.xz * 0.11, 3);
        float slope = 1.0 - N.y;
        // plain: fields and orchards; hills: deep forest with yellow-green sunlit crowns
        vec3 fields = mix(vec3(0.36, 0.70, 0.30), vec3(0.72, 0.76, 0.34), smoothstep(0.44, 0.58, n1 + (n2 - 0.5) * 0.3));
        fields = mix(fields, vec3(0.20, 0.56, 0.32), step(0.56, n2));
        vec3 forest = mix(vec3(0.05, 0.50, 0.30), vec3(0.14, 0.68, 0.28), smoothstep(0.4, 0.6, n1));
        forest = mix(forest, vec3(0.48, 0.80, 0.26), smoothstep(0.54, 0.6, n2 + (n3 - 0.5) * 0.4));
        float hill = smoothstep(30.0, 70.0, w.y + (n2 - 0.5) * 46.0);
        vec3 land = mix(fields, forest, hill);
        // bare rock on steep ribs and high tops
        float rock = smoothstep(0.2, 0.34, slope + (n2 - 0.5) * 0.3) * smoothstep(120.0, 300.0, w.y);
        land = mix(land, vec3(0.74, 0.64, 0.50), rock * 0.7);
        land = mix(land, vec3(0.92, 0.84, 0.62), smoothstep(46.0, 30.0, d + (n3 - 0.5) * 12.0));   // beach
        // hard gouache light: lit, shade, and a soft mid so ridges read
        float ndl = dot(N, s) + (n3 - 0.5) * 0.1;
        float lit = smoothstep(0.2, 0.42, ndl);
        float mid = smoothstep(0.42, 0.66, ndl);
        vec3 shade = land * vec3(0.46, 0.60, 0.90);
        col = mix(shade, land * vec3(0.86, 0.9, 0.92), lit);
        col = mix(col, land * vec3(1.14, 1.1, 0.96), mid);
      }
      // the painted city sheet, lit lightly so it sits on the ground
      if(sheet.a > 0.0){
        vec3 sc = sheet.rgb / max(sheet.a, 0.001);
        col = mix(col, sc * (0.86 + 0.2 * smoothstep(0.3, 0.7, dot(N, s))), sheet.a);
      }
      // air: the far ranges melt into the sky band
      float rr = length(w.xz - vec2(0.0, 1570.0));
      float k = 1.0 - exp(-pow(rr / 7000.0, 4.2));
      vec3 aC = mix(vec3(0.52, 0.76, 1.0), vec3(0.80, 0.92, 1.0), smoothstep(5200.0, 7800.0, rr));
      col = mix(col, aC, clamp(k, 0.0, 0.96));
      writeOut(col, 1.0, normalize(vNormalV), vDepth, 0.0);
    }
  `;
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs, side: THREE.DoubleSide });
}

export function buildPort(ctx) {
  let mesh = null;
  const build = () => {
    mesh = new THREE.Mesh(buildGeometry(), groundMaterial(paintCity()));
    mesh.frustumCulled = false; mesh.userData.noShadow = true;
    mesh.add(cranes(mesh.material.uniforms.uMap.value.terminals));
    ctx.scene.add(mesh);
  };
  return {
    update(st) {
      const on = st.set === 'port';
      if (on && !mesh) build();
      if (mesh) mesh.visible = on;
    },
  };
}
