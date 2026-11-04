import * as THREE from 'three';
import { hash, ID, KIND, PAL } from './fx-splash-core.js';
import { SeaMesh } from './fx-splash-mesh.js';
import { clamp, smooth, invLerp, lerp, deg, onTwos, easeIn, easeOut } from './util.js';

const V3 = THREE.Vector3;

// The great waters: the impact plume (s30), the water mountain (s38), the crash wall (s39),
// plus the spray on the swell and falling containers (s23).
export function createBigShots(ctx, B, E, sea) {
  const c = ctx.CUES;
  const I = E.I;
  const fwd = new V3(), tmp = new V3(), tmp2 = new V3();

  function ahead(st, d, side = 0) {
    const cam = st.cam;
    fwd.set(cam.look[0] - cam.pos[0], 0, cam.look[2] - cam.pos[2]).normalize();
    return new V3(cam.pos[0] + fwd.x * d + fwd.z * side, 0, cam.pos[2] + fwd.z * d - fwd.x * side);
  }

  // ---------------------------------------------- thrown containers
  const grp = new THREE.Group();
  grp.visible = false; grp.userData.noShadow = true;
  ctx.scene.add(grp);
  const BOXES = [];
  const boxGeo = new THREE.BoxGeometry(12.2, 2.6, 2.6);
  for (let i = 0; i < 34; i++) {
    let m = null;
    try { m = ctx.ships?.makeContainer?.(i); } catch { m = null; }
    if (!m) m = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: ['#c43a2b', '#1f4fb0', '#ea7a24', '#1c9c8e', '#e8ad2e'][i % 5] }));
    m.frustumCulled = false; m.userData.noShadow = true;
    const g = new THREE.Group();
    g.add(m); g.visible = false;
    grp.add(g);
    BOXES.push(g);
  }
  let boxUsed = 0;
  function throwBoxes(o) {
    // o: x, y, z, t0, n, seed, V, spread, az, azSpread, scale, g
    grp.visible = true;
    const a = I.t - o.t0;
    for (let i = 0; i < o.n; i++) {
      const b = BOXES[boxUsed++];
      if (!b) return;
      const del = hash(i, o.seed, 1) * (o.delay ?? 0.5);
      const ag = a - del;
      if (ag <= 0) { b.visible = false; continue; }
      const az = (o.az ?? 0) + (hash(i, o.seed, 2) - 0.5) * Math.PI * 2 * (o.azSpread ?? 1);
      const pol = (o.spread ?? 0.7) * Math.sqrt(hash(i, o.seed, 3));
      const V = o.V * (0.45 + 0.7 * hash(i, o.seed, 4));
      const g = o.g ?? 16;
      const y = o.y + V * Math.cos(pol) * ag - 0.5 * g * ag * ag;
      if (y < -10) { b.visible = false; continue; }
      b.position.set(o.x + V * Math.sin(pol) * Math.cos(az) * ag + (hash(i, o.seed, 5) - 0.5) * (o.R ?? 30), y, o.z + V * Math.sin(pol) * Math.sin(az) * ag + (hash(i, o.seed, 6) - 0.5) * (o.R ?? 30));
      const sp = 1.4 + 2.0 * hash(i, o.seed, 7);
      b.rotation.set(hash(i, o.seed, 8) * 6 + sp * ag * (hash(i, o.seed, 9) - 0.5) * 2, hash(i, o.seed, 10) * 6 + sp * ag * 0.7, hash(i, o.seed, 11) * 6 + sp * ag);
      const s = o.scale ?? 2.4;
      b.scale.set(s, s, s);
      b.visible = true;
    }
  }

  // ---------------------------------------------- s30: the impact plume on the horizon
  const impact = new V3();
  function s30(st) {
    const dist = 2600;
    const P = ahead(st, dist, 0);
    impact.copy(P);
    const a = I.tq - c.impact;
    if (a < 0) return;
    const fovK = 2 * Math.tan((st.cam.fov * Math.PI) / 360);
    const H = dist * fovK * 0.72;    // tallest spire: reaches about 3/4 of the frame height
    const Tr = 2.6, g = (2 * H) / (Tr * Tr);
    // the central spire and the fan of spiky jets
    E.jets({ x: P.x, z: P.z, t0: c.impact, n: 110, k: 12, seed: 11, H, g, T: 1.5, spread: 0.62, polP: 1.0, w: H * 0.05, Hmin: 0.12, massR: H * 0.36, massYk: 0.28, stretch: 1.1, lenT: 0.25, shedN: 5, tone: 0.1 });
    E.mound({ x: P.x, z: P.z, t0: c.impact, n: 70, seed: 12, R: H * 0.3 * (1 - Math.exp(-a / 0.5)), H: H * 0.42 * (1 - Math.exp(-a / 0.8)), w: H * 0.1, tone: 0.24, yP: 1.6 });
    // base surge rolling out over the sea
    E.collar({ x: P.x, z: P.z, t0: c.impact + 0.1, n: 60, seed: 13, R: H * 0.72, tau: 1.1, w: H * 0.07, H: H * 0.07, tone: 0.14 });
    E.boil(P.x, P.z, H * 0.75, 13, 1, 1 - Math.exp(-a / 1.0));
    E.ring(P.x, P.z, a * 260 + 60, 14, Math.exp(-a * 0.5));
    B.ripples.add(I.tq, P.x, P.z, c.impact, 2.5, 180, 40, 0.4, 1, 3);
    E.mistCloud({ x: P.x, z: P.z, t0: c.impact + 0.2, n: 14, seed: 15, R: H * 0.6, H: H * 0.3, w: H * 0.3, tau: 1.0, op: 0.28, soft: 120 });
  }

  // ---------------------------------------------- s38: the sea swells, then stands up as a column of water
  // Reference: a low dome, a second later a steep flared column with the body inside it, top out of frame.
  const mtn = new SeaMesh(ctx.engine, 96, 110);
  ctx.scene.add(mtn.mesh);
  const CRASH = new V3(-110, 0, -880);      // where the body comes out, in the gap between the ships
  function mtnState(t) {
    const a = t - c.surfaceBurst;
    const dome = 1 - Math.exp(-Math.max(a, 0) / 0.6);
    const col = smooth((a - 0.3) / 1.45);
    return { Hd: 150 * dome, Hc: 680 * col, Rd: lerp(450, 560, smooth(a / 2)), Rc: lerp(150, 262, col), fl: 300, col };
  }
  function mtnH(r, th, m) {
    const wob = 1 + 0.08 * Math.sin(th * 3 + 1.2) + 0.05 * Math.sin(th * 7 + 0.4) + 0.025 * Math.sin(th * 13 + 2);
    const rr = r / wob;
    const qd = rr / m.Rd, qc = rr / m.Rc;
    const skirt = 1 - smooth((qd - 1.1) / 0.8);
    const sw = 1 + 0.05 * Math.sin(r * 0.022 - th * 2 + 1) * Math.min(qd * 1.4, 1);
    const h = m.Hd * Math.exp(-qd * qd) * sw + m.Hc * (0.8 * Math.exp(-qc * qc * qc * qc) + 0.2 * Math.exp(-rr / m.fl));
    return h * skirt - 0.6;
  }
  function s38(st) {
    const t = I.tq, a = t - c.surfaceBurst;
    const P = CRASH;
    const m = mtnState(t);
    mtn.polar(P.x, P.z, 1700, (r, th) => mtnH(r, th, m));
    const u = mtn.mesh.material.uniforms;
    u.uFlow.value = t * (16 + 60 * m.col);
    u.uFoamAmt.value = 0.12 + 0.88 * smooth((a - 0.35) / 1.0);
    u.uRadial.value = smooth((a - 0.3) / 0.8);
    B.ripples.add(t, P.x, P.z, c.surfaceBurst, 1.8, 120, 40, 0.3, 0.5, 2);
    // spray smoking off the top of the swell
    if (a > 0.3) {
      const kk = smooth((a - 0.3) / 0.7);
      const top = m.Hd + m.Hc;
      E.mistCloud({ x: P.x, y: top * 0.55, z: P.z, t0: c.surfaceBurst + 0.3, n: 14, seed: 801, R: 340, H: top * 0.5, w: 170, tau: 0.9, op: 0.3 * kk, soft: 70, flat: 0.5 });
      E.drops({ x: P.x, y: top * 0.8, z: P.z, t0: c.surfaceBurst + 0.5, n: 60, seed: 802, V: 90, spread: 1.2, r: 3.4, g: 26, delay: 1.1 });
    }
    // white water running down the faces, hugging the mass, widening as it goes
    if (a > 0.72) {
      const kk = smooth((a - 0.72) / 0.8);
      const nS = Math.round(10 + 22 * kk);
      for (let i = 0; i < nS; i++) {
        const th = Math.PI / 2 + (hash(i, 1, 810) - 0.5) * 3.0;
        const r0 = m.Rc * (0.35 + 0.5 * hash(i, 2, 810));
        const r1 = m.Rc * (1.6 + 1.9 * hash(i, 5, 810));
        B.sheets.push((v, out) => {
          const rr = r0 + (r1 - r0) * v * v * 0.5 + (r1 - r0) * v * 0.5;
          out.set(P.x + Math.cos(th) * rr, mtnH(rr, th, m) + 7, P.z + Math.sin(th) * rr);
        }, (v) => (16 + 34 * hash(i, 3, 810)) * (0.45 + 1.0 * v), (i * 1.7) % 13, t * 150, 0.5 + 0.3 * hash(i, 4, 810), 0.02 + 0.14 * hash(i, 6, 810));
      }
    }
    // the foot: foam spreading on the flat sea round the skirt
    const b0 = c.surfaceBurst + 0.5;
    if (t > b0) {
      const g = smooth((t - b0) / 1.3);
      E.boil(P.x, P.z + 120, 1050, 804, 0.85, 0.72 + 0.28 * g);
      E.ring(P.x, P.z, 620 + 300 * g, 805, 0.8);
    }
  }

  // ---------------------------------------------- s39: the fall, and the wall that takes the ships
  // Reference: the plume it left stands under it; as it lands a long wall of plumes stands up behind
  // the two ships, both decks burst, and the wall folds into a low white roller running at the camera.
  const WALL = { t0: 79.3, z0: -815, v: 112 };
  const frontZ = (t) => WALL.z0 + WALL.v * (t - WALL.t0);
  const FANS = [[20, 0, 430], [270, 0.08, 340], [-260, 0.16, 380], [520, 0.24, 300], [-540, 0.3, 330], [780, 0.4, 250], [-820, 0.44, 270], [1080, 0.56, 200], [-1110, 0.6, 200]];
  function plume(st) {
    const tq = I.tq, t0 = 75.6, a = tq - t0;
    const P = CRASH;
    const gk = 1 - Math.exp(-a / 0.6);
    const die = 1 - smooth((tq - 79.2) / 1.4);
    if (die > 0) {
      E.jets({ x: P.x, z: P.z, t0, n: 80, k: 11, seed: 900, H: 350, g: 34, T: 3.0, spread: 0.46, polP: 0.85, R0: 30, w: 24, Hmin: 0.2, massR: 170, massYk: 0.26, tone: 0.08, shedN: 3, lenT: 0.24, fallT: 2.2 });
      E.mound({ x: P.x, z: P.z, t0, seed: 901, n: 60, R: 170 * gk, H: 170 * gk, w: 46, tone: 0.22, yP: 1.6, fade: 1 - die });
      E.mistCloud({ x: P.x, z: P.z, t0: 76.8, n: 12, seed: 904, R: 300, H: 240, w: 170, tau: 1.2, op: 0.26, soft: 90, dur: 4 });
    }
    E.collar({ x: P.x, z: P.z, t0, seed: 902, n: 56, R: 560, R0: 90, tau: 1.2, w: 34, H: 34, dur: 7, tone: 0.12 });
    E.boil(P.x, P.z, 640, 903, 1, 0.3 + 0.7 * gk);
    B.ripples.add(tq, P.x, P.z, t0, 2.6, 90, 28, 0.25, 1, 2);
  }
  function s39(st) {
    const tq = I.tq;
    plume(st);
    // water running off the airborne body
    const L = ctx.leviathan;
    if (L?.spine?.at && tq < WALL.t0 + 0.5) {
      const ch = sea.bodyChain(tq);
      const nC = ch.length;
      for (let i = 0; i < 30; i++) {
        const uu = (i + hash(i, 1, 930)) / 30 * (nC - 1), j = Math.min(Math.floor(uu), nC - 2);
        tmp2.lerpVectors(ch[j], ch[j + 1], uu - j);
        if (tmp2.y < 30) continue;
        const r = lerp(sea.chainR[j], sea.chainR[j + 1], uu - j) * 0.7;
        tmp2.y -= r * 0.4; tmp2.z += r * 0.6 * (hash(i, 2, 930) - 0.2);
        tmp2.x += r * 0.8 * (hash(i, 3, 930) - 0.5);
        // sheets tear apart in the air: they must not reach the sea and read as pillars
        sea.pour(tmp2, 7 + 13 * hash(i, 4, 930), 930 + i, 90, 0.8, 0.05, null, 0.28 + 0.34 * hash(i, 5, 930));
      }
    }
    if (tq < WALL.t0) return;
    const f0 = ctx.ships?.fleet?.[0], f1 = ctx.ships?.fleet?.[1];
    const front = frontZ(tq);
    // the wall: a row of overlapping fans, the first rank rising behind the ships, a lower rank after it
    for (let gen = 0; gen < 3; gen++) {
      for (let i = 0; i < FANS.length; i++) {
        const [x0, dl, H0] = FANS[i];
        const t0 = WALL.t0 + dl + gen * 0.6;
        const b = tq - t0;
        if (b < 0) continue;
        const Hg = H0 * [1, 0.72, 0.42][gen];
        const x = x0 + (gen ? (hash(i, gen, 920) - 0.5) * 240 : 0), zb = frontZ(t0) - 14;
        const gk = 1 - Math.exp(-b / 0.35);
        E.jets({ x, z: zb, t0, n: 30, k: 10, seed: 1000 + i * 7 + gen * 53, H: Hg, g: 52, T: 1.1, spread: 0.46, polP: 1, w: Hg * 0.058, Hmin: 0.16, massR: Hg * 0.38, massYk: 0.42, stretch: 1.1, lenT: 0.25, shedN: 3, tone: 0.26, tiltZ: 0.12, fallT: 1.6 });
        void gk;
      }
    }
    // the body of the wall travels with the front: a rolling heap that is highest while the fans stand
    const heap = smooth((tq - WALL.t0) / 0.7) * (1 - 0.6 * smooth((tq - 80.9) / 1.4));
    for (let i = 0; i < 26; i++) {
      const x = (i / 25 - 0.5) * 2 * 1250 + (hash(i, 1, 925) - 0.5) * 60;
      const q = Math.abs(x) / 1250;
      const tl = WALL.t0 + Math.abs(x) / 1600;
      if (tq < tl) continue;
      const e = smooth((tq - tl) / 0.5) * heap * (1 - 0.55 * q * q) * (0.75 + 0.5 * hash(i, 2, 925));
      E.mound({ x, z: front - 44, seed: 1400 + i * 3, n: 22, R: 96, H: 150 * e, w: 26 + 14 * e, tone: 0.36, yP: 1.25, taper: 0.5 });
    }
    // the running edge: low fat tongues on the sea in front of the wall
    B.puffs.inkZ = E.inkZ(0, 0, front);
    const nE = 230, span = 1300;
    for (let i = 0; i < nE; i++) {
      const x = (hash(i, 1, 950) - 0.5) * 2 * span;
      if (tq < WALL.t0 + Math.abs(x) / 1800 + 0.1) continue;
      const out = 10 + 64 * hash(i, 2, 950);
      const r = (7 + 15 * hash(i, 3, 950)) * (0.8 + 0.9 * smooth((tq - 79.6) / 2));
      const flick = hash(i, I.draw % 7, 951);
      B.puffs.push(x, r * 0.25, front + out * (0.6 + 0.4 * flick), r, r * 3.8, 0.3, 0.5, 0.05 * (hash(i, 4, 950) - 0.5), 0.14, 1, i % 97, 0.26 + 0.3 * hash(i, 5, 950), 0, KIND.TONGUE, PAL.WATER, i % 4 ? ID.MASS2 : ID.MASS);
    }
    B.puffs.inkZ = 0;
    // loose spray standing over it, thinner at the top so the sky stays blue
    const k = smooth((tq - WALL.t0) / 0.7);
    for (let i = 0; i < 20; i++) {
      const x = (hash(i, 1, 980) - 0.5) * 2.4 * span;
      const y = 70 + 150 * hash(i, 2, 980) * k;
      const sz = 150 + 170 * hash(i, 3, 980);
      E.mist(x, y, front - 170 - 160 * hash(i, 4, 980), sz, sz * 0.62, i + 980, 0.11 * k, 60, 0.04 + 0.14 * hash(i, 5, 980), 0.35, hash(i, 6, 980) * 6.28);
    }
    // the sea behind the front is all foam
    for (let i = 0; i < 16; i++) E.boil((i / 15 - 0.5) * 2.2 * span, front - 150, 240, 985 + i, 1, 1);
    // one enormous straight ripple running with the front: a ring centred far behind it
    B.ripples.add(tq, 0, WALL.z0 - 4000, WALL.t0 - 4000 / WALL.v, 2.6, WALL.v, 36, 0.01, 1, 5);
    // both decks burst: the Monster department tilts the ships, the boxes and the surge are ours
    const hit1 = 79.7, hit0 = 80.35;
    if (f1) throwBoxes({ x: f1.root.position.x, y: 50, z: f1.root.position.z, t0: hit1, n: 17, seed: 11, V: 158, spread: 0.52, g: 46, R: 190, scale: 2.5, delay: 0.5 });
    if (f0) throwBoxes({ x: f0.root.position.x, y: 50, z: f0.root.position.z, t0: hit0, n: 17, seed: 12, V: 140, spread: 0.52, g: 46, R: 190, scale: 2.5, delay: 0.5 });
    for (const [f, h, sd] of [[f1, hit1, 990], [f0, hit0, 995]]) {
      if (!f || tq < h) continue;
      const p = f.root.position;
      E.jets({ x: p.x, z: p.z - 20, t0: h, n: 14, k: 8, seed: sd, H: 170, g: 40, T: 0.8, spread: 0.32, polP: 0.8, R0: 70, w: 11, Hmin: 0.3, massR: 120, tone: 0.1, shedN: 2 });
      E.collar({ x: p.x, z: p.z + 16, t0: h, seed: sd + 1, n: 50, R: 330, R0: 40, tau: 0.8, w: 26, H: 24, az: Math.PI / 2, azSpread: 0.7, dur: 5 });
    }
  }

  return {
    shots: { s30, s38, s39 },
    impact,
    begin() { boxUsed = 0; grp.visible = false; for (const b of BOXES) b.visible = false; mtn.mesh.visible = false; },
    throwBoxes,
  };
}
void clamp; void invLerp; void easeOut; void easeIn;
