import * as THREE from 'three';
import { G, COMMON, MRT_OUT, VERT_STD } from './glsl.js';
import { ENV } from './passes-env.js';

// Painted-background materials: gouache facades, foliage clumps, wires, the sky.
const base = (extra) => ({ ...G, ...extra });

function mat(uniforms, vertexShader, fragmentShader, opts = {}) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader,
    fragmentShader,
    side: opts.side ?? THREE.DoubleSide,
    transparent: false,
    ...opts,
  });
}

// Shared painted lighting for background surfaces: soft terminator, cool
// lavender shade lifted by sky fill, a turquoise bounce off the bright water
// onto low walls, warm summer sun.
export const PAINT_LIGHT = /* glsl */ `
vec3 paintLight(vec3 col, vec3 N, vec3 wp, float sunVis, float ao){
  float ndl = dot(N, uSunDir);
  float sh = sunShadow(wp, N);
  float lit = smoothstep(-0.03, 0.15, ndl) * sh * sunVis;
  float up = smoothstep(-0.6, 0.9, N.y);
  vec3 amb = mix(uShadeTint, uSkyTint, up * 0.45 + 0.22) * 0.92;
  float low = exp(-max(wp.y - uWaterLevel, 0.0) / 7.0);
  amb += uBounce * low * (1.0 - up) * 0.2 * uSunStrength;
  amb *= ao;
  // high-key: sunlit planes land just under white instead of clipping
  vec3 sun = uSunColor * 0.46 * lit * uSunStrength;
  return col * (amb * (1.0 - 0.12 * lit) + sun);
}
`;

export const WEATHER_U = /* glsl */ `
uniform float uRain, uWet, uVeil, uRainbow, uEnvTime;
`;
const envU = () => ({ uRain: ENV.uRain, uWet: ENV.uWet, uVeil: ENV.uVeil, uRainbow: ENV.uRainbow, uEnvTime: ENV.uEnvTime });

// ---------------------------------------------------------- painted backgrounds
// Legacy single-colour painted surface (kept for other departments / props).
export function paintMaterial(o = {}) {
  const u = base({
    uColor: { value: new THREE.Color(o.color ?? '#c9c2b6') },
    uSeed: { value: o.seed ?? 0 },
    uMoss: { value: o.moss ?? 0.5 },
    uMap: { value: o.map ?? null },
    uUseMap: { value: o.map ? 1 : 0 },
    uEmit: { value: new THREE.Color(o.emit ?? '#000000') },
    uId: { value: o.id ?? 0 },
  });
  const vs = /* glsl */ `
    ${VERT_STD}
    void main(){ stdVertex(position, normal); }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    ${PAINT_LIGHT}
    uniform vec3 uColor, uEmit;
    uniform float uSeed, uMoss, uUseMap, uId;
    uniform sampler2D uMap;
    varying vec3 vWorld, vNormalW, vNormalV;
    varying float vDepth;
    varying vec2 vUv;
    void main(){
      if(uPass > 1.5 && vWorld.y < uWaterLevel - 0.03) discard;
      vec3 N = normalize(vNormalW);
      vec3 NV = normalize(vNormalV);
      if(!gl_FrontFacing){ N = -N; NV = -NV; }
      vec3 col = uColor;
      if(uUseMap > 0.5){ vec4 m = texture(uMap, vUv); if(m.a < 0.4) discard; col = mix(col, m.rgb, m.a); }
      if(uPass > 0.5 && uPass < 1.5){ oColor = vec4(1); oData = vec4(0); return; }
      vec3 w = vWorld;
      col *= 0.92 + 0.16 * fbm3(w * 0.25 + uSeed);
      float nearW = smoothstep(2.5, 0.0, w.y - uWaterLevel);
      float mossM = step(0.66 - 0.25 * uMoss * nearW, fbm3(w * vec3(0.6, 1.0, 0.6) + uSeed));
      col = mix(col, vec3(0.42, 0.52, 0.33), mossM * uMoss);
      vec3 outc = paintLight(col, N, w, 1.0, 1.0) + uEmit;
      writeOut(outc, 1.0, NV, vDepth, uId);
    }
  `;
  return mat(u, vs, fs);
}

