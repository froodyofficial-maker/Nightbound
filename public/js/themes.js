// Outdoor map themes. Each one reuses the 5x5 cell layout of the woods (so the loops, generators,
// cages and exits play the same) but brings its own set pieces, centrepiece, scatter and extras.
// Templates work in a local frame (about +-8m); C.rp() turns local points into world points.
import { HALF } from './config.js';

const rect = (C, x1, z1, x2, z2) => { const [a, b] = C.rp(x1, z1), [c, d] = C.rp(x2, z2); return { x0: Math.min(a, c), z0: Math.min(b, d), x1: Math.max(a, c), z1: Math.max(b, d) }; };
const pool = (M, C, x, z, r) => { const [wx, wz] = C.rp(x, z); M.pools.push({ x: wx, z: wz, r }); };
const prop = (C, x, z, r, h, id) => { const c = C.circle(x, z, r, h, 'prop'); c.prop = id; return c; };

// ---------------- Blackwater Marsh: a bayou of stilt shacks, boardwalks, wrecks and cypress ----------------
const marsh = {
  name: 'Blackwater Marsh', style: 'boards', boundary: 'boards', center: 'hall',
  names: ['stilts', 'boardwalk', 'wreck', 'cypress', 'reeds', 'open', 'stilts', 'boardwalk', 'wreck', 'cypress', 'reeds', 'stilts'],
  scatter: { n: 100, tree: 0.72 },
  templates(S, M) {
    return {
      stilts(C) {
        C.windowWall(-4, -3, 4, -3, S); C.seg(4, -3, 4, 3, S); C.doorWall(4, 3, -4, 3, S, 0.7, 1.8); C.windowWall(-4, 3, -4, -3, S);
        M.visual.push({ type: 'deck', ...rect(C, -5.2, -4.2, 5.2, 4.2) });
        C.box(-7, 1.5, 0.9, 0.6, 1.0, 'crate', 'wood'); C.barricade(-7, -0.2, 'x', 0.88); C.seg(-7, -1.2, -7, -5, 'rail', 1.1);
        pool(M, C, 5.5, -6, 2.6);
        return { G: [1.8, 0.3], C: [6.5, 6], trees: [[6.5, -2], [-3, 7], [-6.5, -6.5]] };
      },
      boardwalk(C) {
        M.visual.push({ type: 'deck', ...rect(C, -8, -1.3, 8, 1.3) });
        C.seg(-6.5, -1.4, 6.5, -1.4, 'rail', 1.05); C.seg(-6.5, 1.4, -1.1, 1.4, 'rail', 1.05); C.seg(1.6, 1.4, 6.5, 1.4, 'rail', 1.05);
        C.barricade(0.25, 1.4, 'z', 1.2);
        C.windowWall(-2.5, 4, 3, 4, S, 0.5); C.seg(3, 4, 3, 7, S);
        pool(M, C, 0, -5, 3.2); pool(M, C, -6, 5.5, 2);
        return { G: [-5, 4.8], C: [6.5, -5.5], trees: [[-7, -6], [7, 6], [0, 8]] };
      },
      wreck(C) {
        C.box(-2.8, 0, 0.35, 2.8, 1.75, 'hull', 'hull'); C.box(2.8, 0, 0.35, 2.8, 1.75, 'hull', 'hull'); C.box(0, -2.8, 3.15, 0.35, 1.75, 'hull', 'hull');
        C.box(0, 0.4, 0.15, 0.15, 3.2, 'mast', 'hull');
        C.box(4.2, 4.6, 2.6, 0.3, 0.7, 'log', 'wood');
        C.barricade(0, 2.9, 'z', 1.15);
        pool(M, C, 0, -1, 4.2);
        M.visual.push({ type: 'boat', ...rect(C, -3.2, -3.2, 3.2, 2.8) });
        return { G: [5.6, -4], C: [-5.8, 5.2], trees: [[-7, -6], [7.5, 0.5], [-1, 7.5]] };
      },
      cypress(C) {
        C.box(-2.4, 0, 1.5, 0.45, 1.1, 'log', 'wood'); C.box(2.4, 0, 1.5, 0.45, 1.1, 'log', 'wood');
        C.barricade(0, 0, 'z', 0.85);
        return { G: [4.5, -4], C: [-4.5, 4.5], trees: [[-5, -4], [-6.5, 1.5], [3, 5.5], [6.5, 2], [-2, -6.5], [1, -5], [-1, 6.5], [6, 6.5], [-6.5, 6.5]] };
      },
      reeds(C) {
        C.seg(-7, 0, -1, 0, S); C.barricade(0, 0, 'z', 0.85); C.windowWall(1, 0, 7, 0, S, 0.55);
        C.seg(-7, 0, -7, 3.5, S); C.seg(7, 0, 7, -3.5, S);
        pool(M, C, -3.5, 4.5, 3.4); pool(M, C, 4, -4.5, 2.6);
        return { G: [3, 4.6], C: [-4, -5], trees: [[-8, -7], [8, 7]] };
      },
      open(C) { C.circle(-1, -1, 1.1, 1.4, 'rock'); pool(M, C, 3, 3, 2.4); return { G: [2.5, -3], C: [-3.5, -4.5], trees: [[5, -5], [-6, -6], [6, 6], [-6, 6]] }; },
      hall(C) {
        C.windowWall(-8, -5.5, -2, -5.5, S, 0.5); C.doorWall(-2, -5.5, 2, -5.5, S, 0.5, 2.0, true); C.windowWall(2, -5.5, 8, -5.5, S, 0.5);
        C.windowWall(8, 5.5, 0, 5.5, S, 0.5); C.doorWall(0, 5.5, -8, 5.5, S, 0.45, 1.9);
        C.doorWall(8, -5.5, 8, 5.5, S, 0.5, 2.0, true); C.windowWall(-8, 5.5, -8, -5.5, S, 0.5);
        C.windowWall(-3, -2, -3, 3.2, S, 0.5, 1.4);
        C.box(5.4, 3.0, 1.1, 0.5, 1.0, 'crate', 'wood');
        M.visual.push({ type: 'deck', ...rect(C, -9, -6.5, 9, 6.5) });
        return { G: [2.5, -0.5], C: null, trees: [] };
      },
    };
  },
  extra(M, R, cells, near) {
    // more black water in the open ground
    for (let n = 0, k = 0; n < 200 && k < 10; n++) { const x = R.range(-HALF + 6, HALF - 6), z = R.range(-HALF + 6, HALF - 6), r = R.range(2, 4.5); if (near(x, z, r * 0.6)) continue; M.pools.push({ x, z, r }); k++; }
  },
};

