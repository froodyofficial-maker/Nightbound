// Static (unrigged) models from GLB files, normalised to a size and cloned per use:
//  - slimer: "Ghostbuster's Slimer" by Nom (sketchfab.com/nomthewise), CC BY 4.0
//  - axe: "Fire Axe" by denis_cliofas (sketchfab.com/denis_cliofas), CC BY 4.0
//  - ghosttrap: "HW Detail #4 GHOST TRAP" by Kirumba86 (sketchfab.com/MorisKirumba86), CC BY 4.0
//  - beartrap: "Granny bear trap" by Eri Game Dev (sketchfab.com/blerko0178), CC BY 4.0; its clip snaps the jaws shut
//  - taser: "Taser Gun" by Mati236 (sketchfab.com/chenjunliu6), CC BY 4.0
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// name -> how to normalise it: target size along an axis, where its origin goes
const SPEC = {
  slimer: { size: 1.55, axis: 'y', origin: 'center' },
  axe: { size: 0.82, axis: 'max', origin: 'center' },
  ghosttrap: { size: 0.5, axis: 'x', origin: 'bottom' },
  beartrap: { size: 0.62, axis: 'max', origin: 'bottom' },
  taser: { size: 0.2, axis: 'max', origin: 'center' },
};
const tpl = {}, loading = {}, waiters = {};

async function bytes(name) {
  const el = document.getElementById('nb-' + name + '-glb');
  if (el && el.textContent.trim()) { const s = atob(el.textContent.trim()), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.buffer; }
  const dev = !!document.querySelector('script[type=importmap]');
  let last;
  for (const url of dev ? [`models/${name}.glb`, `public/models/${name}.glb`] : [`public/models/${name}.glb`, `models/${name}.glb`]) {
    try { const r = await fetch(url); if (r.ok) return await r.arrayBuffer(); last = new Error(url + ' ' + r.status); } catch (e) { last = e; }
  }
  throw last;
}

export function loadStatic(name) {
  if (loading[name]) return loading[name];
  loading[name] = bytes(name).then(buf => new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej))).then(g => {
    const S = SPEC[name], inner = g.scene;
    inner.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inner), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const len = S.axis === 'max' ? Math.max(size.x, size.y, size.z) : size[S.axis];
    const k = S.size / len;
    const root = new THREE.Group(); root.add(inner);
    inner.scale.multiplyScalar(k);
    inner.position.set(-c.x * k, S.origin === 'bottom' ? -box.min.y * k : -c.y * k, -c.z * k);
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    root.userData.anims = g.animations || [];
    tpl[name] = root;
    for (const cb of (waiters[name] || []).splice(0)) { try { cb(); } catch (e) { console.error(e); } }
    return root;
  }).catch(e => { console.warn(name + ' model unavailable:', e); return null; });
  return loading[name];
}
export const staticReady = name => !!tpl[name];
export function onStaticReady(name, cb) { if (tpl[name]) cb(); else (waiters[name] ||= []).push(cb); }

// a fresh copy; tint = { color, k, emissive, ei } recolours every material
export function cloneStatic(name, tint) {
  if (!tpl[name]) return null;
  const o = tpl[name].clone(true);
  o.userData = { ...tpl[name].userData };
  o.traverse(m => {
    if (!m.isMesh) return;
    m.material = Array.isArray(m.material) ? m.material.map(x => x.clone()) : m.material.clone();
    if (tint) for (const mt of [].concat(m.material)) {
      if (tint.color != null && mt.color) mt.color.lerp(new THREE.Color(tint.color), tint.k ?? 0.6);
      if (tint.emissive != null && 'emissive' in mt) { mt.emissive = new THREE.Color(tint.emissive); mt.emissiveIntensity = tint.ei ?? 0.5; }
    }
  });
  return o;
}

// ---------------- The Slimer as a killer rig ----------------
const auraMats = new Map();
function auraMat(color) {
  if (!auraMats.has(color)) auraMats.set(color, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide }));
  return auraMats.get(color);
}
class StaticKiller {
  constructor(name, sk) {
    this.kind = 'killer'; this.killer = name; this.staticGlb = true; this.float = true;
    this.root = new THREE.Group(); this.body = new THREE.Group(); this.root.add(this.body);
    this.t = Math.random() * 10; this.meshes = []; this.aura = [];
    const tint = sk && sk.tintGlb;
    const model = cloneStatic(name, tint);
    model.position.y = 0.95; // he floats at chest height of a person
    this.body.add(model);
    model.traverse(o => { if (o.isMesh) { this.meshes.push(o); o.frustumCulled = false; } });
    for (const m of this.meshes) { const a = new THREE.Mesh(m.geometry, auraMat(0xffffff)); a.visible = false; a.renderOrder = 10; a.scale.setScalar(1.04); m.add(a); this.aura.push(a); }
    this.j = { head: model, spine: model, handR: model, handL: model, hips: model };
  }
  setAura(color) { for (const a of this.aura) { if (color == null) a.visible = false; else { a.visible = true; a.material = auraMat(color); } } }
  setOpacity(o) {
    for (const m of this.meshes) for (const mt of [].concat(m.material)) { mt.transparent = o < 0.999 || mt.userData.wasT; mt.userData.wasT ??= mt.transparent; mt.opacity = o; mt.depthWrite = o >= 0.999; }
  }
}
export function makeStaticKiller(name, sk) { return tpl[name] ? new StaticKiller(name, sk) : null; }
// float, bob, squash and stretch; lunge forward on attacks; wobble when stunned; gulp on executions
export function animateStaticKiller(R, s, dt) {
  R.t += dt;
  const t = R.t, b = R.body;
  let y = Math.sin(t * 2.1) * 0.08, tilt = Math.sin(t * 1.3) * 0.06, sq = 1 + Math.sin(t * 4.2) * 0.03, lean = (s.speed || 0) * 0.05;
  if (s.atk === 1) { const f = s.atkF || 0; lean = 0.6 * Math.sin(Math.min(1, f) * Math.PI); sq = 1 - 0.15 * Math.sin(f * Math.PI); }
  if (s.stun) { tilt = Math.sin(t * 14) * 0.3; y -= 0.15; }
  if (s.exec) { const f = s.exec.f; sq = 1 + 0.35 * Math.sin(Math.min(1, f * 1.4) * Math.PI); lean = 0.5 * Math.sin(f * Math.PI); }
  const k = 1 - Math.exp(-dt * 10);
  b.position.y += (y - b.position.y) * k;
  b.rotation.x += (lean - b.rotation.x) * k; b.rotation.z += (tilt - b.rotation.z) * k;
  b.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
}
