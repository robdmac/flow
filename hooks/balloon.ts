// REVISION: flow-v140-mini-balloons
//
// A hot-air balloon in the sky world (sky.ts): the level is its target
// altitude. At 1 it sits on the grass among trees and houses; it climbs past
// birds and the layered clouds into a thinning sky; at 10 it floats in space
// among stars, Earth's blue rim below. It drifts side to side in the wind,
// its burner flickers while it climbs, a failed command grays the burner's
// flame and leaves a trail of sooty smoke drifting off behind it, and a
// nearly-full context turns the stripes blue. While Claude waits on the person
// it hovers where it is, its burner off but for the pilot glowing with each
// slow breath (sky.ts, waiting.ts).
//
// Each subagent flies a companion: a miniature of the balloon (the same
// parts: a striped envelope, its throat and burner, the basket on its lines),
// striped in its own pair of colors (crew.ts). The big one is drawn in cells,
// the small ones in quadrant pixels so they can bob by half a cell; both are
// painted part by part through one palette (`partColor`). It rises into view
// from below when its agent starts, flies high with its burner flickering
// while the agent works, lets the burner go out and sinks low while it's
// quiet (its envelope blinking while it waits on you, a light that shines
// through the wait's sepia), and when the agent is done climbs away off the
// top (or, if it failed, sinks away below). Each flies its own way: its own
// cruising height, a slow random drift of its own, and its own buoyancy (how
// fast it climbs on its burner, how slowly it sinks as it cools), so no two
// move in step.

import type { AgentDial } from './agents'
import { isTall, type Cells } from './cells'
import { Crew, smooth, type AgentMark, type Mate } from './crew'
import { clamp01, dist, fitQuad, g, hash, hash1, mix, NEAR, noise1, QUAD, type QuadFit } from './pixels'
import { skyColor, SkyWorld } from './sky'
import { defineScene } from './scene-def'
import type { Ambience } from './sound'
import { breath } from './waiting'

export { skyColor }

const C = {
  stripeA: 0xe04a3a,
  stripeB: 0xf2c14e,
  blueA: 0x3a7be0,
  blueB: 0xe8eef8,
  rope: 0x9a9a9a,
  basket: 0x8b5a2b,
  flame: [0xffd166, 0xff9f1c, 0xff6b1a] as const,
  smoke: 0x9a9a9a,
  soot: 0x38383c,
}

/** Each companion's stripes (A, B), by slot: the big one's red and gold recolored, one pair a balloon. */
const COMPANION = [
  [0x2e9e5e, 0xf4efd8],
  [0x8a52dc, 0xf6a8cc],
  [0xe8862a, 0x23407e],
  [0xd2366e, 0x7fe0e8],
] as const

/** What each part of a balloon is: one vocabulary for the big one's cells and the small ones' pixels. */
const ENVELOPE = 1
const BURNER = 2
const ROPE = 3
const BASKET = 4
const PART: Record<string, number> = { E: ENVELOPE, F: BURNER, R: ROPE, K: BASKET }

/** The colors a balloon is painted in this frame (one reused object each: nothing allocated a frame). */
interface Paint {
  /** The envelope's stripes, alternating column by column. */
  a: number
  b: number
  /** The burner's mouth: its flame while lit, else the envelope's own color (or the pilot's glow). */
  burner: number
}

/** A part's color: stripes by the cell column they're in, so a stripe never splits a cell. */
function partColor(part: number, col: number, p: Paint): number {
  if (part === ENVELOPE) return col % 2 === 0 ? p.a : p.b
  if (part === BURNER) return p.burner
  return part === ROPE ? C.rope : C.basket
}

/** The balloon, 7 wide × 4 tall, glyph by glyph, and what each cell is; ' ' lets the sky through. */
const SPRITE = [' ▄▆█▆▄ ', '███████', ' ▀█▀█▀ ', '  ╲█╱  '] as const
const SPRITE_PARTS = [' EEEEE ', 'EEEEEEE', ' EEFEE ', '  RKR  '] as const
const SPRITE_GLYPHS = SPRITE.map(row => Array.from(row, ch => g(ch)))
const SPRITE_ROLES = SPRITE_PARTS.map(row => Array.from(row, ch => PART[ch] ?? 0))

