# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""Dressing a person from the wardrobe gives the parts the reference makes (spec/looks.json)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from clio_motion import characters, mesh, rig  # noqa: E402

SPEC = os.path.join(HERE, "..", "..", "spec")
fails = 0


def ok(cond, msg):
    global fails
    if not cond:
        fails += 1
        print("FAIL " + msg)


def close(a, b):
    if a is None or b is None or isinstance(a, (str, bool)) or isinstance(b, (str, bool)):
        return a == b
    if isinstance(a, (list, tuple)):
        return len(a) == len(b) and all(close(x, y) for x, y in zip(a, b))
    return abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))


with open(os.path.join(SPEC, "looks.json"), encoding="utf-8") as f:
    looks = json.load(f)["looks"]
rigs = rig.rigs()
worst = 0
for n, look in enumerate(looks):
    ch = characters()[look["character"]]
    name = look["character"] + ("" if look["kit"] == ch["mount"]["kit"] else "_" + look["kit"])
    base = rigs[name]
    got = rig.dressed(base, look.get("wear"), look.get("colors"), look.get("build", 1.0))
    want = look["parts"]
    same = len(got["parts"]) == len(want) and all(all(close(p[k], q[k]) for k in q) for p, q in zip(got["parts"], want))
    ok(same, "look %d (%s, %s): %d parts, the reference has %d" % (n, name, look.get("wear"), len(got["parts"]), len(want)))
    ok(got["joints"] is base["joints"] and got["name"] == base["name"], "look %d: the rig's own joints" % n)
    if "wear" not in look and look.get("build", 1) == 1:          # as the character comes: the rig's own parts
        ok(len(got["parts"]) == len(base["parts"]) and all(all(close(p[k], q[k]) for k in q) for p, q in zip(got["parts"], base["parts"])),
           "look %d: %s as it comes is its rig" % (n, name))
    m = mesh.build(got)
    ok(len(m["faces"]) > 100 and len(m["parts"]) == len(want), "look %d meshes" % n)
ok(len(looks) >= 40 and len({k["character"] for k in looks}) == 5, "looks of all five people (%d)" % len(looks))

# what is asked for and is not understood is passed over
w = rig.wear_of("woman", {"skirt": "knee", "hat": True, "hair": "green", "band": True, "coat": None, "nothing": 1})
ok(w["skirt"] == "knee" and w["hat"] == "none" and w["hair"] == "long" and w["band"] == "on" and w["coat"] == "none" and "nothing" not in w, "wear_of: %s" % w)
ok(rig.wear_of("soldier") is None and rig.wear_of("hyena", {"hat": "cap"}) is None, "only people have a wardrobe")
ok(sorted(rig.wardrobe()["people"]) == ["hazmat", "person", "scientist", "technician", "woman"], "the people")
try:
    rig.dressed(rigs["soldier"], {"hat": "cap"})
    ok(False, "a soldier is not dressed from the wardrobe")
except ValueError as e:
    ok("has no wardrobe" in str(e), str(e))
# a red dress: the skirt is the top's colour unless it has its own; build makes the body thicker and leaves the head
red = rig.dressed(rigs["woman"], {"skirt": "knee", "legs": "bare"}, {"top": "#B3202E"})
cols = [p["color"] for p in red["parts"]]
ok(cols.count("#b3202e") >= 9 and "#8a5a78" not in cols, "a red dress is red all over (%d parts)" % cols.count("#b3202e"))
two = rig.dressed(rigs["woman"], {"skirt": "knee"}, {"top": "#b3202e", "skirt": "#22252b"})
ok([p["color"] for p in two["parts"]].count("#22252b") >= 3, "a skirt of its own colour")
plain, heavy = rig.dressed(rigs["person"]), rig.dressed(rigs["person"], build=1.25)
for p, q in zip(plain["parts"], heavy["parts"]):
    body = p["group"].startswith(("torso", "leg", "arm"))
    ok(close(q["r"], p["r"] * (1.25 if body else 1.0)), "build: %s" % p["group"])
ok(len(rig.dressed(rigs["person"], {"hat": "cap", "pack": "on", "coat": "long"})["parts"]) == len(plain["parts"]) + 4, "a cap, a pack and a coat are four parts more")
print("wardrobe: %s" % ("%d FAILED" % fails if fails else "all passed (%d looks)" % len(looks)))
sys.exit(1 if fails else 0)
