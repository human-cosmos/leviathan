import * as THREE from 'three';
import { Spine, baseQuat } from './lev-spine.js';
import { hideMaterial, Geo } from './lev-mat.js';
import { buildMonsterGeometry, L, HINGE, ZC, section } from './lev-body.js';
import { buildHandFlipper, addFluke } from './lev-limbs.js';
import { makeWhale } from './lev-whale.js';
import { animate, POD } from './lev-anim.js';

// The leviathan: ~900 m of rough teal hide on one continuous GPU-bent spine.
//   ctx.leviathan.pose(p)   p = { pos, yaw, pitch, roll, spine, jaw, flukes, flippers, crawl, center,
//                                 side (lateral curl), curlFn(s) -> radians per bone, flipL/flipR {sweep,droop,twist,curl} }
//   ctx.leviathan.path(fn, upFn, p)  lay the whole spine on a curve instead (fn(s, out), s 0 tail .. 1 snout)
//   ctx.leviathan.show(bool), anchor(name, vec3), makeWhale(opts), lures[0..3], run / foam (water on the hide)
const V = THREE.Vector3, Q = THREE.Quaternion;
const AY = new V(0, 1, 0), AZ = new V(0, 0, 1);
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const Q0 = (side) => new Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new V(0, 0, 1), new V(0, -side, 0), new V(side, 0, 0)));
const _p = new V(), _v = new V(), _q = new Q(), _q2 = new Q(), _q3 = new Q();

