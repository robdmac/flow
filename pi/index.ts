// REVISION: flow-v177-pi-sound
//
// Flow for pi (badlogic/pi-mono), by Rob Macrae: the same ambient
// scenes as the Claude Code mod, in a widget above pi's editor. pi's events
// drive the same activity model, and the shared cell grid is drawn as 24-bit
// ANSI lines, stepped ~14 fps while busy and 8 fps when calm.
//
//   agent_start / agent_end       a turn lifts it, then it settles to idle
//   turn_start                    a model step; ctx.thinkingLevel sets the floor
//   message_update (deltas)       streamed text/thinking keeps it going
//   tool_call                     edits push it, commands spark, reads and other tools flicker
//   tool_result (isError, bash)   a failed command shows as smoke
//   session_compact               so does a compaction
//   ctx.getContextUsage()         a nearly-full context shows as blue
//
// `/flow` takes the same arguments
// as in Claude Code, day and night following the local clock unless pinned.
// As there, each session keeps its own settings: `/flow` changes the session
// it runs in, kept in the session itself (a `flow` entry, never sent to the
// model), so resuming or forking it brings them back. ~/.pi/agent/flow.json
// holds the defaults new sessions start with (read from the old vista.json
// or ascii-fire.json until that exists), read afresh before `/flow` compares
// with it (another pi session may have saved); `/flow save` writes it. An
// older pi without session entries keeps one set for every session, in that
// file, as before (session.ts). pi has no built-in subagents, so they never add to the scene here,
// and no side panes, so there is no spine, and `/flow pick` is a plain list (pi's own select)
// rather than thumbnails, its choice going the way `/flow <scene>` goes. Nor has it a player, so
// the soundscape (hooks/soundscape.ts, as in Claude Code and opencode) plays through afplay run in
// the background (node/player.ts, macOS; elsewhere `/flow sound` says there's none), once a turn has
// run or `/flow` has been used. pi tells an extension nothing of a wait on the person, so no chime.
// The one-time tips are Claude Code's and opencode's (the other scenes, then the sound), as a session
// starts or under a `/flow` reply, kept in flow.json (`tips`).
//
// In a terminal that draws kitty images (Ghostty, kitty, WezTerm, Warp), a
// scene that can draw itself at real pixels (earthrise) shows as a picture
// instead of its cells, taller than the band (picture.ts): flow.json's
// `"rows"` sets how tall (14 unless it says; never more than half the
// terminal), `"pictures": false` keeps the cells. A new size's picture is made
// a little each frame, the cells showing meanwhile, and what took long is
// kept in ~/.cache/flow for the next time. A scene with a taller view of its
// own (doom3d, through the marine's eyes) gets as many rows in cells.

import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Activity } from '../hooks/activity'
import { FRAME_MS, SceneDriver } from '../hooks/scene'
import { pickBlurb } from '../hooks/picker'
import { firstTips, type Host, parseFlowArgs, readConfig, replyTo, storedValue, tipChance, type FlowConfig, versionNote } from '../hooks/settings'
import { Soundscape } from '../hooks/soundscape'
import { SCENES, type Scene } from '../hooks/styles'
import { afplayPlayer } from '../node/player'
import { gridToAnsi } from './ansi'
import { cellPixels, kittyImages, kittyLines, pictureId, pictureSize } from './picture'
import { COMMAND_TOOLS, effortOf, FLOW_ENTRY, piLinesWritten, READ_TOOLS } from './mapping'
import { PiSettings, type SessionEntries } from './session'
import type { PiApi, PiComponent, PiContext, PiTui } from './types'

