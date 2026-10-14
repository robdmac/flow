# Contributing to Flow

Thanks for wanting to help. New scenes, sounds, fixes and ideas are all welcome. If you're working with a coding agent (most of us are), point it at this file and [AGENTS.md](AGENTS.md): AGENTS.md has the layout, the rules a scene keeps to and how the soundscapes are built, and it's what reviews are checked against.

## Before you open a pull request

```sh
npm install
claude --plugin-dir .         # try it; loading also writes the mod API's types
claude plugin validate .
claude plugin test .
npm run typecheck
npm run check                 # colour pairs, timing, plugin.json in step, sounds in step
```

CI runs the same on every pull request. For a change you can see, also run `npm run preview -- <scene>` and look at it; after changing a tint, `npm run cvd -- <scene>`.

## What keeps Flow safe to install

Flow runs inside people's coding sessions, so it stays small and local. A pull request that crosses one of these lines needs a good reason, said up front:

- **No network.** Nothing in `hooks/` or `pi/` contacts a host, and nothing a hook reads (the conversation, files, settings) leaves the machine.
- **No new runtime dependencies.** The mod runs on its own files alone. Dev tools go in `devDependencies`, pinned to an exact version (no lockfile is committed: see AGENTS.md).
- **Hooks only watch.** Every hook passes its event on unchanged. Flow never blocks, allows or rewrites a tool call, a permission or a prompt, and it answers no command but `/flow`.
- **What it stores stays as described** in the README's *What Flow does on your machine*. If a change reads or keeps something new, update that section in the same pull request.
- **Assets are yours to give.** Sounds are synthesized by `scripts/make-sounds.ts`, not sampled. Anything borrowed (code, art, a sound) must be under a licence that allows it, credited in `THIRD-PARTY-NOTICES`.

## Scenes

`npm run new-scene -- <name> --blurb "…"` starts one (see the README's *Add your own scene*). It must look right as a 5-row band (80–250 columns) and as the spine (about 13–22 × 30–60), show the tints clearly, settle while Claude waits on you, and stay under ~2 ms a frame.

## Sounds

Rebuilding needs `sox` and `ffmpeg`: `npm run sounds -- <folder or clip>`. Rebuild only what you changed (every rebuild differs slightly) and commit `sounds/` together with `hooks/sound-files.ts`. AGENTS.md's *Soundscapes* covers the player's limits and the loudness every scene keeps to.

## Commits

Bump the `// REVISION:` line of each file you change. Small, focused pull requests are easiest to review and merge.
