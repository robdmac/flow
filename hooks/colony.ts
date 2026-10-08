// REVISION: flow-v144-avalon-voyage
//
// A colony ship on the same dials as the fire: the level is its speed. A
// long ship like the Avalon holds steady (nose to the right in the band,
// nose up in a tall spine) while three layers of stars drift past behind
// it: an engine block at the stern, a bare truss spine, and three habitat
// blades twisted round that spine, turning (the helix slides along the ship
// and each blade brightens as it swings to face us, its windows showing,
// and darkens as it passes behind). Ahead of the bow a deflector shield
// arcs across the lane, the ship small behind it. Now and then a rock drifts
// in from ahead, strikes the shield and burns up: an orange-white flash
// where it hits, embers sprayed off the shield that cool and fade, and a
// ripple of light running along it.
//
// At 1 the stars barely move, a slow rock comes by once in a long while and
// the shield is faint. As the level climbs the stars stretch into streaks
// and the rocks come more often and faster; by 10 the stars blur past, the
// plume burns long and a rock strikes every few seconds. Subagents light more of the
// habitat windows, and each one flies a probe of its own (below); smoke
// dims the engine to gray, coughs puffs out behind it, leaves the shield
// flickering weakly and makes the probes' drives misfire gray; a
// nearly-full context turns the shield a hard-glowing cyan and the stars a
// deep blue. While Claude waits on the person the ship comes to a stop among
// still stars, breathing in sepia (waiting.ts).
//
// The voyage goes on behind it all: long stretches of open stars (two to
// five minutes), then a passage of two to four minutes, eased in and out, drawn
// from the scene's seed. Sometimes a sun drifts by (a yellow, an orange or a
// red one: a glowing disc as big as the band is tall, its corona fading out,
// no stars through it), warming the ship's hull as it passes near; sometimes
// a nebula fills the whole background, soft clouds shading between two
// colors and drifting past. Their light is held to a few steps, so the frame
// stays well within the Raster's pairs. Smoke turns the backdrop a gray
// haze and a full context a deep blue, as strong as its light (the dark
// between the clouds stays dark); stopped for the person, the passage holds
// where it is, in sepia.
//
// Each subagent's probe is a little craft like the Hail Mary's Beetles, in its
// own hull color with its own bright drive (crew.ts; four at most, two up by
// the bow and two along the habitat, on the band's top and bottom rows or
// either side of the spine): it's launched from a bay at the habitat's aft
// hub (the hatch glowing in its drive's color as it slides out sideways from
// behind the hull, then flies up to its station), holds station beside the
// ship on a flickering burn while its agent works, cuts
// its drive and falls back along the ship while it's quiet (a running light
// blinking slowly; an amber beacon flashing, a light through the waiting
// sepia, while it waits on you), and when its agent is done turns about and
// burns away aft, off toward home; if it failed, its drive goes dead and it
// tumbles away dark, out of the lane.
//
// Everything is placed in a flight frame (a = along the direction of
// travel, c = across it, both in braille dots: square, two a cell across and
// four down) and mapped onto the screen only when drawn, so the band and the
// spine share every rule. The hull is a pixel layer folded into quadrant
// glyphs; the bare spine, the shield, rocks and embers are braille dots.

import type { AgentDial } from './agents'
import { Cells, DEFAULT_COLOR, Rng, isTall } from './cells'
import { Crew, smooth, type AgentMark, type Mate } from './crew'
import type { Tint } from './styles'
import { BRAILLE, clamp, fitQuad, g, grey, hash1 as hash, mix, NEAR, noise2, QUAD, type QuadFit } from './pixels'
import { defineScene } from './scene-def'
import { hear, leadFrames, type SoundEvent } from './sound'
import { easeWait, waitTone } from './waiting'

/** Cells per frame the nearest stars travel at each level (0 = off). */
const SPEED = [0, 0.012, 0.03, 0.06, 0.11, 0.19, 0.32, 0.52, 0.85, 1.35, 2.1]
/** Depth layers: far stars drift slowest and dimmest. */
const LAYERS = [0.25, 0.55, 1] as const

const C = {
  engine: [0x4c535c, 0x6c7580, 0x8e98a3] as const,
  truss: 0x7c8590,
  spine: 0x666e78,
  hub: 0x7c8590,
  /** A blade by how squarely it faces us: edge-on to full face. */
  bladeFront: [0x7d8792, 0xa6b0bb, 0xd0d8e0] as const,
  bladeBack: [0x3b424b, 0x4d555f] as const,
  window: 0xf2d06b,
  windowDim: 0x8a7440,
  windowBack: 0x6e5c30,
  bow: [0x8e98a3, 0xc4ccd5] as const,
  emitter: 0xbfe8ff,
  plume: [0xe8f4ff, 0x9fd8ff, 0x4aa8f0, 0x2a6fc0] as const,
  plumeSmoke: [0x9a9a9a, 0x707074] as const,
  smoke: 0xb4b4b4,
  smokeThin: 0x606064,
  /** The shield's light, faint to blazing. */
  shield: [0x1a3a58, 0x245a86, 0x3480bc, 0x5aaee4, 0x9ad6f6, 0xe2f6ff] as const,
  shieldBlue: [0x06405a, 0x076a8c, 0x0a94b8, 0x12c0de, 0x5ae6f8, 0xc8fcff] as const,
  shieldSmoke: [0x34485c, 0x4c6278, 0x6a8296, 0x8aa2b4] as const,
  /** The glow behind a bright stretch of shield (cell backgrounds). */
  glow: [0x0c1a2a, 0x112840, 0x183a5c] as const,
  glowBlue: [0x04222e, 0x063546, 0x094a60] as const,
  flash: [0xfff8e8, 0xffd480, 0xff9a3a, 0x8a3812] as const,
  ember: [0xfff2c0, 0xffc04a, 0xff7a22, 0xc0401a, 0x6a2410] as const,
  rock: [0xa8a091, 0xc4baa9, 0xe0d7c6] as const, // small, medium, big
  hot: 0xff9a50,
  star: [0x6a7488, 0xa8b2c4, 0xeef2fa] as const,
  /** The stars under the blue tint: deep blue, not cyan (red-green colour blindness sees cyan as their own blue-gray). */
  starBlue: [0x1c4f9c, 0x2d7fe0, 0x86c4ff] as const,
}

/** Probes for subagents, at most: the Beetles, four of them. */
const PROBES = 4
/** Each probe's hull and its drive's glow, by slot; and what every one shares. */
const PROBE = {
  hull: [0xf0903c, 0x36c4b0, 0xa47cff, 0xb4dc4c] as const,
  drive: [0xffd27a, 0x8cf2ff, 0xf0b4ff, 0xe6ff8c] as const,
  nozzle: 0x4e545c,
  dead: 0x4a4d52,
  light: 0xffffff,
  beacon: 0xffb020,
}

/** A probe's pixel kinds: nozzle (its drive's glow trails from it), hull, the hull's lit side, nose. */
const PK = { nozzle: 1, hull: 2, light: 3, nose: 4 } as const
/**
 * A probe's pixels as (along, across, kind) triples, nose toward +along,
 * from a picture: the band's (pixels twice as tall as wide) drawn as it
 * flies, rear on the left; the spine's nose up, rear at the bottom.
 */
function sprite(rows: readonly string[], tall: boolean): Int8Array {
  const kinds: Record<string, number> = { Z: PK.nozzle, H: PK.hull, L: PK.light, N: PK.nose }
  const out: number[] = []
  rows.forEach((row, r) =>
    [...row].forEach((ch, col) => {
      if (kinds[ch]) out.push(tall ? 1 - r : col - 2, tall ? col - 2 : r - 1, kinds[ch]!)
    }),
  )
  return Int8Array.from(out)
}
/** The band's probe: a stubby craft, 2½ cells long, one row tall. */
const PROBE_WIDE = sprite(['ZLLLN', 'ZHHHN'], false)
/** The spine's: two cells across, two rows tall, a rounded nose and its drive below. */
const PROBE_TALL = sprite(['.NN.', 'HLLH', 'HHHH', '.ZZ.'], true)

