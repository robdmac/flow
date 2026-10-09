// REVISION: flow-v171-dry-adapter

import type { EngineInterface, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { AsciiFire, colorFor, params } from '../hooks/fire'
import { effortFloor, Activity, linesWritten, WAIT_LEVEL } from '../hooks/activity'
import { firstTips, nextTip, readTips, changedText, changesFor, helpText, isNightAt, ownHint, parseFlowArgs, readConfig, resetText, savedText, staleRows, statusText } from '../hooks/settings'
import { CLAUDE_CODE, type FlowAdapter, replyTo } from '../hooks/settings'
import { differences, type Own, ownAfterSwitch, pinShown, readOwn, readRecord, SESSION_KEPT_MS, SESSIONS_KEPT, sessionKey, staleSessions, storedOwn, storedRecord, withOwn } from '../hooks/sessions'
import { gridToAnsi } from '../pi/ansi'
import { effortOf, ownInSession, piLinesWritten } from '../pi/mapping'
import { PiSettings, type SessionEntries } from '../pi/session'
import type { PiSessionEntry } from '../pi/types'
import { Balloon, skyColor } from '../hooks/balloon'
import { Falcon } from '../hooks/rocket'
import { Colony } from '../hooks/colony'
import { Train } from '../hooks/train'
import { makeScene, nextStyle, SCENES, STYLES, styleNamed, type SceneName } from '../hooks/styles'
import { finishSave, openSession, planSave, runScene, type SceneCtx } from '../hooks/register'
import { coverage, frameSvg, gridPixels, SVG_LIMIT } from '../hooks/svg'
import { Cells, isTall } from '../hooks/cells'
import { SceneDriver } from '../hooks/scene'
import { BED_EVERY_MS, BED_FADE_MS, BED_MIN_MS, BED_MS, BURST_MAX, CHIME_DELAY_MS, CHIME_QUIET_MS, MAX_PLAYS, MOODS, PLAYER_DRAIN_MS, PLAYER_LEAD_MS, type BedTake, bedGap, bedPlay, bedStep, burst, chimePlay, chimeStep, EVENTS, eventPlay, gather, LAYERS, newChimeState } from '../hooks/sound'
import { DEFAULT_VOLUME, MAX_GAIN, master, VOLUME_DB, volumeGain } from '../hooks/sound'
import { BREATH_FRAMES, breath, easeWait, waitTone } from '../hooks/waiting'
import { SOUND_FILES } from '../hooks/sound-files'
import { PixelScene, type Dials, type Painter } from '../hooks/pixel-scene'
import { hotkeyFor, labelWidth, PICK_LEVEL, pickLayout, pickRows, sceneOfKey, Thumbnails } from '../hooks/picker'
import { agentLine, DONE_MS, QUIET_MS, Roster, runTime } from '../hooks/agents'
import { Crew, type AgentMark } from '../hooks/crew'
import { beckon, easeTo, failed, finished, resting, type Mate } from '../hooks/crew'
import { easeNight } from '../hooks/night'
import { rampAt, rampStops, retain } from '../hooks/pixels'
import { freshSeed } from '../hooks/cells'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 60,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

const DEFAULT = 0x01000000

function decode(cells: string): Uint32Array {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Uint32Array(bytes.buffer)
}

type Captured = {
  blits: string[]
  /** Each blit as `<site>/<key>` (the picker's thumbnails are a Raster each). */
  blitKeys?: string[]
  config: [string, unknown][]
  invalidates?: number
  plays?: string[]
  /** Each clip played: its file (none for one synthesized here) and its gain. */
  played?: { asset?: string; gain?: number }[]
  toasts?: string[]
  /** What `$.ui.log` was given, and where to. */
  logs?: { text: string; to?: string }[]
  /** Set: every blit is refused with it (the band is no longer mounted there). */
  blitDeny?: string
  /** The session's id, as `$.session.id()` answers it (change it to move the process to another session). */
  session?: string
  /**
   * /config's flow rows as stored (`flow-scenes.style`: 'surf'), shared by every
   * session: given, `$.config.list()` answers from them and a save writes
   * them; left out, it doesn't answer and the plugin goes by its options.
   */
  rows?: Record<string, unknown>
}

/** /config's flow rows as `$.config.list()` lists them: every one, the manifest's default where none is stored. */
function configRows(rows: Readonly<Record<string, unknown>>) {
  const all: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(storedOwn(readConfig(undefined)))) all[`flow-scenes.${k}`] = v
  return Object.entries({ ...all, ...rows }).map(([key, value]) => ({ key, value }))
}

/** Stand for the engine beneath the plugin: its band, session start, calls. */
function engine(
  on: On,
  captured: Captured = { blits: [], config: [] },
  /** Clips the player refuses as full (as Claude Code does past four at once). */
  refuse?: (asset: string) => boolean,
) {
  on('session.id', () => ({ value: (captured.session ??= 'session-a') }))
  // The prompt box: an edit lands as made.
  on('prompt.edit', (_, e) => ({ text: e.text, cursor: e.cursor }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('audio.play', (_, e) => {
    const clip = e.clip as { base64?: string; asset?: string }
    ;(captured.plays ??= []).push(`${e.shouldLoop ? 'loop' : 'once'}:${(clip.base64 ?? '').length}:${clip.asset ?? (clip.base64 ?? '').slice(-24)}`)
    ;(captured.played ??= []).push({ asset: clip.asset, gain: e.gain })
    if (clip.asset && refuse?.(clip.asset)) return { deny: 'refused: 4 plays are going at once' }
    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'engine band' })
  })
  on('session.start', () => ({ cwd: '/tmp' }))
  on('ui.log', (_, e) => {
    ;(captured.logs ??= []).push({ text: e.text, to: e.to })
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    ;(captured.toasts ??= []).push((e as { text: string }).text)
    return { value: undefined }
  })
  on('ui.invalidate', () => {
    captured.invalidates = (captured.invalidates ?? 0) + 1
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'flow' } }))
  on('ui.blit', (_, e) => {
    captured.blits.push(e.requestId)
    ;(captured.blitKeys ??= []).push(`${e.requestId}/${e.key}`)
    return { value: captured.blitDeny ? { deny: captured.blitDeny } : {} }
  })
  on('config.set', (_, e) => {
    captured.config.push([e.key, e.value])
    if (captured.rows) captured.rows[e.key] = e.value
    return { value: e.value }
  })
  const rows = captured.rows
  if (rows) on('config.list', () => ({ value: configRows(rows) as never }))
  return captured
}

/**
 * `$.store` over a Map the test can look into, values kept as JSON keeps them
 * (as mock.store does): the store every session of the plugin shares.
 */
function memoryStore(on: On, entries: Readonly<Record<string, unknown>> = {}): Map<string, unknown> {
  const store = new Map<string, unknown>(Object.entries(entries).map(([k, v]) => [k, structuredClone(v)]))
  on('store.get', (_, e) => ({ value: structuredClone(store.get(e.key)) }))
  on('store.set', (_, e) => (store.set(e.key, JSON.parse(JSON.stringify(e.value))), { value: undefined }))
  on('store.delete', (_, e) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  return store
}

type TestDollar = { session: { start: (a: { cwd: string; surface: 'terminal'; isInteractive: boolean }) => Promise<unknown> } }

/** A session starting with someone at it: they press a key in the prompt (so its soundscape may play). */
async function start($: TestDollar) {
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await keyed($)
}

/** A key in the prompt box: someone's at the session. */
async function keyed($: unknown) {
  const edit = { origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'h' }
  await ($ as { prompt: { edit: (e: object) => Promise<unknown> } }).prompt.edit(edit)
}

type RunInput = {
  command: string
  args: string
  origin: { kind: 'composer' }
  presentation: { isFullscreen: boolean; columns: number }
}

/** Run `/flow <args>` through the plugin as typed at the prompt, answering its text. */
async function flow($: { command: { run: (e: RunInput) => Promise<{ text?: string }> } }, args = '', command = 'flow') {
  const e: RunInput = { command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }
  return (await $.command.run(e)).text ?? ''
}

// ── The automaton ────────────────────────────────────────────────────────

test('the strength dial: off, pilots, roaring', async () => {
  expect(params(0)).toEqual([0, 0])
  expect(params(1)).toEqual([2, 10])
  expect(params(8)).toEqual([24, 100])
  expect(params(10)).toEqual([35, 100])
})

test('a lit fire packs flames into Raster cells; off draws nothing', async () => {
  // The simulation's heat: a hot base when lit, none at all when off.
  const sim = new AsciiFire(42)
  sim.ensure(40, 4)
  for (let i = 0; i < 20; i++) sim.step()
  expect(Math.max(...sim.cells.subarray(3 * 40))).toBeGreaterThan(sim.peak * 0.5)
  sim.strength = 0
  sim.step()
  expect(Math.max(...sim.cells)).toBe(0)

  // The fire scene draws it: ▓ or █ at the hot base, blank when off.
  const f = makeScene('fire', 42)
  f.ensure(40, 4)
  for (let i = 0; i < 20; i++) f.step()
  const words = decode(f.frame())
  expect(words.length).toBe(40 * 4 * 3)
  const glyphs = new Set<number>()
  for (let i = 0; i < words.length; i += 3) glyphs.add(words[i]!)
  expect(glyphs.has(0x2588) || glyphs.has(0x2593)).toBe(true) // hot base
  f.strength = 0
  for (let i = 0; i < 40; i++) f.step()
  const off = decode(f.frame())
  for (let i = 0; i < off.length; i += 3) expect(off[i]).toBe(0x20)
})

test('burners wander: lit columns change over time, density holds', async () => {
  const f = new AsciiFire(11)
  f.strength = 3 // 42% coverage
  f.ensure(200, 2)
  const litAt = () => {
    const row = f.cells.subarray(200)
    return new Set(Array.from(row.keys()).filter(x => row[x]! > 0))
  }
  for (let i = 0; i < 60; i++) f.step()
  const early = litAt()
  for (let i = 0; i < 300; i++) f.step() // ~21 s
  const late = litAt()
  expect([...early].filter(x => late.has(x)).length).toBeLessThan(early.size)
  expect(late.size).toBeGreaterThan(40)
  expect(late.size).toBeLessThan(130)
})

test('the headroom row stays mostly blank, licked by only the tallest flames', async () => {
  const topLit = (strength: number) => {
    const f = new AsciiFire(5)
    f.strength = strength
    f.ensure(100, 5)
    let lit = 0
    for (let i = 0; i < 200; i++) {
      f.step()
      if (i >= 50) lit += Array.from(f.cells.subarray(0, 100)).filter(v => v > 0).length
    }
    return lit / (150 * 100)
  }
  expect(topLit(4)).toBeLessThan(0.002) // low fires all but never reach it: it separates
  expect(topLit(10)).toBeGreaterThan(0) // the tallest tongues taper into it
  expect(topLit(10)).toBeLessThan(0.35) // but it stays mostly blank
})

test('smoke grays only the tips: the core keeps its color', async () => {
  const tip = colorFor(8, 0.2, 'smoke')
  expect(tip >> 16).toBe(tip & 0xff) // r == b: gray
  expect(colorFor(8, 0.9, 'smoke')).toBe(colorFor(8, 0.9)) // core untouched
})

test('every style draws a full frame, lit when on and blank when off', async () => {
  for (const style of STYLES) {
    const f = makeScene(style, 99)
    f.ensure(48, 5)
    for (let i = 0; i < 40; i++) f.step()
    const lit = decode(f.frame())
    expect(lit.length).toBe(48 * 5 * 3)
    let glyphs = 0
    for (let i = 0; i < lit.length; i += 3) if (lit[i] !== 0x20) glyphs++
    expect(glyphs).toBeGreaterThan(10)

    f.strength = 0
    for (let i = 0; i < 40; i++) f.step()
    const off = decode(f.frame())
    for (let i = 0; i < off.length; i += 3) expect(off[i]).toBe(0x20)
  }
  // `/flow next` walks SCENES in order and wraps round.
  STYLES.forEach((s, i) => expect(nextStyle(s)).toBe(STYLES[(i + 1) % STYLES.length]!))
})

test("the fire draws no backgrounds: every cell keeps the terminal's own", async () => {
  for (const strength of [1, 4, 8, 10]) {
    const f = makeScene('fire', 7)
    f.strength = strength
    f.ensure(60, 5)
    for (let i = 0; i < 60; i++) f.step()
    const words = decode(f.frame())
    for (let i = 0; i < words.length; i += 3) expect(words[i + 2]).toBe(DEFAULT)
  }
})

// ── The heat model ───────────────────────────────────────────────────────

/** Level per frame over `seconds` of a workload at 70 ms frames. */
function simulate(
  seconds: number,
  each: (h: Activity, t: number) => void,
  setup = (h: Activity) => {
    h.turnStarted()
    h.modelStep('high')
  },
) {
  const h = new Activity()
  setup(h)
  const levels: number[] = []
  for (let f = 0; f < Math.round(seconds / 0.07); f++) {
    each(h, f * 0.07)
    h.tick()
    levels.push(h.strength(1))
  }
  const sorted = [...levels].sort((a, b) => a - b)
  return {
    median: sorted[Math.floor(sorted.length / 2)]!,
    max: sorted[sorted.length - 1]!,
    at10: levels.filter(l => l === 10).length / levels.length,
  }
}
const tickOf = (t: number, period: number) => t % period < 0.035

test('calibration: a streamed answer sits below an edit-test loop', async () => {
  const chat = simulate(20, h => h.streamed(21)) // ~300 chars/s
  const loop = simulate(40, (h, t) => {
    const c = t % 7
    if (c < 0.035) {
      h.modelStep('high')
      h.edited(30)
    }
    if (Math.abs(c - 1) < 0.035) {
      h.ranCommand()
      h.toolsInFlight = 1
    }
    if (Math.abs(c - 6) < 0.035) h.toolsInFlight = 0
  })
  expect(chat.median).toBeLessThan(loop.max)
  expect(chat.max).toBeLessThan(loop.max)
})

test('calibration: a swarm of reading subagents stays below 10; editing ones reach it', async () => {
  // (Over 30 s: a turn running longer climbs a level each 30 s on purpose, below.)
  const readers = simulate(30, (h, t) => {
    h.runningAgents = 4
    for (let a = 0; a < 4; a++) {
      if (tickOf(t + a * 0.5, 2)) {
        h.read(true)
        h.modelStep('low', true)
        h.streamed(60, 'text', true)
      }
    }
  })
  expect(readers.at10).toBeLessThan(0.1)
  const editors = simulate(60, (h, t) => {
    h.runningAgents = 4
    for (let a = 0; a < 4; a++) if (tickOf(t + a * 0.5, 3)) h.edited(30, true)
  })
  expect(editors.max).toBe(10)
})

test('calibration: any other tool (MCP) sparks as a read does: above a quiet turn, below an edit-test loop; a swarm stays below 10', async () => {
  // (Over 25 s: a turn running longer climbs a level each 30 s on purpose.)
  const turn = (spark: boolean) =>
    simulate(25, (h, t) => {
      const c = t % 3
      if (c < 0.035) {
        h.modelStep('high')
        if (spark) h.usedTool()
        h.toolsInFlight = 1
      }
      if (Math.abs(c - 1) < 0.035) h.toolsInFlight = 0
    })
  const loop = simulate(25, (h, t) => {
    const c = t % 7
    if (c < 0.035) {
      h.modelStep('high')
      h.edited(30)
    }
    if (Math.abs(c - 1) < 0.035) {
      h.ranCommand()
      h.toolsInFlight = 1
    }
    if (Math.abs(c - 6) < 0.035) h.toolsInFlight = 0
  })
  // A browser driven over MCP, a call a second, still sits below the edit-test loop.
  const busy = simulate(25, (h, t) => {
    if (tickOf(t, 1)) {
      h.modelStep('high')
      h.usedTool()
    }
  })
  expect(turn(true).max).toBeGreaterThan(turn(false).max)
  expect(turn(true).max).toBeLessThan(loop.max)
  expect(busy.max).toBeLessThan(loop.max)
  const swarm = simulate(25, (h, t) => {
    h.runningAgents = 4
    for (let a = 0; a < 4; a++) {
      if (tickOf(t + a * 0.5, 2)) {
        h.usedTool(true)
        h.modelStep('low', true)
      }
    }
  })
  expect(swarm.at10).toBeLessThan(0.1)
})

test('calibration: a blocked tool keeps a low burn; a burst cools back to idle', async () => {
  const blocked = simulate(30, (h, t) => {
    if (t < 0.035) {
      h.ranCommand()
      h.toolsInFlight = 1
    }
  })
  expect(blocked.median).toBe(effortFloor('high') + 1)

  const h = new Activity()
  h.heat = 5
  for (let i = 0; i < 400; i++) h.tick() // ~28 s
  expect(h.strength(1)).toBe(1)
  expect(h.strength(0)).toBe(0)
  expect(h.isGlowing).toBe(false)
})

test('a turn that keeps going climbs a level every 30 s, and starts over with the next turn', async () => {
  const h = new Activity()
  h.turnStarted()
  h.modelStep(undefined) // the default floor, 3
  const at = (seconds: number) => {
    while (h.turnFrames * 0.07 < seconds) h.tick()
    return h.strength(1)
  }
  expect(at(29)).toBe(3)
  expect(at(31)).toBe(4)
  expect(at(61)).toBe(5)
  h.turnStarted() // (raised again within the turn: it keeps counting)
  expect(at(91)).toBe(6)
  expect(at(600)).toBe(10) // never past 10
  h.turnEnded()
  expect(h.strength(1)).toBeLessThanOrEqual(1 + Math.round(h.heat))
  h.turnStarted()
  h.modelStep(undefined)
  expect(h.strength(1)).toBe(3)
})

test("a turn's 30 s clock stops while it waits on the person (a permission, a question), and goes on after", async () => {
  const h = new Activity()
  h.turnStarted()
  h.modelStep(undefined)
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / 0.07); i++) h.tick()
  }
  run(20)
  h.waitingOn('toolu_1') // a permission prompt, left a minute
  h.waitingOn('toolu_2') // and Claude's question beside it
  run(60)
  expect(h.isWaiting).toBe(true)
  expect(h.turnBoost).toBe(0)
  h.answered('toolu_1')
  run(5)
  expect(h.turnBoost).toBe(0) // the question still waits
  h.answered('toolu_2')
  run(11) // 20 s + 11 s of work: past 30
  expect(h.turnBoost).toBe(1)
  h.waitingOn('toolu_3')
  h.turnEnded() // the turn ending forgets what waited
  expect(h.isWaiting).toBe(false)
})

test("a turn's clock goes on while a subagent's ask is with the mode's decider; a dialog up for the person (any loop's) stops it", async () => {
  const h = new Activity()
  h.roster.listed([{ id: 'agent-1', status: 'running', type: 'Explore', description: 'look around' }])
  h.turnStarted()
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / 0.07); i++) h.tick()
  }
  h.waitingOn('sub', false, 'Bash', 'agent-1') // auto mode's classifier deciding a subagent's ask
  expect(h.isWaiting).toBe(false)
  run(31)
  expect(h.turnBoost).toBe(1)
  h.prompted('Bash', 'agent-1') // its dialog is up: the person is asked, the whole session waits on them
  expect(h.isWaiting).toBe(true)
  run(60)
  expect(h.turnBoost).toBe(1)
  h.answered('sub', 'Bash', 'agent-1')
  h.waitingOn('main', false, 'Bash') // the main loop's own ask, still with the decider: its turn is held up
  expect(h.isWaiting).toBe(true)
})

test("the main turn ending forgets only its own waits: a subagent's dialog still up keeps waiting on you", async () => {
  const h = new Activity()
  h.roster.listed([{ id: 'bg', status: 'running', type: 'Explore', description: 'in the background' }])
  h.turnStarted()
  h.waitingOn('main', true, 'AskUserQuestion')
  h.waitingOn('sub', true, 'AskUserQuestion', 'bg')
  h.turnEnded()
  expect(h.isAwaitingPerson).toBe(true)
  expect(h.roster.dials()[0]!.state).toBe('waiting')
  h.answered('sub', 'AskUserQuestion', 'bg')
  expect(h.isAwaitingPerson).toBe(false)
})

test("a subagent's model step never moves the main turn's effort floor", async () => {
  const h = new Activity()
  h.turnStarted()
  h.modelStep('max')
  h.modelStep('low', true)
  expect(h.floor).toBe(6)
})

test('glowing and strength agree: once it shows no level, it is not glowing', async () => {
  const h = new Activity()
  for (let heat = 0; heat < 2; heat += 0.05) {
    h.heat = heat
    expect(h.isGlowing).toBe(h.strength(0) > 0)
  }
})

test('failures and compaction tint the tips, then clear', async () => {
  const h = new Activity()
  h.failed()
  expect(h.tint).toBe('smoke')
  for (let i = 0; i < 40; i++) h.tick()
  expect(h.tint).toBe('normal')
  h.contextPercent = 90
  expect(h.tint).toBe('blue')
})

test('lines written by each write tool', async () => {
  expect(linesWritten('Write', { content: 'a\nb\nc' })).toBe(3)
  expect(linesWritten('Edit', { new_string: 'x' })).toBe(1)
  expect(linesWritten('MultiEdit', { edits: [{ new_string: 'a\nb' }, { new_string: 'c' }] })).toBe(3)
  expect(linesWritten('MultiEdit', { edits: 'nope' })).toBe(1)
  expect(linesWritten('NotebookEdit', { new_source: 'x\ny' })).toBe(2)
  expect(linesWritten('Bash', { command: 'ls' })).toBeUndefined()
})

// ── Settings and the command ─────────────────────────────────────────────

test('/flow parses every form; `on` means auto', async () => {
  expect(parseFlowArgs('')).toEqual({ kind: 'show' })
  expect(parseFlowArgs('auto')).toEqual({ kind: 'auto' })
  expect(parseFlowArgs('on')).toEqual({ kind: 'auto' })
  expect(parseFlowArgs('idle 0')).toEqual({ kind: 'idle', level: 0 })
  expect(parseFlowArgs('idle 5').kind).toBe('error')
  expect(parseFlowArgs('off')).toEqual({ kind: 'manual', level: 0 })
  expect(parseFlowArgs(' 3 ')).toEqual({ kind: 'manual', level: 3 })
  expect(parseFlowArgs('10')).toEqual({ kind: 'manual', level: 10 })
  expect(parseFlowArgs('11').kind).toBe('error')
  expect(parseFlowArgs('AUTO')).toEqual({ kind: 'auto' })
  expect(parseFlowArgs('auto x').kind).toBe('error')
  expect(parseFlowArgs('style')).toEqual({ kind: 'style' })
  expect(parseFlowArgs('style fire')).toEqual({ kind: 'style', name: 'fire' })
  // The fire's two old looks are both the fire now.
  expect(parseFlowArgs('classic')).toEqual({ kind: 'style', name: 'fire' })
  expect(parseFlowArgs('ember')).toEqual({ kind: 'style', name: 'fire' })
  expect(parseFlowArgs('style hearth').kind).toBe('error') // retired
  // Scenes by name alone; `next` cycles; old night styles are the plain scene.
  expect(parseFlowArgs('ski')).toEqual({ kind: 'style', name: 'ski' })
  expect(parseFlowArgs('next')).toEqual({ kind: 'style' })
  expect(parseFlowArgs('balloon-night').kind).toBe('error') // day or night is never part of a name
  // A scene and a time of day at once, either way round.
  expect(parseFlowArgs('surf night')).toEqual({ kind: 'style', name: 'surf', time: 'night' })
  expect(parseFlowArgs('day ski')).toEqual({ kind: 'style', name: 'ski', time: 'day' })
  expect(parseFlowArgs('surf loud').kind).toBe('error')
  // An unknown scene lists the real ones.
  const unknown = parseFlowArgs('surfing')
  expect(unknown.kind).toBe('error')
  expect(unknown.kind === 'error' && unknown.text.includes('surf, ski')).toBe(true)
  expect(parseFlowArgs('help')).toEqual({ kind: 'help' })
  expect(parseFlowArgs('list')).toEqual({ kind: 'help' })
  expect(parseFlowArgs('manual')).toEqual({ kind: 'manual' })
  expect(parseFlowArgs('idle glow')).toEqual({ kind: 'idle', level: 1 })
  expect(parseFlowArgs('idle dark')).toEqual({ kind: 'idle', level: 0 })
  // Day and night, apart from the scene.
  expect(parseFlowArgs('night')).toEqual({ kind: 'time', time: 'night' })
  expect(parseFlowArgs('day')).toEqual({ kind: 'time', time: 'day' })
  expect(parseFlowArgs('clock')).toEqual({ kind: 'time', time: 'clock' })
  expect(parseFlowArgs('night now').kind).toBe('error')
})

