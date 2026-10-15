// REVISION: flow-v1-shared-soundscape
//
// The soundscape a frame at a time, for any host with a player: Claude Code's
// `audio.play` (register.tsx) and, in opencode, afplay run in the background
// (opencode/player.ts). What a frame brings: the scene's events (a clip each,
// staggered, or gathered into a burst a second at a time), its bed (bedStep's
// takes crossfading), the chime when a wait on the person begins. sound.ts
// plans it; this plays it, over a small `Player` each host implements, and
// keeps what's playing so it can be stopped. Pure: no engine, no Node.

import type { FlowConfig } from './settings'
import {
  type BedTake,
  bedFailed,
  bedStep,
  burst,
  chimePlay,
  chimeStep,
  eventPlay,
  gather,
  master,
  newChimeState,
  type SoundEvent,
  type SoundMood,
  unit,
  volumeGain,
} from './sound'
import type { Scene, Tint } from './styles'

/**
 * Small events are gathered this long (ms) and played together, each at its moment: each clip holds one of
 * the player's few plays for its length and almost a second more (afplay starting and draining), so not much shorter.
 */
export const SOUND_BURST_MS = 1000
/** The nearest two events of a kind with clips play (nearer, the ear hears one). */
export const SOUND_STAGGER_MS = 120
/** A play refused because the player is full tries again this soon, this many times. */
const RETRY_MS = 50
const RETRIES = 4

/** A clip: one of the plugin's own (`asset`: its path in the plugin's folder, sounds/…) or synthesized here (base64 WAV). */
export type Clip = { asset: string } | { base64: string; mime: string }

/** What a host plays with. */
export interface Player {
  /** How many clips it plays at once: a clip finding them all going stops the oldest event clip first. */
  readonly maxPlays: number
  /** Play a clip at a gain fixed as it starts: settles when it has played out or been stopped (`signal`), rejects when refused. */
  play(clip: Clip, gain: number, signal: AbortSignal): Promise<void>
  /** Whether a refusal was the player being full (it's tried again a moment on), not for good. */
  full(err: unknown): boolean
  /** Run `fn` in `ms`. */
  after(ms: number, fn: () => void): void
}

/** What the soundscape hears of a frame. */
export type SoundFrame = {
  /** Whether it may be heard now (besides someone being there and the sound on): the scene is on screen. */
  heard: boolean
  /** The scene on show (whose events and bed are heard), if any. */
  shown: Scene | undefined
  /** Every scene stepped this frame: each one's events are taken, heard or not (only the shown one's are heard). */
  scenes: readonly Scene[]
  /** Whether a wait on the person is on (the chime), the tint, the night. */
  waiting: boolean
  tint: Tint
  night: boolean
}

export class Soundscape {
  /** Someone has been seen at the session: nothing is heard till then. */
  present = false
  /** The session has ended for good: the frames still running till the process goes start nothing (a clip begun then plays out in full). */
  over = false

  /** The clips playing (each stoppable), and the soundscape's own clock (ms). */
  private playing = new Set<AbortController>()
  private clock = 0
  /** Each bed layer's take (`bedStep` keeps them), and their players by id. */
  private bed: (BedTake | undefined)[] = []
  private takes = new Map<number, AbortController>()
  /** When the next burst of small events is due, and when the last went. */
  private nextBurst = 0
  private lastBurst = 0
  /** The small events gathered since the last burst, and how many the window has seen (more than it holds when busy). */
  private queue: (SoundEvent & { at: number })[] = []
  private seen = 0
  /** When each kind of event with a clip of its own may play next (a closer one waits till then). */
  private nextOf = new Map<string, number>()
  /** Bumped whenever the soundscape stops (a new scene, sound off, hidden): what was scheduled before is stale. */
  private gen = 0
  /** When the waits on the person began and ended, and the last chime (chimeStep keeps it). */
  private chime = newChimeState()
  /** The event clips playing, oldest first (the first to give way when the player is full). */
  private events: AbortController[] = []
  /** The last volley's clip (a fast gun's run of shots), stopped early when its gun falls silent (`cease`). */
  private volley: AbortController | undefined
  private seed = 1
  /** The scene heard now ('' when none). */
  private scene = ''
  /** This frame's events (one array, emptied each frame), and what the bed's planner is told (one object, set afresh). */
  private frameEvents: SoundEvent[] = []
  private mood: SoundMood = { scene: '', level: 0, tint: 'normal', night: false, amb: {} }

  constructor(
    /** The settings shown (the scene, the sound, its volume), read each frame. */
    private readonly cfg: FlowConfig,
    /** What plays the clips: none yet (Claude Code's comes with the session's engine), nothing is heard. */
    public player?: Player,
  ) {}

  /**
   * Whether what was scheduled in generation `gen` may still play: the soundscape hasn't stopped since, and
   * no change waits for the next frame to stop it (another scene picked, the sound turned off).
   */
  private current(gen: number): boolean {
    return this.gen === gen && this.cfg.sound === 'on' && this.cfg.style === this.scene
  }

  /** Stop everything playing now, and whatever was scheduled (a new generation: it never plays). */
  stop(): void {
    this.gen++
    for (const c of this.playing) c.abort()
    this.playing.clear()
    this.takes.clear()
    this.events.length = 0
    this.volley = undefined
    this.bed = []
    this.queue.length = 0
    this.seen = 0
    this.scene = ''
  }

