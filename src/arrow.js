import * as THREE from 'three';
import { v3, hull, cbox, cylZ, ring, extrude, Kit } from './archer-geo.js';
import { archerAssets, archerMaterial } from './archer-mat.js';
import { STY } from './archer-model.js';

// The great arrow. Modelled at 8.9 units long (89 m on the bow), nock at z = 0, tip at +Z,
// then wrapped so the caller gets an object of length 1 with its tip along +Z.
// Barbed two-stage head with cross blades, ferrule rails, ember inlay, comb fletching.
export const ARROW_LEN = 8.9;
const THIN = 0.5;   // the section is modelled heavy; the fit makes a long thin needle with a slim barbed head

const SHAFT = { col: '#3a4057', metal: 0.7, detail: 0.5, tone: 0.04, wear: 0.5 };
const HEAD = { col: '#6a7690', metal: 0.92, detail: 0.5, tone: 0.04, wear: 0.6 };
const BLADE = { col: '#d9e0ec', metal: 0.95, detail: 0.3, tone: 0.03, wear: 0.5 };
const INLAY = { col: '#ff7a30', metal: 0, detail: 0, emis: 3, tone: 0, wear: 0 };

function build(k, b) {
  const { BRONZE, PISTON, DARK, GUN, SILVER, STEEL } = STY;
  const L = ARROW_LEN;
  // shaft: slight taper, collars
  k.add(b, new THREE.CylinderGeometry(0.058, 0.05, 7.1, 12, 1).rotateX(Math.PI / 2).translate(0, 0, 4.0), SHAFT);
  for (let i = 0; i < 6; i++) {
    const z = 1.75 + i * 0.96;
    k.add(b, cylZ(0.075, 0.09, 12), i % 2 ? BRONZE : GUN, [0, 0, z]);
    k.add(b, cylZ(0.066, 0.03, 12), PISTON, [0, 0, z + 0.07]);
  }
  // ember inlay along the shaft
  for (const a of [0, Math.PI]) k.add(b, cbox(0.012, 0.012, 6.2, 0.002), INLAY, [Math.cos(a) * 0.058, Math.sin(a) * 0.058, 4.4]);

  // the head stands in the YZ plane (seen flat from the side)
  const tip = L, sh = L - 0.92;
  const blade = (w, t, z0, z1, zb, wb) => {
    // a thin diamond section: keel along the axis, sharp edges outside
    return hull([
      v3(0, 0, z1), v3(t, 0, z0 + (z1 - z0) * 0.4), v3(-t, 0, z0 + (z1 - z0) * 0.4),
      v3(0, w, z0), v3(0, -w, z0), v3(t, 0, zb), v3(-t, 0, zb), v3(0, wb, zb), v3(0, -wb, zb),
    ], 14);
  };
  // front dart: dark steel with bright ground edges
  k.add(b, blade(0.4, 0.09, sh, tip, sh - 0.12, 0.2), HEAD);
  // edge bevels (the bright ground faces of the blade)
  for (const q of [1, -1]) {
    k.add(b, hull([v3(0, 0.002 * q, tip), v3(0.03, q * 0.2, sh + 0.42), v3(-0.03, q * 0.2, sh + 0.42), v3(0.012, q * 0.415, sh), v3(-0.012, q * 0.415, sh), v3(0.03, q * 0.3, sh + 0.04), v3(-0.03, q * 0.3, sh + 0.04)], 10), BLADE);
    // rear barbs: swept back, second stage
    const z0 = sh - 0.05;
    k.add(b, hull([v3(0.06, q * 0.16, z0 + 0.22), v3(-0.06, q * 0.16, z0 + 0.22), v3(0.02, q * 0.56, z0 - 0.62), v3(-0.02, q * 0.56, z0 - 0.62), v3(0.05, q * 0.14, z0 - 0.3), v3(-0.05, q * 0.14, z0 - 0.3), v3(0.03, q * 0.28, z0 - 0.26), v3(-0.03, q * 0.28, z0 - 0.26)], 12), HEAD);
    k.add(b, hull([v3(0.012, q * 0.215, z0 + 0.2), v3(-0.012, q * 0.215, z0 + 0.2), v3(0.01, q * 0.575, z0 - 0.64), v3(-0.01, q * 0.575, z0 - 0.64), v3(0.012, q * 0.5, z0 - 0.62), v3(-0.012, q * 0.5, z0 - 0.62)], 12), BLADE);
    // inlay lines down each blade
    k.add(b, hull([v3(q * 0.0 + 0.092, q * 0.03, sh + 0.34), v3(0.092, q * 0.06, sh + 0.34), v3(0.05, q * 0.3, sh + 0.02), v3(0.05, q * 0.27, sh + 0.02), v3(0.09, q * 0.03, sh + 0.34)], 40), INLAY);
    k.add(b, hull([v3(-0.092, q * 0.03, sh + 0.34), v3(-0.092, q * 0.06, sh + 0.34), v3(-0.05, q * 0.3, sh + 0.02), v3(-0.05, q * 0.27, sh + 0.02), v3(-0.09, q * 0.03, sh + 0.34)], 40), INLAY);
    // cross blades (multi-blade head), smaller
    k.add(b, hull([v3(0.0, 0, sh + 0.5), v3(q * 0.24, 0.02, sh - 0.02), v3(q * 0.24, -0.02, sh - 0.02), v3(q * 0.05, 0.05, sh - 0.16), v3(q * 0.05, -0.05, sh - 0.16)], 12), HEAD);
    k.add(b, hull([v3(q * 0.05, 0.05, sh - 0.1), v3(q * 0.05, -0.05, sh - 0.1), v3(q * 0.34, 0.012, sh - 0.62), v3(q * 0.34, -0.012, sh - 0.62), v3(q * 0.05, 0.04, sh - 0.46), v3(q * 0.05, -0.04, sh - 0.46)], 12), HEAD);
  }
  // ferrule: thick collar and four rails, like the reference's struts
  k.add(b, new THREE.CylinderGeometry(0.1, 0.13, 0.5, 12, 1).rotateX(Math.PI / 2).translate(0, 0, sh - 0.28), GUN);
  k.add(b, cylZ(0.145, 0.07, 14), BRONZE, [0, 0, sh - 0.56]);
  k.add(b, cylZ(0.125, 0.05, 14), BRONZE, [0, 0, sh - 1.22]);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    k.add(b, cbox(0.02, 0.022, 0.72, 0.004), PISTON, [Math.cos(a) * 0.125, Math.sin(a) * 0.125, sh - 0.9]);
  }
  k.add(b, new THREE.CylinderGeometry(0.075, 0.1, 0.76, 10, 1).rotateX(Math.PI / 2).translate(0, 0, sh - 0.9), DARK);

  // comb fletching: crenellated steel vanes (ref s06)
  const notch = (n, h) => {
    const pts = [[0, 0]];
    const len = 1.05;
    for (let i = 0; i < n; i++) {
      const x0 = (i / n) * len, x1 = ((i + 0.72) / n) * len, x2 = ((i + 1) / n) * len;
      const top = h * (0.72 + 0.28 * (i / (n - 1)));
      pts.push([x0, top * 0.5], [x0 + 0.04, top], [x1, top], [x1, top * 0.56], [x2, top * 0.56]);
    }
    pts.push([len + 0.28, 0]);
    return pts;
  };
  // long crenellated vanes above and below the shaft, short ones to the sides
  for (const [ang, h, st] of [[0, 0.21, SILVER], [180, 0.21, STEEL], [90, 0.15, GUN], [270, 0.15, GUN]]) {
    const r = (ang * Math.PI) / 180;
    k.add(b, extrude(notch(5, h), 0.04, 0.01).rotateY(-Math.PI / 2).rotateZ(r).translate(0, 0, 0.14), st);
  }
  k.add(b, new THREE.CylinderGeometry(0.066, 0.066, 1.5, 10, 1).rotateX(Math.PI / 2).translate(0, 0, 0.8), GUN);
  for (let i = 0; i < 3; i++) k.add(b, cylZ(0.08, 0.04, 12), BRONZE, [0, 0, 0.3 + i * 0.5]);
  // nock
  k.add(b, cylZ(0.08, 0.16, 12), BRONZE, [0, 0, 0.06]);
  k.add(b, cbox(0.05, 0.05, 0.14, 0.01), DARK, [0, 0, -0.02], [90, 0, 0]);
  void ring;
}

// opts.material overrides; returned object has .setHeat(0..1) to fire up the inlay.
export function makeArrow(ctx, opts = {}) {
  const heat = { value: opts.heat ?? 0 };
  const mat = opts.material ?? archerMaterial(archerAssets().tex, { heat });
  const group = new THREE.Group(); group.name = 'arrow';
  const inner = new THREE.Group();
  inner.scale.setScalar(1 / ARROW_LEN);
  inner.position.z = -0.5 * 0;     // nock at the origin, tip at z = 1
  group.add(inner);
  const k = new Kit(opts.seed ?? 5);
  const bins = { a: inner };
  build(k, 'a');
  k.scaleBin('a', THIN, THIN, 1);
  k.finish(bins, mat);
  group.setHeat = (v) => { heat.value = v; };
  group.userData.noReflect = false;
  return group;
}