test('day and night: the clock decides unless pinned', async () => {
  expect(isNightAt('clock', 12)).toBe(false)
  expect(isNightAt('clock', 7)).toBe(false)
  expect(isNightAt('clock', 18)).toBe(false)
  expect(isNightAt('clock', 19)).toBe(true)
  expect(isNightAt('clock', 2)).toBe(true)
  expect(isNightAt('day', 2)).toBe(false)
  expect(isNightAt('night', 12)).toBe(true)
  expect(readConfig(undefined).time).toBe('clock')
  expect(readConfig({ time: 'night' }).time).toBe('night')
  expect(readConfig({ time: 'dusk' }).time).toBe('clock')
  const cfg = readConfig({ style: 'surf' })
  expect(changesFor(parseFlowArgs('night'), cfg)).toEqual({ time: 'night' })
  expect(statusText({ ...cfg, time: 'night' }, 8, 'normal', { hour: 12, minute: 0 })).toContain('night')
  expect(statusText(cfg, 8, 'normal', { hour: 8, minute: 54 })).toContain('day (clock 08:54)')
  expect(statusText(cfg, 8, 'normal', { hour: 21, minute: 5 })).toContain('night (clock 21:05)')
  expect(statusText({ ...cfg, style: 'fire' }, 8, 'normal', { hour: 23, minute: 0 })).not.toContain('night') // no night to show
  expect(statusText({ ...cfg, style: 'fire', time: 'night' }, 8, 'normal', { hour: 12, minute: 0 })).toContain('night pinned')
  expect(changedText(parseFlowArgs('clock'), cfg, "Claude's", { hour: 12, minute: 0 })).toContain('clock')
  // A scene with a time sets both.
  expect(changesFor(parseFlowArgs('ski night'), cfg)).toEqual({ style: 'ski', time: 'night' })
})

test('/flow says how to undo, and names tints in words', async () => {
  const cfg = readConfig(undefined)
  expect(changedText(parseFlowArgs('off'), { ...cfg, mode: 'manual', level: 0 }, "Claude's", { hour: 12, minute: 0 })).toContain('/flow auto')
  expect(changedText(parseFlowArgs('5'), { ...cfg, mode: 'manual', level: 5 }, "Claude's", { hour: 12, minute: 0 })).toBe(
    'holding 5/10 — `/flow auto` to follow the work again',
  )
  expect(changedText(parseFlowArgs('surf'), { ...cfg, style: 'surf' }, "Claude's", { hour: 12, minute: 0 })).toContain('/flow next')
  expect(statusText(cfg, 4, 'smoke', { hour: 12, minute: 0 })).toContain('after a failure')
  expect(statusText(cfg, 4, 'blue', { hour: 12, minute: 0 })).toContain('context nearly full')
  expect(statusText(cfg, 4, 'normal', { hour: 12, minute: 0 })).toContain('/flow help')
  expect(helpText()).toContain('band | spine')
  expect(helpText("pi's", { panes: false, sound: false })).not.toContain('spine')
  // pi has no player: neither the help nor the status speaks of sound there.
  expect(helpText()).toContain('/flow sound')
  expect(helpText("pi's", { panes: false, sound: false })).not.toContain('sound')
  const loud = readConfig({ sound: 'on' })
  expect(statusText(loud, 4, 'normal', { hour: 12, minute: 0 })).toContain('sound on')
  expect(statusText(loud, 4, 'normal', { hour: 12, minute: 0 }, undefined, { panes: false, sound: false })).not.toContain('sound')
})

test('surf and ski: night darkens the sky, with stars or a moon in it', async () => {
  const lum = (c: number) => ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11
  for (const style of ['surf', 'ski'] as const) {
    const shots: number[][] = []
    for (const night of [false, true]) {
      const f = makeScene(style, 4)
      f.strength = 5
      f.night = night
      f.ensure(60, 5)
      for (let i = 0; i < 80; i++) f.step()
      const g = f.grid()
      const top: number[] = []
      for (let x = 0; x < 60; x++) top.push(g.background(x))
      shots.push(top)
    }
    const [day, night] = shots as [number[], number[]]
    const avg = (row: number[]) => row.reduce((s, c) => s + lum(c), 0) / row.length
    expect(avg(night)).toBeLessThan(avg(day) * 0.5)
    // Something bright up there: a star or the moon.
    const f = makeScene(style, 4)
    f.strength = 5
    f.night = true
    f.ensure(60, 5)
    for (let i = 0; i < 80; i++) f.step()
    const g = f.grid()
    let bright = 0
    for (let i = 0; i < 60 * 2; i++) for (const c of [g.foreground(i), g.background(i)]) if (c !== 0x01000000 && lum(c) > 180) bright++
    expect(bright).toBeGreaterThan(0)
  }
})

test('settings: /flow sound on | off | (toggle), shown in the status', () => {
  expect(parseFlowArgs('sound on')).toEqual({ kind: 'sound', sound: 'on' })
  expect(parseFlowArgs('sound off')).toEqual({ kind: 'sound', sound: 'off' })
  expect(parseFlowArgs('sound')).toEqual({ kind: 'sound' })
  expect(parseFlowArgs('sound loud').kind).toBe('error')
  const cfg = readConfig({ sound: 'on' })
  expect(cfg.sound).toBe('on')
  expect(changesFor(parseFlowArgs('sound'), cfg)).toEqual({ sound: 'off' })
  expect(statusText(cfg, 3, 'normal', { hour: 12, minute: 0 })).toContain('sound on')
  expect(helpText()).toContain('/flow sound')
})

test('settings: /flow sound 1-10 turns it on at that volume; 0 turns it off, keeping the volume for next time', () => {
  expect(parseFlowArgs('sound 4')).toEqual({ kind: 'sound', sound: 'on', volume: 4 })
  expect(parseFlowArgs('sound 10')).toEqual({ kind: 'sound', sound: 'on', volume: 10 })
  expect(parseFlowArgs('sound 0')).toEqual({ kind: 'sound', sound: 'off' })
  for (const bad of ['sound 11', 'sound -1', 'sound 4.5', 'sound on 4', 'sound 4 on', 'volume', 'volume 11', 'volume loud']) expect(parseFlowArgs(bad).kind).toBe('error')
  // `/flow volume 4` is `/flow sound 4`.
  expect(parseFlowArgs('volume 4')).toEqual(parseFlowArgs('sound 4'))
  expect(parseFlowArgs('volume 0')).toEqual({ kind: 'sound', sound: 'off' })
  const off = readConfig(undefined)
  expect(off.volume).toBe(DEFAULT_VOLUME)
  expect(changesFor(parseFlowArgs('sound 4'), off)).toEqual({ sound: 'on', volume: 4 })
  const four = { ...off, sound: 'on' as const, volume: 4 }
  expect(changesFor(parseFlowArgs('sound 0'), four)).toEqual({ sound: 'off' })
  // Toggled back on, it plays at the volume it had.
  expect(changesFor(parseFlowArgs('sound'), { ...four, sound: 'off' })).toEqual({ sound: 'on' })
  const clock = { hour: 12, minute: 0 }
  expect(statusText(four, 3, 'normal', clock)).toContain('sound on at 4/10')
  expect(statusText({ ...four, sound: 'off' }, 3, 'normal', clock)).not.toContain('sound on')
  expect(changedText(parseFlowArgs('sound 4'), four, "Claude's", clock)).toBe('sound on at 4/10 (7 plays as tuned)')
  expect(changedText(parseFlowArgs('sound 7'), { ...four, volume: 7 }, "Claude's", clock)).toBe('sound on at 7/10, as tuned')
  expect(changedText(parseFlowArgs('sound 9'), { ...four, volume: 9 }, "Claude's", clock)).toContain('the loudest already play near full')
  expect(changedText(parseFlowArgs('sound'), four, "Claude's", clock)).toContain('`/flow sound 1-10` sets the volume')
  expect(changedText(parseFlowArgs('sound 0'), { ...four, sound: 'off' }, "Claude's", clock)).toBe('sound off')
  expect(helpText()).toContain('/flow sound 1-10')
  // Stored: a whole number from 1 to 10, else the default.
  expect(readConfig({ volume: 3 }).volume).toBe(3)
  for (const bad of [0, 11, 4.5, -2, 'loud', null]) expect(readConfig({ volume: bad }).volume).toBe(DEFAULT_VOLUME)
})

test('soundscapes: the volume is 3 dB a step below the default, and above it a lift that tapers to none at the cap: no play ever past 1.4', () => {
  const dB = (x: number) => 20 * Math.log10(x)
  const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6)
  expect(VOLUME_DB).toHaveLength(10)
  expect(VOLUME_DB[DEFAULT_VOLUME - 1]).toBe(0)
  for (let g = 0.01; g <= MAX_GAIN; g += 0.01) {
    // The default plays as tuned; below it, every play is turned down alike.
    near(volumeGain(g, DEFAULT_VOLUME), g)
    for (let v = 1; v < DEFAULT_VOLUME; v++) near(dB(volumeGain(g, v) / g), -3 * (DEFAULT_VOLUME - v))
    // Each step up is louder (or, at the cap, as loud).
    for (let v = 2; v <= 10; v++) expect(volumeGain(g, v)).toBeGreaterThanOrEqual(volumeGain(g, v - 1))
  }
  // Above the default: a quiet play gets the step's whole lift, a louder one less, one at the cap none...
  near(dB(volumeGain(0.2, 10) / 0.2), 6)
  expect(dB(volumeGain(0.7, 10) / 0.7)).toBeLessThan(6)
  expect(dB(volumeGain(0.7, 10) / 0.7)).toBeGreaterThan(2)
  expect(volumeGain(MAX_GAIN, 10)).toBe(MAX_GAIN)
  // ...and a louder play stays the louder (a busier moment still sounds busier), none past the cap.
  for (let v = 1; v <= 10; v++) {
    let last = 0
    for (let g = 0; g <= 4; g += 0.005) {
      const out = volumeGain(g, v)
      expect(out).toBeLessThanOrEqual(MAX_GAIN)
      expect(out).toBeGreaterThanOrEqual(last)
      last = out
    }
  }
  // Every scene's beds, event clips and bursts, at every level and volume.
  const amb = { roar: 1, wind: 1, burner: 1, sea: 1 }
  for (const scene of STYLES)
    for (let level = 0; level <= 10; level++)
      for (let volume = 1; volume <= 10; volume++) {
        const p = bedPlay({ scene, level, tint: 'normal', night: false, amb }, level)
        if (p) expect(volumeGain(p.gain, volume)).toBeLessThanOrEqual(1.4)
        for (const kind of Object.keys(EVENTS) as (keyof typeof EVENTS)[])
          expect(volumeGain(eventPlay({ kind, v: 1 }, level, scene, level)!.gain, volume)).toBeLessThanOrEqual(1.4)
        expect(volumeGain(master(scene, level), volume)).toBeLessThanOrEqual(1.4)
      }
  // Out of range: clamped, never NaN.
  expect(volumeGain(1, 0)).toBe(volumeGain(1, 1))
  expect(volumeGain(1, 99)).toBe(volumeGain(1, 10))
  expect(volumeGain(1, Number.NaN)).toBe(1)
})

test('soundscapes: a new volume crossfades a fresh bed take in within seconds (turned down, the old one goes sooner)', () => {
  const takes: (BedTake | undefined)[] = []
  const mood = (volume: number) => ({ scene: 'engine', level: 9, tint: 'normal' as const, night: false, amb: {}, volume })
  const first = bedStep(takes, mood(DEFAULT_VOLUME), 0, 1)
  expect(first.play.length).toBe(1)
  // Nothing new while the volume holds (the take isn't due)...
  for (let ms = 70; ms < 5000; ms += 70) expect(bedStep(takes, mood(DEFAULT_VOLUME), ms, 2).play).toEqual([])
  // ...then a new volume: a fresh take at once, the old one stopped a third of the crossfade in (it's the louder).
  const quieter = bedStep(takes, mood(3), 5000, 3)
  expect(quieter.play.length).toBe(1)
  expect(bedStep(takes, mood(3), 5000 + BED_FADE_MS / 3, 4).stop).toEqual([first.play[0]!.id])
  // Turned up: the old one stays through the whole crossfade.
  const louder = bedStep(takes, mood(9), 10_000, 5)
  expect(louder.play.length).toBe(1)
  expect(bedStep(takes, mood(9), 10_000 + BED_FADE_MS / 3, 6).stop).toEqual([])
  expect(bedStep(takes, mood(9), 10_000 + BED_FADE_MS, 7).stop).toEqual([quieter.play[0]!.id])
})

test('the volume scales every clip as it plays, the bed and the bursts alike; a new one is heard within seconds', { options: { mode: 'manual', level: 9, sound: 'on', style: 'fire' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  // The fire's bed, and its sparks' bursts (synthesized here: no file), as tuned.
  const bed = bedPlay({ scene: 'fire', level: 9, tint: 'normal', night: false, amb: {} }, 1)!.gain
  const sparks = master('fire', 9)
  const near = (a: number | undefined, b: number) => expect(Math.abs((a ?? Number.NaN) - b)).toBeLessThan(1e-9)
  const heard = async (ms: number) => {
    const from = (seen.played ?? []).length
    await clock.advance(ms)
    const p = (seen.played ?? []).slice(from)
    return { beds: p.filter(x => x.asset?.includes('/bed-')), bursts: p.filter(x => x.asset === undefined) }
  }
  let h = await heard(4000)
  expect(h.beds.length).toBeGreaterThan(0)
  expect(h.bursts.length).toBeGreaterThan(0)
  for (const p of h.beds) near(p.gain, bed)
  for (const p of h.bursts) near(p.gain, sparks)
  // Turned down 9 dB: the sparks at once, the bed as a fresh take crossfades in.
  expect((await flow($, 'sound 4')).split('\n')[0]).toBe('sound on at 4/10 (7 plays as tuned)')
  h = await heard(4000)
  expect(h.beds.length).toBeGreaterThan(0)
  expect(h.bursts.length).toBeGreaterThan(0)
  for (const p of h.beds) near(p.gain, bed * 10 ** (-9 / 20))
  for (const p of h.bursts) near(p.gain, sparks * 10 ** (-9 / 20))
  // Turned up past the default: louder than as tuned, but never past 1.4.
  await flow($, 'sound 10')
  h = await heard(4000)
  expect(h.beds.length).toBeGreaterThan(0)
  for (const p of [...h.beds, ...h.bursts]) expect(p.gain!).toBeLessThanOrEqual(1.4)
  for (const p of h.beds) near(p.gain, volumeGain(bed, 10))
  for (const p of h.bursts) {
    near(p.gain, volumeGain(sparks, 10))
    expect(p.gain!).toBeGreaterThan(sparks)
  }
  await ui.unmount()
})

test("the volume from /config scales event clips too (the engine's chuffs)", { options: { mode: 'manual', level: 9, sound: 'on', style: 'engine', volume: 4 } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  expect((await flow($)).split('\n')[0]).toContain('sound on at 4/10')
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  await clock.advance(6000)
  const chuffs = (seen.played ?? []).filter(p => p.asset?.includes('events/chuff'))
  expect(chuffs.length).toBeGreaterThan(0)
  // As tuned, a chuff plays between its smallest and biggest gains; at 4, each 9 dB under.
  const [lo, hi] = [0, 1].map(v => EVENTS.chuff!.gain(v) * master('engine', 9) * 10 ** (-9 / 20))
  for (const p of chuffs) {
    expect(p.gain!).toBeGreaterThanOrEqual(lo! - 1e-9)
    expect(p.gain!).toBeLessThanOrEqual(hi! + 1e-9)
  }
  await ui.unmount()
})

test("sessions: the volume is a session's own: /flow sound 4 in one leaves another as it was; save and reset cover it", async ($, on) => {
  mock.clock(on)
  const store = memoryStore(on)
  const seen = engine(on, { blits: [], config: [], rows: {} })
  seen.session = 'a'
  await start($)
  const four = await flow($, 'sound 4')
  expect(four.split('\n')[0]).toBe('sound on at 4/10 (7 plays as tuned)')
  expect(four).toContain('just this session')
  expect(store.get(sessionKey('a'))).toMatchObject({ own: { sound: 'on', volume: 4 } })
  expect(seen.config).toEqual([]) // the default, /config, untouched
  // B, on the same store and /config: the default, then a volume of its own; A's stays as it was.
  seen.session = 'b'
  await start($)
  expect((await flow($)).split('\n')[0]).not.toContain('sound on')
  expect((await flow($, 'volume 9')).split('\n')[0]).toContain('sound on at 9/10')
  expect(store.get(sessionKey('a'))).toMatchObject({ own: { sound: 'on', volume: 4 } })
  seen.session = 'a'
  await start($)
  const a = await flow($)
  expect(a.split('\n')[0]).toMatch(/sound on at 4\/10$/)
  expect(a).toContain('just this session (your default: sound off, volume 7/10)')
  // Off and on again: back at 4.
  expect((await flow($, 'sound 0')).split('\n')[0]).toBe('sound off')
  expect((await flow($, 'sound')).split('\n')[0]).toContain('sound on at 4/10')
  // Saved, it's /config's row, the volume new sessions start with...
  expect((await flow($, 'save')).split('\n\n')[0]).toBe('saved as your default: new sessions start with sound on, volume 4/10')
  expect(seen.config).toContainEqual(['flow-scenes.volume', 4])
  seen.session = 'c'
  await start($)
  expect((await flow($)).split('\n')[0]).toMatch(/sound on at 4\/10$/)
  // ...while B keeps its own, until it's reset to the default.
  seen.session = 'b'
  await start($)
  expect((await flow($)).split('\n')[0]).toMatch(/sound on at 9\/10$/)
  expect((await flow($, 'reset')).split('\n\n')[0]).toBe('back to your default: volume 4/10')
  expect((await flow($)).split('\n')[0]).toMatch(/sound on at 4\/10$/)
  // A stored volume out of range isn't one.
  expect(readOwn({ volume: 11 })).toEqual({})
  expect(readOwn({ volume: '4' })).toEqual({})
  expect(readOwn({ volume: 4 })).toEqual({ volume: 4 })
})

test('soundscapes: a bed renews as its take fades, never with the take before, and follows the level at once', () => {
  const takes: (BedTake | undefined)[] = []
  const mood = (level: number) => ({ scene: 'avalon', level, tint: 'normal' as const, night: false, amb: {} })
  const starts: number[] = []
  const picks: string[] = []
  let seed = 1
  for (let ms = 0; ms < 600_000; ms += 70) {
    const { play, stop } = bedStep(takes, mood(5), ms, seed++)
    expect(stop).toEqual([])
    for (const p of play) {
      starts.push(ms)
      picks.push(p.asset)
    }
  }
  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i]! - starts[i - 1]!
    expect(gap >= BED_MIN_MS && gap <= BED_EVERY_MS + 70).toBe(true)
  }
  for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1])
  expect(new Set(picks).size).toBe(3)
  // A jump in level (another mood) starts a fresh take now, and the old one stops once it's in.
  const at = Math.max(600_000, starts.at(-1)! + BED_MS)
  const before = takes.map(t => t?.id)
  const rise = bedStep(takes, mood(10), at, seed++)
  expect(rise.play.length).toBe(1)
  expect(rise.play[0]!.asset).not.toBe(picks.at(-1))
  const later = bedStep(takes, mood(10), at + BED_FADE_MS, seed++)
  expect(later.stop.length).toBe(1)
  expect(before.includes(later.stop[0])).toBe(true)
  // A bed that falls silent stops (a rocket's engines cutting off, in orbit's quiet... or none at all).
  const rocket: (BedTake | undefined)[] = []
  const flying = { scene: 'falcon', level: 5, tint: 'normal' as const, night: false, amb: { roar: 1 } }
  const on = bedStep(rocket, flying, 0, 1)
  expect(on.play.length).toBe(1)
  const quiet = bedStep(rocket, { ...flying, amb: {} }, BED_FADE_MS, 2)
  expect(quiet.stop).toEqual([on.play[0]!.id])
})

test('soundscapes: a bed never has more than two takes going, leaving the player room for events', () => {
  for (const scene of STYLES) {
    const takes: (BedTake | undefined)[] = []
    const live = new Map<number, number>() // id -> when it ends by itself
    let seed = 1
    let most = 0
    const ambs = [{}, { roar: 1 }, { roar: 1, wind: 1 }, { space: 1 }, { wind: 0.5 }, { vent: 1 }, { sea: 1 }, { burner: 1 }]
    for (let ms = 0; ms < 900_000; ms += 70) {
      // The level and the doings wander: a new mood every few seconds.
      const level = 1 + (Math.floor(ms / 4130) * 7) % 10
      const amb = ambs[Math.floor(ms / 2710) % ambs.length]!
      const { play, stop } = bedStep(takes, { scene, level, tint: 'normal', night: false, amb }, ms, seed++)
      // (A stopped take leaves the player a moment later; a played-out one after afplay's drain.)
      for (const id of stop) if (live.has(id)) live.set(id, Math.min(live.get(id)!, ms + 100))
      for (const p of play) live.set(p.id, ms + BED_MS + PLAYER_DRAIN_MS)
      for (const [id, end] of live) if (end <= ms) live.delete(id)
      most = Math.max(most, live.size)
    }
    expect(most).toBeLessThanOrEqual(2)
    expect(MAX_PLAYS - most).toBeGreaterThanOrEqual(2)
  }
  // Silent just after a take renewed (the one before still fading out), back at once, then a new mood: every
  // take is stopped with the silence, so the bed still never holds more than two.
  const takes: (BedTake | undefined)[] = []
  const live = new Map<number, number>()
  const roaring = { scene: 'falcon', level: 5, tint: 'normal' as const, night: false, amb: { roar: 1 } }
  let seed = 1
  let most = 0
  let renewed = -1
  let silent = -1
  for (let ms = 0; ms < 40_000; ms += 70) {
    const quiet = silent >= 0 && ms < silent + 140
    const amb = quiet ? {} : silent >= 0 && ms >= silent + 3500 ? { roar: 1, wind: 1 } : roaring.amb
    const level = silent >= 0 && ms >= silent + 3500 ? 10 : 5
    const { play, stop } = bedStep(takes, { ...roaring, level, amb }, ms, seed++)
    for (const id of stop) if (live.has(id)) live.set(id, Math.min(live.get(id)!, ms + 100))
    for (const p of play) {
      live.set(p.id, ms + BED_MS + PLAYER_DRAIN_MS)
      if (ms > 0 && renewed < 0) renewed = ms
    }
    if (renewed >= 0 && silent < 0 && ms >= renewed + 500) silent = ms
    for (const [id, end] of live) if (end <= ms) live.delete(id)
    most = Math.max(most, live.size)
  }
  expect(silent).toBeGreaterThan(0)
  expect(most).toBeLessThanOrEqual(2)
})

