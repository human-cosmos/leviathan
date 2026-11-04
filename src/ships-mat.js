import * as THREE from 'three';
import { G, COMMON, MRT_OUT, VERT_STD } from './glsl.js';

// Shared switch: cut everything below the waterline in the main pass (the sea pass paints a thick
// band of contact foam along anything it finds under the surface when seen at a grazing angle).
export const CLIP = { value: 0 };

// Ship paint: one cel uber-material so a whole ship is a single draw call.
// Static parts carry per-vertex colour and ink id; containers are instanced with
// per-instance colour, ink id and logo, their corrugation, doors, lock rods and
// rust are drawn in the fragment shader so they hold from 2 m to 2 km.

const LIGHTING = /* glsl */ `
  vec3 shade(vec3 col, vec3 N, float gloss){
    float ndl = dot(N, uKeyDir);
    float sh = sunShadow(vWorld, N);
    float lit = smoothstep(-0.03, 0.05, ndl) * sh;
    vec3 litCol = col * mix(uSkyTint, uSunColor * 1.06, uSunStrength);
    float up = smoothstep(-0.7, 0.6, N.y);
    vec3 shadeCol = col * uShadeTint * mix(uBounce, vec3(1.0), up);
    vec3 outc = mix(mix(shadeCol, litCol, 0.12), litCol, lit);
    float deep = step(ndl, -0.55) * step(N.y, -0.35);
    outc = mix(outc, col * uDeepTint, deep * 0.85);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 H = normalize(uKeyDir + V);
    float spec = step(0.985, dot(N, H)) * lit * gloss;
    outc = mix(outc, mix(vec3(1.0), uSunColor, 0.3) * 1.04, spec * (0.45 + 0.4 * uSunStrength));
    return outc;
  }
`;

export function shipMaterial(o = {}) {
  const u = {
    ...G,
    uMap: { value: o.map ?? null }, uUseMap: { value: o.map ? 1 : 0 }, uMapGamma: { value: o.mapGamma ?? 2.2 },
    uGloss: { value: o.gloss ?? 1 }, uWeather: { value: o.weather ?? 1 },
    uRestScale: { value: o.restScale ?? 1 },
    uId: { value: o.id ?? 0 },
    uRowOff: { value: 0 },
    uClip: CLIP,
  };
  const vs = /* glsl */ `
    attribute vec3 aCol;
    attribute float aId;
    varying vec3 vCol;
    varying vec3 vLocal;
    varying float vIdV;
    ${VERT_STD}
    void main(){ vCol = aCol; vIdV = aId; vLocal = position; stdVertex(position, normal); }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    uniform sampler2D uMap;
    uniform float uUseMap, uMapGamma, uGloss, uWeather, uRestScale, uId, uRowOff, uClip;
    varying vec3 vWorld, vNormalW, vNormalV, vLocal, vCol;
    varying float vDepth, vIdV;
    varying vec2 vUv;
    ${LIGHTING}
    void main(){
      if((uPass > 1.5 || uClip > 0.5) && vWorld.y < uWaterLevel - 0.03) discard;
      vec3 N = normalize(vNormalW), NV = normalize(vNormalV);
      if(!gl_FrontFacing){ N = -N; NV = -NV; }
      if(uPass > 0.5 && uPass < 1.5){ oColor = vec4(1); oData = vec4(0); return; }
      vec3 col = vCol;
      if(uUseMap > 0.5){ vec2 st = vUv; vec4 m = texture(uMap, st); col = pow(m.rgb, vec3(uMapGamma)); }
      vec3 r = vLocal * uRestScale;
      float W = uWeather;
      if(W > 0.01){
        // runs of rust under fittings, hard edged like a painted cel
        float rs = fbm3(vec3(r.x * 1.3, r.y * 0.1, r.z * 1.3) + 7.0);
        float rust = step(0.70, rs) * step(0.46, fbm3(r * 0.35));
        col = mix(col, mix(col, vec3(0.42, 0.14, 0.07), 0.62), rust * W);
        float g = fbm3(r * 0.22 + 3.1);
        col = mix(col, col * vec3(0.84, 0.84, 0.93), step(0.6, g) * W);
        float sc = step(0.82, vnoise3(r * 4.0 + 2.0)) * step(0.55, fbm3(r * 0.7));
        col = mix(col, col * vec3(0.8, 0.8, 0.88), sc * W * 0.7);
      }
      vec3 outc = shade(col, N, uGloss);
      float id = uId > 0.5 ? uId : floor(vIdV + 0.5);
      writeOut(outc, 1.0, NV, vDepth, id);
    }
  `;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs,
    side: o.side ?? THREE.DoubleSide,
  });
}

// ------------------------------------------------------------------ containers
// Unit: a 40 ft box, x along the length (±6.1), y up (±1.3), z across (±1.22).
export const BOX = { L: 12.2, H: 2.6, W: 2.44 };

export function containerGeometry() {
  const g = new THREE.BoxGeometry(BOX.L, BOX.H, BOX.W);
  return g;
}

