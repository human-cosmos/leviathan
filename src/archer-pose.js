import { CUES } from './shots.js';
import { onTwos, track, noise1, clamp, lerp, easeOut, smooth } from './util.js';

// The whole performance as a pure function of film time. All positions are in robot units
// (root space, 1 = 10 m); the cameras read the same numbers, so framing follows the pose.
export const ROOT_POS = [-14, 0, 0];   // world metres: the front foot stands in the surf

// drawn on twos; the twos restart at the release so the snap lands on its exact frame
export function drawingTime(t) {
  const r = CUES.release;
  return t < r ? onTwos(t) : r + onTwos(t - r);
}

const N_START = [-0.5, 6.74, 1.7];
const N_FULL = [1.86, 6.76, 1.7];

export const GRIP = [-5.72, 6.3, 0.54];
export const BOW_LIMB = 0.76;   // the drawn bow stands clear of the ground, tips above the rocks
export const BOW_CANT = -17;   // degrees about the arrow axis, bow top back: string clears the front thigh and the helmet

export function poseAt(t) {
  const q = drawingTime(t);
  const rel = q - CUES.release;
  const released = rel >= 0;
  const draw = track([[0, 0.0], [0.67, 0.17], [1.47, 0.28], [2.6, 0.4], [6.0, 0.62], [9.17, 0.8], [11.8, 0.97], [CUES.release, 1.0]], Math.min(q, CUES.release));

  // a giant holding a huge load: slow breath, a fine tremble that grows with the draw
  const breath = Math.sin(q * 1.15) * 0.018;
  const shake = released ? 0 : 0.004 + 0.016 * draw * draw;
  const trem = (s) => noise1(q * 7.3, s) * shake;

  // recoil: the body is thrown back and settles with mass
  const kick = released ? easeOut(rel / 0.1, 2) * Math.exp(-rel * 1.25) : 0;
  const twitch = released ? Math.exp(-rel * 6) * Math.sin(rel * 26) : 0;

  const pelvis = [0.3 + 0.2 * kick, 3.62 + breath * 0.8 - 0.06 * kick, -0.05 - 0.05 * kick];
  const pelvisR = [2, 6 - 3 * kick, 0];
  const waistR = [4 - 3 * kick, 1 + 2 * kick, 3 + 3 * kick];
  const chestR = [1 - 5 * kick + breath * 60, 1 + 5 * kick, 3 + 5 * kick];
  const neckR = [0, -19, -2];
  const headR = [track([[0, 3], [CUES.release, 7]], Math.min(q, CUES.release)) - 8 * kick, -40 + 8 * kick, -2];

  const grip = [GRIP[0] - 0.16 * kick + trem(1), GRIP[1] + 0.07 * kick + breath * 0.5 + trem(2), GRIP[2] + 0.02 * kick];
  const bowRoll = 1 - 7 * kick + 2.5 * twitch + trem(3) * 40;   // about the lateral axis: the top kicks toward the target and back

  const nock = N_START.map((a, i) => lerp(a, N_FULL[i], draw));
  nock[0] += trem(4); nock[1] += trem(5) + breath * 0.6; nock[2] += trem(6);

  // the draw hand after the shot flies back, up and open
  const fly = released ? track([[0, 0], [0.09, 0.62, easeOut], [0.5, 1, easeOut], [0.9, 0.92], [3, 0.8]], rel) : 0;
  const hand = fly > 0 ? [lerp(nock[0] + 1.05, 3.7, fly), lerp(nock[1] - 0.2, 7.5, fly), lerp(nock[2] + 0.24, 0.1, fly)] : null;

  const c = released ? 1 : smooth(clamp((t - CUES.chargeStart) / (CUES.chargeFull - CUES.chargeStart)));
  return { q, rel, released, draw, breath, kick, twitch, pelvis, pelvisR, waistR, chestR, neckR, headR, grip, bowRoll, nock, hand, fly, charge: c };
}

// feet stay planted (world contact). Front (right) foot is in the surf, toe driven down into it.
export const FOOT = {
  R: { ankle: [-5.2, 0.92, 1.0], toe: [-0.86, -0.42, 0.3], up: [-0.3, 1, 0.1], pole: [-2.5, 6, 3.4] },
  L: { ankle: [1.5, 0.85, -3.7], toe: [0.5, 0, 0.86], up: [0, 1, 0], pole: [7, 3.2, 1.6] },
};

export function nockWave(rel) {
  // the released string: fast decaying standing wave, on real time so it stays alive on ones
  return rel < 0 ? 0 : Math.exp(-rel * 3.6) * Math.cos(rel * 62);
}
