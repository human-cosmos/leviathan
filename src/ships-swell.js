import * as THREE from 'three';
import { G, COMMON, MRT_OUT, VERT_STD } from './glsl.js';
import { WAKE } from './ships-tex.js';
import { halfBeam, BAYS, paintCol } from './ships-model.js';
import { BOX } from './ships-mat.js';
import { Rng, clamp, lerp, smooth, track, deg, onThrees, invLerp, easeIn } from './util.js';
import { S23 } from './cams/ships.js';

// s23. The leviathan's swell: a painted, sculpted water mesh that fills the frame, its crest
// standing in for the horizon. The film's flat sea is off in this shot. Everything is laid out
// in the crest's frame: the crest runs along z = 0, the slope faces the camera at +z.
export const SWELL = { start: 45.1 };

const tau = (t) => t - SWELL.start;
const amp = (tt) => lerp(92, 215, smooth(tt / 3.8));
const width = (tt) => lerp(430, 380, smooth(tt / 3.8));
// the crest comes on from far astern and runs in under the ships; a trough opens ahead of it
const crest0 = (tt) => lerp(-290, 0, Math.pow(clamp(tt / 4.23), 1.1));
const base = (tt) => lerp(125, 0, smooth(tt / 4.23));

function chop(x, z, tt) {
  // the long swells riding on the big one; moving with the wave
  const a = Math.sin(x * 0.011 + z * 0.019 + tt * 0.9) * 5.2;
  const b = Math.sin(x * 0.027 - z * 0.041 - tt * 1.3 + 1.7) * 3.2;
  const c = Math.sin(z * 0.08 + x * 0.013 + tt * 2.1) * 2.2;
  return a + b + c;
}
function crestZ(x, tt) { return crest0(tt) - 0.00022 * x * x + 16 * Math.sin(x * 0.006 + 1.3 + tt * 0.3); }

const profileAt = (x, z, tt) => { const u = z - crestZ(x, tt); const s = u >= 0 ? u / width(tt) : -u / 160; return u >= 0 ? Math.exp(-Math.pow(s, 1.45)) : Math.exp(-s * s); };
export function surf(x, z, tt) {
  const p = profileAt(x, z, tt);
  // the lip of the crest is torn: lumps that break the skyline
  const lip = Math.pow(p, 10) * (9 * Math.sin(x * 0.037 + tt * 1.4) + 7 * Math.sin(x * 0.083 - tt * 2.2 + 1.0) + 4 * Math.sin(x * 0.17 + 2.0));
  // behind the crest the sea falls away out of sight, so the crest itself is the skyline
  const u = z - crestZ(x, tt), back = u < 0 ? 0.0016 * u * u : 0;
  return base(tt) + amp(tt) * p + lip + chop(x, z, tt) * (0.5 + 0.5 * p) - back;
}

// each ship: its centre rides the surface at (x, zc); the bow faces the camera at +z
const RIG = [
  { // left: on the crest at first, the wave leaves it behind and it drops out of sight
    x: -316, yaw: 0.22, kind: 'teal', seed: 41, sink: true,
    zc: [[0, -372], [4.3, -350]],
    pitch: [[0, 12], [1.2, 9], [2.4, -6], [3.5, -13], [4.3, -15]],
    roll: [[0, -4], [2.2, -9], [4.3, -14]],
  },
  { // centre: the hero, its stern lifts until it stands on end
    x: -36, yaw: -0.2, kind: 'red', seed: 42, hero: true,
    zc: [[0, 62], [2.1, 112], [4.3, 196]], dig: 16,
    pitch: [[0, -3], [0.7, 2], [1.3, 18], [1.8, 38], [2.1, 48], [3.0, 54], [4.3, 58]],
    roll: [[0, 1], [2.1, 10], [4.3, 18]],
  },
  { // right: rises to the crest and spills its stern stacks
    x: 176, yaw: -0.2, kind: 'navy', seed: 43,
    zc: [[0, -80], [4.3, -146]],
    pitch: [[0, -4], [1.0, 6], [2.0, 22], [3.0, 30], [3.6, 20], [4.3, -6]],
    roll: [[0, 2], [2.4, 7], [4.3, 12]],
  },
];

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _v = new THREE.Vector3();
const _pp = new THREE.Vector3(), _qq = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1), _ee = new THREE.Euler(0, 0, 0, 'YXZ'), _vv = new THREE.Vector3();
function shipPose(R, tt, m = _m) {
  let p = deg(track(R.pitch, tt));
  const roll = deg(track(R.roll, tt)), yaw = R.yaw;
  const zc = track(R.zc, tt);
  // she lies along the water: never flatter than the slope under her
  const hz = 140 * Math.cos(p), hx = 140 * Math.sin(yaw);
  const sb = surf(R.x + hx, zc + hz, tt), ss = surf(R.x - hx, zc - hz, tt);
  if (!R.sink) p = Math.max(p, Math.atan2(ss - sb, 280));
  _ee.set(p, yaw, roll);
  _qq.setFromEuler(_ee);
  let yc;
  if (R.sink) yc = surf(R.x, zc, tt) - 7;       // left astern, she goes down behind the crest with the sea
  else {
    // the bow is what stays in the water; the stern rears clear of it
    _vv.set(0, 0, 140).applyQuaternion(_qq);
    yc = surf(R.x + _vv.x, zc + _vv.z, tt) + 1 - (R.dig ?? 0) - _vv.y;
  }
  _pp.set(R.x, yc, zc);
  m.compose(_pp, _qq, _one);
  return { pos: _pp, p, yaw, roll };
}

