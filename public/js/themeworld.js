// Look and set dressing for the outdoor themes (woods, marsh, carnival, snow).
// LOOK drives the shared outdoor builder in world.js (sky, fog, light, ground palette, trees, grass);
// buildThemeExtras adds each theme's own scenery; updateThemeFx animates it.
import * as THREE from 'three';
import { HALF } from './config.js';
import { tex } from './textures.js';
import { mat, mergeGeos } from './models.js';

export const LOOK = {
  // Fortnight's island: broad daylight (the only map that isn't played at night)
  isle: { day: true, fog: 0xa9c4dc, density: 0.42, hemi: [0xd6e8ff, 0x5a5236, 2.3], amb: 0x8a96a8, moon: [0xfff0d4, 3.6], sky: [0x2f6fc4, 0x86b6e6], moonDisc: 0xfffbe8, halo: 0xffe8b0,
    ground: [0x5c7d34, 0x6f9040, 0x8a7350, 0x5e4a32, 0x6c5c3a, 0x3e5228], groundTex: 'ground2', ruins: false, trees: 'pine', bushes: 1, bush: 0x3e5a28, grass: 1, grassTint: 0xb8c878, lamp: 0xffd090, groundFog: 0xe0ecf8, groundFogK: 0.2 },
  woods: { fog: 0x1b2126, density: 1, hemi: [0x5e6878, 0x30261a, 1.75], amb: 0x2e3440, moon: [0xcad6f2, 2.7], sky: [0x04060b, 0x0e1520], moonDisc: 0xf2f4ff, halo: 0x9fb0d8,
    ground: [0x3d4a2c, 0x56603a, 0x5a4632, 0x3a2c20, 0x4a3a26, 0x2c2a1e], groundTex: 'ground2', ruins: true, trees: 'pine', bushes: 1, bush: 0x2a3420, grass: 1, grassTint: 0x9aa070, lamp: 0xffb060, groundFog: 0x6a7480, groundFogK: 1 },
  marsh: { fog: 0x161e14, density: 1.35, hemi: [0x5e7a62, 0x2a2414, 1.6], amb: 0x24302a, moon: [0xd0e8c0, 2.2], sky: [0x040805, 0x0e1a10], moonDisc: 0xe8f8d8, halo: 0x9ac890,
    ground: [0x2e3a22, 0x3e4a28, 0x3a3020, 0x221c12, 0x3a3420, 0x1e2216], groundTex: 'ground2', ruins: true, trees: 'cypress', bushes: 1.2, bush: 0x26341c, grass: 1.25, grassTint: 0x8a9a50, lamp: 0xe8d070, groundFog: 0x7a9a70, groundFogK: 2.4, particles: 'fireflies' },
  carnival: { fog: 0x1c1220, density: 1.1, hemi: [0x7a5a7a, 0x2a1a14, 1.6], amb: 0x2e2434, moon: [0xf0d0e0, 2.4], sky: [0x070410, 0x1a0e22], moonDisc: 0xffe8f0, halo: 0xd890b0,
    ground: [0x4a3a28, 0x5a4630, 0x2a2828, 0x3a2c20, 0x5a4a30, 0x2a221a], groundTex: 'ground2', ruins: false, trees: 'dead', bushes: 0.35, bush: 0x3a3420, grass: 0.35, grassTint: 0x8a8050, lamp: 0xffd080, groundFog: 0x8a6a8a, groundFogK: 1.2 },
  granny: { fog: 0x161a1e, density: 1.15, hemi: [0x5a6470, 0x2a2018, 1.6], amb: 0x2a3038, moon: [0xc0cce0, 2.4], sky: [0x030407, 0x0c1118], moonDisc: 0xeef2ff, halo: 0x8a9ab8,
    ground: [0x343c26, 0x4a5232, 0x4e3e2c, 0x30261a, 0x3e3222, 0x262418], groundTex: 'ground2', ruins: false, trees: 'dead', bushes: 0.5, bush: 0x262e1c, grass: 0.8, grassTint: 0x8a9060, lamp: 0xffa850, groundFog: 0x5a6470, groundFogK: 1.4 },
  snow: { fog: 0x222c3a, density: 0.95, hemi: [0x8aa0c4, 0x2a3240, 1.45], amb: 0x2e3648, moon: [0xc8d8f4, 2.3], sky: [0x03060e, 0x0e1a30], moonDisc: 0xf4f8ff, halo: 0xa8c0e8,
    ground: [0xc8d2e0, 0xdde4f0, 0x9aa2ae, 0xb0bac8, 0xc0c8d4, 0x9aa4b4], groundTex: 'snow', ruins: false, snowcaps: true, trees: 'snowpine', bushes: 0.4, bush: 0xb8c4d0, grass: 0, grassTint: 0x8a8a70, lamp: 0xffc070, groundFog: 0xc8d8f0, groundFogK: 1.6, particles: 'snow' },
};

