import { lerp, smooth, noise1, clamp, invLerp, easeOut, easeIn, easeInOut } from '../util.js';

// Cameras and looks for the underwater shots. Floor at y = -1000, surface at y = 0,
// the mound at the origin. Each camera matches the reference frame's composition.
const K = (lt, d) => clamp(lt / d);
const mix3 = (a, b, k) => a.map((x, i) => lerp(x, b[i], k));
const shake = (t, amp, sp = 9) => [noise1(t * sp, 1) * amp, noise1(t * sp, 2) * amp, noise1(t * sp, 3) * amp];

export const CAMS = {
  s17: (lt, d) => {
    const k = K(lt, d);
    return { pos: [0, -210, lerp(70, 52, k)], look: [0, -60, -300], fov: 48, far: 9000 };
  },
  s27: (lt, d, t) => {
    const k = K(lt, d);
    return { pos: mix3([-88, -1014, 860], [-72, -1018, 740], k), look: mix3([-4, -700, -500], [8, -712, -620], k), fov: 62 };
  },
  s29: (lt, d, t) => {
    const k = smooth(K(lt, d));
    return { pos: mix3([40, -590, 335], [32, -580, 330], k), look: mix3([-10, -480, 90], [-10, -420, 100], k), fov: 60 };
  },
  s31: (lt, d, t) => {
    const k = K(lt, d), s = shake(t, 5 * (1 - k));
    return { pos: [130 + s[0], FYo(40) + s[1], lerp(290, 268, k)], look: [130, -770, 0], fov: 70 };
  },
  s32: (lt, d) => {
    const k = K(lt, d);
    return { pos: [lerp(-150, -120, k), FYo(34), lerp(310, 290, k)], look: [-50, -800, 0], fov: 62 };
  },
  s33: (lt, d) => {
    const k = K(lt, d);
    return { pos: [-240 + 10 * k, -600, 3400 - 40 * k], look: [100, -380, 0], fov: 58, far: 9000 };
  },
  s34: (lt, d) => {
    const k = K(lt, d);
    return { pos: [lerp(-70, -50, k), FYo(30), lerp(400, 380, k)], look: [lerp(-50, -30, k), FYo(140), 0], fov: 50 };
  },
  s35: (lt, d, t) => {
    const k = K(lt, d), s = shake(t, 1.6, 14);
    return { pos: [s[0], FYo(40) + s[1], lerp(452, 430, k)], look: [0, FYo(150), 0], fov: 32 };
  },
  s36: (lt, d, t) => {
    const k = K(lt, d);
    if (lt < 0.7) { const s = shake(t, 7, 12); return { pos: [s[0], FYo(24) + s[1], 430], look: [0, FYo(130), 0], fov: 40 }; }
    return { pos: [40, FYo(60), lerp(520, 490, k)], look: [40, FYo(270), 0], fov: 60 };
  },
  s37: (lt, d) => {
    const k = K(lt, d);
    const e = smooth(k);
    return { pos: mix3([240, -760, 330], [10, -600, 90], e), look: mix3([-20, -500, -110], [0, -140, -130], e), fov: lerp(52, 60, e) };
  },
};
function FYo(h) { return -1000 + h; }

const base = (over = {}) => ({ k: 1, sunElev: 72, sunAz: 170, shafts: 0, water: false, fogMul: 0, mistMul: 0, key: [0.25, 0.9, 0.42], paintRadius: 3, ...over });
export const LOOKS = {
  s17: (lt, d) => base({ uFog: lerp(0.011, 0.0016, smooth(K(lt, d) * 1.5)) }),
  s27: () => base({ key: [-0.34, 0.86, 0.4] }),
  s29: () => base({ key: [0.4, 0.8, 0.5] }),
  s31: () => base(),
  s32: () => base({ inkWidth: 1.3 }),
  s33: () => base(),
  s34: () => base({ inkWidth: 1.3 }),
  s35: () => base({ inkWidth: 1.3 }),
  s36: () => base(),
  s37: () => base(),
};
