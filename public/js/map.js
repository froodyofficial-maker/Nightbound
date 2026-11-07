// Deterministic map generation: layout, colliders, interactables, nav grid.
// The same seed produces the exact same map on host and every client.
import { HALF } from './config.js';
import { buildMeatworks } from './meatworks.js';
import { buildGrannyHouse } from './grannyhouse.js';
import { THEMES, BIG_MAPS, BR_MAPS } from './themes.js';
import { rollItem } from './brdata.js';

export function rng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a, b) => a + f() * (b - a);
  f.int = (a, b) => Math.floor(f.range(a, b + 1));
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  f.shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  return f;
}

const T = 0.18; // wall half-thickness

// ---------- template context: place walls, windows, barricades, props in a rotated local frame ----------
export function makeCtx(M, R, cx, cz, rot) {
  const rp = (x, z) => {
    switch (rot) {
      case 1: return [cx - z, cz + x];
      case 2: return [cx - x, cz - z];
      case 3: return [cx + z, cz - x];
      default: return [cx + x, cz + z];
    }
  };
  const odd = rot % 2 === 1;
  const rax = a => (odd ? (a === 'x' ? 'z' : 'x') : a);
  const C = {
    rp,
    box(x, z, hx, hz, h, kind = 'crate', style = 'wood') {
      const [wx, wz] = rp(x, z);
      const b = { x: wx, z: wz, hx: odd ? hz : hx, hz: odd ? hx : hz, h, kind, style };
      M.boxes.push(b); return b;
    },
    circle(x, z, r, h, kind = 'rock') {
      const [wx, wz] = rp(x, z);
      const c = { x: wx, z: wz, r, h, kind, s: R.range(0.85, 1.2), rot: R.range(0, 6.28) };
      M.circles.push(c);
      if (kind === 'tree') M.trees.push(c); else if (kind === 'rock') M.rocks.push(c); else (M.props ||= []).push(c);
      return c;
    },
    seg(x1, z1, x2, z2, style, h = 3) {
      const [a1, b1] = rp(x1, z1), [a2, b2] = rp(x2, z2);
      const len = Math.hypot(a2 - a1, b2 - b1);
      if (len < 0.05) return;
      const vert = Math.abs(a1 - a2) < Math.abs(b1 - b2);
      M.boxes.push({
        x: (a1 + a2) / 2, z: (b1 + b2) / 2,
        hx: vert ? T : len / 2 + T, hz: vert ? len / 2 + T : T,
        h: h * R.range(0.82, 1.05), kind: 'wall', style,
      });
    },
    windowWall(x1, z1, x2, z2, style, f = 0.5, w = 1.5, h = 3) {
      const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
      const cxl = x1 + dx * f, czl = z1 + dz * f;
      C.seg(x1, z1, cxl - ux * w / 2, czl - uz * w / 2, style, h);
      C.seg(cxl + ux * w / 2, czl + uz * w / 2, x2, z2, style, h);
      const [wx, wz] = rp(cxl, czl);
      const along = Math.abs(ux) > Math.abs(uz) ? 'x' : 'z';
      const wAlongWorld = rax(along);
      const sill = { x: wx, z: wz, hx: wAlongWorld === 'x' ? w / 2 : 0.22, hz: wAlongWorld === 'z' ? w / 2 : 0.22, h: 0.95, kind: 'sill', style };
      M.boxes.push(sill);
      M.visual.push({ type: 'lintel', x: wx, z: wz, hx: sill.hx === 0.22 ? T : sill.hx, hz: sill.hz === 0.22 ? T : sill.hz, y0: 2.15, y1: h * 0.95, style });
      M.windows.push({ id: M.windows.length, x: wx, z: wz, axis: wAlongWorld === 'x' ? 'z' : 'x', half: w / 2 });
    },
    doorWall(x1, z1, x2, z2, style, f = 0.5, w = 1.9, barricade = false, h = 3) {
      const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
      const cxl = x1 + dx * f, czl = z1 + dz * f;
      C.seg(x1, z1, cxl - ux * w / 2, czl - uz * w / 2, style, h);
      C.seg(cxl + ux * w / 2, czl + uz * w / 2, x2, z2, style, h);
      if (barricade) {
        const along = Math.abs(ux) > Math.abs(uz) ? 'x' : 'z';
        C.barricade(cxl, czl, along === 'x' ? 'z' : 'x', w / 2 - T);
      }
    },
    barricade(x, z, crossAxisLocal, half = 0.9) {
      const [wx, wz] = rp(x, z);
      M.bars.push({ id: M.bars.length, x: wx, z: wz, axis: rax(crossAxisLocal), half, lean: R() < 0.5 ? 1 : -1 });
    },
  };
  return C;
}



