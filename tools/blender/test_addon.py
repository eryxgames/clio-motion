# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""Tests the Blender add-on and the whole way round, without a screen.  Needs Blender as a Python module and Node:

    pip install bpy            (Python 3.11 for Blender 4.x and 5.0)
    python tools/blender/test_addon.py

1. Every rig in templates/3d is imported, checked and exported by the add-on.
2. The check is given things it must catch: a bone renamed, moved or re-parented, the armature moved or scaled,
   vertices with no weight, too many bones on a vertex, no mesh.
3. A model with a bone and a mesh of its own, and an armature that came in through Blender's own glTF importer.
4. Outside Blender the baker puts the clips on what was exported (node tools/gaitbake.js --model).
5. Those files are opened in Blender again, each clip is played, and where Blender puts every bone is compared with
   where the rig puts the joint.
Exit code 1 if anything fails."""
import importlib.util
import json
import math
import os
import subprocess
import sys
import tempfile

import bpy
import bmesh                      # (only there once bpy has been loaded)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
T = os.path.join(ROOT, "templates", "3d") + os.sep
OUT = tempfile.mkdtemp(prefix="clio_blender_")
spec = importlib.util.spec_from_file_location("clio_motion_blender", os.path.join(HERE, "clio_motion_blender.py"))
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)
A.register()
fails = 0


def expect(cond, what):
    global fails
    if not cond:
        fails += 1
    print(("ok    " if cond else "FAIL  ") + what, flush=True)


def fresh(name, model=True):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.clio_rig(filepath=T + name + ".rig.json", with_model=model)
    arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
    bpy.context.view_layer.objects.active = arm
    return arm, A.load_rig(arm[A.RIG_KEY])


def export(path, **kw):
    try:
        return bpy.ops.export_scene.clio_glb(filepath=path, **kw)
    except RuntimeError:
        return {"CANCELLED"}


names = sorted(f[:-9] for f in os.listdir(T) if f.endswith(".rig.json"))
for name in names:
    arm, rig = fresh(name)
    e, w, n = A.check(bpy.context, arm, rig)
    r = export(os.path.join(OUT, name + ".glb"))
    size = os.path.getsize(os.path.join(OUT, name + ".glb")) if os.path.exists(os.path.join(OUT, name + ".glb")) else 0
    expect(len(arm.data.bones) == len(rig["joints"]) and not e and not w and r == {"FINISHED"} and size > 1000,
           "%s: %d bones, check %d errors %d warnings, exported %d KB" % (name, len(arm.data.bones), len(e), len(w), size // 1024))

arm, rig = fresh("soldier")
arm.data.bones["Head"].name = "head"
e, w, n = A.check(bpy.context, arm, rig)
expect(any("Missing bone" in x and "Head" in x for x in e), "a renamed bone is an error")
expect(export(os.path.join(OUT, "bad.glb")) == {"CANCELLED"} and not os.path.exists(os.path.join(OUT, "bad.glb")), "and the export is refused")
arm, rig = fresh("soldier")
arm.location = (0.5, 0, 0)
expect(any("moved" in x for x in A.check(bpy.context, arm, rig)[0]), "a moved armature is an error")
arm, rig = fresh("soldier")
arm.scale = (2, 2, 2)
expect(any("scaled" in x for x in A.check(bpy.context, arm, rig)[0]), "a scaled armature is an error")
arm, rig = fresh("horse")
mo = [o for o in bpy.data.objects if o.type == "MESH"][0]
mo.vertex_groups.remove(mo.vertex_groups["Head"])
e, w, n = A.check(bpy.context, arm, rig, True)
expect(any("no weight" in x for x in e) and 0 < sum(v.select for v in mo.data.vertices) < len(mo.data.vertices), "vertices with no weight are an error, and are selected")
arm, rig = fresh("horse")
mo = [o for o in bpy.data.objects if o.type == "MESH"][0]
for g in list(mo.vertex_groups)[:5]:
    g.add(range(40), 0.2, "ADD")
expect(any("more than four" in x for x in A.check(bpy.context, arm, rig)[1]), "more than four bones on a vertex is a warning")
arm, rig = fresh("soldier")
bpy.ops.object.mode_set(mode="EDIT")
eb = arm.data.edit_bones["Head"]
eb.head = (eb.head[0], eb.head[1] + 0.06, eb.head[2])
bpy.ops.object.mode_set(mode="OBJECT")
e, w, n = A.check(bpy.context, arm, rig)
expect(not e and any("cm from where" in x for x in w), "a bone moved 6 cm is a warning")
arm, rig = fresh("soldier")
bpy.ops.object.mode_set(mode="EDIT")
arm.data.edit_bones["LowerArm_R"].parent = arm.data.edit_bones["Hips"]
bpy.ops.object.mode_set(mode="OBJECT")
expect(any("hangs under Hips" in x for x in A.check(bpy.context, arm, rig)[1]), "a bone under the wrong parent is a warning")
arm, rig = fresh("soldier", model=False)
e, w, n = A.check(bpy.context, arm, rig)
expect(not e and any("No mesh" in x for x in w), "no mesh bound is a warning")

arm, rig = fresh("soldier")
bpy.ops.object.mode_set(mode="EDIT")
hb = arm.data.edit_bones["Head"]
cb = arm.data.edit_bones.new("Crest")
cb.head, cb.tail, cb.parent = (hb.head[0], hb.head[1], hb.head[2] + 0.12), (hb.head[0], hb.head[1] + 0.1, hb.head[2] + 0.3), hb
bpy.ops.object.mode_set(mode="OBJECT")
me = bpy.data.meshes.new("crest")
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=0.08)
bmesh.ops.translate(bm, verts=bm.verts, vec=(0.0, -0.02, 1.80))
bm.to_mesh(me)
bm.free()
co = bpy.data.objects.new("crest", me)
bpy.context.collection.objects.link(co)
co.parent = arm
co.modifiers.new("Armature", "ARMATURE").object = arm
co.vertex_groups.new(name="Crest").add(range(8), 1.0, "REPLACE")
e, w, n = A.check(bpy.context, arm, rig)
expect(not e and not w and any("of your own" in x for x in n) and export(os.path.join(OUT, "soldier_crest.glb")) == {"FINISHED"}, "a bone and a mesh of one's own pass, with a note")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=T + "dragon.glb")
arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
bpy.context.view_layer.objects.active = arm
bpy.ops.object.clio_attach_rig(filepath=T + "dragon.rig.json")
e, w, n = A.check(bpy.context, arm, A.load_rig(arm[A.RIG_KEY]))
expect(not e and export(os.path.join(OUT, "dragon_from_glb.glb")) == {"FINISHED"}, "the template .glb brought in by Blender's own importer checks and exports")

# outside Blender: the clips onto what was exported
FIT = os.path.join(OUT, "fit")
for name in names + ["soldier_crest", "dragon_from_glb"]:
    cid = name.split("_")[0]
    kit = ["--kit", name.split("_")[1]] if name in ("soldier_pistols", "soldier_sword") else []
    r = subprocess.run(["node", os.path.join(ROOT, "tools", "gaitbake.js"), cid, "--model", os.path.join(OUT, name + ".glb"), "--out", FIT] + kit, capture_output=True, text=True)
    last = (r.stdout.strip().split("\n") or [""])[-1]
    expect(r.returncode == 0 and os.path.exists(os.path.join(FIT, name + "_clips.glb")), "clips onto %s: %s" % (name, last[last.find(":") + 2:] if ":" in last else r.stdout + r.stderr))

# and back in Blender: every clip played, every bone against the rig's joint
EXP = os.path.join(OUT, "expect.json")
subprocess.run(["node", os.path.join(HERE, "expect_joints.js"), EXP, "soldier", "horse", "scorpion"], check=True)
with open(EXP) as f:
    E = json.load(f)
for cid, clips in E.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(FIT, cid + "_clips.glb"))
    arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
    sc = bpy.context.scene
    fps = sc.render.fps / sc.render.fps_base
    if not arm.animation_data:
        arm.animation_data_create()
    worst_all, where = 0.0, ""
    for name, c in clips.items():
        act = next((a for a in bpy.data.actions if a.name == name or a.name.startswith(name + "_")), None)
        if act is None:
            expect(False, "%s: Blender has no action for clip %s" % (cid, name))
            continue
        for tr in list(arm.animation_data.nla_tracks):
            tr.mute = True
        arm.animation_data.action = act
        if hasattr(arm.animation_data, "action_slot") and getattr(act, "slots", None):
            arm.animation_data.action_slot = act.slots[0]
        for f, joints in enumerate(c["frames"]):
            t = c["times"][f] * fps
            sc.frame_set(int(math.floor(t)), subframe=t - math.floor(t))
            bpy.context.view_layer.update()
            for jn, want in joints.items():
                pb = arm.pose.bones.get(jn)
                if pb is None:
                    continue
                h = arm.matrix_world @ pb.head
                d = math.sqrt((h.x - want[0]) ** 2 + (h.z - want[1]) ** 2 + (-h.y - want[2]) ** 2)
                if d > worst_all:
                    worst_all, where = d, "%s, %s frame %d" % (jn, name, f)
    expect(worst_all < 0.004, "%s: %d clips played in Blender, every bone within %.2f mm of the rig's joint (%s)" % (cid, len(clips), worst_all * 1000, where))

A.unregister()
print("FAILED %d" % fails if fails else "all Blender checks passed (%s)" % bpy.app.version_string)
sys.exit(1 if fails else 0)
