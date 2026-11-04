import * as THREE from 'three';
import { v3, hull, cbox, cyl, cylZ, cylX, extrude, crSample, creased, Kit } from './archer-geo.js';
import { STY } from './archer-model.js';
import { lerp, deg } from './util.js';

// The great bow, in robot units (1 = 10 m). Local frame: origin at the grip, +Y along the riser,
// +X the string side, -X toward the target, Z lateral. Built in the fully drawn shape.
// One limb is one continuous spine: SPINE is sampled for both of its rigid parts, so the curve
// stays unbroken and the small flex hinges are hidden inside the riser and the cable block.
export const SPINE = [[-0.3, 1.5], [-0.42, 2.4], [-0.34, 3.4], [-0.08, 4.35], [0.4, 5.2], [1.06, 5.95], [1.72, 6.5], [2.16, 6.92], [2.3, 7.34]];
const VB = 0.5, VC = 0.9;
export const BOW = { rest: [0, 0.46, 0.22] };   // where the arrow crosses the riser

const RK = 0.82;
const BLK = { col: '#2c3045', metal: 0.5, detail: 0.7, tone: 0.06, wear: 0.7 };
const BLK2 = { col: '#3d4258', metal: 0.62, detail: 0.8, tone: 0.06, wear: 0.8 };
const STRIP = { col: '#e4e6ee', metal: 0.9, detail: 0.5, tone: 0.03, wear: 0.9 };

const at = (v) => crSample(SPINE, v);
function frame(v) {
  const c = at(v), a = at(Math.max(v - 0.012, 0)), b = at(Math.min(v + 0.012, 1));
  const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty);
  return { c, tx: tx / l, ty: ty / l, nx: -ty / l, ny: tx / l, ang: Math.atan2(ty, tx) - Math.PI / 2 };
}

// Sweeps a closed section along the spine. sec(v) gives [[a, b]...]: a along the curve normal
// (+ toward the target side), b along Z. Offsets are relative to spine point `org`.
function sweep(v0, v1, n, sec, org) {
  const rings = [];
  for (let i = 0; i <= n; i++) {
    const v = lerp(v0, v1, i / n), f = frame(v);
    rings.push({ c: new THREE.Vector3(f.c[0] - org[0], f.c[1] - org[1], 0), p: sec(v).map(([a, b]) => new THREE.Vector3(f.c[0] - org[0] + f.nx * a, f.c[1] - org[1] + f.ny * a, b)) });
  }
  const pos = [], m = rings[0].p.length;
  const tri = (a, b, d, ref) => {
    const n3 = b.clone().sub(a).cross(d.clone().sub(a));
    const out = a.clone().add(b).add(d).divideScalar(3).sub(ref);
    if (n3.dot(out) < 0) pos.push(a.x, a.y, a.z, d.x, d.y, d.z, b.x, b.y, b.z);
    else pos.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z);
  };
  const mid = (r) => r.p.reduce((s, q) => s.add(q), new THREE.Vector3()).divideScalar(m);
  for (let i = 0; i < n; i++) {
    const r0 = rings[i], r1 = rings[i + 1], ref = mid(r0);
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      tri(r0.p[k], r0.p[k2], r1.p[k2], ref); tri(r0.p[k], r1.p[k2], r1.p[k], ref);
    }
  }
  for (const [r, s] of [[rings[0], -1], [rings[n], 1]]) {
    const c = mid(r), ref = c.clone().add(new THREE.Vector3(rings[n].c.x - rings[0].c.x, rings[n].c.y - rings[0].c.y, 0).normalize().multiplyScalar(-s * 0.1));
    for (let k = 0; k < m; k++) tri(c, r.p[k], r.p[(k + 1) % m], ref);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return creased(g, deg(38));
}

// chamfered rectangle section, half sizes ha (normal), hb (z), centred at (oa, ob)
const rect = (ha, hb, oa = 0, ob = 0) => {
  const c = Math.min(ha, hb) * 0.3;
  return [[ha, hb - c], [ha - c, hb], [-ha + c, hb], [-ha, hb - c], [-ha, -hb + c], [-ha + c, -hb], [ha - c, -hb], [ha, -hb + c]].map(([a, b]) => [a + oa, b + ob]);
};
const TH = (v) => lerp(0.15, 0.07, v), WD = (v) => lerp(0.2, 0.085, v);   // limb half thickness, half width

