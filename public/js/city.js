// Fortnight's island: a night-time city on an island in the sea.
// A grid of streets with districts around it: a square in the middle, downtown blocks and shops
// around that, suburbs of houses with yards, an industrial dockside of warehouses and containers,
// parks and a filling station, with wooded hills and beaches on the edge. Every building is
// walkable inside (rooms, doorways, windows you can jump through) and has loot of its own.
import { rng, buildGrid, cellOf, freePoint, overlaps, buildTerrain } from './map.js';
import { rollItem } from './brdata.js';

const HALF = 200;
const LINES = [-150, -90, -30, 30, 90, 150]; // street centre lines (both ways)
const ROAD = 4.6, WALK = 1.7;                // half the asphalt, then the sidewalk
const T = 0.15;                              // half a wall's thickness
const FLOOR = 3.3;                           // storey height (for the look of upper floors)

export function buildCity(seed) {
  const R = rng(seed * 13 + 5);
  const C = { roads: [], lamps: [], cars: [], buildings: [], wins: [], signs: [], floors: [], ceilings: [], roofs: [], awnings: [], props: [], trees: [], pines: [], rocks: [], parks: [], plazas: [], yards: [], lots: [], fountains: [], canopies: [], ceilLamps: [] };
  const M = {
    seed, map: 'city', mapId: 'isle', half: HALF, br: true, city: C, navR: 0.36,
    props: [], pools: [], lights: [], boxes: [], circles: [], windows: [], bars: [], gens: [], cages: [], gates: [], visual: [], trees: [], rocks: [],
    spawns: { survivors: [], killer: null, killerYaw: 0, survivorYaw: 0 },
  };
  const rooms = [];   // walkable interiors: { x0, z0, x1, z1, big }
  const chestAt = []; // spots for chests (inside the bigger rooms)
  const box = (x, z, hx, hz, h, kind, style, y0) => { const b = { x, z, hx, hz, h, kind, style }; if (y0) b.y0 = y0; M.boxes.push(b); return b; };
  const circle = (x, z, r, h, kind) => { const c = { x, z, r, h, kind, s: R.range(0.85, 1.2), rot: R.range(0, 6.28) }; M.circles.push(c); if (kind === 'tree') M.trees.push(c); else if (kind === 'rock') M.rocks.push(c); return c; };

  // ---------- streets ----------
  for (const L of LINES) { C.roads.push({ x0: -172, z0: L, x1: 172, z1: L }); C.roads.push({ x0: L, z0: -172, x1: L, z1: 172 }); }
  const onRoad = (x, z, pad = 0) => LINES.some(L => Math.abs(z - L) < ROAD + WALK + pad && Math.abs(x) < 172 + pad) || LINES.some(L => Math.abs(x - L) < ROAD + WALK + pad && Math.abs(z) < 172 + pad);
  // street lamps along the sidewalks, parked cars along the kerbs
  for (const L of LINES) for (let a = -166; a <= 166; a += 22) for (const s of [-1, 1]) {
    if (LINES.some(L2 => Math.abs(a - L2) < ROAD + WALK + 2)) continue; // not in a junction
    const off = s * (ROAD + WALK - 0.35);
    C.lamps.push({ x: a, z: L + off, rot: s > 0 ? Math.PI : 0 }, { x: L + off, z: a, rot: s > 0 ? -Math.PI / 2 : Math.PI / 2 });
  }
  for (const l of C.lamps) circle(l.x, l.z, 0.16, 5.5, 'lamp');
  const CAR = ['#7a1c1c', '#1c3a6a', '#d8d8d0', '#2a2a2e', '#b88a2a', '#3a5a3a', '#6a6a72', '#8a3a10', '#2a4a5a'];
  for (const L of LINES) for (let a = -160; a <= 160; a += R.range(9, 26)) for (const s of [-1, 1]) {
    if (R() < 0.55 || LINES.some(L2 => Math.abs(a - L2) < ROAD + WALK + 5)) continue;
    const along = R() < 0.5, off = s * (ROAD - 1.3), col = R.pick(CAR);
    const x = along ? a : L + off, z = along ? L + off : a, rot = along ? Math.PI / 2 + (s > 0 ? Math.PI : 0) : (s > 0 ? Math.PI : 0);
    if (C.cars.some(c => Math.hypot(c.x - x, c.z - z) < 6)) continue;
    C.cars.push({ x, z, rot, col });
    box(x, z, along ? 2.25 : 0.95, along ? 0.95 : 2.25, 1.45, 'car', 'metal');
  }

  // ---------- districts ----------
  const blocks = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const x0 = LINES[i] + ROAD + WALK, x1 = LINES[i + 1] - ROAD - WALK, z0 = LINES[j] + ROAD + WALK, z1 = LINES[j + 1] - ROAD - WALK;
    blocks.push({ i, j, x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, d: Math.max(Math.abs(i - 2), Math.abs(j - 2)), kind: '' });
  }
  const side = R.int(0, 3); // the industrial docks run along one edge
  for (const b of blocks) {
    if (b.d === 0) b.kind = 'square';
    else if (b.d === 1) b.kind = R() < 0.3 ? 'shops' : 'downtown';
    else {
      const edge = [b.j === 0, b.i === 4, b.j === 4, b.i === 0][side];
      b.kind = edge && !((b.i === 0 || b.i === 4) && (b.j === 0 || b.j === 4)) ? 'industrial' : 'suburb';
    }
  }
  const sub = R.shuffle(blocks.filter(b => b.kind === 'suburb'));
  if (sub[0]) sub[0].kind = 'park'; if (sub[1]) sub[1].kind = 'park'; if (sub[2]) sub[2].kind = 'gas';
  const dt = R.shuffle(blocks.filter(b => b.kind === 'downtown')); if (dt[0]) dt[0].kind = 'park';

  // ---------- buildings ----------
  // a wall from (x1,z1) to (x2,z2) in world space, with openings: { f (0..1 along), w, door }
  const wallW = (x1, z1, x2, z2, H, style, open = []) => {
    const len = Math.hypot(x2 - x1, z2 - z1), ux = (x2 - x1) / len, uz = (z2 - z1) / len, vert = Math.abs(ux) < 0.5;
    const seg = (a, b, y0 = 0, h = H, kind = 'wall') => {
      if (b - a < 0.05) return;
      const ax = x1 + ux * a, az = z1 + uz * a, bx = x1 + ux * b, bz = z1 + uz * b;
      box((ax + bx) / 2, (az + bz) / 2, vert ? T : (b - a) / 2 + (kind === 'wall' ? T : 0), vert ? (b - a) / 2 + (kind === 'wall' ? T : 0) : T, h, kind, style, y0);
    };
    let at = 0;
    for (const o of open.slice().sort((a, b) => a.f - b.f)) {
      const c = o.f * len, a = c - o.w / 2, b = c + o.w / 2;
      seg(at, a);
      if (o.door) seg(a, b, 2.3, H, 'lintel');
      else { seg(a, b, 0, 0.95, 'sill'); seg(a, b, 2.1, H, 'lintel'); }
      at = b;
    }
    seg(at, len);
  };
  // a building: footprint (x, z, w along x, d along z), its front (the side with the door) faces
  // dir: 0 = -z, 1 = +x, 2 = +z, 3 = -x. kind: shop / house / apartment / warehouse / kiosk / cabin
  const building = (x, z, w, d, dir, kind, opts = {}) => {
    const floors = opts.floors || 1, H = kind === 'warehouse' ? 8 : kind === 'shop' ? 4.4 : floors * FLOOR + 0.4;
    const style = opts.style || R.pick(kind === 'warehouse' ? ['metal'] : kind === 'house' ? ['boards', 'plaster', 'brick'] : kind === 'cabin' ? ['boards'] : ['brick', 'plaster', 'concrete', 'brick']);
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    const B = { x, z, w, d, dir, kind, floors, H, style, roof: kind === 'house' || kind === 'cabin' ? 'gable' : 'flat' };
    C.buildings.push(B);
    // the four sides: front gets the door; other sides get windows (and a back door)
    const sides = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]; // -z, +x, +z, -x
    const len = i => i % 2 ? d : w;
    sides.forEach((sd, i) => {
      const L = len(i), open = [];
      const front = i === dir, back = i === (dir + 2) % 4;
      if (front) {
        open.push({ f: 0.5, w: kind === 'warehouse' ? 4.2 : 1.7, door: true });
        if (kind === 'shop') { open.push({ f: 0.2, w: Math.min(3.2, L * 0.18), door: false }); open.push({ f: 0.8, w: Math.min(3.2, L * 0.18), door: false }); }
        else if (L > 7) { open.push({ f: 0.2, w: 1.3 }); open.push({ f: 0.8, w: 1.3 }); }
      } else if (back && (kind !== 'kiosk') && L > 6) { open.push({ f: R.range(0.3, 0.7), w: 1.6, door: true }); }
      else if (kind !== 'warehouse') { const n = Math.max(1, Math.floor(L / 5)); for (let k = 0; k < n; k++) open.push({ f: (k + 0.5) / n, w: 1.2 }); }
      else open.push({ f: 0.5, w: 1.7, door: true });
      wallW(sd[0], sd[1], sd[2], sd[3], H, style, open);
      // lit windows on the upper floors (and over the ground floor of tall blocks)
      if (floors > 1) {
        const nx = i === 1 ? 1 : i === 3 ? -1 : 0, nz = i === 0 ? -1 : i === 2 ? 1 : 0, n = Math.max(1, Math.floor(L / 3));
        for (let f = 1; f < floors; f++) for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n, wx = sd[0] + (sd[2] - sd[0]) * t, wz = sd[1] + (sd[3] - sd[1]) * t;
          C.wins.push({ x: wx + nx * (T + 0.02), z: wz + nz * (T + 0.02), y: f * FLOOR + 1.5, nx, nz, w: 1.15, h: 1.5, lit: R() < 0.55 ? (R() < 0.7 ? 1 : 2) : 0 });
        }
      }
    });
    // inside: split into rooms with doorways between them
    const inner = { x0: x0 + T, x1: x1 - T, z0: z0 + T, z1: z1 - T };
    const split = [];
    if (kind !== 'warehouse' && kind !== 'kiosk' && kind !== 'cabin') {
      if (w >= 10) { const sx = x0 + w * R.range(0.42, 0.58); wallW(sx, z0, sx, z1, H, 'plaster', [{ f: R.range(0.3, 0.7), w: 1.6, door: true }]); split.push(['x', sx]); }
      if (d >= 12) { const sz = z0 + d * R.range(0.4, 0.6); wallW(x0, sz, x1, sz, H, 'plaster', [{ f: R.range(0.2, 0.4), w: 1.6, door: true }, { f: R.range(0.6, 0.8), w: 1.6, door: true }]); split.push(['z', sz]); }
    }
    const xs = [inner.x0, ...split.filter(s => s[0] === 'x').map(s => s[1]), inner.x1], zs = [inner.z0, ...split.filter(s => s[0] === 'z').map(s => s[1]), inner.z1];
    for (let a = 0; a < xs.length - 1; a++) for (let b = 0; b < zs.length - 1; b++) {
      const r = { x0: xs[a] + 0.2, x1: xs[a + 1] - 0.2, z0: zs[b] + 0.2, z1: zs[b + 1] - 0.2 };
      r.big = (r.x1 - r.x0) * (r.z1 - r.z0) > 45; rooms.push(r);
      C.ceilLamps.push({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, y: Math.min(H, FLOOR + 0.4) - 0.05 });
    }
    C.floors.push({ x0: inner.x0, x1: inner.x1, z0: inner.z0, z1: inner.z1, kind: kind === 'warehouse' ? 'concrete' : kind === 'shop' || kind === 'kiosk' ? 'tiles' : 'boards' });
    if (H > FLOOR + 1) C.ceilings.push({ x0: inner.x0, x1: inner.x1, z0: inner.z0, z1: inner.z1, y: FLOOR + 0.4 });
    C.roofs.push({ x0, x1, z0, z1, y: H, kind: B.roof, dir });
    // a shop sign over the door, an awning
    if (kind === 'shop' || kind === 'kiosk') {
      const [sx0, sz0, sx1, sz1] = sides[dir], mx = (sx0 + sx1) / 2, mz = (sz0 + sz1) / 2, nx = dir === 1 ? 1 : dir === 3 ? -1 : 0, nz = dir === 0 ? -1 : dir === 2 ? 1 : 0;
      C.signs.push({ x: mx + nx * 0.3, z: mz + nz * 0.3, y: 3.2, nx, nz, w: Math.min(len(dir) * 0.6, 7), col: R.pick(['#ff3a6a', '#3ad8ff', '#ffb43a', '#8aff5a', '#c06aff']) });
      C.awnings.push({ x: mx + nx * 0.9, z: mz + nz * 0.9, y: 2.6, nx, nz, w: len(dir) * 0.8, col: R.pick(['#7a1c1c', '#1c4a3a', '#2a3a6a', '#6a4a1c']) });
    }
    if (kind === 'warehouse') {
      // crates and racks inside
      for (let k = 0; k < 7; k++) {
        const cx = R.range(inner.x0 + 2, inner.x1 - 2), cz = R.range(inner.z0 + 2, inner.z1 - 2);
        if (Math.hypot(cx - x, cz - z) < 2.5 || M.boxes.some(b => b.kind === 'crate' && Math.hypot(b.x - cx, b.z - cz) < 3)) continue;
        const s = R.range(0.6, 1.0); box(cx, cz, s, s, R.pick([1.2, 1.2, 2.4]), 'crate', 'wood');
      }
    }
    if (B.floors >= 1 && (kind === 'apartment' || kind === 'shop' || kind === 'warehouse')) chestAt.push({ x: x + R.range(-w * 0.25, w * 0.25), z: z + R.range(-d * 0.25, d * 0.25) });
    else if (R() < 0.4) chestAt.push({ x: x + R.range(-w * 0.2, w * 0.2), z: z + R.range(-d * 0.2, d * 0.2) });
    return B;
  };
  // which side of a lot faces the nearest street
  const faceStreet = (x, z) => {
    let best = 0, bd = 1e9;
    for (const L of LINES) { const dz = Math.abs(z - L), dx = Math.abs(x - L); if (dz < bd) { bd = dz; best = z > L ? 0 : 2; } if (dx < bd) { bd = dx; best = x > L ? 3 : 1; } }
    return best;
  };
  const tree = (x, z, h = R.range(6, 10)) => { const c = circle(x, z, R.range(0.3, 0.45), h, 'tree'); C.trees.push({ x, z, h, s: R.range(0.85, 1.25) }); return c; };
  const bench = (x, z, rot) => { box(x, z, rot ? 0.3 : 0.9, rot ? 0.9 : 0.3, 0.5, 'bench', 'wood'); C.props.push({ k: 'bench', x, z, rot }); };

  for (const b of blocks) {
    const W = b.x1 - b.x0, D = b.z1 - b.z0;
    if (b.kind === 'square') {
      C.plazas.push({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 });
      circle(b.cx, b.cz, 3.0, 0.9, 'fountain'); C.fountains.push({ x: b.cx, z: b.cz, r: 3.0 });
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        building(b.cx + sx * (W / 2 - 5), b.cz + sz * (D / 2 - 5), 8, 8, faceStreet(b.cx + sx * (W / 2 - 5), b.cz), 'kiosk');
        tree(b.cx + sx * 9, b.cz + sz * 9); bench(b.cx + sx * 6, b.cz, 1); bench(b.cx, b.cz + sz * 6, 0);
      }
      // market stalls
      for (const [sx, sz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const x = b.cx + sx * 14, z = b.cz + sz * 14; box(x, z, sx ? 0.5 : 1.4, sx ? 1.4 : 0.5, 1.05, 'stall', 'wood'); C.canopies.push({ x, z, w: sx ? 2.2 : 3.6, d: sx ? 3.6 : 2.2, y: 2.4, col: R.pick(['#8a2a2a', '#2a5a8a', '#8a7a2a']) }); }
    } else if (b.kind === 'downtown' || b.kind === 'shops') {
      // four lots with alleys between them
      const gap = 3.6, lw = (W - gap) / 2, ld = (D - gap) / 2;
      for (const [sx, sz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const cx = b.x0 + lw / 2 + sx * (lw + gap), cz = b.z0 + ld / 2 + sz * (ld + gap);
        const w = lw - R.range(0.5, 3), d = ld - R.range(0.5, 3), dir = faceStreet(cx, cz);
        if (b.kind === 'shops' || R() < 0.3) building(cx, cz, w, d, dir, 'shop');
        else building(cx, cz, w, d, dir, 'apartment', { floors: R.int(2, 5) });
      }
      C.lots.push({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, kind: 'pave' });
      // bins and crates in the alleys
      for (let k = 0; k < 3; k++) { const x = b.cx + R.range(-1, 1), z = R.range(b.z0 + 4, b.z1 - 4); box(x, z, 0.5, 0.7, 1.3, 'bin', 'metal'); }
    } else if (b.kind === 'suburb') {
      // houses in yards behind low fences
      const along = W >= D, cols = along ? 3 : 2, rows = along ? 2 : 3, lw = W / cols, ld = D / rows;
      for (let a = 0; a < cols; a++) for (let c = 0; c < rows; c++) {
        const lx0 = b.x0 + a * lw, lz0 = b.z0 + c * ld, cx = lx0 + lw / 2, cz = lz0 + ld / 2, dir = faceStreet(cx, cz);
        C.yards.push({ x0: lx0 + 0.6, x1: lx0 + lw - 0.6, z0: lz0 + 0.6, z1: lz0 + ld - 0.6 });
        const w = Math.min(lw - 5, R.range(8.5, 11)), d = Math.min(ld - 5, R.range(8.5, 11));
        building(cx, cz, w, d, dir, 'house', { floors: R.int(1, 2) });
        // the fence, with a gap toward the street
        const fx0 = lx0 + 0.6, fx1 = lx0 + lw - 0.6, fz0 = lz0 + 0.6, fz1 = lz0 + ld - 0.6;
        const sidesF = [[fx0, fz0, fx1, fz0], [fx1, fz0, fx1, fz1], [fx1, fz1, fx0, fz1], [fx0, fz1, fx0, fz0]];
        sidesF.forEach((sd, i) => { const vert = i % 2 === 1, L = vert ? fz1 - fz0 : fx1 - fx0, mid = 0.5, gw = i === dir ? 2.4 : 0;
          const pieces = gw ? [[0, mid - gw / L / 2], [mid + gw / L / 2, 1]] : [[0, 1]];
          for (const [p0, p1] of pieces) { const ax = sd[0] + (sd[2] - sd[0]) * p0, az = sd[1] + (sd[3] - sd[1]) * p0, bx = sd[0] + (sd[2] - sd[0]) * p1, bz = sd[1] + (sd[3] - sd[1]) * p1; box((ax + bx) / 2, (az + bz) / 2, vert ? 0.06 : Math.abs(bx - ax) / 2, vert ? Math.abs(bz - az) / 2 : 0.06, 1.0, 'fence', 'boards'); } });
        for (let k = 0; k < 2; k++) { const tx = R.range(fx0 + 1.2, fx1 - 1.2), tz = R.range(fz0 + 1.2, fz1 - 1.2); if (Math.abs(tx - cx) > w / 2 + 1.2 || Math.abs(tz - cz) > d / 2 + 1.2) tree(tx, tz, R.range(5, 8)); }
      }
    } else if (b.kind === 'industrial') {
      C.lots.push({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, kind: 'yard' });
      const w = R.range(24, 32), d = R.range(16, 20), cx = b.cx + R.range(-4, 4), cz = b.cz + R.range(-4, 4);
      building(cx, cz, w, d, faceStreet(cx, cz), 'warehouse');
      // shipping containers stacked around the yard
      for (let k = 0, n = 0; k < 40 && n < 6; k++) {
        const along = R() < 0.5, x = R.range(b.x0 + 4, b.x1 - 4), z = R.range(b.z0 + 4, b.z1 - 4), hx = along ? 3.05 : 1.22, hz = along ? 1.22 : 3.05;
        if (Math.abs(x - cx) < w / 2 + hx + 3 && Math.abs(z - cz) < d / 2 + hz + 3) continue;
        if (M.boxes.some(o => o.kind === 'container' && Math.abs(o.x - x) < o.hx + hx + 2 && Math.abs(o.z - z) < o.hz + hz + 2)) continue;
        const stack = R() < 0.35 ? 2 : 1; box(x, z, hx, hz, 2.6 * stack, 'container', R.pick(['#8a2a1a', '#1a4a6a', '#3a6a2a', '#8a6a1a', '#5a5a5a'])); n++;
      }
    } else if (b.kind === 'park') {
      C.parks.push({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 });
      for (let k = 0; k < 26; k++) { const x = R.range(b.x0 + 2, b.x1 - 2), z = R.range(b.z0 + 2, b.z1 - 2); if (Math.abs(x - b.cx) < 5 && Math.abs(z - b.cz) < 5) continue; if (!M.circles.some(c => Math.hypot(c.x - x, c.z - z) < 3.5)) tree(x, z); }
      // a bandstand in the middle: pillars and a roof (loot under it)
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(b.cx + sx * 3, b.cz + sz * 3, 0.2, 0.2, 3.2, 'pillar', 'plaster');
      C.canopies.push({ x: b.cx, z: b.cz, w: 7.4, d: 7.4, y: 3.2, col: '#5a2a2a' });
      rooms.push({ x0: b.cx - 2.6, x1: b.cx + 2.6, z0: b.cz - 2.6, z1: b.cz + 2.6, big: true });
      for (let k = 0; k < 6; k++) { const a = k / 6 * 6.28; bench(b.cx + Math.cos(a) * 8, b.cz + Math.sin(a) * 8, k % 2); }
      for (let k = 0; k < 5; k++) { const x = R.range(b.x0 + 3, b.x1 - 3), z = R.range(b.z0 + 3, b.z1 - 3); if (!M.circles.some(c => Math.hypot(c.x - x, c.z - z) < 3)) circle(x, z, R.range(0.6, 1.2), R.range(0.8, 1.6), 'rock'); }
    } else if (b.kind === 'gas') {
      C.lots.push({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, kind: 'pave' });
      const dir = faceStreet(b.cx, b.cz);
      building(b.cx + (dir % 2 ? 0 : 12), b.cz + (dir % 2 ? 12 : 0), 14, 11, dir, 'shop');
      const px = b.cx - (dir % 2 ? 0 : 8), pz = b.cz - (dir % 2 ? 8 : 0);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(px + sx * 6, pz + sz * 4, 0.25, 0.25, 5, 'pillar', 'concrete');
      C.canopies.push({ x: px, z: pz, w: 15, d: 11, y: 5, col: '#c8c8c8', lit: true });
      for (const sx of [-3, 3]) for (const sz of [-1.5, 1.5]) { box(px + sx, pz + sz, 0.4, 0.3, 1.7, 'pump', 'metal'); }
      rooms.push({ x0: px - 6, x1: px + 6, z0: pz - 4, z1: pz + 4, big: false });
    }
  }

  // ---------- the edge of the island: hills, woods, beach, a few cabins ----------
  const outer = (x, z) => Math.max(Math.abs(x), Math.abs(z)) > 158;
  const cabins = [];
  for (let t = 0; t < 900 && cabins.length < 22; t++) {
    const x = R.range(-HALF + 14, HALF - 14), z = R.range(-HALF + 14, HALF - 14);
    if (!outer(x, z) || Math.max(Math.abs(x), Math.abs(z)) > HALF - 16 || onRoad(x, z, 6) || cabins.some(c => Math.hypot(c.x - x, c.z - z) < 24)) continue;
    cabins.push({ x, z }); building(x, z, R.range(6, 8), R.range(5.5, 7), R.int(0, 3), 'cabin');
  }
  for (let t = 0; t < 4000 && C.pines.length < 380; t++) {
    const x = R.range(-HALF + 6, HALF - 6), z = R.range(-HALF + 6, HALF - 6);
    if (!outer(x, z) || Math.max(Math.abs(x), Math.abs(z)) > HALF - 9 || onRoad(x, z, 3) || cabins.some(c => Math.hypot(c.x - x, c.z - z) < 7)) continue;
    if (M.circles.some(c => Math.hypot(c.x - x, c.z - z) < 3.2)) continue;
    const h = R.range(8, 14); circle(x, z, R.range(0.32, 0.5), h, 'tree'); C.pines.push({ x, z, h, s: R.range(0.8, 1.3) });
  }
  for (let t = 0; t < 800 && C.rocks.length < 60; t++) {
    const x = R.range(-HALF + 8, HALF - 8), z = R.range(-HALF + 8, HALF - 8);
    if (!outer(x, z) || onRoad(x, z, 3) || M.circles.some(c => Math.hypot(c.x - x, c.z - z) < 3)) continue;
    const r = R.range(0.7, 1.6); circle(x, z, r, r * R.range(0.9, 1.6), 'rock'); C.rocks.push({ x, z, r });
  }
  // the island's edge (invisible walls a little way out into the shallows)
  const E = HALF - 2;
  box(0, -E, E + 1, 0.5, 6, 'boundary', 'none'); box(0, E, E + 1, 0.5, 6, 'boundary', 'none');
  box(-E, 0, 0.5, E + 1, 6, 'boundary', 'none'); box(E, 0, 0.5, E + 1, 6, 'boundary', 'none');
  // terrain: flat city, wooded hills around it, sloping down to the beach
  const hills = [], mts = [];
  for (const [sx, sz] of R.shuffle([[-1, -1], [1, -1], [1, 1], [-1, 1]]).slice(0, 3)) mts.push({ x: sx * 178, z: sz * 178, h: R.range(12, 19), r: R.range(26, 32) });
  for (let k = 0; k < 14; k++) { const a = R() * 6.28, rr = R.range(170, 186); hills.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, h: R.range(3, 7), r: R.range(10, 16) }); }
  buildTerrain(M, { mts, hills, flats: [{ x: 0, z: 0, half: 157 }, ...cabins.map(c => ({ x: c.x, z: c.z, half: 4.5 }))], p: [R.range(0, 6), R.range(0, 6), R.range(0, 6)] });
  { const Tg = M.terrain; for (let j = 0; j < Tg.n; j++) for (let i = 0; i < Tg.n; i++) { const x = -Tg.ext + i, z = -Tg.ext + j, e = Math.max(Math.abs(x), Math.abs(z)); if (e > HALF - 8) Tg.grid[j * Tg.n + i] = Math.min(Tg.grid[j * Tg.n + i] * Math.max(0, 1 - (e - (HALF - 8)) / 4), -(e - (HALF - 8)) * 0.18); } }

  buildGrid(M);
  placeLoot(M, R, rooms, chestAt, outer);
  return M;
}

