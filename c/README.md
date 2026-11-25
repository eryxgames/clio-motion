# CLIo Motion in C

C99, no dependencies but the maths library. One header (`clio_motion.h`) and four sources:
`clio_motion.c` (kernel), `clio_motion_ground.c` (ground step), `clio_motion_body.c` (upper
bodies, weapons, actions) and `clio_motion_characters.c` (the built-in characters, written by
`tools/spec.js`). `clio_motion_internal.h` is shared between the sources and is not part of the
interface.

    make            # libclio_motion.a, then the tests against the JavaScript reference
    make test

Ported so far: the numeric kernel (stage 1), the ground step (stage 2), and whole bodies on the
ground (stage 3) for all eleven characters: weapons, actions, spines, tails, claws, arms.

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

`cm_step_ground` gives the legs and hips alone.

No allocation: the state is one struct of about 8 KB, the pose about 5.5 KB. Whole steps a second
on one core: about 490,000 for the soldier, 240,000 for the hyena, 170,000 for the scorpion,
140,000 for the dragon, 90,000 for the octopus.

The Makefile turns fused multiply-add off (`-ffp-contract=off`) so that every platform rounds the
way the JavaScript reference does. The kernel agrees with the reference to the last bit or two
on 921 recorded cases; the ground step and the whole-body step reproduce 24 and 48 recorded runs
to the ten digits they are recorded with (they also do with fused multiply-add on, on the machine
they were tried on).

Next: swimming, flight, ladder, ledge and ragdoll (stage 4); the Unity, Godot and Unreal wrappers
sit on top of that.