// ------------------------------------------------------------------ painted sea
function seaMaterial(mask) {
  const u = {
    ...G,
    uMask: { value: mask },
    uShipA: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uShipB: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uDrawT: { value: 0 }, uScroll: { value: 0 },
  };
  const vs = /* glsl */ `
    attribute float aProf;
    varying float vProf;
    varying vec3 vRig;
    ${VERT_STD}
    void main(){ vProf = aProf; vRig = position; stdVertex(position, normal); }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    uniform sampler2D uMask;
    uniform vec4 uShipA[3], uShipB[3];
    uniform float uDrawT, uScroll;
    varying vec3 vWorld, vNormalW, vNormalV;
    varying float vDepth, vProf;
    varying vec3 vRig;
    varying vec2 vUv;
    // elongated drawn whitecaps: an ellipse per cell, thin curved crescents
    float flecks(vec2 q, vec2 cs, float dens, float seed){
      vec2 p = q / cs, ci = floor(p);
      float best = 0.0;
      for(int j = -1; j <= 1; j++) for(int i = -1; i <= 1; i++){
        vec2 c = ci + vec2(float(i), float(j));
        vec2 h = hash22(c + seed);
        if(h.x > dens) continue;
        vec2 o = c + 0.2 + 0.6 * hash22(c * 1.7 + seed + 3.0);
        vec2 d = (p - o);
        d.y += d.x * d.x * (h.y - 0.5) * 2.6;           // curved
        float r = length(d * vec2(1.25, 4.6 + 3.0 * h.y));
        best = max(best, 1.0 - smoothstep(0.26 + 0.2 * h.y, 0.34 + 0.2 * h.y, r));
      }
      return best;
    }
    void main(){
      if(uPass > 0.5) discard;
      vec3 N = normalize(vNormalW), NV = normalize(vNormalV);
      if(!gl_FrontFacing){ N = -N; NV = -NV; }
      vec2 q = vRig.xz;
      vec2 qs = q + vec2(0.0, -uScroll);
      float T = uDrawT;
      // ---- body colour: deep ultramarine valley to glassy turquoise near the crest
      float warp = fbm2(qs * vec2(0.008, 0.03) + 3.0) - 0.5;
      float tone = vProf * 0.8 + warp * 0.34 + (N.z - 0.1) * 0.22;
      vec3 c0 = vec3(0.012, 0.09, 0.42), c1 = vec3(0.02, 0.17, 0.6), c2 = vec3(0.03, 0.28, 0.72), c3 = vec3(0.04, 0.46, 0.76), c4 = vec3(0.18, 0.7, 0.74);
      vec3 col = mix(c0, c1, smoothstep(0.1, 0.16, tone));
      col = mix(col, c2, smoothstep(0.32, 0.38, tone));
      col = mix(col, c3, smoothstep(0.6, 0.66, tone));
      col = mix(col, c4, smoothstep(0.82, 0.88, tone));
      // ---- wave faces: crescents of shadow and sky sheen, the medium sea
      float ripA = fbm2(qs * vec2(0.014, 0.06) + vec2(T * 0.1, 0.0));
      float ripB = fbm2(qs * vec2(0.03, 0.14) + vec2(-T * 0.16, 7.0));
      float dark = smoothstep(0.56, 0.59, ripA);
      col = mix(col, col * vec3(0.5, 0.55, 0.78), dark * 0.85);
      float sheen = smoothstep(0.58, 0.61, ripB) * (1.0 - dark);
      col = mix(col, mix(col, vec3(0.42, 0.72, 0.95), 0.62), sheen);
      float rib = smoothstep(0.5, 0.53, fbm2(qs * vec2(0.06, 0.34) + 11.0));
      col = mix(col, col * 1.22 + vec3(0.0, 0.02, 0.03), rib * 0.5);
      // ---- whitecaps: dashes lying across the view, on threes
      vec2 qf = qs + vec2(T * 3.0, 0.0);
      float f = 0.0;
      f = max(f, flecks(qf, vec2(46.0, 30.0), 0.42, 1.0));
      f = max(f, flecks(qf + 13.0, vec2(24.0, 17.0), 0.32, 5.0) * 0.95);
      f = max(f, flecks(qf + 37.0, vec2(12.0, 9.0), 0.22, 9.0) * 0.85);
      f *= smoothstep(0.3, 0.46, fbm2(qs * 0.012 + 21.0) + 0.14 * vProf + 0.1);
      col = mix(col, vec3(0.97, 0.99, 1.0), f);
      // ---- foam fingers running down the crest
      float fing = fbm2(vec2(q.x * 0.05, q.y * 0.012 - T * 0.18));
      float crestK = smoothstep(0.9, 0.995, vProf);
      float cf = smoothstep(0.62 - 0.46 * crestK, 0.66 - 0.46 * crestK, fing + 0.1 * vnoise(q * 0.15)) * smoothstep(0.86, 0.95, vProf);
      float cfShade = smoothstep(0.5, 0.56, fbm2(vec2(q.x * 0.1, q.y * 0.03) + 41.0));
      col = mix(col, mix(vec3(1.0), vec3(0.62, 0.78, 0.98), cfShade * 0.8), cf);
      // ---- foam round the hulls and in their wakes
      float wake = 0.0;
      for(int i = 0; i < 3; i++){
        vec4 A = uShipA[i], B = uShipB[i];
        if(B.y <= 0.0) continue;
        vec2 rel = q - A.xy;
        float cy = cos(A.z), sy = sin(A.z);
        float lx = rel.x * cy - rel.y * sy;
        float lz = (rel.x * sy + rel.y * cy) / max(A.w, 0.2);
        vec2 uvm = vec2((${WAKE.zAhead.toFixed(1)} - lz) / ${(WAKE.zAhead - WAKE.zAstern).toFixed(1)}, (lx + ${WAKE.xw.toFixed(1)}) / ${(2 * WAKE.xw).toFixed(1)});
        float m = (uvm.x > 0.0 && uvm.x < 1.0 && uvm.y > 0.0 && uvm.y < 1.0) ? texture(uMask, uvm).r : 0.0;
        m *= B.y * smoothstep(B.x - 30.0, B.x + 30.0, lz);
        wake = max(wake, m);
      }
      float wn = fbm2(q * vec2(0.09, 0.05) + vec2(T * 0.25, -T * 0.4)) * 0.75 + vnoise(q * 0.5 + T) * 0.25;
      float wEdge = wn - (1.0 - wake) * 0.92 - 0.04;
      float wf = smoothstep(0.0, 0.03, wEdge);
      vec3 foamC = mix(vec3(0.5, 0.82, 0.9), vec3(0.98, 1.0, 1.0), smoothstep(0.03, 0.09, wEdge));
      // veins of shade in the foam, running with the water
      float veins = smoothstep(0.5, 0.54, fbm2(q * vec2(0.16, 0.05) + vec2(T * 0.3, -T * 0.5) + 31.0));
      foamC = mix(foamC, vec3(0.6, 0.76, 0.98), veins * 0.75 * smoothstep(0.02, 0.2, wEdge));
      col = mix(col, foamC, wf);
      // sun sparkle on the upper faces
      float glint = step(0.993, hash12(floor(gl_FragCoord.xy / 2.0) + floor(T * 8.0))) * smoothstep(0.4, 0.8, vProf);
      col += glint * 0.8;
      writeOut(col, 1.0, NV, vDepth, 0.0);
    }
  `;
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs, side: THREE.DoubleSide });
}

