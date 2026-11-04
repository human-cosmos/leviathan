import { smooth, invLerp, lerp } from './util.js';

// LEVIATHAN — 83 s. A shot-for-shot retelling in our bright cel-anime style.
export const FPS = 24;
export const DURATION = 83;
export const FRAMES = FPS * DURATION;

// Story beats in film seconds. Every department and the soundtrack key off these.
export const CUES = {
  drawHold: 1.47,
  chargeStart: 6.0,      // blue energy starts crawling along the arrow
  chargeFull: 11.8,      // the arrowhead blazes
  release: 13.7,         // string snaps forward, the arrow is gone
  cloudSplit: 14.8,      // the sky opens along the arrow's path
  sonicFlash: 21.07,     // blue shock over the planet's limb
  shadowInSea: 21.6,     // a colossal shadow under the fleet
  whalesRise: 23.4,      // four whales rise beside the ship
  whalesDive: 26.0,
  lures: 31.2,           // four whale heads break the surface…
  mawRises: 33.4,        // …they are lures inside a colossal mouth
  breach: 35.5,          // the leviathan breaches through the fleet
  breachTop: 39.5,
  belly: 42.4,           // its belly passes the bridge windows
  bigWave: 45.1,         // the swell it left lifts the ships
  shipStands: 47.2,      // a container ship stands on end
  reentry: 51.3,         // the arrow turns back toward the planet
  plasma: 52.6,          // red-hot re-entry
  impact: 60.9,          // the arrow strikes the sea
  pierce: 63.0,          // it pierces the leviathan, lightning runs through it
  tipOut: 69.3,          // the tip punches out of the belly into the rock
  rockBurst: 70.2,
  surfaceBurst: 74.8,    // a mountain of water rises
  flip: 77.0,            // the dying leviathan flips over the ships
  crash: 79.0,           // it falls; the wall of water takes the fleet
  end: 83.0,
};

// id = reference number: ref/sNNa_*.jpg and ref/sNNb_*.jpg show the original shot.
export const SHOTS = [
  { id: 's01', name: 'grip', set: 'coast', owner: 'archer', start: 0, end: 0.67 },
  { id: 's02', name: 'limb', set: 'coast', owner: 'archer', start: 0.67, end: 1.47 },
  { id: 's03', name: 'archer wide', set: 'coast', owner: 'archer', start: 1.47, end: 2.6 },
  { id: 's04', name: 'draw', set: 'coast', owner: 'archer', start: 2.6, end: 4.37 },
  { id: 's05', name: 'foot', set: 'coast', owner: 'archer', start: 4.37, end: 5.8 },
  { id: 's06', name: 'charge', set: 'coast', owner: 'archer', start: 5.8, end: 9.17 },
  { id: 's07', name: 'charge wide', set: 'coast', owner: 'archer', start: 9.17, end: 11.8 },
  { id: 's08', name: 'arrowhead', set: 'coast', owner: 'archer', start: 11.8, end: 13.03 },
  { id: 's09', name: 'release', set: 'coast', owner: 'archer', start: 13.03, end: 14.53 },
  { id: 's10', name: 'sky splits', set: 'deck', owner: 'ships', start: 14.53, end: 16.8 },
  { id: 's11', name: 'climb', set: 'sky', owner: 'world', start: 16.8, end: 19.9 },
  { id: 's12', name: 'orbit', set: 'orbit', owner: 'world', start: 19.9, end: 21.07 },
  { id: 's13', name: 'flash', set: 'orbit', owner: 'world', start: 21.07, end: 21.57 },
  { id: 's14', name: 'shadow', set: 'ocean', owner: 'monster', start: 21.57, end: 23.17 },
  { id: 's15', name: 'whales', set: 'deck', owner: 'monster', start: 23.17, end: 26.97 },
  { id: 's16', name: 'bridge wing', set: 'deck', owner: 'ships', start: 26.97, end: 28.4 },
  { id: 's17', name: 'below', set: 'under', owner: 'under', start: 28.4, end: 31.1 },
  { id: 's18', name: 'lures', set: 'ocean', owner: 'monster', start: 31.1, end: 33.5 },
  { id: 's19', name: 'maw', set: 'ocean', owner: 'monster', start: 33.5, end: 35.5 },
  { id: 's20', name: 'breach', set: 'ocean', owner: 'monster', start: 35.5, end: 38.5 },
  { id: 's21', name: 'breach top', set: 'ocean', owner: 'monster', start: 38.5, end: 42.37 },
  { id: 's22', name: 'belly', set: 'bridge', owner: 'ships', start: 42.37, end: 45.1 },
  { id: 's23', name: 'big wave', set: 'ocean', owner: 'ships', start: 45.1, end: 49.33 },
  { id: 's24', name: 'fog', set: 'ocean', owner: 'monster', start: 49.33, end: 51.3 },
  { id: 's25', name: 'port', set: 'port', owner: 'world', start: 51.3, end: 52.57 },
  { id: 's26', name: 'reentry', set: 'orbit', owner: 'world', start: 52.57, end: 54 },
  { id: 's27', name: 'canyon', set: 'under', owner: 'under', start: 54, end: 57.73 },
  { id: 's28', name: 'plasma', set: 'sky', owner: 'world', start: 57.73, end: 59.57 },
  { id: 's29', name: 'monster head', set: 'under', owner: 'under', start: 59.57, end: 60.9 },
  { id: 's30', name: 'impact', set: 'ocean', owner: 'ships', start: 60.9, end: 62.9 },
  { id: 's31', name: 'pierce', set: 'under', owner: 'under', start: 62.9, end: 65.23 },
  { id: 's32', name: 'claws', set: 'under', owner: 'under', start: 65.23, end: 66.83 },
  { id: 's33', name: 'surface', set: 'under', owner: 'under', start: 66.83, end: 68.17 },
  { id: 's34', name: 'mound', set: 'under', owner: 'under', start: 68.17, end: 69.23 },
  { id: 's35', name: 'tip out', set: 'under', owner: 'under', start: 69.23, end: 70.2 },
  { id: 's36', name: 'rock burst', set: 'under', owner: 'under', start: 70.2, end: 72.3 },
  { id: 's37', name: 'run through', set: 'under', owner: 'under', start: 72.3, end: 74.73 },
  { id: 's38', name: 'water mountain', set: 'ocean', owner: 'monster', start: 74.73, end: 77 },
  { id: 's39', name: 'flip', set: 'ocean', owner: 'monster', start: 77, end: 83 },
];