// ------------------------------------------------------------ drowned street
// The old street floor seen through the clear water: asphalt, lane paint, zebra
// crossings, kerbs, tiled pavements with yellow tactile strips, gutters and
// drains, manholes, silt, pebbles and algae. Everything is computed from world
// xz in avenue coordinates (u along the avenue, v across). Painted marks that need
// glyphs (止まれ, arrows, numbers, manhole art) come from the prop atlas.
//   o: { map, ax:[x,z], bx:[x,z], marks:[{u,v,hu,hv,rect,dir,mode,wear}], streets:{...} }
export const MAX_MARKS = 28;
export function streetMaterial(o = {}) {
  const mk = [], mr = [], mo = [];
  for (let i = 0; i < MAX_MARKS; i++) {
    const m = (o.marks || [])[i];
    mk.push(m ? new THREE.Vector4(m.u, m.v, m.hu, m.hv) : new THREE.Vector4(0, 0, 0, 0));
    mr.push(m && m.rect ? new THREE.Vector4(...m.rect) : new THREE.Vector4(0, 0, 0, 0));
    mo.push(m ? new THREE.Vector4(m.dir ?? 0, m.mode ?? 0, m.wear ?? 0.3, m.seed ?? i) : new THREE.Vector4(0, 0, 0, 0));
  }
  const u = base({
    uMap: { value: o.map ?? null },
    uAx: { value: new THREE.Vector2(...(o.ax ?? [1, 0])) },
    uBx: { value: new THREE.Vector2(...(o.bx ?? [0, 1])) },
    uMk: { value: mk }, uMr: { value: mr }, uMo: { value: mo },
    uNMk: { value: Math.min(MAX_MARKS, (o.marks || []).length) },
    uId: { value: o.id ?? 0 },
    ...envU(),
  });
  const vs = /* glsl */ `
    ${VERT_STD}
    void main(){ stdVertex(position, normal); }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    ${PAINT_LIGHT}
    ${WEATHER_U}
    uniform sampler2D uMap;
    uniform vec2 uAx, uBx;
    uniform vec4 uMk[${MAX_MARKS}], uMr[${MAX_MARKS}], uMo[${MAX_MARKS}];
    uniform float uNMk, uId;
    varying vec3 vWorld, vNormalW, vNormalV;
    varying float vDepth;
    varying vec2 vUv;

    float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
    // carriageway: the avenue (|v| < 9.5) and three cross streets, kerb corners rounded
    float roadSD(vec2 p){
      float d = abs(p.y) - 9.5;
      d = smin(d, abs(p.x + 20.0) - 6.0, 3.0);
      d = smin(d, abs(p.x - 67.5) - 3.5, 2.5);
      d = smin(d, abs(p.x + 70.0) - 5.0, 3.0);
      return d;
    }
    float inBox(vec2 p, vec2 a, vec2 b){ return step(a.x, p.x) * step(p.x, b.x) * step(a.y, p.y) * step(p.y, b.y); }
    // anti-aliased stripe: 1 inside |x - c| < w/2
    float band(float x, float c, float w, float aa){ return 1.0 - smoothstep(w * 0.5 - aa, w * 0.5 + aa, abs(x - c)); }
    vec2 voro(vec2 p){
      vec2 i = floor(p), f = fract(p); float d1 = 8.0, id = 0.0;
      for(int y = -1; y <= 1; y++) for(int x = -1; x <= 1; x++){
        vec2 g = vec2(float(x), float(y)); vec2 o = hash22(i + g);
        vec2 r = g + o - f; float d = dot(r, r);
        if(d < d1){ d1 = d; id = hash12(i + g + 7.7); }
      }
      return vec2(sqrt(d1), id);
    }

    void main(){
      if(uPass > 1.5 && vWorld.y < uWaterLevel - 0.03) discard;
      if(uPass > 0.5 && uPass < 1.5){ oColor = vec4(1); oData = vec4(0); return; }
      vec3 w = vWorld;
      vec2 p = vec2(dot(w.xz, uAx), dot(w.xz, uBx));     // (u, v)
      float pxm = max(length(fwidth(p)), 1e-4);           // metres per pixel
      float aa = pxm * 0.75;
      float far = smoothstep(0.02, 0.09, pxm);            // fine detail fades with distance
      float n1 = fbm2(p * 0.35);
      float n2 = vnoise(p * 2.3);
      float n3 = vnoise(p * 9.0);

      float rd = roadSD(p);
      float road = 1.0 - smoothstep(-aa, aa, rd);
      float walk = smoothstep(-aa, aa, rd) * (1.0 - smoothstep(3.4 - aa, 3.4 + aa, rd));
      float lot = smoothstep(3.4 - aa, 3.4 + aa, rd);

      // ---- asphalt: blue-grey, worn lighter in the wheel tracks, repair patches
      vec3 asph = mix(vec3(0.33, 0.36, 0.42), vec3(0.4, 0.42, 0.46), n1);
      float track = band(fract((p.y + 9.5) / 3.17), 0.27, 0.16, 0.02) + band(fract((p.y + 9.5) / 3.17), 0.73, 0.16, 0.02);
      asph = mix(asph, asph * 1.09 + 0.02, track * 0.6 * (1.0 - far));
      vec2 pc = floor(p / vec2(7.0, 3.17));
      float patchK = step(0.8, hash12(pc + 3.0)) * inBox(fract(p / vec2(7.0, 3.17)), vec2(0.15, 0.12), vec2(0.15 + 0.5 * hash12(pc), 0.86));
      asph = mix(asph, vec3(0.27, 0.29, 0.34), patchK * 0.85);
      float crack = 1.0 - smoothstep(0.0, 0.02 + aa * 0.5, abs(fbm2(p * 0.9 + 4.0) - 0.5));
      asph = mix(asph, asph * 0.62, crack * step(0.55, vnoise(p * 0.4 + 9.0)) * (1.0 - far));
      asph *= 0.94 + 0.08 * n3;

      // ---- kerb, concrete gutter with drain grates
      float kerb = band(rd, 0.09, 0.2, aa);
      float gutter = smoothstep(-0.52 - aa, -0.5 + aa, rd) * (1.0 - smoothstep(-aa, aa, rd));
      vec3 gutC = vec3(0.6, 0.61, 0.6) * (0.94 + 0.1 * n2);
      // drain grate every 12 m along the avenue kerbs
      float along = abs(p.y) > 8.5 ? p.x : p.y;
      float grate = gutter * step(abs(fract(along / 12.0) - 0.5) * 12.0, 0.45);
      gutC = mix(gutC, vec3(0.2, 0.21, 0.25) * (0.8 + 0.3 * step(0.5, fract(along * 12.0))), grate);
      vec3 kerbC = vec3(0.78, 0.77, 0.73) * (0.94 + 0.1 * n2);

      // ---- pavement: 30 cm tiles in three tones, joints, yellow tactile strip
      vec2 tp = p / 0.3;
      vec2 tf = fract(tp), ti = floor(tp);
      float th = hash12(ti);
      vec3 tile = th < 0.45 ? vec3(0.72, 0.7, 0.66) : th < 0.8 ? vec3(0.78, 0.7, 0.62) : vec3(0.74, 0.6, 0.57);
      tile *= 0.94 + 0.1 * hash12(ti + 5.0);
      float joint = (1.0 - smoothstep(0.03, 0.03 + aa / 0.3, min(min(tf.x, 1.0 - tf.x), min(tf.y, 1.0 - tf.y))));
      tile = mix(tile, tile * 0.72, joint * (1.0 - far));
      float tact = band(rd, 1.35, 0.3, aa);
      vec2 dots = fract(p / 0.075) - 0.5;
      vec3 tactC = vec3(0.92, 0.76, 0.24) * (0.88 + 0.16 * step(dot(dots, dots), 0.08));
      tile = mix(tile, tactC, tact);

      // ---- lots: old foundations, gravel, weeds
      vec3 lotC = mix(vec3(0.48, 0.5, 0.44), vec3(0.56, 0.54, 0.47), n1);
      vec2 slab = fract(p / 4.0);
      lotC = mix(lotC, lotC * 0.82, (1.0 - smoothstep(0.02, 0.02 + aa / 4.0, min(min(slab.x, 1.0 - slab.x), min(slab.y, 1.0 - slab.y)))) * (1.0 - far));

      vec3 col = mix(lotC, tile, walk);
      col = mix(col, asph, road);
      col = mix(col, gutC, gutter);
      col = mix(col, kerbC, kerb);
      // kerb step: a dark line at the road edge, a lit lip on the pavement side
      col *= 1.0 - 0.35 * band(rd, -0.01, 0.06, aa);

      // ---- road paint (white unless noted), worn and patchy
      vec3 white = vec3(0.95, 0.95, 0.92), yellow = vec3(0.98, 0.78, 0.25);
      float paintW = 0.0, paintY = 0.0;
      float inAv = step(abs(p.y), 9.3);
      float xC0 = 1.0 - inBox(p, vec2(-26.0, -99.0), vec2(-14.0, 99.0));
      float xC1 = 1.0 - inBox(p, vec2(64.0, -99.0), vec2(71.0, 99.0));
      float xC2 = 1.0 - inBox(p, vec2(-75.0, -99.0), vec2(-65.0, 99.0));
      float xCW = 1.0 - inBox(p, vec2(-1.4, -99.0), vec2(1.6, 99.0));
      float lanes = inAv * xC0 * xC1 * xC2 * xCW;
      // centre line: double yellow
      paintY += (band(p.y, 0.14, 0.15, aa) + band(p.y, -0.14, 0.15, aa)) * lanes;
      // lane lines: dashed, solid on the approach to the crossing at the robot
      float approach = inBox(p, vec2(-14.0, 0.0), vec2(-2.6, 9.6)) + inBox(p, vec2(2.6, -9.6), vec2(30.0, 0.0));
      float dash = max(step(fract(p.x / 10.0), 0.5), step(0.5, approach));
      for(int k = -2; k <= 2; k++){
        if(k == 0) continue;
        float c = float(k) * 3.17 + (k > 0 ? 0.0 : 0.0);
        paintW += band(p.y, c, 0.15, aa) * dash * lanes;
      }
      // edge lines
      paintW += (band(p.y, 9.05, 0.15, aa) + band(p.y, -9.05, 0.15, aa)) * xC0 * xC1 * xC2 * xCW;
      // zebra crossings: the robot stands on one; three more around the bay junction
      float zeb = inBox(p, vec2(-1.4, -9.3), vec2(1.6, 9.3)) * band(fract((p.y + 9.3) / 0.9), 0.25, 0.5, aa / 0.9);
      zeb += inBox(p, vec2(-29.4, -9.3), vec2(-26.4, 9.3)) * band(fract((p.y + 9.3) / 0.9), 0.25, 0.5, aa / 0.9);
      zeb += inBox(p, vec2(-26.0, 9.9), vec2(-14.0, 12.9)) * band(fract((p.x + 26.0) / 0.9), 0.25, 0.5, aa / 0.9);
      zeb += inBox(p, vec2(-26.0, -12.9), vec2(-14.0, -9.9)) * band(fract((p.x + 26.0) / 0.9), 0.25, 0.5, aa / 0.9);
      paintW += zeb;
      // stop lines
      paintW += inBox(p, vec2(-2.6, 0.1), vec2(-2.15, 9.3)) + inBox(p, vec2(2.15, -9.3), vec2(2.6, -0.1));
      paintW += inBox(p, vec2(-31.0, 0.1), vec2(-30.55, 9.3)) + inBox(p, vec2(-12.9, -9.3), vec2(-12.45, -0.1));
      // crossing-ahead diamonds in the bay lanes
      for(int k = 0; k < 3; k++){
        vec2 dc = vec2(-46.0, 1.58 + 3.17 * float(k));
        vec2 dd = abs(p - dc) / vec2(2.6, 0.75);
        float dm = dd.x + dd.y;
        paintW += (1.0 - smoothstep(0.0, 0.08, abs(dm - 0.9))) * (1.0 - far * 0.5);
      }
      // atlas marks: glyphs, arrows, manholes
      vec4 mcol = vec4(0.0);
      for(int i = 0; i < ${MAX_MARKS}; i++){
        if(float(i) >= uNMk) break;
        vec4 M = uMk[i];
        vec2 d = p - M.xy;
        if(abs(d.x) > M.z || abs(d.y) > M.w) continue;
        vec4 O = uMo[i];
        float dir = O.x;
        vec2 st;   // s: along travel (0 near .. 1 far), t: driver's left .. right
        if(dir < 0.5)      st = vec2((d.x + M.z) / (2.0 * M.z), (M.w - d.y) / (2.0 * M.w));
        else if(dir < 1.5) st = vec2((M.z - d.x) / (2.0 * M.z), (d.y + M.w) / (2.0 * M.w));
        else if(dir < 2.5) st = vec2((d.y + M.w) / (2.0 * M.w), (d.x + M.z) / (2.0 * M.z));
        else               st = vec2((M.w - d.y) / (2.0 * M.w), (M.z - d.x) / (2.0 * M.z));
        vec4 R = uMr[i];
        vec2 auv = vec2(mix(R.x, R.z, st.y), mix(R.y, R.w, st.x));
        vec4 tx = texture(uMap, auv);
        float wear = O.z;
        if(O.y < 0.5) paintW += tx.a * step(wear * 0.8, vnoise(p * 3.0 + O.w) * 0.6 + 0.4 * n3);
        else if(O.y < 1.5) paintY += tx.a;
        else { mcol = vec4(tx.rgb, step(0.5, tx.a)); }
      }
      // worn paint: broken by grit and algae
      float keep = smoothstep(0.25, 0.45, vnoise(p * 4.0) * 0.7 + n3 * 0.3);
      col = mix(col, white * (0.92 + 0.08 * n2), clamp(paintW, 0.0, 1.0) * (0.74 + 0.24 * keep));
      col = mix(col, yellow * (0.92 + 0.08 * n2), clamp(paintY, 0.0, 1.0) * (0.74 + 0.24 * keep));
      col = mix(col, mcol.rgb, mcol.a);

      // ---- what the flood left: silt drifts along kerbs, pebbles, algae, fallen leaves
      float silt = smoothstep(0.55, 0.75, fbm2(p * 0.22 + 3.0) + smoothstep(1.5, 0.0, abs(rd)) * 0.25);
      col = mix(col, vec3(0.74, 0.7, 0.58) * (0.9 + 0.15 * n2), silt * 0.55);
      vec2 vo = voro(p * 5.0);
      float peb = (1.0 - smoothstep(0.2, 0.2 + aa * 5.0 + 0.03, vo.x)) * step(0.72, vo.y) * step(0.45, fbm2(p * 0.5 + 7.0)) * (1.0 - far);
      col = mix(col, mix(vec3(0.82, 0.8, 0.74), vec3(0.42, 0.42, 0.44), step(0.86, vo.y)), peb);
      col *= 1.0 - 0.18 * (1.0 - smoothstep(0.2, 0.32, vo.x)) * step(0.72, vo.y) * step(0.45, fbm2(p * 0.5 + 7.0)) * (1.0 - peb) * (1.0 - far);
      float alg = smoothstep(0.62, 0.7, fbm2(p * 0.6 + 11.0) + 0.12 * n3);
      vec3 algC = mix(vec3(0.36, 0.5, 0.3), vec3(0.5, 0.58, 0.32), n2);
      col = mix(col, algC, alg * 0.65);
      float tuft = step(0.8, hash12(floor(p * 3.0) + 2.0)) * step(0.55, fbm2(p * 0.7 + 1.0)) * (1.0 - far);
      vec2 tq = fract(p * 3.0) - 0.5;
      col = mix(col, vec3(0.25, 0.4, 0.27), tuft * step(dot(tq, tq), 0.06) * 0.8);

      vec3 N = vec3(0.0, 1.0, 0.0);
      vec3 outc = paintLight(col, N, w, 1.0, 1.0);
      writeOut(outc, 1.0, normalize(vNormalV), vDepth, uId);
    }
  `;
  return mat(u, vs, fs);
}

