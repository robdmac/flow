// REVISION: flow-v173-pictures
//
// The scenes, all driven by the same dials (strength 0..10, coverage boost,
// the agents one by one, tint, night, waiting): SCENES, the one list of them (each scene file exports its
// SceneDef; add yours there), and the fire itself (`Ember`, the `fire` scene): the ░▒▓█
// Doom-style automaton of fire.ts for its shape, glyphs and crisp flicker,
// colored half its 256-color ramp, half a smooth truecolor black-body eased
// over time, with sparks breaking off the tips and cooling into smoke.
// Each running subagent gets a small fire of its own beside it (crew.ts): the
// main fire narrows to make room and they kindle on either side, a dark gap
// between each, all burning in the one automaton.
// Everything off the flames is transparent: no backgrounds. While Claude
// waits on the person the fire banks: low flames over a bed of coals along
// the bottom, glowing and fading with each slow breath (waiting.ts).

import type { AgentDial } from './agents'
import { Crew, failed, type AgentMark, type Mate } from './crew'
import { AsciiFire, colorFor, glyphFor, params, SMOKE_TIPS } from './fire'
import { Cells, freshSeed, Rng } from './cells'
export type { Cells }
import { heatColor, smokeColor } from './fire-palette'
import { BRAILLE, clamp, hash1, lowerBlock, mix, rampAt, smooth } from './pixels'
import { breath, easeWait, waitTone } from './waiting'
import { defineScene, type SceneDef } from './scene-def'
import { hear, type Ambience, type SoundEvent } from './sound'
import { balloonScene } from './balloon'
import { avalonScene } from './colony'
import { engineScene } from './engine'
import { skiScene } from './ski'
import { surfScene } from './surf'
import { falconScene, starshipScene } from './rocket'
import { warpScene } from './starfield'
import { bubblesScene } from './bubbles'
import { trainScene } from './train'
import { earthriseScene } from './earthrise'


/** What shows over a scene: smoke after a failure or a compaction, blue when the context is nearly full. */
export type Tint = 'normal' | 'smoke' | 'blue'

/** What the frame timer drives, whatever the look. */
export interface Scene {
  strength: number
  /** Company from running subagents, as a count (15 each): more streams, more stars (or, from a scene with companions, that many anonymous ones). */
  coverageBoost: number
  /**
   * Each running subagent on its own (agents.ts), in the order they started:
   * the scenes with companions give each one of its own (crew.ts) that
   * arrives, works, rests and leaves with it. Empty when there are none (or
   * an adapter can't tell them apart: then `coverageBoost` alone).
   */
  agents?: readonly AgentDial[]
  /** Where each agent's companion is drawn this frame (cells): desktop's hover cards sit over them. */
  agentMarks?(): readonly AgentMark[]
  tint: Tint
  /** Night, for the scenes that have one (the rest have no such field and ignore it). */
  night?: boolean
  /** Claude is waiting on the person (a permission, a question, a plan): settle, hold, and breathe (waiting.ts). */
  waiting?: boolean
  ensure(columns: number, rows: number): void
  step(): void
  /** The current frame's cells: what every harness draws from. */
  grid(): Cells
  /** `grid()` encoded as Raster cells, for Claude Code's terminal. */
  frame(): string
  /** What just happened on screen, to be heard: the adapter takes them (and empties it). */
  sounds?: SoundEvent[]
  /** What it's doing now, for its soundscape's background. */
  ambience?(): Ambience
  /**
   * This frame at real pixels, `w` × `h` (square), RGBA with the open sky
   * transparent, for a terminal that draws images (pi's, earthrise's alone
   * so far). A new size may take a while to make, `budget` a call: until
   * then (and at level 0) undefined, and the adapter draws `grid()`.
   */
  picture?(w: number, h: number, budget?: number): Uint8Array | undefined
  /** What a picture's size takes long to make, to keep across runs (`key` names it): once it's made, else undefined. */
  pictureCache?(): { key: string; data: Float32Array } | undefined
  /** The key `pictureCache` would give a picture `w` × `h`, and taking back what was kept under it (false: not usable). */
  pictureKey?(w: number, h: number): string
  restorePicture?(w: number, h: number, data: Float32Array): boolean
}

