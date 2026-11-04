import * as THREE from 'three';
import { buildArcher } from './archer-model.js';
import { buildBow, Strand, BOW } from './archer-bow.js';
import { archerAssets, CHARGE } from './archer-mat.js';
import { makeArrow } from './arrow.js';
import { poseAt, nockWave, FOOT, ROOT_POS, BOW_CANT, BOW_LIMB } from './archer-pose.js';
import { deg, track, clamp, smooth, lerp } from './util.js';

const V = THREE.Vector3, Q = THREE.Quaternion, M4 = THREE.Matrix4;
const ARROW_UNITS = 10.4;    // on the string the arrow is 104 m long

// Two-bone IK. a/b/c are joints whose bones hang along -Y. T and P are world points (target, pole).
// bend = 1: the lower bone folds toward local +Z (elbow); bend = -1: toward -Z (knee).
const _S = new V(), _b = new V(), _c = new V();
function solve2(a, b, c, T, P, bend) {
  a.parent.updateWorldMatrix(true, false);
  const S = a.parent.localToWorld(_S.copy(a.position));
  const ks = a.parent.matrixWorld.getMaxScaleOnAxis() * a.scale.x;
  const L1 = b.position.length() * ks, L2 = c.position.length() * ks;
  const D = T.clone().sub(S);
  const d = Math.min(Math.max(D.length(), Math.abs(L1 - L2) + 1e-3), L1 + L2 - 1e-3);
  const dd = D.normalize();
  const h0 = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(L1 * L1 - h0 * h0, 0));
  const p = P.clone().sub(S);
  p.addScaledVector(dd, -p.dot(dd)).normalize();
  const E = S.clone().addScaledVector(dd, h0).addScaledVector(p, h);
  const Tc = S.clone().addScaledVector(dd, d);
  const u = E.clone().sub(S).normalize();
  const f = Tc.clone().sub(E).normalize();
  const z = f.clone().addScaledVector(u, -f.dot(u));
  if (z.lengthSq() < 1e-6) z.copy(p);
  z.normalize().multiplyScalar(bend);
  const y = u.clone().negate();
  const x = new V().crossVectors(y, z);
  const qW = new Q().setFromRotationMatrix(new M4().makeBasis(x, y, z));
  const qP = a.parent.getWorldQuaternion(new Q());
  a.quaternion.copy(qP.invert().multiply(qW));
  const ang = Math.acos(clamp(u.dot(f), -1, 1));
  b.rotation.set(-bend * ang, 0, 0);
  a.updateWorldMatrix(false, true);
  return ang;
}

// orient a joint from a world basis
function setWorldBasis(o, x, y, z) {
  const qW = new Q().setFromRotationMatrix(new M4().makeBasis(x, y, z));
  o.quaternion.copy(o.parent.getWorldQuaternion(new Q()).invert().multiply(qW));
}

