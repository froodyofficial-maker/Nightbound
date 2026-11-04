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
export function auraSkinMat(color) {
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
      o.userData.baseName = src.name;
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
    if (sk.batman) dressBatman(this, model, bones, lite);
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

// ---------------- limited edition: Batman over the Foreman's skeleton ----------------
// "Batman" by #3D $Resource$ (sketchfab.com/lopuh22721), CC BY 4.0: a static mesh. It is skinned here
// to the Foreman's skeleton (the skeleton is posed into Batman's A-pose, then every vertex is weighted
// to its nearest bones: arms and legs only to their own side, the cape to the back), so it plays the
// Foreman's own animations. He keeps the Foreman's hook, blacked out into a grappling hook.
let batman = null, batLoading = null, batPrep = null;
export function loadBatman() {
  if (batLoading) return batLoading;
  batLoading = (async () => {
    const el = document.getElementById('nb-batman-glb'); let buf;
    if (el && el.textContent.trim()) { const s2 = atob(el.textContent.trim()), b = new Uint8Array(s2.length); for (let i = 0; i < s2.length; i++) b[i] = s2.charCodeAt(i); buf = b.buffer; }
    else { const dev = !!document.querySelector('script[type=importmap]'); for (const url of dev ? ['models/batman.glb', 'public/models/batman.glb'] : ['public/models/batman.glb', 'models/batman.glb']) { try { const r = await fetch(url); if (r.ok) { buf = await r.arrayBuffer(); break; } } catch (_) {} } }
    if (!buf) throw new Error('batman.glb unavailable');
    batman = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej));
    return batman;
  })().catch(e => { console.warn('Batman skin unavailable:', e); return null; });
  return batLoading;
}
export const batmanReady = () => !!(batman && gltf);
const BAT_BONES = ['Hips', 'Spine', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
// rotate the arms down by `a` (radians) about the body's forward axis
function aPose(bones, aL, aR) {
  for (const [n, ang] of [['LeftArm', -aL], ['RightArm', aR]]) {
    const b = bones[n]; if (!b) continue;
    const pw = b.parent.getWorldQuaternion(new THREE.Quaternion()), bw = b.getWorldQuaternion(new THREE.Quaternion());
    const d = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang);
    b.quaternion.copy(pw.invert().multiply(d.multiply(bw)));
    b.updateMatrixWorld(true);
  }
}
function shortenArms(bones, k) {
  for (const sd of ['Left', 'Right']) for (const n of [sd + 'ForeArm', sd + 'Hand']) if (bones[n]) bones[n].position.multiplyScalar(k);
}
function prepareBatman() {
  if (batPrep || !batman || !gltf) return batPrep;
  const model = cloneSkinned(gltf.scene); model.updateMatrixWorld(true);
  const bones = {}; model.traverse(o => { if (o.isBone) bones[o.name] = o; });
  const fbox = new THREE.Box3(); model.traverse(o => { if (o.isSkinnedMesh) fbox.union(new THREE.Box3().setFromObject(o)); });
  const W = n => bones[n].getWorldPosition(new THREE.Vector3());
  const hips = W('Hips'), Hf = fbox.max.y - fbox.min.y;
  // Batman's vertices in Foreman space
  let src = null; batman.scene.updateMatrixWorld(true); batman.scene.traverse(o => { if (o.isMesh && !src) src = o; });
  const g = src.geometry.clone(); g.applyMatrix4(src.matrixWorld);
  const P = g.attributes.position; g.computeBoundingBox();
  const bb = g.boundingBox, Hb = bb.max.y - bb.min.y;
  // torso centre (ignoring the cape): vertices between knee and chest height near the middle
  let cz = 0, cn = 0; const v = new THREE.Vector3();
  for (let i = 0; i < P.count; i += 7) { v.fromBufferAttribute(P, i); const h = (v.y - bb.min.y) / Hb; if (h > 0.45 && h < 0.7 && Math.abs(v.x - (bb.min.x + bb.max.x) / 2) < Hb * 0.08) { cz += v.z; cn++; } }
  cz = cn ? cz / cn : (bb.min.z + bb.max.z) / 2;
  const k = Hf / Hb * 0.99, cx = (bb.min.x + bb.max.x) / 2;
  for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); P.setXYZ(i, (v.x - cx) * k + hips.x, (v.y - bb.min.y) * k + fbox.min.y, (v.z - cz) * k + hips.z); }
  P.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingBox();
  // his arm angle: hand tip vs the Foreman's shoulder
  const sL = W('LeftArm'), sR = W('RightArm');
  let hl = null, hr = null;
  for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); if (!hl || v.x > hl.x) hl = v.clone(); if (!hr || v.x < hr.x) hr = v.clone(); }
  const aL = Math.max(0, Math.atan2(sL.y - hl.y, hl.x - sL.x)), aR = Math.max(0, Math.atan2(sR.y - hr.y, sR.x - hr.x));
  // his arms are shorter than the Foreman's: shorten the forearm and hand bones to match (the clips only
  // rotate them, so this sticks), which also keeps the hook in his fist
  const reach = sd => { const sh = W(sd + 'Arm'), h = W(sd + 'Hand'), f = W(sd + 'ForeArm'); return h.clone().add(h.clone().sub(f).normalize().multiplyScalar(Hf * 0.09)).distanceTo(sh); };
  const armK = Math.min(1, Math.max(0.55, ((hl.distanceTo(sL) / reach('Left')) + (hr.distanceTo(sR) / reach('Right'))) / 2));
  shortenArms(bones, armK); model.updateMatrixWorld(true);
  aPose(bones, aL, aR); model.updateMatrixWorld(true);
  // bone segments in the A-pose
  const seg = {};
  const tip = (n, from, len) => { const a = W(from), b = W(n); return b.clone().add(b.clone().sub(a).normalize().multiplyScalar(len)); };
  const S2 = (n, a, b) => { seg[n] = [a, b]; };
  S2('Hips', W('Hips'), W('Spine')); S2('Spine', W('Spine'), W('Neck')); S2('Neck', W('Neck'), W('Head')); S2('Head', W('Head'), W('HeadTop_End'));
  for (const sd of ['Left', 'Right']) {
    S2(sd + 'Arm', W(sd + 'Arm'), W(sd + 'ForeArm')); S2(sd + 'ForeArm', W(sd + 'ForeArm'), W(sd + 'Hand')); S2(sd + 'Hand', W(sd + 'Hand'), tip(sd + 'Hand', sd + 'ForeArm', Hf * 0.09));
    S2(sd + 'UpLeg', W(sd + 'UpLeg'), W(sd + 'Leg')); S2(sd + 'Leg', W(sd + 'Leg'), W(sd + 'Foot')); S2(sd + 'Foot', W(sd + 'Foot'), W(sd + 'Foot').add(new THREE.Vector3(0, -Hf * 0.03, Hf * 0.07)));
  }
  const segDist = (p, [a, b]) => { const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq()))); return p.distanceTo(a.clone().addScaledVector(ab, t)); };
  const hipY = W('LeftUpLeg').y, shX = Math.abs(sL.x - hips.x), backZ = hips.z - Hf * 0.085;
  const idx = new Uint16Array(P.count * 4), wt = new Float32Array(P.count * 4);
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    const side = v.x >= hips.x ? 'Left' : 'Right';
    let cand;
    if (v.z < backZ && v.y > hipY - Hf * 0.25) cand = ['Spine', 'Hips'];                              // the cape
    else if (v.y < hipY - Hf * 0.02) cand = [side + 'UpLeg', side + 'Leg', side + 'Foot', 'Hips'];
    else if (Math.abs(v.x - hips.x) > shX * 0.92) cand = [side + 'Arm', side + 'ForeArm', side + 'Hand', 'Spine'];
    else cand = ['Hips', 'Spine', 'Neck', 'Head', 'LeftArm', 'RightArm'];
    const ds = cand.map(n => [n, segDist(v, seg[n])]).sort((a, b) => a[1] - b[1]).slice(0, 3);
    let tot = 0; const ws = ds.map(([n, d]) => { const w = 1 / Math.pow(d + Hf * 0.01, 4); tot += w; return [n, w]; });
    ws.forEach(([n, w], j) => { idx[i * 4 + j] = BAT_BONES.indexOf(n); wt[i * 4 + j] = w / tot; });
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
  batPrep = { geo: g, mat: src.material, aL, aR, armK };
  return batPrep;
}
// dress a Foreman rig as Batman
function dressBatman(R, model, bones, lite) {
  const B = prepareBatman(); if (!B) return false;
  // hide the Foreman, except his hook (now a black grappling hook)
  for (const m of R.meshes) {
    const name = (m.userData.baseName || m.material.name || '');
    if (/Foreman_14$/.test(name)) { m.material = m.material.clone(); m.material.color = new THREE.Color(0x1a1c20); if ('metalness' in m.material) { m.material.metalness = 0.85; m.material.roughness = 0.3; } continue; }
    m.visible = false;
  }
  for (const a of R.aura) a.userData.off = true;
  shortenArms(bones, B.armK);
  const rest = {}; for (const n of BAT_BONES) rest[n] = bones[n].quaternion.clone();
  model.updateMatrixWorld(true);
  aPose(bones, B.aL, B.aR); model.updateMatrixWorld(true);
  const mat = lite ? new THREE.MeshLambertMaterial({ map: B.mat.map, color: B.mat.color }) : B.mat.clone();
  const mesh = new THREE.SkinnedMesh(B.geo, mat); mesh.castShadow = true; mesh.frustumCulled = false;
  model.add(mesh); model.updateMatrixWorld(true);
  const skel = new THREE.Skeleton(BAT_BONES.map(n => bones[n]));
  mesh.bind(skel);
  const aura = new THREE.SkinnedMesh(B.geo, auraSkinMat(0xffffff)); aura.visible = false; aura.renderOrder = 10; aura.frustumCulled = false;
  model.add(aura); model.updateMatrixWorld(true); aura.bind(skel, mesh.bindMatrix);
  for (const n of BAT_BONES) bones[n].quaternion.copy(rest[n]);
  R.meshes = R.meshes.filter(m => m.visible); R.meshes.push(mesh);
  R.aura = [aura]; R.batman = true;
  return true;
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
