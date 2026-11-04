import * as THREE from 'three';
import { mergeVertices } from '../vendor/addons/BufferGeometryUtils.js';
import { G, COMMON, MRT_OUT } from './glsl.js';
import { WU, WATER_GLSL, raw } from './under-env.js';
import { Rng } from './util.js';

// Sculpted sea rock. Geometry comes from seeded noise on the CPU (silhouettes, ledges,
// overhangs); the shader adds strata, cracks, crust and caustics per pixel so it holds up
// in a macro. Two hard tones plus a deep third, painted (id 0) or inked (id > 0).

// ---- noise (classic gradient noise, deterministic table)
const PERM = new Uint8Array(512);
{
  const r = new Rng(9091), p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lp = (a, b, t) => a + (b - a) * t;
function gr(h, x, y, z) {
  h &= 15; const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}
export function n3(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  x -= X; y -= Y; z -= Z;
  const xi = X & 255, yi = Y & 255, zi = Z & 255;
  const u = fade(x), v = fade(y), w = fade(z);
  const A = PERM[xi] + yi, AA = PERM[A & 255] + zi, AB = PERM[(A + 1) & 255] + zi;
  const B = PERM[xi + 1] + yi, BA = PERM[B & 255] + zi, BB = PERM[(B + 1) & 255] + zi;
  return lp(lp(lp(gr(PERM[AA & 511], x, y, z), gr(PERM[BA & 511], x - 1, y, z), u), lp(gr(PERM[AB & 511], x, y - 1, z), gr(PERM[BB & 511], x - 1, y - 1, z), u), v),
    lp(lp(gr(PERM[(AA + 1) & 511], x, y, z - 1), gr(PERM[(BA + 1) & 511], x - 1, y, z - 1), u), lp(gr(PERM[(AB + 1) & 511], x, y - 1, z - 1), gr(PERM[(BB + 1) & 511], x - 1, y - 1, z - 1), u), v), w);
}
export function fbm(x, y, z, o = 5) {
  let s = 0, a = 0.5;
  for (let i = 0; i < o; i++) { s += a * n3(x, y, z); x = x * 2.03 + 11.3; y = y * 2.03 + 7.1; z = z * 2.03 + 3.7; a *= 0.5; }
  return s;
}
// sharp crests in 0..1
export function ridged(x, y, z, o = 5) {
  let s = 0, a = 0.5, w = 1;
  for (let i = 0; i < o; i++) {
    let n = 1 - Math.abs(n3(x, y, z)) * 2.1; n = Math.max(0, n) ** 2;
    s += a * n * w; w = Math.min(1, n * 2.2);
    x = x * 2.1 + 5.3; y = y * 2.1 + 1.9; z = z * 2.1 + 8.7; a *= 0.5;
  }
  return s;
}

// ---- geometry
const finish = (g, cav) => {
  g.computeVertexNormals();
  g.setAttribute('aRest', g.attributes.position.clone());
  if (!cav) { cav = new Float32Array(g.attributes.position.count).fill(0.6); }
  g.setAttribute('aCav', new THREE.BufferAttribute(cav, 1));
  return g;
};

// A rock: noise-displaced icosphere. taper > 0 draws it into a spire.
export function blobGeo(o = {}) {
  const { seed = 1, detail = 40, rx = 1, ry = 1, rz = 1, taper = 0, pow = 1.1, amp = 0.28, freq = 1.6, fine = 0.05, terr = 0, terrN = 7, flat = 0, lean = 0 } = o;
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-5);
  const p = g.attributes.position;
  const s = seed * 17.37;
  const cav = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = 0.5 + 0.5 * y;
    const w = taper ? (1 - taper) + taper * Math.pow(Math.max(1 - h, 0), pow) : 1;
    const xs = x + s, ys = y * (taper ? 2.4 : 1) - s, zs = z + s * 0.7;
    let r = 1 + amp * (ridged(xs * freq, ys * freq, zs * freq, 4) * 2 - 0.7) + fine * fbm(xs * freq * 5, ys * freq * 5, zs * freq * 5, 3);
    if (terr) {
      const k = y * terrN + fbm(xs * 2, ys * 2, zs * 2, 2) * 1.6;
      const fr = k - Math.floor(k);
      r *= 1 + terr * (0.5 - Math.min(fr * 3.2, 1)) * (0.65 + n3(xs * 1.4, Math.floor(k) * 3.1, zs * 1.4));
    }
    cav[i] = Math.min(1, Math.max(0, (r - 0.78) / 0.5));
    let py = y * ry * (1 + 0.12 * n3(xs * 2, 0, zs * 2));
    if (flat && py < 0) py *= flat;
    const lx = lean * h * h;
    p.setXYZ(i, x * rx * w * r + lx * ry, py, z * rz * w * r);
  }
  return finish(g, cav);
}

