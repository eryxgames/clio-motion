# Changelog

## 0.28.0

Gunners, and weapons that change hands.

- Two weapons: `chaingun` (prop `chaingun`: fired from the hip, the right hand on the grip
  behind and the left on the handle on top, ammunition in a box under it, 200 rounds) and
  `chainguns` (two of prop `sidegun`, one in each hand, fired in turn, 150 rounds each). The
  barrels take 0.35 s to come up to speed once the trigger is pulled, every time it is pulled
  (`spin`); then 20 rounds a second, or 24 from the pair. A round pushes the body back a
  fifth as hard as a rifle's (`bodyKick`, now also a kit's). Carried in the hands it is taken
  at a jog at most, a pair at a walk (`pace`). A new belt takes 3.2 s; the muzzle goes down
  while it is fed in.
- Two characters who come with the chaingun: `gunner` (heavy armour, shoulder pads, a drum on
  the back) and `commando` (bare arms, a headband, a belt of rounds across the chest). They are
  the soldier's skeleton, built a fifth thicker by the rig (`HEAVY`).
- Any body that bears arms carries any weapon: `kitFits` no longer ties a kit to one character,
  only people who are not soldiers to their own things. A soldier takes the chainguns, a
  commando the sword. `kitsOf(ch)` (`kits_of` in Python) lists what a character can carry.
  41 rigs now; as files, clips and templates are kept for every weapon with the soldier and for
  the other two bodies with the one they come with (`kitsKept`) - any other is recorded or
  made when asked for.
- Clips: a chaingun's `attack` is a second long, the trigger held through the barrels' coming up.
- C: `CM_KIT_CHAINGUN`, `CM_KIT_CHAINGUNS`, `CM_PROP_CHAINGUN`, `CM_PROP_SIDEGUN`; the flat
  interface takes the kits as 7 and 8. An older library passes over a kit it does not know and
  the body keeps what it had: `native.has_kit(kit)` says whether the one loaded knows it.
- Gait Bench: the gunner and the commando, and every weapon under "In the hands" for all three.
- Checked: 6 more recorded runs (108; 4,518 poses; 1,506 skeletons; 625 clips), which C and
  Python reproduce; everything recorded before is unchanged. `js/test/gunner_test.js`;
  `python/tests/test_mesh.py` now also checks that a pose's joints are its rig's by name, for
  every character with every kit it can carry.

## 0.27.0

A woman, a wardrobe, and anyone at all.

