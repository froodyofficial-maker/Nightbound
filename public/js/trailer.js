// The Granny chapter trailer: a short in-engine cinematic (the real house, Granny, Spider Mom and a
// bear trap model), letterboxed, with captions, sound and a title card. Skippable at any time.
import * as THREE from 'three';
import { loadGranny, makeGrannyGlb, animateGranny, loadSpiderMom, makeSpiderMom } from './grannyGlb.js';
import { loadScene, cloneScene } from './sceneGlb.js';
import { sound } from './audio.js';
import { cloneStatic, loadStatic } from './glbModels.js';

const $ = id => document.getElementById(id);
const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// camera moves, captions and events, one entry per shot (seconds)
const SHOTS = [
  { d: 5, text: 'You wake up in her house.', cam: [V(0, 1.6, 29.5), V(0, 2.2, 24)], look: [V(0, 4.5, 0), V(0, 5, 0)] },
  { d: 4.5, text: 'She hears everything.', cam: [V(-7.5, 1.0, 26.5), V(-4.5, 1.0, 26.5)], look: [V(-2, 1.2, 21), V(1, 1.2, 21)], granny: 'walk' },
  { d: 3.2, text: 'Every creak of the floor.', cam: [V(0.9, 0.55, 23.4), V(0.75, 0.45, 23.1)], look: [V(0, 0.05, 22), V(0, 0.05, 22)], trap: true },
  { d: 4.5, text: "And Spider Mom is always watching.", cam: [V(-9, 0.7, 29.5), V(-9, 0.6, 28.6)], look: [V(-9, 0.5, 20), V(-9, 0.5, 20)], spider: true },
  { d: 3, text: '', cam: [V(0.2, 1.5, 24.8), V(0.15, 1.55, 25.2)], look: [V(0, 1.6, 22.5), V(0, 1.7, 22.5)], granny: 'swing' },
  { d: 6.5, title: true, cam: [V(0, 2.2, 29.5), V(0, 2.6, 27.5)], look: [V(0, 6, 0), V(0, 6.3, 0)] },
];

let playing = null;
export function trailerPlaying() { return !!playing; }

// opens the trailer: a "click to watch" card first (browsers only allow sound after a click)
export function showTrailer(onDone, autoplay = false) {
  const T = $('trailer');
  T.innerHTML = '';
  T.classList.remove('hidden');
  const done = () => { stop(); T.classList.add('hidden'); T.innerHTML = ''; onDone && onDone(); };
  const start = () => { T.innerHTML = ''; play(T, done); };
  if (autoplay) { start(); return; }
  const b = document.createElement('button'); b.className = 'tr-start';
  b.innerHTML = '<small>New chapter · Available now</small><div class="granny-art"></div><div class="play">▶</div><b>Watch the Granny trailer</b>';
  b.onclick = () => { sound.init(); start(); };
  const skip = document.createElement('button'); skip.className = 'btn tr-skip'; skip.textContent = 'Skip'; skip.onclick = done;
  T.append(b, skip);
}

function stop() {
  if (!playing) return;
  cancelAnimationFrame(playing.raf);
  try { playing.r.dispose(); } catch (_) {}
  removeEventListener('keydown', playing.key);
  playing = null;
}

