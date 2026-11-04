import * as THREE from 'three';
import { v3, hull, cbox, superPts, cyl, cylZ, cylX, ring, ball, ribs, extrude, tube, patch, solid, Kit } from './archer-geo.js';
import { deg } from './util.js';

// The colossal archer. One unit = 10 m. +Y up, +Z the way the chest faces, +X the robot's left.
// Faces the camera in the wide shots: bow in the RIGHT hand (screen left), draws with the LEFT.
export const STY = {
  PALE: { col: '#eef1f6', metal: 0.72, detail: 1, tone: 0.03 },
  SILVER: { col: '#d4dbe8', metal: 0.86, detail: 1, tone: 0.05 },
  STEEL: { col: '#a3aec6', metal: 0.8, detail: 1, tone: 0.06 },
  BLUESTEEL: { col: '#6d7f9e', metal: 0.9, detail: 0.7, tone: 0.05 },
  GUN: { col: '#59617a', metal: 0.55, detail: 0.8, tone: 0.08 },
  DARK: { col: '#363b52', metal: 0.35, detail: 0.5, tone: 0.08, wear: 0.5 },
  BRONZE: { col: '#c99a62', metal: 0.82, detail: 0.3, tone: 0.07, wear: 0.6 },
  PISTON: { col: '#f2f4f8', metal: 1, detail: 0, tone: 0, wear: 0.15 },
  RED: { col: '#dc4632', metal: 0.25, detail: 0.2, tone: 0.03, wear: 0.6 },
  CORE: { col: '#bfe8ff', metal: 0, detail: 0, emis: 1, tone: 0, wear: 0 },
  VISOR: { col: '#101320', metal: 0, detail: 0, emis: 2, tone: 0, wear: 0 },
};

export function buildArcher(material) {
  const j = {};
  const root = new THREE.Group(); root.name = 'archer'; j.root = root;
  const J = (name, parent, pos) => { const g = new THREE.Group(); g.name = name; g.position.set(...pos); parent.add(g); j[name] = g; return g; };
  const k = new Kit(11);
  const { PALE, SILVER, STEEL, BLUESTEEL, GUN, DARK, BRONZE, PISTON, RED, CORE, VISOR } = STY;

  const pelvis = J('pelvis', root, [0, 6.1, 0]);
  const waist = J('waist', pelvis, [0, 0.5, 0]);
  const chest = J('chest', waist, [0, 0.85, 0]);
  const neck = J('neck', chest, [0, 1.8, 0.03]);
  const head = J('head', neck, [0, 0.32, 0.02]);
  for (const [s, L] of [[1, 'L'], [-1, 'R']]) {
    const hip = J('hip' + L, pelvis, [s * 0.62, -0.22, 0]);
    const knee = J('knee' + L, hip, [0, -2.75, 0]);
    J('cap' + L, knee, [0, 0, 0]);
    J('ank' + L, knee, [0, -2.7, 0]);
    J('tas' + L, pelvis, [s * 0.86, 0.0, 0.05]);
    const sh = J('sh' + L, chest, [s * 1.26, 1.34, 0]);
    J('pd' + L, sh, [0, 0, 0]);
    const arm = J('arm' + L, sh, [0, 0, 0]);
    const el = J('el' + L, arm, [0, -1.85, 0]);
    J('wr' + L, el, [0, -1.95, 0]);
  }

  buildHead(k);
  buildTorso(k);
  for (const [s, L] of [[1, 'L'], [-1, 'R']]) { buildArm(k, j, s, L); buildHand(k, J, j, s, L); buildLeg(k, s, L); }

  const meshes = k.finish(j, material);
  return { root, j, meshes, tris: k.tris };
}

