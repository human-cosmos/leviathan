import * as THREE from 'three';
import { MRT_OUT } from './glsl.js';

// A thin drawn line: a polyline extruded in screen space, so the cable keeps a crisp pen weight
// from the lens to the far sky. Main-scene ribbons write depth and an ink id, so the body, the
// plume and the water hide them; an overlay ribbon sits on top of FX light (the beam in s28).

const MAXN = 128;

const VS = /* glsl */ `
attribute vec3 aPrev;
attribute vec3 aNext;
attribute vec2 aSW;
uniform vec2 uView;
varying float vDepth;
varying float vSide;
void main(){
  vec4 mv = viewMatrix * vec4(position, 1.0);
  vec4 c = projectionMatrix * mv;
  vec4 a = projectionMatrix * viewMatrix * vec4(aPrev, 1.0);
  vec4 b = projectionMatrix * viewMatrix * vec4(aNext, 1.0);
  vec2 d = (b.xy / b.w - a.xy / a.w) * uView;
  float l = length(d);
  d = l > 1e-5 ? d / l : vec2(1.0, 0.0);
  c.xy += vec2(-d.y, d.x) * aSW.x * aSW.y / uView * c.w;
  vDepth = -mv.z;
  vSide = aSW.x;
  gl_Position = c;
}`;

const FS_MAIN = /* glsl */ `
${MRT_OUT}
uniform vec3 uColor, uLite;
uniform float uId;
varying float vDepth;
varying float vSide;
void main(){
  // one hard highlight down the sunward edge of the wire
  vec3 col = vSide > 0.45 ? uLite : uColor;
  writeOut(col, 1.0, vec3(0.0, 0.0, 1.0), vDepth, uId);
}`;

const FS_OVER = /* glsl */ `
layout(location = 0) out vec4 oColor;
uniform vec3 uColor, uLite;
uniform float uAlpha;
varying float vDepth;
varying float vSide;
void main(){
  vec3 col = vSide > 0.45 ? uLite : uColor;
  oColor = vec4(col, uAlpha);
}`;

export function makeRibbon(ctx, opt = {}) {
  const over = !!opt.overlay;
  const g = new THREE.BufferGeometry();
  const mk = (n) => { const a = new THREE.BufferAttribute(new Float32Array(MAXN * 2 * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
  const aPos = mk(3), aPrev = mk(3), aNext = mk(3), aSW = mk(2);
  g.setAttribute('position', aPos); g.setAttribute('aPrev', aPrev); g.setAttribute('aNext', aNext); g.setAttribute('aSW', aSW);
  const idx = [];
  for (let i = 0; i < MAXN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  g.setIndex(idx);
  g.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uView: { value: new THREE.Vector2(1920, 1040) },
      uColor: { value: new THREE.Color(opt.color ?? '#10162a') },
      uLite: { value: new THREE.Color(opt.lite ?? '#3c4868') },
      uId: { value: opt.id ?? 61 },
      uAlpha: { value: 1 },
    },
    vertexShader: VS,
    fragmentShader: over ? FS_OVER : FS_MAIN,
    side: THREE.DoubleSide,
    transparent: over,
    depthTest: !over,
    depthWrite: !over,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.visible = false;
  mesh.userData.noShadow = true; mesh.userData.noReflect = true;
  if (over) { mesh.renderOrder = 25; ctx.overlay.add(mesh); } else ctx.scene.add(mesh);

  return {
    mesh,
    hide() { mesh.visible = false; },
    // pts: Vector3[]; px: full width in output pixels of the 1920 frame; width(s) optional multiplier
    set(pts, px, width) {
      const n = Math.min(pts.length, MAXN);
      if (n < 2) { mesh.visible = false; return; }
      for (let i = 0; i < n; i++) {
        const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        const w = px * (width ? width(i / (n - 1)) : 1);
        for (let j = 0; j < 2; j++) {
          const k = i * 2 + j, sd = j ? 1 : -1;
          aPos.setXYZ(k, p.x, p.y, p.z); aPrev.setXYZ(k, a.x, a.y, a.z); aNext.setXYZ(k, b.x, b.y, b.z);
          aSW.setXY(k, sd, w);
        }
      }
      aPos.needsUpdate = aPrev.needsUpdate = aNext.needsUpdate = aSW.needsUpdate = true;
      g.setDrawRange(0, (n - 1) * 6);
      mesh.visible = true;
    },
  };
}
