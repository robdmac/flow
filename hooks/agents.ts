// REVISION: flow-v173-directory
//
// Who is running: each subagent of the session, one at a time, as the scenes'
// `agents` dial sees it. The adapter feeds the roster what it hears: its polls
// of the running agents (`$.agent.list()`), each agent's own activity (a
// model step, its streamed output, a tool call: the `agentId` on `turn.step`
// and `tool.call`), what it waits on the person for, and its run completing
// (`turn.complete`). From that, every frame, a dial per agent in the order
// they started: working, idle (gone quiet: nothing streamed, no tool called or
// running for a while), waiting on the person, or done (kept a few seconds
// after, so its companion can leave). What's heard from a loop before a poll
// names it (a new subagent's first tool, an ask) is kept, and counts once it's
// named.
//
// Waiting on the person is a dialog actually put to them, kept for every
// loop in one tracker (waits.ts, which Activity owns and the roster asks): a
// permission only once its dialog shows (`classic.PermissionRequest`: auto
// mode's classifier settles most asks alone), Claude's question or a plan to approve
// from the start; it ends when the call ends (a refusal too: the permission
// prompt runs beneath `tool.call`) or shows it's running (its progress pill).
// Pure: no `$`, its own clock (the adapter ticks it), so it is unit-tested.

import { Waits } from './waits'

/** What a companion in a scene is doing. */
export type AgentState = 'working' | 'idle' | 'waiting' | 'done'

/** One agent, as a scene (and desktop's hover card) sees it. */
export interface AgentDial {
  /** Its id (`$.agent.list()`'s): stable for its whole run. */
  id: string
  state: AgentState
  /** Once done: whether it finished its task (false: an error, an interrupt, stopped). */
  ok: boolean
  /** Its task, in the few words the Agent call gave it. */
  task: string
  /** What it was started as (`Explore`, `general-purpose`, a plugin's agent). */
  type: string
  /** How long it has run (ms), or ran, once done. */
  ms: number
}

/** What a poll says of one agent: `$.agent.list()`'s fields the roster reads. */
export interface ListedAgent {
  id: string
  status: string
  type: string
  description: string
}

/** Quiet this long (nothing streamed, no tool called, none running): idle. A thinking model still streams. */
export const QUIET_MS = 20_000
/** A finished agent's dial stays this long (done), so its companion has time to leave. */
export const DONE_MS = 6_000
/** A poll still saying "running" this soon after its run completed is behind the news, not a resumed agent. */
const STALE_MS = 3_000
/** What's heard from a loop no poll has named yet is kept this long (a new subagent, until the next poll names it), or while a tool of its runs. */
const EARLY_MS = 30_000

/** Statuses that mean it's still about (AgentStatus): not started yet, running, held, between turns. */
const PRESENT = new Set(['pending', 'running', 'waiting', 'idle'])
/** Statuses that mean it's held or between turns: not working, whatever it last did. */
const RESTING = new Set(['waiting', 'idle'])
/** Statuses a poll can say of a run begun again: only these bring a finished agent back (a resume heard from is caught by `heard`). */
const RUNNING = new Set(['pending', 'running'])
/** No agents about: one empty dial, the same every frame. */
const NONE: readonly AgentDial[] = Object.freeze([])

/** What's been heard from a loop: when it last did anything, and its tools running now. */
type Heard = { heardAt: number; tools: number }

type Entry = Heard & {
  id: string
  task: string
  type: string
  status: string
  startedAt: number
  /** When its run ended (NaN while it runs). */
  endedAt: number
  ok: boolean
}

export class Roster {
  /** The roster's clock (ms), moved on by `tick`. */
  private now = 0
  /** Every agent about, and those done but not yet gone, in the order they started. */
  private entries = new Map<string, Entry>()
  /** What's been heard from loops no poll has named yet. */
  private early = new Map<string, Heard>()
  /** Bumped by every change here, so the dial is worked out once for each (and each frame), not for every scene that asks. */
  private changes = 0
  /** The last dial, and the clock, changes and waits it was worked out at. */
  private cached: { dials: readonly AgentDial[]; now: number; changes: number; waits: number } | undefined

  /** `waits`: what every loop waits on the person for (Activity's): the roster reads its subagents' there. */
  constructor(private readonly waits: Waits = new Waits()) {}

  /** Move the clock on; agents done long enough are dropped, and what's heard from loops never named is forgotten (their waits too). */
  tick(ms: number): void {
    this.now += ms
    for (const [id, e] of this.entries) if (this.now - e.endedAt > DONE_MS) this.entries.delete(id)
    for (const [id, h] of this.early) if (h.tools === 0 && this.now - h.heardAt > EARLY_MS) this.early.delete(id)
    this.waits.keep(agent => this.entries.has(agent) || this.early.has(agent))
  }

  /** What's kept for a loop: its entry once a poll has named it, before that what's been heard from it. */
  private heardOf(id: string): Heard {
    const e = this.entries.get(id)
    if (e) return e
    let h = this.early.get(id)
    if (!h) this.early.set(id, (h = { heardAt: this.now, tools: 0 }))
    return h
  }

  /** An agent did something: a model step, streamed output, a tool call. */
  heard(id: string): void {
    const e = this.entries.get(id)
    // Heard from after its run ended: a message has resumed it, a new run.
    if (e && !Number.isNaN(e.endedAt)) this.revive(e)
    this.heardOf(id).heardAt = this.now
    this.changes++
  }

