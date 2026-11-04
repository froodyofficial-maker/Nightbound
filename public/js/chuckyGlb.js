// Chucky's rigged model (Child's Play, fan-made crossover). Model: "Real-Time Chucky" by
// Leopoldo Rojas (sketchfab.com/HushDamacy), Sketchfab Standard licence. Loaded once from the
// embedded GLB (single-file build) or models/chucky.glb, normalised to doll size (~0.95m), then
// cloned per use. Its own clips drive the skeleton: idle, walk, run, two knife attacks, a laugh.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { auraSkinMat } from './foremanGlb.js';

let gltf = null, loading = null, fit = null;
const waiters = [];
export const HEIGHT = 0.95;    // a Good Guy doll is about two and a half feet tall
const FACE_YAW = 0.53;         // the export is turned ~30°: face +Z like the other rigs

export const chuckyReady = () => !!gltf;
export function onChuckyReady(cb) { if (gltf) cb(); else waiters.push(cb); }

async function bytes() {
  const el = document.getElementById('nb-chucky-glb');
  if (el && el.textContent.trim()) {
    const s = atob(el.textContent.trim()), b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b.buffer;
  }
  let last;
  const dev = !!document.querySelector('script[type=importmap]');
  for (const url of dev ? ['models/chucky.glb', 'public/models/chucky.glb'] : ['public/models/chucky.glb', 'models/chucky.glb']) {
    try { const r = await fetch(url); if (r.ok) return await r.arrayBuffer(); last = new Error(url + ' ' + r.status); } catch (e) { last = e; }
  }
  throw last;
}

export function loadChucky() {
  if (loading) return loading;
  loading = bytes()
    .then(buf => new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej)))
    .then(g => {
      // short clip names: IDLE_01, WALK_FORWARD, RUN_FORWARD, ATTACK-KNIFE-01, ...
      for (const c of g.animations) c.name = c.name.replace(/^.*\|(Chucky_)?/, '');
      g.animations = g.animations.filter(c => !/WorldAction|T_POSE|IDLE_02/.test(c.name));
      g.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g.scene), h = box.max.y - box.min.y;
      fit = { s: HEIGHT / h, y: -box.min.y * HEIGHT / h, x: -(box.min.x + box.max.x) / 2 * HEIGHT / h, z: -(box.min.z + box.max.z) / 2 * HEIGHT / h };
      gltf = g;
      for (const cb of waiters.splice(0)) { try { cb(); } catch (e) { console.error(e); } }
      return g;
    })
    .catch(e => { console.warn('Chucky model unavailable, using the built-in one:', e); });
  return loading;
}