// ------------------------------------------------------------ city surfaces
// One material for every building, deck, prop and sign: all per-surface data
// rides on vertex attributes so the whole city merges into a few draw calls.
//   aCol  base colour        aCol2 accent (glass / tile / shutter colour)
//   aP    kind, seed, floor height, moss
//   aQ    window spacing, window style, facade top (m), ivy amount
//   aR    fake cast-shadow amount, shadow height, ao, wet band
// uv = metres (u along the face, v up from the building base); signs use atlas uv.
// kinds: 0 wall  1 windows  2 flat roof  3 balcony front  4 metal/concrete prop
//        5 tile roof  6 atlas sign  7 dark void  8 deck asphalt  9 shutter band
export function cityMaterial(o = {}) {
  const u = base({
    uMap: { value: o.map ?? null },
    uId: { value: o.id ?? 0 },
    uDetail: { value: o.detail ?? 1 },
    ...envU(),
  });
  const vs = /* glsl */ `
    attribute vec3 aCol;
    attribute vec3 aCol2;
    attribute vec4 aP;
    attribute vec4 aQ;
    attribute vec4 aR;
    attribute vec4 aE;
    varying vec3 vCol, vCol2;
    varying vec4 vP, vQ, vR, vE;
    ${VERT_STD}
    void main(){ vCol = aCol; vCol2 = aCol2; vP = aP; vQ = aQ; vR = aR; vE = aE; stdVertex(position, normal); }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    ${PAINT_LIGHT}
    ${WEATHER_U}
    uniform sampler2D uMap;
    uniform float uId, uDetail;
    varying vec3 vWorld, vNormalW, vNormalV;
    varying float vDepth;
    varying vec2 vUv;
    varying vec3 vCol, vCol2;
    varying vec4 vP, vQ, vR, vE;

    float stepNoise(float x, float seed){
      float i = floor(x); float f = fract(x);
      float a = hash12(vec2(i, seed)), b = hash12(vec2(i + 1.0, seed));
      return mix(a, b, smoothstep(0.82, 1.0, f));
    }
    // painted leaf billows: a union of sphere-shaded clumps on a jittered grid.
    // x = light on the front-most clump (-1..1), y = its height (coverage, <0 = gap)
    vec2 billows(vec2 p, float cs, float seed){
      vec2 ci = floor(p / cs);
      float best = -1.0; vec3 bn = vec3(0.0, 0.0, 1.0);
      for(int j = -1; j <= 1; j++) for(int i = -1; i <= 1; i++){
        vec2 c = ci + vec2(float(i), float(j));
        vec2 h = hash22(c + seed);
        vec2 ctr = (c + 0.2 + 0.6 * h) * cs;
        float r = cs * (0.6 + 0.35 * hash12(c + seed * 1.7));
        vec2 d = (p - ctr) / r;
        float q = dot(d, d);
        if(q >= 1.0) continue;
        float hz = sqrt(1.0 - q) * r / cs + hash12(c * 1.3 + seed) * 0.5 - (ctr.y / cs) * 0.08;
        if(hz > best){ best = hz; bn = vec3(d, sqrt(1.0 - q)); }
      }
      float lit = dot(bn, normalize(vec3(-0.35, 0.78, 0.52)));
      return vec2(lit, best);
    }
    vec3 leafTone(float lit){
      vec3 c = vec3(0.12, 0.27, 0.25);
      c = mix(c, vec3(0.2, 0.41, 0.31), smoothstep(0.1, 0.16, lit));
      c = mix(c, vec3(0.36, 0.58, 0.32), smoothstep(0.55, 0.61, lit));
      c = mix(c, vec3(0.6, 0.76, 0.36), smoothstep(0.84, 0.88, lit));
      return c;
    }

    void main(){
      if(uPass > 1.5 && vWorld.y < uWaterLevel - 0.03) discard;
      float kind = floor(vP.x + 0.5);
      float seed = vP.y;
      vec2 uv = vUv;
      vec4 sig = vec4(0.0);
      if(kind == 6.0 || kind == 10.0){ sig = texture(uMap, uv); if(sig.a < 0.5) discard; }
      if(uPass > 0.5 && uPass < 1.5){ oColor = vec4(1); oData = vec4(0); return; }
      vec3 N = normalize(vNormalW);
      vec3 NV = normalize(vNormalV);
      if(!gl_FrontFacing){ N = -N; NV = -NV; }
      vec3 w = vWorld;
      float wall = 1.0 - smoothstep(0.55, 0.8, abs(N.y));
      vec3 col = vCol;
      float ao = 1.0;
      float hw = w.y - uWaterLevel;
      float pxm = length(fwidth(w));              // metres per pixel here

      // ---- broad gouache variation: soft blotches + vertical dry-brush drag
      float v1 = fbm3(w * 0.11 + seed * 7.0);
      float v2 = vnoise(vec2(dot(w.xz, vec2(0.8, 0.6)) * 1.3 + seed, w.y * 0.18));
      col *= 0.93 + 0.14 * v1;
      col *= 0.975 + 0.05 * v2;

      float fh = max(vP.z, 0.1);
      float sp = max(vQ.x, 0.1);
      float style = vQ.y;
      float Htop = vQ.z;
      float detailFade = smoothstep(0.55, 0.12, pxm / min(fh, sp) * 3.0) * uDetail;
      float glassAmt = 0.0;

      if(kind == 1.0 || kind == 3.0 || kind == 0.0 || kind == 9.0){
        // soft grime streaks running down from every ledge / floor slab
        float fl = fract(uv.y / fh);
        float drip = vnoise(vec2(uv.x * 1.3 + seed * 3.0, floor(uv.y / fh) * 3.1));
        float streak = smoothstep(0.6, 0.9, drip) * smoothstep(0.0, 0.9, fl) * (1.0 - fl * 0.6);
        col = mix(col, col * vec3(0.86, 0.85, 0.9), streak * 0.45 * wall);
      }
      if(kind == 1.0){
        vec2 cell = vec2(uv.x / sp, uv.y / fh);
        vec2 f = fract(cell);
        vec2 cid = floor(cell);
        float r1 = hash12(cid + seed * 13.1), r2 = hash12(cid + seed * 7.7 + 3.1), r3 = hash12(cid * 1.7 + seed);
        float ww = 0.56, wh = 0.5, cy = 0.56;
        if(style > 0.5 && style < 1.5){ ww = 0.97; wh = 0.42; cy = 0.58; }
        else if(style > 1.5 && style < 2.5){ ww = 0.78; wh = 0.7; cy = 0.46; }
        else if(style > 2.5){ ww = 0.94; wh = 0.8; cy = 0.5; }
        float inX = step(abs(f.x - 0.5), ww * 0.5), inY = step(abs(f.y - cy), wh * 0.5);
        float win = inX * inY;
        // glass mirrors the summer sky: deep blue at the top of each pane, pale below
        float gy = (f.y - (cy - wh * 0.5)) / wh;
        float gx = (f.x - 0.5) / ww;
        // dim interior, with the sky caught as a soft angled band across the upper pane
        vec3 inside = mix(vec3(0.33, 0.38, 0.52), vCol2 * 0.7, 0.45) * (0.9 + 0.2 * r3);
        vec3 skyG = mix(vec3(0.74, 0.84, 0.94), vec3(0.5, 0.64, 0.86), gy);
        float band = smoothstep(0.42, 0.62, gy + gx * 0.35 + (r2 - 0.5) * 0.5);
        vec3 glass = mix(inside, skyG, band * (0.45 + 0.45 * r1));
        float floorTone = hash12(vec2(cid.y, seed * 3.7));
        // a white summer cloud caught in some panes
        float cloudR = smoothstep(0.55, 0.75, vnoise(vec2(gx * 2.2 + r2 * 9.0, gy * 3.0 + r3 * 5.0))) * step(0.6, r3) * smoothstep(0.35, 0.9, gy);
        glass = mix(glass, vec3(0.9, 0.93, 0.97), cloudR * 0.7);
        glass = mix(glass, vec3(0.16, 0.18, 0.26), step(0.86, r1));                    // open / broken
        vec3 curtain = mix(mix(vec3(0.95, 0.92, 0.82), vec3(0.9, 0.78, 0.8), r3), vec3(0.8, 0.9, 0.86), step(0.7, floorTone));
        float cur = step(0.72, r2) * (1.0 - step(0.86, r1));
        float half_ = step(0.5, fract(r3 * 7.0));
        glass = mix(glass, curtain * (0.9 + 0.1 * gy), cur * mix(1.0, step(abs(gx), 0.25 + 0.25 * r1), half_));
        float blinds = step(0.6, r2) * step(r2, 0.72) * step(0.5, fract(gy * 9.0));
        glass = mix(glass, vec3(0.86, 0.87, 0.86), blinds * 0.7);
        glass = mix(glass, vec3(0.34, 0.52, 0.32), step(0.93, r3));                   // plants inside
        // sudare bamboo blinds rolled half down
        float sud = step(0.8, hash12(cid + seed * 2.3 + 1.7)) * (1.0 - step(0.86, r1));
        float sudL = 0.35 + 0.5 * hash12(cid + 4.4);
        float inSud = step(1.0 - sudL, gy);
        vec3 sudC = vec3(0.86, 0.74, 0.5) * (0.92 + 0.12 * step(0.5, fract(gy * wh * fh * 14.0)));
        glass = mix(glass, sudC, sud * inSud);
        // potted plants on the sill
        float pot = step(0.78, hash12(cid * 1.9 + seed + 8.1));
        float potM = step(gy, 0.22 + 0.12 * vnoise(vec2(gx * 9.0, cid.x))) * step(abs(gx - (hash12(cid + 2.0) - 0.5) * 0.5), 0.22);
        glass = mix(glass, mix(vec3(0.3, 0.5, 0.3), vec3(0.52, 0.68, 0.36), vnoise(vec2(gx * 14.0, gy * 9.0))), pot * potM);
        if(style > 0.5 && style < 1.5){ float mul = step(abs(fract(f.x * 3.0) - 0.5), 0.47); glass = mix(col * 0.85, glass, mul); }
        float frameL = step(abs(f.x - 0.5), ww * 0.5 + 0.035) * step(abs(f.y - cy), wh * 0.5 + 0.05) * (1.0 - win);
        float sill = step(abs(f.x - 0.5), ww * 0.5 + 0.06) * step(abs(f.y - (cy - wh * 0.5 - 0.06)), 0.03);
        float below = step(abs(f.x - 0.5), ww * 0.4) * step(f.y, cy - wh * 0.5 - 0.06) * vnoise(vec2(cid.x * 7.3 + f.x * 9.0, cid.y));
        vec3 dcol = col * (0.97 + 0.06 * floorTone);
        // wall cladding: small mosaic tiles, or bare concrete panels with tie holes
        float clad = hash12(vec2(seed, 3.3));
        if(clad < 0.35){
          vec2 tg = fract(uv / vec2(0.15, 0.1));
          float tj = 1.0 - step(0.12, min(tg.x, tg.y));
          dcol *= 1.0 - 0.07 * tj * smoothstep(0.03, 0.01, pxm);
          dcol *= 0.97 + 0.06 * hash12(floor(uv / vec2(0.15, 0.1)));
        } else if(clad < 0.6){
          vec2 pg = uv / vec2(1.8, 0.9);
          vec2 pf = fract(pg);
          float seam = 1.0 - smoothstep(0.0, 0.012 + pxm * 0.5, min(min(pf.x, 1.0 - pf.x) * 1.8, min(pf.y, 1.0 - pf.y) * 0.9));
          dcol = mix(dcol, dcol * 0.86, seam * 0.6);
          vec2 hp = (fract(pg * vec2(3.0, 2.0)) - 0.5) * vec2(0.6, 0.45);
          dcol *= 1.0 - 0.18 * step(dot(hp, hp), 0.0016) * smoothstep(0.02, 0.008, pxm);
          dcol *= 0.95 + 0.08 * hash12(floor(pg) + seed);
        }
        dcol = mix(dcol, dcol * 0.9, smoothstep(0.5, 0.85, below) * 0.6);
        dcol = mix(dcol, mix(dcol, vec3(0.84, 0.85, 0.86), 0.6), frameL);
        dcol = mix(dcol, dcol * 1.08 + 0.05, sill);
        // window mullion
        float mull = step(abs(gx), 0.018) * step(0.5, fract(r1 * 3.0)) * (1.0 - step(0.86, r1));
        dcol = mix(dcol, glass, win);
        dcol = mix(dcol, vec3(0.8, 0.82, 0.84), win * mull);
        // an air-conditioner box hung under some windows
        float acx = (f.x - 0.5 - (r3 - 0.5) * 0.3) / 0.14;
        float acy = (f.y - (cy - wh * 0.5 - 0.14)) / 0.08;
        float ac = step(abs(acx), 1.0) * step(abs(acy), 1.0) * step(0.3, r1) * step(r1, 0.42);
        dcol = mix(dcol, vec3(0.9, 0.9, 0.88) * (0.92 + 0.12 * step(0.0, acy)), ac);
        glassAmt = win * detailFade;
        // the distant read: window rows and piers as anti-aliased value bands (never a
        // blank box), each floor's glass a slightly different tone of the sky
        float rowW = fract(uv.y / fh);
        float aaY = clamp(fwidth(uv.y / fh), 0.001, 0.5);
        float rowB = smoothstep(cy - wh * 0.5 - aaY, cy - wh * 0.5 + aaY, rowW) * (1.0 - smoothstep(cy + wh * 0.5 - aaY, cy + wh * 0.5 + aaY, rowW));
        rowB = mix(rowB, wh, smoothstep(0.3, 0.5, aaY));
        float colW = fract(uv.x / sp);
        float aaX = clamp(fwidth(uv.x / sp), 0.001, 0.5);
        float colB = smoothstep(0.5 - ww * 0.5 - aaX, 0.5 - ww * 0.5 + aaX, colW) * (1.0 - smoothstep(0.5 + ww * 0.5 - aaX, 0.5 + ww * 0.5 + aaX, colW));
        colB = mix(colB, ww, smoothstep(0.3, 0.5, aaX));
        vec3 glassFar = mix(vCol2, vec3(0.6, 0.72, 0.9), 0.4) * (0.86 + 0.24 * hash12(vec2(floor(uv.y / fh), seed + floor(uv.x / (sp * 4.0)))));
        vec3 avg = mix(col, glassFar, rowB * colB * 0.85);
        col = mix(avg, dcol, detailFade);
        // floor ledges: a lit top lip and a cool shadow band under it
        float fy = fract(uv.y / fh) * fh;
        float lip = 1.0 - smoothstep(0.1, 0.1 + pxm, abs(fy - fh + 0.05));
        float slabSh = (1.0 - smoothstep(0.0, 0.22, fy)) * step(0.02, fy);
        col = mix(col, col * 1.12 + 0.05, lip * detailFade * 0.9);
        col = mix(col, col * vec3(0.8, 0.82, 0.92), slabSh * detailFade * 0.55);
      } else if(kind == 3.0){
        // balcony parapet: panels, a bright top rail, a shaded gap below
        float pan = step(0.94, fract(uv.x / sp));
        col = mix(col, col * 0.86, pan * detailFade);
        float bstyle = hash12(vec2(floor(seed), 5.1));
        float by = fract(uv.y / fh);
        if(bstyle < 0.4){
          // steel bars: the shaded balcony shows between them
          float bar = step(0.42, fract(uv.x / 0.13));
          float inBars = step(0.1, by) * step(by, 0.84);
          col = mix(col, mix(col * vec3(0.55, 0.58, 0.72), vCol2 * 0.6, 0.3), bar * inBars * detailFade);
        } else if(bstyle < 0.7){
          // frosted glass panels in pale frames
          float fr = step(0.06, fract(uv.x / 1.2)) * step(0.14, by) * step(by, 0.82);
          col = mix(col, mix(col, vec3(0.78, 0.86, 0.92), 0.55) * (0.95 + 0.1 * by), fr * detailFade);
        }
        float top = smoothstep(0.86, 0.9, by);
        col = mix(col, col * 1.1 + 0.04, top * 0.7);
        float lowShade = smoothstep(0.5, 0.0, fract(uv.y / fh));
        col *= 1.0 - 0.1 * lowShade;
      } else if(kind == 2.0){
        // flat roofs: concrete, moss, rain puddles mirroring the sky
        float m = fbm2(w.xz * 0.35 + seed);
        col = mix(col, col * 0.88, step(0.55, m));
        float pud = step(0.68 - 0.15 * uWet, fbm2(w.xz * 0.2 + seed * 3.0));
        col = mix(col, mix(uSkyTint, vec3(0.62, 0.78, 0.95), 0.5), pud * (0.45 + 0.4 * uWet));
      } else if(kind == 5.0){
        // kawara tiles: rows along the slope, glazed blue-grey
        float rowv = fract(uv.y / 0.32);
        col = mix(vCol2, vCol2 * 0.74, smoothstep(0.7, 0.95, rowv));
        col *= 0.93 + 0.12 * vnoise(vec2(uv.x * 0.8, floor(uv.y / 0.32)) + seed);
        col = mix(col, col * 0.88, step(0.6, fbm2(w.xz * 0.6 + seed)) * 0.5);
      } else if(kind == 6.0 || kind == 10.0){
        col = sig.rgb;
      } else if(kind == 7.0){
        col = vec3(0.24, 0.24, 0.32) * (0.9 + 0.2 * v1);
      } else if(kind == 8.0){
        col = mix(vec3(0.46, 0.45, 0.48), vec3(0.54, 0.52, 0.5), v1);
        float lane = step(abs(fract(uv.x / 3.6) - 0.5), 0.02) * step(0.5, fract(uv.y / 8.0));
        col = mix(col, vec3(0.86, 0.84, 0.78), lane * 0.6 * detailFade);
      } else if(kind == 9.0){
        float c = step(0.5, fract(uv.y * 6.0));
        col = mix(vCol2, vCol2 * 0.88, c * detailFade);
      }

      // ---- vegetation: ivy curtains from the roofline, creepers climbing from the water
      float ivyAmt = vQ.w;
      if(ivyAmt > 0.0 && (kind <= 1.0 || kind == 3.0 || kind == 9.0) && wall > 0.5){
        float hang = Htop - uv.y;
        float colN = vnoise(vec2(uv.x * 0.2 + seed * 3.3, seed));
        float len = ivyAmt * Htop * (0.06 + 0.94 * colN * colN);
        // separate drapes with bare wall between them (a continuous green band along the
        // roofline reads as a grass block), each ending in a few long trailing strands
        float drape = smoothstep(0.32, 0.5, vnoise(vec2(uv.x * 0.42 + seed * 1.9, seed + 2.0)));
        float rag = (vnoise(vec2(uv.x * 1.6, uv.y * 0.4 + seed)) - 0.5) * 2.4 + (vnoise(vec2(uv.x * 5.0, seed)) - 0.5) * 1.1;
        rag += smoothstep(0.62, 0.9, vnoise(vec2(uv.x * 3.2, seed + 5.0))) * 2.6;
        float fieldH = (len * drape + (rag + 0.6) * drape - 0.6 - hang) * step(-0.2, hang);
        float climbN = vnoise(vec2(uv.x * 0.3 + seed * 1.7, 4.0 + seed));
        float climb = ivyAmt * (0.6 + 6.0 * climbN * climbN) + (vnoise(vec2(uv.x * 1.2, seed + 9.0)) - 0.5) * 1.4;
        float field = max(fieldH, (climb - hw) * step(-0.9, hw) - 4.0 * (1.0 - step(-0.9, hw)));   // no leafy ivy deep under water
        vec2 fp = vec2(uv.x, uv.y);
        vec2 bl = billows(fp, 0.7, seed);
        // scalloped leafy rim: clumps bulge past the ragged edge
        float ivyNear = step(0.0, field + (bl.y - 0.55) * 1.1) * step(0.0, bl.y);
        float ivy = mix(step(0.0, field), ivyNear, detailFade);
        vec3 ivyC = mix(vec3(0.21, 0.4, 0.3), leafTone(bl.x), detailFade);
        // morning glories and white bindweed flowers sprinkled through the vines
        vec2 fc = floor(fp * 2.2);
        float fl = step(0.9, hash12(fc + seed)) * step(length(fract(fp * 2.2) - 0.5 - (hash22(fc) - 0.5) * 0.4), 0.17);
        vec3 flC = mix(vec3(0.42, 0.45, 0.93), vec3(0.97, 0.95, 0.98), step(0.55, hash12(fc + 3.3)));
        flC = mix(flC, vec3(0.93, 0.55, 0.78), step(0.85, hash12(fc + 7.1)));
        ivyC = mix(ivyC, flC, fl * detailFade);
        col = mix(col, ivyC, ivy);
        ao *= 1.0 - 0.08 * ivy;
      }
      float moss = vP.w;
      if(moss > 0.0 && kind != 6.0){
        float mN = fbm3(w * vec3(0.5, 1.0, 0.5) + seed * 2.0);
        float nearW = smoothstep(3.0, 0.0, hw);
        float topF = smoothstep(0.6, 0.9, N.y);
        float th = 0.68 - 0.22 * moss * nearW - 0.16 * moss * topF;
        float mm = smoothstep(th, th + 0.05, mN) * (kind == 5.0 ? 0.55 : 1.0);
        vec3 mossC = mix(vec3(0.45, 0.6, 0.33), vec3(0.62, 0.72, 0.38), smoothstep(0.4, 0.6, vnoise(w.xz * 1.6 + w.y)));
        col = mix(col, mix(col, mossC, 0.85), mm * min(moss, 0.8));
      }
      // old waterline stain and a wet band just above the water
      float stainH = vR.w * (0.5 + 0.35 * vnoise(w.xz * 0.6 + seed));
      col = mix(col, col * vec3(0.78, 0.8, 0.78), step(0.0, hw) * step(hw, stainH) * 0.8);
      ao *= mix(0.86, 1.0, smoothstep(0.0, 1.6, hw));
      // painted height gradient: tops catch more sky and warm up, feet stay cool
      ao *= mix(0.94, 1.06, smoothstep(0.0, 20.0, hw)) * vR.z;
      col *= mix(vec3(0.95, 0.97, 1.03), vec3(1.03, 1.01, 0.97), smoothstep(0.0, 24.0, hw));

      // ---- fake cast shadows from unseen buildings (stepped skyline)
      vec2 sxz = normalize(uSunDir.xz + 1e-5);
      float pp = dot(w.xz, vec2(-sxz.y, sxz.x));
      float skyl = stepNoise(pp / 7.0, 17.0 + floor(seed));
      float sH = vR.y * (0.35 + 0.65 * skyl);
      float sunVis = mix(1.0, smoothstep(sH - 0.25, sH + 0.25, w.y), vR.x);

      // ---- soaked by the sunshower: a touch darker and richer, glossy
      float wetK = uWet * (kind == 6.0 ? 0.5 : 1.0);
      col = mix(col, pow(col, vec3(1.12)) * 0.93, wetK * 0.7);

      vec3 outc = paintLight(col, N, w, sunVis, ao);
      if(kind == 6.0) outc = mix(outc, col * 0.95, 0.3);

      // ---- painted edge highlights: corners, parapet tops and roof rims catch the light
      float eOK = step(0.05, vE.y - vE.x) * step(0.05, vE.w - vE.z) * (1.0 - step(5.5, kind) * step(kind, 6.5)) * (1.0 - step(9.5, kind));
      if(eOK > 0.5){
        float dL = uv.x - vE.x, dR = vE.y - uv.x, dB = uv.y - vE.z, dT = vE.w - uv.y;
        float ew = max(0.045, pxm * 1.2);
        float side = min(dL, dR);
        float eSide = 1.0 - smoothstep(ew, ew + pxm, side);
        float eTop = 1.0 - smoothstep(ew * 0.9, ew * 0.9 + pxm, dT);
        float eRim = 1.0 - smoothstep(ew, ew + pxm, min(min(dL, dR), min(dB, dT)));
        float hi = mix(eRim * step(0.5, N.y), max(eSide, eTop), wall);
        // a cool drawn shade line just inside the lit edge gives the corner thickness
        float inner = wall * (1.0 - smoothstep(ew * 2.4, ew * 2.4 + pxm, side)) * (1.0 - eSide) * (1.0 - eTop);
        float litK = smoothstep(-0.03, 0.15, dot(N, uSunDir)) * sunVis;
        float fadeE = 1.0 - smoothstep(0.12, 0.5, pxm);
        vec3 hiC = outc * (1.22 + 0.18 * litK) + mix(uSkyTint * 0.05, uSunColor * 0.09, litK);
        outc = mix(outc, hiC, hi * 0.8 * fadeE);
        outc = mix(outc, outc * mix(vec3(0.9, 0.91, 0.98), vec3(0.95), litK), inner * 0.7 * fadeE);
      }

      // sky in the glass, sun streaks on wet ledges, roofs and tiles
      vec3 V = normalize(cameraPosition - w);
      float fr = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
      vec3 Rv = reflect(-V, N);
      float spec = pow(max(dot(Rv, uSunDir), 0.0), 40.0);
      float glint = spec * (0.4 + 0.6 * step(0.55, vnoise(vec2(uv.x * 2.5 + seed, uv.y * 0.35))));
      outc += uSkyTint * fr * (0.08 * glassAmt + 0.16 * wetK);
      outc += uSunColor * glint * uSunStrength * (0.18 * glassAmt + 0.9 * wetK) * sunVis;
      writeOut(outc, 1.0, NV, vDepth, uId);
    }
  `;
  return mat(u, vs, fs);
}

