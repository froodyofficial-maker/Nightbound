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
  warrant:    { name: 'Death Warrant', icon: '✠', desc: 'You may execute ANY downed survivor (F), not only those who have already been caged twice.' },
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
