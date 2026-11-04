import * as THREE from 'three';
import { mergeGeometries } from '../vendor/addons/BufferGeometryUtils.js';
import { Rng, clamp, lerp, smooth, invLerp, deg } from './util.js';
import { BOX } from './ships-mat.js';
import { HULL_MAP } from './ships-tex.js';

// A 300 m container ship. Local frame: +Z bow, +Y up, waterline at y = 0.
export const H = { L: 300, B: 46, deck: 15, fcle: 24, keel: -13 };

const stemZ = (y) => 143 + 0.3 * y;
const aftZ = (y) => lerp(-124, -150, smooth(clamp((y + 13) / 19)));
const deckY = (z) => H.deck + (H.fcle - H.deck) * smooth(invLerp(114, 116, z)) + 2 * smooth(invLerp(-132, -134, z));
const topY = (z) => deckY(z) + 1.7 * smooth(invLerp(116, 121, z));
const section = (y) => { const r = 4.5, yb = H.keel + r; if (y >= yb) return 1; const k = (yb - y) / r; return 0.84 + 0.16 * Math.sqrt(Math.max(0, 1 - k * k)); };

export function halfBeam(z, y) {
  const d = stemZ(y) - z;
  if (d <= 0) return 0;
  const T = lerp(128, 46, clamp((y + 13) / 37));
  const fb = 1 - Math.pow(1 - clamp(d / T), 2.3);
  const e = Math.max(0, z - aftZ(y));
  const T2 = lerp(70, 12, clamp((y + 13) / 19));
  const tw = 0.86 * clamp((y - 1) / 5);
  const fs = tw + (1 - tw) * Math.pow(clamp(e / T2), 0.55);
  return (H.B / 2) * fb * fs * section(y);
}

// ------------------------------------------------------------------ batching
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const unitBox = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const cylCache = new Map();
// The film's pipeline is display-referred: hex colours go straight to the final grade. A little
// contrast keeps them saturated without the heavy darkening of an sRGB decode.
export function paintCol(hex, out = new THREE.Color()) {
  out.setStyle(hex, THREE.LinearSRGBColorSpace);
  out.r = Math.pow(out.r, 1.32); out.g = Math.pow(out.g, 1.32); out.b = Math.pow(out.b, 1.32);
  return out;
}
function unitCyl(seg, rtop = 1) {
  const k = seg + '_' + rtop;
  if (!cylCache.has(k)) cylCache.set(k, new THREE.CylinderGeometry(rtop, 1, 1, seg, 1).toNonIndexed());
  return cylCache.get(k);
}

