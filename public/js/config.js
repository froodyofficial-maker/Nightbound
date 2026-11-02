// Game tuning + content definitions (shared by host, clients and bots)

export const HALF = 56;                 // map spans -HALF..HALF on x and z
export const TICK = 1 / 60;
export const SNAP_RATE = 20;            // snapshots per second sent to clients

export const SPEED = {
  walk: 2.3, run: 4.0, crouch: 1.15, crawl: 0.75,
  hitBoost: 1.5, hitBoostTime: 1.8,
  killer: 4.6, carry: 4.2, aimSlow: 0.55,
};

export const RULES = {
  genCharges: 66,          // seconds of solo repair per generator
  gensTotal: 7,
  healTime: 14,            // seconds to heal a teammate one health state
  pickupTime: 1.4,         // killer picks up a downed survivor
  cageTime: 1.1,           // killer locks a survivor in a cage
  rescueTime: 1.2,
  gateTime: 18,
  kickTime: 1.8,
  breakTime: 2.4,
  bleedout: 200,
  cageStage: [70, 50],     // seconds before the cage claims you (1st, 2nd caging); 3rd caging is instant
  wiggleNeed: 1,           // wiggle progress needed to escape the killer's grip
  wiggleRate: 0.012,       // progress per alternating keypress (~15s of struggling)
  collapse: 140,           // seconds after the gates are powered before the night claims everyone left
  hitCooldown: 2.7,
  missCooldown: 1.5,
  lungeTime: 0.42,
  lungeMul: 1.45,
  hitRange: 2.0,
  terror: 32,
  stunBarricade: 2.0,
  execTime: 4.2,
  flashBattery: 12, flashRange: 9, flashTime: 1.0, flashStun: 1.6, blindTime: 2.4, blindImmune: 12, // survivor flashlights
  teleTime: 1.2, teleCd: 18, lanternRadius: 9, snuffTime: 2.5,           // length of a killer's execution finisher
};

