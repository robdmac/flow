// REVISION: flow-v127-agents
//
// Prints scenes into this terminal the way Flow draws them: the band at
// levels 1, 5 and 10 with each tint and waiting on the person, then the spine
// the same way side by side, by day and (for a scene with one) by night. Not
// part of the mod (Node).
//
//   npm run preview -- surf               one scene (or several, or none for all)
//   npm run preview -- surf --night       only night;  --day only day
//   npm run preview -- surf --levels 3,7  other levels
//   npm run preview -- surf --band        only the band;  --spine only the spine
//   npm run preview -- surf --waiting     only waiting on the person (and normal, beside it)
//   npm run preview -- --pick             the picker (/flow pick), docked (64×44) and inline at this width
//   npm run preview -- --pick --size 120x26 --focus surf --night
//   npm run preview -- surf --agents      with subagents: two working, one quiet, one waiting on you, one leaving

import { gridToAnsi } from '../pi/ansi'
import { hotkeyFor, pickBlurb, pickHint, pickLabel, pickLayout, pickRows, Thumbnails } from '../hooks/picker'
import { SCENES, type SceneName } from '../hooks/styles'
import { BAND, blurbOf, build, LOOKS, nightsOf, scenesFrom, SPINE, TINTS } from './scene-lab'

const argv = process.argv.slice(2)
if (argv.includes('--pick')) {
  previewPicker()
  process.exit(0)
}
const opt = (name: string) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const levelsArg = opt('--levels')
const levels = levelsArg ? levelsArg.split(',').map(Number) : [1, 5, 10]
const rest = argv.filter((a, i) => a !== levelsArg || argv[i - 1] !== '--levels')
const width = Math.max(40, Math.min(250, (process.stdout.columns || 120) - 2))
const showBand = !rest.includes('--spine')
const showSpine = !rest.includes('--band')
const looks = rest.includes('--waiting') ? LOOKS.filter(l => l.name === 'normal' || l.waiting) : LOOKS
const agents = rest.includes('--agents')
const crewNote = agents ? ' · subagents: 2 working, 1 quiet, 1 waiting on you, 1 leaving' : ''
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

for (const scene of scenesFrom(rest)) {
  console.log(`\n\x1b[1m${scene}\x1b[0m ${dim(`— ${blurbOf(scene)}`)}`)
  for (const night of nightsOf(scene)) {
    if (night ? rest.includes('--day') : rest.includes('--night')) continue
    const when = night ? 'night' : 'day'
    if (showBand) {
      for (const level of levels) {
        for (const look of looks) {
          console.log(dim(`band ${width}×${BAND.rows} · level ${level} · ${when} · ${look.name}${crewNote}`))
          for (const line of gridToAnsi(build(scene, width, BAND.rows, { level, night, tint: look.tint, waiting: look.waiting, agents }).grid())) console.log(line)
        }
      }
    }
    if (showSpine) {
      // Every level × look as a spine, side by side, as many as fit across.
      const panels = levels.flatMap(level => looks.map(look => ({ level, look })))
      const per = Math.max(1, Math.floor((width + 2) / (SPINE.columns + 2)))
      for (let at = 0; at < panels.length; at += per) {
        const row = panels.slice(at, at + per)
        console.log(dim(row.map(p => `${p.level} ${p.look.name}`.padEnd(SPINE.columns + 2)).join('') + `(spine ${SPINE.columns}×${SPINE.rows}, ${when}${crewNote})`))
        const grids = row.map(p => gridToAnsi(build(scene, SPINE.columns, SPINE.rows, { level: p.level, tint: p.look.tint, waiting: p.look.waiting, night, agents }).grid()))
        for (let r = 0; r < SPINE.rows; r++) console.log(grids.map(g => g[r]).join('  '))
      }
    }
  }
}

/**
 * The picker as the terminal draws it (register.tsx's tree, laid out by hand):
 * the line of keys, the tiles (a frame, the thumbnail, its Button), the
 * focused scene's frame lit and its label inverted, and its blurb below.
 */
function previewPicker(): void {
  const opt = (name: string) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const night = argv.includes('--night')
  const current: SceneName = 'fire'
  const focus = (SCENES.find(d => d.name === opt('--focus'))?.name ?? current) as SceneName
  const width = Math.max(40, Math.min(250, (process.stdout.columns || 120) - 2))
  const sizeArg = opt('--size')?.split('x').map(Number)
  const sizes: [string, number, number][] = sizeArg
    ? [[`${sizeArg[0]}×${sizeArg[1]}`, sizeArg[0]!, sizeArg[1]!]]
    : [
        ['docked beside the transcript, 64×44', 64, 44],
        [`inline above the prompt at this width, ${width - 4}×${pickRows(width)}`, width - 4, pickRows(width)],
      ]
  const RESET = '\x1b[0m'
  const dim = (s: string) => `\x1b[2m${s}${RESET}`
  const accent = (s: string) => `\x1b[38;2;217;119;87m${s}${RESET}` // the theme's `claude`
  const subtle = (s: string) => `\x1b[38;2;136;136;136m${s}${RESET}` // the theme's `subtle`
  const inverse = (s: string) => `\x1b[7m${s}${RESET}`
  for (const [what, columns, rows] of sizes) {
    console.log(dim(`\n/flow pick, ${what}${night ? ', night' : ''} · focus on ${focus}`))
    const layout = pickLayout(columns, rows, SCENES.length)
    const label = (name: SceneName, i: number) => `${hotkeyFor(i) ? `${hotkeyFor(i)}: ` : ''}${pickLabel(name, name === current)}`
    if (!layout) {
      console.log(dim(pickHint(true)))
      SCENES.forEach((d, i) => {
        const l = label(d.name, i)
        console.log(`${d.name === focus ? inverse(l) : l} ${dim(d.blurb)}`)
      })
      continue
    }
    const t = new Thumbnails(7)
    t.night = night
    t.ensure(layout.columns, layout.rows)
    const tile = (name: SceneName, i: number): string[] => {
      const lit = name === focus
      const paint = lit ? accent : subtle
      const [tl, h, tr, v, bl, br] = lit ? ['┏', '━', '┓', '┃', '┗', '┛'] : ['╭', '─', '╮', '│', '╰', '╯']
      const side = (s: string) => (layout.framed ? `${paint(v)}${s}${paint(v)}` : s)
      const l = label(name, i).slice(0, layout.columns)
      const out = gridToAnsi(t.grid(name)!).map(side)
      out.push(side(`${lit ? inverse(l) : l}${' '.repeat(layout.columns - l.length)}`))
      if (layout.framed) {
        out.unshift(paint(`${tl}${h.repeat(layout.columns)}${tr}`))
        out.push(paint(`${bl}${h.repeat(layout.columns)}${br}`))
      }
      return out
    }
    if (layout.lines) console.log(dim(pickHint(true)))
    for (let at = 0; at < SCENES.length; at += layout.across) {
      const row = SCENES.slice(at, at + layout.across).map((d, k) => tile(d.name, at + k))
      for (let r = 0; r < row[0]!.length; r++) console.log(row.map(lines => lines[r]).join(' '))
    }
    if (layout.lines) console.log(pickBlurb(focus, current))
  }
}