export function buildBow(material) {
  const { PALE, SILVER, STEEL, GUN, DARK, BRONZE, PISTON, RED } = STY;
  const j = {};
  const root = new THREE.Group(); root.name = 'bow'; j.root = root;
  const J = (name, parent, pos) => { const g = new THREE.Group(); g.name = name; g.position.set(...pos); parent.add(g); j[name] = g; return g; };
  const k = new Kit(23);
  const R = J('riser', root, [0, 0, 0]);
  R.scale.y = RK;     // the machined riser is modelled long, then fitted to the fist
  const O = at(0), B0 = at(VB), C0 = at(VC);
  for (const [n, s] of [['t', 1], ['b', -1]]) {
    const a = J(n + 'A', root, [O[0], s * O[1], 0]);
    const b = J(n + 'B', a, [B0[0] - O[0], s * (B0[1] - O[1]), 0]);
    J(n + 'C', b, [C0[0] - B0[0], s * (C0[1] - B0[1]), 0]);
  }

  // ---------------------------------------------------------------- riser
  // a machined skeleton: two cut plates around a dark core, windows, hubs, bolts (ref s01)
  const half = [[-0.2, 0.0], [-0.21, 0.46], [-0.44, 0.76], [-0.66, 1.2], [-0.64, 1.72], [-0.46, 2.1], [-0.12, 2.1], [-0.1, 1.66], [-0.02, 1.16], [0.22, 0.72], [0.21, 0.46], [0.2, 0.0]];
  const outline = [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [x, -y])];
  const win = (y0, s = 1) => [[-0.5, y0 + 0.5], [-0.26, y0 + 0.5], [-0.2, y0 + 0.12], [-0.36, y0]].map(([x, y]) => [x, s * y]);
  const holes = [win(1.12, 1), win(1.12, -1).reverse(), { x: -0.27, y: 0.84, r: 0.09 }, { x: -0.27, y: -0.84, r: 0.09 }, { x: -0.38, y: 1.84, r: 0.1 }, { x: -0.38, y: -1.84, r: 0.1 }];
  for (const z of [-0.12, 0.12]) k.add('riser', extrude(outline, 0.07, 0.016, holes), BLK2, [0, 0, z]);
  k.add('riser', extrude(outline.map(([x, y]) => [x * 0.86 - 0.02, y * 0.97]), 0.17, 0.01), BLK);
  // the grip proper: the fingers close around this
  k.add('riser', hull([v3(-0.2, 0.44, 0.15), v3(0.2, 0.44, 0.15), v3(-0.2, 0.44, -0.15), v3(0.2, 0.44, -0.15), v3(-0.22, 0, 0.17), v3(0.22, 0, 0.17), v3(-0.22, 0, -0.17), v3(0.22, 0, -0.17), v3(-0.2, -0.44, 0.15), v3(0.2, -0.44, 0.15), v3(-0.2, -0.44, -0.15), v3(0.2, -0.44, -0.15)], 16), GUN);
  for (let i = 0; i < 5; i++) k.add('riser', cbox(0.44, 0.035, 0.38, 0.01), DARK, [0, -0.32 + i * 0.16, 0]);
  // bolts down the plates, knobs at the hubs
  for (const s of [1, -1]) for (const z of [1, -1]) {
    for (const [x, y] of [[-0.54, 1.3], [-0.5, 1.68], [-0.14, 1.28], [-0.1, 1.9], [0.08, 0.86], [-0.5, 2.0], [-0.14, 0.62]]) k.add('riser', cylZ(0.035, 0.02, 8), PALE, [x, s * y, z * 0.16]);
    k.add('riser', cylZ(0.12, 0.05, 18), BRONZE, [-0.05, s * 0.66, z * 0.165]);
    k.add('riser', cylZ(0.065, 0.08, 12), PALE, [-0.05, s * 0.66, z * 0.17]);
  }
  // pale strut with a hub wheel (ref: the linkage under the fist)
  for (const s of [1, -1]) {
    k.add('riser', hull([v3(0.12, s * 0.74, 0.08), v3(0.26, s * 0.74, 0.08), v3(0.12, s * 0.74, -0.08), v3(0.26, s * 0.74, -0.08), v3(0.18, s * 1.62, 0.07), v3(0.04, s * 1.62, 0.07), v3(0.18, s * 1.62, -0.07), v3(0.04, s * 1.62, -0.07)], 16), s > 0 ? GUN : STEEL);
    k.add('riser', cylZ(0.15, 0.22, 20), DARK, [0.12, s * 1.66, 0]);
    k.add('riser', cylZ(0.1, 0.26, 18), PISTON, [0.12, s * 1.66, 0]);
    k.add('riser', cylZ(0.045, 0.29, 10), GUN, [0.12, s * 1.66, 0]);
    k.add('riser', cylZ(0.2, 0.3, 20), BLK2, [O[0], (s * O[1]) / RK, 0]);
    k.add('riser', cylZ(0.12, 0.34, 16), PISTON, [O[0], (s * O[1]) / RK, 0]);
    k.add('riser', cylZ(0.05, 0.37, 10), DARK, [O[0], (s * O[1]) / RK, 0]);
  }
  // arrow rest
  k.add('riser', cbox(0.3, 0.05, 0.24, 0.012), PALE, [0, (BOW.rest[1] - 0.08) / RK, 0.13]);
  k.add('riser', cbox(0.2, 0.012, 0.012, 0.002), RED, [0, 0.42, 0.19]);

  // ---------------------------------------------------------------- limbs
  for (const [n, s] of [['t', 1], ['b', -1]]) {
    const add = (bin, geo, st) => (s > 0 ? k.add(bin, geo, st) : k.add(bin, geo, st, [0, 0, 0], [0, 0, 180], { mirror: true }));
    const A = n + 'A', B = n + 'B', C = n + 'C';
    const limb = (bin, v0, v1, nn, org) => {
      add(bin, sweep(v0, v1, nn, (v) => rect(TH(v) * 0.5, WD(v) * 0.82), org), STRIP);                                // pale inlay strip
      for (const q of [1, -1]) {
        add(bin, sweep(v0, v1, nn, (v) => rect(TH(v), WD(v) * 0.24, 0, q * WD(v) * 0.86), org), BLK);                 // black rails
        add(bin, sweep(v0, v1, nn, (v) => rect(TH(v) * 0.34, 0.012, 0.02, q * (WD(v) * 1.1 + 0.006)), org), PISTON);  // bright line on the rail's flank
      }
    };
    limb(A, 0, VB + 0.012, 14, O);
    limb(B, VB - 0.012, 1, 16, B0);
    // back ribs on the thick section: every one sits square on the spine
    for (let i = 1; i < 7; i++) {
      const f = frame((i / 7) * VB);
      add(A, cbox(0.05, 0.05, WD((i / 7) * VB) * 2.1, 0.01).rotateZ(f.ang).translate(f.c[0] - O[0] + f.nx * TH(0.2) * 1.05, f.c[1] - O[1] + f.ny * TH(0.2) * 1.05, 0), BLK2);
    }

    // ---- the cable block on the join (ref s02): black housing, pale U clamp, knurled cap
    const fb = frame(VB);
    const blk = (g, x, y, z = 0) => g.translate(x, y, z).rotateZ(fb.ang);
    add(B, blk(cbox(0.4, 0.62, 0.42, 0.04, { wt: 0.36, dt: 0.4 }), -0.2, 0.0), BLK);       // on the string side
    add(B, blk(cbox(0.05, 0.5, 0.34, 0.01), -0.42, 0.02), BLK2);
    add(B, blk(cbox(0.06, 0.74, 0.46, 0.02), 0.12, 0.0), BLK2);
    for (const q of [1, -1]) {
      for (const [x, y] of [[-0.3, 0.2], [-0.3, -0.2], [-0.1, 0.2], [-0.1, -0.2]]) add(B, blk(cylX(0.026, 0.02, 10).rotateZ(Math.PI / 2).rotateX(Math.PI / 2), x, y, q * 0.215), PALE);
      add(B, blk(cbox(0.5, 0.12, 0.06, 0.016), -0.06, -0.3, q * 0.26), PALE);              // U clamp arms
    }
    add(B, blk(cbox(0.09, 0.14, 0.58, 0.02), 0.2, -0.3), PALE);                            // U clamp bridge
    // knurled cap and nozzle, leaning up the limb on the string side
    const cap = (g, y = 0) => g.translate(0, y, 0).rotateZ(-0.62).translate(-0.34, 0.42, 0).rotateZ(fb.ang);
    add(B, cap(cyl(0.15, 0.17, 0.1, 22)), BLK2);
    for (let i = 0; i < 14; i++) { const r = (i / 14) * Math.PI * 2; add(B, cap(cbox(0.016, 0.09, 0.024, 0.003).translate(Math.cos(r) * 0.17, 0, Math.sin(r) * 0.17)), PALE); }
    add(B, cap(cyl(0.05, 0.085, 0.16, 12), 0.12), DARK);
    add(B, cap(cyl(0.036, 0.036, 0.12, 10), 0.24), BLK2);
    // the cable: lies along the limb from the cap to the cam, part of the same drawing
    const p0 = new THREE.Vector3(...[-0.34 + 0.2, 0.42 + 0.3, 0]).applyAxisAngle(new THREE.Vector3(0, 0, 1), fb.ang);
    const fc = frame(VC);
    const p1 = new THREE.Vector3(fc.c[0] - B0[0] - fc.nx * 0.2, fc.c[1] - B0[1] - fc.ny * 0.2, 0);
    const dc = p1.clone().sub(p0), lc = dc.length();
    add(B, cyl(0.016, 0.016, lc, 6).translate(0, lc / 2, 0).rotateZ(Math.atan2(dc.y, dc.x) - Math.PI / 2).translate(p0.x, p0.y, 0), DARK);

    // ---- cam near the tip: a slim grooved wheel in a fork
    add(B, cbox(0.04, 0.46, 0.2, 0.01).rotateZ(fc.ang).translate(fc.c[0] - B0[0] - fc.nx * 0.08, fc.c[1] - B0[1] - fc.ny * 0.08, 0), BLK);
    add(C, cylZ(0.2, 0.09, 26), BLK2);
    add(C, cylZ(0.22, 0.035, 26), DARK);
    add(C, cylZ(0.11, 0.12, 18), BRONZE);
    add(C, cylZ(0.055, 0.15, 12), PISTON);
    for (let i = 0; i < 6; i++) { const r = (i / 6) * Math.PI * 2; add(C, cylZ(0.03, 0.1, 8).translate(Math.cos(r) * 0.155, Math.sin(r) * 0.155, 0), BLK); }
  }
  void SILVER; void STEEL;
  const meshes = k.finish(j, material);

  // anchors: the string lands on the very tips
  const anchors = {};
  const mark = (name, parent, pos) => { const o = new THREE.Object3D(); o.position.set(...pos); j[parent].add(o); anchors[name] = o; };
  const E = at(1), D = at(0.97);
  mark('strT', 'tB', [D[0] - B0[0] + 0.03, D[1] - B0[1], 0]);
  mark('strB', 'bB', [D[0] - B0[0] + 0.03, -(D[1] - B0[1]), 0]);
  mark('tipT', 'tB', [E[0] - B0[0], E[1] - B0[1], 0]);
  mark('tipB', 'bB', [E[0] - B0[0], -(E[1] - B0[1]), 0]);
  return { root, j, meshes, anchors };
}

