import * as THREE from 'three';
import { G, COMMON, MRT_OUT } from './glsl.js';

// The water itself: painted backdrop dome, the surface seen from below, depth fog and
// fans of light. Colours here are display-referred (no sRGB decode): raw() below.
export const raw = (hex) => new THREE.Color().setHex(parseInt(hex.replace('#', ''), 16), THREE.LinearSRGBColorSpace);

export const WU = {
  uW0: { value: raw('#c8fbff') },   // straight up
  uW1: { value: raw('#35d2ec') },   // just above the horizon
  uW2: { value: raw('#128fe2') },   // horizon and just below
  uW3: { value: raw('#1450c6') },   // straight down
  uSunW: { value: new THREE.Vector3(0.1, 0.95, -0.2).normalize() },
  uWT: { value: 0 },                // water time, drawn on threes
  uCam: { value: new THREE.Vector3() },
  uSurfY: { value: 0 },
  uSurfS: { value: 70 },            // ripple cell size in metres
  uGlow: { value: 1 },
  uChurn: { value: new THREE.Vector4(0, 0, 300, 0) },  // x, z, radius, amount: bubble disc under the surface
  uRange: { value: new THREE.Vector4(0.1, 0.16, 1, 0) }, // far ridges: base elev, amp, opacity, seed
  uFlash: { value: 0 },             // lightning pulse fills the water
  uRockGain: { value: 1 },          // keeps the stage below the lightning's relight
  uSurfH: { value: new THREE.Vector2(0.2, 0.5) }, // sine of elevation where the surface fades in
};

export const WATER_GLSL = /* glsl */ `
uniform vec3 uW0, uW1, uW2, uW3, uSunW, uCam;
uniform float uWT, uSurfY, uSurfS, uGlow, uFlash;
uniform vec4 uChurn, uRange;
uniform vec2 uSurfH;
vec3 waterGrad(vec3 d){
  float y = d.y;
  vec3 c = mix(uW2, uW1, smoothstep(-0.16, 0.26, y));
  c = mix(c, uW0, smoothstep(0.22, 0.86, y));
  c = mix(c, uW3, smoothstep(-0.08, -0.62, y));
  float s = max(dot(d, uSunW), 0.0);
  c += uW0 * (pow(s, 5.0) * 0.28 + pow(s, 22.0) * 0.32) * uGlow;
  return c + vec3(0.55, 0.8, 1.0) * uFlash * 0.35;
}
// the classic tileable water net
float causticNet(vec2 uv, float t){
  const float TAU = 6.2831853;
  vec2 p = mod(uv * TAU, TAU) - 250.0;
  vec2 i = p; float c = 1.0; const float inten = 0.005;
  for(int n = 0; n < 4; n++){
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 7.0);
}
`;

const SURF_GLSL = /* glsl */ `
float ridge1(float x, float sd){
  float s = 0.0, a = 0.5;
  for(int i = 0; i < 6; i++){
    float n = vnoise(vec2(x, sd + float(i) * 9.1));
    s += a * (1.0 - abs(2.0 * n - 1.0));
    x *= 2.13; a *= 0.5;
  }
  return s;
}
vec3 surfaceBelow(vec3 ro, vec3 d){
  float t = (uSurfY - ro.y) / max(d.y, 0.001);
  vec2 q = ro.xz + d.xz * t;
  float w = fbm2(q / (uSurfS * 1.7) + vec2(uWT * 0.03, -uWT * 0.02));
  vec2 qw = q + (vec2(fbm2(q / (uSurfS * 2.1) + 3.3), w) - 0.5) * uSurfS * 1.4;
  float a = causticNet(qw / (uSurfS * 2.2), uWT * 0.55 + 2.0);
  float b = causticNet(qw / (uSurfS * 5.5) + 0.37, uWT * 0.4 + 9.0);
  vec3 base = waterGrad(d);
  // the window of open sky straight above, deepening toward the critical angle
  float upness = d.y + (w - 0.5) * 0.14;
  float win = smoothstep(0.5, 0.9, upness);
  vec3 c = mix(mix(uW2, uW1, smoothstep(0.2, 0.6, upness)), mix(uW1, uW0, 0.8), win);
  float s = max(dot(d, uSunW), 0.0);
  float near = exp(-t * 0.00016);
  // long swell shadows, then a sparse net of hard bright flakes on top
  float swell = smoothstep(0.40, 0.56, fbm2(qw / (uSurfS * 3.4) + vec2(4.0, uWT * 0.05)));
  c = mix(c * vec3(0.66, 0.82, 0.96), c, 0.35 + 0.65 * swell);
  float lines = clamp(smoothstep(0.17, 0.36, a) * 0.9 + 0.8 * smoothstep(0.14, 0.3, b), 0.0, 1.0);
  c = mix(c, vec3(0.93, 1.0, 1.0) * 1.1, lines * mix(0.5, 1.0, win) * near * (0.45 + 0.55 * swell));
  // glare right under the sun
  c += vec3(0.8, 1.0, 1.0) * (pow(s, 60.0) * 1.2 + pow(s, 14.0) * 0.36) * uGlow;
  // churned bubble disc (s17): boiling cells of foam with a torn rim
  if(uChurn.w > 0.001){
    float r = length(q - uChurn.xy) / uChurn.z;
    float n = fbm2(q / 30.0 + vec2(uWT * 0.1, 0.0));
    float n2 = fbm2(q / 9.0 + vec2(0.0, uWT * 0.2));
    float e = smoothstep(1.03, 0.86, r + (n - 0.5) * 0.46);
    float rim = smoothstep(0.5, 0.92, r + (n - 0.5) * 0.3);
    float cell = causticNet(q / 120.0, uWT * 0.9);
    float foam = smoothstep(0.46, 0.74, n * 0.7 + n2 * 0.5 + cell * 0.3);
    vec3 fc = mix(uW1 * 1.12 + 0.14, vec3(0.9, 0.99, 1.0), foam);
    fc = mix(fc, vec3(0.96, 1.0, 1.0), rim * 0.7);
    c = mix(c, fc, e * uChurn.w);
  }
  return mix(base, c, exp(-t * 0.00012) * smoothstep(uSurfH.x, uSurfH.y, d.y + (w - 0.5) * 0.1));
}
vec3 backdrop(vec3 ro, vec3 d){
  vec3 c = waterGrad(d);
  float az = atan(d.x, -d.z);
  float el = asin(clamp(d.y, -1.0, 1.0));
  // billowing painted veils of silt low in the water
  vec2 sq = vec2(az * 3.0, el * 7.0);
  float veil = fbm2(sq + vec2(uWT * 0.02, 0.0));
  c = mix(c, c * vec3(0.9, 1.04, 1.1) + uW1 * 0.08, smoothstep(0.46, 0.5, veil) * smoothstep(0.5, -0.1, abs(el)) * 0.75);
  // far cliff ranges: three flat gouache layers that melt into the water
  if(uRange.z > 0.0){
    for(int i = 0; i < 3; i++){
      float k = float(i);
      float h = uRange.x * (1.25 - 0.42 * k) + uRange.y * (1.1 - 0.25 * k) * (ridge1(az * (2.2 + k * 1.1) + uRange.w + k * 7.3, 2.0 + k) - 0.55) * 1.7;
      float m = smoothstep(h + 0.004, h - 0.004, el);
      vec3 rc = mix(uW2, uW3, 0.1 + 0.26 * k) * vec3(0.9, 0.98, 1.0) + uW1 * (0.2 - 0.07 * k);
      c = mix(c, rc, m * uRange.z);
    }
  }
  if(d.y > 0.0) c = surfaceBelow(ro, d) * smoothstep(0.0, 0.03, d.y) + c * (1.0 - smoothstep(0.0, 0.03, d.y));
  return c;
}
`;