export const KILLERS = {
  butcher: {
    id: 'butcher', name: 'The Butcher', speed: 4.6, terror: 32, weapon: 'Cleaver',
    lore: 'A slaughterhouse foreman who never clocked out. Slow to anger, impossible to stop once he does.',
    exec: { name: "Butcher's Block", desc: 'Hauls the survivor up by the collar and brings the cleaver down. Twice.' },
    ability: { name: 'Rampage', cooldown: 11, charges: 2, desc: 'Charge forward at great speed for 2.6s. Running into a survivor puts them straight down. Smashes through dropped barricades. Slamming into a wall stuns you. Holds 2 charges.' },
    feature: { name: 'Gore Trail', desc: 'Injured survivors leave a trail of fresh blood that only you can see.' },
    color: 0x7a1c14,
  },
  wisp: {
    id: 'wisp', name: 'The Wisp', speed: 4.6, terror: 28, weapon: 'Claws',
    lore: 'The drowned bride of Gravemoor Lake. You only notice her when the air turns cold.',
    exec: { name: 'Drowning Embrace', desc: 'Lifts the survivor by the throat and drinks their breath until only mist remains.' },
    ability: { name: 'Fade', cooldown: 12, desc: 'Fade from sight for up to 7s: nearly invisible, no terror radius, +15% speed. You cannot attack while faded. Press again to reappear (1s).' },
    feature: { name: 'Ambush & Frost', desc: 'For 2.5s after reappearing, your lunge reaches 60% farther. Survivors near you while faded feel frost creep over their vision and hear whispers.' },
    color: 0x6fb7c9,
  },
  harrower: {
    id: 'harrower', name: 'The Harrower', speed: 4.45, terror: 30, weapon: 'Bone Spear',
    lore: 'An antlered hunter wearing the bones of his quarry. He prefers to finish things from a distance.',
    exec: { name: 'Trophy Hunt', desc: 'Pins the survivor to the earth with a bone spear, then hoists them up as a trophy.' },
    ability: { name: 'Bone Spear', cooldown: 1.2, ammo: 3, reload: 9, desc: 'Hold to aim (slowed), release to hurl a bone spear. A hit injures the survivor like a strike. Carries 3 spears; one regrows every 9s.' },
    feature: { name: 'Trophy Mark', desc: 'Survivors struck by a spear are Marked: their aura is revealed to you for 12 seconds.' },
    color: 0xc9b98a,
  },
  lamplighter: {
    id: 'lamplighter', name: 'The Lamplighter', speed: 4.5, terror: 30, weapon: 'Hook Pole',
    lore: 'He once kept the lights burning on the moor road. Now he keeps the travellers.',
    exec: { name: 'Last Light', desc: 'Raises his lantern to the survivor\'s face until the green flame swallows them whole.' },
    ability: { name: 'Cursed Lanterns', cooldown: 2.5, max: 4, desc: 'Place a cursed lantern (up to 4). Survivors within 9m of a lantern are revealed to you. Survivors can snuff lanterns out.' },
    feature: { name: 'Shadow Step', desc: 'Press R to step through the dark to the lantern you are looking toward (1.2s, 18s cooldown).' },
    color: 0x7cff9a,
  },
  foreman: {
    id: 'foreman', name: 'The Foreman', speed: 4.5, terror: 34, weapon: 'Meat Hook', crossover: 'OFFAL',
    lore: 'Still on shift at the Hollow Pines Meatworks. Headcount must be maintained. He hunts by sound and by light.',
    exec: { name: 'Reassignment', desc: 'Hooks the survivor under the jaw, hoists them off their feet and drags them backward into the dark.' },
    ability: { name: 'Chain Hook', cooldown: 9, range: 18, desc: 'Hold to aim, release to fling your hook on its chain. Catch a survivor and they are injured and reeled back to you. Catch a wall and you are yanked across to it.' },
    ability2: { name: 'Lights Out', key: 'R', cooldown: 45, duration: 9, desc: 'Kill every light on the map for 9s: the fog closes in, you go silent, runners are revealed and one strike of your hook puts a survivor down.' },
    feature: { name: 'Hunts by Sound', desc: 'Survivors running within 22m of you give away their position with a noise ping, lights or no lights.' },
    color: 0xd8ccbc,
  },
};

export const SURVIVORS = {
  mara:  { id: 'mara',  name: 'Mara Voss',   skin: 0xe2b896, hair: 0x2b1a12, shirt: 0x8a2f2a, pants: 0x2c3442, hairStyle: 'long' },
  eli:   { id: 'eli',   name: 'Eli Okafor',  skin: 0x7a4e32, hair: 0x111111, shirt: 0x3c5e3a, pants: 0x3a3226, hairStyle: 'short' },
  june:  { id: 'june',  name: 'June Harlow', skin: 0xf1cfb4, hair: 0xc99b4a, shirt: 0x3a5f8a, pants: 0x222831, hairStyle: 'bun' },
  tomas: { id: 'tomas', name: 'Tomás Reyes', skin: 0xc08a5e, hair: 0x2a1d14, shirt: 0x6b5a3a, pants: 0x1f2a24, hairStyle: 'cap' },
};

export const SURV_PERKS = {
  steady:   { name: 'Steady Hands', icon: '✋', desc: 'Calibration checks have a 40% larger success zone. Perfect checks grant +2% extra progress.' },
  medic:    { name: 'Field Medic',  icon: '✚', desc: 'Heal others 30% faster. You can heal yourself (hold E with no target) at 50% speed.' },
  hushed:   { name: 'Hushed',       icon: '☾', desc: 'Your footsteps and pained breathing are silent. Crouch speed +25%.' },
  sixth:    { name: 'Sixth Sense',  icon: '◉', desc: 'Every 25 seconds the killer\'s aura is revealed to you for 4 seconds.' },
  shared:   { name: 'Shared Labor', icon: '⚙', desc: '+15% repair speed for each other survivor working on the same generator.' },
  lockpick: { name: 'Lockpick',     icon: '⚿', desc: 'Free caged survivors twice as fast. Open exit gates 30% faster.' },
  lastwind: { name: 'Last Wind',    icon: '➶', desc: 'When freed from a cage or picked up from the ground, gain +40% speed for 5 seconds.' },
  acrobat:  { name: 'Acrobat',      icon: '⤴', desc: 'Vault windows and barricades 30% faster.' },
  resolve:  { name: 'Resolve',      icon: '♥', desc: 'Struggle free from the killer 40% faster. Bleed out 50% slower and crawl 30% faster.' },
  fleet:    { name: 'Fleet Foot',   icon: '»', desc: 'While injured, run 7% faster. Your post-hit speed burst lasts 50% longer.' },
};

