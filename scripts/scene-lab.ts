// REVISION: flow-v171-dry-adapter
//
// Shared by preview, check and cvd-check: build a scene at a size and a
// setting, warm it up (with subagents' companions in every state, if asked;
// over each of avalon's backdrops, if asked), and count what Claude Code's
// Raster cares about. Not part of the mod.

import { WAIT_LEVEL } from '../hooks/activity'
import type { AgentDial, AgentState } from '../hooks/agents'
import { Colony, type Passage } from '../hooks/colony'
import { hasNight, makeScene, SCENES, STYLES, type SceneName, type Tint } from '../hooks/styles'
import type { Cells } from '../hooks/cells'

export const TINTS: Tint[] = ['normal', 'smoke', 'blue']
/** Every look a scene shows over its level: each tint, and waiting on the person. */
export const LOOKS: { name: string; tint: Tint; waiting?: boolean }[] = [...TINTS.map(tint => ({ name: tint, tint })), { name: 'waiting', tint: 'normal', waiting: true }]
export const BAND = { name: 'band', columns: 120, rows: 5 }
export const SPINE = { name: 'spine', columns: 22, rows: 40 }

/**
 * What a scene shows behind it that no setting chooses, and its time alone
 * brings: avalon's voyage, open stars mostly, now and then a sun drifting by
 * or a nebula filling the frame (`Colony.voyageTo`). `draw` picks which.
 */
export type Backdrop = { name: string; passage: Passage; draw: number }

/**
 * `waiting`: built at the level, then held for the person as auto mode does (the level down to 2, the look eased in).
 * `agents`: subagents running, each in its own state (see `crew`).
 * `backdrop`: the voyage at that passage, halfway through (none: as it starts, open stars).
 */
export type Setting = { level: number; night: boolean; tint: Tint; waiting?: boolean; agents?: boolean; backdrop?: Backdrop }

/** Frames a waiting scene is stepped once the wait begins: the look in, and settled (the train drawn up and standing). */
const WAIT_FRAMES = 200

const agent = (id: string, state: AgentState, task: string): AgentDial => ({ id, state, ok: true, task, type: 'Explore', ms: 42_000 })

/**
 * Subagents in every state a companion shows: two working, one gone quiet,
 * one waiting on you; `leaving`, the second working one is done (its
 * companion on its way out).
 */
export function crew(leaving = false): AgentDial[] {
  return [
    agent('a1', 'working', 'find the config loader'),
    agent('a2', leaving ? 'done' : 'working', 'run the test suite'),
    agent('a3', 'idle', 'read the docs'),
    agent('a4', 'waiting', 'edit the README'),
  ]
}

/** The value after `--name` on the command line, if it's there. */
export function option(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

/**
 * Each kind of sun and of nebula the voyage passes (the draw picks the kind):
 * the first draws that show every one, found by trying them. (The kind is the
 * Colony's own; where it can't be read, the first three draws of each.)
 */
const VOYAGES: Backdrop[] = (() => {
  const probe = new Colony(1)
  const out: Backdrop[] = []
  for (const passage of ['sun', 'nebula'] as const) {
    const kinds = new Set<unknown>()
    for (let draw = 0; draw < 64 && kinds.size < 3; draw++) {
      probe.voyageTo(passage, 0.5, draw)
      const kind = (probe as unknown as { pick?: unknown }).pick ?? draw
      if (kinds.has(kind)) continue
      kinds.add(kind)
      out.push({ name: `${passage} ${kinds.size}`, passage, draw })
    }
  }
  return out
})()

/** A scene's backdrops to measure over: none but its own for most; avalon's open stars, then each sun and nebula. */
export function backdropsOf(scene: SceneName): (Backdrop | undefined)[] {
  return scene === 'avalon' ? [undefined, ...VOYAGES] : [undefined]
}

/** The scenes named on the command line (all of them when none are), or exit with the names it knows. */
export function scenesFrom(argv: string[]): SceneName[] {
  const names = argv.filter(a => !a.startsWith('--'))
  for (const n of names) {
    if (!(STYLES as readonly string[]).includes(n)) {
      console.error(`no scene called "${n}"; there are: ${STYLES.join(', ')}`)
      process.exit(1)
    }
  }
  return names.length ? (names as SceneName[]) : [...STYLES]
}

export function nightsOf(scene: SceneName): boolean[] {
  return hasNight(scene) ? [false, true] : [false]
}

/**
 * A scene at a size and setting, stepped `warm` frames so it has settled
 * (and a wait's frames after, if waiting). With `agents`, its companions
 * arrive at the start, and in the last dozen frames of all one of them is
 * leaving; the coverage boost is the adapter's, 15 for each still running.
 */
export function build(scene: SceneName, columns: number, rows: number, s: Setting, warm = 90) {
  const f = makeScene(scene, 7)
  f.strength = s.level
  f.tint = s.tint
  f.night = s.night
  f.ensure(columns, rows)
  if (s.backdrop && f instanceof Colony) f.voyageTo(s.backdrop.passage, 0.5, s.backdrop.draw)
  const total = warm + (s.waiting ? WAIT_FRAMES : 0)
  let frame = 0
  const step = () => {
    if (s.agents) {
      const agents = crew(frame >= total - 12)
      f.agents = agents
      f.coverageBoost = 15 * agents.filter(a => a.state !== 'done').length
    }
    f.step()
    frame++
  }
  for (let i = 0; i < warm; i++) step()
  if (s.waiting) {
    f.waiting = true
    f.strength = Math.min(s.level, WAIT_LEVEL)
    for (let i = 0; i < WAIT_FRAMES; i++) step()
  }
  return f
}

/** Distinct (fg, bg) pairs in a frame: Raster paints 1024 and nearest-maps the rest. */
export function pairs(grid: Cells): number {
  const w = grid.words
  const set = new Set<number>()
  for (let i = 0; i < w.length; i += 3) set.add(w[i + 1]! * 0x2000000 + w[i + 2]!)
  return set.size
}

export const blurbOf = (scene: SceneName) => SCENES.find(d => d.name === scene)!.blurb
