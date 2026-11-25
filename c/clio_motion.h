/* Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE).
   SPDX-License-Identifier: Apache-2.0

   CLIo Motion, C99. Stage 1: the numeric kernel that everything else is built on. It is a port of
   js/core.js and is checked against spec/kernel_vectors.txt, which the JavaScript version writes.
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

#ifdef __cplusplus
}
#endif
#endif