// ---------- loot, sacks, drop points, place names ----------
const NAMES = { square: 'Nightfall Square', downtown: 'Old Town', shops: 'Market Row', industrial: 'Rust Docks', park: 'Hollow Park', gas: 'Last Stop', suburb: ['Maple Row', 'Crow Hill', 'Lantern Heights', 'Ashgrove'] };
function placeLoot(M, R, rooms, chestAt, outer) {
  const g = M.grid, N = g.N, C = M.city;
  // only ground you can walk to from the middle of town
  const reach = new Uint8Array(N * N), q = [];
  let s0 = cellOf(M, 0, -20); for (let r = 0; g.type[s0] !== 0 && r < 600; r++) s0 = cellOf(M, (R() - 0.5) * 60, (R() - 0.5) * 60);
  reach[s0] = 1; q.push(s0);
  while (q.length) { const k = q.pop(), i = k % N, j = (k / N) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue; const nk = nj * N + ni; if (!reach[nk] && g.type[nk] !== 1) { reach[nk] = 1; q.push(nk); } } }
  M.brReach = reach;
  const ok = (x, z, r = 0.5) => { if (Math.abs(x) > M.half - 6 || Math.abs(z) > M.half - 6) return false; const k = cellOf(M, x, z); return reach[k] && g.type[k] === 0 && !overlaps(M, x, z, r); };
  const spot = (x, z, r) => { const p = freePoint(M, x, z, r); return ok(p.x, p.z, r) ? p : null; };
  const chests = [], loot = [], sacks = [];
  const used = (x, z, d) => chests.some(c => Math.hypot(c.x - x, c.z - z) < d) || loot.some(c => Math.hypot(c.x - x, c.z - z) < d);
  for (const c of chestAt) { const p = spot(c.x, c.z, 0.7); if (p && !used(p.x, p.z, 4)) chests.push({ id: chests.length, x: +p.x.toFixed(2), z: +p.z.toFixed(2), rot: R.int(0, 3) * Math.PI / 2 }); }
  // every room: something on the floor (bigger rooms: two)
  for (const r of rooms) {
    const n = r.big ? 2 : 1;
    for (let k = 0, tries = 0; k < n && tries < 10; tries++) {
      const p = spot(R.range(r.x0 + 0.7, r.x1 - 0.7), R.range(r.z0 + 0.7, r.z1 - 0.7), 0.4); if (!p || used(p.x, p.z, 1.6)) continue;
      const x = R(), it = rollItem(R, x < 0.46 ? 'w' : x < 0.72 ? 'h' : 'a', 0.15);
      loot.push({ id: loot.length, x: +p.x.toFixed(2), z: +p.z.toFixed(2), ...it }); k++;
    }
  }
  // some lying around outside too
  for (let t = 0; t < 3000 && loot.length < rooms.length * 1.3 + 90; t++) {
    const x = R.range(-M.half + 8, M.half - 8), z = R.range(-M.half + 8, M.half - 8), p = spot(x, z, 0.4);
    if (!p || used(p.x, p.z, 10)) continue;
    const r = R(); loot.push({ id: loot.length, x: +p.x.toFixed(2), z: +p.z.toFixed(2), ...rollItem(R, r < 0.3 ? 'w' : r < 0.6 ? 'h' : 'a') });
  }
  // sacks and rucksacks: alleys, yards, parks, by walls and trees
  const nearSomething = (x, z) => M.circles.some(c => (c.kind === 'tree' || c.kind === 'rock' || c.kind === 'lamp') && Math.hypot(x - c.x, z - c.z) < c.r + 1.4) || M.boxes.some(b => (b.kind === 'wall' || b.kind === 'fence' || b.kind === 'container' || b.kind === 'bin') && Math.abs(x - b.x) < b.hx + 1.2 && Math.abs(z - b.z) < b.hz + 1.2);
  for (let t = 0; t < 9000 && sacks.length < 170; t++) {
    const x = R.range(-M.half + 6, M.half - 6), z = R.range(-M.half + 6, M.half - 6);
    if (!ok(x, z, 0.4) || !nearSomething(x, z) || sacks.some(s => Math.hypot(s.x - x, s.z - z) < 8) || used(x, z, 2.5)) continue;
    sacks.push({ id: sacks.length, x: +x.toFixed(2), z: +z.toFixed(2), rot: +(R() * 6.28).toFixed(2), kind: R() < 0.5 ? 'sack' : 'pack' });
  }
  // drop points: spread across the whole island
  const cand = [];
  for (let t = 0; t < 3000 && cand.length < 700; t++) { const x = R.range(-M.half + 10, M.half - 10), z = R.range(-M.half + 10, M.half - 10); if (ok(x, z, 0.8)) cand.push({ x, z }); }
  const sp = [cand[0]];
  while (sp.length < 30 && sp.length < cand.length) { let best = null, bd = -1; for (const c of cand) { const d = Math.min(...sp.map(s => Math.hypot(s.x - c.x, s.z - c.z))); if (d > bd) { bd = d; best = c; } } sp.push(best); }
  M.spawns.survivors = sp.map(p => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) })); M.spawns.killer = M.spawns.survivors[0];
  // place names for the map
  const places = [], seenK = new Set();
  const blockAt = (x, z) => { const L = [-150, -90, -30, 30, 90, 150]; const i = L.findIndex((v, k) => k < 5 && x > v && x < L[k + 1]), j = L.findIndex((v, k) => k < 5 && z > v && z < L[k + 1]); return [i, j]; };
  const kinds = {};
  for (const b of C.buildings.concat(C.parks.map(p => ({ x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2, kind: 'park' })))) { const [i, j] = blockAt(b.x, b.z); if (i < 0 || j < 0) continue; const k = i + ',' + j; (kinds[k] ||= { i, j, list: [] }).list.push(b); }
  let sub = 0;
  for (const k in kinds) {
    const { i, j, list } = kinds[k], d = Math.max(Math.abs(i - 2), Math.abs(j - 2));
    const kind = list.some(b => b.kind === 'warehouse') ? 'industrial' : list.some(b => b.kind === 'park') ? 'park' : d === 0 ? 'square' : list.some(b => b.kind === 'house') ? 'suburb' : list.every(b => b.kind === 'shop') ? (list.length < 3 ? 'gas' : 'shops') : 'downtown';
    const quadrant = (i < 2 ? 'W' : i > 2 ? 'E' : '') + (j < 2 ? 'N' : j > 2 ? 'S' : '');
    const key = kind === 'suburb' ? 'suburb' + quadrant : kind === 'downtown' ? 'downtown' + quadrant[0] : kind + (kind === 'park' ? k : '');
    if (seenK.has(key)) continue; seenK.add(key);
    const x = -120 + i * 60, z = -120 + j * 60;
    const n = kind === 'suburb' ? NAMES.suburb[sub++ % 4] : NAMES[kind] + (kind === 'downtown' && seenK.has('downtown_once') ? ' East' : '');
    if (kind === 'downtown') seenK.add('downtown_once');
    if (places.some(p => p.n === n)) continue;
    places.push({ x, z, n });
  }
  M.br = { chests, loot, sacks, places };
}