// ---------------- Hollowmere Carnival: big top, booths, carousel, ferris wheel, caravans ----------------
const carnival = {
  name: 'Hollowmere Carnival', style: 'booth', boundary: 'fence', center: 'bigtop',
  names: ['booths', 'carousel', 'trailers', 'funhouse', 'ferris', 'open', 'booths', 'carousel', 'trailers', 'funhouse', 'booths', 'trailers'],
  scatter: { n: 55, tree: 0.6, prop: { p: 0.45, kinds: [{ id: 'barrel', r: 0.42, h: 1.0 }, { id: 'cart', r: 0.7, h: 1.4 }, { id: 'crate', r: 0.55, h: 1.1 }] } },
  templates(S, M) {
    return {
      bigtop(C) {
        const P = k => { const a = (k + 0.5) / 8 * Math.PI * 2; return [Math.cos(a) * 7.2, Math.sin(a) * 7.2]; };
        const kinds = ['win', 'seg', 'door', 'win', 'seg', 'win', 'doorbar', 'seg'];
        for (let k = 0; k < 8; k++) {
          const [x1, z1] = P(k), [x2, z2] = P(k + 1);
          if (kinds[k] === 'win') C.windowWall(x1, z1, x2, z2, 'canvas', 0.5, 1.4);
          else if (kinds[k] === 'seg') C.seg(x1, z1, x2, z2, 'canvas');
          else C.doorWall(x1, z1, x2, z2, 'canvas', 0.5, 2.0, kinds[k] === 'doorbar');
        }
        prop(C, 0, 0, 0.35, 9, 'tentpole');
        C.box(-2.4, 1.6, 1.2, 0.4, 0.9, 'bench', 'booth');
        const [wx, wz] = C.rp(0, 0); M.visual.push({ type: 'bigtop', x: wx, z: wz, r: 7.6 });
        return { G: [2.8, -2.2], C: null, trees: [] };
      },
      booths(C) {
        for (const s of [-1, 1]) {
          const a = s * 1.1, b = s * 6.2;
          C.seg(a, -2.6, b, -2.6, S); C.seg(a, -2.6, a, 1.2, S); C.seg(b, -2.6, b, 1.2, S);
          C.windowWall(a, 1.2, b, 1.2, S, 0.5, 1.6);
          M.visual.push({ type: 'awning', ...rect(C, Math.min(a, b), 1.1, Math.max(a, b), 2.3), color: s < 0 ? 0xc81e1e : 0x1e6ac8 });
        }
        C.barricade(0, -0.7, 'z', 1.0);
        return { G: [0, 5.2], C: [6.6, -6], trees: [[-7, 6.5]] };
      },
      carousel(C) {
        prop(C, 0, 0, 0.85, 4.4, 'carouselcore');
        for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; prop(C, Math.cos(a) * 3.4, Math.sin(a) * 3.4, 0.3, 2.4, 'horse').rot = a; }
        const [wx, wz] = C.rp(0, 0); M.visual.push({ type: 'carousel', x: wx, z: wz });
        C.seg(-7.5, 6, -3, 6, 'fence', 1.0); C.seg(3, -6, 7.5, -6, 'fence', 1.0);
        return { G: [6.2, -3.6], C: [-6.2, 4], trees: [[-7, -7], [7, 7]] };
      },
      trailers(C) {
        C.box(-3.2, 0, 2.4, 1.15, 2.7, 'trailer', 'trailer'); C.box(3.2, 0, 2.4, 1.15, 2.7, 'trailer', 'trailer');
        C.barricade(0, 0, 'z', 0.75);
        C.box(-5, 4.2, 0.6, 0.6, 1.1, 'crate', 'wood'); prop(C, 5, -4.4, 0.42, 1.0, 'barrel');
        return { G: [0, 5], C: [-5.6, -5.2], trees: [[7, 6], [-7.5, -1]] };
      },
      funhouse(C) {
        C.windowWall(-4, -3, 4, -3, S); C.seg(4, -3, 4, 3, S); C.doorWall(4, 3, -4, 3, S, 0.7, 1.8, true); C.windowWall(-4, 3, -4, -3, S);
        C.seg(-1, -3, -1, 0.5, S);
        M.visual.push({ type: 'clown', ...(([x, z]) => ({ x, z }))(C.rp(0, -3.25)), face: C.rp(0, -5) });
        return { G: [6, 5.5], C: [-6.5, -6], trees: [[6.5, -6.5]] };
      },
      ferris(C) {
        C.box(0, 0, 1.0, 3.4, 2.6, 'base', 'metal');
        C.windowWall(-7, 4.5, -1.5, 4.5, S, 0.5, 1.5); C.box(5.4, 5, 0.9, 0.9, 2.4, 'ticket', S);
        C.seg(-7, -5, -2.5, -5, 'fence', 1.0);
        const [wx, wz] = C.rp(0, 0), [ax, az] = C.rp(0, 1); M.visual.push({ type: 'ferris', x: wx, z: wz, along: Math.abs(az - wz) > Math.abs(ax - wx) ? 'z' : 'x' });
        return { G: [-4.5, 0.5], C: [5.5, -5], trees: [] };
      },
      open(C) { prop(C, -1, -1, 0.42, 1.0, 'barrel'); prop(C, 0.2, -1.4, 0.42, 1.0, 'barrel'); return { G: [2.5, 2.5], C: [-3.5, -4.5], trees: [[5, -5], [-6, 6]] }; },
    };
  },
  extra(M, R, cells, near) {
    // light poles near each cell, strung together with coloured bulbs
    const poles = [];
    for (const c of cells) for (let t = 0; t < 8; t++) {
      const x = c.cx + R.range(-8.5, 8.5), z = c.cz + R.range(-8.5, 8.5);
      if (near(x, z, 1.0) || Math.abs(x) > HALF - 2 || Math.abs(z) > HALF - 2) continue;
      const p = { x, z, r: 0.14, h: 6, kind: 'prop', prop: 'pole', s: 1, rot: 0 }; M.circles.push(p); M.props.push(p); poles.push(p); break;
    }
    for (const a of poles) {
      const near2 = poles.filter(b => b !== a && Math.hypot(a.x - b.x, a.z - b.z) < 24).sort((p, q) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(a.x - q.x, a.z - q.z)).slice(0, 2);
      for (const b of near2) if (!M.lights.some(l => (l.a === b && l.b === a))) M.lights.push({ a, b });
    }
  },
};

