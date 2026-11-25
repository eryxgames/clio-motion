# Changelog

## 0.20.0

Templates for artists: your own drawing or model on a character's skeleton, with every clip.

- 2D, Inkscape: `templates/2d/<character>.svg`, a locked guide layer with the figure and its
  bones, and one empty layer for each image part. Gait Bench reads the drawn file ("Load a
  drawing"): every layer with something in it becomes the picture of its part, held to its bone at
  the joint, and the sprite sheet is baked from it. A part may be bigger than the figure's.
- 3D, Blender: `templates/3d/<name>.rig.json` (the skeleton as data) and `<name>.glb` (the
  skeleton with a stand-in model), for every character and each of the soldier's kits.
  `tools/blender/clio_motion_blender.py`, an add-on: Import Rig, Check (bones, parents, places,
  weights, with reasons), Export.
- Clips onto a model of your own: `node tools/gaitbake.js <character> --model my.glb`, or
  "Put the clips on my model" in the bench. The model's bones may point any way (Blender turns
  them); each joint is given the movement its rig joint makes in the world. Bones of your own
  follow the rig bone above them.
- The template pose: standing still, the two halves of the body alike to the micron, a biped's
  arms straight, out and down.
- A new style setting in all three versions, `still` (0 to 1): takes the life out of a standing
  body (no shifting of weight, no breathing, no looking about). 0, the usual, changes nothing:
  the 82 earlier replays are the same to the byte. Replays can now carry a style (an `s` line);
  three new runs use it (85 in all, 3,462 poses).
- The baker's skinned `.glb`: a joint that slides in any clip now has its place written in every
  clip. Blender leaves unwritten channels as the last clip had them, which showed some clips
  wrong; engines were not affected. Joints are now exactly where the rig puts them (they were up
  to 3 mm out); the files are about a sixth larger.
- Gait Bench: "Load a drawing", "Save the template", "Save the 3D template", "Put the clips on
  my model".
- Tests: `js/test/template_test.js` and a check that `templates/` is what the code makes now, in
  the usual run; `tools/blender/test_addon.py` takes the add-on, the baker and playback in
  Blender the whole way round (Blender 5.0.1; needs `pip install bpy`, so it is not in CI).

## 0.19.0

- C99 and Python, stage 4b: the ragdoll and riding. With this both do everything the JavaScript
  reference does.
  - The ragdoll: `in.die` / `"die"` hands the body to it from the ground, the air, the water, a
    ladder or a ledge, for every character (limp tails and claws, weapons let go, wings folded);
    `cm_stand` / `stand`.
  - Riding: `cm_mount_up` / `mount_up`, `cm_dismount` / `dismount`; the rider is stepped after
    the mount. The seat spring, stirrups, reins and weapons from the saddle as in the reference.
- Reference: a ragdoll point within a tenth of a micron of the ground counts as touching it, so
  that every language and maths library decides contact alike. Motion is unchanged to the eye;
  the earlier regression outputs are unchanged.
- `spec/body/`: 82 replays (3,360 poses). 15 new runs knock down every character; 5 have a rider
  (the mount's character, inputs and calls are in the replay: `m`, `j` and `d` lines). The input
  line has grown to 82 numbers (`die` and its push) and the event tally to 22 (`die`, `mount`,
  `dismount`). `spec/golden/` is no longer used.
- C: the state keeps the last pose and the ragdoll (about 24 KB). The whole-body test runs clean
  under the address and undefined-behaviour sanitizers and valgrind.
- `notes/groups-and-vehicles.md`: design notes on flocks and swarms that lose members, on what a
  game's squad AI can be offered, and on vehicles.

## 0.18.0

- C99 and Python, stage 4a: off the ground. Swimming (the octopus: jets, depth, arms as chains),
  flight (the wasp and the dragon: wingbeat, glide, bank, hanging legs, attacks in the air), the
  ladder (hands and feet on real rungs) and the ledge grab (hang, pull up, drop). `cm_step` and
  `step` follow a character through whichever of these it is in. Both reproduce 61 replays.
- `spec/body/`: replays now carry the calls that change mode, a ladder as data, and the mode in
  every sample; seven more recorded runs (62 in all).

## 0.17.0

- A horse: walk, trot and gallop, a tail of hair, a saddle. It runs in the C and Python versions
  as it is (the characters are data).
- Riding (JavaScript reference): `mountUp`, `dismount`, a `ride` mode. A soldier on the horse, the
  spider mech or the dragon, on the ground and in the air; reins; weapons from the saddle.
  In Gait Bench: a Horse tab, and "Put a rider on" for the horse, the spider mech and the dragon.
- Drawing: eyes and visors go behind a head that is turned away (three-quarter view), on every
  character.
- `spec/`: two runs for the horse (55 in all).

## 0.16.0

- C99 and Python, stage 3b: every character whole on the ground. Animals (hyena, raptor, dragon):
  bending spine, neck, head and jaw, the tail as a chain with follow-through, bite and pounce.
  Arthropods (scorpion, mantis, wasp): claws, the pinch, the sting that arches over the back.
  The octopus: mantle, eight arms as curves, grab and ink. The quadruped robot and the spider
  mech with their guns. Folded wings on the ground. Both reproduce 48 whole-body replays.
- `spec/`: ten more recorded runs (53 in all); runs that stay on the ground are kept once, in
  `spec/body/`.

## 0.15.0

- C99 and Python, stage 3a: upright bodies whole (`cm_step`, `step`). The soldier's spine, head,
  arms and sideways aim; rifle, two pistols, sword and shield, held and stowed; firing, recoil and
  reloading; swings and the block; throwing; lifting and carrying a crate; the fighting stance and
  punches. The mech's hull and guns. Both reproduce 20 whole-body replays of the reference: every
  number of the pose, the count of each event, and what the events carry.
- `spec/body/`: whole-body replays; seven more recorded runs (43 in all), one of them for the
  weapon corner cases (firing dry, a reload refused and cancelled, a throw with pistols).
- Gait Bench: a copyright line; saving works as an ordinary download on a plain web page.

## 0.14.0

- C99 and Python, stage 2: the ground step (`cm_step_ground`, `step_ground`). Speed and turning,
  travel in any direction, the gait, foot planning with feet planted in the world, jumps and
  pounces, body height and pitch over uneven ground, leg inverse kinematics. Both reproduce the
  24 ground replays of the reference.
- `spec/ground/`: self-contained replays for stage 2; ten more recorded runs (36 in all).
- The built-in characters as a generated C table (`c/clio_motion_characters.c`).
- Reference: a corrective step now has its target from its first frame (`pose.legs[i].target`
  held an undefined x for one step).

## 0.13.0

- Ledge grab: `grabLedge`, hang, pull up, stand on top; `hang` and `climbup` clips; "Wall ahead"
  in Gait Bench.
- The project laid out as CLIo Motion: `js/` reference, `tools/`, `spec/`, `c/`, `python/`,
  `bench/`, `docs/`.
- `spec/`: characters as JSON, 921 test vectors for the numeric kernel, 26 recorded runs.
- C99 and Python, stage 1: the numeric kernel, agreeing with the reference on every vector.

## 0.12 and earlier

Built as the Gait Bench prototype: gaits, foot planting, aim and weapons, ladder, ragdoll, hands
and fists, the fistfight, the hyena, raptor, scorpion, octopus, mantis, wasp and dragon, tails,
swimming, flight, sword and shield, travel in any direction, ground that varies both ways.
