// Procedural 3D models: rigged characters, killers, props. Every character mesh has an
// "aura" twin (fresnel glow, drawn through walls) that can be toggled on.
import * as THREE from 'three';
import { tex } from './textures.js';
import { makeForemanGlb, animateGlb } from './foremanGlb.js';
import { applySkinFx } from './skinfx.js';

// ---------- aura material ----------
const auraMats = new Map();
export function auraMat(color) {
  const key = color;
  if (auraMats.has(key)) return auraMats.get(key);
  const m = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 color; uniform float opacity; varying vec3 vN; varying vec3 vV;
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); f = 0.18 + pow(f, 1.6)*1.1; gl_FragColor = vec4(color*f, f*opacity); }`,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  auraMats.set(key, m);
  return m;
}

const stdCache = new Map();
// Graphics detail: 'lite' uses cheap Lambert materials and fewer polygons (for low-end laptops)
export const DETAIL = { lite: false, seg: 1 };
export function setDetail(quality) {
  const lite = quality === 'potato' || quality === 'low';
  if (lite !== DETAIL.lite) stdCache.clear();
  DETAIL.lite = lite; DETAIL.seg = quality === 'potato' ? 0.5 : quality === 'low' ? 0.7 : 1;
}
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (stdCache.has(key)) return stdCache.get(key);
  if (DETAIL.lite) {
    const m = new THREE.MeshLambertMaterial({ color, ...(opts.emissive ? { emissive: opts.emissive, emissiveIntensity: opts.ei ?? 1 } : {}), ...(opts.map ? { map: tex(opts.map).map } : {}), ...(opts.transparent ? { transparent: true, opacity: opts.opacity } : {}), ...(opts.side ? { side: opts.side } : {}) });
    stdCache.set(key, m);
    return m;
  }
  const m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0, ...(opts.emissive ? { emissive: opts.emissive, emissiveIntensity: opts.ei ?? 1 } : {}), ...(opts.map ? { map: tex(opts.map).map, normalMap: tex(opts.map).normalMap } : {}), ...(opts.transparent ? { transparent: true, opacity: opts.opacity } : {}), ...(opts.side ? { side: opts.side } : {}) });
  stdCache.set(key, m);
  return m;
}

// ---------- rig ----------
// Characters are built from lathe-profiled limbs (organic tapering like real muscles),
// then every joint's parts are merged per material so a detailed body stays cheap to draw.
class Rig {
  constructor() { this.root = new THREE.Group(); this.j = {}; this.aura = []; this.meshes = []; this.pose = {}; this.phase = 0; this.t = Math.random() * 10; this.parts = []; }
  joint(name, parent, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); (parent ? this.j[parent] : this.root).add(g); this.j[name] = g; return g; }
  // geometry placed on a joint; merged in finalize()
  mesh(parent, geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, aura = true) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    this.parts.push({ parent, geo, material, m, aura });
  }
  finalize() {
    const byJoint = new Map();
    for (const p of this.parts) { if (!byJoint.has(p.parent)) byJoint.set(p.parent, []); byJoint.get(p.parent).push(p); }
    for (const [jn, list] of byJoint) {
      const jg = this.j[jn];
      const byMat = new Map();
      for (const p of list) { if (!byMat.has(p.material)) byMat.set(p.material, []); byMat.get(p.material).push(p); }
      for (const [material, ps] of byMat) {
        const mesh = new THREE.Mesh(mergeGeos(ps.map(p => ({ geo: p.geo, matrix: p.m }))), material);
        mesh.castShadow = true; jg.add(mesh); this.meshes.push(mesh);
      }
      const ap = list.filter(p => p.aura);
      if (ap.length) {
        const am = new THREE.Mesh(mergeGeos(ap.map(p => ({ geo: p.geo, matrix: p.m.clone().scale(new THREE.Vector3(1.05, 1.05, 1.05)) }))), auraMat(0xffffff));
        am.visible = false; am.renderOrder = 10; am.frustumCulled = false; jg.add(am); this.aura.push(am);
      }
    }
    this.parts = null;
    return this;
  }
  setAura(color) {
    for (const a of this.aura) { if (color == null) a.visible = false; else { a.visible = true; a.material = auraMat(color); } }
  }
  setOpacity(o) {
    for (const m of this.meshes) {
      if (!m.userData.baseMat) m.userData.baseMat = m.material;
      if (o >= 0.999) { m.material = m.userData.baseMat; m.castShadow = true; continue; }
      if (!m.userData.fadeMat) { m.userData.fadeMat = m.userData.baseMat.clone(); m.userData.fadeMat.transparent = true; m.userData.fadeMat.depthWrite = false; }
      m.userData.fadeMat.opacity = o; m.material = m.userData.fadeMat; m.castShadow = o > 0.5;
    }
  }
}

const sg = n => Math.max(5, Math.round(n * DETAIL.seg));
const G = {
  cap: (r, l) => new THREE.CapsuleGeometry(r, l, sg(5), sg(14)),
  sph: (r, w = 20, h = 14) => new THREE.SphereGeometry(r, sg(w), sg(h)),
  box: (x, y, z) => new THREE.BoxGeometry(x, y, z),
  cyl: (a, b, h, s = 10) => new THREE.CylinderGeometry(a, b, h, sg(s * 1.4)),
  cone: (r, h, s = 12) => new THREE.ConeGeometry(r, h, sg(s * 1.3)),
  tor: (r, t, a = Math.PI * 2) => new THREE.TorusGeometry(r, t, sg(8), sg(20), a),
};
// Lathe from a radius profile. prof: [[t, r], ...] with t 0..1 along the length.
// dir 'down': hangs from the joint (y 0 .. -len). 'up': grows upward (y 0 .. +len).
const latheCache = new Map();
function lathe(len, prof, dir = 'down', seg = 16) {
  const key = len + dir + JSON.stringify(prof) + DETAIL.seg;
  if (latheCache.has(key)) return latheCache.get(key);
  const pts = prof.map(([t, r]) => new THREE.Vector2(Math.max(0.0005, r), (dir === 'down' ? -t : t) * len));
  const r0 = prof[0], r1 = prof[prof.length - 1];
  pts.unshift(new THREE.Vector2(0.0005, (dir === 'down' ? -r0[0] : r0[0]) * len));
  pts.push(new THREE.Vector2(0.0005, (dir === 'down' ? -r1[0] : r1[0]) * len));
  if (dir === 'down') pts.reverse(); // bottom -> top for outward normals
  const g = new THREE.LatheGeometry(pts, sg(seg));
  latheCache.set(key, g);
  return g;
}

// o: { skin, top, sleeve, forearm, pants, shoes, hair, bulk, legLen, female, belly }
function buildBody(R, o) {
  const b = o.bulk || 1, L = (o.legLen || 0.45) / 0.45, fem = o.female ? 1 : 0, AL = o.arm || 1;
  const sh = b * (fem ? 0.92 : 1); // shoulder width
  R.joint('tilt', null, 0, 0, 0);
  R.joint('hips', 'tilt', 0, 0.885 * L, 0);
  R.joint('spine', 'hips');
  // pelvis + abdomen + chest
  R.mesh('hips', lathe(0.22, [[0, 0.135 * b], [0.35, (0.156 + fem * 0.012) * b], [0.7, (0.15 + fem * 0.01) * b], [1, 0.1 * b]]), o.pants, 0, 0.08, 0, 0, 0, 0, 1, 1, 0.7);
  const belly = o.belly || 0;
  R.mesh('spine', lathe(0.25, [[0, 0.14 * b], [0.5, (0.13 + belly) * b], [1, (0.142 - fem * 0.012) * b]], 'up'), o.top, 0, 0.0, 0, 0, 0, 0, 1, 1, 0.7 + belly * 1.2);
  R.mesh('spine', lathe(0.32, [[0, 0.142 * sh], [0.35, 0.163 * sh], [0.7, 0.173 * sh], [0.9, 0.148 * sh], [1, 0.07 * sh]], 'up'), o.top, 0, 0.22, 0, 0, 0, 0, 1.06, 1, 0.64);
  if (fem) for (const s of [-1, 1]) R.mesh('spine', G.sph(0.058, 12, 10), o.top, s * 0.062, 0.38, 0.072, 0, 0, 0, 1, 0.9, 0.75);
  for (const s of [-1, 1]) R.mesh('spine', G.sph(0.066 * sh, 12, 10), o.top, s * 0.185 * sh, 0.47, 0, 0, 0, 0, 1, 0.92, 0.95);
  R.mesh('spine', G.sph(0.1, 14, 10), o.top, 0, 0.5, -0.015, 0, 0, 0, 1.6 * sh, 0.45, 0.8);
  // neck + head
  R.mesh('spine', G.cyl(0.044, 0.05, 0.12, 9), o.skin, 0, 0.56, 0.005);
  R.joint('head', 'spine', 0, 0.6, 0);
  R.mesh('head', G.sph(0.1, 22, 16), o.skin, 0, 0.1, 0, 0, 0, 0, 0.86, 1.05, 1);
  R.mesh('head', G.sph(0.072, 16, 12), o.skin, 0, 0.045, 0.012, 0, 0, 0, 0.8, 0.66, 0.92);  // jaw
  R.mesh('head', G.sph(0.03, 10, 8), o.skin, 0, 0.022, 0.06, 0, 0, 0, 1.1, 0.7, 0.8, false); // chin
  if (!o.noFace) {
    R.mesh('head', G.sph(0.016, 10, 8), o.skin, 0, 0.088, 0.098, 0, 0, 0, 0.95, 1.5, 1.1, false);
    R.mesh('head', G.sph(0.013, 8, 6), o.skin, 0, 0.078, 0.104, 0, 0, 0, 1.3, 0.8, 0.9, false);
    for (const s of [-1, 1]) {
      R.mesh('head', G.sph(0.026, 8, 6), o.skin, s * 0.086, 0.095, -0.005, 0, 0, 0, 0.4, 1, 0.7, false);   // ears
      R.mesh('head', G.sph(0.0155, 10, 8), mat(0xe8e2da, { rough: 0.25 }), s * 0.034, 0.112, 0.08, 0, 0, 0, 1, 1, 1, false); // eyeballs
      R.mesh('head', G.sph(0.0085, 8, 6), mat(o.eye || 0x2a1e14, { rough: 0.2 }), s * 0.034, 0.112, 0.0935, 0, 0, 0, 1, 1, 0.5, false);
      R.mesh('head', G.sph(0.018, 8, 6), o.skin, s * 0.034, 0.122, 0.083, 0, 0, 0, 1.15, 0.55, 0.8, false);  // upper lids
      R.mesh('head', G.box(0.04, 0.008, 0.012), o.hair, s * 0.036, 0.137, 0.088, 0, 0, s * -0.12, 1, 1, 1, false); // brows
    }
    R.mesh('head', G.sph(0.02, 10, 6), mat(fem ? 0xb05a5a : 0x9a5a50, { rough: 0.5 }), 0, 0.052, 0.087, 0, 0, 0, 1.3, 0.4, 0.55, false); // lips
  }
  // arms with hands
  for (const s of [1, -1]) {
    const side = s > 0 ? 'L' : 'R';
    R.joint('sh' + side, 'spine', 0.2 * s * sh, 0.47, 0);
    R.mesh('sh' + side, lathe(0.29 * AL, [[0, 0.052 * b], [0.3, 0.05 * b], [0.75, 0.039 * b], [1, 0.035 * b]]), o.sleeve || o.top);
    R.joint('el' + side, 'sh' + side, 0, -0.29 * AL, 0);
    R.mesh('el' + side, lathe(0.27 * AL, [[0, 0.037 * b], [0.25, 0.042 * b], [0.75, 0.029 * b], [1, 0.024 * b]]), o.forearm || o.skin);
    R.mesh('el' + side, G.sph(0.038 * b, 10, 8), o.forearm || o.skin, 0, 0, 0, 0, 0, 0, 1, 1, 1, false);
    R.joint('hand' + side, 'el' + side, 0, -0.27 * AL, 0.01);
    if (o.claws) {
      R.mesh('hand' + side, G.box(0.075, 0.1, 0.04), o.hand || o.skin, 0, -0.04, 0);
      for (let i = 0; i < 3; i++) R.mesh('hand' + side, G.cyl(0.009, 0.005, 0.22, 5), o.hand || o.skin, (i - 1) * 0.026, -0.19, 0.012, 0.25, 0, (i - 1) * 0.06, 1, 1, 1, false);
    } else buildHand(R, 'hand' + side, s, o.hand || o.skin, b, o.nails);
    // legs
    R.joint('lg' + side, 'hips', 0.09 * s * b, -0.04, 0);
    const tl = 0.42 * L;
    R.mesh('lg' + side, lathe(tl, [[0, 0.08 * b], [0.15, 0.082 * b], [0.55, 0.066 * b], [0.88, 0.05 * b], [1, 0.047 * b]]), o.pants);
    R.joint('kn' + side, 'lg' + side, 0, -tl, 0);
    R.mesh('kn' + side, lathe(0.42 * L, [[0, 0.05 * b], [0.25, 0.057 * b], [0.55, 0.045 * b], [0.85, 0.031 * b], [1, 0.03 * b]]), o.pants);
    R.mesh('kn' + side, G.sph(0.05 * b, 10, 8), o.pants, 0, 0, 0, 0, 0, 0, 1, 1, 1, false);
    if (!o.noFeet) {
      R.mesh('kn' + side, G.sph(0.05, 12, 8), o.shoes, 0, -0.42 * L - 0.012, 0.05, 0, 0, 0, 0.95, 0.62, 2.0);
      R.mesh('kn' + side, G.cyl(0.048, 0.054, 0.12, 10), o.shoes, 0, -0.42 * L + 0.05, 0.0);
    }
  }
}
function buildHand(R, jn, s, skin, b = 1, nails = false) {
  R.mesh(jn, G.sph(0.042 * b, 10, 8), skin, 0, -0.04, 0, 0, 0, 0, 0.85, 1.15, 0.45);
  R.mesh(jn, G.cap(0.0105 * b, 0.032), skin, s * -0.03, -0.035, 0.016, 0.3, 0, s * 0.6, 1, 1, 1, false);
  for (let i = 0; i < 4; i++) {
    const len = [0.042, 0.05, 0.047, 0.036][i] * b;
    R.mesh(jn, G.cap(0.0085 * b, len), skin, (i - 1.5) * 0.017 * b, -0.1 * b, 0.004, 0.28, 0, 0, 1, 1, 1, false);
    if (nails) R.mesh(jn, G.cone(0.007, 0.07, 5), mat(0x141414), (i - 1.5) * 0.017 * b, -0.15 * b, 0.012, Math.PI + 0.3, 0, 0, 1, 1, 1, false);
  }
}

const FEMALE = { mara: true, june: true };
export function makeSurvivor(def, sk = {}) {
  const R = new Rig();
  const fem = !!FEMALE[def.id];
  def = { ...def, shirt: sk.shirt ?? def.shirt, pants: sk.pants ?? def.pants, hair: sk.hair ?? def.hair };
  const skin = mat(def.skin, { map: 'skin', rough: 0.62 });
  const shirt = mat(def.shirt, { map: 'cloth', rough: 0.95 });
  const pants = mat(def.pants, { map: 'cloth', rough: 0.95 });
  const hair = mat(def.hair, { rough: 0.75 });
  const shoes = mat(0x2a221c, { map: 'leather', rough: 0.7 });
  const dark = mat(new THREE.Color(def.shirt).multiplyScalar(0.55).getHex(), { map: 'cloth', rough: 1 });
  const longSleeve = def.id !== 'eli';
  buildBody(R, { skin, top: shirt, sleeve: shirt, forearm: longSleeve ? shirt : skin, pants, shoes, hair, female: fem, eye: def.id === 'june' ? 0x3a5a7a : 0x2a1e14 });
  // cuffs / wrists
  for (const s of ['L', 'R']) R.mesh('el' + s, G.cyl(0.03, 0.028, 0.03, 10), longSleeve ? dark : skin, 0, -0.255, 0, 0, 0, 0, 1, 1, 1, false);
  // hair
  const hs = def.hairStyle;
  R.mesh('head', G.sph(0.104, 18, 12), hair, 0, 0.142, -0.012, 0, 0, 0, 0.92, 0.74, 1.05);
  if (hs === 'long') {
    R.mesh('head', lathe(0.3, [[0, 0.088], [0.3, 0.095], [0.75, 0.085], [1, 0.05]], 'down', 12), hair, 0, 0.16, -0.035, -0.12, 0, 0, 1.05, 1, 0.75);
    R.mesh('head', G.sph(0.03, 8, 6), hair, 0.06, 0.15, 0.075, 0, 0, 0.4, 1.4, 0.5, 0.6, false);
  }
  if (hs === 'bun') { R.mesh('head', G.sph(0.048, 12, 10), hair, 0, 0.2, -0.085); R.mesh('head', G.sph(0.022, 8, 6), hair, -0.05, 0.12, 0.075, 0, 0, 0, 0.8, 1.6, 0.6, false); }
  if (hs === 'short') R.mesh('head', G.sph(0.106, 14, 10), hair, 0, 0.125, -0.02, 0.15, 0, 0, 0.93, 0.6, 1.0);
  if (hs === 'cap') {
    const capM = mat(0x5e2020, { map: 'cloth', rough: 0.9 });
    R.mesh('head', G.sph(0.108, 16, 10, 0), capM, 0, 0.155, -0.005, 0, 0, 0, 0.95, 0.62, 1.05);
    R.mesh('head', G.cyl(0.08, 0.08, 0.012, 16), capM, 0, 0.165, 0.105, 0.18, 0, 0, 1, 1, 0.75);
  }
  // clothing details per character
  if (def.id === 'mara') { // red field jacket: collar, zipper, pockets
    R.mesh('spine', G.tor(0.085, 0.03), dark, 0, 0.53, 0.005, Math.PI / 2 - 0.15, 0, 0, 1.15, 1, 0.9);
    R.mesh('spine', G.box(0.012, 0.42, 0.01), mat(0x8a8a86, { metal: 0.6, rough: 0.4 }), 0, 0.31, 0.118, 0, 0, 0, 1, 1, 1, false);
    for (const s of [-1, 1]) R.mesh('spine', G.box(0.07, 0.07, 0.02), dark, s * 0.07, 0.15, 0.1, 0, 0, 0, 1, 1, 1, false);
  } else if (def.id === 'eli') { // hoodie with hood on the back + mechanic gloves
    R.mesh('spine', G.sph(0.11, 14, 10), dark, 0, 0.5, -0.09, 0.4, 0, 0, 1.05, 0.75, 0.8);
    R.mesh('spine', G.box(0.2, 0.09, 0.03), dark, 0, 0.12, 0.1, 0, 0, 0, 1, 1, 1, false);
    for (const s of [-1, 1]) R.mesh('spine', G.cyl(0.004, 0.004, 0.12, 4), mat(0xdcdcdc), s * 0.03, 0.45, 0.115, 0.1, 0, 0, 1, 1, 1, false);
  } else if (def.id === 'june') { // sweater + scarf + camera strap
    R.mesh('spine', G.tor(0.075, 0.035), mat(0xc8b48a, { map: 'cloth', rough: 1 }), 0, 0.535, 0.005, Math.PI / 2, 0, 0, 1.2, 1, 1);
    R.mesh('spine', G.box(0.06, 0.2, 0.03), mat(0xc8b48a, { map: 'cloth', rough: 1 }), 0.05, 0.42, 0.11, 0.1, 0, 0.1);
    R.mesh('spine', G.tor(0.2, 0.008, Math.PI), mat(0x1a1a1a), 0, 0.42, 0.0, 0, 0, -0.6, 1, 1.2, 0.7);
    R.mesh('spine', G.box(0.09, 0.06, 0.05), mat(0x222222, { metal: 0.3, rough: 0.5 }), -0.1, 0.18, 0.11, 0, 0, 0, 1, 1, 1, false);
  } else { // ranger jacket with shoulder patches and pockets
    for (const s of [-1, 1]) { R.mesh('spine', G.box(0.075, 0.08, 0.025), dark, s * 0.075, 0.37, 0.11, 0, 0, 0, 1, 1, 1, false); R.mesh('spine', G.box(0.07, 0.055, 0.02), dark, s * 0.075, 0.14, 0.1, 0, 0, 0, 1, 1, 1, false); }
    R.mesh('spine', G.tor(0.085, 0.028), dark, 0, 0.53, 0.005, Math.PI / 2 - 0.15, 0, 0, 1.15, 1, 0.9);
  }
  // skin extras
  if (sk.hood) { R.mesh('head', G.sph(0.13, 16, 12), shirt, 0, 0.13, -0.02, 0, 0, 0, 1.05, 1.08, 1.1); R.mesh('spine', G.tor(0.09, 0.035), shirt, 0, 0.54, 0, Math.PI / 2, 0, 0, 1.2, 1, 1); }
  if (sk.beanie) R.mesh('head', G.sph(0.112, 16, 10), mat(sk.beanie, { map: 'cloth', rough: 1 }), 0, 0.15, -0.01, 0, 0, 0, 0.95, 0.8, 1.04);
  if (sk.vest) { R.mesh('spine', lathe(0.3, [[0, 0.15], [0.5, 0.176], [1, 0.16]], 'up', 14), mat(sk.vest, { rough: 0.6 }), 0, 0.2, 0, 0, 0, 0, 1.08, 1, 0.68); for (const y of [0.3, 0.42]) R.mesh('spine', G.box(0.33, 0.025, 0.24), mat(0xd8d8c8, { rough: 0.3, emissive: 0x3a3a30, ei: 0.4 }), 0, y, 0, 0, 0, 0, 1, 1, 1, false); }
  if (sk.glasses) for (const s2 of [-1, 1]) R.mesh('head', G.tor(0.018, 0.004), mat(0x111111), s2 * 0.034, 0.112, 0.097, 0, 0, 0, 1, 1, 1, false);
  // belt + backpack
  R.mesh('hips', G.cyl(0.157, 0.157, 0.045, 18), mat(0x241a12, { map: 'leather', rough: 0.6 }), 0, 0.07, 0, 0, 0, 0, 1, 1, 0.72);
  R.mesh('hips', G.box(0.045, 0.035, 0.02), mat(0xb0a070, { metal: 0.6, rough: 0.4 }), 0, 0.07, 0.113, 0, 0, 0, 1, 1, 1, false);
  const pack = mat(0x3b3226, { map: 'cloth', rough: 1 });
  R.mesh('spine', G.box(0.25, 0.3, 0.11), pack, 0, 0.32, -0.15);
  R.mesh('spine', G.box(0.2, 0.09, 0.05), pack, 0, 0.22, -0.215, 0, 0, 0, 1, 1, 1, false);
  R.mesh('spine', G.cyl(0.038, 0.038, 0.24, 10), mat(0x5a5040, { map: 'cloth', rough: 1 }), 0, 0.5, -0.17, 0, 0, Math.PI / 2, 1, 1, 1, false);
  for (const s of [-1, 1]) R.mesh('spine', G.box(0.03, 0.3, 0.012), mat(0x2a2218, { rough: 0.8 }), s * 0.09, 0.35, 0.11, 0, 0, 0, 1, 1, 1, false);
  R.kind = 'survivor';
  R.finalize();
  // wounds: wet blood on clothes and skin, shown when injured / dying (not merged so they can toggle)
  const bloodM = new THREE.MeshStandardMaterial({ color: 0x6a0606, emissive: 0x2a0000, roughness: 0.18, metalness: 0.08 });
  const ws = new THREE.SphereGeometry(1, 10, 8);
  const part = (jn, x, y, z, sx, sy, sz, rz = 0) => { const m = new THREE.Mesh(ws, bloodM); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.z = rz; m.visible = false; R.j[jn].add(m); return m; };
  const group = list => ({ set visible(v) { for (const m of list) m.visible = v; } });
  R.wounds = {
    light: group([part('spine', 0.04, 0.32, -0.108, 0.05, 0.12, 0.02, 0.3), part('spine', 0.158, 0.16, 0.02, 0.02, 0.09, 0.06), part('shL', 0.03, -0.16, 0.035, 0.03, 0.07, 0.03), part('spine', -0.06, 0.12, -0.1, 0.07, 0.05, 0.02, -0.4)]),
    heavy: group([part('spine', 0.02, 0.22, 0.106, 0.09, 0.14, 0.02, 0.2), part('lgR', 0.02, -0.22, 0.066, 0.035, 0.13, 0.025), part('handL', 0, -0.05, 0.01, 0.045, 0.055, 0.03), part('head', 0.05, 0.16, 0.08, 0.025, 0.05, 0.02, -0.5), part('kn' + 'L', 0.0, -0.12, 0.05, 0.03, 0.1, 0.02)]),
  };
  applySkinFx(R, sk);
  return R;
}

export function makeKiller(id, sk = {}) {
  if (id === 'foreman') { const g = makeForemanGlb(sk, DETAIL.lite); if (g) { applySkinFx(g, sk); return g; } }
  const R = new Rig();
  if (id === 'foreman') {
    // The Foreman (OFFAL crossover): tall, starved, ribs showing, mask of bone, a jaw full of teeth, hook and blade
    const flesh = mat(sk.flesh ?? 0xb89990, { map: 'skin', rough: 0.55 });
    const bone = mat(sk.bone ?? 0xd8ccbc, { rough: 0.6 });
    const apron = mat(sk.apron ?? 0x5a4a3c, { map: 'leather', rough: 0.55, side: THREE.DoubleSide });
    const steel = mat(sk.steel ?? 0x8a8a88, { map: 'metal', metal: 0.8, rough: 0.35 });
    buildBody(R, { skin: flesh, top: flesh, sleeve: flesh, forearm: flesh, pants: flesh, shoes: mat(0x1a1612, { map: 'leather' }), hair: mat(0x111111), bulk: 0.8, legLen: 0.6, arm: 1.75, noFace: true, claws: true });
    for (let i = 0; i < 5; i++) R.mesh('spine', G.tor(0.15 - i * 0.008, 0.011, Math.PI), bone, 0, 0.44 - i * 0.065, 0.06, Math.PI / 2 + 0.25, 0, Math.PI, 1, 1, 0.75, false);
    R.mesh('spine', G.cyl(0.02, 0.02, 0.6, 5), bone, 0, 0.3, -0.1, 0, 0, 0, 1, 1, 1, false);
    for (let i = 0; i < 6; i++) R.mesh('spine', G.sph(0.022, 6, 4), bone, 0, 0.06 + i * 0.09, -0.11, 0, 0, 0, 1, 1, 1, false);
    // stained apron + straps
    R.mesh('spine', new THREE.CylinderGeometry(0.17, 0.2, 0.45, 14, 1, true, -Math.PI * 0.42, Math.PI * 0.84), apron, 0, 0.15, 0.01, 0, 0, 0, 1, 1, 0.85);
    R.mesh('hips', new THREE.CylinderGeometry(0.19, 0.27, 0.95, 14, 1, true, -Math.PI * 0.42, Math.PI * 0.84), apron, 0, -0.42, 0.0, 0, 0, 0, 1, 1, 0.82);
    R.mesh('hips', G.sph(0.12, 10, 8), mat(sk.blood ?? 0x4a0806, { rough: 0.3 }), 0.04, -0.3, 0.17, 0, 0, 0, 0.9, 1.6, 0.25, false);
    for (const s2 of [-1, 1]) R.mesh('spine', G.box(0.03, 0.4, 0.02), apron, s2 * 0.1, 0.42, 0.11, -0.3, 0, 0, 1, 1, 1, false);
    // elongated bone mask with sockets, pinprick eyes and a hinged jaw of teeth
    R.mesh('spine', G.cyl(0.045, 0.06, 0.26, 7), flesh, 0, 0.6, 0.02);
    R.mesh('head', G.sph(0.17, 22, 16), bone, 0, 0.2, 0.02, 0, 0, 0, 0.82, 1.18, 0.9);
    for (const s2 of [-1, 1]) {
      R.mesh('head', G.sph(0.038, 8, 6), mat(0x050403), s2 * 0.055, 0.25, 0.14, 0, 0, 0, 1, 1, 0.45, false);
      R.mesh('head', G.sph(0.011, 6, 4), mat(sk.eye ?? 0xfff2c8, { emissive: sk.eye ?? 0xffe8a0, ei: 3 }), s2 * 0.055, 0.25, 0.157, 0, 0, 0, 1, 1, 1, false);
    }
    R.mesh('head', G.box(0.2, 0.1, 0.05), mat(0x050403), 0, 0.11, 0.12, 0, 0, 0, 1, 1, 1, false);
    const teeth = mat(0xb8a878, { rough: 0.5 }), gum = mat(0xa07070, { rough: 0.4 });
    R.mesh('head', G.box(0.2, 0.025, 0.035), gum, 0, 0.165, 0.135, 0, 0, 0, 1, 1, 1, false);
    for (let i = 0; i < 13; i++) { const a = (i / 12 - 0.5) * 1.7, h = 0.03 + ((i * 7) % 5) * 0.009; R.mesh('head', G.cone(0.009, h, 4), teeth, Math.sin(a) * 0.095, 0.155 - h / 2, Math.cos(a) * 0.06 + 0.09, Math.PI, i, 0, 1, 1, 1, false); }
    R.joint('jaw', 'head', 0, 0.12, 0.04);
    R.mesh('jaw', G.box(0.2, 0.035, 0.16), flesh, 0, -0.045, 0.06);
    R.mesh('jaw', G.box(0.2, 0.025, 0.035), gum, 0, -0.03, 0.135, 0, 0, 0, 1, 1, 1, false);
    for (let i = 0; i < 13; i++) { const a = (i / 12 - 0.5) * 1.7, h = 0.028 + ((i * 3) % 4) * 0.01; R.mesh('jaw', G.cone(0.008, h, 4), teeth, Math.sin(a) * 0.09, -0.02 + h / 2, Math.cos(a) * 0.055 + 0.085, 0, i, 0, 1, 1, 1, false); }
    // hook (right) and blade (left)
    R.mesh('handR', G.tor(0.13, 0.016, Math.PI * 1.35), steel, 0, -0.42, 0.04, 0, 0, Math.PI * 0.85);
    R.mesh('handR', G.cyl(0.014, 0.014, 0.25, 5), steel, 0, -0.22, 0.02);
    R.mesh('handR', G.cyl(0.03, 0.03, 0.12, 8), apron, 0, -0.08, 0.02);
    R.mesh('handL', G.box(0.012, 0.32, 0.16), steel, 0, -0.26, 0.07);
    R.root.scale.setScalar(1.08);
    R.hunch = 0.5;
  } else if (id === 'butcher') {
    const skin = mat(sk.skin ?? 0xa07c6a, { map: 'skin', rough: 0.7 });
    const shirt = mat(0x4a4038, { map: 'cloth' });
    buildBody(R, { skin, top: skin, sleeve: shirt, forearm: skin, pants: mat(0x2a2622, { map: 'cloth' }), shoes: mat(0x161210, { map: 'leather' }), hair: mat(0x1a1410), bulk: 1.38, legLen: 0.5, belly: 0.05, noFace: true });
    // stained apron draped over the belly, straps, sack mask
    const apron = mat(sk.apron ?? 0x8c7b66, { map: 'cloth', rough: 1, side: THREE.DoubleSide });
    R.mesh('spine', new THREE.CylinderGeometry(0.235, 0.255, 0.6, 16, 1, true, -Math.PI * 0.42, Math.PI * 0.84), apron, 0, 0.2, 0.0, 0, 0, 0, 1, 1, 0.82);
    R.mesh('hips', new THREE.CylinderGeometry(0.235, 0.27, 0.62, 16, 1, true, -Math.PI * 0.4, Math.PI * 0.8), apron, 0, -0.2, 0.0, 0, 0, 0, 1, 1, 0.8);
    R.mesh('spine', G.sph(0.18, 12, 10), mat(0x5a1410, { rough: 0.5 }), 0.06, 0.18, 0.15, 0, 0, 0, 0.9, 1.1, 0.3, false);
    for (const s of [-1, 1]) R.mesh('spine', G.box(0.04, 0.3, 0.02), mat(0x3a2a1a, { map: 'leather' }), s * 0.1, 0.36, 0.2, -0.15, 0, s * 0.1, 1, 1, 1, false);
    const sack = mat(sk.mask ?? 0xb8a27a, { map: 'cloth', rough: 1 });
    R.mesh('head', G.sph(0.14, 16, 12), sack, 0, 0.11, 0.0, 0, 0, 0, 1.0, 1.18, 1.05);
    for (const s of [-1, 1]) { R.mesh('head', G.sph(0.028, 8, 6), mat(0x050505), s * 0.05, 0.14, 0.125, 0, 0, 0, 1, 0.75, 0.5, false); R.mesh('head', G.cyl(0.004, 0.004, 0.08, 4), mat(0x2a1a10), s * 0.05, 0.14, 0.13, 0, 0, Math.PI / 2, 1, 1, 1, false); }
    R.mesh('head', G.box(0.1, 0.012, 0.02), mat(0x301010), 0, 0.05, 0.13, 0, 0, 0, 1, 1, 1, false);
    R.mesh('head', G.cyl(0.1, 0.12, 0.05, 12), mat(0x3a2a1a, { map: 'leather' }), 0, 0.0, 0);
    // cleaver
    R.mesh('handR', G.cyl(0.022, 0.026, 0.2), mat(0x3a2414, { map: 'wood' }), 0, -0.05, 0, Math.PI / 2, 0, 0);
    R.mesh('handR', G.box(0.025, 0.26, 0.4), mat(0x8a8d90, { metal: 0.85, rough: 0.3 }), 0, -0.09, 0.29);
    R.mesh('handR', G.box(0.027, 0.11, 0.18), mat(0x5a1410, { rough: 0.5 }), 0, -0.16, 0.38, 0, 0, 0, 1, 1, 1, false);
    R.root.scale.setScalar(1.15);
  } else if (id === 'wisp') {
    const skin = mat(0xc9d6da, { map: 'skin', rough: 0.5 });
    const dress = mat(sk.dress ?? 0xd8dde0, { map: 'cloth', rough: 1, side: THREE.DoubleSide });
    buildBody(R, { skin, top: dress, sleeve: dress, forearm: skin, pants: dress, shoes: skin, hair: mat(0x0a0c0e), bulk: 0.82, legLen: 0.5, female: true, noFace: true, noFeet: true, nails: true });
    R.mesh('hips', lathe(1.12, [[0, 0.15], [0.3, 0.24], [0.7, 0.36], [1, 0.5]], 'down', 18), dress, 0, 0.06, 0);
    R.mesh('hips', lathe(1.0, [[0, 0.17], [0.5, 0.3], [1, 0.44]], 'down', 12), mat(0x7a8a90, { rough: 1, side: THREE.DoubleSide }), 0.03, 0.0, -0.04, 0, 0.4, 0);
    const hairM = mat(0x0a0c0e, { rough: 0.9, side: THREE.DoubleSide });
    R.mesh('head', G.sph(0.11, 14, 10), hairM, 0, 0.13, -0.01, 0, 0, 0, 0.95, 1, 1.08);
    R.mesh('head', lathe(0.62, [[0, 0.1], [0.2, 0.115], [0.8, 0.1], [1, 0.06]], 'down', 14), hairM, 0, 0.18, 0.0, 0, 0, 0, 1.05, 1, 1.12);
    for (const s of [-1, 1]) R.mesh('head', G.sph(0.016, 8, 6), mat(sk.eye ?? 0x9ff6ff, { emissive: sk.eye ?? 0x7ff0ff, ei: 4 }), s * 0.035, 0.11, 0.105, 0, 0, 0, 1, 1, 1, false);
    R.float = true;
    R.root.scale.setScalar(1.12);
  } else if (id === 'lamplighter') {
    const coat = mat(sk.coat ?? 0x1a1d1a, { map: 'cloth', rough: 1, side: THREE.DoubleSide });
    const skin = mat(0x8a8f86, { map: 'skin', rough: 0.8 });
    buildBody(R, { skin, top: coat, sleeve: coat, forearm: coat, hand: mat(0x111111, { map: 'leather' }), pants: mat(0x141614, { map: 'cloth' }), shoes: mat(0x0e0e0e, { map: 'leather' }), hair: mat(0x111111), bulk: 0.95, legLen: 0.56, noFace: true });
    R.mesh('hips', lathe(1.0, [[0, 0.17], [0.4, 0.26], [1, 0.4]], 'down', 16), coat, 0, 0.1, -0.02);
    R.mesh('spine', G.box(0.38, 0.06, 0.3), coat, 0, 0.52, 0);
    for (let i = 0; i < 4; i++) R.mesh('spine', G.sph(0.012, 6, 4), mat(0x8a7a40, { metal: 0.7 }), 0.03, 0.12 + i * 0.1, 0.11, 0, 0, 0, 1, 1, 1, false);
    // porcelain mask + wide hat
    R.mesh('head', G.sph(0.112, 18, 14), mat(0xe8e2d4, { rough: 0.25 }), 0, 0.105, 0.012, 0, 0, 0, 0.92, 1.18, 1);
    for (const s of [-1, 1]) R.mesh('head', G.sph(0.02, 8, 6), mat(0x050505), s * 0.04, 0.13, 0.1, 0, 0, s * 0.3, 1.5, 0.45, 0.5, false);
    R.mesh('head', G.box(0.05, 0.005, 0.02), mat(0x050505), 0, 0.05, 0.11, 0, 0, 0, 1, 1, 1, false);
    R.mesh('head', G.cyl(0.29, 0.3, 0.018, 20), mat(0x111311, { map: 'leather' }), 0, 0.23, 0);
    R.mesh('head', G.cyl(0.12, 0.13, 0.22, 16), mat(0x111311, { map: 'leather' }), 0, 0.34, 0);
    R.mesh('head', G.cyl(0.131, 0.131, 0.03, 16), mat(0x3a2a1a), 0, 0.26, 0, 0, 0, 0, 1, 1, 1, false);
    // hook pole (right) + lantern (left)
    const iron = mat(0x2a2a28, { metal: 0.7, rough: 0.5 });
    R.mesh('handR', G.cyl(0.017, 0.02, 1.9), mat(0x3a2c1e, { map: 'wood' }), 0, -0.05, 0.3, Math.PI / 2, 0, 0);
    R.mesh('handR', G.tor(0.12, 0.016, Math.PI * 1.2), iron, 0, 0.04, 1.27, 0, Math.PI / 2, 0);
    R.joint('lantern', 'handL', 0, -0.06, 0.05);
    R.mesh('lantern', G.cyl(0.008, 0.008, 0.16, 5), iron, 0, -0.08, 0);
    R.mesh('lantern', G.box(0.13, 0.17, 0.13), mat(0x1a2a1a, { transparent: true, opacity: 0.55 }), 0, -0.25, 0);
    R.mesh('lantern', G.sph(0.045), mat(sk.lamp ?? 0x9fffb0, { emissive: sk.lamp ?? 0x5aff7a, ei: 5 }), 0, -0.25, 0, 0, 0, 0, 1, 1.3, 1, false);
    R.mesh('lantern', G.cone(0.1, 0.07, 4), iron, 0, -0.13, 0, 0, Math.PI / 4, 0);
    R.root.scale.setScalar(1.18);
    R.hunch = 0.12;
  } else {
    // harrower
    const skin = mat(0x6b5a48, { map: 'skin', rough: 0.85 });
    const fur = mat(sk.fur ?? 0x3a2c20, { map: 'hay', rough: 1, side: THREE.DoubleSide });
    buildBody(R, { skin, top: mat(0x4a3a2a, { map: 'leather' }), sleeve: fur, forearm: skin, pants: mat(0x2e2620, { map: 'leather' }), shoes: mat(0x1c1612, { map: 'leather' }), hair: mat(0x2a2018), bulk: 1.2, legLen: 0.5, noFace: true });
    R.mesh('spine', lathe(0.75, [[0, 0.16], [0.25, 0.3], [0.7, 0.42], [1, 0.46]], 'down', 14), fur, 0, 0.6, -0.05, 0, 0, 0, 1, 1, 0.8);
    const bone = mat(sk.bone ?? 0xd8ccae, { rough: 0.55 });
    R.mesh('head', G.sph(0.12, 16, 12), bone, 0, 0.11, 0.03, 0, 0, 0, 0.9, 1.05, 1.22);
    R.mesh('head', G.box(0.09, 0.07, 0.12), bone, 0, 0.045, 0.12);
    for (const s of [-1, 1]) {
      R.mesh('head', G.sph(0.028, 8, 6), mat(0x000000), s * 0.042, 0.13, 0.135, 0, 0, 0, 1, 1, 0.6, false);
      R.mesh('head', G.sph(0.01, 6, 4), mat(sk.eye ?? 0xff3020, { emissive: sk.eye ?? 0xff2010, ei: 3 }), s * 0.042, 0.13, 0.15, 0, 0, 0, 1, 1, 1, false);
      R.mesh('head', G.cyl(0.013, 0.023, 0.32), bone, 0.1 * s, 0.31, -0.02, 0, 0, -0.55 * s);
      R.mesh('head', G.cyl(0.008, 0.014, 0.15), bone, 0.2 * s, 0.43, 0.02, 0.3, 0, -1.1 * s, 1, 1, 1, false);
      R.mesh('head', G.cyl(0.008, 0.014, 0.14), bone, 0.15 * s, 0.48, -0.04, -0.4, 0, -0.2 * s, 1, 1, 1, false);
      R.mesh('head', G.cyl(0.007, 0.012, 0.11), bone, 0.25 * s, 0.36, 0.04, 0.5, 0, -1.6 * s, 1, 1, 1, false);
    }
    for (let i = 0; i < 5; i++) R.mesh('spine', G.cone(0.012, 0.06, 5), bone, -0.12 + i * 0.06, 0.52, 0.09, -0.3, 0, 0, 1, 1, 1, false); // tooth necklace
    R.mesh('handR', G.cyl(0.018, 0.022, 1.5), bone, 0, -0.05, 0.1, Math.PI / 2, 0, 0);
    R.mesh('handR', G.cone(0.04, 0.2, 6), bone, 0, -0.05, 0.92, Math.PI / 2, 0, 0);
    for (let i = 0; i < 3; i++) R.mesh('spine', G.cyl(0.012, 0.016, 0.75), bone, -0.06 + i * 0.06, 0.32, -0.22, 0.15, 0, -0.35 + i * 0.3);
    R.root.scale.setScalar(1.12);
    R.hunch = 0.25;
  }
  R.kind = 'killer'; R.killer = id;
  R.finalize();
  applySkinFx(R, sk);
  return R;
}

// ---------- animation ----------
const lerp = (a, b, k) => a + (b - a) * k;
// s: { anim, speed, crouch, injured, t, atk, vaultF, ... }
export function animate(R, s, dt) {
  if (R.fxTick) R.fxTick(dt, (R.t || 0) + dt);
  if (R.glb) return animateGlb(R, s, dt);
  R.t += dt;
  const t = R.t;
  const P = { hipsY: 0, tiltX: 0, tiltY: 0, spineX: R.hunch || 0, spineY: 0, headX: 0, shL: 0.08, shR: 0.08, shLz: 0.08, shRz: -0.08, elL: -0.15, elR: -0.15, lgL: 0, lgR: 0, knL: 0.05, knR: 0.05, lgLz: 0, lgRz: 0 };
  const a = s.anim;
  const sp = s.speed || 0;
  R.phase += dt * (sp * 2.6 + 0.0001);
  const ph = R.phase;
  const sw = Math.sin(ph), cw = Math.cos(ph);
  if (a === 'walk' || a === 'run' || a === 'crouchwalk') {
    const run = a === 'run';
    const amp = run ? 0.85 : a === 'crouchwalk' ? 0.35 : 0.5;
    P.lgL = -sw * amp; P.lgR = sw * amp;
    P.knL = 0.1 + Math.max(0, cw) * (run ? 1.3 : 0.7); P.knR = 0.1 + Math.max(0, -cw) * (run ? 1.3 : 0.7);
    P.shL = sw * amp * 0.8; P.shR = -sw * amp * 0.8;
    P.elL = run ? -1.3 : -0.35; P.elR = run ? -1.3 : -0.35;
    P.spineX += run ? 0.28 : 0.06;
    P.hipsY = run ? Math.abs(sw) * 0.06 - 0.03 : Math.abs(sw) * 0.03;
    if (a === 'crouchwalk') { P.hipsY = -0.36; P.spineX += 0.4; P.lgL -= 1.0; P.lgR -= 1.0; P.knL += 1.5; P.knR += 1.5; }
  } else if (a === 'crouch') {
    P.hipsY = -0.36; P.spineX += 0.45; P.lgL = -1.0; P.lgR = -1.0; P.knL = 1.66; P.knR = 1.66; P.shL = -0.3; P.shR = -0.3; P.elL = -0.8; P.elR = -0.8;
  } else if (a === 'idle') {
    P.spineX += Math.sin(t * 1.8) * 0.02; P.shL = 0.08 + Math.sin(t * 1.8) * 0.02;
  } else if (a === 'repair' || a === 'heal') {
    P.hipsY = -0.42; P.spineX += 0.45; P.lgL = -1.45; P.knL = 1.6; P.lgR = 0.15; P.knR = 1.75;
    const w = Math.sin(t * (a === 'repair' ? 9 : 4));
    P.shL = -1.05 + w * 0.15; P.shR = -1.05 - w * 0.15; P.elL = -0.6; P.elR = -0.6; P.headX = 0.25;
    if (a === 'heal') { P.shL = -0.9; P.shR = -0.9 + w * 0.1; }
  } else if (a === 'work') {
    const w = Math.sin(t * 6);
    P.shL = -1.35 + w * 0.12; P.shR = -1.35 - w * 0.12; P.elL = -0.35; P.elR = -0.35; P.spineX += 0.1;
  } else if (a === 'down') {
    P.tiltX = 1.45; P.hipsY = -0.75;
    const w = Math.sin(t * 2.2) * (sp > 0.1 ? 1 : 0.15);
    P.shL = -2.7 + w * 0.4; P.shR = -2.7 - w * 0.4; P.elL = -0.3; P.elR = -0.3; P.lgL = w * 0.2; P.lgR = -w * 0.2; P.knL = 0.3; P.knR = 0.3; P.headX = -0.6;
  } else if (a === 'carried') {
    P.tiltX = 1.57; P.shL = -1.5 + Math.sin(t * 7) * 0.2; P.shR = -1.6 + Math.sin(t * 7 + 1) * 0.2; P.lgL = -1.3; P.lgR = -1.4; P.knL = 0.6; P.knR = 0.4; P.headX = 0.4;
    if (s.struggle) { P.lgL += Math.sin(t * 14) * 0.4; P.lgR -= Math.sin(t * 14) * 0.4; }
  } else if (a === 'caged') {
    P.shL = -2.7 + Math.sin(t * 1.3) * 0.05; P.shR = -2.75; P.elL = -0.3; P.elR = -0.35; P.headX = 0.3; P.spineX += 0.05;
    P.hipsY = Math.sin(t * 1.3) * 0.01;
  } else if (a === 'sit') {
    P.hipsY = -0.46; P.lgL = -1.5; P.lgR = -1.42; P.knL = 1.55; P.knR = 1.4; P.spineX += 0.28 + Math.sin(t * 1.4) * 0.015;
    P.shL = -0.75; P.shR = -0.62; P.elL = -0.95; P.elR = -1.05; P.headX = 0.12 + Math.sin(t * 0.4) * 0.06; P.lgLz = 0.1;
  } else if (a === 'menace') {
    P.spineX += 0.12 + Math.sin(t * 1.1) * 0.05; P.headX = 0.18 + Math.sin(t * 0.7) * 0.06; P.spineY = Math.sin(t * 0.35) * 0.12;
    P.shR = -0.35 + Math.sin(t * 1.1) * 0.05; P.elR = -0.5; P.shL = 0.15; P.elL = -0.3; P.knL = 0.12; P.knR = 0.2; P.lgR = 0.12;
  } else if (a === 'vault') {
    P.tiltX = 0.55; P.lgL = -1.5; P.lgR = -1.1; P.knL = 1.7; P.knR = 1.2; P.shL = -1.6; P.shR = -1.4; P.hipsY = 0;
  }
  if (s.injured && (a === 'walk' || a === 'run' || a === 'idle')) { P.spineX += 0.12; P.shL = -0.55; P.elL = -1.7; P.shLz = -0.2; }
  if (s.flash && R.kind !== 'killer') { P.shR = -1.45; P.elR = -0.12; P.shRz = -0.05; } // torch held out in front
  // hit reaction: jolt forward, arch back, arms flung out
  if (s.hitF != null && s.hitF < 1 && a !== 'down') {
    const j = Math.sin(s.hitF * Math.PI);
    P.spineX -= 0.55 * j; P.headX -= 0.6 * j; P.shLz += 0.9 * j; P.shRz -= 0.9 * j; P.shL -= 0.6 * j; P.shR -= 0.5 * j; P.elL -= 0.6 * j; P.elR -= 0.6 * j;
  }
  // collapsing to the ground
  if (a === 'down' && s.fallF != null && s.fallF < 1) {
    const f = s.fallF;
    if (f < 0.35) { const k = f / 0.35; P.tiltX = 0.25 * k; P.hipsY = -0.35 * k; P.knL = 1.3 * k; P.knR = 1.1 * k; P.lgL = -0.6 * k; P.lgR = -0.4 * k; P.shL = -0.8; P.shR = -0.6; P.headX = 0.4; }
  }
  // killer specifics
  if (R.kind === 'killer') {
    if (s.carry) { P.shL = -2.5; P.elL = -0.9; }
    if (s.atk === 1) {
      // wind-up, then a diagonal strike across the body
      const f = s.atkF || 0;
      if (f < 0.22) { const w = f / 0.22; P.shR = lerp(-0.5, -2.95, w); P.shRz = lerp(-0.1, -0.7, w); P.elR = -1.1; P.spineY = -0.5 * w; P.spineX += 0.05; }
      else { const k = Math.min(1, (f - 0.22) / 0.4), e = 1 - (1 - k) * (1 - k); P.shR = lerp(-2.95, 0.65, e); P.shRz = lerp(-0.7, 0.55, e); P.elR = lerp(-1.1, -0.1, e); P.spineY = lerp(-0.5, 0.6, e); P.spineX += 0.4 * e; P.lgL = -0.5 * e; P.knL = 0.4 * e; }
      P.shL = -0.5; P.elL = -0.6;
    } else if (s.atk === 2 && s.atkHit) {
      // wipe the blood off the weapon
      P.shR = -1.25; P.shRz = 0.7; P.elR = -1.25; P.shL = -0.95 + Math.sin(t * 6) * 0.22; P.shLz = -0.35; P.elL = -1.35; P.headX = 0.4; P.spineX += 0.2; P.spineY = 0.15;
    } else if (s.atk === 2) {
      // missed: stumble through the follow-through and recover
      const f = s.recF || 0;
      P.spineX += 0.5 * (1 - f); P.shR = lerp(0.65, 0.1, f); P.shRz = 0.5 * (1 - f); P.elR = -0.2; P.headX = 0.25 * (1 - f); P.spineY = 0.5 * (1 - f); P.lgL = -0.4 * (1 - f); P.knL = 0.5 * (1 - f);
    }
    if (s.stun) { P.spineX = -0.3; P.shL = -2.3; P.shR = -2.1; P.elL = -1.9; P.elR = -1.8; P.shLz = 0.3; P.shRz = -0.3; P.headX = -0.5 + Math.sin(t * 9) * 0.2; P.knL = 0.4; P.knR = 0.2; P.lgL = -0.3; }
    if (s.tele) { P.shL = -1.6; P.elL = -0.4; P.shR = 0.3; P.spineX += 0.3; P.headX = 0.3; P.hipsY = -0.1; }
    if (s.act === 'kick') { P.lgR = -1.0 + Math.sin(t * 7) * 0.6; P.knR = 0.4; P.shL = -0.4; P.shR = -0.2; }
    if (s.act === 'break') { const w = (Math.sin(t * 5) + 1) / 2; P.shL = -2.8 + w * 2.4; P.shR = -2.8 + w * 2.4; P.spineX = 0.1 + w * 0.5; }
    if (s.act === 'pickup' || s.act === 'cage') { P.spineX += 0.7; P.shL = -1.3; P.shR = -1.3; P.knL = 0.6; P.knR = 0.6; P.lgL = -0.4; P.lgR = -0.4; P.hipsY = -0.12; }
    if (s.aim) { P.shR = -2.9; P.elR = -0.4; P.shL = -1.4; P.elL = -0.2; P.spineY = -0.3; }
    if (s.rampage) { P.spineX += 0.5; P.shL = 0.6; P.shR = -1.6; }
  }
  // ---- executions ----
  if (s.exec) {
    const f = s.exec.f, ch = s.exec.char;
    const ramp = (a0, a1) => Math.max(0, Math.min(1, (f - a0) / (a1 - a0)));
    const downPose = () => { P.tiltX = 1.45; P.hipsY = -0.75; P.shL = -2.5; P.shR = -2.4; P.elL = -0.3; P.elR = -0.3; P.lgL = 0.1; P.lgR = -0.1; P.knL = 0.3; P.knR = 0.3; P.headX = -0.5; P.spineX = 0; };
    if (s.exec.role === 'killer') {
      P.spineX = R.hunch || 0; P.spineY = 0; P.lgL = 0; P.lgR = 0; P.knL = 0.05; P.knR = 0.05; P.hipsY = 0;
      if (ch === 'butcher') {
        if (f < 0.2) { P.spineX += 0.75; P.knL = P.knR = 0.7; P.lgL = P.lgR = -0.45; P.hipsY = -0.14; P.shL = -1.2; P.shR = -0.5; }
        else {
          P.shL = -1.75; P.elL = -0.25;
          const sw = (a0, a1) => lerp(-2.95, 0.35, ramp(a0, a1));
          P.shR = f < 0.4 ? -2.95 : f < 0.5 ? sw(0.4, 0.5) : f < 0.6 ? lerp(0.35, -2.95, ramp(0.5, 0.6)) : f < 0.72 ? sw(0.6, 0.72) : 0.35;
          P.elR = -0.3; P.spineY = f > 0.4 && f < 0.8 ? 0.3 : 0; P.spineX += f > 0.4 && f < 0.8 ? 0.3 : 0.05;
        }
      } else if (ch === 'wisp') {
        const up = ramp(0.08, 0.4);
        P.shL = -1.6 - up * 0.55; P.shR = -1.55 - up * 0.6; P.elL = P.elR = -0.15; P.headX = -0.1 + up * 0.2; P.spineX -= up * 0.15;
      } else {
        if (f < 0.28) { P.shR = -2.95; P.shL = -2.9; P.elR = P.elL = -0.3; P.spineX -= 0.2 * ramp(0, 0.28); }
        else if (f < 0.42) { P.shR = 0.1; P.shL = 0.1; P.spineX += 0.75; P.hipsY = -0.18; P.knL = P.knR = 0.8; P.lgL = P.lgR = -0.55; }
        else if (f < 0.86) { const k2 = ramp(0.42, 0.86); P.shR = lerp(-0.6, -2.7, k2); P.shL = lerp(-0.6, -2.7, k2); P.elR = P.elL = -0.2; P.spineX -= k2 * 0.25; }
        else { P.shR = -1.2; P.shL = -0.5; P.spineY = -0.5; }
      }
    } else {
      if (ch === 'butcher') {
        if (f < 0.2 || f > 0.86) downPose();
        else {
          const alive = f < 0.6 ? 1 : 0.2;
          P.tiltX = 0; P.hipsY = 0; P.headX = -0.45 + (1 - alive) * 0.9; P.spineX = 0.1;
          P.shL = -2.2 * alive + Math.sin(t * 11) * 0.3 * alive; P.elL = -1.6 * alive; P.shR = -1.9 * alive; P.elR = -1.5 * alive;
          P.lgL = Math.sin(t * 13) * 0.5 * alive - 0.1; P.lgR = -Math.sin(t * 13) * 0.5 * alive - 0.1; P.knL = 0.5; P.knR = 0.4;
        }
      } else if (ch === 'wisp') {
        const life = 1 - ramp(0.45, 0.8);
        P.tiltX = 0; P.hipsY = 0; P.headX = -0.6 + (1 - life) * 1.0; P.spineX = -0.05;
        P.shL = -2.3 * life + 0.1; P.elL = -1.9 * life; P.shR = -2.1 * life + 0.1; P.elR = -1.7 * life;
        P.lgL = Math.sin(t * 15) * 0.6 * life + 0.05; P.lgR = -Math.sin(t * 15) * 0.6 * life + 0.05; P.knL = 0.4 * life + 0.1; P.knR = 0.3;
        if (f < 0.08) downPose();
      } else {
        downPose();
        if (f >= 0.42 && f < 0.86) { P.tiltX = 1.57; P.shL = -1.5; P.shR = -1.6; P.elL = P.elR = -0.1; P.lgL = -1.4; P.lgR = -1.5; P.knL = 0.3; P.knR = 0.4; P.headX = 0.6; P.hipsY = 0; }
        if (f >= 0.3 && f < 0.42) { P.shL = -1.0 + Math.sin(t * 25) * 0.4; P.shR = -1.0; P.headX = -1.0; }
      }
    }
  }
  if (R.j.jaw) {
    const jt = s.atk === 1 ? 0.95 : s.exec ? 0.7 : s.stun ? 0.9 : sp > 3 ? 0.35 + Math.sin(t * 9) * 0.12 : 0.08 + Math.sin(t * 1.7) * 0.04;
    R.j.jaw.rotation.x += (jt - R.j.jaw.rotation.x) * Math.min(1, dt * 10);
  }
  if (R.killer === 'foreman' && s.exec && s.exec.role === 'killer') {
    const f = s.exec.f;
    if (f < 0.25) { P.spineX = 0.9; P.shR = -0.9; P.elR = -0.3; P.shL = -0.5; P.knL = P.knR = 0.5; P.lgL = P.lgR = -0.35; P.hipsY = -0.12; }
    else if (f < 0.55) { const k2 = (f - 0.25) / 0.3; P.spineX = 0.9 - k2 * 0.7; P.shR = lerp(-0.9, -2.7, k2); P.elR = -0.2; P.shL = -0.4; }
    else { const k2 = Math.min(1, (f - 0.55) / 0.3); P.spineX = 0.2 + k2 * 0.3; P.shR = lerp(-2.7, 0.5, k2); P.elR = -0.4; P.spineY = -0.4 * k2; P.lgL = 0.3 * Math.sin(t * 6); P.lgR = -0.3 * Math.sin(t * 6); }
  }
  if (s.exec && s.exec.role === 'victim' && s.exec.char === 'foreman') {
    const f = s.exec.f;
    if (f >= 0.28) { P.tiltX = 0; P.hipsY = 0; P.headX = -0.9; P.spineX = -0.1; P.shL = 0.2 + Math.sin(t * 9) * (f < 0.5 ? 0.4 : 0.05); P.shR = 0.15; P.elL = -0.2; P.elR = -0.3; P.lgL = 0.1 + Math.sin(t * 11) * (f < 0.5 ? 0.5 : 0); P.lgR = -0.1; P.knL = 0.3; P.knR = 0.4; }
  }
  const k = 1 - Math.exp(-dt * (a === 'vault' ? 20 : s.exec ? 16 : (a === 'down' && s.fallF < 1) ? 5 : (s.atk === 1 ? 24 : 12)));
  for (const key in P) R.pose[key] = lerp(R.pose[key] ?? P[key], P[key], k);
  const q = R.pose, j = R.j;
  j.tilt.rotation.x = q.tiltX;
  j.hips.position.y = (j.hips.userData.y0 ??= j.hips.position.y) + q.hipsY;
  j.spine.rotation.x = q.spineX; j.spine.rotation.y = q.spineY;
  j.head.rotation.x = q.headX;
  j.shL.rotation.x = q.shL; j.shR.rotation.x = q.shR; j.shL.rotation.z = q.shLz; j.shR.rotation.z = q.shRz;
  j.elL.rotation.x = q.elL; j.elR.rotation.x = q.elR;
  j.lgL.rotation.x = q.lgL; j.lgR.rotation.x = q.lgR;
  j.knL.rotation.x = q.knL; j.knR.rotation.x = q.knR;
  if (R.float) j.tilt.position.y = 0.12 + Math.sin(t * 2) * 0.05;
}

// ---------- first-person killer viewmodel ----------
export function makeViewModel(id) {
  const g = new THREE.Group();
  const arm = new THREE.Group(); g.add(arm);          // right arm + weapon, animated as a whole
  const add = (parent, geo, m, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.set(rx, ry, rz); me.scale.set(sx, sy, sz); parent.add(me); return me; };
  const skin = { butcher: 0x9a7a68, wisp: 0xc9d6da, harrower: 0x3a2c20, lamplighter: 0x1a1d1a, foreman: 0xb89990 }[id];
  const bk = id === 'butcher' ? 1.5 : id === 'harrower' ? 1.25 : id === 'wisp' ? 0.85 : 1;
  const armM = mat(skin, { map: id === 'lamplighter' || id === 'harrower' ? 'cloth' : 'skin', rough: 0.75 });
  const handM = id === 'lamplighter' ? mat(0x111111, { map: 'leather' }) : mat(skin, { map: 'skin', rough: 0.7 });
  add(arm, lathe(0.42, [[0, 0.03 * bk], [0.3, 0.04 * bk], [0.75, 0.05 * bk], [1, 0.055 * bk]]), armM, 0, -0.02, 0.03, -Math.PI / 2, 0, 0);
  add(arm, G.sph(0.045 * bk, 12, 10), handM, 0, -0.005, 0.0, 0, 0, 0, 1.0, 0.75, 1.15);
  for (let i = 0; i < 4; i++) add(arm, G.cap(0.011 * bk, 0.03), handM, -0.028 * bk + i * 0.019 * bk, 0.022, -0.012, 0, 0, Math.PI / 2, 1, 1, 1);
  add(arm, G.cap(0.012 * bk, 0.03), handM, 0.035 * bk, 0.015, 0.02, 0.6, 0, 0.4);
  const tip = new THREE.Object3D(), base = new THREE.Object3D();
  if (id === 'butcher') {
    add(arm, G.cyl(0.025, 0.03, 0.2), mat(0x3a2414), 0, 0.02, -0.05, Math.PI / 2, 0, 0);
    add(arm, G.box(0.025, 0.24, 0.42), mat(0x9a9da0, { metal: 0.85, rough: 0.3 }), 0, 0.1, -0.33);
    add(arm, G.box(0.027, 0.1, 0.16), mat(0x5a1410, { rough: 0.5 }), 0, 0.05, -0.42);
    tip.position.set(0, 0.2, -0.52); base.position.set(0, 0.0, -0.15);
  } else if (id === 'wisp') {
    for (let i = -1; i <= 1; i++) add(arm, G.cone(0.009, 0.16, 5), mat(0x161616), i * 0.022, 0, -0.1, -Math.PI / 2, 0, 0);
    tip.position.set(0, 0, -0.2); base.position.set(0, 0, 0);
  } else if (id === 'harrower') {
    add(arm, G.cyl(0.018, 0.022, 1.3), mat(0xd8ccae), 0, 0, -0.3, Math.PI / 2, 0, 0);
    add(arm, G.cone(0.04, 0.2, 6), mat(0xd8ccae), 0, 0, -1.04, -Math.PI / 2, 0, 0);
    tip.position.set(0, 0, -1.1); base.position.set(0, 0, -0.5);
  } else if (id === 'foreman') {
    const steel = mat(0x8a8a88, { map: 'metal', metal: 0.8, rough: 0.35 });
    add(arm, G.cyl(0.014, 0.014, 0.25, 6), steel, 0, 0.03, -0.14, Math.PI / 2, 0, 0);
    add(arm, G.tor(0.13, 0.016, Math.PI * 1.35), steel, 0, 0.06, -0.38, Math.PI / 2, Math.PI, Math.PI * 0.35);
    tip.position.set(0, 0.12, -0.5); base.position.set(0, 0.02, -0.2);
  } else {
    add(arm, G.cyl(0.016, 0.018, 1.5), mat(0x3a2c1e), 0, 0, -0.4, Math.PI / 2, 0, 0);
    add(arm, G.tor(0.1, 0.014, Math.PI * 1.2), mat(0x2a2a28, { metal: 0.7 }), 0, 0.06, -1.15, 0, Math.PI / 2, 0);
    tip.position.set(0, 0.1, -1.2); base.position.set(0, 0, -0.6);
  }
  arm.add(tip); arm.add(base);
  // blood smear on the business end, revealed after a hit
  const bloodMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ color: 0x5a0505, roughness: 0.15, transparent: true, opacity: 0 }));
  bloodMesh.position.copy(tip.position).lerp(base.position, 0.3); bloodMesh.scale.set(0.035, 0.07, 0.12); bloodMesh.visible = false; bloodMesh.renderOrder = 6;
  arm.add(bloodMesh); g.userData.bloodMesh = bloodMesh;
  // left hand (holds the lantern for the Lamplighter)
  const left = new THREE.Group(); g.add(left);
  add(left, lathe(0.4, [[0, 0.03 * bk], [0.3, 0.04 * bk], [0.75, 0.05 * bk], [1, 0.055 * bk]]), armM, 0, 0, 0.03, -Math.PI / 2, 0, 0);
  add(left, G.sph(0.045 * bk, 12, 10), handM, 0, 0, 0, 0, 0, 0, 1.0, 0.7, 1.2);
  for (let i = 0; i < 4; i++) add(left, G.cap(0.01 * bk, 0.045), handM, -0.026 * bk + i * 0.018 * bk, -0.005, -0.06, -Math.PI / 2 + 0.3, 0, 0);
  if (id === 'lamplighter') {
    const lant = new THREE.Group(); lant.position.set(0, -0.12, -0.05); left.add(lant);
    add(lant, G.box(0.12, 0.16, 0.12), mat(0x1a2a1a, { transparent: true, opacity: 0.5 }), 0, 0, 0);
    add(lant, G.sph(0.04), mat(0x9fffb0, { emissive: 0x5aff7a, ei: 6 }), 0, 0, 0);
    add(lant, G.cone(0.09, 0.06, 4), mat(0x2a2a28), 0, 0.11, 0, 0, Math.PI / 4, 0);
    g.userData.lantern = lant;
  }
  g.userData = { ...g.userData, arm, left, tip, base, pose: null, id, bloodMesh };
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 5; } });
  return g;
}

// Keyframed first-person poses: [x, y, z, rx, ry, rz]
const VP = {
  idle:    [0.3, -0.36, -0.46, 0.12, 0.2, 0.05],
  windup:  [0.46, -0.06, -0.32, -0.75, 0.55, -1.0],
  strike:  [-0.28, -0.5, -0.5, 1.15, -0.7, 0.95],
  wipe:    [0.04, -0.3, -0.4, 0.15, 1.35, 1.5],
  aim:     [0.34, -0.02, -0.18, -1.25, 0.0, 0.0],
  stun:    [0.18, -0.2, -0.28, -0.7, 0.2, 0.5],
  rampage: [0.36, -0.22, -0.55, -0.35, 0.1, -0.3],
  carry:   [0.32, -0.4, -0.44, 0.25, 0.25, 0.1],
  act:     [0.2, -0.5, -0.5, 0.6, 0.1, 0.2],
  tele:    [0.25, -0.55, -0.4, 0.4, 0.3, 0.3],
};
const LP = { idle: [-0.34, -0.44, -0.5, 0.2, -0.1, 0], carry: [-0.3, -0.25, -0.42, -0.4, -0.2, 0.3], wipe: [-0.12, -0.3, -0.38, 0.4, -0.6, 0], stun: [-0.18, -0.2, -0.28, -0.7, -0.2, -0.5], act: [-0.2, -0.5, -0.5, 0.6, -0.1, -0.2], lantern: [-0.3, -0.2, -0.52, 0.1, 0.15, 0], tele: [-0.1, -0.15, -0.45, -0.6, 0, 0] };
const mixP = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
// s: { atk, atkF, atkHit, recF, aim, stun, rampage, carry, act, moving, speed, t, tele }
export function animateView(v, s, dt) {
  const u = v.userData;
  let target, k = 14;
  if (s.stun) target = VP.stun;
  else if (s.tele) target = VP.tele;
  else if (s.atk === 1) {
    const f = s.atkF || 0;
    if (f < 0.22) { target = mixP(VP.idle, VP.windup, f / 0.22); k = 40; }
    else { const e = Math.min(1, (f - 0.22) / 0.35); target = mixP(VP.windup, VP.strike, 1 - (1 - e) * (1 - e)); k = 45; }
  } else if (s.atk === 2 && s.atkHit) { target = VP.wipe; k = 8; }
  else if (s.atk === 2) { target = mixP(VP.strike, VP.idle, Math.min(1, (s.recF || 0) * 1.3)); k = 10; }
  else if (s.aim) target = VP.aim;
  else if (s.rampage) target = VP.rampage;
  else if (s.act) target = VP.act;
  else if (s.carry) target = VP.carry;
  else target = VP.idle;
  target = target.slice();
  // walk bob + idle sway
  const bob = Math.min(1, (s.speed || 0) / 4);
  target[0] += Math.sin(s.t * 4.5) * 0.012 * bob; target[1] += Math.abs(Math.sin(s.t * 4.5)) * 0.018 * bob + Math.sin(s.t * 1.3) * 0.004;
  if (s.atk === 2 && s.atkHit) { target[0] += Math.sin(s.t * 7) * 0.05; target[5] += Math.sin(s.t * 7) * 0.08; }
  if (s.act) { target[1] += Math.sin(s.t * 8) * 0.03; }
  const cur = u.pose || target;
  const kk = 1 - Math.exp(-dt * k);
  u.pose = mixP(cur, target, kk);
  u.arm.position.set(u.pose[0], u.pose[1], u.pose[2]); u.arm.rotation.set(u.pose[3], u.pose[4], u.pose[5]);
  let lt = s.stun ? LP.stun : s.tele ? LP.tele : (s.atk === 2 && s.atkHit) ? LP.wipe : s.act ? LP.act : s.carry ? LP.carry : u.id === 'lamplighter' ? LP.lantern : LP.idle;
  lt = lt.slice(); lt[1] += Math.abs(Math.sin(s.t * 4.5 + 1)) * 0.015 * bob;
  if (s.atk === 2 && s.atkHit) lt[0] += Math.sin(s.t * 7) * 0.06;
  u.lpose = mixP(u.lpose || lt, lt, 1 - Math.exp(-dt * 12));
  u.left.position.set(u.lpose[0], u.lpose[1], u.lpose[2]); u.left.rotation.set(u.lpose[3], u.lpose[4], u.lpose[5]);
  u.left.visible = u.id === 'lamplighter' || s.carry || s.act || s.stun || (s.atk === 2 && s.atkHit) || s.tele;
  if (u.lantern) u.lantern.rotation.z = Math.sin(s.t * 3) * 0.15;
}

export function makeLantern() {
  const g = new THREE.Group();
  const iron = mat(0x22221f, { metal: 0.7, rough: 0.5 });
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.set(rx, ry, rz); g.add(me); return me; };
  add(G.cyl(0.03, 0.05, 1.7, 6), mat(0x3a2c1e), 0, 0.85, 0);
  add(G.box(0.4, 0.03, 0.03), iron, 0.18, 1.68, 0);
  add(G.box(0.16, 0.22, 0.16), mat(0x1a2a1a, { transparent: true, opacity: 0.5 }), 0.34, 1.45, 0);
  const core = add(G.sph(0.06), mat(0xb0ffc0, { emissive: 0x5aff7a, ei: 6 }), 0.34, 1.45, 0);
  add(G.cone(0.12, 0.08, 4), iron, 0.34, 1.6, 0, 0, Math.PI / 4, 0);
  const ring = add(G.tor(0.5, 0.02), new THREE.MeshBasicMaterial({ color: 0x3aff6a, transparent: true, opacity: 0.35 }), 0, 0.03, 0, Math.PI / 2, 0, 0);
  g.userData = { core, ring };
  return g;
}

// ---------- props ----------
export function makeGenerator() {
  const g = new THREE.Group();
  const metal = mat(0x8a8478, { map: 'metal', metal: 0.4, rough: 0.6 });
  const dark = mat(0x2b2a28, { metal: 0.5, rough: 0.5 });
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.set(rx, ry, rz); me.castShadow = true; me.receiveShadow = true; g.add(me); return me; };
  add(G.box(1.25, 0.18, 0.95), dark, 0, 0.09, 0);
  const body = add(G.box(1.0, 0.72, 0.78), metal, 0, 0.55, 0);
  add(G.box(0.25, 0.6, 0.82), dark, -0.62, 0.48, 0);
  for (let i = 0; i < 6; i++) add(G.box(0.02, 0.5, 0.8), dark, -0.5 - i * 0.03, 0.5, 0);
  add(G.cyl(0.05, 0.05, 0.8), dark, 0.42, 1.2, -0.25);
  add(new THREE.TorusGeometry(0.2, 0.04, 8, 18), dark, 0.52, 0.6, 0.42, 0, 0, 0);
  const pistons = [];
  for (let i = 0; i < 4; i++) pistons.push(add(G.cyl(0.07, 0.07, 0.28), mat(0x5a5650, { metal: 0.7, rough: 0.4 }), -0.25 + i * 0.17, 1.02, 0.05));
  // lamp mast with 3 bulbs
  add(G.cyl(0.03, 0.03, 0.9), dark, 0.3, 1.35, 0.25);
  const bulbs = [];
  for (let i = 0; i < 3; i++) {
    const bm = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: 0xffb050, emissiveIntensity: 0, roughness: 0.3 });
    bulbs.push(add(G.sph(0.06), bm, 0.3 + (i - 1) * 0.16, 1.82, 0.25));
  }
  add(G.box(0.55, 0.03, 0.06), dark, 0.3, 1.76, 0.25);
  const auraM = new THREE.Mesh(G.box(1.3, 1.3, 1.0), auraMat(0xffffff)); auraM.position.y = 0.65; auraM.visible = false; auraM.renderOrder = 10; g.add(auraM);
  g.userData = { pistons, bulbs, body, aura: auraM };
  return g;
}

export function makeCage() {
  const g = new THREE.Group();
  const iron = mat(0x3a3430, { metal: 0.7, rough: 0.55, map: 'metal' });
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.set(rx, ry, rz); me.castShadow = true; g.add(me); return me; };
  add(G.cyl(0.95, 1.05, 0.2, 16), mat(0x4a4642, { map: 'stone' }), 0, 0.1, 0);
  for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; add(G.cyl(0.025, 0.025, 2.5, 6), iron, Math.cos(a) * 0.72, 1.45, Math.sin(a) * 0.72); }
  for (const y of [0.25, 1.4, 2.65]) add(new THREE.TorusGeometry(0.72, 0.035, 6, 24), iron, 0, y, 0, Math.PI / 2);
  add(G.cone(0.8, 0.7, 14), iron, 0, 3.0, 0);
  add(G.cone(0.04, 0.5, 6), iron, 0, 3.55, 0);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(G.cone(0.03, 0.35, 5), iron, Math.cos(a) * 0.75, 2.85, Math.sin(a) * 0.75, Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6); }
  // glowing sigil ring on the base (lit while someone is caged)
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x220a04, emissive: 0xff4a1a, emissiveIntensity: 0, roughness: 0.6 });
  const ring = add(new THREE.TorusGeometry(0.85, 0.03, 6, 32), ringMat, 0, 0.21, 0, Math.PI / 2);
  const auraM = new THREE.Mesh(G.cyl(0.8, 0.8, 3.0, 12), auraMat(0xffffff)); auraM.position.y = 1.5; auraM.visible = false; auraM.renderOrder = 10; g.add(auraM);
  g.userData = { ring, aura: auraM };
  return g;
}

export function makeBarricade(half) {
  const pivot = new THREE.Group();
  const lean = new THREE.Group(); pivot.add(lean);
  const wood = mat(0x8a6a48, { map: 'wood', rough: 0.9 });
  const w = half * 2 + 0.1, h = 1.1;
  const n = Math.max(3, Math.round(w / 0.36));
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(G.box(w / n - 0.04, h, 0.06), wood);
    m.position.set((i + 0.5) * w / n, h / 2, 0); m.rotation.z = (Math.random() - 0.5) * 0.04; m.castShadow = true; lean.add(m);
  }
  for (const y of [0.25, 0.85]) { const m = new THREE.Mesh(G.box(w, 0.12, 0.05), wood); m.position.set(w / 2, y, 0.06); m.castShadow = true; lean.add(m); }
  pivot.userData = { lean, w };
  return pivot;
}

export function makeGate() {
  const g = new THREE.Group();
  const metal = mat(0x4e4a46, { map: 'metal', metal: 0.6, rough: 0.5 });
  const doors = [];
  for (const s of [-1, 1]) {
    const d = new THREE.Group();
    for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(G.box(0.08, 4, 0.08), metal); b.position.set(s * (0.2 + i * 0.37), 2, 0); b.castShadow = true; d.add(b); }
    for (const y of [0.4, 2, 3.7]) { const b = new THREE.Mesh(G.box(2.3, 0.12, 0.1), metal); b.position.set(s * 1.15, y, 0); b.castShadow = true; d.add(b); }
    g.add(d); doors.push(d);
  }
  const arch = new THREE.Mesh(G.box(6.4, 0.6, 1.4), mat(0x55504a, { map: 'stone' })); arch.position.y = 5.1; arch.castShadow = true; g.add(arch);
  const lights = [];
  for (let i = 0; i < 3; i++) {
    const lm = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2020, emissiveIntensity: 0 });
    const l = new THREE.Mesh(G.sph(0.14), lm); l.position.set(-0.8 + i * 0.8, 4.65, 0.72); g.add(l); lights.push(l);
  }
  const auraM = new THREE.Mesh(G.box(5, 4.5, 0.6), auraMat(0xffffff)); auraM.position.y = 2.3; auraM.visible = false; auraM.renderOrder = 10; g.add(auraM);
  g.userData = { doors, lights, aura: auraM };
  return g;
}

export function makeSwitch() {
  const g = new THREE.Group();
  const box = new THREE.Mesh(G.box(0.6, 0.8, 0.45), mat(0x5a5650, { map: 'metal', metal: 0.5 })); box.position.y = 1.1; box.castShadow = true; g.add(box);
  const post = new THREE.Mesh(G.box(0.15, 0.75, 0.15), mat(0x2a2826)); post.position.y = 0.37; g.add(post);
  const lever = new THREE.Group(); lever.position.set(0.32, 1.1, 0); g.add(lever);
  const lm = new THREE.Mesh(G.cyl(0.025, 0.025, 0.45), mat(0x8a1010)); lm.position.y = 0.2; lever.add(lm);
  const lights = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.MeshStandardMaterial({ color: 0x110000, emissive: 0xff2a10, emissiveIntensity: 0 });
    const l = new THREE.Mesh(G.sph(0.045), m); l.position.set(-0.15 + i * 0.15, 1.55, 0); g.add(l); lights.push(l);
  }
  g.userData = { lever, lights };
  return g;
}

export function makeSpear() {
  const g = new THREE.Group();
  const bone = mat(0xd8ccae, { rough: 0.6 });
  const s = new THREE.Mesh(G.cyl(0.02, 0.025, 1.3), bone); s.rotation.x = Math.PI / 2; g.add(s);
  const tip = new THREE.Mesh(G.cone(0.045, 0.22, 6), bone); tip.rotation.x = Math.PI / 2; tip.position.z = 0.75; g.add(tip);
  return g;
}

// ---------- geometry helpers ----------
export function boxGeo(w, h, d, tile = 2) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
  }
  return geo;
}

export function mergeGeos(list) {
  // list of { geo, matrix } with indexed geometries carrying position/normal/uv
  let vCount = 0, iCount = 0;
  for (const { geo } of list) { vCount += geo.attributes.position.count; iCount += geo.index ? geo.index.count : geo.attributes.position.count; }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2), idx = new Uint32Array(iCount);
  const col = list.some(l => l.color || l.geo.attributes.color) ? new Float32Array(vCount * 3) : null;
  let vo = 0, io = 0;
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const { geo, matrix, color } of list) {
    const p = geo.attributes.position, n = geo.attributes.normal, u = geo.attributes.uv;
    nm.getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix); pos.set([v.x, v.y, v.z], (vo + i) * 3);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], (vo + i) * 3);
      if (u) uv.set([u.getX(i), u.getY(i)], (vo + i) * 2);
      if (col) { const va = geo.attributes.color; if (va) col.set([va.getX(i), va.getY(i), va.getZ(i)], (vo + i) * 3); else { const c = color || new THREE.Color(1, 1, 1); col.set([c.r, c.g, c.b], (vo + i) * 3); } }
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) idx[io + i] = geo.index.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) idx[io + i] = vo + i;
    vo += p.count; io += geo.index ? geo.index.count : p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

export function treeGeos(kind) {
  const M = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));
  if (kind === 'pine') {
    const trunk = mergeGeos([{ geo: G.cyl(0.08, 0.28, 9, 7), matrix: M(0, 4.5, 0) }]);
    const leaves = [];
    for (let i = 0; i < 5; i++) {
      const r = 1.9 - i * 0.33, h = 2.4 - i * 0.2;
      leaves.push({ geo: G.cone(r, h, 9), matrix: M(0, 2.6 + i * 1.35, 0, 0, i * 0.7, 0), color: new THREE.Color().setHSL(0.3, 0.25, 0.12 + i * 0.015) });
    }
    return { trunk, leaves: mergeGeos(leaves) };
  }
  // dead tree: trunk + crooked branches
  const parts = [{ geo: G.cyl(0.1, 0.32, 7, 7), matrix: M(0, 3.5, 0) }];
  const br = [[2.4, 0.9, 0], [3.2, -0.8, 1.2], [4.2, 0.7, 2.4], [5.0, -0.6, 3.6], [5.8, 0.5, 4.8], [6.4, -0.3, 0.6]];
  for (const [y, rz, ry] of br) {
    const len = 1.4 + (7 - y) * 0.15;
    const m = new THREE.Matrix4().makeRotationY(ry).multiply(M(Math.sin(rz) * -len * 0.5, y + Math.cos(rz) * len * 0.4, 0, 0, 0, rz));
    parts.push({ geo: G.cyl(0.025, 0.08, len, 5), matrix: m });
    const m2 = new THREE.Matrix4().makeRotationY(ry).multiply(M(Math.sin(rz) * -len * 1.05, y + Math.cos(rz) * len * 0.85, 0.1, 0.4, 0, rz * 1.6));
    parts.push({ geo: G.cyl(0.012, 0.03, len * 0.6, 4), matrix: m2 });
  }
  return { trunk: mergeGeos(parts), leaves: null };
}

// Pine with drooping, jagged branch skirts (much more natural than stacked cones)
export function pineGeo(seed) {
  let a = seed * 9301 + 49297; const rnd = () => { a = (a * 9301 + 49297) % 233280; return a / 233280; };
  const M = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));
  const trunk = mergeGeos([{ geo: new THREE.CylinderGeometry(0.07, 0.3, 9.5, 8), matrix: M(0, 4.75, 0) }]);
  const layers = [], n = 7;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), r = 2.3 - f * 1.75 + rnd() * 0.25, h = 2.1 - f * 0.7;
    const g = new THREE.ConeGeometry(r, h, 18, 2);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k), x = p.getX(k), z = p.getZ(k), rad = Math.hypot(x, z);
      if (rad < 1e-4) continue;
      const ang = Math.atan2(z, x), tip = (Math.round(ang / (Math.PI * 2) * 18) % 2 === 0) ? 1 : 0.62;
      const bottom = y < -h / 2 + 1e-3;
      const sc = bottom ? tip * (0.9 + rnd() * 0.2) : 1 + (rnd() - 0.5) * 0.15;
      p.setXYZ(k, x * sc, y - (bottom ? (tip === 1 ? h * 0.22 : -h * 0.05) : 0), z * sc);
    }
    g.computeVertexNormals();
    const shade = 0.75 + f * 0.35 + rnd() * 0.1;
    layers.push({ geo: g, matrix: M(0, 2.2 + i * 1.08, 0, (rnd() - 0.5) * 0.12, rnd() * 6, (rnd() - 0.5) * 0.12), color: new THREE.Color(0.085 * shade, 0.105 * shade, 0.05 * shade) });
  }
  return { trunk, leaves: mergeGeos(layers) };
}
export function bushGeo(seed) {
  const g = new THREE.IcosahedronGeometry(0.7, 2), p = g.attributes.position;
  let a = seed * 7919 + 13; const rnd = () => { a = (a * 9301 + 49297) % 233280; return a / 233280; };
  const off = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = p.getX(i).toFixed(2) + p.getY(i).toFixed(2) + p.getZ(i).toFixed(2);
    if (!off.has(key)) off.set(key, 0.7 + rnd() * 0.5);
    const k = off.get(key);
    p.setXYZ(i, p.getX(i) * k, Math.max(-0.1, p.getY(i) * k * 0.7), p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

export function rockGeo(seed) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const offs = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = p.getX(i).toFixed(3) + p.getY(i).toFixed(3) + p.getZ(i).toFixed(3);
    if (!offs.has(key)) offs.set(key, 0.75 + rnd() * 0.45);
    const k = offs.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.75, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}
