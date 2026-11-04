import { track, smooth, lerp, noise1, invLerp, deg } from '../util.js';

// Cameras and looks for the monster's surface shots. Times inside tracks are local seconds.
const SUN = { k: 1, sunElev: 46, sunAz: 150 };
const shake = (t, a, f = 7) => [noise1(t * f, 1) * a, noise1(t * f, 2) * a, noise1(t * f, 3) * a];
const BREACH_Z = -560;

function breachCam(t) {
  const k = invLerp(35.5, 42.37, t);
  // low and long, the near ship dead centre at the bottom of the frame
  return { pos: [lerp(-5, 5, k), 32, 620 - 14 * k], look: [lerp(10, 16, k), 186, BREACH_Z], fov: 28 };
}

export const CAMS = {
  // high aerial: horizon near the top, ships at the frame edges, the shadow running away between them
  s14: (lt, d) => {
    const k = lt / d;
    return { pos: [lerp(-14, 14, k), 395, 1560 - 40 * k], look: [lerp(-10, 12, k), 0, -160 - 40 * k], fov: 43 };
  },
  // on the port walkway: rail sweeping to the bow, the container wall on the right, the pod beyond
  s15: (lt, d, t) => {
    const k = lt / d;
    const pos = [-20.5, 16.72 + noise1(t * 0.7, 3) * 0.04, 20];
    const yaw = deg(track([[0, 15], [1, 18]], k)), pitch = deg(track([[0, 6.4], [1, 9.5]], k));
    return { pos, look: [pos[0] - Math.sin(yaw) * Math.cos(pitch) * 300, pos[1] + Math.sin(pitch) * 300, pos[2] - Math.cos(yaw) * Math.cos(pitch) * 300], fov: 40, roll: 0.7 * Math.sin(lt * 0.8), near: 0.2 };
  },
  s18: (lt, d) => {
    const k = smooth(lt / d), s = shake(lt, 0.25, 3);
    return { pos: [s[0], 12 + s[1], 1190 - 24 * k], look: [0, lerp(96, 124, k), 300], fov: 21 };
  },
  s19: (lt, d) => {
    const k = lt / d, s = shake(lt, 0.9, 5);
    return { pos: [s[0], 12 + s[1], track([[0, 1166], [0.5, 1130], [1, 1090]], k)], look: [0, track([[0, 124], [0.25, 190], [0.55, 340], [0.8, 470], [1, 530]], k), 420], fov: track([[0, 21], [0.4, 25], [0.65, 28], [1, 31]], k) };
  },
  s20: (lt, d, t) => breachCam(t),
  s21: (lt, d, t) => breachCam(t),
  s24: (lt, d) => {
    const k = lt / d;
    return { pos: [16, 236 + 30 * k, 250 + 50 * k], look: [6, 92 - 6 * k, -420], fov: 40 };
  },
  s38: (lt, d) => {
    const k = lt / d;
    return { pos: [0, 14, 620], look: [0, lerp(46, 70, k), -600], fov: 26 };
  },
  // the fall: ships broadside at both edges, the monster in the gap between them
  s39: (lt, d) => {
    const k = invLerp(0, 3, lt), s = shake(lt, lt > 2 ? 1.6 : 0.5, 6);
    return { pos: [s[0], 24 + s[1], 620], look: [0, lerp(238, 150, smooth(k)), -880], fov: 28 };
  },
};

export const LOOKS = {
  s14: () => ({ ...SUN, sunElev: 52, inkWidth: 1.6 }),
  s15: () => ({ ...SUN, sunElev: 44, sunAz: 225, key: [-0.3, 0.62, 0.72], inkWidth: 1.6, shadow: { center: [-14, 22, -20], radius: 90, depth: 140 } }),
  s18: () => ({ ...SUN, sunAz: 205, key: [0.62, 0.52, 0.58], inkWidth: 1.8 }),
  s19: () => ({ ...SUN, sunAz: 205, key: [0.56, 0.34, 0.76], inkWidth: 1.8 }),
  s20: () => ({ ...SUN, sunAz: 205, key: [-0.62, 0.6, 0.5], inkWidth: 1.7 }),
  s21: () => ({ ...SUN, sunAz: 205, key: [-0.5, 0.68, 0.54], inkWidth: 1.7 }),
  s24: () => ({ ...SUN, sunAz: 220, key: [0.5, 0.7, 0.5], inkWidth: 1.7 }),
  s38: () => ({ ...SUN, sunAz: 205, key: [-0.2, 0.6, 0.8], inkWidth: 1.7 }),
  s39: () => ({ ...SUN, sunAz: 205, key: [-0.3, 0.6, 0.74], inkWidth: 1.7 }),
};
