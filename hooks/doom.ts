// REVISION: flow-v176-doom-plain-names
//
// Doom (the `doom` scene): a space marine fighting his way through a 1993
// techbase, on the same dials as the fire; the level is how hard he goes at
// it. At 1 he plods along with his pistol lowered, now and then raising it at
// a lone zombieman far down the hall. The busier the work, the faster he moves
// and the faster he shoots, and the heavier the gun: the pistol up to 2, the
// pump shotgun to 5, the chaingun to 8, then the plasma rifle, with imps
// hurling fireballs, pinky demons charging, cacodemons floating in, and
// barrels going up among them. When it eases off he slows and lowers his gun
// again; between enemies he keeps walking.
//
// Each subagent is another marine in co-op colors (crew.ts): indigo, brown,
// red, grey. One runs in from behind when its agent starts and falls in with
// the squad, firing with him while its agent works; quiet, it drops back a
// little, gun lowered; waiting on you, a lamp blinks amber over its head. Done,
// it teleports out in a shimmer of green fog (failed: it falls where it
// stood, and the squad walks on).
//
// A failed command (or a compaction) puts the lights out: the base goes grey
// and dim, smoke drifting under the ceiling (and in the tall view the
// marine's face is bloodied). A nearly-full context floods it with cold blue
// light. While Claude waits on the person he stops and lowers his gun, the
// monsters slink back into the dark and the fireballs fizzle; the computer
// panels and lamps glow through the sepia with each slow breath.
//
// The band is side-on: the corridor's back wall streaming past (tan and grey
// panels, computer banks blinking, doors, windows onto the mountains, wall
// lamps, nukage pools in the floor, flickering lights), the marine on the
// left with the squad behind him, the monsters coming from the right. The
// tall spine is his own view, as the game was: down a corridor fading into
// the dark, doors rising as he nears them, his gun bobbing at the bottom with
// its muzzle flash, and the status bar beneath with his ammo, his health and
// his face, glancing about, grimacing as he fires, grinning at a new gun.
// `doom3d` is the same scene through his eyes everywhere, the band too: it
// asks the adapter for a taller one (`taller`), and a view wider than tall is
// a panorama, each column its own ray (about 140° across a wide band), so
// its edges don't stretch as a flat projection's would; too short for the
// status bar, his ammo, face and health sit in its corners.
// Painted as pixels (2 × 2 a cell) by PixelScene, which eases the level,
// folds the pixels into glyphs and blanks it all at level 0. Everything here
// is drawn from scratch in the spirit of the original; no game data is used.

import type { AgentDial } from './agents'
import { Rng } from './cells'
import { beckon, Crew, easeTo, failed, finished, type AgentMark, type Mate } from './crew'
import { PixelScene, type Dials, type Painter } from './pixel-scene'
import { defineScene } from './scene-def'
import { approach, clamp, grey, hash, hash1, luma, mix, noise1, noise2, rampAt, retain } from './pixels'

// ── Sprites ──────────────────────────────────────────────────────────────

/** A sprite: palette indices, 0 transparent. */
type Sprite = { readonly w: number; readonly h: number; readonly p: Uint8Array }

/** A sprite from rows of characters: '.' transparent, '1'-'9' (and on) a palette index. */
function sprite(rows: readonly string[]): Sprite {
  const h = rows.length
  const w = Math.max(...rows.map(r => r.length))
  const p = new Uint8Array(w * h)
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) p[y * w + x] = r[x] === '.' ? 0 : parseInt(r[x]!, 36)
  })
  return { w, h, p }
}

// The marine, side-on, facing right: 1 armor, 2 its shade, 3 visor, 4 gloves and boots, 5 belt.
const M_TOP = ['..2222..', '.211133.', '.2111112', '21111144', '2111112.', '.25552..']
const M_TOP_REST = ['..2222..', '.211133.', '.2111112', '2111112.', '21111144', '.25552..']
const M_LEGS = [
  ['.11.11..', '.12.12..', '.44.44..'],
  ['.11..11.', '12....12', '44....44'],
  ['..111...', '..112...', '..4444..'],
]
/** Ready (gun up) and at rest (gun lowered), each standing, striding and passing. */
const MARINE = [M_TOP, M_TOP_REST].map(top => M_LEGS.map(legs => sprite([...top, ...legs])))
/** Where the hand is that holds the gun: ready, and at rest. */
const HAND = [
  [7, 3],
  [7, 4],
] as const
/** Doom's co-op colors: the marine's green, then the squad's indigo, brown, red and grey (armor, its shade). */
const ARMOR = [
  [0x3e9a30, 0x24601c],
  [0x4a4ab8, 0x2a2a76],
  [0x94703c, 0x5c4422],
  [0xbc3024, 0x761a12],
  [0xa0a09c, 0x62625e],
] as const
const marinePal = (i: number): number[] => [0, ARMOR[i]![0], ARMOR[i]![1], 0x1c1814, 0x5a4026, 0x7c5c2c]
const MARINE_PAL = ARMOR.map((_, i) => marinePal(i))

/** The four guns, side-on: 3 dark steel, 4 steel, 5 bright steel, 6 wood, 8 plasma. `ax`: how far back of the tip the hand is. */
const PISTOL = 0
const SHOTGUN = 1
const CHAINGUN = 2
const PLASMA = 3
const GUNS = [
  { s: sprite(['345']), ax: 0 },
  { s: sprite(['6633445']), ax: 2 },
  { s: sprite(['3345454', '3333...']), ax: 1 },
  { s: sprite(['33444588', '333333..']), ax: 1 },
]
const GUN_PAL = [0, 0, 0, 0x2e2e30, 0x5c5c60, 0x9a9aa0, 0x7a4a22, 0x4e2c12, 0x50b0ff, 0xd8f0ff]
/** Muzzle flashes: 1 orange, 2 yellow, 3 white (the plasma rifle's in blues). */
const FLASH_SIDE = sprite(['.2.', '232', '.2.'])
const FLASH_PAL = [0, 0xff8020, 0xffd040, 0xfff8d8]
const PLASMA_FLASH_PAL = [0, 0x3070ff, 0x70c0ff, 0xe0f4ff]

// The monsters, facing left. Each: walking (two frames), attacking.
const ZOMBIE = 0
const IMP = 1
const PINKY = 2
const CACO = 3
const FOES = [
  {
    // A zombieman: 1 khaki shirt, 2 pale skin, 3 hair, 4 rifle, 5 green trousers, 6 boots.
    frames: [
      ['..33...', '.2233..', '.222...', '..11...', '44411..', '.1111..', '.5..5..', '.5..5..', '66..66.'],
      ['..33...', '.2233..', '.222...', '..11...', '44411..', '.1111..', '..55...', '..5.5..', '.66.66.'],
      ['..33...', '.2233..', '.222...', '..11...', '44441..', '.1111..', '.5..5..', '.5..5..', '66..66.'],
    ].map(sprite),
    pal: [0, 0x9c8458, 0xb4a48c, 0x2a2218, 0x3a3a3c, 0x4c5c34, 0x2a2418],
    hp: 2,
    speed: 0.3,
    stand: 72,
    near: 36,
    float: 0,
  },
  {
    // An imp: 1 brown hide, 2 its shade, 3 bone spikes, 4 eyes.
    frames: [
      ['3.....3', '.11111.', '.14141.', '3111113', '1.333.1', '..111..', '.11.11.', '.1...1.', '33...33'],
      ['3.....3', '.11111.', '.14141.', '3111113', '1.333.1', '..111..', '..1.1..', '..1.1..', '.33.33.'],
      ['1.3.3.1', '1.111.1', '1141411', '.11111.', '..333..', '..111..', '.11.11.', '.1...1.', '33...33'],
    ].map(sprite),
    pal: [0, 0x86502a, 0x4e2c14, 0xdcc8a2, 0xffc828],
    hp: 3.5,
    speed: 0.36,
    stand: 56,
    near: 30,
    float: 0,
  },
  {
    // A pinky demon: 1 pink hide, 2 its shade, 3 teeth, 4 eye.
    frames: [
      ['...111111.', '..14111111', '.333111111', '.222111111', '.333211111', '..1111111.', '..22..22..'],
      ['...111111.', '..14111111', '.333111111', '.222111111', '.333211111', '..1111111.', '...22.22..'],
      ['...111111.', '..14111111', '3332111111', '2...211111', '3332111111', '..1111111.', '..22..22..'],
    ].map(sprite),
    pal: [0, 0xd47c8a, 0x904454, 0xf2ead2, 0xffe040],
    hp: 7,
    speed: 0.8,
    stand: 14,
    near: 14,
    float: 0,
  },
  {
    // A cacodemon: 1 red hide, 2 its shade, 3 green eye, 4 mouth, 5 teeth, 6 horns.
    frames: [
      ['.6.....6.', '..11111..', '.1113111.', '111333111', '115555511', '114444411', '.1155511.', '..22222..'],
      ['.6.....6.', '..11111..', '.1113111.', '111333111', '115555511', '114444411', '.1155511.', '..22222..'],
      ['.6.....6.', '..11111..', '.1113111.', '115555511', '144444441', '144444441', '.1555551.', '..22222..'],
    ].map(sprite),
    pal: [0, 0xc8301e, 0x861a10, 0x48e048, 0x1c1c60, 0xf0f0e0, 0xd8c8a0],
    hp: 9,
    speed: 0.26,
    stand: 60,
    near: 34,
    float: 3,
  },
] as const

/** The monsters' colors when a blast has torn them apart. */
const GIB_PAL = FOES.map(k => k.pal.map((c, i) => (i ? mix(c, 0x9a1010, 0.6) : c)))

