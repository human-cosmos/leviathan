import * as THREE from 'three';
import { Batch, crew, instancedContainers } from './ships-model.js';
import { shipMaterial } from './ships-mat.js';
import { S16 } from './cams/ships.js';
import { Rng, clamp, deg, invLerp, lerp, smooth, onThrees } from './util.js';

// s16: from the wing of the bridge, looking forward along the white accommodation wall with the
// first row of container doors just below the lens, stays running overhead, and a sea coming
// aboard: spray climbs the wall and hits the lens. Everything sits in its own little set so the
// layout can match the reference frame, which no real ship's geometry would.
const WX = -1.6, DY = 30.3;                 // wall plane, deck height
const CREAM = '#f7efdc', CREAM2 = '#dfd4bc', GLASS = '#1c3f66';

function rrShape(w, h, r) {
  const s = new THREE.Shape(), x0 = -w / 2, y0 = -h / 2, x1 = w / 2, y1 = h / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}
const faceX = new THREE.Matrix4().makeRotationY(Math.PI / 2);
function port(b, y, z, w, h) {
  const at = (dx) => new THREE.Matrix4().makeTranslation(WX + dx, y, z).multiply(faceX);
  b.add(new THREE.ExtrudeGeometry(rrShape(w + 0.2, h + 0.2, 0.18), { depth: 0.07, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 5 }), CREAM2, 6, at(0));
  b.add(new THREE.ExtrudeGeometry(rrShape(w, h, 0.13), { depth: 0.1, bevelEnabled: false, curveSegments: 5 }), GLASS, 7, at(0));
  b.box(0.02, h * 0.5, w * 0.16, [WX + 0.115, y + h * 0.12, z - w * 0.2], '#86cdea', 7);
  b.box(0.02, h * 0.2, w * 0.1, [WX + 0.115, y - h * 0.22, z + w * 0.12], '#4c8cc0', 7);
  for (const s of [-1, 1]) for (const k of [-1, 0, 1]) b.sphere(0.016, [WX + 0.09, y + k * h * 0.46, z + s * (w / 2 + 0.06)], '#b7ad96', 6);
}
function lamp(b, y, z) {
  b.pipe([WX, y - 0.1, z], [WX + 0.42, y - 0.02, z], 0.035, '#8d8878', 8, 6);
  b.box(0.04, 0.34, 0.2, [WX + 0.02, y - 0.12, z], '#b8ae98', 8);
  b.cyl(0.15, 0.32, [WX + 0.5, y, z], '#20242e', 9, { rot: [0, 0, 90], seg: 12 });
  b.cyl(0.18, 0.04, [WX + 0.66, y, z], '#39404e', 10, { rot: [0, 0, 90], seg: 12 });
  b.sphere(0.13, [WX + 0.69, y, z], '#ffe9a0', 11, [0.55, 1, 1]);
}

function wing(b, z0, z1, yTop) {
  const out = 3.1, x0 = WX, x1 = WX + out, y1 = yTop, y0 = yTop - 3.0;
  // the wedge under the wing
  const p = [];
  const quad = (a, c, d, e) => p.push(...a, ...c, ...d, ...a, ...d, ...e);
  const A = [x0, y0, z0], B = [x0, y0, z1], C = [x0, y1, z0], D = [x0, y1, z1], E = [x1, y1, z0], F = [x1, y1, z1];
  quad(A, B, F, E); quad(C, E, F, D);
  p.push(...A, ...E, ...C, ...B, ...D, ...F);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  b.add(g, '#ecd28c', 12);
  b.box(out + 0.2, 0.22, Math.abs(z1 - z0) + 0.3, [WX + out / 2, y1 + 0.1, (z0 + z1) / 2], CREAM, 13);
  b.box(0.05, 1.05, Math.abs(z1 - z0), [x1 + 0.08, y1 + 0.7, (z0 + z1) / 2], '#ffffff', 14);
  for (let k = 0; k <= 5; k++) {
    const z = lerp(z0, z1, k / 5);
    b.pipe([x1, y1 + 0.2, z], [x1, y1 + 1.35, z], 0.03, '#e8e2d2', 15, 5);
    b.pipe([x0 + 0.2, y1 + 1.35, z], [x1, y1 + 1.35, z], 0.024, '#e8e2d2', 15, 5);
  }
  b.pipe([x1, y1 + 1.35, z0], [x1, y1 + 1.35, z1], 0.035, '#e8e2d2', 15, 5);
  b.pipe([x1, y1 + 0.85, z0], [x1, y1 + 0.85, z1], 0.02, '#e8e2d2', 15, 5);
}

