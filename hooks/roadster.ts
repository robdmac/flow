// REVISION: flow-v192-roadster
//
// Roadster (the `roadster` scene): Tesla's new Roadster, side-on, driving
// left to right with the camera keeping pace, the level its speed and where
// it's got to. At 1 it's parked in a city parking lot beside the road. When
// the work starts it pulls out onto the town's streets (shops, street lamps,
// traffic lights), picking up speed through 2 to 4; at 5 and 6 it's out
// through the suburbs on a faster artery road (houses, trees, power poles);
// 7 to 9 it's on the freeway (a concrete barrier, light poles, gantry signs,
// traffic to overtake), and at 10 it flips: jet-assisted somersaults over the
// cars ahead, a puff of vapour off its jets as it lifts. When the work winds
// down it slows back through them and pulls into the next lot. Each part of
// the world comes in from the right as the level says, so the way out and
// the way back are never the same.
//
// Each subagent is a smaller Roadster of its own in its own colour
// (crew.ts), in the far lane: it draws up from behind when its agent starts,
// keeps pace while the agent works (gaining and losing a little, its lights
// on, flipping now and then as the big one does), drops back with its lights
// off while the agent is quiet (its hazards blinking while it waits on you),
// and when the agent is done flips once and races off ahead, or, failed,
// falls back out of sight trailing smoke. Every one of them jumps the
// traffic in its lane on the freeway.
//
// A failed command (or a compaction) is a burnout: tyre smoke pours off the
// back wheels under a grey overcast. A nearly-full context brings a storm,
// rain driving past, the headlights on. By night the windows are lit, the
// street lamps pool on the pavement and the headlights light the road ahead.
// While Claude waits on the person it pulls into the next lot and stands
// there, its lights shining through the sepia.
//
// The band and the spine both look at it side-on: the spine's height goes
// to the sky (the city's towers rise into it, the flips go higher) and to a
// pavement on the near side, where its parking lot is (the band's is across
// the road). Painted as pixels (2 × 2 a cell, each pixel twice as tall as it
// is wide) by PixelScene, which eases the level and the night, folds the
// pixels into glyphs and blanks it all at level 0.

import type { AgentDial } from './agents'
import { Rng } from './cells'
import { beckon, Crew, failed, finished, type AgentMark, type Mate } from './crew'
import { MOON, moonCover, moonPixel, moonRadius, NIGHT_HORIZON, NIGHT_ZENITH, STAR, STAR_DIM } from './night'
import { PixelScene, type Dials, type Painter } from './pixel-scene'
import { clamp, grey, hash, hash1, mix, noise1, retain, smooth } from './pixels'
import { defineScene } from './scene-def'
import { hear, leadFrames, PLAYER_LEAD_MS, type Ambience, type SoundEvent } from './sound'

// ── Motion ───────────────────────────────────────────────────────────────

/**
 * Speed at each level, in band pixels per 70 ms frame (a band pixel is about
 * 0.3 m: the car is 14 of them). Parked at 1; a crawl through town, then
 * quicker on the artery roads, then the freeway: 7 is about 110 km/h.
 */
const SPEED = [0, 0, 0.55, 0.85, 1.2, 1.8, 2.5, 3.6, 4.6, 5.6, 7]
/** At or below this level it's idle: it pulls into the next lot and parks. */
const IDLE = 1.25
const accel = (v: number) => 0.03 + 0.012 * v
const decel = (v: number) => 0.05 + 0.016 * v
/** Braking into a bay, and the speeds it holds on the way in until it brakes. */
const BRAKE = 0.02
const APPROACH_MIN = 0.35
const APPROACH_MAX = 1.4
/** Frames from the work starting to pulling out of the bay. */
const DEPART = 8
/** At this level and up it flips over the cars in its lane. */
const FLIP_LEVEL = 9.3

function speedFor(level: number): number {
  const l = clamp(level, 0, 10)
  const i = Math.min(9, Math.floor(l))
  return SPEED[i]! + (SPEED[i + 1]! - SPEED[i]!) * (l - i)
}

/** The level whose speed this is (0 parked). */
function levelFor(v: number): number {
  if (v <= 0) return 0
  for (let i = 1; i < 10; i++) if (v < SPEED[i + 1]!) return i + (v - SPEED[i]!) / (SPEED[i + 1]! - SPEED[i]!)
  return 10
}

// ── The world: what the road runs through, by the level ─────────────────

/** The road's stretches: a parking lot, the town's streets, the suburbs' artery road, the freeway. */
const LOT = 0
const TOWN = 1
const SUBURB = 2
const FREEWAY = 3
/** What stands across the road and beyond: the city's towers (near the lots), then the stretch's own. */
const CITY = 0

const roadZone = (level: number) => (level < 4.5 ? TOWN : level < 6.5 ? SUBURB : FREEWAY)
const sideZone = (level: number) => (level < 2.5 ? CITY : roadZone(level))

/** How far each layer moves for the road's one: the backdrop, what's across the road, the road itself. */
const F_FAR = 0.08
const F_CLOUD = 0.03
const F_MID = 0.55

/** A stretch of road (world pixels at the road's depth). */
type Seg = { a: number; b: number; kind: number; seed: number }
/** Something across the road or in the backdrop: a building, a house, a tree, a hill (its layer's pixels). */
type Prop = { a: number; w: number; kind: number; form: number; h: number; c: number; seed: number }
/** A car in the traffic: its tail's world x, lane (0 far, 1 near), speed, colour, and whether it's a truck. */
type Car = { x: number; lane: number; v: number; c: number; truck: boolean }
/** A jump: frames to wait before lifting off (its sound goes first), how far through, how long, how high, which way it turns, its sounds sent, its landing checked. */
type Jump = { wait: number; t: number; len: number; hgt: number; dir: number; landed: boolean; checked: boolean }
/** Smoke, vapour or dust in the air (world x, pixel row): drifting, growing, fading. */
type Puff = { x: number; y: number; vx: number; vy: number; r: number; life: number; fade: number; c: number }
/** A companion's own goings on: its jump, its next flip, whether it flipped on its way out, where it was last frame (world). */
type Own = { jump: Jump | undefined; next: number; waved: boolean; last: number }

// ── Sprites (facing right) ───────────────────────────────────────────────

type Sprite = { w: number; h: number; rows: readonly string[] }
const sprite = (rows: string[]): Sprite => ({ w: rows[0]!.length, h: rows.length, rows })

/** The Roadster: a low white roof over a dark band of glass, tail light at the back, headlight at the nose. */
const ROADSTER = sprite(['....bBBBb.....', 'TBBBGGGGBBBBBL', '.WW.......WW..'])
const ROADSTER_MID = sprite(['....BBBBBB......', '.bBBGGGGGGGGBBb.', 'TBBBBBBBBBBBBBBL', '..WW........WW..'])
const ROADSTER_BIG = sprite([
  '......bBBBBBb.......',
  '....bBGGGGGGGBb.....',
  'bBBBBBBBBBBBBBBBBBBb',
  'TBBBBbbbbbbbbbbBBBBL',
  '...WRW.......WRW....',
])
/** Everyone else's cars: taller, the glass split by a pillar. */
const SEDAN = sprite(['...bBBBBBb....', 'TBBGGBGGGBBBBL', '.WW.......WW..'])
const SEDAN_MID = sprite(['...bBBBBBBb.....', '..BGGGBGGGGBBb..', 'TBBBBBBBBBBBBBBL', '..WW........WW..'])
const SEDAN_BIG = sprite([
  '.....bBBBBBBBb......',
  '...bBGGGGBGGGGBb....',
  'bBBBBBBBBBBBBBBBBBBb',
  'TBBBBBBBBBBBBBBBBBBL',
  '...WRW.......WRW....',
])
/** A box truck: its box, then the cab. */
const TRUCK = sprite(['XXXXXXXXXXXXXXXX......', 'XXXXXXXXXXXXXXXX.BGGb.', 'TXXXXXXXXXXXXXXXdBBBBL', '.WW.WW..........WW..W.'])

type Livery = { B: number; b: number; G: number; T: number; L: number; W: number; R: number; X: number; d: number }

const GLASS = 0x161a22
const TYRE = 0x0e0e10
const RIM = 0x8a9098
const TAIL = 0xff2a2a
const HEAD = 0xfff0c0
const HAZARD = 0xffa020
/** The Roadster's pearl white. */
const PEARL = 0xeef1f4
/** The companions' colours, a slot each: red, blue, yellow, green, orange, purple. */
const LIVERY = [0xe0303a, 0x2f6fe0, 0xf0c020, 0x30b050, 0xf07a20, 0x9a50d0] as const
/** The traffic's: muted. */
const TRAFFIC = [0x8a2a2a, 0x2a4a7a, 0x74787e, 0xc8c4bc, 0x3a5a3a, 0x5a4a6a, 0xa08060] as const

// ── Colours ──────────────────────────────────────────────────────────────

