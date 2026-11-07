// Entry point: menus, loadouts, bot matches, online lobby, match sessions and the main loop.
import * as THREE from 'three';
import { buildMap } from './map.js';
import { Sim } from './sim.js';
import { Bots } from './bots.js';
import { Game } from './game.js';
import { QUALITY } from './world.js';
import { setDetail } from './models.js';
import { setStyle, realistic, nightEnv } from './gfx.js';
import { initPhoto } from './pbr.js';
import { MenuScene } from './menu.js';
import { loadForeman, onForemanReady, loadBatman } from './foremanGlb.js';
import { loadChucky, onChuckyReady, chuckyReady } from './chuckyGlb.js';
import { loadTed, setTedPrefs, tedText, TED_LINES, TED_RUDE } from './sidekicks.js';
import { loadRealism, realismReady } from './realism.js';
import { loadSlappy, slappyReady } from './slappyGlb.js';
import { loadStatic } from './glbModels.js';
import { loadScene, sceneReady } from './sceneGlb.js';
import { loadGranny, grannyReady, onGrannyReady, loadGrandpa, loadSpiderMom } from './grannyGlb.js';
import { SnapWriter, SnapReader, Track } from './snap.js';
import { MAP_NAMES, BIG_MAPS, REGULAR_MAPS } from './themes.js';
import { icon, POWER_ICON } from './icons.js';
import { sound, loadClip } from './audio.js';
import { showTrailer, trailerPlaying } from './trailer.js';
import { ACTIONS, bound, keyName, RESERVED } from './keybinds.js';
import { hostRoom, joinRoom, relayAvailable } from './net.js';
import { KILLERS, SURVIVORS, SURV_PERKS, KILLER_PERKS, DEFAULT_SURV_PERKS, DEFAULT_KILLER_PERKS, BOT_NAMES, SNAP_RATE, NET_PROTOCOL, MODES, LORE, PERK_PRICES, PERK_SLOTS, SIDEKICKS, SKINS, INBOX, VERSION, CHAPTERS, CHAPTER_OF , NEWSLETTER , POWERUPS, POWER_LV, powerReach } from './config.js';
import { art, forget as forgetArt } from './portraits.js';
import { levelOf, rankOf, rankBadge, applyMatch, SEASON, seasonTier, seasonEnds, TIERS, PIPS_PER_GRADE } from './progress.js';
import { Friends, fmtCode, GIFT_MAX } from './friends.js';
import { Awards, AWARD, revealOf } from './awards.js';

window.__nbBooted = true;
for (const id of ['boot-loading', 'boot-error']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('nb_' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('nb_' + k, JSON.stringify(v)); } catch {} },
};

// Pick a sensible default for the machine: integrated / software GPUs start on Low or Very Low.
function detectQuality() {
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'potato';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return 'potato';
    if (/intel|uhd|hd graphics|iris|mali|adreno|powervr|apple gpu|vega \d|radeon\(tm\) graphics/i.test(name)) return 'low';
    if (matchMedia('(pointer: coarse)').matches) return 'low';
    return 'medium';
  } catch { return 'low'; }
}

const settings = Object.assign({ name: 'Player' + Math.floor(Math.random() * 900 + 100), sens: 1, fov: 75, vol: 0.8, music: 0.7, invert: false, net: 'auto', dynres: true, showFps: false }, store.get('settings', {}));
if (!QUALITY[settings.quality]) settings.quality = detectQuality();
const profile = Object.assign({
  survivor: { char: 'mara', perks: [...DEFAULT_SURV_PERKS] },
  killer: { char: 'butcher', perks: [...DEFAULT_KILLER_PERKS] },
  stats: { matches: 0, escapes: 0, kills: 0, embers: 0 },
  owned: {}, skins: {}, claimed: {}, readInbox: {},
}, store.get('profile', {}));
profile.owned ||= {}; profile.skins ||= {}; profile.claimed ||= {}; profile.readInbox ||= {}; profile.dlc ||= {}; profile.seen ||= {};
// the Scarred Chucky and Chucky DBD outfits were withdrawn (v2.25.1): anyone who bought one gets the embers back
for (const [id, price] of [['scarred', 5500], ['dbd', 6000]]) if (profile.owned['chucky:' + id]) {
  delete profile.owned['chucky:' + id]; profile.stats = profile.stats || {}; profile.stats.embers = (profile.stats.embers || 0) + price;
  if (profile.skins.chucky === id) profile.skins.chucky = 'default';
  setTimeout(() => { try { saveProfile(); } catch (_) {} }, 0);
}
// players who already bought a Foreman outfit before he became a chapter keep him
if (Object.keys(profile.owned).some(k => k.startsWith('foreman:'))) profile.dlc.offal = true;
const skinId = char => (profile.skins[char] && (profile.owned[char + ':' + profile.skins[char]] || profile.skins[char] === 'default')) ? profile.skins[char] : 'default';
if (!KILLERS[profile.killer.char]) profile.killer.char = 'butcher';
// drop perks that no longer exist (Death Warrant was removed in 2.4)
profile.killer.perks = (profile.killer.perks || []).filter(k => KILLER_PERKS[k]);
profile.survivor.perks = (profile.survivor.perks || []).filter(k => SURV_PERKS[k]);
// perks are bought with Embers; defaults are free, and anything already equipped stays owned
profile.perksOwned ||= {}; profile.pets ||= {};
const petOf = role => (profile[role].pet && profile.pets[profile[role].pet] && SIDEKICKS[profile[role].pet]) ? profile[role].pet : '';
for (const k of [...profile.survivor.perks, ...profile.killer.perks]) profile.perksOwned[k] = true;
const perkPrice = k => PERK_PRICES[k] || 0;
const ownsPerk = k => !perkPrice(k) || !!profile.perksOwned[k];
const perkFits = (k, char) => { const P = SURV_PERKS[k] || KILLER_PERKS[k]; return !P || !P.only || P.only === char; };
const charName0 = id => (KILLERS[id] || SURVIVORS[id] || {}).name || id;
const saveSettings = () => store.set('settings', settings);
const saveProfile = () => store.set('profile', profile);
saveSettings();
sound.vol = settings.vol; sound.music = settings.music;

const BIOS = {
  mara: 'A field medic who stopped asking why the roads all lead back here.',
  eli: 'Mechanic. Can coax a dead engine back to life with a bent spoon and a prayer.',
  june: 'A photographer chasing the story of the vanished hikers. Now she is one.',
  raghuvir: 'Big, steady and impossible to scare. Carries the heaviest proton pack on the team, and two Ghost Traps.',
  abeer: 'Quick hands, quicker wit. Swears the readings on his PKE meter spell out names. Carries two Ghost Traps.',
  tomas: 'Former park ranger. Knows every trail on the moor, and that none of them lead out.',
  steve: 'Fan-made crossover. Has survived more nights than anyone can count. This one has no sunrise.',
  spiderman: 'Fan-made crossover. Fast, agile, and armed with Web Shooters: 4 shots (R) that slow the killer hard or make him drop whoever he is carrying.',
};

// ---------- renderer (recreated when graphics quality changes) ----------
let renderer = null;
function makeRenderer() {
  if (renderer) { renderer.dispose(); renderer.domElement.remove(); }
  const q = QUALITY[settings.quality];
  const lite = settings.quality === 'potato' || settings.quality === 'low';
  renderer = new THREE.WebGLRenderer({ antialias: !lite, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35 * (settings.brightness || 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.type = settings.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  renderer.setPixelRatio(Math.min(1.5, q.pixel));
  renderer.setSize(innerWidth, innerHeight);
  $('game').appendChild(renderer.domElement);
  setStyle(settings.style, renderer);
  initPhoto(renderer, settings.quality);
  setDetail(settings.quality);
}
makeRenderer();

function toast(msg, ms = 3500) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), ms);
}
function loading(on, text) { $('loading').classList.toggle('hidden', !on); if (text) $('loading').firstElementChild.textContent = text; }
const nextFrame = () => new Promise(r => setTimeout(r, 40));

// ---------- 3D menu scene ----------
let menu = null;
let menuMode = 'survivor';
function startBG() {
  if (menu) return;
  setDetail(settings.quality);
  menu = new MenuScene(settings.quality);
  if (realistic() && settings.quality !== 'potato' && settings.quality !== 'low') menu.scene.environment = nightEnv(renderer, 0x1c2438, 0x0a0b10);
  renderer.shadowMap.enabled = settings.quality === 'high';
  renderer.setPixelRatio(Math.min(1.5, QUALITY[settings.quality].pixel));
  renderer.setSize(innerWidth, innerHeight);
  menu.setSurvivor(profile.survivor.char, skinId(profile.survivor.char));
  menu.setKiller(profile.killer.char, skinId(profile.killer.char));
  menu.setMode(menuMode);
  renderShowcase();
}
loadForeman();
loadBatman().then(m => { if (m) { forgetArt('foreman'); if (menu && menu.killerChar === 'foreman') menu.setKiller('foreman', menu.killerSkin); } });
loadChucky();
loadTed();
for (const n of ['bringit', 'email', 'weak', 'cock', 'shit', 'idle', 'arfh', 'teddy', 'problems', 'fuckme', 'listen', 'pussy', 'thunder']) loadClip('ted/' + n);
loadStatic('axe').then(m => { if (m) forgetArt('bateman'); });
loadStatic('ghosttrap');
loadStatic('beartrap'); loadStatic('taser');
loadScene('granny_map');
loadGranny().then(m => { if (m) { forgetArt('granny'); if (menu && menu.killerChar === 'granny') menu.setKiller('granny', menu.killerSkin); } });
loadGrandpa().then(m => { if (m) forgetArt('granny'); });
loadSpiderMom();
loadStatic('slimer').then(m => { if (!m) return; forgetArt('slimer'); if (menu && menu.killerChar === 'slimer') menu.setKiller('slimer', menu.killerSkin); });
loadRealism('spiderman').then(m => { if (!m) return; forgetArt('spiderman'); if (menu) menu.setSurvivor(profile.survivor.char, skinId(profile.survivor.char)); if (!$('store').classList.contains('hidden')) { menu && (menu.showFor = null); renderStore(); } });
loadRealism('ray').then(m => { if (!m) return; forgetArt('raghuvir'); if (menu) menu.setSurvivor(profile.survivor.char, skinId(profile.survivor.char)); if (!$('store').classList.contains('hidden')) { menu && (menu.showFor = null); renderStore(); } });
// Chucky's model is 5MB: once it arrives, redraw every place that may have drawn the stand-in doll
onChuckyReady(() => {
  forgetArt('chucky');
  if (menu && menu.killerChar === 'chucky') menu.setKiller('chucky', menu.killerSkin);
  if (!$('store').classList.contains('hidden')) renderStore();
  renderShowcase();
});
loadSlappy().then(m => { if (!m) return; onChuckyReady(() => { forgetArt('chucky'); if (menu && menu.killerChar === 'chucky') menu.setKiller('chucky', menu.killerSkin); if (!$('store').classList.contains('hidden')) renderStore(); }); });
loadChucky().then(g => { if (!g) toast("Chucky's 3D model couldn't load, so a simple stand-in doll is used. Check your connection and refresh.", 8000); });
// a match with Chucky in it waits (on the loading screen) for his real model, up to 20s
const spiderOk = () => !!window.__nbSpiderLoaded;
loadSpiderMom().then(m => { window.__nbSpiderLoaded = !!m; });
async function waitForModels(need) {
  if (need && need.spider && !realismReady('spiderman')) { loading(true, 'Spider-Man is swinging in…'); await Promise.race([loadRealism('spiderman'), new Promise(r => setTimeout(r, 25000))]); }
  // the Granny's House scenery (a big model) must be in before any match can use the map
  if (!sceneReady('granny_map')) { loading(true, 'Unlocking Granny\'s front door…'); await Promise.race([loadScene('granny_map'), new Promise(r => setTimeout(r, 25000))]); }
  // Granny and her granddaughter, when she's in the match
  if (need === 'granny' || (need && need.granny)) { if (!grannyReady() || !spiderOk()) { loading(true, 'Granny is coming down the stairs…'); await Promise.race([Promise.all([loadGranny(), loadGrandpa(), loadSpiderMom()]), new Promise(r => setTimeout(r, 25000))]); } }
  if (need && need.granny) need = need.chucky;
  if (!need || (chuckyReady() && slappyReady())) return;
  loading(true, "Waking Chucky up…");
  await Promise.race([Promise.all([loadChucky(), loadSlappy()]), new Promise(r => setTimeout(r, 20000))]);
}
onForemanReady(() => { if (menu && menu.killerChar === 'foreman') menu.setKiller('foreman', menu.killerSkin); });
function stopBG() { if (menu) { menu.dispose(); menu = null; } }
function setScene(mode) { menuMode = mode; if (menu) menu.setMode(mode); renderShowcase(); }

function renderShowcase() {
  if (menuMode === 'killer') {
    const k = KILLERS[profile.killer.char];
    $('showcase').innerHTML = `<div class="role">Killer</div><div class="nm">${esc(k.name)}</div><div class="lore">${esc(k.lore)}</div><div class="pw">${icon(POWER_ICON[k.id])}${esc(k.ability.name)} · ${esc(k.feature.name)}</div>`;
  } else {
    const c = SURVIVORS[profile.survivor.char];
    $('showcase').innerHTML = `<div class="role">Survivor</div><div class="nm">${esc(c.name)}</div><div class="lore">${esc(BIOS[c.id] || '')}</div>`;
  }
  const st = profile.stats;
  const lv = levelOf((profile.prog || {}).xp || 0), rk = rankOf(((profile.prog || {}).ranks || {})[menuMode === 'killer' ? 'killer' : 'survivor'] || 0);
  $('profile').innerHTML = `<div class="pn"><span class="plv" title="Player level">${lv.lvl}</span>${rankBadge(rk, 26)}${esc(settings.name)}</div><div class="pe">${icon('ember')}${Math.round(st.embers).toLocaleString()}</div><div class="ps">${st.matches} matches · ${st.escapes} escapes · ${st.kills} kills</div>`;
}

// ---------- side panel ----------
const SECTIONS = ['p-test', 'p-play', 'p-online', 'p-lobby', 'p-loadout', 'p-settings', 'p-help', 'p-inbox', 'p-pass', 'p-friends'];
let openSection = null;
function openPanel(id, title, wide = false) {
  for (const p of SECTIONS) $(p).classList.toggle('hidden', p !== id);
  $('panel').classList.remove('hidden');
  $('panel').classList.toggle('wide', wide && id !== 'p-loadout');
  $('panel').classList.toggle('loadout', id === 'p-loadout');
  $('panel-title').textContent = title;
  $('menu').classList.add('panel-open');
  $('menu').classList.remove('hidden');
  openSection = id;
  if (menu) menu.setShift(!wide);
  if (id === 'p-loadout') renderLoadout($('lo-body'), loTab, false);
  if (id === 'p-play') renderBotsPanel();
  if (id === 'p-settings') renderSettings();
  if (id === 'p-online') detectModeHint();
  if (id === 'p-inbox') renderInbox();
  if (id === 'p-pass') renderPass();
  if (id === 'p-friends') renderFriends();
}
function closePanel() {
  if (openSection === 'p-lobby' && lobby) { leaveOnline(); return; }
  $('panel').classList.add('hidden');
  $('menu').classList.remove('panel-open');
  if (openSection === 'p-loadout' && menu) { menu.setMode(menuMode); menu.showFor = null; }
  $('panel').classList.remove('loadout');
  openSection = null;
  if (menu) menu.setShift(false);
  for (const b of $('mainnav').children) b.classList.remove('on');
  renderShowcase();
}
function show(id) { // compatibility helper used by the online code
  if (id === 'p-main') { $('menu').classList.remove('hidden'); closePanel(); }
  else if (id === 'p-lobby') openPanel('p-lobby', 'Lobby', true);
  else if (id === 'p-join') openPanel('p-online', 'Online Match');
}
$('panel-close').addEventListener('click', () => { sound.play('click'); closePanel(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !session && openSection) closePanel(); });

const navActions = {
  'play-survivor': () => { botsCfg.role = 'survivor'; setSeg('bots-role', 'survivor'); setScene('survivor'); openPanel('p-play', 'Play as Survivor'); },
  'play-killer': () => { botsCfg.role = 'killer'; setSeg('bots-role', 'killer'); setScene('killer'); openPanel('p-play', 'Play as Killer'); },
  online: () => { if (lobby) openPanel('p-lobby', 'Lobby', true); else openPanel('p-online', 'Online Match'); },
  loadout: () => openPanel('p-loadout', 'Loadout', true),
  settings: () => openPanel('p-settings', 'Settings'),
  help: () => openPanel('p-help', 'How to Play', true),
  store: () => openStore(),
  pass: () => openPanel('p-pass', 'Progress', true),
  test: () => { renderTest(); openPanel('p-test', 'Testing Area', true); },
};
for (const b of $('mainnav').children) {
  b.addEventListener('mouseenter', () => { sound.init(); sound.play('hover'); if (b.dataset.scene) setScene(b.dataset.scene); });
  b.addEventListener('click', () => {
    sound.init(); sound.play('click');
    for (const x of $('mainnav').children) x.classList.toggle('on', x === b);
    navActions[b.dataset.act]();
  });
}
document.addEventListener('pointerdown', () => sound.init(), { once: true });

function seg(id, onChange) {
  const el = $(id);
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of el.children) x.classList.toggle('on', x === b);
    sound.play('click');
    onChange(b.dataset.v);
  });
}
function setSeg(id, v) { for (const x of $(id).children) x.classList.toggle('on', x.dataset.v === String(v)); }

