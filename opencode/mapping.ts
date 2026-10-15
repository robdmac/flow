// REVISION: flow-v3-opencode-deleted
//
// opencode's events in the heat model's terms, for the session on screen and
// the subagents it runs (child sessions, each with its `parentID`). Pure (no
// opencode or Node imports), so the shared tests cover it.
//
//   session.execution.started / ended    a turn of the session on screen, or a subagent's run
//   session.step.started                 a model step; the model's variant (its effort: low … max) sets the floor
//   session.text.delta, reasoning.delta  streamed text and thinking keep it going
//   session.tool.input.started / called  a tool call: its name, then its input (edits push it, commands spark)
//   session.tool.success / failed        it's over; a shell that failed (its exit code) shows as smoke
//   session.created (with a parentID)    a subagent: a companion of its own (its session deleted: it's gone)
//   permission.asked, form.created       a question put to the person: the scene settles and breathes
//   session.compaction.ended             smoke, as a compaction is in Claude Code
//   session.usage.updated                how full the context is (the step's tokens over the model's limit): blue

import { type Activity, countLines, type Effort } from '../hooks/activity'
import type { ListedAgent } from '../hooks/agents'

/** One of opencode's events, as far as Flow reads it: its type and its data. */
export type OpenCodeEvent = { type: string; data?: unknown }

/** Tools that run commands, read, and launch subagents, by opencode's names (an MCP server's or a plugin's are other work). */
export const COMMAND_TOOLS = new Set(['shell', 'bash'])
export const READ_TOOLS = new Set(['read', 'grep', 'glob', 'list', 'ls', 'find', 'webfetch', 'websearch'])
export const AGENT_TOOLS = new Set(['subagent', 'task'])

/** A model variant as the heat model's effort: opencode's names for how hard it thinks (a provider's own, or `default`, set no floor of their own). */
export function effortOf(variant: string | undefined): Effort {
  switch (variant) {
    case 'minimal':
    case 'low':
      return 'low'
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return variant
    default:
      return undefined
  }
}

/** Lines an opencode write or edit call writes: `content`, `newString`, or a patch's added lines. */
export function linesWritten(tool: string, input: unknown): number | undefined {
  const i = (input ?? {}) as Record<string, unknown>
  switch (tool) {
    case 'write':
      return countLines(i.content)
    case 'edit':
      return countLines(i.newString)
    case 'multiedit':
      return Array.isArray(i.edits) ? i.edits.reduce((n: number, ed) => n + countLines((ed as Record<string, unknown>)?.newString), 0) : 0
    case 'patch':
    case 'apply_patch': {
      const text = typeof i.patch === 'string' ? i.patch : typeof i.patchText === 'string' ? i.patchText : ''
      let n = 0
      for (const line of text.split('\n')) if (line.startsWith('+') && !line.startsWith('+++')) n++
      return n
    }
    default:
      return undefined
  }
}

/** A tool that ended, as `session.tool.success` or `.failed` has it: whether it failed (a command, by its exit code). */
function commandFailed(type: string, data: Record<string, unknown>): boolean {
  if (type === 'session.tool.failed') return true
  const exit = (data.metadata as Record<string, unknown> | undefined)?.exit
  return typeof exit === 'number' && exit !== 0
}

/** A session's tokens so far: what its steps were sent (fresh and cached) and what they wrote. */
type Tokens = { input?: number; output?: number; cache?: { read?: number; write?: number } }
const contextTokens = (t: Tokens) => (t.input ?? 0) + (t.output ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0)

const ENDED = new Set(['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'])

export class OpenCodeWork {
  /** The session on screen (its id), whose work the scene follows. */
  private root: string | undefined
  /** Each subagent's session and the session that started it. */
  private parents = new Map<string, string>()
  /** The subagents of the session on screen, in the order they started, as the roster lists them. */
  private children = new Map<string, ListedAgent>()
  /** Each tool call's name, by its id (its name comes before its input). */
  private calls = new Map<string, string>()
  /** The tool calls of the session on screen running now. */
  private running = new Set<string>()
  /** Each session's tokens so far, as its last usage said: a step's are the difference. */
  private used = new Map<string, number>()
  /** Each session's model variant as its events said (created with, or selected since). */
  private variants = new Map<string, string | undefined>()

