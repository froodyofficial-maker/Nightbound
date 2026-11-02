// Outfit transformations: skins don't just recolour a character, they rebuild its look.
// Each skin lists `fx` entries: headgear and masks, body pieces (vests, cloaks, armour, chains),
// weapons, and whole-body effects (embers glowing through cracks, ghostly, frozen, gilded...).
// Pieces attach to the rig's joints (procedural characters) or bones (the Foreman's GLB model) and
// are sized from the character's own head and torso, so one mask fits every body.
import * as THREE from 'three';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({
  color, roughness: o.r ?? 0.6, metalness: o.m ?? 0, emissive: o.e ?? 0, emissiveIntensity: o.ei ?? 1,
  transparent: !!o.t, opacity: o.op ?? 1, side: o.ds ? THREE.DoubleSide : THREE.FrontSide, depthWrite: o.dw ?? true,
});
const GLOW = (() => { let t = null; return () => { if (t) return t; const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return (t = new THREE.CanvasTexture(c)); }; })();
const CRACKS = (() => { let t = null; return () => { if (t) return t; const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 256, 256);
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 70; i++) { let px = r() * 256, py = r() * 256; x.strokeStyle = `rgba(255,${150 + r() * 80 | 0},60,${0.5 + r() * 0.5})`; x.lineWidth = 0.8 + r() * 2.2; x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 6; k++) { px += (r() - 0.5) * 50; py += (r() - 0.5) * 50; x.lineTo(px, py); } x.stroke(); }
  t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }; })();

function mk(geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz); m.castShadow = true; return m;
}
function glow(color, size, x, y, z, op = 0.9) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW(), color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size); s.position.set(x, y, z); return s;
}
const S = (r, w = 18, h = 12, ...rest) => new THREE.SphereGeometry(r, w, h, ...rest);
const C = (a, b, h, n = 14, open = false) => new THREE.CylinderGeometry(a, b, h, n, 1, !!open);
const B = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const TO = (r, t, arc = Math.PI * 2, n = 18) => new THREE.TorusGeometry(r, t, 8, n, arc);
const CO = (r, h, n = 10) => new THREE.ConeGeometry(r, h, n);

// ---------- frames: where the head and torso are, in the joint/bone's own space ----------
const GLB_BONES = { head: 'Head', spine: 'Spine', hips: 'Hips', handR: 'RightHand', handL: 'LeftHand', shL: 'LeftArm', shR: 'RightArm' };
function joint(R, name) { return R.glb ? R.bones[GLB_BONES[name]] : R.j[name]; }
function boxOf(group) {
  const box = new THREE.Box3();
  for (const m of group.children) if (m.isMesh && m.geometry && !m.userData.fx) { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrix); box.union(b); }
  return box;
}
function frames(R) {
  if (R.glb) return {
    head: { cy: 0.14, top: 0.25, r: 0.15, front: 0.15, back: -0.13, eyeY: 0.17, eyeX: 0.05 },
    body: { cy: 0.5, top: 0.8, w: 0.2, d: 0.13, front: 0.13, back: -0.13, neck: 0.8, ground: -1.23, hip: -0.05 },
  };
  const hb = boxOf(R.j.head), sb = boxOf(R.j.spine);
  // faces measured from the model code (antlers, hat brims and long hair would skew a bounding box)
  const FACE = {
    survivor: { cy: 0.1, r: 0.096, top: 0.21, front: 0.1, back: -0.1, eyeY: 0.112, eyeX: 0.036 },
    harrower: { cy: 0.11, r: 0.12, top: 0.24, front: 0.17, back: -0.1, eyeY: 0.13, eyeX: 0.042 },
    lamplighter: { cy: 0.105, r: 0.11, top: 0.455, front: 0.115, back: -0.11, eyeY: 0.13, eyeX: 0.04 },
    wisp: { cy: 0.11, r: 0.11, top: 0.245, front: 0.11, back: -0.11, eyeY: 0.11, eyeX: 0.035 },
  }[R.kind === 'survivor' ? 'survivor' : R.killer];
  const r = Math.max(0.09, (hb.max.x - hb.min.x) / 2);
  return {
    head: FACE || { cy: (hb.min.y + hb.max.y) / 2, top: hb.max.y, r, front: hb.max.z, back: hb.min.z, eyeY: hb.min.y + (hb.max.y - hb.min.y) * 0.58, eyeX: r * 0.42 },
    body: { cy: 0.33, top: 0.56, w: Math.max(0.15, (sb.max.x - sb.min.x) / 2 * 0.82), d: Math.max(0.1, (sb.max.z - sb.min.z) / 2), front: sb.max.z, back: sb.min.z, neck: 0.58, ground: -(R.j.hips.position.y || 0.9) - 0.02, hip: 0 },
  };
}