// ------------------------------------------------------------- wires
// Catenary wires as screen-space ribbons: constant, crisp pixel width like an
// inked line in a painted background. Cel id 101 = no brushwork, no ink.
export function wireMaterial(o = {}) {
  const u = base({
    uRes: { value: new THREE.Vector2(1920, 1040) },
    uWidth: { value: o.width ?? 1.4 },
    uColor: { value: new THREE.Color(o.color ?? '#2c2735') },
    uId: { value: o.id ?? 101 },
    ...envU(),
  });
  const vs = /* glsl */ `
    attribute vec3 aOther;
    attribute float aSide;
    uniform vec2 uRes;
    uniform float uWidth;
    varying float vDepth;
    varying vec3 vWorld;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vec4 wo = modelMatrix * vec4(aOther, 1.0);
      vWorld = wp.xyz;
      vec4 mv = viewMatrix * wp;
      vDepth = -mv.z;
      vec4 cp = projectionMatrix * mv;
      vec4 co = projectionMatrix * viewMatrix * wo;
      vec2 a = cp.xy / max(cp.w, 1e-3), b = co.xy / max(co.w, 1e-3);
      vec2 d = (b - a) * uRes;
      d = length(d) > 1e-5 ? normalize(d) : vec2(1.0, 0.0);
      vec2 n = vec2(-d.y, d.x);
      float wpx = uWidth * clamp(30.0 / max(vDepth, 1.0), 0.75, 1.6);
      cp.xy += n * aSide * wpx / uRes * cp.w;
      gl_Position = cp;
    }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    ${WEATHER_U}
    uniform vec3 uColor;
    uniform float uId;
    varying float vDepth;
    varying vec3 vWorld;
    void main(){
      if(uPass > 1.5 && vWorld.y < uWaterLevel - 0.03) discard;
      if(uPass > 0.5 && uPass < 1.5){ oColor = vec4(1); oData = vec4(0); return; }
      vec3 c = uColor * mix(vec3(1.0), uSkyTint, 0.3) + uSunColor * 0.05 * uSunStrength;
      // wet wires catch the backlight: bright beads of light along them
      float bead = step(0.82, fract(vWorld.x * 1.7 + vWorld.z * 1.3 + vWorld.y * 0.6));
      c = mix(c, uSunColor * 1.5, bead * uWet * 0.6 * uSunStrength);
      writeOut(c, 1.0, vec3(0.0, 0.0, 1.0), vDepth, uId);
    }
  `;
  return mat(u, vs, fs, { side: THREE.DoubleSide });
}

