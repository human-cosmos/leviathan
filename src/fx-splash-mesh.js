import * as THREE from 'three';
import { G, COMMON, MRT_OUT } from './glsl.js';

// Solid sea: a displaced grid painted in the same five hard tones as the ocean pass, for
// water that has to stand up (the water mountain). id 0: it takes the same brushwork as the sea.
export function seaMeshMaterial(engine) {
  const w = engine.mWater.uniforms;
  const u = { ...G, uDeep: w.uDeep, uShallow: w.uShallow, uFoam: w.uFoam, uFlow: { value: 0 }, uFoamAmt: { value: 0 }, uCut: { value: 0.5 }, uLaceAmt: { value: 0.5 }, uRadial: { value: 0 } };
  const vs = /* glsl */ `
    attribute vec2 aF;    // across, along the fall line (m)
    attribute float aH;
    varying vec3 vWorld;
    varying vec2 vF;
    varying float vH;
    varying float vDepth;
    void main(){
      vF = aF; vH = aH;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      vec4 mv = viewMatrix * wp;
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    uniform vec3 uDeep, uShallow, uFoam;
    uniform float uFlow, uFoamAmt, uCut, uLaceAmt, uRadial;
    varying vec3 vWorld;
    varying vec2 vF;
    varying float vH;
    varying float vDepth;
    void main(){
      // the edge of the mass dissolves into the flat sea in long stroke shapes
      vec2 Fq = vF;
      float nEdge = fbm2(vec2(Fq.x * 0.006, Fq.y * 0.03));
      if(vH < uCut + nEdge * 7.0 - 1.0) discard;
      if(uPass > 0.5 && uPass < 1.5){ oColor = vec4(1.0); oData = vec4(0.0); return; }
      if(uPass > 1.5 && vWorld.y < uWaterLevel) discard;
      vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
      if(N.y < 0.0) N = -N;
      vec3 V = normalize(cameraPosition - vWorld);
      // uRadial 0: long swells along the contour, like the sea itself; 1: ropes down the fall line
      vec2 F = mix(vec2(Fq.y * 3.1, Fq.x * 0.7), Fq, uRadial);
      float nA = fbm2(vec2(F.x * 0.012, F.y * 0.0035 - uFlow * 0.05));
      float nB = fbm2(vec2(F.x * 0.04, F.y * 0.008 - uFlow * 0.09) + 3.0);
      float nC = vnoise(vec2(F.x * 0.14, F.y * 0.02 - uFlow * 0.14) + 7.0);
      float lit = dot(N, normalize(uSunDir + vec3(0.0, 0.4, 0.0)));
      float slope = 1.0 - N.y;
      float tone = 0.58 + (lit - 0.5) * 0.5 + (nA - 0.5) * 1.05 + (nB - 0.5) * 0.45;
      vec3 c0 = mix(uDeep, uShallow, 0.12);
      vec3 c1 = uDeep;
      vec3 c2 = mix(uDeep, uShallow, 0.42);
      vec3 c3 = mix(uDeep, uShallow, 0.82);
      vec3 c4 = mix(uShallow, vec3(0.86, 1.0, 0.98), 0.45);
      vec3 col = c0;
      if(tone > 0.26) col = c1;
      if(tone > 0.42) col = c2;
      if(tone > 0.60) col = c3;
      if(tone > 0.82) col = c4;
      // running water: pale lace and white streaks, thicker as the mass steepens
      float rope = nA * 0.5 + nB * 0.35 + nC * 0.15;
      float lace = step(0.60 - uLaceAmt * 0.12, rope);
      col = mix(col, mix(c4, vec3(1.0), 0.45), lace * 0.7 * smoothstep(0.02, 0.16, slope));
      float white = step(0.70 - uFoamAmt * 0.22, nB * 0.6 + nC * 0.4);
      col = mix(col, uFoam, white * smoothstep(0.01, 0.12, slope) * clamp(uFoamAmt + 0.3, 0.0, 1.0));
      // a thin broken lace where it meets the flat sea
      float foot = step(vH - uCut - nEdge * 7.0 + 1.0, 2.2 + 7.0 * uFoamAmt) * step(0.46, nC);
      col = mix(col, uFoam, foot * 0.85);
      vec3 nv = normalize(mat3(viewMatrix) * N);
      void_main_end:;
      writeOut(col, 1.0, nv, vDepth, 0.0);
    }
  `.replace('void_main_end:;', '');
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs, side: THREE.DoubleSide, transparent: false });
}

export class SeaMesh {
  constructor(engine, nu, nv) {
    this.nu = nu; this.nv = nv;
    const n = (nu + 1) * (nv + 1);
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.f = new THREE.BufferAttribute(new Float32Array(n * 2), 2);
    this.h = new THREE.BufferAttribute(new Float32Array(n), 1);
    for (const a of [this.pos, this.f, this.h]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos); g.setAttribute('aF', this.f); g.setAttribute('aH', this.h);
    const idx = [];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, seaMeshMaterial(engine));
    this.mesh.frustumCulled = false;
    this.mesh.userData.noShadow = true;
    this.mesh.visible = false;
  }
  // polar grid around (cx, cz): rings packed toward the middle; hFn(r, th) gives metres
  polar(cx, cz, Rmax, hFn) {
    const { nu, nv } = this;
    const P = this.pos.array, F = this.f.array, H = this.h.array;
    let k = 0;
    for (let j = 0; j <= nv; j++) {
      const r = Rmax * Math.pow(j / nv, 1.55);
      for (let i = 0; i <= nu; i++) {
        const th = (i / nu) * Math.PI * 2;
        const h = hFn(r, th);
        P[k * 3] = cx + Math.cos(th) * r; P[k * 3 + 1] = h; P[k * 3 + 2] = cz + Math.sin(th) * r;
        F[k * 2] = th * 420; F[k * 2 + 1] = r;
        H[k] = h;
        k++;
      }
    }
    this.pos.needsUpdate = true; this.f.needsUpdate = true; this.h.needsUpdate = true;
    this.mesh.visible = true;
  }
}
