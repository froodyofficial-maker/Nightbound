// Sidekicks: cosmetic companions that follow their owner around, react to what happens to them,
// and can't hurt or be hurt. Each client runs its own copy (only the owner's choice is synced).
//  - Ted: rigged model "Ted" by diegolitooliva36 (sketchfab.com/diegooliva), CC BY 4.0. The model
//    has no animations, so every pose here is built by turning its bones in code.
//  - Rosy: a little rose-coloured dog, built from primitives.
// When the owner dies, Ted pulls out a camping chair next to the body with a beer and his bong;
// Rosy lies down beside them.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { moveCircle } from './map.js';

let ted = null, tedLoading = null;
const TED_H = 0.62; // a teddy bear's height in metres

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
export function loadTed() {
  if (tedLoading) return tedLoading;
  tedLoading = bytes('ted').then(buf => new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej))).then(g => {
    const scene = g.scene;
    // the file also holds a phone, a beer bottle and a bong: keep the bottle and the bong as props
    const props = {};
    scene.traverse(o => { if (o.name === 'Object_126') props.bottle = o; if (/^Object_1(28|30|32)$/.test(o.name)) (props.bong ||= []).push(o); });
    const drop = [];
    scene.traverse(o => { if (o.isMesh && !o.isSkinnedMesh) drop.push(o); });
    scene.updateMatrixWorld(true);
    const grab = list => { const grp = new THREE.Group(); for (const o of list) { const m = o.clone(); o.matrixWorld.decompose(m.position, m.quaternion, m.scale); grp.add(m); } return grp; };
    const bottle = props.bottle ? grab([props.bottle]) : null, bong = props.bong ? grab(props.bong) : null;
    for (const o of drop) o.parent && o.parent.remove(o);
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene), h = box.max.y - box.min.y;
    const fit = { s: TED_H / h, y: -box.min.y * TED_H / h, x: -(box.min.x + box.max.x) / 2 * TED_H / h, z: -(box.min.z + box.max.z) / 2 * TED_H / h };
    // props: normalise each to a height
    const norm = (grp, height) => { if (!grp) return null; const b = new THREE.Box3().setFromObject(grp), c = b.getCenter(new THREE.Vector3()); const k = height / (b.max.y - b.min.y); const o = new THREE.Group(); grp.position.sub(new THREE.Vector3(c.x, b.min.y, c.z)); o.add(grp); o.scale.setScalar(k); return o; };
    ted = { scene, fit, bottle: norm(bottle, 0.15), bong: norm(bong, 0.17) };
    return ted;
  }).catch(e => { console.warn('Ted model unavailable:', e); return null; });
  return tedLoading;
}
export const tedReady = () => !!ted;

// rotation of a bone "by R in model space at rest": q = q_rest * (q_worldRest^-1 * R * q_worldRest)
function boneDriver(bone) {
  const rest = bone.quaternion.clone(), wr = bone.getWorldQuaternion(new THREE.Quaternion()), wri = wr.clone().invert();
  const tmp = new THREE.Quaternion();
  return R => { tmp.copy(wri).multiply(R).multiply(wr); bone.quaternion.copy(rest).multiply(tmp); };
}
const qa = (x, y, z, a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(x, y, z), a);

