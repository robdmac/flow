// REVISION: flow-v3-color-cache
//
// A scene in opencode's terminal UI: an OpenTUI renderable as wide as its
// place (above the prompt, or the sidebar) and as tall as Flow asks, that
// paints the scene's cells straight into the frame each time it's drawn.
// The terminal's own colour (DEFAULT_COLOR) is left transparent, so what's
// behind shows through, as it does in Claude Code and pi. A press on it is
// passed on at the cell it landed on (a companion there shows its card).
//
// OpenTUI's classes are the running opencode's own, taken from what it hands
// the plugin (its renderer's root is a Renderable; its theme's colours are
// RGBA), not imported: a plugin's own files can't import opencode's packages,
// and a second copy of OpenTUI wouldn't draw into its frame.

import type { OptimizedBuffer, RenderContext, Renderable, RGBA } from '@opentui/core'

import { type Cells, DEFAULT_COLOR } from '../hooks/cells'
import { colorCache } from './colors'

/** A scene's frame at a size, or none to draw nothing. */
export type FrameAt = (columns: number, rows: number) => Cells | undefined

export interface SceneView extends Renderable {}
/** A press on the view, at a cell (its column and row in the scene). */
export type Pressed = (column: number, row: number) => void
export type SceneViewClass = new (ctx: RenderContext, frame: FrameAt, pressed: Pressed) => SceneView

type RgbaClass = { fromInts(r: number, g: number, b: number, a?: number): RGBA }

/** The first colour in opencode's theme: its class is OpenTUI's RGBA. */
function rgbaIn(theme: unknown, depth = 0): RgbaClass | undefined {
  if (typeof theme !== 'object' || theme === null || depth > 4) return undefined
  const ctor = (theme as { constructor?: Partial<RgbaClass> }).constructor
  if (typeof ctor?.fromInts === 'function') return ctor as RgbaClass
  for (const v of Object.values(theme)) {
    const found = rgbaIn(v, depth + 1)
    if (found) return found
  }
  return undefined
}

/** The view's class, on the running opencode's OpenTUI: from its renderer's root and a colour of its theme. */
export function sceneViewClass(root: Renderable, theme: unknown): SceneViewClass {
  const Base = Object.getPrototypeOf(root.constructor) as abstract new (ctx: RenderContext, options: object) => Renderable
  const Rgba = rgbaIn(theme)
  if (!Rgba) throw new Error("flow: opencode's theme has no colours to draw with")
  const clear = Rgba.fromInts(0, 0, 0, 0)
  const color = colorCache(c => (c === DEFAULT_COLOR ? clear : Rgba.fromInts((c >> 16) & 255, (c >> 8) & 255, c & 255, 255)))

  return class extends Base {
    constructor(
      ctx: RenderContext,
      private readonly frame: FrameAt,
      pressed: Pressed,
    ) {
      super(ctx, { width: '100%', height: 0, flexShrink: 0 })
      this.onMouseDown = event => pressed(event.x - this.x, event.y - this.y)
    }

    protected override renderSelf(buffer: OptimizedBuffer): void {
      const { width, height } = this
      if (width <= 0 || height <= 0) return
      const cells = this.frame(width, height)
      if (!cells) return
      const columns = Math.min(width, cells.columns)
      const rows = Math.min(height, cells.rows)
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
          const i = y * cells.columns + x
          const bg = cells.background(i)
          const char = String.fromCodePoint(cells.codePoint(i))
          if (bg === DEFAULT_COLOR) buffer.setCellWithAlphaBlending(this.x + x, this.y + y, char, color(cells.foreground(i)), clear)
          else buffer.setCell(this.x + x, this.y + y, char, color(cells.foreground(i)), color(bg))
        }
      }
    }
  }
}
