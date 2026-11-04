// Photo-scanned surfaces for the realistic look: real CC0 material scans (Poly Haven) with colour,
// relief (normal) and roughness maps, stored as GPU-compressed KTX2. They stream in on the menu and
// replace the painted textures as soon as they arrive. Classic mode, low/potato quality and the
// offline single-file build never load them.
import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { GFX, realistic } from './gfx.js';

// size: metres one copy of the scan covers. detail: relief + roughness only (the surface keeps its own colour)
const SETS = {
  brown_mud_leaves_01: { size: 3.2 }, stony_dirt_path: { size: 2.6 }, leaves_forest_ground: { size: 2.6 },
  mud_forest: { size: 3 }, brown_mud_02: { size: 3 }, park_dirt: { size: 3 }, rocky_trail: { size: 2.6 },
  snow_02: { size: 4 }, snow_field_aerial: { size: 6 },
  castle_brick_07: { size: 2.4 }, old_stone_wall: { size: 2.8 }, old_planks_02: { size: 1.8 }, weathered_planks: { size: 2.2 },
  wood_planks_dirt: { size: 2 }, rust_coarse_01: { size: 1.6 }, rusty_metal_02: { size: 1.8 }, pine_bark: { size: 1.1 },
  bark_brown_02: { size: 1.4 }, mossy_rock: { size: 2.2 }, old_wood_floor: { size: 2 },
  hessian_230: { size: 0.6, detail: true }, brown_leather: { size: 0.5, detail: true }, rough_linen: { size: 0.4, detail: true },
};
// the game's surface names -> scans
export const ROLE = {
  brick: 'castle_brick_07', stone: 'old_stone_wall', wood: 'old_planks_02', boards: 'weathered_planks', dark: 'wood_planks_dirt',
  logs: 'weathered_planks', metal: 'rust_coarse_01', paint: 'rusty_metal_02', bark: 'pine_bark', deadbark: 'bark_brown_02', rock: 'mossy_rock', snow: 'snow_02',
  floor: 'old_wood_floor', canvas: 'hessian_230', cloth: 'rough_linen', pinstripe: 'rough_linen', leather: 'brown_leather',
};
// ground per map look: [open ground, worn trails / mud]
const GROUND = {
  woods: ['brown_mud_leaves_01', 'stony_dirt_path'], granny: ['leaves_forest_ground', 'stony_dirt_path'],
  marsh: ['mud_forest', 'brown_mud_02'], carnival: ['park_dirt', 'rocky_trail'], snow: ['snow_02', 'snow_field_aerial'],
};
export const groundSets = look => GROUND[look] || GROUND.woods;

let loader = null;
const pending = new Map(), done = new Map();
const dev = () => !!document.querySelector('script[type=importmap]');
export const photoOn = () => !!loader && realistic();

// start streaming every scan (called once the renderer exists, realistic look, medium/high quality)
export function initPhoto(renderer, quality) {
  if (loader || !realistic() || quality === 'potato' || quality === 'low' || location.protocol === 'file:') return;
  try {
    loader = new KTX2Loader().setTranscoderPath((dev() ? '' : 'public/') + 'vendor/three/addons/libs/basis/').detectSupport(renderer);
  } catch (e) { console.warn('photo textures unavailable', e); loader = null; return; }
  // ground first (largest on screen), then walls and props
  for (const n of [...new Set(Object.values(GROUND).flat()), ...Object.keys(SETS)]) load(n);
}

function load(n) {
  if (!loader || !SETS[n]) return Promise.resolve(null);
  if (pending.has(n)) return pending.get(n);
  const s = SETS[n], root = (dev() ? '' : 'public/') + 'tex/' + n + '/';
  const get = (m, srgb) => loader.loadAsync(root + m + '.ktx2').then(t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = GFX.aniso;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  });
  const p = Promise.all([s.detail ? null : get('albedo', true), get('normal'), get('roughness')])
    .then(([map, normalMap, roughnessMap]) => { const o = { map, normalMap, roughnessMap, size: s.size, detail: !!s.detail }; done.set(n, o); return o; })
    .catch(e => { console.warn('photo texture', n, e); return null; });
  pending.set(n, p);
  return p;
}
export const photoSet = n => done.get(n) || null;
export const whenSet = n => load(n);

function rep(t, r, turn) { if (!t) return null; const k = t.clone(); k.repeat.set(r[0], r[1]); if (turn) k.rotation = Math.PI / 2; return k; }

