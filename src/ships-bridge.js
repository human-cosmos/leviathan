import * as THREE from 'three';
import { Batch } from './ships-model.js';
import { shipMaterial } from './ships-mat.js';
import { S22 } from './cams/ships.js';
import { Rng, deg, invLerp, lerp, smooth, onTwos } from './util.js';

// The 'bridge' set (s22): the wheelhouse front seen from inside. The steel is one hand-painted
// plate with real depth in front of it, framing the two big panes; outside is the film's sea and
// sky, and the leviathan's belly sliding down an arc across them.
const W = 5.2, Hh = 3.2;                     // plate size, metres
const PX = 500;                              // canvas pixels per metre
const WIN = [
  { x0: -1.78, x1: 0.46, y0: -0.9, y1: 0.98, r: 0.2 },
  { x0: 0.76, x1: 2.72, y0: -0.9, y1: 0.98, r: 0.2 },
  { x0: -3.6, x1: -2.06, y0: -0.9, y1: 0.98, r: 0.2 },
];

function rr(p, x0, y0, x1, y1, r) {
  p.moveTo(x0 + r, y0);
  p.lineTo(x1 - r, y0); p.quadraticCurveTo(x1, y0, x1, y0 + r);
  p.lineTo(x1, y1 - r); p.quadraticCurveTo(x1, y1, x1 - r, y1);
  p.lineTo(x0 + r, y1); p.quadraticCurveTo(x0, y1, x0, y1 - r);
  p.lineTo(x0, y0 + r); p.quadraticCurveTo(x0, y0, x0 + r, y0);
  return p;
}

