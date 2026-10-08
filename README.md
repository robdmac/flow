# flow

[![CI](https://github.com/robdmac/flow/actions/workflows/ci.yml/badge.svg)](https://github.com/robdmac/flow/actions/workflows/ci.yml)

<img width="1200" height="384" alt="Flow's fire above the prompt: pilot lights at idle, climbing with each of Claude's tool calls, an inferno with three subagents, then back down when Claude is done" src="https://github.com/user-attachments/assets/0f0120cc-af23-44ec-9398-309cccd42764" />

Ambient scenes in your terminal that move with the work your coding agent is doing: a fire, fizzing bubbles, the surf, a ski run, two rockets, a hot-air balloon, a steam engine, a train through the countryside, a colony ship behind its shield, and the Earth rising over the moon. They run above the prompt of Claude Code (in the terminal or the Claude desktop app) or [pi](https://github.com/badlogic/pi-mono), or in a tall pane beside Claude Code's transcript.

Each scene is drawn in 24-bit color from Unicode block, quadrant and braille characters, so several pixels share each terminal cell. In the Claude desktop app, which has no character grid to draw into, the same frames are drawn as images.

https://github.com/user-attachments/assets/66673edf-7a52-43c3-b52b-3a804068bc5e

## Install

**Claude Code**, from inside a session:

```
/plugin marketplace add robdmac/flow
/plugin install flow-scenes@robdmac
/reload-plugins
```

Installed it before as `flow@robdmac`? The plugin is now `flow-scenes` (another plugin had the name `flow`). Run `/plugin uninstall flow@robdmac`, then install as above. The command is still `/flow`. Settings you'd saved in `/config` don't carry over: set them again, or set them with `/flow` and `/flow save`.

**Claude desktop**, in the Code tab: click **+** next to the prompt box, then **Plugins** → **Add plugin**, add the marketplace `robdmac/flow` and install **Flow** (`flow-scenes`). Manage it later from **+** → **Plugins** → **Manage plugins**. The desktop app and Claude Code share their plugins, so if you've installed Flow in the terminal it's already there. It runs in local sessions, not cloud ones.

**pi**, from your shell:

```
pi install git:github.com/robdmac/flow
```

Mods are an early-access Claude Code feature, and their API may change between releases (see Compatibility below).

### Not loading?

If `/flow` doesn't exist after installing, run `claude --debug` and look for a line about **hooks modules**:

- **"the rollout flag (tengu_plugin_hooks_modules) is off"**: mods from installed plugins are still being rolled out account by account, and yours doesn't have them yet. Update Claude Code (`claude update`), then turn them on yourself for one launch:

  ```
  CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude
  ```

  (`claude -r` instead of `claude` resumes your last session.) To keep it on, add it to `~/.claude/settings.json`:

  ```json
  "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" }
  ```

  or export it in your shell profile.
- **"saved off by an earlier session"**: the flag was cached as off and hasn't refreshed yet. Start a new session, or use the setting above.
- **"not available on Bedrock/Vertex/third-party providers"** or **"with a custom ANTHROPIC_BASE_URL"**: mods only run against the Anthropic API, so Flow can't load there.
- **"until workspace trust is accepted"**: accept the trust prompt for the folder you started Claude in.

## The scenes

Every scene has a level from 0 (off) to 10 (as busy as it gets).

| Scene | At 1 | At 10 |
|---|---|---|
| `fire` | a low glow of embers | a roaring fire throwing sparks |
| `warp` | stars drifting past | hyperspace streaks |
| `avalon` | a colony ship among still stars, its habitat turning, now and then a rock burning up on its shield; every few minutes it passes a sun or flies through a nebula | stars streaking past, a rock flaring on the shield every few seconds |
| `balloon` | a hot-air balloon on the grass | up through the clouds to the edge of space |
| `engine` | a steampunk engine standing still | cogs, belts and pistons at full speed |
| `falcon`, `starship` | the rocket on its pad | climbing through the sky (2–7), separating at about 7, the upper stage in orbit (8–10); as it stages the screen splits, one side following the booster back down (falcon's lands on its legs, starship's is caught by the tower's arms), the other staying with the upper stage; brought home, falcon's Dragon capsule comes down under parachutes to a splashdown and the view slides back to the pad, and starship's Ship splashes down at sea and is carried back for the arms to lift on |
| `surf` | a glassy sea at dawn | big barrelling waves |
| `ski` | an easy run | a steep mogul run at speed |
| `bubbles` | a couple of lazy strings of bubbles | a rolling, fizzing boil |
| `train` | waiting at a red signal or a platform, its diesel idling (when the work starts the signal clears, the horn sounds and it pulls away; when it winds down the train pulls up again) | flat out past fields, villages, woods, rivers and stations, the poles and the line beside it a blur |
| `earthrise` | the Earth half risen over a cratered lunar horizon in long, low sunlight, turning once in about two minutes (after [earthrise](https://ascii.rest/earthrise/) by @bas3line on ascii.rest) | the Earth risen clear of the horizon, spinning once every four seconds, its clouds running ahead |

`/flow pick` shows them all at once, each one live, to choose from with the arrow keys and Enter (in pi, a list).

Some scenes also answer to other names: `inferno` and `flame` (fire), `stars` (warp), `colony` and `interstellar` (avalon), `mechanism` (engine), `rocket` (falcon), `spaceship` (starship), `ocean` and `sea` (surf), `snow` (ski), `rail` and `railway` (train).

Balloon, falcon, starship, surf, ski and train also have a **night** version: stars, a moon, moonlit snow or water, and the train's windows lit up. By night, bubbles turns into a stout: pale tan bubbles rising through black. By default day and night follow your local clock (night is 19:00 to 7:00). `/flow day` or `/flow night` pins one.

## What moves it (auto mode)

| Your agent is… | The scene |
|---|---|
| idle | a low glow (or nothing, if you choose) |
| in a turn | rises to a level set by effort: `low` 2, default 3, `high` 4, `xhigh` 5, `max` 6 |
| working a while | one level more for every 30 s the turn has run (not counting time it waits on you: a permission prompt, a question, a plan to approve) |
| streaming an answer | keeps going (limited per second, so plain chat sits mid-range) |
| editing files | pushes higher, scaled by the lines written |
| running commands | sparks; a slow command keeps it ticking over |
| reading or searching, or using any other tool (an MCP server's too) | a small spark each |
| running subagents | busier with each one (with diminishing returns), and each one gets a companion of its own (see below); the rest add company: more stars, more lit windows, more streams of bubbles, more lights on the launch tower |
| hitting a failed command, or compacting | smoke for a moment: smoky flame tips, sooty steam, a grey sky, a wipeout, a rocket's plume sputtering grey, black smoke pouring from the train's diesel, a pall of moondust over the lunar horizon |
| near a full context (≥85%) | blue: a blue-white flame, a storm, dusk on the slopes, a blue gas flame, rain driving past the train, cold blue light over the moon |
| waiting on you: a permission to grant, its question, a plan to approve | settles to a calm 2 and holds, the whole scene turned a warm sepia that breathes slowly, about every 4 s: the fire banks to a bed of glowing coals, the stars stop, the colony ship comes to rest, the balloon hovers with its pilot light glowing, the engine runs down and lets off steam, a rocket holds its stage with amber lights up the tower, the surfer sits up waiting for a wave, the skier stops, the bubbles slow, the train draws up at a red signal or a platform, its headlight and the signal glowing with each breath, the Earth stops turning. With sound on, a soft chime as the wait begins |

A plain answer sits around 5, edit-and-test loops reach about 8, and 10 takes several subagents editing in parallel, or a long turn: it climbs a level every 30 s it keeps going.

Waiting on you shows only while a dialog is actually up for you: a permission ask that auto mode's classifier settles by itself, or that a hook answers, isn't one. It ends when you answer (once the call is over, or as soon as a long command shows it's running). Like the tints, it shows in auto mode only, and only in the session that waits.

### Subagents, one by one

In fire, surf, ski, balloon, falcon, starship, engine, train and avalon, each running subagent has a companion of its own, in its own colors or its own place, so you can tell at a glance which are busy, which have gone quiet or are waiting on you, and when each finishes:

| Scene | Arrives | Working | Quiet (nothing for 20 s) | Waiting on you (a permission dialog, its question) | Done |
|---|---|---|---|---|---|
| `fire` | the main fire narrows to make room and a small fire of its own kindles beside it, sparks catching (on alternate sides, a dark gap between each) | burns bright and lively, taller the busier the scene | dies down to low, glowing embers | its embers pulse a bright glow, quicker than the waiting fire's breath | burns out with a last puff of smoke and the gap closes, the main fire widening back (failed: snuffed out at once, in grey smoke) |
| `surf` | paddles in from the edge | paddles hard, or rides a following wave; on a big swell, rides the big wave with the surfer | sits up on its board, bobbing | sits up waving an arm | paddles off out of sight |
| `ski` | skis in from behind | carves S-turns, throwing spray | pulls over to the side, standing on its poles | waves a pole overhead | tucks and skis off ahead (failed: drops back) |
| `balloon` | a small balloon in stripes of its own rises into view from below | flies high, bobbing on blasts of its burner | burner out, sinks low | its envelope blinks | climbs away off the top (failed: sinks away below) |
| `falcon`, `starship` | a mini rocket (the same rocket, smaller) on a little launch site of its own beside the big one | flies the mission with the big one, a beat behind: lifts off, stages (its booster coming home beside the big one's: falcon's on its legs, starship's into its own tower's arms), keeps formation into orbit and comes home with it (Dragon under its own chutes; the Ship belly-first, carried home and stacked) | coasts, dropped back, a light blinking on its nose; on the ground it doesn't launch | an amber beacon flashes | fades as it pulls away ahead (failed: tumbles away in smoke) |
| `engine` | its lamps on the bed plate warm up | a light runs along its lamps | its lamps glow low | its lamps flash together | its lamps fade out (failed: fading red) |
| `train` | a short train of its own draws up alongside from out of sight | keeps pace on the next track, gaining and losing a little, headlamp lit | drops back a little, headlamp out | its cab flashes amber | falls back out of sight |
| `avalon` | a probe launches from a bay on the ship's hull (the hatch glowing in its color) and flies up beside it | holds station by the ship on its own flickering drive | drive off, falls back along the ship, a running light blinking | an amber beacon flashes | turns about and burns away aft, off toward home (failed: drive dead, tumbles away dark) |

A scene has room for a few (the fire 4 to 6 small fires across the band, 1 or 2 in the spine, surf 5, ski 4, balloon 4, the rockets 3 mini rockets (one of them behind the big launch site in the spine; 1 in a spine narrower than 19 columns), the engine 6 lamp groups, the train up to 4 trains, avalon 4 probes; fewer in the narrow spine or a narrow band: only as many as it shows whole); more wait for a place to come free. Warp and bubbles keep the plain company above: they're a stream of stars, a glass of anonymous bubbles, with nothing that stays put long enough to be someone. In the Claude desktop app, put the pointer over a companion to see its subagent's task, what it's doing and for how long.

## The command

`/flow` changes things at once, in the session you run it in. Each session keeps its own scene and settings, so two sessions side by side can show different scenes, and resuming one (`claude --resume`, `claude --continue`, or opening it again in the Claude desktop app) brings its settings back. A `/clear` keeps the scene you had.

A new session starts on your defaults: the rows in `/config` (*Scene mode*, *Scene*, *Scene while idle*, *Manual level*, *Scene layout*, *Day or night*, *Sound*, *Sound volume*). `/flow save` makes the current session's settings your default, and `/flow reset` puts a session back on it. Changing a row in `/config` changes the default and the session you're in. A session already running keeps what it shows when the default changes elsewhere (another session's `/flow save`, say), and `/flow` on its own says when the session differs from your default, and how. `/flow save` saves exactly what the session shows.

| Command | Effect |
|---|---|
| `/flow` | show the scene, mode, level and time of day |
| `/flow <scene>` | pick a scene by name or alias (`/flow surf`, `/flow sea`) |
| `/flow pick` | every scene at once, live, side by side in a pane: the arrows (or Tab) move, Enter (or the scene's number) picks it for this session, as `/flow <scene>` does, Esc closes; on desktop, click one |
| `/flow next` | the next scene |
| `/flow day` / `night` | pin the time of day |
| `/flow clock` | day or night by your local clock (the default) |
| `/flow <scene> night` | a scene and a time of day at once |
| `/flow auto` | move with the agent's work (the default) |
| `/flow 1`–`10` / `off` | hold a fixed level, or switch it off |
| `/flow idle glow` / `dark` | in auto mode while idle: a low glow (the default), or nothing (the band gives its rows back) |
| `/flow sound` | toggle a soundscape for the scene, swelling with the work (macOS; off by default); `/flow sound on` / `off` to set it |
| `/flow sound 1`–`10` | the soundscape's volume, turning it on (7 is the default; each step below it 3 dB quieter); `/flow sound 0` turns it off. `/flow volume 1`–`10` does the same |
| `/flow band` / `spine` | a 5-row band above the prompt (the default; also `horizontal`, `bar` or `flat`), or a tall pane docked beside the transcript (also `portrait`, `vertical` or `side`) |
| `/flow save` | make this session's settings your default, the one new sessions start with (it writes them to `/config`) |
| `/flow reset` | put this session back on your default |
| `/flow help` | list all of this |


## Sound

`/flow sound` (or *Sound* in `/config`) turns on a soundscape for each scene, and turns it off again, each one tuned against real recordings so it sounds like the thing itself: a campfire's sparse, bright crackle over the soft lick of its flames (and a bonfire's roar at the top), a beach's wash and its waves breaking now and then on a calm day, often on a rough one, a steam engine's chuffs in time with its crank, water bubbling and boiling, wind gusting round a balloon and its burner roaring, skis carving through snow, a train's diesel idling at the signal, and the roar of its wheels and the wind rising as it runs (matched to recordings made in a carriage and beside the line), a rocket's roar and crackle matched to NASA's launch recordings. The colony ship and the warp drive are science fiction, so theirs are designed: the hull's hum, the shield fizzing, and a low, muffled boom through the hull as each rock blows up on it; the drive's hum climbing with speed.

The background is long takes that blend one into the next at random moments, so nothing comes round on a beat, and a fresh one crossfades in whenever the level or the scene changes (a rocket on the pad, climbing, in orbit, coming home). On top of it you hear what happens on screen, as it happens: bubbles bursting, rocks blowing up on the shield, sparks, a wave breaking, each ski turn, the hammer, the train's horn as it pulls away and before each level crossing, and the rockets' ignition, staging, the booster's sonic boom, the catch, parachutes and splashdown. Every scene follows the same loudness from level 1 (quiet) to 10.

`/flow sound 1` to `10` turns it on at that volume in the session you run it in (*Sound volume* in `/config` is the volume new sessions start with, and `/flow save` makes this session's it). 7, the default, is the loudness the scenes were tuned to; each step below it is 3 dB quieter, so 1 is 18 dB down. Above 7 there's little room left: the loudest sounds already play near full scale, and any louder they'd distort. So 8, 9 and 10 lift the quieter sounds by up to 2, 4 and 6 dB, the louder ones by less and the loudest not at all, and a busier moment still sounds busier than a calm one. `/flow sound 0` turns it off, and `/flow sound` turns it back on at the volume it had.

When Claude starts waiting on you (a permission, its question, a plan to approve), a soft chime: two struck tubes rising a fourth, about as loud as a scene at 6. Once a wait, and not for one right behind another (within 20 s): you're there already. It's part of the soundscape, so it follows the session's sound setting: `/flow sound` turns it on and off with the rest. For an alert without the ambience, there's Claude Code's own notification setting in `/config`.

It plays only while the scene is on screen, and stops with the session. Claude Code plays the clips with `afplay`, so it's macOS only; elsewhere the setting does nothing. It's set per session like everything else, so you can have it on in one session and not another, or quieter in one; several sessions with it on each play their own.

## Turning it off

Run `/flow off`, or `/flow idle dark` to stay in auto mode but show nothing while idle. Either applies to the session you run it in; follow it with `/flow save` to make it the default for new sessions too. You can also disable the plugin. Flow draws in the terminal and in the Claude desktop app; not in VS Code or on mobile.

## pi

The same scenes run as a pi extension (`pi/index.ts`): a widget above pi's editor, drawn as 24-bit ANSI lines. It shares the scenes, the activity model and the `/flow` command with the Claude Code version. pi has no side panes, so there is no spine there, and no built-in subagents (so no companions). pi's events drive it:

| pi event | The scene |
|---|---|
| `agent_start` / `agent_end` | a turn lifts it (a level more for every 30 s it runs), then it settles to idle |
| `turn_start` | rises to the floor for `ctx.thinkingLevel` (`minimal`/`low` 2 … `max` 6) |
| `message_update` deltas | streamed text and thinking keep it going |
| `tool_call` | `write`/`edit` push it by lines written, `bash` sparks, reads and other tools flicker |
| `tool_result` with `isError` | a failed command shows as smoke |
| `session_compact` | so does a compaction |
| `ctx.getContextUsage()` | a nearly-full context shows as blue |

In a terminal that draws images (Ghostty, kitty, WezTerm, Warp; not under tmux), `earthrise` shows in pi as a picture at the terminal's own pixels rather than in characters, 14 rows tall (never more than half the terminal). Set `"rows"` in `~/.pi/agent/flow.json` for another height, or `"pictures": false` to keep the characters. The first time pi opens at a new width the characters show for a few seconds while the picture's ground is made. Flow keeps the ground of the last few sizes in `~/.cache/flow`, so the picture shows at once the next time. The other scenes stay in characters.

pi tells an extension nothing of a wait on you, so there the scenes never show one. Nor has it a player, so the scenes are silent there: `/flow sound` says so.

As in Claude Code, each session keeps its own settings, kept in the session itself (an entry the model never sees), so resuming or forking it brings them back. `~/.pi/agent/flow.json` holds the defaults new sessions start with; `/flow save` writes it. To try it without installing: `pi --extension ./pi/index.ts`.

## What Flow does on your machine

**Privacy:** Flow collects nothing. It has no servers, sends no data anywhere, and keeps what little it stores (below) on your machine, in Claude Code's own storage for the plugin.

**Network:** none. Flow sends nothing anywhere and contacts no hosts. Everything it draws and plays is computed locally from the plugin's own files. The one call that takes anything out of the plugin is `$.audio.play`, which hands one of the plugin's own clips from `sounds/` (and a volume) to the local audio player, `afplay`: nothing Flow reads (settings, the conversation, your files) goes into it, and it reaches no address.

**Your settings:** Flow writes its own `/config` rows (the `flow-scenes` plugin's options: scene, mode, sound and the rest) only when you run `/flow save`, which writes the settings your session shows as the defaults for new sessions. It reads them (`$.config.list()`) to start each session on your defaults.

It writes no other settings, no files and no environment variables. (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`, under *Not loading?*, is a variable you set yourself, if you need it.)

**What it keeps:** in Claude Code's per-plugin store, each session's own `/flow` settings (the 100 most recently used sessions, none unused for 60 days) and which one-time tips you've seen. In the session's own plugin state, the balloon's altitude and whether someone has been at the session. In pi, a session's settings go in the session as an entry the model never sees, and `/flow save` writes `~/.pi/agent/flow.json`.

**Sound:** off unless you turn it on. Claude Code plays the plugin's own clips (`sounds/`) through `afplay`, only after someone has typed or run a turn in the session.

**What its hooks see, and what they decide:** nothing. Every hook passes the event on unchanged (the one Flow answers is its own `/flow` command); Flow never blocks, allows, rewrites or answers a tool call, a permission, a prompt or a setting. It only watches, to set how busy the scene looks:

| Hook | What Flow reads | Why |
|---|---|---|
| `tool.call` | the tool's name, the number of lines an edit or write adds (not their text), whether a `Bash` command failed; its arguments, held only while it runs (see below) | how busy the scene is; a failed command shows as smoke |
| `classic.PermissionRequest` | that a permission dialog is about to show: its tool's name and input, which subagent. The input is only compared with the arguments of the calls running, to tell which call the dialog is for, and kept nowhere | the scene settles and breathes while Claude waits on you, until that call is answered |
| `turn.start`, `turn.complete`, `turn.step` | when a turn or a subagent's run starts and ends; how much text is streamed (its length only) | the level, and each subagent's companion |
| `session.compact`, `session.measure` | that a compaction happened; how full the context is | smoke; blue when it's nearly full |
| `config.set` | a change to one of Flow's own `/config` rows | applies it to the session at once |
| `prompt.edit` | that a key was pressed in the prompt (not what) | someone is there, so sound may play |
| `command.run` | `/flow` and its arguments (only its own command: it answers `/flow`, and sees no other) | the command |
| `session.start`, `session.end`, `ui.*` | the session's id; the panes it draws | its settings; the band, the spine and `/flow pick` |

It also lists the session's running subagents (`$.agent.list()`: their state, task and type) to give each one a companion and a hover card.

## Cost

Flow repaints about 14 times a second while busy and 8 times when calm. It skips unchanged frames and doesn't repaint at all while off screen. In the desktop app it redraws at most 10 times a second. The heaviest scene takes under 2 ms per frame.

## Compatibility

Built against Claude Code 2.1.289 and pi 1.0.0. Mods (function-hook plugins) are early access: the API may change between Claude Code releases, so a newer release can break flow until it's updated.

## Development

```sh
claude --plugin-dir .   # load it, with hot reload (loading writes its types to .claude-plugin/types/)
claude plugin validate .
claude plugin test .
npm install && npm run typecheck
```

CI ([ci.yml](.github/workflows/ci.yml)) runs these and `npm run check` on every pull request and push to main.

### Add your own scene

```sh
npm install
npm run new-scene -- aurora --blurb "curtains of light that ripple faster with the work" --night
npm run preview -- aurora    # see it here at levels 1, 5 and 10, as a band and a spine, with each tint and waiting
claude --plugin-dir .        # then /flow aurora
npm run check                # colour pairs and timing, before you open a pull request
```

`new-scene` writes `hooks/aurora.ts`: a scene that already moves with the level, shows the tints, breathes while Claude waits on you and (with `--night`) has a night. Edit its `paint()`: it gets a grid of pixels (2 × 2 a terminal cell) and the dials (the level, eased; the frame count; night; the tint; how far into a wait on you; whether it's the tall spine). [AGENTS.md](AGENTS.md) has the rules a scene keeps to.

Every hook file carries a `// REVISION:` marker. On startup the mod writes the loaded revision, the local time and the UTC offset to the debug log (`claude --debug`).

## License

[MIT](./LICENSE)
