import * as THREE from 'three';
import { clamp, invLerp, smooth, easeOut, lerp } from './util.js';
import { KIND, hash, boltPts, crawlPts } from './fx-energy-core.js';
import { CYAN, ICE, BLUE } from './fx-energy-charge.js';
import { harpoonPose, newPose } from './tether-harpoon.js';

// s31–s39: the strike. One colossal flash that is over in half a second, a dome of light at
// the wound, a thin kinked bolt between belly and floor, then lightning hugging the exposed
// shaft at both wounds while the beast dies. Sizes are in frame widths (K.W), so the FX hold
// whatever lens Underwater uses; the plate is bright, so every bolt carries a dark rim.

const V = THREE.Vector3;

export function createUnderFx(K) {
  const { lines, glows, ctx } = K;
  const { CUES: c } = ctx;
  const a = new V(), b = new V(), o = new V(), _x = new V();
  const L = { head: new V(), back: new V(), belly: new V(), tail: new V(), clawL: new V(), clawR: new V(), floor: new V() };
  const HP = newPose();

  function grab() {
    const P = K.arrowPose?.(220);
    const f = _x.copy(K.camera.position).addScaledVector(K.Fw, 400);
    K.anchor('leviathan', 'back', L.back, f);
    K.anchor('leviathan', 'belly', L.belly, _x.copy(L.back).addScaledVector(K.U, -120));
    K.anchor('leviathan', 'head', L.head, _x.copy(L.back).addScaledVector(K.R, 300));
    K.anchor('leviathan', 'tail', L.tail, _x.copy(L.back).addScaledVector(K.R, -300));
    K.anchor('leviathan', 'clawL', L.clawL, L.belly);
    K.anchor('leviathan', 'clawR', L.clawR, L.belly);
    L.size = Math.max(L.head.distanceTo(L.tail), 60);
    // the mound under the belly, or a drop below it
    const m = ctx.under?.mound;
    if (m?.isVector3) L.floor.set(L.belly.x, Math.min(m.y, L.belly.y - 10), L.belly.z);
    else L.floor.copy(L.belly).add(_x.set(0, -L.size * 0.13, 0));
    return P;
  }

  // a bolt that hangs from a to b with branches
  function bolt(p0, p1, seed, opt = {}) {
    const R = K.R, U = K.U;
    const pts = boltPts(p0, p1, seed, R, U, opt.rough ?? 0.13, opt.lv ?? 5);
    const base = { px: opt.px ?? 2, color: opt.color ?? CYAN, power: opt.power ?? 1.8, soft: opt.soft ?? 12, mode: opt.mode ?? 2, bias: opt.bias ?? 40, rim: opt.rim ?? 0.75, width: opt.width ?? ((s) => 0.5 + 0.5 * Math.sin(s * Math.PI)) };
    lines.push(pts, base);
    const nb = opt.branches ?? 3, L0 = p0.distanceTo(p1);
    for (let i = 0; i < nb; i++) {
      const k = Math.floor((0.15 + 0.7 * hash(seed, i, 1)) * (pts.length - 1));
      const st = pts[k];
      const ang = hash(seed, i, 2) * 6.283;
      o.copy(R).multiplyScalar(Math.cos(ang)).addScaledVector(U, Math.sin(ang));
      const en = _x.copy(st).addScaledVector(o, L0 * (0.12 + 0.3 * hash(seed, i, 3))).lerp(p1, 0.2).clone();
      lines.push(boltPts(st, en, seed + i + 1, R, U, 0.2, 4), { ...base, px: base.px * 0.55, width: (s) => 1 - 0.8 * s });
    }
  }

  // lightning wound tight round a stretch of the shaft, p0 at the wound (ref s36, s37)
  function shaftArc(p0, p1, seed, opt = {}) {
    const n = opt.n ?? 3, Len = p0.distanceTo(p1);
    if (Len < 1) return;
    const rad = opt.rad ?? Len * 0.03;
    for (let i = 0; i < n; i++) {
      const u0 = hash(K.d3, i, seed) * 0.55, u1 = Math.min(1, u0 + 0.3 + 0.5 * hash(K.d3, i, seed + 1));
      const q0 = a.lerpVectors(p0, p1, u0).clone().addScaledVector(K.R, (hash(K.d3, i, seed + 2) - 0.5) * rad).addScaledVector(K.U, (hash(K.d3, i, seed + 3) - 0.5) * rad);
      const q1 = b.lerpVectors(p0, p1, u1).clone().addScaledVector(K.R, (hash(K.d3, i, seed + 4) - 0.5) * rad).addScaledVector(K.U, (hash(K.d3, i, seed + 5) - 0.5) * rad);
      const pts = boltPts(q0, q1, hash(K.d3, i, seed + 6) * 1e4, K.R, K.U, opt.rough ?? 0.1, 5);
      lines.push(pts, { px: opt.px ?? 2.1, color: CYAN, power: opt.power ?? 1.8, soft: opt.soft ?? 12, mode: 2, rim: 0.7, width: (s) => 0.45 + 0.55 * Math.sin(s * Math.PI) });
    }
    // the bare white line of the charged shaft
    lines.push([p0.clone(), p1.clone()], { px: opt.line ?? 1.6, color: ICE, power: (opt.power ?? 1.8) * 0.8, soft: 10, mode: 2, rim: 0, width: (s) => 1 - 0.75 * s, alpha: (s) => 1 - s * 0.8 });
  }

  // a star of light where the shaft enters skin, w in frame widths
  // mode 0 hides it when the body is in front of the point: it sits on skin, never over it
  function wound(p, w, power, seed, mode = 2) {
    const W = K.W(p);
    const fl = 0.84 + 0.32 * hash(K.dn, seed);
    const bias = W * 0.05;
    glows.push(p, { kind: KIND.soft, m: W * w * 2.0, color: BLUE, power: 0.8 * power * fl, mode, bias });
    glows.push(p, { kind: KIND.soft, m: W * w * 0.9, color: CYAN, power: 1.1 * power * fl, mode, bias });
    glows.push(p, { kind: KIND.burst, m: W * w * 0.7, color: CYAN, power: 1.1 * power * fl, seed: 0.13 + (K.d3 % 4) * 0.17, aspect: 1.25, mode, bias });
    glows.push(p, { kind: KIND.kira, m: W * w * 2.0, color: ICE, power: 0.9 * power * fl, rot: (K.dn % 3) * 0.06, mode, bias });
  }

  // arcs running along the body: masked to the leviathan's silhouette (mode 1)
  function bodyArcs(n, seed, maxD, opt = {}) {
    const R = K.R, U = K.U, dn = K.d3;
    for (let i = 0; i < n; i++) {
      const u = hash(dn, i, seed);
      const p = u < 0.5 ? a.lerpVectors(L.tail, L.back, u * 2) : a.lerpVectors(L.back, L.head, (u - 0.5) * 2);
      p.lerp(L.belly, hash(dn, i, seed + 1) * 0.8);
      o.copy(R).multiplyScalar(hash(dn, i, seed + 2) - 0.5).addScaledVector(U, (hash(dn, i, seed + 3) - 0.5) * 0.5).normalize();
      if (opt.crawl) {
        lines.push(crawlPts(p, o, hash(dn, i, seed + 4) * 1e4, R, U, L.size * (opt.len ?? 0.12) * (0.5 + hash(dn, i, seed + 5)), 10, 1.0),
          { px: opt.px ?? 1.5, color: CYAN, power: opt.power ?? 1.6, soft: opt.soft ?? 8, mode: 1, bias: maxD, rim: 0.5, width: (s) => 1 - 0.7 * s });
      } else {
        b.copy(p).addScaledVector(o, L.size * (opt.len ?? 0.25) * (0.5 + hash(dn, i, seed + 5)));
        lines.push(boltPts(p, b, hash(dn, i, seed + 6) * 1e4, R, U, 0.13, 5), { px: opt.px ?? 1.8, color: CYAN, power: opt.power ?? 1.7, soft: opt.soft ?? 10, mode: 1, bias: maxD, rim: 0.5, width: (s) => 1 - 0.65 * s });
      }
    }
  }

  // a lens of white light where the skin parts round the shaft, half-width in frame widths
  function lens(p, hw, power, rot = 0) {
    const pxW = hw * 1920;
    glows.push(p, { kind: KIND.streak, px: pxW * 0.07, aspect: 14, color: ICE, power: 1.5 * power, rot, mode: 2 });
    glows.push(p, { kind: KIND.soft, px: pxW * 0.55, aspect: 2.1, color: CYAN, power: 0.9 * power, rot, mode: 2 });
  }

  const shaftUp = (P, from, lenM) => (P.real ? a.copy(from).addScaledVector(P.dir, -lenM).clone() : a.copy(from).addScaledVector(K.U, lenM).clone());

  // ---------------------------------------------------------------- s31
  function s31(st) {
    const P = grab();
    const t = K.t, r = t - c.pierce;
    const entry = L.back;
    const W = K.W(entry);
    if (r < 0) {
      // the arrow arrives: a needle of light falling from the surface
      if (P.real && K.onScreen(P.tip, 0.5)) {
        const k = smooth(invLerp(-0.1, 0, r));
        glows.push(P.tip, { kind: KIND.kira, px: 70, color: ICE, power: 0.8 * k, mode: 2, rot: 0.1 });
      }
      return;
    }
    const n = st.frame - Math.round(c.pierce * 24);
    const fls = [[0.5, 0.65, 0.85], [1.2, 1.35, 1.55], [1.05, 1.2, 1.45], [0.8, 0.95, 1.25], [0.55, 0.7, 1.0], [0.36, 0.48, 0.74], [0.22, 0.31, 0.5], [0.13, 0.19, 0.32], [0.07, 0.1, 0.18]];
    if (n < fls.length) K.flash(...fls[n]);
    const peak = Math.exp(-r * 6.5);      // the flash itself, gone in half a second
    const dome = smooth(invLerp(0.08, 0.3, r)) * Math.exp(-Math.max(0, r - 0.45) * 4.5);
    const rest = 0.5 + 0.5 * Math.exp(-r * 0.9);
    const fl = 0.84 + 0.32 * hash(K.dn, 31);
    const dp = K.depth(entry), bmax = dp + L.size;
    // the great cross of light (ref 63.08)
    glows.push(entry, { kind: KIND.soft, m: W * 0.5, color: BLUE, power: 1.3 * peak * fl, mode: 2 });
    glows.push(entry, { kind: KIND.kira, m: W * (0.34 + 0.5 * peak), color: ICE, power: 1.2 * peak * fl, rot: 0, mode: 2 });
    // pillars of light: down the shaft from the surface, and up from the twin flash
    const up = shaftUp(P, entry, W * 0.8);
    const pillarK = 0.25 + 0.75 * Math.exp(-r * 1.6);
    lines.push([entry.clone(), up], { m: W * 0.012, px: 2.5, color: CYAN, hot: [0.9, 0.97, 1], power: 1.3 * pillarK, soft: 44, mode: 2, rim: 0, width: (s) => (1 - s * 0.6) * (0.4 + 0.6 * peak + 0.2 * (1 - s)), alpha: (s) => 1 - s });
    // the dome of churned light round the entry, shrinking to a hard little star (ref 63.4 → 63.7)
    if (dome > 0.01) {
      glows.push(entry, { kind: KIND.burst, m: W * (0.05 + 0.07 * dome), color: CYAN, power: 1.05 * dome * fl, seed: 0.13 + (K.d3 % 4) * 0.17, aspect: 1.5, mode: 2 });
      glows.push(entry, { kind: KIND.soft, m: W * 0.26, color: BLUE, power: 1.0 * dome * fl, mode: 2 });
    }
    wound(entry, 0.028 + 0.02 * rest, Math.min(1, r * 3) * rest, 311);
    // the twin flash on the floor
    glows.push(L.floor, { kind: KIND.soft, m: W * (0.09 + 0.15 * peak), color: CYAN, power: 1.25 * (0.3 + peak) * fl, mode: 0, bias: L.size });
    glows.push(L.floor, { kind: KIND.burst, m: W * (0.02 + 0.04 * peak), color: ICE, power: 1.2 * fl, seed: 0.51 + (K.d3 % 3) * 0.19, mode: 0, bias: L.size });
    a.copy(L.floor).lerp(L.belly, 0.5);
    glows.push(a, { kind: KIND.streak, m: W * 0.012, aspect: 1, color: ICE, power: 0, mode: 2 });
    // the kinked bolt between belly and floor
    if (n >= 2) {
      bolt(L.belly, L.floor, hash(K.d3, 3) * 1e4, { px: 2.6, rough: 0.14, branches: 2 });
      bolt(_x.copy(L.belly).addScaledVector(K.R, W * 0.008).clone(), b.copy(L.floor).addScaledVector(K.R, -W * 0.006).clone(), hash(K.d3, 5) * 1e4, { px: 1.6, rough: 0.2, branches: 2 });
    }
    // arcs over the body
    bodyArcs(4 + Math.floor(4 * Math.exp(-r)), 310, bmax, { px: 1.9, len: 0.16 });
    bodyArcs(6, 340, bmax, { crawl: true, px: 1.4, len: 0.09 });
    // hard cel light
    K.light(_x.copy(entry).addScaledVector(K.U, W * 0.05).clone(), W * 0.5, ICE, 1.4 + 4 * peak);
    K.light(L.floor, W * 0.22, CYAN, 0.9 + 3 * peak);
  }

  // ---------------------------------------------------------------- s32
  function s32(st) {
    grab();
    const W = K.W(L.belly);
    const fl = 0.8 + 0.4 * hash(K.dn, 32);
    glows.push(L.belly, { kind: KIND.soft, m: W * 0.06, color: CYAN, power: 1.1 * fl, mode: 0, bias: W * 0.2 });
    glows.push(L.floor, { kind: KIND.soft, m: W * 0.07, color: CYAN, power: 1.2 * fl, mode: 0, bias: W * 0.2 });
    glows.push(L.floor, { kind: KIND.burst, m: W * 0.018, color: ICE, power: 1.2 * fl, seed: 0.3 + (K.d3 % 3) * 0.2, mode: 2 });
    bolt(L.belly, L.floor, hash(K.d3, 4) * 1e4, { px: 2.7, rough: 0.16, branches: 3, mode: 0, bias: W * 0.05 });
    bolt(_x.copy(L.belly).addScaledVector(K.R, W * 0.012).clone(), b.copy(L.floor).addScaledVector(K.R, W * 0.02).clone(), hash(K.d3, 5) * 1e4, { px: 1.7, rough: 0.2, branches: 2, mode: 0, bias: W * 0.05 });
    bodyArcs(5, 350, K.depth(L.belly) + L.size * 0.5, { crawl: true, px: 1.6, len: 0.05 });
    K.light(_x.copy(L.belly).addScaledVector(K.U, -W * 0.05).clone(), W * 0.5, CYAN, 3.6 * fl);
  }

  // ---------------------------------------------------------------- s33, s34
  function s33(st) {
    grab();
    const W = K.W(L.belly);
    const fl = 0.8 + 0.4 * hash(K.dn, 33);
    glows.push(L.belly, { kind: KIND.soft, m: W * 0.06, color: CYAN, power: 1.0 * fl, mode: 2 });
    glows.push(L.belly, { kind: KIND.kira, m: W * 0.05, px: 30, color: ICE, power: 0.7 * fl, rot: 0.05, mode: 2 });
    bolt(L.belly, L.floor, hash(K.d3, 6) * 1e4, { px: 1.5, rough: 0.18, branches: 2 });
    K.light(L.belly, W * 0.4, CYAN, 2.4 * fl);
  }
  function s34(st) {
    grab();
    const W = K.W(L.belly);
    const fl = 0.8 + 0.4 * hash(K.dn, 34);
    glows.push(L.belly, { kind: KIND.soft, m: W * 0.05, color: CYAN, power: 1.1 * fl, mode: 2 });
    bolt(L.belly, L.floor, hash(K.d3, 7) * 1e4, { px: 2, rough: 0.16, branches: 2, mode: 0, bias: W * 0.05 });
    K.light(L.belly, W * 0.4, CYAN, 3.2 * fl);
  }

  // ---------------------------------------------------------------- s35
  // The belly fills the top of the frame. White light leaks along the skin either side of the
  // shaft; the tip stabs the rock, sparks crawl the barbs, a bolt climbs from rock to skin.
  function s35(st) {
    const P = grab();
    const t = K.t, r = t - c.tipOut;
    const fl = 0.84 + 0.32 * hash(K.dn, 35);
    const W = K.W(L.belly);
    const breach = smooth(invLerp(-0.06, 0.1, r));
    // the shaft crosses the skin at this height
    const wp = P.real ? a.set(P.tip.x, L.belly.y, P.tip.z).clone() : L.belly.clone();
    lens(wp, 0.15 * (0.5 + 0.5 * breach), (0.5 + 0.7 * breach) * fl);
    const n = st.frame - Math.round(c.tipOut * 24);
    if (n >= 0 && n < 3) K.flash(0.26 - n * 0.09, 0.36 - n * 0.11, 0.52 - n * 0.15);
    const tp = P.real ? P.tip : L.floor;
    glows.push(tp, { kind: KIND.soft, m: W * 0.05, color: CYAN, power: 0.8 * fl * breach, mode: 2 });
    glows.push(tp, { kind: KIND.kira, m: W * 0.05, px: 26, color: ICE, power: 0.9 * fl * breach, rot: 0.1, mode: 2 });
    for (let i = 0; i < 5; i++) {
      const ang = hash(K.d3, i, 36) * 3.14, rr = W * (0.025 + 0.06 * hash(K.d3, i, 37));
      b.copy(tp).addScaledVector(K.R, Math.cos(ang) * rr).addScaledVector(K.U, Math.sin(ang) * rr * 0.45);
      lines.push(boltPts(tp, b, hash(K.d3, i, 38) * 1e4, K.R, K.U, 0.22, 4), { px: 1.6, color: CYAN, power: 1.6 * breach, soft: 8, mode: 2, rim: 0.7, width: (s) => 1 - 0.8 * s });
    }
    // the bolt that climbs beside the shaft (ref 69.8)
    if (r > 0.25) {
      const off = W * 0.03;
      bolt(_x.copy(tp).addScaledVector(K.R, off).clone(), b.copy(wp).addScaledVector(K.R, off * 1.4).clone(), hash(K.d3, 39) * 1e4, { px: 2.4, rough: 0.1, branches: 2 });
    }
    K.light(tp, W * 0.3, ICE, 3 * fl * breach);
    K.light(wp, W * 0.35, ICE, 3.4 * fl);
  }

  // ---------------------------------------------------------------- s36
  // The rock bursts: a hard flash, then darkness of flying stone. When the beast is back in
  // frame it carries the shaft, lightning at both wounds (ref 71.5).
  function s36(st) {
    const P = grab();
    const t = K.t, r = t - c.rockBurst;
    const pt = K.onScreen(L.floor, 0.1) ? L.floor : (P.real ? P.tip : L.belly);
    const W = K.W(pt);
    const k = Math.exp(-Math.max(0, r) * 7);
    const fl = 0.84 + 0.32 * hash(K.dn, 36);
    const n = st.frame - Math.round(c.rockBurst * 24);
    if (n >= 0 && n < 4) K.flash(0.5 - n * 0.15, 0.62 - n * 0.17, 0.84 - n * 0.22);
    glows.push(pt, { kind: KIND.burst, m: W * 0.16 * (0.5 + k), color: CYAN, power: 1.1 * k * fl, seed: 0.3 + (K.d3 % 4) * 0.2, mode: 2 });
    glows.push(pt, { kind: KIND.soft, m: W * 0.3, color: BLUE, power: 0.9 * k * fl, mode: 2 });
    const nA = Math.floor(8 * k + 0.5);
    for (let i = 0; i < nA; i++) {
      const ang = hash(K.d3, i, 40) * 6.283, rr = W * (0.06 + 0.16 * hash(K.d3, i, 41));
      b.copy(pt).addScaledVector(K.R, Math.cos(ang) * rr).addScaledVector(K.U, Math.sin(ang) * rr * 0.7);
      lines.push(boltPts(pt, b, hash(K.d3, i, 42) * 1e4, K.R, K.U, 0.2, 5), { px: 1.9, color: CYAN, power: 1.7, soft: 10, mode: 2, rim: 0.6, width: (s) => 1 - 0.8 * s });
    }
    K.light(pt, W * 0.5, ICE, 5 * k * fl);
    woundsAndShaft(P, smooth(invLerp(0.7, 1.0, r)));
  }

  // lightning hugging the shaft where it leaves the body, above the back and below the belly
  function woundsAndShaft(P, k) {
    if (k <= 0 || !P.real) return;
    const fl = 0.84 + 0.32 * hash(K.dn, 37);
    const W = K.W(L.back);
    if (K.onScreen(L.back, 0.25)) {
      wound(L.back, 0.022, k, 371, 0);
      const up = a.copy(L.back).addScaledVector(P.dir, -W * 0.26).clone();
      shaftArc(L.back, up, 372, { power: 1.9 * k, px: 2.3, rad: W * 0.012 });
      K.light(L.back, W * 0.4, ICE, 4 * k * fl);
    }
    if (K.onScreen(L.belly, 0.25)) {
      wound(L.belly, 0.016, k, 373, 0);
      const dn = b.copy(L.belly).addScaledVector(P.dir, W * 0.14).clone();
      shaftArc(L.belly, dn, 374, { power: 1.9 * k, px: 2, rad: W * 0.012 });
      K.light(L.belly, W * 0.3, CYAN, 3 * k * fl);
    }
    bodyArcs(4, 370, K.depth(L.back) + L.size, { crawl: true, px: 1.5, len: 0.08, power: 1.5 * k });
  }

  // ---------------------------------------------------------------- s37
  function s37(st) {
    const P = grab();
    const lt = st.lt, d = st.dur;
    // the charge dies as the beast rises into the light (ref: gone by 74.3)
    const k = 1 - smooth(invLerp(d * 0.68, d * 0.86, lt));
    woundsAndShaft(P, k);
    if (k < 0.05 && P.real) return;
    if (!P.real) { wound(L.back, 0.02, k, 375); K.light(L.back, K.W(L.back) * 0.4, ICE, 4 * k); }
  }

  // ---------------------------------------------------------------- s39
  // The dying beast rolls in the air with the arrow through it: we carry the arrow here, the
  // shaft burns white and bolts fall from it to the sea (ref 77.5, 78.2).
  function s39(st) {
    grab();
    const t = K.t;
    const lev = ctx.leviathan;
    const vis = lev?.root ? lev.root.visible !== false : true;
    // the harpoon stays in the hide at a fixed point of the body (tether-harpoon.js)
    const held = vis && harpoonPose(lev, HP);
    if (held) K.ownArrow?.(HP.tail, HP.tip, 2.1);
    const k = 1 - smooth(invLerp(c.crash - 0.25, c.crash + 0.6, t));
    if (k <= 0 || !vis || !held) return;
    const fl = 0.8 + 0.4 * hash(K.dn, 39);
    const W = K.W(L.belly);
    const tip = HP.tip;
    const dp = K.depth(L.belly) + L.size;
    shaftArc(HP.exit, tip, 391, { n: 4, power: 1.9 * k, px: 2.6, rad: W * 0.01, rough: 0.07, line: 3.2 });
    shaftArc(HP.entry, a.lerpVectors(HP.entry, HP.tail, 0.2).clone(), 392, { n: 2, power: 1.3 * k, px: 1.5, rad: W * 0.006, rough: 0.07, line: 0 });
    glows.push(HP.exit, { kind: KIND.soft, m: W * 0.07, color: CYAN, power: 1.1 * k * fl, mode: 0, bias: W * 0.05 });
    glows.push(HP.exit, { kind: KIND.kira, m: W * 0.07, color: ICE, power: 0.9 * k * fl, rot: 0.08, mode: 0, bias: W * 0.05 });
    bodyArcs(6, 390, dp, { px: 1.9, len: 0.13 });
    bodyArcs(8, 410, dp, { crawl: true, px: 1.4, len: 0.08 });
    // bolts striking down from the shaft to the sea
    if (tip.y > 6) {
      const n = 1 + (K.d3 % 2);
      for (let i = 0; i < n; i++) {
        const s = a.copy(tip).addScaledVector(K.R, (hash(K.d3, i, 43) - 0.5) * W * 0.02).clone();
        const e = b.copy(s).addScaledVector(K.R, (hash(K.d3, i, 44) - 0.5) * W * 0.06); e.y = 0;
        bolt(s, e.clone(), hash(K.d3, i, 45) * 1e4, { px: 2.4, rough: 0.09, branches: 2, rim: 0.85, power: 1.8 * k, mode: 0, bias: 30 });
      }
      glows.push(_x.set(tip.x, 0, tip.z), { kind: KIND.soft, m: W * 0.05, color: CYAN, power: 0.9 * k * fl, mode: 2 });
    }
    // tint, not light: this sits right over Water's white spray
    K.tint(L.belly, W * 0.2, 0.8 * k * fl);
    K.tint(L.back, W * 0.14, 0.6 * k * fl);
  }

  void clamp; void easeOut; void lerp;
  return { s31, s32, s33, s34, s35, s36, s37, s39 };
}