// ---------- headgear & masks (head space) ----------
const HEAD = {
  cap(h, o) { const g = new THREE.Group(), m = std(o.color ?? 0x1a1e26, { r: 0.85 });
    g.add(mk(S(h.r * 1.04, 18, 10, 0, 6.3, 0, 1.6), m, 0, h.cy + h.r * 0.15, 0, 0, 0, 0, 1, 0.75, 1));
    g.add(mk(B(h.r * 1.5, h.r * 0.08, h.r * 1.1), m, 0, h.cy + h.r * 0.2, h.front - h.r * 0.05, -0.12)); return g; },
  beanie(h, o) { const g = new THREE.Group(), m = std(o.color ?? 0x3a2a20, { r: 1 });
    g.add(mk(S(h.r * 1.07, 18, 12), m, 0, h.cy + h.r * 0.28, -h.r * 0.02, 0, 0, 0, 1, 0.92, 1.02));
    g.add(mk(TO(h.r * 1.03, h.r * 0.12), m, 0, h.cy + h.r * 0.05, 0, Math.PI / 2)); return g; },
  hardhat(h, o) { const g = new THREE.Group(), m = std(o.color ?? 0xe0b020, { r: 0.35, m: 0.1 });
    g.add(mk(S(h.r * 1.14, 20, 10, 0, 6.3, 0, 1.6), m, 0, h.cy + h.r * 0.2, 0, 0, 0, 0, 1, 0.82, 1.08));
    g.add(mk(C(h.r * 1.42, h.r * 1.42, h.r * 0.06, 24), m, 0, h.cy + h.r * 0.22, h.r * 0.08, 0, 0, 0, 1, 1, 1.12));
    g.add(mk(B(h.r * 0.18, h.r * 0.12, h.r * 2.2), m, 0, h.cy + h.r * 1.08, 0));
    if (o.lamp) { const lm = std(0x222222, { m: 0.6, r: 0.4 }); g.add(mk(C(h.r * 0.2, h.r * 0.24, h.r * 0.25, 12), lm, 0, h.cy + h.r * 0.55, h.front + h.r * 0.12, Math.PI / 2));
      const lens = mk(new THREE.CircleGeometry(h.r * 0.18, 14), new THREE.MeshBasicMaterial({ color: 0xfff4d0, toneMapped: false }), 0, h.cy + h.r * 0.55, h.front + h.r * 0.25); lens.castShadow = false; g.add(lens); g.add(glow(0xfff0c0, h.r * 2.4, 0, h.cy + h.r * 0.55, h.front + h.r * 0.32, 0.8)); }
    return g; },
  boonie(h, o) { const g = new THREE.Group(), m = std(o.color ?? 0x4a5236, { r: 1, ds: true });
    g.add(mk(C(h.r * 0.95, h.r * 1.05, h.r * 0.75, 18), m, 0, h.cy + h.r * 0.62, 0));
    g.add(mk(C(h.r * 1.75, h.r * 1.75, h.r * 0.04, 24), m, 0, h.cy + h.r * 0.28, 0, 0.06)); return g; },
  headlamp(h) { const g = new THREE.Group();
    g.add(mk(TO(h.r * 1.02, h.r * 0.06), std(0x1a1a1a), 0, h.cy + h.r * 0.35, 0, Math.PI / 2 + 0.1));
    g.add(mk(B(h.r * 0.45, h.r * 0.3, h.r * 0.25), std(0x2a2a2a, { m: 0.5 }), 0, h.cy + h.r * 0.4, h.front + h.r * 0.05));
    g.add(glow(0xfff4d0, h.r * 2.6, 0, h.cy + h.r * 0.4, h.front + h.r * 0.25)); return g; },
  goggles(h, o) { const g = new THREE.Group(), band = std(0x2a2018), glass = std(o.color ?? 0x3a8a9a, { r: 0.1, m: 0.4, e: o.color ?? 0x1a4a5a, ei: 0.6 });
    const y = o.down ? h.eyeY : h.cy + h.r * 0.62;
    g.add(mk(TO(h.r * 1.04, h.r * 0.07), band, 0, y, 0, Math.PI / 2));
    for (const s of [-1, 1]) { g.add(mk(C(h.r * 0.26, h.r * 0.26, h.r * 0.2, 14), std(0x3a3a3a, { m: 0.6 }), s * h.eyeX * 1.1, y, h.front - h.r * 0.02, Math.PI / 2 - (o.down ? 0 : 0.5))); g.add(mk(new THREE.CircleGeometry(h.r * 0.21, 14), glass, s * h.eyeX * 1.1, y + (o.down ? 0 : h.r * 0.05), h.front + h.r * 0.09, o.down ? 0 : -0.5)); }
    return g; },
  gasmask(h, o) { const g = new THREE.Group(), rub = std(o.color ?? 0x24262a, { r: 0.75 }), glass = std(0x0a1a1a, { r: 0.05, m: 0.6, e: o.eye ?? 0x103030, ei: o.eye ? 1.4 : 0.4 });
    g.add(mk(S(h.r * 0.86, 18, 12), rub, 0, h.cy - h.r * 0.12, h.front - h.r * 0.45, 0, 0, 0, 1.02, 1.0, 0.72));
    for (const s of [-1, 1]) { g.add(mk(C(h.r * 0.25, h.r * 0.25, h.r * 0.16, 16), std(0x55585a, { m: 0.7, r: 0.3 }), s * h.eyeX, h.eyeY, h.front + h.r * 0.03, Math.PI / 2)); g.add(mk(new THREE.CircleGeometry(h.r * 0.2, 16), glass, s * h.eyeX, h.eyeY, h.front + h.r * 0.115)); if (o.eye) g.add(glow(o.eye, h.r * 1.1, s * h.eyeX, h.eyeY, h.front + h.r * 0.2, 0.7)); }
    g.add(mk(C(h.r * 0.28, h.r * 0.32, h.r * 0.5, 16), std(o.filter ?? 0x4a4a2a, { m: 0.4 }), 0, h.cy - h.r * 0.55, h.front + h.r * 0.12, Math.PI / 2 + 0.5));
    for (const y of [h.cy + h.r * 0.45, h.cy - h.r * 0.25]) g.add(mk(TO(h.r * 1.0, h.r * 0.05), rub, 0, y, -h.r * 0.05, Math.PI / 2 + (y > h.cy ? -0.3 : 0.2)));
    return g; },
  respirator(h, o) { const g = new THREE.Group(), m = std(o.color ?? 0x3a3c3e, { r: 0.6 });
    g.add(mk(S(h.r * 0.5, 14, 10), m, 0, h.cy - h.r * 0.42, h.front - h.r * 0.12, 0, 0, 0, 1.2, 0.9, 0.7));
    for (const s of [-1, 1]) g.add(mk(C(h.r * 0.2, h.r * 0.2, h.r * 0.16, 14), std(o.filter ?? 0xc04020, { r: 0.5 }), s * h.r * 0.42, h.cy - h.r * 0.5, h.front - h.r * 0.05, Math.PI / 2, 0, s * 0.5));
    g.add(mk(TO(h.r * 0.98, h.r * 0.04), m, 0, h.cy - h.r * 0.1, 0, Math.PI / 2 - 0.25)); return g; },
  hockey(h, o) { const g = new THREE.Group(), m = std(o.color ?? 0xe8e4d8, { r: 0.4 }), d = std(0x050505);
    g.add(mk(S(h.r * 0.95, 18, 14), m, 0, h.cy, h.front - h.r * 0.5, 0, 0, 0, 0.92, 1.18, 0.62));
    for (let i = 0; i < 14; i++) { const a = i * 2.4, rr = 0.25 + (i % 4) * 0.12; g.add(mk(S(h.r * 0.05, 6, 4), d, Math.cos(a) * h.r * rr, h.cy - h.r * 0.35 + (i % 5) * h.r * 0.08, h.front + h.r * 0.07, 0, 0, 0, 1, 1, 0.4)); }
    for (const s of [-1, 1]) { g.add(mk(S(h.r * 0.17, 10, 8), d, s * h.eyeX, h.eyeY, h.front + h.r * 0.04, 0, 0, 0, 1.3, 0.8, 0.4)); if (o.chevron) g.add(mk(B(h.r * 0.42, h.r * 0.07, h.r * 0.02), std(o.chevron), s * h.eyeX, h.eyeY + h.r * 0.25, h.front + h.r * 0.08, 0, 0, s * 0.45)); }
    return g; },
  skull(h, o) { const g = new THREE.Group(), m = std(o.color ?? 0xe0d6c0, { r: 0.55 }), d = std(0x050403);
    g.add(mk(S(h.r * 1.12, 20, 14), m, 0, h.cy + h.r * 0.12, -h.r * 0.02, 0, 0, 0, 1, 1.05, 1.08));
    g.add(mk(B(h.r * 1.2, h.r * 0.5, h.r * 0.8), m, 0, h.cy - h.r * 0.62, h.front - h.r * 0.3));
    for (const s of [-1, 1]) g.add(mk(S(h.r * 0.26, 10, 8), d, s * h.eyeX * 1.05, h.eyeY, h.front + h.r * 0.02, 0, 0, 0, 1, 1.15, 0.6));
    g.add(mk(CO(h.r * 0.12, h.r * 0.22, 3), d, 0, h.cy - h.r * 0.18, h.front + h.r * 0.05, Math.PI));
    for (let i = -3; i <= 3; i++) g.add(mk(B(h.r * 0.12, h.r * 0.2, h.r * 0.06), m, i * h.r * 0.15, h.cy - h.r * 0.62, h.front + h.r * 0.12));
    return g; },
  pighead(h) { const g = new THREE.Group(), skin = std(0xe0a0a0, { r: 0.5 }), dark = std(0x1a0808);
    g.add(mk(S(h.r * 1.32, 20, 14), skin, 0, h.cy, h.r * 0.05, 0, 0, 0, 1.0, 1.0, 1.08));
    g.add(mk(C(h.r * 0.45, h.r * 0.52, h.r * 0.5, 18), skin, 0, h.cy - h.r * 0.3, h.front + h.r * 0.45, Math.PI / 2));
    for (const s of [-1, 1]) { g.add(mk(S(h.r * 0.1, 8, 6), dark, s * h.r * 0.17, h.cy - h.r * 0.3, h.front + h.r * 0.71, 0, 0, 0, 1, 1.3, 0.3)); g.add(mk(S(h.r * 0.12, 8, 6), dark, s * h.r * 0.5, h.cy + h.r * 0.28, h.front + h.r * 0.25)); g.add(mk(CO(h.r * 0.38, h.r * 0.7, 3), skin, s * h.r * 0.85, h.cy + h.r * 1.0, -h.r * 0.1, 0.3, 0, -s * 0.65, 1, 1, 0.35)); }
    g.add(mk(B(h.r * 1.1, h.r * 0.06, h.r * 0.5), std(0x5a0a08, { r: 0.2 }), 0, h.cy - h.r * 0.95, h.front, 0.3)); // stitched, bloody seam
    return g; },
  horns(h, o) { const g = new THREE.Group(), m = std(o.color ?? 0x1a1410, { r: 0.4, m: 0.2 });
    for (const s of [-1, 1]) { const horn = mk(new THREE.TorusGeometry(h.r * 0.9, h.r * 0.13, 8, 16, Math.PI * 0.9), m, s * h.r * 0.75, h.top - h.r * 0.1, -h.r * 0.15, 0, s > 0 ? 0 : Math.PI, 0.2); horn.scale.set(1, 1.2, 1); g.add(horn); g.add(mk(CO(h.r * 0.13, h.r * 0.5, 8), m, s * (h.r * 0.75 + h.r * 0.9 * 1), h.top + h.r * 0.2, -h.r * 0.15, 0, 0, -s * 0.4)); }
    return g; },
  antlers(h, o) { const g = new THREE.Group(), m = o.ice ? std(0xbfe8ff, { r: 0.05, m: 0.1, t: true, op: 0.75, e: 0x3a8ac8, ei: 0.8 }) : std(o.color ?? 0xc8a050, { r: o.metal ? 0.25 : 0.6, m: o.metal ? 0.9 : 0 });
    const k = o.size ?? 1.4;
    for (const s of [-1, 1]) {
      let x = s * h.r * 0.45, y = h.top - h.r * 0.05, ang = s * 0.5;
      for (let seg = 0; seg < 4; seg++) {
        const len = h.r * 0.9 * k * (1 - seg * 0.12), nx = x + Math.sin(ang) * len, ny = y + Math.cos(ang) * len;
        g.add(mk(C(h.r * 0.07 * (1 - seg * 0.18), h.r * 0.09 * (1 - seg * 0.18), len, 6), m, (x + nx) / 2, (y + ny) / 2, -h.r * 0.1, 0, 0, -ang));
        const tl = len * 0.7, ta = ang + s * 0.9 * (seg % 2 ? -0.6 : 1);
        g.add(mk(CO(h.r * 0.05, tl, 6), m, nx + Math.sin(ta) * tl / 2, ny + Math.cos(ta) * tl / 2, -h.r * 0.1 + (seg % 2 ? h.r * 0.2 : -h.r * 0.1), 0, 0, -ta));
        x = nx; y = ny; ang += s * 0.35 - s * 0.6 * (seg === 1 ? 1 : 0);
      }
      if (o.ice) for (let i = 0; i < 3; i++) g.add(glow(0x8ad8ff, h.r * 1.2, s * h.r * (0.8 + i * 0.5), h.top + h.r * (0.8 + i * 0.6), 0, 0.4));
    }
    return g; },
  crown(h, o) { const g = new THREE.Group(), m = std(o.color ?? 0xd8b040, { r: 0.25, m: 0.95 });
    g.add(mk(C(h.r * 0.95, h.r * 0.9, h.r * 0.28, 22, 1), m, 0, h.top - h.r * 0.02, 0));
    for (let i = 0; i < 9; i++) { const a = i / 9 * 6.283; g.add(mk(CO(h.r * 0.13, h.r * (i % 2 ? 0.45 : 0.75), 6), m, Math.cos(a) * h.r * 0.9, h.top + h.r * (i % 2 ? 0.32 : 0.48), Math.sin(a) * h.r * 0.9)); }
    if (o.gem) g.add(mk(S(h.r * 0.1, 10, 8), std(o.gem, { e: o.gem, ei: 1.5, r: 0.1 }), 0, h.top + h.r * 0.05, h.r * 0.95));
    return g; },
  candles(h, o) { const g = new THREE.Group(), wax = std(0xe8e0cc, { r: 0.7 }), flames = [];
    g.add(mk(TO(h.r * 0.95, h.r * 0.08), std(0x2a2420, { m: 0.6 }), 0, h.top - h.r * 0.15, 0, Math.PI / 2));
    for (let i = 0; i < 7; i++) { const a = i / 7 * 6.283, hh = h.r * (0.4 + (i % 3) * 0.22), x = Math.cos(a) * h.r * 0.95, z = Math.sin(a) * h.r * 0.95;
      g.add(mk(C(h.r * 0.07, h.r * 0.08, hh, 8), wax, x, h.top - h.r * 0.1 + hh / 2, z));
      const f = glow(o.color ?? 0xffa040, h.r * 0.55, x, h.top - h.r * 0.05 + hh + h.r * 0.12, z, 1); f.userData.flame = true; f.userData.base = h.r * 0.55; g.add(f); flames.push(f); }
    g.userData.flames = flames; return g; },
  halo(h, o) { const g = new THREE.Group(), c = o.color ?? 0xff2a10;
    const ring = mk(TO(h.r * 2.2, h.r * 0.12, Math.PI * 2, 48), std(0x220400, { e: c, ei: 2.5, r: 0.3 }), 0, h.cy + h.r * 0.5, -h.r * 1.4);
    g.add(ring); g.add(glow(c, h.r * 7, 0, h.cy + h.r * 0.5, -h.r * 1.5, 0.35)); g.userData.spin = ring; return g; },
  veil(h, o) { const g = new THREE.Group(), m = std(o.color ?? 0x0c0c10, { r: 0.9, t: true, op: o.op ?? 0.82, ds: true, dw: false });
    const geo = new THREE.CylinderGeometry(h.r * 0.95, h.r * (o.wide ?? 3.0), h.r * (o.len ?? 9), 22, 1, true); geo.translate(0, -h.r * (o.len ?? 9) / 2, 0);
    g.add(mk(geo, m, 0, h.top + h.r * 0.05, -h.r * 0.05)); g.add(mk(S(h.r * 1.06, 18, 12, 0, 6.3, 0, 1.4), m, 0, h.cy + h.r * 0.15, 0)); return g; },
  hood(h, o) { const g = new THREE.Group(), m = std(o.color ?? 0x5a0a0c, { r: 1, ds: true });
    g.add(mk(new THREE.SphereGeometry(h.r * 1.38, 20, 14, Math.PI * 0.62, Math.PI * 1.76, 0, Math.PI * 0.72), m, 0, h.cy + h.r * 0.12, -h.r * 0.1));
    g.add(mk(CO(h.r * 0.5, h.r * 1.0, 10), m, 0, h.cy + h.r * 0.75, -h.r * 1.0, -1.1)); return g; },
  eyes(h, o) { const g = new THREE.Group(), c = o.color ?? 0x7affd0;
    for (const s of [-1, 1]) { g.add(mk(S(h.r * 0.07, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(4), toneMapped: false }), s * h.eyeX, h.eyeY, h.front + h.r * 0.02)); g.add(glow(c, h.r * 1.0, s * h.eyeX, h.eyeY, h.front + h.r * 0.1, 0.85)); }
    return g; },
  hairnet(h) { return mk(S(h.r * 1.08, 18, 10, 0, 6.3, 0, 1.7), std(0xf0f0f0, { r: 0.9, t: true, op: 0.85 }), 0, h.cy + h.r * 0.15, -h.r * 0.03); },
};

