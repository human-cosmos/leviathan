import * as THREE from 'three';
import { Rng, clamp } from './util.js';
import { blobGeo, spireGeo, wallGeo, floorGeo, rockMaterial, instanced, fbm, ridged, n3 } from './under-rock.js';
import { lifeMaterial, kelpGeo, coralGeos, instLife } from './under-life.js';

// Stage sets on the sea floor. Water surface y = 0, floor around y = -1000.
export const FY = -1000;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export function floorH(x, z) {
  const r = Math.hypot(x, z);
  let h = FY + 30 * fbm(x / 300, 1.3, z / 300, 5) + 9 * fbm(x / 70, 4.1, z / 70, 4);
  const sh = ridged(x / 700 + 3, 2.2, z / 700, 4);
  // the shelf rises around the arena, but stays down on the hero cameras' side
  h += sm(280, 1000, r) * 170 * sh * (1 - sm(-200, 600, z) * (1 - sm(2200, 3000, z)) * (1 - sm(900, 1600, Math.abs(x))));
  h += sm(1200, 5000, r) * 460 * (0.55 + fbm(x / 1600, 8, z / 1600, 3));
  h += 14 * Math.exp(-r * r / 57600);
  return h;
}

// Aerial perspective does the brightening: rock itself stays deep, teal only on the ledges.
const SPIRE = { top: '#3cb4b4', lit: '#187498', lit2: '#14628e', shd: '#0f4688', shd2: '#0c3878', deep: '#082660', growth: 0.2 };
const WALL = { top: '#62d4c4', lit: '#2494ac', lit2: '#1e7ea2', shd: '#14569a', shd2: '#11468c', deep: '#0b2c6c', growth: 0.35 };
const NEAR = { top: '#3fb4b4', lit: '#18759c', lit2: '#156290', shd: '#0f3f84', shd2: '#0c3276', deep: '#08205a', growth: 0.25 };
const FLOOR = { top: '#a4ecd8', lit: '#37a6b4', lit2: '#2c90ae', shd: '#1c62a4', shd2: '#164e96', deep: '#0f3478', growth: 0.35 };
const CORAL = ['#ff5f7e', '#ffae3d', '#ff7bc8', '#ffd84a', '#b67bff', '#ff6a3a', '#3fe0c0'];
const KELP = ['#27c48a', '#3ad26e', '#1fae9c', '#7ad24a'];

function dress(group, r, zone, h = floorH) {
  // zone: { n, x0, x1, z0, z1, s0, s1 }
  const [dome, fan, tube] = coralGeos();
  const lists = [[], [], []];
  for (let i = 0; i < zone.n; i++) {
    const x = r.range(zone.x0, zone.x1), z = r.range(zone.z0, zone.z1);
    if (Math.hypot(x, z) < (zone.clear ?? 200) || zone.skip?.(x, z)) continue;
    const s = r.range(zone.s0, zone.s1) * (r.next() < 0.12 ? 2.2 : 1);
    const k = r.int(0, 2);
    const clump = fbm(x / 240, 3, z / 240, 3) > -0.08;
    if (!clump) continue;
    lists[k].push({ p: [x, h(x, z) + (k === 0 ? s * 0.1 : -s * 0.05), z], r: [r.range(-0.2, 0.2), r.range(0, 6.28), r.range(-0.2, 0.2)], s: [s, s, s], c: r.pick(CORAL) });
  }
  const mat = lifeMaterial({ color: '#ffffff', id: 104 });
  [dome, fan, tube].forEach((g, i) => { if (lists[i].length) group.add(instLife(g, mat, lists[i])); });
}

function kelpBeds(group, r, zone, h = floorH) {
  const list = [];
  for (let i = 0; i < zone.n; i++) {
    const x = r.range(zone.x0, zone.x1), z = r.range(zone.z0, zone.z1);
    if (Math.hypot(x, z) < (zone.clear ?? 260) || zone.skip?.(x, z)) continue;
    if (fbm(x / 300, 8, z / 300, 3) < 0.02) continue;
    const s = r.range(zone.s0, zone.s1);
    list.push({ p: [x, h(x, z) - 2, z], r: [0, r.range(0, 6.28), 0], s: [s * 0.8, s, s * 0.8], c: r.pick(KELP) });
  }
  const mat = lifeMaterial({ color: '#ffffff', id: 106, sway: 0.09 });
  const m = instLife(kelpGeo(), mat, list);
  m.userData.kelp = true;
  group.add(m);
  return m;
}