// Grid surface: fn(u, v, out[3]) with u, v in 0..1
// A stone stack: fluted column with broken shoulders, tapering to a crooked crown.
export function spireGeo(o = {}) {
  const { seed = 1, nu = 128, nv = 190, flutes = 7, bend = 0.1 } = o;
  const sd = seed * 13.7;
  const r = new Rng(Math.floor(seed * 977) + 11);
  // irregular beds: thick and thin layers, each its own angular section, stepped and shifted
  const beds = [];
  for (let y = -0.04; y < 1.06;) {
    const t = r.next();
    const th = t < 0.35 ? r.range(0.025, 0.05) : t < 0.8 ? r.range(0.06, 0.13) : r.range(0.15, 0.26);
    const taper = Math.pow(Math.max(1 - y, 0), 0.55);
    const w = (0.2 + 0.86 * taper) * r.range(0.7, 1.12);
    const n = r.int(4, 7), a0 = r.range(0, 6.28), verts = [];
    for (let i = 0; i < n; i++) verts.push([a0 + ((i + r.range(-0.3, 0.3)) / n) * Math.PI * 2, r.range(0.66, 1.2)]);
    beds.push({ y, th, w, verts, ox: r.range(-0.12, 0.12) * w, oz: r.range(-0.12, 0.12) * w });
    y += th;
  }
  const rad = (b, a) => {
    const vs = b.verts, n = vs.length;
    for (let i = 0; i < n; i++) {
      const p = vs[i], s = vs[(i + 1) % n];
      const a1 = p[0], a2 = s[0] + (i === n - 1 ? Math.PI * 2 : 0);
      let x = a; while (x < a1) x += Math.PI * 2;
      if (x <= a2) return lp(p[1], s[1], (x - a1) / (a2 - a1));
    }
    return 1;
  };
  const tx = Math.cos(sd), tz = Math.sin(sd);
  return gridGeo(nu, nv, (u, v, q) => {
    const a = u * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const h = v; // 0 base, 1 tip
    // the beds tilt and wander, so a stratum never runs as a level ring
    const hb = h + 0.05 * (ca * tx + sa * tz) + 0.05 * fbm(ca * 1.2 + sd, h * 3, sa * 1.2, 2);
    let i = 0; while (i < beds.length - 2 && hb > beds[i + 1].y) i++;
    const b0 = beds[i], b1 = beds[i + 1];
    const f0 = Math.min(1, Math.max(0, (hb - b0.y) / b0.th));
    const f = f0 < 0.8 ? 0 : (f0 - 0.8) / 0.2;
    let w = lp(b0.w * rad(b0, a), b1.w * rad(b1, a), f);
    const ox = lp(b0.ox, b1.ox, f), oz = lp(b0.oz, b1.oz, f);
    const fl = ridged(ca * 1.6 + sd, h * 4.2, sa * 1.6 - sd, 4);
    const chips = fbm(ca * 3.1 + sd, h * 15, sa * 3.1, 3);
    const gully = Math.pow(Math.abs(Math.sin(a * flutes * 0.5 + 2.4 * fbm(h * 2.2, sd, 1.2, 2))), 0.6);
    w = Math.max(w * (0.82 + 0.2 * gully + 0.34 * (fl - 0.3) + 0.24 * chips), 0.015);
    w *= 1 + 0.55 * Math.exp(-h / 0.09);
    // broken crown: a few crooked teeth, never a clean point
    const tooth = ridged(ca * 1.1 + sd * 0.7, 0.3, sa * 1.1, 2);
    const crest = 1 - 0.2 * Math.max(0, 1 - tooth * 1.5);
    const top = Math.pow(Math.max(1 - Math.max(0, (h - 0.93) / 0.07), 0), 0.5);
    w *= top;
    const bx = bend * Math.sin(h * 3 + sd) * h, bz = bend * Math.cos(h * 2.3 - sd) * h;
    q[0] = ca * w + bx + ox; q[1] = lp(h, h * crest, h * h * h) * 2 - 1; q[2] = sa * w + bz + oz;
    q[3] = Math.min(1, Math.max(0, 0.15 + (gully - 0.25) * 0.6 + fl * 0.5 - (f0 > 0.8 ? 0.2 : 0)));
  });
}

