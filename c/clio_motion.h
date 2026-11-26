/* Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE).
   SPDX-License-Identifier: Apache-2.0

   CLIo Motion, C99. Stage 1: the numeric kernel that everything else is built on, a port of js/core.js
   checked against spec/kernel_vectors.txt, which the JavaScript version writes. Stage 2, further down:
   the ground step.
   Units: metres, seconds, radians. Vectors are double[3]: x forward, y up, z to the right. */
#ifndef CLIO_MOTION_H
#define CLIO_MOTION_H
#ifdef __cplusplus
extern "C" {
#endif

#define CM_G 9.81
#define CM_MAX_LEGS 8

double cm_clamp(double x, double a, double b);
double cm_lerp(double a, double b, double t);
double cm_frac(double x);
double cm_smooth(double a, double b, double x);
double cm_decay(double rate, double dt);
double cm_ease(double s, double snap);
double cm_wrap_pi(double a);
double cm_idle_noise(double t, double period, double k);

/* A damped spring: the one piece of real-time physics used everywhere. */
typedef struct { double x, v; } cm_spring;
void cm_spring_step(cm_spring *s, double target, double omega, double zeta, double dt);

/* Two-bone inverse kinematics. The joint bends in the plane that holds root, target and the pole direction. */
void cm_ik2(const double root[3], const double target[3], double l1, double l2, const double pole[3], double mid[3], double end[3]);

/* Launch velocity that lobs something from p to t, no faster than vmax. */
void cm_lob(const double p[3], const double t[3], double vmax, double vel[3]);

/* Links of fixed length from a to a point b that the last one must reach if it can. pts holds n + 1 points:
   a first guess on the way in, the fitted chain on the way out. most: the share of its full length it may stretch to. */
void cm_reach_chain(double (*pts)[3], int n, const double a[3], const double b[3], double seg, double most);

/* Gait rules. One gait: when each leg lands in the cycle, and the share of the cycle a foot is down (slow, fast). */
typedef struct { double phases[CM_MAX_LEGS]; double duty[2]; } cm_gait;
typedef struct {
  double L, crouch_drop, run_stride, fr_run, fr_max;
  int legs, has_run, has_gallop;
  cm_gait walk, run, gallop;
  double gallop_fr, gallop_fr_max;
} cm_gait_config;
/* What carries over from step to step: the blends between gaits, and which side of each switch the body is on. */
typedef struct { double run, gal; int run_want, gal_want; } cm_gait_state;
typedef struct { double Leff, Tn, Fr, run, stride, period, duty, moving, Aw, Ar, gal; double phases[CM_MAX_LEGS]; } cm_gait_params;
void cm_gait_params_step(const cm_gait_config *c, cm_gait_state *s, double v, double crouch, double style_stride, double dt, cm_gait_params *out);

/* ---------------------------------------------------------------------------------------------------------
   Stage 2: the ground step.  Where the feet go and what the hips do: speed and turning, travel in any
   direction, the gait, foot planning with feet planted in the world, jumps and pounces, body height and pitch
   over uneven ground, and the legs' inverse kinematics.  A port of stepGround in js/core.js, checked against
   the replays in spec/ground/.  The upper body (spine, arms, head, tail, weapons) is stage 3. */

#define CM_MAX_EVENTS 32
#define CM_MAX_CHAIN 12                        /* links in a tail */
enum { CM_BIPED, CM_MECH, CM_QUAD, CM_HEX };
enum { CM_EV_HIT = 1, CM_EV_JUMP, CM_EV_LAND, CM_EV_FIRE, CM_EV_RELOAD, CM_EV_LOADED, CM_EV_THROW, CM_EV_GRAB, CM_EV_PUTDOWN, CM_EV_PUNCH, CM_EV_STRIKE, CM_EV_DROP,
       CM_EV_BITE, CM_EV_POUNCE, CM_EV_PINCH, CM_EV_STING, CM_EV_INK, CM_EV_GRIP, CM_EV_TOP, CM_EV_DIE, CM_EV_MOUNT, CM_EV_DISMOUNT };
enum { CM_MODE_GROUND, CM_MODE_LADDER, CM_MODE_RAGDOLL, CM_MODE_SWIM, CM_MODE_FLY, CM_MODE_LEDGE, CM_MODE_RIDE };
enum { CM_MOUNT_HELD, CM_MOUNT_FIXED, CM_MOUNT_TURRET, CM_MOUNT_JAW };
/* the last three kits are for people who are not soldiers (and only for them): nothing in the hands, a case, a case on wheels */
enum { CM_KIT_NONE, CM_KIT_RIFLE, CM_KIT_PISTOLS, CM_KIT_SWORD, CM_KIT_HANDS, CM_KIT_CASE, CM_KIT_TROLLEY, CM_KIT_CHAINGUN, CM_KIT_CHAINGUNS };      /* any body that bears arms carries any weapon */
enum { CM_PROP_RIFLE, CM_PROP_PISTOL, CM_PROP_SWORD, CM_PROP_SHIELD, CM_PROP_CASE, CM_PROP_TROLLEY, CM_PROP_CHAINGUN, CM_PROP_SIDEGUN };
enum { CM_ACT_NONE, CM_ACT_RELOAD, CM_ACT_THROW, CM_ACT_PICKUP, CM_ACT_PUTDOWN, CM_ACT_PUNCH, CM_ACT_SWING, CM_ACT_BITE, CM_ACT_PINCH, CM_ACT_STING, CM_ACT_GRAB };
enum { CM_BODY_BIPED, CM_BODY_MECH, CM_BODY_BEAST, CM_BODY_QUAD, CM_BODY_OCTO, CM_BODY_ARTHRO, CM_BODY_SPIDER };
enum { CM_PUNCH_JAB = 1, CM_PUNCH_CROSS, CM_PUNCH_HOOK };
enum { CM_SWING_SLASH = 1, CM_SWING_CHOP, CM_SWING_THRUST };
enum { CM_GAIT_STANDING, CM_GAIT_WALK, CM_GAIT_RUN, CM_GAIT_TROT, CM_GAIT_GALLOP, CM_GAIT_JUMP };

typedef struct { double fb, hb, toe, ah, heel_lift, strike; } cm_foot;
/* a chain of links (a tail, an arm in the water): how many, how long, how it hangs and how stiff it is */
typedef struct { int n; double seg, rest, curl, omega, zeta, soft, sag, bend, inert; } cm_chain_def;
typedef struct { double attach[3], rest[2], upper, lower, pole[3]; int side, has_foot; cm_foot foot; } cm_leg_def;
typedef struct {
  const char *id;
  int kind;
  double L, root_height, crouch_drop, run_drop, vmax, jump_h, bob, sway, lift_walk, lift_run;
  cm_gait_config gait;
  int legs;
  cm_leg_def leg[CM_MAX_LEGS];
  int has_beast, beast_mid; double beast_flex, beast_rock;
  int has_fight; double fight_stance[CM_MAX_LEGS][2];
  double arthro_rock;
  /* the upper body (stage 3) */
  int mount_type, mount_kit, mount_n, mount_has_yaw, mount_civil;      /* civil: a person who is not a soldier, and carries the civil kits */
  double mount_rate, mount_kick, mount_rise, mount_omega, mount_aim_omega, mount_min, mount_max, mount_yaw, mount_body_kick;
  double torso_len, torso_neck, torso_head_r, torso_shoulder_w, arm_upper, arm_lower;
  double pod_h, pod_r, pod_gun_z, pod_gun_len;
  /* animals: body, neck and jaws; the tail as a chain; an arthropod's body, claws and sting; the octopus; wings */
  double beast_half, beast_back, beast_neck, beast_neck_up, beast_skull, beast_jaw, beast_tilt;
  int has_tail, tail_n;
  double tail_at[2], tail_seg, tail_rest, tail_curl, tail_omega, tail_zeta, tail_soft, tail_sag, tail_bend, tail_lift, tail_wag, tail_alert, tail_sway, tail_inert;
  int has_arthro, arthro_both, arthro_under, arthro_has_thorax, arthro_has_head, arthro_has_sting_at, has_claw, claw_has_strike_at;
  double arthro_half, arthro_strike, arthro_thorax[4], arthro_head[2], arthro_sting_at[2];
  double claw_at[3], claw_upper, claw_lower, claw_hand, claw_rest[3], claw_strike_at[3];
  int has_octo; double octo_mantle, octo_arm_seg;
  int has_fly, fly_zfold; double fly_at[3], fly_w1, fly_w2, fly_chord, fly_sweep;
  /* off the ground (stage 4): the octopus in the water, fliers in the air */
  double octo_vswim; cm_chain_def octo_arm;
  int fly_hover, fly_glide;
  double fly_beat, fly_amp, fly_vmin, fly_vmax, fly_turn, fly_acc, fly_climb, fly_sink, fly_height, fly_low, fly_heave, fly_pitch0, fly_slow_pitch, fly_hang[2];
  /* where a rider sits, if this body can be ridden: the seat from the body's root (along, up); the stirrups and the
     place for the hands from the seat (along, up, to the side); reins: 0 none, 1 to the mouth, 2 to a strap round the neck */
  int has_saddle, saddle_reins; double saddle_at[2], saddle_stirrup[3], saddle_hands[3];
} cm_character;

/* The built-in characters (clio_motion_characters.c, written by tools/spec.js from the reference). */
int cm_character_count(void);
const cm_character *cm_character_at(int i);
const cm_character *cm_character_find(const char *id);

typedef struct { int active, air, manual, early, has_start_w, has_tz; double s, rate, start[3], alpha0, tx, ty, tz, psi0, start_w[3]; } cm_swing;
typedef struct { double ball[3]; cm_swing swing; double alpha, strike, slope, fwd, drop, ref_y; int has_w; double w[3], hd, psi, over, behind; } cm_leg_state;
enum { CM_JUMP_NONE, CM_JUMP_PREP, CM_JUMP_PUSH, CM_JUMP_AIR, CM_JUMP_LAND };
typedef struct { int stage, landed, pounce, struck; double t, vy, y, v0, phi, acc, vx; } cm_jump;
/* land: leg, side, x y z, hd.  fire, reload, loaded: gun.  throw: pos, vel, point (the target).  putdown: pos, hd.
   punch: kind, hand, pos, vel (the way the fist was going), miss.  strike: kind, pos (hilt), point, vel (the way the point is going).
   bite: pos (the muzzle), vel (the way it points), miss.  pounce: pos.  pinch: pos, hand (which claw), miss.
   sting: pos, miss.  grab by an octopus: pos, hand (which arm), miss.  ink: pos, vel. */
typedef struct { int type, leg, side, gun, kind, hand; double x, y, z, hd, pos[3], vel[3], point[3], miss; } cm_event;
/* A timed action that takes over part of the upper body while the legs carry on. */
typedef struct {
  int kind, hand, done, live, gun, n_queue, queue[2], has_target, has_prev, has_rel0[2], has_prev_tip, side, arm;
  double t, dur, hit, target[3], prev[3], tw0, rel0[2][3], prev_tip[3];
} cm_action;
typedef struct { double at[3], size[3], yaw, ca, hk; int held; } cm_carry;        /* size: depth, height, width */
/* A tail's links: each has an angle up or down (th), an angle to the side (ps), and their turning speeds. */
typedef struct { int n; double th[CM_MAX_CHAIN], ps[CM_MAX_CHAIN], vth[CM_MAX_CHAIN], vps[CM_MAX_CHAIN], by, vy, ay, dr[2], ax, az; } cm_chain;


typedef struct {
  double speed, crouch, steer;                 /* m/s; 0..1; -1..1 */
  int has_heading; double heading;             /* a direction to face, radians (instead of steer) */
  double dir;                                  /* the way to go, measured from the way the body faces */
  int jump;
  int has_hit; double hit[3];                  /* a blow that does not floor the body */
  int has_move; double move[2];                /* drift in the world while standing */
  int has_pounce, has_pounce_target; double pounce_target[3];
  /* the upper body (stage 3) */
  int has_aim; double aim[3];                  /* a point of the world to aim at: 0 none, 3 given (2: no z, the body's own is used) */
  int fire, armed, kit, reload;                /* armed: weapons out; kit: CM_KIT_... to change to, or 0 */
  int has_throw; double throw_target[3];       /* 1 throw ahead, 2 at the target */
  int has_pickup, pickup_has_at, pickup_has_heading, pickup_has_size; double pickup_at[3], pickup_heading, pickup_size[3];
  int putdown, guard, block;
  int punch, has_punch_target, has_track; double punch_target[3], track[3];      /* CM_PUNCH_... */
  int swing;                                   /* CM_SWING_... */
  /* animals: 1 at nothing in particular, 2 at the target */
  int bite, pinch, sting, grab, ink; double bite_target[3], pinch_target[3], sting_target[3], grab_target[3];
  /* off the ground (stage 4) */
  int has_depth; double depth;                 /* swimming: metres above the bottom */
  int has_height; double height;               /* flying: metres above the ground */
  int climb, drop;                             /* hanging from a ledge: pull up; let go */
  int die; double die_impulse[3];              /* knocked down: 1 from straight ahead, 2 with this push (world) */
} cm_input;
/* How the motion is styled: 1 is the plain setting for the first five. still (0..1) takes the life out of a standing
   body: no shifting of weight, no breathing, no looking about (0: alive, the usual). */
typedef struct { double bounce, stride, arm, lean, step, snap, still; } cm_style;
extern const cm_style CM_STYLE;                /* 1, 1, 1, 1, 1, 0.3, 0 */

/* Ground height at a point of the world. */
typedef double (*cm_terrain_fn)(double x, double z, void *user);

typedef struct { double hip[3], knee[3], ankle[3], ball[3], heel[3], toe[3], target[3]; int planted, has_foot, has_target, side; } cm_leg_pose;
typedef struct {
  double root[3], pitch, heading, crouch;      /* points are in world coordinates */
  int legs;
  cm_leg_pose leg[CM_MAX_LEGS];
  int gait;                                    /* CM_GAIT_... */
  double Fr, stride, period, duty, run, v, turn;
} cm_ground_pose;

typedef struct { double shoulder[3], elbow[3], hand[3]; int side; } cm_arm_pose;
/* A thing held in the hands. For a sword 'muzzle' is its point and 'body' where the blade starts. */
typedef struct { int kind, has_fore; double o[3], muzzle[3], body[3], grip[3], grip_low[3], fore[3], mag_a[3], mag_b[3], dir[3], up[3], flash, stow; } cm_prop_pose;
typedef struct { double c[3], f[3], u[3], side[3], size[3]; int held; } cm_carry_pose;
typedef struct { double joint[3], base[3], tip[3], dir[3], flash; int side; } cm_mount_pose;
typedef struct { double shoulder[3], elbow[3], wrist[3], tip[3], finger_a[3], finger_b[3], open; int side; } cm_claw_pose;
typedef struct { double root[3], mid[3], tip[3], t1[3], t2[3], chord; int side; } cm_wing_pose;
typedef struct {
  int kind;                                    /* CM_BIPED, ... */
  cm_ground_pose base;                         /* root, pitch, heading, crouch, legs, gait */
  double lean, pack, chest[3], head[3], gaze[3], u[3], f[3], side[3];
  cm_arm_pose arm[2];                          /* bipeds: right, left */
  int n_props; cm_prop_pose prop[2];
  int has_carry; cm_carry_pose carry;
  double grenade[3]; int grenade_held;
  int n_mounts; cm_mount_pose mount[2];        /* the mech's guns; one gun, jaw or sting for the others */
  /* horizontal bodies */
  int body;                                    /* CM_BODY_...: which of the fields below are filled */
  double axis[3], up[3], back[3], front[3], neck[3], eye[3], dome[3], tail[3], jaw, alert, flex;
  int n_tail_pts; double tail_pts[CM_MAX_CHAIN + 1][3];
  int n_claws; cm_claw_pose claw[2];
  int has_thorax; double thorax[2][3];
  int n_arms; double arms[CM_MAX_LEGS][7][3];  /* the octopus's arms, seven points each */
  int has_mantle; double mantle_c[3], mantle_tip[3], mantle_r;
  int n_wings; cm_wing_pose wing[2];
  int swimming, flying, climbing;              /* in the water; in the air; on a ladder or a ledge (then no carry, grenade or side) */
  int down, no_tail;                           /* lying as a ragdoll (no carry or grenade); a body with no tail point */
  int riding, n_reins; double reins[2][2][3];  /* in the saddle; the reins, each from a hand to the bit or the neck strap */
} cm_pose;

/* The ragdoll: the joints as point masses in the body's forward-up plane (each keeps its sideways offset), held
   together by bone lengths, a few limits and the ground; tails and claws as limp chains. */
#define CM_RAG_MAX 24
typedef struct { double p[2], q[2], z, r, w; int hit; } cm_particle;
typedef struct { int a, b, has_dz; double rest, dz; } cm_rag_link;
typedef struct { int a, b, c, sign; } cm_rag_sign;
typedef struct { int n, on; double p[CM_MAX_CHAIN + 1][3], q[CM_MAX_CHAIN + 1][3], seg[CM_MAX_CHAIN], r; } cm_limp;
typedef struct {
  double frame[5], h, t, still, aim, tw, gaze_off, dt;
  int asleep, n, n_bones, n_mins, n_maxs, n_signs, n_upper, n_center, upper[2], center[2];
  cm_particle P[CM_RAG_MAX];
  cm_rag_link bones[CM_RAG_MAX], mins[CM_RAG_MAX], maxs[4];
  cm_rag_sign signs[CM_RAG_MAX];
  int root, chest, head, back, front, mid, knee[CM_MAX_LEGS], ankle[CM_MAX_LEGS], toe[CM_MAX_LEGS], elbow[2], hand[2], prop_s[2], prop_m[2];
  /* what is kept of the pose the body had when it went down */
  int legs, arm_side[2], n_props, prop_kind[2], n_mounts, mount_side[2], n_claws, claw_side[2];
  double arm_sh_z[2], mount_z[2];
  cm_limp tail, claw[2];
} cm_ragdoll;

/* A ladder standing in front of the body: x is how far ahead it is (in the frame the body had when it took hold),
   rung(k) the height of rung k, about y0 + k * spacing (the rungs need not be even). */
typedef struct { double x, y0, spacing; double (*rung)(int k, void *user); void *user; } cm_ladder;

/* Everything a character carries from one step to the next. */
typedef struct cm_state {
  double t, x, y, v, a, phase, crouch;
  cm_gait_state gait;
  int standing;
  cm_spring g_ref, pitch, pack, hop, bank, side, lean, rise, flinch, guard, stance;
  double reach_drop, pack_vy, last_y, air_b, idle_t;
  double px, pz, h, om, kv[2];                 /* place in the world, heading, turn rate, slide after a blow */
  int flinch_dir, has_vl;
  double vl[2], tv[2], mv[2], lag;
  int carry, act;                              /* a crate is in hand or being handled; the action in progress (CM_ACT_...) */
  double act_crouch, act_back;
  cm_action action;
  cm_carry crate;
  cm_spring aim, twist, armed, kick[2], block;
  double flash[2], cool, ac_tw, ho_rel[2][3];
  int gun, kit, ammo[2], has_ho_rel[2];
  cm_spring jaw;
  double ink_t;
  cm_chain tail;
  /* off the ground (stage 4) */
  int mode;                                    /* CM_MODE_... */
  double swim_vm, fly_vy, fly_effort;
  cm_chain arm[CM_MAX_LEGS];                   /* the octopus's arms in the water */
  const cm_ladder *ladder;                     /* the ladder being climbed (must outlive the climb) */
  double lad_frame[5], lad_y;                  /* the frame the body had when it took hold: local x, px, pz, cos, sin */
  struct { int k, swinging, from, to; double s, dur, psi; } limb[4];
  struct { double ex, ey, t; int up; cm_spring sw; } ledge;
  int has_crate_pos; double crate_pos[3];
  int has_last; cm_pose last;                  /* the pose of the last step: what a ragdoll starts from */
  cm_ragdoll rag;
  const struct cm_state *mount; const cm_character *mount_ch;       /* riding: the body ridden (must outlive the ride) */
  struct { cm_spring d; int has_sy; double sy, svy, acc, pv; } ride;
  cm_jump jump;
  int legs;
  cm_leg_state leg[CM_MAX_LEGS];
  int n_events;                                /* read, then set to 0 */
  cm_event events[CM_MAX_EVENTS];
} cm_state;

void cm_state_init(cm_state *s, const cm_character *ch, cm_terrain_fn terrain, void *user);
void cm_step_ground(cm_state *s, const cm_character *ch, const cm_input *in, const cm_style *st, cm_terrain_fn terrain, void *user, double dt, cm_ground_pose *out);

/* Stage 3: one step of a whole character on the ground: legs and hips, then the upper body, weapons and actions,
   for every built-in character, and from stage 4 in the water, in the air, on a ladder and on a ledge. Returns 0
   lying as a ragdoll or riding. in->die hands the body to its ragdoll from wherever it is. */
int cm_step(cm_state *s, const cm_character *ch, const cm_input *in, const cm_style *st, cm_terrain_fn terrain, void *user, double dt, cm_pose *out);
/* Stage 4: off the ground. cm_step goes on stepping a character in whatever mode these put it in. Each returns 1 if
   it took effect. Leaving a mode stands the body on the ground where it is. */
int cm_enter_swim(cm_state *s, const cm_character *ch);                       /* the octopus */
int cm_leave_swim(cm_state *s, const cm_character *ch, cm_terrain_fn terrain, void *user);
int cm_enter_fly(cm_state *s, const cm_character *ch);                        /* the wasp, the dragon */
int cm_leave_fly(cm_state *s, const cm_character *ch, cm_terrain_fn terrain, void *user);
int cm_enter_ladder(cm_state *s, const cm_character *ch, const cm_ladder *ladder);      /* bipeds; speed climbs */
void cm_leave_ladder(cm_state *s, const cm_character *ch, cm_terrain_fn terrain, void *user);
int cm_grab_ledge(cm_state *s, const cm_character *ch, const double edge[3]);  /* bipeds; in.climb pulls up, in.drop lets go */
/* ------------------------------------------------------------------------------------------------ the skeleton, live
   Stage 5a. What a game needs to move a model, or to draw a character's parts, from a pose while it runs.
   The rigs are data (clio_motion_rigs.c, written by tools/spec.js): for each character, and each of the soldier's
   kits, its joints (with the template pose, the pose models are built in) and the parts those joints carry. */
#define CM_MAX_JOINTS 56
#define CM_MAX_PARTS 64
/* o, x, y, z: where the joint is in the template pose and how it is turned (y along its bone, x to its side).
   ref: which way its side is taken from (0 the body's left, 1 forwards). carried: a joint for something the body
   carries (weapon, magazine, pack, load). */
typedef struct { const char *name; int parent, ref, carried; double o[3], x[3], y[3], z[3]; } cm_rig_joint;
/* A part of the stand-in model, in its joint's own frame: a capsule from a to b of radius r (has_b 0: a ball).
   end: where a picture laid along the part ends, if not at b. on: the centre of the rounder part this one sits on
   (an eye on a head). color: 0xRRGGBB. layer: its place in the draw order of a side view (low is behind).
   shade: 0 dark to 4 light. part: the image part it is the bone of; of: the image part it belongs to. */
typedef struct {
  int joint, has_b, has_end, has_on; double a[3], b[3], end[3], on[3], r; unsigned color; const char *group; double layer; int shade;
  const char *part, *of; int raw, sq;
} cm_rig_part;
typedef struct { const char *name, *id; int kit; double ears; int n_joints, n_parts; const cm_rig_joint *joints; const cm_rig_part *parts; } cm_rig;
int cm_rig_count(void);
const cm_rig *cm_rig_at(int i);
const cm_rig *cm_rig_find(const char *name);     /* "soldier", "soldier_pistols", "horse", ... */
/* The rig a pose belongs to: the character's, or for a soldier the one of the kit in the pose. */
const cm_rig *cm_rig_for(const cm_character *ch, const cm_pose *pose);

/* Where a joint is and how it is turned, in the pose's axes (x forward, y up, z to the right). */
typedef struct { double o[3], x[3], y[3], z[3]; } cm_joint;
/* Keep one for each character and set it to zero before its first use: a bone seen end on keeps the turn it had. */
typedef struct {
  const cm_rig *rig; int n; cm_joint joint[CM_MAX_JOINTS]; double heading;
  struct { int on, shade; double layer; } held[3];           /* props 0 and 1 and the grenade: their draw layer now */
} cm_skeleton;
/* Every joint of the rig for this pose, in the rig's order. Returns the number of joints, or -1 if the pose does not
   fit any rig. */
int cm_skeleton_step(const cm_character *ch, const cm_pose *pose, cm_skeleton *sk);
/* The 4 x 4 matrix, in glTF axes (+Y up, +Z forward) and written column after column, that takes anything bound to
   joint j from the template pose to where it is now. For a model built on templates/3d: world = move * rest. */
void cm_joint_move(const cm_skeleton *sk, int j, double m[16]);
/* A part where its joint has carried it. key and level are filled by cm_parts_order. */
typedef struct { const cm_rig_part *def; double a[3], b[3], end[3], on[3], layer, key; int shade, level; } cm_part;
/* The parts the joints carry, in the rig's order: out must hold sk->rig->n_parts of them. Returns how many. */
int cm_skeleton_parts(const cm_skeleton *sk, cm_part *out);
/* Back to front for a view turned by yaw (0: from the body's right side when its heading is 0). Sets key and level
   (the shade, 0 dark to 4 light, -1 for a part that glows) on each part and writes the parts' numbers in drawing
   order. The body seen from its other side has its near and far parts change places. */
void cm_parts_order(cm_part *parts, int n, double heading, double yaw, int *order);

/* Where a part's picture goes on the screen. A picture: its size in pixels, how it is laid along its bone (CM_AXIS_...,
   as in js/rig.js, SLOTS), and, for a picture cut from a drawing, its box in the bone's frame in metres with the
   bone's length and radius as they were drawn (has_box). a, b: the bone's ends on the screen (b 0 for a part with
   no length); rs: the part's radius there; ppm: pixels to a metre; flip: the body is seen from its other side.
   Out: move to (x, y), turn by rot (radians, clockwise on a screen whose y runs down), scale by (fx, fy), then draw
   the picture into the box (dx, dy, dw, dh). */
enum { CM_AXIS_BALL, CM_AXIS_UP, CM_AXIS_DOWN, CM_AXIS_RIGHT };
typedef struct { int axis, w, h, has_box; double box[4], len, r; } cm_picture;
typedef struct { double x, y, rot, fx, fy, dx, dy, dw, dh; } cm_placing;
void cm_part_place(const cm_picture *im, const double a[2], const double *b, double rs, double ppm, int flip, cm_placing *out);

/* Riding. cm_mount_up puts a biped on a body that has a saddle (0 if it cannot be ridden); from then on step the mount
   first with cm_step, then the rider with cm_step. The rider's hips are held to the seat by a spring, the feet stay in
   the stirrups, the hands hold the reins until a weapon is drawn; aiming, firing, reloading, the sword and throwing all
   work from the saddle. cm_dismount stands the rider beside the mount, on its left. */
int cm_mount_up(cm_state *s, const cm_character *ch, const cm_state *mount, const cm_character *mount_ch);
int cm_dismount(cm_state *s, const cm_character *ch, cm_terrain_fn terrain, void *user);
/* Back on the feet where the body lies, after a fall (a switch: it is not a get-up animation). */
void cm_stand(cm_state *s, const cm_character *ch, cm_terrain_fn terrain, void *user);
/* Stand a character somewhere in the world, facing a given way, feet on the ground there. */
void cm_place(cm_state *s, const cm_character *ch, cm_terrain_fn terrain, void *user, double x, double z, double heading);

/* Start a reload by hand (asked: reload full weapons too). Returns 1 if it started. */
int cm_start_reload(cm_state *s, const cm_character *ch, int asked);

/* ------------------------------------------------------------------------------------------------ for other languages
   A body behind a handful of calls that take and give plain numbers, for a program that loads this library at run
   time (Python's ctypes, C#'s P/Invoke, GDExtension...). The shared library (make shared: libclio_motion.so, .dylib,
   clio_motion.dll) exports these and nothing else.

     void *b = malloc(cm_body_size());
     cm_body_init(b, "hyena", NULL);                 0, or -1 if there is no such character
     double in[CM_NIN] = { 0 }; in[0] = 1.4;         the inputs as numbers: see cm_input_from_numbers
     cm_body_step(b, in, 1.0 / 60);
     n = cm_body_joints(b, joints);                  n joints, twelve numbers each: place, then its x, y and z axes

   A body must stay where it is in memory (its rider, if it has one, points at it). The ground is flat unless
   cm_body_ground_... says otherwise. Nothing here is safe to call for one body from two threads at once. */
#if defined(CM_STATIC)
#  define CM_API
#elif defined(_WIN32)
#  if defined(CM_BUILD)
#    define CM_API __declspec(dllexport)
#  else
#    define CM_API __declspec(dllimport)
#  endif
#elif defined(__GNUC__)
#  define CM_API __attribute__((visibility("default")))
#else
#  define CM_API
#endif
/* Building the shared library on Linux: the maths it calls are asked for as the oldest C library has them, so that
   one built on a new system loads on an old one too. */
#if defined(CM_BUILD) && defined(__linux__)
#  include <math.h>
#  if defined(__GLIBC__) && defined(__x86_64__)
__asm__(".symver exp,exp@GLIBC_2.2.5"); __asm__(".symver pow,pow@GLIBC_2.2.5"); __asm__(".symver fmod,fmod@GLIBC_2.2.5");
__asm__(".symver log,log@GLIBC_2.2.5");
#  elif defined(__GLIBC__) && defined(__aarch64__)
__asm__(".symver exp,exp@GLIBC_2.17"); __asm__(".symver pow,pow@GLIBC_2.17"); __asm__(".symver fmod,fmod@GLIBC_2.17");
__asm__(".symver log,log@GLIBC_2.17");
#  endif
#endif
#define CM_VERSION "0.28.0"
#define CM_NIN 82                                  /* how many numbers the inputs are */
#define CM_NEV 22                                  /* how many kinds of event there are (CM_EV_... run from 1) */

/* The inputs from CM_NIN numbers, in the order the recorded runs keep them (tools/golden.js: inputLine, inputLine3):
   0 speed  1 crouch  2 steer  3 a heading is given  4 heading  5 dir  6 jump  7 a blow  8-10 its push  11 a drift
   12-13 its velocity  14 pounce  15 at a target  16-18 the target
   19 aim: how many numbers (0 none, 2, 3)  20-22 the point  23 fire  24 armed  25 kit (0 as it is, 1 rifle, 2 pistols,
   3 sword)  26 reload  27 throw (1, 2 at a target)  28-30  31 pickup  32 at a place  33-35  36 with a heading  37
   38 with a size  39-41  42 putdown  43 guard  44 block  45 punch (1 jab, 2 cross, 3 hook)  46 at a target  47-49
   50 track  51-53  54 swing (1 slash, 2 chop, 3 thrust)  55 bite (1, 2 at a target)  56-58  59 pinch  60-62
   63 sting  64-66  67 grab  68-70  71 ink  72 a depth is given  73 depth  74 a height is given  75 height  76 climb
   77 drop  78 die (1 from straight ahead, 2 with a push)  79-81 the push */
CM_API void cm_input_from_numbers(const double *v, cm_input *in);

CM_API const char *cm_version(void);
CM_API int cm_body_size(void);
/* style: seven numbers (bounce stride arm lean step snap still), or NULL for the plain one. */
CM_API int cm_body_init(void *body, const char *character, const double *style);
/* The ground: flat; a sum of n waves (height kx kz phase each: height * sin(kx x + kz z + phase)) with, if has_wall,
   wall_h more beyond x = wall_x; or a grid of heights, nx by nz, cell apart, from (x0, z0), row after row along x -
   between its points the height is blended, beyond its edge it is the edge's. The grid is not copied: it has to stay.
   After changing the ground, cm_body_reset starts the body again on it, standing at the origin. */
CM_API void cm_body_ground_flat(void *body);
CM_API int cm_body_ground_waves(void *body, int n, const double *waves, int has_wall, double wall_x, double wall_h);
CM_API int cm_body_ground_grid(void *body, double x0, double z0, double cell, int nx, int nz, const double *heights);
CM_API void cm_body_reset(void *body);
CM_API void cm_body_place(void *body, double x, double z, double heading);
/* One step. in: CM_NIN numbers, or NULL for the same inputs as the last step. Returns 0, or -1 if the step failed. */
CM_API int cm_body_step(void *body, const double *in, double dt);
/* A call that changes what the body is doing, by the numbers the recorded runs use: 1 dive in (swim), 2 out of the
   water, 3 take off, 4 land, 5 take hold of a ladder (args: x y0 spacing amp freq phase), 6 let go of it, 7 grab a
   ledge (args: x y z), 8 place (args: x z heading), 9 stand up, 11 dismount. Returns what the call returns (1 done). */
CM_API int cm_body_call(void *body, int call, const double *args);
/* Riding: the rider on the mount (0 if it cannot be ridden). Each step, step the mount first, then the rider. */
CM_API int cm_body_mount(void *rider, void *mount);
/* out: where it is (x, z), its heading, its speed, its root's height, the mode it is in (0 ground, 1 ladder,
   2 ragdoll, 3 swim, 4 fly, 5 ledge, 6 ride), whether it lies still (a ragdoll at rest), its kit (0 none). */
CM_API void cm_body_state(const void *body, double out[8]);
/* How many of each kind of event since the last call: out[CM_EV_FIRE - 1] and so on, CM_NEV numbers. */
CM_API void cm_body_events(void *body, int *out);
/* The skeleton of the pose as it is now. The rig's name ("soldier_pistols"); its joints, twelve numbers each (place,
   x, y, z axes; the pose's axes: x forward, y up, z right); each joint's move from the template pose, sixteen numbers
   (glTF's axes, column after column). Each returns the number of joints, or -1 if the pose fits no rig. */
CM_API const char *cm_body_rig(void *body);
CM_API int cm_body_joints(void *body, double *out);
CM_API int cm_body_moves(void *body, double *out);
/* Points carried by joints (a stand-in model's corners): n points, each with its joint and its place in that
   joint's frame; out: three numbers each, in the pose's axes - or, with frame (twelve numbers: three rows of a 3 x 3
   matrix, then an offset), as frame's matrix times the point plus the offset. Returns n, or -1. */
CM_API int cm_body_points(void *body, int n, const int *joint, const double *local, const double *frame, double *out);
/* A skin: n corners at rest in the template pose (glTF's axes, metres); corner k is carried by count[k] joints,
   listed one after another in joint and weight. out as for cm_body_points, from glTF's axes. Returns n, or -1. */
CM_API int cm_body_skin(void *body, int n, const double *rest, const int *count, const int *joint, const double *weight,
                        const double *frame, double *out);


#ifdef __cplusplus
}
#endif
#endif
