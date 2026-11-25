# CLIo Motion: the JavaScript reference, and the baker

This is the guide to `js/` (the motion core, the rigs and the baker) and to `tools/gaitbake.js`,
which writes sprite sheets, glTF files and CLIo sprite frames. The JavaScript version is the
reference: the C and Python versions are checked against what it computes (see `spec/`).
No dependencies beyond Node.js.

| File | What it is |
|---|---|
| `js/core.js` | The motion core: gait rules, foot planting, inverse kinematics, springs, turning, travel in any direction, sideways aim, props and kits, reload, sword and shield, grenade throw, crate carrying, fighting stance and punches, animal bodies (gallop, bending spine, tail chains, bite, pounce), arthropods, the octopus, swimming, flight, jump, idle, ladder, ledge grab, hit reactions, ragdoll. No rendering. |
| `js/rig.js` | Character looks: the parts of each rig, their colours, draw order, joints and image slots. |
| `js/bake.js` | Records clips and writes sprite sheets, glTF and CLIo sprite frames. Runs in Node and in a browser. |
| `js/fight.js` | Example game code: two characters in a fistfight, driven only through the core's inputs and events. |
| `js/test/` | Tests without a screen; `node js/test/run.js` runs them all. |
| `tools/gaitbake.js` | Command-line baker. |

## Use

    node tools/gaitbake.js all --out out
    node tools/gaitbake.js soldier --out out --clips idle,walk,run,die --frames 12
    node tools/gaitbake.js spider --clio-size 32 --clio-view side
    node tools/gaitbake.js soldier --kit pistols --out out