test('soundscapes: a bed take the player refuses for good is replaced at once, not left silent till it would renew', { options: { mode: 'manual', level: 5, sound: 'on' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  let refusals = 5
  const seen = engine(on, undefined, asset => asset.includes('/bed-') && refusals-- > 0)
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  const beds = () => (seen.played ?? []).filter(p => p.asset?.includes('/bed-')).length
  await clock.advance(2000)
  // Tried five times (refused), then a fresh take, well before the ~10 s a take lasts before it renews.
  expect(beds()).toBe(6)
  await ui.unmount()
})

test('soundscapes: a scene holds only a few events for the adapter, so one that never takes them (pi) stays bounded', () => {
  for (const style of STYLES) {
    const f = makeScene(style, 2)
    f.ensure(100, 5)
    for (let i = 0; i < 6000; i++) {
      f.strength = i % 900 < 450 ? 10 : 3
      f.step()
    }
    expect((f.sounds ?? []).length).toBeLessThanOrEqual(24)
  }
})

test('soundscapes: a busy burst samples the whole window, not just its first events', () => {
  const q: number[] = []
  for (let i = 0; i < 400; i++) gather(q, i, i, i * 7 + 1)
  expect(q.length).toBe(BURST_MAX)
  expect(q.filter(i => i >= 200).length).toBeGreaterThan(BURST_MAX / 4)
})

test('soundscapes: beds overlap at random gaps (no seam keeps a beat), and on-screen events synthesize a burst (a valid WAV, each at its moment)', () => {
  expect(BED_MS).toBeGreaterThan(BED_EVERY_MS)
  const gaps = Array.from({ length: 200 }, (_, i) => bedGap(i))
  for (const g of gaps) expect(g >= BED_MIN_MS && g <= BED_EVERY_MS).toBe(true)
  expect(new Set(gaps).size).toBeGreaterThan(100)
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan((BED_EVERY_MS - BED_MIN_MS) * 0.9)
  const b64 = burst([{ kind: 'pop', v: 0.5, offset: 0 }, { kind: 'crack', v: 1, offset: 0.2 }], 3)!
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF')
  const n = new DataView(bytes.buffer).getUint32(40, true) / 2
  expect(n).toBeGreaterThan(0.2 * 22050)
  expect(burst([], 1)).toBeUndefined()
})

test('soundscapes: every scene has a bed for every mood, every clip it and the events name exists, and no play can clip', () => {
  const files = new Set(SOUND_FILES)
  const ambs = [{}, { roar: 1, vent: 1, wind: 1, space: 0, burner: 1, swell: 1, lip: 1 }, { roar: 1, space: 1 }, { wind: 0.5 }, { sea: 1 }]
  for (const scene of STYLES) {
    // A scene without layers is silent (a new one, till it's given a soundscape): no moods either.
    if (!LAYERS[scene]) {
      expect(MOODS[scene]).toBeUndefined()
      continue
    }
    expect(MOODS[scene]).toBeDefined()
    let heard = 0
    for (let level = 0; level <= 10; level++)
      for (const amb of ambs)
        for (let seed = 0; seed < 6; seed++) {
          const p = bedPlay({ scene, level, tint: 'normal', night: false, amb }, seed)
          if (p) {
            heard++
            expect(files.has(p.asset)).toBe(true)
            // Clips peak at -2 to -3 dBFS and afplay's gain multiplies: past MAX_GAIN it clips.
            expect(p.gain).toBeLessThanOrEqual(MAX_GAIN)
          }
        }
    expect(heard).toBeGreaterThan(0)
  }
  for (const kind of Object.keys(EVENTS) as (keyof typeof EVENTS)[])
    for (let seed = 0; seed < 6; seed++) {
      const p = eventPlay({ kind, v: 1 }, seed, 'falcon', 10)!
      expect(files.has(p.asset)).toBe(true)
    }
})

test('sound on: fresh beds keep coming while it shows, and what happens on screen is heard', { options: { mode: 'manual', level: 9, sound: 'on', style: 'bubbles' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  await clock.advance(10_000)
  const plays = seen.plays ?? []
  // Beds (4 s each, every 3.3 s) and bursts of pops; nothing loops.
  expect(plays.length).toBeGreaterThan(6)
  expect(plays.every(p => p.startsWith('once:'))).toBe(true)
  const sizes = new Set(plays.map(p => Number(p.split(':')[1])))
  expect(sizes.size).toBeGreaterThan(1) // beds and bursts are different clips
  await ui.unmount()
})

test('tips: the other scenes once, while it is still the fire; the sound three chances later, if never on', () => {
  const fire = readConfig({})
  let t = readTips(undefined)
  let r = nextTip(t, fire)
  expect(r.tip).toContain('/flow next')
  expect(r.tip).toContain('starship')
  t = r.tips
  // Never again.
  const tips: (string | undefined)[] = []
  for (let i = 0; i < 6; i++) {
    r = nextTip(t, fire)
    tips.push(r.tip)
    t = r.tips
  }
  expect(tips.filter(Boolean).length).toBe(1)
  expect(tips[2]).toContain('/flow sound')
  // Found another scene first: no scenes tip; sound on before its turn: no sound tip.
  t = {}
  for (let i = 0; i < 6; i++) {
    r = nextTip(t, readConfig({ style: 'surf', sound: i === 1 ? 'on' : 'off' }))
    expect(r.tip).toBeUndefined()
    t = r.tips
  }
  // Stored junk is ignored.
  expect(readTips({ scenesTold: 'yes', since: -1, soundTold: true })).toEqual({ soundTold: true })
})

test('tips: someone who had Flow before tips were kept is taken as told; someone new starts on them', () => {
  const tipsOver = (t: ReturnType<typeof firstTips>, cfg = readConfig({})) => {
    const said: string[] = []
    for (let i = 0; i < 8; i++) {
      const r = nextTip(t, cfg)
      if (r.tip) said.push(r.tip)
      t = r.tips
    }
    return said
  }
  expect(firstTips(false, readConfig({}))).toEqual({})
  expect(tipsOver(firstTips(false, readConfig({})))).toHaveLength(2) // the scenes, then the sound
  // Flow's state from before, or any setting changed (the sound tried and turned off again leaves `off`, the default).
  expect(tipsOver(firstTips(true, readConfig({})))).toEqual([])
  for (const changed of [{ style: 'surf' }, { level: 5 }, { idle: 'dark' }, { mode: 'manual' }, { layout: 'spine' }, { time: 'night' }]) {
    expect(tipsOver(firstTips(false, readConfig(changed)))).toEqual([])
  }
})

test('tips: an existing user (Flow state in the store, no tips kept yet) is never told, at the start or under /flow', async ($, on) => {
  mock.clock(on)
  mock.store(on, { overrides: { sound: 'off' } }) // a session that ended without writing it through
  const seen = engine(on)
  await start($)
  expect(seen.toasts ?? []).toEqual([])
  for (let i = 0; i < 6; i++) expect(await flow($, '')).not.toContain('flow:')
})

test("tips: someone new who picks a scene before any tip, then reloads, is still new: the sound tip comes", async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  const quietStart = () =>
    ($ as unknown as { session: { start: (a: object) => Promise<unknown> } }).session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: false })
  await quietStart() // no prompt to toast over
  expect(await flow($, 'surf')).not.toContain('flow:') // (a scene found: no scenes tip)
  await start($) // a reload: the overrides it stored are this user's own, not from before
  expect(seen.toasts ?? []).toEqual([])
  expect(await flow($, '')).not.toContain('flow:')
  expect(await flow($, '')).toContain('`/flow sound` turns it on')
})

test('tips: the sound on at a start with no prompt (set in /config) still counts as tried once it is off again', { options: { sound: 'on' } }, async ($, on) => {
  mock.clock(on)
  mock.store(on, { tips: {} }) // someone new, tips kept
  engine(on)
  await ($ as unknown as { session: { start: (a: object) => Promise<unknown> } }).session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: false })
  const said = [await flow($, 'sound off')]
  for (let i = 0; i < 5; i++) said.push(await flow($, ''))
  expect(said.filter(s => s.includes('steps through them'))).toHaveLength(1)
  expect(said.filter(s => s.includes('`/flow sound` turns it on'))).toHaveLength(0)
})

test('tips: starting on the fire shows the scenes tip once, as a toast', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  expect(seen.toasts ?? []).toHaveLength(1)
  expect(seen.toasts![0]).toContain('`/flow next` steps through them')
  expect(await flow($, '')).not.toContain('steps through them')
})

test('tips: or, started without a prompt to toast over, under the next /flow', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await ($ as unknown as { session: { start: (a: object) => Promise<unknown> } }).session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: false })
  expect(seen.toasts ?? []).toEqual([])
  expect(await flow($, '')).toContain('`/flow next` steps through them')
  expect(await flow($, '')).not.toContain('steps through them')
})

test('/flow sound toggles it: on, the soundscape plays; off again, it stops at once and nothing more plays', { options: { mode: 'manual', level: 9, style: 'bubbles' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  await clock.advance(2000)
  expect(seen.plays ?? []).toEqual([])
  expect(await flow($, 'sound')).toContain('sound on')
  await clock.advance(3000)
  const playing = (seen.plays ?? []).length
  expect(playing).toBeGreaterThan(0)
  expect(await flow($, 'sound')).toContain('sound off')
  await clock.advance(5000)
  expect((seen.plays ?? []).length).toBe(playing)
  await ui.unmount()
})

test('the session ending stops the soundscape for good (Claude Code quitting leaves nothing playing); after a /clear it plays on', { options: { mode: 'manual', level: 9, style: 'bubbles', sound: 'on' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  await clock.advance(3000)
  const plays = () => (seen.plays ?? []).length
  // A /clear: the process goes on under another id, and so does the sound.
  await endSession($, 'clear', 'session-a')
  let before = plays()
  await clock.advance(3000)
  expect(plays()).toBeGreaterThan(before)
  // Quitting: the frames still running till the process goes start nothing (a clip begun now outlives it).
  await endSession($, 'prompt_input_exit', 'session-a')
  before = plays()
  await clock.advance(5000)
  expect(plays()).toBe(before)
  await ui.unmount()
})

test('a session no one is at stays quiet (Claude Code warms spares in the background, a terminal no one sees); a key in the prompt, and it plays', { options: { mode: 'manual', level: 9, style: 'bubbles', sound: 'on' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await ($ as unknown as TestDollar).session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  await clock.advance(10_000)
  expect(seen.plays ?? []).toEqual([])
  await keyed($)
  await clock.advance(3000)
  expect((seen.plays ?? []).length).toBeGreaterThan(0)
  await ui.unmount()
})

test('spine: the pane hides while flow is off, as the band does, and comes back with it', { options: { mode: 'manual', level: 5, layout: 'spine' } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const panes = new Set<string>()
  const calls: string[] = []
  on('ui.open', (_, e) => {
    panes.add((e as { id: string }).id)
    calls.push('open')
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    panes.delete((e as { id: string }).id)
    calls.push('close')
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  await start($)
  expect(panes.has('flow')).toBe(true)
  expect(await flow($, '0')).toContain('off')
  expect(panes.has('flow')).toBe(false)
  expect(await flow($, '5')).toContain('holding 5/10')
  expect(panes.has('flow')).toBe(true)
  // Still the spine: the pane closing itself isn't you asking for the band.
  expect(await flow($, '')).toContain('spine')
})

test('a clip refused as the player is full is retried, but not once the soundscape has moved to another scene', { options: { mode: 'manual', level: 9, sound: 'on', style: 'engine' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  // The player refuses the engine's chuffs (full); everything else plays.
  const seen = engine(on, undefined, asset => asset.includes('chuff'))
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  const chuffs = () => (seen.plays ?? []).filter(p => p.includes('chuff')).length
  await clock.advance(1000)
  // Frame by frame till a chuff is refused; then, its retry not yet due, another scene.
  const start0 = chuffs()
  for (let k = 0; k < 100 && chuffs() === start0; k++) await clock.advance(10)
  expect(chuffs()).toBeGreaterThan(start0)
  await flow($, 'surf')
  const before = chuffs()
  await clock.advance(2000)
  expect(chuffs()).toBe(before)
  await ui.unmount()
})

test('sound off (the default): nothing plays', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  await clock.advance(2000)
  expect(seen.plays ?? []).toEqual([])
  await ui.unmount()
})

test('config values are validated, falling back to defaults', async () => {
  expect(readConfig(undefined)).toEqual({ mode: 'auto', style: 'fire', idle: 1, level: 8, layout: 'band', time: 'clock', sound: 'off', volume: 7 })
  expect(readConfig({ mode: 'manual', style: 'ember', idle: 'dark', level: 3 })).toEqual({
    mode: 'manual',
    style: 'fire',
    idle: 0,
    level: 3,
    layout: 'band',
    time: 'clock',
    sound: 'off',
    volume: 7,
  })
  expect(readConfig({ idle: 'pilot' }).idle).toBe(1) // the old name for glow
  expect(readConfig({ idle: 'glow' })).toEqual({
    mode: 'auto',
    style: 'fire',
    idle: 1,
    level: 8,
    layout: 'band',
    time: 'clock',
    sound: 'off',
    volume: 7,
  })
  expect(readConfig({ mode: 'loud', style: 'hearth', idle: 'x', level: 5.5 })).toEqual(readConfig(undefined))
  expect(readConfig({ level: 42 }).level).toBe(8)
})

test('/config rows left on a scene since renamed or dropped read as the one meant', () => {
  const style = { key: 'flow-scenes.style', options: STYLES }
  expect(staleRows([{ ...style, value: 'colony' }], 'flow-scenes')).toEqual([{ key: 'flow-scenes.style', field: 'style', from: 'colony', to: 'avalon' }])
  expect(staleRows([{ ...style, value: 'ocean' }], 'flow-scenes')[0]?.to).toBe('surf')
  expect(staleRows([{ ...style, value: 'river' }], 'flow-scenes')[0]?.to).toBe('fire') // dropped: the default
  expect(staleRows([{ ...style, value: 'lava' }], 'flow-scenes')[0]?.to).toBe('fire')
  expect(staleRows([{ key: 'flow-scenes.idle', value: 'pilot', options: ['glow', 'dark'] }], 'flow-scenes')[0]?.to).toBe('glow')
  // Every old name and alias stands for a scene of today's.
  for (const d of SCENES) {
    for (const a of d.aliases ?? []) expect(staleRows([{ ...style, value: a }], 'flow-scenes')[0]?.to).toBe(d.name)
  }
  // A row already right, another plugin's, the panel's own, one with no options: left alone.
  const rows = [
    { ...style, value: 'surf' },
    { key: 'other.style', value: 'colony', options: ['a', 'b'] },
    { key: 'theme', value: 'colony', options: ['light', 'dark'] },
    { key: 'flow-scenes.level', value: 3 },
  ]
  expect(staleRows(rows, 'flow-scenes')).toEqual([])
})

test('a /config row left on an old scene (colony) reads as avalon, and nothing but /flow save writes /config', { options: { style: 'colony' } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  // Claude Code reads the stored `colony` as the default (fire) before Flow loads; /config's row still holds it.
  const row = { key: 'flow-scenes.style', label: 'Scene', kind: 'choice', value: 'colony', options: [...STYLES], provider: { plugin: 'flow-scenes', tier: 'user' }, isLocked: false }
  on('config.list', () => ({ value: [row] as never }))
  await start($)
  expect((await flow($)).split('\n')[0]).toContain('avalon')
  expect(seen.config).toEqual([])
  expect((seen.toasts ?? []).some(t => t.includes('colony'))).toBe(false)
})

test('settings arrive from /config', { options: { mode: 'manual', style: 'surf', level: 3 } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  await start($)
  expect((await flow($)).split('\n')[0]).toContain('surf, holding 3/10')
})

test('/flow applies at once without a /config write (no reload), and its changes outlast a reload', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  expect((await flow($, 'next')).split('\n')[0]).toBe('warp · `/flow next` for another')
  // (A one-time tip may follow the reply, after a blank line.)
  expect((await flow($, '5')).split('\n\n')[0]).toBe('holding 5/10 — `/flow auto` to follow the work again')
  expect((await flow($, '8')).split('\n\n')[0]).toBe('holding 8/10 — `/flow auto` to follow the work again')
  expect(seen.config).toEqual([]) // nothing written to /config: the scene keeps running
  expect((await flow($)).split('\n')[0]).toBe('warp, holding 8/10')
  // A reload (a /config menu change, a restart) reads them back from the store.
  await start($)
  expect((await flow($)).split('\n')[0]).toBe('warp, holding 8/10')
})

test('a big write lifts the scene; a failed command shows smoke', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  let isError = false
  on('tool.call', () => (isError ? { result: {} as never, isError: true as const } : { result: {} as never }))
  await start($)
  expect(await flow($)).toContain('now 1/10') // idle: a low glow

  const content = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')
  await $.tool.call({ tool: 'Write', file_path: '/tmp/x.ts', content } as never)
  expect(await flow($)).toContain('now 5/10') // 1 + a full flare of 4

  isError = true
  await $.tool.call({ tool: 'Bash', command: 'false' } as never)
  expect(await flow($)).toContain('after a failure')
})

test('an MCP tool (or any other) sparks the scene; a question put to the person does not', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  on('tool.call', () => ({ result: {} as never }))
  await start($)
  expect(await flow($)).toContain('now 1/10') // idle: a low glow
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  expect(await flow($)).toContain('now 1/10')
  await $.tool.call({ tool: 'mcp__github__create_issue', title: 'x' } as never)
  expect(await flow($)).toContain('now 2/10') // 1 + a read's spark
})

test('a precompute pass is not a compaction: no smoke', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  on('session.compact', () => ({ skip: 'nothing to do' }))
  await start($)
  await $.session.compact({ trigger: 'precompute' } as never)
  await $.session.compact({ trigger: 'manual' } as never) // skipped below
  expect(await flow($)).not.toContain('after a failure')
})

// ── The band ─────────────────────────────────────────────────────────────

test('the band draws its 5 rows on the terminal', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  const raster = await ui.find({ type: 'Raster', key: 'flow' })
  expect(raster?.props.columns).toBe(60)
  expect(raster?.props.rows).toBe(5)
  await ui.unmount()
})

test('the band yields to other surfaces, surveys, and a one-row squeeze', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  for (const [surface, props] of [
    ['vscode', BAND.props],
    ['terminal', { ...BAND.props, hasSurvey: true }],
    ['terminal', { ...BAND.props, maxRows: 2 }],
  ] as const) {
    const ui = await $.ui.mount({ plugin: 'flow-scenes', surface, component: 'AbovePrompt', props })
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    await ui.unmount()
  }
})

/** Decode a frame's PNG (stored deflate, as svg.ts writes it) back to its pixels. */
function decodeSvgPng(svg: string): { width: number; height: number; rgba: Uint8Array } {
  const b64 = /base64,([^"]+)"/.exec(svg)![1]!
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const view = new DataView(bytes.buffer)
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  let o = 8
  let width = 0
  let height = 0
  const data: number[] = []
  while (o < bytes.length) {
    const length = view.getUint32(o)
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8))
    const body = bytes.subarray(o + 8, o + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(o + 8)
      height = view.getUint32(o + 12)
    } else if (type === 'IDAT') {
      let k = 2
      for (;;) {
        const final = body[k]! & 1
        const n = body[k + 1]! | (body[k + 2]! << 8)
        for (let j = 0; j < n; j++) data.push(body[k + 5 + j]!)
        k += 5 + n
        if (final) break
      }
    }
    o += 12 + length
  }
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    expect(data[y * (width * 4 + 1)]).toBe(0) // no filter
    rgba.set(data.slice(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4)
  }
  return { width, height, rgba }
}

test('on desktop the band is one Svg sized to its cells', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'desktop', ...BAND })
  const svg = await ui.find({ type: 'Svg' })
  expect(svg?.props.width).toBe(60 * 8)
  expect(svg?.props.height).toBe(5 * 19)
  const png = decodeSvgPng(svg?.props.source as string)
  expect([png.width, png.height]).toEqual([120, 20]) // 2 x 4 pixels a cell
  await ui.unmount()
})

test('desktop: every scene, in every size, fits the Svg limit and decodes to its grid', async () => {
  for (const style of STYLES) {
    for (const [columns, rows] of [[250, 5], [41, 45], [40, 120]] as const) {
      const s = makeScene(style, 7)
      s.strength = 10
      s.coverageBoost = 60
      s.ensure(columns, rows)
      for (let i = 0; i < 20; i++) s.step()
      const grid = s.grid()
      const svg = frameSvg(grid)
      expect(svg.length).toBeLessThanOrEqual(SVG_LIMIT)
      const png = decodeSvgPng(svg)
      expect(png.width % columns).toBe(0)
      expect(png.height % rows).toBe(0)
      // A full block's pixels are its color, opaque.
      const sx = png.width / columns
      const sy = png.height / rows
      for (let i = 0; i < columns * rows; i++) {
        if (grid.codePoint(i) !== 0x2588) continue
        const o = (Math.floor(i / columns) * sy * png.width + (i % columns) * sx) * 4
        const fg = grid.foreground(i)
        expect([...png.rgba.subarray(o, o + 4)]).toEqual([(fg >> 16) & 255, (fg >> 8) & 255, fg & 255, 255])
        break
      }
    }
  }
})

test('a pane wider than it is tall still gets the tall layouts, not the 5-row band\'s', () => {
  expect(isTall(250, 5)).toBe(false) // the band
  expect(isTall(13, 30)).toBe(true) // the spine
  expect(isTall(76, 45)).toBe(true) // a desktop pane dragged wide
})

test('desktop: quadrants, eighths, shades and braille land on their own pixels', () => {
  expect(coverage(0x2598)).toBe(0b00000101) // upper left quadrant: x0 of rows 0-1
  expect(coverage(0x2584)).toBe(0b11110000) // lower half
  expect(coverage(0x2582)).toBe(0b11000000) // lower quarter: the bottom row
  expect(coverage(0x258c)).toBe(0b01010101) // left half: the left column
  expect(coverage(0x2801)).toBe(0b00000001) // braille dot 1, top left
  expect(coverage(0x2880)).toBe(0b10000000) // braille dot 8, bottom right
  expect(coverage(0x41)).toBe(-1) // a letter: no block shape
})

test('PixelScene: paints pixels into glyphs, leaves the rest clear, lays specks over, blanks at 0', () => {
  let seen: Dials | undefined
  class Probe extends PixelScene {
    paint(px: Painter, d: Dials) {
      seen = d
      px.rect(0, 0, 2, 2, 0xff0000) // cell 0: all red
      px.set(0, 2, 0x00ff00) // cell 4 (row 1): one green pixel, top left
      px.dot(5, 1, 0xffffff) // cell 2: a speck
    }
  }
  const s = new Probe()
  s.strength = 5
  s.ensure(4, 3)
  s.step()
  const g = s.grid()
  expect(g.codePoint(0)).toBe(0x20) // one flat color: a space on that background
  expect(g.background(0)).toBe(0xff0000)
  expect(g.codePoint(4)).toBe(0x2598) // ▘ green, the rest the terminal's
  expect(g.foreground(4)).toBe(0x00ff00)
  expect(g.background(4)).toBe(DEFAULT)
  expect(g.codePoint(2)).toBe(0x2800 | 0x10) // braille dot at column 1, row 1
  expect(g.codePoint(1)).toBe(0x20) // untouched: blank, the terminal's own
  expect(g.background(1)).toBe(DEFAULT)
  expect(seen?.level).toBe(5)
  expect(seen?.tall).toBe(false)
  // The level glides toward a new dial rather than jumping...
  s.strength = 10
  s.step()
  expect(s.grid() && seen!.level).toBeGreaterThan(5)
  expect(seen!.level).toBeLessThan(6)
  // ...but 0 is off at once.
  s.strength = 0
  const off = s.grid().words
  for (let i = 0; i < off.length; i += 3) expect(off[i]).toBe(0x20)
})

test('every scene has a unique lowercase name, a blurb, and builds', () => {
  expect(new Set(STYLES).size).toBe(STYLES.length)
  for (const d of SCENES) {
    expect(d.name).toMatch(/^[a-z][a-z0-9-]*$/)
    expect(d.blurb.length).toBeGreaterThan(0)
    expect(styleNamed(d.name)).toBe(d.name)
    for (const a of d.aliases ?? []) expect(styleNamed(a)).toBe(d.name)
    const s = makeScene(d.name, 1)
    s.ensure(40, 5)
    s.step()
    expect(s.grid().columns).toBe(40)
  }
})

test('desktop: shades fill the whole cell, blended, rather than a dither', () => {
  const g = new Cells(1, 1)
  g.set(0, 0x2592, 0xff8800, DEFAULT) // ▒ over the terminal's own color
  const { rgba } = gridPixels(g, 2, 4)
  for (let i = 0; i < 8; i++) expect([...rgba.subarray(i * 4, i * 4 + 4)]).toEqual([0xff, 0x88, 0x00, 140])
  g.set(0, 0x2591, 0xffffff, 0x000000) // ░ over black: a dim grey
  expect([...gridPixels(g, 2, 4).rgba.subarray(0, 4)]).toEqual([77, 77, 77, 255])
})