const KEY = 'flow'
const ROWS = 5
const CONTEXT_EVERY_MS = 5000
/** How often flow.json is read afresh while the scene runs: another session's save shows here as this one's own. */
const DEFAULTS_EVERY_MS = 30_000
const SETTINGS = join(homedir(), '.pi', 'agent', 'flow.json')
/** The plugin's folder: its sounds/ are played from there. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Where the settings lived before, newest first: as vista, then as ascii-fire. */
const OLD_SETTINGS = [join(homedir(), '.pi', 'agent', 'vista.json'), join(homedir(), '.pi', 'agent', 'ascii-fire.json')]
/** A picture's rows (and a taller scene's, `Scene.taller`) unless flow.json says (`rows`), and at most this share of the terminal's. */
const PICTURE_ROWS = 14
const PICTURE_SHARE = 0.5
/**
 * At most this many pixels a picture (the terminal scales it up to its cells), and at most one this often:
 * enough for earthrise's halftone dots at the terminal's own pixels in most windows, so they stay crisp
 * (a frame of dots on a clear sky packs small, well under 100 KB).
 */
const PICTURE_PIXELS = 600_000
const PICTURE_MS = 100
/** A new size's picture is made between frames, this long at a time, with this long between for everything else. */
const PICTURE_BUILD_MS = 12
const PICTURE_YIELD_MS = 4
/** Where what a picture took long to make is kept: the most recent few sizes. */
const CACHE = join(homedir(), '.cache', 'flow')
const CACHE_KEPT = 8

/** Drop all but the CACHE_KEPT newest kept pictures' parts. */
async function pruneCache(): Promise<void> {
  const names = (await readdir(CACHE)).filter(n => n.endsWith('.f32'))
  const dated = await Promise.all(names.map(async n => ({ n, t: (await stat(join(CACHE, n))).mtimeMs })))
  dated.sort((a, b) => b.t - a.t)
  await Promise.all(dated.slice(CACHE_KEPT).map(({ n }) => unlink(join(CACHE, n))))
}

/** flow.json's own keys for pi's pictures: whether to draw them, and how many rows. */
async function loadPicturePrefs(): Promise<{ pictures: boolean; rows: number }> {
  let raw: Record<string, unknown> = {}
  try {
    raw = JSON.parse(await readFile(SETTINGS, 'utf8')) as Record<string, unknown>
  } catch {
    // None yet: the defaults.
  }
  const rows = typeof raw.rows === 'number' && Number.isFinite(raw.rows) ? Math.round(raw.rows) : PICTURE_ROWS
  return { pictures: raw.pictures !== false, rows: Math.max(3, Math.min(60, rows)) }
}

/** The defaults new sessions start with: as kept (readStored), else Flow's own. */
async function loadSettings(): Promise<FlowConfig> {
  return readConfig(await readStored())
}

/**
 * What's kept: flow.json, or before the first write since a rename, an old file (vista.json,
 * ascii-fire.json), so a write never drops what that held. None kept yet (or unreadable): none.
 */
async function readStored(): Promise<Record<string, unknown> | undefined> {
  for (const file of [SETTINGS, ...OLD_SETTINGS]) {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    } catch {
      // Not there (or unreadable): try the next.
    }
  }
  return undefined
}

/**
 * Write these keys into flow.json, over what is kept now (readStored): another pi session's changes to
 * other keys survive, and an old file's settings carry over into flow.json with the first write.
 */
async function keepStored(changes: Record<string, unknown>): Promise<void> {
  const stored = { ...(await readStored()), ...changes }
  await mkdir(dirname(SETTINGS), { recursive: true })
  await writeFile(SETTINGS, JSON.stringify(stored, null, 2) + '\n')
}

/** Write just these settings into flow.json, as they're stored (keepStored). */
async function saveSettings(changes: Partial<FlowConfig>): Promise<void> {
  const stored: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(changes) as [keyof FlowConfig, FlowConfig[keyof FlowConfig]][]) stored[k] = storedValue(k, v)
  await keepStored(stored)
}

/**
 * The one-time tips (settings.ts), the person's, kept in flow.json (`tips`, beside its own keys). Begun
 * where none are kept yet, before the session's `/flow` can keep anything: someone who had Flow in pi before
 * (settings kept already) is taken as told, someone new as told nothing (firstTips).
 */
