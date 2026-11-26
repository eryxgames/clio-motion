# Templates for artists

Start files for giving a CLIo Motion character a look of your own: a drawing in Inkscape for 2D, a
model in Blender for 3D. Your art goes onto the character's own skeleton, so it gets every clip
(walk, run, attack, climb, die and the rest) without any rigging or animating by hand.

    templates/2d/<character>.svg         a drawing template, one layer for each part
    templates/3d/<name>.rig.json         the skeleton as data
    templates/3d/<name>.glb              the same skeleton with a stand-in model, skinned

`<name>` is the character, and for the soldier also the kit: `soldier` (rifle), `soldier_pistols`,
`soldier_sword`, `soldier_chaingun`, `soldier_chainguns`, `soldier_shotgun`, `soldier_rpg`,
`soldier_flamer`. The `gunner` and the `commando` are the
soldier's skeleton with the chaingun they come with; with any other weapon their joints are those
of the soldier's template for it. People who are not soldiers (`person`, `woman`, `technician`, `scientist`, `hazmat`) are
the soldier's skeleton in other clothes, each with three kits of their own: nothing in the hands,
a case in the right hand, a case on wheels (`person`, `person_case`, `person_trolley`; the
technician starts with the case, so `technician`, `technician_hands`, `technician_trolley`). The
case has a joint, `Case`, where a soldier's rig has `Weapon`. `node tools/templates.js` writes all of them again from the code. Gait Bench
saves the same files for the character on screen ("Save the template", "Save the 3D template").

## 2D: a drawing in Inkscape

1. Open `templates/2d/<character>.svg` in Inkscape. It has a locked layer, **Guide**, with the
   figure seen from its right side, standing still, and above it one empty layer for each part:
   Head, Torso, Thigh and so on.
2. Draw each part in the layer that has its name, over the figure. In the guide a magenta line is
   the part's bone and the circle at one end is its joint, the point the part turns about. A part
   whose picture stays upright (a head) has only the circle.
3. Draw one copy of a part: the same drawing serves the left and the right (the far side is
   drawn darker), and every leg of an animal. A part may be bigger than the figure's: hair, a
   crest, a boot's toe, a cloak. A weapon is drawn lying level under the figure.
4. A layer left empty keeps its plain shape. Hidden layers still count. Leave the Guide layer in
   the file as it is: it tells the reader where the bones are.
5. Save (Inkscape SVG or Plain SVG). In Gait Bench choose the character, then **Body parts as
   images > Load a drawing**. The character moves in your drawing at once.

Three ways to use the drawing in a game:

- **Live.** A game in JavaScript runs the motion core every frame and draws the character from
  its pose in your drawing: `js/drawing.js` cuts the SVG into the parts' pictures once,
  `GaitRig.sprites` lists what to draw each frame. `examples/live2d.html` is the whole of it in
  one page: open it, load your SVG, walk about with the arrow keys.