test('desktop: the smaller pixel sizes blend what they cover, so sparse glyphs dim rather than vanish', () => {
  const lit = (cp: number, sx: number, sy: number) => {
    const g = new Cells(1, 1)
    g.set(0, cp, 0xff8800, DEFAULT)
    const { rgba } = gridPixels(g, sx, sy)
    let n = 0
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) n++
    return n
  }
  for (const [sx, sy] of [[2, 2], [1, 2], [1, 1]] as const) {
    expect(lit(0x2591, sx, sy)).toBeGreaterThan(0) // ░
    expect(lit(0x2801, sx, sy)).toBeGreaterThan(0) // braille dot 1, top left
    expect(lit(0x2804, sx, sy)).toBeGreaterThan(0) // braille dot 3, row 2
    expect(lit(0x2590, sx, sy)).toBeGreaterThan(0) // ▐ right half
    expect(lit(0x2808, sx, sy)).toBeGreaterThan(0) // braille dot 4, right column
  }
})

test('desktop: a pane too big for 1 × 2 still draws, at fewer pixels, never blank', () => {
  for (const [columns, rows] of [[200, 80], [512, 256]] as const) {
    const g = new Cells(columns, rows)
    for (let i = 0; i < columns * rows; i++) g.set(i, 0x2588, 0x334455, DEFAULT)
    const svg = frameSvg(g)
    expect(svg.length).toBeLessThanOrEqual(SVG_LIMIT)
    const png = decodeSvgPng(svg)
    expect(png.width).toBeGreaterThan(columns / 4)
    expect([...png.rgba.subarray(0, 4)]).toEqual([0x33, 0x44, 0x55, 255])
  }
})

test('two drivers on one cfg keep their own scenes, and both follow a change of scene', () => {
  const cfg = readConfig({ style: 'fire', mode: 'manual', level: 10 })
  const activity = new Activity()
  const terminal = new SceneDriver(cfg, activity)
  const desktop = new SceneDriver(cfg, activity)
  expect(terminal.scene).not.toBe(desktop.scene)
  terminal.dial().ensure(120, 5)
  desktop.dial().ensure(76, 45)
  for (let i = 0; i < 40; i++) {
    terminal.dial().step()
    desktop.dial().step()
  }
  // Each kept its own size, so neither was rebuilt: the terminal's fire has built up.
  const words = terminal.scene.grid().words
  let lit = 0
  for (let i = 0; i < words.length; i += 3) if (words[i] !== 0x20) lit++
  expect(lit).toBeGreaterThan(50)
  terminal.apply({ style: 'surf' })
  expect(terminal.scene).toBe(terminal.sceneFor('surf'))
  expect(desktop.scene).toBe(desktop.sceneFor('surf'))
  expect(terminal.scene).not.toBe(desktop.scene)
})

test('a desktop view that stops rendering (its window closed) is forgotten: no more redraws asked for', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  const desk = await $.ui.mount({ plugin: 'flow-scenes', surface: 'desktop', requestId: 'desk', ...BAND })
  seen.invalidates = 0
  await clock.advance(1000)
  expect(seen.invalidates).toBeGreaterThan(5) // while it's there, every frame asks for a redraw
  await desk.unmount()
  await clock.advance(5000)
  seen.invalidates = 0
  await clock.advance(3000)
  expect(seen.invalidates).toBeLessThan(2)
})

test('rockets: a new size while the split screen is open closes it cleanly (no garbage cells)', () => {
  const f = makeScene('starship', 3)
  f.strength = 1
  f.ensure(120, 5)
  for (let i = 0; i < 30; i++) f.step()
  let open = false
  for (let i = 0; i < 600 && !open; i++) {
    f.strength = 10
    f.step()
    f.grid()
    open = (f as unknown as { splitW: number }).splitW > 2
  }
  expect(open).toBe(true)
  f.ensure(18, 50)
  for (let i = 0; i < 5; i++) {
    f.strength = 10
    f.step()
    const w = f.grid().words
    for (let k = 0; k < w.length; k += 3) expect(w[k]).toBeGreaterThan(0)
  }
})

test('rockets: the tall split\'s top half sliding down moves a beacon\'s light with its cell, and drops one slid out of view', () => {
  type Split = {
    splitW: number
    splitOff: number
    rows: number
    columns: number
    nLamps: number
    lampCell: Int32Array
    lampColor: Int32Array
    shiftSplitView(out: unknown): void
  }
  const f = makeScene('starship', 1)
  const s = f as unknown as Split
  f.ensure(22, 60)
  // Sent home early: the booster parts low, and the top half slides down to keep the Ship centred.
  let slid = false
  for (let i = 0; i < 1200 && !slid; i++) {
    f.strength = i < 30 ? 1 : i < 120 ? 4 : 1
    f.step()
    f.grid()
    slid = Math.round(s.splitW) > 2 && Math.round(s.splitOff) > 2
  }
  expect(slid).toBe(true)
  const off = Math.round(s.splitOff)
  const W = s.columns
  const out = f.grid()
  s.nLamps = 2
  s.lampCell[0] = (off + 3) * W + 5 // three rows into the top half once it's slid
  s.lampCell[1] = (off - 1) * W + 5 // slid out of the top
  s.lampColor[0] = s.lampColor[1] = 0xffb030
  s.shiftSplitView(out)
  expect(s.nLamps).toBe(1)
  expect(s.lampCell[0]).toBe(3 * W + 5)
})

test("a session's own settings read a scene's old name (colony) as its new one (avalon)", () => {
  expect(readOwn({ style: 'colony', idle: 'dark', level: 42, junk: 1 })).toEqual({ style: 'avalon', idle: 0 })
})

test("a desktop view of the band doesn't stop the terminal's blits", async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  const term = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', requestId: 'term', ...BAND })
  await $.ui.mount({ plugin: 'flow-scenes', surface: 'desktop', requestId: 'desk', ...BAND })
  seen.blits.length = 0
  await clock.advance(2000)
  expect(seen.blits.length).toBeGreaterThan(3)
  expect(seen.blits.every(id => id === 'term')).toBe(true)
  await term.unmount()
})