const DAY = {
  skyTop: 0x5a98de,
  skyLow: 0xa9cff0,
  haze: 0x8faac4,
  hazeLit: 0x8faac4,
  hill: 0x7a9e74,
  hillFar: 0x8eaab0,
  walk: 0xb8b4ac,
  kerb: 0x8c8a86,
  asphalt: 0x45484d,
  dash: 0xe8e8e0,
  yellow: 0xe8c040,
  grass: 0x5f9a46,
  grassDark: 0x4a7e38,
  barrier: 0xbab8b0,
  barrierTop: 0x8e8c84,
  pole: 0x5a5e64,
  lampHead: 0x34363a,
  lamp: 0x34363a,
  pool: 0xb8b4ac,
  sign: 0x1f6a3a,
  signText: 0xe8f0e8,
  pBlue: 0x2a5cc8,
  lot: 0x6a6c70,
  lotLine: 0xe0e0d8,
  glassWin: 0x3a5470,
  lit: 0x3a5470,
  shopWin: 0x2e4658,
  shopLit: 0x2e4658,
  trunk: 0x6a4a30,
  tree: 0x3f8a3a,
  treeDark: 0x2f6a2c,
  wall: 0xa8a49a,
  wallLine: 0x8c887e,
  beam: 0x45484d,
  green: 0x30e070,
}
type Pal = typeof DAY
const NIGHT: Pal = {
  skyTop: NIGHT_ZENITH,
  skyLow: NIGHT_HORIZON,
  haze: 0x161c28,
  hazeLit: 0xb89a5a,
  hill: 0x0e1610,
  hillFar: 0x121820,
  walk: 0x3c3b38,
  kerb: 0x2c2b29,
  asphalt: 0x1c1d20,
  dash: 0x8c8c84,
  yellow: 0x8a7428,
  grass: 0x14240f,
  grassDark: 0x0e1a0a,
  barrier: 0x3e3e3c,
  barrierTop: 0x2a2a28,
  pole: 0x2a2c30,
  lampHead: 0x2a2c30,
  lamp: 0xffe2a0,
  pool: 0x5e5644,
  sign: 0x0e3a20,
  signText: 0xc8dcc8,
  pBlue: 0x1a3c8a,
  lot: 0x262729,
  lotLine: 0x7a7a74,
  glassWin: 0x10141a,
  lit: 0xffd27a,
  shopWin: 0x12161c,
  shopLit: 0xffc870,
  trunk: 0x1a120c,
  tree: 0x10200e,
  treeDark: 0x0a1608,
  wall: 0x34332f,
  wallLine: 0x26251f,
  beam: 0x4a4a46,
  green: 0x30e070,
}
const PAL_KEYS = Object.keys(DAY) as (keyof Pal)[]

/** The city's towers (day, night), the town's shopfronts and awnings, the suburbs' walls and roofs. */
const TOWER = [0x8a94a0, 0x6f7f92, 0xa89c8a, 0x9a6a5a, 0x5f6b78, 0xb4b8bc] as const
const TOWER_N = [0x1e2228, 0x1a2030, 0x262420, 0x2a1c1a, 0x181c22, 0x2a2c30] as const
const SHOP = [0xc8a070, 0xb06050, 0x7090a0, 0xd0c090, 0x90a070] as const
const SHOP_N = [0x2c2418, 0x281614, 0x182228, 0x2c2a1e, 0x202418] as const
const AWNING = [0xd03030, 0x2f6fd0, 0x30a050, 0xe0a020] as const
const HOUSE = [0xe8dcc0, 0xc8d8e0, 0xf0e0d0, 0xd0c0a0] as const
const HOUSE_N = [0x2a2822, 0x22262a, 0x2c2824, 0x26221c] as const
const ROOF = [0x8a3a2a, 0x4a4a52, 0x6a4a3a] as const
const ROOF_N = [0x1e0e0a, 0x121216, 0x1a120e] as const
const BILLBOARD = [0xe04040, 0x3a8ae0, 0xf0c020, 0x40c070] as const

/** A failed command or a compaction: a low grey overcast (day, night), and the smoky haze over everything. */
const OVERCAST = { top: [0xb0b0ae, 0x4a4a4a], low: [0xc8c6c2, 0x6a6864] } as const
const HAZE = [0xb8b6b2, 0x7a7874] as const
/** The context nearly full: a storm (day, night), and the cast it puts on everything (darker by day, bluer by night). */
const STORM = { top: [0x1b2540, 0x16264c], low: [0x3e4f70, 0x2a4274] } as const
const STORM_CAST = [0x1e2c4c, 0x2a4078] as const
const RAIN = 0x9ab8e0
const SMOKE = 0xd0d0cc
const SOOT = 0x4a4a4a
const VAPOUR = 0xf4f8ff
const DUST = 0xb8a888

/** `k` held to whole steps of 1/n: gradients that keep the frame's colours few. */
const q = (k: number, n: number) => Math.round(clamp(k) * n) / n

export class Roadster extends PixelScene {
  sounds: SoundEvent[] = []
  /** The subagents, one by one: each a small Roadster of its own, in the far lane. */
  agents: readonly AgentDial[] = []
  /** Their cars (`x`: how far ahead of the Roadster's tail its own is, road pixels; negative, behind). */
  private crew = new Crew(LIVERY.length, 40, 50)
  private own = new Map<string, Own>()
  /** The Roadster's tail along the road (world pixels), and its speed (pixels a 70 ms frame). */
  private pos = 0
  private v = 0
  private started = false
  /** Where it parks (the bay's world x), and how far into the lot it is (0 in its lane .. 1 parked). */
  private stopAt: number | undefined
  private inLot = 0
  /** Frames since the work started, parked: it pulls out at DEPART. */
  private depart = DEPART
  /** Bays it has parked in (world x): kept free of other cars. */
  private taken: number[] = []
  private jump: Jump | undefined
  private segs: Seg[] = []
  private mids: Prop[] = []
  private fars: Prop[] = []
  /** Clouds in the spine's sky (its layer's pixels: `h` its row, `form` its height). */
  private clouds: Prop[] = []
  private cars: Car[] = []
  private puffs: Puff[] = []
  private kSmoke = 0
  private kRain = 0
  /** When a companion's jump was last heard (they're thinned: the Roadster's own come first). */
  private heard = -99
  /** This frame's number. */
  private now = 0
  private rng: Rng

  // Layout, from the grid.
  private W = 0
  private H = 0
  private tall = false
  /** Road pixels per band pixel (the spine draws the road bigger). */
  private k = 1
  /** The Roadster's tail's column. */
  private carX = 0
  /** Rows: the far pavement's top, the far lane's wheels, the lane line, the near lane's wheels, the kerb, the lot's wheels. */
  private farWalk = 0
  private farWheel = 0
  private dashY = 0
  private nearWheel = 0
  private kerb = 0
  private lotWheel = 0
  /** Where each companion keeps station (its tail ahead of the Roadster's, road pixels). */
  private stations: number[] = []
  private pal: Pal = { ...DAY }
  private bayW = 16

  constructor(seed = 1) {
    super(seed)
    this.rng = new Rng(Math.imul(seed, 2654435761))
  }

  /** Its speed now (band pixels a frame), 0 parked. */
  get speed(): number {
    return this.v / this.k
  }

  /** Whether it's parked in a lot. */
  get parked(): boolean {
    return this.v === 0 && this.inLot >= 1
  }

  /** Whether it's in the air. */
  get flying(): boolean {
    return !!this.jump && this.jump.wait <= 0
  }

  agentMarks(): readonly AgentMark[] {
    return this.strength > 0 ? this.crew.marks : []
  }

  ambience(): Ambience {
    // Its speed, as the level that runs at it (0 parked).
    return { wind: levelFor(this.v / this.k) / 10 }
  }

  private layout(d: Dials): void {
    this.W = d.columns * 2
    this.H = d.rows * 2
    this.tall = d.tall
    const H = this.H
    if (this.tall) {
      this.k = 1.4
      this.carX = 4
      this.farWalk = H - 30
      this.farWheel = H - 24
      this.dashY = H - 21
      this.nearWheel = H - 14
      this.kerb = H - 13
      this.lotWheel = H - 4
      this.bayW = 24
    } else {
      this.k = 1
      this.carX = Math.max(8, Math.round(this.W * 0.28)) & ~1
      this.farWalk = H - 6
      this.farWheel = H - 5
      this.dashY = H - 4
      this.nearWheel = H - 1
      this.kerb = H
      // (A band shorter than 5 rows, the picker's thumbnail, has no room across the road: it parks at the kerb.)
      this.lotWheel = H >= 10 ? H - 6 : this.nearWheel
      this.bayW = 18
    }
    // Stations alongside, ahead and behind in turn, as many as fit whole in view.
    const L = ROADSTER.w
    const step = 22
    const cand = [step, -step, 2 * step, -2 * step, 3 * step, -3 * step, 0, 4 * step, -4 * step]
    this.stations = cand.filter(o => this.carX + o >= 0 && this.carX + o + L <= this.W).slice(0, LIVERY.length)
  }

  protected resize(d: Dials): void {
    this.layout(d)
    // A new size is a new world (its pixels are another size): built afresh around where it is.
    this.segs.length = 0
    this.mids.length = 0
    this.fars.length = 0
    this.clouds.length = 0
    this.cars.length = 0
    this.puffs.length = 0
    this.taken.length = 0
    this.stopAt = undefined
    this.jump = undefined
    this.started = false
    this.v = 0
  }

