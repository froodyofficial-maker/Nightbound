// 3D scene for the Hollow Pines Meatworks (OFFAL crossover map): white-tiled kill floors under a
// low ceiling, meat rails hung with carcasses, steel tables, lockers, freezer racks, offal tanks,
// hanging industrial lamps (a pool of real lights follows the player) and a lot of old blood.
import * as THREE from 'three';
import { HALF } from './config.js';
import { rng } from './map.js';
import { tex } from './textures.js';
import { setDetail, mat, boxGeo, mergeGeos } from './models.js';
import { QUALITY, addInteractables } from './world.js';

const FOG = 0x0e0606;
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// a half carcass on a hook: lathe body with ribs and fat marbling (vertex colours), legs, hook, chain
let carcassCache = null;
function carcassGeo() {
  if (carcassCache) return carcassCache;
  const parts = [];
  const prof = [[0.03, 0], [0.12, 0.1], [0.2, 0.35], [0.26, 0.75], [0.28, 1.1], [0.25, 1.45], [0.19, 1.75], [0.12, 1.95], [0.05, 2.08]];
  const body = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 14);
  const p = body.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
  const flesh = new THREE.Color(0x8a1812), dark = new THREE.Color(0x4a0806), fat = new THREE.Color(0xe8c8b0), bone = new THREE.Color(0xd8ccb8);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    // flatten into a split half: the cut face shows ribs
    const cut = z < 0;
    if (cut) p.setZ(i, z * 0.15);
    const rib = cut && y > 0.5 && y < 1.6 && Math.sin(y * 34) > 0.55;
    const marb = Math.sin(y * 9 + a * 3) * 0.5 + 0.5;
    c.copy(flesh).lerp(dark, sstep(0.6, 1, Math.sin(a * 5 + y * 3) * 0.5 + 0.5) * 0.5);
    if (!cut && marb > 0.82) c.lerp(fat, 0.7);
    if (rib) c.copy(bone);
    if (y > 1.85) c.lerp(fat, 0.5);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  body.computeVertexNormals();
  parts.push({ geo: body, matrix: new THREE.Matrix4() });
  const tint = (g, hex) => { const n = g.attributes.position.count, cc = new THREE.Color(hex), a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  for (const s of [-1, 1]) parts.push({ geo: tint(new THREE.CylinderGeometry(0.045, 0.07, 0.5, 6), 0x7a1a14), matrix: new THREE.Matrix4().compose(new THREE.Vector3(s * 0.08, 2.25, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, s * 0.25)), new THREE.Vector3(1, 1, 1)) });
  parts.push({ geo: tint(new THREE.TorusGeometry(0.1, 0.014, 5, 12, Math.PI * 1.4), 0x4a4a48), matrix: new THREE.Matrix4().compose(new THREE.Vector3(0, 2.6, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.6)), new THREE.Vector3(1, 1, 1)) });
  parts.push({ geo: tint(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 4), 0x2a2a28), matrix: new THREE.Matrix4().makeTranslation(0, 3.2, 0) });
  carcassCache = mergeGeos(parts);
  return carcassCache;
}

