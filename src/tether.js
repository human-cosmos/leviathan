import * as THREE from 'three';
import { clamp, invLerp, lerp, smooth, onTwos } from './util.js';
import { makeRibbon } from './tether-ribbon.js';
import { harpoonPose, makeWound, newPose } from './tether-harpoon.js';

// The arrow is a harpoon: a thin dark cable runs from its tail back up into the sky. Updated
// last each frame, so every department's arrow and body are already posed for this frame. Each
// shot lays one polyline by hand, a pure function of st.t. The ribbon is a main-scene cel with
// an ink id: the beast, the plume and the water hide it where they should.

const V = THREE.Vector3;
const N = 96;
const PX = 3.1;                    // pen weight in pixels of the 1920 frame

// s38-s39: the far end of the cable, fixed in the sky above the left of the frame, so the wire
// swings taut round this point as the body throws itself about.
const SKY = new V(-980, 2500, -1100);
const CRASH = new V(-110, 0, -880);      // where Water raises the mountain (fx-splash-big.js)
const PLUME_TOP = 150;                   // s30: metres where the cable goes into the white water

// s31-s37: the lance is cut to a length that leaves the tail and the cable in frame
const STRIKE_LEN = 320, WIDE_LEN = 560, RISE_LEN = 660;

export function createTether(ctx) {
  const { camera, CUES: c } = ctx;
  const main = makeRibbon(ctx, { id: 61 });
  const over = makeRibbon(ctx, { overlay: true, color: '#141a30', lite: '#2a3350' });
  const wound = makeWound(ctx);
  const H = newPose();
  const pts = Array.from({ length: N }, () => new V());
  const R = new V(), U = new V(), F = new V();
  const a = new V(), b = new V(), d = new V(), e = new V(), m = new V();

  const sync = () => {
    const el = camera.matrixWorld.elements;
    R.set(el[0], el[1], el[2]); U.set(el[4], el[5], el[6]); F.set(-el[8], -el[9], -el[10]);
  };
  const depth = (p) => m.subVectors(p, camera.position).dot(F);

  // the pen wobble: a little life across the line, redrawn on twos
  const boil = (s, t, amp, seed) => {
    const q = onTwos(t) * 12;
    return amp * Math.sin(s * Math.PI) * (Math.sin(s * 11 + seed + q * 1.7) + 0.6 * Math.sin(s * 23 + seed * 2 - q * 2.3));
  };

  // straight line a -> b, sag metres along `down`, wob metres of pen across the frame
  function lay(A, B, sag, wob, t, seed = 1, down = null) {
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1), p = pts[i].lerpVectors(A, B, s);
      const h = 4 * s * (1 - s);
      if (down) p.addScaledVector(down, sag * h); else p.y -= sag * h;
      if (wob) p.addScaledVector(R, boil(s, t, wob, seed));
    }
    return pts;
  }

  // cubic, for a cable that leaves along the shaft and bends away to the sky
  function bez(P0, P1, P2, P3, wob, t, seed = 1) {
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1), u = 1 - s;
      const p = pts[i].set(0, 0, 0).addScaledVector(P0, u * u * u).addScaledVector(P1, 3 * u * u * s).addScaledVector(P2, 3 * u * s * s).addScaledVector(P3, s * s * s);
      if (wob) p.addScaledVector(R, boil(s, t, wob, seed));
    }
    return pts;
  }

  // keep what lies in front of the lens, and above the sea on the surface shots
  function keep(arr, floorY = null) {
    const near = camera.near * 1.5 + 0.5;
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      if (depth(arr[i]) < near) { if (out.length) break; continue; }
      out.push(arr[i]);
    }
    if (floorY !== null) for (const p of out) if (p.y < floorY) p.y = floorY;
    return out;
  }

  const taper = (s) => 1 + 0.1 * Math.sin(s * 19 + 1.3);

  // read the world pose of an arrow.js object: nock at the origin, +Z to the tip
  function arrowLine(o, tail, dir) {
    o.updateWorldMatrix(true, false);
    const el = o.matrixWorld.elements;
    dir.set(el[8], el[9], el[10]);
    const len = dir.length();
    dir.divideScalar(len || 1);
    tail.set(el[12], el[13], el[14]);
    return len;
  }

  // ------------------------------------------------------------- s25
  // World's dive is one long spike from the lens to the far point. Its near end becomes the tail
  // of the arrow, in frame, and the cable carries on along the same line to the lens.
  let spike;
  const findSpike = () => {
    if (spike !== undefined) return spike;
    spike = ctx.scene.children.find((o) => {
      const p = o.isMesh && o.geometry?.parameters;
      return p && p.radiusTop === 0 && p.radiusBottom === 1 && p.height === 1 && p.radialSegments === 10;
    }) ?? null;
    return spike;
  };
  const ndcAt = (out, q) => {
    const ty = Math.tan((camera.fov * Math.PI) / 360), tx = ty * camera.aspect;
    return out.copy(camera.position).addScaledVector(F, q[2]).addScaledVector(R, q[0] * tx * q[2]).addScaledVector(U, q[1] * ty * q[2]);
  };
  function s25(st) {
    const o = ctx.world?.flight?.('s25', st.lt, st.dur, st.t);
    if (!o?.spike) return;
    ndcAt(a, o.spike.far); ndcAt(b, o.spike.near);
    e.lerpVectors(a, b, 0.92);                  // the tail
    const sp = findSpike();
    if (sp) {
      d.subVectors(a, e);
      const len = d.length();
      sp.position.copy(e);
      sp.scale.set(0.9, 0.9, len);
      sp.quaternion.setFromUnitVectors(m.set(0, 0, 1), d.divideScalar(len));
      sp.updateMatrixWorld(true);
    }
    d.subVectors(b, e);
    const q = lay(e, b, 0.8, 0.02, st.t, 3);
    main.set(keep(q), PX, taper);
  }

  // ------------------------------------------------------------- s28
  // The tail is past the lens for most of the shot, so the cable leaves the fire round the
  // ferrule and runs back along the shaft, drawn over the beam.
  function s28(st) {
    const o = ctx.world?.arrow;
    if (!o) return;
    const len = arrowLine(o, a, d);
    e.copy(a).addScaledVector(d, len);           // tip
    const hd = len * 0.17;
    a.copy(e).addScaledVector(d, -hd * 1.5);
    b.copy(a).addScaledVector(d, -2400);
    const q = keep(lay(a, b, 0, 0, st.t));
    if (q.length < 2) return;
    over.set(q, 4.2 + 1.6 * clamp(hd / 50), (s) => 1 - 0.3 * s);
  }

  // ------------------------------------------------------------- s30
  // Follows the streak FX Energy hangs in the air (fx-energy-flight.js), down to the plume, and
  // stays behind when the light of it has gone.
  function s30(st) {
    const r = st.t - c.impact;
    const cm = st.cam;
    d.set(cm.look[0] - cm.pos[0], 0, cm.look[2] - cm.pos[2]).normalize();
    a.set(cm.pos[0] + d.x * 2600, 0, cm.pos[2] + d.z * 2600);
    const up = e.copy(R).multiplyScalar(0.5).add(m.set(0, 1, 0)).normalize().clone();
    const dp = depth(a);
    const W = (dp / (camera.projectionMatrix.elements[5] * 0.5 * 1040)) * 1920;
    const L = W * 1.5;
    const head = clamp(r / 0.13), hang = smooth(invLerp(0.1, 1.9, r));
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1), y = 1 - s * head;
      const sag = Math.sin(y * Math.PI) * hang * W * 0.1 + Math.sin(y * 7 + 1) * hang * W * 0.012;
      pts[i].copy(a).addScaledVector(up, L * y).addScaledVector(R, sag * 0.9);
      pts[i].y -= sag * 0.2;
      pts[i].addScaledVector(R, boil(s, st.t, W * 0.0007, 5));
    }
    main.set(keep(pts, -1), PX * 0.95, (s) => 0.85 + 0.15 * s);
    // over the streak's light, stopping at the top of the plume so the water still swallows it
    const plume = PLUME_TOP * smooth(r / 0.5);
    const clear = [];
    for (const p of pts) { if (p.y < plume) break; clear.push(p); }
    if (clear.length > 1) over.set(keep(clear), PX, (s) => 0.85 + 0.15 * s);
  }

  // ------------------------------------------------------------- s31-s37
  function under(st) {
    const o = ctx.under?.arrow;
    if (!o || !o.isObject3D) return;
    const macro = st.sid === 's35' || (st.sid === 's36' && st.lt <= 0.7);
    const rising = st.sid === 's37';
    let len = arrowLine(o, a, d);
    if (!macro) {
      // cut the lance from the tail end: the tip, the wounds and the FX stay where they are
      const want = rising ? RISE_LEN : st.sid === 's36' ? WIDE_LEN : STRIKE_LEN;
      e.copy(a).addScaledVector(d, len - want);
      o.position.copy(e);
      if (o.parent && o.parent !== ctx.scene) o.parent.worldToLocal(o.position);
      o.scale.z = want;
      o.updateMatrixWorld(true);
      a.copy(e); len = want;
    }
    // up the line it came down, bending to the vertical, to the surface
    const top = Math.max(0, a.y + 320);
    const rise = top - a.y;
    b.copy(a).addScaledVector(d, -rise * 0.4);
    e.set(lerp(a.x, b.x, 2), top - rise * 0.25, lerp(a.z, b.z, 2));
    m.copy(e); m.y = top;
    if (rising) {
      // the beast drags it: a long slack bow out of frame right, as in the reference
      b.copy(a).addScaledVector(d, -260);
      e.set(a.x + 420, a.y + 640, a.z - 40);
      m.set(a.x + 900, Math.max(a.y + 1100, 200), a.z - 60);
    }
    const q = bez(a, b, e, m, rising ? 0.5 : 0.25, st.t, 7);
    main.set(keep(q), PX, taper);
  }

  // ------------------------------------------------------------- s38
  // The beast is inside the swell: the wire stands out of the top of the water, up into the sky.
  function s38(st) {
    const r = st.t - c.surfaceBurst;
    const dome = 1 - Math.exp(-Math.max(r, 0) / 0.6);
    const col = smooth((r - 0.3) / 1.45);
    const topY = 150 * dome + 680 * col;
    a.set(CRASH.x, Math.max(topY * 0.6, -1), CRASH.z);
    const q = lay(a, SKY, 6, 0.3, st.t, 9);
    main.set(keep(q, -1), PX, taper);
  }

  // ------------------------------------------------------------- s39
  function s39(st) {
    const lev = ctx.leviathan;
    if (!harpoonPose(lev, H)) return;
    const k = lev.spine.k ?? 1;
    if (lev.root?.visible !== false) wound.place(H, k);
    a.copy(H.tail);
    // when the roll turns the back away from the sky the cable lies round the body
    d.subVectors(SKY, a);
    const u = clamp(e.subVectors(H.centre, a).dot(d) / d.lengthSq());
    m.copy(a).addScaledVector(d, u);
    b.subVectors(m, H.centre);
    const dist = b.length(), rr = H.radius * 1.18;
    if (dist < rr && u > 0) {
      if (dist < 1) b.copy(F).negate(); else b.divideScalar(dist);
      e.copy(H.centre).addScaledVector(b, rr);
      const cut = Math.floor(N * 0.32);
      for (let i = 0; i < N; i++) {
        const s = i < cut ? i / cut : (i - cut) / (N - 1 - cut);
        if (i < cut) pts[i].lerpVectors(a, e, s);
        else { pts[i].lerpVectors(e, SKY, s); pts[i].y -= 5 * 4 * s * (1 - s); pts[i].addScaledVector(R, boil(s, st.t, 0.3, 11)); }
      }
    } else lay(a, SKY, 5, 0.3, st.t, 11);
    main.set(keep(pts, -1), PX, taper);
  }

  const shots = { s25, s28, s30, s31: under, s32: under, s33: under, s34: under, s35: under, s36: under, s37: under, s38, s39 };

  return {
    update(st) {
      main.hide(); over.hide(); wound.hide();
      const f = shots[st.sid];
      if (!f) return;
      camera.updateMatrixWorld();
      sync();
      f(st);
    },
  };
}
