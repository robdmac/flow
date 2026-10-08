// REVISION: flow-v134-softer-breath
//
// The shared wait: how every scene looks while Claude waits on the person (a
// permission to grant, a question to answer, a plan to approve). The work
// settles (the level drops to a calm 2) and each scene holds its own way: the
// fire banks to glowing coals, the surfer sits up on the board, the skier
// stops, the engine runs down, the balloon hovers, a rocket holds its stage,
// the stars stop streaming. Over the whole frame it turns a warm sepia that
// breathes slowly: a photograph, paused, with a standby light's slow pulse.
// So it reads the same in every scene, by day or night, at any level, and
// nothing like smoke (grey) or a full context's blue. It eases in and out
// over about a second. Pure: no engine imports.

import { DEFAULT_COLOR, type Cells } from './cells'
import { clamp, mix } from './pixels'

/** How far the look moves toward the dial each frame: in, or out, over about a second at 14 fps. */
export const WAIT_EASE = 0.06
/** Frames a breath takes: about 4 s at 14 fps (a resting breath, a standby light's pulse). */
export const BREATH_FRAMES = 56
/** How much dimmer the frame is at the bottom of each breath... */
const DEPTH = 0.11
/** ...and the warm light it takes on at the top (added, so a night scene glows too). */
const GLOW = [0x17, 0x0e, 0x04] as const
/** How far colors go to sepia (the rest keeps a hint of their own hue). */
export const SEPIA_AMOUNT = 0.82
/** Sepia by brightness: black stays black (a night sky stays night), white turns to cream. */
const SEPIA = [0x000000, 0x2c1b0c, 0x6a4420, 0xb07a36, 0xe2b46a, 0xfff1d4] as const

/** `k` (0..1) eased a step toward the dial: 1 while waiting, 0 otherwise. */
export function easeWait(k: number, waiting: boolean | undefined): number {
  return clamp(k + clamp((waiting ? 1 : 0) - k, -WAIT_EASE, WAIT_EASE))
}

/**
 * The breath at frame `t`, 0 (out) .. 1 (in): a standby light's swell
 * (exp∘sin), lingering low and rising round to its peak.
 */
export function breath(t: number): number {
  const x = (((t % BREATH_FRAMES) + BREATH_FRAMES) % BREATH_FRAMES) / BREATH_FRAMES
  return (Math.exp(Math.sin(x * 2 * Math.PI - Math.PI / 2)) - 1 / Math.E) / (Math.E - 1 / Math.E)
}

/** How bright the frame is now (1 at the top of a breath), `k` of the way into the look. */
export function waitLift(k: number, t: number): number {
  return 1 - DEPTH * clamp(k) * (1 - breath(t))
}

const lum = (c: number) => (((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11) / 255

function sepia(v: number): number {
  const x = clamp(v) * (SEPIA.length - 1)
  const i = Math.min(SEPIA.length - 2, Math.floor(x))
  return mix(SEPIA[i]!, SEPIA[i + 1]!, x - i)
}

/** How much of the warm glow the frame takes on now (the top of a breath), `k` of the way into the look. */
export function waitGlow(k: number, t: number): number {
  return clamp(k) * breath(t)
}

/** One color `k` × `amount` of the way to its sepia, at brightness `lift`, with `glow` of the warm light added. */
export function waitColor(c: number, k: number, lift: number, amount = SEPIA_AMOUNT, glow = 0): number {
  if (c === DEFAULT_COLOR || k <= 0) return c
  const s = amount > 0 ? mix(c, sepia(lum(c)), k * amount) : c
  const r = Math.min(255, Math.round(((s >> 16) & 255) * lift + GLOW[0] * glow))
  const g = Math.min(255, Math.round(((s >> 8) & 255) * lift + GLOW[1] * glow))
  const b = Math.min(255, Math.round((s & 255) * lift + GLOW[2] * glow))
  return (r << 16) | (g << 8) | b
}

/**
 * The look over a finished frame, `k` (0..1, eased) of the way in, at frame
 * `t` of the breath; `amount` of sepia (none for a scene already warm, like
 * the fire: it only breathes). `lamps`, per cell, a light's own color (-1:
 * none): it keeps its color, breathing, so a signal or a lamp shines through
 * the sepia. The terminal's own color stays its own. A frame's colors all map
 * one to one, so it never holds more pairs than it did.
 */
export function waitTone(out: Cells, k: number, t: number, amount = SEPIA_AMOUNT, lamps?: Int32Array): void {
  if (k <= 0) return
  const lift = waitLift(k, t)
  const glow = waitGlow(k, t)
  const n = out.columns * out.rows
  for (let i = 0; i < n; i++) {
    const fg = out.foreground(i)
    const bg = out.background(i)
    if (fg === DEFAULT_COLOR && bg === DEFAULT_COLOR) continue
    const lamp = lamps ? lamps[i]! : -1
    const tone = (c: number) => (c === lamp ? waitColor(c, k, lift, 0) : waitColor(c, k, lift, amount, glow))
    out.set(i, out.codePoint(i), tone(fg), tone(bg))
  }
}
