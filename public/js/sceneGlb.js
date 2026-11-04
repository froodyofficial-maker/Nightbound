// Whole-scene GLB models (map scenery), loaded once and cloned into a world.
//  - granny_map: "Granny 3 map", converted from USDZ (see README credits)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const tpl = {}, loading = {};
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
export function loadScene(name) {
  if (loading[name]) return loading[name];
  loading[name] = bytes(name).then(buf => new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej))).then(g => {
    g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.matrixAutoUpdate = false; o.updateMatrix(); } });
    tpl[name] = g.scene; return g.scene;
  }).catch(e => { console.warn(name + ' scenery unavailable:', e); return null; });
  return loading[name];
}
export const sceneReady = name => !!tpl[name];
// a copy for one world; lite: cheap Lambert materials (low-end laptops)
export function cloneScene(name, lite) {
  if (!tpl[name]) return null;
  const o = tpl[name].clone(true), cache = new Map();
  o.traverse(m => {
    if (!m.isMesh) return;
    const src = m.material;
    if (!cache.has(src)) {
      let mm = src;
      if (lite) mm = new THREE.MeshLambertMaterial({ color: src.color, map: src.map, side: src.side, alphaTest: src.alphaTest, transparent: src.transparent });
      else { mm = src.clone(); mm.envMapIntensity = 0.4; }
      cache.set(src, mm);
    }
    m.material = cache.get(src);
  });
  return o;
}