/** What the ship flies through: open stars, mostly; now and then a sun drifting by, or a nebula. */
export type Passage = 'stars' | 'sun' | 'nebula'
/** The voyage's pace, in frames at the ship's cruising speed (about 14 a second). */
const VOYAGE = {
  /** Open stars before the first passage, and between passages. */
  first: [400, 1000],
  gap: [1600, 4000],
  /** How long a sun takes to drift by, and a nebula to pass. */
  sun: [1300, 1900],
  nebula: [1700, 2800],
  /** The share of a passage spent fading in, and again fading out. */
  fade: 0.25,
} as const
/** A passing sun's light by kind (a yellow star, an orange one, a red giant): corona, limb, core. */
const SUNS = [
  [0xd0782a, 0xffc860, 0xfff6dc],
  [0xb85020, 0xff9a40, 0xffe2b0],
  [0x8c2414, 0xf06a3a, 0xffc8a0],
] as const
/** A nebula's two colors (it shades between them) by kind: violet and rose, teal and blue, red and amber. */
const NEBULAE = [
  [0x4a1c6a, 0x6a1c48],
  [0x0e4a58, 0x1c2c70],
  [0x5a1810, 0x5a3a12],
] as const
/** Steps a backdrop's light is held to (its colors stay few: the Raster's 1024 pairs). */
const BACK_STEPS = 16
/** Under the smoke and blue tints the backdrop goes gray and dim, or deep blue. */
const BACK_BLUE = 0x2858d0
const BACK_SMOKE = 0x9c9ca0

/** Chance a frame of a rock coming in, at level 1 and at 10. */
const ROCK_RATE = [0.0009, 0.028] as const
/** Rock radii in dots, smallest first. */
const ROCK_R = [2.2, 3.8, 6.2] as const
/** Draw order when a braille cell holds two things: the higher wins its color. */
const P = { shield: 1, rock: 2, ember: 3 } as const
/** Pixel kinds in the hull layer. */
const K = { none: 0, spine: 1, hull: 2, window: 3 } as const
/** Frames a strike's flash and ripple last. */
const FLASH = 5
const RIPPLE = 26
const TAU = Math.PI * 2

type Star = { u: number; v: number; layer: number; tw: number }
/** A rock: `k` scales the level's drift speed. */
/** A rock; `heard` once its strike has been sent to be played (ahead of it, see leadFrames). */
type Rock = { a: number; c: number; dc: number; k: number; size: number; ang: number; spin: number; seed: number; heard?: boolean }
type Mote = { a: number; c: number; va: number; vc: number; life: number; max: number }
/** A strike on the shield: where, how long ago, and how big the rock was. */
type Hit = { a: number; c: number; age: number; size: number }

/** The ship, scaled from its original size: small against its shield. */
const SHIP_SCALE = 0.65
/** The shield (and where the ship's nose stands behind it), scaled from its original size. */
const SHIELD_SCALE = 0.9
/** The ship's proportions that scale with it (its bow, its habitat's ends) from the original. */
const SHRINK = SHIP_SCALE / SHIELD_SCALE

/** The ship's layout in the flight frame (dots), fixed per grid size. */
type Geo = {
  A: number // the frame's length along
  Cd: number // and across
  c0: number // the spine's centerline
  aS: number // the stern
  aN: number // the nose
  E: number // engine length
  h0: number // habitat start, from the stern
  h1: number // habitat end
  b0: number // bow start
  R: number // blade radius
  hw: number // engine half-width
  aV: number // the shield's vertex
  sw: number // the shield's half-width across, from the centerline
  Rc: number // the shield's curvature radius
}

export class Colony {
  strength = 8
  coverageBoost = 0
  /** The subagents, one by one: each flies a probe. */
  agents: readonly AgentDial[] = []
  sounds: SoundEvent[] = []
  tint: Tint = 'normal'
  /** Claude waits on the person: the ship comes to a stop. */
  waiting = false
  /** How far it has stopped (0..1), eased. */
  private kWait = 0
  private columns = 0
  private rows = 0
  private out = new Cells(0, 0)
  private stars: Star[] = []
  private t = 0
  private seedBase: number
  private rng: Rng
  /** The eased level: changes glide rather than jump. */
  private level = Number.NaN
  private geo!: Geo
  // Hull pixel layer, 2 × 2 a cell: color and kind.
  private pc = new Int32Array(0)
  private pk = new Uint8Array(0)
  // Braille layer: dot bits, color and the priority that set it, per cell.
  private bits = new Uint8Array(0)
  private dotColor = new Int32Array(0)
  private prio = new Uint8Array(0)
  /** The brightest shield light in each cell (0 = none). */
  private glow = new Float32Array(0)
  // Smoke layer: a puff glyph and color per cell (0 = none).
  private puff = new Int32Array(0)
  private puffColor = new Int32Array(0)
  /** Cells a rock covers: the stars behind are hidden. */
  private solid = new Uint8Array(0)
  private rocks: Rock[] = []
  private embers: Mote[] = []
  private smoke: Mote[] = []
  private hits: Hit[] = []
  /** The habitat's turn (radians). */
  private spin = 0
  private q = [0, 0, 0, 0]
  private fit: QuadFit = { mask: 0, fg: 0, bg: 0, spread: 0 }
  /** (A probe takes a while to launch: out of its bay, then up to its station.) */
  private crew = new Crew(PROBES, 34)
  // The probes' pixel layer, 2 × 2 a cell (0 = none), the pixel each cell must keep, and the cells it touches.
  private probePx = new Int32Array(0)
  private probeKeep = new Int8Array(0)
  private probeCells = new Int32Array(0)
  private probeCount = 0
  /** Per cell: a light that shines through the waiting sepia (a probe's beacon); -1 none. */
  private lamps = new Int32Array(0)
  /** The bay's hatch, lit as a probe slides out: how brightly (0..1), and in its drive's color. */
  private bayGlow = 0
  private bayColor = 0
  // The voyage: which passage, how far through it (0..1), how long it lasts (frames), the stars before the
  // next one, and the passage's own draw (its kind, where it crosses, its size, its noise's seed).
  private voyage: Rng
  private passage: Passage = 'stars'
  private passageAt = 0
  private passageLen = 1
  private gapLeft = 0
  private pick = 0
  private across = 0.5
  private size = 1
  private nebulaSeed = 0
  /** How far the nebula has drifted past (cells). */
  private drift = 0
  /** The backdrop, per cell: a glyph over it (0: none; a sun's edge), its color, and the color behind. */
  private backGlyph = new Int32Array(0)
  private backFg = new Int32Array(0)
  private backBg = new Int32Array(0)
  /** Cells a sun's disc fills: no star shows through it. */
  private backHide = new Uint8Array(0)
  private backOn = false
  /** A near sun's warm light on the ship and the probes (0..1, in steps). */
  private sunLight = 0
  /** A probe's station, worked out by `station`. */
  private sa = 0
  private sc = 0

  constructor(seed?: number) {
    this.rng = new Rng(seed)
    this.seedBase = (seed ?? this.rng.int()) % 100_000
    this.voyage = new Rng(this.seedBase * 7919 + 17)
    this.gapLeft = this.between(VOYAGE.first)
  }

  /** Tall grids (the spine) fly nose-up with the stars streaming down. */
  private get isVertical(): boolean {
    return isTall(this.columns, this.rows)
  }

