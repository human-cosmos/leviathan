import * as THREE from 'three';
import { clamp, lerp, smooth } from './util.js';
import { celMaterial } from './materials.js';

// The arrow in the high shots. It is flown in camera space: tip = where the tip lands in NDC at
// `depth` from the lens, dir = where it points (x right, y up, z toward the viewer). Cameras in
// these shots sit still in a painted world, so the framing below is the reference's framing.
// ctx.world.arrow is the published Object3D (nock at the origin, tip at z = 1, scaled by us);
// FX Energy hangs its trails on it. `span` is the head's full width as a fraction of the length:
// the section is scaled to it, measured from the model, so the framing survives a redesign.
const ease = (x) => smooth(clamp(x));

export const FLY = {
  // alongside: flat profile pointing left, the long slim head a third of the frame, shaft out of frame right
  s11: (lt, d) => {
    const k = ease(lt / d);
    return { tip: [lerp(-0.665, -0.69, k), lerp(0.04, 0.05, k)], depth: 150, dir: [-1, lerp(-0.012, -0.02, k), lerp(0.06, 0.1, k)], len: 250, span: 0.047, spin: lerp(-8, -14, k), heat: 0.2 + 0.7 * k * k };
  },
  // far, far off toward the limb; it passes the lens at 21.0 and its shaft stays in frame
  s12: (lt, d, t) => passBy(t),
  s13: (lt, d, t) => passBy(t),
  // diving past the lens toward the mountains: nothing but a long dark needle, near end off frame left
  s25: (lt, d) => {
    const k = ease(lt / d);
    const v = new THREE.Vector3(0, 0, -1);
    return { cam: [v.x, v.y, v.z], dir: [0, 0, -1], len: 1, ghost: true, heat: 0, spike: { far: [lerp(0.272, 0.235, k), lerp(-0.128, -0.115, k), 2600], near: [-1.15, lerp(-0.66, -0.17, k), 170] } };
  },
  // from behind: the barbs flare, the tail runs back over the lens toward top right
  s26: (lt, d) => {
    const k = ease(lt / d);
    return { tip: [lerp(-0.2, -0.27, k), lerp(0.2, 0.09, k)], depth: 100, dir: [-0.66, -0.36, -0.66], len: 100, span: 0.32, spin: lerp(38, 54, k), heat: 1 };
  },
  // nose down and away, holding the frame, then it runs away from us toward the sea
  s28: (lt, d) => {
    const r = ease((lt - 0.6) / (d - 0.65));
    // the arrow shrinks instead of receding, so the FX drawn on its length shrink with it
    const len = 300 * (1 - r * 0.93);
    return { tip: [lerp(-0.45, -0.1, ease(lt / d)), lerp(-0.09, -0.04, ease(lt / d))], depth: 130, dir: [-0.76, -0.27, -0.6], len, span: 0.078, spin: 22, heat: 1 };
  },
};

const NEEDLE_LEN = 1500;
function passBy(t) {
  // on a line from just left of the lens out to the vanishing point (x = 0.62, y = -0.07 in NDC)
  const L = 40;
  const s = 662 * (21.066 - t);                // distance of the tip along the line: it passes at the cut
  const ty = Math.tan((22 * Math.PI) / 180), tx = ty * (1920 / 1040);
  const V = new THREE.Vector3(0.62 * tx, -0.07 * ty, -1).normalize();
  const O = new THREE.Vector3(-47, -9, 0);
  const held = s < 8 ? 420 : s;                // FX keep their pose near the vanishing point once the head has passed
  const tip = O.clone().addScaledVector(V, held);
  const dir = V.clone().negate();
  const nearS = Math.max(s + L * 0.8, 14);
  return {
    cam: [tip.x, tip.y, tip.z], dir: [dir.x, dir.y, dir.z], len: L, span: 0.77, spin: 10, heat: 1, ghost: s < held,
    needle: { from: O.clone().addScaledVector(V, nearS), to: O.clone().addScaledVector(V, s + L + NEEDLE_LEN) },
  };
}

// Plain flat-plate arrow, tip at z = 1, used only while arrow.js does not load.
function standIn() {
  const g = new THREE.Group();
  const head = new THREE.Shape([[0, 1], [0.045, 0.9], [0.02, 0.9], [0.065, 0.8], [0.012, 0.84], [0.008, 0], [-0.008, 0], [-0.012, 0.84], [-0.065, 0.8], [-0.02, 0.9], [-0.045, 0.9]].map(([a, b]) => new THREE.Vector2(a, b)));
  const geo = new THREE.ExtrudeGeometry(head, { depth: 0.006, bevelEnabled: false }).rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
  g.add(new THREE.Mesh(geo, celMaterial({ color: '#b8c2d4', dark: '#4a5270', id: 21, weather: [0, 0, 0, 0] })));
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}

