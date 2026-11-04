import * as THREE from 'three';
import { G, COMMON, MRT_OUT, VERT_STD } from './glsl.js';
import { PAINT_LIGHT } from './bgmaterials.js';
import { mergeVertices } from '../vendor/addons/BufferGeometryUtils.js';
import { Rng } from './util.js';

// The coast: sea toward -X, the arrow flies out over it. A long beach curves away toward
// -Z up to rocky capes; +X rises through fields and a town to blue hills.
// ctx.world.terrain(x, z) gives the ground height; surf is drawn by the water pass from the
// seabed depth, so it follows this shoreline by itself.

// ---- deterministic noise (JS side, must stay pure)
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vn(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, o = 4) { let s = 0, a = 0.5; for (let i = 0; i < o; i++) { s += a * vn(x, y); x = x * 2.03 + 1.7; y = y * 2.03 + 9.2; a *= 0.5; } return s; }
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (x, c, w) => Math.exp(-((x - c) * (x - c)) / (2 * w * w));

const CAPES = [[-1250, 240, 300], [-2900, 480, 700], [-5200, 700, 900]];  // z, half width, how far it juts out
const wig = (z) => 34 * Math.sin(z * 0.0031 + 1.0) + 16 * Math.sin(z * 0.0107 + 0.4);
const wig0 = wig(0);
export function shoreX(z) {
  let s = -52 + wig(z) - wig0;
  s += -z * 0.30 + 0.16 * (Math.sqrt(z * z + 90000) - 300);
  for (const [cz, w, out] of CAPES) s -= out * gauss(z, cz, w);
  return s;
}
export function shoreDist(x, z) { return x - shoreX(z) + (fbm(x * 0.0045 + 4, z * 0.0045, 3) - 0.47) * 56 * sst(30, 400, Math.abs(z) + Math.abs(x)); }

export function terrainHeight(x, z) {
  const d = shoreDist(x, z);
  if (d < 0) {
    const a = -d;
    return -(0.05 * Math.min(a, 140) + 0.11 * Math.max(a - 140, 0)) * 1 - 0.02;
  }
  let h = Math.min(d, 110) * 0.05;
  h += sst(100, 520, d) * 12;
  h += (fbm(x * 0.0095, z * 0.0095, 3) - 0.5) * 14 * sst(80, 360, d);
  // hills: ridged, climbing inland
  const k = sst(620, 4200, d);
  if (k > 0) {
    const ridge = 1 - Math.abs(fbm(x * 0.00062 + 7, z * 0.00062, 5) * 2 - 1);
    h += k * (70 + 560 * k) * (0.35 + 0.95 * ridge * ridge);
    h += k * 60 * (fbm(x * 0.0035, z * 0.0035 + 3, 4) - 0.5);
  }
  // capes end in cliffs
  for (const [cz, w] of CAPES) {
    const c = gauss(z, cz, w * 0.75);
    if (c > 0.02) h += c * sst(0, 34 + 30 * vn(x * 0.02, z * 0.02), d) * (46 + 60 * fbm(x * 0.004, z * 0.004, 3) + 40 * sst(0, 500, d));
  }
  // a mountain rim hides where the world ends
  const r = Math.hypot(x, z);
  h += sst(4800, 7300, r) * 640 * sst(0, 700, d);
  return h;
}

