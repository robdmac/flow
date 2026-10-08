// REVISION: flow-v150-review-fixes
//
// `/flow pick`: every scene at once, each a small live thumbnail, chosen with
// the arrows (or Tab, a click, or its number) and Enter. This is the pure part:
// how the grid of thumbnails fits the pane it's drawn in, the thumbnails
// themselves (an instance of each scene of their own, at a modest level, so
// the scene on show is never resized), and the picker's words. register.tsx
// opens the pane and draws it: a Raster a thumbnail in the terminal, an Svg
// on desktop, and a Button under each, the focus ring walking the Buttons.

import type { Cells } from './cells'
import { makeScene, SCENES, type Scene, type SceneName } from './styles'

/** The level every thumbnail runs at: lively, though not each scene's busiest. */
export const PICK_LEVEL = 6
/**
 * How often the thumbnails step (ms): 10 fps. In the terminal each is its own
 * Raster, so that's ten blits a step, which with the band's 14 a second stays
 * under the 120 a second the terminal takes.
 */
export const PICK_MS = 100
/** The width the picker's pane asks for when docked: two thumbnails across. */
export const PICK_COLUMNS = 64
/** The tallest the picker asks to be when it sits inline above the prompt. */
const PICK_MOST_ROWS = 28
/** Steps a thumbnail takes when it's built or resized, so it opens mid-flow rather than lighting up from nothing. */
const WARM_STEPS = 30

/** Thumbnail rows: 5 is the band's own height, which every scene is made for; fewer crop it. */
const THUMB_ROWS = [5, 4, 3] as const
/** Thumbnail columns: at least this many to read as the scene... */
const GOOD_COLUMNS = 20
/** ...and no more than this (wider costs more and shows little more). */
const MOST_COLUMNS = 40
/** Columns between tiles across. */
const GAP = 1
/** The number keys: the first ten scenes' hotkeys. */
const HOTKEYS = '1234567890'

/** How the picker lays its thumbnails out in the room it has. */
export type PickLayout = {
  /** Tiles across. */
  across: number
  /** Each thumbnail's size in cells. */
  columns: number
  rows: number
  /** Each tile in a frame (lit for the scene the focus is on). */
  framed: boolean
  /** Room for a line of keys above the grid and the chosen scene's blurb below. */
  lines: boolean
  /** Cells down, all told. */
  height: number
}

/** The tile shapes to try, best first: the band's 5 rows framed, then fewer rows, then no frames, then no lines. */
const SHAPES: readonly { rows: number; framed: boolean; lines: boolean }[] = [
  ...THUMB_ROWS.flatMap(rows => [
    { rows, framed: true, lines: true },
    { rows, framed: true, lines: false },
  ]),
  ...THUMB_ROWS.flatMap(rows => [
    { rows, framed: false, lines: true },
    { rows, framed: false, lines: false },
  ]),
]

/** The widest label a tile's Button shows: `starship ●` (the hotkey's `1: ` is the engine's, counted too). */
export function labelWidth(names: readonly string[] = SCENES.map(d => d.name)): number {
  return 3 + Math.max(...names.map(n => n.length)) + 2
}

/**
 * The grid for `count` scenes in a body of `columns` × `rows` cells: the
 * first shape that fits with thumbnails at least GOOD_COLUMNS wide, else at
 * least as wide as their labels, as few across as fit (so each is as wide as
 * it can be). None fits (a narrow spine-width dock): undefined, a plain list.
 * `extra`: rows the surface draws besides (desktop's close Button), counted in `height`.
 */
export function pickLayout(columns: number, rows: number, count: number, label = labelWidth(), extra = 0): PickLayout | undefined {
  for (const least of [Math.max(GOOD_COLUMNS, label), label]) {
    for (const shape of SHAPES) {
      const frame = shape.framed ? 2 : 0
      const tall = shape.rows + 1 + frame // the thumbnail, its Button, the frame
      for (let across = 1; across <= count; across++) {
        const height = Math.ceil(count / across) * tall + (shape.lines ? 2 : 0) + extra
        if (height > rows) continue
        const wide = Math.min(MOST_COLUMNS, Math.floor((columns - (across - 1) * GAP) / across) - frame)
        if (wide < least) break // more across only narrows them
        return { across, columns: wide, rows: shape.rows, framed: shape.framed, lines: shape.lines, height }
      }
    }
  }
  return undefined
}

