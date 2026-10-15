// REVISION: flow-v2-shared-player
//
// The soundscape's player where the host has none for a plugin's clips
// (opencode, whose sounds are its own notifications only; pi, none at all),
// so Flow plays them itself: each clip is macOS's `afplay` run in the
// background at its gain (`-v`), stopped by killing it, exactly as Claude
// Code's `audio.play` does it. A synthesized burst (base64 WAV) is written to
// a file of its own first, removed once played. Only the plugin's own clips
// (sounds/) and those bursts are ever played; nothing else is run. No afplay
// (not macOS): no player, and the scenes are silent.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Clip, Player } from '../hooks/soundscape'

const AFPLAY = '/usr/bin/afplay'
/** As many at once as Claude Code allows a plugin: the soundscape's tuning (volleys, thinning) assumes it. */
const MAX_PLAYS = 4

/** The player, where afplay is (macOS); none elsewhere. `root`: the plugin's folder (a clip's asset is its path there). */
export function afplayPlayer(root: string): Player | undefined {
  if (process.platform !== 'darwin' || !existsSync(AFPLAY)) return undefined
  const bursts = join(tmpdir(), `flow-${process.pid}`)
  let made = 0
  let playing = 0

  /** Run afplay on a file at a gain till it ends or `signal` stops it. */
  const run = (file: string, gain: number, signal: AbortSignal) =>
    new Promise<void>(resolve => {
      if (signal.aborted) return resolve()
      const child = spawn(AFPLAY, ['-v', gain.toFixed(3), file], { stdio: 'ignore' })
      const stop = () => child.kill()
      signal.addEventListener('abort', stop, { once: true })
      child.once('error', () => resolve())
      child.once('exit', () => {
        signal.removeEventListener('abort', stop)
        resolve()
      })
    })

  return {
    maxPlays: MAX_PLAYS,
    async play(clip: Clip, gain: number, signal: AbortSignal): Promise<void> {
      // (The soundscape keeps to maxPlays; this holds it there should a stop not have landed yet.)
      if (playing >= MAX_PLAYS + 2) throw new Error('flow: plays are going at once')
      playing++
      try {
        if ('asset' in clip) return await run(join(root, clip.asset), gain, signal)
        await mkdir(bursts, { recursive: true })
        const file = join(bursts, `burst-${made++ % 64}.wav`)
        await writeFile(file, Buffer.from(clip.base64, 'base64'))
        await run(file, gain, signal)
        await rm(file, { force: true })
      } finally {
        playing--
      }
    },
    full: err => String(err).includes('at once'),
    after: (ms, fn) => {
      setTimeout(fn, ms)
    },
  }
}