export class Batch {
  constructor() { this.list = []; }
  add(geo, col, id = 1, m = null) {
    const g = (geo.index ? geo.toNonIndexed() : geo).clone();
    if (m) g.applyMatrix4(m);
    const n = g.attributes.position.count;
    const c = paintCol(col);
    const ca = new Float32Array(n * 3), ia = new Float32Array(n);
    for (let i = 0; i < n; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; ia[i] = id; }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', g.attributes.position);
    out.setAttribute('normal', g.attributes.normal);
    out.setAttribute('uv', g.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    out.setAttribute('aCol', new THREE.BufferAttribute(ca, 3));
    out.setAttribute('aId', new THREE.BufferAttribute(ia, 1));
    this.list.push(out);
    return this;
  }
  box(w, h, d, pos, col, id = 1, rot = null) {
    _e.set(rot ? deg(rot[0]) : 0, rot ? deg(rot[1]) : 0, rot ? deg(rot[2]) : 0);
    _m.compose(_p.set(...pos), _q.setFromEuler(_e), _s.set(w, h, d));
    return this.add(unitBox, col, id, _m);
  }
  cyl(r, h, pos, col, id = 1, o = {}) {
    const rot = o.rot;
    _e.set(rot ? deg(rot[0]) : 0, rot ? deg(rot[1]) : 0, rot ? deg(rot[2]) : 0);
    _m.compose(_p.set(...pos), _q.setFromEuler(_e), _s.set(r, h, o.rz ?? r));
    return this.add(unitCyl(o.seg ?? 10, o.top ?? 1), col, id, _m);
  }
  pipe(a, b, r, col, id = 1, seg = 6) {
    _a.set(...a); _b.set(...b);
    const len = _a.distanceTo(_b);
    _p.addVectors(_a, _b).multiplyScalar(0.5);
    _q.setFromUnitVectors(_up, _b.sub(_a).normalize());
    _m.compose(_p, _q, _s.set(r, len, r));
    return this.add(unitCyl(seg), col, id, _m);
  }
  sphere(r, pos, col, id = 1, sc = [1, 1, 1]) {
    const g = new THREE.SphereGeometry(1, 12, 8);
    _m.compose(_p.set(...pos), _q.identity(), _s.set(r * sc[0], r * sc[1], r * sc[2]));
    return this.add(g, col, id, _m);
  }
  // plan polygon (x, z) pairs, counter-clockwise seen from above, extruded y0..y1,
  // top may be scaled for raked walls
  prism(plan, y0, y1, col, id = 1, topScale = 1) {
    const n = plan.length, pos = [], nor = [];
    let cx = 0, cz = 0; for (const [x, z] of plan) { cx += x; cz += z; } cx /= n; cz /= n;
    const top = plan.map(([x, z]) => [cx + (x - cx) * topScale, cz + (z - cz) * topScale]);
    const tri = (a, b, c, na) => { pos.push(...a, ...b, ...c); nor.push(...na, ...na, ...na); };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const A = [plan[i][0], y0, plan[i][1]], B = [plan[j][0], y0, plan[j][1]], C = [top[j][0], y1, top[j][1]], D = [top[i][0], y1, top[i][1]];
      const e1 = new THREE.Vector3(B[0] - A[0], 0, B[2] - A[2]), e2 = new THREE.Vector3(D[0] - A[0], y1 - y0, D[2] - A[2]);
      const nn = e2.clone().cross(e1).normalize();
      if (nn.x * ((A[0] + B[0]) / 2 - cx) + nn.z * ((A[2] + B[2]) / 2 - cz) < 0) nn.negate();
      tri(A, B, C, [nn.x, nn.y, nn.z]); tri(A, C, D, [nn.x, nn.y, nn.z]);
      tri([cx, y1, cz], D, C, [0, 1, 0]);
      tri([cx, y0, cz], A, B, [0, -1, 0]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return this.add(g, col, id);
  }
  build() { const g = mergeGeometries(this.list, false); this.list.length = 0; return g; }
}

function chamfered(xa, xb, za, zb, c) {
  return [[xa + c, za], [xb - c, za], [xb, za + c], [xb, zb - c], [xb - c, zb], [xa + c, zb], [xa, zb - c], [xa, za + c]];
}

// ------------------------------------------------------------------ hull
function hullSide(sign) {
  const NS = 96, NT = 22;
  const pos = [], uv = [], idx = [];
  const vTop = sign < 0 ? 1 : 0.5;                                  // row in the hull map
  for (let i = 0; i <= NS; i++) {
    const s = i / NS;
    const zA = lerp(-150, 152, s);
    const yTop = topY(zA);
    for (let j = 0; j <= NT + 1; j++) {
      const t = (j - 1) / NT;
      let y, x, z;
      if (j === 0) { y = H.keel; z = lerp(aftZ(y), stemZ(y), s); x = 0; }
      else { y = lerp(H.keel, yTop, t); z = lerp(aftZ(y), stemZ(y), s); x = halfBeam(z, y); }
      pos.push(sign * x, y, z);
      const u = sign < 0 ? (z + 150) / 300 : (150 - z) / 300;
      const v = vTop - 0.5 + 0.5 * (y - HULL_MAP.y0) / (HULL_MAP.y1 - HULL_MAP.y0);
      uv.push(u, v);
    }
  }
  const R = NT + 2;
  for (let i = 0; i < NS; i++) for (let j = 0; j < R - 1; j++) {
    const a = i * R + j, b = a + R, c = a + 1, d = b + 1;
    if (sign > 0) idx.push(a, b, d, a, d, c); else idx.push(a, d, b, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.attributes.position.count;
  g.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.setAttribute('aId', new THREE.BufferAttribute(new Float32Array(n).fill(5), 1));
  return g;
}
let HULL_GEO = null;
export function hullGeometry() {
  if (!HULL_GEO) HULL_GEO = mergeGeometries([hullSide(1), hullSide(-1)], false);
  return HULL_GEO;
}

function deckAndStern(b, colDeck) {
  // deck strip
  const pos = [], nor = [];
  const zs = []; for (let z = -150; z <= 150.5; z += 2) zs.push(z);
  for (let i = 0; i < zs.length - 1; i++) {
    const z0 = zs[i], z1 = zs[i + 1];
    const y0 = deckY(z0), y1 = deckY(z1);
    const x0 = halfBeam(z0, y0), x1 = halfBeam(z1, y1);
    pos.push(-x0, y0, z0, x0, y0, z0, x1, y1, z1, -x0, y0, z0, x1, y1, z1, -x1, y1, z1);
    const l = Math.hypot(2, y1 - y0), ny = 2 / l, nz = -(y1 - y0) / l;
    for (let k = 0; k < 6; k++) nor.push(0, ny, nz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  b.add(g, colDeck, 6);
  // transom
  const tp = [], tn = [];
  const ys = []; for (let y = 1; y <= 17.01; y += 1) ys.push(y);
  for (let i = 0; i < ys.length - 1; i++) {
    const y0 = ys[i], y1 = ys[i + 1], x0 = halfBeam(-150, y0), x1 = halfBeam(-150, y1), z = -150;
    tp.push(-x0, y0, z, -x1, y1, z, x1, y1, z, -x0, y0, z, x1, y1, z, x0, y0, z);
    for (let k = 0; k < 6; k++) tn.push(0, 0, -1);
  }
  const t = new THREE.BufferGeometry();
  t.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  t.setAttribute('normal', new THREE.Float32BufferAttribute(tn, 3));
  b.add(t, '#22346e', 5);
  // bulb, rudder, propeller
  b.sphere(1, [0, -8.5, 143], '#c43a2b', 5, [3.6, 4.2, 12]);
  b.box(1.4, 12, 9, [0, -6, -140], '#c43a2b', 8);
  for (let k = 0; k < 5; k++) { const a = k / 5 * 360; b.box(0.5, 6, 2.2, [Math.sin(deg(a)) * 3, -8 + Math.cos(deg(a)) * 3, -132], '#d8b45a', 9, [0, 0, -a]); }
}

// ------------------------------------------------------------------ fittings
function window_(b, x, y, z, w, h, side, hero) {
  // side: 0 faces +Z, 1 faces +X, -1 faces -X
  const glass = '#16345a', frame = '#d5d3cc';
  const dx = side === 0 ? w : 0.12, dz = side === 0 ? 0.12 : w;
  if (hero) b.box(dx + (side === 0 ? 0.3 : 0.1), h + 0.3, dz + (side === 0 ? 0.1 : 0.3), [x, y, z], frame, 14);
  b.box(dx, h, dz, [x + side * 0.1, y, z + (side === 0 ? 0.12 : 0)], glass, 13);
  if (hero) b.box(side === 0 ? w * 0.28 : 0.04, h * 0.5, side === 0 ? 0.04 : w * 0.28, [x + side * 0.14 + (side === 0 ? -w * 0.22 : 0), y + h * 0.14, z + (side === 0 ? 0.17 : -w * 0.22)], '#8fd4ee', 13);
}

function tower(b, hero) {
  const WHITE = '#f2f6ff', LIP = '#d4dbea';
  const zb = -102, zf = -58;
  const deckH = 3;
  for (let d = 0; d < 9; d++) {
    const y0 = 15 + d * deckH;
    const hw = d < 2 ? 18 : d < 6 ? 16.5 : 15;
    const zfd = zf - (d < 2 ? 0 : d < 6 ? 2 : 4);
    b.prism(chamfered(-hw, hw, zb, zfd, 2.2), y0, y0 + deckH - 0.25, WHITE, 11);
    b.prism(chamfered(-hw - 0.35, hw + 0.35, zb - 0.3, zfd + 0.35, 2.3), y0 + deckH - 0.25, y0 + deckH, LIP, 12);
    if (d === 0) continue;
    const y = y0 + 1.45;
    const nf = Math.floor((2 * hw - 5) / 3.1);
    for (let i = 0; i < nf; i++) { const x = (i - (nf - 1) / 2) * 3.1; window_(b, x, y, zfd + 0.02, 1.7, 1.3, 0, hero); }
    const ns = Math.floor((zfd - zb - 6) / 3.4);
    for (const s of [-1, 1]) for (let i = 0; i < ns; i++) {
      const z = zb + 3 + (i + 0.5) * 3.4;
      if (hero) {
        // round-cornered tall ports with rims, like the reference wall
        b.box(0.14, 1.75, 0.95, [s * hw, y, z], LIP, 14);
        b.box(0.1, 1.5, 0.7, [s * (hw + 0.08), y, z], '#1a3b63', 13);
      } else b.box(0.1, 1.3, 0.8, [s * (hw + 0.05), y, z], '#1a3b63', 13);
    }
  }
  const yB = 15 + 9 * deckH;   // bridge deck, y = 42
  // wheelhouse
  const zw0 = -80, zw1 = -60;
  b.prism(chamfered(-13, 13, zw0, zw1, 1.6), yB, yB + 3.6, WHITE, 11, 1.015);
  b.prism(chamfered(-14, 14, zw0 - 1, zw1 + 1.1, 2), yB + 3.6, yB + 3.95, LIP, 12);
  b.prism(chamfered(-11, 11, zw0 + 1, zw1 - 2, 1.6), yB + 3.95, yB + 5.0, WHITE, 11);
  const nw = 9;
  for (let i = 0; i < nw; i++) {
    const x = (i - (nw - 1) / 2) * 2.72;
    b.box(2.42, 1.9, 0.14, [x, yB + 2.1, zw1 + 0.05], '#102c50', 13, [-6, 0, 0]);
    if (hero) b.box(0.8, 0.9, 0.05, [x - 0.6, yB + 2.4, zw1 + 0.15], '#79c6e6', 13, [-6, 0, 0]);
  }
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) b.box(0.14, 1.8, 2.2, [s * 13.03, yB + 2.1, zw0 + 2 + i * 3], '#102c50', 13);
  // wings: wide, with a raked bracket under them, as in s16
  for (const s of [-1, 1]) {
    const x0 = 13, x1 = 24.5;
    b.box(x1 - x0, 0.5, 8.2, [s * (x0 + x1) / 2, yB - 0.2, zw1 - 4.2], LIP, 12);
    b.box(x1 - 16, 1.15, 8.2, [s * (x1 + 16) / 2, yB + 1.2, zw1 - 4.2], WHITE, 11);
    b.pipe([s * x1, yB + 0.1, zw1], [s * x1, yB + 1.3, zw1], 0.06, '#c8c4bc', 7, 5);
    // bracket under the wing
    const br = new THREE.BufferGeometry();
    const p = [];
    const z0 = zw1 - 8.3, z1 = zw1 - 0.1, xa = s * 15, xb = s * x1, y0 = yB - 0.45, yd = yB - 6;
    p.push(xa, yd, z0, xa, y0, z0, xb, y0, z0, xa, yd, z1, xb, y0, z1, xa, y0, z1, xa, yd, z0, xb, y0, z0, xb, y0, z1, xa, yd, z0, xb, y0, z1, xa, yd, z1);
    br.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    br.computeVertexNormals();
    b.add(br, WHITE, 11);
    // wing lamps and repeater
    b.box(1.2, 1.3, 1.2, [s * (x1 - 1), yB + 2.2, zw1 - 1], '#7fa0a8', 9);
  }
  // funnel: cream base, blue band, three black caps
  const fz = -90;
  b.cyl(8.0, 14, [0, yB + 1, fz], '#efe6d2', 15, { rz: 11, seg: 24, top: 0.97 });
  b.cyl(7.8, 5, [0, yB + 10.3, fz], '#1f55c7', 16, { rz: 10.7, seg: 24, top: 0.97 });
  b.cyl(7.9, 0.5, [0, yB + 13, fz], '#fff6e6', 17, { rz: 10.8, seg: 24 });
  b.cyl(7.7, 1.2, [0, yB + 13.8, fz], '#1f55c7', 16, { rz: 10.6, seg: 24, top: 0.96 });
  b.cyl(7.3, 0.7, [0, yB + 14.7, fz], '#27242e', 18, { rz: 10.1, seg: 24 });
  for (const [dx, dz] of [[-3.8, 0], [3.8, 0], [0, 4], [0, -5]]) {
    b.cyl(2.3, 3.2, [dx, yB + 16.3, fz + dz], '#2a2732', 18, { seg: 12 });
    b.sphere(2.35, [dx, yB + 17.9, fz + dz], '#2a2732', 18, [1, 0.62, 1]);
  }
  // masts: tall lattice poles with yards and radars, the skyline of s10
  const mast = (mx, mz, hgt, yards) => {
    const base = yB + 5;
    b.cyl(0.35, hgt, [mx, base + hgt / 2, mz], '#e8e4da', 19, { seg: 8, top: 0.55 });
    if (hero) {
      for (const [dx, dz] of [[1.5, 0], [-1.5, 0], [0, 1.5]]) b.pipe([mx + dx, base, mz + dz], [mx, base + hgt * 0.42, mz], 0.08, '#d9d4c8', 19, 5);
    }
    for (const [yy, w] of yards) {
      b.box(w, 0.28, 0.28, [mx, base + hgt * yy, mz], '#e8e4da', 19);
      for (const s of [-1, 1]) {
        b.pipe([mx + s * w * 0.5, base + hgt * yy, mz], [mx, base + hgt * yy - 2.6, mz], 0.05, '#cfcabf', 19, 4);
        b.box(0.5, 0.6, 0.5, [mx + s * w * 0.46, base + hgt * yy + 0.4, mz], '#40404c', 20);
      }
    }
    b.cyl(0.08, 3.2, [mx, base + hgt + 1.6, mz], '#333', 20, { seg: 4 });
    b.sphere(0.4, [mx, base + hgt + 0.1, mz], '#e03a2e', 21);
  };
  mast(-7, -66, 22, [[0.62, 9], [0.84, 6]]);
  mast(9, -67, 19, [[0.78, 8]]);
  // radar scanners and domes on the monkey island
  b.box(5.6, 0.32, 0.5, [-2, yB + 7.2, -63], '#22222a', 20); b.cyl(0.5, 1.2, [-2, yB + 6.4, -63], '#ddd', 19);
  b.box(4.2, 0.28, 0.45, [4, yB + 8.6, -64], '#22222a', 20); b.cyl(0.4, 2.8, [4, yB + 7.0, -64], '#ddd', 19);
  b.sphere(1.0, [-9, yB + 6.0, -72], '#f4f4f0', 19);
  b.sphere(0.8, [9, yB + 6.0, -72], '#f4f4f0', 19);
  // lifeboat
  for (const s of [-1, 1]) {
    b.sphere(1, [s * 19.4, 33.2, -86], '#ef6a1f', 22, [1.5, 1.5, 4.6]);
    b.box(2.2, 0.8, 7.4, [s * 19.4, 34.3, -86], '#f6f1e6', 23);
    for (const dz of [-3, 3]) { b.pipe([s * 16.5, 30, -86 + dz], [s * 20.5, 36.8, -86 + dz], 0.18, '#e0a020', 24, 6); }
  }
  // external stairs on the aft face
  for (let d = 1; d < 8; d++) {
    const y = 15 + d * deckH + 0.9;
    b.pipe([-10 + (d % 2) * 8, y - 1.5, zb - 0.9], [-2 - (d % 2) * 0, y + 1.3, zb - 0.9], 0.34, '#cbd1cc', 24, 4);
  }
}

function lashingBridge(b, z, hw, levels, hero) {
  const STEEL = '#3f7fb0', YEL = '#f3b52c';
  const yb = H.deck + 1;
  const nCol = Math.ceil(hw / 5);
  for (let lv = 0; lv < levels; lv++) {
    const y0 = yb + lv * 2.7, y1 = y0 + 2.7;
    for (let i = -nCol; i <= nCol; i++) {
      const x = i / nCol * hw;
      b.box(0.3, 2.7, 0.3, [x, (y0 + y1) / 2, z - 0.55], STEEL, 25);
      b.box(0.3, 2.7, 0.3, [x, (y0 + y1) / 2, z + 0.55], STEEL, 25);
    }
    b.box(2 * hw, 0.16, 1.4, [0, y1, z], '#6f8ea6', 26);
    if (hero || lv === levels - 1) {
      b.box(2 * hw, 0.07, 0.07, [0, y1 + 1.05, z + 0.62], YEL, 27);
      b.box(2 * hw, 0.07, 0.07, [0, y1 + 1.05, z - 0.62], YEL, 27);
    }
    if (hero) for (let i = -nCol * 2; i <= nCol * 2; i++) {
      b.box(0.06, 1.05, 0.06, [i / (2 * nCol) * hw, y1 + 0.52, z + 0.62], YEL, 27);
      b.box(0.06, 1.05, 0.06, [i / (2 * nCol) * hw, y1 + 0.52, z - 0.62], YEL, 27);
    }
  }
}

function railing(b, side, z0, z1, hero, yFn) {
  const STEP = hero ? 2.4 : 6;
  let prev = null;
  for (let z = z0; z <= z1; z += STEP) {
    const y = yFn(z), x = side * (halfBeam(z, y) - 0.15);
    b.pipe([x, y, z], [x, y + 1.25, z], hero ? 0.05 : 0.08, '#f2eee4', 7, 5);
    if (prev) {
      b.pipe([prev[0], prev[1] + 1.25, prev[2]], [x, y + 1.25, z], hero ? 0.045 : 0.07, '#f2eee4', 7, 5);
      if (hero) {
        b.pipe([prev[0], prev[1] + 0.85, prev[2]], [x, y + 0.85, z], 0.025, '#f2eee4', 7, 4);
        b.pipe([prev[0], prev[1] + 0.45, prev[2]], [x, y + 0.45, z], 0.025, '#f2eee4', 7, 4);
      }
    }
    prev = [x, y, z];
  }
}

function forecastle(b, hero) {
  const GREY = '#6a8796', EQ = '#2f7f4f';
  // breakwater, V-shaped with stiffeners
  const y0 = H.deck, y1 = H.deck + 8;
  const zb = 113;
  const wb = 20;
  const ptsT = [[-wb, zb - 3], [0, zb + 1.5], [wb, zb - 3]];
  for (let k = 0; k < 2; k++) {
    const [ax, az] = ptsT[k], [bx, bz] = ptsT[k + 1];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz), ang = Math.atan2(dx, dz) * 180 / Math.PI;
    b.box(0.5, y1 - y0, len, [(ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2], '#f0ebe0', 28, [0, ang, 0]);
    for (let i = 1; i < 7; i++) {
      const u = i / 7;
      b.box(0.3, y1 - y0 - 0.5, 0.5, [lerp(ax, bx, u), (y0 + y1) / 2 - 0.2, lerp(az, bz, u) - 0.35], '#d7d2c8', 28);
    }
  }
  // windlasses, bollards, chain, mast
  for (const s of [-1, 1]) {
    b.cyl(1.5, 2.2, [s * 4.5, H.fcle + 1.6, 128], EQ, 29, { rot: [0, 0, 90], seg: 14 });
    b.box(2.6, 1.6, 3.2, [s * 4.5, H.fcle + 0.8, 128], '#247040', 30);
    b.pipe([s * 5.2, H.fcle + 0.2, 131], [s * 10.5, H.fcle + 0.1, 137], 0.42, '#2a2730', 31, 6);
    for (const [x, z] of [[11, 122], [14.5, 122], [7, 134], [9, 118]]) {
      if (halfBeam(z, H.fcle) > Math.abs(x) + 1) {
        b.cyl(0.5, 1.1, [s * x, H.fcle + 0.55, z], '#3b3b48', 31, { seg: 10 });
        b.cyl(0.5, 1.1, [s * x, H.fcle + 0.55, z + 1.5], '#3b3b48', 31, { seg: 10 });
      }
    }
    // hawse and stockless anchor sitting in the flare
    const ax = halfBeam(133, 16) + 0.15;
    b.cyl(1.5, 1.4, [s * (ax - 0.3), 18.2, 133], '#10131c', 32, { rot: [0, 0, 90 + s * 12], seg: 14 });
    const sh = [s * (ax + 0.45), 15.4, 134];
    b.box(0.55, 5.2, 0.7, sh, '#2a2730', 32, [0, 0, s * 8]);
    b.box(0.8, 0.7, 3.6, [sh[0] + s * 0.25, 12.9, 134], '#2a2730', 32, [0, 0, s * 8]);
    for (const d of [-1, 1]) b.box(0.8, 2.5, 0.8, [sh[0] + s * 0.25, 13.8, 134 + d * 1.55], '#2a2730', 32, [d * 24, 0, s * 8]);
  }
  b.cyl(0.32, 13, [0, H.fcle + 6.5, 124], '#f0ebe0', 33, { seg: 8, top: 0.6 });
  b.box(5, 0.24, 0.24, [0, H.fcle + 9.5, 124], '#f0ebe0', 33);
  b.box(0.8, 0.8, 0.8, [0, H.fcle + 13, 124], '#e0d040', 34);
  b.box(3.4, 3.0, 2.2, [0, H.fcle + 1.5, 118.5], GREY, 30);
  b.cyl(0.1, 8, [0, H.fcle + 5.6, 145.5], '#eee', 33, { seg: 5 });
  if (hero) railing(b, 1, 116, 147, true, (z) => topY(z) - 0.1), railing(b, -1, 116, 147, true, (z) => topY(z) - 0.1);
}

function pedestalCrane(b, x, z, ang, hero) {
  const C = '#f0b322', D = '#d68f14';
  const y = H.deck;
  b.cyl(1.5, 18, [x, y + 9, z], '#f1ede2', 35, { seg: 12, top: 0.9 });
  b.box(4.6, 4, 5.4, [x, y + 19.2, z], C, 36);
  b.box(1.6, 1.8, 2.4, [x + 2.6, y + 19.6, z + 1.2], '#1b3a5a', 13);
  const dir = [Math.sin(deg(ang)), Math.cos(deg(ang))];
  const tip = [x + dir[0] * 32, y + 46, z + dir[1] * 32];
  b.pipe([x, y + 19, z], tip, 0.75, C, 37, 6);
  b.pipe([x - dir[1] * 1.2, y + 19, z + dir[0] * 1.2], tip, 0.42, D, 37, 5);
  b.pipe([x + dir[1] * 1.2, y + 19, z - dir[0] * 1.2], tip, 0.42, D, 37, 5);
  if (hero) {
    b.pipe([x - dir[0] * 1.4, y + 22, z - dir[1] * 1.4], tip, 0.06, '#222', 38, 4);
    b.pipe(tip, [tip[0], y + 24, tip[2]], 0.06, '#222', 38, 4);
    b.box(0.8, 1.2, 0.8, [tip[0], y + 23.5, tip[2]], '#d33', 38);
  }
}

// little crew figure, 1.75 m, feet at pos
export function crew(b, x, y, z, col = '#ef6a1f', helmet = '#f7f3e8') {
  b.pipe([x - 0.11, y, z], [x - 0.11, y + 0.85, z], 0.09, '#23304a', 40, 6);
  b.pipe([x + 0.11, y, z], [x + 0.11, y + 0.85, z], 0.09, '#23304a', 40, 6);
  b.cyl(0.2, 0.68, [x, y + 1.17, z], col, 41, { seg: 8, top: 1.12 });
  b.pipe([x - 0.27, y + 1.42, z], [x - 0.3, y + 0.86, z + 0.08], 0.06, col, 41, 5);
  b.pipe([x + 0.27, y + 1.42, z], [x + 0.3, y + 0.86, z + 0.08], 0.06, col, 41, 5);
  b.sphere(0.13, [x, y + 1.62, z], '#e9b08c', 42);
  b.sphere(0.145, [x, y + 1.67, z], helmet, 43, [1, 0.78, 1]);
}

// ------------------------------------------------------------------ whole static ship
const BAY_PITCH = 12.72, PAIR_GAP = 3.8;
export const BAYS = (() => {
  const a = [];
  let z = 110;
  let pair = 0;
  while (z - 2 * BAY_PITCH > -60) {
    a.push({ z: z - BAY_PITCH / 2, pair, zone: 0 }, { z: z - 1.5 * BAY_PITCH, pair, zone: 0 });
    a.push(); z -= 2 * BAY_PITCH + PAIR_GAP; pair++;
  }
  // astern of the tower
  a.push({ z: -105 - BAY_PITCH / 2, pair, zone: 1 }, { z: -105 - 1.5 * BAY_PITCH, pair, zone: 1 });
  return a;
})();

export function buildStatic(o = {}) {
  const hero = !!o.hero;
  const b = new Batch();
  deckAndStern(b, o.deck ?? '#2f9a78');
  tower(b, hero);
  forecastle(b, hero);
  // hatch covers and side passage
  for (const bay of BAYS) {
    const hb = halfBeam(bay.z + 6, H.deck) - 2.4;
    b.box(2 * hb, 1.4, BAY_PITCH - 0.4, [0, H.deck + 0.7, bay.z], '#44708c', 44);
    if (hero) for (let i = -2; i <= 2; i++) b.box(2 * hb + 0.2, 0.3, 0.3, [0, H.deck + 1.2, bay.z + i * 2.4], '#39607a', 44);
  }
  // lashing bridges
  const pairs = [...new Set(BAYS.filter((x) => x.zone === 0).map((x) => x.pair))];
  for (const p of pairs) {
    const bs = BAYS.filter((x) => x.pair === p);
    const z = bs[bs.length - 1].z - BAY_PITCH / 2 - PAIR_GAP / 2 + 0.4;
    const hw = Math.max(6, halfBeam(z + 8, H.deck) - 2.2);
    lashingBridge(b, z, hw, hero ? 3 : 2, hero);
    if (hero) {
      // lashing rods fan out from the bridge to the box corners
      for (let x = -hw + 1.2; x <= hw - 1; x += 2.52) {
        for (const lv of [1, 2]) {
          const y = H.deck + 1 + lv * 2.7;
          for (const dz of [-1, 1]) {
            b.pipe([x - 0.5, y, z + dz * 0.5], [x + 0.6, y + 2.3, z + dz * 1.0], 0.03, '#d8d4c6', 45, 4);
            b.pipe([x + 0.5, y, z + dz * 0.5], [x - 0.6, y + 2.3, z + dz * 1.0], 0.03, '#d8d4c6', 45, 4);
          }
        }
      }
    }
  }
  // side passage rail and fittings
  railing(b, 1, -148, 116, hero, deckY); railing(b, -1, -148, 116, hero, deckY);
  for (const s of [-1, 1]) {
    // walkway pipe run, deck boxes
    b.pipe([s * 21.3, H.deck + 0.5, -56], [s * 21.3, H.deck + 0.5, 110], 0.16, '#d9d4c6', 46, 6);
    b.pipe([s * 21.0, H.deck + 0.75, -56], [s * 21.0, H.deck + 0.75, 110], 0.09, '#e0a020', 46, 6);
    if (hero) for (let z = -50; z < 110; z += 25) {
      b.box(0.8, 1.3, 1.2, [s * 21.0, H.deck + 0.65, z], '#d93a2a', 47);
      b.cyl(0.28, 1.2, [s * 21.6, H.deck + 0.6, z + 3], '#d93a2a', 47);
      b.cyl(0.32, 0.5, [s * 20.7, H.deck + 1.6, z + 12], '#e8e4da', 48, { seg: 10 });
      b.cyl(0.6, 0.34, [s * 20.7, H.deck + 1.95, z + 12], '#e8e4da', 48, { seg: 10 });
    }
  }
  // provision cranes either side of the tower
  if (!hero) { pedestalCrane(b, -20, -50, 150, hero); pedestalCrane(b, 20, -106, 30, hero); }
  // stern: flag staff and mooring gear
  b.cyl(0.08, 9, [0, H.deck + 6.5, -148], '#eee', 33, { seg: 5 });
  for (const s of [-1, 1]) { b.cyl(1.3, 2, [s * 12, H.deck + 3.4, -142], '#2f7f4f', 29, { rot: [0, 0, 90], seg: 12 }); b.cyl(0.5, 1.1, [s * 18, H.deck + 2.5, -146], '#3b3b48', 31, { seg: 10 }); }
  if (hero) {
    for (const [x, z] of [[-19.5, -70], [-20, -62.3]]) crew(b, x, 42.3, z);
    // figures on the bridge roof, tiny against the sky
    crew(b, -3.2, 47.1, -62, '#20283a', '#20283a'); crew(b, 2.6, 47.1, -62, '#20283a', '#20283a');
  }
  if (o.extra) o.extra(b);
  const g = b.build();
  return g;
}

// ------------------------------------------------------------------ containers
const PALETTE = ['#b8452f', '#cf5a3e', '#a93c33', '#df8238', '#e2b54e', '#2c5cb4', '#3a8ad0', '#2a9c92', '#3e9a5c', '#a9b4c2', '#ece8de', '#7f62c0', '#d0688e'];
const BLOCK = ['#b8452f', '#2c5cb4', '#2a9c92', '#df8238', '#3e9a5c', '#cf5a3e', '#3a8ad0', '#ece8de', '#a9b4c2'];

const hashLot = (x) => { let h = Math.imul(x | 0, 2654435761) >>> 0; h ^= h >>> 13; return Math.imul(h, 1597334677) >>> 0; };
// Returns [{ x, y, z, col, logo, seed, id, far, flip, len }], visible boxes only.
export function layoutContainers(o = {}) {
  const rng = new Rng(o.seed ?? 11);
  const tMax = o.tiers ?? 7;
  const base = H.deck + 1.45 + BOX.H / 2;
  const cells = [];   // bay -> row -> stack height
  const rowsAt = [];
  BAYS.forEach((bay, bi) => {
    const hb = halfBeam(bay.z + 6.3, H.deck) - 2.6;
    const n = Math.floor((2 * hb) / 2.53);
    const bowK = clamp((bay.z - 40) / 70), sternK = bay.zone ? 0.5 : 0;
    const top = Math.round(tMax - bowK * 2.2 - sternK * 2 + rng.range(-0.7, 0.7));
    const rows = [];
    for (let r = 0; r < n; r++) {
      const e = Math.abs(r - (n - 1) / 2) / Math.max(1, (n - 1) / 2);
      let h = top - (e > 0.75 ? 1 : 0) - (rng.next() < 0.18 ? rng.int(1, 2) : 0) - (rng.next() < 0.03 ? 3 : 0);
      if (o.gap && o.gap(bay, r, n)) h = o.gap(bay, r, n);
      rows.push(Math.max(1, h));
    }
    cells.push(rows); rowsAt.push(n);
  });
  const stackAt = (bi, r) => (cells[bi] ? (cells[bi][r] ?? 0) : 0);
  const out = [];
  BAYS.forEach((bay, bi) => {
    const n = rowsAt[bi];
    // boxes come aboard in lots: chunks a few rows wide and a couple of tiers deep share a line colour
    const lot = {};
    const lotCol = (r, t) => {
      const key = (Math.floor((r + bay.pair) / 3) * 8 + Math.floor((t + bi % 2) / 2)) | 0;
      return (lot[key] ??= BLOCK[(hashLot(bay.pair * 31 + key * 7 + (o.seed ?? 11)) % BLOCK.length)]);
    };
    for (let r = 0; r < n; r++) {
      const hgt = cells[bi][r];
      const x = (r - (n - 1) / 2) * 2.53;
      for (let t = 0; t < hgt; t++) {
        const vis = t >= hgt - 1 || r === 0 || r === n - 1 || stackAt(bi, r - 1) <= t || stackAt(bi, r + 1) <= t ||
          BAYS[bi - 1]?.pair !== bay.pair || BAYS[bi + 1]?.pair !== bay.pair || stackAt(bi - 1, r) <= t || stackAt(bi + 1, r) <= t;
        if (!vis) { rng.next(); continue; }
        const cr = rng.next();
        const col = o.paint?.(bay, r, n, t) ?? (cr < 0.8 ? lotCol(r, t) : PALETTE[rng.int(0, PALETTE.length - 1)]);
        const logo = rng.next() < 0.68 ? rng.int(0, 6) : -1;
        const sd = rng.next();
        const twenty = rng.next() < 0.12;
        const flip = rng.next() < 0.5 ? 1 : -1;
        const id = 1 + ((bi * 7 + r * 3 + t * 5) % 58) + 1;
        const far = 2 + (bay.pair % 2) * 2;
        const y = base + t * (BOX.H + 0.02);
        if (twenty && t >= hgt - 2) {
          for (const dz of [-3.09, 3.09]) out.push({ x, y, z: bay.z + dz, col: rng.next() < 0.5 ? col : PALETTE[rng.int(0, PALETTE.length - 1)], logo: -1, seed: rng.next(), id: id + (dz > 0 ? 1 : 0), far, flip, len: 0.495 });
        } else out.push({ x, y, z: bay.z, col, logo, seed: sd, id, far, flip, len: 1 });
      }
    }
  });
  return out;
}

const _im = new THREE.Matrix4(), _iq = new THREE.Quaternion(), _ip = new THREE.Vector3(), _is = new THREE.Vector3(), _ic = new THREE.Color();
export function instancedContainers(list, geo, mat) {
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const a0 = new Float32Array(list.length * 4), a1 = new Float32Array(list.length * 4);
  list.forEach((c, i) => {
    _iq.setFromAxisAngle(_up, c.flip > 0 ? Math.PI / 2 : -Math.PI / 2);
    if (c.q) _iq.copy(c.q);
    _im.compose(_ip.set(c.x, c.y, c.z), _iq, _is.set(c.len, 1, 1));
    m.setMatrixAt(i, _im);
    paintCol(c.col, _ic);
    a0[i * 4] = _ic.r; a0[i * 4 + 1] = _ic.g; a0[i * 4 + 2] = _ic.b; a0[i * 4 + 3] = c.id;
    a1[i * 4] = c.logo; a1[i * 4 + 1] = c.seed; a1[i * 4 + 2] = c.len; a1[i * 4 + 3] = c.far;
  });
  m.geometry = geo.clone();
  m.geometry.setAttribute('aI0', new THREE.InstancedBufferAttribute(a0, 4));
  m.geometry.setAttribute('aI1', new THREE.InstancedBufferAttribute(a1, 4));
  m.frustumCulled = false;
  return m;
}
