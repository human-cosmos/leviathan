import * as THREE from 'three';
import { mergeGeometries } from '../vendor/addons/BufferGeometryUtils.js';
import { G, COMMON, MRT_OUT } from './glsl.js';
import { WU, WATER_GLSL, raw } from './under-env.js';
import { fbm, gridGeo, blobGeo } from './under-rock.js';
import { Rng, clamp } from './util.js';

// ---- silt: billowing painted puffs. A small baked atlas of cauliflower heads (normal + mask);
// drawn as depth-aware sprites in the overlay, moving as a pure function of time.
let atlasTex = null;
function puffAtlas() {
  if (atlasTex) return atlasTex;
  const N = 512, C = 2, cell = N / C;
  const data = new Uint8Array(N * N * 4);
  const r = new Rng(4242);
  for (let cy = 0; cy < C; cy++) for (let cx = 0; cx < C; cx++) {
    const bumps = [];
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = r.range(0, Math.PI * 2), d = i === 0 ? 0 : r.range(0.25, 0.62), rad = i === 0 ? 0.5 : r.range(0.17, 0.33);
      bumps.push([Math.cos(a) * d, Math.sin(a) * d, rad]);
    }
    const hgt = new Float32Array(cell * cell);
    const sd = cx * 7 + cy * 13;
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const u = (x + 0.5) / cell * 2 - 1, v = (y + 0.5) / cell * 2 - 1;
      const wx = u + 0.12 * fbm(u * 3 + sd, v * 3, 1.5, 3), wy = v + 0.12 * fbm(u * 3, v * 3 + sd, 4.5, 3);
      let h = -1;
      for (const b of bumps) {
        const dx = wx - b[0], dy = wy - b[1], d2 = dx * dx + dy * dy, r2 = b[2] * b[2];
        if (d2 < r2) h = Math.max(h, Math.sqrt(r2 - d2));
      }
      if (h > 0) h += 0.035 * fbm(u * 9 + sd, v * 9, 7.5, 3);
      hgt[y * cell + x] = h;
    }
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const h = hgt[y * cell + x];
      const hx = hgt[y * cell + Math.min(x + 1, cell - 1)] - hgt[y * cell + Math.max(x - 1, 0)];
      const hy = hgt[Math.min(y + 1, cell - 1) * cell + x] - hgt[Math.max(y - 1, 0) * cell + x];
      const nx = clamp(-hx * 26, -1, 1), ny = clamp(-hy * 26, -1, 1);
      const i = ((cy * cell + y) * N + cx * cell + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = clamp(h * 2.2) * 255;
      data[i + 3] = h > 0 ? 255 : 0;
    }
  }
  atlasTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  atlasTex.minFilter = THREE.LinearFilter; atlasTex.magFilter = THREE.LinearFilter;
  atlasTex.generateMipmaps = false; atlasTex.needsUpdate = true;
  return atlasTex;
}

