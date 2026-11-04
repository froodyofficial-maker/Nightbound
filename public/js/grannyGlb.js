// Granny (Granny chapter, fan-made crossover).
//  - Model: "Granny official model pc (Granny 3)" by alessio.fnf.bf (sketchfab.com/alessio.fnf.bf),
//    CC BY 4.0: a clean T-posed rig with no animations.
//  - Animations: from "Granny (7)" by Yandu27 (sketchfab.com/Yandu27), CC BY 4.0 (its skin is
//    broken, so only its skeleton and clips are kept: granny_anims.glb). Both use the game's Bip01
//    skeleton: the clips play on an invisible copy of that skeleton and every bone of the model
//    follows it (world-space rotation from rest), so she moves with her own animations: idle, Walk,
//    Hit (bat swing), arrowHit (staggered), pepperHit (blinded), freezeTrap, Look, lookBed (bending).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { auraSkinMat } from './foremanGlb.js';

const M = {}, loading = {}, waiters = {};
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
// height (m) and which way the raw model faces
const SPEC = { granny: { h: 1.82, yaw: 0 }, granny_anims: { anim: true }, grandpa: { h: 1.86, yaw: 0 }, spidermom: { h: 1.15, yaw: 0 } };
function load(name) {
  if (loading[name]) return loading[name];
  loading[name] = bytes(name).then(buf => new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej))).then(g => {
    const S = SPEC[name];
    if (S.anim) { M[name] = { g }; return M[name]; }
    // measure in the first frame of the idle clip (the rest pose isn't a standing pose)
    const probe = cloneSkinned(g.scene), mx = new THREE.AnimationMixer(probe);
    const idle = g.animations.find(c => /^idle$/i.test(c.name)) || g.animations[0];
    if (idle) { mx.clipAction(idle).play(); mx.update(0); }
    probe.updateMatrixWorld(true);
    if (name === 'slendrina') seatHair(probe, g.scene);
    const box = new THREE.Box3();
    probe.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); box.union(o.isSkinnedMesh ? skinnedBox(o) : new THREE.Box3().copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)); } });
    const h = box.max.y - box.min.y, k = S.h / h, c = box.getCenter(new THREE.Vector3());
    M[name] = { g, fit: { s: k, x: -c.x * k, y: -box.min.y * k, z: -c.z * k }, yaw: S.yaw };
    for (const cb of (waiters[name] || []).splice(0)) { try { cb(); } catch (e) { console.error(e); } }
    return M[name];
  }).catch(e => { console.warn(name + ' model unavailable:', e); return null; });
  return loading[name];
}
// bounding box of a skinned mesh as currently posed
function skinnedBox(m) {
  const b = new THREE.Box3(), v = new THREE.Vector3(), P = m.geometry.attributes.position;
  for (let i = 0; i < P.count; i += 3) { v.fromBufferAttribute(P, i); m.applyBoneTransform(i, v); v.applyMatrix4(m.matrixWorld); b.expandByPoint(v); }
  return b;
}
// Slendrina's hair mesh sits above her head in the file: move it down onto her head (in the template)
function seatHair(probe, scene) {
  let hairP = null, hairT = null, body = null;
  probe.traverse(o => { if (o.isMesh && /hair/i.test(o.name)) hairP = o; if (o.isSkinnedMesh) body = o; });
  scene.traverse(o => { if (o.isMesh && /hair/i.test(o.name)) hairT = o; });
  if (!hairP || !hairT || !body) return;
  const bb = skinnedBox(body), hb = new THREE.Box3().setFromObject(hairP);
  const headTop = bb.max.y, drop = hb.max.y - (headTop + (bb.max.y - bb.min.y) * 0.015);
  // the offset is in world units: convert into the hair's parent space
  const w = hairT.parent.getWorldScale(new THREE.Vector3()), p = hairT.parent;
  const dLocal = p.worldToLocal(new THREE.Vector3(hb.getCenter(new THREE.Vector3()).x, hb.getCenter(new THREE.Vector3()).y - drop, hb.getCenter(new THREE.Vector3()).z)).sub(p.worldToLocal(hb.getCenter(new THREE.Vector3())));
  hairT.position.add(dLocal);
  void w;
}
export const loadGranny = () => Promise.all([load('granny'), load('granny_anims')]).then(() => M.granny);
// Grandpa (outfit): "Grandpa Shotgun (G3 And Recaptured)" by DVUnit (sketchfab.com/DVUnit), CC BY 4.0, with his own clips
export const loadGrandpa = () => load('grandpa');
// Spider Mom (helper): "Spider Mom - Granny" by DVUnit (sketchfab.com/DVUnit), CC BY 4.0, with her own clips
export const loadSpiderMom = () => load('spidermom');
export const spiderMomReady = () => !!M.spidermom;
export const grandpaReady = () => !!M.grandpa;
export const grannyReady = () => !!(M.granny && M.granny_anims);
export function onGrannyReady(cb) { if (grannyReady()) cb(); else loadGranny().then(() => grannyReady() && cb()); }