// ---------------- Ted ----------------
// (raw model faces +X, right hand toward +Z; a holder turns him to face +Z like everyone else)
const TED_BONES = { pelvis: 'Bone_55', spine: 'Bone001_54', chest: 'Bone002_53', neck: 'Bone004_39', head: 'Bone005_30', armL: 'Bone013_45', foreL: 'Bone015_43', armR: 'Bone008_51', foreR: 'Bone010_49', thighR: 'Bone019_58', shinR: 'Bone020_57', thighL: 'Bone022_62', shinL: 'Bone023_61' };
// two-bone arm chains (shoulder -> wrist -> paw) for reaching: [upper, lower, end]
const TED_ARMS = { R: ['Bone008_51', 'Bone010_49', 'Bone011_48'], L: ['Bone013_45', 'Bone015_43', 'Bone016_42'] };
const TED_MOUTH = 'Bone036_31';
// a bone that can be pointed at a world direction: q_world = Q * q_worldRest, whatever its parent does
function boneAimer(bone, child) {
  const rest = bone.quaternion.clone(), wr = bone.getWorldQuaternion(new THREE.Quaternion()), wri = wr.clone().invert();
  const pri = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  const restDir = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3()));
  const len = restDir.length(); restDir.normalize();
  const Q = new THREE.Quaternion(), D = new THREE.Quaternion(), v = new THREE.Vector3();
  return { bone, len, aim(dirWorld, W0i) {
    v.copy(dirWorld).applyQuaternion(W0i).normalize();
    Q.setFromUnitVectors(restDir, v);
    D.copy(W0i).multiply(bone.parent.getWorldQuaternion(new THREE.Quaternion())).multiply(pri).invert(); // undo the parent's move
    D.multiply(Q);
    bone.quaternion.copy(rest).multiply(wri).multiply(D).multiply(wr);
  } };
}
function makeTedRig() {
  const root = new THREE.Group(), holder = new THREE.Group(); root.add(holder);
  const model = cloneSkinned(ted.scene);
  model.scale.setScalar(ted.fit.s); model.position.set(ted.fit.x, ted.fit.y, ted.fit.z);
  holder.add(model);
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  root.updateMatrixWorld(true);
  const bones = {}; model.traverse(o => { if (o.isBone) bones[o.name] = o; });
  // bone frames are captured in the model's own orientation (facing +X), then he is turned around
  const drv = {}; for (const [k, n] of Object.entries(TED_BONES)) if (bones[n]) drv[k] = boneDriver(bones[n]);
  const arms = {};
  for (const [side, [a, b, c]] of Object.entries(TED_ARMS)) if (bones[a] && bones[b] && bones[c]) {
    const up = boneAimer(bones[a], bones[b]), lo = boneAimer(bones[b], bones[c]);
    arms[side] = { up, lo, sh: bones[a] };
  }
  holder.rotation.y = -Math.PI / 2;
  // props live in his own space (not on a bone) so they sit exactly where they are put
  const bottle = ted.bottle.clone(), bong = ted.bong.clone();
  bottle.visible = bong.visible = false; root.add(bottle, bong);
  return { kind: 'ted', root, holder, model, drv, arms, mouth: bones[TED_MOUTH], bottle, bong, bottleK: bottle.scale.x, bongK: bong.scale.x };
}
// reach a paw to a world point (two-bone IK; the elbow points toward `pole`)
const _v = [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3()), _q = new THREE.Quaternion();
function tedReach(R, side, target, pole) {
  const A = R.arms[side]; if (!A) return;
  const W0i = R.holder.getWorldQuaternion(_q).invert();
  const S = A.sh.getWorldPosition(_v[0]), L1 = A.up.len * A.sh.getWorldScale(_v[5]).x, L2 = A.lo.len * A.lo.bone.getWorldScale(_v[5]).x;
  const to = _v[1].copy(target).sub(S); let d = to.length(); to.normalize();
  d = Math.min(Math.max(d, Math.abs(L1 - L2) + 1e-4), (L1 + L2) * 0.999);
  const a = (L1 * L1 + d * d - L2 * L2) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const p = _v[2].copy(pole).addScaledVector(to, -pole.dot(to)).normalize();
  const E = _v[3].copy(S).addScaledVector(to, a).addScaledVector(p, h);
  A.up.aim(_v[4].copy(E).sub(S), W0i);
  A.sh.updateMatrixWorld(true);
  const W = _v[4].copy(S).addScaledVector(to, d);
  A.lo.aim(W.sub(A.lo.bone.getWorldPosition(_v[2])), W0i);
  A.sh.updateMatrixWorld(true);
}
// pose: { walk (0..1 phase speed), t, sit (0..1), bend, nod (+ down / - back), cheer, panic, dance, look, hop }
function poseTed(R, s) {
  const d = R.drv, t = s.t, sit = s.sit === true ? 1 : (s.sit || 0), stand = 1 - sit;
  const sw = s.walk ? Math.sin(t * 11) * 0.55 * s.walk : 0, bob = s.walk ? Math.abs(Math.sin(t * 11)) * 0.02 * s.walk : Math.sin(t * 2) * 0.004;
  let armR = qa(1, 0, 0, 1.25), armL = qa(1, 0, 0, -1.25); // arms down from the T-pose
  if (s.cheer) { const w = Math.sin(t * 14) * 0.25; armR = qa(1, 0, 0, -0.6 + w); armL = qa(1, 0, 0, 0.6 - w); }
  else if (s.panic) { armR = qa(1, 0, 0, -0.2 + Math.sin(t * 20) * 0.5); armL = qa(1, 0, 0, 0.2 - Math.sin(t * 20 + 1) * 0.5); }
  else if (s.wave) { armR = qa(1, 0, 0, -1.3).multiply(qa(0, 0, 1, Math.sin(t * 11) * 0.4)); }
  else if (s.bow) { armR = qa(0, 0, 1, 0.9 * s.bow).multiply(qa(1, 0, 0, 1.0)); }
  else if (s.dance) { const k = Math.sin(t * 6); armR = qa(0, 0, 1, 1.0 * k).multiply(qa(1, 0, 0, 0.4)); armL = qa(0, 0, 1, -1.0 * k).multiply(qa(1, 0, 0, -0.4)); }
  else if (sit > 0.5) { armR = qa(0, 0, 1, 0.5).multiply(qa(1, 0, 0, 1.0)); armL = qa(0, 0, 1, 0.5).multiply(qa(1, 0, 0, -1.0)); } // paws on the armrests
  else { armR = qa(0, 0, 1, -sw * 0.8).multiply(armR); armL = qa(0, 0, 1, sw * 0.8).multiply(armL); }
  d.armR && d.armR(armR); d.armL && d.armL(armL);
  for (const f of ['foreR', 'foreL']) d[f] && d[f](new THREE.Quaternion());
  d.thighR && d.thighR(qa(0, 0, 1, 1.45 * sit + sw * stand)); d.thighL && d.thighL(qa(0, 0, 1, 1.45 * sit - sw * stand));
  d.shinR && d.shinR(qa(0, 0, 1, -1.35 * sit - Math.max(0, -sw) * 0.9 * stand)); d.shinL && d.shinL(qa(0, 0, 1, -1.35 * sit - Math.max(0, sw) * 0.9 * stand));
  d.chest && d.chest(qa(0, 0, 1, -0.12 * sit + (s.walk ? 0.12 * s.walk * stand : 0) + 0.45 * (s.bend || 0) + 0.7 * (s.bow || 0) + (s.breathe || 0)).multiply(qa(1, 0, 0, s.dance ? Math.sin(t * 6) * 0.15 : 0)));
  d.neck && d.neck(qa(0, 0, 1, s.nod != null ? -s.nod : Math.sin(t * 1.3) * 0.06).multiply(qa(0, 1, 0, s.look || 0)));
  R.holder.position.y = bob * stand + 0.09 * sit + (s.hop || 0);
}