// ------------------------------------------------------------------- head
function buildHead(k) {
  const { PALE, SILVER, STEEL, BLUESTEEL, GUN, DARK, BRONZE, VISOR, RED } = STY;
  const b = 'head';
  // the dome: round and smooth, dark blue-steel so the sky rolls over it in one big band
  const H = tube([[-0.06, 0.34, 0.38, 0.03, 2.2], [0.12, 0.45, 0.49, 0.03, 2.2], [0.42, 0.5, 0.53, 0, 2.15], [0.68, 0.45, 0.47, -0.01, 2.1], [0.86, 0.28, 0.3, -0.02, 2.05], [0.94, 0.04, 0.05, -0.02, 2]]);
  k.add(b, solid(H, { nu: 28, nv: 12, crease: 50 }), { ...BLUESTEEL, detail: 0.25, wear: 0.5 });

  // centre crest, nose to nape
  k.add(b, patch(H, [[-0.028, 0.4], [0.028, 0.4], [0.02, 1.0], [-0.02, 1.0]], { nu: 2, nv: 7, t: 0.03, lift: 0.0, ridge: 0.02 }), PALE);
  k.add(b, patch(H, [[0.47, 0.25], [0.53, 0.25], [0.51, 0.97], [0.49, 0.97]], { nu: 2, nv: 7, t: 0.03 }), SILVER);
  for (const s of [1, -1]) {
    const M = { mirror: s < 0 };
    // pale forehead panels, riveted, as on the reference's helmet
    k.add(b, patch(H, [[0.035, 0.52], [0.13, 0.5], [0.15, 0.82], [0.03, 0.86]], { nu: 3, nv: 4, t: 0.025 }), PALE, undefined, undefined, M);
    // temple bar sweeping back
    k.add(b, patch(H, [[0.13, 0.52], [0.36, 0.46], [0.40, 0.58], [0.15, 0.64]], { nu: 5, nv: 2, t: 0.03 }), SILVER, undefined, undefined, M);
    // side skull plate with an ear ring
    k.add(b, patch(H, [[0.2, 0.2], [0.38, 0.14], [0.42, 0.44], [0.24, 0.48]], { nu: 4, nv: 4, t: 0.035, crown: 0.02 }), STEEL, undefined, undefined, M);
    k.add(b, patch(H, [[0.38, 0.05], [0.47, 0.05], [0.47, 0.42], [0.41, 0.46]], { nu: 3, nv: 4, t: 0.03 }), GUN, undefined, undefined, M);
    k.add(b, cylX(0.13, 0.05, 20), BRONZE, [0.5, 0.36, -0.02], undefined, M);
    k.add(b, cylX(0.09, 0.08, 16), DARK, [0.5, 0.36, -0.02], undefined, M);
    k.add(b, cylX(0.045, 0.1, 10), PALE, [0.51, 0.36, -0.02], undefined, M);
    // cheek guard: an angular wedge running to the chin
    k.add(b, hull([v3(0.34, 0.42, 0.34), v3(0.46, 0.3, 0.1), v3(0.44, 0.0, 0.12), v3(0.26, -0.1, 0.38), v3(0.16, -0.16, 0.5), v3(0.14, 0.26, 0.6), v3(0.3, 0.3, 0.42), v3(0.4, 0.2, 0.0), v3(0.3, -0.12, 0.05)], 18), SILVER, undefined, undefined, M);
    // bright vent slits on the cheek
    for (let i = 0; i < 3; i++) k.add(b, cbox(0.03, 0.022, 0.13, 0.004), DARK, [0.385 - i * 0.02, 0.19 - i * 0.055, 0.28 + i * 0.03], [0, 28, 8], M);
    // brow plate over the visor
    k.add(b, hull([v3(0, 0.62, 0.56), v3(0.3, 0.6, 0.46), v3(0.42, 0.56, 0.28), v3(0.42, 0.48, 0.3), v3(0.3, 0.5, 0.48), v3(0, 0.5, 0.58), v3(0, 0.5, 0.42), v3(0.36, 0.56, 0.1)], 16), PALE, undefined, undefined, M);
  }
  // visor slit: thin, dark, wrapped
  k.add(b, patch(H, [[-0.135, 0.355], [0.135, 0.355], [0.135, 0.405], [-0.135, 0.405]], { nu: 10, nv: 1, t: 0.02, lift: 0.02, ch: 0.005 }), VISOR);
  // mask under the visor
  k.add(b, hull([v3(-0.3, 0.42, 0.42), v3(0.3, 0.42, 0.42), v3(0, 0.44, 0.6), v3(-0.14, 0.2, 0.58), v3(0.14, 0.2, 0.58), v3(0, -0.08, 0.58), v3(-0.16, -0.12, 0.46), v3(0.16, -0.12, 0.46), v3(-0.24, 0.3, 0.2), v3(0.24, 0.3, 0.2)], 16), STEEL);
  // chin keel
  k.add(b, hull([v3(0, 0.2, 0.61), v3(0.05, 0.1, 0.6), v3(-0.05, 0.1, 0.6), v3(0, -0.2, 0.56), v3(0.08, -0.18, 0.4), v3(-0.08, -0.18, 0.4), v3(0, 0.0, 0.4)], 14), PALE);
  k.add(b, cbox(0.1, 0.02, 0.02, 0.004), RED, [0, 0.74, 0.5], [-30, 0, 0]);
  // aerial stub behind the crest
  k.add(b, cyl(0.012, 0.02, 0.5, 6), DARK, [0.28, 0.85, -0.2], [-20, 0, -14]);
}