/** A barrel of nukage: 1 its drum, 2 the bands, 3 the glowing slime on top. */
const BARREL = sprite(['3333', '1221', '1111', '1221', '1111', '2222'])
const BARREL_PAL = [0, 0x6c7258, 0x3e4434, 0x5cdc3a]
/** What flies: an imp's fireball, a cacodemon's lightning, the plasma rifle's bolt. */
const BALL = sprite(['.121.', '12321', '23332', '12321', '.121.'])
/** ...and as small as the band can show it. */
const BALL_SMALL = sprite(['121', '232', '121'])
const FIRE_PAL = [0, 0xd03010, 0xff8a20, 0xfff0a0]
const CACO_PAL = [0, 0x9020a0, 0xe050d0, 0xffd0ff]
const BOLT = sprite(['12', '21'])
const BOLT_PAL = [0, 0x3a8aff, 0xd8f4ff]

// The tall view's own: the gun in his hands, its flash, his face, and the status bar's digits.
const FP_GUNS = [
  ['.....55.....', '.....45.....', '.....43.....', '....4433....', '....4433....', '...114431...', '..1111311...', '..1121111...', '.111211111..', '.112211111..', '1122111111..', 'aa222111aa..'],
  ['.....55.....', '.....45.....', '.....45.....', '.....43.....', '....4433....', '....6677....', '....6677....', '...166771...', '..11667711..', '..11444411..', '.1114433111.', '.1124433211.', 'aa22443322aa'],
  ['....5.5.5....', '....4.4.4....', '....45454....', '....45454....', '...3454543...', '...3333333...', '..134444431..', '..113333311..', '.11143334111.', '.11243334211.', 'aa224333422aa'],
  ['.....898.....', '.....989.....', '....49894....', '....45554....', '...4455544...', '...3444443...', '..133333331..', '..113333311..', '.11122222111.', 'aa112222211aa'],
].map(sprite)
/** 1 skin, 2 its shade, 3 dark steel, 4 steel, 5 bright steel, 6 wood, 7 dark wood, 8 and 9 the plasma rifle's glow, a his sleeves. */
const FP_PAL = [0, 0xc08a62, 0x8a5a3a, 0x2e2e30, 0x5c5c60, 0x9a9aa0, 0x7a4a22, 0x4e2c12, 0x50b0ff, 0xd8f0ff, 0x2e6a2a]
const FP_FLASH = sprite(['..1.1..', '.12221.', '1223221', '.12221.', '..121..'])

/** His face: 1 hair, 2 skin, 3 its shade, 4 eye whites, 5 pupils, 6 mouth, 7 blood, 8 teeth, 9 brows. */
const FACE_PAL = [0, 0x5a3a1c, 0xc8946a, 0x946442, 0xece6dc, 0x1a1410, 0x5a2016, 0xb01010, 0xe8e0c8, 0x3a2410]
const FACE_ROWS = (eyes: string, mouth: string, under = '..322223..', brows = '1299229921') => [
  '..111111..',
  '.11111111.',
  '1122222211',
  brows,
  '12' + eyes.slice(0, 2) + '22' + eyes.slice(2) + '21',
  '1222332221',
  '.32222223.',
  mouth,
  under,
  '...3333...',
]
const LOOK_LEFT = 0
const LOOK_AHEAD = 1
const LOOK_RIGHT = 2
const GRIN = 3
const OUCH = 4
const RAGE = 5
const FACES = [
  FACE_ROWS('5454', '.32666623.'),
  FACE_ROWS('4554', '.32666623.'),
  FACE_ROWS('4545', '.32666623.'),
  FACE_ROWS('4554', '.36888863.', '..366663..'),
  FACE_ROWS('4444', '.32266223.', '..326623..', '1222222221'),
  FACE_ROWS('4554', '.38888883.', '..322223..', '1999999991'),
].map(sprite)
/** Where blood shows on his face when things go badly. */
const BLOODY = [
  [2, 2],
  [3, 2],
  [2, 3],
  [7, 5],
  [8, 6],
  [7, 6],
  [5, 8],
] as const
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111']

// ── The world ────────────────────────────────────────────────────────────

/** A stretch of wall, in band pixels: one panel's kind and one sector's light. */
const SEG = 32
/** Band pixels to one unit of the tall view's world (the corridor is two wide). */
const UNIT = 16
/** A sprite pixel, in the tall view's units: the marine stands 0.85 tall, his eyes at 0.62. */
const SPX = 0.095

const TAN = 0
const COMPUTER = 1
const WINDOW = 2
const DOOR = 3
const LAMP = 4
const GREY = 5

function segKind(seg: number, seed: number): number {
  const h = hash1(seg * 7919 + seed)
  return h < 0.32 ? TAN : h < 0.48 ? COMPUTER : h < 0.6 ? WINDOW : h < 0.7 ? DOOR : h < 0.84 ? LAMP : GREY
}

/** A sector's light: most steady, a few flickering as Doom's broken lights do. */
function segLight(seg: number, t: number, seed: number): number {
  let l = 0.6 + 0.24 * hash1(seg * 977 + seed)
  if (segKind(seg, seed) === LAMP) l += 0.2
  if (hash1(seg * 131 + seed + 5) < 0.14 && hash1(((t >> 1) * 7 + seg * 13) ^ seed) < 0.22) l *= 0.5
  return l
}

/** What the last texel was: a light of its own (a lamp: shines through the sepia) or glowing (unlit by the sector). */
let lampHit = false
let glowHit = false
/** A window's texel: the sky beyond, drawn by the caller. */
const SKY = -2

/** The wall at `lx` across its stretch (0..SEG), `v` up it (0 the floor, 1 the ceiling). */
function wallTex(kind: number, lx: number, v: number, seg: number, t: number, seed: number): number {
  lampHit = false
  glowHit = false
  const p = lx & 15
  switch (kind) {
    case COMPUTER: {
      if (lx < 2 || lx > 29 || v < 0.16 || v > 0.86) return lx === 1 || lx === 30 ? 0x3a3a38 : 0x5e5e5a
      const row = Math.floor(v * 11)
      if ((lx & 3) === 2 && (row & 1) === 0) {
        const h = hash(seg * 64 + lx, row, seed)
        if (hash(lx + (t >> 3) * 17, row + seg * 5, seed) < 0.72) {
          lampHit = true
          return h < 0.4 ? 0x38e848 : h < 0.65 ? 0xe83020 : h < 0.85 ? 0xf0d040 : 0x40d8e8
        }
        return 0x2a3034
      }
      return 0x1c2024
    }
    case WINDOW:
      if (lx < 4 || lx > 27) return lx === 0 || lx === 31 ? 0x3e2e1a : (lx & 1) && ((v * 9) | 0) % 3 === 0 ? 0x4a3820 : 0x70563a
      if (v < 0.2 || v > 0.86) return v < 0.12 ? 0x5c503e : 0x7e705a
      if (lx === 4 || lx === 27 || v < 0.25 || v > 0.81) return 0x2a2622
      return SKY
    case DOOR:
      if (v >= 0.82) return p === 0 ? 0x3e352a : 0x7f705a
      if (lx === 4 || lx === 5 || lx === 26 || lx === 27) return (lx + Math.floor(v * 12)) & 1 ? 0xd8b020 : 0x201c14
      if (lx === 6 || lx === 25) return 0x4c4c48
      if (lx === 15 || lx === 16) return 0x5a5852
      return Math.floor(v * 16) % 3 === 0 ? 0x6a6862 : 0x8c8a82
    case LAMP:
      if (lx >= 13 && lx <= 18 && v >= 0.5 && v <= 0.7) {
        if (lx >= 14 && lx <= 17 && v >= 0.54 && v <= 0.66) {
          lampHit = true
          return 0xfff4d0
        }
        return 0x6a6a64
      }
      break
    case GREY:
      if (p === 0) return 0x3e3e3a
      if (p === 1) return 0x9c9c96
      if (v < 0.14) return 0x50504c
      return hash(lx + seg * SEG, Math.floor(v * 12), seed) < 0.1 ? 0x6c6c68 : 0x7c7c78
  }
  // Tan panels (and round the lamps).
  if (p === 0) return 0x3e352a
  if (p === 1) return 0x9e8d70
  if (v < 0.14) return 0x5a4e3e
  if (v > 0.6 && v < 0.72) return 0x625642
  return hash(lx + seg * SEG, Math.floor(v * 12), seed) < 0.1 ? 0x706450 : 0x7f705a
}

/** Through a window: grey-blue sky over brown mountains (`sx` across the view, `v` up the window, 0..1). */
function skyTex(sx: number, v: number, seed: number): number {
  glowHit = true
  const m = 0.3 + 0.32 * noise1(sx * 0.07, seed) + 0.12 * noise1(sx * 0.23, seed + 3)
  if (v < m) return v < m - 0.12 ? 0x4a3e32 : 0x64544a
  return v - m > 0.3 ? 0xa0a8b4 : 0x7c8898
}

/** The floor at `a` along and `lat` across (band pixels): brown tiles, now and then a pool of nukage. */
function floorTex(a: number, lat: number, t: number, seed: number): number {
  lampHit = false
  glowHit = false
  const seg = Math.floor(a / SEG)
  const lx = a - seg * SEG
  if (hash1(seg * 31 + 7 + seed) < 0.16 && lx > 3 && lx < 28 && Math.abs(lat) < 12) {
    if (lx === 4 || lx === 27 || Math.abs(lat) >= 11) return 0x4a4a44
    glowHit = true
    const n = noise2(a * 0.22 + t * 0.05, lat * 0.25 - t * 0.03, seed)
    return n < 0.4 ? 0x1e6a10 : n < 0.68 ? 0x36a01c : 0x6ad83a
  }
  const l = Math.floor(lat)
  if ((a & 15) === 0 || (l & 15) === 0) return 0x3a3428
  // Each tile its own shade, worn in patches.
  const tile = hash(a >> 4, l >> 4, seed) < 0.5
  const worn = hash(a >> 2, l >> 2, seed + 1) < 0.22
  return tile ? (worn ? 0x52483a : 0x5c5242) : worn ? 0x4c4436 : 0x564c3e
}

