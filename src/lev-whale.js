import * as THREE from 'three';
import { Spine, baseQuat } from './lev-spine.js';
import { Geo, addTube, hideMaterial } from './lev-mat.js';
import { curve, loftBody } from './lev-body.js';
import { addBlade } from './lev-limbs.js';

// A rigged humpback, modelled at unit proportions and scaled by `len` (metres).
// opts: { len = 120, neck = 0 (a lure's stalk, metres), back, belly, id }
// API: root, show(b), pose({ pos, yaw, pitch, roll, bend, side, flukes, flippers, center }),
//      path(fn(s, out), upFn?) to lay the whole chain on a curve (s 0 tail/stalk root .. 1 snout),
//      anchor(name, vec3): head, tail, belly, back, root, flipperL, flipperR
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const V = THREE.Vector3, Q = THREE.Quaternion;

const WK = {
  // the tail stock is a tall, narrow blade: much deeper than it is wide right down to the flukes
  xw: curve([[0, 0.0075], [0.05, 0.0105], [0.1, 0.0165], [0.18, 0.034], [0.28, 0.066], [0.45, 0.106], [0.62, 0.128], [0.76, 0.116], [0.9, 0.08], [0.97, 0.052], [1, 0.022]]),
  ty: curve([[0, 0.013], [0.05, 0.02], [0.1, 0.031], [0.18, 0.05], [0.28, 0.077], [0.45, 0.104], [0.62, 0.118], [0.76, 0.096], [0.9, 0.056], [0.97, 0.03], [1, 0.012]]),
  by: curve([[0, -0.013], [0.05, -0.021], [0.1, -0.034], [0.18, -0.056], [0.28, -0.083], [0.45, -0.112], [0.62, -0.142], [0.76, -0.134], [0.9, -0.09], [0.97, -0.048], [1, -0.012]]),
  lip: curve([[0.70, -0.005], [0.76, -0.045], [0.84, -0.05], [0.92, -0.028], [0.98, -0.01], [1, 0]]),
};
const WZC = 0.76;
const FL_T = 0.655, FL_LEN = 0.38, FL_W = 0.05;              // flipper station, length and half chord (of len)
const FK_C = 0.155, FK_SPAN = 0.215, FK_LEN = FK_C * 1.35;    // fluke root chord, half span, chain length
const FK_T = 0.07;                                            // where the fluke chain lands on the tail stock

