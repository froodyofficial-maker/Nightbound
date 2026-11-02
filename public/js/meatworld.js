// 3D scene for the Hollow Pines Meatworks (OFFAL crossover map).
// Abattoir walls (curb, oxblood tiles, green trim, cream tiles, painted concrete) with hand-painted
// grime and blood, a wet quarry-tile floor, stained ceiling, pipes along every wall, steel door frames
// and plastic strip curtains, meat rails with split carcasses on gambrels, enamel signs, drains,
// tubs of offal, hanging lamps with light shafts, fluorescent tubes in the halls and dust in the air.
import * as THREE from 'three';
import { HALF } from './config.js';
import { rng } from './map.js';
import { tex } from './textures.js';
import { setDetail, mat, boxGeo, mergeGeos } from './models.js';
import { QUALITY, addInteractables } from './world.js';
import { wallTextures, floorTextures, ceilingTexture, meatTexture, signTexture, drainTexture } from './meattex.js';

const FOG = 0x100707;
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// box with world-space UVs: walls map 8m x 5m of the wall texture, so the tile bands sit at the right height
function wallBox(x, z, hx, hz, y0, y1, uoff) {
  const geo = new THREE.BoxGeometry(hx * 2, y1 - y0, hz * 2);
  geo.translate(x, (y0 + y1) / 2, z);
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const u = ny > 0.5 ? p.getX(i) / 8 : nx > 0.5 ? p.getZ(i) / 8 : p.getX(i) / 8;
    const v = ny > 0.5 ? p.getZ(i) / 8 : Math.max(0.002, Math.min(0.998, p.getY(i) / 5));
    uv.setXY(i, u + uoff, v);
  }
  return geo;
}
const hash = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

// split carcass hanging from a gambrel: body (meat texture), ribs/bones, steel (gambrel, hook, chain)
let carcassCache = null;
function carcassGeos() {
  if (carcassCache) return carcassCache;
  const prof = [[0.03, 0], [0.12, 0.06], [0.21, 0.22], [0.27, 0.45], [0.26, 0.75], [0.21, 1.0], [0.23, 1.25], [0.28, 1.48], [0.25, 1.7], [0.16, 1.85], [0.07, 1.96]];
  const body = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 22);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // the cut face (z < 0) is flattened; the skin side gets lumpy muscle groups
    if (z < 0) p.setZ(i, z * 0.12);
    else { const k = 1 + 0.05 * Math.sin(y * 11 + x * 6) + 0.03 * Math.sin(y * 23); p.setX(i, x * k); p.setZ(i, z * k); }
  }
  body.computeVertexNormals();
  const bones = [];
  for (let y = 0.38; y < 1.12; y += 0.075) bones.push({ geo: new THREE.BoxGeometry(0.4 - Math.abs(y - 0.75) * 0.35, 0.022, 0.02), matrix: new THREE.Matrix4().compose(new THREE.Vector3(0, y, -0.035), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.06)), new THREE.Vector3(1, 1, 1)) });
  bones.push({ geo: new THREE.CylinderGeometry(0.03, 0.035, 1.5, 8), matrix: new THREE.Matrix4().makeTranslation(0, 1.0, -0.03) }); // spine
  for (const s of [-1, 1]) bones.push({ geo: new THREE.SphereGeometry(0.05, 8, 6), matrix: new THREE.Matrix4().makeTranslation(s * 0.18, 2.3, 0) });
  const legs = [];
  for (const s of [-1, 1]) legs.push({ geo: new THREE.CylinderGeometry(0.05, 0.085, 0.45, 8), matrix: new THREE.Matrix4().compose(new THREE.Vector3(s * 0.12, 2.1, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, s * 0.3)), new THREE.Vector3(1, 1, 1)) });
  const steel = [
    { geo: new THREE.CylinderGeometry(0.018, 0.018, 0.62, 6), matrix: new THREE.Matrix4().compose(new THREE.Vector3(0, 2.36, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), new THREE.Vector3(1, 1, 1)) },
    { geo: new THREE.TorusGeometry(0.07, 0.012, 5, 12, Math.PI * 1.5), matrix: new THREE.Matrix4().compose(new THREE.Vector3(0, 2.46, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.8)), new THREE.Vector3(1, 1, 1)) },
    { geo: new THREE.CylinderGeometry(0.011, 0.011, 1.1, 4), matrix: new THREE.Matrix4().makeTranslation(0, 3.08, 0) },
  ];
  carcassCache = { body: mergeGeos([{ geo: body, matrix: new THREE.Matrix4() }, ...legs]), bones: mergeGeos(bones), steel: mergeGeos(steel) };
  return carcassCache;
}

