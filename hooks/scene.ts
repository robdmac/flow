// REVISION: flow-v172-cleanup-followups
//
// What every harness adapter (Claude Code's register.tsx, pi's pi/index.ts)
// does the same way: one scene instance per style (so a switch resumes where
// that scene left off), the level the settings and the activity call for, whether
// anything shows at all, and pointing the current scene at those dials, the
// time of day and whether Claude waits on the person. Two drivers can share
// one cfg (each with its own scenes): the scene follows the shared style.
// Pure: no engine imports.

import { type Activity, FRAME_MS } from './activity'
import { isNightAt, type Clock, type FlowConfig } from './settings'
import { makeScene, type SceneName, type Scene } from './styles'

/** Frame pace while busy (~14 fps, the heat model's frame), and when calm: a low glow or off (8 fps). */
export { FRAME_MS }
const CALM_MS = 125

export class SceneDriver {
  private readonly scenes = new Map<SceneName, Scene>()
  /** The local time, which the adapter keeps current (noon until it first reads the clock). */
  clock: Clock = { hour: 12, minute: 0 }
  /** Called with each scene as it's built (the adapter resumes the balloon's altitude there). */
  onMake?: (style: SceneName, scene: Scene) => void
  /**
   * Where this driver's scenes take their seeds from: the adapter sets it from the clock, so each session's
   * scenes start their own way (0: makeScene's own counter).
   */
  seedBase = 0
  private made = 0

  constructor(
    readonly cfg: FlowConfig,
    readonly activity: Activity,
  ) {}

  /** The scene for the configured style. */
  get scene(): Scene {
    return this.sceneFor(this.cfg.style)
  }

  /** The one instance of a style, built on first use. */
  sceneFor(style: SceneName): Scene {
    let f = this.scenes.get(style)
    if (!f) {
      this.scenes.set(style, (f = makeScene(style, this.seedBase ? (this.seedBase + 7919 * this.made++) % 2147483647 : undefined)))
      this.onMake?.(style, f)
    }
    return f
  }

  /** The instance of a style if it's been built, without building it. */
  built(style: SceneName): Scene | undefined {
    return this.scenes.get(style)
  }

  /** Apply settings changes here at once (the caller saves and redraws). */
  apply(changes: Partial<FlowConfig>): void {
    Object.assign(this.cfg, changes)
  }

  /** The level now: the manual setting, or what the work's activity calls for. */
  level(): number {
    return this.cfg.mode === 'manual' ? this.cfg.level : this.activity.strength(this.cfg.idle)
  }

  /** Whether the scene should show at all right now (dark idle gives the rows back). */
  isShown(): boolean {
    const { cfg, activity } = this
    return cfg.mode === 'manual' ? cfg.level > 0 : cfg.idle > 0 || activity.isWorking || activity.isGlowing
  }

  isNight(): boolean {
    return isNightAt(this.cfg.time, this.clock.hour)
  }

  /** The tint auto mode shows (a failure, a nearly-full context), or none in manual. */
  tint(): Scene['tint'] {
    return this.cfg.mode === 'auto' ? this.activity.tint : 'normal'
  }

  /** Whether auto mode shows Claude waiting on the person (a dialog is up for them); never in manual, as with the tints. */
  waiting(): boolean {
    return this.cfg.mode === 'auto' && this.activity.isAwaitingPerson
  }

  /** How long until the next frame: calm scenes (low, untinted) step slower. */
  pace(): number {
    const f = this.scene
    return f.strength <= 1 && f.tint === 'normal' ? CALM_MS : FRAME_MS
  }

  /** Point the current scene at this frame's dials, returning it. */
  dial(): Scene {
    const f = this.scene
    f.strength = this.level()
    // The subagents show in manual too: holding a level holds how busy it looks, not who's about.
    f.coverageBoost = this.activity.coverageBoost
    // Each subagent on its own, for the scenes that give each a companion.
    f.agents = this.activity.roster.dials()
    f.tint = this.tint()
    f.night = this.isNight()
    f.waiting = this.waiting()
    return f
  }
}
