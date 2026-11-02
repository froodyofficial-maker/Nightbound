// 3D main-menu scene: survivors around a campfire, the killer waiting in red fog.
import * as THREE from 'three';
import { SURVIVORS, skinOf } from './config.js';
import { tex } from './textures.js';
import { mat, makeSurvivor, makeKiller, animate, treeGeos, pineGeo, rockGeo, makeCage } from './models.js';
import { rng } from './map.js';

const VIEWS = {
  survivor: { pos: new THREE.Vector3(3.6, 1.45, 4.6), look: new THREE.Vector3(-1.1, 0.75, -0.2) },
  killer: { pos: new THREE.Vector3(-4.7, 1.5, -6.2), look: new THREE.Vector3(-7.5, 1.45, -9.9) },
};

export class MenuScene {
  constructor(quality = 'medium') {
    const hiQ = quality === 'high' || quality === 'medium';
    this.q = quality;
    const R = rng(1234);
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07080c);
    scene.fog = new THREE.FogExp2(0x0a0b10, 0.055);
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
    this.mode = 'survivor'; this.t = 0;
    this.camPos = VIEWS.survivor.pos.clone(); this.camLook = VIEWS.survivor.look.clone();

    scene.add(new THREE.HemisphereLight(0x4a5a88, 0x201410, 1.1));
    scene.add(new THREE.AmbientLight(0x30303a, 0.6));
    const moon = new THREE.DirectionalLight(0x8aa0d8, 0.55); moon.position.set(-10, 20, 6); scene.add(moon);