// ---------- loadout ----------
let loTab = 'survivor';
seg('lo-tab', v => { loTab = v; menuMode = v; loSel = null; renderLoadout($('lo-body'), loTab, false); });
// a character's story: the title and the first paragraph, the rest behind "Read more"
function loreHTML(id, open = false) {
  const L = LORE[id]; if (!L) return '';
  const name = (KILLERS[id] || SURVIVORS[id] || {}).name || '';
  return `<details class="lore-card" ${open ? 'open' : ''}><summary><span class="lore-k">Lore · ${esc(name)}</span><b>${esc(L.title)}</b><p>${esc(L.story[0])}</p><i>Read more</i></summary>${L.story.slice(1).map(x => `<p>${esc(x)}</p>`).join('')}</details>`;
}
let loSel = null; // perk selected on the full Loadout screen
function renderLoadout(container, role, compact, onChange) {
  const defs = role === 'killer' ? KILLERS : SURVIVORS;
  const perks = role === 'killer' ? KILLER_PERKS : SURV_PERKS;
  const lo = profile[role];
  // drop perks this character can't use (an exclusive perk after switching survivor)
  lo.perks = lo.perks.filter(k => perks[k] && perkFits(k, lo.char) && ownsPerk(k)).slice(0, PERK_SLOTS);
  const rerender = () => { renderLoadout(container, role, compact, onChange); onChange && onChange(); };
  const toggle = k => {
    if (!ownsPerk(k) || !perkFits(k, lo.char)) return;
    const i = lo.perks.indexOf(k);
    if (i >= 0) lo.perks.splice(i, 1); else { if (lo.perks.length >= PERK_SLOTS) lo.perks.shift(); lo.perks.push(k); }
    saveProfile(); sound.play('click');
  };
  if (compact) {
    // lobby / bot setup: just the perks you own and can use
    const color = c => '#' + (c.shirt ?? c.color).toString(16).padStart(6, '0');
    const usable = Object.entries(perks).filter(([k]) => ownsPerk(k) && perkFits(k, lo.char));
    container.innerHTML = `<div class="lo-sub"><span>${role === 'killer' ? 'Killer' : 'Survivor'}</span></div>
      <div class="chars">${Object.values(defs).filter(c => shownChar(c.id)).map(c => `<div class="char ${lo.char === c.id ? 'on' : ''} ${ownsChar(c.id) ? '' : 'locked'}" data-c="${c.id}" style="--c:${color(c)}"><b>${esc(c.name)}${ownsChar(c.id) ? '' : ` <span class="newtag">${LIMITED(c.id) ? 'LIMITED' : 'DLC'}</span>`}</b>${c.ability ? `<div class="ab">${icon(POWER_ICON[c.id])}${esc(c.ability.name)}</div>` : ''}</div>`).join('')}</div>
      ${role === 'survivor' ? `<div class="lo-sub"><span>Item</span></div><div class="seg lo-item"><button data-item="flashlight" class="${lo.item !== 'trap' ? 'on' : ''}">Flashlight</button><button data-item="trap" class="${lo.item === 'trap' ? 'on' : ''}">Ghost Trap</button></div>` : ''}
      <div class="lo-sub"><span>Perks</span><span>${lo.perks.length} / ${PERK_SLOTS} · buy more in Loadout</span></div>
      <div class="perkgrid">${usable.map(([k, p]) => `<div class="pk ${lo.perks.includes(k) ? 'on' : ''}" data-p="${k}"><div class="diamond ${role === 'killer' ? 'k' : ''} ${p.only ? 'ex' : ''}">${icon(k)}</div><div><b>${esc(p.name)}</b><small>${esc(p.desc)}</small></div></div>`).join('')}</div>`;
    container.querySelectorAll('.pk').forEach(el => el.onclick = () => { toggle(el.dataset.p); rerender(); });
  } else {
    // full Loadout: character row, equipped slots, the perk inventory and the selected perk;
    // the character stands in the showroom on the right
    if (!loSel || !perks[loSel]) loSel = lo.perks[0] || Object.keys(perks)[0];
    const list = Object.entries(perks).sort(([a, x], [b, y]) => (x.only === lo.char ? -1 : 0) - (y.only === lo.char ? -1 : 0) || (ownsPerk(b) - ownsPerk(a)) || (!!x.only - !!y.only));
    const P = perks[loSel], own = ownsPerk(loSel), fits = perkFits(loSel, lo.char), eq = lo.perks.includes(loSel);
    const act = !fits ? `<span class="pd-note">Only ${esc(charName0(P.only))} can use this perk${own ? '' : ` · ${price(perkPrice(loSel))}`}</span>${!own ? `<button class="btn" data-buyperk="${loSel}">Buy</button>` : ''}`
      : !own ? `<span class="ch-price">${price(perkPrice(loSel))}</span><button class="btn primary" data-buyperk="${loSel}">Buy perk</button>`
      : `<button class="btn ${eq ? '' : 'primary'}" data-eqperk="${loSel}">${eq ? 'Unequip' : 'Equip'}</button>`;
    const slots = Array.from({ length: PERK_SLOTS }, (_, i) => { const k = lo.perks[i]; return `<button class="slot-d ${k ? 'full' : ''}" ${k ? `data-slot="${k}"` : ''} title="${k ? esc(perks[k].name) : 'Empty slot'}"><span class="diamond ${role === 'killer' ? 'k' : ''} ${k && perks[k].only ? 'ex' : ''}">${k ? icon(k) : ''}</span></button>`; }).join('');
    const grid = list.map(([k, p]) => {
      const o = ownsPerk(k), f = perkFits(k, lo.char);
      return `<button class="inv-d ${lo.perks.includes(k) ? 'eq' : ''} ${o ? '' : 'locked'} ${f ? '' : 'other'} ${k === loSel ? 'sel' : ''}" data-perk="${k}" title="${esc(p.name)}"><span class="diamond ${role === 'killer' ? 'k' : ''} ${p.only ? 'ex' : ''}">${icon(k)}</span>${!o ? `<i class="pr">${(perkPrice(k) / 1000).toFixed(1).replace('.0', '')}k</i>` : ''}</button>`;
    }).join('');
    container.innerHTML = `<div class="lo2">
      <div class="lo2-chars">${Object.values(defs).filter(c => shownChar(c.id)).map(c => `<button class="lo2-por ${lo.char === c.id ? 'on' : ''} ${ownsChar(c.id) ? '' : 'locked'}" data-c="${c.id}" title="${esc(c.name)}"><img alt="" src="${art('portrait', c.id, skinId(c.id), 120, 120)}"><span>${esc(c.name.replace(/^The /, ''))}</span>${ownsChar(c.id) ? '' : `<i class="lock">${LIMITED(c.id) ? 'LIMITED' : 'DLC'}</i>`}</button>`).join('')}</div>
      <div class="lo2-head"><b>${esc(charName0(lo.char))}</b>${role === 'killer' && defs[lo.char] ? `<span>${icon(POWER_ICON[lo.char])}${esc(defs[lo.char].ability.name)}</span>` : ''}</div>
      ${role === 'survivor' ? `<div class="lo2-row"><span class="lo2-lbl">Item</span><div class="seg lo-item"><button data-item="flashlight" class="${lo.item !== 'trap' ? 'on' : ''}">Flashlight</button><button data-item="trap" class="${lo.item === 'trap' ? 'on' : ''}">Ghost Trap</button></div></div>` : ''}
      <div class="lo2-row"><span class="lo2-lbl">Sidekick</span><div class="seg lo-pet"><button data-petpick="" class="${!petOf(role) ? 'on' : ''}">None</button>${Object.entries(SIDEKICKS).map(([id, s]) => `<button data-petpick="${id}" class="${petOf(role) === id ? 'on' : ''} ${profile.pets[id] ? '' : 'locked'}">${esc(s.name)}${profile.pets[id] ? '' : ' 🔒'}</button>`).join('')}</div></div>
      ${role === 'killer' && POWER_LV[lo.char] ? powerRowHTML(lo.char) : ''}
      <div class="lo2-row"><span class="lo2-lbl">Perks</span><div class="lo2-slots">${slots}</div></div>
      <div class="lo2-inv-t"><span>Inventory · Perks</span><span>${Object.keys(perks).filter(ownsPerk).length} / ${Object.keys(perks).length} owned · ${price(profile.stats.embers)}</span></div>
      <div class="lo2-inv">${grid}</div>
      <div class="lo2-detail"><span class="diamond ${role === 'killer' ? 'k' : ''} ${P.only ? 'ex' : ''}">${icon(loSel)}</span><div><b>${esc(P.name)}</b>${P.only ? `<em>${esc(charName0(P.only))} only</em>` : ''}<small>${esc(P.desc)}</small><div class="row">${act}</div></div></div>
      ${LORE[lo.char] ? loreHTML(lo.char) : ''}
    </div>`;
    container.querySelectorAll('[data-lvup]').forEach(b => b.onclick = () => {
      const c = b.dataset.lvup, L = POWER_LV[c], cur = myReach(c);
      if (cur >= L.max) return;
      if (!spend(L.cost, `${L.power} +${L.step}m`)) return;
      profile.levels[c] = cur + L.step; saveProfile(); sound.play('escaped'); toast(`${L.power} now reaches ${cur + L.step}m`); rerender();
    });
    container.querySelectorAll('[data-gstyle]').forEach(b => b.onclick = () => { profile.grannyStyle = b.dataset.gstyle; saveProfile(); sound.play('click'); rerender(); });
    container.querySelectorAll('.inv-d').forEach(el => {
      el.onclick = () => { loSel = el.dataset.perk; sound.play('hover'); rerender(); };
      el.ondblclick = () => { toggle(el.dataset.perk); rerender(); };
    });
    container.querySelectorAll('[data-slot]').forEach(el => el.onclick = () => { loSel = el.dataset.slot; toggle(el.dataset.slot); rerender(); });
    container.querySelectorAll('[data-eqperk]').forEach(el => el.onclick = () => { toggle(el.dataset.eqperk); rerender(); });
    container.querySelectorAll('[data-buyperk]').forEach(el => el.onclick = () => {
      const k = el.dataset.buyperk;
      if (ownsPerk(k) || !spend(perkPrice(k), perks[k].name)) return;
      profile.perksOwned[k] = true;
      if (perkFits(k, lo.char) && lo.perks.length < PERK_SLOTS) lo.perks.push(k);
      saveProfile(); rerender();
    });
    container.querySelectorAll('[data-petpick]').forEach(el => el.onclick = () => {
      const id = el.dataset.petpick;
      if (id && !profile.pets[id]) { sound.play('click'); openStore('sidekicks'); storePet = id; renderStore(); return; }
      lo.pet = id; saveProfile(); sound.play('click'); rerender();
    });
    if (menu) { menu.setShowcase(lo.char, skinId(lo.char), 0.42, petOf(role)); menu.setMode('show'); }
  }
  container.querySelectorAll('.char, .lo2-por').forEach(el => el.onclick = () => {
    if (!ownsChar(el.dataset.c)) { sound.play('click'); if (LIMITED(el.dataset.c)) openStore('characters', el.dataset.c); else openStore('chapters'); return; }
    lo.char = el.dataset.c; saveProfile(); sound.play('click');
    if (menu) { if (role === 'killer') menu.setKiller(lo.char, skinId(lo.char)); else menu.setSurvivor(lo.char, skinId(lo.char)); }
    if (compact) setScene(role);
    rerender();
  });
  container.querySelectorAll('[data-item]').forEach(el => el.onclick = () => { lo.item = el.dataset.item; saveProfile(); sound.play('click'); rerender(); });
}

// ---------- settings ----------
const QHINT = {
  potato: 'Very Low: for older laptops and integrated graphics. No shadows or effects, reduced draw distance.',
  low: 'Low: no shadows or post-processing, light foliage. Good for most laptops.',
  medium: 'Medium: shadows, bloom and color grading.',
  high: 'High: sharp shadows, dense grass and full effects. Needs a dedicated GPU.',
};
function renderSettings() {
  $('set-name').value = settings.name;
  setSeg('set-quality', settings.quality); $('set-quality-hint').textContent = QHINT[settings.quality];
  setSeg('set-style', settings.style === 'classic' ? 'classic' : 'realistic'); $('set-style-hint').textContent = SHINT[settings.style === 'classic' ? 'classic' : 'realistic'];
  $('set-dynres').checked = settings.dynres !== false; $('set-fps').checked = !!settings.showFps;
  $('set-bright').value = settings.brightness || 1; $('set-bright-v').textContent = Math.round((settings.brightness || 1) * 100) + '%';
  $('set-sens').value = settings.sens; $('set-sens-v').textContent = (+settings.sens).toFixed(2);
  $('set-fov').value = settings.fov; $('set-fov-v').textContent = settings.fov;
  $('set-vol').value = settings.vol; $('set-music').value = settings.music;
  $('set-invert').checked = !!settings.invert;
  $('set-subs').checked = settings.subs !== false;
  $('set-net').value = settings.net;
  renderCam();
  rebinding = null; renderKeybinds();
}
$('set-name').addEventListener('input', e => { settings.name = e.target.value.trim().slice(0, 16) || 'Player'; saveSettings(); renderShowcase(); });
const SHINT = {
  realistic: 'Realistic: real photo-scanned ground, stone, brick, wood, metal and bark (Medium/High), real fir trees, swaying grass, moonlight shafts, ambient occlusion, night colour vision and softer shadows. Needs a decent GPU: use Classic on older laptops.',
  classic: 'Classic: the original Nightbound look. Lighter on older laptops.',
};
seg('set-style', v => { settings.style = v; saveSettings(); $('set-style-hint').textContent = SHINT[v]; stopBG(); makeRenderer(); startBG(); });
seg('set-quality', v => { settings.quality = v; saveSettings(); $('set-quality-hint').textContent = QHINT[v]; stopBG(); makeRenderer(); startBG(); });
$('set-dynres').addEventListener('change', e => { settings.dynres = e.target.checked; saveSettings(); });
$('set-fps').addEventListener('change', e => { settings.showFps = e.target.checked; saveSettings(); });
$('set-bright').addEventListener('input', e => { settings.brightness = +e.target.value; saveSettings(); $('set-bright-v').textContent = Math.round(settings.brightness * 100) + '%'; if (renderer) renderer.toneMappingExposure = 1.35 * settings.brightness; if (session && session.game && session.game.W) session.game.W.base = null; });
$('set-sens').addEventListener('input', e => { settings.sens = +e.target.value; $('set-sens-v').textContent = settings.sens.toFixed(2); saveSettings(); });
$('set-fov').addEventListener('input', e => { settings.fov = +e.target.value; $('set-fov-v').textContent = settings.fov; saveSettings(); });
$('set-vol').addEventListener('input', e => { settings.vol = +e.target.value; sound.setVolume(settings.vol); saveSettings(); });
$('set-music').addEventListener('input', e => { settings.music = +e.target.value; sound.setMusic(settings.music); saveSettings(); });
$('set-invert').addEventListener('change', e => { settings.invert = e.target.checked; saveSettings(); });
$('set-subs').addEventListener('change', e => { settings.subs = e.target.checked; saveSettings(); });
// ---------- keybinds ----------
let rebinding = null;
function renderKeybinds() {
  const el = $('keybinds'); if (!el) return;
  el.innerHTML = ACTIONS.map(a => {
    const k = bound(settings, a.id), changed = settings.keys && settings.keys[a.id] && settings.keys[a.id] !== a.def;
    return `<div class="kb-row"><span>${a.label}</span><button class="kb-key${rebinding === a.id ? ' listening' : ''}${changed ? ' changed' : ''}" data-bind="${a.id}">${rebinding === a.id ? 'Press a key…' : keyName(k)}</button></div>`;
  }).join('');
}
$('keybinds').addEventListener('click', e => { const b = e.target.closest('[data-bind]'); if (!b) return; rebinding = rebinding === b.dataset.bind ? null : b.dataset.bind; renderKeybinds(); });
$('keys-reset').addEventListener('click', () => { settings.keys = {}; rebinding = null; saveSettings(); renderKeybinds(); toast('Keybinds reset to defaults.'); });
// capture the next key press for the action being rebound; a key already in use swaps over
addEventListener('keydown', e => {
  if (!rebinding) return;
  e.preventDefault(); e.stopPropagation();
  if (e.code === 'Escape') { rebinding = null; renderKeybinds(); return; }
  if (RESERVED.has(e.code)) { toast(keyName(e.code) + " can't be bound."); return; }
  const keys = settings.keys = { ...(settings.keys || {}) }, old = bound(settings, rebinding);
  const other = ACTIONS.find(a => a.id !== rebinding && bound(settings, a.id) === e.code);
  if (other) { keys[other.id] = old; toast(`${other.label} moved to ${keyName(old)}.`); }
  keys[rebinding] = e.code;
  for (const a of ACTIONS) if (keys[a.id] === a.def) delete keys[a.id];
  rebinding = null; saveSettings(); renderKeybinds();
}, true);
renderKeybinds();
$('set-net').addEventListener('change', e => { settings.net = e.target.value; saveSettings(); });
// ---------- camera placement (settings and pause menu share these controls) ----------
const CAM_DEF = { side: 1, dist: 1, height: 0, angle: 0 };
const camKey = { side: 'camSide', dist: 'camDist', height: 'camHeight', angle: 'camAngle' };
const camFmt = { dist: v => Math.round(v * 100) + '%', height: v => (v > 0 ? '+' : '') + (+v).toFixed(2) + ' m', angle: v => (v > 0 ? '+' : '') + v + '°' };
function renderCam() {
  for (const el of document.querySelectorAll('[data-cam]')) {
    const k = el.dataset.cam; if (k === 'reset') continue;
    const v = settings[camKey[k]] ?? CAM_DEF[k];
    if (k === 'side') { for (const b of el.children) b.classList.toggle('on', +b.dataset.v === v); } else el.value = v;
  }
  for (const el of document.querySelectorAll('[data-camv]')) { const k = el.dataset.camv; el.textContent = camFmt[k](settings[camKey[k]] ?? CAM_DEF[k]); }
}
window.addEventListener('nb-cam', () => { saveSettings(); renderCam(); });
for (const el of document.querySelectorAll('[data-cam]')) {
  const k = el.dataset.cam;
  if (k === 'reset') el.addEventListener('click', () => { for (const [a, b] of Object.entries(camKey)) settings[b] = CAM_DEF[a]; saveSettings(); renderCam(); });
  else if (k === 'side') el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; settings.camSide = +b.dataset.v; saveSettings(); renderCam(); });
  else el.addEventListener('input', () => { settings[camKey[k]] = +el.value; saveSettings(); renderCam(); });
}
renderCam();
$('pause-sens').addEventListener('input', e => { settings.sens = +e.target.value; saveSettings(); });
$('pause-vol').addEventListener('input', e => { settings.vol = +e.target.value; sound.setVolume(settings.vol); saveSettings(); });