  // ── The world ahead ──────────────────────────────────────────────────

  /** The Roadster's main sprite here (the spine draws it bigger). */
  private get main(): Sprite {
    return this.tall ? ROADSTER_BIG : ROADSTER_MID
  }

  /** Everyone else's car at the Roadster's depth (in its lane, in the lots). */
  private get near(): Sprite {
    return this.tall ? SEDAN_BIG : SEDAN_MID
  }

  /** Lays road ahead to `until` (world x): each stretch what the level says now; a lot when it's to park. */
  private layRoad(until: number, level: number, idle: boolean): void {
    const k = this.k
    if (idle && this.stopAt === undefined && !this.segs.some(s => s.kind === LOT && s.b > this.pos + this.stoppingDistance() + this.bayW)) {
      // To park: the road not yet in view gives way to a lot just out of sight (or as far as it takes to stop).
      const cut = Math.round(Math.max(this.pos + this.stoppingDistance(), this.pos - this.carX + this.W + 8 * k))
      retain(this.segs, s => s.a < cut)
      const last = this.segs[this.segs.length - 1]
      if (last && last.b > cut) last.b = cut
      this.pushSeg(LOT)
    }
    while (!this.segs.length || this.segs[this.segs.length - 1]!.b < until) this.pushSeg(roadZone(level))
    const behind = this.pos - this.carX - 200 * k
    retain(this.segs, s => s.b > behind)
  }

  /** The next stretch of road, of a kind. */
  private pushSeg(kind: number): void {
    const k = this.k
    const a = this.segs.length ? this.segs[this.segs.length - 1]!.b : this.pos - this.carX - 40
    const len =
      kind === LOT
        ? 2 * 12 * k + (5 + Math.floor(this.rng.f() * 3)) * this.bayW
        : kind === TOWN
          ? (90 + this.rng.f() * 70) * k
          : kind === SUBURB
            ? (140 + this.rng.f() * 90) * k
            : (260 + this.rng.f() * 160) * k
    this.segs.push({ a, b: Math.round(a + len), kind, seed: this.rng.int() & 0xffff })
  }

  /** What stands across the road (or, `far`, in the backdrop), laid ahead to `until` in its layer's pixels. */
  private layProps(list: Prop[], until: number, start: number, level: number, far: boolean): void {
    const r = this.rng
    const k = this.k
    const tall = this.tall
    while (!list.length || list[list.length - 1]!.a + list[list.length - 1]!.w < until) {
      const lastP = list[list.length - 1]
      let a = lastP ? lastP.a + lastP.w : start
      const zone = sideZone(level)
      let w: number
      let h: number
      let form = 0
      if (far) {
        if (zone <= TOWN) {
          // The skyline: towers of every height, close together.
          w = 3 + Math.floor(r.f() * 6)
          h = tall ? 16 + r.f() * 44 : 1 + r.f() * 3
          a += Math.floor(r.f() * 2)
        } else {
          // Hills (the freeway's bigger and bluer).
          form = zone === FREEWAY ? 1 : 0
          w = (tall ? 120 : 60) + Math.floor(r.f() * 80)
          h = tall ? 6 + r.f() * 10 : 1.5 + r.f() * 1.5
        }
      } else if (zone === CITY) {
        w = Math.round((10 + r.f() * 12) * k) & ~1
        h = tall ? 24 + r.f() * 30 : 3 + Math.floor(r.f() * 2)
        a += Math.round(r.f() * 2) * 2
      } else if (zone === TOWN) {
        w = Math.round((10 + r.f() * 8) * k) & ~1
        h = tall ? 10 + r.f() * 12 : 2 + Math.floor(r.f() * 2)
      } else if (zone === SUBURB) {
        // Houses, and trees between them.
        form = r.f() < 0.4 ? 1 : 0
        w = form ? Math.round((4 + r.f() * 3) * k) & ~1 : Math.round((12 + r.f() * 4) * k) & ~1
        h = form ? (tall ? 8 + r.f() * 8 : 2 + Math.floor(r.f() * 2)) : tall ? 9 + r.f() * 4 : 3
        a += Math.round((2 + r.f() * 6) * k) & ~1
      } else {
        // The freeway's sound wall, trees on the embankment, a billboard now and then.
        const p = r.f()
        form = p < 0.5 ? 0 : p < 0.85 ? 1 : 2
        w = form === 0 ? Math.round((30 + r.f() * 40) * k) & ~1 : form === 1 ? Math.round((4 + r.f() * 4) * k) & ~1 : Math.round(12 * k) & ~1
        h = form === 0 ? (tall ? 5 : 1) : form === 1 ? (tall ? 8 + r.f() * 6 : 2) : tall ? 18 : 4
        a += form === 0 ? 0 : Math.round((4 + r.f() * 10) * k) & ~1
      }
      list.push({ a, w, kind: zone, form, h, c: r.int() & 0xff, seed: r.int() & 0xffff })
    }
  }

  /** The spine's clouds, laid ahead, drifting along at their own pace. */
  private layClouds(): void {
    const r = this.rng
    const off = this.pos * F_CLOUD + this.now * 0.02
    while (!this.clouds.length || this.clouds[this.clouds.length - 1]!.a < off + this.W + 30) {
      const last = this.clouds[this.clouds.length - 1]
      const a = (last ? last.a : off - 20) + 14 + Math.floor(r.f() * 30)
      const sky = this.farWalk
      this.clouds.push({ a, w: 10 + Math.floor(r.f() * 14), kind: 0, form: 2 + Math.floor(r.f() * 3), h: (Math.floor(2 + r.f() * sky * 0.45) >> 1) * 2, c: 0, seed: r.int() & 0xffff })
    }
    retain(this.clouds, c => c.a + c.w > off - 40)
  }

  /** The stretch of road at world x (the last one, past the end). */
  private segAt(x: number): Seg | undefined {
    const s = this.segs
    for (let i = 0; i < s.length; i++) if (x < s[i]!.b) return s[i]
    return s[s.length - 1]
  }

  /** A lot's bays: their world x (each a car's tail), first to last. */
  private bays(s: Seg): number[] {
    const out: number[] = []
    for (let x = s.a + Math.round(12 * this.k); x + this.bayW <= s.b - Math.round(12 * this.k) + 1; x += this.bayW) out.push(x + 1)
    return out
  }

  /** Whether a lot's bay has someone else's car in it. */
  private bayFull(x: number): boolean {
    if (this.lotWheel === this.nearWheel) return false
    for (const t of this.taken) if (Math.abs(t - x) < 2) return false
    return hash1(x * 7 + 3) < 0.62
  }

  /** How far it runs from its speed now: slowing to the approach speed, then braking into the bay. */
  private stoppingDistance(): number {
    let d = 0
    for (let u = this.v; u > APPROACH_MAX * this.k; u -= decel(u)) d += u
    const a = Math.min(this.v, APPROACH_MAX * this.k)
    return d + (a * a) / (2 * BRAKE * this.k) + 4
  }

  /** The first free bay at least `from` along. */
  private bayAhead(from: number): number | undefined {
    for (const s of this.segs) {
      if (s.kind !== LOT || s.b < from) continue
      for (const b of this.bays(s)) if (b >= from && !this.bayFull(b)) return b
    }
    return undefined
  }

  // ── Moving on ────────────────────────────────────────────────────────