export function gridGeo(nu, nv, fn) {
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3), o = [0, 0, 0, 0.6];
  const cav = new Float32Array((nu + 1) * (nv + 1));
  let k = 0, c = 0;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    o[3] = 0.6;
    fn(i / nu, j / nv, o);
    pos[k++] = o[0]; pos[k++] = o[1]; pos[k++] = o[2];
    cav[c++] = o[3];
  }
  const idx = new Uint32Array(nu * nv * 6);
  k = 0;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return finish(g, cav);
}

// A cliff wall as a displaced sheet running from a to b (xz), so it can stand truly vertical
// and overhang. crest = crest height, foot = base height, side = which way the face looks.
export function wallGeo(o) {
  const { a, b, foot = -1200, crest = -100, nu = 260, nv = 240, side = 1, seed = 1, depth = 260, crestVar = 0.34, s = 300, terr = 0.5, bow = 0 } = o;
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  const tx = dx / len, tz = dz / len, nx = -tz * side, nz = tx * side;
  const sd = seed * 31.7;
  const H = crest - foot;
  return gridGeo(nu, nv, (u, v, q) => {
    const al = u * len;
    const top = crest - H * crestVar * (0.5 + 0.9 * fbm(al / (s * 3.1) + sd, 0, sd, 4) + 0.7 * (ridged(al / (s * 1.4) + sd, 2.2, sd, 4) - 0.35));
    const y = foot + (top - foot) * v;
    const X = al / s + sd, Y = y / s;
    // big buttresses, then crags, then ledges (terraced)
    const big = ridged(X * 1.7, Y * 0.26, sd + 3, 5), fine = ridged(X * 4.3, Y * 0.5, sd + 7, 3);
    let d = fbm(X * 0.55, Y * 0.2, sd, 3) * 1.5 + big * 1.05 + fine * 0.34;
    d += terr * 0.16 * Math.tanh(4 * Math.sin(Y * 3.1 + 2.4 * fbm(X * 0.9, Y * 0.6, sd, 2)));
    // the crest rolls back so the skyline reads as a rounded ridge, not a torn edge
    const roll = Math.pow(v, 6) * depth * 1.6;
    const off = d * depth + bow * Math.sin(u * Math.PI) - roll;
    q[3] = Math.min(1, Math.max(0, big * 0.85 + fine * 0.4 + 0.04));
    q[0] = a[0] + tx * al + nx * off; q[1] = y; q[2] = a[1] + tz * al + nz * off;
  });
}

// Sea floor: radial grid, dense at the centre, heightFn(x, z)
export function floorGeo(nr, na, R, heightFn, cx = 0, cz = 0) {
  return gridGeo(na, nr, (u, v, q) => {
    const a = u * Math.PI * 2, r = R * Math.pow(v, 2.2);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    q[0] = x; q[1] = heightFn(x, z); q[2] = z;
  });
}

