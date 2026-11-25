# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""A clip as triangles, with no engine: the core records the clip, the stand-in model follows each pose, and every
pose is written as a Wavefront .obj file that any 3D program opens.

    python python/examples/clip_obj.py [character] [clip] [folder]      # hyena walk out

A renderer of your own does the same and draws the triangles instead of writing them."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import clio_motion as cm  # noqa: E402

name = sys.argv[1] if len(sys.argv) > 1 else "hyena"
clip_name = sys.argv[2] if len(sys.argv) > 2 else "walk"
folder = sys.argv[3] if len(sys.argv) > 3 else "out"
ch = cm.characters()[name]
clip = cm.clips.record(ch, clip_name, frames=12) if clip_name in cm.clips.names(ch) else None
if clip is None:
    sys.exit("The %s has no clip '%s'. It has: %s" % (name, clip_name, ", ".join(cm.clips.names(ch))))
model = cm.mesh.build(cm.rig.rig_for(ch, clip["frames"][0]))
os.makedirs(folder, exist_ok=True)
sk = None
for k, pose in enumerate(clip["frames"]):
    sk = cm.rig.skeleton(ch, pose, sk)
    with open(os.path.join(folder, "%s_%s_%02d.obj" % (name, clip_name, k)), "w", encoding="utf-8") as f:
        f.write("# CLIo Motion: %s, %s, pose %d of %d (%.3f s, %s)\n" % (name, clip_name, k + 1, len(clip["frames"]), clip["duration"],
                                                                    "goes round" if clip["loop"] else "played once"))
        # .obj: y up, like the pose; x forward and z to the right are kept as they are
        f.write("".join("v %.5f %.5f %.5f\n" % p for p in cm.mesh.place(model, sk)))
        part = None
        for (a, b, c), p in zip(model["faces"], model["face_part"]):
            if p != part:
                part = p
                f.write("g %s_%d\n" % (model["parts"][p]["group"], p))
            f.write("f %d %d %d\n" % (a + 1, b + 1, c + 1))
print("%s: %d poses of the %s's %s (%d corners, %d faces each)" % (folder, len(clip["frames"]), name, clip_name, len(model["local"]), len(model["faces"])))
