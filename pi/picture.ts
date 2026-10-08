// REVISION: flow-v1-pictures
//
// Pictures for pi: a scene that can draw itself at real pixels (`picture`,
// earthrise so far) is sent to a terminal that speaks the kitty graphics
// protocol (Ghostty, kitty, WezTerm, Warp) as one image a frame, in place of
// its cells. The frame goes as raw RGBA, zlib-compressed, under one image id
// that each frame replaces; pi's own renderer reserves the image's rows
// (from its `r=`) and deletes it when the line changes or goes. Node only.

import { deflateSync } from 'node:zlib'

/** Whether this terminal draws kitty images: pi's own answer when it's there, else the same reading of the environment. */
export async function kittyImages(): Promise<boolean> {
  try {
    const tui = (await import('@earendil-works/pi-tui' as string)) as { getCapabilities?: () => { images: string | null } }
    if (tui.getCapabilities) return tui.getCapabilities().images === 'kitty'
  } catch {
    // Not inside pi (a test, a script): read the environment.
  }
  return kittyFromEnv(process.env)
}

/** As pi-tui reads it: PI_IMAGE_PROTOCOL first, never under tmux or screen, then the terminals known to draw them. */
export function kittyFromEnv(env: NodeJS.ProcessEnv): boolean {
  const forced = env.PI_IMAGE_PROTOCOL?.toLowerCase()
  if (forced) return forced === 'kitty'
  const term = env.TERM?.toLowerCase() ?? ''
  const program = env.TERM_PROGRAM?.toLowerCase() ?? ''
  if (env.TMUX || term.startsWith('tmux') || term.startsWith('screen')) return false
  return Boolean(
    env.KITTY_WINDOW_ID ||
      program === 'kitty' ||
      program === 'ghostty' ||
      term.includes('ghostty') ||
      env.GHOSTTY_RESOURCES_DIR ||
      env.WEZTERM_PANE ||
      program === 'wezterm' ||
      program === 'warpterminal' ||
      env.WARP_SESSION_ID,
  )
}

/** A cell's size in the terminal's pixels, as pi measured it (or a common one). */
export async function cellPixels(): Promise<{ width: number; height: number }> {
  try {
    const tui = (await import('@earendil-works/pi-tui' as string)) as { getCellDimensions?: () => { widthPx: number; heightPx: number } }
    const d = tui.getCellDimensions?.()
    if (d && d.widthPx > 0 && d.heightPx > 0) return { width: d.widthPx, height: d.heightPx }
  } catch {
    // Not inside pi.
  }
  return { width: 9, height: 18 }
}

/**
 * How many pixels to draw a picture `columns` × `rows` cells: the cells'
 * own shape, at the terminal's own pixels or fewer, at most `budget` of
 * them (the terminal scales it up to fill the cells).
 */
export function pictureSize(columns: number, rows: number, cell: { width: number; height: number }, budget: number): { w: number; h: number } {
  const fw = columns * cell.width
  const fh = rows * cell.height
  const k = Math.min(1, Math.sqrt(budget / Math.max(1, fw * fh)))
  return { w: Math.max(2, Math.round(fw * k)), h: Math.max(2, Math.round(fh * k)) }
}

const CHUNK = 4096

/**
 * The picture as a pi widget's lines: the image's escape sequence on the
 * first (placed over `columns` × `rows` cells, the cursor left where it
 * was), then empty lines for the rest of its rows.
 */
export function kittyLines(rgba: Uint8Array, w: number, h: number, columns: number, rows: number, id: number): string[] {
  const data = deflateSync(rgba, { level: 1 }).toString('base64')
  const head = `a=T,f=32,o=z,s=${w},v=${h},c=${columns},r=${rows},i=${id},C=1,q=2`
  let seq = ''
  for (let at = 0; at < data.length; at += CHUNK) {
    const more = at + CHUNK < data.length ? 1 : 0
    const part = data.slice(at, at + CHUNK)
    seq += at === 0 ? `\x1b_G${head},m=${more};${part}\x1b\\` : `\x1b_Gm=${more};${part}\x1b\\`
  }
  const lines = [seq]
  for (let i = 1; i < rows; i++) lines.push('')
  return lines
}

/** A fresh image id for this pi: random, so two extensions (or two sessions' pi) never share one. */
export function pictureId(): number {
  return 1 + Math.floor(Math.random() * 0xfffffffe)
}