/** A companion: the balloon in quadrant pixels (2 × 2 a cell), part by part; '.' lets the sky through. */
interface Mini {
  /** Size in pixels, and in cells across. */
  w: number
  h: number
  cols: number
  parts: Uint8Array
}

function mini(rows: readonly string[]): Mini {
  const w = rows[0]!.length
  const parts = new Uint8Array(w * rows.length)
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) parts[y * w + x] = PART[row[x]!] ?? 0
  })
  return { w, h: rows.length, cols: w >> 1, parts }
}

/** The spine's companion, 5 cells × 4: its envelope, the throat with the burner, the lines down to the basket. */
const MINI_TALL = mini([
  '..EEEEEE..',
  '.EEEEEEEE.',
  'EEEEEEEEEE',
  'EEEEEEEEEE',
  '.EEEEEEEE.',
  '..EEFFEE..',
  '...R..R...',
  '....KK....',
])

/**
 * The band's, 5 cells × 3 (it has 10 pixels of height to fly in): a pixel is
 * twice as tall as it's wide, so this is about as round as the spine's.
 */
const MINI_BAND = mini([
  '..EEEEEE..',
  '.EEEEEEEE.',
  'EEEEEEEEEE',
  '.EEEEEEEE.',
  '...EFFE...',
  '....KK....',
])

/** Room for this many companion balloons. */
const CREW = 4

/** Quadrant glyph code points (0x2580..0x259f) to their pixel masks; -1 for the rest. */
const MASK_OF = new Int8Array(32).fill(-1)
QUAD.forEach((cp, mask) => {
  if (cp >= 0x2580 && cp < 0x25a0) MASK_OF[cp - 0x2580] = mask
})

export class Balloon extends SkyWorld {
  /** The subagents, one by one: each flies a companion. */
  agents: readonly AgentDial[] = []
  private crew = new Crew(CREW)
  /** Each companion's climb (pixel rows a frame, by slot): its own buoyancy carries it. */
  private vy = new Float64Array(CREW)
  /** And how high each means to be (by slot, 0 low .. 1 high), following its agent at a pace of its own. */
  private lift = new Float64Array(CREW)
  private paint: Paint = { a: 0, b: 0, burner: 0 }
  private q = new Int32Array(4)
  private fit: QuadFit = { mask: 0, fg: 0, bg: 0, spread: 0 }
  /** Where the big balloon is this frame (its left column, its top row): the companions keep clear of it. */
  private mainX = 0
  private mainTop = 0

  ambience(): Ambience {
    // The burner, lit while it climbs (as drawn), and the wind it climbs into.
    return { burner: this.burning ? 1 : 0 }
  }

  /** The burner's lit while it climbs, and high up; not while it hovers, waiting on the person. */
  private get burning(): boolean {
    return !this.waiting && (Math.max(this.goal, this.target) > this.alt + 0.3 || this.strength >= 6)
  }

  protected vehicleHeight(): number {
    return SPRITE.length
  }

  /** The balloon's left column: it wanders the middle of the band in the wind. */
  private balloonX(): number {
    const w = this.columns
    const wander = Math.sin(this.t * 0.0045) * 0.28 + Math.sin(this.t * 0.0017) * 0.12
    const x = Math.round(w / 2 - 3 + wander * w)
    return Math.max(0, Math.min(Math.max(0, w - 7), x))
  }

  protected drawVehicle(out: Cells, top: number): void {
    // The companions first: they keep clear of the big balloon (fly), and if one is still on its way
    // past it, it's the session's own balloon that stays in front.
    this.drawCompanions(out)
    if (this.tint === 'smoke') this.drawSmoke(out, top)
    this.drawBalloon(out, top)
  }

