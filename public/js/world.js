// Builds the 3D scene for a generated map.
import * as THREE from 'three';
import { HALF } from './config.js';
import { rng, barBox } from './map.js';
import { tex } from './textures.js';
import { setDetail, mat, boxGeo, mergeGeos, treeGeos, pineGeo, bushGeo, rockGeo, makeGenerator, makeCage, makeBarricade, makeGate, makeSwitch } from './models.js';

export const QUALITY = {
  // potato: for very weak laptops / integrated graphics. No shadows, no post-processing, cheap materials.
  potato: { shadow: 0, grass: 0, pixel: 0.6, bloom: false, post: false, outer: 50, fog: 0, density: 0.05, far: 80, minPixel: 0.45 },
  low: { shadow: 0, grass: 1200, pixel: 0.8, bloom: false, post: false, outer: 110, fog: 6, density: 0.04, far: 120, minPixel: 0.5 },
  medium: { shadow: 1024, grass: 4500, pixel: 1, bloom: true, post: true, outer: 260, fog: 22, density: 0.032, far: 300, minPixel: 0.6 },
  high: { shadow: 2048, grass: 10000, pixel: Math.min(2, window.devicePixelRatio || 1), bloom: true, post: true, outer: 440, fog: 36, density: 0.03, far: 600, minPixel: 0.7 },
};

const FOG_COLOR = 0x1b2126;

