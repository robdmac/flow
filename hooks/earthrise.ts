// REVISION: flow-v2-earthrise-picture
//
// Earthrise (the `earthrise` scene): the Earth coming up over a cratered
// lunar horizon in long, low sunlight, after "earthrise" by @bas3line on
// ascii.rest (https://ascii.rest/earthrise/, MIT). The level is how high the
// Earth stands and how fast it turns: at 1 it is half behind the horizon,
// turning once in about two minutes; at 10 it stands clear of the horizon,
// turning every few seconds, its clouds running a little ahead. It climbs
// and sinks over several seconds as the work picks up or winds down, and a
// few stars breathe.
//
// Where the terminal draws images (pi in Ghostty, kitty, WezTerm), it is
// also drawn as a picture at real pixels (`picture`): the same world, its
// ground built a few columns a frame for each new size, the sky left clear.
//
// The ground is the original's heightfield of craters and boulders, seen
// from a camera standing on it and marched column by column, with real
// shadows marched toward the sun. It is built once a size (`resize`); each
// frame only the Earth (a lit globe with its own map of land, sea, ice and
// cloud, spun) and the stars are drawn again. Everything is laid out in the
// original's own coordinates (its 200 × 100 cells, square) and sampled into
// the pixel layer: the band sees a wide strip across the horizon (squeezed
// to fit a wide terminal), the spine a tall view, the Earth high in it.
//
// Smoke raises a grey pall of moondust over the horizon and greys
// everything; a full context turns the light cold and blue. While Claude
// waits on the person the Earth holds where it stands and stops turning
// (PixelScene breathes the frame in sepia; a picture takes the same tone).

import { FRAME_MS } from './activity'
import { CLEAR, PixelScene, type Dials, type Painter } from './pixel-scene'
import { clamp, grey, hash, hash1, luma, mix, rampAt, smoothstep as smooth } from './pixels'
import { defineScene } from './scene-def'
import { SEPIA_AMOUNT, waitColor, waitGlow, waitLift } from './waiting'

// --- the world, in the original's units --------------------------------------

/** Screen row of eye level in the original's 200 × 100 view; the horizon dips below it. */
const EYE = 37
/** Focal length, in the original's cells. */
const F = 112
const CAM_H = 20
/** The moon's radius in ground units, for the falling horizon. */
const RM = 1500
const ZMAX = 520
/** The Earth in the original's view: centre and radius (its lower edge still behind the horizon). */
const EC_X = 141
const EC_Y = 32
const ER = 22
/** Which face of the globe is turned to us at the start. */
const LON0 = 3.5
/**
 * How much of the Earth is behind the horizon at level 1 and at 10 (below 0:
 * clear of it, by that much of its radius), and how far its height moves
 * toward the level each frame (a whole climb in about ten seconds).
 */
const HID_CALM = 0.62
const HID_BUSY = -0.14
const CLIMB = 0.007
/** In the spine: the Earth's centre this many radii below the original's at level 1, and above it at 10. */
const SPINE_LOW = 0.5
const SPINE_HIGH = 0.35
/** Toward the sun: low, from the right and a little behind us (z is forward). */
const SUN = (() => {
  const v = [0.94, 0.14, -0.3]
  const l = Math.hypot(...v)
  return v.map(c => c / l) as [number, number, number]
})()

/** Turn rate (radians a second) at level 1 and at 10, eased between on a log scale. */
const SPIN_CALM = 0.05
const SPIN_BUSY = 1.6
/** Clouds run this much ahead of the ground as it turns. */
const CLOUD_AHEAD = 0.27

/**
 * The band: BAND_S of the original's cells to a pixel across (twice that
 * down), its skyline (where most of it falls) BAND_SKY of the way down,
 * and the Earth BAND_R pixels high from its centre, rising where the
 * skyline dips lowest between BAND_FROM and BAND_TO of the way across, as
 * far behind the horizon as the level puts it (or more, so its top stays in
 * the band).
 */
const BAND_S = 2.4
const BAND_SKY = 0.6
const BAND_R = 3.4
const BAND_FROM = 0.62
const BAND_TO = 0.86
/**
 * A picture: the Earth PIC_R of its height from its centre, PIC_SIZE of the
 * original's size against the ground, the skyline PIC_SKY of the way down,
 * the ground's brightness in PIC_STEPS steps.
 */
const PIC_R = 0.28
const PIC_SIZE = 0.85
const PIC_SKY = 0.55
const PIC_STEPS = 255
/** Bump when the ground changes: a picture's ground kept from before (`pictureCache`) is then made afresh. */
const GROUND_VERSION = 1
/** The widest view, in radians: a wider band is squeezed into it rather than looking round behind. */
const SPAN = 2.8
/** The spine: the Earth this much of the width, its centre this far down. */
const EARTH_W = 0.74
const EARTH_DOWN = 0.42

/** The ground's greys, dark to light (the original's palette). */
const GROUND = [0x0b0b0d, 0x18181b, 0x232326, 0x303033, 0x414143, 0x555556, 0x6b6a69, 0x83817d, 0x9c9993, 0xb6b2aa, 0xcfcac1, 0xe6e1d8, 0xf7f4ee] as const
/** Steps the ground's brightness is held to: Raster paints at most 1024 colour pairs a frame. */
const GROUND_STEPS = 28
/** A pall of moondust (smoke). */
const DUST = 0x77746f
/** At most this many ground samples down each pixel, and the Earth's across and down (fewer where a pixel is small). */
const GROUND_SUB = 3
const EARTH_SUB_X = 2
const EARTH_SUB_Y = 3
/** Toward the sun, for the Earth alone: a little more behind us than the ground's, so the globe shows a fuller face. */
const EARTH_SUN = (() => {
  const v = [0.82, 0.16, -0.75]
  const l = Math.hypot(...v)
  return v.map(c => c / l) as [number, number, number]
})()