/** The ceiling: dark tiles, a light panel every other stretch. */
function ceilTex(a: number, lat: number): number {
  lampHit = false
  glowHit = false
  const m = ((a % 64) + 64) % 64
  if (m >= 28 && m < 36 && Math.abs(lat) < 4) {
    glowHit = true
    return 0xf0ecd8
  }
  const l = Math.floor(lat)
  if ((a & 15) === 0 || (l & 15) === 0) return 0x2c2822
  return hash(a >> 2, l >> 2, 77) < 0.2 ? 0x36302a : 0x3c362e
}

/** `c` lit at `l` (1 its own color). */
function lit(c: number, l: number): number {
  if (l === 1) return c
  const r = Math.min(255, ((c >> 16) & 255) * l) | 0
  const g = Math.min(255, ((c >> 8) & 255) * l) | 0
  const b = Math.min(255, (c & 255) * l) | 0
  return (r << 16) | (g << 8) | b
}

/** Light in eighths: Raster paints at most 1024 color pairs a frame. */
const q8 = (l: number) => Math.round(l * 8) / 8

/** The cold blue light of a nearly-full context, by brightness (lifting the dark: it floods the base). */
const BLUE = [0x0c1a48, 0x2048a8, 0x5a8ae8, 0xb4d4ff, 0xf0f6ff]

/** `c` under the tints: `s` of the way to grey and dim (smoke), `b` of the way to cold blue. */
function tone(c: number, s: number, b: number): number {
  if (s > 0) c = mix(c, lit(grey(c, 1), 0.42), s)
  if (b > 0) c = mix(c, rampAt(BLUE, 0.22 + 0.78 * (luma(c) / 255)), b)
  return c
}

// ── What moves ───────────────────────────────────────────────────────────

/** How fast he goes at each level (band pixels a frame): a plod at 1, running at 10. */
const SPEED = [0, 0.15, 0.24, 0.34, 0.46, 0.6, 0.78, 1, 1.28, 1.62, 2.05]
/** Frames between shots, by gun, at the bottom and the top of its range. */
const RATE = [
  [20, 12],
  [16, 11],
  [5, 3],
  [3, 2],
] as const
/** Damage a shot does, by gun (a zombieman takes 2, a cacodemon 9). */
const DAMAGE = [1, 4, 1, 1.6]
/** Where each gun's range of levels starts and ends. */
const GUN_FROM = [0, 2.5, 5.5, 8.5, 10]
/** He stands his ground when a monster's this close (band pixels). */
const HOLD = 28
/** ...and in the tall view, where they come nearer to be seen. */
const HOLD_NEAR = 22
/** Frames a weapon switch takes (lowered, then raised). */
const SWITCH = 14
/** Frames a monster takes to fall. */
const DIE_T = 8

const WALK = 0
const ATTACK = 1
const PAIN = 2
const DIE = 3
const DEAD = 4
const FLEE = 5

type Foe = { kind: number; x: number; u: number; hp: number; st: number; t: number; walk: number; cool: number; flash: number; gib: boolean; seed: number }
type Missile = { kind: number; x: number; u: number; h: number; v: number; t: number }
type Puff = { kind: number; x: number; u: number; h: number; t: number; life: number; seed: number }
type Barrel = { x: number; u: number; fuse: number }
type Door = { x: number; open: number }

const BALL_FIRE = 0
const BALL_CACO = 1
const BALL_PLASMA = 2
const BLOOD = 0
const DUST = 1
const BOOM = 2
const SPARK = 3

/** The squad: as many as can follow him, frames to arrive and to leave. */
const SQUAD = 4
const ARRIVE = 30
const LEAVE = 34

function speedAt(level: number): number {
  const l = clamp(level, 0, 10)
  const i = Math.min(9, Math.floor(l))
  return SPEED[i]! + (SPEED[i + 1]! - SPEED[i]!) * (l - i)
}

function gunFor(level: number, now: number): number {
  // A little either side of each change, so a level hovering there doesn't swap guns back and forth.
  let g = now
  while (g < PLASMA && level > GUN_FROM[g + 1]! + 0.25) g++
  while (g > PISTOL && level < GUN_FROM[g]! - 0.25) g--
  return g
}

function rateOf(gun: number, level: number): number {
  const k = clamp((level - GUN_FROM[gun]!) / Math.max(0.5, GUN_FROM[gun + 1]! - GUN_FROM[gun]!))
  return Math.round(RATE[gun]![0] + (RATE[gun]![1] - RATE[gun]![0]) * k)
}

export class Doom extends PixelScene {
  /** The subagents, one by one: each a marine of the squad. */
  agents: readonly AgentDial[] = []
  /** The squad (`x`: how far along from him, band pixels; `y`: frames to its next shot). */
  private crew = new Crew(SQUAD, ARRIVE, LEAVE)
  private rng: Rng
  /** How far he's come, band pixels, and how fast he's going. */
  private pos = 0
  private v = 0
  /** How far his legs have gone: their stride. */
  private walk = 0
  private gun = PISTOL
  private nextGun = PISTOL
  private switchT = 0
  private cool = 0
  private flash = 0
  private recoil = 0
  /** Frames since he last fired, or had something in his sights. */
  private sinceShot = 999
  private sinceSighted = 999
  private ammo = [50, 20, 120, 100]
  private hp = 100
  private ouch = 0
  private grin = 0
  private look = LOOK_AHEAD
  private lookT = 0
  private spawnT = 40
  private foes: Foe[] = []
  private missiles: Missile[] = []
  private puffs: Puff[] = []
  private barrels: Barrel[] = []
  private doors: Door[] = []
  /** The last stretch of corridor given its barrels (and, in the tall view, its doors). */
  private laid = Number.NaN
  /** The smoke and the blue, eased, and in sixths. */
  private kSmk = 0
  private kBlu = 0
  private hold = false

  // Layout, from the grid.
  private W = 0
  private H = 0
  private tall = false
  /** Band: his column. Tall: the view's height (above the status bar), the status bar's. */
  private mx = 0
  private hv = 0
  private sb = 0
  /** Tall: each pixel's depth (sprites hide behind a closed door, and behind each other). */
  private zb = new Float32Array(0)
  private sp: number[] = new Array(16).fill(0)
  private sp2: number[] = new Array(16).fill(0)
  /**
   * Tall: how the view is projected. In a pane taller than wide, flat (as the
   * game: `fy` pixels a unit at a unit away, across and down); in a view wider
   * than tall, a panorama (`fth` pixels a radian across, so the far edges
   * don't stretch): each column's ray, `ux` across and `uz` ahead.
   */
  private pano = false
  private fy = 1
  private fth = 1
  private ux = new Float32Array(0)
  private uz = new Float32Array(0)

  /** Whether it asks for a taller band than the side-on view's: through his eyes everywhere. */
  readonly taller: boolean

  /** `firstPerson`: his own view in every layout, the band too (doom3d), not only in a tall pane. */
  constructor(seed = 1, readonly firstPerson = false) {
    super(seed)
    this.taller = firstPerson
    this.rng = new Rng(Math.imul(seed, 2654435761) ^ 0x51ed27)
  }

  /** The gun he has now: 0 the pistol, 1 the shotgun, 2 the chaingun, 3 the plasma rifle. */
  get weapon(): number {
    return this.gun
  }

  /** How fast he's going (band pixels a frame). */
  get speed(): number {
    return this.v
  }

  /** How far he's come (band pixels). */
  get distance(): number {
    return this.pos
  }

  /** The monsters coming at him (not falling, fallen, or slinking away). */
  get coming(): number {
    return this.foes.filter(f => f.st < DIE).length
  }

  /** Shots he's fired since the scene began. */
  shots = 0

  agentMarks(): readonly AgentMark[] {
    return this.strength > 0 ? this.crew.marks : []
  }

  protected resize(d: Dials): void {
    this.W = d.columns * 2
    this.H = d.rows * 2
    this.tall = d.tall || this.firstPerson
    this.mx = clamp(Math.round(this.W * 0.32), 8, Math.max(8, this.W - 16))
    this.sb = this.tall && this.H >= 50 ? clamp(Math.round(this.H * 0.13), 12, 14) : 0
    this.hv = this.H - this.sb
    this.zb = new Float32Array(this.W * Math.max(1, this.hv))
    this.project()
    this.laid = Number.NaN
    this.doors.length = 0
    this.barrels.length = 0
  }

  /** The tall view's projection for this size (see `pano`). */
  private project(): void {
    const W = this.W
    const HV = Math.max(1, this.hv)
    this.pano = this.tall && W > HV
    this.ux = new Float32Array(W)
    this.uz = new Float32Array(W)
    if (this.pano) {
      // Wider the view, wider the sweep it takes in (to about 140° across a wide band); down it, a little
      // more than his height between the floor at its foot and the ceiling at its top.
      const fov = clamp(0.9 + 0.27 * (W / (2 * HV)), 1.4, 2.4)
      this.fth = W / fov
      this.fy = HV
      for (let x = 0; x < W; x++) {
        const a = (x + 0.5 - W / 2) / this.fth
        this.ux[x] = Math.sin(a)
        this.uz[x] = Math.cos(a)
      }
    } else {
      this.fy = this.fth = W * 0.72
      for (let x = 0; x < W; x++) {
        this.ux[x] = (x + 0.5 - W / 2) / this.fy
        this.uz[x] = 1
      }
    }
  }