export async function buildFlight(ctx) {
  let arrow = null;
  // arrow.js may be mid-edit in the Archer department: fly a plain stand-in until it loads
  try { arrow = (await import('./arrow.js')).makeArrow(ctx, { heat: 0 }); }
  catch (e) { console.warn(`[world-flight] stand-in arrow: ${e.message || e}`); arrow = standIn(); }
  // the model's own head width at length 1
  arrow.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(arrow);
  const headW = Math.max(0.02, Math.max(bb.max.y - bb.min.y, bb.max.x - bb.min.x));
  arrow.visible = false;
  arrow.name = 'arrow';
  ctx.scene.add(arrow);
  ctx.world.arrow = arrow;

  // the endless dark shaft left in frame after the head has gone by (s12, s13)
  const needle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.62, 1, 8, 1).rotateX(Math.PI / 2).translate(0, 0, 0.5),
    celMaterial({ color: '#39405a', dark: '#1c2038', id: 23, weather: [0, 0, 0, 0] }),
  );
  needle.frustumCulled = false; needle.visible = false;
  ctx.scene.add(needle);
  // the same idea with a true point, for the dive in s25
  const spike = new THREE.Mesh(
    new THREE.CylinderGeometry(0, 1, 1, 10, 1).rotateX(Math.PI / 2).translate(0, 0, 0.5),
    celMaterial({ color: '#2c3250', dark: '#141830', id: 24, weather: [0, 0, 0, 0] }),
  );
  spike.frustumCulled = false; spike.visible = false;
  ctx.scene.add(spike);

  const cam = ctx.camera;
  const R = new THREE.Vector3(), U = new THREE.Vector3(), F = new THREE.Vector3();
  const p = new THREE.Vector3(), d = new THREE.Vector3(), x = new THREE.Vector3(), y = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const toWorld = (out, v) => out.copy(cam.position).addScaledVector(R, v.x).addScaledVector(U, v.y).addScaledVector(F, -v.z);
  // kept public so FX can look ahead if it wants to
  ctx.world.flight = (sid, lt, dur, t) => FLY[sid]?.(lt, dur, t) ?? null;
  return {
    update(st) {
      const f = FLY[st.sid];
      needle.visible = false; spike.visible = false;
      if (!f) { arrow.visible = false; return; }
      const o = f(st.lt, st.dur, st.t);
      arrow.visible = true;
      const e = cam.matrixWorld.elements;
      R.set(e[0], e[1], e[2]); U.set(e[4], e[5], e[6]); F.set(-e[8], -e[9], -e[10]);
      const ty = Math.tan((cam.fov * Math.PI) / 360), tx = ty * cam.aspect;
      d.set(0, 0, 0).addScaledVector(R, o.dir[0]).addScaledVector(U, o.dir[1]).addScaledVector(F, -o.dir[2]).normalize();
      p.copy(cam.position);
      if (o.cam) p.addScaledVector(R, o.cam[0]).addScaledVector(U, o.cam[1]).addScaledVector(F, -o.cam[2]);
      else p.addScaledVector(F, o.depth).addScaledVector(R, o.tip[0] * tx * o.depth).addScaledVector(U, o.tip[1] * ty * o.depth);
      // the head's blade plane holds "up" before the spin
      x.crossVectors(U, d).normalize();
      y.crossVectors(d, x).normalize();
      m.makeBasis(x, y, d);
      arrow.quaternion.setFromRotationMatrix(m);
      arrow.rotateZ(((o.spin ?? 0) * Math.PI) / 180);
      const thin = o.span ? o.span / headW : 1;
      arrow.scale.set(o.len * thin, o.len * thin, o.len);
      arrow.position.copy(p).addScaledVector(d, -o.len);
      arrow.setHeat?.(o.heat ?? 0);
      // the object stays visible for FX, its drawing goes once the head has passed the lens
      for (const c of arrow.children) c.visible = !o.ghost;
      arrow.updateMatrixWorld(true);
      if (o.spike) {
        const ndc = (out, q) => out.copy(cam.position).addScaledVector(F, q[2]).addScaledVector(R, q[0] * tx * q[2]).addScaledVector(U, q[1] * ty * q[2]);
        ndc(a, o.spike.far); ndc(b, o.spike.near);
        const len = a.distanceTo(b);
        spike.position.copy(b);
        spike.scale.set(2.5, 2.5, len);
        d.subVectors(a, b).normalize();
        spike.quaternion.setFromUnitVectors(y.set(0, 0, 1), d);
        spike.visible = true;
        spike.updateMatrixWorld(true);
      }
      if (o.needle) {
        toWorld(a, o.needle.from); toWorld(b, o.needle.to);
        const len = a.distanceTo(b);
        needle.position.copy(b);
        needle.scale.set(1, 1, len);
        d.subVectors(a, b).normalize();
        needle.quaternion.setFromUnitVectors(y.set(0, 0, 1), d);
        needle.visible = true;
        needle.updateMatrixWorld(true);
      }
    },
  };
}
