// Slappy (a Chucky outfit): "slappy_animations" by Howard the Lipscomb (sketchfab.com/1310545),
// CC BY 4.0. The file has no usable walk, run or attack clips, so Slappy has his own hand-made
// animation: every joint is posed procedurally (a stiff, puppet-like idle, walk and run, an
// overhead mallet swing, pounce, carry, stun and execution). He carries an iron-banded mallet.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { HEIGHT } from './chuckyGlb.js';
import { toBindPose } from './realism.js';
import { auraSkinMat } from './foremanGlb.js';

let gltf = null, loading = null, fit = null, rest = null;
const waiters = [];
export const slappyReady = () => !!gltf;
export function onSlappyReady(cb) { if (gltf) cb(); else waiters.push(cb); }

async function bytes() {
  const el = document.getElementById('nb-slappy-glb');
  if (el && el.textContent.trim()) { const s = atob(el.textContent.trim()), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.buffer; }
  const dev = !!document.querySelector('script[type=importmap]'); let last;
  for (const url of dev ? ['models/slappy.glb', 'public/models/slappy.glb'] : ['public/models/slappy.glb', 'models/slappy.glb']) {
    try { const r = await fetch(url); if (r.ok) return await r.arrayBuffer(); last = new Error(url + ' ' + r.status); } catch (e) { last = e; }
  }
  throw last;
}

const key = n => n.replace(/_\d+$/, '');
function boneMap(root) { const b = {}; root.traverse(o => { if (o.isBone) b[key(o.name)] = o; }); return b; }
function restOf(scene) {
  toBindPose(scene); const b = boneMap(scene), q = {}, p = {};
  for (const n in b) { q[n] = b[n].getWorldQuaternion(new THREE.Quaternion()); p[n] = b[n].getWorldPosition(new THREE.Vector3()); }
  return { q, p };
}

export function loadSlappy() {
  if (loading) return loading;
  loading = bytes().then(buf => new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej))).then(g => {
    g.animations = [];
    const S = restOf(g.scene);
    const box = new THREE.Box3().setFromObject(g.scene), h = box.max.y - box.min.y, s = HEIGHT * 1.02 / h;
    fit = { s, x: -(box.min.x + box.max.x) / 2 * s, y: -box.min.y * s, z: -(box.min.z + box.max.z) / 2 * s };
    // how far the arms hang out from the sides in the bind pose (an A-pose): lowered to the sides on use
    const arm = side => { const a = S.p[`Slappy${side}Arm11`], b = S.p[`Slappy${side}Arm21`]; return a && b ? Math.atan2(Math.abs(b.x - a.x), a.y - b.y) : 0.7; };
    rest = { S, armL: arm('L'), armR: arm('R') };
    gltf = g;
    for (const cb of waiters.splice(0)) { try { cb(); } catch (e) { console.error(e); } }
    return g;
  }).catch(e => { console.warn('Slappy model unavailable:', e); return null; });
  return loading;
}

// joints driven by the pose, parent first. Each gets a rotation in the body frame (x: his left,
// y: up, z: forward), composed down the chain like a puppet's joints.
const CHAIN = [
  ['SlappyPelvis', null, 'hips'], ['SlappySpine1', 'SlappyPelvis', 'spine'], ['SlappySpine2', 'SlappySpine1', 'spine2'], ['SlappyChest', 'SlappySpine2', 'chest'],
  ['SlappyNeck', 'SlappyChest', 'neck'], ['SlappyHead', 'SlappyNeck', 'head'], ['SlappyJaw', 'SlappyHead', 'jaw'],
  ['SlappyLArm11', 'SlappyChest', 'shL'], ['SlappyLArm21', 'SlappyLArm11', 'elL'], ['SlappyLArmPalm', 'SlappyLArm21', 'wrL'],
  ['SlappyRArm11', 'SlappyChest', 'shR'], ['SlappyRArm21', 'SlappyRArm11', 'elR'], ['SlappyRArmPalm', 'SlappyRArm21', 'wrR'],
  ['SlappyLLeg1', 'SlappyPelvis', 'lgL'], ['SlappyLLeg2', 'SlappyLLeg1', 'knL'], ['SlappyLLegAnkle', 'SlappyLLeg2', 'anL'],
  ['SlappyRLeg1', 'SlappyPelvis', 'lgR'], ['SlappyRLeg2', 'SlappyRLeg1', 'knR'], ['SlappyRLegAnkle', 'SlappyRLeg2', 'anR'],
];
const E = new THREE.Euler(), Q = () => new THREE.Quaternion();
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function mallet() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4424, roughness: 0.85 }), iron = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.5, metalness: 0.7 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.34, 8), wood); handle.position.y = 0.11; g.add(handle);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.15, 14), new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.8 }));
  head.rotation.x = Math.PI / 2; head.position.y = 0.29; g.add(head);
  for (const z of [-0.06, 0.06]) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.049, 0.007, 6, 16), iron); band.position.set(0, 0.29, z); g.add(band); }
  // a dark stain on the striking face
  const stain = new THREE.Mesh(new THREE.CircleGeometry(0.044, 14), new THREE.MeshStandardMaterial({ color: 0x3a0606, roughness: 0.3 })); stain.position.set(0, 0.29, -0.076); stain.rotation.y = Math.PI; g.add(stain);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