  ensure(columns: number, rows: number): void {
    if (columns === this.columns && rows === this.rows) return
    this.columns = columns
    this.rows = rows
    const n = columns * rows
    this.out = new Cells(columns, rows)
    this.pc = new Int32Array(n * 4)
    this.pk = new Uint8Array(n * 4)
    this.bits = new Uint8Array(n)
    this.dotColor = new Int32Array(n)
    this.prio = new Uint8Array(n)
    this.glow = new Float32Array(n)
    this.puff = new Int32Array(n)
    this.puffColor = new Int32Array(n)
    this.solid = new Uint8Array(n)
    this.probePx = new Int32Array(n * 4)
    this.probeKeep = new Int8Array(n).fill(-1)
    this.probeCells = new Int32Array(n)
    this.probeCount = 0
    this.lamps = new Int32Array(n).fill(-1)
    this.backGlyph = new Int32Array(n)
    this.backFg = new Int32Array(n)
    this.backBg = new Int32Array(n)
    this.backHide = new Uint8Array(n)
    this.rocks = []
    this.embers = []
    this.smoke = []
    this.hits = []
    this.geo = this.layout()
    // Every probe fits beside the ship in both layouts. Placed afresh for this one.
    this.crew.room = PROBES
    for (const m of this.crew.mates) m.x = m.y = Number.NaN
    // u runs along the direction of travel, v across it; both in cells.
    const along = this.isVertical ? rows : columns
    const across = this.isVertical ? columns : rows
    const count = Math.max(6, Math.round(n * 0.07))
    this.stars = Array.from({ length: count }, (_, i) => ({
      u: hash(this.seedBase + i * 3) * along,
      v: Math.floor(hash(this.seedBase + i * 3 + 1) * across),
      layer: Math.floor(hash(this.seedBase + i * 3 + 2) * LAYERS.length),
      tw: hash(this.seedBase + i * 7) * 6.283,
    }))
  }

  /** Where the ship and its shield sit: the band's ship a little left of center, the spine's in its lower half. */
  private layout(): Geo {
    const v = this.isVertical
    const A = v ? this.rows * 4 : this.columns * 2
    const Cd = v ? this.columns * 2 : this.rows * 4
    // The spine's 4 dots fill whole cells: an even centerline across a column pair (or the band's middle row).
    const c0 = v ? 2 * Math.floor(this.columns / 2) : 2 * Math.floor(this.rows) // band: rows*4/2
    // The shield holds its place; the ship stands well back from it, small
    // against it (the shield spans the whole frame across).
    const aV = Math.round(A * (v ? 0.52 : 0.45)) + (v ? 7 : 8)
    const aN = aV - Math.round((v ? 18 : 22) * SHIELD_SCALE)
    const Ls = Math.round(SHIP_SCALE * (v ? A * 0.25 : clamp(A * 0.22, 22, 66)))
    const E = Math.round((v ? 5 : 4) * SHIP_SCALE)
    const h0 = E + Math.round(Ls * 0.1)
    const b0 = Ls - Math.max(Math.round(6 * SHRINK), Math.round(Ls * 0.11))
    const h1 = b0 - Math.max(Math.round(4 * SHRINK), Math.round(Ls * 0.07))
    const radius = (scale: number) => scale * (v ? Math.min(Cd * 0.19, 8) : Cd * 0.22)
    const R = radius(SHIP_SCALE)
    // The shield spans a fixed width beside the ship, however wide the frame (its size, not the ship's).
    const sw = Math.min(Cd / 2, radius(SHIELD_SCALE) * 2.6)
    return {
      A,
      Cd,
      c0,
      aS: aN - Ls,
      aN,
      E,
      h0,
      h1,
      b0,
      R,
      hw: Math.max(2, (v ? 2.5 : 2) * SHIP_SCALE),
      aV,
      sw,
      // How far the arc bends back at its ends: about 2 rows in the spine, 2-3 cells in the band.
      Rc: (sw * sw) / (2 * (v ? 9 : 6) * SHIELD_SCALE),
    }
  }

  /** The stars' speed (cells per frame) at the eased level, between table steps; none once stopped for the person. */
  private get speed(): number {
    const l = clamp(this.level, 0, 10)
    const i = Math.min(9, Math.floor(l))
    return (SPEED[i]! + (SPEED[i + 1]! - SPEED[i]!) * (l - i)) * (1 - this.kWait)
  }

  /** How fast the rocks drift in (dots per frame): their own drift plus the ship's speed. */
  private get rockSpeed(): number {
    return 0.2 + this.speed * 2
  }

  /** The shield's surface at `c` across: an arc bending back round the bow. */
  private arcA(c: number): number {
    const d = c - this.geo.c0
    return this.geo.aV - (d * d) / (2 * this.geo.Rc)
  }

  step(): void {
    this.t++
    this.kWait = easeWait(this.kWait, this.waiting)
    const want = clamp(this.strength, 0, 10)
    if (Number.isNaN(this.level)) this.level = want
    this.level += Math.abs(want - this.level) < 0.01 ? want - this.level : (want - this.level) * 0.05
    const speed = this.speed
    const along = this.isVertical ? this.rows : this.columns
    this.crew.update(this.agents, this.coverageBoost)
    // Stars stream past the ship: leftward in the band (it flies right),
    // downward in the spine (it flies up).
    const dir = this.isVertical ? 1 : -1
    for (const s of this.stars) {
      s.u += dir * speed * LAYERS[s.layer]!
      if (s.u < 0) s.u += along
      if (s.u >= along) s.u -= along
    }
    this.stepVoyage(speed)
    if (this.columns === 0 || this.rows === 0) return
    // The habitat turns at its own steady pace, whatever the speed.
    this.spin = (this.spin + 0.022) % TAU
    for (const hit of this.hits) hit.age++
    this.hits = this.hits.filter(hit => hit.age < RIPPLE)
    this.stepRocks()
    this.stepMotes()
    this.stepProbes()
  }

  agentMarks(): readonly AgentMark[] {
    return this.strength > 0 ? this.crew.marks : []
  }

  /** A whole number of frames drawn from `[lo, hi]`. */
  private between(range: readonly [number, number]): number {
    return Math.round(range[0] + this.voyage.f() * (range[1] - range[0]))
  }

  /**
   * The voyage goes on: long stretches of open stars, then a passage (a sun
   * drifting by, or a nebula) that takes a minute or two, then stars again.
   * It keeps the ship's pace: slower when it cruises slow, held while it's
   * stopped for the person.
   */
  private stepVoyage(speed: number): void {
    const l = clamp(this.level, 0, 10)
    const pace = l < 0.5 ? 0 : (0.35 + 0.65 * clamp(l / 6)) * (1 - this.kWait)
    this.drift += speed * 0.15
    if (this.passage === 'stars') {
      this.gapLeft -= pace
      if (this.gapLeft <= 0) this.voyageTo(this.voyage.f() < 0.45 ? 'sun' : 'nebula', 0, this.voyage.int())
      return
    }
    this.passageAt += pace / this.passageLen
    if (this.passageAt >= 1) this.voyageTo('stars', 0, this.voyage.int())
  }

  /**
   * Set the voyage to a passage `at` (0..1) of the way through, its draw
   * from `draw` (a sun's kind, where it crosses and its size; a nebula's
   * colors and clouds). The voyage does this itself; previews and checks
   * call it to see each backdrop.
   */
  voyageTo(passage: Passage, at = 0.5, draw = 0): void {
    const u = (k: number) => hash(draw * 31 + k)
    this.passage = passage
    this.passageAt = clamp(at)
    if (passage === 'stars') {
      this.gapLeft = this.between(VOYAGE.gap)
      return
    }
    this.pick = Math.floor(u(1) * (passage === 'sun' ? SUNS.length : NEBULAE.length))
    this.passageLen = Math.round(VOYAGE[passage][0] + u(2) * (VOYAGE[passage][1] - VOYAGE[passage][0]))
    this.across = 0.12 + u(3) * 0.76
    this.size = 0.8 + u(4) * 0.45
    this.nebulaSeed = Math.floor(u(5) * 10_000)
  }

  /** How strongly the passage shows now (0..1): eased in at its start and out at its end. */
  private get passageK(): number {
    if (this.passage === 'stars') return 0
    const f = VOYAGE.fade
    return smooth(clamp(this.passageAt / f)) * smooth(clamp((1 - this.passageAt) / f))
  }

  /**
   * A backdrop color, `v` (0..1) its light, as the tint has it: a gray haze
   * for smoke, a deep blue for a full context; each as strong as the light
   * there, so the dark between the clouds stays dark.
   */
  private backTint(c: number, v: number): number {
    if (this.tint === 'smoke') return mix(grey(c, 1), mix(0, BACK_SMOKE, v * 2.5), 0.55)
    if (this.tint === 'blue') return mix(c, mix(0, BACK_BLUE, v * 2.5), 0.65)
    return c
  }

