import * as THREE from 'three';
import { G } from './glsl.js';
import { Rng, onThrees, onTwos, clamp, smooth, invLerp, lerp } from './util.js';
import { WU, makeDome, makeWaterVeil, raw } from './under-env.js';
import { blobGeo, rockMaterial, instanced, fbm } from './under-rock.js';
import { makeSnow, lifeMaterial, whaleGeo, fishGeo, instLife } from './under-life.js';
import { FY, buildArena, buildCanyon, buildBurst } from './under-sets.js';
import { makeStage } from './under-stage.js';

// UNDERWATER department: the bright sea under the fleet. Shots s17, s27, s29, s31–s37.
// Colour script per shot: water gradient, fog density, fans of light, what is standing on stage.
const SKY = {
  shade: '#5aa6e0', deepT: '#2f66c0', bounce: '#7fe6ee', sun: '#fbffff', tint: '#d8f6ff',
};
// silhouettes against the bright surface: everything on stage goes to deep cool blue
const BACKLIT = { sun: '#3a78c0', tint: '#2a5a9c', shade: '#2a5a9c', deepT: '#163c80', bounce: '#3c7ac0', strength: 0.3 };
const WA = ['#b6f4ff', '#22b8e6', '#0c78d4', '#0b3aa8'];
const WB = ['#c8f8ff', '#2ec8ec', '#0f84dc', '#0c3fb0'];
export const CFG = {
  s17: { W: ['#d0faff', '#2cc2ea', '#0a5cc4', '#0a2f96'], fog: 0.0016, rays: 0.1, ray: [0.5, 1.08], fall: 1.6, surf: 30, surfH: [0.22, 0.42], range: [0, 0, 0, 0], sets: [], sun: [0.05, 0.96, -0.28], snow: 240, chars: BACKLIT },
  s27: { W: WB, fog: 0.00062, rays: 0.3, ray: [0.68, 1.2], fall: 1.0, surf: 66, range: [0.1, 0.2, 1, 1.3], sets: ['canyon'], sun: [0.25, 0.9, -0.36], snow: 380 },
  s29: { W: WB, fog: 0.00056, rays: 0.3, ray: [0.8, 1.2], fall: 1.0, surf: 60, range: [0.08, 0.16, 1, 2.2], sets: ['arena'], sun: [0.3, 0.9, -0.3], snow: 340 },
  s31: { gain: 0.5, W: WA, fog: 0.00062, rays: 0.16, ray: [0.5, 1.15], fall: 1.2, surf: 60, range: [0.03, 0.12, 1, 3.1], sets: ['arena'], sun: [0.1, 0.92, 0.38], snow: 420 },
  s32: { gain: 0.5, W: WA, fog: 0.00075, rays: 0.12, ray: [0.3, 1.2], fall: 1.2, surf: 60, range: [0, 0, 0, 0], sets: ['arena'], sun: [0.1, 0.92, 0.38], snow: 240 },
  s33: { gain: 0.62, W: WB, fog: 0.00042, rays: 0.2, ray: [0.44, 1.08], fall: 1.05, surf: 90, surfH: [0.12, 0.3], surfH: [0.12, 0.3], range: [0.05, 0.1, 1, 4.1], sets: ['arena'], sun: [0, 0.94, -0.34], snow: 700 },
  s34: { gain: 0.42, W: WA, fog: 0.0011, rays: 0.08, ray: [0.3, 1.2], fall: 1.2, surf: 60, range: [0, 0, 0, 0], sets: ['arena'], sun: [-0.2, 0.9, 0.38], snow: 200 },
  s35: { gain: 0.42, W: WA, fog: 0.0011, rays: 0.08, ray: [0.5, 1.2], fall: 1.2, surf: 60, range: [0, 0, 0, 0], sets: ['arena'], sun: [0, 0.9, 0.42], snow: 200 },
  s36: { gain: 0.5, W: WA, fog: 0.00075, rays: 0.16, ray: [0.3, 1.15], fall: 1.1, surf: 60, range: [0.03, 0.12, 1, 3.1], sets: ['arena'], sun: [-0.2, 0.9, 0.38], snow: 380 },
  s37: { W: ['#d8fbff', '#38cdee', '#1190e0', '#0c48b6'], fog: 0.0003, rays: 0.2, ray: [0.5, 1.15], fall: 1.0, surf: 70, surfH: [0.1, 0.34], range: [0, 0, 0, 0], sets: [], sun: [0, 0.97, 0.2], snow: 380, chars: BACKLIT },
};