const M4 = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const col = h => new THREE.Color(h);

// bald cypress: buttressed trunk, flat crowns, Spanish moss hanging off the branches
let cyp = null;
export function cypressGeos() {
  if (cyp) return cyp;
  const prof = [[0.95, 0], [0.55, 0.4], [0.34, 1.2], [0.26, 3], [0.2, 6.5], [0.12, 10.5], [0.03, 11]].map(([r, y]) => new THREE.Vector2(r, y));
  const trunk = new THREE.LatheGeometry(prof, 10);
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < 1.2) { const a = Math.atan2(p.getZ(i), p.getX(i)), k = 1 + Math.max(0, Math.sin(a * 5)) * (1.2 - y) * 0.6; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } }
  trunk.computeVertexNormals();
  const leaves = [], moss = [];
  // ragged crown: many small lumpy tufts around a few branches rather than flat discs
  const clumps = [[0, 10.6, 0, 1.5], [1.6, 9.4, 0.7, 1.25], [-1.5, 8.8, -0.9, 1.2], [0.7, 7.8, -1.6, 1.1], [-0.9, 7.2, 1.4, 1.0], [1.9, 8.2, -0.6, 0.9], [-1.8, 9.9, 0.8, 0.9]];
  let sd = 3; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  for (const [x, y, z, r] of clumps) {
    for (let k = 0; k < 4; k++) {
      const g = new THREE.IcosahedronGeometry(r * (0.55 + rnd() * 0.35), 1); g.scale(1, 0.6, 1);
      const p2 = g.attributes.position; for (let i = 0; i < p2.count; i++) { const f = 0.8 + rnd() * 0.4; p2.setXYZ(i, p2.getX(i) * f, p2.getY(i) * (0.7 + rnd() * 0.6), p2.getZ(i) * f); }
      g.computeVertexNormals();
      leaves.push({ geo: g, matrix: M4(x + (rnd() - 0.5) * r * 1.2, y + (rnd() - 0.5) * 0.5, z + (rnd() - 0.5) * r * 1.2), color: new THREE.Color(0.06 + rnd() * 0.03, 0.08 + rnd() * 0.03, 0.035) });
    }
    leaves.push({ geo: new THREE.CylinderGeometry(0.06, 0.1, Math.hypot(x, z) + 0.3, 5), matrix: M4(x / 2, y - 0.3, z / 2, 0, -Math.atan2(z, x), Math.PI / 2), color: new THREE.Color(0.12, 0.1, 0.08) });
    for (let k = 0; k < 6; k++) { const a = k * 1.05, rr = r * 0.75, len = 1.4 + (k % 3) * 0.8; const pg = new THREE.PlaneGeometry(0.22, len); pg.translate(0, -len / 2, 0); moss.push({ geo: pg, matrix: M4(x + Math.cos(a) * rr, y - 0.2, z + Math.sin(a) * rr, 0, a, 0) }); }
  }
  cyp = { trunk, leaves: mergeGeos(leaves), moss: mergeGeos(moss) };
  return cyp;
}

// snow settles on the upward-facing parts of a tree
export function snowify(geo) {
  const g = geo.clone(); g.computeVertexNormals();
  const n = g.attributes.normal, c = g.attributes.color, white = new THREE.Color(0.86, 0.9, 0.96), tmp = new THREE.Color();
  if (!c) return g;
  for (let i = 0; i < n.count; i++) { const up = n.getY(i), k = Math.max(0, Math.min(1, (up - 0.15) / 0.55)); tmp.setRGB(c.getX(i), c.getY(i), c.getZ(i)).lerp(white, k * 0.92); c.setXYZ(i, tmp.r, tmp.g, tmp.b); }
  return g;
}

