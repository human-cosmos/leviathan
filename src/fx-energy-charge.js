import * as THREE from 'three';
import { clamp, invLerp, smooth, easeOut, lerp } from './util.js';
import { KIND, hash, hr, boltPts, crawlPts, along } from './fx-energy-core.js';

// s06–s10: the charge crawling along the arrow and over the armour, the crystal arrowhead,
// the release, the shock on the sea, and the streak that opens the sky.

const V = THREE.Vector3;
export const CYAN = [0.24, 0.72, 1.0], ICE = [0.62, 0.92, 1.0], BLUE = [0.12, 0.42, 1.0];

export function createChargeFx(K) {
  const { lines, glows, sky } = K;
  const { CUES: c } = K.ctx;

  // arrow on the string; these anchors exist from the Archer department, the fall-backs
  // only keep the shots testable before it lands
  const A = {
    tip: new V(), nock: new V(), hand: new V(), bow: new V(), chest: new V(), head: new V(),
    grab() {
      K.anchor('archer', 'arrowTip', A.tip, _f.set(-70, 96, 0));
      K.anchor('archer', 'arrowNock', A.nock, _f.set(26, 96, 0));
      K.anchor('archer', 'drawHand', A.hand, A.nock);
      K.anchor('archer', 'bowHand', A.bow, _f.set(-32, 96, 0));
      K.anchor('archer', 'chest', A.chest, _f.set(4, 90, 0));
      K.anchor('archer', 'head', A.head, _f.set(6, 104, 0));
      A.len = Math.max(A.tip.distanceTo(A.nock), 1);
      A.dir = _d.subVectors(A.tip, A.nock).normalize();
    },
  };
  const _f = new V(), _d = new V(), a = new V(), b = new V(), o = new V(), q = new V();

  // bolts running along the shaft between parameters s0..s1
  function shaftBolts(s0, s1, n, seed, opt = {}) {
    const R = K.R, U = K.U, dn = K.d3;
    const rad = opt.rad ?? A.len * 0.006;
    for (let i = 0; i < n; i++) {
      const h1 = hash(dn, i, seed), h2 = hash(dn, i, seed + 1);
      const u0 = lerp(s0, s1, h1), ln = (opt.seg ?? 0.14) * (0.5 + h2);
      const u1 = Math.min(s1, u0 + ln);
      along(A.nock, A.tip, u0, a); along(A.nock, A.tip, u1, b);
      a.addScaledVector(U, (hash(dn, i, seed + 2) - 0.5) * rad * 2);
      b.addScaledVector(U, (hash(dn, i, seed + 3) - 0.5) * rad * 2);
      const pts = boltPts(a, b, hash(dn, i, seed + 4) * 1e4, R, U, opt.rough ?? 0.05, opt.lv ?? 4);
      lines.push(pts, { px: (opt.px ?? 1.4) * (0.7 + 0.6 * h2), color: CYAN, power: opt.power ?? 1.2, soft: opt.soft ?? 7, mode: opt.mode ?? 2, bias: opt.bias ?? 3, rim: opt.rim ?? 0.5, width: (s) => 0.4 + 0.6 * Math.sin(s * Math.PI) });
    }
  }

  // white dashes of light travelling along the shaft
  function shaftDashes(s0, s1, n, speed, opt = {}) {
    const t = K.t;
    for (let i = 0; i < n; i++) {
      const ph = (i / n + hash(i, 3) * 0.3 + t * speed) % 1;
      const u0 = lerp(s0, s1, ph), u1 = Math.min(s1, u0 + (opt.seg ?? 0.05) * (0.4 + hash(i, 4)));
      along(A.nock, A.tip, u0, a); along(A.nock, A.tip, u1, b);
      lines.push([a.clone(), b.clone()], { px: opt.px ?? 1.6, color: ICE, power: 1.5, soft: opt.soft ?? 9, mode: opt.mode ?? 2, bias: opt.bias ?? 3, rim: 0 });
    }
  }

  // curling crawlers creeping off the shaft over the armour; drawn only on geometry
  function crawlers(s0, s1, n, seed, len, opt = {}) {
    const R = K.R, U = K.U, dn = K.d3;
    const dep = -q.copy(A.chest).applyMatrix4(K.camera.matrixWorldInverse).z;
    const maxD = dep + (opt.maxD ?? 60);
    for (let i = 0; i < n; i++) {
      if (hash(dn, i, seed + 7) < 0.15) continue;
      along(A.nock, A.tip, lerp(s0, s1, hash(dn, i, seed)), a);
      a.addScaledVector(U, -(opt.drop ?? 0.012) * A.len * hash(dn, i, seed + 8));
      o.copy(opt.dir ?? q.copy(A.chest).sub(a)).normalize();
      if (!opt.dir) o.lerp(U.clone().negate(), 0.55).normalize();
      const pts = crawlPts(a, o, hash(dn, i, seed + 2) * 1e4, R, U, len * (0.45 + 1.0 * hash(dn, i, seed + 3)), opt.steps ?? 9, opt.curl ?? 1.5);
      lines.push(pts, { px: (opt.px ?? 1.1) * (0.8 + 0.7 * hash(dn, i, seed + 4)), color: CYAN, power: 1.2, soft: opt.soft ?? 5, mode: 1, bias: maxD, rim: opt.rim ?? 0.25, width: (s) => 1 - 0.75 * s });
    }
  }

  function headGlow(k, m0, px0) {
    const fl = 0.86 + 0.28 * hash(K.dn, 77);
    glows.push(A.tip, { kind: KIND.soft, m: m0 * 2.6, color: BLUE, power: 0.9 * k * fl, mode: 2 });
    glows.push(A.tip, { kind: KIND.kira, m: m0 * 2.2, px: px0, color: ICE, power: 1.1 * k * fl, rot: (K.dn % 4) * 0.08, mode: 2 });
  }

  // ---------------------------------------------------------------- s06
  // Macro of the draw hand. Energy leaves the fingers and creeps left along the shaft, a
  // chain of tight little arcs hanging under it across the chest (ref 8.5). The frame is only
  // ~28 m wide, so everything is sized from the frame and only the first third of the arrow
  // is ever on screen.
  function s06(st) {
    A.grab();
    const t = K.t;
    const k = smooth(invLerp(c.chargeStart, 8.8, t));
    if (k <= 0) return;
    const W = K.W(A.hand);
    const vis = W / A.len;                      // arrow parameter per frame width
    const front = 0.015 + vis * 0.95 * Math.pow(invLerp(c.chargeStart, 8.7, t), 1.25);
    const f = 0.8 + 0.3 * hash(K.dn, 12);
    const g = W * 0.03;
    // white dashes in the shaft line, and the thick bolt hugging it
    shaftDashes(0.01, front, 6 + Math.floor(k * 16), 0.28, { px: 1.6 + k * 1.2, seg: vis * 0.05, mode: 2, soft: 10 });
    shaftBolts(0.01, front, 3 + Math.floor(k * 9), 11, { px: 1.5 + k * 1.2, seg: vis * 0.22, rad: g * 0.7, rough: 0.06, mode: 2, rim: 0.75, power: 1.5, soft: 9 });
    // the chain of arcs under the shaft: each a tight kinked hoop, on threes
    const nC = 3 + Math.floor(smooth(invLerp(6.5, 8.6, t)) * 15);
    for (let i = 0; i < nC; i++) {
      const u = lerp(0.02, front, hash(K.d3, i, 21));
      along(A.nock, A.tip, u, a).addScaledVector(K.U, -g * (0.7 + 1.1 * hash(K.d3, i, 22)));
      b.copy(a).addScaledVector(K.R, (hash(K.d3, i, 23) - 0.5) * W * 0.11).addScaledVector(K.U, -g * (hash(K.d3, i, 24) * 1.8 - 0.3));
      const pts = boltPts(a, b, hash(K.d3, i, 25) * 1e4, K.R, K.U, 0.3, 4);
      lines.push(pts, { px: 2 + 1.1 * hash(K.d3, i, 26), color: CYAN, power: 1.7, soft: 10, mode: 2, rim: 0.85, width: (s) => 0.4 + 0.6 * Math.sin(s * Math.PI) });
    }
    // crawlers reaching down and up over the plates
    const nD = Math.floor(smooth(invLerp(7.2, 8.8, t)) * 12);
    crawlers(0.02, Math.min(front, vis * 0.85), nD, 31, W * 0.14, { px: 1.5, drop: g * 1.2 / A.len, steps: 9, curl: 1.3, rim: 0.8 });
    // sparks at the fingers (ref 6.3)
    crawlers(0.0, Math.max(0.03, vis * 0.08), 4 + Math.floor(k * 5), 41, W * 0.07, { px: 1.6, drop: 0.0, steps: 6, curl: 1.8, dir: K.R, rim: 0.8 });
    // light: tinted bands that walk with the front, plus the seams
    for (let i = 0; i < 3; i++) {
      const u = lerp(0.02, front, (i + 0.5) / 3);
      along(A.nock, A.tip, u, a).addScaledVector(K.U, -g * 1.8).addScaledVector(K.Fw, -W * 0.12);
      K.tint(a, W * 0.32, 1.0 * k * f);
    }
    along(A.nock, A.tip, front, a).addScaledVector(K.U, -g).addScaledVector(K.Fw, -W * 0.1);
    K.light(a, W * 0.1, ICE, 0.7 * k * f);
    K.seamR = 1.25;
    K.seam(smooth(invLerp(6.3, 8.6, t)) * 0.92);
  }

  // ---------------------------------------------------------------- s07 / s09 (pre-release)
  function wideCharge(k) {
    const W = K.W(A.chest);
    const f = 0.82 + 0.3 * hash(K.dn, 13);
    shaftDashes(0.02, 0.96, 14, 0.8, { px: 1.3, seg: 0.05, soft: 7 });
    shaftBolts(0.02, 0.96, 6 + Math.floor(k * 9), 31, { px: 1.3 + k * 0.7, seg: 0.2, rad: A.len * 0.012, rough: 0.1, rim: 0.85, power: 1.6, soft: 8 });
    crawlers(0.0, 0.22, 8, 51, W * 0.06, { px: 1.1, steps: 7, soft: 4, drop: 0.02, maxD: 70, rim: 0.7 });
    // long loose arcs leaving the arrow in the last second
    const nA = Math.floor(smooth(invLerp(10.4, 11.6, K.t)) * 5);
    for (let i = 0; i < nA; i++) {
      const u = hash(K.d3, i, 90);
      along(A.nock, A.tip, u, a);
      b.copy(a).addScaledVector(K.U, (hash(K.d3, i, 91) - 0.5) * A.len * 0.2).addScaledVector(A.dir, A.len * (0.06 + 0.14 * hash(K.d3, i, 92)));
      lines.push(boltPts(a, b, hash(K.d3, i, 93) * 1e4, K.R, K.U, 0.2, 4), { px: 1.1, color: CYAN, power: 1.5, soft: 6, mode: 2, rim: 0.85, width: (s) => 1 - 0.8 * s });
    }
    // the point of light on the tip, a hot spot at the hand and on the bow hand (ref 11.27)
    const fl = 0.86 + 0.28 * hash(K.dn, 77);
    glows.push(A.tip, { kind: KIND.soft, px: 70, color: BLUE, power: 0.65 * k * fl, mode: 2 });
    glows.push(A.tip, { kind: KIND.kira, px: 30 + 46 * k, color: ICE, power: 1.0 * (0.4 + 0.6 * k) * fl, rot: (K.dn % 4) * 0.08, mode: 2 });
    glows.push(A.hand, { kind: KIND.kira, px: 34 * k + 14, color: ICE, power: 0.75 * k * f, rot: 0.1, mode: 2 });
    glows.push(A.bow, { kind: KIND.kira, px: 26 * k + 10, color: ICE, power: 0.6 * k * f, rot: 0.05, mode: 2 });
    K.tint(A.chest, W * 0.11, 1.0 * k * f);
    K.tint(A.bow, W * 0.07, 0.9 * k * f);
    K.tint(A.hand, W * 0.06, 0.9 * k * f);
    K.tint(along(A.nock, A.tip, 0.55, a), W * 0.08, 0.7 * k * f);
    K.light(A.tip, W * 0.05, ICE, 1.1 * k * f);
    K.seamR = 1.4;
    K.seam(0.8 * k);
  }

  function s07(st) {
    A.grab();
    wideCharge(smooth(invLerp(9.0, 11.6, K.t)) * 0.75 + 0.25);
  }

  // ---------------------------------------------------------------- s08
  // The head goes crystal: lit from inside, a hard white shape with a cyan rim, lightning
  // boiling down the shaft to the fist behind it (ref 11.98).
  function s08(st) {
    A.grab();
    const t = K.t;
    const k = smooth(invLerp(c.chargeFull - 0.1, 12.4, t)) * 0.35 + 0.65;
    const f = 0.84 + 0.32 * hash(K.dn, 14);
    const hd = A.len * 0.17;
    const mid = q.copy(A.tip).addScaledVector(A.dir, -hd * 0.5).clone();
    const W = K.W(mid);
    // thick lightning from the hand up the shaft into the head
    shaftBolts(0.0, 0.84, 9, 61, { px: 2.6, seg: 0.24, rad: A.len * 0.012, rough: 0.1, lv: 5, power: 1.9, soft: 11, rim: 0.8, mode: 0, bias: A.len * 0.2 });
    shaftBolts(0.04, 0.8, 7, 67, { px: 1.4, seg: 0.14, rad: A.len * 0.03, rough: 0.2, lv: 5, power: 1.6, soft: 7, rim: 0.6, mode: 0, bias: A.len * 0.2 });
    shaftDashes(0.03, 0.82, 10, 0.9, { px: 2.3, seg: 0.05, soft: 9, mode: 0, bias: A.len * 0.2 });
    // the head blazes: lit hard, a tight glow, a small star on the point
    glows.push(mid, { kind: KIND.soft, m: hd * 1.1, color: CYAN, power: 0.42 * k * f, mode: 2 });
    glows.push(A.tip, { kind: KIND.kira, px: 150, color: ICE, power: 0.85 * k * f, rot: (K.dn % 3) * 0.1, mode: 2 });
    // arcs jumping off the blade
    for (let i = 0; i < 6; i++) {
      const ang = hash(K.d3, i, 62) * 6.283, r = hd * (0.4 + 0.7 * hash(K.d3, i, 63));
      a.copy(mid).addScaledVector(A.dir, (hash(K.d3, i, 64) - 0.5) * hd * 0.9);
      b.copy(a).addScaledVector(K.R, Math.cos(ang) * r).addScaledVector(K.U, Math.sin(ang) * r);
      lines.push(boltPts(a, b, hash(K.d3, i, 65) * 1e4, K.R, K.U, 0.24, 4), { px: 2, color: CYAN, power: 1.7, soft: 8, mode: 2, rim: 0.7, width: (s) => 1 - 0.85 * s });
    }
    // only the head is lit hard; everything behind it just turns blue
    K.light(_f.copy(A.tip).addScaledVector(A.dir, -hd * 0.42).addScaledVector(K.Fw, -hd * 0.3), hd * 0.8, ICE, 6.5 * k * f);
    K.tint(A.hand, W * 0.2, 0.9 * k * f);
    K.tint(A.bow, W * 0.22, 0.75 * k * f);
    K.seamR = 1.0;
    K.seam(0.8 * k);
  }

  // ---------------------------------------------------------------- s09
  // The release: one punch of light, a hard line down the arrow's path that hangs in the air
  // and thins (the reference leaves just that line), a shock running out over the sea.
  const aimTip = new V(), aimDir = new V();
  function s09(st) {
    A.grab();
    const t = K.t, r = t - c.release;
    if (r < 0) { wideCharge(1); return; }
    const W = K.W(A.chest);
    aimDir.copy(A.dir);
    if (aimDir.lengthSq() < 0.5) aimDir.set(-1, 0.02, 0);
    aimTip.copy(A.bow).addScaledVector(aimDir, A.len * 0.45);
    const n = K.st.frame - Math.round(c.release * 24);
    if (n === 0) K.flash(1.3, 1.45, 1.6);
    else if (n === 1) K.flash(0.55, 0.72, 1.0);
    else if (n === 2) K.flash(0.16, 0.26, 0.45);
    const k = Math.exp(-r * 8);
    glows.push(A.bow, { kind: KIND.burst, m: W * (0.1 + 0.3 * r), color: CYAN, power: Math.max(0, 1 - r * 4.2), seed: 0.37 + (K.dn % 5) * 0.11, rot: 0, mode: 2 });
    glows.push(A.bow, { kind: KIND.soft, m: W * 0.28, color: BLUE, power: 0.9 * k, mode: 2 });
    // rings shed in the air along the line of flight
    for (let i = 0; i < 3; i++) {
      const ri = r - i * 0.07;
      if (ri <= 0 || ri > 0.42) continue;
      a.copy(A.bow).addScaledVector(aimDir, W * (0.1 + 0.55 * i * 0.5 + ri * 1.2));
      glows.push(a, { kind: KIND.ring, m: W * (0.05 + 0.2 * easeOut(ri / 0.42, 2)), color: ICE, power: (1 - ri / 0.42) * 0.8, aspect: 0.3, thick: 0.05, rot: 0, mode: 2 });
    }
    // the line: from the bow out to the horizon, it hangs and thins for a second
    const w = Math.exp(-r * 2.6);
    a.copy(A.bow).addScaledVector(aimDir, -W * 0.02);
    b.copy(A.bow).addScaledVector(aimDir, Math.min(2400, 300 + 8000 * r));
    lines.push([a.clone(), b.clone()], { px: 10 * k + 1.4 * w, color: CYAN, power: 1.9 * Math.min(1, w * 1.6), soft: 18 * k + 6, mode: 2, rim: 0.5, width: (s) => 1 - 0.6 * s });
    if (r < 0.5) for (let i = 0; i < 3; i++) lines.push(boltPts(a, b, hash(K.d3, i, 66) * 1e4, K.R, K.U, 0.004, 5), { px: 1.3, color: ICE, power: 1.4 * k + 0.4, soft: 5, mode: 2, rim: 0.4 });
    K.focus(A.bow, Math.max(0, 0.7 - r * 3.4), 0.3);
    // the shock runs out across the sea
    const X = aimTip.x, Z = aimTip.z;
    for (let i = 0; i < 3; i++) {
      const ri = r - i * 0.13;
      if (ri > 0) K.ring(X, Z, 60 + 1200 * easeOut(ri / 1.3, 1.5), Math.max(0, 1 - ri / 1.2));
    }
    // leftover crackle on the arm and the bow
    const nB = Math.floor(9 * Math.exp(-r * 1.8));
    for (let i = 0; i < nB; i++) {
      a.copy(A.bow).lerp(A.chest, hash(K.d3, i, 67));
      b.copy(a).addScaledVector(K.R, (hash(K.d3, i, 68) - 0.5) * W * 0.09).addScaledVector(K.U, (hash(K.d3, i, 69) - 0.5) * W * 0.09);
      lines.push(boltPts(a, b, hash(K.d3, i, 70) * 1e4, K.R, K.U, 0.2, 4), { px: 1.2, color: CYAN, power: 1.5, soft: 5, mode: 2, rim: 0.8, width: (s) => 1 - 0.7 * s });
    }
    K.tint(A.bow, W * 0.14, 1.1 * Math.exp(-r * 3));
    K.tint(A.chest, W * 0.14, 1.0 * Math.exp(-r * 2.4));
    K.seam(0.7 * Math.exp(-r * 2));
  }

  // ---------------------------------------------------------------- s10
  // Quiet deck until the whoosh: a line of light runs the length of the sky, the clouds light
  // along it (ref 15.4), then the gap opens. No white-out; the walls are the event.
  const E2 = new V(), pv = new V();
  function s10(st) {
    sky.update(st, K.camera);
    const t = K.t, z0 = c.cloudSplit + 0.36, r = t - z0;
    if (r < -0.05) return;
    const H = sky.H, cam = K.camera.position;
    E2.copy(sky.E);
    const pt = (v, out = new V()) => out.copy(cam).addScaledVector(E2, v * H).addScaledVector(pv.set(0, 1, 0), H);
    const zip = 0.2 + 42 * smooth(invLerp(z0 - 0.02, z0 + 0.28, t));
    const fade = Math.exp(-Math.max(0, r - 0.34) * 5);
    if (fade > 0.02) {
      const pts = [];
      const v0 = Math.max(0.0, zip - 42);
      for (let i = 0; i <= 12; i++) pts.push(pt(lerp(v0 - 0.8, zip, Math.pow(i / 12, 2))));
      lines.push(pts, { px: 3.4 * fade + 0.8, m: 0, color: CYAN, power: 1.9 * fade, soft: 22, mode: 0, bias: 10, rim: 0.3, width: (s) => 0.4 + 0.6 * s });
      for (let i = 0; i < 6; i++) {
        const sv = Math.pow(hash(K.d3, i, 80), 2) * zip;
        pt(sv, a); pt(sv + 1 + 5 * hash(K.d3, i, 81), b);
        lines.push(boltPts(a, b, hash(K.d3, i, 82) * 1e4, K.R, K.U, 0.06, 4), { px: 2.2 * fade, color: CYAN, power: 1.8 * fade, soft: 9, mode: 0, bias: 10, rim: 0.6 });
      }
      if (r < 0.3) glows.push(pt(zip * 0.98, a), { kind: KIND.kira, px: 70, color: ICE, power: 1.0, mode: 0, bias: 10, rot: 0.1 });
    }
    if (r > 0.3 && r < 0.42) K.flash(0.1, 0.17, 0.3);
  }

  return { s06, s07, s08, s09, s10, _A: A, shaftBolts };
}

void clamp; void hr;