function staticSet(cfg) {
  const b = new Batch();
  // ---- accommodation wall, one tall plated face
  const Z0 = 8, Z1 = -74, zc = (Z0 + Z1) / 2, zl = Z0 - Z1;
  b.box(0.6, 46, zl, [WX - 0.3, DY + 23, zc], CREAM, 3);
  for (let y = DY + 2.2; y < DY + 46; y += 2.9) { b.box(0.02, 0.05, zl, [WX + 0.012, y, zc], '#cfc4aa', 4); }
  for (let z = Z0 - 2; z > Z1; z -= 7.5) { b.box(0.02, 46, 0.05, [WX + 0.012, DY + 23, z], '#cfc4aa', 4); }
  // heavy belt plate at the foot
  b.box(0.12, 1.1, zl, [WX + 0.04, DY + 2.0, zc], CREAM2, 5);
  // ---- ports in three rows, the middle one at eye level
  for (let z = -4.2; z > Z1 + 3; z -= 2.5) {
    port(b, 38.3, z, 0.56, 1.66);
    port(b, 42.7, z - 0.8, 0.56, 1.66);
    if (Math.abs(z + 24) > 4) port(b, 47.1, z, 0.56, 1.66);
    if (z < -10) port(b, 33.9, z - 0.8, 0.56, 1.16);
  }
  for (let k = 0; k < 8; k++) lamp(b, 40.05, -6.3 - k * 7.5);
  wing(b, -23.0, -26.8, 44.6);
  // rust and cable runs on the wall
  const rr = new Rng(16);
  for (let i = 0; i < 40; i++) {
    const z = rr.range(-70, 4), y = rr.range(32, 46), h = rr.range(0.3, 1.5);
    b.box(0.015, h, rr.range(0.03, 0.09), [WX + 0.018, y, z], '#b9794f', 4);
  }
  b.pipe([WX + 0.14, 36.0, 8], [WX + 0.14, 36.0, -74], 0.05, '#cfc8b6', 8, 6);
  b.pipe([WX + 0.22, 36.3, 8], [WX + 0.22, 36.3, -74], 0.03, '#e0a020', 8, 6);
  for (let z = 4; z > -74; z -= 3) b.box(0.26, 0.06, 0.06, [WX + 0.12, 36.15, z], '#a39b88', 8);
  // ---- deck, walkway and fittings at the foot of the wall
  b.box(110, 0.2, 170, [50, DY - 0.1, -70], '#2c9f7c', 16);
  b.box(1.5, 0.08, 170, [WX + 0.8, DY + 0.05, -70], '#7cd0a4', 17);
  for (let z = 4; z > -74; z -= 1.9) b.box(1.5, 0.03, 0.06, [WX + 0.8, DY + 0.1, z], '#58b08a', 17);
  b.pipe([WX + 0.4, DY + 0.7, 8], [WX + 0.4, DY + 0.7, -74], 0.1, '#d6d0bf', 18, 8);
  b.pipe([WX + 1.45, DY + 1.05, 2], [WX + 1.45, DY + 1.05, -74], 0.045, '#f2b82e', 19, 6);
  b.pipe([WX + 1.45, DY + 0.55, 2], [WX + 1.45, DY + 0.55, -74], 0.03, '#f2b82e', 19, 6);
  for (let z = 2; z > -74; z -= 2.2) b.pipe([WX + 1.45, DY, z], [WX + 1.45, DY + 1.05, z], 0.03, '#f2b82e', 19, 6);
  for (const z of [-15, -31, -47]) {
    b.cyl(0.26, 1.2, [WX + 0.7, DY + 0.7, z], '#e23a2a', 20, { seg: 10 });
    b.sphere(0.27, [WX + 0.7, DY + 1.32, z], '#e23a2a', 20);
    b.box(0.5, 0.14, 0.14, [WX + 0.7, DY + 1.0, z], '#f05030', 20);
    b.box(0.5, 1.2, 0.8, [WX + 0.25, DY + 1.6, z + 2.2], '#d42f24', 21);
    b.box(0.06, 0.9, 0.5, [WX + 0.52, DY + 1.6, z + 2.2], '#f7f0de', 22);
  }
  // ladder and a stack cage against the first row
  for (const s of [0, 0.5]) b.pipe([0.3, DY, -3.8 + s], [0.3, 37.2, -3.8 + s], 0.035, '#f2b82e', 19, 6);
  for (let y = DY + 0.4; y < 37; y += 0.36) b.pipe([0.3, y, -3.8], [0.3, y, -3.3], 0.022, '#f2b82e', 19, 5);
  // ---- lashing rods crossed over the door ends of the first row
  for (let i = 0; i < 16; i++) {
    const cx = 1.75 + i * 2.53, zd = -5.05, y0 = 31.7, y1 = 36.6;
    for (const s of [-1, 1]) {
      b.pipe([cx + s * 1.16, y0, zd], [cx - s * 1.16, y1, zd], 0.026, '#f4f1e6', 28, 5);
      b.box(0.09, 0.5, 0.09, [cx + s * 0.62, y0 + 1.1, zd], '#f2b82e', 27);
    }
  }
  // ---- lashing bridge between the near bays
  const LB = -33.5;
  for (const dz of [-0.7, 0.7]) {
    b.box(90, 0.14, 0.14, [45, 36.9, LB + dz], '#f2b82e', 23);
    b.box(90, 0.08, 0.08, [45, 37.9, LB + dz], '#f2b82e', 23);
    for (let x = 0; x < 90; x += 2.53) {
      b.box(0.14, 6.7, 0.14, [x, 33.6, LB + dz], '#3f7fb0', 24);
      b.box(0.08, 1.0, 0.08, [x, 37.4, LB + dz], '#f2b82e', 23);
      b.pipe([x, 34, LB + dz], [x + 1.2, 36.6, LB + dz * 3.4], 0.025, '#e4dfd2', 25, 4);
      b.pipe([x + 2.4, 34, LB + dz], [x + 1.2, 36.6, LB + dz * 3.4], 0.025, '#e4dfd2', 25, 4);
    }
  }
  // ---- the stays
  const stay = (a, c, r) => b.pipe(a, c, r, '#101622', 26, 5);
  for (const [bx, tx, tz] of [[45.4, -0.2, 6], [54.7, 1.0, 6.5]]) {
    const base = [bx, 36.9, -44], top = [tx, 57, tz];
    for (const o of [0, 0.34]) stay([base[0] + o, base[1], base[2] + o * 0.4], [top[0] + o, top[1], top[2] + o * 0.4], 0.05);
    b.box(0.5, 0.5, 0.5, [base[0], base[1] + 0.1, base[2]], '#f2b82e', 27);
    b.pipe([base[0], 36.9, base[2]], [base[0] - 1.2, 39.4, base[2] + 1.1], 0.11, '#2b3040', 27, 6);
  }
  const sag = (A, C, drop, n, r) => {
    let prev = A;
    for (let i = 1; i <= n; i++) {
      const u = i / n, p = [lerp(A[0], C[0], u), lerp(A[1], C[1], u) - drop * 4 * u * (1 - u), lerp(A[2], C[2], u)];
      b.pipe(prev, p, r, '#101622', 26, 4); prev = p;
    }
  };
  sag([1.5, 53, 1], [52.5, 37.4, -60], 2.8, 14, 0.04);
  sag([0.4, 55, 2], [21.6, 40.5, -100], 2.0, 10, 0.03);
  sag([-0.6, 50, -3], [18.2, 40.6, -100], 1.6, 10, 0.03);
  sag([-0.6, 58, -1], [14.2, 40.6, -100], 1.6, 10, 0.03);
  void cfg;
  return b.build();
}

