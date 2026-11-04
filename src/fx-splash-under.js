import * as THREE from 'three';
import { celMaterial } from './materials.js';
import { hash, ID, KIND, PAL } from './fx-splash-core.js';
import { clamp, smooth, invLerp, lerp, Rng } from './util.js';

const V3 = THREE.Vector3;

// Underwater FX: bubbles, silt clouds and rock debris for s31–s37. Luminous cyan, never murk.
export function createUnderShots(ctx, B, E) {
  const c = ctx.CUES;
  const I = E.I;
  const tmp = new V3(), tmp2 = new V3(), fwd = new V3();

  // ------------------------------------------------ chunky drawn boulders
  const grp = new THREE.Group();
  grp.visible = false;
  grp.userData.noShadow = true;
  ctx.scene.add(grp);
  const rockGeos = [];
  {
    const rng = new Rng(77);
    for (let g = 0; g < 4; g++) {
      const geo = new THREE.IcosahedronGeometry(1, 2);
      const pos = geo.getAttribute('position');
      const seen = new Map();
      const a = rng.range(2, 4), b = rng.range(2, 5);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
        let k = seen.get(key);
        if (k === undefined) {
          // hard facets: a few planes shaved off the ball
          k = 1 + 0.32 * Math.sin(x * a + g) * Math.cos(y * b + 1.2 * g) + 0.22 * Math.sin(z * (a + b) + g * 2) - 0.2 * Math.max(0, x * Math.sin(g) + y * Math.cos(g) - 0.2);
          seen.set(key, k);
        }
        pos.setXYZ(i, x * k * (g % 2 ? 1.2 : 0.95), y * k * (g % 3 ? 0.82 : 1.05), z * k);
      }
      const flat = geo.index ? geo.toNonIndexed() : geo;
      flat.computeVertexNormals();
      rockGeos.push(flat);
    }
  }
  const rockMats = [
    celMaterial({ color: '#7b8f8a', dark: '#3d5563', id: 90, weather: [0, 0, 0, 0], gloss: 0 }),
    celMaterial({ color: '#667f80', dark: '#34505f', id: 92, weather: [0, 0, 0, 0], gloss: 0 }),
    celMaterial({ color: '#8d9b8e', dark: '#44606a', id: 94, weather: [0, 0, 0, 0], gloss: 0 }),
  ];
  const ROCKS = 46;
  const rocks = [];
  for (let i = 0; i < ROCKS; i++) {
    const m = new THREE.Mesh(rockGeos[i % 4], rockMats[i % 3]);
    m.userData.noShadow = true;
    m.visible = false;
    grp.add(m);
    rocks.push(m);
  }

  function burstRocks(st, o) {
    grp.visible = true;
    const a = I.t - o.t0;   // boulders are on twos of the film clock: they read as solid things
    let used = o.first ?? 0;
    for (let i = 0; i < o.n; i++) {
      const m = rocks[used++];
      if (!m) break;
      const del = hash(i, o.seed, 1) * 0.15;
      const ag = Math.max(a - del, 0);
      if (a < del) { m.visible = false; continue; }
      const az = hash(i, o.seed, 2) * 6.28, pol = (o.spread ?? 1.0) * Math.sqrt(hash(i, o.seed, 3));
      const V = o.V * (0.35 + 0.75 * hash(i, o.seed, 4));
      const dr = 1.4;                                  // water drag
      const s = (V / dr) * (1 - Math.exp(-dr * ag));
      const sp = Math.sin(pol), cp = Math.cos(pol);
      m.position.set(o.x + sp * Math.cos(az) * s, o.y + cp * s - 0.5 * (o.g ?? 4) * ag * ag, o.z + sp * Math.sin(az) * s);
      const r = o.r * (0.3 + 1.1 * Math.pow(hash(i, o.seed, 5), 2.2));
      m.scale.set(r, r, r);
      m.rotation.set(hash(i, o.seed, 6) * 6 + ag * (hash(i, o.seed, 7) - 0.5) * 2.4, hash(i, o.seed, 8) * 6 + ag * (hash(i, o.seed, 9) - 0.5) * 2.4, hash(i, o.seed, 10) * 6);
      m.visible = true;
    }
    return used;
  }

  // ------------------------------------------------ bubbles
  function bubbles(o) {
    const tq = I.tq;
    for (let i = 0; i < o.n; i++) {
      const per = (o.per ?? 2) * (0.7 + 0.6 * hash(i, o.seed, 11));
      const ph = (tq / per + hash(i, o.seed, 12)) % 1;
      const u = hash(i, o.seed, 13), az = hash(i, o.seed, 14) * 6.28;
      const rr = o.R * Math.sqrt(u) * (1 + ph * 0.4);
      const y = o.y + (o.H ?? 40) * ph;
      const wig = Math.sin(tq * 4 + i) * (o.R * 0.03);
      const r = (o.r ?? 1) * (0.35 + 1.0 * Math.pow(hash(i, o.seed, 15), 2.4)) * smooth(ph / 0.08) * (1 - smooth((ph - 0.9) / 0.1));
      if (r < 0.01) continue;
      B.puffs.push(o.x + Math.cos(az) * rr + wig, y, o.z + Math.sin(az) * rr, r, 0, 1, 0, 0, 1, 0, i % 89, 0, 0, KIND.BUBBLE, PAL.UNDERWATER, ID.BUBBLE);
    }
  }
  // a burst of churned water: pale billows swelling from a point
  function churn(o) {
    const a = I.tq - o.t0;
    if (a < 0) return;
    const n = o.n ?? 40;
    for (let i = 0; i < n; i++) {
      const del = hash(i, o.seed, 21) * (o.delay ?? 0.3);
      const ag = a - del;
      if (ag <= 0) continue;
      const az = hash(i, o.seed, 22) * 6.28, pol = Math.acos(1 - 2 * hash(i, o.seed, 23) * (o.cap ?? 0.5));
      const s = o.R * (0.25 + 0.75 * hash(i, o.seed, 24)) * (1 - Math.exp(-ag / (o.tau ?? 0.9)));
      const px = o.x + Math.sin(pol) * Math.cos(az) * s, py = o.y + Math.cos(pol) * s * (o.up ?? 1), pz = o.z + Math.sin(pol) * Math.sin(az) * s;
      const r = o.w * (0.45 + 0.8 * hash(i, o.seed, 25)) * (0.5 + 0.7 * (1 - Math.exp(-ag / 0.8)));
      const fade = clamp(invLerp((o.dur ?? 5) * 0.5, o.dur ?? 5, ag));
      if (fade >= 0.99) continue;
      const tn = E.massTone(px, py, pz, o.x, o.y + o.R * 0.3, o.z, o.R, o.tone ?? 0.02);
      B.puffs.push(px, py, pz, r, 0, 1, 0.55, 0, 1, 0, (i * 3.1 + o.seed) % 97, tn, fade, KIND.PUFF, o.pal ?? PAL.SILT, o.id ?? ID.SILT);
    }
  }

  const levA = (n, v) => { const L = ctx.leviathan; if (!L?.anchor) return null; try { const r = L.anchor(n, v); return r === undefined ? v : r; } catch { return null; } };
  function spot(st, d = 200, up = 0) {
    const cam = st.cam;
    fwd.set(cam.look[0] - cam.pos[0], cam.look[1] - cam.pos[1], cam.look[2] - cam.pos[2]).normalize();
    return tmp.set(cam.pos[0] + fwd.x * d, cam.pos[1] + fwd.y * d + up, cam.pos[2] + fwd.z * d);
  }

  // arrow in the back: a cone of churned water and a shaft of bubbles behind the arrow
  function s31(st) {
    const P = (ctx.under?.pierce ?? null) || (levA('back', tmp2) ? tmp2 : spot(st, 280));
    const x = P.x, y = P.y, z = P.z;
    churn({ x, y, z, t0: c.pierce, seed: 31, n: 70, R: 130, w: 30, tau: 0.7, cap: 0.5, pal: PAL.UNDERWATER, id: ID.MASS, dur: 3.5, tone: 0.0 });
    bubbles({ x, y: y + 30, z, n: 90, R: 32, H: 340, per: 2.0, r: 3.4, seed: 32 });
    if (I.tq > c.pierce) bubbles({ x, y: y - 40, z, n: 60, R: 150, H: 180, per: 2.6, r: 2.2, seed: 33 });
    churn({ x, y: y - 10, z, t0: c.pierce + 0.15, seed: 34, n: 26, R: 240, w: 22, tau: 0.7, cap: 1, pal: PAL.SILT, dur: 3 });
  }
  function s32(st) {
    const p = levA('clawL', tmp2) ? tmp2 : spot(st, 120, -30);
    churn({ x: p.x, y: p.y - 6, z: p.z, t0: 65.23, seed: 41, n: 48, R: 90, w: 20, tau: 0.8, cap: 0.5, up: 0.6, dur: 6, tone: 0.06 });
    bubbles({ x: p.x, y: p.y, z: p.z, n: 40, R: 60, H: 90, per: 1.8, r: 1.6, seed: 42 });
  }
  function s33(st) {
    const p = spot(st, 900, -120);
    bubbles({ x: p.x, y: p.y, z: p.z, n: 60, R: 500, H: 260, per: 3.2, r: 2.6, seed: 43 });
  }
  function s34(st) {
    const p = levA('belly', tmp2) ? tmp2 : spot(st, 120, -40);
    churn({ x: p.x, y: p.y - 8, z: p.z, t0: 68.17, seed: 44, n: 60, R: 160, w: 28, tau: 0.9, cap: 0.42, up: 0.5, dur: 7, tone: 0.08 });
  }
  function s35(st) {
    const p = ctx.under?.tip ?? (levA('belly', tmp2) ? tmp2 : spot(st, 90, -20));
    const x = p.x, y = p.y, z = p.z;
    const t0 = c.tipOut;
    churn({ x, y, z, t0, seed: 45, n: 44, R: 44, w: 7, tau: 0.35, cap: 1, dur: 3, tone: 0.0 });
    bubbles({ x, y, z, n: 60, R: 22, H: 70, per: 1.3, r: 1.1, seed: 46 });
    burstRocks(st, { x, y, z, t0, n: 12, seed: 47, V: 60, r: 2.4, spread: 1.4 });
  }
  function s36(st) {
    const p = ctx.under?.mound ?? spot(st, 180, -30);
    const x = p.x, y = p.y, z = p.z;
    const t0 = c.rockBurst;
    burstRocks(st, { x, y, z, t0, n: 44, seed: 48, V: 110, r: 11, spread: 0.95 });
    churn({ x, y, z, t0, seed: 49, n: 110, R: 210, w: 40, tau: 0.8, cap: 0.5, pal: PAL.DUST, dur: 6, tone: 0.1, id: ID.MASS });
    churn({ x, y: y + 20, z, t0: t0 + 0.1, seed: 50, n: 40, R: 300, w: 22, tau: 0.8, cap: 0.5, pal: PAL.SILT, dur: 5 });
    bubbles({ x, y: y + 10, z, n: 60, R: 150, H: 200, per: 2.2, r: 2.4, seed: 51 });
  }

  return {
    shots: { s31, s32, s33, s34, s35, s36 },
    begin() { grp.visible = false; for (const m of rocks) m.visible = false; },
  };
}
void lerp;
