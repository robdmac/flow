// REVISION: flow-v185-clips
//
// The clips in sounds/, as make-sounds writes them into hooks/sound-files.ts
// and check compares them with it: each scene's folder's files, sorted;
// anything else there (Finder's .DS_Store, a stray file) left out. Not part
// of the mod (Node).

import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Every clip in `dir` (sounds/), as the manifest names them: `sounds/<folder>/<file>`. */
export function listClips(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .flatMap(d => readdirSync(join(dir, d.name)).filter(f => !f.startsWith('.')).map(f => `sounds/${d.name}/${f}`))
    .sort()
}