export function buildMap(seed, map = 'woods') {
  const M = map === 'meatworks' ? buildMeatworks(seed) : map === 'granny' ? buildGrannyHouse(seed) : buildArena(seed, map);
  if (M.br) { M.chests = []; addBRLoot(M, seed); return M; }
  addChests(M, seed);
  return M;
}
// Chests: a few on every map, away from generators, hooks, gates and spawns, each one on open ground
// the bots can walk to. What's inside is rolled when it is first opened (sim).
function addChests(M, seed) {
  const R = rng(seed * 31 + 7), half = M.half || HALF, n = half > 60 ? 7 : 4;
  M.chests = [];
  if (!M.grid) buildGrid(M);
  const away = (x, z) => (M.keepClear || []).every(k => Math.hypot(k.x - x, k.z - z) > k.r) && [...M.gens, ...M.cages].every(o => Math.hypot(o.x - x, o.z - z) > 6) && M.gates.every(g => Math.hypot(g.x - x, g.z - z) > 8)
    && M.chests.every(c => Math.hypot(c.x - x, c.z - z) > half * 0.55) && M.spawns.survivors.every(s => Math.hypot(s.x - x, s.z - z) > 5);
  for (let tries = 0; tries < 400 && M.chests.length < n; tries++) {
    const p = freePoint(M, (R() * 2 - 1) * half * 0.85, (R() * 2 - 1) * half * 0.85, 1.0);
    if (Math.abs(p.x) > half - 2 || Math.abs(p.z) > half - 2 || !away(p.x, p.z) || overlaps(M, p.x, p.z, 1.0)) continue;
    const k = cellOf(M, p.x, p.z); if (k < 0 || M.grid.type[k] === 1) continue;
    M.chests.push({ id: M.chests.length, x: p.x, z: p.z, rot: R() * Math.PI * 2 });
  }
  // relax the spacing if the map was too tight
  for (let tries = 0; tries < 300 && M.chests.length < Math.min(3, n); tries++) {
    const p = freePoint(M, (R() * 2 - 1) * half * 0.8, (R() * 2 - 1) * half * 0.8, 1.0);
    if (overlaps(M, p.x, p.z, 1.0) || M.chests.some(c => Math.hypot(c.x - p.x, c.z - p.z) < 10) || [...M.gens, ...M.cages].some(o => Math.hypot(o.x - p.x, o.z - p.z) < 4)) continue;
    const k = cellOf(M, p.x, p.z); if (k < 0 || M.grid.type[k] === 1) continue;
    M.chests.push({ id: M.chests.length, x: p.x, z: p.z, rot: R() * Math.PI * 2 });
  }
  for (const c of M.chests) M.circles.push({ x: c.x, z: c.z, r: 0.5, h: 0.75, kind: 'chest', nocast: true });
  M.hash = null; buildGrid(M);
}
function buildArena(seed, map) {
  const R = rng(seed);
  const BIG = BIG_MAPS[map] || BR_MAPS[map] || null; // Infection maps reuse a theme on a bigger grid
  const BR = !!(BIG && BIG.br); // Fortnight's island
  const base = BIG ? BIG.base : map;
  const TH = THEMES[base] || null; // outdoor themes (marsh, carnival, snow); woods when null
  const N = BIG ? BIG.N : 5, half = N * 10 + 6, off = (N - 1) * 10, mid = (N - 1) / 2;
  const M = {
    seed, map: TH ? base : 'woods', mapId: map, half, props: [], pools: [], lights: [], boxes: [], circles: [], windows: [], bars: [], gens: [], cages: [], gates: [],
    visual: [], trees: [], rocks: [], spawns: { survivors: [], killer: null }, br: BR,
  };
  const theme = TH ? TH.style : R.pick(['brick', 'wood', 'stone']);

  const S = theme;
  const templates = TH ? TH.templates(S, M, R) : {
    shack(C) {
      C.windowWall(-4, -3, 4, -3, S);
      C.seg(4, -3, 4, 3, S);
      C.doorWall(4, 3, -4, 3, S, 0.7, 1.8);
      C.windowWall(-4, 3, -4, -3, S);
      C.seg(-7, -6, -7, -1, 'wood', 2.4);
      C.box(-7, 2, 0.8, 0.8, 1.5, 'crate', 'wood');
      C.barricade(-7, 0.1, 'x', 0.88);
      return { G: [1.8, 0.3], C: [6.5, 5.5], trees: [[6, -6], [-3, 7], [7.5, 1]] };
    },
    lwall(C) {
      C.windowWall(-6, -3, 3, -3, S, 0.45);
      C.seg(3, -3, 3, 3, S);
      C.circle(3, 5.9, 0.95, 2.2, 'rock');
      C.barricade(3, 4.1, 'x', 0.85);
      return { G: [-3, 2.5], C: [7, -6.5], trees: [[-7, 6], [7, 6], [-6, -7]] };
    },
    jungle(C) {
      C.seg(-7, 0, -1, 0, S);
      C.barricade(0, 0, 'z', 0.82);
      C.windowWall(1, 0, 7, 0, S, 0.55);
      C.seg(-7, 0, -7, 3.5, S);
      C.seg(7, 0, 7, -3.5, S);
      return { G: [3, 4.6], C: [-4, -5], trees: [[-8, -7], [8, 7], [-6, 7]] };
    },
    stones(C) {
      C.box(-2.5, 0, 1.6, 0.55, 2.7, 'stone', 'stone');
      C.box(2.5, 0, 1.6, 0.55, 2.4, 'stone', 'stone');
      C.barricade(0, 0, 'z', 0.88);
      C.circle(-5, 4, 0.7, 2.4, 'rock');
      C.circle(5, -4, 0.7, 2.2, 'rock');
      C.circle(0, 6.5, 0.6, 2.6, 'rock');
      return { G: [4.5, 4], C: [-5, -4.5], trees: [[-7, -1], [7, 1], [1, -7]] };
    },
    barn(C) {
      C.windowWall(-6, -4, 0, -4, 'wood', 0.5);
      C.windowWall(0, -4, 6, -4, 'wood', 0.5);
      C.doorWall(6, 4, -6, 4, 'wood', 0.5, 2.0, true);
      C.doorWall(6, -4, 6, 4, 'wood', 0.5, 1.8);
      C.windowWall(-6, 4, -6, -4, 'wood', 0.5);
      C.seg(2, -4, 2, -1, 'wood');
      C.box(4.2, -2.6, 0.9, 0.6, 1.3, 'hay', 'hay');
      return { G: [-3, 1.2], C: [8, -7], trees: [[-8.5, 7], [8.5, 6.5]] };
    },
    grove(C) {
      C.box(-1.8, 0, 0.8, 0.8, 1.6, 'crate', 'wood');
      C.box(1.8, 0, 0.8, 0.8, 1.6, 'crate', 'wood');
      C.box(-1.8, 1.4, 0.6, 0.5, 1.1, 'crate', 'wood');
      C.barricade(0, 0, 'z', 0.92);
      return { G: [4, -3.5], C: [-4, 4], trees: [[-5, -4], [-6.5, 1], [3, 5.5], [6.5, 2], [-2, -6.5], [0.5, -5.5], [-1, 6.5], [6, 6.5]] };
    },
    open(C) {
      C.circle(-1, -1, 1.2, 1.6, 'rock');
      C.box(-4, 3, 1.4, 0.5, 1.1, 'log', 'wood');
      return { G: [2.5, 2.5], C: [-3.5, -4.5], trees: [[5, -5], [-6, -6], [6, 5], [-6, 6]] };
    },
    chapel(C) {
      C.windowWall(-8, -5.5, -2, -5.5, 'stone', 0.5);
      C.doorWall(-2, -5.5, 2, -5.5, 'stone', 0.5, 2.0, true);
      C.windowWall(2, -5.5, 8, -5.5, 'stone', 0.5);
      C.windowWall(8, 5.5, 0, 5.5, 'stone', 0.5);
      C.doorWall(0, 5.5, -8, 5.5, 'stone', 0.45, 1.9);
      C.doorWall(8, -5.5, 8, 5.5, 'stone', 0.5, 2.0, true);
      C.windowWall(-8, 5.5, -8, -5.5, 'stone', 0.5);
      C.windowWall(-3, -2, -3, 3.2, 'stone', 0.5, 1.4);
      C.box(5.6, 3.2, 1.0, 0.45, 1.0, 'altar', 'stone');
      return { G: [2.5, -0.5], C: null, trees: [] };
    },
  };

  // ---------- place cells ----------
  const cells = [];
  const tnames = TH ? TH.names : BR ? ['shack', 'shack', 'barn', 'barn', 'chapel', 'lwall', 'jungle', 'stones', 'grove', 'grove', 'open', 'open'] : ['shack', 'lwall', 'jungle', 'stones', 'barn', 'grove', 'open', 'shack', 'lwall', 'jungle', 'stones', 'grove'];
  const centre = TH ? TH.center : 'chapel';
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const cx = -off + i * 20, cz = -off + j * 20;
    if (i === mid && j === mid) { cells.push({ i, j, cx, cz, t: centre, rot: R.int(0, 1) * 2 }); continue; }
    cells.push({ i, j, cx: cx + R.range(-1, 1), cz: cz + R.range(-1, 1), t: R.pick(tnames), rot: R.int(0, 3) });
  }
  // survivors spawn in one corner, killer in the opposite one: keep those corner cells open
  const corner = R.int(0, 3);
  const corners = [[0, 0], [N - 1, N - 1], [N - 1, 0], [0, N - 1]];
  const sc = corners[corner], kc = corners[corner ^ 1];
  for (const c of cells) if ((c.i === sc[0] && c.j === sc[1]) || (c.i === kc[0] && c.j === kc[1])) c.t = 'open';
  // Fortnight: a few mountains (each takes a 3x3 block of cells: woods and rock, no buildings), some hills
  const mts = [], hills = [];
  if (BR) {
    const pickable = R.shuffle(cells.filter(c => c.i >= 1 && c.j >= 1 && c.i <= N - 2 && c.j <= N - 2 && Math.max(Math.abs(c.i - mid), Math.abs(c.j - mid)) >= 2));
    for (const c of pickable) {
      if (mts.length >= 4) break;
      if (mts.some(m => Math.max(Math.abs(m.i - c.i), Math.abs(m.j - c.j)) < 3)) continue;
      const h = R.range(13, 22);
      mts.push({ i: c.i, j: c.j, x: c.cx, z: c.cz, h, r: R.range(27, 33) });
      for (const o of cells) if (Math.abs(o.i - c.i) <= 1 && Math.abs(o.j - c.j) <= 1) { o.t = o === c ? 'open' : R() < 0.6 ? 'grove' : 'stones'; o.mtn = true; }
    }
    for (const c of R.shuffle(cells.filter(c => !c.mtn && (c.t === 'open' || c.t === 'grove')))) { if (hills.length >= 9) break; hills.push({ x: c.cx + R.range(-4, 4), z: c.cz + R.range(-4, 4), h: R.range(3, 6.5), r: R.range(11, 16) }); }
  }

  const slots = [];
  for (const c of cells) {
    const C = makeCtx(M, R, c.cx, c.cz, c.rot);
    const res = templates[c.t](C);
    c.G = res.G && C.rp(res.G[0], res.G[1]);
    c.C = res.C && C.rp(res.C[0], res.C[1]);
    for (const [x, z] of res.trees) if (R() < 0.85) C.circle(x + R.range(-0.5, 0.5), z + R.range(-0.5, 0.5), R.range(0.32, 0.5), R.range(7, 11), 'tree');
    slots.push(c);
  }

  // generators: chapel + 6 spread-out cells
  const chapel = cells.find(c => c.t === centre);
  const genCells = BR ? [] : [chapel];
  const isCorner = c => (c.i === sc[0] && c.j === sc[1]) || (c.i === kc[0] && c.j === kc[1]);
  const pool = R.shuffle(cells.filter(c => c !== chapel && !isCorner(c)));
  const nGens = BIG ? BIG.gens : 7, nCages = BIG ? BIG.cages : 7;
  for (let minD = 30; genCells.length < nGens && minD > 0; minD -= 4)
    for (const c of pool) {
      if (genCells.length >= nGens) break;
      if (genCells.includes(c)) continue;
      if (genCells.every(g => Math.hypot(g.cx - c.cx, g.cz - c.cz) >= minD)) genCells.push(c);
    }
  for (const c of genCells) {
    const [x, z] = c.G;
    M.gens.push({ id: M.gens.length, x, z, rot: R.int(0, 3) * Math.PI / 2 });
    M.boxes.push({ x, z, hx: 0.62, hz: 0.62, h: 1.25, kind: 'gen', style: 'metal', nocast: true });
  }
  // cages: 7 spread-out cells (prefer cells without a gen)
  const cagePool = R.shuffle(cells.filter(c => c.C));
  cagePool.sort((a, b) => (genCells.includes(a) ? 1 : 0) - (genCells.includes(b) ? 1 : 0));
  const cageCells = [];
  for (let minD = 34; cageCells.length < nCages && minD > 0; minD -= 4)
    for (const c of cagePool) {
      if (cageCells.length >= nCages) break;
      if (cageCells.includes(c)) continue;
      if (cageCells.every(g => Math.hypot(g.cx - c.cx, g.cz - c.cz) >= minD)) cageCells.push(c);
    }
  for (const c of cageCells) {
    const [x, z] = c.C;
    M.cages.push({ id: M.cages.length, x, z });
    M.circles.push({ x, z, r: 0.75, h: 2.6, kind: 'cage', nocast: true });
  }

  // ---------- boundary + exit gates ----------
  const HALF = half, gr = half - 26;
  const gx1 = Math.round(R.range(-gr, gr)), gx2 = Math.round(R.range(-gr, gr));
  const gateDefs = [{ x: gx1, z: -HALF, dir: -1 }, { x: gx2, z: HALF, dir: 1 }];
  const BW = 0.5, BH = 4.2;
  const bound = (x1, x2, z) => { if (x2 - x1 > 0.1) M.boxes.push({ x: (x1 + x2) / 2, z, hx: (x2 - x1) / 2, hz: BW, h: BH, kind: 'boundary', style: TH ? TH.boundary : 'stone' }); };
  if (BR) { bound(-HALF - BW, HALF + BW, -HALF); bound(-HALF - BW, HALF + BW, HALF); } else {
  bound(-HALF - BW, gx1 - 2.4, -HALF); bound(gx1 + 2.4, HALF + BW, -HALF);
  bound(-HALF - BW, gx2 - 2.4, HALF); bound(gx2 + 2.4, HALF + BW, HALF); }
  M.boxes.push({ x: -HALF, z: 0, hx: BW, hz: HALF + BW, h: BH, kind: 'boundary', style: TH ? TH.boundary : 'stone' });
  M.boxes.push({ x: HALF, z: 0, hx: BW, hz: HALF + BW, h: BH, kind: 'boundary', style: TH ? TH.boundary : 'stone' });
  if (!BR) addGates(M, gateDefs, TH ? TH.boundary : 'stone');
  if (BR) M.brCells = cells.map(c => ({ t: c.t, cx: c.cx, cz: c.cz, i: c.i, j: c.j, G: c.G, C: c.C }));

  // ---------- spawns ----------
  const ccx = -off + sc[0] * 20, ccz = -off + sc[1] * 20;
  const kcx = -off + kc[0] * 20, kcz = -off + kc[1] * 20;
  for (let i = 0; i < 4; i++) M.spawns.survivors.push(freePoint(M, ccx + (i % 2) * 2.4 - 1.2, ccz + Math.floor(i / 2) * 2.4 - 1.2, 0.6));
  // big maps: survivor groups start spread around the edges (first group in the corner above)
  if (BIG) for (const [a, b] of [[mid, 0], [0, mid], [N - 1, mid], [mid, N - 1], [sc[0], N - 1 - sc[1]]]) {
    if ((a === kc[0] && b === kc[1]) || Math.hypot(a - kc[0], b - kc[1]) < 2) continue;
    const x = -off + a * 20, z = -off + b * 20, p = freePoint(M, x, z, 0.6);
    M.spawns.survivors.push(p);
  }
  M.spawns.killer = freePoint(M, kcx, kcz, 0.8);
  M.spawns.killerYaw = Math.atan2(-(ccx - kcx), -(ccz - kcz));
  M.spawns.survivorYaw = Math.atan2(-(kcx - ccx), -(kcz - ccz));

  // ---------- Fortnight: small cabins and sheds dotted around, each with loot of its own ----------
  M.brHuts = [];
  if (BR) {
    const flatCells = new Set(cells.filter(c => ['shack', 'barn', 'chapel', 'lwall', 'jungle'].includes(c.t)).map(c => c));
    const clearAt = (x, z, r) => !M.boxes.some(b => Math.abs(x - b.x) < b.hx + r && Math.abs(z - b.z) < b.hz + r) && !M.circles.some(c => c.kind !== 'tree' && c.kind !== 'rock' && Math.hypot(x - c.x, z - c.z) < c.r + r);
    for (let t = 0; t < 900 && M.brHuts.length < 30; t++) {
      const x = R.range(-HALF + 9, HALF - 9), z = R.range(-HALF + 9, HALF - 9);
      if (mts.some(m => Math.hypot(x - m.x, z - m.z) < m.r * 0.8)) continue;
      if ([...flatCells].some(c => Math.max(Math.abs(x - c.cx), Math.abs(z - c.cz)) < 12)) continue;
      if (M.brHuts.some(h => Math.hypot(h.x - x, h.z - z) < 17) || !clearAt(x, z, 4.5)) continue;
      // clear the plot of trees and rocks
      const gone = c => (c.kind === 'tree' || c.kind === 'rock') && Math.hypot(x - c.x, z - c.z) < c.r + 4;
      M.circles = M.circles.filter(c => !gone(c)); M.trees = M.trees.filter(c => !gone(c)); M.rocks = M.rocks.filter(c => !gone(c));
      const rot = R.int(0, 3), C = makeCtx(M, R, x, z, rot), st = R.pick(['wood', 'wood', 'brick', 'stone']), kind = R() < 0.6 ? 'cabin' : 'shed';
      if (kind === 'cabin') {
        C.doorWall(-2.4, -2.1, 2.4, -2.1, st, 0.5, 1.7); C.windowWall(2.4, -2.1, 2.4, 2.1, st, 0.5, 1.0); C.seg(2.4, 2.1, -2.4, 2.1, st, 2.8); C.seg(-2.4, 2.1, -2.4, -2.1, st, 2.8);
        C.box(-1.7, 1.45, 0.45, 0.4, 0.8, 'crate', 'wood');
      } else {
        C.doorWall(-1.7, -1.6, 1.7, -1.6, st, 0.5, 1.6, false, 2.5); C.seg(1.7, -1.6, 1.7, 1.6, st, 2.5); C.seg(1.7, 1.6, -1.7, 1.6, st, 2.5); C.windowWall(-1.7, 1.6, -1.7, -1.6, st, 0.5, 0.9, 2.5);
      }
      const [lx, lz] = C.rp(0.5, 0.5);
      M.brHuts.push({ x, z, rot, kind, loot: { x: lx, z: lz } });
    }
  }
  // ---------- scatter trees ----------
  const near = (x, z, pad) => {
    for (const b of M.boxes) if (Math.abs(x - b.x) < b.hx + pad && Math.abs(z - b.z) < b.hz + pad) return true;
    for (const c of M.circles) if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true;
    for (const w of M.windows) if (Math.hypot(x - w.x, z - w.z) < pad + 2) return true;
    for (const w of M.bars) if (Math.hypot(x - w.x, z - w.z) < pad + 2.2) return true;
    for (const g of M.gens) if (Math.hypot(x - g.x, z - g.z) < pad + 2.5) return true;
    for (const g of M.cages) if (Math.hypot(x - g.x, z - g.z) < pad + 2.5) return true;
    for (const g of M.gates) if (Math.hypot(x - g.x, z - g.z) < 8 || Math.hypot(x - g.sx, z - g.sz) < 3) return true;
    for (const s of [...M.spawns.survivors, M.spawns.killer]) if (Math.hypot(x - s.x, z - s.z) < 4) return true;
    return false;
  };
  const SC0 = TH ? TH.scatter : { n: 110, tree: 0.8 }, SC = { ...SC0, n: Math.round(SC0.n * N * N / 25) };
  for (let n = 0, placed = 0; n < 900 * N * N / 25 && placed < SC.n; n++) {
    const x = R.range(-HALF + 2, HALF - 2), z = R.range(-HALF + 2, HALF - 2);
    if (near(x, z, 1.6)) continue;
    if (SC.prop && R() < SC.prop.p) { const pr = R.pick(SC.prop.kinds); const c = push(M, { x, z, r: pr.r, h: pr.h, kind: 'prop', prop: pr.id, s: R.range(0.85, 1.15), rot: R.range(0, 6.28) }); M.props.push(c); placed++; continue; }
    if (R() < SC.tree) { M.trees.push(push(M, { x, z, r: R.range(0.3, 0.55), h: R.range(7, 12), kind: 'tree', s: R.range(0.8, 1.25), rot: R.range(0, 6.28) })); }
    else M.rocks.push(push(M, { x, z, r: R.range(0.5, 1.1), h: R.range(0.8, 1.8), kind: 'rock', s: R.range(0.8, 1.2), rot: R.range(0, 6.28) }));
    placed++;
  }
  if (TH && TH.extra) TH.extra(M, R, cells, near);
  if (BR) {
    // flat ground under every building, the terrain rises everywhere else
    const flats = cells.filter(c => !c.mtn && ['shack', 'barn', 'chapel', 'lwall', 'jungle'].includes(c.t)).map(c => ({ x: c.cx, z: c.cz, half: 9.5 }));
    for (const h of M.brHuts) flats.push({ x: h.x, z: h.z, half: 3.6 });
    buildTerrain(M, { mts: mts.map(({ x, z, h, r }) => ({ x, z, h, r })), hills, flats, p: [R.range(0, 6), R.range(0, 6), R.range(0, 6)] });
  }

  buildGrid(M);
  return M;
}