// ------------------------------------------------------------------ torso
function buildTorso(k) {
  const { PALE, SILVER, STEEL, GUN, DARK, BRONZE, PISTON, RED, CORE } = STY;
  // ------- ribcage
  const C = tube([[-0.15, 0.62, 0.44, 0, 2.6], [0.25, 0.86, 0.58, 0.03, 2.6], [0.75, 1.12, 0.72, 0.06, 2.6], [1.25, 1.2, 0.72, 0.04, 2.8], [1.62, 1.0, 0.6, 0, 2.6], [1.86, 0.52, 0.38, 0, 2.2]]);
  k.add('chest', solid(C, { k: 0.97, nu: 24, nv: 10 }), GUN);
  for (const s of [1, -1]) {
    const M = { mirror: s < 0 };
    const add = (c, o, st) => k.add('chest', patch(C, c, o), st, undefined, undefined, M);
    // great pectoral: a folded plate with a hard keel
    add([[0.025, 0.5], [0.205, 0.44], [0.225, 0.8], [0.035, 0.88]], { nu: 4, nv: 5, t: 0.09, ridge: 0.09, crown: 0.05, crease: 12 }, PALE);
    add([[0.03, 0.27], [0.19, 0.22], [0.205, 0.45], [0.03, 0.5]], { nu: 4, nv: 3, t: 0.07, ridge: 0.05 }, SILVER);
    add([[0.03, 0.87], [0.23, 0.8], [0.26, 0.97], [0.05, 1.0]], { nu: 4, nv: 3, t: 0.07, crown: 0.03 }, SILVER);
    // lat plate and three rib lames
    add([[0.215, 0.32], [0.355, 0.3], [0.385, 0.82], [0.235, 0.8]], { nu: 3, nv: 6, t: 0.08, ridge: 0.06 }, SILVER);
    for (let i = 0; i < 3; i++) add([[0.2, 0.02 + i * 0.1], [0.36, 0.02 + i * 0.1], [0.37, 0.14 + i * 0.1], [0.205, 0.14 + i * 0.1]], { nu: 3, nv: 2, t: 0.05, flare: 0.03 }, i % 2 ? STEEL : SILVER);
    // back
    add([[0.385, 0.14], [0.482, 0.14], [0.482, 0.95], [0.4, 0.92]], { nu: 3, nv: 6, t: 0.07, ridge: 0.04 }, STEEL);
    add([[0.27, 0.86], [0.4, 0.86], [0.46, 1.0], [0.3, 1.0]], { nu: 3, nv: 3, t: 0.07 }, SILVER);
    // shoulder socket, dark, with a bronze race
    k.add('chest', ball(0.5, 16, 12), DARK, [1.26, 1.34, 0], undefined, M);
    k.add('chest', cylX(0.5, 0.14, 24), BRONZE, [1.02, 1.34, 0], undefined, M);
    // trapezius rise to the neck
    k.add('chest', hull([v3(0.2, 1.72, 0.26), v3(0.2, 1.72, -0.26), v3(0.98, 1.5, 0.3), v3(0.98, 1.5, -0.3), v3(0.3, 2.0, 0.14), v3(0.3, 2.0, -0.14), v3(0.7, 1.74, 0.12), v3(0.7, 1.74, -0.12)], 22), SILVER, undefined, undefined, M);
    // collar wings
    k.add('chest', hull([v3(0.16, 1.9, 0.42), v3(0.5, 1.72, 0.48), v3(0.58, 1.6, 0.36), v3(0.2, 2.12, 0.28), v3(0.36, 2.0, 0.2), v3(0.12, 1.76, 0.46)], 18), PALE, undefined, undefined, M);
    // bronze side pistons from waist to ribs
    k.add('chest', cyl(0.045, 0.045, 0.9, 10), PISTON, [0.74, 0.32, -0.3], [12, 0, -14], M);
  }
  // sternum keel with the reactor
  k.add('chest', patch(C, [[-0.024, 0.08], [0.024, 0.08], [0.03, 0.46], [-0.03, 0.46]], { nu: 2, nv: 4, t: 0.11, ridge: 0.05 }), STEEL);
  k.add('chest', patch(C, [[-0.03, 0.8], [0.03, 0.8], [0.03, 1.0], [-0.03, 1.0]], { nu: 2, nv: 3, t: 0.11 }), SILVER);
  // reactor housing: hexagonal bronze ring, heavy steel bezel, cut crystal
  const hex = (r, y0 = 0) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + (i * Math.PI) / 3; return [Math.cos(a) * r, Math.sin(a) * r + y0]; });
  const cy = 1.0, cz = 0.8;
  k.add('chest', extrude(hex(0.33), 0.2, 0.025, [hex(0.235).reverse()]), SILVER, [0, cy, cz], [8, 0, 0]);
  k.add('chest', extrude(hex(0.25), 0.16, 0.012, [hex(0.205).reverse()]), BRONZE, [0, cy, cz + 0.07], [8, 0, 0]);
  const crystal = [];
  for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; crystal.push(v3(Math.cos(a) * 0.205, Math.sin(a) * 0.205, 0)); crystal.push(v3(Math.cos(a + 0.52) * 0.11, Math.sin(a + 0.52) * 0.11, 0.1)); }
  crystal.push(v3(0, 0, 0.14), v3(0, 0, -0.1));
  k.add('chest', hull(crystal, 6), CORE, [0, cy, cz + 0.03], [8, 0, 0]);

  // ------- waist: dark ribbed column with armoured lames over it
  k.add('waist', ribs(null, 0.62, 0.76, 1.1, 7, 18).map((g) => g.scale(1, 1, 0.72)), DARK, [0, 0.36, 0]);
  const W = tube([[-0.22, 0.74, 0.5, 0.04, 2.6], [0.2, 0.62, 0.46, 0.05, 2.6], [0.55, 0.6, 0.44, 0.05, 2.6], [0.9, 0.72, 0.5, 0.05, 2.6]]);
  for (let i = 0; i < 4; i++) {
    const v0 = 0.02 + i * 0.235, v1 = v0 + 0.27;
    k.add('waist', patch(W, [[-0.115, v0], [0.115, v0], [0.125, v1], [-0.125, v1]], { nu: 4, nv: 2, t: 0.06, flare: 0.05, ridge: 0.03 }), i % 2 ? SILVER : PALE);
    for (const s of [1, -1]) k.add('waist', patch(W, [[0.13, v0 + 0.02], [0.27, v0 + 0.02], [0.27, v1 - 0.01], [0.135, v1 - 0.01]], { nu: 3, nv: 2, t: 0.05, flare: 0.04 }), i % 2 ? STEEL : GUN, undefined, undefined, { mirror: s < 0 });
  }
  // bronze spine chain at the back
  for (let i = 0; i < 6; i++) {
    k.add('waist', cbox(0.24, 0.16, 0.14, 0.03), BRONZE, [0, -0.22 + i * 0.22, -0.5], [i % 2 ? 6 : -6, 0, 0]);
    k.add('waist', cylX(0.05, 0.3, 8), DARK, [0, -0.11 + i * 0.22, -0.5]);
  }

  // ------- pelvis
  const P = tube([[-0.82, 0.32, 0.3, 0.05, 2.6], [-0.42, 0.84, 0.52, 0.04, 2.6], [-0.02, 1.0, 0.62, 0, 2.7], [0.34, 0.84, 0.54, 0, 2.6], [0.5, 0.7, 0.46, 0, 2.5]]);
  k.add('pelvis', solid(P, { k: 0.96, nu: 20, nv: 8 }), GUN);
  // codpiece fold
  k.add('pelvis', patch(P, [[-0.055, 0.0], [0.055, 0.0], [0.125, 0.72], [-0.125, 0.72]], { nu: 2, nv: 5, t: 0.09, ridge: 0.08, crease: 12 }), PALE);
  k.add('pelvis', patch(P, [[-0.13, 0.72], [0.13, 0.72], [0.14, 1.0], [-0.14, 1.0]], { nu: 4, nv: 2, t: 0.08, flare: 0.03 }), SILVER);
  k.add('pelvis', cbox(0.3, 0.05, 0.03, 0.01), RED, [0, 0.08, 0.72], [-4, 0, 0]);
  for (const s of [1, -1]) {
    const M = { mirror: s < 0 };
    k.add('pelvis', patch(P, [[0.13, 0.32], [0.3, 0.3], [0.31, 0.95], [0.14, 0.95]], { nu: 3, nv: 4, t: 0.08, ridge: 0.05 }), SILVER, undefined, undefined, M);
    k.add('pelvis', patch(P, [[0.31, 0.2], [0.47, 0.1], [0.47, 0.9], [0.32, 0.92]], { nu: 3, nv: 4, t: 0.07, crown: 0.05 }), STEEL, undefined, undefined, M);
    k.add('pelvis', ball(0.56, 14, 10), DARK, [0.62, -0.22, 0], undefined, M);
    k.add('pelvis', cylX(0.46, 0.1, 22), BRONZE, [0.96, -0.22, 0], undefined, M);
  }
  // long tassets hanging off each hip: narrow feathers in a fan
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    const M = { mirror: s < 0 };
    const feather = (len, w, t) => hull([v3(-w * 0.5, 0, t), v3(w * 0.5, 0, t), v3(w * 0.42, 0, -t), v3(-w * 0.42, 0, -t), v3(-w * 0.62, -len * 0.52, t * 0.7), v3(w * 0.58, -len * 0.56, t * 0.7), v3(-w * 0.52, -len * 0.5, -t * 0.7), v3(w * 0.5, -len * 0.5, -t * 0.7), v3(w * 0.05, -len, 0)], 16);
    k.add('tas' + L, feather(1.7, 0.42, 0.06), SILVER, [0.08, 0, 0.16], [8, 6, 4], M);
    k.add('tas' + L, feather(1.5, 0.36, 0.05), STEEL, [0.12, 0, -0.2], [-6, 0, 10], M);
    k.add('tas' + L, feather(1.15, 0.32, 0.05), PALE, [0.0, 0.05, 0.46], [10, 18, 0], M);
    k.add('tas' + L, cylX(0.11, 0.26, 12), BRONZE, [0.1, 0, 0], undefined, M);
  }
}