  constructor(
    readonly activity: Activity,
    /** The context limit of a session's model, if known. */
    private readonly contextLimit: (sessionID: string) => number | undefined = () => undefined,
    /** A session's model variant as opencode has it, for one whose events haven't said (begun before Flow came up). */
    private readonly variantOf: (sessionID: string) => string | undefined = () => undefined,
  ) {}

  /** The variant a session's steps run at: as its events said, else as opencode has it. */
  private variant(sessionID: string): string | undefined {
    return this.variants.has(sessionID) ? this.variants.get(sessionID) : this.variantOf(sessionID)
  }

  /** The session on screen, if any. */
  get session(): string | undefined {
    return this.root
  }

  /**
   * Another session on screen (or none): the scene follows its work from now on (`running`: a turn of
   * it is under way). What was going on in the last one (its turn, its tools, its subagents, what it
   * waited on you for) is no longer this scene's.
   */
  show(sessionID: string | undefined, running = false): void {
    if (sessionID === this.root) return
    this.root = sessionID
    this.children.clear()
    this.running.clear()
    this.calls.clear()
    const a = this.activity
    a.turnEnded()
    a.forgetWaits()
    a.toolsInFlight = 0
    a.runningAgents = 0
    a.contextPercent = 0
    a.roster.listed([])
    if (running) a.turnStarted()
  }

  /** Whose a session is: the main loop's, a subagent's (its id: a subagent's own subagents count as its work), or none of this scene's. */
  private loopOf(sessionID: unknown): { main: boolean; agent?: string } | undefined {
    if (typeof sessionID !== 'string' || this.root === undefined) return undefined
    if (sessionID === this.root) return { main: true }
    let id = sessionID
    for (let hops = 0; hops < 8; hops++) {
      const parent = this.parents.get(id)
      if (parent === undefined) return undefined
      if (parent === this.root) return { main: false, agent: id }
      id = parent
    }
    return undefined
  }

  /** The roster told of the subagents as they are now, and how many are running. */
  private list(): void {
    const all = [...this.children.values()]
    this.activity.roster.listed(all)
    this.activity.runningAgents = all.filter(c => c.status === 'running').length
  }