function push(M, c) { M.circles.push(c); return c; }

// ---------- terrain (Fortnight's island): a height grid built once from the map seed ----------
const sst = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function buildTerrain(M, T) {
  const ext = M.half + 14, n = Math.ceil(ext * 2) + 1, grid = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -ext + i, z = -ext + j;
    let h = 0;
    for (const m of T.mts) { const d = Math.hypot(x - m.x, z - m.z); if (d < m.r) { const k = 0.5 + 0.5 * Math.cos(Math.PI * d / m.r); h += m.h * k * (0.86 + 0.14 * Math.sin(x * 0.31 + z * 0.23)); } }
    for (const m of T.hills) { const d = Math.hypot(x - m.x, z - m.z); if (d < m.r) h += m.h * (0.5 + 0.5 * Math.cos(Math.PI * d / m.r)); }
    h += 0.9 * (1 + Math.sin(x * 0.043 + T.p[0]) * Math.cos(z * 0.051 + T.p[1])) + 0.45 * (1 + Math.sin(x * 0.11 + z * 0.083 + T.p[2]));
    let mask = 1;
    for (const f of T.flats) { const d = Math.max(Math.abs(x - f.x), Math.abs(z - f.z)) - f.half; if (d < 9) mask = Math.min(mask, sst(0, 9, d)); }
    if (Math.abs(x) > M.half - 3 || Math.abs(z) > M.half - 3) mask *= 1 - sst(M.half - 3, M.half + 2, Math.max(Math.abs(x), Math.abs(z))) * 0.7;
    grid[j * n + i] = h * mask;
  }
  M.terrain = { ...T, ext, n, grid };
}
// ground height at (x, z): 0 on every map but the island
export function terrainH(M, x, z) {
  const T = M && M.terrain; if (!T) return 0;
  const fx = Math.max(0, Math.min(T.n - 1.001, x + T.ext)), fz = Math.max(0, Math.min(T.n - 1.001, z + T.ext));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, n = T.n, g = T.grid;
  return (g[j * n + i] * (1 - u) + g[j * n + i + 1] * u) * (1 - v) + (g[(j + 1) * n + i] * (1 - u) + g[(j + 1) * n + i + 1] * u) * v;
}

