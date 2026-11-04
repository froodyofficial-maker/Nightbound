// Client runtime: rendering, input, camera, HUD, audio. Works the same for host and remote clients.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { realistic, nightEnv } from './gfx.js';
import { KILLERS, SURVIVORS, SURV_PERKS, KILLER_PERKS, RULES, MODES, ITEMS, skinOf } from './config.js';
import { buildWorld, updateWorld, pointBlocked, QUALITY } from './world.js';
import { chuckyReady } from './chuckyGlb.js';
import { grannyReady, grandpaReady, spiderMomReady, makeSpiderMom } from './grannyGlb.js';
import { Sidekick, TED_LINES, TED_CAPTIONS, resetVoices } from './sidekicks.js';
import { remapCode, label as keyLabel, moveLabel } from './keybinds.js';
import { bakeArm } from './fpArms.js';
import { foremanReady, batmanReady } from './foremanGlb.js';
let KB_SETTINGS = null;
const kbd = id => `<kbd>${keyLabel(KB_SETTINGS, id).replace(/[<>&]/g, '')}</kbd>`;
import { staticReady, cloneStatic } from './glbModels.js';
import { makeSurvivor, makeKiller, animate, makeViewModel, animateView, makeSpear, makeLantern, makeChainsaw, auraMat, HOOK_Y } from './models.js';
import { stepMover, startVault } from './movement.js';
import { findInteraction, findSpace, findExecute, vaultDuration, killerOf, killersOf, nearestKiller, playerById, has, terrorRadius, dist, angDiff, fwd, actionTime } from './rules.js';
import { losBlocked, heightAt, levelOf } from './map.js';
import { sound } from './audio.js';
import { tex } from './textures.js';
import { icon, STATE_ICON, POWER_ICON } from './icons.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// flashlight beam: an open cone fading with distance and toward its edges (additive, cheap)
const BEAM_GEO = new THREE.CylinderGeometry(1.35, 0.035, 9, 20, 1, true).translate(0, 4.5, 0).rotateX(Math.PI / 2);
const BEAM_MAT = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
    void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying float vY; varying vec3 vN; varying vec3 vV;
    void main(){ float e = abs(dot(normalize(vN), normalize(vV))); float a = pow(1.0 - vY, 1.5) * 0.16 * (0.55 + 0.45 * (1.0 - e)); gl_FragColor = vec4(1.0, 0.95, 0.82, a); }`,
});

// proton stream: a hot orange stream wrapped round a white-blue core
const PROTON_MAT = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: BEAM_MAT.vertexShader,
  fragmentShader: `varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float a = (1.0 - vY * 0.6) * 0.75; gl_FragColor = vec4(1.0, 0.42, 0.12, a); }` });
const PROTON_CORE = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: BEAM_MAT.vertexShader,
  fragmentShader: `varying float vY; varying vec3 vN; varying vec3 vV; void main(){ gl_FragColor = vec4(0.7, 0.85, 1.0, (1.0 - vY * 0.5) * 0.9); }` });

const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec3 v = c.rgb;
      bvec3 bad = bvec3(!(v.r == v.r) || abs(v.r) > 6e4, !(v.g == v.g) || abs(v.g) > 6e4, !(v.b == v.b) || abs(v.b) > 6e4);
      if (any(bad)) v = vec3(0.0);
      gl_FragColor = vec4(clamp(v, 0.0, 48.0), 1.0); }`,
};
const PostShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, red: { value: 0 }, desat: { value: 0 }, flash: { value: 0 }, vig: { value: 0.9 }, grain: { value: 0.01 }, pulse: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, red, desat, flash, vig, grain, pulse; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time*7.0) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(max(c.rgb, 0.0), vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(c.rgb, vec3(l), desat);
      // grade (scene is still linear HDR here): slightly cool shadows, warm highlights,
      // and contrast around mid-grey that can never push a channel negative
      float lg = dot(max(c.rgb, 0.0), vec3(0.2126, 0.7152, 0.0722));
      c.rgb = max(c.rgb, 0.0) * mix(vec3(0.95, 0.99, 1.05), vec3(1.05, 1.0, 0.94), smoothstep(0.02, 0.5, lg));
      c.rgb = pow(c.rgb / 0.18, vec3(1.05)) * 0.18;
      vec2 d = vUv - 0.5; float r = length(d*vec2(1.25,1.0));
      float v = smoothstep(0.85, 0.25, r*(vig + pulse*0.25));
      c.rgb *= mix(0.4, 1.0, v);
      float edge = smoothstep(0.25, 0.8, r);
      c.rgb = mix(c.rgb, c.rgb * vec3(1.35, 0.35, 0.32) + vec3(0.05, 0.0, 0.0), edge * red);
      c.rgb += vec3(0.35,0.0,0.0)*flash*edge;
      c.rgb += (rnd(vUv*vec2(1920.0,1080.0)) - 0.5) * grain;
      gl_FragColor = c;
    }`,
};

// ---------- particles ----------
class Particles {
  constructor(scene, blending, size, max = 600, texName = 'glow') {
    this.max = max; this.n = 0; this.onLand = null; this.landed = new Uint8Array(max);
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.grav = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.pts = new THREE.Points(this.geo, new THREE.PointsMaterial({ size, map: tex(texName).map, vertexColors: true, transparent: true, depthWrite: false, blending, sizeAttenuation: true, alphaTest: texName === 'droplet' ? 0.3 : 0 }));
    this.pts.frustumCulled = false;
    scene.add(this.pts);
  }
  spawn(x, y, z, n, color, speed, life, grav = -9, spread = 1, up = 1) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const k = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
      this.pos.set([x + (Math.random() - 0.5) * 0.2 * spread, y, z + (Math.random() - 0.5) * 0.2 * spread], k * 3);
      const a = Math.random() * 6.283, s = speed * (0.4 + Math.random() * 0.6);
      this.vel.set([Math.cos(a) * s * spread, (0.5 + Math.random()) * s * up, Math.sin(a) * s * spread], k * 3);
      this.col.set([c.r, c.g, c.b], k * 3);
      this.life[k] = this.maxLife[k] = life * (0.6 + Math.random() * 0.4); this.grav[k] = grav; this.landed[k] = 0;
    }
  }
  // directional spray (e.g. arterial blood thrown away from the killer)
  spray(x, y, z, n, color, dx, dz, speed, life) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const k = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
      this.pos.set([x, y + (Math.random() - 0.5) * 0.3, z], k * 3);
      const s = speed * (0.4 + Math.random() * 0.8), sp = 0.45;
      this.vel.set([(dx + (Math.random() - 0.5) * sp) * s, (0.2 + Math.random() * 0.6) * s * 0.6, (dz + (Math.random() - 0.5) * sp) * s], k * 3);
      const v = 0.7 + Math.random() * 0.5; this.col.set([c.r * v, c.g * v, c.b * v], k * 3);
      this.life[k] = this.maxLife[k] = life * (0.6 + Math.random() * 0.4); this.grav[k] = -9.8; this.landed[k] = 0;
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] += this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) { if (!this.landed[i] && this.onLand && this.grav[i] < -5) { this.landed[i] = 1; this.onLand(this.pos[i * 3], this.pos[i * 3 + 2]); } this.pos[i * 3 + 1] = 0.02; this.vel[i * 3] *= 0.3; this.vel[i * 3 + 2] *= 0.3; this.vel[i * 3 + 1] = 0; }
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -100;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      if (f < 0.3) { this.col[i * 3] *= 0.92; this.col[i * 3 + 1] *= 0.92; this.col[i * 3 + 2] *= 0.92; }
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
}

// ---------- blood droplets: lit, glossy and stretched along their flight (same API as Particles) ----------
class BloodDrops extends Particles {
  constructor(scene, max = 900, lite = false) {
    super(scene, THREE.NormalBlending, 0.055, max, 'droplet');
    if (lite) return; // low-end: keep the cheap point sprites
    scene.remove(this.pts);
    this.size = new Float32Array(max); for (let i = 0; i < max; i++) this.size[i] = 0.008 + Math.pow(Math.random(), 2.2) * 0.03;
    const geo = new THREE.SphereGeometry(1, 7, 5);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0.05, emissive: 0x120000 }), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    scene.add(this.mesh);
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0); this.s = new THREE.Vector3(); this.p = new THREE.Vector3();
  }
  update(dt) {
    super.update(dt);
    if (!this.mesh) return;
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      const r = this.size[i], vx = this.vel[i * 3], vy = this.vel[i * 3 + 1], vz = this.vel[i * 3 + 2], sp = Math.hypot(vx, vy, vz);
      const onGround = this.pos[i * 3 + 1] <= 0.021;
      this.v.set(vx, vy, vz); if (sp > 0.01) this.q.setFromUnitVectors(this.up, this.v.multiplyScalar(1 / sp)); else this.q.identity();
      // in flight: a streak; on the ground: a flattened bead
      if (onGround) this.s.set(r * 1.6, r * 0.25, r * 1.6); else this.s.set(r, r * (1 + Math.min(4, sp * 0.35)), r);
      this.p.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this.m4.compose(this.p, onGround ? this.q.identity() : this.q, this.s);
      this.mesh.setMatrixAt(k, this.m4);
      this.mesh.instanceColor.setXYZ(k, this.col[i * 3] * 0.8, this.col[i * 3 + 1] * 0.5, this.col[i * 3 + 2] * 0.5);
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------- scratch marks: running survivors leave glowing claw-like streaks only the killer sees ----------
class ScratchMarks {
  constructor(scene, max = 360) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.strokeStyle = '#fff'; g.lineCap = 'round'; g.shadowColor = '#fff'; g.shadowBlur = 6;
    for (let i = 0; i < 3; i++) { // three jagged streaks, like something dragged its nails
      g.lineWidth = 5 - i; g.beginPath();
      let x = 22 + i * 30 + Math.random() * 8, y = 12 + Math.random() * 10; g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 12; y += 16 + Math.random() * 4; g.lineTo(x, y); }
      g.stroke();
    }
    const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.55, 0.55).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2 }), max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this.max = max; this.marks = []; this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.col = new THREE.Color(0xff4a1c);
  }
  add(x, z, yaw) {
    if (this.marks.length >= this.max) this.marks.shift();
    this.marks.push({ x, z, yaw, t: 0, life: 9 + Math.random() * 2, s: 0.7 + Math.random() * 0.5 });
  }
  update(dt, visible) {
    this.mesh.visible = visible;
    let k = 0;
    for (let i = this.marks.length - 1; i >= 0; i--) { const m = this.marks[i]; m.t += dt; if (m.t >= m.life) this.marks.splice(i, 1); }
    if (!visible) return;
    for (const m of this.marks) {
      const f = m.t / m.life, a = Math.min(1, m.t * 6) * (1 - f * f) * 0.95; // bright, then fading out
      this.q.setFromEuler(this.e.set(0, m.yaw, 0));
      this.m4.compose(new THREE.Vector3(m.x, 0.03, m.z), this.q, new THREE.Vector3(m.s, 1, m.s * 1.2));
      this.mesh.setMatrixAt(k, this.m4);
      this.mesh.instanceColor.setXYZ(k, this.col.r * a, this.col.g * a * (1 - f * 0.6), this.col.b * a * (1 - f));
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------- blood decals: wet pools, splatters, sprays and drag smears that dry over time ----------
class BloodDecals {
  constructor(scene, max, lite) {
    this.max = max; this.i = 0; this.list = [];
    const atlas = tex('bloodatlas').map;
    this.geos = [0, 1, 2, 3].map(cell => {
      const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
      const uv = g.attributes.uv, ox = (cell % 2) * 0.5, oy = cell < 2 ? 0.5 : 0;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, ox + uv.getX(k) * 0.5, oy + uv.getY(k) * 0.5);
      return g;
    });
    for (let k = 0; k < max; k++) {
      const m = lite
        ? new THREE.MeshLambertMaterial({ map: atlas, emissive: 0x3a0000, emissiveMap: atlas, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
        : new THREE.MeshStandardMaterial({ map: atlas, emissive: 0x3a0000, emissiveMap: atlas, transparent: true, depthWrite: false, roughness: 0.12, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 });
      const mesh = new THREE.Mesh(this.geos[0], m);
      mesh.visible = false; mesh.renderOrder = 1; mesh.receiveShadow = true;
      scene.add(mesh); this.list.push(mesh);
    }
    this.landBudget = 0;
  }
  // cell: 0 splatter, 1 pool, 2 spray, 3 smear
  add(x, z, size, cell = 0, rot = Math.random() * 6.28) {
    const m = this.list[this.i++ % this.max];
    m.geometry = this.geos[cell];
    m.position.set(x, 0.022 + (this.i % 40) * 0.0004, z);
    m.rotation.set(0, rot, 0); m.scale.set(size, 1, size);
    m.userData = { age: 0, grow: cell === 1 ? 0.35 : 1, size };
    m.material.opacity = 0.96; m.material.color.setRGB(1, 1, 1);
    m.visible = true;
  }
  update(dt) {
    this.landBudget = Math.min(6, this.landBudget + dt * 30);
    for (const m of this.list) {
      if (!m.visible) continue;
      const u = m.userData; u.age += dt;
      if (u.grow < 1) { u.grow = Math.min(1, u.grow + dt * 0.25); m.scale.set(u.size * u.grow, 1, u.size * u.grow); }
      const dry = Math.min(1, u.age / 50);
      m.material.color.setRGB(1 - dry * 0.45, 1 - dry * 0.55, 1 - dry * 0.55);
      m.material.emissiveIntensity = 1 - dry * 0.75;
      if (m.material.roughness !== undefined) m.material.roughness = 0.18 + dry * 0.6;
      if (u.age > 90) { m.material.opacity = Math.max(0, 0.96 - (u.age - 90) / 30); if (u.age > 120) m.visible = false; }
    }
  }
}

// how a player looks to everyone else: a body possessed by Chucky still looks like its survivor
const lookRole = p => p.disguise ? 'survivor' : p.role;
// killers played over the shoulder: Chucky, and Chucky inside a survivor's body
// killers drawn from a GLB model: their first-person arms are cut from it
const GLB_KILLERS = new Set(['granny', 'foreman', 'slimer']);
const FP_OPT = { slimer: { region: { sign: -1, from: 0.55, wrist: 0.72 } }, foreman: { skip: /Foreman_14/ }, granny: { pitch: -0.35 } };
function fpModelReady(id, sk) {
  if (id === 'granny') return sk.grandpa ? grandpaReady() : grannyReady();
  if (id === 'foreman') return sk.batman ? batmanReady() : foremanReady();
  if (id === 'slimer') return staticReady('slimer');
  return true;
}
function killerViewParts(id, sk) {
  let R = null;
  try { R = makeKiller(id, sk); } catch (e) { return {}; }
  if (!R) return {};
  const out = {};
  if (R.glb || R.staticGlb) {
    if (!GLB_KILLERS.has(id)) return {};
    const o = FP_OPT[id] || {};
    try { out.R = bakeArm(R.root, 'R', o); out.L = bakeArm(R.root, 'L', { ...o, noRigid: true, pitch: 0 }); } catch (e) { console.warn('first-person arms:', e); }
    if (!out.R) delete out.R; if (!out.L) delete out.L;
  } else if (R.j) {
    // a procedural killer: use the materials of their own forearm and hand (outfit colours included)
    const first = j => j && j.children.find(c => c.isMesh && c.material && !Array.isArray(c.material));
    const fm = first(R.j.elR), hm = first(R.j.handR);
    if (fm) out.armM = fm.material; if (hm) out.handM = hm.material;
  }
  return out;
}
const isTpv = p => !!p && (p.disguise || !!(KILLERS[p.char] && KILLERS[p.char].tpv));
// Chucky's pounce arc
function leapLift(p) {
  const L = p.leap; if (L) return Math.sin(Math.min(1, L.t / L.d) * Math.PI) * (L.h || 0.6);
  const f = p.hop ? Math.min(1, p.hop.t / p.hop.d) : p.hopF || 0; // Chucky's jump
  return f > 0 ? Math.sin(f * Math.PI) * 0.8 : 0;
}
// height of a killer swinging on a high chain hook: up to the hook, then a drop at the end
function pullLift(p) {
  const P = p.pull;
  if (!P || !P.h) return 0;
  const f = Math.min(1, P.t / P.d);
  if (f < 0.7) { const u = f / 0.7; return P.h * (1 - (1 - u) * (1 - u)); }
  const u = (f - 0.7) / 0.3; return P.h * (1 - u * u);
}

export class Game {
  constructor(o) {
    this.o = o;
    this.renderer = o.renderer; this.M = o.M; this.myId = o.myId; this.isHost = o.isHost; this.session = o.session; this.settings = o.settings;
    this.chars = new Map();
    this.keys = new Set();
    this.mdx = 0; this.mdy = 0;
    this.camYaw = 0; this.camPitch = 0.25;
    this.me = null; this.myTp = 0; this.lastSnap = null;
    this.eHeld = false; this.aimHeld = false;
    this.posTimer = 0; this.t = 0;
    this.skill = null; this.skillCooldown = 3;
    this.feedItems = [];
    this.markers = [];
    this.shake = 0; this.flash = 0;
    this.spectate = null;
    this.ended = false; this.endShown = false;
    this.lastWigKey = '';
    this.pred = { atk: 0, ab: 0 };
    this.spears = [];
    this.disposed = false;
  }

  start() {
    resetVoices(); KB_SETTINGS = this.settings;
    const q = QUALITY[this.settings.quality] || QUALITY.medium;
    this.W = buildWorld(this.M, this.settings.quality);
    this.scene = this.W.scene;
    this.camera = new THREE.PerspectiveCamera(this.settings.fov || 75, innerWidth / innerHeight, 0.05, q.far);
    this.q = q; this.pr = q.pixel; this.ftAvg = 1 / 60; this.drT = 0; this.fpsT = 0; this.fpsN = 0;
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.sparks = new Particles(this.scene, THREE.AdditiveBlending, 0.12);
    // one shared spotlight for flashlights (kept in the scene so the light count never changes)
    if (this.settings.quality === 'medium' || this.settings.quality === 'high') {
      this.torchLight = new THREE.SpotLight(0xfff0d0, 0, 16, 0.32, 0.55, 1.2);
      this.scene.add(this.torchLight, this.torchLight.target);
      this.torchBest = Infinity;
    }
    this.blood = new BloodDrops(this.scene, 900, this.settings.quality === 'potato' || this.settings.quality === 'low');
    const lite = this.settings.quality === 'potato' || this.settings.quality === 'low';
    this.scratches = new ScratchMarks(this.scene);
    this.decals = new BloodDecals(this.scene, { potato: 40, low: 80, medium: 160, high: 240 }[this.settings.quality] || 120, lite);
    this.blood.onLand = (x, z) => { if (this.decals.landBudget >= 1 && Math.random() < 0.35) { this.decals.landBudget--; this.decals.add(x, z, 0.12 + Math.random() * 0.2, 0); } };
    this.smoke = new Particles(this.scene, THREE.NormalBlending, 1.4, 300);
    // renderer + post
    const r = this.renderer;
    r.shadowMap.enabled = !!q.shadow;
    r.setPixelRatio(q.pixel);
    r.setSize(innerWidth, innerHeight);
    const real = realistic() && !!q.post;
    // realistic look: faint night-sky reflections on every lit surface
    if (realistic() && q.shadow && !this.M.indoor) { const LK = this.W.look; this.scene.environment = nightEnv(r, LK && LK.sky ? LK.sky[0] : 0x1a2436, LK && LK.fog != null ? LK.fog : 0x0c1018); }
    else if (realistic() && q.shadow) this.scene.environment = nightEnv(r, 0x2a1a14, 0x100806);
    if (q.post) {
      // multisampled render target: the post-processing chain otherwise loses anti-aliasing
      const rt = real ? new THREE.WebGLRenderTarget(innerWidth * r.getPixelRatio(), innerHeight * r.getPixelRatio(), { type: THREE.HalfFloatType, samples: 4 }) : undefined;
      this.composer = new EffectComposer(r, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      // guard: one bad (NaN / infinite) pixel would otherwise be smeared by bloom into growing black squares
      this.composer.addPass(new ShaderPass(SanitizeShader));
      if (q.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.5, 0.8); this.composer.addPass(this.bloom); }
      this.post = new ShaderPass(PostShader); this.composer.addPass(this.post);
      this.composer.addPass(new OutputPass());
    } else { this.composer = null; this.post = null; }
    // HUD
    this.hud = $('hud'); this.hud.classList.remove('hidden');
    $('results').classList.add('hidden');
    $('pause').classList.add('hidden');
    $('feed').innerHTML = ''; $('markers').innerHTML = '';
    this.skillCanvas = $('skill'); this.skillCtx = this.skillCanvas.getContext('2d');
    // input
    this.bind();
    // initial camera
    const S = this.session.state();
    const me = playerById(S, this.myId);
    if (me) { this.camYaw = me.yaw; this.myTp = me.tp; }
    this.role = me ? me.role : 'survivor';
    if (this.role === 'killer' && !isTpv(me)) this.setupKillerView(me);
    this.buildStaticHUD(S);
    sound.ambience(true);
    this.onResize();
  }
  // first-person weapon and swing trail for a killer
  setupKillerView(me) {
    {
      this.buildView(me);
      // weapon swing trail (camera space)
      const N = 14;
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      const idx = []; for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      tg.setIndex(idx);
      this.trail = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
      this.trail.frustumCulled = false; this.trail.renderOrder = 6;
      this.trailPts = [];
      this.camera.add(this.trail);
    }
  }
  // the first-person arms: cut from the killer's own model (and outfit) once it has loaded
  buildView(me) {
    if (this.view) this.camera.remove(this.view);
    const sk = skinOf(me.char, me.skin), real = killerViewParts(me.char, sk);
    this.view = makeViewModel(me.char, sk, real);
    this.view.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.userData.op = o.material.opacity; } });
    this.camera.add(this.view);
    this.viewFaded = false;
    // a model still loading: try again when it's in
    this.viewPending = GLB_KILLERS.has(me.char) && !real.R ? me.char + ':' + me.skin : null;
    this.viewReady = fpModelReady(me.char, sk);
  }
  // Infection: a survivor who turns becomes a killer mid-match
  switchRole(me, S) {
    this.role = me.role;
    if (this.view) { this.camera.remove(this.view); this.view = null; }
    if (this.trail) { this.camera.remove(this.trail); this.trail = null; }
    this.flashHeld = false; this.aimHeld = false; this.eHeld = false; this.skill = null; this.skillCanvas.classList.add('hidden');
    if (me.role === 'killer') { if (!isTpv(me)) this.setupKillerView(me); this.camYaw = me.yaw; }
    this.buildStaticHUD(S);
  }

  // ---------------- input ----------------
  bind() {
    const c = this.renderer.domElement;
    this.h = {
      kd: e => this.onKey(e, true), ku: e => this.onKey(e, false),
      md: e => this.onMouse(e, true), mu: e => this.onMouse(e, false),
      mm: e => {
        if (document.pointerLockElement !== c) return;
        // Chrome occasionally reports a huge bogus delta while pointer-locked, which flips the view; drop those
        if (Math.abs(e.movementX) > 280 || Math.abs(e.movementY) > 280) return;
        this.mdx += e.movementX; this.mdy += e.movementY;
      },
      click: () => { if (!this.paused && !this.endShown) this.lock(); },
      plc: () => { if (document.pointerLockElement !== c && !this.endShown && !this.disposed && !this.skipPause) this.pause(true); this.skipPause = false; },
      resize: () => this.onResize(),
      ctx: e => e.preventDefault(),
      blur: () => { this.keys.clear(); },
    };
    addEventListener('keydown', this.h.kd); addEventListener('keyup', this.h.ku);
    c.addEventListener('mousedown', this.h.md); addEventListener('mouseup', this.h.mu);
    addEventListener('mousemove', this.h.mm); c.addEventListener('click', this.h.click);
    document.addEventListener('pointerlockchange', this.h.plc);
    addEventListener('resize', this.h.resize); c.addEventListener('contextmenu', this.h.ctx);
    addEventListener('blur', this.h.blur);
  }
  unbind() {
    if (!this.h) return;
    const c = this.renderer.domElement;
    removeEventListener('keydown', this.h.kd); removeEventListener('keyup', this.h.ku);
    c.removeEventListener('mousedown', this.h.md); removeEventListener('mouseup', this.h.mu);
    removeEventListener('mousemove', this.h.mm); c.removeEventListener('click', this.h.click);
    document.removeEventListener('pointerlockchange', this.h.plc);
    removeEventListener('resize', this.h.resize); c.removeEventListener('contextmenu', this.h.ctx);
    removeEventListener('blur', this.h.blur);
  }
  lock() {
    const c = this.renderer.domElement;
    if (!c.requestPointerLock) return;
    // raw, unaccelerated mouse input where supported (also avoids the delta spikes); fall back silently
    try {
      const p = c.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { const p2 = c.requestPointerLock(); if (p2 && p2.catch) p2.catch(() => {}); } catch {} });
    } catch { try { c.requestPointerLock(); } catch {} }
  }
  pause(on) {
    this.paused = on;
    $('pause').classList.toggle('hidden', !on);
    if (on) { this.keys.clear(); if (document.pointerLockElement) { this.skipPause = true; document.exitPointerLock(); } }
    else this.lock();
  }

  // translate the key through the player's keybinds, then handle it as its default key
  onKey(raw, down) {
    const code = remapCode(this.settings, raw.code);
    if (code == null) return;
    if (code !== raw.code && !(raw.target && (raw.target.tagName === 'INPUT' || raw.target.tagName === 'SELECT'))) raw.preventDefault();
    this.onKeyCode({ code, repeat: raw.repeat, target: raw.target, preventDefault: () => raw.preventDefault() }, down);
  }
  onKeyCode(e, down) {
    if (this.paused && e.code !== 'Escape') return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (['Space', 'Tab', 'KeyE', 'ShiftLeft', 'ControlLeft', 'KeyC', 'KeyQ'].includes(e.code)) e.preventDefault();
    if (e.code === 'Tab') { $('scoreboard').classList.toggle('hidden', !down); if (down) this.renderScoreboard(); return; }
    if (down) {
      if (e.repeat) return;
      this.keys.add(e.code);
      sound.init();
      if (e.code === 'Escape') { if (this.endShown) return; this.pause(!this.paused); return; }
      if (e.code === 'Space') this.onSpace();
      if (e.code === 'KeyQ') this.send({ t: 'act', a: 'drop-carry' });
      if (e.code === 'KeyG' && this.mine() && this.mine().role === 'killer' && this.mine().char === 'granny') { const m = this.mine(); if (m.teleCd <= 0 && !m.tele && m.carry == null) this.creepHeld = true; else this.feed(m.tele ? 'Already creeping…' : m.carry != null ? 'Not while carrying someone.' : `Creep recharging (${Math.ceil(m.teleCd)}s)`); }
      if (e.code === 'KeyG') this.send({ t: 'act', a: 'trap' });
      if (e.code === 'KeyR' && this.mine() && this.mine().char === 'lamplighter') this.send({ t: 'act', a: 'teleport', yaw: this.mine().yaw });
      if (e.code === 'KeyR' && this.mine() && this.mine().role === 'killer' && KILLERS[this.mine().char].ability2) this.send({ t: 'act', a: 'ability2' });
      if (e.code === 'KeyG' && this.mine() && this.mine().role === 'killer' && (this.mine().char === 'chucky' || this.mine().disguise)) this.send({ t: 'act', a: 'possess' });
      if (e.code === 'KeyV' && this.mine() && this.mine().role === 'killer' && this.mine().char === 'chucky') this.send({ t: 'act', a: 'split' });
      if (e.code === 'KeyV' && this.mine() && this.mine().role === 'killer' && this.mine().char === 'granny') {
        const m = this.mine();
        if (!this.S.spider) this.feed('Spider Mom is not here.');
        else if (m.swapCd > 0) this.feed(`Body Swap in ${Math.ceil(m.swapCd)}s`);
        else if (m.carry != null) this.feed('Not while carrying someone.');
        else { this.swapHeld = true; this.swapT = this.t; }
      }
      if (e.code === 'KeyF' && this.mine() && this.mine().role === 'killer') { const ex = findExecute(this.M, this.S, this.mine()); if (ex) this.send({ t: 'act', a: 'execute', id: ex.id }); }
      if ((e.code === 'KeyA' || e.code === 'KeyD') && this.mine() && this.mine().st === 'carried') {
        if (e.code !== this.lastWigKey) { this.lastWigKey = e.code; this.send({ t: 'act', a: 'wig' }); this.wigFlash = 0.15; }
      }
      if (e.code === 'KeyF' || e.code === 'Digit1') this.cycleSpectate();
      if (e.code === 'KeyB' && !e.repeat) this.toggleEmotes();
      if (this.emoteBar && !this.emoteBar.classList.contains('hidden') && /^Digit[1-4]$/.test(e.code)) { this.playEmote(+e.code.slice(5)); return; }
      if (e.code === 'KeyH' && !e.repeat) { this.settings.camSide = (this.settings.camSide ?? 1) === 1 ? -1 : 1; window.dispatchEvent(new Event('nb-cam')); this.feed(this.settings.camSide === 1 ? 'Camera: right shoulder' : 'Camera: left shoulder'); }
      if (e.code === 'KeyT') { const b = this.takeoverTarget(); if (b) this.send({ t: 'act', a: 'takeover', id: b.id }); }
    } else {
      this.keys.delete(e.code);
      if (e.code === 'KeyV' && this.swapHeld) { this.swapHeld = false; this.send({ t: 'act', a: 'bodyswap' }); }
      if (e.code === 'KeyG' && this.creepHeld) { this.creepHeld = false; const t = this.creepSel; if (t) this.send({ t: 'act', a: 'creep', kind: t.kind, id: t.id }); this.clearCreep(); }
    }
  }
  onMouse(e, down) {
    if (this.paused || this.endShown) return;
    sound.init();
    const me = this.mine();
    if (!me) return;
    if (down && document.pointerLockElement !== this.renderer.domElement) return;
    if (me.role === 'killer') {
      if (e.button === 0 && down) {
        if (!me.atk && me.carry == null && me.stun <= 0 && !me.act && !(me.char === 'wisp' && me.ab) && !(me.char === 'butcher' && me.ab === 1)) { this.pred.atk = this.t + 0.4; if (this.isHost) {} }
        this.send({ t: 'act', a: 'attack' });
      }
      if (e.button === 2) {
        if (me.char === 'foreman') {
          if (down && me.abCd <= 0) { this.aimHeld = true; this.sendIn(); }
          else if (!down && this.aimHeld) { this.aimHeld = false; this.send({ t: 'act', a: 'chain', yaw: me.yaw, pitch: me.pitch }); this.sendIn(); }
        } else if (me.char === 'chucky') {
          if (down && me.abCd <= 0 && !me.leap) { this.aimHeld = true; this.sendIn(); }
          else if (!down && this.aimHeld) { this.aimHeld = false; this.send({ t: 'act', a: 'pounce', yaw: me.yaw }); this.sendIn(); }
        } else if (me.char === 'bateman') {
          if (down && me.abCd <= 0 && me.ammo > 0) { this.aimHeld = true; this.sendIn(); }
          else if (!down && this.aimHeld) { this.aimHeld = false; this.send({ t: 'act', a: 'sawthrow', yaw: me.yaw, pitch: me.pitch }); this.sendIn(); }
        } else if (me.char === 'granny') {
          if (down && me.abCd <= 0 && !me.dash && !me.tele && me.carry == null) { this.aimHeld = true; this.sendIn(); }
          else if (!down && this.aimHeld) { this.aimHeld = false; this.send({ t: 'act', a: 'rush', yaw: me.yaw }); this.sendIn(); }
        } else if (me.char === 'harrower') {
          if (down && me.abCd <= 0 && me.ammo > 0) { this.aimHeld = true; this.sendIn(); }
          else if (!down && this.aimHeld) { this.aimHeld = false; this.send({ t: 'act', a: 'throw', yaw: me.yaw, pitch: me.pitch }); this.sendIn(); }
        } else if (down) {
          if (me.char === 'butcher' && !me.ab && me.abCd <= 0 && me.charges > 0 && !me.atk && me.carry == null) this.pred.ab = this.t + 0.4;
          this.send({ t: 'act', a: 'ability' });
        }
      }
    } else if (e.button === 2 && me.item === 'taser') {
      // survivor taser: click to fire where you're looking
      if (down && me.st === 'ok' && !me.act && me.tasers > 0) { me.yaw = this.camYaw; this.send({ t: 'act', a: 'taser', yaw: this.camYaw }); }
      else if (down && me.st === 'ok' && !(me.tasers > 0)) this.feed('Your Taser is out of shots.');
    } else if (e.button === 2) {
      // survivor flashlight: hold to shine
      const on = down && me.flash > 0 && me.st === 'ok';
      if (on !== !!this.flashHeld) { this.flashHeld = on; this.sendIn(); }
    } else if (e.button === 0 && down && (me.st === 'dead' || me.st === 'out')) this.cycleSpectate();
  }
  sendIn() { this.send({ t: 'in', e: this.eHeld, aim: this.aimHeld, flash: !!this.flashHeld }); }
  send(m) { this.session.send(m); }

  onSpace() {
    const S = this.S, me = this.mine();
    if (!me || !S) return;
    if (this.skill && this.skill.phase === 'active') { this.resolveSkill(); return; }
    if (me.st === 'caged') { if (me.stage === 1 && me.esc < 3) this.send({ t: 'act', a: 'esc' }); return; }
    const v = findSpace(this.M, S, me);
    // Chucky: Space is a jump. Over a window or pallet it is a quick hop across, anywhere else a leap
    if (!v && me.role === 'killer' && me.char === 'chucky' && !me.hop && !me.vault && !me.leap && me.stun <= 0 && !me.act && me.carry == null) {
      me.hop = { t: 0, d: 0.5 }; sound.play('vault', me.x, me.z, { fast: true }); return;
    }
    if (!v) return;
    if (v.k === 'drop') { this.send({ t: 'act', a: 'drop', id: v.id }); return; }
    const running = me.role === 'survivor' && this.keys.has('ShiftLeft') && this.moveInput().mag > 0.1;
    startVault(me, v, vaultDuration(me, v.kind, running));
    this.send({ t: 'act', a: 'vault', kind: v.kind, id: v.id, fast: running });
    sound.play('vault', me.x, me.z, { fast: running });
  }

  moveInput() {
    const f = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const r = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    return { f, r, mag: Math.hypot(f, r) };
  }

  mine() { return this.S ? playerById(this.S, this.myId) : null; }

  // ---------------- state sync ----------------
  syncState() {
    const S = this.session.state();
    if (!S) return null;
    if (!this.isHost && S !== this.lastSnap) {
      this.lastSnap = S;
      const p = playerById(S, this.myId);
      if (p) {
        const forced = (p.role === 'survivor' && p.st !== 'ok' && p.st !== 'down' && p.st !== 'ghost') || !!p.reel || !!p.pull || !!p.leap || !!p.dash;
        if (!this.me || p.tp !== this.myTp || forced) {
          this.myTp = p.tp;
          this.me = { x: p.x, z: p.z, yaw: this.me ? this.me.yaw : p.yaw, pitch: this.me ? this.me.pitch : 0, vault: null, mv: 0, cr: 0, fl: p.fl || 0, sp: p.sp };
          if (forced && !p.dash) this.me.yaw = p.yaw; // (during a Bat Rush she still steers with her own aim)
        }
        Object.assign(p, this.me);
        if (this.t < this.pred.atk && !p.atk) p.atk = 1;
        if (this.t < this.pred.ab && !p.ab && p.char === 'butcher') { p.ab = 1; }
      }
    }
    this.S = S;
    return S;
  }

  // ---------------- main frame ----------------
  frame(dt) {
    if (this.disposed) return;
    // brief hit-stop when your strike connects
    if (this.hitStop > 0) { this.hitStop -= dt; dt *= 0.15; }
    this.t += dt;
    const S = this.syncState();
    if (!S) return;
    const me = this.mine();
    if (me && me.role !== this.role) this.switchRole(me, S);
    this.handleLocal(dt, S, me);
    this.updateChars(dt, S, me);
    this.updateSidekicks(dt, S, me);
    this.updateTorchLight();
    this.updateTraps(S);
    this.updateBears(S);
    this.updateChests(S, dt);
    this.updateZaps(S, dt);
    if (this.execTrap && !S.players.some(o => o.st === 'exec')) { this.execTrapT = (this.execTrapT || 0) + dt; if (this.execTrapT > 6) { this.scene.remove(this.execTrap); this.execTrap = null; this.execTrapT = 0; } } else this.execTrapT = 0;
    this.updateSpiderMom(dt, S);
    this.updateCreep(S, me);
    this.updateSlime(S);
    this.updateSpears(dt, S);
    this.updateSaws(dt, S);
    this.updateDolls(S);
    this.updateChains(S);
    this.updateLanterns(dt, S, me);
    this.updateGore(dt, S, me);
    this.updateDark(dt, S, me);
    updateWorld(this.W, this.M, S, this.t, dt, this.camFocus || me);
    this.updateCamera(dt, S, me);
    this.updateAuras(S, me);
    this.updateAudio(dt, S, me);
    this.updateHUD(dt, S, me);
    this.sparks.update(dt); this.blood.update(dt); this.smoke.update(dt); this.decals.update(dt); this.updateBleeding(dt, S);
    { const m = this.mine(); this.scratches.update(dt, !!m && m.role === 'killer'); }
    if (this.composer) { this.post.uniforms.time.value = this.t; this.composer.render(dt); }
    else this.renderer.render(this.scene, this.camera);
    this.perf(dt);
    if (S.phase === 'end' && !this.ended) { this.ended = true; this.endAt = performance.now() + 2500; sound.play('end'); }
    if (this.ended && !this.endShown && performance.now() > this.endAt) this.showResults(S);
  }

  handleLocal(dt, S, me) {
    if (!me) return;
    // mouse look
    const sens = (this.settings.sens || 1) * 0.0022;
    const inv = this.settings.invert ? -1 : 1;
    if (me.role === 'killer') {
      let dyaw = Math.max(-0.6, Math.min(0.6, -this.mdx * sens));
      if (me.char === 'butcher' && me.ab === 1) dyaw = Math.max(-1.3 * dt, Math.min(1.3 * dt, dyaw));
      if (me.stun > 0) dyaw = 0;
      me.yaw += dyaw;
      me.pitch = Math.max(-1.2, Math.min(1.2, me.pitch - this.mdy * sens * inv));
    } else {
      this.camYaw -= this.mdx * sens;
      this.camPitch = Math.max(-0.7, Math.min(1.1, this.camPitch + this.mdy * sens * inv));
    }
    this.mdx = 0; this.mdy = 0;

    // hold E / aim
    const eHeld = this.keys.has('KeyE') && !this.paused;
    if (eHeld !== this.eHeld) { this.eHeld = eHeld; this.sendIn(); }

    // movement
    const free = me.role === 'killer' || me.st === 'ok' || me.st === 'down';
    if (free && !this.paused && S.phase === 'play') {
      const mi = this.moveInput();
      const yaw = me.role === 'killer' ? me.yaw : this.camYaw;
      const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
      let mx = fx * mi.f + rx * mi.r, mz = fz * mi.f + rz * mi.r;
      const m = Math.hypot(mx, mz); if (m > 1) { mx /= m; mz /= m; }
      const flashing = me.role === 'survivor' && this.flashHeld && me.flash > 0 && me.st === 'ok' && !me.act;
      if (this.flashHeld && !flashing && (me.flash <= 0 || me.st !== 'ok')) { this.flashHeld = false; this.sendIn(); }
      const sprint = !flashing && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
      const crouch = this.keys.has('ControlLeft') || this.keys.has('KeyC');
      const px = me.x, pz = me.z;
      stepMover(this.M, S, me, { mx, mz, sprint, crouch }, dt);
      if (flashing && !me.vault) me.yaw = this.camYaw;
      if (me.bump && me.char === 'butcher' && me.ab === 1 && !this.bumpSent) { this.bumpSent = true; this.send({ t: 'act', a: 'bump' }); }
      if (!(me.char === 'butcher' && me.ab === 1)) this.bumpSent = false;
      // footsteps for myself
      const moved = Math.hypot(me.x - px, me.z - pz);
      this.myStep = (this.myStep || 0) + moved;
      if (this.myStep > (sprint ? 1.6 : 1.2) && !(me.cr) && !has(me, 'hushed')) { this.myStep = 0; sound.play('step', me.x, me.z, { run: sprint, vol: me.role === 'killer' ? 0.35 : 0.18 }); }
    }
    if (!this.isHost) {
      this.me = { x: me.x, z: me.z, yaw: me.yaw, pitch: me.pitch, vault: me.vault, mv: me.mv, cr: me.cr, hop: me.hop, fl: me.fl || 0, sp: me.sp };
      // held keys (E, aim, flashlight) are only sent when they change: repeat them every half second
      // so one lost message can't leave a key stuck down or up on the host
      this.inTimer = (this.inTimer ?? 0.5) - dt;
      if (this.inTimer <= 0) { this.inTimer = 0.5; this.sendIn(); }
      this.posTimer -= dt;
      if (this.posTimer <= 0) {
        // 30/s on a steady cadence; ct (my clock) lets the host order and smooth the updates
        this.posTimer = Math.max(0, this.posTimer + 1 / 30);
        this.send({ t: 'pos', x: +me.x.toFixed(3), z: +me.z.toFixed(3), yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), mv: me.mv, cr: me.cr, v: me.vault ? 1 : 0, h: me.hop ? +(me.hop.t / me.hop.d).toFixed(2) : 0, fl: me.fl || 0, sp: me.sp != null ? +me.sp.toFixed(1) : undefined, tp: this.myTp, ct: +(performance.now() / 1000).toFixed(3) });
      }
    }
    // skill checks
    this.updateSkill(dt, me);
  }

  // ---------------- skill checks ----------------
  updateSkill(dt, me) {
    const struggling = me.role === 'survivor' && me.st === 'caged' && me.stage >= 2; // fighting the Entity on the hook
    const working = struggling || (me.act && (me.act.k === 'repair' || me.act.k === 'heal' || me.act.k === 'self') && me.role === 'survivor');
    if (!working) { if (this.skill) { this.skill = null; this.skillCanvas.classList.add('hidden'); } this.skillCooldown = Math.max(this.skillCooldown, 1.2); return; }
    if (!this.skill) {
      this.skillCooldown -= dt;
      if (this.skillCooldown <= 0 && Math.random() < dt * (struggling ? 0.7 : 0.22)) {
        const steady = has(me, 'steady');
        const start = 0.4 + Math.random() * 0.45;
        const w = 0.12 * (steady ? 1.4 : 1);
        this.skill = { phase: 'warn', t: 0, start, end: start + w, great: start + 0.035 };
        sound.play('sc-warn');
      }
      return;
    }
    const s = this.skill;
    s.t += dt;
    if (s.phase === 'warn' && s.t > 0.55) { s.phase = 'active'; s.t = 0; this.skillCanvas.classList.remove('hidden'); }
    if (s.phase === 'active') {
      s.needle = s.t / 1.15;
      if (s.needle > s.end + 0.03) this.resolveSkill();
      this.drawSkill();
    }
    if (s.phase === 'done') { s.t2 = (s.t2 || 0) + dt; this.drawSkill(); if (s.t2 > 0.45) { this.skill = null; this.skillCanvas.classList.add('hidden'); this.skillCooldown = struggling ? 1.2 : 2.5; } }
  }
  resolveSkill() {
    const s = this.skill;
    if (!s || s.phase !== 'active') return;
    const n = s.needle;
    s.res = n >= s.start && n <= s.great ? 'great' : n >= s.start && n <= s.end ? 'good' : 'miss';
    s.phase = 'done';
    this.send({ t: 'act', a: 'sc', r: s.res });
    sound.play(s.res === 'great' ? 'sc-great' : s.res === 'good' ? 'sc-good' : 'genfail');
    if (s.res === 'miss') this.shake = 0.4;
  }
  drawSkill() {
    const c = this.skillCtx, s = this.skill, W = 180, R = 70;
    c.clearRect(0, 0, W, W);
    const a = f => -Math.PI / 2 + f * Math.PI * 2;
    c.lineWidth = 6; c.strokeStyle = 'rgba(255,255,255,0.25)'; c.beginPath(); c.arc(W / 2, W / 2, R, 0, 7); c.stroke();
    c.lineWidth = 9; c.strokeStyle = 'rgba(240,240,240,0.9)'; c.beginPath(); c.arc(W / 2, W / 2, R, a(s.great), a(s.end)); c.stroke();
    c.strokeStyle = '#ffffff'; c.lineWidth = 12; c.beginPath(); c.arc(W / 2, W / 2, R, a(s.start), a(s.great)); c.stroke();
    const n = Math.min(s.needle || 0, 1.2);
    c.strokeStyle = s.res === 'miss' ? '#ff3030' : s.res ? '#ffd23a' : '#ff4040'; c.lineWidth = 4;
    c.beginPath(); c.moveTo(W / 2 + Math.cos(a(n)) * (R - 18), W / 2 + Math.sin(a(n)) * (R - 18)); c.lineTo(W / 2 + Math.cos(a(n)) * (R + 12), W / 2 + Math.sin(a(n)) * (R + 12)); c.stroke();
    c.fillStyle = '#fff'; c.font = 'bold 20px Oswald, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(s.res ? (s.res === 'great' ? 'GREAT' : s.res === 'good' ? 'GOOD' : 'FAILED') : 'SPACE', W / 2, W / 2);
  }

  // ---------------- characters ----------------
  updateChars(dt, S, me) {
    const viewerKiller = me && me.role === 'killer';
    if (this.chars.size > S.players.length) for (const [id, c] of this.chars) if (!S.players.some(p => p.id === id)) { this.scene.remove(c.rig.root); this.chars.delete(id); }
    const K = killerOf(S);
    for (const p of S.players) {
      let c = this.chars.get(p.id);
      // rebuild when the role changes (Infection) or Chucky's real model finishes loading mid-match
      if (c && (c.role !== lookRole(p) || c.char !== p.char || (p.char === 'chucky' && !c.rig.chucky && chuckyReady()) || (p.char === 'granny' && lookRole(p) === 'killer' && !c.rig.granny && (p.skin === 'grandpa' ? grandpaReady() : grannyReady())) || (p.char === 'slimer' && lookRole(p) === 'killer' && !c.rig.staticGlb && staticReady('slimer')))) { this.scene.remove(c.rig.root); this.chars.delete(p.id); c = null; }
      if (!c) {
        const rig = lookRole(p) === 'killer' ? makeKiller(p.char, skinOf(p.char, p.skin)) : makeSurvivor(SURVIVORS[p.char] || SURVIVORS.mara, skinOf(p.char, p.skin));
        this.scene.add(rig.root);
        c = { rig, x: p.x, z: p.z, yaw: p.yaw, spd: 0, step: 0, vaultT: 0, wasV: false, role: lookRole(p), char: p.char };
        this.chars.set(p.id, c);
      }
      const R = c.rig, local = p.id === this.myId;
      const execing = p.role === 'killer' && p.act && p.act.k === 'execute';
      const hidden = p.st === 'dead' || p.st === 'out' || (p.st === 'ghost' && !local) || (local && p.role === 'killer' && !execing && !isTpv(p));
      R.root.visible = !hidden;
      // smoothing. Other players are already interpolated between network updates (clients:
      // snapshots; host: the remote player's own position stream), so only a light filter is
      // added there; heavy smoothing would draw them behind where hits are actually checked.
      const view = !local && this.isHost && this.session.viewPos ? this.session.viewPos(p) : null;
      const tx = view ? view.x : p.x, tz = view ? view.z : p.z, tyaw = view ? view.yaw : p.yaw;
      const interp = !local && (this.isHost ? !!view : true);
      const jump = Math.hypot(tx - c.x, tz - c.z), ox = c.x, oz = c.z;
      if (local || jump > 4) { c.x = tx; c.z = tz; }
      else { const k = 1 - Math.exp(-dt * (interp ? 40 : 16)); c.x += (tx - c.x) * k; c.z += (tz - c.z) * k; }
      // speed of the smoothed motion (not of raw network updates, which arrive in steps)
      const spd = jump > 4 ? c.spd : Math.min(9, Math.hypot(c.x - ox, c.z - oz) / Math.max(dt, 1e-3));
      c.spd += (spd - c.spd) * Math.min(1, dt * 8);
      c.yaw += angDiff(c.yaw, tyaw) * (local ? 1 : 1 - Math.exp(-dt * (interp ? 30 : 12)));
      // scratch marks: a running survivor leaves a trail every half metre or so, scattered either side
      if (p.role === 'survivor' && p.st === 'ok' && !p.disguise && !p.vault && !p.fl && (p.mv === 2 || c.spd > 3.2) && jump <= 4) {
        c.scratchD = (c.scratchD || 0) + Math.hypot(c.x - ox, c.z - oz);
        if (c.scratchD > 0.55) {
          c.scratchD = 0;
          const side = (Math.random() - 0.5) * 1.3, back = 0.3 + Math.random() * 0.4, mv = Math.atan2(c.x - ox, c.z - oz);
          this.scratches.add(c.x - Math.sin(mv) * back + Math.cos(mv) * side, c.z - Math.cos(mv) * back - Math.sin(mv) * side, mv + (Math.random() - 0.5) * 1.2);
        }
      } else c.scratchD = 0;
      // the Foreman flung up to a high hook point, then dropping back down
      c.lift = (c.lift || 0) + (pullLift(p) + leapLift(p) - (c.lift || 0)) * Math.min(1, dt * 20);
      // floors (Granny's House): how high they stand, eased so a level change never pops
      const hTo = this.M.stairs ? heightAt(this.M, { x: c.x, z: c.z, fl: p.fl, sp: p.sp }) : 0;
      c.h = c.h == null || jump > 4 ? hTo : c.h + (hTo - c.h) * Math.min(1, dt * 14);
      if (hidden) continue;
      // footsteps of others
      if (!local && p.mv && !p.cr && !(p.role === 'killer' && (p.char === 'wisp' || p.char === 'slimer' || p.char === 'chucky'))) {
        c.step += c.spd * dt;
        if (c.step > (p.role === 'killer' ? 1.5 : 1.3)) { c.step = 0; if (!has(p, 'hushed')) sound.play('step', c.x, c.z, { run: p.mv === 2, vol: p.role === 'killer' ? 0.5 : 0.25 }); }
      }
      // animation state
      let anim = 'idle', y = 0;
      const vaulting = !!p.vault;
      if (vaulting && !c.wasV) c.vaultT = 0;
      c.wasV = vaulting;
      if (vaulting) c.vaultT += dt;
      const st = { speed: c.spd, injured: p.role === 'survivor' && p.hp === 1, t: this.t };
      if (p.st === 'down' && c.prevSt !== 'down') c.downAt = this.t;
      c.prevSt = p.st;
      if (c.downAt != null) st.fallF = (this.t - c.downAt) / 0.8;
      if (c.hitAt != null) st.hitF = (this.t - c.hitAt) / 0.5;
      if (lookRole(p) === 'survivor') {
        if (p.st === 'exec') { anim = 'exec'; const EK = playerById(S, p.execBy) || K; const kk = EK && EK.act && EK.act.k === 'execute' ? EK : null; st.exec = { f: kk ? kk.act.t / RULES.execTime : 1, char: EK ? EK.char : 'butcher', role: 'victim' }; }
        else if (p.st === 'down') anim = 'down';
        else if (p.st === 'carried') anim = 'carried';
        else if (p.st === 'caged') anim = 'caged';
        else if (vaulting) { anim = 'vault'; const d = p.vault.d || 0.7; y = Math.sin(Math.min(1, c.vaultT / d) * Math.PI) * 0.55; }
        else if (p.act) anim = p.act.k === 'repair' ? 'repair' : (p.act.k === 'heal' || p.act.k === 'self') ? 'heal' : 'work';
        else if (p.cr) anim = c.spd > 0.3 ? 'crouchwalk' : 'crouch';
        else if (!local && (p.mv === 1 || p.mv === 2)) anim = p.mv === 2 ? 'run' : 'walk'; // what the player is doing, not network jitter
        else anim = c.spd > 3.0 ? 'run' : c.spd > (local ? 0.3 : 0.8) ? 'walk' : 'idle';
        st.struggle = p.st === 'carried';
        st.hookPhase = p.st === 'caged' ? p.stage : 0;
        if (p.emote !== c.emotePrev) { c.emoteAt = this.t; c.emotePrev = p.emote; }
        if (p.emote && p.st === 'ok') { st.emote = p.emote; st.emoteT = this.t - c.emoteAt; }
      } else {
        anim = vaulting ? 'vault' : (c.spd > 0.3 || (!local && p.mv >= 1 && p.mv <= 2)) ? 'walk' : 'idle';
        if (vaulting) { const d = p.vault.d || 1.7; y = Math.sin(Math.min(1, c.vaultT / d) * Math.PI) * 0.5; }
        if (execing) st.exec = { f: p.act.t / RULES.execTime, char: p.char, role: 'killer' };
        st.carry = p.carry != null; st.atk = p.atk; st.stun = p.stun > 0; st.act = p.act && p.act.k; st.aim = p.aim; st.rampage = p.char === 'butcher' && p.ab === 1;
        if (p.char === 'granny') { st.listen = p.ab === 1 || !!p.tele; st.blind = p.blind > 0; st.aim = !!p.aim; st.dash = !!p.dash; }
        if (p.atk === 1) { c.atkT = (c.atkPrev === 1 ? c.atkT + dt : 0); st.atkF = c.atkT / (RULES.lungeTime * (p.atkAmbush ? 1.4 : 1)); }
        c.atkPrev = p.atk;
        st.atkHit = p.atkHit; st.tele = !!p.tele; st.dark = p.char === 'foreman' && p.ab === 1;
        st.leap = p.leap ? Math.min(1, p.leap.t / p.leap.d) : null; st.laughF = c.laughAt != null ? (this.t - c.laughAt) / 3 : null;
        if (p.atk === 2) { const tot = p.atkHit ? (p.char === 'butcher' && !p.atkT ? 2.2 : RULES.hitCooldown * (has(p, 'relentless') ? 0.65 : 1)) : RULES.missCooldown; st.recF = Math.max(0, Math.min(1, 1 - p.atkT / tot)); }
        c.st = st;
      }
      st.anim = anim;
      const flashOn = p.role === 'survivor' && p.st === 'ok' && !p.act && p.flash > 0 && (local ? !!this.flashHeld : p.flashOn);
      st.flash = flashOn;
      animate(R, st, dt);
      // placement
      R.root.position.set(c.x, y + c.lift + c.h, c.z);
      R.root.rotation.set(0, c.yaw, 0);
      if (anim === 'carried') {
        const CK = playerById(S, p.carriedBy) || K;
        const kc = CK && this.chars.get(CK.id);
        if (kc) {
          const f = fwd(kc.yaw), rgt = { x: -Math.cos(kc.yaw), z: Math.sin(kc.yaw) };
          // lying poses pivot at the feet: offset the root so the hips rest on the killer's shoulder
          const sh = CK.char === 'butcher' ? 1.78 : CK.char === 'chucky' ? 1.12 : 1.62;
          R.root.position.set(kc.x + f.x * 0.12 + rgt.x * 0.7, sh + (kc.h || 0), kc.z + f.z * 0.12 + rgt.z * 0.7);
          R.root.rotation.set(0, kc.yaw + Math.PI / 2, 0);
          if (local) R.root.visible = true;
        }
      } else if (anim === 'exec') {
        const EK = playerById(S, p.execBy) || K;
        const kc = EK && this.chars.get(EK.id);
        if (kc) {
          const f = st.exec.f, ch = st.exec.char, F = fwd(kc.yaw);
          const sm = (a0, a1) => { const x = Math.max(0, Math.min(1, (f - a0) / (a1 - a0))); return x * x * (3 - 2 * x); };
          let d = 1.05, yy = 0, side = 0;
          if (ch === 'butcher' || ch === 'bateman') { d = 1.05 - sm(0.15, 0.25) * 0.35 + sm(0.86, 0.95) * 0.3; yy = (sm(0.18, 0.3) - sm(0.86, 0.93)) * 0.62; }
          else if (ch === 'wisp') { d = 0.72; yy = sm(0.08, 0.4) * 0.95; }
          else if (ch === 'chucky') { d = 0.8; yy = 0; }
          else if (ch === 'granny') { d = 0.95; yy = 0; }
          else if (ch === 'foreman') { const drag = sm(0.55, 0.92); d = 1.1 - sm(0.25, 0.35) * 0.25 - drag * 2.6; yy = sm(0.28, 0.4) * 1.05 - drag * 0.7; side = Math.sin(drag * Math.PI) * 0.9; }
          else { const up = sm(0.42, 0.62) - sm(0.86, 0.95); d = 1.25 - up * 0.3; yy = up * 1.75; side = sm(0.86, 1) * 1.2 + up * 0.95; }
          const rgt = { x: -Math.cos(kc.yaw), z: Math.sin(kc.yaw) };
          // glide from where they were into the execution spot instead of snapping there
          const ex = kc.x + F.x * d + rgt.x * side, ez = kc.z + F.z * d + rgt.z * side;
          if (!c.execFrom) { c.execFrom = R.root.position.clone(); c.execBlend = 0; }
          c.execBlend = Math.min(1, c.execBlend + dt * 3.5);
          const eb = c.execBlend * c.execBlend * (3 - 2 * c.execBlend);
          yy += kc.h || 0;
          R.root.position.set(c.execFrom.x + (ex - c.execFrom.x) * eb, c.execFrom.y + (yy - c.execFrom.y) * eb, c.execFrom.z + (ez - c.execFrom.z) * eb);
          R.root.rotation.set(0, ch === 'harrower' && f > 0.42 && f < 0.86 ? kc.yaw + Math.PI / 2 : ch === 'granny' ? kc.yaw : kc.yaw + Math.PI, 0);
          if (ch === 'wisp') R.setOpacity(f > 0.78 ? Math.max(0.02, 1 - (f - 0.78) / 0.2) : 1);
          if (ch === 'foreman') R.setOpacity(f > 0.72 ? Math.max(0.0, 1 - (f - 0.72) / 0.2) : 1);
          this.execFx(p, EK, f, ch, R.root.position);
        }
      }
      if (anim !== 'exec') c.execFrom = null;
      if (anim === 'caged') {
        // hanging from the hook: shoulder on the point, feet off the ground, swaying a little
        const cg = this.M.cages[p.cage];
        // (the hook's point goes through the left shoulder, so the body hangs a little to the right of it)
        if (cg) { const yw = R.root.rotation.y; R.root.position.set(cg.x - Math.cos(yw) * 0.17, HOOK_Y - 1.62 + Math.sin(this.t * 1.1) * 0.015, cg.z + Math.sin(yw) * 0.17); }
      }
      if (p.role === 'survivor') this.placeTorch(c, R, p, flashOn && R.root.visible);
      if (p.role === 'survivor' && local && (p.st === 'ghost') !== !!c.ghostFx) { c.ghostFx = p.st === 'ghost'; R.setOpacity(c.ghostFx ? 0.35 : 1); } // you, as a ghost
      if (p.role === 'killer' && p.char === 'slimer') R.setOpacity(p.phase > 0 ? (viewerKiller ? 0.4 : 0.25 + Math.sin(this.t * 12) * 0.08) : 1);
      // Granny fading out on a Creep
      if (p.role === 'killer' && p.char === 'granny' && (p.tele || c.creepFade)) { c.creepFade = !!p.tele; R.setOpacity(p.tele ? Math.max(0.04, 1 - p.tele.t / KILLERS.granny.teleport.time) : 1); }
      // wisp fade
      if (p.role === 'killer' && p.char === 'wisp') {
        const o = p.ab === 1 ? (viewerKiller ? 0.35 : 0.04 + Math.max(0, Math.sin(this.t * 3)) * 0.04) : p.ab ? 0.4 : 1;
        R.setOpacity(o);
      }
    }
    // viewmodel
    if (this.view && me && this.viewPending && (this.viewRetry = (this.viewRetry || 0) + dt) > 1) {
      this.viewRetry = 0;
      if (me.role !== 'killer' || isTpv(me)) this.viewPending = null;
      else if (fpModelReady(me.char, skinOf(me.char, me.skin)) && !this.viewReady) this.buildView(me);
    }
    if (this.view && me) {
      const c = this.chars.get(me.id), cs = (c && c.st) || {};
      animateView(this.view, { atk: me.dash ? 1 : me.atk, atkF: me.dash ? Math.min(1, me.dash.t / me.dash.d) : cs.atkF, atkHit: me.atkHit, recF: cs.recF, aim: me.aim, stun: me.stun > 0, rampage: me.char === 'butcher' && me.ab === 1, carry: me.carry != null, act: me.act && me.act.k !== 'execute', speed: c ? c.spd : 0, t: this.t, tele: !!me.tele, saw: me.char === 'bateman' && me.ammo > 0 }, dt);
      this.view.visible = !(me.act && me.act.k === 'execute') && !(this.swapHeld && this.t - this.swapT > 0.18); // (hidden while looking through Spider Mom's eyes)
      const faded = me.char === 'wisp' && me.ab !== 0;
      if (faded !== this.viewFaded) { this.viewFaded = faded; this.view.traverse(o => { if (o.isMesh) { o.material.transparent = faded || o.userData.op < 1; o.material.opacity = faded ? 0.35 : o.userData.op; } }); }
      // swing trail
      const u = this.view.userData;
      const pts = this.trailPts;
      if (me.atk === 1 && (cs.atkF || 0) > 0.18) {
        const tp = u.tip.getWorldPosition(new THREE.Vector3()), bp = u.base.getWorldPosition(new THREE.Vector3());
        this.camera.worldToLocal(tp); this.camera.worldToLocal(bp);
        pts.unshift([tp, bp]); if (pts.length > 14) pts.pop();
      } else if (pts.length) pts.pop();
      const pos = this.trail.geometry.attributes.position, col = this.trail.geometry.attributes.color;
      const tc = me.char === 'wisp' ? [0.4, 0.9, 1] : me.char === 'lamplighter' ? [0.3, 1, 0.5] : [1, 0.85, 0.75];
      for (let i = 0; i < 14; i++) {
        const q = pts[Math.min(i, pts.length - 1)];
        const fade = pts.length ? Math.max(0, 1 - i / Math.max(1, pts.length)) : 0;
        if (q) { pos.setXYZ(i * 2, q[0].x, q[0].y, q[0].z); pos.setXYZ(i * 2 + 1, q[1].x, q[1].y, q[1].z); }
        col.setXYZ(i * 2, tc[0] * fade, tc[1] * fade, tc[2] * fade); col.setXYZ(i * 2 + 1, 0, 0, 0);
      }
      pos.needsUpdate = true; col.needsUpdate = true;
      this.trail.visible = pts.length > 1;
    }
  }

  // The Foreman's Lights Out: the map goes dark and the fog closes in
  updateDark(dt, S, me) {
    const W = this.W;
    if (W.base == null) W.base = { fog: this.scene.fog.density, hemi: W.hemi.intensity, amb: W.amb.intensity, moon: W.moon.intensity, fill: W.fill.intensity, exp: this.renderer.toneMappingExposure };
    // Lights Out mode keeps the map dark all match; the Foreman's power goes darker still
    const modeDark = S.mode === 'dark' ? (me && me.role === 'killer' ? 0.4 : 0.72) : 0;
    const target = Math.max(modeDark, S.dark > 0 ? (me && me.role === 'killer' ? 0.55 : 1) : 0);
    this.darkK = (this.darkK || 0) + (target - (this.darkK || 0)) * Math.min(1, dt * (target > (this.darkK || 0) ? 5 : 1.5));
    const k = this.darkK, B = W.base;
    this.scene.fog.density = B.fog * (1 + k * 1.6);
    W.hemi.intensity = B.hemi * (1 - k * 0.72); W.amb.intensity = B.amb * (1 - k * 0.8);
    W.moon.intensity = B.moon * (1 - k * 0.85); W.fill.intensity = B.fill * (1 - k * 0.6);
    W.darkK = k;
  }

  updateLanterns(dt, S, me) {
    this.lanterns ||= new Map();
    const seen = new Set();
    for (const L of S.lanterns || []) {
      seen.add(L.id);
      let o = this.lanterns.get(L.id);
      if (!o) { o = makeLantern(); o.position.set(L.x, 0, L.z); o.rotation.y = L.id * 1.7; this.scene.add(o); this.lanterns.set(L.id, o); }
      const u = o.userData;
      u.core.material.emissiveIntensity = 5 + Math.sin(this.t * 9 + L.id) * 1.5 + Math.random() * 0.8;
      u.ring.scale.setScalar(1 + ((this.t * 0.6 + L.id * 0.3) % 1) * 16);
      u.ring.material.opacity = 0.35 * (1 - ((this.t * 0.6 + L.id * 0.3) % 1));
    }
    for (const [id, o] of this.lanterns) if (!seen.has(id)) { this.scene.remove(o); this.lanterns.delete(id); }
  }

  // Butcher only: injured survivors leave fresh blood
  updateGore(dt, S, me) {
    if (!me || me.role !== 'killer' || me.char !== 'butcher') return;
    if (!this.gore) {
      this.gore = []; this.goreI = 0;
      const geo = new THREE.CircleGeometry(0.16, 7); geo.rotateX(-Math.PI / 2);
      for (let i = 0; i < 160; i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x8a0a06, transparent: true, opacity: 0, depthWrite: false }));
        m.visible = false; m.renderOrder = 1; this.scene.add(m); this.gore.push(m);
      }
      this.goreLast = new Map();
    }
    for (const p of S.players) {
      if (p.role !== 'survivor' || !((p.st === 'ok' && p.hp === 1) || p.st === 'down')) continue;
      const last = this.goreLast.get(p.id);
      if (last && Math.hypot(p.x - last.x, p.z - last.z) < 1.0) continue;
      this.goreLast.set(p.id, { x: p.x, z: p.z });
      const m = this.gore[this.goreI++ % this.gore.length];
      m.position.set(p.x + (Math.random() - 0.5) * 0.4, 0.03 + Math.random() * 0.01, p.z + (Math.random() - 0.5) * 0.4);
      m.scale.setScalar(0.6 + Math.random() * 0.9); m.rotation.y = Math.random() * 6;
      m.userData.t = 0; m.visible = true;
    }
    for (const m of this.gore) if (m.visible) { m.userData.t += dt; m.material.opacity = Math.max(0, 0.85 - m.userData.t / 12); if (m.userData.t > 12) m.visible = false; }
  }

  updateChains(S) {
    this.chainMeshes ||= [];
    const list = S.chains || [];
    while (this.chainMeshes.length < list.length) {
      const g = new THREE.Group();
      const link = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 6), new THREE.MeshStandardMaterial({ color: 0x5a5a58, metalness: 0.8, roughness: 0.45 }));
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 6, 14, Math.PI * 1.35), new THREE.MeshStandardMaterial({ color: 0x8a8a88, metalness: 0.85, roughness: 0.3 }));
      g.add(link); g.add(hook); g.userData = { link, hook };
      this.scene.add(g); this.chainMeshes.push(g);
    }
    while (this.chainMeshes.length > list.length) this.scene.remove(this.chainMeshes.pop());
    list.forEach((c, i) => {
      const g = this.chainMeshes[i], K = playerById(S, c.by), kc = K && this.chars.get(K.id);
      if (!kc) return;
      const rx = -Math.cos(kc.yaw), rz = Math.sin(kc.yaw);
      const a = new THREE.Vector3(kc.x + rx * 0.35, 1.55 + (kc.lift || 0), kc.z + rz * 0.35), b = new THREE.Vector3(c.x, c.y != null ? c.y : 1.25, c.z);
      const mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b);
      const u = g.userData;
      // Batman's grappling line: thin and black instead of a steel chain
      const bat = K.skin === 'batman';
      if (u.bat !== bat) { u.bat = bat; u.link.material.color.setHex(bat ? 0x0c0c0e : 0x5a5a58); u.link.material.metalness = bat ? 0.2 : 0.8; u.link.scale.x = u.link.scale.z = bat ? 0.45 : 1; if (u.hook) u.hook.material.color.setHex(bat ? 0x1a1c20 : 0x8a8a88); }
      u.link.position.copy(mid); u.link.scale.y = Math.max(0.01, len);
      u.link.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      u.hook.position.copy(b); u.hook.lookAt(a); u.hook.rotateX(Math.PI / 2);
    });
  }

  // ongoing bleeding: drag smears from the dying, drips from the injured and the carried
  updateBleeding(dt, S) {
    this.bleedPrev ||= new Map();
    for (const p of S.players) {
      if (p.role !== 'survivor') continue;
      const bleeding = (p.st === 'ok' && p.hp === 1) || p.st === 'down' || p.st === 'carried';
      const c = this.chars.get(p.id);
      if (c && c.rig.wounds) { c.rig.wounds.light.visible = bleeding || p.st === 'caged' || p.st === 'exec'; c.rig.wounds.heavy.visible = p.st === 'down' || p.st === 'carried' || p.st === 'caged' || p.st === 'exec'; }
      if (!bleeding) { this.bleedPrev.delete(p.id); continue; }
      const prev = this.bleedPrev.get(p.id);
      if (!prev) { this.bleedPrev.set(p.id, { x: p.x, z: p.z }); continue; }
      const d = Math.hypot(p.x - prev.x, p.z - prev.z);
      const every = p.st === 'down' ? 0.7 : p.st === 'carried' ? 1.4 : 2.4;
      if (d >= every) {
        if (p.st === 'down') this.decals.add(p.x, p.z, 0.7 + Math.random() * 0.3, 3, Math.atan2(p.x - prev.x, p.z - prev.z) + Math.PI / 2);
        else { this.decals.add(p.x + (Math.random() - 0.5) * 0.3, p.z + (Math.random() - 0.5) * 0.3, 0.18 + Math.random() * 0.22, 0); this.blood.spawn(p.x, p.st === 'carried' ? 1.3 : 0.9, p.z, 3, 0x5a0303, 0.3, 0.6, -9.8, 0.2); }
        this.bleedPrev.set(p.id, { x: p.x, z: p.z });
      }
    }
    // the killer's first-person weapon stays bloody for a while after a hit
    if (this.view) {
      const u = this.view.userData;
      u.bloody = Math.max(0, (u.bloody || 0) - dt * 0.01);
      if (u.bloodMesh) { u.bloodMesh.visible = u.bloody > 0.05; u.bloodMesh.material.opacity = Math.min(0.95, u.bloody * 1.4); }
    }
  }

  updateSpears(dt, S) {
    while (this.spears.length < S.spears.length) { const m = makeSpear(); this.scene.add(m); this.spears.push(m); }
    while (this.spears.length > S.spears.length) this.scene.remove(this.spears.pop());
    S.spears.forEach((s, i) => {
      const m = this.spears[i];
      m.position.set(s.x, s.y, s.z);
      m.lookAt(s.x + s.vx, s.y + s.vy, s.z + s.vz);
    });
  }

  // sidekicks: one per owner, run locally on every client
  updateSidekicks(dt, S, me) {
    this.pets ||= new Map();
    for (const p of S.players) {
      let k = this.pets.get(p.id);
      if (p.pet && (!k || k.kind !== p.pet)) { if (k) k.dispose(); k = new Sidekick(this.scene, this.M, p.pet, p.id); this.pets.set(p.id, k); }
      else if (!p.pet && k) { k.dispose(); this.pets.delete(p.id); k = null; }
      if (!k) continue;
      // a disguised body's sidekick would give Chucky away: it stays with the doll; ghosts' pets wait
      const c = this.chars.get(p.id);
      const owner = c ? { ...p, x: c.x, z: c.z, yaw: c.yaw } : p;
      let killerD = null, survD = null;
      if (p.role === 'survivor') for (const q of S.players) if (q.role === 'killer' && !q.disguise) { const d = Math.hypot(q.x - owner.x, q.z - owner.z); if (killerD == null || d < killerD) killerD = d; }
      if (p.role === 'killer') for (const q of S.players) if (q.role === 'survivor' && q.st === 'ok') { const d = Math.hypot(q.x - owner.x, q.z - owner.z); if (survD == null || d < survD) survD = d; }
      k.update(dt, owner, { visible: !(p.st === 'ghost' && p.id !== this.myId), killerD, survD, say: (line, x, z) => this.petVoice(line, x, z) });
    }
    for (const [id, k] of this.pets) if (!S.players.some(p => p.id === id)) { k.dispose(); this.pets.delete(id); }
  }
  petReact(id, mood, time) { const k = this.pets && this.pets.get(id); if (k) k.react(mood, time); }
  petSay(id, line, gap) { const k = this.pets && this.pets.get(id); if (k) k.say(line, gap); }
  // a sidekick's voice line: played from where they stand, with a subtitle if you can hear it
  // returns the line's length in seconds, or -1 if it's out of earshot
  petVoice(line, x, z) {
    const heard = Math.hypot(x - sound.lx, z - sound.lz) < 40;
    if (!heard) return -1;
    const len = sound.clip('ted/' + line, x, z) || 2.5; // (2.5s of subtitle if audio is unavailable)
    if (this.settings.subs === false) return len;
    let el = document.getElementById('subs');
    if (!el) { el = document.createElement('div'); el.id = 'subs'; this.hud.appendChild(el); }
    const show = txt => { el.innerHTML = `<b>Ted:</b> ${String(txt).replace(/[<>&]/g, '')}`; el.classList.add('show'); };
    for (const h of this.capT || []) clearTimeout(h);
    this.capT = [];
    const caps = TED_CAPTIONS[line];
    if (caps && caps.length) for (const [at, txt] of caps) this.capT.push(setTimeout(() => show(txt), at * 1000));
    else show(TED_LINES[line]);
    clearTimeout(this.subsT); this.subsT = setTimeout(() => el.classList.remove('show'), (len + 0.8) * 1000);
    return len;
  }

  // Chucky's spare dolls (Soul Split), lying where they were dropped
  updateDolls(S) {
    this.dolls ||= new Map();
    const seen = new Set();
    for (const d of S.dolls || []) {
      seen.add(d.id);
      let o = this.dolls.get(d.id);
      // swap the stand-in for the real model once it has loaded
      if (o && !o.userData.real && chuckyReady()) { this.scene.remove(o); o = null; }
      if (!o) {
        const R = makeKiller('chucky', {});
        o = R.root; o.userData.real = !!R.chucky;
        o.rotation.set(-Math.PI / 2, 0, d.yaw, 'YXZ'); o.rotation.order = 'YXZ'; o.rotation.set(-Math.PI / 2 + 0.05, d.yaw, 0);
        o.position.set(d.x, 0.14, d.z);
        if (R.mixer) R.mixer.update(0);
        this.scene.add(o); this.dolls.set(d.id, o);
      }
    }
    for (const [id, o] of this.dolls) if (!seen.has(id)) { this.scene.remove(o); this.dolls.delete(id); }
  }

  // Patrick Bateman's thrown chainsaw: spinning in flight, idling on the ground until he fetches it
  updateSaws(dt, S) {
    this.saws ||= new Map();
    const seen = new Set();
    for (const sw of S.saws || []) {
      seen.add(sw.id);
      let m = this.saws.get(sw.id);
      if (!m) { m = makeChainsaw(); this.scene.add(m); this.saws.set(sw.id, m); m.userData.spin = 0; }
      const k = 1 - Math.exp(-dt * 25);
      m.position.x += (sw.x - m.position.x) * (m.userData.placed ? k : 1); m.position.z += (sw.z - m.position.z) * (m.userData.placed ? k : 1);
      m.position.y = sw.st === 'fly' ? sw.y : 0.1 + Math.abs(Math.sin(this.t * 40)) * 0.01;
      m.userData.placed = true;
      if (sw.st === 'fly') { m.userData.spin += dt * 22; m.rotation.set(0, Math.atan2(sw.vx, sw.vz), 0); m.userData.inner.rotation.set(m.userData.spin, 0, 0); }
      else { m.userData.inner.rotation.set(0, 0, Math.PI / 2 - 0.15); }
    }
    for (const [id, m] of this.saws) if (!seen.has(id)) { this.scene.remove(m); this.saws.delete(id); }
  }

  // ---------------- camera ----------------
  updateCamera(dt, S, me) {
    const cam = this.camera;
    if (!me) return;
    let target = me;
    if (me.role === 'survivor' && (me.st === 'dead' || me.st === 'out')) {
      if (!this.spectate || !['ok', 'down', 'carried', 'caged'].includes(this.spectate.st)) this.cycleSpectate(true);
      this.spectate = this.spectate ? playerById(S, this.spectate.id) : null;
      target = this.spectate || nearestKiller(S, me) || me;
    }
    this.camFocus = target;
    // cinematic camera for executions (killer and victim)
    const K0 = killersOf(S).find(k => k.act && k.act.k === 'execute' && (k.id === me.id || k.act.id === me.id || k.act.id === target.id));
    const execVictim = K0 ? playerById(S, K0.act.id) : null;
    if (execVictim && (me.id === K0.id || me.id === execVictim.id || target.id === execVictim.id)) {
      const kc = this.chars.get(K0.id), f = K0.act.t / RULES.execTime;
      const mx = kc.x + Math.sin(kc.yaw) * 0.55, mz = kc.z + Math.cos(kc.yaw) * 0.55;
      if (this.execCamBase === undefined || this.execCamFor !== execVictim.id) { this.execCamBase = kc.yaw + Math.PI / 2 + (Math.random() < 0.5 ? 0.5 : -0.5); this.execCamFor = execVictim.id; }
      const a = this.execCamBase + f * 0.9, d = 4.6 - f * 1.2;
      let cx = mx + Math.sin(a) * d, cz = mz + Math.cos(a) * d, cy = 1.7 + Math.sin(f * Math.PI) * 0.5;
      for (let k = 0; k < 12 && pointBlocked(this.M, cx, cy, cz); k++) { cx = mx + (cx - mx) * 0.8; cz = mz + (cz - mz) * 0.8; }
      cam.position.set(cx + (Math.random() - 0.5) * this.shake * 0.1, cy, cz);
      cam.lookAt(mx, 1.25, mz);
      cam.fov = 55; cam.updateProjectionMatrix();
      this.shake = Math.max(0, this.shake - dt * 1.5);
      sound.listener(mx, mz, a + Math.PI);
      return;
    }
    this.execCamFor = null;
    const shake = this.shake > 0 ? this.shake : 0;
    this.shake = Math.max(0, this.shake - dt * 1.5);
    const sx = (Math.random() - 0.5) * shake * 0.15, sy = (Math.random() - 0.5) * shake * 0.15;
    const tpv = me.role === 'killer' && isTpv(me);
    if (me.role === 'killer' && this.swapHeld && this.t - this.swapT > 0.18 && this.spider && S.spider) {
      // looking through Spider Mom's eyes: low to the floor, wherever she is
      const P = this.spider;
      cam.position.set(P.x + Math.sin(me.yaw) * 0.3, 0.55, P.z + Math.cos(me.yaw) * 0.3);
      cam.rotation.set(me.pitch * 0.6, me.yaw + Math.PI, 0);
      cam.fov = 95; cam.updateProjectionMatrix();
      this.teleFx = Math.max(this.teleFx || 0, 0.35);
      sound.listener(P.x, P.z, me.yaw);
      return;
    }
    if (me.role === 'killer' && !tpv) {
      const c = this.chars.get(me.id);
      const eye = me.char === 'butcher' ? 2.15 : me.char === 'wisp' ? 2.1 + Math.sin(this.t * 2) * 0.04 : 2.0;
      const bob = Math.sin(this.t * 8) * 0.035 * Math.min(1, (c?.spd || 0) / 4);
      let vy = 0;
      if (me.vault) { const v = me.vault; vy = Math.sin(Math.min(1, v.t / v.d) * Math.PI) * 0.4; }
      const stunTilt = me.stun > 0 ? Math.sin(this.t * 6) * 0.08 : 0;
      const lift = (this.chars.get(me.id) || {}).lift || 0;
      cam.position.set(me.x, eye + bob + vy + lift + ((c && c.h) || 0), me.z);
      cam.rotation.set(me.pitch + sy, me.yaw + Math.PI + sx, stunTilt);
      cam.fov = (this.settings.fov || 75) + (me.char === 'butcher' && me.ab === 1 ? 14 : 0) + (me.atk === 1 ? 4 : 0);
      cam.updateProjectionMatrix();
      sound.listener(me.x, me.z, me.yaw);
      return;
    }
    // third person (survivor or spectating)
    const tc = this.chars.get(target.id);
    let fx = tc ? tc.rig.root.position.x : target.x, fz = tc ? tc.rig.root.position.z : target.z;
    let h = 1.5;
    if (target.st === 'down') h = 0.75; else if (target.cr) h = 1.05; else if (target.st === 'carried') h = 1.9; else if (target.st === 'caged') h = 1.8;
    if (lookRole(target) === 'killer') h = isTpv(target) ? 1.05 : 2.2;
    if (target.disguise) h = 1.5;
    // Chucky is played over the shoulder: the camera follows his facing, mouse pitch tilts it
    if (tpv) h = (me.disguise ? 1.5 : 1.05) + (tc && tc.lift || 0);
    const floorH = (tc && tc.h) || 0, camL = levelOf(this.M, target.fl);
    h += floorH;
    const yaw = tpv ? me.yaw : this.camYaw, pitch = tpv ? Math.max(-0.35, Math.min(1.0, 0.28 - me.pitch * 0.8)) : this.camPitch;
    // player camera placement (Settings > Camera): shoulder, distance, height, orbit angle
    const cs = this.settings, side = cs.camSide ?? 1, orbit = (cs.camAngle || 0) * Math.PI / 180;
    h += cs.camHeight || 0;
    const dist = (tpv ? 2.5 : target.st === 'caged' ? 3.6 : 3.1) * (cs.camDist || 1);
    const cy = yaw + orbit;
    const back = { x: -Math.sin(cy) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(cy) * Math.cos(pitch) };
    const right = { x: -Math.cos(yaw), z: Math.sin(yaw) };
    const sideOff = (tpv ? 0.32 : 0.42) * side;
    const piv = { x: fx + right.x * sideOff, y: h, z: fz + right.z * sideOff };
    // pull in if a wall is in the way
    let dd = dist;
    for (let d = 0.3; d <= dist; d += 0.15) {
      if (pointBlocked(camL, piv.x + back.x * d, piv.y + back.y * d - floorH, piv.z + back.z * d)) { dd = Math.max(0.35, d - 0.25); break; }
    }
    this.camDist = this.camDist === undefined ? dd : (dd < this.camDist ? dd : this.camDist + (dd - this.camDist) * Math.min(1, dt * 4));
    const d = this.camDist;
    cam.position.set(piv.x + back.x * d + sx, Math.max(0.25 + floorH, piv.y + back.y * d) + sy, piv.z + back.z * d);
    cam.lookAt(piv.x, piv.y + 0.05, piv.z);
    cam.fov = this.settings.fov || 75; cam.updateProjectionMatrix();
    sound.listener(fx, fz, yaw);
  }
  execFx(victim, K, f, ch, pos) {
    const key = victim.id + ':' + (victim.stage || 0);
    if (!this.execFired || this.execFired.key !== key) this.execFired = { key, s: new Set(), pool: 0 };
    const once = (k, at, fn) => { if (f >= at && !this.execFired.s.has(k)) { this.execFired.s.add(k); fn(); } };
    this.execGore(victim, K, f, ch, pos, once);
    const pitch = ({ mara: 1.15, eli: 0.75, june: 1.3, tomas: 0.8 }[victim.char] || 1);
    const mine = victim.id === this.myId || K.id === this.myId;
    const bloodAt = (n, y = 1.1) => { this.blood.spawn(pos.x, pos.y + y, pos.z, n, 0x6a0303, 3.2, 1.4, -9.8, 1.4); this.blood.spawn(pos.x, pos.y + y, pos.z, Math.floor(n / 3), 0x3a0101, 1.2, 1.4, -9.8, 0.5); if (this.decals) this.decals.add(pos.x + (Math.random() - 0.5) * 0.6, pos.z + (Math.random() - 0.5) * 0.6, 0.9 + n / 80, Math.random() < 0.5 ? 0 : 2); };
    if (ch === 'chucky') {
      once('hi', 0.03, () => { sound.play('laugh', pos.x, pos.z); if (mine) this.feed('"We\'re friends till the end!"', 'big'); });
      once('scream', 0.2, () => sound.play('scream', pos.x, pos.z, { pitch, len: 1.6 }));
      for (let i = 0; i < 7; i++) once('stab' + i, 0.3 + i * 0.075, () => { bloodAt(25, 0.25); sound.play('thunk', pos.x, pos.z); if (mine) this.shake = 0.4 + i * 0.06; });
      once('done', 0.92, () => { sound.play('laugh', pos.x, pos.z); if (mine) this.flash = 0.6; });
    } else if (ch === 'granny') {
      // Bedtime Trap: forced to their knees, a trap is set in front of them, face shoved into it
      const F = fwd(K.yaw || 0);
      once('kneel', 0.04, () => { sound.play('thud', pos.x, pos.z); if (mine) this.feed('"Time for bed…"', 'big'); });
      once('set', 0.14, () => {
        if (this.execTrap) this.scene.remove(this.execTrap);
        const g = makeExecTrap(); g.position.set(pos.x + F.x * 0.78, 0.02, pos.z + F.z * 0.78); g.rotation.y = K.yaw || 0;
        this.scene.add(g); this.execTrap = g; this.execTrapKey = key; sound.play('click', pos.x, pos.z);
      });
      once('scream', 0.32, () => sound.play('scream', pos.x, pos.z, { pitch, len: 1.4 }));
      once('shove', 0.42, () => sound.play('swing', pos.x, pos.z));
      once('snap', 0.55, () => {
        const tx = pos.x + F.x * 0.78, tz = pos.z + F.z * 0.78;
        this.blood.spawn(tx, 0.25, tz, 120, 0x6a0303, 3.4, 1.6, -9.8, 1.4); this.blood.spawn(tx, 0.25, tz, 40, 0x3a0101, 1.2, 1.4, -9.8, 0.5);
        if (this.decals) { this.decals.add(tx, tz, 1.4, 0); this.decals.add(tx + (Math.random() - 0.5) * 0.5, tz + (Math.random() - 0.5) * 0.5, 0.9, 2); }
        sound.play('thunk', tx, tz); sound.play('break', tx, tz); sound.play('hit', pos.x, pos.z, { pitch, down: true });
        if (mine) { this.shake = 1.1; this.flash = 0.8; }
      });
      if (this.execTrap && this.execTrap.userData.close) this.execTrap.userData.close(Math.max(0, Math.min(0.9, (f - 0.53) / 0.03 * 0.9)));
      if (f > 0.56 && f < 0.85 && Math.random() < 0.3) this.blood.spawn(pos.x + F.x * 0.78, 0.15, pos.z + F.z * 0.78, 3, 0x5a0404, 0.5, 1, -9, 0.3);
      once('done', 0.9, () => { if (mine) this.feed('"Sweet dreams."', 'big'); });
    } else if (ch === 'bateman') {
      once('lecture', 0.04, () => { if (mine) this.feed('"Do you like Huey Lewis and the News?"', 'big'); });
      once('scream', 0.22, () => sound.play('scream', pos.x, pos.z, { pitch, len: 1.2 }));
      once('hip', 0.35, () => { if (mine) this.feed('"Hip to be square!"', 'big'); sound.play('swing', pos.x, pos.z); });
      once('chop1', 0.5, () => { bloodAt(80); sound.play('thunk', pos.x, pos.z); sound.play('hit', pos.x, pos.z, { pitch, down: true }); if (mine) this.shake = 0.7; });
      once('chop2', 0.72, () => { bloodAt(130); sound.play('thunk', pos.x, pos.z); if (mine) { this.shake = 1; this.flash = 0.8; } });
      once('drop', 0.9, () => sound.play('drop', pos.x, pos.z));
    } else if (ch === 'butcher') {
      once('scream', 0.22, () => sound.play('scream', pos.x, pos.z, { pitch, len: 1.2 }));
      once('chop1', 0.5, () => { bloodAt(70); sound.play('thunk', pos.x, pos.z); sound.play('hit', pos.x, pos.z, { pitch, down: true }); if (mine) this.shake = 0.7; });
      once('chop2', 0.72, () => { bloodAt(120); sound.play('thunk', pos.x, pos.z); sound.play('break', pos.x, pos.z); if (mine) { this.shake = 1; this.flash = 0.8; } });
      once('drop', 0.9, () => sound.play('drop', pos.x, pos.z));
    } else if (ch === 'wisp') {
      once('scream', 0.12, () => sound.play('scream', pos.x, pos.z, { pitch: pitch * 1.1, len: 1.6 }));
      once('fade', 0.5, () => sound.play('fade', pos.x, pos.z, { on: true }));
      if (f > 0.3 && f < 0.95) this.sparks.spawn(pos.x, pos.y + 1.4, pos.z, 3, 0x7ff0ff, 0.8, 1.2, 0.6, 0.6, 1.5);
      once('burst', 0.95, () => { this.sparks.spawn(pos.x, pos.y + 1.0, pos.z, 120, 0x9ff6ff, 2.5, 1.6, 0.3, 1.5); sound.play('fade', pos.x, pos.z, { on: false }); if (mine) this.flash = 0.4; });
    } else if (ch === 'foreman') {
      once('reach', 0.12, () => sound.play('swing', pos.x, pos.z));
      once('hook', 0.3, () => { bloodAt(110, 0.9); sound.play('kick', pos.x, pos.z); sound.play('scream', pos.x, pos.z, { pitch, len: 1.8 }); if (mine) { this.shake = 1; this.flash = 0.7; } });
      once('lift', 0.45, () => sound.play('thud', pos.x, pos.z));
      if (f > 0.55 && f < 0.95) this.smoke.spawn(pos.x, pos.y + 0.6, pos.z, 2, 0x050505, 0.5, 2.2, 0.4, 0.5);
      if (f > 0.3 && f < 0.6 && Math.random() < 0.35) this.blood.spawn(pos.x, pos.y + 0.9, pos.z, 2, 0x5a0404, 0.4, 1, -9, 0.2);
      once('gone', 0.9, () => { sound.play('sacrifice'); if (mine) this.feed('HEADCOUNT MUST BE MAINTAINED.', 'big'); });
    } else {
      once('raise', 0.05, () => sound.play('swing', pos.x, pos.z));
      once('stab', 0.32, () => { bloodAt(90, 0.3); sound.play('thunk', pos.x, pos.z); sound.play('scream', pos.x, pos.z, { pitch, len: 1.5 }); if (mine) { this.shake = 0.9; this.flash = 0.6; } });
      once('hoist', 0.5, () => sound.play('roar', pos.x, pos.z));
      if (f > 0.42 && f < 0.86 && Math.random() < 0.3) this.blood.spawn(pos.x, pos.y + 0.9, pos.z, 2, 0x5a0404, 0.3, 1, -9, 0.2);
      once('toss', 0.88, () => { sound.play('drop', pos.x, pos.z); bloodAt(30, 0.2); });
    }
  }

  // the gore every execution shares: the wound opens, keeps pumping, a pool spreads under the body
  // and the killing blow comes with a burst, flying chunks and a beat of slow motion
  execGore(victim, K, f, ch, pos, once) {
    const T = { butcher: [0.5, 0.72], bateman: [0.5, 0.72], chucky: [0.3, 0.75], foreman: [0.3, 0.55], harrower: [0.32, 0.5], lamplighter: [0.32, 0.5], wisp: [0.45, 0.8], slimer: [0.35, 0.75] }[ch] || [0.35, 0.7];
    const [wound, kill] = T, mine = victim.id === this.myId || K.id === this.myId;
    const y = ch === 'harrower' || ch === 'lamplighter' ? 1.2 : ch === 'chucky' ? 0.3 : 1.0;
    if (ch === 'wisp' || ch === 'slimer') { /* no blade: their deaths are frost and slime */ }
    else if (f > wound && f < 0.97) {
      // arterial spurts in time with a heartbeat, plus a steady drip
      const beat = Math.sin(this.t * 9) > 0.6;
      if (beat && Math.random() < 0.8) { const a = Math.random() * 6.28; this.blood.spray(pos.x, pos.y + y, pos.z, 6, 0x8a0505, Math.cos(a), Math.sin(a), 2.6, 0.9); }
      if (Math.random() < 0.5) this.blood.spawn(pos.x, pos.y + y - 0.2, pos.z, 2, 0x5a0303, 0.4, 0.3, -9.8, 0.25);
      const F = this.execFired;
      if (f - F.pool > 0.07 && this.decals) { F.pool = f; this.decals.add(pos.x + (Math.random() - 0.5) * 0.2, pos.z + (Math.random() - 0.5) * 0.2, 0.7 + (f - wound) * 2.4, 1); }
    }
    once('killblow', kill, () => {
      if (ch !== 'wisp' && ch !== 'slimer') {
        for (let i = 0; i < 4; i++) { const a = Math.random() * 6.28; this.blood.spray(pos.x, pos.y + y, pos.z, 45, 0x7a0404, Math.cos(a), Math.sin(a), 5, 1.6); }
        this.blood.spawn(pos.x, pos.y + y, pos.z, 26, 0x2a0000, 3.4, 2.2, -12, 1.8); // chunks
        if (this.decals) for (let i = 0; i < 5; i++) this.decals.add(pos.x + (Math.random() - 0.5) * 2.4, pos.z + (Math.random() - 0.5) * 2.4, 0.4 + Math.random() * 0.8, 2, Math.random() * 6.28);
      }
      if (mine) { this.hitStop = 0.3; this.shake = Math.max(this.shake, 1.1); this.flash = Math.max(this.flash, 0.6); }
      if (victim.id === this.myId) this.splat(1);
      if (K.id === this.myId && this.view) this.view.userData.bloody = 1;
    });
  }

  // flashlight: a torch in the right hand with a soft volumetric beam (and a real spotlight on
  // medium/high for the beam nearest the camera)
  placeTorch(c, R, p, on) {
    if (!c.torch) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x1a1a1c, metalness: 0.6, roughness: 0.4 }));
      body.rotation.x = Math.PI / 2; g.add(body);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 12), new THREE.MeshBasicMaterial({ color: 0xfff4d0, toneMapped: false }));
      lens.position.z = 0.101; g.add(lens);
      const proton = !!(SURVIVORS[p.char] && SURVIVORS[p.char].gb);
      if (proton) body.visible = false;
      const beam = new THREE.Mesh(BEAM_GEO, proton ? PROTON_MAT : BEAM_MAT);
      if (proton) { beam.scale.set(0.16, 0.16, 1); const core = new THREE.Mesh(BEAM_GEO, PROTON_CORE); core.scale.set(0.06, 0.06, 1); core.position.z = 0.1; core.frustumCulled = false; g.add(core); g.userData.proton = true; }
      beam.position.z = 0.1; beam.frustumCulled = false; g.add(beam);
      g.userData = { lens, beam };
      this.scene.add(g); c.torch = g;
    }
    const g = c.torch;
    g.visible = on;
    if (!on) return;
    const hand = R.j && R.j.handR;
    if (hand) hand.getWorldPosition(g.position); else g.position.set(p.x, 1.2, p.z);
    g.rotation.set(0, p.yaw + (g.userData.proton ? (Math.random() - 0.5) * 0.05 : 0), g.userData.proton ? (Math.random() - 0.5) * 0.4 : 0, 'YXZ');
    g.rotateX(0.06);
    if (this.torchLight) {
      const cam = this.camera.position, d = (cam.x - g.position.x) ** 2 + (cam.z - g.position.z) ** 2;
      if (d < this.torchBest) { this.torchBest = d; this.torchFrom = g; }
    }
  }
  updateTorchLight() {
    if (!this.torchLight) return;
    const L = this.torchLight, g = this.torchFrom;
    L.intensity = g ? 40 : 0;
    if (g) {
      L.position.copy(g.position);
      const f = new THREE.Vector3(0, 0, 9).applyQuaternion(g.quaternion);
      L.target.position.copy(g.position).add(f);
    }
    this.torchBest = Infinity; this.torchFrom = null;
  }

  // slime puddles: glossy green ectoplasm with a soft glow
  updateSlime(S) {
    this.slimeMeshes ||= new Map();
    const live = new Set((S.slime || []).map(t => t.id));
    for (const [id, m] of this.slimeMeshes) if (!live.has(id)) { this.scene.remove(m); this.slimeMeshes.delete(id); }
    for (const t of S.slime || []) {
      if (this.slimeMeshes.has(t.id)) continue;
      const g = new THREE.Group(); g.position.set(t.x, 0.02, t.z);
      const m = new THREE.Mesh(new THREE.CircleGeometry(2.1, 24), new THREE.MeshStandardMaterial({ color: 0x5aff2a, emissive: 0x1a8a08, emissiveIntensity: 0.9, roughness: 0.1, transparent: true, opacity: 0.8 }));
      m.rotation.x = -Math.PI / 2; m.scale.set(1, 0.8 + Math.random() * 0.3, 1); g.add(m);
      for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.08 + Math.random() * 0.1, 8, 6), m.material); b.position.set((Math.random() - 0.5) * 2, 0.03, (Math.random() - 0.5) * 2); b.scale.y = 0.5; g.add(b); }
      this.scene.add(g); this.slimeMeshes.set(t.id, g);
    }
  }

  // ghost traps on the ground ("HW Detail #4 GHOST TRAP" model; a striped box if it didn't load)
  // ---------------- Granny's bear traps ----------------
  updateBears(S) {
    this.bearMeshes ||= new Map();
    const live = new Set((S.bears || []).map(t => t.id));
    for (const [id, m] of this.bearMeshes) if (!live.has(id)) { this.scene.remove(m); this.bearMeshes.delete(id); }
    for (const t of S.bears || []) {
      if (this.bearMeshes.has(t.id)) continue;
      const g = makeBearTrap(); g.position.set(t.x, 0.02, t.z); g.rotation.y = (t.id * 2.39) % 6.28;
      this.scene.add(g); this.bearMeshes.set(t.id, g);
    }
  }
  // ---------------- chests: a wooden chest with iron bands; the lid swings up, the item floats inside ----------------
  updateChests(S, dt) {
    const M = this.M;
    if (!M.chests || !M.chests.length) return;
    if (!this.chestMeshes) {
      this.chestMeshes = [];
      const wood = new THREE.MeshStandardMaterial({ color: 0x6a4626, roughness: 0.8, map: (tex('wood') || {}).map || null }), iron = new THREE.MeshStandardMaterial({ color: 0x3a3836, metalness: 0.7, roughness: 0.45 });
      const gold = new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 0.8, roughness: 0.3, emissive: 0x3a2a08, emissiveIntensity: 0.4 });
      for (const c of M.chests) {
        const g = new THREE.Group(); g.position.set(c.x, 0, c.z); g.rotation.y = c.rot; g.scale.setScalar(1.15);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.42, 0.56), wood); box.position.y = 0.21; g.add(box);
        for (const x of [-0.33, 0.33]) { const band = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.44, 0.58), iron); band.position.set(x, 0.21, 0); g.add(band); }
        const lid = new THREE.Group(); lid.position.set(0, 0.42, -0.28); g.add(lid);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 14, 1, false, 0, Math.PI), wood); top.rotation.set(0, 0, Math.PI / 2); top.position.set(0, 0, 0.28); top.scale.set(1, 1, 0.45); lid.add(top);
        for (const x of [-0.33, 0.33]) { const band = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.06, 14, 1, false, 0, Math.PI), iron); band.rotation.set(0, 0, Math.PI / 2); band.position.set(x, 0, 0.28); band.scale.set(1, 1, 0.47); lid.add(band); }
        const lock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.04), gold); lock.position.set(0, 0.36, 0.29); g.add(lock);
        g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        const glow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshBasicMaterial({ color: 0xffd890, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.rotation.x = -Math.PI / 2; glow.position.y = 0.43; g.add(glow);
        const hold = new THREE.Group(); hold.position.y = 0.62; g.add(hold);
        this.scene.add(g); this.chestMeshes.push({ g, lid, glow, hold, k: null, open: 0 });
      }
    }
    M.chests.forEach((c, i) => {
      const cs = S.chests && S.chests[i], C = this.chestMeshes[i]; if (!cs || !C) return;
      C.open += ((cs.open ? 1 : 0) - C.open) * Math.min(1, dt * 4);
      C.lid.rotation.x = -C.open * 1.9;
      C.glow.material.opacity = cs.open && cs.it ? 0.6 + Math.sin(this.t * 3 + i) * 0.15 : 0.12 + Math.sin(this.t * 1.5 + i) * 0.06;
      const k = cs.open && cs.it ? cs.it.k + (cs.it.n > 0.05 ? '' : '-') : null;
      if (k !== C.k) {
        C.k = k; C.hold.clear();
        if (k) { const m = itemModel(cs.it.k); if (cs.it.n <= 0.05) m.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color && o.material.color.multiplyScalar(0.45); } }); C.hold.add(m); }
      }
      C.hold.rotation.y += dt * 1.2; C.hold.position.y = 0.62 + Math.sin(this.t * 2 + i) * 0.04;
    });
  }
  // taser darts: a jagged electric line from the survivor to where it struck, crackling for a moment
  updateZaps(S, dt) {
    for (const z of (this.zaps ||= [])) {
      z.t += dt;
      const pos = z.line.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const f = i / (pos.count - 1), j = i === 0 || i === pos.count - 1 ? 0 : 0.12;
        pos.setXYZ(i, z.x + (z.tx - z.x) * f + (Math.random() - 0.5) * j, 1.2 + (z.ty - 1.2) * f + (Math.random() - 0.5) * j, z.z + (z.tz - z.z) * f + (Math.random() - 0.5) * j);
      }
      pos.needsUpdate = true; z.line.material.opacity = Math.max(0, 1 - z.t / 0.45);
    }
    for (const z of this.zaps.filter(z => z.t > 0.45)) this.scene.remove(z.line);
    this.zaps = this.zaps.filter(z => z.t <= 0.45);
    // a tazed killer crackles with sparks
    for (const p of S.players) if (p.zap > 0 && Math.random() < 0.6) this.sparks.spawn(p.x + (Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 1.4, p.z + (Math.random() - 0.5) * 0.6, 2, 0x8ad8ff, 1.5, 0.3, 0, 0.6, 0.5);
  }
  // ---------------- Granny's Creep: markers on every window, pallet, generator and hook ----------------
  creepTargets(S) {
    const M = this.M, out = [];
    M.gens.forEach(g => out.push({ kind: 'gen', id: g.id, x: g.x, z: g.z, y: 1.2, n: 'Generator' }));
    M.cages.forEach(c => { if (!S.cageBroken[c.id]) out.push({ kind: 'hook', id: c.id, x: c.x, z: c.z, y: 2.2, n: 'Hook' }); });
    M.windows.forEach(w => out.push({ kind: 'win', id: w.id, x: w.x, z: w.z, y: 1.2, n: 'Window' }));
    M.bars.forEach(b => { if (S.bars[b.id] !== 2) out.push({ kind: 'bar', id: b.id, x: b.x, z: b.z, y: 1.0, n: 'Pallet' }); });
    return out;
  }
  updateCreep(S, me) {
    if (!this.creepHeld || !me || me.char !== 'granny' || me.role !== 'killer' || me.teleCd > 0 || me.tele) { if (this.creepEls) this.clearCreep(); this.creepHeld = this.creepHeld && me && !me.tele && me.teleCd <= 0; return; }
    const list = this.creepTargets(S), box = $('markers');
    this.creepEls ||= [];
    while (this.creepEls.length < list.length) { const el = document.createElement('div'); el.className = 'creep-mk'; box.appendChild(el); this.creepEls.push(el); }
    let best = null, bd = 0.5;
    const v = new THREE.Vector3();
    list.forEach((t, i) => {
      const el = this.creepEls[i];
      v.set(t.x, t.y, t.z).project(this.camera);
      const on = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && Math.hypot(t.x - me.x, t.z - me.z) > 4;
      el.style.display = on ? '' : 'none'; t.el = el;
      if (!on) return;
      el.style.left = ((v.x + 1) / 2 * innerWidth) + 'px'; el.style.top = ((1 - v.y) / 2 * innerHeight) + 'px';
      el.dataset.n = t.n; el.classList.remove('sel');
      const dc = Math.hypot(v.x, v.y);
      if (dc < bd) { bd = dc; best = t; }
    });
    for (let i = list.length; i < this.creepEls.length; i++) this.creepEls[i].style.display = 'none';
    this.creepSel = best;
    if (best && best.el) best.el.classList.add('sel');
  }
  clearCreep() { for (const el of this.creepEls || []) el.remove(); this.creepEls = null; this.creepSel = null; }
  // ---------------- Spider Mom ----------------
  updateSpiderMom(dt, S) {
    const sp = S.spider;
    if (!sp) { if (this.spider) this.spider.R.root.visible = false; return; }
    if (!this.spider && spiderMomReady()) { const R = makeSpiderMom(this.settings.quality === 'potato' || this.settings.quality === 'low'); if (R) { this.scene.add(R.root); this.spider = { R, x: sp.x, z: sp.z, yaw: sp.yaw }; } }
    if (!this.spider) return;
    const P = this.spider, R = P.R;
    R.root.visible = true;
    const k = 1 - Math.exp(-dt * 10), moved = Math.hypot(sp.x - P.x, sp.z - P.z);
    if (moved > 4) { P.x = sp.x; P.z = sp.z; } else { P.x += (sp.x - P.x) * k; P.z += (sp.z - P.z) * k; }
    P.yaw += Math.atan2(Math.sin(sp.yaw - P.yaw), Math.cos(sp.yaw - P.yaw)) * Math.min(1, dt * 6);
    R.root.position.set(P.x, 0, P.z); R.root.rotation.y = P.yaw;
    R.play(sp.st === 2 ? 'eat' : moved > 0.02 || sp.st === 0 ? 'walk' : 'idle', dt);
  }



  updateTraps(S) {
    this.trapMeshes ||= new Map();
    const live = new Set((S.traps || []).map(t => t.id));
    for (const [id, m] of this.trapMeshes) if (!live.has(id)) { this.scene.remove(m); this.trapMeshes.delete(id); }
    for (const t of S.traps || []) {
      if (this.trapMeshes.has(t.id)) { const m = this.trapMeshes.get(t.id); m.userData.glow.material.opacity = 0.5 + Math.sin(this.t * 6) * 0.3; continue; }
      const g = new THREE.Group(); g.position.set(t.x, 0, t.z);
      const model = cloneStatic('ghosttrap');
      if (model) { model.rotation.y = Math.random() * Math.PI * 2; g.add(model); }
      else {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.3), new THREE.MeshStandardMaterial({ color: 0x2a2c2e, metalness: 0.6, roughness: 0.4 })); body.position.y = 0.07; g.add(body);
        for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.06), new THREE.MeshStandardMaterial({ color: 0xe0b020 })); st.position.set(0, 0.145, s * 0.1); g.add(st); }
        const slot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.05), new THREE.MeshBasicMaterial({ color: 0xffe080, toneMapped: false })); slot.position.y = 0.152; g.add(slot);
      }
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 4), new THREE.MeshStandardMaterial({ color: 0x111111 })); cord.rotation.z = Math.PI / 2; cord.position.set(0.5, 0.02, 0); g.add(cord);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex ||= (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })(), color: 0xffd060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(model ? 0.4 : 0.7); glow.position.y = model ? 0.28 : 0.2; g.add(glow); g.userData.glow = glow;
      this.scene.add(g); this.trapMeshes.set(t.id, g);
    }
  }

  // ---- emotes (survivors): B opens the bar, 1-4 or a click picks one; moving cancels ----
  toggleEmotes(force) {
    const me = this.mine();
    if (!this.emoteBar) {
      const bar = this.emoteBar = document.createElement('div'); bar.id = 'emote-bar'; bar.className = 'hidden';
      bar.innerHTML = [['Dance', 1], ['Wave', 2], ['Cheer', 3], ['Bow', 4]].map(([n, i]) => `<button data-emote="${i}"><b>${i}</b>${n}</button>`).join('');
      bar.addEventListener('mousedown', ev => { const b = ev.target.closest('[data-emote]'); if (b) { ev.stopPropagation(); this.playEmote(+b.dataset.emote); } });
      this.hud.appendChild(bar);
    }
    const open = force ?? this.emoteBar.classList.contains('hidden');
    if (open && (!me || me.role !== 'survivor' || me.st !== 'ok')) { if (me && me.role === 'killer') this.feed('Emotes are for survivors'); return; }
    this.emoteBar.classList.toggle('hidden', !open);
  }
  playEmote(n) {
    const me = this.mine();
    this.emoteBar && this.emoteBar.classList.add('hidden');
    if (!me || me.role !== 'survivor' || me.st !== 'ok') return;
    this.send({ t: 'act', a: 'emote', n: me.emote === n ? 0 : n });
  }

  // the bot this fallen player could take over: the one being watched, else the first alive
  takeoverTarget() {
    const S = this.S, me = this.mine();
    if (!S || !me || me.role !== 'survivor' || me.st !== 'dead' || S.phase !== 'play') return null;
    const ok = p => p && p.bot && p.role === 'survivor' && ['ok', 'down', 'carried', 'caged'].includes(p.st);
    if (this.spectate && ok(playerById(S, this.spectate.id))) return playerById(S, this.spectate.id);
    return S.players.find(ok) || null;
  }
  switchTo(id) {
    this.myId = id;
    if (this.session) this.session.myId = id;
    this.me = null; this.spectate = null; this.myTp = -1;
    const p = this.mine();
    if (p) { this.camYaw = p.yaw; this.camPitch = 0.15; this.buildStaticHUD(this.S); }
    sound.play('heal');
  }

  cycleSpectate(auto) {
    const S = this.S, me = this.mine();
    if (!S || !me || me.role !== 'survivor' || (me.st !== 'dead' && me.st !== 'out')) return;
    const alive = S.players.filter(p => p.role === 'survivor' && p.id !== me.id && ['ok', 'down', 'carried', 'caged'].includes(p.st));
    if (!alive.length) { this.spectate = null; return; }
    const i = this.spectate ? alive.findIndex(p => p.id === this.spectate.id) : -1;
    this.spectate = alive[(i + 1) % alive.length];
  }

  // ---------------- auras ----------------
  updateAuras(S, me) {
    if (!me) return;
    const K = killerOf(S);
    const killerView = me.role === 'killer';
    for (const p of S.players) {
      const c = this.chars.get(p.id);
      if (!c) continue;
      let col = null;
      if (p.id === me.id && !(me.st === 'dead' || me.st === 'out')) col = null;
      else if (killerView && p.role === 'survivor') {
        if (p.st === 'ok' && p.spied > 0) col = 0xc050ff; // Spider Mom found them: a purple outline
        else if (p.st === 'ok' && (p.reveal > 0 || (has(me, 'scent') && p.hp === 1 && dist(p, me) < 24) || (has(me, 'static') && p.act && p.act.k === 'repair'))) col = 0xff3030;
        else if (p.st === 'caged') col = 0xff8a2a; // caged survivors stay in sight until they are freed
      } else if (!killerView) {
        if (p.disguise && has(me, 'exorcist') && dist(p, me) < 20) col = 0xb06aff; // Exorcist: Chucky inside a survivor
        else if (lookRole(p) === 'survivor') {
          const far = dist(p, me) > 6 || me.st === 'dead' || me.st === 'out';
          col = !far ? null : p.st === 'caged' || p.st === 'exec' ? 0xff4a3a : p.st === 'down' ? 0xffa030 : p.st === 'carried' ? 0xff7030 : p.st === 'ok' ? 0xe8d8a0 : null;
        } else if (lookRole(p) === 'killer' && (p.exposed > 0 || (has(me, 'sixth') && me.sixT < 4 && me.st !== 'dead') || me.st === 'dead' || me.st === 'out')) col = 0xff2020;
      }
      if (p.st === 'dead' || p.st === 'out') col = null;
      if ((S.dark > 0 || S.mode === 'dark') && !killerView && p.role === 'survivor') col = null; // Lights Out: you lose track of each other
      if (c.aura !== col) { c.rig.setAura(col); c.aura = col; }
    }
    // gens
    for (let i = 0; i < this.M.gens.length; i++) {
      const gs = S.gens[i], a = this.W.gens[i].userData.aura, g = this.M.gens[i];
      let on = false, col = 0xffe8a0;
      if (killerView) { if (gs.n > 0 && !gs.done) { on = true; col = 0xffd040; } } // the killer always knows which generators are being repaired
      else if (!gs.done && !S.gatesPowered && !(S.dark > 0) && S.mode !== 'dark') { on = Math.hypot(g.x - me.x, g.z - me.z) > 6; col = gs.reg ? 0xff6040 : 0xffe8a0; }
      a.visible = on; if (on) a.material = this.auraMatFor(col);
    }
    // cages for the killer while carrying
    for (let i = 0; i < this.M.cages.length; i++) {
      const a = this.W.cages[i].userData.aura;
      const on = killerView && me.carry != null && S.cages[i] == null && !S.cageBroken[i];
      a.visible = on; if (on) a.material = this.auraMatFor(0xff3a2a);
    }
    for (let i = 0; i < this.M.gates.length; i++) {
      const a = this.W.gates[i].userData.aura;
      const on = (S.gatesPowered || (!killerView && has(me, 'pathfinder'))) && !S.gates[i].open && Math.hypot(this.M.gates[i].x - me.x, this.M.gates[i].z - me.z) > 8;
      a.visible = on; if (on) a.material = this.auraMatFor(0xffffff);
    }
  }
  auraMatFor(col) { return auraMat(col); }

  // ---------------- audio ----------------
  updateAudio(dt, S, me) {
    if (!me) return;
    const K = nearestKiller(S, me);
    let intensity = 0, chase = 0;
    if (me.role === 'survivor' && K && (me.st === 'ok' || me.st === 'down' || me.st === 'caged')) {
      const tr = terrorRadius(K), d = dist(me, K);
      if (tr > 0 && d < tr) intensity = 1 - d / tr;
      if (d < 14 && tr > 0 && !losBlocked(this.M, me.x, me.z, K.x, K.z)) chase = 1 - d / 14 + 0.3;
    } else if (me.role === 'killer') {
      for (const s of S.players) if (s.role === 'survivor' && s.st === 'ok' && dist(s, me) < 14 && !losBlocked(this.M, me.x, me.z, s.x, s.z)) chase = Math.max(chase, 0.6);
    }
    sound.terror(intensity, chase);
    this.terrorI = intensity;
    sound.gens(this.M.gens.map((g, i) => ({ x: g.x, z: g.z, rep: S.gens[i].n > 0, done: S.gens[i].done })));
  }

  // ---------------- events from the host ----------------
  onEvents(evs) {
    if (!evs || !evs.length || this.disposed) return;
    const S = this.S || this.session.state(), me = this.mine();
    const name = id => { const p = S && playerById(S, id); return p ? p.name : '?'; };
    const pitchOf = id => { const p = S && playerById(S, id); return p ? ({ mara: 1.15, eli: 0.75, june: 1.3, tomas: 0.8 }[p.char] || 1) : 1; };
    for (const e of evs) {
      switch (e.k) {
        case 'swing': { const p = S && playerById(S, e.id); if (p) sound.play('swing', p.x, p.z); break; }
        case 'phase': { const p = S && playerById(S, e.id); this.sparks.spawn(e.x, 1.2, e.z, 50, 0x7aff4a, 2.2, 1.2, 0.4, 1); sound.play('fade', e.x, e.z, { on: true }); break; }
        case 'slimespit': this.sparks.spawn(e.x, 0.3, e.z, 40, 0x7aff4a, 2, 0.8, 0.3, 1); sound.play('drop', e.x, e.z); break;
        case 'slimed': if (e.id === this.myId) { this.feed('You ran through slime! Slowed and revealed.', 'big'); this.flash = 0.3; } break;
        case 'chest': {
          const c = this.M.chests && this.M.chests[e.id]; if (c) sound.play('chest', c.x, c.z);
          if (e.by === this.myId) this.feed('The chest holds a ' + (ITEMS[e.item] || ITEMS.flashlight).name + (e.item === 'taser' ? '! Rare find.' : '.') + ' Hold E to swap it for yours.', e.item === 'taser' ? 'big' : '');
          break;
        }
        case 'chestswap': {
          const c = this.M.chests && this.M.chests[e.id]; if (c) sound.play('click', c.x, c.z);
          if (e.by === this.myId) { this.feed('You took the ' + (ITEMS[e.item] || ITEMS.flashlight).name + ' and left your ' + (ITEMS[e.left] || ITEMS.flashlight).name + '.'); this.flashHeld = false; }
          break;
        }
        case 'taser': {
          const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
          const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x9ae0ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
          line.frustumCulled = false; this.scene.add(line);
          (this.zaps ||= []).push({ line, t: 0, x: e.x, z: e.z, tx: e.tx, tz: e.tz, ty: e.hit ? 1.2 : 1.0 });
          sound.play('zap', e.x, e.z, { len: 0.25 });
          this.sparks.spawn(e.tx, 1.1, e.tz, 25, 0x9ae0ff, 2.5, 0.4, -4, 0.5);
          break;
        }
        case 'tazed': {
          const K = S && playerById(S, e.id); if (K) sound.play('zap', K.x, K.z, { len: 1.2 });
          if (e.id === this.myId) { this.feed('You were tazed!', 'big'); this.shake = 0.8; this.flash = 0.3; }
          else if (e.by === this.myId) this.feed('Direct hit! ' + name(e.id) + ' is electrocuted.', 'big');
          break;
        }
        case 'taserdead': if (e.id === this.myId) this.feed('Your Taser is out of shots. Swap it at a chest.'); break;
        case 'trapset': if (e.id === this.myId) this.feed('Ghost Trap set.'); sound.play('click', e.x, e.z); break;
        case 'trapped': {
          const by = S && playerById(S, e.by);
          this.feed(`The killer stepped in ${by ? by.name + "'s" : 'a'} Ghost Trap!`, e.by === this.myId || e.id === this.myId ? 'big' : '');
          this.sparks.spawn(e.x, 0.4, e.z, 80, 0xffe080, 3, 1.2, 0.3, 1.5); this.sparks.spawn(e.x, 0.6, e.z, 60, 0x60c0ff, 2.5, 1.6, -0.5, 1.2);
          sound.play('fade', e.x, e.z, { on: false }); break;
        }
        case 'blind': {
          const by = S && playerById(S, e.by);
          this.feed(`${by ? by.name : 'A survivor'} blinded the killer${e.save ? ' and saved their friend' : ''}!`, e.id === this.myId || e.by === this.myId ? 'big' : '');
          const k = S && playerById(S, e.id); if (k) { this.sparks.spawn(k.x, 2.1, k.z, 40, 0xfff6d8, 2.2, 0.6, 0.2); sound.play('fade', k.x, k.z, { on: false }); }
          break;
        }
        case 'flashdead': if (e.id === this.myId) { this.feed('Your flashlight battery is dead.'); this.flashHeld = false; } break;
        case 'swap': if (e.from === this.myId) this.switchTo(e.to); break; // silent (Possession, Soul Split)
        case 'split':
          this.sparks.spawn(e.x, 0.5, e.z, 90, 0xff3a1a, 3, 1.5, 0.4, 1.4); this.smoke.spawn(e.x, 0.6, e.z, 14, 0x200808, 1.2, 2.2, 0.5, 0.8);
          sound.play('laugh', e.x, e.z);
          if (e.to === this.myId) { this.feed('Your soul jumps into another doll! Your old body keeps hunting: it can put survivors down, but not hook them.', 'big'); this.flash = 0.6; }
          break;
        case 'possessed':
          if (e.id === this.myId) { this.feed(`You are inside ${name(e.id)}. Nobody knows. Down a survivor and hook them, then press G to let go.`, 'big'); this.flash = 0.5; }
          if (e.ghost === this.myId) { this.feed('You have been possessed! You are a ghost now: nobody can see you. Keep repairing generators (10% slower).', 'big'); this.flash = 0.6; this.shake = 0.6; }
          break;
        case 'depossessed':
          if (e.by === this.myId) this.feed('You leave the body and return to your doll.', 'big');
          if (e.id === this.myId) { this.feed('You are back in your own body.', 'big'); this.flash = 0.4; }
          break;
        case 'takeover':
          if (e.from === this.myId) this.switchTo(e.to);
          this.feed(`${e.name} took over ${e.was}.`, e.to === this.myId ? 'big' : '');
          break;
        case 'hit': {
          const hc = this.chars.get(e.id); if (hc) hc.hitAt = this.t;
          this.petReact(e.id, e.down ? 'panic' : 'jump', e.down ? 3 : 1.2); this.petReact(e.by, 'cheer', 1.5);
          if (e.down) { // downed twice inside a minute: Ted has opinions
            const dl = ((this.downLog ||= {})[e.id] ||= []); dl.push(this.t); while (dl.length && dl[0] < this.t - 60) dl.shift();
            if (dl.length >= 2) this.petSay(e.id, 'cock', 20);
          }
          if (e.by === this.myId) { this.shake = 0.45; this.hitStop = 0.08; this.splat(); }
          sound.play('hit', e.x, e.z, { pitch: pitchOf(e.id), down: e.down });
          {
            const kp = S && playerById(S, e.by);
            let dx = kp ? e.x - kp.x : Math.random() - 0.5, dz = kp ? e.z - kp.z : Math.random() - 0.5; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
            this.blood.spray(e.x, 1.25, e.z, 70, 0x6a0303, dx, dz, 4.5, 1.4);
            this.blood.spawn(e.x, 1.1, e.z, 30, 0x4a0202, 1.6, 1.2, -9.8, 0.6);
            this.decals.add(e.x + dx * 1.1, e.z + dz * 1.1, 1.8 + Math.random() * 0.6, 2, Math.atan2(dx, dz) - Math.PI / 2 + Math.PI / 2);
            this.decals.add(e.x + dx * 0.3, e.z + dz * 0.3, 0.9, 0);
            if (e.down) this.decals.add(e.x, e.z, 1.3, 1);
          }
          if (e.id === this.myId) { this.flash = 1; this.shake = 0.6; this.splat(0.55); }
          if (e.by === this.myId && this.view) this.view.userData.bloody = Math.min(1, (this.view.userData.bloody || 0) + 0.5);
          break;
        }
        case 'chainthrow': sound.play('throw', e.x, e.z); sound.play('kick', e.x, e.z); break;
        case 'chainhit': sound.play('thud', e.x, e.z); this.blood.spawn(e.x, 1.2, e.z, 30, 0x6a0505, 2.4, 1.2, -9, 1.2); if (e.id === this.myId) { this.shake = 0.8; this.feed('Hooked! You are being reeled in.', 'big'); } break;
        case 'chaingrab': sound.play('kick', e.x, e.z); this.sparks.spawn(e.x, 1.25, e.z, 20, 0xffd080, 3, 0.5, -9); break;
        case 'lightsout': {
          sound.play(e.on ? 'lightsout' : 'lightson');
          if (e.on && me && me.role === 'survivor') this.feed('The lights go out…', 'big');
          break;
        }
        case 'lantern': sound.play('lantern', e.x, e.z); this.sparks.spawn(e.x + 0.34, 1.45, e.z, 25, 0x6aff8a, 1.5, 1, 0.5); break;
        case 'snuff': sound.play('snuff', e.x, e.z); this.smoke.spawn(e.x + 0.34, 1.5, e.z, 6, 0x1a2a1a, 0.6, 2, 0.5, 0.4); if (e.by) this.feed(name(e.by) + ' snuffed a cursed lantern.'); break;
        case 'tele': this.smoke.spawn(e.x, 1, e.z, 18, 0x0a2a12, 1.2, 2, 0.5, 1); this.sparks.spawn(e.x, 1.2, e.z, 40, 0x5aff7a, 2, 1.2, 0.5); sound.play('fade', e.x, e.z, { on: true }); if (e.id === this.myId) this.teleFx = 1; break;
        case 'tele-end': this.smoke.spawn(e.x, 1, e.z, 18, 0x0a2a12, 1.2, 2, 0.5, 1); this.sparks.spawn(e.x, 1.2, e.z, 50, 0x5aff7a, 2.5, 1.2, 0.5); sound.play('fade', e.x, e.z, { on: false }); break;
        case 'marked': if (e.id === this.myId) this.feed('You have been Marked — the Harrower can see you.', 'big'); break;
        case 'msg': this.feed(e.text); break;
        case 'gen': for (const p of S.players) if (p.role === 'survivor' && Math.hypot(p.x - e.x, p.z - e.z) < 3) this.petReact(p.id, 'cheer', 2);
          sound.play('gen', e.x, e.z);
          this.sparks.spawn(e.x, 1.6, e.z, 60, 0xffc060, 4, 1.2, -6);
          this.feed(e.left > 0 ? `A generator has been repaired. ${e.left} to go.` : 'All required generators repaired!');
          if (me && me.role === 'killer') this.marker(e.x, 1.5, e.z, 'gen'); // the killer sees where it was finished
          break;
        case 'genfail': {
          if (e.by) this.petSay(e.by, Math.random() < 0.6 ? 'shit' : 'cock', 15);
          const g = this.M.gens[e.id];
          sound.play('genfail', g.x, g.z);
          this.sparks.spawn(g.x, 1.3, g.z, 70, 0xffaa40, 5, 0.8, -9);
          this.smoke.spawn(g.x, 1.4, g.z, 8, 0x202020, 0.8, 2.5, 0.6, 0.6);
          if (me && me.role === 'killer') this.marker(g.x, 1.5, g.z, 'gen');
          break;
        }
        case 'noise': if (me && me.role === 'killer') this.marker(e.x, 1.2, e.z, 'noise'); break;
        case 'powered': sound.play('powered'); this.feed('The exit gates are powered! Escape before the night closes in.', 'big'); break;
        case 'gateopen': { const g = this.M.gates[e.id]; sound.play('gateopen', g.x, g.z); this.feed('An exit gate has been opened!', 'big'); break; }
        case 'escaped': sound.play('escaped'); this.feed(name(e.id) + ' escaped.'); this.petReact(e.id, 'cheer', 3); break;
        case 'infected': {
          this.sparks.spawn(e.x, 0.6, e.z, 60, 0x9aff3a, 3, 1.6, 0.4, 1.2); this.smoke.spawn(e.x, 0.8, e.z, 12, 0x1a3a10, 1, 2.5, 0.6, 0.8);
          sound.play('caged', e.x, e.z);
          if (e.id === this.myId) { this.feed('You have turned! Hunt down the survivors.', 'big'); this.flash = 0.8; this.shake = 1; }
          break;
        }
        case 'pounce': sound.play('swing', e.x, e.z); sound.play('grunt', e.x, e.z, { pitch: 1.6 }); break;
        case 'pounce-hit': sound.play('hit', e.x, e.z); this.blood.spawn(e.x, 1.0, e.z, 45, 0x6a0303, 3, 1.2, -9.8, 1.2); if (e.id === this.myId) { this.shake = 0.9; this.flash = 0.5; this.feed('Chucky pounced on you!', 'big'); } break;
        case 'pounce-wall': sound.play('thud', e.x, e.z); this.sparks.spawn(e.x, 0.6, e.z, 12, 0xffffff, 2, 0.4, -6); if (e.id === this.myId) { this.shake = 0.7; this.feed('You slammed into a wall.'); } break;
        case 'pounce-land': sound.play('thud', e.x, e.z); break;
        case 'bearset': sound.play('click', e.x, e.z); if (e.id === this.myId) this.feed('Bear trap set.'); break;
        case 'bearclose': sound.play('thunk', e.x, e.z); break;
        case 'bearsnap': {
          sound.play('thunk', e.x, e.z); sound.play('scream', e.x, e.z, { pitch: pitchOf(e.id), len: 1.2 });
          this.blood.spawn(e.x, 0.3, e.z, 40, 0x6a0303, 2.2, 0.8, -9.8, 1); if (this.decals) this.decals.add(e.x, e.z, 0.7, 0);
          const bm = this.bearMeshes && [...this.bearMeshes.values()].find(m => Math.hypot(m.position.x - e.x, m.position.z - e.z) < 0.2);
          if (e.id === this.myId) { this.feed('You stepped in a bear trap!', 'big'); this.shake = 0.7; this.flash = 0.4; }
          else if (e.by === this.myId) this.feed(name(e.id) + ' is caught in your trap.', 'big');
          this.petReact(e.id, 'panic', 2.5);
          void bm; break;
        }
        case 'hearyou': {
          const p = S && playerById(S, e.id);
          if (e.id === this.myId) this.feed(e.ids.length ? `You hear ${e.ids.length} of them. Your next hit on them puts them down.` : 'Silence. For now.');
          else if (this.mine() && e.ids.includes(this.myId)) { this.feed('Granny heard you! Her next hit will put you down.', 'big'); this.shake = 0.3; sound.play('fade', e.x, e.z, { on: true }); }
          else if (this.mine() && this.mine().role === 'survivor') { this.feed('Granny is listening… keep quiet.', 'big'); sound.play('fade', p ? p.x : e.x, p ? p.z : e.z, { on: true }); }
          break;
        }
        case 'rush': {
          sound.play('swing', e.x, e.z); sound.play('roar', e.x, e.z, { pitch: 1.3 });
          if (e.id === this.myId) this.shake = 0.25 + (e.charge || 0) * 0.3;
          break;
        }
        case 'rushhit': {
          sound.play('thunk', e.x, e.z); this.blood.spawn(e.x, 1.1, e.z, 40, 0x6a0303, 2.6, 1.2, -9.8, 0.8);
          if (e.id === this.myId) { this.shake = 0.8; if (this.view) this.view.userData.bloody = 1; }
          break;
        }
        case 'bodyswap': {
          for (const [x, z] of [[e.x0, e.z0], [e.x1, e.z1]]) { this.smoke.spawn(x, 0.8, z, 22, 0x0a0a0a, 1.0, 1.8, 0.4, 0.9); sound.play('fade', x, z, { on: true }); }
          if (e.id === this.myId) { this.teleFx = 1; this.feed('Body Swap!'); }
          else if (this.mine() && this.mine().role === 'survivor' && Math.hypot(this.mine().x - e.x1, this.mine().z - e.z1) < 20) this.feed('Granny crawled out of nowhere…', 'big');
          break;
        }
        case 'rushvault': sound.play('break', e.x, e.z); this.sparks.spawn(e.x, 1.2, e.z, 20, 0xc8b090, 2, 0.6, -8, 0.6); if (e.id === this.myId) this.shake = 0.5; break;
        case 'rushsmash': this.sparks.spawn(e.x, 0.8, e.z, 30, 0xb08858, 2.5, 0.8, -9, 0.8); if (e.id === this.myId) this.shake = 0.6; break;
        case 'slam': {
          sound.play('thud', e.x, e.z); sound.play('kick', e.x, e.z);
          this.smoke.spawn(e.x, 0.3, e.z, 30, 0x6a5a48, 2.2, 1.2, 0.2, 1.4);
          if (e.id === this.myId) { this.shake = 1.0; this.flash = 0.25; this.feed(e.hit.length ? `Ground Slam! ${e.hit.length} struck.` : 'Ground Slam!'); }
          else if (this.mine() && e.hit.includes(this.myId)) this.shake = 0.8;
          break;
        }
        case 'rushwall': {
          sound.play('thud', e.x, e.z); sound.play('stun', e.x, e.z);
          if (e.id === this.myId) { this.feed('Into the wall!'); this.shake = 0.9; }
          break;
        }
        case 'creep': {
          this.smoke.spawn(e.x, 1, e.z, 16, 0x0a0a0a, 1.1, 2, 0.5, 1); sound.play('fade', e.x, e.z, { on: true });
          if (e.id === this.myId) this.teleFx = 1;
          break;
        }
        case 'spidermom': {
          sound.play('scream', e.x, e.z, { pitch: 2.2, len: 0.5 });
          const me2 = this.mine();
          if (e.id === this.myId) { this.feed('Spider Mom saw you and webbed you! Granny knows where you are.', 'big'); this.shake = 0.25; }
          else if (me2 && me2.role === 'killer' && me2.char === 'granny') this.feed('Spider Mom found ' + name(e.id) + ' at a generator.');
          { const t = S && playerById(S, e.id); if (t) this.smoke.spawn(t.x, 0.8, t.z, 18, 0xe8e8e0, 0.8, 1.2, 0.2, 0.6); }
          break;
        }
        case 'laugh': {
          sound.play('laugh', e.x, e.z);
          const c = this.chars.get(e.id); if (c) c.laughAt = this.t;
          if ((e.ids || []).includes(this.myId)) { this.feed('"Hi, I\'m Chucky. Wanna play?" He heard you. You are revealed.', 'big'); this.flash = 0.2; }
          else if (e.id === this.myId) this.feed((e.ids || []).length ? `${(e.ids || []).length} survivor${(e.ids || []).length === 1 ? '' : 's'} revealed.` : 'Nobody close enough to hear.');
          break;
        }
        case 'sawthrow': { const p = S && playerById(S, e.id); sound.play('chainsaw', e.x, e.z); if (p && p.id !== this.myId) this.feed('Chainsaw!'); break; }
        case 'sawhit': sound.play('chainsaw', e.x, e.z); this.blood.spawn(e.x, 1.2, e.z, 70, 0x6a0303, 3.4, 1.4, -9.8, 1.4); if (e.id === this.myId) { this.shake = 1; this.flash = 0.8; this.feed('The chainsaw cut you down!', 'big'); } break;
        case 'sawland': sound.play('thud', e.x, e.z); this.sparks.spawn(e.x, 0.2, e.z, 14, 0xffd080, 2, 0.4, -9); break;
        case 'sawpickup': if (e.id === this.myId) this.feed(e.back ? 'Your chainsaw is back in your hand.' : 'Chainsaw picked up.'); break;
        case 'card': {
          sound.play('card', e.x, e.z);
          if ((e.ids || []).includes(this.myId)) { this.feed('"Look at that subtle off-white coloring. The tasteful thickness of it." You are intimidated: slowed and revealed.', 'big'); this.flash = 0.25; }
          else if (e.id === this.myId) this.feed((e.ids || []).length ? `Business card: ${(e.ids || []).length} intimidated.` : 'Nobody saw your card.');
          break;
        }
        case 'chainland': sound.play('thud', e.x, e.z); this.smoke.spawn(e.x, 0.3, e.z, 10, 0x2a2622, 1.4, 1.2, 0.3, 0.6); if (e.id === this.myId) this.shake = 0.8; break;
        case 'pulse': if (me && me.role === 'survivor' && me.st === 'ok') { this.feed('The infected can sense you…', 'big'); this.flash = 0.2; } else if (me && me.role === 'killer') this.feed('You sense the living.'); break;
        case 'exposed': if (me && me.role === 'survivor') this.feed(`${name(e.by)}'s Exposure: the killer is revealed!`, e.by === this.myId ? 'big' : ''); if (e.id === this.myId) this.feed('Exposed! The survivors can see you.', 'big'); break;
        case 'overclock': this.sparks.spawn(e.x, 1.5, e.z, 30, 0x8affff, 2, 0.8, -6); if (me && me.role === 'survivor') this.feed('Overclock: another generator jumped ahead.'); break;
        case 'laststand': if (e.id === this.myId) { this.feed('You are the last survivor! Survive 45 seconds.', 'big'); this.flash = 0.4; } sound.play('powered'); break;
        case 'drop': { const b = this.M.bars[e.id]; sound.play('drop', b.x, b.z); this.smoke.spawn(b.x, 0.3, b.z, 6, 0x5a5048, 1.2, 1.5, 0.3, 1.2); break; }
        case 'break': { const b = this.M.bars[e.id]; sound.play('break', b.x, b.z); this.blood.spawn(b.x, 0.6, b.z, 40, 0x6a4a30, 4, 1.2, -9, 1.5); break; }
        case 'stun': { this.petReact(e.id, 'jump', 1); const p = S && playerById(S, e.id); if (p) { sound.play('stun', p.x, p.z); this.sparks.spawn(p.x, 2.2, p.z, 12, 0xffffff, 1.5, 0.6, 0); } if (e.id === this.myId) this.shake = 0.8; this.feed(name(e.id) + ' was stunned!'); break; }
        case 'kick': { const g = this.M.gens[e.id]; sound.play('kick', g.x, g.z); this.sparks.spawn(g.x, 1.0, g.z, 25, 0xffd080, 3, 0.6, -9); break; }
        case 'vault': if (e.id !== this.myId) sound.play('vault', e.x, e.z, { fast: e.fast }); break;
        case 'struggle': {
          const c = this.M.cages[e.cage]; if (c) { sound.play('fade', c.x, c.z, { on: true }); this.sparks.spawn(c.x, 0.4, c.z, 40, 0xff3010, 2, 1.6, 1.2); }
          if (e.id === this.myId) { this.feed('The Entity has come for you! Hit the skill checks to hold it off.', 'big'); this.flash = 0.4; }
          break;
        }
        case 'caged': { const c = this.M.cages[e.cage]; sound.play('caged', c.x, c.z); this.sparks.spawn(c.x, 0.3, c.z, 50, 0xff5020, 3, 1.5, 1); break; }
        case 'died': {
          if (e.how === 'executed' || e.how === 'bled out') this.decals.add(e.x, e.z, 2.2, 1);
          if (e.how === 'sacrificed' && e.cage >= 0) { const c = this.M.cages[e.cage]; this.decals.add(c.x, c.z, 1.9, 1); this.decals.add(c.x + 0.6, c.z - 0.4, 1.0, 0); this.smoke.spawn(c.x, 0.5, c.z, 40, 0x0a0a0a, 1.5, 3.5, 1.2, 0.6); this.sparks.spawn(c.x, 1.2, c.z, 80, 0xff3010, 3, 2, 2); }
          sound.play('sacrifice');
          if (e.id === this.myId) this.feed('You did not survive the night.', 'big');
          break;
        }
        case 'rescued': if (e.by !== -1) this.feed(name(e.id) + ' was freed by ' + name(e.by) + '.'); break;
        case 'wiggle-free': this.feed(name(e.id) + ' struggled free!'); sound.play('stun', e.x, e.z); break;
        case 'pickup': { this.petReact(e.id, 'panic', 4); this.petReact(e.by, 'cheer', 1.5); const p = S && playerById(S, e.id); if (p) sound.play('pickup', p.x, p.z, { pitch: pitchOf(e.id) }); break; }
        case 'healed': this.petReact(e.id, 'cheer', 1.5); if (e.id === this.myId || e.by === this.myId) sound.play('heal'); break;
        case 'throw': sound.play('throw', e.x, e.z); break;
        case 'spearend': sound.play('thunk', e.x, e.z); this.blood.spawn(e.x, e.y, e.z, 10, 0x8a7a60, 2, 0.6); break;
        case 'fade': { const p = S && playerById(S, e.id); if (p) sound.play('fade', p.x, p.z, { on: e.on }); break; }
        case 'rampage': { const p = S && playerById(S, e.id); if (p) sound.play('roar', p.x, p.z); break; }
        case 'exec': { const p = S && playerById(S, e.id); if (p) sound.play('caged', p.x, p.z); if (e.id === this.myId) this.feed('You are being executed…', 'big'); break; }
        case 'escfail': if (e.id === this.myId) this.feed(`You failed to unhook yourself (${e.left} attempts left) and lost some time.`); break;
        case 'whiff': this.petSay(e.id, 'cock', 25); break;
        case 'sc': if (e.r === 'miss') this.petSay(e.id, Math.random() < 0.6 ? 'shit' : 'cock', 15); if (e.r === 'miss' && e.id !== this.myId) { const p = S && playerById(S, e.id); if (p) sound.play('genfail', p.x, p.z); } break;
      }
    }
  }
  // dynamic resolution + FPS counter
  perf(dt) {
    const real = this.lastNow ? (performance.now() - this.lastNow) / 1000 : 1 / 60;
    this.lastNow = performance.now();
    this.ftAvg += (Math.min(0.2, real) - this.ftAvg) * 0.05;
    this.fpsN++; this.fpsT += real;
    if (this.fpsT > 0.5) { if (this.settings.showFps) $('fps').textContent = Math.round(this.fpsN / this.fpsT) + ' FPS · ' + (this.pr * 100).toFixed(0) + '% res'; this.fpsN = 0; this.fpsT = 0; }
    if (this.settings.dynres === false) return;
    this.drT += real;
    if (this.drT < 1.2) return;
    this.drT = 0;
    const fps = 1 / this.ftAvg;
    let pr = this.pr;
    if (fps < 42 && pr > this.q.minPixel) pr = Math.max(this.q.minPixel, pr - 0.1);
    else if (fps > 58 && pr < this.q.pixel) pr = Math.min(this.q.pixel, pr + 0.05);
    if (pr !== this.pr) { this.pr = pr; this.renderer.setPixelRatio(pr); this.renderer.setSize(innerWidth, innerHeight); if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(innerWidth, innerHeight); } }
  }

  splat(op = 1) {
    const el = $('splat'); if (!el) return;
    el.style.setProperty('--sp', op);
    el.style.transform = `rotate(${(Math.random() * 40 - 20).toFixed(0)}deg) scale(${(0.9 + Math.random() * 0.3).toFixed(2)})`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  feed(text, cls = '') {
    const el = document.createElement('div');
    el.className = 'feed-item ' + cls; el.textContent = text;
    $('feed').prepend(el);
    setTimeout(() => el.classList.add('out'), 4500);
    setTimeout(() => el.remove(), 5200);
    while ($('feed').children.length > 5) $('feed').lastChild.remove();
  }
  marker(x, y, z, kind) {
    const el = document.createElement('div');
    el.className = 'marker ' + kind;
    $('markers').appendChild(el);
    this.markers.push({ el, x, y, z, t: 0 });
  }

  // ---------------- HUD ----------------
  buildStaticHUD(S) {
    const me = playerById(S, this.myId);
    const perkDefs = me.role === 'killer' ? KILLER_PERKS : SURV_PERKS;
    $('perks').innerHTML = me.perks.map(k => perkDefs[k] ? `<div class="diamond ${me.role === 'killer' ? 'k' : ''}" title="${esc(perkDefs[k].name)}: ${esc(perkDefs[k].desc)}">${icon(k)}</div>` : '').join('');
    $('power').classList.toggle('hidden', me.role !== 'killer');
    $('crosshair').classList.toggle('hidden', me.role !== 'killer');
    $('item').classList.toggle('hidden', me.role !== 'survivor' || me.st === 'ghost');
    this.renderItemHUD(me);
    const teamOf = p => (p.role === 'survivor' && (p.st !== 'ghost' || p.id === this.myId)) || p.disguise || p.outcome === 'infected';
    $('team').classList.toggle('compact', S.players.filter(teamOf).length > 5);
    $('team').innerHTML = S.players.filter(teamOf).map(p =>
      `<div class="tm ${p.id === this.myId ? 'me' : ''}" id="tm-${esc(p.id)}"><div class="tm-por">${icon('healthy')}</div><div class="tm-body"><div class="tm-name">${esc(p.name)}${p.bot ? '<small>BOT</small>' : ''}${p.id === this.myId ? '<small>YOU</small>' : ''}</div><div class="tm-stage"><i></i><i></i></div><div class="tm-bar"><div></div></div></div></div>`).join('');
    this.hudCache = {};
    const k = (x) => `<kbd>${x}</kbd>`;
    $('controls-hint').innerHTML = me.disguise
      ? `${k(moveLabel(this.settings))} move · ${k('LMB')} strike · ${k(keyLabel(this.settings, 'interact'))} pick up / hook · ${k(keyLabel(this.settings, 'space'))} vault · ${k(keyLabel(this.settings, 'item'))} let go (after a down and a hook) · ${k(keyLabel(this.settings, 'status'))} status`
      : me.st === 'ghost'
      ? `${k(moveLabel(this.settings))} move · ${k(keyLabel(this.settings, 'interact'))} repair generators · nobody can see you`
      : me.role === 'killer'
      ? `${k(moveLabel(this.settings))} move · ${k('LMB')} strike · ${k('RMB')} ${esc(KILLERS[me.char].ability.name)}${me.char === 'lamplighter' ? ` · ${k(keyLabel(this.settings, 'ability2'))} Shadow Step` : KILLERS[me.char].ability2 ? ` · ${k(keyLabel(this.settings, 'ability2'))} ${esc(KILLERS[me.char].ability2.name)}` : ''} · ${k(keyLabel(this.settings, 'interact'))} interact · ${k(keyLabel(this.settings, 'execute'))} execute · ${k(keyLabel(this.settings, 'space'))} ${me.char === 'chucky' ? 'jump' : 'vault'}${me.char === 'chucky' ? ` · ${k(keyLabel(this.settings, 'item'))} possess · ${k(keyLabel(this.settings, 'split'))} soul split` : ''} · ${k(keyLabel(this.settings, 'drop'))} drop · ${k(keyLabel(this.settings, 'status'))} status`
      : `${k(moveLabel(this.settings))} move · ${k(keyLabel(this.settings, 'run'))} run · ${k(keyLabel(this.settings, 'crouch'))} crouch · ${k(keyLabel(this.settings, 'interact'))} interact · ${k('RMB')} flashlight · ${k(keyLabel(this.settings, 'item'))} ghost trap · ${k(keyLabel(this.settings, 'space'))} vault / barricade / skill check · ${k(keyLabel(this.settings, 'emotes'))} emotes · ${k(keyLabel(this.settings, 'status'))} status`;
    $('controls-hint').classList.remove('fade');
    clearTimeout(this.hintT); this.hintT = setTimeout(() => $('controls-hint').classList.add('fade'), 14000);
    $('fps').classList.toggle('hidden', !this.settings.showFps);
  }
  setText(id, v) { if (this.hudCache[id] !== v) { this.hudCache[id] = v; $(id).innerHTML = v; } }

  powerHTML(me) {
    if (me.disguise) {
      const done = me.pdowns >= 1 && me.pcages >= 1;
      return { ready: done, active: true, pct: 0, html: `<div class="pwt"><div class="pwn">Possession</div><div class="pws">Down ${Math.min(1, me.pdowns)}/1 · Hook ${Math.min(1, me.pcages)}/1</div><div class="keyl">${done ? '' + kbd('item') + ' let go of the body' : 'Nobody knows it\'s you'}</div></div><div class="pwi">${icon('knife')}<div class="cd"></div></div>` };
    }
    const K = KILLERS[me.char], def = K.ability;
    let ready = false, pct = 0, sub = '', pips = '', extra = '';
    if (me.char === 'butcher') {
      ready = me.charges > 0 && !me.ab;
      pct = me.charges >= def.charges ? 0 : 1 - me.chargeT / def.cooldown;
      sub = me.ab ? 'Charging!' : me.charges ? 'Ready' : 'Recovering';
      pips = Array.from({ length: def.charges }, (_, i) => `<i class="${i < me.charges ? 'on' : ''}"></i>`).join('');
      extra = 'Gore Trail · injured survivors bleed for you';
    } else if (me.char === 'wisp') {
      ready = !me.ab && me.abCd <= 0;
      pct = me.ab ? 0 : me.abCd / def.cooldown;
      sub = me.ab === 1 ? 'Faded' : me.ab === 2 ? 'Fading…' : me.ab === 3 ? 'Reappearing…' : me.ambush > 0 ? `Ambush! ${me.ambush.toFixed(1)}s` : me.abCd > 0 ? Math.ceil(me.abCd) + 's' : 'Ready';
      extra = 'Ambush lunge after reappearing';
    } else if (me.char === 'harrower') {
      ready = me.ammo > 0 && me.abCd <= 0;
      pct = me.ammo >= def.ammo ? 0 : 1 - me.ammoT / def.reload;
      sub = me.aim ? 'Aiming…' : `${me.ammo} spear${me.ammo === 1 ? '' : 's'}`;
      pips = Array.from({ length: def.ammo }, (_, i) => `<i class="${i < me.ammo ? 'on' : ''}"></i>`).join('');
      extra = 'Trophy Mark · speared prey is revealed';
    } else if (me.char === 'foreman') {
      const d2 = K.ability2;
      ready = me.abCd <= 0 && !me.pull;
      pct = me.abCd / def.cooldown;
      sub = me.pull ? 'Reeling…' : me.aim ? 'Aiming…' : me.abCd > 0 ? Math.ceil(me.abCd) + 's' : 'Ready';
      extra = me.ab ? `Lights Out · ${Math.ceil(me.abT)}s · one hit downs` : me.ab2Cd > 0 ? `${kbd('ability2')} Lights Out ${Math.ceil(me.ab2Cd)}s` : '' + kbd('ability2') + ' Lights Out ready';
    } else if (me.char === 'chucky') {
      const coil = me.aim ? Math.min(1, Math.max(0, (me.abT || 0) - 0.1) / def.coil) : 0;
      ready = me.abCd <= 0 && !me.leap; pct = me.aim ? 1 - coil : me.abCd / def.cooldown;
      sub = me.leap ? 'Pouncing!' : me.aim ? `Coiling… ${Math.round(def.min + (def.max - def.min) * coil)}m` : me.abCd > 0 ? Math.ceil(me.abCd) + 's' : 'Ready';
      const mm = t => Math.floor(t / 60) + ':' + String(Math.ceil(t % 60)).padStart(2, '0');
      extra = (me.ab2Cd > 0 ? `${kbd('ability2')} Laugh ${Math.ceil(me.ab2Cd)}s` : "" + kbd('ability2') + " Laugh ready") + ' · ' + (me.harmless ? 'Possessing…' : me.possCd > 0 ? `${kbd('item')} Possess ${mm(me.possCd)}` : '' + kbd('item') + ' Possess ready');
      const S = this.S, oneLeft = S && !S.gatesPowered && S.gensNeeded - S.gensDone === 1 && (S.dolls || []).length;
      if (!me.split) extra += oneLeft ? ' · ' + kbd('split') + ' <b>Soul Split ready</b>' : ' · Soul Split: last generator';
    } else if (me.char === 'bateman') {
      const d2 = K.ability2, held = me.ammo > 0;
      ready = held && me.abCd <= 0; pct = held ? me.abCd / def.cooldown : 1;
      sub = !held ? 'Go get your chainsaw' : me.aim ? (me.abT >= def.aim ? 'Release to throw!' : 'Revving…') : me.abCd > 0 ? Math.ceil(me.abCd) + 's' : 'Ready';
      extra = me.haste > 0 ? `Morning Routine · +12% speed` : me.ab2Cd > 0 ? `${kbd('ability2')} Business Card ${Math.ceil(me.ab2Cd)}s` : '' + kbd('ability2') + ' Business Card ready';
    } else if (me.char === 'granny') {
      const T = K.teleport;
      const charge = Math.max(0, Math.min(1, (me.abT - def.minCharge) / (def.maxCharge - def.minCharge)));
      ready = me.abCd <= 0 && !me.dash; pct = me.aim ? 1 - charge : me.abCd / def.cooldown;
      const heard = this.S ? this.S.players.filter(o => o.role === 'survivor' && o.heard > 0).length : 0;
      sub = me.dash ? 'Rushing!' : me.aim ? (me.abT < def.minCharge ? 'Winding up…' : `Release! ${Math.round(def.minDist + charge * (def.maxDist - def.minDist))}m`) : me.abCd > 0 ? Math.ceil(me.abCd) + 's' : 'Ready · hold RMB';
      if (heard) sub += ` · ${heard} Heard`;
      const SW = K.swap;
      const swapTxt = !this.S.spider ? '' : this.swapHeld ? ' · Spider Mom\'s eyes: release V to swap' : me.swapCd > 0 ? ` · <kbd>V</kbd> ${SW.name} ${Math.ceil(me.swapCd)}s` : ` · <kbd>V</kbd> ${SW.name} ready`;
      extra = (me.tele ? 'Creeping…' : me.teleCd > 0 ? `${kbd('item')} Creep ${Math.ceil(me.teleCd)}s` : `Hold ${kbd('item')} Creep (teleport) ready`) + ' · ' + (me.ab === 1 ? 'Listening…' : me.ab2Cd > 0 ? `${kbd('ability2')} I Hear You ${Math.ceil(me.ab2Cd)}s` : '' + kbd('ability2') + ' I Hear You ready') + swapTxt;
      void T;
    } else if (me.char === 'slimer') {
      const n = (this.S.slime || []).length;
      ready = me.abCd <= 0; pct = me.abCd / def.cooldown;
      sub = me.abCd > 0 ? Math.ceil(me.abCd) + 's' : `${n}/${def.max} puddles`;
      pips = Array.from({ length: def.max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
      extra = me.phase > 0 ? `Ghost Phase · ${me.phase.toFixed(1)}s` : me.ab2Cd > 0 ? `${kbd('ability2')} Ghost Phase ${Math.ceil(me.ab2Cd)}s` : '' + kbd('ability2') + ' Ghost Phase ready';
    } else {
      const n = (this.S.lanterns || []).length;
      ready = me.abCd <= 0;
      pct = me.abCd / def.cooldown;
      sub = `${n}/${def.max} lanterns lit`;
      pips = Array.from({ length: def.max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
      extra = me.tele ? 'Stepping through shadow…' : me.teleCd > 0 ? `Shadow Step ${Math.ceil(me.teleCd)}s` : '' + kbd('ability2') + ' Shadow Step ready';
    }
    return { ready, active: !!me.ab || !!me.tele || me.ambush > 0, pct: Math.max(0, Math.min(1, pct)),
      html: `<div class="pwt"><div class="pwn">${esc(def.name)}</div><div class="pws">${sub}</div>${pips ? `<div class="pips">${pips}</div>` : ''}<div class="keyl">${extra}</div></div><div class="pwi">${icon(POWER_ICON[me.char])}<div class="cd"></div></div>` };
  }

  // the survivor's item card (changes when you swap at a chest)
  renderItemHUD(me) {
    this.hudItem = me.item;
    $('item').innerHTML = this.itemHTML(me);
  }
  itemHTML(me) {
    if (me.item === 'taser') return `<div class="iti">${icon('taser')}</div><div class="itt"><div class="itn">Taser <span id="trapn"></span></div><div class="keyl"><kbd>RMB</kbd> fire at the killer (3s stun)</div></div>`;
    return me.item === 'trap' ? `<div class="iti">${icon('gen')}</div><div class="itt"><div class="itn">Ghost Trap <span id="trapn"></span></div><div class="keyl">${kbd('item')} set a trap in front of you</div></div>`
      : `<div class="iti">${icon('flashlight')}</div><div class="itt"><div class="itn">${SURVIVORS[me.char] && SURVIVORS[me.char].gb ? 'Proton Stream' : 'Flashlight'}</div><div class="itb"><div></div></div><div class="keyl"><kbd>RMB</kbd> hold to blind the killer</div></div>`;
  }
  updateHUD(dt, S, me) {
    if (!me) return;
    if (me.role === 'survivor' && me.item !== this.hudItem) this.renderItemHUD(me);
    // flashlight battery, and the killer's view whiting out when a torch is in his eyes
    if (me.role === 'survivor') {
      const bar = $('item').querySelector('.itb div');
      if (bar) bar.style.width = (Math.max(0, me.flash) / RULES.flashBattery * 100).toFixed(1) + '%';
      $('item').classList.toggle('active', !!this.flashHeld && me.flash > 0);
      $('item').classList.toggle('empty', me.item === 'trap' ? !(me.traps > 0) : me.item === 'taser' ? !(me.tasers > 0) : me.flash <= 0);
      const tn = document.getElementById('trapn'); if (tn) tn.textContent = '×' + ((me.item === 'taser' ? me.tasers : me.traps) || 0);
      $('crosshair').classList.toggle('hidden', !((this.flashHeld && me.flash > 0) || (me.item === 'taser' && me.tasers > 0 && me.st === 'ok')));
    }
    const glare = me.role === 'killer' ? Math.max((me.glare || 0) * 0.75, me.blind > 0 ? Math.min(1, me.blind / 1.2) : 0) : 0;
    if (Math.abs(glare - (this.glareShown || 0)) > 0.01) { this.glareShown = glare; $('glare').style.opacity = glare.toFixed(2); }
    // objective
    const left = Math.max(0, S.gensNeeded - S.gensDone);
    const obj = !S.gatesPowered
      ? `<div class="oi">${icon('gen')}</div><div><div class="on">${left}</div><div class="ol">Generator${left === 1 ? '' : 's'} left</div></div>`
      : `<div class="oi">${icon('gate')}</div><div><div class="ol" style="color:var(--gold)">Exit gates powered</div><div class="ol">The night falls in ${Math.ceil(S.collapse)}s</div><div class="collapse"><div style="width:${(S.collapse / RULES.collapse * 100).toFixed(1)}%"></div></div></div>`;
    let clock = '';
    const mm = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
    if (S.mode === 'rush' && S.timer > 0) clock = `<div class="mode-clock${S.timer < 30 ? ' low' : ''}">Survivor Rush · ${mm(S.timer)}</div>`;
    else if (S.mode === 'infection' && S.lastStand && S.timer > 0) clock = `<div class="mode-clock low">Last stand · ${mm(S.timer)}</div>`;
    else if (S.mode && S.mode !== 'classic' && MODES[S.mode]) clock = `<div class="mode-clock">${MODES[S.mode].name}</div>`;
    this.setText('objective', obj.replace('class="collapse"><div style="width:', 'class="collapse"><div style="max-width:100%;width:') + clock);
    $('objective').classList.toggle('powered', !!S.gatesPowered);
    // team
    for (const p of S.players) {
      const el = $('tm-' + p.id);
      if (!el) continue;
      if (p.role !== 'survivor' && !p.disguise) { if (el.dataset.st !== 'infected') { el.dataset.st = 'infected'; el.className = 'tm dead infected' + (p.id === this.myId ? ' me' : ''); el.querySelector('.tm-por').innerHTML = icon(POWER_ICON[p.char] || 'warrant'); } continue; }
      const state = p.st === 'ok' ? (p.hp === 2 ? 'healthy' : 'injured') : p.st;
      if (el.dataset.st !== state) { el.dataset.st = state; el.className = 'tm ' + state + (p.id === this.myId ? ' me' : ''); el.querySelector('.tm-por').innerHTML = icon(STATE_ICON[state] || 'healthy'); }
      let f = 0;
      if (p.st === 'caged') f = p.cageT / p.cageMax; else if (p.st === 'down') f = p.bleed / RULES.bleedout; else if (p.st === 'carried') f = p.wig;
      el.querySelector('.tm-bar').style.visibility = f > 0 ? 'visible' : 'hidden';
      el.querySelector('.tm-bar div').style.width = (f * 100).toFixed(1) + '%';
      el.querySelectorAll('.tm-stage i').forEach((pp, i) => pp.classList.toggle('on', p.stage > i));
    }
    // killer power + attack recovery ring
    if (me.role === 'killer') {
      const pw = this.powerHTML(me);
      this.setText('power', pw.html);
      $('power').classList.toggle('ready', pw.ready && !pw.active);
      $('power').classList.toggle('active', pw.active);
      const cd = $('power').querySelector('.cd'); if (cd) cd.style.setProperty('--p', (pw.pct * 100).toFixed(1) + '%');
      const cs = (this.chars.get(me.id) || {}).st || {};
      let ring = 0;
      if (me.atk === 2) ring = 1 - (cs.recF || 0);
      else if (me.atk === 1) ring = 1;
      $('cr-fill').style.strokeDashoffset = (88 * (1 - ring)).toFixed(1);
      $('crosshair').classList.toggle('hitrec', me.atk === 2 && me.atkHit);
      $('crosshair').classList.toggle('ambush', me.ambush > 0);
    }
    // prompt / progress / status
    let prompt = [], prog = -1, label = '', status = '';
    const kp = (key, txt) => prompt.push(`<span class="pr"><kbd>${esc(key)}</kbd>${esc(txt)}</span>`);
    if (S.phase === 'play') {
      if (me.role === 'survivor') {
        if (me.st === 'ok') {
          if (me.act) {
            prog = me.prog;
            label = { repair: 'Repairing', heal: 'Healing', self: 'Self-care', rescue: 'Unhooking', gate: 'Opening gate', snuff: 'Snuffing lantern' }[me.act.k] || '';
            if (me.act.k === 'rescue' || me.act.k === 'snuff') prog = (me.act.t || 0) / actionTime(me.act.k, me, S);
          } else {
            const it = findInteraction(this.M, S, me);
            const sp = findSpace(this.M, S, me);
            if (it) kp(keyLabel(this.settings, 'interact'), it.label);
            if (sp) kp(keyLabel(this.settings, 'space'), sp.k === 'drop' ? 'Drop barricade' : 'Vault');
          }
          if (me.healP > 0 && me.hp === 1 && !me.act) { label = 'Being healed'; prog = me.healP; }
          if (me.mark > 0) status = `Marked <small>The Harrower can see you · ${Math.ceil(me.mark)}s</small>`;
          if (me.card > 0) status = `Intimidated <small>Slowed and revealed · ${Math.ceil(me.card)}s</small>`;
        } else if (me.st === 'ghost') {
          if (me.act) { prog = me.prog; label = 'Repairing (as a ghost)'; }
          else { const it = findInteraction(this.M, S, me); if (it) kp(keyLabel(this.settings, 'interact'), it.label); }
          status = 'You are a ghost<small>Chucky took your body. Nobody can see you. Repair generators (10% slower) until he lets go.</small>';
        } else if (me.st === 'down') {
          status = me.healP > 0 ? 'Being helped up' : 'You are dying<small>Crawl to safety — a teammate can help you up</small>';
          if (me.healP > 0) { prog = me.healP; label = 'Recovering'; }
          if (me.turn > 0) { status = `Turning…<small>You rise as a killer in ${Math.ceil(me.turn)}s</small>`; prog = 1 - me.turn / 3; label = 'Infection'; }
        } else if (me.st === 'exec') {
          const K = playerById(S, me.execBy) || killerOf(S);
          status = (K ? esc(KILLERS[K.char].exec.name) : 'Execution');
        } else if (me.st === 'carried') {
          status = `Struggle!<small>Alternate ${kbd('left')} ${kbd('right')} to break free</small>`; prog = me.wig; label = 'Wiggle';
        } else if (me.st === 'caged') {
          status = `Hooked<small>${Math.ceil(me.cageT)}s left${me.stage === 1 && me.esc < 3 ? ` · ${kbd('space')} try to unhook yourself (${3 - me.esc} left)` : me.stage >= 2 ? ' · hit the skill checks to fight off the Entity' : ''}</small>`;
          prog = me.cageT / me.cageMax; label = me.stage >= 2 ? 'Struggle phase' : 'Hooked';
        } else if (me.st === 'dead' || me.st === 'out') {
          const tb = this.takeoverTarget();
          status = (me.st === 'out' ? 'You escaped' : 'You were ' + esc(me.outcome || 'sacrificed')) + (this.spectate ? `<small>Spectating ${esc(this.spectate.name)} · click to switch</small>` : '')
            + (tb ? `<small class="takeover">${kbd('takeover')} Take over ${esc(tb.name.replace(/ \(bot\)$/, ''))} and keep playing</small>` : '');
        }
      } else {
        if (me.act) { prog = me.prog; label = { pickup: 'Picking up', cage: 'Hooking', kick: 'Damaging generator', break: 'Breaking barricade', execute: KILLERS[me.char] ? KILLERS[me.char].exec.name : 'Execution' }[me.act.k] || ''; }
        else if (me.stun > 0) status = 'Stunned';
        else if (me.tele) { status = 'Shadow Step'; prog = me.tele.t / RULES.teleTime; label = 'Stepping'; }
        else {
          const it = findInteraction(this.M, S, me);
          const sp = findSpace(this.M, S, me);
          if (it) kp(keyLabel(this.settings, 'interact'), it.label);
          const ex = findExecute(this.M, S, me);
          if (ex) kp(keyLabel(this.settings, 'execute'), ex.label);
          if (sp) kp(keyLabel(this.settings, 'space'), 'Vault');
          if (me.carry != null) { kp(keyLabel(this.settings, 'drop'), 'Drop survivor'); const s2 = playerById(S, me.carry); if (s2) { status = `Carrying ${esc(s2.name)}<small>Find a hook before they struggle free</small>`; prog = s2.wig; label = 'Their struggle'; } }
          if (me.atk === 2 && me.atkHit) status = '<small>Wiping your weapon…</small>';
        }
      }
    }
    if (S.dark > 0 && me.role === 'survivor' && !status && me.st === 'ok') status = 'Lights Out<small>Don\'t run. He hunts by sound.</small>';
    this.setText('prompt', prompt.join(''));
    this.setText('status', status);
    this.setText('progress-label', esc(label));
    $('progress').classList.toggle('hidden', prog < 0);
    if (prog >= 0) $('progress-fill').style.width = (Math.min(1, prog) * 100).toFixed(1) + '%';
    // screen fx
    const injured = me.role === 'survivor' && me.st === 'ok' && me.hp === 1;
    const down = me.role === 'survivor' && (me.st === 'down' || me.st === 'caged' || me.st === 'exec');
    this.flash = Math.max(0, this.flash - dt * 2);
    const redT = injured ? 0.35 + Math.sin(this.t * 3) * 0.1 : down ? 0.65 : 0;
    this.redV = (this.redV || 0) + (redT - (this.redV || 0)) * Math.min(1, dt * 3);
    const pulse = (this.terrorI || 0) * (0.5 + 0.5 * Math.sin(this.t * (4 + (this.terrorI || 0) * 6)));
    if (this.post) {
      const u = this.post.uniforms;
      u.red.value = this.redV; u.flash.value = this.flash; u.pulse.value = pulse;
      u.desat.value += ((down ? 0.6 : me.st === 'dead' ? 0.8 : me.role === 'killer' ? 0.12 : 0.08) - u.desat.value) * Math.min(1, dt * 2);
      $('fx-red').style.opacity = '0'; $('fx-vignette').style.opacity = '0';
    } else {
      $('fx-red').style.opacity = Math.min(1, this.redV + this.flash * 0.8 + pulse * 0.15).toFixed(2);
      $('fx-vignette').style.opacity = '1';
    }
    // Wisp frost: survivors near a faded Wisp
    const K = nearestKiller(S, me);
    let frost = 0;
    if (K && K.char === 'wisp' && me.role === 'survivor' && ['ok', 'down', 'caged'].includes(me.st) && K.ab !== 0) {
      const d = dist(K, me); frost = Math.max(0, 1 - d / 14);
      this.whisperT = (this.whisperT || 0) - dt;
      if (frost > 0.15 && this.whisperT <= 0) { this.whisperT = 2.5 + Math.random() * 2; sound.play('whisper', undefined, undefined, { vol: frost }); }
    }
    this.frostV = (this.frostV || 0) + (frost - (this.frostV || 0)) * Math.min(1, dt * 2);
    $('fx-frost').style.opacity = (this.frostV * 0.9).toFixed(2);
    // Lamplighter's teleport fade
    const tele = me.role === 'killer' && me.tele ? Math.min(1, me.tele.t / RULES.teleTime) : 0;
    this.teleFx = Math.max(tele, (this.teleFx || 0) - dt * 2.5);
    $('fx-tele').style.opacity = this.teleFx.toFixed(2);
    // noise markers
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.t += dt;
      if (m.t > 3.5) { m.el.remove(); this.markers.splice(i, 1); continue; }
      const v = new THREE.Vector3(m.x, m.y, m.z).project(this.camera);
      const behind = v.z > 1;
      let sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
      if (behind) { sx = innerWidth - sx; sy = innerHeight - 40; }
      sx = Math.max(30, Math.min(innerWidth - 30, sx)); sy = Math.max(30, Math.min(innerHeight - 30, sy));
      m.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%,-50%) scale(${1 + m.t * 0.15})`;
      m.el.style.opacity = String(Math.max(0, 1 - m.t / 3.5));
    }
    const cine = killersOf(S).some(k => k.act && k.act.k === 'execute' && (k.id === me.id || k.act.id === me.id));
    $('hud').classList.toggle('dead', me.st === 'dead' || !!cine);
    $('hud').classList.toggle('cine', !!cine);
  }

  renderScoreboard() {
    const S = this.S;
    if (!S) return;
    const rows = S.players.filter(p => p.st !== 'ghost' || p.id === this.myId).map(p => {
      if (p.disguise) p = { ...p, role: 'survivor' };
      const state = p.role === 'killer' ? null : p.st === 'ok' ? (p.hp === 2 ? 'healthy' : 'injured') : p.st;
      const st = p.role === 'killer' ? 'Killer' : { healthy: 'Healthy', injured: 'Injured', exec: 'Being executed', down: 'Dying', carried: 'Carried', caged: 'Hooked', dead: 'Dead', out: 'Escaped', ghost: 'Ghost' }[state];
      const sc = Math.round(p.score.a + p.score.b + p.score.c + p.score.d);
      const cname = p.role === 'killer' ? KILLERS[p.char].name : SURVIVORS[p.char].name;
      return `<tr class="${p.id === this.myId ? 'me' : ''}"><td>${icon(p.role === 'killer' ? POWER_ICON[p.char] : STATE_ICON[state])}</td><td>${esc(p.name)}${p.bot ? ' <small>BOT</small>' : ''}</td><td>${esc(cname)}</td><td>${st}</td><td>${sc}</td></tr>`;
    }).join('');
    $('scoreboard').innerHTML = `<table><tr><th></th><th>Player</th><th>Character</th><th>Status</th><th>Embers</th></tr>${rows}</table>`;
  }

  showResults(S) {
    this.endShown = true;
    if (document.pointerLockElement) { this.skipPause = true; document.exitPointerLock(); }
    $('pause').classList.add('hidden');
    const me = playerById(S, this.myId);
    const cats = { survivor: ['Objectives', 'Altruism', 'Survival', 'Boldness'], killer: ['Brutality', 'Deviousness', 'Hunter', 'Sacrifice'] };
    const rows = S.players.map(p => {
      const c = cats[p.role];
      const tot = Math.round(p.score.a + p.score.b + p.score.c + p.score.d);
      const out = p.role === 'killer' ? p.outcome : p.outcome === 'escaped' ? 'Escaped' : p.outcome === 'executed' ? 'Executed' : 'Sacrificed';
      const cls = p.role === 'killer' ? 'killer' : p.outcome === 'escaped' ? 'esc' : 'dead';
      const ic = p.role === 'killer' ? POWER_ICON[p.char] : p.outcome === 'escaped' ? 'out' : p.outcome === 'executed' ? 'exec' : 'dead';
      return `<div class="res ${cls} ${p.id === this.myId ? 'me' : ''}"><div class="rp">${icon(ic)}</div><div class="res-name">${esc(p.name)}<small>${esc(p.role === 'killer' ? KILLERS[p.char].name : SURVIVORS[p.char].name)}</small></div>
        <div class="res-out">${esc(out)}</div>
        <div class="res-cats">${['a', 'b', 'c', 'd'].map((k, i) => `<span>${c[i]}<b>${Math.round(p.score[k])}</b></span>`).join('')}</div>
        <div class="res-tot">${tot}<small>embers</small></div></div>`;
    }).join('');
    let title = 'Match Over';
    if (me) title = me.role === 'killer' ? me.outcome : me.outcome === 'escaped' ? 'You Escaped' : me.outcome === 'executed' ? 'You Were Executed' : 'You Were Sacrificed';
    $('results-title').textContent = title;
    $('results-list').innerHTML = rows + this.killerReport(S);
    $('results').classList.remove('hidden');
    if (this.o.onEnd) this.o.onEnd(S, me);
  }

  // end screen: how much damage each killer did, and who did the most
  killerReport(S) {
    const Ks = S.players.filter(p => p.role === 'killer' || (p.score && (p.score.hits || p.score.hooks)));
    if (!Ks.length) return '';
    const st = p => { const c = p.score || {}; return { dmg: c.dmg || 0, hits: c.hits || 0, downs: c.downs || 0, hooks: c.hooks || 0, kills: c.kills || 0, execs: c.execs || 0 }; };
    // ranking: kills first, then damage dealt, then hooks
    const rank = Ks.map(p => ({ p, s: st(p) })).sort((a, b) => b.s.kills - a.s.kills || b.s.dmg - a.s.dmg || b.s.hooks - a.s.hooks);
    const best = rank[0], tie = rank.length > 1 && rank[1].s.kills === best.s.kills && rank[1].s.dmg === best.s.dmg && rank[1].s.hooks === best.s.hooks;
    const name = p => esc(p.name) + (p.role === 'killer' && KILLERS[p.char] && p.name !== KILLERS[p.char].name ? ` <small>${esc(KILLERS[p.char].name)}</small>` : '');
    const rowsK = rank.map(({ p, s }, i) => `<tr class="${i === 0 && !tie && (s.dmg || s.kills) ? 'top' : ''}${p.id === this.myId ? ' me' : ''}"><td>${i === 0 && !tie && (s.dmg || s.kills) ? '👑 ' : ''}${name(p)}</td><td>${s.dmg}</td><td>${s.hits}</td><td>${s.downs}</td><td>${s.hooks}</td><td>${s.kills}${s.execs ? ` <small>(${s.execs} exec)</small>` : ''}</td></tr>`).join('');
    const verdict = !best.s.dmg && !best.s.kills ? 'No killer drew blood this match.'
      : tie ? 'Dead even: no killer did more than the others.'
      : rank.length > 1 ? `${esc(best.p.name)} did the most damage${best.s.kills ? ` and took ${best.s.kills} ${best.s.kills === 1 ? 'life' : 'lives'}` : ''}.`
      : `${esc(best.p.name)} dealt ${best.s.dmg} damage${best.s.kills ? ` and took ${best.s.kills} ${best.s.kills === 1 ? 'life' : 'lives'}` : ''}.`;
    return `<div class="killer-report"><h3>Killer damage</h3><p>${verdict}</p><table><thead><tr><th>Killer</th><th title="Health states taken from survivors">Damage</th><th>Hits</th><th>Downs</th><th>Hooks</th><th>Kills</th></tr></thead><tbody>${rowsK}</tbody></table></div>`;
  }

  onResize() {
    if (!this.camera) return;
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    if (this.composer) this.composer.setSize(innerWidth, innerHeight);
  }

  dispose() {
    this.disposed = true;
    this.unbind();
    if (document.pointerLockElement) { this.skipPause = true; document.exitPointerLock(); }
    sound.stopAll();
    if (this.hud) this.hud.classList.add('hidden');
    $('pause').classList.add('hidden');
    $('scoreboard').classList.add('hidden');
    if (this.skillCanvas) this.skillCanvas.classList.add('hidden');
    $('markers').innerHTML = '';
    if (this.scene) this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    if (this.composer && this.composer.dispose) this.composer.dispose();
    for (const id of ['fx-red', 'fx-frost', 'fx-tele']) $(id).style.opacity = '0';
  }
}


// the execution's bear trap: the Granny bear trap model (its clip snaps the jaws shut), or the
// procedural one while it loads. userData.close(k): 0 open .. 1 shut
function makeExecTrap() {
  const m = cloneStatic('beartrap');
  const clip = m && m.userData.anims && m.userData.anims[0];
  if (!m || !clip) {
    const g = makeBearTrap();
    g.userData.close = k => { for (const j of g.userData.jaws) j.rotation.x = j.userData.sd * 1.25 * (1 - k); };
    return g;
  }
  const mixer = new THREE.AnimationMixer(m), a = mixer.clipAction(clip);
  a.play(); a.paused = true; a.clampWhenFinished = true;
  m.userData.close = k => { a.time = Math.max(0, Math.min(1, k)) * clip.duration * 0.999; mixer.update(0); };
  m.userData.close(0);
  m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return m;
}
// a bear trap: rusty base, pressure plate, two toothed jaws (g.userData.jaws, open at rotation.x = ±1.25, shut at 0)
function makeBearTrap() {
  const g = new THREE.Group(), jaws = [];
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4440, metalness: 0.75, roughness: 0.45 }), rust = new THREE.MeshStandardMaterial({ color: 0x5a3020, metalness: 0.4, roughness: 0.8 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 18), rust); base.position.y = 0.015; g.add(base);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 12), steel); plate.position.y = 0.04; g.add(plate);
  for (const sd of [-1, 1]) {
    const jaw = new THREE.Group(); jaw.position.set(0, 0.03, 0); jaw.rotation.x = sd * 1.25; jaw.userData.sd = sd; g.add(jaw); jaws.push(jaw);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.012, 6, 16, Math.PI), steel); arc.rotation.y = sd > 0 ? 0 : Math.PI; jaw.add(arc);
    for (let i = 1; i < 8; i++) { const a = i / 8 * Math.PI, tooth = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 4), steel); tooth.position.set(Math.cos(a) * 0.21, 0.025, Math.sin(a) * 0.21 * (sd > 0 ? 1 : -1)); jaw.add(tooth); }
  }
  g.userData.jaws = jaws;
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// a survivor item as a small model (chests, hands): flashlight, ghost trap, taser
function itemModel(k) {
  if (k === 'taser') { const m = cloneStatic('taser'); if (m) { m.scale.setScalar(1.9); return m; } }
  if (k === 'trap') { const m = cloneStatic('ghosttrap'); if (m) { m.scale.setScalar(0.75); m.position.y = -0.12; return m; } }
  const g = new THREE.Group();
  if (k === 'taser') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.2), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 })); g.add(body);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.04), new THREE.MeshStandardMaterial({ color: 0xd8e020, emissive: 0x6a7000 })); tip.position.z = 0.11; g.add(tip);
    return g;
  }
  if (k === 'trap') { const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.2), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.6 })); g.add(b); return g; }
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.22, 10), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, metalness: 0.6, roughness: 0.4 })); body.rotation.x = Math.PI / 2; g.add(body);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.03, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0xffffe0, emissive: 0xfff0a0, emissiveIntensity: 1.2 })); lens.rotation.x = Math.PI / 2; lens.position.z = 0.13; g.add(lens);
  return g;
}
