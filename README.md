# CLIo Motion

Characters that move by rule, not by keyframe. Give a character's proportions and what it should
do (go this fast, face that way, aim there, jump, climb, strike) and CLIo Motion works out the
pose, every step, on any ground: where the feet land, how the hips rise and fall, how the spine,
arms, tail or wings follow. The same rules drive a soldier, a heavy mech, a hyena, a raptor, a
scorpion, an octopus, a wasp and a dragon.

It runs live inside a game loop, in 2D or 3D, or bakes to sprite sheets and glTF files that Unity,
Godot, Unreal and CLIo load as ordinary animation.

**Try it in a browser:** Gait Bench, in `docs/index.html` (one self-contained page; with GitHub
Pages serving `/docs` it is at https://eryxgames.github.io/clio-motion/).

## What it does

- Walk, run, sneak and gallop chosen from speed and leg length (Froude number), with feet planted
  in the world: no sliding, on slopes, steps and rolling ground.
- Travel in any direction while facing another; turning on the spot; jumping; pouncing.
- Ladders, and a ledge grab: hang by the hands, pull up, stand on top.
- Weapons as data: rifle, two pistols, sword and shield; aiming, recoil, reload, swings, block.
- Hands: throwing, lifting and carrying a crate, a fighting stance and three punches.
- Tails, tentacles and stings as chains with follow-through; bites, pinches and grabs that reach
  a target.
- Swimming (octopus) and flight (wasp, dragon).
- Hit reactions and a ragdoll the body can be handed to at any moment.
- Baking: looping clips to a sprite sheet with an atlas, a skinned `.glb`, a `.glb` of rigid
  parts, and CLIo sprite frames.

## Layout

| Folder | What it holds |
|---|---|
| `js/` | The reference implementation: `core.js` (motion), `rig.js` (looks), `bake.js` (clips and files), `fight.js` (example game code), tests. Guide: [`js/README.md`](js/README.md). |
| `tools/` | `gaitbake.js`, the command-line baker; `spec.js` and `golden.js`, which write what the other versions are checked against. |
| `spec/` | The characters as data, test vectors for the numeric kernel, and recorded runs of whole characters. |
| `c/` | The C99 library. |
| `python/` | The pure-Python version (standard library only), for CLIo. |
| `bench/` | Gait Bench's sources; `python bench/build.py` builds `docs/index.html`. |
| `docs/` | The built bench, for GitHub Pages. |

## What is ported

The JavaScript version does everything above. The C and Python versions are being built up from
the bottom, each stage checked against the reference before the next one starts.

| Stage | JavaScript | C | Python |
|---|---|---|---|
| 1. Numeric kernel: springs, two-bone IK, throw solver, chain fitter, gait rules | yes | yes | yes |
| 2. Ground stepping: foot planning, hips, turning, any direction, jump | yes | | |
| 3. Upper bodies: spine, arms, aim, weapons, actions | yes | | |
| 4. Chains, swimming, flight, ladder, ledge, ragdoll | yes | | |
| 5. Engine wrappers (Unity, Godot, Unreal) and the CLIo hook | | | |

Stage 1 agrees with the reference to the last bit or two on 921 recorded cases, in both languages.

## Use

JavaScript, live:

    const M = require('./js/core.js');
    const ch = M.CHARACTERS.soldier, env = { terrain: (x, z) => 0 };
    const S = M.createState(ch, env);
    const style = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 };
    const pose = M.step(S, ch, { speed: 1.4, steer: 0.5, armed: true }, style, env, 1 / 60);

Bake files for an engine:

    node tools/gaitbake.js all --out out
    node tools/gaitbake.js soldier --kit sword --out out

C:

    make -C c            # builds libclio_motion.a and runs its test

Python:

    python python/tests/test_kernel.py

## Tests

    node js/test/run.js                 # the reference: every test, then the recorded runs
    make -C c test                      # the C kernel against the reference's numbers
    python python/tests/test_kernel.py  # the Python kernel against the same numbers

After a change to `js/core.js` that is meant to change the motion, `npm run spec` records the
reference again; the C and Python versions then have to follow.

## How the versions are kept the same

`tools/spec.js` writes the built-in characters as JSON and, for each function of the numeric
kernel, a few dozen inputs with the outputs the reference gives. `tools/golden.js` plays 26 runs
described as data in `spec/scenarios.json` (every character through its gaits on rolling ground;
the soldier aiming, fighting, carrying, climbing and knocked down; hunts, stings, a swim and two
flights) and records the whole pose ten times a second. A port passes a stage when it reproduces
those numbers.

## Engines

- Unity: import the `.glb` with glTFast; slice the sheet by frame size or read the atlas.
- Godot: the `.glb` imports directly; use the sheet with `AnimatedSprite2D`.
- Unreal: import the `.glb` through Interchange as a skeletal mesh with animations.
- CLIo: `python clio.py GAME --import-model <id>.glb`, or paste the entry from `<id>_clio.json`
  into the game's `sprites.json`.

Every `.glb` the baker writes for the built-in characters passes the Khronos glTF validator with
no errors or warnings, and CLIo's own importer reads every clip. They have not yet been opened in
Unity, Godot or Unreal.

## Licence

Apache License 2.0, for every version in this repository. Copyright 2026 Daniel Sandner.
See `LICENSE` and `NOTICE`.