class SlappyRig {
  constructor(sk, lite) {
    this.kind = 'killer'; this.killer = 'chucky'; this.glb = true; this.chucky = true; this.slappy = true;
    this.root = new THREE.Group(); this.aura = []; this.meshes = []; this.t = Math.random() * 10;
    this.body = new THREE.Group(); this.root.add(this.body);
    const model = cloneSkinned(gltf.scene);
    model.scale.setScalar(fit.s); model.position.set(fit.x, fit.y, fit.z);
    this.body.add(model); this.model = model;
    toBindPose(model);
    const mats = new Map(), skinned = [];
    model.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.frustumCulled = false;
      if (!mats.has(o.material)) { const m = lite ? new THREE.MeshLambertMaterial({ color: o.material.color, map: o.material.map || null, transparent: o.material.transparent, alphaTest: o.material.alphaTest, side: o.material.side }) : o.material.clone(); if (sk.tint != null) m.color = new THREE.Color(m.color).lerp(new THREE.Color(sk.tint), sk.tintK ?? 0.5); mats.set(o.material, m); }
      o.material = mats.get(o.material); this.meshes.push(o); if (o.isSkinnedMesh) skinned.push(o);
    });
    for (const m of skinned) {
      const a = new THREE.SkinnedMesh(m.geometry, auraSkinMat(0xffffff)); a.bind(m.skeleton, m.bindMatrix);
      a.position.copy(m.position); a.quaternion.copy(m.quaternion); a.scale.copy(m.scale); a.visible = false; a.renderOrder = 10; a.frustumCulled = false; m.parent.add(a); this.aura.push(a);
    }
    this.sb = boneMap(model);
    this.weapon = mallet(); this.root.add(this.weapon); this.meshes.push(...this.weapon.children);
    this.P = {}; this.cur = {}; // target and smoothed joint angles
  }
  // one rotation per joint, from three body-frame angles [x, y, z]
  rot(a) { return Q().setFromEuler(E.set(a[0] || 0, a[1] || 0, a[2] || 0, 'YXZ')); }
  drive() {
    const S = rest.S, ws = this.model.getWorldQuaternion(Q()), G = {}, P = this.cur;
    for (const [bone, parent, j] of CHAIN) {
      const b = this.sb[bone]; if (!b || !S.q[bone]) continue;
      G[bone] = (parent && G[parent] ? G[parent].clone() : Q()).multiply(this.rot(P[j] || [0, 0, 0]));
      const target = ws.clone().multiply(G[bone]).multiply(S.q[bone]);
      b.quaternion.copy(b.parent.getWorldQuaternion(Q()).invert().multiply(target));
      b.updateMatrixWorld(true);
    }
    // hip height (crouch, the bob of the walk)
    const pv = this.sb.SlappyPelvis;
    if (pv && S.p.SlappyPelvis) pv.position.copy(pv.parent.worldToLocal(this.model.localToWorld(S.p.SlappyPelvis.clone().add(new THREE.Vector3(0, P.hipY ? P.hipY[0] / fit.s : 0, P.hipZ ? P.hipZ[0] / fit.s : 0)))));
    // the mallet: held in the right hand. At rest the handle points forward and the head down; it
    // turns with every joint of the right arm (the same chain rotation as the hand)
    const palm = this.sb.SlappyRArmPalm, fore = this.sb.SlappyRArm21;
    if (palm && fore && G.SlappyRArmPalm) {
      this.root.updateMatrixWorld(true);
      const Pp = palm.getWorldPosition(new THREE.Vector3()), F = Pp.clone().sub(fore.getWorldPosition(new THREE.Vector3())).normalize();
      const wq = ws.clone().multiply(G.SlappyRArmPalm).multiply(Q().setFromEuler(E.set(Math.PI / 2, 0, 0)));
      this.weapon.position.copy(this.root.worldToLocal(Pp.addScaledVector(F, 0.03)));
      this.weapon.quaternion.copy(this.root.getWorldQuaternion(Q()).invert().multiply(wq));
    }
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

export function makeSlappy(sk = {}, lite = false) {
  if (!gltf) return null;
  return new SlappyRig(sk, lite);
}

// Slappy's own animation: a stiff, puppet-like dummy. Poses are angles per joint, blended smoothly.
export function animateSlappy(R, s, dt) {
  R.t += dt;
  const t = R.t, sp = s.speed || 0, P = {}, aL = rest.armL, aR = rest.armR;
  // arms hang at his sides by default (the model's bind pose holds them out)
  const armsDown = () => { P.shL = [0, 0, -aL + 0.08]; P.shR = [0, 0, aR - 0.08]; P.elL = [-0.25, 0, 0]; P.elR = [-0.35, 0, 0]; };
  armsDown();
  P.hipY = [0]; P.hipZ = [0];
  const breathe = Math.sin(t * 1.6);
  P.chest = [breathe * 0.025, 0, 0]; P.head = [0.05 + Math.sin(t * 0.7) * 0.05, Math.sin(t * 0.45) * 0.25, Math.sin(t * 0.9) * 0.05]; // a dummy's slow, wrong head turns
  P.jaw = [0, 0, 0];
  let fast = false;
  const mallet = (f) => {
    // overhead swing with the mallet: raise (0..0.45), strike (0.45..0.7), follow through
    const up = sm(0, 0.45, f), down = sm(0.42, 0.7, f), back = sm(0.75, 1, f);
    const raise = up * (1 - down);
    P.shR = [-2.7 * raise - 0.9 * down * (1 - back) - 0.2, 0, aR - 0.08 - 0.25 * raise];
    P.elR = [-1.3 * raise - 0.2 * down, 0, 0];
    P.spine = [-0.18 * raise + 0.3 * down * (1 - back), -0.35 * raise + 0.25 * down, 0];
    P.chest = [-0.1 * raise + 0.2 * down * (1 - back), -0.2 * raise + 0.15 * down, 0];
    P.shL = [-0.5 * raise, 0, -aL + 0.3];
    P.head = [0.1 * down, 0, 0];
  };
  if (s.exec && s.exec.role === 'killer') {
    // execution: kneels over them and brings the mallet down, again and again
    const f = s.exec.f || 0, k = (f * 4.5) % 1;
    mallet(k); P.hipY = [-0.12]; P.lgL = [-0.5, 0, 0]; P.knL = [1.1, 0, 0]; P.lgR = [-0.2, 0, 0]; P.knR = [0.9, 0, 0]; P.spine[0] += 0.35;
    P.jaw = [0.25 + Math.sin(t * 20) * 0.1, 0, 0]; fast = true;
  } else if (s.stun) {
    // knocked about: limp, wobbling like a puppet with cut strings
    P.spine = [0.4 + Math.sin(t * 7) * 0.15, Math.sin(t * 5) * 0.3, 0]; P.head = [0.6, Math.sin(t * 9) * 0.5, Math.sin(t * 6) * 0.4];
    P.shL = [0.3, 0, -aL + 0.4 + Math.sin(t * 8) * 0.3]; P.shR = [0.2, 0, aR - 0.4 - Math.sin(t * 7) * 0.3]; P.elL = [-0.1, 0, 0]; P.elR = [-0.1, 0, 0];
    P.knL = [0.4, 0, 0]; P.knR = [0.5, 0, 0]; P.hipY = [-0.06]; fast = true;
  } else if (s.leap != null) {
    // the pounce: launched forward, mallet up
    const f = s.leap; mallet(0.3 + f * 0.4); P.spine[0] += 0.5; P.lgL = [-0.9, 0, 0]; P.knL = [0.9, 0, 0]; P.lgR = [0.5, 0, 0]; P.knR = [0.6, 0, 0]; fast = true;
  } else if (s.aim) {
    // coiled for a pounce: crouched, mallet cocked back
    mallet(0.4); P.hipY = [-0.14]; P.lgL = P.lgR = [-0.7, 0, 0]; P.knL = P.knR = [1.3, 0, 0]; P.anL = P.anR = [-0.5, 0, 0]; P.spine[0] += 0.3; fast = true;
  } else if (s.atk === 1) { mallet(Math.min(1, (s.atkF || 0)) * 0.72); fast = true; }
  else if (s.atk === 2 && !s.atkHit) { mallet(0.72 + (s.recF || 0) * 0.28); }
  else if (s.atk === 2) { mallet(0.7); P.spine[0] += 0.1; }
  else if (s.carry) {
    // a survivor over his shoulder: left arm up holding them, mallet low in the right
    P.shL = [-2.4, 0, -aL + 0.5]; P.elL = [-1.6, 0, 0]; P.spine = [0.12, 0, 0];
  } else if (s.act) {
    // bending over (picking up, hooking, breaking things)
    P.spine = [0.6, 0, 0]; P.chest = [0.25, 0, 0]; P.hipY = [-0.05]; P.knL = P.knR = [0.4, 0, 0]; P.lgL = P.lgR = [-0.25, 0, 0];
    P.shL = [-1.0 + Math.sin(t * 6) * 0.2, 0, -aL + 0.2]; P.shR = [-0.9, 0, aR - 0.2]; P.elL = P.elR = [-0.4, 0, 0];
  }
  if (!(s.exec || s.stun || s.leap != null || s.aim || s.act)) {
    // walking and running: stiff legs, swinging arms, a bob at every step
    const moving = sp > 0.3, run = sp > 2.6, ph = t * (run ? 9.5 : 6.2) * Math.max(0.7, Math.min(1.6, sp / (run ? 4.2 : 1.6)));
    const amp = moving ? (run ? 0.85 : 0.5) : 0, sw = Math.sin(ph);
    P.lgL = [-sw * amp, 0, 0.04]; P.lgR = [sw * amp, 0, -0.04];
    P.knL = [Math.max(0, Math.sin(ph + 1.6)) * amp * (run ? 1.6 : 1.0), 0, 0]; P.knR = [Math.max(0, Math.sin(ph + 1.6 + Math.PI)) * amp * (run ? 1.6 : 1.0), 0, 0];
    P.anL = [-P.knL[0] * 0.3, 0, 0]; P.anR = [-P.knR[0] * 0.3, 0, 0];
    P.hipY = [moving ? -Math.abs(Math.cos(ph)) * (run ? 0.035 : 0.02) - (run ? 0.03 : 0) : 0];
    if (!s.atk && !s.carry) {
      P.shL = [sw * amp * 0.8, 0, -aL + 0.1]; P.elL = [-0.3 - (run ? 0.8 : 0.15), 0, 0];
      if (!(s.atk)) { P.shR = [-sw * amp * 0.6 - (run ? 0.25 : 0), 0, aR - 0.12]; P.elR = [-0.5 - (run ? 0.6 : 0.2), 0, 0]; }
    }
    if (moving) { P.spine = [(P.spine ? P.spine[0] : 0) + (run ? 0.22 : 0.06), Math.sin(ph) * 0.08, 0]; P.head = [P.head[0] - (run ? 0.1 : 0), P.head[1] * 0.3, Math.sin(ph) * 0.06]; }
  }
  // laughing: head thrown back, jaw clacking
  if (s.laughF != null && s.laughF < 1) { P.head = [-0.45 + Math.sin(t * 18) * 0.08, P.head[1], 0]; P.jaw = [0.3 + Math.abs(Math.sin(t * 16)) * 0.25, 0, 0]; }
  // blend toward the new pose
  const k = 1 - Math.exp(-dt * (fast ? 22 : 10));
  for (const j in P) { const c = R.cur[j] || [0, 0, 0], v = P[j]; R.cur[j] = [c[0] + ((v[0] || 0) - c[0]) * k, c[1] + ((v[1] || 0) - c[1]) * k, c[2] + ((v[2] || 0) - c[2]) * k]; }
  for (const j in R.cur) if (!(j in P)) { const c = R.cur[j]; R.cur[j] = [c[0] * (1 - k), c[1] * (1 - k), c[2] * (1 - k)]; }
  R.drive();
}