class ChuckyRig {
  constructor(sk, lite) {
    this.kind = 'killer'; this.killer = 'chucky'; this.glb = true; this.chucky = true;
    this.root = new THREE.Group(); this.aura = []; this.meshes = []; this.t = Math.random() * 10;
    const holder = new THREE.Group(); holder.rotation.y = FACE_YAW; this.root.add(holder);
    const model = cloneSkinned(gltf.scene);
    model.scale.setScalar(fit.s); model.position.set(fit.x, fit.y, fit.z);
    holder.add(model);
    const bones = {}, mats = new Map(), skinned = [];
    model.traverse(o => {
      if (o.isBone) bones[o.name.replace(/_\d+$/, '')] = o;
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
      if (!mats.has(o.material)) mats.set(o.material, this.material(o.material, sk, lite));
      o.material = mats.get(o.material);
      this.meshes.push(o);
      if (o.isSkinnedMesh) skinned.push(o);
    });
    for (const m of skinned) {
      const a = new THREE.SkinnedMesh(m.geometry, auraSkinMat(0xffffff));
      a.bind(m.skeleton, m.bindMatrix);
      a.position.copy(m.position); a.quaternion.copy(m.quaternion); a.scale.copy(m.scale);
      a.visible = false; a.renderOrder = 10; a.frustumCulled = false;
      m.parent.add(a); this.aura.push(a);
    }
    this.bones = bones;
    this.mixer = new THREE.AnimationMixer(model);
    this.acts = {};
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      a.enabled = true; a.setEffectiveWeight(0); a.play();
      this.acts[clip.name] = a;
    }
    this.w = Object.fromEntries(Object.keys(this.acts).map(k => [k, 0]));
    if (this.acts.IDLE_01) { this.w.IDLE_01 = 1; this.acts.IDLE_01.setEffectiveWeight(1); }
  }
  material(src, sk, lite) {
    let m = lite ? new THREE.MeshLambertMaterial({ color: src.color, map: src.map || null, side: src.side, transparent: src.transparent, alphaTest: src.alphaTest }) : src.clone();
    // outfit tints (Burnt Out, Voodoo)
    if (sk.tint != null) { m.color = new THREE.Color(src.color).lerp(new THREE.Color(sk.tint), sk.tintK ?? 0.5); }
    if (sk.glow != null && 'emissive' in m) { m.emissive = new THREE.Color(sk.glow); m.emissiveIntensity = sk.glowK ?? 0.4; }
    return m;
  }
  setAura(color) {
    for (const a of this.aura) { if (color == null) a.visible = false; else { a.visible = true; a.material = auraSkinMat(color); } }
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

export function makeChuckyGlb(sk = {}, lite = false) {
  if (!gltf) return null;
  return new ChuckyRig(sk, lite);
}

// pick a clip for the game state, blend toward it, and scrub one-shot clips
export function animateChucky(R, s, dt) {
  R.t += dt;
  const A = R.acts, sp = s.speed || 0;
  let want = 'IDLE_01', rate = 1, scrub = null, fast = false;
  if (s.exec && s.exec.role === 'killer') { want = 'ATTACK-KNIFE-02'; rate = 2.2; fast = true; }
  else if (s.stun) { want = 'IDLE_01'; rate = 0.35; }
  else if (s.leap != null) { want = 'ATTACK-KNIFE-02'; scrub = 0.15 + s.leap * 0.7; fast = true; }
  else if (s.aim) { want = 'ATTACK-KNIFE-02'; scrub = 0.08; fast = true; }
  else if (s.atk === 1) { want = 'ATTACK-KNIFE-01'; scrub = Math.min(1, (s.atkF || 0) * 0.6); fast = true; }
  else if (s.atk === 2 && !s.atkHit) { want = 'ATTACK-KNIFE-01'; scrub = 0.6 + (s.recF || 0) * 0.4; }
  else if (s.act) { want = 'IDLE_01'; rate = 1.6; }
  else if (sp > 2.6) { want = 'RUN_FORWARD'; rate = Math.min(1.5, Math.max(0.7, sp / 3.6)); }
  else if (sp > 0.3) { want = 'WALK_FORWARD'; rate = Math.min(2.4, Math.max(0.7, sp / 0.9)); }
  if (!A[want]) want = 'IDLE_01';
  const laughing = s.laughF != null && s.laughF < 1;
  const k = 1 - Math.exp(-dt * (fast ? 22 : 9));
  for (const n in A) {
    const a = A[n];
    const target = n === want ? 1 : n === 'FACE_LAUGH_1' && laughing ? 1 : 0;
    R.w[n] += (target - R.w[n]) * k;
    if (R.w[n] < 0.002 && !target) R.w[n] = 0;
    a.setEffectiveWeight(R.w[n]);
    if (n === want) {
      if (scrub != null) { a.paused = true; a.time = scrub * a.getClip().duration; }
      else { a.paused = false; a.timeScale = rate; }
    } else if (n === 'FACE_LAUGH_1' && laughing) { a.paused = false; a.timeScale = 1; if (s.laughF < 0.05) a.time = 0; }
    else if (R.w[n] === 0) a.paused = true;
  }
  R.mixer.update(dt);
  // stunned: wobble like a toy that got knocked over
  R.root.children[0].rotation.z = s.stun ? Math.sin(R.t * 9) * 0.18 : 0;
}