  /** Where a point `x` along (band pixels), `u` across lands in the tall view: false if out of sight. Sets `px`, `pt` (its distance), `pk` (pixels a unit there). */
  private onView(x: number, u: number, nearest: number): boolean {
    const z = (x - this.pos) / UNIT
    if (z < nearest || z > 12) return false
    if (this.pano) {
      this.pt = Math.hypot(u, z)
      this.ps = this.W / 2 + Math.atan2(u, z) * this.fth
    } else {
      this.pt = z
      this.ps = this.W / 2 + (this.fth * u) / z
    }
    this.pk = this.fy / this.pt
    return true
  }
  private ps = 0
  private pt = 0
  private pk = 0

  /** How far ahead of him a monster comes into sight (band pixels). */
  private ahead(): number {
    return this.tall ? 11 * UNIT : this.W - this.mx
  }

  /** How far he can shoot. */
  private range(): number {
    return this.tall ? 6.5 * UNIT : Math.max(36, this.ahead() * 0.82)
  }

  /** How far behind him things are out of sight. */
  private behind(): number {
    return this.tall ? 8 : this.mx + 16
  }

  /** How many of the squad this layout shows: behind him in the band, ahead of him in the tall view. */
  private room(): number {
    if (this.tall) return this.W >= 28 ? SQUAD : 2
    return clamp(Math.floor((this.mx - 6) / 11), 0, SQUAD)
  }

  /** A closed door between him and `x` (the tall view's): nothing beyond it can be seen or shot. */
  private blocked(x: number): boolean {
    for (const dr of this.doors) if (dr.x > this.pos && dr.x < x && dr.open < 0.7) return true
    return false
  }

  // ── Each frame ──

  protected update(d: Dials): void {
    const L = d.level
    this.kSmk = approach(this.kSmk, d.tint === 'smoke' ? 1 : 0, 0.1)
    this.kBlu = approach(this.kBlu, d.tint === 'blue' ? 1 : 0, 0.1)
    this.hold = d.wait > 0.3
    this.lay()
    this.updateGun(L)
    this.updateHim(L)
    this.updateFoes(L)
    this.updateSquad(L, d)
    this.updateMissiles()
    this.updateDoors()
    for (const p of this.puffs) p.t++
    retain(this.puffs, p => p.t < p.life)
    for (const b of this.barrels) if (b.fuse > 0 && --b.fuse === 0) this.explode(b)
    const gone = this.pos - this.behind() - 24
    retain(this.barrels, b => b.fuse >= 0 && b.x > gone)
    retain(this.foes, f => (f.st === DEAD ? f.x > gone : f.st !== FLEE || f.x - this.pos < this.ahead() + 20))
    // (No more than a few dozen fallen lying about: the oldest go first.)
    let dead = 0
    for (let i = this.foes.length - 1; i >= 0; i--) if (this.foes[i]!.st === DEAD && ++dead > 30) this.foes.splice(i, 1)
    this.updateFace(d)
  }

  /** Barrels along the walls (and, in the tall view, doors across the corridor) for the stretches coming into sight. */
  private lay(): void {
    const to = Math.floor((this.pos + this.ahead() + 40) / SEG)
    if (Number.isNaN(this.laid)) this.laid = Math.floor((this.pos - this.behind()) / SEG) - 1
    while (this.laid < to) {
      const seg = ++this.laid
      if (hash1(seg * 53 + this.seed) < 0.24)
        this.barrels.push({ x: seg * SEG + 6 + Math.floor(hash1(seg * 59 + this.seed) * 20), u: hash1(seg * 61 + this.seed) < 0.5 ? -0.78 : 0.78, fuse: 0 })
      if (this.tall && seg * SEG > this.pos + 2 * UNIT && hash1(seg * 41 + this.seed + 9) < 0.2) this.doors.push({ x: seg * SEG, open: 0 })
    }
  }

  private updateGun(L: number): void {
    const want = gunFor(L, this.nextGun)
    if (want !== this.nextGun && this.switchT === 0) {
      this.nextGun = want
      this.switchT = 1
    }
    if (this.switchT > 0) {
      this.switchT++
      if (this.switchT === SWITCH >> 1) {
        this.gun = this.nextGun
        this.grin = 22
      }
      if (this.switchT >= SWITCH) this.switchT = 0
    }
  }

  /** The nearest monster still coming at him: how far ahead (Infinity: none). */
  private nearest(): number {
    let best = Infinity
    for (const f of this.foes) if (f.st < DIE && f.x - this.pos > -4) best = Math.min(best, f.x - this.pos)
    return best
  }

  /** What he (or one of the squad, from `from`) shoots at: a barrel with a monster by it, else the nearest monster. */
  private target(from: number, barrels: boolean): Foe | Barrel | undefined {
    const range = this.range()
    if (barrels)
      for (const b of this.barrels) {
        const db = b.x - from
        if (b.fuse !== 0 || db < 34 || db > range || this.blocked(b.x)) continue
        for (const f of this.foes) if (f.st < DIE && Math.abs(f.x - b.x) < 16) return b
      }
    let best: Foe | undefined
    for (const f of this.foes) {
      if (f.st >= DIE) continue
      const df = f.x - from
      if (df < -2 || df > range || this.blocked(f.x)) continue
      if (!best || f.x < best.x) best = f
    }
    return best
  }

  private updateHim(L: number): void {
    let goal = this.hold ? 0 : speedAt(L)
    if (this.nearest() < (this.tall ? HOLD_NEAR : HOLD)) goal = 0
    this.v += clamp(goal - this.v, -0.06, 0.035)
    if (Math.abs(this.v) < 0.005) this.v = 0
    this.pos += this.v
    this.walk += this.v
    this.flash = Math.max(0, this.flash - 1)
    this.recoil = Math.max(0, this.recoil - 1)
    this.cool--
    this.sinceShot++
    this.sinceSighted++
    if (this.hold || L <= 0 || this.switchT > 0) return
    const tg = this.target(this.pos, true)
    if (!tg) return
    this.sinceSighted = 0
    if (this.cool > 0) return
    this.cool = rateOf(this.gun, L)
    this.flash = this.gun === CHAINGUN || this.gun === PLASMA ? 1 : 2
    this.recoil = this.gun === SHOTGUN ? 5 : 2
    this.sinceShot = 0
    this.shots++
    this.ammo[this.gun]!--
    if (this.ammo[this.gun]! < 5) this.ammo[this.gun]! += [50, 20, 100, 100][this.gun]!
    this.shoot(tg, this.gun, 1, this.pos + (this.tall ? 16 : 8))
  }

  /** A shot from `gun` at `tg`, doing `k` of its damage; a plasma bolt leaves from `muzzle`. */
  private shoot(tg: Foe | Barrel, gun: number, k: number, muzzle: number): void {
    if (gun === PLASMA) {
      this.missiles.push({ kind: BALL_PLASMA, x: muzzle, u: 0.12, h: 5, v: 7, t: 0 })
      return
    }
    if (!('kind' in tg)) {
      this.explode(tg)
      return
    }
    this.hit(tg, DAMAGE[gun]! * k)
    if (gun === SHOTGUN) {
      for (let i = 0; i < 2; i++) this.puff(BLOOD, tg.x + (this.rng.f() - 0.5) * 6, tg.u, 2 + this.rng.f() * 6, 5)
      for (const f of this.foes) if (f !== tg && f.st < DIE && Math.abs(f.x - tg.x) < 10) this.hit(f, k)
    }
  }

  private hit(f: Foe, dmg: number): void {
    const kind = FOES[f.kind]!
    this.puff(BLOOD, f.x + (this.rng.f() - 0.5) * 3, f.u, kind.float + 2 + this.rng.f() * 5, 5)
    f.hp -= dmg
    if (f.hp <= 0) {
      f.st = DIE
      f.t = 0
      f.gib = dmg >= 8
    } else if (f.st === WALK && this.rng.f() < 0.45) {
      f.st = PAIN
      f.t = 3
    }
  }

  private explode(b: Barrel): void {
    if (b.fuse < 0) return
    b.fuse = -1
    this.puff(BOOM, b.x + 2, b.u, 3, 9)
    for (const f of this.foes) if (f.st < DIE && Math.abs(f.x - b.x) < 22) this.hit(f, 12)
    for (const o of this.barrels) if (o.fuse === 0 && Math.abs(o.x - b.x) < 20) o.fuse = 3
  }

  private puff(kind: number, x: number, u: number, h: number, life: number): void {
    if (this.puffs.length < 80) this.puffs.push({ kind, x, u, h, t: 0, life, seed: this.rng.int() & 0xffff })
  }