  /** A failed command: sooty smoke off the burner, drifting back and up on the wind, thinning out. */
  private drawSmoke(out: Cells, top: number): void {
    const w = this.columns
    const h = this.rows
    const bx = this.balloonX() + 3
    const puff = this.t >> 2
    for (let k = 1; k <= 9; k++) {
      const x = bx - k - 1
      const r = top + 2 - Math.floor(k / 3)
      if (x < 0 || x >= w || r < 0 || r >= h) continue
      // Puffs come and go along the trail as it drifts.
      const n = hash(k - puff, 0, 91)
      if (n < 0.2) continue
      const i = r * w + x
      const behind = out.behind(i)
      const thin = k / 10
      out.set(i, g(k < 5 && n > 0.45 ? '▓' : '▒'), mix(C.soot, behind, thin * 0.5), behind)
    }
  }

  /** The companion this layout draws. */
  private get mini(): Mini {
    return isTall(this.columns, this.rows) ? MINI_TALL : MINI_BAND
  }

  /** How many companions this layout has room for, every one whole and clear of the others. */
  private roomFor(): number {
    const w = this.columns
    const h = this.rows
    if (!isTall(w, h)) return Math.max(1, Math.min(CREW, Math.floor(w / 12)))
    // The spine: lanes one above another in its top half, as many as fit clear of each other, on both
    // sides if it's wide enough for one each side of the big balloon.
    return Math.max(1, Math.min(CREW, this.across * this.lanes))
  }

  /** The spine's companions fly on both sides if there's room for one each side of the big one, else one column. */
  private get across(): number {
    return this.columns >= 2 * MINI_TALL.cols + SPRITE[0].length + 2 ? 2 : 1
  }

  /** The lowest top a working companion's lane has in the spine (pixel rows; the highest is 2). */
  private get laneBottom(): number {
    return Math.max(2, Math.floor(this.rows * 0.45) * 2 - MINI_TALL.h)
  }

  /** How many lanes, one above another, fit there clear of each other. */
  private get lanes(): number {
    return Math.floor((this.laneBottom - 2) / (MINI_TALL.h + 1)) + 1
  }

  override step(): void {
    super.step()
    this.crew.room = this.roomFor()
    this.crew.update(this.agents, this.coverageBoost)
    this.mainX = this.balloonX()
    this.mainTop = this.vehicleTop
    const mates = this.crew.mates
    for (const m of mates) {
      let rank = 0
      for (const o of mates) if (o.slot < m.slot) rank++
      this.fly(m, rank, mates.length)
    }
  }

  /** Working, a companion's burner roars in blasts of its own; resting (or leaving), it's out. */
  private burnerLit(m: Mate): boolean {
    return m.busy > 0.5 && !m.leaving && noise1(this.t * 0.06, ((m.seed * 0x7fffffff) | 0) + 17) > 0.22
  }