// ---------- body pieces (spine space) ----------
const BODY = {
  hivis(b, o) { const g = new THREE.Group(), m = std(o.color ?? 0xe8d020, { r: 0.6, e: o.color ?? 0xe8d020, ei: 0.12, ds: true }), refl = std(0xd8d8d8, { r: 0.2, m: 0.5, e: 0xcfcfcf, ei: 0.45 });
    const geo = C(b.w * 1.12, b.w * 1.05, (b.top - 0.08) * 0.82, 20, true); g.add(mk(geo, m, 0, b.cy + 0.02, (b.front + b.back) / 2, 0, 0, 0, 1, 1, b.d / b.w * 1.18));
    for (const y of [b.cy - 0.06, b.cy + 0.06]) g.add(mk(TO(b.w * 1.14, 0.012, Math.PI * 2, 28), refl, 0, y, (b.front + b.back) / 2, Math.PI / 2, 0, 0, 1, b.d / b.w * 1.2, 1));
    return g; },
  armor(b, o) { const g = new THREE.Group(), m = std(o.color ?? 0x2a2e26, { r: 0.75 });
    g.add(mk(B(b.w * 1.55, (b.top - 0.1) * 0.62, 0.06), m, 0, b.cy + 0.04, b.front + 0.02)); g.add(mk(B(b.w * 1.55, (b.top - 0.1) * 0.62, 0.06), m, 0, b.cy + 0.04, b.back - 0.02));
    for (let i = -1; i <= 1; i++) g.add(mk(B(b.w * 0.4, 0.09, 0.07), std(0x3a3e34, { r: 0.8 }), i * b.w * 0.48, b.cy - 0.09, b.front + 0.07));
    if (o.patch) { const p = mk(B(0.09, 0.025, 0.01), std(o.patch, { e: o.patch, ei: 0.3 }), 0, b.cy + 0.12, b.front + 0.055); g.add(p); g.add(mk(B(0.025, 0.09, 0.01), p.material, 0, b.cy + 0.12, b.front + 0.055)); }
    return g; },
  cloak(b, o) { const g = new THREE.Group(), m = std(o.color ?? 0x101012, { r: 1, ds: true, e: o.glow ?? 0, ei: o.glow ? 0.25 : 0 });
    const len = b.top - b.ground - 0.06;
    const geo = new THREE.CylinderGeometry(b.w * 1.08, Math.min(b.w * (o.flare ?? 2.1), 0.6), len, 24, 6, true, Math.PI * 0.68, Math.PI * 1.64); geo.translate(0, -len / 2, 0);
    const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (o.tatter && y < -len * 0.82) p.setY(i, y + Math.sin(i * 7.7) * len * 0.07); }
    g.add(mk(geo, m, 0, b.top, (b.front + b.back) / 2 - 0.01, 0, 0, 0, 1, 1, 0.82));
    g.add(mk(TO(b.w * 0.75, 0.04, Math.PI * 2, 20), m, 0, b.top - 0.02, (b.front + b.back) / 2, Math.PI / 2));
    return g; },
  coat(b, o) { const g = new THREE.Group(), m = std(o.color ?? 0x5a3a20, { r: 0.9, ds: true });
    const len = (b.top - b.ground) * 0.72;
    const geo = new THREE.CylinderGeometry(b.w * 1.1, b.w * 1.55, len, 22, 4, true, 0.35, Math.PI * 2 - 0.7); geo.translate(0, -len / 2, 0);
    g.add(mk(geo, m, 0, b.top - 0.02, (b.front + b.back) / 2, 0, 0, 0, 1, 1, 0.78));
    for (const s of [-1, 1]) g.add(mk(B(0.07, 0.2, 0.02), m, s * 0.06, b.top - 0.12, b.front + 0.02, 0.2, 0, s * 0.35));
    return g; },
  chains(b, o) { const g = new THREE.Group(), m = std(o.color ?? 0x6a6a6a, { r: 0.35, m: 0.9 });
    for (const side of o.cross ? [-1, 1] : [1]) {
      const a = new THREE.Vector3(side * b.w * 0.95, b.top - 0.03, b.front), c = new THREE.Vector3(-side * b.w * 0.9, b.hip + 0.02, b.front);
      const n = 16; for (let i = 0; i <= n; i++) { const p = a.clone().lerp(c, i / n); p.z += Math.sin(i / n * Math.PI) * 0.05;
        g.add(mk(TO(0.022, 0.007, Math.PI * 2, 8), m, p.x, p.y, p.z, i % 2 ? Math.PI / 2 : 0, 0, Math.atan2(c.x - a.x, a.y - c.y))); }
    }
    return g; },
  backpack(b, o) { const g = new THREE.Group(), m = std(o.color ?? 0x3a3a2a, { r: 0.95 });
    g.add(mk(B(b.w * 1.3, (b.top - 0.1) * 0.75, 0.2), m, 0, b.cy + 0.04, b.back - 0.1)); g.add(mk(C(0.06, 0.06, b.w * 1.4, 10), std(0x5a4a3a), 0, b.top - 0.03, b.back - 0.14, 0, 0, Math.PI / 2));
    if (o.radio) { g.add(mk(C(0.006, 0.006, 0.5, 4), std(0x111111), b.w * 0.45, b.top + 0.22, b.back - 0.12)); const L = glow(0xff2a1a, 0.08, b.w * 0.45, b.top + 0.47, b.back - 0.12, 1); L.userData.blink = true; g.add(L); }
    if (o.cross) { const r = std(0xd02020); g.add(mk(B(0.1, 0.03, 0.01), r, 0, b.cy + 0.08, b.back - 0.205)); g.add(mk(B(0.03, 0.1, 0.01), r, 0, b.cy + 0.08, b.back - 0.205)); }
    return g; },
  camera(b) { const g = new THREE.Group();
    g.add(mk(B(0.13, 0.08, 0.06), std(0x1a1a1a, { r: 0.5 }), 0.04, b.cy + 0.02, b.front + 0.05)); g.add(mk(C(0.03, 0.035, 0.07, 14), std(0x2a2a2a, { m: 0.5 }), 0.04, b.cy + 0.02, b.front + 0.11, Math.PI / 2));
    g.add(mk(new THREE.CircleGeometry(0.024, 14), std(0x203040, { r: 0.05, m: 0.8 }), 0.04, b.cy + 0.02, b.front + 0.146)); g.add(mk(TO(b.w * 0.95, 0.008, Math.PI * 2, 24), std(0x2a2018), 0, b.cy + 0.15, 0, Math.PI / 2 - 0.5)); return g; },
  scarf(b, o) { const g = new THREE.Group(), m = std(o.color ?? 0x7a1a1a, { r: 1 });
    g.add(mk(TO(b.w * 0.46, 0.04, Math.PI * 2, 18), m, 0, b.neck - 0.02, 0.01, Math.PI / 2));
    g.add(mk(B(0.07, 0.3, 0.025), m, 0.05, b.neck - 0.2, b.front + 0.015, 0.05, 0, 0.12)); return g; },
  toolbelt(b) { const g = new THREE.Group(), m = std(0x3a2414, { r: 0.8 }), steel = std(0x8a8a8a, { m: 0.8, r: 0.35 });
    g.add(mk(TO(b.w * 0.95, 0.025, Math.PI * 2, 24), m, 0, b.hip + 0.05, 0, Math.PI / 2, 0, 0, 1, b.d / b.w * 1.2, 1));
    g.add(mk(B(0.03, 0.22, 0.012), steel, b.w * 0.75, b.hip - 0.07, b.front * 0.6)); g.add(mk(B(0.1, 0.12, 0.06), m, -b.w * 0.75, b.hip - 0.02, b.front * 0.5)); g.add(mk(C(0.012, 0.012, 0.2, 6), std(0x6a3a1a), -b.w * 0.3, b.hip - 0.05, b.front + 0.02)); return g; },
  moss(b, o) { const g = new THREE.Group(), m = std(o.color ?? 0x3a5a2a, { r: 1, ds: true, e: o.glow ?? 0x0a2a0a, ei: 0.5 });
    for (let i = 0; i < 26; i++) { const a = i * 0.9, len = 0.2 + (i % 5) * 0.11, x = Math.cos(a) * b.w * 1.02, z = Math.sin(a) * b.d * 1.1;
      const geo = new THREE.PlaneGeometry(0.035 + (i % 3) * 0.015, len); geo.translate(0, -len / 2, 0); g.add(mk(geo, m, x, b.top - 0.02 - (i % 4) * 0.08, z, 0, -a + Math.PI / 2, (i % 2 ? 0.1 : -0.1))); }
    return g; },
  blood(b) { const g = new THREE.Group(), m = std(0x4a0303, { r: 0.2, e: 0x140000, ei: 0.4 });
    // small flat splashes and runs, mostly on the front
    for (let i = 0; i < 16; i++) { const x = Math.sin(i * 2.7) * b.w * 0.7, y = b.cy + 0.18 - (i % 6) * 0.07, front = i % 4 !== 0;
      g.add(mk(S(0.018 + (i % 4) * 0.01, 8, 6), m, x, y, (front ? b.front + 0.004 : b.back - 0.004), 0, 0, i * 0.7, 1, 2.2, 0.08)); }
    return g; },
  spikes(b, o) { const g = new THREE.Group(), m = std(o.color ?? 0x2a2a2c, { m: 0.8, r: 0.35 });
    for (const s of [-1, 1]) { g.add(mk(S(0.11, 12, 8, 0, 6.3, 0, 1.6), m, s * b.w * 0.95, b.top - 0.05, 0, 0, 0, s * 0.35, 1, 0.8, 1)); for (let k = 0; k < 3; k++) g.add(mk(CO(0.025, 0.13, 6), m, s * (b.w * 0.95 + (k - 1) * 0.04 * s), b.top + 0.04, (k - 1) * 0.06, 0, 0, -s * 0.35)); }
    return g; },
  hooks(b) { const g = new THREE.Group(), m = std(0x7a7a78, { m: 0.85, r: 0.3 });
    g.add(mk(TO(b.w * 0.97, 0.02, Math.PI * 2, 24), std(0x2a1a10), 0, b.hip + 0.04, 0, Math.PI / 2, 0, 0, 1, b.d / b.w * 1.2, 1));
    for (let i = 0; i < 4; i++) { const a = -0.6 + i * 0.45, x = Math.sin(a) * b.w, z = Math.cos(a) * b.d; g.add(mk(C(0.006, 0.006, 0.18, 4), m, x, b.hip - 0.06, z)); g.add(mk(TO(0.045, 0.009, Math.PI * 1.4, 10), m, x, b.hip - 0.18, z, 0, a, 0.6)); }
    return g; },
  axe(b) { const g = new THREE.Group();
    g.add(mk(C(0.018, 0.022, 0.75, 8), std(0x6a3a1a, { r: 0.8 }), 0.05, b.cy + 0.05, b.back - 0.08, 0, 0, 0.5)); g.add(mk(B(0.03, 0.14, 0.18), std(0xa01a10, { m: 0.5, r: 0.4 }), 0.05 - Math.sin(0.5) * 0.36, b.cy + 0.05 + Math.cos(0.5) * 0.36, b.back - 0.08, 0, 0, 0.5)); return g; },
};