export function containerMaterial(logoTex, o = {}) {
  const u = {
    ...G,
    uLogo: { value: logoTex },
    uInkFar: { value: o.inkFar ?? 620 },
  };
  const vs = /* glsl */ `
    attribute vec4 aI0;     // rgb, ink id
    attribute vec4 aI1;     // logo row (<0 none), seed, length factor, far ink id
    varying vec4 vI0, vI1;
    varying vec3 vLocal, vLocalN, vAxisX, vAxisY, vAxisZ;
    ${VERT_STD}
    void main(){
      vI0 = aI0; vI1 = aI1;
      vLocal = position * vec3(aI1.z, 1.0, 1.0);
      vLocalN = normal;
      mat3 im = mat3(instanceMatrix);
      vAxisX = normalize(mat3(modelMatrix) * im[0]);
      vAxisY = normalize(mat3(modelMatrix) * im[1]);
      vAxisZ = normalize(mat3(modelMatrix) * im[2]);
      vec4 lp = instanceMatrix * vec4(position, 1.0);
      stdVertex(lp.xyz, normalize(im * normal));
    }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    uniform sampler2D uLogo;
    uniform float uInkFar;
    varying vec3 vWorld, vNormalW, vNormalV, vLocal, vLocalN, vAxisX, vAxisY, vAxisZ;
    varying vec4 vI0, vI1;
    varying float vDepth;
    varying vec2 vUv;
    ${LIGHTING}
    // trapezoid corrugation: 1 on the ridge, slope sign on the flanks
    vec2 trap(float x, float period){
      float w = fract(x / period);
      float ridge = smoothstep(0.16, 0.26, w) - smoothstep(0.66, 0.76, w);
      float s = (w > 0.13 && w < 0.29) ? -1.0 : ((w > 0.63 && w < 0.79) ? 1.0 : 0.0);
      return vec2(ridge, s);
    }
    float logoAt(vec2 uv, float row){
      if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
      return texture(uLogo, vec2(uv.x, (row + uv.y) / 8.0)).a;
    }
    void main(){
      if(uPass > 1.5 && vWorld.y < uWaterLevel - 0.03) discard;
      vec3 N = normalize(vNormalW), NV = normalize(vNormalV);
      if(!gl_FrontFacing){ N = -N; NV = -NV; }
      if(uPass > 0.5 && uPass < 1.5){ oColor = vec4(1); oData = vec4(0); return; }
      vec3 col = vI0.rgb;
      vec3 p = vLocal, ln = vLocalN;
      float seed = vI1.y, hx = 6.1 * vI1.z;
      float fwx = max(fwidth(p.x), max(fwidth(p.y), fwidth(p.z)));
      float lod = 1.0 - smoothstep(0.05, 0.16, fwx);     // corrugation fades to tone when sub-pixel
      float lodFar = 1.0 - smoothstep(0.18, 0.6, fwx);
      col *= 0.9 + 0.2 * fract(seed * 7.13);              // sun fade, box to box
      vec3 steel = col * 0.66;
      float mark = 0.0;
      vec3 markCol = vec3(1.0);
      if(abs(ln.z) > 0.5){                                  // long side
        vec2 t = trap(p.x, 0.305);
        float post = step(hx - 0.2, abs(p.x));
        float rail = step(1.3 - 0.17, abs(p.y));
        float flat_ = max(post, rail);
        col *= mix(mix(0.87, 1.0, 1.0 - lod), mix(0.8, 1.06, t.x), lod * (1.0 - flat_));
        col = mix(col, col * 0.92, flat_);
        N = normalize(N + vAxisX * t.y * 0.95 * lod * (1.0 - flat_));
        float sgn = ln.z > 0.0 ? 1.0 : -1.0;
        // big company mark, reads the right way round from either side
        if(vI1.x >= 0.0 && vI1.z > 0.6){
          vec2 uv = vec2((p.x * sgn + 4.8) / 9.6, (p.y + 0.95) / 1.9);
          mark = logoAt(uv, floor(vI1.x + 0.5));
          markCol = fract(seed * 3.7) > 0.72 ? vec3(0.06, 0.06, 0.1) : vec3(0.97);
        }
      } else if(abs(ln.x) > 0.5){                           // ends
        float doorEnd = step(0.0, ln.x * (fract(seed * 13.1) - 0.5));
        float post = step(1.22 - 0.16, abs(p.z));
        float rail = step(1.3 - 0.2, abs(p.y));
        if(doorEnd > 0.5){
          vec2 t = trap(p.y, 0.34);
          col *= mix(0.92, mix(0.84, 1.04, t.x), lod * (1.0 - max(post, rail)));
          N = normalize(N + vAxisY * t.y * 0.7 * lod * (1.0 - max(post, rail)));
          // the seam between the two door leaves
          col *= 1.0 - 0.75 * lod * step(abs(p.z), 0.022);
          // four lock rods with cam handles
          float rods = 0.0;
          for(int i = 0; i < 4; i++){
            float rz = (float(i) - 1.5) * 0.46;
            rods = max(rods, step(abs(p.z - rz), 0.026) * step(abs(p.y), 1.2));
            rods = max(rods, step(abs(p.z - rz - 0.1), 0.1) * step(abs(p.y + 0.1 + float(i) * 0.06), 0.022));
            rods = max(rods, step(abs(p.z - rz), 0.05) * step(abs(abs(p.y) - 1.07), 0.035));
          }
          col = mix(col, vec3(0.74, 0.76, 0.8), rods * lodFar);
          vec2 uv = vec2((-p.z * sign(ln.x) + 1.05) / 2.1, (p.y - 0.35) / 0.75);
          mark = lodFar * logoAt(uv, 7.0);
          markCol = fract(seed * 3.7) > 0.5 ? vec3(0.97) : vec3(0.05, 0.05, 0.08);
          // white label
          vec2 lb = abs(vec2(p.z * sign(ln.x) + 0.62, p.y + 0.1)) - vec2(0.17, 0.1);
          float label = step(max(lb.x, lb.y), 0.0) * lodFar;
          col = mix(col, vec3(0.92), label);
        } else {
          vec2 t = trap(p.z, 0.305);
          col *= mix(0.92, mix(0.84, 1.05, t.x), lod * (1.0 - max(post, rail)));
          N = normalize(N + vAxisZ * t.y * 0.8 * lod * (1.0 - max(post, rail)));
        }
        col = mix(col, col * 0.9, max(post, rail));
      } else {                                              // roof
        vec2 t = trap(p.x + 0.13, 0.6);
        col *= 1.08;
        col = mix(col, col * mix(0.9, 1.05, t.x), lod);
        N = normalize(N + vAxisX * t.y * 0.22 * lod);
        float e = step(1.22 - 0.09, abs(p.z));
        float e2 = step(hx - 0.09, abs(p.x));
        // hazard dashes along the top rail like the reference
        float dash = step(0.5, fract(p.x * 1.5 + seed)) * step(0.8, fract(seed * 5.1));
        col = mix(col, mix(col * 0.82, mix(vec3(0.85, 0.65, 0.05), vec3(0.03), dash), step(0.8, fract(seed * 5.1))), max(e, e2) * lodFar);
      }
      col = mix(col, markCol, mark);
      // ---- wear: rust from the rails down, sun bleach, salt
      vec3 r = p + vec3(seed * 91.0, seed * 37.0, seed * 53.0);
      float streak = fbm3(vec3(r.x * 2.2, r.y * 0.22, r.z * 2.2));
      float fromTop = smoothstep(-0.8, 1.3, p.y);
      float rust = step(0.74 - 0.14 * fromTop, streak) * step(0.3, fract(seed * 2.71));
      col = mix(col, mix(col, vec3(0.34, 0.12, 0.06), 0.62), rust * lodFar);
      float pat = step(0.64, fbm3(r * 0.9));
      col = mix(col, col * vec3(0.88, 0.87, 0.94), pat * lodFar * 0.8);
      float scuff = step(0.8, vnoise3(r * 7.0)) * step(0.52, fbm3(r * 1.3));
      col = mix(col, col * 1.18 + 0.02, scuff * lod * 0.6);

      vec3 outc = shade(col, N, 0.5);
      float id = vDepth > uInkFar ? vI1.w : vI0.a;
      writeOut(outc, 1.0, NV, vDepth, id);
    }
  `;
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs, side: THREE.FrontSide });
}

