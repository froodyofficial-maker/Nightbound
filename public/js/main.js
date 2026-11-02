// Entry point: menus, loadouts, bot matches, online lobby, match sessions and the main loop.
import * as THREE from 'three';
import { buildMap } from './map.js';
import { Sim } from './sim.js';
import { Bots } from './bots.js';
import { Game } from './game.js';
import { QUALITY } from './world.js';
import { setDetail } from './models.js';
import { MenuScene } from './menu.js';
import { loadForeman, onForemanReady } from './foremanGlb.js';
import { packSnap, SnapReader } from './snap.js';
import { icon, POWER_ICON } from './icons.js';
import { sound } from './audio.js';
import { hostRoom, joinRoom, relayAvailable } from './net.js';
import { KILLERS, SURVIVORS, SURV_PERKS, KILLER_PERKS, DEFAULT_SURV_PERKS, DEFAULT_KILLER_PERKS, BOT_NAMES, SNAP_RATE, SKINS, INBOX, VERSION } from './config.js';

window.__nbBooted = true;
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
profile.owned ||= {}; profile.skins ||= {}; profile.claimed ||= {}; profile.readInbox ||= {};
const skinId = char => (profile.skins[char] && (profile.owned[char + ':' + profile.skins[char]] || profile.skins[char] === 'default')) ? profile.skins[char] : 'default';
if (!KILLERS[profile.killer.char]) profile.killer.char = 'butcher';
// drop perks that no longer exist (Death Warrant was removed in 2.4)
profile.killer.perks = (profile.killer.perks || []).filter(k => KILLER_PERKS[k]);
profile.survivor.perks = (profile.survivor.perks || []).filter(k => SURV_PERKS[k]);
const saveSettings = () => store.set('settings', settings);
const saveProfile = () => store.set('profile', profile);
saveSettings();
sound.vol = settings.vol; sound.music = settings.music;

const BIOS = {
  mara: 'A field medic who stopped asking why the roads all lead back here.',
  eli: 'Mechanic. Can coax a dead engine back to life with a bent spoon and a prayer.',
  june: 'A photographer chasing the story of the vanished hikers. Now she is one.',
  tomas: 'Former park ranger. Knows every trail on the moor, and that none of them lead out.',
};

