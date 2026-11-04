import * as THREE from 'three';
import { G } from './glsl.js';

// Overlay materials of the energy department. The overlay is drawn after water and
// atmosphere, into a float target, with no depth buffer: depth comes from the scene data
// texture (rg view normal, b view depth, a material id). Every material here that has
// uSceneData / uRes gets them from the engine.
//
//   boltMaterial    screen-extruded lines: white core, hard saturated band, optional deep
//                   rim so a bolt still reads against the bright sky, soft halo for bloom
//   glowMaterial    drawn flash shapes: soft glow, kira star, ring, jagged burst, streak
//   relightMaterial full-screen cel light: multiplies the frame, so ink lines stay ink
//   seamMaterial    energy running in the seams between plates (read from the data texture)
//   planeRingMaterial   shock ring lying on the sea, computed per pixel
//   screenFxMaterial    focus lines and full-frame flash

const premult = (m) => {
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  m.premultipliedAlpha = true;
  return m;
};

const FS_VS = /* glsl */ `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const HASH = /* glsl */ `
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
`;

// ------------------------------------------------------------------- lines
export function boltMaterial(S) {
  const u = { uSceneData: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uS: { value: S }, uRimC: { value: new THREE.Color(0.05, 0.16, 0.62) } };
  const vs = /* glsl */ `
    attribute vec3 aPrev, aNext;
    attribute vec4 aA, aC, aH, aK;
    uniform vec2 uRes;
    uniform float uS;
    varying vec2 vA;
    varying float vDepth, vW, vPad;
    varying vec4 vC;
    varying vec4 vH;
    varying vec3 vK;
    const float NEARZ = -0.6;
    vec4 toNear(vec4 a, vec4 b){ return mix(a, b, clamp((NEARZ - a.z) / (b.z - a.z), 0.0, 1.0)); }
    void main(){
      vec4 v = viewMatrix * vec4(position, 1.0);
      vec4 vp = viewMatrix * vec4(aPrev, 1.0);
      vec4 vn = viewMatrix * vec4(aNext, 1.0);
      if(v.z > NEARZ){
        if(vn.z < NEARZ) v = toNear(v, vn);
        else if(vp.z < NEARZ) v = toNear(v, vp);
        else { gl_Position = vec4(3.0, 3.0, 3.0, 1.0); return; }
      }
      if(vp.z > NEARZ) vp = toNear(vp, v);
      if(vn.z > NEARZ) vn = toNear(vn, v);
      vec4 c = projectionMatrix * v, cp = projectionMatrix * vp, cn = projectionMatrix * vn;
      vec2 s = c.xy / c.w * 0.5 * uRes, sp = cp.xy / cp.w * 0.5 * uRes, sn = cn.xy / cn.w * 0.5 * uRes;
      vec2 d = sn - sp;
      float l = length(d);
      d = l > 1e-3 ? d / l : vec2(1.0, 0.0);
      vec2 nr = vec2(-d.y, d.x);
      float ppm = projectionMatrix[1][1] * 0.5 * uRes.y / max(-v.z, 0.1);
      float w = aA.z * uS + aA.w * ppm;
      float pad = w * 3.0 + 2.0 * uS + aH.w * uS;
      vec2 P = s + nr * aA.x * pad;
      vA = vec2(aA.x * pad, aA.y);
      vW = w; vPad = pad;
      vC = aC; vH = aH; vK = aK.xyz;
      vDepth = -v.z;
      gl_Position = vec4(P / (0.5 * uRes) * c.w, c.z, c.w);
    }
  `;
  const fs = /* glsl */ `
    uniform sampler2D uSceneData;
    uniform vec2 uRes;
    uniform float uS;
    uniform vec3 uRimC;
    varying vec2 vA;
    varying float vDepth, vW, vPad;
    varying vec4 vC;
    varying vec4 vH;
    varying vec3 vK;
    out vec4 oColor;
    void main(){
      float sd = texture(uSceneData, gl_FragCoord.xy / uRes).b;
      float m = vK.x;
      if(m < 0.5){ if(vDepth > sd + vK.y) discard; }
      else if(m < 1.5){ if(sd > vK.y) discard; }
      float d = abs(vA.x), w = vW;
      float core = clamp(w - d + 0.5, 0.0, 1.0);
      float band = clamp(w * 1.7 + 0.8 * uS - d + 0.5, 0.0, 1.0);
      float rim = clamp(w * 2.0 + 1.8 * uS - d + 0.5, 0.0, 1.0);
      float soft = clamp(1.0 - max(d - w, 0.0) / max(vPad - w, 0.5), 0.0, 1.0);
      soft = soft * soft * soft;
      float pw = vC.a;
      vec3 hot = vH.rgb * (1.0 + 0.22 * min(pw, 2.0));
      vec3 rgb = hot * core + vC.rgb * (0.9 + 0.2 * min(pw, 2.0)) * band * (1.0 - core) + vC.rgb * soft * 0.32 * pw;
      float a = max(rim * vK.z, band) * min(pw, 1.0);
      rgb *= min(pw, 1.0);
      rgb += uRimC * rim * (1.0 - band) * vK.z * min(pw, 1.0);
      if(a < 0.003 && dot(rgb, rgb) < 1e-5) discard;
      oColor = vec4(rgb, a);
    }
  `;
  return premult(new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
}

// ------------------------------------------------------------------- glows
export function glowMaterial(S) {
  const u = { uSceneData: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uS: { value: S } };
  const vs = /* glsl */ `
    attribute vec3 iPos;
    attribute vec4 iC, iK, iL;
    uniform vec2 uRes;
    uniform float uS;
    varying vec2 vL;
    varying vec4 vC, vK, vO;
    varying float vDepth, vR;
    void main(){
      vec4 mv = viewMatrix * vec4(iPos, 1.0);
      if(mv.z > -0.3){ gl_Position = vec4(3.0, 3.0, 3.0, 1.0); return; }
      vec4 c = projectionMatrix * mv;
      float ppm = projectionMatrix[1][1] * 0.5 * uRes.y / -mv.z;
      float s = iK.y * ppm + iK.z * uS;
      vec2 q = position.xy * 2.0;
      vec2 p = vec2(q.x * s * iL.x, q.y * s);
      float r = iK.w;
      p = mat2(cos(r), sin(r), -sin(r), cos(r)) * p;
      vL = q; vC = iC; vK = iK; vO = iL; vDepth = -mv.z; vR = s;
      gl_Position = vec4(c.xy + p / (0.5 * uRes) * c.w, c.z, c.w);
    }
  `;
  const fs = /* glsl */ `
    uniform sampler2D uSceneData;
    uniform vec2 uRes;
    uniform float uS;
    varying vec2 vL;
    varying vec4 vC, vK, vO;
    varying float vDepth, vR;
    out vec4 oColor;
    ${HASH}
    void main(){
      float sd = texture(uSceneData, gl_FragCoord.xy / uRes).b;
      float m = vO.y;
      if(m < 0.5){ if(vDepth > sd + vO.z) discard; }
      else if(m < 1.5){ if(sd > vO.z) discard; }
      float k = vK.x, r = length(vL), a = 0.0;
      float aa = 1.5 / max(vR, 1.0);
      vec3 col = vC.rgb, rgb = vec3(0.0);
      float P = vC.a;
      if(k < 0.5){
        float e = clamp(1.0 - r, 0.0, 1.0);
        float I = e * e * (0.25 + 0.75 * exp(-r * r * 9.0));
        rgb = col * P * I;
        a = clamp(I * P, 0.0, 1.0) * 0.7;
      } else if(k < 1.5){
        // kira: a round heart and four needle arms, with thinner diagonals
        float x = abs(vL.x), y = abs(vL.y);
        float armH = clamp(1.0 - x, 0.0, 1.0), armV = clamp(1.0 - y, 0.0, 1.0);
        float h = smoothstep(0.022 * armH + aa, 0.022 * armH - aa * 0.3, y) * armH;
        float v = smoothstep(0.022 * armV + aa, 0.022 * armV - aa * 0.3, x) * armV;
        vec2 D = mat2(0.7071, 0.7071, -0.7071, 0.7071) * vL;
        float x2 = abs(D.x), y2 = abs(D.y);
        float dg = clamp(1.0 - x2 * 2.2, 0.0, 1.0), dv = clamp(1.0 - y2 * 2.2, 0.0, 1.0);
        float diag = max(smoothstep(0.012 * dg + aa, 0.0, y2) * dg, smoothstep(0.012 * dv + aa, 0.0, x2) * dv) * 0.6;
        float heart = smoothstep(0.12 + aa, 0.09, r);
        float halo = exp(-r * r * 12.0) * 0.5;
        float I = max(max(h, v), max(diag, heart));
        rgb = (mix(col, vec3(1.0), smoothstep(0.1, 0.8, I)) * I * 1.6 + col * halo) * P;
      } else if(k < 2.5){
        // ring: crisp, broken into arcs near the end of its life
        float th = vO.w;
        float e0 = smoothstep(1.0 - th - aa, 1.0 - th + aa, r), e1 = smoothstep(1.0 + aa, 1.0 - aa, r);
        float on = e0 * e1;
        float inner = smoothstep(1.0 - th * 3.5, 1.0 - th, r) * e1 * 0.32;
        rgb = (col * inner + mix(col, vec3(1.0), 0.7) * on * 1.4) * P;
        a = max(on * 0.9, inner * 0.3) * min(P, 1.0);
      } else if(k < 3.5){
        // anime impact burst: a jagged white star, a hard cyan body, a soft halo
        float an = atan(vL.y, vL.x);
        float sd2 = vO.w * 91.7;
        float n1 = vn(vec2(an * 2.6 + sd2, sd2));
        float n2 = vn(vec2(an * 8.0 - sd2, sd2 * 1.7));
        float spikes = pow(abs(sin(an * 3.5 + sd2 * 1.3)), 6.0) * 0.5 + pow(abs(sin(an * 7.0 + sd2)), 12.0) * 0.26;
        float R1 = 0.34 + 0.34 * n1 + 0.12 * n2 + spikes;
        float R0 = R1 * 0.62;
        float body = smoothstep(R1 + aa, R1 - aa, r);
        float core = smoothstep(R0 + aa, R0 - aa, r);
        float halo = exp(-r * r * 4.0) * 0.7 * clamp(1.0 - r, 0.0, 1.0);
        rgb = (vec3(1.0) * core * 1.9 + col * 1.3 * body * (1.0 - core) + col * halo) * P;
        a = body * min(P, 1.0);
      } else if(k < 4.5){
        // tapered lens streak (anamorphic flare, shock sheet)
        float x = vL.x;
        float wd = (1.0 - x * x);
        float y = abs(vL.y) / max(wd, 0.001);
        float I = smoothstep(1.0, 0.25, y) * step(abs(x), 1.0);
        rgb = (mix(col, vec3(1.0), 0.75 * smoothstep(0.7, 0.1, y)) * I * 1.5) * P;
        a = 0.0;
      } else {
        float d = smoothstep(1.0 + aa, 1.0 - aa, r);
        float c = smoothstep(0.62 + aa, 0.62 - aa, r);
        rgb = (vec3(1.0) * c * 1.6 + col * 1.2 * d * (1.0 - c)) * P;
        a = d * min(P, 1.0);
      }
      if(dot(rgb, rgb) < 1e-6 && a < 0.003) discard;
      oColor = vec4(rgb, a);
    }
  `;
  return premult(new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
}

// ------------------------------------------------------------------- relight
export const MAXL = 8;
export function relightMaterial() {
  const u = {
    uSceneData: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
    uTan: { value: new THREE.Vector2(1, 1) }, uN: { value: 0 }, uMaxD: { value: 7000 },
    uLP: { value: Array.from({ length: MAXL }, () => new THREE.Vector4()) },
    uLC: { value: Array.from({ length: MAXL }, () => new THREE.Vector4()) },
    uDraw: { value: 0 }, uAmb: { value: 0 },
  };
  const fs = /* glsl */ `
    uniform sampler2D uSceneData;
    uniform vec2 uRes, uTan;
    uniform float uN, uMaxD, uDraw, uAmb;
    uniform vec4 uLP[${MAXL}], uLC[${MAXL}];
    out vec4 oColor;
    ${HASH}
    void main(){
      vec2 uv = gl_FragCoord.xy / uRes;
      vec4 d = texture(uSceneData, uv);
      float depth = d.b;
      if(depth <= 0.01 || depth > uMaxD) discard;
      vec2 xy = d.rg * 2.0 - 1.0;
      vec3 N = vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
      vec3 P = vec3((uv * 2.0 - 1.0) * uTan, -1.0) * depth;
      vec3 sum = vec3(uAmb);
      float wob = vn(gl_FragCoord.xy / 9.0) * 0.08;
      for(int i = 0; i < ${MAXL}; i++){
        if(float(i) >= uN) break;
        vec3 L = uLP[i].xyz - P;
        float dl = length(L);
        L /= max(dl, 1e-3);
        float R = uLP[i].w;
        float x = dl / R;
        float att = 1.0 / (1.0 + x * x * 3.5);
        att *= clamp(1.6 - x * 0.55, 0.0, 1.0);
        float ndl = dot(N, L) + wob;
        // cel: a lit band, a hot band facing the light, and a soft wrap so the glow reaches the edges
        float tone = 0.16 * smoothstep(-0.55, -0.1, ndl) + 0.42 * smoothstep(0.02, 0.09, ndl) + 0.55 * smoothstep(0.5, 0.56, ndl);
        // hard step on distance so the light falls off in drawn bands
        float band = smoothstep(0.1, 0.13, att + wob * 0.3) * 0.32 + smoothstep(0.3, 0.33, att + wob * 0.3) * 0.34 + smoothstep(0.62, 0.66, att + wob * 0.3) * 0.5;
        sum += uLC[i].rgb * uLC[i].a * tone * band;
      }
      if(dot(sum, sum) < 1e-5) discard;
      oColor = vec4(sum, 1.0);
    }
  `;
  const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: FS_VS, fragmentShader: fs, transparent: true, depthTest: false, depthWrite: false });
  // dst * (1 + src): real light on the painted albedo, ink lines stay dark
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.DstColorFactor;
  m.blendDst = THREE.OneFactor;
  return m;
}

// Energy racing through the seams between plates. A seam is any pixel where the
// material id or the normal jumps; the mask is a set of lit "fronts" around the lights.
export function seamMaterial(S) {
  const u = {
    uSceneData: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uS: { value: S },
    uTan: { value: new THREE.Vector2(1, 1) }, uN: { value: 0 }, uMaxD: { value: 7000 }, uK: { value: 0 },
    uLP: { value: Array.from({ length: MAXL }, () => new THREE.Vector4()) },
    uColor: { value: new THREE.Color(0.35, 0.8, 1.0) }, uDraw: { value: 0 },
  };
  const fs = /* glsl */ `
    uniform sampler2D uSceneData;
    uniform vec2 uRes, uTan;
    uniform float uS, uN, uMaxD, uK, uDraw;
    uniform vec4 uLP[${MAXL}];
    uniform vec3 uColor;
    out vec4 oColor;
    ${HASH}
    void main(){
      vec2 uv = gl_FragCoord.xy / uRes;
      vec4 d = texture(uSceneData, uv);
      float depth = d.b;
      if(depth <= 0.01 || depth > uMaxD || d.a < 0.5) discard;
      vec3 P = vec3((uv * 2.0 - 1.0) * uTan, -1.0) * depth;
      float mask = 0.0;
      for(int i = 0; i < ${MAXL}; i++){
        if(float(i) >= uN) break;
        float dl = length(uLP[i].xyz - P);
        mask = max(mask, 1.0 - dl / uLP[i].w);
      }
      if(mask <= 0.0) discard;
      vec2 px = 1.25 * uS / uRes;
      float e = 0.0;
      vec2 n0 = d.rg;
      for(int k = 0; k < 4; k++){
        float a = float(k) * 1.5708;
        vec4 q = texture(uSceneData, uv + vec2(cos(a), sin(a)) * px);
        float rel = abs(q.b - depth) / max(depth, 1.0);
        float ee = abs(q.a - d.a) > 0.5 ? 1.0 : smoothstep(0.004, 0.014, rel);
        ee = max(ee, smoothstep(0.1, 0.2, length(q.rg - n0)));
        e = max(e, ee);
      }
      if(e < 0.05) discard;
      // patchy, boiling on threes: the energy jumps along the seams instead of filling them
      float n = vn(gl_FragCoord.xy / (46.0 * uS) + uDraw * 3.17);
      float on = smoothstep(0.62 - uK * 0.55, 0.7 - uK * 0.55, n + clamp(mask, 0.0, 1.0) * 0.45);
      float I = e * on * uK;
      if(I < 0.01) discard;
      // opaque saturated line: on white armour a cyan line reads, a white one does not
      oColor = vec4(mix(vec3(0.05, 0.5, 1.0), vec3(0.75, 0.97, 1.0), on * on * n) * 1.15 * I, I);
    }
  `;
  const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: FS_VS, fragmentShader: fs, transparent: true, depthTest: false, depthWrite: false });
  return premult(m);
}

// ------------------------------------------------------------------- sea ring
// A shock ring on the water plane, computed per pixel from the camera ray, so it is
// correct at any lens and needs no geometry. Up to four rings.
export function planeRingMaterial(S) {
  const u = {
    uSceneData: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uS: { value: S },
    uTan: { value: new THREE.Vector2(1, 1) }, uCam: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    uWater: G.uWaterLevel, uN: { value: 0 },
    uR: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uColor: { value: new THREE.Color(0.8, 0.95, 1.0) }, uShade: { value: new THREE.Color(0.05, 0.2, 0.5) },
  };
  const fs = /* glsl */ `
    uniform sampler2D uSceneData;
    uniform vec2 uRes, uTan;
    uniform float uS, uWater, uN;
    uniform mat4 uCam;
    uniform vec3 uCamPos, uColor, uShade;
    uniform vec4 uR[4];      // x, z, radius, power
    out vec4 oColor;
    ${HASH}
    void main(){
      vec2 uv = gl_FragCoord.xy / uRes;
      vec3 rv = vec3((uv * 2.0 - 1.0) * uTan, -1.0);
      vec3 rd = mat3(uCam) * rv;
      if(rd.y > -0.0005) discard;
      float t = (uWater - uCamPos.y) / rd.y;
      if(t <= 0.0) discard;
      float sd = texture(uSceneData, uv).b;
      float depth = t;     // rv has z = -1, so t is the view depth at the plane
      if(depth > sd + 1.0) discard;
      vec3 P = uCamPos + rd * t;
      float mpp = max(length(fwidth(P.xz)), 1e-3);
      float A = 0.0, S2 = 0.0;
      for(int i = 0; i < 4; i++){
        if(float(i) >= uN) break;
        vec2 q = P.xz - uR[i].xy;
        float r = length(q), R = uR[i].z, pw = uR[i].w;
        float an = atan(q.y, q.x);
        float gap = smoothstep(0.2, 0.34, vn(vec2(an * 5.0 + R * 0.002, R * 0.004)));
        float lw = max(R * 0.012, mpp * 1.4);
        float ring = clamp((lw - abs(r - R)) / mpp + 0.5, 0.0, 1.0) * gap;
        float back = smoothstep(R * 0.72, R * 0.985, r) * step(r, R) * 0.55;
        // fine broken foam lines trail inside the ring
        float l2 = clamp((lw * 0.5 - abs(r - R * 0.93)) / mpp + 0.5, 0.0, 1.0) * smoothstep(0.42, 0.5, vn(vec2(an * 13.0, R * 0.01)));
        A = max(A, max(ring, l2 * 0.8) * pw);
        S2 = max(S2, back * pw);
      }
      float a = max(A, S2 * 0.5);
      if(a < 0.004) discard;
      vec3 rgb = uColor * 1.15 * A + uShade * S2 * 0.5 * (1.0 - A);
      oColor = vec4(rgb, a);
    }
  `;
  return premult(new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: FS_VS, fragmentShader: fs, transparent: true, depthTest: false, depthWrite: false }));
}

// ------------------------------------------------------------------- screen
// Anime focus lines converging on a point, and a full-frame flash.
export function screenFxMaterial(S) {
  const u = {
    uRes: { value: new THREE.Vector2(1, 1) }, uSceneData: { value: null }, uS: { value: S },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uLines: { value: 0 }, uSeed: { value: 0 },
    uFlash: { value: new THREE.Color(0, 0, 0) }, uLineC: { value: new THREE.Color(1, 1, 1) }, uInner: { value: 0.28 },
  };
  const fs = /* glsl */ `
    uniform vec2 uRes, uCenter;
    uniform float uS, uLines, uSeed, uInner;
    uniform vec3 uFlash, uLineC;
    out vec4 oColor;
    ${HASH}
    void main(){
      vec2 uv = gl_FragCoord.xy / uRes;
      vec2 p = (uv - uCenter) * vec2(uRes.x / uRes.y, 1.0);
      float r = length(p), an = atan(p.y, p.x);
      float a = 0.0;
      if(uLines > 0.001){
        float w = 150.0 + 40.0 * sin(uSeed);
        float id = floor(an * w / 6.2832);
        float f = fract(an * w / 6.2832);
        float h = h12(vec2(id, floor(uSeed)));
        float h2 = h12(vec2(id * 1.7, floor(uSeed) + 3.0));
        float on = step(0.62, h);
        float lw = 0.12 + 0.35 * h2;
        float start = uInner * (0.75 + 1.3 * h2);
        float line = smoothstep(lw, lw * 0.5, abs(f - 0.5)) * smoothstep(start, start + 0.3, r) * on;
        a = line * uLines;
      }
      // the flash is a veil, not an addition: the silhouettes survive inside it as ghosts
      float m = max(uFlash.r, max(uFlash.g, uFlash.b));
      float fa = clamp(m * 0.62, 0.0, 0.9);
      vec3 fl = m > 1e-4 ? uFlash / m * fa * 1.22 : vec3(0.0);
      vec3 rgb = uLineC * a * 1.2 * (1.0 - fa) + fl;
      float al = a * 0.8 * (1.0 - fa) + fa;
      if(dot(rgb, rgb) < 1e-5 && al < 0.003) discard;
      oColor = vec4(rgb, al);
    }
  `;
  return premult(new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: FS_VS, fragmentShader: fs, transparent: true, depthTest: false, depthWrite: false }));
}