// ---------- store ----------
// ---------- store (full screen, DbD-style) ----------
const RARITY0 = p => p === 0 ? '' : p < 2000 ? 'common' : p < 3500 ? 'rare' : p < 5000 ? 'epic' : 'legendary';
const RARITY = (p, sk) => sk && sk.god ? 'god' : sk && sk.limited ? 'limited' : RARITY0(p);
let storeTab = 'chapters', storeRole = 'survivor', storeChar = null, storePreview = null;
const ownsChapter = id => !!(profile.dlc && profile.dlc[id]);
// ---------- killer power levels (reach in metres, bought with Embers) ----------
setTedPrefs(profile.tedLines || {});
profile.levels ||= {};
const myReach = c => powerReach(c, profile.levels[c]);
// players who played Granny before her rework keep her original Bat Rush and can switch styles
if (!profile.ogChecked) {
  profile.ogChecked = true;
  if ((profile.played && profile.played.granny) || (profile.killer && profile.killer.char === 'granny' && profile.stats.matches > 0)) { profile.grannyOg = true; profile.grannyStyle = 'og'; }
}
const grannyOgOn = () => !!profile.grannyOg && profile.grannyStyle === 'og';
if (profile.grannyOg && !(profile.perksOwned || {}).extreme) { (profile.perksOwned ||= {}).extreme = true; }
const killerExtras = c => ({ lv: POWER_LV[c] ? myReach(c) : undefined, og: c === 'granny' && grannyOgOn() });
function powerRowHTML(c) {
  const L = POWER_LV[c], cur = myReach(c), full = cur >= L.max, og = c === 'granny' && grannyOgOn();
  const style = c === 'granny' && profile.grannyOg ? `<div class="seg lv-style"><button data-gstyle="new" class="${!og ? 'on' : ''}">Current</button><button data-gstyle="og" class="${og ? 'on' : ''}">Original</button></div>` : '';
  return `<div class="lo2-row lv-row"><span class="lo2-lbl">${esc(L.power)}</span><div class="lv-box">${og ? `<div class="lv-info"><b>No limit</b></div>` : `<div class="lv-info"><b>${cur}m</b><span>of ${L.max}m</span></div><div class="lv-bar"><i style="width:${(cur - L.base) / (L.max - L.base) * 100}%"></i></div>${full ? '<span class="of-p own">Max level</span>' : `<button class="btn primary" data-lvup="${c}">+${L.step}m · ${price(L.cost)}</button>`}`}${style}</div></div>`;
}
const LIMITED = c => SURVIVORS[c] && SURVIVORS[c].limited;
const ownsChar = c => (!LIMITED(c) || !!profile.owned['char:' + c]) && (!CHAPTER_OF[c] || ownsChapter(CHAPTER_OF[c]));
// a limited character leaves the Store for good when the sale ends (owners keep them)
const onSale = c => LIMITED(c) && Date.now() < LIMITED(c).until;
const shownChar = c => !LIMITED(c) || ownsChar(c) || onSale(c);
const leftTxt = c => { const ms = LIMITED(c).until - Date.now(), h = Math.max(0, Math.floor(ms / 36e5)); return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h left` : `${h}h ${Math.max(0, Math.floor(ms / 6e4) % 60)}m left`; };
// players who already played a match as Spider-Man keep him
if (!profile.owned['char:spiderman'] && ((profile.played && profile.played.spiderman) || (profile.survivor && profile.survivor.char === 'spiderman' && profile.stats.matches > 0))) { profile.owned['char:spiderman'] = true; }
const charName = c => (KILLERS[c] || SURVIVORS[c]).name;
const ownsSkin = (c, sk) => sk.price === 0 || !!profile.owned[c + ':' + sk.id];
const price = n => `${icon('ember')}${Math.round(n).toLocaleString()}`;
function spend(n, what) {
  if (profile.stats.embers < n) { toast('Not enough Embers. Play matches or claim the gifts in your Inbox.'); sound.play('click'); return false; }
  profile.stats.embers -= n; saveProfile(); sound.play('escaped'); toast(`Unlocked ${what}!`); renderShowcase();
  return true;
}
function openStore(tab, char) {
  if (tab) storeTab = tab;
  if (char) { storeChar = char; storeRole = KILLERS[char] ? 'killer' : 'survivor'; storePreview = null; }
  closePanel();
  $('store').classList.remove('hidden'); $('menu').classList.add('store-open');
  if (menu) menu.setShift(false);
  renderStore();
}
function closeStore() {
  $('store').classList.add('hidden'); $('menu').classList.remove('store-open');
  if (menu) { menu.setSurvivor(profile.survivor.char, skinId(profile.survivor.char)); menu.setKiller(profile.killer.char, skinId(profile.killer.char)); menu.setMode(menuMode); menu.showFor = null; }
  for (const b of $('mainnav').children) b.classList.remove('on');
  renderShowcase();
}
$('st-close').onclick = () => { sound.play('click'); closeStore(); };
$('st-tabs').querySelectorAll('button').forEach(b => b.onclick = () => { editTed = false; storeTab = b.dataset.t; sound.play('click'); renderStore(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !session && !$('store').classList.contains('hidden')) closeStore(); });

// ---------- store: the desktop app ----------
const APP_URL = 'https://froodyofficial-maker.github.io/Nightbound/downloads/Nightbound-Windows.zip';
function appHTML() {
  return `<div class="app-card"><div class="app-icon">N</div><div class="app-info">
    <small>Free download</small><h2>Nightbound for Windows</h2>
    <p>Play Nightbound as a desktop app in its own window, no browser needed. It always opens the latest version of the game.</p>
    <ul><li>Windows 10 or 11, a 1 MB download</li><li>Needs an internet connection</li><li>Your progress in the app is saved separately from the browser</li></ul>
    <div class="ch-buy"><span class="ch-price">Free</span><a class="btn primary big" href="${APP_URL}" download>Download</a></div>
    <p class="hint">After downloading: unzip it and double-click <b>Nightbound.exe</b>. If Windows says "Windows protected your PC", click <b>More info</b>, then <b>Run anyway</b> (the app is not code-signed).</p>
  </div></div>`;
}
function renderStore() {
  for (const b of $('st-tabs').children) b.classList.toggle('on', b.dataset.t === storeTab);
  $('st-wallet').innerHTML = price(profile.stats.embers);
  $('store').classList.toggle('wide', storeTab !== 'characters');
  const body = $('st-body');
  if (storeTab === 'chapters') body.innerHTML = chaptersHTML();
  else if (storeTab === 'collections') body.innerHTML = collectionsHTML();
  else if (storeTab === 'sidekicks') body.innerHTML = sidekicksHTML();
  else if (storeTab === 'app') body.innerHTML = appHTML();
  else if (storeTab === 'powerups') body.innerHTML = powerupsHTML();
  else body.innerHTML = charactersHTML();
  bindStore(body);
  $('show-drag').style.display = storeTab === 'sidekicks' && editTed ? 'none' : ''; // no turntable hint over the line editor
  if (menu && storeTab === 'sidekicks') { const role = storePetRole; menu.setShowcase(profile[role].char, skinId(profile[role].char), 0.3, storePet); menu.setMode('show'); menu.showFor = null; }
  else if (menu) { if (storeTab === 'characters') { if (!menu.showRig || menu.showFor !== storeChar + ':' + (storePreview || skinId(storeChar))) { menu.showFor = storeChar + ':' + (storePreview || skinId(storeChar)); previewSkin(storePreview || skinId(storeChar)); } else menu.setMode('show'); } else menu.setMode(menuMode); }
}
function chaptersHTML() {
  const dlc = CHAPTERS.filter(c => !c.base), base = CHAPTERS.filter(c => c.base);
  const hero = dlc.map(c => {
    const own = ownsChapter(c.id);
    return `<div class="ch-hero"><div class="ch-art"><div class="${c.banner || 'offal'}-art"></div><div class="ch-x">× <span>Nightbound</span></div></div>
      <div class="ch-info"><span class="ch-tag ${own ? 'owned' : ''}">${own ? 'Owned' : 'New chapter'}</span>
        <div class="ch-name"><small>Chapter ${c.num}</small>${esc(c.name)} <span style="color:var(--red2)">×</span> Nightbound</div>
        <div class="ch-line">${esc(c.tagline)}</div>
        <ul>${c.contents.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <div class="ch-buy">${own ? `<button class="btn primary" data-play="${c.killer}">Play as ${esc(charName(c.killer))}</button><button class="btn" data-goto="${c.killer}">Outfits</button>`
          : `<span class="ch-price">${price(c.price)}</span><button class="btn primary big" data-chapter="${c.id}">Buy Chapter</button><button class="btn" data-goto="${c.killer}">Preview</button>`}</div></div></div>`;
  }).join('');
  const cards = base.map(c => `<div class="ch-card"><div class="ch-img" style="background-image:url(${art('banner', c.killer, 'default', 760, 333)})"></div>
    <div class="ch-cap"><small>Chapter ${c.num}</small><b>${esc(c.name)}</b><small>${esc(charName(c.killer))}</small><i>Owned · base game</i></div></div>`).join('');
  return hero + `<div class="ch-row-title">Chapters</div><div class="ch-grid">${cards}</div>`;
}
function charactersHTML() {
  const chars = (storeRole === 'killer' ? Object.keys(KILLERS) : Object.keys(SURVIVORS)).filter(shownChar);
  if (!storeChar || !chars.includes(storeChar)) storeChar = profile[storeRole].char;
  const list = SKINS[storeChar] || [];
  const sel = list.find(x => x.id === (storePreview || skinId(storeChar))) || list[0];
  const grid = chars.map(c => `<button class="cs-por ${c === storeChar ? 'on' : ''}" data-c="${c}"><img alt="" src="${art('portrait', c, skinId(c), 224, 224)}">${ownsChar(c) ? '' : `<i class="lock">${LIMITED(c) ? 'LIMITED' : 'DLC'}</i>`}<span>${esc(charName(c).replace(/^The /, ''))}</span></button>`).join('');
  const outfits = list.map(sk => {
    const own = ownsSkin(storeChar, sk), eq = skinId(storeChar) === sk.id, r = RARITY(sk.price, sk) || 'base';
    const tag = eq ? '<span class="of-p eq">Equipped</span>' : own ? '<span class="of-p own">Owned</span>' : `<span class="of-p">${price(sk.price)}</span>`;
    return `<div class="of ${r} ${sel && sel.id === sk.id ? 'on' : ''}" data-s="${sk.id}"><img alt="" src="${art('portrait', storeChar, sk.id, 180, 180)}"><span class="of-n">${esc(sk.name)}</span>${sk.god ? '<span class="of-god">GOD TIER</span>' : ''}${tag}</div>`;
  }).join('');
  let detail = '';
  if (sel) {
    const own = ownsSkin(storeChar, sel), eq = skinId(storeChar) === sel.id, r = RARITY(sel.price, sel) || 'base';
    const locked = !ownsChar(storeChar);
    const act = locked && LIMITED(storeChar) ? `<span class="ch-price">${price(LIMITED(storeChar).price)}</span><button class="btn primary" data-buychar="${storeChar}">Unlock ${esc(charName(storeChar))}</button><span class="lim-left">Limited · ${leftTxt(storeChar)}, then gone forever</span>`
      : locked ? `<button class="btn primary" data-tab="chapters">Get the ${esc(CHAPTERS.find(c => c.killer === storeChar).name)} chapter</button>`
      : eq ? '<span class="of-p eq" style="font-size:16px">Equipped</span>' : own ? `<button class="btn primary" data-eq="${sel.id}">Equip</button>`
      : `<span class="ch-price">${price(sel.price)}</span><button class="btn primary" data-buy="${sel.id}">Buy</button>`;
    detail = `<div class="cs-detail ${r}"><div class="rk">${r === 'base' ? 'Default outfit' : r === 'limited' ? 'Limited edition' : r === 'god' ? 'God tier · changes how you play' : r}</div><h3>${esc(sel.name)}</h3><p>${esc(charName(storeChar))}${sel.desc ? ` · ${esc(sel.desc)}` : ''}</p><div class="row">${act}</div></div>`;
  }
  return `<div class="cs-wrap"><div class="cs-roles"><button data-role="survivor" class="${storeRole === 'survivor' ? 'on' : ''}">Survivors</button><button data-role="killer" class="${storeRole === 'killer' ? 'on' : ''}">Killers</button></div>
    <div class="cs-grid">${grid}</div>
    ${loreHTML(storeChar)}
    <div class="cs-sub"><b>${esc(charName(storeChar))}</b><span>Outfits</span></div>
    <div class="cs-outfits">${outfits}</div></div>${detail}`;
}
const bundleOf = c => { const items = (SKINS[c] || []).filter(sk => sk.price > 0); const left = items.filter(sk => !ownsSkin(c, sk)); const full = left.reduce((a, sk) => a + sk.price, 0); return { items, left, full, price: Math.round(full * 0.75 / 50) * 50 }; };
function collectionsHTML() {
  const cards = [...Object.keys(KILLERS), ...Object.keys(SURVIVORS)].filter(shownChar).map(c => {
    const b = bundleOf(c), done = !b.left.length, locked = !ownsChar(c);
    const buy = done ? '<span class="of-p own" style="font-size:15px">Complete</span>' : locked ? (LIMITED(c) ? `<button class="btn" data-goto="${c}">Unlock ${esc(charName(c))} first</button>` : '<button class="btn" data-tab="chapters">Requires the chapter</button>')
      : `<span><span class="st-strike">${Math.round(b.full).toLocaleString()}</span> <span class="ch-price">${price(b.price)}</span></span><span class="co-save">-25%</span><button class="btn primary" data-bundle="${c}">Buy Collection</button>`;
    return `<div class="co-card"><div class="ch-img" style="background-image:url(${art('banner', c, b.items.length ? b.items[b.items.length - 1].id : 'default', 760, 333)})"><div class="co-t"><small>${KILLERS[c] ? 'Killer' : 'Survivor'} collection</small>${esc(charName(c))}</div></div>
      <div class="co-body"><div class="co-items">${b.items.map(sk => `<span class="${ownsSkin(c, sk) ? 'own' : ''}">${esc(sk.name)}</span>`).join('')}</div><div class="co-buy">${buy}</div></div></div>`;
  }).join('');
  return `<div class="ch-row-title">Outfit collections · every outfit for one character at 25% off</div><div class="co-grid">${cards}</div>`;
}
// ---------- sidekicks ----------
let storePet = 'ted', storePetRole = 'survivor';
// Edit Ted: choose, line by line, what he says (Play), what gets bleeped, and what he never says (Off)
let editTed = false;
function tedEditHTML() {
  const P = profile.tedLines ||= {};
  const rows = Object.keys(TED_LINES).map(k => {
    const v = P[k] || 'play';
    return `<div class="ted-line"><button class="btn small" data-tedhear="${k}" title="Preview">▶</button><span class="tl-txt ${v === 'off' ? 'off' : ''}">${esc(v === 'bleep' ? tedText(k) : TED_LINES[k])}</span>
      <div class="seg tl-seg">${['play', 'bleep', 'off'].map(o => `<button data-tedset="${k}" data-v="${o}" class="${v === o ? 'on' : ''}">${o === 'play' ? 'Play' : o === 'bleep' ? 'Bleep' : 'Off'}</button>`).join('')}</div></div>`;
  }).join('');
  return `<div class="ted-edit"><div class="te-head"><button class="btn" data-tedback>← Sidekicks</button><div><small>Edit sidekick</small><b>Ted's lines</b></div>
    <div class="te-presets"><button class="btn" data-tedpreset="family">Family friendly</button><button class="btn" data-tedpreset="all">Everything on</button></div></div>
    <p class="hint">Play: Ted says it. Bleep: a censor bleep instead, and the swearing is starred out in the subtitles. Off: he never says it. This applies to every Ted you hear, online too.</p>
    <div class="ted-lines">${rows}</div></div>`;
}
// ---------- Power Ups: bought once, switched on and off here ----------
const activePU = () => Object.keys(POWERUPS).filter(k => (profile.powerups || {})[k] && !(profile.puOff || {})[k]);
function powerupsHTML() {
  const cards = Object.entries(POWERUPS).map(([id, u]) => {
    const own = !!(profile.powerups || {})[id], on = own && !(profile.puOff || {})[id];
    const btns = own ? `<div class="seg"><button data-puon="${id}" class="${on ? 'on' : ''}">On</button><button data-puoff="${id}" class="${on ? '' : 'on'}">Off</button></div>`
      : `<span class="ch-price">${price(u.price)}</span><button class="btn primary" data-pubuy="${id}">Unlock</button>`;
    return `<div class="pet-card pu-card ${on ? 'on' : ''}"><div class="pet-t"><small>Power Up · ${u.role === 'killer' ? 'Killer' : 'Survivor'}</small><b>${esc(u.name)}</b></div><p>${esc(u.desc)}</p><div class="row">${btns}</div></div>`;
  }).join('');
  return `<div class="ch-row-title">Power Ups · permanent upgrades. Buy once, switch them on or off any time.</div><div class="pet-grid">${cards}</div>`;
}
function sidekicksHTML() {
  if (editTed && profile.pets.ted) return tedEditHTML();
  const cards = Object.entries(SIDEKICKS).map(([id, s]) => {
    const own = !!profile.pets[id];
    const eq = r => profile[r].pet === id;
    const btns = own ? ['survivor', 'killer'].map(r => `<button class="btn ${eq(r) ? '' : 'primary'}" data-petequip="${id}" data-petrole="${r}">${eq(r) ? 'Unequip' : 'Equip'} (${r === 'killer' ? 'Killer' : 'Survivor'})</button>`).join('')
      : `<span class="ch-price">${price(s.price)}</span><button class="btn primary" data-petbuy="${id}">Buy</button>`;
    const edit = own && id === 'ted' ? `<button class="btn" data-tededit>Edit Ted</button>` : '';
    return `<div class="pet-card ${storePet === id ? 'on' : ''}" data-pet="${id}"><div class="pet-t"><small>Sidekick</small><b>${esc(s.name)}</b></div><p>${esc(s.desc)}</p><div class="row">${btns}${edit}</div></div>`;
  }).join('');
  return `<div class="ch-row-title">Sidekicks · they follow you, react to the match and can't be hurt. Equip one for your survivor and one for your killer.</div><div class="pet-grid">${cards}</div>`;
}

function bindStore(body) {
  body.querySelectorAll('[data-pubuy]').forEach(b => b.onclick = () => { const id = b.dataset.pubuy, u = POWERUPS[id]; if ((profile.powerups || {})[id] || !spend(u.price, u.name)) return; (profile.powerups ||= {})[id] = true; saveProfile(); sound.play('caged'); renderStore(); });
  body.querySelectorAll('[data-puon]').forEach(b => b.onclick = () => { delete (profile.puOff ||= {})[b.dataset.puon]; saveProfile(); sound.play('click'); renderStore(); });
  body.querySelectorAll('[data-puoff]').forEach(b => b.onclick = () => { (profile.puOff ||= {})[b.dataset.puoff] = true; saveProfile(); sound.play('click'); renderStore(); });
  body.querySelectorAll('[data-tededit]').forEach(b => b.onclick = e => { e.stopPropagation(); sound.play('click'); editTed = true; renderStore(); });
  body.querySelectorAll('[data-tedback]').forEach(b => b.onclick = () => { sound.play('click'); editTed = false; renderStore(); });
  body.querySelectorAll('[data-tedset]').forEach(b => b.onclick = () => {
    const P = profile.tedLines ||= {}, k = b.dataset.tedset, v = b.dataset.v;
    if (v === 'play') delete P[k]; else P[k] = v;
    setTedPrefs(P); saveProfile(); sound.play('click'); renderStore();
  });
  body.querySelectorAll('[data-tedpreset]').forEach(b => b.onclick = () => {
    const P = profile.tedLines = {};
    if (b.dataset.tedpreset === 'family') for (const k of TED_RUDE) P[k] = 'bleep';
    setTedPrefs(P); saveProfile(); sound.play('click'); renderStore();
  });
  body.querySelectorAll('[data-tedhear]').forEach(b => b.onclick = () => {
    sound.init(); const k = b.dataset.tedhear, v = (profile.tedLines || {})[k] || 'play';
    if (v === 'off') { sound.play('click'); return; }
    if (v === 'bleep') sound.bleep(sound.clipLen('ted/' + k), sound.lx || 0, sound.lz || 0); else sound.clip('ted/' + k, sound.lx || 0, sound.lz || 0);
  });
  body.querySelectorAll('[data-pet]').forEach(el => el.onclick = e => { if (e.target.closest('button')) return; storePet = el.dataset.pet; sound.play('hover'); renderStore(); });
  body.querySelectorAll('[data-petbuy]').forEach(b => b.onclick = () => { const id = b.dataset.petbuy; if (profile.pets[id] || !spend(SIDEKICKS[id].price, SIDEKICKS[id].name)) return; profile.pets[id] = true; profile.survivor.pet ||= id; saveProfile(); storePet = id; renderStore(); });
  body.querySelectorAll('[data-petequip]').forEach(b => b.onclick = () => { const id = b.dataset.petequip, r = b.dataset.petrole; profile[r].pet = profile[r].pet === id ? '' : id; storePet = id; storePetRole = r; saveProfile(); sound.play('click'); renderStore(); });
  body.querySelectorAll('[data-chapter]').forEach(b => b.onclick = () => {
    const c = CHAPTERS.find(x => x.id === b.dataset.chapter);
    if (ownsChapter(c.id) || !spend(c.price, c.name + ' × Nightbound')) return;
    (profile.dlc ||= {})[c.id] = true; saveProfile(); renderStore();
  });
  body.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => { sound.play('click'); openStore('characters', b.dataset.goto); previewSkin(skinId(storeChar)); });
  body.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { sound.play('click'); storeTab = b.dataset.tab; renderStore(); });
  body.querySelectorAll('[data-play]').forEach(b => b.onclick = () => { const k = b.dataset.play; profile.killer.char = k; saveProfile(); closeStore(); navActions['play-killer'](); });
  body.querySelectorAll('[data-role]').forEach(b => b.onclick = () => { storeRole = b.dataset.role; storeChar = null; storePreview = null; sound.play('click'); setScene(storeRole); renderStore(); previewSkin(skinId(profile[storeRole].char)); });
  body.querySelectorAll('.cs-por').forEach(b => b.onclick = () => { storeChar = b.dataset.c; storePreview = null; sound.play('click'); previewSkin(skinId(storeChar)); renderStore(); });
  body.querySelectorAll('.of').forEach(el => el.onclick = () => { storePreview = el.dataset.s; sound.play('hover'); previewSkin(storePreview); renderStore(); });
  body.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => {
    const sk = SKINS[storeChar].find(x => x.id === b.dataset.buy);
    if (!spend(sk.price, sk.name)) return;
    profile.owned[storeChar + ':' + sk.id] = true; profile.skins[storeChar] = sk.id; saveProfile(); renderStore();
  });
  body.querySelectorAll('[data-buychar]').forEach(b => b.onclick = () => {
    const c = b.dataset.buychar, L = LIMITED(c); if (!L || ownsChar(c)) return;
    if (!onSale(c)) { toast(charName(c) + ' has left the Store.'); renderStore(); return; }
    if (!spend(L.price, charName(c))) return;
    profile.owned['char:' + c] = true; profile.survivor.char = c; saveProfile(); sound.play('escaped'); toast(charName(c) + ' unlocked!'); renderStore();
  });
  body.querySelectorAll('[data-eq]').forEach(b => b.onclick = () => { profile.skins[storeChar] = b.dataset.eq; saveProfile(); sound.play('click'); renderStore(); });
  body.querySelectorAll('[data-bundle]').forEach(b => b.onclick = () => {
    const c = b.dataset.bundle, bd = bundleOf(c);
    if (!spend(bd.price, charName(c) + ' Collection')) return;
    for (const sk of bd.left) profile.owned[c + ':' + sk.id] = true;
    saveProfile(); renderStore();
  });
}
// the Store shows the character standing on its own in the showroom clearing
function previewSkin(id) {
  if (!menu || !storeChar) return;
  menu.setShowcase(storeChar, id);
  menu.setMode('show');
}
onForemanReady(() => { forgetArt('foreman'); if (!$('store').classList.contains('hidden')) renderStore(); });