// ---------------- Ted's camp (chair, beer, bong) ----------------
const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
const seg = (t, a, b) => ease((t - a) / (b - a));
const UP = new THREE.Vector3(0, 1, 0);
// a seated drink / smoke cycle (seconds): idle, beer, idle, bong, idle
const CYCLE = 11.5, DRINK = [1.2, 4.6], SMOKE = [6.2, 10.6];
// where the bottle and bong are, in Ted's own space, and where his paws go
function tedProps(R, c, puff) {
  const root = R.root, mouth = R.mouth ? root.worldToLocal(R.mouth.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3(0, 0.47, 0.15);
  mouth.z += 0.03;
  const B = R.bottle, G = R.bong, show = c.props;
  B.visible = G.visible = show > 0.01;
  B.scale.setScalar(R.bottleK * show); G.scale.setScalar(R.bongK * show);
  if (!B.visible) return null;
  // beer: resting upright on his right thigh, or raised, bottom up, neck at his mouth
  const u = c.drink || 0;
  const restBase = new THREE.Vector3(-0.12, 0.33, 0.09);
  const axis = new THREE.Vector3(-0.55, 0.42 + 0.25 * (c.sip || 0), 0.55).normalize(); // neck -> bottom while drinking
  const drinkBase = mouth.clone().addScaledVector(axis, 0.16);
  B.position.lerpVectors(restBase, drinkBase, u);
  B.quaternion.slerpQuaternions(new THREE.Quaternion(), new THREE.Quaternion().setFromUnitVectors(UP, axis.clone().negate()), u);
  // bong: standing on his lap between his knees; for a hit he tips it toward him, mouthpiece to his lips
  const k = c.smoke || 0;
  const lap = new THREE.Vector3(0.02, 0.31, 0.12), tip = new THREE.Vector3(1, 0, 0);
  const hitQ = new THREE.Quaternion().setFromAxisAngle(tip, -0.35), hitAxis = UP.clone().applyQuaternion(hitQ);
  const hitBase = mouth.clone().addScaledVector(hitAxis, -0.165);
  G.position.lerpVectors(lap, hitBase, k);
  G.quaternion.slerpQuaternions(new THREE.Quaternion(), hitQ, k);
  root.updateMatrixWorld(true);
  const gripR = B.localToWorld(new THREE.Vector3(0, 0.07 / R.bottleK, 0)).add(root.localToWorld(new THREE.Vector3(-0.03, 0, 0)).sub(root.getWorldPosition(new THREE.Vector3())));
  const gripL = G.localToWorld(new THREE.Vector3(0, 0.06 / R.bongK, 0)).add(root.localToWorld(new THREE.Vector3(0.035, 0, 0)).sub(root.getWorldPosition(new THREE.Vector3())));
  return { gripR, gripL, mouth: root.localToWorld(mouth.clone()) };
}
function makeChair() {
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
  const frame = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.6, roughness: 0.4 }), cloth = new THREE.MeshStandardMaterial({ color: 0x2f5a3a, roughness: 0.9, side: THREE.DoubleSide });
  const leg = new THREE.CylinderGeometry(0.008, 0.008, 0.36, 6), rail = new THREE.CylinderGeometry(0.007, 0.007, 0.26, 6);
  for (const [x, z, rx] of [[-0.14, 0.12, 0.35], [0.14, 0.12, 0.35], [-0.14, -0.12, -0.35], [0.14, -0.12, -0.35]]) { const m = new THREE.Mesh(leg, frame); m.position.set(x, 0.16, z); m.rotation.x = rx; inner.add(m); }
  for (const x of [-0.15, 0.15]) { const m = new THREE.Mesh(rail, frame); m.position.set(x, 0.4, 0); m.rotation.x = Math.PI / 2; inner.add(m); } // armrests
  const seat = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.26), cloth); seat.rotation.x = -Math.PI / 2 + 0.08; seat.position.y = 0.3; inner.add(seat);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), cloth); back.position.set(0, 0.46, -0.14); back.rotation.x = -0.2; inner.add(back);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.inner = inner;
  return g;
}
// open 0 = folded flat (a narrow bundle), 1 = set up
function foldChair(ch, open) {
  ch.inner.scale.set(0.16 + 0.84 * open, 1, 0.22 + 0.78 * open);
}
// small, short-lived smoke puffs (soft sprites)
let puffTex = null;
function puffTexture() {
  if (puffTex) return puffTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  puffTex = new THREE.CanvasTexture(cv); puffTex.colorSpace = THREE.SRGBColorSpace;
  return puffTex;
}
class Puffs {
  constructor(scene) { this.scene = scene; this.list = []; }
  add(p, dir) {
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: 0xdfe3d8, transparent: true, opacity: 0, depthWrite: false }));
      m.position.copy(p); m.scale.setScalar(0.01);
      m.userData = { v: dir.clone().multiplyScalar(0.1 + Math.random() * 0.06).add(new THREE.Vector3((Math.random() - 0.5) * 0.05, 0.04 + Math.random() * 0.04, (Math.random() - 0.5) * 0.05)), t: -i * 0.07, life: 1.4 + Math.random() * 0.6, r: 0.05 + Math.random() * 0.04 };
      this.scene.add(m); this.list.push(m);
    }
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i], u = m.userData; u.t += dt;
      if (u.t < 0) { m.visible = false; continue; }
      m.visible = true;
      const f = u.t / u.life;
      if (f >= 1) { this.scene.remove(m); m.material.dispose(); this.list.splice(i, 1); continue; }
      m.position.addScaledVector(u.v, dt); u.v.multiplyScalar(1 - dt * 1.2); u.v.y += dt * 0.03;
      m.scale.setScalar(0.02 + u.r * Math.sqrt(f));
      m.material.opacity = 0.42 * Math.min(1, f * 6) * (1 - f);
    }
  }
  clear() { for (const m of this.list) { this.scene.remove(m); m.material.dispose(); } this.list.length = 0; }
}