Options: `--frames N` frames per looping clip (default 8), `--frame WxH` sprite frame size
(default 64x64), `--clio-size N` height in pixels of the CLIo sprite (default 28),
`--clio-view front|side` (default front, which is how CLIo's first-person levels show monsters),
`--kit rifle|pistols|sword` (soldier only; files for a kit other than the rifle are named `soldier_<kit>`).
The clip list must include `idle`: it is the rest pose.

## Output, per character

- `<id>.glb`: glTF 2.0 with a skinned skeleton. One mesh, a joint hierarchy (`Hips`, `Spine`,
  `Head`, `UpperLeg_R`, `LowerLeg_R`, `Foot_R`, `Toe_R`, `UpperArm_R`, `LowerArm_R`, `Hand_R`, ...),
  every vertex bound to exactly one joint. Clips animate joint rotations, plus translation on the
  root and on the few joints that slide (weapon recoil, backpack).
- `<id>_parts.glb`: the same clips with every part as its own rigid node and no skin.
- `<id>_sheet.png` and `<id>_sheet.json`: sprite sheet and atlas in the JSON-hash form
  (`frames`, `animations`, `meta.frameTags`). `meta.clips` gives each clip's length in seconds
  and ground speed in metres per second; `meta.pivot` is the point on the ground under the body.
- `<id>_clio.json`: an entry for CLIo's `sprites.json` (`palette`, `pixels`, `walk`, `attack`, `muzzle`).

Clips: `idle`, `walk`, `back`, `left`, `right` (walking backwards and stepping sideways while
facing forwards), `run` (trot for the quadruped), `sneak`, `jump`, `attack`, `hit`, `turn`,
`die`; and for the soldier `reload`, `throw`, `pickup`, `carry`, `putdown`, `guard`, `jab`, `cross`,
`hook` and `climb`. Looping clips cover exactly one cycle. All clips are in place.

- `reload` starts with empty magazines and reloads every weapon of the kit in turn.
- `hit` is a stagger from a blow from the front: the body slides back, steps and recovers.
- `turn` is a half turn on the spot; it ends facing the other way.
- `die` is a recorded ragdoll fall after a blow from the front; it plays once and ends lying still.
- `throw` is an overarm grenade throw. The grenade leaves the hand about two thirds of the way through.
- `pickup`, `carry` and `putdown` go together: a crate 0.44 x 0.36 x 0.50 m is lifted from the ground
  in a squat, walked with, and set down. The sprite sheet shows the crate. The glTF files do not:
  attach your own box to the joint named `Carry` (the grenade has a joint too, `Grenade`).
- The hyena has `gallop` as well, its `attack` is a bite, and `pounce` is a leap that lands jaws
  first. The pounce is in place like every clip; `meta.clips.pounce.metres` in the atlas gives the
  distance it covers.
- The raptor has `attack` (bite) and `pounce` like the hyena, and no gallop. The scorpion's `attack`
  is a pinch with one claw, and it has `sting`, the tail strike; it has no `jump`.
- The octopus has `walk` (a crawl on the bottom), `attack` (an arm shot out to grab), `swim` (one jet
  cycle, in place, with its speed in the atlas) and `hover` (hanging in the water, arms spread).
- The mantis's `attack` is a strike with both forelegs. The wasp's `attack` is its sting. Fliers
  have `fly` (one wingbeat at cruising speed, in place, with its speed in the atlas), and the wasp
  `hover` as well.
- With sword and shield (`node tools/gaitbake.js soldier --kit sword`, sample `soldier_sword`), `attack`
  is a slash, `chop` and `thrust` are the other two swings, `block` brings the shield up, and
  there is no `reload`.
- `guard` is the fighting stance (a loop). `jab`, `cross` and `hook` start and end in it and are
  recorded at 24 frames a second, since they are over in half a second.

## Engines

- Unity: import the `.glb` with glTFast; slice the sheet by frame size or read the atlas.
- Godot: the `.glb` imports directly; use the sheet with `AnimatedSprite2D`.
- Unreal: import the `.glb` through Interchange as a skeletal mesh with animations.
- CLIo: `python clio.py GAME --import-model <id>.glb`, or paste the entry from `<id>_clio.json`
  into the game's `sprites.json`.

## Checked

- All twenty-six `.glb` files that `tools/gaitbake.js` writes for the built-in characters pass the Khronos glTF validator with no errors or warnings.
- CLIo's own `engine/gltf.py` reads every clip of all twelve characters from them.
- The skinned files were played back through their joint hierarchy and compared with the rig:
  parts land within 0.13% of leg length on average, also when aiming well off to the side. The worst
  cases are the quadruped's body in the death clip (about 7% of leg length) and the soldier's
  shoulder line while carrying (about 3%).
- Throws: the grenade comes down within 2 cm of the target at 2 to 14 m. Crate: hands stay on the
  handles to within 1 cm from grab to release, on the ground and on a table. Punches: the fist
  reaches a target inside arm's length to within 2 mm (jab, cross); the hook is a short-range punch.
- Hyena: walk, trot and gallop from 1 to 11 m/s at 30 and 120 steps a second with no foot sliding;
  tail links keep their length exactly. A bite reaches a target within the neck's reach to the
  millimetre. A pounce from a stand brings the jaws down within 16 cm of targets 2 to 4.5 m away
  (about 30 cm short from a running start).
- Tails: on all three tailed creatures, at 30 and 120 steps a second, the links keep their length
  exactly and the chain settles after a run, a hard turn and a stop. A stop throws the tip 7 to
  19 cm forward; the stride's sway reaches the tip a third to most of a stride after the root.
- Raptor: walks and runs from 1.4 to 12 m/s with no foot sliding; bites and pounces land within
  8 cm. Scorpion: never fewer than four feet down; a pinch inside its reach lands exactly, a sting
  on a target the tail can reach over the back within 2 cm. Knocked down, tails and the scorpion's
  claws go limp, fall with the body and lie on the ground.
- Octopus: crawls from 0.4 to 1.4 m/s with no planted tip sliding and at least four arms down;
  a grab inside its reach lands within 4 cm. Swimming, its average speed is within 0.06 m/s of the
  speed asked for from 0.8 to 3 m/s, it holds its depth to 7 cm, and arm links keep their length.
- Step rate: tails and arms are worked in steps of 1/120 s whatever the game's step, so a game at
  30 steps a second gets the same motion (checked on every tail and on the swimming arms).
- Mantis: at least two feet down at a walk, no foot sliding; a strike inside its reach puts the
  hooks 6 cm either side of the target. Fliers: the speed and height asked for are held (height to
  about 12 cm over rolling ground); wing, leg and tail bones keep their length; results at 30 and
  120 steps a second match. The dragon holds 5 m/s when asked to stop, and glides 95% of a dive.
  Shot down at 4 m it falls and lies on the ground.
- Sword and shield: each swing lands 0.23 to 0.28 s after it is asked for; the point reaches
  1.3 to 1.5 m in front; hands stay within 1.5 cm of the grips through every swing; a slash
  sweeps 1.6 m across and a chop 0.2 m. Swinging at a walk works.
- Any direction: on five characters, at six directions, the body goes exactly the way asked, no
  planted foot slides, and the hips stay within 7% of standing height. Going from 3 m/s forwards
  to backwards takes 0.56 s to stop. On hills that vary both ways, feet of the soldier, the
  hyena and the raptor follow the ground to within a millimetre while wandering, turning and
  sidestepping.
- Ledge: on walls of 2.0 to 2.6 m, on flat and rolling ground, at any heading and at 30, 60 and
  240 steps a second, the hands stay on the lip to the millimetre while hanging, no knee goes
  into the wall, the pull-up takes 1.5 s with the hips never faster than 2 m/s, and the body
  stands on top and walks on.
- Horse: walk, trot and gallop from 1 to 15 m/s at 30 and 120 steps a second with no foot sliding;
  the same bite and jump as the other animals.
- Riding: on the horse, the spider mech and the dragon, at 30, 60 and 120 steps a second, on
  rolling ground, through a gallop, turns and a stop, and on the dragon in a banked turn in the
  air: the feet stay exactly in the stirrups, the hips rise at most 7 cm from the seat, the hands
  stay on the reins (within 2 cm in a banked turn), and the rifle fires from the saddle. A rider
  thrown at 9 m/s falls and lies on the ground.
- Fights: one-minute and 90-second fights at 30, 60 and 120 steps a second, on flat, rough and
  stepped ground. No planted foot slides or sinks into the ground, the two never stand inside each
  other, and each fight has knockdowns and recoveries.
- Not yet opened in Unity, Godot or Unreal.

## Using the core live

`core.js` can also run inside a game loop. Each step takes an input and returns a pose in world
coordinates:

    const M = require('./js/core.js');
    const ch = M.CHARACTERS.soldier, env = { terrain: x => 0 };
    const S = M.createState(ch, env);
    const style = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 };
    const pose = M.step(S, ch, { speed: 1.4, crouch: 0, armed: true, steer: 0.5 }, style, env, 1 / 120);