  protected update(d: Dials): void {
    this.layout(d)
    if (this.W === 0 || this.H === 0) return
    this.now = d.t
    const k = this.k
    // Speeds are per 70 ms: a calm frame is longer, so it keeps its real pace.
    const lead = leadFrames(this.strength, this.tint)
    const dt = PLAYER_LEAD_MS / lead / 70
    const idle = this.strength <= IDLE || this.waiting
    const level = d.level
    if (!this.started) {
      this.started = true
      this.pos = Math.round(this.pos)
      if (idle) {
        // Starting idle: already parked, in a lot laid where it is.
        const a = this.pos - Math.round(12 * k) - 2 * this.bayW - 1
        const n = 6
        this.segs.push({ a: a - this.carX - 60, b: a, kind: TOWN, seed: 7 })
        this.segs.push({ a, b: a + Math.round(24 * k) + n * this.bayW, kind: LOT, seed: 11 })
        this.stopAt = this.pos
        this.taken.push(this.pos)
        this.inLot = 1
        this.v = 0
      } else this.v = speedFor(level) * k
    }
    this.layRoad(this.pos - this.carX + this.W + 60 * k, level, idle)
    this.layProps(this.mids, this.pos * F_MID + this.W + 40, this.pos * F_MID - 40, level, false)
    this.layProps(this.fars, this.pos * F_FAR + this.W + 40, this.pos * F_FAR - 40, level, true)
    retain(this.mids, p => p.a + p.w > this.pos * F_MID - 60)
    retain(this.fars, p => p.a + p.w > this.pos * F_FAR - 60)
    if (this.tall) this.layClouds()

    let vT: number
    if (!idle) {
      this.stopAt = undefined
      if (this.v === 0 && this.inLot > 0 && this.depart < DEPART) {
        // Parked: a moment, then it pulls out.
        this.depart += dt
        vT = 0
      } else vT = this.inLot > 0 ? Math.min(speedFor(level), 0.5) * k : speedFor(level) * k
      if (this.v > 0 && this.inLot > 0) this.inLot = Math.max(0, this.inLot - 0.07 * dt)
    } else {
      if (this.stopAt === undefined && this.v > 0) {
        const at = this.bayAhead(this.pos + this.stoppingDistance())
        if (at !== undefined) {
          this.stopAt = at
          this.taken.push(at)
        }
      }
      if (this.stopAt === undefined) vT = this.v === 0 ? 0 : APPROACH_MAX * k
      else {
        const left = Math.max(0, this.stopAt - this.pos)
        vT = this.v === 0 ? 0 : Math.min(APPROACH_MAX * k, Math.max(Math.sqrt(2 * BRAKE * k * left), left > 1 ? APPROACH_MIN * k : 0))
        // Turning in over the last few car lengths.
        const turn = 3 * this.bayW
        if (left < turn) this.inLot = Math.max(this.inLot, 1 - left / turn)
      }
      if (this.v === 0) this.inLot = Math.min(1, this.inLot + 0.1 * dt)
    }
    const dv = vT - this.v
    // (In the air, and committed to a jump, its speed holds: the jump was planned at it.)
    if (!this.jump) this.v += dv > 0 ? Math.min(dv, accel(this.v / k) * k * dt) : Math.max(dv, -decel(this.v / k) * k * dt)
    // Behind a car it can't jump: it keeps its distance.
    const ahead = this.carAhead(1, this.pos + this.main.w)
    if (ahead && !this.jump && ahead.x - (this.pos + this.main.w) < 4 * k) this.v = Math.min(this.v, ahead.v)
    const was = this.pos
    this.pos += this.v * dt
    if (idle && this.stopAt !== undefined && (this.pos >= this.stopAt - 0.05 || (this.v < 0.02 && this.stopAt - this.pos < 0.6))) {
      this.pos = this.stopAt
      this.v = 0
    }
    if (this.v === 0 && idle) this.depart = 0
    const back = this.pos - this.carX - 400 * k
    retain(this.taken, t => t > back)

    this.moveTraffic(d, dt)
    this.moveJump(dt, lead)
    this.moveCompanions(d, dt, lead)
    this.movePuffs(dt, was)
    // Tints ease: the burnout starts at once and clears over a few seconds; the storm gathers.
    this.kSmoke = clamp(this.kSmoke + (this.tint === 'smoke' ? 0.2 : -0.035) * dt)
    this.kRain = clamp(this.kRain + (this.tint === 'blue' ? 0.05 : -0.04) * dt)
  }

  /** The nearest car in a lane ahead of world x, if any. */
  private carAhead(lane: number, x: number): Car | undefined {
    let best: Car | undefined
    for (const c of this.cars) if (c.lane === lane && c.x >= x - 2 && (!best || c.x < best.x)) best = c
    return best
  }

  /** The freeway's traffic: slower cars in the far lane to overtake; at the top, in its own lane, to flip over. */
  private moveTraffic(d: Dials, dt: number): void {
    const k = this.k
    // Never into the Roadster: in its lane, behind it they fall back, ahead of it they're slower only while it flips
    // (else they pull away). In the far lane slower on the freeway, for the companions to jump; off it, on ahead and away.
    if (!this.jump)
      for (const c of this.cars) {
        if (c.lane === 0) c.v = this.v >= 2.6 * k ? Math.min(2.2 * k, this.v - 2 * k) : this.v + 1.2 * k
        else if (c.x < this.pos || d.level >= FLIP_LEVEL) c.v = Math.min(4.2 * k, Math.max(0, this.v - 2.5 * k))
        else c.v = this.v + 1.2 * k
      }
    for (const c of this.cars) c.x += c.v * dt
    const left = this.pos - this.carX
    retain(this.cars, c => c.x > left - 60 * k && c.x < left + this.W + 200 * k)
    const spawn = left + this.W + 20 * k
    const here = this.segAt(spawn)
    if (here?.kind !== FREEWAY || this.v < 2 * k) return
    let lastFar = -Infinity
    let lastNear = -Infinity
    for (const c of this.cars) {
      if (c.lane === 0) lastFar = Math.max(lastFar, c.x)
      else lastNear = Math.max(lastNear, c.x)
    }
    if (spawn - lastFar > (70 + this.rng.f() * 40) * k && this.rng.f() < 0.05 * dt) {
      const truck = !this.tall && this.rng.f() < 0.25
      this.cars.push({ x: spawn, lane: 0, v: 2.2 * k, c: TRAFFIC[Math.floor(this.rng.f() * TRAFFIC.length)]!, truck })
    }
    if (d.level >= FLIP_LEVEL && spawn - lastNear > (60 + this.rng.f() * 60) * k && this.rng.f() < 0.08 * dt)
      this.cars.push({ x: spawn, lane: 1, v: 4.2 * k, c: TRAFFIC[Math.floor(this.rng.f() * TRAFFIC.length)]!, truck: false })
  }

  /** A jump to clear a car `L` long, `gap` ahead, closing at `rv` (pixels a 70 ms frame), starting in `wait` frames. */
  private jumpOver(gap: number, L: number, own: number, rv: number, hgt: number, wait: number): Jump {
    const len = clamp((gap + L + own + 6 * this.k) / Math.max(0.1, rv), 10, 48)
    return { wait, t: 0, len, hgt, dir: this.rng.f() < 0.6 ? -1 : 1, landed: false, checked: false }
  }

  /** How high it flies: the spine has the sky for it. */
  private hgt(main: boolean): number {
    return this.tall ? (main ? 14 : 8) : main ? 5 : 3
  }

  private moveJump(dt: number, lead: number): void {
    const j = this.jump
    const L = this.main.w
    if (!j) {
      // A car ahead in its lane: over it.
      const c = this.carAhead(1, this.pos + L)
      if (!c || this.v === 0 || this.inLot > 0) return
      const rv = this.v - c.v
      const gap = c.x - (this.pos + L)
      if (rv > 0.4 && gap <= L + rv * dt * lead) {
        this.jump = this.jumpOver(gap - rv * dt * lead, this.near.w, L, rv, this.hgt(true), Math.round(lead))
        hear(this.sounds, { kind: 'jets', v: 0.9 })
      }
      return
    }
    if (j.wait > 0) {
      j.wait--
      return
    }
    this.flight(j, this.pos, L, 1, this.v, true, dt, lead, 0.9)
    if (j.t >= j.len) this.jump = undefined
  }

  /** One frame of a jump: on through it, vapour off the jets as it lifts, dust and the landing's sound. */
  private flight(j: Jump, x: number, L: number, lane: number, speed: number, main: boolean, dt: number, lead: number, v: number): void {
    const wheel = lane === 1 ? this.nearWheel : this.farWheel
    j.t += dt
    if (!j.checked && j.t >= j.len / 2) {
      // At the top: if it would come down on a car, it stays up on its jets until it's past.
      j.checked = true
      for (let n = 0; n < 3; n++) {
        const rem = j.len - j.t
        const at = x + speed * rem
        let more = 0
        for (const c of this.cars) {
          if (c.lane !== lane) continue
          const Lc = c.truck ? TRUCK.w : lane === 1 ? this.near.w : SEDAN.w
          const cx = c.x + c.v * rem
          if (cx < at + L + 2 && cx + Lc + 2 > at && speed - c.v > 0.3) more = Math.max(more, (cx + Lc + 2 - at) / (speed - c.v))
        }
        if (more <= 0) break
        j.len = Math.min(j.t + 60, j.len + more)
      }
    }
    const u = j.t / j.len
    const lift = this.lift(j)
    if (u < 0.3) {
      // The jets: white vapour driven down from under it.
      for (let i = 0; i < (main ? 2 : 1); i++)
        this.puffs.push({
          x: x + 2 + this.rng.f() * (L - 4),
          y: wheel - lift + 1,
          vx: (this.rng.f() - 0.5) * 0.2,
          vy: 0.35 + this.rng.f() * 0.3,
          r: 0.6 + this.rng.f() * 0.6,
          life: 0.7,
          fade: 0.06,
          c: VAPOUR,
        })
    }
    if (j.t >= j.len) {
      // Coming down on a car after all (it slowed, or sped up): a moment longer on its jets.
      for (const c of this.cars) {
        if (c.lane !== lane) continue
        const Lc = c.truck ? TRUCK.w : lane === 1 ? this.near.w : SEDAN.w
        const close = Math.abs(speed - c.v)
        if (c.x < x + L + 1 && c.x + Lc + 1 > x && close > 0.3) j.len = Math.max(j.len, j.t + Math.min(30, (speed > c.v ? c.x + Lc + 2 - x : x + L + 2 - c.x) / close))
      }
    }
    if (!j.landed && j.len - j.t <= lead * dt) {
      j.landed = true
      if (main || this.now - this.heard > 10) hear(this.sounds, { kind: 'land', v })
    }
    if (j.t >= j.len)
      for (let i = 0; i < 4; i++)
        this.puffs.push({ x: x + (i < 2 ? 1 : L - 3) + this.rng.f() * 2, y: wheel, vx: -0.1 - this.rng.f() * 0.2, vy: -0.05, r: 0.6, life: 0.5, fade: 0.05, c: DUST })
  }