- **As a cutout.** Gait Bench's **Export** (and `node tools/gaitbake.js`, for the plain shapes)
  writes `<name>_cutout.png`, your parts' pictures packed into one file, and
  `<name>_cutout.json`, where each picture is in every frame of every clip. The game moves the
  pictures, so the motion is smooth at any frame rate, the file is small, and a picture can be
  swapped (another helmet, a wounded arm). `js/cutout.js` is a complete player in sixty lines
  and says what the numbers mean; `examples/cutout.html` shows it; `tools/godot/clio_cutout.gd`
  is the same player for Godot 4 (written from Godot's documentation; it has not been run yet).
- **As a sprite sheet.** The same Export bakes your drawing into `<name>_sheet.png`, frame by
  frame, for engines and tools that want plain frames.

Good to know:

- Each layer becomes one picture, held to its bone at the joint. Along the bone it stretches when
  the bone looks shorter or longer on screen; across the bone it keeps its size. So draw
  overlaps at the joints: let a thigh run a little past the knee and a shin start a little
  before it.
- Text must be turned into paths (Path > Object to Path), and bitmaps must be embedded, not
  linked (Extensions > Images > Embed Images); the bench says so when it meets a linked one.
  Gradients, clips, masks and filters defined in the file come along.
- Do not resize the page or move the Guide layer. If Inkscape has been allowed to scale the
  document, the drawing still loads: the reader measures the guide, not the page.
- Animals with legs out to the side (spider, scorpion, mantis, wasp) and the octopus are drawn as
  the side view shows them, legs foreshortened. Their pictures stretch a good deal as the legs
  swing; simple shapes work best.
- The picture parts are for 2D: live drawing, the cutout and the sprite sheet. The `.glb` files
  use the 3D model.
- The cutout and the sprite sheet show the character from its right side, in place. To face
  left, mirror the whole character. Live, the core turns the body round by itself.

The reader is in the bench because cutting a drawing apart needs something that can measure and
draw SVG, which a browser is. There is no command-line version of it.

## 3D: a model in Blender

Install the add-on once: Edit > Preferences > Add-ons > Install from Disk, choose
`tools/blender/clio_motion_blender.py`, tick "CLIo Motion". Its tools are in the 3D view's
sidebar (N), tab **CLIo**, and under File > Import and File > Export.

1. **Import Rig**: choose `templates/3d/<name>.rig.json`. You get the armature in the template
   pose (standing still, both halves alike, a biped's arms held straight, out and down) and a
   stand-in model of capsules skinned to it, as a guide for size and for where the joints are.
2. Model your mesh round the armature. Keep the bones' names and leave them where they are.
   Hide or delete the stand-in when you no longer need it. Bones of your own are fine below the
   rig's (fingers, a cloak, ears): each follows the rig bone above it.
3. **Bind** the selected meshes: this gives them their weights and ties them to the armature
   (see "Weights" below for which of the three ways to use).
4. **Check**: lists what would go wrong, and why. Errors stop an export: a bone missing or
   renamed, the armature moved or scaled as an object, vertices with no weight (they are
   selected for you). Warnings do not: a bone that starts somewhere else, a bone under another
   parent, more than four bones on a vertex, no mesh bound.
5. **Export .glb**: checks, then writes the armature and its meshes.
6. Put the clips on it, outside Blender:

       node tools/gaitbake.js soldier --model my_soldier.glb --out out
       node tools/gaitbake.js soldier --model my_knight.glb --kit sword
       node tools/gaitbake.js horse --model my_horse.glb --check        # only say what it finds

   or in Gait Bench: **Export > Put the clips on my model** (it saves the file inside a zip).
   The result, `my_soldier_clips.glb`, is your model with every clip, ready for Unity, Godot,
   Unreal or Blender itself.

### Weights, and what else a model needs

A model follows the skeleton through its weights: for each vertex, which bones move it and by how
much. Nothing else is needed for the clips to play. UV maps, textures, normal maps and materials
are yours: they pass through untouched.

**Machines** (robots, mechs, vehicles) need no painted weights. Build them of components and
either name each mesh object after its bone (`Hull`, `Gun_R`, `UpperLeg_L`: such an object is
always bound wholly to that bone), or select the lot and press **Bind > Whole Pieces**: each loose
piece goes wholly to the bone it is nearest.

**Organic bodies** need weights that blend across the joints. Three starts, then paint:

- **Bind > By Nearness**: each vertex takes the bone of the template part it is nearest, shared
  with the bones next to it where parts meet (Blend sets how far the sharing runs; 0 is a hard
  edge). It always gives an answer, on any mesh, and it never ties a thigh to the other thigh.
- **Bind > Automatic**: Blender's own automatic weights. Often smoother on a clean, closed,
  single-surface body; it finds no answer on meshes with holes, loose shells or inner faces.
  The bones for carried things are left out of it, so the rifle on the back does not pull on the
  spine.
- By hand, in Weight Paint, from either of those.

Carried things (weapon, magazine, pack, grenade) are separate pieces: name the object after its
bone. Export keeps the four strongest bones on a vertex; Check warns when there are more.

What the skeleton does not give an organic model, and what can be done about it:

- *Joints that pinch or lose volume* (elbows, knees, shoulders) come from the way every engine
  blends bones. The cure that travels to every engine is in the mesh: enough edge loops at the
  joint, and weights painted so the inside of the bend stays with one bone.
- *Muscle bulges, creases, wrinkle and tension maps* need a number that says how far a joint is
  bent. The library knows it at every moment but does not write it out yet. The plan: you sculpt
  a shape key per joint, named for it; the baker writes how strong it is through every clip (as
  morph target weights, which Unity, Godot, Unreal and Blender all read); a shader can use the
  same number to fade a wrinkle normal map in. See `notes/skinning-organic-models.md`.
- *Forearm twist, fingers, faces*: the rig has no bones for them (a horse has a jaw; nothing has
  eyelids). Bones of your own follow the rig rigidly, which is right for fingers held still and
  wrong for a twisting forearm.
- *Cloth, hair, bellies, straps*: bones of your own are carried, not swung. The chains that
  swing tails and tentacles could drive them; that is planned, not built.

Good to know:

- Any program that writes glTF will do in place of Blender. Start from
  `templates/3d/<name>.glb`; the rule is the same: keep the joints' names and places.
- Bones may point any way and have any roll. Blender turns bones about when it reads and writes
  glTF, and that does no harm: each joint is given the movement its rig joint makes in the world,
  measured from the template pose. What must match is where each joint is, and its name.
- If you move a joint (say the elbow, to suit longer arms), the clips still follow the rig's
  joints exactly, so the mesh round that joint will bend about a point that is not its own.
  Small moves are fine; the check tells you how far off the furthest joint is.
- A weapon, a magazine, a backpack, a grenade and a carried load have joints of their own
  (`Weapon`, `Magazine`, `Pack`, `Grenade`, `Carry`): model them as separate pieces weighted
  wholly to those joints. In the template the weapons are put away (rifle on the back, pistols
  holstered, sword at the hip, shield on the back).
- The soldier's three kits have different joints, so a model is built for one kit, on that kit's
  template.
- The skeleton is the rig's own. It is not a humanoid skeleton in the sense Unity or Unreal
  retargeting expects (the spine is one bone, there are no fingers, the rest pose is not a
  T-pose).

`templates/3d/<name>.rig.json`, for other tools: `joints` (name, parent, `head` and `tail` in
metres, glTF axes: +Y up, +Z forward, the character's right at -X), `parts` (the stand-in model:
capsules from `a` to `b` of radius `r`, each on one joint; `b` null for a ball), `slots` (the 2D
image parts), `clips`, `height`, and `leg` (leg length, the unit the checks use).

## How it was checked

- `node js/test/template_test.js` (part of `node js/test/run.js`): the joints of every rig are
  mirror images left and right; the clips fitted onto a copy of each template with every bone
  turned some other way follow the rig as closely as the baker's own file does; a bone renamed or
  scaled out of shape is refused; a picture cut from a drawing is put back exactly where it was
  drawn and keeps to its joint and its bone's end when the bone changes.
- `node js/test/cutout_test.js` (part of the usual run): in every frame of every clip each plain
  picture covers exactly the part it stands for, each drawn picture is held at its joint and at
  its bone's end, pictures never overlap in the atlas, and the player turns them the short way
  round between frames. The player and the live example were also driven in Chromium with the
  drawn soldier and horse.
- `python tools/blender/test_addon.py` (needs `pip install bpy` and Node; not part of the usual
  tests): in Blender 5.0.1, without a screen, every rig was imported, checked and exported by the
  add-on; meshes were bound all three ways (by nearness on the soldier, horse and scorpion: one
  to four bones on every vertex, adding up to one, only bones next to each other, none on a
  carried thing; whole pieces on the mech; Blender's automatic weights on a leg); the baker put
  the clips on each export; the results pass the Khronos glTF validator
  with no errors or warnings; and with the clips played in Blender itself, every bone of the
  soldier, the horse and the scorpion was within 2 mm of where the rig puts the joint.
- The drawing reader was tried in Chromium with drawings made by a script on the soldier, horse
  and scorpion templates (gradients, a hidden layer, an empty layer, parts larger than the
  figure's). It has not been tried with a drawing saved by Inkscape itself; the add-on has not
  been tried in Blender's window or in Blender 4.x, nor its binding on a real character mesh
  (only on copies of the stand-in and simple shapes); the Godot player has not been run.
