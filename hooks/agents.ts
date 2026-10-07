// REVISION: flow-v120-agents
//
// Who is running: each subagent of the session, one at a time, as the scenes'
// `agents` dial sees it. The adapter feeds the roster what it hears: its polls
// of the running agents (`$.agent.list()`), each agent's own activity (a
// model step, its streamed output, a tool call: the `agentId` on `turn.step`
// and `tool.call`), a permission ask put to the person on its behalf
// (`tool.check`), and its run completing (`turn.complete`). From that, every
// frame, a dial per agent in the order they started: working, idle (gone
// quiet: nothing streamed, no tool called or running for a while), waiting on
// the person, or done (kept a few seconds after, so its companion can leave).
// Pure: no `$`, its own clock (the adapter ticks it), so it is unit-tested.

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
/** Activity from a loop no poll has named yet is kept this long (a new subagent, until the next poll names it). */
const EARLY_MS = 30_000

/** Statuses that mean it's still about (AgentStatus): not started yet, running, held, between turns. */
const PRESENT = new Set(['pending', 'running', 'waiting', 'idle'])
/** Statuses that mean it's held or between turns: not working, whatever it last did. */
const RESTING = new Set(['waiting', 'idle'])

type Entry = {
  id: string
  task: string
  type: string
  status: string
  startedAt: number
  /** When its run ended (NaN while it runs). */
  endedAt: number
  ok: boolean
  /** When it last did anything (a step, output, a tool call). */
  heardAt: number
  /** Its tools running now. */
  tools: number
  /** Its calls waiting on the person, by tool_use_id. */
  asks: Set<string>
}

export class Roster {
  /** The roster's clock (ms), moved on by `tick`. */
  private now = 0
  /** Every agent about, and those done but not yet gone, in the order they started. */
  private entries = new Map<string, Entry>()
  /** When a loop no poll has named yet was last heard from. */
  private early = new Map<string, number>()

  /** Move the clock on; agents done long enough are dropped. */
  tick(ms: number): void {
    this.now += ms
    for (const [id, e] of this.entries) if (this.now - e.endedAt > DONE_MS) this.entries.delete(id)
    for (const [id, at] of this.early) if (this.now - at > EARLY_MS) this.early.delete(id)
  }

  /** An agent did something: a model step, streamed output, a tool call. */
  heard(id: string): void {
    const e = this.entries.get(id)
    if (!e) {
      this.early.set(id, this.now)
      return
    }
    // Heard from after its run ended: a message has resumed it, a new run.
    if (!Number.isNaN(e.endedAt)) this.revive(e)
    e.heardAt = this.now
  }

  /**
   * It asked the model again (a model step): whatever it was waiting on you
   * for has been settled, allowed or refused (a refusal never reaches its
   * tool call to say so).
   */
  stepped(id: string): void {
    this.heard(id)
    this.entries.get(id)?.asks.clear()
  }

  /** One of its tools started (it counts as working while one runs, however long). */
  toolStarted(id: string): void {
    this.heard(id)
    const e = this.entries.get(id)
    if (e) e.tools++
  }

  /** One of its tools finished. */
  toolEnded(id: string): void {
    const e = this.entries.get(id)
    if (!e) return
    e.tools = Math.max(0, e.tools - 1)
    e.heardAt = this.now
  }

  /** One of its calls now waits on the person (a permission ask, a question). */
  waitingOn(id: string, callId: string): void {
    this.entries.get(id)?.asks.add(callId)
  }

  /** The call was answered (or is over). */
  answered(id: string, callId: string): void {
    const e = this.entries.get(id)
    if (!e) return
    e.asks.delete(callId)
    e.heardAt = this.now
  }

  /** Its run completed (`turn.complete` in its loop): `ok` when it answered, not on an error, an interrupt or a refusal. */
  finished(id: string, ok: boolean): void {
    const e = this.entries.get(id)
    if (!e || !Number.isNaN(e.endedAt)) return
    e.endedAt = this.now
    e.ok = ok
    e.tools = 0
    e.asks.clear()
  }

  /**
   * A poll: every agent `$.agent.list()` gave, teammates already left out.
   * One first seen ended is never shown (it came and went unseen, or ended
   * before a reload); one seen before and now ended, or no longer listed, is done.
   */
  listed(agents: readonly ListedAgent[]): void {
    const seen = new Set<string>()
    for (const a of agents) {
      seen.add(a.id)
      let e = this.entries.get(a.id)
      if (PRESENT.has(a.status)) {
        if (!e) {
          const heard = this.early.get(a.id)
          this.early.delete(a.id)
          e = {
            id: a.id,
            task: a.description,
            type: a.type,
            status: a.status,
            startedAt: this.now,
            endedAt: Number.NaN,
            ok: true,
            heardAt: heard ?? this.now,
            tools: 0,
            asks: new Set(),
          }
          this.entries.set(a.id, e)
        } else if (!Number.isNaN(e.endedAt)) {
          // Ended by its turn.complete, and still listed running: stale for a moment, then a resumed agent.
          if (this.now - e.endedAt < STALE_MS) continue
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

  /** The dial: every agent about or just done, in the order they started. */
  dials(): AgentDial[] {
    const out: AgentDial[] = []
    for (const e of this.entries.values()) {
      const done = !Number.isNaN(e.endedAt)
      const state: AgentState = done
        ? 'done'
        : e.asks.size > 0
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