  /** How far up a jump has it now (pixels). */
  private lift(j: Jump | undefined): number {
    if (!j || j.wait > 0) return 0
    const u = clamp(j.t / j.len)
    return Math.round(4 * u * (1 - u) * j.hgt)
  }

  /** Its turn now (radians): once round over the jump, level at both ends. */
  private turn(j: Jump | undefined): number {
    if (!j || j.wait > 0) return 0
    return j.dir * 2 * Math.PI * smooth(clamp((j.t / j.len - 0.08) / 0.84))
  }

  private moveCompanions(d: Dials, dt: number, lead: number): void {
    const k = this.k
    this.crew.room = this.stations.length
    this.crew.update(this.agents, d.boost)
    const outL = -(this.carX + 24 * k)
    const outR = this.W - this.carX + 24 * k
    const moving = clamp(this.v / k)
    for (const m of this.crew.mates) {
      let o = this.own.get(m.id)
      if (!o) this.own.set(m.id, (o = { jump: undefined, next: 30 + this.rng.f() * 60, waved: false, last: Number.NaN }))
      const ph = m.seed * 6.283
      const station = this.stations[m.slot]! * k
      const rest = station - 10 * k
      const sway = (Math.sin(d.t * 0.031 + ph) * 3 + Math.sin(d.t * 0.013 + ph * 2.3) * 2) * k * m.busy * moving
      const at = rest + (station - rest) * m.busy + sway
      const out = m.leaving && m.ok ? outR : outL
      const L = ROADSTER.w
      const want = out + (at - out) * m.here
      const wWant = this.pos + want
      // How fast it's going along the road (pixels a 70 ms frame).
      const speed = Number.isNaN(o.last) ? this.v : (wWant - o.last) / dt
      o.last = wWant
      let x = want
      if (o.jump && o.jump.wait <= 0) {
        this.flight(o.jump, wWant, L, 0, speed, false, dt, lead, 0.35)
        if (o.jump.t >= o.jump.len) o.jump = undefined
      } else {
        if (o.jump) o.jump.wait--
        // On its wheels it never touches a car: over one closing on it (from either side), or held clear of it.
        // (A jump about to go lifts off now rather than touch one.)
        if (o.jump && o.jump.wait > 0 && this.cars.some(c => c.lane === 0 && c.x < wWant + L + 1 + Math.abs(speed - c.v) * dt && c.x + (c.truck ? TRUCK.w : SEDAN.w) + 1 + Math.abs(speed - c.v) * dt > wWant))
          o.jump.wait = 0
        for (const c of this.cars) {
          if (o.jump?.wait === 0) break
          if (c.lane !== 0) continue
          const Lc = c.truck ? TRUCK.w : SEDAN.w
          const ahead = c.x + Lc / 2 > wWant + L / 2
          const gap = ahead ? c.x - (wWant + L) : wWant - (c.x + Lc)
          const rv = ahead ? speed - c.v : c.v - speed
          if (!o.jump && rv > 0.6 && gap > -L / 2 && gap <= L + rv * dt * lead) {
            o.jump = this.jumpOver(Math.max(0, gap - rv * dt * lead), Lc, L, rv, this.hgt(false) + (c.truck ? 1 : 0), gap < rv * dt * 2 ? 0 : Math.round(lead))
            this.heardJets(m)
            if (o.jump.wait === 0) break
          }
          const wx = this.pos + x
          if (o.jump || !(c.x < wx + L + 1 && c.x + Lc + 1 > wx)) continue
          const close = Math.abs(speed - c.v)
          if (close > 0.3) {
            // Touching one that's moving past: up and over it at once.
            const need = ahead ? c.x + Lc + 2 - wx : wx + L + 2 - c.x
            o.jump = { wait: 0, t: 0, len: clamp(need / close, 8, 60), hgt: this.hgt(false), dir: ahead ? -1 : 1, landed: false, checked: false }
            this.heardJets(m)
          } else x = ahead ? c.x - L - 1 - this.pos : c.x + Lc + 1 - this.pos
        }
        const flip = finished(m) && !o.waved
        o.next -= dt * (m.busy > 0.5 && !m.leaving && !m.waiting ? 1 : 0)
        if (!o.jump && (flip || o.next <= 0)) {
          // A flip of its own as it works (and one on its way out, its task done).
          o.waved ||= flip
          o.next = (50 + this.rng.f() * 110) * (1.4 - clamp(d.level / 10))
          o.jump = { wait: Math.round(lead), t: 0, len: 14 + this.rng.f() * 6, hgt: this.hgt(false) * (0.8 + this.rng.f() * 0.4), dir: this.rng.f() < 0.5 ? -1 : 1, landed: false, checked: false }
          this.heardJets(m)
        }
      }
      m.x = x
      m.y = this.farWheel
      const wx = this.pos + x
      if (failed(m) && this.rng.f() < 0.6 * dt)
        this.puffs.push({ x: wx + 1, y: this.farWheel - 2, vx: 0, vy: -0.06 - this.rng.f() * 0.05, r: 0.7, life: 1, fade: 0.016, c: SOOT })
    }
    for (const id of this.own.keys()) if (!this.crew.mates.some(m => m.id === id)) this.own.delete(id)
  }

  /** A companion's jets heard, now and then (the Roadster's own come first). */
  private heardJets(m: Mate): void {
    if (m.here < 0.5 || this.now - this.heard < 10) return
    this.heard = this.now
    hear(this.sounds, { kind: 'jets', v: 0.35 })
  }

