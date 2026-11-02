// The Foreman's rigged model (OFFAL crossover). Loaded once from the embedded GLB
// (single-file build) or models/foreman.glb (server), then cloned per use. The skeleton is
// driven by its own clips (Idle, Walk, Stalk, Run, Attack, Grab, Stunned) through a mixer.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

let gltf = null, loading = null;
const waiters = [];
const SCALE = 0.84; // model shoulders at ~1.62m, matching the carry height used by the game

export const foremanReady = () => !!gltf;
export function onForemanReady(cb) { if (gltf) cb(); else waiters.push(cb); }

async function bytes() {
  const el = document.getElementById('nb-foreman-glb');
  if (el && el.textContent.trim()) {
    const s = atob(el.textContent.trim()), b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b.buffer;
  }
  // the web build (index.html at the repo root) fetches it from public/, the dev server from models/
  let last;
  const dev = !!document.querySelector('script[type=importmap]');
  for (const url of dev ? ['models/foreman.glb', 'public/models/foreman.glb'] : ['public/models/foreman.glb', 'models/foreman.glb']) {
    try { const r = await fetch(url); if (r.ok) return await r.arrayBuffer(); last = new Error(url + ' ' + r.status); } catch (e) { last = e; }
  }
  throw last;
}

export function loadForeman() {
  if (loading) return loading;
  loading = bytes()
    .then(buf => new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej)))
    .then(g => { gltf = g; for (const cb of waiters.splice(0)) { try { cb(); } catch (e) { console.error(e); } } return g; })
    .catch(e => { console.warn('Foreman model unavailable, using the built-in one:', e); });
  return loading;
}

// fresnel aura that follows the skeleton
const auraSkin = new Map();
function auraSkinMat(color) {
  if (auraSkin.has(color)) return auraSkin.get(color);
  const m = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 1 } },
    vertexShader: `#include <common>
      #include <skinning_pars_vertex>
      varying vec3 vN; varying vec3 vV;
      void main(){
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
        vN = normalize(normalMatrix * objectNormal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 color; uniform float opacity; varying vec3 vN; varying vec3 vV;
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); f = 0.18 + pow(f, 1.6)*1.1; gl_FragColor = vec4(color*f, f*opacity); }`,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  auraSkin.set(color, m);
  return m;
}

// material name -> skin key it takes its colour from
// (identified by tinting each material on a render: 2 = arms & legs, 8 = mask, 19 = apron, 17 = straps, 14 = hook, 3 = gums)
const TINT = { Foreman_2: 'flesh', Foreman_8: 'bone', Foreman_19: 'apron', Foreman_17: 'apron', Foreman_14: 'steel', Foreman_0: 'steel', Foreman_3: 'blood' };