// swap a scan onto a standard material. uvm: metres per UV unit on that geometry (box UVs are in
// "tiles"; [u, v] for stretched UVs like tree trunks); tint: how much of the material's own colour to keep (0 = the scan's true colour)
export function photoMaterial(m, role, uvm = 2, tint = 0) {
  const n = ROLE[role];
  if (!n || !photoOn() || !m || !m.isMeshStandardMaterial) return;
  const apply = o => {
    if (!o) return;
    const turn = role === 'logs'; // log-cabin walls: run the planks horizontally
    const r = Array.isArray(uvm) ? [uvm[0] / o.size, uvm[1] / o.size] : [uvm / o.size, uvm / o.size];
    if (!o.detail) {
      m.map = rep(o.map, r, turn);
      const keep = m.color.clone();
      m.color.setRGB(1, 1, 1).lerp(keep.multiplyScalar(1 / Math.max(0.05, keep.r, keep.g, keep.b)), tint);
    } else if (m.map) m.map.anisotropy = GFX.aniso;
    m.normalMap = rep(o.normalMap, r, turn); m.normalScale.set(1.15, 1.15);
    m.roughnessMap = rep(o.roughnessMap, r, turn); m.roughness = Math.min(1, (m.roughness ?? 0.9) + 0.1);
    if (m.metalness > 0.4) m.metalness *= 0.6; // the scans are mostly rusted / painted metal
    m.needsUpdate = true;
  };
  const o = done.get(n);
  if (o) apply(o); else load(n).then(apply);
}

// ---------- ground: two scans (open ground and worn trails) blended per vertex, with anti-tiling ----------
// pathAttr: float vertex attribute 'pathK' (0 open ground .. 1 trail / mud)
export function photoGround(mesh, look, gain = 0.62, wet = 0) {
  if (!photoOn()) return;
  const [a, b] = groundSets(look);
  Promise.all([load(a), load(b)]).then(([A, B]) => {
    if (!A || !B || !mesh.parent) return;
    const old = mesh.material;
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    m.envMapIntensity = 0.35;
    const U = {
      gA: { value: A.map }, gnA: { value: A.normalMap }, grA: { value: A.roughnessMap }, gsA: { value: 1 / A.size },
      gB: { value: B.map }, gnB: { value: B.normalMap }, grB: { value: B.roughnessMap }, gsB: { value: 1 / B.size },
      gGain: { value: gain }, gWet: { value: wet },
    };
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float pathK; varying float vPathK; varying vec2 vGP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPathK = pathK; vGP = (modelMatrix * vec4(position, 1.0)).xz * vec2(1.0, -1.0);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D gA, gnA, grA, gB, gnB, grB; uniform float gsA, gsB, gGain, gWet; varying float vPathK; varying vec2 vGP;
          float gHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float gNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
            return mix(mix(gHash(i), gHash(i+vec2(1,0)), f.x), mix(gHash(i+vec2(0,1)), gHash(i+vec2(1,1)), f.x), f.y); }
          // two differently rotated / scaled copies of each scan, mixed by slow noise: no visible tiling grid
          const mat2 gRot = mat2(0.80, -0.60, 0.60, 0.80);
          vec4 gTex(sampler2D t, vec2 uv, float k){ return mix(texture2D(t, uv), texture2D(t, gRot * uv * 0.77 + 0.31), k); }`)
        .replace('#include <color_fragment>', `
          float gk = smoothstep(0.25, 0.75, gNoise(vGP * 0.09) * 0.7 + gNoise(vGP * 0.31) * 0.3);
          vec2 uA = vGP * gsA, uB = vGP * gsB;
          vec3 cA = gTex(gA, uA, gk).rgb, cB = gTex(gB, uB, gk).rgb;
          // height-style blend: the trail shows first in the scan's dips, so edges break up naturally
          float hA = dot(cA, vec3(0.333)), hB = dot(cB, vec3(0.333));
          float gm = smoothstep(0.38, 0.62, vPathK + (hB - hA) * 0.6 * (1.0 - abs(vPathK * 2.0 - 1.0)));
          vec3 gCol = mix(cA, cB, gm);
          // the old vertex colouring survives as a gentle tint (moss, litter, mud near generators)
          vec3 gTint = vColor / max(dot(vColor, vec3(0.333)), 0.03);
          float gMacro = 0.82 + 0.36 * gNoise(vGP * 0.045);
          diffuseColor.rgb *= gCol * mix(vec3(1.0), gTint, 0.22) * gGain * gMacro;`)
        .replace('#include <roughnessmap_fragment>', `
          float roughnessFactor = roughness * mix(gTex(grA, uA, gk).g, gTex(grB, uB, gk).g, gm);
          roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.35, gWet * gm);`)
        .replace('#include <normal_fragment_maps>', `
          vec3 nA = gTex(gnA, uA, gk).xyz * 2.0 - 1.0, nB = gTex(gnB, uB, gk).xyz * 2.0 - 1.0;
          vec3 tn = normalize(mix(nA, nB, gm)); tn.xy *= 1.25;
          // flat ground, uv = world (x, -z): tangent +x, bitangent -z, normal +y
          vec3 gwn = normalize(vec3(tn.x, tn.z, -tn.y));
          normal = normalize((viewMatrix * vec4(gwn, 0.0)).xyz);`);
    };
    mesh.material = m;
    if (old && old.dispose) old.dispose();
  });
}