// ---------------- Rosy (a little dog) ----------------
function makeRosy() {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const fur = new THREE.MeshStandardMaterial({ color: 0xd99a7e, roughness: 0.9 }), dark = new THREE.MeshStandardMaterial({ color: 0x5a3426, roughness: 0.8 });
  const pink = new THREE.MeshStandardMaterial({ color: 0xe0507a, roughness: 0.5 }), black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
  const add = (parent, geo, m, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = true; parent.add(o); return o; };
  const sph = new THREE.SphereGeometry(1, 16, 12), cyl = new THREE.CylinderGeometry(1, 1, 1, 10);
  add(body, sph, fur, 0, 0.26, 0, 0.13, 0.12, 0.24);
  const head = new THREE.Group(); head.position.set(0, 0.36, 0.2); body.add(head);
  add(head, sph, fur, 0, 0, 0, 0.11, 0.1, 0.11); add(head, sph, fur, 0, -0.025, 0.09, 0.06, 0.05, 0.07); add(head, sph, black, 0, -0.01, 0.155, 0.02, 0.016, 0.014);
  for (const s of [-1, 1]) { add(head, sph, black, s * 0.045, 0.03, 0.09, 0.016, 0.018, 0.012); const ear = add(head, sph, dark, s * 0.08, 0.06, -0.01, 0.035, 0.07, 0.02); ear.rotation.z = s * 0.5; }
  add(head, cyl, pink, 0, -0.09, -0.02, 0.085, 0.022, 0.085); // collar
  const legs = []; for (const [x, z] of [[-0.07, 0.14], [0.07, 0.14], [-0.07, -0.14], [0.07, -0.14]]) { const g = new THREE.Group(); g.position.set(x, 0.2, z); body.add(g); add(g, cyl, fur, 0, -0.1, 0, 0.032, 0.2, 0.032); add(g, sph, dark, 0, -0.2, 0.01, 0.036, 0.02, 0.045); legs.push(g); }
  const tail = new THREE.Group(); tail.position.set(0, 0.32, -0.22); body.add(tail); add(tail, cyl, fur, 0, 0.06, -0.02, 0.022, 0.14, 0.022).rotation.x = -0.5;
  return { kind: 'rosy', root, body, head, legs, tail };
}
function poseRosy(R, s) {
  const t = s.t, sw = s.walk ? Math.sin(t * 14) * 0.6 * s.walk : 0;
  R.legs.forEach((g, i) => { g.rotation.x = s.lie ? (i < 2 ? -1.3 : 1.3) : (i === 0 || i === 3 ? sw : -sw); });
  R.tail.rotation.y = Math.sin(t * (s.cheer || s.dance ? 26 : s.lie ? 3 : 12)) * (s.lie ? 0.25 : 0.7);
  R.tail.rotation.x = s.panic ? 0.9 : 0;
  R.body.position.y = s.lie ? -0.15 : (s.walk ? Math.abs(Math.sin(t * 14)) * 0.025 * s.walk : 0) + (s.hop || 0) + (s.dance ? Math.abs(Math.sin(t * 6)) * 0.08 : 0);
  R.body.rotation.z = s.dance ? Math.sin(t * 6) * 0.25 : 0;
  R.head.rotation.x = s.lie ? 0.35 : s.cheer ? -0.4 : Math.sin(t * 1.7) * 0.08;
  R.head.rotation.y = s.look || 0;
}

// ---------------- Ted's voice lines (with subtitles) ----------------
export const TED_LINES = {
  bringit: 'Bring it in, you bastard! Come on!',
  email: 'Can you just e-mail me the rest of this story?',
  weak: 'Jesus, this is weak. Not even getting me high. I gotta have a talk with my weed guy.',
  cock: "You know you're acting like a cock, you know that?",
  shit: 'Shit.',
  idle: 'Thank you for creeping up my night, and Jesus be with you.',
  arfh: 'Arfh!',
  teddy: "I'm a fucking teddy bear!",
  problems: 'You got a lot of problems.',
  fuckme: 'Fuck me.',
  listen: "Look, I know you're pissed, alright, but just listen to me for five seconds.",
  pussy: "You're just making yourself look like a pussy.",
  thunder: '♪ Ted sings the Thunder Buddies song ♪',
};