// emits: [{ p, v, k, size, t0, life, seed }]
export function makePuffs(emits, o = {}) {
  const n = emits.length;
  const g = new THREE.InstancedBufferGeometry();
  const q = new THREE.PlaneGeometry(2, 2);
  g.index = q.index; g.setAttribute('position', q.attributes.position);
  const P = new Float32Array(n * 4), V = new Float32Array(n * 4), T = new Float32Array(n * 4);
  emits.forEach((e, i) => {
    P.set([e.p[0], e.p[1], e.p[2], e.size], i * 4);
    V.set([e.v?.[0] ?? 0, e.v?.[1] ?? 0, e.v?.[2] ?? 0, e.k ?? 1.2], i * 4);
    T.set([e.t0, e.life, e.seed ?? (i * 0.61803) % 1, e.grow ?? 1], i * 4);
  });
  g.setAttribute('aP', new THREE.InstancedBufferAttribute(P, 4));
  g.setAttribute('aV', new THREE.InstancedBufferAttribute(V, 4));
  g.setAttribute('aT', new THREE.InstancedBufferAttribute(T, 4));
  g.instanceCount = n;
  const u = {
    ...WU,
    uAtlas: { value: puffAtlas() }, uSceneData: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
    uT: { value: 0 }, uFogD: { value: 0.0006 }, uSoft: { value: o.soft ?? 26 }, uOp: { value: o.opacity ?? 0.92 },
    uC0: { value: raw(o.c0 ?? '#2b76c4') }, uC1: { value: raw(o.c1 ?? '#5cc6dc') }, uC2: { value: raw(o.c2 ?? '#e6fbf6') },
  };
  const m = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: u, transparent: true, depthTest: false, depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec4 aP, aV, aT;
      uniform float uT;
      uniform vec3 uSunW;
      varying vec2 vQ, vCell;
      varying float vA, vDepth;
      varying vec3 vL, vDir;
      void main(){
        float age = uT - aT.x;
        if(age < 0.0 || age > aT.y){ gl_Position = vec4(3.0, 3.0, 3.0, 1.0); return; }
        float a = age / aT.y;
        vec3 W = aP.xyz + aV.xyz * (1.0 - exp(-aV.w * age)) / aV.w;
        float s = aP.w * (0.5 + aT.w * (0.85 * (1.0 - exp(-3.0 * a)) + 0.3 * a));
        vec4 mv = viewMatrix * vec4(W, 1.0);
        float rot = aT.z * 6.2831 + age * 0.12 * (aT.z - 0.5);
        float c = cos(rot), sn = sin(rot);
        vec2 q = mat2(c, sn, -sn, c) * position.xy;
        mv.xy += q * s;
        vQ = position.xy * 0.5 + 0.5;
        float id = floor(aT.z * 37.0);
        vCell = vec2(mod(id, 2.0), mod(floor(id / 2.0), 2.0));
        vA = smoothstep(0.0, 0.05, a) * smoothstep(1.0, 0.6, a);
        vDepth = -mv.z;
        vec3 sv = (viewMatrix * vec4(uSunW, 0.0)).xyz;
        // keep the light fixed in the sprite's rotated frame
        vL = vec3(mat2(c, -sn, sn, c) * sv.xy, sv.z);
        vDir = normalize(W - cameraPosition);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uAtlas, uSceneData;
      uniform vec2 uRes;
      uniform float uFogD, uSoft, uOp;
      uniform vec3 uC0, uC1, uC2;
      varying vec2 vQ, vCell;
      varying float vA, vDepth;
      varying vec3 vL, vDir;
      out vec4 oColor;
      ${WATER_GLSL}
      void main(){
        vec4 t = texture(uAtlas, (vCell + vQ) * 0.5);
        if(t.a < 0.25) discard;
        vec3 N = normalize(vec3(t.xy * 2.0 - 1.0, 0.75 + t.b * 0.5));
        float l = dot(N, normalize(vL));
        float t1 = smoothstep(-0.1, 0.2, l), t2 = smoothstep(0.38, 0.62, l);
        vec3 c = mix(uC0, mix(uC1, uC2, t2), t1);
        float fog = 1.0 - exp(-max(vDepth, 0.0) * uFogD);
        c = mix(c, waterGrad(vDir), fog);
        float sceneD = texture(uSceneData, gl_FragCoord.xy / uRes).b;
        float soft = clamp((sceneD - vDepth) / uSoft, 0.0, 1.0);
        vec2 rq = vQ * 2.0 - 1.0;
        float a = smoothstep(0.25, 0.7, t.a) * smoothstep(1.0, 0.35, length(rq)) * vA * soft * uOp;
        if(a < 0.004) discard;
        oColor = vec4(c, a);
      }
    `,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}

// ---- marine snow and bubbles: wrap-around points that drift past the camera
export function makeSnow(n = 2600, seed = 5) {
  const r = new Rng(seed);
  const pos = new Float32Array(n * 3), aux = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { pos.set([r.next(), r.next(), r.next()], i * 3); aux.set([r.next(), r.next()], i * 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aAux', new THREE.BufferAttribute(aux, 2));
  const u = {
    uT: { value: 0 }, uBox: { value: 500 }, uSize: { value: 3.2 }, uSceneData: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uH: { value: 1040 }, uRise: { value: 0 },
    uCol: { value: raw('#dcf8ff') }, uOp: { value: 0.55 },
  };
  const m = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: u, transparent: true, depthTest: false, depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec2 aAux;
      uniform float uT, uBox, uSize, uH, uRise;
      varying float vD, vA;
      void main(){
        vec3 drift = vec3(sin(uT * 0.13 + aAux.x * 6.28) * 0.04, -0.012 * uT * (0.6 + aAux.y) + uRise * uT * (0.5 + aAux.y), cos(uT * 0.11 + aAux.y * 6.28) * 0.04 + 0.006 * uT);
        vec3 q = fract(position + drift - cameraPosition / uBox) - 0.5;
        vec4 mv = viewMatrix * vec4(cameraPosition + q * uBox, 1.0);
        vD = -mv.z;
        vA = smoothstep(0.5, 0.36, length(q));
        gl_PointSize = clamp(uSize * (0.35 + aAux.x * aAux.x) * uH / max(vD, 1.0) * 0.32, 1.0, 7.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uSceneData;
      uniform vec2 uRes;
      uniform vec3 uCol;
      uniform float uOp;
      varying float vD, vA;
      out vec4 o;
      void main(){
        float r = length(gl_PointCoord - 0.5);
        if(r > 0.5) discard;
        float sceneD = texture(uSceneData, gl_FragCoord.xy / uRes).b;
        if(sceneD < vD) discard;
        o = vec4(uCol, uOp * vA * smoothstep(0.5, 0.35, r));
      }
    `,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

// ---- small flat-shaded life in the main pass
export function lifeMaterial(o = {}) {
  const u = {
    ...G, ...WU,
    uCol: { value: raw(o.color ?? '#2a5f9c') }, uBelly: { value: raw(o.belly ?? '#dff4f8') }, uIdL: { value: o.id ?? 101 }, uSway: { value: o.sway ?? 0 }, uTime2: { value: 0 },
  };
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: u, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uSway, uTime2;
      varying vec3 vWorld, vN, vNV, vTint, vLocal;
      varying float vDepth;
      void main(){
        vec3 p = position;
        vLocal = p;
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #else
          vTint = vec3(1.0);
        #endif
        vec4 lp = vec4(p, 1.0);
        vec3 ln = normal;
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3][0] * 0.013 + instanceMatrix[3][2] * 0.017;
          lp.xz += uSway * p.y * p.y * vec2(sin(uTime2 * 0.9 + ph + p.y * 3.0), cos(uTime2 * 0.7 + ph * 1.3 + p.y * 2.3));
          lp = instanceMatrix * lp;
          ln = mat3(instanceMatrix) * ln;
        #endif
        vec4 wp = modelMatrix * lp;
        vWorld = wp.xyz;
        vN = normalize(mat3(modelMatrix) * ln);
        vec4 mv = viewMatrix * wp;
        vNV = normalize(mat3(viewMatrix) * vN);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${MRT_OUT}
      ${WATER_GLSL}
      uniform vec3 uCol, uBelly;
      uniform float uIdL;
      varying vec3 vWorld, vN, vNV, vTint, vLocal;
      varying float vDepth;
      void main(){
        vec3 N = normalize(vN), NV = normalize(vNV);
        if(!gl_FrontFacing){ N = -N; NV = -NV; }
        float l = smoothstep(-0.05, 0.05, dot(N, uSunW) + 0.12);
        vec3 c = uCol * vTint;
        c = mix(c * vec3(0.45, 0.6, 0.92), c * 1.15, l);
        writeOut(c, 1.0, NV, vDepth, uIdL);
      }
    `,
  });
}

// Kelp: a tall ribbon stalk with paired blades, instanced and swaying from the root
export function kelpGeo() {
  const parts = [];
  const stalk = gridGeo(3, 14, (u, v, q) => {
    const a = u * Math.PI * 2, r = 0.02 * (1.1 - v);
    q[0] = Math.cos(a) * r + 0.05 * Math.sin(v * 4); q[1] = v; q[2] = Math.sin(a) * r;
  });
  stalk.deleteAttribute('aRest');
  parts.push(stalk);
  for (let i = 0; i < 12; i++) {
    const y0 = 0.08 + i * 0.075, sgn = i % 2 ? 1 : -1, L = 0.21 - i * 0.008;
    const b = gridGeo(1, 6, (u, v, q) => {
      const w = 0.05 * Math.sin(Math.min(v * 1.08, 1) * Math.PI) * (1 - 0.2 * v);
      q[0] = sgn * (v * L) + 0.05 * Math.sin((y0 + v * L * 0.5) * 4); q[1] = y0 + v * L * 0.6 + (u - 0.5) * w * 2; q[2] = (u - 0.5) * w * 1.6 + Math.sin(v * 5 + i) * 0.015;
    });
    b.deleteAttribute('aRest');
    parts.push(b);
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

// Coral heads: fan (flat lobed plate on a stem), brain dome, tube cluster
export function coralGeos() {
  const dome = blobGeo({ seed: 3, detail: 4, rx: 0.5, ry: 0.42, rz: 0.5, amp: 0.2, freq: 2.2, fine: 0.04 });
  dome.deleteAttribute('aRest');
  const fan = gridGeo(10, 8, (u, v, q) => {
    const a = (u - 0.5) * 2.5, r = 0.12 + v * (0.78 + 0.16 * Math.sin(u * 19.0) + 0.09 * Math.sin(u * 41));
    q[0] = Math.sin(a) * r; q[1] = Math.cos(a) * r * 0.95; q[2] = 0.08 * Math.sin(u * 13 + v * 5);
  });
  fan.deleteAttribute('aRest');
  const tubes = [];
  const r = new Rng(77);
  for (let i = 0; i < 9; i++) {
    const a = r.range(0, 6.28), d = r.range(0, 0.34), h = r.range(0.4, 1), w = r.range(0.06, 0.12);
    const c = new THREE.CylinderGeometry(w * 1.25, w * 0.7, h, 7, 1, false);
    c.deleteAttribute('uv');
    c.translate(Math.cos(a) * d, h / 2, Math.sin(a) * d);
    tubes.push(c);
  }
  const tube = mergeGeometries(tubes);
  return [dome, fan, tube];
}

export function instLife(geo, mat, list) {
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const d = new THREE.Object3D(), c = new THREE.Color();
  list.forEach((s, i) => {
    d.position.set(...s.p); d.rotation.set(...(s.r ?? [0, 0, 0])); d.scale.set(...s.s); d.updateMatrix();
    m.setMatrixAt(i, d.matrix);
    m.setColorAt(i, c.set(s.c ?? 0xffffff));
  });
  m.instanceMatrix.needsUpdate = true;
  m.frustumCulled = false;
  m.userData.noReflect = true;
  m.userData.noShadow = true;
  return m;
}

// A compact whale for distance work (and until the rigged one arrives): lofted body, flippers, flukes.
export function whaleGeo() {
  const prof = (t) => {
    // t 0 nose .. 1 tail
    const a = Math.sin(Math.pow(Math.min(t, 1), 0.62) * Math.PI);
    return 0.03 + 0.2 * Math.pow(a, 0.8) * (1 - 0.32 * t);
  };
  const body = gridGeo(16, 34, (u, v, q) => {
    const a = u * Math.PI * 2, r = prof(v);
    const c = Math.cos(a), s = Math.sin(a);
    const belly = s < 0 ? 1.12 : 0.9;
    q[0] = c * r; q[1] = s * r * belly - 0.05 * Math.sin(v * Math.PI); q[2] = 0.5 - v;
  });
  const fin = (sgn) => {
    const b = blobGeo({ seed: 5 + sgn, detail: 3, rx: 0.2, ry: 0.012, rz: 0.055, amp: 0.1, freq: 1.5 });
    b.rotateY(sgn * 0.5); b.rotateZ(sgn * -0.5); b.translate(sgn * 0.24, -0.1, 0.15);
    return b;
  };
  const fluke = (sgn) => {
    const b = blobGeo({ seed: 9 + sgn, detail: 3, rx: 0.13, ry: 0.01, rz: 0.05, amp: 0.1, freq: 1.5 });
    b.rotateY(sgn * -0.45); b.translate(sgn * 0.11, -0.01, -0.49);
    return b;
  };
  const dorsal = blobGeo({ seed: 2, detail: 2, rx: 0.012, ry: 0.05, rz: 0.06, amp: 0.1, freq: 1.5 });
  dorsal.translate(0, 0.15, -0.14);
  const all = [body, fin(1), fin(-1), fluke(1), fluke(-1), dorsal];
  for (const g of all) { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); }
  const out = mergeGeometries(all.map((g) => (g.index ? g.toNonIndexed() : g)));
  out.computeVertexNormals();
  return out;
}

// Fish school geometry: a little dart with a tail
export function fishGeo() {
  const g = new THREE.BufferGeometry();
  const p = [0, 0, 1, 0.16, 0, 0, 0, 0.3, 0, 0, 0, 1, 0, -0.26, 0, 0.16, 0, 0, 0, 0, 1, -0.16, 0, 0, 0, 0.3, 0, 0, 0, 1, 0, -0.26, 0, -0.16, 0, 0,
    0, 0.3, 0, 0.16, 0, 0, 0, 0, -1, 0, -0.26, 0, 0.16, 0, 0, 0, 0, -1, 0, 0.3, 0, -0.16, 0, 0, 0, 0, -1, 0, -0.26, 0, -0.16, 0, 0, 0, 0, -1,
    0, 0, -0.9, 0, 0.3, -1.5, 0, -0.3, -1.5];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}