// ------------------------------------------------------- floating patches
// Lily pads and algae lying on the water (atlas colours, alpha cut-out).
export function floatMaterial(map) {
  const u = base({ uMap: { value: map }, ...envU() });
  const vs = /* glsl */ `
    ${VERT_STD}
    void main(){ stdVertex(position, normal); }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    ${WEATHER_U}
    uniform sampler2D uMap;
    varying vec3 vWorld, vNormalW, vNormalV;
    varying float vDepth;
    varying vec2 vUv;
    void main(){
      vec4 m = texture(uMap, vUv);
      if(m.a < 0.5) discard;
      if(uPass > 0.5) { if(uPass < 1.5){ oColor = vec4(1); oData = vec4(0); return; } discard; }
      vec3 c = m.rgb * mix(uShadeTint * 1.08, mix(uSkyTint, uSunColor, 0.6 * uSunStrength) * 1.08, 0.6 + 0.25 * uSunStrength);
      // wet pads glint in the sun
      vec3 V = normalize(cameraPosition - vWorld);
      float spec = pow(max(dot(reflect(-V, vec3(0.0, 1.0, 0.0)), uSunDir), 0.0), 30.0);
      c += uSunColor * spec * (0.25 + 0.6 * uWet) * uSunStrength * step(0.4, m.g);
      writeOut(c, 1.0, vec3(0.0, 0.0, 1.0), vDepth, 0.0);
    }
  `;
  return mat(u, vs, fs);
}

