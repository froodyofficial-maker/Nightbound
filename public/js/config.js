// Game tuning + content definitions (shared by host, clients and bots)

export const HALF = 56;                 // map spans -HALF..HALF on x and z
export const TICK = 1 / 60;
// bump when host and clients can no longer understand each other's network messages
export const NET_PROTOCOL = 11;
export const SNAP_RATE = 30;            // snapshots per second sent to clients (relay players get ~15)

export const SPEED = {
  walk: 2.3, run: 4.0, crouch: 1.15, crawl: 0.75,
  hitBoost: 1.5, hitBoostTime: 1.8,
  killer: 4.6, carry: 4.2, aimSlow: 0.55,
};

// Survivor items. Flashlight and Ghost Trap can be brought in; everything can turn up in a chest.
// The Taser only comes out of chests (20% of them): 3 shots, each one locks the killer up for 3s.
export const ITEMS = {
  flashlight: { name: 'Flashlight', desc: 'Hold RMB to shine it in the killer\'s eyes.' },
  trap: { name: 'Ghost Trap', desc: 'Set it down in front of you; the killer who steps on it is stunned.' },
  taser: { name: 'Taser', shots: 3, stun: 3, range: 9, chance: 0.2, desc: 'Click RMB to fire: a killer you hit is electrocuted and frozen for 3s. 3 shots. Only found in chests.' },
};
export const RULES = {
  genCharges: 66,          // seconds of solo repair per generator
  gensTotal: 7,
  healTime: 14,            // seconds to heal a teammate one health state
  pickupTime: 1.4,         // killer picks up a downed survivor
  cageTime: 1.1,           // killer hangs a survivor on a hook
  rescueTime: 1.2,
  gateTime: 18,
  kickTime: 1.8,
  breakTime: 2.4,
  bleedout: 200,
  cageStage: [60, 60],     // hook phases: 60s hanging, then 60s struggling against the Entity; hooked in the struggle phase = sacrificed
  selfUnhook: 0.04,        // chance per self-unhook attempt (3 attempts, first phase only)
  selfUnhookCost: 8,       // hook seconds lost per failed attempt
  struggleMiss: 9,         // hook seconds lost per missed struggle skill check
  wiggleNeed: 1,           // wiggle progress needed to escape the killer's grip
  wiggleRate: 0.006,       // progress per alternating keypress (~30s of struggling)
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
  chestTime: 2.2, swapTime: 0.4,                                          // searching a chest, swapping items with it
  teleTime: 1.2, teleCd: 18, lanternRadius: 9, snuffTime: 2.5,           // length of a killer's execution finisher
};

// ---------------- Game modes ----------------
export const MODES = {
  classic: { name: 'Classic', short: '1 vs 4', desc: 'One killer, four survivors. Repair generators, power the gates and escape.' },
  duo: { name: 'Two Killers', short: '2 vs 8', killers: 2, survivors: 8, desc: 'Two killers hunt eight survivors. Six generators power the gates.' },
  dark: { name: 'Lights Out', short: 'Horror', desc: 'The lights never come on. Thick fog, no auras for survivors, half-charged flashlights.' },
  rush: { name: 'Survivor Rush', short: '5 min', time: 300, desc: 'Five-minute matches. Generators and gates go twice as fast, and the killer gets a burst of speed after every hit. When the clock runs out, the gates power up and the night collapses fast.' },
  glass: { name: 'Glass Bones', short: 'One hit', desc: 'Every hit puts a survivor straight down. To make up for it, generators repair 40% faster. One mistake and you are on the floor.' },
  adrenaline: { name: 'Adrenaline', short: 'Fast', desc: 'Everyone moves 30% faster, generators and exit gates go 25% faster, and killer powers recharge 40% faster. Chases are frantic.' },
  bloodmoon: { name: 'Blood Moon', short: 'Tasers', desc: 'A red moon over the map. Every 45 seconds the killer sees every survivor for 4 seconds, but every survivor starts with a 2-shot Taser instead of their item.' },
  infection: { name: 'Infection', short: '2 vs 10', killers: 2, survivors: 10, bigMap: true, desc: 'No hooks. Two killers, ten survivors, on big maps built for it. Downed survivors rise as killers a few seconds later, and every 60s the infected sense every survivor. Escape through the gates, or be the last survivor standing and survive a 45-second last stand.' },
};
// killers an infected survivor can turn into
export const INFECT_POOL = ['butcher', 'wisp', 'harrower', 'lamplighter', 'slimer', 'bateman', 'chucky'];

export const POSSESS_MAX = 66; // Chucky can stay in a survivor's body for 1.1 minutes
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
  slimer: {
    id: 'slimer', name: 'The Slimer', speed: 4.6, terror: 20, weapon: 'Ectoplasm', crossover: 'Ghostbusters (fan-made)',
    lore: 'A starving green ghost who ate everything in the hotel kitchen. Then he started on the guests.',
    exec: { name: 'Slimed', desc: 'Swallows the survivor whole, then spits out what is left.' },
    ability2: { name: 'Ghost Phase', key: 'R', cooldown: 16, duration: 2.5, desc: 'Turn see-through and float straight through walls for 2.5s.' },
    ability: { name: 'Slime Spit', cooldown: 7, max: 4, desc: 'Spit a glob of ectoplasm at the survivor in front of you (up to 14m): a hit slimes them on the spot and leaves a puddle (up to 4). Survivors who are slimed are slowed by 30% and revealed to you for 3s.' },
    feature: { name: 'Ectoplasmic', desc: 'He floats: no footsteps and only a 20m terror radius. Press R for Ghost Phase: float through walls for 2.5s (16s cooldown).' },
    color: 0x7aff4a,
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
  chucky: {
    id: 'chucky', name: 'Chucky', speed: 4.6, terror: 20, weapon: 'Kitchen Knife', crossover: "Child's Play (fan-made)", tpv: true,
    lore: 'A Good Guy doll with the soul of a strangler inside. He is two and a half feet tall and he does not stop laughing.',
    exec: { name: 'Friends Till the End', desc: 'Leaps onto the survivor\'s chest and stabs, and stabs, and stabs.' },
    ability: { name: 'Pounce', cooldown: 5, min: 3, max: 10, coil: 0.8, desc: 'Hold to coil (at full speed), release to leap up to 10m: the longer you coil, the farther you fly. He sails over fences, pallets and other low obstacles. Landing on a survivor strikes them. Leaping into a wall stuns you.' },
    ability2: { name: "Chucky's Laugh", key: 'R', cooldown: 35, radius: 28, reveal: 5, desc: 'Laugh. Every survivor within 28m hears it and is revealed to you for 5s.' },
    feature: { name: 'Tiny Terror & Possession', desc: 'Doll-sized and hard to spot: a 20m terror radius and silent footsteps. Space to jump over windows, pallets and rocks. Possession (G, once every 10 minutes): take over a downed survivor in secret. They wander as an invisible ghost, your doll is left as a harmless decoy, and you can let go once you have downed and hooked someone. Soul Split (V, once, with one generator left): jump into a spare doll lying on the map; your old body keeps hunting as a bot that can down survivors but not hook them. Played in third person.' },
    color: 0xd83a22,
  },
  granny: {
    id: 'granny', name: 'Granny', speed: 4.7, terror: 32, weapon: 'Baseball Bat', crossover: 'Granny (fan-made)',
    lore: 'She has kept you in her house for five days. She hears every creak of the floorboards, and she does not like guests leaving early.',
    exec: { name: 'Bedtime Trap', desc: 'Forces the survivor to their knees, sets a bear trap in front of them, and shoves their face into it.' },
    shotgun: { name: 'Shotgun', cooldown: 2.2, raise: 0.3, range: 45, minDmg: 6, maxDmg: 36, near: 2.5, far: 22.5 },
    ability: { name: 'Bat Rush', cooldown: 8, minCharge: 0.25, maxCharge: 1.0, minDist: 3, maxDist: 8, speed: 13, turn: 2.4, palletBonus: 2, slamRadius: 2.6, slamGen: 0.1, wallStun: 0.9, desc: 'Hold to wind up the bat (slowed), release to charge: the longer you hold, the further she goes, with no limit (3m, 8m at one second, and on). Steer the charge with the mouse. She crashes straight through windows and smashes dropped pallets (each one carries her 2m further), and strikes the first survivor in her way; a Heard survivor goes straight down. Fully wound up, the charge ends in a Ground Slam: everyone around her is struck and a nearby generator is damaged. Charging into a wall stuns her.' },
    ability2: { name: 'I Hear You', key: 'R', cooldown: 25, reveal: 6, heard: 15, desc: 'Stop and listen. Every survivor who is running, repairing, healing or unhooking anywhere on the map is revealed for 6s and Heard for 15s: her next hit on a Heard survivor puts them straight down.' },
    teleport: { name: 'Creep', key: 'G', cooldown: 25, time: 1.2, haste: 3, desc: 'Hold G: every window, pallet, generator and hook on the map is marked. Release to vanish and reappear at the one in your sights, with a short burst of speed.' },
    swap: { name: 'Body Swap', key: 'V', cooldown: 6, desc: 'Switch bodies with Spider Mom, any time: Granny appears where Spider Mom was, and Spider Mom where Granny stood. Hold V to look through Spider Mom\'s eyes first, release to swap.' },
    feature: { name: 'Sharp Ears & Spider Mom', desc: 'She hears everything: survivors who run within 22m of her are revealed, and a failed skill check is heard anywhere. Spider Mom crawls between the generators; anyone she finds repairing is shown to Granny and webbed (slowed for 3s).' },
    color: 0xd8d0c0,
  },
  bateman: {
    id: 'bateman', name: 'Patrick Bateman', speed: 4.7, terror: 28, weapon: 'Axe', crossover: 'American Psycho (fan-made)',
    lore: 'Vice president at Pierce & Pierce. Impeccable taste, a flawless skincare routine, and an axe in his briefcase.',
    exec: { name: 'Hip to Be Square', desc: 'Puts on his raincoat, lectures the survivor about Huey Lewis, then swings the axe.' },
    ability: { name: 'Chainsaw Toss', cooldown: 2.5, aim: 0.35, range: 24, back: 8, desc: 'Hold to aim (slowed), release to hurl your chainsaw. A hit puts a survivor straight down. Walk over it to pick it up, or it flies back to your hand after 8s.' },
    ability2: { name: 'Business Card', key: 'R', cooldown: 18, range: 16, desc: 'Show your card. Survivors within 16m in front of you are intimidated: revealed and slowed by 20% for 5s.' },
    feature: { name: 'Morning Routine', desc: 'After every hit, a 4s burst of +12% speed. Survivors he has intimidated leave him a trail: they stay revealed while they run.' },
    color: 0xc01a1a,
  },
};

