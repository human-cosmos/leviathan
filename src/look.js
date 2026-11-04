import * as THREE from 'three';
import { G } from './glsl.js';
import { ENV } from './passes-env.js';
import { deg } from './util.js';

// Colour script for LEVIATHAN: one blazing high-key summer day.
//   k = 1   full sun: ultramarine zenith, white cumulus, cobalt-to-turquoise sea
//   k = 0.5 thin bright veil (spray fog, the crash): still luminous, softer shadows
// Shadows stay cool lavender-blue like classic cels; never muddy or grey.
export const PRESETS = {
  shower: {
    sunColor: '#fff4e2', sunStrength: 0.8, skyTint: '#f0f4fc', shadeTint: '#aeb8e4', deepTint: '#8089c6', bounce: '#c8ecec',
    sky: { zenith: '#2e78dc', mid: '#7cbcf0', warm: '#f6fafa', cool: '#d8ecf8', cloudLit: '#ffffff', cloudMid: '#e8eefa', cloudShade: '#a8b4dc' },
    fog: { warm: '#f4f8f8', cool: '#dcecf6', density: 0.00030, mist: 0.2, mistHeight: 26 },
    water: { deep: '#1e6cc8', shallow: '#46cfc8', foam: '#ffffff', skyRefl: '#cfe6f6' },
    grade: { lift: '#121830', gain: '#fffefb', sat: 1.08 },
  },
  summer: {
    sunColor: '#fff4dc', sunStrength: 1.0, skyTint: '#eaf4ff', shadeTint: '#a2b0ea', deepTint: '#7482d4', bounce: '#b8f2ea',
    sky: { zenith: '#0f47c8', mid: '#2f8ef0', warm: '#f0fbf8', cool: '#d8f2fb', cloudLit: '#ffffff', cloudMid: '#eef3fe', cloudShade: '#adbcf2' },
    fog: { warm: '#f0fbf8', cool: '#d8f2fb', density: 0.00011, mist: 0.1, mistHeight: 22 },
    water: { deep: '#0a50c4', shallow: '#22cfc8', foam: '#ffffff', skyRefl: '#84c8f8' },
    grade: { lift: '#0e1630', gain: '#fffdf8', sat: 1.14 },
  },
};

const ca = new THREE.Color(), cb = new THREE.Color();
const mixC = (target, a, b, k) => target.copy(ca.set(a)).lerp(cb.set(b), k);
const mixN = (a, b, k) => a + (b - a) * k;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// look: { k, sunElev (deg), sunAz (deg, 0 = -Z, + toward +X), sunDisk, shafts, veil, mistMul, fogMul,
//         fogDensity, fogWarm, fogCool (absolute overrides, e.g. for underwater),
//         ocean (0 = plain water, 1 = open-ocean drawing, default 1), oceanScale (default 1) }
export function applyLook(ctx, look) {
  const A = PRESETS.shower, B = PRESETS.summer;
  const k = clamp01(((look.k ?? 1) - 0.5) / 0.5);
  const el = deg(look.sunElev ?? 24), az = deg(look.sunAz ?? 150);
  G.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  mixC(G.uSunColor.value, A.sunColor, B.sunColor, k);
  G.uSunStrength.value = mixN(A.sunStrength, B.sunStrength, k);
  mixC(G.uSkyTint.value, A.skyTint, B.skyTint, k);
  mixC(G.uShadeTint.value, A.shadeTint, B.shadeTint, k);
  mixC(G.uDeepTint.value, A.deepTint, B.deepTint, k);
  mixC(G.uBounce.value, A.bounce, B.bounce, k);

  ENV.uRain.value = clamp01(look.rain ?? 0);
  ENV.uRainbow.value = clamp01(look.rainbow ?? 0);
  ENV.uVeil.value = clamp01(look.veil ?? 1 - k);
  ENV.uOcean.value = look.ocean ?? 1;
  ENV.uOceanScale.value = look.oceanScale ?? 1;
  ENV.uWaterOn.value = look.water === false ? 0 : 1;

  const sky = ctx.world && ctx.world.sky;
  if (sky) {
    const u = sky.material.uniforms;
    mixC(u.uZenith.value, A.sky.zenith, B.sky.zenith, k);
    mixC(u.uMid.value, A.sky.mid, B.sky.mid, k);
    mixC(u.uHorizonWarm.value, A.sky.warm, B.sky.warm, k);
    mixC(u.uHorizonCool.value, A.sky.cool, B.sky.cool, k);
    mixC(u.uCloudLit.value, A.sky.cloudLit, B.sky.cloudLit, k);
    mixC(u.uCloudMid.value, A.sky.cloudMid, B.sky.cloudMid, k);
    mixC(u.uCloudShade.value, A.sky.cloudShade, B.sky.cloudShade, k);
    u.uSunDisk.value = look.sunDisk ?? ((look.sunElev ?? 24) > -0.5 ? 1 : 0);
  }
  const e = ctx.engine;
  const a = e.mAtmos.uniforms;
  mixC(a.uFogWarm.value, A.fog.warm, B.fog.warm, k);
  mixC(a.uFogCool.value, A.fog.cool, B.fog.cool, k);
  if (look.fogWarm) a.uFogWarm.value.set(look.fogWarm);
  if (look.fogCool) a.uFogCool.value.set(look.fogCool);
  a.uFogDensity.value = (look.fogDensity ?? mixN(A.fog.density, B.fog.density, k)) * (look.fogMul ?? 1);
  a.uMist.value = mixN(A.fog.mist, B.fog.mist, k) * (look.mistMul ?? 1);
  a.uMistHeight.value = mixN(A.fog.mistHeight, B.fog.mistHeight, k);
  a.uShafts.value = look.shafts ?? 0;
  const w = e.mWater.uniforms;
  mixC(w.uDeep.value, A.water.deep, B.water.deep, k);
  mixC(w.uShallow.value, A.water.shallow, B.water.shallow, k);
  mixC(w.uFoam.value, A.water.foam, B.water.foam, k);
  mixC(w.uSkyRefl.value, A.water.skyRefl, B.water.skyRefl, k);
  const f = e.mFinal.uniforms;
  mixC(f.uLift.value, A.grade.lift, B.grade.lift, k);
  mixC(f.uGain.value, A.grade.gain, B.grade.gain, k);
  f.uSat.value = mixN(A.grade.sat, B.grade.sat, k);
}
