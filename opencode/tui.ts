// REVISION: flow-v1-opencode
//
// Flow for opencode (2.0), by Rob Macrae: the same ambient scenes as the
// Claude Code mod and the pi extension, in opencode's terminal UI. A terminal
// UI plugin alone: it draws, reads opencode's events and answers `/flow`;
// nothing runs in opencode's server, and nothing it hears is changed.
//
//   the band     above the prompt of the session on screen (`session.composer.top`), 5 rows
//                (a taller scene's view, doom3d's, up to 14, never more than half the terminal)
//   the spine    `/flow spine`: in the sidebar beside the transcript (`sidebar.content`)
//   its events   mapping.ts: the session's turns, steps, streamed text, tool calls (edits push it, a failed
//                command shows as smoke), its subagents (a companion each), what it asks you (it settles
//                and breathes), compaction, how full its context is
//   /flow        the same command as in Claude Code and pi; `/flow pick` is opencode's own list
//   sound        the same soundscapes, played by afplay in the background (macOS; player.ts)
//
// Settings are per session, as elsewhere: `/flow` changes the session it runs in, kept in Flow's own
// opencode store under the session's id (the 100 used most recently), so reopening it brings them back;
// the defaults new sessions start with are the plugin's options (cli.json) and, over them, what
// `/flow save` kept in the same store, which every running opencode shares.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Activity, FRAME_MS } from '../hooks/activity'
import { staleSessions } from '../hooks/sessions'
import { type FlowConfig, type Host, parseFlowArgs, readConfig, replyTo, storedValue } from '../hooks/settings'
import { SceneDriver } from '../hooks/scene'
import { Soundscape } from '../hooks/soundscape'
import { SCENES } from '../hooks/styles'
import { FLOW_ENTRY } from '../pi/mapping'
import { PiSettings, type SessionEntries } from '../pi/session'
import { OpenCodeWork } from './mapping'
import { afplayPlayer } from './player'
import type { OcContext } from './types'
import type { SceneView } from './view'
import { sceneViewClass } from './view'

const ROWS = 5
/** A taller scene's rows (`Scene.taller`), and at most this share of the terminal's. */
const TALL_ROWS = 14
const TALL_SHARE = 0.5
/** The spine's rows in the sidebar: what the terminal leaves under opencode's own (its title, context, files), within these. */
const SPINE_ROWS = [12, 40] as const
const SPINE_LEFT = 18
/** How often the defaults are read afresh (another opencode may have saved), and the clock. */
const DEFAULTS_EVERY_MS = 30_000
const CLOCK_EVERY_MS = 5_000
/** Flow's key in opencode's storage for the plugin. */
const STORE = 'flow'

/** What Flow keeps in opencode's store: the defaults `/flow save` wrote, and each session's own settings. */
type Kept = {
  defaults: Record<string, string | number>
  sessions: Record<string, { own: Record<string, string | number>; at: number }>
}

