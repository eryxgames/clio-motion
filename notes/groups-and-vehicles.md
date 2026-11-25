# Groups and vehicles: design notes

Notes for work that has not started. Nothing here is in the library yet.

## Where the library stands

Each character is one state, stepped on its own. The library knows nothing of groups: a flock of
wasps today is the game stepping many states and choosing each one's `speed`, `steer` and
`height`. Riding is the one place where two bodies are tied: the mount is stepped first and the
rider reads its pose.

That separation is worth keeping. A group layer should sit above the motion core and produce
exactly the inputs `step` already takes. Then nothing in the core changes, every engine wrapper
gets groups for free, and the layer can be checked across the three languages the same way the
core is (recorded runs, replayed).

## Flocks and swarms that lose members

What already works: give the one that is hit `die`. It is handed to its ragdoll wherever it is
and falls (the recorded run `dragon_shot_down` does this from the air); within six seconds it
lies still, its step costs almost nothing, and the game can keep the last pose and drop the
state. The others are not touched.

What a group layer has to get right:

1. No fixed membership. Each member steers by its nearest few neighbours (keep apart, match
   heading, stay close), looked up fresh every step. A member that is gone is simply one
   neighbour fewer and the gap closes by itself. Members are known by a stable id, never by
   their place in an array, so removing one does not change who anyone else is (this also keeps
   the three languages in step).
2. The reaction. Members within some radius of the loss are startled for a second or two: a
   burst of speed away from that point, more room between them, then they close up again. On
   the body this is the `hit` input (a flinch) and, in the air, a bank away.
3. Formations with places (a V of geese, a column of ants, a wedge of riders). Places are
   handed out again when one empties: each free place goes to the nearest member, with a
   margin so two members do not keep swapping. If the leader is lost, the next in order leads.
4. Splitting and joining. If losses cut the group in two (no member of one part within reach
   of the other), each part is a group of its own until they meet again.
5. Thresholds. Below a share of its first size the group changes what it does: scatters,
   flees, or makes for a rally point. Below a smallest size the survivors behave as
   individuals. These are numbers of the group's description, like a gait's numbers.
6. Wounded, not only dead. A member can be made lame or slow (a lower top speed, a weaker
   climb). The group either keeps to the pace of its slowest or leaves it behind; that too is
   a setting.
7. Cost. Far members can be stepped less often: the core gives the same motion at 30, 60 and
   120 steps a second.

A first version would cover 1, 2 and 5 for fliers and for ground herds, with a run recorded for
each: a swarm that loses a third of its members, a herd that splits round an obstacle.

## What a game's squad AI can be offered

The game decides what the squad wants (attack, hold, go round). The library can offer the layer
between that and the inputs, and answers that only the motion core can give, because it knows
the bodies.

Formations: line, column, wedge, ring round a point, escort round a leader. Places are laid out
in the leader's frame and put on the ground; members behind catch up within what their gait
allows, and the squad keeps to its slowest member; a formation wheels when it turns. Out come
`speed`, `heading`, `dir` (the soldier already travels in any direction while facing another) and
`crouch` for each member. Path finding stays with the engine: it gives way points, and the layer
follows them with the body's own turning circle and stopping distance.

Questions the core can answer cheaply and the same on every platform:

- How long will this body take to get there, and how far does it need to stop? (From the gait
  rules, the acceleration and the turn rate.)
- Can it jump that, reach that ledge, climb that?
- How long will the reload, the swing or the throw take from now; where will the grenade land?
- Can it aim at that point (the aim has limits), and is a squad mate in the line of fire?
- What happens if? A state is a plain block of data: copy it, step the copy a second ahead
  under some inputs, and look. In C a soldier takes about 690,000 steps a second, so trying a
  dozen choices a second ahead costs about a millisecond.

Help with working together: move in bounds (half move while half cover a sector); spread over
cover points; fire sectors that do not cross friends; reloads staggered so the squad never has
all its magazines out at once (the ammunition count is in the state); heads that turn to a
speaker or a threat (`track`). Hand signals would be new actions.

Events for the AI. Today: fire, loaded, strike, punch (where, which way, by how much it
missed), land, hit, die, grip, top, mount, dismount. A group would add: member down, formation
broken, formed up again.

Two bodies acting as one. Riding shows the pattern: one is stepped first and the other reads
its pose. The same pattern would carry a boost over a wall, two carrying a crate or a
stretcher, and a wounded comrade dragged. Each is a mode of its own and real work.

## Vehicles

Partly. What carries over and what does not:

Carries over: springs, ground sampling, frames, chains and the solvers; the shape of the
library (data for the body, a state, a step, a pose, events, recorded runs, the baker); turrets
with aim limits, recoil and a hull that rocks when the guns fire (the mech and the spider mech
have them); crew seats (the saddle: a seat, places for the hands and the feet, a spring that
throws the occupant about); being thrown clear; walking machines, which are vehicles already.

Does not: wheels and tracks are not legs. Foot planning has nothing to say about them. A
vehicle is a new kind of body with its own ground step.

What each would be:

- Hover craft and drones. Nearest to what exists: the flier that can hover. Held at a height
  over the ground by a spring, banking into turns, nose down to speed up, sliding sideways
  because it has little grip. A drone also tilts the way it accelerates and can face one way
  while going another. Smallest step; a swarm of drones is then the group layer.
- Car and buggy. Speed and steering angle give the turn. Each wheel samples the ground and
  sits on a spring; the body pitches and rolls with the wheel heights and with braking,
  pulling away and cornering; wheels spin by distance covered and steer; past the grip limit
  it slides; with all wheels off the ground it flies as a jumping body does and lands on its
  springs. This gives the look of driving. It is not a tyre model: a driving game should use
  the engine's vehicle physics and take from here only what it lacks.
- Tank. Two track speeds steer it and it turns on the spot; many road wheels follow the
  ground and the track is a chain laid round them; the hull pitches over crests; turret, gun
  elevation and recoil are what the mech has now.
- Star ship or fighter. Flight as it is has a heading, a pitch of under a radian and a bank of
  a radian: no loops, no rolls. That is enough seen from the side or from above. Free flight
  in space needs the body's whole orientation carried in the state, which also touches the
  baker; it belongs with the first-person and 3D work.

In data, a vehicle would be a character of kind `vehicle` with a drive (`wheels`, `tracks`,
`hover`, `thrust`), its wheels or lift points, and `seats` (the saddle made plural: driver,
gunner, passengers). Inputs stay `speed` and `steer`, with `brake` and sideways travel where
they apply. The pose gives the hull's frame, each wheel (centre, spin, steer, spring travel),
the tracks, the mounts. `die` gives a wreck.

Limits to keep in mind for all of this: bodies do not collide with each other (the game keeps
them apart); the ground is one height at each point, so bridges and tunnels need the game to
give each body the right ground.

Order suggested: the group layer for fliers and herds; hover craft and drones; car and buggy;
tank; squads; star ships with the 3D work.