export const SURVIVORS = {
  mara:  { id: 'mara',  name: 'Mara Voss',   skin: 0xe2b896, hair: 0x2b1a12, shirt: 0x8a2f2a, pants: 0x2c3442, hairStyle: 'long' },
  eli:   { id: 'eli',   name: 'Eli Okafor',  skin: 0x7a4e32, hair: 0x111111, shirt: 0x3c5e3a, pants: 0x3a3226, hairStyle: 'short' },
  june:  { id: 'june',  name: 'June Harlow', skin: 0xf1cfb4, hair: 0xc99b4a, shirt: 0x3a5f8a, pants: 0x222831, hairStyle: 'bun' },
  tomas: { id: 'tomas', name: 'Tomás Reyes', skin: 0xc08a5e, hair: 0x2a1d14, shirt: 0x6b5a3a, pants: 0x1f2a24, hairStyle: 'cap' },
  // Ghostbusters fan-made crossover
  raghuvir: { id: 'raghuvir', name: 'Raghuvir', skin: 0xb08058, hair: 0x0e0a08, shirt: 0xb8a878, pants: 0xb0a070, hairStyle: 'short', big: true, gb: true },
  abeer: { id: 'abeer', name: 'Abeer', skin: 0xa87650, hair: 0x120c08, shirt: 0xb8a878, pants: 0xb0a070, hairStyle: 'short', gb: true },
  // Marvel fan-made crossover (model: "Spiderman_topy" by sabra, sketchfab.com/sabrayf, CC BY 4.0)
  spiderman: { id: 'spiderman', name: 'Spider-Man', skin: 0x8a1418, hair: 0x8a1418, shirt: 0x9a1a1e, pants: 0x1a2040, hairStyle: 'short', fan: true,
    // limited: 500,000 Embers, in the Store until the end of 7 Nov 2026 (UTC), then gone for good
    limited: { price: 500000, until: Date.UTC(2026, 10, 8, 0, 0) }, hookEscapes: 5, hookChance: 0.3,
    web: { name: 'Web Shooters', shots: 4, range: 20, slow: 0.45, time: 4, carryTime: 2.5, cd: 0.6, desc: 'Press R to fire a web where you aim (4 shots, 20m). A webbed killer is slowed by 55% for 4s; a killer carrying someone is forced to drop them.' } },
};

export const SURV_PERKS = {
  steady:   { name: 'Steady Hands', icon: '✋', desc: 'Calibration checks have a 40% larger success zone. Perfect checks grant +2% extra progress.' },
  medic:    { name: 'Field Medic',  icon: '✚', desc: 'Heal others 30% faster. You can heal yourself (hold E with no target) at 50% speed.' },
  hushed:   { name: 'Hushed',       icon: '☾', desc: 'Your footsteps and pained breathing are silent. Crouch speed +25%.' },
  sixth:    { name: 'Sixth Sense',  icon: '◉', desc: 'Every 25 seconds the killer\'s aura is revealed to you for 4 seconds.' },
  shared:   { name: 'Shared Labor', icon: '⚙', desc: '+15% repair speed for each other survivor working on the same generator.' },
  lockpick: { name: 'Quick Release', icon: '⚿', desc: 'Unhook survivors twice as fast. Open exit gates 30% faster.' },
  lastwind: { name: 'Last Wind',    icon: '➶', desc: 'When unhooked or picked up from the ground, gain +40% speed for 5 seconds.' },
  acrobat:  { name: 'Acrobat',      icon: '⤴', desc: 'Vault windows and barricades 30% faster.' },
  resolve:  { name: 'Resolve',      icon: '♥', desc: 'Struggle free from the killer 40% faster. Bleed out 50% slower and crawl 30% faster.' },
  fleet:    { name: 'Fleet Foot',   icon: '»', desc: 'While injured, run 7% faster. Your post-hit speed burst lasts 50% longer.' },
  // character-exclusive perks: only that survivor can equip them
  triage:      { name: 'Triage',      only: 'mara',     desc: 'Help a dying survivor back up twice as fast.' },
  overclock:   { name: 'Overclock',   only: 'eli',      desc: 'When a generator you are repairing is finished, the nearest unfinished generator jumps ahead by 10%.' },
  exposure:    { name: 'Exposure',    only: 'june',     desc: 'Blinding the killer with your flashlight reveals the killer\'s aura to every survivor for 6 seconds.' },
  pathfinder:  { name: 'Pathfinder',  only: 'tomas',    desc: 'You always see the exit gates\' auras, and open them 40% faster.' },
  containment: { name: 'Containment', only: 'raghuvir', desc: 'Carry one extra Ghost Trap. Your traps stun the killer for 4 seconds instead of 2.6.' },
  exorcist:    { name: 'Exorcist',    only: 'abeer',    desc: 'You cannot be possessed. A survivor body Chucky has possessed shows up to you in purple within 20m.' },
};

export const KILLER_PERKS = {
  scent:      { name: 'Scent of Fear', icon: '☠', desc: 'Injured survivors within 24m have their auras revealed to you.' },
  static:     { name: 'Static Sense',  icon: 'ϟ', desc: 'Survivors repairing a generator are revealed to you.' },
  overload:   { name: 'Overload',      icon: '✸', desc: 'Kicking a generator instantly removes 8% progress, and it regresses 50% faster.' },
  relentless: { name: 'Relentless',    icon: '⟳', desc: 'Recovery after a successful strike is 35% shorter.' },
  dread:      { name: 'Dread',         icon: '♒', desc: 'Terror radius +8m. Survivors inside your terror radius repair 10% slower.' },
  brute:      { name: 'Brute',         icon: '⚒', desc: 'Break barricades and kick generators 35% faster.' },
  rust:       { name: 'Rusted Hooks',  icon: '⛓', desc: 'Hook timers run 20% faster and unhooking a survivor takes twice as long.' },
  sentry:     { name: 'Sentry',        icon: '◎', desc: 'When a generator is completed, the survivors who finished it are revealed for 6 seconds.' },
  fury:       { name: 'Endgame Fury',  icon: '♨', desc: 'Once the exit gates are powered, gain +8% movement speed.' },
  irongrip:   { name: 'Iron Grip',     icon: '✠', desc: 'Survivors you carry struggle free 30% slower.' },
  stalker:    { name: 'Stalker',       icon: '◐', desc: 'Terror radius -14m. Your lunge reaches 20% farther.' },
};

// perk prices in Embers (perks not listed are free); exclusive perks cost 2,500
export const PERK_PRICES = {
  medic: 1500, hushed: 1500, sixth: 2000, lockpick: 1500, acrobat: 1500, resolve: 2000, fleet: 2000,
  triage: 2500, overclock: 2500, exposure: 2500, pathfinder: 2500, containment: 2500, exorcist: 2500,
  static: 1500, dread: 1500, brute: 1500, rust: 2000, sentry: 2000, fury: 1500, irongrip: 2000, stalker: 2500,
};
export const PERK_SLOTS = 4;
// ---------------- Sidekicks (cosmetic companions, for survivors and killers) ----------------
export const SIDEKICKS = {
  ted: { name: 'Ted', price: 4000, desc: 'A foul-mouthed teddy bear who came to life and never grew up. He follows you everywhere, cheers you on, panics when you get hurt, and whenever you repair a generator, get hooked or die, he pulls up a camping chair next to you with a beer and his bong.' },
  rosy: { name: 'Rosy', price: 2500, desc: 'A loyal little rose-coloured dog. Trots at your heels, wags when things go well, runs in circles when they don\'t, and lies down beside you if you fall.' },
};
export const DEFAULT_SURV_PERKS = ['steady', 'shared', 'lastwind'];
export const DEFAULT_KILLER_PERKS = ['scent', 'overload', 'relentless'];

export const BOT_NAMES = ['Ash', 'Rook', 'Wren', 'Sable', 'Kit', 'Moss', 'Vale', 'Quill', 'Hollis', 'Briar', 'Fen', 'Lark'];

export const DIFFICULTY = {
  easy:   { react: 0.9, skill: 0.75, great: 0.05, aim: 0.4, killerSpeed: 0.93, sight: 22, reach: 2.2 },
  normal: { react: 0.5, skill: 0.9, great: 0.15, aim: 0.6, killerSpeed: 0.95, sight: 28, reach: 2.3 },
  hard:   { react: 0.25, skill: 0.96, great: 0.3, aim: 0.92, killerSpeed: 1.0, sight: 38, reach: 2.9 },
};