async function beginTips(defaults: FlowConfig): Promise<void> {
  const stored = await readStored()
  if (stored?.tips !== undefined) return
  await keepStored({ tips: firstTips(stored !== undefined, defaults) })
}

/** A chance for a tip (tipChance): the tip, if one's due, without its `flow: ` (pi's notice says whose). None on any failure. */
async function takeTip(cfg: FlowConfig): Promise<string | undefined> {
  try {
    const { tip, tips, changed } = tipChance((await readStored())?.tips, cfg)
    if (changed) await keepStored({ tips })
    return tip?.replace(/^flow: /, '')
  } catch {
    return undefined
  }
}

/** pi's version, from its own package (named one way since 1.1, another before): none if it can't be read. */
async function piVersion(): Promise<string | undefined> {
  for (const name of ['@earendil-works/pi-coding-agent', '@mariozechner/pi-coding-agent']) {
    try {
      const v = ((await import(name)) as { VERSION?: unknown }).VERSION
      if (typeof v === 'string') return v
    } catch {
      // Not under this name: the next.
    }
  }
  return undefined
}

/**
 * On a pi older than Flow is built against (see versionNote), the note to give: once for that version,
 * flow.json keeping which it was said for (`warned`, beside its own keys). None on any failure.
 */
async function versionWarning(): Promise<string | undefined> {
  const version = await piVersion()
  const note = versionNote('pi', version)
  if (!note) return undefined
  if ((await readStored())?.warned === version) return undefined
  try {
    await keepStored({ warned: version })
  } catch {
    // Unkept: said again next time.
  }
  return note
}