// distance from point to segment
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildWorld(M, quality = 'medium') {
  const q = QUALITY[quality] || QUALITY.medium;
  setDetail(quality);
  const lite = quality === 'potato' || quality === 'low';
  const R = rng(M.seed * 7 + 3);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.FogExp2(FOG_COLOR, q.density);
  const W = { scene, gens: [], cages: [], bars: [], gates: [], switches: [], genLights: [], gateLights: [], fogSprites: [], lamps: [], fogLayers: [] };

  // ---------- lights: cold moon, warm earth bounce ----------
  const hemi = new THREE.HemisphereLight(0x5e6878, 0x30261a, 1.75);
  scene.add(hemi); W.hemi = hemi;
  W.amb = new THREE.AmbientLight(0x2e3440, 0.9); scene.add(W.amb);
  const moon = new THREE.DirectionalLight(0xcad6f2, 2.7);
  const fill = new THREE.PointLight(0xa8b4d0, 1.8, 13, 1.2);
  scene.add(fill); W.fill = fill;
  moon.position.set(30, 60, 20);
  if (q.shadow) {
    moon.castShadow = true;
    moon.shadow.mapSize.set(q.shadow, q.shadow);
    const s = moon.shadow.camera; s.left = -38; s.right = 38; s.top = 38; s.bottom = -38; s.near = 5; s.far = 160;
    moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.04;
  }
  scene.add(moon); scene.add(moon.target);
  W.moon = moon;

  // ---------- sky: gradient, stars, moon with halo, drifting clouds ----------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x04060b) }, mid: { value: new THREE.Color(0x0e1520) }, bot: { value: new THREE.Color(FOG_COLOR) }, mdir: { value: new THREE.Vector3(30, 60, 20).normalize() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 mdir; varying vec3 vP;
      void main(){ vec3 d = normalize(vP); float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(bot, mid, smoothstep(0.0, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));
        float m = max(dot(d, mdir), 0.0); c += vec3(0.32, 0.38, 0.5) * pow(m, 18.0) * 0.6 + vec3(0.12, 0.15, 0.22) * pow(m, 4.0) * 0.4;
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.renderOrder = -10;
  scene.add(sky); W.sky = sky;
  const starsGeo = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < 1600; i++) { const a = R() * 6.283, e = 0.2 + R() * 1.3, r = 420; sp.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r); }
  starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sky.add(new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0xc0cce8, size: 1.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.75 })));
  const moonDir = new THREE.Vector3(30, 60, 20).normalize();
  const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(8, 32), new THREE.MeshBasicMaterial({ color: 0xf2f4ff, fog: false }));
  moonDisc.position.copy(moonDir).multiplyScalar(396); moonDisc.lookAt(0, 0, 0); sky.add(moonDisc);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow').map, color: 0x9fb0d8, fog: false, depthWrite: false, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(110); halo.position.copy(moonDir).multiplyScalar(395); sky.add(halo);
  if (quality !== 'potato') {
    const ct = tex('clouds').map; ct.repeat.set(2, 2);
    const clouds = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshBasicMaterial({ map: ct, transparent: true, opacity: 0.55, depthWrite: false, fog: false, color: 0x6a7890 }));
    clouds.rotation.x = Math.PI / 2; clouds.position.y = 140; clouds.renderOrder = -9; sky.add(clouds); W.clouds = ct;
  }

  // ---------- ground: worn dirt paths, mud around structures, moss and needle litter ----------
  const paths = [];
  const nodes = [...M.gens.map(g => [g.x, g.z]), ...M.gates.map(g => [g.sx, g.sz]), [M.spawns.killer.x, M.spawns.killer.z], [M.spawns.survivors[0].x, M.spawns.survivors[0].z]];
  // connect nodes with a minimum spanning tree so the trails look like they were walked
  const inT = [0], left = nodes.map((_, i) => i).slice(1);
  while (left.length) {
    let best = null;
    for (const i of inT) for (const j of left) { const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]); if (!best || d < best.d) best = { i, j, d }; }
    // slightly wiggly trail
    const [ax, az] = nodes[best.i], [bx, bz] = nodes[best.j];
    const mx = (ax + bx) / 2 + (R() - 0.5) * best.d * 0.25, mz = (az + bz) / 2 + (R() - 0.5) * best.d * 0.25;
    paths.push([ax, az, mx, mz], [mx, mz, bx, bz]);
    inT.push(best.j); left.splice(left.indexOf(best.j), 1);
  }
  const seg = lite ? 110 : 170;
  const gGeo = new THREE.PlaneGeometry(300, 300, seg, seg); gGeo.rotateX(-Math.PI / 2);
  const gp = gGeo.attributes.position, gcol = new Float32Array(gp.count * 3);
  const cGrass = new THREE.Color(0x3d4a2c), cGrass2 = new THREE.Color(0x56603a), cDirt = new THREE.Color(0x5a4632), cMud = new THREE.Color(0x3a2c20), cLitter = new THREE.Color(0x4a3a26), cForest = new THREE.Color(0x2c2a1e), tmp = new THREE.Color();
  const noise = (x, z) => Math.sin(x * 0.13 + Math.sin(z * 0.07) * 2) * 0.5 + Math.sin(z * 0.11 + x * 0.05) * 0.3 + Math.sin(x * 0.37 - z * 0.29) * 0.2;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    const nz = noise(x, z);
    tmp.copy(cGrass).lerp(cGrass2, sstep(-0.4, 0.8, nz));
    let pd = 99; for (const [ax, az, bx, bz] of paths) pd = Math.min(pd, segDist(x, z, ax, az, bx, bz));
    const pathW = 1.1 + (Math.sin(x * 0.3 + z * 0.2) * 0.35);
    tmp.lerp(cDirt, 1 - sstep(pathW * 0.6, pathW * 1.6, pd));
    for (const g of M.gens) { const d = Math.hypot(x - g.x, z - g.z); if (d < 4) tmp.lerp(cMud, (1 - sstep(1.2, 4, d)) * 0.9); }
    for (const t of M.trees) { const d = Math.hypot(x - t.x, z - t.z); if (d < 3) tmp.lerp(cLitter, (1 - sstep(0.6, 3, d)) * 0.7); }
    if (Math.abs(x) > HALF + 1 || Math.abs(z) > HALF + 1) tmp.lerp(cForest, sstep(HALF + 1, HALF + 8, Math.max(Math.abs(x), Math.abs(z))) * 0.8);
    const v = 0.88 + (Math.sin(x * 1.7) * Math.cos(z * 1.3)) * 0.06;
    gcol[i * 3] = tmp.r * v; gcol[i * 3 + 1] = tmp.g * v; gcol[i * 3 + 2] = tmp.b * v;
  }
  gGeo.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
  const gt = tex('ground2');
  const groundMat = lite ? new THREE.MeshLambertMaterial({ map: gt.map, vertexColors: true })
    : new THREE.MeshLambertMaterial({ map: gt.map, normalMap: gt.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), vertexColors: true });
  const ground = new THREE.Mesh(gGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);
  W.paths = paths;

  // ---------- static boxes: merged per material, weathered with moss & grime at the base ----------
  const groups = {};
  const styleMat = {
    brick: () => mat(0xc0aca4, { map: 'brick', rough: 0.95 }), wood: () => mat(0xb09a80, { map: 'wood', rough: 0.95 }),
    stone: () => mat(0xb4b0a6, { map: 'stone', rough: 0.95 }), metal: () => mat(0x8a8a88, { map: 'metal', metal: 0.4, rough: 0.6 }),
    hay: () => mat(0xc0a060, { map: 'hay', rough: 1 }), dark: () => mat(0x7a6a5a, { map: 'wood', rough: 1 }),
  };
  const addBox = (key, b, y0, y1, hx = b.hx, hz = b.hz, tile = 2) => {
    const h = y1 - y0;
    if (h <= 0.01) return;
    (groups[key] ||= []).push({ geo: boxGeo(hx * 2, h, hz * 2, tile), matrix: new THREE.Matrix4().makeTranslation(b.x, y0 + h / 2, b.z) });
  };
  const tileOf = st => st === 'stone' ? 1.15 : st === 'brick' ? 1.6 : 2;
  for (const b of M.boxes) {
    if (b.kind === 'gen' || b.kind === 'switch') continue;
    if (b.kind === 'log') {
      const along = b.hx > b.hz;
      const geo = new THREE.CylinderGeometry(0.45, 0.5, (along ? b.hx : b.hz) * 2, 10);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(b.x, 0.45, b.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(along ? 0 : Math.PI / 2, 0, along ? Math.PI / 2 : 0)), new THREE.Vector3(1, 1, 1));
      (groups.bark ||= []).push({ geo, matrix: m });
      continue;
    }
    const key = b.kind === 'crate' ? 'wood' : b.kind === 'hay' ? 'hay' : b.kind === 'sill' ? b.style : b.style || 'stone';
    if (b.kind === 'sill') { addBox(key, b, 0, b.h, b.hx, b.hz, tileOf(key)); addBox('dark', { x: b.x, z: b.z }, b.h, b.h + 0.07, b.hx + 0.05, b.hz + 0.05); continue; }
    addBox(key, b, 0, b.h, b.hx, b.hz, b.kind === 'boundary' ? 2.4 : tileOf(key));
    if (b.kind === 'boundary') { addBox('stone', { x: b.x, z: b.z }, b.h, b.h + 0.25, b.hx + 0.12, b.hz + 0.12); continue; }
    if (b.kind === 'wall') {
      // ruined, uneven top edge
      const long = Math.max(b.hx, b.hz), ax = b.hx > b.hz;
      const n = Math.floor(long * 1.2);
      for (let i = 0; i < n; i++) {
        if (R() < 0.45) continue;
        const off = (R() - 0.5) * 2 * (long - 0.3), w = 0.25 + R() * 0.5, hh = 0.12 + R() * 0.45;
        addBox(key, { x: b.x + (ax ? off : 0), z: b.z + (ax ? 0 : off) }, b.h, b.h + hh, ax ? w / 2 : b.hx, ax ? b.hz : w / 2, tileOf(key));
      }
      // stone footing along the base
      addBox('stone', { x: b.x, z: b.z }, 0, 0.22, b.hx + 0.05, b.hz + 0.05, 1.15);
    }
  }
  for (const v of M.visual) if (v.type === 'lintel') addBox(v.style, { x: v.x, z: v.z }, v.y0, v.y1, v.hx, v.hz, tileOf(v.style));
  const moss = new THREE.Color(0x3e4a2a), grime = new THREE.Color(0x4a4034);
  for (const key in groups) {
    const material = key === 'bark' ? mat(0x6a5a4a, { map: 'bark' }) : (styleMat[key] || styleMat.stone)();
    const geo = mergeGeos(groups[key]);
    if (key !== 'hay' && key !== 'bark') {
      // vertex colors: moss & grime creeping up from the ground, streaks of damp
      const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const streak = 0.5 + 0.5 * Math.sin(x * 2.3 + z * 1.7) * Math.sin(x * 0.7 - z * 1.1);
        c.setRGB(1, 1, 1).lerp(key === 'stone' || key === 'brick' ? moss : grime, (1 - sstep(0, 1.3 + streak * 0.8, y)) * 0.75);
        const d = 0.85 + streak * 0.15;
        col[i * 3] = c.r * d; col[i * 3 + 1] = c.g * d; col[i * 3 + 2] = c.b * d;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      material.vertexColors = true; material.needsUpdate = true;
    }
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---------- trees (instanced): natural pines + twisted dead trees ----------
  const barkM = mat(0x4e4034, { map: 'bark', rough: 1 });
  const ft = tex('foliage');
  const needleM = lite ? new THREE.MeshLambertMaterial({ vertexColors: true, map: ft.map }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: ft.map, normalMap: ft.normalMap });
  const trees = [...M.trees.map(t => ({ ...t, inner: true }))];
  for (let i = 0; i < q.outer; i++) {
    const side = R.int(0, 3), along = R.range(-HALF - 30, HALF + 30), out = HALF + 2.5 + Math.pow(R(), 0.7) * 32;
    const x = side === 0 ? along : side === 1 ? along : side === 2 ? out : -out;
    const z = side === 0 ? out : side === 1 ? -out : along;
    if (M.gates.some(g => Math.abs(x - g.x) < 7 && Math.sign(z) === g.dir && Math.abs(z) < HALF + 14)) continue;
    trees.push({ x, z, s: R.range(0.8, 1.4), h: R.range(8, 14), rot: R.range(0, 6.28), r: 0.4 });
  }
  const inst = (geo, material, list, scaleFn, shadow = true) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, material, list.length);
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler();
    list.forEach((t, i) => { const s = scaleFn(t); e.set((R() - 0.5) * 0.08, t.rot, (R() - 0.5) * 0.08); qq.setFromEuler(e); m.compose(new THREE.Vector3(t.x, t.y || 0, t.z), qq, s); im.setMatrixAt(i, m); });
    im.castShadow = shadow; im.receiveShadow = true;
    scene.add(im);
    return im;
  };
  const deadTree = treeGeos('dead');
  const pines = [[], [], []], deads = [];
  trees.forEach((t, i) => { const h = (((i * 7 + Math.floor(t.x * 13 + t.z * 7)) % 10) + 10) % 10; if (h < 7) pines[h % 3].push(t); else deads.push(t); });
  const pineScale = t => { const k = t.h / 10.5; const w = Math.max(k, t.r / 0.3) * (0.9 + (t.s - 1) * 0.3); return new THREE.Vector3(w, k * 1.05, w); };
  pines.forEach((list, v) => { const g = pineGeo(v + 3); inst(g.trunk, barkM, list, pineScale); inst(g.leaves, needleM, list, pineScale); });
  inst(deadTree.trunk, barkM, deads, t => { const k = t.h / 8; const w = Math.max(k * 0.9, t.r / 0.32); return new THREE.Vector3(w, k, w); });

  // ---------- rocks, pebbles, bushes, fallen logs ----------
  const rockM = mat(0x8a8680, { map: 'rock', rough: 0.95 });
  for (let v = 0; v < 3; v++) {
    const list = M.rocks.filter((_, i) => i % 3 === v);
    inst(rockGeo(v + 1), rockM, list, t => new THREE.Vector3(t.r * 1.15, Math.max(0.5, t.h * 0.75), t.r * 1.15));
  }
  const blocked = (x, z, pad) => {
    for (const b of M.boxes) if (Math.abs(x - b.x) < b.hx + pad && Math.abs(z - b.z) < b.hz + pad) return true;
    for (const c of M.circles) if (c.kind !== 'tree' && Math.hypot(x - c.x, z - c.z) < c.r + pad) return true;
    return false;
  };
  const scatter = (n, pad, inside = true) => {
    const out = [];
    for (let i = 0; i < n * 4 && out.length < n; i++) {
      const x = inside ? R.range(-HALF + 1, HALF - 1) : R.range(-HALF - 20, HALF + 20), z = inside ? R.range(-HALF + 1, HALF - 1) : R.range(-HALF - 20, HALF + 20);
      if (inside && blocked(x, z, pad)) continue;
      if (!inside && Math.abs(x) < HALF + 1 && Math.abs(z) < HALF + 1) continue;
      let pd = 99; for (const [ax, az, bx, bz] of paths) pd = Math.min(pd, segDist(x, z, ax, az, bx, bz));
      if (pd < 1.6) continue;
      out.push({ x, z, rot: R() * 6.28, s: R.range(0.6, 1.4) });
    }
    return out;
  };
  const nBush = quality === 'potato' ? 0 : quality === 'low' ? 60 : quality === 'medium' ? 160 : 260;
  if (nBush) {
    const bushM = lite ? new THREE.MeshLambertMaterial({ color: 0x2a3420, map: ft.map }) : new THREE.MeshStandardMaterial({ color: 0x2a3420, map: ft.map, roughness: 1 });
    const deadBushM = mat(0x4a3a2a, { map: 'foliage', rough: 1 });
    const list = scatter(nBush, 0.9), outer = scatter(Math.floor(nBush * 0.6), 0, false);
    inst(bushGeo(1), bushM, list.filter((_, i) => i % 3 !== 0), t => new THREE.Vector3(t.s, t.s * 0.8, t.s), false);
    inst(bushGeo(2), deadBushM, list.filter((_, i) => i % 3 === 0), t => new THREE.Vector3(t.s * 0.8, t.s * 0.6, t.s * 0.8), false);
    inst(bushGeo(3), bushM, outer, t => new THREE.Vector3(t.s * 1.4, t.s * 1.1, t.s * 1.4), false);
    const pebbles = scatter(nBush * 2, 0.3).map(t => ({ ...t, s: R.range(0.08, 0.22) }));
    inst(rockGeo(5), rockM, pebbles, t => new THREE.Vector3(t.s, t.s * 0.7, t.s), false);
    const logs = scatter(Math.floor(nBush / 20), 2).map(t => ({ ...t, y: 0.18 }));
    const logGeo = new THREE.CylinderGeometry(0.2, 0.26, 3.2, 9); logGeo.rotateZ(Math.PI / 2);
    inst(logGeo, mat(0x4a3a2c, { map: 'bark' }), logs, t => new THREE.Vector3(t.s, 1, 1));
  }

  // ---------- grass ----------
  if (q.grass) {
    const gq = [];
    const plane = new THREE.PlaneGeometry(0.7, 0.5); plane.translate(0, 0.25, 0);
    gq.push({ geo: plane, matrix: new THREE.Matrix4() }, { geo: plane, matrix: new THREE.Matrix4().makeRotationY(Math.PI / 2) });
    const ggeo = mergeGeos(gq);
    const gm = new THREE.MeshLambertMaterial({ map: tex('grass').map, alphaTest: 0.45, side: THREE.DoubleSide, color: 0x9aa070 });
    const list = [];
    for (let i = 0; i < q.grass * 3 && list.length < q.grass; i++) {
      const x = R.range(-HALF - 8, HALF + 8), z = R.range(-HALF - 8, HALF + 8);
      let bad = false;
      for (const b of M.boxes) if (Math.abs(x - b.x) < b.hx + 0.2 && Math.abs(z - b.z) < b.hz + 0.2) { bad = true; break; }
      if (bad) continue;
      let pd = 99; for (const [ax, az, bx, bz] of paths) pd = Math.min(pd, segDist(x, z, ax, az, bx, bz));
      if (pd < 1.3 && R() < 0.85) continue;
      list.push({ x, z, rot: R() * 6.28, s: R.range(0.7, 1.6) });
    }
    const im = new THREE.InstancedMesh(ggeo, gm, list.length);
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler();
    list.forEach((t, i) => { e.set(0, t.rot, 0); qq.setFromEuler(e); m.compose(new THREE.Vector3(t.x, 0, t.z), qq, new THREE.Vector3(t.s, t.s * R.range(0.7, 1.4), t.s)); im.setMatrixAt(i, m); im.setColorAt(i, new THREE.Color().setHSL(0.17 + R() * 0.08, 0.32, 0.36 + R() * 0.24)); });
    im.receiveShadow = true;
    scene.add(im);
  }

  // ---------- lamp posts with pools of warm light ----------
  const lampSpots = [];
  for (const g of M.gens) for (let k = 0; k < 6 && lampSpots.length < M.gens.length * 2; k++) {
    const a = R() * 6.28, r = 3.2 + R() * 2;
    const x = g.x + Math.cos(a) * r, z = g.z + Math.sin(a) * r;
    if (!blocked(x, z, 0.6) && !M.circles.some(c => Math.hypot(x - c.x, z - c.z) < c.r + 0.6)) { lampSpots.push({ x, z }); break; }
  }
  for (const gt2 of M.gates) lampSpots.push({ x: gt2.sx - 2.2, z: gt2.sz - gt2.dir * 1.5 });
  const postM = mat(0x2a2622, { map: 'metal', metal: 0.5, rough: 0.6 });
  const poolTex = tex('glow').map;
  for (const L of lampSpots) {
    const g = new THREE.Group(); g.position.set(L.x, 0, L.z); g.rotation.y = R() * 6.28;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.4, 8), postM); post.position.y = 1.7; post.castShadow = true; g.add(post);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.06), postM); arm.position.set(0.32, 3.3, 0); g.add(arm);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 8, 1, true), postM); head.position.set(0.62, 3.22, 0); g.add(head);
    const bulbM = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: 0xffc070, emissiveIntensity: 3 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), bulbM); bulb.position.set(0.62, 3.13, 0); g.add(bulb);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(4.2, 24), new THREE.MeshBasicMaterial({ map: poolTex, color: 0xff9440, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(0.62, 0.04, 0); g.add(pool);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: poolTex, color: 0xffc070, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(1.1); glow.position.set(0.62, 3.1, 0); g.add(glow);
    let light = null;
    if (quality === 'high' && W.lamps.length < 8) { light = new THREE.PointLight(0xffb060, 7, 11, 1.6); light.position.set(0.62, 3.0, 0); g.add(light); }
    scene.add(g);
    W.lamps.push({ bulbM, pool, glow, light, ph: R() * 10 });
  }

  // ---------- generators ----------
  for (const g of M.gens) {
    const o = makeGenerator();
    o.position.set(g.x, 0, g.z); o.rotation.y = g.rot;
    scene.add(o);
    const light = new THREE.PointLight(0xffb060, 0, 16, 1.6);
    light.position.set(g.x, 2.1, g.z);
    scene.add(light);
    W.gens.push(o); W.genLights.push(light);
  }
  // ---------- cages ----------
  for (const c of M.cages) { const o = makeCage(); o.position.set(c.x, 0, c.z); scene.add(o); W.cages.push(o); }
  // ---------- barricades ----------
  for (const b of M.bars) {
    const o = makeBarricade(b.half);
    const lat = b.lean;
    if (b.axis === 'z') { o.position.set(b.x - lat * (b.half + 0.05), 0, b.z); o.rotation.y = lat > 0 ? 0 : Math.PI; }
    else { o.position.set(b.x, 0, b.z - lat * (b.half + 0.05)); o.rotation.y = lat > 0 ? -Math.PI / 2 : Math.PI / 2; }
    o.userData.state = 0; o.userData.f = 1;
    scene.add(o); W.bars.push(o);
  }
  // ---------- gates ----------
  for (const g of M.gates) {
    const o = makeGate(); o.position.set(g.x, 0, g.z); scene.add(o); W.gates.push(o);
    const s = makeSwitch(); s.position.set(g.sx, 0, g.sz); s.rotation.y = g.dir > 0 ? Math.PI : 0; scene.add(s); W.switches.push(s);
    const l = new THREE.PointLight(0xff3020, 0, 22, 1.4); l.position.set(g.x, 4.5, g.z - g.dir * 1.5); scene.add(l); W.gateLights.push(l);
    // exit corridor glow
    const exitL = new THREE.PointLight(0xdfe8ff, 0, 18, 1.2); exitL.position.set(g.x, 3, g.z + g.dir * 7); scene.add(exitL); W.gateLights.push(exitL);
  }
  // ---------- rolling ground fog: layered planes with scrolling noise ----------
  const nf = quality === 'potato' ? 0 : quality === 'low' ? 1 : 2;
  for (let i = 0; i < nf; i++) {
    const t = tex('fogtile').map.clone(); t.needsUpdate = true; t.repeat.set(5 + i, 5 + i);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshBasicMaterial({ map: t, color: 0x6a7480, transparent: true, opacity: 0.05 - i * 0.015, depthWrite: false }));
    plane.rotation.x = -Math.PI / 2; plane.position.y = 0.3 + i * 0.5; plane.renderOrder = 2;
    scene.add(plane); W.fogLayers.push({ t, v: 0.004 + i * 0.002, d: i % 2 ? 1 : -1 });
  }
  return W;
}

