# CLIo Motion

Characters that move by rule, not by keyframe. Give a character's proportions and what it should
do (go this fast, face that way, aim there, jump, climb, strike) and CLIo Motion works out the
pose, every step, on any ground: where the feet land, how the hips rise and fall, how the spine,
arms, tail or wings follow. The same rules drive a soldier, a heavy mech, a hyena, a horse, a
raptor, a scorpion, an octopus, a wasp and a dragon, a soldier riding the horse, the spider
mech or the dragon, and people who are not soldiers: a person in plain clothes, a technician, a
scientist, and one in a hazmat suit.

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
- People for a crowd: the soldier's body in plain clothes, an overall and hard hat, a lab coat or
  a hazmat suit, with nothing in the hands, a case in one (a briefcase, a tool box), or a case on
  wheels pulled behind with its axle on the ground wherever the ground is.
- Tails, tentacles and stings as chains with follow-through; bites, pinches and grabs that reach
  a target.
- Swimming (octopus) and flight (wasp, dragon).
- Riding: a rider sprung to the saddle, feet in the stirrups, hands on the reins, who can aim and
  fire from the back of a horse, a spider mech or a dragon in the air.
- Hit reactions and a ragdoll the body can be handed to at any moment.
- Baking: looping clips to a sprite sheet with an atlas, a 2D cutout (every part a picture, moved
  by the game), a skinned `.glb`, a `.glb` of rigid parts, and CLIo sprite frames.
- Your own art on the same skeletons: a drawing template for Inkscape and a rig for Blender for
  every character. A drawn or modelled character gets every clip with no rigging or animating by
  hand, and a drawn one can be run live in 2D. See [`templates/README.md`](templates/README.md).

## Layout

| Folder | What it holds |
|---|---|
| `js/` | The reference implementation: `core.js` (motion), `rig.js` (looks), `bake.js` (clips and files), `drawing.js` (reads a drawn character), `cutout.js` (plays a 2D cutout), `fight.js` (example game code), tests. Guide: [`js/README.md`](js/README.md). |
| `tools/` | `gaitbake.js`, the command-line baker (also puts the clips on a model of your own); `templates.js`, which writes the templates; `blender/`, the Blender add-on; `godot/`, a cutout player for Godot 4; `clio/carry.py`, which puts the Python package into a checkout of CLIo; `spec.js` and `golden.js`, which write what the other versions are checked against. |
| `templates/` | For artists: a drawing template for Inkscape (`2d/`) and a skeleton with a stand-in model for Blender (`3d/`), per character. Guide: [`templates/README.md`](templates/README.md). |
| `spec/` | The characters and their rigs as data, test vectors for the numeric kernel, and recorded runs of whole characters with their skeletons. |
| `c/` | The C99 library. |
| `python/` | The pure-Python version (standard library only), for CLIo. |
| `bench/` | Gait Bench's sources; `python bench/build.py` builds `docs/index.html`. |
| `examples/` | Two pages to open in a browser: a drawn character run live in 2D, and a cutout played. (`c/examples/` and `python/examples/`: a character drawn live from C and from Python.) |
| `docs/` | The built bench, for GitHub Pages. |
| `notes/` | Design notes for work that has not started. |

## What is ported

The JavaScript version does everything above. The C and Python versions are being built up from
the bottom, each stage checked against the reference before the next one starts.

| Stage | JavaScript | C | Python |
|---|---|---|---|
| 1. Numeric kernel: springs, two-bone IK, throw solver, chain fitter, gait rules | yes | yes | yes |
| 2. Ground stepping: speed and turning, any direction, foot planning, jump and pounce, hips, leg IK | yes | yes | yes |
| 3a. Upright bodies whole: the soldier's spine, head, arms and aim, the three kits, firing and reloading, sword and shield, throwing, the crate, stance and punches; the mech's hull and guns | yes | yes | yes |
| 3b. Animals, arthropods and the octopus: bending spines, necks, jaws, claws, arms, tail chains, folded wings; bites, pinches, stings, grabs, ink | yes | yes | yes |
| 4a. Swimming, flight, the ladder, the ledge grab | yes | yes | yes |
| 4b. The ragdoll, riding | yes | yes | yes |
| 5a. The skeleton, live: every joint of a pose, the move that takes a model's bone from its template to where it is now, the parts the joints carry and their draw order, where a part's picture goes | yes | yes | yes |
| 5b. Clips recorded from the core at run time; a stand-in model in triangles that follows the skeleton | yes | | yes |
| 5c. In an engine: CLIo (models moved by the library, carried in CLIo as `engine/motion`: clips for a game by beats, bodies run live, fliers and swimmers, a model of your own on the skeleton, lines) | | | yes |
| 5d. The C core under another language: a shared library with a flat interface (bodies as plain numbers), loaded by Python as CLIo loads CLIo Picture | | yes | yes |
| 5e. In an engine: Unity, Godot, Unreal | | | |

Stage 1 agrees with the reference to the last bit or two on 1,386 recorded cases, in both languages
(160 of them are stage 5a's rule for placing a part's picture).
Stage 2 reproduces 29 recorded runs (1,020 sampled poses of every character) to the ten digits they are
recorded with. Stages 3 and 4 reproduce 100 whole-body runs (4,086 poses of all
sixteen characters: every number of the pose, the count of each event, what the events carry, and
the mode the body is in). Stage 5a reproduces the skeleton of every third of those poses (1,362:
the joints, the parts they carry, the draw order and shading, the moves). Stage 5b, in Python,
records every clip of every character as the reference's baker does (466 clips, 6,190 poses).

