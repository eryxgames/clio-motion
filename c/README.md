# CLIo Motion in C

C99, no dependencies but the maths library. One header (`clio_motion.h`) and six sources:
`clio_motion.c` (kernel), `clio_motion_ground.c` (ground step), `clio_motion_body.c` (upper
bodies, weapons, actions), `clio_motion_rig.c` (the skeleton of a pose) and two written by
`tools/spec.js`: `clio_motion_characters.c` (the built-in characters) and `clio_motion_rigs.c`
(their joints and parts). `clio_motion_internal.h` is shared between the sources and is not part of the
interface.

    make            # libclio_motion.a, then the tests against the JavaScript reference
    make test

Everything the JavaScript reference does is here: the numeric kernel (stage 1), the ground step
(stage 2), whole bodies on the ground (stage 3) for all twelve characters, and off the ground
(stage 4): swimming, flight, the ladder, the ledge, the ragdoll and riding; and the skeleton of a
pose for showing it (stage 5a, below).

    static double ground(double x, double z, void *user) { return 0.0; }

    const cm_character *ch = cm_character_find("soldier");
    cm_state S;
    cm_input in;
    cm_pose pose;
    int i;

    cm_state_init(&S, ch, ground, NULL);
    memset(&in, 0, sizeof in);
    in.speed = 1.4; in.armed = 1; in.fire = 1;
    in.has_aim = 3; in.aim[0] = 8; in.aim[1] = 1.4; in.aim[2] = 2;
    cm_step(&S, ch, &in, &CM_STYLE, ground, NULL, 1.0 / 60, &pose);
    /* pose.base: root, pitch, heading, legs.  pose.chest, head, gaze, arm[2], prop[] (the weapons,
       with grip points and muzzle), carry, grenade; for the others pose.body says which of back,
       front, neck, tail_pts, claw[], arms[], mantle, wing[], mount[] are filled.  World coordinates */
    for (i = 0; i < S.n_events; i++) { /* S.events[i].type: CM_EV_FIRE, CM_EV_LAND, CM_EV_THROW, ... */ }
    S.n_events = 0;

Off the ground, a call changes the mode and `cm_step` carries on: `cm_enter_fly` / `cm_leave_fly`
(the wasp, the dragon; `in.speed`, `in.steer`, `in.height`), `cm_enter_swim` / `cm_leave_swim` (the
octopus; `in.depth`, `in.ink`), `cm_enter_ladder` / `cm_leave_ladder` (a `cm_ladder` with a rung
function; `in.speed` climbs), `cm_grab_ledge` (then `in.climb` or `in.drop`), `cm_place`.
`cm_step_ground` gives the legs and hips alone.

The style (`cm_style`, `CM_STYLE` for the plain one): `bounce`, `stride`, `arm`, `lean`, `step` scale
those parts of the motion, `snap` is how sharply a foot is put down, and `still` (0 to 1, 0 in
`CM_STYLE`) takes the life out of a standing body: no shifting of weight, no breathing, no looking
about.

Knocked down: set `in.die` for one step (1: a blow from straight ahead; 2: with the push in
`in.die_impulse`, in the world). The body is handed to its ragdoll from wherever it is (walking,
in the air, in the water, on a ladder), a `CM_EV_DIE` event is given, and `cm_step` goes on
returning the falling, then lying, pose (`pose.down`). After at most six seconds it lies still and
a step costs almost nothing. `cm_stand` puts it back on its feet (a switch: there is no get-up
animation). The ragdoll works in the body's forward-up plane and each joint keeps its sideways
offset; for a full 3D ragdoll hand the skeleton to the engine's own.

Riding: `cm_mount_up(&rider, soldier, &mount, horse)` puts a biped on a body with a saddle (the
horse, the spider mech, the dragon; 0 if it cannot be ridden). Each frame step the mount first,
then the rider, both with `cm_step`. The rider keeps a pointer to the mount's state, so that state
must stay where it is until `cm_dismount`. `pose.riding` is set and `pose.reins` runs from each
hand to the bit or the neck strap until a weapon is drawn. To throw a rider, give him `in.die`.

    cm_state horse_s, rider_s; cm_pose horse_p, rider_p; cm_input horse_in = { 0 }, rider_in = { 0 };
    const cm_character *horse = cm_character_find("horse"), *soldier = cm_character_find("soldier");
    cm_state_init(&horse_s, horse, ground, NULL); cm_state_init(&rider_s, soldier, ground, NULL);
    cm_mount_up(&rider_s, soldier, &horse_s, horse);
    horse_in.speed = 9; rider_in.armed = 1;
    cm_step(&horse_s, horse, &horse_in, &CM_STYLE, ground, NULL, 1.0 / 60, &horse_p);
    cm_step(&rider_s, soldier, &rider_in, &CM_STYLE, ground, NULL, 1.0 / 60, &rider_p);

## Showing a pose: the skeleton, live