Inputs: `speed` (m/s), `crouch` (0..1), `steer` (-1..1) or `heading` (radians, 0 = +x),
`aim` (world point `[x, y, z]`), `fire`, `armed` (false stows the weapons), `kit`, `reload`,
`jump`, `hit: {impulse: [x, y, z]}`, `die: {impulse}`.

Sword and shield (`kit: 'sword'`): the sword is held low at the right side with its point up, the
shield upright on the left forearm; put away, the sword hangs at the left hip and the shield is
slung on the back.

- `swing: {kind: 'slash' | 'chop' | 'thrust'}`: one swing. A slash is carried by the turn of the
  shoulders, a chop by the arm coming over, a thrust by the reach. The `strike` event gives the
  blade as it lands (`hilt`, `point`, and the way the point is travelling); while `S.act.live` is
  true the blade is in the cutting part of the swing, and `pose.props[0]` gives it every step.
- `block: true`: the shield comes up and across in front of the face and chest (`S.block.x`).

Travel in any direction: `dir` is the way to go, measured from the way the body faces (radians;
0 forwards, pi backwards, +pi/2 to its right), and `speed` is how fast. With `heading` (or `steer`)
for the facing, that is strafing, backing off and circling. The velocity is steered as a vector,
so going from forwards to backwards slows, stops and sets off again. Backwards is held to half
the speed asked for and sideways to 38%. Stepping sideways, a foot closes up to the other but
does not cross it. Every character has it.

Ground: the game's `env.terrain(x, z)` is given both world coordinates, so the ground may vary
both ways; a function of `x` alone still works.

Ledge grab (soldier): `M.grabLedge(S, ch, env, [x, y, z])` hangs the body by its hands from an
edge at that point, facing the way it faces now (the game decides when: usually when a jump or a
walk brings the chest to a wall whose top is within reach). It returns false for a body that
cannot hang. Hanging, `climb: true` (or `jump`) pulls it up over the edge in about a second and a
half: chest to the lip, weight over the hands, one foot up, then the other, and it stands on top
in ground mode (`top` event). `drop: true` lets go. The edge is taken to run across the way the
body faces. Clips: `hang` and `climbup`; the atlas gives `metres` and `metresUp` for the climb.