const NEAR = ['#254fb6', '#e6bb4e', '#2c9e5c', '#c8443a', '#2587d6', '#f0ead8', '#ea7a24', '#1c9c8e', '#7a54c8'];
const ROWC = ['#c8443a', '#d87a3a', '#254fb6', '#2c9e5c', '#1c9c8e', '#e6bb4e', '#7a8ea4', '#b23a5a'];
function doorSeed(r, want) {
  // containerMaterial picks the door end from fract(seed * 13.1)
  for (let i = 0; i < 40; i++) { const s = r.next(); if ((((s * 13.1) % 1) < 0.5) === want) return s; }
  return 0.1;
}
function containerList() {
  const r = new Rng(160);
  const out = [];
  const add = (x, y, z, col, logo = -1, len = 1) => out.push({ x, y, z, col, logo, seed: doorSeed(r, true), id: 30 + (out.length % 60), far: 30 + (out.length % 5), flip: 1, len });
  const X = (i) => 1.75 + i * 2.53, Y = (t) => 31.6 + 1.3 + t * 2.62;
  // two near bays, door ends to the camera
  for (let i = 0; i < 40; i++) {
    const c = NEAR[i < NEAR.length ? i : r.int(0, NEAR.length - 1)];
    for (let t = 0; t < 2; t++) add(X(i), Y(t), -11.3, t === 1 ? c : NEAR[(i + 3) % NEAR.length]);
    for (let t = 0; t < 2; t++) add(X(i), Y(t), -23.8, t === 1 ? NEAR[(i * 5 + 2) % NEAR.length] : c);
  }
  // further bays climb toward the bow
  let blk = 0;
  const bays = [[-44, 2, 0, 42], [-56.5, 2, 0, 42], [-82, 3, 2, 40], [-94.5, 3, 2, 40], [-120, 5, 2, 15], [-132.5, 6, 2, 15], [-146, 6, 2, 13]];
  for (const [z, tiers, i0, i1] of bays) {
    for (let i = i0; i < i1; i++) {
      if (i % 4 === 0) blk = r.int(0, ROWC.length - 1);
      const c = ROWC[(blk + (r.next() < 0.3 ? r.int(0, 7) : 0)) % ROWC.length];
      const h = tiers - (r.next() < 0.12 ? 1 : 0);
      for (let t = 0; t < h; t++) add(X(i), Y(t), z, r.next() < 0.25 ? ROWC[r.int(0, 7)] : c, r.next() < 0.5 ? r.int(0, 6) : -1);
    }
  }
  return out;
}