// The arena: sand and rock shelves, a hero mound dead centre, a forest of stone spires.
export function buildArena(ctx, root, ov) {
  const group = new THREE.Group(); group.name = 'arena'; root.add(group);
  const r = new Rng(31);

  const fm = rockMaterial({ ...FLOOR, scale: 40, bump: 0.8, cauS: 150 });
  const floor = new THREE.Mesh(floorGeo(280, 420, 6500, floorH), fm);
  floor.frustumCulled = false; group.add(floor);

  // spires
  const sm1 = rockMaterial({ ...SPIRE, scale: 62, strata: [0.3, 1, 0.16], cauS: 170, stretch: 0.62, foot: [-1000, 340] });
  const geos = [1, 2, 3, 4, 5].map((s, i) => spireGeo({ seed: s * 3.3, flutes: 5 + i, bend: 0.1 + i * 0.04 }));
  const rs = new Rng(73);
  const place = [[], [], [], [], []];
  const add = (x, z, h, w) => {
    const y = floorH(x, z);
    const hh = h * rs.range(0.7, 1.2), ww = w * rs.range(0.75, 1.15);
    place[r.int(0, 4)].push({ p: [x, y + hh * 0.9, z], r: [rs.range(-0.09, 0.09), r.range(0, 6.28), rs.range(-0.09, 0.09)], s: [ww, hh, ww] });
  };
  // the row behind the action (composition of s31 / s36), then the forest beyond
  for (const [x, z, h, w] of [[-1120, -300, 300, 70], [-880, -520, 230, 62], [-1400, -80, 340, 90], [-610, -880, 200, 56], [1020, -540, 240, 70], [1240, -320, 310, 90], [1480, -700, 270, 80], [780, -900, 220, 60], [1700, -240, 330, 110],
    [-380, -1240, 180, 56], [260, -1320, 230, 66], [-120, -1560, 260, 70], [620, -1460, 280, 80], [-860, -1500, 300, 90],
    // framing stacks close to the s31 / s36 camera
    [-420, 300, 250, 84], [-560, 420, 330, 110], [520, 260, 240, 80],
    // the dark forest in the foreground of the wide shot, right of frame
    [120, 2300, 300, 90], [420, 2500, 380, 110], [640, 2150, 330, 100], [900, 2420, 420, 120], [1180, 2240, 390, 110], [1420, 2520, 470, 140], [1680, 2300, 420, 120], [260, 1900, 240, 70], [760, 1760, 280, 80], [1140, 1840, 320, 90], [1560, 1900, 340, 100], [-60, 2050, 220, 70], [1950, 2500, 500, 150]]) add(x, z, h, w);
  for (let i = 0; i < 120; i++) {
    const a = r.range(0, Math.PI * 2), d = r.range(1500, 4300);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (z > 1400 && x < 900 && x > -1500) continue;   // sightline of the wide shot
    const h = r.range(180, 560), w = h * r.range(0.18, 0.34);
    add(x, z, h, w);
  }
  place.forEach((l, i) => { if (l.length) group.add(instanced(geos[i], sm1, l)); });

  // strewn boulders: density and scale near the mound
  const bm = rockMaterial({ ...SPIRE, scale: 24, bump: 1, cauS: 90, id: 0, fleck: 0.5 });
  const bg = blobGeo({ seed: 8, detail: 11, amp: 0.3, freq: 1.8, fine: 0.1 });
  const bl = [];
  for (let i = 0; i < 520; i++) {
    const a = r.range(0, 6.28), d = 210 + Math.pow(r.next(), 1.6) * 1500;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const s = Math.pow(r.next(), 3) * 26 + 2.5;
    if (Math.abs(x) < 420 && z > 120) continue;
    bl.push({ p: [x, floorH(x, z) + s * 0.25, z], r: [r.range(0, 6), r.range(0, 6), r.range(0, 6)], s: [s, s * r.range(0.55, 0.9), s * r.range(0.8, 1.2)] });
  }
  group.add(instanced(bg, bm, bl));

  // cliffs framing the wide shots
  const wm = rockMaterial({ ...WALL, scale: 92, bump: 1.0, cauS: 220, strata: [0.25, 1, 0.1], stretch: 0.26, foot: [-1100, 500] });
  const cliffs = [
    wallGeo({ a: [-2500, 5200], b: [-1900, -700], foot: -1250, crest: -560, side: 1, seed: 3, depth: 300, s: 420, crestVar: 0.3 }),
    wallGeo({ a: [2600, -2200], b: [2750, 900], foot: -1200, crest: -300, side: -1, seed: 5, depth: 300, s: 420, crestVar: 0.5 }),
    wallGeo({ a: [-3600, -3600], b: [3800, -3900], foot: -1200, crest: -420, side: 1, seed: 7, depth: 380, s: 520, crestVar: 0.46 }),
  ];
  for (const c of cliffs) { const m = new THREE.Mesh(c, wm); m.frustumCulled = false; group.add(m); }
  // the dark near wall that frames the wide shot
  const wn = rockMaterial({ ...NEAR, scale: 70, bump: 1.1, cauS: 220, strata: [0.25, 1, 0.1], stretch: 0.26, foot: [-1100, 500] });
  const nearWall = new THREE.Mesh(wallGeo({ a: [-620, 3500], b: [-1500, 1000], foot: -1200, crest: -30, side: 1, seed: 8, depth: 240, s: 340, crestVar: 0.34 }), wn);
  nearWall.frustumCulled = false; group.add(nearWall);

  // the mound itself, sculpted for macro: black rock with wet glints, inked close up
  const MOUND = { top: '#7fe4e0', lit: '#2c78a8', lit2: '#23609a', shd: '#163a7c', shd2: '#112c68', deep: '#0a1c4e', scale: 19, id: 7, bump: 1.25, growth: 0.28, cauS: 70, local: true, fleck: 0.8 };
  const moundMat = rockMaterial(MOUND);
  const moundG = blobGeo({ seed: 12.4, detail: 70, rx: 165, ry: 118, rz: 150, amp: 0.2, freq: 1.5, fine: 0.06, terr: 0.1, terrN: 5, flat: 0.25 });
  const mound = new THREE.Mesh(moundG, moundMat);
  mound.position.set(0, FY + 6, 0);
  group.add(mound);
  // what is left after the burst, and the pieces that leave
  const stumpG = blobGeo({ seed: 5.2, detail: 50, rx: 168, ry: 112, rz: 150, amp: 0.3, freq: 2.2, fine: 0.09, terr: 0.16, terrN: 4, flat: 0.25 });
  const stump = new THREE.Mesh(stumpG, moundMat);
  stump.position.set(0, FY + 4, 0); stump.visible = false;
  group.add(stump);
  const chunkG = blobGeo({ seed: 2.7, detail: 12, amp: 0.42, freq: 1.5, fine: 0.1, terr: 0.2, terrN: 3 });
  const chunkMat = rockMaterial({ ...MOUND, id: 9, local: false, scale: 22, growth: 0 });
  const seeds = [];
  {
    const q = new Rng(606);
    for (let i = 0; i < 46; i++) {
      const az = q.range(0, 6.28), up = Math.pow(q.next(), 0.6), big = i < 24;
      const sp = q.range(120, 560) * (big ? 0.5 : 1), rr = q.range(10, 130) * (1 - up * 0.6);
      const sz = big ? q.range(20, 44) * (i < 7 ? 1.5 : 1) : q.range(6, 18);
      seeds.push({
        p: [Math.cos(az) * rr, FY + 34 + up * 84, Math.sin(az) * rr],
        v: [Math.cos(az) * sp * (1.05 - up), sp * (0.45 + 0.9 * up), Math.sin(az) * sp * (1.05 - up)],
        r: [q.range(0, 6), q.range(0, 6), q.range(0, 6)], w: [q.range(-3, 3), q.range(-3, 3)], s: [sz, sz * q.range(0.6, 1), sz * q.range(0.7, 1.2)], del: q.range(0, 0.1),
      });
    }
  }
  const chunks = instanced(chunkG, chunkMat, seeds.map((s) => ({ p: s.p, r: s.r, s: s.s })));
  chunks.visible = false;
  group.add(chunks);

  // the hero cameras sit around x 0, z 300..1300: nothing near them, colour stays at mid distance
  const skip = (x, z) => (Math.abs(x) < 1000 && z > -200 && z < 1800) || z > 2000;
  dress(group, r, { n: 2200, x0: -2200, x1: 2200, z0: -2000, z1: 2000, s0: 5, s1: 15, clear: 620, skip });
  const kelp = kelpBeds(group, r, { n: 700, x0: -2200, x1: 2200, z0: -1800, z1: 2000, s0: 46, s1: 110, clear: 760, skip });

  return { group, mound, stump, chunks, seeds, kelp };
}