// ---- material
export function rockMaterial(o = {}) {
  const u = {
    ...G, ...WU,
    uTop: { value: raw(o.top ?? '#9ff0dc') }, uLit: { value: raw(o.lit ?? '#34aeb2') }, uLit2: { value: raw(o.lit2 ?? '#2a93b6') },
    uShd: { value: raw(o.shd ?? '#1a66a6') }, uShd2: { value: raw(o.shd2 ?? '#134a94') }, uDeep: { value: raw(o.deep ?? '#0d2e74') },
    uCoralA: { value: raw(o.coralA ?? '#ff5f7e') }, uCoralB: { value: raw(o.coralB ?? '#ffae3d') }, uMoss: { value: raw(o.moss ?? '#35c48e') },
    uS: { value: o.scale ?? 70 }, uBump: { value: o.bump ?? 1.1 }, uIdR: { value: o.id ?? 0 }, uGrowth: { value: o.growth ?? 1 },
    uStrata: { value: new THREE.Vector3(...(o.strata ?? [0.15, 1, 0.1])).normalize() }, uCauS: { value: o.cauS ?? 120 },
    uLocal: { value: o.local ? 1 : 0 }, uStretch: { value: o.stretch ?? 1 }, uFoot: { value: new THREE.Vector2(...(o.foot ?? [-1000, 260])) }, uFleck: { value: o.fleck ?? 0 },
  };
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: u, side: o.side ?? THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aRest;
      attribute float aCav;
      varying vec3 vWorld, vNormalW, vNormalV, vRest;
      varying float vDepth, vCav;
      void main(){
        vCav = aCav;
        vec4 lp = vec4(position, 1.0);
        vec3 ln = normal;
        vRest = aRest;
        #ifdef USE_INSTANCING
          lp = instanceMatrix * lp;
          ln = mat3(instanceMatrix) * ln;
          vRest = lp.xyz;
        #endif
        vec4 wp = modelMatrix * lp;
        vWorld = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * ln);
        vec4 mv = viewMatrix * wp;
        vNormalV = normalize(mat3(viewMatrix) * vNormalW);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${MRT_OUT}
      ${WATER_GLSL}
      uniform vec3 uTop, uLit, uLit2, uShd, uShd2, uDeep, uCoralA, uCoralB, uMoss, uStrata;
      uniform float uS, uBump, uIdR, uGrowth, uCauS, uLocal, uStretch, uFleck, uRockGain;
      uniform vec2 uFoot;
      varying vec3 vWorld, vNormalW, vNormalV, vRest;
      varying float vDepth, vCav;
      float rockH(vec3 p){
        float a = 1.0 - abs(2.0 * vnoise3(p * 0.5) - 1.0);
        float b = 1.0 - abs(2.0 * vnoise3(p * 1.37 + 3.1) - 1.0);
        float c = vnoise3(p * 3.3 + 7.7);
        float d = vnoise3(p * 7.9 + 1.3);
        return a * a * 0.6 + b * b * 0.3 + c * 0.13 + d * 0.06;
      }
      void main(){
        if(uPass > 0.5 && uPass < 1.5){ oColor = vec4(1); oData = vec4(0); return; }
        vec3 N = normalize(vNormalW);
        if(!gl_FrontFacing){ N = -N; }
        vec3 P = (uLocal > 0.5 ? vRest : vWorld) / uS;
        P.y *= uStretch;
        float pxS = clamp(vDepth / (uS * 34.0), 0.0, 1.0);
        float e = 0.05 + 0.2 * pxS;
        float h0 = rockH(P);
        vec3 g = vec3(rockH(P + vec3(e, 0, 0)) - h0, rockH(P + vec3(0, e, 0)) - h0, rockH(P + vec3(0, 0, e)) - h0) / e;
        g -= N * dot(g, N);
        // a second, finer chisel so a macro never goes flat
        vec3 F = P * 3.1 + 5.0;
        float f0 = rockH(F), e2 = 0.06;
        vec3 g2 = vec3(rockH(F + vec3(e2, 0, 0)) - f0, rockH(F + vec3(0, e2, 0)) - f0, rockH(F + vec3(0, 0, e2)) - f0) / e2;
        g2 -= N * dot(g2, N);
        vec3 Nb = normalize(N - uBump * (g * 0.5 + g2 * 0.16 * (1.0 - pxS)));

        // strata: a lit lip on every ledge with a shadow line under it, broken up by noise
        float warp = fbm3(P * 0.42 + 2.0);
        float st = dot(P, uStrata) * 1.7 + warp * 3.0;
        st += 0.8 * sin(st * 0.41 + 1.3) + 0.5 * sin(st * 0.97 + 0.4);   // uneven bed thickness
        st += 0.8 * sin(st * 0.41 + 1.3) + 0.5 * sin(st * 0.97 + 0.4);   // uneven bed thickness
        float fr = fract(st);
        float side = 1.0 - smoothstep(0.55, 0.85, abs(N.y));
        float broke = smoothstep(0.42, 0.5, vnoise3(P * vec3(0.5, 1.6, 0.5) + 4.0));
        float lip = smoothstep(0.0, 0.025, fr) * smoothstep(0.11, 0.06, fr) * broke * side;
        float under = smoothstep(0.83, 0.96, fr) * broke * side;
        float crack = smoothstep(0.02, 0.0, abs(fbm3(P * 1.15 + 9.0) - 0.5) - 0.002 - 0.012 * pxS);

        // light from the surface, edges of the tones jittered like a loaded brush
        vec3 L = normalize(vec3(-0.62, 0.56, 0.55) + uKeyDir * 0.4);
        float jit = ((h0 - 0.42) * 0.3 + (vnoise3(P * 2.3 + 8.0) - 0.5) * 0.26) * (1.0 - 0.75 * pxS);
        float ndl = dot(Nb, L) + jit;
        float sh = sunShadow(vWorld, N);
        float cav = vCav + (h0 - 0.42) * 0.5;
        float lt = smoothstep(0.30, 0.33, ndl + lip * 0.5 - under * 0.4) * sh;
        float lt2 = smoothstep(0.72, 0.75, ndl + lip * 0.3) * sh * smoothstep(0.3, 0.45, cav);
        float low = smoothstep(0.04, -0.02, ndl);
        float deep = max(smoothstep(-0.34, -0.40, ndl), smoothstep(0.2, 0.12, cav));
        float pat = fbm3(P * 0.33 + 5.0);
        vec3 lit = mix(uLit, uLit2, smoothstep(0.47, 0.51, pat));
        vec3 shade = mix(uShd, uShd2, low);
        shade = mix(shade, uDeep, deep);
        shade *= 0.94 + 0.14 * smoothstep(0.42, 0.58, pat);
        vec3 col = mix(shade, mix(lit, uTop, lt2), lt);
        col = mix(col, uDeep, under * 0.55 * (1.0 - lt2));

        // marine growth on anything facing up: fine moss, then pink and orange crust in small clumps
        float up = smoothstep(0.45, 0.8, N.y) * uGrowth;
        float gm = fbm3(P * 1.25 + 13.0);
        float moss = step(0.53, gm + 0.14 * vnoise3(P * 5.0)) * up;
        col = mix(col, mix(uMoss * 0.5, uMoss * 1.05, lt), moss * 0.72);
        float cl = step(0.7, vnoise3(P * 3.7 + 21.0) + 0.42 * (gm - 0.3)) * step(0.52, fbm3(P * 1.3 + 3.0)) * up;
        vec3 crust = mix(uCoralA, uCoralB, step(0.5, vnoise3(P * 1.2 + 31.0)));
        col = mix(col, crust * mix(0.62, 1.1, lt), cl);
        float dots = step(0.82, vnoise3(P * 13.0 + 41.0)) * step(0.45, gm) * up;
        col = mix(col, vec3(1.0, 0.92, 0.72), dots * 0.7);
        // wet glints on black rock
        if(uFleck > 0.0){
          float fl = smoothstep(0.74, 0.8, vnoise3(P * 7.3 + 3.0)) * smoothstep(0.1, 0.5, dot(Nb, L));
          col = mix(col, uTop * 1.15, fl * uFleck);
        }

        col = mix(col, col * vec3(0.5, 0.54, 0.72), crack * 0.85);

        // caustic net slides over the sunlit rock
        vec2 cq = (vWorld.xz - vWorld.y * uSunW.xz / max(uSunW.y, 0.2)) / uCauS;
        float cn = causticNet(cq, uWT * 0.8);
        float cn2 = causticNet(cq * 2.3 + 0.4, uWT * 0.6 + 4.0);
        float cW = smoothstep(0.1, 0.5, N.y) * mix(0.1, 1.0, lt);
        col += vec3(0.6, 1.0, 1.0) * (smoothstep(0.08, 0.3, cn) * 0.2 + smoothstep(0.1, 0.32, cn2) * 0.08) * cW;

        // sinks into the silt at the foot
        float ft = smoothstep(uFoot.x, uFoot.x + uFoot.y, vWorld.y);
        col = mix(col * vec3(0.66, 0.74, 0.92), col, ft);
        col *= uRockGain;
        col += vec3(0.5, 0.75, 1.0) * uFlash * 0.45 * max(Nb.y * 0.3 + 0.6, 0.0);
        vec3 NV = normalize(vNormalV);
        if(!gl_FrontFacing) NV = -NV;
        writeOut(col, 1.0, NV, vDepth, uIdR);
      }
    `,
  });
}

// Scatter instanced rocks with deterministic jitter
export function instanced(geo, mat, list) {
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const d = new THREE.Object3D();
  list.forEach((s, i) => {
    d.position.set(s.p[0], s.p[1], s.p[2]);
    d.rotation.set(s.r?.[0] ?? 0, s.r?.[1] ?? 0, s.r?.[2] ?? 0);
    d.scale.set(s.s[0], s.s[1], s.s[2]);
    d.updateMatrix();
    m.setMatrixAt(i, d.matrix);
  });
  m.instanceMatrix.needsUpdate = true;
  m.frustumCulled = false;
  m.userData.noReflect = true;
  m.userData.noShadow = true;
  return m;
}
