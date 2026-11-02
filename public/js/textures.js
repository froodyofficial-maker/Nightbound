// Procedural textures (no image assets needed). Each returns { map, normalMap }.
import * as THREE from 'three';
import { rng } from './map.js';

function noiseGrid(R, n) { const g = new Float32Array((n + 1) * (n + 1)); for (let i = 0; i < g.length; i++) g[i] = R(); return g; }
// tileable fractal value noise sampler, returns fn(x,y) in [0,1] for x,y in [0,1)
function fbm(seed, base = 4, oct = 5) {
  const R = rng(seed);
  const layers = [];
  for (let o = 0; o < oct; o++) { const n = base << o; layers.push({ n, g: noiseGrid(R, n) }); }
  return (x, y) => {
    let v = 0, amp = 0.5, tot = 0;
    for (const { n, g } of layers) {
      const fx = x * n, fy = y * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const x0 = ix % n, y0 = iy % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g[y0 * (n + 1) + x0], b = g[y0 * (n + 1) + x1], c = g[y1 * (n + 1) + x0], d = g[y1 * (n + 1) + x1];
      v += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      tot += amp; amp *= 0.5;
    }
    return v / tot;
  };
}

function canvas(size) { const c = document.createElement('canvas'); c.width = c.height = size; return c; }

function finish(c, height, strength, repeat, srgb = true) {
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  if (srgb) map.colorSpace = THREE.SRGBColorSpace;
  if (repeat) map.repeat.set(repeat[0], repeat[1]);
  let normalMap = null;
  if (height) {
    const s = c.width, nc = canvas(s), ctx = nc.getContext('2d'), img = ctx.createImageData(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const h = (xx, yy) => height[((yy + s) % s) * s + ((xx + s) % s)];
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1), i = (y * s + x) * 4;
      img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    normalMap = new THREE.CanvasTexture(nc);
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    if (repeat) normalMap.repeat.set(repeat[0], repeat[1]);
  }
  return { map, normalMap };
}

function paint(size, fn) {
  const c = canvas(size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size), H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b, h] = fn(x / size, y / size, x, y);
    const i = (y * size + x) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    H[y * size + x] = h;
  }
  ctx.putImageData(img, 0, 0);
  return { c, H };
}
const mix = (a, b, t) => a + (b - a) * t;
const clamp = v => Math.max(0, Math.min(255, v));

