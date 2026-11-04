import * as THREE from 'three';
import { G, COMMON, MRT_OUT } from './glsl.js';

// Drawn big-water toolkit. Everything is rebuilt each frame from state.t alone.
//   PuffBatch  : impostor billows / tongues / drops in the main scene. They write real depth,
//                so they intersect whales, hulls and each other like solid clay, and the
//                engine's ink pass finds their silhouettes and creases. Cel tones are hard.
//   SheetBatch : long strips of pouring water (streaked, tearing into strands), main scene.
//   DecalBatch : foam on the sea: wakes, boil discs, broken rings (overlay, over the water pass).
//   MistBatch  : soft spray billows (overlay, depth-soft).
//   Ripples    : the 12 ring slots of the water pass.

export function hash(a, b = 0, c = 0) {
  let h = Math.imul((a * 7919) | 0, 0x27d4eb2d) ^ Math.imul((b * 104729) | 0, 0x165667b1) ^ Math.imul((c * 15485863) | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const hr = (a, b, c, lo, hi) => lo + (hi - lo) * hash(a, b, c);

// ink ids: 80–99 inked, 100+ no ink
export const ID = { MASS: 81, MASS2: 83, TONGUE: 85, SHEET: 87, DROP: 112, SILT: 113, BUBBLE: 114 };
export const KIND = { PUFF: 0, TONGUE: 1, DROP: 2, BUBBLE: 3, CHUNK: 4 };
export const PAL = { WATER: 0, SILT: 1, DUST: 2, SEAFOAM: 3, UNDERWATER: 4 };

const glslHelpers = /* glsl */ `
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
`;

// palette rows: hi, lit, shade, deep
const PALETTE = [
  // sea white: clean paper white, sky-blue shade, deep cobalt under the masses
  ['#ffffff', '#f8fcff', '#8fbcf2', '#3f74d6'],
  // silt on the sea floor: pale aqua-sand with teal shade
  ['#d9f4ec', '#a9dcd3', '#5cabb4', '#2f7a93'],
  // rock dust in bright water
  ['#e5ecd6', '#b4c6b4', '#6f9a9e', '#3f6f82'],
  // sea foam over the green sea
  ['#ffffff', '#e4fbf8', '#83d6d6', '#2fa0b4'],
  // water in water: pale cyan clouds of bubbles and churn
  ['#f4ffff', '#c6f6fb', '#6fd2e6', '#2f9bc9'],
];

function palUniform() {
  const out = [];
  for (const row of PALETTE) for (const c of row) out.push(new THREE.Color(c).convertLinearToSRGB());
  return out;
}
// the colours above are authored directly in display space (the engine works in display space)
function palValues() {
  const out = [];
  for (const row of PALETTE) for (const c of row) { const n = parseInt(c.slice(1), 16); out.push(new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)); }
  return out;
}

// ------------------------------------------------------------------ puffs
export function puffMaterial(S) {
  const u = { ...G, uS: { value: S }, uPal: { value: palValues() }, uDrawing: { value: 0 } };
  const vs = /* glsl */ `
    attribute vec3 iPos;
    uniform vec3 uKeyDir;
    attribute vec4 iS;    // radius (m), length along iDir (m), tip ratio, lumpiness
    attribute vec3 iDir;  // world direction of the tongue
    attribute vec4 iK;    // seed, tone (+ = further into shade), fade 0..1, kind
    attribute vec3 iM;    // palette, ink id, ink depth (m): one value per mass so ink falls between shapes, not puffs
    varying vec2 vP;
    varying vec3 vShape;  // len (in radii), tip ratio, lump
    varying vec4 vK;
    varying vec3 vM;
    varying vec4 vC;      // view centre, radius
    varying vec4 vAxes;   // screen axes of the sprite
    varying vec3 vL;      // light in view space
    varying float vWorldY;
    void main(){
      vec4 c = viewMatrix * vec4(iPos, 1.0);
      vec3 dv = mat3(viewMatrix) * iDir;
      float sl = length(dv.xy);
      vec2 ey = sl > 1e-3 ? dv.xy / sl : vec2(0.0, 1.0);
      vec2 ex = vec2(ey.y, -ey.x);
      float r = max(iS.x, 1e-3);
      float len = iS.y * sl / r;
      float m = 1.06 + iS.w * 0.55;
      vec2 q = position.xy * 2.0;
      vec2 L = vec2(q.x * m, (q.y * 0.5 + 0.5) * (len + 2.0 * m) - m);
      vP = L; vShape = vec3(len, iS.z, iS.w); vK = iK; vM = iM;
      vC = vec4(c.xyz, r); vAxes = vec4(ex, ey);
      vec3 sun = normalize(mat3(viewMatrix) * uKeyDir);
      // drawn light: mostly from the upper left of the frame, so every mass has its shade side
      vL = normalize(mix(sun, normalize(vec3(-0.52, 0.72, 0.46)), 0.62));
      vec3 mv = c.xyz + vec3((ex * L.x + ey * L.y) * r, 0.0);
      vWorldY = (transpose(mat3(viewMatrix)) * (mv - c.xyz)).y + iPos.y;
      gl_Position = projectionMatrix * vec4(mv, 1.0);
    }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    ${glslHelpers}
    uniform mat4 projectionMatrix;
    uniform vec3 uPal[20];
    uniform float uS, uDrawing;
    varying vec2 vP;
    varying vec3 vShape;
    varying vec4 vK;
    varying vec3 vM;
    varying vec4 vC;
    varying vec4 vAxes;
    varying vec3 vL;
    varying float vWorldY;
    void main(){
      if(uPass > 1.5 && vWorldY < uWaterLevel - 0.02) discard;
      if(uPass > 0.5 && uPass < 1.5){ oColor = vec4(1.0); oData = vec4(0.0); return; }
      float seed = vK.x, tone = vK.y, fade = vK.z, kind = vK.w;
      float len = vShape.x, tip = vShape.y, lump = vShape.z;
      vec2 P = vP;
      int pal = int(vM.x + 0.5);
      vec3 cHi = uPal[pal * 4], cLit = uPal[pal * 4 + 1], cSh = uPal[pal * 4 + 2], cDeep = uPal[pal * 4 + 3];
      // the drawing boils a little from one cel to the next
      float boil = mod(uDrawing, 16.0) * 0.19;
      vec2 wob = vec2(vnoise(P * 1.25 + seed * 7.13 + boil), vnoise(P * 1.25 + seed * 3.31 + 9.0 - boil)) - 0.5;
      vec2 wob2 = vec2(vnoise(P * 3.1 + seed * 2.1), vnoise(P * 3.1 + seed * 5.3 + 4.0)) - 0.5;
      vec2 Q = P + wob * lump * 0.95 + wob2 * lump * 0.34;
      float h = len > 1e-3 ? clamp(Q.y / len, 0.0, 1.0) : 0.0;
      vec2 pa = Q - vec2(0.0, h * len);
      float rr = mix(1.0, tip, h);
      vec2 ns = pa / max(rr, 1e-3);
      float d = length(pa) - rr;
      // cauliflower: the outline is a run of small round lobes, like drawn surf and cumulus
      if(kind < 0.5){
        float ang = atan(ns.y, ns.x) + wob.x * 1.2;
        float nl = 5.0 + floor(mod(seed * 3.7, 5.0));
        d -= lump * 0.34 * (abs(sin(ang * nl * 0.5 + seed * 2.1)) - 0.55) * smoothstep(0.35, 0.95, length(ns));
      }
      if(kind > 2.5 && kind < 3.5){
        // bubble: thin bright rim, clear inside
        float rim = abs(length(P) - 0.86);
        if(length(P) > 1.0) discard;
        float px = fwidth(P.x);
        float inside = 1.0 - smoothstep(0.0, 0.1, rim - 0.04);
        vec2 hs = P - vec2(-0.34, 0.4);
        float spot = step(dot(hs, hs), 0.05);
        vec2 hs2 = P - vec2(0.36, -0.38);
        float spot2 = step(dot(hs2, hs2), 0.018);
        float a = max(max(inside, spot), spot2);
        if(a < 0.5) discard;
        vec3 col = spot + spot2 > 0.5 ? cHi : mix(cSh, cLit, 0.55);
        float zv = vC.z + 0.5 * vC.w;
        vec4 clip = projectionMatrix * vec4(vC.xy, zv, 1.0);
        gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
        writeOut(col, 1.0, vec3(0.0, 0.0, 1.0), -zv, vM.y);
        return;
      }
      if(d > 0.0) discard;
      float z = sqrt(max(1.0 - min(dot(ns, ns), 1.0), 0.0));
      // hard dissolve: the drawn mass breaks into chunks and holes as it dies
      if(fade > 0.001){
        float n = fbm2(P * 1.35 + seed * 5.7);
        float edge = fade * 1.02 - (z * 0.18);
        if(n * 1.25 < edge) discard;
      }
      vec3 nv = vec3(vAxes.xy * ns.x + vAxes.zw * ns.y, z + 0.05);
      nv.xy += (wob + wob2 * 0.7) * (kind < 1.5 ? 0.95 : 0.35);
      nv = normalize(nv);
      float ndl = dot(nv, vL);
      float brush = fbm2(P * 1.05 + seed * 9.0 + wob * 0.8) - 0.5;
      float s = ndl + brush * 0.55 - tone;
      vec3 col;
      if(kind > 1.5 && kind < 2.5){
        // drop: body, shade crescent, hard highlight
        col = s > -0.15 ? cLit : cSh;
        vec2 hp = P - vec2(-0.3, 0.3);
        if(dot(hp, hp) < 0.06) col = cHi;
      } else {
        col = cLit;
        if(s > 0.7) col = cHi;
        if(s < 0.1) col = cSh;
        if(s < -0.42) col = cDeep;
      }
      // the sea colours the underside of what stands in it
      float zv = vC.z + z * vC.w * rr;
      vec4 clip = projectionMatrix * vec4(vC.xy + (vAxes.xy * P.x + vAxes.zw * P.y) * vC.w, zv, 1.0);
      gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
      writeOut(col, 1.0, normalize(vec3(nv.xy * 0.42, 1.0)), vM.z > 0.0 ? vM.z : -zv, vM.y);
    }
  `;
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs, side: THREE.DoubleSide, transparent: false });
}

