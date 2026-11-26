# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""Checks CLIo Motion's C library as Python loads it (clio_motion.native) against the JavaScript reference and
against the Python: every recorded run of spec/body/ is played through the library and its skeleton, its events and
the mode it is in must come out as recorded; the inputs as numbers, a model's corners, a skin and a ground given as
a grid must be what the Python makes of them.

    python python/tests/test_native.py            # passed over, with a word, if the library is not there
    CLIO_MOTION_LIB=c/build/libclio_motion.so CLIO_MOTION_REQUIRE=1 python python/tests/test_native.py

Exits with 1 if anything is wrong (or if the library is required and not there).
"""
import ctypes
import glob
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
import clio_motion as cm  # noqa: E402
from clio_motion import mesh, native  # noqa: E402
import test_body  # noqa: E402

TOL = 1e-6
TALLY = ("fire", "reload", "loaded", "throw", "grab", "putdown", "punch", "strike", "land", "jump", "hit", "drop", "bite", "pounce",
         "pinch", "sting", "ink", "grip", "top", "die", "mount", "dismount")
MODES = ("ground", "ladder", "ragdoll", "swim", "fly", "ledge", "ride")
bad = 0


def check(ok, what):
    global bad
    if not ok:
        bad += 1
        print("FAIL  " + what)
    return ok


def numbers_of(joints, moves):
    """The joints' part of a skeleton's numbers, and the moves' (tools/golden.js: skeletonLine)."""
    v = []
    for j in range(len(joints) // 12):
        o, x, y, z = (joints[12 * j + 3 * k: 12 * j + 3 * k + 3] for k in range(4))
        v.append(o[0] + 0.7 * o[1] + 0.3 * o[2])
        v.append(0.9 * x[0] + 0.5 * x[1] + 0.2 * x[2] + 0.4 * y[0] + y[1] + 0.6 * y[2] + 0.3 * z[0] + 0.8 * z[1] + 1.1 * z[2])
    n = len(moves) // 16
    return v, sum(x * ((e % 4) + 1) for j in range(n) for e, x in enumerate(moves[16 * j: 16 * j + 16])) / n


def replay(path):
    """One recorded run through the library: (skeletons compared, how many wrong, the largest difference, what was
    wrong first)."""
    with open(path, encoding="utf-8") as f:
        lines = f.read().split("\n")
    head = lines[0].split()
    hz, steps, every = int(head[3]), int(head[4]), int(head[5])
    g = [float(x) for x in lines[1].split()[1:]]
    nw = int(g[0])
    waves, wall = [g[1 + 4 * k: 5 + 4 * k] for k in range(nw)], ((g[2 + 4 * nw], g[3 + 4 * nw]) if g[1 + 4 * nw] else None)
    changes, calls, mchanges, mcalls, wants, style, mname, ladder = {}, {}, {}, {}, [], None, None, None
    for ln in lines[2:]:
        w = ln.split()
        if not w:
            continue
        if w[0] in ("i", "j"):
            (changes if w[0] == "i" else mchanges)[int(w[1])] = (ctypes.c_double * native.NIN)(*[float(x) for x in w[2:2 + native.NIN]])
        elif w[0] in ("c", "d"):
            (calls if w[0] == "c" else mcalls).setdefault(int(w[1]), []).append([float(x) for x in w[2:]])
        elif w[0] == "s":
            style = dict(zip(("bounce", "stride", "arm", "lean", "step", "snap", "still"), (float(x) for x in w[1:8])))
        elif w[0] == "m":
            mname = w[1]
        elif w[0] == "l":
            ladder = [float(x) for x in w[1:7]]
        elif w[0] == "p":
            wants.append([float(x) for x in w[2:]])
    skel = {}
    spath = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(path))), "skeleton", os.path.basename(path))
    with open(spath, encoding="utf-8") as f:
        for ln in f:
            w = ln.split()
            if w and w[0] == "k":
                skel[int(w[1])] = (w[2], int(w[3]), [float(x) for x in w[4:]])

    def make(name):
        b = native.Body(name, style)
        b.ground_waves(waves, wall)
        b.reset()
        return b
    b, m = make(head[2]), (make(mname) if mname else None)
    zero = (ctypes.c_double * native.NIN)()
    inp, minp = zero, zero

    def call(body, c):
        code = int(c[0])
        if code == 10:
            b.mount(m)
        elif code == 5:
            body.call(5, *ladder)
        else:
            body.call(code, *c[1:])
    n = wrong = k = 0
    worst, first, tally = 0.0, None, dict.fromkeys(TALLY, 0)
    for i in range(steps):
        for c in mcalls.get(i, ()):
            call(m, c)
        for c in calls.get(i, ()):
            call(b, c)
        if m is not None:                                    # the mount is stepped first, then its rider
            minp = mchanges.get(i, minp)
            m.step_numbers(1 / hz, minp)
        inp = changes.get(i, inp)
        if b.step_numbers(1 / hz, inp) != 0:
            return n, wrong + 1, worst, "step %d failed" % i
        for e in b.events():
            tally[e] += 1
        if i % every == every - 1:
            want = wants[k]
            got = [tally[t] for t in TALLY] + [MODES.index(b.mode)]
            if got != [int(x) for x in want[-24:-2]] + [int(want[-1])]:
                wrong += 1
                first = first or "sample %d: events and mode %s, expected %s" % (k, got, want[-24:])
            if k in skel:
                name, nj, nums = skel[k]
                joints, moves = numbers_of(b.joints(), b.moves())
                n += 1
                if b.rig() != name or len(joints) != 2 * nj:
                    wrong += 1
                    first = first or "sample %d: rig %s with %d joints, expected %s with %d" % (k, b.rig(), len(joints) // 2, name, nj)
                else:
                    e = max(abs(a - c) / (1 + abs(c)) for a, c in zip(joints + [moves], nums[:2 * nj] + [nums[-1]]))
                    if not e <= TOL:
                        wrong += 1
                        first = first or "sample %d: the skeleton is off by %.3g" % (k, e)
                    else:
                        worst = max(worst, e)
            k += 1
    return n, wrong, worst, first


def flat_ground(x, z):
    return 0.0


def main():
    if native.load() is None:
        print("C library under Python: not checked - " + native.status())
        return 1 if os.environ.get("CLIO_MOTION_REQUIRE") else 0
    print(native.status())
    if os.environ.get("CLIO_MOTION_REQUIRE"):                # a library built from this tree is this version
        check(native.version() == cm.__version__, "the library is %s, the package %s" % (native.version(), cm.__version__))
        check(all(native.has_kit(k) for k in cm.KITS) and native.has_kit(None) and not native.has_kit("lance"), "the library knows every kit the package does")
    # 1. the inputs as numbers: every line of inputs of every recorded run, to a dictionary and back
    lines = 0
    for path in sorted(glob.glob(os.path.join(HERE, "..", "..", "spec", "body", "*.txt"))):
        with open(path, encoding="utf-8") as f:
            for ln in f:
                if ln[:2] in ("i ", "j "):
                    v = [float(x) for x in ln.split()[2:2 + native.NIN]]
                    out = native.encode(test_body.inputs(v), [0.0] * native.NIN)
                    lines += 1
                    if out != v:
                        j = next(q for q in range(native.NIN) if out[q] != v[q])
                        check(False, "%s: inputs as numbers differ at %d: %r, recorded %r" % (os.path.basename(path), j, out[j], v[j]))
                        break
    print("inputs as numbers: %d lines of the recorded runs, to a dictionary and back" % lines)
    # 2. every recorded run through the library
    runs = total = wrong_runs = 0
    worst = 0.0
    for path in sorted(glob.glob(os.path.join(HERE, "..", "..", "spec", "body", "*.txt"))):
        n, wrong, w, first = replay(path)
        runs += 1
        total += n
        worst = max(worst, w)
        if wrong:
            wrong_runs += 1
            check(False, "%s: %d wrong; first: %s" % (os.path.basename(path), wrong, first))
    print("C library under Python: %d replays, %d skeletons, %d replays wrong, largest difference %.3g" % (runs, total, wrong_runs, worst))
    # 3. a model's corners and a skin, against the Python's; with and without a frame
    for name in ("soldier", "hyena", "octopus"):
        ch = cm.characters()[name]
        S, b = cm.create_state(ch, flat_ground), native.Body(name)
        rig = cm.rig.rigs()[name]
        model, lined = mesh.build(rig), mesh.lines(rig)
        bound, bl = native.bind(model), native.bind(lined)
        order = list(range(len(model["local"]) - 1, -1, -3))
        some = native.bind(model, order)
        rest = [(-p[2], p[1], p[0]) for p in mesh.rest(model)]                 # the template pose on glTF's axes
        carried = [[(model["joint"][k], 0.6), (rig["joints"][model["joint"][k]]["parent"] if rig["joints"][model["joint"][k]]["parent"] >= 0 else model["joint"][k], 0.4)]
                   for k in range(len(rest))]
        skin = native.Skin(rest, carried)
        frame = [0.0, 0.0, 0.4, 0.4, 0.0, 0.0, 0.0, 0.4, 0.0, 1.0, 2.0, 3.0]    # a turn of the axes, a size, a shift
        sk, far, far_skin = None, 0.0, 0.0
        for i in range(120):
            inp = {"speed": 1.3 if i < 80 else 0.0, "heading": 0.9, "armed": True}
            pose = cm.step(S, ch, inp, cm.STYLE, flat_ground, 1 / 60)
            del S.events[:]
            b.step(1 / 60, inp)
            if i % 40 == 39:
                sk = cm.rig.skeleton(ch, pose, sk)
                for bd, md, od in ((bound, model, None), (bl, lined, None), (some, model, order)):
                    want = mesh.place(md, sk)
                    want = want if od is None else [want[q] for q in od]
                    got = b.points(bd)
                    far = max(far, max(abs(got[3 * q + c] - want[q][c]) for q in range(len(want)) for c in range(3)))
                    got = b.points(bd, frame)
                    for q, p in enumerate(want):
                        f = (0.4 * p[2] + 1.0, 0.4 * p[0] + 2.0, 0.4 * p[1] + 3.0)
                        far = max(far, max(abs(got[3 * q + c] - f[c]) for c in range(3)))
                moves = [cm.rig.joint_move(sk, j) for j in range(len(rig["joints"]))]
                got = b.skin(skin)
                for q, p in enumerate(rest):
                    w = [0.0, 0.0, 0.0]
                    for j, wt in carried[q]:
                        mt = moves[j]
                        for c in range(3):
                            w[c] += wt * (mt[c] * p[0] + mt[4 + c] * p[1] + mt[8 + c] * p[2] + mt[12 + c])
                    far_skin = max(far_skin, max(abs(got[3 * q + c] - w[c]) for c in range(3)))
        check(far < 1e-6, "%s: a model's corners, whole, in lines and picked, with and without a frame, are the Python's (off by %.3g)" % (name, far))
        check(far_skin < 1e-6, "%s: a skin's corners are what the joints' moves make of them (off by %.3g)" % (name, far_skin))
        check(abs(b.x - S.px) < 1e-6 and abs(b.z - S.pz) < 1e-6 and abs(b.heading - S.h) < 1e-6 and abs(b.speed - S.v) < 1e-6 and b.mode == S.mode,
              "%s: where it is, its heading and its speed are the Python's" % name)
    # 4. a ground given as a grid: as the Python on the same ground, blended between the grid's points
    hills = [0.25 * math.sin(0.5 * i) + 0.15 * math.cos(0.7 * j) for j in range(12) for i in range(40)]

    def grid(x, z):
        u, v = min(max((x + 2.0) / 0.5, 0.0), 39.0), min(max((z + 3.0) / 0.5, 0.0), 11.0)
        i, j = min(int(u), 38), min(int(v), 10)
        fu, fv = u - i, v - j
        a = hills[j * 40 + i] * (1 - fu) + hills[j * 40 + i + 1] * fu
        c = hills[(j + 1) * 40 + i] * (1 - fu) + hills[(j + 1) * 40 + i + 1] * fu
        return a * (1 - fv) + c * fv
    ch = cm.characters()["hyena"]
    S, b = cm.create_state(ch, grid), native.Body("hyena")
    b.ground_grid(-2.0, -3.0, 0.5, 40, 12, hills)
    b.reset()
    far, sk = 0.0, None
    for i in range(240):
        inp = {"speed": 2.0, "heading": 0.15}
        pose = cm.step(S, ch, inp, cm.STYLE, grid, 1 / 60)
        del S.events[:]
        b.step(1 / 60, inp)
        if i % 60 == 59:
            sk = cm.rig.skeleton(ch, pose, sk)
            got = b.joints()
            far = max(far, max(abs(got[12 * j + c] - sk["frames"][j]["o"][c]) for j in range(len(sk["frames"])) for c in range(3)))
    check(far < 1e-6 and S.px > 5.0 and max(hills) - min(hills) > 0.5, "over a ground given as a grid, the same as the Python on that ground (off by %.3g)" % far)
    # 5. riding, flying and falling by name; what cannot be is refused
    rider, horse = native.Body("soldier"), native.Body("horse")
    check(rider.mount(horse) and not native.Body("soldier").mount(native.Body("hyena")), "a soldier mounts the horse, not the hyena")
    for _ in range(120):
        horse.step(1 / 60, {"speed": 6.0})
        rider.step(1 / 60, {"armed": True})
    check(rider.mode == "ride" and abs(rider.x - horse.x) < 1.0 and horse.x > 3.0, "and rides with it")
    wasp = native.Body("wasp")
    check(wasp.call("enter_fly") == 1 and native.Body("hyena").call("enter_fly") == 0, "the wasp takes off; the hyena cannot")
    for _ in range(90):
        wasp.step(1 / 60, {"speed": 4.0, "height": 2.0})
    check(wasp.mode == "fly" and wasp.height > 1.0, "and flies")
    wasp.step(1 / 60, {"die": {}})
    for _ in range(600):
        wasp.step(1 / 60)
    check(wasp.mode == "ragdoll" and wasp.still and "die" in wasp.events(), "knocked out of the air it falls, and lies still")
    try:
        native.Body("unicorn")
        check(False, "a character that is not there is refused")
    except ValueError:
        pass
    fast, slow = native.speed_of("hyena", 20000)
    print("a walking hyena: %.0f steps a second in the library, %.0f in Python (%.0f times)" % (fast, slow, fast / slow))
    print("%d failed" % bad if bad else "native: all passed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
