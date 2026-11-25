# CLIo Motion in C

C99, no dependencies but the maths library. One header (`clio_motion.h`) and four sources:
`clio_motion.c` (kernel), `clio_motion_ground.c` (ground step), `clio_motion_body.c` (upper
bodies, weapons, actions) and `clio_motion_characters.c` (the built-in characters, written by
`tools/spec.js`). `clio_motion_internal.h` is shared between the sources and is not part of the
interface.

    make            # libclio_motion.a, then the tests against the JavaScript reference
    make test

Ported so far: the numeric kernel (stage 1), the ground step (stage 2), and upright bodies whole
(stage 3a): the soldier with weapons and every action, and the mech.

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
       with grip points and muzzle), carry, grenade, mount[] (the mech's guns): world coordinates */
    for (i = 0; i < S.n_events; i++) { /* S.events[i].type: CM_EV_FIRE, CM_EV_LAND, CM_EV_THROW, ... */ }
    S.n_events = 0;

For the other characters `cm_step_ground` gives the legs and hips (`cm_step` does the same for
them and returns -1) until their upper bodies are ported.

No allocation: the state is one struct of about 7.5 KB, the pose about 3 KB. On one core the
soldier takes about 450,000 whole steps a second and the mech 720,000; the legs alone, 850,000
(soldier) and 430,000 (the eight-legged scorpion).

The Makefile turns fused multiply-add off (`-ffp-contract=off`) so that every platform rounds the
way the JavaScript reference does. The kernel agrees with the reference to the last bit or two
on 921 recorded cases; the ground step and the whole-body step reproduce 24 and 20 recorded runs
to the ten digits they are recorded with (they also do with fused multiply-add on, on the machine
they were tried on).

Next: animals, arthropods and the octopus (stage 3b), then swimming, flight, ladder, ledge and
ragdoll (stage 4); the Unity, Godot and Unreal wrappers sit on top of that.