// ---------- Fortnight: chests, floor loot, drop points and place names ----------
const BR_NAMES = ['Gravemoor Chapel', 'Hollow Farm', "Crow's Rest", 'Ashen Pines', 'Mire End', 'Lantern Row', 'Blackwater', 'Rotting Mill', "Widow's Hill", 'Saltmarsh', 'Bonefield', 'Cold Hearth'];
function addBRLoot(M, seed) {
  const R = rng(seed * 53 + 11), g = M.grid, N = g.N;
  // everything is placed only where you can walk to from the middle of the island
  const reach = new Uint8Array(N * N), q = [];
  let s0 = cellOf(M, 0, 0); for (let r = 0; g.type[s0] === 1 && r < 400; r++) s0 = cellOf(M, (R() - 0.5) * 20, (R() - 0.5) * 20);
  reach[s0] = 1; q.push(s0);
  while (q.length) { const k = q.pop(), i = k % N, j = (k / N) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue; const nk = nj * N + ni; if (!reach[nk] && g.type[nk] !== 1) { reach[nk] = 1; q.push(nk); } } }
  M.brReach = reach;
  const ok = (x, z, r = 0.6) => { if (Math.abs(x) > M.half - 2 || Math.abs(z) > M.half - 2) return false; const k = cellOf(M, x, z); return reach[k] && g.type[k] === 0 && !overlaps(M, x, z, r); };
  const spot = (x, z, r) => { const p = freePoint(M, x, z, r); return ok(p.x, p.z, r) ? p : null; };
  const chests = [], loot = [];
  const used = (x, z, d) => chests.some(c => Math.hypot(c.x - x, c.z - z) < d) || loot.some(c => Math.hypot(c.x - x, c.z - z) < d);
  const indoor = new Set(['shack', 'barn', 'chapel', 'lwall', 'jungle']);
  for (const c of M.brCells) {
    // a chest in most buildings (where the generator would have stood), loot by the walls outside
    if (c.G && indoor.has(c.t) && R() < 0.8) { const p = spot(c.G[0], c.G[1], 0.7); if (p && !used(p.x, p.z, 4)) chests.push({ id: chests.length, x: p.x, z: p.z, rot: R.int(0, 3) * Math.PI / 2 }); }
    if (c.t === 'chapel' || c.t === 'barn') { const p = spot(c.cx + R.range(-4, 4), c.cz + R.range(-3, 3), 0.7); if (p && !used(p.x, p.z, 4)) chests.push({ id: chests.length, x: p.x, z: p.z, rot: R() * 6.28 }); }
    const nFloor = indoor.has(c.t) ? 3 : 1;
    for (let n = 0, tries = 0; n < nFloor && tries < 12; tries++) {
      const base = n === 0 && c.C ? c.C : [c.cx + R.range(-7, 7), c.cz + R.range(-7, 7)];
      const p = spot(base[0], base[1], 0.45); if (!p || used(p.x, p.z, 2.5)) continue;
      const r = R(), it = rollItem(R, r < 0.42 ? 'w' : r < 0.68 ? 'h' : 'a');
      loot.push({ id: loot.length, x: +p.x.toFixed(2), z: +p.z.toFixed(2), ...it }); n++;
    }
  }
  // the cabins: a weapon in each, and now and then a heal by the door
  for (const h of M.brHuts || []) {
    const lp = spot(h.loot.x, h.loot.z, 0.35); if (!lp) continue;
    const it = rollItem(R, 'w', 0.3); loot.push({ id: loot.length, x: +lp.x.toFixed(2), z: +lp.z.toFixed(2), ...it });
    if (R() < 0.5) { const p = spot(h.x + R.range(-1, 1), h.z + R.range(-1, 1), 0.35); if (p && !used(p.x, p.z, 1)) loot.push({ id: loot.length, x: +p.x.toFixed(2), z: +p.z.toFixed(2), ...rollItem(R, 'h') }); }
  }
  // sacks and rucksacks: small stashes everywhere, searched like chests but with less inside
  const sacks = [];
  const nearSomething = (x, z) => M.circles.some(c => (c.kind === 'tree' || c.kind === 'rock') && Math.hypot(x - c.x, z - c.z) < c.r + 1.6) || M.boxes.some(b => b.kind === 'wall' && Math.abs(x - b.x) < b.hx + 1.4 && Math.abs(z - b.z) < b.hz + 1.4);
  for (let t = 0; t < 4000 && sacks.length < 120; t++) {
    const x = R.range(-M.half + 3, M.half - 3), z = R.range(-M.half + 3, M.half - 3);
    if (!ok(x, z, 0.4) || !nearSomething(x, z) || sacks.some(s => Math.hypot(s.x - x, s.z - z) < 9) || used(x, z, 3)) continue;
    sacks.push({ id: sacks.length, x: +x.toFixed(2), z: +z.toFixed(2), rot: +(R() * 6.28).toFixed(2), kind: R() < 0.55 ? 'sack' : 'pack' });
  }
  for (const h of M.brHuts || []) if (R() < 0.45) { const [x, z] = [h.x + Math.cos(h.rot) * 1.2, h.z - Math.sin(h.rot) * 1.2]; if (ok(x, z, 0.35)) sacks.push({ id: sacks.length, x: +x.toFixed(2), z: +z.toFixed(2), rot: +(R() * 6.28).toFixed(2), kind: 'pack' }); }
  M.br = { chests, loot, sacks };
  // drop points: spread out across the island (farthest-point sampling)
  const cand = [];
  for (let t = 0; t < 1500 && cand.length < 500; t++) { const x = R.range(-M.half + 6, M.half - 6), z = R.range(-M.half + 6, M.half - 6); if (ok(x, z, 0.8)) cand.push({ x, z }); }
  const sp = [cand[0]];
  while (sp.length < 24 && sp.length < cand.length) {
    let best = null, bd = -1;
    for (const c of cand) { const d = Math.min(...sp.map(s => Math.hypot(s.x - c.x, s.z - c.z))); if (d > bd) { bd = d; best = c; } }
    sp.push(best);
  }
  M.spawns.survivors = sp.map(p => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) }));
  M.spawns.killer = M.spawns.survivors[0];
  // place names for the map, on the cells with the biggest buildings
  const named = M.brCells.filter(c => c.t === 'chapel' || c.t === 'barn').sort((a, b) => (a.i * 7 + a.j * 3) % 5 - (b.i * 7 + b.j * 3) % 5);
  const places = [];
  for (const c of named) { if (places.length >= BR_NAMES.length - 1) break; if (places.some(p => Math.hypot(p.x - c.cx, p.z - c.cz) < 38)) continue; places.push({ x: c.cx, z: c.cz, n: '' }); }
  const mid = places.reduce((b, p) => Math.hypot(p.x, p.z) < Math.hypot(b.x, b.z) ? p : b, places[0] || { x: 0, z: 0 });
  let ni = seed % (BR_NAMES.length - 1);
  places.forEach(p => { p.n = p === mid ? BR_NAMES[0] : BR_NAMES[1 + (ni++ % (BR_NAMES.length - 1))]; });
  M.br.places = places;
}