export default function flow(pi: PiApi) {
  const activity = new Activity()
  const driver = new SceneDriver(readConfig(undefined), activity)
  const cfg = driver.cfg
  /** The soundscape, played by afplay (macOS); none elsewhere. */
  const player = afplayPlayer(ROOT)
  const sound = new Soundscape(cfg, player)
  /** What pi has of what `/flow` speaks of: no side panes; a player where afplay is. */
  const PI: Host = { panes: false, sound: player !== undefined }
  /** The defaults (flow.json) and this session's own settings over them. */
  const settings = new PiSettings(cfg, { load: loadSettings, save: saveSettings })

  /** The session's entries, where this pi keeps them: else every session shares flow.json, as before. */
  const entriesOf = (ctx: PiContext): SessionEntries | undefined => {
    const manager = ctx.sessionManager
    if (typeof pi.appendEntry !== 'function' || !manager) return undefined
    return { branch: () => manager.getBranch(), keep: data => pi.appendEntry?.(FLOW_ENTRY, data) }
  }
  /** A read of flow.json under way (from the frame loop). */
  let refreshing = false

  let ctxRef: PiContext | undefined
  let tui: PiTui | undefined
  let width = 0
  let lines: string[] = []
  let isMounted = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let sinceContext = 0
  let sinceDefaults = 0

  /** Pictures: whether the terminal draws them, its cells' pixels, flow.json's say, and the one image id this pi uses. */
  let kitty = false
  let cell = { width: 9, height: 18 }
  let prefs = { pictures: true, rows: PICTURE_ROWS }
  const picId = pictureId()
  /** Whether the widget shows a picture now, and how long since the last was sent. */
  let showingPicture = false
  let sincePicture = 0
  /** How much of a new size's picture one slice makes (the scene's own units), learned from how long it takes. */
  let budget = 300
  /** The size being made between frames (`w`x`h`), if any. */
  let making: string | undefined
  /** What a picture of each size took long to make, kept in CACHE: being read back, read back, not there, or written. */
  const kept = new Map<string, 'reading' | 'restored' | 'absent' | 'written'>()
  /** The rows a picture, or a taller scene's view, takes now. */
  const tallRows = () => {
    const terminal = process.stdout.rows || 40
    return Math.max(3, Math.min(prefs.rows, Math.floor(terminal * PICTURE_SHARE)))
  }

  /** Whether this scene shows as a picture here. */
  const pictured = (f: Scene) => kitty && prefs.pictures && typeof f.picture === 'function'

  /** Read back what a picture of this size took long to make, if it was kept: false until that's known (make nothing yet). */
  const readKept = (f: Scene, w: number, h: number): boolean => {
    const key = f.pictureKey?.(w, h)
    if (!key) return true
    const state = kept.get(key)
    if (state) return state !== 'reading'
    kept.set(key, 'reading')
    void readFile(join(CACHE, key + '.f32'))
      .then(buf => {
        const data = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
        kept.set(key, f.restorePicture?.(w, h, data) ? 'restored' : 'absent')
      })
      .catch(() => kept.set(key, 'absent'))
    return false
  }

  /** Keep what a picture made here took long to make, once (written aside, then moved in, so no reader sees half). */
  const writeKept = (f: Scene) => {
    const made = f.pictureCache?.()
    if (!made || kept.get(made.key) !== 'absent') return
    kept.set(made.key, 'written')
    const file = join(CACHE, made.key + '.f32')
    const bytes = new Uint8Array(made.data.buffer, made.data.byteOffset, made.data.byteLength).slice()
    const tmp = file + '.' + process.pid + '.tmp'
    void mkdir(CACHE, { recursive: true })
      .then(() => writeFile(tmp, bytes))
      .then(() => rename(tmp, file))
      .then(pruneCache)
      .catch(() => {
        // Not kept: made afresh next time.
      })
  }

  /** This frame as a picture's lines, or undefined while it's still being made (draw the cells). */
  const drawPicture = (f: Scene): string[] | undefined => {
    if (!f.picture || width <= 0) return undefined
    const rows = tallRows()
    const { w, h } = pictureSize(width, rows, cell, PICTURE_PIXELS)
    if (!readKept(f, w, h)) return undefined
    const rgba = f.picture(w, h, 0)
    if (!rgba) {
      makeBetweenFrames(f, w, h)
      return undefined
    }
    writeKept(f)
    return kittyLines(rgba, w, h, width, rows, picId)
  }

  /** Make a new size's picture a slice at a time, off the frame loop, until it's made (or the size or scene moves on). */
  const makeBetweenFrames = (f: Scene, w: number, h: number) => {
    const key = w + 'x' + h
    if (making === key) return
    making = key
    const slice = () => {
      if (making !== key) return
      if (driver.built(driver.cfg.style) !== f || !f.picture) {
        making = undefined
        return
      }
      const t0 = performance.now()
      const made = f.picture(w, h, budget) !== undefined
      if (made) {
        making = undefined
        writeKept(f)
        return
      }
      const ms = performance.now() - t0
      budget = Math.max(20, Math.min(1e6, (budget * PICTURE_BUILD_MS) / Math.max(1, ms)))
      setTimeout(slice, PICTURE_YIELD_MS)
    }
    setTimeout(slice, 0)
  }

  /** This frame's lines: a picture when it's time for one, else the cells; undefined to keep the last picture. */
  const nextLines = (f: Scene, force = false): string[] | undefined => {
    if (pictured(f)) {
      if (showingPicture && !force && sincePicture < PICTURE_MS) return undefined
      const p = drawPicture(f)
      if (p) {
        showingPicture = true
        sincePicture = 0
        return p
      }
    }
    showingPicture = false
    return gridToAnsi(f.grid())
  }

  /** Read the local clock (pi runs on this machine, so its time is the person's). */
  const readClock = () => {
    const d = new Date()
    driver.clock = { hour: d.getHours(), minute: d.getMinutes() }
  }

  /** Point the current scene at this frame's dials and size. */
  const dial = () => {
    const f = driver.dial()
    if (width > 0) f.ensure(width, f.taller ? tallRows() : ROWS)
    return f
  }

  const widget = (t: PiTui): PiComponent => {
    tui = t
    return {
      render(w: number) {
        if (w !== width) {
          width = w
          lines = nextLines(dial(), true) ?? lines
        }
        return lines
      },
      invalidate() {
        width = 0 // re-lay the next render at whatever width it brings
      },
      dispose() {
        tui = undefined
      },
    }
  }

  /** Show or hide the widget to match `isShown()` (dark idle gives the rows back). */
  const sync = (ctx: PiContext) => {
    const shown = driver.isShown()
    if (shown === isMounted) return
    isMounted = shown
    ctx.ui.setWidget(KEY, shown ? widget : undefined, { placement: 'aboveEditor' })
  }

  const frame = (elapsed: number) => {
    activity.tick(elapsed / FRAME_MS)
    const ctx = ctxRef
    if (ctx) {
      sinceContext += elapsed
      if (sinceContext >= CONTEXT_EVERY_MS) {
        sinceContext = 0
        const usage = ctx.getContextUsage()
        if (usage?.percent != null) activity.contextPercent = usage.percent
        readClock()
        void cellPixels().then(c => (cell = c))
      }
      sinceDefaults += elapsed
      if (sinceDefaults >= DEFAULTS_EVERY_MS && !refreshing) {
        sinceDefaults = 0
        refreshing = true
        void settings.refresh(entriesOf(ctx)).finally(() => {
          refreshing = false
        })
      }
      sync(ctx)
    }
    const f = dial()
    const shown = isMounted && width > 0 && tui !== undefined
    if (shown) f.step()
    // The soundscape: heard while the scene's on screen (its events taken each frame, heard or not).
    sound.step(elapsed, { heard: shown, shown: shown ? f : undefined, scenes: [f], waiting: false, tint: driver.tint(), night: driver.isNight() })
    if (shown && tui) {
      sincePicture += elapsed
      const next = nextLines(f)
      if (next) {
        lines = next
        tui.requestRender()
      }
    }
    const pace = driver.pace()
    timer = setTimeout(() => frame(pace), pace)
  }

  const stop = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }

  pi.on('session_start', async (_e, ctx) => {
    // A new session starts on the defaults; a resumed, forked or reloaded one on its own over them. (In every
    // mode: `/flow` runs in any, and compares with the defaults as they're kept.)
    await settings.open(entriesOf(ctx))
    // The widget and its frames, only where there's a TUI to draw them.
    if (ctx.mode !== 'tui' || !ctx.hasUI) return
    ctxRef = ctx
    width = 0
    kitty = await kittyImages()
    cell = await cellPixels()
    prefs = await loadPicturePrefs()
    readClock()
    stop()
    isMounted = false
    sync(ctx)
    frame(FRAME_MS)
    // A session starting is a chance for a one-time tip (the other scenes, then the sound).
    await beginTips(settings.defaults).catch(() => {})
    const tip = await takeTip(cfg)
    if (tip) ctx.ui.notify(say(tip), 'info')
    // On a pi older than Flow is built against: said once for that version (it runs all the same).
    const warning = await versionWarning()
    if (warning) ctx.ui.notify(warning, 'warning')
  })

  // `/tree` to another branch: the settings that branch kept.
  pi.on('session_tree', async (_e, ctx) => {
    const entries = entriesOf(ctx)
    if (!ctxRef || !entries) return
    await settings.open(entries)
    width = 0
    sync(ctx)
  })

  pi.on('session_shutdown', (_e, ctx) => {
    stop()
    sound.stop()
    if (isMounted && ctx.hasUI) ctx.ui.setWidget(KEY, undefined)
    isMounted = false
    ctxRef = undefined
  })

  pi.on('agent_start', () => {
    activity.turnStarted()
    // A turn: someone's there, so the soundscape may play.
    sound.present = true
  })
  pi.on('agent_end', () => activity.turnEnded())
  pi.on('turn_start', (_e, ctx) => activity.modelStep(effortOf(ctx.thinkingLevel)))

  pi.on('message_update', e => {
    const m = e.assistantMessageEvent
    if (m.type === 'text_delta' && m.delta) activity.streamed(m.delta.length, 'text')
    else if (m.type === 'thinking_delta' && m.delta) activity.streamed(m.delta.length, 'thinking')
  })

  pi.on('tool_call', e => {
    const lines = piLinesWritten(e.toolName, e.input)
    if (lines !== undefined) activity.edited(lines)
    else if (COMMAND_TOOLS.has(e.toolName)) activity.ranCommand()
    else if (READ_TOOLS.has(e.toolName)) activity.read()
    else activity.usedTool() // an extension's tool: work too
    activity.toolsInFlight++
  })

  pi.on('tool_result', e => {
    activity.toolsInFlight = Math.max(0, activity.toolsInFlight - 1)
    if (COMMAND_TOOLS.has(e.toolName) && e.isError) activity.failed()
  })

  pi.on('session_compact', () => activity.compacted())

  /** pi shows a reply bare, so it says whose it is (Claude Code adds the name itself). */
  const say = (text: string) => `flow: ${text}`

  /** The widget redrawn at once in the new look, shown or hidden as it now is. */
  const redraw = (ctx: PiContext) => {
    width = 0
    sync(ctx)
  }

  const handler = async (args: string, ctx: PiContext) => {
    sound.present = true
    let cmd = parseFlowArgs(args)
    // (The tips begun before this `/flow` keeps anything: a first `/flow save` isn't someone who had Flow before.)
    await beginTips(settings.defaults).catch(() => {})
    readClock()
    const entries = entriesOf(ctx)
    // flow.json as it is now: what follows compares with it.
    await settings.refresh(entries)
    prefs = await loadPicturePrefs()
    if (cmd.kind === 'pick') {
      // No panes for thumbnails here: pi's own list, each scene with its blurb; the one chosen is
      // `/flow <scene>` from here on.
      const select = ctx.hasUI ? ctx.ui.select?.bind(ctx.ui) : undefined
      if (!select) {
        ctx.ui.notify(say('`/flow next` steps through the scenes, `/flow <name>` picks one'), 'warning')
        return
      }
      const options = SCENES.map(d => pickBlurb(d.name, cfg.style))
      let chosen: string | undefined
      try {
        chosen = await select('flow: pick a scene', options)
      } catch {
        chosen = undefined
      }
      const name = chosen === undefined ? undefined : SCENES[options.indexOf(chosen)]?.name
      if (!name) return
      cmd = { kind: 'style', name }
    }
    if (cmd.kind === 'layout') {
      ctx.ui.notify('flow: pi has no side panes, so the scene stays in the band above the editor', 'warning')
      return
    }
    if (cmd.kind === 'sound' && !player) {
      ctx.ui.notify('flow: the soundscapes play through afplay, which only macOS has', 'warning')
      return
    }
    const reply = await replyTo(cmd, {
      host: PI,
      agent: "pi's",
      cfg,
      get clock() {
        return driver.clock
      },
      // (Without session entries every session shares one set: none is "just this session".)
      get defaults() {
        return entries ? settings.defaults : undefined
      },
      level: () => driver.level(),
      tint: () => driver.tint(),
      save: async () => {
        const { text, saved } = await settings.save(entries)
        return { text, level: saved ? 'info' : 'warning' }
      },
      reset: async () => {
        const text = settings.reset(entries)
        redraw(ctx)
        return text
      },
      change: async changes => {
        const note = await settings.change(changes, entries)
        redraw(ctx)
        return note
      },
    })
    // A one-time tip goes under the reply, as in Claude Code and opencode.
    const tip = await takeTip(cfg)
    // (pi shows a reply as it is: no `!` before what was wrong.)
    ctx.ui.notify(say((cmd.kind === 'error' ? reply.text.replace(/^! /, '') : reply.text) + (tip ? `\n\n${tip}` : '')), reply.level)
  }
  // pi quitting: the clips playing stop with it (else each would play out, up to a bed's 14 s).
  process.once('exit', () => sound.stop())

  pi.registerCommand('flow', {
    description:
      'Ambient scenes above the editor: /flow [<scene> | pick | next | day | night | clock | auto | 1-10 | off | save | reset | help]',
    handler,
  })
}