export async function createUnder(ctx) {
  const { scene, overlay, engine } = ctx;
  const root = new THREE.Group(); root.name = 'under'; root.visible = false; root.userData.noReflect = true;
  const ov = new THREE.Group(); ov.name = 'under-overlay'; ov.visible = false;
  scene.add(root); overlay.add(ov);

  const dome = makeDome(); root.add(dome);
  const veil = makeWaterVeil(); ov.add(veil);
  const snow = makeSnow(); snow.renderOrder = 4; ov.add(snow);

  // lazy sets: building them costs nothing until an underwater frame is asked for
  const sets = {};
  const getSet = (name) => {
    if (sets[name]) return sets[name];
    const s = name === 'arena' ? buildArena(ctx, root, ov) : buildCanyon(ctx, root, ov);
    sets[name] = s;
    return s;
  };

  // other departments' modules, optional: the sea must still render if one is broken mid-edit
  const parts = {};
  try { parts.makeArrow = (await import('./arrow.js')).makeArrow; } catch { /* stand-in arrow */ }
  try { const b = await import('./lev-body.js'); parts.section = b.section; parts.LEV_L = b.L; } catch { /* default section */ }
  const stage = makeStage(ctx, root, ov, getSet, parts);
  // FX read the beast's back and belly anchors: in the arena those are the strike point, set by the stage
  const wrapAnchors = () => {
    const L = ctx.leviathan;
    if (!L?.anchor || L.underAnchors) return;
    const base = L.anchor;
    L.underAnchors = true;
    L.anchor = (name, out = new THREE.Vector3()) => { const o = self.strike?.[name]; return o ? out.copy(o) : base(name, out); };
  };

  // the shared grade is tuned for a blazing sky: under water we want the authored colours, so
  // it is swapped per frame and put back the moment the film leaves the set
  const F = engine.mFinal.uniforms;
  const defaults = { exposure: F.uExposure.value, gamma: F.uGamma.value, bloom: F.uBloom.value, vign: F.uVignette.value, vib: F.uVibrance.value };
  let graded = false;
  const restoreGrade = () => {
    if (!graded) return;
    F.uExposure.value = defaults.exposure; F.uGamma.value = defaults.gamma; F.uBloom.value = defaults.bloom; F.uVignette.value = defaults.vign; F.uVibrance.value = defaults.vib;
    graded = false;
  };
  const leviRootFlag = (on) => { const r = ctx.leviathan?.root; if (r) r.userData.noReflect = on; };

  const vScratch = new THREE.Vector3();
  function applyCfg(st, c) {
    WU.uW0.value.copy(raw(c.W[0])); WU.uW1.value.copy(raw(c.W[1])); WU.uW2.value.copy(raw(c.W[2])); WU.uW3.value.copy(raw(c.W[3]));
    WU.uSunW.value.set(...c.sun).normalize();
    WU.uWT.value = onThrees(st.t);
    WU.uSurfS.value = c.surf;
    WU.uRange.value.set(...c.range);
    WU.uChurn.value.w = 0;
    WU.uSurfH.value.set(...(c.surfH ?? [0.2, 0.5]));
    WU.uRockGain.value = st.look.rockGain ?? c.gain ?? 1;
    WU.uFlash.value = 0;
    const v = veil.material.uniforms;
    v.uFogD.value = st.look.uFog ?? c.fog; v.uRays.value = st.look.uRays ?? c.rays; v.uRayUV.value.set(...c.ray); v.uRayFall.value = c.fall;
    v.uInvProj.value.copy(ctx.camera.projectionMatrixInverse); v.uCamWorld.value.copy(ctx.camera.matrixWorld);
    // cel lighting for everything in the water (leviathan, whales, arrow): cool shade, bright fill
    const L = { ...SKY, ...(c.chars ?? {}) };
    G.uSunColor.value.copy(raw(L.sun)); G.uSkyTint.value.copy(raw(L.tint));
    G.uShadeTint.value.copy(raw(L.shade)); G.uDeepTint.value.copy(raw(L.deepT)); G.uBounce.value.copy(raw(L.bounce));
    G.uSunStrength.value = L.strength ?? 1;
    F.uExposure.value = c.exposure ?? 1; F.uGamma.value = c.gamma ?? 1; F.uBloom.value = c.bloom ?? 0.42; F.uVignette.value = c.vign ?? 0.34; F.uVibrance.value = 0.12;
    graded = true;
    // the shared atmosphere pass stays out of the way: the veil does the water's fog
    const a = engine.mAtmos.uniforms;
    a.uFogDensity.value = 0; a.uMist.value = 0; a.uShafts.value = 0;
    const s = snow.material.uniforms;
    s.uT.value = st.t; s.uBox.value = c.snow; s.uSize.value = c.snow * 0.008;
  }

  const self = {
    root, CFG, stage, sets, pierce: new THREE.Vector3(0, -700, 0), tip: new THREE.Vector3(0, -890, 0), mound: new THREE.Vector3(0, FY + 90, 0),
    update(st) {
      const on = st.set === 'under';
      root.visible = on; ov.visible = on;
      if (ctx.world?.sky) ctx.world.sky.visible = !on;
      leviRootFlag(on);
      for (const k in sets) sets[k].group.visible = false;
      self.strike = null;
      if (!on) { restoreGrade(); stage.off?.(); return; }
      wrapAnchors();
      const c = CFG[st.sid];
      if (!c) return;
      for (const name of c.sets) getSet(name).group.visible = true;
      applyCfg(st, c);
      stage.update(st, c, veil);
    },
  };
  return self;
}