export const KILLER_PERKS = {
  scent:      { name: 'Scent of Fear', icon: '☠', desc: 'Injured survivors within 24m have their auras revealed to you.' },
  static:     { name: 'Static Sense',  icon: 'ϟ', desc: 'Generators being repaired glow through walls.' },
  overload:   { name: 'Overload',      icon: '✸', desc: 'Kicking a generator instantly removes 8% progress, and it regresses 50% faster.' },
  relentless: { name: 'Relentless',    icon: '⟳', desc: 'Recovery after a successful strike is 35% shorter.' },
  dread:      { name: 'Dread',         icon: '♒', desc: 'Terror radius +8m. Survivors inside your terror radius repair 10% slower.' },
  brute:      { name: 'Brute',         icon: '⚒', desc: 'Break barricades and kick generators 35% faster.' },
  rust:       { name: 'Rusted Locks',  icon: '⛓', desc: 'Cage timers run 20% faster and rescuing a survivor takes twice as long.' },
  sentry:     { name: 'Sentry',        icon: '◎', desc: 'When a generator is completed, the survivors who finished it are revealed for 6 seconds.' },
  fury:       { name: 'Endgame Fury',  icon: '♨', desc: 'Once the exit gates are powered, gain +8% movement speed.' },
  irongrip:   { name: 'Iron Grip',     icon: '✠', desc: 'Survivors you carry struggle free 30% slower.' },
  stalker:    { name: 'Stalker',       icon: '◐', desc: 'Terror radius -14m. Your lunge reaches 20% farther.' },
};

export const DEFAULT_SURV_PERKS = ['steady', 'shared', 'lastwind'];
export const DEFAULT_KILLER_PERKS = ['scent', 'overload', 'relentless'];

export const BOT_NAMES = ['Ash', 'Rook', 'Wren', 'Sable', 'Kit', 'Moss', 'Vale', 'Quill', 'Hollis', 'Briar', 'Fen', 'Lark'];

export const DIFFICULTY = {
  easy:   { react: 0.9, skill: 0.75, great: 0.05, aim: 0.4, killerSpeed: 0.93, sight: 22, reach: 2.2 },
  normal: { react: 0.5, skill: 0.9, great: 0.15, aim: 0.6, killerSpeed: 0.95, sight: 28, reach: 2.3 },
  hard:   { react: 0.25, skill: 0.96, great: 0.3, aim: 0.92, killerSpeed: 1.0, sight: 38, reach: 2.9 },
};