function plateTexture() {
  const c = document.createElement('canvas');
  c.width = W * PX; c.height = Hh * PX;
  const g = c.getContext('2d');
  const X = (x) => (x + W / 2) * PX, Y = (y) => (Hh / 2 - y) * PX;
  const rng = new Rng(62);
  const winPath = (w, grow = 0) => {
    g.beginPath();
    const r = (w.r + grow) * PX, x0 = X(w.x0 - grow), x1 = X(w.x1 + grow), y0 = Y(w.y1 + grow), y1 = Y(w.y0 - grow);
    g.moveTo(x0 + r, y0); g.arcTo(x1, y0, x1, y1, r); g.arcTo(x1, y1, x0, y1, r); g.arcTo(x0, y1, x0, y0, r); g.arcTo(x0, y0, x1, y0, r); g.closePath();
  };
  // ---- deep teal enamel, lighter where the sky falls on it
  const gr = g.createLinearGradient(0, 0, 0, c.height);
  gr.addColorStop(0, '#16324c'); gr.addColorStop(0.5, '#1d4358'); gr.addColorStop(1, '#2a5a62');
  g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
  // pooled light round each pane, hard-edged like a painted cel
  for (const w of WIN) {
    for (const [grow, col] of [[0.1, '#1f4a62'], [0.05, '#27586e']]) { winPath(w, grow); g.fillStyle = col; g.fill(); }
  }
  // ---- seams between the plates
  g.strokeStyle = 'rgba(6,14,30,0.75)'; g.lineWidth = 3;
  for (const x of [-1.92, 0.61, 2.86]) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), c.height); g.stroke(); }
  for (const y of [1.16, -1.08, -1.36]) { g.beginPath(); g.moveTo(0, Y(y)); g.lineTo(c.width, Y(y)); g.stroke(); }
  g.strokeStyle = 'rgba(150,210,220,0.22)'; g.lineWidth = 2;
  for (const x of [-1.92, 0.61, 2.86]) { g.beginPath(); g.moveTo(X(x) + 3, 0); g.lineTo(X(x) + 3, c.height); g.stroke(); }
  // ---- chipped paint and scratches along the edges
  for (let i = 0; i < 520; i++) {
    const x = rng.range(0, c.width), y = rng.range(0, c.height);
    const near = WIN.some((w) => X(w.x0) - 90 < x && x < X(w.x1) + 90 && Y(w.y1) - 90 < y && y < Y(w.y0) + 90);
    if (!near && rng.next() < 0.6) continue;
    g.fillStyle = rng.next() < 0.7 ? `rgba(120,190,196,${rng.range(0.14, 0.42)})` : `rgba(10,20,40,${rng.range(0.2, 0.5)})`;
    const l = rng.range(4, 34);
    g.save(); g.translate(x, y); g.rotate(rng.range(-0.5, 0.5) + (rng.next() < 0.5 ? Math.PI / 2 : 0));
    g.beginPath(); g.moveTo(0, 0); g.lineTo(l, rng.range(-2, 2)); g.lineTo(l * 0.6, rng.range(2, 5)); g.lineTo(0, 2); g.fill(); g.restore();
  }
  // ---- rust weeping from the corners and rivets
  for (let i = 0; i < 90; i++) {
    const w = WIN[rng.int(0, 2)];
    const u = rng.next(), x = X(lerp(w.x0, w.x1, u)), y = Y(w.y0 - 0.02);
    const h = rng.range(26, 150), wd = rng.range(2, 9);
    g.fillStyle = `rgba(${150 + rng.int(0, 50)},${70 + rng.int(0, 30)},36,${rng.range(0.16, 0.5)})`;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + wd, y); g.lineTo(x + wd * 0.6, y + h); g.lineTo(x + wd * 0.1, y + h * 0.8); g.fill();
  }
  // ---- rivets round each pane
  const rivet = (x, y, r = 6) => {
    g.fillStyle = 'rgba(4,10,24,0.8)'; g.beginPath(); g.arc(x + 1.5, y + 2, r + 1.6, 0, 7); g.fill();
    g.fillStyle = '#5f9ea4'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.fillStyle = '#c8eef0'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.35, r * 0.34, 0, 7); g.fill();
  };
  for (const w of WIN) {
    const m = 0.075, st = 0.13;
    for (let x = w.x0 + 0.1; x < w.x1 - 0.05; x += st) { rivet(X(x), Y(w.y1 + m)); rivet(X(x), Y(w.y0 - m)); }
    for (let y = w.y0 + 0.1; y < w.y1 - 0.05; y += st) { rivet(X(w.x0 - m), Y(y)); rivet(X(w.x1 + m), Y(y)); }
  }
  // ---- stencils and plates
  g.fillStyle = '#d7e8e2'; g.font = '900 34px "Arial Black", Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText('W/T  HATCH  2', X(-1.5), Y(-1.24));
  g.font = '700 22px Arial, sans-serif';
  g.fillText('NAV LT  DIMMER', X(0.9), Y(-1.2));
  g.fillStyle = '#e4bb3c'; g.fillRect(X(-0.66), Y(-1.15), 150, 44);
  g.fillStyle = '#1a2230'; g.font = '900 28px Arial, sans-serif'; g.fillText('CAUTION', X(-0.64), Y(-1.2));
  g.fillStyle = '#d43c2a'; g.beginPath(); g.arc(X(0.61), Y(-1.2), 22, 0, 7); g.fill();
  g.fillStyle = '#f4efe2'; g.fillRect(X(0.61) - 13, Y(-1.2) - 4, 26, 8);
  // ---- the reveals sample the very edge of each pane: keep it a shade lighter than the plate
  for (const w of WIN) { winPath(w, 0.0); g.lineWidth = 30; g.strokeStyle = '#2d6880'; g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

function plateGeometry() {
  const s = rr(new THREE.Shape(), -W / 2, -Hh / 2, W / 2, Hh / 2, 0.01);
  for (const w of WIN) s.holes.push(rr(new THREE.Path(), w.x0, w.y0, w.x1, w.y1, w.r));
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.13, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelOffset: -0.02, bevelSegments: 3, curveSegments: 14 }).toNonIndexed();
  g.computeVertexNormals();
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + W / 2) / W, (p.getY(i) + Hh / 2) / Hh);
  const n = p.count;
  g.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.setAttribute('aId', new THREE.BufferAttribute(new Float32Array(n).fill(3), 1));
  return g;
}