    // ground
    const gt = tex('ground');
    const gmat = mat(0x6a6858, { map: 'ground', rough: 1 });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(70, 48), gmat);
    gt.map.repeat.set(30, 30); if (gt.normalMap) gt.normalMap.repeat.set(30, 30);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

    // campfire: stones, logs, fire light
    const rockM = mat(0x6a6864, { map: 'rock' });
    const rg = rockGeo(3);
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2, s = 0.17 + R() * 0.07;
      const r = new THREE.Mesh(rg, rockM); r.position.set(Math.cos(a) * 0.62, s * 0.5, Math.sin(a) * 0.62); r.scale.set(s, s * 0.8, s); r.rotation.y = R() * 6; scene.add(r);
    }
    const logM = mat(0x4a3a2a, { map: 'bark' }), charM = mat(0x1a1210, { emissive: 0x4a1200, ei: 1 });
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.9, 8), i % 2 ? logM : charM);
      l.position.set(0, 0.14, 0); l.rotation.set(Math.PI / 2 - 0.35, i * Math.PI / 2 + 0.3, 0); scene.add(l);
    }
    // sitting logs
    const seatLogs = [[-0.5, 2.2, 0.35], [2.2, -0.6, 1.9]];
    for (const [x, z, ry] of seatLogs) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 2.6, 12), logM);
      l.position.set(x, 0.26, z); l.rotation.set(0, ry, Math.PI / 2); l.castShadow = true; l.receiveShadow = true; scene.add(l);
    }
    this.fireLight = new THREE.PointLight(0xff8a3a, 30, 22, 1.5);
    this.fireLight.position.set(0, 0.9, 0);
    if (quality === 'high') { this.fireLight.castShadow = true; this.fireLight.shadow.mapSize.set(512, 512); }
    scene.add(this.fireLight);

    // fire particles (sprites)
    const glow = tex('glow').map;
    this.flames = [];
    const nF = hiQ ? 26 : 14;
    for (let i = 0; i < nF; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffa040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      s.userData = { life: R(), speed: 0.7 + R() * 0.7, ox: (R() - 0.5) * 0.35, oz: (R() - 0.5) * 0.35, size: 0.45 + R() * 0.45 };
      scene.add(s); this.flames.push(s);
    }
    // embers
    const n = hiQ ? 80 : 30;
    const eg = new THREE.BufferGeometry(); this.emberPos = new Float32Array(n * 3); this.emberVel = [];
    for (let i = 0; i < n; i++) { this.emberPos.set([(R() - 0.5) * 0.3, R() * 3, (R() - 0.5) * 0.3], i * 3); this.emberVel.push([(R() - 0.5) * 0.25, 0.5 + R() * 0.9, (R() - 0.5) * 0.25]); }
    eg.setAttribute('position', new THREE.BufferAttribute(this.emberPos, 3));
    this.embers = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0xff7a2a, size: 0.05, map: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(this.embers);

    // forest ring
    const pine = pineGeo(4), dead = treeGeos('dead');
    const barkM = mat(0x4a3c30, { map: 'bark' });
    const needleM = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex('foliage').map });
    const trees = [];
    for (let i = 0; i < (hiQ ? 140 : 70); i++) {
      const a = R() * Math.PI * 2, r = 7.5 + Math.pow(R(), 0.6) * 38;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.hypot(x - 3.6, z - 4.6) < 4) continue;
      trees.push({ x, z, s: 0.7 + R() * 0.6, rot: R() * 6, dead: R() < 0.35 });
    }
    const inst = (geo, m, list, f) => {
      const im = new THREE.InstancedMesh(geo, m, list.length); const M4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      list.forEach((t, i) => { q.setFromEuler(new THREE.Euler(0, t.rot, 0)); M4.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s * f, t.s * f * 1.1, t.s * f)); im.setMatrixAt(i, M4); });
      scene.add(im);
    };
    const pines = trees.filter(t => !t.dead), deads = trees.filter(t => t.dead);
    inst(pine.trunk, barkM, pines, 1); inst(pine.leaves, needleM, pines, 1); inst(dead.trunk, barkM, deads, 1.2);

    // survivors around the fire
    this.seats = [
      { x: 1.65, z: -0.55, face: true },   // front-right (featured)
      { x: -0.3, z: 1.65, face: true },
      { x: -1.6, z: 1.05, face: true },
      { x: 2.15, z: 1.0, stand: true },
    ];
    this.survRigs = [];
    this.setSurvivor('mara');

    // killer zone
    this.killerPos = new THREE.Vector3(-6.4, 0, -10.2);
    this.redLight = new THREE.PointLight(0xff2010, 45, 16, 1.4);
    this.redLight.position.set(-7.4, 2.6, -12.5); scene.add(this.redLight);
    this.rimLight = new THREE.SpotLight(0xff4030, 90, 20, 0.5, 0.6, 1.2);
    this.rimLight.position.set(-5.2, 6, -13.5);
    this.faceLight = new THREE.PointLight(0xc8a8a0, 6, 6, 1.5); this.faceLight.position.set(-5.4, 2.2, -8.4); scene.add(this.faceLight); this.rimLight.target.position.copy(this.killerPos); scene.add(this.rimLight); scene.add(this.rimLight.target);
    const cage = makeCage(); cage.position.set(-9.3, 0, -12.4); cage.rotation.z = 0.06; scene.add(cage);
    cage.userData.ring.material.emissiveIntensity = 2.5;
    this.fogSprites = [];
    const fogMat = new THREE.SpriteMaterial({ map: tex('fog').map, color: 0x8a2a2a, transparent: true, opacity: 0.18, depthWrite: false });
    for (let i = 0; i < (hiQ ? 10 : 5); i++) { const s = new THREE.Sprite(fogMat); s.scale.set(8 + R() * 5, 2.5 + R() * 2, 1); s.position.set(-6.4 + (R() - 0.5) * 9, 0.8 + R(), -11 + (R() - 0.5) * 4); s.userData.v = 0.15 + R() * 0.25; scene.add(s); this.fogSprites.push(s); }
    this.setKiller('butcher');
  }

  setSurvivor(char, skin = 'default') {
    for (const r of this.survRigs) this.scene.remove(r.root);
    this.survRigs = [];
    const order = [char, ...Object.keys(SURVIVORS).filter(c => c !== char)];
    order.forEach((c, i) => {
      const seat = this.seats[i]; if (!seat) return;
      const rig = makeSurvivor(SURVIVORS[c], i === 0 ? skinOf(c, skin) : {});
      rig.root.position.set(seat.x, 0, seat.z);
      rig.root.rotation.y = Math.atan2(-seat.x, -seat.z) + (seat.stand ? 0.3 : 0);
      rig.stand = seat.stand; rig.featured = i === 0;
      rig.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(rig.root);
      this.survRigs.push(rig);
    });
  }
  setKiller(char, skin = 'default') {
    this.killerChar = char; this.killerSkin = skin;
    if (this.killerRig) this.scene.remove(this.killerRig.root);
    if (this.lanternLight) { this.scene.remove(this.lanternLight); this.lanternLight = null; }
    const rig = makeKiller(char, skinOf(char, skin));
    rig.root.position.copy(this.killerPos);
    rig.root.rotation.y = Math.atan2(VIEWS.killer.pos.x - this.killerPos.x, VIEWS.killer.pos.z - this.killerPos.z) + 0.15;
    this.scene.add(rig.root);
    this.killerRig = rig;
    if (char === 'lamplighter') { this.lanternLight = new THREE.PointLight(skinOf(char, skin).lamp ?? 0x5aff7a, 8, 7, 1.5); this.scene.add(this.lanternLight); }
    this.redLight.color.setHex(char === 'wisp' ? 0x3a9aff : char === 'lamplighter' ? 0x3aff6a : 0xff2010);
    this.rimLight.color.copy(this.redLight.color);
    for (const s of this.fogSprites) s.material.color.setHex(char === 'wisp' ? 0x3a6a8a : char === 'lamplighter' ? 0x2a6a3a : 0x8a2a2a);
  }
  setMode(m) { this.mode = m; }
  setShift(on) { this.shiftT = on ? 1 : 0; }

  update(dt, renderer) {
    this.t += dt;
    const t = this.t;
    // camera glide
    const v = VIEWS[this.mode];
    const k = 1 - Math.exp(-dt * 2.2);
    // when a side panel is open, pan so the character sits between the menu and the panel
    this.shift = (this.shift || 0) + ((this.shiftT || 0) - (this.shift || 0)) * Math.min(1, dt * 3);
    const dx = v.look.x - v.pos.x, dz = v.look.z - v.pos.z, dl = Math.hypot(dx, dz) || 1;
    const look = v.look.clone(); look.x += (-dz / dl) * this.shift * 1.5; look.z += (dx / dl) * this.shift * 1.5;
    this.camPos.lerp(v.pos, k); this.camLook.lerp(look, k);
    const cam = this.camera;
    cam.position.set(this.camPos.x + Math.sin(t * 0.3) * 0.08, this.camPos.y + Math.sin(t * 0.45) * 0.04, this.camPos.z);
    cam.lookAt(this.camLook);
    cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
    // fire
    this.fireLight.intensity = 28 + Math.sin(t * 13) * 3 + Math.sin(t * 7.3) * 2 + Math.random() * 3;
    this.fireLight.position.x = Math.sin(t * 5) * 0.05;
    for (const s of this.flames) {
      const u = s.userData;
      u.life += dt * u.speed * 1.1;
      if (u.life > 1) { u.life = 0; u.ox = (Math.random() - 0.5) * 0.35; u.oz = (Math.random() - 0.5) * 0.35; }
      const f = u.life;
      s.position.set(u.ox * (1 - f) + Math.sin(t * 4 + u.oz * 20) * 0.04, 0.15 + f * 1.15, u.oz * (1 - f));
      const sz = u.size * (1 - f * 0.7) * (0.5 + Math.min(1, f * 5) * 0.5);
      s.scale.set(sz, sz * 1.5, 1);
      s.material.color.setHSL(0.09 - f * 0.08, 1, 0.55 - f * 0.25);
      s.material.opacity = (1 - f) * 0.9;
    }
    const ep = this.emberPos;
    for (let i = 0; i < this.emberVel.length; i++) {
      const vv = this.emberVel[i];
      ep[i * 3] += (vv[0] + Math.sin(t * 2 + i) * 0.2) * dt; ep[i * 3 + 1] += vv[1] * dt; ep[i * 3 + 2] += vv[2] * dt;
      if (ep[i * 3 + 1] > 3.2) { ep[i * 3] = (Math.random() - 0.5) * 0.3; ep[i * 3 + 1] = 0.2; ep[i * 3 + 2] = (Math.random() - 0.5) * 0.3; }
    }
    this.embers.geometry.attributes.position.needsUpdate = true;
    // characters
    for (const r of this.survRigs) animate(r, { anim: r.stand ? 'idle' : 'sit', speed: 0, t, injured: false }, dt);
    animate(this.killerRig, { anim: 'menace', speed: 0, t }, dt);
    if (this.lanternLight) { const p = new THREE.Vector3(); this.killerRig.j.handL.getWorldPosition(p); this.lanternLight.position.copy(p); this.lanternLight.intensity = 7 + Math.sin(t * 9) * 1.2; }
    this.redLight.intensity = 42 + Math.sin(t * 2.1) * 8;
    for (const s of this.fogSprites) { s.position.x += s.userData.v * dt; if (s.position.x > -1) s.position.x = -12; }
    renderer.render(this.scene, cam);
  }
  dispose() { this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
}