const cache = {};
export function tex(name) {
  if (cache[name]) return cache[name];
  let out;
  switch (name) {
    case 'ground': {
      const n = fbm(11, 4, 6), d = fbm(12, 2, 4), s = fbm(13, 32, 2);
      const { c, H } = paint(512, (u, v) => {
        const a = n(u, v), b = d(u, v), sp = s(u, v);
        const dirt = Math.max(0, Math.min(1, (b - 0.48) * 6));
        const r = mix(mix(34, 46, a), mix(58, 72, a), dirt) + sp * 14;
        const g = mix(mix(44, 60, a), mix(48, 58, a), dirt) + sp * 12;
        const bl = mix(mix(24, 30, a), mix(36, 42, a), dirt) + sp * 8;
        return [clamp(r), clamp(g), clamp(bl), a * 0.6 + sp * 0.4];
      });
      out = finish(c, H, 3, [40, 40]);
      break;
    }
    case 'brick': {
      const n = fbm(21, 8, 4);
      const { c, H } = paint(256, (u, v, x, y) => {
        const row = Math.floor(v * 8), off = row % 2 ? 0.125 : 0;
        const bu = ((u + off) * 4) % 1, bv = (v * 8) % 1;
        const mortar = bu < 0.04 || bv < 0.08;
        const tone = (Math.sin(row * 12.9 + Math.floor((u + off) * 4) * 78.2) * 0.5 + 0.5);
        const k = n(u, v);
        if (mortar) return [clamp(58 + k * 20), clamp(54 + k * 18), clamp(50 + k * 16), 0.1];
        return [clamp(92 + tone * 30 + k * 30), clamp(42 + tone * 12 + k * 18), clamp(34 + k * 14), 0.6 + k * 0.4];
      });
      out = finish(c, H, 4, null);
      break;
    }
    case 'wood': {
      const n = fbm(31, 4, 5), grain = fbm(32, 64, 2);
      const { c, H } = paint(256, (u, v) => {
        const plank = Math.floor(u * 5), pu = (u * 5) % 1;
        const gap = pu < 0.05;
        const tone = Math.sin(plank * 91.7) * 0.5 + 0.5;
        const gr = grain((u * 0.2 + plank * 0.37) % 1, v) * 0.6 + Math.sin(v * 80 + n(u, v) * 12) * 0.12;
        if (gap) return [20, 16, 12, 0];
        return [clamp(70 + tone * 30 + gr * 50), clamp(54 + tone * 20 + gr * 34), clamp(38 + tone * 12 + gr * 20), 0.5 + gr * 0.5];
      });
      out = finish(c, H, 3, null);
      break;
    }
    case 'stone': {
      const n = fbm(41, 6, 5), cells = rng(42), pts = [];
      for (let i = 0; i < 40; i++) pts.push([cells(), cells(), cells()]);
      const { c, H } = paint(256, (u, v) => {
        let d1 = 9, d2 = 9, id = 0;
        for (let i = 0; i < pts.length; i++) for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const dx = u - pts[i][0] - ox, dy = (v - pts[i][1] - oy) * 1.6, d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d;
        }
        const edge = Math.sqrt(d2) - Math.sqrt(d1);
        const k = n(u, v), tone = pts[id][2];
        if (edge < 0.012) return [clamp(30 + k * 20), clamp(30 + k * 20), clamp(30 + k * 18), 0];
        const base = 70 + tone * 40 + k * 40;
        return [clamp(base), clamp(base * 0.98), clamp(base * 0.92), 0.4 + Math.min(edge * 8, 0.6) * k];
      });
      out = finish(c, H, 5, null);
      break;
    }
    case 'metal': {
      const n = fbm(51, 4, 5), rust = fbm(52, 3, 5);
      const { c, H } = paint(256, (u, v) => {
        const k = n(u, v), r = Math.max(0, Math.min(1, (rust(u, v) - 0.45) * 4));
        const seam = (u * 2) % 1 < 0.02 || (v * 2) % 1 < 0.02;
        const base = 70 + k * 30;
        return seam ? [30, 30, 30, 0] : [clamp(mix(base, 120, r)), clamp(mix(base * 1.02, 58, r)), clamp(mix(base * 1.05, 30, r)), 0.5 + k * 0.3 + r * 0.2];
      });
      out = finish(c, H, 2, null);
      break;
    }
    case 'bark': {
      const n = fbm(61, 4, 5);
      const { c, H } = paint(128, (u, v) => {
        const k = n(u * 1, v * 0.25 % 1);
        const ridge = Math.abs(Math.sin(u * 40 + k * 8));
        const b = 30 + ridge * 30 + k * 20;
        return [clamp(b * 1.05), clamp(b * 0.9), clamp(b * 0.75), ridge];
      });
      out = finish(c, H, 4, null);
      break;
    }
    case 'rock': {
      const n = fbm(71, 4, 6);
      const { c, H } = paint(256, (u, v) => { const k = n(u, v); const b = 55 + k * 60; return [clamp(b), clamp(b * 0.98), clamp(b * 0.95), k]; });
      out = finish(c, H, 6, null);
      break;
    }
    case 'hay': {
      const n = fbm(81, 16, 3);
      const { c, H } = paint(128, (u, v) => { const k = n(u, v); const s = Math.abs(Math.sin(v * 120 + k * 20)); return [clamp(140 + s * 50), clamp(112 + s * 40), clamp(52 + s * 20), s]; });
      out = finish(c, H, 2, null);
      break;
    }
    case 'skin': {
      const n = fbm(111, 6, 5), pores = fbm(112, 64, 2), red = fbm(113, 3, 3);
      const { c, H } = paint(256, (u, v) => {
        const k = n(u, v), p = pores(u, v), r = red(u, v);
        const b = 236 + (k - 0.5) * 14 - p * 4;
        return [clamp(b + (r - 0.5) * 12), clamp(b * 0.985 - (r - 0.5) * 4), clamp(b * 0.975 - (r - 0.5) * 3), k * 0.3 + p * 0.2];
      });
      out = finish(c, H, 0.6, null);
      break;
    }
    case 'leather': {
      const n = fbm(121, 10, 4), w = fbm(122, 40, 2);
      const { c, H } = paint(128, (u, v) => { const k = n(u, v) * 0.7 + w(u, v) * 0.3; const b = 150 + k * 70; return [clamp(b), clamp(b * 0.92), clamp(b * 0.85), k]; });
      out = finish(c, H, 2, null);
      break;
    }
    case 'cloth': {
      const n = fbm(91, 32, 3);
      const { c, H } = paint(128, (u, v, x, y) => { const w = ((x + y) % 4 < 2 ? 1 : 0.85) * (0.8 + n(u, v) * 0.3); return [clamp(255 * w), clamp(255 * w), clamp(255 * w), w]; });
      out = finish(c, H, 1.5, null);
      break;
    }
    case 'grass': {
      // alpha blade texture for instanced grass
      const c = canvas(64), ctx = c.getContext('2d');
      const R = rng(5);
      for (let i = 0; i < 9; i++) {
        const x = 6 + R() * 52, w = 2 + R() * 3, h = 30 + R() * 34, lean = (R() - 0.5) * 20;
        const g = ctx.createLinearGradient(0, 64, 0, 64 - h);
        g.addColorStop(0, '#1b2414'); g.addColorStop(1, R() < 0.3 ? '#6b6a3a' : '#3d5228');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(x - w, 64); ctx.quadraticCurveTo(x + lean * 0.3, 64 - h * 0.6, x + lean, 64 - h); ctx.lineTo(x + w, 64); ctx.fill();
      }
      const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
      out = { map, normalMap: null };
      break;
    }
    case 'glow': {
      const c = canvas(64), ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
      out = { map: new THREE.CanvasTexture(c), normalMap: null };
      break;
    }
    case 'fog': {
      const n = fbm(101, 3, 5);
      const c = canvas(128), ctx = c.getContext('2d'), img = ctx.createImageData(128, 128);
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
        const dx = x / 64 - 1, dy = y / 64 - 1, r = Math.max(0, 1 - Math.hypot(dx, dy));
        const i = (y * 128 + x) * 4, a = r * r * (0.4 + n(x / 128, y / 128) * 0.8);
        img.data[i] = 200; img.data[i + 1] = 210; img.data[i + 2] = 225; img.data[i + 3] = clamp(a * 255);
      }
      ctx.putImageData(img, 0, 0);
      out = { map: new THREE.CanvasTexture(c), normalMap: null };
      break;
    }
  }
  cache[name] = out;
  return out;
}