/** The rows to ask for inline above the prompt, on a terminal `columns` wide (its frame takes a few). */
export function pickRows(columns: number): number {
  return pickLayout(Math.max(1, columns - 4), PICK_MOST_ROWS, SCENES.length)?.height ?? PICK_MOST_ROWS
}

/** The `i`th scene's hotkey: 1 to 9, then 0; none past the tenth. */
export function hotkeyFor(i: number): string | undefined {
  return HOTKEYS[i]
}

/** A tile's Button label: the scene's name, marked when it's the scene on show. */
export function pickLabel(name: string, isCurrent: boolean): string {
  return isCurrent ? `${name} ●` : name
}

/** The element keys: each scene's Button (what the focus ring and a press name), thumbnail and tile. */
export const pickKey = (name: string) => `pick:${name}`
export const thumbKey = (name: string) => `thumb:${name}`
export const tileKey = (name: string) => `tile:${name}`

/** The scene a picker Button's key names, if it is one. */
export function sceneOfKey(key: string | undefined): SceneName | undefined {
  if (!key?.startsWith('pick:')) return undefined
  const name = key.slice(5)
  return SCENES.find(d => d.name === name)?.name
}

/** The line of keys above the grid: the terminal's keys, or (desktop, elsewhere) a click. */
export function pickHint(keys: boolean): string {
  return keys ? 'arrows or Tab move · Enter or its number picks · Esc closes' : 'pick a scene'
}

/** The line under the grid: the scene the focus is on, in a few words. */
export function pickBlurb(name: SceneName, current: SceneName): string {
  const def = SCENES.find(d => d.name === name)!
  return `${name}: ${def.blurb}${name === current ? ' (on now)' : ''}`
}

/** `/flow pick`'s answer once the pane is up. */
export const PICK_OPENED = 'pick a scene for this session: arrows or Tab move, Enter (or its number) picks it, Esc closes'
/** ...and where no surface places panes. */
export const PICK_NO_PANE = 'no pane to show the scenes in here: `/flow next` steps through them, `/flow <name>` picks one'

/** Under a pick's reply when there is nothing to see it in yet: flow is off, or dark while idle. */
export function hiddenNote(mode: 'auto' | 'manual'): string {
  return mode === 'manual'
    ? 'flow is off: `/flow auto` to follow the work again, or `/flow 1`-`10`'
    : 'it shows once Claude is working (dark while idle)'
}

/**
 * A thumbnail of every scene: an instance of each of its own, at one size,
 * stepped together at PICK_LEVEL by day or night as the scene on show is.
 * No tint, no company: what the scene is, not what the work is doing.
 */
export class Thumbnails {
  private readonly scenes = new Map<SceneName, Scene>()
  private columns = 0
  private rows = 0
  night = false

  constructor(private seed = 1) {}

  /** Every thumbnail at this size; one just built, or resized, warms up first. */
  ensure(columns: number, rows: number): void {
    const resized = columns !== this.columns || rows !== this.rows
    this.columns = columns
    this.rows = rows
    for (const d of SCENES) {
      let f = this.scenes.get(d.name)
      if (f && !resized) continue
      if (!f) this.scenes.set(d.name, (f = makeScene(d.name, this.seed++)))
      this.dial(f)
      f.ensure(columns, rows)
      for (let i = 0; i < WARM_STEPS; i++) f.step()
      if (f.sounds) f.sounds.length = 0
    }
  }

  /** Whether they're built (they're dropped when the picker closes). */
  get isBuilt(): boolean {
    return this.scenes.size > 0
  }

  step(): void {
    for (const f of this.scenes.values()) {
      this.dial(f)
      f.step()
      // Nobody hears a thumbnail.
      if (f.sounds) f.sounds.length = 0
    }
  }

  grid(name: SceneName): Cells | undefined {
    return this.scenes.get(name)?.grid()
  }

  /** A thumbnail as Raster cells. */
  frame(name: SceneName): string {
    return this.scenes.get(name)?.frame() ?? ''
  }

  /** Let them all go. */
  clear(): void {
    this.scenes.clear()
    this.columns = 0
    this.rows = 0
  }

  private dial(f: Scene): void {
    f.strength = PICK_LEVEL
    f.coverageBoost = 0
    f.tint = 'normal'
    f.night = this.night
  }
}