// ---------- weapons (hand space: the arm runs down -y) ----------
const HAND = {
  cleaver(o) { const g = new THREE.Group(), steel = std(0xd0d4d8, { m: 0.95, r: 0.15 });
    g.add(mk(C(0.025, 0.028, 0.18, 8), std(0x1a1210, { r: 0.7 }), 0, -0.06, 0.02, Math.PI / 2)); g.add(mk(B(0.02, 0.36, 0.5), steel, 0, -0.16, 0.36));
    if (o.blood) g.add(mk(B(0.022, 0.16, 0.24), std(0x5a0604, { r: 0.15 }), 0, -0.24, 0.48)); return g; },
  scythe(o) { const g = new THREE.Group(), m = std(o.color ?? 0x2a2420, { r: 0.7 }), blade = std(0x9aa0a8, { m: 0.9, r: 0.25, e: o.glow ?? 0, ei: o.glow ? 0.6 : 0 });
    g.add(mk(C(0.022, 0.025, 1.9, 8), m, 0, -0.05, 0.1, Math.PI / 2 - 0.15));
    const b2 = mk(new THREE.TorusGeometry(0.42, 0.03, 4, 20, Math.PI * 0.7), blade, 0, 0.12, 1.0, 0, Math.PI / 2, 0.3); b2.scale.set(1, 1, 0.25); g.add(b2); return g; },
  spear(o) { const g = new THREE.Group(), m = std(o.color ?? 0xc8a050, { m: 0.9, r: 0.25 });
    g.add(mk(C(0.02, 0.02, 2.1, 8), m, 0, -0.1, 0.15, Math.PI / 2 - 0.2)); g.add(mk(CO(0.06, 0.32, 8), m, 0, 0.12, 1.2, Math.PI / 2 - 0.2)); return g; },
  claws(o) { const g = new THREE.Group(), m = std(o.color ?? 0x1a0a0a, { r: 0.25, m: 0.4 });
    for (let i = -1; i <= 1; i++) g.add(mk(CO(0.012, 0.32, 6), m, i * 0.03, -0.24, 0.04, 0.15, 0, i * 0.08)); return g; },
  lamp(o) { const g = new THREE.Group(); const c = o.color ?? 0xff6a20;
    g.add(mk(S(0.09, 12, 10), std(0x110300, { e: c, ei: 2.5, t: true, op: 0.9 }), 0, -0.2, 0.05)); const f = glow(c, 0.5, 0, -0.2, 0.05, 0.9); f.userData.flame = true; f.userData.base = 0.5; g.add(f); return g; },
  hookbig(o) { const g = new THREE.Group(), m = std(o.color ?? 0xd8b040, { m: 0.95, r: 0.2 });
    g.add(mk(TO(0.16, 0.022, Math.PI * 1.35, 16), m, 0, -0.45, 0.05, 0, 0, Math.PI * 0.85)); g.add(mk(C(0.016, 0.016, 0.28, 6), m, 0, -0.23, 0.03)); return g; },
};