const cache = new Map();
function whaleGeo(len, neck) {
  const key = `${len}|${neck}`;
  if (cache.has(key)) return cache.get(key);
  const g = new Geo(), T = neck + len;
  const sec = (z) => {
    const t = (z - neck) / len, c0 = 0.965, cap = t > c0 ? Math.sqrt(Math.max(0, 1 - ((t - c0) / (1 - c0)) ** 2)) : 1;
    const lip = WK.lip(t) * ss(0.62, 0.74, t) * len;
    return { rx: WK.xw(t) * len * cap, top: (WK.ty(t) * len - lip) * cap, bot: (lip - WK.by(t) * len) * cap, cy: lip, e: 2 / 2.1, t };
  };
  const sculpt = (z, phi) => {
    const t = (z - neck) / len, isUp = phi <= Math.PI;
    let d = 0;
    if (isUp) {
      const up = Math.abs(phi - Math.PI / 2);
      d += 0.012 * len * Math.exp(-((t - 0.32) ** 2) / 0.003) * Math.exp(-up / 0.14);            // dorsal hump
      d += 0.02 * len * Math.exp(-(((t - 0.335) / (t < 0.335 ? 0.016 : 0.04)) ** 2)) * Math.exp(-up / 0.06);   // the stubby dorsal fin
      d += 0.006 * len * Math.exp(-((t - 0.72) ** 2) / 0.002) * Math.exp(-((Math.min(phi, Math.PI - phi) - 0.42) ** 2) / 0.03); // brow
      // tubercle bumps on the rostrum
      if (t > 0.82) d += 0.0035 * len * Math.max(0, Math.sin(t * 90) * Math.sin(phi * 13));
      // the ridge along the top of the tail stock, running out into the fluke root
      d += 0.0075 * len * ss(0.34, 0.14, t) * Math.exp(-up / 0.11);
    } else {
      // the keel under the stock
      d += 0.007 * len * ss(0.3, 0.12, t) * Math.exp(-Math.abs(phi - 1.5 * Math.PI) / 0.12);
      // the shoulder: the flipper's root swells out of the flank, so it grows from the body
      const a = Math.exp(-((t - FL_T + 0.012) ** 2) / 0.0026);
      d += 0.017 * len * a * (Math.exp(-((phi - 1.72 * Math.PI) ** 2) / 0.05) + Math.exp(-((phi - 1.28 * Math.PI) ** 2) / 0.05));
    }
    return d;
  };
  const zs = [];
  let z = neck + 0.002 * len;
  while (z < T - 0.0002 * len) {
    zs.push(z);
    const t = (z - neck) / len;
    z += len * (t < 0.95 ? 0.0085 : 0.0085 * Math.max(0.1, (1 - t) / 0.05));
  }
  zs.push(T - 0.0001 * len);
  const bellyFn = (phi, t) => {
    const a = phi <= Math.PI ? Math.abs(phi - Math.PI / 2) / Math.PI : 0.5 + (1 - Math.abs(phi - 1.5 * Math.PI) / (Math.PI / 2)) * 0.5;
    return a - 0.05 * ss(0.4, 0.15, t);
  };
  loftBody(g, {
    zs, Nu: 56, Nl: 56, secFn: sec, zc: neck + WZC * len, sculptFn: sculpt, bellyFn, part: 8,
    jawFn: (zz, a, lower) => (lower && zz > neck + WZC * len ? 1 : 0),
  });
  // eyes
  const eye = (side) => {
    const ze = neck + 0.75 * len, S = sec(ze), ph = -0.03, c = Math.cos(ph), s = Math.sin(ph);
    const x = side * S.rx * Math.abs(c) ** S.e, y = S.cy + S.bot * 0.12 + s;
    addTube(g, [[x - side * 0.008 * len, y, ze - 0.004 * len], [x, y, ze], [x, y, ze + 0.004 * len]], [0.002 * len, 0.012 * len, 0.002 * len], { seg: 8, part: 5, belly: 0.5, up: new V(0, 0, 1) });
  };
  eye(1); eye(-1);
  if (neck > 0) {
    // the stalk: thick where it leaves the throat, tapering into the tail
    const pts = [], r = [], N = 40, r0 = 0.066 * len, r1 = 0.013 * len;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      pts.push([0, 0, 0.002 * neck + u * (neck + 0.06 * len)]);
      r.push(r1 + (r0 - r1) * Math.pow(1 - u, 1.4) + 0.05 * r0 * Math.sin(u * 40));
    }
    addTube(g, pts, r, { seg: 12, part: 7, belly: 0.5, up: new V(1, 0, 0) });
  }
  const out = g.build();
  cache.set(key, out);
  return out;
}