export class PuffBatch {
  constructor(material, max) {
    this.max = max;
    const g = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    const A = (n, s) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * s), s); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.aPos = A('iPos', 3); this.aS = A('iS', 4); this.aDir = A('iDir', 3); this.aK = A('iK', 4); this.aM = A('iM', 3);
    this.inkZ = 0;   // set by the emitters: the mass the next puffs belong to
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.userData.noShadow = true;
    this.n = 0;
  }
  begin() { this.n = 0; this.inkZ = 0; }
  // position, radius, tongue length, tip ratio, lump, direction, seed, tone, fade, kind, palette, ink id
  push(x, y, z, r, len, tip, lump, dx, dy, dz, seed, tone, fade, kind, pal, id) {
    if (this.n >= this.max) return;
    const i = this.n++;
    let a = this.aPos.array; a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z;
    a = this.aS.array; a[i * 4] = r; a[i * 4 + 1] = len; a[i * 4 + 2] = tip; a[i * 4 + 3] = lump;
    a = this.aDir.array; a[i * 3] = dx; a[i * 3 + 1] = dy; a[i * 3 + 2] = dz;
    a = this.aK.array; a[i * 4] = seed; a[i * 4 + 1] = tone; a[i * 4 + 2] = fade; a[i * 4 + 3] = kind;
    a = this.aM.array; a[i * 3] = pal; a[i * 3 + 1] = id; a[i * 3 + 2] = this.inkZ;
  }
  end() {
    this.geo.instanceCount = this.n;
    for (const a of [this.aPos, this.aS, this.aDir, this.aK, this.aM]) { a.needsUpdate = true; a.clearUpdateRanges?.(); }
    this.mesh.visible = this.n > 0;
  }
}

