import * as THREE from 'three';
import { G, COMMON, MRT_OUT } from './glsl.js';

// The planet: one painted fragment shader for everything seen from high up (s11, s12, s13,
// s25 sky, s26, s28). A real sphere is ray-traced in kilometres, with a height-marched cumulus
// layer so clouds have volume and parallax, relief-shaded continents, sun glint and a bright limb.
// Driven by look.planet = { alt (km), x, z (ground scroll, km), cov (cloud threshold: 0.45 much
//   cloud, 0.62 scattered, > 1 none), deck (0..1 pushes everything toward an unbroken deck),
//   sea (0..1 push the map to open ocean), fleet (0..1 tiny ships on the sea), veil (0..1 a thin
//   cloud sheet in front of the lens), space (override how black the sky is), flash, heading }.
export function planetMaterial() {
  const u = {
    ...G,
    uAlt: { value: 8 }, uShift: { value: new THREE.Vector2() }, uCov: { value: 0.5 },
    uSea: { value: 0 }, uFleet: { value: 0 }, uFlash: { value: 0 }, uVeilP: { value: 0 },
    uHeading: { value: 0 }, uLT: { value: 0 }, uDeck: { value: 0 }, uSpace: { value: -1 },
  };
  const vs = /* glsl */ `
    varying vec3 vDir;
    varying float vDepth;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vDir = wp.xyz - cameraPosition;
      gl_Position = projectionMatrix * viewMatrix * wp;
      vDepth = gl_Position.w;
      gl_Position.z = gl_Position.w * 0.99999;
    }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    uniform float uAlt, uCov, uSea, uFleet, uFlash, uHeading, uVeilP, uLT, uDeck, uSpace;
    uniform vec2 uShift;
    varying vec3 vDir;
    varying float vDepth;
    const float R = 6371.0;
    const float CTOP = 9.0, CBOT = 3.0;
    const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);

    bool sphere(vec3 ro, vec3 rd, float r, out float t0, out float t1){
      float b = dot(ro, rd), c = dot(ro, ro) - r * r, h = b * b - c;
      if(h < 0.0) return false;
      h = sqrt(h); t0 = -b - h; t1 = -b + h;
      return t1 > 0.0;
    }
    // quintic value noise and rotated fbm: no grid shows through a hard threshold
    float nz(vec2 p){
      vec2 i = floor(p), f = fract(p);
      f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
    }
    float fb(vec2 p, int o){
      float s = 0.0, a = 0.5, n = 0.0;
      for(int i = 0; i < o; i++){ s += a * nz(p); n += a; p = ROT * p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
      return s / n;
    }
    // rounded lobes with creases between them: the cauliflower of a cumulus top
    float bil(vec2 p, int o){
      float s = 0.0, a = 0.5, n = 0.0;
      for(int i = 0; i < o; i++){ s += a * abs(2.0 * nz(p) - 1.0); n += a; p = ROT * p * 2.03 + vec2(4.1, 2.2); a *= 0.52; }
      return s / n;
    }
    // azimuthal map in km, centred under the camera, scrolled by uShift
    vec2 mapUV(vec3 p){
      vec3 n = normalize(p);
      float th = atan(length(n.xz), n.y);          // acos is 3 km coarse near the nadir
      vec2 q = normalize(n.xz + 1e-7) * th * R;
      float c = cos(uHeading), s = sin(uHeading);
      return mat2(c, -s, s, c) * q + uShift;
    }
    int octs(float wave, float foot, int mn, int mx){ return int(clamp(log2(wave / max(foot * 1.6, 1e-3)), float(mn), float(mx))); }

    // ---- land height: -x sea .. 0 shore .. +x high ground
    float landH(vec2 uv, float foot){
      vec2 w = vec2(nz(uv / 640.0 + 2.0), nz(uv / 640.0 + 17.0)) - 0.5;
      vec2 q = uv + w * 560.0;
      float l = fb(q / 1300.0 + 3.0, octs(1300.0, foot, 3, 10));
      return l - 0.515 - uSea * 0.4;
    }

    // ---- cloud weather 0..1, a slow pattern of systems broken into clusters
    float weather(vec2 uv){
      vec2 w = vec2(nz(uv / 310.0 + 2.0), nz(uv / 310.0 + 17.0)) - 0.5;
      vec2 q = uv + w * 300.0;
      q = mat2(0.93, 0.36, -0.2, 1.1) * q;        // bands, not blobs
      return fb(q / 520.0, 3) * 0.52 + fb(q / 92.0 + 5.0, 3) * 0.33 + fb(q / 17.0 + 9.0, 3) * 0.15 + uDeck * 0.6;
    }
    float covAt(vec2 uv){ return smoothstep(uCov, uCov + 0.075, weather(uv)); }
    // cloud top height 0..1, cumulus lobes on top of the weather
    float cloudH(vec2 uv, float cov, float foot){
      if(cov <= 0.0) return -1.0;
      float b = bil(uv / 23.0 + 3.0, octs(23.0, foot, 2, 4));
      float big = bil(uv / 110.0 + 7.0, 2);
      float fine = foot < 1.5 ? bil(uv / 5.3 + 1.0, octs(5.3, foot, 1, 5)) : 0.32;
      return cov * (0.14 + 0.34 * big + 0.42 * b + 0.42 * fine) - 0.06;
    }

    vec3 seaColor(vec2 uv, float l, float foot, vec3 rd, vec3 up, vec3 s, float t){
      float sw = fb(uv / 420.0 + 11.0, 4);
      vec3 col = mix(vec3(0.015, 0.16, 0.62), vec3(0.03, 0.33, 0.86), smoothstep(0.38, 0.62, sw));
      col = mix(col, vec3(0.05, 0.47, 0.90), smoothstep(0.54, 0.66, sw + (fb(uv / 37.0, 4) - 0.5) * 0.16) * 0.8);
      float shelf = smoothstep(-0.06, 0.0, l + (fb(uv / 21.0 + 2.0, 4) - 0.5) * 0.02);
      col = mix(col, vec3(0.05, 0.60, 0.86), smoothstep(0.1, 0.55, shelf));
      col = mix(col, vec3(0.14, 0.86, 0.80), smoothstep(0.62, 0.9, shelf));
      if(uSea > 0.2 && foot < 0.25){
        // drawn swell seen from altitude: long streaks, whitecaps as fine stipple
        vec2 st = mat2(0.9, 0.44, -0.44, 0.9) * uv;
        vec2 wr = vec2(fb(st * 0.9 + 3.0, 3), fb(st * 0.9 + 8.0, 3)) - 0.5;
        float sw2 = fb((st + wr * 1.6) * vec2(1.1, 2.6), 4);
        col = mix(col, col * vec3(0.76, 0.86, 1.02), smoothstep(0.47, 0.5, sw2));
        col = mix(col, col * vec3(1.1, 1.14, 1.05) + vec3(0.0, 0.06, 0.05), smoothstep(0.57, 0.6, sw2));
        float cap = smoothstep(0.7, 0.74, fb((st + wr) * vec2(5.0, 15.0) + 3.0, 2)) * smoothstep(0.5, 0.56, sw2);
        col = mix(col, vec3(0.94, 0.98, 1.0), cap * 0.92);
      }
      // the sun in the water: a broad silver road, sparkle near its heart
      vec3 Rf = reflect(rd, up);
      float d = max(dot(Rf, s), 0.0);
      float glint = pow(d, 42.0) * 0.5 + pow(d, 240.0) * 0.8;
      col += vec3(0.86, 0.94, 1.0) * glint * (0.75 + 0.5 * nz(uv / 9.0));
      return col;
    }

    vec3 landColor(vec2 uv, float l, float foot, float shade){
      float nA = fb(uv / 62.0 + 3.0, 5), nB = fb(uv / 9.0 + 9.0, 5);
      vec3 g = mix(vec3(0.05, 0.40, 0.25), vec3(0.17, 0.60, 0.25), smoothstep(0.42, 0.56, nA + (nB - 0.5) * 0.3));
      g = mix(g, vec3(0.50, 0.72, 0.26), smoothstep(0.54, 0.6, nA + (nB - 0.5) * 0.4));
      g = mix(g, vec3(0.80, 0.68, 0.34), smoothstep(0.6, 0.66, nA + (nB - 0.5) * 0.4));
      float hi = l + (nB - 0.5) * 0.05;
      g = mix(g, vec3(0.58, 0.42, 0.34), smoothstep(0.1, 0.14, hi));
      g = mix(g, vec3(0.97, 0.98, 1.0), smoothstep(0.18, 0.19, hi));
      // relief: lit slopes warm, shade slopes lavender
      g = mix(g * vec3(0.46, 0.5, 0.78), g * vec3(1.14, 1.1, 0.98), shade);
      // beach rim
      g = mix(vec3(0.99, 0.93, 0.72), g, smoothstep(0.002, 0.005 + foot * 0.0012, l));
      return g;
    }

    vec3 groundColor(vec2 uv, vec3 up, vec3 rd, vec3 s, float t, float foot){
      float l = landH(uv, foot);
      vec3 col;
      if(l < 0.0) col = seaColor(uv, l, foot, rd, up, s, t);
      else {
        float e = max(foot * 2.0, 0.4);
        float lx = landH(uv + vec2(e, 0.0), foot), lz = landH(uv + vec2(0.0, e), foot);
        vec2 grad = vec2(lx - l, lz - l) / e;
        float shade = smoothstep(-0.25, 0.35, dot(normalize(s.xz + 1e-5), -grad) * 58.0 + (l - 0.05));
        col = landColor(uv, l, foot, shade);
      }
      // a thin white surf line along every coast
      col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, 0.0012 + foot * 0.0009, abs(l))) * 0.8);
      // ---- fleet: tiny hulls with long white wakes (s28)
      if(uFleet > 0.0 && foot < 0.05){
        vec2 p = uv / 2.9;
        vec2 ci = floor(p);
        vec2 f = normalize(vec2(0.42, 0.91));
        for(int j = -1; j <= 1; j++) for(int i = -1; i <= 1; i++){
          vec2 c = ci + vec2(float(i), float(j));
          if(hash12(c * 3.1 + 2.0) > 0.46) continue;
          vec2 ctr = (c + 0.25 + 0.5 * hash22(c)) * 2.9;
          vec2 rel = uv - ctr;
          float a = dot(rel, f), b = dot(rel, vec2(f.y, -f.x));
          float hull = (1.0 - smoothstep(0.145, 0.16, abs(a))) * (1.0 - smoothstep(0.026, 0.032, abs(b) + max(a - 0.09, 0.0) * 0.4));
          float wk = (1.0 - smoothstep(0.012 + (-a) * 0.024, 0.03 + (-a) * 0.05, abs(b))) * step(a, -0.12) * smoothstep(-1.6, -0.2, a);
          float arm = (1.0 - smoothstep(0.0, 0.014, abs(abs(b) - (-a - 0.05) * 0.26))) * step(a, -0.02) * smoothstep(-0.9, -0.1, a) * 0.6;
          col = mix(col, vec3(0.97, 0.99, 1.0), max(wk, arm) * uFleet);
          float stripe = step(0.5, fract(a * 20.0));
          vec3 hc = mix(vec3(0.90, 0.30, 0.22), mix(vec3(0.98, 0.76, 0.28), vec3(0.25, 0.75, 0.86), step(0.5, fract(c.x * 0.37))), stripe);
          hc = mix(vec3(0.97), hc, step(-0.10, a));
          col = mix(col, hc, hull * uFleet);
        }
      }
      return col;
    }

    void main(){
      if(uPass > 0.5){ oColor = vec4(1.0, 1.0, 1.0, 1.0); oData = vec4(0.5, 0.5, 9000.0, 0.0); return; }
      vec3 rd = normalize(vDir);
      vec3 s = normalize(uSunDir);
      vec3 ro = vec3(0.0, R + uAlt, 0.0);
      float toSun = dot(rd, s);
      float dip = acos(clamp(R / (R + uAlt), -1.0, 1.0));
      float elev = asin(clamp(rd.y, -1.0, 1.0)) + dip;       // angle above the true horizon
      float spaceK = uSpace >= 0.0 ? uSpace : smoothstep(9.0, 70.0, uAlt);
      float pix = 0.0011;                                     // radians per pixel, near enough

      // ---- sky and space: a tight bright rim, a ring of pure blue, deep ultramarine night
      float K = mix(2.6, 8.5, smoothstep(4.0, 110.0, uAlt));
      float x = 1.0 - exp(-max(elev, 0.0) * K);
      vec3 hor = mix(vec3(0.86, 0.96, 1.0), vec3(0.90, 0.97, 1.0), spaceK);
      vec3 mid = mix(vec3(0.16, 0.50, 0.98), vec3(0.08, 0.36, 0.98), spaceK);
      vec3 zen = mix(vec3(0.03, 0.20, 0.74), vec3(0.008, 0.035, 0.20), spaceK);
      vec3 sky = mix(hor, mid, smoothstep(0.0, 0.42, x));
      sky = mix(sky, zen, smoothstep(0.3, 0.92, x));
      if(spaceK > 0.0){
        vec3 sd = rd * 340.0;
        float st = step(0.9975, hash13(floor(sd))) * smoothstep(0.42, 0.2, length(fract(sd) - 0.5));
        sky += st * 0.45 * smoothstep(0.75, 0.97, x) * spaceK;
      }
      float glow = pow(max(toSun, 0.0), 320.0) * 0.9 + pow(max(toSun, 0.0), 26.0) * 0.20 + pow(max(toSun, 0.0), 5.0) * 0.06;
      sky += vec3(1.0, 0.98, 0.92) * glow * (0.5 + 0.5 * spaceK);
      sky = mix(sky, vec3(2.6, 2.5, 2.3), smoothstep(0.99955, 0.9997, toSun));
      vec3 col = sky;

      float t0, t1, g0, g1, b0, b1;
      bool hitG = sphere(ro, rd, R, g0, g1) && g0 > 0.0;
      bool hitT = uAlt > CTOP ? (sphere(ro, rd, R + CTOP, t0, t1) && t0 > 0.0) : false;
      float tEnd = 1e9;
      vec3 up = vec3(0.0, 1.0, 0.0);
      float groundT = 0.0;
      if(hitG){
        vec3 P = ro + rd * g0;
        groundT = g0;
        up = normalize(P);
        vec2 uv = mapUV(P);
        float slant = max(dot(-rd, up), 0.06);
        float foot = g0 * pix / slant;
        vec3 gc = groundColor(uv, up, rd, s, g0, foot);
        // shadow the clouds drop on the world
        if(uCov < 1.0){
          float reach = 7.0 + min(uAlt, 400.0) * 0.06;
          vec2 uvS = uv + (s.xz / max(s.y, 0.2)) * reach;
          float shC = smoothstep(uCov + 0.01, uCov + 0.07, weather(uvS));
          gc = mix(gc, gc * vec3(0.46, 0.54, 0.80), shC * 0.85);
          float skirt = smoothstep(uCov - 0.055, uCov + 0.02, weather(uv)) * smoothstep(0.3, 0.7, fb(uv / 6.0, 4));
          gc = mix(gc, vec3(0.86, 0.92, 1.0), skirt * 0.55);
        }
        gc *= 0.80 + 0.26 * clamp(dot(up, s) * 1.5, 0.0, 1.0);
        col = gc;
        tEnd = g0;
      }
      // ---- the cloud layer: march down through it from the top sphere
      vec3 cloudC = vec3(0.0); float cloudT = 0.0; bool cloudHit = false;
      bool inside = uAlt <= CTOP;
      if((hitT || inside) && uCov < 1.0){
        float start = inside ? 0.0 : t0;
        float endT = min(tEnd, hitT ? t1 : 1e9);
        if(sphere(ro, rd, R + CBOT, b0, b1) && b0 > 0.0) endT = min(endT, b0);
        else if(inside){ endT = min(endT, 900.0); }
        if(!hitG && rd.y > 0.02 && inside) endT = start;   // looking up from inside the layer
        float span = endT - start;
        if(span > 0.0){
          float foot = max(start * pix / max(-dot(rd, normalize(ro + rd * start)), 0.08), 0.012);
          int STEPS = uAlt > 200.0 ? 5 : 16;
          float dt = span / float(STEPS);
          float tt = start + dt * hash12(gl_FragCoord.xy);
          float hitAt = -1.0, tPrev = start;
          for(int i = 0; i < STEPS; i++){
            vec3 p = ro + rd * tt;
            float a = (length(p) - R - CBOT) / (CTOP - CBOT);
            vec2 uv = mapUV(p);
            if(cloudH(uv, covAt(uv), foot * 4.0) > a){ hitAt = tt; break; }
            tPrev = tt;
            tt += dt;
          }
          if(hitAt > 0.0){
            // refine the top surface so edges stay crisp
            float a0 = tPrev, a1 = hitAt;
            for(int i = 0; i < 4; i++){
              float m = 0.5 * (a0 + a1);
              vec3 p = ro + rd * m;
              float a = (length(p) - R - CBOT) / (CTOP - CBOT);
              vec2 uv = mapUV(p);
              if(cloudH(uv, covAt(uv), foot) > a) a1 = m; else a0 = m;
            }
            cloudT = a1;
            vec3 P = ro + rd * a1;
            vec3 nup = normalize(P);
            vec2 uv = mapUV(P);
            float cov = covAt(uv);
            float e = max(foot * 2.0, 0.16);
            float h0 = cloudH(uv, cov, foot);
            float hx = cloudH(uv + vec2(e, 0.0), covAt(uv + vec2(e, 0.0)), foot);
            float hz = cloudH(uv + vec2(0.0, e), covAt(uv + vec2(0.0, e)), foot);
            vec3 N = normalize(nup + vec3(-(hx - h0), 0.0, -(hz - h0)) / e * (7.0 + min(foot, 3.0) * 7.0));
            float ndl = dot(N, s);
            float band = (nz(uv / 3.0) - 0.5) * 0.12;
            float lit = smoothstep(0.1, 0.24, ndl + band);
            float hi = smoothstep(0.62, 0.68, ndl + band);
            vec3 sc = vec3(0.55, 0.62, 0.95);                     // lavender shadow side
            vec3 cc = mix(sc, vec3(0.90, 0.93, 1.0), lit);
            cc = mix(cc, vec3(1.1, 1.09, 1.05), hi);
            // creases and thin edges sink to deeper violet-blue, tops stay white
            cc = mix(cc * vec3(0.74, 0.78, 0.97), cc, smoothstep(0.04, 0.34, h0));
            cloudC = cc; cloudHit = true;
            up = nup;
          }
        }
      }
      if(cloudHit) col = cloudC;
      // ---- air between us and the surface: strongest toward the limb
      float tHit = cloudHit ? cloudT : (hitG ? groundT : 0.0);
      if(tHit > 0.0){
        vec3 nn = normalize(ro + rd * tHit);
        float mu = clamp(dot(-rd, nn), 0.0, 1.0);
        float bw = dip * 0.14 + 0.006;
        float limb = exp(-max(-elev, 0.0) / bw);
        limb = max(limb, pow(1.0 - mu, 5.0) * spaceK);
        float air = 1.0 - exp(-tHit / 900.0);
        vec3 aC = mix(vec3(0.34, 0.64, 1.0), vec3(0.86, 0.95, 1.0), limb);
        col = mix(col, aC, clamp(limb * 0.92 + air * 0.16, 0.0, 0.97));
      }
      // ---- a thin sheet of cirrus right in front of the lens (the dive through the deck, s28)
      if(uVeilP > 0.0){
        vec2 p = rd.xz / max(0.25, -rd.y) + vec2(0.0, -uLT * 0.9);
        p = mat2(0.82, 0.57, -0.57, 0.82) * p;
        float a = fb(p * vec2(1.6, 6.0) + 4.0, 6);
        float b = fb(p * vec2(4.0, 3.0) + a * 2.0, 5);
        float m = a * 0.65 + b * 0.35;
        vec3 vc = mix(vec3(0.42, 0.56, 0.95), vec3(0.96, 0.98, 1.0), smoothstep(0.42, 0.56, m));
        vc = mix(vc, vec3(1.08), smoothstep(0.56, 0.62, m));
        col = mix(col, vc, uVeilP * smoothstep(0.2, 0.46, m + uVeilP * 0.3));
      }
      col = col + vec3(0.7, 0.85, 1.0) * uFlash;
      writeOut(col, 1.0, vec3(0.0, 0.0, 1.0), 9000.0, 0.0);
    }
  `;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs, side: THREE.BackSide, depthWrite: false,
  });
}