// creepy clown face for the funhouse
let clownTex = null;
function clownTexture() {
  if (clownTex) return clownTex;
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#e8e0d0'; x.beginPath(); x.arc(128, 128, 120, 0, 7); x.fill();
  x.fillStyle = '#c01818'; for (const [cx, cy] of [[30, 70], [226, 70]]) { x.beginPath(); x.arc(cx, cy, 40, 0, 7); x.fill(); }
  x.fillStyle = '#111'; for (const s of [-1, 1]) { x.beginPath(); x.ellipse(128 + s * 44, 100, 20, 28, 0, 0, 7); x.fill(); }
  x.fillStyle = '#d02020'; x.beginPath(); x.arc(128, 140, 18, 0, 7); x.fill();
  x.strokeStyle = '#a01010'; x.lineWidth = 14; x.beginPath(); x.arc(128, 150, 64, 0.15, Math.PI - 0.15); x.stroke();
  x.fillStyle = '#f0e8d8'; for (let i = 0; i < 9; i++) { const a = 0.35 + i * 0.3; x.beginPath(); x.moveTo(128 + Math.cos(a) * 58, 150 + Math.sin(a) * 58); x.lineTo(128 + Math.cos(a + 0.12) * 70, 150 + Math.sin(a + 0.12) * 70); x.lineTo(128 + Math.cos(a + 0.24) * 58, 150 + Math.sin(a + 0.24) * 58); x.fill(); }
  for (let i = 0; i < 30; i++) { x.fillStyle = `rgba(70,40,20,${Math.random() * 0.4})`; x.beginPath(); x.arc(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 16, 0, 7); x.fill(); }
  clownTex = new THREE.CanvasTexture(c); clownTex.colorSpace = THREE.SRGBColorSpace;
  return clownTex;
}

