import { ENV } from './passes-env.js';

// The sea is a screen-space pass (passes-env.js + world-ocean-glsl.js). This part feeds it:
// ship wakes from the fleet, and a colossal shadow under the surface.
export function buildSea(ctx) {
  const world = ctx.world;
  const slots = ENV.uShipWake.value;
  world.setWakes = (list) => { world.wakes = list; };
  // { x, z, heading, strength, halfLength, halfWidth }
  world.seaShadow = (s) => {
    if (!s) { ENV.uSeaShadow.value.w = 0; return; }
    ENV.uSeaShadow.value.set(s.x, s.z, s.heading ?? 0, s.strength ?? 0.8);
    ENV.uSeaShadowB.value.set(s.halfLength ?? 600, s.halfWidth ?? 160, 0, 0);
  };
  world.seaCalm = (k) => { ENV.uSeaCalm.value = k; };
  // Sampled when the frame is rendered, after every department has updated.
  const sync = () => {
    const st = ctx.world.state;
    const list = world.wakes ?? (st && (st.set === 'ocean' || st.set === 'deck') ? (ctx.ships?.fleet ?? []) : []);
    for (let i = 0; i < 8; i++) {
      const s = list[i], v = slots[i];
      if (!s) { v.w = 0; continue; }
      const p = s.root?.position ?? s.pos ?? s;
      const x = p.x ?? p[0], z = p.z ?? p[2];
      const heading = s.heading ?? s.root?.rotation?.y ?? 0;
      v.set(x, z, heading, s.wake ?? s.length ?? 1400);
    }
  };
  world.sky.onBeforeRender = sync;
  return {
    update(st) { ctx.world.state = st; ENV.uSeaShadow.value.w = 0; ENV.uSeaCalm.value = 0; world.wakes = null; },
  };
}