// ---------- renderer (recreated when graphics quality changes) ----------
let renderer = null;
function makeRenderer() {
  if (renderer) { renderer.dispose(); renderer.domElement.remove(); }
  const q = QUALITY[settings.quality];
  const lite = settings.quality === 'potato' || settings.quality === 'low';
  renderer = new THREE.WebGLRenderer({ antialias: !lite, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.type = settings.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  renderer.setPixelRatio(Math.min(1.5, q.pixel));
  renderer.setSize(innerWidth, innerHeight);
  $('game').appendChild(renderer.domElement);
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
  renderer.shadowMap.enabled = settings.quality === 'high';
  renderer.setPixelRatio(Math.min(1.5, QUALITY[settings.quality].pixel));
  renderer.setSize(innerWidth, innerHeight);
  menu.setSurvivor(profile.survivor.char, skinId(profile.survivor.char));
  menu.setKiller(profile.killer.char, skinId(profile.killer.char));
  menu.setMode(menuMode);
  renderShowcase();
}
loadForeman();
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
  $('profile').innerHTML = `<div class="pn">${esc(settings.name)}</div><div class="pe">${icon('ember')}${Math.round(st.embers).toLocaleString()}</div><div class="ps">${st.matches} matches · ${st.escapes} escapes · ${st.kills} kills</div>`;
}

// ---------- side panel ----------
const SECTIONS = ['p-play', 'p-online', 'p-lobby', 'p-loadout', 'p-settings', 'p-help', 'p-store', 'p-inbox'];
let openSection = null;
function openPanel(id, title, wide = false) {
  for (const p of SECTIONS) $(p).classList.toggle('hidden', p !== id);
  $('panel').classList.remove('hidden');
  $('panel').classList.toggle('wide', wide);
  $('panel-title').textContent = title;
  $('menu').classList.add('panel-open');
  $('menu').classList.remove('hidden');
  openSection = id;
  if (menu) menu.setShift(!wide);
  if (id === 'p-loadout') renderLoadout($('lo-body'), loTab, false);
  if (id === 'p-play') renderBotsPanel();
  if (id === 'p-settings') renderSettings();
  if (id === 'p-online') detectModeHint();
  if (id === 'p-store') renderStore();
  if (id === 'p-inbox') renderInbox();
}
function closePanel() {
  if (openSection === 'p-lobby' && lobby) { leaveOnline(); return; }
  if (openSection === 'p-store' && menu) { menu.setSurvivor(profile.survivor.char, skinId(profile.survivor.char)); menu.setKiller(profile.killer.char, skinId(profile.killer.char)); }
  $('panel').classList.add('hidden');
  $('menu').classList.remove('panel-open');
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
  store: () => openPanel('p-store', 'Store'),
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
seg('lo-tab', v => { loTab = v; setScene(v); renderLoadout($('lo-body'), loTab, false); });
function renderLoadout(container, role, compact, onChange) {
  const defs = role === 'killer' ? KILLERS : SURVIVORS;
  const perks = role === 'killer' ? KILLER_PERKS : SURV_PERKS;
  const lo = profile[role];
  const color = c => '#' + (c.shirt ?? c.color).toString(16).padStart(6, '0');
  container.innerHTML = `<div class="lo-sub"><span>${role === 'killer' ? 'Killer' : 'Survivor'}</span></div>
    <div class="chars">${Object.values(defs).map(c => `<div class="char ${lo.char === c.id ? 'on' : ''}" data-c="${c.id}" style="--c:${color(c)}"><b>${esc(c.name)}</b>${c.lore ? `<small>${esc(c.lore)}</small>` : !compact ? `<small>${esc(BIOS[c.id] || '')}</small>` : ''}${c.ability ? `<div class="ab">${icon(POWER_ICON[c.id])}${esc(c.ability.name)}</div>${!compact ? `<div class="ft">${esc(c.ability.desc)}</div><div class="ab">${icon('shadowstep')}${esc(c.feature.name)}</div><div class="ft">${esc(c.feature.desc)}</div><div class="ab">${icon('exec')}${esc(c.exec.name)}</div><div class="ft">${esc(c.exec.desc)}</div>` : ''}` : ''}</div>`).join('')}</div>
    <div class="lo-sub"><span>Perks</span><span>${lo.perks.length} / 3 equipped</span></div>
    <div class="perkgrid">${Object.entries(perks).map(([k, p]) => `<div class="pk ${lo.perks.includes(k) ? 'on' : ''}" data-p="${k}"><div class="diamond ${role === 'killer' ? 'k' : ''}">${icon(k)}</div><div><b>${esc(p.name)}</b><small>${esc(p.desc)}</small></div></div>`).join('')}</div>`;
  container.querySelectorAll('.char').forEach(el => el.onclick = () => {
    lo.char = el.dataset.c; saveProfile(); sound.play('click');
    if (menu) { if (role === 'killer') menu.setKiller(lo.char, skinId(lo.char)); else menu.setSurvivor(lo.char, skinId(lo.char)); }
    setScene(role);
    renderLoadout(container, role, compact, onChange); onChange && onChange();
  });
  container.querySelectorAll('.pk').forEach(el => el.onclick = () => {
    const k = el.dataset.p, i = lo.perks.indexOf(k);
    if (i >= 0) lo.perks.splice(i, 1); else { if (lo.perks.length >= 3) lo.perks.shift(); lo.perks.push(k); }
    saveProfile(); sound.play('click'); renderLoadout(container, role, compact, onChange); onChange && onChange();
  });
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
  $('set-dynres').checked = settings.dynres !== false; $('set-fps').checked = !!settings.showFps;
  $('set-sens').value = settings.sens; $('set-sens-v').textContent = (+settings.sens).toFixed(2);
  $('set-fov').value = settings.fov; $('set-fov-v').textContent = settings.fov;
  $('set-vol').value = settings.vol; $('set-music').value = settings.music;
  $('set-invert').checked = !!settings.invert;
  $('set-net').value = settings.net;
}
$('set-name').addEventListener('input', e => { settings.name = e.target.value.trim().slice(0, 16) || 'Player'; saveSettings(); renderShowcase(); });
seg('set-quality', v => { settings.quality = v; saveSettings(); $('set-quality-hint').textContent = QHINT[v]; stopBG(); makeRenderer(); startBG(); });
$('set-dynres').addEventListener('change', e => { settings.dynres = e.target.checked; saveSettings(); });
$('set-fps').addEventListener('change', e => { settings.showFps = e.target.checked; saveSettings(); });
$('set-sens').addEventListener('input', e => { settings.sens = +e.target.value; $('set-sens-v').textContent = settings.sens.toFixed(2); saveSettings(); });
$('set-fov').addEventListener('input', e => { settings.fov = +e.target.value; $('set-fov-v').textContent = settings.fov; saveSettings(); });
$('set-vol').addEventListener('input', e => { settings.vol = +e.target.value; sound.setVolume(settings.vol); saveSettings(); });
$('set-music').addEventListener('input', e => { settings.music = +e.target.value; sound.setMusic(settings.music); saveSettings(); });
$('set-invert').addEventListener('change', e => { settings.invert = e.target.checked; saveSettings(); });
$('set-net').addEventListener('change', e => { settings.net = e.target.value; saveSettings(); });
$('pause-sens').addEventListener('input', e => { settings.sens = +e.target.value; saveSettings(); });
$('pause-vol').addEventListener('input', e => { settings.vol = +e.target.value; sound.setVolume(settings.vol); saveSettings(); });

// ---------- store ----------
let storeRole = 'survivor', storeChar = null, storePreview = null;
seg('store-role', v => { storeRole = v; storeChar = null; setScene(v); renderStore(); });
const RARITY = p => p === 0 ? '' : p < 2000 ? 'common' : p < 3500 ? 'rare' : p < 5000 ? 'epic' : 'legendary';
function swatches(char, sk) {
  const base = SURVIVORS[char] || null;
  const cols = base ? [sk.shirt ?? base.shirt, sk.pants ?? base.pants, sk.hair ?? base.hair, sk.vest ?? sk.beanie ?? base.skin]
    : [sk.apron ?? sk.dress ?? sk.coat ?? sk.fur ?? sk.flesh ?? KILLERS[char].color, sk.mask ?? sk.bone ?? sk.skin ?? 0x6a6a6a, sk.eye ?? sk.lamp ?? sk.blood ?? 0x3a3a3a];
  return cols.map(c => `<i style="background:#${(c >>> 0).toString(16).padStart(6, '0')}"></i>`).join('');
}
function renderStore() {
  const chars = storeRole === 'killer' ? Object.keys(KILLERS) : Object.keys(SURVIVORS);
  if (!storeChar || !chars.includes(storeChar)) storeChar = profile[storeRole].char;
  setSeg('store-role', storeRole);
  $('store-wallet').innerHTML = icon('ember') + Math.round(profile.stats.embers).toLocaleString();
  const names = storeRole === 'killer' ? KILLERS : SURVIVORS;
  $('store-chars').innerHTML = chars.map(c => `<button data-c="${c}" class="${c === storeChar ? 'on' : ''}">${esc(names[c].name)}</button>`).join('');
  $('store-chars').querySelectorAll('button').forEach(b => b.onclick = () => { storeChar = b.dataset.c; storePreview = null; sound.play('click'); previewSkin(skinId(storeChar)); renderStore(); });
  const list = SKINS[storeChar] || [];
  const eq = skinId(storeChar);
  $('store-skins').innerHTML = list.map(sk => {
    const owned = sk.price === 0 || profile.owned[storeChar + ':' + sk.id];
    const equipped = eq === sk.id;
    const r = RARITY(sk.price);
    const action = equipped ? '<div class="state">Equipped</div>' : owned ? `<button class="btn" data-eq="${sk.id}">Equip</button>`
      : `<div class="price">${icon('ember')}${sk.price.toLocaleString()}</div><button class="btn primary" data-buy="${sk.id}" ${profile.stats.embers < sk.price ? 'disabled' : ''}>Buy</button>`;
    return `<div class="skin ${equipped ? 'equipped' : ''} ${storePreview === sk.id ? 'preview' : ''}" data-s="${sk.id}">${r ? `<span class="rar ${r}">${r}</span>` : ''}<div class="sw">${swatches(storeChar, sk)}</div><b>${esc(sk.name)}</b>${action}</div>`;
  }).join('');
  $('store-skins').querySelectorAll('.skin').forEach(el => el.onclick = e => {
    const id = el.dataset.s;
    if (e.target.dataset.buy) {
      const sk = list.find(x => x.id === id);
      if (profile.stats.embers < sk.price) { toast('Not enough Embers. Play matches or check your Inbox for gifts.'); return; }
      profile.stats.embers -= sk.price; profile.owned[storeChar + ':' + id] = true; profile.skins[storeChar] = id; saveProfile();
      sound.play('escaped'); toast(`Unlocked ${sk.name}!`); renderShowcase();
    } else if (e.target.dataset.eq) { profile.skins[storeChar] = id; saveProfile(); sound.play('click'); }
    else sound.play('hover');
    storePreview = id; previewSkin(id); renderStore();
  });
}
function previewSkin(id) {
  if (!menu) return;
  if (KILLERS[storeChar]) { menu.setKiller(storeChar, id); setScene('killer'); }
  else { menu.setSurvivor(storeChar, id); setScene('survivor'); }
}

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
    return `<div class="msg ${unread ? 'unread' : ''}"><div class="mtag">${esc(m.tag)} · v${esc(m.version)} · ${esc(m.date)}</div><h3>${esc(m.title)}</h3><ul>${m.body.map(b => `<li>${esc(b)}</li>`).join('')}</ul>${gift}</div>`;
  }).join('');
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
if (profile.lastVersion !== VERSION) {
  profile.lastVersion = VERSION; saveProfile();
  setTimeout(() => toast('New in v' + VERSION + ': ' + INBOX[0].title + '. Check your Inbox!', 6000), 1500);
}