test('with idle dark, an idle session gives the band back', { options: { idle: 'dark' } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

// ── pi ───────────────────────────────────────────────────────────────────

test('pi: the grid as 24-bit ANSI lines, one cell per glyph, reset at the end', async () => {
  const f = makeScene('fire', 3)
  f.ensure(30, 5)
  for (let i = 0; i < 30; i++) f.step()
  const lines = gridToAnsi(f.grid())
  expect(lines.length).toBe(5)
  for (const line of lines) {
    const visible = line.replace(/\x1b\[[0-9;]*m/g, '')
    expect(visible.length).toBe(30) // every glyph is one cell; pi needs lines to fit the width
    // No color left on at the end: the last style change in the line is a reset.
    const styles = line.match(/\x1b\[[0-9;]*m/g) ?? []
    if (styles.length) expect(styles[styles.length - 1]).toBe('\x1b[0m')
  }
  expect(lines.some(l => /\x1b\[38;2;\d+;\d+;\d+m/.test(l))).toBe(true)
})

test('pi: scenes keep their backgrounds; every cell decodes back to its grid colors', async () => {
  const DEFAULT = 0x01000000
  for (const [style, night] of [['surf', true], ['ski', false], ['balloon', false], ['falcon', true], ['fire', false]] as const) {
    const f = makeScene(style, 3)
    f.night = night
    f.strength = 8
    f.ensure(40, 4)
    for (let i = 0; i < 40; i++) f.step()
    const grid = f.grid()
    const lines = gridToAnsi(grid)
    for (let r = 0; r < grid.rows; r++) {
      let fg = DEFAULT
      let bg = DEFAULT
      let x = 0
      for (const part of lines[r]!.split(/(\x1b\[[0-9;]*m)/)) {
        const sgr = /^\x1b\[([0-9;]*)m$/.exec(part)
        if (sgr) {
          const n = sgr[1]!.split(';').map(Number)
          if (n[0] === 0) fg = bg = DEFAULT
          else if (n[0] === 38) fg = (n[2]! << 16) | (n[3]! << 8) | n[4]!
          else if (n[0] === 48) bg = (n[2]! << 16) | (n[3]! << 8) | n[4]!
          continue
        }
        for (const ch of part) {
          const i = r * grid.columns + x++
          expect(ch.codePointAt(0)).toBe(grid.codePoint(i))
          expect(fg).toBe(grid.foreground(i))
          expect(bg).toBe(grid.background(i))
        }
      }
      expect(x).toBe(grid.columns)
    }
  }
})

test("pi: thinking levels map onto the effort floors; edits count pi's input shapes", async () => {
  expect(effortOf('off')).toBe('low')
  expect(effortOf('minimal')).toBe('low')
  expect(effortOf('high')).toBe('high')
  expect(effortOf('max')).toBe('max')
  expect(effortOf(undefined)).toBeUndefined()
  expect(piLinesWritten('write', { path: 'a', content: 'x\ny' })).toBe(2)
  expect(piLinesWritten('edit', { path: 'a', edits: [{ oldText: 'a', newText: 'b\nc' }, { oldText: 'd', newText: 'e' }] })).toBe(3)
  expect(piLinesWritten('edit', { path: 'a', oldText: 'a', newText: 'b' })).toBe(1)
  expect(piLinesWritten('bash', { command: 'ls' })).toBeUndefined()
})

test('settings: the shared /flow grammar applies the same changes everywhere', async () => {
  const cfg = readConfig(undefined)
  expect(changesFor(parseFlowArgs('style'), cfg)).toEqual({ style: 'warp' })
  expect(changesFor(parseFlowArgs('idle 0'), cfg)).toEqual({ idle: 0, mode: 'auto' })
  expect(changesFor(parseFlowArgs(''), cfg)).toBeUndefined()
  expect(statusText({ ...cfg, mode: 'manual', level: 3 }, 3, 'normal', { hour: 12, minute: 0 }).split('\n')[0]).toBe('fire, holding 3/10')
})

test('settings: every adapter answers /flow the same way (replyTo): the status, the help, a mistake, save, reset, a change', async () => {
  const calls: string[] = []
  const cfg = readConfig(undefined)
  const defaults = readConfig({ style: 'surf' })
  const clock = { hour: 21, minute: 5 }
  const claude: FlowAdapter = {
    host: CLAUDE_CODE,
    agent: "Claude's",
    cfg,
    clock,
    defaults,
    level: () => 4,
    tint: () => 'smoke',
    save: async () => (calls.push('save'), { text: 'saved' }),
    reset: async () => (calls.push('reset'), 'reset'),
    change: async changes => {
      calls.push(`change ${JSON.stringify(changes)}`)
      Object.assign(cfg, changes)
      return '  (note)'
    },
  }
  expect(await replyTo(parseFlowArgs(''), claude)).toEqual({ text: statusText(cfg, 4, 'smoke', clock, defaults) })
  expect(await replyTo(parseFlowArgs('help'), claude)).toEqual({ text: helpText() })
  const wrong = parseFlowArgs('nonsense')
  expect(await replyTo(wrong, claude)).toEqual({ text: wrong.kind === 'error' ? wrong.text : '', level: 'warning' })
  expect(await replyTo(parseFlowArgs('save'), claude)).toEqual({ text: 'saved' })
  expect(await replyTo(parseFlowArgs('reset'), claude)).toEqual({ text: 'reset' })
  expect(calls).toEqual(['save', 'reset'])
  // A change: the adapter keeps it, and the reply is the change's words, then the adapter's note.
  expect(await replyTo(parseFlowArgs('ski night'), claude)).toEqual({ text: 'ski, night · `/flow next` for another  (note)' })
  expect(calls.at(-1)).toBe('change {"style":"ski","time":"night"}')
  expect(cfg).toMatchObject({ style: 'ski', time: 'night' })
  // pi: its own words and what it has (no panes, no player); without session entries, no defaults to compare with.
  const pi: FlowAdapter = { ...claude, host: { panes: false, sound: false }, agent: "pi's", defaults: undefined }
  expect((await replyTo(parseFlowArgs(''), pi)).text).toBe(statusText(cfg, 4, 'smoke', clock, undefined, pi.host))
  expect((await replyTo(parseFlowArgs('help'), pi)).text).toBe(helpText("pi's", pi.host))
  expect((await replyTo(parseFlowArgs('auto'), pi)).text).toBe("auto — moves with pi's work  (note)")
})

test('balloon: sits on the grass at 1, climbs to space at 10, eases back down', async () => {
  const b = new Balloon(1)
  b.ensure(60, 5)
  b.strength = 1
  for (let i = 0; i < 200; i++) b.step()
  expect(b.altitude).toBe(0)
  const ground = decode(b.frame())
  expect(ground[(4 * 60 + 0) * 3]).toBe(0x2580) // ▀ grass under the basket

  b.strength = 10
  const climb: number[] = []
  for (let i = 0; i < 300; i++) {
    b.step()
    if (i % 50 === 0) climb.push(b.altitude)
  }
  for (let i = 1; i < climb.length; i++) expect(climb[i]!).toBeGreaterThan(climb[i - 1]!) // a climb, not a jump
  expect(b.altitude).toBeGreaterThan(120)

  b.strength = 3
  for (let i = 0; i < 400; i++) b.step()
  expect(b.altitude).toBeLessThan(16) // a quiet spell brings it back down
})

test('spine: the balloon really climbs a tall column; the ground scrolls away only near the top', async () => {
  const b = new Balloon(5)
  b.ensure(18, 30)
  const crownRow = () => {
    const words = decode(b.frame())
    for (let r = 0; r < 30; r++) for (let x = 0; x < 18; x++) if (words[(r * 18 + x) * 3] === 0x2586) return r // ▆
    return -1
  }
  const isGroundBelow = () => {
    const words = decode(b.frame())
    for (let x = 0; x < 18; x++) if (words[(29 * 18 + x) * 3] !== 0x2580) return false
    return true
  }
  b.strength = 1
  for (let i = 0; i < 200; i++) b.step()
  const resting = crownRow()
  expect(isGroundBelow()).toBe(true)
  b.strength = 3
  for (let i = 0; i < 300; i++) b.step()
  expect(crownRow()).toBeLessThan(resting) // it rose up the screen
  expect(isGroundBelow()).toBe(true) // with the grass still below
  b.strength = 10
  for (let i = 0; i < 400; i++) b.step()
  expect(isGroundBelow()).toBe(false) // high enough that the world scrolled away
})

test('every style fills a tall spine', async () => {
  for (const style of STYLES) {
    const f = makeScene(style, 9)
    f.strength = 10
    f.ensure(18, 30)
    for (let i = 0; i < 120; i++) f.step()
    const words = decode(f.frame())
    const litRows = new Set<number>()
    for (let i = 0; i < words.length; i += 3) if (words[i] !== 0x20) litRows.add(Math.floor(i / 3 / 18))
    expect(litRows.size).toBeGreaterThan(12) // not just a strip at the bottom
  }
})

test('settings: layout parses, toggles, and shows', async () => {
  expect(parseFlowArgs('spine')).toEqual({ kind: 'layout', layout: 'spine' })
  expect(parseFlowArgs('layout band')).toEqual({ kind: 'layout', layout: 'band' })
  for (const w of ['horizontal', 'bar', 'flat']) expect(parseFlowArgs(w)).toEqual({ kind: 'layout', layout: 'band' })
  for (const w of ['portrait', 'vertical', 'side']) expect(parseFlowArgs(w)).toEqual({ kind: 'layout', layout: 'spine' })
  expect(parseFlowArgs('layout vertical')).toEqual({ kind: 'layout', layout: 'spine' })
  expect(parseFlowArgs('layout sideways').kind).toBe('error')
  const cfg = readConfig({ layout: 'spine' })
  expect(cfg.layout).toBe('spine')
  expect(changesFor(parseFlowArgs('layout'), cfg)).toEqual({ layout: 'band' })
  expect(statusText(cfg, 1, 'normal', { hour: 12, minute: 0 })).toContain('spine')
  expect(readConfig({ layout: 'diagonal' }).layout).toBe('band')
})

test('balloon: a rebuilt balloon (a settings reload) resumes in the air, not on the ground', async () => {
  const before = new Balloon(2)
  before.ensure(60, 5)
  before.strength = 8
  for (let i = 0; i < 300; i++) before.step()
  const cruising = before.altitude

  const after = new Balloon(3) // what a reload builds
  after.ensure(60, 5)
  after.seed(cruising)
  after.strength = 10 // the change that caused the reload
  after.step()
  expect(after.altitude).toBeGreaterThan(cruising) // carries on climbing from where it was
  after.seed(Number.NaN)
  expect(after.altitude).toBeGreaterThan(cruising) // a bad saved value is ignored
})

test('avalon: the ship coasts among still stars at 1; at 10 the stars blur past in streaks', async () => {
  const streaks = (level: number) => {
    const c = new Colony(4)
    c.ensure(90, 5)
    c.strength = level
    for (let i = 0; i < 60; i++) c.step()
    const words = decode(c.frame())
    let ship = 0
    let streak = 0
    for (let i = 0; i < words.length; i += 3) {
      const x = (i / 3) % 90
      // The ship: braille-dot vector lines, about a third of the way across.
      if (words[i]! >= 0x2801 && words[i]! <= 0x28ff && x >= 24 && x <= 40) ship++
      if (words[i] === 0x2500) streak++ // ─ a star's trail
    }
    return { ship, streak }
  }
  const coasting = streaks(1)
  const warp = streaks(10)
  expect(coasting.ship).toBeGreaterThan(0)
  expect(coasting.streak).toBe(0) // at 1 the stars are points
  expect(warp.streak).toBeGreaterThan(60) // at 10 they blur past
})

test('settings: starfield is now warp; the old name still works', async () => {
  expect(readConfig({ style: 'starfield' }).style).toBe('warp')
  expect(parseFlowArgs('style starfield')).toEqual({ kind: 'style', name: 'warp' })
  expect(parseFlowArgs('style colony')).toEqual({ kind: 'style', name: 'avalon' })
  expect(parseFlowArgs('interstellar')).toEqual({ kind: 'style', name: 'avalon' })
  expect(parseFlowArgs('sea night')).toEqual({ kind: 'style', name: 'surf', time: 'night' })
})

test('balloon: a sky behind it, day blue low down, darkening into the black of space', async () => {
  const blue = (c: number) => (c & 0xff) > ((c >> 16) & 0xff) // more blue than red
  const brightness = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255)
  expect(blue(skyColor(2))).toBe(true)
  expect(brightness(skyColor(80))).toBeLessThan(brightness(skyColor(5))) // darker with height
  expect(skyColor(140)).toBe(0x000000) // space is painted black, darker than any atmosphere
  for (let y = 0; y < 140; y++) expect(brightness(skyColor(y + 1))).toBeLessThan(brightness(skyColor(y)) + 1) // never lightens going up

  const b = new Balloon(6)
  b.ensure(40, 5)
  b.strength = 1
  for (let i = 0; i < 100; i++) b.step()
  const day = decode(b.frame())
  expect(blue(day[2]!)).toBe(true) // the top-left cell's background is sky
  b.strength = 10
  for (let i = 0; i < 500; i++) b.step()
  const space = decode(b.frame())
  expect(space[2]).toBe(0x000000) // at 10 the top row is the black of space
})

test('subagents running in the background lift the scene even with no turn (e.g. after a reload)', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const running = [1, 2, 3].map(i => ({ id: `a${i}`, description: 'cloud painter', type: 'subagent', status: 'running' }))
  on('agent.list', () => ({ value: running as never }))
  await start($) // a fresh load: no turn known, nothing remembered
  await clock.advance(6000) // one idle poll at most
  const text = await flow($)
  expect(text).not.toContain('now 1/10') // three subagents lift it off the pilot lights
})

test('a rocket picked while the level is flying starts in that stage, not on the pad', async () => {
  for (const level of [4, 10]) {
    // state and orbit are private (Falcon & { state } is never): reach them past the class's own type.
    const r = new Falcon(3) as unknown as Pick<Falcon, 'ensure' | 'strength' | 'step'> & { state: string; orbit: number }
    r.ensure(60, 5)
    r.strength = level
    r.step()
    expect(r.state).toBe('fly')
    expect(r.orbit).toBe(level >= 8 ? 1 : 0) // no launch and race up to orbit
  }
  const parked = new Falcon(3) as unknown as Pick<Falcon, 'ensure' | 'strength' | 'step'> & { state: string }
  parked.ensure(60, 5)
  parked.strength = 1
  parked.step()
  expect(parked.state).toBe('rest') // level 1 sits on the pad
})

test('rockets play every stage on the way up and down, about a second each', async () => {
  const r = new Falcon(3)
  r.ensure(60, 30)
  r.strength = 1
  r.step() // a fresh start resumes as asked: on the pad
  const seen: number[] = []
  for (let i = 0; i < 14 * 12; i++) {
    r.strength = 10 // what the dial asks for, every frame
    r.step()
    if (seen[seen.length - 1] !== r.strength) seen.push(r.strength)
  }
  expect(seen).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]) // no stage skipped
  const down: number[] = []
  for (let i = 0; i < 14 * 12; i++) {
    r.strength = 1
    r.step()
    if (down[down.length - 1] !== r.strength) down.push(r.strength)
  }
  expect(down).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1])
  r.strength = 0
  r.step()
  expect(r.strength).toBe(0) // off is instant
})

test('/flow ignores words that only exist on every object (constructor, __proto__)', async () => {
  for (const args of ['constructor', '__proto__', 'idle constructor', 'surf constructor', 'night __proto__']) {
    expect(parseFlowArgs(args).kind).toBe('error')
  }
})

// ── Per-session settings ─────────────────────────────────────────────────

type EndInput = { reason: string; sessionId: string; resume: { id: string } }
/** End the session as the engine does (a /clear, a resume, an exit), the process going on. */
async function endSession($: unknown, reason: string, id: string) {
  await ($ as { session: { end: (e: EndInput) => Promise<unknown> } }).session.end({ reason, sessionId: id, resume: { id } })
}

test('sessions: /flow changes only the session it runs in; each resumes with its own, a new one starts on the defaults', { options: { style: 'surf' } }, async ($, on) => {
  mock.clock(on)
  const store = memoryStore(on)
  const seen = engine(on)
  seen.session = 'a'
  await start($)
  expect((await flow($)).split('\n')[0]).toMatch(/^surf, auto/)
  const picked = await flow($, 'ski night')
  expect(picked.split('\n')[0]).toBe('ski, night · `/flow next` for another')
  expect(picked).toContain('just this session · `/flow save` makes it your default')
  expect(store.get(sessionKey('a'))).toMatchObject({ own: { style: 'ski', time: 'night' } })
  expect(store.has('overrides')).toBe(false) // nothing shared...
  expect(seen.config).toEqual([]) // ...and /config, the defaults, untouched
  // Session B (another process on the same store) starts on the defaults, and picks its own.
  seen.session = 'b'
  await start($)
  expect((await flow($)).split('\n')[0]).toMatch(/^surf, auto/)
  await flow($, 'bubbles')
  await flow($, 'sound on')
  // A resumed: its own back, and the status says which are its own.
  seen.session = 'a'
  await start($)
  const a = await flow($)
  expect(a.split('\n')[0]).toMatch(/^ski, auto, now \S+ \(idle glow\), night$/)
  expect(a).toContain('just this session (your default: surf, day and night by the clock) · `/flow save` makes this the default · `/flow reset` goes back')
  // B resumed: its own.
  seen.session = 'b'
  await start($)
  expect((await flow($)).split('\n')[0]).toMatch(/^bubbles, .*sound on at 7\/10$/)
  // A brand new session: the defaults, with nothing of its own.
  seen.session = 'c'
  await start($)
  const c = await flow($)
  expect(c.split('\n')[0]).toMatch(/^surf, auto/)
  expect(c).not.toContain('just this session')
  expect(store.has(sessionKey('c'))).toBe(false)
  expect(seen.config).toEqual([])
})

test('sessions: a /clear carries the settings on to the new conversation; a resume from inside shows the resumed one\'s own, or the defaults', async ($, on) => {
  const clock = mock.clock(on)
  const store = memoryStore(on, { [sessionKey('b')]: storedRecord({ style: 'surf', layout: 'band' }, 0) })
  const seen = engine(on)
  seen.session = 'a'
  await start($)
  await flow($, 'ski')
  // /clear: the conversation ends and the process goes on under a new id, with no session.start.
  await endSession($, 'clear', 'a')
  seen.session = 'c'
  await clock.advance(1000)
  expect(store.get(sessionKey('c'))).toMatchObject({ own: { style: 'ski' } }) // kept under the new id at once
  expect((await flow($)).split('\n')[0]).toMatch(/^ski/)
  // /resume b from inside: b's own, picked up by the next read of the id (no /flow needed).
  await endSession($, 'resume', 'c')
  seen.session = 'b'
  await clock.advance(1000)
  expect(store.get(sessionKey('b'))).toMatchObject({ own: { style: 'surf' }, at: clock.now() }) // marked used
  expect((await flow($)).split('\n')[0]).toMatch(/^surf/)
  // /resume d, which kept nothing: the defaults, as it would show started afresh.
  await endSession($, 'resume', 'b')
  seen.session = 'd'
  expect((await flow($)).split('\n')[0]).toMatch(/^fire/)
  expect(store.has(sessionKey('d'))).toBe(false)
  // c, reloaded (a /config change, an update): still its own.
  seen.session = 'c'
  await start($)
  expect((await flow($)).split('\n')[0]).toMatch(/^ski/)
})

test('sessions: /flow save makes this session\'s settings the default (/config); /flow reset goes back to it', async ($, on) => {
  mock.clock(on)
  const store = memoryStore(on)
  const seen = engine(on, { blits: [], config: [], rows: {} })
  await start($)
  expect((await flow($, 'save')).split('\n\n')[0]).toBe('already your default: new sessions start this way')
  await flow($, 'surf')
  await flow($, '5')
  expect(store.get(sessionKey('session-a'))).toMatchObject({ own: { style: 'surf', mode: 'manual', level: 5 } })
  expect((await flow($, 'save')).split('\n\n')[0]).toBe('saved as your default: new sessions start with surf, holding 5/10')
  expect(seen.config).toContainEqual(['flow-scenes.style', 'surf'])
  expect(seen.config).toContainEqual(['flow-scenes.mode', 'manual'])
  expect(seen.config).toContainEqual(['flow-scenes.level', 5])
  expect(seen.config).toHaveLength(3) // only what differed
  expect(store.has(sessionKey('session-a'))).toBe(false) // nothing of its own now: it is the default
  expect(await flow($)).not.toContain('just this session')
  // Something else, then back to the default.
  await flow($, 'ski')
  expect((await flow($)).split('\n')[1]).toContain('your default: surf')
  expect((await flow($, 'reset')).split('\n\n')[0]).toBe('back to your default: surf')
  expect((await flow($)).split('\n')[0]).toMatch(/^surf, holding 5\/10/)
  expect(store.has(sessionKey('session-a'))).toBe(false)
  expect((await flow($, 'reset')).split('\n\n')[0]).toBe('already on your default')
  // A new session starts on what was saved (/config's rows: the options a new process loads with).
  seen.session = 'session-b'
  await start($)
  expect((await flow($)).split('\n')[0]).toMatch(/^surf, holding 5\/10/)
})

test('sessions: a /config change made in the session is the default, and that row is no longer the session\'s own', async ($, on) => {
  mock.clock(on)
  const store = memoryStore(on)
  engine(on)
  await start($)
  await flow($, 'surf')
  await flow($, 'sound on')
  const set = $.config.set as unknown as (e: object) => Promise<unknown>
  await set({ key: 'flow-scenes.style', value: 'ski', previous: 'fire', provider: { plugin: 'flow-scenes', tier: 'user' }, origin: { kind: 'composer' } })
  expect(store.get(sessionKey('session-a'))).toEqual({ own: { sound: 'on' }, at: 0 })
  const status = await flow($)
  expect(status.split('\n')[0]).toMatch(/^ski, .*sound on at 7\/10$/)
  expect(status).toContain('your default: sound off')
})

test('sessions: only the most recently used are kept, none unused past two months, and always this one', async ($, on) => {
  const day = 24 * 60 * 60 * 1000
  const now = 400 * day
  const clock = mock.clock(on, { now })
  const entries: Record<string, unknown> = { tips: { scenesTold: true } }
  for (let i = 0; i < SESSIONS_KEPT + 20; i++) entries[sessionKey(`s${i}`)] = storedRecord({ style: 'surf' }, now - i * 1000)
  entries[sessionKey('old')] = storedRecord({ style: 'ski' }, now - 61 * day)
  entries[sessionKey('me')] = storedRecord({ style: 'bubbles' }, now - 300 * day) // resumed after a long while
  const store = memoryStore(on, entries)
  const seen = engine(on)
  seen.session = 'me'
  await start($)
  await clock.settle()
  const kept = [...store.keys()].filter(k => k.startsWith('session:'))
  expect(kept).toHaveLength(SESSIONS_KEPT)
  expect(kept).toContain(sessionKey('me'))
  expect(kept).toContain(sessionKey('s0'))
  expect(kept).not.toContain(sessionKey('old'))
  expect(kept).not.toContain(sessionKey(`s${SESSIONS_KEPT + 19}`))
  expect(store.has('tips')).toBe(true)
  expect((await flow($)).split('\n')[0]).toMatch(/^bubbles/)
})

test('sessions: the pure parts (differences, a move to another session, pruning, the words)', () => {
  const defaults = readConfig({ style: 'surf' })
  const cfg = withOwn(defaults, { style: 'ski', level: 3 })
  expect(cfg).toEqual({ ...defaults, style: 'ski', level: 3 })
  expect(differences(cfg, defaults)).toEqual({ style: 'ski', level: 3 })
  // A held level in auto mode doesn't show, so it isn't named as the session's own.
  expect(statusText(withOwn(defaults, { level: 3 }), 2, 'normal', { hour: 12, minute: 0 }, defaults)).not.toContain('just this session')
  expect(statusText(cfg, 2, 'normal', { hour: 12, minute: 0 }, defaults)).toContain('(your default: surf)')
  // Only the change that first sets the session apart says so.
  expect(ownHint(defaults, cfg, defaults)).toContain('/flow save')
  expect(ownHint(cfg, { ...cfg, style: 'fire' }, defaults)).toBe('')
  expect(ownHint(cfg, defaults, defaults)).toBe('')
  expect(savedText(cfg, defaults, true, ['level'])).toBe('saved as your default: new sessions start with ski  (not saved: /config refused level)')
  expect(savedText(cfg, defaults, false, ['style'])).toBe('not saved: /config refused style')
  expect(resetText({ ...defaults, sound: 'on', layout: 'spine' }, defaults)).toBe('back to your default: band, sound off')
  // Moving to another session: its own; a resumed one with none, the defaults; else (a /clear) carried on.
  const record = { own: { style: 'bubbles' as const }, at: 5 }
  expect(ownAfterSwitch(record, { style: 'ski' }, 'clear')).toEqual({ own: { style: 'bubbles' }, carried: false })
  expect(ownAfterSwitch(undefined, { style: 'ski' }, 'resume')).toEqual({ own: {}, carried: false })
  expect(ownAfterSwitch(undefined, { style: 'ski' }, 'clear')).toEqual({ own: { style: 'ski' }, carried: true })
  expect(ownAfterSwitch(undefined, {}, undefined)).toEqual({ own: {}, carried: false })
  // Stored records read back; junk is no record's own.
  expect(readRecord(storedRecord({ idle: 0, style: 'avalon' }, 7))).toEqual({ own: { idle: 0, style: 'avalon' }, at: 7 })
  expect(readRecord({ own: 'x', at: 'y' })).toEqual({ own: {}, at: 0 })
  expect(readRecord(null)).toBeUndefined()
  // Pruning: past the kept count by last use, or too old; never the one asked to keep.
  const recs = Array.from({ length: SESSIONS_KEPT + 2 }, (_, i) => ({ key: `k${i}`, at: 1000 - i }))
  expect(staleSessions(recs, 1000)).toEqual([`k${SESSIONS_KEPT}`, `k${SESSIONS_KEPT + 1}`])
  expect(staleSessions(recs, 1000, `k${SESSIONS_KEPT + 1}`)).toEqual([`k${SESSIONS_KEPT - 1}`, `k${SESSIONS_KEPT}`])
  expect(staleSessions([{ key: 'a', at: 0 }, { key: 'b', at: SESSION_KEPT_MS }], SESSION_KEPT_MS + 1)).toEqual(['a'])
  // The grammar.
  expect(parseFlowArgs('save')).toEqual({ kind: 'save' })
  expect(parseFlowArgs('reset')).toEqual({ kind: 'reset' })
  expect(parseFlowArgs('default').kind).toBe('error')
  expect(changesFor(parseFlowArgs('save'), cfg)).toBeUndefined()
  expect(helpText()).toContain('/flow save')
  expect(helpText("pi's", { panes: false, sound: false })).toContain('/flow reset')
})

test('pi: a session\'s own settings are its latest flow entry on the branch', () => {
  const entry = (id: string, data: unknown, customType = 'flow') => ({ type: 'custom', id, customType, data })
  expect(ownInSession([])).toEqual({})
  expect(ownInSession([entry('1', { own: { style: 'surf' } }), { type: 'message', id: '2' }, entry('3', { own: { style: 'ski', sound: 'on' } }), entry('4', { own: {} }, 'other')])).toEqual({ style: 'ski', sound: 'on' })
  expect(ownInSession([entry('1', { own: { style: 'surf' } }), entry('2', { own: {} })])).toEqual({})
})

// ── The defaults, read afresh ────────────────────────────────────────────

/** One store and one /config, shared by every session (process) on the machine. */
type Shared = { store: Map<string, unknown>; rows: Record<string, unknown> }

/**
 * A Claude Code session in a process of its own, over the shared store and
 * /config: the plugin's `/flow` and its opening of the session, through a
 * host answering just what they call. Nothing here reloads the module when
 * /config changes: whether a host does is its own business.
 */
function sceneSession(shared: Shared, id: string) {
  const json = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
  const $ = {
    session: { id: async () => id },
    store: {
      get: async (k: string) => json(shared.store.get(k)),
      set: async (k: string, v: unknown) => void shared.store.set(k, json(v)),
      delete: async (k: string) => void shared.store.delete(k),
      keys: async () => [...shared.store.keys()],
    },
    config: {
      list: async () => configRows(shared.rows),
      set: async ({ key, value }: { key: string; value: unknown }) => ((shared.rows[key] = value), { value }),
    },
    clock: { now: async () => 0 },
    ui: { invalidate: () => {}, open: async () => ({ isPlaced: true }), close: async () => undefined, panes: async () => [] },
  } as unknown as EngineInterface
  const driver = new SceneDriver(readConfig(undefined), new Activity())
  const ctx: SceneCtx = {
    driver,
    session: { id: undefined, defaults: readConfig(undefined), own: {}, ended: undefined, watch: 0 },
    applyLocal: changes => driver.apply(changes),
    leftSpine: () => {},
    openingPicker: () => {},
    closingPicker: () => false,
  }
  return {
    cfg: driver.cfg,
    open: () => openSession($, ctx, readConfig(undefined)),
    /** `/flow <args>`, its reply without a tip under it (`/flow save` writing its rows as its hook does). */
    flow: async (args: string) => {
      if (args !== 'save') return ((await runScene($, { args } as never, ctx)).text ?? '').split('\n\n')[0]!
      const plan = await planSave($, ctx)
      for (const [field, value] of plan.rows) shared.rows[`flow-scenes.${field}`] = value
      return finishSave($, ctx, plan, [])
    },
  }
}

test('sessions: two at once on one store and one /config: B saves, then A changes and saves exactly what it shows', async () => {
  const shared: Shared = { store: new Map(), rows: {} }
  const a = sceneSession(shared, 'a')
  const b = sceneSession(shared, 'b')
  await a.open()
  await b.open()
  await b.flow('surf')
  expect(await b.flow('save')).toBe('saved as your default: new sessions start with surf')
  expect(shared.rows['flow-scenes.style']).toBe('surf')
  expect(a.cfg.style).toBe('fire') // A carries on as it was
  // A, its defaults read afresh: it still shows the fire, its own now, and saves what it shows.
  expect(await a.flow('night')).toMatch(/^night until `\/flow clock`/)
  expect(await a.flow('save')).toBe('saved as your default: new sessions start with fire, night')
  expect(shared.rows).toMatchObject({ 'flow-scenes.style': 'fire', 'flow-scenes.time': 'night' })
  expect(a.cfg).toMatchObject({ style: 'fire', time: 'night' })
  expect(shared.store.has(sessionKey('a'))).toBe(false)
  // A new session, and A resumed: exactly as A shows.
  const c = sceneSession(shared, 'c')
  await c.open()
  expect(c.cfg).toEqual(a.cfg)
  const a2 = sceneSession(shared, 'a')
  await a2.open()
  expect(a2.cfg).toEqual(a.cfg)
  // B, still running, still shows the surf by day: its own now, and the status says the default moved.
  expect((await b.flow('')).split('\n')[1]).toBe('just this session (your default: fire, night) · `/flow save` makes this the default · `/flow reset` goes back')
  expect(b.cfg).toMatchObject({ style: 'surf', time: 'clock' })
  const b2 = sceneSession(shared, 'b')
  await b2.open()
  expect(b2.cfg).toEqual(b.cfg)
  // Reset goes to the default as it is now.
  expect(await b.flow('reset')).toBe('back to your default: fire, night')
  expect(b.cfg).toEqual(a.cfg)
})

test('sessions: the defaults changing under a running session (another one\'s save) leave it as it is, kept for a resume, with no /flow run there', async ($, on) => {
  const clock = mock.clock(on)
  const store = memoryStore(on)
  const seen = engine(on, { blits: [], config: [], rows: {} })
  seen.session = 'a'
  await start($)
  // Another session saves surf: /config's rows change under this one, which isn't reloaded.
  seen.rows!['flow-scenes.style'] = 'surf'
  await clock.advance(30_000) // read afresh every 30 s
  expect(store.get(sessionKey('a'))).toMatchObject({ own: { style: 'fire' } })
  // And when the session ends.
  seen.rows!['flow-scenes.sound'] = 'on'
  await endSession($, 'prompt_input_exit', 'a')
  expect(store.get(sessionKey('a'))).toEqual({ own: { style: 'fire', sound: 'off' }, at: clock.now() })
  // Resumed: as it was, and it says how the default differs.
  await start($)
  const status = await flow($)
  expect(status.split('\n')[0]).toMatch(/^fire, auto/)
  expect(status.split('\n')[0]).not.toContain('sound on')
  expect(status).toContain('just this session (your default: surf, sound on)')
  // A new session starts on the defaults as they are.
  seen.session = 'b'
  await start($)
  expect((await flow($)).split('\n')[0]).toMatch(/^surf, .*sound on at 7\/10$/)
  // Saved from the first again: /config takes all it shows, so new sessions start just so.
  seen.session = 'a'
  await start($)
  expect((await flow($, 'save')).split('\n\n')[0]).toBe('saved as your default: new sessions start with fire, sound off')
  expect(seen.rows).toMatchObject({ 'flow-scenes.style': 'fire', 'flow-scenes.sound': 'off' })
})

/** flow.json in memory, as PiSettings reads and writes it (`disk.json`: what it holds). */
function flowJson() {
  const disk = {
    json: {} as Record<string, unknown>,
    file: {
      load: async () => readConfig(disk.json),
      save: async (changes: Own) => {
        disk.json = { ...disk.json, ...storedOwn(changes) }
      },
    },
  }
  return disk
}

/** A pi session's entries, in memory. */
function piSession(): SessionEntries & { entries: PiSessionEntry[] } {
  const entries: PiSessionEntry[] = []
  return { entries, branch: () => entries, keep: data => void entries.push({ type: 'custom', id: String(entries.length), customType: 'flow', data }) }
}

test('pi: two sessions on one flow.json: B saves, then A changes and saves exactly what it shows', async () => {
  const disk = flowJson()
  const file = disk.file
  /** `/flow <args>` as the adapter runs it: flow.json read afresh first. */
  const run = async (s: PiSettings, entries: SessionEntries, args: string) => {
    await s.refresh(entries)
    const cmd = parseFlowArgs(args)
    if (cmd.kind === 'save') return (await s.save(entries)).text
    if (cmd.kind === 'reset') return s.reset(entries)
    return s.change(changesFor(cmd, s.cfg) ?? {}, entries)
  }
  const sa = piSession()
  const sb = piSession()
  const a = new PiSettings(readConfig(undefined), file)
  const b = new PiSettings(readConfig(undefined), file)
  await a.open(sa)
  await b.open(sb)
  await run(b, sb, 'surf')
  expect(await run(b, sb, 'save')).toBe('saved as your default: new sessions start with surf')
  expect(disk.json.style).toBe('surf')
  expect(a.cfg.style).toBe('fire')
  await run(a, sa, 'night')
  expect(await run(a, sa, 'save')).toBe('saved as your default: new sessions start with fire, night')
  expect(disk.json).toMatchObject({ style: 'fire', time: 'night' })
  expect(a.cfg).toMatchObject({ style: 'fire', time: 'night' })
  expect(ownInSession(sa.entries)).toEqual({})
  // A new session, and A resumed: exactly as A shows.
  const c = new PiSettings(readConfig(undefined), file)
  await c.open(piSession())
  expect(c.cfg).toEqual(a.cfg)
  const a2 = new PiSettings(readConfig(undefined), file)
  await a2.open(sa)
  expect(a2.cfg).toEqual(a.cfg)
  // B kept the surf by day as its own (for a resume too); reset goes to the default as it is now.
  await b.refresh(sb)
  expect(ownInSession(sb.entries)).toEqual({ style: 'surf', time: 'clock' })
  expect(statusText(b.cfg, 1, 'normal', { hour: 12, minute: 0 }, b.defaults)).toContain('(your default: fire, night)')
  expect(await run(b, sb, 'reset')).toBe('back to your default: fire, night')
  expect(b.cfg).toEqual(a.cfg)
  // An older pi without session entries: one set for every session, in flow.json, as before.
  const old = new PiSettings(readConfig(undefined), file)
  await old.open(undefined)
  await old.change({ style: 'ski' }, undefined)
  expect(disk.json.style).toBe('ski')
})

test("pi: the volume is a session's own too: /flow sound 4 in one leaves the other, and flow.json, as they were", async () => {
  const disk = flowJson()
  const file = disk.file
  const sa = piSession()
  const sb = piSession()
  const a = new PiSettings(readConfig(undefined), file)
  const b = new PiSettings(readConfig(undefined), file)
  await a.open(sa)
  await b.open(sb)
  expect(await a.change(changesFor(parseFlowArgs('sound 4'), a.cfg) ?? {}, sa)).toContain('just this session')
  expect(a.cfg).toMatchObject({ sound: 'on', volume: 4 })
  expect(ownInSession(sa.entries)).toEqual({ sound: 'on', volume: 4 })
  expect(b.cfg).toMatchObject({ sound: 'off', volume: 7 })
  expect(disk.json).toEqual({})
  // Resumed: its own volume back.
  const a2 = new PiSettings(readConfig(undefined), file)
  await a2.open(sa)
  expect(a2.cfg.volume).toBe(4)
  // Saved: flow.json's; B shows what it showed (its own now) until it's reset.
  expect((await a.save(sa)).text).toBe('saved as your default: new sessions start with sound on, volume 4/10')
  expect(disk.json).toMatchObject({ sound: 'on', volume: 4 })
  await b.refresh(sb)
  expect(b.cfg).toMatchObject({ sound: 'off', volume: 7 })
  expect(b.reset(sb)).toBe('back to your default: sound on, volume 4/10')
  expect(b.cfg).toMatchObject({ sound: 'on', volume: 4 })
})

test('sessions: what a session shows that the defaults no longer hold becomes its own; what it set, or shows as the default, stays as it was', () => {
  const was = readConfig(undefined)
  const now = readConfig({ style: 'surf', sound: 'on', level: 3 })
  const shown = withOwn(was, { level: 5 })
  expect(pinShown(shown, { level: 5 }, now)).toEqual({ own: { level: 5, style: 'fire', sound: 'off' }, pinned: true })
  expect(pinShown(withOwn(now, { level: 5 }), { level: 5 }, now)).toEqual({ own: { level: 5 }, pinned: false })
})

test('ski: the skier never drops out of its own cells, even with fast scenery behind it at night', async () => {
  const HAT = 0xffd23f
  const JACKET = 0xe8302c
  const PANTS = 0x1f2a50
  for (const night of [false, true]) {
    const f = makeScene('ski', 7) as ReturnType<typeof makeScene> & { skiers: { fx: number }[]; d: number }
    f.strength = 10
    f.night = night
    f.ensure(60, 5)
    for (let i = 0; i < 200; i++) f.step()
    for (let k = 0; k < 200; k++) {
      f.step()
      const g = f.grid()
      const cell = Math.round((f.skiers[0]!.fx - f.d) / 2)
      const seen = new Set<number>()
      for (let r = 0; r < 5; r++)
        for (let c = cell - 3; c <= cell + 3; c++) seen.add(g.foreground(r * 60 + c)).add(g.background(r * 60 + c))
      expect(seen.has(HAT) && seen.has(JACKET) && seen.has(PANTS)).toBe(true)
    }
  }
})


test('avalon: each strike is sent ahead of its flash by the player start-up time, once a rock', () => {
  const f = makeScene('avalon', 3) as unknown as { ensure(c: number, r: number): void; step(): void; strength: number; hits: { age: number }[]; sounds: { kind: string }[] }
  f.ensure(120, 5)
  f.strength = 10
  const sent: number[] = []
  const flashed: number[] = []
  for (let i = 0; i < 3000; i++) {
    f.step()
    for (const e of f.sounds) if (e.kind === 'hit') sent.push(i)
    f.sounds.length = 0
    // (Old flashes age out as new ones land: count the new ones by their age.)
    for (const h of f.hits) if (h.age === 0) flashed.push(i)
  }
  expect(sent.length).toBeGreaterThan(20)
  expect(sent.length).toBe(flashed.length)
  const leads = sent.map((at, n) => flashed[n]! - at)
  const want = PLAYER_LEAD_MS / 70
  for (const l of leads) expect(l >= 0 && l <= Math.ceil(want) + 1).toBe(true)
  expect(leads.filter(l => Math.abs(l - want) <= 1.5).length).toBeGreaterThan(leads.length * 0.8)
})

test('train: waits at a red signal at 1; when the work starts the horn sounds and it pulls away; its speed climbs with the level, steeply at the top; idle again, it pulls up', () => {
  const t = makeScene('train', 3) as Train
  const heard = (frames: number, level: number) => {
    t.strength = level
    const kinds: string[] = []
    for (let i = 0; i < frames; i++) {
      t.step()
      kinds.push(...t.sounds.map(e => e.kind))
      t.sounds.length = 0
    }
    return kinds
  }
  t.ensure(120, 5)
  heard(60, 1)
  expect(t.standing).toBe(true)
  expect(heard(40, 5)).toContain('horn')
  expect(t.standing).toBe(false)
  // Each level runs faster than the one below, the top far faster than the middle.
  const speeds: number[] = []
  for (const level of [2, 3, 5, 7, 8, 9, 10]) {
    heard(400, level)
    speeds.push(t.speed)
  }
  for (let i = 1; i < speeds.length; i++) expect(speeds[i]!).toBeGreaterThan(speeds[i - 1]!)
  expect(speeds.at(-1)!).toBeGreaterThan(speeds[2]! * 5)
  // From a stand to the top in a sensible time (a train gathers speed; not a minute of it).
  heard(3000, 1)
  expect(t.standing).toBe(true)
  heard(12, 10)
  heard(170, 10)
  expect(t.speed).toBeGreaterThan(speeds.at(-1)! * 0.95)
  // The work done, it slows and comes to a stand, and stays there.
  heard(3000, 1)
  expect(t.standing).toBe(true)
  expect(t.speed).toBe(0)
})

test('train: subagents run alongside, drawing up from out of sight, and fall back out of it when they finish', () => {
  for (const [columns, rows] of [[160, 5], [22, 60]] as const) {
    const t = makeScene('train', 4) as Train
    t.strength = 6
    t.ensure(columns, rows)
    for (let i = 0; i < 20; i++) t.step()
    t.coverageBoost = 30
    for (let i = 0; i < 4; i++) t.step()
    expect(t.company).toBe(0) // still out of sight: nothing pops in
    for (let i = 0; i < 600; i++) t.step()
    expect(t.company).toBe(2)
    t.coverageBoost = 0
    for (let i = 0; i < 600; i++) t.step()
    expect(t.company).toBe(0)
  }
})
// ── Waiting on the person ────────────────────────────────────────────────

test('waiting on the person: a question shows at once; a permission ask only once its dialog is up (auto mode settles most alone)', () => {
  const h = new Activity()
  h.turnStarted()
  h.modelStep('high')
  h.heat = 3
  const working = h.strength(1)
  expect(working).toBeGreaterThan(WAIT_LEVEL)
  // A permission ask: the turn's clock stops, but no one's asked yet (the classifier may settle it).
  h.waitingOn('toolu_1', false, 'Bash')
  expect(h.isWaiting).toBe(true)
  expect(h.isAwaitingPerson).toBe(false)
  expect(h.strength(1)).toBe(working)
  // Its dialog shows: now it waits on the person, and the level settles.
  h.prompted('Bash')
  expect(h.isAwaitingPerson).toBe(true)
  expect(h.strength(1)).toBe(WAIT_LEVEL)
  h.answered('toolu_1', 'Bash')
  expect(h.isAwaitingPerson).toBe(false)
  expect(h.strength(1)).toBe(working)
  // Claude's question is put to the person from the start; the turn ending forgets it.
  h.waitingOn('toolu_2', true, 'AskUserQuestion')
  expect(h.isAwaitingPerson).toBe(true)
  h.turnEnded()
  expect(h.isAwaitingPerson).toBe(false)
})

test("waiting on the person: a dialog takes its own loop's ask, never another's, and one seen with no ask before it lasts till a call of its tool in its loop ends", () => {
  const h = new Activity()
  h.turnStarted()
  h.waitingOn('main', false, 'Bash')
  h.waitingOn('sub', false, 'Bash', 'agent-1')
  h.prompted('Bash', 'agent-1')
  h.answered('main', 'Bash')
  expect(h.isAwaitingPerson).toBe(true) // the subagent's call still waits on its dialog
  h.answered('sub', 'Bash')
  expect(h.isAwaitingPerson).toBe(false)
  h.prompted('WebFetch')
  expect(h.isAwaitingPerson).toBe(true)
  h.answered('toolu_9', 'WebFetch')
  expect(h.isAwaitingPerson).toBe(false)
  // A dialog in a loop with no ask of its own isn't the main loop's ask: that one is still with the decider.
  h.waitingOn('main2', false, 'Bash')
  h.prompted('Bash', 'agent-2')
  h.answered('toolu_x', 'Bash', 'agent-2') // a call of Bash in agent-2 ends: its dialog with it
  expect(h.isAwaitingPerson).toBe(false)
  // ...while a call of the tool in another loop ending leaves it up.
  h.prompted('Bash', 'agent-2')
  h.answered('main2', 'Bash')
  expect(h.isAwaitingPerson).toBe(true)
})

test("waiting on the person: a dialog is its own call's, so another call of the tool in its loop ending or running never ends it", () => {
  const h = new Activity()
  h.turnStarted()
  // Two commands at once in the main loop (their arguments as tool.call has them, beside the envelope);
  // the second one's dialog shows (it names only the tool and its input).
  h.called('tu1', 'Bash', undefined, { tool: 'Bash', tool_use_id: 'tu1', command: 'ls' })
  h.called('tu2', 'Bash', undefined, { tool: 'Bash', tool_use_id: 'tu2', command: 'rm -rf build' })
  h.prompted('Bash', undefined, { command: 'rm -rf build' })
  expect(h.isAwaitingPerson).toBe(true)
  h.answered('tu1') // the first shows its progress pill
  expect(h.isAwaitingPerson).toBe(true)
  h.answered('tu1', 'Bash') // ...and ends
  expect(h.isAwaitingPerson).toBe(true)
  h.answered('tu2') // approved, the second runs
  expect(h.isAwaitingPerson).toBe(false)
  // A subagent's two calls: with no input to go by, the dialog is its oldest call not already waiting.
  h.called('tu3', 'Bash', 'a')
  h.called('tu4', 'Bash', 'a')
  h.prompted('Bash', 'a')
  h.prompted('Bash', 'a')
  h.answered('tu3', 'Bash', 'a')
  expect(h.isAwaitingPerson).toBe(true) // tu4's dialog is still up
  h.answered('tu4', 'Bash', 'a')
  expect(h.isAwaitingPerson).toBe(false)
})

test('the driver gives the scene its subagents in manual mode too: a held level, the company still shows', () => {
  const a = new Activity()
  const d = new SceneDriver(readConfig({ style: 'surf', mode: 'manual', level: 4 }), a)
  a.roster.listed([{ id: 'ag1', status: 'running', type: 'Explore', description: 'map it' }])
  const f = d.dial()
  expect(f.agents?.map(x => x.id)).toEqual(['ag1'])
  expect(f.strength).toBe(4) // the level stays held
})

test('the driver shows waiting in auto mode only (as it does the tints), settling the level to 2', () => {
  const a = new Activity()
  const d = new SceneDriver(readConfig({ style: 'surf' }), a)
  a.turnStarted()
  a.heat = 4
  a.waitingOn('toolu_q', true, 'AskUserQuestion')
  expect(d.waiting()).toBe(true)
  expect(d.dial().waiting).toBe(true)
  expect(d.level()).toBe(WAIT_LEVEL)
  d.apply({ mode: 'manual', level: 7 })
  expect(d.dial().waiting).toBe(false)
  expect(d.level()).toBe(7)
})

test("the waiting look: eases in over about a second, breathes every ~4 s, keeps the terminal's own color, maps colors one to one", () => {
  let k = 0
  let frames = 0
  while (k < 1) {
    k = easeWait(k, true)
    frames++
  }
  expect(frames).toBeGreaterThan(10)
  expect(frames).toBeLessThan(25)
  expect(easeWait(1, false)).toBeGreaterThan(0.9) // out again, gently
  expect(Math.abs(breath(0))).toBeLessThan(1e-9) // out
  expect(Math.abs(breath(BREATH_FRAMES / 2) - 1)).toBeLessThan(1e-9) // in, half a breath on
  for (let t = -BREATH_FRAMES; t < 2 * BREATH_FRAMES; t++) expect(breath(t) >= 0 && breath(t) <= 1).toBe(true)
  const g = new Cells(4, 1)
  g.set(0, 0x2588, 0x2f7fd0, 0xa9daf4) // sky
  g.set(1, 0x2588, 0xeef4fb) // snow, over the terminal's own background
  g.blank(2)
  g.set(3, 0x2588, 0x2f7fd0, 0xa9daf4) // the same pair again
  waitTone(g, 1, BREATH_FRAMES / 2)
  expect(g.background(1)).toBe(DEFAULT)
  expect(g.foreground(2)).toBe(DEFAULT)
  expect([g.foreground(3), g.background(3)]).toEqual([g.foreground(0), g.background(0)])
  for (const c of [g.foreground(0), g.background(0), g.foreground(1)]) expect((c >> 16) & 255).toBeGreaterThan(c & 255) // sepia: warm
  const none = new Cells(1, 1)
  none.set(0, 0x2588, 0x123456)
  waitTone(none, 0, 3)
  expect(none.foreground(0)).toBe(0x123456)
})

/** Mean warmth (red less blue) and brightness of a frame's painted colors. */
function tone(g: Cells): { warm: number; light: number } {
  let n = 0
  let warm = 0
  let light = 0
  for (let i = 0; i < g.columns * g.rows; i++)
    for (const c of [g.foreground(i), g.background(i)]) {
      if (c === DEFAULT) continue
      warm += ((c >> 16) & 255) - (c & 255)
      light += ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11
      n++
    }
  return { warm: n ? warm / n : 0, light: n ? light / n : 0 }
}

test('every scene shows waiting on the person, by day and night, in the band and the spine: warm and breathing, unlike smoke or blue', () => {
  for (const def of SCENES)
    for (const [columns, rows] of [
      [90, 5],
      [16, 40],
    ] as const)
      for (const night of def.night ? [false, true] : [false]) {
        // From work at 6 down to the calm 2: plainly, with each tint, or waiting on the person.
        const settle = (tint: 'normal' | 'smoke' | 'blue', waiting: boolean) => {
          const f = makeScene(def.name, 5)
          f.strength = 6
          f.tint = tint
          f.night = night
          f.ensure(columns, rows)
          for (let i = 0; i < 60; i++) f.step()
          f.waiting = waiting
          f.strength = WAIT_LEVEL
          for (let i = 0; i < 30; i++) f.step()
          return f
        }
        const plain = [settle('normal', false), settle('smoke', false), settle('blue', false)].map(f => f.grid())
        const f = settle('normal', true)
        const breathing: { warm: number; light: number }[] = []
        let coals = 0
        for (let i = 0; i < BREATH_FRAMES; i += 4) {
          for (let k = 0; k < 4; k++) f.step()
          const g = f.grid()
          breathing.push(tone(g))
          if (def.name === 'fire') {
            let lit = 0
            for (let x = 0; x < columns; x++) if (g.codePoint((rows - 1) * columns + x) !== 0x20) lit++
            coals = Math.max(coals, lit / columns)
          }
        }
        const where = `${def.name} ${columns}×${rows}${night ? ' night' : ''}`
        const light = breathing.map(b => b.light)
        // It breathes: brighter and dimmer by a good part over each breath.
        expect({ where, breath: (Math.max(...light) - Math.min(...light)) / Math.max(...light) > 0.12 }).toEqual({ where, breath: true })
        if (def.name === 'fire') {
          // The fire banks: a bed of coals right along the bottom (it's warm already: no sepia).
          expect({ where, coals: coals > 0.9 }).toEqual({ where, coals: true })
          continue
        }
        const warmest = Math.max(...breathing.map(b => b.warm))
        for (const [n, g] of plain.entries()) expect({ where, n, warmer: warmest > tone(g).warm + 15 }).toEqual({ where, n, warmer: true })
      }
})

test('waiting holds each scene where it is: the balloon hovers, a rocket keeps its stage, the skier stops, the engine and the stars come to rest, the surfer sits up', () => {
  const balloon = new Balloon(3)
  balloon.ensure(60, 5)
  balloon.strength = 8
  for (let i = 0; i < 400; i++) balloon.step()
  const high = balloon.altitude
  balloon.waiting = true
  balloon.strength = WAIT_LEVEL
  for (let i = 0; i < 300; i++) balloon.step()
  expect(balloon.altitude).toBeGreaterThan(high * 0.85) // it eases to a hover, it doesn't come down
  balloon.waiting = false
  for (let i = 0; i < 400; i++) balloon.step()
  expect(balloon.altitude).toBeLessThan(high * 0.5) // the wait over, it follows the level again

  const flying = new Falcon(3)
  flying.ensure(60, 5)
  flying.strength = 6
  flying.step() // a fresh start resumes as asked
  flying.waiting = true
  for (let i = 0; i < 100; i++) {
    flying.strength = WAIT_LEVEL
    flying.step()
  }
  expect(flying.strength).toBe(6) // held, not brought home
  const parked = new Falcon(3)
  parked.ensure(60, 5)
  parked.strength = 1
  parked.step()
  parked.waiting = true
  for (let i = 0; i < 100; i++) {
    parked.strength = WAIT_LEVEL
    parked.step()
  }
  expect(parked.strength).toBe(1) // nor launched off the pad

  const at = (name: SceneName, frames: number) => {
    const f = makeScene(name, 3)
    f.ensure(90, 5)
    f.strength = 7
    for (let i = 0; i < 120; i++) f.step()
    f.waiting = true
    f.strength = WAIT_LEVEL
    for (let i = 0; i < frames; i++) f.step()
    return f
  }
  expect(at('ski', 120).ambience!().wind).toBeLessThan(0.01)
  const engine = at('engine', 200) as unknown as { omega: number }
  expect(engine.omega).toBeLessThan(0.002)
  const warp = at('warp', 60) as unknown as { stars: { z: number }[]; step(): void }
  const z = warp.stars.map(s => s.z)
  warp.step()
  expect(warp.stars.map(s => s.z)).toEqual(z)
  const surf = at('surf', 200) as unknown as { pose(): string }
  expect(surf.pose()).toBe('sit')
})

test('the chime: once a wait, a moment in; not for a wait right behind another; again after a quiet spell', () => {
  const s = newChimeState()
  let now = 0
  const run = (waiting: boolean, ms: number) => {
    let n = 0
    for (let t = 0; t < ms; t += 70) {
      now += 70
      if (chimeStep(s, waiting, now)) n++
    }
    return n
  }
  expect(run(false, 2000)).toBe(0)
  expect(run(true, CHIME_DELAY_MS - 150)).toBe(0) // not at once: a wait answered straight off never chimes
  expect(run(true, 5000)).toBe(1) // once
  expect(run(false, 3000)).toBe(0)
  expect(run(true, 5000)).toBe(0) // right behind the last: you're there already
  expect(run(false, CHIME_QUIET_MS + 1000)).toBe(0)
  expect(run(true, 5000)).toBe(1)
  const files = new Set(SOUND_FILES)
  for (let seed = 0; seed < 12; seed++) {
    const p = chimePlay(seed)
    expect(files.has(p.asset)).toBe(true)
    expect(p.gain).toBeLessThanOrEqual(1.4)
  }
})

test("sound on: a soft chime as Claude's question waits on you, once; none for another right behind it", { options: { sound: 'on', style: 'bubbles' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  let answer: (() => void) | undefined
  on('tool.call', () => new Promise(r => (answer = () => r({ result: {} as never }))))
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  const chimes = () => (seen.plays ?? []).filter(p => p.includes('events/chime')).length
  await clock.advance(2000)
  expect(chimes()).toBe(0)
  const first = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await clock.advance(2000)
  expect(chimes()).toBe(1)
  await clock.advance(4000)
  expect(chimes()).toBe(1) // once a wait
  answer!()
  await first
  await clock.advance(2000)
  const second = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await clock.advance(3000)
  expect(chimes()).toBe(1)
  answer!()
  await second
  await ui.unmount()
})

test('a permission dialog (not an ask auto mode settles alone) is what waits on you: it chimes, and ends with its call', { options: { sound: 'on', style: 'bubbles' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  let finish: (() => void) | undefined
  on('tool.call', () => new Promise(r => (finish = () => r({ result: {} as never }))))
  // No settings hook answers it for the person: the dialog shows.
  on('classic.PermissionRequest', () => ({}))
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  const chimes = () => (seen.plays ?? []).filter(p => p.includes('events/chime')).length
  const call = $.tool.call({ tool: 'Bash', command: 'make' } as never)
  await clock.advance(2000)
  expect(chimes()).toBe(0) // a command running is no wait on you
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'make' } } as never)
  await clock.advance(2000)
  expect(chimes()).toBe(1)
  finish!()
  await call
  // Its wait ended with the call: a dialog a while later is a new wait, and chimes again.
  await clock.advance(CHIME_QUIET_MS + 2000)
  const next = $.tool.call({ tool: 'Bash', command: 'make test' } as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'make test' } } as never)
  await clock.advance(2000)
  expect(chimes()).toBe(2)
  finish!()
  await next
  await ui.unmount()
})