// ---------- inbox ----------
const unreadCount = () => INBOX.filter(m => !profile.readInbox[m.id] || (m.gift && !profile.claimed[m.id])).length;
function renderInboxBadge() {
  const n = unreadCount();
  $('inbox-badge').textContent = n; $('inbox-badge').classList.toggle('hidden', n === 0);
}
function renderInbox() {
  $('inbox-list').innerHTML = INBOX.map(m => {
    const unread = !profile.readInbox[m.id];
    const gift = m.gift ? (profile.claimed[m.id]
      ? `<div class="gift claimed">${icon('check')}${esc(m.gift.label)} · claimed</div>`
      : `<div class="gift">${icon('gift')}${esc(m.gift.label)}<button class="btn primary" data-claim="${m.id}">Claim</button></div>`) : '';
    return `<div class="msg ${unread ? 'unread' : ''}">${m.banner ? `<div class="msg-banner ${m.banner === true ? 'offal' : m.banner}-art" data-announce="${m.banner === true ? 'offal' : m.banner}"></div>` : m.gb ? `<div class="msg-banner gb-mini" data-announce="gb">Ghostbusters <i>×</i> Nightbound</div>` : ''}<div class="mtag">${esc(m.tag)} · v${esc(m.version)} · ${esc(m.date)}</div><h3>${esc(m.title)}</h3><ul>${m.body.map(b => `<li>${esc(b)}</li>`).join('')}</ul>${gift}</div>`;
  }).join('');
  $('inbox-list').querySelectorAll('[data-announce]').forEach(b => b.onclick = () => showAnnounce(b.dataset.announce));
  $('inbox-list').querySelectorAll('[data-claim]').forEach(b => b.onclick = () => {
    const m = INBOX.find(x => x.id === b.dataset.claim);
    if (!m || profile.claimed[m.id]) return;
    profile.claimed[m.id] = true; profile.stats.embers += m.gift.embers; saveProfile();
    sound.play('escaped'); toast(`+${m.gift.embers.toLocaleString()} Embers`);
    renderInbox(); renderShowcase();
  });
  for (const m of INBOX) profile.readInbox[m.id] = true;
  saveProfile(); renderInboxBadge();
}
$('inbox-btn').querySelector('.ib-ico').innerHTML = icon('mail');
$('inbox-btn').addEventListener('click', () => { sound.init(); sound.play('click'); for (const x of $('mainnav').children) x.classList.remove('on'); openPanel('p-inbox', 'Inbox'); });
renderInboxBadge();
// showroom turntable: an invisible pad over the showcased character
{
  const pad = $('show-drag'); let drag = null;
  document.body.appendChild(pad); // above the Store overlay
  pad.addEventListener('pointerdown', e => { drag = e.clientX; pad.setPointerCapture(e.pointerId); pad.classList.add('dragging'); });
  pad.addEventListener('pointermove', e => { if (drag == null || !menu) return; menu.spinShow((e.clientX - drag) * 0.012); drag = e.clientX; });
  const end = () => { drag = null; pad.classList.remove('dragging'); };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  pad.addEventListener('wheel', e => { e.preventDefault(); if (menu) menu.zoomShow(e.deltaY > 0 ? 1.08 : 1 / 1.08); }, { passive: false });
  setInterval(() => {
    const on = !!menu && menu.mode === 'show' && !session && (!$('store').classList.contains('hidden') || openSection === 'p-loadout');
    pad.classList.toggle('hidden', !on);
    pad.classList.toggle('lo', openSection === 'p-loadout');
  }, 200);
}
// "Last updated": the build stamps its time into the page; the dev server reports its newest file
let builtAt = typeof window !== 'undefined' && window.__NB_BUILT__ ? +window.__NB_BUILT__ : 0;
function renderUpdated() {
  if (!builtAt) return;
  const s = Math.max(0, (Date.now() - builtAt) / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  const ago = d >= 1 ? `${d}d ${h % 24}h` : h >= 1 ? `${h}h ${m % 60}m` : m >= 1 ? `${m}m` : 'just now';
  $('last-updated').innerHTML = `<span>v${esc(VERSION)}</span> · Last updated <b>${ago}${ago === 'just now' ? '' : ' ago'}</b>`;
  $('last-updated').title = new Date(builtAt).toLocaleString();
}
if (!builtAt && location.protocol !== 'file:') fetch('__built').then(r => r.ok ? r.text() : '').then(t => { builtAt = +t || 0; renderUpdated(); }).catch(() => {});
renderUpdated(); setInterval(renderUpdated, 30000);
if (profile.lastVersion !== VERSION) {
  profile.lastVersion = VERSION; saveProfile();
  setTimeout(() => toast('New in v' + VERSION + ': ' + INBOX[0].title + '. Check your Inbox!', 6000), 1500);
}

// ---------- bot match ----------
const botsCfg = { role: 'survivor', team: 3, surv: 4, killer: 'random', diff: 'normal', map: 'vote', gm: 'classic' };
// game mode pickers (bot match and lobby)
const gmOptions = () => Object.entries(MODES).map(([id, m]) => `<option value="${id}">${m.name} (${m.short})</option>`).join('');
$('bots-gm').innerHTML = gmOptions(); $('lobby-gm').innerHTML = gmOptions();
const gmDesc = gm => (MODES[gm] || MODES.classic).desc;
$('bots-gm-desc').textContent = gmDesc('classic');
$('bots-gm').addEventListener('change', e => { botsCfg.gm = e.target.value; $('bots-gm-desc').textContent = gmDesc(botsCfg.gm); renderBotsPanel(); });
seg('bots-role', v => { botsCfg.role = v; setScene(v); $('panel-title').textContent = v === 'killer' ? 'Play as Killer' : 'Play as Survivor'; renderBotsPanel(); });
seg('bots-team', v => { botsCfg.team = +v; });
seg('bots-surv', v => { botsCfg.surv = +v; });
seg('bots-diff', v => { botsCfg.diff = v; });
$('bots-map').addEventListener('change', e => { botsCfg.map = e.target.value; });
$('bots-killer').addEventListener('change', e => { botsCfg.killer = e.target.value; });
function renderBotsPanel() {
  const k = botsCfg.role === 'killer', duo = botsCfg.gm === 'duo';
  $('bots-teammates-row').classList.toggle('hidden', k || duo);
  $('bots-killer-row').classList.toggle('hidden', k);
  $('bots-survivors-row').classList.toggle('hidden', !k || duo);
  renderLoadout($('bots-loadout'), botsCfg.role, true);
}
const randomPerks = (pool, n = PERK_SLOTS, char) => Object.keys(pool).filter(k => perkFits(k, char)).sort(() => Math.random() - 0.5).slice(0, n);
function botSurvivor(i, used) {
  const free = Object.keys(SURVIVORS).filter(c => !used.includes(c) && !LIMITED(c));
  const char = free.length ? free[Math.floor(Math.random() * free.length)] : Object.keys(SURVIVORS)[i % 4];
  used.push(char);
  const item = Math.random() < 0.5 ? 'trap' : 'flashlight';
  used.names ||= [];
  const pool = BOT_NAMES.filter(n => !used.names.includes(n));
  const nm = pool[Math.floor(Math.random() * pool.length)] || 'Bot ' + i;
  used.names.push(nm);
  const sk = SKINS[char]; const skin = Math.random() < 0.5 ? 'default' : sk[1 + Math.floor(Math.random() * (sk.length - 1))].id;
  return { id: 'bot' + i, name: nm + ' (bot)', role: 'survivor', char, skin, perks: randomPerks(SURV_PERKS, PERK_SLOTS, char), item, pet: Math.random() < 0.2 ? (Math.random() < 0.5 ? 'ted' : 'rosy') : '', bot: true };
}
function botKiller(char, n = 0, avoid = []) {
  const ks = Object.keys(KILLERS).filter(k => !avoid.includes(k));
  const c = char && char !== 'random' && !avoid.includes(char) ? char : ks[Math.floor(Math.random() * ks.length)];
  // a killer you picked keeps their usual look; random bots may wear an outfit, but never a god-tier one
  // (Grandpa is a whole different character)
  const picked = char && char !== 'random' && c === char, outfits = SKINS[c].slice(1).filter(k => !k.god);
  const skin = picked || !outfits.length || Math.random() < 0.5 ? 'default' : outfits[Math.floor(Math.random() * outfits.length)].id;
  return { id: 'botk' + (n || ''), name: KILLERS[c].name, role: 'killer', char: c, skin, perks: randomPerks(KILLER_PERKS), bot: true };
}
// ---------- Testing Area: everything unlocked, nothing earned ----------
const testCfg = { role: 'survivor', char: { survivor: 'mara', killer: 'butcher' }, skin: {}, item: 'flashlight', reach: {}, perks: { survivor: [], killer: [] }, opp: 'random', surv: 4, map: 'random', gm: 'classic', bots: 'normal', diff: 'normal' };
function renderTest() {
  const T = testCfg, role = T.role, defs = role === 'killer' ? KILLERS : SURVIVORS, pool = role === 'killer' ? KILLER_PERKS : SURV_PERKS;
  if (!defs[T.char[role]]) T.char[role] = Object.keys(defs)[0];
  const c = T.char[role], skins = SKINS[c] || [{ id: 'default', name: 'Default' }];
  if (!skins.some(k => k.id === T.skin[c])) T.skin[c] = skins[0].id;
  setSeg('test-role', role); setSeg('test-surv', String(T.surv)); setSeg('test-bots', T.bots); setSeg('test-diff', T.diff);
  $('test-char').innerHTML = Object.values(defs).map(d => `<option value="${d.id}" ${d.id === c ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  $('test-skin').innerHTML = skins.map(k => `<option value="${k.id}" ${k.id === T.skin[c] ? 'selected' : ''}>${esc(k.name)}</option>`).join('');
  $('test-item-row').classList.toggle('hidden', role !== 'survivor'); $('test-item').value = T.item;
  $('test-opp-row').classList.toggle('hidden', role !== 'survivor'); $('test-surv-row').classList.toggle('hidden', role !== 'killer');
  $('test-opp').innerHTML = '<option value="random">Random</option>' + Object.values(KILLERS).map(d => `<option value="${d.id}" ${d.id === T.opp ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  $('test-map').innerHTML = ['random', ...Object.keys(MAP_NAMES)].map(m => `<option value="${m}" ${m === T.map ? 'selected' : ''}>${m === 'random' ? 'Random' : esc(MAP_NAMES[m])}</option>`).join('');
  $('test-gm').innerHTML = Object.entries(MODES).map(([id, m]) => `<option value="${id}" ${id === T.gm ? 'selected' : ''}>${m.name} (${m.short})</option>`).join('');
  const L = role === 'killer' && POWER_LV[c];
  $('test-reach-row').classList.toggle('hidden', !L);
  if (L) { const r = $('test-reach'); r.min = L.base; r.max = L.max; r.step = L.step; r.value = T.reach[c] ?? L.max; $('test-reach-l').textContent = `${L.power} reach: ${r.value}m`; }
  T.perks[role] = T.perks[role].filter(k => pool[k] && perkFits(k, c));
  $('test-perk-n').textContent = `${T.perks[role].length} / ${PERK_SLOTS}`;
  $('test-perks').innerHTML = Object.entries(pool).filter(([k]) => perkFits(k, c)).map(([k, P]) => `<button class="tp ${T.perks[role].includes(k) ? 'on' : ''}" data-tp="${k}" title="${esc(P.desc)}"><span class="diamond ${role === 'killer' ? 'k' : ''} ${P.only ? 'ex' : ''}">${icon(k)}</span><b>${esc(P.name)}</b></button>`).join('');
  $('test-perks').querySelectorAll('[data-tp]').forEach(b => b.onclick = () => { const l = T.perks[role], k = b.dataset.tp, i = l.indexOf(k); if (i >= 0) l.splice(i, 1); else { if (l.length >= PERK_SLOTS) l.shift(); l.push(k); } sound.play('click'); renderTest(); });
  if (menu) { if (role === 'killer') menu.setKiller(c, T.skin[c]); else menu.setSurvivor(c, T.skin[c]); }
}
seg('test-role', v => { testCfg.role = v; renderTest(); });
seg('test-surv', v => { testCfg.surv = +v; });
seg('test-bots', v => { testCfg.bots = v; });
seg('test-diff', v => { testCfg.diff = v; });
$('test-char').onchange = e => { testCfg.char[testCfg.role] = e.target.value; renderTest(); };
$('test-skin').onchange = e => { testCfg.skin[testCfg.char[testCfg.role]] = e.target.value; renderTest(); };
$('test-item').onchange = e => { testCfg.item = e.target.value; };
$('test-opp').onchange = e => { testCfg.opp = e.target.value; };
$('test-map').onchange = e => { testCfg.map = e.target.value; };
$('test-gm').onchange = e => { testCfg.gm = e.target.value; };
$('test-reach').oninput = e => { const c = testCfg.char.killer; testCfg.reach[c] = +e.target.value; $('test-reach-l').textContent = `${POWER_LV[c].power} reach: ${e.target.value}m`; };
$('btn-test-start').addEventListener('click', () => {
  sound.init(); sound.play('click');
  const T = testCfg, role = T.role, c = T.char[role], gm = MODES[T.gm] ? T.gm : 'classic', nk = MODES[gm].killers || 1, ns = MODES[gm].survivors;
  const me = { id: 'me', name: settings.name, role, char: c, skin: T.skin[c] || 'default', perks: T.perks[role].slice(), item: T.item === 'taser' ? 'flashlight' : T.item, pet: '', bot: false };
  if (role === 'killer' && POWER_LV[c]) me.lv = T.reach[c] ?? POWER_LV[c].max;
  const roster = [me], used = role === 'survivor' ? [c] : [];
  if (role === 'survivor') {
    for (let i = 0; i < (ns ? ns - 1 : 3); i++) roster.push(botSurvivor(i + 1, used));
    for (let i = 0; i < nk; i++) roster.push(botKiller(i ? 'random' : T.opp, i, roster.filter(r => r.role === 'killer').map(r => r.char)));
  } else {
    for (let i = 1; i < nk; i++) roster.push(botKiller('random', i, [c]));
    for (let i = 0; i < (ns || T.surv); i++) roster.push(botSurvivor(i + 1, used));
  }
  startHostMatch(roster, { myId: 'me', difficulty: T.diff, net: null, kind: 'bots', map: T.map, mode: gm, sandbox: true, passive: T.bots === 'passive', taser: role === 'survivor' && T.item === 'taser' });
});

$('btn-bots-start').addEventListener('click', () => {
  sound.init(); sound.play('click');
  const roster = [];
  const meRole = botsCfg.role;
  if (meRole === 'survivor' && !ownsChar(profile.survivor.char)) { toast(`${charName(profile.survivor.char)} is locked. Unlock them in the Store, or pick another survivor.`, 5000); profile.survivor.char = 'mara'; saveProfile(); return; }
  if (meRole === 'killer' && !ownsChar(profile.killer.char)) { toast(`${charName(profile.killer.char)} is part of a chapter. Get it in the Store, or pick another killer.`, 5000); openStore('chapters'); return; }
  roster.push({ id: 'me', name: settings.name, role: meRole, char: profile[meRole].char, skin: skinId(profile[meRole].char), perks: profile[meRole].perks, item: profile.survivor.item || 'flashlight', pet: petOf(meRole), pu: activePU(), bot: false, ...(meRole === 'killer' ? killerExtras(profile.killer.char) : {}) });
  const used = meRole === 'survivor' ? [profile.survivor.char] : [];
  const gm = MODES[botsCfg.gm] ? botsCfg.gm : 'classic', nk = MODES[gm].killers || 1, ns = MODES[gm].survivors;
  if (meRole === 'survivor') {
    for (let i = 0; i < (ns ? ns - 1 : botsCfg.team); i++) roster.push(botSurvivor(i + 1, used));
    for (let i = 0; i < nk; i++) roster.push(botKiller(i ? 'random' : botsCfg.killer, i, roster.filter(r => r.role === 'killer').map(r => r.char)));
  } else {
    for (let i = 1; i < nk; i++) roster.push(botKiller('random', i, [profile.killer.char]));
    for (let i = 0; i < (ns || botsCfg.surv); i++) roster.push(botSurvivor(i + 1, used));
  }
  const go = map => startHostMatch(roster, { myId: 'me', difficulty: botsCfg.diff, net: null, kind: 'bots', map, mode: gm });
  botsCfg.map = $('bots-map').value || botsCfg.map; // what the dropdown shows is what you get
  if (botsCfg.map === 'vote') botVote(gm, roster.filter(r => r.bot).length, go); else go(botsCfg.map);
});
// ---------- map select screen (Rivals style): pictures, live tallies, a countdown ----------
const MAP_IMG = id => (document.querySelector('script[type=importmap]') ? '' : 'public/') + 'img/maps/' + id + '.jpg';
const mapName = c => c === 'random' ? 'Random' : MAP_NAMES[c] || c;
function voteCands(gm) {
  const pool = MODES[gm] && MODES[gm].bigMap ? Object.keys(BIG_MAPS) : REGULAR_MAPS.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return [...pool.slice(0, 3), 'random'];
}
function voteWinnerOf(cands, votes) {
  const v = Object.values(votes || {}); if (!v.length) return cands[Math.floor(Math.random() * cands.length)];
  const n = c => v.filter(x => x === c).length, top = Math.max(...cands.map(n)), tied = cands.filter(c => n(c) === top);
  return tied[Math.floor(Math.random() * tied.length)];
}
const MS = { st: null, timer: null };
// st: { cands, votes {voter: map}, mine, ends (ms), voters, winner, onVote }
function mapSelect(st) {
  MS.st = st;
  const A = $('announce'), v = Object.values(st.votes || {}), n = c => v.filter(x => x === c).length;
  A.innerHTML = `<div class="an-bg"></div><div class="an-inner ms"><div class="an-kicker">Map vote</div>
    <div class="ms-title">${st.winner ? `Next map: <b>${esc(mapName(st.winner))}</b>` : st.mine ? 'Waiting for the others…' : 'Vote for the next map'}</div>
    <div class="ms-timer"><i></i><span></span></div>
    <div class="ms-grid">${st.cands.map(c => `<button class="ms-card ${st.mine === c ? 'on' : ''} ${st.winner === c ? 'win' : ''} ${st.winner && st.winner !== c ? 'lose' : ''}" data-ms="${c}" ${st.winner ? 'disabled' : ''}>
      <div class="ms-img ${c === 'random' ? 'rnd' : ''}" ${c !== 'random' ? `style="background-image:url('${MAP_IMG(c)}')"` : ''}>${c === 'random' ? '<span>?</span>' : ''}<em>${n(c)}</em></div>
      <b>${esc(mapName(c))}</b><div class="ms-dots">${Array.from({ length: n(c) }, () => '<i></i>').join('')}</div></button>`).join('')}</div>
    <p class="hint">${v.length} / ${st.voters} voted · most votes wins, ties are settled at random</p></div>`;
  A.querySelectorAll('[data-ms]').forEach(b => b.onclick = () => { if (st.winner || st.mine === b.dataset.ms) return; sound.play('click'); st.onVote(b.dataset.ms); });
  A.classList.remove('hidden');
  const tick = () => {
    if (MS.st !== st) return;
    const left = Math.max(0, st.ends - Date.now()), bar = A.querySelector('.ms-timer i'), lab = A.querySelector('.ms-timer span');
    if (bar) bar.style.width = (st.winner ? 0 : left / st.total * 100) + '%'; if (lab) lab.textContent = st.winner ? '' : Math.ceil(left / 1000) + 's';
  };
  clearInterval(MS.timer); MS.timer = setInterval(tick, 100); tick();
}
function closeMapSelect() { clearInterval(MS.timer); MS.st = null; $('announce').classList.add('hidden'); }

// bot matches: you and the bots vote; the bots trickle their votes in during the countdown
function botVote(gm, nBots, done) {
  const total = 10000, st = { cands: voteCands(gm), votes: {}, mine: null, ends: Date.now() + total, total, voters: nBots + 1, winner: null };
  const finish = () => {
    if (st.winner) return; st.winner = voteWinnerOf(st.cands, st.votes); mapSelect(st); sound.play('powered');
    setTimeout(() => { closeMapSelect(); done(st.winner); }, 2200);
  };
  st.onVote = c => { st.mine = c; st.votes.me = c; mapSelect(st); if (Object.keys(st.votes).length >= st.voters) setTimeout(finish, 900); };
  for (let i = 0; i < nBots; i++) setTimeout(() => { if (st.winner) return; st.votes['bot' + i] = st.cands[Math.floor(Math.random() * st.cands.length)]; if (MS.st === st) mapSelect(st); if (st.mine && Object.keys(st.votes).length >= st.voters) setTimeout(finish, 900); }, 1200 + Math.random() * 5500);
  setTimeout(finish, total);
  closePanel(); mapSelect(st);
}

// ---------- sessions ----------
let session = null;

// map ids: 'woods' (Gravemoor Woods), 'meatworks' (Hollow Pines Meatworks), 'random'
const MAPS = MAP_NAMES;
// Infection is played on its own big maps; the other modes on the regular ones (unless picked by name)
function resolveMap(m, mode) {
  const pick = ids => ids[Math.floor(Math.random() * ids.length)];
  if (MODES[mode] && MODES[mode].bigMap) return BIG_MAPS[m] ? m : pick(Object.keys(BIG_MAPS));
  return MAPS[m] ? m : pick(REGULAR_MAPS);
}

class HostSession {
  constructor(roster, opts) {
    this.roster = roster; this.opts = opts; this.net = opts.net; this.myId = opts.myId; this.isHost = true;
    this.snapT = 0; this.kfT = 0; this.pending = []; this.snapDue = false;
    this.writer = new SnapWriter();
    this.tracks = new Map(); // player id -> Track (smoothed view of remote players on the host's screen)
    this.lastSim = performance.now();
  }
  start() {
    this.seed = Math.floor(Math.random() * 1e9);
    this.map = resolveMap(this.opts.map, this.opts.mode);
    this.M = buildMap(this.seed, this.map);
    this.sim = new Sim(this.M, this.roster, { difficulty: this.opts.difficulty, mode: this.opts.mode });
    if (this.opts.passive) for (const q of this.sim.S.players) if (q.bot && q.role === 'killer') q.harmless = true;
    if (this.opts.taser) { const q = this.sim.S.players.find(x => x.id === this.myId); if (q) { q.item = 'taser'; q.tasers = 3; q.flash = 0; q.traps = 0; } }
    this.bots = new Bots(this.sim);
    if (this.net) this.net.broadcast({ t: 'start', seed: this.seed, map: this.map, roster: this.roster, difficulty: this.opts.difficulty, mode: this.opts.mode });
    this.game = new Game({ renderer, M: this.M, myId: this.myId, isHost: true, session: this, settings, onEnd: (S, me) => onMatchEnd(S, me, this) });
    this.game.start();
  }
  state() { return this.sim.S; }
  send(m) {
    // lag compensation for the host too: remote players are drawn slightly in the past
    if (m.t === 'act' && this.tracks.size) { let d = 0; for (const t of this.tracks.values()) d = Math.max(d, t.delay()); m.rt = this.sim.S.t - d - 0.02; }
    this.sim.onMsg(this.myId, m);
  }
  // connection id -> the player it controls (changes when a fallen survivor takes over a bot)
  pidOf(peer) { return (this.ctrl && this.ctrl.get(peer)) || peer; }
  remote(id, m) {
    if (!m || (m.t !== 'pos' && m.t !== 'in' && m.t !== 'act')) return;
    const pid = this.pidOf(id);
    if (m.t !== 'pos') {
      // clients stamp actions with the host wall-clock moment they were looking at: convert to sim time
      if (m.t === 'act' && typeof m.rt === 'number') m.rt = this.sim.S.t - (performance.now() / 1000 - m.rt);
      this.sim.onMsg(pid, m);
      return;
    }
    let tr = this.tracks.get(pid);
    if (!tr) this.tracks.set(pid, tr = new Track());
    if (!tr.fresh(m.ct)) return; // an older position that arrived late (unordered channel)
    this.sim.onMsg(pid, m);
    const p = this.sim.P(pid);
    if (p) tr.push(m.ct, p.x, p.z, p.yaw, p.tp);
  }
  // where to draw a remote human on the host's screen (null: use the simulation position)
  viewPos(p) {
    if (p.bot || p.id === this.myId || p.reel || p.pull || (p.role === 'survivor' && p.st !== 'ok' && p.st !== 'down')) return null;
    const tr = this.tracks.get(p.id);
    return tr ? tr.sample(p.tp) : null;
  }
  // advance the simulation to "now"; called every frame and from a background timer
  pump(minGap = 0) {
    const now = performance.now(), el = (now - this.lastSim) / 1000;
    if (el <= minGap) return;
    this.lastSim = now;
    this.simTick(Math.min(0.25, el));
  }
  simTick(dt) {
    // fixed-size sub-steps keep the simulation real-time even at low frame rates
    const n = Math.max(1, Math.ceil(dt / 0.034)), h = dt / n;
    for (let i = 0; i < n; i++) this.step(h);
    // at most one snapshot per tick: after a slow frame, send the newest state, not a burst of old ones
    if (this.net && this.snapDue) {
      this.snapDue = false;
      // a full keyframe every second, while the match isn't in play, and whenever someone joins or
      // leaves the field mid-match (a ghost appears or vanishes)
      const n = this.sim.S.players.length;
      const kf = this.kfT <= 0 || this.sim.S.phase !== 'play' || n !== this.lastN;
      this.lastN = n;
      if (kf) this.kfT = 1;
      // events must not be lost: they go on the reliable channel; the snapshot may be dropped
      if (this.pending.length) { this.net.broadcast({ t: 'ev', e: this.pending }); this.pending = []; }
      this.net.broadcast({ t: 's', s: this.writer.pack(this.sim.S, kf) }, true);
    }
  }
  step(dt) {
    this.bots.update(dt);
    this.sim.update(dt);
    const ev = this.sim.takeEvents();
    if (ev.length) {
      // a player moves to another body: taking over a bot, or Chucky's Possession (silent 'swap')
      for (const e of ev) if (e.k === 'takeover' || e.k === 'swap') {
        this.ctrl ||= new Map();
        let peer = e.from;
        for (const [k, v] of this.ctrl) if (v === e.from) peer = k;
        this.ctrl.set(peer, e.to);
        this.tracks.delete(e.from); this.tracks.delete(e.to);
      }
      this.bots.onEvents(ev); this.game.onEvents(ev);
    }
    if (this.net) {
      if (ev.length) this.pending.push(...ev);
      this.snapT -= dt;
      this.kfT -= dt;
      if (this.snapT <= 0) {
        // keep the cadence steady; a full keyframe (ids, names, perks, scores) goes out every second
        this.snapT = Math.max(0, this.snapT + 1 / SNAP_RATE);
        this.snapDue = true;
      }
    }
  }
  tick(dt) { this.pump(); this.game.frame(dt); }
  playerLeft(id) {
    id = this.pidOf(id);
    const p = this.sim.P(id);
    if (!p) return;
    p.bot = true;
    this.tracks.delete(id);
    this.sim.inputs.get(id).e = false;
    this.sim.ev({ k: 'msg', text: p.name + ' disconnected, a bot took over.' });
  }
  dispose() { this.game && this.game.dispose(); }
}

class ClientSession {
  constructor(net, start, myId) { this.net = net; this.myId = myId; this.isHost = false; this.M = buildMap(start.seed, MAP_NAMES[start.map] ? start.map : 'woods'); this.S = null; this.game = null; this.queued = []; this.reader = new SnapReader(); }
  onMsg(m) {
    if (m.t === 's') { const s = this.reader.read(m.s); if (s) this.S = s; }
    // events arrive separately (reliably); they still count before the first keyframe
    const e = m.e;
    if (e && e.length) { if (this.game) this.game.onEvents(e); else this.queued.push(...e); }
  }
  state() { if (this.S) this.reader.interpolate(this.S, this.myId); return this.S; }
  send(m) {
    if (m.t === 'act') {
      if (this.reader.rt != null) m.rt = +this.reader.rt.toFixed(3);
      m.aid = this.aid = (this.aid || 0) + 1;
      // the public relay can drop a message now and then: send key presses twice more (the host
      // acts on each one once)
      if (String(this.net.label || '').includes('relay')) for (const ms of [120, 300]) setTimeout(() => { try { this.net.send(m, false); } catch (_) {} }, ms);
    }
    this.net.send(m, m.t === 'pos');
  }
  tick(dt) {
    if (!this.S) return;
    if (!this.game) {
      if (!this.S.players.some(p => p.id === this.myId)) return;
      this.game = new Game({ renderer, M: this.M, myId: this.myId, isHost: false, session: this, settings, onEnd: (S, me) => onMatchEnd(S, me, this) });
      this.game.start();
      loading(false);
      this.queued = [];
    }
    this.game.frame(dt);
  }
  dispose() { this.game && this.game.dispose(); }
}

async function startHostMatch(roster, opts) {
  loading(true, 'Entering the fog…');
  await nextFrame();
  // Chucky can appear in any match (picked, random bot killer, or an Infection turn)
  await waitForModels({ spider: roster.some(r => r.char === 'spiderman'), granny: roster.some(r => r.char === 'granny') || opts.mode === 'infection', chucky: roster.some(r => r.char === 'chucky') || opts.mode === 'infection' });
  loading(true, 'Entering the fog…');
  stopBG();
  $('menu').classList.add('hidden');
  $('panel').classList.add('hidden'); $('menu').classList.remove('panel-open');
  session = new HostSession(roster, opts);
  session.kind = opts.kind;
  try { session.start(); } catch (e) { console.error(e); toast('Failed to start: ' + e.message); endSession(); show('p-main'); }
  loading(false);
}

function endSession() {
  if (session) { session.dispose(); session = null; }
  $('results').classList.add('hidden');
  startBG();
}

function onMatchEnd(S, me, sess) {
  if (sess.opts && sess.opts.sandbox) {
    $('results-list').insertAdjacentHTML('beforeend', '<div class="prog-sum"><div class="ps-xp"><b>Testing Area</b><span>No XP, Embers or rank in test matches</span></div></div>');
    me = null; // nothing below is recorded
  }
  if (me && me.score) {
    // progression: XP, level, rank pips, season pass
    const r = applyMatch(profile, S, me);
    const pipTxt = r.pips > 0 ? `+${r.pips} pip${r.pips > 1 ? 's' : ''}` : r.pips < 0 ? `${r.pips} pip` : 'no change';
    $('results-list').insertAdjacentHTML('beforeend', `<div class="prog-sum"><div class="ps-xp"><b>+${r.xp} XP</b><span>Level ${r.level}${r.levelUp ? ' <i>Level up!</i>' : ''}</span></div><div class="ps-rank">${rankBadge(r.rank, 40)}<div><b>${r.rank.name}</b><span>${r.role === 'killer' ? 'Killer' : 'Survivor'} rank · ${pipTxt}${r.rankChanged ? ' · new grade!' : ''}</span></div></div><div class="ps-pass">Season tier ${seasonTier(profile.prog.season.xp)} / ${SEASON.tiers.length}</div></div>`);
  }
  if (me) {
    profile.stats.matches++;
    (profile.played ||= {})[me.char] = (profile.played[me.char] || 0) + 1;
    awards.record(me, S);
    const tot = me.score.a + me.score.b + me.score.c + me.score.d;
    profile.stats.embers += tot;
    if (me.role === 'survivor' && me.outcome === 'escaped') profile.stats.escapes++;
    if (me.role === 'killer') profile.stats.kills += S.players.filter(p => p.role === 'survivor' && p.outcome !== 'escaped').length;
    saveProfile();
  }
  const A = $('results-actions');
  A.innerHTML = '';
  const btn = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; b.className = 'btn ' + (cls === 'primary' ? 'primary big' : ''); b.onclick = () => { sound.play('click'); fn(); }; A.appendChild(b); };
  if (sess.kind === 'bots') {
    btn('Main Menu', 'back', () => { endSession(); show('p-main'); });
    btn('Play Again', 'primary', () => { endSession(); $(sess.opts && sess.opts.sandbox ? 'btn-test-start' : 'btn-bots-start').click(); });
  } else if (sess.isHost) {
    btn('Close Room', 'back', () => { leaveOnline(); });
    btn('Back to Lobby', 'primary', () => returnToLobby());
  } else {
    btn('Leave', 'back', () => { leaveOnline(); });
    const w = document.createElement('span'); w.className = 'hint'; w.textContent = 'Waiting for the host to return to the lobby…'; A.appendChild(w);
  }
}

$('btn-resume').addEventListener('click', () => { if (session && session.game) session.game.pause(false); });
$('btn-quit').addEventListener('click', () => {
  if (!session) return;
  if (session.kind === 'bots') { endSession(); show('p-main'); }
  else if (session.isHost) returnToLobby();
  else leaveOnline();
});
const _pauseObs = new MutationObserver(() => { if (!$('pause').classList.contains('hidden')) { $('pause-sens').value = settings.sens; $('pause-vol').value = settings.vol; } });
_pauseObs.observe($('pause'), { attributes: true });

// ---------- online ----------
let lobby = null;
async function resolveMode() {
  if (settings.net === 'relay') return 'relay';
  if (settings.net === 'p2p') return 'online';
  return (await relayAvailable()) ? 'relay' : 'online';
}
async function detectModeHint() {
  $('join-mode').textContent = 'Checking connection…';
  const m = await resolveMode();
  $('join-mode').textContent = m === 'relay' ? 'Connecting through this game server.' : 'Online: direct WebRTC connection, with an automatic relay fallback.';
}
const modeText = (m, label) => m === 'relay' ? 'Connected through the game server. Friends join at this same address with the code.' : `Online room (${label || 'direct + relay'}). Friends anywhere can join with this code from their copy of the game or the shared link.`;

$('btn-host').addEventListener('click', async () => {
  sound.init(); sound.play('click');
  loading(true, 'Opening a room…');
  try {
    const mode = await resolveMode();
    const net = await hostRoom(mode);
    lobby = { isHost: true, net, code: net.code, mode, myId: 'host', players: [], fill: true, diff: 'normal', gm: 'classic', inGame: false, chat: [] }; lobby.map = 'vote'; newVote();
    const lo = profile.survivor;
    lobby.players.push({ id: 'host', name: settings.name, role: 'survivor', char: lo.char, skin: skinId(lo.char), perks: lo.perks.slice(), pet: petOf('survivor'), host: true, loadouts: myLoadouts() });
    net.on('msg', (id, m) => hostMsg(id, m));
    net.on('leave', id => {
      const p = lobby && lobby.players.find(x => x.id === id);
      if (!p) return;
      lobby.players = lobby.players.filter(x => x.id !== id);
      if (session && session.isHost && lobby.inGame) session.playerLeft(id);
      addChat(null, p.name + ' left.');
      broadcastLobby();
    });
    net.on('closed', r => { toast(r); leaveOnline(true); });
    showLobby();
  } catch (e) { console.error(e); toast(e.message || String(e)); }
  loading(false);
});

function sanitizeLoadout(role, char, perks) {
  const defs = role === 'killer' ? KILLERS : SURVIVORS, pool = role === 'killer' ? KILLER_PERKS : SURV_PERKS;
  const c = defs[char] ? char : Object.keys(defs)[0];
  return { char: c, perks: (Array.isArray(perks) ? perks : []).filter(k => pool[k] && perkFits(k, c)).slice(0, PERK_SLOTS) };
}
function cleanSkin(char, skin) { return (SKINS[char] || []).some(s => s.id === skin) ? skin : 'default';
}
function hostMsg(id, m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'ping') { lobby.net.send(id, { t: 'pong', c: m.c }, true); return; }
  if (m.t === 'vote' && lobby.voting) { if (lobby.players.some(x => x.id === id)) lobby.voting.cast(id, String(m.map)); return; }
  if (lobby.inGame && session && session.isHost) {
    if (m.t === 'hello') lobby.net.send(id, { t: 'reject', reason: 'A match is in progress. Try again when it ends.' });
    else session.remote(id, m);
    return;
  }
  if (m.t === 'hello') {
    if (m.proto !== NET_PROTOCOL) {
      const newer = typeof m.proto === 'number' && m.proto > NET_PROTOCOL;
      lobby.net.send(id, { t: 'reject', reason: newer
        ? `The host is on an older version of Nightbound (${VERSION}). Ask them to refresh the page or update.`
        : `This room runs Nightbound ${VERSION}. Refresh the page (or download the latest copy) and join again.` });
      return;
    }
    const cap = lobbyCaps();
    if (lobby.players.length >= cap.k + cap.s) { lobby.net.send(id, { t: 'reject', reason: 'The lobby is full.' }); return; }
    const killerTaken = lobby.players.filter(p => p.role === 'killer').length >= cap.k;
    const survCount = lobby.players.filter(p => p.role === 'survivor').length;
    let role = m.role === 'killer' && !killerTaken ? 'killer' : 'survivor';
    if (role === 'survivor' && survCount >= cap.s) role = 'killer';
    const lo = sanitizeLoadout(role, m.loadouts?.[role]?.char, m.loadouts?.[role]?.perks);
    lobby.players.push({ id, name: String(m.name || 'Player').slice(0, 16), role, ...lo, skin: cleanSkin(lo.char, m.loadouts?.[role]?.skin), pet: SIDEKICKS[m.loadouts?.[role]?.pet] ? m.loadouts[role].pet : '', loadouts: m.loadouts || {} });
    lobby.net.send(id, { t: 'welcome', id });
    addChat(null, String(m.name || 'Player').slice(0, 16) + ' joined.');
    broadcastLobby();
  } else if (m.t === 'vote') {
    if (lobby.voting && lobby.players.some(x => x.id === id)) lobby.voting.cast(id, String(m.map));
  } else if (m.t === 'loadout') {
    const p = lobby.players.find(x => x.id === id);
    if (!p) return;
    applyLoadout(p, m);
    broadcastLobby();
  } else if (m.t === 'chat') {
    const p = lobby.players.find(x => x.id === id);
    if (p) { const text = String(m.text || '').slice(0, 120); lobby.net.broadcast({ t: 'chat', name: p.name, text }); addChat(p.name, text); }
  }
}
// player slots for the lobby's game mode
// map voting: three maps that suit the mode, plus Random; most votes wins (ties: a random one of the tied)
function newVote() {
  if (!lobby) return;
  const pool = MODES[lobby.gm] && MODES[lobby.gm].bigMap ? Object.keys(BIG_MAPS) : REGULAR_MAPS.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  lobby.cands = [...pool.slice(0, 3), 'random']; lobby.votes = {};
}
function showVote(m) {
  if (!lobby) return;
  if (lobby.isHost) { const V = lobby.voting; if (!V) return; mapSelect({ cands: V.cands, votes: V.votes, mine: V.votes.host || null, ends: V.ends, total: V.total, voters: V.voters, winner: V.winner, onVote: c => V.cast('host', c) }); return; }
  mapSelect({ cands: m.cands, votes: m.votes || {}, mine: (m.votes || {})[lobby.myId] || null, ends: Date.now() + (m.left || 0), total: m.total || 10000, voters: m.voters || 1, winner: m.winner || null,
    onVote: c => { lobby.net.send({ t: 'vote', map: c }); const st = MS.st; if (st) { st.mine = c; st.votes = { ...st.votes, [lobby.myId]: c }; mapSelect(st); } } });
}
function voteWinner() {
  const votes = Object.values(lobby.votes || {}), cands = lobby.cands || ['random'];
  if (!votes.length) return 'random';
  const n = c => votes.filter(v => v === c).length, top = Math.max(...cands.map(n));
  const tied = cands.filter(c => n(c) === top);
  return tied[Math.floor(Math.random() * tied.length)];
}
function lobbyCaps() { const m = MODES[lobby && lobby.gm] || MODES.classic; return { k: m.killers || 1, s: m.survivors || 4 }; }
function applyLoadout(p, m) {
  let role = m.role === 'killer' ? 'killer' : 'survivor';
  const cap = lobbyCaps();
  if (role === 'killer' && p.role !== 'killer' && lobby.players.filter(x => x !== p && x.role === 'killer').length >= cap.k) role = p.role;
  if (role === 'survivor' && p.role !== 'survivor' && lobby.players.filter(x => x.role === 'survivor').length >= cap.s) role = p.role;
  if (m.loadouts) p.loadouts = m.loadouts;
  const lo = sanitizeLoadout(role, m.char ?? p.loadouts?.[role]?.char, m.perks ?? p.loadouts?.[role]?.perks);
  p.item = (m.item ?? p.loadouts?.survivor?.item) === 'trap' ? 'trap' : 'flashlight';
  p.role = role; p.char = lo.char; p.perks = lo.perks; p.skin = cleanSkin(lo.char, m.skin ?? p.loadouts?.[role]?.skin);
  p.pet = SIDEKICKS[p.loadouts?.[role]?.pet] ? p.loadouts[role].pet : '';
}
function broadcastLobby() {
  if (!lobby || !lobby.isHost) return;
  lobby.net.broadcast({ t: 'lobby', players: lobby.players.map(({ loadouts, ...p }) => p), fill: lobby.fill, diff: lobby.diff, map: lobby.map || 'vote', gm: lobby.gm || 'classic', code: lobby.code, cands: lobby.cands || [], votes: lobby.votes || {} });
  renderLobby();
}

$('btn-join').addEventListener('click', () => doJoin($('join-code').value));
$('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin($('join-code').value); });
async function doJoin(code) {
  sound.init(); sound.play('click');
  code = String(code || '').toUpperCase().trim();
  if (code.length < 4) { toast('Enter the room code.'); return; }
  loading(true, 'Joining room ' + code + '…');
  try {
    const mode = await resolveMode();
    const net = await joinRoom(mode, code);
    lobby = { isHost: false, net, code, mode, myId: net.id, players: [], fill: true, diff: 'normal', gm: 'classic', inGame: false, chat: [] };
    net.on('msg', m => clientMsg(m));
    net.on('closed', r => { toast(r); leaveOnline(true); });
    const role = 'survivor';
    net.send({ t: 'hello', name: settings.name, role, loadouts: myLoadouts(), proto: NET_PROTOCOL, ver: VERSION });
    showLobby();
  } catch (e) { console.error(e); toast(e.message || String(e)); }
  loading(false);
}
function clientMsg(m) {
  if (!m || typeof m !== 'object' || !lobby) return;
  switch (m.t) {
    case 'welcome': lobby.myId = m.id; break;
    case 'lobby': lobby.players = m.players; lobby.fill = m.fill; lobby.diff = m.diff; lobby.map = m.map; lobby.gm = MODES[m.gm] ? m.gm : 'classic'; lobby.cands = Array.isArray(m.cands) ? m.cands : []; lobby.votes = m.votes || {}; renderLobby(); break;
    case 'reject': toast(m.reason); leaveOnline(true); break;
    case 'chat': addChat(m.name, m.text); break;
    case 'mapvote': showVote(m); break;
    case 'start': closeMapSelect(); startClientMatch(m); break;
    case 's': case 'ev': if (session && !session.isHost) session.onMsg(m); break;
    case 'pong': if (typeof m.c === 'number') { const rtt = performance.now() - m.c; netStat.ping = netStat.ping == null ? rtt : netStat.ping + (rtt - netStat.ping) * 0.3; } break;
    case 'tolobby': if (session) { endSession(); stopBG(); } lobby.inGame = false; showLobby(); break;
  }
}
// connection quality for players who joined: round-trip time to the host and how we're connected
const netStat = { ping: null };
setInterval(() => {
  const el = $('netstat');
  if (!lobby || !lobby.net || lobby.isHost) { if (el) el.classList.add('hidden'); netStat.ping = null; return; }
  try { lobby.net.send({ t: 'ping', c: performance.now() }, true); } catch {}
  if (!el) return;
  const relay = (lobby.net.label || '').includes('relay') || lobby.net.mode === 'relay';
  const ms = netStat.ping == null ? '…' : Math.round(netStat.ping) + ' ms';
  el.className = 'netstat' + (netStat.ping > 180 || (relay && lobby.net.mode !== 'relay') ? ' bad' : netStat.ping > 100 ? ' warn' : '');
  el.textContent = `${lobby.net.mode === 'relay' ? 'Game server' : relay ? 'Relay (slower)' : 'Direct'} · ${ms}`;
  el.title = relay && lobby.net.mode !== 'relay' ? "A direct connection to the host couldn't be made, so the game is going through a public relay, which adds delay. A different network, or the host running node server.js, usually fixes this." : '';
}, 2000);

async function startClientMatch(m) {
  loading(true, 'Entering the fog…');
  await nextFrame();
  await waitForModels({ spider: (m.roster || []).some(r => r.char === 'spiderman'), granny: (m.roster || []).some(r => r.char === 'granny') || m.mode === 'infection', chucky: (m.roster || []).some(r => r.char === 'chucky') || m.mode === 'infection' });
  loading(true, 'Entering the fog…');
  stopBG();
  $('menu').classList.add('hidden');
  lobby.inGame = true;
  session = new ClientSession(lobby.net, m, lobby.myId);
  session.kind = 'online';
}

function showLobby() {
  show('p-lobby');
  $('lobby-code').textContent = lobby.code;
  $('lobby-mode').textContent = modeText(lobby.mode, lobby.net.label);
  $('lobby-host-opts').classList.toggle('hidden', !lobby.isHost);
  $('btn-lobby-start').classList.toggle('hidden', !lobby.isHost);
  $('lobby-wait').classList.toggle('hidden', lobby.isHost);
  $('lobby-fill').checked = lobby.fill;
  setSeg('lobby-diff', lobby.diff);
  $('lobby-map').value = lobby.map || 'vote'; $('lobby-map').disabled = !lobby.isHost;
  renderLobby();
}
function myLobbyPlayer() { return lobby && lobby.players.find(p => p.id === lobby.myId); }
function renderLobby() {
  if (!lobby || $('p-lobby').classList.contains('hidden')) return;
  const ps = lobby.players, cap = lobbyCaps();
  const killers = ps.filter(p => p.role === 'killer');
  const survs = ps.filter(p => p.role === 'survivor');
  $('lobby-gm').value = lobby.gm || 'classic'; $('lobby-gm').disabled = !lobby.isHost;
  $('lobby-gm-desc').innerHTML = `<b>${esc(MODES[lobby.gm || 'classic'].name)}:</b> ${esc(gmDesc(lobby.gm))}`;
  const charName = p => (p.role === 'killer' ? KILLERS[p.char] : SURVIVORS[p.char])?.name || '';
  const slot = (p, role) => p
    ? `<div class="slot ${role}"><span class="si">${icon(role === 'killer' ? POWER_ICON[p.char] : 'healthy')}</span><span class="nm">${esc(p.name)}${p.host ? ' · Host' : ''}${p.id === lobby.myId ? ' (you)' : ''}</span><span class="ch">${esc(charName(p))}</span></div>`
    : `<div class="slot ${role} empty"><span class="si">${icon(role === 'killer' ? 'warrant' : 'healthy')}</span><span class="nm">${lobby.fill ? (role === 'killer' ? 'Bot killer' : 'Bot survivor') : 'Empty slot'}</span></div>`;
  let html = '';
  for (let i = 0; i < cap.k; i++) html += slot(killers[i], 'killer');
  for (let i = 0; i < cap.s; i++) html += slot(survs[i], 'survivor');
  $('lobby-slots').innerHTML = html;
  // the map vote happens on its own screen when the host starts the match
  $('map-vote').classList.toggle('hidden', lobby.map !== 'vote');
  $('map-vote').innerHTML = '<p class="hint">Map: everyone votes on a map screen right before the match starts.</p>';
  const me = myLobbyPlayer();
  if (me) {
    setSeg('lobby-role', me.role);
    renderLoadout($('lobby-loadout'), me.role, true, sendMyLoadout);
  }
}
const playableSurvivor = () => ownsChar(profile.survivor.char) ? profile.survivor.char : 'mara';
const playableKiller = () => ownsChar(profile.killer.char) ? profile.killer.char : 'butcher';
function myLoadouts() { return { survivor: { ...profile.survivor, char: playableSurvivor(), skin: skinId(playableSurvivor()), pet: petOf('survivor'), pu: activePU() }, killer: { ...profile.killer, char: playableKiller(), skin: skinId(playableKiller()), pet: petOf('killer'), ...killerExtras(playableKiller()) } }; }
function sendMyLoadout(role) {
  const me = myLobbyPlayer();
  if (!me) return;
  role = role || me.role;
  const lo = profile[role], ch = role === 'killer' ? playableKiller() : lo.char;
  const m = { t: 'loadout', role, char: ch, skin: skinId(ch), perks: lo.perks, item: profile.survivor.item || 'flashlight', loadouts: myLoadouts() };
  if (lobby.isHost) { applyLoadout(me, m); broadcastLobby(); }
  else lobby.net.send(m);
}
seg('lobby-role', v => sendMyLoadout(v));
seg('lobby-diff', v => { if (lobby && lobby.isHost) { lobby.diff = v; broadcastLobby(); } });
$('lobby-map').addEventListener('change', e => { if (lobby && lobby.isHost) { lobby.map = e.target.value; if (lobby.map === 'vote') newVote(); broadcastLobby(); } });
$('lobby-gm').addEventListener('change', e => {
  if (!lobby || !lobby.isHost) return;
  lobby.gm = MODES[e.target.value] ? e.target.value : 'classic'; if (lobby.map === 'vote') newVote();
  // players beyond the new mode's slots move to the other side (or are told the lobby is full)
  const cap = lobbyCaps();
  const ks = lobby.players.filter(p => p.role === 'killer');
  for (const p of ks.slice(cap.k)) if (lobby.players.filter(x => x.role === 'survivor').length < cap.s) { p.role = 'survivor'; Object.assign(p, sanitizeLoadout('survivor', p.loadouts?.survivor?.char, p.loadouts?.survivor?.perks)); p.skin = cleanSkin(p.char, p.loadouts?.survivor?.skin); }
  broadcastLobby();
});
$('lobby-fill').addEventListener('change', e => { if (lobby && lobby.isHost) { lobby.fill = e.target.checked; broadcastLobby(); } });
$('btn-copy').addEventListener('click', async () => {
  if (location.protocol === 'file:') {
    try { await navigator.clipboard.writeText(lobby.code); } catch {}
    toast('Room code ' + lobby.code + ' copied. Friends open Nightbound → Online Match → Join and enter it.', 7000);
    return;
  }
  const url = location.origin + location.pathname + '?join=' + lobby.code;
  try { await navigator.clipboard.writeText(url); toast('Invite link copied: ' + url); } catch { toast(url, 8000); }
});
$('chat-in').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !lobby) return;
  const text = e.target.value.trim().slice(0, 120); e.target.value = '';
  if (!text) return;
  if (lobby.isHost) { lobby.net.broadcast({ t: 'chat', name: settings.name, text }); addChat(settings.name, text); }
  else lobby.net.send({ t: 'chat', text });
});
function addChat(name, text) {
  const el = document.createElement('div');
  el.innerHTML = name ? `<b>${esc(name)}:</b> ${esc(text)}` : `<i>${esc(text)}</i>`;
  $('chat-log').appendChild(el); $('chat-log').scrollTop = 1e6;
}
$('btn-leave-lobby').addEventListener('click', () => leaveOnline());
$('btn-lobby-start').addEventListener('click', () => {
  if (!lobby || !lobby.isHost) return;
  const ps = lobby.players;
  const roster = ps.map(p => ({ id: p.id, name: p.name, role: p.role, char: p.char, skin: p.skin || 'default', perks: p.perks, item: p.item, pet: p.pet || '', pu: Array.isArray(p.loadouts?.survivor?.pu) ? p.loadouts.survivor.pu : [], bot: false, ...(p.role === 'killer' ? { lv: +(p.loadouts?.killer?.lv) || undefined, og: !!p.loadouts?.killer?.og } : {}) }));
  const used = roster.filter(r => r.role === 'survivor').map(r => r.char);
  const cap = lobbyCaps();
  if (!roster.some(r => r.role === 'killer')) {
    if (!lobby.fill) { toast('Someone needs to be the killer (or enable bots).'); return; }
  }
  for (let nk = roster.filter(r => r.role === 'killer').length, i = 0; nk < cap.k && (lobby.fill || nk === 0); nk++, i++) roster.push(botKiller('random', i, roster.filter(r => r.role === 'killer').map(r => r.char)));
  let ns = roster.filter(r => r.role === 'survivor').length;
  if (lobby.fill) for (let i = 1; ns < cap.s; i++, ns++) roster.push(botSurvivor(i, used));
  if (ns === 0) { toast('At least one survivor is needed (or enable bots).'); return; }
  lobby.inGame = true;
  const go = map => startHostMatch(roster, { myId: 'host', difficulty: lobby.diff, net: lobby.net, kind: 'online', map, mode: lobby.gm || 'classic' });
  if ((lobby.map || 'vote') !== 'vote') { go(lobby.map); return; }
  // everyone (and the bots filling empty slots) votes on the map screen first
  const total = 10000, nBots = roster.filter(r => r.bot).length, V = lobby.voting = { cands: voteCands(lobby.gm), votes: {}, ends: Date.now() + total, total, voters: ps.length + nBots, winner: null };
  const share = () => { lobby.net.broadcast({ t: 'mapvote', cands: V.cands, votes: V.votes, left: Math.max(0, V.ends - Date.now()), total, voters: V.voters, winner: V.winner }); showVote(); };
  const finish = () => {
    if (V.winner) return; V.winner = voteWinnerOf(V.cands, V.votes); share();
    addChat(null, `The vote picked ${mapName(V.winner)}.`);
    setTimeout(() => { lobby.voting = null; closeMapSelect(); go(V.winner); }, 2200);
  };
  V.cast = (who, c) => { if (V.winner || !V.cands.includes(c)) return; V.votes[who] = c; share(); if (Object.keys(V.votes).length >= V.voters) setTimeout(finish, 900); };
  for (let i = 0; i < nBots; i++) setTimeout(() => V.cast('bot' + i, V.cands[Math.floor(Math.random() * V.cands.length)]), 1200 + Math.random() * 5500);
  setTimeout(finish, total);
  share();
});
function returnToLobby() {
  if (!lobby) { endSession(); show('p-main'); return; }
  lobby.net.broadcast({ t: 'tolobby' });
  endSession(); stopBG(); startBG();
  lobby.inGame = false;
  if (lobby.isHost && lobby.map === 'vote') newVote();
  showLobby();
  broadcastLobby();
}
function leaveOnline(silent) {
  if (lobby) { try { lobby.net.close(); } catch {} lobby = null; }
  if (session) endSession();
  $('chat-log').innerHTML = '';
  loading(false);
  show('p-main');
}

