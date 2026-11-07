// Builds the 3D scene for a generated map.
import * as THREE from 'three';
import { HALF } from './config.js';
import { realistic } from './gfx.js';
import { cloneScene } from './sceneGlb.js';
import { rng, barBox, terrainH } from './map.js';
import { buildCityWorld, updateCityWorld } from './cityworld.js';
import { tex } from './textures.js';
import { photoGround } from './pbr.js';
import { buildMeatWorld, updateMeatLights } from './meatworld.js';
import { LOOK, cypressGeos, snowify, buildThemeExtras, updateThemeFx } from './themeworld.js';
import { setDetail, mat, boxGeo, mergeGeos, treeGeos, pineGeo, pineCards, bushGeo, rockGeo, makeGenerator, makeCage, poseHookLegs, makeBarricade, makeGate, makeSwitch } from './models.js';

export const QUALITY = {
  // potato: for very weak laptops / integrated graphics. No shadows, no post-processing, cheap materials.
  potato: { shadow: 0, grass: 0, pixel: 0.6, bloom: false, post: false, outer: 50, fog: 0, density: 0.05, far: 80, minPixel: 0.45 },
  low: { shadow: 0, grass: 1200, pixel: 0.8, bloom: false, post: false, outer: 110, fog: 6, density: 0.04, far: 120, minPixel: 0.5 },
  medium: { shadow: 1024, grass: 4500, pixel: 1, bloom: true, post: true, outer: 260, fog: 22, density: 0.032, far: 300, minPixel: 0.6 },
  high: { shadow: 2048, grass: 10000, pixel: Math.min(2, window.devicePixelRatio || 1), bloom: true, post: true, outer: 440, fog: 36, density: 0.03, far: 600, minPixel: 0.7 },
};


