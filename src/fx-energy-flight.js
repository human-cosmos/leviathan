import * as THREE from 'three';
import { clamp, invLerp, smooth, easeOut, lerp, onTwos } from './util.js';
import { KIND, hash, boltPts, resample } from './fx-energy-core.js';
import { CYAN, ICE, BLUE } from './fx-energy-charge.js';

// s11–s13 and s26–s30: the arrow in flight. World flies the arrow and owns those cameras
// (ctx.world.arrow, tip along +Z, length in the z scale); this module hangs the contrail,
// the shock and the plasma on it. Sizes are set in frame terms or metres near the head,
// never from the arrow's length: in s13 it is 1500 m long and passes the lens. Where the
// reference is a composition more than a physical thing (the vortex ropes of s13, the rays
// of s26, the beam of s28) the shapes are laid out in frame coordinates.

const V = THREE.Vector3;
const ORANGE = [1.0, 0.36, 0.08], RED = [1.0, 0.13, 0.05], GOLD = [1.0, 0.72, 0.3];
const LILAC = [0.62, 0.66, 1.0], VAPOUR = [0.5, 0.72, 1.0];

export function createSkyFx(K) {
  const { lines, glows, ctx } = K;
  const { CUES: c } = ctx;
  const _p = new V(), _q = new V(), _s = new V();
  const a = new V(), b = new V(), o = new V();

  const visibleChain = (x) => { for (let n = x; n; n = n.parent) if (!n.visible) return false; return true; };

  // Our own arrow, for the shots no department carries one in (s39 inside the falling beast).
  let own = null;
  K.ready = import('./arrow.js').then((m) => {
    own = m.makeArrow(ctx, { heat: 1 });
    own.visible = false; own.setHeat?.(1);
    ctx.scene.add(own);
  }).catch(() => {});
  K.hideOwn = () => { if (own) own.visible = false; };
  K.ownArrow = (tail, tip, thin = 1) => {
    if (!own) return;
    const d = _s.subVectors(tip, tail), L = d.length();
    d.divideScalar(L);
    own.quaternion.setFromUnitVectors(_q.set(0, 0, 1), d);
    own.scale.set(L * thin, L * thin, L);
    own.position.copy(tail);
    own.visible = true;
    own.updateMatrixWorld(true);
  };

  const pose = { tip: new V(), tail: new V(), dir: new V(), len: 1, mid: new V(), side: new V(), up: new V(), real: false };

  // World / Underwater publish `arrow` (Object3D, tip along +Z, length 1 scaled by the caller)
  K.arrowPose = (fallK = 60) => {
    pose.real = false;
    for (const obj of [ctx.world?.arrow, ctx.under?.arrow, ctx.archer?.arrow]) {
      if (!obj || !obj.isObject3D || !visibleChain(obj)) continue;
      obj.updateWorldMatrix(true, false);
      const e = obj.matrixWorld.elements;
      pose.dir.set(e[8], e[9], e[10]);
      const sc = pose.dir.length();
      if (sc < 1e-4) continue;
      pose.dir.divideScalar(sc);
      _p.set(e[12], e[13], e[14]);
      pose.len = sc;
      // arrow.js: nock at the origin, tip at z = 1; the Underwater stand-in is centred
      const centred = obj.name !== 'arrow';
      pose.tip.copy(_p).addScaledVector(pose.dir, sc * (centred ? 0.5 : 1));
      pose.tail.copy(_p).addScaledVector(pose.dir, sc * (centred ? -0.5 : 0));
      pose.real = true;
      break;
    }
    if (!pose.real) {
      pose.dir.copy(K.R).multiplyScalar(-1).addScaledVector(K.Fw, 0.08).normalize();
      pose.tip.copy(K.camera.position).addScaledVector(K.Fw, fallK).addScaledVector(K.R, -fallK * 0.18);
      pose.len = fallK * 0.8;
      pose.tail.copy(pose.tip).addScaledVector(pose.dir, -pose.len);
    }
    pose.mid.lerpVectors(pose.tip, pose.tail, 0.5);
    pose.side.crossVectors(pose.dir, K.Fw);
    if (pose.side.lengthSq() < 1e-4) pose.side.copy(K.R);
    pose.side.normalize();
    pose.up.crossVectors(pose.side, pose.dir).normalize();
    return pose;
  };

  // ------------------------------------------------------------ frame-space drawing
  const D = 900;      // every art-directed stroke sits on this plane, depth test off

  function spline(keys, n) {
    const out = [], m = keys.length - 1;
    for (let i = 0; i < n; i++) {
      const u = (i / (n - 1)) * m, j = Math.min(Math.floor(u), m - 1), f = u - j;
      const p0 = keys[Math.max(j - 1, 0)], p1 = keys[j], p2 = keys[j + 1], p3 = keys[Math.min(j + 2, m)];
      const cr = (q) => 0.5 * (2 * p1[q] + (p2[q] - p0[q]) * f + (2 * p0[q] - 5 * p1[q] + 4 * p2[q] - p3[q]) * f * f + (3 * p1[q] - p0[q] - 3 * p2[q] + p3[q]) * f * f * f);
      out.push([cr(0), cr(1)]);
    }
    return out;
  }
  const mixKeys = (A, B, k) => A.map((p, i) => [lerp(p[0], B[i][0], k), lerp(p[1], B[i][1], k)]);
  // keys: list of poses of a stroke; u 0..1 runs through them
  const keyAt = (poses, u) => {
    const m = poses.length - 1, x = clamp(u) * m, j = Math.min(Math.floor(x), m - 1);
    return mixKeys(poses[j], poses[j + 1], x - j);
  };

  // A rope of vapour: halo, hard body, white core, and a couple of fine strands peeling off.
  function rope(keys, seed, op = {}) {
    const n = op.n ?? 64, wid = op.w ?? 1, dn = K.dn, wob = op.wob ?? 0.006;
    const p0 = hash(dn, seed) * 6.283, p1 = hash(dn, seed + 1) * 6.283;
    const path = spline(keys, n).map(([x, y], i) => {
      const s = i / (n - 1);
      return [x + wob * Math.sin(s * 31 + p0) * s, y + wob * 1.8 * Math.sin(s * 23 + p1) * s];
    });
    const pts = path.map(([x, y]) => K.fp(x, y, D));
    const fade = op.fade ?? 1;
    const taper = op.taper ?? ((s) => Math.pow(Math.sin(Math.min(1, s * 1.02) * Math.PI), 0.55));
    const lump = (s) => taper(s) * (0.62 + 0.38 * Math.sin(s * 17 + seed + p0 * 0.25));
    const lump2 = (s) => taper(s) * (0.6 + 0.4 * Math.sin(s * 11 + seed * 3 + p1 * 0.25));
    lines.push(pts, { px: 24 * wid, color: [0.3, 0.5, 0.98], hot: [0.56, 0.72, 1], power: 0.5 * fade, soft: 64 * wid, mode: 2, rim: 0, width: lump2 });
    lines.push(pts, { px: 11 * wid, color: [0.62, 0.78, 1], hot: [0.86, 0.93, 1], power: 0.95 * fade, soft: 26, mode: 2, rim: 0, width: lump });
    lines.push(pts, { px: 4.2 * wid, color: VAPOUR, hot: [1, 1, 1], power: 1.5 * fade, soft: 10, mode: 2, rim: 0, width: (s) => lump(s) * lump2(s) * 1.5 });
    for (let j = 0; j < (op.strands ?? 3); j++) {
      const off = (hash(dn, seed, j + 3) - 0.5) * 0.03 * wid, ph = hash(seed, j) * 6.283;
      const q = path.map(([x, y], i) => {
        const s = i / (n - 1);
        return K.fp(x + off * Math.sin(s * 9 + ph), y + off * 1.8 * Math.cos(s * 7 + ph), D);
      });
      lines.push(q, { px: 1.5, color: VAPOUR, hot: [1, 1, 1], power: 1.15 * fade, soft: 6, mode: 2, rim: 0, width: (s) => Math.sin(s * Math.PI) });
    }
  }

  // A small closed curl of smoke rope, r in frame widths.
  function curl(cx, cy, r, seed, op = {}) {
    const n = 40, dn = op.dn ?? K.d3, turns = op.turns ?? 1.25;
    const ph = hash(dn, seed) * 6.283;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1), an = ph + s * turns * 6.283;
      const rr = r * (0.62 + 0.38 * Math.sin(s * 9 + ph)) * (0.8 + 0.25 * Math.sin(an * 3 + seed));
      pts.push(K.fp(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr * 1.846 * (op.squash ?? 1), D));
    }
    const w = (s) => Math.sin(s * Math.PI) * (0.6 + 0.4 * Math.sin(s * 13 + seed));
    lines.push(pts, { px: (op.px ?? 3) * 2.6, color: [0.32, 0.55, 1], hot: [0.65, 0.8, 1], power: 0.5 * (op.fade ?? 1), soft: 22, mode: 2, rim: 0, width: w });
    lines.push(pts, { px: op.px ?? 3, color: VAPOUR, hot: [1, 1, 1], power: 1.5 * (op.fade ?? 1), soft: 9, mode: 2, rim: 0, width: w });
  }

  // Jagged line in frame space
  function frameBolt(p0, p1, seed, op = {}) {
    a.set(p0[0], p0[1], 0); b.set(p1[0], p1[1], 0);
    const pa = K.fp(p0[0], p0[1], D), pb = K.fp(p1[0], p1[1], D);
    const pts = boltPts(pa, pb, seed, K.R, K.U, op.rough ?? 0.07, op.lv ?? 5);
    lines.push(pts, { px: op.px ?? 1.8, color: op.color ?? [0.5, 0.75, 1], power: op.power ?? 1.7, soft: op.soft ?? 12, mode: 2, rim: op.rim ?? 0.4, width: op.width ?? ((s) => 0.5 + 0.5 * Math.sin(s * Math.PI)) });
    return pts;
  }

  // Beam of light in frame space, from p0 along unit e (frame units, x-corrected), wandering.
  function strand(p0, e, L, seed, op = {}) {
    const n = op.n ?? 26, ph = hash(seed, 3) * 6.283 + (op.anim ?? 0);
    const nx = -e[1], ny = e[0];
    const pts = [];
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1);
      const w = (op.wander ?? 0.012) * s * (Math.sin(s * 7 + ph) + 0.5 * Math.sin(s * 15 + ph * 2));
      const off = (op.off ?? 0) * (0.3 + 0.7 * Math.min(1, s * 3));
      pts.push(K.fp(p0[0] + e[0] * L * s + nx * (off + w), p0[1] + (e[1] * L * s + ny * (off + w)) * 1.846, D));
    }
    lines.push(pts, { mode: 2, rim: 0, ...op });
    return pts;
  }

  // ---------------------------------------------------------------- speed lines
  function speedLines(P, n, rad, L, rate, seed, op = {}) {
    const t = K.t;
    for (let i = 0; i < n; i++) {
      const ang = hash(i, seed) * 6.283, r = rad * (0.25 + 0.75 * Math.sqrt(hash(i, seed + 1)));
      const ph = (hash(i, seed + 2) + t * rate * (0.6 + 0.8 * hash(i, seed + 3))) % 1;
      const z = L * (0.6 - ph * 1.6), ln = L * (0.1 + 0.3 * hash(i, seed + 4));
      a.copy(P.tip).addScaledVector(P.side, Math.cos(ang) * r).addScaledVector(P.up, Math.sin(ang) * r).addScaledVector(P.dir, z);
      b.copy(a).addScaledVector(P.dir, -ln);
      lines.push([a.clone(), b.clone()], { px: op.px ?? 0.8, color: op.color ?? [0.8, 0.92, 1], power: (op.power ?? 0.55) * (0.5 + 0.5 * hash(i, seed + 5)), soft: 2, mode: 2, rim: 0, width: (s) => Math.sin(s * Math.PI) });
    }
  }

  // ---------------------------------------------------------------- s11
  // The head parts the thin air: vapour peeling off the barbs, a shock cone, and the first
  // heat on the head near the end (ref s11b). The arrow itself stays clean and readable.
  function s11(st) {
    const P = K.arrowPose(90);
    const lt = st.lt;
    const hd = P.len * 0.17;
    const heat = smooth(invLerp(1.6, 2.9, lt));
    const L = P.len * 0.62;
    const wing = hd * 0.2;
    // barb vapour: thin, running back along the shaft and out of frame
    for (const sg of [-1, 1]) {
      a.copy(P.tip).addScaledVector(P.dir, -hd * 0.92).addScaledVector(P.up, sg * wing);
      const pts = [];
      for (let i = 0; i < 26; i++) {
        const s = i / 25;
        pts.push(new V().copy(a).addScaledVector(P.dir, -L * s).addScaledVector(P.up, sg * wing * 0.5 * s + Math.sin(s * 14 + sg + K.d3 * 0.8) * wing * 0.05 * s));
      }
      lines.push(pts, { px: 1.5, color: [0.7, 0.87, 1], power: 1, soft: 10, mode: 2, rim: 0, width: (s) => Math.min(1, s * 14) * (1 - s * 0.6), alpha: (s) => (1 - s * s) * Math.min(1, s * 18) });
      a.copy(P.tip).addScaledVector(P.dir, -hd * 0.42).addScaledVector(P.up, sg * wing * 0.48);
      const q = [];
      for (let i = 0; i < 14; i++) { const s = i / 13; q.push(new V().copy(a).addScaledVector(P.dir, -hd * 2.2 * s).addScaledVector(P.up, sg * wing * 0.9 * s)); }
      lines.push(q, { px: 1, color: [0.75, 0.9, 1], power: 0.7, soft: 5, mode: 2, rim: 0, width: (s) => Math.min(1, s * 10) * (1 - s), alpha: (s) => 1 - s });
    }
    // broad soft wake along the shaft
    a.copy(P.tip).addScaledVector(P.dir, -hd * 1.15);
    b.copy(a).addScaledVector(P.dir, -L);
    lines.push([a.clone(), b.clone()], { m: hd * 0.05, px: 1, color: [0.55, 0.78, 1], hot: [0.92, 0.97, 1], power: 0.5, soft: 34, mode: 2, rim: 0, width: (s) => 0.2 + 1.2 * s, alpha: (s) => Math.min(1, s * 6) * (1 - s) });
    // a thin shock cone from the tip
    for (const sg of [-1, 1]) {
      a.copy(P.tip).addScaledVector(P.dir, hd * 0.02);
      b.copy(P.tip).addScaledVector(P.dir, -hd * 1.0).addScaledVector(P.up, sg * hd * 0.3);
      lines.push([a.clone(), b.clone()], { px: 1, color: [0.85, 0.95, 1], power: 0.55, soft: 4, mode: 2, rim: 0, width: (s) => 1 - s, alpha: (s) => 1 - s });
    }
    speedLines(P, 46, P.len * 0.16, P.len * 0.5, 2.6, 301, { power: 0.6, px: 1 });
    // energy still running the shaft, thinning with the climb
    const k = 1 - smooth(invLerp(0.6, 2.4, lt)) * 0.85;
    a.copy(P.tip).addScaledVector(P.dir, -hd * 1.1);
    b.copy(a).addScaledVector(P.dir, -P.len * 0.5);
    for (let i = 0; i < 3; i++) {
      const u0 = hash(K.d3, i, 311) * 0.7, u1 = u0 + 0.12 + 0.2 * hash(K.d3, i, 312);
      lines.push(boltPts(_p.lerpVectors(a, b, u0).clone(), _q.lerpVectors(a, b, u1).clone(), hash(K.d3, i, 313) * 1e4, K.R, K.U, 0.016, 4), { px: 1.1, color: CYAN, power: 1.4 * k, soft: 8, mode: 2, rim: 0.3 });
    }
    // the heat spark waking on the head (ref s11b)
    if (heat > 0) {
      a.copy(P.tip).addScaledVector(P.dir, -hd * 0.72);
      glows.push(a, { kind: KIND.soft, m: hd * 0.22, color: ORANGE, power: 1.2 * heat, mode: 2 });
      glows.push(a, { kind: KIND.kira, m: hd * 0.34, color: GOLD, power: 0.9 * heat, rot: 0.05, mode: 2 });
    }
  }

  // ---------------------------------------------------------------- s12
  // The head glows, and the first smoke curls hang round the shaft behind it (ref s12b).
  function headGlow(P, f, power = 1) {
    if (K.depth(P.tip) < 2) return;
    a.copy(P.tip).addScaledVector(P.dir, -Math.min(P.len * 0.03, 60));
    glows.push(a, { kind: KIND.soft, m: 10, px: 8, color: ORANGE, power: 0.8 * f * power, mode: 2 });
    glows.push(a, { kind: KIND.soft, m: 3.5, px: 3, color: [1, 0.85, 0.6], power: 1.1 * f * power, mode: 2 });
    glows.push(a, { kind: KIND.kira, m: 14, px: 12, color: GOLD, power: 0.7 * f * power, rot: 0.1, mode: 2 });
  }
  function s12(st) {
    const P = K.arrowPose(400);
    const f = 0.8 + 0.3 * hash(K.dn, 5);
    headGlow(P, f);
    const k = smooth(invLerp(0.3, 0.95, st.lt));
    if (k <= 0 || K.depth(P.tip) < 8) return;
    const d = K.depth(P.tip);
    const q = K.frame(a.copy(P.tip).addScaledVector(P.dir, -Math.min(P.len * 0.045, 80)));
    const r = (14 / (2 * 0.74 * d)) * k;
    for (let i = 0; i < 4; i++) {
      curl(q[0] + (i - 1.5) * r * 0.7 + r * 0.6, q[1] + (hash(i, 7) - 0.5) * r * 1.5, r * (0.75 + 0.4 * hash(i, 8)), 700 + i, { px: 1.5 + 1.1 * k, fade: 0.8 * k });
    }
  }

  // ---------------------------------------------------------------- s13
  // Hand-keyed from the reference: a sonic shock that throws vortex ropes back along the
  // arrow. Three poses per stroke, frame coordinates. On twos.
  const ROPE_A = [
    [[-0.08, 0.34], [0.18, 0.37], [0.33, 0.44], [0.45, 0.34], [0.54, 0.29], [0.585, 0.25], [0.595, 0.38], [0.63, 0.43], [0.7, 0.47], [0.78, 0.47]],
    [[-0.08, 0.12], [0.1, 0.03], [0.24, 0.05], [0.36, 0.2], [0.46, 0.38], [0.56, 0.41], [0.64, 0.44], [0.7, 0.46], [0.76, 0.46], [0.79, 0.47]],
    [[-0.08, 0.3], [0.12, 0.22], [0.28, 0.26], [0.38, 0.37], [0.5, 0.35], [0.58, 0.29], [0.63, 0.3], [0.65, 0.4], [0.66, 0.47], [0.67, 0.5]],
  ];
  const ROPE_B = [
    [[-0.08, 0.92], [0.08, 0.78], [0.22, 0.73], [0.36, 0.62], [0.47, 0.53], [0.58, 0.47], [0.68, 0.49]],
    [[-0.08, 1.0], [0.1, 0.86], [0.25, 0.76], [0.38, 0.64], [0.5, 0.56], [0.6, 0.5], [0.68, 0.49]],
    [[-0.08, 0.84], [0.1, 0.74], [0.28, 0.68], [0.42, 0.62], [0.52, 0.57], [0.6, 0.53], [0.66, 0.5]],
  ];
  const ROPE_C = [
    [[-0.08, 0.5], [0.1, 0.45], [0.26, 0.47], [0.42, 0.5], [0.56, 0.5], [0.66, 0.49]],
    [[-0.08, 0.4], [0.1, 0.36], [0.26, 0.42], [0.42, 0.49], [0.56, 0.5], [0.66, 0.5]],
    [[-0.08, 0.46], [0.12, 0.45], [0.3, 0.5], [0.46, 0.52], [0.58, 0.51], [0.66, 0.5]],
  ];
  const ROPE_D = [
    [[0.05, 1.04], [0.2, 0.9], [0.36, 0.8], [0.5, 0.66], [0.6, 0.62], [0.68, 0.56], [0.7, 0.5]],
    [[0.12, 1.04], [0.3, 0.98], [0.44, 0.84], [0.54, 0.74], [0.62, 0.66], [0.68, 0.58], [0.7, 0.51]],
    [[0.2, 1.04], [0.36, 0.96], [0.5, 0.86], [0.6, 0.74], [0.64, 0.64], [0.66, 0.56], [0.67, 0.5]],
  ];
  function s13(st) {
    const P = K.arrowPose(400);
    const lt = onTwos(st.lt), d = st.dur;
    const u = clamp(lt / (d - 0.05));
    const n = st.frame - Math.round(st.cues.sonicFlash * 24);
    if (n === 0) K.flash(0.1, 0.17, 0.32);
    else if (n === 1) K.flash(0.05, 0.09, 0.18);
    const late = smooth(invLerp(0.68, 1, u));
    // veils of light filling the left of the frame
    const veil = (1 - late * 0.55) * smooth(invLerp(0, 0.15, u) + 0.4);
    glows.push(K.fp(0.14, 0.42 - 0.22 * Math.sin(u * 3.1), D), { kind: KIND.soft, px: 620, aspect: 1.3, color: [0.46, 0.66, 1], power: 0.42 * veil, mode: 2 });
    glows.push(K.fp(0.2, 0.74, D), { kind: KIND.soft, px: 520, aspect: 1.5, color: [0.55, 0.74, 1], power: 0.42 * veil, mode: 2 });
    glows.push(K.fp(0.44, 0.5, D), { kind: KIND.streak, px: 26, aspect: 22, color: [0.5, 0.72, 1], power: 0.8 * (1 - late), mode: 2 });
    // the plasma the head left behind, a red bar on the left (ref 21.09)
    a.set(0, 0, 0);
    strand([-0.04, 0.5], [1, 0.02], 0.46, 41, { px: 12, color: [1, 0.3, 0.2], hot: [1, 0.62, 0.5], power: 0.72 * (1 - late), soft: 34, width: (s) => (1 - s) * (1 - s), wander: 0.002 });
    // the ropes
    const fade = 1 - smooth(invLerp(0.8, 1.05, u)) * 0.55;
    rope(keyAt(ROPE_A, u), 910, { w: 1.5, fade, wob: 0.008 });
    rope(keyAt(ROPE_B, u), 920, { w: 2.1, fade, wob: 0.012 });
    rope(keyAt(ROPE_C, u), 930, { w: 1.1, fade, wob: 0.005, strands: 2 });
    rope(keyAt(ROPE_D, u), 940, { w: 0.9, fade, wob: 0.008, strands: 2 });
    // smoke curls knotted round the shaft near its far end, a ring opening over it late
    const kx = lerp(0.74, 0.66, u);
    for (let i = 0; i < 4; i++) {
      curl(kx + i * 0.022 - 0.03, 0.47 + 0.03 * Math.sin(i * 2.1) + (i - 1.5) * 0.012, 0.02 + 0.008 * i, 950 + i, { px: 3.2, fade: fade, turns: 1.1, dn: K.dn });
    }
    const ringK = smooth(invLerp(0.45, 0.8, u));
    if (ringK > 0) {
      const pts = [];
      const rr = 0.066, cx = 0.565 + 0.02 * u, cy = 0.5 - 0.02 * u;
      for (let i = 0; i < 36; i++) {
        const an = 0.7 + (i / 35) * 5.0, wob = 1 + 0.12 * Math.sin(an * 5 + K.d3);
        pts.push(K.fp(cx + Math.cos(an) * rr * wob, cy + Math.sin(an) * rr * wob * 1.846, D));
      }
      lines.push(pts, { px: 3, color: VAPOUR, hot: [1, 1, 1], power: 1.5 * ringK, soft: 16, mode: 2, rim: 0, width: (s) => Math.sin(s * Math.PI) });
    }
    // the shock racing along the limb, both ways from the point under the arrow
    const front = easeOut(clamp(lt / d), 2);
    const f = 0.9 + 0.2 * hash(K.dn, 6);
    const limb = K.limb ?? ((x) => 0.44 + 0.46 * (x - 0.46) * (x - 0.46));
    for (const sg of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const x = 0.62 + sg * (0.02 + 0.85 * front) * (i / 24);
        pts.push(K.fp(x, limb(x), D));
      }
      lines.push(pts, { px: 4.5 * (1 - u * 0.5), color: [0.3, 0.6, 1], hot: [0.9, 0.97, 1], power: 1.5 * f * (1 - u * 0.6), soft: 40, mode: 2, rim: 0, width: (s) => 1 - s * s });
    }
    // the tip has passed the lens: the shaft is the dark needle World draws; a last glint on it
    void P; void BLUE;
  }

  // ---------------------------------------------------------------- s26
  // The head comes at us; two rays of fire run back along the shaft over the lens, lightning
  // tears off the lower barb, and the air below it burns white.
  function s26(st) {
    const P = K.arrowPose(120);
    const k = smooth(invLerp(-0.1, 0.25, st.lt));
    const fl = 0.86 + 0.28 * hash(K.dn, 8);
    const hd = P.len * 0.17;
    const root = K.frame(o.copy(P.tip).addScaledVector(P.dir, -hd * 0.55));
    const rg = [root[0], root[1]];
    // head glow
    o.copy(P.tip).addScaledVector(P.dir, -hd * 0.42);
    glows.push(o, { kind: KIND.soft, px: 90, color: [1, 0.4, 0.15], power: 0.7 * k * fl, mode: 2 });
    glows.push(o, { kind: KIND.soft, px: 26, color: [1, 0.8, 0.5], power: 1.1 * k * fl, mode: 2 });
    glows.push(o, { kind: KIND.kira, px: 80, color: GOLD, power: 0.55 * k * fl, rot: 0.25, mode: 2 });
    K.light(o, hd * 1.6, ORANGE, 3.2 * k);
    // the two great rays. Aim from the projected shaft so they stay on World's arrow
    const shaftE = K.frame(_p.copy(P.tip).addScaledVector(P.dir, -Math.min(hd * 2.4, K.depth(P.tip) * 0.7)));
    let ex = shaftE[0] - rg[0], ey = (shaftE[1] - rg[1]) / 1.846;
    const el = Math.max(Math.hypot(ex, ey), 1e-4); ex /= el; ey /= el;
    const rot = (dx) => [ex * Math.cos(dx) - ey * Math.sin(dx), ex * Math.sin(dx) + ey * Math.cos(dx)];
    const rows = [
      { da: -0.2, c0: [1, 0.86, 0.6], c1: [1, 0.52, 0.2], w: 8, p: 1.55 },
      { da: 0.12, c0: [1, 0.46, 0.24], c1: [1, 0.2, 0.12], w: 6.5, p: 1.6 },
    ];
    rows.forEach((row, i) => {
      const e = rot(row.da);
      strand(rg, e, 1.05, 960 + i, {
        px: row.w, color: (s, out) => { out[0] = lerp(row.c0[0], row.c1[0], s); out[1] = lerp(row.c0[1], row.c1[1], s); out[2] = lerp(row.c0[2], row.c1[2], s); },
        hot: [1, 0.95, 0.82], power: row.p * k * fl, soft: 26, wander: 0.0018, width: (s) => (0.25 + 1.5 * Math.min(1, s * 2.2)) * (1 - 0.25 * s), alpha: (s) => Math.min(1, s * 12 + 0.2),
      });
    });
    // a thin red ghost above (ref 53.5)
    strand(rg, rot(-0.62), 0.8, 963, { px: 5, color: [1, 0.25, 0.2], hot: [1, 0.4, 0.32], power: 0.5 * k, soft: 30, wander: 0.002, width: (s) => Math.min(1, s * 2) * (1 - s), alpha: (s) => Math.min(1, s * 3) });
    // the burn below: a broad white-blue sheet, then the lightning that tears along it
    const e3 = rot(0.46);
    const anim = K.d3 * 2.1;
    strand(rg, e3, 0.95, 964, { px: 26, color: [0.45, 0.66, 1], hot: [0.8, 0.88, 1], power: 0.34 * k, soft: 110, wander: 0.012, anim: K.d3 * 0.3, width: (s) => Math.min(1, s * 2.4) * (1.1 - 0.5 * s), alpha: (s) => Math.min(1, s * 4) * (1 - s * 0.5) });
    strand(rg, e3, 0.95, 965, { n: 34, px: 4.5, color: [0.5, 0.74, 1], hot: [1, 1, 1], power: 1.8 * k, soft: 22, wander: 0.05, anim, width: (s) => (0.4 + 0.9 * Math.min(1, s * 3)) * (1 - 0.3 * s), alpha: (s) => Math.min(1, s * 16) });
    for (let i = 0; i < 4; i++) {
      const s0 = 0.15 + 0.7 * hash(K.d3, i, 966);
      const p0 = [rg[0] + e3[0] * s0 * 0.95, rg[1] + e3[1] * s0 * 0.95 * 1.846];
      const p1 = [p0[0] + 0.1 + 0.08 * hash(K.d3, i, 967), p0[1] + (hash(K.d3, i, 968) - 0.3) * 0.16];
      frameBolt(p0, p1, hash(K.d3, i, 969) * 1e4, { px: 1.5, rough: 0.14, power: 1.6 * k, rim: 0.2, color: [0.5, 0.78, 1], soft: 8, width: (s) => 1 - 0.8 * s });
    }
    speedLines(P, 22, hd * 2.2, hd * 5, 3.2, 331, { power: 0.45 });
  }

  // ---------------------------------------------------------------- s28
  // One long receding comet (no cut): hot fire round the ferrule, the head dark ahead of it,
  // a twin white beam wound with lightning running back up the frame.
  function s28(st) {
    const P = K.arrowPose(160);
    const lt = st.lt;
    const fl = 0.84 + 0.32 * hash(K.dn, 8);
    const hd = P.len * 0.17;
    const dTip = K.depth(P.tip);
    // scale: how big the head reads on screen, frame widths
    const headW = hd / K.W(P.tip);
    const sc = clamp(headW / 0.42, 0.12, 1.1);
    // the ferrule, behind the blades
    const hot = o.copy(P.tip).addScaledVector(P.dir, -hd * 1.06).clone();
    const hot2 = _p.copy(P.tip).addScaledVector(P.dir, -hd * 1.62).clone();
    const f0 = K.frame(hot), f1 = K.frame(hot2);
    let ex = f1[0] - f0[0], ey = (f1[1] - f0[1]) / 1.846;
    const el = Math.max(Math.hypot(ex, ey), 1e-4); ex /= el; ey /= el;
    const nx = -ey, ny = ex;
    const q0 = [f0[0] + ex * Math.min(el * 0.42, 0.13 * sc), f0[1] + ey * Math.min(el * 0.42, 0.13 * sc) * 1.846];
    // glow
    glows.push(hot, { kind: KIND.soft, px: 300 * sc + 40, aspect: 1.3, color: [1, 0.3, 0.1], power: 1.0 * fl, mode: 2, rot: Math.atan2(-ey, ex) });
    glows.push(hot, { kind: KIND.soft, px: 90 * sc + 16, aspect: 1.6, color: [1, 0.5, 0.2], power: 0.9 * fl, mode: 2, rot: Math.atan2(-ey, ex) });
    K.light(hot, hd * 1.4, ORANGE, 3 * fl);
    // tongues of fire streaming off the ferrule, on twos
    for (let i = 0; i < 9; i++) {
      const j = hash(K.dn, i, 880);
      const off = ((i - 4) / 4) * 0.046 * sc;
      const st0 = [f0[0] - ex * 0.06 * sc * (0.3 + j) + nx * off * 0.8, f0[1] - (ey * 0.06 * sc * (0.3 + j) - ny * off * 0.8) * 1.846];
      strand(st0, [ex + nx * off * 0.8, ey + ny * off * 0.8], (0.1 + 0.1 * hash(K.dn, i, 881)) * sc * 1.2, 881 + i, {
        n: 10, px: 6.5 * sc + 1.2, wander: 0.004 * sc,
        color: (s, out) => { out[0] = 1; out[1] = lerp(0.46, 0.1, s); out[2] = lerp(0.14, 0.04, s); },
        hot: [1, 0.74, 0.42], power: 1.5 * fl, soft: 14 * sc + 3, width: (s) => (1 - s) * Math.min(1, s * 8 + 0.3), alpha: (s) => 1 - s * s,
      });
    }
    // the beam: two strands that leave the fire together and part, red between them
    const L = 1.3;
    const beamK = smooth(invLerp(-0.05, 0.6, lt)) * 0.45 + 0.55;
    const wP = 34 * sc + 2.4;
    strand(q0, [ex, ey], L, 890, { px: wP * 0.8, color: [1, 0.34, 0.5], hot: [1, 0.62, 0.72], power: 0.95 * fl, soft: 34 * sc + 8, wander: 0.002, width: (s) => Math.min(1, s * 7) * (1 - 0.3 * s) });
    for (const sg of [-1, 1]) {
      const anim = sg * (K.d3 % 5) * 0.14;
      strand(q0, [ex, ey], L, 891 + sg, {
        off: sg * 0.0115 * (0.3 + sc), px: wP * beamK * 0.42, color: LILAC, hot: [1, 0.98, 1], power: 1.8, soft: 22 * sc + 7, wander: 0.004 * sc + 0.002, anim,
        width: (s) => Math.min(1, s * 9 + 0.4) * (1 - 0.3 * s), alpha: (s) => Math.min(1, s * 20 + 0.15),
      });
    }
    // lightning winding round the beam, stronger once the sky goes dark (ref 58.85+)
    const lk = smooth(invLerp(0.45, 1.05, lt));
    const nB = 3 + Math.floor(5 * lk);
    for (let i = 0; i < nB; i++) {
      const s0 = 0.04 + 0.6 * hash(K.d3, i, 893), s1 = s0 + 0.14 + 0.24 * hash(K.d3, i, 894);
      const off0 = (hash(K.d3, i, 895) - 0.5) * 0.026, off1 = (hash(K.d3, i, 896) - 0.5) * 0.05;
      const p0 = [q0[0] + ex * s0 * L + nx * off0, q0[1] + (ey * s0 * L + ny * off0) * 1.846];
      const p1 = [q0[0] + ex * s1 * L + nx * off1, q0[1] + (ey * s1 * L + ny * off1) * 1.846];
      const pts = frameBolt(p0, p1, hash(K.d3, i, 897) * 1e4, { px: 1.2 + 0.6 * lk, rough: 0.11, power: 1.8, rim: 0.5, color: [0.55, 0.72, 1], soft: 9 });
      if (i < 3) {
        const m = pts[Math.floor(pts.length * (0.3 + 0.4 * hash(K.d3, i, 898)))];
        const en = K.frame(m);
        frameBolt(en, [en[0] + 0.05 + 0.07 * hash(K.d3, i, 899), en[1] + (hash(K.d3, i, 900) - 0.5) * 0.14], hash(K.d3, i, 901) * 1e4, { px: 1, rough: 0.2, power: 1.4, rim: 0.4, color: [0.55, 0.72, 1], soft: 5, width: (s) => 1 - 0.8 * s });
      }
    }
    speedLines(P, 18, hd * 0.8, hd * 2.2, 3.6, 341, { power: 0.5 * smooth(invLerp(0.8, 0.3, lt)) });
    void dTip;
  }

  // ---------------------------------------------------------------- s30
  // Same point Water raises its plume on (it updates after us, so compute it, don't read it).
  const impact = new V();
  function impactPoint(st) {
    const cm = st.cam;
    _q.set(cm.look[0] - cm.pos[0], 0, cm.look[2] - cm.pos[2]).normalize();
    return impact.set(cm.pos[0] + _q.x * 2600, 0, cm.pos[2] + _q.z * 2600);
  }
  function s30(st) {
    const t = K.t, r = t - c.impact;
    const I = impactPoint(st);
    const up = _p.copy(K.R).multiplyScalar(0.5).add(_q.set(0, 1, 0)).normalize();
    const W = K.W(I);
    const L = W * 1.5;
    // the comet falls fast down the line, then the line hangs in the air and drifts
    const head = clamp(r / 0.13);
    const fade = Math.exp(-Math.max(0, r - 0.5) * 0.9);
    const hang = smooth(invLerp(0.1, 1.9, r));
    const n = 28, pts = [];
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1);                 // 0 sky .. 1 sea
      const y = 1 - s * head;
      const sag = Math.sin(y * Math.PI) * hang * W * 0.1 + Math.sin(y * 7 + 1) * hang * W * 0.012;
      pts.push(new V().copy(I).addScaledVector(up, L * y).addScaledVector(K.R, sag * 0.9).add(_s.set(0, -sag * 0.2, 0)));
    }
    if (r < 0.13) {
      lines.push(pts.slice(Math.floor(n * 0.5)), { px: 3.2, color: [0.55, 0.8, 1], hot: [1, 0.95, 0.9], power: 1.9, soft: 16, mode: 2, rim: 0.4, width: (s) => 0.2 + 0.8 * s });
      glows.push(pts[n - 1], { kind: KIND.soft, px: 26, color: ORANGE, power: 1.5, mode: 2 });
      glows.push(pts[n - 1], { kind: KIND.kira, px: 60, color: GOLD, power: 1.2, rot: 0.1, mode: 2 });
    }
    lines.push(pts, { px: 1.3, color: [0.55, 0.72, 1], hot: [0.97, 0.99, 1], power: 1.5 * fade, soft: 5, mode: 2, rim: 0.85, width: (s) => 0.55 + 0.45 * s });
    if (r >= 0 && r < 0.28) {
      const k = 1 - r / 0.28;
      glows.push(I, { kind: KIND.kira, px: 150, color: ICE, power: 1.3 * k, rot: 0.05, mode: 2 });
      glows.push(I, { kind: KIND.soft, px: 120, color: CYAN, power: 0.9 * k, mode: 2 });
    }
    const nf = st.frame - Math.round((c.impact + 0.13) * 24);
    if (nf === 0) K.flash(0.32, 0.42, 0.55);
    else if (nf === 1) K.flash(0.12, 0.18, 0.28);
  }

  void resample; void RED; void BLUE;
  return { s11, s12, s13, s26, s28, s30, _frameBolt: frameBolt, _strand: strand, _rope: rope };
}