  /**
   * One companion's frame of flight: toward its own height (high while its
   * agent works, sunk low while it rests), plus a slow drift of its own, on
   * its own buoyancy, clear of the big balloon and of the others. In pixel
   * rows (y, its top) and cells (x, its left).
   */
  private fly(m: Mate, rank: number, n: number): void {
    const w = this.columns
    const h = this.rows
    const sp = this.mini
    const s = (m.seed * 0x7fffffff) | 0
    const u1 = hash1(s + 1)
    const u2 = hash1(s + 2)
    const u3 = hash1(s + 3)
    // Its own slow wander, two octaves of noise at a pace of its own: no rhythm, nothing in step (-1..1).
    const pace = 0.012 + 0.014 * u3
    const t = this.t
    const wy = (noise1(t * pace, s) * 0.7 + noise1(t * pace * 2.3, s + 5) * 0.3 - 0.5) * 2
    const wx = (noise1(t * pace * 0.6, s + 11) * 0.7 + noise1(t * pace * 1.7, s + 13) * 0.3 - 0.5) * 2
    // How high it means to be (0 low .. 1 high): its own feel for its agent's work, quicker or slower to
    // answer than the others' (a burner opened sooner, an envelope slower to cool).
    let lift = this.lift[m.slot]!
    if (Number.isNaN(m.y)) lift = m.busy
    else lift += (m.busy - lift) * (0.01 + 0.14 * hash1(s + 8) ** 2)
    this.lift[m.slot] = lift
    // A blast of its burner lifts it a little.
    const lit = this.burnerLit(m)
    // The big balloon, a column and a pixel row to spare round it.
    const mx0 = this.mainX - 1
    const mx1 = this.mainX + SPRITE[0].length + 1
    const my0 = this.mainTop * 2 - 1
    const my1 = (this.mainTop + SPRITE.length) * 2 + 1
    // Where it is (NaN until first placed).
    const x = m.x
    const y = m.y
    let goal: number
    let gx: number
    let ease = 0.02 + 0.03 * hash1(s + 6)
    if (!isTall(w, h)) {
      // The band: high is its top row or so, low is down at the bottom. Along it, spread over the open
      // sky either side of the big one in the order of their places, each wandering only as far as
      // keeps it clear of its neighbours; one the big one drifts up to slips across behind it, quickly.
      const floor = Math.max(0, 2 * h - sp.h)
      const hi = 1 + u1 * 0.8
      goal = Math.max(0, Math.min(floor, floor + (hi - floor) * lift + wy * (0.4 + 1.1 * lift) - (lit ? 0.6 : 0)))
      const a = Math.max(0, mx0 - sp.cols)
      const b = Math.max(0, w - sp.cols - mx1)
      const spacing = (a + b) / (n + 1)
      const amp = Math.max(0, Math.min(4, (spacing - sp.cols - 1) / 2))
      const u = (rank + 1) * spacing + (u2 - 0.5) * amp * 0.6 + wx * amp * 0.7
      gx = Math.max(0, Math.min(w - sp.cols, u <= a ? u : mx1 + (u - a)))
      if (Math.abs(gx - x) > spacing / 2 || (x < mx1 && x + sp.cols > mx0)) ease = 0.2
    } else {
      // The spine: a lane of its own height in the top half (working) and the same lane in the bottom
      // half (resting), on its own side (the slots alternate sides), its basket clear of the grass.
      const floor = Math.max(0, 2 * (h - 1) - sp.h)
      const across = this.across
      const rows = Math.max(1, Math.ceil(Math.max(1, this.crew.room) / across))
      const f = rows > 1 ? Math.floor(m.slot / across) / (rows - 1) : 0.5
      const loTop = Math.min(floor, Math.floor(h * 0.55) * 2)
      // (A short pane squeezes the lanes together, never below the floor.)
      const hi = Math.max(0, Math.min(floor, 2 + f * (this.laneBottom - 2) + (u1 - 0.5) * 2))
      const lo = Math.max(hi, loTop + f * (floor - loTop) + (u1 - 0.5) * 2)
      goal = lo + (hi - lo) * lift + wy * 3 - (lit ? 1.5 : 0)
      const onLeft = across === 1 || m.slot % 2 === 0
      const tx = across === 1 ? (w - sp.cols) / 2 + (u2 - 0.5) * 2 : onLeft ? 0.5 + u2 * 1.5 : w - sp.cols - 0.5 - u2 * 1.5
      gx = Math.max(0, Math.min(w - sp.cols, tx + wx))
      // Clear of the others on its side: each gives way by half the overlap, up or down.
      for (const o of this.crew.mates) {
        if (o === m || Number.isNaN(o.y) || Math.abs(gx - o.x) >= sp.cols + 1) continue
        const d = goal - o.y
        const gap = sp.h + 1 - Math.abs(d)
        if (gap > 0) goal += (d < 0 || (d === 0 && m.slot < o.slot) ? -gap : gap) * 0.5
      }
      goal = Math.max(0, Math.min(floor, goal))
      const yy = Number.isNaN(y) ? goal : y
      const xx = Number.isNaN(x) ? gx : x
      // At the big one's height it keeps to its own side of it, never crossing in front or behind;
      // where there's no room on that side, it goes above or below it, whichever way it was heading.
      if ((goal < my1 && goal + sp.h > my0) || (yy < my1 && yy + sp.h > my0)) {
        const right = xx + sp.cols / 2 >= this.mainX + 3.5
        const was = gx
        if (right && mx1 + sp.cols <= w) gx = Math.max(gx, mx1)
        else if (!right && mx0 - sp.cols >= 0) gx = Math.min(gx, mx0 - sp.cols)
        else if (gx < mx1 && gx + sp.cols > mx0) {
          const above = my0 - sp.h
          const up = above >= 0 && (goal + sp.h / 2 < (my0 + my1) / 2 || my1 > floor)
          if (up) goal = above
          else if (my1 <= floor) goal = my1
        }
        if (gx !== was) ease = 0.15
      }
    }
    if (Number.isNaN(x) || Number.isNaN(y)) {
      m.x = gx
      m.y = goal
      this.vy[m.slot] = 0
      return
    }
    // Buoyancy: it climbs on its burner faster than it sinks as it cools, each by its own measure.
    const k = goal < y ? 0.004 + 0.016 * hash1(s + 4) : 0.0015 + 0.008 * hash1(s + 5)
    const v = (this.vy[m.slot]! + k * (goal - y)) * (1 - 1.5 * Math.sqrt(k))
    // (An overshoot never takes it off the edge.)
    m.y = Math.max(0, Math.min(2 * h - sp.h, y + v))
    this.vy[m.slot] = m.y === y + v ? v : 0
    m.x = x + (gx - x) * ease
  }