function defOf(style: SceneName): SceneDef {
  return SCENES.find(d => d.name === style)!
}

/** A new scene; `seed` makes it repeatable (tests, previews), else each one made starts its own way. */
export function makeScene(style: SceneName, seed = freshSeed()): Scene {
  return defOf(style).make(seed)
}

/** Whether a scene has a night as well as a day. */
export function hasNight(style: SceneName): boolean {
  return defOf(style).night === true
}

export function nextStyle(style: SceneName): SceneName {
  return STYLES[(STYLES.indexOf(style) + 1) % STYLES.length]!
}

/** A style by name, old names included (`starfield` is now `warp`). Day or night is never part of the name. */
export function styleNamed(s: string): SceneName | undefined {
  return SCENES.find(d => d.name === s || d.aliases?.includes(s))?.name
}

/** plugin.json's `style` description: every scene and its blurb (a test keeps the manifest in step). */
export function styleDescription(): string {
  return SCENES.map(d => `${d.name}: ${d.blurb}`).join('; ')
}

/** plugin.json's `time` description: which scenes have a night. */
export function timeDescription(): string {
  const night = SCENES.filter(d => d.night).map(d => d.name)
  const list = night.length > 1 ? `${night.slice(0, -1).join(', ')} and ${night.at(-1)}` : night.join('')
  return `For ${list}: clock follows your local time (night from 19:00 to 7:00); day or night pins it`
}

type Spark = { x: number; y: number; vy: number; heat: number; cool: number; phase: number }

/** Below this heat a spark has cooled into smoke: gray, slower, wider sway. */
const SMOKE_AT = 0.38
/** Ember drops cells fainter than this: on a dark terminal they read as black. */
const FAINTEST = 0.1
/** Banked coals, dull to glowing: what the base turns to while Claude waits on the person. */
const COALS = [0x3a0a04, 0x781806, 0xb8320c, 0xe85a18, 0xff8c2a, 0xffbe58] as const
/** A companion fire waiting on you: its embers pulse up to a bright glow, quicker than the breath. */
const PULSE = [0x4a1206, 0x9a2a0a, 0xe85a18, 0xffa83a, 0xffd878, 0xfff2c0] as const
/** Frames a waiting companion's pulse takes: about a second. */
const PULSE_FRAMES = 14
/** Where a glow (0..1) sits along COALS and PULSE: never quite at the brightest stop. */
const SHY = 4.999 / 5

/** Companion fires: the most the band shows; frames to arrive and to leave. */
const CREW_MAX = 6
const CREW_ARRIVE = 30
const CREW_LEAVE = 48
/** How hot a companion's burners seed: working, and quiet (embers). */
const CREW_WORK = 0.75
const CREW_REST = 0.35
/** A column's part in the layout: the main fire, a gap between fires, or a companion's (its slot, 0 and up). */
const MAIN = -1
const GAP = -2

/**
 * Half classic, half smooth. Classic's automaton at full height draws the
 * glyphs (░▒▓█ from the live heat, so the flicker stays crisp), each colored
 * half classic's 256-color ramp and half a truecolor black-body. The
 * black-body half reads a softened heat (blurred sideways, eased over a few
 * frames), which carries the smoothness into the colors instead of a
 * background. Sparks break off the tips and cool into smoke, in cells the
 * flames leave empty. Every cell keeps the terminal's own background.
 */