// ------------------------------------------------------------- foliage clumps
// Camera-facing painted clumps. Atlas texels: r = tone (0 deep .. 1 light),
// g = hue variation, b = blossom, a = coverage.
export function foliageMaterial(atlas, o = {}) {
  const u = base({
    uAtlas: { value: atlas.texture },
    uGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
    uPal0: { value: new THREE.Color(o.deep ?? '#25423f') },
    uPal1: { value: new THREE.Color(o.shade ?? '#3e6a52') },
    uPal2: { value: new THREE.Color(o.mid ?? '#6f9a57') },
    uPal3: { value: new THREE.Color(o.light ?? '#b8c873') },
    uBloom: { value: new THREE.Color(o.blossom ?? '#f4efe0') },
    uBloom2: { value: new THREE.Color(o.blossom2 ?? o.blossom ?? '#f4efe0') },
    uId: { value: o.id ?? 0 },
    uSway: { value: o.sway ?? 1 },
    uGlow: { value: o.glow ?? 1 },
    ...envU(),
  });
  const vs = /* glsl */ `
    attribute vec4 aVar;   // atlas index, hue shift, sway phase, flip
    varying vec2 vUv;
    varying float vDepth;
    varying vec4 vVar;
    varying vec3 vWorld;
    varying vec2 vLocal;
    uniform float uSway, uDrawTime, uPass;
    uniform vec3 uSunDir;
    void main(){
      mat4 im = instanceMatrix;
      vec3 center = (modelMatrix * im * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float sc = length((modelMatrix * im * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
      float scy = length((modelMatrix * im * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
      vec4 mv = viewMatrix * vec4(center, 1.0);
      vec2 off = vec2(position.x * sc, (position.y + 0.5) * scy);
      float hgt = position.y + 0.5;
      off.x += sin(uDrawTime * 1.1 + aVar.z * 6.283) * 0.025 * sc * hgt * uSway;
      // flip the painted light side to match the sun on screen
      vec3 sunV = mat3(viewMatrix) * uSunDir;
      float flip = (sunV.x < 0.0) ? 1.0 : -1.0;
      if(aVar.w > 0.5) flip *= -1.0;
      if(uPass > 1.5) off = -off;
      mv.xy += off;
      vWorld = center + vec3(0.0, hgt * scy, 0.0);
      vLocal = vec2(position.x, hgt);
      float idx = aVar.x;
      vec2 cell = vec2(mod(idx, ${atlas.cols}.0), floor(idx / ${atlas.cols}.0));
      vec2 luv = vec2(flip > 0.0 ? uv.x : 1.0 - uv.x, uv.y);
      luv = mix(vec2(0.004), vec2(0.996), luv);
      vUv = (cell + luv) / vec2(${atlas.cols}.0, ${atlas.rows}.0);
      vVar = aVar;
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    ${WEATHER_U}
    uniform sampler2D uAtlas;
    uniform vec3 uPal0, uPal1, uPal2, uPal3, uBloom, uBloom2;
    uniform vec2 uGrid;
    uniform float uId, uGlow;
    varying vec2 vUv;
    varying float vDepth;
    varying vec4 vVar;
    varying vec3 vWorld;
    varying vec2 vLocal;
    void main(){
      vec4 t = texture(uAtlas, vUv);
      if(t.a < 0.5) discard;
      if(uPass > 1.5 && vWorld.y < uWaterLevel - 0.03) discard;
      if(uPass > 0.5 && uPass < 1.5){ oColor = vec4(1); oData = vec4(0); return; }
      float tone = t.r;
      vec3 Vv = normalize(vWorld - cameraPosition);
      float backK = smoothstep(0.35, 0.85, dot(Vv, uSunDir)) * uSunStrength;
      vec3 c = tone < 0.25 ? uPal0 : tone < 0.5 ? uPal1 : tone < 0.75 ? uPal2 : uPal3;
      // leaf texture inside the big flat tone masses: scattered leaf shapes one tone up
      // or down, so close foliage reads as layered leaves rather than flat plates
      {
        vec2 lp = vUv * uGrid * 512.0 / 9.0;
        float lfw = length(fwidth(lp));
        vec2 lc = floor(lp);
        vec2 h2 = hash22(lc + vVar.x * 7.0);
        vec2 lf = fract(lp) - 0.5 - (h2 - 0.5) * 0.35;
        float la = h2.x * 6.2831;
        lf = mat2(cos(la), sin(la), -sin(la), cos(la)) * lf;
        float leaf = 1.0 - smoothstep(0.3, 0.3 + lfw, length(vec2(lf.x, lf.y * 2.3)));
        float lk = leaf * (1.0 - smoothstep(0.35, 0.8, lfw));
        float hi = step(0.62, h2.y), lo = step(h2.y, 0.22);
        vec3 up = tone < 0.25 ? uPal1 : tone < 0.5 ? uPal2 : uPal3;
        vec3 dn = tone < 0.5 ? uPal0 : tone < 0.75 ? uPal1 : uPal2;
        c = mix(c, mix(c, up, 0.55), lk * hi * step(tone, 0.85));
        c = mix(c, mix(c, dn, 0.45), lk * lo * step(0.3, tone));
      }
      // in backlight the leaf masses cool down, only the brightest dabs stay sunny
      c *= mix(vec3(1.0), vec3(0.8, 0.86, 0.94), backK * (1.0 - smoothstep(0.7, 0.8, tone)));
      float hv = t.g + vVar.y;
      c *= mix(vec3(0.92, 1.02, 0.96), vec3(1.07, 1.0, 0.86), fract(hv));
      float isBloom = step(0.3, t.b);
      vec3 bl = mix(uBloom, uBloom2, step(0.75, t.b));
      bl *= mix(0.78, 1.04, smoothstep(0.2, 0.8, tone));
      c = mix(c, bl, isBloom);
      vec3 tint = mix(uSkyTint, uSunColor * 1.06, uSunStrength * smoothstep(0.5, 0.8, tone));
      c *= mix(uShadeTint * 1.12, tint, smoothstep(0.2, 0.6, tone));
      // looking into the sun: leaves glow yellow-green where light comes through
      vec3 V = normalize(vWorld - cameraPosition);
      float back = pow(max(dot(V, uSunDir), 0.0), 2.0) * uSunStrength * uGlow;
      float thin = smoothstep(0.25, 0.9, tone) * (0.55 + 0.45 * smoothstep(0.4, 1.0, vLocal.y));
      c = mix(c, c * vec3(1.08, 1.12, 0.9) + vec3(0.05, 0.07, 0.0), back * thin * 0.5 * (1.0 - isBloom));
      // wet leaves: richer colour and a few sparkles in the backlight
      c = mix(c, c * vec3(0.92, 1.0, 0.94), uWet * 0.4);
      float sp = step(0.96, hash12(floor(vUv * 900.0) + floor(uEnvTime * 8.0))) * step(0.6, tone);
      c += uSunColor * sp * back * uWet * 1.2;
      writeOut(c, 1.0, vec3(0.0, 0.0, 1.0), vDepth, uId);
    }
  `;
  return mat(u, vs, fs);
}

