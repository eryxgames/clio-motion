# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""A character drawn live in 2D from Python (c/examples/live2d_svg.c is the same in C): the core steps, the skeleton says where the joints are, the parts they
carry are drawn back to front.  Writes a strip of moments as one SVG file (no other library is needed).

    python python/examples/live2d_svg.py [character] [out.svg]

A game does the same every frame, with its own drawing calls in place of the SVG text."""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import clio_motion as cm  # noqa: E402

name = sys.argv[1] if len(sys.argv) > 1 else "soldier"
out = sys.argv[2] if len(sys.argv) > 2 else name + "_live.svg"
ch = cm.characters()[name]


def ground(x, z):
    return 0.12 * math.sin(0.6 * x)


def shade(color, level):
    """The part's colour at a shade level (0 dark .. 4 light; -1: as it is)."""
    n = int(color[1:], 16)
    f = 1.0 if level < 0 else 0.6 + 0.1 * level
    return "rgb(%d,%d,%d)" % tuple(math.floor(((n >> s) & 255) * f + 0.5) for s in (16, 8, 0))


S = cm.create_state(ch, ground)
sk = None
ppm = 0.0                                         # pixels to a metre: set at the first moment, to fit the body
cell, shapes, moments = 330, [], 6
speed = min(ch["vmax"], 1.5 * math.sqrt(ch["L"] / 0.92))
for step in range(60 * moments):
    inp = {"speed": speed if step < 60 * (moments - 1) else 0.0, "armed": True}
    if step == 60 * (moments - 1) + 20:
        inp["die"] = {}                            # the last moment: knocked down
    pose = cm.step(S, ch, inp, cm.STYLE, ground, 1 / 60)
    S.events.clear()
    if step % 60 != 59:
        continue
    k = step // 60
    # where the joints are, the parts they carry, and the order to draw them in for a view from the side
    sk = cm.rig.skeleton(ch, pose, sk)
    plist = cm.rig.order(cm.rig.parts(sk), sk["heading"], 0.0)
    ox, oy = cell * k + cell / 2, 250
    if ppm == 0.0:
        ends = [(p, q["r"]) for q in plist for p in (q["a"], q["b"]) if p]
        wide = max(p[0] + r for p, r in ends) - min(p[0] - r for p, r in ends)
        tall = max(p[1] + r for p, r in ends) - ground(S.px, 0)
        ppm = min(150.0, 290.0 / wide, 215.0 / tall)
    gx = [(x, oy - (ground(S.px + (x - ox) / ppm, 0) - ground(S.px, 0)) * ppm) for x in range(cell * k, cell * (k + 1) + 1, 10)]
    shapes.append('<polyline points="%s" fill="none" stroke="#b4b8b0"/>' % " ".join("%.1f,%.1f" % p for p in gx))
    for q in plist:
        def at(p):
            return ox + (p[0] - S.px) * ppm, oy - (p[1] - ground(S.px, 0)) * ppm
        a, col, r = at(q["a"]), shade(q["color"], q["level"]), max(q["r"] * ppm, 0.6)
        if q["b"]:
            b = at(q["b"])
            shapes.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="%.1f" stroke-linecap="%s"/>' % (a[0], a[1], b[0], b[1], col, 2 * r, "butt" if q["sq"] else "round"))
        else:
            shapes.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s"/>' % (a[0], a[1], r, col))
with open(out, "w", encoding="utf-8") as f:
    f.write('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="300" viewBox="0 0 %d 300"><rect width="100%%" height="100%%" fill="#f6f6f3"/>\n%s\n</svg>\n' % (cell * moments, cell * moments, "\n".join(shapes)))  # c/examples/live2d_svg.c writes the same file
print("%s: %d moments of the %s, %d joints, %d parts" % (out, moments, name, len(sk["frames"]), len(sk["rig"]["parts"])))
