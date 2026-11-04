import * as THREE from 'three';

// Stateless helpers for the energy department. Everything is a pure function of time:
// frames render in random order, so nothing may carry from one frame to the next.
// All lightning is built on the CPU each frame from a hash of (drawing number, index),
// drawn on threes, so it flicks like hand-animated lightning instead of boiling.

export function hash(a, b = 0, c = 0) {
  let h = Math.imul((a * 7919) | 0, 0x27d4eb2d) ^ Math.imul((b * 104729) | 0, 0x165667b1) ^ Math.imul((c * 15485863) | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const hr = (a, b, c, lo, hi) => lo + (hi - lo) * hash(a, b, c);
export const drawing = (t, fps = 8) => Math.floor(t * fps + 1e-6);

const V = THREE.Vector3;

// ---------------------------------------------------------- line batch
// Polylines extruded in screen space by the vertex shader. Widths are in output pixels
// (px) and/or metres (m), so a bolt keeps a crisp drawn weight at any distance and a
// plasma ribbon can still taper with perspective.
export class LineBatch {
  constructor(material, maxVerts = 90000) {
    this.max = maxVerts;
    const g = new THREE.BufferGeometry();
    const mk = (n) => { const a = new THREE.BufferAttribute(new Float32Array(maxVerts * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.aPos = mk(3); this.aPrev = mk(3); this.aNext = mk(3);
    this.aA = mk(4); this.aC = mk(4); this.aH = mk(4); this.aK = mk(4);
    g.setAttribute('position', this.aPos); g.setAttribute('aPrev', this.aPrev); g.setAttribute('aNext', this.aNext);
    g.setAttribute('aA', this.aA); g.setAttribute('aC', this.aC); g.setAttribute('aH', this.aH); g.setAttribute('aK', this.aK);
    this.idx = new THREE.BufferAttribute(new Uint32Array(maxVerts * 3), 1);
    this.idx.setUsage(THREE.DynamicDrawUsage);
    g.setIndex(this.idx);
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.userData.noShadow = true;
    this.nv = 0; this.ni = 0;
  }
  begin() { this.nv = 0; this.ni = 0; }
  // pts: Vector3[]; o: { px, m, width(s), color [r,g,b] | fn(s,out), hot [r,g,b], power, soft, mode, bias, rim, alpha(s) }
  //   mode 0: depth tested (bias = tolerance in metres)
  //   mode 1: drawn only over geometry nearer than bias metres (crawls on armour and skin)
  //   mode 2: no test
  push(pts, o = {}) {
    const n = pts.length;
    if (n < 2 || this.nv + n * 2 > this.max) return;
    const px = o.px ?? 1.5, m = o.m ?? 0, soft = o.soft ?? 6, mode = o.mode ?? 0, bias = o.bias ?? 2, rim = o.rim ?? 0;
    const col = o.color ?? [0.25, 0.75, 1.0], hot = o.hot ?? [1, 1, 1], power = o.power ?? 1;
    const fw = o.width, fc = typeof col === 'function' ? col : null, fa = o.alpha;
    const c = fc ? [0, 0, 0] : col;
    const base = this.nv;
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1);
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const wk = fw ? fw(s) : 1;
      if (fc) fc(s, c);
      const pw = power * (fa ? fa(s) : 1);
      for (let sd = 0; sd < 2; sd++) {
        const v = this.nv++;
        this.aPos.array.set([p.x, p.y, p.z], v * 3);
        this.aPrev.array.set([a.x, a.y, a.z], v * 3);
        this.aNext.array.set([b.x, b.y, b.z], v * 3);
        this.aA.array.set([sd ? 1 : -1, s, px * wk, m * wk], v * 4);
        this.aC.array.set([c[0], c[1], c[2], pw], v * 4);
        this.aH.array.set([hot[0], hot[1], hot[2], soft], v * 4);
        this.aK.array.set([mode, bias, rim, 0], v * 4);
      }
      if (i < n - 1) {
        const q = base + i * 2, ia = this.idx.array, k = this.ni;
        ia[k] = q; ia[k + 1] = q + 1; ia[k + 2] = q + 2; ia[k + 3] = q + 1; ia[k + 4] = q + 3; ia[k + 5] = q + 2;
        this.ni += 6;
      }
    }
  }
  end() {
    this.geo.setDrawRange(0, this.ni);
    for (const a of [this.aPos, this.aPrev, this.aNext, this.aA, this.aC, this.aH, this.aK, this.idx]) { a.needsUpdate = true; a.clearUpdateRanges?.(); }
    this.mesh.visible = this.ni > 0;
  }
}

// ---------------------------------------------------------- glow batch
export const KIND = { soft: 0, kira: 1, ring: 2, burst: 3, streak: 4, disc: 5 };
export class GlowBatch {
  constructor(material, max = 512) {
    this.max = max;
    const g = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aK = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aL = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    for (const a of [this.aPos, this.aC, this.aK, this.aL]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iC', this.aC); g.setAttribute('iK', this.aK); g.setAttribute('iL', this.aL);
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.n = 0;
  }
  begin() { this.n = 0; }
  // o: { kind, m (radius metres), px (radius pixels), color, power, rot, aspect, mode, bias, seed, thick }
  push(p, o) {
    if (this.n >= this.max || (o.power ?? 1) <= 0) return;
    const i = this.n++, c = o.color ?? [0.45, 0.85, 1];
    this.aPos.array.set([p.x, p.y, p.z], i * 3);
    this.aC.array.set([c[0], c[1], c[2], o.power ?? 1], i * 4);
    this.aK.array.set([o.kind ?? 0, o.m ?? 0, o.px ?? 0, o.rot ?? 0], i * 4);
    this.aL.array.set([o.aspect ?? 1, o.mode ?? 0, o.bias ?? 4, o.seed ?? o.thick ?? 0.1], i * 4);
  }
  end() {
    this.geo.instanceCount = this.n;
    for (const a of [this.aPos, this.aC, this.aK, this.aL]) { a.needsUpdate = true; a.clearUpdateRanges?.(); }
    this.mesh.visible = this.n > 0;
  }
}

// ---------------------------------------------------------- paths
const _a = new V(), _b = new V(), _d = new V();

// A lightning leg: long straight runs and sharp kinks, displaced across the view so
// the jaggedness always reads on screen. Returns fresh vectors (the frame is short lived).
export function boltPts(a, b, seed, R, U, rough = 0.24, levels = 5) {
  let pts = [a.clone(), b.clone()];
  let amp = a.distanceTo(b) * rough;
  for (let l = 0; l < levels; l++) {
    const nx = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const k = 0.3 + 0.4 * hash(seed, l * 31 + 1, i);
      const m = new V().lerpVectors(p, q, k);
      const dx = (hash(seed, l * 31 + 2, i) - 0.5) * 2 * amp, dy = (hash(seed, l * 31 + 3, i) - 0.5) * 2 * amp;
      m.addScaledVector(R, dx).addScaledVector(U, dy);
      nx.push(m, q);
    }
    pts = nx;
    amp *= 0.52;
  }
  return pts;
}

// A curling, wandering leg that creeps over a surface (a crawler on armour or skin).
export function crawlPts(a, dir, seed, R, U, len, steps = 10, curl = 1.2) {
  const pts = [a.clone()];
  let ang = Math.atan2(dir.dot(U), dir.dot(R));
  const st = len / steps;
  const p = a.clone();
  for (let i = 0; i < steps; i++) {
    ang += (hash(seed, i, 5) - 0.5) * 2 * curl;
    const s = st * (0.5 + hash(seed, i, 6));
    p.addScaledVector(R, Math.cos(ang) * s).addScaledVector(U, Math.sin(ang) * s);
    pts.push(p.clone());
  }
  return pts;
}

export function resample(pts, n) {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const L = acc[acc.length - 1] || 1, out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * L;
    while (j < pts.length - 2 && acc[j + 1] < s) j++;
    const f = (s - acc[j]) / Math.max(acc[j + 1] - acc[j], 1e-6);
    out.push(new V().lerpVectors(pts[j], pts[j + 1], Math.min(1, f)));
  }
  return out;
}

// Point on a straight line a→b at parameter s, offset across the view.
export function along(a, b, s, out = new V()) { return out.lerpVectors(a, b, s); }

void _a; void _b; void _d;
