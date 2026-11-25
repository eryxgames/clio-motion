# Changelog

## 0.18.0

- C99 and Python, stage 4a: off the ground. Swimming (the octopus: jets, depth, arms as chains),
  flight (the wasp and the dragon: wingbeat, glide, bank, hanging legs, attacks in the air), the
  ladder (hands and feet on real rungs) and the ledge grab (hang, pull up, drop). `cm_step` and
  `step` follow a character through whichever of these it is in. Both reproduce 61 replays.
- `spec/body/`: replays now carry the calls that change mode, a ladder as data, and the mode in
  every sample; seven more recorded runs (62 in all).

## 0.17.0

- A horse: walk, trot and gallop, a tail of hair, a saddle. It runs in the C and Python versions
  as it is (the characters are data).
- Riding (JavaScript reference): `mountUp`, `dismount`, a `ride` mode. A soldier on the horse, the
  spider mech or the dragon, on the ground and in the air; reins; weapons from the saddle.
  In Gait Bench: a Horse tab, and "Put a rider on" for the horse, the spider mech and the dragon.
- Drawing: eyes and visors go behind a head that is turned away (three-quarter view), on every
  character.
- `spec/`: two runs for the horse (55 in all).

## 0.16.0

- C99 and Python, stage 3b: every character whole on the ground. Animals (hyena, raptor, dragon):
  bending spine, neck, head and jaw, the tail as a chain with follow-through, bite and pounce.
  Arthropods (scorpion, mantis, wasp): claws, the pinch, the sting that arches over the back.
  The octopus: mantle, eight arms as curves, grab and ink. The quadruped robot and the spider
  mech with their guns. Folded wings on the ground. Both reproduce 48 whole-body replays.
- `spec/`: ten more recorded runs (53 in all); runs that stay on the ground are kept once, in
  `spec/body/`.

## 0.15.0

- C99 and Python, stage 3a: upright bodies whole (`cm_step`, `step`). The soldier's spine, head,
  arms and sideways aim; rifle, two pistols, sword and shield, held and stowed; firing, recoil and
  reloading; swings and the block; throwing; lifting and carrying a crate; the fighting stance and
  punches. The mech's hull and guns. Both reproduce 20 whole-body replays of the reference: every
  number of the pose, the count of each event, and what the events carry.
- `spec/body/`: whole-body replays; seven more recorded runs (43 in all), one of them for the
  weapon corner cases (firing dry, a reload refused and cancelled, a throw with pistols).
- Gait Bench: a copyright line; saving works as an ordinary download on a plain web page.

## 0.14.0

- C99 and Python, stage 2: the ground step (`cm_step_ground`, `step_ground`). Speed and turning,
  travel in any direction, the gait, foot planning with feet planted in the world, jumps and
  pounces, body height and pitch over uneven ground, leg inverse kinematics. Both reproduce the
  24 ground replays of the reference.
- `spec/ground/`: self-contained replays for stage 2; ten more recorded runs (36 in all).
- The built-in characters as a generated C table (`c/clio_motion_characters.c`).
- Reference: a corrective step now has its target from its first frame (`pose.legs[i].target`
  held an undefined x for one step).

## 0.13.0

- Ledge grab: `grabLedge`, hang, pull up, stand on top; `hang` and `climbup` clips; "Wall ahead"
  in Gait Bench.
- The project laid out as CLIo Motion: `js/` reference, `tools/`, `spec/`, `c/`, `python/`,
  `bench/`, `docs/`.
- `spec/`: characters as JSON, 921 test vectors for the numeric kernel, 26 recorded runs.
- C99 and Python, stage 1: the numeric kernel, agreeing with the reference on every vector.

## 0.12 and earlier

Built as the Gait Bench prototype: gaits, foot planting, aim and weapons, ladder, ragdoll, hands
and fists, the fistfight, the hyena, raptor, scorpion, octopus, mantis, wasp and dragon, tails,
swimming, flight, sword and shield, travel in any direction, ground that varies both ways.
