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
| 2. Ground stepping: speed and turning, any direction, foot planning, jump and pounce, hips, leg IK | yes | yes | yes |
| 3a. Upright bodies whole: the soldier's spine, head, arms and aim, the three kits, firing and reloading, sword and shield, throwing, the crate, stance and punches; the mech's hull and guns | yes | yes | yes |
| 3b. Animals, arthropods and the octopus: bending spines, necks, jaws, claws, arms, tail chains, folded wings; bites, pinches, stings, grabs, ink | yes | yes | yes |
| 4. Swimming, flight, ladder, ledge, ragdoll | yes | | |
| 5. Engine wrappers (Unity, Godot, Unreal) and the CLIo hook | | | |

Stage 1 agrees with the reference to the last bit or two on 921 recorded cases, in both languages.
Stage 2 reproduces 24 recorded runs (828 sampled poses of every character) to the ten digits they are
recorded with. Stage 3 reproduces 48 whole-body runs (1,854 poses of all eleven
characters: every number of the pose, the count of each event, and what the events carry).

So in C and Python today every character is whole on the ground, with its weapons and every
action (`cm_step`, `step`). Swimming, flight, the ladder, the ledge and the ragdoll are stage 4.

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

    make -C c            # builds libclio_motion.a and runs its tests

    const cm_character *ch = cm_character_find("soldier");
    cm_state S; cm_input in = { 0 }; cm_pose pose;
    cm_state_init(&S, ch, ground_height, NULL);
    in.speed = 1.4; in.steer = 0.5; in.armed = 1;
    cm_step(&S, ch, &in, &CM_STYLE, ground_height, NULL, 1.0 / 60, &pose);

Python:

    import clio_motion as cm
    ch = cm.characters()["soldier"]
    S = cm.create_state(ch, ground_height)
    pose = cm.step(S, ch, {"speed": 1.4, "steer": 0.5, "armed": True}, cm.STYLE, ground_height, 1 / 60)

## Tests

    node js/test/run.js                 # the reference: every test, then the recorded runs
    make -C c test                      # C: the kernel's numbers, the ground replays, the whole-body replays
    python python/tests/test_kernel.py  # Python: the kernel's numbers
    python python/tests/test_ground.py  # Python: the ground replays
    python python/tests/test_body.py    # Python: the whole-body replays

After a change to `js/core.js` that is meant to change the motion, `npm run spec` records the
reference again; the C and Python versions then have to follow.

## How the versions are kept the same

`tools/spec.js` writes the built-in characters as JSON and, for each function of the numeric
kernel, a few dozen inputs with the outputs the reference gives, and the characters again as a C
table. `tools/golden.js` plays 53 runs described as data in `spec/scenarios.json` (every character
through its gaits on rolling ground; turns, sidesteps, drifting, blows, steps, jumps and pounces;
the soldier aiming, fighting, carrying, climbing and knocked down; hunts, stings, a swim and two
flights) and records the whole pose ten times a second. The 48 runs that stay on the ground are
written to `spec/body/` as replays that need no JSON reader: every input step by step, the whole
pose, and the events. The 24 of them that use only what the ground step reads are also written
to `spec/ground/`, with what the ground step alone must leave behind. The five runs that swim,
fly, climb or fall (stage 4) are in `spec/golden/`. A port passes a stage when it reproduces
those numbers.

## Planned

- Stage 4 in C and Python, then the engine wrappers and the CLIo hook.
- A first-person arms view, with the FPS demo.
- Flight that a game can use as behaviour, not only as a pose: take-off run and landing flare,
  banking turns with a turn radius that follows from speed, soaring and stooping (birds of prey),
  perching; a bat (erratic, flapping, roosting upside down); hovering insects with darting moves;
  a floating creature that drifts and bobs with no wings at all (a beholder, a jellyfish of the
  air), steered by small corrections.
- More kinds of body worth simulating: a snake or worm (travel by a wave along the body), a
  walking plant (roots as legs, a stalk that sways and a head that snaps), a slime or blob (a
  soft outline that stretches and recoils), a centipede (a wave of many legs), a fish and an eel
  (swimming by body wave), a crab (sideways gait, claws), a frog (crouch and leap, tongue as a
  chain), a kangaroo (hopping with a tail as a third leg), a horse with a rider, a bird on the
  ground (hop and walk, head stabilised), a giant with slow heavy steps, swarms and flocks of small
  simple bodies.

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