export function addGates(M, gateDefs, style = 'stone') {
  for (const g of gateDefs) {
    const id = M.gates.length;
    // gate pillars + an exit corridor beyond the wall
    M.boxes.push({ x: g.x - 2.75, z: g.z, hx: 0.45, hz: 0.75, h: 5.4, kind: 'pillar', style: style });
    M.boxes.push({ x: g.x + 2.75, z: g.z, hx: 0.45, hz: 0.75, h: 5.4, kind: 'pillar', style: style });
    M.boxes.push({ x: g.x - 2.6, z: g.z + g.dir * 5, hx: 0.3, hz: 4.5, h: 3.5, kind: 'boundary', style: style });
    M.boxes.push({ x: g.x + 2.6, z: g.z + g.dir * 5, hx: 0.3, hz: 4.5, h: 3.5, kind: 'boundary', style: style });
    M.boxes.push({ x: g.x, z: g.z + g.dir * 9.8, hx: 2.9, hz: 0.3, h: 3.5, kind: 'boundary', style: style });
    const sx = g.x + 4.2, sz = g.z - g.dir * 1.3;
    M.boxes.push({ x: sx, z: sz, hx: 0.3, hz: 0.25, h: 1.5, kind: 'switch', style: 'metal' });
    M.gates.push({ id, x: g.x, z: g.z, dir: g.dir, sx, sz, door: { x: g.x, z: g.z, hx: 2.3, hz: 0.25, h: 4 } });
  }

}


