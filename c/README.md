# CLIo Motion in C

C99, no dependencies but the maths library. One header, one source file.

    make            # libclio_motion.a, then the test against the JavaScript reference's numbers
    make test

Stage 1 (this version) holds the numeric kernel: springs, two-bone inverse kinematics, the throw
solver, the chain fitter and the gait rules (`cm_gait_params_step`). See `clio_motion.h`.

The Makefile turns fused multiply-add off (`-ffp-contract=off`) so that every platform rounds the
way the JavaScript reference does. With it, the kernel agrees with the reference to the last bit
or two on the 921 recorded cases.

Whole-character stepping comes next, checked against the recorded runs in `spec/golden/`; the
Unity, Godot and Unreal wrappers sit on top of that.