// ---------- whole-body effects (materials) ----------
function bodyMeshes(R) { return R.meshes.filter(m => !m.userData.fx); }
function ownMaterial(m) { if (!m.userData.ownMat) { m.material = m.material.clone(); m.userData.ownMat = true; m.userData.baseMat = null; } return m.material; }
const BODYFX = {
  embers(R, o) { const cr = CRACKS(); for (const m of bodyMeshes(R)) { const mt = ownMaterial(m); if (!mt.color) continue; mt.color.multiplyScalar(0.28); if ('emissive' in mt) { mt.emissive = new THREE.Color(o.color ?? 0xff5a10); mt.emissiveMap = cr; mt.emissiveIntensity = 2.2; mt.needsUpdate = true; R.fxMats.push(mt); } } R.fxPulse = 'embers'; },
  ghost(R, o) { for (const m of bodyMeshes(R)) { const mt = ownMaterial(m); if (!mt.color) continue; mt.color.lerp(new THREE.Color(o.color ?? 0x9ad8ff), 0.6); mt.transparent = true; mt.opacity = o.op ?? 0.5; mt.depthWrite = false; if ('emissive' in mt) { mt.emissive = new THREE.Color(o.color ?? 0x3a8aff); mt.emissiveIntensity = 0.7; R.fxMats.push(mt); } mt.needsUpdate = true; } R.fxPulse = 'ghost'; },
  frost(R) { for (const m of bodyMeshes(R)) { const mt = ownMaterial(m); if (!mt.color) continue; mt.color.lerp(new THREE.Color(0xdff2ff), 0.55); if ('emissive' in mt) { mt.emissive = new THREE.Color(0x1a4a7a); mt.emissiveIntensity = 0.6; } if ('roughness' in mt) mt.roughness = 0.2; mt.needsUpdate = true; } },
  tint(R, o) { for (const m of bodyMeshes(R)) { const mt = ownMaterial(m); if (!mt.color) continue; mt.color.lerp(new THREE.Color(o.color), o.k ?? 0.5); if (o.e && 'emissive' in mt) { mt.emissive = new THREE.Color(o.e); mt.emissiveIntensity = o.ei ?? 0.4; } mt.needsUpdate = true; } },
  // turn every material of a given colour (e.g. the bone parts) into polished metal
  metal(R, o) { const target = new THREE.Color(o.match); for (const m of bodyMeshes(R)) { const src = m.material; if (!src.color) continue; const d = Math.abs(src.color.r - target.r) + Math.abs(src.color.g - target.g) + Math.abs(src.color.b - target.b);
    if (d < 0.06 || (o.names && o.names.includes(src.name))) { const mt = ownMaterial(m); if (o.color != null) mt.color.setHex(o.color); if ('metalness' in mt) { mt.metalness = 0.92; mt.roughness = 0.22; } mt.needsUpdate = true; } } },
};