// ---------- progress: level, ranks, season pass ----------
function renderPass() {
  const P = profile.prog ||= { xp: 0, ranks: { survivor: 0, killer: 0 }, season: { id: SEASON.id, xp: 0, claimed: {} }, badges: {} };
  if (!P.season || P.season.id !== SEASON.id) P.season = { id: SEASON.id, xp: 0, claimed: {} };
  const lv = levelOf(P.xp), tier = seasonTier(P.season.xp), left = Math.max(0, Math.ceil((seasonEnds() - Date.now()) / 864e5));
  const rankCard = role => { const r = rankOf(P.ranks[role] || 0); return `<div class="rk-card">${rankBadge(r, 64)}<div><small>${role === 'killer' ? 'Killer' : 'Survivor'} rank</small><b style="color:${r.tier.color}">${r.name}</b><div class="pips">${Array.from({ length: PIPS_PER_GRADE }, (_, i) => `<i class="${i < r.into || r.top ? 'on' : ''}"></i>`).join('')}</div><span>${r.top ? 'Top rank' : `${PIPS_PER_GRADE - r.into} pip${PIPS_PER_GRADE - r.into === 1 ? '' : 's'} to the next grade`}</span></div></div>`; };
  const tiers = SEASON.tiers.map(t => { const got = tier >= t.t, claimed = !!P.season.claimed[t.t];
    return `<div class="sp-tier ${got ? 'got' : ''} ${claimed ? 'claimed' : ''} ${t.kind === 'badge' ? 'big' : ''}"><small>Tier ${t.t}</small><b>${t.kind === 'badge' ? icon('gift') : icon('ember')}</b><span>${esc(t.label)}</span>${claimed ? '<em>Claimed</em>' : got ? `<button class="btn primary" data-claim-tier="${t.t}">Claim</button>` : '<em>Locked</em>'}</div>`; }).join('');
  $('pass-body').innerHTML = `
    <div class="pr-top"><div class="lv-ring"><b>${lv.lvl}</b><small>Level</small></div><div class="lv-info"><b>${esc(settings.name)}</b><div class="bar"><div style="width:${(lv.into / lv.need * 100).toFixed(1)}%"></div></div><span>${lv.into.toLocaleString()} / ${lv.need.toLocaleString()} XP to level ${lv.lvl + 1}</span>${Object.keys(P.badges || {}).length ? `<div class="badges">${Object.keys(P.badges).map(b => `<i>${b === 's1-final' ? 'Dawn Survivor' : 'Long Night'}</i>`).join('')}</div>` : ''}</div></div>
    <div class="rk-row">${rankCard('survivor')}${rankCard('killer')}</div>
    ${awardsHTML()}
    <p class="hint">Ranks go up with good matches (escaping, a high score, or killing most of the survivors) and down with bad ones. Grades run Ash, Bronze, Silver, Gold and Iridescent, IV to I.</p>
    <div class="sp-head"><div><b>${esc(SEASON.name)}</b><span>${left} day${left === 1 ? '' : 's'} left · tier ${tier} / ${SEASON.tiers.length}</span></div><div class="bar"><div style="width:${(tier >= SEASON.tiers.length ? 100 : (P.season.xp % SEASON.tierXp) / SEASON.tierXp * 100).toFixed(1)}%"></div></div><span class="hint">Free pass. Every match earns season XP; ${SEASON.tierXp.toLocaleString()} XP per tier.</span></div>
    <div class="sp-grid">${tiers}</div>`;
  $('pass-body').querySelectorAll('[data-claim-tier]').forEach(b => b.onclick = () => {
    const t = SEASON.tiers.find(x => x.t === +b.dataset.claimTier); if (!t || P.season.claimed[t.t]) return;
    P.season.claimed[t.t] = true; if (t.embers) profile.stats.embers += t.embers; if (t.kind === 'badge') (P.badges ||= {})[t.id] = true;
    saveProfile(); sound.play('escaped'); toast(`Claimed: ${t.label}`); renderPass(); renderShowcase();
  });
}

