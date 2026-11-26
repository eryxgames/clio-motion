# CLIo Motion in Python

Pure Python, standard library only, so CLIo can carry it without a compiler.

Everything the JavaScript reference does is here: the numeric kernel (stage 1), the ground step
(stage 2), whole bodies on the ground (stage 3) for all seventeen characters, and off the ground
(stage 4): swimming, flight, the ladder, the ledge, the ragdoll and riding; the skeleton of a
pose for showing it (stage 5a); and, for a game that does not run the core every frame, clips
recorded from it and a stand-in model in triangles (stage 5b, both below). CLIo uses exactly
these: see the end.

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
`armed`, `kit` ("rifle", "pistols", "sword" for a soldier; "hands", "case", "trolley" for a person,
a woman, a technician, a scientist and one in a hazmat suit, who have it in the hand whatever `armed` says), `reload`, `throw: {"target": [x, y, z]}`,
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

`step_ground` gives the legs and hips alone.

The style (`cm.STYLE` is the plain one): `bounce`, `stride`, `arm`, `lean`, `step` scale those
parts of the motion, `snap` is how sharply a foot is put down, and `still` (0 to 1, 0 in
`cm.STYLE`) takes the life out of a standing body: no shifting of weight, no breathing, no
looking about. Pass a copy: `dict(cm.STYLE, still=1)`.

Knocked down: give `"die": {}` (a blow from straight ahead) or `"die": {"impulse": [x, y, z]}` for
one step. The body is handed to its ragdoll from wherever it is, a `die` event is given, and `step`
goes on returning the falling, then lying, pose. `cm.stand(S, ch, ground)` puts it back on its feet.

Riding: step the mount first, then the rider with the mount as the last argument.

    horse = cm.characters()["horse"]
    Sh = cm.create_state(horse, ground)
    cm.mount_up(S, ch, (Sh, horse))      # False if that body has no saddle
    cm.step(Sh, horse, {"speed": 9}, cm.STYLE, ground, 1 / 60)
    pose = cm.step(S, ch, {"armed": True, "aim": [30, 2, 6]}, cm.STYLE, ground, 1 / 60, (Sh, horse))
    cm.dismount(S, ch, ground)           # stands him beside the mount, on its left

## Showing a pose: the skeleton, live

A pose is points in the world. A game showing a model, or drawing the parts in 2D, wants joints:
where each is and how it is turned. `clio_motion.rig` gives them.

    sk = None                                           # keep one for each character
    # every frame, after cm.step:
    sk = cm.rig.skeleton(ch, pose, sk)
    for joint, f in zip(sk["rig"]["joints"], sk["frames"]):
        joint["name"], joint["parent"], f["o"], f["x"], f["y"], f["z"]      # place; side, along the bone, third axis

    m = cm.rig.joint_move(sk, j)                        # 3D: 16 numbers, glTF axes, column after column: world = m * rest

    for q in cm.rig.order(cm.rig.parts(sk), sk["heading"], camera_yaw):     # 2D: the parts, back to front
        q["a"], q["b"], q["r"], q["color"], q["level"]  # a capsule a..b (b None: a ball); shade 0 dark .. 4 light, -1 as it is

The joints are those of the character's rig file (`templates/3d/<name>.rig.json`), in the same
order and with the same names; `cm.rig.rigs()` holds the rigs as data. A soldier's rig follows
the kit in his hands. A bone seen exactly end on keeps the turn it had the frame before, which is
why the last skeleton is passed back in.

For a drawn character, `cm.rig.part_place(picture, a, b, rs, ppm, flip)` says where a part's
picture goes on the screen (`picture`: `w`, `h`, `axis`, and `box`, `len`, `r` for one cut from a
drawing; the cutout file lists them under `pictures`). It returns `x`, `y`, `rot`, `fx`, `fy` and
the box `dx`, `dy`, `dw`, `dh`.

`examples/live2d_svg.py` is a complete program: `python python/examples/live2d_svg.py horse`
writes a strip of a horse walking over rolling ground and knocked down. It writes the same file
as `c/examples/live2d_svg.c`, byte for byte, for all seventeen characters.

## Clips, and a model in triangles

A game that plays clips rather than running the core (a game by turns; a crowd far off) records
them when it starts, or when one is first needed:

    clip = cm.clips.record(ch, "walk", frames=12)     # None if the character has no such clip
    clip["frames"], clip["duration"], clip["loop"]    # poses, the body over the origin; seconds; whether it goes round
    clip["speed"]                                     # metres a second the body would cover
    i, j, k = cm.clips.sample(clip, t)                # at t seconds: pose i weighing 1 - k, pose j weighing k
    cm.clips.names(ch)                                # idle, walk, back, left, right, run, sneak, jump, attack, ... die

