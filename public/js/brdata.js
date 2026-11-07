// Fortnight (battle royale mode): weapons, healing, ammo, loot tables and the closing fog.
// Shared by the host simulation, the bots and every player's screen.

// fire: seconds between shots. spread: radians of random aim error (hip fire; aiming down sights
// tightens it). range: full damage up to range, half at 2x range, nothing beyond 3x.
export const WEAPONS = {
  revolver: { name: 'Revolver', ammo: 'light', mag: 6, dmg: 26, fire: 0.32, spread: 0.022, range: 34, reload: 1.7, head: 1.6, sound: 'pistol' },
  smg: { name: 'Trench SMG', ammo: 'light', mag: 28, dmg: 13, fire: 0.082, auto: true, spread: 0.05, range: 26, reload: 2.1, head: 1.5, sound: 'smg' },
  shotgun: { name: 'Pump Shotgun', ammo: 'shells', mag: 5, dmg: 8, pellets: 10, fire: 0.95, spread: 0.115, range: 9, reload: 2.6, head: 1.5, sound: 'shotgun' },
  rifle: { name: 'Ranger Rifle', ammo: 'medium', mag: 24, dmg: 21, fire: 0.16, auto: true, spread: 0.026, range: 55, reload: 2.3, head: 1.55, sound: 'rifle' },
  hunting: { name: 'Hunting Rifle', ammo: 'heavy', mag: 1, dmg: 92, fire: 1.0, spread: 0.0, range: 160, reload: 1.9, head: 2.0, scope: true, sound: 'sniper' },
};
// how likely each weapon is to turn up, and in which grades
export const WEAPON_POOL = [['revolver', 26], ['smg', 22], ['shotgun', 22], ['rifle', 20], ['hunting', 10]];
// grades: damage multiplier, magazine bonus, reload speed
export const RARITY = [
  { id: 'worn', name: 'Worn', color: '#a7a7a7', hex: 0xa7a7a7, dmg: 1.0, w: 40 },
  { id: 'fine', name: 'Fine', color: '#5fd35a', hex: 0x5fd35a, dmg: 1.07, w: 32 },
  { id: 'rare', name: 'Rare', color: '#3f9bff', hex: 0x3f9bff, dmg: 1.14, w: 18 },
  { id: 'cursed', name: 'Cursed', color: '#c25cff', hex: 0xc25cff, dmg: 1.22, w: 8 },
  { id: 'bloodied', name: 'Bloodied', color: '#ff4a2a', hex: 0xff4a2a, dmg: 1.3, w: 2 },
];
// healing: hp heals health up to cap; sh adds ward (a second bar that soaks damage first)
export const HEALS = {
  bandage: { name: 'Bandages', hp: 15, cap: 75, time: 3.2, stack: 15, give: 5, color: 0xe8e0d0 },
  medkit: { name: 'Med Kit', hp: 100, cap: 100, time: 8, stack: 3, give: 1, color: 0xd83a2a },
  vial: { name: 'Ward Vial', sh: 25, cap: 50, time: 2, stack: 6, give: 3, color: 0x6ad0ff },
  tonic: { name: 'Ward Tonic', sh: 50, cap: 100, time: 4.5, stack: 3, give: 1, color: 0x3a7aff },
};
export const HEAL_POOL = [['bandage', 34], ['vial', 30], ['tonic', 20], ['medkit', 16]];
export const AMMO = {
  light: { name: 'Light rounds', give: 30, max: 300, color: 0xd8c070 },
  medium: { name: 'Rifle rounds', give: 24, max: 300, color: 0x8ad070 },
  shells: { name: 'Shells', give: 8, max: 60, color: 0xd85a3a },
  heavy: { name: 'Heavy rounds', give: 5, max: 30, color: 0x7a8ad8 },
};
export const SLOTS = 5;
export const MAX_HP = 100, MAX_SH = 100;
export const BR_PLAYERS = 16;