// ---------------- Lore (shown on the Loadout screen and in the Store) ----------------
export const LORE = {
  mara: { title: 'The Medic Who Stayed', story: [
    'Mara Voss spent eleven years on an ambulance crew in a town where the night shift never ended. She learned to keep her hands steady and her voice low, and to never, ever look at the clock.',
    'The call came in at 3:12 a.m.: a crash on the moor road, four injured. She found the car wrapped around an oak, engine still running, and nobody inside. Just a trail of red handprints leading into the fog.',
    'She followed it. She always follows it. Somewhere out there, the Entity keeps sending her patients, and Mara keeps patching them up, knowing full well it only wants them fresh for the next hunt.',
  ] },
  eli: { title: 'Grease and Grit', story: [
    'Eli Okafor could fix anything with an engine: tractors, ferries, a 1962 Cadillac nobody else would touch. His garage on the edge of Gravemoor was the last stop before the highway, and the first one back.',
    'One winter a customer left a car with a note on the dash: Do not drive it at night. Eli drove it at night. The headlights showed him roads that were not on any map, and when the engine finally died, the generators of the Entity\'s realm were humming all around him.',
    'He has stopped asking how they work. He just knows they want to run, and that every one he brings to life is a door creaking open somewhere.',
  ] },
  june: { title: 'The Last Photograph', story: [
    'June Harlow made her name chasing stories nobody else wanted: missing hikers, ghost towns, a lake where the ice never quite froze. Her editor called her fearless. Her mother called her reckless. They were both right.',
    'Her final assignment was a roll of film found in a hiker\'s abandoned tent. Thirty-six frames, all of the same treeline, each one a little closer. The thirty-sixth frame showed a lantern, and a hand reaching for the camera.',
    'She went back to take the thirty-seventh. Now she keeps shooting, frame after frame, convinced that if she gets the right picture she can show the world exactly where everyone went.',
  ] },
  tomas: { title: 'Ranger of the Lost Trails', story: [
    'Tomás Reyes walked the moor trails for twenty years as a park ranger. He knew every stone, every bog, every shortcut. He pulled lost hikers out of the fog more times than he could count.',
    'Then the trails began to change. A path he had walked a thousand times went on for three days. A cabin he had built himself appeared on a hill it had never stood on. The radio only played whispers.',
    'He is still on duty. He still counts the survivors at every campfire, still marks the safe routes in chalk. The marks are always gone by morning, but he draws them again anyway.',
  ] },
  raghuvir: { title: 'The Founder', story: [
    'Started the entire Ghostbusters business. It fell into shambles, since after the Ghostbusters\' success of saving the world, nobody needed them anymore. When ghosts started re-appearing, it was too late. Raghuvir had gotten possessed.',
    'Thankfully, Abeer was able to force the demon to un-possess him. Unfortunately, once both were united, a portal opened up, and the entity grabbed both, pulling them into the realm of Nightbound.',
    'Somewhere, in some alternate universe, things went differently. They were saved. But the entity? It can warp reality to get what it wants.',
  ] },
  spiderman: { title: 'The Wall-Crawler', story: [
    'One night the city went quiet. No sirens, no traffic, no lights in the windows. Peter swung toward the only light left: a campfire burning on a rooftop that should not have been there.',
    'When he landed, the rooftop was a clearing in the woods and the skyline was gone. His spider-sense has not stopped buzzing since.',
    'Here nobody needs saving from a mugger. They need someone fast enough to pull them off a killer\'s shoulder. He only has a few cartridges of web fluid left, so he makes every shot count.',
  ] },
  abeer: { title: 'The Partner', story: [
    'Was with the Ghostbusters ever since it had started. After the business fell into shambles, and Raghuvir got possessed, he ended up un-possessing Raghuvir.',
    'However, the entity pulled both into the realm of Nightbound.',
  ] },
  butcher: { title: 'The Man Who Never Clocked Out', story: [
    'Before the fog, he was the foreman of the Gravemoor slaughterhouse: a big, quiet man who started before dawn and left after dark. The town ate well because of him, and never asked what kept the cleaver so sharp.',
    'When the plant closed he kept coming in. He kept working. The lights were shut off and the doors were chained, and still the townsfolk heard the cleaver at night, slow and steady, like a heartbeat.',
    'The Entity did not have to take him. It simply opened a door, and he walked through with his apron on, ready for his shift.',
  ] },
  wisp: { title: 'The Drowned Bride', story: [
    'Her name was Elinor, and she was to be married on the shore of Gravemoor Lake on the first day of spring. The groom never came. She waited on the dock in her white dress until the ice gave way beneath her.',
    'They never found her body. They found frost on the windows of every house in the village, in the shape of a hand, and they heard a woman singing under the ice.',
    'She is still waiting for someone to come for her. When the air turns cold and your breath fogs, she has decided it is you.',
  ] },
  harrower: { title: 'The Collector', story: [
    'He was the greatest hunter the old country ever produced, a man who took a trophy from every kill and hung it in a hall of bone. Kings paid him. Wolves fled him. He grew bored.',
    'He went looking for prey worth his time and followed a white stag into the fog. The stag led him to a realm where the prey runs forever, heals forever and never stops being afraid.',
    'He wears the antlers of the stag now. Every survivor he marks is a trophy he has not yet hung, and he is very patient.',
  ] },
  lamplighter: { title: 'Keeper of the Moor Road', story: [
    'For forty years, old Silas lit the lamps along the moor road so travellers would not lose their way in the fog. He knew each lamp by name. He knew each traveller by the sound of their footsteps.',
    'One night the lamps would not light. Silas walked the road with his pole until dawn, and dawn did not come. When the green flame finally caught, it lit a road that went somewhere else.',
    'He still guides travellers. He simply guides them to him. Every lantern he hangs is a promise: wherever you run in the dark, he can step out of the light beside you.',
  ] },
  slimer: { title: 'The Hungry Ghost', story: [
    'A fan-made crossover. A green, gluttonous spirit from the Ghostbusters\' world, once trapped and contained. When their business collapsed and the containment unit went dark, he was the first one out.',
    'He ate his way through a hotel kitchen, then a city, then the walls between worlds, and fell straight into the Entity\'s realm. He found it full of frightened people who had never seen a ghost.',
    'He has never been happier. The Entity feeds him, the survivors run, and somewhere out there two old Ghostbusters are still carrying proton packs. He would very much like to say hello.',
  ] },
  foreman: { title: 'Headcount Must Be Maintained', story: [
    'From the OFFAL crossover chapter. The Hollow Pines Meatworks ran three shifts a day, and the Foreman made sure every one of them was full. Late workers were reassigned. Nobody was quite sure where.',
    'The night the plant burned, every worker on the floor was counted, and the count came up short. The Foreman went back inside to find the missing ones. He never came out.',
    'He is still on the clock, hunting by sound and by light, dragging stragglers back to the line. The quota is never met. It never will be.',
  ] },
  granny: { title: 'Five Days', story: [
    'A fan-made crossover. Nobody knows how long she has lived in the old house by the moat, only that the people who wake up in it have five days to find their way out, and that she hears every one of them try.',
    'She walks the halls with a bloody bat, comes out of nowhere wherever the floor creaks, and stops dead when she hears a door or a dropped plate. Her husband keeps the cellar. And the thing in the attic she calls Spider Mom keeps watch over the generators, and lends Granny her body whenever she asks.',
    'The Entity did not have to take her anywhere. It simply moved the house. Now the guests are survivors, the trial is her home, and the rules have not changed: be quiet, and do not look at the girl in the white dress.',
  ] },
  chucky: { title: 'Friends Till the End', story: [
    'A fan-made crossover. A Good Guy doll carrying the soul of a strangler who learned a little voodoo and would not stay dead. He has been burned, shot, melted and buried, and every time he has found another body to come back in.',
    'The Entity found him in a toy factory furnace, still laughing, and offered him a place where the playtime never ends. He said yes before it had finished asking.',
    'Survivors underestimate him because he is small. That is exactly what he wants. He can hide in their bodies, split his soul between dolls, and he will always, always come back for one more game.',
  ] },
  bateman: { title: 'Mergers and Acquisitions', story: [
    'A fan-made crossover. Vice president at Pierce & Pierce in the late eighties, with a flawless morning routine, an impeccable wardrobe, a business card with a tasteful thickness and a hobby nobody at the office believed.',
    'The Entity did not need to warp reality to take him. It only had to show him a place where every confession is forgotten, every victim comes back, and nobody ever asks him to return the videotapes.',
    'He treats the trials like a deal: precise, professional, and slightly bored. He would like you to know his card has a watermark.',
  ] },
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
  raghuvir: [
    { id: 'default', name: 'Ghostbuster', price: 0, desc: 'Khaki flight suit, proton pack, name tag. Who you gonna call?', fx: [['face', { kind: 'r', skin: 0xb08058 }], 'fringehair', 'specs', ['protonpack', {}], ['nametag', {}], ['wand', {}]] },
    { id: 'street', name: 'Beige Puffer', price: 1500, shirt: 0xb8a48a, pants: 0x1a1a1e, desc: 'Off duty: beige puffer jacket with a black hood and sleeves.', fx: [['face', { kind: 'r', skin: 0xb08058 }], 'fringehair', 'specs', ['puffer', { color: 0xb8a48a }]] },
    { id: 'realism', name: 'Realism', price: 6000, glb: 'ray', desc: 'A fully realistic Ghostbuster: worn khaki flight suit, straps, name patch and a heavy proton pack. (Model: "Ghostbusters - Dr. Ray Stantz" by spinningblade, CC BY 4.0.)' },
    { id: 'slimed', name: 'Slimed', price: 3500, desc: 'He got slimed. It glows.', fx: [['face', { kind: 'r', skin: 0xb08058 }], 'fringehair', 'specs', ['protonpack', {}], ['wand', {}], ['tint', { color: 0x8aff6a, k: 0.35, e: 0x2a8a1a, ei: 0.5 }]] },
  ],
  spiderman: [
    { id: 'default', name: 'Classic Suit', price: 0, glb: 'spiderman', desc: 'Red and blue, raised webbing, silver lenses. Your friendly neighbourhood Spider-Man. (Model: "Spiderman_topy" by sabra, CC BY 4.0.)' },
  ],
  abeer: [
    { id: 'default', name: 'Ghostbuster', price: 0, desc: 'Khaki flight suit, proton pack, name tag. Ready to bust.', fx: [['face', { kind: 'a', skin: 0xa87650 }], 'mophair', ['protonpack', {}], ['nametag', {}], ['wand', {}]] },
    { id: 'street', name: 'Navy Jacket', price: 1500, shirt: 0x161c30, pants: 0x1a1c22, desc: 'Off duty: navy hooded jacket with a red stripe.', fx: [['face', { kind: 'a', skin: 0xa87650 }], 'mophair', ['stripe', { color: 0xc01e1e }]] },
    { id: 'slimed', name: 'Slimed', price: 3500, desc: 'Covered in ectoplasm, faintly glowing.', fx: [['face', { kind: 'a', skin: 0xa87650 }], 'mophair', ['protonpack', {}], ['wand', {}], ['tint', { color: 0x8aff6a, k: 0.35, e: 0x2a8a1a, ei: 0.5 }]] },
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
  slimer: [
    { id: 'default', name: 'Kitchen Raider', price: 0 },
    { id: 'ectoblue', name: 'Ecto Blue', price: 2500, desc: 'A rarer, colder spirit: icy blue ectoplasm.', fx: [['tint', { color: 0x4aa8ff, k: 0.7, e: 0x0a3a8a, ei: 0.8 }]], tintGlb: { color: 0x9ad0ff, k: 1, emissive: 0x1a5aff, ei: 0.55 } },
    { id: 'golden', name: 'Golden Glutton', price: 5000, desc: 'He ate the hotel safe. Solid gold, still hungry.', fx: [['tint', { color: 0xe8c040, k: 0.75, e: 0x5a3a00, ei: 0.5 }], ['crown', { color: 0xd8b040, gem: 0x40ff40 }]], tintGlb: { color: 0xffe080, k: 1, emissive: 0x8a5a00, ei: 0.6 } },
  ],
  chucky: [
    { id: 'default', name: 'Good Guy', price: 0, desc: 'Denim overalls, striped shirt, red hair and a kitchen knife. Hi, I\'m Chucky. Wanna play?' },
    { id: 'charred', name: 'Burnt Out', price: 2500, tint: 0x141210, tintK: 0.88, glow: 0x6a1400, glowK: 0.12, desc: 'Pulled from the toy factory fire. Charred black and still smouldering.' },
    { id: 'voodoo', name: 'Voodoo', price: 4500, tint: 0x7aff8a, tintK: 0.3, glow: 0x0a6a1a, glowK: 0.7, desc: 'Ade due Damballa. A sickly green glow from the inside.' },
    { id: 'slappy', name: 'Slappy', price: 6000, slappy: true, desc: 'The ventriloquist\'s dummy who talks back. His own body, his own stiff, puppet-like moves, and an iron-banded wooden mallet instead of the knife. (Model: "slappy_animations" by Howard the Lipscomb, CC BY 4.0.)' },
  ],
  granny: [
    { id: 'default', name: 'House Dress', price: 0, desc: 'Her grey nightgown, her bloody bat, and the stare. You know the one.' },
    { id: 'bloodbath', name: 'Spring Cleaning', price: 3000, tint: 0x8a1010, tintK: 0.35, desc: 'She has been busy. Most of the red is not hers.' },
    { id: 'grandpa', name: 'Grandpa', price: 25000, god: true, grandpa: true, desc: 'GOD TIER: changes how you play. Her husband takes the shift with his shotgun: hold RMB to raise it, release to fire (replaces Bat Rush). Survivors get a second health bar against him: three long-range shots put anyone down, but up close the spread barely scratches them. The farther the shot, the harder it hits.' },
    { id: 'ghost', name: 'Pale Visitor', price: 4500, tint: 0xd8e4f0, tintK: 0.5, glow: 0x6a8aa8, glowK: 0.35, desc: 'Drained of colour, glowing faintly, like something that stayed in the house long after it should have left.' },
  ],
  bateman: [
    { id: 'default', name: 'Pierce & Pierce', price: 0, desc: 'Charcoal pinstripe double-breasted suit, crisp white shirt, red silk tie and a cigar. Valentino Couture.' },
    { id: 'raincoat', name: 'Hip to Be Square', price: 2500, rain: true, desc: 'A clear plastic raincoat over the suit, for the mess. Newspaper on the floor optional.' },
    { id: 'morning', name: 'Morning Routine', price: 3000, suit: 0xf2efe8, shirt: 0xf2efe8, tie: 0xf2efe8, mask: 0xd8ead0, desc: 'White robe, herb-mint facial mask and a Walkman. Ice pack under the eyes.' },
    { id: 'bloodbath', name: 'Bloodbath', price: 5000, suit: 0xe8e2d8, shirt: 0x8a0a08, tie: 0x5a0606, saw: true, desc: 'Shirt soaked through, chainsaw in hand. He has to return some videotapes.' },
  ],
  foreman: [
    { id: 'default', name: 'Night Shift', price: 0 },
    { id: 'overtime', name: 'Overtime', price: 2000, flesh: 0x9a8a88, apron: 0x2a1a14, blood: 0x6a0a06, desc: 'Hard hat and a hi-vis vest over the apron. Safety first.', fx: [['hardhat', { color: 0xe0b020, lamp: true }], ['hivis', { color: 0xf09020 }]] },
    { id: 'quota', name: 'Quota Met', price: 3500, bone: 0xc8a050, eye: 0xff3a20, desc: 'Employee of the month: a gold mask, a gold hook and gold chains.', fx: [['metal', { names: ['Foreman_8', 'Foreman_14'], color: 0xd8b040 }], ['chains', { color: 0xd8b040, cross: true }], ['crown', { color: 0xd8b040 }]] },
    { id: 'batman', name: 'The Dark Knight', price: 6500, limited: true, batman: true, desc: 'Limited edition. The cowl, the cape, the armoured suit, and the Foreman\'s hook turned into a grappling hook. Fan-made; not affiliated with DC.' },
    { id: 'reassigned', name: 'Reassigned', price: 6000, flesh: 0x7a8a8a, bone: 0x2a2a2a, eye: 0x7affd0, apron: 0x101418, desc: 'Moved to the cold store, and never came back out. A gas-masked teal ghost in chains.', fx: [['ghost', { color: 0x7affd0, op: 0.55 }], ['gasmask', { color: 0x1a1c1e, eye: 0x7affd0, filter: 0x2a2a2a }], ['chains', { color: 0x4a4a4a }]] },
  ],
};
// ---------------- Store: chapters (DLC) ----------------
// Bought with Embers. A chapter unlocks playing as its killer; its map is free for everyone.
export const CHAPTERS = [
  { id: 'granny', num: 'VIII', name: 'Granny', sub: '× Nightbound', price: 5000, killer: 'granny', map: 'granny', banner: 'granny', isNew: true,
    tagline: 'You have five days. She hears everything.',
    contents: ['Granny: Bat Rush, I Hear You, Creep (teleport), Body Swap', 'Her helper: Spider Mom', 'Execution: Bedtime Trap', "Map: Granny's House (free for everyone)", '2 Granny outfits in the Store'] },
  { id: 'offal', num: 'V', name: 'OFFAL', sub: '× Nightbound', price: 5000, killer: 'foreman', map: 'meatworks', banner: 'offal',
    tagline: 'Night shift at the Hollow Pines Meatworks. Headcount must be maintained.',
    contents: ['The Foreman: Chain Hook, Lights Out and Hunts by Sound', 'Execution: Reassignment', 'Map: Hollow Pines Meatworks (free for everyone)', '3 Foreman outfits in the Store'] },
  { id: 'psycho', num: 'VII', name: 'American Psycho', sub: '(fan-made)', killer: 'bateman', base: true, isNew: true, tagline: 'Do you like Huey Lewis and the News?' },
  { id: 'childsplay', num: 'VI', name: "Child's Play", sub: '(fan-made)', killer: 'chucky', base: true, isNew: true, tagline: 'Hi, I\'m Chucky. Wanna play?' },
  { id: 'base4', num: 'IV', name: 'The Last Light', killer: 'lamplighter', base: true, tagline: 'Every lantern is a door. Every door leads to him.' },
  { id: 'base3', num: 'III', name: 'Trophy Season', killer: 'harrower', base: true, tagline: 'He does not chase. He collects.' },
  { id: 'base2', num: 'II', name: 'Drowned Embrace', killer: 'wisp', base: true, tagline: 'She was here first. She will be here last.' },
  { id: 'base1', num: 'I', name: 'Gravemoor', killer: 'butcher', base: true, tagline: 'Where every road leads back to the block.' },
];
export const CHAPTER_OF = Object.fromEntries(CHAPTERS.filter(c => !c.base).map(c => [c.killer, c.id]));

export const skinOf = (char, id) => (SKINS[char] || []).find(s => s.id === id) || {};

// ---------------- Inbox: version notes & gifts ----------------
// email updates: the Buttondown newsletter's username (empty: the option stays hidden)
export const NEWSLETTER = '';
export const VERSION = '2.41.0';
export const INBOX = [
  {
    id: 'v2.41.0', version: '2.41.0', date: 'Nov 2026', title: 'New Chucky Outfit: Slappy', tag: 'Update',
    body: [
      'Slappy the ventriloquist\'s dummy is a new outfit for Chucky (6,000 Embers, Store > Characters > Chucky).',
      'He has his own hand-made animations: a stiff, puppet-like walk and run, a slow wrong-way head turn, an overhead swing with his iron-banded wooden mallet, a pounce, carrying, a limp wobble when stunned, and a mallet execution.',
      'Model: "slappy_animations" by Howard the Lipscomb (sketchfab.com/1310545), CC BY 4.0.',
    ],
  },
  {
    id: 'v2.40.0', version: '2.40.0', date: 'Nov 2026', title: 'Map Voting', tag: 'Update',
    body: [
      'Online lobbies now vote on the map. Every lobby gets three maps that suit the game mode, plus Random; click one to vote (you can change your mind). The map with the most votes is played; ties are settled at random.',
      'A new set of maps comes up after every match. The host can still pick a map directly (Map: Players vote / Random / a specific map).',
    ],
  },
  {
    id: 'v2.39.0', version: '2.39.0', date: 'Nov 2026', title: 'Carrying: Longer Struggle, Gentler Drops', tag: 'Update',
    body: [
      'Struggling free from the killer\'s shoulder now takes twice as long.',
      'When the killer drops a survivor (Q), they land on their feet, injured, instead of on the ground. The same goes for a Chucky possession ending mid-carry.',
    ],
  },
  {
    id: 'v2.38.0', version: '2.38.0', date: 'Nov 2026', title: 'Chucky Possession Fixes', tag: 'Update',
    body: [
      'A possessed survivor\'s ghost can no longer move or repair: it stays frozen where it was until Chucky leaves the body.',
      'Possession now lasts at most 1.1 minutes (1:06). When time runs out Chucky is forced back into his doll; his HUD shows the time left.',
      'Anyone Chucky hits while wearing a survivor\'s body now knows it is him: that bot treats the body as the killer from then on.',
    ],
  },
  {
    id: 'v2.37.0', version: '2.37.0', date: 'Nov 2026', title: 'Three New Game Modes', tag: 'Update',
    body: [
      'Glass Bones: every hit puts a survivor straight down, but generators repair 40% faster. No second chances.',
      'Adrenaline: everyone moves 30% faster, generators and gates go 25% faster, and killer powers recharge 40% faster.',
      'Blood Moon: a red moon rises. Every 45 seconds the killer sees every survivor for 4 seconds, but every survivor carries a 2-shot Taser.',
      'Pick them under Game mode when you play against bots, or in an online lobby.',
    ],
  },
  {
    id: 'v2.36.0', version: '2.36.0', date: 'Nov 2026', title: 'Weekly Awards: Best Survivor & Best Killer', tag: 'Update',
    body: [
      'Every week the whole player base competes for two titles: Best Survivor (most escapes that week) and Best Killer (most kills). Ties go to the higher score. Each winner gets 100,000 Embers, and one player can win both.',
      'The first awards are revealed TODAY, 5 November at 18:00 UTC, then every week at the same time. This first week counts every escape and kill you have ever made.',
      'Open Progress to see the live top 3 for each title, your own week, and the countdown. Winners are announced in-game the next time you open Nightbound after the reveal.',
    ],
  },
  {
    id: 'v2.35.0', version: '2.35.0', date: 'Nov 2026', title: 'Spider-Man: Limited Edition', tag: 'Update',
    body: [
      'Spider-Man is now a LIMITED character: 500,000 Embers, and only in the Store until 7 November (end of day, UTC). After that he leaves the Store forever and can never be bought again.',
      'Already played a match as Spider-Man? He is yours to keep, free.',
      'Spider-Man gets 5 attempts to unhook himself, with a 30% chance each (everyone else: 3 attempts at 4%).',
      'Fixed Spider-Man\'s arms glitching while standing idle: his rig now rests with the arms down, so every pose looks natural.',
    ],
  },
  {
    id: 'v2.34.0', version: '2.34.0', date: 'Nov 2026', title: 'Gift Embers to Friends', tag: 'Update',
    body: [
      'You can now gift Embers to your friends: open Friends (top right), press Gift next to a friend, pick an amount (or type one, up to 50,000) and Send.',
      'Gifts arrive instantly if your friend is online, and are waiting for them the next time they open the game if not. Each gift shows up in your chat with that friend.',
    ],
  },
  {
    id: 'v2.33.0', version: '2.33.0', date: 'Nov 2026', title: 'New Survivor: Spider-Man', tag: 'Update',
    body: [
      'Spider-Man swings into the fog (fan-made crossover, free for everyone). Fully rigged 3D model with the survivor walk, run, crouch, vault, repair, heal, down and carried animations.',
      'His own power, Web Shooters: press R to fire a web where you aim (4 shots, 20m). A webbed killer is slowed by 55% for 4 seconds, and a killer carrying a survivor is forced to drop them on the spot.',
      'Spider-Man bots use their webs too, mostly to pull teammates off the killer\'s shoulder.',
      'Model: "Spiderman_topy" by sabra (sketchfab.com/sabrayf), CC BY 4.0.',
    ],
  },
  {
    id: 'v2.32.0', version: '2.32.0', date: 'Nov 2026', title: 'God Tier Grandpa & a Limitless Bat Rush', tag: 'Update',
    body: [
      'Grandpa is now the first GOD TIER outfit (25,000 Embers; already own him? He stays yours). He changes how Granny plays: his shotgun replaces Bat Rush. Hold RMB to raise it, release to fire.',
      'Against Grandpa every survivor gets a second health bar (shown under each name). Three long-range shots put anyone down, but the spread barely scratches you up close: the farther the shot, the harder it hits (about 6 damage point-blank, up to 36 from 22m and beyond). Being healed fills the bar again.',
      'Bat Rush has no limit any more: the longer Granny holds RMB, the further she charges (about 8m at one second, 15m at two, and on). A full wind-up still ends in a Ground Slam.',
    ],
  },
  {
    id: 'v2.31.0', version: '2.31.0', date: 'Nov 2026', title: 'Graphics Overhaul: Realistic Mode', tag: 'Update',
    body: [
      'Realistic mode rebuilt from the ground up. Every outdoor map now uses real photo-scanned materials: forest floor, mud, snow, weathered brick, old stone, rusted metal, planks and tree bark, with true relief and roughness.',
      'Trails are worn into the ground and blend naturally into the forest floor. Pines are now real fir trees made of hundreds of needle fronds, and the grass sways in the wind.',
      'New lighting: moonlight shafts break through the branches, ambient occlusion grounds every wall and prop, real night contrast, and colour fades to blue-grey in the dark like it does for your eyes.',
      'Classic mode is unchanged and still runs on low-end laptops. Low and Potato quality keep the light textures too.',
    ],
  },
  {
    id: 'v2.30.0', version: '2.30.0', date: 'Nov 2026', title: 'Nightbound for Windows', tag: 'Update',
    body: [
      'Free download: Nightbound as a Windows desktop app (Store, App tab). It opens the latest version of the game in its own window.',
    ],
  },
  {
    id: 'v2.29.0', version: '2.29.0', date: 'Nov 2026', title: 'Friends & Chat', tag: 'Update',
    body: [
      'Friends: every player has a friend code (the people icon, top right). Add friends by code; requests wait for them even if they are offline.',
      'See which friends are online and whether they are in the menu, a lobby or a match. Join a friend\'s lobby in one click.',
      'Invite online friends into your lobby, and chat with them from the Friends panel.',
    ],
  },
  {
    id: 'v2.28.0', version: '2.28.0', date: 'Nov 2026', title: 'Ranks, Levels & Season 1', tag: 'Update', gift: { embers: 1000, label: 'Season 1 launch gift: 1,000 Embers' },
    body: [
      'Player level: every match earns XP; your level shows next to your name.',
      'Ranks: a survivor rank and a killer rank, Ash IV up to Iridescent I. Good matches earn pips, bad ones lose them. The results screen shows your XP and rank change.',
      'Season 1: The Long Night. A free 30-tier season pass (Progress in the main menu) with Embers on every tier and two season badges. 60 days.',
    ],
  },
  {
    id: 'v2.27.0', version: '2.27.0', date: 'Nov 2026', title: 'Granny: Body Swap & a Wilder Bat Rush', tag: 'Update',
    body: ['New for Granny: Body Swap (V). Switch bodies with Spider Mom at any moment: Granny appears where Spider Mom was, and Spider Mom where Granny stood. Hold V to look through Spider Mom\'s eyes first, then let go to swap.', 'Bat Rush, upgraded: steer the charge with the mouse, crash straight through windows, and each dropped pallet you smash carries you 2m further. Wind it up all the way and it ends in a Ground Slam that strikes everyone around her and damages a nearby generator.', 'Slendrina is gone from the Granny chapter: no more apparitions, and the trailer and banner now feature Spider Mom.'],
  },
  {
    id: 'v2.26.0', version: '2.26.0', date: 'Nov 2026', title: 'Granny Rework, Online Fixes', tag: 'Update',
    body: ['Granny, reworked to be more fun and more dangerous. New power, Bat Rush (hold RMB, release): wind up the bat and charge 3 to 8m, smashing through dropped pallets; the first survivor in her way is struck. Rush into a wall and she is stunned. Frenzy is gone.', 'I Hear You (R) now marks everyone it reveals as Heard for 15s: her next hit on a Heard survivor, bat or Bat Rush, puts them straight down.', 'Creep (G) can now take her to Spider Mom, and she arrives with a burst of speed. Spider Mom webs the survivors she finds (slowed for 3s).', 'Online: players who end up on the slower relay keep trying for a direct connection in the background and switch over mid-match when it works. More relay servers help direct connections succeed in the first place.', 'Online: key presses can no longer get lost on the relay, held keys (E, aim, flashlight) can no longer get stuck, and a laggy killer\'s hits now count (lag compensation up to 0.8s).', "Online: on Granny's House, a player who joined now really is on the floor they climbed to, so hits upstairs work.", 'Removed the Scarred Chucky and Chucky DBD outfits (they glitched). Anyone who bought one got their embers back.'],
  },
  {
    id: 'v2.25.0', version: '2.25.0', date: 'Nov 2026', title: 'Two New Chucky Outfits', tag: 'Store',
    body: ['Scarred Chucky (5,500 embers): stitched back together after Bride of Chucky, scars, staples and a bloody butcher knife.', 'Chucky DBD (6,000 embers): the Good Guy as he looks in Dead by Daylight.', "Both are fitted to Chucky's own skeleton, so they play all of his animations, knife included."],
  },
  {
    id: 'v2.24.1', version: '2.24.1', date: 'Nov 2026', title: 'Fix: taking over a bot', tag: 'Fix',
    body: ['Taking over a bot after you die (T) works again: swapping items at a chest was being mistaken for it.'],
  },
  {
    id: 'v2.24.0', version: '2.24.0', date: 'Nov 2026', title: "Granny's House: Every Floor", tag: 'Map',
    body: ["The whole of Granny's House is open. Take the stairs in the hall up to the first and second floors, then the spiral staircase up to the tower room.", 'Hits, pick-ups and line of sight respect floors: nobody can be hit through a ceiling, and you can hide upstairs, but the killer will follow you up (bots too) and carry you back down to a hook.', 'Bots no longer get stuck carrying a survivor between two hooks that are the same distance away.'],
  },
  {
    id: 'v2.23.0', version: '2.23.0', date: 'Nov 2026', title: 'Chests, the Taser & Your Own Hands', tag: 'Update',
    body: ['Chests now sit on every map. Hold E to search one: inside is a fresh flashlight, ghost traps or, one time in five, the new Taser. Hold E at an open chest to swap your item for what it holds, even a used-up one.', 'New item, the Taser (chests only): click RMB to fire. A killer you hit is electrocuted and frozen for 3s, and drops whoever he is carrying. 3 shots.', 'Killers now see their own hands in first person: Granny\'s real arm and bloody bat, Grandpa\'s shotgun, the Dark Knight\'s gauntlets, the Slimer\'s slimy arms, and your outfit\'s colours on every other killer.', 'Spider Mom: survivors she finds are outlined in purple for Granny.', "Granny's Bedtime Trap uses a new bear trap model, in the execution and the trailer.", "Granny's House can now be picked from the map lists (bots and online lobbies)."],
  },
  {
    id: 'v2.22.0', version: '2.22.0', date: 'Nov 2026', title: 'Granny Rework, Spider Mom & Grandpa', tag: 'Update',
    body: ['Granny has been reworked. Her bear traps are gone. New power, Frenzy (RMB): for 5s she moves 35% faster, senses every survivor within 16m through the walls, and her first hit downs.', 'New: Creep (hold G). Every generator, hook, window and pallet on the map is marked; release to vanish and reappear at the one in your sights.', 'New helper: Spider Mom crawls from generator to generator. Anyone she finds repairing one is revealed to Granny.', 'New execution: Bedtime Trap. Granny forces the survivor to their knees, sets a bear trap in front of them and shoves their face into it.', 'New outfit in the Store: Grandpa (5,000 embers), with his own animations.', "Granny's House: generators and hooks no longer block the way from one side of the map to the other."],
  },
  {
    id: 'v2.21.1', version: '2.21.1', date: 'Nov 2026', title: 'Limited Edition: The Dark Knight', tag: 'Store',
    body: ['A limited edition outfit for the Foreman: The Dark Knight. The cowl, the cape and the armoured suit, moving with all of the Foreman\'s own animations.', 'His hook becomes a black grappling hook, and his Chain Hook fires a thin black grapnel line. (Fan-made; not affiliated with DC.)', 'Find it in the Store under the Foreman, while it lasts.'],
  },
  {
    id: 'v2.21.0', version: '2.21.0', date: 'Nov 2026', title: 'Chapter VIII: Granny', tag: 'New Chapter', banner: 'granny',
    body: [
      'Granny comes to Nightbound. You wake up in her house, and you have five days. (Fan-made crossover.)',
      'New killer, Granny: Bear Trap (hold RMB to kneel and set a trap: whoever steps in it is injured and held in place), I Hear You (R: everyone running, repairing, healing or unhooking is revealed), and Sharp Ears (runners near her, and every failed skill check, give you away). She moves with her own animations: the shuffle, the bat swing, the stagger, the pepper-spray flinch.',
      'Her helper, Slendrina, haunts the trial: now and then early on, and constantly once the exit gates are powered. Look at her for half a second and you are injured. Don\'t look at her.',
      'New map, free for everyone: Granny\'s House, the whole house and walled yard. Generators and hooks in the yard and inside the ground floor.',
      'New execution: Sweet Dreams. Two outfits in the Store: Spring Cleaning and Pale Visitor.',
      'Watch the trailer from the home screen.',
    ],
  },
  {
    id: 'v2.20.3', version: '2.20.3', date: 'Nov 2026', title: 'Killer Damage Report', tag: 'Update',
    body: ['The end screen now shows how much damage each killer did: health states taken, hits, downs, hooks and kills (executions noted), and crowns the killer who did the most.', 'Online: players who joined a room now see their connection and ping in the top-right corner. "Relay (slower)" means a direct link to the host couldn\'t be made. Direct connections also get more time to succeed before falling back to the relay, which should mean less lag for more players.'],
  },
  {
    id: 'v2.20.2', version: '2.20.2', date: 'Nov 2026', title: 'Ted: Once Is Enough', tag: 'Update',
    body: ['Ted\'s "Fuck me." now only comes up once a match (his "Arfh!" still plays every time you go down).', 'Ted\'s longer clips can now show timed, line-by-line subtitles.'],
  },
  {
    id: 'v2.20.1', version: '2.20.1', date: 'Nov 2026', title: 'Custom Keybinds', tag: 'Update',
    body: ['Every key can now be rebound: Settings > Keybinds, click an action and press a key (Esc cancels). Pick a key another action already uses and the two swap. Reset keybinds puts everything back.', 'The on-screen hints and prompts show your keys.'],
  },
  {
    id: 'v2.20.0', version: '2.20.0', date: 'Nov 2026', title: 'Hooks', tag: 'Major Update',
    body: [
      'Cages are gone. Killers now hang downed survivors on sacrificial meat hooks, by the shoulder, on every map.',
      'First hook: hang for 60s. Press Space to try to unhook yourself: 3 tries, 4% chance each, and every failed try costs time.',
      'Hang too long, or get hooked a second time, and the Entity arrives: its spider legs rise around the hook and you must hit struggle skill checks. Every miss brings it closer. A third hook is fatal.',
      'When the Entity claims someone its legs plunge in and the hook is taken with them.',
      'Executions now work on survivors who have reached the struggle phase. Perks renamed: Quick Release (unhook faster) and Rusted Hooks (hook timers run faster).',
    ],
  },
  {
    id: 'v2.19.9', version: '2.19.9', date: 'Nov 2026', title: 'Ted: More To Say', tag: 'Update',
    body: ['Two Teds in one match no longer talk over each other: they take turns, and a line one Ted has already said won\'t be said again by the other.', 'New lines: "Fuck me." right after the "Arfh!" when you go down; "Look, I know you\'re pissed..." and the Thunder Buddies song while you\'re being chased; and if you\'re the killer, your Ted heckles survivors you chase ("You\'re just making yourself look like a pussy"), which survivors can hear too.', 'The teddy bear line, like most of Ted\'s lines, only comes up once a match.'],
  },
  {
    id: 'v2.19.8', version: '2.19.8', date: 'Nov 2026', title: 'Realism Arms Fix', tag: 'Fix',
    body: ['Raghuvir\'s Realism outfit no longer sinks his hands into his body while standing or idle: his arms now hang naturally at his sides.'],
  },
  {
    id: 'v2.19.7', version: '2.19.7', date: 'Nov 2026', title: 'Ted: Fewer Reruns', tag: 'Update',
    body: ['Ted no longer repeats himself: most of his lines are said once a match. Only "Bring it in, you bastard!", "Shit.", the "acting like a..." line and "Arfh!" can come up again.', 'New line when you\'re put on a hook: "You got a lot of problems."'],
  },
  {
    id: 'v2.19.6', version: '2.19.6', date: 'Nov 2026', title: 'Ted: Arfh!', tag: 'Fix',
    body: ['Ted\'s "Arfh!" now plays when he sees you get downed (it used to wait until you died).'],
  },
  {
    id: 'v2.19.5', version: '2.19.5', date: 'Nov 2026', title: 'Ted: New Line', tag: 'Update',
    body: ['Ted has a new line for when the killer is chasing you: "I\'m a f***ing teddy bear!"'],
  },
  {
    id: 'v2.19.4', version: '2.19.4', date: 'Nov 2026', title: 'Ted Speaks', tag: 'Update',
    body: ['Ted now talks, with subtitles. He has something to say when you run from the killer, when he kicks back with his bong, when someone blows a skill check, gets downed twice in a minute or (if you\'re the killer) whiffs a swing, and every now and then for no reason at all.', 'He also lets out an "Arfh!" when he sees you die.', 'Subtitles can be turned off in Settings.'],
  },
  {
    id: 'v2.19.3', version: '2.19.3', date: 'Nov 2026', title: 'Black Squares Fix', tag: 'Fix',
    body: ['Fixed big black boxes spreading across the screen while walking with the Realistic look. Ambient occlusion is off for now, and a safety pass stops any bad pixel from being smeared by the glow effect.'],
  },
  {
    id: 'v2.19.2', version: '2.19.2', date: 'Nov 2026', title: 'Scratch Marks', tag: 'Update',
    body: ['Running survivors now leave glowing orange scratch marks behind them, scattered along their trail. Only the killer can see them, and they fade after about ten seconds.', 'Survivors: walk or crouch to stop leaving a trail.'],
  },
  {
    id: 'v2.19.1', version: '2.19.1', date: 'Nov 2026', title: 'Emotes', tag: 'Update',
    body: ['Survivors can now emote: press B, then 1 to 4 (or click) for Dance, Wave, Cheer or Bow. Moving or doing anything stops it, and everyone in the match sees it.', 'Got a sidekick? Ted and Rosy join in: they dance with you, wave, cheer and even take a bow.'],
  },
  {
    id: 'v2.19.0', version: '2.19.0', date: 'Nov 2026', title: 'Realistic Look', tag: 'Graphics',
    body: ['New Realistic look, on by default: textures painted at twice the resolution with deeper surface relief and full anisotropic filtering, a soft sheen on skin and fabric, rounder and smoother characters, faint night-sky reflections on metal, glass and blood, proper anti-aliasing, crisper moon shadows, and ambient occlusion on High.', 'Running on an older laptop? Settings > Visual style > Classic brings back the original look, and it combines with any graphics quality.'],
  },
  {
    id: 'v2.18.7', version: '2.18.7', date: 'Nov 2026', title: 'The Real Ghost Trap', tag: 'Update',
    body: ['Ghost traps set by Raghuvir and Abeer now use a detailed trap model, with the hazard stripes, side panel and foot pedal handle, still glowing so you can spot them.'],
  },
  {
    id: 'v2.18.6', version: '2.18.6', date: 'Nov 2026', title: 'Axe Grip Fix', tag: 'Fix',
    body: ['Patrick Bateman\'s fire axe no longer floats in front of the camera: the handle now sits in his fist, in first person and third person, with the blade leading every swing.'],
  },
  {
    id: 'v2.18.5', version: '2.18.5', date: 'Nov 2026', title: 'Your Camera, Your Way', tag: 'Update',
    body: ['New camera options in Settings (and in the pause menu): left shoulder, centered or right shoulder, plus camera distance, height and orbit angle.', 'Press H during a match to swap shoulders instantly. Works for survivors and over-the-shoulder killers like Chucky.'],
  },
  {
    id: 'v2.18.4', version: '2.18.4', date: 'Nov 2026', title: 'Ted Gets Comfy', tag: 'Update',
    body: ['Ted now walks over, pulls out his folding chair, sets it down and snaps it open, then hops up into it. When it\'s time to go he climbs down, folds it back up and tucks it away.', 'He raises his beer all the way to his mouth and tips his head back for a proper swig.', 'His bong sits on his lap; for a hit he tips it up to his mouth, then breathes out a small puff of smoke.'],
  },
  {
    id: 'v2.18.3', version: '2.18.3', date: 'Nov 2026', title: 'Sharper Steel, Wetter Gore', tag: 'Update',
    body: ['Patrick Bateman now swings a real fire axe, in first and third person.', 'Blood is no longer flat dots: droplets are glossy, stretch as they fly and bead up where they land (Low and Potato graphics keep the cheap version).'],
  },
  {
    id: 'v2.18.2', version: '2.18.2', date: 'Nov 2026', title: 'Turntable Preview', tag: 'Update',
    body: ['In the Store and on the Loadout screen, drag the character to spin them all the way around and scroll to zoom in on their outfit.'],
  },
  {
    id: 'v2.18.1', version: '2.18.1', date: 'Nov 2026', title: 'The New Slimer', tag: 'Crossover', gb: true,
    body: ['The Slimer has a brand-new realistic model: slick green ectoplasm, red eyes, a huge lipped mouth full of teeth. He floats, bobs, squashes and stretches, lunges into his attacks and wobbles when stunned. Ecto Blue and Golden Glutton recolour the new model.'],
  },
  {
    id: 'v2.18', version: '2.18.0', date: 'Nov 2026', title: 'Brutal Executions', tag: 'Update',
    body: [
      'Executions are smoother and far gorier. The victim glides into place instead of snapping, poses blend between beats, the wound pumps blood in time with a heartbeat, a pool spreads under the body, and the killing blow lands with a burst, flying chunks, blood across the screen and a beat of slow motion.',
      'Hit reactions: survivors now snap forward, twist away from the blow, whip their head back and stumble.',
    ],
  },
  {
    id: 'v2.17.3', version: '2.17.3', date: 'Nov 2026', title: 'Ted Takes a Break', tag: 'Update',
    body: ['Ted now pulls out his camping chair, beer and bong while you repair a generator or hang on a hook, not just when you die. He packs up when you get moving again. Rosy lies down beside you.'],
  },
  {
    id: 'v2.17.2', version: '2.17.2', date: 'Nov 2026', title: 'Last Updated', tag: 'Update',
    body: ['The home screen now shows the game version and how long ago it was last updated (hover it for the exact date and time).'],
  },
  {
    id: 'v2.17.1', version: '2.17.1', date: 'Nov 2026', title: 'Raghuvir: Realism', tag: 'Crossover', gb: true,
    body: [
      'New outfit for Raghuvir: Realism (6,000 Embers), a fully realistic Ghostbuster in a worn khaki flight suit with straps, patch and a heavy proton pack.',
      'It moves with every survivor animation in the game: walking, running, crouching, repairing, healing, going down, being carried, hooked and vaulting.',
    ],
  },
  {
    id: 'v2.17', version: '2.17.0', date: 'Nov 2026', title: 'Sidekicks', tag: 'Update',
    body: [
      'New in the Store: Sidekicks, companions that follow you through the match, for survivors and killers. Equip one for each in the Store or on the Loadout screen.',
      'Ted (4,000 Embers): cheers when things go well, panics when you get hurt, and whenever you repair a generator, get hooked or die, he pulls up a camping chair next to you with a beer and his bong.',
      'Rosy (2,500 Embers): a loyal little dog who trots at your heels, wags, runs circles when you are in trouble and lies down beside you if you fall.',
      'Sidekicks can\'t be hurt and can\'t hurt anyone. Everyone in the match sees them.',
    ],
  },
  {
    id: 'v2.16.1', version: '2.16.1', date: 'Nov 2026', title: 'Chucky Coils on the Run', tag: 'Balance',
    body: ['Chucky is no longer slowed while coiling a Pounce: keep running at full speed and leap when you are ready.'],
  },
  {
    id: 'v2.16', version: '2.16.0', date: 'Nov 2026', title: 'Perk Shop & New Loadout', tag: 'Update',
    gift: { embers: 3000, label: 'Gift: 3,000 Embers' },
    body: [
      'A new Loadout screen: pick your character from the portrait row, your four equipped perks sit in diamond slots, and every perk is in the inventory grid below. Your character stands on the right.',
      'Four perk slots instead of three.',
      'Perks are now bought with Embers (1,500 to 2,500). The default perks are free, and anything you already had equipped stays yours.',
      'Six new survivor-exclusive perks: Triage (Mara), Overclock (Eli), Exposure (June), Pathfinder (Tomas), Containment (Raghuvir) and Exorcist (Abeer, who cannot be possessed).',
    ],
  },
  {
    id: 'v2.15.3', version: '2.15.3', date: 'Nov 2026', title: 'Store Showroom', tag: 'Update',
    body: [
      'Previewing outfits in the Store now stands the character up on their own in a lit clearing, facing you, full body, between the character list and the outfit card. No more survivors sitting with their backs to you at the campfire.',
    ],
  },
  {
    id: 'v2.15.2', version: '2.15.2', date: 'Nov 2026', title: 'Character Lore', tag: 'Update',
    body: [
      'Every survivor and killer now has a backstory. Read it on the Loadout screen (tap Read more) or on each character\'s page in the Store.',
      'Raghuvir and Abeer: how the Ghostbusters fell apart, and how the Entity pulled them both into Nightbound.',
    ],
  },
  {
    id: 'v2.15.1', version: '2.15.1', date: 'Nov 2026', title: 'Patrick Bateman Buff', tag: 'Balance',
    body: [
      'Chainsaw Toss: half the wind-up (0.35s), a faster throw (26 m/s), a bigger hitbox, 24m range and a 2.5s cooldown. If you don\'t pick it up, it flies back to your hand after 8s (was 20s).',
      'Business Card: 18s cooldown (was 25s), 16m range, slows by 20% for 5s, and intimidated survivors stay revealed while they run.',
      'Morning Routine lasts 4s. Base speed 4.7 m/s, terror radius 28m.',
      'His first-person chainsaw is smaller and sits in the lower corner instead of covering the screen.',
    ],
  },
  {
    id: 'v2.15', version: '2.15.0', date: 'Nov 2026', title: 'Chucky: Soul Split', tag: 'Balance',
    body: [
      'New for Chucky, Soul Split (V, once per match): spare Good Guy dolls now lie around the map. When only one generator is left, his soul jumps into one of them at random.',
      'His old body keeps hunting on its own as a bot. It can put survivors down, but it can never pick them up or hook them.',
    ],
  },
  {
    id: 'v2.14', version: '2.14.0', date: 'Nov 2026', title: 'Chucky: Possession', tag: 'Balance',
    body: [
      'New for Chucky, Possession (G, once every 10 minutes): stand over a downed survivor and take over their body. Nobody is told.',
      'The body gets back up looking exactly like that survivor, but you are in control: strike, pick up and hook like a killer.',
      'Your doll is left behind as a bot decoy that chases survivors but cannot hurt them.',
      'The possessed player becomes a ghost nobody else can see. Ghosts can only repair generators, 10% slower.',
      'Once you have downed and hooked a survivor in that body, press G to let go: you return to your doll and the survivor gets their body back, injured.',
    ],
  },
  {
    id: 'v2.13.3', version: '2.13.3', date: 'Nov 2026', title: 'Chucky Fix', tag: 'Update',
    body: [
      'Fixed: Chucky could show up as a simple stand-in doll instead of his real model. A match with Chucky in it now waits on the loading screen until his model has downloaded, and the menu, store and character previews redraw as soon as it arrives.',
      'If the model ever fails to load you now get a message instead of a silent stand-in.',
    ],
  },
  {
    id: 'v2.13.2', version: '2.13.2', date: 'Nov 2026', title: 'Chucky Pounces Higher', tag: 'Balance',
    body: [
      'Chucky\'s Pounce now sails over fences, dropped pallets, crates, log piles and rocks (anything under 1.6m). Walls still stop him, and Ghost Traps still catch him mid-leap.',
    ],
  },
  {
    id: 'v2.13.1', version: '2.13.1', date: 'Nov 2026', title: 'Chucky Can Jump', tag: 'Balance',
    body: [
      'Chucky can jump (Space). He hops straight over window frames, dropped pallets and low rocks instead of vaulting, and crossing a window or pallet takes him half a second.',
    ],
  },
  {
    id: 'v2.13', version: '2.13.0', date: 'Nov 2026', title: 'Chucky', tag: 'Crossover',
    gift: { embers: 1500, label: 'Gift: 1,500 Embers' },
    body: [
      'New killer, free for everyone: Chucky (Child\'s Play, fan-made). A fully animated Good Guy doll, two and a half feet tall, played in third person.',
      'Pounce (RMB): hold to coil, release to leap up to 10m. The longer the coil, the farther the leap. Landing on a survivor strikes them; leaping into a wall stuns you.',
      'Chucky\'s Laugh (R): every survivor within 28m hears it and is revealed to you for 5s.',
      'Tiny Terror: a 20m terror radius and silent footsteps. Execution: Friends Till the End.',
      'Outfits in the Store: Burnt Out and Voodoo.',
    ],
  },
  {
    id: 'v2.12', version: '2.12.0', date: 'Nov 2026', title: 'Infection Grows', tag: 'New Maps',
    body: [
      'Infection is now 2 killers vs 10 survivors (12 players online).',
      'Two new maps built for Infection, twice the size of the others: Quarantine Woods and Outbreak Fairground. Eleven generators (eight needed), survivors start spread around the edges.',
      'Every 60 seconds the infected sense every survivor for a moment, so nobody can hide forever.',
      'Big teams get a compact two-column team list.',
      'Bot pathfinding is much faster, which smooths out hosting on big maps.',
    ],
  },
  {
    id: 'v2.11.1', version: '2.11.1', date: 'Nov 2026', title: 'The Killer Knows', tag: 'Update',
    body: [
      'Killers now always see which generators are being repaired (they glow yellow), and a marker shows where each generator was finished.',
      'A hooked survivor stays visible to the killer, through walls, until someone unhooks them.',
      'The Foreman\'s Chain Hook now flies where you aim, up and down. Aim at a treetop or a high wall and he is flung up to the hook, then drops down at its foot.',
      'Static Sense (killer perk) now reveals the survivors who are repairing a generator.',
    ],
  },
  {
    id: 'v2.11', version: '2.11.0', date: 'Nov 2026', title: 'Patrick Bateman', tag: 'Crossover',
    body: [
      'New killer, free for everyone: Patrick Bateman (American Psycho, fan-made). Vice president at Pierce & Pierce, in a charcoal pinstripe double-breasted suit with a red silk tie, a cigar and an axe.',
      'Chainsaw Toss (RMB): hold to rev up (slowed), release to hurl the chainsaw. A hit puts a survivor straight down. Then walk over and pick it back up (it returns by itself after 20s).',
      'Business Card (R): survivors within 14m in front of him are intimidated: revealed and 15% slower for 4s.',
      'Morning Routine: a 3s burst of +12% speed after every hit. Execution: Hip to Be Square.',
      'Outfits in the Store: Hip to Be Square (clear raincoat), Morning Routine (robe, face mask and Walkman), Bloodbath (soaked shirt and chainsaw).',
    ],
  },
  {
    id: 'v2.10', version: '2.10.0', date: 'Nov 2026', title: 'Game Modes', tag: 'Update',
    gift: { embers: 1000, label: 'Gift: 1,000 Embers' },
    body: [
      'Pick a game mode in the bot match setup or the online lobby.',
      'Two Killers (2 vs 8): two killers hunt eight survivors. Six generators power the gates.',
      'Lights Out: the lights never come on. Thick fog, no auras for survivors and half-charged flashlights.',
      'Survivor Rush: five-minute matches. Generators and gates go twice as fast and the killer gets a burst of speed after every hit. When the clock runs out, the gates power up and the night collapses in 40 seconds.',
      'Infection: no hooks. A downed survivor rises as a random killer 3 seconds later. Escape through the gates, or be the last survivor standing and survive a 45-second last stand.',
      'Online lobbies grow to 10 players for Two Killers.',
    ],
  },
  {
    id: 'v2.9.2', version: '2.9.2', date: 'Nov 2026', title: 'Smoother Online Matches', tag: 'Update',
    body: [
      'Online matches should feel much smoother. Game state now travels over a fast WebRTC channel that never waits for lost packets, so a single dropped packet no longer freezes everyone for a moment and then makes them jump.',
      'Snapshots are about a third smaller and sent 30 times a second (was 20). Your own position is sent 30 times a second too.',
      'The host now draws other players smoothly instead of in steps, and the host\'s hits are lag-compensated like everyone else\'s.',
      'If the host switches to another tab or window, the match keeps running at full speed for everyone.',
      'Slow connections drop stale updates instead of letting a queue of old ones build up.',
      'Everyone in a lobby needs this version. Players on an older copy are told to refresh.',
    ],
  },
  {
    id: 'v2.9.1', version: '2.9.1', date: 'Nov 2026', title: 'Slimer Gets Hungrier', tag: 'Balance',
    body: [
      'Slime Spit is now a real attack: aim at a survivor up to 14m away and the glob hits them directly, slowing them by 30% and revealing them for 3s, then leaves a puddle under them.',
      'New for Slimer, Ghost Phase (R): turn see-through and float straight through walls for 2.5s (16s cooldown). If the phase ends inside a wall, you are dropped on the nearest open ground.',
      'Bot Slimers now spit and phase properly. In bot matches survivors escape Slimer about 1 time in 5.',
    ],
  },
  {
    id: 'v2.9', version: '2.9.0', date: 'Nov 2026', title: 'Slimer and the Proton Stream', tag: 'Crossover', gb: true,
    gift: { embers: 1500, label: 'Gift: 1,500 Embers' },
    body: [
      'New killer, free for everyone: The Slimer (fan-made). A floating green glutton. Slime Spit (RMB) lays puddles that slow survivors and reveal them to him, he makes no footsteps, and his terror radius is small.',
      'Raghuvir and Abeer don\'t carry a flashlight: they fire a Proton Stream from their packs. It crackles orange and blue and stuns the killer the same way.',
      'A fan-made crossover. Not affiliated with or endorsed by the Ghostbusters rights holders.',
    ],
  },
  {
    id: 'v2.8.1', version: '2.8.1', date: 'Nov 2026', title: 'Choose Your Item, Brightness, Better Ghostbusters', tag: 'Update',
    body: [
      'Pick your survivor item in the Loadout: a Flashlight (blind the killer) or Ghost Traps (2 per match, 3 for Raghuvir and Abeer). You carry only the one you choose.',
      'New Brightness slider in Settings.',
      'Raghuvir and Abeer now look like themselves: Raghuvir\'s clear glasses and heavy fringe, Abeer\'s shaggy mop. Their street outfits are a beige puffer with a black hood and a navy hooded jacket with a red stripe.',
    ],
  },
  {
    id: 'v2.8', version: '2.8.0', date: 'Nov 2026', title: 'Ghostbusters × Nightbound (fan-made)', tag: 'Crossover', gb: true,
    gift: { embers: 2000, label: 'Crossover gift: 2,000 Embers' },
    body: [
      'Two new survivors, free for everyone: Raghuvir and Abeer, in khaki flight suits with proton packs. Off-duty outfits (beige and blue jackets) and a Slimed look are in the Store.',
      'New item, the Ghost Trap: press G to set it down. When the killer walks over it, it snaps open and stuns him. Every survivor carries one; Raghuvir and Abeer carry two.',
      'A fan-made crossover. Not affiliated with or endorsed by the Ghostbusters rights holders.',
    ],
  },
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
      'Killer bots predict where you run, listen for footsteps, search where they lost you and stop camping hooks.',
      'Online play: direct WebRTC connection with an automatic relay fallback. Works without a server.',
      'Fixed: killer mouse look was inverted.',
      'Executions now need a survivor in the struggle phase (or the last survivor alive).',
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