A looping clip is exactly one cycle. `kit="sword"` gives a soldier's other weapons, `style=` a
style, `impulse=[x, y, z]` the blow that floors the body in `die`, `fps=` the poses a second of a
clip played once (12), and `dt=1 / 60` runs the core at a coarser step, for half the work
(the default, 1/120, is what the reference's baker uses and what is checked). A clip takes about
a tenth of a second to record. This is a port of the recorder in `js/bake.js`, and gives its 214
clips pose for pose.

`cm.mesh` makes the stand-in model as triangles for a renderer that draws triangles: each part
of the rig a small closed shape, every corner bound to one joint, so it follows the skeleton
with no skinning.

    model = cm.mesh.build(cm.rig.rigs()["hyena"], sides=6)       # once; 300 to 1,200 faces by character and sides
    points = cm.mesh.place(model, sk)                            # every frame, for rig.skeleton's answer
    for (a, b, c), part in zip(model["faces"], model["face_part"]):
        model["parts"][part]["color"], model["parts"][part]["group"]       # "#rrggbb"; leg0, torso, head, ...

`cm.mesh.lines(rig)` is the same body for a display that draws lines (a vector display, a
plotter): the outlines of its thick parts and one line for each thin one, 30 to 150 lines a
body. It is what `build` returns, with `"edges"`, and `place` takes it.

`examples/clip_obj.py` writes a clip as `.obj` files, one a pose, that any 3D program opens.

## In CLIo

[CLIo](https://github.com/eryxgames/CLIo) carries this package as `engine/motion/clio_motion/`
and draws its models with it: `"hound": {"motion": "hyena"}` in a game's `models.json`. A
monster with such a model walks, runs, flies or swims, attacks, staggers, falls and lies; a
model of your own built on `templates/3d` comes in with `--import-model FILE --motion
SKELETON` and is moved by `rig.joint_move`; a level drawn in lines shows the body as
`mesh.lines`; and CLIo's `Actor` runs a body live, step by step (its tech demo shows crowds of
them). See "3D models" in CLIo's authoring guide. `python tools/clio/carry.py PATH/TO/CLIo` puts this version
there; `--check` says whether CLIo's copy is this one.

## The C core under Python

`clio_motion.native` loads the C library, when there is one, and runs bodies in it: thirty to
forty times as fast as the Python, the same to nine digits.

    from clio_motion import native
    if native.load():                               # None: no library, or one that does not agree with the Python
        b = native.Body("hyena")
        b.step(1 / 60, {"speed": 1.4, "heading": 0.5})    # the same inputs as cm.step; b.step(1 / 60): the same again
        b.x, b.z, b.heading, b.speed, b.mode, b.events()
        b.joints(), b.moves()                       # 12 and 16 numbers a joint
        m = native.bind(cm.mesh.build(rig))         # once; b.points(m): the model's corners, an array('d')

    python -m clio_motion.native                    # what is in use, and how fast

The library is built from `c/` (`make shared`; `build.bat` on Windows) and looked for in
`CLIO_MOTION_LIB` (`none` for none), then in `lib/` beside the package or one folder up, then
in the folders listed in `native.DIRS`, then where the system keeps libraries. When it is loaded
it walks three characters beside the Python and is not used if they differ (`native.status()`
says why). C and Python agree to about nine digits, not to the last one: over a long time two
bodies given the same inputs can come to step differently, so a game that must play back the
same should stay with one of them.

## Speed, and the check

Speed on one core, whole steps a second: about 5,000 for the soldier, 7,000 for the hyena and
the dragon, 6,000 for the scorpion, 2,800 for the octopus; a galloping horse and its rider
together about 3,000 pairs. The skeleton with its parts in order: about 9,000 a second for the
soldier, 6,000 for the scorpion.

Check it against the JavaScript reference:

    python python/tests/test_kernel.py
    python python/tests/test_ground.py
    python python/tests/test_body.py      # also the skeletons, against spec/skeleton/
    python python/tests/test_clips.py     # every clip, against spec/clips.txt (half a minute)
    python python/tests/test_mesh.py      # the model in triangles
    python python/tests/test_native.py    # the C library, if it is there: every recorded run through it
