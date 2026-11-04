// Hand-built SVG icon set (64x64 line art). icon(name) returns an inline <svg> string.
const S = 'fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"';

function gear(cx, cy, r, teeth = 8) {
  let d = '';
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = (i / (teeth * 2)) * Math.PI * 2, a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2, rr = i % 2 ? r : r * 1.28;
    const p = (a, R) => `${(cx + Math.cos(a) * R).toFixed(1)} ${(cy + Math.sin(a) * R).toFixed(1)}`;
    d += (i ? 'L' : 'M') + p(a0, rr) + 'L' + p(a1, rr);
  }
  return `<path d="${d}Z"/><circle cx="${cx}" cy="${cy}" r="${(r * 0.38).toFixed(1)}"/>`;
}
function star(cx, cy, r1, r2, n) {
  let d = '';
  for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? r2 : r1; d += (i ? 'L' : 'M') + (cx + Math.cos(a) * r).toFixed(1) + ' ' + (cy + Math.sin(a) * r).toFixed(1); }
  return `<path d="${d}Z"/>`;
}
const person = (x = 32, y = 0) => `<circle cx="${x}" cy="${y + 14}" r="6"/><path d="M${x - 10} ${y + 52}l4-20h12l4 20M${x - 12} ${y + 30}l6-6h12l6 6"/>`;