  /**
   * The backdrop for this frame, into `back*`: a sun drifting by (a glowing
   * disc, its edge in quadrant pixels, its corona fading out) or a nebula's
   * soft clouds over the whole frame, its light held to `BACK_STEPS` steps.
   */
  private drawBackdrop(): void {
    const k = this.passageK
    this.sunLight = 0
    this.backOn = k > 0.02
    if (!this.backOn) return
    this.backGlyph.fill(0)
    this.backFg.fill(DEFAULT_COLOR)
    this.backBg.fill(DEFAULT_COLOR)
    this.backHide.fill(0)
    if (this.passage === 'sun') this.drawSun(k)
    else this.drawNebula(k)
  }

  /** The light at `v` (0..1) of a sun's: corona, limb, core; black below. */
  private sunColor(v: number): number {
    const ramp = SUNS[this.pick]!
    const x = Math.round(clamp(v) * BACK_STEPS) / BACK_STEPS
    if (x <= 0) return 0
    const c = x < 0.6 ? mix(0, ramp[0], x / 0.6) : x < 0.8 ? mix(ramp[0], ramp[1], (x - 0.6) / 0.2) : mix(ramp[1], ramp[2], (x - 0.8) / 0.2)
    return this.backTint(c, x)
  }

  /** A sun drifting by: it comes in ahead, passes beside the ship and goes out behind, `k` its fade. */
  private drawSun(k: number): void {
    const { A, Cd } = this.geo
    const v = this.isVertical
    const w = this.columns
    const h = this.rows
    // Its disc: as big as the band is tall, a third or so of the spine's width.
    const rc = this.size * (v ? Math.min(10, Cd * 0.22) : Cd * 0.5)
    const ro = rc * 2.8
    const sa = A + ro - this.passageAt * (A + 2 * ro)
    const sc = this.across * Cd
    const X = v ? sc : sa
    const Y = v ? h * 4 - sa : sc
    // Cells within the corona.
    const c0 = Math.max(0, Math.floor((X - ro) / 2))
    const c1 = Math.min(w - 1, Math.floor((X + ro) / 2))
    const r0 = Math.max(0, Math.floor((Y - ro) / 4))
    const r1 = Math.min(h - 1, Math.floor((Y + ro) / 4))
    const q = this.q
    const f = this.fit
    for (let row = r0; row <= r1; row++)
      for (let col = c0; col <= c1; col++) {
        let core = 0
        for (let p = 0; p < 4; p++) {
          // Each quadrant pixel's center in dots.
          const dx = col * 2 + (p & 1) + 0.5 - X
          const dy = row * 4 + (p & 2 ? 3 : 1) - Y
          const d = Math.sqrt(dx * dx + dy * dy)
          let light = 0
          if (d < rc) {
            core++
            light = 0.8 + 0.2 * (1 - (d / rc) * (d / rc)) // brightest at its middle, the limb a little darker
          } else if (d < ro) {
            const g = (ro - d) / (ro - rc)
            light = 0.62 * g * g
          }
          q[p] = this.sunColor(light * k)
        }
        const cell = row * w + col
        if (core === 4) this.backHide[cell] = 1
        fitQuad(q, f, NEAR)
        if (f.spread === 0) {
          this.backBg[cell] = q[0] === 0 ? DEFAULT_COLOR : q[0]!
          continue
        }
        // The disc's edge: the brighter side as the glyph, over the corona.
        this.backGlyph[cell] = QUAD[f.mask]!
        this.backFg[cell] = f.fg === 0 ? DEFAULT_COLOR : f.fg
        this.backBg[cell] = f.bg === 0 ? DEFAULT_COLOR : f.bg
        if (f.fg === 0) {
          this.backGlyph[cell] = QUAD[f.mask ^ 15]!
          this.backFg[cell] = f.bg
          this.backBg[cell] = DEFAULT_COLOR
        }
      }
    // Its light on the ship, as near as it passes.
    const ship = (this.geo.aS + this.geo.aN) / 2
    const near = clamp(1 - Math.hypot(sa - ship, sc - this.geo.c0) / (ro * 2.2))
    this.sunLight = Math.round(k * near * 4) / 4
  }

  /** A nebula: two octaves of soft clouds over the whole frame, shading between its two colors, drifting past. */
  private drawNebula(k: number): void {
    const v = this.isVertical
    const w = this.columns
    const h = this.rows
    const [ca, cb] = NEBULAE[this.pick]!
    const seed = this.nebulaSeed
    const drift = this.drift
    for (let row = 0; row < h; row++)
      for (let col = 0; col < w; col++) {
        // Cells are twice as tall as wide: rows count double. The clouds drift the way the stars do.
        const x = v ? col : col + drift
        const y = v ? row * 2 - drift : row * 2
        const n = 0.65 * noise2(x / 11, y / 7, seed) + 0.35 * noise2(x / 4.5, y / 3, seed + 1)
        const dense = clamp((n - 0.28) / 0.5)
        const light = Math.round(dense * dense * (3 - 2 * dense) * k * BACK_STEPS) / BACK_STEPS
        if (light <= 0) continue
        const hue = Math.round(noise2(x / 15, y / 9, seed + 2) * 3) / 3
        this.backBg[row * w + col] = this.backTint(mix(0, mix(ca, cb, hue), light), light)
      }
  }

  /** The backdrop behind everything drawn: where a cell left the terminal's own color, the backdrop's shows. */
  private applyBackdrop(out: Cells): void {
    if (!this.backOn) return
    const n = this.columns * this.rows
    for (let i = 0; i < n; i++) {
      if (out.background(i) !== DEFAULT_COLOR) continue
      const cp = out.codePoint(i)
      if (cp === 0x20 && this.backGlyph[i]) out.set(i, this.backGlyph[i]!, this.backFg[i]!, this.backBg[i]!)
      else if (this.backBg[i] !== DEFAULT_COLOR) out.set(i, cp, out.foreground(i), this.backBg[i]!)
    }
  }

  /**
   * Where a probe holds station (dots, into `sa`, `sc`): beside the ship, two
   * up by the bow and two along the habitat, on the band's top and bottom
   * rows or either side of the spine. Resting, drive off, it has fallen back
   * along the ship (and, in the spine, out a little).
   */
  private station(m: Mate): void {
    const { aS, aN, c0, Cd, R } = this.geo
    const v = this.isVertical
    const side = m.slot & 1 ? 1 : -1
    const a = m.slot < 2 ? aN + (v ? 2 : 3) : aS + (aN - aS) * (v ? 0.32 : 0.4)
    const c = v ? c0 + side * (R + 5) : side < 0 ? 2 : Cd - 2
    const rest = 1 - m.busy
    this.sa = a - (v ? 14 : 12) * rest
    this.sc = clamp(c + (v ? side * 2 * rest : 0), 2, Cd - 2)
  }

  /** The probes ease toward their stations; the bay's hatch glows while one comes out of it. */
  private stepProbes(): void {
    this.bayGlow = 0
    for (const m of this.crew.mates) {
      this.station(m)
      if (Number.isNaN(m.x)) {
        m.x = this.sa
        m.y = this.sc
      } else {
        m.x += (this.sa - m.x) * 0.05
        m.y += (this.sc - m.y) * 0.05
      }
      if (!m.leaving && 1 - m.p > this.bayGlow) {
        this.bayGlow = 1 - m.p
        this.bayColor = PROBE.drive[m.slot % PROBES]!
      }
    }
  }