export function createLeviathan(ctx) {
  const n = 48;
  const spine = new Spine(L, n);
  spine.uniforms.uHinge.value.set(HINGE[0], HINGE[1]);
  const run = { value: 0 }, foam = { value: 0 };
  const shared = { run, foam };
  const root = new THREE.Group();
  root.name = 'leviathan';
  const mesh = (geo, sp, id) => {
    const m = new THREE.Mesh(geo, hideMaterial(sp, { ...shared, id }));
    m.frustumCulled = false; root.add(m);
    return m;
  };
  mesh(buildMonsterGeometry(), spine, 2);

  // flippers and flukes are chains of their own, hung off the body spine each frame
  const FL = 276, CH = 62;
  const flipL = new Spine(FL * 1.2, 9), flipR = new Spine(FL * 1.2, 9), fluke = new Spine(150, 7);
  mesh(buildHandFlipper({ len: FL, chord: CH, topY: -1 }), flipL, 8);
  mesh(buildHandFlipper({ len: FL, chord: CH, topY: 1 }), flipR, 8);
  { const g = new Geo(); addFluke(g, 200, 150, 13, { part: 0, rough: 1 }); mesh(g.build(), fluke, 14); }

  ctx.scene.add(root);
  ctx.shadowRoots.push(root);
  root.visible = false;

  const zF = 0.735 * L;
  const restFl = (side) => { const S = section(zF); return new V(side * (S.rx - 6), S.cy - 42, zF); };
  const q0L = Q0(1), q0R = Q0(-1);

  function poseLimbs(p) {
    const kf = p.flippers ?? 0.5;
    for (const [sp, side, q0] of [[flipL, 1, q0L], [flipR, -1, q0R]]) {
      const fp = side > 0 ? p.flipL : p.flipR;
      const sweep = fp?.sweep ?? THREE.MathUtils.lerp(1.1, 0.25, kf), droop = fp?.droop ?? THREE.MathUtils.lerp(0.7, 0.05, kf);
      const twist = fp?.twist ?? 0, curl = fp?.curl ?? 0.04;
      spine.toWorld(_v.copy(restFl(side)), _p);
      spine.at(zF / L, _v, _q);
      _q2.setFromAxisAngle(AY, sweep * side); _q.multiply(_q2);
      _q2.setFromAxisAngle(AZ, -droop * side); _q.multiply(_q2);
      _q.multiply(q0);
      _q2.setFromAxisAngle(AZ, twist * side); _q.multiply(_q2);
      sp.fromRoot(_p, _q, (s, v) => { v[0] = 0; v[1] = curl * side; v[2] = 0; });
    }
    const fl = p.flukes ?? 0;
    spine.at(0.012, _p, _q);
    fluke.fromCurl(fluke.n - 1, _q, _p, (s, v) => { v[0] = -fl * 0.16; v[1] = 0; v[2] = 0; });
  }

  const setScale = (k) => { spine.setScale(k); flipL.setScale(k); flipR.setScale(k); fluke.setScale(k); };

  const api = {
    root, spine, run, foam, flipL, flipR, fluke, L,
    lures: [],
    show(b) { root.visible = !!b; },
    pose(p) {
      setScale(p.scale ?? 1);
      const c = Math.round((n - 1) * (p.center ?? 0.55));
      baseQuat(p.yaw ?? 0, p.pitch ?? 0, p.roll ?? 0, _q3);
      const curl = (p.spine ?? 0) * 1.5 / (n - 1), side = (p.side ?? 0) * 1.2 / (n - 1), cr = p.crawl ?? 0, crw = p.crawl === undefined ? 0 : 0.05;
      const fn = p.curlFn;
      spine.fromCurl(c, _q3, _v.set(...p.pos), (s, v) => {
        const hd = ss(0.84, 0.74, s);                     // the skull stays rigid
        v[0] = (curl + (fn ? fn(s) : 0)) * hd; v[1] = (side + crw * Math.sin(s * 9 - cr * Math.PI * 2) * (1 - s * 0.4)) * hd; v[2] = 0;
      });
      spine.uniforms.uJaw.value.set((p.jaw ?? 0) * 0.74, (p.jaw ?? 0) * 0.26);
      spine.uniforms.uWide.value = p.wide ?? 0;
      spine.uniforms.uFat.value = p.fat ?? 0;
      poseLimbs(p);
    },
    // radius of the body at s, for water clinging to it
    bodyRadius: (s) => section(Math.min(1, Math.max(0, s)) * L).rx * spine.k,
    // s15: where whale i breaks the surface
    whaleAnchor(i, out = new V()) { const b = POD[i % 4]; return out.set(b[0], 0, b[1]); },
    path(fn, upFn, p = {}) {
      setScale(p.scale ?? 1);
      spine.fromPath(fn, upFn);
      spine.uniforms.uWide.value = p.wide ?? 0;
      spine.uniforms.uFat.value = p.fat ?? 0;
      spine.uniforms.uJaw.value.set((p.jaw ?? 0) * 0.74, (p.jaw ?? 0) * 0.26);
      poseLimbs(p);
    },
    // throat point a lure's stalk leaves from, in world space
    lureRoot(i, out = new V()) {
      const S = section(ZC - 50), a = (i - 1.5) / 1.5;
      return spine.toWorld(_v.set(a * 30, S.cy - 8 + 14 * (1 - a * a), ZC - 50), out, 0.25);
    },
    anchor(name, out = new V()) {
      switch (name) {
        case 'head': return spine.toWorld(_v.set(0, 10, L - 70), out);
        case 'snout': return spine.at(1, out);
        case 'jaw': return spine.toWorld(_v.set(0, -30, L - 60), out, 1);
        case 'mouth': return spine.toWorld(_v.set(0, -20, L - 20), out);
        case 'throat': return spine.toWorld(_v.set(0, -20, ZC - 40), out);
        case 'back': return spine.toWorld(_v.set(0, 82, 0.55 * L), out);
        case 'belly': return spine.toWorld(_v.set(0, -96, 0.55 * L), out);
        case 'tail': return spine.at(0, out);
        case 'clawL': return flipL.at(1, out);
        case 'clawR': return flipR.at(1, out);
        case 'lure0': case 'lure1': case 'lure2': case 'lure3':
          return api.lures[+name[4]] ? api.lures[+name[4]].anchor('head', out) : api.lureRoot(+name[4], out);
        default: return spine.at(0.5, out);
      }
    },
    makeWhale: (o) => makeWhale(ctx, o),
  };

  // four lures on long stalks, for s18–s19
  const lureRun = { value: 0 }, lureFoam = { value: 0 };
  api.lureRun = lureRun; api.lureFoam = lureFoam;
  for (let i = 0; i < 4; i++) api.lures.push(makeWhale(ctx, { len: 196, neck: 250, id: 70 + i, run: lureRun, foam: lureFoam, back: '#2b4f86' }));
  // four free whales for s15
  api.pod = [];
  const podRun = { value: 0 };
  api.podRun = podRun;
  for (let i = 0; i < 4; i++) api.pod.push(makeWhale(ctx, { len: 120, id: 74 + i, run: podRun, back: '#2b4f86' }));

  api.update = (st) => { animate(ctx, api, st); };
  return api;
}
