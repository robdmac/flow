// REVISION: flow-v173-directory

/** The balloon's altitude in world rows, kept across the reload a setting change causes. */
export type BalloonAltitude = number

declare module 'claude-code' {
  interface PluginState {
    'flow-scenes': {
      altitude: BalloonAltitude
      /** Someone has been seen at the session (a key, a turn, a `/flow`): only then is the soundscape heard. */
      present: boolean
    }
  }
}
