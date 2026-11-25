# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""Plays the replays in spec/ground/ through the Python ground step and compares with the JavaScript reference.

    python python/tests/test_ground.py            every replay
    python python/tests/test_ground.py soldier    those whose name starts so
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "python"))

import clio_motion as cm  # noqa: E402

TOL = 1e-6          # the recorded numbers have ten digits


def ground(waves, wall):
    def f(x, z=0.0):
        y = 0.0
        for a, kx, kz, ph in waves:
            y += a * math.sin(kx * x + kz * z + ph)
        return y + (wall[1] if wall and x > wall[0] else 0)
    return f


def inputs(v):
    inp = {"speed": v[0], "crouch": v[1], "steer": v[2], "dir": v[5], "jump": bool(v[6])}
    if v[3]:
        inp["heading"] = v[4]
    if v[7]:
        inp["hit"] = {"impulse": [v[8], v[9], v[10]]}
    if v[11]:
        inp["move"] = [v[12], v[13]]
    if v[14]:
        inp["pounce"] = {"target": [v[16], v[17], v[18]]} if v[15] else {}
    return inp


def record(S, ch, lands, jumps):
    P = S.pose
    v = [S.px, S.pz, S.h, S.x, S.y, S.v, S.a, S.phase, S.om, S.crouch, S.run, S.gal, S.g_ref.x, S.pitch.x, S.reach_drop, S.hop.x,
         S.bank.x, S.side.x] + P["root"] + [P["pitch"], lands, jumps]
    for k, l in enumerate(P["legs"]):
        v.append(1 if l["planted"] else 0)
        v += l["hip"] + l["knee"] + l["ankle"] + l["ball"]
        if ch["legs"][k].get("foot"):
            v += l["heel"] + l["toe"]
        if not l["planted"]:
            v += l["target"]
    return v


def play(path):
    """(samples, wrong samples, largest difference, first difference as text)"""
    with open(path, encoding="utf-8") as f:
        lines = f.read().split("\n")
    head = lines[0].split()
    ch = cm.characters()[head[2]]
    hz, steps, every = int(head[3]), int(head[4]), int(head[5])
    g = [float(x) for x in lines[1].split()[1:]]
    nw = int(g[0])
    waves = [g[1 + 4 * k: 5 + 4 * k] for k in range(nw)]
    wall = (g[2 + 4 * nw], g[3 + 4 * nw]) if g[1 + 4 * nw] else None
    terrain = ground(waves, wall)
    changes, wants = {}, []
    for ln in lines[2:]:
        w = ln.split()
        if not w:
            continue
        if w[0] == "i":
            changes[int(w[1])] = inputs([float(x) for x in w[2:]])
        else:
            wants.append([float(x) for x in w[2:]])
    S = cm.create_state(ch, terrain)
    inp, dt, lands, jumps, k = {}, 1 / hz, 0, 0, 0
    bad, worst, first = 0, 0.0, None
    for i in range(steps):
        inp = changes.get(i, inp)
        cm.step_ground(S, ch, inp, cm.STYLE, terrain, dt)
        for e in S.events:
            lands += e["type"] == "land"
            jumps += e["type"] == "jump"
        S.events.clear()
        if i % every == every - 1:
            got, want = record(S, ch, lands, jumps), wants[k]
            k += 1
            if len(got) != len(want):
                bad += 1
                first = first or "sample %d: %d values, expected %d" % (k, len(got), len(want))
                continue
            err = max(abs(a - b) / (1 + abs(b)) for a, b in zip(got, want))
            worst = max(worst, err)
            if not err <= TOL:
                bad += 1
                if first is None:
                    j = max(range(len(got)), key=lambda q: abs(got[q] - want[q]))
                    first = "sample %d (t %.2f s) value %d: got %r, expected %r" % (k, (i + 1) * dt, j, got[j], want[j])
    return k, bad, worst, first


def main(prefix=""):
    d = os.path.join(ROOT, "spec", "ground")
    runs = total = wrong = 0
    worst = 0.0
    for name in sorted(os.listdir(d)):
        if not name.endswith(".txt") or not name.startswith(prefix):
            continue
        n, bad, w, first = play(os.path.join(d, name))
        runs += 1
        total += n
        worst = max(worst, w)
        if bad:
            wrong += 1
            print("%-26s %d of %d samples differ; first: %s" % (name[:-4], bad, n, first))
    print("Python ground step: %d replays, %d samples, %d replays wrong, largest difference %.3g" % (runs, total, wrong, worst))
    return 1 if wrong or not runs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else ""))