  agentMarks(): readonly AgentMark[] {
    return this.strength > 0 ? this.crew.marks : []
  }

  /**
   * The companions: each rises into view from below as it arrives; leaving, it
   * climbs off the top downwind, or sinks away below if its agent failed. Each
   * arrives and leaves at a pace of its own.
   */
  private drawCompanions(out: Cells): void {
    const w = this.columns
    const h = this.rows
    const sp = this.mini
    const blue = this.tint === 'blue'
    const p = this.paint
    this.crew.clearMarks()
    for (const m of this.crew.mates) {
      if (Number.isNaN(m.x)) continue
      const s = (m.seed * 0x7fffffff) | 0
      const away = 1 - smooth(clamp01(m.p * (1 + 0.8 * hash1(s + 7))))
      const py = Math.round(m.leaving && m.ok ? m.y - away * (m.y + sp.h + 2) : m.y + away * (2 * h + 2 - m.y))
      const x = Math.round(m.x + (m.leaving ? away * (isTall(w, h) ? 4 : 10) : 0))
      if (py >= 2 * h || py + sp.h <= 0) continue
      const pair = COMPANION[m.slot % COMPANION.length]!
      p.a = blue ? mix(pair[0], C.blueA, 0.7) : pair[0]
      p.b = blue ? mix(pair[1], C.blueB, 0.7) : pair[1]
      // Waiting on you: the envelope blinks, out of step with any other, a light through the wait's sepia.
      const blink = m.waiting && ((this.t + m.slot * 3) >> 2) % 2 === 0
      if (blink) {
        p.a = mix(p.a, 0xffffff, 0.45)
        p.b = mix(p.b, 0xffffff, 0.45)
      }
      const lit = this.burnerLit(m)
      p.burner = !lit ? p.a : this.tint === 'smoke' ? C.smoke : C.flame[Math.floor(hash(this.t >> 1, m.slot, 5) * 3)]!
      this.drawMini(out, sp, x, py, blink)
      const top = Math.floor(py / 2)
      this.crew.mark(m, x, top, sp.cols, Math.ceil((py + sp.h) / 2) - top, w, h)
    }
  }

