import * as THREE from 'three';
import { Rng, onTwos, onThrees, clamp, smooth, invLerp, lerp, easeOut, easeIn, track, deg } from './util.js';
import { WU, raw } from './under-env.js';
import { FY, floorH } from './under-sets.js';
import { makePuffs, lifeMaterial, whaleGeo, fishGeo, instLife } from './under-life.js';
import { blobGeo, rockMaterial } from './under-rock.js';
import { celMaterial } from './materials.js';

// What happens on stage. Everything is a pure function of st.t and the CUES.

const q = new THREE.Quaternion(), e = new THREE.Euler();
const CANYON_DY = -480;   // s27 plays on the canyon floor

// Rough stand-in behind the same API, used only until the real leviathan module exists.
function standIn(root) {
  const g = new THREE.Group();
  const mat = celMaterial({ color: '#3c7f7a', dark: '#1d3a44', id: 11, weather: [0, 0, 0, 0] });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mat);
  body.scale.set(150, 110, 450);
  g.add(body);
  for (const s of [1, -1]) {
    const fin = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), mat);
    fin.scale.set(170, 26, 60); fin.position.set(s * 230, -60, 180); fin.rotation.z = s * -0.5;
    g.add(fin);
    const fl = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), mat);
    fl.scale.set(120, 12, 50); fl.position.set(s * 90, 0, -470);
    g.add(fl);
  }
  g.visible = false;
  root.add(g);
  const anchors = { head: [0, 0, 440], jaw: [0, -40, 430], back: [0, 110, 40], belly: [0, -110, 40], tail: [0, 0, -470], clawL: [-340, -130, 200], clawR: [340, -130, 200] };
  return {
    root: g,
    show(b) { g.visible = b; },
    pose(p) {
      g.position.set(...p.pos);
      g.rotation.set(p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0, 'YXZ');
      g.updateMatrixWorld(true);
    },
    anchor(n, v) { return v.set(...(anchors[n] ?? [0, 0, 0])).applyMatrix4(g.matrixWorld); },
  };
}

// Nock at the origin, tip at z = 1, like arrow.js. Only used while that module cannot load.
function standInArrow(root) {
  const g = new THREE.Group(); g.name = 'arrow';
  const m1 = celMaterial({ color: '#343a4e', dark: '#141822', id: 21, weather: [0, 0, 0, 0] });
  const m2 = celMaterial({ color: '#c8d4e8', dark: '#343a4e', id: 23, weather: [0, 0, 0, 0] });
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 12), m1);
  sh.rotation.x = Math.PI / 2; sh.position.z = 0.5; g.add(sh);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 6), m2);
  tip.rotation.x = Math.PI / 2; tip.position.z = 0.95; g.add(tip);
  root.add(g);
  return g;
}