async function play(T, done) {
  const loadingEl = document.createElement('div'); loadingEl.className = 'tr-text show'; loadingEl.textContent = '…';
  T.appendChild(loadingEl);
  const ok = await Promise.race([Promise.all([loadGranny(), loadSpiderMom(), loadScene('granny_map'), loadStatic('beartrap').then(() => true)]).then(a => a.every(Boolean)), new Promise(r => setTimeout(() => r(false), 20000))]);
  if (!ok) { done(); return; }
  T.innerHTML = '';
  const r = new THREE.WebGLRenderer({ antialias: true });
  r.setPixelRatio(Math.min(1.5, devicePixelRatio || 1)); r.setSize(innerWidth, innerHeight);
  r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.45;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  T.appendChild(r.domElement);
  const bars = document.createElement('div'); bars.className = 'tr-bars'; T.appendChild(bars);
  const text = document.createElement('div'); text.className = 'tr-text'; T.appendChild(text);
  const stat = document.createElement('div'); stat.className = 'tr-static'; T.appendChild(stat);
  const flash = document.createElement('div'); flash.className = 'tr-flash'; T.appendChild(flash);
  const title = document.createElement('div'); title.className = 'tr-title';
  title.innerHTML = '<p>Chapter VIII</p><div class="tr-logo"></div><h1 class="tr-x"><i>×</i>Nightbound</h1><p>Available now</p><ul><li>New killer: Granny</li><li>Her helper: Spider Mom</li><li>New map: Granny\'s House</li></ul>';
  T.appendChild(title);
  const skip = document.createElement('button'); skip.className = 'btn tr-skip'; skip.textContent = 'Skip ▸'; skip.onclick = done; T.appendChild(skip);
  // static noise texture for the Spider Mom shot
  const nc = document.createElement('canvas'); nc.width = nc.height = 128; const nx = nc.getContext('2d');

  // ---------- the set ----------
  const sc = new THREE.Scene(); sc.background = new THREE.Color(0x05070b); sc.fog = new THREE.FogExp2(0x0b0f16, 0.04);
  sc.add(new THREE.HemisphereLight(0x52607a, 0x120a06, 0.85));
  const moon = new THREE.DirectionalLight(0xb8c8f0, 2.2); moon.position.set(-14, 26, 22); moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048);
  Object.assign(moon.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 }); sc.add(moon);
  sc.add(cloneScene('granny_map', false));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshStandardMaterial({ color: 0x1a1e14, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; sc.add(ground);
  for (const [x, y, z, c, i] of [[1, 3, 15, 0xffa850, 25], [-6, 2.5, 8, 0xff9a40, 10], [6, 2.5, 4, 0xffa850, 10]]) { const l = new THREE.PointLight(c, i, 16, 1.5); l.position.set(x, y, z); sc.add(l); }
  const G = makeGrannyGlb({}); sc.add(G.root); G.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const S = makeSpiderMom(false); if (S) { sc.add(S.root); S.root.visible = false; }
  const sLight = new THREE.PointLight(0xc8d8ff, 0, 6, 1.6); sc.add(sLight);
  // a bear trap (two serrated jaws)
  const trap = new THREE.Group(); trap.position.set(0, 0.02, 22); sc.add(trap);
  // (hidden outside its own shot)
  const steel = new THREE.MeshStandardMaterial({ color: 0x5a544e, metalness: 0.8, roughness: 0.4 });
  trap.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 18), new THREE.MeshStandardMaterial({ color: 0x5a3020, roughness: 0.8 })));
  const jaws = [];
  for (const sd of [-1, 1]) {
    const j = new THREE.Group(); j.position.y = 0.03; trap.add(j); jaws.push([j, sd]);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.013, 6, 18, Math.PI), steel); arc.rotation.y = sd > 0 ? 0 : Math.PI; j.add(arc);
    for (let i = 1; i < 8; i++) { const a = i / 8 * Math.PI, t = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.06, 4), steel); t.position.set(Math.cos(a) * 0.21, 0.03, Math.sin(a) * 0.21 * sd); j.add(t); }
  }
  // the Granny bear trap model, when it has loaded (its clip snaps the jaws shut)
  let trapClose = null;
  const tm = cloneStatic('beartrap'), tclip = tm && tm.userData.anims && tm.userData.anims[0];
  if (tm && tclip) {
    trap.children.slice().forEach(c => trap.remove(c)); jaws.length = 0; trap.add(tm);
    const mx = new THREE.AnimationMixer(tm), act = mx.clipAction(tclip); act.play(); act.paused = true;
    trapClose = k => { act.time = k * tclip.duration * 0.999; mx.update(0); }; trapClose(0);
  }
  const tl = new THREE.PointLight(0xffc890, 6, 3, 1.5); tl.position.set(0.4, 0.8, 22.6); sc.add(tl);
  const cam = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 300);
  const onResize = () => { r.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); };
  addEventListener('resize', onResize);

  const total = SHOTS.reduce((a, s) => a + s.d, 0);
  let t0 = performance.now(), last = t0, shotIdx = -1, fired = new Set();
  const key = e => { if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); removeEventListener('resize', onResize); done(); } };
  addEventListener('keydown', key);
  playing = { r, raf: 0, key };
  sound.ambience && sound.ambience(true);
  const once = (k, fn) => { if (!fired.has(k)) { fired.add(k); fn(); } };

  const frame = now => {
    if (!playing) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = (now - t0) / 1000;
    if (t >= total) { removeEventListener('resize', onResize); done(); return; }
    let acc = 0, i = 0; while (i < SHOTS.length - 1 && t >= acc + SHOTS[i].d) { acc += SHOTS[i].d; i++; }
    const sh = SHOTS[i], f = (t - acc) / sh.d, e = ease(f);
    if (i !== shotIdx) {
      shotIdx = i; text.classList.remove('show');
      if (sh.text) setTimeout(() => { if (playing && shotIdx === i) { text.textContent = sh.text; text.classList.add('show'); } }, 350);
      title.classList.toggle('show', !!sh.title);
      G.root.visible = !!sh.granny; S.root.visible = false; sLight.intensity = 0; stat.style.opacity = '0';
    }
    cam.position.lerpVectors(sh.cam[0], sh.cam[1], e);
    cam.lookAt(new THREE.Vector3().lerpVectors(sh.look[0], sh.look[1], e));
    // shot 2: Granny walks past the porch
    if (sh.granny === 'walk') { G.root.position.set(-4.5 + f * 6, 0, 21.2); G.root.rotation.y = Math.PI / 2; animateGranny(G, { speed: 1.3 }, dt); once('steps', () => sound.play('step', undefined, undefined, { vol: 0.6 })); }
    // shot 5: close up, she raises the bat... cut to black on the swing
    if (sh.granny === 'swing') {
      G.root.position.set(0, 0, 22.5); G.root.rotation.y = 0;
      animateGranny(G, f < 0.35 ? { speed: 0 } : { atk: 1, atkF: Math.min(1, (f - 0.35) * 1.6) }, dt);
      if (f > 0.82) { flash.style.background = '#000'; flash.style.opacity = '1'; once('swing', () => { sound.play('thunk'); sound.play('hit', undefined, undefined, { down: true }); }); }
    } else { flash.style.opacity = sh.title ? '0' : flash.style.opacity === '1' ? '0' : flash.style.opacity; }
    // shot 3: the trap snaps shut
    const snapAt = 0.55;
    trap.visible = !!sh.trap;
    for (const [j, sd] of jaws) j.rotation.x = sh.trap && f > snapAt ? sd * 0.05 : sd * 1.25;
    if (trapClose) trapClose(sh.trap && f > snapAt ? Math.min(1, (f - snapAt) / 0.04) : 0);
    if (sh.trap && f > snapAt) once('snap', () => { sound.play('thunk'); sound.play('scream', undefined, undefined, { pitch: 1.2, len: 1.0 }); flash.style.background = '#600'; flash.style.opacity = '0.6'; setTimeout(() => { flash.style.opacity = '0'; }, 120); });
    // shot 4: Spider Mom, scuttling out of the dark straight at the camera, then screeching
    if (S) S.root.visible = !!sh.spider;
    if (sh.spider && S) {
      S.root.position.set(-9, 0, 20.5 + e * 6.2); S.root.rotation.y = 0; S.play(f > 0.85 ? 'eat' : 'walk', dt);
      sLight.position.set(-9, 1.2, 22.6 + e * 6); sLight.intensity = 4;
      const img = nx.createImageData(128, 128); for (let k = 0; k < img.data.length; k += 4) { const v = Math.random() * 255; img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255; }
      nx.putImageData(img, 0, 0); stat.style.backgroundImage = `url(${nc.toDataURL()})`; stat.style.opacity = (0.04 + e * 0.2).toFixed(2);
      once('skitter', () => sound.play('fade', undefined, undefined, { on: true }));
      if (f > 0.85) once('scare', () => { sound.play('scream', undefined, undefined, { pitch: 2.2, len: 0.8 }); flash.style.background = '#fff'; flash.style.opacity = '0.8'; setTimeout(() => { flash.style.opacity = '0'; }, 90); });
    } else stat.style.opacity = '0';
    if (sh.title) once('title', () => sound.play('caged'));
    r.render(sc, cam);
    playing.raf = requestAnimationFrame(frame);
  };
  playing.raf = requestAnimationFrame(frame);
}