  private updateFoes(L: number): void {
    const ahead = this.ahead()
    let up = 0
    for (const f of this.foes) if (f.st < DIE) up++
    if (!this.hold && L > 0) {
      this.spawnT--
      const most = 1 + Math.round(L * 0.75)
      if (this.spawnT <= 0 && up < most) {
        this.spawn(L, ahead)
        this.spawnT = Math.round((230 - 218 * Math.pow(clamp(L / 10), 0.6)) * (0.6 + 0.8 * this.rng.f()))
      }
    }
    const pace = 0.7 + 0.06 * L
    for (const f of this.foes) {
      const kind = FOES[f.kind]!
      f.flash = Math.max(0, f.flash - 1)
      if (f.st === DIE) {
        if (++f.t >= DIE_T) f.st = DEAD
        continue
      }
      if (f.st === DEAD) continue
      if (this.hold) f.st = FLEE
      else if (f.st === FLEE) f.st = WALK
      const dist = f.x - this.pos
      if (f.st === FLEE) {
        // Back into the dark, away from him.
        f.x += kind.speed * pace + 0.25
        f.walk += kind.speed * pace + 0.25
        continue
      }
      if (f.st === PAIN) {
        if (--f.t <= 0) f.st = WALK
        continue
      }
      if (f.st === ATTACK) {
        f.t++
        if (f.t === 4) this.attack(f)
        if (f.t >= 9) {
          f.st = WALK
          f.cool = Math.round((50 + 60 * this.rng.f()) * (1.3 - 0.07 * L))
        }
        continue
      }
      const stand = this.tall ? kind.near : kind.stand
      if (dist > stand) {
        const step = Math.min(kind.speed * pace, dist - stand)
        f.x -= step
        f.walk += step
      }
      if (--f.cool <= 0 && dist < ahead - 4 && !this.blocked(f.x) && (f.kind !== PINKY || dist < stand + 4)) {
        f.st = ATTACK
        f.t = 0
      }
    }
  }

  private spawn(L: number, ahead: number): void {
    const w = [1, L >= 2 ? 0.9 : 0, L >= 4 ? 0.45 + 0.05 * L : 0, L >= 6 ? 0.25 + 0.05 * L : 0]
    let r = this.rng.f() * (w[0]! + w[1]! + w[2]! + w[3]!)
    let kind = 0
    while (kind < 3 && r >= w[kind]!) r -= w[kind++]!
    const k = FOES[kind]!
    this.foes.push({
      kind,
      x: this.pos + ahead + 6 + this.rng.f() * 14,
      u: (this.rng.f() * 2 - 1) * 0.5,
      hp: k.hp,
      st: WALK,
      t: 0,
      walk: this.rng.f() * 8,
      cool: 20 + Math.floor(this.rng.f() * 40),
      flash: 0,
      gib: false,
      seed: this.rng.int() & 0xffff,
    })
  }

  private attack(f: Foe): void {
    const dist = f.x - this.pos
    if (f.kind === ZOMBIE) {
      f.flash = 2
      if (this.rng.f() < 0.25) this.hurt(2 + this.rng.f() * 4)
    } else if (f.kind === IMP) {
      this.missiles.push({ kind: BALL_FIRE, x: f.x - 2, u: f.u, h: 6, v: 1.5, t: 0 })
    } else if (f.kind === CACO) {
      this.missiles.push({ kind: BALL_CACO, x: f.x - 3, u: f.u, h: FOES[CACO].float + 4, v: 1.15, t: 0 })
    } else if (dist < FOES[PINKY].stand + 6) {
      this.hurt(3 + this.rng.f() * 5)
    }
  }

  private hurt(n: number): void {
    this.hp = Math.max(12, this.hp - n)
    this.ouch = 8
  }

  private updateMissiles(): void {
    for (const m of this.missiles) {
      m.t++
      if (m.kind === BALL_PLASMA) {
        m.x += m.v
        for (const f of this.foes)
          if (f.st < DIE && m.x >= f.x - 2 && m.x - m.v <= f.x + 6) {
            this.hit(f, DAMAGE[PLASMA]!)
            m.t = -1
            break
          }
        if (m.x - this.pos > this.range() + 20 || this.blocked(m.x)) m.t = -1
        continue
      }
      if (this.hold) {
        // Fizzling out as everything settles.
        this.puff(SPARK, m.x, m.u, m.h, 4)
        m.t = -1
        continue
      }
      m.x -= m.v
      // Homing in on him (the tall view's camera): toward the middle of the corridor and down to his chest.
      const dist = m.x - this.pos
      const k = m.v / Math.max(m.v, dist)
      m.u += (0 - m.u) * k
      m.h += (5 - m.h) * k
      if (dist < 4) {
        this.puff(SPARK, this.pos + 4, 0, 5, 5)
        this.hurt(4 + this.rng.f() * 6)
        m.t = -1
      }
    }
    retain(this.missiles, m => m.t >= 0)
  }

  private updateDoors(): void {
    for (const dr of this.doors) {
      let want = dr.x - this.pos < 3.5 * UNIT ? 1 : 0
      for (const f of this.foes) if (f.st !== DEAD && Math.abs(f.x - dr.x) < 1.2 * UNIT) want = 1
      dr.open = clamp(dr.open + (want ? 0.045 : -0.03))
    }
    retain(this.doors, dr => dr.x > this.pos - 2 * UNIT)
  }

  /** Where a member of the squad keeps, from him (band pixels; behind him in the band, ahead in the tall view). */
  private squadPlace(m: Mate): number {
    const rest = m.busy < 0.5 && !m.leaving
    if (this.tall) return [24, 32, 46, 54][m.slot]! * (rest ? 0.7 : 1)
    return -(11 + m.slot * 11) - (rest ? 5 : 0)
  }

  private updateSquad(L: number, d: Dials): void {
    this.crew.room = this.room()
    this.crew.update(this.agents, d.boost)
    for (const m of this.crew.mates) {
      if (Number.isNaN(m.x)) {
        // In from behind: past the band's left edge, or past him in the tall view.
        m.x = this.tall ? -14 : -(this.mx + 10)
        m.y = 10 + Math.floor(m.seed * 20)
      }
      if (failed(m)) {
        // It fell where it stood: the squad walks on.
        m.x -= this.v
        continue
      }
      if (finished(m)) continue
      m.x = easeTo(m.x, this.squadPlace(m), m.age < ARRIVE * 2 ? 0.07 : 0.05)
      m.y--
      if (this.hold || m.busy < 0.5 || m.here < 0.6 || this.switchT > 0) continue
      const at = this.pos + m.x
      const tg = this.target(at, false)
      if (!tg || m.y > 0) continue
      m.y = Math.round(rateOf(this.gun, L) * (1.4 + m.seed * 0.6))
      this.shoot(tg, this.gun, 0.6, at + 8)
    }
  }

  private updateFace(d: Dials): void {
    this.ouch = Math.max(0, this.ouch - 1)
    this.grin = Math.max(0, this.grin - 1)
    if (d.t % 12 === 0) this.hp = Math.min(100, this.hp + 1)
    if (--this.lookT <= 0) {
      const r = this.rng.f()
      this.look = this.hold ? LOOK_AHEAD : r < 0.3 ? LOOK_LEFT : r < 0.6 ? LOOK_RIGHT : LOOK_AHEAD
      this.lookT = 18 + Math.floor(this.rng.f() * 30)
    }
  }

  // ── Drawing ──

  paint(px: Painter, d: Dials): void {
    this.crew.clearMarks()
    if (this.tall) this.paintView(px, d)
    else this.paintBand(px, d)
    // The tints over it all (a little less on the figures, so they still read).
    const s = Math.round(this.kSmk * 6) / 6
    const b = Math.round(this.kBlu * 6) / 6
    if (s <= 0 && b <= 0) return
    for (let i = 0; i < px.px.length; i++) {
      const k = px.keep[i] ? 0.5 : 1
      px.px[i] = tone(px.px[i]!, s * k, b * k)
    }
    for (let i = 0; i < px.lamps.length; i++) if (px.lamps[i]! >= 0) px.lamps[i] = tone(px.lamps[i]!, s * 0.5, b * 0.5)
  }

  /** A sprite with its top left at (x0, y0), `scale` pixels a sprite pixel, `rows` of it squashed into its height (a fall). */
  private blit(px: Painter, s: Sprite, pal: readonly number[], x0: number, y0: number, flip: boolean, scale = 1, rows = s.h, fade = 1, seed = 0, z = -1, lamp = -1): void {
    const dw = Math.max(1, Math.round(s.w * scale))
    const dh = Math.max(1, Math.round(rows * scale))
    const X0 = Math.round(x0)
    const Y0 = Math.round(y0)
    const W = px.w
    const yMax = z >= 0 ? this.hv : px.h
    for (let j = 0; j < dh; j++) {
      const y = Y0 + j
      if (y < 0 || y >= yMax) continue
      const sy = Math.min(s.h - 1, Math.floor(((j + 0.5) / dh) * s.h))
      for (let i = 0; i < dw; i++) {
        const x = X0 + i
        if (x < 0 || x >= W) continue
        let sx = Math.min(s.w - 1, Math.floor(((i + 0.5) / dw) * s.w))
        if (flip) sx = s.w - 1 - sx
        const c = s.p[sy * s.w + sx]!
        if (!c) continue
        if (fade < 1 && hash(i, j, seed) >= fade) continue
        if (z >= 0) {
          const k = y * W + x
          if (this.zb[k]! <= z) continue
          this.zb[k] = z
        }
        if (c === lamp) px.lamp(x, y, pal[c]!)
        else px.set(x, y, pal[c]!, true)
      }
    }
  }

  /** `pal` lit at `l`, into one of the two scratch palettes. */
  private shade(pal: readonly number[], l: number, second = false): number[] {
    const out = second ? this.sp2 : this.sp
    for (let i = 0; i < pal.length; i++) out[i] = lit(pal[i]!, l)
    return out
  }

  /** Whether he has his gun up: something in his sights lately, and not holding for the person. */
  private ready(): boolean {
    return !this.hold && this.sinceSighted < 40
  }

  // The band: side-on.

