// Draws Fortnight's city island at night: everything static is merged into a few big meshes
// (one per material) or instanced, so the whole island costs a few dozen draw calls.
// Street lamps, lit windows and neon signs keep the streets readable; a handful of real lights
// follow you around from lamp to lamp.
import * as THREE from 'three';
import { tex } from './textures.js';
import { terrainH } from './map.js';
import { realistic } from './gfx.js';

const QUALITY = {
  potato: { shadow: 0, pixel: 0.6, far: 160, lights: 2 },
  low: { shadow: 0, pixel: 0.8, far: 220, lights: 4 },
  medium: { shadow: 1024, pixel: 1, far: 320, lights: 6 },
  high: { shadow: 2048, pixel: Math.min(2, window.devicePixelRatio || 1), far: 420, lights: 8 },
};
export const CITY_LOOK = { fog: 0x161e30, sky: [0x060b1a, 0x14203a] };

// ---------- procedural textures ----------
function canvasTex(size, paint, repeat = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'); paint(x, size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.repeat.set(repeat, repeat);
  return t;
}
const noise = (x, s, n, a, b) => { for (let i = 0; i < n; i++) { x.fillStyle = `rgba(${a},${a},${a},${Math.random() * b})`; x.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1 + Math.random() * 3); } };
const TEX = {};
function T(name) {
  if (TEX[name]) return TEX[name];
  let t;
  if (name === 'asphalt') t = canvasTex(256, (x, s) => { x.fillStyle = '#2a2c30'; x.fillRect(0, 0, s, s); noise(x, s, 5000, 70, 0.5); noise(x, s, 1600, 10, 0.6); for (let i = 0; i < 6; i++) { x.strokeStyle = 'rgba(15,15,18,0.5)'; x.lineWidth = 1; x.beginPath(); let px = Math.random() * s, py = Math.random() * s; x.moveTo(px, py); for (let k = 0; k < 8; k++) { px += (Math.random() - 0.5) * 30; py += (Math.random() - 0.5) * 30; x.lineTo(px, py); } x.stroke(); } });
  else if (name === 'pave') t = canvasTex(256, (x, s) => { x.fillStyle = '#6e6c66'; x.fillRect(0, 0, s, s); noise(x, s, 4000, 120, 0.25); x.strokeStyle = 'rgba(40,40,40,0.55)'; x.lineWidth = 2; for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * s / 4, 0); x.lineTo(i * s / 4, s); x.stroke(); x.beginPath(); x.moveTo(0, i * s / 4); x.lineTo(s, i * s / 4); x.stroke(); } });
  else if (name === 'plaster') t = canvasTex(256, (x, s) => { x.fillStyle = '#b8ab98'; x.fillRect(0, 0, s, s); noise(x, s, 6000, 90, 0.18); noise(x, s, 2000, 230, 0.12); for (let i = 0; i < 5; i++) { const g = x.createLinearGradient(0, 0, 0, s); g.addColorStop(0, 'rgba(60,50,40,0)'); g.addColorStop(1, 'rgba(60,50,40,0.18)'); x.fillStyle = g; x.fillRect(Math.random() * s, 0, 4 + Math.random() * 10, s); } });
  else if (name === 'concrete') t = canvasTex(256, (x, s) => { x.fillStyle = '#8a8a86'; x.fillRect(0, 0, s, s); noise(x, s, 7000, 60, 0.2); noise(x, s, 3000, 200, 0.12); x.strokeStyle = 'rgba(40,40,40,0.35)'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, s / 2); x.lineTo(s, s / 2); x.stroke(); });
  else if (name === 'floortile') t = canvasTex(256, (x, s) => { const n = 4, w = s / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = (i + j) % 2 ? '#c8c2b4' : '#8a8478'; x.fillRect(i * w, j * w, w, w); } noise(x, s, 2500, 60, 0.12); x.strokeStyle = 'rgba(30,30,30,0.5)'; x.lineWidth = 2; for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * w, 0); x.lineTo(i * w, s); x.stroke(); x.beginPath(); x.moveTo(0, i * w); x.lineTo(s, i * w); x.stroke(); } });
  else if (name === 'roof') t = canvasTex(128, (x, s) => { x.fillStyle = '#34312e'; x.fillRect(0, 0, s, s); noise(x, s, 2500, 90, 0.35); });
  else if (name === 'shingle') t = canvasTex(128, (x, s) => { x.fillStyle = '#5a2e26'; x.fillRect(0, 0, s, s); for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { x.fillStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.25})`; x.fillRect(c * 16 + (r % 2) * 8, r * 16, 15, 14); } noise(x, s, 800, 200, 0.1); });
  else if (name === 'pool') t = canvasTex(128, (x, s) => { const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(255,214,150,0.9)'); g.addColorStop(0.45, 'rgba(255,190,110,0.35)'); g.addColorStop(1, 'rgba(255,170,90,0)'); x.fillStyle = g; x.fillRect(0, 0, s, s); });
  else if (name === 'glow') t = canvasTex(64, (x, s) => { const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, s, s); });
  if (t) t.repeat.set(1, 1);
  return (TEX[name] = t);
}

// ---------- geometry building with world-space UVs (no stretched textures) ----------
class Batch {
  constructor(uvScale = 1) { this.p = []; this.n = []; this.uv = []; this.c = []; this.idx = []; this.s = uvScale; this.col = [1, 1, 1]; }
  quad(a, b, c, d, nx, ny, nz, uvs) { // four corners in order, normal, uv per corner
    const i = this.p.length / 3;
    for (const [v, u] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [d, uvs[3]]]) { this.p.push(v[0], v[1], v[2]); this.n.push(nx, ny, nz); this.uv.push(u[0] * this.s, u[1] * this.s); this.c.push(...this.col); }
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  // an axis-aligned box from (x0,y0,z0) to (x1,y1,z1); faces: skip bottom; uvs in metres
  box(x0, y0, z0, x1, y1, z1, noTop = false) {
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0, 0, -1, [[-x1, y0], [-x0, y0], [-x0, y1], [-x1, y1]]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1, 0, 0, [[-z1, y0], [-z0, y0], [-z0, y1], [-z1, y1]]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
    if (!noTop) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 0, 1, 0, [[x0, z1], [x1, z1], [x1, z0], [x0, z0]]);
  }
  flat(x0, z0, x1, z1, y, down = false) {
    if (down) this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], 0, -1, 0, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
    else this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], 0, 1, 0, [[x0, z1], [x1, z1], [x1, z0], [x0, z0]]);
  }
  mesh(mat) {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false;
    return m;
  }
}
const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, vertexColors: true, ...o });
const texMat = (name, uv, o = {}) => { const t = tex(name); return std({ map: t.map, normalMap: t.normalMap || null, ...o }); };

export function buildCityWorld(M, quality = 'medium') {
  const q = QUALITY[quality] || QUALITY.medium, C = M.city, lite = quality === 'potato' || quality === 'low';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CITY_LOOK.fog);
  scene.fog = new THREE.FogExp2(CITY_LOOK.fog, lite ? 0.0085 : 0.0068);
  const W = { city: true, look: { sky: CITY_LOOK.sky, fog: CITY_LOOK.fog }, scene, gens: [], cages: [], bars: [], gates: [], switches: [], genLights: [], gateLights: [], fogSprites: [], lamps: [], fogLayers: [] };
  // ---------- light: a bright moon, a cool sky, warm streets ----------
  W.hemi = new THREE.HemisphereLight(0x8a9ccc, 0x2c2a2a, 1.55); scene.add(W.hemi);
  W.amb = new THREE.AmbientLight(0x3c4660, 1.0); scene.add(W.amb);
  const moon = new THREE.DirectionalLight(0xc6d2f6, 2.4); moon.position.set(30, 60, 20);
  if (q.shadow) { moon.castShadow = true; moon.shadow.mapSize.set(q.shadow, q.shadow); const s = moon.shadow.camera; s.left = -45; s.right = 45; s.top = 45; s.bottom = -45; s.near = 5; s.far = 170; moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.04; }
  scene.add(moon, moon.target); W.moon = moon;
  W.fill = new THREE.PointLight(0xa8b4d0, 1.2, 14, 1.2); scene.add(W.fill);
  // real lights that hop between the street and room lamps nearest to you
  W.dyn = { lights: [], t: 0, cands: [...C.lamps.map(l => ({ x: l.x + Math.sin(l.rot) * 1.1, y: 5.2, z: l.z + Math.cos(l.rot) * 1.1, col: 0xffc890, i: 22, d: 20 })), ...C.ceilLamps.map(l => ({ x: l.x, y: l.y - 0.3, z: l.z, col: 0xffd8a8, i: 9, d: 9 }))] };
  for (let i = 0; i < q.lights; i++) { const L = new THREE.PointLight(0xffc890, 0, 20, 1.6); scene.add(L); W.dyn.lights.push(L); }

  // ---------- sky: night gradient, stars, a big moon ----------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(CITY_LOOK.sky[0]) }, mid: { value: new THREE.Color(CITY_LOOK.sky[1]) }, bot: { value: new THREE.Color(0x2a2a3a) }, mdir: { value: new THREE.Vector3(30, 60, 20).normalize() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 mdir; varying vec3 vP;
      void main(){ vec3 d = normalize(vP); float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(bot, mid, smoothstep(0.0, 0.16, h)); c = mix(c, top, smoothstep(0.16, 0.7, h));
        float m = max(dot(d, mdir), 0.0); c += vec3(0.3, 0.36, 0.5) * pow(m, 24.0) * 0.7 + vec3(0.1, 0.13, 0.2) * pow(m, 4.0) * 0.5;
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.renderOrder = -10; sky.scale.setScalar(Math.min(1, q.far * 0.9 / 480)); scene.add(sky); W.sky = sky;
  { const g = new THREE.BufferGeometry(), sp = []; for (let i = 0; i < 1400; i++) { const u = Math.random() * 6.28, v = Math.random() * 0.48 + 0.04; sp.push(Math.cos(u) * Math.cos(v * Math.PI) * 430, Math.sin(v * Math.PI) * 430, Math.sin(u) * Math.cos(v * Math.PI) * 430); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sky.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd0dcf8, size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }))); }
  { const md = new THREE.Vector3(30, 60, 20).normalize(), disc = new THREE.Mesh(new THREE.CircleGeometry(11, 32), new THREE.MeshBasicMaterial({ color: 0xf4f6ff, fog: false })); disc.position.copy(md).multiplyScalar(396); disc.lookAt(0, 0, 0); sky.add(disc);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: T('glow'), color: 0x9fb4e8, fog: false, depthWrite: false, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending })); halo.scale.setScalar(140); halo.position.copy(md).multiplyScalar(395); sky.add(halo); }

  // ---------- the sea ----------
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ color: 0x0c1a2c, roughness: 0.18, metalness: 0.55 }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = -0.55; scene.add(sea); W.sea = sea;

  // ---------- ground: grass and woods, sand at the edge, all on the terrain ----------
  {
    const S = M.half + 22, seg = lite ? 150 : 220, g = new THREE.PlaneGeometry(S * 2, S * 2, seg, seg); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    const grass = new THREE.Color(0x3a4a2a), grass2 = new THREE.Color(0x4a5a30), dirt = new THREE.Color(0x4a3e2c), sand = new THREE.Color(0x8a7a5a), forest = new THREE.Color(0x2a3020);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), e = Math.max(Math.abs(x), Math.abs(z)), h = terrainH(M, x, z);
      p.setY(i, h);
      c.copy(grass).lerp(grass2, 0.5 + 0.5 * Math.sin(x * 0.07 + Math.cos(z * 0.05) * 2));
      if (e > 158) c.lerp(forest, Math.min(1, (e - 158) / 10) * 0.7);
      if (h > 6) c.lerp(dirt, Math.min(1, (h - 6) / 10) * 0.6);
      if (e > M.half - 12) c.lerp(sand, Math.min(1, (e - (M.half - 12)) / 6));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
    const gt = tex('grass');
    const mat = new THREE.MeshLambertMaterial({ map: gt.map, vertexColors: true });
    if (mat.map) { mat.map = mat.map.clone(); mat.map.needsUpdate = true; mat.map.repeat.set(S / 3, S / 3); mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping; }
    const ground = new THREE.Mesh(g, mat); ground.receiveShadow = true; scene.add(ground); W.ground = ground;
  }

  // ---------- streets: asphalt, kerbs and sidewalks, markings ----------
  const RD = 4.6, WK = 1.7;
  const asphalt = new Batch(1 / 6), walk = new Batch(1 / 2), marks = new Batch(1), pave = new Batch(1 / 2);
  for (const r of C.roads) {
    const alongX = r.z0 === r.z1, L = alongX ? r.z0 : r.x0, a0 = alongX ? r.x0 : r.z0, a1 = alongX ? r.x1 : r.z1;
    if (alongX) asphalt.flat(a0, L - RD, a1, L + RD, 0.025); else asphalt.flat(L - RD, a0, L + RD, a1, 0.025);
    for (const s of [-1, 1]) {
      const w0 = L + s * RD, w1 = L + s * (RD + WK);
      if (alongX) walk.box(a0, 0, Math.min(w0, w1), a1, 0.14, Math.max(w0, w1)); else walk.box(Math.min(w0, w1), 0, a0, Math.max(w0, w1), 0.14, a1);
    }
    // dashed centre line, skipping the junctions
    for (let a = a0 + 2; a < a1 - 2; a += 6) {
      if ([-150, -90, -30, 30, 90, 150].some(k => Math.abs(a - k) < RD + WK + 1.5)) continue;
      if (alongX) marks.flat(a, L - 0.08, a + 3, L + 0.08, 0.04); else marks.flat(L - 0.08, a, L + 0.08, a + 3, 0.04);
    }
  }
  // zebra crossings at every junction
  for (const X of [-150, -90, -30, 30, 90, 150]) for (const Z of [-150, -90, -30, 30, 90, 150]) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const cx = X + dx * (RD + WK + 1.2), cz = Z + dz * (RD + WK + 1.2);
    for (let k = -3; k <= 3; k++) { if (dx) marks.flat(cx - 1, Z + k * 1.2 - 0.3, cx + 1, Z + k * 1.2 + 0.3, 0.04); else marks.flat(X + k * 1.2 - 0.3, cz - 1, X + k * 1.2 + 0.3, cz + 1, 0.04); }
  }
  for (const l of [...C.lots.filter(l => l.kind === 'pave' || l.kind === 'yard'), ...C.plazas]) pave.flat(l.x0, l.z0, l.x1, l.z1, 0.02);
  const add = m => { if (m) scene.add(m); return m; };
  const polyOff = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 };
  add(asphalt.mesh(std({ map: T('asphalt'), roughness: 0.92, ...polyOff })));
  add(walk.mesh(std({ map: T('pave'), roughness: 0.9 })));
  add(pave.mesh(std({ map: T('pave'), roughness: 0.9, ...polyOff })));
  add(marks.mesh(new THREE.MeshStandardMaterial({ color: 0xd8d4c4, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })));

  // ---------- buildings: walls (merged per material), floors, ceilings, roofs ----------
  const styleMat = {
    brick: () => texMat('brick', 1, { color: 0xb8a090 }), plaster: () => std({ map: T('plaster') }), concrete: () => std({ map: T('concrete') }),
    boards: () => texMat('boards', 1, { color: 0xc8b8a0 }), metal: () => texMat('metal', 1, { color: 0x9aa4ac, metalness: 0.4, roughness: 0.55 }), wood: () => texMat('wood', 1),
  };
  const batches = {};
  const B = (key, scale) => batches[key] || (batches[key] = new Batch(scale));
  const SCALE = { brick: 1 / 2.2, plaster: 1 / 3, concrete: 1 / 3, boards: 1 / 2, metal: 1 / 2.5, wood: 1 / 1.5 };
  const COLORS = { bin: [0.18, 0.26, 0.2], pump: [0.75, 0.2, 0.18], stall: [0.55, 0.4, 0.28], bench: [0.45, 0.32, 0.2], pillar: [0.8, 0.78, 0.74] };
  for (const b of M.boxes) {
    if (b.kind === 'boundary' || b.kind === 'car') continue;
    let style = b.style;
    if (b.kind === 'container') { const k = B('metal', SCALE.metal); const c = new THREE.Color(b.style); k.col = [c.r * 1.4, c.g * 1.4, c.b * 1.4]; k.box(b.x - b.hx, 0, b.z - b.hz, b.x + b.hx, b.h, b.z + b.hz); k.col = [1, 1, 1]; continue; }
    if (b.kind === 'crate' || b.kind === 'bench' || b.kind === 'stall') style = 'wood';
    if (!styleMat[style]) style = 'concrete';
    const k = B(style, SCALE[style]); k.col = COLORS[b.kind] || [1, 1, 1];
    k.box(b.x - b.hx, b.y0 || 0, b.z - b.hz, b.x + b.hx, b.h, b.z + b.hz);
    k.col = [1, 1, 1];
  }
  for (const s in batches) add(batches[s].mesh(styleMat[s]()));
  const floors = { boards: new Batch(1 / 2), tiles: new Batch(1 / 1.5), concrete: new Batch(1 / 3) };
  for (const f of C.floors) floors[f.kind].flat(f.x0, f.z0, f.x1, f.z1, 0.03);
  add(floors.boards.mesh(texMat('boards', 1, { color: 0x9a7a5a, ...polyOff })));
  add(floors.tiles.mesh(std({ map: T('floortile'), ...polyOff })));
  add(floors.concrete.mesh(std({ map: T('concrete'), ...polyOff })));
  const ceil = new Batch(1 / 3); for (const c of C.ceilings) ceil.flat(c.x0, c.z0, c.x1, c.z1, c.y, true);
  add(ceil.mesh(std({ map: T('plaster'), color: 0xd8d0c4 })));
  // roofs: flat with a parapet, or pitched for houses and cabins
  const flatR = new Batch(1 / 3), parapet = new Batch(1 / 3), shingle = new Batch(1 / 2);
  for (const r of C.roofs) {
    if (r.kind === 'flat') {
      flatR.flat(r.x0, r.z0, r.x1, r.z1, r.y + 0.02);
      parapet.box(r.x0 - 0.1, r.y, r.z0 - 0.1, r.x1 + 0.1, r.y + 0.55, r.z0 + 0.15); parapet.box(r.x0 - 0.1, r.y, r.z1 - 0.15, r.x1 + 0.1, r.y + 0.55, r.z1 + 0.1);
      parapet.box(r.x0 - 0.1, r.y, r.z0, r.x0 + 0.15, r.y + 0.55, r.z1); parapet.box(r.x1 - 0.15, r.y, r.z0, r.x1 + 0.1, r.y + 0.55, r.z1);
    } else {
      // ridge along the longer side; slopes and gable ends
      const alongX = (r.x1 - r.x0) >= (r.z1 - r.z0), o = 0.45, y = r.y, hR = Math.min(3, ((alongX ? r.z1 - r.z0 : r.x1 - r.x0) / 2) * 0.75);
      if (alongX) {
        const zm = (r.z0 + r.z1) / 2, a = r.x0 - o, b = r.x1 + o;
        shingle.quad([a, y, r.z0 - o], [b, y, r.z0 - o], [b, y + hR, zm], [a, y + hR, zm], 0, 0.7, -0.7, [[a, 0], [b, 0], [b, 4], [a, 4]]);
        shingle.quad([b, y, r.z1 + o], [a, y, r.z1 + o], [a, y + hR, zm], [b, y + hR, zm], 0, 0.7, 0.7, [[b, 0], [a, 0], [a, 4], [b, 4]]);
        for (const xx of [r.x0, r.x1]) { const s = xx === r.x0 ? -1 : 1; parapet.quad([xx, y, r.z0], [xx, y, r.z1], [xx, y + hR, zm], [xx, y + hR, zm], s, 0, 0, [[r.z0, y], [r.z1, y], [zm, y + hR], [zm, y + hR]]); parapet.quad([xx, y, r.z1], [xx, y, r.z0], [xx, y + hR, zm], [xx, y + hR, zm], -s, 0, 0, [[r.z1, y], [r.z0, y], [zm, y + hR], [zm, y + hR]]); }
      } else {
        const xm = (r.x0 + r.x1) / 2, a = r.z0 - o, b = r.z1 + o;
        shingle.quad([r.x0 - o, y, b], [r.x0 - o, y, a], [xm, y + hR, a], [xm, y + hR, b], -0.7, 0.7, 0, [[b, 0], [a, 0], [a, 4], [b, 4]]);
        shingle.quad([r.x1 + o, y, a], [r.x1 + o, y, b], [xm, y + hR, b], [xm, y + hR, a], 0.7, 0.7, 0, [[a, 0], [b, 0], [b, 4], [a, 4]]);
        for (const zz of [r.z0, r.z1]) { const s = zz === r.z0 ? -1 : 1; parapet.quad([r.x1, y, zz], [r.x0, y, zz], [xm, y + hR, zz], [xm, y + hR, zz], 0, 0, s, [[r.x1, y], [r.x0, y], [xm, y + hR], [xm, y + hR]]); parapet.quad([r.x0, y, zz], [r.x1, y, zz], [xm, y + hR, zz], [xm, y + hR, zz], 0, 0, -s, [[r.x0, y], [r.x1, y], [xm, y + hR], [xm, y + hR]]); }
      }
    }
  }
  add(flatR.mesh(std({ map: T('roof') })));
  add(parapet.mesh(std({ map: T('concrete'), color: 0x9a9690, side: THREE.DoubleSide })));
  add(shingle.mesh(std({ map: T('shingle'), side: THREE.DoubleSide })));
  // lit windows on the upper floors, neon shop signs, awnings, canopies, room lamps
  const glowB = new Batch(1), neon = new Batch(1);
  const WC = [[0.06, 0.07, 0.1], [1.0, 0.82, 0.52], [0.62, 0.8, 1.0]];
  for (const w of C.wins) {
    glowB.col = WC[w.lit]; const hw = w.w / 2, y0 = w.y - w.h / 2, y1 = w.y + w.h / 2;
    if (w.nz) glowB.quad([w.x - hw * w.nz, y0, w.z], [w.x + hw * w.nz, y0, w.z], [w.x + hw * w.nz, y1, w.z], [w.x - hw * w.nz, y1, w.z], 0, 0, w.nz, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    else glowB.quad([w.x, y0, w.z + hw * w.nx], [w.x, y0, w.z - hw * w.nx], [w.x, y1, w.z - hw * w.nx], [w.x, y1, w.z + hw * w.nx], w.nx, 0, 0, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  for (const l of C.ceilLamps) { glowB.col = [1, 0.9, 0.72]; glowB.flat(l.x - 0.35, l.z - 0.35, l.x + 0.35, l.z + 0.35, l.y, true); }
  for (const s of C.signs) {
    const c = new THREE.Color(s.col); neon.col = [c.r * 1.6, c.g * 1.6, c.b * 1.6]; const hw = s.w / 2;
    if (s.nz) neon.box(s.x - hw, s.y, s.z - 0.08, s.x + hw, s.y + 0.7, s.z + 0.08); else neon.box(s.x - 0.08, s.y, s.z - hw, s.x + 0.08, s.y + 0.7, s.z + hw);
  }
  add(glowB.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, ...polyOff })));
  add(neon.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));
  const cloth = new Batch(1);
  for (const a of C.awnings) { const c = new THREE.Color(a.col); cloth.col = [c.r, c.g, c.b]; const hw = a.w / 2, d = 1.4;
    if (a.nz) cloth.quad([a.x - hw, a.y + 0.6, a.z - a.nz * d / 2], [a.x + hw, a.y + 0.6, a.z - a.nz * d / 2], [a.x + hw, a.y, a.z + a.nz * d / 2], [a.x - hw, a.y, a.z + a.nz * d / 2], 0, 0.7, a.nz * 0.7, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    else cloth.quad([a.x - a.nx * d / 2, a.y + 0.6, a.z + hw], [a.x - a.nx * d / 2, a.y + 0.6, a.z - hw], [a.x + a.nx * d / 2, a.y, a.z - hw], [a.x + a.nx * d / 2, a.y, a.z + hw], a.nx * 0.7, 0.7, 0, [[0, 0], [1, 0], [1, 1], [0, 1]]); }
  for (const c of C.canopies) { const k = new THREE.Color(c.col); cloth.col = [k.r, k.g, k.b]; cloth.box(c.x - c.w / 2, c.y, c.z - c.d / 2, c.x + c.w / 2, c.y + 0.25, c.z + c.d / 2); if (c.lit) { glowB.col = [1, 1, 0.95]; } }
  add(cloth.mesh(std({ side: THREE.DoubleSide, roughness: 0.9 })));
  const canLights = new Batch(1); for (const c of C.canopies) if (c.lit) { canLights.col = [1, 1, 0.92]; for (let k = -1; k <= 1; k++) canLights.flat(c.x - c.w / 2 + 1, c.z + k * 2.5 - 0.3, c.x + c.w / 2 - 1, c.z + k * 2.5 + 0.3, c.y - 0.01, true); }
  add(canLights.mesh(new THREE.MeshBasicMaterial({ vertexColors: true })));
  // fountains
  for (const f of C.fountains) {
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(f.r, f.r + 0.2, 0.8, 32, 1, true), std({ map: T('concrete'), side: THREE.DoubleSide })); rim.position.set(f.x, 0.4, f.z); scene.add(rim);
    const water = new THREE.Mesh(new THREE.CircleGeometry(f.r - 0.05, 32), new THREE.MeshStandardMaterial({ color: 0x1a3a5a, roughness: 0.1, metalness: 0.4, emissive: 0x0a2a4a, emissiveIntensity: 0.6 })); water.rotation.x = -Math.PI / 2; water.position.set(f.x, 0.6, f.z); scene.add(water);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.5, 2.6, 12), std({ map: T('concrete') })); spire.position.set(f.x, 1.3, f.z); scene.add(spire);
  }

  // ---------- instanced things: cars, lamps, trees, rocks ----------
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e3 = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  const inst = (geo, mat, list, place, color) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((o, i) => { place(o, m4); im.setMatrixAt(i, m4); if (color) im.setColorAt(i, color(o)); });
    im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); scene.add(im); return im;
  };
  const at = (x, y, z, ry = 0, s = 1, sy = s) => m4.compose(v3.set(x, y, z), q4.setFromEuler(e3.set(0, ry, 0)), s3.set(s, sy, s));
  // cars: body, cabin and glass, wheels, lights
  const carBody = new THREE.BoxGeometry(1.85, 0.72, 4.4); carBody.translate(0, 0.62, 0);
  const cab = new THREE.BoxGeometry(1.62, 0.6, 2.2); cab.translate(0, 1.27, -0.25);
  const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14); wheel.rotateZ(Math.PI / 2);
  const wheels = []; for (const [x, z] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) { const w = wheel.clone(); w.translate(x, 0.36, z); wheels.push(w); }
  inst(carBody, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.6 }), C.cars, c => at(c.x, terrainH(M, c.x, c.z), c.z, c.rot), c => new THREE.Color(c.col));
  inst(cab, new THREE.MeshStandardMaterial({ color: 0x10141a, roughness: 0.1, metalness: 0.8 }), C.cars, c => at(c.x, terrainH(M, c.x, c.z), c.z, c.rot));
  inst(mergeSimple(wheels), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }), C.cars, c => at(c.x, terrainH(M, c.x, c.z), c.z, c.rot));
  { const lights = []; for (const x of [-0.65, 0.65]) { const h = new THREE.BoxGeometry(0.34, 0.14, 0.05); h.translate(x, 0.75, 2.21); lights.push(h); const t = new THREE.BoxGeometry(0.34, 0.12, 0.05); t.translate(x, 0.78, -2.21); lights.push(t); }
    const g = mergeSimple(lights), cnt = g.attributes.position.count, col = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) { const back = g.attributes.position.getZ(i) < 0; col.set(back ? [1, 0.12, 0.08] : [1, 0.95, 0.8], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    inst(g, new THREE.MeshBasicMaterial({ vertexColors: true }), C.cars, c => at(c.x, terrainH(M, c.x, c.z), c.z, c.rot)); }
  // street lamps: pole, arm and head; a glowing bulb; a pool of light on the ground
  { const pole = new THREE.CylinderGeometry(0.08, 0.11, 5.4, 8); pole.translate(0, 2.7, 0); const arm = new THREE.BoxGeometry(0.08, 0.08, 1.3); arm.translate(0, 5.3, 0.6); const head = new THREE.BoxGeometry(0.42, 0.18, 0.6); head.translate(0, 5.25, 1.15);
    inst(mergeSimple([pole, arm, head]), new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.5, metalness: 0.7 }), C.lamps, l => at(l.x, 0, l.z, l.rot));
    const bulb = new THREE.BoxGeometry(0.34, 0.06, 0.5); bulb.translate(0, 5.14, 1.15);
    inst(bulb, new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false }), C.lamps, l => at(l.x, 0, l.z, l.rot));
    const pool = new THREE.PlaneGeometry(11, 11); pool.rotateX(-Math.PI / 2); pool.translate(0, 0.06, 1.1);
    const pm = new THREE.MeshBasicMaterial({ map: T('pool'), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, ...polyOff });
    const im = inst(pool, pm, C.lamps, l => at(l.x, 0, l.z, l.rot)); if (im) { im.castShadow = false; im.receiveShadow = false; }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: T('glow'), color: 0xffd8a0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    // (halos are sprites: only near lamps get one, picked each frame with the real lights)
    W.halos = []; for (let i = 0; i < 24; i++) { const h = halo.clone(); h.material = halo.material; h.scale.setScalar(2.4); h.visible = false; scene.add(h); W.halos.push(h); }
  }
  // trees: round ones in town, pines in the hills
  { const trunk = new THREE.CylinderGeometry(0.16, 0.26, 1, 7); trunk.translate(0, 0.5, 0);
    const trunkMat = texMat('bark', 1, { color: 0x6a5a48 });
    const all = [...C.trees.map(t => ({ ...t, kind: 'r' })), ...C.pines.map(t => ({ ...t, kind: 'p' }))];
    inst(trunk, trunkMat, all, t => at(t.x, terrainH(M, t.x, t.z), t.z, 0, t.s, t.kind === 'r' ? t.h * 0.45 : t.h * 0.35));
    const blobs = []; for (const [x, y, z, r] of [[0, 0, 0, 1.6], [0.9, 0.5, 0.3, 1.2], [-0.8, 0.4, -0.4, 1.25], [0.1, 1.2, -0.2, 1.1]]) { const g = new THREE.IcosahedronGeometry(r, 1); g.translate(x, y, z); blobs.push(g); }
    const crown = mergeSimple(blobs); crown.translate(0, 0, 0);
    const leaf = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    inst(crown, leaf, C.trees, t => at(t.x, terrainH(M, t.x, t.z) + t.h * 0.55, t.z, t.x, t.s * t.h / 8), t => new THREE.Color().setHSL(0.24 + Math.sin(t.x) * 0.04, 0.35, 0.2 + Math.cos(t.z) * 0.04));
    const cones = []; for (let k = 0; k < 4; k++) { const g = new THREE.ConeGeometry(1.9 - k * 0.38, 2.6, 8); g.translate(0, 2.2 + k * 1.5, 0); cones.push(g); }
    inst(mergeSimple(cones), leaf, C.pines, t => at(t.x, terrainH(M, t.x, t.z), t.z, t.x, t.s, t.h / 9), t => new THREE.Color().setHSL(0.33, 0.3, 0.13 + Math.sin(t.x * 3) * 0.03));
    inst(new THREE.IcosahedronGeometry(1, 0), texMat('rock', 1, { color: 0x8a8a84, flatShading: true }), C.rocks, r => at(r.x, terrainH(M, r.x, r.z) + r.r * 0.3, r.z, r.x, r.r, r.r * 0.8));
  }
  return W;
}

function mergeSimple(list) {
  // merge non-indexed-compatible geometries (positions, normals, uvs)
  const geos = list.map(g => g.index ? g.toNonIndexed() : g);
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const parts = geos.map(g => g.attributes[name]).filter(Boolean); if (parts.length !== geos.length) continue;
    const size = parts[0].itemSize, n = parts.reduce((a, p) => a + p.count, 0), arr = new Float32Array(n * size);
    let o = 0; for (const p of parts) { arr.set(p.array, o); o += p.array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

// each frame: the few real lights jump to the lamps nearest to you
export function updateCityWorld(W, follow, t, dt) {
  const D = W.dyn; if (!D || !follow) return;
  D.t -= dt;
  if (D.t > 0) return;
  D.t = 0.25;
  const fx = follow.x, fz = follow.z;
  const near = D.cands.map(c => ({ c, d: (c.x - fx) ** 2 + (c.z - fz) ** 2 })).filter(o => o.d < 70 * 70).sort((a, b) => a.d - b.d);
  D.lights.forEach((L, i) => { const o = near[i]; if (!o) { L.intensity = 0; return; } L.position.set(o.c.x, o.c.y, o.c.z); L.color.setHex(o.c.col); L.intensity = o.c.i; L.distance = o.c.d; });
  // glowing halos around the nearest street lamps
  const lampsNear = near.filter(o => o.c.y > 4).slice(0, W.halos.length);
  W.halos.forEach((h, i) => { const o = lampsNear[i]; h.visible = !!o; if (o) h.position.set(o.c.x, o.c.y - 0.15, o.c.z); });
}