  /** One of its tools started (it counts as working while one runs, however long). */
  toolStarted(id: string): void {
    this.heard(id)
    this.heardOf(id).tools++
  }

  /** One of its tools finished. */
  toolEnded(id: string): void {
    const h = this.entries.get(id) ?? this.early.get(id)
    if (!h) return
    h.tools = Math.max(0, h.tools - 1)
    h.heardAt = this.now
    this.changes++
  }

  /** One of its calls waits on the person (activity.ts keeps the wait): kept, though no poll has named it yet. */
  noted(id: string): void {
    if (!this.entries.has(id) && !this.early.has(id)) this.changes++
    this.heardOf(id)
  }

  /** One of its calls is answered (or over, or running): it's heard from now. */
  settled(id: string): void {
    const h = this.entries.get(id) ?? this.early.get(id)
    if (!h) return
    h.heardAt = this.now
    this.changes++
  }

  /** Its run completed (`turn.complete` in its loop): `ok` when it answered, not on an error, an interrupt or a refusal. */
  finished(id: string, ok: boolean): void {
    const e = this.entries.get(id)
    if (!e || !Number.isNaN(e.endedAt)) return
    e.endedAt = this.now
    e.ok = ok
    e.tools = 0
    this.waits.forget(id)
    this.changes++
  }

  /**
   * A poll: every agent `$.agent.list()` gave, teammates already left out.
   * One first seen ended is never shown (it came and went unseen, or ended
   * before a reload); one seen before and now ended, or no longer listed, is
   * done. One heard from before it was named starts from what was heard: its
   * tools still running, its waits.
   */
  listed(agents: readonly ListedAgent[]): void {
    this.changes++
    const seen = new Set<string>()
    for (const a of agents) {
      seen.add(a.id)
      let e = this.entries.get(a.id)
      if (PRESENT.has(a.status)) {
        if (!e) {
          const h = this.early.get(a.id)
          this.early.delete(a.id)
          e = {
            id: a.id,
            task: a.description,
            type: a.type,
            status: a.status,
            startedAt: this.now,
            endedAt: Number.NaN,
            ok: true,
            heardAt: h?.heardAt ?? this.now,
            tools: h?.tools ?? 0,
          }
          this.entries.set(a.id, e)
        } else if (!Number.isNaN(e.endedAt)) {
          // Ended by its turn.complete, and still listed running: stale for a moment, then a resumed agent.
          // Listed held or between turns, it's no new run: it stays done.
          if (!RUNNING.has(a.status) || this.now - e.endedAt < STALE_MS) continue
          this.revive(e)
        }
        e.status = a.status
        e.task = a.description || e.task
        e.type = a.type || e.type
      } else if (e && Number.isNaN(e.endedAt)) {
        e.status = a.status
        this.finished(a.id, a.status === 'completed')
      }
    }
    // No longer listed: the engine has dropped its task, so it's over.
    for (const e of this.entries.values()) if (!seen.has(e.id) && Number.isNaN(e.endedAt)) this.finished(e.id, true)
  }

  /** A run begun again under the same id: it arrives afresh, last in line. */
  private revive(e: Entry): void {
    e.endedAt = Number.NaN
    e.ok = true
    e.startedAt = e.heardAt = this.now
    e.status = 'running'
    this.entries.delete(e.id)
    this.entries.set(e.id, e)
  }

  /** How many are about (not done). */
  get active(): number {
    let n = 0
    for (const e of this.entries.values()) if (Number.isNaN(e.endedAt)) n++
    return n
  }

  /**
   * The dial: every agent about or just done, in the order they started.
   * Worked out once for each change and each tick: every scene asking in
   * between (both drivers, desktop's renders) shares it, so don't change it.
   */
  dials(): readonly AgentDial[] {
    const c = this.cached
    if (c && c.now === this.now && c.changes === this.changes && c.waits === this.waits.changes) return c.dials
    const dials = this.entries.size ? this.work() : NONE
    this.cached = { dials, now: this.now, changes: this.changes, waits: this.waits.changes }
    return dials
  }

  private work(): AgentDial[] {
    const out: AgentDial[] = []
    for (const e of this.entries.values()) {
      const done = !Number.isNaN(e.endedAt)
      const state: AgentState = done
        ? 'done'
        : this.waits.isAwaiting(e.id)
          ? 'waiting'
          : RESTING.has(e.status)
            ? 'idle'
            : e.tools > 0 || this.now - e.heardAt < QUIET_MS
              ? 'working'
              : 'idle'
      out.push({ id: e.id, state, ok: e.ok, task: e.task, type: e.type, ms: (done ? e.endedAt : this.now) - e.startedAt })
    }
    return out
  }
}

/** How long it has run, as a person reads it: `40s`, `3m 05s`, `1h 02m`. */
export function runTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** One line on an agent, for desktop's hover card: its type and task, what it's doing, how long. */
export function agentLine(d: AgentDial): string {
  const doing =
    d.state === 'working' ? 'working' : d.state === 'idle' ? 'quiet' : d.state === 'waiting' ? 'waiting on you' : d.ok ? 'done' : 'stopped'
  const what = d.task ? `${d.type ? `${d.type}: ` : ''}${d.task}` : d.type || 'subagent'
  return `${what} · ${doing}, ${runTime(d.ms)}`
}