// ---------- collision ----------
export function dynBoxes(M, st) {
  const out = [];
  if (st) {
    for (const b of M.bars) if (st.bars[b.id] === 1) out.push(barBox(b));
    for (const g of M.gates) if (!st.gates[g.id].open) out.push(g.door);
  } else for (const g of M.gates) out.push(g.door);
  return out;
}
export function barBox(b) {
  return b.axis === 'z' ? { x: b.x, z: b.z, hx: b.half + 0.08, hz: 0.2, h: 1.05, kind: 'bar' } : { x: b.x, z: b.z, hx: 0.2, hz: b.half + 0.08, h: 1.05, kind: 'bar' };
}

function pushOutBox(p, b, r) {
  const nx = Math.max(b.x - b.hx, Math.min(p.x, b.x + b.hx));
  const nz = Math.max(b.z - b.hz, Math.min(p.z, b.z + b.hz));
  let dx = p.x - nx, dz = p.z - nz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2), k = (r - d) / d;
    p.x += dx * k; p.z += dz * k;
  } else {
    // centre inside box: push out along the shallowest axis
    const ox = b.hx + r - Math.abs(p.x - b.x), oz = b.hz + r - Math.abs(p.z - b.z);
    if (ox < oz) p.x += Math.sign(p.x - b.x || 1) * ox; else p.z += Math.sign(p.z - b.z || 1) * oz;
  }
  return true;
}

// Moves a circle of radius r from (x,z) by (dx,dz), sliding along obstacles.
// low > 0: mid-jump, anything lower than that is cleared (window sills, dropped barricades, rocks)
export function moveCircle(M, st, x, z, dx, dz, r = 0.38, low = 0) {
  const p = { x: x + dx, z: z + dz };
  const dyn = low > 0 ? dynBoxes(M, st).filter(o => o.kind !== 'bar') : dynBoxes(M, st);
  let hit = false;
  for (let it = 0; it < 3; it++) {
    let any = false;
    const g = M.hash, hh = (M.half || HALF) + 12, gx = Math.floor((p.x + hh) / 8), gz = Math.floor((p.z + hh) / 8);
    for (let a = gx - 1; a <= gx + 1; a++) for (let b = gz - 1; b <= gz + 1; b++) {
      const bucket = g.get(a * 1000 + b);
      if (!bucket) continue;
      for (const o of bucket) {
        if (low > 0 && o.h < low) continue;
        if (o.r !== undefined) {
          const ddx = p.x - o.x, ddz = p.z - o.z, d = Math.hypot(ddx, ddz), min = o.r + r;
          if (d < min && d > 1e-6) { p.x = o.x + ddx / d * min; p.z = o.z + ddz / d * min; any = true; }
        } else if (pushOutBox(p, o, r)) any = true;
      }
    }
    for (const o of dyn) if (pushOutBox(p, o, r)) any = true;
    if (!any) break;
    hit = true;
  }
  const lim = (M.half || HALF) + 11;
  p.x = Math.max(-lim, Math.min(lim, p.x)); p.z = Math.max(-lim, Math.min(lim, p.z));
  p.hit = hit;
  return p;
}

function buildHash(M) {
  const h = new Map();
  const add = (o, x0, z0, x1, z1) => {
    const hh = (M.half || HALF) + 12;
    const a0 = Math.floor((x0 + hh) / 8), a1 = Math.floor((x1 + hh) / 8);
    const b0 = Math.floor((z0 + hh) / 8), b1 = Math.floor((z1 + hh) / 8);
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) {
      const k = a * 1000 + b; if (!h.has(k)) h.set(k, []); h.get(k).push(o);
    }
  };
  for (const b of M.boxes) add(b, b.x - b.hx - 0.6, b.z - b.hz - 0.6, b.x + b.hx + 0.6, b.z + b.hz + 0.6);
  for (const c of M.circles) add(c, c.x - c.r - 0.6, c.z - c.r - 0.6, c.x + c.r + 0.6, c.z + c.r + 0.6);
  M.hash = h;
}

export function freePoint(M, x, z, r) {
  if (!M.hash) buildHash(M);
  for (let rad = 0; rad < 12; rad += 0.5)
    for (let a = 0; a < 12; a++) {
      const px = x + Math.cos(a / 12 * 6.283) * rad, pz = z + Math.sin(a / 12 * 6.283) * rad;
      if (!overlaps(M, px, pz, r)) return { x: px, z: pz };
      if (rad === 0) break;
    }
  return { x, z };
}
function overlaps(M, x, z, r) {
  for (const b of M.boxes) if (Math.abs(x - b.x) < b.hx + r && Math.abs(z - b.z) < b.hz + r) return true;
  for (const c of M.circles) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
  return false;
}

