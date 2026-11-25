# CLIo Motion in Python

Pure Python, standard library only, so CLIo can carry it without a compiler.

Ported so far: the numeric kernel (stage 1) and the ground step (stage 2), which gives the legs
and hips of any built-in character on any ground:

    import clio_motion as cm

    def ground(x, z):                    # height of the ground at a point of the world
        return 0.0

    ch = cm.characters()["soldier"]
    S = cm.create_state(ch, ground)
    pose = cm.step_ground(S, ch, {"speed": 1.4, "steer": 0.5}, cm.STYLE, ground, 1 / 60)
    # pose["root"], pose["pitch"], pose["heading"], and for each of pose["legs"]:
    # hip, knee, ankle, ball, heel, toe, planted, target (world coordinates)
    S.events.clear()                     # 'land', 'jump' and 'hit' events, read then cleared

Inputs (all optional): `speed` (m/s), `crouch` (0..1), `steer` (-1..1) or `heading` (radians),
`dir` (the way to go, measured from the facing), `jump`, `hit: {"impulse": [x, y, z]}`,
`move: [vx, vz]` (drift while standing), `pounce: {"target": [x, y, z]}` (animals).

About 17,000 steps a second for the soldier and 10,000 for the eight-legged scorpion on one core.

Check it against the JavaScript reference:

    python python/tests/test_kernel.py
    python python/tests/test_ground.py

The upper body (spine, arms, head, tail, weapons, actions) is stage 3.