  /** Rocks: spawn at the leading edge (rarely at 1, every second or so at 10), drift in, burn up on the shield. */
  private stepRocks(): void {
    const { A, Cd, c0, sw } = this.geo
    // Rocks come at the shield, whole, never clipped by an edge.
    const lo = Math.max(0, c0 - sw)
    const hi = Math.min(Cd, c0 + sw)
    const l = clamp(this.level, 0, 10)
    // Rare: one now and then at 1, every two or three seconds at 10.
    const rate = l < 0.5 ? 0 : ROCK_RATE[0] * Math.pow(ROCK_RATE[1] / ROCK_RATE[0], (l - 1) / 9)
    if (this.rng.f() < rate) {
      const pick = this.rng.f()
      const size = pick < 0.4 ? 2 : pick < 0.75 ? 1 : 0
      const r = ROCK_R[size]!
      this.rocks.push({
        a: A + r + 1,
        c: hi - lo > r * 2.4 ? lo + r * 1.15 + this.rng.f() * (hi - lo - r * 2.3) : c0,
        dc: (this.rng.f() - 0.5) * 0.08,
        k: 0.7 + this.rng.f() * 0.6,
        size,
        ang: this.rng.f() * TAU,
        spin: (this.rng.f() - 0.5) * 0.09,
        seed: this.rng.int() % 10_000,
      })
    }
    const v = this.rockSpeed
    const lead = leadFrames(this.strength, this.tint)
    this.rocks = this.rocks.filter(rock => {
      rock.a -= v * rock.k
      rock.c = clamp(rock.c + rock.dc, lo, hi - 1)
      rock.ang += rock.spin * (1 + v * 0.3)
      const r = ROCK_R[rock.size]!
      const gap = rock.a - r * 0.75 - this.arcA(rock.c)
      // The strike's boom goes out as the rock comes within the player's start-up time of the shield, so it lands with the flash.
      if (!rock.heard && gap <= lead * v * rock.k) {
        rock.heard = true
        hear(this.sounds, { kind: 'hit', v: rock.size / 2 })
      }
      if (gap > 0) return true
      this.burn(rock)
      return false
    })
  }

  /** A rock meets the shield: a flash, a ripple along it, and embers sprayed back off it. */
  private burn(rock: Rock): void {
    const a = this.arcA(rock.c)
    this.hits.push({ a, c: rock.c, age: 0, size: rock.size })
    if (!rock.heard) hear(this.sounds, { kind: 'hit', v: rock.size / 2 })
    const n = 6 + rock.size * 5
    const slope = (rock.c - this.geo.c0) / this.geo.Rc // the shield's tilt here
    for (let i = 0; i < n; i++) {
      // Off the shield's face (outward, +a), fanned along it.
      const along = (this.rng.f() - 0.5) * (1.4 + rock.size * 0.5)
      const out = 0.25 + this.rng.f() * (0.7 + rock.size * 0.35)
      const life = 9 + Math.floor(this.rng.f() * (10 + rock.size * 6))
      this.embers.push({ a: a + 0.5, c: rock.c, va: out - along * slope * 0.5, vc: along + out * slope * 0.5, life, max: life })
    }
  }

  /** Embers cool and drift back onto the shield; (smoke tint) puffs coughed out of the engine. */
  private stepMotes(): void {
    const drift = 0.04 + this.rockSpeed * 0.04
    this.embers = this.embers.filter(m => {
      m.va = m.va * 0.86 - drift
      m.vc *= 0.88
      m.a += m.va
      m.c += m.vc
      const floor = this.arcA(m.c) + 0.3
      if (m.a < floor) {
        m.a = floor
        m.va = 0
      }
      return --m.life > 0
    })
    if (this.tint === 'smoke' && this.strength > 0 && this.t % 3 === 0) {
      const life = 20 + Math.floor(this.rng.f() * 16)
      this.smoke.push({
        a: this.geo.aS - 3,
        c: this.geo.c0 + (this.rng.f() - 0.5) * 3,
        va: -(0.35 + this.rockSpeed * 0.3),
        vc: (this.rng.f() - 0.5) * 0.3,
        life,
        max: life,
      })
    }
    this.smoke = this.smoke.filter(m => {
      m.a += m.va
      m.c += m.vc
      return --m.life > 0 && m.a > -4
    })
  }

  private starColor(layer: number, fade: number): number {
    const ramp = this.tint === 'blue' ? C.starBlue : C.star
    const base = ramp[layer]!
    // (In eighths: few colors, so a backdrop behind them stays within the Raster's pairs.)
    const k = Math.round(Math.max(0.15, Math.min(1, fade)) * 8) / 8
    const ch = (sh: number) => Math.round(((base >> sh) & 255) * k)
    return (ch(16) << 16) | (ch(8) << 8) | ch(0)
  }

  grid(): Cells {
    const out = this.out
    const w = this.columns
    const h = this.rows
    for (let i = 0; i < w * h; i++) out.blank(i)
    if (this.strength <= 0 || w === 0 || h === 0) return out
    const level = clamp(this.level, 0, 10)
    const speed = this.speed
    const vertical = this.isVertical
    const along = vertical ? h : w
    const at = (u: number, v: number) => (vertical ? Math.floor(u) * w + v : v * w + Math.floor(u))
    const dir = vertical ? 1 : -1
    // The narrow spine gets shorter trails, or they fill the column.
    const maxTrail = along * (vertical ? 0.25 : 0.6)
    this.drawBackdrop()
    const hide = this.backOn && this.passage === 'sun' ? this.backHide : undefined

    // Stars, far layers first; a fast star smears into a trail behind it.
    for (let layer = 0; layer < LAYERS.length; layer++) {
      for (const s of this.stars) {
        if (s.layer !== layer) continue
        const trail = Math.min(maxTrail, speed * LAYERS[layer]! * 9)
        const twinkle = level <= 2 ? 0.7 + 0.3 * Math.sin(this.t * 0.3 + s.tw) : 1
        const head = Math.floor(s.u)
        const glyph = trail < 0.6 ? (layer === 2 ? '*' : '·') : vertical ? '│' : '─'
        const cell = at(head, s.v)
        if (!hide || !hide[cell]) out.set(cell, g(glyph), this.starColor(layer, twinkle))
        for (let k = 1; k <= Math.floor(trail); k++) {
          const u = (head - dir * k + along) % along // the trail lies behind the star's travel
          const ti = at(u, s.v)
          if (!hide || !hide[ti]) out.set(ti, g(vertical ? '│' : '─'), this.starColor(layer, (1 - k / (trail + 1)) * 0.8))
        }
      }
    }

    // The braille layer: the shield, rocks and embers.
    this.bits.fill(0)
    this.prio.fill(0)
    this.glow.fill(0)
    this.puff.fill(0)
    this.solid.fill(0)
    this.drawShield(level)
    for (const rock of this.rocks) this.drawRock(rock)
    for (const m of this.embers) {
      const f = m.life / m.max
      this.plot(m.a, m.c, C.ember[Math.min(4, Math.floor((1 - f) * 5))]!, P.ember)
    }
    this.drawSmoke()

    const blue = this.tint === 'blue'
    const glowRamp = blue ? C.glowBlue : C.glow
    const lo = blue ? 0.2 : 0.3
    for (let i = 0; i < w * h; i++) {
      const gl = this.glow[i]!
      const bg = gl > lo ? glowRamp[Math.min(2, Math.floor((gl - lo) * 2.5))]! : DEFAULT_COLOR
      const b = this.bits[i]!
      if (this.puff[i]) out.set(i, this.puff[i]!, this.puffColor[i]!)
      else if (b) out.set(i, 0x2800 | b, this.dotColor[i]!, bg)
      else if (this.solid[i]) out.set(i, 0x20, DEFAULT_COLOR, bg)
      else if (bg !== DEFAULT_COLOR) out.set(i, out.codePoint(i), out.foreground(i), bg)
    }
    this.drawFlashes(out)
    // The probes go behind the ship: one sliding out of its bay shows only as it clears the hull.
    this.lamps.fill(-1)
    this.drawProbes(out)
    this.drawShip(out, level)
    this.applyBackdrop(out)
    waitTone(out, this.kWait, this.t, undefined, this.lamps)
    return out
  }