// ---------------- Coldwater Pass: snowbound cabins, a lodge, a frozen lake ----------------
const snow = {
  name: 'Coldwater Pass', style: 'logs', boundary: 'stone', center: 'lodge',
  names: ['cabin', 'woodpile', 'lake', 'truck', 'boulders', 'open', 'cabin', 'woodpile', 'boulders', 'truck', 'cabin', 'lake'],
  scatter: { n: 120, tree: 0.82 },
  templates(S, M) {
    return {
      cabin(C) {
        C.windowWall(-4, -3, 4, -3, S); C.seg(4, -3, 4, 3, S); C.doorWall(4, 3, -4, 3, S, 0.7, 1.8); C.windowWall(-4, 3, -4, -3, S);
        C.seg(-7, -6, -7, -1, 'fence', 1.2); C.box(-7, 2, 0.8, 0.8, 1.4, 'logpile', 'wood'); C.barricade(-7, 0.1, 'x', 0.88);
        return { G: [1.8, 0.3], C: [6.5, 5.5], trees: [[6, -6], [-3, 7], [7.5, 1]] };
      },
      woodpile(C) {
        C.box(-2.4, 0, 1.5, 0.6, 1.6, 'logpile', 'wood'); C.box(2.4, 0, 1.5, 0.6, 1.6, 'logpile', 'wood');
        C.box(-2.4, 1.6, 0.6, 0.55, 1.2, 'crate', 'wood');
        C.barricade(0, 0, 'z', 0.85);
        return { G: [4.5, -3.6], C: [-4.5, 4.5], trees: [[-5, -4], [-6.5, 1], [3, 5.5], [6.5, 2], [-2, -6.5], [6, 6.5]] };
      },
      lake(C) {
        const [wx, wz] = C.rp(0, 0); M.visual.push({ type: 'ice', x: wx, z: wz, r: 7.4 });
        C.windowWall(-1.6, -1.6, 1.6, -1.6, S, 0.5, 1.3); C.seg(1.6, -1.6, 1.6, 1.6, S); C.doorWall(1.6, 1.6, -1.6, 1.6, S, 0.5, 1.4, true);
        C.circle(-5, 4, 0.8, 2.0, 'rock'); C.circle(5, -4.5, 0.7, 1.8, 'rock');
        return { G: [5.4, 4.2], C: [-5.6, -4.2], trees: [[-7.5, 7.5], [7.5, -7.5]] };
      },
      truck(C) {
        C.box(-2.2, 0, 2.7, 1.15, 2.3, 'truck', 'truck');
        C.seg(1.8, -3, 6.5, -3, 'fence', 1.2); C.seg(6.5, -3, 6.5, 3.5, 'fence', 1.2); C.barricade(1.6, 1.7, 'x', 0.9);
        return { G: [-3, 4.6], C: [6.5, -6.5], trees: [[-7, -6], [-7, 6], [4, 7]] };
      },
      boulders(C) {
        C.box(-2.5, 0, 1.6, 0.6, 2.7, 'stone', 'stone'); C.box(2.5, 0, 1.6, 0.6, 2.4, 'stone', 'stone'); C.barricade(0, 0, 'z', 0.88);
        C.circle(-5, 4, 0.8, 2.4, 'rock'); C.circle(5, -4, 0.8, 2.2, 'rock'); C.circle(0, 6.5, 0.6, 2.6, 'rock');
        return { G: [4.5, 4], C: [-5, -4.5], trees: [[-7, -1], [7, 1], [1, -7]] };
      },
      open(C) { C.circle(-1, -1, 1.2, 1.6, 'rock'); C.box(-4, 3, 1.4, 0.5, 1.1, 'log', 'wood'); return { G: [2.5, 2.5], C: [-3.5, -4.5], trees: [[5, -5], [-6, -6], [6, 5], [-6, 6]] }; },
      lodge(C) {
        C.windowWall(-8, -5.5, -2, -5.5, S, 0.5); C.doorWall(-2, -5.5, 2, -5.5, S, 0.5, 2.0, true); C.windowWall(2, -5.5, 8, -5.5, S, 0.5);
        C.windowWall(8, 5.5, 0, 5.5, S, 0.5); C.doorWall(0, 5.5, -8, 5.5, S, 0.45, 1.9);
        C.doorWall(8, -5.5, 8, 5.5, S, 0.5, 2.0, true); C.windowWall(-8, 5.5, -8, -5.5, S, 0.5);
        C.windowWall(-3, -2, -3, 3.2, S, 0.5, 1.4);
        C.box(5.4, 3.2, 1.0, 0.5, 1.1, 'hearth', 'stone');
        return { G: [2.5, -0.5], C: null, trees: [] };
      },
    };
  },
};

export const THEMES = { marsh, carnival, snow };
export const MAP_NAMES = { woods: 'Gravemoor Woods', meatworks: 'Hollow Pines Meatworks', marsh: marsh.name, carnival: carnival.name, snow: snow.name };