const I = {
  // ---- survivor perks ----
  steady: `<path d="M45 13a10 10 0 0 0-12 13L15 44a4.5 4.5 0 0 0 6.4 6.4L39.4 32.4a10 10 0 0 0 13-12l-6.2 6.2-6-2-2-6z"/>`,
  medic: `<path d="M26 12h12v14h14v12H38v14H26V38H12V26h14z"/>`,
  hushed: `<ellipse cx="25" cy="38" rx="8" ry="12"/><circle cx="21" cy="19" r="2.5"/><circle cx="28" cy="18" r="2.5"/><circle cx="34" cy="22" r="2.2"/><path d="M10 54L54 10"/>`,
  sixth: `<path d="M5 32c8-12 17-18 27-18s19 6 27 18c-8 12-17 18-27 18S13 44 5 32z"/><circle cx="32" cy="32" r="8"/><circle cx="32" cy="32" r="2.5" fill="currentColor"/>`,
  shared: gear(24, 28, 10) + gear(44, 42, 8, 7),
  lockpick: `<circle cx="20" cy="22" r="10"/><circle cx="20" cy="22" r="3"/><path d="M27 29l24 24M43 45l5-5M37 39l5-5"/>`,
  lastwind: `<path d="M8 24h30a8 8 0 1 0-8-8"/><path d="M8 34h40a8 8 0 1 1-8 8"/><path d="M8 44h16"/>`,
  acrobat: `<path d="M8 50h48"/><path d="M14 50V40h36v10"/><path d="M12 32C18 10 42 8 50 28"/><path d="M42 26l8 2 2-8"/>`,
  resolve: `<path d="M32 53S9 39 9 24a11 11 0 0 1 23-5 11 11 0 0 1 23 5c0 15-23 29-23 29z"/><path d="M24 30l6 6 12-12"/>`,
  fleet: `<path d="M12 16l15 16-15 16M28 16l15 16-15 16"/><path d="M50 18v28"/>`,
  // ---- killer perks ----
  scent: `<path d="M32 7C24 21 15 30 15 41a17 17 0 0 0 34 0C49 30 40 21 32 7z"/><path d="M24 42a8 8 0 0 0 8 8"/>`,
  static: `<path d="M37 5L15 36h15l-4 23 23-33H34z"/>`,
  overload: star(32, 32, 26, 11, 9) + `<circle cx="32" cy="32" r="4"/>`,
  relentless: `<path d="M50 26A19 19 0 0 0 16 19"/><path d="M15 10v10h10"/><path d="M14 38a19 19 0 0 0 34 7"/><path d="M49 54V44H39"/>`,
  dread: `<path d="M5 34h12l5-13 8 26 6-19 4 6h19"/>`,
  brute: `<path d="M12 16l14-6 8 18-14 6z"/><path d="M30 22l22 30"/><path d="M26 26l5-2"/>`,
  rust: `<rect x="8" y="22" width="26" height="14" rx="7" transform="rotate(-30 21 29)"/><rect x="30" y="28" width="26" height="14" rx="7" transform="rotate(-30 43 35)"/>`,
  sentry: `<circle cx="32" cy="32" r="18"/><circle cx="32" cy="32" r="5"/><path d="M32 6v12M32 46v12M6 32h12M46 32h12"/>`,
  fury: `<path d="M32 5c3 10 15 15 15 30a15 15 0 0 1-30 0c0-8 6-12 6-19 4 4 6 9 6 13 4-6 5-14 3-24z"/>`,
  warrant: `<path d="M16 30a16 16 0 1 1 32 0c0 6-3 10-6 12v8H22v-8c-3-2-6-6-6-12z"/><circle cx="25" cy="30" r="4" fill="currentColor"/><circle cx="39" cy="30" r="4" fill="currentColor"/><path d="M28 50v6M36 50v6M32 38v4"/>`,
  irongrip: `<path d="M14 40V26a5 5 0 0 1 10 0v-4a5 5 0 0 1 10 0v2a5 5 0 0 1 10 0v4a5 5 0 0 1 10 0v12c0 10-8 16-20 16S14 50 14 40z"/><path d="M24 26v8M34 24v10M44 28v6"/>`,
  taser: `<path d="M8 20h30l6 4v8H30l-4 14H16l4-14H8z"/><path d="M46 18l6-6M48 26h8M46 34l6 6"/><path d="M33 23l-4 5h4l-3 5"/>`,
  flashlight: `<path d="M6 26h20l8-6v24l-8-6H6z"/><path d="M40 22l14-8M40 32h16M40 42l14 8"/>`,
  stalker: `<path d="M40 8a24 24 0 1 0 16 32A19 19 0 0 1 40 8z"/><circle cx="34" cy="34" r="3" fill="currentColor"/>`,
  // ---- killer powers ----
  rampage: `<path d="M10 40l26-26 16 4-4 16-26 26z"/><path d="M22 52l-8 8"/><path d="M40 20l4 4"/><path d="M46 8l10 10"/>`,
  fade: `<path d="M17 56V28a15 15 0 0 1 30 0v28l-5-5-5 5-5-5-5 5-5-5z"/><circle cx="26" cy="28" r="3" fill="currentColor"/><circle cx="38" cy="28" r="3" fill="currentColor"/>`,
  spear: `<path d="M12 52L46 18"/><path d="M40 12l14-2-2 14z"/><path d="M14 42l8 8"/>`,
  lantern: `<path d="M26 10h12M32 6v4"/><path d="M22 18h20l-2 30H24z"/><path d="M20 52h24"/><path d="M32 26c-4 5-4 10 0 14 4-4 4-9 0-14z"/>`,
  shadowstep: `<circle cx="32" cy="32" r="20" stroke-dasharray="6 5"/><path d="M32 18c-8 6-8 22 0 28 8-6 8-22 0-28z"/><path d="M12 32h8M44 32h8"/>`,
  hook: `<path d="M32 6v22"/><path d="M32 28c0 10 16 10 16 0"/><path d="M48 28l-4-6"/><circle cx="32" cy="6" r="3"/><path d="M14 44l8 8M22 44l-8 8"/>`,
  claws: `<path d="M18 50C22 34 22 22 18 10M30 52c4-16 4-30 0-42M42 50c4-14 4-26 0-38"/>`,
  // ---- survivor states ----
  healthy: person(),
  injured: person() + `<path d="M44 20l-6 12 6 2-6 12" stroke="#ff4a3a"/>`,
  down: `<circle cx="14" cy="42" r="6"/><path d="M20 46h26l8 6M26 46l-4-8"/><path d="M8 54h48"/>`,
  carried: `<circle cx="22" cy="14" r="6"/><path d="M22 20v14M14 50l8-16 8 16M10 28l12-4 14 2"/><path d="M36 24h18M44 18v12" />`,
  caged: `<path d="M32 6v10"/><path d="M32 16c-9 0-12 8-12 13s4 10 10 10c5 0 8-4 8-8"/><path d="M38 31l-4-4"/><path d="M20 46l6 12M44 46l-6 12M22 50h20"/>`, // a meat hook
  dead: `<path d="M16 30a16 16 0 1 1 32 0c0 6-3 10-6 12v8H22v-8c-3-2-6-6-6-12z"/><circle cx="25" cy="30" r="4" fill="currentColor"/><circle cx="39" cy="30" r="4" fill="currentColor"/>`,
  out: `<path d="M20 8h26v48H20"/><path d="M8 32h24M24 24l8 8-8 8"/>`,
  exec: `<path d="M10 54l30-30M34 12l18 18-8 8-18-18z"/>`,
  // ---- objectives / misc ----
  gen: `<rect x="10" y="26" width="44" height="24" rx="2"/><path d="M18 26V16h6v10M30 26V12h6v14M42 26V18h6v8"/><path d="M14 50v6M50 50v6"/><path d="M26 38h12"/>`,
  gate: `<path d="M8 56V18l12-8h24l12 8v38"/><path d="M20 56V22M32 56V18M44 56V22"/><path d="M8 34h48"/>`,
  store: `<path d="M10 24l4-12h36l4 12"/><path d="M12 24v28h40V24"/><path d="M10 24h44"/><path d="M26 52V38h12v14"/>`,
  mail: `<rect x="8" y="14" width="48" height="36" rx="3"/><path d="M8 18l24 18 24-18"/>`,
  gift: `<rect x="10" y="26" width="44" height="28"/><path d="M8 18h48v8H8z"/><path d="M32 18v36"/><path d="M32 18c-6-10-18-8-12 0M32 18c6-10 18-8 12 0"/>`,
  check: `<path d="M14 34l12 12 24-26"/>`,
  ember: `<path d="M32 6c6 12 16 18 16 32a16 16 0 0 1-32 0c0-10 8-14 8-22 6 4 8 10 8 16 4-8 2-18 0-26z"/>`,
  skullsmall: `<circle cx="32" cy="28" r="16"/>`,
  beartrap: `<path d="M10 40a22 22 0 0 0 44 0"/><path d="M10 40h44"/><path d="M14 40l3-7 3 7 3-7 3 7 3-7 3 7 3-7 3 7 3-7 3 7 3-7 2 7"/><circle cx="32" cy="46" r="3"/>`,
  chainsaw: `<path d="M8 30h16v14H8z"/><path d="M24 33h28a4 4 0 0 1 0 8H24"/><path d="M12 30v-6h10v6"/><path d="M28 33l3-3 3 3 3-3 3 3 3-3 3 3"/>`,
  knife: `<path d="M12 52l8-8"/><path d="M20 44l26-30c4 6 2 14-4 20L26 50z"/><path d="M14 40l10 10"/>`,
  triage: `<path d="M26 10h12v16h16v12H38v16H26V38H10V26h16z"/><path d="M14 54l8-8"/>`,
  overclock: `<circle cx="32" cy="34" r="20"/><path d="M32 34l10-12"/><path d="M26 8h12"/><path d="M48 14l4-4"/>`,
  exposure: `<rect x="10" y="20" width="44" height="30" rx="4"/><circle cx="32" cy="35" r="9"/><path d="M22 20l4-8h12l4 8"/><path d="M50 12l6-4M54 20h6"/>`,
  pathfinder: `<path d="M32 6l8 16-8 6-8-6z"/><path d="M32 28v28"/><path d="M14 44h36"/><circle cx="32" cy="44" r="4"/>`,
  containment: `<rect x="14" y="26" width="36" height="18" rx="3"/><path d="M14 30l-6-8M50 30l6-8"/><path d="M20 44v10M44 44v10"/><path d="M26 34h12"/>`,
  exorcist: `<circle cx="32" cy="26" r="14"/><path d="M26 22h12M32 16v20"/><path d="M18 52c4-8 24-8 28 0"/>`,
  card: `<rect x="10" y="18" width="44" height="28" rx="2"/><path d="M18 28h16"/><path d="M18 35h28"/><path d="M18 40h20"/>`,
};

export function icon(name, cls = '') {
  const body = I[name] || I.ember;
  return `<svg class="ico ${cls}" viewBox="0 0 64 64" ${S} aria-hidden="true">${body}</svg>`;
}
export const STATE_ICON = { healthy: 'healthy', injured: 'injured', down: 'down', carried: 'carried', caged: 'caged', dead: 'dead', out: 'out', exec: 'exec' };
export const POWER_ICON = { butcher: 'rampage', wisp: 'fade', harrower: 'spear', lamplighter: 'lantern', foreman: 'hook', slimer: 'fade', bateman: 'chainsaw', chucky: 'knife', granny: 'beartrap' };