// per-frame updates for props, driven by state
export function updateWorld(W, M, S, t, dt, follow) {
  if (follow) {
    W.fill.position.set(follow.x, 3.2, follow.z);
    W.moon.target.position.set(follow.x, 0, follow.z);
    W.moon.position.set(follow.x + 30, 60, follow.z + 20);
    W.sky.position.set(follow.x, 0, follow.z);
  }
  for (const f of W.fogLayers) { f.t.offset.x += f.v * dt * f.d; f.t.offset.y += f.v * 0.6 * dt; }
  if (W.clouds) W.clouds.offset.x += dt * 0.0015;
  const dk = W.darkK || 0;
  for (const L of W.lamps) {
    const fl = (Math.sin(t * 13 + L.ph) > 0.97 ? 0.3 : 1) * (1 - dk);
    L.bulbM.emissiveIntensity = 3 * fl; L.pool.material.opacity = 0.13 * fl; L.glow.material.opacity = 0.55 * fl;
    if (L.light) L.light.intensity = 7 * fl;
  }
  if (!S) return;
  for (let i = 0; i < M.gens.length; i++) {
    const o = W.gens[i].userData, gs = S.gens[i];
    const running = gs.n > 0 || gs.done;
    o.pistons.forEach((p, k) => { p.position.y = 1.02 + (running ? Math.sin(t * (gs.done ? 18 : 11) + k * 1.6) * 0.05 : 0); });
    const lit = gs.done ? 3 : Math.floor(gs.p * 3 + 0.0001);
    o.bulbs.forEach((b, k) => { b.material.emissiveIntensity = (k < lit ? (gs.done ? 3.5 : 1.6 + Math.sin(t * 30 + k) * 0.6) : 0) * (1 - (W.darkK || 0) * 0.95); });
    const L = W.genLights[i];
    const dk = W.darkK || 0;
    const target = (gs.done ? 9 : gs.n > 0 ? 0.6 + Math.random() * 0.8 * gs.p : 0) * (1 - dk * 0.95);
    L.intensity += (target - L.intensity) * Math.min(1, dt * 6);
    W.gens[i].position.x = M.gens[i].x + (gs.n > 0 ? (Math.random() - 0.5) * 0.008 : 0);
  }
  for (let i = 0; i < M.cages.length; i++) {
    const u = W.cages[i].userData, who = S.cages[i];
    u.ring.material.emissiveIntensity = who != null ? 2 + Math.sin(t * 4) * 1 : 0;
    if (S.cageBroken[i] && !u.broken) { u.broken = true; W.cages[i].rotation.z = 0.12; W.cages[i].rotation.x = -0.08; W.cages[i].position.y = -0.25; }
  }
  for (let i = 0; i < M.bars.length; i++) {
    const o = W.bars[i], st = S.bars[i];
    if (st === 2) { o.visible = false; continue; }
    o.visible = true;
    const target = st === 1 ? 0 : 1;
    o.userData.f += (target - o.userData.f) * Math.min(1, dt * (st === 1 ? 14 : 4));
    const f = o.userData.f;
    o.rotation.z = f * (Math.PI / 2 - 0.12);
    o.userData.lean.rotation.x = st === 1 ? 0.32 * (1 - f) : 0.1;
  }
  for (let i = 0; i < M.gates.length; i++) {
    const gs = S.gates[i], u = W.gates[i].userData, su = W.switches[i].userData;
    const openF = gs.open ? 1 : 0;
    u.doors[0].position.x += (-openF * 2.2 - u.doors[0].position.x) * Math.min(1, dt * 1.2);
    u.doors[1].position.x += (openF * 2.2 - u.doors[1].position.x) * Math.min(1, dt * 1.2);
    const lit = gs.open ? 3 : Math.floor(gs.p * 3);
    u.lights.forEach((l, k) => { l.material.emissive.setHex(gs.open ? 0x30ff60 : 0xff2020); l.material.emissiveIntensity = S.gatesPowered ? (k < lit || gs.open ? 4 : 0.6) : 0; });
    su.lights.forEach((l, k) => { l.material.emissiveIntensity = S.gatesPowered && (k < lit) ? 4 : S.gatesPowered ? 0.4 : 0; });
    su.lever.rotation.z = -gs.p * 1.2;
    W.gateLights[i * 2].intensity = S.gatesPowered ? (gs.open ? 3 : 5) : 0;
    W.gateLights[i * 2].color.setHex(gs.open ? 0x50ff80 : 0xff3020);
    W.gateLights[i * 2 + 1].intensity = gs.open ? 14 : 0;
  }
}

export function pointBlocked(M, x, y, z) {
  if (y < 0.05) return true;
  const bucket = M.hash.get(Math.floor((x + HALF + 12) / 8) * 1000 + Math.floor((z + HALF + 12) / 8));
  if (!bucket) return false;
  for (const o of bucket) {
    if (o.r !== undefined) { if (o.kind !== 'cage' && y < o.h && Math.hypot(x - o.x, z - o.z) < o.r + 0.15) return true; }
    else if (y < o.h + 0.1 && Math.abs(x - o.x) < o.hx + 0.15 && Math.abs(z - o.z) < o.hz + 0.15) return true;
  }
  return false;
}
export { barBox };