const CAMS = {}, LOOKS = {};
export function registerCams(mod) { Object.assign(CAMS, mod.CAMS || {}); Object.assign(LOOKS, mod.LOOKS || {}); }

// Placeholder framing per set until the owning department sets a real camera.
const DEFAULT_CAM = {
  coast: { pos: [0, 60, 300], look: [0, 60, 0], fov: 35 }, deck: { pos: [0, 40, 0], look: [0, 40, -300], fov: 40 },
  sky: { pos: [0, 2000, 0], look: [0, 2000, -300], fov: 40 }, orbit: { pos: [0, 3000, 0], look: [0, 2000, -2000], fov: 40, far: 9000 },
  ocean: { pos: [0, 30, 900], look: [0, 60, 0], fov: 35 }, bridge: { pos: [0, 40, 0], look: [0, 40, -200], fov: 45 },
  under: { pos: [0, -60, 200], look: [0, -80, 0], fov: 45 }, port: { pos: [0, 3000, 0], look: [0, 0, -2000], fov: 40 },
};
const DEFAULT_LOOK = { k: 1, sunElev: 42, sunAz: 150 };

export function shotAt(t) {
  for (let i = 0; i < SHOTS.length; i++) if (t < SHOTS[i].end) return i;
  return SHOTS.length - 1;
}

export function evalFrame(frame) {
  const t = frame / FPS;
  const si = shotAt(t);
  const sh = SHOTS[si];
  const lt = t - sh.start, dur = sh.end - sh.start;
  const st = { frame, t, si, sid: sh.id, shot: sh.name, set: sh.set, lt, dur, cues: CUES, fade: 0, fadeColor: '#ffffff', shadow: null, key: null };
  const lf = LOOKS[sh.id];
  st.look = { ...DEFAULT_LOOK, ...(lf ? lf(lt, dur, t, st) : {}) };
  st.shadow = st.look.shadow ?? null;
  st.key = st.look.key ?? null;
  const cf = CAMS[sh.id];
  st.cam = cf ? cf(lt, dur, t, st) : DEFAULT_CAM[sh.set];
  // the film ends on the crash: a fast fade to white in the final second
  if (t > 82) st.fade = smooth(invLerp(82, 83, t)) * 0.9;
  if (t < 0.3) st.fade = 1 - smooth(t / 0.3);
  void lerp;
  return st;
}