// distance from point to segment
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildWorld(M, quality = 'medium') {
  const HF = M.half || HALF;
  if (M.indoor) return buildMeatWorld(M, quality);
  if (M.city) return buildCityWorld(M, quality);
  const LK = M.br ? LOOK.isle : LOOK[M.map] || LOOK.woods, FOG_COLOR = LK.fog;
  const q = QUALITY[quality] || QUALITY.medium;
  setDetail(quality);
  const lite = quality === 'potato' || quality === 'low';
  const R = rng(M.seed * 7 + 3);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.FogExp2(FOG_COLOR, q.density * LK.density);
  const W = { look: LK, scene, gens: [], cages: [], bars: [], gates: [], switches: [], genLights: [], gateLights: [], fogSprites: [], lamps: [], fogLayers: [] };

  // ---------- lights: cold moon, warm earth bounce ----------
  const hemi = new THREE.HemisphereLight(LK.hemi[0], LK.hemi[1], LK.hemi[2]);
  scene.add(hemi); W.hemi = hemi;
  W.amb = new THREE.AmbientLight(LK.amb, 0.9); scene.add(W.amb);
  const moon = new THREE.DirectionalLight(LK.moon[0], LK.moon[1]);
  const fill = new THREE.PointLight(0xa8b4d0, 1.8, 13, 1.2);
  scene.add(fill); W.fill = fill;
  moon.position.set(30, 60, 20);
  if (q.shadow) {
    moon.castShadow = true;
    const sm = realistic() ? q.shadow * 2 : q.shadow; // crisper shadows in the realistic look
    moon.shadow.mapSize.set(sm, sm);
    const s = moon.shadow.camera; s.left = -38; s.right = 38; s.top = 38; s.bottom = -38; s.near = 5; s.far = 160;
    moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.04;
  }
  scene.add(moon); scene.add(moon.target);
  W.moon = moon;
  if (!lite && realistic()) {
    // realistic: real night contrast. Less flat fill, a stronger moon key, so walls and trees
    // model in light and shadow instead of glowing evenly
    hemi.intensity *= 0.75; W.amb.intensity *= 0.55; moon.intensity *= 1.45; fill.intensity *= 0.9;
  }

  // ---------- sky: gradient, stars, moon with halo, drifting clouds ----------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(LK.sky[0]) }, mid: { value: new THREE.Color(LK.sky[1]) }, bot: { value: new THREE.Color(FOG_COLOR) }, mdir: { value: new THREE.Vector3(30, 60, 20).normalize() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 mdir; varying vec3 vP;
      void main(){ vec3 d = normalize(vP); float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(bot, mid, smoothstep(0.0, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));
        float m = max(dot(d, mdir), 0.0); c += vec3(0.32, 0.38, 0.5) * pow(m, 18.0) * 0.6 + vec3(0.12, 0.15, 0.22) * pow(m, 4.0) * 0.4;
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.renderOrder = -10;
  // the dome (with its stars, moon and clouds) must sit inside the camera's far plane on every
  // quality, or the far plane cuts a hard arc out of the sky
  sky.scale.setScalar(Math.min(1, q.far * 0.9 / 480));
  scene.add(sky); W.sky = sky;
  const starsGeo = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < 1600; i++) { const a = R() * 6.283, e = 0.2 + R() * 1.3, r = 420; sp.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r); }
  starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  if (!LK.day) sky.add(new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0xc0cce8, size: 1.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.75 })));
  const moonDir = new THREE.Vector3(30, 60, 20).normalize();
  const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(8, 32), new THREE.MeshBasicMaterial({ color: LK.moonDisc, fog: false }));
  moonDisc.position.copy(moonDir).multiplyScalar(396); moonDisc.lookAt(0, 0, 0); sky.add(moonDisc);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow').map, color: LK.halo, fog: false, depthWrite: false, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(110); halo.position.copy(moonDir).multiplyScalar(395); sky.add(halo);
  if (quality !== 'potato') {
    const ct = tex('clouds').map; ct.repeat.set(2, 2);
    const cloudW = 900;
    // fade the cloud deck out toward its edges so its border never shows as a hard line in the sky
    const fc = document.createElement('canvas'); fc.width = fc.height = 128; const fx = fc.getContext('2d'), fg = fx.createRadialGradient(64, 64, 8, 64, 64, 64);
    fg.addColorStop(0, '#fff'); fg.addColorStop(0.55, '#ccc'); fg.addColorStop(1, '#000'); fx.fillStyle = fg; fx.fillRect(0, 0, 128, 128);
    const clouds = new THREE.Mesh(new THREE.PlaneGeometry(cloudW, cloudW), new THREE.MeshBasicMaterial({ map: ct, alphaMap: new THREE.CanvasTexture(fc), transparent: true, opacity: 0.55, depthWrite: false, fog: false, color: 0x6a7890 }));
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
  const gp = gGeo.attributes.position, gcol = new Float32Array(gp.count * 3), gpk = new Float32Array(gp.count);
  const [cGrass, cGrass2, cDirt, cMud, cLitter, cForest] = LK.ground.map(c => new THREE.Color(c)), tmp = new THREE.Color();
  const noise = (x, z) => Math.sin(x * 0.13 + Math.sin(z * 0.07) * 2) * 0.5 + Math.sin(z * 0.11 + x * 0.05) * 0.3 + Math.sin(x * 0.37 - z * 0.29) * 0.2;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    const nz = noise(x, z);
    tmp.copy(cGrass).lerp(cGrass2, sstep(-0.4, 0.8, nz));
    let pd = 99; for (const [ax, az, bx, bz] of paths) pd = Math.min(pd, segDist(x, z, ax, az, bx, bz));
    const pathW = 1.1 + (Math.sin(x * 0.3 + z * 0.2) * 0.35);
    let pk = 1 - sstep(pathW * 0.6, pathW * 1.6, pd);
    tmp.lerp(cDirt, pk);
    for (const g of M.gens) { const d = Math.hypot(x - g.x, z - g.z); if (d < 4) { tmp.lerp(cMud, (1 - sstep(1.2, 4, d)) * 0.9); pk = Math.max(pk, 1 - sstep(1.4, 3.6, d)); } }
    gpk[i] = pk;
    for (const t of M.trees) { const d = Math.hypot(x - t.x, z - t.z); if (d < 3) tmp.lerp(cLitter, (1 - sstep(0.6, 3, d)) * 0.7); }
    if (Math.abs(x) > HF + 1 || Math.abs(z) > HF + 1) tmp.lerp(cForest, sstep(HF + 1, HF + 8, Math.max(Math.abs(x), Math.abs(z))) * 0.8);
    const v = 0.88 + (Math.sin(x * 1.7) * Math.cos(z * 1.3)) * 0.06;
    gcol[i * 3] = tmp.r * v; gcol[i * 3 + 1] = tmp.g * v; gcol[i * 3 + 2] = tmp.b * v;
  }
  gGeo.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
  // Fortnight's island: hills and mountains
  if (M.terrain) { for (let i = 0; i < gp.count; i++) gp.setY(i, terrainH(M, gp.getX(i), gp.getZ(i))); gGeo.computeVertexNormals(); gGeo.computeBoundingSphere(); }
  gGeo.setAttribute('pathK', new THREE.BufferAttribute(gpk, 1));
  const gt = tex(LK.groundTex);
  const groundMat = lite ? new THREE.MeshLambertMaterial({ map: gt.map, vertexColors: true })
    : new THREE.MeshLambertMaterial({ map: gt.map, normalMap: gt.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), vertexColors: true });
  const ground = new THREE.Mesh(gGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);
  // realistic look: real scanned forest floor / mud / snow with trails worn into it
  if (!lite && realistic()) photoGround(ground, LOOK[M.map] ? M.map : 'woods', LK.snowcaps ? 0.5 : 0.62, M.map === 'marsh' ? 0.8 : 0.25);
  W.ground = ground;
  W.paths = paths;

  // ---------- static boxes: merged per material, weathered with moss & grime at the base ----------
  const groups = {};
  const styleMat = {
    brick: () => mat(0xc0aca4, { map: 'brick', rough: 0.95, uvm: 1.6, tint: 0 }), wood: () => mat(0xb09a80, { map: 'wood', rough: 0.95, tint: 0 }),
    stone: () => mat(0xb4b0a6, { map: 'stone', rough: 0.95, uvm: 1.15, tint: 0 }), metal: () => mat(0x8a8a88, { map: 'metal', metal: 0.4, rough: 0.6, tint: 0 }),
    hay: () => mat(0xc0a060, { map: 'hay', rough: 1 }), dark: () => mat(0x7a6a5a, { map: 'wood', photo: 'dark', rough: 1, tint: 0.15 }),
    boards: () => mat(0xa8a898, { map: 'boards', rough: 0.95, tint: 0 }), rail: () => mat(0x6a5a48, { map: 'wood', rough: 0.95, tint: 0.3 }), hull: () => mat(0x6a5440, { map: 'boards', rough: 0.9, tint: 0.3 }),
    canvas: () => mat(0xffffff, { map: 'canvas', rough: 0.95 }), booth: () => mat(0x5a8a8a, { map: 'wood', rough: 0.85, tint: 0.65 }), fence: () => mat(0x8a8a88, { map: 'metal', photo: 'paint', metal: 0.5, rough: 0.5, tint: 0.15 }),
    trailer: () => mat(0xd8d0c0, { map: 'metal', photo: 'paint', metal: 0.3, rough: 0.6, tint: 0.3 }), truck: () => mat(0x7a1e14, { map: 'metal', metal: 0.4, rough: 0.55, tint: 0.75 }), logs: () => mat(0xc0a080, { map: 'logs', rough: 0.95, tint: 0 }),
    snowcap: () => mat(0xf0f4ff, { map: 'snow', rough: 0.8, tint: 0 }),
  };
  const addBox = (key, b, y0, y1, hx = b.hx, hz = b.hz, tile = 2) => {
    const h = y1 - y0;
    if (h <= 0.01) return;
    (groups[key] ||= []).push({ geo: boxGeo(hx * 2, h, hz * 2, tile), matrix: new THREE.Matrix4().makeTranslation(b.x, y0 + h / 2, b.z) });
  };
  const tileOf = st => st === 'stone' ? 1.15 : st === 'brick' ? 1.6 : 2;
  for (const b of M.boxes) {
    if (b.kind === 'gen' || b.kind === 'switch' || b.kind === 'logpile' || b.kind === 'mesh') continue; // ('mesh': drawn by the map's own model)
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
    if (LK.snowcaps && (b.kind === 'wall' || b.kind === 'sill' || b.kind === 'logpile' || b.kind === 'stone' || b.kind === 'truck' || b.kind === 'crate')) addBox('snowcap', { x: b.x, z: b.z }, b.h, b.h + 0.12, b.hx + 0.06, b.hz + 0.06, 2);
    if (b.kind === 'wall' && LK.ruins) {
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
    const material = key === 'bark' ? mat(0x6a5a4a, { map: 'bark', photo: 'deadbark', uvm: [1.6, 3], tint: 0 }) : (styleMat[key] || styleMat.stone)();
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
  const barkM = mat(0x4e4034, { map: 'bark', rough: 1, uvm: [1.9, 9.5], tint: 0.1 });
  const ft = tex('foliage');
  const needleM = lite ? new THREE.MeshLambertMaterial({ vertexColors: true, map: ft.map }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: ft.map, normalMap: ft.normalMap });
  const trees = [...M.trees.map(t => ({ ...t, inner: true }))];
  for (let i = 0; i < q.outer; i++) {
    const side = R.int(0, 3), along = R.range(-HF - 30, HF + 30), out = HF + 2.5 + Math.pow(R(), 0.7) * 32;
    const x = side === 0 ? along : side === 1 ? along : side === 2 ? out : -out;
    const z = side === 0 ? out : side === 1 ? -out : along;
    if (M.gates.some(g => Math.abs(x - g.x) < 7 && Math.sign(z) === g.dir && Math.abs(z) < HF + 14)) continue;
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
  if (LK.trees === 'cypress') {
    const cg = cypressGeos(), all = [...pines.flat(), ...deads];
    const cyS = t => { const k = t.h / 11; const w = Math.max(k * 0.95, t.r / 0.5); return new THREE.Vector3(w, k, w); };
    inst(cg.trunk, mat(0x5a5246, { map: 'bark', rough: 1 }), all, cyS); inst(cg.leaves, needleM, all, cyS);
    inst(cg.moss, new THREE.MeshLambertMaterial({ color: 0x4a5640, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false }), all, cyS, false);
  } else if (LK.trees === 'dead') {
    inst(deadTree.trunk, barkM, [...pines.flat(), ...deads], t => { const k = t.h / 8; const w = Math.max(k * 0.9, t.r / 0.32); return new THREE.Vector3(w, k, w); });
  } else {
    if (!lite && realistic()) {
      // realistic: real-looking fir fronds instead of stacked cones
      const frondM = new THREE.MeshStandardMaterial({ map: tex('needles').map, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.9, color: LK.trees === 'snowpine' ? 0xbcc4b8 : 0x9aa48a });
      frondM.envMapIntensity = 0.3;
      const pScale = t => { const k = t.h / 10.8; const w = Math.max(k, t.r / 0.32) * (0.9 + (t.s - 1) * 0.3); return new THREE.Vector3(w, k * 1.05, w); };
      pines.forEach((list, v) => { const g = pineCards(v + 3, LK.trees === 'snowpine'); inst(g.trunk, barkM, list, pScale); inst(g.leaves, frondM, list, pScale); });
    } else pines.forEach((list, v) => { const g = pineGeo(v + 3); inst(g.trunk, barkM, list, pineScale); inst(LK.trees === 'snowpine' ? snowify(g.leaves) : g.leaves, needleM, list, pineScale); });
    inst(deadTree.trunk, barkM, deads, t => { const k = t.h / 8; const w = Math.max(k * 0.9, t.r / 0.32); return new THREE.Vector3(w, k, w); });
  }

  // ---------- rocks, pebbles, bushes, fallen logs ----------
  const rockM = mat(0x8a8680, { map: 'rock', rough: 0.95, uvm: 3, tint: 0.1 });
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
      const x = inside ? R.range(-HF + 1, HF - 1) : R.range(-HF - 20, HF + 20), z = inside ? R.range(-HF + 1, HF - 1) : R.range(-HF - 20, HF + 20);
      if (inside && blocked(x, z, pad)) continue;
      if (!inside && Math.abs(x) < HF + 1 && Math.abs(z) < HF + 1) continue;
      let pd = 99; for (const [ax, az, bx, bz] of paths) pd = Math.min(pd, segDist(x, z, ax, az, bx, bz));
      if (pd < 1.6) continue;
      out.push({ x, z, rot: R() * 6.28, s: R.range(0.6, 1.4) });
    }
    return out;
  };
  const nBush = Math.round((quality === 'potato' ? 0 : quality === 'low' ? 60 : quality === 'medium' ? 160 : 260) * LK.bushes);
  if (nBush) {
    const bushM = lite ? new THREE.MeshLambertMaterial({ color: LK.bush, map: ft.map }) : new THREE.MeshStandardMaterial({ color: LK.bush, map: ft.map, roughness: 1 });
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
  if (q.grass && LK.grass > 0) {
    const gq = [];
    const real = !lite && realistic();
    const plane = real ? new THREE.PlaneGeometry(0.75, 0.55, 1, 2) : new THREE.PlaneGeometry(0.7, 0.5); plane.translate(0, real ? 0.275 : 0.25, 0);
    for (const ry of real ? [0, Math.PI / 3, Math.PI * 2 / 3] : [0, Math.PI / 2]) gq.push({ geo: plane, matrix: new THREE.Matrix4().makeRotationY(ry) });
    const ggeo = mergeGeos(gq);
    let gm;
    if (real) {
      // lit like the ground it grows from (normals up, so no black back faces), swaying in the wind
      const n = ggeo.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
      gm = new THREE.MeshStandardMaterial({ map: tex('grassr').map, alphaTest: 0.4, side: THREE.DoubleSide, color: LK.grassTint, roughness: 0.95 });
      gm.envMapIntensity = 0.25;
      const T = W.grassT = { value: 0 };
      gm.onBeforeCompile = sh => {
        sh.uniforms.gT = T;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float gT;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            #ifdef USE_INSTANCING
            vec3 gw = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            #else
            vec3 gw = vec3(0.0);
            #endif
            float sway = sin(gT * 1.7 + gw.x * 0.35 + gw.z * 0.27) * 0.6 + sin(gT * 3.1 + gw.x * 1.3) * 0.25;
            transformed.x += sway * 0.09 * position.y * position.y * 3.0;
            transformed.z += sway * 0.05 * position.y * position.y * 3.0;`);
      };
    } else gm = new THREE.MeshLambertMaterial({ map: tex('grass').map, alphaTest: 0.45, side: THREE.DoubleSide, color: LK.grassTint });
    const list = [];
    const nGrass = q.grass * LK.grass * (real ? 1.8 : 1);
    for (let i = 0; i < nGrass * 3 && list.length < nGrass; i++) {
      const x = R.range(-HF - 8, HF + 8), z = R.range(-HF - 8, HF + 8);
      let bad = false;
      for (const b of M.boxes) if (Math.abs(x - b.x) < b.hx + 0.2 && Math.abs(z - b.z) < b.hz + 0.2) { bad = true; break; }
      if (bad || (M.isIndoors && M.isIndoors(x, z))) continue;
      let pd = 99; for (const [ax, az, bx, bz] of paths) pd = Math.min(pd, segDist(x, z, ax, az, bx, bz));
      if (pd < 1.3 && R() < 0.85) continue;
      list.push({ x, z, rot: R() * 6.28, s: R.range(0.7, 1.6) });
    }
    const im = new THREE.InstancedMesh(ggeo, gm, list.length);
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler();
    list.forEach((t, i) => { e.set(0, t.rot, 0); qq.setFromEuler(e); m.compose(new THREE.Vector3(t.x, 0, t.z), qq, new THREE.Vector3(t.s, t.s * R.range(0.7, 1.4), t.s)); im.setMatrixAt(i, m); im.setColorAt(i, real ? new THREE.Color().setHSL(0.16 + R() * 0.1, 0.25 + R() * 0.15, 0.5 + R() * 0.3) : new THREE.Color().setHSL(0.17 + R() * 0.08, 0.32, 0.36 + R() * 0.24)); });
    im.receiveShadow = true;
    scene.add(im);
  }

  // ---------- lamp posts with pools of warm light ----------
  const lampSpots = [];
  for (const g of M.gens) for (let k = 0; k < 6 && lampSpots.length < M.gens.length * 2; k++) {
    const a = R() * 6.28, r = 3.2 + R() * 2;
    const x = g.x + Math.cos(a) * r, z = g.z + Math.sin(a) * r;
    if (!blocked(x, z, 0.6) && !(M.isIndoors && M.isIndoors(x, z)) && !M.circles.some(c => Math.hypot(x - c.x, z - c.z) < c.r + 0.6)) { lampSpots.push({ x, z }); break; }
  }
  for (const gt2 of M.gates) lampSpots.push({ x: gt2.sx - 2.2, z: gt2.sz - gt2.dir * 1.5 });
  const postM = mat(0x2a2622, { map: 'metal', metal: 0.5, rough: 0.6 });
  const poolTex = tex('glow').map;
  for (const L of lampSpots) {
    const g = new THREE.Group(); g.position.set(L.x, 0, L.z); g.rotation.y = R() * 6.28;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.4, 8), postM); post.position.y = 1.7; post.castShadow = true; g.add(post);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.06), postM); arm.position.set(0.32, 3.3, 0); g.add(arm);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 8, 1, true), postM); head.position.set(0.62, 3.22, 0); g.add(head);
    const bulbM = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: LK.lamp, emissiveIntensity: 3 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), bulbM); bulb.position.set(0.62, 3.13, 0); g.add(bulb);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(4.2, 24), new THREE.MeshBasicMaterial({ map: poolTex, color: LK.lamp, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(0.62, 0.04, 0); g.add(pool);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: poolTex, color: 0xffc070, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(1.1); glow.position.set(0.62, 3.1, 0); g.add(glow);
    let light = null;
    if (quality === 'high' && W.lamps.length < 8) { light = new THREE.PointLight(LK.lamp, 7, 11, 1.6); light.position.set(0.62, 3.0, 0); g.add(light); }
    scene.add(g);
    W.lamps.push({ bulbM, pool, glow, light, ph: R() * 10 });
  }

  buildThemeExtras(W, M, quality, R);
  // a map with its own scenery model (Granny's House)
  if (M.glbScene) { const o = cloneScene(M.glbScene, lite); if (o) { scene.add(o); W.glb = o; } }
  addInteractables(W, M);
  // ---------- rolling ground fog: layered planes with scrolling noise ----------
  const nf = quality === 'potato' ? 0 : quality === 'low' ? 1 : 2;
  for (let i = 0; i < nf; i++) {
    const t = tex('fogtile').map.clone(); t.needsUpdate = true; t.repeat.set(5 + i, 5 + i);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshBasicMaterial({ map: t, color: LK.groundFog, transparent: true, opacity: (0.05 - i * 0.015) * LK.groundFogK, depthWrite: false }));
    plane.rotation.x = -Math.PI / 2; plane.position.y = 0.3 + i * 0.5; plane.renderOrder = 2;
    scene.add(plane); W.fogLayers.push({ t, v: 0.004 + i * 0.002, d: i % 2 ? 1 : -1 });
    plane.userData.flat = true; if (M.terrain) plane.visible = false;
  }
  if (M.terrain) liftToTerrain(scene, M, new Set([sky, ground]));
  return W;
}
// everything built on the flat plane is set down on the terrain: instanced things one by one,
// merged geometry vertex by vertex (walls on flat building plots don't move at all)
function liftToTerrain(scene, M, skip) {
  const v = new THREE.Vector3(), m4 = new THREE.Matrix4(), inv = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  scene.updateMatrixWorld(true);
  for (const o of scene.children) {
    if (skip.has(o) || o.isLight || o.isCamera || o.userData.flat || o.material && o.material.fog === false) continue;
    const atOrigin = Math.abs(o.position.x) < 1e-3 && Math.abs(o.position.z) < 1e-3;
    if (!atOrigin) { o.position.y += terrainH(M, o.position.x, o.position.z); continue; }
    o.traverse(c => {
      if (c.isInstancedMesh) {
        for (let i = 0; i < c.count; i++) { c.getMatrixAt(i, m4); m4.decompose(pos, q, sc); v.copy(pos).applyMatrix4(c.matrixWorld); pos.y += terrainH(M, v.x, v.z); m4.compose(pos, q, sc); c.setMatrixAt(i, m4); }
        c.instanceMatrix.needsUpdate = true; if (c.computeBoundingSphere) c.computeBoundingSphere(); c.frustumCulled = false;
      } else if ((c.isMesh || c.isPoints || c.isLineSegments) && c.geometry && c.geometry.attributes.position) {
        const g = c.geometry.clone(), p = g.attributes.position; inv.copy(c.matrixWorld).invert();
        for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(c.matrixWorld); v.y += terrainH(M, v.x, v.z); v.applyMatrix4(inv); p.setXYZ(i, v.x, v.y, v.z); }
        p.needsUpdate = true; g.computeBoundingSphere(); c.geometry = g;
      }
    });
  }
}

// generators, cages, barricades and exit gates (shared by every map)
export function addInteractables(W, M) {
  const scene = W.scene;
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
}

// per-frame updates for props, driven by state
export function updateWorld(W, M, S, t, dt, follow) {
  if (W.city) updateCityWorld(W, follow, t, dt);
  if (W.grassT) W.grassT.value = t;
  if (follow) {
    W.fill.position.set(follow.x, 3.2, follow.z);
    W.moon.target.position.set(follow.x, 0, follow.z);
    W.moon.position.set(follow.x + 30, 60, follow.z + 20);
    W.sky.position.set(follow.x, 0, follow.z);
  }
  if (W.indoor) updateMeatLights(W, follow, t);
  for (const f of W.fogLayers) { f.t.offset.x += f.v * dt * f.d; f.t.offset.y += f.v * 0.6 * dt; }
  if (W.clouds) W.clouds.offset.x += dt * 0.0015;
  updateThemeFx(W, t, dt, follow);
  const dk = W.darkK || 0;
  if (!W.indoor) for (const L of W.lamps) {
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
    // the Entity's legs rise in the struggle phase and plunge when it claims someone
    const hp = who != null ? S.players.find(p => p.id === who) : null;
    const want = hp && hp.stage >= 2 ? 1 : 0;
    if (u.claimT != null) { u.claimT += dt; if (u.claimT > 2.2) u.claimT = null; }
    const target = u.claimT != null ? 1 : want;
    u.legF += (target - u.legF) * Math.min(1, dt * (target ? 1.5 : 3));
    if (u.legF > 0.005 || u.legs[0].base.visible) poseHookLegs(W.cages[i], u.legF, t, u.claimT != null ? Math.min(1, u.claimT * 3) : 0);
    if (S.cageBroken[i] && !u.broken) { u.broken = true; u.claimT = 0; } // the Entity takes them, and the hook with them
    if (u.broken && u.claimT == null && !u.bent) { u.bent = true; W.cages[i].rotation.z = 0.12; W.cages[i].rotation.x = -0.08; W.cages[i].position.y = -0.25; }
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
  if (M.ceiling && y > M.ceiling - 0.3) return true;
  const bucket = M.hash.get(Math.floor((x + (M.half || HALF) + 12) / 8) * 1000 + Math.floor((z + (M.half || HALF) + 12) / 8));
  if (!bucket) return false;
  for (const o of bucket) {
    if (o.r !== undefined) { if (o.kind !== 'cage' && y < o.h && Math.hypot(x - o.x, z - o.z) < o.r + 0.15) return true; }
    else if (y < o.h + 0.1 && Math.abs(x - o.x) < o.hx + 0.15 && Math.abs(z - o.z) < o.hz + 0.15) return true;
  }
  return false;
}
export { barBox };