function fittings() {
  const b = new Batch();
  const STEEL = '#2b5a70', DARK = '#12283c', LIGHT = '#79c0c8', BLK = '#141a28';
  const zF = 0.15;                 // front of the plate
  // a pale rubber gasket at the back of each reveal: the bright line round the panes
  for (const w of WIN) {
    const sh = rr(new THREE.Shape(), w.x0 - 0.03, w.y0 - 0.03, w.x1 + 0.03, w.y1 + 0.03, w.r + 0.03);
    sh.holes.push(rr(new THREE.Path(), w.x0 + 0.022, w.y0 + 0.022, w.x1 - 0.022, w.y1 - 0.022, w.r - 0.02));
    b.add(new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: false, curveSegments: 14 }), '#d4f6f2', 4);
  }
  // centre post, standing proud of the plate
  b.box(0.2, 3.2, 0.09, [0.61, 0, zF + 0.03], STEEL, 6);
  b.box(0.05, 3.2, 0.03, [0.53, 0, zF + 0.06], LIGHT, 7);
  b.box(0.05, 3.2, 0.03, [0.69, 0, zF + 0.06], DARK, 7);
  // sill: a shelf running under the panes, with real bolt heads
  b.box(5.2, 0.14, 0.2, [0, -1.06, zF + 0.09], '#2f6476', 8);
  b.box(5.2, 0.024, 0.2, [0, -0.98, zF + 0.09], '#8fd0d4', 9);
  for (let x = -2.5; x <= 2.5; x += 0.15) b.sphere(0.02, [x, -1.06, zF + 0.195], '#a9dcdc', 10, [1, 1, 0.6]);
  // conduit along the head of the panes with clips
  b.pipe([-2.6, 1.13, zF + 0.05], [2.6, 1.13, zF + 0.05], 0.022, '#c2d2cc', 11, 8);
  b.pipe([-2.6, 1.19, zF + 0.05], [2.6, 1.19, zF + 0.05], 0.014, '#e0b53c', 12, 6);
  for (let x = -2.4; x <= 2.5; x += 0.42) b.box(0.03, 0.12, 0.02, [x, 1.15, zF + 0.075], '#7fa0a8', 13);
  // console top along the bottom right: a dark rounded hood with lamps
  b.box(1.4, 0.3, 0.3, [1.7, -1.3, zF + 0.32], '#10243a', 14);
  b.box(1.28, 0.22, 0.02, [1.7, -1.29, zF + 0.48], '#0a1524', 15);
  for (let i = 0; i < 9; i++) b.sphere(0.018, [1.2 + i * 0.12, -1.22, zF + 0.5], ['#46e08c', '#ffb43c', '#ff5a3c'][i % 3], 16, [1, 1, 0.5]);
  // wipers, outside the glass
  const zO = -0.04;
  const wiper = (x0, y0, x1, y1) => {
    b.pipe([x0, y0, zO], [x1, y1, zO], 0.0065, BLK, 17, 6);
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), nx = -dy / l, ny = dx / l;
    b.pipe([x0 + nx * 0.013, y0 + ny * 0.013, zO], [x1 + nx * 0.013, y1 + ny * 0.013, zO], 0.0036, BLK, 17, 5);
    b.sphere(0.022, [lerp(x0, x1, 0.5), lerp(y0, y1, 0.5), zO], BLK, 17);
    b.pipe([x0, y0, zO], [x0, y0 + 0.08, zO], 0.016, '#28384c', 18, 6);
  };
  wiper(-1.08, 0.86, -1.08, -0.5);
  wiper(-0.12, 0.8, 0.0, -0.48);
  wiper(1.42, 0.88, 1.5, -0.5);
  // sun-visor rail across the head of the right pane
  b.box(0.018, 0.1, 0.018, [1.22, 0.92, zO + 0.02], BLK, 19);
  b.box(0.018, 0.1, 0.018, [2.3, 0.92, zO + 0.02], BLK, 19);
  b.box(1.1, 0.016, 0.016, [1.76, 0.87, zO + 0.02], BLK, 19);
  b.box(0.09, 0.05, 0.03, [1.78, 0.9, zO + 0.02], '#28384c', 19);
  // inside: a handrail across the left window head and a clock on the post
  b.cyl(0.075, 0.03, [0.61, 0.8, zF + 0.09], '#d9a93c', 20, { rot: [90, 0, 0], seg: 18 });
  b.cyl(0.058, 0.02, [0.61, 0.8, zF + 0.1], '#f7f4ea', 21, { rot: [90, 0, 0], seg: 18 });
  b.box(0.008, 0.05, 0.006, [0.61, 0.822, zF + 0.116], BLK, 22);
  b.box(0.04, 0.007, 0.006, [0.626, 0.8, zF + 0.116], BLK, 22);
  return b.build();
}

