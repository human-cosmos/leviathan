import * as THREE from 'three';
import { PuffBatch, SheetBatch, QuadBatch, Ripples, puffMaterial, sheetMaterial, decalMaterial, mistMaterial } from './fx-splash-core.js';
import { createEmit } from './fx-splash-emit.js';
import { createSeaShots } from './fx-splash-sea.js';
import { createBigShots } from './fx-splash-big.js';
import { createUnderShots } from './fx-splash-under.js';
import { onThrees } from './util.js';

// FX Water: everything wet, at ocean scale. Bold white masses with blue shade and ink,
// drawn on threes. Each shot has its own recipe; nothing carries from frame to frame.
//   main scene : puffs (billows, tongues, drops), sheets (pouring water), rocks, containers, water meshes
//   overlay    : foam decals on the sea, soft spray
//   water pass : uRip / uRipB rings, uFxTime on threes

export function createSplash(ctx) {
  const { scene, overlay, engine, camera } = ctx;
  const S = engine.S;
  const B = {
    puffs: new PuffBatch(puffMaterial(S), 16000),
    sheets: new SheetBatch(sheetMaterial(S), 420, 18),
    decals: new QuadBatch(decalMaterial(S), 180, { iP: 4, iD: 4, iE: 4 }),
    mist: new QuadBatch(mistMaterial(), 700, { iPos: 3, iS: 4, iC: 4 }),
    ripples: new Ripples(engine.mWater.uniforms),
  };
  B.decals.mesh.renderOrder = 1;
  B.mist.mesh.renderOrder = 3;
  scene.add(B.puffs.mesh, B.sheets.mesh);
  overlay.add(B.decals.mesh, B.mist.mesh);

  const E = createEmit(B);
  const sea = createSeaShots(ctx, B, E);
  const big = createBigShots(ctx, B, E, sea);
  const under = createUnderShots(ctx, B, E);
  const SHOTS = { ...sea.shots, ...big.shots, ...under.shots };
  const parts = [sea, big, under];

  const wu = engine.mWater.uniforms;
  const LV = new THREE.Vector3(-0.52, 0.72, 0.46).normalize();
  const api = {
    B, E,
    // the sea surface height of the FX meshes (water mountain, the swell), so ships can ride them
    seaHeight: (x, z, t) => big.seaHeight?.(x, z, t) ?? 0,
    impact: big.impact,
    update(st) {
      const t = st.t;
      const tq = onThrees(t);
      E.I.t = t; E.I.tq = tq; E.I.draw = Math.floor(tq * 8 + 0.5);
      E.I.cam = camera; E.I.st = st;
      E.I.camPos.copy(camera.position);
      E.I.L.copy(LV).transformDirection(camera.matrixWorld);
      const k = (1040 / 2) / Math.tan((camera.fov * Math.PI) / 360);
      E.I.pxm = (d) => k / Math.max(d, 0.05);
      wu.uFxTime.value = tq;
      wu.uWake.value.set(0, 0, 0, 0);
      B.puffs.begin(); B.sheets.begin(); B.decals.begin(); B.mist.begin(); B.ripples.begin();
      B.puffs.mesh.material.uniforms.uDrawing.value = E.I.draw;
      B.decals.mesh.material.uniforms.uDrawing.value = E.I.draw;
      B.mist.mesh.material.uniforms.uDrawing.value = E.I.draw;
      for (const p of parts) p.begin?.(st);
      SHOTS[st.sid]?.(st, st.lt);
      for (const p of parts) p.end?.(st);
      B.puffs.end(); B.sheets.end(); B.decals.end(); B.mist.end(); B.ripples.end();
    },
  };
  return api;
}
