// Hand-painted (canvas) textures for the Meatworks, drawn at a fixed scale of 256 px per metre.
// Every texture comes with a height map (-> normal map) and a roughness map, so tiles gloss,
// grout and concrete stay matte, and fresh blood and puddles look wet.
import * as THREE from 'three';
import { rng } from './map.js';

const cache = {};
const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function normalFrom(hc, strength, wrapY = true) {
  const w = hc.width, h = hc.height, src = hc.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const out = cv(w, h), ctx = out.getContext('2d', { willReadFrequently: true }), img = ctx.createImageData(w, h), d = img.data;
  const k = strength / 255;
  for (let y = 0; y < h; y++) {
    const yu = wrapY ? (y - 1 + h) % h : Math.max(0, y - 1), yd = wrapY ? (y + 1) % h : Math.min(h - 1, y + 1);
    const row = y * w, ru = yu * w, rd = yd * w;
    for (let x = 0; x < w; x++) {
      const xl = x === 0 ? w - 1 : x - 1, xr = x === w - 1 ? 0 : x + 1;
      const dx = (src[(row + xr) * 4] - src[(row + xl) * 4]) * k, dy = (src[(rd + x) * 4] - src[(ru + x) * 4]) * k;
      const il = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = (row + x) * 4;
      d[i] = (0.5 - dx * il * 0.5) * 255; d[i + 1] = (0.5 + dy * il * 0.5) * 255; d[i + 2] = (0.5 + il * 0.5) * 255; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}
function texOf(c, srgb, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; else { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
// three layers painted together: colour, height (grey), roughness (grey)
function layers(w, h) {
  const C = cv(w, h), Hh = cv(w, h), Rr = cv(w, h);
  // the height layer is read back for the normal map: keep it on the CPU so that read is cheap
  return { C, Hh, Rr, c: C.getContext('2d'), hh: Hh.getContext('2d', { willReadFrequently: true }), rr: Rr.getContext('2d') };
}
const g = v => `rgb(${v | 0},${v | 0},${v | 0})`;

// a blood splash: blob, satellite droplets and drips running down (OFFAL style)
function bloodSplash(L, R, x, y, size, drip, floorY) {
  const { c, hh, rr } = L;
  const fresh = R() < 0.6, col = fresh ? [118 + R() * 30, 8, 6] : [70, 14, 10];
  const fill = a => `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${a})`;
  for (let k = 0; k < 3; k++) {
    const r = size * (1 - k * 0.25), ox = (R() - 0.5) * size * 0.5, oy = (R() - 0.5) * size * 0.4;
    c.fillStyle = fill(0.55 + k * 0.15); c.beginPath();
    for (let a = 0; a < 6.3; a += 0.35) { const rr2 = r * (0.6 + R() * 0.55); c.lineTo(x + ox + Math.cos(a) * rr2, y + oy + Math.sin(a) * rr2 * 0.8); }
    c.fill();
  }
  rr.fillStyle = g(fresh ? 40 : 170); rr.beginPath(); rr.ellipse(x, y, size, size * 0.8, 0, 0, 7); rr.fill();
  for (let k = 0; k < 18; k++) { const a = R() * 6.3, d = size * (1 + R() * 1.6), s = 1 + R() * size * 0.12; c.fillStyle = fill(0.8); c.beginPath(); c.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8, s, 0, 7); c.fill(); }
  if (!drip) return;
  for (let k = 0; k < 3 + R() * 6; k++) {
    const dx = x + (R() - 0.5) * size * 1.4, len = size * (1 + R() * 5) + (R() < 0.25 ? (floorY - y) : 0), w0 = 2 + R() * size * 0.12;
    const end = Math.min(floorY, y + len);
    const grd = c.createLinearGradient(0, y, 0, end); grd.addColorStop(0, fill(0.9)); grd.addColorStop(1, fill(0.75));
    c.fillStyle = grd; c.beginPath(); c.moveTo(dx - w0 / 2, y); c.lineTo(dx + w0 / 2, y); c.lineTo(dx + w0 * 0.3, end); c.lineTo(dx - w0 * 0.3, end); c.fill();
    c.beginPath(); c.arc(dx, end, w0 * 0.55, 0, 7); c.fill();
    rr.fillStyle = g(fresh ? 50 : 170); rr.fillRect(dx - w0 / 2, y, w0, end - y);
    hh.fillStyle = 'rgba(255,255,255,0.15)'; hh.fillRect(dx - w0 / 2, y, w0, end - y);
  }
}
function smear(L, R, x, y, w, h) {
  const { c, rr } = L;
  for (let k = 0; k < 14; k++) {
    c.strokeStyle = `rgba(${90 + R() * 40 | 0},10,8,${0.12 + R() * 0.25})`; c.lineWidth = 2 + R() * 7;
    const yy = y + R() * h; c.beginPath(); c.moveTo(x, yy); c.bezierCurveTo(x + w * 0.3, yy + (R() - 0.5) * 20, x + w * 0.7, yy + (R() - 0.5) * 20, x + w * (0.6 + R() * 0.4), yy + (R() - 0.5) * 30); c.stroke();
  }
  rr.fillStyle = g(90); rr.fillRect(x, y, w, h);
}

// walls: 8m wide x 5m tall. curb / oxblood tiles / green trim / cream tiles / painted concrete
export function wallTextures() {
  if (cache.wall) return cache.wall;
  const PPM = 192, W = 8 * PPM, H = 5 * PPM, Y = h => (5 - h) * PPM, L = layers(W, H), { c, hh, rr } = L, R = rng(5151);
  const T = 0.15 * PPM;
  // painted concrete under the ceiling
  c.fillStyle = '#6e6a60'; c.fillRect(0, 0, W, Y(4.3)); hh.fillStyle = g(120); hh.fillRect(0, 0, W, Y(4.3)); rr.fillStyle = g(215); rr.fillRect(0, 0, W, Y(4.3));
  for (let i = 0; i < 2500; i++) { const x = R() * W, y = R() * Y(4.3); c.fillStyle = `rgba(${R() < 0.5 ? 40 : 140},${R() < 0.5 ? 38 : 130},34,${R() * 0.18})`; c.fillRect(x, y, 1 + R() * 3, 1 + R() * 3); }
  const soot = c.createLinearGradient(0, 0, 0, Y(4.3)); soot.addColorStop(0, 'rgba(14,10,8,0.85)'); soot.addColorStop(1, 'rgba(14,10,8,0.05)'); c.fillStyle = soot; c.fillRect(0, 0, W, Y(4.3));
  const tiles = (h0, h1, base, vary, grout, gloss) => {
    const y0 = Y(h1), y1 = Y(h0);
    c.fillStyle = grout; c.fillRect(0, y0, W, y1 - y0); hh.fillStyle = g(70); hh.fillRect(0, y0, W, y1 - y0); rr.fillStyle = g(230); rr.fillRect(0, y0, W, y1 - y0);
    for (let ty = y1 - T; ty > y0 - T + 1; ty -= T) for (let tx = 0; tx < W; tx += T) {
      const top = Math.max(y0, ty), hgt = Math.min(T, ty + T - top) - 2; if (hgt <= 2) continue;
      const v = (R() - 0.5) * vary;
      const missing = R() < 0.006, chipped = R() < 0.05;
      if (missing) { c.fillStyle = '#4a4238'; c.fillRect(tx + 1, top + 1, T - 2, hgt); hh.fillStyle = g(40); hh.fillRect(tx + 1, top + 1, T - 2, hgt); rr.fillStyle = g(240); rr.fillRect(tx + 1, top + 1, T - 2, hgt); continue; }
      // flat glaze with a lit top-left edge and a shaded bottom-right edge (cheaper than a gradient per tile)
      c.fillStyle = `rgb(${base[0] + v | 0},${base[1] + v | 0},${base[2] + v | 0})`; c.fillRect(tx + 1.5, top + 1.5, T - 3, hgt - 1);
      c.fillStyle = 'rgba(255,255,255,0.10)'; c.fillRect(tx + 1.5, top + 1.5, T - 3, 2.5); c.fillRect(tx + 1.5, top + 1.5, 2.5, hgt - 1);
      c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(tx + 1.5, top + hgt - 2, T - 3, 1.5); c.fillRect(tx + T - 4, top + 1.5, 2.5, hgt - 1);
      hh.fillStyle = g(200); hh.fillRect(tx + 1.5, top + 1.5, T - 3, hgt - 1); hh.fillStyle = g(175); hh.fillRect(tx + 1.5, top + 1.5, T - 3, 2); hh.fillRect(tx + 1.5, top + 1.5, 2, hgt - 1);
      rr.fillStyle = g(gloss + R() * 30); rr.fillRect(tx + 1.5, top + 1.5, T - 3, hgt - 1);
      if (chipped) { const cx = tx + (R() < 0.5 ? 2 : T - 10), cy = top + (R() < 0.5 ? 2 : hgt - 10); c.fillStyle = '#5a5248'; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + 6 + R() * 6, cy + R() * 4); c.lineTo(cx + R() * 4, cy + 6 + R() * 6); c.fill(); hh.fillStyle = g(90); hh.fillRect(cx, cy, 8, 8); }
    }
  };
  tiles(1.58, 4.3, [214, 208, 192], 26, '#5c5850', 55);   // cream
  tiles(0.18, 1.5, [104, 30, 26], 22, '#2a1a16', 45);     // oxblood
  // bullnose trim
  const ty0 = Y(1.58), ty1 = Y(1.5); const tg = c.createLinearGradient(0, ty0, 0, ty1); tg.addColorStop(0, '#5a7a62'); tg.addColorStop(0.45, '#2e4a3a'); tg.addColorStop(1, '#1a2a22');
  c.fillStyle = tg; c.fillRect(0, ty0, W, ty1 - ty0); hh.fillStyle = g(235); hh.fillRect(0, ty0, W, ty1 - ty0); rr.fillStyle = g(50); rr.fillRect(0, ty0, W, ty1 - ty0);
  // concrete curb
  c.fillStyle = '#48443e'; c.fillRect(0, Y(0.18), W, H - Y(0.18)); hh.fillStyle = g(150); hh.fillRect(0, Y(0.18), W, H - Y(0.18)); rr.fillStyle = g(200); rr.fillRect(0, Y(0.18), W, H - Y(0.18));
  // cracks
  for (let i = 0; i < 18; i++) {
    let x = R() * W, y = Y(0.3 + R() * 3.8); c.strokeStyle = 'rgba(40,32,26,0.7)'; hh.strokeStyle = g(30); c.lineWidth = hh.lineWidth = 1.2;
    c.beginPath(); hh.beginPath(); c.moveTo(x, y); hh.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += (R() - 0.5) * 40; y += 6 + R() * 22; c.lineTo(x, y); hh.lineTo(x, y); }
    c.stroke(); hh.stroke();
  }
  // grime: damp streaks from the top, rust under the pipes, filth splashed up from the floor
  for (let i = 0; i < 90; i++) {
    const x = R() * W, y = R() < 0.4 ? Y(4.15) : 0, len = 60 + R() * (H * 0.6), rust = y > 0;
    const gr = c.createLinearGradient(0, y, 0, y + len); gr.addColorStop(0, rust ? 'rgba(120,58,20,0.45)' : 'rgba(40,34,26,0.35)'); gr.addColorStop(1, 'rgba(40,34,26,0)');
    c.fillStyle = gr; c.fillRect(x, y, 2 + R() * 9, len);
  }
  const fl = c.createLinearGradient(0, Y(1.0), 0, H); fl.addColorStop(0, 'rgba(30,20,14,0)'); fl.addColorStop(1, 'rgba(30,20,14,0.75)'); c.fillStyle = fl; c.fillRect(0, Y(1.0), W, H - Y(1.0));
  // old blood: splashes with runs, and smears where something was dragged along the wall
  for (let i = 0; i < 9; i++) bloodSplash(L, R, R() * W, Y(0.8 + R() * 1.8), 10 + R() * 26, true, H - 4);
  for (let i = 0; i < 4; i++) smear(L, R, R() * (W - 300), Y(0.9 + R() * 1.0), 140 + R() * 200, 30 + R() * 40);
  const out = { map: texOf(L.C, true, false), normalMap: texOf(normalFrom(L.Hh, 3.2, false), false, false), roughnessMap: texOf(L.Rr, false, false) };
  return (cache.wall = out);
}

// floor: worn red quarry tiles (4m square), puddles and washed-out stains
export function floorTextures() {
  if (cache.floor) return cache.floor;
  const PPM = 256, S = 4 * PPM, L = layers(S, S), { c, hh, rr } = L, R = rng(6262), T = 0.25 * PPM;
  c.fillStyle = '#231612'; c.fillRect(0, 0, S, S); hh.fillStyle = g(60); hh.fillRect(0, 0, S, S); rr.fillStyle = g(235); rr.fillRect(0, 0, S, S);
  for (let ty = 0; ty < S; ty += T) for (let tx = 0; tx < S; tx += T) {
    const v = (R() - 0.5) * 26, worn = R() < 0.2;
    c.fillStyle = `rgb(${96 + v + (worn ? 18 : 0) | 0},${50 + v * 0.6 + (worn ? 12 : 0) | 0},${40 + v * 0.5 | 0})`; c.fillRect(tx + 3, ty + 3, T - 6, T - 6);
    hh.fillStyle = g(190); hh.fillRect(tx + 3, ty + 3, T - 6, T - 6); hh.fillStyle = g(165); hh.fillRect(tx + 3, ty + 3, T - 6, 3); hh.fillRect(tx + 3, ty + 3, 3, T - 6);
    rr.fillStyle = g(150 + R() * 40); rr.fillRect(tx + 3, ty + 3, T - 6, T - 6);
  }
  for (let i = 0; i < 9000; i++) { c.fillStyle = `rgba(${R() < 0.5 ? 20 : 150},${R() < 0.5 ? 14 : 110},10,${R() * 0.16})`; c.fillRect(R() * S, R() * S, 1 + R() * 2, 1 + R() * 2); }
  // washed-out stains and grime in big soft patches
  for (let i = 0; i < 14; i++) { const x = R() * S, y = R() * S, r = 60 + R() * 220, gr = c.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, R() < 0.5 ? 'rgba(80,10,8,0.35)' : 'rgba(20,14,10,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(x - r, y - r, r * 2, r * 2); }
  // puddles: dark and mirror-wet
  for (let i = 0; i < 7; i++) {
    const x = R() * S, y = R() * S, r = 50 + R() * 140;
    c.fillStyle = 'rgba(16,8,6,0.35)'; rr.fillStyle = g(12); hh.fillStyle = g(120);
    for (const ctx of [c, rr, hh]) { ctx.beginPath(); for (let a = 0; a < 6.3; a += 0.3) { const q = r * (0.6 + 0.4 * Math.sin(a * 3 + i) * R()); ctx.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q * 0.7); } ctx.fill(); }
  }
  for (let i = 0; i < 4; i++) bloodSplash(L, R, R() * S, R() * S, 14 + R() * 20, false, S);
  const out = { map: texOf(L.C, true), normalMap: texOf(normalFrom(L.Hh, 2.6), false), roughnessMap: texOf(L.Rr, false) };
  return (cache.floor = out);
}

// ceiling: stained concrete slab in formwork panels (8m square)
export function ceilingTexture() {
  if (cache.ceil) return cache.ceil;
  const S = 1024, c0 = cv(S, S), c = c0.getContext('2d'), R = rng(7373);
  c.fillStyle = '#4a4640'; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 6000; i++) { c.fillStyle = `rgba(${R() < 0.5 ? 20 : 110},${R() < 0.5 ? 18 : 104},16,${R() * 0.2})`; c.fillRect(R() * S, R() * S, 2, 2); }
  c.strokeStyle = 'rgba(20,18,16,0.7)'; c.lineWidth = 3;
  for (let x = 0; x <= S; x += S / 4) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, S); c.stroke(); }
  for (let y = 0; y <= S; y += S / 2) { c.beginPath(); c.moveTo(0, y); c.lineTo(S, y); c.stroke(); }
  for (let i = 0; i < 10; i++) { const x = R() * S, y = R() * S, r = 40 + R() * 160, gr = c.createRadialGradient(x, y, r * 0.2, x, y, r); gr.addColorStop(0, 'rgba(70,46,24,0.4)'); gr.addColorStop(0.8, 'rgba(50,34,20,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(x - r, y - r, r * 2, r * 2); }
  return (cache.ceil = texOf(c0, true));
}

// meat: marbled red muscle, fat seams, silver fascia, a fat cap at the top
export function meatTexture() {
  if (cache.meat) return cache.meat;
  const S = 512, c0 = cv(S, S), c = c0.getContext('2d'), R = rng(8484);
  const base = c.createLinearGradient(0, 0, 0, S); base.addColorStop(0, '#d8b8a0'); base.addColorStop(0.12, '#a83a2c'); base.addColorStop(0.5, '#8a1a12'); base.addColorStop(1, '#5a0c08');
  c.fillStyle = base; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 220; i++) {
    c.strokeStyle = R() < 0.7 ? `rgba(240,214,196,${0.15 + R() * 0.35})` : `rgba(200,200,210,${0.12 + R() * 0.2})`; c.lineWidth = 0.6 + R() * 2.4;
    let x = R() * S, y = 40 + R() * (S - 40); c.beginPath(); c.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (R() - 0.5) * 60; y += (R() - 0.5) * 24; c.lineTo(x, y); }
    c.stroke();
  }
  for (let i = 0; i < 30; i++) { const x = R() * S, y = R() * S, r = 10 + R() * 50, gr = c.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(60,4,2,0.45)'); gr.addColorStop(1, 'rgba(60,4,2,0)'); c.fillStyle = gr; c.fillRect(x - r, y - r, r * 2, r * 2); }
  const t = texOf(c0, true); t.wrapT = THREE.ClampToEdgeWrapping;
  return (cache.meat = t);
}