  /** Light one dot at a flight-frame position. */
  private plot(a: number, c: number, color: number, prio: number): void {
    const vertical = this.isVertical
    const x = Math.floor(vertical ? c : a)
    const y = Math.floor(vertical ? this.rows * 4 - a : c)
    if (x < 0 || y < 0 || x >= this.columns * 2 || y >= this.rows * 4) return
    const cell = (y >> 2) * this.columns + (x >> 1)
    this.bits[cell]! |= BRAILLE[x & 1]![y & 3]!
    if (prio >= this.prio[cell]!) {
      this.prio[cell] = prio
      this.dotColor[cell] = color
    }
  }

  /** The cell holding a flight-frame position, or -1 off the grid. */
  private cellAt(a: number, c: number): number {
    const vertical = this.isVertical
    const x = Math.floor(vertical ? c : a)
    const y = Math.floor(vertical ? this.rows * 4 - a : c)
    if (x < 0 || y < 0 || x >= this.columns * 2 || y >= this.rows * 4) return -1
    return (y >> 2) * this.columns + (x >> 1)
  }

  /** A stroke, sampled finely enough that it never skips a dot. */
  private line(a0: number, c0: number, a1: number, c1: number, color: number, prio: number): void {
    const n = Math.ceil(Math.max(Math.abs(a1 - a0), Math.abs(c1 - c0)) * 1.5) + 1
    for (let k = 0; k <= n; k++) this.plot(a0 + ((a1 - a0) * k) / n, c0 + ((c1 - c0) * k) / n, color, prio)
  }

  /**
   * The shield: an arc of light ahead of the bow, faint at 1 and brighter
   * and busier with the level, shimmering along its length, with each
   * strike's ripple running out from where it hit.
   */
  private drawShield(level: number): void {
    const { Cd, c0, sw } = this.geo
    const smoke = this.tint === 'smoke'
    const blue = this.tint === 'blue'
    const ramp = smoke ? C.shieldSmoke : blue ? C.shieldBlue : C.shield
    const base = smoke ? 0.55 + level * 0.03 : 0.16 + level * 0.045 + (blue ? 0.22 : 0)
    const busy = level / 10
    // Smoke: the shield stutters, whole stretches dropping out and the rest guttering.
    const gutter = smoke ? (hash(this.seedBase + (this.t >> 2) * 13) < 0.3 ? 0.35 : 0.75) : 1
    for (let c = Math.max(0, c0 - sw) + 0.25; c < Math.min(Cd, c0 + sw); c += 0.5) {
      if (smoke && hash(((c / 3) | 0) * 131 + (this.t >> 1) * 7 + this.seedBase) < 0.4) continue
      let I = base
      for (const hit of this.hits) {
        const d = Math.abs(c - hit.c)
        const front = hit.age * (0.9 + hit.size * 0.25)
        const fade = 1 - hit.age / RIPPLE
        const power = 0.5 + hit.size * 0.25
        I += Math.max(0, 1 - Math.abs(d - front) / 2.2) * fade * power // the ring running out
        if (d < front) I += 0.25 * fade * power // and the lit stretch behind it
        if (hit.age < FLASH && d < 3 + hit.size) I += 1
      }
      // The glow behind it follows the level and the strikes; the edge also shimmers, busier with the level.
      const lightI = I * gutter
      I = (I + busy * 0.22 * (0.5 + 0.5 * Math.sin(c * 0.45 - this.t * 0.31)) + busy * 0.12 * hash((c | 0) * 31 + this.t * 17)) * gutter
      // Its tips fade out rather than stop.
      const tip = Math.min(1, (sw - Math.abs(c - c0)) / 2.5)
      I *= tip
      if (I < 0.08) continue
      const a = this.arcA(c)
      const color = ramp[Math.min(ramp.length - 1, Math.floor(I * (ramp.length - 0.5)))]!
      this.plot(a, c, color, P.shield)
      this.plot(a + 1, c, color, P.shield)
      if (blue || I > 0.9) this.plot(a + 2, c, color, P.shield) // glowing hard: a thicker edge
      const cell = this.cellAt(a, c)
      if (cell >= 0 && !smoke && lightI * tip > this.glow[cell]!) this.glow[cell] = lightI * tip
    }
  }

  /** A strike's flash: an orange-white bloom on the shield, shrinking and cooling over a few frames. */
  private drawFlashes(out: Cells): void {
    const w = this.columns
    for (const hit of this.hits) {
      if (hit.age >= FLASH) continue
      const rf = (3 + hit.size * 1.6) * (1 - hit.age / (FLASH + 1))
      // Cell centers within rf dots of the strike (dots are square; a cell is 2 × 4).
      const vertical = this.isVertical
      const x = vertical ? hit.c : hit.a
      const y = vertical ? this.rows * 4 - hit.a : hit.c
      const c0 = Math.max(0, Math.floor((x - rf) / 2))
      const c1 = Math.min(w - 1, Math.floor((x + rf) / 2))
      const r0 = Math.max(0, Math.floor((y - rf) / 4))
      const r1 = Math.min(this.rows - 1, Math.floor((y + rf) / 4))
      for (let row = r0; row <= r1; row++)
        for (let col = c0; col <= c1; col++) {
          const d = Math.hypot(col * 2 + 1 - x, row * 4 + 2 - y) / rf
          if (d >= 1) continue
          const cell = row * w + col
          const bg = C.flash[Math.min(3, Math.floor(d * 2 + hit.age * 0.7))]!
          const cp = out.codePoint(cell)
          out.set(cell, cp, cp === 0x20 ? DEFAULT_COLOR : C.flash[0], bg)
        }
    }
  }

  /** Mark the cells within `rad` dots of (a, c) whose centers lie inside the rock. */
  private cover(a: number, c: number, rad: number): void {
    const vertical = this.isVertical
    const H = this.rows * 4
    const x = vertical ? c : a
    const y = vertical ? H - a : c
    const c0 = Math.max(0, Math.floor((x - rad) / 2))
    const c1 = Math.min(this.columns - 1, Math.floor((x + rad) / 2))
    const r0 = Math.max(0, Math.floor((y - rad) / 4))
    const r1 = Math.min(this.rows - 1, Math.floor((y + rad) / 4))
    for (let row = r0; row <= r1; row++)
      for (let col = c0; col <= c1; col++) {
        const dx = col * 2 + 1 - x
        const dy = row * 4 + 2 - y
        if (dx * dx + dy * dy < rad * rad * 0.7) this.solid[row * this.columns + col] = 1
      }
  }

  /** A lumpy rock: an outline of 6-10 corners at jittered radii, turning as it tumbles, glowing as it nears the shield. */
  private drawRock(rock: Rock): void {
    const r = ROCK_R[rock.size]!
    const n = 6 + rock.size * 2
    const gap = rock.a - r - this.arcA(rock.c)
    const heat = gap < 12 ? Math.ceil((1 - gap / 12) * 3) / 3 : 0
    const color = mix(C.rock[rock.size]!, C.hot, heat * 0.8)
    this.cover(rock.a, rock.c, r)
    let pa = 0
    let pc = 0
    for (let i = 0; i <= n; i++) {
      const j = i % n
      const ang = rock.ang + (j / n) * TAU
      const rr = r * (0.7 + 0.45 * hash(rock.seed * 16 + j))
      const a = rock.a + Math.cos(ang) * rr
      const c = rock.c + Math.sin(ang) * rr
      if (i > 0) this.line(pa, pc, a, c, color, P.rock)
      pa = a
      pc = c
    }
    if (rock.size === 2) {
      const ca = rock.ang + hash(rock.seed) * TAU
      this.plot(rock.a + Math.cos(ca) * r * 0.35, rock.c + Math.sin(ca) * r * 0.35, C.rock[1], P.rock)
    }
  }

  /** Smoke puffs as shade glyphs, dense near the engine, thinning as they drift off. */
  private drawSmoke(): void {
    for (const m of this.smoke) {
      const cell = this.cellAt(m.a, m.c)
      if (cell < 0) continue
      const young = m.life / m.max > 0.5
      if (this.puff[cell] === 0x2592) continue // a thicker puff already holds the cell
      this.puff[cell] = young ? 0x2592 : 0x2591 // ▒ ░
      this.puffColor[cell] = young ? C.smoke : C.smokeThin
    }
  }

