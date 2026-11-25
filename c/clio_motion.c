/* Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE).
   SPDX-License-Identifier: Apache-2.0 */
#include "clio_motion.h"
#include <math.h>

#define TAU 6.283185307179586

double cm_clamp(double x, double a, double b) { return x < a ? a : x > b ? b : x; }
double cm_lerp(double a, double b, double t) { return a + (b - a) * t; }
double cm_frac(double x) { return x - floor(x); }
double cm_smooth(double a, double b, double x) { double t = cm_clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
double cm_decay(double rate, double dt) { return 1 - exp(-rate * dt); }
double cm_ease(double s, double snap) { double sm = s * s * s * (s * (6 * s - 15) + 10); return cm_lerp(s, sm, 0.4 + 0.6 * snap); }
double cm_wrap_pi(double a) { a = fmod(a + TAU / 2, TAU); if (a < 0) a += TAU; return a - TAU / 2; }
double cm_idle_noise(double t, double period, double k) {
  double a = TAU * t / period;
  return (sin(a + k) + 0.6 * sin(2 * a + 2.3 * k) + 0.4 * sin(3 * a + 4.1 * k)) / 2;
}

void cm_spring_step(cm_spring *s, double target, double omega, double zeta, double dt) {
  double a = -2 * zeta * omega * s->v - omega * omega * (s->x - target);
  s->v += a * dt; s->x += s->v * dt;
}

static double dot3(const double a[3], const double b[3]) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
static double len3(const double a[3]) { return sqrt(dot3(a, a)); }

void cm_ik2(const double root[3], const double target[3], double l1, double l2, const double pole[3], double mid[3], double end[3]) {
  double d[3], dir[3], perp[3], dist, maxR, minR, reach, cosA, sinA, pd, pl;
  int i;
  for (i = 0; i < 3; i++) d[i] = target[i] - root[i];
  dist = len3(d);
  maxR = (l1 + l2) * 0.999; minR = fabs(l1 - l2) + 1e-4;
  reach = cm_clamp(dist, minR, maxR);
  if (dist > 1e-6) { for (i = 0; i < 3; i++) dir[i] = d[i] * (1 / dist); } else { dir[0] = 0; dir[1] = -1; dir[2] = 0; }
  cosA = cm_clamp((l1 * l1 + reach * reach - l2 * l2) / (2 * l1 * reach), -1, 1);
  sinA = sqrt(1 - cosA * cosA);
  pd = dot3(pole, dir);
  for (i = 0; i < 3; i++) perp[i] = pole[i] - dir[i] * pd;
  pl = len3(perp);
  if (pl > 1e-6) { for (i = 0; i < 3; i++) perp[i] = perp[i] * (1 / pl); } else { perp[0] = 1; perp[1] = 0; perp[2] = 0; }
  for (i = 0; i < 3; i++) { mid[i] = root[i] + (dir[i] * (l1 * cosA) + perp[i] * (l1 * sinA)); end[i] = root[i] + dir[i] * reach; }
}

void cm_lob(const double p[3], const double t[3], double vmax, double vel[3]) {
  double dx = t[0] - p[0], dz = t[2] - p[2], dy = t[1] - p[1], d = sqrt(dx * dx + dz * dz), th, den, c, v;
  if (d < 0.3) {
    double dd = d != 0 ? d : 1;
    dx = dx / dd * 0.3; if (dx == 0) dx = 0.3;
    dz = dz / dd * 0.3; d = 0.3;
  }
  th = d < 3 ? 0.95 : 0.72; den = d * tan(th) - dy;
  if (den < 0.15 * d) { th = fmin(atan2(dy, d) + 0.5, 1.35); den = fmax(d * tan(th) - dy, 0.05 * d); }
  c = cos(th); v = fmin(sqrt(CM_G * d * d / (2 * c * c * den)), vmax != 0 ? vmax : 15);
  vel[0] = v * c * dx / d; vel[1] = v * sin(th); vel[2] = v * c * dz / d;
}

void cm_reach_chain(double (*pts)[3], int n, const double a[3], const double b[3], double seg, double most) {
  double tot = n * seg * (most != 0 ? most : 0.985), ab[3], al, bb[3], d[3], l;
  int k, it, i;
  for (i = 0; i < 3; i++) { ab[i] = b[i] - a[i]; bb[i] = b[i]; }
  al = len3(ab);
  if (al > tot) for (i = 0; i < 3; i++) bb[i] = a[i] + ab[i] * (tot / al);
  for (it = 0; it < 5; it++) {
    for (i = 0; i < 3; i++) pts[n][i] = bb[i];
    for (k = n - 1; k >= 1; k--) {
      for (i = 0; i < 3; i++) d[i] = pts[k][i] - pts[k + 1][i];
      l = len3(d); if (l == 0) l = 1;
      for (i = 0; i < 3; i++) pts[k][i] = pts[k + 1][i] + d[i] * (seg / l);
    }
    for (i = 0; i < 3; i++) pts[0][i] = a[i];
    for (k = 1; k <= n; k++) {
      for (i = 0; i < 3; i++) d[i] = pts[k][i] - pts[k - 1][i];
      l = len3(d); if (l == 0) l = 1;
      for (i = 0; i < 3; i++) pts[k][i] = pts[k - 1][i] + d[i] * (seg / l);
    }
  }
}

/* Dynamic similarity: animals of different sizes move alike at the same Froude number v^2 / (g L). */
void cm_gait_params_step(const cm_gait_config *c, cm_gait_state *s, double v, double crouch, double style_stride, double dt, cm_gait_params *o) {
  double Leff = c->L * (1 - 0.5 * c->crouch_drop * crouch);
  double Tn = TAU * sqrt(Leff / CM_G);                     /* natural swing period of the leg */
  double Fr = v * v / (CM_G * Leff);
  double run, stride, period, wd, rd, duty, gal = 0, q4, Ts;
  int i;
  if (c->has_run) {
    s->run_want = Fr > c->fr_run * (s->run_want ? 0.8 : 1);          /* hysteresis around the walk-run switch */
    s->run += ((s->run_want ? 1 : 0) - s->run) * cm_decay(1 / (0.11 * Tn), dt);
  } else s->run = 0;
  run = s->run;
  /* stride length: Alexander's relation, stride / leg length = 2.3 Fr^0.3 */
  stride = Leff * 2.3 * pow(fmax(Fr, 1e-6), 0.3) * style_stride * cm_lerp(1, c->run_stride, run) * (1 - 0.45 * crouch);
  period = stride / fmax(v, 1e-4);
  if (period > Tn) { period = Tn; stride = v * Tn; }       /* legs never swing slower than a pendulum */
  wd = cm_lerp(c->walk.duty[0], c->walk.duty[1], cm_clamp(Fr / c->fr_run, 0, 1));
  rd = c->has_run ? cm_lerp(c->run.duty[0], c->run.duty[1], cm_clamp((Fr - c->fr_run) / (c->fr_max - c->fr_run), 0, 1)) : wd;
  duty = cm_lerp(wd, rd, run);
  for (i = 0; i < c->legs; i++) {
    double p = c->walk.phases[i];
    if (c->has_run) { double d = c->run.phases[i] - p; d -= floor(d + 0.5); p = cm_frac(p + d * run + 1); }    /* shortest way round the cycle */
    o->phases[i] = p;
  }
  if (c->has_gallop) {
    s->gal_want = Fr > c->gallop_fr * (s->gal_want ? 0.8 : 1);
    s->gal = s->gal + ((s->gal_want ? 1 : 0) - s->gal) * cm_decay(1 / (0.16 * Tn), dt); gal = s->gal;
    duty = cm_lerp(duty, cm_lerp(c->gallop.duty[0], c->gallop.duty[1], cm_clamp((Fr - c->gallop_fr) / (c->gallop_fr_max - c->gallop_fr), 0, 1)), gal);
    for (i = 0; i < c->legs; i++) { double d = c->gallop.phases[i] - o->phases[i]; d -= floor(d + 0.5); o->phases[i] = cm_frac(o->phases[i] + d * gal + 1); }
  }
  o->moving = cm_smooth(0.02, 0.25, v / sqrt(CM_G * Leff));
  /* walk: the hip vaults over the planted foot like an inverted pendulum (highest mid-step) */
  q4 = fmin(stride / 4, 0.8 * Leff);
  o->Aw = 0.3 * (Leff - sqrt(Leff * Leff - q4 * q4));
  /* run: the leg is a spring (lowest mid-step); bounce size follows from step time and gravity */
  Ts = period / 2;
  o->Ar = fmin(CM_G * Ts * Ts / (TAU * TAU) * (1 + 2 * fmax(0, 0.5 - duty)), 0.09 * Leff);
  o->Leff = Leff; o->Tn = Tn; o->Fr = Fr; o->run = run; o->stride = stride; o->period = period; o->duty = duty; o->gal = gal;
}
