# Nightbound

A 3D 1-versus-4 asymmetric horror game that runs in your browser. One player is the killer. Up to four survivors repair generators, power the exit gates and escape before the night takes them.

Almost everything is procedural: the map (forest, trails, ruins, lamp posts, ground fog), characters, textures and audio are generated in code. The Foreman (OFFAL crossover) uses a rigged, animated model (`public/models/foreman.glb`). three.js and PeerJS are bundled, and the fonts are local.

## Play

| You want to… | Do this |
| --- | --- |
| **Play in the browser / share a link** | Turn on GitHub Pages (below). Then anyone can play at **https://froodyofficial-maker.github.io/Nightbound/** |
| **Play offline / from a download** | Download the repo (Code → Download ZIP) and double-click **`Nightbound.html`** |
| **Host on your local network** | Double-click `start-windows.bat` / `start-mac.command`, or run `node server.js` (needs [Node.js](https://nodejs.org) 18+), then open http://localhost:8090 |

### Turning on the free web link (one time)

1. Open the repo on GitHub and go to **Settings → Pages**.
2. Under *Build and deployment*, set **Source: Deploy from a branch**.
3. Pick **Branch: `main`**, folder **`/ (root)`**, and **Save**.
4. After about a minute the game is live at `https://froodyofficial-maker.github.io/Nightbound/`.

## Online multiplayer

Choose **Online Match → Create Lobby** and share the 5-letter code. Friends choose **Online Match**, type the code and press **Join**. On the web link you can also send them **Copy invite link**.

No server is needed. The host listens two ways at once:

1. **Direct WebRTC connection** (via the PeerJS broker, with STUN/TURN servers). This is the fastest.
2. **Relay fallback** through public MQTT brokers over WebSocket, for networks where a direct connection is blocked.

Joining players try the direct connection first and switch to the relay automatically.

The host runs the match and sends compact snapshots 20 times a second (a full keyframe once a second). Clients draw other players slightly in the past, interpolated between snapshots, so late or bunched packets don't cause stutter. Killer hits are lag-compensated against what the killer saw.

When the page is served by `node server.js`, everyone on that server uses its built-in WebSocket relay instead. Empty slots can be filled with bots, and a bot takes over if a player disconnects.

## Killers

| Killer | Power | Unique feature | Execution |
| --- | --- | --- | --- |
| **The Butcher** | *Rampage* charge that downs on contact (2 charges) | *Gore Trail*: sees blood from injured survivors | Butcher's Block |
| **The Wisp** | *Fade*: near-invisible, silent, faster | *Ambush & Frost*: long lunge after reappearing; frost and whispers near her | Drowning Embrace |
| **The Harrower** | *Bone Spear*: 3 regrowing spears | *Trophy Mark*: speared survivors are revealed | Trophy Hunt |
| **The Lamplighter** | *Cursed Lanterns* reveal nearby survivors | *Shadow Step* (R): teleport to a lantern | Last Light |
| **The Foreman** *(OFFAL crossover chapter)* | *Lights Out*: the whole map goes dark, fog closes in, he goes silent | *Hunts by Sound*: runners near him are revealed in the dark, and one hook hit downs | Reassignment |

Executions (**F**) work on a downed survivor who has been caged twice or on the last survivor alive.

## Flashlights & taking over bots

- Every survivor carries a **flashlight** (hold **RMB**). Keep the beam on the killer's face for a second to blind and stun him. That also frees a survivor he is carrying. The battery lasts 12 seconds, and the killer can't be blinded again for 12 seconds after a blind.
- If you die while bot survivors are still alive, press **T** to take over a bot and keep playing. This works in bot matches and online.

## Maps

| Map | |
| --- | --- |
| **Gravemoor Woods** | Foggy forest with ruins, barns, a chapel and lamp-lit trails. |
| **Hollow Pines Meatworks** *(OFFAL crossover)* | Ported from OFFAL's level generator: white-tiled kill floors, carcass rails, cattle pens, the Foreman's office, freezers and offal tanks under a low ceiling. Vault windows link neighbouring halls and corridors narrow to barricade chokepoints. |
| **Blackwater Marsh** | A bayou at night: stilt shacks on decks, boardwalks, a wrecked boat, cypress groves hung with moss, black water, green fog and fireflies. |
| **Hollowmere Carnival** | An abandoned fairground: a big-top tent, game booths with vaultable counters, a carousel, caravans, a Ferris wheel and coloured string lights. |
| **Coldwater Pass** | A frozen mountain pass: snowed-in log cabins and a lodge, snow-laden pines, a frozen lake with an ice-fishing hut, a buried truck and falling snow. |

Pick the map (or Random) in the bot-match setup or the online lobby. Every map is free.

## Ghostbusters × Nightbound (fan-made)

Two extra survivors, **Raghuvir** and **Abeer**, wear khaki flight suits with proton packs and each carry two Ghost Traps (other survivors carry one). This is a fan-made crossover, not affiliated with or endorsed by the Ghostbusters rights holders.

## Store & Inbox

- **Store** (DbD-style, full screen), paid in **Embers**, which you earn by playing matches:
  - **Chapters**: *OFFAL × Nightbound* unlocks playing as The Foreman (5,000 Embers). The base-game chapters are owned by everyone. Anyone can play the Meatworks map and face the Foreman as a bot.
  - **Characters**: a portrait grid of every character, outfit tiles by rarity, and a live 3D preview. Outfits transform the character: masks, headgear, cloaks, armour, weapons and effects such as embers, ghosts, frost or gold.
  - **Collections**: every outfit for one character at 25% off.
- **Inbox** (envelope icon, top right): the changes in every version, plus claimable Ember gifts.

## Bots

- **Survivors** loop walls and trees to break line of sight. They vault windows and drop barricades on the killer, spread out across generators, rescue and heal teammates, and sneak away after a chase.
- **The killer** predicts where survivors are running and hears footsteps. It searches where it lost someone, cuts survivors off on loops, and doesn't camp cages.

There are three difficulties (Easy, Normal, Hard).

## Controls

| | Survivor | Killer |
| --- | --- | --- |
| Move / look | WASD + mouse | WASD + mouse |
| Run / crouch | Shift / Ctrl or C | – |
| Interact (hold) | E: repair, heal, free from cage, open gate, snuff lantern | E: pick up, cage, damage generator, break barricade |
| Context | Space: vault, drop barricade, skill check | Space: vault |
| Flashlight | RMB (hold) | – |
| Ghost Trap | G: set a trap that stuns the killer when he steps on it | – |
| After dying | T: take over a bot survivor, LMB: switch spectated player | – |
| Attack / power | – | LMB / RMB (R: Shadow Step) |
| Execute | – | F |

Tab shows the scoreboard. Esc pauses. Settings has graphics presets (Very Low → High, auto-detected on first launch), dynamic resolution, an FPS counter, sensitivity, FOV, invert-Y and audio.

## Development

```
index.html, Nightbound.html  bundled single-file game (generated; index.html is the GitHub Pages entry)
public/                      source: index.html, css/, js/ (ES modules), fonts/, vendor/
server.js                    static server + zero-dependency WebSocket room relay
tools/build.mjs              bundles public/ into Nightbound.html and index.html
```

Run from source with `node server.js` and open http://localhost:8090. Don't open `public/index.html` from disk; browsers block ES modules there.

To rebuild after editing:

```bash
cd tools && npm install && cd ..
node tools/build.mjs
```
