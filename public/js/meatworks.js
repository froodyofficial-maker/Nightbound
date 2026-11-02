// "Hollow Pines Meatworks" (OFFAL crossover map).
// Layout follows OFFAL's level generator: rooms dropped on a grid without overlapping, joined by a
// spanning tree of L-shaped corridors plus a few extra links (so there are loops), tiled walls,
// a low ceiling hung with meat rails. Scaled up for 1v4: 4m cells, wider halls, vault windows
// punched between neighbouring halls, barricade chokepoints in corridors, a loop in every room.
import { HALF } from './config.js';
import { rng, makeCtx, addGates, buildGrid, freePoint } from './map.js';

export const MEAT_CS = 4;          // cell size (m)
export const MEAT_CEIL = 5;        // ceiling height (m)
const GN = Math.round(HALF * 2 / MEAT_CS); // cells per side
const X0 = -HALF;                  // world x/z of cell 0's edge
const T = 0.2;

export function buildMeatworks(seed) {
  const R = rng(seed * 13 + 5);
  const M = {
    seed, map: 'meatworks', indoor: true, ceiling: MEAT_CEIL, boxes: [], circles: [], windows: [], bars: [], gens: [], cages: [], gates: [],
    visual: [], trees: [], rocks: [], lamps: [], rails: [], decals: [], spawns: { survivors: [], killer: null },
  };
  const W = GN, H = GN;
  const grid = new Uint8Array(W * H);      // 0 void, 1 floor, 2 window passage
  const roomOf = new Int16Array(W * H).fill(-1);
  const corr = new Uint8Array(W * H);
  const id = (i, j) => j * W + i;
  const inb = (i, j) => i >= 0 && j >= 0 && i < W && j < H;
  const walk = (i, j) => inb(i, j) && grid[id(i, j)] > 0;
  const cx = i => X0 + (i + 0.5) * MEAT_CS;

  // ---------- rooms ----------
  const rooms = [];
  for (let t = 0; rooms.length < 13 && t < 1500; t++) {
    const w = R.int(4, 7), h = R.int(4, 7);
    const x = R.int(1, W - w - 1), y = R.int(2, H - h - 2);
    if (rooms.some(r => x < r.x + r.w + 1 && x + w + 1 > r.x && y < r.y + r.h + 1 && y + h + 1 > r.y)) continue;
    rooms.push({ x, y, w, h });
  }
  rooms.forEach((r, k) => {
    r.cx = r.x + (r.w >> 1); r.cy = r.y + (r.h >> 1);
    r.wx = X0 + (r.x + r.w / 2) * MEAT_CS; r.wz = X0 + (r.y + r.h / 2) * MEAT_CS;
    for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) { grid[id(i, j)] = 1; roomOf[id(i, j)] = k; }
  });

  // ---------- corridors: minimum spanning tree + extra links ----------
  const carve = (i, j) => { if (i < 1 || j < 1 || i >= W - 1 || j >= H - 1) return; const k = id(i, j); if (!grid[k]) { grid[k] = 1; corr[k] = 1; } };
  const link = (a, b) => {
    const wide = R() < 0.5, xFirst = R() < 0.5;
    let i = a.cx, j = a.cy;
    const step = (ti, tj) => { while (i !== ti || j !== tj) { if (i !== ti) i += Math.sign(ti - i); else j += Math.sign(tj - j); carve(i, j); if (wide) carve(i + (xFirst ? 0 : 1), j + (xFirst ? 1 : 0)); } };
    if (xFirst) { step(b.cx, j); step(b.cx, b.cy); } else { step(i, b.cy); step(b.cx, b.cy); }
  };
  const d2 = (a, b) => (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2;
  const inT = [0], linked = new Set();
  while (inT.length < rooms.length) {
    let best = null;
    for (const a of inT) rooms.forEach((r, k) => { if (inT.includes(k)) return; const d = d2(rooms[a], r); if (!best || d < best[0]) best = [d, a, k]; });
    link(rooms[best[1]], rooms[best[2]]); linked.add(best[1] + ',' + best[2]).add(best[2] + ',' + best[1]); inT.push(best[2]);
  }
  rooms.forEach((r, k) => {
    if (R() > 0.55) return;
    const near = rooms.map((o, m) => [d2(r, o), m]).filter(([, m]) => m !== k).sort((a, b) => a[0] - b[0]).slice(0, 3);
    const [, m] = R.pick(near);
    if (!linked.has(k + ',' + m)) { link(r, rooms[m]); linked.add(k + ',' + m).add(m + ',' + k); }
  });

  // ---------- exits: carve a hall from each gate to the nearest floor ----------
  const gateCols = [];
  for (const [row, dir] of [[0, -1], [H - 1, 1]]) {
    let gi = R.int(4, W - 5), tries = 0;
    while (tries++ < 20 && gateCols.some(g => Math.abs(g - gi) < 6)) gi = R.int(4, W - 5);
    gateCols.push(gi);
    for (let k = 0; k < H; k++) {
      const j = dir < 0 ? row + k : row - k;
      const hit = walk(gi, j) && !(k < 2);
      for (const di of (k < 2 ? [-1, 0, 1] : [0])) { const kk = id(gi + di, j); if (!grid[kk]) { grid[kk] = 1; corr[kk] = 1; } }
      if (hit) break;
    }
  }

  // ---------- vault windows punched between neighbouring halls ----------
  const cand = [];
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    if (grid[id(i, j)]) continue;
    const ew = walk(i - 1, j) && walk(i + 1, j) && !walk(i, j - 1) && !walk(i, j + 1);
    const ns = walk(i, j - 1) && walk(i, j + 1) && !walk(i - 1, j) && !walk(i + 1, j);
    if (ew || ns) cand.push({ i, j, ew });
  }
  R.shuffle(cand);
  const passages = [];
  for (const c of cand) {
    if (passages.length >= 18) break;
    if (passages.some(p => Math.abs(p.i - c.i) + Math.abs(p.j - c.j) < 3)) continue;
    grid[id(c.i, c.j)] = 2; passages.push(c);
  }

  // ---------- tiled walls along every floor/void edge (merged into long runs) ----------
  const gateEdge = (i, j, dir) => gateCols.some((g, n) => i === g && ((n === 0 && j === 0 && dir === 'N') || (n === 1 && j === H - 1 && dir === 'S')));
  const runs = new Map();
  const addEdge = (key, a, b, fixed, vert) => { (runs.get(key) || runs.set(key, { fixed, vert, segs: [] }).get(key)).segs.push([a, b]); };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!grid[id(i, j)]) continue;
    const x0 = X0 + i * MEAT_CS, z0 = X0 + j * MEAT_CS;
    if (!walk(i, j - 1) && !gateEdge(i, j, 'N')) addEdge('h' + j, x0, x0 + MEAT_CS, z0, false);
    if (!walk(i, j + 1) && !gateEdge(i, j, 'S')) addEdge('h' + (j + 1), x0, x0 + MEAT_CS, z0 + MEAT_CS, false);
    if (!walk(i - 1, j)) addEdge('v' + i, z0, z0 + MEAT_CS, x0, true);
    if (!walk(i + 1, j)) addEdge('v' + (i + 1), z0, z0 + MEAT_CS, x0 + MEAT_CS, true);
  }
  for (const { fixed, vert, segs } of runs.values()) {
    segs.sort((a, b) => a[0] - b[0]);
    let cur = null;
    const flush = () => { if (!cur) return; const [a, b] = cur, mid = (a + b) / 2, half = (b - a) / 2 + T;
      M.boxes.push(vert ? { x: fixed, z: mid, hx: T, hz: half, h: MEAT_CEIL, kind: 'wall', style: 'tile' } : { x: mid, z: fixed, hx: half, hz: T, h: MEAT_CEIL, kind: 'wall', style: 'tile' }); };
    for (const s of segs) { if (cur && Math.abs(s[0] - cur[1]) < 1e-6) cur[1] = s[1]; else { flush(); cur = s.slice(); } }
    flush();
  }
  const G = makeCtx(M, R, 0, 0, 0);
  for (const p of passages) {
    const x0 = X0 + p.i * MEAT_CS, z0 = X0 + p.j * MEAT_CS;
    if (p.ew) G.windowWall(x0 + MEAT_CS / 2, z0, x0 + MEAT_CS / 2, z0 + MEAT_CS, 'tile', 0.5, 1.5, MEAT_CEIL);
    else G.windowWall(x0, z0 + MEAT_CS / 2, x0 + MEAT_CS, z0 + MEAT_CS / 2, 'tile', 0.5, 1.5, MEAT_CEIL);
  }

  // ---------- barricade chokepoints in straight one-cell corridors ----------
  const chokes = [];
  const corrCells = [];
  for (let j = 2; j < H - 2; j++) for (let i = 2; i < W - 2; i++) if (corr[id(i, j)] && grid[id(i, j)] === 1) corrCells.push([i, j]);
  R.shuffle(corrCells);
  for (const [i, j] of corrCells) {
    if (chokes.length >= 14) break;
    const alongX = walk(i - 1, j) && walk(i + 1, j) && !walk(i, j - 1) && !walk(i, j + 1);
    const alongZ = walk(i, j - 1) && walk(i, j + 1) && !walk(i - 1, j) && !walk(i + 1, j);
    if (!alongX && !alongZ) continue;
    if (chokes.some(c => Math.abs(c[0] - i) + Math.abs(c[1] - j) < 4)) continue;
    const x = cx(i), z = cx(j), gap = 1.0;
    if (alongX) {
      G.seg(x, z - MEAT_CS / 2, x, z - gap, 'tile', MEAT_CEIL); G.seg(x, z + gap, x, z + MEAT_CS / 2, 'tile', MEAT_CEIL);
      M.bars.push({ id: M.bars.length, x, z, axis: 'x', half: gap - 0.12, lean: R() < 0.5 ? 1 : -1 });
    } else {
      G.seg(x - MEAT_CS / 2, z, x - gap, z, 'tile', MEAT_CEIL); G.seg(x + gap, z, x + MEAT_CS / 2, z, 'tile', MEAT_CEIL);
      M.bars.push({ id: M.bars.length, x, z, axis: 'z', half: gap - 0.12, lean: R() < 0.5 ? 1 : -1 });
    }
    chokes.push([i, j]);
  }

  // ---------- room set pieces (each one a loop) ----------
  const carcassRow = (C, x1, x2, z, gapAt = null) => {
    for (let x = x1; x <= x2 + 1e-6; x += 1.15) {
      if (gapAt != null && Math.abs(x - gapAt) < 1.3) continue;
      const [wx, wz] = C.rp(x, z);
      M.circles.push({ x: wx, z: wz, r: 0.34, h: 3.2, kind: 'carcass', s: R.range(0.85, 1.15), rot: R.range(0, 6.28) });
    }
    const [a1, b1] = C.rp(x1 - 0.6, z), [a2, b2] = C.rp(x2 + 0.6, z);
    M.rails.push([a1, b1, a2, b2]);
  };
  const tpl = {
    killfloor(C) {
      carcassRow(C, -5.2, 5.2, -2.6, R.range(-2, 2));
      carcassRow(C, -5.2, 5.2, 2.6, R.range(-2, 2));
      C.box(0, 0, 1.3, 0.5, 0.95, 'table', 'steel');
      C.barricade(-6.2, 0, 'x', 0.9);
      return { G: [4.2, -5.6], C: [-4.5, 5.6] };
    },
    pens(C) {
      C.windowWall(-6, -1.5, 1, -1.5, 'tile', 0.5);
      C.seg(1, -1.5, 1, 4.5, 'tile');
      for (const [x1, z1, x2, z2] of [[-6, 1.5, -2.4, 1.5], [-6, 1.5, -6, 5.5], [3, -4, 6.5, -4], [6.5, -4, 6.5, -0.5]]) C.seg(x1, z1, x2, z2, 'rail', 1.15);
      C.barricade(-0.1, 1.5, 'z', 0.9);
      return { G: [4, 3.5], C: [-3.5, -5] };
    },
    office(C) {
      C.windowWall(-3.6, -2.6, 3.6, -2.6, 'tile', 0.5);
      C.seg(3.6, -2.6, 3.6, 2.6, 'tile');
      C.doorWall(3.6, 2.6, -3.6, 2.6, 'tile', 0.7, 1.8, true);
      C.windowWall(-3.6, 2.6, -3.6, -2.6, 'tile', 0.5);
      C.box(-1, -0.6, 1.0, 0.5, 0.8, 'desk', 'wood');
      return { G: [5.6, -4.5], C: [-5.6, 5] };
    },
    lockers(C) {
      C.box(-2.6, -1.6, 2.2, 0.32, 2.3, 'locker', 'locker');
      C.box(0.1, 1.3, 0.32, 2.6, 2.3, 'locker', 'locker');
      C.box(3.2, -1.6, 1.4, 0.32, 2.3, 'locker', 'locker');
      C.barricade(1.15, -1.6, 'x', 0.9);
      C.box(-4.5, 3.6, 0.6, 0.6, 1.0, 'drum', 'steel');
      return { G: [-4.4, -4.6], C: [4.6, 4.6] };
    },
    freezer(C) {
      C.box(-3.2, 0, 0.45, 3.2, 2.7, 'rack', 'steel');
      C.box(3.2, 0, 0.45, 3.2, 2.7, 'rack', 'steel');
      C.windowWall(-2.75, -3.6, 2.75, -3.6, 'tile', 0.5, 1.5);
      C.barricade(0, 3.2, 'z', 0.95);
      carcassRow(C, -1.8, 1.8, 0.4);
      return { G: [5.6, 4.8], C: [-5.6, -5] };
    },
    tanks(C) {
      C.box(-2.4, 0, 1.4, 1.4, 2.8, 'tank', 'steel');
      C.box(2.4, 0, 1.4, 1.4, 2.8, 'tank', 'steel');
      C.barricade(0, 0, 'z', 0.92);
      C.box(0, 4.6, 1.6, 0.5, 0.95, 'table', 'steel');
      return { G: [-5, 4.5], C: [5, -5] };
    },
  };
  const names = R.shuffle(['killfloor', 'pens', 'office', 'lockers', 'freezer', 'tanks', 'killfloor', 'pens', 'freezer', 'office', 'tanks', 'lockers', 'killfloor']);
  // spawn rooms: killer in one, survivors in the farthest from it
  const kRoom = R.int(0, rooms.length - 1);
  let sRoom = 0; rooms.forEach((r, k) => { if (d2(r, rooms[kRoom]) > d2(rooms[sRoom], rooms[kRoom])) sRoom = k; });
  rooms.forEach((r, k) => {
    const C = makeCtx(M, R, r.wx, r.wz, R.int(0, 3));
    const t = k === kRoom || k === sRoom ? 'tanks' : names[k % names.length];
    const res = tpl[t](C);
    r.t = t; r.G = C.rp(res.G[0], res.G[1]); r.C = C.rp(res.C[0], res.C[1]);
    // big rooms get an extra rail of carcasses along one side
    if (r.w >= 6 || r.h >= 6) { const side = R() < 0.5 ? -1 : 1; carcassRow(makeCtx(M, R, r.wx, r.wz, r.w >= r.h ? 0 : 1), -4, 4, side * (Math.min(r.w, r.h) * MEAT_CS / 2 - 2.2)); }
  });
  for (const b of M.boxes) if (b.style === 'tile' && b.kind === 'wall') b.h = MEAT_CEIL;

  // ---------- generators and cages, spread across rooms ----------
  const spread = (list, n, minD) => {
    const out = [];
    for (let d = minD; out.length < n && d >= 0; d -= 4)
      for (const r of list) { if (out.length >= n) break; if (out.includes(r)) continue; if (out.every(o => Math.hypot(o.wx - r.wx, o.wz - r.wz) >= d)) out.push(r); }
    return out;
  };
  const genRooms = spread(R.shuffle(rooms.filter((_, k) => k !== kRoom && k !== sRoom)), 7, 40);
  for (const r of genRooms) {
    const p = freePoint(M, r.G[0], r.G[1], 1.3);
    M.gens.push({ id: M.gens.length, x: p.x, z: p.z, rot: R.int(0, 3) * Math.PI / 2 });
    M.boxes.push({ x: p.x, z: p.z, hx: 0.62, hz: 0.62, h: 1.25, kind: 'gen', style: 'metal', nocast: true });
  }
  const cageRooms = spread(R.shuffle(rooms.slice()).sort((a, b) => (genRooms.includes(a) ? 1 : 0) - (genRooms.includes(b) ? 1 : 0)), 7, 40);
  for (const r of cageRooms) {
    const p = freePoint(M, r.C[0], r.C[1], 1.4);
    M.cages.push({ id: M.cages.length, x: p.x, z: p.z });
    M.circles.push({ x: p.x, z: p.z, r: 0.75, h: 2.6, kind: 'cage', nocast: true });
  }

  // ---------- exit gates ----------
  addGates(M, [{ x: cx(gateCols[0]), z: -HALF, dir: -1 }, { x: cx(gateCols[1]), z: HALF, dir: 1 }], 'tile');

  // ---------- spawns ----------
  const sr = rooms[sRoom], kr = rooms[kRoom];
  for (let i = 0; i < 4; i++) M.spawns.survivors.push(freePoint(M, sr.wx + (i % 2) * 2.4 - 1.2 + 3, sr.wz + Math.floor(i / 2) * 2.4 - 1.2 + 3, 0.6));
  M.spawns.killer = freePoint(M, kr.wx + 3.5, kr.wz + 3.5, 0.8);
  M.spawns.killerYaw = Math.atan2(sr.wx - kr.wx, sr.wz - kr.wz);
  M.spawns.survivorYaw = Math.atan2(kr.wx - sr.wx, kr.wz - sr.wz);

  // ---------- lamps (visual): over every room and along the halls ----------
  for (const r of rooms) {
    const n = r.w * r.h >= 30 ? 2 : 1;
    for (let k = 0; k < n; k++) M.lamps.push({ x: r.wx + (n > 1 ? (k ? 1 : -1) * (r.w >= r.h ? r.w : 0) * MEAT_CS / 4 : 0), z: r.wz + (n > 1 ? (k ? 1 : -1) * (r.w < r.h ? r.h : 0) * MEAT_CS / 4 : 0), red: R() < 0.25 });
  }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (corr[id(i, j)] && grid[id(i, j)] === 1 && (i * 7 + j * 3) % 4 === 0 && !M.lamps.some(l => Math.hypot(l.x - cx(i), l.z - cx(j)) < 10)) M.lamps.push({ x: cx(i), z: cx(j), red: R() < 0.4, hall: true });
  for (const g of M.gates) M.lamps.push({ x: g.x, z: g.z - g.dir * 5, red: true });

  M.cells = { W, H, CS: MEAT_CS, X0, grid, roomOf, corr };
  M.rooms = rooms;
  buildGrid(M);
  // anything outside the building is solid for the bots' pathfinding
  const g = M.grid;
  for (let k = 0; k < g.N * g.N; k++) {
    if (g.type[k] === 1) continue;
    const x = -g.ext + ((k % g.N) + 0.5) * 0.5, z = -g.ext + (Math.floor(k / g.N) + 0.5) * 0.5;
    if (Math.abs(x) > HALF || Math.abs(z) > HALF) continue;
    const i = Math.floor((x - X0) / MEAT_CS), j = Math.floor((z - X0) / MEAT_CS);
    if (!walk(i, j)) g.type[k] = 1;
  }
  return M;
}