  /**
   * A companion at column `cx`, its top at pixel row `py`, in `this.paint`:
   * each cell it covers is its own pixels over what's already there (a
   * cloud's quadrants too), folded back into one quadrant glyph. Its lines,
   * basket and flame are kept before the envelope, so the small parts never
   * drop out of their cells. `lamp`: the envelope is a light.
   */
  private drawMini(out: Cells, sp: Mini, cx: number, py: number, lamp: boolean): void {
    const w = this.columns
    const h = this.rows
    const p = this.paint
    const q = this.q
    const fit = this.fit
    const r0 = Math.max(0, Math.floor(py / 2))
    const r1 = Math.min(h - 1, Math.floor((py + sp.h - 1) / 2))
    for (let r = r0; r <= r1; r++) {
      for (let c = 0; c < sp.cols; c++) {
        const x = cx + c
        if (x < 0 || x >= w) continue
        const i = r * w + x
        // What's there now, pixel by pixel.
        const cp = out.codePoint(i)
        const fg = out.foreground(i)
        const bg = out.background(i)
        const under = cp >= 0x2580 && cp < 0x25a0 ? MASK_OF[cp - 0x2580]! : cp === 0x20 ? 0 : -1
        const flat = out.behind(i)
        let mine = 0
        let keep = -1
        let keepPart = 0
        let envelope = false
        for (let j = 0; j < 4; j++) {
          q[j] = under < 0 ? flat : (under >> j) & 1 ? fg : bg
          const sy = r * 2 + (j >> 1) - py
          if (sy < 0 || sy >= sp.h) continue
          const part = sp.parts[sy * sp.w + c * 2 + (j & 1)]!
          if (!part) continue
          q[j] = partColor(part, c, p)
          mine |= 1 << j
          if (part === ENVELOPE) envelope = true
          if (part > keepPart) {
            keepPart = part
            keep = j
          }
        }
        if (!mine) continue
        fitQuad(q, fit, NEAR, keep)
        if (fit.spread === 0) out.set(i, QUAD[15], q[0]!, q[0]!)
        else out.set(i, QUAD[fit.mask]!, fit.fg, fit.bg)
        if (lamp && envelope) {
          const e = partColor(ENVELOPE, c, p)
          const f0 = out.foreground(i)
          const b0 = out.background(i)
          this.lamps[i] = dist(f0, e) <= dist(b0, e) ? f0 : b0
        }
      }
    }
  }

  private drawBalloon(out: Cells, top: number): void {
    const w = this.columns
    const bx = this.balloonX()
    const blue = this.tint === 'blue'
    // Hovering for the person: the pilot glows up and fades with each breath.
    const pilot = this.kWait * breath(this.t)
    const p = this.paint
    p.a = blue ? C.blueA : C.stripeA
    p.b = blue ? C.blueB : C.stripeB
    // The burner's mouth: a flicker of flame while it climbs.
    p.burner = this.tint === 'smoke'
      ? C.smoke
      : this.burning
        ? C.flame[(this.t >> 1) % C.flame.length]!
        : mix(p.a, C.flame[0], pilot)
    for (let sr = 0; sr < SPRITE_GLYPHS.length; sr++) {
      const glyphs = SPRITE_GLYPHS[sr]!
      const parts = SPRITE_ROLES[sr]!
      const r = top + sr
      if (r < 0 || r >= this.rows) continue
      for (let sc = 0; sc < glyphs.length; sc++) {
        const x = bx + sc
        const part = parts[sc]!
        if (!part || x < 0 || x >= w) continue
        // Its half-blocks show whatever is behind them: sky, or a cloud it's flying through.
        out.set(r * w + x, glyphs[sc]!, partColor(part, sc, p), out.behind(r * w + x))
      }
    }
  }
}

export const balloonScene = defineScene({
  name: 'balloon',
  blurb: 'a hot-air balloon that climbs from the grass to space',
  night: true,
  make: seed => new Balloon(seed),
})