// ---------- bot match ----------
const botsCfg = { role: 'survivor', team: 3, surv: 4, killer: 'random', diff: 'normal' };
seg('bots-role', v => { botsCfg.role = v; setScene(v); $('panel-title').textContent = v === 'killer' ? 'Play as Killer' : 'Play as Survivor'; renderBotsPanel(); });
seg('bots-team', v => { botsCfg.team = +v; });
seg('bots-surv', v => { botsCfg.surv = +v; });
seg('bots-diff', v => { botsCfg.diff = v; });
$('bots-killer').addEventListener('change', e => { botsCfg.killer = e.target.value; });
function renderBotsPanel() {
  const k = botsCfg.role === 'killer';
  $('bots-teammates-row').classList.toggle('hidden', k);
  $('bots-killer-row').classList.toggle('hidden', k);
  $('bots-survivors-row').classList.toggle('hidden', !k);
  renderLoadout($('bots-loadout'), botsCfg.role, true);
}
const randomPerks = (pool, n = 3) => Object.keys(pool).sort(() => Math.random() - 0.5).slice(0, n);
function botSurvivor(i, used) {
  const free = Object.keys(SURVIVORS).filter(c => !used.includes(c));
  const char = free.length ? free[Math.floor(Math.random() * free.length)] : Object.keys(SURVIVORS)[i % 4];
  used.push(char);
  used.names ||= [];
  const pool = BOT_NAMES.filter(n => !used.names.includes(n));
  const nm = pool[Math.floor(Math.random() * pool.length)] || 'Bot ' + i;
  used.names.push(nm);
  const sk = SKINS[char]; const skin = Math.random() < 0.5 ? 'default' : sk[1 + Math.floor(Math.random() * (sk.length - 1))].id;
  return { id: 'bot' + i, name: nm + ' (bot)', role: 'survivor', char, skin, perks: randomPerks(SURV_PERKS), bot: true };
}
function botKiller(char) {
  const ks = Object.keys(KILLERS);
  const c = char && char !== 'random' ? char : ks[Math.floor(Math.random() * ks.length)];
  const sk = SKINS[c]; const skin = Math.random() < 0.5 ? 'default' : sk[1 + Math.floor(Math.random() * (sk.length - 1))].id;
  return { id: 'botk', name: KILLERS[c].name, role: 'killer', char: c, skin, perks: randomPerks(KILLER_PERKS), bot: true };
}
$('btn-bots-start').addEventListener('click', () => {
  sound.init(); sound.play('click');
  const roster = [];
  const meRole = botsCfg.role;
  roster.push({ id: 'me', name: settings.name, role: meRole, char: profile[meRole].char, skin: skinId(profile[meRole].char), perks: profile[meRole].perks, bot: false });
  const used = meRole === 'survivor' ? [profile.survivor.char] : [];
  if (meRole === 'survivor') {
    for (let i = 0; i < botsCfg.team; i++) roster.push(botSurvivor(i + 1, used));
    roster.push(botKiller(botsCfg.killer));
  } else for (let i = 0; i < botsCfg.surv; i++) roster.push(botSurvivor(i + 1, used));
  startHostMatch(roster, { myId: 'me', difficulty: botsCfg.diff, net: null, kind: 'bots' });
});