So the C and Python versions now do everything the reference does: every character whole on the
ground, with its weapons and every action; in the water, in the air, on a ladder and on a ledge;
knocked down as a ragdoll from any of these; and a rider on the horse, the spider mech or the
dragon (`cm_step`, `step`). And from a pose they give what a game needs to show it while it
runs: the skeleton for a 3D model built on `templates/3d`, or the parts back to front for 2D
(`cm_skeleton_step`, `clio_motion.rig.skeleton`). The first engine is CLIo: a model in a game's
`models.json` with `"motion": "hyena"` walks, attacks, staggers, falls as a rag doll and lies,
with no clip kept in the game's files (CLIo carries the Python package; `tools/clio/carry.py`
puts a newer one in). What is left is Unity, Godot and Unreal.

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

    /* a rider: step the mount first, then the rider */
    cm_mount_up(&S, ch, &horse_state, cm_character_find("horse"));
    cm_step(&horse_state, horse, &horse_in, &CM_STYLE, ground_height, NULL, 1.0 / 60, &horse_pose);
    cm_step(&S, ch, &in, &CM_STYLE, ground_height, NULL, 1.0 / 60, &pose);
    in.die = 1;          /* knocked down: the ragdoll takes the body from wherever it is */

Python:

    import clio_motion as cm
    ch = cm.characters()["soldier"]
    S = cm.create_state(ch, ground_height)
    pose = cm.step(S, ch, {"speed": 1.4, "steer": 0.5, "armed": True}, cm.STYLE, ground_height, 1 / 60)

A model of your own (built on `templates/3d`, see [`templates/README.md`](templates/README.md)):

    node tools/gaitbake.js soldier --model my_soldier.glb --out out    # writes out/my_soldier_clips.glb

## Tests

    node js/test/run.js                 # the reference: every test, then the recorded runs
    make -C c test                      # C: the kernel's numbers, the ground replays, the whole-body replays and skeletons
    python python/tests/test_kernel.py  # Python: the kernel's numbers
    python python/tests/test_ground.py  # Python: the ground replays
    python python/tests/test_body.py    # Python: the whole-body replays and skeletons
    python python/tests/test_clips.py   # Python: every clip, as the reference's baker records it (half a minute)
    python python/tests/test_mesh.py    # Python: the stand-in model in triangles
    make -C c shared                    # the shared library: c/build/libclio_motion.so (.dylib; build.bat on Windows)
    CLIO_MOTION_LIB=c/build/libclio_motion.so python python/tests/test_native.py   # every recorded run through it, from Python
    python tools/blender/test_addon.py  # the Blender add-on, the whole way round (needs pip install bpy; not in CI)

After a change to `js/core.js` that is meant to change the motion, `npm run spec` records the
reference again; the C and Python versions then have to follow.

## How the versions are kept the same

`tools/spec.js` writes the built-in characters as JSON and, for each function of the numeric
kernel, a few dozen inputs with the outputs the reference gives, and the characters again as a C
table. `tools/golden.js` plays 88 runs described as data in `spec/scenarios.json` (every character
through its gaits on rolling ground; turns, sidesteps, drifting, blows, steps, jumps and pounces;
the soldier aiming, fighting, carrying and climbing; hunts, stings, a swim and two flights; every
character knocked down, from the ground, the air, the water, a ladder and a ledge; a rider on the
horse, the spider mech and the dragon, thrown, and refused by a hyena; three with the style
setting `still`; three many-legged bodies turning on the spot) and records the whole pose
ten times a second. They are written to `spec/body/` as replays that need no JSON reader: every
input step by step, the calls that change mode (take off, dive in, take hold of a ladder, mount),
the whole pose, and the events; a run with a rider carries the mount's inputs too. The 28 of them
that use only what the ground step reads are also written to `spec/ground/`, with what the ground
step alone must leave behind. For every third pose `spec/skeleton/` holds a digest of its live
skeleton: every joint's place and axes, the parts carried, the draw order and shading from the
side, and the joints' moves from the template. The rigs themselves (joints, template pose, parts)
are written as data to `spec/rigs.json`, and again for C and Python. A port passes a stage when
it reproduces those numbers.

The ragdoll decides many times a step whether a point touches the ground. So that every language
and every maths library decides alike, a point within a tenth of a micron of the ground counts as
touching. A standing body that has to bring a foot back under it picks the worst placed; feet
that mirror each other are equally badly placed to the last digit or two, so of those the first is
taken (a later one has to be worse by more than a billionth of a leg).

`spec/clips.txt` holds every clip of every character and kit as the baker records it, one number
a pose; the Python recorder has to give the same.

## Planned

- Unity, Godot and Unreal, on top of the live skeleton.
- A release of the shared library for every machine (the workflow is written; it has not run
  yet), and `--get-motion` in CLIo to fetch it.
- Groups: a steering layer for flocks, swarms, herds and squads that gives each member the inputs
  `step` already takes, and carries on when members are lost. Vehicles: hover craft and drones,
  then cars and buggies, then tanks, as a new kind of body with crew seats. See
  [notes/groups-and-vehicles.md](notes/groups-and-vehicles.md).
- A first-person arms view, with the FPS demo.
- For artists, next: shape keys and wrinkle maps driven by how far each joint is bent, helper
  bones, and the artist's own bones swung as chains
  ([notes/skinning-organic-models.md](notes/skinning-organic-models.md)); a cutout player for
  Unity; animal heads whose picture turns with the head; separate pictures for fore and hind
  legs; a skeleton variant laid out for humanoid retargeting.
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