function particles(scene, n, color, size, opacity, R, h0, h1) {
  const pos = new Float32Array(n * 3), base = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { base[i * 3] = R() * 40; base[i * 3 + 1] = h0 + R() * (h1 - h0); base[i * 3 + 2] = R() * 40; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, transparent: true, opacity, depthWrite: false, map: tex('glow').map, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false; scene.add(pts);
  return { pts, pos, base, n };
}

export function buildThemeExtras(W, M, quality, R) {
  const scene = W.scene, lite = quality === 'potato' || quality === 'low', LK = W.look;
  const groups = {};
  const add = (key, geo, m, color) => (groups[key] ||= []).push({ geo, matrix: m, color });
  const box = (key, x, y, z, w, h, d, ry = 0) => add(key, new THREE.BoxGeometry(w, h, d), M4(x, y, z, 0, ry, 0));
  const cyl = (key, x, y, z, r1, r2, h, n = 12, rx = 0, rz = 0) => add(key, new THREE.CylinderGeometry(r1, r2, h, n), M4(x, y, z, rx, 0, rz));
  W.fx = { bulbs: [], snow: null, flies: null };

  // ---------- marsh: black water, reeds, decks ----------
  if (M.pools.length) {
    const waterM = lite ? new THREE.MeshLambertMaterial({ color: 0x14221c }) : new THREE.MeshPhongMaterial({ color: 0x101c16, specular: 0x9ab8a0, shininess: 110, emissive: 0x060c09, transparent: true, opacity: 0.93 });
    const wg = [], mud = [], reeds = [], pads = [];
    for (const p of M.pools) {
      const g = new THREE.CircleGeometry(p.r, 28); g.rotateX(-Math.PI / 2); wg.push({ geo: g, matrix: M4(p.x, 0.035, p.z) });
      const rg = new THREE.RingGeometry(p.r * 0.92, p.r + 0.7, 28); rg.rotateX(-Math.PI / 2); mud.push({ geo: rg, matrix: M4(p.x, 0.03, p.z) });
      const n = Math.round(p.r * 7);
      for (let k = 0; k < n; k++) { const a = R() * 6.28, d = p.r * (0.85 + R() * 0.35); reeds.push(M4(p.x + Math.cos(a) * d, 0.7, p.z + Math.sin(a) * d, (R() - 0.5) * 0.25, R() * 6, (R() - 0.5) * 0.25, 1, 0.7 + R() * 0.7, 1)); }
      for (let k = 0; k < Math.round(p.r); k++) { const a = R() * 6.28, d = R() * p.r * 0.8; pads.push(M4(p.x + Math.cos(a) * d, 0.045, p.z + Math.sin(a) * d, 0, R() * 6, 0, 0.6 + R() * 0.6, 1, 0.6 + R() * 0.6)); }
    }
    scene.add(new THREE.Mesh(mergeGeos(mud), new THREE.MeshLambertMaterial({ color: 0x1c180e })));
    const water = new THREE.Mesh(mergeGeos(wg), waterM); water.receiveShadow = true; scene.add(water);
    const reedGeo = new THREE.ConeGeometry(0.03, 1.4, 4); const rim = new THREE.InstancedMesh(reedGeo, new THREE.MeshLambertMaterial({ color: 0x5a6a30 }), reeds.length); reeds.forEach((m, i) => rim.setMatrixAt(i, m)); scene.add(rim);
    const padGeo = new THREE.CircleGeometry(0.28, 10, 0.4, 5.6); padGeo.rotateX(-Math.PI / 2);
    const pim = new THREE.InstancedMesh(padGeo, new THREE.MeshLambertMaterial({ color: 0x2e4a1e }), Math.max(1, pads.length)); pads.forEach((m, i) => pim.setMatrixAt(i, m)); pim.count = pads.length; scene.add(pim);
  }
  for (const v of M.visual) {
    if (v.type === 'deck') {
      const w = v.x1 - v.x0, d = v.z1 - v.z0, alongX = w >= d;
      for (let o = 0; o < (alongX ? d : w); o += 0.32) {
        if (alongX) box('plank', (v.x0 + v.x1) / 2, 0.02, v.z0 + o + 0.15, w, 0.06, 0.29); else box('plank', v.x0 + o + 0.15, 0.02, (v.z0 + v.z1) / 2, 0.29, 0.06, d);
      }
      for (const [x, z] of [[v.x0, v.z0], [v.x1, v.z0], [v.x0, v.z1], [v.x1, v.z1]]) cyl('post', x, 0.35, z, 0.1, 0.12, 0.7, 8);
    } else if (v.type === 'boat') {
      for (let o = v.z0 + 0.4; o < v.z1; o += 0.9) box('plank', (v.x0 + v.x1) / 2, 0.25, o, v.x1 - v.x0 - 0.6, 0.05, 0.25);
    } else if (v.type === 'ice') {
      const g = new THREE.CircleGeometry(v.r, 40); g.rotateX(-Math.PI / 2);
      const ice = new THREE.Mesh(g, lite ? new THREE.MeshLambertMaterial({ color: 0x9ab8d0 }) : new THREE.MeshStandardMaterial({ color: 0x90b4d4, roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.92 }));
      ice.position.set(v.x, 0.03, v.z); ice.receiveShadow = true; scene.add(ice);
      const cr = new THREE.Group();
      for (let k = 0; k < 9; k++) { const a = R() * 6.28, len = R() * v.r * 0.8 + 1; const c = new THREE.Mesh(new THREE.PlaneGeometry(0.05, len), new THREE.MeshBasicMaterial({ color: 0xe0f0ff, transparent: true, opacity: 0.5 })); c.rotation.set(-Math.PI / 2, 0, a); c.position.set(v.x + Math.cos(a) * len * 0.4, 0.04, v.z + Math.sin(a) * len * 0.4); cr.add(c); }
      scene.add(cr);
      const rg = new THREE.RingGeometry(v.r, v.r + 0.9, 40); rg.rotateX(-Math.PI / 2); const ring = new THREE.Mesh(rg, mat(0xe8eef8, { map: 'snow' })); ring.position.set(v.x, 0.035, v.z); scene.add(ring);
    } else if (v.type === 'bigtop') {
      const roof = new THREE.ConeGeometry(v.r + 0.4, 4.8, 24, 1, true); const t = tex('canvas').map.clone(); t.needsUpdate = true; t.repeat.set(3, 1);
      const m = new THREE.Mesh(roof, new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.95 })); m.position.set(v.x, 3.2 + 2.4, v.z); m.castShadow = true; scene.add(m);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshLambertMaterial({ color: 0xc01818, side: THREE.DoubleSide })); flag.position.set(v.x + 0.45, 8.6, v.z); scene.add(flag);
      cyl('pole', v.x, 4.5, v.z, 0.18, 0.22, 9, 10);
      for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283; W.fx.bulbs.push([v.x + Math.cos(a) * (v.r + 0.3), 3.25, v.z + Math.sin(a) * (v.r + 0.3), k]); }
    } else if (v.type === 'awning') {
      const t = tex('canvas').map.clone(); t.needsUpdate = true; t.repeat.set(Math.max(1, Math.round((v.x1 - v.x0 + v.z1 - v.z0) / 3)), 1);
      const a = new THREE.Mesh(new THREE.BoxGeometry(v.x1 - v.x0, 0.08, v.z1 - v.z0), new THREE.MeshLambertMaterial({ map: t, color: v.color })); a.position.set((v.x0 + v.x1) / 2, 2.55, (v.z0 + v.z1) / 2); a.castShadow = true; scene.add(a);
    } else if (v.type === 'carousel') {
      const platform = new THREE.Mesh(new THREE.CylinderGeometry(4.7, 4.8, 0.12, 32), mat(0x6a4a30, { map: 'wood' })); platform.position.set(v.x, 0.06, v.z); platform.receiveShadow = true; scene.add(platform);
      const t = tex('canvas').map.clone(); t.needsUpdate = true; t.repeat.set(4, 1);
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(5.2, 1.8, 24, 1, true), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.9 })); canopy.position.set(v.x, 5.1, v.z); scene.add(canopy);
      const rimC = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 0.55, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xc8a040, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide })); rimC.position.set(v.x, 4.0, v.z); scene.add(rimC);
      for (let k = 0; k < 32; k++) { const a = k / 32 * 6.283; W.fx.bulbs.push([v.x + Math.cos(a) * 5.25, 4.0, v.z + Math.sin(a) * 5.25, k]); }
    } else if (v.type === 'ferris') {
      const g = new THREE.Group(); g.position.set(v.x, 0, v.z); if (v.along === 'z') g.rotation.y = Math.PI / 2;
      const steel = mat(0xb8b0a0, { map: 'metal', metal: 0.6, rough: 0.5 });
      const H = 10.5, Rw = 8.5;
      for (const s of [-0.7, 0.7]) { const rimT = new THREE.Mesh(new THREE.TorusGeometry(Rw, 0.12, 6, 48), steel); rimT.position.set(0, H, s); g.add(rimT); for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283; const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, Rw, 5), steel); sp.position.set(Math.cos(a) * Rw / 2, H + Math.sin(a) * Rw / 2, s); sp.rotation.z = a - Math.PI / 2; g.add(sp); } }
      for (const sx of [-1, 1]) for (const s of [-1.3, 1.3]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, Math.hypot(H, 3.2), 6), steel); leg.position.set(sx * 1.6, H / 2, s); leg.rotation.z = sx * Math.atan2(3.2, H); g.add(leg); }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.0, 12), steel); hub.rotation.x = Math.PI / 2; hub.position.y = H; g.add(hub);
      const cabin = mat(0x2a6a8a, { map: 'metal', metal: 0.4, rough: 0.6 });
      for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283 + 0.26; const c = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 1.1), k % 3 === 0 ? mat(0xb02020, { map: 'metal', metal: 0.4 }) : cabin); c.position.set(Math.cos(a) * Rw, H + Math.sin(a) * Rw - 0.7, 0); c.rotation.z = (k % 4 ? 0.06 : -0.12); c.castShadow = true; g.add(c); }
      scene.add(g);
      g.updateMatrixWorld(true);
      for (let k = 0; k < 36; k++) { const a = k / 36 * 6.283, p = new THREE.Vector3(Math.cos(a) * Rw, H + Math.sin(a) * Rw, 0.75).applyMatrix4(g.matrixWorld); W.fx.bulbs.push([p.x, p.y, p.z, k]); }
    } else if (v.type === 'clown') {
      const f = new THREE.Mesh(new THREE.CircleGeometry(1.15, 28), new THREE.MeshLambertMaterial({ map: clownTexture(), emissive: 0x200808 }));
      const dx = v.face[0] - v.x, dz = v.face[1] - v.z, L = Math.hypot(dx, dz) || 1;
      f.position.set(v.x + dx / L * 0.25, 1.9, v.z + dz / L * 0.25); f.rotation.y = Math.atan2(dx, dz); scene.add(f);
    }
  }
  // ---------- props ----------
  for (const p of M.props) {
    const s = p.s || 1;
    switch (p.prop) {
      case 'barrel': cyl('barrel', p.x, 0.5, p.z, 0.4, 0.42, 1.0, 14); cyl('hoop', p.x, 0.2, p.z, 0.43, 0.43, 0.06); cyl('hoop', p.x, 0.8, p.z, 0.43, 0.43, 0.06); break;
      case 'crate': box('crate', p.x, 0.55, p.z, 1.0, 1.1, 1.0, p.rot); break;
      case 'cart': box('cartbody', p.x, 0.6, p.z, 1.1, 0.8, 0.7, p.rot); box('glass', p.x, 1.25, p.z, 0.9, 0.55, 0.55, p.rot); box('stripe', p.x, 1.62, p.z, 1.2, 0.1, 0.8, p.rot); for (const sx of [-0.45, 0.45]) cyl('tyre', p.x + Math.cos(p.rot) * sx, 0.22, p.z - Math.sin(p.rot) * sx, 0.22, 0.22, 0.08, 12, Math.PI / 2, 0); break;
      case 'tentpole': break;
      case 'pole': cyl('pole', p.x, 3, p.z, 0.08, 0.11, 6, 8); box('pole', p.x, 5.8, p.z, 0.9, 0.08, 0.08); break;
      case 'carouselcore': cyl('gold', p.x, 2.1, p.z, 0.85, 0.85, 4.2, 18); cyl('mirror', p.x, 2.1, p.z, 0.87, 0.87, 1.4, 18); break;
      case 'horse': {
        cyl('gold', p.x, 2.1, p.z, 0.035, 0.035, 4.0, 6);
        const yaw = -(p.rot || 0), hx = p.x, hz = p.z;
        add('horse', new THREE.BoxGeometry(0.28, 0.32, 0.95), M4(hx, 1.25, hz, 0, yaw, 0));
        add('horse', new THREE.BoxGeometry(0.2, 0.42, 0.22), M4(hx + Math.sin(yaw) * 0.45, 1.55, hz + Math.cos(yaw) * 0.45, 0.4, yaw, 0));
        for (const [ox, oz] of [[0.1, 0.35], [-0.1, 0.35], [0.1, -0.35], [-0.1, -0.35]]) add('horse', new THREE.BoxGeometry(0.06, 0.5, 0.06), M4(hx + Math.cos(yaw) * ox + Math.sin(yaw) * oz, 0.95, hz - Math.sin(yaw) * ox + Math.cos(yaw) * oz, oz > 0 ? -0.5 : 0.5, yaw, 0));
        break;
      }
    }
  }
  // ---------- snow: log piles, the truck ----------
  for (const b of M.boxes) {
    if (b.kind === 'logpile') {
      const along = b.hx > b.hz, L = (along ? b.hx : b.hz) * 2;
      for (let row = 0; row < 4; row++) for (let k = 0; k < 4 - row; k++) { const o = (k - (3 - row) / 2) * 0.34, y = 0.17 + row * 0.3; add('log', new THREE.CylinderGeometry(0.17, 0.17, L, 9), M4(b.x + (along ? 0 : o), y, b.z + (along ? o : 0), along ? 0 : Math.PI / 2, 0, along ? Math.PI / 2 : 0)); }
    } else if (b.kind === 'truck') {
      const along = b.hx > b.hz;
      for (const s1 of [-1, 1]) for (const s2 of [-0.6, 0.6]) add('tyre', new THREE.CylinderGeometry(0.45, 0.45, 0.3, 14), M4(b.x + (along ? s2 * b.hx * 1.2 : s1 * (b.hx + 0.1)), 0.45, b.z + (along ? s1 * (b.hz + 0.1) : s2 * b.hz * 1.2), along ? Math.PI / 2 : 0, 0, along ? 0 : Math.PI / 2));
      box('glass', b.x + (along ? b.hx * 0.6 : 0), b.h - 0.5, b.z + (along ? 0 : b.hz * 0.6), along ? 0.06 : b.hx * 1.6, 0.5, along ? b.hz * 1.6 : 0.06);
    }
  }
  const MATS = {
    plank: () => mat(0x9a8a70, { map: 'boards', rough: 0.95 }), post: () => mat(0x4a3a2a, { map: 'bark' }), pole: () => mat(0x3a3430, { map: 'metal', metal: 0.5, rough: 0.6 }),
    barrel: () => mat(0x8a2a1a, { map: 'metal', metal: 0.3, rough: 0.6 }), hoop: () => mat(0x3a3a38, { metal: 0.7, rough: 0.4 }), crate: () => mat(0xb09a80, { map: 'wood' }),
    cartbody: () => mat(0xc02020, { metal: 0.3, rough: 0.5 }), glass: () => new THREE.MeshStandardMaterial({ color: 0x8aa0a8, roughness: 0.05, metalness: 0.5, transparent: true, opacity: 0.45 }),
    stripe: () => mat(0xe8d8b0, { map: 'canvas' }), tyre: () => mat(0x141414, { rough: 0.9 }), gold: () => mat(0xc8a040, { metal: 0.85, rough: 0.3 }),
    mirror: () => new THREE.MeshStandardMaterial({ color: 0xd8d8e0, roughness: 0.05, metalness: 1 }), horse: () => mat(0xe8e0d0, { rough: 0.4 }), log: () => mat(0x8a6a4a, { map: 'bark', rough: 1 }),
  };
  for (const k in groups) { const m = new THREE.Mesh(mergeGeos(groups[k]), (MATS[k] || MATS.crate)()); m.castShadow = k !== 'glass'; m.receiveShadow = true; scene.add(m); }

  // ---------- carnival string lights ----------
  const palette = [0xff3020, 0xffd040, 0x40ff60, 0x4080ff, 0xfff0d0];
  for (const { a, b } of M.lights) {
    const pts = [];
    for (let k = 0; k <= 16; k++) { const f = k / 16, x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f, y = 5.75 - Math.sin(f * Math.PI) * 1.3; pts.push(new THREE.Vector3(x, y, z)); if (k > 0 && k < 16) W.fx.bulbs.push([x, y - 0.08, z, k + Math.round(a.x)]); }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x111111 })));
  }
  if (W.fx.bulbs.length) {
    const sets = palette.map(() => []);
    W.fx.bulbs.forEach(([x, y, z, k], i) => sets[(k + i) % palette.length].push([x, y, z, i]));
    W.fx.bulbSets = sets.map((list, c) => {
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(palette[c]).multiplyScalar(3), toneMapped: false });
      const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 4), m, Math.max(1, list.length));
      list.forEach(([x, y, z], i) => im.setMatrixAt(i, M4(x, y, z))); im.count = list.length; scene.add(im);
      return { m, base: new THREE.Color(palette[c]).multiplyScalar(3) };
    });
  }

  // ---------- particles ----------
  if (LK.particles === 'snow' && quality !== 'potato') W.fx.snow = particles(scene, lite ? 600 : 1600, 0xf0f4ff, 0.06, 0.8, R, 0, 14);
  if (LK.particles === 'fireflies' && quality !== 'potato') W.fx.flies = particles(scene, lite ? 60 : 160, 0xd8ff70, 0.07, 0.9, R, 0.3, 3.2);
}