// ------------------------------------------------------------------ white water thrown up by a hull
function wingMaterial() {
  const u = { ...G, uAmount: { value: 1 }, uDrawT: { value: 0 }, uSeed: { value: 0 } };
  const vs = /* glsl */ `
    uniform float uAmount, uDrawT;
    attribute vec2 aP;
    varying vec2 vP;
    ${VERT_STD}
    void main(){
      vP = aP;
      vec3 p = position;
      float sw = sin(aP.x * 14.0 + uDrawT * 4.0) * 0.5 + sin(aP.x * 31.0 - uDrawT * 6.0) * 0.3;
      p += normal * aP.y * (sw * 5.0 + 3.0);
      stdVertex(p, normal);
    }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    uniform float uAmount, uDrawT, uSeed;
    varying vec3 vWorld, vNormalW, vNormalV;
    varying float vDepth;
    varying vec2 vP;
    void main(){
      if(uPass > 0.5) discard;
      vec3 N = normalize(vNormalW), NV = normalize(vNormalV);
      if(!gl_FrontFacing){ N = -N; NV = -NV; }
      float T = uDrawT;
      float x = vP.x * 7.0 + uSeed, y = vP.y;
      // the sheet tears into streaks and drops toward its top edge
      float n = fbm2(vec2(x * 3.2, y * 1.1 - T * 0.9));
      float n2 = vnoise(vec2(x * 16.0, y * 8.0 - T * 2.0));
      float keep = n * 0.72 + n2 * 0.28 + 0.62 - y * 1.0 - (1.0 - uAmount) * 0.7;
      if(keep < 0.28) discard;
      float ndl = dot(N, uKeyDir);
      float lit = smoothstep(0.3, 0.36, ndl * 0.5 + 0.2 + (n - 0.5) * 1.5 + 0.2 * (1.0 - y));
      vec3 col = mix(vec3(0.55, 0.72, 0.98), vec3(1.0), lit);
      float edge = smoothstep(0.28, 0.36, keep);
      col = mix(col * vec3(0.78, 0.9, 1.0), col, edge);
      col = mix(vec3(0.16, 0.62, 0.72), col, smoothstep(0.0, 0.16, y + (n - 0.5) * 0.2));
      writeOut(col, 1.0, NV, vDepth, 100.0);
    }
  `;
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs, side: THREE.DoubleSide });
}
function wingGeometry() {
  const NU = 60, NV = 12;
  const pos = [], ap = [], idx = [];
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      const z = lerp(150, -40, u);
      const hb = halfBeam(z, 0);
      const H = 56 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.04)), 0.7) + 7;
      for (let j = 0; j <= NV; j++) {
        const v = j / NV;
        const out = 2 + 15 * v + 20 * v * v * (0.4 + u);
        pos.push(side * (hb + out), H * Math.pow(v, 0.8) * (1 - 0.16 * v), z + 34 * v * v);
        ap.push(u, v);
      }
    }
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
      const a = base + i * (NV + 1) + j, b = a + NV + 1;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aP', new THREE.Float32BufferAttribute(ap, 2));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(ap.length), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ the plume behind the crest