// ---------- sessions ----------
let session = null;

class HostSession {
  constructor(roster, opts) { this.roster = roster; this.opts = opts; this.net = opts.net; this.myId = opts.myId; this.isHost = true; this.snapT = 0; this.kfT = 0; this.pending = []; }
  start() {
    this.seed = Math.floor(Math.random() * 1e9);
    this.M = buildMap(this.seed);
    this.sim = new Sim(this.M, this.roster, { difficulty: this.opts.difficulty });
    this.bots = new Bots(this.sim);
    if (this.net) this.net.broadcast({ t: 'start', seed: this.seed, roster: this.roster, difficulty: this.opts.difficulty });
    this.game = new Game({ renderer, M: this.M, myId: this.myId, isHost: true, session: this, settings, onEnd: (S, me) => onMatchEnd(S, me, this) });
    this.game.start();
  }
  state() { return this.sim.S; }
  send(m) { this.sim.onMsg(this.myId, m); }
  // connection id -> the player it controls (changes when a fallen survivor takes over a bot)
  pidOf(peer) { return (this.ctrl && this.ctrl.get(peer)) || peer; }
  remote(id, m) { if (m && (m.t === 'pos' || m.t === 'in' || m.t === 'act')) this.sim.onMsg(this.pidOf(id), m); }
  simTick(dt) {
    // fixed-size sub-steps keep the simulation real-time even at low frame rates
    const n = Math.max(1, Math.ceil(dt / 0.034)), h = dt / n;
    for (let i = 0; i < n; i++) this.step(h);
  }
  step(dt) {
    this.bots.update(dt);
    this.sim.update(dt);
    const ev = this.sim.takeEvents();
    if (ev.length) {
      for (const e of ev) if (e.k === 'takeover') {
        this.ctrl ||= new Map();
        let peer = e.from;
        for (const [k, v] of this.ctrl) if (v === e.from) peer = k;
        this.ctrl.set(peer, e.to);
      }
      this.bots.onEvents(ev); this.game.onEvents(ev);
    }
    if (this.net) {
      if (ev.length) this.pending.push(...ev);
      this.snapT -= dt;
      this.kfT -= dt;
      if (this.snapT <= 0) {
        this.snapT = 1 / SNAP_RATE;
        // a full keyframe (names, perks, scores) every second and whenever the match isn't in play
        const kf = this.kfT <= 0 || this.sim.S.phase !== 'play';
        if (kf) this.kfT = 1;
        this.net.broadcast({ t: 's', s: packSnap(this.sim.S, kf), e: this.pending });
        this.pending = [];
      }
    }
  }
  tick(dt, realDt) { this.simTick(realDt); this.game.frame(dt); }
  playerLeft(id) {
    id = this.pidOf(id);
    const p = this.sim.P(id);
    if (!p) return;
    p.bot = true;
    this.sim.inputs.get(id).e = false;
    this.sim.ev({ k: 'msg', text: p.name + ' disconnected, a bot took over.' });
  }
  dispose() { this.game && this.game.dispose(); }
}