- `woman`: a fifth person who is not a soldier - the same skeleton (so the same clips, kits and
  templates' joints), a body narrower at the waist and shoulders and wider at the hips, long
  hair, and hips that sway a little more.
- A wardrobe for the five people (`js/rig.js`: `OPTIONS`, `WEAR`, `wearOf`): `shape` (m, f),
  `hair` (none, short, long, bun, tail), `hat` (hard, cap), `hood`, `coat` (lab, long), `skirt`
  (short, knee, long - a dress is a skirt the colour of the top), `sleeves` and `legs` (long,
  short; legs also bare), `band`, `tank`, `pack`, `boots`, `box` (brief, tool). `buildPrims`
  takes `wear` (over the character's own), `colors` by name (skin, hair, top, suit, skirt,
  shoe, glove, hat, band, pack, box, trim) and `build` (how thick the body's parts are). What a
  character wears as it comes is as it was: the four earlier people, their rigs, skeletons and
  templates are unchanged to the byte.
- Gait Bench: "Who it is" - ready-made people (a man, a woman, a woman in red, a tourist, a
  worker, a doctor), "Anyone" for one made up, every option and colour, build and height, and
  the line for CLIo's `models.json` to copy. A height shows as it is in an engine: the same body
  seen smaller, against a tape in real metres.
- For other languages: `spec/wardrobe.json` (every part of every option, marked with the option
  it belongs to and the name of its colour) and, in Python, `clio_motion.rig.dressed(rig, wear,
  colors, build)`, `wear_of` and `wardrobe`. `spec/looks.json` has 45 people dressed this way
  and that with the parts the reference makes of each; `python/tests/test_wardrobe.py`
  reproduces them. The C core moves bodies and knows nothing of clothes: C draws a person as
  it comes.
- A height is not the core's: the body is one size (1.70 m to the top of the head) and a
  shorter or taller person is that body scaled by whoever draws it.
- Checked: 2 more recorded runs for the woman (102; 4,176 poses; 1,392 skeletons; 529 clips);
  everything recorded before is unchanged.

## 0.26.0

People for a crowd.

- Four characters who are not soldiers: `person` (plain clothes), `technician` (an overall, a hard
  hat, a bright band, boots), `scientist` (a lab coat) and `hazmat` (a suit with a hood, a visor
  and an air tank). They are the soldier's body dressed otherwise - the same skeleton, gaits,
  jumps, ladders, ledges, riding, fists, hits and falls - and a little slower at a run
  (5.2 m/s). Their models are the bench's simple ones.
- Three kits for them, and only for them (a soldier asked for one keeps his weapons, a person
  asked for a rifle keeps what he has): `hands` (nothing), `case` (a case in the right hand - a
  briefcase for the person and the scientist, a thicker tool box for the technician and the one in
  the hazmat suit; it swings a little with the arm) and `trolley` (a case on wheels pulled by its
  handle: the hand stays low behind, the axle is on the ground wherever the ground is, and it is
  taken at a jog at most). They are in the hand whether or not `armed` is asked; fists up, a
  crate, a ladder or a change of kit lets them go; a body that falls drops them.
- The thing carried has a joint, `Case`. Rigs and templates: `person`, `person_case`,
  `person_trolley` and the same for the others (the technician starts with the case).
- Clips: people have no `attack`, `reload` or `throw`; the rest are a soldier's.
- C: `CM_KIT_HANDS`, `CM_KIT_CASE`, `CM_KIT_TROLLEY`, `CM_PROP_CASE`, `CM_PROP_TROLLEY`, and
  `mount_civil` in `cm_character`. The flat interface takes the kits as 4, 5 and 6. A library
  older than this does not know the four people: `native.Body("person")` says so.
- Checked: 12 more recorded runs (100 in all, 4,086 poses; 1,362 skeletons; 466 clips), which C
  and Python reproduce as before; the 88 earlier runs, their skeletons, the 214 earlier clips and
  every earlier template are unchanged to the byte. `js/test/people_test.js` checks the hand on
  the handle, the wheels on the ground, the pace, the clothes and the joints.
- Gait Bench: the four people, and their kits under "In the hands".
- A rig lists only the image parts it has (a person with empty hands has no case to draw).
- The release workflow has run now: 0.25.0's library built for all eight machines (Linux x64 and
  arm64, macOS universal, Windows x64 and arm64, three Android ABIs) and passed
  `python/tests/test_native.py` on those that can run it there.
- Its release job adds the zips and `checksums.txt` to a release that is already there instead of
  failing (a release made by hand on GitHub, which also makes the tag, was left without files).
  To release, push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

## 0.25.0

The C core under other languages: a shared library, and Python loading it.

- C: a flat interface for programs that load the library at run time (`cm_body_...` in
  `clio_motion.h`): a body behind calls on plain numbers - its ground (flat, waves, a grid of
  heights), steps with the inputs as 82 numbers, the calls that change mode, riding, state,
  events, joints, moves, a model's corners and a skin's. `make shared` builds
  `libclio_motion.so` / `.dylib`, `build.bat` `clio_motion.dll`; it exports that interface only.
  On Linux it asks for the oldest maths functions, so it loads on old systems.
- Python: `clio_motion.native` finds the library, checks it against the Python on a short walk,
  and runs bodies in it (`Body`, `bind`, `Skin`, `encode`): 30 to 40 times as fast.
- Checked: `c/test_api.c` uses every call on every character; `python/tests/test_native.py`
  plays the 88 recorded runs through the library from Python and gets the reference's 1,192
  skeletons, its events and modes, and compares corners, a skin and a grid ground with the
  Python's.
- `.github/workflows/release.yml`: builds the library for Linux, macOS, Windows and Android,
  runs that test where it can, keeps the builds as artifacts of every push, and makes a release
  for a tag `vX.Y.Z`. Written after CLIo Picture's; not yet run.
- Fixed: `make CFLAGS=...` dropped `-ffp-contract=off`.

## 0.24.0

For CLIo's second step with the library: bodies in lines.

- Python, `clio_motion.mesh.lines(rig)`: the stand-in model for a display that draws lines - the
  outlines of its thick parts, one line for each thin one (30 to 150 lines a body). `place` and
  `rest` take it.
- `mesh.build`: a ball is a double pyramid unless it is one of the body's big ones (a head, a
  hull), which keeps two rings at every number of sides.
- In CLIo (its own repository): fliers and swimmers, a model of your own on a skeleton
  (`--import-model FILE --motion SKELETON`), models in a level's lines, bodies run live
  (`Actor`) and a demo clip of a crowd of them.

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