export function makeDome() {
  const u = { ...G, ...WU };
  const m = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: u, side: THREE.BackSide, depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${MRT_OUT}
      ${WATER_GLSL}
      ${SURF_GLSL}
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        if(uPass > 0.5){ oColor = vec4(1); oData = vec4(0); return; }
        vec3 c = backdrop(cameraPosition, d);
        writeOut(c, 1.0, vec3(0.0, 0.0, 1.0), 20000.0, 0.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(7000, 3), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  mesh.userData.noReflect = true;
  mesh.userData.noShadow = true;
  return mesh;
}

// Full-screen overlay after the atmosphere pass: depth fog into the same gradient as the
// dome (so far rock melts exactly into the water), and fans of light from the surface.
export function makeWaterVeil() {
  const u = {
    ...WU,
    uSceneData: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
    uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
    uFogD: { value: 0.0006 }, uFogNear: { value: 0 },
    uRayUV: { value: new THREE.Vector2(0.5, 1.2) }, uRays: { value: 0.7 }, uRayFall: { value: 1.1 }, uRayL: { value: 900 }, uRayN: { value: 1 },
    uRayCol: { value: raw('#d8fbff') },
  };
  const m = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: u, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    vertexShader: /* glsl */ `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uSceneData;
      uniform vec2 uRes, uRayUV;
      uniform mat4 uInvProj, uCamWorld;
      uniform float uFogD, uFogNear, uRays, uRayFall, uRayL, uRayN;
      uniform vec3 uRayCol;
      out vec4 oColor;
      float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
        return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
      ${WATER_GLSL}
      void main(){
        vec2 uv = gl_FragCoord.xy / uRes;
        float D = texture(uSceneData, uv).b;
        vec4 vp = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
        vec3 vdir = normalize(vp.xyz / vp.w);
        vec3 wdir = normalize(mat3(uCamWorld) * vdir);
        float cosv = -vdir.z;
        bool sky = D > 8000.0;
        float dist = sky ? 7000.0 : D / max(cosv, 0.05);
        float fog = sky ? 0.0 : 1.0 - exp(-max(dist - uFogNear, 0.0) * uFogD);
        vec3 fc = waterGrad(wdir);
        // fans of light: three scales of angular noise spreading from the surface glare
        vec2 p = uv - uRayUV; p.x *= uRes.x / uRes.y;
        float L = length(p), ang = atan(p.x, -p.y) * uRayN;
        float dr = uWT * 0.035;
        float a1 = vnoise(vec2(ang * 7.0 + dr, 1.0));
        float a2 = vnoise(vec2(ang * 19.0 - dr * 1.7, 4.0));
        float a3 = vnoise(vec2(ang * 47.0 + dr * 2.3, 9.0));
        float n = a1 * 0.55 + a2 * 0.3 + a3 * 0.15;
        float beam = smoothstep(0.46, 0.66, n) * 0.6 + smoothstep(0.6, 0.72, n) * 0.4;
        float fall = exp(-L * uRayFall) * smoothstep(0.0, 0.08, L + 0.1);
        float dk = sky ? 1.0 : 1.0 - exp(-dist / uRayL);
        vec3 add = uRayCol * beam * fall * dk * uRays;
        oColor = vec4(fc * fog + add * (1.0 - fog * 0.4), fog);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}
