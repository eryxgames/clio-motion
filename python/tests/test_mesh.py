# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""Checks the stand-in model in triangles (clio_motion.mesh) for every rig: each part a closed shape wound outwards,
no corner further from its part than the part is thick, and the model following the skeleton through a clip.

    python python/tests/test_mesh.py

Exits with 1 if anything is wrong.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import clio_motion as cm  # noqa: E402
from clio_motion import clips, mesh  # noqa: E402

bad = 0


def check(ok, what):
    global bad
    if not ok:
        bad += 1
        print("FAIL  " + what)
    return ok


def to_segment(p, a, b):
    if b is None:
        return math.dist(p, a)
    d = [b[i] - a[i] for i in range(3)]
    n = sum(x * x for x in d)
    t = max(0.0, min(1.0, sum((p[i] - a[i]) * d[i] for i in range(3)) / n)) if n > 1e-18 else 0.0
    return math.dist(p, [a[i] + d[i] * t for i in range(3)])


def volume(pts, faces):
    v = 0.0
    for a, b, c in faces:
        p, q, r = pts[a], pts[b], pts[c]
        v += (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6.0
    return v


def main():
    chars = cm.characters()
    for name, rig in cm.rig.rigs().items():
        ch = chars[rig["id"]]
        for sides in (4, 6):
            m = mesh.build(rig, sides=sides)
            pts = mesh.rest(m)
            ok_closed = ok_out = ok_near = True
            for i, part in enumerate(m["parts"]):
                fs = [f for f, p in zip(m["faces"], m["face_part"]) if p == i]
                edges = {}
                for a, b, c in fs:
                    for e in ((a, b), (b, c), (c, a)):
                        edges[e] = edges.get(e, 0) + 1
                # closed: every edge is walked once each way
                ok_closed &= all(n == 1 and edges.get((b, a)) == 1 for (a, b), n in edges.items())
                q = part["def"]
                r = q["r"]
                want = math.pi * r * r * (math.dist(q["a"], q["b"]) if q["b"] else 0.0) + 4.0 / 3.0 * math.pi * r ** 3
                vol = volume(pts, fs)
                ok_out &= 0.12 * want < vol <= want * 1.0001
                ok_near &= all(to_segment(m["local"][k], q["a"], q["b"]) <= r * 1.0001 for k in range(part["first"], part["first"] + part["count"]))
            check(ok_closed, "%s, %d sides: every part is a closed shape" % (name, sides))
            check(ok_out, "%s, %d sides: every part is wound outwards and fills a fair share of its capsule" % (name, sides))
            check(ok_near, "%s, %d sides: no corner lies outside its part" % (name, sides))
        # the model follows the skeleton: in the template pose it is at rest, and through a clip every corner stays on its part
        m = mesh.build(rig)
        kit = rig["kit"] if rig["name"] != rig["id"] else None
        tpl = {"rig": rig, "frames": rig["joints"]}
        check(max(math.dist(a, b) for a, b in zip(mesh.place(m, tpl), mesh.rest(m))) < 1e-12, name + ": at rest in the template pose")
        worst, sk = 0.0, None
        for clip in ("walk", "die"):
            c = clips.record(ch, clip, frames=6, kit=kit)
            for pose in c["frames"]:
                sk = cm.rig.skeleton(ch, pose, sk)
                pts, live = mesh.place(m, sk), cm.rig.parts(sk)
                for part, q in zip(m["parts"], live):
                    for k in range(part["first"], part["first"] + part["count"]):
                        worst = max(worst, to_segment(pts[k], q["a"], q["b"]) - q["r"])
        check(worst < 1e-9, "%s: through walk and die every corner stays on its part (%.3g m outside)" % (name, worst))
        print("%s %-16s %3d parts: %4d corners, %4d faces (%d with 4 sides)" % ("ok   " if not bad else "     ", name, len(m["parts"]), len(m["local"]), len(m["faces"]),
                                                                              len(mesh.build(rig, sides=4, thin=3)["faces"])))
    print("%d failed" % bad if bad else "mesh: all passed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
