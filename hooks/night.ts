// REVISION: flow-v170-dry-scenes
//
// One night for every scene that has one (balloon, the rockets, surf, ski,
// the train; the bubbles' stout): the same near-black sky, the same stars,
// the same moon in the same place, falling and lifting at the same pace
// (easeNight), so switching scenes after dark never changes the night.

import { approach } from './pixels'

/** How far night moves toward the dial each frame: half way in about a second at 14 fps, all the way in a few. */
export const NIGHT_EASE = 0.05

/**
 * How dark it is (`k`, 0 day .. 1 night) eased a step toward the dial;
 * -1 before the first frame, when it starts as asked.
 */
export function easeNight(k: number, night: boolean | undefined): number {
  const n = night ? 1 : 0
  return k < 0 ? n : approach(k, n, NIGHT_EASE)
}

/** The night sky just above the horizon: near-black with a breath of blue. */
export const NIGHT_HORIZON = 0x070b16
/** The night sky overhead, and by the edge of space. */
export const NIGHT_ZENITH = 0x020308
/** A star, and a fainter (or twinkling) one. */
export const STAR = 0xeef0f4
export const STAR_DIM = 0x7d8696
/** The moon. */
export const MOON = 0xf4f0da

/** The moon hangs this far across the grid, centered on this row (second from the top). */
export const MOON_ACROSS = 0.82
export const MOON_ROW = 1

/**
 * The moon's center on a quadrant pixel layer (two pixels per cell each way),
 * for a grid `columns` × `rows`: 82% across, in the second row.
 */
export function moonPixel(columns: number, rows: number): [x: number, y: number] {
  return [columns * 2 * MOON_ACROSS, 2 * Math.min(MOON_ROW, Math.max(0, rows - 3)) + 1]
}

/**
 * The moon's radius on a quadrant pixel layer, in pixel widths (a pixel is
 * twice as tall as it is wide): about a cell across in the band, bigger in the spine.
 */
export function moonRadius(tall: boolean): number {
  return tall ? 2.6 : 1.6
}

/**
 * How much of a moon of radius r centered at (mx, my) covers the pixel whose
 * center is (x, y), 0..1: a round disc on the screen, its edge softened over a pixel.
 */
export function moonCover(x: number, y: number, mx: number, my: number, r: number): number {
  const d = Math.hypot(x - mx, (y - my) * 2)
  return d >= r + 0.5 ? 0 : d <= r - 0.5 ? 1 : r + 0.5 - d
}
