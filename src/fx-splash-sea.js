import * as THREE from 'three';
import { hash, ID, KIND, PAL } from './fx-splash-core.js';
import { clamp, smooth, invLerp, lerp } from './util.js';
import * as LB from './lev-body.js';
import * as LA from './lev-anim.js';

const V3 = THREE.Vector3;

// Surface shots: the shockwave (s09), whales (s15), spray (s16), boiling lures (s18), the maw (s19),
// the breach (s20–21) and the spray fog (s24).
export function createSeaShots(ctx, B, E) {
  const c = ctx.CUES;
  const I = E.I;
  const fwd = new V3(), tmp = new V3(), tmp2 = new V3();

  function ahead(st, d, side = 0) {
    const cam = st.cam;
    fwd.set(cam.look[0] - cam.pos[0], 0, cam.look[2] - cam.pos[2]).normalize();
    return new V3(cam.pos[0] + fwd.x * d + fwd.z * side, 0, cam.pos[2] + fwd.z * d - fwd.x * side);
  }

  // ------------------------------------------------ the body as a chain of points, head first
  const CH = 15;
  const chain = Array.from({ length: CH }, () => new V3());
  const chainR = new Float32Array(CH);
  const sA = new V3(), sB = new V3(), sC = new V3();
  const levAnchor = (n, v) => { const L = ctx.leviathan; if (!L?.anchor) return null; try { const r = L.anchor(n, v); return r === undefined ? v : r; } catch { return null; } };
  function bodyChain(t) {
    const L = ctx.leviathan;
    if (L?.spine?.at) {
      // head at s = 1, tail at s = 0
      for (let i = 0; i < CH; i++) { const s = 1 - i / (CH - 1); L.spine.at(s, chain[i]); chainR[i] = (L.bodyRadius?.(s) ?? 120 * Math.sin(Math.PI * Math.min(0.08 + s * 0.92, 0.97)) + 12); }
      return chain;
    }
    if (levAnchor('head', sA) && levAnchor('back', sB) && levAnchor('tail', sC)) {
      for (let i = 0; i < CH; i++) {
        const u = i / (CH - 1);
        // quadratic through head, back, tail
        const a = 2 * (u - 0.5) * (u - 1), b = -4 * u * (u - 1), d = 2 * u * (u - 0.5);
        chain[i].set(sA.x * a + sB.x * b + sC.x * d, sA.y * a + sB.y * b + sC.y * d, sA.z * a + sB.z * b + sC.z * d);
        chainR[i] = 120 * Math.sin(Math.PI * Math.min(0.08 + (1 - u) * 0.92, 0.97)) + 12;
      }
      return chain;
    }
    // no creature yet: a stand-in arc so the splash can be judged on its own
    const k = clamp((t - c.breach) / 6.9);
    const hx = lerp(-40, 420, k), hy = 40 + 560 * Math.sin(Math.min(k * 1.55, 1) * Math.PI * 0.5) - 240 * k * k;
    for (let i = 0; i < CH; i++) {
      const u = i / (CH - 1);
      chain[i].set(hx - u * lerp(40, 620, k), hy - u * 680 * (1 - 0.35 * k) + 130 * Math.sin(u * 3.1) * k, 0);
      chainR[i] = 120 * Math.sin(Math.PI * Math.min(0.08 + (1 - u) * 0.92, 0.97)) + 12;
    }
    return chain;
  }

  // a point on the hide in body coordinates: z along the body (0 tail .. L snout), phi round the section
  const _rest = new V3();
  function hide(z, phi, off, out, jaw = 0) {
    const L = ctx.leviathan, S = LB.section?.(z);
    if (!L?.spine?.toWorld || !S) return false;
    const co = Math.cos(phi), si = Math.sin(phi);
    _rest.set((S.rx + off) * co, S.cy + (si > 0 ? S.top : S.bot) * si + off * si, z);
    L.spine.toWorld(_rest, out, jaw);
    return true;
  }
  // a tongue of white water running along the hide from z0 to z1, drifting round the section
  function runOff(o) {
    const { z0, z1, phi, drift = 0, hw, seed, off = 5, flow = 100, tear = 0.6, tone = 0.04 } = o;
    if (!LB.section || !ctx.leviathan?.spine?.toWorld) return;
    B.sheets.push((u, out) => { const z = lerp(z0, z1, u); hide(z, phi + drift * u, off, out, z > (LB.HINGE?.[1] ?? 1e9) ? 1 : 0); }, (u) => hw * (0.55 + 0.85 * u), (seed * 0.37) % 13, I.tq * flow, tear, tone);
  }

  // ------------------------------------------------ continuous pulses of a fan of jets
  function fountain(o) {
    const per = o.per ?? 0.5, tq = I.tq;
    const from = o.from, to = o.to ?? 1e9;
    const k0 = Math.floor((Math.min(tq, to) - from) / per);
    for (let k = Math.max(0, k0 - (o.keep ?? 4)); k <= k0; k++) {
      const t0 = from + k * per;
      E.jets({ ...o, t0, seed: (o.seed ?? 1) + k * 17 });
    }
  }

  // a heavy body breaking the surface here: crown, surge, churn, spray, rings
  function breachRing(x, z, R, H, t0, seed, o = {}) {
    const a = I.tq - t0;
    if (a < 0) return;
    const g = o.g ?? 16;
    const dur = o.dur ?? 1e9;
    if (a < dur) {
      fountain({ x, z, from: t0, to: t0 + (o.pulses ?? 3) * (o.per ?? 0.55), per: o.per ?? 0.55, keep: 5, n: o.n ?? 18, k: o.k ?? 8, seed, H, g, T: 0.8, spread: o.spread ?? 0.5, polP: 0.7, R0: R, w: o.w ?? R * 0.2, Hmin: 0.25,
        massR: Math.max(R, H * 0.5), massYk: 0.25, tiltX: 0, tiltZ: 0, tone: o.tone ?? 0.1, shedN: 2 });
    }
    const gk = 1 - Math.exp(-a / 0.7);
    E.mound({ x, z, t0, seed: seed + 3, n: o.moundN ?? 46, R: (R * 1.15 + H * 0.12) * gk, H: H * 0.32 * gk, w: o.w ? o.w * 1.3 : R * 0.26, tone: 0.16, yP: 1.6, taper: 0.5 });
    E.collar({ x, z, t0, seed: seed + 5, n: o.collarN ?? 44, R: R * 2.4 + H * 0.6, R0: R * 0.7, tau: 1.3, w: R * 0.2 + H * 0.05, H: H * 0.08, dur: o.collarDur ?? 6 });
    E.boil(x, z, R * 3.2 + H, seed, 1, 0.4 + 0.6 * gk);
    E.ring(x, z, R + a * 60, seed + 1, Math.exp(-a * 0.35) * 0.9);
    B.ripples.add(I.tq, x, z, t0, 2.2, 55, 18, 0.32, 1, 2);
    E.mistCloud({ x, z, t0, n: o.mistN ?? 9, seed: seed + 7, R: R * 1.8 + H * 0.5, H: H * 0.55, w: H * 0.5, tau: 1.2, op: o.mist ?? 0.42, soft: 60, hard: 0.2 });
  }

  // water pouring straight down from a point: a tearing strip and a hit on the sea
  function pour(p, hw, seed, flowV, tear = 0.75, tone = 0, side = null, lenK = 1) {
    if (p.y < 8) return;
    const px = p.x, py = p.y, pz = p.z;
    const drift = hash(seed, 3, 1) * 16 - 8;
    const f = (u, out) => out.set(px + drift * u * u, py * (1 - u * lenK), pz);
    B.sheets.push(f, (u) => hw * (0.8 + 0.4 * Math.sin(u * 3.1 + seed)) * (1 - 0.3 * u), (seed * 0.37) % 13, I.tq * flowV, tear, tone, side);
    // where it lands the sea jumps
    if (lenK >= 1) {
      const n = 3, inkZ = E.inkZ(px + drift, 0, pz);
      B.puffs.inkZ = inkZ;
      for (let i = 0; i < n; i++) {
        const h = hash(seed, i, I.draw % 5);
        const r = hw * (0.55 + 0.5 * h);
        B.puffs.push(px + drift + (hash(seed, i, 7) - 0.5) * hw * 3, r * 0.5, pz + (hash(seed, i, 8) - 0.5) * hw * 2, r, r * 1.6, 0.4, 0.5, 0, 1, 0, (seed + i) % 97, 0.14, 0, KIND.PUFF, PAL.WATER, ID.MASS2);
      }
      B.puffs.inkZ = 0;
    }
  }

  // ------------------------------------------------ s09: the release shockwave on the sea
  function s09(st) {
    const a = I.tq - c.release;
    if (a < 0) return;
    if (!ctx.archer?.anchor) return;
    ctx.archer.anchor('arrowTip', tmp);
    const x = tmp.x, z = tmp.z;
    for (let i = 0; i < 3; i++) {
      B.ripples.add(I.tq, x, z, c.release + i * 0.11, 2.0 - i * 0.4, 260, 22, 0.5, 1, 3);
    }
    E.ring(x, z, 40 + a * 320, 91, Math.exp(-a * 0.8), 0.3);
    E.ring(x, z, 10 + a * 210, 92, 0.75 * Math.exp(-a * 1.1), 0.3);
    // flat spray skating out ahead of the ring
    const R = 40 + a * 320;
    for (let i = 0; i < 40; i++) {
      const az = hash(i, 2, 90) * Math.PI * 2;
      const rr = R * (0.94 + 0.08 * hash(i, 3, 90));
      const px = x + Math.cos(az) * rr, pz = z + Math.sin(az) * rr;
      B.puffs.push(px, 2, pz, 5 + 7 * hash(i, 4, 90), 0, 1, 0.5, 0, 1, 0, i % 97, 0.05, clamp(a * 0.5), KIND.PUFF, PAL.WATER, ID.MASS2);
    }
    E.mistCloud({ x, z, t0: c.release, n: 12, seed: 93, R: R * 0.8, H: 14, w: R * 0.16, tau: 0.8, op: 0.3, soft: 20, flat: 0.25, dur: 1.6 });
  }

  // ------------------------------------------------ s15: four whales from the ship's rail
  const whaleAnchor = (i, v) => {
    const L = ctx.leviathan;
    if (L?.whaleAnchor) return L.whaleAnchor(i, v);
    return null;
  };
  function whaleSpot(st, i) {
    if (whaleAnchor(i, tmp)) return tmp.clone();
    const P = LA.POD?.[i];
    if (P) return new V3(P[0] + 10, 0, P[1]);
    return ahead(st, 1000 + 140 * (i % 2), -340 + i * 215);
  }
  function s15(st) {
    const tq = I.tq, R = c.whalesRise, D = c.whalesDive;
    for (let i = 0; i < 4; i++) {
      const p = whaleSpot(st, i);
      const t0 = R + i * 0.22;
      breachRing(p.x, p.z, 13, 62, t0, 200 + i * 31, { n: 12, k: 7, per: 0.45, pulses: 3, w: 4.2, moundN: 26, collarN: 26, mistN: 6, mist: 0.42, g: 14 });
      // the dive: tail spray thrown in a high arc, flung to the side
      const a = tq - (D + i * 0.2);
      if (a > 0) {
        fountain({ x: p.x, z: p.z, from: D + i * 0.2, to: D + i * 0.2 + 0.6, per: 0.3, keep: 3, n: 10, k: 8, seed: 260 + i, H: 96, g: 20, T: 0.7, spread: 0.32, polP: 0.8, w: 4.6, Hmin: 0.4, massR: 46, tone: 0.06, shedN: 3 });
        E.mistCloud({ x: p.x, z: p.z, t0: D + i * 0.2, n: 8, seed: 270 + i, R: 80, H: 100, w: 60, tau: 1.1, op: 0.5, soft: 24 });
      }
    }
    // spray walls drift across the frame as the whales go down
    const k = smooth(invLerp(D - 0.4, D + 0.9, tq));
    if (k > 0) {
      const p = ahead(st, 470, 0);
      for (let i = 0; i < 12; i++) {
        const u = i / 11;
        E.mist(p.x + (u - 0.5) * 560 * fwd.z, 40 + 80 * hash(i, 1, 280), p.z - (u - 0.5) * 560 * fwd.x, 120, 74, i + 280, 0.3 * k, 30, 0, 0.1, hash(i, 2, 280) * 6);
      }
    }
    // spray on the near rail
    E.drops({ x: st.cam.pos[0] + fwd.x * 30, y: 6, z: st.cam.pos[2] + fwd.z * 30, t0: Math.floor(tq / 0.5) * 0.5, n: 10, seed: 290 + Math.floor(tq / 0.5), V: 16, spread: 0.7, r: 0.18, g: 9.8 });
  }

  // ------------------------------------------------ s16: spray over the deck
  function s16(st) {
    const tq = I.tq;
    const cp = st.cam.pos;
    fwd.set(st.cam.look[0] - cp[0], 0, st.cam.look[2] - cp[2]).normalize();
    for (let k = 0; k < 4; k++) {
      const per = 0.42, t0 = (Math.floor(tq / per) - k) * per;
      const sd = 300 + Math.floor(t0 / per) % 50;
      const sx = hash(sd, 1, 1) - 0.5;
      const x = cp[0] + fwd.x * (60 + 80 * hash(sd, 2, 1)) + fwd.z * sx * 60, z = cp[2] + fwd.z * (60 + 80 * hash(sd, 2, 1)) - fwd.x * sx * 60;
      E.drops({ x, y: cp[1] - 12, z, t0, n: 16, seed: sd, V: 22, spread: 0.6, az: Math.atan2(fwd.x, fwd.z), azSpread: 0.25, r: 0.14, g: 11, delay: 0.1 });
    }
    for (let i = 0; i < 6; i++) {
      const u = ((tq * 0.16 + i * 0.167) % 1);
      E.mist(cp[0] + fwd.x * 70 + fwd.z * (u - 0.5) * 120, cp[1] - 6 + 8 * hash(i, 3, 310), cp[2] + fwd.z * 70 - fwd.x * (u - 0.5) * 120, 26, 14, i + 310, 0.2 * Math.sin(u * 3.14), 8, 0, 0.1, hash(i, 2, 310) * 6);
    }
  }

  // ------------------------------------------------ s18: four necks rising from a boiling sea
  const LURES = [0, 1, 2, 3];
  function lureAt(st, i, v) {
    if (levAnchor(`lure${i}`, v)) return v;
    const p = ahead(st, 1100, -300 + i * 200);
    return v.set(p.x, 0, p.z);
  }
  // the column of water round each neck: strands that start under the whale's jaw and thicken downward
  function lureColumn(i, x, z, top, seed, k) {
    if (top < 40) return;
    const nS = Math.round(7 * k);
    for (let m = 0; m < nS; m++) {
      const az = hash(i, m, 410) * 6.28, rr = 7 + 15 * hash(i, m, 413);
      tmp2.set(x + Math.cos(az) * rr, top * (0.28 + 0.46 * hash(i, m, 411)), z + Math.sin(az) * rr);
      pour(tmp2, 6 + 10 * hash(i, m, 412), seed + i * 5 + m, 86, 0.62 + 0.2 * hash(i, m, 414), 0.03 * m);
    }
  }
  function s18(st) {
    const tq = I.tq;
    const a = tq - c.lures;
    for (const i of LURES) {
      lureAt(st, i, tmp);
      const x = tmp.x, z = tmp.z, top = tmp.y;
      const t0 = c.lures + i * 0.16;
      breachRing(x, z, 26, 190, t0, 400 + i * 19, { n: 16, k: 8, per: 0.5, pulses: 5, w: 10, moundN: 34, collarN: 34, mistN: 6, g: 20, spread: 0.36, mist: 0.3 });
      lureColumn(i, x, z, top, 410, 1);
    }
    // the whole patch of sea is on the boil, but the foreground stays sea
    const p = ahead(st, 1140, 0);
    const k = smooth(a / 1.4);
    E.boil(p.x, p.z, 520, 420, k, 0.5 + 0.5 * k);
    E.mistCloud({ x: p.x, z: p.z, t0: c.lures, n: 14, seed: 421, R: 420, H: 110, w: 130, tau: 1.2, op: 0.24, soft: 60, flat: 0.5 });
    // low spitting jets between the necks
    fountain({ x: p.x, z: p.z, from: c.lures + 0.3, per: 0.4, keep: 4, n: 12, k: 5, seed: 430, H: 80, g: 20, T: 0.5, spread: 0.6, R0: 150, w: 8, Hmin: 0.3, massR: 300, tone: 0.1, shedN: 2 });
  }

  // ------------------------------------------------ s19: the maw rises
  // The creature is the picture. The white stays in the bottom of the frame; on the mouth itself the
  // water runs in tongues down the throat and hangs in strands off the jaw.
  function s19(st) {
    const tq = I.tq;
    const ch = bodyChain(st.t);
    let cross = -1;
    for (let i = 0; i < CH - 1; i++) if (ch[i].y > 0 && ch[i + 1].y <= 0) { cross = i; break; }
    if (cross < 0) { levAnchor('head', sA) || sA.copy(ahead(st, 700)); crossing.copy(sA).setY(0); }
    else { const f = clamp(ch[cross].y / Math.max(ch[cross].y - ch[cross + 1].y, 1e-3)); crossing.lerpVectors(ch[cross], ch[cross + 1], f).setY(0); }
    const hx = crossing.x, hz = crossing.z;
    const R = 165;
    breachRing(hx, hz, R, 150, c.mawRises - 0.2, 500, { n: 26, k: 8, per: 0.5, pulses: 5, w: 13, g: 30, spread: 0.55, moundN: 40, collarN: 70, mistN: 6, mist: 0.24, collarDur: 8 });
    // the lures are still standing in the first half of the shot
    for (const i of LURES) {
      lureAt(st, i, tmp);
      if (tmp.y > 60) lureColumn(i, tmp.x, tmp.z, tmp.y, 460, 1 - smooth((tq - 34.2) / 0.6));
    }
    const L0 = LB.L ?? ctx.leviathan?.L ?? 900;
    const sinceUp = smooth((tq - c.mawRises + 0.2) / 0.9);
    // tongues running down the throat, from the jaw to the sea
    const nT = 30;
    for (let i = 0; i < nT; i++) {
      const h = hash(i, 1, 510);
      const phi = -Math.PI / 2 + (i / (nT - 1) - 0.5) * 2.9;
      const z0 = L0 * (0.94 - 0.2 * h);
      const z1 = z0 - L0 * (0.2 + 0.2 * hash(i, 2, 510)) * sinceUp - 8;
      runOff({ z0, z1, phi, drift: 0.16 * (hash(i, 4, 510) - 0.5), hw: 8 + 20 * hash(i, 3, 510), seed: 510 + i, flow: 120, tear: 0.4 + 0.34 * hash(i, 5, 510), tone: 0.02 + 0.16 * hash(i, 6, 510) });
    }
    // strands falling free off the chin and the corners of the mouth
    if (hide(L0 * 0.9, -Math.PI / 2, 0, sA, 1)) {
      const nF = 12;
      for (let i = 0; i < nF; i++) {
        const u = (i + 0.5) / nF - 0.5;
        hide(L0 * (0.8 + 0.14 * hash(i, 1, 520)), -Math.PI / 2 + u * 2.6, 8, tmp2, 1);
        if (tmp2.y > 30) pour(tmp2, 7 + 12 * hash(i, 2, 520), 520 + i, 90, 0.66, 0.04);
      }
    }
  }

  // ------------------------------------------------ s20–21: the breach, one long camera
  const crossing = new V3();
  function s20(st) {
    const t = st.t, tq = I.tq;
    const ch = bodyChain(tq);
    const a = tq - c.breach;
    // where the body cuts the surface: the crown lives there and slides along as it rises
    let cross = -1;
    for (let i = 0; i < CH - 1; i++) if (ch[i].y > 0 && ch[i + 1].y <= 0) { cross = i; break; }
    if (cross < 0) cross = ch[CH - 1].y > 0 ? CH - 2 : 0;
    const A = ch[cross], Bp = ch[cross + 1];
    const f = clamp(A.y / Math.max(A.y - Bp.y, 1e-3));
    crossing.lerpVectors(A, Bp, f).setY(0);
    const Rb = lerp(chainR[cross], chainR[cross + 1], f);
    const x0 = ctx.splash?._bx ?? crossing.x;
    void x0;
    const heavy = 1 - smooth(invLerp(c.breachTop + 0.5, c.breachTop + 2.8, tq));
    // the crown: the first eruption is the tallest
    E.jets({ x: crossing.x, z: crossing.z, t0: c.breach, n: 80, k: 11, seed: 600, H: 460, g: 26, T: 1.6, spread: 0.5, polP: 0.7, R0: Rb * 0.8, w: 26, Hmin: 0.25, massR: 240, massYk: 0.3, tone: 0.06, shedN: 3, lenT: 0.22 });
    fountain({ x: crossing.x, z: crossing.z, from: c.breach + 0.8, to: c.breach + 6.2, per: 0.5, keep: 6, n: 16 + Math.round(10 * heavy), k: 9, seed: 610, H: 260 * (0.5 + 0.5 * heavy), g: 22, T: 1.0, spread: 0.5, polP: 0.7, R0: Rb * 0.85, w: 18, Hmin: 0.3, massR: 200, tone: 0.1, shedN: 2 });
    const gk = 1 - Math.exp(-a / 0.8);
    E.mound({ x: crossing.x, z: crossing.z, t0: c.breach, seed: 620, n: 90, R: (Rb * 1.5 + 60) * gk, H: 140 * gk * (0.45 + 0.55 * heavy), w: 42, tone: 0.2, yP: 1.7, taper: 0.45 });
    E.collar({ x: crossing.x, z: crossing.z, t0: c.breach, seed: 621, n: 80, R: 620, R0: Rb * 0.6, tau: 1.6, w: 38, H: 34, dur: 8 });
    E.boil(crossing.x, crossing.z, 700, 622, 1, 0.3 + 0.7 * gk);
    E.ring(crossing.x, crossing.z, 80 + a * 70, 623, Math.exp(-a * 0.2));
    for (let i = 0; i < 4; i++) B.ripples.add(tq, crossing.x, crossing.z, c.breach + i * 0.7, 2.6 - i * 0.3, 70, 24, 0.22, 1, 2);
    E.mistCloud({ x: crossing.x, z: crossing.z, t0: c.breach, n: 22, seed: 624, R: 420, H: 260, w: 210, tau: 1.4, op: 0.5, soft: 80, hard: 0.15 });
    // tongues running back along the body while it is still climbing
    const L0 = LB.L ?? ctx.leviathan?.L ?? 900;
    const onBody = 1 - smooth(invLerp(c.breach + 3.4, c.breach + 5.4, tq));
    if (onBody > 0) {
      const nR = Math.round(26 * onBody);
      for (let i = 0; i < nR; i++) {
        const z0 = L0 * (0.97 - 0.5 * hash(i, 1, 630));
        const phi = hash(i, 2, 630) * 6.283;
        runOff({ z0, z1: z0 - L0 * (0.12 + 0.2 * hash(i, 3, 630)), phi, drift: 0.2, hw: 6 + 15 * hash(i, 4, 630), seed: 630 + i, flow: 110, tear: 0.5, tone: 0.03 + 0.14 * hash(i, 5, 630), off: 6 });
      }
    }
    // sheets pour off the whole airborne body; the heaviest falls hang from the flanks and the flipper
    const nS = 70;
    const cam = st.cam.pos;
    tmp.set(cam[0] - crossing.x, 0, cam[2] - crossing.z).normalize();
    for (let i = 0; i < nS; i++) {
      const u = (i + hash(i, 1, 640)) / nS;
      const s = u * (CH - 1), j = Math.floor(s);
      if (j >= CH - 1) continue;
      tmp2.lerpVectors(ch[j], ch[j + 1], s - j);
      if (tmp2.y < 25) continue;
      const r = lerp(chainR[j], chainR[j + 1], s - j);
      // water thins out the longer it has been in the air
      const up = tq - (c.breach + (1 - u) * 1.4);
      const wet = Math.exp(-Math.max(up, 0) * 0.32);
      if (hash(i, 2, 640) > wet + 0.15) continue;
      const az = (hash(i, 3, 640) - 0.5) * 2.4;
      const ox = Math.cos(az) * tmp.x - Math.sin(az) * tmp.z, oz = Math.sin(az) * tmp.x + Math.cos(az) * tmp.z;
      tmp2.x += ox * r * 0.8; tmp2.z += oz * r * 0.8; tmp2.y -= r * 0.45;
      pour(tmp2, 9 + 24 * Math.pow(hash(i, 4, 640), 2) * wet, 640 + i, 95, 0.66 + 0.2 * (1 - wet), 0.03 + 0.14 * hash(i, 7, 640), null, 0.3 + 0.38 * hash(i, 8, 640));
    }
    // a veil of drops hangs under the arc
    for (let i = 0; i < 90; i++) {
      const u = hash(i, 1, 660) * (CH - 1), j = Math.floor(u);
      if (j >= CH - 1) continue;
      tmp2.lerpVectors(ch[j], ch[j + 1], u - j);
      const per = 1.1 + hash(i, 2, 660);
      const ph = (tq / per + hash(i, 3, 660)) % 1;
      const yy = tmp2.y * (1 - ph) - 8;
      if (yy < 3 || tmp2.y < 40) continue;
      B.puffs.push(tmp2.x + (hash(i, 4, 660) - 0.5) * 170, yy, tmp2.z + (hash(i, 5, 660) - 0.5) * 170, 2.0 + 3.2 * hash(i, 6, 660), 12, 0.2, 0.05, 0, -1, 0, i % 89, 0, 0, KIND.DROP, PAL.WATER, ID.DROP);
    }
    void t;
  }

  // ------------------------------------------------ s24: spray fog, the back sinking through it
  // Reference: everything but the tail stock and the flukes is lost in spray. The horizon goes, the
  // banks stand at both sides and behind; the picture stays open down the middle where the body is.
  function s24(st) {
    const tq = I.tq;
    const cp = st.cam.pos;
    fwd.set(st.cam.look[0] - cp[0], 0, st.cam.look[2] - cp[2]).normalize();
    const sideX = fwd.z, sideZ = -fwd.x;
    const place = (d, w, out) => out.set(cp[0] + fwd.x * d + sideX * w, 0, cp[2] + fwd.z * d + sideZ * w);
    // far bank: wipes out the horizon behind the flukes
    for (let i = 0; i < 26; i++) {
      const u = ((i + 0.5) / 26 + tq * 0.009 + hash(i, 1, 700) * 0.05) % 1;
      const d = 1500 + 500 * hash(i, 2, 700);
      place(d, (u - 0.5) * 3000, tmp);
      const sz = 380 + 240 * hash(i, 3, 700);
      E.mist(tmp.x, 60 + 420 * hash(i, 4, 700), tmp.z, sz, sz * 0.7, i + 700, 0.74, 140, 0.05 + 0.2 * hash(i, 5, 700), 0.3, hash(i, 6, 700) * 6.28);
    }
    // side banks, drawn with some edge, rolling slowly inward
    for (let sd = -1; sd <= 1; sd += 2) {
      for (let i = 0; i < 16; i++) {
        const h1 = hash(i, sd + 2, 710), h2 = hash(i, sd + 2, 711), h3 = hash(i, sd + 2, 712);
        const d = 520 + 800 * h1;
        const w = sd * (d * 0.4 + d * 0.5 * h2);
        place(d, w, tmp);
        const sz = (120 + 130 * h3) * (0.5 + d / 1300);
        E.mist(tmp.x + sd * 8 * tq, 30 + (90 + 320 * h2) * (d / 1300), tmp.z, sz, sz * 0.72, i + 720 + sd, 0.56, 80, 0.04 + 0.16 * h3, 0.42, h1 * 6.28);
      }
    }
    // low spray lying across the sea, hiding where the body goes in
    for (let i = 0; i < 20; i++) {
      const u = (i + 0.5) / 20;
      const d = 180 + 620 * hash(i, 1, 730);
      place(d, (u - 0.5) * 2 * (d * 0.7 + 200), tmp);
      const sz = 90 + 120 * hash(i, 2, 730);
      E.mist(tmp.x, 6 + 24 * hash(i, 3, 730), tmp.z, sz, sz * 0.34, i + 730, 0.36, 50, 0.1 * hash(i, 4, 730), 0.34, hash(i, 5, 730) * 6.28);
    }
    // the sea under the fog is all white water
    for (let i = 0; i < 18; i++) {
      const d = 260 + 900 * hash(i, 1, 740);
      place(d, (hash(i, 2, 740) - 0.5) * d * 1.9, tmp);
      E.boil(tmp.x, tmp.z, 150 + 200 * hash(i, 3, 740), 740 + i, 1, 1);
    }
    // the body shedding water as it goes under
    const ch = bodyChain(tq);
    let cross = -1;
    for (let i = 0; i < CH - 1; i++) if (ch[i].y * ch[i + 1].y <= 0) { cross = i; break; }
    if (cross >= 0) {
      const f = clamp(ch[cross].y / Math.max(ch[cross].y - ch[cross + 1].y, 1e-3));
      crossing.lerpVectors(ch[cross], ch[cross + 1], f).setY(0);
      breachRing(crossing.x, crossing.z, 90, 150, 49.0, 750, { n: 18, k: 7, per: 0.5, pulses: 8, w: 13, g: 26, spread: 0.5, moundN: 40, collarN: 50, mistN: 8, mist: 0.34 });
    }
    const L0 = LB.L ?? 900;
    for (let i = 0; i < 26; i++) {
      const z0 = L0 * (0.02 + 0.3 * hash(i, 1, 760));
      const phi = hash(i, 2, 760) * 6.283;
      runOff({ z0: z0 + 110, z1: z0 - 60, phi, drift: 0.3, hw: 4 + 9 * hash(i, 3, 760), seed: 760 + i, flow: 100, tear: 0.55, tone: 0.02 + 0.14 * hash(i, 4, 760), off: 3 });
    }
    for (let i = 0; i < 18; i++) {
      const u = i / 17 * (CH - 1), j = Math.min(Math.floor(u), CH - 2);
      tmp2.lerpVectors(ch[j], ch[j + 1], u - j);
      tmp2.x += (hash(i, 2, 770) - 0.5) * 50; tmp2.z += (hash(i, 3, 770) - 0.5) * 40;
      if (tmp2.y > 40) pour(tmp2, 4 + 8 * hash(i, 1, 770), 770 + i, 80, 0.8, 0.05);
    }
    // flukes: long strands off the trailing edge
    const Fk = ctx.leviathan?.fluke;
    if (Fk?.at) {
      for (let i = 0; i < 12; i++) {
        Fk.at(hash(i, 1, 780) * 0.8 + 0.2, tmp2);
        tmp2.x += (hash(i, 2, 780) - 0.5) * 150; tmp2.y -= 8;
        if (tmp2.y > 40) pour(tmp2, 3.5 + 6 * hash(i, 3, 780), 780 + i, 90, 0.84, 0.06);
      }
    }
  }

  return { shots: { s09, s15, s16, s18, s19, s20, s21: s20, s24 }, bodyChain, breachRing, fountain, pour, chain, chainR, hide, runOff };
}
void lerp;