  private paintBand(px: Painter, d: Dials): void {
    const W = px.w
    const H = px.h
    const camX = this.pos - this.mx
    const ceil = H >= 8 ? 1 : 0
    const floorRows = H >= 8 ? 2 : 1
    const wallBot = H - floorRows
    const wallRows = Math.max(1, wallBot - ceil)
    const fx = this.mx + 9
    const flashing = this.flash > 0
    const smoke = this.kSmk
    for (let x = 0; x < W; x++) {
      const a = Math.floor(camX + x)
      const seg = Math.floor(a / SEG)
      const lx = a - seg * SEG
      const kind = segKind(seg, this.seed)
      const sl = segLight(seg, d.t, this.seed)
      const boost = flashing ? 0.35 * Math.max(0, 1 - Math.abs(x - fx) / 14) : 0
      for (let y = 0; y < H; y++) {
        let c: number
        if (y < ceil) c = ceilTex(a, 0)
        else if (y < wallBot) {
          const v = 1 - (y - ceil + 0.5) / wallRows
          c = wallTex(kind, lx, v, seg, d.t, this.seed)
          if (c === SKY) c = skyTex(x + camX * 0.15, (v - 0.25) / 0.56, this.seed)
        } else c = floorTex(a, (y - wallBot) * 8 - 4, d.t, this.seed)
        const lamp = lampHit
        if (!lamp && !glowHit) c = lit(c, q8(sl + boost))
        if (smoke > 0 && y < wallBot) {
          // Smoke drifting under the ceiling.
          const n = noise2(a * 0.07 - d.t * 0.05, y * 0.45, this.seed + 11)
          if (n > 0.45) c = mix(c, 0x707070, Math.round(smoke * (n - 0.45) * 2.2 * 4) / 4)
        }
        if (lamp) px.lamp(x, y, c)
        else px.set(x, y, c)
      }
    }
    // (In a band too short for them, their feet go below the bottom rather than their heads off the top.)
    const foot = H - 1 + (H < 10 ? (10 - H) >> 1 : 0)
    const sx = (wx: number) => Math.round(wx - camX)
    // Barrels by the wall, then the fallen, then those still up (the farthest first).
    for (const b of this.barrels) {
      const x = sx(b.x)
      if (x > -6 && x < W + 2) this.blit(px, BARREL, BARREL_PAL, x, foot + 1 - BARREL.h - 1, false, 1, BARREL.h, 1, 0, -1, 3)
    }
    for (let round = 0; round < 2; round++)
      for (let i = this.foes.length - 1; i >= 0; i--) {
        const f = this.foes[i]!
        if ((f.st === DEAD || f.st === DIE) !== (round === 0)) continue
        this.drawFoeBand(px, f, sx(f.x), foot, d)
      }
    // The squad, the farthest back first, then him.
    for (let s = SQUAD - 1; s >= 0; s--) {
      const m = this.crew.inSlot(s)
      if (m) this.drawMateBand(px, m, sx(this.pos + m.x), foot, d)
    }
    this.drawMarineBand(px, 0, this.mx, foot, this.ready() ? 0 : 1, this.walk, this.v > 0.02, this.flash > 0, 1, 0, -1)
    for (const m of this.missiles) {
      const x = sx(m.x)
      const y = foot - Math.round(m.h)
      if (m.kind === BALL_PLASMA) {
        this.blit(px, BOLT, BOLT_PAL, x, y - 1, false)
        px.set(x - 2, y, 0x3a6ac8, true)
      } else {
        this.blit(px, BALL_SMALL, m.kind === BALL_FIRE ? FIRE_PAL : CACO_PAL, x - 1, y - 1, (m.t & 2) === 0)
        px.set(x + 2, y, m.kind === BALL_FIRE ? 0xa02810 : 0x701880, true)
      }
    }
    for (const p of this.puffs) this.drawPuffBand(px, p, sx(p.x), foot)
  }

  private drawFoeBand(px: Painter, f: Foe, x: number, foot: number, d: Dials): void {
    const kind = FOES[f.kind]!
    const W = px.w
    if (x < -12 || x > W + 4) return
    const frame = f.st === ATTACK && f.t >= 2 && f.t < 7 ? 2 : Math.floor(f.walk / 3) & 1
    const s = kind.frames[frame]!
    const bob = kind.float ? Math.round(Math.sin(d.t * 0.12 + f.seed) * 0.8) : 0
    if (f.st === DIE || f.st === DEAD) {
      const k = f.st === DEAD ? 1 : f.t / DIE_T
      const rows = Math.max(2, Math.round(s.h - (s.h - 2) * k))
      const lift = Math.round(kind.float * (1 - k))
      if (k > 0.5) for (let i = -1; i < s.w + 1; i++) px.set(x + i, foot, f.gib ? 0x9a0c0c : 0x6a0808, true)
      const pal = f.gib && k > 0.5 ? GIB_PAL[f.kind]! : kind.pal
      this.blit(px, s, pal, x, foot + 1 - rows - lift - (k > 0.5 ? 1 : 0), false, 1, rows)
      return
    }
    const top = foot + 1 - s.h - kind.float + bob
    const pal = f.st === PAIN ? this.shade(kind.pal, 1.5) : kind.pal
    this.blit(px, s, pal, x, top, f.st === FLEE)
    if (f.kind === IMP && f.st === ATTACK && f.t < 4) this.blit(px, BALL_SMALL, FIRE_PAL, x + 2, top - 2, false)
    if (f.flash > 0) px.lamp(x - 1, top + 4, 0xffe070)
  }

  /** A marine: `i` his colors, his feet's row, `pose` 0 ready or 1 at rest. */
  private drawMarineBand(px: Painter, i: number, x: number, foot: number, pose: number, walk: number, moving: boolean, firing: boolean, fade: number, seed: number, rows: number): void {
    const leg = moving ? 1 + (Math.floor(walk / 3) & 1) : 0
    const s = MARINE[pose]![leg]!
    const h = rows < 0 ? s.h : rows
    const top = foot + 1 - h
    this.blit(px, s, MARINE_PAL[i]!, x, top, false, 1, h, fade, seed)
    if (rows >= 0) return
    if (this.switchT > 2 && this.switchT < SWITCH - 2) return
    const g = GUNS[this.gun]!
    const [hx, hy] = HAND[pose]!
    const gx = x + hx + 1 - g.ax
    const gy = top + hy
    this.blit(px, g.s, GUN_PAL, gx, gy, false, 1, g.s.h, fade, seed)
    if (firing && fade > 0.5) this.blit(px, FLASH_SIDE, this.gun === PLASMA ? PLASMA_FLASH_PAL : FLASH_PAL, gx + g.s.w, gy - 1, false, 1, 3, 1, 0, -1, 3)
  }

  private drawMateBand(px: Painter, m: Mate, x: number, foot: number, d: Dials): void {
    const i = 1 + m.slot
    const goal = this.squadPlace(m)
    const running = Math.abs(goal - m.x) > 1.5 && !m.leaving
    const pose = m.busy > 0.5 && !this.hold && !m.leaving ? 0 : 1
    const flash = pose === 0 && m.y > Math.round(rateOf(this.gun, d.level) * (1.4 + m.seed * 0.6)) - 2
    if (failed(m)) {
      // It falls, then lies there fading.
      const k = clamp((1 - m.here) * 2.2)
      const rows = Math.max(2, Math.round(9 - 7 * k))
      if (k > 0.6) for (let j = -1; j < 8; j++) px.set(x + j, foot, 0x6a0808, true)
      this.drawMarineBand(px, i, x, foot, 1, 0, false, false, clamp(m.here * 2), m.seed * 9999, rows)
    } else {
      const fade = finished(m) ? m.here : 1
      this.drawMarineBand(px, i, x, foot, pose, this.walk + m.seed * 6 + (running ? m.age * 0.6 : 0), this.v > 0.02 || running, flash, fade, m.seed * 9999 + m.age, -1)
      if (finished(m)) this.fog(px, x + 3, foot - 4, 1 - m.here, m.age, 4)
    }
    if (m.waiting && beckon(m, d.t)) px.lamp(x + 3, foot - 9, 0xffb020)
    this.crew.mark(m, x / 2, (foot - 9) / 2, 4, 5, d.columns, d.rows)
  }

  /** Teleport fog: green-white sparkles about (x, y), `k` how far it has gone (dots `r` across). */
  private fog(px: Painter, x: number, y: number, k: number, t: number, r: number): void {
    const n = Math.round(10 * Math.sin(Math.PI * clamp(k)))
    for (let i = 0; i < n; i++) {
      const a = hash1(t * 31 + i) * Math.PI * 2
      const rr = r * (0.3 + 0.7 * hash1(t * 17 + i * 3))
      px.dot((x + Math.cos(a) * rr) * 1, (y + Math.sin(a) * rr * 1.6) * 2, i & 1 ? 0xa8ff98 : 0xe8ffe0)
    }
  }

  private drawPuffBand(px: Painter, p: Puff, x: number, foot: number): void {
    const y = foot - Math.round(p.h)
    const k = p.t / p.life
    if (p.kind === BLOOD) {
      px.set(x, y + Math.floor(p.t / 2), 0xc81818, true)
      if (p.t > 1) px.set(x + ((p.seed & 1) ? 1 : -1), y + p.t - 1, 0x8a0a0a, true)
    } else if (p.kind === SPARK || p.kind === DUST) {
      const c = p.kind === SPARK ? (k < 0.5 ? 0xfff0a0 : 0xff7020) : 0xa0a0a0
      px.set(x, y, c, true)
      if (p.t < 3) {
        px.set(x - 1, y - 1, c, true)
        px.set(x + 1, y + 1, c, true)
      }
    } else {
      // A barrel going up: a ball of fire swelling and dying red.
      const r = 1.5 + 4.5 * Math.sqrt(k)
      for (let dy = -6; dy <= 6; dy++)
        for (let dx = -7; dx <= 7; dx++) {
          const q = Math.hypot(dx, dy * 1.2) / r
          if (q > 1) continue
          const heat = (1 - q) * (1.15 - k)
          if (heat < 0.08) continue
          px.set(x + dx, y + dy, heat > 0.75 ? 0xfff4c0 : heat > 0.5 ? 0xffd040 : heat > 0.28 ? 0xff7a18 : 0xb02a0a, true)
        }
    }
  }

