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
enum { CM_BIPED, CM_MECH, CM_QUAD, CM_HEX };
enum { CM_EV_HIT = 1, CM_EV_JUMP, CM_EV_LAND };
enum { CM_GAIT_STANDING, CM_GAIT_WALK, CM_GAIT_RUN, CM_GAIT_TROT, CM_GAIT_GALLOP, CM_GAIT_JUMP };

typedef struct { double fb, hb, toe, ah, heel_lift, strike; } cm_foot;
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
} cm_character;

/* The built-in characters (clio_motion_characters.c, written by tools/spec.js from the reference). */
int cm_character_count(void);
const cm_character *cm_character_at(int i);
const cm_character *cm_character_find(const char *id);

typedef struct { int active, air, manual, early, has_start_w, has_tz; double s, rate, start[3], alpha0, tx, ty, tz, psi0, start_w[3]; } cm_swing;
typedef struct { double ball[3]; cm_swing swing; double alpha, strike, slope, fwd, drop, ref_y; int has_w; double w[3], hd, psi, over, behind; } cm_leg_state;
enum { CM_JUMP_NONE, CM_JUMP_PREP, CM_JUMP_PUSH, CM_JUMP_AIR, CM_JUMP_LAND };
typedef struct { int stage, landed, pounce; double t, vy, y, v0, phi, acc, vx; } cm_jump;
typedef struct { int type, leg, side; double x, y, z, hd; } cm_event;

/* Everything a character carries from one step to the next. */
typedef struct {
  double t, x, y, v, a, phase, crouch;
  cm_gait_state gait;
  int standing;
  cm_spring g_ref, pitch, pack, hop, bank, side, lean, rise, flinch, guard, stance;
  double reach_drop, pack_vy, last_y, air_b, idle_t;
  double px, pz, h, om, kv[2];                 /* place in the world, heading, turn rate, slide after a blow */
  int flinch_dir, has_vl;
  double vl[2], tv[2], mv[2], lag;
  int carry, act;                              /* set by the action layer (stage 3): act is 0 none, 1 reload, 2 other */
  double act_crouch, act_back;
  cm_jump jump;
  int legs;
  cm_leg_state leg[CM_MAX_LEGS];
  int n_events;                                /* read, then set to 0 */
  cm_event events[CM_MAX_EVENTS];
} cm_state;

typedef struct {
  double speed, crouch, steer;                 /* m/s; 0..1; -1..1 */
  int has_heading; double heading;             /* a direction to face, radians (instead of steer) */
  double dir;                                  /* the way to go, measured from the way the body faces */
  int jump;
  int has_hit; double hit[3];                  /* a blow that does not floor the body */
  int has_move; double move[2];                /* drift in the world while standing */
  int has_pounce, has_pounce_target; double pounce_target[3];
} cm_input;
typedef struct { double bounce, stride, arm, lean, step, snap; } cm_style;
extern const cm_style CM_STYLE;                /* 1, 1, 1, 1, 1, 0.3 */

/* Ground height at a point of the world. */
typedef double (*cm_terrain_fn)(double x, double z, void *user);

typedef struct { double hip[3], knee[3], ankle[3], ball[3], heel[3], toe[3], target[3]; int planted, has_foot, side; } cm_leg_pose;
typedef struct {
  double root[3], pitch, heading, crouch;      /* points are in world coordinates */
  int legs;
  cm_leg_pose leg[CM_MAX_LEGS];
  int gait;                                    /* CM_GAIT_... */
  double Fr, stride, period, duty, run, v, turn;
} cm_ground_pose;

void cm_state_init(cm_state *s, const cm_character *ch, cm_terrain_fn terrain, void *user);
void cm_step_ground(cm_state *s, const cm_character *ch, const cm_input *in, const cm_style *st, cm_terrain_fn terrain, void *user, double dt, cm_ground_pose *out);

#ifdef __cplusplus
}
#endif
#endif
