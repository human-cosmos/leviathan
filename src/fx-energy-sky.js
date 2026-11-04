import * as THREE from 'three';
import { smooth, invLerp, easeOut, clamp } from './util.js';

// s10: the arrow splits the sky. Seen from a ship's deck, a thick cloud deck overhead is
// torn along the arrow's path into two cliffs that roll apart.
//
// Everything is computed per sky pixel from the camera ray, in a frame aligned with the
// tear (E along it, F across it, Y up). The ray meets the underside of the deck; if that
// point lies in the gap, the ray is marched up the gap until it hits one of the cliff
// faces (billowing heightfields) or leaves through the top into open sky. So the cliffs
// converge on the vanishing point with true perspective and the camera may move.
// Shaded in gouache cel tones: white sunlit tops, lavender shadow, never murky.

const FS_VS = /* glsl */ `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function skyTearMaterial() {
  const u = {
    uSceneData: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
    uTan: { value: new THREE.Vector2(1, 1) }, uRot: { value: new THREE.Matrix3() },
    uE: { value: new THREE.Vector3(0, 0, -1) }, uLat: { value: 0 },
    uOpen: { value: 0 }, uZip: { value: 0 }, uFlash: { value: 0 }, uRoll: { value: 0 }, uAlpha: { value: 1 },
  };
  const fs = /* glsl */ `
    uniform sampler2D uSceneData;
    uniform vec2 uRes, uTan;
    uniform mat3 uRot;
    uniform vec3 uE;
    uniform float uOpen, uZip, uFlash, uRoll, uLat, uAlpha;
    out vec4 oColor;
    const float H0 = 1.0, H1 = 8.0;
    vec2 h22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
    float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
      return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
    float puff(vec2 p){
      vec2 i = floor(p), f = fract(p); float m = 9.0;
      for(int y = -1; y <= 1; y++) for(int x = -1; x <= 1; x++){
        vec2 g = vec2(float(x), float(y));
        vec2 o = h22(i + g);
        float r = 0.55 + 0.45 * o.x;
        vec2 d = g + o - f;
        m = min(m, length(d) / r);
      }
      return 1.0 - clamp(m, 0.0, 1.0);   // rounded dome per cell
    }
    float billow(vec2 p){ return 0.72 * sqrt(max(puff(p), 0.0)) + 0.24 * sqrt(max(puff(p * 2.3 + 7.1), 0.0)) + 0.05 * puff(p * 5.3 + 3.3); }
    float openAt(float v){ return uOpen * smoothstep(uZip + 2.0, uZip - 1.0, v); }
    float wallG(float v, float h, float side, out float b){
      vec2 p = vec2(v * 0.46 + side * 3.7 + uRoll * 0.2, h * 0.8 - uRoll * 0.5 + side * 1.9);
      b = billow(p);
      float o = openAt(v);
      return o + (b - 0.55) * min(o * 1.3, 0.26);
    }
    vec3 ramp(float x, vec3 a, vec3 b, vec3 c, vec3 d){
      // four painted tones with hard-ish steps
      vec3 col = mix(a, b, smoothstep(0.26, 0.31, x));
      col = mix(col, c, smoothstep(0.5, 0.55, x));
      return mix(col, d, smoothstep(0.74, 0.79, x));
    }
    void main(){
      vec2 uv = gl_FragCoord.xy / uRes;
      float sd = texture(uSceneData, uv).b;
      if(sd > 0.01 && sd < 6000.0) discard;
      vec3 rv = vec3((uv * 2.0 - 1.0) * uTan, -1.0);
      vec3 rd = normalize(uRot * rv);
      if(rd.y < 0.004) discard;
      vec3 Y = vec3(0.0, 1.0, 0.0);
      vec3 F = normalize(cross(uE, Y));
      float ku = dot(rd, F) / rd.y, kv = dot(rd, uE) / rd.y;
      float u0 = ku * H0 - uLat, v0 = kv * H0;
      float side = u0 > 0.0 ? 1.0 : -1.0;
      float b0;
      float g0 = wallG(v0, H0, side, b0);
      float haze = 1.0 - exp(-max(v0, 0.0) * 0.042);
      vec3 hazeC = vec3(0.90, 0.94, 1.0);
      vec3 col;
      float glowEdge = 0.0;
      bool under = abs(u0) >= g0;
      float hit = -1.0, bh = 0.0;
      if(!under){
        const int N = 26;
        float prev = H0;
        for(int i = 1; i <= N; i++){
          float k = float(i) / float(N);
          float h = H0 + (H1 - H0) * k * sqrt(k);
          float bb, g = wallG(kv * h, h, side, bb);
          if(abs(ku * h - uLat) > g){
            float lo = prev, hi = h;
            for(int j = 0; j < 4; j++){
              float m = 0.5 * (lo + hi);
              float gm = wallG(kv * m, m, side, bb);
              if(abs(ku * m - uLat) > gm) hi = m; else lo = m;
            }
            hit = hi; bh = bb;
            break;
          }
          prev = h;
        }
      }
      if(under){
        // ---- underside of the deck: mammatus lumps in lavender, sunlit toward the tear
        vec2 q = vec2(u0 - side * uOpen * 0.9, v0 * 0.9) * 1.25;
        float detail = 1.0 - smoothstep(9.0, 34.0, v0);
        float e = 0.05;
        float h = billow(q + 1.3), hx = billow(q + vec2(e, 0.0) + 1.3), hz = billow(q + vec2(0.0, e) + 1.3);
        vec3 N = normalize(vec3(-(hx - h) / e * 0.42 * detail, 1.0, -(hz - h) / e * 0.42 * detail));
        float big = vn(q * 0.19 + 11.0);
        vec3 L = normalize(vec3(-u0 / (abs(u0) + 0.7) * 0.55, 0.55, -0.62));
        float tone = dot(N, L) * 0.62 + 0.14;
        tone += (big - 0.5) * 0.42 + (h - 0.5) * 0.34 * detail + (vn(q * 2.1) - 0.5) * 0.05;
        float near = exp(-max(abs(u0) - g0, 0.0) * 5.5) * smoothstep(0.0, 0.05, uOpen);
        // the deck lights up along the crack just before it gives way (ref 15.4)
        float kink = abs(u0 + 0.05 * (vn(vec2(v0 * 1.7, 3.0)) - 0.5) + 0.02 * (vn(vec2(v0 * 6.0, 7.0)) - 0.5));
        float crack = (exp(-kink * 26.0) * 0.8 + exp(-kink * 6.0) * 0.26) * uFlash * smoothstep(uZip + 3.0, uZip - 1.0, v0);
        near = max(near, crack);
        tone += near * 0.45;
        col = ramp(tone, vec3(0.20, 0.26, 0.62), vec3(0.30, 0.37, 0.76), vec3(0.47, 0.54, 0.88), vec3(0.78, 0.82, 0.98));
        col = mix(col, vec3(1.0, 1.0, 1.0), near * near * near * 0.6);
        col = mix(col, hazeC * vec3(0.8, 0.84, 0.95), haze);
      } else if(hit > 0.0){
        // ---- a cliff of cloud
        float h = hit, v = kv * h;
        float bb, e = 0.07;
        float g = wallG(v, h, side, bb);
        float gv = wallG(v + e * 3.0, h, side, bb), gh = wallG(v, h + e, side, bb);
        float o = max(uOpen, 0.02);
        vec3 N = normalize(F * (-side) + uE * ((gv - g) / (e * 3.0)) * 6.0 + Y * ((gh - g) / e) * 6.0);
        vec3 L = normalize(Y * 0.84 + uE * 0.42 + F * (-side) * 0.34);
        float tone = dot(N, L) * 0.5 + 0.5;
        float hk = clamp((h - H0) / (H1 - H0), 0.0, 1.0);
        tone = tone * 0.74 + (pow(hk, 0.55) - 0.5) * 0.62 + (bh - 0.55) * 0.7 + 0.08;
        tone += 0.13;
        col = ramp(tone, vec3(0.36, 0.43, 0.82), vec3(0.58, 0.65, 0.93), vec3(0.86, 0.90, 1.0), vec3(1.06, 1.06, 1.08));
        col = mix(col, hazeC, haze * 0.6);
      } else {
        // ---- open sky through the gap: deep cobalt overhead, blazing toward the horizon
        float el = rd.y;
        vec3 deep = vec3(0.07, 0.30, 0.82), mid = vec3(0.26, 0.62, 0.97), pale = vec3(0.86, 0.96, 1.0);
        col = mix(pale, mid, smoothstep(0.03, 0.34, el));
        col = mix(col, deep, smoothstep(0.34, 0.86, el));
        float c = abs(ku * H1 - uLat) / max(uOpen, 0.02);
        col = mix(vec3(1.0, 1.0, 1.0) * 1.1, col, smoothstep(0.0, 0.35, 1.0 - smoothstep(0.0, 1.0, 1.0 - c) * uFlash));
      }
      col += vec3(0.25, 0.55, 1.0) * uFlash * 0.06;
      // a pale band where the deck dissolves into the horizon
      float fade = smoothstep(0.004, 0.05, rd.y);
      oColor = vec4(col * fade * uAlpha, fade * uAlpha);
    }
  `;
  const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: FS_VS, fragmentShader: fs, transparent: true, depthTest: false, depthWrite: false });
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.premultipliedAlpha = true;
  return m;
}

export function createSkyTear(ctx) {
  const mat = skyTearMaterial();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false;
  ctx.overlay.add(mesh);
  const E = new THREE.Vector3(), f = new THREE.Vector3(), n3 = new THREE.Matrix3();
  const api = {
    mesh, E,
    // deck heights are in units of H; the lines of the streak are drawn in metres
    H: 170,
    update(st, cam) {
      const t = st.t, c = st.cues;
      const zip0 = c.cloudSplit + 0.36, open0 = c.cloudSplit + 0.56;
      const U = mat.uniforms;
      // the tear runs away from the camera toward the horizon, slightly left of centre
      f.set(0, 0, -1).applyQuaternion(cam.quaternion);
      f.y = 0;
      if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
      f.normalize();
      const yaw = api.yaw ?? 0.05;
      E.copy(f).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      U.uE.value.copy(E);
      n3.setFromMatrix4(cam.matrixWorld);
      U.uRot.value.copy(n3);
      const ty = Math.tan((cam.fov * Math.PI) / 360);
      U.uTan.value.set(ty * cam.aspect, ty);
      U.uZip.value = 0.4 + 46 * smooth(invLerp(zip0, zip0 + 0.3, t));
      U.uOpen.value = 0.085 * smooth(invLerp(open0 - 0.05, open0 + 0.22, t)) + 0.52 * easeOut(invLerp(open0, c.cloudSplit + 2.3, t), 2.4);
      U.uRoll.value = clamp(t - zip0, 0, 3) * 0.55;
      const fl = t >= zip0 ? Math.exp(-Math.max(0, t - zip0 - 0.3) * 3.2) : 0;
      U.uFlash.value = fl;
      mesh.visible = true;
    },
    hide() { mesh.visible = false; },
  };
  return api;
}