class Ember implements Scene {
  coverageBoost = 0
  /** The subagents, one by one: each gets a small fire of its own beside the main one. */
  agents: readonly AgentDial[] = []
  private crew = new Crew(CREW_MAX, CREW_ARRIVE, CREW_LEAVE)
  /** Per column: whose fire it is (MAIN, GAP, or a companion's slot)... */
  private owner = new Int8Array(0)
  /** ...and how alight that fire is there (1 the main fire; a companion's kindling or dying). */
  private flameAt = new Float32Array(0)
  /** Per slot: its fire's columns this frame, [from, to). */
  private span = new Float32Array(CREW_MAX * 2)
  /** Per slot: its companion this frame, if any. */
  private bySlot: (Mate | undefined)[] = new Array(CREW_MAX).fill(undefined)
  /** Companions that have given their last puff of smoke. */
  private puffed = new WeakSet<Mate>()
  sounds: SoundEvent[] = []
  tint: Tint = 'normal'
  /** Claude waits on the person: the fire banks to glowing coals. */
  waiting = false
  /** How far it has banked (0..1), eased. */
  private kWait = 0
  private core: AsciiFire
  private rng: Rng
  /** The heat softened: blurred over five columns, eased across frames. */
  private soft = new Float32Array(0)
  private sparks: Spark[] = []
  // Per-frame buffers, reused.
  private out = new Cells(0, 0)
  private bits = new Uint8Array(0)
  private spark = new Float32Array(0)
  private smoke = new Float32Array(0)
  private columns = 0
  private rows = 0
  private t = 0

  constructor(seed = freshSeed()) {
    this.core = new AsciiFire(seed)
    this.rng = new Rng(seed ^ 0x27d4eb2f)
  }

  get strength(): number {
    return this.core.strength
  }

  set strength(s: number) {
    this.core.strength = s
  }

  ensure(columns: number, rows: number): void {
    this.core.ensure(columns, rows)
    if (columns === this.columns && rows === this.rows) return
    this.columns = columns
    this.rows = rows
    this.soft = new Float32Array(columns * rows)
    this.out = new Cells(columns, rows)
    this.bits = new Uint8Array(columns * rows)
    this.spark = new Float32Array(columns * rows)
    this.smoke = new Float32Array(columns * rows)
    this.owner = new Int8Array(columns).fill(MAIN)
    this.flameAt = new Float32Array(columns).fill(1)
    this.sparks = []
  }

  agentMarks(): readonly AgentMark[] {
    return this.strength > 0 ? this.crew.marks : []
  }

  private get tall(): boolean {
    return this.rows > 8
  }

  /** A companion fire's width and the gap beside it, in columns, for this layout. */
  private crewSize(): [fire: number, gap: number] {
    const w = this.columns
    return this.tall ? [Math.max(3, Math.round(w * 0.2)), 2] : [Math.round(clamp(w * 0.07, 6, 14)), 3]
  }

  /** How many companion fires this layout shows whole, the main fire keeping most of the width. */
  private crewRoom(): number {
    const w = this.columns
    if (this.tall) return w >= 20 ? 2 : w >= 13 ? 1 : 0
    const [fire, gap] = this.crewSize()
    return Math.min(CREW_MAX, Math.floor((w * 0.6) / (fire + gap)))
  }

  /** How far a companion's place has opened (0..1): first the room, then the fire in it; last to go as it leaves. */
  private static open(m: Mate): number {
    return smooth(clamp(m.p * 2))
  }

  /** How alight a companion's fire is (0..1): it kindles once its place opens; done, it burns out (failed: snuffed at once). */
  private static flame(m: Mate): number {
    return smooth(failed(m) ? clamp((m.p - 0.75) / 0.25) : clamp((m.p - 0.35) / 0.65))
  }

