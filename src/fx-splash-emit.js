import * as THREE from 'three';
import { hash, hr, ID, KIND, PAL } from './fx-splash-core.js';
import { clamp, smooth, invLerp } from './util.js';

// Stateless emitters: every particle is a closed-form function of (drawing time - birth).
export function createEmit(B) {
  const I = { t: 0, tq: 0, draw: 0, cam: null, camPos: new THREE.Vector3(), L: new THREE.Vector3(), pxm: () => 1 };
  const v = new THREE.Vector3(), w = new THREE.Vector3();

  // shade comes from the whole mass first: puffs on the far side of the light are drawn in shade
  function massTone(x, y, z, cx, cy, cz, R, base = 0) {
    const L = I.L;
    const d = ((x - cx) * L.x + (y - cy) * L.y + (z - cz) * L.z) / R;
    return base - d * 0.6;
  }

  // view depth of a mass: its puffs all write this to the ink buffer, so the ink pass draws the
  // outline of the mass and of its big shapes, never a ring round each billow
  function inkZ(x, y, z) {
    const m = I.cam.matrixWorldInverse.elements;
    return Math.max(-(m[2] * x + m[6] * y + m[10] * z + m[14]), 0.5);
  }
  const JET_IDS = [ID.MASS, ID.MASS2, ID.TONGUE];

  // ---- one continuous jet thrown from a point: water leaves during [0, T] and flies
  // ballistically, so the column stretches, its tail lifts off the sea and the whole thing
  // falls apart by itself. A fan of jets makes a splash; each jet is a chain of billows
  // that thin out to a pointed tongue at the head.
  function jets(o) {
    const a = I.tq - o.t0;
    if (a < 0) return;
    const n = o.n, K = o.k ?? 9, seed = o.seed ?? 1;
    const T = o.T ?? 1.0, g = o.g ?? 9.8, H = o.H;
    const cx = o.x, cy = o.y ?? 0, cz = o.z;
    const spread = o.spread ?? 0.9;
    const life = o.life ?? 1e9;
    const pal = o.pal ?? PAL.WATER;
    const massR = o.massR ?? H * 0.5, massY = cy + H * (o.massYk ?? 0.35);
    const az0 = o.az ?? 0, azS = o.azSpread ?? 1;     // full circle by default
    const tiltX = o.tiltX ?? 0, tiltZ = o.tiltZ ?? 0;
    const rw = o.w ?? H * 0.09;
    const flatInk = o.flatInk ?? true;
    B.puffs.inkZ = flatInk ? inkZ(cx, cy + H * 0.3, cz) : 0;
    for (let j = 0; j < n; j++) {
      const idJ = o.id ?? JET_IDS[(j + seed) % 3];
      const h1 = hash(j, seed, 1), h2 = hash(j, seed, 2), h3 = hash(j, seed, 3), h4 = hash(j, seed, 4);
      const pol = spread * Math.pow(h2, o.polP ?? 0.75);
      const az = az0 + (h1 - 0.5) * Math.PI * 2 * azS;
      const sp = Math.sin(pol), cp = Math.cos(pol);
      const Hj = H * (o.Hmin ?? 0.3) + H * (1 - (o.Hmin ?? 0.3)) * Math.pow(h3, 1.5) * (1 - 0.5 * pol / Math.max(spread, 0.01));
      const V = Math.sqrt(2 * g * Hj) / Math.max(cp, 0.3);
      const delay = h4 * (o.delay ?? 0.18) * T;
      const tJ = a - delay;
      if (tJ <= 0) continue;
      const dx = sp * Math.cos(az) + tiltX, dy = cp, dz = sp * Math.sin(az) + tiltZ;
      const x0 = cx + (o.R0 ?? 0) * Math.cos(az), z0 = cz + (o.R0 ?? 0) * Math.sin(az);
      const tApex = V * cp / g;
      const KK = Math.max(3, Math.round(K * (0.55 + 0.45 * Hj / H)));
      for (let k = 0; k < KK; k++) {
        const f = k / (KK - 1);         // 0 = the head of the jet, 1 = the root
        const tau = Math.min(tJ, T) * Math.pow(f, 1.25);
        const age = tJ - tau;
        if (age > life) continue;
        const Vk = V * (1 - 0.55 * tau / T);
        const s = Vk * age;
        const px = x0 + dx * s, pz = z0 + dz * s;
        const py = cy + dy * s - 0.5 * g * age * age;
        if (py < cy - rw * 0.5) continue;
        const vy = dy * Vk - g * age;
        const vh = Vk * sp;
        const sp2 = Math.hypot(vy, vh);
        const fall = clamp((age - tApex) / (o.fallT ?? tApex * 1.2 + 0.01));
        const prof = (0.26 + 0.74 * Math.pow(Math.sin(Math.PI * Math.min(f * 1.15 + 0.06, 1)), 0.7)) * (0.72 + 0.56 * hash(j, k, seed + 5));
        const r = rw * prof * (0.8 + 0.5 * clamp(age * (o.grow ?? 0.5))) * (1 - 0.3 * fall) * (Hj / H * 0.7 + 0.5);
        const isHead = k === 0;
        const stretch = (o.stretch ?? 0.9) * r * (isHead ? 3.2 : 1.5);
        const len = clamp(sp2 * (o.lenT ?? 0.16), 0, stretch * 1.4);
        const kind = isHead ? KIND.TONGUE : KIND.PUFF;
        const tn = massTone(px, py, pz, cx, massY, cz, massR, o.tone ?? 0) + (f - 0.4) * 0.1;
        const fade = clamp(fall * fall * 1.1 + (o.fade ?? 0));
        if (fade >= 0.99) continue;
        const dl = Math.max(sp2, 1e-3);
        B.puffs.push(px, py, pz, r, len, isHead ? 0.16 : 0.55, isHead ? 0.28 : 0.42, vh * Math.cos(az) / dl, vy / dl, vh * Math.sin(az) / dl,
          (j * 13.1 + k * 3.7 + seed) % 97, tn, fade, kind, pal, idJ);
        // loose drops shed by the head
        if (k < 2 && (o.shed ?? 1) > 0) {
          const nD = o.shedN ?? 2;
          for (let q = 0; q < nD; q++) {
            const ag = age * (0.72 + 0.34 * hash(j, q, seed + 7));
            const ox = (hash(j, q, seed + 8) - 0.5) * rw * 4.6, oz = (hash(j, q, seed + 9) - 0.5) * rw * 4.6, oy = (hash(j, q, seed + 10) - 0.3) * rw * 4.2;
            const yy = cy + dy * V * ag * 1.04 - 0.5 * g * ag * ag + oy;
            if (yy < cy) continue;
            const dr = Math.max(r * (0.025 + 0.075 * Math.pow(hash(j, q, seed + 11), 2.2)), 1.3 / I.pxm(I.camPos.distanceTo(v.set(x0, cy, z0))));
            const vyD = dy * V - g * ag;
            const ld = Math.min(Math.abs(vyD) * 0.05, dr * 4);
            B.puffs.push(x0 + dx * V * ag * 1.08 + ox, yy, z0 + dz * V * ag * 1.08 + oz, dr, ld, 0.25, 0.05, 0, Math.sign(vyD) || 1, 0,
              (j * 7.7 + q) % 89, 0.0, 0, KIND.DROP, pal, ID.DROP);
          }
        }
      }
    }
    B.puffs.inkZ = 0;
  }

  // ---- the base surge: low fat tongues running outward over the water, not a row of sheep
  function collar(o) {
    const a = I.tq - o.t0;
    if (a < 0) return;
    const seed = o.seed ?? 3, n = Math.round((o.n ?? 40) * 1.5);
    const Tau = o.tau ?? 1.2, R = o.R, rw = (o.w ?? R * 0.16) * 0.62, H = o.H ?? rw;
    const dur = o.dur ?? 1e9;
    B.puffs.inkZ = inkZ(o.x, o.y ?? 0, o.z);
    for (let i = 0; i < n; i++) {
      const az = (o.az ?? 0) + (hash(i, seed, 21) - 0.5) * Math.PI * 2 * (o.azSpread ?? 1);
      const rk = 0.4 + 0.6 * hash(i, seed, 22);
      const del = hash(i, seed, 23) * 0.3;
      const ag = a - del;
      if (ag <= 0) continue;
      const gr = 1 - Math.exp(-ag / Tau);
      const rad = R * rk * gr + (o.R0 ?? 0);
      const px = o.x + Math.cos(az) * rad, pz = o.z + Math.sin(az) * rad;
      // low at the running edge, heaped toward the source
      const hk = (1 - rk) * 0.8 + 0.35 * hash(i, seed, 24);
      const py = (o.y ?? 0) + H * hk * gr;
      const r = rw * (0.5 + 0.7 * hash(i, seed, 25)) * (0.55 + 0.6 * gr) * (1.15 - 0.5 * rk);
      const fade = clamp(invLerp(dur * 0.55, dur, ag + hash(i, seed, 26) * dur * 0.2));
      if (fade >= 0.99) continue;
      const tn = massTone(px, py, pz, o.x, (o.y ?? 0) + H * 0.7, o.z, R * 0.8, o.tone ?? 0.16) + 0.14 * hash(i, seed, 27);
      const len = r * (2.2 + 3.2 * hash(i, seed, 28));
      const dy = 0.1 + 0.16 * (1 - rk);
      B.puffs.push(px, py, pz, r, len, 0.34, 0.5, Math.cos(az), dy, Math.sin(az), (i * 5.3 + seed) % 97, tn, fade, KIND.TONGUE, o.pal ?? PAL.WATER, o.id ?? (i % 5 ? ID.MASS2 : ID.MASS));
    }
    B.puffs.inkZ = 0;
  }

  // ---- a held body of billows: the mass inside a plume, churning from drawing to drawing
  function mound(o) {
    const a = I.tq - (o.t0 ?? -1e6);
    if (a < 0) return;
    const seed = o.seed ?? 5, n = o.n ?? 40;
    const grow = o.grow ?? 1;
    B.puffs.inkZ = inkZ(o.x, (o.y ?? 0) + o.H * 0.4, o.z);
    for (let i = 0; i < n; i++) {
      const u = hash(i, seed, 31), az = hash(i, seed, 32) * Math.PI * 2, h = Math.pow(hash(i, seed, 33), o.yP ?? 1.3);
      const rr = (o.R * (1 - h * (o.taper ?? 0.8))) * Math.sqrt(u) * grow;
      const churn = Math.sin(I.draw * 0.7 + i * 1.3) * 0.04;
      const px = o.x + Math.cos(az + churn) * rr, pz = o.z + Math.sin(az + churn) * rr;
      const py = (o.y ?? 0) + h * o.H * grow;
      const r = (o.w ?? o.R * 0.3) * (0.55 + 0.7 * hash(i, seed, 34)) * grow * (1 - h * 0.45);
      const fade = clamp(o.fade ?? 0);
      const tn = massTone(px, py, pz, o.x, (o.y ?? 0) + o.H * 0.5, o.z, Math.max(o.R, o.H * 0.5), o.tone ?? 0.03);
      B.puffs.push(px, py, pz, r, 0, 1, 0.5, 0, 1, 0, (i * 3.3 + seed) % 97, tn, fade, KIND.PUFF, o.pal ?? PAL.WATER, o.id ?? ID.MASS);
    }
    B.puffs.inkZ = 0;
  }

  // ---- thrown drops, ballistic
  function drops(o) {
    const a = I.tq - o.t0;
    if (a < 0) return;
    const seed = o.seed ?? 7, n = o.n ?? 40, g = o.g ?? 9.8;
    for (let i = 0; i < n; i++) {
      const az = (o.az ?? 0) + (hash(i, seed, 41) - 0.5) * Math.PI * 2 * (o.azSpread ?? 1);
      const pol = (o.spread ?? 0.9) * Math.sqrt(hash(i, seed, 42));
      const V = (o.V ?? 40) * (0.4 + 0.75 * hash(i, seed, 43));
      const del = hash(i, seed, 44) * (o.delay ?? 0.3);
      const ag = a - del;
      if (ag <= 0) continue;
      const sp = Math.sin(pol), cp = Math.cos(pol);
      const px = o.x + V * sp * Math.cos(az) * ag;
      const pz = o.z + V * sp * Math.sin(az) * ag;
      const py = (o.y ?? 0) + V * cp * ag - 0.5 * g * ag * ag;
      if (py < 0) continue;
      const vy = V * cp - g * ag, vh = V * sp;
      const sp2 = Math.hypot(vy, vh) || 1;
      const r = (o.r ?? 2) * (0.35 + 1.0 * Math.pow(hash(i, seed, 45), 2));
      const len = Math.min(sp2 * 0.06, r * 4);
      B.puffs.push(px, py, pz, r, len, 0.22, 0.06, vh * Math.cos(az) / sp2, vy / sp2, vh * Math.sin(az) / sp2, (i * 11.3 + seed) % 89, o.tone ?? 0, 0, KIND.DROP, o.pal ?? PAL.WATER, ID.DROP);
    }
  }

  // ---- soft spray around a splash
  function mist(x, y, z, sx, sy, seed, op, soft = 30, tone = 0, hard = 0.25, rot = 0) {
    if (op <= 0.003) return;
    B.mist.push([x, y, z], [sx, sy, seed % 37, op], [soft, rot, tone, hard]);
  }
  function mistCloud(o) {
    const a = I.tq - (o.t0 ?? -1e6);
    if (a < 0) return;
    const n = o.n ?? 12, seed = o.seed ?? 9;
    const dur = o.dur ?? 1e9;
    for (let i = 0; i < n; i++) {
      const del = hash(i, seed, 51) * (o.delay ?? 0.4);
      const ag = a - del;
      if (ag <= 0 || ag > dur) continue;
      const az = hash(i, seed, 52) * Math.PI * 2, u = Math.sqrt(hash(i, seed, 53));
      const gk = 1 - Math.exp(-ag / (o.tau ?? 1.2));
      const rad = o.R * u * (0.35 + 0.65 * gk);
      const py = (o.y ?? 0) + o.H * hash(i, seed, 54) * gk;
      const sz = (o.w ?? o.R * 0.5) * (0.6 + 0.8 * hash(i, seed, 55)) * (0.55 + 0.6 * gk);
      const k = (1 - smooth(invLerp(dur * 0.5, dur, ag))) * smooth(ag / 0.25);
      mist(o.x + Math.cos(az) * rad, py, o.z + Math.sin(az) * rad, sz, sz * (o.flat ?? 0.8), i + seed, (o.op ?? 0.55) * k * 0.5, o.soft ?? 40, o.tone ?? 0, o.hard ?? 0.25, hash(i, seed, 56) * 6.28);
    }
  }

  // ---- decals
  function boil(x, z, R, seed, str = 1, grow = 1, y = 0.2) { B.decals.push([x, z, seed, y], [R * 1.2, R * 1.2, 1, seed % 41], [str, 0, grow, 0]); }
  function ring(x, z, Rnow, seed, str = 1, y = 0.2) { const hw = Rnow * 1.2 + 4; B.decals.push([x, z, 0, y], [hw, hw, 2, seed % 41], [str, 0, Rnow, 0]); }
  function wake(x, z, heading, L, W, seed, str = 1, y = 0.2) {
    // x, z = the stern; the quad extends L astern
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const cx = x - fx * L * 0.5, cz = z - fz * L * 0.5;
    const hw = W * 1.4 + L * 0.42;
    B.decals.push([cx, cz, heading, y], [hw, L * 0.5, 0, seed % 41], [str, 0, W, 0]);
  }
  function streaks(x, z, heading, hw, hl, seed, str = 1, y = 0.2) { B.decals.push([x, z, heading, y], [hw, hl, 3, seed % 41], [str, 0, 0, 0]); }

  return { I, inkZ, jets, collar, mound, drops, mist, mistCloud, boil, ring, wake, streaks, massTone, v, w };
}
