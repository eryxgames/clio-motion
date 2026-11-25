# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""CLIo Motion tools for Blender: build a character's skeleton, check a model skinned to it, export it.

Install: Edit > Preferences > Add-ons > Install from Disk, choose this file, tick "CLIo Motion".
The tools are in the 3D view's sidebar (N), tab "CLIo", and under File > Import / Export.

1. Import rig        reads templates/3d/<name>.rig.json and makes the armature in the template pose, with a
                     stand-in model of capsules skinned to it (a guide for size and joints; hide or delete it).
2. Model your mesh   round the armature. Keep the bones' names. You may add bones of your own below the rig's.
3. Bind              gives the selected meshes their weights and ties them to the armature, three ways:
                     By Nearness: each vertex to the template part it is nearest, blended across joints. Always works.
                     Whole Pieces: each loose piece of a mesh wholly to one bone. For machines built of components.
                     Automatic: Blender's own automatic weights, with the bones for carried things left out.
                     A mesh object named after a bone (Weapon, Head, Gun_R) is always bound wholly to that bone.
                     These are a start: paint the weights afterwards where a joint needs it.
4. Check             says what would go wrong: a bone missing or moved, the armature moved or scaled, vertices
                     with no weight, more than four bones on a vertex.
5. Export            checks, then writes a .glb with the armature and its meshes.

Then, outside Blender, the clips are put onto the model:   node tools/gaitbake.js <character> --model my.glb
(or in Gait Bench: Export > "Put the clips on my model").

