// Client runtime: rendering, input, camera, HUD, audio. Works the same for host and remote clients.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { KILLERS, SURVIVORS, SURV_PERKS, KILLER_PERKS, RULES, skinOf } from './config.js';
import { buildWorld, updateWorld, pointBlocked, QUALITY } from './world.js';
import { makeSurvivor, makeKiller, animate, makeViewModel, animateView, makeSpear, makeLantern, auraMat } from './models.js';
import { stepMover, startVault } from './movement.js';
import { findInteraction, findSpace, findExecute, vaultDuration, killerOf, playerById, has, terrorRadius, dist, angDiff, fwd, actionTime } from './rules.js';
import { losBlocked } from './map.js';
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
    this.blood = new Particles(this.scene, THREE.NormalBlending, 0.055, 900, 'droplet');
    const lite = this.settings.quality === 'potato' || this.settings.quality === 'low';
    this.decals = new BloodDecals(this.scene, { potato: 40, low: 80, medium: 160, high: 240 }[this.settings.quality] || 120, lite);
    this.blood.onLand = (x, z) => { if (this.decals.landBudget >= 1 && Math.random() < 0.35) { this.decals.landBudget--; this.decals.add(x, z, 0.12 + Math.random() * 0.2, 0); } };
    this.smoke = new Particles(this.scene, THREE.NormalBlending, 1.4, 300);
    // renderer + post
    const r = this.renderer;
    r.shadowMap.enabled = !!q.shadow;
    r.setPixelRatio(q.pixel);
    r.setSize(innerWidth, innerHeight);
    if (q.post) {
      this.composer = new EffectComposer(r);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
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
    if (this.role === 'killer') {
      this.view = makeViewModel(me.char);
      this.view.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.userData.op = o.material.opacity; } });
      this.camera.add(this.view);
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
    this.buildStaticHUD(S);
    sound.ambience(true);
    this.onResize();
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

  onKey(e, down) {
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
      if (e.code === 'KeyG') this.send({ t: 'act', a: 'trap' });
      if (e.code === 'KeyR' && this.mine() && this.mine().char === 'lamplighter') this.send({ t: 'act', a: 'teleport', yaw: this.mine().yaw });
      if (e.code === 'KeyR' && this.mine() && this.mine().char === 'foreman') this.send({ t: 'act', a: 'ability2' });
      if (e.code === 'KeyF' && this.mine() && this.mine().role === 'killer') { const ex = findExecute(this.M, this.S, this.mine()); if (ex) this.send({ t: 'act', a: 'execute', id: ex.id }); }
      if ((e.code === 'KeyA' || e.code === 'KeyD') && this.mine() && this.mine().st === 'carried') {
        if (e.code !== this.lastWigKey) { this.lastWigKey = e.code; this.send({ t: 'act', a: 'wig' }); this.wigFlash = 0.15; }
      }
      if (e.code === 'KeyF' || e.code === 'Digit1') this.cycleSpectate();
      if (e.code === 'KeyT') { const b = this.takeoverTarget(); if (b) this.send({ t: 'act', a: 'takeover', id: b.id }); }
    } else this.keys.delete(e.code);
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
          else if (!down && this.aimHeld) { this.aimHeld = false; this.send({ t: 'act', a: 'chain', yaw: me.yaw }); this.sendIn(); }
        } else if (me.char === 'harrower') {
          if (down && me.abCd <= 0 && me.ammo > 0) { this.aimHeld = true; this.sendIn(); }
          else if (!down && this.aimHeld) { this.aimHeld = false; this.send({ t: 'act', a: 'throw', yaw: me.yaw, pitch: me.pitch }); this.sendIn(); }
        } else if (down) {
          if (me.char === 'butcher' && !me.ab && me.abCd <= 0 && me.charges > 0 && !me.atk && me.carry == null) this.pred.ab = this.t + 0.4;
          this.send({ t: 'act', a: 'ability' });
        }
      }
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
        const forced = (p.role === 'survivor' && p.st !== 'ok' && p.st !== 'down') || !!p.reel || !!p.pull;
        if (!this.me || p.tp !== this.myTp || forced) {
          this.myTp = p.tp;
          this.me = { x: p.x, z: p.z, yaw: this.me ? this.me.yaw : p.yaw, pitch: this.me ? this.me.pitch : 0, vault: null, mv: 0, cr: 0 };
          if (forced) this.me.yaw = p.yaw;
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
    this.handleLocal(dt, S, me);
    this.updateChars(dt, S, me);
    this.updateTorchLight();
    this.updateTraps(S);
    this.updateSlime(S);
    this.updateSpears(dt, S);
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
      this.me = { x: me.x, z: me.z, yaw: me.yaw, pitch: me.pitch, vault: me.vault, mv: me.mv, cr: me.cr };
      this.posTimer -= dt;
      if (this.posTimer <= 0) {
        this.posTimer = 1 / 20;
        this.send({ t: 'pos', x: +me.x.toFixed(3), z: +me.z.toFixed(3), yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), mv: me.mv, cr: me.cr, v: me.vault ? 1 : 0, tp: this.myTp });
      }
    }
    // skill checks
    this.updateSkill(dt, me);
  }

  // ---------------- skill checks ----------------
  updateSkill(dt, me) {
    const working = me.act && (me.act.k === 'repair' || me.act.k === 'heal' || me.act.k === 'self') && me.role === 'survivor';
    if (!working) { if (this.skill) { this.skill = null; this.skillCanvas.classList.add('hidden'); } this.skillCooldown = Math.max(this.skillCooldown, 1.2); return; }
    if (!this.skill) {
      this.skillCooldown -= dt;
      if (this.skillCooldown <= 0 && Math.random() < dt * 0.22) {
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
    if (s.phase === 'done') { s.t2 = (s.t2 || 0) + dt; this.drawSkill(); if (s.t2 > 0.45) { this.skill = null; this.skillCanvas.classList.add('hidden'); this.skillCooldown = 2.5; } }
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
    const K = killerOf(S);
    for (const p of S.players) {
      let c = this.chars.get(p.id);
      if (!c) {
        const rig = p.role === 'killer' ? makeKiller(p.char, skinOf(p.char, p.skin)) : makeSurvivor(SURVIVORS[p.char] || SURVIVORS.mara, skinOf(p.char, p.skin));
        this.scene.add(rig.root);
        c = { rig, x: p.x, z: p.z, yaw: p.yaw, spd: 0, step: 0, vaultT: 0, wasV: false };
        this.chars.set(p.id, c);
      }
      const R = c.rig, local = p.id === this.myId;
      const execing = p.role === 'killer' && p.act && p.act.k === 'execute';
      const hidden = p.st === 'dead' || p.st === 'out' || (local && p.role === 'killer' && !execing);
      R.root.visible = !hidden;
      // smoothing
      const jump = Math.hypot(p.x - c.x, p.z - c.z), ox = c.x, oz = c.z;
      if (local || jump > 4) { c.x = p.x; c.z = p.z; }
      else { const k = 1 - Math.exp(-dt * 16); c.x += (p.x - c.x) * k; c.z += (p.z - c.z) * k; }
      // speed of the smoothed motion (not of raw network updates, which arrive in steps)
      const spd = jump > 4 ? c.spd : Math.min(9, Math.hypot(c.x - ox, c.z - oz) / Math.max(dt, 1e-3));
      c.spd += (spd - c.spd) * Math.min(1, dt * 8);
      c.yaw += angDiff(c.yaw, p.yaw) * (local ? 1 : 1 - Math.exp(-dt * 12));
      if (hidden) continue;
      // footsteps of others
      if (!local && p.mv && !p.cr && !(p.role === 'killer' && (p.char === 'wisp' || p.char === 'slimer'))) {
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
      if (p.role === 'survivor') {
        if (p.st === 'exec') { anim = 'exec'; const kk = K && K.act && K.act.k === 'execute' ? K : null; st.exec = { f: kk ? kk.act.t / RULES.execTime : 1, char: K ? K.char : 'butcher', role: 'victim' }; }
        else if (p.st === 'down') anim = 'down';
        else if (p.st === 'carried') anim = 'carried';
        else if (p.st === 'caged') anim = 'caged';
        else if (vaulting) { anim = 'vault'; const d = p.vault.d || 0.7; y = Math.sin(Math.min(1, c.vaultT / d) * Math.PI) * 0.55; }
        else if (p.act) anim = p.act.k === 'repair' ? 'repair' : (p.act.k === 'heal' || p.act.k === 'self') ? 'heal' : 'work';
        else if (p.cr) anim = c.spd > 0.3 ? 'crouchwalk' : 'crouch';
        else if (!local && (p.mv === 1 || p.mv === 2)) anim = p.mv === 2 ? 'run' : 'walk'; // what the player is doing, not network jitter
        else anim = c.spd > 3.0 ? 'run' : c.spd > (local ? 0.3 : 0.8) ? 'walk' : 'idle';
        st.struggle = p.st === 'carried';
      } else {
        anim = vaulting ? 'vault' : (c.spd > 0.3 || (!local && p.mv >= 1 && p.mv <= 2)) ? 'walk' : 'idle';
        if (vaulting) { const d = p.vault.d || 1.7; y = Math.sin(Math.min(1, c.vaultT / d) * Math.PI) * 0.5; }
        if (execing) st.exec = { f: p.act.t / RULES.execTime, char: p.char, role: 'killer' };
        st.carry = p.carry != null; st.atk = p.atk; st.stun = p.stun > 0; st.act = p.act && p.act.k; st.aim = p.aim; st.rampage = p.char === 'butcher' && p.ab === 1;
        if (p.atk === 1) { c.atkT = (c.atkPrev === 1 ? c.atkT + dt : 0); st.atkF = c.atkT / (RULES.lungeTime * (p.atkAmbush ? 1.4 : 1)); }
        c.atkPrev = p.atk;
        st.atkHit = p.atkHit; st.tele = !!p.tele; st.dark = p.char === 'foreman' && p.ab === 1;
        if (p.atk === 2) { const tot = p.atkHit ? (p.char === 'butcher' && !p.atkT ? 2.2 : RULES.hitCooldown * (has(p, 'relentless') ? 0.65 : 1)) : RULES.missCooldown; st.recF = Math.max(0, Math.min(1, 1 - p.atkT / tot)); }
        c.st = st;
      }
      st.anim = anim;
      const flashOn = p.role === 'survivor' && p.st === 'ok' && !p.act && p.flash > 0 && (local ? !!this.flashHeld : p.flashOn);
      st.flash = flashOn;
      animate(R, st, dt);
      // placement
      R.root.position.set(c.x, y, c.z);
      R.root.rotation.set(0, c.yaw, 0);
      if (anim === 'carried') {
        const kc = K && this.chars.get(K.id);
        if (kc) {
          const f = fwd(kc.yaw), rgt = { x: -Math.cos(kc.yaw), z: Math.sin(kc.yaw) };
          // lying poses pivot at the feet: offset the root so the hips rest on the killer's shoulder
          const sh = K.char === 'butcher' ? 1.78 : 1.62;
          R.root.position.set(kc.x + f.x * 0.12 + rgt.x * 0.7, sh, kc.z + f.z * 0.12 + rgt.z * 0.7);
          R.root.rotation.set(0, kc.yaw + Math.PI / 2, 0);
          if (local) R.root.visible = true;
        }
      } else if (anim === 'exec') {
        const kc = K && this.chars.get(K.id);
        if (kc) {
          const f = st.exec.f, ch = st.exec.char, F = fwd(kc.yaw);
          const sm = (a0, a1) => { const x = Math.max(0, Math.min(1, (f - a0) / (a1 - a0))); return x * x * (3 - 2 * x); };
          let d = 1.05, yy = 0, side = 0;
          if (ch === 'butcher') { d = 1.05 - sm(0.15, 0.25) * 0.35 + sm(0.86, 0.95) * 0.3; yy = (sm(0.18, 0.3) - sm(0.86, 0.93)) * 0.62; }
          else if (ch === 'wisp') { d = 0.72; yy = sm(0.08, 0.4) * 0.95; }
          else if (ch === 'foreman') { const drag = sm(0.55, 0.92); d = 1.1 - sm(0.25, 0.35) * 0.25 - drag * 2.6; yy = sm(0.28, 0.4) * 1.05 - drag * 0.7; side = Math.sin(drag * Math.PI) * 0.9; }
          else { const up = sm(0.42, 0.62) - sm(0.86, 0.95); d = 1.25 - up * 0.3; yy = up * 1.75; side = sm(0.86, 1) * 1.2 + up * 0.95; }
          const rgt = { x: -Math.cos(kc.yaw), z: Math.sin(kc.yaw) };
          R.root.position.set(kc.x + F.x * d + rgt.x * side, yy, kc.z + F.z * d + rgt.z * side);
          R.root.rotation.set(0, ch === 'harrower' && f > 0.42 && f < 0.86 ? kc.yaw + Math.PI / 2 : kc.yaw + Math.PI, 0);
          if (ch === 'wisp') R.setOpacity(f > 0.78 ? Math.max(0.02, 1 - (f - 0.78) / 0.2) : 1);
          if (ch === 'foreman') R.setOpacity(f > 0.72 ? Math.max(0.0, 1 - (f - 0.72) / 0.2) : 1);
          this.execFx(p, K, f, ch, R.root.position);
        }
      } else if (anim === 'caged') {
        const cg = this.M.cages[p.cage];
        if (cg) { R.root.position.set(cg.x, 0.2, cg.z); }
      }
      if (p.role === 'survivor') this.placeTorch(c, R, p, flashOn && R.root.visible);
      // wisp fade
      if (p.role === 'killer' && p.char === 'wisp') {
        const o = p.ab === 1 ? (viewerKiller ? 0.35 : 0.04 + Math.max(0, Math.sin(this.t * 3)) * 0.04) : p.ab ? 0.4 : 1;
        R.setOpacity(o);
      }
    }
    // viewmodel
    if (this.view && me) {
      const c = this.chars.get(me.id), cs = (c && c.st) || {};
      animateView(this.view, { atk: me.atk, atkF: cs.atkF, atkHit: me.atkHit, recF: cs.recF, aim: me.aim, stun: me.stun > 0, rampage: me.char === 'butcher' && me.ab === 1, carry: me.carry != null, act: me.act && me.act.k !== 'execute', speed: c ? c.spd : 0, t: this.t, tele: !!me.tele }, dt);
      this.view.visible = !(me.act && me.act.k === 'execute');
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
    const target = S.dark > 0 ? (me && me.role === 'killer' ? 0.55 : 1) : 0;
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
      const a = new THREE.Vector3(kc.x + rx * 0.35, 1.55, kc.z + rz * 0.35), b = new THREE.Vector3(c.x, 1.25, c.z);
      const mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b);
      const u = g.userData;
      u.link.position.copy(mid); u.link.scale.set(1, Math.max(0.01, len), 1);
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

  // ---------------- camera ----------------
  updateCamera(dt, S, me) {
    const cam = this.camera;
    if (!me) return;
    let target = me;
    if (me.role === 'survivor' && (me.st === 'dead' || me.st === 'out')) {
      if (!this.spectate || !['ok', 'down', 'carried', 'caged'].includes(this.spectate.st)) this.cycleSpectate(true);
      this.spectate = this.spectate ? playerById(S, this.spectate.id) : null;
      target = this.spectate || killerOf(S) || me;
    }
    this.camFocus = target;
    // cinematic camera for executions (killer and victim)
    const K0 = killerOf(S);
    const execVictim = K0 && K0.act && K0.act.k === 'execute' ? playerById(S, K0.act.id) : null;
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
    if (me.role === 'killer') {
      const c = this.chars.get(me.id);
      const eye = me.char === 'butcher' ? 2.15 : me.char === 'wisp' ? 2.1 + Math.sin(this.t * 2) * 0.04 : 2.0;
      const bob = Math.sin(this.t * 8) * 0.035 * Math.min(1, (c?.spd || 0) / 4);
      let vy = 0;
      if (me.vault) { const v = me.vault; vy = Math.sin(Math.min(1, v.t / v.d) * Math.PI) * 0.4; }
      const stunTilt = me.stun > 0 ? Math.sin(this.t * 6) * 0.08 : 0;
      cam.position.set(me.x, eye + bob + vy, me.z);
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
    if (target.role === 'killer') h = 2.2;
    const yaw = this.camYaw, pitch = this.camPitch;
    const dist = target.st === 'caged' ? 3.6 : 3.1;
    const back = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
    const right = { x: -Math.cos(yaw), z: Math.sin(yaw) };
    const piv = { x: fx + right.x * 0.42, y: h, z: fz + right.z * 0.42 };
    // pull in if a wall is in the way
    let dd = dist;
    for (let d = 0.3; d <= dist; d += 0.15) {
      if (pointBlocked(this.M, piv.x + back.x * d, piv.y + back.y * d, piv.z + back.z * d)) { dd = Math.max(0.35, d - 0.25); break; }
    }
    this.camDist = this.camDist === undefined ? dd : (dd < this.camDist ? dd : this.camDist + (dd - this.camDist) * Math.min(1, dt * 4));
    const d = this.camDist;
    cam.position.set(piv.x + back.x * d + sx, Math.max(0.25, piv.y + back.y * d) + sy, piv.z + back.z * d);
    cam.lookAt(piv.x, piv.y + 0.05, piv.z);
    cam.fov = this.settings.fov || 75; cam.updateProjectionMatrix();
    sound.listener(fx, fz, yaw);
  }
  execFx(victim, K, f, ch, pos) {
    const key = victim.id + ':' + (victim.stage || 0);
    if (!this.execFired || this.execFired.key !== key) this.execFired = { key, s: new Set() };
    const once = (k, at, fn) => { if (f >= at && !this.execFired.s.has(k)) { this.execFired.s.add(k); fn(); } };
    const pitch = ({ mara: 1.15, eli: 0.75, june: 1.3, tomas: 0.8 }[victim.char] || 1);
    const mine = victim.id === this.myId || K.id === this.myId;
    const bloodAt = (n, y = 1.1) => { this.blood.spawn(pos.x, pos.y + y, pos.z, n, 0x6a0303, 3.2, 1.4, -9.8, 1.4); this.blood.spawn(pos.x, pos.y + y, pos.z, Math.floor(n / 3), 0x3a0101, 1.2, 1.4, -9.8, 0.5); if (this.decals) this.decals.add(pos.x + (Math.random() - 0.5) * 0.6, pos.z + (Math.random() - 0.5) * 0.6, 0.9 + n / 80, Math.random() < 0.5 ? 0 : 2); };
    if (ch === 'butcher') {
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

  // ghost traps on the ground: a striped box with a glowing slot
  updateTraps(S) {
    this.trapMeshes ||= new Map();
    const live = new Set((S.traps || []).map(t => t.id));
    for (const [id, m] of this.trapMeshes) if (!live.has(id)) { this.scene.remove(m); this.trapMeshes.delete(id); }
    for (const t of S.traps || []) {
      if (this.trapMeshes.has(t.id)) { const m = this.trapMeshes.get(t.id); m.userData.glow.material.opacity = 0.5 + Math.sin(this.t * 6) * 0.3; continue; }
      const g = new THREE.Group(); g.position.set(t.x, 0, t.z);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.3), new THREE.MeshStandardMaterial({ color: 0x2a2c2e, metalness: 0.6, roughness: 0.4 })); body.position.y = 0.07; g.add(body);
      for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.06), new THREE.MeshStandardMaterial({ color: 0xe0b020 })); st.position.set(0, 0.145, s * 0.1); g.add(st); }
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.05), new THREE.MeshBasicMaterial({ color: 0xffe080, toneMapped: false })); slot.position.y = 0.152; g.add(slot);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 4), new THREE.MeshStandardMaterial({ color: 0x111111 })); cord.rotation.z = Math.PI / 2; cord.position.set(0.5, 0.02, 0); g.add(cord);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex ||= (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })(), color: 0xffd060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(0.7); glow.position.y = 0.2; g.add(glow); g.userData.glow = glow;
      this.scene.add(g); this.trapMeshes.set(t.id, g);
    }
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
        if (p.st === 'ok' && (p.reveal > 0 || (has(me, 'scent') && p.hp === 1 && dist(p, me) < 24))) col = 0xff3030;
      } else if (!killerView) {
        if (p.role === 'survivor') {
          const far = dist(p, me) > 6 || me.st === 'dead' || me.st === 'out';
          col = !far ? null : p.st === 'caged' || p.st === 'exec' ? 0xff4a3a : p.st === 'down' ? 0xffa030 : p.st === 'carried' ? 0xff7030 : p.st === 'ok' ? 0xe8d8a0 : null;
        } else if (p.role === 'killer' && ((has(me, 'sixth') && me.sixT < 4 && me.st !== 'dead') || me.st === 'dead' || me.st === 'out')) col = 0xff2020;
      }
      if (p.st === 'dead' || p.st === 'out') col = null;
      if (S.dark > 0 && !killerView && p.role === 'survivor') col = null; // Lights Out: you lose track of each other
      if (c.aura !== col) { c.rig.setAura(col); c.aura = col; }
    }
    // gens
    for (let i = 0; i < this.M.gens.length; i++) {
      const gs = S.gens[i], a = this.W.gens[i].userData.aura, g = this.M.gens[i];
      let on = false, col = 0xffe8a0;
      if (killerView) { if (has(me, 'static') && gs.n > 0 && !gs.done) { on = true; col = 0xffd040; } }
      else if (!gs.done && !S.gatesPowered && !(S.dark > 0)) { on = Math.hypot(g.x - me.x, g.z - me.z) > 6; col = gs.reg ? 0xff6040 : 0xffe8a0; }
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
      const on = S.gatesPowered && !S.gates[i].open && Math.hypot(this.M.gates[i].x - me.x, this.M.gates[i].z - me.z) > 8;
      a.visible = on; if (on) a.material = this.auraMatFor(0xffffff);
    }
  }
  auraMatFor(col) { return auraMat(col); }

  // ---------------- audio ----------------
  updateAudio(dt, S, me) {
    if (!me) return;
    const K = killerOf(S);
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
        case 'slimespit': this.sparks.spawn(e.x, 0.3, e.z, 40, 0x7aff4a, 2, 0.8, 0.3, 1); sound.play('drop', e.x, e.z); break;
        case 'slimed': if (e.id === this.myId) { this.feed('You ran through slime! Slowed and revealed.', 'big'); this.flash = 0.3; } break;
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
        case 'takeover':
          if (e.from === this.myId) this.switchTo(e.to);
          this.feed(`${e.name} took over ${e.was}.`, e.to === this.myId ? 'big' : '');
          break;
        case 'hit': {
          const hc = this.chars.get(e.id); if (hc) hc.hitAt = this.t;
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
        case 'gen':
          sound.play('gen', e.x, e.z);
          this.sparks.spawn(e.x, 1.6, e.z, 60, 0xffc060, 4, 1.2, -6);
          this.feed(e.left > 0 ? `A generator has been repaired. ${e.left} to go.` : 'All required generators repaired!');
          break;
        case 'genfail': {
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
        case 'escaped': sound.play('escaped'); this.feed(name(e.id) + ' escaped.'); break;
        case 'drop': { const b = this.M.bars[e.id]; sound.play('drop', b.x, b.z); this.smoke.spawn(b.x, 0.3, b.z, 6, 0x5a5048, 1.2, 1.5, 0.3, 1.2); break; }
        case 'break': { const b = this.M.bars[e.id]; sound.play('break', b.x, b.z); this.blood.spawn(b.x, 0.6, b.z, 40, 0x6a4a30, 4, 1.2, -9, 1.5); break; }
        case 'stun': { const p = S && playerById(S, e.id); if (p) { sound.play('stun', p.x, p.z); this.sparks.spawn(p.x, 2.2, p.z, 12, 0xffffff, 1.5, 0.6, 0); } if (e.id === this.myId) this.shake = 0.8; this.feed(name(e.id) + ' was stunned!'); break; }
        case 'kick': { const g = this.M.gens[e.id]; sound.play('kick', g.x, g.z); this.sparks.spawn(g.x, 1.0, g.z, 25, 0xffd080, 3, 0.6, -9); break; }
        case 'vault': if (e.id !== this.myId) sound.play('vault', e.x, e.z, { fast: e.fast }); break;
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
        case 'pickup': { const p = S && playerById(S, e.id); if (p) sound.play('pickup', p.x, p.z, { pitch: pitchOf(e.id) }); break; }
        case 'healed': if (e.id === this.myId || e.by === this.myId) sound.play('heal'); break;
        case 'throw': sound.play('throw', e.x, e.z); break;
        case 'spearend': sound.play('thunk', e.x, e.z); this.blood.spawn(e.x, e.y, e.z, 10, 0x8a7a60, 2, 0.6); break;
        case 'fade': { const p = S && playerById(S, e.id); if (p) sound.play('fade', p.x, p.z, { on: e.on }); break; }
        case 'rampage': { const p = S && playerById(S, e.id); if (p) sound.play('roar', p.x, p.z); break; }
        case 'exec': { const p = S && playerById(S, e.id); if (p) sound.play('caged', p.x, p.z); if (e.id === this.myId) this.feed('You are being executed…', 'big'); break; }
        case 'escfail': if (e.id === this.myId) this.feed(`You failed to break free (${e.left} attempts left).`); break;
        case 'sc': if (e.r === 'miss' && e.id !== this.myId) { const p = S && playerById(S, e.id); if (p) sound.play('genfail', p.x, p.z); } break;
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
    $('item').classList.toggle('hidden', me.role !== 'survivor');
    $('item').innerHTML = me.item === 'trap' ? `<div class="iti">${icon('gen')}</div><div class="itt"><div class="itn">Ghost Trap <span id="trapn"></span></div><div class="keyl"><kbd>G</kbd> set a trap in front of you</div></div>`
      : `<div class="iti">${icon('flashlight')}</div><div class="itt"><div class="itn">${SURVIVORS[me.char] && SURVIVORS[me.char].gb ? 'Proton Stream' : 'Flashlight'}</div><div class="itb"><div></div></div><div class="keyl"><kbd>RMB</kbd> hold to blind the killer</div></div>`;
    $('team').innerHTML = S.players.filter(p => p.role === 'survivor').map(p =>
      `<div class="tm ${p.id === this.myId ? 'me' : ''}" id="tm-${esc(p.id)}"><div class="tm-por">${icon('healthy')}</div><div class="tm-body"><div class="tm-name">${esc(p.name)}${p.bot ? '<small>BOT</small>' : ''}${p.id === this.myId ? '<small>YOU</small>' : ''}</div><div class="tm-stage"><i></i><i></i></div><div class="tm-bar"><div></div></div></div></div>`).join('');
    this.hudCache = {};
    const k = (x) => `<kbd>${x}</kbd>`;
    $('controls-hint').innerHTML = me.role === 'killer'
      ? `${k('WASD')} move · ${k('LMB')} strike · ${k('RMB')} ${esc(KILLERS[me.char].ability.name)}${me.char === 'lamplighter' ? ` · ${k('R')} Shadow Step` : me.char === 'foreman' ? ` · ${k('R')} Lights Out` : ''} · ${k('E')} interact · ${k('F')} execute · ${k('Space')} vault · ${k('Q')} drop · ${k('Tab')} status`
      : `${k('WASD')} move · ${k('Shift')} run · ${k('Ctrl')} crouch · ${k('E')} interact · ${k('RMB')} flashlight · ${k('G')} ghost trap · ${k('Space')} vault / barricade / skill check · ${k('Tab')} status`;
    $('controls-hint').classList.remove('fade');
    clearTimeout(this.hintT); this.hintT = setTimeout(() => $('controls-hint').classList.add('fade'), 14000);
    $('fps').classList.toggle('hidden', !this.settings.showFps);
  }
  setText(id, v) { if (this.hudCache[id] !== v) { this.hudCache[id] = v; $(id).innerHTML = v; } }

  powerHTML(me) {
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
      extra = me.ab ? `Lights Out · ${Math.ceil(me.abT)}s · one hit downs` : me.ab2Cd > 0 ? `<kbd>R</kbd> Lights Out ${Math.ceil(me.ab2Cd)}s` : '<kbd>R</kbd> Lights Out ready';
    } else if (me.char === 'slimer') {
      const n = (this.S.slime || []).length;
      ready = me.abCd <= 0; pct = me.abCd / def.cooldown;
      sub = me.abCd > 0 ? Math.ceil(me.abCd) + 's' : `${n}/${def.max} puddles`;
      pips = Array.from({ length: def.max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
      extra = 'Ectoplasmic · silent, small terror radius';
    } else {
      const n = (this.S.lanterns || []).length;
      ready = me.abCd <= 0;
      pct = me.abCd / def.cooldown;
      sub = `${n}/${def.max} lanterns lit`;
      pips = Array.from({ length: def.max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
      extra = me.tele ? 'Stepping through shadow…' : me.teleCd > 0 ? `Shadow Step ${Math.ceil(me.teleCd)}s` : '<kbd>R</kbd> Shadow Step ready';
    }
    return { ready, active: !!me.ab || !!me.tele || me.ambush > 0, pct: Math.max(0, Math.min(1, pct)),
      html: `<div class="pwt"><div class="pwn">${esc(def.name)}</div><div class="pws">${sub}</div>${pips ? `<div class="pips">${pips}</div>` : ''}<div class="keyl">${extra}</div></div><div class="pwi">${icon(POWER_ICON[me.char])}<div class="cd"></div></div>` };
  }

  updateHUD(dt, S, me) {
    if (!me) return;
    // flashlight battery, and the killer's view whiting out when a torch is in his eyes
    if (me.role === 'survivor') {
      const bar = $('item').querySelector('.itb div');
      if (bar) bar.style.width = (Math.max(0, me.flash) / RULES.flashBattery * 100).toFixed(1) + '%';
      $('item').classList.toggle('active', !!this.flashHeld && me.flash > 0);
      $('item').classList.toggle('empty', me.item === 'trap' ? !(me.traps > 0) : me.flash <= 0);
      const tn = document.getElementById('trapn'); if (tn) tn.textContent = '×' + (me.traps || 0);
      $('crosshair').classList.toggle('hidden', !(this.flashHeld && me.flash > 0));
    }
    const glare = me.role === 'killer' ? Math.max((me.glare || 0) * 0.75, me.blind > 0 ? Math.min(1, me.blind / 1.2) : 0) : 0;
    if (Math.abs(glare - (this.glareShown || 0)) > 0.01) { this.glareShown = glare; $('glare').style.opacity = glare.toFixed(2); }
    // objective
    const left = Math.max(0, S.gensNeeded - S.gensDone);
    const obj = !S.gatesPowered
      ? `<div class="oi">${icon('gen')}</div><div><div class="on">${left}</div><div class="ol">Generator${left === 1 ? '' : 's'} left</div></div>`
      : `<div class="oi">${icon('gate')}</div><div><div class="ol" style="color:var(--gold)">Exit gates powered</div><div class="ol">The night falls in ${Math.ceil(S.collapse)}s</div><div class="collapse"><div style="width:${(S.collapse / RULES.collapse * 100).toFixed(1)}%"></div></div></div>`;
    this.setText('objective', obj);
    $('objective').classList.toggle('powered', !!S.gatesPowered);
    // team
    for (const p of S.players) {
      if (p.role !== 'survivor') continue;
      const el = $('tm-' + p.id);
      if (!el) continue;
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
    const kp = (key, txt) => prompt.push(`<span class="pr"><kbd>${key}</kbd>${esc(txt)}</span>`);
    if (S.phase === 'play') {
      if (me.role === 'survivor') {
        if (me.st === 'ok') {
          if (me.act) {
            prog = me.prog;
            label = { repair: 'Repairing', heal: 'Healing', self: 'Self-care', rescue: 'Freeing', gate: 'Opening gate', snuff: 'Snuffing lantern' }[me.act.k] || '';
            if (me.act.k === 'rescue' || me.act.k === 'snuff') prog = (me.act.t || 0) / actionTime(me.act.k, me, S);
          } else {
            const it = findInteraction(this.M, S, me);
            const sp = findSpace(this.M, S, me);
            if (it) kp('E', it.label);
            if (sp) kp('Space', sp.k === 'drop' ? 'Drop barricade' : 'Vault');
          }
          if (me.healP > 0 && me.hp === 1 && !me.act) { label = 'Being healed'; prog = me.healP; }
          if (me.mark > 0) status = `Marked <small>The Harrower can see you · ${Math.ceil(me.mark)}s</small>`;
        } else if (me.st === 'down') {
          status = me.healP > 0 ? 'Being helped up' : 'You are dying<small>Crawl to safety — a teammate can help you up</small>';
          if (me.healP > 0) { prog = me.healP; label = 'Recovering'; }
        } else if (me.st === 'exec') {
          const K = killerOf(S);
          status = (K ? esc(KILLERS[K.char].exec.name) : 'Execution');
        } else if (me.st === 'carried') {
          status = `Struggle!<small>Alternate <kbd>A</kbd> <kbd>D</kbd> to break free</small>`; prog = me.wig; label = 'Wiggle';
        } else if (me.st === 'caged') {
          status = `Caged<small>${Math.ceil(me.cageT)}s left${me.stage === 1 && me.esc < 3 ? ` · <kbd>Space</kbd> escape attempt (${3 - me.esc} left)` : me.stage >= 2 ? ' · the next caging is fatal' : ''}</small>`;
          prog = me.cageT / me.cageMax; label = 'Struggle phase';
        } else if (me.st === 'dead' || me.st === 'out') {
          const tb = this.takeoverTarget();
          status = (me.st === 'out' ? 'You escaped' : 'You were ' + esc(me.outcome || 'sacrificed')) + (this.spectate ? `<small>Spectating ${esc(this.spectate.name)} · click to switch</small>` : '')
            + (tb ? `<small class="takeover"><kbd>T</kbd> Take over ${esc(tb.name.replace(/ \(bot\)$/, ''))} and keep playing</small>` : '');
        }
      } else {
        if (me.act) { prog = me.prog; label = { pickup: 'Picking up', cage: 'Caging', kick: 'Damaging generator', break: 'Breaking barricade', execute: KILLERS[me.char].exec.name }[me.act.k] || ''; }
        else if (me.stun > 0) status = 'Stunned';
        else if (me.tele) { status = 'Shadow Step'; prog = me.tele.t / RULES.teleTime; label = 'Stepping'; }
        else {
          const it = findInteraction(this.M, S, me);
          const sp = findSpace(this.M, S, me);
          if (it) kp('E', it.label);
          const ex = findExecute(this.M, S, me);
          if (ex) kp('F', ex.label);
          if (sp) kp('Space', 'Vault');
          if (me.carry != null) { kp('Q', 'Drop survivor'); const s2 = playerById(S, me.carry); if (s2) { status = `Carrying ${esc(s2.name)}<small>Find a cage before they struggle free</small>`; prog = s2.wig; label = 'Their struggle'; } }
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
    const K = killerOf(S);
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
    const cine = K && K.act && K.act.k === 'execute' && (K.id === me.id || K.act.id === me.id);
    $('hud').classList.toggle('dead', me.st === 'dead' || !!cine);
    $('hud').classList.toggle('cine', !!cine);
  }

  renderScoreboard() {
    const S = this.S;
    if (!S) return;
    const rows = S.players.map(p => {
      const state = p.role === 'killer' ? null : p.st === 'ok' ? (p.hp === 2 ? 'healthy' : 'injured') : p.st;
      const st = p.role === 'killer' ? 'Killer' : { healthy: 'Healthy', injured: 'Injured', exec: 'Being executed', down: 'Dying', carried: 'Carried', caged: 'Caged', dead: 'Dead', out: 'Escaped' }[state];
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
    $('results-list').innerHTML = rows;
    $('results').classList.remove('hidden');
    if (this.o.onEnd) this.o.onEnd(S, me);
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

