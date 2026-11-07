// Fortnight (battle royale event): everything a player sees and does on their own screen.
// Guns in hands, loot and chests on the ground, the closing fog, tracers and hit feedback,
// and the whole HUD (health and ward, hotbar, minimap, kill feed, placement).
import * as THREE from 'three';
import { WEAPONS, HEALS, AMMO, RARITY, SLOTS, MAX_HP, MAX_SH, FOG_PHASES, fogAt, itemName, itemColor } from './brdata.js';
import { rayWall, rayBody } from './brsim.js';
import { terrainH } from './map.js';
import { sound } from './audio.js';
import { KILLERS, SURVIVORS } from './config.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const EYE = 1.45;
const mm = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- models ----------
const MAT = {};
const mat = (k, o) => MAT[k] || (MAT[k] = new THREE.MeshStandardMaterial(o));
const metal = () => mat('metal', { color: 0x2c2e31, metalness: 0.75, roughness: 0.38 });
const wood = () => mat('wood', { color: 0x5a3a22, roughness: 0.75 });
const accent = r => mat('acc' + r, { color: RARITY[r].hex, emissive: RARITY[r].hex, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.3 });
function box(w, h, d, m, x, y, z) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; return o; }
function cyl(r, l, m, x, y, z, seg = 10) { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, seg), m); o.rotation.x = Math.PI / 2; o.position.set(x, y, z); o.castShadow = true; return o; }
// guns are built pointing down +z, grip toward -y, about 1:1 scale
export function gunModel(id, r = 0) {
  const g = new THREE.Group(), M = metal(), W = wood(), A = accent(r);
  if (id === 'revolver') {
    g.add(cyl(0.022, 0.26, M, 0, 0.03, 0.14)); g.add(cyl(0.045, 0.08, M, 0, 0.02, 0.01, 8)); g.add(box(0.04, 0.12, 0.06, W, 0, -0.06, -0.05));
    g.add(box(0.044, 0.02, 0.07, A, 0, -0.005, -0.03));
  } else if (id === 'smg') {
    g.add(box(0.06, 0.08, 0.36, M, 0, 0.02, 0.05)); g.add(cyl(0.018, 0.16, M, 0, 0.03, 0.3)); g.add(box(0.04, 0.12, 0.05, M, 0, -0.07, 0.0));
    g.add(box(0.035, 0.18, 0.06, M, 0, -0.1, 0.13)); g.add(box(0.03, 0.05, 0.22, W, 0, 0.0, -0.22)); g.add(box(0.062, 0.02, 0.2, A, 0, 0.065, 0.05));
  } else if (id === 'shotgun') {
    g.add(cyl(0.026, 0.62, M, 0, 0.04, 0.26)); g.add(cyl(0.022, 0.5, M, 0, -0.005, 0.22)); g.add(box(0.055, 0.07, 0.2, M, 0, 0.02, -0.02));
    g.add(box(0.05, 0.05, 0.14, W, 0, -0.005, 0.3)); g.add(box(0.045, 0.1, 0.3, W, 0, -0.04, -0.24)); g.add(box(0.057, 0.02, 0.12, A, 0, 0.065, -0.02));
  } else if (id === 'rifle') {
    g.add(box(0.06, 0.09, 0.42, M, 0, 0.02, 0.05)); g.add(cyl(0.017, 0.3, M, 0, 0.035, 0.4)); g.add(box(0.04, 0.16, 0.06, M, 0, -0.1, 0.12));
    g.add(box(0.04, 0.12, 0.05, M, 0, -0.07, -0.05)); g.add(box(0.05, 0.08, 0.28, W, 0, 0.0, -0.3)); g.add(box(0.062, 0.022, 0.24, A, 0, 0.075, 0.05));
  } else {
    g.add(cyl(0.02, 0.7, M, 0, 0.04, 0.32)); g.add(box(0.055, 0.08, 0.3, M, 0, 0.02, 0.0)); g.add(cyl(0.03, 0.26, M, 0, 0.11, 0.02));
    g.add(box(0.05, 0.11, 0.42, W, 0, -0.03, -0.28)); g.add(box(0.057, 0.022, 0.16, A, 0, 0.065, 0.0));
  }
  return g;
}
// one mesh per model: every part merged, its material colour baked into vertex colours
const MERGED = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 });
const MGEO = new Map();
export function merged(key, make, mat = MERGED) {
  let geo = MGEO.get(key);
  if (!geo) {
    const g = make(); g.updateMatrixWorld(true);
    const pos = [], nor = [], col = [], v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
    g.traverse(o => {
      if (!o.isMesh) return;
      const gg = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, P = gg.attributes.position, Nn = gg.attributes.normal, c = (o.material && o.material.color) || new THREE.Color(1, 1, 1);
      nm.getNormalMatrix(o.matrixWorld);
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z); n.fromBufferAttribute(Nn, i).applyMatrix3(nm).normalize(); nor.push(n.x, n.y, n.z); col.push(c.r, c.g, c.b); }
    });
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingSphere(); MGEO.set(key, geo);
  }
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m;
}
export const gunMesh = (id, r = 0, mat) => merged('gun:' + id + ':' + r, () => gunModel(id, r), mat);
function healModel(id) {
  const g = new THREE.Group(), H = HEALS[id];
  if (id === 'bandage') { g.add(cyl(0.08, 0.12, mat('band', { color: 0xe8e0d0, roughness: 0.9 }), 0, 0.08, 0, 14)); g.children[0].rotation.x = 0; }
  else if (id === 'medkit') { g.add(box(0.36, 0.22, 0.24, mat('kit', { color: 0xc8322a, roughness: 0.6 }), 0, 0.11, 0)); g.add(box(0.2, 0.06, 0.02, mat('wht', { color: 0xffffff, emissive: 0x444444 }), 0, 0.12, 0.125)); g.add(box(0.06, 0.18, 0.02, mat('wht', {}), 0, 0.12, 0.125)); }
  else { const r = id === 'tonic' ? 0.075 : 0.05, m = mat('glass' + id, { color: H.color, emissive: H.color, emissiveIntensity: 0.6, roughness: 0.15, transparent: true, opacity: 0.85 }); const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * 3.4, 12), m); b.position.y = r * 1.7; g.add(b); g.add(box(r * 0.8, r * 0.8, r * 0.8, mat('cork', { color: 0x6a4a2a }), 0, r * 3.6, 0)); }
  return g;
}
function ammoModel(id) {
  const g = new THREE.Group(), c = AMMO[id].color;
  g.add(box(0.3, 0.16, 0.2, mat('ammo' + id, { color: c, roughness: 0.55, metalness: 0.2 }), 0, 0.08, 0));
  g.add(box(0.31, 0.03, 0.21, mat('ammob', { color: 0x222222 }), 0, 0.12, 0));
  return g;
}