  /**
   * Lay the fires out across the columns: the companions on alternate sides
   * (slot 0 right, 1 left, 2 right again...), in from each edge, each taking
   * as much room as it has opened, a gap between it and the next fire in; the
   * main fire takes what's left in the middle. Then shape the automaton's
   * burners to match.
   */
  private layout(): void {
    const w = this.columns
    const { owner, flameAt, span, core } = this
    owner.fill(MAIN)
    flameAt.fill(1)
    const [fire, gap] = this.crewSize()
    let left = 0
    let right = 0
    const bySlot = this.bySlot
    bySlot.fill(undefined)
    for (const m of this.crew.mates) bySlot[m.slot] = m
    // In from each edge, in slot order.
    for (let slot = 0; slot < CREW_MAX; slot++) {
      const m = bySlot[slot]
      if (!m) continue
      const o = Ember.open(m)
      const g = gap * o
      const f = fire * o
      // [a, b) the fire, [ga, ga + g) the gap on its inner side, toward the main fire.
      let a: number
      let b: number
      let ga: number
      if (slot % 2 === 0) {
        b = w - right
        a = b - f
        ga = a - g
        right += g + f
      } else {
        a = left
        b = left + f
        ga = b
        left += g + f
      }
      span[slot * 2] = a
      span[slot * 2 + 1] = b
      const lit = Ember.flame(m)
      for (let x = 0; x < w; x++) {
        const c = x + 0.5
        if (c >= a && c < b) {
          owner[x] = slot
          flameAt[x] = lit
        } else if (c >= ga && c < ga + g) {
          owner[x] = GAP
          flameAt[x] = 0
        }
      }
      // Kindling: sparks catch at its base as it takes.
      if (!m.leaving && lit > 0 && lit < 0.9 && this.strength > 0 && this.rng.f() < 0.3) {
        this.sparks.push({
          x: (a + this.rng.f() * (b - a)) * 2,
          y: (this.rows - 1) * 4 + 2,
          vy: 0.25 + 0.2 * this.rng.f(),
          heat: 0.75 + 0.2 * this.rng.f(),
          cool: 0.03 + 0.02 * this.rng.f(),
          phase: this.rng.f() * 6.283,
        })
      }
      // Done: a last puff of smoke as it goes out (failed: snuffed, grey smoke at once).
      if (m.leaving && !this.puffed.has(m) && (!m.ok || lit < 0.15) && this.strength > 0) {
        this.puffed.add(m)
        this.puff(a, b, m.ok ? 6 : 12)
      }
    }
    // A companion burns denser than a calm main fire (a few pilots would be no fire at all), never solid.
    const dense = Math.min(100, params(this.strength)[1] + 40)
    for (let x = 0; x < w; x++) {
      const o = owner[x]!
      if (o === MAIN) {
        core.gain[x] = 1
        core.cover[x] = -1
        core.shut[x] = 0
      } else if (o === GAP) {
        core.gain[x] = 0
        core.cover[x] = 0
        core.shut[x] = 1
      } else {
        const m = bySlot[o]!
        const lit = flameAt[x]!
        core.gain[x] = lit * (CREW_REST + (CREW_WORK - CREW_REST) * m.busy)
        core.cover[x] = dense * lit * (0.75 + 0.25 * m.busy)
        core.shut[x] = 0
      }
    }
  }

  /** Smoke rising from a fire's columns [a, b): its last breath, or a snuffed one's grey cloud. */
  private puff(a: number, b: number, n: number): void {
    const h = this.rows
    const reach = this.tall ? Math.max(2, Math.round(h * 0.25)) : 2
    for (let k = 0; k < n; k++) {
      this.sparks.push({
        x: (a + this.rng.f() * Math.max(1, b - a)) * 2,
        y: (h - 1 - this.rng.f() * reach) * 4 + 3,
        vy: 0.12 + 0.14 * this.rng.f(),
        heat: SMOKE_AT * (0.8 + 0.18 * this.rng.f()),
        cool: 0.016 + 0.012 * this.rng.f(),
        phase: this.rng.f() * 6.283,
      })
    }
  }

