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
      for (let i = 0; i < 70; i++) pts.push([cells(), cells(), cells()]);
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
    case 'ground2': {
      // neutral detail texture: grass blades + soil grit; the map's vertex colors give the large-scale tint
      const n = fbm(201, 8, 5), blades = fbm(202, 96, 2), grit = fbm(203, 48, 3);
      const { c, H } = paint(512, (u, v) => {
        const k = n(u, v), b = blades(u, v), g = grit(u, v);
        const v1 = 150 + (k - 0.5) * 50 + (b - 0.5) * 70 + (g - 0.5) * 30;
        return [clamp(v1 * 0.96), clamp(v1), clamp(v1 * 0.9), b * 0.6 + g * 0.4];
      });
      out = finish(c, H, 2.2, [26, 26]);
      break;
    }
    case 'foliage': {
      const n = fbm(211, 6, 4), str = fbm(212, 48, 2);
      const { c, H } = paint(128, (u, v) => { const k = n(u, v) * 0.6 + Math.abs(Math.sin(u * 60 + str(u, v) * 8)) * 0.4; const b = 120 + k * 120; return [clamp(b * 0.9), clamp(b), clamp(b * 0.85), k]; });
      out = finish(c, H, 3, null);
      break;
    }
    case 'fogtile': {
      const n = fbm(221, 4, 5);
      const c = canvas(256), ctx = c.getContext('2d'), img = ctx.createImageData(256, 256);
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const k = n(x / 256, y / 256), a = Math.max(0, (k - 0.38) * 2.2); const i = (y * 256 + x) * 4; img.data[i] = 200; img.data[i + 1] = 210; img.data[i + 2] = 220; img.data[i + 3] = clamp(a * 255); }
      ctx.putImageData(img, 0, 0);
      const map = new THREE.CanvasTexture(c); map.wrapS = map.wrapT = THREE.RepeatWrapping;
      out = { map, normalMap: null };
      break;
    }
    case 'clouds': {
      const n = fbm(231, 3, 6);
      const c = canvas(512), ctx = c.getContext('2d'), img = ctx.createImageData(512, 512);
      for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) { const k = n(x / 512, y / 512), a = Math.max(0, (k - 0.45) * 2.6); const i = (y * 512 + x) * 4, l = 120 + k * 120; img.data[i] = l; img.data[i + 1] = l * 1.02; img.data[i + 2] = l * 1.12; img.data[i + 3] = clamp(a * 255); }
      ctx.putImageData(img, 0, 0);
      const map = new THREE.CanvasTexture(c); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.colorSpace = THREE.SRGBColorSpace;
      out = { map, normalMap: null };
      break;
    }
    case 'bloodatlas': {
      // 2x2 atlas: splatter, pool, directional spray, smear. RGB = blood colour, A = coverage.
      const S2 = 512, c = canvas(S2), ctx = c.getContext('2d');
      const R2 = rng(4242);
      const blob = (cx, cy, r, irregular = 0.35, pts = 22) => {
        ctx.beginPath();
        for (let i = 0; i <= pts; i++) { const a = i / pts * Math.PI * 2, rr = r * (1 + (R2() - 0.5) * irregular); const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.closePath(); ctx.fill();
      };
      const col = (k) => { const r = 130 + k * 70, g = 8 + k * 14, b = 8 + k * 10; return `rgba(${r | 0},${g | 0},${b | 0},`; };
      // cell 0: splatter with satellites
      ctx.save(); ctx.translate(0, 0);
      ctx.fillStyle = col(0.3) + '0.95)'; blob(128, 128, 46, 0.5, 30);
      for (let i = 0; i < 26; i++) { const a = R2() * 6.28, d = 50 + R2() * 70, r = 3 + R2() * 10; ctx.fillStyle = col(R2()) + '0.9)'; blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, r, 0.4, 10); }
      for (let i = 0; i < 9; i++) { const a = R2() * 6.28, d0 = 40, d1 = 70 + R2() * 50; ctx.strokeStyle = col(0.2) + '0.85)'; ctx.lineWidth = 3 + R2() * 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(128 + Math.cos(a) * d0, 128 + Math.sin(a) * d0); ctx.lineTo(128 + Math.cos(a) * d1, 128 + Math.sin(a) * d1); ctx.stroke(); }
      ctx.restore();
      // cell 1: pool (dark centre, lighter wet rim)
      ctx.save(); ctx.translate(256, 0);
      ctx.fillStyle = col(0.55) + '0.9)'; blob(128, 128, 104, 0.22, 40);
      ctx.fillStyle = col(0.1) + '0.97)'; blob(128, 128, 88, 0.22, 36);
      ctx.fillStyle = 'rgba(40,2,2,0.6)'; blob(122, 132, 50, 0.3, 24);
      ctx.restore();
      // cell 2: directional spray (arterial)
      ctx.save(); ctx.translate(0, 256);
      for (let i = 0; i < 60; i++) { const t = R2(), x = 20 + t * 220, y = 128 + (R2() - 0.5) * (20 + t * 110), r = (1 - t) * 14 + 2 + R2() * 4; ctx.fillStyle = col(R2() * 0.5) + (0.75 + R2() * 0.25) + ')'; blob(x, y, r, 0.4, 10); }
      ctx.fillStyle = col(0.2) + '0.95)'; blob(36, 128, 26, 0.4, 18);
      ctx.restore();
      // cell 3: smear / drag trail
      ctx.save(); ctx.translate(256, 256);
      for (let i = 0; i < 9; i++) { ctx.strokeStyle = col(0.2 + R2() * 0.4) + (0.55 + R2() * 0.35) + ')'; ctx.lineWidth = 10 + R2() * 26; ctx.lineCap = 'round'; ctx.beginPath(); const y = 80 + R2() * 96; ctx.moveTo(24, y); ctx.bezierCurveTo(90, y + (R2() - 0.5) * 30, 160, y + (R2() - 0.5) * 30, 232, y + (R2() - 0.5) * 20); ctx.stroke(); }
      ctx.restore();
      const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
      out = { map, normalMap: null };
      break;
    }
    case 'droplet': {
      const c = canvas(32), ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 14);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.7, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(16, 16, 14, 0, 7); ctx.fill();
      out = { map: new THREE.CanvasTexture(c), normalMap: null };
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
