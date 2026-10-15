// REVISION: flow-v2-opencode-effort
//
// What Flow uses of opencode's terminal UI plugin API (@opencode/plugin/tui,
// opencode 2.0), declared here so the typecheck needs nothing installed.

import type { Renderable, RenderContext } from '@opentui/core'

/** opencode's event, as `data.listen` hands it over. */
export type OcEvent = { type: string; data?: unknown }

/** A slot's place in opencode's screen, and what its render is given. */
export type OcSlot =
  | { readonly append: 'session.composer.top' | 'sidebar.content'; readonly render: (input: { readonly sessionID: string }) => unknown }
  | { readonly prepend: 'session.composer.top' | 'sidebar.content'; readonly render: (input: { readonly sessionID: string }) => unknown }

export interface OcSelectOption<Value> {
  readonly title: string
  readonly value: Value
  readonly description?: string
}

export interface OcCommand {
  readonly id?: string
  readonly title?: string
  readonly description?: string
  readonly group?: string
  readonly slash?: { readonly name: string; readonly arguments?: true }
  readonly run: (input?: string) => void | false | Promise<void>
}

/** A plugin's durable store: JSON kept on disk, live across running opencodes. */
export type OcStore<Value> = readonly [Value, (mutation: (draft: Value) => void) => Promise<void>]

export interface OcContext {
  readonly options: Readonly<Record<string, unknown>>
  readonly renderer: RenderContext & { readonly root: Renderable }
  /** opencode's theme: its colours are OpenTUI's RGBA. */
  readonly theme: unknown
  readonly data: {
    listen(handler: (event: { details: OcEvent }) => void): () => void
    readonly session: {
      get(sessionID: string): { readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } } | undefined
      status(sessionID: string): 'idle' | 'running'
    }
    readonly location: {
      readonly model: {
        list(): readonly { readonly id: string; readonly modelID?: string; readonly providerID: string; readonly limit?: { readonly context?: number } }[] | undefined
      }
    }
  }
  readonly keymap: { layer(factory: () => { readonly mode?: string; readonly commands?: readonly OcCommand[] }): void }
  readonly storage: { store<Value extends object>(key: string, options: { readonly initial: Value }): OcStore<Value> }
  readonly ui: {
    slot(claim: OcSlot): () => void
    readonly model: { current(): { readonly providerID: string; readonly modelID: string; readonly variant?: string } | undefined }
    readonly toast: { show(options: { readonly title?: string; readonly message: string; readonly variant?: 'info' | 'warning'; readonly duration?: number }): void }
    readonly dialog: {
      alert(options: { readonly title: string; readonly message: string }): Promise<void>
      select<Value>(options: { readonly title: string; readonly options: readonly OcSelectOption<Value>[]; readonly current?: Value }): Promise<Value | undefined>
    }
  }
}
