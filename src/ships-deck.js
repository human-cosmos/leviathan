import * as THREE from 'three';
import { createS16 } from './ships-s16.js';

// The 'deck' set: the hero ship at the origin, bow toward -Z.
const WALL = ['#b8452f', '#c9533a', '#a93c2c', '#b84a36'];
export function createDeck(ctx, api) {
  const g = new THREE.Group();
  g.name = 'deckset';
  ctx.scene.add(g);
  ctx.shadowRoots.push(g);
  // the wall of s10: tall outer rows on the +x side, low stacks between the camera and the tower
  const gap = (bay, r, n) => {
    if (bay.zone) return 0;
    const x = (r - (n - 1) / 2) * 2.53;
    if (x > 15) return bay.z < 64 ? 8 : 0;
    if (x > -14 && bay.z < 60) return bay.z < 0 ? 2 : 3;
    return 0;
  };
  // one long rust-red run of boxes, the wall of the reference frame
  const paint = (bay, r, n, t) => {
    const x = (r - (n - 1) / 2) * 2.53;
    if (x > 15 && bay.z < 64) return WALL[(Math.abs(Math.round(bay.z / 12)) + t) % WALL.length];
    return null;
  };
  const hero = api.makeShip({ hero: true, kind: 'navy', seed: 3, tiers: 7, gap, paint, staticGeo: api.staticGeo(true) });
  hero.rotation.y = Math.PI;
  g.add(hero);
  const s16 = createS16(ctx, api, g);
  return {
    group: g, hero, s16,
    setWakeTime(t) { const w = hero.userData.wake; if (w) w.material.uniforms.uDrawT.value = t; },
    update(st) {
      g.visible = st.set === 'deck';
      hero.visible = g.visible && st.sid !== 's16';
      s16.update(st);
      if (hero.visible) hero.userData.bob(st.t);
    },
  };
}