const STYLE = `
#brhud{position:absolute;inset:0;pointer-events:none;font-family:inherit;color:#fff;z-index:5}
#brhud .bh-vit{position:absolute;left:24px;bottom:22px;width:300px}
#brhud .bh-bar{height:20px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.18);border-radius:3px;margin-top:6px;position:relative;overflow:hidden}
#brhud .bh-bar i{position:absolute;left:0;top:0;bottom:0;transition:width .15s}
#brhud .bh-bar b{position:absolute;left:8px;top:0;line-height:20px;font-size:13px;text-shadow:0 1px 2px #000}
#brhud .bh-life i{background:linear-gradient(90deg,#3fae4a,#6fdc5a)} #brhud .bh-ward i{background:linear-gradient(90deg,#2a6fd8,#5ab4ff)}
#brhud .bh-ammo{font-size:13px;opacity:.85;margin-top:8px;display:flex;gap:12px}
#brhud .bh-hot{position:absolute;right:24px;bottom:22px;display:flex;gap:6px}
#brhud .bh-slot{width:86px;height:70px;background:rgba(10,8,12,.62);border:2px solid rgba(255,255,255,.14);border-radius:5px;position:relative;font-size:11px;padding:5px 6px;box-sizing:border-box}
#brhud .bh-slot.on{border-color:#fff;transform:translateY(-6px);background:rgba(30,26,34,.8)}
#brhud .bh-slot .k{position:absolute;right:5px;top:3px;opacity:.6;font-size:10px}
#brhud .bh-slot .n{font-weight:700;line-height:1.15;display:block;margin-top:9px}
#brhud .bh-slot .m{position:absolute;left:6px;bottom:4px;font-size:13px;font-weight:700}
#brhud .bh-slot .rar{position:absolute;left:0;right:0;bottom:0;height:3px}
#brhud .bh-map{position:absolute;right:20px;top:20px;width:190px;text-align:right}
#brhud .bh-map canvas{width:190px;height:190px;border:2px solid rgba(255,255,255,.25);border-radius:6px;background:#10140f}
#brhud .bh-left{font-size:14px;margin-top:6px;display:flex;justify-content:flex-end;gap:14px;text-shadow:0 1px 3px #000}
#brhud .bh-left b{font-size:18px}
#brhud .bh-fog{font-size:13px;margin-top:4px;text-shadow:0 1px 3px #000;color:#e6c8ff}
#brhud .bh-feed{position:absolute;left:24px;top:22px;font-size:13px;line-height:1.7;text-shadow:0 1px 3px #000;max-width:420px}
#brhud .bh-feed div{background:rgba(0,0,0,.35);padding:0 8px;border-radius:3px;margin-bottom:3px;animation:bhin .2s}
#brhud .bh-feed .me{color:#ffd76a}
@keyframes bhin{from{opacity:0;transform:translateX(-10px)}to{opacity:1}}
#brhud .bh-cross{position:absolute;left:50%;top:50%;width:0;height:0}
#brhud .bh-cross i{position:absolute;background:#fff;box-shadow:0 0 2px #000}
#brhud .bh-hit{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px;opacity:0}
#brhud .bh-hit:before,#brhud .bh-hit:after{content:'';position:absolute;left:12px;top:0;width:2px;height:26px;background:#fff;transform:rotate(45deg)}
#brhud .bh-hit:after{transform:rotate(-45deg)}
#brhud .bh-hit.head:before,#brhud .bh-hit.head:after{background:#ffd23a}
#brhud .bh-prompt{position:absolute;left:50%;top:62%;transform:translateX(-50%);font-size:15px;text-shadow:0 1px 3px #000;white-space:nowrap}
#brhud .bh-prompt kbd{display:inline-block;border:1px solid #fff;border-radius:3px;padding:0 6px;margin-right:6px;font-family:inherit}
#brhud .bh-act{position:absolute;left:50%;top:56%;transform:translateX(-50%);width:200px;text-align:center;font-size:12px}
#brhud .bh-act div{height:6px;background:rgba(0,0,0,.5);margin-top:4px;border-radius:3px;overflow:hidden}#brhud .bh-act div i{display:block;height:100%;background:#fff}
#brhud .bh-big{position:absolute;left:0;right:0;top:24%;text-align:center;font-size:30px;font-weight:800;letter-spacing:.06em;text-shadow:0 2px 12px #000;opacity:0;transition:opacity .3s}
#brhud .bh-big small{display:block;font-size:15px;font-weight:400;letter-spacing:.02em;opacity:.85;margin-top:4px}
#brhud .bh-dmg{position:absolute;font-weight:800;font-size:18px;text-shadow:0 1px 3px #000;pointer-events:none;transition:none}
#brhud .bh-fogfx{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(110,40,160,.18),rgba(90,20,120,.6));opacity:0;transition:opacity .4s}
#brhud .bh-scope{position:absolute;inset:0;opacity:0;background:radial-gradient(circle at center,transparent 0,transparent 31vh,#000 31.3vh)}
#brhud .bh-scope:before,#brhud .bh-scope:after{content:'';position:absolute;background:rgba(0,0,0,.85)}
#brhud .bh-scope:before{left:50%;top:19vh;bottom:19vh;width:1px}#brhud .bh-scope:after{top:50%;left:calc(50% - 31vh);right:calc(50% - 31vh);height:1px}
#brhud .bh-dirs{position:absolute;left:50%;top:50%}
#brhud .bh-dirs i{position:absolute;width:60px;height:8px;margin:-4px -30px;background:linear-gradient(90deg,transparent,rgba(255,40,30,.9),transparent);border-radius:4px}
#brhud .bh-bigmap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:none}
#brhud .bh-bigmap canvas{width:min(80vh,80vw);height:min(80vh,80vw);border:2px solid rgba(255,255,255,.3);border-radius:8px}
#brhud .bh-spec{position:absolute;left:50%;bottom:120px;transform:translateX(-50%);text-align:center;font-size:15px;text-shadow:0 1px 3px #000}
#hud.br #objective,#hud.br #team,#hud.br #bottom-right,#hud.br #crosshair,#hud.br #center-bottom,#hud.br #controls-hint,#hud.br #feed{display:none!important}
`;

export class BRView {
  constructor(game) {
    this.g = game; this.M = game.M; this.scene = game.scene;
    this.fire = false; this.ads = false; this.fcd = 0; this.loot = new Map(); this.tracers = []; this.dmgEls = []; this.feedEls = [];
    this.lastLife = MAX_HP; this.lastWard = 0; this.mapBig = false; this.dirs = [];
    if (!document.getElementById('br-style')) { const s = document.createElement('style'); s.id = 'br-style'; s.textContent = STYLE; document.head.appendChild(s); }
    $('hud').classList.add('br');
    this.buildHUD();
    this.buildWorld();
    this.onWheel = e => { if (!this.g.paused && document.pointerLockElement) { const me = this.g.mine(); if (me && me.st === 'ok') this.slot(((me.slot + (e.deltaY > 0 ? 1 : -1)) % SLOTS + SLOTS) % SLOTS); } };
    addEventListener('wheel', this.onWheel, { passive: true });
    this.fp = !!game.settings.fnFP;
    this.big('FORTNIGHT', 'Loot up, stay out of the fog, be the last one standing  ·  V: first / third person', 5);
  }
  dispose() {
    removeEventListener('wheel', this.onWheel);
    if (this.vm && this.vm.parent) this.vm.parent.remove(this.vm);
    $('hud').classList.remove('br');
    if (this.el) this.el.remove();
  }