// fake volumetric light: an open cone, brightest at the bulb and along its axis
function shaftMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 1 } },
    vertexShader: `varying float vY; varying float vD; varying vec3 vN; varying vec3 vV;
      void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; uniform float opacity; varying float vY; varying float vD; varying vec3 vN; varying vec3 vV;
      void main(){ float e = abs(dot(normalize(vN), normalize(vV))); float a = pow(vY, 1.6) * pow(e, 1.5) * 0.085 * opacity * smoothstep(2.0, 6.0, vD); gl_FragColor = vec4(color, a); }`,
  });
}

export function buildMeatWorld(M, quality = 'medium') {
  const q = QUALITY[quality] || QUALITY.medium;
  setDetail(quality);
  const lite = quality === 'potato' || quality === 'low', high = quality === 'high';
  const R = rng(M.seed * 11 + 1);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.FogExp2(FOG, q.density * 1.3);
  const W = { scene, indoor: true, gens: [], cages: [], bars: [], gates: [], switches: [], genLights: [], gateLights: [], fogSprites: [], lamps: [], fogLayers: [], lampLights: [], shafts: [] };
  const { W: GW, H: GH, CS, X0, grid, roomOf } = M.cells;
  const walk = (i, j) => i >= 0 && j >= 0 && i < GW && j < GH && grid[j * GW + i] > 0;
  const cc = i => X0 + (i + 0.5) * CS;

  // ---------- lights ----------
  W.hemi = new THREE.HemisphereLight(0x9a8478, 0x1e0c08, 1.15); scene.add(W.hemi);
  W.amb = new THREE.AmbientLight(0x3a2622, 0.75); scene.add(W.amb);
  const top = new THREE.DirectionalLight(0xffe0d0, 0.45);
  top.position.set(8, 60, 5);
  if (q.shadow) {
    top.castShadow = true; top.shadow.mapSize.set(q.shadow, q.shadow);
    const s = top.shadow.camera; s.left = -30; s.right = 30; s.top = 30; s.bottom = -30; s.near = 5; s.far = 120;
    top.shadow.bias = -0.0006; top.shadow.normalBias = 0.04;
  }
  scene.add(top, top.target); W.moon = top;
  W.fill = new THREE.PointLight(0xffc8b0, 2.2, 12, 1.2); scene.add(W.fill);
  W.sky = new THREE.Object3D(); scene.add(W.sky);
  const nLights = { potato: 2, low: 4, medium: 8, high: 12 }[quality] ?? 6;
  for (let i = 0; i < nLights; i++) { const l = new THREE.PointLight(0xffc890, 0, 15, 1.5); scene.add(l); W.lampLights.push(l); }

  // ---------- floor & ceiling ----------
  const span = HALF * 2 + 24;
  const FT = floorTextures();
  for (const t of [FT.map, FT.normalMap, FT.roughnessMap]) t.repeat.set(span / 4, span / 4);
  const floorM = lite ? new THREE.MeshLambertMaterial({ map: FT.map })
    : new THREE.MeshStandardMaterial({ map: FT.map, normalMap: FT.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughnessMap: FT.roughnessMap, roughness: 1, metalness: 0.06 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(span, span), floorM);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const ct = ceilingTexture(); ct.repeat.set(span / 8, span / 8);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(span, span), new THREE.MeshLambertMaterial({ map: ct, color: 0x9a9088 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = M.ceiling; scene.add(ceil);

  // ---------- walls (world-space UVs) and the other static boxes ----------
  const groups = {}, walls = [];
  const add = (key, x, z, y0, y1, hx, hz, tile = 2) => { const h = y1 - y0; if (h <= 0.01) return; (groups[key] ||= []).push({ geo: boxGeo(hx * 2, h, hz * 2, tile), matrix: new THREE.Matrix4().makeTranslation(x, y0 + h / 2, z) }); };
  const addGeo = (key, geo, m) => (groups[key] ||= []).push({ geo, matrix: m });
  const cylGeo = (r, h, n = 14) => new THREE.CylinderGeometry(r, r, h, n);
  const wall = (x, z, hx, hz, y0, y1) => walls.push({ geo: wallBox(x, z, hx, hz, y0, y1, Math.floor(hash(x, z) * 8) / 8), matrix: new THREE.Matrix4() });
  for (const b of M.boxes) {
    switch (b.kind) {
      case 'gen': case 'switch': break;
      case 'sill': wall(b.x, b.z, b.hx, b.hz, 0, b.h); add('steel', b.x, b.z, b.h, b.h + 0.06, b.hx + 0.04, b.hz + 0.04); break;
      case 'table':
        add('steel', b.x, b.z, b.h - 0.06, b.h, b.hx, b.hz);
        add('steel', b.x, b.z, 0.22, 0.26, b.hx * 0.9, b.hz * 0.85);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) add('steel', b.x + sx * (b.hx - 0.08), b.z + sz * (b.hz - 0.08), 0, b.h - 0.06, 0.03, 0.03);
        add('gore', b.x + (R() - 0.5) * b.hx, b.z, b.h, b.h + 0.03, 0.25, Math.min(0.2, b.hz * 0.6));
        for (let k = 0; k < 3; k++) add(R() < 0.5 ? 'meat' : 'fat', b.x + (R() - 0.5) * b.hx * 1.5, b.z + (R() - 0.5) * b.hz, b.h, b.h + 0.06 + R() * 0.06, 0.08 + R() * 0.1, 0.06 + R() * 0.06);
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
        addGeo('steel', cylGeo(r, b.h, 20), new THREE.Matrix4().makeTranslation(b.x, b.h / 2, b.z));
        for (const y of [0.35, 0.75]) addGeo('rust', cylGeo(r * 1.02, 0.14, 20), new THREE.Matrix4().makeTranslation(b.x, b.h * y, b.z));
        addGeo('steel', cylGeo(0.12, M.ceiling - b.h, 8), new THREE.Matrix4().makeTranslation(b.x + r * 0.4, b.h + (M.ceiling - b.h) / 2, b.z));
        addGeo('dark', cylGeo(r * 0.85, 0.04, 20), new THREE.Matrix4().makeTranslation(b.x, b.h + 0.02, b.z));
        break;
      }
      case 'drum': addGeo('rust', cylGeo(Math.min(b.hx, b.hz), b.h, 14), new THREE.Matrix4().makeTranslation(b.x, b.h / 2, b.z)); break;
      case 'desk': add('wood', b.x, b.z, b.h - 0.05, b.h, b.hx, b.hz); for (const sx of [-1, 1]) add('wood', b.x + sx * (b.hx - 0.1), b.z, 0, b.h - 0.05, 0.05, b.hz - 0.05); add('wrap', b.x - 0.3, b.z, b.h, b.h + 0.02, 0.15, 0.2); break;
      case 'wall':
        if (b.style === 'rail') {
          const along = b.hx > b.hz, L = (along ? b.hx : b.hz);
          for (let o = -L; o <= L + 1e-6; o += 1.2) add('pipe', b.x + (along ? o : 0), b.z + (along ? 0 : o), 0, b.h, 0.05, 0.05);
          for (const y of [0.35, 0.7, 1.05]) add('pipe', b.x, b.z, y, y + 0.06, along ? b.hx : 0.035, along ? 0.035 : b.hz);
        } else wall(b.x, b.z, b.hx, b.hz, 0, b.h);
        break;
      default: wall(b.x, b.z, b.hx, b.hz, 0, b.h);
    }
  }
  for (const v of M.visual) if (v.type === 'lintel') wall(v.x, v.z, v.hx, v.hz, v.y0, M.ceiling);
  // ceiling beams and meat rails
  for (const r of M.rooms) {
    const x0 = X0 + r.x * CS, z0 = X0 + r.y * CS, w = r.w * CS, h = r.h * CS;
    if (w >= h) for (let x = x0 + 4; x < x0 + w - 0.5; x += 4) { add('beam', x, z0 + h / 2, M.ceiling - 0.4, M.ceiling, 0.1, h / 2); add('beam', x, z0 + h / 2, M.ceiling - 0.42, M.ceiling - 0.38, 0.2, h / 2); }
    else for (let z = z0 + 4; z < z0 + h - 0.5; z += 4) { add('beam', x0 + w / 2, z, M.ceiling - 0.4, M.ceiling, w / 2, 0.1); add('beam', x0 + w / 2, z, M.ceiling - 0.42, M.ceiling - 0.38, w / 2, 0.2); }
  }
  for (const [x1, z1, x2, z2] of M.rails) {
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2, alongX = Math.abs(x2 - x1) > Math.abs(z2 - z1), L = Math.hypot(x2 - x1, z2 - z1) / 2;
    add('steel', cx, cz, 4.6, 4.72, alongX ? L : 0.04, alongX ? 0.04 : L);
    add('steel', cx, cz, 4.66, 4.68, alongX ? L : 0.09, alongX ? 0.09 : L);
    for (let o = -L; o <= L + 1e-6; o += Math.max(1.5, L)) add('steel', cx + (alongX ? o : 0), cz + (alongX ? 0 : o), 4.72, M.ceiling, 0.035, 0.035);
  }

  // ---------- wall edges (for pipes, signs and wall blood) and doorways ----------
  const edges = [], doors = [];
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    if (!walk(i, j)) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cc(i) + dx * CS / 2, z = cc(j) + dz * CS / 2;
      if (!walk(i + dx, j + dz)) {
        if (M.gates.some(g => Math.abs(z - g.z) < 0.5 && Math.abs(x - g.x) < 2.6)) continue;
        edges.push({ i, j, x, z, nx: -dx, nz: -dz, room: roomOf[j * GW + i] });
      } else if (dx + dz > 0) {
        const a = roomOf[j * GW + i], b = roomOf[(j + dz) * GW + i + dx];
        if ((a >= 0) !== (b >= 0)) doors.push({ x, z, alongX: dz !== 0 });
      }
    }
  }
  // pipes: merged runs along each wall line, two lines of pipe with brackets
  const runs = new Map();
  for (const e of edges) { const key = `${e.nx},${e.nz},${e.nx ? e.x : e.z}`; (runs.get(key) || runs.set(key, []).get(key)).push(e); }
  for (const list of runs.values()) {
    const vert = !!list[0].nx; // wall runs along z
    list.sort((a, b) => (vert ? a.z - b.z : a.x - b.x));
    let s0 = null, prev = null;
    const flush = (a, b) => {
      const lo = (vert ? a.z : a.x) - CS / 2, hi = (vert ? b.z : b.x) + CS / 2, len = hi - lo; if (len < 7.9) return;
      const mid = (lo + hi) / 2, n = a;
      for (const [y, r, off, key] of [[4.12, 0.085, 0.33, 'pipe'], [4.42, 0.055, 0.29, 'pipe2']]) {
        const px = vert ? a.x + n.nx * off : mid, pz = vert ? mid : a.z + n.nz * off;
        addGeo(key, cylGeo(r, len - 0.2, 10), new THREE.Matrix4().compose(new THREE.Vector3(px, y, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(vert ? Math.PI / 2 : 0, 0, vert ? 0 : Math.PI / 2)), new THREE.Vector3(1, 1, 1)));
      }
      for (let o = lo + 1; o < hi - 0.5; o += 2) { const bx = vert ? a.x + n.nx * 0.27 : o, bz = vert ? o : a.z + n.nz * 0.27; add('dark', bx, bz, 4.02, 4.5, vert ? 0.09 : 0.025, vert ? 0.025 : 0.09); }
      // now and then a pipe drops to a valve near the floor
      if (R() < 0.35) { const o = lo + 1.5 + R() * (len - 3), vx = vert ? a.x + n.nx * 0.33 : o, vz = vert ? o : a.z + n.nz * 0.33; addGeo('pipe', cylGeo(0.05, 3.0, 8), new THREE.Matrix4().makeTranslation(vx, 2.6, vz)); addGeo('red', new THREE.TorusGeometry(0.13, 0.025, 6, 14), new THREE.Matrix4().compose(new THREE.Vector3(vx + n.nx * 0.08, 1.15, vz + n.nz * 0.08), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, vert ? Math.PI / 2 : 0, 0)), new THREE.Vector3(1, 1, 1))); }
    };
    for (const e of list) { if (prev && Math.abs((vert ? e.z - prev.z : e.x - prev.x) - CS) < 0.01) { prev = e; continue; } if (s0) flush(s0, prev); s0 = e; prev = e; }
    if (s0) flush(s0, prev);
  }
  // doorways between rooms and halls: steel frame, bulkhead, sometimes plastic strip curtains
  const druns = new Map();
  for (const d of doors) { const key = `${d.alongX ? 'x' : 'z'},${d.alongX ? d.z : d.x}`; (druns.get(key) || druns.set(key, []).get(key)).push(d); }
  const strips = [];
  for (const list of druns.values()) {
    const ax = list[0].alongX; list.sort((a, b) => (ax ? a.x - b.x : a.z - b.z));
    const groupsD = []; let cur = [list[0]];
    for (let k = 1; k < list.length; k++) { if (Math.abs((ax ? list[k].x - list[k - 1].x : list[k].z - list[k - 1].z) - CS) < 0.01) cur.push(list[k]); else { groupsD.push(cur); cur = [list[k]]; } }
    groupsD.push(cur);
    for (const gd of groupsD) {
      const a = gd[0], b = gd[gd.length - 1], lo = (ax ? a.x : a.z) - CS / 2, hi = (ax ? b.x : b.z) + CS / 2, mid = (lo + hi) / 2, fixed = ax ? a.z : a.x;
      const P = (o, y0, y1, hw, hd) => add('frame', ax ? o : fixed, ax ? fixed : o, y0, y1, ax ? hw : hd, ax ? hd : hw);
      P(lo + 0.1, 0, 4.4, 0.1, 0.16); P(hi - 0.1, 0, 4.4, 0.1, 0.16);
      wall(ax ? mid : fixed, ax ? fixed : mid, ax ? (hi - lo) / 2 : 0.22, ax ? 0.22 : (hi - lo) / 2, 4.4, M.ceiling);
      P(mid, 4.32, 4.42, (hi - lo) / 2, 0.18);
      if (R() < 0.45) for (let o = lo + 0.25; o < hi - 0.2; o += 0.24) {
        const g2 = new THREE.PlaneGeometry(0.26, 4.28); g2.translate(0, -2.14, 0);
        strips.push({ geo: g2, matrix: new THREE.Matrix4().compose(new THREE.Vector3(ax ? o : fixed, 4.32, ax ? fixed : o), new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * 0.06, (ax ? 0 : Math.PI / 2) + (R() - 0.5) * 0.25, 0)), new THREE.Vector3(1, 1, 1)) });
      }
    }
  }
  if (strips.length) {
    const sm = new THREE.MeshStandardMaterial({ color: 0xb8ccd0, transparent: true, opacity: 0.32, roughness: 0.15, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(mergeGeos(strips), sm); mesh.renderOrder = 3; scene.add(mesh);
  }

  // ---------- materials and merged meshes ----------
  const WT = wallTextures();
  const wallM = lite ? new THREE.MeshLambertMaterial({ map: WT.map })
    : new THREE.MeshStandardMaterial({ map: WT.map, normalMap: WT.normalMap, roughnessMap: WT.roughnessMap, roughness: 1, metalness: 0 });
  const wm = new THREE.Mesh(mergeGeos(walls), wallM); wm.castShadow = true; wm.receiveShadow = true; scene.add(wm);
  const styles = {
    steel: () => mat(0xa4a6a8, { map: 'metal', metal: 0.8, rough: 0.3 }), rust: () => mat(0x8a6a50, { map: 'metal', metal: 0.4, rough: 0.7 }),
    dark: () => mat(0x2a2624, { rough: 0.7, metal: 0.3 }), locker: () => mat(0x5a6e64, { map: 'metal', metal: 0.5, rough: 0.45 }),
    beam: () => mat(0x3a3634, { map: 'metal', metal: 0.6, rough: 0.6 }), wood: () => mat(0x6a4a30, { map: 'wood', rough: 0.9 }),
    meat: () => mat(0x8a1a12, { rough: 0.3 }), fat: () => mat(0xe0c8b0, { rough: 0.4 }), wrap: () => mat(0xd8d0c8, { rough: 0.35 }),
    gore: () => mat(0x4a0604, { rough: 0.12, emissive: 0x200000, ei: 0.6 }), frame: () => mat(0x8a8c8a, { map: 'metal', metal: 0.7, rough: 0.4 }),
    pipe: () => mat(0x3a5244, { map: 'metal', metal: 0.5, rough: 0.5 }), pipe2: () => mat(0x8a7a5a, { map: 'metal', metal: 0.6, rough: 0.45 }), red: () => mat(0xa01a10, { metal: 0.3, rough: 0.5 }),
  };
  for (const key in groups) {
    const mesh = new THREE.Mesh(mergeGeos(groups[key]), (styles[key] || styles.steel)());
    mesh.castShadow = key !== 'beam' && key !== 'pipe2'; mesh.receiveShadow = true; scene.add(mesh);
  }

  // ---------- carcasses (instanced: meat, bone, steel share the same transforms) ----------
  const carc = M.circles.filter(c => c.kind === 'carcass');
  if (carc.length) {
    const G = carcassGeos();
    const meatM = lite ? new THREE.MeshLambertMaterial({ map: meatTexture() })
      : high ? new THREE.MeshPhysicalMaterial({ map: meatTexture(), roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.35 })
      : new THREE.MeshStandardMaterial({ map: meatTexture(), roughness: 0.36 });
    const parts = [[G.body, meatM], [G.bones, mat(0xe0d4c0, { rough: 0.5 })], [G.steel, mat(0x9a9c9e, { metal: 0.8, rough: 0.3 })]];
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler(), mats4 = carc.map(c => { e.set((R() - 0.5) * 0.05, c.rot, (R() - 0.5) * 0.05); qq.setFromEuler(e); return m4.clone().compose(new THREE.Vector3(c.x, 4.62 - 3.63 * c.s, c.z), qq, new THREE.Vector3(c.s, c.s, c.s)); });
    for (const [geo, material] of parts) { const im = new THREE.InstancedMesh(geo, material, carc.length); mats4.forEach((mm, i) => im.setMatrixAt(i, mm)); im.castShadow = true; im.receiveShadow = true; scene.add(im); }
  }
  // ---------- tubs of offal ----------
  const tubs = M.circles.filter(c => c.kind === 'tub');
  if (tubs.length) {
    const tubGeo = mergeGeos([{ geo: new THREE.CylinderGeometry(0.38, 0.31, 0.78, 18, 1, true), matrix: new THREE.Matrix4().makeTranslation(0, 0.39, 0) }, { geo: new THREE.CircleGeometry(0.31, 18).rotateX(-Math.PI / 2), matrix: new THREE.Matrix4().makeTranslation(0, 0.02, 0) }, { geo: new THREE.TorusGeometry(0.38, 0.025, 6, 18).rotateX(Math.PI / 2), matrix: new THREE.Matrix4().makeTranslation(0, 0.78, 0) }]);
    const fill = new THREE.SphereGeometry(0.34, 12, 8); fill.scale(1, 0.25, 1);
    for (const blue of [false, true]) {
      const list = tubs.filter(t => !!t.blue === blue); if (!list.length) continue;
      const im = new THREE.InstancedMesh(tubGeo, new THREE.MeshStandardMaterial({ color: blue ? 0x2a58a0 : 0xd8dcd8, roughness: 0.45, side: THREE.DoubleSide }), list.length);
      const im2 = new THREE.InstancedMesh(fill, meatTexture ? new THREE.MeshStandardMaterial({ map: meatTexture(), roughness: 0.25 }) : null, list.length);
      list.forEach((t, i) => { const m = new THREE.Matrix4().compose(new THREE.Vector3(t.x, 0, t.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot), new THREE.Vector3(1, 1, 1)); im.setMatrixAt(i, m); im2.setMatrixAt(i, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.66, 0))); });
      im.castShadow = true; scene.add(im, im2);
    }
  }

  // ---------- decals: blood on floor and walls, drains ----------
  const atlas = tex('bloodatlas').map;
  const decalM = new THREE.MeshLambertMaterial({ map: atlas, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, color: 0x9a1a14, emissive: 0x1a0000 });
  const quad = cell => { const g2 = new THREE.PlaneGeometry(1, 1); const uv = g2.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5 + (cell % 2) * 0.5, uv.getY(i) * 0.5 + (cell > 1 ? 0 : 0.5)); return g2; };
  const floorSpots = [], wallSpots = [], drains = [];
  for (const c of carc) if (R() < 0.45) floorSpots.push([c.x + (R() - 0.5) * 0.6, c.z + (R() - 0.5) * 0.6, R.range(0.6, 1.4)]);
  for (const b of M.boxes) if (b.kind === 'table' || b.kind === 'tank') { floorSpots.push([b.x + (R() - 0.5) * 2, b.z + (R() - 0.5) * 2, R.range(1, 2.2)]); drains.push([b.x + (R() < 0.5 ? -1 : 1) * (b.hx + 0.8), b.z + (R() - 0.5)]); }
  for (const r of M.rooms) for (let k = 0; k < 3; k++) floorSpots.push([X0 + (r.x + R() * r.w) * CS, X0 + (r.y + R() * r.h) * CS, R.range(0.8, 2.6)]);
  for (const r of M.rooms) { const cx = X0 + (r.x + r.w / 2) * CS, cz = X0 + (r.y + r.h / 2) * CS; drains.push([cx + R.range(-2, 2), cz + R.range(-2, 2)]); }
  const roomEdges = edges.filter(e => e.room >= 0);
  for (let k = 0; k < Math.min(60, roomEdges.length); k++) { const e = R.pick(roomEdges); wallSpots.push(e); }
  for (let cell = 0; cell < 2; cell++) {
    const fl = floorSpots.filter((_, i) => i % 2 === cell), wl = wallSpots.filter((_, i) => i % 2 === cell);
    const imF = new THREE.InstancedMesh(quad(cell).rotateX(-Math.PI / 2), decalM, Math.max(1, fl.length));
    fl.forEach(([x, z, s], i) => imF.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, 0.012 + i * 0.0004, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.28), new THREE.Vector3(s, 1, s))));
    imF.count = fl.length; imF.renderOrder = 1; scene.add(imF);
    const imW = new THREE.InstancedMesh(quad(cell), decalM, Math.max(1, wl.length));
    wl.forEach((e, i) => { const s = R.range(0.8, 1.8), along = (R() - 0.5) * (CS - s); const yaw = Math.atan2(e.nx, e.nz);
      imW.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(e.x + e.nx * (0.205 + i * 0.0003) + (e.nx ? 0 : along), R.range(0.9, 2.2), e.z + e.nz * (0.205 + i * 0.0003) + (e.nz ? 0 : along)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, R() * 6.28)), new THREE.Vector3(s, s, 1))); });
    imW.count = wl.length; imW.renderOrder = 1; scene.add(imW);
  }
  if (drains.length) {
    const dm = new THREE.MeshStandardMaterial({ map: drainTexture(), transparent: true, roughness: 0.4, metalness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2), dm, drains.length);
    drains.forEach(([x, z], i) => im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 0.016, z)));
    im.renderOrder = 2; scene.add(im);
  }

  // ---------- enamel signs ----------
  const TEXTS = ['KILL FLOOR', 'HOLLOW PINES MEATWORKS', 'LINE 2', 'WASH YOUR HANDS', 'QUOTA: 400 HEAD / DAY', 'STAFF ONLY', 'THE LINE DOES NOT STOP', 'COLD STORE', 'NO TALKING ON THE FLOOR', 'SANITISE', 'OFFAL', 'HEADCOUNT MUST BE MAINTAINED'];
  const signGeo = new THREE.PlaneGeometry(1.5, 0.47);
  const usedRooms = new Set();
  for (const e of R.shuffle(roomEdges.slice())) {
    if (usedRooms.has(e.room) || usedRooms.size >= TEXTS.length) continue;
    usedRooms.add(e.room);
    const s = new THREE.Mesh(signGeo, new THREE.MeshStandardMaterial({ map: signTexture(TEXTS[usedRooms.size - 1], R.int(0, 3)), roughness: 0.35, metalness: 0.2 }));
    s.position.set(e.x + e.nx * 0.215, 2.85, e.z + e.nz * 0.215); s.rotation.y = Math.atan2(e.nx, e.nz);
    scene.add(s);
  }

  // ---------- lamps: industrial shades over the rooms, fluorescent tubes in the halls ----------
  const shadeM = mat(0x2a2826, { map: 'metal', metal: 0.6, rough: 0.5 });
  const poolTex = tex('glow').map;
  const shadeGeo = new THREE.ConeGeometry(0.42, 0.34, 16, 1, true), cordGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 4);
  const shaftGeo = new THREE.CylinderGeometry(0.32, 2.1, 1, 20, 1, true); shaftGeo.translate(0, -0.5, 0);
  for (const L of M.lamps) {
    const tube = !!L.hall && !L.red;
    const color = L.red ? 0xff3020 : tube ? 0xdfe6ff : 0xffc890;
    const g = new THREE.Group(); g.position.set(L.x, 0, L.z);
    const y = tube ? M.ceiling - 0.55 : M.ceiling - 1.3;
    const bulbM = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: color, emissiveIntensity: 3 });
    for (const o of tube ? [-0.5, 0.5] : [0]) { const cord = new THREE.Mesh(cordGeo, shadeM); cord.scale.y = M.ceiling - y; cord.position.set(o, (M.ceiling + y) / 2, 0); g.add(cord); }
    if (tube) {
      const house = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.07, 0.24), shadeM); house.position.y = y + 0.04; g.add(house);
      const t2 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 8), bulbM); t2.rotation.z = Math.PI / 2; t2.position.y = y - 0.01; g.add(t2);
      g.rotation.y = R() < 0.5 ? 0 : Math.PI / 2;
    } else {
      const shade = new THREE.Mesh(shadeGeo, shadeM); shade.position.y = y + 0.1; g.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), bulbM); bulb.position.y = y - 0.02; g.add(bulb);
    }
    const pool = new THREE.Mesh(new THREE.CircleGeometry(tube ? 3.4 : 4.2, 24), new THREE.MeshBasicMaterial({ map: poolTex, color, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.03; if (tube) pool.scale.x = 1.4; g.add(pool);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: poolTex, color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(tube ? 1.8 : 1.3, tube ? 0.5 : 1.3, 1); glow.position.y = y - 0.05; g.add(glow);
    let shaft = null;
    if (!lite) { shaft = new THREE.Mesh(shaftGeo, shaftMaterial(color)); shaft.scale.y = y; shaft.position.y = y; if (tube) shaft.scale.x = 1.3; g.add(shaft); }
    scene.add(g);
    W.lamps.push({ bulbM, pool, glow, shaft, light: null, ph: R() * 10, x: L.x, z: L.z, y: y - 0.2, color, dead: R() < 0.08 });
  }

  // ---------- EXIT signs ----------
  const sc = document.createElement('canvas'); sc.width = 256; sc.height = 96;
  const sx = sc.getContext('2d'); sx.fillStyle = '#1a0402'; sx.fillRect(0, 0, 256, 96); sx.fillStyle = '#ff3a20'; sx.font = 'bold 64px sans-serif'; sx.textAlign = 'center'; sx.fillText('EXIT', 128, 72);
  const signT = new THREE.CanvasTexture(sc); signT.colorSpace = THREE.SRGBColorSpace;
  for (const gt of M.gates) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), new THREE.MeshBasicMaterial({ map: signT, toneMapped: false }));
    s.position.set(gt.x, 4.4, gt.z - gt.dir * 0.8); s.rotation.y = gt.dir > 0 ? Math.PI : 0; scene.add(s);
  }

  // ---------- dust hanging in the air ----------
  if (quality !== 'potato') {
    const n = high ? 900 : lite ? 250 : 550, pos = new Float32Array(n * 3), base = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { base[i * 3] = R() * 24; base[i * 3 + 1] = 0.2 + R() * 4.4; base[i * 3 + 2] = R() * 24; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xd8c4b0, size: 0.03, transparent: true, opacity: 0.55, depthWrite: false, map: poolTex, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false; scene.add(pts);
    W.dust = { pts, base, pos };
  }

  addInteractables(W, M);
  return W;
}