  private movePuffs(dt: number, was: number): void {
    const k = this.k
    if (this.kSmoke > 0.3 && this.tint === 'smoke') {
      // The burnout: tyre smoke pouring off the back wheels, left in the air as it drives on.
      const run = this.pos - was
      const n = Math.ceil((2 + run * 0.4) * dt)
      const wheel = this.wheelY()
      for (let i = 0; i < n; i++)
        this.puffs.push({
          x: was + run * this.rng.f() + 1 + this.rng.f() * (this.tall ? 5 : 3) - (this.v === 0 ? 2 * this.rng.f() : 0),
          y: wheel - this.rng.f(),
          vx: -0.12 * this.rng.f() * k,
          vy: -(0.12 + this.rng.f() * 0.25) * k,
          r: 0.8 + this.rng.f() * 0.5,
          life: 1,
          fade: 0.012 + this.rng.f() * 0.008,
          c: SMOKE,
        })
    }
    for (const p of this.puffs) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy *= 0.94
      p.r = Math.min(this.tall ? 5 : 3, p.r + 0.035 * dt * k)
      p.life -= p.fade * dt
    }
    retain(this.puffs, p => p.life > 0 && p.y > -6)
    if (this.puffs.length > 360) this.puffs.splice(0, this.puffs.length - 360)
  }

  /** The Roadster's wheels' row now: its lane's, or turning into (or out of) the lot. */
  private wheelY(): number {
    return Math.round(this.nearWheel + (this.lotWheel - this.nearWheel) * smooth(clamp(this.inLot)))
  }

  // ── Painting ─────────────────────────────────────────────────────────

  /** A colour as the weather has it: greyed under the overcast, cast blue and dark in the storm. */
  private tone(c: number, d: Dials): number {
    const nk = q(d.night, 4)
    let out = c
    if (this.kSmoke > 0) out = mix(grey(c, 0.6 * this.kSmoke), mix(HAZE[0], HAZE[1], nk), q(0.35 * this.kSmoke, 6))
    if (this.kRain > 0) out = mix(out, mix(STORM_CAST[0], STORM_CAST[1], nk), q(0.45 * this.kRain, 6))
    return out
  }

  private palette(d: Dials): void {
    const n = q(d.night, 8)
    for (const key of PAL_KEYS) this.pal[key] = this.tone(mix(DAY[key], NIGHT[key], n), d)
  }

  /** The sky's colour on a row: one a cell row (each cell holds two colours). */
  private sky(y: number, d: Dials): number {
    const n = d.night > 0.5 ? 1 : 0
    const nk = q(d.night, 8)
    const yy = (y >> 1) * 2
    const f = q(yy / Math.max(1, this.farWalk - 1), 6)
    let c = mix(mix(DAY.skyTop, NIGHT.skyTop, nk), mix(DAY.skyLow, NIGHT.skyLow, nk), f)
    if (this.kSmoke > 0) c = mix(c, mix(OVERCAST.top[n], OVERCAST.low[n], f), q(this.kSmoke, 6))
    if (this.kRain > 0) c = mix(c, mix(STORM.top[n], STORM.low[n], f), q(this.kRain, 6))
    return c
  }

  paint(px: Painter, d: Dials): void {
    if (this.W === 0 || this.segs.length === 0) return
    this.palette(d)
    const W = this.W
    // The sky.
    for (let y = 0; y < this.farWalk; y++) {
      const c = this.sky(y, d)
      for (let x = 0; x < W; x++) px.set(x, y, c)
    }
    this.paintMoon(px, d)
    this.paintClouds(px, d)
    this.paintFar(px, d)
    this.paintMid(px, d)
    this.paintRoad(px, d)
    this.paintProps(px, d)
    // The cars, far to near; anything in the air over it all.
    const flyers: (() => void)[] = []
    this.crew.clearMarks()
    for (const c of this.cars) if (c.lane === 0) this.paintTraffic(px, c, d)
    for (const m of this.crew.mates) {
      const o = this.own.get(m.id)
      if (o?.jump && o.jump.wait <= 0) flyers.push(() => this.paintMate(px, m, o, d))
      else this.paintMate(px, m, o, d)
    }
    if (this.tall) this.paintLotCars(px, d)
    if (this.jump && this.jump.wait <= 0) flyers.push(() => this.paintMain(px, d))
    else this.paintMain(px, d)
    for (const c of this.cars) if (c.lane === 1) this.paintTraffic(px, c, d)
    for (const f of flyers) f()
    this.paintPuffs(px, d)
    this.paintStars(px, d)
    if (this.kRain > 0.05) this.paintRain(px, d)
  }

  private paintMoon(px: Painter, d: Dials): void {
    if (d.night < 0.5 || this.kRain > 0.5) return
    const [mx, my] = moonPixel(d.columns, d.rows)
    const r = moonRadius(this.tall)
    for (let y = Math.max(0, Math.floor(my - r)); y <= my + r && y < this.farWalk; y++)
      for (let x = Math.floor(mx - r * 2); x <= mx + r * 2; x++) {
        const k = moonCover(x + 0.5, y + 0.5, mx, my, r)
        if (k > 0.5) px.set(x, y, mix(this.sky(y, d), MOON, q(d.night, 4) * (1 - 0.5 * this.kSmoke)))
      }
  }

  /** Fair-weather clouds (the spine's sky): puffs, flat underneath, greyer by night, gone into the overcast or the storm. */
  private paintClouds(px: Painter, d: Dials): void {
    if (!this.clouds.length) return
    const k = q((1 - Math.max(this.kSmoke, this.kRain)) * (1 - d.night), 4)
    if (k <= 0) return
    const off = this.pos * F_CLOUD + d.t * 0.02
    for (const c of this.clouds) {
      const x0 = Math.round(c.a - off)
      if (x0 > this.W || x0 + c.w < 0) continue
      for (let x = Math.max(0, x0); x < Math.min(this.W, x0 + c.w); x++) {
        const u = (x - x0 + 0.5) / c.w
        // Two or three lumps along it.
        const bump = Math.sqrt(Math.max(Math.sin(Math.PI * u), 0.8 * Math.sin(Math.PI * clamp(u * 1.6 - 0.1)), 0.7 * Math.sin(Math.PI * clamp(u * 1.6 - 0.5))))
        const top = c.h - Math.round(bump * c.form)
        for (let y = Math.max(0, top); y <= c.h + 1; y++) {
          const sky = this.sky(y, d)
          px.set(x, y, mix(sky, y >= c.h ? 0xd4dce6 : 0xf6f8fa, k))
        }
      }
    }
  }

  /** The backdrop: the city's skyline, hazy, its windows lit by night; hills beyond the suburbs and the freeway. */
  private paintFar(px: Painter, d: Dials): void {
    const P = this.pal
    const off = this.pos * F_FAR
    const base = this.farWalk
    for (const p of this.fars) {
      const x0 = Math.round(p.a - off)
      if (x0 > this.W || x0 + p.w < 0) continue
      if (p.kind <= TOWN) {
        const top = Math.max(0, Math.round(base - p.h))
        const c = mix(P.haze, this.sky(top, d), 0.3)
        for (let x = Math.max(0, x0); x < Math.min(this.W, x0 + p.w); x++)
          for (let y = top; y < base; y++) {
            const lit = d.night > 0.5 && (x & 1) === 0 && (y & 1) === 1 && hash(p.seed + x - x0, y, 31) < 0.18
            px.set(x, y, lit ? mix(c, P.hazeLit, 0.7) : c)
          }
      } else {
        const c = p.form ? P.hillFar : mix(P.hill, P.hillFar, 0.4)
        for (let x = Math.max(0, x0); x < Math.min(this.W, x0 + p.w); x++) {
          const u = (x - x0) / p.w
          const h = p.h * Math.sin(Math.PI * u) * (0.75 + 0.5 * noise1((x - x0) * 0.08, p.seed))
          // One edge a cell row: whole cells of hill under the sky's own.
          const top = Math.max(0, (Math.round(base - h) >> 1) * 2)
          for (let y = top; y < base; y++) px.set(x, y, c)
        }
      }
    }
  }

  /** Across the road: the city's towers, the town's shops, the suburbs' houses and trees, the freeway's wall and billboards. */
  private paintMid(px: Painter, d: Dials): void {
    const P = this.pal
    const off = Math.round(this.pos * F_MID)
    const base = this.farWalk
    const night = d.night > 0.5
    const nk = q(d.night, 8)
    const tall = this.tall
    for (const p of this.mids) {
      const x0 = p.a - off
      if (x0 > this.W || x0 + p.w < 0) continue
      const top = Math.max(0, (Math.round(base - p.h) >> 1) * 2)
      if (p.kind === CITY || (p.kind === TOWN && !tall && p.h >= 3)) {
        const i = p.c % TOWER.length
        const body = this.tone(mix(TOWER[i]!, TOWER_N[i]!, nk), d)
        for (let x = Math.max(0, x0); x < Math.min(this.W, x0 + p.w); x++)
          for (let y = top; y < base; y++) {
            const win = (x - x0) % 2 === 1 && y % 2 === 1 && x - x0 < p.w - 1 && y > top
            const lit = win && hash(p.seed + x - x0, y, 7) < (night ? 0.45 : 0)
            px.set(x, y, win ? (lit ? P.lit : P.glassWin) : body)
          }
      } else if (p.kind === TOWN) {
        // A shopfront: its window and awning along the pavement, a storey or two above.
        const i = p.c % SHOP.length
        const wall = this.tone(mix(SHOP[i]!, SHOP_N[i]!, nk), d)
        const awn = this.tone(AWNING[p.c % AWNING.length]!, d)
        const shopTop = base - (tall ? 6 : 2)
        for (let x = Math.max(0, x0); x < Math.min(this.W, x0 + p.w); x++)
          for (let y = top; y < base; y++) {
            const u = x - x0
            let c = wall
            if (y >= shopTop + (tall ? 2 : 1) && u > 0 && u < p.w - 1) c = night && hash(p.seed, u >> 2, 3) < 0.7 ? P.shopLit : P.shopWin
            else if (y >= shopTop && y < shopTop + (tall ? 2 : 1)) c = tall && (u >> 1) % 2 ? mix(awn, 0xffffff, 0.6) : awn
            else if (u % 3 === 1 && y % 2 === 1 && y > top && u < p.w - 1) c = hash(p.seed + u, y, 9) < (night ? 0.5 : 0) ? P.lit : P.glassWin
            px.set(x, y, c)
          }
      } else if (p.kind === SUBURB) {
        if (p.form) this.paintTree(px, x0, p.w, base, p.h, P)
        else {
          // A house: its wall and a window, a roof stepping up to the ridge.
          const i = p.c % HOUSE.length
          const wall = this.tone(mix(HOUSE[i]!, HOUSE_N[i]!, nk), d)
          const roof = this.tone(mix(ROOF[p.c % ROOF.length]!, ROOF_N[p.c % ROOF.length]!, nk), d)
          const eave = base - Math.round(p.h * 0.5) - (tall ? 0 : 0)
          const eaveY = (eave >> 1) * 2
          for (let x = Math.max(0, x0); x < Math.min(this.W, x0 + p.w); x++) {
            const u = x - x0
            const edge = Math.min(u, p.w - 1 - u)
            const ridge = Math.max(top, eaveY - Math.min(tall ? 6 : 2, Math.floor(edge * (tall ? 0.8 : 0.5))) - (tall ? 0 : 0))
            for (let y = ridge; y < eaveY; y++) px.set(x, y, roof)
            for (let y = eaveY; y < base; y++) {
              const win = tall ? u % 6 >= 2 && u % 6 <= 3 && y >= eaveY + 2 && y < eaveY + 4 : (u === 3 || u === p.w - 4) && y === eaveY
              px.set(x, y, win ? (night && hash(p.seed, u >> 2, 5) < 0.6 ? P.lit : P.glassWin) : wall)
            }
          }
        }
      } else if (p.form === 0) {
        // The sound wall, its panels.
        for (let x = Math.max(0, x0); x < Math.min(this.W, x0 + p.w); x++)
          for (let y = base - Math.max(1, Math.round(p.h)); y < base; y++) px.set(x, y, (x - x0) % (tall ? 10 : 8) === 0 ? P.wallLine : P.wall)
      } else if (p.form === 1) this.paintTree(px, x0, p.w, base, p.h, P)
      else {
        // A billboard on its posts.
        const face = this.tone(BILLBOARD[p.c % BILLBOARD.length]!, d)
        const faceTop = top
        const faceH = tall ? 8 : 2
        for (let x = Math.max(0, x0); x < Math.min(this.W, x0 + p.w); x++) {
          for (let y = faceTop; y < faceTop + faceH; y++) px.set(x, y, night ? mix(face, 0, 0.4) : face)
          if (x - x0 === 2 || x - x0 === p.w - 3) for (let y = faceTop + faceH; y < base; y++) px.set(x, y, P.pole)
        }
      }
    }
  }

  private paintTree(px: Painter, x0: number, w: number, base: number, h: number, P: Pal): void {
    const tall = this.tall
    const trunkH = tall ? 3 : 0
    const cy = base - trunkH - h / 2
    for (let x = Math.max(0, x0); x < Math.min(this.W, x0 + w); x++) {
      const u = (x - x0 + 0.5) / w - 0.5
      const half = (h / 2) * Math.sqrt(Math.max(0, 1 - 4 * u * u))
      const top = Math.max(0, (Math.round(cy - half) >> 1) * 2)
      const bot = Math.min(base, Math.round(cy + half))
      for (let y = top; y < bot; y++) px.set(x, y, u > 0.15 ? P.treeDark : P.tree)
      if (tall && Math.abs(u) < 0.15) for (let y = bot; y < base; y++) px.set(x, y, P.trunk)
    }
  }

  /** World x to a column. */
  private col(x: number): number {
    return Math.round(x - this.pos) + this.carX
  }

  /** The road and its pavements: each stretch its own, the lane line blurring with speed. */
  private paintRoad(px: Painter, d: Dials): void {
    const P = this.pal
    const H = this.H
    const tall = this.tall
    const run = this.v
    const left = this.pos - this.carX
    let si = 0
    for (let x = 0; x < this.W; x++) {
      const wx = Math.round(left) + x
      while (si < this.segs.length - 1 && wx >= this.segs[si]!.b) si++
      const s = this.segs[si]!
      const kind = s.kind
      // The far pavement (the freeway's barrier).
      for (let y = this.farWalk; y < this.farWheel - (tall ? 4 : 0); y++) {
        let c = kind === FREEWAY ? (y === this.farWalk ? P.barrierTop : P.barrier) : kind === SUBURB ? (y === this.farWalk && tall ? P.grass : P.walk) : P.walk
        if (kind === LOT && !tall) c = P.lot
        px.set(x, y, c)
      }
      // The lanes.
      for (let y = this.farWheel - (tall ? 4 : 0); y <= this.nearWheel; y++) px.set(x, y, P.asphalt)
      // The lane line, blurred over the frame's run.
      const per = (kind === FREEWAY ? 16 : 12) * this.k
      const on = per / 2
      let cover = 0
      const n = run > 1 ? 4 : 1
      for (let i = 0; i < n; i++) if ((((wx + (i * run) / n) % per) + per) % per < on) cover++
      const line = kind === SUBURB ? P.yellow : P.dash
      const lc = mix(P.asphalt, line, q(cover / n, 3))
      for (let y = this.dashY; y < this.dashY + (tall ? 2 : 1); y++) px.set(x, y, lc)
      // The near kerb (the freeway's shoulder line), and in the spine the pavement, verge or lot beyond it.
      for (let y = this.kerb; y < (tall ? this.kerb + 2 : H); y++) px.set(x, y, kind === FREEWAY ? (y === this.kerb ? P.dash : P.asphalt) : P.kerb)
      if (tall) {
        for (let y = this.kerb + 2; y < H; y++) {
          let c = kind === TOWN ? P.walk : kind === LOT ? P.lot : P.grass
          if (kind !== TOWN && kind !== LOT && (y + (wx >> 3)) % 7 === 0) c = P.grassDark
          px.set(x, y, c)
        }
      }
    }
    // The lots: paving and bay lines (across the road in the band, on the near side in the spine).
    for (const s of this.segs) {
      if (s.kind !== LOT) continue
      const x0 = this.col(s.a)
      const x1 = this.col(s.b)
      if (x1 < 0 || x0 > this.W) continue
      const top = tall ? this.kerb + 2 : this.lotWheel - 2
      const bot = tall ? H : this.farWalk + 1
      for (let x = Math.max(0, x0); x < Math.min(this.W, x1); x++) for (let y = top; y < bot; y++) px.set(x, y, P.lot)
      for (const b of this.bays(s)) {
        const lx = this.col(b - 1)
        for (let y = top + (tall ? 2 : 0); y <= this.lotWheel; y++) {
          px.set(lx, y, P.lotLine)
          if (tall) px.set(lx + this.bayW, y, P.lotLine)
        }
      }
    }
    if (!tall) this.paintLotCars(px, d)
    // By night (and in the storm), its headlight lights the road ahead.
    const beam = Math.max(clamp((d.night - 0.3) / 0.4), this.kRain)
    if (beam > 0 && this.inLot < 0.5 && !this.jump) {
      const nose = this.carX + this.main.w
      const len = 30 * this.k
      const rows = tall ? 4 : 1
      for (let i = 0; i < len; i++) {
        const k = q(beam * 0.45 * (1 - i / len) ** 2, 4)
        // A wedge: widening ahead of the lamp, then fading.
        for (let r = 0; r < rows && r <= (i * rows) / (len * 0.4); r++) px.set(nose + i, this.nearWheel - r, mix(px.get(nose + i, this.nearWheel - r), 0xfff0c8, k))
      }
    }
  }

  /** The cars parked in the lots' bays (none where it parks). */
  private paintLotCars(px: Painter, d: Dials): void {
    for (const s of this.segs) {
      if (s.kind !== LOT) continue
      for (const b of this.bays(s)) {
        if (!this.bayFull(b)) continue
        const x = this.col(b) + 1
        if (x > this.W || x + 24 < 0) continue
        const spr = this.near
        const c = this.tone(mix(TRAFFIC[Math.floor(hash1(b) * TRAFFIC.length)]!, 0x101014, q(d.night, 4) * 0.5), d)
        this.drawCar(px, spr, x, this.lotWheel - spr.h + 1, 0, this.livery(c, d, 0), false)
      }
    }
  }

  /** What stands on the far pavement: street lamps and traffic lights, power poles, the freeway's lights and gantries, the lot's sign. */
  private paintProps(px: Painter, d: Dials): void {
    const P = this.pal
    const tall = this.tall
    const k = this.k
    const night = d.night > 0.5 || this.kRain > 0.5
    const base = this.farWalk
    const smear = this.v > 2.2 * k ? Math.min(5, Math.round(this.v / k / 1.6)) : 0
    const post = (x: number, top: number, c: number) => {
      for (let y = top; y < base + (tall ? 1 : 0); y++) {
        px.set(x, y, c)
        for (let i = 1; i <= smear; i++) px.set(x + i, y, mix(px.get(x + i, y), c, q(0.6 / (i + 0.5), 3)))
      }
    }
    for (const s of this.segs) {
      const x0 = this.col(s.a)
      const x1 = this.col(s.b)
      if (x1 < -20 || x0 > this.W + 20) continue
      if (s.kind === TOWN || s.kind === LOT) {
        for (let wx = s.a + 10 * k; wx < s.b - 4; wx += 40 * k) {
          // A street lamp: its post, the arm out over the road, the lamp.
          const x = this.col(wx) & ~1
          const top = tall ? base - 26 : 1
          post(x, top, P.pole)
          px.set(x + 1, top, P.pole)
          px.set(x + 2, top, night ? P.lamp : P.lampHead)
          if (night) {
            if (d.wait > 0) px.lamp(x + 2, top, P.lamp)
            for (let y = base; y < this.farWheel - (tall ? 4 : 0); y++) for (let i = -1; i <= 4; i++) px.set(x + i, y, P.pool)
          }
        }
        if (s.kind === TOWN) {
          // A traffic light at the corner: green as it goes through.
          const x = this.col(s.a + 2 * k) & ~1
          const top = tall ? base - 20 : 2
          post(x, top + (tall ? 4 : 1), P.pole)
          for (let y = top; y < top + (tall ? 4 : 1); y++) px.set(x, y, 0x1a1c1e)
          px.set(x, top + (tall ? 3 : 0), P.green)
        } else {
          // The lot's sign: a blue square on its post.
          const x = this.col(s.a + 4 * k) & ~1
          const top = tall ? base - 16 : 0
          const sz = tall ? 4 : 2
          post(x + 1, top + sz, P.pole)
          for (let y = top; y < top + sz; y++) for (let i = 0; i < sz; i++) px.set(x + i, y, P.pBlue)
          if (tall) px.set(x + 1, top + 1, 0xffffff)
        }
      } else if (s.kind === SUBURB) {
        // Power poles, the wires slung between them (in the spine).
        const gap = 56 * k
        for (let wx = s.a + 8 * k; wx < s.b - 4; wx += gap) {
          const x = this.col(wx) & ~1
          const top = tall ? base - 30 : 0
          post(x, top, P.trunk)
          px.set(x - 1, top + 1, P.trunk)
          px.set(x + 1, top + 1, P.trunk)
          if (tall)
            for (let i = 1; i < gap; i++) {
              const u = i / gap
              px.set(x + i, top + 1 + Math.round(4 * u * (1 - u) * 3), mix(px.get(x + i, top + 2), 0x202022, 0.7))
            }
        }
      } else if (s.kind === FREEWAY) {
        for (let wx = s.a + 20 * k; wx < s.b - 4; wx += 72 * k) {
          // A tall light, its arm out over the lanes.
          const x = this.col(wx) & ~1
          const top = tall ? base - 34 : 0
          post(x, top, P.pole)
          for (let i = 1; i <= (tall ? 6 : 3); i++) px.set(x + i, top, P.pole)
          px.set(x + (tall ? 6 : 3), top + (tall ? 1 : 0), night ? P.lamp : P.lampHead)
        }
        if (s.b - s.a > 300 * k) {
          // A gantry sign across the lanes.
          const x = this.col(s.a + 120 * k) & ~1
          const sw = Math.round(18 * k) & ~1
          const top = tall ? base - 40 : 0
          const sh = tall ? 8 : 2
          post(x, top, P.pole)
          post(x + sw - 1, top, P.pole)
          for (let i = 0; i < sw; i++)
            for (let y = top; y < top + sh; y++) {
              const text = tall ? y > top + 1 && y < top + sh - 2 && i > 1 && i < sw - 2 && hash(i, y, s.seed) < 0.5 : y === top && i > 1 && i < sw - 2 && i % 3 !== 0
              px.set(x + i, y, text ? P.signText : P.sign)
            }
        }
      }
    }
  }

  /** A car's colours: its body (and shade), glass, lamps, tyres; by night a little darker. */
  private livery(c: number, d: Dials, lights: number): Livery {
    const n = q(d.night, 4)
    const B = this.tone(mix(c, mix(c, 0x0a0c12, 0.45), n), d)
    const lit = lights > 0
    return {
      B,
      b: mix(B, 0x000000, 0.22),
      G: GLASS,
      T: lights === 2 ? HAZARD : lit || n > 0.5 ? TAIL : mix(TAIL, B, 0.4),
      L: lights === 2 ? HAZARD : lit ? HEAD : mix(0xd8dce0, B, 0.3),
      W: TYRE,
      R: this.tall ? RIM : TYRE,
      X: B,
      d: mix(B, 0x000000, 0.4),
    }
  }

  /**
   * A car: its sprite at (x, top), turned by `ang` about its middle (each
   * pixel twice as tall as wide, so it's turned as it looks, not as stored).
   * `lamps` shines its lights through the waiting look's sepia.
   */
  private drawCar(px: Painter, s: Sprite, x: number, top: number, ang: number, l: Livery, lamps: boolean): void {
    const color = (ch: string): number | undefined => {
      switch (ch) {
        case 'B':
          return l.B
        case 'b':
          return l.b
        case 'G':
          return l.G
        case 'T':
          return l.T
        case 'L':
          return l.L
        case 'W':
          return l.W
        case 'R':
          return l.R
        case 'X':
          return l.X
        case 'd':
          return l.d
        default:
          return undefined
      }
    }
    if (ang === 0) {
      for (let j = 0; j < s.h; j++)
        for (let i = 0; i < s.w; i++) {
          const ch = s.rows[j]![i]!
          const c = color(ch)
          if (c === undefined) continue
          if (lamps && (ch === 'T' || ch === 'L')) px.lamp(x + i, top + j, c)
          else px.set(x + i, top + j, c, true)
        }
      return
    }
    const cx = x + s.w / 2
    const cy = top + s.h / 2
    const cos = Math.cos(ang)
    const sin = Math.sin(ang)
    const R = Math.hypot(s.w / 2, s.h)
    for (let sy = Math.floor(cy - R / 2 - 1); sy <= cy + R / 2 + 1; sy++)
      for (let sx = Math.floor(cx - R - 1); sx <= cx + R + 1; sx++) {
        const X1 = sx + 0.5 - cx
        const Y1 = (sy + 0.5 - cy) * 2
        const X = X1 * cos + Y1 * sin
        const Y = -X1 * sin + Y1 * cos
        const i = Math.floor(X + s.w / 2)
        const j = Math.floor(Y / 2 + s.h / 2)
        if (i < 0 || j < 0 || i >= s.w || j >= s.h) continue
        const c = color(s.rows[j]![i]!)
        if (c !== undefined) px.set(sx, sy, c, true)
      }
  }

  private paintMain(px: Painter, d: Dials): void {
    const s = this.main
    const top = this.wheelY() - s.h + 1 - this.lift(this.jump)
    const lights = d.night > 0.3 || this.kRain > 0.3 || d.wait > 0 ? 1 : 0
    this.drawCar(px, s, this.carX, top, this.turn(this.jump), this.livery(PEARL, d, lights), d.wait > 0)
  }

  private paintMate(px: Painter, m: Mate, o: Own | undefined, d: Dials): void {
    if (Number.isNaN(m.x)) return
    const s = ROADSTER
    const x = Math.round(this.carX + m.x)
    if (x > this.W || x + s.w < 0) return
    const lift = this.lift(o?.jump)
    const top = this.farWheel - s.h + 1 - lift
    // Lights: on while it works (and on its way); hazards while it waits on you; off while it's quiet.
    const lights = m.waiting && !m.leaving ? (beckon(m, d.t) ? 2 : 0) : m.busy >= 0.5 || m.leaving || m.here < 1 ? 1 : 0
    this.drawCar(px, s, x, top, this.turn(o?.jump), this.livery(LIVERY[m.slot % LIVERY.length]!, d, lights), false)
    this.crew.mark(m, x / 2, top / 2, s.w / 2, (s.h + 1) / 2, d.columns, d.rows)
  }

  private paintTraffic(px: Painter, c: Car, d: Dials): void {
    const near = c.lane === 1
    const s = c.truck ? TRUCK : near ? this.near : SEDAN
    const x = this.col(c.x)
    if (x > this.W || x + s.w < 0) return
    const wheel = near ? this.nearWheel : this.farWheel
    const lit = d.night > 0.3 || this.kRain > 0.3 ? 1 : 0
    const l = this.livery(c.c, d, lit)
    if (c.truck) l.X = this.tone(mix(0xd8d8d4, 0x2a2a2a, q(d.night, 4) * 0.6), d)
    this.drawCar(px, s, x, wheel - s.h + 1, 0, l, false)
  }

  private paintPuffs(px: Painter, d: Dials): void {
    for (const p of this.puffs) {
      const x = this.col(p.x)
      const r = p.r
      const a = q(p.life * (p.c === VAPOUR ? 0.9 : 0.75), 4)
      if (a <= 0) continue
      const c = p.c === SMOKE ? this.tone(mix(SMOKE, 0x5a5a5e, q(d.night, 2) * 0.5), d) : p.c
      for (let y = Math.floor(p.y - r / 2); y <= p.y + r / 2; y++)
        for (let xx = Math.floor(x - r); xx <= x + r; xx++) {
          const dd = ((xx - x) / Math.max(0.5, r)) ** 2 + ((y - p.y) / Math.max(0.5, r / 2)) ** 2
          if (dd > 1) continue
          px.set(xx, y, mix(px.get(xx, y), c, a))
        }
    }
  }

  /** Stars in the open sky by night (not through the overcast or the storm). */
  private paintStars(px: Painter, d: Dials): void {
    if (d.night < 0.5 || this.kSmoke > 0.3 || this.kRain > 0.3) return
    const cols = d.columns
    for (let r = 0; r < this.farWalk >> 1; r++)
      for (let c = 0; c < cols; c++) {
        const h = hash(c, r, 1977)
        if (h > 0.06) continue
        const sky = this.sky(r * 2, d)
        if (px.get(c * 2, r * 2) !== sky || px.get(c * 2 + 1, r * 2 + 1) !== sky || px.get(c * 2 + 1, r * 2) !== sky) continue
        px.dot(c * 2 + (h < 0.03 ? 0 : 1), r * 4 + Math.floor(h * 60) % 4, h < 0.02 ? STAR : STAR_DIM)
      }
  }

  /** The storm's rain, driving past (slanting more the faster it goes). */
  private paintRain(px: Painter, d: Dials): void {
    const n = Math.round(px.dw * px.dh * 0.025 * this.kRain)
    const slant = 1 + this.v / this.k / 3
    for (let i = 0; i < n; i++) {
      const x0 = hash1(i * 3 + 1) * px.dw
      const y0 = hash1(i * 3 + 2) * px.dh
      const fall = d.t * 3
      const y = (y0 + fall) % px.dh
      const x = (((x0 - fall * slant * 0.5) % px.dw) + px.dw) % px.dw
      px.dot(x, y, this.tone(RAIN, d))
    }
  }
}

export const roadsterScene = defineScene({
  name: 'roadster',
  blurb: "Tesla's new Roadster, from a city lot to the freeway with the work, flipping over the traffic at 10",
  night: true,
  aliases: ['tesla', 'car'],
  make: seed => new Roadster(seed),
})
