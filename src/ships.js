import * as THREE from 'three';
import { shipMaterial, containerMaterial, containerGeometry, wakeMaterial, BOX, CLIP } from './ships-mat.js';
import { hullTexture, logoAtlas, wakeTexture, WAKE } from './ships-tex.js';
import { H, halfBeam, buildStatic, hullGeometry, layoutContainers, instancedContainers } from './ships-model.js';
import { noise1, onThrees, deg } from './util.js';
import { createSwell } from './ships-swell.js';
import { createBridge } from './ships-bridge.js';
import { createDeck } from './ships-deck.js';
import { S30 } from './cams/ships.js';

// Ships department: fleet, hero ship, deck / bridge sets, swell.
export const HULLS = {
  navy: { hull: '#1c49a0', anti: '#c43a2b', line: 'KAIYO', name: 'KAIYO STAR', deck: '#2f9a78' },
  red: { hull: '#a62a2c', anti: '#2b2a44', boot: '#f4efe2', line: 'TRITON', name: 'TRITON PRIDE', deck: '#3a8d8a', seed: 9 },
  teal: { hull: '#128a8e', anti: '#c43a2b', line: 'NEREID', name: 'NEREID', deck: '#2f9a78', seed: 13 },
};

export function createShips(ctx) {
  const { scene } = ctx;
  const tex = {
    logo: logoAtlas(),
    wake: wakeTexture(halfBeam),
    hull: {},
  };
  const boxGeo = containerGeometry();
  const cMat = containerMaterial(tex.logo);
  const mats = {
    static: shipMaterial({ weather: 1 }),
    hull: {},
  };
  const wakeGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
  const geoCache = {};
  const staticGeo = (hero) => (geoCache[hero ? 'h' : 'l'] ??= buildStatic({ hero }));

  function hullMat(kind) {
    if (!mats.hull[kind]) {
      tex.hull[kind] = hullTexture(HULLS[kind]);
      mats.hull[kind] = shipMaterial({ map: tex.hull[kind], weather: 0.5, mapGamma: 1.5 });
    }
    return mats.hull[kind];
  }

  // { hero, kind: navy|red|teal, tiers, seed, wake }
  function makeShip(o = {}) {
    const root = new THREE.Group();
    const kind = o.kind ?? 'navy';
    const hull = new THREE.Mesh(hullGeometry(), hullMat(kind));
    hull.frustumCulled = false;
    root.add(hull);
    const st = new THREE.Mesh(o.staticGeo ?? staticGeo(!!o.hero), mats.static);
    st.frustumCulled = false;
    root.add(st);
    const list = o.list ?? layoutContainers({ seed: o.seed ?? 11, tiers: o.tiers ?? 7, gap: o.gap, paint: o.paint });
    const boxes = instancedContainers(list, boxGeo, cMat);
    root.add(boxes);
    root.userData.list = list;
    root.userData.boxes = boxes;
    let wake = null;
    if (o.wake !== false) {
      const wm = wakeMaterial(tex.wake, { phase: o.seed ?? 1 });
      wake = new THREE.Mesh(wakeGeo, wm);
      wake.rotation.x = -Math.PI / 2;
      const len = WAKE.zAhead - WAKE.zAstern;
      wake.scale.set(WAKE.xw * 2, len, 1);
      wake.position.set(0, 0.35, (WAKE.zAhead + WAKE.zAstern) / 2);
      wake.frustumCulled = false; wake.userData.noShadow = true; wake.userData.noReflect = true;
      // plane uv: u across, v along; remap in the geometry below
      root.add(wake);
      root.userData.wake = wake;
    }
    root.userData.bob = (t) => {
      const s = (o.seed ?? 1) * 1.7;
      root.position.y = o.y ?? 0;
      root.position.y += noise1(t * 0.17, s) * 0.5;
      root.rotation.x = noise1(t * 0.13, s + 3) * 0.006 + (o.pitch ?? 0);
      root.rotation.z = noise1(t * 0.11, s + 5) * 0.012;
    };
    return root;
  }
  // the plane's own uv runs (u: x, v: y); the mask wants (u: along from the bow, v: across)
  {
    const uv = wakeGeo.attributes.uv, p = wakeGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) { uv.setXY(i, 0.5 - p.getY(i), p.getX(i) + 0.5); }
  }

  function makeContainer(i = 0) {
    const list = [{ x: 0, y: 0, z: 0, col: ['#bb3a2a', '#1f4fb0', '#ea7a24', '#1c9c8e', '#e8ad2e', '#2d9a4e'][i % 6], logo: i % 7, seed: (i * 0.137 + 0.11) % 1, id: 2 + (i % 50), far: 2, flip: 1, len: 1, q: new THREE.Quaternion() }];
    return instancedContainers(list, boxGeo, cMat);
  }

  // ------------------------------------------------------------ the fleet (ocean set)
  // heading: radians about +Y, 0 = bow toward +Z. The fleet steams toward -Z.
  const F = [
    { pos: [-300, 0, 180], heading: Math.PI + 0.06, kind: 'navy', seed: 21, tiers: 7, speed: 7 },
    { pos: [260, 0, 40], heading: Math.PI - 0.04, kind: 'red', seed: 22, tiers: 6, speed: 8 },
    { pos: [-720, 0, -260], heading: Math.PI + 0.1, kind: 'teal', seed: 23, tiers: 6, speed: 7 },
    { pos: [640, 0, -420], heading: Math.PI - 0.08, kind: 'navy', seed: 24, tiers: 7, speed: 6 },
    { pos: [-60, 0, -640], heading: Math.PI + 0.02, kind: 'red', seed: 25, tiers: 5, speed: 8 },
    { pos: [1100, 0, 300], heading: Math.PI + 0.05, kind: 'teal', seed: 26, tiers: 5, speed: 7 },
  ];
  const fleetGroup = new THREE.Group();
  fleetGroup.name = 'fleet';
  scene.add(fleetGroup);
  const fleet = F.map((f) => {
    const root = makeShip(f);
    fleetGroup.add(root);
    root.rotation.y = f.heading;
    return { root, pos: new THREE.Vector3(...f.pos), pos0: f.pos, heading: f.heading, speed: f.speed, sink: 0, roll: 0, pitch: 0, hide: false };
  });

  const api = { fleet, makeShip, makeContainer, H, halfBeam, tex, mats, cMat, boxGeo, staticGeo };
  // sky colours for a shot, set after the look has been applied; the next frame's look resets them
  api.deepSky = (mid, warm, cool) => {
    const su = ctx.world?.sky?.material?.uniforms;
    if (su) { su.uMid.value.set(mid); su.uHorizonWarm.value.set(warm); su.uHorizonCool.value.set(cool); }
  };
  const deck = createDeck(ctx, api);
  const bridge = createBridge(ctx, api);
  const swell = createSwell(ctx, api);
  Object.assign(api, { deck, bridge, swell });

  function setWakes(t) {
    const dt = onThrees(t);
    for (const f of fleet) { const w = f.root.userData.wake; if (w) w.material.uniforms.uDrawT.value = dt; }
    deck.setWakeTime?.(dt);
  }

  // s30: the frame is composed from the camera, ship by ship, like the reference
  function holdS30(st) {
    const c = st.cam, fx = Math.atan2(c.look[0] - c.pos[0], c.pos[2] - c.look[2]);
    const ax = Math.sin(fx), az = -Math.cos(fx);
    const tw = Math.tan((c.fov * Math.PI) / 360) * (1920 / 1040);
    const live = [];
    fleet.forEach((f, i) => {
      const L = S30.layout[i];
      f.root.visible = !!L;
      if (!L) return;
      const off = (L.fx - 0.5) * 2 * tw * L.d, drift = (st.t - 60.9) * 7;
      const hdg = fx + L.hdg;
      const x = c.pos[0] * 0 + S30.pos[0] + ax * L.d - az * off + Math.sin(hdg) * drift;
      const z = S30.pos[2] + az * L.d + ax * off + Math.cos(hdg) * drift;
      f.root.position.x = x; f.root.position.z = z;
      f.root.rotation.y = hdg;
      live.push({ root: f.root, heading: hdg, wake: 900 });
    });
    ctx.world?.setWakes?.(live);
    api.deepSky('#2f92f2', '#bfe6fa', '#a8dcf8');
    const wu = ctx.engine.mWater.uniforms;
    wu.uDeep.value.set('#072f9c'); wu.uShallow.value.set('#0c62c4'); wu.uSkyRefl.value.set('#5aa4ec');
  }

  api.update = (st) => {
    const t = st.t;
    setWakes(t);
    const ocean = st.set === 'ocean' && !swell.active(st) && !st.look?.noFleet;
    fleetGroup.visible = ocean;
    if (ocean) {
      for (const f of fleet) {
        f.root.visible = !f.hide;
        const d = t - 40;
        f.pos.set(f.pos0[0] + Math.sin(f.heading) * f.speed * d, -f.sink, f.pos0[2] + Math.cos(f.heading) * f.speed * d);
        f.root.position.copy(f.pos);
        f.root.rotation.y = f.heading;
        f.root.userData.bob(t);
        f.root.position.y -= f.sink;
        f.root.rotation.x += f.pitch;
        f.root.rotation.z += f.roll;
      }
    }
    CLIP.value = st.set === 'ocean' ? 1 : 0;
    if (st.sid === 's30') holdS30(st);
    deck.update(st);
    bridge.update(st);
    swell.update(st);
  };
  void BOX; void deg;
  return api;
}