A pose is points in the world. A game showing a model, or drawing the parts in 2D, wants joints:
where each is and how it is turned.

    cm_skeleton sk;                               /* keep one for each character */
    cm_part parts[CM_MAX_PARTS];
    int order[CM_MAX_PARTS], n, i, j;
    double m[16];

    memset(&sk, 0, sizeof sk);                    /* once, before its first use */
    /* every frame, after cm_step: */
    cm_skeleton_step(ch, &pose, &sk);             /* sk.joint[j].o, .x, .y, .z; sk.rig->joints[j].name, .parent */

    /* 3D, a model built on templates/3d: the matrix for each bone */
    for (j = 0; j < sk.n; j++) cm_joint_move(&sk, j, m);        /* glTF axes, column after column: world = m * rest */

    /* 2D, or a stand-in in 3D: the parts the joints carry, back to front */
    n = cm_skeleton_parts(&sk, parts);
    cm_parts_order(parts, n, sk.heading, camera_yaw, order);
    for (i = 0; i < n; i++) {
      const cm_part *q = &parts[order[i]];
      /* a capsule from q->a to q->b of radius q->def->r (a ball if !q->def->has_b), colour q->def->color,
         shade q->level (0 dark to 4 light, -1: as it is); q->def->part names the picture of a drawn character */
    }

The joints are those of the character's rig file (`templates/3d/<name>.rig.json`), in the same
order and with the same names; `cm_rig_find("soldier_pistols")` and `sk.rig` give the rig as data
(joints with parents and the template pose, parts in their joints' frames). A soldier's rig
follows the kit in his hands. A joint's `y` runs along its bone and `x` to its side; a bone seen
exactly end on keeps the turn it had the frame before, which is why the skeleton is kept between
frames. Nothing else is kept in it.

`cm_joint_move` is in glTF's axes (+Y up, +Z forward, right-handed), which is what a model
exported from Blender is in. Unity and Unreal convert on import; the wrappers will carry that.

For a drawn character (parts as pictures, from a cutout's `pictures` and `sprites[i].rigPart`, or
your own atlas) `cm_part_place` says where a picture goes: project the part's two ends, give the
radius in pixels, and it returns the place, turn, scale and box, anchored at the joint and
stretched to the bone's end as `js/rig.js` does.

`examples/live2d_svg.c` is a complete program: a character walking over rolling ground and
knocked down, written as an SVG strip. `python/examples/live2d_svg.py` writes the same file,
byte for byte, for all twelve characters.

The parts carried rigidly by the joints are within a few hundredths of a percent of leg length of
where the reference's own drawing code puts them, on average. The exceptions are bodies that
squash: the octopus's mantle while it swims (up to 19%) and a body rolling as a ragdoll (a few
percent); the reference stretches those, a rigid part cannot. And a foot drawn as one picture:
the reference aims it from the heel at the toe tip, so it tilts by up to 8 degrees as the toes
bend at push-off; carried by the foot joint it stays straight.

## For other languages: the shared library

    make shared          # build/libclio_motion.so (.dylib on a Mac); on Windows: build.bat, from a Developer Command Prompt

The shared library exports one small interface and nothing else: a body behind calls that take
and give plain numbers, for a program that loads the library at run time - Python's ctypes, C#'s
P/Invoke, an engine's extension. `clio_motion.h` lists it under "for other languages".

    void *b = malloc(cm_body_size());
    double in[CM_NIN] = { 0 }, joints[12 * CM_MAX_JOINTS];
    cm_body_init(b, "hyena", NULL);                 /* a character by name; a style, or NULL */
    in[0] = 1.4; in[3] = 1; in[4] = 0.5;            /* speed; a heading is given; the heading */
    cm_body_step(b, in, 1.0 / 60);                  /* in: the inputs as 82 numbers; NULL: the same as last step */
    n = cm_body_joints(b, joints);                  /* twelve numbers a joint: place, x, y, z axes */

Besides: the ground (flat, a sum of waves, or a grid of heights), `cm_body_place`, the calls that
change mode (dive in, take off, a ladder, a ledge, stand up), riding (`cm_body_mount`), where the
body is and what it is doing (`cm_body_state`), its events as counts (`cm_body_events`), each
joint's move from the template pose (`cm_body_moves`), a stand-in model's corners
(`cm_body_points`) and a skinned model's (`cm_body_skin`), both through a frame of your own
axes if wanted. The 82 numbers are listed at `cm_input_from_numbers`: they are the order the
recorded runs keep the inputs in.

`test_api.c` (part of `make test`) uses every call on every character. `python/tests/test_native.py`
plays all 88 recorded runs through the library from Python and gets the reference's skeletons,
events and modes. On Linux the library asks for the maths functions as the oldest C library
has them, so one built on a new system loads on an old one.

## Size and speed

No allocation: the state is one struct of about 24 KB (it keeps the last pose and the ragdoll), the
pose about 5.5 KB. Whole steps a second
on one core: about 490,000 for the soldier, 240,000 for the hyena, 170,000 for the scorpion,
140,000 for the dragon, 80,000 for the octopus; in the air 240,000 for the wasp and 130,000 for
the dragon; 70,000 for the octopus swimming; falling as a ragdoll about 100,000 for the soldier
and 180,000 for the horse; a galloping horse and its rider together about 140,000 pairs. The
skeleton (5.4 KB) with its parts, their order and every joint's matrix: about 630,000 a second
for the soldier, 380,000 for the scorpion, 280,000 for the octopus.

The Makefile turns fused multiply-add off (`-ffp-contract=off`) so that every platform rounds the
way the JavaScript reference does. The kernel agrees with the reference to the last bit or two
on 1,142 recorded cases; the ground step and the whole-body step reproduce 28 and 88 recorded runs
to the ten digits they are recorded with, and the skeleton 1,192 recorded poses (they also do with fused multiply-add on, on the machine
they were tried on). The whole-body test, with the skeleton, also runs clean under the address and undefined-behaviour
sanitizers and under valgrind, and gives the same result built with clang.

Next: the Unity, Godot and Unreal wrappers sit on top of this.