class AnimRig {
  constructor(name, sk = {}, lite = false) {
    const D = M[name];
    this.root = new THREE.Group(); this.aura = []; this.meshes = []; this.t = Math.random() * 10;
    const holder = new THREE.Group(); holder.rotation.y = D.yaw; this.root.add(holder); this.holder = holder;
    const model = cloneSkinned(D.g.scene);
    model.scale.setScalar(D.fit.s); model.position.set(D.fit.x, D.fit.y, D.fit.z);
    holder.add(model);
    const mats = new Map(), skinned = [];
    model.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.frustumCulled = false;
      if (/hat_santa/i.test(o.name)) o.visible = !!sk.santa; // her Christmas hat, only for that outfit
      if (!mats.has(o.material)) mats.set(o.material, this.material(o.material, sk, lite));
      o.material = mats.get(o.material);
      this.meshes.push(o);
      if (o.isSkinnedMesh) skinned.push(o);
    });
    for (const m of skinned) {
      const a = new THREE.SkinnedMesh(m.geometry, auraSkinMat(0xffffff));
      a.bind(m.skeleton, m.bindMatrix); a.position.copy(m.position); a.quaternion.copy(m.quaternion); a.scale.copy(m.scale);
      a.visible = false; a.renderOrder = 10; a.frustumCulled = false; m.parent.add(a); this.aura.push(a);
    }
    this.mixer = new THREE.AnimationMixer(model);
    this.acts = {};
    for (const clip of D.g.animations) { const a = this.mixer.clipAction(clip); a.enabled = true; a.setEffectiveWeight(0); a.play(); this.acts[clip.name] = a; }
    this.w = Object.fromEntries(Object.keys(this.acts).map(k => [k, 0]));
    const first = this.acts.idle ? 'idle' : Object.keys(this.acts)[0];
    if (first) { this.w[first] = 1; this.acts[first].setEffectiveWeight(1); }
  }
  material(src, sk, lite) {
    let m = lite ? new THREE.MeshLambertMaterial({ color: src.color, map: src.map || null, side: src.side, transparent: src.transparent, alphaTest: src.alphaTest }) : src.clone();
    if (sk.tint != null) m.color = new THREE.Color(src.color).lerp(new THREE.Color(sk.tint), sk.tintK ?? 0.5);
    if (sk.glow != null && 'emissive' in m) { m.emissive = new THREE.Color(sk.glow); m.emissiveIntensity = sk.glowK ?? 0.4; }
    return m;
  }
  setAura(color) { for (const a of this.aura) { if (color == null) a.visible = false; else { a.visible = true; a.material = auraSkinMat(color); } } }
  setOpacity(o) {
    for (const m of this.meshes) {
      if (!m.userData.baseMat) m.userData.baseMat = m.material;
      if (o >= 0.999) { m.material = m.userData.baseMat; m.castShadow = true; continue; }
      if (!m.userData.fadeMat) { m.userData.fadeMat = m.userData.baseMat.clone(); m.userData.fadeMat.transparent = true; m.userData.fadeMat.depthWrite = false; }
      m.userData.fadeMat.opacity = o; m.material = m.userData.fadeMat; m.castShadow = o > 0.5;
    }
  }
}
const base = n => n.replace(/_\d+$/, '').replace(/_/g, ' ').trim();
class GrannyRig extends AnimRig {
  constructor(sk, lite) {
    super('granny', sk, lite);
    this.kind = 'killer'; this.killer = 'granny'; this.glb = true; this.granny = true;
    // the puppet: Granny (7)'s skeleton playing her clips, never drawn
    const src = M.granny_anims.g.scene.clone(true), sh = new THREE.Group();
    sh.rotation.y = Math.PI / 2; sh.add(src); this.root.add(sh); sh.visible = false; this.src = sh;
    this.mixer = new THREE.AnimationMixer(src); this.acts = {};
    for (const clip of M.granny_anims.g.animations) { const a = this.mixer.clipAction(clip); a.enabled = true; a.setEffectiveWeight(0); a.play(); this.acts[clip.name] = a; }
    this.w = Object.fromEntries(Object.keys(this.acts).map(k => [k, 0]));
    if (this.acts.idle) { this.w.idle = 1; this.acts.idle.setEffectiveWeight(1); }
    const sb = {}; src.traverse(o => { sb[base(o.name)] = o; });
    const tb = []; this.holder.traverse(o => { if (o.isBone && sb[base(o.name)] && /Bip01|SlendrinaMom/.test(o.name)) tb.push(o); });
    // line the puppet up with the model: same spine height and place
    this.root.updateMatrixWorld(true);
    const tSp = tb.find(b => base(b.name) === 'Bip01 Spine'), sSp = sb['Bip01 Spine'];
    const tp = tSp.getWorldPosition(new THREE.Vector3()), sp0 = sSp.getWorldPosition(new THREE.Vector3());
    const k = tp.y / Math.max(1e-6, sp0.y); src.scale.multiplyScalar(k); this.root.updateMatrixWorld(true);
    const sp1 = sSp.getWorldPosition(new THREE.Vector3()); src.position.add(sh.worldToLocal(tp.clone()).sub(sh.worldToLocal(sp1.clone()))); this.root.updateMatrixWorld(true);
    // rest rotations (world, relative to the rig's root) of every mapped pair, parents first
    const depth = o => { let d = 0; while (o.parent) { o = o.parent; d++; } return d; };
    tb.sort((a, b) => depth(a) - depth(b));
    const q = () => new THREE.Quaternion();
    // the puppet's T-pose comes from its bind matrices (stored as extras.bindQ: world rotation in the file)
    const shq = sh.quaternion.clone();
    const tposeOf = o => o.userData && o.userData.bindQ ? shq.clone().multiply(new THREE.Quaternion().fromArray(o.userData.bindQ)) : o.getWorldQuaternion(q());
    this.pairs = tb.map(t => ({ t, s: sb[base(t.name)], rt: t.getWorldQuaternion(q()), rs: tposeOf(sb[base(t.name)]), wq: q() }));
    this.spine = { t: tSp, s: sSp, rt: tp.clone(), rs: sSp.getWorldPosition(new THREE.Vector3()) };
    // one constant frame correction for the stored T-pose rotations: in the first frame of her idle
    // clip the puppet's spine stands upright, like the model's in its T-pose
    if (this.acts.idle) {
      this.mixer.update(0); sh.updateMatrixWorld(true);
      const P0 = this.pairs.find(P => P.t === tSp);
      const E = sSp.getWorldQuaternion(q()).multiply(P0.rs.clone().invert());
      for (const P of this.pairs) P.rs.premultiply(E);
    }
    this._q = q(); this._p = q(); this._v = new THREE.Vector3();
  }
  // copy the puppet's pose onto the model
  follow() {
    this.src.updateMatrixWorld(true);
    const root = this.root, rq = root.getWorldQuaternion(this._p), rqi = rq.clone().invert();
    const byBone = new Map();
    for (const P of this.pairs) {
      // the puppet's rotation now, relative to its T-pose, applied to the model's T-pose (world space)
      const sw = P.s.getWorldQuaternion(this._q).premultiply(rqi);
      P.wq.copy(sw).multiply(P.rs.clone().invert()).multiply(P.rt);
      const parent = P.t.parent, pw = byBone.get(parent) || parent.getWorldQuaternion(new THREE.Quaternion()).premultiply(rqi);
      P.t.quaternion.copy(pw.clone().invert().multiply(P.wq));
      byBone.set(P.t, P.wq);
    }
    // hips: follow the puppet's spine up and down (bending, crouching, staggering)
    const S = this.spine, sp = root.worldToLocal(S.s.getWorldPosition(this._v)).sub(S.rs);
    const want = S.rt.clone().add(sp);
    S.t.parent.updateMatrixWorld(true);
    S.t.position.copy(S.t.parent.worldToLocal(root.localToWorld(want)));
  }
}
export function makeGrannyGlb(sk = {}, lite = false) {
  if (sk.grandpa) {
    if (!M.grandpa) return null;
    const R = new AnimRig('grandpa', sk, lite);
    Object.assign(R, { kind: 'killer', killer: 'granny', glb: true, granny: true, grandpa: true });
    // Granny's states -> his clips
    R.clipMap = { idle: 'idle', Walk: 'walk', Hit: 'attack', arrowHit: 'arrowHit', pepperHit: 'peppered', freezeTrap: 'frozen', Look: 'search', lookBed: 'underbed' };
    R.root.traverse(o => { if (o.isMesh && /Glasses|Hat_Santa|RedEyes|Ragdoll/i.test(o.name)) o.visible = false; });
    return R;
  }
  return grannyReady() ? new GrannyRig(sk, lite) : null;
}
// Spider Mom: crawls, sniffs about, screeches
export function makeSpiderMom(lite = false) {
  if (!M.spidermom) return null;
  const R = new AnimRig('spidermom', {}, lite);
  R.kind = 'npc';
  R.play = (name, dt) => {
    const k = 1 - Math.exp(-dt * 8);
    for (const n in R.acts) { const t = n === name ? 1 : 0; R.w[n] += (t - R.w[n]) * k; R.acts[n].setEffectiveWeight(R.w[n]); R.acts[n].paused = false; }
    R.mixer.update(dt);
  };
  return R;
}

