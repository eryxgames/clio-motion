# Organic models: what the skeleton gives, and what could be added

Notes on skinning quality for bodies of flesh (as against machines built of components). What is
built today is in `templates/README.md`, "Weights, and what else a model needs". This file is
about the gaps.

## What travels with a model today

Weights (up to four bones on a vertex), UV maps, materials and textures are in the artist's
`.glb` and are left as they are when the clips are put on. Bones the artist adds below the rig's
follow the rig bone above them rigidly. That is all an engine needs to play the clips.

## The gaps, and a way to close each

**1. A number for how far each joint is bent.** Everything below needs it, and the library has
it at every moment: the angle between a bone and the bone above it, measured from the template
pose, for every joint that bends (elbows, knees, hips, shoulders, neck, jaw, the links of a tail).
Proposed: `bend.<Joint>`, 0 in the template pose, 1 at the joint's furthest bend in any clip.

**2. Corrective shapes.** The artist sculpts a shape key per joint that needs one (the bulge of
a bent arm, the crease behind a knee), named `bend.LowerArm_R`. The baker writes that shape's
strength through every clip as morph target weights. glTF carries these and Unity, Godot, Unreal
and Blender all play them, so nothing is needed on the engine's side for baked clips. Driven live
by the core in an engine, the wrapper sets the same weights from the same number.

**3. Wrinkle and tension maps.** A wrinkle map is a second normal map faded in where the skin
bunches. The fade is the same bend number, read by a shader. For baked clips it can ride on a
shape key that moves nothing (an engine can read a morph weight in a material). A true tension
map, worked out from how much each face of the mesh has stretched, is a shader or a
geometry-nodes job inside the engine or Blender; the library cannot supply it in a file, only the
bend numbers that approximate it.

**4. Helper bones.** A bone at the knee that turns half as far as the shin keeps volume in the
bend; twist bones spread a forearm's roll along its length. Convention: `<Joint>_half` under the
parent of `<Joint>`. The baker and the wrappers would move them. Half bones are well defined from
what the rig has. Twist bones are not: the rig does not know which way a hand faces, so there is
no roll to spread until hands have an orientation of their own.

**5. Things that swing.** A cloak, hair, a belly, straps, ears. The library already swings tails
and tentacles with chains that have weight and follow-through. A chain of the artist's own bones,
named `<Name>_swing1`, `_swing2`, ..., could be handed to the same solver, baked into the clips
and run live.

**6. Other proportions.** Moving a joint in the model does not change the motion: the clips
still follow the rig's joints. A body of other proportions should be a character of its own (the
characters are data: leg lengths, hip height, gaits), with templates written for it. The motion
then suits the body: a longer leg takes a longer stride. `tools/templates.js` writes templates
only for the built-in characters today.

## Order suggested

1 and 2 together (one piece of work, and 3 comes almost free with it); then 4, half bones only;
then 5; 6 when someone needs a character that is not one of the twelve.
