// Builds the 3D scene for a generated map.
import * as THREE from 'three';
import { HALF } from './config.js';
import { rng, barBox } from './map.js';
import { tex } from './textures.js';
import { setDetail, mat, boxGeo, mergeGeos, treeGeos, rockGeo, makeGenerator, makeCage, makeBarricade, makeGate, makeSwitch } from './models.js';

export const QUALITY = {
  // potato: for very weak laptops / integrated graphics. No shadows, no post-processing, cheap materials.
  potato: { shadow: 0, grass: 0, pixel: 0.6, bloom: false, post: false, outer: 50, fog: 0, density: 0.05, far: 80, minPixel: 0.45 },
  low: { shadow: 0, grass: 1200, pixel: 0.8, bloom: false, post: false, outer: 110, fog: 6, density: 0.04, far: 120, minPixel: 0.5 },
  medium: { shadow: 1024, grass: 4500, pixel: 1, bloom: true, post: true, outer: 260, fog: 22, density: 0.032, far: 300, minPixel: 0.6 },
  high: { shadow: 2048, grass: 10000, pixel: Math.min(2, window.devicePixelRatio || 1), bloom: true, post: true, outer: 440, fog: 36, density: 0.03, far: 600, minPixel: 0.7 },
};

const FOG_COLOR = 0x222b3a;