// --- noise -------------------------------------------------------------------

/** Value noise that can wrap in x every `period` (0: never), as the globe's maps need. */
function noise(x: number, y: number, period: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  let x0 = xi
  let x1 = xi + 1
  if (period) {
    x0 = ((xi % period) + period) % period
    x1 = (x0 + 1) % period
  }
  const a = hash(x0, yi)
  const b = hash(x1, yi)
  const c = hash(x0, yi + 1)
  const d = hash(x1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function fbm(x: number, y: number, octaves: number, period: number): number {
  let s = 0
  let n = 0
  let amp = 0.5
  let f = 1
  for (let i = 0; i < octaves; i++) {
    s += amp * noise(x * f, y * f, period * f)
    n += amp
    amp *= 0.5
    f *= 2
  }
  return s / n
}

// --- the ground --------------------------------------------------------------

/** A bowl with a raised rim, r in ground units, q its distance in radii. */
const bowl = (q: number, r: number): number => r * ((q < 1 ? -0.36 * (1 - q * q) : 0) + 0.14 * Math.exp(-(((q - 1) / 0.25) ** 2)))

/** Craters scattered one to a cell. */
function craters(X: number, Z: number, cell: number, salt: number, r0: number, r1: number, p: number): number {
  const ci = Math.floor(X / cell)
  const cj = Math.floor(Z / cell)
  let h = 0
  for (let j = cj - 1; j <= cj + 1; j++) {
    for (let i = ci - 1; i <= ci + 1; i++) {
      if (hash(i + salt, j - salt) > p) continue
      const cx = (i + hash(i, j + salt * 3)) * cell
      const cz = (j + hash(i + salt * 5, j)) * cell
      const e = hash(j + salt, i - salt * 7)
      const r = cell * (r0 + (r1 - r0) * e * e)
      const dx = X - cx
      const dz = Z - cz
      const d2 = dx * dx + dz * dz
      if (d2 > 4 * r * r) continue
      h += bowl(Math.sqrt(d2) / r, r) * 0.95
    }
  }
  return h
}

/** A few big boulders in the near ground: [x, z, radius]. */
const ROCKS = [[30, 50, 2.4], [62, 63, 1.8], [12, 70, 1.3], [-4, 45, 1.2], [90, 55, 1.6], [46, 90, 1.4]] as const

function height(X: number, Z: number): number {
  let h = 6 * fbm(X * 0.006 + 50, Z * 0.006 + 50, 3, 0) + 0.6 * fbm(X * 0.04, Z * 0.04, 2, 0)
  // Old, worn highlands at the edge of sight, rising to the left, and a lower ridge in front of them.
  if (Z > 150) {
    const lift = smooth(150, 300, Z)
    const m = 1 - Math.abs(2 * fbm(X * 0.006 + 7, Z * 0.006, 4, 0) - 1)
    h += lift * (28 * Math.exp(-(((X + 260) / 230) ** 2)) + 45 * (m * m - 0.35))
    const ridge = Math.exp(-(((Z - 205) / 20) ** 2)) * Math.exp(-(((X + 140) / 130) ** 2))
    h += ridge * 22 * (0.35 + fbm(X * 0.018 + 3, Z * 0.01, 3, 0))
  }
  // Big basins only out in the middle distance, so we do not stand in one.
  if (Z > 90) h += craters(X, Z, 110, 11, 0.14, 0.34, 0.55) * smooth(90, 150, Z)
  if (Z < 300) h += craters(X, Z, 34, 23, 0.12, 0.36, 0.85)
  if (Z < 170) h += craters(X, Z, 10, 37, 0.12, 0.34, 0.85) * smooth(170, 110, Z)
  // One big crater in the near ground, off to the left.
  {
    const dx = X + 24
    const dz = Z - 58
    const q = Math.sqrt(dx * dx + dz * dz) / 16
    if (q < 2) h += bowl(q, 16)
  }
  // Boulders strewn close by, and a few big ones.
  if (Z < 90) {
    const c = 5
    const ci = Math.floor(X / c)
    const cj = Math.floor(Z / c)
    if (hash(ci + 91, cj) < 0.14) {
      const bx = (ci + 0.2 + 0.6 * hash(ci, cj + 92)) * c
      const bz = (cj + 0.2 + 0.6 * hash(ci + 93, cj)) * c
      const br = 0.3 + 0.5 * hash(ci + 94, cj + 95) ** 2
      const d2 = ((X - bx) ** 2 + (Z - bz) ** 2) / (br * br)
      if (d2 < 4) h += br * 0.9 * Math.exp(-d2 * 1.4)
    }
    for (const [bx, bz, br] of ROCKS) {
      const d2 = ((X - bx) ** 2 + (Z - bz) ** 2) / (br * br)
      if (d2 < 1) h += br * (0.85 + 0.3 * noise(X * 1.3, Z * 1.3, 0)) * Math.sqrt(1 - d2)
    }
  }
  return h
}

/** The camera's height. */
const camY = (() => {
  let y: number | undefined
  return () => (y ??= height(0, 7) + CAM_H)
})()

/** The row (in the original's view) the skyline falls at, looking `ang` radians right of ahead. */
function skyline(ang: number): number {
  const sx = Math.sin(ang)
  const cz = Math.cos(ang)
  let top = Infinity
  for (let D = 20; D < ZMAX; D += 0.03 + D * 0.012) {
    const Y = height(sx * D, cz * D) - (D * D) / (2 * RM)
    top = Math.min(top, EYE - (F * (Y - camY())) / D)
  }
  return top
}

/** How bright the ground is at (X, Z), height Y, from the camera at height camY; `crest` near the far skyline. */
function groundLight(X: number, Z: number, Y: number, camY: number, crest: number): number {
  const e = 0.1 + Z * 0.004
  const hx = (height(X + e, Z) - height(X - e, Z)) / (2 * e)
  const hz = (height(X, Z + e) - height(X, Z - e)) / (2 * e)
  const nl = Math.hypot(hx, 1, hz)
  const lam = (-hx * SUN[0] + SUN[1] - hz * SUN[2]) / nl
  // Toward the eye, for the moon's own way of reflecting (Lommel-Seeliger).
  const vx = -X
  const vy = camY - Y
  const vz = -Z
  const vl = Math.hypot(vx, vy, vz)
  const mu = Math.max(0.02, (-hx * vx + vy - hz * vz) / (nl * vl))
  let lit = 0
  if (lam > 0) {
    // March toward the sun; a soft edge for the sun's own width. Each point starts its steps a little
    // differently, so the shadows' edges don't step with the march.
    lit = 1
    let s = (0.1 + Z * 0.003) * (0.6 + 0.8 * hash(Math.floor(X * 37), Math.floor(Z * 37), 41))
    while (s < 120) {
      const d = Y + SUN[1] * s - height(X + SUN[0] * s, Z + SUN[2] * s)
      if (d < 0) {
        lit = 0
        break
      }
      lit = Math.min(lit, (d * 30) / s)
      s += 0.05 + s * 0.2
    }
    lit = smooth(0, 1, lit)
  }
  // Regolith: patchy, the maria darker.
  const albedo =
    0.5 +
    0.9 * fbm(X * 0.025 + 3, Z * 0.025, 3, 0) +
    0.3 * (fbm(X * 0.35, Z * 0.35, 2, 0) - 0.5) -
    0.22 * smooth(0.46, 0.64, fbm(X * 0.0035, Z * 0.0035 + 20, 3, 0))
  const ls = lam > 0 ? ((0.2 * lam) / (lam + mu) + 2.6 * lam) * lit : 0
  let b = (1 - Math.exp(-ls * 1.5)) * albedo
  // The far crest catches the sun along its whole length.
  if (crest < 2 && lit > 0.2) b = Math.max(b, (crest < 1 ? 0.85 : 0.55) * albedo)
  return b
}

// --- the Earth's maps --------------------------------------------------------

/** Equirectangular maps, wrapping in longitude: surface colour, open sea, cloud. */
const TW = 192
const TH = 96
type Maps = { r: Float32Array; g: Float32Array; b: Float32Array; sea: Float32Array; cloud: Float32Array }
let maps: Maps | undefined

/** The globe's maps: made once, on first use, and shared. */
function earthMaps(): Maps {
  if (maps) return maps
  const n = TW * TH
  const tr = new Float32Array(n)
  const tg = new Float32Array(n)
  const tb = new Float32Array(n)
  const sea = new Float32Array(n)
  const cloud = new Float32Array(n)
  const elev = new Float32Array(n)
  const storms = [[0.9, 0.8, 1], [3.1, -0.85, -1], [4.6, 0.62, 1], [1.9, 0.25, 1], [5.6, -0.55, -1]] as const
  for (let j = 0; j < TH; j++) {
    const v = (j + 0.5) / TH
    const lat = (0.5 - v) * Math.PI
    const al = Math.abs(lat)
    for (let i = 0; i < TW; i++) {
      const u = i / TW
      const lon = u * Math.PI * 2
      const t = j * TW + i
      const wx = fbm(u * 6, v * 3 + 9, 3, 6)
      elev[t] = fbm(u * 8 + 1.6 * wx, v * 4, 5, 8) - 0.04 * smooth(1.2, 1.5, al)
      // Clouds: warped noise, wound into spirals around a few storms.
      let cx = u * 14
      let cy = v * 7
      for (const [slon, slat, spin] of storms) {
        let dl = lon - slon
        dl -= Math.round(dl / (Math.PI * 2)) * Math.PI * 2
        const lx = dl * Math.cos(lat)
        const ly = lat - slat
        const a = spin * 5 * Math.exp(-Math.hypot(lx, ly) / 0.2)
        if (a * spin > 0.02) {
          const ca = Math.cos(a)
          const sa = Math.sin(a)
          cx += ((lx * ca - ly * sa - lx) / (Math.PI * 2)) * 14
          cy -= ((lx * sa + ly * ca - ly) / Math.PI) * 7
        }
      }
      // Streaked along the winds, folded into filaments the way fronts string out.
      const q = fbm(cx * 0.5 + 3, cy * 1.2, 3, 7)
      const n0 = fbm(cx + 1.6 * q, cy * 1.3 + 0.5 * q, 5, 14)
      const nn = 0.4 * n0 + 0.6 * (1 - Math.abs(2 * fbm(cx * 1.5 + 2.2 * q, cy * 1.6 + 9, 4, 21) - 1))
      // Cloudy at the equator and in the storm belts, clearer in the subtropics.
      const belt = 0.05 * Math.exp(-((lat / 0.12) ** 2)) - 0.07 * Math.exp(-(((al - 0.42) / 0.16) ** 2)) + 0.05 * Math.exp(-(((al - 0.95) / 0.25) ** 2))
      cloud[t] = nn + belt
    }
  }
  // Thresholds by share of the globe: about three tenths land, a third cloud.
  const quantile = (A: Float32Array, p: number): number => Float32Array.from(A).sort()[Math.floor(p * (A.length - 1))]!
  const shore = quantile(elev, 0.7)
  const c0 = quantile(cloud, 0.6)
  const c1 = quantile(cloud, 0.86)
  for (let j = 0; j < TH; j++) {
    const v = (j + 0.5) / TH
    const al = Math.abs((0.5 - v) * Math.PI)
    for (let i = 0; i < TW; i++) {
      const u = i / TW
      const t = j * TW + i
      const e = elev[t]!
      const land = smooth(shore - 0.004, shore + 0.006, e)
      const ice = smooth(1.22, 1.32, al + 0.12 * fbm(u * 12, v * 6, 2, 12))
      // Desert in the subtropics and on high ground, forest and scrub elsewhere, broken up finely.
      const grain = fbm(u * 36 + 2, v * 18, 3, 36) - 0.5
      const arid = clamp(Math.exp(-(((al - 0.4) / 0.22) ** 2)) * (0.1 + 1.2 * fbm(u * 10 + 4, v * 5, 3, 10)) + (e - shore - 0.04) * 4 + 0.8 * grain)
      const relief = 1 + 1.2 * grain - 2.5 * Math.max(0, e - shore - 0.08)
      let r = lerp(0.13, 0.4, arid) * relief
      let g = lerp(0.25, 0.34, arid) * relief
      let b = lerp(0.08, 0.19, arid) * relief
      // Ocean, lighter over the shelves near the coasts.
      const shelf = smooth(shore - 0.06, shore, e)
      r = lerp(lerp(0.025, 0.07, shelf), r, land)
      g = lerp(lerp(0.11, 0.3, shelf), g, land)
      b = lerp(lerp(0.38, 0.62, shelf), b, land)
      tr[t] = lerp(r, 0.92, ice)
      tg[t] = lerp(g, 0.95, ice)
      tb[t] = lerp(b, 0.99, ice)
      sea[t] = (1 - land) * (1 - ice)
      cloud[t] = smooth(c0, c1, cloud[t]!)
    }
  }
  maps = { r: tr, g: tg, b: tb, sea, cloud }
  return maps
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k

/** A map at longitude `lon` and map row `vy`, bilinear, wrapping round. */
function sample(A: Float32Array, lon: number, vy: number): number {
  const fx = ((((lon / (Math.PI * 2)) % 1) + 1) % 1) * TW
  const x0 = Math.floor(fx) % TW
  const ax = fx - Math.floor(fx)
  const x1 = (x0 + 1) % TW
  const y0 = Math.max(0, Math.min(TH - 2, Math.floor(vy)))
  const ay = clamp(vy - y0)
  const a = A[y0 * TW + x0]!
  const b = A[y0 * TW + x1]!
  const c = A[y0 * TW + TW + x0]!
  const d = A[y0 * TW + TW + x1]!
  return a + (b - a) * ax + (c - a) * ay + (a - b - c + d) * ax * ay
}

/** Toward the sun in screen space (z toward us), and halfway to the eye, for the sea's glint. */
const L = [EARTH_SUN[0], EARTH_SUN[1], -EARTH_SUN[2]] as const
const HV = (() => {
  const v = [L[0], L[1], L[2] + 1]
  const l = Math.hypot(...v)
  return v.map(c => c / l) as [number, number, number]
})()
const TILT = 0.4
const NOD = 0.22
const CT = Math.cos(TILT)
const ST = Math.sin(TILT)
const CN = Math.cos(NOD)
const SN = Math.sin(NOD)

/**
 * One point of the sky round the Earth, (dx, dy) from its centre over its
 * radius `er` (the original's cells, its radius ER): [r, g, b, alpha], into `out`.
 */
function earthAt(dx: number, dy: number, er: number, spin: number, drift: number, out: Float32Array): void {
  const m = earthMaps()
  // In the original's measure, whatever the size it's drawn at.
  dx *= ER / er
  dy *= ER / er
  let cr = 0
  let cg = 0
  let cb = 0
  let a = 0
  const d = Math.hypot(dx, dy)
  // The Earth's air: a thin blue rim on its sunlit side.
  if (d >= ER - 1 && d < ER + 12) {
    const side = smooth(-0.3, 0.75, (dx * L[0] - dy * L[1]) / d)
    let g = Math.exp(-Math.max(0, d - ER) / 1.2) * 0.55 * side
    if (g < 0.05) g = 0
    cr += 0.25 * g
    cg += 0.52 * g
    cb += 1.0 * g
    a = Math.max(a, clamp(g * 3))
  }
  if (d < ER) {
    const nx = dx / ER
    const ny = -dy / ER
    const q2 = nx * nx + ny * ny
    const nz = Math.sqrt(1 - q2)
    // Into the globe's own frame: tip the pole toward us, then lean it.
    const ax = nx * CT + ny * ST
    const ay0 = -nx * ST + ny * CT
    const ay = ay0 * CN - nz * SN
    const az = ay0 * SN + nz * CN
    const lat = Math.asin(clamp(ay, -1, 1))
    const lon = Math.atan2(ax, az) + LON0 + spin
    const vy = (0.5 - lat / Math.PI) * TH - 0.5
    const ndl = nx * L[0] + ny * L[1] + nz * L[2]
    // Full sun at the right limb, dimming toward the terminator, so the disc reads as a ball.
    const day = smooth(-0.005, 0.06, ndl) * (0.45 + 0.8 * Math.sqrt(clamp(ndl)))
    const dusk = Math.exp(-(((ndl - 0.02) / 0.035) ** 2))
    const cl = sample(m.cloud, lon + drift, vy)
    // The cloud's own shadow, offset away from the sun.
    const sh = sample(m.cloud, lon + drift - 0.03, vy + 0.4)
    const sw = sample(m.sea, lon, vy)
    const shade = 1 - 0.45 * sh * (1 - cl)
    let er = lerp(sample(m.r, lon, vy) * shade, 0.95, cl)
    let eg = lerp(sample(m.g, lon, vy) * shade, 0.97, cl)
    let eb = lerp(sample(m.b, lon, vy) * shade, 1.0, cl)
    er *= day * (1 + 0.06 * dusk)
    eg *= day * (1 - 0.03 * dusk)
    eb *= day * (1 - 0.1 * dusk)
    const glint = Math.pow(Math.max(0, nx * HV[0] + ny * HV[1] + nz * HV[2]), 70) * 0.8 * sw * (1 - cl)
    const rim = Math.pow(1 - nz, 2.2) * smooth(0, 0.3, ndl)
    er += glint * 0.95 + rim * 0.2
    eg += glint * 0.92 + rim * 0.42
    eb += glint * 0.85 + rim * 0.85
    // A crisp edge where the disc meets space; the night side is a void.
    const edge = smooth(1, 0.95, Math.sqrt(q2))
    cr = lerp(cr, er, edge)
    cg = lerp(cg, eg, edge)
    cb = lerp(cb, eb, edge)
    a = lerp(a, clamp(Math.max(er, eg, eb) * 12), edge)
  }
  out[0] = cr
  out[1] = cg
  out[2] = cb
  out[3] = a
}

/** Light (0..~1.2 a channel) as a colour, a little lifted, held to 5 bits a channel (`bits`: Raster's colour pairs are few). */
function lightColor(r: number, g: number, b: number, bits = 0xf8): number {
  const c = (v: number) => Math.min(255, Math.round(Math.pow(clamp(v, 0, 1.2) / 1.2, 0.72) * 255 * 1.22)) & bits
  return (c(r) << 16) | (c(g) << 8) | c(b)
}

// --- the scene ---------------------------------------------------------------

/**
 * One way of seeing the world at one size: the original's (col, row) under
 * pixel (x, y) is (col0 + x·s, row0 + y·sy), its columns turned by `k`; the
 * Earth's centre `ex` and radius `er` in the same units, its centre `eyLow`
 * at level 1 and `eyHigh` at 10. The ground under each pixel (its
 * brightness, or -1 for sky) is built `done` columns so far; `near` marks
 * the sky the Earth and its air can reach, once it's all built.
 */
type Layout = {
  pw: number
  ph: number
  s: number
  sy: number
  col0: number
  row0: number
  k: number
  ex: number
  eyLow: number
  eyHigh: number
  er: number
  ground: Float32Array
  near: Uint8Array
  done: number
  /** Ground samples down each pixel, and their rows. */
  sub: number
  at: Float32Array
  /** How many steps the ground's brightness is held to. */
  steps: number
}

/** The ground's sample buffers, shared (one column at a time). */
let gx = new Float32Array(0)
let gz = new Float32Array(0)
let gy = new Float32Array(0)

/** A picture's pixels: its colour (CLEAR for the open sky) and how much it covers (0..1). */
type Canvas = { w: number; h: number; px: Int32Array; alpha: Float32Array; rgba: Uint8Array }

export class Earthrise extends PixelScene {
  /** The view the cells see, and a picture's. */
  private cells: Layout = layout(0, 0, 2, false)
  private pic: Layout | undefined
  private canvas: Canvas | undefined
  /** How far the Earth has turned, and its clouds (radians): each one made starts on its own face. */
  private spin = hash1(this.seed) * Math.PI * 2
  private drift = 0
  /** How high the Earth stands, 0 (level 1) .. 1 (level 10), eased; NaN until the first frame. */
  private alt = Number.NaN
  /** Smoke and blue, eased (0..1). */
  private kSmoke = 0
  private kBlue = 0
  private readonly rgba = new Float32Array(4)

  protected resize(d: Dials): void {
    this.cells = layout(d.columns * 2, d.rows * 2, 2, d.tall)
    build(this.cells, Infinity)
  }

  protected update(d: Dials): void {
    // The level is how high it stands and how fast it turns; waiting on the person, it holds and stops.
    const busy = clamp((d.level - 1) / 9)
    if (Number.isNaN(this.alt)) this.alt = busy
    else if (d.wait < 0.5) this.alt += clamp(busy - this.alt, -CLIMB, CLIMB)
    const rate = SPIN_CALM * Math.pow(SPIN_BUSY / SPIN_CALM, busy) * (1 - d.wait)
    const dt = FRAME_MS / 1000
    this.spin += rate * dt
    this.drift += rate * CLOUD_AHEAD * dt
    this.kSmoke = clamp(this.kSmoke + clamp((d.tint === 'smoke' ? 1 : 0) - this.kSmoke, -0.05, 0.05))
    this.kBlue = clamp(this.kBlue + clamp((d.tint === 'blue' ? 1 : 0) - this.kBlue, -0.04, 0.04))
  }

  /** A colour as the tints show it now. */
  private tinted(c: number): number {
    if (this.kSmoke > 0) c = mix(grey(c, 0.9), 0x8a8682, this.kSmoke * 0.5 * (1 - luma(c) / 255))
    if (this.kBlue > 0) {
      const v = luma(c) / 255
      const cold = ((Math.round(v * 40) & 255) << 16) | ((Math.round(14 + v * 100) & 255) << 8) | Math.round(60 + v * 195)
      c = mix(c, cold, this.kBlue * 0.85)
    }
    return c
  }

  /**
   * The ground, the moondust and the Earth into `px` (CLEAR left for the open
   * sky); `alpha`, for a picture, takes how much of each pixel they cover
   * (without it, the faint edge of the Earth's air is left out).
   */
  private paintWorld(L: Layout, px: Int32Array, alpha: Float32Array | undefined, d: Dials): void {
    const { pw, ph, s, sy, col0, row0, ex, er, steps } = L
    const tSec = (d.t * FRAME_MS) / 1000
    const ey = lerp(L.eyLow, L.eyHigh, Number.isNaN(this.alt) ? clamp((d.level - 1) / 9) : this.alt)
    const bits = alpha ? 0xff : 0xf8

    // The ground, as built.
    for (let i = 0; i < pw * ph; i++) {
      const b = L.ground[i]!
      if (b < 0) continue
      const q = Math.round(Math.pow(clamp(b), 0.85) * steps) / steps
      px[i] = this.tinted(rampAt(GROUND, q))
      if (alpha) alpha[i] = 1
    }

    // Moondust (smoke): a grey pall over the horizon, drifting.
    if (this.kSmoke > 0) {
      const dustSteps = alpha ? 24 : 6
      for (let x = 0; x < pw; x++) {
        let sky = 0
        while (sky < ph && L.ground[sky * pw + x]! < 0) sky++
        const col = col0 + x * s
        for (let y = 0; y < sky; y++) {
          const up = (sky - y) / Math.max(4, ph * 0.5)
          const n = fbm(col * 0.033 + tSec * 0.4, (row0 + y * sy) * 0.0625, 2, 0)
          const k = this.kSmoke * clamp(1.3 - up) * (0.55 + 0.45 * n)
          if (k <= 0.12) continue
          const i = y * pw + x
          px[i] = mix(0x1c1b1a, DUST, Math.round(k * dustSteps) / dustSteps)
          if (alpha) alpha[i] = Math.min(1, k * 1.6)
        }
      }
    }

    // The Earth and its air.
    const out = this.rgba
    const nx = Math.max(1, Math.min(EARTH_SUB_X, Math.round(s)))
    const ny = Math.max(1, Math.min(EARTH_SUB_Y, Math.round(sy)))
    const sw = s / nx
    const shh = sy / ny
    const pall = this.kSmoke
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const i = y * pw + x
        if (!L.near[i]) continue
        let r = 0
        let g = 0
        let b = 0
        let a = 0
        for (let jy = 0; jy < ny; jy++) {
          const dy = row0 + y * sy + (jy + 0.5) * shh - ey
          for (let jx = 0; jx < nx; jx++) {
            const dx = col0 + x * s + (jx + 0.5) * sw - ex
            earthAt(dx, dy, er, this.spin, this.drift, out)
            r += out[0]!
            g += out[1]!
            b += out[2]!
            a += out[3]!
          }
        }
        const m = nx * ny
        a /= m
        if (a < (alpha ? 0.02 : 0.3)) continue
        const c = this.tinted(lightColor(r / m / a, g / m / a, b / m / a, bits))
        const under = px[i]!
        if (!alpha) {
          // Through the pall the Earth shows dimmer.
          px[i] = under === CLEAR ? c : mix(under, c, 1 - pall * 0.5)
          continue
        }
        const k = Math.min(1, a) * (1 - pall * 0.5)
        if (under === CLEAR) {
          px[i] = c
          alpha[i] = Math.min(1, a)
        } else {
          px[i] = mix(under, c, k / Math.max(k, alpha[i]!) || 1)
          alpha[i] = Math.max(alpha[i]!, k)
        }
      }
    }
  }

  paint(px: Painter, d: Dials): void {
    const L = this.cells
    const { pw, s, sy, col0, row0 } = L
    this.paintWorld(L, px.px, undefined, d)
    const tSec = (d.t * FRAME_MS) / 1000

    // Stars: braille specks in the open sky, thicker along the galaxy, none near the Earth; a few breathe.
    const dw = px.dw
    const dh = px.dh
    const density = 0.011 * (1 + d.boost / 30)
    for (let y = 0; y < dh; y++) {
      const pyy = y >> 1
      const row = row0 + ((y + 0.5) / 2) * sy
      for (let x = 0; x < dw; x++) {
        const i = pyy * pw + x
        if (L.near[i] || px.px[i] !== CLEAR) continue
        const cell = (pyy >> 1) * (pw >> 1) + (x >> 1)
        // A cell any of whose pixels are painted keeps clear of specks.
        const c0 = (pyy & ~1) * pw + (x & ~1)
        if (px.px[c0] !== CLEAR || px.px[c0 + 1] !== CLEAR || px.px[c0 + pw] !== CLEAR || px.px[c0 + pw + 1] !== CLEAR) continue
        const v = this.star(x, y, col0 + (x + 0.5) * s, row, density, tSec)
        if (v < 0) continue
        const star = this.tinted(v | 0x101010)
        // A cell's specks share one colour: the brightest of them.
        const prev = px.dots[cell] ? px.dotColor[cell]! : -1
        px.dot(x, y, star)
        if (prev >= 0 && luma(prev) > luma(star)) px.dotColor[cell] = prev
      }
    }
  }

  /** A star at speck (x, y), at (col, row) in the original's view: its colour, or -1 for none. */
  private star(x: number, y: number, col: number, row: number, density: number, tSec: number, bits = 0xf8): number {
    const bandD = (row - (4 + col * 0.32)) / 1.05
    const band = Math.exp(-((bandD / 10) ** 2)) * smooth(120, 70, col)
    const h = hash(x * 3 + 1, y * 7 + 2, 11)
    if (h < 1 - density * (1 + 3 * band)) return -1
    let v = 0.25 + 0.75 * Math.pow(hash(x + 17, y + 29, 5), 3)
    // One in eight breathes, each at its own pace.
    const tw = hash(x, y, 23)
    if (tw > 0.875) v *= 0.55 + 0.45 * Math.sin((tSec / (3 + 3 * hash(x, y, 31))) * Math.PI * 2 + tw * 50)
    v *= 1 - 0.6 * this.kSmoke
    const tint = hash(x + 5, y + 77, 3)
    const [tr, tg, tb] = tint < 0.3 ? [0.84, 0.9, 1] : tint > 0.88 ? [1, 0.93, 0.84] : [0.96, 0.96, 0.98]
    return lightColor(v * tr, v * tg, v * tb, bits)
  }

  /**
   * This frame as a picture `w` × `h` pixels (square), RGBA, the open sky
   * transparent: for a terminal that draws images. A new size's ground is
   * built at most `budget` pixels a call; until it's all built (and at level
   * 0) there is no picture: draw `grid()`.
   */
  picture(w: number, h: number, budget = Infinity): Uint8Array | undefined {
    if (this.strength <= 0 || w < 2 || h < 2) return undefined
    let L = this.pic
    if (!L || L.pw !== w || L.ph !== h) L = this.pic = layout(w, h, 1, h > w)
    if (L.done < w) {
      build(L, budget)
      if (L.done < w) return undefined
    }
    let cv = this.canvas
    if (!cv || cv.w !== w || cv.h !== h) {
      cv = this.canvas = { w, h, px: new Int32Array(w * h), alpha: new Float32Array(w * h), rgba: new Uint8Array(w * h * 4) }
    }
    const d = this.dials()
    const { px, alpha, rgba } = cv
    px.fill(CLEAR)
    alpha.fill(0)
    this.paintWorld(L, px, alpha, d)

    // Stars: a pixel each in the open sky, as thick across the sky as the specks are.
    const tSec = (d.t * FRAME_MS) / 1000
    const density = 0.011 * (1 + d.boost / 30) * ((L.s * L.sy) / (BAND_S * BAND_S))
    for (let y = 0; y < h; y++) {
      const row = L.row0 + (y + 0.5) * L.sy
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (L.near[i] || px[i] !== CLEAR) continue
        const v = this.star(x, y, L.col0 + (x + 0.5) * L.s, row, density, tSec, 0xff)
        if (v < 0) continue
        px[i] = this.tinted(v)
        alpha[i] = 1
      }
    }

    // Waiting on the person: the same sepia breath as the cells'.
    const lift = d.wait > 0 ? waitLift(d.wait, d.t) : 1
    const glow = d.wait > 0 ? waitGlow(d.wait, d.t) : 0
    for (let i = 0, o = 0; i < w * h; i++, o += 4) {
      let c = px[i]!
      if (c === CLEAR) {
        rgba[o + 3] = 0
        continue
      }
      if (d.wait > 0) c = waitColor(c, d.wait, lift, SEPIA_AMOUNT, glow)
      rgba[o] = (c >> 16) & 255
      rgba[o + 1] = (c >> 8) & 255
      rgba[o + 2] = c & 255
      rgba[o + 3] = Math.round(clamp(alpha[i]!) * 255)
    }
    return rgba
  }

  pictureKey(w: number, h: number): string {
    return `earthrise-ground-v${GROUND_VERSION}-${w}x${h}`
  }

  pictureCache(): { key: string; data: Float32Array } | undefined {
    const L = this.pic
    return L && L.done >= L.pw ? { key: this.pictureKey(L.pw, L.ph), data: L.ground } : undefined
  }

  restorePicture(w: number, h: number, data: Float32Array): boolean {
    if (w < 2 || h < 2 || data.length !== w * h) return false
    const L = layout(w, h, 1, h > w)
    L.ground.set(data)
    L.done = w
    markNear(L)
    this.pic = L
    return true
  }
}