// The fog: wait, then close to the next ring over `shrink` seconds. r: fraction of the map's half-size.
// dps: damage per second to anyone outside it (health only: ward doesn't help in the fog).
export const FOG_PHASES = [
  { wait: 45, shrink: 35, r: 0.58, dps: 1 },
  { wait: 30, shrink: 30, r: 0.34, dps: 2 },
  { wait: 25, shrink: 25, r: 0.19, dps: 4 },
  { wait: 20, shrink: 20, r: 0.09, dps: 6 },
  { wait: 15, shrink: 15, r: 0.035, dps: 8 },
  { wait: 15, shrink: 20, r: 0.0, dps: 12 },
];

const pickW = (list, R) => { const tot = list.reduce((a, b) => a + b[1], 0); let x = R() * tot; for (const [k, w] of list) { x -= w; if (x <= 0) return k; } return list[0][0]; };
export function rollRarity(R, boost = 0) {
  const tot = RARITY.reduce((a, r, i) => a + r.w * (i ? 1 + boost * i : 1), 0);
  let x = R() * tot;
  for (let i = 0; i < RARITY.length; i++) { x -= RARITY[i].w * (i ? 1 + boost * i : 1); if (x <= 0) return i; }
  return 0;
}
// one random item: { k: 'w'|'h'|'a', id, r (grade, weapons), n (rounds in the mag / how many) }
export function rollItem(R, kind, boost = 0) {
  if (kind === 'w') { const id = pickW(WEAPON_POOL, R); return { k: 'w', id, r: rollRarity(R, boost), n: WEAPONS[id].mag }; }
  if (kind === 'h') { const id = pickW(HEAL_POOL, R); return { k: 'h', id, n: HEALS[id].give }; }
  const id = pickW([['light', 40], ['medium', 30], ['shells', 20], ['heavy', 10]], R);
  return { k: 'a', id, n: AMMO[id].give };
}
// a chest: a weapon (better odds than the floor), its ammo, and a heal now and then
export function rollChest(R) {
  const w = rollItem(R, 'w', 0.6);
  const out = [w, { k: 'a', id: WEAPONS[w.id].ammo, n: AMMO[WEAPONS[w.id].ammo].give }];
  if (R() < 0.75) out.push(rollItem(R, 'h'));
  if (R() < 0.3) out.push(rollItem(R, 'a'));
  return out;
}
// a sack or rucksack: one or two small things
export function rollSack(R) {
  const out = [], n = R() < 0.4 ? 2 : 1;
  for (let i = 0; i < n; i++) { const r = R(); out.push(rollItem(R, r < 0.18 ? 'w' : r < 0.6 ? 'h' : 'a')); }
  return out;
}
export function itemName(it) {
  if (!it) return '';
  if (it.k === 'w') return `${RARITY[it.r || 0].name} ${WEAPONS[it.id].name}`;
  if (it.k === 'h') return `${HEALS[it.id].name}${it.n > 1 ? ' ×' + it.n : ''}`;
  return `${AMMO[it.id].name} ×${it.n}`;
}
export const itemColor = it => it && it.k === 'w' ? RARITY[it.r || 0].color : it && it.k === 'h' ? '#e8e0d0' : '#d8c070';
export const weaponDmg = it => WEAPONS[it.id].dmg * RARITY[it.r || 0].dmg;
// fog ring at time t: { x, z, r } (interpolated while it closes)
export function fogAt(Z, t) {
  if (!Z) return null;
  if (t <= Z.t0) return { x: Z.x, z: Z.z, r: Z.r };
  if (t >= Z.t1) return { x: Z.nx, z: Z.nz, r: Z.nr };
  const f = (t - Z.t0) / (Z.t1 - Z.t0);
  return { x: Z.x + (Z.nx - Z.x) * f, z: Z.z + (Z.nz - Z.z) * f, r: Z.r + (Z.nr - Z.r) * f };
}
