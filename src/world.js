import * as THREE from 'three';
import { skyMaterial } from './bgmaterials.js';
import { ENV } from './passes-env.js';
import { makeClouds } from './world-sky.js';
import { onThrees } from './util.js';

// World department: sky, sea, coast, planet, port. Sets toggle on state.set.
async function sub(file, fn, ctx) {
  try { const m = await import(file); return (await m[fn](ctx)) || null; }
  catch (e) { console.error(`[world:${file}] ${e.stack || e}`); return null; }
}

export async function buildWorld(ctx) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(8500, 48, 24), skyMaterial(makeClouds()));
  sky.renderOrder = -10; sky.frustumCulled = false; sky.userData.noShadow = true;
  ctx.scene.add(sky);
  // the atmosphere pass hazes the far sea to the sky's own horizon colour (shared, so looks carry over)
  const au = ctx.engine.mAtmos.uniforms, su = sky.material.uniforms;
  au.uHazeCool = su.uHorizonCool; au.uHazeWarm = su.uHorizonWarm;

  const world = {
    sky,
    terrain: () => -40,      // the coast builder replaces this
    oceanOn: 1,
    // { x, z, heading, length }: drawn ship wakes for the water pass (auto-filled from ctx.ships.fleet)
    wakes: null,
    update() {},
  };
  const parts = [];
  ctx.world = world;         // sub-builders can reach world.sky etc.
  for (const [file, fn] of [['./world-sea.js', 'buildSea'], ['./world-coast.js', 'buildCoast'], ['./world-planet.js', 'buildPlanet'], ['./world-port.js', 'buildPort'], ['./world-flight.js', 'buildFlight']]) {
    const p = await sub(file, fn, ctx);
    if (p) parts.push(p);
  }
  world.update = (st) => {
    ENV.uEnvTime.value = onThrees(st.t);
    ctx.engine.mWater.uniforms.uFxTime.value = onThrees(st.t);
    sky.position.copy(ctx.camera.position);
    for (const p of parts) { try { p.update?.(st); } catch (e) { console.error(`[world] ${e.stack || e}`); } }
  };
  return world;
}
