// Visual style: 'realistic' (default) or 'classic' (the original look, lighter on old laptops).
// Realistic adds: sharper, higher-resolution surface textures with stronger relief and full
// anisotropic filtering; fabric and skin with a soft sheen; smoother character geometry;
// image-based night-sky reflections; multisampled anti-aliasing.
import * as THREE from 'three';

export const GFX = { style: 'realistic', aniso: 4 };
export const realistic = () => GFX.style !== 'classic';

export function setStyle(style, renderer) {
  GFX.style = style === 'classic' ? 'classic' : 'realistic';
  const max = renderer && renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 4;
  GFX.aniso = GFX.style === 'classic' ? Math.min(4, max) : Math.min(16, max);
}

// a dim night sky as an environment map: faint reflections on metal, glass, wet blood and eyes
const envCache = new WeakMap();
export function nightEnv(renderer, top = 0x1a2436, horizon = 0x0c1018, moonDir = new THREE.Vector3(30, 60, 20)) {
  let per = envCache.get(renderer);
  if (!per) envCache.set(renderer, per = new Map());
  const key = top + ':' + horizon;
  if (per.has(key)) return per.get(key);
  const sc = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(top) }, hor: { value: new THREE.Color(horizon) }, md: { value: moonDir.clone().normalize() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top, hor, md; varying vec3 vD;
      void main(){
        float h = vD.y;
        vec3 c = mix(hor * 0.35, hor, smoothstep(-0.4, 0.0, h));
        c = mix(c, top, smoothstep(0.0, 0.7, h));
        float m = max(dot(vD, md), 0.0);
        c += vec3(0.55, 0.62, 0.8) * (pow(m, 600.0) * 6.0 + pow(m, 12.0) * 0.12);
        gl_FragColor = vec4(c * 1.6, 1.0);
      }`,
  }));
  sc.add(sky);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(sc, 0.02);
  pm.dispose(); sky.geometry.dispose(); sky.material.dispose();
  per.set(key, rt.texture);
  return rt.texture;
}

// physically-based variants of the common character surfaces (realistic look only)
export function surface(name, base) {
  if (!realistic()) return null;
  const P = (extra) => new THREE.MeshPhysicalMaterial({ ...base, ...extra });
  switch (name) {
    case 'skin': return P({ roughness: Math.min(base.roughness ?? 0.7, 0.62), sheen: 0.35, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xff9c84) });
    case 'cloth': case 'pinstripe': case 'canvas': return P({ sheen: 0.6, sheenRoughness: 0.8, sheenColor: new THREE.Color(base.color).lerp(new THREE.Color(0xffffff), 0.35) });
    case 'leather': return P({ roughness: Math.min(base.roughness ?? 0.6, 0.5), clearcoat: 0.25, clearcoatRoughness: 0.45 });
    default: return null;
  }
}