test("a permission dialog is its own call's: another command running beside it ending, or showing progress, never ends it", { options: { sound: 'on', style: 'bubbles' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  const finish = new Map<string, () => void>()
  on('tool.call', ($, e) => new Promise(r => finish.set((e as { tool_use_id: string }).tool_use_id, () => r({ result: {} as never }))))
  on('classic.PermissionRequest', () => ({}))
  on('ui.render', { component: 'ToolProgress' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: e.props.hint })
  })
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  const chimes = () => (seen.plays ?? []).filter(p => p.includes('events/chime')).length
  // Two commands at once in the main loop, as tool.call carries them (the arguments beside the envelope).
  const make = $.tool.call({ tool: 'Bash', command: 'make', tool_use_id: 'tu1' } as never)
  const rm = $.tool.call({ tool: 'Bash', command: 'rm -rf build', tool_use_id: 'tu2' } as never)
  // The second one's dialog shows; then the first shows its progress pill and ends.
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } } as never)
  const pill = await $.ui.mount({
    plugin: 'flow-scenes',
    surface: 'terminal',
    component: 'ToolProgress',
    requestId: 'tu1',
    props: { tool_use_id: 'tu1', kind: 'background_hint', hint: '(ctrl+b to run in background)' },
  } as never)
  await pill.unmount()
  finish.get('tu1')!()
  await make
  await clock.advance(2000)
  expect(chimes()).toBe(1) // the dialog is still up: it waits on you
  finish.get('tu2')!()
  await rm
  // Its wait ended with its own call: a dialog a while later is a new wait, and chimes again.
  await clock.advance(CHIME_QUIET_MS + 2000)
  const next = $.tool.call({ tool: 'Bash', command: 'make test', tool_use_id: 'tu3' } as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'make test' } } as never)
  await clock.advance(2000)
  expect(chimes()).toBe(2)
  finish.get('tu3')!()
  await next
  await ui.unmount()
})

test("sessions: a wait is its own session's: the chime follows that session's sound, and a wait left open as the process moves on isn't carried over", async ($, on) => {
  const clock = mock.clock(on)
  memoryStore(on, { [sessionKey('b')]: storedRecord({ sound: 'on' }, 0) })
  const seen = engine(on)
  const answers: (() => void)[] = []
  on('tool.call', () => new Promise(r => answers.push(() => r({ result: {} as never }))))
  seen.session = 'a'
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  const chimes = () => (seen.plays ?? []).filter(p => p.includes('events/chime')).length
  // Session a (sound off, the default): its question waits, unheard.
  const open = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await clock.advance(2000)
  expect(chimes()).toBe(0)
  // The process moves on to b (a resume from inside), a's question never answered: nothing waits in b.
  await endSession($, 'resume', 'a')
  seen.session = 'b'
  await clock.advance(CHIME_QUIET_MS + 2000)
  expect((await flow($)).split('\n')[0]).toMatch(/sound on at 7\/10$/) // b's own settings
  expect(chimes()).toBe(0)
  // b's own question: b's sound is on and the wait is new, so it chimes.
  const asked = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await clock.advance(2000)
  expect(chimes()).toBe(1)
  for (const answer of answers) answer()
  await Promise.all([open, asked])
  await ui.unmount()
})

test('train: waiting on the person, it draws up at a red signal or a platform and stands, its lamps shining through the sepia; answered, the horn and away', () => {
  for (const [columns, rows] of [[120, 5], [22, 60]] as const)
    for (const seed of [3, 8]) {
      const t = makeScene('train', seed) as Train
      const where = `${columns}×${rows} seed ${seed}`
      const run = (frames: number, level: number, waiting: boolean) => {
        t.strength = level
        t.waiting = waiting
        const kinds: string[] = []
        for (let i = 0; i < frames; i++) {
          t.step()
          kinds.push(...t.sounds.map(e => e.kind))
          t.sounds.length = 0
        }
        return kinds
      }
      t.ensure(columns, rows)
      run(300, 6, false)
      expect(t.standing).toBe(false)
      // A wait: the level settles to 2, which would run on; waiting, it pulls up and stands.
      run(900, WAIT_LEVEL, true)
      expect({ where, standing: t.standing }).toEqual({ where, standing: true })
      run(200, WAIT_LEVEL, true)
      expect({ where, standing: t.standing }).toEqual({ where, standing: true })
      // At a signal, its red lamp keeps its color in the sepia (a platform has no signal).
      const held = (t as unknown as { held: number | undefined }).held
      if (held !== undefined) {
        const g = t.grid()
        let red = 0
        for (let i = 0; i < columns * rows; i++)
          for (const c of [g.foreground(i), g.background(i)]) if (((c >> 16) & 255) > 160 && ((c >> 8) & 255) < 120 && (c & 255) < 120) red++
        expect({ where, red: red > 0 }).toEqual({ where, red: true })
      }
      // Answered: the signal clears, the horn, and away.
      expect(run(60, 5, false)).toContain('horn')
      expect(t.standing).toBe(false)
    }
})

// ── The picker (/flow pick) ──────────────────────────────────────────────

/** The picker's pane as a docked terminal pane draws it (two thumbnails across). */
const PICK_PANE = {
  component: 'Pane',
  requestId: 'flow-pick',
  props: { title: 'flow: pick a scene', isFocused: true, bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 44 }, view: {} },
} as const

/** Stand for the engine's panes: what opens and closes, and with what. */
function panes(on: On) {
  const seen = { open: new Set<string>(), opens: [] as Record<string, unknown>[], closes: [] as string[] }
  on('ui.open', (_, e) => {
    const args = e as unknown as Record<string, unknown>
    seen.open.add(args.id as string)
    seen.opens.push(args)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    seen.open.delete((e as { id: string }).id)
    seen.closes.push(`${(e as { id: string }).id}:${(e as { origin: { kind: string } }).origin.kind}`)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...seen.open].map(id => ({ id })) as never }))
  return seen
}

test('/flow pick: the grammar, the help, and where the status points', () => {
  expect(parseFlowArgs('pick')).toEqual({ kind: 'pick' })
  expect(parseFlowArgs(' PICK ')).toEqual({ kind: 'pick' })
  expect(parseFlowArgs('pick surf').kind).toBe('error') // a scene by name is `/flow surf`
  expect(changesFor({ kind: 'pick' }, readConfig({}))).toBeUndefined()
  expect(helpText()).toContain('/flow pick')
  expect(helpText("pi's", { panes: false, sound: false })).toContain('/flow pick')
  expect(helpText("pi's", { panes: false, sound: false })).not.toContain('spine')
  expect(statusText(readConfig({}), 3, 'normal', { hour: 12, minute: 0 })).toContain('`/flow pick`')
  // The one-time scenes tip names it too.
  expect(nextTip({}, readConfig({})).tip).toContain('`/flow pick`')
})

test("picker layout: fits the room it has, thumbnails at the band's 5 rows where they can be, a list where nothing fits", () => {
  const label = labelWidth()
  for (let columns = 8; columns <= 260; columns += 7) {
    for (let rows = 4; rows <= 70; rows += 3) {
      const l = pickLayout(columns, rows, STYLES.length)
      if (!l) continue
      const frame = l.framed ? 2 : 0
      // Never wider or taller than the body, never narrower than a label.
      expect(l.across * (l.columns + frame) + (l.across - 1)).toBeLessThanOrEqual(columns)
      expect(l.height).toBeLessThanOrEqual(rows)
      expect(Math.ceil(STYLES.length / l.across) * (l.rows + 1 + frame) + (l.lines ? 2 : 0)).toBe(l.height)
      expect(l.columns).toBeGreaterThanOrEqual(label)
      expect(l.columns).toBeLessThanOrEqual(40)
      expect([3, 4, 5]).toContain(l.rows)
    }
  }
  // A docked pane two thumbnails wide: framed, two across, each wide enough to read.
  const dock = pickLayout(64, 44, STYLES.length)!
  expect(dock).toMatchObject({ across: 2, framed: true, lines: true })
  expect(dock.columns).toBeGreaterThanOrEqual(20)
  // A wide, short inline pane: the band's 5 rows, many across.
  const wide = pickLayout(200, 20, STYLES.length)!
  expect(wide.rows).toBe(5)
  expect(wide.across).toBeGreaterThanOrEqual(5)
  // Narrower than a label: no room for thumbnails, so a plain list (a spine-width dock gets small ones).
  expect(pickLayout(10, 50, STYLES.length)).toBeUndefined()
  // Inline it asks for no more than it needs, and never a whole screen.
  expect(pickRows(80)).toBeLessThanOrEqual(28)
  expect(pickRows(200)).toBeLessThan(pickRows(80))
  // Number keys for the first ten scenes; keys name scenes and nothing else.
  expect([0, 8, 9, 10].map(hotkeyFor)).toEqual(['1', '9', '0', undefined])
  expect(sceneOfKey('pick:surf')).toBe('surf')
  expect(sceneOfKey('pick:nope')).toBeUndefined()
  expect(sceneOfKey('thumb:surf')).toBeUndefined()
})