export function updateThemeFx(W, t, dt, follow) {
  const F = W.fx; if (!F) return;
  const dk = W.darkK || 0;
  if (F.bulbSets) F.bulbSets.forEach((s, i) => { const on = (Math.sin(t * 2.2 + i * 1.3) > -0.6 ? 1 : 0.35) * (1 - dk * 0.92); s.m.color.copy(s.base).multiplyScalar(on); });
  const wrap = (P, fn) => {
    if (!P || !follow) return;
    const { pos, base, n } = P, fx = follow.x - 20, fz = follow.z - 20;
    for (let i = 0; i < n; i++) { const [x, y, z] = fn(base[i * 3], base[i * 3 + 1], base[i * 3 + 2], i); pos[i * 3] = fx + (((x - fx) % 40) + 40) % 40; pos[i * 3 + 1] = y; pos[i * 3 + 2] = fz + (((z - fz) % 40) + 40) % 40; }
    P.pts.geometry.attributes.position.needsUpdate = true;
  };
  wrap(F.snow, (x, y, z, i) => [x + Math.sin(t * 0.6 + i) * 0.6 + t * 0.4, ((y - t * (0.9 + (i % 5) * 0.12)) % 14 + 14) % 14, z + Math.cos(t * 0.5 + i * 0.7) * 0.6]);
  wrap(F.flies, (x, y, z, i) => [x + Math.sin(t * 0.3 + i * 1.7) * 2, y + Math.sin(t * 0.8 + i) * 0.4, z + Math.cos(t * 0.25 + i * 2.3) * 2]);
  if (F.flies) F.flies.pts.material.opacity = (0.55 + Math.sin(t * 3.1) * 0.35) * (1 - dk * 0.5);
}