  step(): void {
    const w = this.columns
    const h = this.rows
    if (w === 0 || h === 0) return
    // Subagents come as fires of their own beside the main one, not a wider fire.
    this.crew.room = this.crewRoom()
    this.crew.update(this.agents, this.coverageBoost)
    this.layout()
    this.core.step()
    this.t++
    this.kWait = easeWait(this.kWait, this.waiting)
    const cells = this.core.cells
    const peak = Math.max(1, this.core.peak)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0
        let wt = 0
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const k = dx === 0 ? 3 : Math.abs(dx) === 1 ? 2 : 1
          sum += Math.min(1, cells[y * w + nx]! / peak) * k
          wt += k
        }
        const i = y * w + x
        this.soft[i] = this.soft[i]! * 0.45 + (sum / wt) * 0.55
      }
    }

    // Sparks off the tips: the topmost cell of each column hot enough.
    // Off is off: no sparks drift on once the fire is out.
    const s = this.strength
    if (s === 0) this.sparks.length = 0
    if (s > 0) {
      const chance = s === 1 ? 0.0008 : 0.0022 * s
      for (let x = 0; x < w; x++) {
        let tip = -1
        for (let y = 0; y < h; y++) {
          if (cells[y * w + x]! / peak > 0.3) {
            tip = y
            break
          }
        }
        if (tip < 0 || this.rng.f() >= chance) continue
        // A pilot only lets off the odd wisp of smoke, never a spark.
        const heat = s === 1 ? SMOKE_AT : 0.72 + 0.25 * this.rng.f()
        if (heat > SMOKE_AT) hear(this.sounds, { kind: 'crack', v: heat })
        this.sparks.push({
          x: x * 2 + this.rng.f() * 2,
          y: tip * 4,
          vy: 0.2 + 0.18 * this.rng.f(),
          heat,
          cool: 0.016 + 0.012 * this.rng.f(),
          phase: this.rng.f() * 6.283,
        })
      }
    }
    // Move, cool, and compact the live sparks in place.
    let live = 0
    for (const p of this.sparks) {
      const isSmoke = p.heat < SMOKE_AT
      if (isSmoke) p.vy = Math.max(0.05, p.vy * 0.985)
      p.y -= p.vy
      p.x += Math.sin(p.y * 0.5 + this.t * 0.15 + p.phase) * (isSmoke ? 0.3 : 0.14)
      p.heat -= isSmoke ? p.cool * 0.6 : p.cool
      if (p.heat > 0.04 && p.y >= 0 && p.x >= 0 && p.x < w * 2) this.sparks[live++] = p
    }
    this.sparks.length = live
  }

  frame(): string {
    return this.grid().encode()
  }

  grid(): Cells {
    const w = this.columns
    const h = this.rows
    const out = this.out
    const cells = this.core.cells
    const peak = Math.max(1, this.core.peak)
    const s = this.strength
    // Banked, the low flames over the coals burn orange to their roots: no pilot-blue.
    const ramp = this.kWait > 0.5 ? Math.max(s, 5) : s
    // Braille dots for the sparks and smoke, per cell.
    const { bits, spark, smoke } = this
    bits.fill(0)
    spark.fill(0)
    smoke.fill(0)
    for (const p of this.sparks) {
      const px = Math.floor(p.x)
      const py = Math.floor(p.y)
      const c = (py >> 2) * w + (px >> 1)
      if (c < 0 || c >= bits.length) continue
      bits[c]! |= BRAILLE[px & 1]![py & 3]!
      if (p.heat >= SMOKE_AT) spark[c] = Math.max(spark[c]!, p.heat)
      else smoke[c] = Math.max(smoke[c]!, p.heat / SMOKE_AT)
    }
    const { owner, bySlot } = this
    for (let i = 0; i < w * h; i++) {
      const r = cells[i]! / peak
      if (r >= FAINTEST) {
        const o = owner[i % w]!
        const mate = o >= 0 ? bySlot[o] : undefined
        const snuffed = failed(mate)
        // A failed companion's fire is snuffed: what's left of it goes grey.
        const fg = snuffed
          ? heatColor(s, Math.min(r, 0.98) * SMOKE_TIPS, 'smoke')
          : mix(colorFor(ramp, r, this.tint), heatColor(s, Math.min(1, (r + this.soft[i]!) * 0.55), this.tint), 0.5)
        out.set(i, glyphFor(r), fg)
      } else if (bits[i]) {
        const fg =
          spark[i]! > 0
            ? this.tint === 'smoke'
              ? smokeColor(1)
              : heatColor(s, spark[i]!, this.tint)
            : smokeColor(smoke[i]!)
        out.set(i, 0x2800 | bits[i]!, fg)
      } else {
        out.blank(i)
      }
    }
    if (this.kWait > 0 && s > 0) this.drawCoals(out)
    this.crew.clearMarks()
    if (s > 0) this.drawCrew(out)
    // (Its own breath, no sepia: a fire is already warm, and sepia would only dull it.)
    waitTone(out, this.kWait, this.t, 0)
    return out
  }

  /**
   * Banked: a bed of coals along the bottom row (heaped a row higher in a
   * tall pane), coming in column by column as it banks, each its own height
   * and heat, all glowing and fading together with the breath. A flame's own
   * cell stays a flame.
   */
  private drawCoals(out: Cells): void {
    const w = this.columns
    const h = this.rows
    const b = breath(this.t)
    const peak = Math.max(1, this.core.peak)
    const tall = h > 8
    for (let x = 0; x < w; x++) {
      if (hash1(x * 31 + 7) >= this.kWait) continue
      // Only under a fire, alight (the gaps stay dark); a companion waiting on you glows its own way.
      const o = this.owner[x]!
      if (this.flameAt[x]! < 0.3 || (o >= 0 && this.bySlot[o]?.waiting)) continue
      const i = (h - 1) * w + x
      if (this.core.cells[i]! / peak >= 0.6) continue
      // Each coal its own heat, shimmering a little, all swelling with the breath.
      const own = 0.45 + 0.4 * hash1(x * 131 + 3) + 0.15 * hash1(x * 977 + (this.t >> 3))
      const heat = own * (0.4 + 0.6 * b)
      const fg = rampAt(COALS, (Math.round(Math.min(1, heat) * 20) / 20) * SHY)
      out.set(i, tall ? 0x2588 : lowerBlock(4 + Math.floor(hash1(x * 17 + 1) * 5)), fg)
      const j = i - w
      if (tall && hash1(x * 53 + 11) < 0.7 && this.core.cells[j]! / peak < 0.45)
        out.set(j, lowerBlock(1 + Math.floor(hash1(x * 59 + 5) * 4)), mix(COALS[0], fg, 0.75))
    }
  }

  /**
   * The companions' fires burn in the automaton with the main one; here, a
   * waiting one's embers pulse to a bright glow (quicker than the breath, so
   * it stands out even while the whole fire banks), and each is marked for
   * its agent's hover card.
   */
  private drawCrew(out: Cells): void {
    const w = this.columns
    const h = this.rows
    const tall = this.tall
    for (const m of this.crew.mates) {
      const a = this.span[m.slot * 2]!
      const b = this.span[m.slot * 2 + 1]!
      const x0 = Math.max(0, Math.round(a))
      const x1 = Math.min(w, Math.round(b))
      if (m.waiting && !m.leaving) {
        const k = Ember.flame(m)
        const pulse = 0.5 - 0.5 * Math.cos(((this.t % PULSE_FRAMES) / PULSE_FRAMES) * 2 * Math.PI)
        for (let x = x0; x < x1; x++) {
          const own = 0.8 + 0.2 * hash1(x * 131 + 3 + (this.t >> 2))
          const fg = rampAt(PULSE, (Math.round(clamp(own * k * (0.45 + 0.55 * pulse)) * 15) / 15) * SHY)
          const i = (h - 1) * w + x
          out.set(i, tall ? 0x2588 : lowerBlock(3 + Math.round(pulse * 5)), fg)
          if (tall && pulse > 0.25) out.set(i - w, lowerBlock(1 + Math.round(pulse * 6)), fg)
        }
      }
      // Its fire's columns, over the rows its flames reach (a tall pane's lower part).
      const rows = tall ? Math.max(3, Math.round(h * 0.4)) : h
      this.crew.mark(m, x0, h - rows, x1 - x0, rows, w, h)
    }
  }
}

const fireScene = defineScene({
  name: 'fire',
  blurb: 'a ░▒▓█ fire with sparks and smoke',
  // The fire had two looks once; the softer one, `ember`, is now the fire.
  aliases: ['classic', 'ember', 'inferno', 'flame'],
  make: seed => new Ember(seed),
})

/**
 * Every scene, in `/flow next` order. To add one: export a SceneDef from its
 * file (`npm run new-scene <name>` writes one) and list it here.
 */
export const SCENES = [
  fireScene,
  warpScene,
  avalonScene,
  balloonScene,
  engineScene,
  falconScene,
  starshipScene,
  surfScene,
  skiScene,
  bubblesScene,
  trainScene,
  earthriseScene,
] as const
export type SceneName = (typeof SCENES)[number]['name']
export const STYLES: readonly SceneName[] = SCENES.map(d => d.name)
