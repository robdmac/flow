// REVISION: flow-v1-opencode
//
// What Flow uses of OpenTUI (@opentui/core 0.5), which opencode provides to a
// plugin's terminal UI at run time: a renderable that paints its own cells.
// Declared here so the typecheck needs nothing installed.

declare module '@opentui/core' {
  export interface RGBA {
    readonly r: number
  }
  export interface OptimizedBuffer {
    setCell(x: number, y: number, char: string, fg: RGBA, bg: RGBA, attributes?: number): void
    setCellWithAlphaBlending(x: number, y: number, char: string, fg: RGBA, bg: RGBA, attributes?: number): void
  }
  export interface RenderContext {
    readonly width: number
    readonly height: number
  }
  export interface RenderableOptions {
    width?: number | 'auto' | `${number}%`
    height?: number | 'auto' | `${number}%`
    flexShrink?: number
  }
  export abstract class Renderable {
    constructor(ctx: RenderContext, options: RenderableOptions)
    get x(): number
    get y(): number
    get width(): number
    set width(value: number | 'auto' | `${number}%`)
    get height(): number
    set height(value: number | 'auto' | `${number}%`)
    get isDestroyed(): boolean
    get visible(): boolean
    set visible(value: boolean)
    requestRender(): void
    protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void
  }
}