// --------------------------------------------------------------------- arm
function buildArm(k, j, s, L) {
  const { PALE, SILVER, STEEL, GUN, DARK, BRONZE, PISTON, RED } = STY;
  const M = { mirror: s < 0 };
  const arm = 'arm' + L, el = 'el' + L, wr = 'wr' + L, pd = 'pd' + L;
  // ---- upper arm
  const A = tube([[0.1, 0.36, 0.38], [-0.35, 0.43, 0.45], [-0.9, 0.39, 0.41], [-1.5, 0.31, 0.33], [-1.85, 0.27, 0.29]]);
  k.add(arm, solid(A, { k: 0.95, nu: 18, nv: 6 }), DARK, undefined, undefined, M);
  const addA = (c, o, st) => k.add(arm, patch(A, c, o), st, undefined, undefined, M);
  addA([[-0.13, 0.2], [0.13, 0.2], [0.14, 0.88], [-0.14, 0.88]], { nu: 4, nv: 5, t: 0.07, ridge: 0.05 }, SILVER);
  addA([[0.15, 0.1], [0.37, 0.1], [0.38, 0.92], [0.16, 0.9]], { nu: 4, nv: 5, t: 0.07, ridge: 0.05 }, STEEL);
  addA([[0.39, 0.1], [0.61, 0.1], [0.62, 0.9], [0.4, 0.92]], { nu: 4, nv: 5, t: 0.06 }, SILVER);
  addA([[-0.37, 0.1], [-0.15, 0.1], [-0.16, 0.9], [-0.38, 0.92]], { nu: 4, nv: 5, t: 0.05 }, GUN);
  // biceps-to-elbow actuator
  k.add(arm, cyl(0.07, 0.07, 0.9, 10), DARK, [0.1, -0.85, 0.42], undefined, M);
  k.add(arm, cyl(0.04, 0.04, 1.2, 10), PISTON, [0.1, -1.1, 0.42], undefined, M);
  // elbow knuckle
  k.add(arm, cylX(0.31, 0.52, 20), DARK, [0, -1.85, 0], undefined, M);
  k.add(arm, cylX(0.22, 0.58, 16), BRONZE, [0, -1.85, 0], undefined, M);
  k.add(arm, cylX(0.11, 0.64, 12), GUN, [0, -1.85, 0], undefined, M);

  // ---- pauldron: four stacked shells opening down the arm (see ref s04)
  const D = tube([[0.72, 0.1, 0.12, 0, 2.3, 0.1], [0.56, 0.6, 0.68, 0, 2.3, 0.18], [0.24, 0.9, 0.96, 0, 2.5, 0.2], [-0.16, 0.98, 1.04, 0, 2.6, 0.2], [-0.62, 0.9, 0.96, 0, 2.6, 0.16]]);
  const c = 0.25, w0 = 0.46;
  const lame = (v0, v1, w, o, st) => k.add(pd, patch(D, [[c - w, v0], [c + w, v0], [c + w * 1.02, v1], [c - w * 1.02, v1]], { nu: 8, nv: 3, ...o }), st, undefined, undefined, M);
  lame(0.0, 0.42, w0, { t: 0.09, crown: 0.06, lift: 0.0, crease: 14 }, PALE);
  lame(0.38, 0.6, w0, { t: 0.08, flare: 0.1, lift: 0.0 }, SILVER);
  lame(0.56, 0.78, w0 * 0.98, { t: 0.08, flare: 0.1, lift: 0.02 }, STEEL);
  lame(0.74, 1.0, w0 * 0.96, { t: 0.09, flare: 0.14, lift: 0.04 }, SILVER);
  // the crown rib running over the shell
  k.add(pd, patch(D, [[c - 0.03, 0.05], [c + 0.03, 0.05], [c + 0.035, 0.42], [c - 0.035, 0.42]], { nu: 2, nv: 4, t: 0.05, lift: 0.1, ridge: 0.03 }), BRONZE, undefined, undefined, M);
  k.add(pd, patch(D, [[c + 0.12, 0.42], [c + 0.3, 0.42], [c + 0.3, 0.55], [c + 0.12, 0.55]], { nu: 3, nv: 1, t: 0.015, lift: 0.17 }), RED, undefined, undefined, M);
  // inner liner so the shell has thickness and depth from below
  k.add(pd, solid(tube([[0.5, 0.5, 0.56, 0, 2.3, 0.14], [0.2, 0.82, 0.88, 0, 2.4, 0.2], [-0.5, 0.78, 0.84, 0, 2.4, 0.16]]), { nu: 20, nv: 5, caps: false }), DARK, undefined, undefined, M);

  // ---- forearm: a great faceted vambrace, kite section (ref s01)
  const F = tube([[0.05, 0.3, 0.3, 0, 2.6], [-0.42, 0.42, 0.46, 0.03, 2.9], [-0.95, 0.44, 0.47, 0.03, 3.1], [-1.45, 0.34, 0.34, 0.01, 2.8], [-1.8, 0.26, 0.26, 0, 2.5], [-1.95, 0.24, 0.24, 0, 2.4]]);
  k.add(el, solid(F, { k: 0.94, nu: 18, nv: 7 }), DARK, undefined, undefined, M);
  const addF = (c2, o, st) => k.add(el, patch(F, c2, o), st, undefined, undefined, M);
  addF([[-0.115, 0.04], [0.115, 0.04], [0.09, 0.9], [-0.09, 0.9]], { nu: 2, nv: 6, t: 0.08, ridge: 0.08, crease: 12 }, PALE);
  addF([[0.13, 0.03], [0.37, 0.03], [0.34, 0.88], [0.105, 0.88]], { nu: 2, nv: 6, t: 0.08, ridge: 0.1, crease: 12 }, SILVER);
  addF([[0.385, 0.03], [0.615, 0.03], [0.59, 0.88], [0.41, 0.88]], { nu: 2, nv: 6, t: 0.08, ridge: 0.09, crease: 12 }, STEEL);
  addF([[-0.37, 0.03], [-0.13, 0.03], [-0.105, 0.88], [-0.34, 0.88]], { nu: 2, nv: 6, t: 0.08, ridge: 0.1, crease: 12 }, SILVER);
  // overlapping elbow cop and a raised rail
  addF([[-0.05, -0.0], [0.5, -0.0], [0.42, 0.3], [0.02, 0.3]], { nu: 5, nv: 3, t: 0.07, lift: 0.08, flare: 0.05 }, PALE);
  addF([[0.17, 0.32], [0.3, 0.32], [0.26, 0.7], [0.21, 0.7]], { nu: 2, nv: 3, t: 0.03, lift: 0.14 }, GUN);
  // wrist cuff: lames, bronze race, dark ribbed gaiter
  for (let i = 0; i < 2; i++) addF([[-0.5, 0.86 + i * 0.055], [0.5, 0.86 + i * 0.055], [0.5, 0.92 + i * 0.055], [-0.5, 0.92 + i * 0.055]], { nu: 16, nv: 1, t: 0.04, lift: 0.03 - i * 0.015 }, i ? STEEL : SILVER);
  k.add(el, ring(0.29, 0.045, 28), BRONZE, [0, -1.88, 0]);
  k.add(el, ribs(null, 0.25, 0.23, 0.34, 4, 18), DARK, [0, -2.02, 0]);
  k.add(wr, ring(0.26, 0.035, 24), BRONZE, [0, -0.2, 0]);
  void wr;
}