  /**
   * The hull at a flight-frame point (s = dots from the stern, d = across
   * from the spine): writes its color and kind into `px`. The habitat's
   * three blades twist round the spine; each one's side-on height is its
   * radius × sin(angle), and cos(angle) says how squarely it faces us.
   */
  private hullAt(s: number, d: number, plume: number, lit: number, px: { color: number; kind: number }): void {
    const geo = this.geo
    px.kind = K.none
    px.color = 0
    const ad = Math.abs(d)
    if (s < 0) {
      // The ion plume, tapering out behind the engine.
      if (-s > plume) return
      const f = -s / plume
      if (ad > 2.6 * (1 - f) + 0.6) return
      const smoke = this.tint === 'smoke'
      const ramp = smoke ? C.plumeSmoke : C.plume
      px.kind = K.hull
      px.color = ramp[Math.min(ramp.length - 1, Math.floor(f * ramp.length + (ad > 1.2 ? 1 : 0)))]!
      return
    }
    const Ls = geo.aN - geo.aS
    if (s >= Ls) return
    if (s < geo.E) {
      // The engine block: a nozzle flaring at the very back.
      const hw = s < 2 ? geo.hw - 1 + s * 0.5 : geo.hw
      if (ad >= hw) return
      px.kind = K.hull
      px.color = C.engine[ad > hw - 1.2 ? 0 : s < 2 ? 1 : 2]!
      return
    }
    if (s >= geo.b0) {
      // The bow: a rounded nose, the shield's emitter at its tip.
      const f = (s - geo.b0) / (Ls - geo.b0)
      const hw = (0.9 + 2.4 * Math.sqrt(Math.max(0, 1 - f * f))) * SHIP_SCALE
      if (ad >= hw) return
      px.kind = K.hull
      px.color = f > 0.82 ? C.emitter : C.bow[ad < hw * 0.5 ? 1 : 0]!
      return
    }
    const inSpine = ad < 2
    if (s >= geo.h0 && s < geo.h1) {
      // Hubs at both ends of the habitat, where the blades meet the spine.
      if ((s < geo.h0 + 2 || s >= geo.h1 - 2) && ad < geo.R * 0.4) {
        px.kind = K.hull
        // The aft hub's bay: its hatch lit while a probe comes out.
        px.color = s < geo.h0 + 2 && this.bayGlow > 0.05 ? mix(C.hub, this.bayColor, Math.ceil(this.bayGlow * 3) / 3) : C.hub
        return
      }
      const twist = (TAU * 0.55) / (geo.h1 - geo.h0)
      let bestZ = -2
      let bestK = -1
      let bestY = 0
      for (let k = 0; k < 3; k++) {
        const phi = this.spin + (k * TAU) / 3 + twist * (s - geo.h0)
        const y = geo.R * Math.sin(phi)
        const z = Math.cos(phi)
        // A blade is a broad ribbon: wider seen face-on than edge-on.
        if (Math.abs(d - y) < 1.05 + 0.85 * Math.abs(z) && z > bestZ) {
          bestZ = z
          bestK = k
          bestY = y
        }
      }
      if (bestK >= 0 && (bestZ > 0 || !inSpine)) {
        px.kind = K.hull
        // A row of windows down the middle of each blade, every other step along it.
        const j = Math.floor((s - geo.h0) / 2)
        const pane = (j & 1) === 0 && Math.abs(d - bestY) < 1 && hash((bestK * 977 + j) * 31 + 7) < lit
        if (bestZ > 0) {
          px.color = C.bladeFront[Math.min(2, Math.floor(bestZ * 3))]!
          // Subagents switch more of them on; now and then one blinks off.
          if (pane && bestZ > 0.45 && (this.t >> 5) % 23 !== (bestK * 7 + j) % 23) {
            px.kind = K.window
            px.color = this.tint === 'smoke' ? C.windowDim : C.window
          }
        } else px.color = pane && bestZ < -0.6 ? C.windowBack : C.bladeBack[bestZ > -0.5 ? 1 : 0]!
        return
      }
    }
    if (inSpine) {
      px.kind = K.spine
      px.color = C.spine
    }
  }

  /**
   * The ship: its hull pixels folded into quadrant glyphs; cells holding only
   * bare spine are drawn as an open braille truss instead.
   */
  private drawShip(out: Cells, level: number): void {
    const geo = this.geo
    const vertical = this.isVertical
    const w = this.columns
    const h = this.rows
    const Hd = h * 4
    const smoke = this.tint === 'smoke'
    const flick = hash(this.seedBase + this.t * 5)
    let plume = (2 + level * 1.5) * (0.85 + flick * 0.3)
    if (smoke) plume = flick < 0.35 ? 0 : plume * 0.5 // a failed command: the engine misfires
    plume = Math.min(plume, geo.aS - 1)
    const lit = Math.min(1, 0.45 + this.coverageBoost / 100)
    // The ship's box, in cells.
    const a0 = geo.aS - plume - 1
    const a1 = geo.aN + 1
    const span = Math.max(geo.R + 2.5, geo.hw + 1)
    const cLo = geo.c0 - span
    const cHi = geo.c0 + span
    const x0 = Math.max(0, Math.floor((vertical ? cLo : a0) / 2))
    const x1 = Math.min(w - 1, Math.floor((vertical ? cHi : a1) / 2))
    const y0 = Math.max(0, Math.floor((vertical ? Hd - a1 : cLo) / 4))
    const y1 = Math.min(h - 1, Math.floor((vertical ? Hd - a0 : cHi) / 4))
    const px = { color: 0, kind: 0 }
    const q = this.q
    for (let row = y0; row <= y1; row++)
      for (let col = x0; col <= x1; col++) {
        const cell = row * w + col
        let hull = false
        let spine = false
        let keep = -1
        for (let p = 0; p < 4; p++) {
          // The pixel's center in dots: half a cell across, two dots down.
          const X = col * 2 + (p & 1) + 0.5
          const Y = row * 4 + (p & 2 ? 2 : 0) + 1
          const a = vertical ? Hd - Y : X
          const c = vertical ? X : Y
          this.hullAt(a - geo.aS, c - geo.c0, plume, lit, px)
          const k = cell * 4 + p
          this.pk[k] = px.kind
          this.pc[k] = px.color
          if (px.kind >= K.hull) hull = true
          else if (px.kind === K.spine) spine = true
          if (px.kind === K.window && keep < 0) keep = p
        }
        if (!hull && !spine && this.inside(col, row)) {
          out.blank(cell) // the stars don't show through the ship
          continue
        }
        if (hull) {
          for (let p = 0; p < 4; p++) q[p] = this.pk[cell * 4 + p] ? this.pc[cell * 4 + p]! : 0
          this.putQuad(out, cell, keep)
        } else if (spine) {
          // An open truss: two rails and a zigzag between them.
          let bits = 0
          for (let dx = 0; dx < 2; dx++)
            for (let dy = 0; dy < 4; dy++) {
              const X = col * 2 + dx + 0.5
              const Y = row * 4 + dy + 0.5
              const a = vertical ? Hd - Y : X
              const c = vertical ? X : Y
              const j = Math.floor(c - geo.c0 + 2) // 0..3 across the spine
              if (j < 0 || j > 3) continue
              const i = ((Math.floor(a) % 6) + 6) % 6
              const rail = j === 0 || j === 3
              const brace = i === j + 1 || i === 6 - j - 1
              if (rail || brace) bits |= BRAILLE[dx]![dy]!
            }
          if (bits) out.set(cell, 0x2800 | bits, C.truss)
        }
      }
  }