function puffMaterial() {
  const u = { ...G };
  const vs = /* glsl */ `
    attribute vec2 aPuff;
    varying float vTone;
    ${VERT_STD}
    void main(){
      vTone = aPuff.x;
      vec4 lp = instanceMatrix * vec4(position, 1.0);
      stdVertex(lp.xyz, normalize(mat3(instanceMatrix) * normal));
    }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    varying vec3 vWorld, vNormalW, vNormalV;
    varying float vDepth, vTone;
    void main(){
      if(uPass > 0.5) discard;
      vec3 N = normalize(vNormalW), NV = normalize(vNormalV);
      float n = fbm3(vWorld * 0.03 + 3.0);
      float ndl = dot(N, uKeyDir) + (n - 0.5) * 1.1;
      vec3 sh = vec3(0.62, 0.66, 0.92), mid = vec3(0.86, 0.89, 0.99), lit = vec3(1.0);
      vec3 col = mix(sh, mid, smoothstep(-0.12, -0.06, ndl));
      col = mix(col, lit, smoothstep(0.3, 0.36, ndl));
      col = mix(col, vec3(0.82, 0.92, 1.0), vTone * 0.5);
      writeOut(col, 1.0, NV, vDepth, 0.0);
    }
  `;
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs });
}

export function createSwell(ctx, api) {
  const g = new THREE.Group();
  g.name = 'swell';
  ctx.scene.add(g);
  g.visible = false;

  // the sea mesh
  const NX = 300, NZ = 320, X0 = -1100, X1 = 1100, Z0 = -1900, Z1 = 1100;
  const n = (NX + 1) * (NZ + 1);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), prof = new Float32Array(n), uvs = new Float32Array(n * 2);
  const zOf = (j) => Z0 + (Z1 - Z0) * (j / NZ);
  const xs = Array.from({ length: NX + 1 }, (_, i) => X0 + (X1 - X0) * (i / NX));
  const zs = Array.from({ length: NZ + 1 }, (_, j) => zOf(j));
  const idx = [];
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const a = j * (NX + 1) + i, b = a + NX + 1;
    idx.push(a, b, b + 1, a, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aProf', new THREE.BufferAttribute(prof, 1));
  geo.setIndex(idx);
  const seaM = seaMaterial(api.tex.wake);
  const sea = new THREE.Mesh(geo, seaM);
  sea.frustumCulled = false;
  g.add(sea);
  let lastT = -1;
  function buildSea(tt) {
    if (lastT === tt) return;
    lastT = tt;
    let k = 0;
    for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++, k++) {
      const x = xs[i], z = zs[j];
      pos[k * 3] = x; pos[k * 3 + 1] = surf(x, z, tt); pos[k * 3 + 2] = z;
      prof[k] = profileAt(x, z, tt);
    }
    k = 0;
    for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++, k++) {
      const il = Math.max(0, i - 1), ir = Math.min(NX, i + 1), jl = Math.max(0, j - 1), jr = Math.min(NZ, j + 1);
      const dx = (pos[(j * (NX + 1) + ir) * 3 + 1] - pos[(j * (NX + 1) + il) * 3 + 1]) / (xs[ir] - xs[il]);
      const dz = (pos[(jr * (NX + 1) + i) * 3 + 1] - pos[(jl * (NX + 1) + i) * 3 + 1]) / (zs[jr] - zs[jl]);
      const l = Math.hypot(dx, 1, dz);
      nor[k * 3] = -dx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -dz / l;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.attributes.aProf.needsUpdate = true;
  }

  // ships and what falls off them
  const rng = new Rng(77);
  const ships = RIG.map((R) => {
    const fall = [];
    const stack = new THREE.Group();
    const list0 = null;
    void list0;
    const root = api.makeShip({ kind: R.kind, seed: R.seed, tiers: 7, hero: !!R.hero, wake: false });
    root.matrixAutoUpdate = false;
    g.add(root);
    // the top tiers of the aft bays come loose: lifted out of the ship's own instances
    const list = root.userData.list;
    if (R.x > -100) {
      const boxes = root.userData.boxes;
      const cand = [];
      list.forEach((c, i) => { if (c.z < -96 && c.y > 26 && c.len > 0.9) cand.push(i); });
      cand.sort((a, b) => list[b].y - list[a].y);
      const pick = cand.slice(0, R.hero ? 34 : 18);
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (const i of pick) { boxes.setMatrixAt(i, zero); fall.push(list[i]); }
      boxes.instanceMatrix.needsUpdate = true;
    }
    void stack;
    const wing = new THREE.Mesh(wingGeometry(), wingMaterial());
    wing.material.uniforms.uSeed.value = R.x * 0.01;
    wing.frustumCulled = false;
    root.add(wing);
    return { R, root, fall, wing };
  });

  // loose containers: one instanced mesh, driven each frame
  const allFall = ships.flatMap((s, si) => s.fall.map((c, k) => ({ c, si, k })));
  const fallM = allFall.length ? (() => {
    const m = new THREE.InstancedMesh(api.boxGeo, api.cMat, allFall.length);
    const a0 = new Float32Array(allFall.length * 4), a1 = new Float32Array(allFall.length * 4), col = new THREE.Color();
    allFall.forEach(({ c }, i) => {
      paintCol(c.col, col);
      a0.set([col.r, col.g, col.b, 2 + (i % 50)], i * 4);
      a1.set([c.logo, c.seed, c.len, 2 + (i % 50)], i * 4);
    });
    m.geometry = api.boxGeo.clone();
    m.geometry.setAttribute('aI0', new THREE.InstancedBufferAttribute(a0, 4));
    m.geometry.setAttribute('aI1', new THREE.InstancedBufferAttribute(a1, 4));
    m.frustumCulled = false;
    g.add(m);
    return m;
  })() : null;
  const spin = allFall.map(() => new THREE.Vector3(rng.range(-1, 1), rng.range(-0.6, 0.6), rng.range(-1, 1)).normalize());
  const spinW = allFall.map(() => rng.range(0.5, 1.6));
  const relT = allFall.map((f, i) => (f.si === 1 ? 1.3 + 0.05 * f.k : 1.7 + 0.08 * f.k) + rng.range(0, 0.25));
  const kick = allFall.map((f, i) => { const v = new THREE.Vector3(rng.range(4, 34), rng.range(16, 44), rng.range(-8, 20)); if (f.si === 1) { v.x = (i % 4 === 0 ? -1 : 1) * (48 + v.x * 2.4); v.y += 30; } return v; });

  const _mS = new THREE.Matrix4(), _mL = new THREE.Matrix4(), _qS = new THREE.Quaternion(), _qA = new THREE.Quaternion(), _pS = new THREE.Vector3();
  function driveFall(tt) {
    if (!fallM) return;
    allFall.forEach((f, i) => {
      const R = ships[f.si].R;
      const t0 = relT[i];
      const age = tt - t0;
      const c = f.c;
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.flip > 0 ? Math.PI / 2 : -Math.PI / 2);
      _mL.compose(_pS.set(c.x, c.y, c.z), _q, _s.set(c.len, 1, 1));
      shipPose(R, Math.min(tt, t0), _mS);
      _mS.multiply(_mL);
      if (age > 0) {
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
        _mS.decompose(p, q, sc);
        p.addScaledVector(kick[i], f.si === 1 ? (1 - Math.exp(-1.1 * age)) / 1.1 : age);   // the hero's boxes burst out, then drop
        p.y -= 19 * age * age;                         // anime gravity: heavy, not floaty
        _qA.setFromAxisAngle(spin[i], spinW[i] * age);
        q.premultiply(_qA);
        sc.multiplyScalar(1 + 0.7 * smooth(age / 0.6));   // cheat: loose boxes read bigger, like the reference
        _mS.compose(p, q, sc);
        const sy = surf(p.x, p.z, tt) - 8;
        if (p.y < sy) _mS.makeScale(0, 0, 0);
      }
      fallM.setMatrixAt(i, _mS);
    });
    fallM.instanceMatrix.needsUpdate = true;
  }

  // plume of white water beyond the crest
  const NP = 240;
  const ico = new THREE.IcosahedronGeometry(1, 5);
  {
    const p = ico.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const k = 1 + 0.16 * Math.sin(v.x * 5.1 + 1.0) * Math.sin(v.y * 4.3) + 0.12 * Math.sin(v.z * 7.7 + v.y * 3.0);
      p.setXYZ(i, v.x * k, v.y * k, v.z * k);
    }
    // smooth round billows: each normal leans outward from the centre
    const nn = ico.attributes.normal;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); nn.setXYZ(i, v.x, v.y, v.z); }
  }
  const puffs = new THREE.InstancedMesh(ico, puffMaterial(), NP);
  puffs.frustumCulled = false;
  const pr = new Rng(5);
  const pd = Array.from({ length: NP }, () => {
    const u = pr.next();
    const xn = pr.range(-1, 1);
    return {
      x: xn, u, z: pr.range(0, 1), r: pr.range(0.45, 1) * (1 - 0.55 * Math.abs(xn)), h: pr.next() * (1 - 0.6 * xn * xn), ph: pr.next(),
    };
  });
  const aP = new Float32Array(NP * 2);
  pd.forEach((d, i) => { aP[i * 2] = d.z; aP[i * 2 + 1] = d.ph; });
  puffs.geometry = ico.clone();
  puffs.geometry.setAttribute('aPuff', new THREE.InstancedBufferAttribute(aP, 2));
  g.add(puffs);
  function drivePuffs(tt, drawT) {
    // rises to a peak about two seconds in, then collapses behind the crest
    const grow = smooth(tt / 1.9) * (1 - 0.92 * smooth(invLerp(2.1, 3.6, tt)));
    const cx = lerp(50, 90, tt / 4);
    const baseY = base(tt) + amp(tt) - 26;
    pd.forEach((d, i) => {
      const x = cx + d.x * lerp(190, 300, smooth(tt / 2));
      const h = grow * (d.h * d.h * 62 + 10);
      const wob = Math.sin(drawT * 2.4 + d.ph * 40) * 3;
      const y = baseY + h + wob - (1 - grow) * 40;
      const z = crestZ(x, tt) - 170 - d.z * 240;
      const r = (9 + 24 * d.r) * (0.45 + 0.75 * grow);
      _m.compose(_p.set(x + h * 0.25, y, z), _q.identity(), _s.set(r, r * (0.9 + 0.012 * h), r));
      puffs.setMatrixAt(i, _m);
    });
    puffs.instanceMatrix.needsUpdate = true;
    puffs.visible = grow > 0.02;
  }

  // a wall of cumulus far behind the crest: the same painted puffs, fixed in the world
  const NC = 150;
  const cloud = new THREE.InstancedMesh(ico, puffs.material, NC);
  cloud.frustumCulled = false;
  {
    const cr = new Rng(19);
    const bank = (x0, x1, top, n, off) => {
      for (let i = 0; i < n; i++) {
        const u = cr.next(), x = lerp(x0, x1, u), e = 1 - Math.pow(2 * u - 1, 2);
        const h = cr.next() * top * e, r = lerp(150, 62, h / top) * cr.range(0.7, 1.2);
        _m.compose(_p.set(x, 900 + h - 40, -3600 + cr.range(-300, 300)), _q.identity(), _s.set(r, r * 0.86, r));
        cloud.setMatrixAt(off + i, _m);
      }
    };
    bank(-1500, -240, 420, 55, 0);
    bank(200, 1500, 560, 70, 55);
    bank(-300, 300, 150, 25, 125);
    const ca = new Float32Array(NC * 2).fill(0);
    cloud.geometry = ico.clone();
    cloud.geometry.setAttribute('aPuff', new THREE.InstancedBufferAttribute(ca, 2));
  }
  ctx.scene.add(cloud);
  cloud.visible = false;

  return {
    group: g,
    surf,
    active: (st) => st.sid === 's23',
    update(st) {
      const on = st.sid === 's23';
      g.visible = on;
      cloud.visible = on;
      if (!on) return;
      const tt = tau(st.t), drawT = onThrees(st.t);
      // the sea is tilted up toward the lens about the camera, so a long, high lens sees the
      // crest against the sky: the shot is a painted cheat, not a real horizon
      const P = S23.pos, th = deg(S23.tilt);
      g.rotation.set(th, 0, 0);
      g.position.set(0, P[1] - (P[1] * Math.cos(th) - P[2] * Math.sin(th)), P[2] - (P[1] * Math.sin(th) + P[2] * Math.cos(th)));
      // deep summer blue all the way down to the crest
      api.deepSky('#2a8cf0', '#7cc8f6', '#70c0f4');
      buildSea(tt);
      seaM.uniforms.uDrawT.value = drawT;
      seaM.uniforms.uScroll.value = tt * 34;
      ships.forEach((s, i) => {
        const P = shipPose(s.R, tt, s.root.matrix);
        s.root.matrixWorldNeedsUpdate = true;
        const A = seaM.uniforms.uShipA.value[i], B = seaM.uniforms.uShipB.value[i];
        A.set(P.pos.x, P.pos.z, P.yaw, Math.cos(P.p));
        // only the part of the hull still in the sea throws foam
        const hide = s.R.x < -100 ? smooth(invLerp(2.4, 1.6, tt)) : 1;
        B.set(s.R.hero ? -30 : -60, 1.0 * hide, 0, 0);
        const w = s.wing.material.uniforms;
        const amt = s.R.hero ? smooth(invLerp(1.0, 3.0, tt)) : (s.R.x > 0 ? smooth(invLerp(0.8, 2.6, tt)) : 0.5 * (1 - smooth(invLerp(1.0, 1.8, tt))));
        w.uAmount.value = amt;
        s.wing.visible = amt > 0.04;
        w.uDrawT.value = drawT;
      });
      driveFall(tt);
      drivePuffs(tt, drawT);
    },
  };
}
void BAYS; void BOX; void clamp; void easeIn;