// ---------- line of sight (tall blockers only) ----------
function segBox(x1, z1, x2, z2, b) {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dz = z2 - z1;
  for (const [p, q] of [[-dx, x1 - (b.x - b.hx)], [dx, (b.x + b.hx) - x1], [-dz, z1 - (b.z - b.hz)], [dz, (b.z + b.hz) - z1]]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}
export function losBlocked(M, x1, z1, x2, z2, minH = 1.7) {
  const minx = Math.min(x1, x2), maxx = Math.max(x1, x2), minz = Math.min(z1, z2), maxz = Math.max(z1, z2);
  for (const b of M.boxes) {
    if (b.h < minH) continue;
    if (b.x + b.hx < minx || b.x - b.hx > maxx || b.z + b.hz < minz || b.z - b.hz > maxz) continue;
    if (segBox(x1, z1, x2, z2, b)) return true;
  }
  const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1;
  for (const c of M.circles) {
    if (c.h < minH || c.kind === 'cage') continue;
    if (c.x + c.r < minx || c.x - c.r > maxx || c.z + c.r < minz || c.z - c.r > maxz) continue;
    const t = Math.max(0, Math.min(1, ((c.x - x1) * dx + (c.z - z1) * dz) / L2));
    if (Math.hypot(x1 + dx * t - c.x, z1 + dz * t - c.z) < c.r * 0.9) return true;
  }
  return false;
}

// ---------- nav grid ----------
export const CELL = 0.5;
export function buildGrid(M) {
  buildHash(M);
  const ext = (M.half || HALF) + 11, HF = (M.half || HALF);
  const N = Math.ceil(ext * 2 / CELL);
  const type = new Uint8Array(N * N);   // 0 free, 1 solid, 2 window, 3 barricade, 4 gate
  const ref = new Int16Array(N * N).fill(-1);
  const r = M.navR ?? 0.42; // clearance kept from walls (smaller on maps with narrow doorways)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -ext + (i + 0.5) * CELL, z = -ext + (j + 0.5) * CELL, k = j * N + i;
    if (Math.abs(x) > HF + 0.2 || Math.abs(z) > HF + 0.2) {
      // outside the walls: only the gate corridors are walkable
      let inCorr = false;
      for (const g of M.gates) if (Math.abs(x - g.x) < 2.2 && (z - g.z) * g.dir > 0 && (z - g.z) * g.dir < 9.4) inCorr = true;
      if (!inCorr) { type[k] = 1; continue; }
    }
    const bucket = M.hash.get(Math.floor((x + HF + 12) / 8) * 1000 + Math.floor((z + HF + 12) / 8)) || [];
    for (const b of bucket) {
      if (b.r !== undefined) continue;
      if (Math.abs(x - b.x) < b.hx + r && Math.abs(z - b.z) < b.hz + r) {
        if (b.kind === 'sill') { if (type[k] === 0) { type[k] = 2; ref[k] = M.windows.findIndex(w => w.x === b.x && w.z === b.z); } }
        else { type[k] = 1; break; }
      }
    }
    if (type[k] === 1) continue;
    for (const c of bucket) if (c.r !== undefined && Math.hypot(x - c.x, z - c.z) < c.r + r) { type[k] = 1; break; }
    if (type[k] === 1) continue;
    for (const b of M.bars) { const bb = barBox(b); if (Math.abs(x - bb.x) < bb.hx + 0.25 && Math.abs(z - bb.z) < bb.hz + r) { type[k] = 3; ref[k] = b.id; } }
    for (const g of M.gates) if (Math.abs(x - g.door.x) < g.door.hx + 0.1 && Math.abs(z - g.door.z) < g.door.hz + r) { type[k] = 4; ref[k] = g.id; }
  }
  M.grid = { N, ext, type, ref };
}

export function cellOf(M, x, z) {
  const g = M.grid;
  const i = Math.max(0, Math.min(g.N - 1, Math.floor((x + g.ext) / CELL)));
  const j = Math.max(0, Math.min(g.N - 1, Math.floor((z + g.ext) / CELL)));
  return j * g.N + i;
}
export function cellPos(M, k) {
  const g = M.grid;
  return { x: -g.ext + ((k % g.N) + 0.5) * CELL, z: -g.ext + (Math.floor(k / g.N) + 0.5) * CELL };
}

// A* on the nav grid. costFn(type, ref) -> extra cost or Infinity
export function findPath(M, sx, sz, tx, tz, costFn, maxIter = 40000) {
  const g = M.grid, N = g.N;
  let start = cellOf(M, sx, sz), goal = cellOf(M, tx, tz);
  const passable = k => costFn(g.type[k], g.ref[k]) < Infinity;
  if (!passable(goal)) { const alt = nearestPassable(M, goal, passable); if (alt < 0) return null; goal = alt; }
  if (!passable(start)) { const alt = nearestPassable(M, start, passable); if (alt >= 0) start = alt; }
  // search buffers are kept per map and reset by a stamp (no 120k-cell allocations per search)
  let P = M._pf;
  if (!P || P.n !== N * N) P = M._pf = { n: N * N, gs: new Float32Array(N * N), from: new Int32Array(N * N), seen: new Uint32Array(N * N), shut: new Uint32Array(N * N), st: 0 };
  const st = ++P.st, G = P.gs, F = P.from, seen = P.seen, shut = P.shut;
  const gsOf = k => seen[k] === st ? G[k] : Infinity;
  const heap = new Heap();
  const gi = goal % N, gj = (goal / N) | 0;
  // slightly greedy heuristic: near-optimal paths for a fraction of the search on big maps
  const hw = N > 260 ? 1.25 : 1;
  const h = k => { const di = Math.abs((k % N) - gi), dj = Math.abs(((k / N) | 0) - gj); return (Math.max(di, dj) + 0.414 * Math.min(di, dj)) * hw; };
  seen[start] = st; G[start] = 0; F[start] = -1; heap.push(start, h(start));
  let it = 0;
  while (heap.size && it++ < maxIter) {
    const k = heap.pop();
    if (k === goal) break;
    if (shut[k] === st) continue;
    shut[k] = st;
    const i = k % N, j = (k / N) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nk = nj * N + ni;
      if (shut[nk] === st) continue;
      const c = costFn(g.type[nk], g.ref[nk]);
      if (c === Infinity) continue;
      if (di && dj && (costFn(g.type[j * N + ni], g.ref[j * N + ni]) === Infinity || costFn(g.type[nj * N + i], g.ref[nj * N + i]) === Infinity)) continue;
      const ng = G[k] + (di && dj ? 1.414 : 1) * c;
      if (ng < gsOf(nk)) { seen[nk] = st; G[nk] = ng; F[nk] = k; heap.push(nk, ng + h(nk)); }
    }
  }
  if ((seen[goal] !== st || F[goal] < 0) && goal !== start) return null;
  const path = [];
  for (let k = goal; k >= 0 && k !== start; k = F[k]) path.push(k);
  path.reverse();
  return path;
}
function nearestPassable(M, k0, passable) {
  const N = M.grid.N, i0 = k0 % N, j0 = (k0 / N) | 0;
  for (let r = 1; r < 12; r++)
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      if (passable(j * N + i)) return j * N + i;
    }
  return -1;
}
class Heap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    const K = this.k, P = this.p; K.push(k); P.push(p);
    let i = K.length - 1;
    while (i > 0) { const pa = (i - 1) >> 1; if (P[pa] <= P[i]) break; [K[pa], K[i]] = [K[i], K[pa]]; [P[pa], P[i]] = [P[i], P[pa]]; i = pa; }
  }
  pop() {
    const K = this.k, P = this.p, top = K[0], lk = K.pop(), lp = P.pop();
    if (K.length) {
      K[0] = lk; P[0] = lp; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < K.length && P[l] < P[m]) m = l;
        if (r < K.length && P[r] < P[m]) m = r;
        if (m === i) break;
        [K[m], K[i]] = [K[i], K[m]]; [P[m], P[i]] = [P[i], P[m]]; i = m;
      }
    }
    return top;
  }
}