// ---------- entry point ----------
export function applySkinFx(R, sk) {
  if (!sk || !sk.fx || !sk.fx.length) return;
  R.fxMats = []; R.fxFlames = []; R.fxSpin = []; R.fxBlink = [];
  R.root.updateMatrixWorld(true);
  const F = frames(R);
  for (const entry of sk.fx) {
    const [kind, o = {}] = Array.isArray(entry) ? entry : [entry];
    let part = null, at = null;
    if (HEAD[kind]) { part = HEAD[kind](F.head, o); at = 'head'; }
    else if (BODY[kind]) { part = BODY[kind](F.body, o); at = 'spine'; }
    else if (HAND[kind]) { part = HAND[kind](o); at = o.hand === 'L' ? 'handL' : 'handR'; if (o.both) { const p2 = HAND[kind](o); attach(R, 'handL', p2); } }
    else if (BODYFX[kind]) { BODYFX[kind](R, o); continue; }
    if (part) attach(R, at, part);
  }
  if (sk.scale) R.root.scale.multiplyScalar(sk.scale);
  const t0 = Math.random() * 10;
  R.fxTick = (dt, t) => {
    t += t0;
    for (const f of R.fxFlames) { const k = 0.8 + Math.sin(t * 17 + f.id) * 0.12 + Math.sin(t * 29 + f.id * 2) * 0.08; f.scale.set(f.userData.base * k * 0.75, f.userData.base * k, 1); }
    for (const s of R.fxSpin) s.rotation.z = t * 0.4;
    for (const b of R.fxBlink) b.material.opacity = Math.sin(t * 6) > 0.6 ? 1 : 0.05;
    if (R.fxPulse === 'embers') for (const m of R.fxMats) m.emissiveIntensity = 1.7 + Math.sin(t * 2.3) * 0.6 + Math.sin(t * 7.1) * 0.25;
    if (R.fxPulse === 'ghost') for (const m of R.fxMats) m.emissiveIntensity = 0.55 + Math.sin(t * 1.6) * 0.25;
  };
}
function attach(R, at, part) {
  const j = joint(R, at); if (!j) return;
  part.traverse(o => {
    o.userData.fx = true;
    if (o.isMesh || o.isSprite) R.meshes.push(o);
    if (o.isSprite && o.userData.flame) R.fxFlames.push(o);
    if (o.isSprite && o.userData.blink) R.fxBlink.push(o);
  });
  if (part.userData.spin) R.fxSpin.push(part.userData.spin);
  j.add(part);
}
