// REVISION: flow-v126-agents
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
// Each subagent flies a small companion balloon of its own color (crew.ts):
// it rises into view from below when its agent starts, flies high with its
// burner flickering while the agent works, lets the burner go out and sinks
// low while it's quiet (its envelope blinking while it waits on you), and
// when the agent is done climbs away off the top (or, if it failed, sinks
// away below).

import type { AgentDial } from './agents'
import { isTall, type Cells } from './cells'
import { Crew, type AgentMark } from './crew'
import { g, hash, mix } from './pixels'
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
  companion: [0xe06a3a, 0x3ab0e0, 0x9a6ae0, 0x5ac46a] as const,
}

/** The balloon, 7 wide × 4 tall; ' ' cells let the sky through. */
const SPRITE = [' ▄▆█▆▄ ', '███████', ' ▀█▀█▀ ', '  ╲█╱  '] as const

/** Room for this many companion balloons. */
const CREW = 4
/** A companion's envelope, and under it its basket on the rope or, burner lit, a jet of flame into the envelope. */
const ENVELOPE = g('●')
const ROPE = g('╵')
const LIT = g('╿')

export class Balloon extends SkyWorld {
  /** The subagents, one by one: each flies a companion. */
  agents: readonly AgentDial[] = []
  private crew = new Crew(CREW)

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

  override step(): void {
    super.step()
    this.crew.update(this.agents, this.coverageBoost)
    // Each companion eases toward its place: spread across the sky in the order of their slots, high while
    // its agent works, sunk low (burner out) while it rests.
    const w = this.columns
    const h = this.rows
    const tall = isTall(w, h)
    const mates = [...this.crew.mates].sort((a, b) => a.slot - b.slot)
    mates.forEach((m, k) => {
      const sway = Math.sin(this.t * 0.01 + m.seed * 6.283) * (tall ? 1.5 : 4)
      const tx = ((k + 1) / (mates.length + 1)) * w + sway
      const up = tall ? Math.round(h * 0.12) + m.slot * 3 : 1 + (m.slot & 1)
      const low = tall ? Math.min(h - 3, up + 7) : h - 2
      const ty = low + (up - low) * m.busy
      m.x = Number.isNaN(m.x) ? tx : m.x + (tx - m.x) * 0.04
      m.y = Number.isNaN(m.y) ? ty : m.y + (ty - m.y) * 0.05
    })
  }

  agentMarks(): readonly AgentMark[] {
    return this.strength > 0 ? this.crew.marks : []
  }

  /**
   * The companions: each rises into view from below as it arrives; leaving, it
   * climbs off the top downwind, or sinks away below if its agent failed.
   */
  private drawCompanions(out: Cells): void {
    const w = this.columns
    const h = this.rows
    this.crew.clearMarks()
    for (const m of this.crew.mates) {
      if (Number.isNaN(m.x)) continue
      const away = 1 - m.here
      const y = m.leaving && m.ok ? m.y - away * (m.y + 3) : m.y + away * (h + 1 - m.y)
      const x = Math.round(m.x + (m.leaving ? away * 8 : 0))
      const r = Math.round(y)
      if (x < 0 || x >= w || r < -1 || r >= h) continue
      let color: number = C.companion[m.slot % C.companion.length]!
      if (this.tint === 'blue') color = mix(color, C.blueA, 0.6)
      // Waiting on you: the envelope blinks, out of step with any other.
      if (m.waiting && ((this.t + m.slot * 5) >> 3) % 2 === 0) color = mix(color, 0xffffff, 0.55)
      if (r >= 0) out.set(r * w + x, ENVELOPE, color, out.behind(r * w + x))
      if (r + 1 < h) {
        const lit = m.busy > 0.5 && !m.leaving
        const flame = this.tint === 'smoke' ? C.smoke : C.flame[((this.t >> 1) + m.slot) % C.flame.length]!
        out.set((r + 1) * w + x, lit ? LIT : ROPE, lit ? flame : C.rope, out.behind((r + 1) * w + x))
      }
      this.crew.mark(m, x - 1, r, 3, 2, w, h)
    }
  }

  private drawBalloon(out: Cells, top: number): void {
    const w = this.columns
    const bx = this.balloonX()
    const blue = this.tint === 'blue'
    const burning = this.burning
    // Hovering for the person: the pilot glows up and fades with each breath.
    const pilot = this.kWait * breath(this.t)
    for (let sr = 0; sr < SPRITE.length; sr++) {
      const row = SPRITE[sr]!
      const r = top + sr
      if (r < 0) continue
      for (let sc = 0; sc < row.length; sc++) {
        const ch = row[sc]!
        const x = bx + sc
        if (ch === ' ' || x < 0 || x >= w) continue
        let color: number
        if (sr === 3) color = ch === '█' ? C.basket : C.rope
        else if (sr === 2 && sc === 3) {
          // The burner's mouth: a flicker of flame while it climbs.
          color = this.tint === 'smoke'
            ? C.smoke
            : burning
              ? C.flame[(this.t >> 1) % C.flame.length]!
              : mix(blue ? C.blueA : C.stripeA, C.flame[0], pilot)
        } else {
          const even = sc % 2 === 0
          color = blue ? (even ? C.blueA : C.blueB) : even ? C.stripeA : C.stripeB
        }
        // Its half-blocks show whatever is behind them: sky, or a cloud it's flying through.
        out.set(r * w + x, g(ch), color, out.behind(r * w + x))
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