// enamel signs, stencilled, chipped and splashed
export function signTexture(text, kind = 0) {
  const key = 'sign:' + text + kind;
  if (cache[key]) return cache[key];
  const c0 = cv(512, 160), c = c0.getContext('2d'), R = rng(text.length * 97 + kind);
  const [bg, fg] = [['#e8e0cc', '#8a120e'], ['#8a120e', '#efe6d2'], ['#2a3a30', '#e8e0cc'], ['#d8b030', '#141210']][kind % 4];
  c.fillStyle = bg; c.fillRect(0, 0, 512, 160); c.strokeStyle = fg; c.lineWidth = 8; c.strokeRect(10, 10, 492, 140);
  c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
  let size = 84; c.font = `bold ${size}px 'Bebas Neue', Impact, 'Arial Narrow', sans-serif`;
  while (c.measureText(text).width > 450 && size > 30) { size -= 4; c.font = `bold ${size}px 'Bebas Neue', Impact, 'Arial Narrow', sans-serif`; }
  c.fillText(text, 256, 84);
  for (let i = 0; i < 30; i++) { c.fillStyle = `rgba(${60 + R() * 40 | 0},34,18,${0.25 + R() * 0.5})`; c.beginPath(); c.arc(R() * 512, R() < 0.5 ? R() * 20 + 4 : 140 + R() * 16, 2 + R() * 8, 0, 7); c.fill(); }
  const grd = c.createLinearGradient(0, 0, 0, 160); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(40,20,10,0.35)'); c.fillStyle = grd; c.fillRect(0, 0, 512, 160);
  if (R() < 0.6) { c.fillStyle = 'rgba(110,8,6,0.75)'; const x = R() * 400 + 50; c.beginPath(); c.arc(x, 40, 18, 0, 7); c.fill(); for (let k = 0; k < 4; k++) c.fillRect(x - 12 + R() * 24, 40, 3, 30 + R() * 90); }
  return (cache[key] = texOf(c0, true));
}

// floor drain grate
export function drainTexture() {
  if (cache.drain) return cache.drain;
  const c0 = cv(128, 128), c = c0.getContext('2d');
  c.fillStyle = 'rgba(0,0,0,0)'; c.clearRect(0, 0, 128, 128);
  c.fillStyle = '#2a2624'; c.beginPath(); c.arc(64, 64, 60, 0, 7); c.fill();
  c.fillStyle = '#050403'; for (let i = 0; i < 9; i++) c.fillRect(22, 18 + i * 10.5, 84, 5);
  c.strokeStyle = '#5a5450'; c.lineWidth = 6; c.beginPath(); c.arc(64, 64, 58, 0, 7); c.stroke();
  const gr = c.createRadialGradient(64, 64, 30, 64, 64, 64); gr.addColorStop(0, 'rgba(90,10,6,0)'); gr.addColorStop(1, 'rgba(90,10,6,0.5)'); c.fillStyle = gr; c.beginPath(); c.arc(64, 64, 62, 0, 7); c.fill();
  return (cache.drain = texOf(c0, true, false));
}