// A cable: a six-sided tube re-laid through a polyline every frame.
export class Strand {
  constructor(material, nPts, radius, st = {}) {
    this.n = nPts; this.r = radius;
    const seg = 6;
    this.seg = seg;
    const nv = nPts * seg;
    const idx = [];
    for (let i = 0; i < nPts - 1; i++) for (let s = 0; s < seg; s++) {
      const a = i * seg + s, b = i * seg + (s + 1) % seg, c = a + seg, d = b + seg;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3), mat = new Float32Array(nv * 4), ex = new Float32Array(nv * 3);
    const c = new THREE.Color(st.col ?? '#2a2e42');
    for (let i = 0; i < nv; i++) {
      col.set([c.r, c.g, c.b], i * 3);
      mat.set([st.metal ?? 0.5, 0, 0, st.id ?? 41], i * 4);
      ex.set([0, 0, 0.5], i * 3);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aMat', new THREE.BufferAttribute(mat, 4));
    g.setAttribute('aEx', new THREE.BufferAttribute(ex, 3));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'strand';
  }

  set(pts) {
    const P = this.mesh.geometry.attributes.position, N = this.mesh.geometry.attributes.normal;
    const t = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1);
    const { n, seg, r } = this;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      t.subVectors(b, a).normalize();
      u.crossVectors(t, up); if (u.lengthSq() < 1e-6) u.set(1, 0, 0); u.normalize();
      v.crossVectors(t, u);
      for (let s = 0; s < seg; s++) {
        const ang = (s / seg) * Math.PI * 2, c = Math.cos(ang), d = Math.sin(ang);
        const nx = u.x * c + v.x * d, ny = u.y * c + v.y * d, nz = u.z * c + v.z * d;
        P.setXYZ(i * seg + s, pts[i].x + nx * r, pts[i].y + ny * r, pts[i].z + nz * r);
        N.setXYZ(i * seg + s, nx, ny, nz);
      }
    }
    P.needsUpdate = true; N.needsUpdate = true;
  }
}