export function buildWorld(M, quality = 'medium') {
  const q = QUALITY[quality] || QUALITY.medium;
  setDetail(quality);
  const R = rng(M.seed * 7 + 3);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.FogExp2(FOG_COLOR, q.density);
  const W = { scene, gens: [], cages: [], bars: [], gates: [], switches: [], genLights: [], gateLights: [], fogSprites: [] };

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0x8494c4, 0x3a3026, 2.0);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0x3a4458, 1.1));
  const moon = new THREE.DirectionalLight(0xb4c6f0, 2.4);
  // soft fill around the viewer so characters never read as pure silhouettes
  const fill = new THREE.PointLight(0x9aa8d0, 2.2, 14, 1.2);
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

  // ---------- sky ----------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x05070d) }, bot: { value: new THREE.Color(FOG_COLOR) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bot; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y*2.2, 0.0, 1.0); gl_FragColor = vec4(mix(bot, top, pow(h,0.6)), 1.0); }',
  }));
  sky.renderOrder = -10;
  scene.add(sky); W.sky = sky;
  const starsGeo = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < 1400; i++) { const a = R() * 6.283, e = 0.15 + R() * 1.3, r = 420; sp.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r); }
  starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0xb0c0e0, size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }));
  sky.add(stars);
  const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow').map, color: 0xd8e4ff, fog: false, depthWrite: false, transparent: true }));
  moonSprite.scale.setScalar(90); moonSprite.position.set(30, 60, 20).normalize().multiplyScalar(400);
  sky.add(moonSprite);
  const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: 0xeef2ff, fog: false }));
  moonDisc.position.copy(moonSprite.position).multiplyScalar(0.99); moonDisc.lookAt(0, 0, 0);
  sky.add(moonDisc);

  // ---------- ground ----------
  const gt = tex('ground');
  const lite = quality === 'potato' || quality === 'low';
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), lite ? new THREE.MeshLambertMaterial({ map: gt.map, color: 0x9aa090 }) : new THREE.MeshStandardMaterial({ map: gt.map, normalMap: gt.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1, color: 0x9aa090 }));
  gt.map.repeat.set(45, 45); gt.normalMap.repeat.set(45, 45);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);

  // ---------- static boxes (merged per material) ----------
  const groups = {};
  const styleMat = {
    brick: () => mat(0xb0a0a0, { map: 'brick', rough: 0.95 }), wood: () => mat(0xa08870, { map: 'wood', rough: 0.95 }),
    stone: () => mat(0x9a9890, { map: 'stone', rough: 0.95 }), metal: () => mat(0x8a8a88, { map: 'metal', metal: 0.4, rough: 0.6 }),
    hay: () => mat(0xc0a060, { map: 'hay', rough: 1 }), dark: () => mat(0x6a6058, { map: 'wood', rough: 1 }),
  };
  const addBox = (key, b, y0, y1, hx = b.hx, hz = b.hz, tile = 2) => {
    const h = y1 - y0;
    if (h <= 0.01) return;
    (groups[key] ||= []).push({ geo: boxGeo(hx * 2, h, hz * 2, tile), matrix: new THREE.Matrix4().makeTranslation(b.x, y0 + h / 2, b.z) });
  };
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
    if (b.kind === 'sill') { addBox(key, b, 0, b.h); addBox('dark', { x: b.x, z: b.z }, b.h, b.h + 0.06, b.hx + 0.04, b.hz + 0.04); continue; }
    addBox(key, b, 0, b.h, b.hx, b.hz, b.kind === 'boundary' ? 3 : 2);
    if (b.kind === 'boundary' && b.hx > b.hz) addBox('stone', { x: b.x, z: b.z }, b.h, b.h + 0.25, b.hx + 0.1, b.hz + 0.12);
    if (b.kind === 'boundary' && b.hz > b.hx) addBox('stone', { x: b.x, z: b.z }, b.h, b.h + 0.25, b.hx + 0.12, b.hz + 0.1);
  }
  for (const v of M.visual) if (v.type === 'lintel') addBox(v.style, { x: v.x, z: v.z }, v.y0, v.y1, v.hx, v.hz);
  for (const key in groups) {
    const material = key === 'bark' ? mat(0x6a5a4a, { map: 'bark' }) : (styleMat[key] || styleMat.stone)();
    const mesh = new THREE.Mesh(mergeGeos(groups[key]), material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---------- trees (instanced) ----------
  const pine = treeGeos('pine'), dead = treeGeos('dead');
  const barkM = mat(0x5a4a3c, { map: 'bark', rough: 1 });
  const needleM = lite ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, color: 0xffffff });
  const trees = [...M.trees.map(t => ({ ...t, inner: true }))];
  for (let i = 0; i < q.outer; i++) {
    const side = R.int(0, 3), along = R.range(-HALF - 30, HALF + 30), out = HALF + 2.5 + Math.pow(R(), 0.7) * 32;
    let x = side === 0 ? along : side === 1 ? along : side === 2 ? out : -out;
    let z = side === 0 ? out : side === 1 ? -out : along;
    if (M.gates.some(g => Math.abs(x - g.x) < 7 && Math.sign(z) === g.dir && Math.abs(z) < HALF + 14)) continue;
    trees.push({ x, z, s: R.range(0.8, 1.4), h: R.range(8, 14), rot: R.range(0, 6.28), r: 0.4 });
  }
  const pines = trees.filter((t, i) => (i * 7 + Math.floor(t.x * 13)) % 5 < 3), deads = trees.filter((t, i) => (i * 7 + Math.floor(t.x * 13)) % 5 >= 3);
  const inst = (geo, material, list, scaleFn, shadow = true) => {
    const im = new THREE.InstancedMesh(geo, material, list.length);
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler();
    list.forEach((t, i) => { const s = scaleFn(t); e.set((R() - 0.5) * 0.08, t.rot, (R() - 0.5) * 0.08); qq.setFromEuler(e); m.compose(new THREE.Vector3(t.x, 0, t.z), qq, s); im.setMatrixAt(i, m); });
    im.castShadow = shadow; im.receiveShadow = true;
    scene.add(im);
    return im;
  };
  const pineScale = t => { const k = t.h / 10; const w = Math.max(k, t.r / 0.28); return new THREE.Vector3(w, k * 1.1, w); };
  inst(pine.trunk, barkM, pines, pineScale);
  inst(pine.leaves, needleM, pines, pineScale);
  inst(dead.trunk, barkM, deads, t => { const k = t.h / 8; const w = Math.max(k * 0.9, t.r / 0.32); return new THREE.Vector3(w, k, w); });

  // ---------- rocks ----------
  const rockM = mat(0x8a8884, { map: 'rock', rough: 0.95 });
  const rocks = M.rocks;
  for (let v = 0; v < 3; v++) {
    const list = rocks.filter((_, i) => i % 3 === v);
    if (!list.length) continue;
    inst(rockGeo(v + 1), rockM, list, t => new THREE.Vector3(t.r * 1.15, Math.max(0.5, t.h * 0.75), t.r * 1.15));
  }

  // ---------- grass ----------
  if (q.grass) {
    const gq = [];
    const plane = new THREE.PlaneGeometry(0.7, 0.45); plane.translate(0, 0.22, 0);
    gq.push({ geo: plane, matrix: new THREE.Matrix4() }, { geo: plane, matrix: new THREE.Matrix4().makeRotationY(Math.PI / 2) });
    const ggeo = mergeGeos(gq);
    const gm = new THREE.MeshLambertMaterial({ map: tex('grass').map, alphaTest: 0.45, side: THREE.DoubleSide, color: 0xb0b8a0 });
    const list = [];
    for (let i = 0; i < q.grass * 3 && list.length < q.grass; i++) {
      const x = R.range(-HALF - 8, HALF + 8), z = R.range(-HALF - 8, HALF + 8);
      let bad = false;
      for (const b of M.boxes) if (Math.abs(x - b.x) < b.hx + 0.2 && Math.abs(z - b.z) < b.hz + 0.2) { bad = true; break; }
      if (bad) continue;
      list.push({ x, z, rot: R() * 6.28, s: R.range(0.6, 1.5) });
    }
    const im = new THREE.InstancedMesh(ggeo, gm, list.length);
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler();
    list.forEach((t, i) => { e.set(0, t.rot, 0); qq.setFromEuler(e); m.compose(new THREE.Vector3(t.x, 0, t.z), qq, new THREE.Vector3(t.s, t.s * R.range(0.7, 1.3), t.s)); im.setMatrixAt(i, m); const c = new THREE.Color().setHSL(0.18 + R() * 0.08, 0.3, 0.45 + R() * 0.3); im.setColorAt(i, c); });
    im.receiveShadow = true;
    scene.add(im);
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
  // ---------- drifting ground fog ----------
  const fogMat = new THREE.SpriteMaterial({ map: tex('fog').map, transparent: true, opacity: 0.09, depthWrite: false, color: 0xb8c4d8 });
  for (let i = 0; i < q.fog; i++) {
    const s = new THREE.Sprite(fogMat);
    s.scale.set(R.range(10, 18), R.range(3, 5), 1);
    s.position.set(R.range(-HALF, HALF), R.range(0.6, 1.8), R.range(-HALF, HALF));
    s.userData.v = R.range(0.2, 0.6);
    scene.add(s); W.fogSprites.push(s);
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
  for (const s of W.fogSprites) {
    s.position.x += s.userData.v * dt;
    if (s.position.x > HALF + 10) s.position.x = -HALF - 10;
  }
  if (!S) return;
  for (let i = 0; i < M.gens.length; i++) {
    const o = W.gens[i].userData, gs = S.gens[i];
    const running = gs.n > 0 || gs.done;
    o.pistons.forEach((p, k) => { p.position.y = 1.02 + (running ? Math.sin(t * (gs.done ? 18 : 11) + k * 1.6) * 0.05 : 0); });
    const lit = gs.done ? 3 : Math.floor(gs.p * 3 + 0.0001);
    o.bulbs.forEach((b, k) => { b.material.emissiveIntensity = k < lit ? (gs.done ? 3.5 : 1.6 + Math.sin(t * 30 + k) * 0.6) : 0; });
    const L = W.genLights[i];
    const target = gs.done ? 9 : gs.n > 0 ? 0.6 + Math.random() * 0.8 * gs.p : 0;
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