/** The view for `pw` × `ph` pixels, each `ry` times as tall as it is wide; its ground not yet built. */
function layout(pw: number, ph: number, ry: number, tall: boolean): Layout {
  let s: number
  let col0: number
  let row0: number
  let ex: number
  let er: number
  let eyLow: number
  let eyHigh: number
  if (pw <= 0 || ph <= 0) {
    s = 1
    col0 = row0 = 0
    ex = EC_X
    er = ER
    eyLow = eyHigh = EC_Y
  } else if (!tall) {
    // A picture's pixels are square and many: the Earth a share of its height. The cells' are BAND_S across.
    const pic = ry === 1
    const rpx = pic ? PIC_R * ph : BAND_R
    s = pic ? (ER * PIC_SIZE) / (rpx * ry) : BAND_S
    const sy = ry * s
    er = rpx * sy
    col0 = 100 - 0.5 * pw * s
    const k = Math.min(1, (SPAN * F) / (pw * s))
    const skyAt = (col: number) => skyline(((col - 100) / F) * k)
    // Where the skyline falls, across the band: its middle sets how much ground shows.
    const sky: number[] = []
    for (let i = 0; i < 24; i++) sky.push(skyAt(col0 + ((i + 0.5) / 24) * pw * s))
    sky.sort((p, q) => p - q)
    row0 = sky[12]! - (pic ? PIC_SKY : BAND_SKY) * ph * sy
    // The Earth: where the skyline under it dips lowest.
    ex = col0 + BAND_TO * pw * s
    let low = -Infinity
    for (let i = 0; i <= 12; i++) {
      const col = col0 + (BAND_FROM + ((BAND_TO - BAND_FROM) * i) / 12) * pw * s
      const under = Math.min(skyAt(col - er * 0.6), skyAt(col), skyAt(col + er * 0.6))
      if (under > low) {
        low = under
        ex = col
      }
    }
    // Its top kept in the band, a little clear of the edge.
    const top = row0 + er + Math.max(0.4 * sy, 0.08 * er)
    eyLow = Math.max(top, low + er * (2 * HID_CALM - 1))
    eyHigh = Math.max(top, low + er * (2 * HID_BUSY - 1))
  } else {
    // As wide as the Earth wants of the width, or no more than four tenths of the height.
    s = Math.max((2 * ER) / (EARTH_W * pw), (2 * ER) / (0.4 * ry * ph))
    col0 = EC_X - 0.5 * pw * s
    row0 = EC_Y - EARTH_DOWN * ph * ry * s
    ex = EC_X
    er = ER
    eyLow = EC_Y + SPINE_LOW * ER
    eyHigh = EC_Y - SPINE_HIGH * ER
  }
  const sy = ry * s
  const sub = Math.max(1, Math.min(GROUND_SUB, Math.round(sy)))
  const rows = ph * sub
  const at = new Float32Array(rows)
  for (let i = 0; i < rows; i++) at[i] = row0 + ((i + 0.5) / sub) * sy
  return {
    pw,
    ph,
    s,
    sy,
    col0,
    row0,
    k: Math.min(1, (SPAN * F) / (Math.max(1, pw) * s)),
    ex,
    eyLow,
    eyHigh,
    er,
    ground: new Float32Array(pw * ph).fill(-1),
    near: new Uint8Array(pw * ph),
    done: 0,
    sub,
    at,
    steps: ry === 1 ? PIC_STEPS : GROUND_STEPS,
  }
}