  /** A cell's four pixels in `q` (0: none, the terminal's own color) folded into one quadrant glyph. */
  private putQuad(out: Cells, cell: number, keep: number): void {
    const q = this.q
    const f = this.fit
    fitQuad(q, f, NEAR, keep)
    if (f.spread === 0) {
      out.set(cell, 0x2588, this.sunLight > 0 ? mix(q[0]!, SUNS[this.pick]![1], this.sunLight * 0.3) : q[0]!)
      return
    }
    let mask = f.mask
    let fg = f.fg
    let bg = f.bg
    if (this.sunLight > 0) {
      // A sun passing near: its warm light on the hull.
      const warm = SUNS[this.pick]![1]
      if (fg !== 0) fg = mix(fg, warm, this.sunLight * 0.3)
      if (bg !== 0) bg = mix(bg, warm, this.sunLight * 0.3)
    }
    if (fg === 0) {
      // The empty pixels are the background: the drawing is the glyph.
      mask ^= 15
      fg = bg
      bg = 0
    }
    out.set(cell, QUAD[mask]!, fg, bg === 0 ? DEFAULT_COLOR : bg)
  }

  /**
   * The probes, each where its state has it: sliding out of the bay as it
   * arrives, on station or fallen back, turned for home and burning away
   * aft when its agent is done, or tumbling off dark when it failed.
   */
  private drawProbes(out: Cells): void {
    this.crew.clearMarks()
    const mates = this.crew.mates
    if (mates.length === 0) return
    const geo = this.geo
    const t = this.t
    const bayA = geo.aS + geo.h0 + 1
    for (const m of mates) {
      if (Number.isNaN(m.x)) continue
      const side = m.slot & 1 ? 1 : -1
      const away = 1 - m.here
      // Holding station it bobs a little on its burn; coasting, it drifts slowly to and fro.
      const phase = m.seed * TAU
      let a = m.x + Math.sin(t * 0.08 + phase) * 0.7 * m.busy + Math.sin(t * 0.025 + phase) * 1.5 * (1 - m.busy)
      let c = m.y
      let turn = 0
      let drive = m.busy
      let dead = false
      if (!m.leaving) {
        if (away > 0) {
          // Launched: out of the bay sideways, clear of the habitat, then up to its station under its own drive.
          a = bayA + (a - bayA) * smooth(clamp((m.p - 0.35) / 0.65))
          c = geo.c0 + (c - geo.c0) * smooth(clamp(m.p / 0.55))
          drive = Math.max(drive, 0.6)
        }
      } else if (m.ok) {
        // Done: turned about for home, burning hard aft till it's out of sight.
        turn = 2
        drive = 1
        a -= away * away * (a + 18)
      } else {
        // Failed: its drive dead, it tumbles out of the lane into the dark.
        dead = true
        drive = 0
        turn = ((t + m.slot * 3) >> 2) & 3
        a -= away * 18
        c += away * (side < 0 ? -(c + 12) : geo.Cd + 12 - c)
      }
      this.stampProbe(m, a, c, turn, drive, dead)
    }
    // Fold what they painted into glyphs, and clear the layer for the next frame.
    const q = this.q
    for (let k = 0; k < this.probeCount; k++) {
      const cell = this.probeCells[k]!
      for (let p = 0; p < 4; p++) {
        q[p] = this.probePx[cell * 4 + p]!
        this.probePx[cell * 4 + p] = 0
      }
      this.putQuad(out, cell, this.probeKeep[cell]!)
      this.probeKeep[cell] = -1
    }
    this.probeCount = 0
  }

  /**
   * One probe, centered at (a, c) in dots, its nose along the flight (turned
   * a quarter at a time by `turn`): its sprite for the layout, the drive's
   * glow trailing behind its nozzle while lit.
   */
  private stampProbe(m: Mate, a: number, c: number, turn: number, drive: number, dead: boolean): void {
    const v = this.isVertical
    // Pixels are 2 a cell each way: the band's run along x with the flight, the spine's up.
    const x0 = Math.round(v ? c : a)
    const y0 = Math.round((v ? this.rows * 4 - a : c) / 2)
    // The nose's way and across it, in pixels, turned.
    let ux = v ? 0 : 1
    let uy = v ? -1 : 0
    for (let k = 0; k < turn; k++) {
      const tx = ux
      ux = -uy
      uy = tx
    }
    const bx = -uy
    const by = ux
    const slot = m.slot % PROBES
    const smoke = this.tint === 'smoke'
    const flick = hash(this.seedBase + this.t * 7 + slot * 131)
    // Smoke: its drive misfires and burns grey, like the ship's.
    const lit = !dead && !(smoke && flick < 0.3) && drive > 0.3
    const glow = smoke ? C.plumeSmoke[0] : PROBE.drive[slot]!
    const hull = dead ? PROBE.dead : PROBE.hull[slot]!
    const resting = !m.leaving && m.busy < 0.5
    const beacon = resting && m.waiting && ((this.t + slot * 3) >> 2) % 2 === 0
    const running = resting && !m.waiting && (this.t + slot * 9) % 30 < 3
    const sprite = v ? PROBE_TALL : PROBE_WIDE
    let minX = x0
    let maxX = x0
    let minY = y0
    let maxY = y0
    let noses = 0
    for (let k = 0; k < sprite.length; k += 3) {
      const i = sprite[k]!
      const j = sprite[k + 1]!
      const kind = sprite[k + 2]!
      const x = x0 + i * ux + j * bx
      const y = y0 + i * uy + j * by
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      if (kind === PK.nozzle) {
        this.probePixel(x, y, lit ? mix(glow, 0xffffff, 0.6) : PROBE.nozzle, false)
        if (!lit) continue
        // The glow behind it: longer as it burns harder, flickering.
        const len = m.leaving ? 3 + (flick > 0.5 ? 1 : 0) : drive > 0.8 ? 2 + (flick > 0.6 ? 1 : 0) : 1 + (flick > 0.7 ? 1 : 0)
        for (let d = 1; d <= len; d++) {
          if (d === len && len > 2 && j === 0) continue // a tapering tail
          this.probePixel(x - d * ux, y - d * uy, d === 1 ? glow : mix(glow, 0, Math.min(0.8, (d - 1) * 0.35)), false)
        }
      } else if (kind === PK.hull) this.probePixel(x, y, hull, false)
      else if (kind === PK.light) this.probePixel(x, y, dead ? hull : mix(hull, 0xffffff, 0.3), false)
      else if (beacon) this.probePixel(x, y, PROBE.beacon, true, true)
      else if (running && noses++ === 0) this.probePixel(x, y, PROBE.light, true)
      else this.probePixel(x, y, dead ? hull : mix(hull, 0xffffff, 0.6), false)
    }
    this.crew.mark(m, minX >> 1, minY >> 1, (maxX >> 1) - (minX >> 1) + 1, (maxY >> 1) - (minY >> 1) + 1, this.columns, this.rows)
  }

  /** One of a probe's pixels; `keep`, it must survive its cell's fit; `lamp`, it shines through the waiting sepia. */
  private probePixel(x: number, y: number, color: number, keep: boolean, lamp = false): void {
    if (x < 0 || y < 0 || x >= this.columns * 2 || y >= this.rows * 2) return
    const cell = (y >> 1) * this.columns + (x >> 1)
    const k = cell * 4
    const px = this.probePx
    if (px[k] === 0 && px[k + 1] === 0 && px[k + 2] === 0 && px[k + 3] === 0) this.probeCells[this.probeCount++] = cell
    px[k + (((y & 1) << 1) | (x & 1))] = color
    if (keep) this.probeKeep[cell] = ((y & 1) << 1) | (x & 1)
    if (lamp) this.lamps[cell] = color
  }

  /** Whether a cell's center lies inside the ship's silhouette (the habitat as a solid drum). */
  private inside(col: number, row: number): boolean {
    const geo = this.geo
    const X = col * 2 + 1
    const Y = row * 4 + 2
    const s = (this.isVertical ? this.rows * 4 - Y : X) - geo.aS
    const d = Math.abs((this.isVertical ? X : Y) - geo.c0)
    if (s < 0 || s >= geo.aN - geo.aS) return false
    if (s >= geo.h0 && s < geo.h1) return d < geo.R + 1
    return d < (s < geo.E ? geo.hw : 2)
  }

  frame(): string {
    return this.grid().encode()
  }
}

export const avalonScene = defineScene({
  name: 'avalon',
  aliases: ['colony', 'interstellar'],
  blurb: 'a colony ship whose shield burns up the asteroids that hit it',
  make: seed => new Colony(seed),
})
