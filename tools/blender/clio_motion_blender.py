# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""CLIo Motion tools for Blender: build a character's skeleton, check a model skinned to it, export it.

Install: Edit > Preferences > Add-ons > Install from Disk, choose this file, tick "CLIo Motion".
The tools are in the 3D view's sidebar (N), tab "CLIo", and under File > Import / Export.

1. Import rig        reads templates/3d/<name>.rig.json and makes the armature in the template pose, with a
                     stand-in model of capsules skinned to it (a guide for size and joints; hide or delete it).
2. Model your mesh   round the armature. Keep the bones' names. Bind the mesh to the armature (Armature modifier,
                     vertex groups named after the bones). You may add bones of your own below the rig's.
3. Check             says what would go wrong: a bone missing or moved, the armature moved or scaled, vertices
                     with no weight, more than four bones on a vertex.
4. Export            checks, then writes a .glb with the armature and its meshes.

Then, outside Blender, the clips are put onto the model:   node tools/gaitbake.js <character> --model my.glb
(or in Gait Bench: Export > "Put the clips on my model").

glTF axes are used in the rig file (+Y up, +Z forward); Blender's are +Z up, -Y forward. A point (x, y, z) of the
file is (x, -z, y) here, which is also what Blender's own glTF importer and exporter do.
"""
import json
import math
import os

import bpy
from bpy.props import BoolProperty, StringProperty
from bpy_extras.io_utils import ExportHelper, ImportHelper

bl_info = {
    "name": "CLIo Motion",
    "author": "Daniel Sandner",
    "version": (0, 20, 0),
    "blender": (4, 2, 0),
    "location": "3D View > Sidebar > CLIo; File > Import, Export",
    "description": "Build a CLIo Motion skeleton, check a model skinned to it, export it as .glb",
    "category": "Import-Export",
    "doc_url": "https://github.com/eryxgames/clio-motion",
}

RIG_KEY = "clio_rig"            # custom property on the armature object: the rig file's text
REPORT = "CLIo Motion check"    # name of the text block the check writes its findings to


def to_blender(p):
    return (p[0], -p[2], p[1])


def _srgb_to_linear(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def _material(hex_color):
    name = "clio_" + hex_color.lstrip("#")
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    n = int(hex_color.lstrip("#"), 16)
    rgb = [_srgb_to_linear(((n >> s) & 255) / 255) for s in (16, 8, 0)]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (rgb[0], rgb[1], rgb[2], 1.0)
    try:                                                     # the surface colour a render and the exporter use
        if not mat.node_tree:
            mat.use_nodes = True
        bsdf = next((nd for nd in mat.node_tree.nodes if nd.type == "BSDF_PRINCIPLED"), None)
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
            bsdf.inputs["Roughness"].default_value = 0.8
    except Exception:
        pass
    return mat


def _capsule(a, b, r, seg=10, rings=3):
    """Vertices and faces of a capsule from a to b (b None: a ball)."""
    ax, ay, az = a
    if b is None:
        d, ln = (0.0, 0.0, 1.0), 0.0
    else:
        d = (b[0] - ax, b[1] - ay, b[2] - az)
        ln = math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2])
        d = (d[0] / ln, d[1] / ln, d[2] / ln) if ln > 1e-9 else (0.0, 0.0, 1.0)
    ref = (1.0, 0.0, 0.0) if abs(d[0]) < 0.9 else (0.0, 1.0, 0.0)
    k = ref[0] * d[0] + ref[1] * d[1] + ref[2] * d[2]
    x = (ref[0] - d[0] * k, ref[1] - d[1] * k, ref[2] - d[2] * k)
    xl = math.sqrt(x[0] * x[0] + x[1] * x[1] + x[2] * x[2])
    x = (x[0] / xl, x[1] / xl, x[2] / xl)
    y = (d[1] * x[2] - d[2] * x[1], d[2] * x[0] - d[0] * x[2], d[0] * x[1] - d[1] * x[0])
    lat = [(-math.pi / 2 + (math.pi / 2) * i / rings, 0.0) for i in range(rings + 1)]
    lat += [((math.pi / 2) * i / rings, ln) for i in range(rings + 1)]
    if ln < 1e-9:
        lat = lat[:rings + 1] + lat[rings + 2:]              # a ball has one equator
    verts, faces = [], []
    for ph, along in lat:
        for j in range(seg):
            th = 2 * math.pi * j / seg
            cx, cy, cd = math.cos(ph) * math.cos(th) * r, math.cos(ph) * math.sin(th) * r, along + math.sin(ph) * r
            verts.append((ax + x[0] * cx + y[0] * cy + d[0] * cd, ay + x[1] * cx + y[1] * cy + d[1] * cd, az + x[2] * cx + y[2] * cy + d[2] * cd))
    for i in range(len(lat) - 1):
        for j in range(seg):
            p, q = i * seg + j, i * seg + (j + 1) % seg
            faces.append((p, q, q + seg, p + seg))
    return verts, faces


def load_rig(text):
    rig = json.loads(text)
    if rig.get("format") != "clio-motion-rig" or "joints" not in rig:
        raise ValueError("this is not a CLIo Motion rig file (templates/3d/<name>.rig.json)")
    return rig


def build_rig(context, rig, text, with_model=True):
    """Make the armature (and the stand-in model) the rig file describes.  Returns the armature object."""
    name = rig.get("name") or rig["id"]
    if context.object and context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    arm = bpy.data.armatures.new(name + "_armature")
    obj = bpy.data.objects.new(name + "_armature", arm)
    context.collection.objects.link(obj)
    for o in context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    made = {}
    todo = list(rig["joints"])
    while todo:                                              # parents are not always listed before their children
        rest = []
        for j in todo:
            if j["parent"] is not None and j["parent"] not in made:
                rest.append(j)
                continue
            eb = arm.edit_bones.new(j["name"])
            eb.head, eb.tail = to_blender(j["head"]), to_blender(j["tail"])
            if (eb.tail - eb.head).length < 1e-4:
                eb.tail = (eb.head[0], eb.head[1], eb.head[2] + 0.03 * rig.get("height", 1.0))
            if j["parent"] is not None:
                eb.parent = made[j["parent"]]
                eb.use_connect = False
            made[j["name"]] = eb
        if len(rest) == len(todo):
            bpy.ops.object.mode_set(mode="OBJECT")
            raise ValueError("the rig file names a parent that is not a joint: " + rest[0]["parent"])
        todo = rest
    bpy.ops.object.mode_set(mode="OBJECT")
    obj[RIG_KEY] = text
    obj.show_in_front = True
    if with_model and rig.get("parts"):
        verts, faces, groups, face_mat, mats = [], [], {}, [], []
        for part in rig["parts"]:
            v, f = _capsule(to_blender(part["a"]), to_blender(part["b"]) if part.get("b") else None, part["r"])
            base = len(verts)
            verts += v
            faces += [tuple(base + i for i in face) for face in f]
            groups.setdefault(part["joint"], []).extend(range(base, base + len(v)))
            mat = _material(part.get("color") or "#888888")
            if mat not in mats:
                mats.append(mat)
            face_mat += [mats.index(mat)] * len(f)
        me = bpy.data.meshes.new(name + "_standin")
        me.from_pydata(verts, [], faces)
        for mat in mats:
            me.materials.append(mat)
        for poly, mi in zip(me.polygons, face_mat):
            poly.material_index = mi
        me.update()
        mo = bpy.data.objects.new(name + "_standin", me)
        context.collection.objects.link(mo)
        for jn, idx in groups.items():
            mo.vertex_groups.new(name=jn).add(idx, 1.0, "REPLACE")
        mo.parent = obj
        mo.modifiers.new("Armature", "ARMATURE").object = obj
    return obj


def _select_vertices(me, indices):
    """Leave exactly these vertices of a mesh selected (Object Mode)."""
    import bmesh
    want = set(indices)
    bm = bmesh.new()
    bm.from_mesh(me)
    for f in bm.faces:
        f.select = False
    for e in bm.edges:
        e.select = False
    for v in bm.verts:
        v.select = v.index in want
    bm.to_mesh(me)
    bm.free()
    me.update()


def _armature_of(context):
    o = context.object
    if o and o.type == "ARMATURE":
        return o
    if o and o.type == "MESH":
        for m in o.modifiers:
            if m.type == "ARMATURE" and m.object:
                return m.object
        if o.parent and o.parent.type == "ARMATURE":
            return o.parent
    arms = [a for a in context.scene.objects if a.type == "ARMATURE" and RIG_KEY in a]
    return arms[0] if len(arms) == 1 else None


def _meshes_of(context, arm):
    out = []
    for o in context.scene.objects:
        if o.type == "MESH" and any(m.type == "ARMATURE" and m.object == arm for m in o.modifiers):
            out.append(o)
    return out


def _unparented(context, arm):
    return [o for o in context.scene.objects if o.type == "MESH" and o.parent == arm and not any(m.type == "ARMATURE" and m.object == arm for m in o.modifiers)]


def check(context, arm, rig, select=False):
    """Compare the armature and the meshes bound to it with the rig.  Returns (errors, warnings, notes)."""
    errors, warnings, notes = [], [], []
    leg, bones = rig.get("leg") or rig.get("height", 1.0) * 0.5, arm.data.bones
    want = {j["name"]: j for j in rig["joints"]}
    ident = all(abs(v) < 1e-5 for v in arm.location) and all(abs(v) < 1e-5 for v in arm.rotation_euler) and all(abs(v - 1) < 1e-5 for v in arm.scale)
    if arm.rotation_mode == "QUATERNION":
        q = arm.rotation_quaternion
        ident = all(abs(v) < 1e-5 for v in arm.location) and abs(abs(q[0]) - 1) < 1e-5 and all(abs(v - 1) < 1e-5 for v in arm.scale)
    if not ident:
        errors.append("The armature has been moved, turned or scaled as an object. Put it back at the origin, or apply its transform (Object > Apply > All Transforms).")
    missing = [n for n in want if n not in bones]
    if missing:
        errors.append("Missing bone%s: %s. Bone names must be exactly those of the template." % ("s" if len(missing) > 1 else "", ", ".join(missing)))
    worst, worst_name = 0.0, None
    for n, j in want.items():
        b = bones.get(n)
        if not b:
            continue
        up = b.parent
        while up and up.name not in want:
            up = up.parent
        found = up.name if up else None
        if found != j["parent"]:
            warnings.append("Bone %s hangs under %s; the template has it under %s." % (n, found or "nothing", j["parent"] or "nothing"))
        h = to_blender(j["head"])
        d = math.sqrt(sum((b.head_local[i] - h[i]) ** 2 for i in range(3)))
        if d > worst:
            worst, worst_name = d, n
    if worst > 0.5 * leg:
        errors.append("Bone %s starts %.2f m from where the template has it. The model must stand in the template pose, at the template's size." % (worst_name, worst))
    elif worst > 0.03 * leg:
        warnings.append("Bone %s starts %.1f cm from where the template has it. The clips will still follow the rig exactly; parts round that joint may look bent or stretched." % (worst_name, worst * 100))
    extra = [b.name for b in bones if b.name not in want]
    if extra:
        notes.append("%d bone%s of your own (%s%s): each will follow the nearest rig bone above it, rigidly." % (len(extra), "s" if len(extra) > 1 else "", ", ".join(extra[:6]), ", ..." if len(extra) > 6 else ""))
    meshes = _meshes_of(context, arm)
    if not meshes:
        warnings.append("No mesh is bound to this armature (a mesh needs an Armature modifier that points to it).")
    for o in _unparented(context, arm):
        warnings.append("Mesh %s is parented to the armature but has no Armature modifier: it will not bend." % o.name)
    for o in meshes:
        if any(abs(v) > 1e-5 for v in o.location) or any(abs(v) > 1e-5 for v in o.rotation_euler) or any(abs(v - 1) > 1e-5 for v in o.scale):
            warnings.append("Mesh %s has a transform of its own. Apply it (Object > Apply > All Transforms) so it exports where you see it." % o.name)
        deform = {g.index for g in o.vertex_groups if g.name in bones}
        stray = [g.name for g in o.vertex_groups if g.name not in bones]
        loose, many = [], 0
        for v in o.data.vertices:
            n = sum(1 for g in v.groups if g.group in deform and g.weight > 1e-6)
            if n == 0:
                loose.append(v.index)
            elif n > 4:
                many += 1
        if loose:
            errors.append("Mesh %s: %d of %d vertices have no weight on any bone; they would stay behind when the body moves.%s" % (o.name, len(loose), len(o.data.vertices), " They are selected now (Edit Mode shows them)." if select else ""))
            if select:
                _select_vertices(o.data, loose)
        if many:
            warnings.append("Mesh %s: %d vertices are weighted to more than four bones. The export keeps the four strongest. (Weights > Limit Total cleans this up.)" % (o.name, many))
        if stray:
            notes.append("Mesh %s: vertex group%s %s %s no bone and will be ignored." % (o.name, "s" if len(stray) > 1 else "", ", ".join(stray[:6]) + (", ..." if len(stray) > 6 else ""), "match" if len(stray) > 1 else "matches"))
    return errors, warnings, notes


def write_report(arm, rig, errors, warnings, notes):
    lines = ["CLIo Motion check: %s against rig %s" % (arm.name, rig.get("name") or rig.get("id")), ""]
    lines += ["ERROR    " + e for e in errors] + ["WARNING  " + w for w in warnings] + ["NOTE     " + n for n in notes]
    if not errors and not warnings:
        lines.append("Nothing wrong was found.")
    lines.append("")
    lines.append("%d error%s, %d warning%s." % (len(errors), "" if len(errors) == 1 else "s", len(warnings), "" if len(warnings) == 1 else "s"))
    text = bpy.data.texts.get(REPORT) or bpy.data.texts.new(REPORT)
    text.clear()
    text.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    return lines


def _rig_of(arm):
    if arm is None or RIG_KEY not in arm:
        return None
    try:
        return load_rig(arm[RIG_KEY])
    except Exception:
        return None


class CLIO_OT_import_rig(bpy.types.Operator, ImportHelper):
    """Make the armature a CLIo Motion rig file describes, in the template pose"""
    bl_idname = "import_scene.clio_rig"
    bl_label = "Import CLIo Motion Rig"
    bl_options = {"REGISTER", "UNDO"}
    filename_ext = ".json"
    filter_glob: StringProperty(default="*.rig.json;*.json", options={"HIDDEN"})
    with_model: BoolProperty(name="Stand-in model", description="Also make the model of capsules, skinned to the armature, as a guide", default=True)

    def execute(self, context):
        try:
            with open(self.filepath, encoding="utf-8") as f:
                text = f.read()
            rig = load_rig(text)
            arm = build_rig(context, rig, text, self.with_model)
        except Exception as e:
            self.report({"ERROR"}, str(e))
            return {"CANCELLED"}
        self.report({"INFO"}, "%s: %d bones, %.2f m tall" % (arm.name, len(arm.data.bones), rig.get("height", 0)))
        return {"FINISHED"}


class CLIO_OT_attach_rig(bpy.types.Operator, ImportHelper):
    """Tell the active armature which CLIo Motion rig it is (for an armature that was not made by Import Rig, such as one brought in from a template .glb)"""
    bl_idname = "object.clio_attach_rig"
    bl_label = "Attach CLIo Motion Rig File"
    bl_options = {"REGISTER", "UNDO"}
    filename_ext = ".json"
    filter_glob: StringProperty(default="*.rig.json;*.json", options={"HIDDEN"})

    @classmethod
    def poll(cls, context):
        return context.object is not None and context.object.type == "ARMATURE"

    def execute(self, context):
        try:
            with open(self.filepath, encoding="utf-8") as f:
                text = f.read()
            load_rig(text)
        except Exception as e:
            self.report({"ERROR"}, str(e))
            return {"CANCELLED"}
        context.object[RIG_KEY] = text
        return {"FINISHED"}


class CLIO_OT_check(bpy.types.Operator):
    """Compare the armature and the meshes bound to it with the CLIo Motion rig"""
    bl_idname = "object.clio_check"
    bl_label = "Check Against CLIo Motion Rig"
    bl_options = {"REGISTER", "UNDO"}
    select: BoolProperty(name="Select loose vertices", description="Select the vertices that have no weight on any bone", default=True)

    @classmethod
    def poll(cls, context):
        return _rig_of(_armature_of(context)) is not None

    def execute(self, context):
        arm = _armature_of(context)
        rig = _rig_of(arm)
        if context.object and context.object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        errors, warnings, notes = check(context, arm, rig, self.select)
        write_report(arm, rig, errors, warnings, notes)
        if errors:
            self.report({"ERROR"}, "%d error%s, %d warning%s. %s (All of it: text block \"%s\".)" % (len(errors), "" if len(errors) == 1 else "s", len(warnings), "" if len(warnings) == 1 else "s", errors[0], REPORT))
        elif warnings:
            self.report({"WARNING"}, "%d warning%s. %s (All of it: text block \"%s\".)" % (len(warnings), "" if len(warnings) == 1 else "s", warnings[0], REPORT))
        else:
            self.report({"INFO"}, "Nothing wrong was found.")
        return {"FINISHED"}


class CLIO_OT_export(bpy.types.Operator, ExportHelper):
    """Check, then write the armature and its meshes as a .glb the CLIo Motion baker can put the clips on"""
    bl_idname = "export_scene.clio_glb"
    bl_label = "Export for CLIo Motion"
    filename_ext = ".glb"
    filter_glob: StringProperty(default="*.glb", options={"HIDDEN"})
    force: BoolProperty(name="Export even with errors", default=False)

    @classmethod
    def poll(cls, context):
        return _rig_of(_armature_of(context)) is not None

    def execute(self, context):
        arm = _armature_of(context)
        rig = _rig_of(arm)
        if context.object and context.object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        errors, warnings, notes = check(context, arm, rig)
        write_report(arm, rig, errors, warnings, notes)
        if errors and not self.force:
            self.report({"ERROR"}, "Not exported: %s (All of it: text block \"%s\".)" % (errors[0], REPORT))
            return {"CANCELLED"}
        meshes = _meshes_of(context, arm)
        before, active = list(context.selected_objects), context.view_layer.objects.active
        for o in before:
            o.select_set(False)
        hidden = [o for o in [arm] + meshes if o.hide_get()]
        for o in hidden:
            o.hide_set(False)
        for o in [arm] + meshes:
            o.select_set(True)
        context.view_layer.objects.active = arm
        want = dict(filepath=self.filepath, export_format="GLB", use_selection=True, export_yup=True, export_skins=True, export_animations=False,
                    export_apply=False, export_def_bones=False, export_all_influences=False, export_extras=False, export_cameras=False, export_lights=False)
        known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
        try:
            bpy.ops.export_scene.gltf(**{k: v for k, v in want.items() if k in known})
        except Exception as e:
            self.report({"ERROR"}, "Blender's glTF exporter failed: %s" % e)
            return {"CANCELLED"}
        finally:
            for o in [arm] + meshes:
                o.select_set(False)
            for o in hidden:
                o.hide_set(True)
            for o in before:
                o.select_set(True)
            context.view_layer.objects.active = active
        self.report({"WARNING"} if warnings or errors else {"INFO"}, "Wrote %s (%d mesh%s%s). Next: node tools/gaitbake.js %s --model %s" % (
            os.path.basename(self.filepath), len(meshes), "" if len(meshes) == 1 else "es", ", %d warning%s" % (len(warnings), "" if len(warnings) == 1 else "s") if warnings else "",
            rig.get("id", "<character>"), os.path.basename(self.filepath)))
        return {"FINISHED"}


class CLIO_PT_panel(bpy.types.Panel):
    bl_label = "CLIo Motion"
    bl_idname = "CLIO_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "CLIo"

    def draw(self, context):
        col = self.layout.column(align=True)
        col.operator(CLIO_OT_import_rig.bl_idname, text="Import Rig (.rig.json)", icon="ARMATURE_DATA")
        arm = _armature_of(context)
        rig = _rig_of(arm)
        box = self.layout.box()
        if rig:
            box.label(text="%s: rig %s" % (arm.name, rig.get("name") or rig.get("id")), icon="CHECKMARK")
        elif arm:
            box.label(text="%s is not a CLIo rig yet" % arm.name, icon="INFO")
            box.operator(CLIO_OT_attach_rig.bl_idname, text="Attach Rig File")
        else:
            box.label(text="Select an armature or its mesh", icon="INFO")
        col = self.layout.column(align=True)
        col.operator(CLIO_OT_check.bl_idname, text="Check", icon="VIEWZOOM")
        col.operator(CLIO_OT_export.bl_idname, text="Export .glb", icon="EXPORT")
        text = bpy.data.texts.get(REPORT)
        if text and text.lines:
            box = self.layout.box()
            for ln in [l.body for l in text.lines if l.body][-6:]:
                box.label(text=ln[:70] + ("..." if len(ln) > 70 else ""))


def _menu_import(self, context):
    self.layout.operator(CLIO_OT_import_rig.bl_idname, text="CLIo Motion Rig (.rig.json)")


def _menu_export(self, context):
    self.layout.operator(CLIO_OT_export.bl_idname, text="CLIo Motion Model (.glb)")


CLASSES = (CLIO_OT_import_rig, CLIO_OT_attach_rig, CLIO_OT_check, CLIO_OT_export, CLIO_PT_panel)


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)
    bpy.types.TOPBAR_MT_file_import.append(_menu_import)
    bpy.types.TOPBAR_MT_file_export.append(_menu_export)


def unregister():
    bpy.types.TOPBAR_MT_file_export.remove(_menu_export)
    bpy.types.TOPBAR_MT_file_import.remove(_menu_import)
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)


if __name__ == "__main__":
    register()