  // The tall view: his own eyes.

  private paintView(px: Painter, d: Dials): void {
    const W = px.w
    const HV = this.hv
    const fy = this.fy
    const bobK = Math.min(1, this.v * 1.5)
    const hz = HV * 0.5 + Math.sin(this.walk * 0.5) * 0.6 * bobK
    this.hz = hz
    const camZ = this.pos / UNIT
    const HW = 1
    const EYE = 0.62
    const CEIL = 1.38
    const extra = this.flash > 0 ? 0.2 : 0
    const zb = this.zb
    const smoke = this.kSmk
    const UX = this.ux
    const UZ = this.uz
    // Each sector's light once a frame, for the stretches in sight (nothing beyond them is lit).
    const s0 = Math.floor(this.pos / SEG)
    const lights = this.lights
    for (let k = 0; k < lights.length; k++) lights[k] = segLight(s0 + k, d.t, this.seed)
    // (Each column's ray: `t` along it, `t * ux` across the corridor, `t * uz` ahead.)
    for (let y = 0; y < HV; y++) {
      const dy = y + 0.5 - hz
      const tp = dy > 0 ? (fy * EYE) / dy : dy < 0 ? (fy * CEIL) / -dy : 1e9
      for (let x = 0; x < W; x++) {
        const ux = UX[x]!
        const uz = UZ[x]!
        const tw = Math.abs(ux) > 1e-6 ? HW / Math.abs(ux) : 1e9
        let t = Math.min(tw, tp)
        let c = 0
        let surf = tw < tp ? 0 : 1
        // A door across the corridor, raised as far as it's open.
        for (const dr of this.doors) {
          const td = (dr.x - this.pos) / UNIT / uz
          if (td <= 0.05 || td >= t || dr.open >= 1) continue
          const h = (-dy * td) / fy
          if (h < -EYE + dr.open * (EYE + CEIL)) continue
          t = td
          surf = 2
          const lx = Math.floor((td * ux + 1) * 16)
          const v = (h + EYE) / (EYE + CEIL) - dr.open
          c = lx <= 1 || lx >= 30 ? 0x4c4c48 : lx === 15 || lx === 16 ? 0x5a5852 : Math.floor(v * 16) % 3 === 0 ? 0x6a6862 : 0x8c8a82
          lampHit = false
          glowHit = false
          break
        }
        if (surf === 0) {
          const a = Math.floor((camZ + tw * uz) * UNIT)
          const seg = Math.floor(a / SEG)
          const side = ux < 0 ? 0 : 1
          const v = clamp(((-dy * tw) / fy + EYE) / (EYE + CEIL), 0, 0.999)
          // Door tracks either side of a door's frame.
          let track = false
          for (const dr of this.doors) if (Math.abs(a - dr.x) <= 1) track = true
          if (track) {
            c = 0x4c4c48
            lampHit = false
            glowHit = false
          } else {
            c = wallTex(segKind(seg * 2 + side, this.seed), a - seg * SEG, v, seg, d.t, this.seed + side)
            if (c === SKY) c = skyTex(x * 2 + side * 60 + d.t * 0.02, (v - 0.25) / 0.56, this.seed)
          }
        } else if (surf === 1) {
          const a = Math.floor((camZ + tp * uz) * UNIT)
          const lat = tp * ux * UNIT
          c = dy > 0 ? floorTex(a, lat, d.t, this.seed) : ceilTex(a, lat)
        }
        const fogL = t < 9.75 ? Math.min(1.1, 1.3 - t / 7.5) : 0
        const k = Math.floor(((camZ + t * uz) * UNIT) / SEG) - s0
        const l = q8((glowHit ? Math.max(0.85, fogL * 1.2) : fogL > 0 && k < lights.length ? lights[k]! * fogL : 0) + (t < 3 ? extra : 0))
        if (l <= 0.06) c = 0x0a0806
        else c = lit(c, l)
        if (smoke > 0 && dy < 0) {
          const n = noise2(x * 0.18 - d.t * 0.03, y * 0.2 + d.t * 0.01, this.seed + 11)
          if (n > 0.45) c = mix(c, 0x686868, Math.round(smoke * (n - 0.45) * 2 * 4) / 4)
        }
        zb[y * W + x] = t
        if (lampHit && l > 0.4) px.lamp(x, y, c)
        else px.set(x, y, c)
      }
    }
    // Everything in the corridor, as billboards, each hidden where something nearer stands.
    for (const b of this.barrels) this.billboard(px, BARREL, BARREL_PAL, b.x, b.u, 0, false, 1, BARREL.h, d, 3)
    for (const fo of this.foes) this.drawFoeView(px, fo, d)
    for (const m of this.crew.mates) this.drawMateView(px, m, d)
    for (const m of this.missiles)
      if (m.kind === BALL_PLASMA) this.billboard(px, BOLT, BOLT_PAL, m.x, m.u, m.h, false, 0.9, BOLT.h, d, -1, true)
      else this.billboard(px, BALL, m.kind === BALL_FIRE ? FIRE_PAL : CACO_PAL, m.x, m.u, m.h, (m.t & 2) === 0, 1, BALL.h, d, -1, true, 1, 0, 0.7)
    for (const p of this.puffs) this.drawPuffView(px, p, d)
    this.drawGun(px, d)
    if (this.sb > 0) this.drawStatus(px)
    else if (this.pano) this.drawHud(px)
  }

  /** A wide view too short for the status bar: his ammo in the corner on the left, his face and health on the right. */
  private drawHud(px: Painter): void {
    const HV = this.hv
    if (HV < 20) return
    const W = px.w
    const y = HV - 7
    const ammo = this.ammo[this.gun]!
    this.number(px, ammo, 2 + String(ammo).length * 4, y)
    let right = W - 3
    if (HV >= 24) {
      const fx = W - 14
      const fy = HV - 13
      px.rect(fx, fy, 12, 12, 0x2e2a24, true)
      this.blit(px, FACES[this.faceNow()]!, FACE_PAL, fx + 1, fy + 1, false)
      this.bloody(px, fx + 1, fy + 1)
      right = fx - 3
    }
    this.number(px, Math.round(this.hp), right, y)
  }

  /** The face he makes now. */
  private faceNow(): number {
    if (this.hold) return LOOK_AHEAD
    if (this.ouch > 0) return OUCH
    if (this.grin > 0) return GRIN
    return this.sinceShot < 5 && this.gun >= CHAINGUN ? RAGE : this.look
  }

  /** Blood on his face (its top left at x, y) when things go badly. */
  private bloody(px: Painter, x: number, y: number): void {
    if (this.kSmk <= 0.5 && this.hp >= 40) return
    const n = this.kSmk > 0.5 ? BLOODY.length : 3
    for (let i = 0; i < n; i++) px.set(x + BLOODY[i]![0], y + BLOODY[i]![1], 0xb01010, true)
  }

  /** The tall view's sectors' lights this frame, from the one he's in (as far as can be seen: 9.75 units). */
  private lights = new Float32Array(Math.ceil((9.75 * UNIT) / SEG) + 2)
  /** The tall view's horizon this frame. */
  private hz = 0
  /** Where the last billboard went (screen): its left, top, width, height. */
  private bx = 0
  private by = 0
  private bw = 0
  private bh = 0

  /**
   * A sprite standing in the corridor at `x` along (band pixels), `u` across
   * (-1..1), `h` above the floor (sprite pixels), `size` times its own size;
   * lit by its sector and the dark. False if it's out of sight.
   */
  private billboard(px: Painter, s: Sprite, pal: readonly number[], x: number, u: number, h: number, flip: boolean, size: number, rows: number, d: Dials, lampIdx = -1, glow = false, fade = 1, seed = 0, nearest = 0.3): boolean {
    if (!this.onView(x, u, nearest)) return false
    const z = this.pt
    const scale = this.pk * SPX * size
    const footY = this.hz + this.pk * (0.62 - h * SPX)
    const dw = s.w * scale
    const dh = rows * scale
    this.bx = this.ps - dw / 2
    this.by = footY - dh
    this.bw = dw
    this.bh = dh
    const seg = Math.floor(x / SEG)
    const l = glow ? 1 : q8(segLight(seg, d.t, this.seed) * clamp(1.3 - z / 7.5, 0, 1.1) + (this.flash > 0 && z < 3 ? 0.2 : 0))
    if (l <= 0.06) return false
    this.blit(px, s, l === 1 ? pal : this.shade(pal, l, true), this.bx, this.by, flip, scale, rows, fade, seed, z, lampIdx)
    return true
  }