export function createArcher(ctx) {
  const { CUES } = ctx;
  const { mat } = archerAssets();
  const A = buildArcher(mat);
  const { root, j } = A;
  const bow = buildBow(mat);
  bow.j.tA.scale.setScalar(BOW_LIMB); bow.j.bA.scale.setScalar(BOW_LIMB);   // limbs shortened at the riser hinges
  root.add(bow.root);
  root.scale.setScalar(10);
  root.position.set(...ROOT_POS);
  root.visible = false;
  ctx.scene.add(root);
  ctx.shadowRoots.push(root);
  ctx.makeArrow = makeArrow;
  j.armL.scale.setScalar(1.1); j.armR.scale.setScalar(1.1);
  j.hipL.scale.setScalar(1.1); j.hipR.scale.setScalar(1.1);
  j.pdL.scale.setScalar(0.8); j.pdR.scale.setScalar(0.8);
  j.head.scale.setScalar(1.2);
  j.capL.scale.setScalar(0.84); j.capR.scale.setScalar(0.84);

  // the arrow on the string
  const arrow = makeArrow(ctx, { seed: 5 });
  arrow.scale.setScalar(ARROW_UNITS);
  root.add(arrow);
  const string = new Strand(mat, 41, 0.03, { col: '#23273a', metal: 0.4, id: 43 });
  const cableA = new Strand(mat, 2, 0.022, { col: '#2e3248', metal: 0.5, id: 47 });
  const cableB = new Strand(mat, 2, 0.022, { col: '#2e3248', metal: 0.5, id: 47 });
  root.add(string.mesh, cableA.mesh, cableB.mesh);

  // anchors
  const anchors = {
    arrowTip: new THREE.Object3D(), arrowNock: new THREE.Object3D(),
    drawHand: new THREE.Object3D(), bowHand: new THREE.Object3D(), chest: new THREE.Object3D(), head: new THREE.Object3D(),
    bowTop: bow.anchors.tipT, bowBottom: bow.anchors.tipB,
  };
  root.add(anchors.arrowTip, anchors.arrowNock);
  j.wrL.add(anchors.drawHand); anchors.drawHand.position.set(0, -0.9, 0);
  j.wrR.add(anchors.bowHand); anchors.bowHand.position.set(0, -0.7, 0);
  j.chest.add(anchors.chest); anchors.chest.position.set(0, 1.0, 0.9);
  j.head.add(anchors.head); anchors.head.position.set(0, 0.4, 0);

  const curl = (L, s, v) => {
    j['fingers' + L].forEach(([a, b, c], i) => {
      const [x, y, z] = v(i);
      a.rotation.set(0, 0, deg(-s * x)); b.rotation.set(0, 0, deg(-s * y)); c.rotation.set(0, 0, deg(-s * z));
    });
  };
  const toWorld = (v) => root.localToWorld(v.clone());
  const axis = (x, y, z) => new V(x, y, z).transformDirection(root.matrixWorld);
  const tmp = new V(), pStr = [];
  for (let i = 0; i < 41; i++) pStr.push(new V());
  const n0 = new V(), tT = new V(), tB = new V(), a0 = new V(), a1 = new V();

  function pose(t) {
    const p = poseAt(t);
    j.pelvis.position.set(...p.pelvis);
    j.pelvis.rotation.set(deg(p.pelvisR[0]), deg(p.pelvisR[1]), deg(p.pelvisR[2]));
    j.waist.rotation.set(deg(p.waistR[0]), deg(p.waistR[1]), deg(p.waistR[2]));
    j.chest.rotation.set(deg(p.chestR[0]), deg(p.chestR[1]), deg(p.chestR[2]));
    j.neck.rotation.set(deg(p.neckR[0]), deg(p.neckR[1]), deg(p.neckR[2]));
    j.head.rotation.set(deg(p.headR[0]), deg(p.headR[1]), deg(p.headR[2]));
    root.updateMatrixWorld(true);

    // legs: planted feet
    for (const L of ['L', 'R']) {
      const F = FOOT[L];
      solve2(j['hip' + L], j['knee' + L], j['ank' + L], toWorld(new V(...F.ankle)), toWorld(new V(...F.pole)), -1);
      const ang = -j['knee' + L].rotation.x;
      j['cap' + L].rotation.set(ang * 0.5, 0, 0);
      j['ank' + L].updateWorldMatrix(true, false);
      const z = axis(...F.toe), up = axis(...F.up);
      const x = new V().crossVectors(up, z).normalize();
      const y = new V().crossVectors(z, x).normalize();
      setWorldBasis(j['ank' + L], x, y, z);
      j['tas' + L].quaternion.identity().slerp(j['hip' + L].quaternion, 0.45);
    }

    // ---- bow
    const roll = deg(p.bowRoll);
    bow.root.position.set(...p.grip);
    const nW = new V(...p.nock);
    // canted about the arrow axis: the lower limb swings forward so the string clears the front thigh.
    // The bow keeps the same half-strength recoil roll it always had, now on a unit quaternion.
    bow.root.quaternion.identity();
    bow.root.rotateZ(roll * 0.5);
    bow.root.rotateX(deg(BOW_CANT));
    // limb flex: drawn shape is built in; relax toward the unstrung shape
    const relax = p.released ? track([[0, 0], [0.05, 1.12, smooth], [0.16, 0.9], [0.4, 1.03], [1, 1]], p.rel) : (1 - p.draw) * 0.42;
    const hinge = deg(11 * relax), hingeB = deg(7 * relax);
    bow.j.tA.rotation.z = hinge; bow.j.bA.rotation.z = -hinge;
    bow.j.tB.rotation.z = hingeB; bow.j.bB.rotation.z = -hingeB;
    bow.j.tC.rotation.z = -hingeB; bow.j.bC.rotation.z = hingeB;
    root.updateMatrixWorld(true);
    tT.copy(bow.anchors.strT.getWorldPosition(tmp)); root.worldToLocal(tT);
    tB.copy(bow.anchors.strB.getWorldPosition(tmp)); root.worldToLocal(tB);

    // ---- arrow from the nock over the rest
    const restP = bow.root.localToWorld(new V(BOW.rest[0], BOW.rest[1], BOW.rest[2]));
    root.worldToLocal(restP);
    const D = restP.clone().sub(nW).normalize();
    arrow.position.copy(nW);
    arrow.quaternion.setFromUnitVectors(new V(0, 0, 1), D);
    arrow.visible = !p.released;
    anchors.arrowNock.position.copy(nW);
    anchors.arrowTip.position.copy(nW).addScaledVector(D, ARROW_UNITS);

    // ---- bow arm: right hand closes on the grip (palm toward +Z, thumb up)
    const fwd = D.clone().negate();    // from tip back toward nock, in root space
    const palm = new V(0, -Math.sin(deg(BOW_CANT)), Math.cos(deg(BOW_CANT))), thumb = new V(0, 1, 0);   // the hand turns with the riser
    const gw = new V(...p.grip).addScaledVector(fwd, 0.62).addScaledVector(palm, -0.36);
    solve2(j.armR, j.elR, j.wrR, toWorld(gw), toWorld(new V(-3.2, 4.6, -3.2)), 1);
    {
      const y = axis(fwd.x, fwd.y, fwd.z), xx = axis(palm.x, palm.y, palm.z);
      xx.addScaledVector(y, -xx.dot(y)).normalize();
      const z = new V().crossVectors(xx, y);
      setWorldBasis(j.wrR, xx, y, z);
      void thumb;
    }
    curl('R', -1, (i) => [66 + i * 3, 72, 58]);
    j.thR.rotation.set(deg(34), deg(-10), deg(30));
    j.th2R.rotation.set(0, 0, deg(22));
    j.th3R.rotation.set(0, 0, deg(16));

    // ---- draw arm: hooks the string on the nock; after the shot it flies open
    const wrT = p.hand ? new V(...p.hand) : nW.clone().addScaledVector(fwd, 1.05).add(new V(0, -0.2, 0.24));
    const pole = p.fly > 0 ? new V(lerp(5.4, 4.4, p.fly), lerp(6, 2.4, p.fly), lerp(-3, -1, p.fly)) : new V(5.4, 6.2, -3.2);
    solve2(j.armL, j.elL, j.wrL, toWorld(wrT), toWorld(pole), 1);
    {
      const hold = fwd.clone(), back = new V(0, 0, 1);
      const up = new V(0.2, 1, -0.2).normalize();
      const y = axis(...hold.clone().lerp(up, smooth(p.fly * 1.1)).normalize().toArray());
      const xx = axis(...back.clone().lerp(new V(0.3, 0, 1), p.fly).normalize().toArray());
      xx.addScaledVector(y, -xx.dot(y)).normalize();
      const z = new V().crossVectors(xx, y);
      setWorldBasis(j.wrL, xx, y, z);
    }
    const open = smooth(clamp(p.fly * 1.8));
    curl('L', 1, (i) => [lerp(26 + i * 4, 6, open), lerp(78, 14 + i * 3, open), lerp(46, 10, open)]);
    j.thL.rotation.set(deg(lerp(30, 10, open)), deg(10), deg(lerp(-34, -14, open)));
    j.th2L.rotation.set(0, 0, deg(lerp(-30, -8, open)));
    j.th3L.rotation.set(0, 0, deg(lerp(-20, -6, open)));

    // pauldrons follow the arm part way
    for (const L of ['L', 'R']) j['pd' + L].quaternion.identity().slerp(j['arm' + L].quaternion, 0.62);

    // ---- string, cables
    root.updateMatrixWorld(true);
    n0.copy(nW);
    if (p.released) {
      const m = tT.clone().lerp(tB, 0.5);
      const push = D.clone().multiplyScalar(0);
      const amp = 0.62 * nockWave(t - CUES.release);
      for (let i = 0; i < 41; i++) {
        const u = i / 40;
        pStr[i].copy(tT).lerp(tB, u).addScaledVector(fwd, amp * Math.sin(Math.PI * u) + 0.14 * nockWave(t - CUES.release - 0.02) * Math.sin(2 * Math.PI * u));
      }
      void m; void push;
    } else {
      for (let i = 0; i <= 20; i++) { pStr[i].copy(tT).lerp(n0, i / 20); pStr[40 - i].copy(tB).lerp(n0, i / 20); }
    }
    string.set(pStr);
    // the cables are part of the limb geometry when the bow carries no cable anchors
    const hasCables = !!(bow.anchors.cabT && bow.anchors.camT);
    cableA.mesh.visible = cableB.mesh.visible = hasCables;
    if (hasCables) {
      root.worldToLocal(a0.copy(bow.anchors.cabT.getWorldPosition(tmp)));
      root.worldToLocal(a1.copy(bow.anchors.camT.getWorldPosition(tmp)));
      cableA.set([a0.clone(), a1.clone()]);
      root.worldToLocal(a0.copy(bow.anchors.cabB.getWorldPosition(tmp)));
      root.worldToLocal(a1.copy(bow.anchors.camB.getWorldPosition(tmp)));
      cableB.set([a0.clone(), a1.clone()]);
    }
    return p;
  }

  const api = {
    root, arrow, bow, j,
    anchor(name, out = new V()) {
      const o = anchors[name];
      if (!o) return out;
      return out.setFromMatrixPosition(o.matrixWorld);
    },
    update(st) {
      const on = st.set === 'coast' && st.sid <= 's09';
      root.visible = on;
      // the release still has to be readable by FX the moment after this set ends
      const p = pose(Math.min(st.t, CUES.release + 3));
      root.updateMatrixWorld(true);
      const c = p.charge;
      api.anchor('arrowNock', CHARGE.uArcA.value);
      api.anchor('arrowTip', CHARGE.uArcB.value);
      CHARGE.uCharge.value = p.released ? Math.max(0, Math.exp(-p.rel * 3.2) * 0.9) : c;
      CHARGE.uChargeFront.value = p.released ? 1 : smooth(c * 1.5);
      CHARGE.uCore.value = p.released ? 0.3 + 0.7 * Math.exp(-p.rel * 2) : 0.2 + 0.8 * c;
      CHARGE.uVisor.value = p.released ? 0.35 + 0.6 * Math.exp(-p.rel) : 0.3 + 0.65 * c;
      if (!on) CHARGE.uCharge.value = 0;
    },
  };
  // first pose so anchors are valid before the first update
  pose(0);
  root.updateMatrixWorld(true);
  return api;
}