// ---------------- Store: skins (bought with embers) ----------------
export const SKINS = {
  mara: [
    { id: 'default', name: 'Field Jacket', price: 0 },
    { id: 'nightshift', name: 'Night Shift', price: 1500, shirt: 0x2a2e38, pants: 0x15171c, hair: 0x0e0b0a, desc: 'Ball cap, head torch and a scarf against the cold.', fx: [['cap', { color: 0x1a1e26 }], 'headlamp', ['scarf', { color: 0x4a1a1a }]] },
    { id: 'crimson', name: 'Crimson Hood', price: 2500, shirt: 0x6a0d10, pants: 0x222222, desc: 'A blood-red riding cloak, hood up. Not all of the red is dye.', fx: [['hood', { color: 0x6a0a0c }], ['cloak', { color: 0x6a0a0c, flare: 1.8 }], 'blood'] },
    { id: 'medic', name: 'Trauma Medic', price: 4000, shirt: 0xd8d4c8, pants: 0x2a3a4a, desc: 'Gas mask, plate carrier and a field medic pack. Ready for anything.', fx: [['gasmask', { color: 0x2a2e2a }], ['armor', { color: 0x3a4a3a, patch: 0xd02020 }], ['backpack', { color: 0xd8d4c8, cross: true }]] },
  ],
  eli: [
    { id: 'default', name: 'Hoodie', price: 0 },
    { id: 'overalls', name: 'Grease Monkey', price: 1500, shirt: 0x2f4a6a, pants: 0x2f4a6a, desc: 'Beanie, welding goggles and a belt full of tools.', fx: [['beanie', { color: 0x8a2a1a }], ['goggles', { color: 0x3a8a9a }], 'toolbelt'] },
    { id: 'hazard', name: 'Hazard Crew', price: 2500, shirt: 0x3a3a3a, pants: 0x2a2a2a, desc: 'Hard hat with a lamp, respirator and a hi-vis vest.', fx: [['hardhat', { color: 0xe0b020, lamp: true }], ['respirator', { filter: 0xd06020 }], ['hivis', { color: 0xf0a020 }]] },
    { id: 'midnight', name: 'Midnight Run', price: 4000, shirt: 0x14141c, pants: 0x14141c, desc: 'Hood up, hockey mask down, eyes that catch the light.', fx: [['hood', { color: 0x14141c }], ['hockey', { color: 0xe8e4d8, chevron: 0xc01a1a }], ['eyes', { color: 0x6affff }]] },
  ],
  june: [
    { id: 'default', name: 'Knit Sweater', price: 0 },
    { id: 'autumn', name: 'Autumn Coat', price: 1500, shirt: 0x8a4a20, pants: 0x2a2018, desc: 'Long wool coat, beanie and her camera.', fx: [['coat', { color: 0x6a3a1a }], ['beanie', { color: 0xa06030 }], 'camera'] },
    { id: 'ghost', name: 'Ghost Story', price: 2500, shirt: 0xdedad2, pants: 0x3a3a40, hair: 0xe8e0c8, desc: 'She went into the lake to get the photo. Something came back out.', fx: [['ghost', { color: 0xa8d8ff, op: 0.55 }], ['veil', { color: 0xdfe8ff, op: 0.4, len: 7, wide: 2.4 }], ['eyes', { color: 0x9ae0ff }]] },
    { id: 'reporter', name: 'Field Reporter', price: 4000, shirt: 0x4a5a3a, pants: 0x1c1c18, desc: 'Press vest, head torch, camera and a pack full of tapes.', fx: [['armor', { color: 0x3a4a6a, patch: 0xe8e8e8 }], 'headlamp', 'camera', ['backpack', { color: 0x3a3a2a, radio: true }]] },
  ],
  tomas: [
    { id: 'default', name: 'Ranger', price: 0 },
    { id: 'camo', name: 'Woodland Camo', price: 1500, shirt: 0x3a4a2a, pants: 0x2a3020, desc: 'Boonie hat, ghillie strips and a heavy pack.', fx: [['boonie', { color: 0x4a5236 }], ['moss', { color: 0x4a5a2a, glow: 0x000000 }], ['backpack', { color: 0x3a4228 }]] },
    { id: 'firewatch', name: 'Firewatch', price: 2500, shirt: 0xb04020, pants: 0x2a2018, desc: 'Red helmet, smoke goggles and a fire axe across his back.', fx: [['hardhat', { color: 0xb02010 }], ['goggles', { color: 0xd08020, down: true }], 'axe', ['scarf', { color: 0xd8c8a0 }]] },
    { id: 'searchlight', name: 'Search & Rescue', price: 4000, shirt: 0xd86a10, pants: 0x1a1a22, desc: 'Helmet lamp, hi-vis vest and a radio pack with a blinking beacon.', fx: [['hardhat', { color: 0xf0f0f0, lamp: true }], ['hivis', { color: 0xe8e020 }], ['backpack', { color: 0xc04010, radio: true }]] },
  ],
  butcher: [
    { id: 'default', name: 'Slaughterhouse', price: 0 },
    { id: 'freshcut', name: 'Fresh Cut', price: 2000, apron: 0xd8d0c8, desc: 'Clean whites, a hairnet and a polished cleaver. For about a minute.', fx: [['coat', { color: 0xe8e4dc }], 'hairnet', ['cleaver', { blood: true }], 'blood'] },
    { id: 'hogmask', name: 'Hog Mask', price: 3500, apron: 0x6a4a3a, desc: 'A real pig\'s head, stitched shut, and a belt of meat hooks.', fx: ['pighead', 'hooks', ['chains', { color: 0x5a5a58 }]] },
    { id: 'pale', name: 'Pale Rider', price: 6000, skin: 0x9aa0a4, mask: 0x3a3a3a, apron: 0x1a1a1a, desc: 'Skull, horns, a tattered black cloak and a scythe. Cold blue eyes.', fx: [['skull', { color: 0xd8d0c0 }], ['horns', { color: 0x141210 }], ['cloak', { color: 0x0a0a0c, tatter: true, flare: 2.4 }], ['eyes', { color: 0x6ac8ff }], ['scythe', { glow: 0x2a6aff }]], scale: 1.06 },
  ],
  wisp: [
    { id: 'default', name: 'Drowned Bride', price: 0 },
    { id: 'mourning', name: 'Mourning Veil', price: 2000, dress: 0x16161a, eye: 0xff4030, desc: 'A black veil to the floor and a crown of burning candles.', fx: [['veil', { color: 0x08080a, op: 0.85, len: 10, wide: 3.4 }], ['candles', { color: 0xffa040 }], ['claws', { both: true }]] },
    { id: 'lakemoss', name: 'Lake Moss', price: 3500, dress: 0x4a6a4a, eye: 0xb0ff60, desc: 'Weed and algae from the lake bed, glowing faintly green.', fx: [['tint', { color: 0x4a7a4a, k: 0.45, e: 0x0a3a14, ei: 0.6 }], ['moss', { color: 0x3a6a2a, glow: 0x1a5a14 }], ['eyes', { color: 0xb0ff60 }]] },
    { id: 'bloodmoon', name: 'Blood Moon', price: 6000, dress: 0x6a0a0a, eye: 0xffd040, desc: 'A crimson moon rises behind her. Long black claws.', fx: [['halo', { color: 0xff2a10 }], ['claws', { both: true, color: 0x0a0202 }], 'blood', ['eyes', { color: 0xffd040 }]] },
  ],
  harrower: [
    { id: 'default', name: 'Bone Hunter', price: 0 },
    { id: 'charred', name: 'Charred', price: 2000, bone: 0x2a2420, eye: 0xff8a20, desc: 'Burnt to the bone. Embers still glow through the cracks.', fx: [['embers', { color: 0xff5a10 }], ['eyes', { color: 0xff8a20 }]] },
    { id: 'winter', name: 'Winter Pelt', price: 3500, fur: 0xd8d4cc, bone: 0xeeeae0, eye: 0x60c0ff, desc: 'Frozen solid, crowned with antlers of clear ice, shoulders spiked with frost.', fx: ['frost', ['antlers', { ice: true, size: 1.6 }], ['spikes', { color: 0xbfe8ff }], ['eyes', { color: 0x60c0ff }]] },
    { id: 'gilded', name: 'Gilded Trophy', price: 6000, bone: 0xc8a050, fur: 0x1a1210, eye: 0xffe080, desc: 'Gold bones, a gold crown, gold chains and a gold spear.', fx: [['metal', { match: 0xc8a050 }], ['crown', { color: 0xd8b040, gem: 0xff2020 }], ['chains', { color: 0xd8b040, cross: true }], ['spear', { color: 0xd8b040 }]] },
  ],
  lamplighter: [
    { id: 'default', name: 'Lamplighter', price: 0 },
    { id: 'ember', name: 'Ember Lamp', price: 2000, lamp: 0xff8a3a, desc: 'His coat smoulders. A second lantern burns in his other hand.', fx: [['embers', { color: 0xff7a20 }], ['lamp', { color: 0xff8a3a }]] },
    { id: 'bloodlamp', name: 'Blood Lamp', price: 3500, lamp: 0xff2a2a, coat: 0x2a0a0a, desc: 'A skull for a face, a blood-red cloak and lamps that bleed light.', fx: [['skull', { color: 0xe0d0c0 }], ['cloak', { color: 0x5a0808, flare: 2.0 }], ['lamp', { color: 0xff2020 }], ['eyes', { color: 0xff2a2a }]] },
    { id: 'spectral', name: 'Spectral', price: 6000, lamp: 0x8ad0ff, coat: 0x1a2030, desc: 'Half here, half somewhere else: a translucent, glowing shade.', fx: [['ghost', { color: 0x8ad0ff, op: 0.45 }], ['halo', { color: 0x6ac8ff }], ['eyes', { color: 0x9ae0ff }]] },
  ],
  foreman: [
    { id: 'default', name: 'Night Shift', price: 0 },
    { id: 'overtime', name: 'Overtime', price: 2000, flesh: 0x9a8a88, apron: 0x2a1a14, blood: 0x6a0a06, desc: 'Hard hat and a hi-vis vest over the apron. Safety first.', fx: [['hardhat', { color: 0xe0b020, lamp: true }], ['hivis', { color: 0xf09020 }]] },
    { id: 'quota', name: 'Quota Met', price: 3500, bone: 0xc8a050, eye: 0xff3a20, desc: 'Employee of the month: a gold mask, a gold hook and gold chains.', fx: [['metal', { names: ['Foreman_8', 'Foreman_14'], color: 0xd8b040 }], ['chains', { color: 0xd8b040, cross: true }], ['crown', { color: 0xd8b040 }]] },
    { id: 'reassigned', name: 'Reassigned', price: 6000, flesh: 0x7a8a8a, bone: 0x2a2a2a, eye: 0x7affd0, apron: 0x101418, desc: 'Moved to the cold store, and never came back out. A gas-masked teal ghost in chains.', fx: [['ghost', { color: 0x7affd0, op: 0.55 }], ['gasmask', { color: 0x1a1c1e, eye: 0x7affd0, filter: 0x2a2a2a }], ['chains', { color: 0x4a4a4a }]] },
  ],
};
// ---------------- Store: chapters (DLC) ----------------
// Bought with Embers. A chapter unlocks playing as its killer; its map is free for everyone.
export const CHAPTERS = [
  { id: 'offal', num: 'V', name: 'OFFAL', sub: '× Nightbound', price: 5000, killer: 'foreman', map: 'meatworks', banner: 'offal', isNew: true,
    tagline: 'Night shift at the Hollow Pines Meatworks. Headcount must be maintained.',
    contents: ['The Foreman: Chain Hook, Lights Out and Hunts by Sound', 'Execution: Reassignment', 'Map: Hollow Pines Meatworks (free for everyone)', '3 Foreman outfits in the Store'] },
  { id: 'base4', num: 'IV', name: 'The Last Light', killer: 'lamplighter', base: true, tagline: 'Every lantern is a door. Every door leads to him.' },
  { id: 'base3', num: 'III', name: 'Trophy Season', killer: 'harrower', base: true, tagline: 'He does not chase. He collects.' },
  { id: 'base2', num: 'II', name: 'Drowned Embrace', killer: 'wisp', base: true, tagline: 'She was here first. She will be here last.' },
  { id: 'base1', num: 'I', name: 'Gravemoor', killer: 'butcher', base: true, tagline: 'Where every road leads back to the block.' },
];
export const CHAPTER_OF = Object.fromEntries(CHAPTERS.filter(c => !c.base).map(c => [c.killer, c.id]));