// Limbs: only meshes the body chain does not carry. Their ink id is the body's, so no line rings the root.
const limbCache = new Map();
// humpback flipper: thick round shoulder, widening to the wrist, long sickle sweep, knobbed leading edge
function limbGeo(len, side) {
  const k = `f${len}|${side}`;
  if (!limbCache.has(k)) {
    const g = new Geo(), W = FL_W * len, L = FL_LEN * len, first = g.count;
    addBlade(g, L, (u) => {
      const w = W * (0.9 + 0.3 * ss(0.04, 0.34, u) - 0.1 * ss(0.5, 0.8, u)) * Math.pow(Math.max(0, 1 - u ** 2.2), 0.72);
      const cx = -W * 0.8 * u ** 1.7;                                         // the sickle
      const tub = 1 + 0.1 * Math.abs(Math.sin(u * Math.PI * 7.5)) * ss(0.2, 0.34, u);
      return { x0: cx - w * 0.82, x1: cx + w * tub, t: W * (0.2 + 0.72 * ss(0.5, 0, u)) * Math.pow(Math.max(0, 1 - u), 0.3) + 0.002 * len };
    }, { part: 8, topY: -side, top: 0.15, under: 0.86, rings: 60, chord: 16 });
    for (let i = first; i < g.count; i++) {
      const u = g.uv[i * 2], w = g.uv[i * 2 + 1], d = g.info[i * 4 + 3];
      // dark arm with a pale panel under the inner half, inside a dark rim
      const under = d > 0.5 ? 0.42 + 0.46 * ss(0, 0.2, w) * ss(1, 0.74, w) * ss(0.8, 0.5, u) : d;
      // the shoulder wears the flank's colour, the dark of the arm runs out of it
      g.info[i * 4 + 3] = under + (0.72 - under) * ss(0.24, 0.05, u);
      g.info[i * 4 + 2] *= 5;                     // stretches the hide's spots into streaks along the arm
    }
    limbCache.set(k, g.build());
  }
  return limbCache.get(k);
}
// flukes: broad, swept, notched. Rest along z: 0 the trailing tips .. FK_LEN the fillet that runs up the stock
function flukeGeo(len) {
  const k = `t${len}`;
  if (!limbCache.has(k)) {
    const g = new Geo(), c = FK_C * len, b = FK_SPAN * len, th = 0.017 * len, S = 56, C = 30;
    const lead = (u) => c * (1 - u ** 1.45) + 0.35 * c * Math.exp(-((u / 0.075) ** 2));
    const trail = (u) => c * (0.06 * Math.sin(Math.PI * u) ** 0.7 + 0.32 * Math.exp(-((u / 0.075) ** 2)));
    for (const skin of [1, -1]) for (const sd of [1, -1]) {
      const f0 = g.count;
      for (let i = 0; i <= S; i++) {
        const u = (i / S) ** 1.15, x = sd * u * b;
        for (let j = 0; j <= C; j++) {
          const w = j / C, z = trail(u) + (lead(u) - trail(u)) * w;
          const prof = Math.pow(Math.sin(Math.PI * (w * 0.98 + 0.01)), 0.6);
          const t = th * Math.pow(1 - u, 0.75) * prof + 0.0012 * len * prof;
          const rim = ss(0, 0.14, w) * ss(1, 0.72, w) * ss(1, 0.84, u);        // the underside is white inside a dark rim
          g.v(x, skin * t - c * 0.2 * u * u, z, u, w, 0, 8, x * 4, skin > 0 ? 0.16 : 0.34 + 0.54 * rim);
        }
      }
      const row = C + 1;
      for (let i = 0; i < S; i++) for (let j = 0; j < C; j++) {
        const p = f0 + i * row + j, q = p + 1, r = p + row, t = r + 1;
        if (skin * sd > 0) g.quad(p, q, t, r); else g.quad(p, r, t, q);
      }
    }
    limbCache.set(k, g.build());
  }
  return limbCache.get(k);
}

const AX = new V(1, 0, 0), AY = new V(0, 1, 0), AZ = new V(0, 0, 1);
const _p = new V(), _q = new Q(), _q2 = new Q(), _q3 = new Q(), _v = new V();

// base rotation mapping flipper-local axes onto the body: length out sideways, chord forward
const Q0 = (side) => new Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new V(0, 0, 1), new V(0, -side, 0).clone().multiplyScalar(1), new V(side, 0, 0)));

