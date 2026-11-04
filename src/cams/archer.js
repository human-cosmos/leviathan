import { lerp, smooth, clamp, noise1 } from '../util.js';

// Cameras and looks for the coast shots. World metres; sea toward -X, the arrow flies that way.
const e = (t) => smooth(clamp(t));
const mix3 = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
const OX = -10;   // every framing below was laid out with the robot 10 m further inland
const wide = (lt, d, from, to) => {
  const k = lt / d;
  const pos = mix3(from.pos, to.pos, k), look = mix3(from.look, to.look, k);
  pos[0] += OX; look[0] += OX;
  return { pos, look, fov: lerp(from.fov, to.fov, k) };
};

const WIDE_A = { pos: [120, 30, 636], look: [-36, 37, 0], fov: 19.4 };
const widePos = (z, y = 17) => ({ ...WIDE_A, pos: [-78, y, z] });

export const CAMS = {
  // bow hand left, head right: the camera sits square to the arm, under the arrow
  s01: (lt, d) => wide(lt, d, { pos: [-105, 60, 65], look: [-32, 60.6, -4], fov: 18 }, { pos: [-105, 60, 65], look: [-31.4, 60.6, -4], fov: 18 }),
  // straight down the lower limb onto the cable block, shore far below
  s02: (lt, d) => ({ ...wide(lt, d, { pos: [-40, 90, 42], look: [-61, 33, 3], fov: 16 }, { pos: [-39, 90, 42], look: [-61, 33, 3], fov: 15.6 }), roll: -23 }),
  s03: (lt, d) => wide(lt, d, widePos(320), widePos(316)),
  // across the bow shoulder to the head and the draw hand, close, under the chin
  s04: (lt, d) => wide(lt, d, { pos: [-30, 55, 56], look: [-3, 66.5, 5], fov: 22.5 }, { pos: [-29, 55, 56], look: [-1.5, 66.5, 5], fov: 22 }),
  s05: (lt, d) => wide(lt, d, { pos: [-60, 5, 165], look: [-52, 6.6, 20], fov: 9 }, { pos: [-60, 5, 160], look: [-52, 6.6, 20], fov: 9 }),
  s06: (lt, d) => wide(lt, d, { pos: [-14, 61, 66], look: [-3, 65, 10], fov: 14 }, { pos: [-11, 61, 66], look: [0, 65, 10], fov: 14 }),
  s07: (lt, d) => wide(lt, d, widePos(312), widePos(308)),
  // from ahead of the tip, low and to the side: head huge, riser, helmet behind, draw hand far off
  s08: (lt, d) => wide(lt, d, { pos: [-119, 62, 30], look: [-19, 68, -5], fov: 24.4 }, { pos: [-117, 62, 30], look: [-19, 68, -5], fov: 24.4 }),
  s09: (lt, d, t) => {
    const k = wide(lt, d, widePos(332, 18), widePos(328, 18));
    const rel = t - 13.7;
    if (rel > 0) {
      const a = 1.6 * Math.exp(-rel * 2.6);
      k.pos = [k.pos[0] + noise1(t * 21, 1) * a, k.pos[1] + noise1(t * 23, 2) * a, k.pos[2]];
    }
    return k;
  },
};

const coast = (o = {}) => ({ k: 1, sunElev: 50, sunAz: 150, key: [0.42, 0.72, 0.78], shadow: { center: [-10, 40, 0], radius: 130, depth: 420 }, ...o });
export const LOOKS = {
  s01: () => coast(), s02: () => coast({ paintRadius: 14 }), s03: () => coast(), s04: () => coast(), s05: () => coast(),
  s06: () => coast(), s07: () => coast(), s08: () => coast(), s09: () => coast(),
};
void e;
