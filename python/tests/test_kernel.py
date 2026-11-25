# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""Runs the Python kernel over spec/kernel_vectors.txt and compares with what the JavaScript reference gave.

    python python/tests/test_kernel.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "python"))

import clio_motion as cm  # noqa: E402

TOL = 1e-9


def gait6(a):
    it = iter(a)
    nx = lambda: next(it)  # noqa: E731
    ch = {"L": nx(), "crouchDrop": nx(), "runStride": nx(), "gait": {}}
    g = ch["gait"]
    g["frRun"], g["frMax"] = nx(), nx()
    n = int(nx())
    g["walk"] = {"phases": [nx() for _ in range(n)], "duty": [nx(), nx()]}
    if nx():
        g["run"] = {"phases": [nx() for _ in range(n)], "duty": [nx(), nx()]}
    if nx():
        g["gallop"] = {"phases": [nx() for _ in range(n)], "duty": [nx(), nx()], "fr": nx(), "frMax": nx()}
    crouch, v = nx(), nx()
    s = cm.GaitState()
    s.run_want, s.run, s.gal_want, s.gal = bool(nx()), nx(), bool(nx()), nx()
    stride, dt = nx(), nx()
    for _ in range(6):
        o = cm.gait_params(ch, s, v, crouch, stride, dt)
    return [o["Leff"], o["Tn"], o["Fr"], o["run"], o["stride"], o["period"], o["duty"], o["moving"], o["Aw"], o["Ar"],
            o["gal"], float(s.run_want), float(s.gal_want)] + o["phases"]


def spring50(a):
    s = cm.Spring(a[0], a[1])
    for _ in range(50):
        s.step(a[2], a[3], a[4], a[5])
    return [s.x, s.v]


def chain(a):
    n = int(a[0])
    pts = [a[8 + 3 * k: 11 + 3 * k] for k in range(n + 1)]
    return [x for p in cm.reach_chain(pts, a[2:5], a[5:8], a[1]) for x in p]


def ik(a):
    mid, end = cm.ik2(a[0:3], a[3:6], a[6], a[7], a[8:11])
    return mid + end


def place(a):
    im = {"axis": ("ball", "up", "down", "right")[int(a[0])], "w": int(a[9]), "h": int(a[10])}
    if a[11]:
        im.update(box=a[12:16], len=a[16], r=a[17])
    o = cm.rig.part_place(im, a[2:4], a[4:6] if a[1] else None, a[6], a[7], bool(a[8]))
    return [o[k] for k in ("x", "y", "rot", "fx", "fy", "dx", "dy", "dw", "dh")]


CASES = {
    "partPlace": place,
    "smooth": lambda a: [cm.smooth(*a)], "decay": lambda a: [cm.decay(*a)], "ease": lambda a: [cm.ease(*a)],
    "wrapPi": lambda a: [cm.wrap_pi(*a)], "idleNoise": lambda a: [cm.idle_noise(*a)], "spring50": spring50,
    "ik2": ik, "lob": lambda a: cm.lob(a[0:3], a[3:6], a[6]), "reachChain": chain, "gait6": gait6,
}


def main(path=None):
    path = path or os.path.join(ROOT, "spec", "kernel_vectors.txt")
    cases = bad = unknown = 0
    worst = 0.0
    with open(path, encoding="utf-8") as f:
        for line in f:
            w = line.split()
            if not w:
                continue
            ni = int(w[1])
            ins = [float(x) for x in w[2:2 + ni]]
            want = [float(x) for x in w[3 + ni:]]
            fn = CASES.get(w[0])
            if fn is None:
                unknown += 1
                continue
            cases += 1
            got = fn(ins)
            if len(got) != len(want):
                bad += 1
                continue
            for g, x in zip(got, want):
                e = abs(g - x) / (1 + abs(x))
                if not e <= TOL:
                    if bad < 10:
                        print(w[0], "got", repr(g), "expected", repr(x))
                    bad += 1
                    break
                worst = max(worst, e)
    print("Python kernel: %d cases, %d wrong, %d not known, largest difference %.3g" % (cases, bad, unknown, worst))
    return 1 if bad or unknown or not cases else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else None))