// ------------------------------------------------------------------ sheets
export function sheetMaterial(S) {
  const u = { ...G, uS: { value: S }, uPal: { value: palValues() } };
  const vs = /* glsl */ `
    attribute vec3 aTan;
    attribute vec3 aSide;    // fixed across direction, or zero to face the camera
    attribute vec4 aR;       // across -1..1, along (m), half width (m), seed
    attribute vec4 aR2;      // total length (m), flow phase (m), tear amount, tone
    varying vec2 vA;
    varying vec4 vR;
    varying vec4 vR2;
    varying float vWorldY;
    varying float vDepth;
    varying vec3 vN;
    void main(){
      vec3 toC = cameraPosition - position;
      vec3 side = length(aSide) > 0.01 ? aSide : normalize(cross(aTan, toC) + vec3(1e-5));
      vec3 wp = position + side * aR.x * aR.z;
      vA = vec2(aR.x, aR.y);
      vR = aR; vR2 = aR2;
      vWorldY = wp.y;
      vec4 mv = viewMatrix * vec4(wp, 1.0);
      vDepth = -mv.z;
      vN = normalize(mat3(viewMatrix) * normalize(cross(side, aTan)));
      gl_Position = projectionMatrix * mv;
    }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    uniform vec3 uPal[20];
    varying vec2 vA;
    varying vec4 vR;
    varying vec4 vR2;
    varying float vWorldY;
    varying float vDepth;
    varying vec3 vN;
    void main(){
      if(uPass > 1.5 && vWorldY < uWaterLevel - 0.02) discard;
      if(uPass > 0.5 && uPass < 1.5){ oColor = vec4(1.0); oData = vec4(0.0); return; }
      float a = vA.x, s = vA.y;
      float hw = vR.z, seed = vR.w;
      float L = vR2.x, flow = vR2.y, tear = vR2.z, tone = vR2.w;
      float k = clamp(s / L, 0.0, 1.0);
      float sc = max(hw, 0.5);
      vec2 uvA = vec2(a * 2.6 + seed * 7.3, (s - flow) / (sc * 30.0));
      float n1 = fbm2(uvA);
      float n2 = vnoise(vec2(a * 7.5 + seed * 3.1, (s - flow) / (sc * 14.0)));
      float n3 = vnoise(vec2(a * 2.2 + seed, (s - flow * 0.6) / (sc * 7.0)));
      // ragged edges, a blunt root, tongues at the far end
      float rootK = smoothstep(0.0, 0.09 + 0.09 * n3, k);
      float edge = (0.92 - 0.45 * n3 * smoothstep(0.0, 0.5, k) - 0.08 * n2) * mix(0.06, 1.0, rootK);
      if(abs(a) > edge) discard;
      if(k < 0.006 + 0.03 * n2) discard;
      float end = 1.0 - (0.34 * vnoise(vec2(a * 4.0 + seed * 2.0, seed)) + 0.12 * n2);
      if(k > end) discard;
      // tears into strands as it falls
      float rip = tear * smoothstep(0.12, 1.0, k);
      float strand = n1 * 0.7 + n2 * 0.3;
      if(strand < rip * 0.62) discard;
      // tones: white body, blue running streaks, shade on one side
      vec3 cHi = uPal[0], cLit = uPal[1], cSh = uPal[2], cDeep = uPal[3];
      float v = strand - tone * 0.5 + 0.22 * a * -1.0;
      vec3 col = cLit;
      if(v > 0.60) col = cHi;
      if(v < 0.455) col = cSh;
      if(v < 0.335) col = cDeep;
      writeOut(col, 1.0, normalize(vec3(a * 0.5, 0.0, 1.0)), vDepth, 87.0 + mod(seed * 3.0, 2.0) * 0.0);
    }
  `;
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs, side: THREE.DoubleSide, transparent: false });
}