Riding: a soldier can sit on any character that has a `saddle` (the horse, the spider mech, the
dragon). The game steps the mount first, then the rider with the mount handed to it:

    M.mountUp(rider, soldier, env, { S: mount, ch: horse });          // false if it cannot be ridden
    M.step(mount, horse, { speed: 9, steer: 0.3 }, style, env, dt);   // the game drives the mount
    M.step(rider, soldier, { aim, armed, fire }, style, { terrain: env.terrain, mount: { S: mount, ch: horse } }, dt);
    M.dismount(rider, soldier, env);                                  // stands beside it, on its left

The rider's hips are held to the seat by a spring, so a trot or a gallop lifts him out of the
saddle and the knees take it up; the feet stay in the stirrups; the back leans with the pace and
stays upright when the mount pitches; in the air the rider rolls with the dragon. The hands hold
the reins (`pose.reins`) or the handles until a weapon is drawn: aiming, firing, reloading, the
sword and throwing all work from the saddle. `die` on the rider throws him from wherever he is.
A saddle is data on the mount: `saddle: { at: [along, up], stirrup: [along, up, side],
hands: [along, up, side], reins: 'bit' | 'neck' | null }`.

Hands and fists (soldier):

| Input | What it does | Events |
|---|---|---|
| `throw: {target: [x, y, z]}` | Overarm throw. The rifle is left to the other hand; a pistol is holstered for the moment. | `throw {pos, vel}`: where the grenade leaves the hand and the velocity that lobs it to the target |
| `pickup: {at: [x, y, z], heading}` | Squat to a crate (centre at `at`; left out, it is taken to be on the ground in front), take the handles, stand up. Needs the body standing still. How deep the squat is follows the height of the handles. | `grab` |
| `putdown: true` | Set the crate down in front. Needs the body standing still. | `putdown {pos, heading}` |
| `guard: true` | Fists up, feet staggered. Weapons are put away first. | |
| `block: true` | Cover up (with `guard`). | |
| `punch: {kind: 'jab' \| 'cross' \| 'hook', target: [x, y, z]}` | One punch. A new one can start before the last has quite finished. | `punch {kind, hand, pos, dir, miss}` at full reach: where the fist is, which way it was going, and how far it is from the target |
| `track: [x, y, z]` | While a punch is on its way out, steer it to this point. | |
| `move: [vx, vz]` | Drift: slow movement in any direction (up to about 1 m/s) without turning to face it. Used while `speed` is 0; the feet shuffle to keep up. | |

While a crate is carried, `pose.carry` gives its centre and axes, speed is held to a walk, and weapons
stay stowed. A knock-down or a ladder drops it (`drop {pos}`). `pose.grenade` is the grenade's place.
The core does not move the grenade after release, or decide what a punch hit: that is the game's job.
`M.place(S, ch, env, x, z, heading)` stands a character somewhere in the world.
The body's place is `S.px`, `S.pz`, its heading `S.h`. Planted feet are kept in world
coordinates, so they stay put while the body moves and turns.

Props and kits are data in `core.js` (`PROPS`, `KITS`): each prop has grip points, a magazine, a
place when held and a place when stowed. `pose.props` lists them with their points. Rounds left
are in `S.ammo`; firing an empty weapon starts a reload. `S.events` reports `fire`, `reload`,
`loaded`, `land`, `jump`, `hit` and `die`; clear it after reading.

## Animals

The hyena is the first living quadruped. What it adds is data and a few rules, usable for other animals:

- `gait.gallop`: a third gait above the trot (footfall phases, duty, and the Froude number where
  it starts). In it the spine bends (`beast.flex`), the body rocks from hind to fore (`beast.rock`)
  and rises once a stride, highest while all four feet are off the ground.
- `beast`: body half-length, neck and skull lengths, how high the head is carried at rest. The head
  follows `aim`; the neck drops and reaches forward at speed.