export const skinOf = (char, id) => (SKINS[char] || []).find(s => s.id === id) || {};

// ---------------- Inbox: version notes & gifts ----------------
export const VERSION = '2.7.0';
export const INBOX = [
  {
    id: 'v2.7', version: '2.7.0', date: 'Nov 2026', title: 'Three New Maps', tag: 'New Maps',
    gift: { embers: 1500, label: 'New maps gift: 1,500 Embers' },
    body: [
      'Blackwater Marsh: a bayou at night. Stilt shacks on board decks, boardwalks with railings, a wrecked boat to loop, cypress groves dripping with moss, black water, green fog and fireflies.',
      'Hollowmere Carnival: an abandoned fairground under a purple sky. A big-top circus tent, game booths you can vault through, a carousel, caravans, a Ferris wheel over everything and strings of coloured lights.',
      'Coldwater Pass: a frozen mountain pass. Log cabins and a lodge with snow on every edge, snow-laden pines, a frozen lake with an ice-fishing hut, a snowed-in truck and falling snow.',
      'Pick any map, or Random, in bot matches and online lobbies. All maps are free.',
    ],
  },
  {
    id: 'v2.6', version: '2.6.0', date: 'Nov 2026', title: 'Outfits That Actually Change You', tag: 'Update',
    gift: { embers: 1000, label: 'Update gift: 1,000 Embers' },
    body: [
      'Every outfit now transforms its character instead of just recolouring it: masks, helmets, hoods, veils, crowns, horns and antlers; cloaks, coats, armour, hi-vis vests, chains and packs; new weapons; and full-body effects.',
      'Highlights: the Pale Rider Butcher (skull, horns, tattered cloak, scythe), the Charred Harrower (embers glowing through cracks), Winter Pelt (ice antlers), Spectral Lamplighter and Ghost Story June (translucent ghosts), Blood Moon Wisp (a crimson halo), Reassigned Foreman (a teal ghost in a gas mask).',
      'Every outfit has a description in the Store, and the portraits show the whole look.',
    ],
  },
  {
    id: 'v2.5.1', version: '2.5.1', date: 'Nov 2026', title: 'The Meatworks, Remastered', tag: 'Update',
    gift: { embers: 500, label: 'Update gift: 500 Embers' },
    body: [
      'All-new hand-painted textures for the Meatworks: oxblood and cream wall tiles with a green trim, chipped and missing tiles, cracks, rust and damp streaks, and blood splashes that run down to the floor.',
      'Wet red quarry-tile floors with real puddle reflections, floor drains and a stained concrete ceiling.',
      'Split carcasses hanging from gambrels (with ribs and spine), tubs of offal, pipes and valves along every wall, steel door frames and plastic strip curtains, enamel signs, fluorescent tubes in the halls, light shafts under the lamps and dust hanging in the air.',
    ],
  },
  {
    id: 'v2.5', version: '2.5.0', date: 'Nov 2026', title: 'OFFAL × Nightbound', tag: 'New Chapter', banner: 'offal',
    gift: { embers: 2500, label: 'Chapter launch gift: 2,500 Embers' },
    body: [
      'New chapter: OFFAL × Nightbound. The Foreman is now a chapter you unlock in the Store (anyone who already bought one of his outfits keeps him).',
      'New map: the Hollow Pines Meatworks, ported from OFFAL. White-tiled kill floors, carcass rails, cattle pens, the Foreman\'s office, freezers and offal tanks under a low ceiling. Free for everyone, and selectable in bot matches and online lobbies.',
      'The Store has been rebuilt: Chapters, a Characters tab with portraits, outfits and a live 3D preview, and Collections that bundle every outfit for a character at 25% off.',
      'Fixed: the web version could show "The fog won\'t lift" while it was still downloading. It now loads about 3x faster and shows a loading screen.',
    ],
  },
  {
    id: 'v2.4', version: '2.4.0', date: 'Nov 2026', title: 'Flashlights & Smooth Online', tag: 'Update',
    gift: { embers: 2000, label: 'Update gift: 2,000 Embers' },
    body: [
      'Flashlights: every survivor carries one. Hold RMB and keep the beam on the killer\'s face to blind and stun him, and free a friend he is carrying. 12s of battery, and he is immune for a while after a blind.',
      'Online play rebuilt: other players now move smoothly instead of stuttering, snapshots are 4x smaller (much kinder to the relays), lag spikes no longer desync your position, and killer hits are lag-compensated.',
      'Died with bots still in the match? Press T to take over a bot survivor and keep playing, offline or online.',
      'The Foreman now uses his real rigged model, with his own idle, walk, stalk, run, attack, grab and stun animations.',
      'Death Warrant removed: no more executing survivors on their first down. It is replaced by Iron Grip (carried survivors struggle free 30% slower).',
    ],
  },
  {
    id: 'v2.3', version: '2.3.0', date: 'Nov 2026', title: 'Chains, Blood & a Steady Camera', tag: 'Update',
    gift: { embers: 1500, label: 'Update gift: 1,500 Embers' },
    body: [
      'The Foreman reworked. Chain Hook (RMB): fling your hook to reel a survivor in, or catch a wall and yank yourself across.',
      'Lights Out moved to R: 9s of darkness where one strike of the hook puts a survivor down.',
      'Hunts by Sound is now always on: survivors running near the Foreman ping their position.',
      'Gore overhaul: wet blood pools and splatters that dry over time, directional blood spray, drag trails from the dying, visible wounds and bloodied weapons.',
      'Fixed: the killer camera could suddenly snap or flip while turning.',
    ],
  },
  {
    id: 'v2.2', version: '2.2.0', date: 'Nov 2026', title: 'The Meatworks Crossover', tag: 'Crossover',
    gift: { embers: 3000, label: 'Crossover gift: 3,000 Embers' },
    body: [
      'The Foreman has clocked in. The night-shift horror from OFFAL joins the roster as the fifth killer.',
      'Lights Out (power): every light on the map dies, the fog closes in and he goes silent.',
      'Hunts by Sound: in the dark, anyone running near him is revealed, and one hit from his hook puts you down.',
      'New execution: Reassignment. Headcount must be maintained.',
      'Map overhaul: new forest, worn dirt paths, weathered walls, lamp posts, rolling ground fog and moonlit clouds.',
      'The Store is open: buy skins for every survivor and killer with Embers.',
      'This Inbox now tells you what changed in every version.',
    ],
  },
  {
    id: 'v2.1', version: '2.1.0', date: 'Nov 2026', title: 'Smarter Bots & Real Faces', tag: 'Update',
    body: [
      'Character models rebuilt: sculpted bodies, hands with fingers, faces with eyes, lips and expression.',
      'Survivor bots loop walls and trees, vault, drop barricades on you and rescue each other.',
      'Killer bots predict where you run, listen for footsteps, search where they lost you and stop camping cages.',
      'Online play: direct WebRTC connection with an automatic relay fallback. Works without a server.',
      'Fixed: killer mouse look was inverted.',
      'Executions now need two prior cagings (or the last survivor alive).',
    ],
  },
  {
    id: 'v2.0', version: '2.0.0', date: 'Nov 2026', title: 'The Lamplighter & a New Look', tag: 'Update',
    body: [
      'New killer: The Lamplighter, with cursed lanterns and Shadow Step.',
      'Every killer got a unique feature: Gore Trail, Ambush & Frost, Trophy Mark.',
      'Brand-new campfire main menu, HUD and icons.',
      'Proper attack animations: wind-up, swing, blade wipe and miss stumble.',
      'Graphics presets down to Very Low with dynamic resolution for older laptops.',
    ],
  },
  {
    id: 'v1.0', version: '1.0.0', date: 'Nov 2026', title: 'Nightbound Launches', tag: 'Launch',
    gift: { embers: 1000, label: 'Welcome gift: 1,000 Embers' },
    body: [
      'One killer, four survivors, seven generators and a long night.',
      'Three killers with unique executions, 21 perks, bot matches and online lobbies.',
    ],
  },
];