// Timed subtitles for longer clips: line -> [[seconds into the clip, caption], ...]. When a line
// has an entry here, its subtitle follows these captions instead of the single TED_LINES text.
// (The Thunder Buddies song ships with a description only; fill in your own captions here.)
export const TED_CAPTIONS = {
  thunder: [],
};

// the player's choices for each of Ted's lines (Store > Sidekicks > Edit Ted): 'play' (default), 'bleep' or 'off'.
// They apply to every Ted heard on this screen.
let PREFS = {};
export function setTedPrefs(p) { PREFS = p || {}; }
export const tedPref = line => PREFS[line] || 'play';
// swearing in the subtitles is starred out when a line is bleeped
const SWEAR = /\b(bastard|cock|shit|fucking|fuck|pussy|pissed|jesus)\b/gi;
export const tedText = line => tedPref(line) === 'bleep' ? String(TED_LINES[line] || '').replace(SWEAR, w => w[0] + '*'.repeat(w.length - 1)) : TED_LINES[line];
// lines with swearing in them: what the 'Family friendly' button bleeps
export const TED_RUDE = Object.keys(TED_LINES).filter(k => new RegExp(SWEAR.source, 'i').test(TED_LINES[k]));

// lines Ted can say again; every other line is said at most once a match
const TED_REPEAT = new Set(['bringit', 'shit', 'cock', 'arfh']);
// one voice channel for every Ted in the match (on this screen): they never talk over each
// other, and a once-a-match line said by one Ted is never said again by another
const VOICE = { busyUntil: 0, said: new Set() };
export function resetVoices() { VOICE.busyUntil = 0; VOICE.said.clear(); }
const usable = line => TED_LINES[line] && tedPref(line) !== 'off' && (TED_REPEAT.has(line) || !VOICE.said.has(line));