class GlbRig {
  constructor(sk, lite) {
    this.kind = 'killer'; this.killer = 'foreman'; this.glb = true;
    this.root = new THREE.Group(); this.aura = []; this.meshes = []; this.t = Math.random() * 10;
    const model = cloneSkinned(gltf.scene);
    model.scale.setScalar(SCALE);
    this.root.add(model);
    const bones = {}, mats = new Map();
    const skinned = [];
    model.traverse(o => {
      if (o.isBone) bones[o.name] = o;
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
      const src = o.material;
      if (!mats.has(src)) mats.set(src, this.material(src, sk, lite));
      o.material = mats.get(src);
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
    this.j = { head: bones.Head, jaw: bones.Jaw, spine: bones.Spine, handL: bones.LeftHand, handR: bones.RightHand, hips: bones.Hips };
    this.mixer = new THREE.AnimationMixer(model);
    this.acts = {};
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      a.enabled = true; a.setEffectiveWeight(0); a.play();
      this.acts[clip.name] = a;
    }
    this.w = Object.fromEntries(Object.keys(this.acts).map(k => [k, 0]));
    this.w.Idle = 1; this.acts.Idle.setEffectiveWeight(1);
    this.prevStun = false;
  }
  material(src, sk, lite) {
    const key = TINT[src.name];
    const glow = src.name === 'EyeGlow';
    let m;
    if (lite) {
      m = new THREE.MeshLambertMaterial({ color: src.color, map: src.map || null, side: src.side });
    } else {
      m = src.clone();
    }
    if (key && sk[key] != null) m.color.setHex(sk[key]);
    if (glow) {
      // unlit and over-bright so bloom makes the eyes burn
      const c = sk.eye != null ? new THREE.Color(sk.eye) : src.color.clone();
      m = new THREE.MeshBasicMaterial({ color: c.multiplyScalar(4), toneMapped: false });
      m.name = src.name;
    }
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

export function makeForemanGlb(sk = {}, lite = false) {
  if (!gltf) return null;
  return new GlbRig(sk, lite);
}

// pick a clip for the game state, blend weights toward it, and scrub one-shot clips
export function animateGlb(R, s, dt) {
  R.t += dt;
  const A = R.acts, sp = s.speed || 0;
  let want = 'Idle', rate = 1, scrub = null, fast = false;
  const stun = !!s.stun;
  if (stun && !R.prevStun) A.Stunned.time = 0;
  R.prevStun = stun;
  if (s.exec && s.exec.role === 'killer') {
    const f = s.exec.f;
    if (f < 0.55) { want = 'Grab'; scrub = Math.min(1, f / 0.4); }
    else { want = 'Walk'; rate = -1.1; }
    fast = true;
  } else if (stun) { want = 'Stunned'; rate = 1.4; }
  else if (s.atk === 1) { want = 'Attack'; scrub = Math.min(1, (s.atkF || 0) * 0.62); fast = true; }
  else if (s.atk === 2 && !s.atkHit) { want = 'Attack'; scrub = 0.62 + (s.recF || 0) * 0.38; }
  else if (s.atk === 2 && s.atkHit) { want = sp > 0.3 ? 'Walk' : 'Idle'; rate = sp > 0.3 ? 0.9 : 1; }
  else if (s.act === 'pickup' || s.act === 'cage' || s.act === 'break' || s.act === 'kick') { want = 'Grab'; rate = s.act === 'break' || s.act === 'kick' ? 1.6 : 1; }
  else if (s.tele) { want = 'Run'; rate = 1.5; }
  else if (s.aim) { want = 'Stalk'; rate = sp > 0.3 ? 1.1 : 0.35; }
  else if (s.anim === 'vault') { want = 'Run'; rate = 1.2; }
  else if (s.anim === 'menace') { want = Math.sin(R.t * 0.25) > 0.55 ? 'Stalk' : 'Idle'; rate = want === 'Stalk' ? 0.4 : 1; }
  else if (sp > 3.4) { want = 'Run'; rate = Math.min(1.3, Math.max(0.75, sp / 4.8)); }
  else if (sp > 0.3) { want = s.dark ? 'Stalk' : 'Walk'; rate = Math.min(2.2, Math.max(0.6, sp / 1.4)); }
  const k = 1 - Math.exp(-dt * (fast ? 22 : 9));
  for (const n in A) {
    const a = A[n];
    R.w[n] += ((n === want ? 1 : 0) - R.w[n]) * k;
    if (R.w[n] < 0.002 && n !== want) R.w[n] = 0;
    a.setEffectiveWeight(R.w[n]);
    if (n === want) {
      if (scrub != null) { a.paused = true; a.time = scrub * a.getClip().duration; }
      else { a.paused = false; a.timeScale = rate; }
    } else if (R.w[n] === 0) a.paused = true;
  }
  R.mixer.update(dt);
  if (s.carry && R.bones.LeftArm) {
    // left arm steadies the survivor slung over the shoulder
    R.bones.LeftArm.rotation.x -= 1.9; R.bones.LeftForeArm.rotation.x -= 0.6;
  }
}
