# CLIo Motion in Python

Pure Python, standard library only, so CLIo can carry it without a compiler.

Ported so far: the numeric kernel (stage 1), the ground step (stage 2), and upright bodies whole
(stage 3a): the soldier with weapons and every action, and the mech.

    import clio_motion as cm

    def ground(x, z):                    # height of the ground at a point of the world
        return 0.0

    ch = cm.characters()["soldier"]
    S = cm.create_state(ch, ground)
    pose = cm.step(S, ch, {"speed": 1.4, "armed": True, "aim": [8, 1.4, 2], "fire": True}, cm.STYLE, ground, 1 / 60)
    for e in S.events:                   # 'fire', 'land', 'throw', 'punch', 'strike', ...
        ...
    S.events.clear()

`pose` has the same keys as the JavaScript reference: `root`, `pitch`, `heading`, `legs`, `chest`,
`head`, `gaze`, `arms`, `props` (the weapons, with their grip points and muzzle), `carry`,
`grenade`, and for the mech `mounts`. Points are in world coordinates.

Inputs (all optional). Legs: `speed` (m/s), `crouch` (0..1), `steer` (-1..1) or `heading`
(radians), `dir` (the way to go, measured from the facing), `jump`, `hit: {"impulse": [x, y, z]}`,
`move: [vx, vz]` (drift while standing), `pounce` (animals). Upper body: `aim: [x, y, z]`, `fire`,
`armed`, `kit` ("rifle", "pistols", "sword"), `reload`, `throw: {"target": [x, y, z]}`,
`pickup: {"at": [x, y, z], "heading": a, "size": {"d": .., "h": .., "w": ..}}`, `putdown`,
`guard`, `block`, `punch: {"kind": "jab" | "cross" | "hook", "target": [x, y, z]}`, `track`,
`swing: {"kind": "slash" | "chop" | "thrust"}`. They mean what they mean in `js/README.md`.

For the other characters `step_ground` gives the legs and hips; `step` raises
NotImplementedError until their upper bodies are ported.

Speed on one core: about 5,000 whole steps a second for the soldier; the legs alone, 17,000
(soldier) and 10,000 (the eight-legged scorpion).

Check it against the JavaScript reference:

    python python/tests/test_kernel.py
    python python/tests/test_ground.py
    python python/tests/test_body.py
