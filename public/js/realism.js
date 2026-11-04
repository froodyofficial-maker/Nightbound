// Realistic survivor outfits from rigged models with few or no usable clips (Raghuvir's "Realism":
// "Ghostbusters - Dr. Ray Stantz" by spinningblade, sketchfab.com/jakeacc, CC BY 4.0).
// The model is posed every frame by retargeting the game's own procedural survivor animation:
// an invisible procedural rig runs the usual walk / run / crouch / down / carried / caged / vault /
// repair / heal / execution poses, and its joint rotations are copied onto the Mixamo skeleton.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const models = {}, loading = {};
const HEIGHT = 1.78;

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

// put every bone back in the skin's bind pose (the file stores the model mid-stride)
function toBindPose(scene) {
  scene.updateMatrixWorld(true);
  const done = new Set();
  scene.traverse(o => {
    if (!o.isSkinnedMesh || done.has(o.skeleton)) return;
    done.add(o.skeleton);
    const sk = o.skeleton, bindW = new Map();
    sk.bones.forEach((b, i) => bindW.set(b, new THREE.Matrix4().copy(o.bindMatrix).multiply(new THREE.Matrix4().copy(sk.boneInverses[i]).invert())));
    // bones in parent-first order
    const order = []; const visit = b => { if (order.includes(b)) return; if (b.parent && bindW.has(b.parent)) visit(b.parent); order.push(b); };
    sk.bones.forEach(visit);
    for (const b of order) {
      const parentW = bindW.has(b.parent) ? bindW.get(b.parent) : (b.parent ? b.parent.matrixWorld : new THREE.Matrix4());
      // bindW is the bone's world matrix at bind time; its local matrix is relative to the parent
      const local = new THREE.Matrix4().copy(parentW).invert().multiply(bindW.get(b));
      local.decompose(b.position, b.quaternion, b.scale);
    }
  });
  scene.updateMatrixWorld(true);
}

export function loadRealism(name) {
  if (loading[name]) return loading[name];
  loading[name] = bytes(name).then(buf => new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej))).then(g => {
    for (const a of g.animations) a.tracks.length = 0;
    // (the file stores a mid-stride pose; every limb is re-aimed straight down on use, see armFix)
    g.scene.updateMatrixWorld(true);
    // measure from the bones: head top to feet
    const bones = {}; g.scene.traverse(o => { if (o.isBone) bones[o.name.replace(/^mixamorig_?|_\d+$/g, '')] = o; });
    const top = bones.HeadTop_End || bones.Head, foot = bones.LeftToe_End || bones.LeftFoot;
    const yt = top.getWorldPosition(new THREE.Vector3()).y, yf = Math.min(foot.getWorldPosition(new THREE.Vector3()).y, (bones.RightToe_End || foot).getWorldPosition(new THREE.Vector3()).y);
    const s = HEIGHT / (yt - yf) * 0.97, hips = bones.Hips.getWorldPosition(new THREE.Vector3());
    models[name] = { scene: g.scene, fit: { s, x: -hips.x * s, y: -yf * s + 0.02, z: -hips.z * s } };
    return models[name];
  }).catch(e => { console.warn(name + ' model unavailable:', e); return null; });
  return loading[name];
}
export const realismReady = name => !!models[name];

// procedural joint -> Mixamo bone
const MAP = { hips: 'Hips', spine: 'Spine1', head: 'Head', shL: 'LeftArm', elL: 'LeftForeArm', handL: 'LeftHand', shR: 'RightArm', elR: 'RightForeArm', handR: 'RightHand', lgL: 'LeftUpLeg', knL: 'LeftLeg', lgR: 'RightUpLeg', knR: 'RightLeg' };

const SPLAY_L = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.08, 0, 0.24));
const SPLAY_R = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.08, 0, -0.24));