export function buildMeatWorld(M, quality = 'medium') {
  const q = QUALITY[quality] || QUALITY.medium;
  setDetail(quality);
  const lite = quality === 'potato' || quality === 'low';
  const R = rng(M.seed * 11 + 1);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.FogExp2(FOG, q.density * 1.35);
  const W = { scene, indoor: true, gens: [], cages: [], bars: [], gates: [], switches: [], genLights: [], gateLights: [], fogSprites: [], lamps: [], fogLayers: [], lampLights: [] };

  // ---------- lights: dim, warm-red bounce; real light comes from the lamps ----------
  W.hemi = new THREE.HemisphereLight(0x8a6058, 0x220c08, 1.1); scene.add(W.hemi);
  W.amb = new THREE.AmbientLight(0x3a1c18, 0.8); scene.add(W.amb);
  const top = new THREE.DirectionalLight(0xffd8c8, 0.55);
  top.position.set(8, 60, 5);
  if (q.shadow) {
    top.castShadow = true; top.shadow.mapSize.set(q.shadow, q.shadow);
    const s = top.shadow.camera; s.left = -30; s.right = 30; s.top = 30; s.bottom = -30; s.near = 5; s.far = 120;
    top.shadow.bias = -0.0006; top.shadow.normalBias = 0.04;
  }
  scene.add(top, top.target); W.moon = top;
  W.fill = new THREE.PointLight(0xffc0a8, 2.4, 12, 1.2); scene.add(W.fill);
  W.sky = new THREE.Object3D(); scene.add(W.sky);
  // a pool of real point lights handed to the lamps nearest the player
  const nLights = { potato: 2, low: 4, medium: 8, high: 12 }[quality] ?? 6;
  for (let i = 0; i < nLights; i++) { const l = new THREE.PointLight(0xffc890, 0, 15, 1.5); scene.add(l); W.lampLights.push(l); }

  // ---------- floor and ceiling ----------
  const span = HALF * 2 + 24;
  const ft = tex('killfloor');
  ft.map.repeat.set(span / 6, span / 6); if (ft.normalMap) ft.normalMap.repeat.set(span / 6, span / 6);
  const floorM = lite ? new THREE.MeshLambertMaterial({ map: ft.map, color: 0xb0a098 })
    : new THREE.MeshStandardMaterial({ map: ft.map, normalMap: ft.normalMap, color: 0xb8a8a0, roughness: 0.32, metalness: 0.08 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(span, span), floorM);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const ceilT = tex('killfloor').map.clone(); ceilT.needsUpdate = true; ceilT.repeat.set(span / 8, span / 8);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(span, span), new THREE.MeshLambertMaterial({ map: ceilT, color: 0x3a3230 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = M.ceiling; scene.add(ceil);

  // ---------- static boxes, merged per material ----------
  const groups = {};
  const add = (key, x, z, y0, y1, hx, hz, tile = 2) => { const h = y1 - y0; if (h <= 0.01) return; (groups[key] ||= []).push({ geo: boxGeo(hx * 2, h, hz * 2, tile), matrix: new THREE.Matrix4().makeTranslation(x, y0 + h / 2, z) }); };
  const addGeo = (key, geo, m) => (groups[key] ||= []).push({ geo, matrix: m });
  const cylGeo = (r, h, n = 14) => new THREE.CylinderGeometry(r, r, h, n);
  for (const b of M.boxes) {
    switch (b.kind) {
      case 'gen': case 'switch': break;
      case 'sill': add('tile', b.x, b.z, 0, b.h, b.hx, b.hz, 1); add('steel', b.x, b.z, b.h, b.h + 0.06, b.hx + 0.04, b.hz + 0.04); break;
      case 'table':
        add('steel', b.x, b.z, b.h - 0.06, b.h, b.hx, b.hz);
        add('steel', b.x, b.z, 0.22, 0.26, b.hx * 0.9, b.hz * 0.85);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) add('steel', b.x + sx * (b.hx - 0.08), b.z + sz * (b.hz - 0.08), 0, b.h - 0.06, 0.03, 0.03);
        add('gore', b.x + (R() - 0.5) * b.hx, b.z, b.h, b.h + 0.03, 0.25, Math.min(0.2, b.hz * 0.6));
        break;
      case 'locker': {
        add('locker', b.x, b.z, 0, b.h, b.hx, b.hz, 1);
        const along = b.hx > b.hz, n = Math.max(2, Math.round((along ? b.hx : b.hz) * 2 / 0.5));
        for (let i = 1; i < n; i++) { const o = -(along ? b.hx : b.hz) + i * (along ? b.hx : b.hz) * 2 / n; add('dark', b.x + (along ? o : 0), b.z + (along ? 0 : o), 0.05, b.h - 0.05, along ? 0.012 : b.hx + 0.01, along ? b.hz + 0.01 : 0.012); }
        break;
      }
      case 'rack': {
        const along = b.hx > b.hz;
        for (const s2 of [-1, 1]) for (const e of [-1, 1]) add('steel', b.x + (along ? s2 * (b.hx - 0.05) : e * (b.hx - 0.05)), b.z + (along ? e * (b.hz - 0.05) : s2 * (b.hz - 0.05)), 0, b.h, 0.04, 0.04);
        for (let k = 0; k < 4; k++) {
          const y = 0.35 + k * 0.62;
          add('steel', b.x, b.z, y, y + 0.04, b.hx, b.hz);
          for (let m = 0; m < 4; m++) if (R() < 0.75) { const o = (R() - 0.5) * 2 * ((along ? b.hx : b.hz) - 0.3); add(R() < 0.5 ? 'meat' : 'wrap', b.x + (along ? o : 0), b.z + (along ? 0 : o), y + 0.04, y + 0.2 + R() * 0.14, 0.18 + R() * 0.1, Math.min(b.hx, b.hz) * 0.7); }
        }
        break;
      }
      case 'tank': {
        const r = Math.min(b.hx, b.hz);
        addGeo('steel', cylGeo(r, b.h, 18), new THREE.Matrix4().makeTranslation(b.x, b.h / 2, b.z));
        addGeo('rust', cylGeo(r * 1.02, 0.14, 18), new THREE.Matrix4().makeTranslation(b.x, b.h * 0.35, b.z));
        addGeo('rust', cylGeo(r * 1.02, 0.14, 18), new THREE.Matrix4().makeTranslation(b.x, b.h * 0.75, b.z));
        addGeo('steel', cylGeo(0.12, M.ceiling - b.h, 8), new THREE.Matrix4().makeTranslation(b.x + r * 0.4, b.h + (M.ceiling - b.h) / 2, b.z));
        break;
      }
      case 'drum': addGeo('rust', cylGeo(Math.min(b.hx, b.hz), b.h, 14), new THREE.Matrix4().makeTranslation(b.x, b.h / 2, b.z)); break;
      case 'desk': add('wood', b.x, b.z, b.h - 0.05, b.h, b.hx, b.hz); for (const sx of [-1, 1]) add('wood', b.x + sx * (b.hx - 0.1), b.z, 0, b.h - 0.05, 0.05, b.hz - 0.05); break;
      case 'wall':
        if (b.style === 'rail') {
          // cattle pen rails: posts and three bars
          const along = b.hx > b.hz, L = (along ? b.hx : b.hz);
          for (let o = -L; o <= L + 1e-6; o += 1.2) add('rust', b.x + (along ? o : 0), b.z + (along ? 0 : o), 0, b.h, 0.05, 0.05);
          for (const y of [0.35, 0.7, 1.05]) add('rust', b.x, b.z, y, y + 0.06, along ? b.hx : 0.035, along ? 0.035 : b.hz);
        } else { add('tile', b.x, b.z, 0, b.h, b.hx, b.hz, 2); add('dark', b.x, b.z, 0, 0.16, b.hx + 0.02, b.hz + 0.02); }
        break;
      default: add('tile', b.x, b.z, 0, b.h, b.hx, b.hz, 2);
    }
  }
  for (const v of M.visual) if (v.type === 'lintel') add('tile', v.x, v.z, v.y0, M.ceiling, v.hx, v.hz, 1);
  // ceiling beams over the rooms and meat rails over the carcass rows
  for (const r of M.rooms) {
    const x0 = M.cells.X0 + r.x * M.cells.CS, z0 = M.cells.X0 + r.y * M.cells.CS, w = r.w * M.cells.CS, h = r.h * M.cells.CS;
    if (w >= h) for (let x = x0 + 4; x < x0 + w - 0.5; x += 4) add('beam', x, z0 + h / 2, M.ceiling - 0.35, M.ceiling, 0.12, h / 2);
    else for (let z = z0 + 4; z < z0 + h - 0.5; z += 4) add('beam', x0 + w / 2, z, M.ceiling - 0.35, M.ceiling, w / 2, 0.12);
  }
  for (const [x1, z1, x2, z2] of M.rails) {
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2, alongX = Math.abs(x2 - x1) > Math.abs(z2 - z1), L = Math.hypot(x2 - x1, z2 - z1) / 2;
    add('steel', cx, cz, 4.62, 4.72, alongX ? L : 0.05, alongX ? 0.05 : L);
    for (const e of [-1, 1]) add('steel', cx + (alongX ? e * L : 0), cz + (alongX ? 0 : e * L), 4.72, M.ceiling, 0.04, 0.04);
  }
  const styles = {
    tile: () => mat(0xe8e2d6, { map: 'tiles', rough: 0.35 }), steel: () => mat(0x9a9c9e, { map: 'metal', metal: 0.75, rough: 0.35 }),
    rust: () => mat(0x8a6a50, { map: 'metal', metal: 0.4, rough: 0.7 }), dark: () => mat(0x2a2624, { rough: 0.8 }),
    locker: () => mat(0x5a6a62, { map: 'metal', metal: 0.5, rough: 0.5 }), beam: () => mat(0x3a3634, { map: 'metal', metal: 0.6, rough: 0.6 }),
    wood: () => mat(0x6a4a30, { map: 'wood', rough: 0.9 }), meat: () => mat(0x7a1410, { rough: 0.3 }), wrap: () => mat(0xd8d0c8, { rough: 0.4 }),
    gore: () => mat(0x4a0604, { rough: 0.15, emissive: 0x200000, ei: 0.6 }),
  };
  const grime = new THREE.Color(0x5a3a2a), soot = new THREE.Color(0x3a3430);
  for (const key in groups) {
    const material = (styles[key] || styles.tile)();
    const geo = mergeGeos(groups[key]);
    if (key === 'tile') {
      // grime and old blood creeping up from the floor, soot under the ceiling
      const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const n = 0.5 + 0.5 * Math.sin(x * 1.3 + z * 0.9) * Math.sin(x * 0.4 - z * 0.7);
        c.setRGB(1, 1, 1).lerp(grime, (1 - sstep(0, 0.9 + n * 1.2, y)) * 0.8).lerp(soot, sstep(3.6, 5, y) * 0.6);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      material.vertexColors = true; material.needsUpdate = true;
    }
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = key !== 'beam'; mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---------- carcasses (instanced) ----------
  const carc = M.circles.filter(c => c.kind === 'carcass');
  if (carc.length) {
    const cm = lite ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.05 });
    const im = new THREE.InstancedMesh(carcassGeo(), cm, carc.length);
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler();
    carc.forEach((c, i) => { e.set((R() - 0.5) * 0.06, c.rot, (R() - 0.5) * 0.06); qq.setFromEuler(e); m4.compose(new THREE.Vector3(c.x, 1.05 + (1 - c.s) * 0.4, c.z), qq, new THREE.Vector3(c.s, c.s, c.s)); im.setMatrixAt(i, m4); });
    im.castShadow = true; im.receiveShadow = true; scene.add(im);
  }

  // ---------- blood on the floor (decals from the atlas) ----------
  const atlas = tex('bloodatlas').map;
  const decalM = new THREE.MeshLambertMaterial({ map: atlas, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, color: 0x9a1a14, emissive: 0x1a0000 });
  const decals = [];
  const spot = (x, z, s) => decals.push({ x, z, s, cell: R.int(0, 1), rot: R() * 6.28 });
  for (const c of carc) if (R() < 0.5) spot(c.x + (R() - 0.5) * 0.6, c.z + (R() - 0.5) * 0.6, R.range(0.6, 1.4));
  for (const b of M.boxes) if (b.kind === 'table' || b.kind === 'tank') spot(b.x + (R() - 0.5) * 2, b.z + (R() - 0.5) * 2, R.range(1, 2.2));
  for (const r of M.rooms) for (let k = 0; k < 3; k++) spot(M.cells.X0 + (r.x + R() * r.w) * M.cells.CS, M.cells.X0 + (r.y + R() * r.h) * M.cells.CS, R.range(0.8, 2.6));
  for (let cell = 0; cell < 4; cell++) {
    const list = decals.filter(d => d.cell === cell);
    if (!list.length) continue;
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5 + (cell % 2) * 0.5, uv.getY(i) * 0.5 + (cell > 1 ? 0 : 0.5));
    const im = new THREE.InstancedMesh(g, decalM, list.length);
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion();
    list.forEach((d, i) => { qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.rot); m4.compose(new THREE.Vector3(d.x, 0.012 + i * 0.0004, d.z), qq, new THREE.Vector3(d.s, 1, d.s)); im.setMatrixAt(i, m4); });
    im.renderOrder = 1; scene.add(im);
  }

  // ---------- hanging industrial lamps ----------
  const shadeM = mat(0x2a2826, { map: 'metal', metal: 0.6, rough: 0.5 });
  const poolTex = tex('glow').map;
  const shadeGeo = new THREE.ConeGeometry(0.42, 0.34, 14, 1, true), cordGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 4);
  for (const L of M.lamps) {
    const color = L.red ? 0xff3020 : 0xffc890;
    const g = new THREE.Group(); g.position.set(L.x, 0, L.z);
    const y = M.ceiling - 1.3;
    const cord = new THREE.Mesh(cordGeo, shadeM); cord.scale.y = M.ceiling - y; cord.position.y = (M.ceiling + y) / 2; g.add(cord);
    const shade = new THREE.Mesh(shadeGeo, shadeM); shade.position.y = y + 0.1; g.add(shade);
    const bulbM = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: color, emissiveIntensity: 3 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), bulbM); bulb.position.y = y - 0.02; g.add(bulb);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(4.2, 24), new THREE.MeshBasicMaterial({ map: poolTex, color, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.03; g.add(pool);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: poolTex, color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(1.3); glow.position.y = y - 0.05; g.add(glow);
    scene.add(g);
    W.lamps.push({ bulbM, pool, glow, light: null, ph: R() * 10, x: L.x, z: L.z, y: y - 0.2, color, dead: R() < 0.08 });
  }

  // ---------- glowing EXIT signs over the gates ----------
  const sc = document.createElement('canvas'); sc.width = 256; sc.height = 96;
  const sx = sc.getContext('2d'); sx.fillStyle = '#1a0402'; sx.fillRect(0, 0, 256, 96); sx.fillStyle = '#ff3a20'; sx.font = 'bold 64px sans-serif'; sx.textAlign = 'center'; sx.fillText('EXIT', 128, 72);
  const signT = new THREE.CanvasTexture(sc); signT.colorSpace = THREE.SRGBColorSpace;
  for (const gt of M.gates) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), new THREE.MeshBasicMaterial({ map: signT, toneMapped: false }));
    s.position.set(gt.x, 4.4, gt.z - gt.dir * 0.8); s.rotation.y = gt.dir > 0 ? Math.PI : 0; scene.add(s);
  }

  addInteractables(W, M);
  return W;
}

// flicker the lamps and hand the light pool to the ones nearest the player
const _near = [];
export function updateMeatLights(W, follow, t) {
  const dk = W.darkK || 0;
  for (const L of W.lamps) {
    const fl = (L.dead ? (Math.sin(t * 23 + L.ph) > 0.6 ? 1 : 0.08) : Math.sin(t * 13 + L.ph) > 0.97 ? 0.3 : 1) * (1 - dk);
    L.fl = fl;
    L.bulbM.emissiveIntensity = 3 * fl; L.pool.material.opacity = 0.16 * fl; L.glow.material.opacity = 0.6 * fl;
  }
  if (!follow) return;
  _near.length = 0;
  for (const L of W.lamps) { L.d = (L.x - follow.x) ** 2 + (L.z - follow.z) ** 2; _near.push(L); }
  _near.sort((a, b) => a.d - b.d);
  W.lampLights.forEach((l, i) => {
    const L = _near[i];
    if (!L) { l.intensity = 0; return; }
    l.position.set(L.x, L.y, L.z); l.color.setHex(L.color);
    l.intensity = 16 * L.fl;
  });
}