// -------------------------------------------------------------------- hand
function buildHand(k, J, j, s, L) {
  const { PALE, SILVER, STEEL, GUN, DARK, BRONZE, PISTON } = STY;
  const M = { mirror: s < 0 };
  const wr = 'wr' + L;
  // palm core; back of the hand is +X for the left hand, -X for the right (mirrored)
  k.add(wr, cbox(0.3, 0.66, 0.82, 0.07, { wt: 0.32, dt: 0.84 }), DARK, [0, -0.5, 0], [0, 0, 180], M);
  // back of the hand: a raised metacarpal bar for each finger over a dark plate, like ribs, with a wrist shield
  k.add(wr, cbox(0.12, 0.54, 0.74, 0.02, { wt: 0.12, dt: 0.5 }), { ...GUN, detail: 0.4 }, [0.15, -0.46, 0], [0, 0, 180], M);
  for (let i = 0; i < 4; i++) {
    const z0 = 0.285 - i * 0.19, zw = z0 * 0.62, w = 0.078;
    k.add(wr, hull([v3(0.17, -0.24, zw + w * 0.7), v3(0.17, -0.24, zw - w * 0.7), v3(0.25, -0.3, zw + w * 0.6), v3(0.25, -0.3, zw - w * 0.6), v3(0.27, -0.56, z0 + w * 0.8), v3(0.27, -0.56, z0 - w * 0.8), v3(0.17, -0.66, z0 + w), v3(0.17, -0.66, z0 - w), v3(0.3, -0.44, (z0 + zw) / 2 + w * 0.4), v3(0.3, -0.44, (z0 + zw) / 2 - w * 0.4)], 12), i % 2 ? { ...STEEL, detail: 0.4 } : { ...SILVER, detail: 0.4 }, undefined, undefined, M);
  }
  k.add(wr, hull([v3(0.13, -0.08, 0.2), v3(0.13, -0.08, -0.2), v3(0.26, -0.14, 0.22), v3(0.26, -0.14, -0.22), v3(0.3, -0.28, 0.12), v3(0.3, -0.28, -0.12), v3(0.14, -0.3, 0.3), v3(0.14, -0.3, -0.3), v3(0.31, -0.2, 0)], 14), { ...PALE, detail: 0.5 }, undefined, undefined, M);
  // palm side: pad and heel
  k.add(wr, cbox(0.06, 0.42, 0.62, 0.02), GUN, [-0.17, -0.5, 0], undefined, M);
  k.add(wr, hull([v3(-0.16, -0.14, 0.34), v3(-0.16, -0.14, -0.34), v3(-0.24, -0.3, 0.3), v3(-0.24, -0.3, -0.3), v3(-0.16, -0.44, 0.34), v3(-0.16, -0.44, -0.34)], 18), STEEL, undefined, undefined, M);
  // thenar: the big thumb base
  k.add(wr, hull([v3(-0.06, -0.14, 0.26), v3(0.14, -0.14, 0.3), v3(-0.14, -0.3, 0.52), v3(0.08, -0.3, 0.56), v3(-0.06, -0.54, 0.46), v3(0.12, -0.54, 0.44), v3(-0.14, -0.2, 0.3), v3(-0.18, -0.46, 0.34)], 16), SILVER, undefined, undefined, M);

  const segLen = [[0.36, 0.29, 0.23], [0.38, 0.3, 0.24], [0.36, 0.29, 0.23], [0.3, 0.25, 0.2]];
  const fingers = [];
  // a hexagonal tapered bar, one flat facing the back of the hand: bright dorsal facet, dark flanks
  const hexBar = (len, r0, r1, y0 = 0) => {
    const pts = [];
    for (const [y, r] of [[y0, r0 * 0.86], [y0 - len * 0.1, r0], [y0 - len * 0.9, r1], [y0 - len, r1 * 0.84]]) {
      pts.push(v3(r * 0.98, y, r * 0.5), v3(r * 0.98, y, -r * 0.5), v3(0, y, r), v3(0, y, -r), v3(-r * 0.92, y, r * 0.5), v3(-r * 0.92, y, -r * 0.5));
    }
    return hull(pts, 12);
  };
  const phal = (bin, len, rw, tip) => {
    // the rolling joint: a dark drum between two side cheeks, a small pale pin
    k.add(bin, cylZ(rw * 0.74, rw * 1.9, 14), { ...DARK, col: '#454b64', metal: 0.62 }, [0, 0, 0], undefined, M);
    k.add(bin, cylZ(rw * 0.36, rw * 2.04, 10), STEEL, [0, 0, 0], undefined, M);
    // the phalanx, shorter than the bone so the dark joint shows between segments
    const L0 = len * (tip ? 0.96 : 0.74);
    k.add(bin, hexBar(L0, rw * 1.04, rw * (tip ? 0.86 : 0.96), -len * 0.13), { ...SILVER, detail: 0.35 }, undefined, undefined, M);
    // dorsal strake and a recessed under-plate
    k.add(bin, cbox(rw * 0.3, L0 * 0.66, rw * 1.1, 0.012), { ...GUN, detail: 0.2 }, [-rw * 0.86, -len * 0.13 - L0 * 0.5, 0], undefined, M);
    if (tip) k.add(bin, hull([v3(rw * 0.9, -len * 1.02, rw * 0.5), v3(rw * 0.9, -len * 1.02, -rw * 0.5), v3(rw * 0.3, -len * 1.2, rw * 0.3), v3(rw * 0.3, -len * 1.2, -rw * 0.3), v3(-rw * 0.5, -len * 1.1, rw * 0.5), v3(-rw * 0.5, -len * 1.1, -rw * 0.5), v3(rw * 0.2, -len * 0.9, rw * 0.84), v3(rw * 0.2, -len * 0.9, -rw * 0.84)], 16), STEEL, undefined, undefined, M);
  };
  for (let i = 0; i < 4; i++) {
    const z = 0.285 - i * 0.19;
    const [l0, l1, l2] = segLen[i];
    const rw = 0.086;
    const fa = J(`f${L}${i}a`, j[wr], [0, -0.78, z]);
    const fb = J(`f${L}${i}b`, fa, [0, -l0, 0]);
    const fc = J(`f${L}${i}c`, fb, [0, -l1, 0]);
    phal(fa.name, l0, rw, false);
    phal(fb.name, l1, rw * 0.96, false);
    phal(fc.name, l2, rw * 0.92, true);
    k.add(wr, hull([v3(0.16, -0.64, z + 0.08), v3(0.16, -0.64, z - 0.08), v3(0.22, -0.72, z + 0.075), v3(0.22, -0.72, z - 0.075), v3(0.15, -0.84, z + 0.08), v3(0.15, -0.84, z - 0.08), v3(-0.1, -0.84, z + 0.08), v3(-0.1, -0.84, z - 0.08), v3(-0.1, -0.64, z + 0.08), v3(-0.1, -0.64, z - 0.08)], 14), STEEL, undefined, undefined, M);
    k.add(wr, cylZ(0.05, 0.17, 8), DARK, [0.2, -0.72, z], undefined, M);
    fingers.push([fa, fb, fc]);
  }
  j['fingers' + L] = fingers;
  const th = J('th' + L, j[wr], [-s * 0.02, -0.46, 0.46]);
  const th2 = J('th2' + L, th, [0, -0.36, 0]);
  const th3 = J('th3' + L, th2, [0, -0.3, 0]);
  phal(th.name, 0.36, 0.105, false);
  phal(th2.name, 0.3, 0.1, false);
  phal(th3.name, 0.26, 0.094, true);
}

