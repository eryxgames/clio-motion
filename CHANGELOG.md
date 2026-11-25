# Changelog

## 0.23.0

In CLIo: models that walk, attack and fall by rule. Clips and a model in triangles, in Python.

- CLIo hook. A model in a CLIo game's `models.json` with `"motion": "hyena"` (or an object:
  character, kit, style, clips, detail, scale) is drawn and moved by this library, which CLIo
  carries as `engine/motion/clio_motion/`. `tools/clio/carry.py` puts this version into a
  checkout of CLIo. The change to CLIo itself is in CLIo's repository.
- Python, `clio_motion.clips`: `record`, `record_all`, `names`, `sample`, `shift_pose`. A port of
  the baker's recorder; all 214 clips of the twelve characters and the soldier's kits come out
  pose for pose (`spec/clips.txt`, `python/tests/test_clips.py`).
- Python, `clio_motion.mesh`: `build`, `place`, `rest`. The stand-in model as triangles, every
  corner bound to one joint (`python/tests/test_mesh.py`). `python/examples/clip_obj.py` writes
  a clip as `.obj` files.
- Fixed, in all three versions: a standing or turning body with mirrored legs (the octopus, the
  scorpion) chose which foot to bring back under it by the last digit of a sum, so JavaScript,
  C and Python could step with different legs. Of feet equally badly placed the first is now
  taken. The 85 runs recorded before are unchanged to the byte; three new ones (many-legged
  bodies turning on the spot) fail in C and in Python without the rule.
- `spec/`: 88 runs (3,576 poses), 28 ground replays, 1,192 skeletons, 214 clips.

## 0.22.0

The skeleton of a pose, live, in C and Python (stage 5a): what an engine needs to show a
character while the core runs.

- C: `cm_skeleton_step` gives every joint of a pose (place and axes, in the rig's order and
  names); `cm_joint_move` the matrix that takes a model's bone from the template pose to where it
  is now; `cm_skeleton_parts` and `cm_parts_order` the parts the joints carry, back to front for a
  view, with their shade; `cm_part_place` where a part's picture goes on the screen. The rigs are
  data: `cm_rig_find`, `cm_rig_for`. New sources `clio_motion_rig.c` and `clio_motion_rigs.c`.
- Python: the same as `clio_motion.rig` (`skeleton`, `joint_move`, `parts`, `order`,
  `part_place`, `rigs`), with `rigs.json` in the package.
- JavaScript reference: `liveSkeleton`, `liveParts`, `jointMove`, `rigData` in `js/bake.js`;
  `GaitRig.LOOK`.
- `spec/rigs.json`: every character's and kit's joints, template pose and parts as data.
  `spec/skeleton/`: the skeleton of every third recorded pose (1,154), which both ports reproduce.
  160 kernel vectors for `partPlace` (1,142 in all).
- Examples: `c/examples/live2d_svg.c` and `python/examples/live2d_svg.py` draw a character live
  and write the same SVG file, byte for byte, for all twelve characters.
- Cutout files: `pictures` (each drawn part's picture as `partPlace` wants it) and
  `sprites[i].rigPart`, for drawing live instead of from the clips.
- Godot cutout player: reads a picture the project has not imported.
  `tools/godot/check_cutout.gd` with `expect_cutout.js` compares it with the tested player. Both
  scripts are still not run in Godot.
- Tests: `js/test/skeleton_test.js` in the usual run; the C and Python whole-body tests also
  check the skeletons.

## 0.21.0

A drawn character, live in 2D and as a cutout; weights for a model in Blender.

- Live 2D (JavaScript): `GaitRig.sprites` lists what to draw for a pose, back to front, with the
  pictures of a drawn character if given; `GaitRig.drawSprites` draws the list on a canvas.
  `js/drawing.js` (`GaitDrawing.read`) is the reader of drawn characters, moved out of the bench
  so a game can use it. `examples/live2d.html`: the core running, a drawing loaded, arrow keys.
- 2D cutout: `<name>_cutout.png` (every part a picture, packed into one file) and
  `<name>_cutout.json` (where each picture is in every frame of every clip), written by the baker
  and by Gait Bench's Export, with the drawn parts when a drawing is loaded. `js/cutout.js` is a
  complete player with no dependencies; `examples/cutout.html` shows it;
  `tools/godot/clio_cutout.gd` is the same for Godot 4 (not yet run in Godot).
- Blender add-on, Bind: By Nearness (each vertex to the template part it is nearest, blended
  across joints, never across to a limb that is not next to it), Whole Pieces (each loose piece
  wholly to one bone, for machines), Automatic (Blender's automatic weights with the bones for
  carried things left out). A mesh object named after a bone is bound wholly to it.
- Rig files mark the joints for carried things (`carried`).
- `notes/skinning-organic-models.md`: what an organic model still lacks (a number for how far
  each joint is bent, corrective shapes, wrinkle maps, helper bones, things that swing) and how
  each could be added.
- Tests: `js/test/cutout_test.js` in the usual run; the Blender test now binds meshes all three
  ways.

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
