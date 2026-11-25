# CLIo Motion in Python

Pure Python, standard library only, so CLIo can carry it without a compiler.

Stage 1 (this version) holds the numeric kernel and the built-in characters as data:

    import clio_motion as cm

    soldier = cm.characters()["soldier"]
    state = cm.GaitState()
    gait = cm.gait_params(soldier, state, v=3.0)        # stride, period, duty, when each foot lands
    knee, ankle = cm.ik2(hip, target, upper, lower, pole)

Check it against the JavaScript reference:

    python python/tests/test_kernel.py

Whole-character stepping comes next, checked against the recorded runs in `spec/golden/`.