  /**
   * Play a clip. The player plays at most `maxPlays` at once: a clip finding them all going stops the oldest
   * event clip (`take` undefined) first (a tail cut beats a strike unheard, or the bed dropping out); a refused
   * one tries again a moment on (a bed's take stopping an event clip each time: busy events never keep the
   * bed out). No player, or refused for good: just silence.
   */
  private play(clip: Clip, gain = 1, take?: number, tries = 0, volley = false): void {
    const player = this.player
    if (!player) return
    const event = take === undefined
    if ((tries === 0 || !event) && this.playing.size >= player.maxPlays) this.events.shift()?.abort()
    const stop = new AbortController()
    this.playing.add(stop)
    if (volley) this.volley = stop
    if (event) this.events.push(stop)
    else this.takes.set(take, stop)
    // Refused because the player's full, it tries again a moment on: unless the soundscape has stopped since, or
    // (a bed's take) the planner has stopped that take (it took its entry out of `takes`).
    const gen = this.gen
    let retrying = false
    // (Every clip at the sound's volume, as it is when it starts: never past the gain a clip clips at.)
    void player
      .play(clip, volumeGain(gain, this.cfg.volume), stop.signal)
      .catch((err: unknown) => {
        if (!player.full(err) || stop.signal.aborted) return
        if (tries >= RETRIES) {
          // A bed's take refused for good: its next is due now, so the bed comes back next frame.
          if (take !== undefined && this.takes.get(take) === stop && this.current(gen)) bedFailed(this.bed, take, this.clock)
          return
        }
        retrying = true
        player.after(RETRY_MS, () => {
          if (!this.current(gen) || (take !== undefined && this.takes.get(take) !== stop)) return
          this.play(clip, gain, take, tries + 1, volley)
        })
      })
      .finally(() => {
        this.playing.delete(stop)
        const i = this.events.indexOf(stop)
        if (i >= 0) this.events.splice(i, 1)
        if (!retrying && take !== undefined && this.takes.get(take) === stop) this.takes.delete(take)
      })
  }

  /** One frame, `elapsed` ms after the last: beds crossfading one into the next, and what happens on screen heard as it happens. */
  step(elapsed: number, f: SoundFrame): void {
    this.clock += elapsed
    const heard = f.heard && !this.over && this.present && this.cfg.sound === 'on' && this.player !== undefined
    // A wait on the person beginning: a soft chime (once a wait; not for one right behind another).
    const chime = chimeStep(this.chime, f.waiting, this.clock)
    const shown = f.shown
    const events = this.frameEvents
    events.length = 0
    for (const sc of f.scenes) {
      if (!sc.sounds) continue
      if (heard && sc === shown) events.push(...sc.sounds)
      sc.sounds.length = 0
    }
    if (!heard || !shown) {
      if (this.scene) this.stop()
      return
    }
    // Another scene (or the first heard frame): what played before stops, before anything of this one starts.
    const style = this.cfg.style
    if (style !== this.scene) {
      this.stop()
      this.scene = style
    }
    // Events with a clip of their own play now; the rest gather into a burst.
    for (const e of events) {
      // A gun fallen silent: the rest of its volley's clip, shots never fired, isn't heard.
      if (e.kind === 'cease') {
        this.volley?.abort()
        this.volley = undefined
        continue
      }
      const p = eventPlay(e, this.seed++, style, shown.strength)
      if (!p) {
        // (Somewhere since the last frame, at random: a frame's pops all at once would buzz at the frame rate.)
        const at = this.clock - Math.min(elapsed, 150) * unit(this.seed++)
        gather(this.queue, this.seen++, { ...e, at }, this.seed++)
        continue
      }
      // Each is heard, however close: one of a kind at most every SOUND_STAGGER_MS, a close one put back
      // a moment (two rocks striking together are two booms; any nearer, the ear hears one).
      const at = Math.max(this.clock, this.nextOf.get(e.kind) ?? 0)
      if (at - this.clock > 4 * SOUND_STAGGER_MS) continue
      this.nextOf.set(e.kind, at + SOUND_STAGGER_MS)
      if (at === this.clock) this.play({ asset: p.asset }, p.gain, undefined, 0, p.volley)
      else {
        const gen = this.gen
        this.player?.after(at - this.clock, () => this.current(gen) && this.play({ asset: p.asset }, p.gain, undefined, 0, p.volley))
      }
    }
    const mood = this.mood
    mood.scene = style
    // (A rocket acts its level out a stage at a time: its own strength is the one to hear.)
    mood.level = shown.strength
    mood.tint = f.tint
    mood.night = f.night
    mood.amb = shown.ambience?.() ?? {}
    // (The volume too: a change crossfades a fresh take in rather than wait for the next.)
    mood.volume = this.cfg.volume
    const beds = bedStep(this.bed, mood, this.clock, this.seed++)
    for (const id of beds.stop) {
      this.takes.get(id)?.abort()
      this.takes.delete(id)
    }
    for (const p of beds.play) this.play({ asset: p.asset }, p.gain, p.id)
    if (chime) {
      const c = chimePlay(this.seed++)
      this.play({ asset: c.asset }, c.gain)
    }
    if (this.clock >= this.nextBurst) {
      // Each event at its moment in the window since the last burst.
      const from = Math.max(this.lastBurst, this.clock - 2 * SOUND_BURST_MS)
      this.lastBurst = this.clock
      this.nextBurst = this.clock + SOUND_BURST_MS
      if (this.queue.length) {
        const wav = burst(this.queue.map(e => ({ ...e, offset: Math.max(0, (e.at - from) / 1000) })), this.seed++)
        if (wav) this.play({ base64: wav, mime: 'audio/wav' }, master(style, shown.strength))
        this.queue.length = 0
        this.seen = 0
      }
    }
  }
}
