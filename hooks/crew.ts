// REVISION: flow-v139-probes
//
// A scene's companions: one for each running subagent (the `agents` dial,
// agents.ts), so a glance tells you which are busy, which have gone quiet or
// wait on you, and when one finishes. A companion arrives when its agent
// starts (`here` easing 0 → 1), works while its agent does (`busy` 1), rests
// while it's quiet or waiting (`busy` 0; `waiting` too when it waits on the
// person), and leaves when it's done (`here` easing back to 0), then frees
// its place for the next. Each keeps one `slot` (its lane, its colors) the
// whole time it's on screen. Only slots the layout can show are given (`room`:
// a narrow spine fits fewer than the band); agents past it wait for one to
// come free, and a layout with less room sends those it can't show back to
// wait (they come in again, easing, as room comes). A scene keeps a Crew,
// sets `room` for its layout, calls `update` once a frame and draws its
// `mates` however it likes, noting where each is (`mark`) for desktop's hover
// cards. An adapter that only counts subagents (`coverageBoost`, no list)
// still gets companions: anonymous ones, that many, working.
// Pure: no `$`.

import type { AgentDial } from './agents'

/** Where a companion is drawn this frame, in cells: what desktop's hover card for its agent sits over. */
export interface AgentMark {
  id: string
  col: number
  row: number
  w: number
  h: number
}

/** One companion on screen. */
export interface Mate {
  readonly id: string
  /** Its place among the scene's companions, 0 .. capacity - 1: its lane, its colors. Kept while it's on screen. */
  readonly slot: number
  /** How far it's here: 0 → 1 as it arrives, 1 → 0 as it leaves (smoothed). */
  here: number
  /** 1 while its agent works, 0 while it's quiet or waiting on you (eased). */
  busy: number
  /** Its agent waits on the person: a permission, a question. */
  waiting: boolean
  /** Its agent is done (or gone): it's on its way out. */
  leaving: boolean
  /** Once leaving: whether its agent finished its task (false: an error, an interrupt, stopped). */
  ok: boolean
  /** Frames since it arrived. */
  age: number
  /** Its own number in [0, 1), from its id: phases and variety, so no two move in step. */
  readonly seed: number
  /** Where the scene has it (its own units; NaN until the scene first places it). */
  x: number
  y: number
  /** How far through arriving (or leaving) it is, linearly. */
  p: number
}

/** How fast `busy` follows its agent, per frame (about a second to settle). */
const BUSY_EASE = 0.08
/** Each anonymous companion stands for this much coverage boost (15 a subagent). */
const PER_AGENT = 15
/** Anonymous companions (from a count, not a list) have ids starting with this: no hover card. */
const ANON = '~'

/** [0, 1) from a string: FNV-1a, then scattered. */
export function seedOf(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  return (h >>> 0) / 0x100000000
}

/** Smoothstep on 0..1: how `here` eases from `p`; a scene can ease its own steps of an arrival with it. */
export const smooth = (p: number) => p * p * (3 - 2 * p)

export class Crew {
  /** Every companion on screen, arriving, here or leaving, in the order they came. */
  readonly mates: Mate[] = []
  /** This frame's marks (see `mark`). */
  readonly marks: AgentMark[] = []
  /** How many slots the scene's layout can show now (at most `capacity`): only these are given. */
  room: number

  /**
   * @param capacity the most companions the scene has room for
   * @param arrive frames to arrive (about 1.7 s at 14 fps)
   * @param leave frames to leave
   */
  constructor(
    readonly capacity: number,
    readonly arrive = 24,
    readonly leave = 36,
  ) {
    this.room = capacity
  }

  /** Once a frame: who's about now. `coverageBoost` stands in when an adapter gives no list. */
  update(agents: readonly AgentDial[] | undefined, coverageBoost = 0): void {
    const list = agents && agents.length ? agents : anonymous(coverageBoost)
    const byId = new Map<string, AgentDial>()
    for (const a of list) byId.set(a.id, a)
    for (const m of this.mates) {
      const a = byId.get(m.id)
      const gone = !a || a.state === 'done'
      if (gone && !m.leaving) m.ok = a ? a.ok : true
      m.leaving = gone
      m.waiting = !gone && a!.state === 'waiting'
      const goal = !gone && a!.state === 'working' ? 1 : 0
      m.busy += (goal - m.busy) * BUSY_EASE
      if (Math.abs(goal - m.busy) < 0.01) m.busy = goal
      m.p = Math.max(0, Math.min(1, m.p + (m.leaving ? -1 / this.leave : 1 / this.arrive)))
      m.here = smooth(m.p)
      m.age++
    }
    // Gone: its place is free for the next. One in a place this layout can't show (it has less room than
    // the last) goes back to waiting for one it can.
    const room = Math.max(0, Math.min(this.capacity, Math.floor(this.room)))
    for (let i = this.mates.length - 1; i >= 0; i--) {
      const m = this.mates[i]!
      if ((m.leaving && m.p <= 0) || m.slot >= room) this.mates.splice(i, 1)
    }
    // Newcomers, in the order they started, each in the lowest free place.
    for (const a of list) {
      if (a.state === 'done' || this.mates.some(m => m.id === a.id)) continue
      const slot = this.freeSlot(room)
      if (slot < 0) break
      this.mates.push({
        id: a.id,
        slot,
        here: 0,
        busy: a.state === 'working' ? 1 : 0,
        waiting: a.state === 'waiting',
        leaving: false,
        ok: true,
        age: 0,
        seed: seedOf(a.id),
        x: Number.NaN,
        y: Number.NaN,
        p: 0,
      })
    }
  }

  private freeSlot(room: number): number {
    for (let s = 0; s < room; s++) if (!this.mates.some(m => m.slot === s)) return s
    return -1
  }

  /** Start a frame's marks afresh (call before drawing the mates). */
  clearMarks(): void {
    this.marks.length = 0
  }

  /**
   * Note where a companion is drawn this frame (cells, on a grid of
   * `columns` × `rows`), for its agent's hover card on desktop. One mostly
   * off screen, or barely there, isn't marked.
   */
  mark(m: Mate, col: number, row: number, w: number, h: number, columns: number, rows: number): void {
    if (m.here < 0.5 || m.id.startsWith(ANON)) return
    const c0 = Math.max(0, Math.floor(col))
    const r0 = Math.max(0, Math.floor(row))
    const c1 = Math.min(columns, Math.ceil(col + w))
    const r1 = Math.min(rows, Math.ceil(row + h))
    if (c1 - c0 < 1 || r1 - r0 < 1) return
    this.marks.push({ id: m.id, col: c0, row: r0, w: c1 - c0, h: r1 - r0 })
  }
}

/** A count's worth of companions, all working: what a coverage boost alone stands for. */
function anonymous(coverageBoost: number): AgentDial[] {
  const n = Math.max(0, Math.round(coverageBoost / PER_AGENT))
  return Array.from({ length: n }, (_, k) => ({ id: `${ANON}${k}`, state: 'working', ok: true, task: '', type: '', ms: 0 }))
}