- `tail`: where it joins, how many links and how long, its rest shape (`rest`, `curl`), how stiff
  (`omega`, `zeta`), how much softer at the tip (`soft`), how far each link may bend from the last
  (`bend`), how much it sags, lifts at speed, wags at rest and sways with the stride. Each link has
  its own direction and turning speed. A spring turns it to carry on from the link before, so a
  movement at the root runs down the chain and reaches the tip late; and each link swings like a
  pendulum when the body speeds up, stops, bounces or turns. `pose.tailPts` lists the points.
  The hyena's short tail, the raptor's long stiff one and the scorpion's curled one are the same
  code with different numbers; `ctl.pull` drags the chain through given points for a strike.

The raptor is a two-legged animal built the same way (`beast.mid`: the legs hang from the middle
of the body, which lies level, balanced by neck and head in front and the tail behind). It walks on
its toes: the foot's "ankle" is high off the ground, which gives the leg its third segment.

The scorpion (`arthro`) has eight legs stepping in two alternating sets of four, two clawed arms
that drift towards `aim`, and the tail curled over its back.

- `pinch: {target}`: the nearer claw shoots out and shuts; `pinch` event with the claw tip's place.
- `sting: {target}`: the tail rears back, then whips over the head onto the target, as far as it
  reaches (about 1.3 m from its root); `sting` event with the tip's place.
- `bite: {target: [x, y, z]}`: the neck shoots out and the jaws snap; the `bite` event gives where
  the muzzle is and how far from the target.
- `pounce: {target: [x, y, z]}`: a flat leap along the heading, sized so that the jaws come down on
  the target; `pounce` event on landing. It works from a stand or a run.

## The octopus, and swimming

The octopus has no bones. On the bottom each arm is a leg to the gait rules (a tip that is planted,
lifted and planted again, never more than two arms off the ground at a walk) and is posed as six
links of fixed length arching from the body to the planted tip. `pose.arms` lists the eight arms,
seven points each; `pose.mantle` gives the mantle.

- `grab: {target}`: the nearest arm leaves the ground and reaches for the target (0.84 m); `grab` event.
- `ink: true`: an `ink` event with a place and direction; in the water also a burst of speed.

`M.enterSwim(S, ch, env)` puts it in the water and `M.leaveSwim` back on its arms. Swimming is a
mode of its own, like the ladder:

- Inputs: `speed`, `steer` or `heading`, `depth` (metres above the bottom), `ink`.
- It travels mantle first by jets: a squeeze over the first third of each cycle drives it forward
  and drag slows it for the rest, with the thrust sized so that the average speed is the one asked
  for. So the speed surges and sags within each cycle, as a real one's does.
- The arms are eight of the same chains as a tail. Each stroke draws them together and the glide
  lets them spread; hovering, they hang below like a skirt.

This is the first mode without feet on the ground. Flying creatures will use the same pieces: a
cycle that makes thrust, drag, a height to hold, banking, and chains that trail.

## Flying

`M.enterFly(S, ch, env)` takes a character with a `fly` block into the air and `M.leaveFly` puts
it back on its feet. Like swimming, flight is a mode of its own.

- Inputs: `speed`, `steer` or `heading`, `height` (metres above the ground), `aim`, and the
  creature's own attacks (`sting`, `bite`).
- The wingbeat's rate and size follow how hard the wings must work: more to climb or to fly
  slowly, less at speed or coming down. The body heaves with every stroke, the nose follows the
  path, and the body banks into turns. Legs hang or tuck and trail a little. Tails and necks are
  the same chains as on the ground.
- A small flier (`hover: true`, the wasp) can hang in the air. A big one (the dragon) cannot: it
  keeps at least `vmin`, rears up when flying that slowly, and glides with its wings held out
  when fast or descending.
- `pose.wings` gives each wing as two bones (root, mid, tip) and the way its membrane hangs. On
  the ground the wings are folded along the body; the dragon's fold like a Z, so no bone changes
  length.
- `die` in the air starts the ragdoll where the body is, and it falls.

The mantis is built like the scorpion without a tail (`arthro` with `both: true`): four walking
legs, the front of the body upright, and two folded forelegs that strike together at `pinch`.
The wasp is an `arthro` without claws whose tail is its abdomen: it hangs behind and curls round
from below to sting.

## Two characters: the fistfight