// The canyon: a narrow slot between two walls, opening toward the light.
export function buildCanyon(ctx, root, ov) {
  const group = new THREE.Group(); group.name = 'canyon'; root.add(group);
  const r = new Rng(77);
  const canyonH = (x, z) => FY - 80 + 40 * fbm(x / 240, 1, z / 240, 4) + 180 * sm(160, 900, Math.abs(x + 200 + 80 * Math.sin(z / 800)));
  const wm = rockMaterial({ ...WALL, scale: 80, bump: 1.05, cauS: 200, strata: [0.2, 1, 0.05], stretch: 0.26, foot: [-1100, 500] });
  const wn = rockMaterial({ ...NEAR, scale: 64, bump: 1.1, cauS: 200, strata: [0.2, 1, 0.05], stretch: 0.26, foot: [-1100, 500] });
  const right = new THREE.Mesh(wallGeo({ a: [600, 1100], b: [800, -3400], foot: -1280, crest: 0, side: -1, seed: 2.2, depth: 320, s: 360, crestVar: 0.12, nu: 340, nv: 300 }), wn);
  right.frustumCulled = false; group.add(right);
  const walls = [
    wallGeo({ a: [-800, 1200], b: [-330, -3600], foot: -1280, crest: -20, side: 1, seed: 4.1, depth: 300, s: 380, crestVar: 0.24, nu: 340, nv: 300 }),
    wallGeo({ a: [-1500, -3400], b: [1700, -3300], foot: -1280, crest: -360, side: 1, seed: 6.3, depth: 340, s: 420, crestVar: 0.5 }),
  ];
  for (const g of walls) { const m = new THREE.Mesh(g, wm); m.frustumCulled = false; group.add(m); }
  const floor = new THREE.Mesh(floorGeo(200, 260, 4200, canyonH), wm);
  floor.frustumCulled = false; group.add(floor);
  // lone stacks in the slot
  const sm1 = rockMaterial({ ...SPIRE, scale: 62, cauS: 170 });
  const g = blobGeo({ seed: 21, detail: 30, taper: 0.95, pow: 0.8, amp: 0.34, freq: 2, fine: 0.09, terr: 0.34, terrN: 7 });
  const l = [];
  for (let i = 0; i < 26; i++) {
    const z = r.range(-2600, -700), x = r.range(-500, 200), h = r.range(180, 460);
    l.push({ p: [x, canyonH(x, z) + h * 0.8, z], r: [0, r.range(0, 6), 0], s: [h * 0.3, h, h * 0.3] });
  }
  group.add(instanced(g, sm1, l));
  kelpBeds(group, r, { n: 300, x0: -900, x1: 260, z0: -2400, z1: 700, s0: 40, s1: 110, clear: -1 }, canyonH);
  dress(group, r, { n: 500, x0: -900, x1: 260, z0: -2400, z1: 700, s0: 8, s1: 26, clear: -1 }, canyonH);
  return { group };
}

export function buildBurst() { return null; }
