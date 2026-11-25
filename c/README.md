# CLIo Motion in C

C99, no dependencies but the maths library. One header (`clio_motion.h`) and three sources:
`clio_motion.c` (kernel), `clio_motion_ground.c` (ground step) and `clio_motion_characters.c`
(the built-in characters, written by `tools/spec.js`).

    make            # libclio_motion.a, then the tests against the JavaScript reference
    make test

Ported so far: the numeric kernel (stage 1) and the ground step (stage 2), which gives the legs
and hips of any built-in character on any ground:

    static double ground(double x, double z, void *user) { return 0.0; }

    const cm_character *ch = cm_character_find("soldier");
    cm_state S;
    cm_input in = { 0 };
    cm_ground_pose pose;

    cm_state_init(&S, ch, ground, NULL);
    in.speed = 1.4; in.steer = 0.5;
    cm_step_ground(&S, ch, &in, &CM_STYLE, ground, NULL, 1.0 / 60, &pose);
    /* pose.root, pose.pitch, pose.heading; pose.leg[i].hip, knee, ankle, ball, heel, toe (world) */
    S.n_events = 0;         /* CM_EV_LAND, CM_EV_JUMP and CM_EV_HIT events, read then cleared */

No allocation: the state is one struct of about 4 KB. The soldier steps about 850,000 times a
second on one core, the eight-legged scorpion 430,000.

The Makefile turns fused multiply-add off (`-ffp-contract=off`) so that every platform rounds the
way the JavaScript reference does. The kernel agrees with the reference to the last bit or two
on 921 recorded cases; the ground step reproduces 24 recorded runs to the ten digits they are
recorded with (it also does with fused multiply-add on, on the machine it was tried on).

The upper body (spine, arms, head, tail, weapons, actions) is stage 3; the Unity, Godot and
Unreal wrappers sit on top of that.
