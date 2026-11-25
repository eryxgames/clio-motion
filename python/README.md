# CLIo Motion in Python

Pure Python, standard library only, so CLIo can carry it without a compiler.

Ported so far: the numeric kernel (stage 1), the ground step (stage 2), whole bodies on the
ground (stage 3) for all twelve characters, and off the ground (stage 4a): swimming, flight, the
ladder and the ledge.

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
`grenade` for the soldier; `mounts` (guns, jaws, the sting), `back`, `front`, `neck`, `tailPts`,
`claws`, `arms`, `mantle`, `wings` and the rest for the others. Points are in world coordinates.

Inputs (all optional). Legs: `speed` (m/s), `crouch` (0..1), `steer` (-1..1) or `heading`
(radians), `dir` (the way to go, measured from the facing), `jump`, `hit: {"impulse": [x, y, z]}`,
`move: [vx, vz]` (drift while standing), `pounce` (animals). Soldier: `aim: [x, y, z]`, `fire`,
`armed`, `kit` ("rifle", "pistols", "sword"), `reload`, `throw: {"target": [x, y, z]}`,
`pickup: {"at": [x, y, z], "heading": a, "size": {"d": .., "h": .., "w": ..}}`, `putdown`,
`guard`, `block`, `punch: {"kind": "jab" | "cross" | "hook", "target": [x, y, z]}`, `track`,
`swing: {"kind": "slash" | "chop" | "thrust"}`. Animals: `bite`, `pinch`, `sting`, `grab` (each
`{"target": [x, y, z]}` or `{}`), `ink`. They mean what they mean in `js/README.md`.

Off the ground, a call changes the mode and `step` carries on:

    cm.enter_fly(S, ch); cm.leave_fly(S, ch, ground)            # the wasp, the dragon; inputs speed, steer, height
    cm.enter_swim(S, ch); cm.leave_swim(S, ch, ground)          # the octopus; inputs speed, steer, depth, ink
    cm.enter_ladder(S, ch, cm.Ladder(x, y0, spacing)); cm.leave_ladder(S, ch, ground)    # speed climbs
    cm.grab_ledge(S, ch, [x, y, z])                             # then climb or drop
    cm.place(S, ch, ground, x, z, heading)

`step_ground` gives the legs and hips alone. The ragdoll (`die`) and riding are not ported yet.

Speed on one core, whole steps a second: about 5,000 for the soldier, 7,000 for the hyena and
the dragon, 6,000 for the scorpion, 2,800 for the octopus.

Check it against the JavaScript reference:

    python python/tests/test_kernel.py
    python python/tests/test_ground.py
    python python/tests/test_body.py