export function buildPlanet(ctx) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(8000, 32, 16), planetMaterial());
  m.renderOrder = -9; m.frustumCulled = false; m.userData.noShadow = true; m.visible = false;
  ctx.scene.add(m);
  ctx.world.planet = m;
  const R = 6371;
  const rv = new THREE.Vector3(), uv = new THREE.Vector3(), fv = new THREE.Vector3(), d = new THREE.Vector3();
  // FX Energy reads the limb in NDC: y at a given x, for the flash that races along it
  ctx.world.limb = {
    fn(x) {
      const alt = m.material.uniforms.uAlt.value;
      const sd = -Math.sin(Math.acos(R / (R + alt)));
      const cam = ctx.camera, e = cam.matrixWorld.elements;
      rv.set(e[0], e[1], e[2]); uv.set(e[4], e[5], e[6]); fv.set(-e[8], -e[9], -e[10]);
      const ty = Math.tan((cam.fov * Math.PI) / 360), tx = ty * cam.aspect;
      let lo = -3, hi = 3;
      for (let i = 0; i < 24; i++) {
        const y = (lo + hi) / 2;
        d.copy(fv).addScaledVector(rv, x * tx).addScaledVector(uv, y * ty).normalize();
        if (d.y > sd) hi = y; else lo = y;
      }
      return (lo + hi) / 2;
    },
  };
  return {
    update(st) {
      const P = st.look.planet;
      const on = !!P;
      m.visible = on;
      ctx.world.sky.visible = !on;
      if (!on) return;
      m.position.copy(ctx.camera.position);
      const u = m.material.uniforms;
      u.uAlt.value = P.alt ?? 20;
      u.uShift.value.set(P.x ?? 0, P.z ?? 0);
      u.uCov.value = P.cov ?? 0.56;
      u.uSea.value = P.sea ?? 0;
      u.uFleet.value = P.fleet ?? 0;
      u.uFlash.value = P.flash ?? 0;
      u.uVeilP.value = P.veil ?? 0;
      u.uHeading.value = P.heading ?? 0;
      u.uLT.value = st.lt;
      u.uDeck.value = P.deck ?? 0;
      u.uSpace.value = P.space ?? -1;
    },
  };
}
