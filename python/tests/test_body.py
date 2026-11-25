# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""Plays the replays in spec/body/ through the whole Python step (legs, upper body, weapons, actions) and compares
every number of the pose, the count of each event and the sum of what the events carried, with the JavaScript reference.

    python python/tests/test_body.py            every replay
    python python/tests/test_body.py soldier    those whose name starts so
"""
import math
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
TALLY = ("fire", "reload", "loaded", "throw", "grab", "putdown", "punch", "strike", "land", "jump", "hit", "drop", "bite", "pounce", "pinch", "sting", "ink",
         "grip", "top", "die", "mount", "dismount")
MODES = ("ground", "ladder", "ragdoll", "swim", "fly", "ledge", "ride")


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
    if w[53]:
        inp["depth"] = w[54]
    if w[55]:
        inp["height"] = w[56]
    inp["climb"], inp["drop"] = bool(w[57]), bool(w[58])
    if w[59]:
        inp["die"] = {"impulse": w[60:63]} if w[59] > 1 else {}
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
    changes, calls, wants, ladder = {}, {}, [], None
    style = cm.STYLE
    mch, mchanges, mcalls = None, {}, {}                     # a run with a rider: the mount, its inputs and the calls on it
    for ln in lines[2:]:
        w = ln.split()
        if not w:
            continue
        if w[0] == "i":
            changes[int(w[1])] = inputs([float(x) for x in w[2:]])
        elif w[0] == "c":
            calls.setdefault(int(w[1]), []).append([float(x) for x in w[2:]])
        elif w[0] == "s":
            style = dict(zip(("bounce", "stride", "arm", "lean", "step", "snap", "still"), (float(x) for x in w[1:8])))
        elif w[0] == "m":
            mch = cm.characters()[w[1]]
        elif w[0] == "j":
            mchanges[int(w[1])] = inputs([float(x) for x in w[2:]])
        elif w[0] == "d":
            mcalls.setdefault(int(w[1]), []).append([float(x) for x in w[2:]])
        elif w[0] == "l":
            lx, y0, spacing, amp, freq, phase = [float(x) for x in w[1:7]]
            ladder = cm.Ladder(lx, y0, spacing, lambda k, y0=y0, spacing=spacing, amp=amp, freq=freq, phase=phase: y0 + k * spacing + amp * math.sin(freq * k + phase))
        else:
            wants.append([float(x) for x in w[2:]])
    S = cm.create_state(ch, terrain)
    Sm = cm.create_state(mch, terrain) if mch else None
    mount = (Sm, mch) if mch else None
    inp, minp, dt, k, tally, evsum = {}, {}, 1 / hz, 0, [0] * len(TALLY), 0.0
    bad, worst, first = 0, 0.0, None

    def call(S, ch, c):
        code = int(c[0])
        if code == 1:
            cm.enter_swim(S, ch)
        elif code == 2:
            cm.leave_swim(S, ch, terrain)
        elif code == 3:
            cm.enter_fly(S, ch)
        elif code == 4:
            cm.leave_fly(S, ch, terrain)
        elif code == 5:
            cm.enter_ladder(S, ch, ladder)
        elif code == 6:
            cm.leave_ladder(S, ch, terrain)
        elif code == 7:
            cm.grab_ledge(S, ch, c[1:4])
        elif code == 8:
            cm.place(S, ch, terrain, c[1], c[2], c[3])
        elif code == 9:
            cm.stand(S, ch, terrain)
        elif code == 10:
            cm.mount_up(S, ch, mount)
        elif code == 11:
            cm.dismount(S, ch, terrain)

    for i in range(steps):
        for c in mcalls.get(i, ()):
            call(Sm, mch, c)
        for c in calls.get(i, ()):
            call(S, ch, c)
        if mch:                                              # the mount is stepped first, then its rider
            minp = mchanges.get(i, minp)
            cm.step(Sm, mch, minp, style, terrain, dt)
            Sm.events.clear()
        inp = changes.get(i, inp)
        pose = cm.step(S, ch, inp, style, terrain, dt, mount)
        for e in S.events:
            if e["type"] in TALLY:
                tally[TALLY.index(e["type"])] += 1
            evsum += sum(flat(e, []))
        S.events.clear()
        if i % every == every - 1:
            got, want = flat(pose, []) + tally + [evsum, MODES.index(S.mode)], wants[k]
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