// ---------------- the sidekick ----------------
export class Sidekick {
  constructor(scene, M, kind, ownerId) {
    this.scene = scene; this.M = M; this.kind = kind; this.ownerId = ownerId;
    this.rig = kind === 'ted' && ted ? makeTedRig() : makeRosy();
    this.real = this.rig.kind === kind;
    this.x = 0; this.z = 0; this.yaw = 0; this.t = Math.random() * 10; this.placed = false;
    this.mood = null; this.moodT = 0; this.stuck = 0; this.side = Math.random() < 0.5 ? -1 : 1;
    this.c = null; // Ted's camp: { ph, t, D (chair spot), S (where he stands to set it up), ... }
    this.puffs = new Puffs(scene);
    this.voiceAt = -99; this.said = {}; this.queue = []; this.idleNext = 40 + Math.random() * 50;
    scene.add(this.rig.root);
  }
  // queue a line (Ted only). gap: seconds before this Ted may say the same line again;
  // force: an important line (downed, caged) that waits its turn instead of being dropped
  say(line, gap = 30, force = false) {
    if (this.kind !== 'ted' || !usable(line)) return false;
    if (this.queue.some(q => q.line === line)) return false;
    if (!force && (this.t - this.voiceAt < 7 || this.queue.length)) return false;
    if (this.t - (this.said[line] ?? -999) < gap) return false;
    this.queue.push({ line, force, until: this.t + (force ? 6 : 0.5) });
    return true;
  }
  // speak the next queued line once nobody else is talking
  flushVoice(env) {
    while (this.queue.length && (this.t > this.queue[0].until || !usable(this.queue[0].line))) this.queue.shift();
    if (!this.queue.length || performance.now() < VOICE.busyUntil || !env.say || !R0(this)) return;
    const { line } = this.queue.shift();
    const len = env.say(line, this.x, this.z);
    if (len < 0) return; // out of earshot: it doesn't count
    VOICE.busyUntil = performance.now() + (len + 0.35) * 1000;
    VOICE.said.add(line); this.said[line] = this.t; this.voiceAt = this.t;
  }
  dispose() { this.scene.remove(this.rig.root); if (this.camp) this.scene.remove(this.camp); this.camp = null; this.c = null; this.puffs.clear(); }
  react(mood, time = 1.6) { this.mood = mood; this.moodT = time; }
  // where to camp for this owner state: a spot facing them
  campSpot(owner, mode) {
    const off = mode === 'cage' ? 1.4 : 1.1, a = (owner.yaw || 0) + (mode === 'repair' ? Math.PI * 0.75 : 0);
    const x = owner.x + Math.cos(a) * off, z = owner.z - Math.sin(a) * off, yaw = Math.atan2(owner.x - x, owner.z - z);
    // he stands just to the chair's right to unfold it
    return { x, z, yaw, sx: x - Math.cos(yaw) * 0.36 + Math.sin(yaw) * 0.08, sz: z + Math.sin(yaw) * 0.36 + Math.cos(yaw) * 0.08 };
  }
  // owner: the player (or null); env.visible
  update(dt, owner, env) {
    this.t += dt;
    this.puffs.update(dt);
    this.flushVoice(env);
    // seeing the owner go down
    if (owner && this.prevSt && this.prevSt !== 'down' && owner.st === 'down') { this.say('arfh', 0, true); this.say('fuckme', 0, true); }
    if (owner && this.prevSt && this.prevSt !== 'caged' && owner.st === 'caged') this.say('problems', 0, true);
    if (owner) this.prevSt = owner.st;
    if (owner && this.kind === 'ted' && env.visible !== false && owner.st !== 'out' && owner.st !== 'ghost') {
      // running from the monster
      if (owner.role === 'survivor' && owner.st === 'ok' && owner.mv === 2 && env.killerD != null && env.killerD < 14 && Math.random() < dt * 0.25) { const fresh = ['email', 'teddy', 'listen', 'thunder'].filter(usable), pool = fresh.length && Math.random() < 0.7 ? fresh : ['bringit']; this.say(pool[Math.floor(Math.random() * pool.length)], 45); }
      // the killer's Ted, chasing someone down
      if (owner.role === 'killer' && !owner.disguise && owner.mv >= 1 && env.survD != null && env.survD < 10 && Math.random() < dt * 0.2) this.say('pussy', 60);
      // every so often, for no reason at all
      if (this.t > this.idleNext) { this.idleNext = this.t + 70 + Math.random() * 60; if (!(this.c && this.c.ph === 'seated')) this.say('idle', 60); }
    }
    if (this.kind === 'ted' && !this.real && ted) { this.dispose(); this.rig = makeTedRig(); this.real = true; this.scene.add(this.rig.root); }
    const R = this.rig;
    if (!owner) { R.root.visible = false; return; }
    if (this.moodT > 0) { this.moodT -= dt; if (this.moodT <= 0) this.mood = null; }
    const dead = owner.st === 'dead', gone = owner.st === 'out' || owner.st === 'ghost';
    // Ted sets up camp (chair, beer, bong) by a dead owner, and also while they repair a generator
    // or sit in a cage; Rosy lies down beside them
    const campMode = dead ? 'dead' : owner.st === 'caged' ? 'cage' : (owner.act && owner.act.k === 'repair') ? 'repair' : null;
    R.root.visible = !gone && env.visible !== false;
    if (!this.placed) { this.x = owner.x + 1; this.z = owner.z - 0.6; this.placed = true; }
    if (R.kind === 'ted') { if (this.tedCamp(dt, owner, campMode)) return; }
    else if (campMode) {
      if (!this.deadAt || this.campMode !== campMode) this.deadAt = this.campSpot(owner, campMode);
      const D = this.deadAt;
      if (Math.hypot(D.x - this.x, D.z - this.z) > 0.08) this.stepTo(D.x, D.z, 3, dt);
      else { this.yaw += Math.atan2(Math.sin(D.yaw - this.yaw), Math.cos(D.yaw - this.yaw)) * Math.min(1, dt * 5); }
      const there = Math.hypot(D.x - this.x, D.z - this.z) <= 0.08;
      R.root.position.set(this.x, 0, this.z); R.root.rotation.y = this.yaw;
      poseRosy(R, { t: this.t, lie: there, walk: there ? 0 : 0.8 });
      this.campMode = campMode;
      return;
    }
    this.campMode = campMode; this.deadAt = null;
    this.follow(dt, owner);
  }
  follow(dt, owner) {
    const R = this.rig, pose = { t: this.t };
    // follow: a spot just behind and beside the owner; run to keep up, teleport if lost
    const ox = owner.x, oz = owner.z, oy = owner.yaw || 0;
    const tx = ox - Math.sin(oy) * 1.1 + Math.cos(oy) * 0.7 * this.side, tz = oz - Math.cos(oy) * 1.1 - Math.sin(oy) * 0.7 * this.side;
    const dx = tx - this.x, dz = tz - this.z, dist = Math.hypot(dx, dz);
    if (dist > 14) { this.x = tx; this.z = tz; }
    let speed = 0;
    if (this.mood === 'panic') { // run circles around the owner
      const a = this.t * 4; const px = ox + Math.cos(a) * 1.3, pz = oz + Math.sin(a) * 1.3;
      speed = 4.5; this.stepTo(px, pz, speed, dt);
    } else if (dist > 0.35) {
      speed = Math.min(6.5, dist * 2.4 + (owner.mv === 2 ? 2 : 0));
      this.stepTo(tx, tz, speed, dt);
    } else this.yaw += Math.atan2(Math.sin(oy - this.yaw), Math.cos(oy - this.yaw)) * Math.min(1, dt * 3);
    pose.walk = Math.min(1, speed / 3.5);
    pose.cheer = this.mood === 'cheer'; pose.panic = this.mood === 'panic'; pose.dance = this.mood === 'dance' || owner.emote === 1;
    pose.hop = this.mood === 'jump' ? Math.abs(Math.sin(this.moodT * 7)) * 0.18 : pose.cheer ? Math.abs(Math.sin(this.t * 9)) * 0.08 : 0;
    if (owner.emote === 3) pose.cheer = true;
    if (owner.emote === 2) pose.wave = true;
    if (owner.emote === 4) pose.bow = Math.min(1, (this.bowT = (this.bowT || 0) + dt) / 0.6) * (this.bowT < 2.4 ? 1 : Math.max(0, 1 - (this.bowT - 2.4) / 0.6));
    if (owner.emote !== 4) this.bowT = 0;
    R.root.position.set(this.x, 0, this.z); R.root.rotation.y = this.yaw;
    R.kind === 'ted' ? poseTed(R, pose) : poseRosy(R, pose);
  }
  turnTo(yaw, dt, k = 8) { this.yaw += Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw)) * Math.min(1, dt * k); }
  // Ted's camp, step by step: walk over, pull out the folded chair, set it down and open it,
  // climb in, beer and bong, then reverse it all when it's time to go.
  // Returns true while the camp is driving him (false: just follow the owner).
  tedCamp(dt, owner, mode) {
    const R = this.rig;
    let c = this.c;
    if (mode) {
      const spot = this.campSpot(owner, mode);
      if (!c) c = this.c = { ph: 'walk', t: 0, D: spot, props: 0, cyc: 0 };
      else if (c.ph !== 'getup' && c.ph !== 'fold' && (c.mode !== mode && Math.hypot(spot.x - c.D.x, spot.z - c.D.z) > 0.6)) {
        if (c.ph === 'walk') c.D = spot; else { c.ph = c.ph === 'seated' || c.ph === 'climb' ? 'getup' : 'fold'; c.t = 0; c.next = spot; }
      }
      c.mode = mode;
    } else if (c && c.ph !== 'getup' && c.ph !== 'fold') {
      if (c.ph === 'walk') { this.c = null; return false; }
      c.ph = c.ph === 'seated' || c.ph === 'climb' ? 'getup' : 'fold'; c.t = 0; c.next = null;
    }
    if (!c) return false;
    c.t += dt;
    const D = c.D, pose = { t: this.t }, fwd = new THREE.Vector3(Math.sin(D.yaw), 0, Math.cos(D.yaw));
    const needChair = () => {
      if (this.camp) return;
      this.camp = new THREE.Group(); this.chair = makeChair(); this.camp.add(this.chair); this.scene.add(this.camp);
    };
    let reach = null; // where his paws go while handling the chair (world points)
    let y = 0;
    switch (c.ph) {
      case 'walk': {
        const d = Math.hypot(D.sx - this.x, D.sz - this.z);
        if (d > 14) { this.x = D.sx; this.z = D.sz; }
        if (d > 0.05) { this.stepTo(D.sx, D.sz, Math.min(3.2, 1 + d * 2), dt); pose.walk = Math.min(1, 0.4 + d); }
        else { c.ph = 'unfold'; c.t = 0; }
        break;
      }
      case 'unfold': {
        // face the chair spot; pull the folded chair from behind his back, set it down, snap it open
        needChair();
        this.turnTo(Math.atan2(D.x - this.x, D.z - this.z), dt, 10);
        const t = c.t, grow = seg(t, 0, 0.35), lower = seg(t, 0.45, 0.9), open = seg(t, 0.95, 1.45);
        const me = new THREE.Vector3(this.x, 0, this.z), dir = new THREE.Vector3(D.x - this.x, 0, D.z - this.z).normalize();
        const held = me.clone().addScaledVector(dir, 0.16).setY(0.16), set = new THREE.Vector3(D.x, 0, D.z);
        this.camp.position.lerpVectors(held, set, lower);
        this.camp.rotation.y = Math.atan2(dir.x, dir.z) + (D.yaw - Math.atan2(dir.x, dir.z)) * lower;
        this.camp.scale.setScalar(Math.max(0.001, grow));
        foldChair(this.chair, open);
        pose.bend = Math.max(seg(t, 0.35, 0.8) * (1 - seg(t, 1.3, 1.7)), 0.25 * grow * (1 - lower));
        // both paws on the chair's back rail
        const top = this.camp.position.clone().add(new THREE.Vector3(0, 0.42 * this.camp.scale.y, 0));
        const side = new THREE.Vector3(Math.cos(this.camp.rotation.y), 0, -Math.sin(this.camp.rotation.y)).multiplyScalar(0.06);
        if (t > 0.15 && t < 1.5) reach = [top.clone().sub(side), top.clone().add(side)];
        if (t > 1.7) { c.ph = 'climb'; c.t = 0; c.from = { x: this.x, z: this.z, yaw: this.yaw }; }
        break;
      }
      case 'climb': {
        // turn his back to the chair, step back and hop up into the seat
        const t = c.t, turn = seg(t, 0, 0.45), slide = seg(t, 0.3, 1.0), sit = seg(t, 0.45, 1.05);
        let dy = D.yaw - c.from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw = c.from.yaw + dy * turn;
        this.x = c.from.x + (D.x - c.from.x) * slide; this.z = c.from.z + (D.z - c.from.z) * slide;
        pose.sit = sit; pose.walk = t < 0.45 ? 0.5 : 0;
        y = 0.13 * sit + Math.sin(Math.min(1, Math.max(0, (t - 0.4) / 0.55)) * Math.PI) * 0.09;
        if (t > 1.1) { c.ph = 'seated'; c.t = 0; c.cyc = 0; }
        break;
      }
      case 'seated': {
        this.x = D.x; this.z = D.z; this.yaw = D.yaw;
        pose.sit = 1; y = 0.13;
        c.props = Math.min(1, c.props + dt * 3); // he gets his beer and bong out
        c.cyc = (c.cyc + dt) % CYCLE;
        const k = c.cyc;
        // beer: raise (0.8s), long swig with his head back, lower (0.8s)
        const [d0, d1] = DRINK;
        c.drink = seg(k, d0, d0 + 0.8) * (1 - seg(k, d1 - 0.8, d1));
        c.sip = seg(k, d0 + 0.8, d1 - 0.8);
        // bong: lean in and lift it (0.7s), hit (bubbling), sit back, then breathe out a small puff
        const [s0, s1] = SMOKE;
        c.smoke = seg(k, s0, s0 + 0.7) * (1 - seg(k, s1 - 1.8, s1 - 1.2));
        pose.nod = -0.55 * c.drink - 0.15 * c.sip + 0.18 * c.smoke + (k > s1 - 1.2 && k < s1 ? -0.25 * Math.sin((k - (s1 - 1.2)) / 1.2 * Math.PI) : 0);
        pose.breathe = c.smoke * 0.12 + Math.sin(this.t * 1.6) * 0.015;
        if (c.smoke > 0.9) pose.bubble = Math.sin(this.t * 40) * 0.003;
        const ex = s1 - 1.05;
        if (k >= ex && k - dt < ex) c.exhale = true;
        break;
      }
      case 'getup': {
        // beer and bong away, hop down out of the chair, step aside
        const t = c.t; c.props = Math.max(0, c.props - dt * 3); c.drink = c.smoke = c.sip = 0;
        const off = seg(t, 0.25, 0.85), sit = 1 - seg(t, 0.25, 0.8);
        pose.sit = sit; y = 0.13 * sit + Math.sin(off * Math.PI) * 0.07;
        this.x = D.x + (D.sx - D.x) * off; this.z = D.z + (D.sz - D.z) * off; this.yaw = D.yaw;
        if (t > 0.9) { c.ph = 'fold'; c.t = 0; }
        break;
      }
      case 'fold': {
        // fold the chair up and tuck it away
        if (!this.camp) { c.ph = 'done'; break; }
        this.turnTo(Math.atan2(D.x - this.x, D.z - this.z), dt, 10);
        const t = c.t; c.props = Math.max(0, c.props - dt * 3);
        foldChair(this.chair, 1 - seg(t, 0.1, 0.5));
        const me = new THREE.Vector3(this.x, 0, this.z), lift = seg(t, 0.5, 0.85);
        const held = me.clone().add(new THREE.Vector3(D.x - this.x, 0, D.z - this.z).normalize().multiplyScalar(0.16)).setY(0.16);
        this.camp.position.lerpVectors(new THREE.Vector3(D.x, 0, D.z), held, lift);
        this.camp.scale.setScalar(Math.max(0.001, 1 - seg(t, 0.85, 1.15)));
        pose.bend = seg(t, 0, 0.3) * (1 - seg(t, 0.8, 1.1));
        const top = this.camp.position.clone().add(new THREE.Vector3(0, 0.42 * this.camp.scale.y, 0));
        const side = new THREE.Vector3(Math.cos(this.camp.rotation.y), 0, -Math.sin(this.camp.rotation.y)).multiplyScalar(0.06);
        if (t < 1.05) reach = [top.clone().sub(side), top.clone().add(side)];
        if (t > 1.2) c.ph = 'done';
        break;
      }
    }
    if (c.ph === 'done') {
      if (this.camp) this.scene.remove(this.camp);
      this.camp = null; this.chair = null; c.props = 0;
      R.bottle.visible = R.bong.visible = false;
      if (c.next) { this.c = { ph: 'walk', t: 0, D: c.next, props: 0, cyc: 0, mode: c.mode }; }
      else { this.c = null; return false; }
      return true;
    }
    R.root.position.set(this.x, y, this.z); R.root.rotation.y = this.yaw;
    poseTed(R, pose);
    R.root.updateMatrixWorld(true);
    const P = tedProps(R, c);
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)), down = new THREE.Vector3(0, -1, 0);
    if (reach) {
      tedReach(R, 'R', reach[0], right.clone().add(down)); tedReach(R, 'L', reach[1], right.clone().negate().add(down));
    } else if (P) {
      const k = c.props;
      if (k > 0.3) {
        tedReach(R, 'R', P.gripR, right.clone().multiplyScalar(1.2).add(down));
        tedReach(R, 'L', P.gripL, right.clone().negate().multiplyScalar(1.2).add(down));
      }
      if (c.exhale) { c.exhale = false; this.puffs.add(P.mouth, fwd); this.say('weak', 50); }
    }
    return true;
  }
  stepTo(x, z, speed, dt) {
    const dx = x - this.x, dz = z - this.z, d = Math.hypot(dx, dz) || 1, step = Math.min(d, speed * dt);
    const r = moveCircle(this.M, null, this.x, this.z, dx / d * step, dz / d * step, 0.18, 1.0);
    const moved = Math.hypot(r.x - this.x, r.z - this.z);
    this.stuck = moved < step * 0.2 ? this.stuck + dt : 0;
    if (this.stuck > 1.2) { this.x = x; this.z = z; this.stuck = 0; } else { this.x = r.x; this.z = r.z; }
    if (moved > 1e-3) this.yaw += Math.atan2(Math.sin(Math.atan2(dx, dz) - this.yaw), Math.cos(Math.atan2(dx, dz) - this.yaw)) * Math.min(1, dt * 10);
  }
}

const R0 = sk => sk.rig && sk.rig.root.visible;

// for menus: a sidekick standing in the showroom
export function makeSidekickModel(kind) {
  const R = kind === 'ted' && ted ? makeTedRig() : makeRosy();
  const pose = { t: 0 };
  R.pose = t => { pose.t = t; R.kind === 'ted' ? poseTed(R, pose) : poseRosy(R, pose); };
  R.pose(0);
  return R;
}
// (exposed for the pose-test page)
export const __poseTed = poseTed, __poseRosy = poseRosy, __tedReach = tedReach;