export function makeStage(ctx, root, ov, getSet, parts = {}) {
  const { makeArrow = null, section = null, LEV_L = 900 } = parts;
  const C = ctx.CUES;
  const rig = new THREE.Group(); root.add(rig);

  // distant whales + fish
  const wMat = lifeMaterial({ color: '#2f5fa8', id: 12 });
  const wGeo = whaleGeo();
  const farWhales = [0, 1, 2, 3, 4, 5].map(() => { const m = new THREE.Mesh(wGeo, wMat); m.visible = false; m.frustumCulled = false; rig.add(m); return m; });
  const fishMat = lifeMaterial({ color: '#2a68b4', id: 110 });
  const fg = fishGeo();
  const FISH = 420;
  const fish = new THREE.InstancedMesh(fg, fishMat, FISH); fish.frustumCulled = false; fish.visible = false; rig.add(fish);
  const fishR = new Rng(808);
  const fishSeed = Array.from({ length: FISH }, () => [fishR.gauss(), fishR.gauss() * 0.5, fishR.gauss(), fishR.next() * 6.28, fishR.range(0.7, 1.3)]);

  // lazily replaced by real department parts
  let sLev = null, sArrow = null;
  const rigged = [];
  const lev = () => {
    const L = ctx.leviathan;
    if (L?.pose && L?.show) return L;
    return (sLev ??= standIn(rig));
  };
  const arrow = () => { if (!sArrow) { sArrow = makeArrow ? makeArrow(ctx, { heat: 0.8 }) : standInArrow(rig); if (makeArrow) rig.add(sArrow); } return sArrow; };
  // rigged whales, built the first time a shot asks for them; null until the Leviathan dept exists
  const whale = (i, o) => {
    if (rigged[i]) return rigged[i];
    const L = ctx.leviathan;
    if (!L?.makeWhale) return null;
    return (rigged[i] = L.makeWhale(o));
  };

  // ---- silt emitters (absolute times, arena coordinates)
  let puffs = null;
  const buildPuffs = () => {
    const E = [];
    const r = new Rng(9);
    // first shockwave along the floor at the pierce, spreading ring
    for (let i = 0; i < 90; i++) {
      const a = r.range(0, 6.28), d = r.range(160, 560), s = r.range(50, 130);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      E.push({ p: [x, floorH(x, z) + s * 0.3, z], v: [Math.cos(a) * r.range(200, 520), r.range(0, 30), Math.sin(a) * r.range(200, 520)], k: 0.75, size: s, t0: C.pierce + r.range(0, 0.5), life: r.range(7, 11.5), grow: 1.4 });
    }
    // mound burst
    for (let i = 0; i < 130; i++) {
      const a = r.range(0, 6.28), up = r.range(0.2, 1), sp = r.range(200, 700), s = r.range(30, 90);
      E.push({ p: [Math.cos(a) * r.range(0, 90), FY + r.range(40, 120), Math.sin(a) * r.range(0, 90)], v: [Math.cos(a) * sp * (1.1 - up), sp * up, Math.sin(a) * sp * (1.1 - up)], k: 1.1, size: s, t0: C.rockBurst + r.range(-0.04, 0.3), life: r.range(4, 6), grow: 1.5 });
    }
    // claw plant in s34
    for (let i = 0; i < 90; i++) {
      const a = r.range(-1.5, 1.8), sp = r.range(60, 260), s = r.range(16, 60);
      E.push({ p: [-250 + r.range(-40, 60), FY + 16, 70 + r.range(-40, 40)], v: [Math.cos(a) * sp, r.range(10, 70), Math.sin(a) * sp * 0.6], k: 1.3, size: s, t0: 68.5 + r.range(0, 0.25), life: r.range(2.5, 4), grow: 1.5 });
    }
    // long-standing bank behind the mound for the close shots
    for (let i = 0; i < 26; i++) {
      const x = r.range(-1500, 1500), z = r.range(-900, -300), s = r.range(120, 260);
      E.push({ p: [x, floorH(x, z) + r.range(10, 70), z], v: [r.range(-8, 8), r.range(0, 10), 0], k: 0.2, size: s, t0: C.pierce + r.range(-0.2, 0.8), life: 14, grow: 0.7 });
    }
    E.sort((a, b) => a.p[2] - b.p[2]);
    puffs = makePuffs(E, { c0: '#1a68b0', c1: '#2c92c8', c2: '#62c8dc', opacity: 0.62, soft: 60 });
    puffs.renderOrder = 2;
    ov.add(puffs);
  };

  // the beast's wake in the canyon: long pale ribbons of silt it drags off the ledges
  let wake = null;
  const buildWake = () => {
    const E = [], r = new Rng(27);
    const ribbon = (pts, n, s0, s1) => {
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1), j = Math.min(Math.floor(u * (pts.length - 1)), pts.length - 2), f = u * (pts.length - 1) - j;
        const p = pts[j].map((x, q) => lerp(x, pts[j + 1][q], f) + r.range(-1, 1) * s0 * 0.5 + (q === 1 ? CANYON_DY : 0));
        E.push({ p, v: [r.range(-14, 14), r.range(0, 12), r.range(10, 40)], k: 0.25, size: lerp(s0, s1, r.next()), t0: 53.5 + u * 1.2, life: 8, grow: 0.8 });
      }
    };
    ribbon([[-900, -300, 500], [-560, -340, 200], [-250, -360, -60], [-60, -390, -240], [90, -430, -420]], 46, 34, 74);
    ribbon([[-640, -240, 420], [-300, -250, 120], [-40, -290, -160]], 26, 26, 60);
    ribbon([[-120, -700, 460], [-80, -610, 240], [20, -540, 70], [90, -500, -80]], 32, 30, 64);
    E.sort((a, b) => a.p[2] - b.p[2]);
    wake = makePuffs(E, { c0: '#3a9cc8', c1: '#6cc8dc', c2: '#b4eee8', opacity: 0.5, soft: 80 });
    wake.renderOrder = 2;
    ov.add(wake);
  };

  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), m4 = new THREE.Matrix4();
  const dummy = new THREE.Object3D();
  const basis = new THREE.Matrix4(), vx = new THREE.Vector3(), vy = new THREE.Vector3(), camV = new THREE.Vector3();
  const placeLine = (o, from, to, len, thin = 0.34) => {
    // arrow with its tip at `to`, pointing from -> to; arrow.js has the nock at the origin, tip at z = 1.
    // The barbed head lies in its local YZ plane: roll it so the blades show flat to the lens.
    v0.subVectors(to, from).normalize();
    o.position.copy(to).addScaledVector(v0, -len);
    camV.setFromMatrixPosition(ctx.camera.matrixWorld).sub(to).normalize();
    vy.crossVectors(v0, camV);
    if (vy.lengthSq() < 1e-5) vy.set(1, 0, 0);
    vy.normalize();
    vx.crossVectors(vy, v0).normalize();
    o.quaternion.setFromRotationMatrix(basis.makeBasis(vx, vy, v0));
    o.scale.set(len * thin, len * thin, len);   // long lance: arrow.js proportions, slimmed across the shaft
    o.visible = true;
  };

  const placeWhale = (m, p, yaw, pitch, roll, s) => {
    m.position.set(...p); m.rotation.set(pitch, yaw, roll, 'YXZ'); m.scale.setScalar(s); m.visible = true;
  };

  function school(st, center, heading, spread, size, n) {
    fish.visible = true;
    const tt = onTwos(st.t);
    for (let i = 0; i < FISH; i++) {
      if (i >= n) { dummy.scale.setScalar(0); dummy.updateMatrix(); fish.setMatrixAt(i, dummy.matrix); continue; }
      const s = fishSeed[i];
      dummy.position.set(center[0] + s[0] * spread + Math.sin(tt * 0.7 + s[3]) * spread * 0.1, center[1] + s[1] * spread + Math.sin(tt * 1.1 + s[3]) * spread * 0.06, center[2] + s[2] * spread);
      dummy.rotation.set(0, heading + Math.sin(tt * 2 + s[3]) * 0.16, 0);
      dummy.scale.setScalar(size * s[4]);
      dummy.updateMatrix();
      fish.setMatrixAt(i, dummy.matrix);
    }
    fish.instanceMatrix.needsUpdate = true;
  }

  // a rigged whale, pose in one call
  const swim = (i, o, p) => {
    const w = whale(i, o);
    if (!w) return null;
    w.pose({ flipL: { sweep: 0.55, droop: 0.45, curl: 0.04 }, flipR: { sweep: 0.55, droop: 0.45, curl: 0.04 }, ...p });
    w.show(true);
    return w;
  };
  const WB = { len: 66, back: '#16386e', belly: '#27548e' };
  // lays a hand on the ground: droop is solved so the claws reach the floor under them
  const plant = (L, p, key, claw, h) => {
    let lo = -0.3, hi = 1.65;
    for (let i = 0; i < 7; i++) {
      const m = (lo + hi) / 2;
      p[key] = { ...p[key], droop: m };
      L.pose(p); L.anchor(claw, v1);
      if (v1.y > h(v1.x, v1.z) - 8) lo = m; else hi = m;
    }
  };

  const SHOTS = {
    s17(st) {
      const k = st.lt / st.dur, up = smooth(k), tt = onTwos(st.t);
      WU.uChurn.value.set(0, -400, lerp(330, 470, up), 0.92);
      const S = [
        [[-96, -128, -150], [-46, -66, -132], 0.24, 76],
        [[52, -128, -150], [84, -60, -132], -0.34, 64],
        [[86, -150, -190], [134, -90, -168], -0.5, 52],
        [[-250, -96, -340], [-238, -58, -330], 0.2, 60],
      ];
      S.forEach(([a, b, yaw, pitch], i) => {
        const p = a.map((x, j) => lerp(x, b[j], up));
        swim(i, { ...WB, id: 62 + i * 2, len: i === 3 ? 44 : 66 }, { pos: p, yaw: Math.PI + yaw, pitch: deg(pitch), roll: 0.3 * (i % 2 ? 1 : -1), bend: Math.sin(tt * 1.6 + i) * 0.22, flukes: Math.sin(tt * 2.2 + i * 1.7) * 0.7, flipL: { sweep: 0.7, droop: 0.3 }, flipR: { sweep: 0.7, droop: 0.3 } });
      });
    },
    s27(st) {
      const k = st.lt / st.dur, t = onTwos(st.t);
      // the flank slides ahead of the camera into the slot; head far ahead, tail behind us
      const L = lev();
      const p = { pos: [lerp(-250, -214, k), lerp(-486, -476, k) + CANYON_DY, lerp(810, 570, k)], yaw: Math.PI - 0.08, pitch: 0.02, roll: 0.1, spine: 0.1, side: -0.3, flukes: 0.3, crawl: t * 0.2, center: 0.5, jaw: 0.05,
        flipL: { sweep: 0.5, curl: 0.05 }, flipR: { sweep: 0.3, curl: 0.05 } };
      plant(L, p, 'flipL', 'clawL', () => -1072);
      plant(L, p, 'flipR', 'clawR', () => -1072);
      L.pose(p);
      L.show(true);
      [[-40, -800, -240], [34, -766, -320], [84, -826, -200], [-4, -736, -380]].forEach((p, i) => placeWhale(farWhales[i], [p[0] + k * 40, p[1] + k * 26 + Math.sin(t + i) * 3, p[2] - k * 50], 2.2 + i * 0.1, -0.05, 0, 30));
      school(st, [150, -470 + CANYON_DY, -1400], 2.4, 90, 4, 160);
    },
    s29(st) {
      // One action in four beats: the whale flees, the maw lunges after it, the pull takes the whale
      // tail first down the line of the jaws, the jaws shut on it. A second whale gets away past the lens.
      const k = st.lt / st.dur, t = onTwos(st.t);
      const lunge = smooth(invLerp(0.22, 0.66, k));
      // a small draw back before the strike, and a jerk back with the catch
      const coil = Math.sin(clamp(k / 0.24) * Math.PI) + 1.2 * smooth(invLerp(0.8, 1, k));
      const bite = easeIn(invLerp(0.7, 0.86, k), 1.6);
      const maw = (u, c) => {
        const d = 150 * u - 20 * c;
        return { pos: [-330 + 0.855 * d, -528 + 0.247 * d, -90 + 0.457 * d], yaw: lerp(0.98, 1.16, u), pitch: lerp(0.14, 0.24, u), roll: -0.14, jaw: 1, spine: 0.22, side: -0.1, center: 0.62,
          flipL: { sweep: 0.5, droop: 0.2, curl: 0.05 }, flipR: { sweep: lerp(-0.1, 0.1, u), droop: 0.82, curl: 0.09, twist: 0.3 } };
      };
      const L = lev();
      // the flight line starts ahead of the resting mouth
      L.pose(maw(0, 0));
      L.anchor('mouth', v0); L.anchor('throat', v1);
      v2.subVectors(v0, v1).normalize();
      const f0 = [v0.x + v2.x * 150, v0.y + v2.y * 150 - 30, v0.z + v2.z * 150], fd = [v2.x, v2.y, v2.z];
      const p = maw(lunge, coil);
      p.jaw = lerp(lerp(0.8, 1, smooth(k / 0.22)), 0.14, bite);
      L.pose(p);
      L.show(true);
      L.anchor('mouth', v0); L.anchor('throat', v1);
      v2.subVectors(v0, v1).normalize();
      const B = { len: 34, back: '#10224a', belly: '#f4f8fa' };
      // the doomed whale always faces out of the mouth: it keeps swimming as it is dragged in backwards
      // and goes down the middle of the gape, between the jaw tips, as they shut
      const pull = easeIn(invLerp(0.24, 0.74, k), 2), hold = lerp(16, -30, smooth(invLerp(0.74, 0.95, k)));
      L.anchor('jaw', v1);
      const inside = ['x', 'y', 'z'].map((a) => (v0[a] + v1[a]) / 2 + v2[a] * hold);
      const wp = f0.map((x, i) => lerp(x + fd[i] * 100 * k, inside[i], pull));
      const flare = { sweep: lerp(0.85, 0.25, smooth(pull * 2.5)), droop: lerp(0.32, 0.1, smooth(pull * 2.5)) };
      swim(5, { ...B, len: 44, id: 64 }, { pos: wp, yaw: Math.atan2(v2.x, v2.z), pitch: Math.asin(clamp(v2.y, -1, 1)), roll: 0.12, bend: Math.sin(t * 17 + 1) * 0.3, flukes: Math.sin(t * 19 + 1), flipL: flare, flipR: flare });
      // the other comes at the lens on the right and leaves frame beside it
      const ek = lerp(k, k * k, 0.35);
      swim(4, { ...B, id: 62 }, { pos: [lerp(150, 76, ek), lerp(-552, -567, ek), lerp(38, 298, ek)], yaw: lerp(0.35, -0.22, smooth(k * 1.6)), pitch: -0.1, roll: lerp(0.35, 0.1, k), bend: Math.sin(t * 15) * 0.26, flukes: Math.sin(t * 17), flipL: { sweep: 0.85, droop: 0.32 }, flipR: { sweep: 0.85, droop: 0.32 } });
      [[560, -300, -620], [760, -360, -740]].forEach((p, i) => placeWhale(farWhales[i], [p[0] + k * 30, p[1], p[2]], 1.2, 0, 0, 46));
    },
    s31(st) { arena(st); placeWhale(farWhales[0], [lerp(190, 260, st.lt / st.dur), -560, 60], 1.5, 0.1, 0, 26); placeWhale(farWhales[1], [lerp(90, 170, st.lt / st.dur), -520, -20], 1.4, 0, 0, 22); },
    s32(st) { arena(st); },
    s33(st) { arena(st); placeWhale(farWhales[0], [-1500, -130, 300], 1.4, 0.1, 0, 40); placeWhale(farWhales[1], [-1300, -30, 80], 1.5, 0, 0, 30); },
    s34(st) { arena(st); },
    s35(st) { arena(st); },
    s36(st) {
      arena(st);
      if (st.lt > 0.7) swim(4, { len: 34, back: '#10224a', belly: '#f4f8fa', id: 62 }, { pos: [lerp(640, 760, st.lt / st.dur), -540, 60], yaw: 1.5, pitch: 0.02, flukes: Math.sin(onTwos(st.t) * 8) * 0.8, bend: Math.sin(onTwos(st.t) * 6) * 0.2 });
    },
    s37(st) { rise(st); },
  };

  // ---- the strike: beast over the mound, the arrow going straight down through it. The hit lands
  // just ahead of the shoulder (reference composition), so the arm sweeps back clear of the wound.
  const STRIKE_Z = 0.73 * LEV_L;
  const strike = { back: new THREE.Vector3(), belly: new THREE.Vector3() };
  const STRIKE_TOP = (() => { const S = section?.(STRIKE_Z); return S ? { top: S.cy + (S.top ?? 84), bot: S.cy - (S.bot ?? 96) } : { top: 84, bot: -96 }; })();
  const strikePts = (L) => {
    L.spine.toWorld(v0.set(0, STRIKE_TOP.top, STRIKE_Z), strike.back);
    L.spine.toWorld(v0.set(0, STRIKE_TOP.bot, STRIKE_Z), strike.belly);
    return strike;
  };
  // the beast crawls: belly a whisker above the mound, spine humped over it, tail lying along the floor
  const BACK = [0, FY + 182 + STRIKE_TOP.top - STRIKE_TOP.bot, 0];
  const flipTrack = (st) => {
    const t = st.t;
    const near = { sweep: track([[62.9, 0.92], [68.17, 0.96], [68.8, 0.72], [69.23, 0.66], [71.0, 0.9], [71.8, 1.2]], t), droop: track([[62.9, 0.6], [68.17, 0.74], [68.8, 1.08], [69.23, 1.12], [71.0, 0.8], [71.8, 0.45]], t), curl: 0.06, twist: 0.1 };
    // the macro of the tip keeps the frame clear
    if (st.sid === 's35' || (st.sid === 's36' && st.lt <= 0.7)) { near.sweep = 1.5; near.droop = 0.2; }
    return { near, far: { sweep: 0.3, droop: 0.92, curl: 0.05 } };
  };
  function arena(st) {
    const L = lev(), t = st.t;
    const sink = 26 * smooth(invLerp(63, 69, t));
    const heave = t > C.rockBurst + 0.6 ? easeOut(invLerp(C.rockBurst + 0.6, 73.6, t)) : 0;
    const F = flipTrack(st);
    const p = {
      pos: [0, -760, 0], yaw: Math.PI / 2 + lerp(0.2, 0.42, heave), pitch: lerp(0.1, 0.22, heave), roll: lerp(0.06, 0.2, heave),
      spine: lerp(0.4, -0.1, heave), side: 0.1, flukes: Math.sin(onTwos(t) * 1.2) * 0.3, crawl: (t - 63) * 0.16, center: 0.55,
      flipL: F.far, flipR: F.near, jaw: lerp(0.1, 0.3, heave),
    };
    L.pose(p);
    if (!L.spine) { L.show(true); return; }
    strikePts(L);
    p.pos[0] += BACK[0] - strike.back.x + heave * 90; p.pos[1] += BACK[1] - sink - strike.back.y + heave * 150; p.pos[2] += BACK[2] - strike.back.z;
    if (st.t < C.rockBurst && st.sid !== 's35') { plant(L, p, 'flipR', 'clawR', floorH); plant(L, p, 'flipL', 'clawL', floorH); }
    L.pose(p);
    L.show(true);
    strikePts(L);
    if (ctx.under) ctx.under.strike = strike;
    placeArrow(st);
  }

  // the pierced beast climbs: a low three quarter view, then a silhouette against the surface
  function rise(st) {
    const L = lev(), k = st.lt / st.dur, e = smooth(k), t = st.t;
    const p = {
      pos: [lerp(60, 0, e), lerp(-560, -330, e), lerp(-120, -120, e)], yaw: lerp(-1.24, -0.2, e), pitch: lerp(0.62, 1.42, e), roll: lerp(0.3, 0, e),
      spine: lerp(-0.2, 0, e), side: 0, center: 0.55, jaw: 0.3, flukes: Math.sin(onTwos(t) * 1.4) * 0.5,
      flipL: { sweep: lerp(0.8, 0.4, smooth(invLerp(0.45, 0.85, k))), droop: lerp(0.9, -0.05, e), curl: lerp(0.1, 0.05, e) }, flipR: { sweep: lerp(0.8, 0.4, smooth(invLerp(0.45, 0.85, k))), droop: lerp(0.9, -0.05, e), curl: lerp(0.1, 0.05, e) },
    };
    L.pose(p); L.show(true);
    L.anchor('back', backW); L.anchor('belly', bellyW);
    // a long lance, in at the shoulder and out through the flank, slanting across the frame
    v2.set(lerp(-0.86, -0.72, e), lerp(-0.42, -0.5, e), 0.08).normalize();
    tipW.copy(bellyW).lerp(backW, 0.5).addScaledVector(v2, 300);
    tailW.copy(tipW).addScaledVector(v2, -RLEN);
    const a = arrow(); placeLine(a, tailW, tipW, RLEN, 0.2); a.setHeat?.(0.9);
    const U = ctx.under;
    if (U) { U.pierce?.copy(backW); U.tip?.copy(tipW); U.arrow = a; }
  }

  const backW = new THREE.Vector3(), bellyW = new THREE.Vector3(), tipW = new THREE.Vector3(), tailW = new THREE.Vector3();
  const ALEN = 1100, RLEN = 1500;
  const MOUND_TOP = FY + 112;
  function placeArrow(st) {
    const t = st.t;
    backW.copy(strike.back); bellyW.copy(strike.belly);
    const a = arrow();
    const U = ctx.under;
    const wide = st.sid === 's36' && st.lt > 0.7;
    if (t < C.pierce - 0.02) {
      // falling in from above
      const u = invLerp(62.9, C.pierce - 0.02, t);
      tipW.set(backW.x, lerp(backW.y + 640, backW.y, u), backW.z);
      tailW.set(tipW.x, tipW.y + 100, tipW.z);
    } else if (!wide) {
      const inBody = smooth(invLerp(C.pierce, C.tipOut - 0.02, t));
      const stab = easeOut(invLerp(C.tipOut - 0.02, C.tipOut + 0.08, t), 3);
      const y = t < C.tipOut - 0.02 ? lerp(backW.y - 8, bellyW.y + 12, inBody) : lerp(bellyW.y + 12, MOUND_TOP + 4, stab);
      const dig = t > C.tipOut + 0.08 ? 16 * invLerp(C.tipOut + 0.08, C.rockBurst, t) : 0;
      tipW.set(backW.x, y - dig, backW.z);
      tailW.set(tipW.x, tipW.y + 100, tipW.z);
    } else {
      // after the burst the arrow rides the wound, slanting through the rising body
      v2.subVectors(bellyW, backW).normalize().add(v1.set(0.62, 0, 0)).normalize();
      tipW.copy(backW).addScaledVector(v2, 300);
      tailW.copy(backW);
    }
    // the macro of the tip keeps the head readable in the gap under the belly
    const macro = st.sid === 's35' || (st.sid === 's36' && st.lt <= 0.7);
    placeLine(a, tailW, tipW, macro ? 640 : ALEN, macro ? 0.6 : 0.34);
    a.setHeat?.(0.85);
    if (U) { U.pierce?.copy(backW); U.tip?.copy(tipW); U.arrow = a; }
  }

  // the mound lets go: chunks of the same rock leave on a drag curve, a broken stump stays
  function burst(st, set) {
    const b = set?.chunks;
    if (!set?.mound) return;
    const broke = st.t >= C.rockBurst;
    set.mound.visible = !broke;
    set.stump.visible = broke;
    b.visible = broke && st.t < 75;
    if (!broke) return;
    const age = onTwos(st.t) - C.rockBurst;
    const d = dummy;
    set.seeds.forEach((s, i) => {
      const a = Math.max(age - s.del, 0);
      const f = (1 - Math.exp(-1.5 * a)) / 1.5;
      d.position.set(s.p[0] + s.v[0] * f, s.p[1] + s.v[1] * f - 16 * a * a, s.p[2] + s.v[2] * f);
      d.rotation.set(s.r[0] + s.w[0] * f, s.r[1] + s.w[1] * f, s.r[2]);
      d.scale.set(s.s[0], s.s[1], s.s[2]);
      d.updateMatrix();
      b.setMatrixAt(i, d.matrix);
    });
    b.instanceMatrix.needsUpdate = true;
  }

  const hide = () => {
    for (const w of farWhales) w.visible = false;
    for (const w of rigged) w?.show(false);
    fish.visible = false;
    if (sArrow) sArrow.visible = false;
    if (ctx.under) ctx.under.arrow = null;
  };

  return {
    off() { sLev?.show(false); hide(); },
    update(st, c, veil) {
      hide();
      if (st.t > 60 && c.sets.includes('arena')) { if (!puffs) buildPuffs(); }
      if (puffs) {
        const u = puffs.material.uniforms;
        puffs.visible = c.sets.includes('arena') && st.t > 62;
        u.uT.value = onThrees(st.t); u.uFogD.value = c.fog * 0.8;
      }
      if (st.sid === 's27' && !wake) buildWake();
      if (wake) {
        wake.visible = st.sid === 's27';
        const u = wake.material.uniforms;
        u.uT.value = onThrees(st.t); u.uFogD.value = c.fog * 0.8;
      }
      fishMat.uniforms.uTime2.value = st.t;
      if (c.sets.includes('arena')) burst(st, getSet('arena'));
      const f = SHOTS[st.sid];
      if (f) f(st, c, veil);
      else if (sLev) sLev.show(false);
    },
  };
}
