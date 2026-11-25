# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""Plays the replays in spec/body/ through the whole Python step (legs, upper body, weapons, actions) and compares
every number of the pose, the count of each event and the sum of what the events carried, with the JavaScript reference.

    python python/tests/test_body.py            every replay
    python python/tests/test_body.py soldier    those whose name starts so
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "python"))
sys.path.insert(0, HERE)

import clio_motion as cm  # noqa: E402
from test_ground import ground, inputs as ground_inputs  # noqa: E402

TOL = 1e-6
KITS = (None, "rifle", "pistols", "sword")
PUNCHES = (None, "jab", "cross", "hook")
SWINGS = (None, "slash", "chop", "thrust")
TALLY = ("fire", "reload", "loaded", "throw", "grab", "putdown", "punch", "strike", "land", "jump", "hit", "drop", "bite", "pounce", "pinch", "sting", "ink")


def inputs(v):
    inp = ground_inputs(v)
    w = v[19:]
    if w[0]:
        inp["aim"] = w[1:4] if w[0] > 2 else w[1:3]
    inp["fire"], inp["armed"], inp["reload"] = bool(w[4]), bool(w[5]), bool(w[7])
    if w[6]:
        inp["kit"] = KITS[int(w[6])]
    if w[8]:
        inp["throw"] = {"target": w[9:12]} if w[8] > 1 else {}
    if w[12]:
        pk = {}
        if w[13]:
            pk["at"] = w[14:17]
        if w[17]:
            pk["heading"] = w[18]
        if w[19]:
            pk["size"] = {"d": w[20], "h": w[21], "w": w[22]}
        inp["pickup"] = pk
    inp["putdown"], inp["guard"], inp["block"] = bool(w[23]), bool(w[24]), bool(w[25])
    if w[26]:
        inp["punch"] = {"kind": PUNCHES[int(w[26])]}
        if w[27]:
            inp["punch"]["target"] = w[28:31]
    if w[31]:
        inp["track"] = w[32:35]
    if w[35]:
        inp["swing"] = {"kind": SWINGS[int(w[35])]}
    for k, name in enumerate(("bite", "pinch", "sting", "grab")):
        how = w[36 + 4 * k]
        if how:
            inp[name] = {"target": w[37 + 4 * k: 40 + 4 * k]} if how > 1 else {}
    inp["ink"] = bool(w[52])
    return inp


def flat(v, acc):
    """Every number of a pose, keys in alphabetical order at every level: the order the reference writes them in."""
    if isinstance(v, bool):
        acc.append(1 if v else 0)
    elif isinstance(v, (int, float)):
        acc.append(v)
    elif isinstance(v, list):
        for x in v:
            flat(x, acc)
    elif isinstance(v, dict):
        for k in sorted(v):
            flat(v[k], acc)
    return acc


def play(path):
    with open(path, encoding="utf-8") as f:
        lines = f.read().split("\n")
    head = lines[0].split()
    ch = cm.characters()[head[2]]
    hz, steps, every = int(head[3]), int(head[4]), int(head[5])
    g = [float(x) for x in lines[1].split()[1:]]
    nw = int(g[0])
    terrain = ground([g[1 + 4 * k: 5 + 4 * k] for k in range(nw)], (g[2 + 4 * nw], g[3 + 4 * nw]) if g[1 + 4 * nw] else None)
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
    inp, dt, k, tally, evsum = {}, 1 / hz, 0, [0] * len(TALLY), 0.0
    bad, worst, first = 0, 0.0, None
    for i in range(steps):
        inp = changes.get(i, inp)
        pose = cm.step(S, ch, inp, cm.STYLE, terrain, dt)
        for e in S.events:
            if e["type"] in TALLY:
                tally[TALLY.index(e["type"])] += 1
            evsum += sum(flat(e, []))
        S.events.clear()
        if i % every == every - 1:
            got, want = flat(pose, []) + tally + [evsum], wants[k]
            k += 1
            if len(got) != len(want):
                bad += 1
                first = first or "sample %d (t %.2f s): %d values, expected %d" % (k, (i + 1) * dt, len(got), len(want))
                continue
            err = max(abs(a - b) / (1 + abs(b)) for a, b in zip(got, want))
            if not err <= TOL:
                bad += 1
                if first is None:
                    j = max(range(len(got)), key=lambda q: abs(got[q] - want[q]))
                    first = "sample %d (t %.2f s) value %d of %d: got %r, expected %r" % (k, (i + 1) * dt, j, len(got), got[j], want[j])
            else:
                worst = max(worst, err)
    return k, bad, worst, first


def main(prefix=""):
    d = os.path.join(ROOT, "spec", "body")
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
            print("%-24s %d of %d samples differ; first: %s" % (name[:-4], bad, n, first))
    print("Python whole body: %d replays, %d samples, %d replays wrong, largest difference %.3g" % (runs, total, wrong, worst))
    return 1 if wrong or not runs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else ""))