test('picker thumbnails: every scene, lit at its level from the first frame, moving, by day or night', () => {
  const t = new Thumbnails(5)
  t.ensure(24, 5)
  for (const style of STYLES) {
    const g = t.grid(style)!
    expect([g.columns, g.rows]).toEqual([24, 5])
    let lit = 0
    for (let i = 0; i < g.words.length; i += 3) if (g.words[i] !== 0x20) lit++
    expect(lit).toBeGreaterThan(0) // warmed up: never a blank tile on opening
  }
  const before = STYLES.map(s => t.frame(s))
  for (let i = 0; i < 5; i++) t.step()
  const moved = STYLES.filter((s, i) => t.frame(s) !== before[i])
  expect(moved.length).toBeGreaterThanOrEqual(STYLES.length - 1)
  t.night = true
  t.step()
  expect(PICK_LEVEL).toBeGreaterThan(1)
  t.clear()
  expect(t.isBuilt).toBe(false)
  expect(t.frame('surf')).toBe('')
})

test('/flow pick opens a dialog of live thumbnails; Enter on one picks it, as /flow <scene> would, and closes it', { options: { mode: 'manual', level: 5 } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  const pane = panes(on)
  await start($)
  expect(await flow($, 'pick')).toContain('Esc closes')
  const opened = pane.opens.find(o => o.id === 'flow-pick')!
  expect(opened).toMatchObject({ focus: true, closeOnEscape: true, holdToasts: true })
  expect(pane.open.has('flow-pick')).toBe(true)

  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...PICK_PANE })
  // A Raster and a Button for every scene; the ring starts on the scene on show, marked.
  expect(await ui.findAll({ type: 'Raster' })).toHaveLength(STYLES.length)
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.key)).toEqual(STYLES.map(s => `pick:${s}`))
  const fire = await ui.find({ key: 'pick:fire' })
  expect(fire?.props.label).toBe('fire ●')
  expect(fire?.props.autoFocus).toBe(true)
  expect(fire?.props.hotkey).toBe('1')
  // The thumbnails move: each its own blit, about ten a second.
  seen.blitKeys = []
  await clock.advance(1000)
  const thumbs = seen.blitKeys.filter(k => k.startsWith('flow-pick/'))
  expect(new Set(thumbs)).toEqual(new Set(STYLES.map(s => `flow-pick/thumb:${s}`)))
  expect(thumbs.length).toBeGreaterThanOrEqual(STYLES.length * 8)
  expect(thumbs.length).toBeLessThanOrEqual(STYLES.length * 11)

  // Enter on surf: `/flow surf`'s own reply, as a toast once the picker's gone (the first change, so with the hint).
  seen.toasts = []
  await ui.press({ key: 'pick:surf' })
  expect((await flow($)).split('\n')[0]).toContain('surf, holding 5/10')
  expect(pane.closes).toContain('flow-pick:plugin')
  expect(seen.toasts).toHaveLength(1)
  const [said, hint] = seen.toasts![0]!.split('\n')
  expect(said).toMatch(/^surf, (day|night) .*· `\/flow next` for another$/)
  expect(hint).toBe('just this session · `/flow save` makes it your default for new sessions')
  expect(seen.config).toEqual([]) // this session's own, never /config
  // Closed, its thumbnails stop.
  seen.blitKeys = []
  await clock.advance(1000)
  expect(seen.blitKeys.filter(k => k.startsWith('flow-pick/'))).toEqual([])
  await ui.unmount()
  // And it outlasts a reload.
  await start($)
  expect((await flow($)).split('\n')[0]).toContain('surf')
})

test('the picker: a scene picked in one session is that session\'s alone; another, on the same store, keeps the default', async ($, on) => {
  mock.clock(on)
  const store = memoryStore(on)
  const seen = engine(on)
  panes(on)
  seen.session = 'a'
  await start($)
  await flow($, 'pick')
  let ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...PICK_PANE })
  await ui.press({ key: 'pick:ski' })
  await ui.unmount()
  expect(store.get(sessionKey('a'))).toMatchObject({ own: { style: 'ski' } })
  expect(store.has('overrides')).toBe(false)
  expect(seen.config).toEqual([])
  // Session B (another process on the same store): the default, and the picker marks it.
  seen.session = 'b'
  await start($)
  const b = await flow($)
  expect(b.split('\n')[0]).toMatch(/^fire, auto/)
  expect(b).not.toContain('just this session')
  expect(store.has(sessionKey('b'))).toBe(false)
  await flow($, 'pick')
  ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...PICK_PANE })
  expect((await ui.find({ key: 'pick:fire' }))?.props.label).toBe('fire ●')
  expect((await ui.find({ key: 'pick:ski' }))?.props.label).toBe('ski')
  await ui.unmount()
})

test('the picker: a scene picked comes back when the session is resumed, marked as the one on show', async ($, on) => {
  mock.clock(on)
  const store = memoryStore(on)
  const seen = engine(on)
  panes(on)
  seen.session = 'a'
  await start($)
  await flow($, 'pick')
  let ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...PICK_PANE })
  await ui.press({ key: 'pick:balloon' })
  await ui.unmount()
  // Another session runs meanwhile, picking its own.
  seen.session = 'b'
  await start($)
  await flow($, 'pick')
  ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...PICK_PANE })
  await ui.press({ key: 'pick:surf' })
  await ui.unmount()
  // A resumed: its balloon, which the picker marks; B's surf is B's.
  seen.session = 'a'
  await start($)
  expect((await flow($)).split('\n')[0]).toMatch(/^balloon, /)
  await flow($, 'pick')
  ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...PICK_PANE })
  expect((await ui.find({ key: 'pick:balloon' }))?.props).toMatchObject({ label: 'balloon ●', autoFocus: true })
  expect((await ui.find({ key: 'pick:surf' }))?.props.label).toBe('surf')
  await ui.unmount()
  expect(store.get(sessionKey('b'))).toMatchObject({ own: { style: 'surf' } })
})

test('the picker: the focus ring moving (the arrows, Tab) lights its tile and names its scene', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  panes(on)
  on('ui.focus', () => ({}))
  await start($)
  await flow($, 'pick')
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...PICK_PANE })
  expect((await ui.find({ key: 'tile:fire' }))?.props.borderStyle).toBe('bold')
  expect((await ui.find({ key: 'tile:ski' }))?.props.borderStyle).toBe('round')
  expect(JSON.stringify(await ui.drawn())).toContain('fire: a ░▒▓█ fire with sparks and smoke (on now)')
  // The ring moving onto ski, as the engine raises it for the person's arrow key (UiFocusInput).
  await $.ui.focus({ component: 'Pane', requestId: 'flow-pick', plugin: 'flow-scenes', element: 'pick:ski', origin: { kind: 'person' } } as never)
  await ui.redraw()
  expect((await ui.find({ key: 'tile:ski' }))?.props.borderStyle).toBe('bold')
  expect((await ui.find({ key: 'tile:fire' }))?.props.borderStyle).toBe('round')
  expect(JSON.stringify(await ui.drawn())).toContain('ski: a skier down the mountain')
  // Moving the ring picks nothing: only Enter (a press) does.
  expect((await flow($)).split('\n')[0]).toMatch(/^fire/)
  await ui.unmount()
})

test('the picker on desktop: an Svg thumbnail and a Button for every scene; its close changes nothing; a click picks', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  const pane = panes(on)
  await start($)
  await flow($, 'pick')
  let ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'desktop', ...PICK_PANE })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs).toHaveLength(STYLES.length)
  const png = decodeSvgPng(svgs[0]!.props.source as string)
  const layout = pickLayout(64, 44, STYLES.length)!
  expect([png.width, png.height]).toEqual([layout.columns * 2, layout.rows * 4])
  // Redrawn while it's there, as the band is.
  seen.invalidates = 0
  await clock.advance(1000)
  expect(seen.invalidates).toBeGreaterThan(5)
  // Its close control (Esc, in the terminal): nothing changes, and it stops redrawing.
  await ui.press({ key: 'close' })
  expect(pane.closes).toContain('flow-pick:plugin')
  expect((await flow($)).split('\n')[0]).toMatch(/^fire/)
  await ui.unmount()
  seen.invalidates = 0
  await clock.advance(1000)
  expect(seen.invalidates).toBeLessThan(2)
  // Opened again, a click picks.
  await flow($, 'pick')
  ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'desktop', ...PICK_PANE })
  await ui.press({ key: 'pick:bubbles' })
  expect((await flow($)).split('\n')[0]).toMatch(/^bubbles/)
  await ui.unmount()
})

test('the picker narrower than its labels, or on a surface without pictures, is a plain list that still picks', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  panes(on)
  await start($)
  await flow($, 'pick')
  for (const [surface, bodyColumns] of [['terminal', 10], ['vscode', 60]] as const) {
    const ui = await $.ui.mount({ plugin: 'flow-scenes', surface, ...PICK_PANE, props: { ...PICK_PANE.props, bodyColumns } })
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(await ui.findAll({ type: 'Button', key: 'pick:warp' })).toHaveLength(1)
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'vscode', ...PICK_PANE })
  await ui.press({ key: 'pick:warp' })
  expect((await flow($)).split('\n')[0]).toMatch(/^warp/)
  await ui.unmount()
})

test('/flow pick where no surface places panes says what to do instead, and leaves no pane waiting', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const closes: string[] = []
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no surface here places panes' } }))
  on('ui.close', (_, e) => {
    closes.push((e as { id: string }).id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [] }))
  await start($)
  expect(await flow($, 'pick')).toContain('/flow next')
  expect(closes).toContain('flow-pick')
})

// ── Subagents, one by one ────────────────────────────────────────────────

const listed = (id: string, status = 'running', description = `task ${id}`) => ({ id, status, type: 'Explore', description })

test('roster: a listed subagent works, goes quiet when nothing is heard, works again when it is', () => {
  const r = new Roster()
  r.listed([listed('a')])
  expect(r.dials().map(d => [d.id, d.state])).toEqual([['a', 'working']])
  r.tick(QUIET_MS - 1000)
  expect(r.dials()[0]!.state).toBe('working')
  r.tick(2000)
  expect(r.dials()[0]!.state).toBe('idle') // gone quiet
  r.heard('a') // a step, or streamed output
  expect(r.dials()[0]!.state).toBe('working')
  // A long tool keeps it working, however long it runs.
  r.toolStarted('a')
  r.tick(QUIET_MS * 5)
  expect(r.dials()[0]!.state).toBe('working')
  r.toolEnded('a')
  r.tick(QUIET_MS + 1)
  expect(r.dials()[0]!.state).toBe('idle')
  // Held (its own background work, a plan) or between turns: resting, whatever it last did.
  r.heard('a')
  r.listed([listed('a', 'waiting')])
  expect(r.dials()[0]!.state).toBe('idle')
})

test('roster: a subagent waits on you only once a dialog is put to you; an ask the mode settles alone never shows', () => {
  // (The waits are Activity's, one tracker for every loop: the roster reads its subagents' there.)
  const h = new Activity()
  const r = h.roster
  r.listed([listed('a'), listed('b')])
  const states = () => r.dials().map(d => d.state)
  // A call that needs permission: auto mode's classifier allows it alone, and the call runs and ends.
  h.called('tu1', 'Bash', 'a')
  expect(states()).toEqual(['working', 'working'])
  h.answered('tu1', 'Bash', 'a')
  expect(states()).toEqual(['working', 'working'])
  // This time a dialog shows (classic.PermissionRequest, no hook answering it): it waits, however long.
  h.called('tu2', 'Bash', 'a')
  h.prompted('Bash', 'a')
  expect(states()).toEqual(['waiting', 'working'])
  r.tick(QUIET_MS * 2)
  expect(states()).toEqual(['waiting', 'idle'])
  // Approved, the command shows its progress pill (ToolProgress carries only the call's id): it's running.
  h.answered('tu2')
  expect(states()).toEqual(['working', 'idle'])
  // Claude's question, a plan to approve: put to you from the start, till the call ends.
  h.waitingOn('tu3', true, 'AskUserQuestion', 'b')
  expect(states()).toEqual(['working', 'waiting'])
  h.answered('tu3', 'AskUserQuestion', 'b')
  expect(states()).toEqual(['working', 'working'])
  // A dialog with no ask before it waits under its tool's name till a call of it ends.
  h.prompted('Edit', 'a')
  expect(states()).toEqual(['waiting', 'working'])
  h.answered('tu4', 'Edit', 'a')
  expect(states()).toEqual(['working', 'working'])
  // Refused, the call ends all the same (the permission prompt runs beneath tool.call): its finally answers it.
  h.called('tu5', 'Bash', 'a')
  h.prompted('Bash', 'a')
  r.heard('a') // another model step of its own changes nothing: the dialog is still up
  expect(states()).toEqual(['waiting', 'working'])
  h.answered('tu5', 'Bash', 'a')
  expect(states()).toEqual(['working', 'working'])
  // The main loop's own dialogs and questions are not a subagent's.
  h.called('tu6', 'Bash')
  h.prompted('Bash')
  h.waitingOn('tu7', true, 'AskUserQuestion')
  expect(states()).toEqual(['working', 'working'])
})

test("roster: what a subagent does before a poll names it counts once one does: a tool still running, a dialog up", () => {
  const h = new Activity()
  const r = h.roster
  // Its first tool, and the other's permission dialog, before any poll has named them.
  r.toolStarted('a')
  h.called('tu1', 'Bash', 'b')
  h.prompted('Bash', 'b')
  r.tick(25_000)
  r.listed([listed('a'), listed('b')])
  expect(r.dials().map(d => [d.id, d.state])).toEqual([
    ['a', 'working'], // 25 s with nothing heard, but its tool is still running
    ['b', 'waiting'],
  ])
  r.toolEnded('a')
  h.answered('tu1', 'Bash', 'b')
  r.tick(QUIET_MS + 1)
  expect(r.dials().map(d => d.state)).toEqual(['idle', 'idle'])
  // A loop no poll names for long (the engine's own forks) is forgotten, its waits with it.
  r.heard('fork')
  h.waitingOn('tu2', true, 'AskUserQuestion', 'fork')
  r.tick(40_000)
  expect(h.isAwaitingPerson).toBe(false)
  r.listed([listed('a'), listed('b'), listed('fork')])
  expect(r.dials().find(d => d.id === 'fork')!.state).toBe('working') // named at last: a fresh start, no stale wait
})

test('roster: done when its run completes (or it stops being listed), kept a while for its companion to leave, then dropped', () => {
  const r = new Roster()
  r.listed([listed('a'), listed('b'), listed('c')])
  r.tick(5000)
  r.finished('a', true)
  r.listed([listed('a'), listed('b', 'failed'), listed('c')]) // a: a poll behind the news, still "running"
  r.tick(1000)
  r.listed([listed('a', 'completed'), listed('b', 'failed')]) // c: dropped by the engine
  const d = r.dials()
  expect(d.map(x => [x.id, x.state, x.ok])).toEqual([
    ['a', 'done', true],
    ['b', 'done', false],
    ['c', 'done', true],
  ])
  expect(d[0]!.ms).toBe(5000) // its run time stops when it's done
  expect(r.active).toBe(0)
  r.tick(DONE_MS + 100)
  expect(r.dials()).toEqual([])
})

test('roster: a finished agent a poll still lists held or between turns stays done; only listed running again (or heard from) is it back', () => {
  const r = new Roster()
  r.listed([listed('a'), listed('b')])
  r.finished('a', true)
  r.finished('b', true)
  r.tick(4000) // past the moment a poll may be behind the news
  r.listed([listed('a', 'idle'), listed('b', 'waiting')])
  expect(r.dials().map(d => [d.id, d.state])).toEqual([
    ['a', 'done'],
    ['b', 'done'],
  ])
  r.listed([listed('a', 'running'), listed('b', 'waiting')])
  expect(r.dials().map(d => [d.id, d.state])).toEqual([
    ['b', 'done'],
    ['a', 'working'], // a new run: last in line
  ])
})

test('roster: the dial is worked out once a change (and a tick), the same for every scene that asks between', () => {
  const h = new Activity()
  const r = h.roster
  expect(r.dials()).toBe(r.dials())
  expect(r.dials()).toEqual([])
  r.listed([listed('a')])
  const first = r.dials()
  expect(r.dials()).toBe(first)
  h.waitingOn('tu1', true, 'AskUserQuestion', 'a')
  const asked = r.dials()
  expect(asked).not.toBe(first)
  expect(asked[0]!.state).toBe('waiting')
  r.tick(70)
  expect(r.dials()).not.toBe(asked)
  expect(r.dials()[0]!.ms).toBe(70)
})

test('roster: one first seen already ended is never shown; one heard from after its run is back, a new run', () => {
  const r = new Roster()
  r.listed([listed('old', 'completed'), listed('a')])
  expect(r.dials().map(d => d.id)).toEqual(['a'])
  r.finished('a', true)
  r.tick(500)
  r.heard('a') // resumed by a message
  expect(r.dials().map(d => [d.id, d.state, d.ms])).toEqual([['a', 'working', 0]])
  // Heard from before any poll named it: counted from then, once a poll does.
  r.heard('new')
  r.tick(QUIET_MS + 10)
  r.listed([listed('a'), listed('new')])
  expect(r.dials().find(d => d.id === 'new')!.state).toBe('idle')
})

test('roster: a hover card line says the task, what it is doing, and for how long', () => {
  const d = { id: 'a', state: 'waiting' as const, ok: true, task: 'map the auth flow', type: 'Explore', ms: 125_000 }
  expect(agentLine(d)).toBe('Explore: map the auth flow · waiting on you, 2m 05s')
  expect(agentLine({ ...d, state: 'done', ok: false, ms: 9000 })).toBe('Explore: map the auth flow · stopped, 9s')
  expect(runTime(3_725_000)).toBe('1h 02m')
})

const dial = (id: string, state: 'working' | 'idle' | 'waiting' | 'done', ok = true) => ({ id, state, ok, task: '', type: '', ms: 0 })

test('crew: a companion eases in, rests and works with its agent, eases out, and frees its place for the next', () => {
  const c = new Crew(2, 10, 20)
  c.update([dial('a', 'working'), dial('b', 'idle'), dial('c', 'working')])
  expect(c.mates.map(m => [m.id, m.slot])).toEqual([['a', 0], ['b', 1]]) // c waits for room
  const here: number[] = []
  for (let i = 0; i < 12; i++) {
    c.update([dial('a', 'working'), dial('b', 'idle'), dial('c', 'working')])
    here.push(c.mates[0]!.here)
  }
  // No popping in: it arrives over the frames, never jumping more than a fifth at once.
  for (let i = 1; i < here.length; i++) expect(here[i]! - here[i - 1]!).toBeLessThan(0.2)
  expect(here.at(-1)).toBe(1)
  expect(c.mates[0]!.busy).toBe(1)
  expect(c.mates[1]!.busy).toBe(0)
  // Quiet, then waiting on you: it rests, easing down.
  c.update([dial('a', 'waiting'), dial('b', 'idle'), dial('c', 'working')])
  expect(c.mates[0]!.waiting).toBe(true)
  expect(c.mates[0]!.busy).toBeGreaterThan(0.8)
  for (let i = 0; i < 60; i++) c.update([dial('a', 'idle'), dial('b', 'idle'), dial('c', 'working')])
  expect(c.mates[0]!.busy).toBe(0)
  // Done: it leaves over the frames (failed, it says so), and only then is its place c's.
  const out: number[] = []
  for (let i = 0; i < 19; i++) {
    c.update([dial('a', 'done', false), dial('b', 'idle'), dial('c', 'working')])
    out.push(c.mates.find(m => m.id === 'a')!.here)
  }
  expect(c.mates.find(m => m.id === 'a')!.leaving).toBe(true)
  expect(c.mates.find(m => m.id === 'a')!.ok).toBe(false)
  for (let i = 1; i < out.length; i++) expect(out[i - 1]! - out[i]!).toBeLessThan(0.15)
  expect(c.mates.some(m => m.id === 'c')).toBe(false)
  for (let i = 0; i < 3; i++) c.update([dial('b', 'idle'), dial('c', 'working')])
  expect(c.mates.map(m => [m.id, m.slot])).toEqual([['b', 1], ['c', 0]])
})

test('crew: an adapter that only counts subagents (coverage) still gets that many companions, working, with no hover card', () => {
  const c = new Crew(4)
  for (let i = 0; i < 30; i++) c.update([], 30)
  expect(c.mates.map(m => [m.slot, m.busy])).toEqual([[0, 1], [1, 1]])
  c.mark(c.mates[0]!, 3, 1, 2, 2, 80, 5)
  expect(c.marks).toEqual([])
  for (let i = 0; i < 60; i++) c.update([], 0)
  expect(c.mates).toEqual([])
})

test('crew: only places the layout can show are given; less room sends the rest back to wait, and each comes in as one frees', () => {
  const c = new Crew(6, 10, 10)
  const six = ['a', 'b', 'c', 'd', 'e', 'f']
  const run = (done: string[], n: number) => {
    for (let i = 0; i < n; i++) c.update(six.map(id => dial(id, done.includes(id) ? 'done' : 'working')))
    return c.mates.map(m => `${m.id}${m.slot}`).sort()
  }
  c.room = 3 // a narrow spine
  expect(run([], 20)).toEqual(['a0', 'b1', 'c2'])
  // Three finish: the other three come in, into places the spine shows.
  expect(run(['a', 'b', 'c'], 40)).toEqual(['d0', 'e1', 'f2'])
  // The band has room for all of them; back to the spine, the ones it can't show wait again.
  c.room = 6
  expect(run(['a'], 30)).toEqual(['b3', 'c4', 'd0', 'e1', 'f2'])
  c.room = 3
  expect(run(['a'], 1)).toEqual(['d0', 'e1', 'f2'])
  expect(run(['a', 'd'], 40)).toEqual(['b0', 'e1', 'f2'])
})

/** The scenes that give each subagent a companion of its own. */
const CREW_SCENES = ['fire', 'surf', 'ski', 'balloon', 'falcon', 'starship', 'engine', 'train', 'avalon'] as const

test('companion scenes: each agent gets one that arrives, is marked where it is, and leaves when done, in the band and the spine', () => {
  for (const style of CREW_SCENES) {
    for (const [columns, rows] of [[120, 5], [22, 40]] as const) {
      const f = makeScene(style, 7)
      f.strength = 5
      f.ensure(columns, rows)
      for (let i = 0; i < 60; i++) f.step()
      f.grid()
      expect(f.agentMarks?.() ?? []).toEqual([])
      const run = (agents: ReturnType<typeof dial>[], n: number) => {
        for (let i = 0; i < n; i++) {
          f.agents = agents
          f.step()
        }
        f.grid()
        return (f.agentMarks?.() ?? []).map(m => m.id)
      }
      const at = `${style} at ${columns}×${rows}`
      // Just arrived: not there yet (it eases in), so not marked.
      expect([at, run([dial('a', 'working')], 1)]).toEqual([at, []])
      expect([at, run([dial('a', 'working')], 60)]).toEqual([at, ['a']])
      for (const m of f.agentMarks!()) {
        expect([at, m.col >= 0 && m.row >= 0 && m.col + m.w <= columns && m.row + m.h <= rows]).toEqual([at, true])
      }
      expect([at, run([dial('a', 'idle')], 40)]).toEqual([at, ['a']])
      expect([at, run([dial('a', 'waiting')], 10)]).toEqual([at, ['a']])
      expect([at, run([dial('a', 'done')], 80)]).toEqual([at, []])
    }
  }
})

