// REVISION: flow-v188-dry
//
// Truecolor heat palettes for ember: a black-body ramp (deep red
// → orange → yellow → white-hot), a blue gas pilot for strength 1, a gray
// smoke ramp, and a blue-white core for a nearly-full context. Quantized to
// 48 steps per palette so a frame stays well inside the Raster's 1024
// distinct color pairs.

import { SMOKE_TIPS } from './fire'
import { rampStops } from './pixels'
import type { Tint } from './styles'

/** A ramp's stop: where along it (0..1), and its color (0xRRGGBB). */
type Stop = readonly [t: number, rgb: number]

const BLACKBODY: Stop[] = [
  [0, 0x300603],
  [0.18, 0x761005],
  [0.38, 0xcc3008],
  [0.58, 0xf67c14],
  [0.78, 0xffcc48],
  [1, 0xfff9da],
]
const PILOT: Stop[] = [
  [0, 0x0a124a],
  [0.5, 0x2258e2],
  [1, 0xacd8ff],
]
const BLUE_CORE: Stop[] = [
  [0, 0x300603],
  [0.3, 0x961a08],
  [0.55, 0xee7016],
  [0.75, 0x7cacff],
  [1, 0xe4f2ff],
]
const SMOKE: Stop[] = [
  [0, 0x2c2c2e],
  [1, 0xc4c4c8],
]

const STEPS = 48

const luts = new Map<Stop[], Uint32Array>()

function lut(stops: Stop[]): Uint32Array {
  let l = luts.get(stops)
  if (!l) {
    l = new Uint32Array(STEPS + 1)
    for (let i = 0; i <= STEPS; i++) l[i] = rampStops(stops, i / STEPS)
    luts.set(stops, l)
  }
  return l
}

const WISP_SMOKE: Stop[] = [
  [0, 0x2e2c2e],
  [1, 0x807a78],
]

/** Drifting smoke, `t` 0 (nearly gone) .. 1 (just turned from a spark). */
export function smokeColor(t: number): number {
  return lut(WISP_SMOKE)[Math.round(Math.min(1, Math.max(0, t)) * STEPS)]!
}

/**
 * Color for heat `t` (0..1) at `strength`: low strengths never reach the
 * white-hot end (a 4 tops out orange), strength 1 burns as a blue pilot.
 */
export function heatColor(strength: number, t: number, tint: Tint = 'normal'): number {
  if (tint === 'smoke' && t < SMOKE_TIPS) return lut(SMOKE)[Math.round((t / SMOKE_TIPS) * STEPS)]!
  const stops = tint === 'blue' ? BLUE_CORE : strength === 1 ? PILOT : BLACKBODY
  const reach = strength === 1 ? 1 : 0.52 + 0.048 * Math.min(10, strength)
  return lut(stops)[Math.round(Math.min(1, Math.max(0, t)) * reach * STEPS)]!
}