glTF axes are used in the rig file (+Y up, +Z forward); Blender's are +Z up, -Y forward. A point (x, y, z) of the
file is (x, -z, y) here, which is also what Blender's own glTF importer and exporter do.
"""
import json
import math
import os

import bpy
from bpy.props import BoolProperty, EnumProperty, FloatProperty, StringProperty
from bpy_extras.io_utils import ExportHelper, ImportHelper

bl_info = {
    "name": "CLIo Motion",
    "author": "Daniel Sandner",
    "version": (0, 24, 0),
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


# ------------------------------------------------------------------------------------------------- binding
def _to_capsule(p, a, b, r):
    """How far a point is from the surface of a capsule (0 inside it), and how far from its core as a share of its radius."""
    if b is None:
        d = math.sqrt((p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2 + (p[2] - a[2]) ** 2)
    else:
        ex, ey, ez = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        l2 = ex * ex + ey * ey + ez * ez
        t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey + (p[2] - a[2]) * ez) / l2 if l2 > 1e-12 else 0.0
        t = 0.0 if t < 0 else 1.0 if t > 1 else t
        d = math.sqrt((p[0] - a[0] - ex * t) ** 2 + (p[1] - a[1] - ey * t) ** 2 + (p[2] - a[2] - ez * t) ** 2)
    return (d - r, d / r) if d > r else (0.0, d / r)       # (outside by this much, how deep inside: 0 at the core, 1 at the skin)


def _rig_parts(rig, carried):
    """The template's parts by joint, in Blender's axes, and for each joint the joints next to it."""
    skip = set() if carried else {j["name"] for j in rig["joints"] if j.get("carried")}
    by = {}
    for part in rig.get("parts", ()):
        if part["joint"] not in skip:
            by.setdefault(part["joint"], []).append((to_blender(part["a"]), to_blender(part["b"]) if part.get("b") else None, part["r"]))
    near = {j["name"]: {j["name"]} for j in rig["joints"]}
    for j in rig["joints"]:
        if j["parent"] is not None:
            near[j["name"]].add(j["parent"])
            near[j["parent"]].add(j["name"])
    # a joint with no part of its own (the hips of some animals) passes its neighbours on
    return by, near


def _points_in_armature(obj, arm):
    m = arm.matrix_world.inverted() @ obj.matrix_world
    return [tuple(m @ v.co) for v in obj.data.vertices]


def _pieces(me):
    """The loose pieces of a mesh: lists of vertex indices joined by edges."""
    up = list(range(len(me.vertices)))

    def find(i):
        while up[i] != i:
            up[i] = up[up[i]]
            i = up[i]
        return i

    for e in me.edges:
        a, b = find(e.vertices[0]), find(e.vertices[1])
        if a != b:
            up[a] = b
    out = {}
    for i in range(len(up)):
        out.setdefault(find(i), []).append(i)
    return list(out.values())


def _write_weights(obj, arm, weights):
    """weights: for each vertex a dict bone -> weight.  Replaces the mesh's weights on the armature's bones."""
    bones = arm.data.bones
    for g in [g for g in obj.vertex_groups if g.name in bones]:
        obj.vertex_groups.remove(g)
    groups, lists = {}, {}
    for i, w in enumerate(weights):
        for name, val in w.items():
            lists.setdefault((name, round(val, 4)), []).append(i)
    for (name, val), idx in lists.items():
        g = groups.get(name) or groups.setdefault(name, obj.vertex_groups.new(name=name))
        g.add(idx, val, "REPLACE")


def _tie(obj, arm):
    """Parent a mesh to the armature where it is, with an Armature modifier."""
    if obj.parent != arm:
        world = obj.matrix_world.copy()
        obj.parent = arm
        obj.matrix_world = world
    if not any(m.type == "ARMATURE" and m.object == arm for m in obj.modifiers):
        obj.modifiers.new("Armature", "ARMATURE").object = arm


def bind_named(obj, arm):
    """A mesh object named after a bone is bound wholly to it.  True if it was."""
    base = obj.name.split(".")[0]
    if base not in arm.data.bones:
        return False
    _write_weights(obj, arm, [{base: 1.0}] * len(obj.data.vertices))
    _tie(obj, arm)
    return True


def bind_nearest(obj, arm, rig, blend=0.3, whole_pieces=False, carried=False):
    """Weights from how near each vertex is to the template's parts.  blend (0..1): how far weights run across a
    joint, 0 for a hard edge.  whole_pieces: each loose piece of the mesh wholly to the joint it is nearest.
    Returns the number of joints used."""
    by, near = _rig_parts(rig, carried)
    names = list(by)
    pts = _points_in_armature(obj, arm)
    leg = rig.get("leg") or rig.get("height", 1.0) * 0.5
    sigma = blend * 0.15 * leg
    both = [[min(_to_capsule(p, a, b, r) for a, b, r in by[n]) for n in names] for p in pts]
    dist = [[x[0] for x in row] for row in both]
    weights = [None] * len(pts)
    if whole_pieces:
        for piece in _pieces(obj.data):
            mean = [sum(dist[i][k] for i in piece) / len(piece) for k in range(len(names))]
            w = {names[min(range(len(names)), key=lambda k: mean[k])]: 1.0}
            for i in piece:
                weights[i] = w
    else:
        for i, d in enumerate(dist):
            k0 = min(range(len(names)), key=lambda k: both[i][k])          # inside several parts: the one it is deepest in
            if sigma <= 0:
                weights[i] = {names[k0]: 1.0}
                continue
            # only the joints next to the nearest one may share a vertex: a thigh does not pull on the other thigh
            allowed = near[names[k0]]
            w = {names[k]: math.exp(-((d[k] - d[k0]) / sigma) ** 2) for k in range(len(names)) if names[k] in allowed}
            top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
            top = [(n, v) for n, v in top if v > 0.02]
            total = sum(v for n, v in top)
            weights[i] = {n: v / total for n, v in top}
    _write_weights(obj, arm, weights)
    _tie(obj, arm)
    return len({n for w in weights for n in w})


def tidy_weights(obj, arm):
    """At most four bones on a vertex, and their weights add up to one."""
    bones = arm.data.bones
    name = {g.index: g.name for g in obj.vertex_groups if g.name in bones}
    for v in obj.data.vertices:
        ws = sorted(((g.weight, g.group) for g in v.groups if g.group in name and g.weight > 0), reverse=True)
        for wt, gi in ws[4:]:
            obj.vertex_groups[gi].remove([v.index])
        total = sum(wt for wt, gi in ws[:4])
        if total > 0:
            for wt, gi in ws[:4]:
                obj.vertex_groups[gi].add([v.index], wt / total, "REPLACE")


def bind_automatic(context, objs, arm, rig):
    """Blender's automatic weights, with the bones for carried things (weapon, pack, load) left out."""
    carried = [arm.data.bones[j["name"]] for j in rig["joints"] if j.get("carried") and j["name"] in arm.data.bones]
    was = [(b, b.use_deform) for b in carried]
    before, active = list(context.selected_objects), context.view_layer.objects.active
    for b in carried:
        b.use_deform = False
    for o in before:
        o.select_set(False)
    try:
        for o in objs:
            for g in [g for g in o.vertex_groups if g.name in arm.data.bones]:
                o.vertex_groups.remove(g)
            for m in [m for m in o.modifiers if m.type == "ARMATURE"]:
                o.modifiers.remove(m)
            o.select_set(True)
        arm.select_set(True)
        context.view_layer.objects.active = arm
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    finally:
        for b, d in was:
            b.use_deform = d
        for o in objs:
            o.select_set(False)
        arm.select_set(False)
        for o in before:
            o.select_set(True)
        context.view_layer.objects.active = active
    left = []
    for o in objs:
        tidy_weights(o, arm)
        _tie(o, arm)
        deform = {g.index for g in o.vertex_groups if g.name in arm.data.bones}
        if any(not any(g.group in deform and g.weight > 1e-6 for g in v.groups) for v in o.data.vertices):
            left.append(o.name)
    return left


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