`fight.js` is game code on top of the core. Each fighter faces the other (`heading`), keeps its
distance and circles (`move`), steps in for a short combination (`punch`, `track`), and covers up
or steps back when it sees a punch coming (`block`, `move`). A punch lands if, at full reach, the
fist is at the other one's head or body and the guard is not up; the one hit gets `hit`, or `die`
when its health runs out, and gets up again after a few seconds.

    const M = require('./core.js'), Fight = require('./fight.js');
    const ch = M.CHARACTERS.soldier, env = { terrain: x => 0 };
    const F = Fight.create({ M, chars: [ch, ch], env, style, seed: 1 });
    Fight.step(F, 1 / 120);                 // every tick
    F.fighters[0].S.pose;                   // each fighter's pose, as from M.step
    F.log;                                  // hit, block, miss and down, with fist positions

    node js/test/fight_test.js 60 120 v             # four one-minute fights, with the blow-by-blow of the first

## Limits

- Sideways aim has limits: the soldier's torso turns up to 57 degrees, the mech's hull 74, the
  quadruped's head 52; the spider's turret goes all the way round. A target behind the body is let go.
- The pistol reload is one-handed at the belt, which is stylised. Both pistols aim at one point.
- Draw order is authored for a side view. With the torso turned far towards or away from the
  camera, arms, the pack and weapons can layer wrongly. Eyes and visors are the exception: on the
  side of a head that is turned away they go behind it.

- Riding: there is no climbing on or getting down (both are switches); the rider does not grip
  with his knees or lose his seat by himself; nothing but the seat joins him to the mount, so a
  mount that rears or rolls takes him with it however steep. Riding is not baked into clips and is
  not in the C and Python versions yet. Only the soldier rides.
- The horse's legs have two bones each, like the hyena's. Its pounce is a jump with the head down.
- Flight has no take-off run and no landing flare: entering and leaving the air are switches, and
  the bench cross-fades over them. Wings do not collide with the ground or the body.
- The wasp's knocked-down body props itself on its legs and can twitch for some seconds before
  it lies still.
- The dragon's neck is one bone.
- The scorpion's sting arches over its own back, so a target low and close in front is out of reach.
- In the glTF files the octopus's mantle does not pulse (parts are rigid; the squeeze is in the
  sprite frames only). Knocking the octopus down while it swims is not handled: it is put on the
  bottom first. There is no settling animation between swimming and crawling.
- A tail does not push back on the body: the raptor's balance is drawn, not computed.
- The hyena's legs have two bones each (no separate paw), so the hind leg has a hock but no knee.
- A pounce goes along the heading: turn to face the target first. Nothing is grabbed or held on
  landing; what the pounce hit is the game's decision.
- Sword swings are three authored paths; there is no parry with the blade, no combination that
  flows from one swing into the next, and nothing stops the blade at what it hits. A thrust still
  drifts 0.6 m sideways on its way out.
- Throwing: the arm's path is authored and the grenade's velocity is solved for the target; it is
  not taken from how fast the hand is moving.
- The crate has one size and side handles. Other loads (a sack on the shoulder, a two-man lift)
  would be new actions.
- Fighting: jab, cross and hook only; no kicks, no grappling. Bodies do not collide: a fist can pass
  through the other one's arm, and what was hit is decided by the game from the fist's position.
  Only the soldier has a fighting stance.
- Backwards and sideways are walks: there is no backwards run, and the feet still roll heel to
  toe when going backwards. The body pitches with a slope along its path but does not tilt on a
  slope across it. On hills, the spider mech's planted feet can sit up to 6 cm into the slope.
  Circling a point by sidestepping drifts inwards unless the game corrects the distance.
- The ragdoll moves in the forward-up plane; each joint keeps its sideways offset. That suits
  side-view games and baked clips. For a live 3D ragdoll, give the skinned skeleton to the
  engine's own physics.
- The skeleton is not set up for humanoid retargeting (no T-pose, simplified spine).
- Ledge: the soldier only; the edge must be straight across the way the body faces; there is no
  shuffle along a ledge, no jump up to catch one (the game places the grab), and no climb down
  onto a hang. The weapons are put away for it.
- Turning round out of a run makes the body dip for a moment.
- The C and Python versions cover everything on the ground for every character; swimming, flight,
  the ladder, the ledge and the ragdoll are not ported yet (see the top-level README). There are no Unity, Godot or Unreal wrappers yet.
