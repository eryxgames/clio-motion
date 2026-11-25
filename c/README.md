# CLIo Motion in C

C99, no dependencies but the maths library. One header (`clio_motion.h`) and four sources:
`clio_motion.c` (kernel), `clio_motion_ground.c` (ground step), `clio_motion_body.c` (upper
bodies, weapons, actions) and `clio_motion_characters.c` (the built-in characters, written by
`tools/spec.js`). `clio_motion_internal.h` is shared between the sources and is not part of the
interface.

    make            # libclio_motion.a, then the tests against the JavaScript reference
    make test

Everything the JavaScript reference does is here: the numeric kernel (stage 1), the ground step
(stage 2), whole bodies on the ground (stage 3) for all twelve characters, and off the ground
(stage 4): swimming, flight, the ladder, the ledge, the ragdoll and riding.

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

No allocation: the state is one struct of about 24 KB (it keeps the last pose and the ragdoll), the
pose about 5.5 KB. Whole steps a second
on one core: about 490,000 for the soldier, 240,000 for the hyena, 170,000 for the scorpion,
140,000 for the dragon, 80,000 for the octopus; in the air 240,000 for the wasp and 130,000 for
the dragon; 70,000 for the octopus swimming; falling as a ragdoll about 100,000 for the soldier
and 180,000 for the horse; a galloping horse and its rider together about 140,000 pairs.

The Makefile turns fused multiply-add off (`-ffp-contract=off`) so that every platform rounds the
way the JavaScript reference does. The kernel agrees with the reference to the last bit or two
on 982 recorded cases; the ground step and the whole-body step reproduce 25 and 85 recorded runs
to the ten digits they are recorded with (they also do with fused multiply-add on, on the machine
they were tried on). The whole-body test also runs clean under the address and undefined-behaviour
sanitizers and under valgrind, and gives the same result built with clang.

Next: the Unity, Godot and Unreal wrappers sit on top of this.