class ClientSession {
  constructor(net, start, myId) { this.net = net; this.myId = myId; this.isHost = false; this.M = buildMap(start.seed); this.S = null; this.game = null; this.queued = []; this.reader = new SnapReader(); }
  onMsg(m) {
    if (m.t !== 's') return;
    const s = this.reader.read(m.s);
    if (s) this.S = s;
    // events still count when the snapshot itself had to wait for a keyframe
    if (this.game) this.game.onEvents(m.e || []); else if (m.e) this.queued.push(...m.e);
  }
  state() { if (this.S) this.reader.interpolate(this.S, this.myId); return this.S; }
  send(m) { if (m.t === 'act' && this.reader.rt != null) m.rt = +this.reader.rt.toFixed(3); this.net.send(m); }
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
  if (me) {
    profile.stats.matches++;
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
    btn('Play Again', 'primary', () => { endSession(); $('btn-bots-start').click(); });
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
    lobby = { isHost: true, net, code: net.code, mode, myId: 'host', players: [], fill: true, diff: 'normal', inGame: false, chat: [] };
    const lo = profile.survivor;
    lobby.players.push({ id: 'host', name: settings.name, role: 'survivor', char: lo.char, skin: skinId(lo.char), perks: lo.perks.slice(), host: true, loadouts: myLoadouts() });
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
  return { char: defs[char] ? char : Object.keys(defs)[0], perks: (Array.isArray(perks) ? perks : []).filter(k => pool[k]).slice(0, 3) };
}
function cleanSkin(char, skin) { return (SKINS[char] || []).some(s => s.id === skin) ? skin : 'default';
}
function hostMsg(id, m) {
  if (!m || typeof m !== 'object') return;
  if (lobby.inGame && session && session.isHost) {
    if (m.t === 'hello') lobby.net.send(id, { t: 'reject', reason: 'A match is in progress. Try again when it ends.' });
    else session.remote(id, m);
    return;
  }
  if (m.t === 'hello') {
    if (lobby.players.length >= 5) { lobby.net.send(id, { t: 'reject', reason: 'The lobby is full.' }); return; }
    const killerTaken = lobby.players.some(p => p.role === 'killer');
    const survCount = lobby.players.filter(p => p.role === 'survivor').length;
    let role = m.role === 'killer' && !killerTaken ? 'killer' : 'survivor';
    if (role === 'survivor' && survCount >= 4) role = 'killer';
    const lo = sanitizeLoadout(role, m.loadouts?.[role]?.char, m.loadouts?.[role]?.perks);
    lobby.players.push({ id, name: String(m.name || 'Player').slice(0, 16), role, ...lo, skin: cleanSkin(lo.char, m.loadouts?.[role]?.skin), loadouts: m.loadouts || {} });
    lobby.net.send(id, { t: 'welcome', id });
    addChat(null, String(m.name || 'Player').slice(0, 16) + ' joined.');
    broadcastLobby();
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
function applyLoadout(p, m) {
  let role = m.role === 'killer' ? 'killer' : 'survivor';
  if (role === 'killer' && lobby.players.some(x => x !== p && x.role === 'killer')) role = p.role;
  if (role === 'survivor' && p.role !== 'survivor' && lobby.players.filter(x => x.role === 'survivor').length >= 4) role = p.role;
  if (m.loadouts) p.loadouts = m.loadouts;
  const lo = sanitizeLoadout(role, m.char ?? p.loadouts?.[role]?.char, m.perks ?? p.loadouts?.[role]?.perks);
  p.role = role; p.char = lo.char; p.perks = lo.perks; p.skin = cleanSkin(lo.char, m.skin ?? p.loadouts?.[role]?.skin);
}
function broadcastLobby() {
  if (!lobby || !lobby.isHost) return;
  lobby.net.broadcast({ t: 'lobby', players: lobby.players.map(({ loadouts, ...p }) => p), fill: lobby.fill, diff: lobby.diff, code: lobby.code });
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
    lobby = { isHost: false, net, code, mode, myId: net.id, players: [], fill: true, diff: 'normal', inGame: false, chat: [] };
    net.on('msg', m => clientMsg(m));
    net.on('closed', r => { toast(r); leaveOnline(true); });
    const role = 'survivor';
    net.send({ t: 'hello', name: settings.name, role, loadouts: myLoadouts() });
    showLobby();
  } catch (e) { console.error(e); toast(e.message || String(e)); }
  loading(false);
}
function clientMsg(m) {
  if (!m || typeof m !== 'object' || !lobby) return;
  switch (m.t) {
    case 'welcome': lobby.myId = m.id; break;
    case 'lobby': lobby.players = m.players; lobby.fill = m.fill; lobby.diff = m.diff; renderLobby(); break;
    case 'reject': toast(m.reason); leaveOnline(true); break;
    case 'chat': addChat(m.name, m.text); break;
    case 'start': startClientMatch(m); break;
    case 's': if (session && !session.isHost) session.onMsg(m); break;
    case 'tolobby': if (session) { endSession(); stopBG(); } lobby.inGame = false; showLobby(); break;
  }
}
async function startClientMatch(m) {
  loading(true, 'Entering the fog…');
  await nextFrame();
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
  renderLobby();
}
function myLobbyPlayer() { return lobby && lobby.players.find(p => p.id === lobby.myId); }
function renderLobby() {
  if (!lobby || $('p-lobby').classList.contains('hidden')) return;
  const ps = lobby.players;
  const killer = ps.find(p => p.role === 'killer');
  const survs = ps.filter(p => p.role === 'survivor');
  const charName = p => (p.role === 'killer' ? KILLERS[p.char] : SURVIVORS[p.char])?.name || '';
  const slot = (p, role) => p
    ? `<div class="slot ${role}"><span class="si">${icon(role === 'killer' ? POWER_ICON[p.char] : 'healthy')}</span><span class="nm">${esc(p.name)}${p.host ? ' · Host' : ''}${p.id === lobby.myId ? ' (you)' : ''}</span><span class="ch">${esc(charName(p))}</span></div>`
    : `<div class="slot ${role} empty"><span class="si">${icon(role === 'killer' ? 'warrant' : 'healthy')}</span><span class="nm">${lobby.fill ? (role === 'killer' ? 'Bot killer' : 'Bot survivor') : 'Empty slot'}</span></div>`;
  let html = slot(killer, 'killer');
  for (let i = 0; i < 4; i++) html += slot(survs[i], 'survivor');
  $('lobby-slots').innerHTML = html;
  const me = myLobbyPlayer();
  if (me) {
    setSeg('lobby-role', me.role);
    renderLoadout($('lobby-loadout'), me.role, true, sendMyLoadout);
  }
}
function myLoadouts() { return { survivor: { ...profile.survivor, skin: skinId(profile.survivor.char) }, killer: { ...profile.killer, skin: skinId(profile.killer.char) } }; }
function sendMyLoadout(role) {
  const me = myLobbyPlayer();
  if (!me) return;
  role = role || me.role;
  const lo = profile[role];
  const m = { t: 'loadout', role, char: lo.char, skin: skinId(lo.char), perks: lo.perks, loadouts: myLoadouts() };
  if (lobby.isHost) { applyLoadout(me, m); broadcastLobby(); }
  else lobby.net.send(m);
}
seg('lobby-role', v => sendMyLoadout(v));
seg('lobby-diff', v => { if (lobby && lobby.isHost) { lobby.diff = v; broadcastLobby(); } });
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
  const roster = ps.map(p => ({ id: p.id, name: p.name, role: p.role, char: p.char, skin: p.skin || 'default', perks: p.perks, bot: false }));
  const used = roster.filter(r => r.role === 'survivor').map(r => r.char);
  if (!roster.some(r => r.role === 'killer')) {
    if (!lobby.fill) { toast('Someone needs to be the killer (or enable bots).'); return; }
    roster.push(botKiller('random'));
  }
  let ns = roster.filter(r => r.role === 'survivor').length;
  if (lobby.fill) for (let i = 1; ns < 4; i++, ns++) roster.push(botSurvivor(i, used));
  if (ns === 0) { toast('At least one survivor is needed (or enable bots).'); return; }
  lobby.inGame = true;
  startHostMatch(roster, { myId: 'host', difficulty: lobby.diff, net: lobby.net, kind: 'online' });
});
function returnToLobby() {
  if (!lobby) { endSession(); show('p-main'); return; }
  lobby.net.broadcast({ t: 'tolobby' });
  endSession(); stopBG(); startBG();
  lobby.inGame = false;
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
// keep the host simulation alive while its tab is in the background
setInterval(() => { if (document.hidden && session && session.isHost) { try { session.simTick(0.05); } catch (e) { console.error(e); } } }, 50);
addEventListener('resize', () => { if (!session) renderer.setSize(innerWidth, innerHeight); });

startBG();
requestAnimationFrame(loop);
const qj = new URLSearchParams(location.search).get('join');
if (qj) { openPanel('p-online', 'Online Match'); $('join-code').value = qj.toUpperCase(); setTimeout(() => doJoin(qj), 300); }
window.__nb = { get session() { return session; }, get lobby() { return lobby; }, settings, profile };