// ------------------------------------------------------------------------- sky
// Painted summer sky: deep blue zenith, pale horizon, towering cumulonimbus
// (unions of sphere-shaded billows -> crisp painted edges, lavender shadow
// sides), a thin veil over the sun during the shower, and the rainbow.
// clouds: { towers: [{ puffs: [[az, el, r, z]...], cut, haze }] } in degrees.
export function skyMaterial(clouds = { towers: [] }) {
  const MAXT = 32;
  const all = [];
  const tb = [], ti = [];
  for (const t of clouds.towers.slice(0, MAXT)) {
    const start = all.length;
    let a0 = 1e9, a1 = -1e9, e0 = 1e9, e1 = -1e9;
    const azC = t.puffs[0][0];
    for (const p of t.puffs.slice(0, 110)) {
      const da = ((p[0] - azC + 540) % 360) - 180;
      const ra = p[2] * 1.45 / Math.max(0.2, Math.cos(Math.min(80, Math.abs(p[1]) + p[2] * 1.45) * Math.PI / 180));
      a0 = Math.min(a0, da - ra); a1 = Math.max(a1, da + ra);
      e0 = Math.min(e0, p[1] - p[2] * 1.45); e1 = Math.max(e1, p[1] + p[2] * 1.45);
      all.push(p);
    }
    const mid = (a0 + a1) / 2;
    tb.push(new THREE.Vector4(azC + mid, (a1 - a0) / 2, Math.max(e0, t.cut ?? -90) - 0.5, e1));
    ti.push(new THREE.Vector4(start, all.length - start, t.haze ?? 0, t.cut ?? -90));
  }
  while (tb.length < MAXT) { tb.push(new THREE.Vector4(0, 0, 100, 100)); ti.push(new THREE.Vector4(0, 0, 0, -90)); }
  const W = Math.max(1, all.length);
  const data = new Float32Array(W * 4);
  all.forEach((p, i) => data.set([p[0], p[1], p[2], p[3]], i * 4));
  const ptex = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat, THREE.FloatType);
  ptex.minFilter = ptex.magFilter = THREE.NearestFilter;
  ptex.needsUpdate = true;

  const u = base({
    uZenith: { value: new THREE.Color('#2f6fd0') },
    uMid: { value: new THREE.Color('#6fb1ee') },
    uHorizonWarm: { value: new THREE.Color('#eef4f4') },
    uHorizonCool: { value: new THREE.Color('#cfe6f5') },
    uCloudLit: { value: new THREE.Color('#ffffff') },
    uCloudMid: { value: new THREE.Color('#eef2fa') },
    uCloudShade: { value: new THREE.Color('#a9b6dc') },
    uSunDisk: { value: 1 },
    uCloudShift: { value: new THREE.Vector2(0, 0) },
    uCloudDrift: { value: 0 },
    uPuffs: { value: ptex },
    uTower: { value: tb },
    uTowerI: { value: ti },
    uNTowers: { value: Math.min(MAXT, clouds.towers.length) },
    ...envU(),
  });
  const vs = /* glsl */ `
    varying vec3 vDir;
    varying float vDepth;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vDir = normalize(wp.xyz - cameraPosition);
      vec4 mv = viewMatrix * wp;
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
      gl_Position.z = gl_Position.w * 0.99999;
    }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    ${WEATHER_U}
    uniform vec3 uZenith, uMid, uHorizonWarm, uHorizonCool, uCloudLit, uCloudMid, uCloudShade;
    uniform float uSunDisk, uNTowers, uCloudDrift;
    uniform vec2 uCloudShift;
    uniform sampler2D uPuffs;
    uniform vec4 uTower[${MAXT}];
    uniform vec4 uTowerI[${MAXT}];
    varying vec3 vDir;
    varying float vDepth;
    const float D2R = 0.0174532925;

    // scalloped sub-billows: the outward tilt of the front-most bubble at p
    vec3 bubbles(vec2 p, float seed){
      vec2 ip = floor(p), bv = vec2(0.0); float bd = 1e9;
      for(int j = -1; j <= 1; j++) for(int i = -1; i <= 1; i++){
        vec2 c = ip + vec2(float(i), float(j));
        vec2 o = hash22(c + seed);
        float r = 0.62 + 0.5 * o.x;
        vec2 v = p - (c + 0.5 + (o - 0.5) * 0.76);
        float dd = dot(v, v) / (r * r) - o.y * 0.4;
        if(dd < bd){ bd = dd; bv = v / r; }
      }
      return vec3(bv, sqrt(max(1.0 - dot(bv, bv), 0.04)));
    }

    vec3 bowColor(float x){
      // x: 0 violet (inside) .. 1 red (outside)
      vec3 c = mix(vec3(0.58, 0.4, 0.95), vec3(0.32, 0.52, 1.0), smoothstep(0.02, 0.2, x));
      c = mix(c, vec3(0.32, 0.86, 0.5), smoothstep(0.22, 0.42, x));
      c = mix(c, vec3(1.0, 0.95, 0.38), smoothstep(0.44, 0.6, x));
      c = mix(c, vec3(1.0, 0.6, 0.24), smoothstep(0.62, 0.78, x));
      c = mix(c, vec3(0.97, 0.27, 0.32), smoothstep(0.8, 0.94, x));
      return c;
    }

    void main(){
      if(uPass > 0.5 && uPass < 1.5){ oColor = vec4(1); oData = vec4(0); return; }
      vec3 d = normalize(vDir);
      vec3 s = normalize(uSunDir);
      float el = d.y;
      float elD = asin(clamp(el, -1.0, 1.0)) / D2R;
      float azD = atan(d.x, -d.z) / D2R;
      float toSun = dot(d, s);
      vec2 hs = normalize(s.xz + 1e-5);
      float sunSide = dot(normalize(d.xz + 1e-5), hs) * 0.5 + 0.5;

      // ---- painted gradient: pale horizon -> saturated cyan-blue -> deep zenith
      vec3 hor = mix(uHorizonCool, uHorizonWarm, smoothstep(0.35, 1.0, sunSide));
      float h = max(elD, 0.0);
      vec3 col = mix(hor, uMid, smoothstep(0.0, 16.0, h));
      col = mix(col, uZenith, smoothstep(10.0, 75.0, h));
      // the sky whitens around the sun
      float glow = pow(max(toSun, 0.0), 14.0);
      col = mix(col, mix(hor, vec3(1.0), 0.35), glow * 0.5);
      col = mix(col, hor * 0.98, step(el, 0.0));
      // veil: the whole sky goes a little milky during the shower
      col = mix(col, mix(hor, uMid, 0.5), uVeil * 0.22);

      // ---- high cirrus wisps in the deep blue
      if(el > 0.05){
        vec2 cp = d.xz / (el + 0.25);
        vec2 cr = vec2(cp.x * 0.8 + cp.y * 0.6, -cp.x * 0.6 + cp.y * 0.8);
        float ci = fbm2(cr * vec2(0.9, 5.5) + vec2(3.0, uCloudShift.x * 3.0)) * fbm2(cr * 0.5 + 11.0);
        float wisp = smoothstep(0.27, 0.36, ci) * smoothstep(0.1, 0.35, el);
        col = mix(col, mix(col, vec3(1.0), 0.7), wisp * 0.28);
      }

      // ---- towering cumulus: union of billows, the front-most billow shades the pixel
      vec3 east = normalize(vec3(-d.z, 0.0, d.x) + vec3(1e-6, 0.0, 0.0));
      vec3 upT = normalize(vec3(0.0, 1.0, 0.0) - d * el + vec3(0.0, 1e-6, 0.0));
      vec3 L = normalize(vec3(dot(s, east), dot(s, upT), dot(s, -d)));
      float edgeN = fbm3(d * 24.0 + 3.1 + vec3(uCloudShift, 0.0)) - 0.5;
      float edgeN2 = vnoise3(d * 66.0) - 0.5;
      float ce = cos(elD * D2R);
      float best = -1e9, second = -1e9, maxE = -1.0;
      vec3 bn = vec3(0.0, 0.0, 1.0);
      float bHaze = 0.0, bBase = 0.0, bTop = 1.0, bR = 1.0;
      vec2 tC = vec2(0.0);
      for(int ti = 0; ti < ${MAXT}; ti++){
        if(float(ti) >= uNTowers) break;
        vec4 tb = uTower[ti];
        float daz = mod(azD - tb.x - uCloudDrift + 540.0, 360.0) - 180.0;
        if(abs(daz) > tb.y || elD < tb.z || elD > tb.w) continue;
        vec4 tinf = uTowerI[ti];
        int st = int(tinf.x + 0.5), cnt = int(tinf.y + 0.5);
        float cut = tinf.w;
        for(int k = 0; k < 110; k++){
          if(k >= cnt) break;
          vec4 P = texelFetch(uPuffs, ivec2(st + k, 0), 0);
          float dx = (mod(azD - P.x - uCloudDrift + 540.0, 360.0) - 180.0) * ce;
          float dy = elD - P.y;
          float q2 = (dx * dx + dy * dy) / (P.z * P.z);
          if(q2 > 2.1) continue;
          float e = 1.0 - q2 + (edgeN * 0.5 + edgeN2 * 0.16) * (0.55 + 2.2 / (P.z + 1.5));
          e -= max(cut - elD, 0.0) * 0.9;           // flat cloud base
          maxE = max(maxE, e);
          if(e <= 0.0) continue;
          float hz = sqrt(e) * P.z + P.w + edgeN * P.z * 1.1 + edgeN2 * P.z * 0.35;
          if(hz > best){ second = best; best = hz; bn = vec3(dx / P.z, dy / P.z, sqrt(e)); bHaze = tinf.z; bBase = max(cut, tb.z); bTop = tb.w; bR = P.z; tC = vec2(daz / max(tb.y, 1.0), (elD - 0.5 * (tb.z + tb.w)) / max(0.5 * (tb.w - tb.z), 1.0)); }
          else if(hz > second) second = hz;
        }
      }
      float fwE = max(fwidth(maxE), 1e-4);
      if(maxE > -0.6){
        float cov = smoothstep(-fwE * 0.6, fwE * 0.9, maxE);
        // cauliflower: bubbles on the billows, bubbles on the bubbles, sized to the billow
        vec2 bp = vec2(azD * ce, elD) + vec2(edgeN, -edgeN2) * bR * 0.5;
        vec3 b1 = bubbles(bp / (bR * 0.62), 3.0), b2 = bubbles(bp / (bR * 0.25), 11.0);
        vec3 nn = normalize(bn + vec3(edgeN2 * 0.5 + edgeN * 0.3, edgeN * 0.55 - edgeN2 * 0.2, 0.0) + vec3(b1.xy * 0.95 + b2.xy * 0.42, 0.0));
        vec3 tN = normalize(vec3(tC.x * 0.62, tC.y * 0.3 + 0.3, 0.62));     // the whole tower is one big volume
        float lit = mix(dot(nn, L), dot(tN, L), 0.6) - 0.03;
        float bandN = (abs(vnoise3(d * 26.0) - 0.5) * 2.0 + 0.6 * abs(vnoise3(d * 61.0) - 0.5) * 2.0 - 0.72) * 2.2;
        float tLit = smoothstep(-0.04, 0.04, lit + bandN * 0.14);
        float tHi = smoothstep(0.46, 0.54, lit + bandN * 0.1);
        float back = smoothstep(0.35, 0.95, toSun);
        vec3 shadeC = mix(uCloudShade, mix(uCloudShade, uCloudMid, 0.4) * vec3(1.02, 1.0, 1.0), back);
        vec3 cc = mix(shadeC, uCloudMid, tLit);
        cc = mix(cc, uCloudLit, tHi);
        // bases sit in their own blue shade, tops are whitest
        float hgt = clamp((elD - bBase) / max(bTop - bBase, 1.0), 0.0, 1.0);
        cc = mix(cc, mix(uCloudShade, uCloudMid, 0.25) * vec3(0.96, 0.97, 1.02), smoothstep(0.2, 0.0, hgt) * 0.55 * (1.0 - tHi));
        // a soft drawn rim where a front billow overlaps the one behind it
        float ov = 1.0 - smoothstep(0.0, 0.08 * bR + 0.1, best - second);
        cc = mix(cc, cc * vec3(0.93, 0.94, 0.985), ov * 0.4 * (1.0 - tHi * 0.6));
        // backlit: silver lining along the thin edges toward the sun
        float thin = 1.0 - smoothstep(0.0, 0.3, maxE);
        float rimDir = clamp(dot(normalize(bn.xy + 1e-4), normalize(L.xy + 1e-4)) * 0.5 + 0.5, 0.0, 1.0);
        cc = mix(cc, uCloudLit * 1.12, thin * rimDir * back * 0.9);
        // the veil greys the clouds a touch
        cc = mix(cc, mix(cc, uCloudMid, 0.5), uVeil * 0.3);
        // distance haze near the horizon
        cc = mix(cc, hor, clamp(smoothstep(9.0, 0.0, elD) * 0.92 + bHaze, 0.0, 0.96));
        col = mix(col, cc, cov);
      }

      // ---- thin bright veil sliding over the sun during the shower
      if(uVeil > 0.002 && el > 0.0){
        vec2 vp = d.xz / (el + 0.2);
        vec2 vq = vp * 1.3 + vec2((1.0 - uVeil) * 2.6 + uEnvTime * 0.01, 0.4);
        float vn = fbm2(vec2(vq.x * 0.7 + vq.y * 0.3, vq.y * 2.0 - vq.x * 0.4));
        float around = smoothstep(0.0, 0.95, toSun);
        float va = smoothstep(0.4, 0.66, vn + around * 0.22) * uVeil * smoothstep(0.0, 0.1, el);
        vec3 vc = mix(vec3(0.88, 0.92, 0.98), vec3(1.04, 1.02, 0.97), pow(max(toSun, 0.0), 10.0));
        col = mix(col, vc, va * 0.62);
      }

      // ---- sun: disk + glow (softened and widened behind the veil)
      float veilK = 1.0 - 0.7 * uVeil;
      float disk = smoothstep(0.99955, 0.9997, toSun) * uSunDisk * veilK;
      float halo = pow(max(toSun, 0.0), 320.0) * 0.9 * veilK + pow(max(toSun, 0.0), 40.0) * (0.16 + 0.22 * uVeil) + pow(max(toSun, 0.0), 8.0) * 0.05;
      col += mix(uHorizonWarm, vec3(1.0, 0.98, 0.92), 0.6) * halo * uSunDisk;
      col = mix(col, vec3(1.0, 0.98, 0.92) * 2.6, disk);

      // ---- rainbow: primary 42 deg around the antisolar point, secondary 51 reversed
      if(uRainbow > 0.002){
        float ang = acos(clamp(-toSun, -1.0, 1.0)) / D2R;
        float rv = 0.8 + 0.2 * vnoise(vec2(azD * 0.09, 1.7)) + 0.1 * (vnoise(vec2(azD * 0.6, ang * 2.0)) - 0.5);
        float grow = smoothstep(0.0, 3.0, mix(-4.0, 48.0, smoothstep(0.0, 0.85, uRainbow)) - elD);
        float k = smoothstep(0.0, 0.35, uRainbow) * grow * rv * smoothstep(-2.0, 1.5, elD) * (uPass > 1.5 ? 0.55 : 1.0);
        float x1 = (ang - 40.2) / 2.4;
        float a1 = smoothstep(-0.06, 0.12, x1) * (1.0 - smoothstep(0.86, 1.04, x1));
        float x2 = 1.0 - (ang - 50.0) / 3.6;
        float a2 = smoothstep(-0.06, 0.2, x2) * (1.0 - smoothstep(0.8, 1.05, x2)) * 0.2;
        // brighter sky inside the bow, a slightly darker band between the two
        col *= 1.0 + 0.07 * k * smoothstep(41.0, 30.0, ang);
        col *= 1.0 - 0.05 * k * smoothstep(42.6, 44.0, ang) * (1.0 - smoothstep(49.0, 50.4, ang));
        vec3 b1 = bowColor(clamp(x1, 0.0, 1.0)), b2 = bowColor(clamp(x2, 0.0, 1.0));
        col = mix(col, b1 * 1.08, a1 * k * 0.58);
        col += b1 * a1 * k * 0.1;
        col = mix(col, b2 * 1.05, a2 * k * 0.55);
      }
      writeOut(col, 1.0, vec3(0.0, 0.0, 1.0), 9000.0, 0.0);
    }
  `;
  return mat(u, vs, fs, { side: THREE.BackSide, depthWrite: false });
}