/** The plugin's folder: its sounds/ are played from there. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function setup(ctx: OcContext): () => void {
  const player = afplayPlayer(ROOT)
  const HOST: Host = { panes: true, sound: player !== undefined, thumbnails: false }
  const activity = new Activity()
  const driver = new SceneDriver(readConfig(ctx.options), activity)
  const cfg = driver.cfg
  const sound = new Soundscape(cfg, player)
  driver.seedBase = (Date.now() % 2147483647) || 1

  const [kept, keep] = ctx.storage.store<Kept>(STORE, { initial: { defaults: {}, sessions: {} } })
  /** The defaults: the plugin's options, and what `/flow save` kept over them. */
  const settings = new PiSettings(cfg, {
    load: async () => readConfig({ ...ctx.options, ...kept.defaults }),
    save: changes =>
      keep(d => {
        for (const [k, v] of Object.entries(changes) as [keyof FlowConfig, FlowConfig[keyof FlowConfig]][]) d.defaults[k] = storedValue(k, v)
      }),
  })
  /** A session's own settings, kept in the store under its id (as pi keeps them in the session itself). */
  const entriesOf = (sessionID: string): SessionEntries => ({
    branch: () => {
      const record = kept.sessions[sessionID]
      return record ? [{ type: 'custom', id: sessionID, customType: FLOW_ENTRY, data: { own: record.own } }] : []
    },
    keep: data => {
      void keep(d => {
        d.sessions[sessionID] = { own: data.own, at: Date.now() }
      })
    },
  })
  // The sessions unused longest (past the 100 most recent, or 60 days) are dropped.
  const stale = staleSessions(
    Object.entries(kept.sessions).map(([key, r]) => ({ key, at: r.at })),
    Date.now(),
  )
  if (stale.length) void keep(d => stale.forEach(key => delete d.sessions[key]))

  /** The context limit of a session's model. */
  const contextLimit = (sessionID: string) => {
    const model = ctx.data.session.get(sessionID)?.model
    if (!model) return undefined
    const info = ctx.data.location.model.list()?.find(m => m.providerID === model.providerID && (m.id === model.id || m.modelID === model.id))
    return info?.limit?.context
  }
  const work = new OpenCodeWork(activity, contextLimit)
  const View = sceneViewClass(ctx.renderer.root, ctx.theme)

  /** Where the scene is drawn: the band above the prompt, the spine in the sidebar (the one the layout says shows). */
  const views = { band: undefined as SceneView | undefined, spine: undefined as SceneView | undefined }
  /** The session on screen, as its slot last said, and the one whose settings are shown. */
  let shownSession: { id: () => string } | undefined
  let opened: string | undefined

  /** The rows a view takes now: none while the scene is off, or in the other layout. */
  const rowsFor = (layout: 'band' | 'spine'): number => {
    if (!driver.isShown() || cfg.layout !== layout) return 0
    const terminal = ctx.renderer.height
    if (layout === 'spine') return Math.max(SPINE_ROWS[0], Math.min(SPINE_ROWS[1], terminal - SPINE_LEFT))
    return driver.scene.taller ? Math.max(ROWS, Math.min(TALL_ROWS, Math.floor(terminal * TALL_SHARE))) : ROWS
  }

  /** The scene at a view's size, stepped by the frame loop: the view only draws it. */
  const frameAt = (columns: number, rows: number) => {
    const f = driver.scene
    if (!driver.isShown()) return undefined
    f.ensure(columns, rows)
    return f.grid()
  }
  const view = (layout: 'band' | 'spine') => (input: { readonly sessionID: string }) => {
    const v = new View(ctx.renderer, frameAt)
    const rows = rowsFor(layout)
    v.visible = rows > 0
    v.height = Math.max(1, rows)
    views[layout] = v
    shownSession = { id: () => input.sessionID }
    return v
  }
  const unclaim = [
    ctx.ui.slot({ prepend: 'session.composer.top', render: view('band') }),
    ctx.ui.slot({ prepend: 'sidebar.content', render: view('spine') }),
  ]

  /**
   * The session on screen now: its settings, and the work the scene follows. Its settings are read again
   * whenever its record in the store changes: the store loads from disk after Flow starts, and another
   * opencode showing the same session may change them.
   */
  let openedAt: number | undefined
  const follow = () => {
    const id = shownSession?.id()
    if (!id) return
    const at = kept.sessions[id]?.at
    if (id === opened && at === openedAt) return
    if (id !== opened) work.show(id, ctx.data.session.status(id) === 'running')
    opened = id
    openedAt = at
    void settings.open(entriesOf(id))
  }

  let sinceDefaults = 0
  let sinceClock = CLOCK_EVERY_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  const frame = (elapsed: number) => {
    activity.tick(elapsed / FRAME_MS)
    follow()
    sinceClock += elapsed
    if (sinceClock >= CLOCK_EVERY_MS) {
      sinceClock = 0
      const d = new Date()
      driver.clock = { hour: d.getHours(), minute: d.getMinutes() }
    }
    sinceDefaults += elapsed
    if (sinceDefaults >= DEFAULTS_EVERY_MS && opened) {
      sinceDefaults = 0
      void settings.refresh(entriesOf(opened))
    }
    const f = driver.dial()
    // The one view of the layout in use, live (a view replaced or gone draws nothing).
    let live: SceneView | undefined
    for (const layout of ['band', 'spine'] as const) {
      const v = views[layout]
      if (!v || v.isDestroyed) continue
      // (Hidden rather than none tall: a renderable takes a row however short it's made.)
      const rows = rowsFor(layout)
      if (v.visible !== rows > 0) v.visible = rows > 0
      if (rows > 0 && v.height !== rows) v.height = rows
      if (rows > 0 && v.width > 0) live = v
    }
    if (live) {
      f.ensure(live.width, live.height)
      f.step()
      live.requestRender()
    }
    sound.step(elapsed, {
      heard: live !== undefined,
      shown: live ? f : undefined,
      scenes: [f],
      waiting: driver.waiting(),
      tint: driver.tint(),
      night: driver.isNight(),
    })
    const pace = driver.pace()
    timer = setTimeout(() => frame(pace), pace)
  }
  frame(FRAME_MS)

  const unlisten = ctx.data.listen(({ details }) => {
    work.event(details)
    // A turn begun on the session on screen: someone's there, so the soundscape may play.
    if (details.type === 'session.execution.started' && (details.data as { sessionID?: string } | undefined)?.sessionID === work.session) sound.present = true
  })

  /** `/flow`: the same command as in Claude Code and pi, its reply a toast. */
  const flow = async (input: string | undefined) => {
    sound.present = true
    const args = (input ?? '').trim().replace(/^\/flow\b/, '')
    let cmd = parseFlowArgs(args)
    follow()
    const entries = opened ? entriesOf(opened) : undefined
    await settings.refresh(entries)
    // The scene shows in a session: on the home screen there's none to change (the status and the help say all there is).
    if (!entries && cmd.kind !== 'show' && cmd.kind !== 'help') {
      ctx.ui.toast.show({ title: 'flow', message: 'the scene shows in a session: open one, then /flow there', variant: 'warning' })
      return
    }
    if (cmd.kind === 'pick') {
      const name = await ctx.ui.dialog.select({
        title: 'flow: pick a scene',
        options: SCENES.map(d => ({ title: d.name, value: d.name, description: d.blurb })),
        current: cfg.style,
      })
      if (!name) return
      cmd = { kind: 'style', name }
    }
    if (cmd.kind === 'sound' && !player) {
      ctx.ui.toast.show({ title: 'flow', message: 'the soundscapes play through afplay, which only macOS has', variant: 'warning' })
      return
    }
    const reply = await replyTo(cmd, {
      host: HOST,
      agent: "opencode's",
      cfg,
      get clock() {
        return driver.clock
      },
      get defaults() {
        return settings.defaults
      },
      level: () => driver.level(),
      tint: () => driver.tint(),
      save: async () => {
        const { text, saved } = await settings.save(entries)
        return { text, level: saved ? 'info' : 'warning' }
      },
      reset: async () => settings.reset(entries),
      change: changes => settings.change(changes, entries),
    })
    // (The help is long: a dialog to read at leisure. The rest is a line or two, a toast.)
    if (cmd.kind === 'help') return void (await ctx.ui.dialog.alert({ title: 'flow', message: reply.text }))
    ctx.ui.toast.show({
      title: 'flow',
      message: cmd.kind === 'error' ? reply.text.replace(/^! /, '') : reply.text,
      variant: reply.level === 'warning' ? 'warning' : 'info',
    })
  }
  ctx.keymap.layer(() => ({
    mode: 'global',
    commands: [
      {
        id: 'flow-scenes.flow',
        title: 'Flow',
        description: 'Ambient scenes above the prompt: /flow [<scene> | pick | next | day | night | auto | 1-10 | off | band | spine | sound | save | reset | help]',
        group: 'Flow',
        slash: { name: 'flow', arguments: true },
        run: input => flow(input),
      },
    ],
  }))

  // opencode quitting: the clips playing stop with it (else each would play out, up to a bed's 14 s).
  const quit = () => sound.stop()
  process.once('exit', quit)

  return () => {
    if (timer) clearTimeout(timer)
    sound.over = true
    sound.stop()
    process.off('exit', quit)
    unlisten()
    for (const f of unclaim) f()
  }
}

export default { id: 'flow-scenes', setup }