let whaleCount = 0;
export function makeWhale(ctx, o = {}) {
  const len = o.len ?? 120, neck = o.neck ?? 0, T = len + neck, n = o.bones ?? (neck > 0 ? 38 : 26);
  const spine = new Spine(T, n);
  spine.uniforms.uHinge.value.set(-0.03 * len, neck + 0.74 * len);
  const shared = { run: o.run ?? { value: 0 }, foam: o.foam ?? { value: 0 } };
  const id = (o.id ?? 66) + (whaleCount++ % 3) * 2;
  const look = { back: o.back ?? '#24466f', flank: o.back ?? '#24466f', bellyRGB: o.bellyRGB, scale: 120 / len, pleat: (neck + 0.5 * len) * 120 / len, ...shared };
  const root = new THREE.Group();
  root.name = 'whale';
  const add = (geo, sp, i) => {
    const m = new THREE.Mesh(geo, hideMaterial(sp, { ...look, id: id + i }));
    m.frustumCulled = false; root.add(m);
    return m;
  };
  add(whaleGeo(len, neck), spine, 0);
  const flipL = new Spine(len * FL_LEN, 9), flipR = new Spine(len * FL_LEN, 9), fluke = new Spine(len * FK_LEN, 8);
  add(limbGeo(len, 1), flipL, 0); add(limbGeo(len, -1), flipR, 0); add(flukeGeo(len), fluke, 0);
  // low on the flank behind the head, sunk into the shoulder swelling
  const restFl = (side) => new V(side * 0.076 * len, -0.102 * len, neck + FL_T * len);
  const q0L = Q0(1), q0R = Q0(-1);
  const flipState = { sweep: 0.6, droop: 0.5 };

  const poseLimbs = (p) => {
    // flippers
    const kf = p.flippers ?? 0.5;
    for (const [sp, side, q0] of [[flipL, 1, q0L], [flipR, -1, q0R]]) {
      const fp = side > 0 ? p.flipL : p.flipR;
      const sweep = fp?.sweep ?? THREE.MathUtils.lerp(1.15, 0.2, kf), droop = fp?.droop ?? THREE.MathUtils.lerp(0.55, -0.1, kf);
      const twist = fp?.twist ?? 0, curl = fp?.curl ?? 0.05;
      spine.toWorld(_v.copy(restFl(side)), _p);
      spine.at((neck + FL_T * len) / T, _v, _q);
      _q2.setFromAxisAngle(AY, sweep * side); _q.multiply(_q2);
      _q2.setFromAxisAngle(AZ, -droop * side); _q.multiply(_q2);
      _q.multiply(q0);
      _q2.setFromAxisAngle(AZ, twist * side); _q.multiply(_q2);
      // the arm bends at the elbow, tip trailing and hanging (the same way on both sides)
      sp.fromRoot(_p, _q, (s, v) => { const e = 0.5 + 0.9 * Math.exp(-(((s - 0.36) / 0.2) ** 2)); v[0] = -side * 0.035 * e; v[1] = -curl * 1.3 * e; v[2] = 0; });
    }
    // flukes: continue the chain past the tail
    const fl = p.flukes ?? 0;
    // the fluke chain's z runs tips (0) -> fillet (FK_LEN): its last bone lands on the stock, the rest trails behind.
    // Pure curl, so the flukes keep following the bend of the stock.
    spine.at((neck + FK_T * len) / T, _p, _q);
    fluke.fromCurl(fluke.n - 1, _q, _p, (s, v) => { v[0] = -fl * 0.1 * (1.5 - s); v[1] = 0; v[2] = 0; });
  };

  const api = {
    root, spine, len, neck,
    show(b) { root.visible = !!b; },
    pose(p) {
      const c = Math.round((n - 1) * (p.center ?? (neck + 0.55 * len) / T));
      baseQuat(p.yaw ?? 0, p.pitch ?? 0, p.roll ?? 0, _q3);
      const bend = (p.bend ?? 0) / (n - 1) * 3, side = (p.side ?? 0) / (n - 1) * 3, wave = p.wave ?? 0, ph = p.phase ?? 0;
      spine.fromCurl(c, _q3, _v.set(...p.pos), (s, v) => {
        const hd = ss(0.86, 0.72, (s * T - neck) / len);
        v[0] = bend * hd + (p.curlFn ? p.curlFn(s) : 0) + wave * 0.1 * Math.sin(s * 6 + ph) * hd; v[1] = side * hd; v[2] = 0;
      });
      spine.uniforms.uJaw.value.set(p.jaw ?? 0, 0);
      poseLimbs(p);
    },
    path(fn, upFn, p = {}) {
      spine.fromPath(fn, upFn);
      spine.uniforms.uJaw.value.set(p.jaw ?? 0, 0);
      poseLimbs(p);
    },
    anchor(name, out = new V()) {
      const at = (s) => spine.at(s, out);
      switch (name) {
        case 'head': return at(1);
        case 'tail': return at(neck / T);
        case 'fluke': return fluke.at(0, out);
        case 'root': return at(0);
        case 'back': return spine.toWorld(_v.set(0, 0.11 * len, neck + 0.5 * len), out);
        case 'belly': return spine.toWorld(_v.set(0, -0.12 * len, neck + 0.55 * len), out);
        case 'flipperL': return flipL.at(1, out);
        case 'flipperR': return flipR.at(1, out);
        default: return at(0.5);
      }
    },
  };
  ctx.scene.add(root);
  ctx.shadowRoots.push(root);
  root.visible = false;
  return api;
}
