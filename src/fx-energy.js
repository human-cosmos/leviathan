import * as THREE from 'three';
import { clamp, invLerp, smooth, easeOut, lerp } from './util.js';
import { LineBatch, GlowBatch, KIND, hash, hr, drawing } from './fx-energy-core.js';
import { boltMaterial, glowMaterial, relightMaterial, seamMaterial, planeRingMaterial, screenFxMaterial, MAXL } from './fx-energy-mat.js';
import { createSkyTear } from './fx-energy-sky.js';
import { createChargeFx } from './fx-energy-charge.js';
import { createSkyFx } from './fx-energy-flight.js';
import { createUnderFx } from './fx-energy-under.js';

// FX Energy: every light in the film that is not the sun. Drawn anime style: bold shapes
// on threes, sharp lightning with a white core and a hard cyan band, flash frames, and a
// cel relight that puts the light of the bolts on whatever the other departments drew.
// All overlay-scene; each shot has one small function in the charge / flight / under modules.

const V = THREE.Vector3;

export async function createEnergy(ctx) {
  const { overlay, camera, engine } = ctx;
  const S = engine.S;
  const full = (m, order) => {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
    q.frustumCulled = false; q.renderOrder = order; q.visible = false;
    overlay.add(q);
    return q;
  };
  const relight = full(relightMaterial(), 10);
  const seam = full(seamMaterial(S), 11);
  const ring = full(planeRingMaterial(S), 12);
  const lines = new LineBatch(boltMaterial(S)); lines.mesh.renderOrder = 20; overlay.add(lines.mesh);
  const glows = new GlowBatch(glowMaterial(S), 1024); glows.mesh.renderOrder = 21; overlay.add(glows.mesh);
  const screen = full(screenFxMaterial(S), 30);
  const sky = createSkyTear(ctx);

  const K = {
    ctx, S, lines, glows, sky, camera,
    R: new V(), U: new V(), Fw: new V(),
    st: null, t: 0, dn: 0, d3: 0,
    lights: [], rings: [],
    // ---- light
    light(p, radius, color, power) { if (K.lights.length < MAXL && power > 0.001) K.lights.push({ p: p.clone(), r: radius, c: color, w: power }); },
    // Blue light on an already bright surface: it can only turn bluer, never brighter, so the
    // silver armour keeps its drawing instead of clipping to white.
    tint(p, radius, power) { K.light(p, radius, [-0.62, -0.14, 0.22], power); },
    seamK: 0, seamR: 1,
    seam(k) { K.seamK = Math.max(K.seamK, k); },
    ring(x, z, R, w) { if (K.rings.length < 4 && w > 0.001) K.rings.push([x, z, R, w]); },
    flash(r, g, b) { K.fr += r; K.fg += g; K.fb += b; },
    focus(p, w, inner = 0.28) {
      const q = p.clone().project(camera);
      K.focusC = [q.x * 0.5 + 0.5, q.y * 0.5 + 0.5]; K.focusW = w; K.focusI = inner;
    },
    fr: 0, fg: 0, fb: 0, focusW: 0, focusC: [0.5, 0.5], focusI: 0.28,
    // ---- anchors; missing departments fall back to a sensible spot so nothing throws
    anchor(mod, name, out = new V(), fall) {
      let ok = false;
      try {
        const a = ctx[mod];
        const r = a && a.anchor ? a.anchor(name, out) : null;
        if (r && r.isVector3 && r !== out) out.copy(r);
        ok = !!(a && a.anchor) && Number.isFinite(out.x + out.y + out.z) && (r !== null);
      } catch (e) { ok = false; }
      if (!ok) { if (fall) out.copy(fall); else out.set(0, 0, 0); }
      return out;
    },
    mpp(p) {
      const d = Math.max(0.1, -_v.copy(p).applyMatrix4(camera.matrixWorldInverse).z);
      return d / (camera.projectionMatrix.elements[5] * 0.5 * 1040);
    },
    // frame coordinates (0..1, y down) <-> world at view depth D. Art-directed FX live here:
    // the composition then holds whatever lens the shot owner chooses.
    fp(x, y, D = 900, out = new V()) {
      const ty = Math.tan((camera.fov * Math.PI) / 360), tx = ty * camera.aspect;
      return out.copy(camera.position).addScaledVector(K.Fw, D).addScaledVector(K.R, (x * 2 - 1) * tx * D).addScaledVector(K.U, (1 - y * 2) * ty * D);
    },
    frame(p, out = [0, 0]) {
      const q = _v.copy(p).project(camera);
      out[0] = q.x * 0.5 + 0.5; out[1] = 0.5 - q.y * 0.5;
      return out;
    },
    depth(p) { return -_v.copy(p).applyMatrix4(camera.matrixWorldInverse).z; },
    // metres per frame width at a world point
    W(p) { return K.mpp(p) * 1920; },
    // True when a point is in front of the camera and within the frame (plus margin).
    onScreen(p, margin = 0.2) {
      const q = _v.copy(p).project(camera);
      return q.z < 1 && Math.abs(q.x) < 1 + margin && Math.abs(q.y) < 1 + margin;
    },
    hash, hr,
  };
  const _v = new V();

  const handlers = {
    ...createChargeFx(K),
    ...createSkyFx(K),
    ...createUnderFx(K),
  };

  if (K.ready) await K.ready;
  const P = new URLSearchParams(location.search);
  const tan = new THREE.Vector2();
  const lightsUpload = () => {
    const n = K.lights.length;
    const ty = Math.tan((camera.fov * Math.PI) / 360);
    tan.set(ty * camera.aspect, ty);
    const u = relight.material.uniforms, us = seam.material.uniforms;
    u.uN.value = n; us.uN.value = n;
    u.uTan.value.copy(tan); us.uTan.value.copy(tan);
    u.uDraw.value = K.dn; us.uDraw.value = K.dn;
    for (let i = 0; i < n; i++) {
      const L = K.lights[i];
      _v.copy(L.p).applyMatrix4(camera.matrixWorldInverse);
      u.uLP.value[i].set(_v.x, _v.y, _v.z, L.r);
      us.uLP.value[i].set(_v.x, _v.y, _v.z, L.r * K.seamR);
      u.uLC.value[i].set(L.c[0], L.c[1], L.c[2], L.w);
    }
    relight.visible = n > 0;
    us.uK.value = K.seamK;
    seam.visible = n > 0 && K.seamK > 0.01;
  };
  const ringsUpload = () => {
    const u = ring.material.uniforms, n = K.rings.length;
    u.uN.value = n;
    for (let i = 0; i < n; i++) u.uR.value[i].set(...K.rings[i]);
    if (n) {
      const ty = Math.tan((camera.fov * Math.PI) / 360);
      u.uTan.value.set(ty * camera.aspect, ty);
      u.uCam.value.copy(camera.matrixWorld);
      u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    }
    ring.visible = n > 0;
  };
  const screenUpload = () => {
    const u = screen.material.uniforms;
    u.uFlash.value.setRGB(K.fr, K.fg, K.fb);
    u.uLines.value = K.focusW;
    u.uCenter.value.set(K.focusC[0], K.focusC[1]);
    u.uInner.value = K.focusI;
    u.uSeed.value = K.dn * 7.31;
    screen.visible = K.focusW > 0.001 || K.fr + K.fg + K.fb > 0.001;
  };

  function update(st) {
    K.st = st; K.t = st.t; K.dn = drawing(st.t, 12); K.d3 = drawing(st.t, 8);
    camera.updateMatrixWorld();
    const m = camera.matrixWorld.elements;
    K.R.set(m[0], m[1], m[2]); K.U.set(m[4], m[5], m[6]); K.Fw.set(-m[8], -m[9], -m[10]);
    K.lights.length = 0; K.rings.length = 0; K.seamK = 0; K.seamR = 1;
    K.fr = K.fg = K.fb = 0; K.focusW = 0;
    lines.begin(); glows.begin();
    sky.hide();
    K.hideOwn?.();
    const h = handlers[st.sid];
    if (h && P.get('efx') !== '0') h(st);
    lines.end(); glows.end();
    lightsUpload(); ringsUpload(); screenUpload();
  }

  void clamp; void invLerp; void smooth; void easeOut; void lerp; void KIND; void hr;
  return { update, K };
}
