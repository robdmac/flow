// REVISION: flow-v173-directory
//
// The calls waiting on the person, in every loop: the main one's and each
// subagent's, one tracker for both (Activity owns it; the Roster asks it which
// subagents wait). A permission waits once its dialog shows (`prompted`, from
// `classic.PermissionRequest`: auto mode's classifier settles most asks alone,
// and that's no wait), matched to the loop's running call of that tool (each
// call noted as it starts, `called`); Claude's question or a plan to approve
// waits from the start. A wait ends when its call ends (`tool.call`'s finally:
// the permission prompt runs beneath it, so a refusal ends there too) or shows
// it's running (its progress pill, which carries only the call's id: the call
// noted says which tool and loop). A dialog waits under its tool's name and
// loop until a call of that tool in that loop ends. Pure: no `$`, unit-tested directly.

/** A call waiting on the person: its tool and loop (none: the main loop), and whether it has been put to them yet. */
type Wait = { tool?: string; agent?: string; asked: boolean }

/** A dialog seen with no ask before it waits under its tool's name and loop: `prompt:Bash@<agent>` (`prompt:Bash@` in the main loop). */
const promptKey = (tool: string, agent: string | undefined) => `prompt:${tool}@${agent ?? ''}`

export class Waits {
  /** By tool_use_id (or prompt key), oldest first. */
  private waits = new Map<string, Wait>()
  /** The calls running, by tool_use_id: their tool and loop, for a progress pill that names only the id. */
  private calls = new Map<string, { tool: string; agent?: string }>()
  /** Bumped by every change, so what's worked out from the waits can be kept until they change. */
  changes = 0

  /** A call of `tool` in loop `agent` (none: the main loop) starts: not a wait, only noted. */
  called(id: string, tool: string, agent?: string): void {
    this.calls.set(id, { tool, agent })
  }

  /**
   * A call (in loop `agent`; none, the main loop) now waits. `asked`: it's put
   * to the person now (Claude's question, a plan to approve); a permission ask
   * isn't yet, only once its dialog shows (`prompted`).
   */
  waitingOn(id: string, asked = true, tool?: string, agent?: string): void {
    const w = this.waits.get(id)
    this.waits.set(id, { tool: tool ?? w?.tool, agent: agent ?? w?.agent, asked: asked || w?.asked === true })
    this.changes++
  }

  /**
   * A permission dialog shows for a call of `tool` in loop `agent`: that
   * loop's oldest ask of the tool not yet put to the person now is. One with
   * no ask before it waits under the tool's name and loop till a call of it there ends.
   */
  prompted(tool: string, agent?: string): void {
    this.changes++
    for (const w of this.waits.values()) {
      if (!w.asked && w.tool === tool && w.agent === agent) {
        w.asked = true
        return
      }
    }
    this.waits.set(promptKey(tool, agent), { tool, agent, asked: true })
  }

  /**
   * The call is answered (or over, or running): answers its loop as far as
   * it's known (`agent`, or the one its wait was in), undefined for the main loop.
   */
  answered(id: string, tool?: string, agent?: string): string | undefined {
    const call = this.calls.get(id)
    this.calls.delete(id)
    tool ??= call?.tool
    const loop = agent ?? this.waits.get(id)?.agent ?? call?.agent
    if (this.waits.delete(id)) this.changes++
    if (tool !== undefined && this.waits.delete(promptKey(tool, loop))) this.changes++
    return loop
  }

  /** Nothing in this loop (none: the main loop) waits any more: its turn, or its run, is over. */
  forget(agent?: string): void {
    for (const [id, c] of this.calls) if (c.agent === agent) this.calls.delete(id)
    for (const [id, w] of this.waits) {
      if (w.agent === agent) {
        this.waits.delete(id)
        this.changes++
      }
    }
  }

  /** Nothing waits in any loop (the session is over). */
  clear(): void {
    if (this.waits.size) this.changes++
    this.waits.clear()
    this.calls.clear()
  }

  /** Forget the subagents' waits whose loop is no longer about (`about`: whether it is). */
  keep(about: (agent: string) => boolean): void {
    for (const [id, w] of this.waits) {
      if (w.agent !== undefined && !about(w.agent)) {
        this.waits.delete(id)
        this.changes++
      }
    }
  }

  /** Whether a call of this loop (none: the main loop) is put to the person now (a dialog is up for them). */
  isAwaiting(agent?: string): boolean {
    for (const w of this.waits.values()) if (w.asked && w.agent === agent) return true
    return false
  }

  /** Whether any loop's call is put to the person now. */
  get anyAsked(): boolean {
    for (const w of this.waits.values()) if (w.asked) return true
    return false
  }

  /**
   * Whether the main turn is held up: one of its own calls waits (on the
   * person, or the mode deciding whether to ask them), or a dialog of any loop
   * is up for the person. A subagent's ask the mode is still deciding doesn't.
   */
  get holdsTurn(): boolean {
    for (const w of this.waits.values()) if (w.asked || w.agent === undefined) return true
    return false
  }
}