// pick Granny's clip for the game state, blend toward it, scrub one-shots
export function animateGranny(R, s, dt) {
  R.t += dt;
  const A = R.acts, sp = s.speed || 0;
  let want = 'idle', rate = 1, scrub = null, fast = false;
  if (s.exec && s.exec.role === 'killer') {
    // Bedtime Trap: bend down and set the trap, then the shove, then stand over them
    const f = s.exec.f;
    if (f < 0.34) { want = 'lookBed'; rate = 1.2; } else if (f < 0.6) { want = 'Hit'; scrub = 0.25 + (f - 0.34) / 0.26 * 0.6; fast = true; } else want = 'Look';
  }
  else if (s.dash) { want = 'Hit'; scrub = 0.45; fast = true; }        // Bat Rush: mid-swing, charging forward
  else if (s.aim) { want = 'Hit'; scrub = 0.18; fast = true; }         // winding up the bat
  else if (s.blind) { want = 'pepperHit'; rate = 1; fast = true; }
  else if (s.frozen) { want = 'freezeTrap'; rate = 1; fast = true; }
  else if (s.stun) { want = 'arrowHit'; rate = 0.9; fast = true; }
  else if (s.atk === 1) { want = 'Hit'; scrub = 0.2 + Math.min(1, s.atkF || 0) * 0.4; fast = true; }
  else if (s.atk === 2 && !s.atkHit) { want = 'Hit'; scrub = 0.6 + (s.recF || 0) * 0.35; }
  else if (s.act === 'pickup' || s.act === 'cage' || s.act === 'bear' || s.act === 'break' || s.act === 'kick') { want = 'lookBed'; rate = s.act === 'break' || s.act === 'kick' ? 1.6 : 1.2; }
  else if (s.listen) { want = 'Look'; rate = 1.2; }
  else if (sp > 0.3) { want = 'Walk'; rate = Math.min(2.6, Math.max(0.7, sp / 1.7)); }
  if (R.clipMap) want = R.clipMap[want] || 'idle';
  if (!A[want]) want = A.idle ? 'idle' : Object.keys(A)[0];
  const k = 1 - Math.exp(-dt * (fast ? 20 : 9));
  for (const n in A) {
    const a = A[n], target = n === want ? 1 : 0;
    R.w[n] += (target - R.w[n]) * k;
    if (R.w[n] < 0.002 && !target) R.w[n] = 0;
    a.setEffectiveWeight(R.w[n]);
    if (n === want) { if (scrub != null) { a.paused = true; a.time = scrub * a.getClip().duration; } else { a.paused = false; a.timeScale = rate; } }
    else if (R.w[n] === 0) a.paused = true;
  }
  R.mixer.update(dt);
  if (R.follow) R.follow();
}