// --------------------------------------------------------------------- leg
function buildLeg(k, s, L) {
  const { PALE, SILVER, STEEL, BLUESTEEL, GUN, DARK, BRONZE, PISTON, RED } = STY;
  const M = { mirror: s < 0 };
  const hip = 'hip' + L, knee = 'knee' + L, ank = 'ank' + L, cap = 'cap' + L;
  // ---- thigh: a long teardrop, huge sweeping plates
  const T = tube([[0.4, 0.44, 0.5, 0, 2.6], [-0.15, 0.6, 0.68, 0.03, 2.7], [-0.9, 0.62, 0.71, 0.05, 2.8], [-1.7, 0.5, 0.58, 0.03, 2.7], [-2.3, 0.38, 0.44, 0, 2.6], [-2.75, 0.34, 0.38, 0, 2.4]]);
  k.add(hip, solid(T, { k: 0.95, nu: 22, nv: 9 }), DARK, undefined, undefined, M);
  const addT = (c, o, st) => k.add(hip, patch(T, c, o), st, undefined, undefined, M);
  addT([[-0.125, 0.08], [0.125, 0.08], [0.1, 0.74], [-0.1, 0.74]], { nu: 2, nv: 6, t: 0.09, ridge: 0.09, crease: 11 }, PALE);
  addT([[0.135, 0.06], [0.31, 0.06], [0.28, 0.78], [0.11, 0.76]], { nu: 3, nv: 6, t: 0.08, ridge: 0.08, crease: 11 }, SILVER);
  addT([[0.325, 0.08], [0.47, 0.08], [0.47, 0.82], [0.295, 0.8]], { nu: 3, nv: 6, t: 0.08, ridge: 0.05 }, STEEL);
  addT([[-0.31, 0.06], [-0.135, 0.06], [-0.11, 0.76], [-0.28, 0.78]], { nu: 3, nv: 6, t: 0.08, ridge: 0.08, crease: 11 }, SILVER);
  addT([[-0.47, 0.08], [-0.325, 0.08], [-0.295, 0.8], [-0.47, 0.82]], { nu: 3, nv: 6, t: 0.07 }, GUN);
  addT([[-0.5, 0.0], [0.5, 0.0], [0.5, 0.14], [-0.5, 0.14]], { nu: 16, nv: 2, t: 0.06, flare: 0.04, lift: 0.04 }, SILVER);
  addT([[0.1, 0.1], [0.38, 0.1], [0.36, 0.42], [0.14, 0.42]], { nu: 4, nv: 3, t: 0.05, lift: 0.08, crown: 0.03 }, PALE);
  // lower lames over the knee
  addT([[-0.2, 0.74], [0.2, 0.74], [0.2, 0.88], [-0.2, 0.88]], { nu: 6, nv: 2, t: 0.07, flare: 0.05, lift: 0.02 }, SILVER);
  addT([[-0.17, 0.86], [0.17, 0.86], [0.15, 0.98], [-0.15, 0.98]], { nu: 6, nv: 2, t: 0.06, flare: 0.05, lift: 0.02 }, STEEL);
  // hamstring actuator
  k.add(hip, cyl(0.09, 0.09, 1.1, 10), DARK, [0, -1.0, -0.72], [6, 0, 0], M);
  k.add(hip, cyl(0.05, 0.05, 1.6, 10), PISTON, [0, -1.75, -0.58], [6, 0, 0], M);

  // ---- knee: the dark drum with bronze races, cap rolling at half angle
  k.add(knee, cylX(0.38, 0.66, 24), DARK, undefined, undefined, M);
  k.add(knee, cylX(0.3, 0.8, 20), STEEL, undefined, undefined, M);
  k.add(knee, cylX(0.34, 0.08, 20), BRONZE, [0.3, 0, 0], undefined, M);
  k.add(knee, cylX(0.34, 0.08, 20), BRONZE, [-0.3, 0, 0], undefined, M);
  k.add(knee, cylX(0.18, 0.86, 14), GUN, undefined, undefined, M);
  // the cap: a smooth dark shell over the drum, a pale keel and two side guards, rolling at half angle
  const KN = tube([[-0.62, 0.3, 0.2, 0.42, 2.4], [-0.3, 0.46, 0.3, 0.46, 2.5], [0.1, 0.5, 0.33, 0.47, 2.5], [0.46, 0.42, 0.27, 0.42, 2.4], [0.64, 0.24, 0.14, 0.36, 2.2]]);
  k.add(cap, solid(KN, { nu: 20, nv: 8, crease: 42 }), { ...DARK, col: '#2f3550', metal: 0.7, detail: 0.6 }, undefined, undefined, M);
  k.add(cap, patch(KN, [[-0.07, 0.12], [0.07, 0.12], [0.05, 0.86], [-0.05, 0.86]], { nu: 2, nv: 5, t: 0.04, ridge: 0.05, crease: 12 }), GUN, undefined, undefined, M);
  k.add(cap, patch(KN, [[0.12, 0.24], [0.27, 0.22], [0.25, 0.76], [0.14, 0.72]], { nu: 2, nv: 4, t: 0.03 }), BLUESTEEL, undefined, undefined, M);
  k.add(cap, patch(KN, [[-0.27, 0.22], [-0.12, 0.24], [-0.14, 0.72], [-0.25, 0.76]], { nu: 2, nv: 4, t: 0.03 }), BLUESTEEL, undefined, undefined, M);
  k.add(cap, cbox(0.1, 0.8, 0.12, 0.03), STEEL, [0.46, 0, 0.32], [0, 0, -5], M);
  k.add(cap, cbox(0.1, 0.8, 0.12, 0.03), STEEL, [-0.46, 0, 0.32], [0, 0, 5], M);

  // ---- shin
  const N = tube([[-0.1, 0.36, 0.38, 0, 2.4], [-0.7, 0.47, 0.52, -0.06, 2.7], [-1.35, 0.46, 0.53, -0.1, 2.8], [-2.0, 0.35, 0.41, -0.06, 2.6], [-2.5, 0.29, 0.32, -0.02, 2.4], [-2.72, 0.28, 0.31, 0, 2.4]]);
  k.add(knee, solid(N, { k: 0.95, nu: 18, nv: 8 }), DARK, undefined, undefined, M);
  const addN = (c, o, st) => k.add(knee, patch(N, c, o), st, undefined, undefined, M);
  addN([[-0.145, 0.08], [0.145, 0.08], [0.11, 0.6], [-0.11, 0.6]], { nu: 2, nv: 5, t: 0.09, ridge: 0.1, crease: 11 }, PALE);
  addN([[-0.12, 0.58], [0.12, 0.58], [0.1, 0.9], [-0.1, 0.9]], { nu: 2, nv: 4, t: 0.09, ridge: 0.07, lift: 0.02, crease: 11 }, SILVER);
  addN([[0.155, 0.06], [0.33, 0.06], [0.3, 0.92], [0.13, 0.9]], { nu: 3, nv: 6, t: 0.08, ridge: 0.08, crease: 11 }, SILVER);
  addN([[-0.33, 0.06], [-0.155, 0.06], [-0.13, 0.9], [-0.3, 0.92]], { nu: 3, nv: 6, t: 0.08, ridge: 0.08, crease: 11 }, STEEL);
  addN([[0.345, 0.1], [0.5, 0.1], [0.5, 0.86], [0.32, 0.86]], { nu: 3, nv: 5, t: 0.08, ridge: 0.05 }, STEEL);
  addN([[-0.5, 0.1], [-0.345, 0.1], [-0.32, 0.86], [-0.5, 0.86]], { nu: 3, nv: 5, t: 0.07 }, GUN);
  addN([[0.16, 0.14], [0.31, 0.14], [0.28, 0.46], [0.19, 0.46]], { nu: 3, nv: 3, t: 0.05, lift: 0.09, crown: 0.02 }, PALE);
  addN([[0.19, 0.48], [0.28, 0.48], [0.25, 0.64], [0.22, 0.64]], { nu: 2, nv: 2, t: 0.03, lift: 0.09 }, RED);
  // ankle cuff
  for (let i = 0; i < 3; i++) addN([[-0.5, 0.86 + i * 0.05], [0.5, 0.86 + i * 0.05], [0.5, 0.92 + i * 0.05], [-0.5, 0.92 + i * 0.05]], { nu: 16, nv: 1, t: 0.05, lift: 0.05 - i * 0.012 }, i === 1 ? STEEL : SILVER);
  k.add(knee, cyl(0.07, 0.07, 0.9, 10), DARK, [0, -2.05, -0.44], [-5, 0, 0], M);
  k.add(knee, cyl(0.04, 0.04, 1.4, 10), PISTON, [0, -1.45, -0.6], [-5, 0, 0], M);

  // ---- foot: an armoured sabaton of stepped lames (ref s05)
  k.add(ank, ball(0.38, 14, 10), DARK, undefined, undefined, M);
  k.add(ank, cylX(0.26, 0.86, 18), BRONZE, undefined, undefined, M);
  // ankle blocks: big angular shoulders over the instep
  k.add(ank, hull([v3(0.5, 0.26, 0.2), v3(0.5, 0.26, -0.5), v3(0.6, -0.3, 0.5), v3(0.6, -0.34, -0.66), v3(0.32, 0.34, 0.1), v3(0.34, 0.3, -0.44), v3(0.32, -0.34, 0.66), v3(0.32, -0.34, -0.66)], 18), SILVER, undefined, undefined, M);
  k.add(ank, hull([v3(-0.5, 0.26, 0.2), v3(-0.5, 0.26, -0.5), v3(-0.6, -0.3, 0.5), v3(-0.6, -0.34, -0.66), v3(-0.32, 0.34, 0.1), v3(-0.34, 0.3, -0.44), v3(-0.32, -0.34, 0.66), v3(-0.32, -0.34, -0.66)], 18), STEEL, undefined, undefined, M);
  k.add(ank, hull([v3(0.34, 0.22, 0.38), v3(-0.34, 0.22, 0.38), v3(0.42, -0.28, 0.8), v3(-0.42, -0.28, 0.8), v3(0.3, 0.28, 0.1), v3(-0.3, 0.28, 0.1), v3(0, 0.34, 0.4)], 16), PALE, undefined, undefined, M);
  k.add(ank, hull([v3(0.44, 0.1, -0.5), v3(-0.44, 0.1, -0.5), v3(0.4, -0.5, -0.86), v3(-0.4, -0.5, -0.86), v3(0.3, 0.26, -0.3), v3(-0.3, 0.26, -0.3), v3(0.46, -0.56, -0.4), v3(-0.46, -0.56, -0.4)], 18), STEEL, undefined, undefined, M);
  // tube axis along the foot: built on Y, rotated so +Y → +Z and u=.5 faces up
  const Ft = tube([[-0.05, 0.52, 0.46, 0.0, 2.8], [0.42, 0.56, 0.42, 0.04, 2.9], [0.95, 0.52, 0.33, 0.1, 2.9], [1.5, 0.4, 0.2, 0.2, 2.7], [1.95, 0.22, 0.09, 0.27, 2.4], [2.2, 0.05, 0.03, 0.3, 2]]);
  const rot = [90, 0, 0], at = [0, -0.34, 0.1];
  const nL = 6;
  for (let i = 0; i < nL; i++) {
    const v0 = (i / nL) * 0.97, v1 = ((i + 1.28) / nL) * 0.97;
    const w = 0.24 - i * 0.008;
    k.add(ank, patch(Ft, [[0.5 - w, v0], [0.5 + w, v0], [0.5 + w * 0.98, Math.min(v1, 1)], [0.5 - w * 0.98, Math.min(v1, 1)]], { nu: 6, nv: 2, t: 0.07, flare: 0.07, lift: 0.03, ridge: i < 2 ? 0.02 : 0.04, crease: 13 }), i % 2 ? STEEL : SILVER, at, rot, M);
  }
  k.add(ank, patch(Ft, [[0.5 - 0.02, 0.55], [0.5 + 0.02, 0.55], [0.5 + 0.02, 1.0], [0.5 - 0.02, 1.0]], { nu: 2, nv: 4, t: 0.06, lift: 0.11 }), BRONZE, at, rot, M);
  k.add(ank, solid(Ft, { k: 0.97, nu: 16, nv: 8 }), DARK, at, rot, M);
  // sole
  k.add(ank, cbox(1.0, 0.1, 2.9, 0.04, { wt: 0.86, dt: 2.8 }), DARK, [0, -0.64, 0.62], undefined, M);
  // sprung outrigger toes
  for (const q of [-1, 1]) k.add(ank, hull([v3(q * 0.28, -0.3, 0.9), v3(q * 0.5, -0.32, 0.9), v3(q * 0.34, -0.62, 1.7), v3(q * 0.2, -0.62, 1.5), v3(q * 0.5, -0.62, 1.0), v3(q * 0.3, -0.62, 0.9)], 18), GUN, undefined, undefined, M);
}
