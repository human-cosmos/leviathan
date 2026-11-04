import * as THREE from 'three';
import { section, L as LEV_L } from './lev-body.js';
import { celMaterial } from './materials.js';
import { Rng } from './util.js';

// Where the harpoon sits in the beast once it is out of the water (s39). Everything is held in
// the body's own frame: a fixed point on the hide of the back and a fixed lean, so the shaft
// rolls and arcs with the body. d runs nock -> tip: down through the back, raked toward the head.
const Z0 = 0.6 * LEV_L;
const S = section(Z0);
const X0 = -0.3 * S.rx;                    // off the dorsal ridge, on the camera side of the flip
const Y0 = S.cy + S.top * 0.93;
const REST = new THREE.Vector3(X0, Y0, Z0);
const D = new THREE.Vector3(0.24, -0.82, 0.52).normalize();
const N = new THREE.Vector3(-0.3, 0.95, 0).normalize();   // hide normal at the entry
const THROUGH = (S.top + S.bot) * 0.93 / 0.82;            // run through the body along d
const OUT = 200, TIP_OUT = 56;                            // metres of shaft past each wound

const _q = new THREE.Quaternion(), _p = new THREE.Vector3();

// out: { entry, exit, tail, tip, dir, normal, centre, radius }
export function newPose() {
  return { entry: new THREE.Vector3(), exit: new THREE.Vector3(), tail: new THREE.Vector3(), tip: new THREE.Vector3(), dir: new THREE.Vector3(), normal: new THREE.Vector3(), centre: new THREE.Vector3(), radius: 0 };
}

export function harpoonPose(lev, H) {
  const sp = lev?.spine;
  if (!sp) return false;
  const k = sp.k ?? 1;
  sp.at(Z0 / sp.len, H.centre, _q);
  sp.toWorld(_p.copy(REST), H.entry);
  H.dir.copy(D).applyQuaternion(_q);
  H.normal.copy(N).applyQuaternion(_q);
  H.exit.copy(H.entry).addScaledVector(H.dir, THROUGH * k);
  H.tip.copy(H.exit).addScaledVector(H.dir, TIP_OUT * k);
  H.tail.copy(H.entry).addScaledVector(H.dir, -OUT * k);
  H.radius = Math.max(S.rx, S.top) * k;
  return true;
}

// the puncture: a ragged lip of hide round the shaft, raw flesh in the hole
export function makeWound(ctx) {
  const g = new THREE.Group();
  const r = new Rng(39);
  const lip = new THREE.CylinderGeometry(6, 26, 7, 20, 1, true);
  const p = lip.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) < 0) { const w = 0.7 + 0.6 * r.next(); p.setX(i, p.getX(i) * w); p.setZ(i, p.getZ(i) * w); }
  }
  // close the seam of the open cylinder
  for (let i = 0; i < p.count; i += 21) { if (i + 20 < p.count) { p.setX(i + 20, p.getX(i)); p.setZ(i + 20, p.getZ(i)); } }
  lip.computeVertexNormals();
  g.add(new THREE.Mesh(lip, celMaterial({ color: '#2d4a50', dark: '#12222c', id: 64, weather: [0, 0, 0, 0] })));
  const hole = new THREE.CircleGeometry(8, 16).rotateX(-Math.PI / 2).translate(0, 2.5, 0);
  g.add(new THREE.Mesh(hole, celMaterial({ color: '#7c2030', dark: '#3a0c18', id: 66, weather: [0, 0, 0, 0] })));
  g.traverse((o) => { o.frustumCulled = false; });
  g.visible = false;
  ctx.scene.add(g);
  const up = new THREE.Vector3(0, 1, 0);
  return {
    hide() { g.visible = false; },
    place(H, k = 1) {
      g.position.copy(H.entry).addScaledVector(H.normal, 2);
      g.quaternion.setFromUnitVectors(up, H.normal);
      g.scale.setScalar(k);
      g.visible = true;
    },
  };
}