  // ---------- world ----------
  buildWorld() {
    const M = this.M, S = this.scene;
    // chests
    this.chests = M.br.chests.map(c => {
      const g = new THREE.Group(); g.position.set(c.x, terrainH(M, c.x, c.z), c.z); g.rotation.y = c.rot; g.scale.setScalar(1.15);
      const W = mat('chestw', { color: 0x6a4626, roughness: 0.8 }), I = mat('chesti', { color: 0x3a3836, metalness: 0.7, roughness: 0.45 }), G = mat('chestg', { color: 0xd8b060, metalness: 0.8, roughness: 0.3, emissive: 0x6a4a10, emissiveIntensity: 0.8 });
      g.add(merged('chest', () => { const q = new THREE.Group(); q.add(box(0.9, 0.42, 0.56, W, 0, 0.21, 0)); q.add(box(0.94, 0.06, 0.6, G, 0, 0.42, 0)); return q; }));
      const lid = new THREE.Group(); lid.position.set(0, 0.42, -0.28); g.add(lid);
      lid.add(merged('chestlid', () => { const q = new THREE.Group(); q.add(box(0.92, 0.16, 0.58, W, 0, 0.08, 0.28)); q.add(box(0.12, 0.1, 0.04, G, 0, 0.06, 0.58)); return q; }));
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2; glow.position.y = 0.03; g.add(glow);
      g.visible = false; S.add(g);
      return { g, lid, glow, open: 0 };
    });
    // sacks (burlap, tied at the neck) and rucksacks (canvas, straps, a flap)
    const burlap = mat('burlap', { color: 0x8a6e48, roughness: 0.95 }), rope = mat('rope', { color: 0xb8a070, roughness: 0.9 }), canvas = mat('canvas', { color: 0x4a5a3a, roughness: 0.85 }), strap = mat('strap', { color: 0x2a2018, roughness: 0.7 });
    this.sacks = (M.br.sacks || []).map(c => {
      const g = new THREE.Group(); g.position.set(c.x, terrainH(M, c.x, c.z), c.z); g.rotation.y = c.rot;
      if (c.kind === 'sack') g.add(merged('sack', () => {
        const q = new THREE.Group();
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 9), burlap); body.scale.set(1, 1.15, 0.85); body.position.y = 0.3; q.add(body);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.16, 8), burlap); neck.position.y = 0.66; q.add(neck);
        const tie = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 6, 12), rope); tie.rotation.x = Math.PI / 2; tie.position.y = 0.62; q.add(tie);
        return q;
      }));
      else {
        g.add(merged('pack', () => { const q = new THREE.Group(); q.add(box(0.46, 0.5, 0.26, canvas, 0, 0.25, 0)); q.add(box(0.46, 0.14, 0.3, canvas, 0, 0.5, 0.02)); q.add(box(0.3, 0.18, 0.08, canvas, 0, 0.2, 0.16));
          for (const x of [-0.13, 0.13]) q.add(box(0.05, 0.5, 0.03, strap, x, 0.27, -0.15)); return q; }));
        g.rotation.z = 0.12;
      }
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      g.visible = false; S.add(g); return { g, open: 0 };
    });
    // fog wall
    const fm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { t: { value: 0 } },
      vertexShader: 'varying vec2 vU; varying float vY; void main(){ vU = uv; vY = position.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform float t; varying vec2 vU; varying float vY;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){ float y = clamp(vY / 70.0 + 0.5, 0.0, 1.0);
          float k = n(vec2(vU.x * 140.0 + t * 0.6, vY * 0.12 - t * 0.35)) * 0.6 + n(vec2(vU.x * 380.0 - t, vY * 0.3)) * 0.4;
          float a = (0.32 + k * 0.3) * (1.0 - smoothstep(0.55, 1.0, y));
          gl_FragColor = vec4(mix(vec3(0.42,0.12,0.62), vec3(0.85,0.35,1.0), k), a); }`,
    });
    this.fogWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 70, 96, 1, true), fm);
    this.fogWall.renderOrder = 20; this.fogWall.frustumCulled = false; S.add(this.fogWall);
    // tracers
    const tm = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 4, 1, true), tm.clone()); m.visible = false; m.frustumCulled = false; S.add(m); this.tracers.push({ m, t: 1 }); }
    // muzzle flashes
    // a soft round flash (a plain sprite would be a square)
    const fc = document.createElement('canvas'); fc.width = fc.height = 64; const fx = fc.getContext('2d'), gr = fx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,235,1)'); gr.addColorStop(0.25, 'rgba(255,210,120,0.9)'); gr.addColorStop(0.6, 'rgba(255,140,40,0.35)'); gr.addColorStop(1, 'rgba(255,120,20,0)'); fx.fillStyle = gr; fx.fillRect(0, 0, 64, 64);
    this.flashMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(fc), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flashes = []; for (let i = 0; i < 12; i++) { const s = new THREE.Sprite(this.flashMat.clone()); s.scale.setScalar(0.5); s.visible = false; S.add(s); this.flashes.push({ s, t: 1 }); }
  }
  lootEntries(S) {
    const out = [];
    this.M.br.loot.forEach((L, i) => { if (!S.gone || !S.gone.includes(i)) out.push({ u: 'f' + i, x: L.x, z: L.z, k: L.k, i: L.id, r: L.r || 0, n: L.n }); });
    for (const L of S.loot || []) out.push(L);
    return out;
  }
  syncLoot(S, cam) {
    const seen = new Set();
    for (const L of this.lootEntries(S)) {
      seen.add(L.u);
      let o = this.loot.get(L.u);
      if (!o || o.key !== L.k + L.i + L.r) {
        if (o) this.scene.remove(o.g);
        const g = new THREE.Group(); g.position.set(L.x, 0, L.z);
        const m = L.k === 'w' ? gunMesh(L.i, L.r) : L.k === 'h' ? merged('heal:' + L.i, () => healModel(L.i)) : merged('ammo:' + L.i, () => ammoModel(L.i));
        const hold = new THREE.Group(); hold.add(m); hold.position.y = L.k === 'w' ? 0.45 : 0.15; if (L.k === 'w') hold.rotation.z = Math.PI / 2 - 0.2;
        g.add(hold);
        g.position.y = terrainH(this.M, L.x, L.z);
        const col = L.k === 'w' ? RARITY[L.r].hex : L.k === 'h' ? 0xffffff : AMMO[L.i].color;
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.16, L.k === 'w' ? 1.4 : 0.6, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: L.k === 'w' ? 0.35 : 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.y = L.k === 'w' ? 0.7 : 0.3; g.add(beam);
        this.scene.add(g); o = { g, hold, key: L.k + L.i + L.r, seed: Math.random() * 6 };
        this.loot.set(L.u, o);
      }
      o.g.position.set(L.x, terrainH(this.M, L.x, L.z), L.z);
    }
    for (const [u, o] of this.loot) if (!seen.has(u)) { this.scene.remove(o.g); this.loot.delete(u); }
    // only what's near is drawn
    for (const o of this.loot.values()) {
      const d = Math.hypot(o.g.position.x - cam.x, o.g.position.z - cam.z);
      o.g.visible = d < 42;
      if (o.g.visible) { o.hold.rotation.y = this.g.t * 0.9 + o.seed; o.hold.position.y += (0.45 + Math.sin(this.g.t * 2 + o.seed) * 0.04 - o.hold.position.y) * 0.2 * (o.key[0] === 'w' ? 1 : 0); }
    }
  }
  // the weapon each character is holding, and arms up to aim it
  updateGuns(S) {
    for (const p of S.players) {
      const c = this.g.chars.get(p.id); if (!c) continue;
      const it = p.st === 'ok' && p.inv ? p.inv[p.slot] : null, key = it && it.k === 'w' ? it.id + it.r : '';
      if (c.brKey !== key) {
        if (c.brGun) c.brGun.parent && c.brGun.parent.remove(c.brGun);
        c.brGun = null; c.brKey = key;
        if (key) {
          const gun = new THREE.Group(); gun.add(gunMesh(it.id, it.r)); const R = c.rig, hand = R.j && R.j.handR && R.j.handR !== R.j.head ? R.j.handR : null;
          gun.scale.setScalar(1.4); // a touch larger than life, so you can tell what someone's carrying
          if (hand) { gun.rotation.x = Math.PI / 2; gun.position.set(0, -0.09, 0.03); hand.add(gun); c.brHand = true; }
          else { gun.position.set(-0.28, 1.25, 0.45); R.root.add(gun); c.brHand = false; }
          c.brGun = gun;
        }
      }
      // poses (procedural rigs): aiming, gun low while sprinting, reloading, patching up; a kick when firing
      const j = c.rig.j, root = c.rig.root;
      if (j && j.shR && j.elR && p.st === 'ok') {
        const pitch = p.pitch || 0, kick = c.kickAt != null ? Math.max(0, 1 - (this.g.t - c.kickAt) / 0.14) : 0;
        if (p.heal) { j.shR.rotation.x = -0.95; j.elR.rotation.x = -1.2; j.shR.rotation.z = 0.25; if (j.shL) { j.shL.rotation.x = -0.95; j.elL.rotation.x = -1.2; j.shL.rotation.z = -0.25; } }
        else if (key && c.brHand) {
          if (p.rel > 0) { const w = Math.sin(this.g.t * 9) * 0.12; j.shR.rotation.x = -0.75; j.elR.rotation.x = -1.0; if (j.shL) { j.shL.rotation.x = -0.9 + w; j.shL.rotation.z = 0.5; j.elL.rotation.x = -1.3; } if (c.brGun) c.brGun.rotation.y = 0.5; }
          else if (p.mv === 2 && !p.ads) { j.shR.rotation.x = -0.55; j.shR.rotation.z = -0.05; j.elR.rotation.x = -0.95; if (j.shL) { j.shL.rotation.x = -0.6; j.shL.rotation.z = 0.45; j.elL.rotation.x = -1.1; } if (c.brGun) c.brGun.rotation.y = 0; }
          else { j.shR.rotation.x = -1.45 - pitch * 0.85 + kick * 0.3; j.shR.rotation.z = -0.05; j.elR.rotation.x = -0.12 - kick * 0.2; if (j.shL && j.elL) { j.shL.rotation.x = -1.25 - pitch * 0.7 + kick * 0.2; j.shL.rotation.z = 0.55; j.elL.rotation.x = -0.75; } if (c.brGun) c.brGun.rotation.y = 0; }
        }
      }
      // eliminated: fall backwards, lie there a moment, sink away
      if (p.st === 'dead' && c.deadAt != null) {
        const f = (this.g.t - c.deadAt); root.rotation.order = 'YXZ';
        root.rotation.x = -(Math.min(1, f / 0.45) ** 2) * Math.PI / 2;
        if (f > 1.6) root.position.y -= (f - 1.6) * 0.6;
      } else if (root.rotation.x) root.rotation.x = 0;
      // jumping
      const hop = p.id === this.g.myId ? (p.hop ? p.hop.t / p.hop.d : 0) : (p.hopF || 0);
      if (hop > 0 && hop < 1) c.rig.root.position.y += Math.sin(hop * Math.PI) * 0.75;
      c.rig.root.position.y += terrainH(this.M, c.x, c.z);
      const cam = this.g.camera.position; if (c.rig.root.visible && Math.hypot(c.x - cam.x, c.z - cam.z) > 95) c.rig.root.visible = false;
    }
  }
  tracer(x0, y0, z0, x1, y1, z1) {
    const T = this.tracers.find(t => t.t >= 1) || this.tracers[0];
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), L = a.distanceTo(b);
    if (L < 0.3) return;
    T.m.position.copy(a).lerp(b, 0.5); T.m.scale.set(1, L, 1);
    T.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    T.m.visible = true; T.t = 0;
  }
  muzzle(p) {
    const c = this.g.chars.get(p.id); if (!c) return null;
    let pos;
    if (p.id === this.g.myId && this.fp && this.vmGun && this.vm.visible) { pos = new THREE.Vector3(0, 0.03, 0.45); this.vmGun.localToWorld(pos); }
    else if (c.brGun) { pos = new THREE.Vector3(0, 0.03, 0.45); c.brGun.localToWorld(pos); }
    else pos = new THREE.Vector3(c.x + Math.sin(c.yaw) * 0.5, EYE + terrainH(this.M, c.x, c.z), c.z + Math.cos(c.yaw) * 0.5);
    const F = this.flashes.find(f => f.t >= 1) || this.flashes[0];
    F.s.position.copy(pos); F.s.visible = true; F.t = 0; F.s.material.rotation = Math.random() * 6;
    return pos;
  }

  // ---------- input ----------
  me() { return this.g.mine(); }
  item(me) { return me && me.inv ? me.inv[me.slot] : null; }
  slot(i) { const me = this.me(); if (!me || i === me.slot) return; this.g.send({ t: 'act', a: 'slot', i }); if (this.g.isHost) {} else { me.slot = i; } this.fcd = 0.25; }
  onMouse(e, down) {
    const me = this.me(); if (!me) return;
    if (me.st !== 'ok') { if (down && e.button === 0) { const al = this.g.S.players.filter(p => p.st === 'ok'); if (al.length) { const i = al.findIndex(p => p.id === this.spec); this.spec = al[(i + 1) % al.length].id; } } return; }
    if (e.button === 0) { this.fire = down; if (down) this.tryFire(true); }
    if (e.button === 2) { this.ads = down; this.g.send({ t: 'in', aim: down }); }
  }
  onKey(code, down) {
    const me = this.me(); if (!me) return false;
    if (code === 'KeyM') { if (down) { this.mapBig = !this.mapBig; this.mapEl.style.display = this.mapBig ? 'block' : 'none'; } return true; }
    if (code === 'KeyV') { if (down) { this.fp = !this.fp; this.g.settings.fnFP = this.fp; window.dispatchEvent(new Event('nb-cam')); this.toast(this.fp ? 'First person' : 'Third person', '#d0c8ff'); } return true; }
    if (!down || me.st !== 'ok') return false;
    const d = /^Digit([1-5])$/.exec(code);
    if (d) { this.slot(+d[1] - 1); return true; }
    if (code === 'KeyR') { this.g.send({ t: 'act', a: 'reload' }); return true; }
    if (code === 'KeyE') { const t = this.target; if (t) this.g.send(t.chest != null ? { t: 'act', a: 'chest', id: t.chest } : t.sack != null ? { t: 'act', a: 'sack', id: t.sack } : { t: 'act', a: 'pickup', u: t.u }); return true; }
    if (code === 'KeyG') { if (this.item(me)) this.g.send({ t: 'act', a: 'drop', i: me.slot }); return true; }
    if (code === 'Space') { if (!me.hop && !me.vault) me.hop = { t: 0, d: 0.6 }; return true; }
    return false;
  }
  // the point under the crosshair: map, then anyone in the way
  aimPoint() {
    const cam = this.g.camera, o = cam.position, d = new THREE.Vector3(); cam.getWorldDirection(d);
    let t = Math.min(250, rayWall(this.M, o.x, o.y, o.z, d.x, d.y, d.z, 250));
    for (const p of this.g.S.players) {
      if (p.id === this.g.myId || p.st !== 'ok') continue;
      const c = this.g.chars.get(p.id); if (!c) continue;
      const h = rayBody(c.x, c.z, terrainH(this.M, c.x, c.z), p.look === 'killer' ? 2.1 : 1.85, 0.45, o.x, o.y, o.z, d.x, d.y, d.z, t);
      if (h.t < t) t = h.t;
    }
    // never aim at something between the camera and yourself
    const me = this.me(), dm = me ? (me.x - o.x) * d.x + (me.z - o.z) * d.z : 0;
    t = Math.max(t, dm + 1.2);
    return { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
  }
  tryFire(click) {
    const me = this.me(), it = this.item(me);
    if (!me || me.st !== 'ok' || this.g.paused) return;
    if (it && it.k === 'h') { if (click) this.g.send({ t: 'act', a: 'fire' }); return; }
    if (this.fcd > 0 || me.rel > 0) return;
    if (!it) { if (!click) return; this.fcd = 0.55; this.g.send({ t: 'act', a: 'fire' }); sound.play('swing', me.x, me.z); return; }
    const W = WEAPONS[it.id];
    if (!W.auto && !click) return;
    if (me.mg <= 0) { if (click) this.g.send({ t: 'act', a: 'reload' }); return; }
    this.fcd = W.fire;
    const A = this.aimPoint();
    this.g.send({ t: 'act', a: 'fire', ax: +A.x.toFixed(2), ay: +A.y.toFixed(2), az: +A.z.toFixed(2) });
    // instant feedback on my own screen; the host decides what it hit
    const mp = this.muzzle(me);
    if (mp) this.tracer(mp.x, mp.y, mp.z, A.x, A.y, A.z);
    sound.play(W.sound, me.x, me.z);
    const kick = (W.pellets ? 0.05 : it.id === 'hunting' ? 0.07 : W.auto ? 0.012 : 0.028) * (this.ads ? 0.6 : 1);
    me.pitch = Math.min(1.2, me.pitch + kick); this.g.shake = Math.max(this.g.shake, W.pellets || it.id === 'hunting' ? 0.5 : 0.15); this.vmKick = 1;
    if (!this.g.isHost) me.mg = Math.max(0, me.mg - 1);
  }

  // ---------- per frame ----------
  frame(dt, S, me) {
    this.S = S;
    this.fcd = Math.max(0, this.fcd - dt);
    if (this.fire && me && me.st === 'ok') this.tryFire(false);
    const cam = this.g.camera.position;
    this.syncLoot(S, cam);
    this.updateGuns(S);
    // chests
    this.M.br.chests.forEach((c, i) => {
      const C = this.chests[i], open = (S.copen || []).includes(i);
      C.g.visible = Math.hypot(c.x - cam.x, c.z - cam.z) < 55;
      C.open += ((open ? 1 : 0) - C.open) * Math.min(1, dt * 5);
      C.lid.rotation.x = -C.open * 1.9;
      C.glow.material.opacity = open ? 0.05 : 0.22 + Math.sin(this.g.t * 2.2 + i) * 0.08;
    });
    (this.M.br.sacks || []).forEach((c, i) => {
      const K = this.sacks[i], open = (S.sopen || []).includes(i);
      K.g.visible = Math.hypot(c.x - cam.x, c.z - cam.z) < 40;
      K.open += ((open ? 1 : 0) - K.open) * Math.min(1, dt * 4);
      K.g.scale.set(1 + K.open * 0.15, 1 - K.open * 0.55, 1 + K.open * 0.15); // emptied: it slumps flat
    });
    // fog
    const ring = fogAt(S.fog, S.t);
    if (ring) { this.fogWall.position.set(ring.x, 0, ring.z); this.fogWall.scale.set(Math.max(0.5, ring.r), 1, Math.max(0.5, ring.r)); this.fogWall.material.uniforms.t.value = this.g.t; }
    // effects
    for (const T of this.tracers) if (T.t < 1) { T.t += dt / 0.09; T.m.material.opacity = 0.9 * Math.max(0, 1 - T.t); if (T.t >= 1) T.m.visible = false; }
    for (const F of this.flashes) if (F.t < 1) { F.t += dt / 0.06; F.s.material.opacity = Math.max(0, 1 - F.t); F.s.scale.setScalar(0.35 + Math.random() * 0.25); if (F.t >= 1) F.s.visible = false; }
    this.hud(dt, S, me, ring);
  }

  // over the shoulder; aiming down sights pulls in, the hunting rifle's scope goes to first person
  camera(dt, S, me) {
    const g = this.g, cam = g.camera;
    if (this.fp && me.st === 'ok') { this.fpCamera(dt, S, me); return; }
    if (this.vm) this.vm.visible = false;
    let T = me;
    if (me.st !== 'ok') {
      if (!this.spec || !S.players.some(p => p.id === this.spec && p.st === 'ok')) { const alive = S.players.filter(p => p.st === 'ok'); const k = this.killer && alive.find(p => p.id === this.killer); this.spec = (k || alive[0] || me).id; }
      T = S.players.find(p => p.id === this.spec) || me;
    }
    const c = g.chars.get(T.id);
    const px = c ? c.x : T.x, pz = c ? c.z : T.z, yaw = T === me ? me.yaw : (c ? c.yaw : T.yaw), pitch = T === me ? me.pitch : (T.pitch || 0) * 0.5;
    const it = this.item(me), scoped = T === me && this.ads && it && it.k === 'w' && WEAPONS[it.id].scope;
    const ads = T === me && this.ads && it && it.k === 'w';
    const side = (g.settings.camSide ?? 1) || 0;
    const right = { x: -Math.cos(yaw), z: Math.sin(yaw) };
    const hop = T === me && me.hop ? Math.sin(me.hop.t / me.hop.d * Math.PI) * 0.75 : 0;
    // killers are bigger: the camera sits wider and higher over their shoulder
    const big = T.look === 'killer', so = (ads ? 0.42 : 0.55) * (big ? 1.5 : 1);
    const piv = { x: px + right.x * so * side, y: (big ? 1.95 : 1.62) + hop + terrainH(this.M, px, pz), z: pz + right.z * so * side };
    const want = scoped ? 0 : (ads ? 1.25 : 2.7) * (big ? 1.3 : 1) * (g.settings.camDist || 1);
    const back = { x: -Math.sin(yaw) * Math.cos(pitch), y: -Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
    // pull in if a wall is in the way
    let d = want;
    if (want > 0) { const L = rayWall(this.M, piv.x, piv.y, piv.z, back.x, back.y, back.z, want + 0.3); if (L < want + 0.3) d = Math.max(0.3, L - 0.3); }
    this.camD = this.camD == null ? d : d < this.camD ? d : this.camD + (d - this.camD) * Math.min(1, dt * 6);
    const sh = g.shake > 0 ? g.shake : 0; g.shake = Math.max(0, g.shake - dt * 2.5);
    const cx0 = piv.x + back.x * this.camD, cz0 = piv.z + back.z * this.camD;
    cam.position.set(cx0 + (Math.random() - 0.5) * sh * 0.06, Math.max(terrainH(this.M, cx0, cz0) + 0.35, piv.y + back.y * this.camD) + (Math.random() - 0.5) * sh * 0.06, cz0);
    cam.rotation.set(pitch, yaw + Math.PI, 0);
    const fov = scoped ? 18 : ads ? 52 : (g.settings.fov || 75);
    this.fov = this.fov == null ? fov : this.fov + (fov - this.fov) * Math.min(1, dt * 14);
    cam.fov = this.fov; cam.updateProjectionMatrix();
    if (c) { c.rig.root.visible = !(scoped && T === me) && T.st === 'ok'; const op = T === me && this.camD < 1.1 ? 0.3 : 1; if (op !== c.brOp) { c.brOp = op; c.rig.setOpacity && c.rig.setOpacity(op); } }
    sound.listener(px, pz, yaw);
  }

  // first person: your eyes, and your gun held in front of you
  fpCamera(dt, S, me) {
    const g = this.g, cam = g.camera, c = g.chars.get(me.id), it = this.item(me);
    const hop = me.hop ? Math.sin(me.hop.t / me.hop.d * Math.PI) * 0.75 : 0;
    const eye = (me.look === 'killer' ? 1.9 : 1.62) - (me.cr ? 0.55 : 0);
    const sh = g.shake > 0 ? g.shake : 0; g.shake = Math.max(0, g.shake - dt * 2.5);
    cam.position.set(me.x + Math.sin(me.yaw) * 0.12 + (Math.random() - 0.5) * sh * 0.04, terrainH(this.M, me.x, me.z) + eye + hop, me.z + Math.cos(me.yaw) * 0.12);
    cam.rotation.set(me.pitch + (Math.random() - 0.5) * sh * 0.01, me.yaw + Math.PI, 0);
    const W = it && it.k === 'w' ? WEAPONS[it.id] : null, ads = this.ads && W, scoped = ads && W.scope;
    const fov = scoped ? 18 : ads ? 55 : (g.settings.fov || 75) + (me.mv === 2 ? 6 : 0);
    this.fov = this.fov == null ? fov : this.fov + (fov - this.fov) * Math.min(1, dt * 14);
    cam.fov = this.fov; cam.updateProjectionMatrix();
    if (c) c.rig.root.visible = false;
    sound.listener(me.x, me.z, me.yaw);
    // the view model
    const key = it ? it.k + it.id + (it.r || 0) : 'hands';
    if (!this.vm) { this.vm = new THREE.Group(); cam.add(this.vm); this.vmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.35, depthTest: false, depthWrite: false }); }
    if (this.vmKey !== key) {
      this.vmKey = key; this.vm.clear(); this.vmGun = null;
      const skin = new THREE.MeshStandardMaterial({ color: 0xc89878, roughness: 0.7, depthTest: false, depthWrite: false }), sleeve = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.8, depthTest: false, depthWrite: false });
      const arm = (x, y, z, rx, ry, len, s = sleeve) => { const a = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.042, len * 0.55), s); a.position.set(x * 0.5, y * 0.5 - 0.02, z * 0.5 + 0.05); a.rotation.set(rx, ry, 0); this.vm.add(a); return a; };
      if (it && it.k === 'w') {
        const gun = gunMesh(it.id, it.r, this.vmMat); gun.rotation.y = Math.PI; gun.scale.setScalar(0.55); gun.position.set(0, 0, 0); this.vm.add(gun); this.vmGun = gun;
        const hand = (x, y, z) => { const h = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.08), skin); h.position.set(x, y, z); this.vm.add(h); };
        hand(0.0, -0.045, 0.03); hand(0.0, -0.03, -0.12); // a hand on the grip, one under the barrel
      } else if (it && it.k === 'h') {
        const h = merged('heal:' + it.id, () => healModel(it.id), this.vmMat); h.position.set(0, -0.04, -0.04); h.scale.setScalar(0.7); this.vm.add(h);
        arm(0.1, -0.1, 0.15, 0.3, 0.2, 0.4); arm(-0.1, -0.1, 0.15, 0.3, -0.2, 0.4);
      } else { arm(0.16, -0.12, 0.1, 0.2, 0.1, 0.4); arm(0.14, -0.09, -0.12, 0, 0, 0.1, skin); arm(-0.16, -0.12, 0.1, 0.2, -0.1, 0.4); arm(-0.14, -0.09, -0.12, 0, 0, 0.1, skin); }
      this.vm.traverse(o => { if (o.isMesh) { o.renderOrder = 999; o.castShadow = false; } });
    }
    this.vm.visible = !scoped;
    // sway, bob, kick, sprint, reload
    const t = g.t, moving = me.mv >= 1 ? 1 : 0, sprint = me.mv === 2 && !this.ads;
    this.vmKick = Math.max(0, (this.vmKick || 0) - dt * 7);
    const k = this.vmKick, bob = Math.sin(t * (sprint ? 12 : 8)) * (sprint ? 0.022 : 0.012) * moving, bobY = Math.abs(Math.cos(t * (sprint ? 12 : 8))) * (sprint ? 0.018 : 0.008) * moving;
    const tx = ads ? 0 : 0.14 + bob, ty = (ads ? -0.072 : -0.12) - bobY - (me.rel > 0 ? 0.05 : 0), tz = (ads ? -0.38 : -0.42) + k * 0.04;
    const P = this.vm.position; P.x += (tx - P.x) * Math.min(1, dt * 16); P.y += (ty - P.y) * Math.min(1, dt * 16); P.z += (tz - P.z) * Math.min(1, dt * 22);
    const rx = k * 0.16 + (sprint ? -0.45 : 0) + (me.rel > 0 ? -0.5 + Math.sin(t * 10) * 0.05 : 0), ry = sprint ? 0.5 : 0, rz = me.rel > 0 ? 0.35 : 0;
    this.vm.rotation.x += (rx - this.vm.rotation.x) * Math.min(1, dt * 14); this.vm.rotation.y += (ry - this.vm.rotation.y) * Math.min(1, dt * 10); this.vm.rotation.z += (rz - this.vm.rotation.z) * Math.min(1, dt * 10);
  }

  // ---------- events ----------
  onEvents(evs) {
    const S = this.g.S, me = this.me(), my = this.g.myId;
    for (const e of evs) {
      const P = id => S && S.players.find(p => p.id === id);
      const nm = id => { const p = P(id); return p ? p.name : '?'; };
      if (e.k === 'brshot') {
        const p = P(e.id); if (!p) continue;
        const sc = this.g.chars.get(e.id); if (sc) sc.kickAt = this.g.t;
        if (e.id !== my) { const mp = this.muzzle(p); if (mp) this.tracer(mp.x, mp.y, mp.z, e.x, e.y, e.z); sound.play(WEAPONS[e.w] ? WEAPONS[e.w].sound : 'pistol', p.x, p.z); }
        if (!e.hit && this.g.sparks) this.g.sparks.spawn(e.x, e.y, e.z, 4, 0xffd8a0, 2.5, 0.25);
      } else if (e.k === 'brdmg') {
        const v = P(e.id);
        if (v && !e.fog && this.g.blood) { const c = this.g.chars.get(e.id); if (c) this.g.blood.spawn(c.x, 1.2 + terrainH(this.M, c.x, c.z), c.z, 6, 0x8a0a0a, 2.5, 0.6); }
        if (e.by === my && v) {
          this.dmgNum(v, e.n, e.head, e.ward);
          sound.play('brhit', undefined, undefined, { head: e.head }); this.hitT = 0.18; this.hitHead = !!e.head;
          if (!e.ward && v.ward <= 0 && this.wardOf && this.wardOf.get(e.id) > 0) sound.play('brward');
        }
        if (e.id === my && !e.fog) { this.g.flash = Math.min(1, (this.g.flash || 0) + 0.35); const by = P(e.by); if (by && me) this.dirs.push({ a: Math.atan2(by.x - me.x, by.z - me.z), t: 1.4 }); }
        if (!this.wardOf) this.wardOf = new Map();
        if (v) this.wardOf.set(e.id, v.ward);
      } else if (e.k === 'brkill') {
        const W = WEAPONS[e.w];
        const txt = e.fog ? `${esc(nm(e.id))} was lost in the fog` : !e.by || e.by === e.id ? `${esc(nm(e.id))} was eliminated` : `${esc(nm(e.by))} eliminated ${esc(nm(e.id))}${W ? ' with a ' + esc(W.name) : e.w === 'hands' ? ' with bare hands' : ''}${e.head ? ' (headshot)' : ''}`;
        this.feed(txt, e.by === my || e.id === my);
        if (e.by === my && e.id !== my) { sound.play('brkill'); this.big('ELIMINATED', esc(nm(e.id)), 1.8); }
        if (e.id === my) { this.killer = e.by; this.diedAt = this.g.t; const p = P(my); this.big(`#${p ? p.place || e.left + 1 : e.left + 1}`, e.fog ? 'The fog took you' : `Eliminated by ${esc(nm(e.by))}`, 4); }
      } else if (e.k === 'brchest') { const C = this.M.br.chests[e.id]; if (C) sound.play('chest', C.x, C.z); }
      else if (e.k === 'brsack') { const C = (this.M.br.sacks || [])[e.id]; if (C) sound.play('brreload', C.x, C.z); }
      else if (e.k === 'brpick') { if (e.id === my) { sound.play('brpick', me && me.x, me && me.z); this.toast('+ ' + esc(itemName(e.it)), itemColor(e.it)); } }
      else if (e.k === 'brheal') { if (e.id === my) sound.play('heal'); }
      else if (e.k === 'brrel') { const p = P(e.id); if (p) sound.play('brreload', p.x, p.z); }
      else if (e.k === 'brswing') { const p = P(e.id); if (p && e.id !== my) sound.play('swing', p.x, p.z); }
      else if (e.k === 'brfog') { sound.play('brfog'); this.big('THE FOG IS MOVING', 'Get inside the white ring on your map', 3); }
      else if (e.k === 'brwin') { if (e.id === my) { sound.play('brwin'); this.big('#1  LAST ONE STANDING', 'You won the Fortnight!', 6); } else this.feed(`${esc(nm(e.id))} is the last one standing`, false); }
      else if (e.k === 'brnote') { if (e.id === my) this.toast(esc(e.text), '#ffd0d0'); }
    }
  }

  // ---------- HUD ----------
  buildHUD() {
    const el = this.el = document.createElement('div'); el.id = 'brhud';
    el.innerHTML = `<div class="bh-fogfx"></div><div class="bh-scope"></div>
      <div class="bh-feed"></div>
      <div class="bh-map"><canvas width="380" height="380"></canvas><div class="bh-left"><span>Alive <b class="bh-alive">0</b></span><span>Eliminations <b class="bh-kills">0</b></span></div><div class="bh-fog"></div></div>
      <div class="bh-cross"></div><div class="bh-hit"></div><div class="bh-dirs"></div>
      <div class="bh-prompt"></div><div class="bh-act"></div>
      <div class="bh-big"></div><div class="bh-spec"></div>
      <div class="bh-vit"><div class="bh-bar bh-ward"><i></i><b></b></div><div class="bh-bar bh-life"><i></i><b></b></div><div class="bh-ammo"></div></div>
      <div class="bh-hot"></div>
      <div class="bh-bigmap"><canvas width="900" height="900"></canvas></div>`;
    $('hud').appendChild(el);
    this.q = s => el.querySelector(s);
    this.mini = this.q('.bh-map canvas').getContext('2d');
    this.mapEl = this.q('.bh-bigmap'); this.bigCtx = this.mapEl.querySelector('canvas').getContext('2d');
    // the island, drawn once
    const M = this.M, N = 1024, cv = document.createElement('canvas'); cv.width = cv.height = N;
    const x = cv.getContext('2d'), k = N / (M.half * 2), X = v => (v + M.half) * k;
    x.fillStyle = '#1b2a1a'; x.fillRect(0, 0, N, N);
    if (M.city) {
      const Cc = M.city, e = (M.half - 6) * k;
      x.fillStyle = '#16263c'; x.fillRect(0, 0, N, N);                       // the sea
      x.fillStyle = '#c2b28a'; x.fillRect(X(-M.half + 2), X(-M.half + 2), (M.half - 2) * 2 * k, (M.half - 2) * 2 * k); // beach
      x.fillStyle = '#2c3e26'; x.fillRect(X(-M.half + 8), X(-M.half + 8), (M.half - 8) * 2 * k, (M.half - 8) * 2 * k);
      x.fillStyle = '#3a4a30'; x.fillRect(X(-157), X(-157), 314 * k, 314 * k);
      x.fillStyle = '#56544e'; for (const l of [...Cc.lots, ...Cc.plazas]) x.fillRect(X(l.x0), X(l.z0), (l.x1 - l.x0) * k, (l.z1 - l.z0) * k);
      x.fillStyle = '#3e5a2e'; for (const l of [...Cc.parks, ...Cc.yards]) x.fillRect(X(l.x0), X(l.z0), (l.x1 - l.x0) * k, (l.z1 - l.z0) * k);
      x.fillStyle = '#26282c'; for (const r of Cc.roads) { if (r.z0 === r.z1) x.fillRect(X(r.x0), X(r.z0 - 6.3), (r.x1 - r.x0) * k, 12.6 * k); else x.fillRect(X(r.x0 - 6.3), X(r.z0), 12.6 * k, (r.z1 - r.z0) * k); }
      x.fillStyle = '#9a9488'; for (const b of Cc.buildings) x.fillRect(X(b.x - b.w / 2), X(b.z - b.d / 2), b.w * k, b.d * k);
      x.fillStyle = '#1e2e1a'; for (const t of [...Cc.trees, ...Cc.pines]) { x.beginPath(); x.arc(X(t.x), X(t.z), 3, 0, 7); x.fill(); }
      x.fillStyle = '#d8b060'; for (const c of M.br.chests) x.fillRect(X(c.x) - 2, X(c.z) - 2, 4, 4);
      x.font = 'bold 20px sans-serif'; x.textAlign = 'center';
      for (const p of M.br.places || []) { x.fillStyle = 'rgba(0,0,0,0.7)'; x.fillText(p.n.toUpperCase(), X(p.x) + 2, X(p.z) + 2); x.fillStyle = '#fff'; x.fillText(p.n.toUpperCase(), X(p.x), X(p.z)); }
      this.island = cv; return;
    }
    for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${40 + Math.random() * 30},${60 + Math.random() * 30},${35},0.25)`; x.beginPath(); x.arc(Math.random() * N, Math.random() * N, 6 + Math.random() * 30, 0, 7); x.fill(); }
    if (M.terrain) {
      // height shading and contour rings every 4m
      const img = x.getImageData(0, 0, N, N), D = img.data;
      for (let j = 0; j < N; j += 2) for (let i = 0; i < N; i += 2) {
        const wx = i / k - M.half, wz = j / k - M.half, h = terrainH(M, wx, wz), hx = terrainH(M, wx + 1, wz) - h, hz = terrainH(M, wx, wz + 1) - h;
        const light = Math.max(-0.4, Math.min(0.4, (-hx - hz) * 0.35)), lift = Math.min(1, h / 22) * 0.55, contour = h > 1.5 && (h % 4) < 0.35 ? 0.22 : 0;
        for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) { const q = ((j + dj) * N + (i + di)) * 4; for (let c = 0; c < 3; c++) D[q + c] = Math.max(0, Math.min(255, D[q + c] * (1 + light + lift) + (c === 0 ? 30 : c === 1 ? 26 : 18) * lift + 255 * contour * 0.35)); }
      }
      x.putImageData(img, 0, 0);
    }
    x.fillStyle = '#0e170e'; for (const c of M.circles) if (c.kind === 'tree') { x.beginPath(); x.arc(X(c.x), X(c.z), Math.max(2, c.r * k * 3), 0, 7); x.fill(); }
    x.fillStyle = '#7d7a72'; for (const b of M.boxes) if (b.kind !== 'boundary' && b.h > 1.2) x.fillRect(X(b.x - b.hx), X(b.z - b.hz), Math.max(2, b.hx * 2 * k), Math.max(2, b.hz * 2 * k));
    x.fillStyle = '#d8b060'; for (const c of M.br.chests) { x.fillRect(X(c.x) - 2, X(c.z) - 2, 4, 4); }
    x.font = 'bold 22px sans-serif'; x.textAlign = 'center';
    for (const p of M.br.places || []) { x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillText(p.n.toUpperCase(), X(p.x) + 2, X(p.z) + 2); x.fillStyle = '#fff'; x.fillText(p.n.toUpperCase(), X(p.x), X(p.z)); }
    x.strokeStyle = '#000'; x.lineWidth = 6; x.strokeRect(0, 0, N, N);
    this.island = cv;
  }
  big(t, sub, sec) { const b = this.q('.bh-big'); b.innerHTML = `${t}${sub ? `<small>${sub}</small>` : ''}`; b.style.opacity = '1'; clearTimeout(this.bigT); this.bigT = setTimeout(() => { b.style.opacity = '0'; }, sec * 1000); }
  feed(html, mine) {
    const f = this.q('.bh-feed'), d = document.createElement('div'); d.innerHTML = html; if (mine) d.className = 'me';
    f.appendChild(d); while (f.children.length > 6) f.firstChild.remove();
    setTimeout(() => d.remove(), 7000);
  }
  toast(html, color) {
    const d = document.createElement('div'); d.className = 'bh-prompt'; d.style.top = '68%'; d.style.color = color || '#fff'; d.innerHTML = html;
    this.el.appendChild(d); setTimeout(() => d.remove(), 1600);
  }
  dmgNum(v, n, head, ward) {
    const c = this.g.chars.get(v.id); if (!c) return;
    const d = document.createElement('div'); d.className = 'bh-dmg'; d.textContent = n;
    d.style.color = head ? '#ffd23a' : ward ? '#7ac8ff' : '#fff'; if (head) d.style.fontSize = '24px';
    this.el.appendChild(d);
    this.dmgEls.push({ d, x: c.x + (Math.random() - 0.5) * 0.6, y: (v.look === 'killer' ? 2.2 : 1.95) + terrainH(this.M, c.x, c.z), z: c.z + (Math.random() - 0.5) * 0.6, t: 0 });
  }
  drawMap(ctx, size, S, me, ring, zoom) {
    const M = this.M, k = size / (M.half * 2) * zoom;
    const cx = zoom > 1 && me ? me.x : 0, cz = zoom > 1 && me ? me.z : 0;
    const X = v => (v - cx) * k + size / 2, Z = v => (v - cz) * k + size / 2;
    ctx.clearRect(0, 0, size, size);
    const s = this.island.width / (M.half * 2);
    ctx.drawImage(this.island, (cx + M.half) * s - size / 2 / k * s, (cz + M.half) * s - size / 2 / k * s, size / k * s, size / k * s, 0, 0, size, size);
    if (ring) {
      // fog outside the ring
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, size, size); const rr = Math.max(0, ring.r * k); ctx.moveTo(X(ring.x) + rr, Z(ring.z)); ctx.arc(X(ring.x), Z(ring.z), rr, 0, Math.PI * 2, true); ctx.closePath(); ctx.fillStyle = 'rgba(120,40,170,0.45)'; ctx.fill('evenodd'); ctx.restore();
      ctx.strokeStyle = '#c070ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(ring.x), Z(ring.z), Math.max(0, ring.r * k), 0, 7); ctx.stroke();
      if (S.fog && S.fog.ph < FOG_PHASES.length) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.arc(X(S.fog.nx), Z(S.fog.nz), Math.max(0, S.fog.nr * k), 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    }
    if (me) {
      const T = me.st === 'ok' ? me : S.players.find(p => p.id === this.spec) || me;
      ctx.save(); ctx.translate(X(T.x), Z(T.z)); ctx.rotate(-T.yaw + Math.PI);
      ctx.fillStyle = '#ffd23a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
    }
  }
  hud(dt, S, me, ring) {
    if (!me) return;
    const q = this.q;
    // vitals
    const life = Math.max(0, me.life ?? MAX_HP), ward = Math.max(0, me.ward || 0);
    q('.bh-life i').style.width = (life / MAX_HP * 100) + '%'; q('.bh-life b').textContent = `${Math.ceil(life)}  Health`;
    q('.bh-ward i').style.width = (ward / MAX_SH * 100) + '%'; q('.bh-ward b').textContent = `${Math.ceil(ward)}  Ward`;
    const A = me.ammo || {};
    const ammoHTML = Object.keys(AMMO).map(k => `<span style="color:#${AMMO[k].color.toString(16).padStart(6, '0')}">${AMMO[k].name.split(' ')[0]} ${A[k] || 0}</span>`).join('');
    if (ammoHTML !== this.ammoHTML) { this.ammoHTML = ammoHTML; q('.bh-ammo').innerHTML = ammoHTML; }
    // hotbar
    const hot = (me.inv || []).map((it, i) => {
      const on = i === me.slot, col = it ? itemColor(it) : 'transparent';
      const n = !it ? '' : it.k === 'w' ? `${on ? me.mg : it.n}<small style="opacity:.6"> / ${A[WEAPONS[it.id].ammo] || 0}</small>` : `×${it.n}`;
      const name = !it ? '<span style="opacity:.4">Hands</span>' : esc(it.k === 'w' ? WEAPONS[it.id].name : HEALS[it.id].name);
      return `<div class="bh-slot ${on ? 'on' : ''}"><span class="k">${i + 1}</span><span class="n" style="color:${it ? col : '#fff'}">${name}</span><span class="m">${n}</span><span class="rar" style="background:${col}"></span></div>`;
    }).join('');
    if (hot !== this.hotHTML) { this.hotHTML = hot; q('.bh-hot').innerHTML = hot; }
    // crosshair: grows with spread
    const it = this.item(me), W = it && it.k === 'w' ? WEAPONS[it.id] : null;
    const scoped = this.ads && W && W.scope;
    q('.bh-scope').style.opacity = scoped ? '1' : '0';
    const spread = W ? W.spread * (this.ads ? (W.pellets ? 0.75 : 0.35) : 1) * (me.mv >= 1 ? 1.35 : 1) : 0.02;
    const gap = Math.round(4 + spread * innerHeight * 0.9);
    const ch = `${gap}`;
    if (ch !== this.crossKey) {
      this.crossKey = ch;
      q('.bh-cross').innerHTML = scoped ? '' : `<i style="left:-1px;top:${-gap - 9}px;width:2px;height:8px"></i><i style="left:-1px;top:${gap + 1}px;width:2px;height:8px"></i><i style="top:-1px;left:${-gap - 9}px;width:8px;height:2px"></i><i style="top:-1px;left:${gap + 1}px;width:8px;height:2px"></i><i style="left:-1px;top:-1px;width:2px;height:2px"></i>`;
    }
    q('.bh-cross').style.display = me.st === 'ok' && !scoped ? 'block' : 'none';
    this.hitT = Math.max(0, (this.hitT || 0) - dt);
    const hit = q('.bh-hit'); hit.style.opacity = (this.hitT / 0.18).toFixed(2); hit.classList.toggle('head', !!this.hitHead);
    // alive, kills, fog clock
    q('.bh-alive').textContent = S.left ?? S.players.filter(p => p.st === 'ok').length;
    q('.bh-kills').textContent = me.kills || 0;
    const F = S.fog;
    let fogTxt = '';
    if (F && F.ph < FOG_PHASES.length) fogTxt = S.t < F.t0 ? `Fog moves in ${mm(F.t0 - S.t)}` : `Fog closing · ${mm(F.t1 - S.t)}`;
    else if (F) fogTxt = 'The fog has closed';
    if (fogTxt !== this.fogTxt) { this.fogTxt = fogTxt; q('.bh-fog').textContent = fogTxt; }
    const out = ring && me.st === 'ok' && Math.hypot(me.x - ring.x, me.z - ring.z) > ring.r;
    q('.bh-fogfx').style.opacity = out ? '1' : '0';
    // maps (a few times a second)
    this.mapT = (this.mapT || 0) - dt;
    if (this.mapT <= 0) { this.mapT = 0.1; this.drawMap(this.mini, 380, S, me, ring, 3.2); if (this.mapBig) this.drawMap(this.bigCtx, 900, S, me, ring, 1); }
    // what's in reach
    this.target = null;
    let prompt = '';
    if (me.st === 'ok') {
      let best = null, bs = 1e9;
      const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw);
      const consider = (x, z, o) => { const dx = x - me.x, dz = z - me.z, d = Math.hypot(dx, dz); if (d > 2.4) return; const s = d - (dx * fx + dz * fz) / (d || 1) * 0.8; if (s < bs) { bs = s; best = o; } };
      this.M.br.chests.forEach((c, i) => { if (!(S.copen || []).includes(i)) consider(c.x, c.z, { chest: i, label: 'Open chest', col: '#ffd070' }); });
      (this.M.br.sacks || []).forEach((c, i) => { if (!(S.sopen || []).includes(i)) consider(c.x, c.z, { sack: i, label: c.kind === 'sack' ? 'Search the sack' : 'Search the rucksack', col: '#e0c890' }); });
      for (const L of this.lootEntries(S)) consider(L.x, L.z, { u: L.u, label: 'Pick up ' + itemName({ k: L.k, id: L.i, r: L.r, n: L.n }), col: itemColor({ k: L.k, r: L.r }) });
      this.target = best;
      if (best) prompt = `<kbd>E</kbd><span style="color:${best.col}">${esc(best.label)}</span>${best.u && me.inv && me.inv.every(Boolean) && !String(best.label).includes('rounds') && !String(best.label).includes('Shells') ? ' <span style="opacity:.7">(swaps with what you hold)</span>' : ''}`;
      else if (W && me.mg <= 0 && !(A[W.ammo] > 0)) prompt = `<span style="color:#ff9a8a">Out of ${AMMO[W.ammo].name.toLowerCase()}</span>`;
      else if (W && me.mg <= 0) prompt = '<kbd>R</kbd>Reload';
    }
    if (prompt !== this.promptHTML) { this.promptHTML = prompt; q('.bh-prompt').innerHTML = prompt; }
    // reloading / healing bar
    let act = '';
    if (me.heal) act = `Using ${esc(HEALS[me.heal.id].name)}<div><i style="width:${Math.min(100, me.heal.t / me.heal.d * 100)}%"></i></div>`;
    else if (me.rel > 0 && W) act = `Reloading<div><i style="width:${Math.min(100, (1 - me.rel / W.reload) * 100)}%"></i></div>`;
    if (act !== this.actHTML) { this.actHTML = act; q('.bh-act').innerHTML = act; }
    // damage numbers float up
    for (let i = this.dmgEls.length - 1; i >= 0; i--) {
      const D = this.dmgEls[i]; D.t += dt;
      if (D.t > 0.9) { D.d.remove(); this.dmgEls.splice(i, 1); continue; }
      const v = new THREE.Vector3(D.x, D.y + D.t * 0.8, D.z).project(this.g.camera);
      if (v.z > 1) { D.d.style.opacity = '0'; continue; }
      D.d.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px'; D.d.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px'; D.d.style.opacity = String(Math.min(1, 2 - D.t * 2));
    }
    // where the shots came from
    this.dirs = this.dirs.filter(d => (d.t -= dt) > 0);
    if (this.dirs.length || this.dirsShown) { this.dirsShown = this.dirs.length > 0; q('.bh-dirs').innerHTML = this.dirs.map(d => { const a = d.a - me.yaw; return `<i style="transform:rotate(${(-a * 180 / Math.PI + 90).toFixed(0)}deg) translateX(-110px);opacity:${Math.min(1, d.t).toFixed(2)}"></i>`; }).join(''); }
    // spectating
    const spec = me.st !== 'ok' && S.phase === 'play' ? S.players.find(p => p.id === this.spec) : null;
    const st = spec && spec.id !== me.id ? `Spectating <b>${esc(spec.name)}</b> · ${spec.kills || 0} eliminations<br><small style="opacity:.7">Click to watch someone else · Esc to leave</small>` : '';
    if (st !== this.specHTML) { this.specHTML = st; q('.bh-spec').innerHTML = st; }
  }

  // ---------- end of the match ----------
  results(S, me) {
    const rows = S.players.slice().sort((a, b) => (a.place || 99) - (b.place || 99)).map(p => {
      const tot = Math.round(p.score.a + p.score.b + p.score.c + p.score.d);
      const look = p.look === 'killer' ? KILLERS[p.char] : SURVIVORS[p.char];
      return `<div class="res ${p.outcome === 'win' || p.st === 'ok' ? 'esc' : 'dead'} ${p.id === this.g.myId ? 'me' : ''}"><div class="rp" style="font-weight:800;font-size:18px">#${p.place || '?'}</div><div class="res-name">${esc(p.name)}<small>${esc(look ? look.name : '')}</small></div>
        <div class="res-out">${p.outcome === 'win' ? 'Last one standing' : p.st === 'ok' ? 'Still standing' : 'Eliminated'}</div>
        <div class="res-cats"><span>Placement<b>${p.score.a}</b></span><span>Eliminations<b>${p.kills || 0}</b></span><span>Damage<b>${Math.round(p.dmg || 0)}</b></span><span>Win bonus<b>${p.score.d}</b></span></div>
        <div class="res-tot">${tot}<small>embers</small></div></div>`;
    }).join('');
    const title = !me ? 'Match Over' : me.outcome === 'win' ? '#1 · Last One Standing!' : `#${me.place} of ${S.players.length}`;
    return { title, rows };
  }
}
