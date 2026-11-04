import { lerp, smooth, invLerp, clamp } from '../util.js';

// World department: the high shots. The set is painted by the planet shader (look.planet),
// so cameras sit anywhere; only their rotation matters. The arrow is flown in camera space by
// world-flight.js. Pitches below come from the reference: the horizon lands where it lands there.
const ease = (t) => smooth(clamp(t));
const sunHigh = { sunElev: 38, sunAz: 40 };
const pitched = (deg, fov, roll = 0, pan = 0) => {
  const r = (deg * Math.PI) / 180, a = (pan * Math.PI) / 180;
  return { pos: [0, 0, 0], look: [Math.sin(a) * Math.cos(r) * 100, Math.sin(r) * 100, -Math.cos(a) * Math.cos(r) * 100], fov, roll, near: 1, far: 9000 };
};

export const CAMS = {
  // tracking alongside the arrow: a slow lift of the horizon as the deck falls away
  s11: (lt, d) => { const k = ease(lt / d); return pitched(lerp(-6.2, -9.6, k), 30, lerp(0.4, -3.2, k)); },
  s12: (lt, d) => pitched(-31.1 + 0.04 * lt, 44, -0.8),
  s13: (lt, d) => pitched(-31.1 + 0.05 + 0.5 * lt, 44, -0.8 + lt * 1.6),
  s25: (lt, d) => ({ pos: [lerp(-40, 40, lt / d), 1440, lerp(1600, 1540, lt / d)], look: [lerp(-40, 40, lt / d), 1120, -600], fov: 36, near: 8, far: 9000 }),
  s26: (lt, d) => pitched(-19.6 + lt * 0.5, 46, -2.4 + lt * 1.2),
  s28: (lt, d) => pitched(lerp(-52, -58, ease(lt / d)), 38, 4),
};

export const LOOKS = {
  s11: (lt, d, t) => {
    const k = ease(lt / d);
    return { sunElev: 27, sunAz: 40, water: false, key: [-0.2, 0.7, 0.7], planet: { alt: lerp(9.6, 44, k * k), x: -t * 16, z: t * 3, cov: 0.52, deck: 1 - ease((lt - 0.5) / (d - 0.9)) } };
  },
  s12: (lt, d, t) => ({ ...sunHigh, water: false, key: [0.5, 0.6, 0.6], planet: { alt: 800, x: 500, z: 40, cov: 0.56 } }),
  s13: (lt, d, t) => ({ ...sunHigh, water: false, key: [0.5, 0.6, 0.6], planet: { alt: 800, x: 500, z: 40, cov: 0.56 } }),
  s25: (lt, d) => ({ sunElev: 31, sunAz: 62, water: false, key: [-0.3, 0.7, 0.5], fogMul: 0, mistMul: 0, paintRadius: 1.5, planet: { alt: 30, x: 900, z: -300, cov: 1.3, space: 0.84 } }),
  s26: (lt, d, t) => ({ ...sunHigh, water: false, key: [-0.3, 0.6, 0.8], planet: { alt: lerp(118, 104, lt / d), x: 1400 + t * 3, z: -500, cov: 0.52, sea: 0.5 } }),
  s28: (lt, d, t) => {
    const k = ease(lt / d);
    return { ...sunHigh, water: false, key: [0.3, 0.7, 0.6], planet: { alt: lerp(9.5, 4.2, k), x: 80, z: 40 + lt * 0.3, cov: lerp(0.5, 1.3, ease(lt / 1.0)), sea: 1, fleet: 1, veil: 1 - ease((lt - 0.1) / 0.75) } };
  },
};
