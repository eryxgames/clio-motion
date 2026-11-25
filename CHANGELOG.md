# Changelog

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
