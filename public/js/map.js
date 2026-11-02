// Deterministic map generation: layout, colliders, interactables, nav grid.
// The same seed produces the exact same map on host and every client.
import { HALF } from './config.js';
import { buildMeatworks } from './meatworks.js';

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
      if (kind === 'tree') M.trees.push(c); else M.rocks.push(c);
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
  if (map === 'meatworks') return buildMeatworks(seed);
  const R = rng(seed);
  const M = {
    seed, map: 'woods', boxes: [], circles: [], windows: [], bars: [], gens: [], cages: [], gates: [],
    visual: [], trees: [], rocks: [], spawns: { survivors: [], killer: null },
  };
  const theme = R.pick(['brick', 'wood', 'stone']);

  const S = theme;
  const templates = {
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
  const tnames = ['shack', 'lwall', 'jungle', 'stones', 'barn', 'grove', 'open', 'shack', 'lwall', 'jungle', 'stones', 'grove'];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const cx = -40 + i * 20, cz = -40 + j * 20;
    if (i === 2 && j === 2) { cells.push({ i, j, cx, cz, t: 'chapel', rot: R.int(0, 1) * 2 }); continue; }
    cells.push({ i, j, cx: cx + R.range(-1, 1), cz: cz + R.range(-1, 1), t: R.pick(tnames), rot: R.int(0, 3) });
  }
  // survivors spawn in one corner, killer in the opposite one: keep those corner cells open
  const corner = R.int(0, 3);
  const corners = [[0, 0], [4, 4], [4, 0], [0, 4]];
  const sc = corners[corner], kc = corners[corner ^ 1];
  for (const c of cells) if ((c.i === sc[0] && c.j === sc[1]) || (c.i === kc[0] && c.j === kc[1])) c.t = 'open';

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
  const chapel = cells.find(c => c.t === 'chapel');
  const genCells = [chapel];
  const isCorner = c => (c.i === sc[0] && c.j === sc[1]) || (c.i === kc[0] && c.j === kc[1]);
  const pool = R.shuffle(cells.filter(c => c !== chapel && !isCorner(c)));
  for (let minD = 30; genCells.length < 7 && minD > 0; minD -= 4)
    for (const c of pool) {
      if (genCells.length >= 7) break;
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
  for (let minD = 34; cageCells.length < 7 && minD > 0; minD -= 4)
    for (const c of cagePool) {
      if (cageCells.length >= 7) break;
      if (cageCells.includes(c)) continue;
      if (cageCells.every(g => Math.hypot(g.cx - c.cx, g.cz - c.cz) >= minD)) cageCells.push(c);
    }
  for (const c of cageCells) {
    const [x, z] = c.C;
    M.cages.push({ id: M.cages.length, x, z });
    M.circles.push({ x, z, r: 0.75, h: 2.6, kind: 'cage', nocast: true });
  }

  // ---------- boundary + exit gates ----------
  const gx1 = Math.round(R.range(-30, 30)), gx2 = Math.round(R.range(-30, 30));
  const gateDefs = [{ x: gx1, z: -HALF, dir: -1 }, { x: gx2, z: HALF, dir: 1 }];
  const BW = 0.5, BH = 4.2;
  const bound = (x1, x2, z) => { if (x2 - x1 > 0.1) M.boxes.push({ x: (x1 + x2) / 2, z, hx: (x2 - x1) / 2, hz: BW, h: BH, kind: 'boundary', style: 'stone' }); };
  bound(-HALF - BW, gx1 - 2.4, -HALF); bound(gx1 + 2.4, HALF + BW, -HALF);
  bound(-HALF - BW, gx2 - 2.4, HALF); bound(gx2 + 2.4, HALF + BW, HALF);
  M.boxes.push({ x: -HALF, z: 0, hx: BW, hz: HALF + BW, h: BH, kind: 'boundary', style: 'stone' });
  M.boxes.push({ x: HALF, z: 0, hx: BW, hz: HALF + BW, h: BH, kind: 'boundary', style: 'stone' });
  addGates(M, gateDefs);

  // ---------- spawns ----------
  const ccx = -40 + sc[0] * 20, ccz = -40 + sc[1] * 20;
  const kcx = -40 + kc[0] * 20, kcz = -40 + kc[1] * 20;
  for (let i = 0; i < 4; i++) M.spawns.survivors.push(freePoint(M, ccx + (i % 2) * 2.4 - 1.2, ccz + Math.floor(i / 2) * 2.4 - 1.2, 0.6));
  M.spawns.killer = freePoint(M, kcx, kcz, 0.8);
  M.spawns.killerYaw = Math.atan2(-(ccx - kcx), -(ccz - kcz));
  M.spawns.survivorYaw = Math.atan2(-(kcx - ccx), -(kcz - ccz));

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
  for (let n = 0, placed = 0; n < 900 && placed < 110; n++) {
    const x = R.range(-HALF + 2, HALF - 2), z = R.range(-HALF + 2, HALF - 2);
    if (near(x, z, 1.6)) continue;
    if (R() < 0.8) { M.trees.push(push(M, { x, z, r: R.range(0.3, 0.55), h: R.range(7, 12), kind: 'tree', s: R.range(0.8, 1.25), rot: R.range(0, 6.28) })); }
    else M.rocks.push(push(M, { x, z, r: R.range(0.5, 1.1), h: R.range(0.8, 1.8), kind: 'rock', s: R.range(0.8, 1.2), rot: R.range(0, 6.28) }));
    placed++;
  }

  buildGrid(M);
  return M;
}

