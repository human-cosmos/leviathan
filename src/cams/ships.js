import { lerp, smooth, deg, noise1, invLerp } from '../util.js';

// Cameras and looks for the Ships department: s10, s16, s22, s23, s30.
// Deck set: the hero ship sits at the origin with its bow toward -Z, so a ship-local
// point (x, y, z) is at world (-x, y, -z).
const L = (x, y, z) => [-x, y, -z];
// wheelhouse rig of s22, shared with ships-bridge.js
export const S16 = { pos: [0, 39.4, 0], yaw: 27.5, pitch: -5.5, fov: 49 };
export const S23 = { pos: [0, 400, 1000], tilt: 17.4, fov: 21.5 };
// s30: every ship placed by where it should sit in frame (fx 0..1, distance along the lens)
export const S30 = {
  pos: [0, 15, 1400], yaw: -14, fov: 12.5,
  layout: [
    { fx: 0.92, d: 1120, hdg: Math.PI + 0.93 },            // big, stern toward us, bow left, tower cropped by the frame
    { fx: 0.13, d: 1950, hdg: Math.PI + 0.54 },          // small, stern on, white tower
    { fx: -0.1, d: 1800, hdg: Math.PI / 2 - 0.1 },      // bow in at the left edge
    { fx: 0.69, d: 3500, hdg: -Math.PI / 2 + 0.2 },      // far, hazy
  ],
};
export const S22 = { pos: [0, 44, 3], pitch: 15, yaw: 0, roll: 3.2, wall: 2.55 };
function aim(pos, yaw, pitch, dist = 300) {
  // yaw from world +Z (toward the tower), positive to the camera's right
  const c = Math.cos(deg(pitch));
  return [pos[0] - Math.sin(deg(yaw)) * c * dist, pos[1] + Math.sin(deg(pitch)) * dist, pos[2] + Math.cos(deg(yaw)) * c * dist];
}

export const CAMS = {
  s10: (lt, d, t) => {
    const k = smooth(lt / d);
    const pos = L(12, 33 + 0.25 * k, 52 - 1.2 * k);
    pos[0] += noise1(t * 0.7, 1) * 0.04; pos[1] += noise1(t * 0.9, 2) * 0.05;
    return { pos, look: aim(pos, 4.2 - 0.3 * k, 25.5 + 0.5 * k), fov: 47, near: 0.3 };
  },
  s16: (lt, d, t) => {
    const q = Math.floor(t * 12) / 12, k = lt / d, a = 0.012 + 0.02 * k;
    const y = deg(S16.yaw + noise1(q * 2.1, 5) * 0.12 + 0.5 * k), p = deg(S16.pitch + noise1(q * 2.7, 6) * 0.1);
    const pos = [S16.pos[0] + noise1(q * 3.1, 3) * a, S16.pos[1] + noise1(q * 3.3, 4) * a, S16.pos[2]];
    return { pos, look: [pos[0] + Math.sin(y) * Math.cos(p) * 50, pos[1] + Math.sin(p) * 50, pos[2] - Math.cos(y) * Math.cos(p) * 50], fov: S16.fov, near: 0.2, far: 8800, roll: noise1(q * 1.9, 7) * 0.25 };
  },
  s22: (lt, d, t) => {
    // hand-held: a slow drift up and a rumble that grows as the mass goes by, on twos
    const q = Math.floor(t * 12) / 12, k = lt / d, a = 0.006 + 0.012 * k;
    const p = deg(S22.pitch), y = deg(S22.yaw);
    const pos = [S22.pos[0] + noise1(q * 3.1, 1) * a - 0.02 * k, S22.pos[1] + noise1(q * 3.7, 2) * a + 0.03 * k, S22.pos[2]];
    const look = [pos[0] + Math.sin(y) * Math.cos(p) * 10, pos[1] + Math.sin(p) * 10, pos[2] - Math.cos(y) * Math.cos(p) * 10];
    return { pos, look, fov: 50, near: 0.1, far: 8800, roll: noise1(q * 2.3, 3) * 0.35 };
  },
  s23: (lt, d, t) => {
    const k = lt / d, P = S23.pos;
    return { pos: P, look: [P[0] + lerp(-2, 2, k) + noise1(t * 0.5, 9) * 0.5, P[1] + 10.2 + noise1(t * 0.6, 8) * 0.3, P[2] - 100], fov: S23.fov, near: 2, far: 8800 };
  },
  s30: (lt, d, t) => {
    const k = lt / d, P = S30.pos, y = deg(S30.yaw + 0.25 * k);
    return { pos: [P[0] + noise1(t * 0.3, 4) * 0.4, P[1] + noise1(t * 0.5, 5) * 0.3, P[2]], look: [P[0] + Math.sin(y) * 2600, 150, P[2] - Math.cos(y) * 2600], fov: S30.fov, far: 8800 };
  },
};

export const LOOKS = {
  s10: () => ({ k: 1, sunElev: 52, sunAz: 165, key: [0.35, 0.8, 0.5], shadow: { center: [-10, 34, 40], radius: 110, depth: 160 } }),
  s16: () => ({ k: 1, sunElev: 54, sunAz: 60, key: [0.62, 0.62, 0.48], shadow: { center: [20, 36, -40], radius: 80, depth: 160 }, inkWidth: 1.6 }),
  s22: () => ({ k: 1, sunElev: 48, sunAz: 150, key: [0.15, 0.62, 0.77], inkWidth: 1.5, fogMul: 0.5, mistMul: 0 }),
  s23: () => ({ k: 1, sunElev: 50, sunAz: 165, water: false, key: [0.3, 0.42, 0.86], mistMul: 0, fogMul: 0.3, inkWidth: 1.4 }),
  s30: () => ({ k: 1, sunElev: 42, sunAz: 160, key: [-0.2, 0.62, 0.76], fogMul: 0.3, mistMul: 0, oceanScale: 2.2, inkWidth: 1.3 }),
};
void lerp; void invLerp;
