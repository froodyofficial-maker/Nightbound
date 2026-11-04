// First-person arms cut from the killer's own third-person model, so you see your real hands, sleeves,
// gloves and weapon (with your outfit) instead of generic ones.
//
// From a built rig we take one forearm: for a skinned model, every triangle weighted to the forearm,
// the hand and the fingers, plus any rigid mesh hanging off them (Granny's bat, Grandpa's shotgun);
// for an unrigged model (the Slimer), the part of the mesh past the shoulder. It is frozen in its
// current pose and re-expressed in the viewmodel's arm space: wrist at the origin, the forearm running
// back toward the camera (+z), the back of the hand up.
import * as THREE from 'three';

const V = () => new THREE.Vector3();

// the smallest-variance direction of a point cloud (the normal of a flat hand)
function flatNormal(pts) {
  if (pts.length < 6) return null;
  const c = V(); for (const p of pts) c.add(p); c.multiplyScalar(1 / pts.length);
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) { const d = [p.x - c.x, p.y - c.y, p.z - c.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += d[i] * d[j]; }
  const mul = (M, v) => V().set(M[0] * v.x + M[1] * v.y + M[2] * v.z, M[3] * v.x + M[4] * v.y + M[5] * v.z, M[6] * v.x + M[7] * v.y + M[8] * v.z);
  const power = M => { let v = V().set(0.6, 0.7, 0.4).normalize(); for (let k = 0; k < 60; k++) { const w = mul(M, v); if (w.lengthSq() < 1e-20) break; v = w.normalize(); } return v; };
  const v1 = power(C), l1 = mul(C, v1).dot(v1);
  const C2 = C.slice(); const a = [v1.x, v1.y, v1.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C2[i * 3 + j] -= l1 * a[i] * a[j];
  const v2 = power(C2);
  return V().crossVectors(v1, v2).normalize();
}

// triangles (world space) of one mesh, kept where keep(vertexIndex) is true for all three corners
function grabTris(mesh, keep, pos, out) {
  const g = mesh.geometry, idx = g.index, n = idx ? idx.count : g.attributes.position.count;
  const uv = g.attributes.uv, mats = Array.isArray(mesh.material) ? mesh.material : null;
  const groups = mats && g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
  for (const gr of groups) {
    const mat = mats ? mats[gr.materialIndex] : mesh.material;
    if (!mat || mat.visible === false) continue;
    let bucket = out.get(mat); if (!bucket) out.set(mat, bucket = { p: [], uv: [] });
    for (let t = gr.start; t + 2 < gr.start + gr.count; t += 3) {
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      if (!keep(a) || !keep(b) || !keep(c)) continue;
      for (const k of [a, b, c]) { const p = pos(k); bucket.p.push(p.x, p.y, p.z); if (uv) bucket.uv.push(uv.getX(k), uv.getY(k)); else bucket.uv.push(0, 0); }
    }
  }
}
const shown = o => { for (let x = o; x; x = x.parent) if (x.visible === false) return false; return true; };

// side: 'R' or 'L'. Returns { group, tip, base, weapon } in viewmodel arm space, or null.
export function bakeArm(rigRoot, side, opt = {}) {
  rigRoot.updateMatrixWorld(true);
  const out = new Map(), weaponPts = [];
  let E, W, handPts = [];
  const sideRe = side === 'R' ? /(^|[^a-z])(r|right)([^a-z]|$)|right/i : /(^|[^a-z])(l|left)([^a-z]|$)|left/i;
  let hand = null;
  rigRoot.traverse(o => { if (!hand && o.isBone && shown(o) && /hand/i.test(o.name) && !/finger|thumb|index|middle|ring|pinky/i.test(o.name) && sideRe.test(o.name.replace(/hand/i, ' '))) hand = o; });
  if (hand) {
    const fore = hand.parent;
    const chain = new Set(); fore.traverse(o => chain.add(o));
    const handSet = new Set(); hand.traverse(o => handSet.add(o));
    E = fore.getWorldPosition(V()); W = hand.getWorldPosition(V());
    rigRoot.traverse(o => {
      if (!o.isMesh || !shown(o) || o.userData.aura || o.renderOrder >= 10) return;
      if (opt.skip && opt.skip.test((o.userData.baseName || '') + '|' + ((o.material && o.material.name) || '') + '|' + o.name)) return;
      if (o.isSkinnedMesh) {
        const sk = o.skeleton; sk.update();
        const inArm = sk.bones.map(b => chain.has(b)), inHand = sk.bones.map(b => handSet.has(b));
        const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
        if (!si || !inArm.some(Boolean)) return;
        const cache = new Map();
        const pos = k => { let p = cache.get(k); if (!p) { p = o.getVertexPosition(k, V()).applyMatrix4(o.matrixWorld); cache.set(k, p); } return p; };
        const keep = k => { let w = 0; for (let c = 0; c < 4; c++) if (inArm[si.getComponent(k, c)]) w += sw.getComponent(k, c); return w > 0.5; };
        grabTris(o, keep, pos, out);
        const n = o.geometry.attributes.position.count;
        for (let k = 0; k < n; k += 3) { let w = 0; for (let c = 0; c < 4; c++) if (inHand[si.getComponent(k, c)]) w += sw.getComponent(k, c); if (w > 0.6) handPts.push(pos(k)); }
      } else {
        // a rigid mesh hanging off the forearm or hand: the weapon
        if (opt.noRigid) return;
        let p = o.parent, ok = false; while (p) { if (chain.has(p)) { ok = true; break; } p = p.parent; }
        if (!ok) return;
        const P = o.geometry.attributes.position, pos = k => V().fromBufferAttribute(P, k).applyMatrix4(o.matrixWorld);
        grabTris(o, () => true, pos, out);
        for (let k = 0; k < P.count; k += 7) weaponPts.push(pos(k));
      }
    });
  } else if (opt.region) {
    // unrigged: everything past the shoulder on that side, in the model's facing frame
    const sx = side === 'R' ? opt.region.sign : -opt.region.sign;
    const pts = [];
    rigRoot.traverse(o => {
      if (!o.isMesh || !shown(o) || o.renderOrder >= 10) return;
      const P = o.geometry.attributes.position, loc = rigRoot.matrixWorld.clone().invert();
      const pos = k => V().fromBufferAttribute(P, k).applyMatrix4(o.matrixWorld);
      const lx = k => pos(k).applyMatrix4(loc).x * sx;
      const keep = k => lx(k) > opt.region.from;
      grabTris(o, keep, pos, out);
      for (let k = 0; k < P.count; k += 2) { const p = pos(k), x = p.clone().applyMatrix4(loc).x * sx; if (x > opt.region.from) pts.push([x, p]); }
    });
    if (pts.length < 20) return null;
    pts.sort((a, b) => a[0] - b[0]);
    const avg = arr => arr.reduce((s, q) => s.add(q[1]), V()).multiplyScalar(1 / arr.length);
    E = avg(pts.slice(0, Math.max(3, pts.length * 0.05 | 0)));
    const tip = avg(pts.slice(-Math.max(3, pts.length * 0.05 | 0)));
    W = E.clone().lerp(tip, opt.region.wrist ?? 0.7);
    const dW = W.distanceTo(E);
    handPts = pts.filter(q => q[1].distanceTo(E) > dW).map(q => q[1]);
  } else return null;
  if (!out.size || !E || E.distanceTo(W) < 1e-5) return null;

  // the arm's own frame: a along the forearm, n the hand's flat normal
  const a = W.clone().sub(E).normalize();
  let n = flatNormal(handPts) || V().set(0, 1, 0);
  n.addScaledVector(a, -n.dot(a)); if (n.lengthSq() < 1e-6) n = V().set(0, 1, 0).addScaledVector(a, -a.y); n.normalize();
  if (n.y < 0) n.negate(); // back of the hand: the side facing up in the model's rest pose
  if (opt.flip) n.negate();
  const x = V().crossVectors(n, a).normalize();
  // world -> arm space: a -> -z, n -> +y, x -> ... (right-handed)
  const basis = new THREE.Matrix4().makeBasis(x, n, a.clone().negate()).invert();
  const s = (opt.length ?? 0.42) / E.distanceTo(W);
  const M = new THREE.Matrix4().makeScale(s, s, s).multiply(basis).multiply(new THREE.Matrix4().makeTranslation(-W.x, -W.y, -W.z));
  // a held weapon: roll the arm about the forearm so it stands up out of the fist
  if (weaponPts.length && opt.weaponUp !== false) {
    let far = null, fd = -1; for (const p of weaponPts) { const q = p.clone().applyMatrix4(M), d = q.length(); if (d > fd) { fd = d; far = q; } }
    M.premultiply(new THREE.Matrix4().makeRotationZ(Math.atan2(far.x, far.y)));
  }
  if (opt.roll) M.premultiply(new THREE.Matrix4().makeRotationZ(opt.roll));
  if (opt.pitch) M.premultiply(new THREE.Matrix4().makeRotationX(opt.pitch));

  const group = new THREE.Group();
  for (const [mat, b] of out) {
    if (!b.p.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.applyMatrix4(M); geo.computeVertexNormals();
    const m = mat.clone(); if ('skinning' in m) m.skinning = false;
    m.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geo, m); mesh.frustumCulled = false; mesh.castShadow = false;
    group.add(mesh);
  }
  // the weapon's business end, for the swing trail and the blood
  let tip = null, base = null;
  if (weaponPts.length) {
    let far = null, fd = -1; for (const p of weaponPts) { const q = p.clone().applyMatrix4(M), d = q.length(); if (d > fd) { fd = d; far = q; } }
    tip = far; base = far.clone().multiplyScalar(0.3);
  }
  return { group, tip, base, weapon: weaponPts.length > 0 };
}
