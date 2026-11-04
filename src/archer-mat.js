import * as THREE from 'three';
import { G, COMMON, MRT_OUT, VERT_STD } from './glsl.js';
import { makePanelAtlas } from './textures.js';

// Anime chrome for the archer: two hard cel tones plus hard-edged painted sky
// reflections (the way mecha painters do silver), dense panel-line detail from the
// atlas, worn plate edges, and the blue charge light from the arrow.
export const CHARGE = {
  uArcA: { value: new THREE.Vector3() },   // world: nock
  uArcB: { value: new THREE.Vector3() },   // world: tip
  uCharge: { value: 0 },                   // arrow light 0..1
  uChargeFront: { value: 0 },              // how far along nock→tip the energy reached (0..1)
  uCore: { value: 0.25 },                  // chest reactor brightness
  uVisor: { value: 0.3 },
  uHeat: { value: 0 },                     // arrow inlay ember
};

export function archerMaterial(panelTex, o = {}) {
  const u = {
    ...G, ...CHARGE,
    uPanel: { value: panelTex },
    uChrome: { value: o.chrome ?? 1 },
    uFlat: G.uFlat,
  };
  if (o.heat) u.uHeat = o.heat;   // the arrow in flight carries its own ember
  const vs = /* glsl */ `
    attribute vec3 aCol;
    attribute vec4 aMat;
    attribute vec2 aEx;
    varying vec3 vCol, vLocal, vLocalN;
    varying vec4 vMat;
    varying vec2 vEx;
    ${VERT_STD}
    void main(){ vCol = aCol; vMat = aMat; vEx = aEx; vLocal = position; vLocalN = normal; stdVertex(position, normal); }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    uniform sampler2D uPanel;
    uniform float uChrome, uFlat, uCharge, uChargeFront, uCore, uVisor, uHeat;
    uniform vec3 uArcA, uArcB;
    varying vec3 vWorld, vNormalW, vNormalV, vCol, vLocal, vLocalN;
    varying vec4 vMat;
    varying vec2 vEx;
    varying float vDepth;
    varying vec2 vUv;

    // painted sky seen in the metal: hard bands, wobbling edges, never a smooth CG gradient
    vec3 chromeEnv(vec3 R, vec3 p){
      float wob = (vnoise3(p * 1.3 + 4.0) - 0.5) * 0.22;
      float e = R.y + wob;
      vec3 c;
      if(e > 0.72) c = vec3(0.56, 0.72, 0.98);          // deep sky
      else if(e > 0.36) c = vec3(0.78, 0.88, 1.03);     // blue sky
      else if(e > 0.12) c = vec3(0.97, 0.98, 0.99);     // cloud white
      else if(e > 0.02) c = vec3(1.06, 1.03, 0.96);     // horizon blaze
      else if(e > -0.10) c = vec3(0.40, 0.46, 0.66);    // the hard dark horizon line
      else if(e > -0.42) c = vec3(0.34, 0.56, 0.76);    // sea
      else c = vec3(0.74, 0.70, 0.66);                  // sunlit ground bounce
      return c;
    }

    void main(){
      if(uPass > 1.5 && vWorld.y < uWaterLevel - 0.03) discard;
      if(uPass > 0.5 && uPass < 1.5){ oColor = vec4(1); oData = vec4(0); return; }
      vec3 N = normalize(vNormalW);
      vec3 NV = normalize(vNormalV);
      if(!gl_FrontFacing){ N = -N; NV = -NV; }
      vec3 V = normalize(cameraPosition - vWorld);
      vec3 col = vCol;
      float metal = vMat.x, detail = vMat.y, emis = vMat.z, idF = floor(vMat.w + 0.5);
      float edge = vEx.x, wearK = vEx.y;
      vec3 r = vLocal;

      // ---- panel atlas: lines, hatches, bolts, stencils, tonal blocks
      vec4 d = texture(uPanel, vUv);
      float lineMask = d.a;
      col = mix(col, d.rgb * mix(vec3(1.0), col * 1.4, 0.45), d.a * detail);
      // a second, finer sheet only the close-ups see: macro shots stay dense
      float near = smoothstep(95.0, 34.0, vDepth);
      if(near > 0.001){
        vec4 d2 = texture(uPanel, vUv * 3.3 + vec2(0.37, 0.11));
        col = mix(col, d2.rgb * mix(vec3(1.0), col * 1.3, 0.5), d2.a * detail * near * 0.82);
        lineMask = max(lineMask, d2.a * near);
      }

      float weathered = 1.0 - uFlat;
      // ---- hairline scratches and scuffs
      float scuff = step(0.78, vnoise3(r * 21.0 + 2.0)) * step(0.52, fbm3(r * 2.6));
      float scratch = step(0.93, vnoise3(vec3(r.x * 42.0, r.y * 5.0, r.z * 42.0)));
      col = mix(col, col * vec3(0.8, 0.8, 0.88), max(scuff, scratch) * weathered * 0.7 * wearK);
      // ---- hard-edged grime: one step darker, purple-shifted
      float gr = fbm3(r * 1.1 + 3.1);
      col = mix(col, col * vec3(0.84, 0.84, 0.94), step(0.62, gr) * weathered * wearK * 0.8);
      // ---- chips with a pale primer rim
      float c = fbm3(r * 4.6 + 11.0) + 0.25 * vnoise3(r * 18.0);
      float chip = step(0.86, c) * weathered * wearK;
      float rim = step(0.83, c) * (1.0 - chip) * weathered * wearK;
      col = mix(col, vec3(0.93, 0.90, 0.84), rim * 0.55);
      col = mix(col, vec3(0.30, 0.31, 0.42), chip * 0.85);
      // ---- rust streaks running down from the seams, warm, sparing
      float rs = fbm3(vec3(r.x * 5.0, r.y * 0.5, r.z * 5.0) + 7.0);
      float rust = step(0.70, rs) * step(0.5, fbm3(r * 1.7)) * weathered * wearK;
      col = mix(col, mix(col, vec3(0.70, 0.46, 0.30), 0.5), rust);

      // ---- worn plate edges: bright bare metal, the signature of the reference
      vec3 bare = mix(col, vec3(1.06, 1.04, 1.0), 0.8);
      col = mix(col, bare, smoothstep(0.1, 0.9, edge) * (0.55 + 0.45 * step(0.42, vnoise3(r * 9.0))));

      // ---- lighting: two hard tones
      float ndl = dot(N, uKeyDir);
      float sh = sunShadow(vWorld, N);
      float lit = smoothstep(-0.03, 0.05, ndl) * sh;
      vec3 litCol = col * mix(uSkyTint, uSunColor * 1.08, uSunStrength);
      float up = smoothstep(-0.7, 0.6, N.y);
      vec3 shadeCol = col * uShadeTint * mix(uBounce, vec3(1.0), up);
      vec3 outc = mix(mix(shadeCol, litCol, 0.12), litCol, lit);
      float deep = step(ndl, -0.55) * step(N.y, -0.35);
      outc = mix(outc, col * uDeepTint, deep * 0.85);

      // ---- painted chrome: the sky in hard bands. Facets take one band each.
      vec3 R = reflect(-V, N);
      vec3 env = chromeEnv(R, vLocal);
      float mt = metal * uChrome;
      vec3 chrome = col * env * mix(0.86, 1.04, lit);
      outc = mix(outc, chrome, mt * mix(0.72, 0.9, lit));

      vec3 H = normalize(uKeyDir + V);
      float sp = dot(N, H);
      float spec = step(0.9955, sp) * lit;
      outc = mix(outc, vec3(1.08, 1.07, 1.04), spec * (0.3 + 0.45 * metal) * (1.0 - 0.7 * lineMask));
      float fres = 1.0 - max(dot(N, V), 0.0);
      float rimL = smoothstep(0.72, 0.76, fres) * lit;
      outc = mix(outc, vec3(1.06, 1.08, 1.12), rimL * 0.5 * metal);

      // ---- charge: cel-toned blue light from the arrow; seams catch fire
      if(uCharge > 0.001){
        vec3 ab = uArcB - uArcA;
        float tt = clamp(dot(vWorld - uArcA, ab) / dot(ab, ab), 0.0, uChargeFront);
        vec3 q = uArcA + ab * tt;
        vec3 toL = q - vWorld;
        float dist = length(toL);
        vec3 Ld = toL / max(dist, 0.001);
        float nl = dot(N, Ld);
        float reach = 15.0 + 16.0 * uCharge;
        float fall = 1.0 - clamp(dist / reach, 0.0, 1.0);
        float band = step(0.14, fall) * 0.42 + step(0.46, fall) * 0.38 + step(0.74, fall) * 0.28;
        band *= smoothstep(-0.05, 0.12, nl) * uCharge;
        vec3 blue = vec3(0.46, 0.76, 1.12);
        outc = mix(outc, outc * 0.55 + blue * mix(0.5, 0.82, metal), clamp(band, 0.0, 1.0) * 0.8);
        // panel seams catch fire, only close to the arrow
        float seam = lineMask * step(0.5, fall) * uCharge;
        outc = mix(outc, vec3(0.62, 0.9, 1.25), seam * 0.75);
      }

      // ---- emissive classes: 1 reactor core, 2 visor, 3 ember inlay
      if(emis > 0.5 && emis < 1.5){
        float fac = 0.6 + 0.4 * vnoise3(vLocal * 14.0 + uDrawTime * 2.0);
        vec3 cold = vec3(0.28, 0.50, 0.86);
        vec3 hot = vec3(0.72, 0.94, 1.28);
        outc = mix(cold * (0.7 + 0.5 * dot(NV, vec3(0.0, 0.0, 1.0))), hot * (1.0 + 1.6 * uCore), clamp(uCore * fac * 1.4, 0.0, 1.0));
      } else if(emis > 1.5 && emis < 2.5){
        outc = mix(vec3(0.06, 0.08, 0.16), vec3(0.45, 0.9, 1.3) * 1.4, uVisor);
      } else if(emis > 2.5){
        outc = mix(col, vec3(1.25, 0.46, 0.14) * (1.0 + 2.2 * uHeat), 0.8 + 0.2 * uHeat);
      }

      writeOut(outc, 1.0, NV, vDepth, idF);
    }
  `;
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs, side: THREE.DoubleSide, transparent: false });
}

// One atlas and one body material, shared by the robot, the bow and every arrow.
let assets = null;
export function archerAssets() {
  if (!assets) { const tex = makePanelAtlas(2048); assets = { tex, mat: archerMaterial(tex) }; }
  return assets;
}