// Painted foam on the sea around a ship: a cut-out of the mask, on threes.
export function wakeMaterial(maskTex, o = {}) {
  const u = {
    ...G,
    uMask: { value: maskTex },
    uOpacity: { value: o.opacity ?? 1 },
    uPhase: { value: o.phase ?? 0 },
    uDrawT: { value: 0 },
  };
  const vs = /* glsl */ `
    ${VERT_STD}
    void main(){ stdVertex(position, normal); }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    uniform sampler2D uMask;
    uniform float uOpacity, uPhase, uDrawT;
    varying vec3 vWorld, vNormalW, vNormalV;
    varying float vDepth;
    varying vec2 vUv;
    void main(){
      if(uPass > 0.5) discard;
      float m = texture(uMask, vUv).r * uOpacity;
      if(m < 0.01) discard;
      vec2 q = vWorld.xz + vec2(uPhase * 13.0);
      float t = uDrawT;
      float n = fbm2(q * vec2(0.09, 0.05) + vec2(t * 0.1, -t * 0.22));
      float n2 = vnoise(q * 0.6 + t * 0.7);
      float a = n * 0.75 + n2 * 0.25;
      float cut = 1.0 - m;
      if(a < cut * 0.9 + 0.08) discard;
      float core = smoothstep(cut * 0.9 + 0.08, cut * 0.9 + 0.18, a);
      vec3 foam = mix(vec3(0.68, 0.84, 0.96), vec3(1.0), core);
      writeOut(foam, 1.0, vec3(0.0, 0.0, 1.0), vDepth, 100.0);
    }
  `;
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs, side: THREE.DoubleSide });
}
