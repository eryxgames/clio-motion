# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""Checks the Python clip recorder against the JavaScript reference: every clip of every character (and of each of
the soldier's kits) in spec/clips.txt is recorded again and must come out pose for pose.

    python python/tests/test_clips.py [character ...]

Exits with 1 if anything is wrong.
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import clio_motion as cm  # noqa: E402
from clio_motion import clips  # noqa: E402

TOL = 1e-6


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


def number(pose):
    v = flat(pose, [])
    return sum(x * ((i % 11) + 1) for i, x in enumerate(v)) / len(v)


def main():
    only = sys.argv[1:]
    chars = cm.characters()
    n = bad = poses = 0
    worst, where, t0 = 0.0, "", time.time()
    seen = {}
    with open(os.path.join(HERE, "..", "..", "spec", "clips.txt"), encoding="utf-8") as f:
        for line in f:
            w = line.split()
            if not w or w[0] != "c" or (only and w[1] not in only):
                continue
            cid, kit, name, count, loop = w[1], None if w[2] == "-" else w[2], w[3], int(w[4]), w[5] == "1"
            want = [float(x) for x in w[6:]]
            c = clips.record(chars[cid], name, frames=8, kit=kit)
            n += 1
            seen.setdefault((cid, kit), []).append(name)
            if c is None or len(c["frames"]) != count or c["loop"] != loop:
                bad += 1
                print("%s %s %s: %s" % (cid, kit or "", name, "no such clip" if c is None else "%d poses, not %d" % (len(c["frames"]), count)))
                continue
            got = [c["duration"], c["speed"], c["travel"], c["rise"]] + [number(p) for p in c["frames"]]
            d = max(abs(a - b) / (1 + abs(b)) for a, b in zip(got, want))
            poses += count
            if d > worst:
                worst, where = d, "%s %s" % (cid, name)
            if d > TOL:
                bad += 1
                print("%s %s %s: off by %.3g" % (cid, kit or "", name, d))
    # and the Python recorder offers no clip the reference does not record, nor leaves one out
    for (cid, kit), names in seen.items():
        mine = clips.names(chars[cid])
        extra = [c for c in mine if c not in names and clips.record(chars[cid], c, frames=2, kit=kit) is not None]
        if extra or [c for c in mine if c in names] != names:
            bad += 1
            print("%s %s: the clips are %s, the reference has %s (not there: %s)" % (cid, kit or "", mine, names, extra))
    print("Python clips: %d clips, %d poses, %d wrong, largest difference %.3g (%s), %.0f s" % (n, poses, bad, worst, where, time.time() - t0))
    return 1 if bad or not n else 0


if __name__ == "__main__":
    sys.exit(main())