class RealismRig {
  constructor(name, proc) {
    const M = models[name];
    this.kind = 'survivor'; this.retarget = true; this.proc = proc;
    this.root = new THREE.Group(); this.aura = []; this.meshes = []; this.t = 0;
    this.body = new THREE.Group(); this.root.add(this.body);
    const model = cloneSkinned(M.scene);
    model.scale.setScalar(M.fit.s); model.position.set(M.fit.x, M.fit.y, M.fit.z);
    this.body.add(model);
    const bones = {};
    model.traverse(o => {
      if (o.isBone) bones[o.name.replace(/^mixamorig_?|_\d+$/g, '')] = o;
      if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; this.meshes.push(o); }
    });
    this.bones = bones;
    this.root.updateMatrixWorld(true);
    // per bone: rest local rotation and its rest world rotation (to express procedural rotations)
    this.drv = {};
    for (const [j, b] of Object.entries(MAP)) {
      const bone = bones[b]; if (!bone) continue;
      const rest = bone.quaternion.clone(), wr = bone.getWorldQuaternion(new THREE.Quaternion()), wri = wr.clone().invert();
      this.drv[j] = { bone, rest, wr, wri };
    }
    // the bind pose holds the arms out a little: measure how far from straight down they are
    const down = new THREE.Vector3(0, -1, 0);
    this.armFix = {};
    for (const [j, child] of [['shL', 'LeftForeArm'], ['shR', 'RightForeArm'], ['elL', 'LeftHand'], ['elR', 'RightHand'], ['lgL', 'LeftLeg'], ['lgR', 'RightLeg'], ['knL', 'LeftFoot'], ['knR', 'RightFoot']]) {
      const d = this.drv[j]; if (!d || !bones[child]) continue;
      const a = d.bone.getWorldPosition(new THREE.Vector3()), b = bones[child].getWorldPosition(new THREE.Vector3());
      const dir = b.sub(a).normalize();
      this.armFix[j] = new THREE.Quaternion().setFromUnitVectors(dir, down); // rest direction -> straight down
    }
    // the flashlight and effects look for these
    this.j = { handR: bones.RightHand, handL: bones.LeftHand, head: bones.Head, spine: bones.Spine2, hips: bones.Hips };
    this.hipsRest = bones.Hips.position.clone();
    this.hipsY0 = proc.j.hips ? proc.j.hips.position.y : 0; // the procedural rig's standing hip height
    // hip height changes are in metres; the Hips bone moves in its parent's (armature) units
    this.hipScale = 1 / (bones.Hips.parent ? bones.Hips.parent.getWorldScale(new THREE.Vector3()).y : M.fit.s);
    for (const m of this.meshes) if (m.isSkinnedMesh) {
      const a = new THREE.SkinnedMesh(m.geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthTest: false, blending: THREE.AdditiveBlending }));
      a.bind(m.skeleton, m.bindMatrix); a.position.copy(m.position); a.quaternion.copy(m.quaternion); a.scale.copy(m.scale);
      a.visible = false; a.renderOrder = 10; a.frustumCulled = false; m.parent.add(a); this.aura.push(a);
    }
  }
  // copy the procedural rig's pose onto the skeleton
  copy() {
    const P = this.proc.j, q = new THREE.Quaternion(), R = new THREE.Quaternion();
    for (const [j, d] of Object.entries(this.drv)) {
      const pj = P[j]; if (!pj) continue;
      R.copy(pj.quaternion);
      if (this.armFix[j]) R.multiply(this.armFix[j]);
      // the jumpsuit and pack are much bulkier than the procedural body: hold the upper arms a
      // little out from the sides (and a touch forward) so the hands clear the hips and thighs
      if (j === 'shL') R.premultiply(SPLAY_L); else if (j === 'shR') R.premultiply(SPLAY_R);
      q.copy(d.wri).multiply(R).multiply(d.wr);
      d.bone.quaternion.copy(d.rest).multiply(q);
    }
    // whole-body tilt (down, carried) and hip height from the procedural rig
    const tilt = P.tilt;
    if (tilt) { this.body.quaternion.copy(tilt.quaternion); this.body.position.copy(tilt.position); }
    if (P.hips && this.drv.hips) { const dy = P.hips.position.y - this.hipsY0; this.drv.hips.bone.position.copy(this.hipsRest); this.drv.hips.bone.position.y += dy * this.hipScale; }
  }
  setAura(color) { for (const a of this.aura) { if (color == null) a.visible = false; else { a.visible = true; a.material.color.setHex(color); } } }
  setOpacity(o) {
    for (const m of this.meshes) {
      if (!m.userData.baseMat) m.userData.baseMat = m.material;
      if (o >= 0.999) { m.material = m.userData.baseMat; continue; }
      if (!m.userData.fadeMat) { m.userData.fadeMat = m.userData.baseMat.clone(); m.userData.fadeMat.transparent = true; m.userData.fadeMat.depthWrite = false; }
      m.userData.fadeMat.opacity = o; m.material = m.userData.fadeMat;
    }
  }
}

export function makeRealism(name, proc) {
  if (!models[name]) return null;
  return new RealismRig(name, proc);
}