/**
 * Build `L`'s ground on from where it got to, about `budget` pixels' worth:
 * march each pixel column from near to far, then light what each pixel sees.
 * Once the last column is in, mark where the Earth can reach.
 */
function build(L: Layout, budget: number): void {
  const { pw, ph, s, sy, col0, row0, k, ex, er, sub, at, ground } = L
  if (L.done >= pw) return
  const rows = ph * sub
  if (gx.length < rows) {
    gx = new Float32Array(rows)
    gz = new Float32Array(rows)
    gy = new Float32Array(rows)
  }
  const cam = camY()
  let spent = 0
  while (L.done < pw && spent < budget) {
    const x = L.done++
    const col = col0 + (x + 0.5) * s
    const ang = ((col - 100) / F) * k
    const sx = Math.sin(ang)
    const cz = Math.cos(ang)
    // The sample rows still sky above the ground found so far: [0, top).
    let top = rows
    let D = 3
    let prevY = 0
    let prevD = 0
    let prevF = 1e9
    let skyline = Infinity
    while (D < ZMAX && top > 0) {
      const X = sx * D
      const Z = cz * D
      const hy = height(X, Z)
      const Y = hy - (D * D) / (2 * RM)
      const yf = EYE - (F * (Y - cam)) / D
      while (top > 0 && at[top - 1]! >= yf) {
        const i = --top
        // Between this sample and the last, by where its row falls.
        const a = prevF > yf + 1e-6 ? clamp((prevF - at[i]!) / (prevF - yf)) : 1
        const dd = prevD ? lerp(prevD, D, a) : D
        gx[i] = sx * dd
        gz[i] = cz * dd
        gy[i] = prevD ? lerp(prevY, hy, a) : hy
      }
      skyline = Math.min(skyline, yf)
      prevF = yf
      prevY = hy
      prevD = D
      D += 0.03 + D * 0.012
    }
    // Each pixel: the ground if most of its samples are, lit as their mean.
    for (let y = 0; y < ph; y++) {
      let sum = 0
      let m = 0
      for (let j = 0; j < sub; j++) {
        const i = y * sub + j
        if (i < top) continue
        sum += groundLight(gx[i]!, gz[i]!, gy[i]!, cam, (at[i]! - skyline) / sy)
        m++
      }
      if (m * 2 > sub) ground[y * pw + x] = sum / m
    }
    spent += Math.max(1, rows - top) + 16
  }
  if (L.done >= pw) markNear(L)
}

/** Where the Earth and its air can reach, as it climbs and sinks: the sky round it, once the ground is in. */
function markNear(L: Layout): void {
  const { pw, ph, s, sy, col0, row0, ex, er, ground } = L
  const air = (13 * er) / ER
  for (let y = 0; y < ph; y++) {
    const row = row0 + (y + 0.5) * sy
    if (row <= L.eyHigh - er - air - sy || row >= L.eyLow + er + air) continue
    for (let x = 0; x < pw; x++) {
      const col = col0 + (x + 0.5) * s
      const i = y * pw + x
      if (ground[i]! < 0 && Math.abs(col - ex) < er + air) L.near[i] = 1
    }
  }
}

export const earthriseScene = defineScene({
  name: 'earthrise',
  blurb: 'the Earth over the moon, rising and turning faster with the work',
  make: seed => new Earthrise(seed),
})