  /** One of opencode's events. */
  event(e: OpenCodeEvent): void {
    const data = (e.data ?? {}) as Record<string, unknown>
    const a = this.activity
    switch (e.type) {
      case 'session.created':
      case 'session.model.selected': {
        const id = data.sessionID
        if (typeof id === 'string') this.variants.set(id, (data.model as { variant?: string } | undefined)?.variant)
        if (e.type === 'session.model.selected') return
        const parent = data.parentID
        if (typeof id !== 'string' || typeof parent !== 'string') return
        this.parents.set(id, parent)
        // A subagent of the session on screen (one of its subagents' own is their work, not a companion).
        if (parent !== this.root) return
        this.children.set(id, {
          id,
          status: 'running',
          type: typeof data.agent === 'string' ? data.agent : '',
          description: typeof data.title === 'string' ? data.title : '',
        })
        this.list()
        return
      }
      case 'session.deleted': {
        // A subagent's session deleted before its run ended (else it would stay working, quiet, for good).
        const child = typeof data.sessionID === 'string' ? this.children.get(data.sessionID) : undefined
        if (child?.status !== 'running') return
        child.status = 'failed'
        this.activity.roster.finished(child.id, false)
        this.list()
        return
      }
      case 'session.renamed': {
        const child = typeof data.sessionID === 'string' ? this.children.get(data.sessionID) : undefined
        if (child && typeof data.title === 'string') {
          child.description = data.title
          this.list()
        }
        return
      }
      case 'form.created': {
        const form = data.form as { id?: unknown; sessionID?: unknown } | undefined
        const loop = this.loopOf(form?.sessionID)
        if (loop && typeof form?.id === 'string') a.waitingOn(form.id, true, undefined, loop.agent)
        return
      }
    }
    const loop = this.loopOf(data.sessionID)
    if (!loop) return
    const { main, agent } = loop
    const sub = !main
    // Whatever a subagent does, it's heard from: working.
    if (agent !== undefined && !ENDED.has(e.type)) a.roster.heard(agent)
    switch (e.type) {
      case 'session.execution.started': {
        if (main) a.turnStarted()
        else {
          const child = this.children.get(agent!)
          if (child && child.status !== 'running') {
            child.status = 'running'
            this.list()
          }
        }
        return
      }
      case 'session.execution.succeeded':
      case 'session.execution.failed':
      case 'session.execution.interrupted': {
        const ok = e.type === 'session.execution.succeeded'
        if (main) {
          a.turnEnded()
          this.running.clear()
          a.toolsInFlight = 0
          if (e.type === 'session.execution.failed') a.failed()
          return
        }
        const child = this.children.get(agent!)
        if (!child || child.status !== 'running') return
        child.status = ok ? 'completed' : 'failed'
        a.roster.finished(agent!, ok)
        this.list()
        return
      }
      case 'session.step.started':
        a.modelStep(main ? effortOf(this.variant(data.sessionID as string)) : undefined, sub)
        return
      case 'session.text.delta':
      case 'session.reasoning.delta': {
        const delta = data.delta
        if (typeof delta === 'string' && delta) a.streamed(delta.length, e.type === 'session.text.delta' ? 'text' : 'thinking', sub)
        return
      }
      case 'session.tool.input.started':
        if (typeof data.id === 'string' && typeof data.name === 'string') this.calls.set(data.id, data.name)
        return
      case 'session.tool.called': {
        const id = data.id
        if (typeof id !== 'string') return
        const name = this.calls.get(id) ?? ''
        const lines = linesWritten(name, data.input)
        if (lines !== undefined) a.edited(lines, sub)
        else if (COMMAND_TOOLS.has(name)) a.ranCommand(sub)
        else if (READ_TOOLS.has(name)) a.read(sub)
        else if (AGENT_TOOLS.has(name)) {
          if (main) a.spawnedAgent()
        } else a.usedTool(sub)
        a.called(id, name, agent, typeof data.input === 'object' && data.input !== null ? data.input : undefined)
        if (main) {
          this.running.add(id)
          a.toolsInFlight = this.running.size
        } else a.roster.toolStarted(agent!)
        return
      }
      case 'session.tool.success':
      case 'session.tool.failed': {
        const id = data.id
        if (typeof id !== 'string') return
        const name = this.calls.get(id) ?? ''
        this.calls.delete(id)
        a.answered(id, name, agent)
        if (main) {
          this.running.delete(id)
          a.toolsInFlight = this.running.size
          if (COMMAND_TOOLS.has(name) && commandFailed(e.type, data)) a.failed()
        } else a.roster.toolEnded(agent!)
        return
      }
      case 'permission.asked':
        if (typeof data.id === 'string') a.waitingOn(data.id, true, undefined, agent)
        return
      case 'permission.replied':
        if (typeof data.requestID === 'string') a.answered(data.requestID, undefined, agent)
        return
      case 'form.replied':
      case 'form.cancelled':
        if (typeof data.id === 'string') a.answered(data.id, undefined, agent)
        return
      case 'session.compaction.ended':
        if (main) a.compacted()
        return
      case 'session.usage.updated': {
        if (!main) return
        const sid = data.sessionID as string
        const total = contextTokens((data.tokens ?? {}) as Tokens)
        const before = this.used.get(sid)
        this.used.set(sid, total)
        // The first heard since Flow came up is the session's total so far, not a step's: the next one says.
        if (before === undefined || total <= before) return
        const limit = this.contextLimit(sid)
        if (limit && limit > 0) a.contextPercent = Math.min(100, (100 * (total - before)) / limit)
        return
      }
    }
  }
}