class CLIO_OT_bind(bpy.types.Operator):
    """Give the selected meshes their weights and tie them to the armature"""
    bl_idname = "object.clio_bind"
    bl_label = "Bind to CLIo Motion Rig"
    bl_options = {"REGISTER", "UNDO"}
    how: EnumProperty(name="How", default="NEAR", items=(
        ("NEAR", "By Nearness", "Each vertex to the template part it is nearest, blended across joints"),
        ("PIECES", "Whole Pieces", "Each loose piece of a mesh wholly to the bone it is nearest: for machines built of components"),
        ("AUTO", "Automatic", "Blender's automatic weights, with the bones for carried things left out")))
    blend: FloatProperty(name="Blend", description="By Nearness: how far weights run across a joint. 0 is a hard edge", default=0.3, min=0.0, max=1.0)
    carried: BoolProperty(name="Carried things too", description="By Nearness and Whole Pieces: also bind to the bones of the weapon, magazine, pack, grenade and load", default=False)

    @classmethod
    def poll(cls, context):
        return _rig_of(_armature_of(context)) is not None and any(o.type == "MESH" for o in context.selected_objects)

    def execute(self, context):
        arm = _armature_of(context)
        rig = _rig_of(arm)
        if context.object and context.object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        meshes = [o for o in context.selected_objects if o.type == "MESH"]
        named = [o for o in meshes if bind_named(o, arm)]
        rest = [o for o in meshes if o not in named]
        said = []
        if named:
            said.append("%d by name (%s)" % (len(named), ", ".join(o.name for o in named[:4]) + (", ..." if len(named) > 4 else "")))
        if rest and self.how == "AUTO":
            try:
                left = bind_automatic(context, rest, arm, rig)
            except Exception as e:
                self.report({"ERROR"}, "Blender's automatic weights failed (%s). Try By Nearness." % e)
                return {"CANCELLED"}
            if left:
                self.report({"WARNING"}, "Automatic weights found no answer for part of %s (Blender needs a clean, closed surface for it). Try By Nearness." % ", ".join(left))
            said.append("%d automatically" % len(rest))
        elif rest:
            for o in rest:
                n = bind_nearest(o, arm, rig, self.blend, self.how == "PIECES", self.carried)
                said.append("%s to %d bone%s" % (o.name, n, "" if n == 1 else "s"))
        self.report({"INFO"}, "Bound: " + "; ".join(said) + ".")
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
        col.label(text="Bind the selected meshes:")
        col.operator(CLIO_OT_bind.bl_idname, text="By Nearness", icon="MOD_VERTEX_WEIGHT").how = "NEAR"
        col.operator(CLIO_OT_bind.bl_idname, text="Whole Pieces", icon="MOD_BUILD").how = "PIECES"
        col.operator(CLIO_OT_bind.bl_idname, text="Automatic", icon="BONE_DATA").how = "AUTO"
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


CLASSES = (CLIO_OT_import_rig, CLIO_OT_attach_rig, CLIO_OT_bind, CLIO_OT_check, CLIO_OT_export, CLIO_PT_panel)


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