// ---------- friends ----------
const friends = new Friends(profile, saveProfile, () => settings.name);
friends.stateFn = () => session ? { state: 'match' } : lobby ? { state: 'lobby', code: lobby.inGame ? null : lobby.code } : { state: 'menu' };
let chatWith = null, chatFocus = false;
function chatHTML(f) {
  const msgs = friends.chats.get(f.id) || [];
  return `<div class="fr-chat"><div id="fr-chat-log">${msgs.length ? msgs.map(m => `<div class="cm ${m.me ? 'me' : ''}"><b>${m.me ? 'You' : esc(f.name)}</b> ${esc(m.text)}</div>`).join('') : `<p class="hint">Say hi to ${esc(f.name)}. Messages only reach them while they are online.</p>`}</div><div class="fr-chat-row"><input id="fr-chat-in" maxlength="300" placeholder="Message ${esc(f.name)}…"><button class="btn primary" id="fr-chat-send">Send</button></div></div>`;
}
function renderFriendsBadge() { const n = friends.onlineCount(), r = friends.requests.size + [...friends.unread.values()].reduce((a, b) => a + b, 0); $('friends-badge').textContent = r ? r : n; $('friends-badge').classList.toggle('hidden', !n && !r); $('friends-badge').classList.toggle('req', !!r); }
function renderFriends() {
  if ($('p-friends').classList.contains('hidden')) return;
  const ae = document.activeElement; chatFocus = !!(ae && ae.id === 'fr-chat-in'); const draft = ae && ae.id === 'fr-chat-in' ? ae.value : (document.getElementById('fr-chat-in') || {}).value;
  const st = id => { const s = friends.status.get(id); if (!friends.online(id)) return { on: false, txt: 'Offline' }; return { on: true, txt: s.state === 'match' ? 'In a match' : s.state === 'lobby' ? 'In a lobby' : 'In the menu', code: s.state === 'lobby' ? s.code : null }; };
  const list = profile.friends.slice().sort((a, b) => (friends.online(b.id) ? 1 : 0) - (friends.online(a.id) ? 1 : 0));
  const canInvite = !!(lobby && lobby.code && !lobby.inGame);
  $('friends-body').innerHTML = `
    <div class="fr-me"><small>Your friend code</small><b>${fmtCode(friends.id)}</b><button class="btn" id="fr-copy">Copy</button><span class="fr-conn ${friends.mq ? 'on' : ''}">${friends.mq ? 'Online' : 'Connecting…'}</span></div>
    <div class="fr-add"><input id="fr-code" maxlength="9" placeholder="Friend's code, e.g. ABCD-2345"><button class="btn primary" id="fr-send">Add friend</button></div>
    ${friends.requests.size ? `<div class="lo-sub"><span>Friend requests</span></div>${[...friends.requests].map(([id, nm]) => `<div class="fr-row"><span class="dot on"></span><b>${esc(nm)}</b><small>${fmtCode(id)}</small><button class="btn primary" data-acc="${id}">Accept</button><button class="btn" data-dec="${id}">Decline</button></div>`).join('')}` : ''}
    ${profile.outgoing.length ? `<div class="lo-sub"><span>Sent requests</span></div>${profile.outgoing.map(o => `<div class="fr-row"><span class="dot"></span><b>${fmtCode(o.id)}</b><small>waiting for them to accept</small><button class="btn" data-cancel="${o.id}">Cancel</button></div>`).join('')}` : ''}
    <div class="lo-sub"><span>Friends</span><span>${friends.onlineCount()} online</span></div>
    ${list.length ? list.map(f => { const s = st(f.id); return `<div class="fr-row"><span class="dot ${s.on ? 'on' : ''}"></span><b>${esc(f.name)}</b><small>${s.txt}</small>${s.code ? `<button class="btn" data-join="${s.code}">Join</button>` : ''}${s.on && canInvite ? `<button class="btn primary" data-inv="${f.id}">Invite</button>` : ''}<button class="btn" data-gift="${f.id}" title="Gift Embers">${icon('gift')} Gift</button><button class="btn" data-chat="${f.id}">Chat${friends.unread.get(f.id) ? ` <span class="newtag">${friends.unread.get(f.id)}</span>` : ''}</button><button class="btn x" data-rm="${f.id}" title="Remove friend">×</button></div>${chatWith === f.id ? chatHTML(f) : ''}`; }).join('') : '<p class="hint">No friends yet. Send them your code, or add theirs above.</p>'}
    <p class="hint">${canInvite ? 'You are in a lobby: invite online friends straight in.' : 'Host or join an Online Match to invite friends into your lobby. Friends in a lobby can be joined directly.'}</p>`;
  const B = $('friends-body');
  $('fr-copy').onclick = async () => { try { await navigator.clipboard.writeText(fmtCode(friends.id)); toast('Friend code copied'); } catch { toast(fmtCode(friends.id)); } };
  $('fr-send').onclick = () => { const err = friends.request($('fr-code').value); if (err) toast(err); else { toast('Friend request sent'); sound.play('click'); } };
  B.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => { friends.accept(b.dataset.acc); toast('Friend added'); });
  B.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => friends.decline(b.dataset.dec));
  B.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => friends.cancel(b.dataset.cancel));
  B.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => friends.remove(b.dataset.rm));
  B.querySelectorAll('[data-inv]').forEach(b => b.onclick = () => { friends.invite(b.dataset.inv, lobby.code); toast('Invite sent'); sound.play('click'); });
  B.querySelectorAll('[data-join]').forEach(b => b.onclick = () => { closePanel(); doJoin(b.dataset.join); });
  B.querySelectorAll('[data-gift]').forEach(b => b.onclick = () => giftDialog(b.dataset.gift));
  B.querySelectorAll('[data-chat]').forEach(b => b.onclick = () => { chatWith = chatWith === b.dataset.chat ? null : b.dataset.chat; friends.unread.delete(chatWith); renderFriends(); renderFriendsBadge(); });
  const ci = $('fr-chat-in');
  if (ci) {
    if (draft) ci.value = draft;
    const send = () => { if (friends.say(chatWith, ci.value)) { ci.value = ''; } else if (ci.value.trim()) toast('Not connected to the online relay yet.'); };
    $('fr-chat-send').onclick = send; ci.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') send(); };
    const log = $('fr-chat-log'); log.scrollTop = 1e6; if (chatFocus) ci.focus();
  }
}
friends.on('change', () => { renderFriendsBadge(); renderFriends(); });
// gifting Embers to a friend: pick an amount, confirm, and they arrive even if the friend is offline
function giftDialog(id) {
  const f = profile.friends.find(x => x.id === id); if (!f) return;
  const have = profile.stats.embers, c = $('invite-card');
  c.innerHTML = `<b>Gift Embers to ${esc(f.name)}</b><small class="gift-have">You have ${price(have)}</small>
    <div class="gift-amts">${[100, 500, 1000, 2500, 5000].map(a => `<button class="btn" data-amt="${a}" ${a > have ? 'disabled' : ''}>${a.toLocaleString()}</button>`).join('')}</div>
    <div class="gift-row"><input id="gift-amt" type="number" min="1" max="${Math.min(have, GIFT_MAX)}" placeholder="Other amount"><button class="btn primary" id="gift-send">Send</button><button class="btn" id="gift-no">Cancel</button></div>`;
  c.classList.remove('hidden');
  const inp = $('gift-amt'); inp.onkeydown = e => e.stopPropagation();
  c.querySelectorAll('[data-amt]').forEach(b => b.onclick = () => { inp.value = b.dataset.amt; c.querySelectorAll('[data-amt]').forEach(x => x.classList.toggle('on', x === b)); });
  $('gift-no').onclick = () => c.classList.add('hidden');
  $('gift-send').onclick = () => {
    const amt = Math.floor(+inp.value || 0);
    if (amt < 1) { toast('Pick how many Embers to send.'); return; }
    if (amt > profile.stats.embers) { toast('You do not have that many Embers.'); return; }
    const err = friends.gift(id, amt);
    if (err) { toast(err); return; }
    profile.stats.embers -= amt; saveProfile(); renderShowcase();
    c.classList.add('hidden'); sound.play('escaped');
    toast(`Sent ${amt.toLocaleString()} Embers to ${f.name}${friends.online(id) ? '' : ' (they will get them next time they are online)'}`, 5000);
  };
}
friends.on('gift', (id, name, amount) => {
  profile.stats.embers += amount; saveProfile(); renderShowcase();
  sound.play('escaped'); toast(`🎁 ${name} gifted you ${amount.toLocaleString()} Embers!`, 7000);
  if (!$('store').classList.contains('hidden')) renderStore();
});
friends.on('chat', (id, name, text) => { if (chatWith === id && !$('p-friends').classList.contains('hidden')) { friends.unread.delete(id); return; } toast(`${name || 'Friend'}: ${String(text).slice(0, 80)}`, 5000); sound.play('click'); });
friends.on('request', (id, name) => toast(`${name || 'Someone'} sent you a friend request`, 5000));
friends.on('accepted', (id, name) => toast(`${name || 'A player'} accepted your friend request`, 5000));
friends.on('invite', (id, name, code) => {
  const c = $('invite-card');
  c.innerHTML = `<b>${esc(name || 'A friend')}</b> invited you to their lobby<div><button class="btn primary" id="inv-join">Join</button><button class="btn" id="inv-no">Not now</button></div>`;
  c.classList.remove('hidden'); sound.play('click');
  $('inv-no').onclick = () => c.classList.add('hidden');
  $('inv-join').onclick = () => { c.classList.add('hidden'); if (session) { toast('Finish or leave your match first.'); return; } if (lobby) leaveOnline(true); doJoin(code); };
  clearTimeout(c.hideT); c.hideT = setTimeout(() => c.classList.add('hidden'), 30000);
});
$('friends-btn').onclick = () => { sound.init(); sound.play('click'); openPanel('p-friends', 'Friends'); };
// ---------- weekly awards: Best Survivor and Best Killer of the whole player base ----------
const awards = new Awards(profile, saveProfile, friends);
function awardsHTML() {
  const W = awards.ensureWeek(), next = revealOf(W.w), ms = next - Date.now(), h = Math.max(0, Math.floor(ms / 36e5));
  const when = h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${Math.max(0, Math.floor(ms / 6e4) % 60)}m`;
  const T = awards.top(3), row = (r, i, k) => `<li class="${r.fid === friends.id ? 'me' : ''}"><i>${i + 1}</i><b>${esc(r.n)}</b><span>${k === 's' ? `${r.se} escape${r.se === 1 ? '' : 's'}` : `${r.kk} kill${r.kk === 1 ? '' : 's'}`}</span></li>`;
  const lastW = Object.keys(profile.awards || {}).map(Number).sort((a, b) => b - a)[0], last = lastW != null ? profile.awards[lastW] : null;
  return `<div class="aw-box"><div class="aw-head"><b>Weekly Awards</b><span>Revealed in ${when} · ${AWARD.prize.toLocaleString()} Embers to each winner</span></div>
    <div class="aw-cols">
      <div><small>Best Survivor (most escapes)</small><ol>${T.s.map((r, i) => row(r, i, 's')).join('') || '<li class="none">Nobody yet</li>'}</ol></div>
      <div><small>Best Killer (most kills)</small><ol>${T.k.map((r, i) => row(r, i, 'k')).join('') || '<li class="none">Nobody yet</li>'}</ol></div>
    </div>
    <p class="hint">Your week: ${W.se} escape${W.se === 1 ? '' : 's'} in ${W.ms} survivor match${W.ms === 1 ? '' : 'es'} · ${W.kk} kill${W.kk === 1 ? '' : 's'} in ${W.mk} killer match${W.mk === 1 ? '' : 'es'}. Ties go to the higher score. ${friends.mq ? '' : 'Connecting to the online relay…'}</p>
    ${last ? `<p class="hint">Last winners: ${last.s ? `Best Survivor <b>${esc(last.s.n)}</b>` : 'no Best Survivor'} · ${last.k ? `Best Killer <b>${esc(last.k.n)}</b>` : 'no Best Killer'}</p>` : ''}</div>`;
}
let awT = 0;
awards.on('live', () => { if ($('p-pass').classList.contains('hidden') || Date.now() - awT < 1500) return; awT = Date.now(); renderPass(); });
awards.on('reveal', (w, r) => showAwards(w, r));
let awardsLater = null; // a reveal that arrived while in a lobby or match waits for the main menu (closing the lobby panel leaves the room)
setInterval(() => { if (awardsLater && !lobby && !session) { const a = awardsLater; awardsLater = null; showAwards(...a); } }, 1500);
function showAwards(w, r) {
  if (lobby || session) { awardsLater = [w, r]; return; }
  closePanel(); sound.play('escaped');
  const card = (t, x, stat) => `<div class="aw-card"><small>${t}</small>${x ? `<b>${esc(x.n)}</b><span>${stat}</span>` : '<b>No winner</b><span>nobody qualified this week</span>'}</div>`;
  const A = $('announce');
  A.innerHTML = `<div class="an-bg"></div><div class="an-inner aw-an"><div class="an-kicker">Weekly Awards · week ending ${new Date(revealOf(w)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</div>
    <div class="an-x" style="font-size:clamp(40px,7vw,80px)">The best <span>of the fog</span></div>
    <div class="aw-cards">${card('Best Survivor', r.s, r.s ? `${r.s.se} escapes${r.s.sp ? ` · ${r.s.sp.toLocaleString()} pts` : ""}` : '')}${card('Best Killer', r.k, r.k ? `${r.k.kk} kills${r.k.kp ? ` · ${r.k.kp.toLocaleString()} pts` : ""}` : '')}</div>
    ${r.prize ? `<div class="aw-you">That's you! +${r.prize.toLocaleString()} Embers</div>` : `<p class="hint">Each winner gets ${AWARD.prize.toLocaleString()} Embers. A new week starts now: escape and kill to top the board.</p>`}
    <div class="an-actions"><button class="btn primary big" id="aw-ok">Nice</button></div></div>`;
  A.classList.remove('hidden');
  $('aw-ok').onclick = () => { sound.play('click'); hideAnnounce(); };
  renderShowcase();
}
friends.connect();

// ---------- main loop ----------
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const real = Math.min(0.25, Math.max(0, (now - last) / 1000));
  const dt = Math.min(0.05, real);
  last = now;
  try {
    if (session) session.tick(dt, real);
    else if (menu) menu.update(dt, renderer);
  } catch (e) { console.error(e); }
}
// Keep the host simulation and its snapshots on schedule between frames and while the tab is in
// the background. Browsers stop requestAnimationFrame and slow main-thread timers to ~1/s in hidden
// tabs (a host alt-tabbing used to freeze everyone); timers inside a Worker are not throttled.
function hostPump() {
  // online hosts only (a bot match simply pauses in the background, as before)
  if (!session || !session.isHost || !session.net || !session.pump) return;
  try { session.pump(0.014); } catch (e) { console.error(e); }
}
try {
  const src = 'setInterval(function(){postMessage(0)},16)';
  const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  w.onmessage = hostPump;
} catch { setInterval(hostPump, 16); }
addEventListener('resize', () => { if (!session) renderer.setSize(innerWidth, innerHeight); });

// ---------- OFFAL x Nightbound announcement ----------
const AN_OFFAL = $('announce').innerHTML;
const AN_GB = `<div class="an-bg gb"></div><div class="an-inner">
  <div class="an-kicker">Fan-made crossover · Two new survivors · Available now</div>
  <div class="an-banner gb-banner"><div class="gb-slime"></div><img class="gb-l" alt=""><img class="gb-r" alt=""><div class="gb-title">Ghostbusters</div><div class="an-scan"></div></div>
  <div class="an-x">× <span>Nightbound</span></div>
  <p class="an-sub">Raghuvir and Abeer suit up and walk into the fog with proton packs on their backs. Who you gonna call when the killer comes? Nobody. Set a <b>Ghost Trap</b> and run.</p>
  <ul class="an-list"><li>New survivor: <b>Raghuvir</b></li><li>New survivor: <b>Abeer</b></li><li>New item: <b>Ghost Trap</b> (G)</li></ul>
  <div class="an-actions"><button class="btn primary big" id="an-play">Play as Raghuvir</button><button class="btn big" id="an-play2">Play as Abeer</button><button class="btn" id="an-store">Outfits</button><button class="btn" id="an-close">Close</button></div>
  <p class="gb-note">Fan-made. Not affiliated with or endorsed by the Ghostbusters rights holders.</p></div>`;
const AN_GRANNY = `<div class="an-bg granny"></div><div class="an-inner">
  <div class="an-kicker">Chapter VIII · New chapter · Available now</div>
  <div class="an-banner"><div class="an-img granny-art"></div><div class="an-scan"></div></div>
  <div class="an-x">× <span>Nightbound</span></div>
  <p class="an-sub">You wake up in her house. She hears every creak of the floorboards, appears at any generator or hook she likes, <b>Spider Mom</b> crawls the generators looking for you, and Granny can switch bodies with her in an instant. Escape <b>Granny's House</b>, a brand new map, before she finds you.</p>
  <ul class="an-list"><li>New killer: <b>Granny</b> (Bat Rush, I Hear You, Creep, Body Swap)</li><li>Her helper: <b>Spider Mom</b></li><li>New map: <b>Granny's House</b> (free for everyone)</li><li>New execution: <b>Bedtime Trap</b></li></ul>
  <div class="an-actions"><button class="btn primary big" id="an-store">Get the Chapter</button><button class="btn big" id="an-play">Play Granny's House</button><button class="btn" id="an-trailer">Watch Trailer</button><button class="btn" id="an-close">Close</button></div>
  <p class="gb-note">Fan-made crossover. Granny and Spider Mom are characters by DVloper; not affiliated with or endorsed by them.</p></div>`;
function showAnnounce(kind = 'offal') {
  closePanel();
  const A = $('announce'); A.innerHTML = kind === 'gb' ? AN_GB : kind === 'granny' ? AN_GRANNY : AN_OFFAL; A.classList.remove('hidden');
  if (kind === 'granny') {
    $('an-store').onclick = () => { sound.play('click'); hideAnnounce(); openStore('chapters'); };
    $('an-play').onclick = () => { sound.play('click'); hideAnnounce(); botsCfg.map = 'granny'; navActions['play-survivor'](); $('bots-map').value = 'granny'; };
    $('an-trailer').onclick = () => { sound.play('click'); hideAnnounce(); showTrailer(() => showAnnounce('granny'), true); };
    $('an-close').onclick = () => { sound.play('click'); hideAnnounce(); };
    profile.seen.granny = true; saveProfile(); return;
  }
  const play = ch => { sound.play('click'); hideAnnounce(); profile.survivor.char = ch; saveProfile(); if (menu) menu.setSurvivor(ch, skinId(ch)); navActions['play-survivor'](); };
  if (kind === 'gb') {
    A.querySelector('.gb-l').src = art('full', 'raghuvir', 'default', 260, 390); A.querySelector('.gb-r').src = art('full', 'abeer', 'default', 260, 390);
    $('an-play').onclick = () => play('raghuvir'); $('an-play2').onclick = () => play('abeer');
    $('an-store').onclick = () => { sound.play('click'); hideAnnounce(); openStore('characters', 'raghuvir'); previewSkin(skinId('raghuvir')); };
    profile.seen.gb = true;
  } else {
    $('an-store').onclick = () => { sound.play('click'); hideAnnounce(); openStore('chapters'); };
    $('an-play').onclick = () => { sound.play('click'); hideAnnounce(); botsCfg.map = 'meatworks'; navActions['play-survivor'](); $('bots-map').value = 'meatworks'; };
    profile.seen.offal = true;
  }
  $('an-close').onclick = () => { sound.play('click'); hideAnnounce(); };
  saveProfile(); sound.init(); sound.play('caged');
}
function hideAnnounce() { $('announce').classList.add('hidden'); }
$('news-card').onclick = () => { sound.init(); showTrailer(() => showAnnounce('granny'), true); };
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('announce').classList.contains('hidden')) hideAnnounce(); });
// new chapter: everyone is greeted with its trailer once, then the announcement
if (!profile.seen.grannyTrailer) setTimeout(() => { if (!session && !lobby) { profile.seen.grannyTrailer = true; saveProfile(); showTrailer(() => showAnnounce('granny')); } }, 900);

startBG();
requestAnimationFrame(loop);
const qj = new URLSearchParams(location.search).get('join');
if (qj) { openPanel('p-online', 'Online Match'); $('join-code').value = qj.toUpperCase(); setTimeout(() => doJoin(qj), 300); }
// ---------- email updates (Buttondown newsletter) ----------
// The address goes straight from this page to Buttondown (double opt-in); the game never stores it.
if (NEWSLETTER) {
  $('news-opt').classList.remove('hidden');
  const st = profile.news || {};
  $('news-on').checked = !!st.on; $('news-form').classList.toggle('hidden', !st.on);
  if (st.done) $('news-msg').textContent = 'Subscribed. Check your inbox for the confirmation email if you have not yet.';
  $('news-on').onchange = e => { profile.news = { ...(profile.news || {}), on: e.target.checked }; saveProfile(); $('news-form').classList.toggle('hidden', !e.target.checked); };
  $('news-email').onkeydown = e => e.stopPropagation();
  $('news-send').onclick = async () => {
    const email = $('news-email').value.trim(), msg = $('news-msg');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = 'That does not look like an email address.'; return; }
    if (!$('news-age').checked) { msg.textContent = 'You need to be 13 or older to sign up.'; return; }
    msg.textContent = 'Subscribing…';
    try {
      await fetch('https://buttondown.com/api/emails/embed-subscribe/' + encodeURIComponent(NEWSLETTER), { method: 'POST', mode: 'no-cors', body: new URLSearchParams({ email, tag: 'game' }) });
      profile.news = { on: true, done: true }; saveProfile(); $('news-email').value = '';
      msg.textContent = 'Almost done: check your inbox and click the confirmation link.';
    } catch { msg.textContent = 'Could not reach the newsletter right now. Try again later.'; }
  };
}
window.__nb = { get session() { return session; }, get lobby() { return lobby; }, settings, profile, friends, get awards() { return awards; } };