// spray that bursts past the wing and slaps the lens: a hand-drawn wipe in the overlay
function sprayWipe(ctx) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uK: { value: 0 }, uT: { value: 0 }, uJ: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uK, uT, uJ;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i = 0; i < 5; i++){ s += a * n(p); p = p * 2.03 + 11.0; a *= 0.5; } return s; }
      void main(){
        vec2 p = vUv * vec2(1.85, 1.0);
        // the mass climbs from the wall's foot, lower left, and rolls over the frame
        float d = length((p - vec2(0.3, -0.1)) * vec2(0.9, 1.0));
        float f = fbm(p * 4.2 + vec2(-uT * 0.7, -uT * 1.3));
        float f2 = fbm(p * 11.0 + vec2(uT * 0.4, -uT * 2.0));
        float edge = uK * 2.5 - d + (f - 0.5) * 0.9 + (f2 - 0.5) * 0.26;
        // a tall jet of spray in the gap between the wall and the first row, leaning over the boxes
        float jd = length((p - vec2(0.33 + 0.16 * p.y * p.y, -0.12)) * vec2(3.0, 1.0));
        edge = max(edge, uJ - jd + (f - 0.5) * 0.62 + (f2 - 0.5) * 0.24);
        float a = smoothstep(0.0, 0.012, edge);
        float mid = smoothstep(0.1, 0.112, edge + (f2 - 0.5) * 0.3);
        float core = smoothstep(0.26, 0.272, edge + (f - 0.5) * 0.5);
        vec3 c = mix(vec3(0.66, 0.78, 0.98), vec3(0.86, 0.93, 1.0), mid);
        c = mix(c, vec3(1.0), core);
        // the mass stays drawn even when it fills the frame: lavender folds
        c = mix(c, vec3(0.74, 0.84, 1.0), 0.8 * core * smoothstep(0.5, 0.53, fbm(p * 2.6 + vec2(uT * 0.5, -uT * 0.9))));
        // loose droplets ahead of the front
        vec2 g = floor(p * 46.0);
        float dr = step(0.985, h(g + floor(uT * 8.0))) * step(length(fract(p * 46.0) - 0.5), 0.3 + 0.16 * h(g + 3.0)) * smoothstep(-0.3, -0.02, edge) * (1.0 - a);
        gl_FragColor = vec4(mix(vec3(1.0), c, a), clamp(a + dr, 0.0, 1.0));
      }`,
  });
  const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
  q.frustumCulled = false; q.visible = false; q.renderOrder = 8;
  ctx.overlay.add(q);
  return q;
}

export function createS16(ctx, api, parent) {
  const g = new THREE.Group();
  g.name = 's16set';
  g.visible = false;
  parent.add(g);
  const mat = shipMaterial({ weather: 0.55 });
  mat.uniforms.uRestScale.value = 0.55;
  const st = new THREE.Mesh(staticSet(), mat);
  st.frustumCulled = false;
  g.add(st);
  const list = containerList();
  const boxes = instancedContainers(list, api.boxGeo, api.cMat);
  g.add(boxes);
  const wipe = sprayWipe(ctx);
  const _f = new THREE.Vector3();
  return {
    group: g,
    update(s) {
      const on = s.sid === 's16';
      g.visible = on;
      wipe.visible = on;
      if (!on) return;
      // the containers hold the frame; the sea climbs the gap by the wall, and only the last
      // beats of the shot does the mass roll over the lens
      const k = smooth(invLerp(1.02, 1.42, s.lt));
      const u = wipe.material.uniforms;
      u.uK.value = k; u.uT.value = onThrees(s.t);
      u.uJ.value = lerp(0.3, 1.02, smooth(invLerp(0.0, 1.15, s.lt)));
      const cam = ctx.camera;
      wipe.position.copy(cam.position).add(_f.set(0, 0, -1).applyQuaternion(cam.quaternion));
      wipe.quaternion.copy(cam.quaternion);
      const hgt = 2 * Math.tan(deg(cam.fov) / 2);
      wipe.scale.set(hgt * (1920 / 1040) * 1.02, hgt * 1.02, 1);
    },
  };
}
void clamp; void crew;