// flicker the lamps, hand the light pool to the nearest ones, drift the dust
const _near = [];
export function updateMeatLights(W, follow, t) {
  const dk = W.darkK || 0;
  for (const L of W.lamps) {
    const fl = (L.dead ? (Math.sin(t * 23 + L.ph) > 0.6 ? 1 : 0.08) : Math.sin(t * 13 + L.ph) > 0.97 ? 0.3 : 1) * (1 - dk);
    L.fl = fl;
    L.bulbM.emissiveIntensity = 3 * fl; L.pool.material.opacity = 0.16 * fl; L.glow.material.opacity = 0.6 * fl;
    if (L.shaft) L.shaft.material.uniforms.opacity.value = fl;
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
  const D = W.dust;
  if (D) {
    const { base, pos } = D, n = pos.length / 3, fx = follow.x - 12, fz = follow.z - 12;
    for (let i = 0; i < n; i++) {
      const bx = base[i * 3] + Math.sin(t * 0.13 + i) * 0.8 + t * 0.05, bz = base[i * 3 + 2] + Math.cos(t * 0.11 + i * 1.7) * 0.8;
      pos[i * 3] = fx + (((bx - fx) % 24) + 24) % 24; pos[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.3 + i * 0.7) * 0.15; pos[i * 3 + 2] = fz + (((bz - fz) % 24) + 24) % 24;
    }
    D.pts.geometry.attributes.position.needsUpdate = true;
  }
}