// A diagonal shine across the panes, in the overlay so it sits over the sea and the monster.
function glassShine(ctx) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 576;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0)'; g.fillRect(0, 0, c.width, c.height);
  const band = (x, wd, a) => {
    g.save(); g.transform(1, 0, -0.42, 1, 0, 0);
    g.fillStyle = `rgba(214,244,255,${a})`; g.fillRect(x, -100, wd, 900); g.restore();
  };
  g.save();
  g.beginPath();
  g.roundRect(70, 36, 556, 492, 40);
  g.roundRect(734, 22, 300, 470, 40);
  g.clip();
  band(250, 80, 0.045); band(346, 20, 0.07); band(980, 110, 0.04); band(1104, 26, 0.06);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  m.frustumCulled = false;
  m.visible = false;
  m.renderOrder = 5;
  ctx.overlay.add(m);
  return m;
}

export function createBridge(ctx) {
  const g = new THREE.Group();
  g.name = 'bridgeset';
  ctx.scene.add(g);
  g.visible = false;
  const rig = new THREE.Group();
  g.add(rig);
  const plate = new THREE.Mesh(plateGeometry(), shipMaterial({ map: plateTexture(), weather: 0.25, gloss: 0.4 }));
  plate.frustumCulled = false;
  plate.material.uniforms.uRestScale.value = 3;
  plate.position.z = -S22.wall;
  rig.add(plate);
  const fit = new THREE.Mesh(fittings(), shipMaterial({ weather: 0, gloss: 0.8 }));
  fit.frustumCulled = false;
  fit.position.z = -S22.wall;
  rig.add(fit);
  const shine = glassShine(ctx);

  // the arc the body slides down: seen from the windows it comes over the top and pours into the sea
  const _c = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(0, 1, 0);
  function poseMonster(st) {
    const lev = ctx.leviathan;
    if (!lev?.path) return;
    const t = onTwos(st.t), k = invLerp(st.cues.belly, st.cues.bigWave, t);
    const cam = S22.pos;
    _f.set(Math.sin(deg(S22.yaw)), 0, -Math.cos(deg(S22.yaw)));
    _r.crossVectors(_f, _u).normalize();
    const D = 520, R = 430;
    const cx = lerp(-60, -110, k), cy = lerp(-170, -228, smooth(k));
    _c.set(cam[0], 0, cam[2]).addScaledVector(_f, D).addScaledVector(_r, cx);
    _c.y = cy;
    const a1 = deg(lerp(44, 100, k));                      // snout, measured clockwise from the top
    const a0 = a1 - lev.L / R * 0.92;
    const P = (s, out) => {
      const a = lerp(a0, a1, s);
      out.copy(_c).addScaledVector(_r, Math.sin(a) * R);
      out.y += Math.cos(a) * R;
      out.addScaledVector(_f, -Math.cos(a) * 170);          // the top of the arc looms toward the ship
      return out;
    };
    // show the pale throat: the dorsal side rolls away from the camera
    const U = (s, out) => {
      const a = lerp(a0, a1, s), roll = lerp(1.0, 0.8, k);
      out.set(0, 0, 0).addScaledVector(_r, Math.sin(a) * roll);
      out.y += Math.cos(a) * roll;
      return out.addScaledVector(_f, 0.12).normalize();
    };
    lev.path(P, U, {
      jaw: 0.18,
      flipL: { sweep: 0.5, droop: lerp(0.9, 0.55, k), twist: 0.3, curl: 0.06 },
      flipR: { sweep: 0.2, droop: lerp(1.15, 0.8, k), twist: -0.3, curl: 0.07 },
      flukes: 0.3,
    });
    lev.show(true);
    lev.run.value = lerp(0.72, 0.5, k);
    lev.foam.value = 14;
  }

  return {
    group: g,
    update(st) {
      const on = st.set === 'bridge';
      g.visible = on;
      shine.visible = on;
      if (!on) return;
      rig.position.set(...S22.pos);
      rig.rotation.set(0, 0, 0, 'YXZ');
      rig.rotation.set(deg(S22.pitch), -deg(S22.yaw), deg(S22.roll));
      rig.updateMatrixWorld(true);
      poseMonster(st);
      // the shine stays on the glass as the camera wanders
      const cam = ctx.camera;
      shine.position.copy(cam.position).add(_f.set(0, 0, -3).applyQuaternion(cam.quaternion));
      shine.quaternion.copy(cam.quaternion);
      const hgt = 2 * 3 * Math.tan(deg(cam.fov) / 2);
      shine.scale.set(hgt * (1920 / 1040), hgt, 1);
    },
  };
}