export class SheetBatch {
  constructor(material, maxR, seg = 14) {
    this.maxR = maxR; this.seg = seg;
    const nv = maxR * seg * 2;
    const g = new THREE.BufferGeometry();
    const A = (n, s) => { const a = new THREE.BufferAttribute(new Float32Array(nv * s), s); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.pos = A('position', 3); this.tan = A('aTan', 3); this.side = A('aSide', 3); this.r = A('aR', 4); this.r2 = A('aR2', 4);
    const idx = [];
    for (let k = 0; k < maxR; k++) {
      const o = k * seg * 2;
      for (let i = 0; i < seg - 1; i++) { const a = o + i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
    }
    g.setIndex(idx);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.userData.noShadow = true;
    this.n = 0;
  }
  begin() { this.n = 0; }
  // fn(u, out) gives the centre line at u in 0..1; hw(u) the half width; side = fixed across vector or null
  push(fn, hwF, seed, flow, tear, tone, side = null) {
    if (this.n >= this.maxR) return;
    const k = this.n++, seg = this.seg;
    const P = _pts;
    let L = 0;
    for (let i = 0; i < seg; i++) { fn(i / (seg - 1), P[i]); if (i) L += P[i].distanceTo(P[i - 1]); }
    let acc = 0;
    for (let i = 0; i < seg; i++) {
      if (i) acc += P[i].distanceTo(P[i - 1]);
      const a = P[Math.max(i - 1, 0)], b = P[Math.min(i + 1, seg - 1)];
      let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      const hw = hwF(i / (seg - 1));
      for (let sd = 0; sd < 2; sd++) {
        const v = (k * seg + i) * 2 + sd;
        this.pos.array.set([P[i].x, P[i].y, P[i].z], v * 3);
        this.tan.array.set([tx, ty, tz], v * 3);
        if (side) this.side.array.set([side.x, side.y, side.z], v * 3); else this.side.array.set([0, 0, 0], v * 3);
        this.r.array.set([sd ? 1 : -1, acc, hw, seed], v * 4);
        this.r2.array.set([L, flow, tear, tone], v * 4);
      }
    }
  }
  end() {
    this.geo.setDrawRange(0, this.n * (this.seg - 1) * 6);
    for (const a of [this.pos, this.tan, this.side, this.r, this.r2]) a.needsUpdate = true;
    this.mesh.visible = this.n > 0;
  }
}
const _pts = Array.from({ length: 64 }, () => new THREE.Vector3());

// ------------------------------------------------------------------ foam decals on the sea (overlay)
export function decalMaterial(S) {
  const u = { uSceneData: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: G.uTime, uDrawing: { value: 0 }, uLevel: G.uWaterLevel,
    uFoam: { value: new THREE.Color('#ffffff') }, uLace: { value: new THREE.Color('#c9f2f4') } };
  const vs = /* glsl */ `
    attribute vec4 iP;   // x, z, heading, height offset
    attribute vec4 iD;   // half width, half length, kind, seed
    attribute vec4 iE;   // strength, age, extra, extra
    varying vec2 vQ;
    varying vec2 vDim;
    varying vec4 vA;
    varying vec4 vE;
    varying float vDepth;
    varying vec3 vWorld;
    void main(){
      float ch = cos(iP.z), sh = sin(iP.z);
      vec2 l = position.xy * 2.0 * iD.xy;     // local metres
      vQ = l; vDim = iD.xy; vA = iD; vE = iE;
      // forward = (sin h, cos h) like the water pass; local +y runs forward
      vec3 w = vec3(iP.x + l.x * ch + l.y * sh, iP.w, iP.y - l.x * sh + l.y * ch);
      vWorld = w;
      vec4 mv = viewMatrix * vec4(w, 1.0);
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }
  `;
  const fs = /* glsl */ `
    uniform sampler2D uSceneData;
    uniform vec2 uRes;
    uniform float uTime, uDrawing, uLevel;
    uniform vec3 uFoam, uLace;
    varying vec2 vQ;
    varying vec2 vDim;
    varying vec4 vA;
    varying vec4 vE;
    varying float vDepth;
    varying vec3 vWorld;
    out vec4 oColor;
    float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
      return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
    float fb(vec2 p){ float s = 0., a = .5; for(int i = 0; i < 4; i++){ s += a*vn(p); p = p*2.03 + vec2(1.7, 9.2); a *= .5; } return s / 0.9375; }
    void main(){
      float sceneD = texture(uSceneData, gl_FragCoord.xy / uRes).b;
      if(sceneD > 0.0 && vDepth > sceneD + 2.0) discard;
      float kind = vA.z, seed = vA.w, str = vE.x, age = vE.y;
      vec2 q = vQ;
      float a = 0.0, b = 0.0;   // a: solid foam, b: lace
      if(kind < 0.5){
        // wake: q.y runs forward from the stern-end of the quad; distance astern from the top of the quad
        float L = vDim.y * 2.0, W = vDim.x;
        float back = vDim.y - q.y;         // 0 at the stern, L at the far end
        float u = back / L;
        float v = abs(q.x);
        float w0 = vE.z;                    // half beam of the ship
        float w = w0 * (0.8 + 1.5 * sqrt(u));
        vec2 uvw = vec2(q.x, back * 0.55 - uTime * 2.0) / (w0 * 0.55);
        float n = fb(uvw + seed);
        float n2 = fb(uvw * 2.6 + seed * 3.0);
        float core = smoothstep(0.0, 0.1, (w - v + (n - 0.5) * w0 * 2.2) / w0);
        a = core * step(0.34 + 0.46 * u, n2 + 0.12);
        b = core * step(0.3 + 0.3 * u, n) * smoothstep(1.0, 0.45, u);
        // Kelvin arms with feathery breaks
        float armPos = w0 * 1.2 + back * 0.33;
        float arm = abs(v - armPos);
        float thick = w0 * (0.22 + 0.45 * u);
        float feather = fb(vec2(back / (w0 * 1.2), q.x / (w0 * 0.5)) + seed * 1.7);
        float armM = step(arm + (feather - 0.5) * thick * 2.4, thick) * smoothstep(1.0, 0.25, u);
        a = max(a, armM * step(0.42 + 0.2 * u, feather));
        b = max(b, armM * 0.8);
        a *= step(0.0, back); b *= step(0.0, back);
      } else if(kind < 1.5){
        // boil disc: solid white churn inside, lace thrown outward, soft broken rim
        float r = length(q) / vDim.x;
        vec2 uvb = q / (vDim.x * 0.16) + seed * 3.0;
        float n = fb(uvb + vec2(uDrawing * 0.11, -uDrawing * 0.07));
        float n2 = fb(uvb * 2.4 + seed);
        float grow = vE.z > 0.0 ? vE.z : 1.0;
        float rn = r / grow;
        a = step(0.34 + 0.56 * smoothstep(0.05, 1.0, rn), n + 0.07) * step(rn, 1.0);
        b = step(0.52 + 0.26 * rn, n2) * step(rn, 1.0) * 0.6;
      } else if(kind < 2.5){
        // broken foam ring expanding across the sea
        float r = length(q);
        float R = vE.z;
        float th = atan(q.y, q.x);
        float n = fb(vec2(th * 7.0, seed) + vec2(r / (vDim.x * 0.05), 0.0));
        float rr = abs(r - R) / (R * 0.06 + vDim.x * 0.008);
        a = step(rr + (n - 0.5) * 2.6, 0.55);
        b = step(rr * 0.42 + (n - 0.5) * 1.6, 0.6) * step(r, R * 1.02);
      } else {
        // long foam streaks combed in one direction
        float n = fb(vec2(q.x / (vDim.x * 0.08), q.y / (vDim.y * 0.5)) + seed);
        float e = smoothstep(1.0, 0.7, length(q / vDim));
        a = step(0.62, n * e + 0.12); b = step(0.5, n * e + 0.1);
      }
      a *= str; b *= str * 0.5;
      float o = max(a, b);
      if(o < 0.01) discard;
      vec3 c = a > 0.5 ? uFoam : uLace;
      oColor = vec4(c, max(a, b));
    }
  `;
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs,
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
}

// ------------------------------------------------------------------ soft spray (overlay)
export function mistMaterial() {
  const u = { uSceneData: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uDrawing: { value: 0 },
    uTop: { value: new THREE.Vector3(1.0, 1.0, 1.0) }, uBot: { value: new THREE.Vector3(0.70, 0.84, 0.98) } };
  const vs = /* glsl */ `
    attribute vec3 iPos;
    attribute vec4 iS;   // size x, size y, seed, opacity
    attribute vec4 iC;   // softness (m), rotation, tone, hardness
    varying vec2 vQ;
    varying vec4 vS;
    varying vec4 vC;
    varying float vDepth;
    void main(){
      vec4 mv = viewMatrix * vec4(iPos, 1.0);
      vDepth = -mv.z;
      vec2 q = position.xy * 2.0;
      float r = iC.y;
      vec2 o = mat2(cos(r), sin(r), -sin(r), cos(r)) * (q * iS.xy);
      mv.xy += o;
      vQ = q; vS = iS; vC = iC;
      gl_Position = projectionMatrix * mv;
    }
  `;
  const fs = /* glsl */ `
    uniform sampler2D uSceneData;
    uniform vec2 uRes;
    uniform float uDrawing;
    uniform vec3 uTop, uBot;
    varying vec2 vQ;
    varying vec4 vS;
    varying vec4 vC;
    varying float vDepth;
    out vec4 oColor;
    float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
      return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
    float fb(vec2 p){ float s = 0., a = .5; for(int i = 0; i < 5; i++){ s += a*vn(p); p = p*2.03 + vec2(1.7, 9.2); a *= .5; } return s / 0.96875; }
    void main(){
      vec2 q = vQ;
      float seed = vS.z, op = vS.w;
      float n = fb(q * 1.3 + seed * 7.0 + vec2(uDrawing * 0.02, 0.0));
      float r = length(q);
      float body = 1.0 - r + (n - 0.5) * 1.05;
      float hard = vC.w;
      float a = smoothstep(0.0, mix(0.55, 0.06, hard), body);
      float sceneD = texture(uSceneData, gl_FragCoord.xy / uRes).b;
      float soft = clamp((sceneD - vDepth) / vC.x, 0.0, 1.0);
      a *= soft * op;
      if(a < 0.004) discard;
      float sh = smoothstep(-0.4, 0.5, q.y + q.x * -0.4 + (n - 0.5) * 1.2) - vC.z;
      vec3 c = mix(uBot, uTop, clamp(sh, 0.0, 1.0));
      oColor = vec4(c, a);
    }
  `;
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs,
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
}

export class QuadBatch {
  constructor(material, max, attrs) {
    this.max = max;
    const g = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    this.list = [];
    for (const [name, size] of Object.entries(attrs)) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      this.list.push([a, size]);
    }
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.userData.noShadow = true;
    this.mesh.userData.noReflect = true;
    this.n = 0;
  }
  begin() { this.n = 0; }
  push(...vals) {
    if (this.n >= this.max) return;
    const i = this.n++;
    for (let k = 0; k < this.list.length; k++) {
      const [a, size] = this.list[k];
      const v = vals[k];
      for (let c = 0; c < size; c++) a.array[i * size + c] = v[c] ?? 0;
    }
  }
  end() {
    this.geo.instanceCount = this.n;
    for (const [a] of this.list) { a.needsUpdate = true; a.clearUpdateRanges?.(); }
    this.mesh.visible = this.n > 0;
  }
}

// ring slots of the water pass, strongest wins
export class Ripples {
  constructor(uniforms) { this.u = uniforms; this.list = []; }
  begin() { this.list.length = 0; }
  add(now, x, z, t0, amp, speed, width, decay, foam = 1, prio = 1) {
    const age = now - t0;
    if (age <= 0) return;
    const env = amp * Math.exp(-age * decay);
    if (env < 0.05) return;
    this.list.push({ x, z, t0, amp, speed, width, decay, foam, score: env * prio });
  }
  end() {
    this.list.sort((a, b) => b.score - a.score);
    const R = this.u.uRip.value, B = this.u.uRipB.value;
    for (let i = 0; i < 12; i++) {
      const r = this.list[i];
      if (r) { R[i].set(r.x, r.z, r.t0, r.amp); B[i].set(r.speed, r.width, r.decay, r.foam); }
      else { R[i].set(0, 0, 0, 0); B[i].set(2, 0.4, 0.5, 0); }
    }
  }
}
void palUniform;