// ---- shared painted-prop shading
const INST_VERT = /* glsl */ `
attribute vec3 aTint;
attribute float aPart;
varying vec3 vTint;
varying float vPart;
varying vec3 vWorld, vNormalW, vNormalV, vLocal;
varying float vDepth;
varying vec2 vUv;
void main(){
  mat4 im = instanceMatrix;
  vec4 wp = modelMatrix * im * vec4(position, 1.0);
  vWorld = wp.xyz; vLocal = position;
  vec3 nn = normalize(mat3(modelMatrix) * mat3(im) * normal);
  vNormalW = nn;
  vNormalV = normalize(mat3(viewMatrix) * nn);
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  vUv = uv; vTint = aTint; vPart = aPart;
  gl_Position = projectionMatrix * mv;
}
`;
const hardLight = /* glsl */ `
vec3 hardPaint(vec3 col, vec3 N, vec3 wp, float grain){
  float ndl = dot(N, uSunDir) + grain;
  float sh = sunShadow(wp, N);
  float lit = smoothstep(0.02, 0.1, ndl) * sh;
  vec3 shade = col * mix(uShadeTint, vec3(0.86, 0.9, 1.04), 0.45);
  vec3 sun = col * uSunColor * 1.04;
  return mix(shade, sun, lit);
}
`;
function propMaterial() {
  const u = { ...G };
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    ${hardLight}
    varying vec3 vTint; varying float vPart;
    varying vec3 vWorld, vNormalW, vNormalV, vLocal;
    varying float vDepth; varying vec2 vUv;
    void main(){
      if(uPass > 1.5 && vWorld.y < uWaterLevel - 0.03) discard;
      if(uPass > 0.5 && uPass < 1.5){ oColor = vec4(1); oData = vec4(0); return; }
      vec3 N = normalize(vNormalW), NV = normalize(vNormalV);
      if(!gl_FrontFacing){ N = -N; NV = -NV; }
      vec3 col = vTint;
      float grain = 0.0;
      if(vPart < 0.5){            // walls: floors, windows, balconies drawn in world metres
        col = mix(vec3(1.0, 0.97, 0.9), vTint, 0.45);
        float along = abs(N.x) > abs(N.z) ? vWorld.z : vWorld.x;
        float fy = fract(vWorld.y / 3.4), fx = fract(along / 3.6);
        float win = step(0.3, fy) * step(fy, 0.78) * step(0.22, fx) * step(fx, 0.8);
        float lod = smoothstep(420.0, 160.0, vDepth);
        float wall = step(abs(N.y), 0.3);
        col = mix(col, vec3(0.30, 0.48, 0.74), win * wall * lod);
        // far away the windows merge into pale floor bands
        col = mix(col, col * vec3(0.9, 0.92, 0.97), step(0.5, fract(vWorld.y / 6.8)) * wall * (1.0 - lod) * 0.8);
        if(N.y > 0.7) col = mix(vec3(0.62, 0.66, 0.74), vec3(0.8, 0.8, 0.84), step(0.92, fract(vWorld.x / 7.0)));
      } else if(vPart < 1.5){     // roof tiles
        col *= 0.9 + 0.18 * step(0.5, fract(vLocal.y * 2.0 + vLocal.z * 0.4));
      } else if(vPart < 2.5){     // tree crowns: broken leafy edge, clumps in three greens
        vec3 Vd = normalize(cameraPosition - vWorld);
        float near = smoothstep(420.0, 120.0, vDepth);
        float leaf = vnoise3(vWorld * 1.7 + vTint * 5.0) * 0.6 + vnoise3(vWorld * 4.3) * 0.4;
        if(near > 0.0 && abs(dot(N, Vd)) < 0.62 * leaf * near) discard;
        float n = fbm3(vWorld * vec3(0.42) + vTint * 7.0);
        float clump = vnoise3(vWorld * 0.95 + vTint * 3.0);
        grain = (n - 0.5) * 1.6 + (clump - 0.5) * 0.8;
        float hi = step(0.36, N.y + grain * 0.8 + dot(N, uSunDir) * 0.3);
        float deep = step(N.y * 0.5 + grain * 0.9, -0.28);
        col = mix(vTint * 1.25, vTint * vec3(2.0, 1.72, 1.0), hi);
        col = mix(col, vTint * vec3(0.62, 0.76, 0.98), deep);
      } else {                    // rock: big struck planes painted flat, a thin line where two planes meet
        // the smooth normal, snapped to a coarse lattice of directions: each cell is one flat face
        const mat3 RM = mat3(0.80, 0.36, -0.48, -0.20, 0.91, 0.36, 0.57, -0.20, 0.80);
        vec3 wn = vec3(vnoise3(vWorld * 0.11 + 1.3), vnoise3(vWorld * 0.11 + 5.1), vnoise3(vWorld * 0.11 + 9.7)) - 0.5;
        wn += 0.3 * (vec3(vnoise3(vWorld * 0.47 + 2.2), vnoise3(vWorld * 0.47 + 7.4), vnoise3(vWorld * 0.47 + 4.6)) - 0.5);
        vec3 rn = RM * normalize(N + wn * 0.75) * 2.1;
        vec3 cell = floor(rn + 0.5);
        vec3 fN = normalize(transpose(RM) * cell);
        vec3 fd = abs(fract(rn + 0.5) - 0.5);          // 0.5 on a boundary between faces
        float seam = smoothstep(0.5 - 1.4 * length(fwidth(rn)), 0.5, max(fd.x, max(fd.y, fd.z)));
        N = normalize(mix(N, fN, 0.92));
        float tone = hash12(cell.xy + cell.z * 7.3) - 0.5;
        vec3 base = mix(vec3(0.70, 0.56, 0.47), vec3(0.78, 0.63, 0.50), step(0.0, tone)) * (1.0 + tone * 0.16);
        col = mix(base, base * vec3(1.34, 1.26, 1.08), smoothstep(0.3, 0.5, N.y));   // sky-facing planes run warm
        // a crisp wet line at the foot, in a cool painted tone
        float wetB = smoothstep(1.1, 1.06, vWorld.y - uWaterLevel + (vnoise3(vWorld * 0.31) - 0.5) * 1.4);
        col = mix(col, col * vec3(0.62, 0.56, 0.68), seam * 0.8 * (1.0 - wetB));
        col = mix(col, col * vec3(0.74, 0.68, 0.84), wetB);
      }
      writeOut(hardPaint(col, N, vWorld, grain), 1.0, NV, vDepth, 0.0);
    }
  `;
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: INST_VERT, fragmentShader: fs, side: THREE.DoubleSide });
}

function terrainMaterial() {
  const u = { ...G };
  const vs = /* glsl */ `
    attribute float aD;
    varying float vD;
    ${VERT_STD}
    void main(){ vD = aD; stdVertex(position, normal); }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    ${hardLight}
    varying vec3 vWorld, vNormalW, vNormalV;
    varying float vDepth, vD;
    varying vec2 vUv;
    float bump(vec2 p, float foot){
      float b = fbm2(p * 0.022) * 7.0;
      if(foot < 6.0) b += fbm2(p * 0.11 + 3.0) * 1.6;
      if(foot < 1.2) b += fbm2(p * 0.55 + 7.0) * 0.32;
      return b;
    }
    float roadLine(vec2 p, float d){
      // the coast road follows the shore; a straight lane runs inland
      float r = abs(d - 215.0 - 16.0 * sin(p.y * 0.006));
      float r2 = abs(p.x - 330.0 - 34.0 * sin(p.y * 0.003) - 0.2 * p.y);
      return min(r, r2);
    }
    void main(){
      if(uPass > 1.5 && vWorld.y < uWaterLevel - 0.03) discard;
      if(uPass > 0.5 && uPass < 1.5){ oColor = vec4(1); oData = vec4(0); return; }
      vec3 N = normalize(vNormalW), NV = normalize(vNormalV);
      if(!gl_FrontFacing){ N = -N; NV = -NV; }
      vec2 p = vWorld.xz;
      float foot = vDepth * 0.0014;
      float eb = max(foot * 2.0, 0.5);
      float b0 = bump(p, foot);
      vec3 Nb = normalize(N + vec3(b0 - bump(p + vec2(eb, 0.0), foot), 0.0, b0 - bump(p + vec2(0.0, eb), foot)) / eb * 0.8);
      float slope = 1.0 - N.y;
      float nA = fbm2(p * 0.0065), nB = fbm2(p * 0.034 + 9.0), nC = fbm2(p * 0.19 + 4.0);
      float d = vD + (nB - 0.5) * 34.0;

      // ---- the ground, in hard painted patches
      vec3 sandDry = vec3(1.0, 0.90, 0.66), sandWet = vec3(0.72, 0.62, 0.47);
      vec3 grassA = vec3(0.46, 0.84, 0.30), grassB = vec3(0.24, 0.68, 0.34), grassC = vec3(0.70, 0.86, 0.34), scrub = vec3(0.16, 0.50, 0.36);
      vec3 col = sandDry;
      col = mix(col, sandDry * vec3(0.93, 0.9, 0.86), step(0.55, nC));
      if(foot < 3.0){
        float rip = sin(dot(p, vec2(0.34, 0.94)) * 1.25 + nB * 15.0 + nC * 4.0);
        col *= 1.0 - 0.07 * step(0.45, rip) * (1.0 - smoothstep(1.2, 3.0, foot));
        float peb = step(0.76, vnoise(p * 1.9)) * step(0.5, vnoise(p * 0.21 + 2.0));
        col = mix(col, vec3(0.62, 0.52, 0.56), peb * 0.75 * (1.0 - smoothstep(0.5, 1.6, foot)));
      }
      float wrack = 1.0 - smoothstep(0.6, 1.8, abs(vD - 40.0 + (nB - 0.5) * 26.0 + (nC - 0.5) * 6.0));
      col = mix(col, vec3(0.55, 0.46, 0.42), wrack * 0.45);
      float wet = 1.0 - smoothstep(10.0, 34.0, vD + (nC - 0.5) * 18.0);
      col = mix(col, sandWet, wet * 0.85);
      if(vWorld.y < 0.0) col = mix(col, vec3(0.86, 0.80, 0.62), 0.6);
      float grs = smoothstep(96.0, 108.0, d);
      vec3 g = mix(grassB, grassA, step(0.47, nA + (nC - 0.5) * 0.16));
      g = mix(g, grassC, step(0.58, nB + (nC - 0.5) * 0.12));
      g = mix(g, scrub, step(0.56, nA * 0.5 + nC * 0.5 + 0.06));
      // farmland: ruled strips of crops on the plain
      float fieldM = step(0.5, vnoise(p * 0.0052 + 21.0)) * smoothstep(300.0, 420.0, vD) * (1.0 - smoothstep(1400.0, 1900.0, vD));
      vec2 fq = floor(p / 84.0);
      float fh = hash12(fq);
      vec3 fc = fh < 0.33 ? vec3(0.92, 0.84, 0.36) : (fh < 0.66 ? vec3(0.56, 0.86, 0.36) : vec3(0.32, 0.72, 0.36));
      fc *= 0.95 + 0.1 * step(0.5, fract((fh > 0.5 ? p.x : p.y) * 0.16));
      float gapF = step(0.04, fract(p.x / 84.0)) * step(0.04, fract(p.y / 84.0));
      g = mix(g, mix(scrub, fc, gapF), fieldM);
      // the far hills go to deep forest with sunlit clearings
      float hillK = smoothstep(26.0, 150.0, vWorld.y);
      vec3 forest = mix(vec3(0.12, 0.46, 0.38), vec3(0.22, 0.62, 0.40), step(0.5, nB + (nC - 0.5) * 0.3));
      g = mix(g, forest, hillK * (1.0 - step(0.72, nA + 0.1)));
      col = mix(col, g, grs);
      // bare rock on anything steep
      float rockK = smoothstep(0.30, 0.42, slope + (nC - 0.5) * 0.25);
      float strata = fract(vWorld.y * 0.09 + nB * 1.6);
      vec3 rock = mix(vec3(0.74, 0.66, 0.60), vec3(0.54, 0.47, 0.54), step(0.5, strata));
      rock = mix(rock, vec3(0.88, 0.80, 0.68), step(0.62, nC));
      col = mix(col, rock, rockK);
      // roads
      float rd = roadLine(p, vD);
      float wR = max(5.5, foot * 1.4);
      float roadM = (1.0 - smoothstep(wR, wR + foot + 0.6, rd)) * smoothstep(120.0, 150.0, vD) * (1.0 - hillK);
      col = mix(col, vec3(0.62, 0.62, 0.68), roadM);
      float dash = step(0.5, fract(p.y * 0.05)) * (1.0 - smoothstep(0.2, 0.6 + foot, rd));
      col = mix(col, vec3(1.0, 0.97, 0.86), dash * roadM * 0.9);

      // ---- two hard tones with a touch of sky bounce on the low ground
      float grain = (nC - 0.5) * 0.16;
      vec3 outc = hardPaint(col, normalize(mix(N, Nb, 0.75)), vWorld, grain);
      writeOut(outc, 1.0, NV, vDepth, 0.0);
    }
  `;
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs, side: THREE.DoubleSide });
}

// ---- geometry helpers
function houseGeometry() {
  // unit house 1 x 1 x 1 walls with a gable roof; aPart 0 wall, 1 roof
  const P = [], N = [], A = [], I = [];
  const quad = (a, b, c, d, part) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const i = P.length / 3;
    for (const v of [a, b, c, d]) { P.push(v.x, v.y, v.z); N.push(n.x, n.y, n.z); A.push(part); }
    I.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  const tri = (a, b, c, part) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const i = P.length / 3;
    for (const v of [a, b, c]) { P.push(v.x, v.y, v.z); N.push(n.x, n.y, n.z); A.push(part); }
    I.push(i, i + 1, i + 2);
  };
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const w = 0.5, h = 1, r = 1.55, o = 0.58;
  quad(v(-w, 0, w), v(w, 0, w), v(w, h, w), v(-w, h, w), 0);
  quad(v(w, 0, -w), v(-w, 0, -w), v(-w, h, -w), v(w, h, -w), 0);
  quad(v(w, 0, w), v(w, 0, -w), v(w, h, -w), v(w, h, w), 0);
  quad(v(-w, 0, -w), v(-w, 0, w), v(-w, h, w), v(-w, h, -w), 0);
  tri(v(-w, h, w), v(w, h, w), v(0, r, w), 0);
  tri(v(w, h, -w), v(-w, h, -w), v(0, r, -w), 0);
  quad(v(o, h - 0.06, o), v(o, h - 0.06, -o), v(0, r, -o), v(0, r, o), 1);
  quad(v(0, r, o), v(0, r, -o), v(-o, h - 0.06, -o), v(-o, h - 0.06, o), 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(P.length / 3 * 2), 2));
  g.setIndex(I);
  return { geo: g, part: A };
}
function rockGeometry(seed) {
  let g = new THREE.IcosahedronGeometry(1, 9);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  // cut by a few random planes so it reads as broken stone, then roughen
  const rng = new Rng(seed * 100);
  const planes = [];
  for (let i = 0; i < 13; i++) {
    const a = rng.next() * 6.283, y = rng.range(-0.4, 0.9), c = Math.sqrt(1 - y * y);
    planes.push([new THREE.Vector3(Math.cos(a) * c, y, Math.sin(a) * c), rng.range(0.6, 0.84)]);
  }
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    for (const [n, d] of planes) { const q = v.dot(n); if (q > d) v.addScaledVector(n, d - q); }
    const r = fbm(v.x * 2.4 + v.y + seed, v.z * 2.4 - v.y * 0.7, 4) - 0.5;
    v.multiplyScalar(1 + r * 0.14);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
function lumpGeometry(detail, amp, seed) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm(v.x * 1.7 + v.y + seed, v.z * 1.7 - v.y * 0.7, 3) - 0.5;
    v.multiplyScalar(1 + n * amp);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
function instanced(geo, material, list, partFn) {
  const n = list.length;
  const m = new THREE.InstancedMesh(geo, material, n);
  const tint = new Float32Array(n * 3);
  const dummy = new THREE.Object3D();
  list.forEach((it, i) => {
    dummy.position.set(it.x, it.y, it.z);
    dummy.rotation.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0);
    dummy.scale.set(it.sx, it.sy, it.sz);
    dummy.updateMatrix();
    m.setMatrixAt(i, dummy.matrix);
    tint.set(it.c, i * 3);
  });
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  if (partFn !== undefined) {
    const vc = geo.attributes.position.count;
    if (typeof partFn === 'number') geo.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(vc).fill(partFn), 1));
    else geo.setAttribute('aPart', new THREE.Float32BufferAttribute(partFn, 1));
  }
  m.frustumCulled = false;
  m.userData.noShadow = true;
  return m;
}

export function buildCoast(ctx) {
  const group = new THREE.Group();
  group.visible = false;
  ctx.scene.add(group);
  ctx.world.terrain = terrainHeight;
  ctx.world.shoreX = shoreX;

  // ---- ground mesh: dense round the robot, stretching to the rim mountains
  const N = 620, EXT = 8200;
  const count = (N + 1) * (N + 1);
  const pos = new Float32Array(count * 3), dist = new Float32Array(count), hmap = new Float32Array(count);
  const warp = (u) => Math.sign(u) * (0.04 * Math.abs(u) + 0.96 * Math.pow(Math.abs(u), 2.3)) * EXT;
  const xs = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) xs[i] = warp(i / N * 2 - 1);
  for (let j = 0, k = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++, k++) {
      let x = xs[i], z = xs[j];
      const rr = Math.hypot(x, z);
      if (rr > 7500) { x *= 7500 / rr; z *= 7500 / rr; }
      const h = terrainHeight(x, z);
      hmap[k] = h;
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      dist[k] = shoreDist(x, z);
    }
  }
  const nrm = new Float32Array(count * 3);
  for (let j = 0, k = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++, k++) {
      const il = Math.max(i - 1, 0), ir = Math.min(i + 1, N), jd = Math.max(j - 1, 0), ju = Math.min(j + 1, N);
      const dx = (hmap[j * (N + 1) + ir] - hmap[j * (N + 1) + il]) / (xs[ir] - xs[il]);
      const dz = (hmap[ju * (N + 1) + i] - hmap[jd * (N + 1) + i]) / (xs[ju] - xs[jd]);
      const l = Math.hypot(dx, 1, dz);
      nrm[k * 3] = -dx / l; nrm[k * 3 + 1] = 1 / l; nrm[k * 3 + 2] = -dz / l;
    }
  }
  const idx = new Uint32Array(N * N * 6);
  for (let j = 0, q = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('aD', new THREE.BufferAttribute(dist, 1));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const ground = new THREE.Mesh(geo, terrainMaterial());
  ground.frustumCulled = false; ground.userData.noShadow = true;
  group.add(ground);

  // ---- set dressing
  const rng = new Rng(4242);
  const prop = propMaterial();
  const roofs = [[0.86, 0.32, 0.22], [0.92, 0.5, 0.22], [0.2, 0.46, 0.8], [0.78, 0.24, 0.3], [0.3, 0.68, 0.7], [0.96, 0.74, 0.3]];
  const houses = [], trees = [], blocks = [], trunks = [], shadows = [];
  const roadClear = (x, z) => {
    const d = shoreDist(x, z);
    return Math.abs(d - 215 - 16 * Math.sin(z * 0.006)) > 15 && Math.abs(x - 330 - 34 * Math.sin(z * 0.003) - 0.2 * z) > 15;
  };
  const addHouse = (x, z, s) => {
    const y = terrainHeight(x, z);
    const c = roofs[rng.int ? rng.int(0, roofs.length - 1) : Math.floor(rng.next() * roofs.length)];
    houses.push({ x, y: y - 0.3, z, ry: Math.round(rng.next() * 3) * Math.PI / 2 + rng.range(-0.15, 0.15), sx: s * rng.range(1, 1.5), sy: s * rng.range(0.7, 1), sz: s * rng.range(1.2, 2), c });
  };
  // foreground town by the sea (the reference has it right under the camera)
  for (let i = 0; i < 2600 && houses.length < 1500; i++) {
    const z = rng.range(-700, 1100), d = rng.range(180, 1000);
    const x = shoreX(z) + d;
    if (fbm(x * 0.008, z * 0.008, 2) < 0.42 + 0.1 * rng.next()) continue;
    if (!roadClear(x, z)) continue;
    addHouse(x, z, rng.range(5, 8));
  }
  // hill towns: clusters climbing the far slopes
  for (const [cx, cz, r, n] of [[2300, -900, 620, 500], [1700, -2400, 720, 600], [3100, -3200, 900, 500], [3200, 300, 800, 400], [900, -4200, 800, 300]]) {
    for (let i = 0; i < n; i++) {
      const a = rng.next() * 6.283, q = Math.sqrt(rng.next()) * r;
      const x = cx + Math.cos(a) * q, z = cz + Math.sin(a) * q * 0.7;
      if (shoreDist(x, z) < 90) continue;
      addHouse(x, z, rng.range(9, 14));
    }
  }
  // apartment and hotel slabs by the coast road
  for (let i = 0; i < 46; i++) {
    const z = rng.range(-3200, -1500), x = shoreX(z) + rng.range(235, 460);
    if (!roadClear(x, z)) continue;
    const y = terrainHeight(x, z);
    blocks.push({ x, y: y - 1, z, ry: rng.range(-0.3, 0.3), sx: rng.range(12, 20), sy: rng.range(12, 30), sz: rng.range(20, 38), c: [0.82, 0.84, 0.86] });
  }
  for (let i = 0; i < 9000; i++) {
    const z = rng.range(-3800, 1500), d = rng.range(120, 2200) * (i % 3 ? 1 : 0.5);
    const x = shoreX(z) + d;
    if (i % 2 && fbm(x * 0.006 + 3, z * 0.006, 3) < 0.48) continue;
    if (!roadClear(x, z)) continue;
    const s = rng.range(3.2, 7.5), y = terrainHeight(x, z);
    if (y > 200 || shoreDist(x, z) < 118) continue;
    const c = rng.next() < 0.5 ? [0.13, 0.46, 0.30] : [0.20, 0.52, 0.27];
    const near = Math.hypot(x, z) < 760;
    const h = s * rng.range(1.5, 2.3);                  // crown sits on a trunk, wider than tall
    if (!near) { trees.push({ x, y: y + h * 0.55, z, ry: rng.next() * 6, sx: s, sy: s * 0.86, sz: s, c }); continue; }
    trunks.push({ x, y: y - 0.4, z, ry: rng.next() * 6, sx: s * 0.13, sy: h * 1.1, sz: s * 0.13, c: [0.42, 0.32, 0.30] });
    shadows.push({ x: x + s * 0.5, y: y + 0.15, z: z + s * 0.3, ry: rng.next() * 6, sx: s * 1.5, sy: 0.1, sz: s * 1.2, c: [0.12, 0.40, 0.34] });
    trees.push({ x, y: y + h, z, ry: rng.next() * 6, sx: s, sy: s * 0.72, sz: s, c });
    for (let k = 0; k < 3; k++) {
      const a = rng.next() * 6.283, q = s * rng.range(0.55, 0.85), r = s * rng.range(0.52, 0.72);
      trees.push({ x: x + Math.cos(a) * q, y: y + h + rng.range(-0.4, 0.5) * s, z: z + Math.sin(a) * q, ry: rng.next() * 6, sx: r, sy: r * 0.8, sz: r, c });
    }
  }
  const hg = houseGeometry();
  group.add(instanced(hg.geo, prop, houses, Float32Array.from(hg.part)));
  const hb = houseGeometry();
  const flat = new THREE.BoxGeometry(1, 1, 1);
  flat.translate(0, 0.5, 0);
  group.add(instanced(flat, prop, blocks, 0));
  void hb;
  group.add(instanced(lumpGeometry(3, 1.0, 1.3), prop, trees, 2));
  const tg = new THREE.CylinderGeometry(0.62, 1, 1, 6, 1).translate(0, 0.5, 0);
  tg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(tg.attributes.position.count * 2), 2));
  group.add(instanced(tg, prop, trunks, 3.9));
  const sg = new THREE.SphereGeometry(1, 12, 6);
  group.add(instanced(sg, prop, shadows, 3.9));

  // shoreline rocks, thick round the robot's front foot
  const rocks = [];
  for (let i = 0; i < 210; i++) {
    const z = rng.range(-1600, 800);
    const near = i < 60;
    const zz = near ? rng.range(-170, 170) : z;
    const x = shoreX(zz) + (near ? rng.range(-34, 46) : rng.range(-60, 26));
    const s = (near ? rng.range(1.2, 5.5) : rng.range(1.5, 7)) * (rng.next() < 0.12 ? 1.9 : 1);
    const y = terrainHeight(x, zz);
    rocks.push({ x, y: y + s * 0.18, z: zz, rx: rng.range(-0.3, 0.3), ry: rng.next() * 6, rz: rng.range(-0.3, 0.3), sx: s * rng.range(1, 1.7), sy: s * rng.range(0.55, 0.9), sz: s * rng.range(0.9, 1.4), c: [0.64, 0.6, 0.66] });
  }
  group.add(instanced(rockGeometry(7.7), prop, rocks, 3));

  // two lines of pylons striding up the coast (the reference has one at frame right)
  const pyl = [];
  for (let i = 0; i < 26; i++) {
    const z = 700 - i * 230;
    const x = shoreX(z) + 560 + 60 * Math.sin(i);
    const y = terrainHeight(x, z);
    for (const [ox, oy, sx, sy, sz, rz] of [[0, 0, 7, 44, 7, 0], [0, 40, 26, 1.6, 1.6, 0], [0, 33, 34, 1.6, 1.6, 0], [0, 47, 3, 10, 3, 0]]) pyl.push({ x: x + ox, y: y + oy, z, sx, sy, sz, rz, c: [0.7, 0.74, 0.84] });
  }
  const pb = new THREE.BoxGeometry(1, 1, 1); pb.translate(0, 0.5, 0);
  group.add(instanced(pb, prop, pyl, 3.9));

  return {
    update(st) {
      group.visible = st.set === 'coast';
    },
  };
}