  private drawFoeView(px: Painter, fo: Foe, d: Dials): void {
    const kind = FOES[fo.kind]!
    const frame = fo.st === ATTACK && fo.t >= 2 && fo.t < 7 ? 2 : Math.floor(fo.walk / 3) & 1
    const s = kind.frames[frame]!
    const flip = fo.st === FLEE
    if (fo.st === DIE || fo.st === DEAD) {
      const k = fo.st === DEAD ? 1 : fo.t / DIE_T
      const rows = Math.max(2, Math.round(s.h - (s.h - 2) * k))
      const pal = fo.gib && k > 0.5 ? GIB_PAL[fo.kind]! : kind.pal
      if (k > 0.5) this.billboard(px, POOL, POOL_PAL, fo.x + 0.5, fo.u, 0, false, 1, 1, d)
      this.billboard(px, s, pal, fo.x, fo.u, kind.float * (1 - k), flip, 1, rows, d)
      return
    }
    const bob = kind.float ? Math.sin(d.t * 0.12 + fo.seed) * 0.8 : 0
    const pal = fo.st === PAIN ? this.shade(kind.pal, 1.5) : kind.pal
    if (!this.billboard(px, s, pal, fo.x, fo.u, kind.float + bob, flip, 1, s.h, d)) return
    if (fo.flash > 0) px.lamp(this.bx + this.bw * 0.1, this.by + this.bh * 0.45, 0xffe070)
    if (fo.kind === IMP && fo.st === ATTACK && fo.t < 4) this.billboard(px, BALL, FIRE_PAL, fo.x - 0.5, fo.u, 9, false, 1, BALL.h, d, -1, true)
  }

  private drawMateView(px: Painter, m: Mate, d: Dials): void {
    const i = 1 + m.slot
    const u = [-0.5, 0.5, -0.3, 0.3][m.slot]!
    const x = this.pos + m.x
    const pose = m.busy > 0.5 && !this.hold && !m.leaving ? 0 : 1
    const running = Math.abs(this.squadPlace(m) - m.x) > 1.5 && !m.leaving
    const moving = this.v > 0.02 || running
    const leg = moving ? 1 + (Math.floor((this.walk + m.seed * 6 + (running ? m.age * 0.6 : 0)) / 3) & 1) : 0
    // Seen from behind, walking away from him: the visor doesn't show.
    const s = MARINE_BACK[pose]![leg]!
    let rows = s.h
    let fade = 1
    if (failed(m)) {
      const k = clamp((1 - m.here) * 2.2)
      rows = Math.max(2, Math.round(s.h - 7 * k))
      fade = clamp(m.here * 2)
      if (k > 0.6) this.billboard(px, POOL, POOL_PAL, x + 0.5, u, 0, false, 1, 1, d)
    } else if (finished(m)) fade = m.here
    // (Nearer than this they're running past him, beside or behind: out of his sight.)
    if (!this.billboard(px, s, MARINE_PAL[i]!, x, u, 0, false, 1, rows, d, -1, false, fade, m.seed * 9999 + m.age, 0.9)) return
    const { bx, by, bw, bh } = this
    if (finished(m)) this.fog(px, bx + bw / 2, by + bh / 2, 1 - m.here, m.age, Math.max(3, bw * 0.8))
    if (!failed(m) && pose === 0) {
      const flash = m.y > Math.round(rateOf(this.gun, d.level) * (1.4 + m.seed * 0.6)) - 2
      if (flash) px.lamp(bx + bw * 0.5, by - 1, this.gun === PLASMA ? 0x70c0ff : 0xffd040)
    }
    if (m.waiting && beckon(m, d.t)) px.lamp(bx + bw / 2, by - Math.max(2, bh * 0.15), 0xffb020)
    this.crew.mark(m, bx / 2, by / 2, bw / 2, bh / 2, d.columns, d.rows)
  }

  private drawPuffView(px: Painter, p: Puff, d: Dials): void {
    if (!this.onView(p.x, p.u, 0.3)) return
    const z = this.pt
    const k = p.t / p.life
    if (p.kind === BOOM) {
      const r = (1.5 + 4.5 * Math.sqrt(k)) * this.pk * SPX
      const cx = this.ps
      const cy = this.hz + this.pk * (0.62 - p.h * SPX)
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
          const q = Math.hypot(dx, dy) / r
          if (q > 1) continue
          const heat = (1 - q) * (1.15 - k)
          if (heat < 0.08) continue
          const X = Math.round(cx + dx)
          const Y = Math.round(cy + dy)
          if (X < 0 || Y < 0 || X >= px.w || Y >= this.hv || this.zb[Y * px.w + X]! < z - 0.3) continue
          px.set(X, Y, heat > 0.75 ? 0xfff4c0 : heat > 0.5 ? 0xffd040 : heat > 0.28 ? 0xff7a18 : 0xb02a0a, true)
        }
      return
    }
    const s = p.kind === BLOOD ? BLOODS : SPARKS
    const pal = p.kind === BLOOD ? BLOOD_PAL : p.kind === SPARK ? SPARK_PAL : DUST_PAL
    this.billboard(px, s, pal, p.x, p.u, p.h - p.t * (p.kind === BLOOD ? 0.6 : 0), (p.seed & 1) === 1, 1, s.h, d, -1, p.kind === SPARK)
  }

  /** His gun, bobbing as he walks, kicking as it fires, lowered while he switches or holds for the person. */
  private drawGun(px: Painter, d: Dials): void {
    const W = px.w
    const HV = this.hv
    // (About a third of his view's height, as the game had it; less in a band too short for it.)
    const scale = this.pano ? (HV < 26 ? HV / 26 : Math.max(1, Math.round(HV / 34))) : Math.max(1, Math.round(Math.min(W / 40, HV / 50)))
    const s = FP_GUNS[this.gun]!
    const bob = Math.min(3, this.v * 2.4)
    const ph = this.walk * 0.32
    const sw = this.switchT > 0 ? Math.sin((Math.PI * this.switchT) / SWITCH) * s.h * scale * 1.1 : 0
    const down = (this.hold ? 4 : 0) * scale + this.recoil * 0.5 * scale + sw
    const x0 = Math.round(W / 2 - (s.w * scale) / 2 + 1 + Math.cos(ph) * bob)
    const y0 = Math.round(HV - s.h * scale + Math.abs(Math.sin(ph)) * bob + down + (this.sb ? 1 : 0))
    const light = q8(segLight(Math.floor(this.pos / SEG), d.t, this.seed) * 0.95 + (this.flash > 0 ? 0.25 : 0))
    const shaded = this.shade(FP_PAL, light)
    // (The plasma rifle's glow is its own light.)
    shaded[8] = FP_PAL[8]!
    shaded[9] = FP_PAL[9]!
    this.blit(px, s, shaded, x0, y0, false, scale, s.h, 1, 0, -1, this.gun === PLASMA ? 8 : -1)
    if (this.flash > 0 && this.switchT === 0) {
      const fl = FP_FLASH
      this.blit(px, fl, this.gun === PLASMA ? PLASMA_FLASH_PAL : FLASH_PAL, x0 + (s.w * scale) / 2 - (fl.w * scale) / 2 - 0.5, y0 - fl.h * scale + scale, false, scale, fl.h, 1, 0, -1, 3)
    }
    // The barrels of the chaingun turning.
    if (this.gun === CHAINGUN && this.sinceShot < 6 && (d.t & 1)) for (let i = 0; i < 3; i++) px.set(x0 + (4 + i * 2) * scale, y0, 0x5c5c60, true)
  }

  /** The status bar: his ammo, his face, his health. */
  private drawStatus(px: Painter): void {
    const W = px.w
    const y0 = this.hv
    const sb = this.sb
    px.rect(0, y0, W, sb, 0x5a5248)
    px.rect(0, y0, W, 1, 0x8a8070)
    px.rect(0, y0 + sb - 1, W, 1, 0x38322a)
    const fx = Math.round(W / 2 - 6)
    px.rect(fx, y0 + 1, 12, sb - 2, 0x2e2a24)
    const fy = y0 + Math.max(1, Math.round((sb - 10) / 2))
    this.blit(px, FACES[this.faceNow()]!, FACE_PAL, fx + 1, fy, false)
    this.bloody(px, fx + 1, fy)
    // Ammo on the left, health on the right, where there's room.
    const panel = fx
    if (panel >= 12) {
      const dy = y0 + Math.round((sb - 5) / 2)
      this.number(px, this.ammo[this.gun]!, fx - 2, dy)
      this.number(px, Math.round(this.hp), W - 2, dy)
    }
  }

  /** A number in the status bar's red digits, right-aligned at `right`. */
  private number(px: Painter, n: number, right: number, y: number): void {
    const s = String(Math.max(0, Math.min(999, Math.round(n))))
    let x = right - s.length * 4 + 1
    for (const ch of s) {
      const g = DIGITS[ch.charCodeAt(0) - 48]!
      for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j * 3 + i] === '1') px.set(x + i, y + j, 0xd82818, true)
      x += 4
    }
  }
}

/** The squad's marines seen from behind (the tall view): no visor, a pack. */
const MARINE_BACK = [M_TOP, M_TOP_REST].map(top => M_LEGS.map(legs => sprite([...top.map(r => r.replace(/3/g, '1')), ...legs])))
/** A pool of blood under the fallen, and the puffs of the tall view. */
const POOL = sprite(['.1111111.'])
const POOL_PAL = [0, 0x6a0808]
const BLOODS = sprite(['.1.', '121', '.1.'])
const BLOOD_PAL = [0, 0x8a0a0a, 0xd01818]
const SPARKS = sprite(['1.1', '.2.', '1.1'])
const SPARK_PAL = [0, 0xff7020, 0xfff0a0]
const DUST_PAL = [0, 0x808080, 0xc0c0c0]

export const doomScene = defineScene({
  name: 'doom',
  blurb: 'a space marine fighting through a 1993 techbase, faster and harder with the work',
  make: seed => new Doom(seed),
})

export const doom3dScene = defineScene({
  name: 'doom3d',
  blurb: 'the same fight through his own eyes, in a taller band',
  make: seed => new Doom(seed, true),
})