// ---------------- floors (Granny's House) ----------------
// A map may have several walkable floors. p.fl is the floor (0 = ground, 1, 2, ...) or, on a
// staircase, 10 + k for the stairs between floor k and floor k + 1. Every level has its own
// collision (M.levels[fl], a map-like object with boxes/circles/grid; the ground is M itself).
// M.floorY[k] is each floor's height; M.stairs[k] describes the stairs above floor k:
//   { kind: 'lane', y0, mid, y1 } climbs M.lane (flight 1 north to a landing, flight 2 east), or
//   { kind: 'spiral', y0, y1, cx, cz, a0, a1 } winds around (cx, cz) from angle a0 to a1 (degrees,
//   unwrapped), where p.sp tracks how far round you are.
export const isStair = fl => (fl || 0) >= 10;
export const levelOf = (M, fl) => (fl && M.levels && M.levels[fl]) || M;
const cl01 = v => Math.max(0, Math.min(1, v));
// how high someone stands
export function heightAt(M, p) {
  const fl = p.fl || 0;
  if (!M.floorY || !fl) return 0;
  if (fl < 10) return M.floorY[fl] || 0;
  const S = M.stairs[fl - 10];
  if (!S) return 0;
  if (S.kind === 'spiral') {
    const a = p.sp ?? S.a0, T = S.table;
    if (!T) return S.y0 + cl01((a - S.a0) / (S.a1 - S.a0)) * (S.y1 - S.y0);
    if (a <= T[0][0]) return T[0][1];
    for (let i = 1; i < T.length; i++) if (a <= T[i][0]) return T[i - 1][1] + (a - T[i - 1][0]) / (T[i][0] - T[i - 1][0]) * (T[i][1] - T[i - 1][1]);
    return T[T.length - 1][1];
  }
  const { f1, f2 } = M.lane;
  if (p.x > f1.x1) return S.mid + cl01((p.x - f2.x0) / (f2.x1 - f2.x0)) * (S.y1 - S.mid);
  if (p.z < f1.z0) return S.mid;
  return S.y0 + cl01((f1.z1 - p.z) / (f1.z1 - f1.z0)) * (S.mid - S.y0);
}
const deg = (x, z, S) => Math.atan2(z - S.cz, x - S.cx) * 180 / Math.PI;
const near = (a, ref) => { while (a < ref - 180) a += 360; while (a > ref + 180) a -= 360; return a; };
// step onto / off the stairs at either end
export function levelStep(M, p) {
  if (!M.stairs) return;
  const fl = p.fl || 0, L = M.lane;
  if (fl < 10) {
    for (let k = 0; k < M.stairs.length; k++) {
      const S = M.stairs[k];
      if (k !== fl && k + 1 !== fl) continue;
      const up = k === fl; // standing at the foot of these stairs
      if (S.kind === 'lane') {
        const { f1, f2 } = L;
        if (up && p.x > f1.x0 && p.x < f1.x1 && p.z < f1.z1 - 0.1 && p.z > f1.z1 - 0.8) { p.fl = 10 + k; return; }
        if (!up && p.z > f2.z0 && p.z < f2.z1 && p.x < f2.x1 - 0.1 && p.x > f2.x1 - 0.8) { p.fl = 10 + k; return; }
      } else {
        const r = Math.hypot(p.x - S.cx, p.z - S.cz);
        if (r > S.rEnter) continue;
        const a = up ? near(deg(p.x, p.z, S), S.a0) : near(deg(p.x, p.z, S), S.a1);
        if (up ? Math.abs(a - S.a0) < S.win : Math.abs(a - S.a1) < S.win) { p.fl = 10 + k; p.sp = a; return; }
      }
    }
    return;
  }
  const k = fl - 10, S = M.stairs[k];
  if (!S) { p.fl = 0; return; }
  if (S.kind === 'lane') {
    const { f1, f2 } = L;
    if (p.x > f1.x0 && p.x < f1.x1 && p.z > f1.z1 - 0.05) p.fl = k;
    else if (p.z > f2.z0 && p.z < f2.z1 && p.x > f2.x1 + 0.05) p.fl = k + 1;
    return;
  }
  // spiral: follow the angle round, then step off at either end
  p.sp = near(deg(p.x, p.z, S), p.sp ?? S.a0);
  const r = Math.hypot(p.x - S.cx, p.z - S.cz);
  if (r > S.rExit) { if (p.sp < S.a0 + S.win) p.fl = k; else if (p.sp > S.a1 - S.win) p.fl = k + 1; }
}
// keep someone on a spiral staircase between its pole and its outer edge (and its two ends); they
// can only leave through the gap at whichever end they are at
export function spiralClamp(M, p, ox, oz) {
  const S = M.stairs[(p.fl || 0) - 10];
  if (!S || S.kind !== 'spiral') return;
  const a = near(deg(p.x, p.z, S), p.sp ?? S.a0);
  if (a < S.a0 - S.win || a > S.a1 + S.win * 0.5) { p.x = ox; p.z = oz; return; }
  const atEnd = a < S.a0 + S.win || a > S.a1 - S.win;
  let r = Math.hypot(p.x - S.cx, p.z - S.cz);
  const r1 = atEnd ? S.rExit + 0.4 : S.rOut;
  if (r < S.rIn || r > r1) {
    r = Math.max(S.rIn, Math.min(r1, r)) || S.rIn;
    const t = a * Math.PI / 180;
    p.x = S.cx + Math.cos(t) * r; p.z = S.cz + Math.sin(t) * r;
  }
}
// levels that can see / reach each other: the same one, or a staircase and either of its floors
export const levelsMeet = (a, b) => {
  const x = a.fl || 0, y = b.fl || 0;
  if (x === y) return true;
  if (x >= 10 && y < 10) return y === x - 10 || y === x - 9;
  if (y >= 10 && x < 10) return x === y - 10 || x === y - 9;
  return false;
};
// line of sight between two characters, through the walls of the level they share
export function losL(M, a, b, minH) {
  if (!M.levels) return losBlocked(M, a.x, a.z, b.x, b.z, minH);
  if (!levelsMeet(a, b)) return true;
  const fa = a.fl || 0, fb = b.fl || 0, L = levelOf(M, fa >= 10 ? fb : fa);
  return losBlocked(L, a.x, a.z, b.x, b.z, minH);
}
// a map-like object for one extra level: collision boxes, a hash and a walking grid
export function makeLevel(M, boxes, circles = []) {
  const L = { half: M.half, navR: M.navR, boxes, circles, windows: [], bars: [], gens: [], cages: [], gates: [], level: true };
  buildGrid(L);
  return L;
}
