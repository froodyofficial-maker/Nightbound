// Store art rendered from the real 3D characters: square portraits for the character grid and
// wide key-art banners for chapters and collections (dark fog, a hard rim light, the killer's
// colour). Rendered once per character/outfit with a small offscreen renderer and cached.
import * as THREE from 'three';
import { makeKiller, makeSurvivor, animate } from './models.js';
import { KILLERS, SURVIVORS, skinOf } from './config.js';

let R = null;
const cache = new Map();
function renderer() {
  if (R) return R;
  R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  R.outputColorSpace = THREE.SRGBColorSpace;
  R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.35;
  return R;
}
export const ACCENT = { butcher: 0xff2a14, wisp: 0x3aa8ff, harrower: 0xd8a040, lamplighter: 0x3aff6a, foreman: 0xff1e10, mara: 0xd8b56a, eli: 0xd8b56a, june: 0xd8b56a, tomas: 0xd8b56a };
export function forget(char) { for (const k of [...cache.keys()]) if (k.includes(':' + char + ':')) cache.delete(k); }

function stage(char, skin, banner) {
  const scene = new THREE.Scene();
  const accent = ACCENT[char] ?? 0xff3020;
  if (banner) { scene.background = new THREE.Color(0x070405); scene.fog = new THREE.FogExp2(0x120707, 0.09); }
  scene.add(new THREE.HemisphereLight(0x8a7a70, 0x100606, banner ? 0.9 : 1.6));
  const key = new THREE.DirectionalLight(0xfff0e0, banner ? 1.6 : 3.2); key.position.set(-2, 3, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(accent, banner ? 9 : 2.6); rim.position.set(3, 2.5, -3); scene.add(rim);
  const rim2 = new THREE.DirectionalLight(accent, banner ? 4 : 2); rim2.position.set(-3.5, 1.5, -2.5); scene.add(rim2);
  if (banner) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x1a1010, roughness: 0.4, metalness: 0.2 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const glow = new THREE.PointLight(accent, 30, 12, 1.6); glow.position.set(0.5, 1.2, -2.5); scene.add(glow);
  }
  const isK = !!KILLERS[char];
  const rig = isK ? makeKiller(char, skinOf(char, skin)) : makeSurvivor(SURVIVORS[char], skinOf(char, skin));
  // settle into a pose
  for (let i = 0; i < 40; i++) animate(rig, { anim: isK ? 'menace' : 'idle', speed: 0, t: i * 0.05 }, 0.05);
  rig.root.updateMatrixWorld(true);
  scene.add(rig.root);
  const box = new THREE.Box3().setFromObject(rig.root);
  return { scene, rig, h: Math.max(1.4, box.max.y) * (rig.glb ? 1.1 : 1), isK };
}

// kind: 'portrait' (square head-and-shoulders) or 'banner' (wide key art, character on the right)
export function art(kind, char, skin = 'default', w = 256, h = 256) {
  const key = kind + ':' + char + ':' + skin + ':' + w + 'x' + h;
  if (cache.has(key)) return cache.get(key);
  let url = '';
  try {
    const r = renderer();
    r.setPixelRatio(1); r.setSize(w, h, false);
    const { scene, h: H, isK } = stage(char, skin, kind === 'banner');
    const cam = new THREE.PerspectiveCamera(kind === 'banner' ? 30 : 26, w / h, 0.05, 60);
    if (kind === 'banner') {
      // aim left of the character so it stands right of centre, leaving room for the title
      cam.position.set(-1.05, H * 0.5, 2.5 + H * 0.38);
      cam.lookAt(-1.05, H * 0.52, 0);
    } else if (kind === 'full') {
      cam.position.set(0.6, H * 0.55, H * 2.3); cam.lookAt(0, H * 0.5, 0);
    } else {
      // killers: head to waist so outfits (apron, arms, weapon) read; survivors: head and shoulders
      const top = H * (isK ? 0.9 : 0.95);
      cam.position.set(0.3, top - 0.15, H * (isK ? 1.45 : 1.15));
      cam.lookAt(0, top - H * (isK ? 0.3 : 0.17), 0);
    }
    r.setClearColor(0x000000, 0);
    r.render(scene, cam);
    url = r.domElement.toDataURL('image/png');
  } catch (e) { console.warn('art render failed', e); }
  cache.set(key, url);
  return url;
}