function push(M, c) { M.circles.push(c); return c; }

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
export function moveCircle(M, st, x, z, dx, dz, r = 0.38) {
  const p = { x: x + dx, z: z + dz };
  const dyn = dynBoxes(M, st);
  let hit = false;
  for (let it = 0; it < 3; it++) {
    let any = false;
    const g = M.hash, gx = Math.floor((p.x + HALF + 12) / 8), gz = Math.floor((p.z + HALF + 12) / 8);
    for (let a = gx - 1; a <= gx + 1; a++) for (let b = gz - 1; b <= gz + 1; b++) {
      const bucket = g.get(a * 1000 + b);
      if (!bucket) continue;
      for (const o of bucket) {
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
  const lim = HALF + 11;
  p.x = Math.max(-lim, Math.min(lim, p.x)); p.z = Math.max(-lim, Math.min(lim, p.z));
  p.hit = hit;
  return p;
}

function buildHash(M) {
  const h = new Map();
  const add = (o, x0, z0, x1, z1) => {
    const a0 = Math.floor((x0 + HALF + 12) / 8), a1 = Math.floor((x1 + HALF + 12) / 8);
    const b0 = Math.floor((z0 + HALF + 12) / 8), b1 = Math.floor((z1 + HALF + 12) / 8);
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
  const ext = HALF + 11;
  const N = Math.ceil(ext * 2 / CELL);
  const type = new Uint8Array(N * N);   // 0 free, 1 solid, 2 window, 3 barricade, 4 gate
  const ref = new Int16Array(N * N).fill(-1);
  const r = 0.42;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -ext + (i + 0.5) * CELL, z = -ext + (j + 0.5) * CELL, k = j * N + i;
    if (Math.abs(x) > HALF + 0.2 || Math.abs(z) > HALF + 0.2) {
      // outside the walls: only the gate corridors are walkable
      let inCorr = false;
      for (const g of M.gates) if (Math.abs(x - g.x) < 2.2 && (z - g.z) * g.dir > 0 && (z - g.z) * g.dir < 9.4) inCorr = true;
      if (!inCorr) { type[k] = 1; continue; }
    }
    const bucket = M.hash.get(Math.floor((x + HALF + 12) / 8) * 1000 + Math.floor((z + HALF + 12) / 8)) || [];
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
  const gs = new Float32Array(N * N).fill(Infinity);
  const from = new Int32Array(N * N).fill(-1);
  const closed = new Uint8Array(N * N);
  const heap = new Heap();
  const gi = goal % N, gj = (goal / N) | 0;
  const h = k => { const di = Math.abs((k % N) - gi), dj = Math.abs(((k / N) | 0) - gj); return (Math.max(di, dj) + 0.414 * Math.min(di, dj)); };
  gs[start] = 0; heap.push(start, h(start));
  let it = 0;
  while (heap.size && it++ < maxIter) {
    const k = heap.pop();
    if (k === goal) break;
    if (closed[k]) continue;
    closed[k] = 1;
    const i = k % N, j = (k / N) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nk = nj * N + ni;
      if (closed[nk]) continue;
      const c = costFn(g.type[nk], g.ref[nk]);
      if (c === Infinity) continue;
      if (di && dj && (costFn(g.type[j * N + ni], g.ref[j * N + ni]) === Infinity || costFn(g.type[nj * N + i], g.ref[nj * N + i]) === Infinity)) continue;
      const ng = gs[k] + (di && dj ? 1.414 : 1) * c;
      if (ng < gs[nk]) { gs[nk] = ng; from[nk] = k; heap.push(nk, ng + h(nk)); }
    }
  }
  if (from[goal] < 0 && goal !== start) return null;
  const path = [];
  for (let k = goal; k >= 0 && k !== start; k = from[k]) path.push(k);
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