test('companion scenes: every companion given a place is on screen, in the band and the spine, however many agents run', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']
  for (const style of CREW_SCENES) {
    for (const [columns, rows] of [[250, 5], [80, 5], [22, 40], [13, 30]] as const) {
      for (const level of [1, 5, 10]) {
        const f = makeScene(style, 7)
        const crew = (f as unknown as { crew: Crew }).crew
        f.strength = level
        f.ensure(columns, rows)
        const at = `${style} at ${columns}×${rows} level ${level}`
        const check = (done: string[]) => {
          // (Long enough for those done to leave and those waiting to come in: a train takes its time.)
          for (let i = 0; i < 160; i++) {
            f.agents = ids.map(id => dial(id, done.includes(id) ? 'done' : 'working'))
            f.step()
          }
          f.grid()
          const marked = new Set((f.agentMarks?.() ?? []).map(m => m.id))
          const shown = crew.mates.map(m => m.id)
          expect([at, shown.length > 0, shown.filter(id => !marked.has(id))]).toEqual([at, true, []])
        }
        check([])
        check(['a', 'b'])
      }
    }
  }
})

test('engine: six agents in the spine show three lamps at a time; as those finish, the others light; band to spine and back', () => {
  const f = makeScene('engine', 7)
  f.strength = 5
  const six = ['a', 'b', 'c', 'd', 'e', 'f']
  const run = (done: string[], n: number) => {
    for (let i = 0; i < n; i++) {
      f.agents = six.map(id => dial(id, done.includes(id) ? 'done' : 'working'))
      f.step()
    }
    f.grid()
    return f.agentMarks!().map(m => m.id).sort()
  }
  f.ensure(22, 40)
  expect(run([], 60)).toEqual(['a', 'b', 'c'])
  expect(run(['a', 'b', 'c'], 80)).toEqual(['d', 'e', 'f'])
  f.ensure(120, 5) // the band: room for six groups
  expect(run(['a'], 60)).toEqual(['b', 'c', 'd', 'e', 'f'])
  f.ensure(22, 40) // back to the spine: three show, the rest wait
  expect(run(['a'], 60).length).toBe(3)
})

test('companion scenes: a working companion and a resting one look different', () => {
  for (const style of CREW_SCENES) {
    const look = (state: 'working' | 'idle') => {
      const f = makeScene(style, 7)
      f.strength = 5
      f.ensure(120, 5)
      for (let i = 0; i < 120; i++) {
        f.agents = [dial('a', state)]
        f.step()
      }
      const g = f.grid()
      const m = f.agentMarks!()[0]
      return m ? `${m.row}:${m.col}` : `none ${g.columns}`
    }
    // Where it is (aloft or sunk, on station or dropped back, its spot): the scenes move a resting one.
    // (The engine's lamps and the fire's own fires stay put: see below.)
    const staysPut = style === 'engine' || style === 'fire'
    if (!staysPut) expect(`${style} ${look('working')}`).not.toBe(`${style} ${look('idle')}`)
  }
  // The engine's lamps stay put: a working group runs a light along it, a quiet one glows low.
  const lit = (state: 'working' | 'idle') => {
    const f = makeScene('engine', 7)
    f.strength = 5
    f.ensure(120, 5)
    for (let i = 0; i < 60; i++) {
      f.agents = [dial('a', state)]
      f.step()
    }
    const g = f.grid()
    const m = f.agentMarks!()[0]!
    const colors: number[] = []
    for (let c = m.col; c < m.col + m.w; c++) colors.push(g.foreground(4 * 120 + c), g.background(4 * 120 + c))
    return colors.join()
  }
  expect(lit('working')).not.toBe(lit('idle'))
  // A companion's fire burns tall while its agent works and dies down to embers while it's quiet.
  const flames = (state: 'working' | 'idle') => {
    const f = makeScene('fire', 7)
    f.strength = 6
    f.ensure(120, 5)
    let cells = 0
    for (let i = 0; i < 160; i++) {
      f.agents = [dial('a', state)]
      f.step()
      if (i < 100) continue
      const g = f.grid()
      const m = f.agentMarks!()[0]!
      for (let r = 0; r < 4; r++) for (let c = m.col; c < m.col + m.w; c++) {
        const cp = g.codePoint(r * 120 + c)
        if (cp !== 0x20 && cp < 0x2800) cells++ // flame, not a spark
      }
    }
    return cells
  }
  expect(flames('working')).toBeGreaterThan(flames('idle') * 2)
})

test('surf: on a big swell a working companion rides the wave with the surfer, standing on its face clear of them; a resting one does not', () => {
  type Inner = {
    cx: number
    Wf: number
    crew: Crew
    surferX(): number
    surfaceAt(x: number): number
    matePose(m: unknown): string
  }
  for (const [columns, rows] of [[120, 5], [250, 5], [22, 40], [13, 30]] as const) {
    for (const level of [8, 10]) {
      const at = `${columns}×${rows} level ${level}`
      const look = (state: 'working' | 'idle') => {
        const f = makeScene('surf', 7)
        const inner = f as unknown as Inner
        f.strength = level
        f.ensure(columns, rows)
        const poses: string[] = []
        for (let i = 0; i < 300; i++) {
          f.agents = [dial('a', state)]
          f.step()
          if (i < 200) continue
          const m = inner.crew.mates[0]!
          const pose = inner.matePose(m)
          poses.push(pose)
          if (pose !== 'ride' && pose !== 'crouch') continue
          // On the face (ahead of the crest, short of the foot), on its surface, and a rider apart from the surfer.
          expect([at, m.x > inner.cx && m.x < inner.cx + inner.Wf]).toEqual([at, true])
          const sx = inner.surferX()
          expect([at, Math.hypot(m.x - sx, inner.surfaceAt(m.x) - inner.surfaceAt(sx)) >= 4]).toEqual([at, true])
        }
        return poses
      }
      const working = look('working')
      expect([at, working.every(p => p === 'ride' || p === 'crouch')]).toEqual([at, true])
      expect([at, look('idle').some(p => p === 'ride' || p === 'crouch')]).toEqual([at, false])
    }
  }
})

test('desktop: the pointer over a subagent\'s companion shows its task and what it is doing', { options: { style: 'surf' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const agents = [{ id: 'ag1', description: 'map the auth flow', type: 'Explore', status: 'running' }]
  on('agent.list', () => ({ value: agents as never }))
  // The subagent's command runs till the test lets it end.
  let finish = () => {}
  on('tool.call', () => new Promise(r => (finish = () => r({ result: {} as never }))))
  // No settings hook answers a permission request for the person: the dialog shows.
  on('classic.PermissionRequest', () => ({}))
  on('ui.render', { component: 'ToolProgress' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: e.props.hint })
  })
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'desktop', ...BAND })
  const after = async (ms: number) => {
    for (let t = 0; t < ms; t += 250) {
      await clock.advance(250)
      // (The engine stand-in takes the plugin's invalidations: draw again as desktop would.)
      await ui.redraw()
    }
    return JSON.stringify(await ui.drawn())
  }
  let drawn = await after(4000)
  const zone = await ui.find({ key: 'agent:ag1' })
  expect(zone?.type).toBe('Box')
  expect(zone?.props.position).toBe('absolute')
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(drawn).toContain('Explore: map the auth flow · working')
  expect(drawn).toContain('"display":"none"') // the card is hidden until the pointer is over it

  drawn = await after(22_000)
  expect(drawn).toContain('· quiet')

  // A call that needs permission: auto mode's classifier may settle it alone, so it's no wait on you yet.
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build', tool_use_id: 'tu1', agentId: 'ag1' } as never)
  drawn = await after(500)
  expect(drawn).toContain('Explore: map the auth flow · working') // a tool running keeps it working
  // The dialog shows: now it waits on you.
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, agent_id: 'ag1' } as never)
  drawn = await after(500)
  expect(drawn).toContain('· waiting on you')
  // Approved, the command runs and shows its progress pill: it's working again.
  const pill = await $.ui.mount({
    plugin: 'flow-scenes',
    surface: 'terminal',
    component: 'ToolProgress',
    requestId: 'tu1',
    props: { tool_use_id: 'tu1', kind: 'background_hint', hint: '(ctrl+b to run in background)' },
  } as never)
  drawn = await after(500)
  expect(drawn).toContain('Explore: map the auth flow · working')
  await pill.unmount()
  finish()
  await call

  agents[0]!.status = 'completed'
  await after(8000)
  expect(await ui.find({ key: 'agent:ag1' })).toBeUndefined() // it has left
  await ui.unmount()
})

test("train: each subagent's train draws up from out of sight, keeps pace while it works, drops back with its headlamp out while quiet, flashes its cab while it waits on you, and falls back out of sight when done", () => {
  const t = makeScene('train', 4) as Train
  t.strength = 6
  t.ensure(160, 5)
  for (let i = 0; i < 20; i++) t.step()
  const run = (agents: ReturnType<typeof dial>[], n: number) => {
    for (let i = 0; i < n; i++) {
      t.agents = agents
      t.step()
    }
    t.grid()
    return t.agentMarks!()
  }
  // Six agents, but the band at 160 columns shows three trains whole: the rest wait for a place.
  const six = ['a', 'b', 'c', 'd', 'e', 'f']
  expect(run(six.map(id => dial(id, 'working')), 3).length).toBe(0) // still out of sight: nothing pops in
  expect(t.company).toBe(0)
  const marks = run(six.map(id => dial(id, 'working')), 200)
  expect(marks.map(m => m.id)).toEqual(['a', 'b', 'c'])
  expect(t.company).toBe(3)
  // Quiet, it drops back a little (and stays in view).
  const at = (ms: readonly AgentMark[], id: string) => ms.find(m => m.id === id)!.col
  const before = at(marks, 'a')
  const quiet = run([dial('a', 'idle'), ...six.slice(1).map(id => dial(id, 'working'))], 120)
  expect(at(quiet, 'a')).toBeLessThan(before - 6)
  // Its cab: the headlamp lit while working, out while quiet, flashing (on, off) while it waits on you.
  const inner = t as unknown as { crew: Crew; cab(m: unknown, t: number): number }
  const cab = (id: string, frame: number) => inner.cab(inner.crew.mates.find(m => m.id === id)!, frame)
  expect(cab('b', 0)).toBe(1)
  expect(cab('a', 0)).toBe(0)
  run([dial('a', 'waiting'), ...six.slice(1).map(id => dial(id, 'working'))], 1)
  expect([...new Set(Array.from({ length: 16 }, (_, f) => cab('a', f)))].sort()).toEqual([0, 2])
  // Done, the first three fall back out of sight and the next three draw up in their places.
  const later = run([...['a', 'b', 'c'].map(id => dial(id, 'done')), ...['d', 'e', 'f'].map(id => dial(id, 'working'))], 300)
  expect(later.map(m => m.id).sort()).toEqual(['d', 'e', 'f'])
})

test("fire: each subagent kindles a small fire of its own on alternate sides, the main fire narrowing to make room, a dark gap between; done, it burns out and the main fire widens back", () => {
  const f = makeScene('fire', 5)
  f.strength = 6
  f.ensure(120, 5)
  const lit = (g: ReturnType<typeof f.grid>, c: number) => {
    for (let r = 0; r < 5; r++) {
      const cp = g.codePoint(r * 120 + c)
      if (cp !== 0x20 && cp < 0x2800) return true
    }
    return false
  }
  /** How often each column burns over `n` frames (0..1). */
  const burning = (agents: ReturnType<typeof dial>[], n: number) => {
    const seen = new Float32Array(120)
    for (let i = 0; i < n; i++) {
      f.agents = agents
      f.step()
      const g = f.grid()
      for (let c = 0; c < 120; c++) if (lit(g, c)) seen[c]! += 1 / n
    }
    return seen
  }
  const alone = burning([], 80)
  expect(alone[2]! > 0.5 && alone[117]! > 0.5).toBe(true) // the whole width burns
  const two = [dial('a', 'working'), dial('b', 'working')]
  burning(two, 60)
  const marks = f.agentMarks!()
  expect(marks.map(m => m.id).sort()).toEqual(['a', 'b'])
  const a = marks.find(m => m.id === 'a')!
  const b = marks.find(m => m.id === 'b')!
  expect(a.col > 60 && b.col < 60).toBe(true) // one each side
  const with2 = burning(two, 60)
  // Each companion's own fire burns, with a gap no flame crosses between it and the main fire.
  expect(with2[a.col + 2]!).toBeGreaterThan(0.5)
  expect(with2[b.col + 2]!).toBeGreaterThan(0.5)
  expect(with2[a.col - 1]!).toBe(0)
  expect(with2[b.col + b.w]!).toBe(0)
  // An adapter with only a count gets as many fires, unmarked (no hover card).
  const g = makeScene('fire', 5)
  g.strength = 6
  g.ensure(120, 5)
  g.coverageBoost = 30
  for (let i = 0; i < 60; i++) g.step()
  g.grid()
  expect((g as unknown as { crew: Crew }).crew.mates.length).toBe(2)
  expect(g.agentMarks!()).toEqual([])
  // Done: they burn out, the gaps close, the main fire takes the whole width again.
  burning([dial('a', 'done'), dial('b', 'done', false)], 80)
  expect(f.agentMarks!()).toEqual([])
  const after = burning([], 60)
  expect(after[a.col - 1]! > 0.3 && after[b.col + b.w]! > 0.3).toBe(true)
})

// ── Review fixes: sessions, the adapter, the spine ───────────────────────

/** `$.state` over a Map the test can look into (`flow-scenes.altitude`: 12), counting the writes to each key. */
function memoryState(on: On, entries: Readonly<Record<string, unknown>> = {}) {
  const values = new Map<string, unknown>(Object.entries(entries))
  const writes = new Map<string, number>()
  on('state.get', (_, e) => {
    const k = `${e.plugin}.${e.key}`
    return { value: { value: values.get(k), version: values.has(k) ? 1 : 0 } as never }
  })
  on('state.set', (_, e) => {
    const k = `${e.plugin}.${e.key}`
    values.set(k, (e as { value: unknown }).value)
    writes.set(k, (writes.get(k) ?? 0) + 1)
    return { value: { isSet: true, version: writes.get(k)! } as never }
  })
  return { values, writes }
}

test("/config's layout changed in the session places the pane as /flow would: spine opens it, band closes it", { options: { mode: 'manual', level: 5, layout: 'spine' } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const pane = panes(on)
  await start($)
  expect(pane.open.has('flow')).toBe(true)
  await flow($, 'band') // the session's own: the pane goes
  expect(pane.open.has('flow')).toBe(false)
  const set = $.config.set as unknown as (e: object) => Promise<unknown>
  await set({ key: 'flow-scenes.layout', value: 'spine', previous: 'spine', provider: { plugin: 'flow-scenes', tier: 'user' }, origin: { kind: 'composer' } })
  expect(pane.open.has('flow')).toBe(true)
  await set({ key: 'flow-scenes.layout', value: 'band', previous: 'spine', provider: { plugin: 'flow-scenes', tier: 'user' }, origin: { kind: 'composer' } })
  expect(pane.open.has('flow')).toBe(false)
})

test('a /clear or a resume starts with the context empty: no blue left over from the conversation before', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await start($)
  const measure = ($ as unknown as { session: { measure: (e: object) => Promise<unknown> } }).session.measure
  await measure({ context: { percent: 92 }, rateLimits: [], changed: ['context'] })
  expect(await flow($)).toContain('context nearly full')
  await endSession($, 'clear', 'session-a')
  expect(await flow($)).not.toContain('context nearly full')
})

test('sessions: a poll reading the new id while the session that ended is still being put away knows it was a resume, not a /clear', { options: { style: 'surf' } }, async ($, on) => {
  const clock = mock.clock(on)
  memoryStore(on)
  const seen = engine(on)
  // /config's rows: the first read once the session has ended is slow to answer.
  let holding = false
  let release: (() => void) | undefined
  on('config.list', async () => {
    if (holding) {
      holding = false
      await new Promise<void>(r => (release = r))
    }
    return { value: configRows({}) as never }
  })
  seen.session = 'a'
  await start($)
  await flow($, 'ski')
  // Resumed into b (no settings of its own): a's end is still reading the defaults when a poll sees b.
  holding = true
  seen.session = 'b'
  const ending = endSession($, 'resume', 'a')
  await clock.advance(6000)
  release?.()
  await ending
  expect((await flow($)).split('\n')[0]).toMatch(/^fire/) // the defaults (/config's), not a's ski carried over
})

test('a session whose start meets a failure (its state unreadable) still runs its frame loop', { options: { mode: 'manual', level: 5 } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  on('state.get', () => ({ deny: 'no state here' }) as never)
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  seen.blits.length = 0
  await clock.advance(1000)
  expect(seen.blits.length).toBeGreaterThan(3)
  await ui.unmount()
})

test('a band no longer mounted (its blit refused) is no longer heard', { options: { mode: 'manual', level: 9, style: 'bubbles', sound: 'on' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  await clock.advance(3000)
  expect((seen.plays ?? []).length).toBeGreaterThan(0)
  await ui.unmount()
  seen.blitDeny = 'nothing of this plugin is mounted there'
  await clock.advance(1000)
  const before = (seen.plays ?? []).length
  await clock.advance(10_000)
  expect((seen.plays ?? []).length).toBe(before)
})

test("the balloon's altitude: kept while it's the balloon, never built or written for another scene", { options: { mode: 'manual', level: 8, style: 'fire' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const state = memoryState(on, { 'flow-scenes.altitude': 3 })
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  await clock.advance(5000)
  expect(state.writes.get('flow-scenes.altitude') ?? 0).toBe(0)
  await flow($, 'balloon')
  await clock.advance(5000)
  expect(state.writes.get('flow-scenes.altitude') ?? 0).toBeGreaterThan(0)
  expect(state.values.get('flow-scenes.altitude')).not.toBe(3) // it climbed from where it was left
  await ui.unmount()
})

test('someone seen at the session is remembered across a reload: the sound plays then with no key; a turn or a /flow marks them too', { options: { mode: 'manual', level: 9, style: 'bubbles', sound: 'on' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  const state = memoryState(on)
  const begin = () => ($ as unknown as TestDollar).session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await begin()
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  await clock.advance(2000)
  expect(seen.plays ?? []).toEqual([])
  await keyed($)
  await keyed($)
  await flow($)
  // Kept in the session's state (written once) for a reload to find: see the next test.
  expect(state.values.get('flow-scenes.present')).toBe(true)
  expect(state.writes.get('flow-scenes.present')).toBe(1)
  await ui.unmount()
})

test('someone is there: after a reload that finds them in the state, the sound plays with no key', { options: { mode: 'manual', level: 9, style: 'bubbles', sound: 'on' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  memoryState(on, { 'flow-scenes.present': true })
  await ($ as unknown as TestDollar).session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  await clock.advance(3000)
  expect((seen.plays ?? []).length).toBeGreaterThan(0)
  await ui.unmount()
})

test('someone is there: a turn starting is someone at the session too, remembered for a reload', { options: { mode: 'manual', level: 9, style: 'bubbles', sound: 'on' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  const state = memoryState(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await ($ as unknown as TestDollar).session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'flow-scenes', surface: 'terminal', ...BAND })
  await clock.advance(2000)
  expect(seen.plays ?? []).toEqual([])
  await ($ as unknown as { turn: { start: (e: object) => Promise<unknown> } }).turn.start({ turnId: 't1', text: 'hi' })
  expect(state.values.get('flow-scenes.present')).toBe(true)
  await clock.advance(3000)
  expect((seen.plays ?? []).length).toBeGreaterThan(0)
  await ui.unmount()
})

test('ski: in the spine at a fresh start, the companions stand clear of one another and of the skier', () => {
  for (const [columns, rows] of [[22, 30], [22, 60], [13, 30]] as const) {
    const f = makeScene('ski', 7)
    f.ensure(columns, rows)
    f.strength = 1
    f.agents = ['a', 'b', 'c', 'd'].map(id => dial(id, 'working'))
    for (let i = 0; i < 60; i++) f.step()
    f.grid()
    const marks = f.agentMarks?.() ?? []
    expect(marks.length).toBe(4)
    for (let i = 0; i < marks.length; i++) {
      for (let j = i + 1; j < marks.length; j++) {
        const [p, q] = [marks[i]!, marks[j]!]
        // (Marks round outward to whole cells: touching by one is no overlap.)
        const across = Math.min(p.col + p.w, q.col + q.w) - Math.max(p.col, q.col)
        const down = Math.min(p.row + p.h, q.row + q.h) - Math.max(p.row, q.row)
        expect(across <= 1 || down <= 1).toBe(true)
      }
    }
  }
})

test("the picker on desktop counts its close Button's row: the grid and it fit the pane", () => {
  for (let columns = 30; columns <= 200; columns += 11) {
    for (let rows = 6; rows <= 60; rows += 2) {
      const l = pickLayout(columns, rows, STYLES.length, undefined, 1)
      if (!l) continue
      const frame = l.framed ? 2 : 0
      expect(Math.ceil(STYLES.length / l.across) * (l.rows + 1 + frame) + (l.lines ? 2 : 0) + 1).toBe(l.height)
      expect(l.height).toBeLessThanOrEqual(rows)
    }
  }
})

test('night falls at one pace everywhere: as asked at the start, eased after, landing on it', () => {
  expect(easeNight(-1, true)).toBe(1)
  expect(easeNight(-1, false)).toBe(0)
  let k = 0
  let frames = 0
  while (k < 1 && frames < 1000) {
    k = easeNight(k, true)
    frames++
  }
  // Half way in about a second (14 fps), all the way in a few.
  expect(frames).toBeGreaterThan(40)
  expect(frames).toBeLessThan(120)
  expect(k).toBe(1)
})

test('ramps: evenly spaced stops and placed ones, held to their ends', () => {
  const stops = [0x000000, 0x808080, 0xffffff]
  expect(rampAt(stops, -1)).toBe(0x000000)
  expect(rampAt(stops, 0.5)).toBe(0x808080)
  expect(rampAt(stops, 2)).toBe(0xffffff)
  const placed = [[0, 0x000000], [10, 0xff0000], [30, 0x00ff00]] as const
  expect(rampStops(placed, 5)).toBe(0x800000)
  expect(rampStops(placed, 99)).toBe(0x00ff00)
})

test('retain keeps what passes, in order, in the same array', () => {
  const list = [1, 2, 3, 4, 5, 6]
  retain(list, n => n % 2 === 0)
  expect(list).toEqual([2, 4, 6])
})

test('a scene made without a seed gets a fresh one each time: no clock, never the same twice', () => {
  const a = freshSeed()
  const b = freshSeed()
  expect(a).not.toBe(b)
  expect(Number.isInteger(a) && a >= 0).toBe(true)
})

test('companions alike in every scene: resting, beckoning out of step by slot, leaving well or not', () => {
  const crew = new Crew(4)
  crew.update([
    { id: 'a', state: 'idle', ok: true, task: '', type: '', ms: 0 },
    { id: 'b', state: 'waiting', ok: true, task: '', type: '', ms: 0 },
  ])
  for (let i = 0; i < 40; i++) crew.update([
    { id: 'a', state: 'idle', ok: true, task: '', type: '', ms: 0 },
    { id: 'b', state: 'waiting', ok: true, task: '', type: '', ms: 0 },
  ])
  const a: Mate = crew.inSlot(0)!
  const b: Mate = crew.inSlot(1)!
  expect(resting(a) && resting(b)).toBe(true)
  // A blink of about four frames on, four off; the next slot out of step.
  const on = Array.from({ length: 16 }, (_, t) => beckon(b, t))
  expect(on.filter(Boolean).length).toBe(8)
  expect(Array.from({ length: 16 }, (_, t) => beckon(a, t))).not.toEqual(on)
  crew.update([{ id: 'b', state: 'done', ok: false, task: '', type: '', ms: 0 }])
  expect(finished(a) && !failed(a)).toBe(true)
  expect(failed(b) && !finished(b)).toBe(true)
  expect(resting(a)).toBe(false)
  expect(easeTo(Number.NaN, 5, 0.1)).toBe(5)
  expect(easeTo(0, 10, 0.5)).toBe(5)
})
