/* Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE).
   SPDX-License-Identifier: Apache-2.0

   CLIo Motion, for other languages: a body behind calls that take and give plain numbers (see clio_motion.h). */
#include "clio_motion.h"
#include <math.h>
#include <string.h>

#define MAXW 8

typedef struct cm_body {
  const cm_character *ch;
  cm_state S;
  cm_pose P;
  cm_skeleton sk;
  int has_pose, sk_n;                    /* sk_n: the skeleton's joints for this pose (0: not worked out yet) */
  cm_style style;
  cm_input in;
  int ground;                            /* 0 flat, 1 waves, 2 a grid */
  int nw, wall; double w[MAXW][4], wx, wh;
  double gx0, gz0, gcell; int gnx, gnz; const double *gh;
  cm_ladder ladder; double rungs[5];     /* y0 spacing amp freq phase */
  struct cm_body *mount;
  int tally[CM_NEV];
} cm_body;

static double height(double x, double z, void *user) {
  const cm_body *b = (const cm_body *)user;
  if (b->ground == 1) {
    double y = 0;
    int i;
    for (i = 0; i < b->nw; i++) y += b->w[i][0] * sin(b->w[i][1] * x + b->w[i][2] * z + b->w[i][3]);
    return y + (b->wall && x > b->wx ? b->wh : 0);
  }
  if (b->ground == 2) {
    double u = (x - b->gx0) / b->gcell, v = (z - b->gz0) / b->gcell, fu, fv;
    int i, j;
    const double *h = b->gh;
    if (u < 0) u = 0; else if (u > b->gnx - 1) u = b->gnx - 1;
    if (v < 0) v = 0; else if (v > b->gnz - 1) v = b->gnz - 1;
    i = (int)u; j = (int)v;
    if (i > b->gnx - 2) i = b->gnx - 2;
    if (j > b->gnz - 2) j = b->gnz - 2;
    if (i < 0) i = 0;
    if (j < 0) j = 0;
    fu = u - i; fv = v - j;
    if (b->gnx < 2) fu = 0;
    if (b->gnz < 2) fv = 0;
    {
      int i1 = b->gnx < 2 ? i : i + 1, j1 = b->gnz < 2 ? j : j + 1;
      double a = h[j * b->gnx + i] * (1 - fu) + h[j * b->gnx + i1] * fu, c = h[j1 * b->gnx + i] * (1 - fu) + h[j1 * b->gnx + i1] * fu;
      return a * (1 - fv) + c * fv;
    }
  }
  return 0.0;
}
static double rung(int k, void *user) {
  const double *r = (const double *)user;
  return r[0] + k * r[1] + r[2] * sin(r[3] * k + r[4]);
}
static void c3(double *d, const double *s) { d[0] = s[0]; d[1] = s[1]; d[2] = s[2]; }

CM_API void cm_input_from_numbers(const double *v, cm_input *in) {
  const double *w = v + 19;
  memset(in, 0, sizeof *in);
  in->speed = v[0]; in->crouch = v[1]; in->steer = v[2]; in->has_heading = v[3] != 0; in->heading = v[4]; in->dir = v[5]; in->jump = v[6] != 0;
  in->has_hit = v[7] != 0; c3(in->hit, v + 8);
  in->has_move = v[11] != 0; in->move[0] = v[12]; in->move[1] = v[13];
  in->has_pounce = v[14] != 0; in->has_pounce_target = v[15] != 0; c3(in->pounce_target, v + 16);
  in->has_aim = (int)w[0]; c3(in->aim, w + 1);
  in->fire = w[4] != 0; in->armed = w[5] != 0; in->kit = (int)w[6]; in->reload = w[7] != 0;
  in->has_throw = (int)w[8]; c3(in->throw_target, w + 9);
  in->has_pickup = w[12] != 0; in->pickup_has_at = w[13] != 0; c3(in->pickup_at, w + 14);
  in->pickup_has_heading = w[17] != 0; in->pickup_heading = w[18]; in->pickup_has_size = w[19] != 0; c3(in->pickup_size, w + 20);
  in->putdown = w[23] != 0; in->guard = w[24] != 0; in->block = w[25] != 0;
  in->punch = (int)w[26]; in->has_punch_target = w[27] != 0; c3(in->punch_target, w + 28);
  in->has_track = w[31] != 0; c3(in->track, w + 32);
  in->swing = (int)w[35];
  in->bite = (int)w[36]; c3(in->bite_target, w + 37); in->pinch = (int)w[40]; c3(in->pinch_target, w + 41);
  in->sting = (int)w[44]; c3(in->sting_target, w + 45); in->grab = (int)w[48]; c3(in->grab_target, w + 49); in->ink = w[52] != 0;
  in->has_depth = w[53] != 0; in->depth = w[54]; in->has_height = w[55] != 0; in->height = w[56]; in->climb = w[57] != 0; in->drop = w[58] != 0;
  in->die = (int)w[59]; c3(in->die_impulse, w + 60);
}

CM_API const char *cm_version(void) { return CM_VERSION; }
CM_API int cm_body_size(void) { return (int)sizeof(cm_body); }

CM_API void cm_body_reset(void *body) {
  cm_body *b = (cm_body *)body;
  cm_state_init(&b->S, b->ch, height, b);
  memset(&b->P, 0, sizeof b->P); memset(&b->sk, 0, sizeof b->sk); memset(&b->in, 0, sizeof b->in); memset(b->tally, 0, sizeof b->tally);
  b->in.armed = 1;
  b->has_pose = 0; b->sk_n = 0; b->mount = 0;
}
CM_API int cm_body_init(void *body, const char *character, const double *style) {
  cm_body *b = (cm_body *)body;
  const cm_character *ch = cm_character_find(character);
  if (!ch) return -1;
  memset(b, 0, sizeof *b);
  b->ch = ch;
  b->style = CM_STYLE;
  if (style) { b->style.bounce = style[0]; b->style.stride = style[1]; b->style.arm = style[2]; b->style.lean = style[3]; b->style.step = style[4]; b->style.snap = style[5]; b->style.still = style[6]; }
  cm_body_reset(b);
  return 0;
}
CM_API void cm_body_ground_flat(void *body) { ((cm_body *)body)->ground = 0; }
CM_API int cm_body_ground_waves(void *body, int n, const double *waves, int has_wall, double wall_x, double wall_h) {
  cm_body *b = (cm_body *)body;
  if (n < 0 || n > MAXW) return -1;
  if (n) memcpy(b->w, waves, (size_t)n * 4 * sizeof(double));
  b->nw = n; b->wall = has_wall != 0; b->wx = wall_x; b->wh = wall_h; b->ground = 1;
  return 0;
}
CM_API int cm_body_ground_grid(void *body, double x0, double z0, double cell, int nx, int nz, const double *heights) {
  cm_body *b = (cm_body *)body;
  if (nx < 1 || nz < 1 || !(cell > 0) || !heights) return -1;
  b->gx0 = x0; b->gz0 = z0; b->gcell = cell; b->gnx = nx; b->gnz = nz; b->gh = heights; b->ground = 2;
  return 0;
}
CM_API void cm_body_place(void *body, double x, double z, double heading) {
  cm_body *b = (cm_body *)body;
  cm_place(&b->S, b->ch, height, b, x, z, heading);
  b->sk_n = 0;
}
CM_API int cm_body_step(void *body, const double *in, double dt) {
  cm_body *b = (cm_body *)body;
  int k;
  if (in) cm_input_from_numbers(in, &b->in);
  if (cm_step(&b->S, b->ch, &b->in, &b->style, height, b, dt, &b->P) != 0) return -1;
  for (k = 0; k < b->S.n_events; k++) { int t = b->S.events[k].type; if (t >= 1 && t <= CM_NEV) b->tally[t - 1]++; }
  b->S.n_events = 0;
  b->has_pose = 1; b->sk_n = 0;
  return 0;
}
CM_API int cm_body_call(void *body, int call, const double *args) {
  cm_body *b = (cm_body *)body;
  cm_state *S = &b->S;
  const cm_character *ch = b->ch;
  b->sk_n = 0;
  switch (call) {
    case 1: return cm_enter_swim(S, ch);
    case 2: return cm_leave_swim(S, ch, height, b);
    case 3: return cm_enter_fly(S, ch);
    case 4: return cm_leave_fly(S, ch, height, b);
    case 5:
      if (!args) return -1;
      b->ladder.x = args[0]; b->ladder.y0 = args[1]; b->ladder.spacing = args[2]; b->ladder.rung = rung; b->ladder.user = b->rungs;
      b->rungs[0] = args[1]; b->rungs[1] = args[2]; b->rungs[2] = args[3]; b->rungs[3] = args[4]; b->rungs[4] = args[5];
      return cm_enter_ladder(S, ch, &b->ladder);
    case 6: cm_leave_ladder(S, ch, height, b); return 1;
    case 7: return args ? cm_grab_ledge(S, ch, args) : -1;
    case 8: if (!args) return -1; cm_place(S, ch, height, b, args[0], args[1], args[2]); return 1;
    case 9: cm_stand(S, ch, height, b); return 1;
    case 11: b->mount = 0; return cm_dismount(S, ch, height, b);
  }
  return -1;
}
CM_API int cm_body_mount(void *rider, void *mount) {
  cm_body *r = (cm_body *)rider, *m = (cm_body *)mount;
  int ok = cm_mount_up(&r->S, r->ch, &m->S, m->ch);
  if (ok) r->mount = m;
  r->sk_n = 0;
  return ok;
}
CM_API void cm_body_state(const void *body, double out[8]) {
  const cm_body *b = (const cm_body *)body;
  out[0] = b->S.px; out[1] = b->S.pz; out[2] = b->S.h; out[3] = b->S.v; out[4] = b->S.y; out[5] = b->S.mode;
  out[6] = b->has_pose && b->P.down && b->S.rag.asleep ? 1 : 0; out[7] = b->S.kit;
}
CM_API void cm_body_events(void *body, int *out) {
  cm_body *b = (cm_body *)body;
  memcpy(out, b->tally, sizeof b->tally);
  memset(b->tally, 0, sizeof b->tally);
}
static int skeleton(cm_body *b) {
  if (!b->has_pose) return -1;
  if (!b->sk_n) { int n = cm_skeleton_step(b->ch, &b->P, &b->sk); b->sk_n = n > 0 ? n : -1; }
  return b->sk_n;
}
CM_API const char *cm_body_rig(void *body) {
  cm_body *b = (cm_body *)body;
  return skeleton(b) > 0 ? b->sk.rig->name : "";
}
CM_API int cm_body_joints(void *body, double *out) {
  cm_body *b = (cm_body *)body;
  int n = skeleton(b), j;
  for (j = 0; j < n; j++) { const cm_joint *f = &b->sk.joint[j]; c3(out + 12 * j, f->o); c3(out + 12 * j + 3, f->x); c3(out + 12 * j + 6, f->y); c3(out + 12 * j + 9, f->z); }
  return n;
}
CM_API int cm_body_moves(void *body, double *out) {
  cm_body *b = (cm_body *)body;
  int n = skeleton(b), j;
  for (j = 0; j < n; j++) cm_joint_move(&b->sk, j, out + 16 * j);
  return n;
}
static void framed(const double *f, double x, double y, double z, double *out) {
  if (!f) { out[0] = x; out[1] = y; out[2] = z; return; }
  out[0] = f[0] * x + f[1] * y + f[2] * z + f[9];
  out[1] = f[3] * x + f[4] * y + f[5] * z + f[10];
  out[2] = f[6] * x + f[7] * y + f[8] * z + f[11];
}
CM_API int cm_body_points(void *body, int n, const int *joint, const double *local, const double *frame, double *out) {
  cm_body *b = (cm_body *)body;
  int nj = skeleton(b), k;
  if (nj < 0) return -1;
  for (k = 0; k < n; k++) {
    const double *l = local + 3 * k;
    const cm_joint *f;
    if (joint[k] < 0 || joint[k] >= nj) return -1;
    f = &b->sk.joint[joint[k]];
    framed(frame, f->o[0] + f->x[0] * l[0] + f->y[0] * l[1] + f->z[0] * l[2], f->o[1] + f->x[1] * l[0] + f->y[1] * l[1] + f->z[1] * l[2],
           f->o[2] + f->x[2] * l[0] + f->y[2] * l[1] + f->z[2] * l[2], out + 3 * k);
  }
  return n;
}
CM_API int cm_body_skin(void *body, int n, const double *rest, const int *count, const int *joint, const double *weight,
                        const double *frame, double *out) {
  cm_body *b = (cm_body *)body;
  static const double none[16] = { 0 };
  double m[CM_MAX_JOINTS][16];
  int nj = skeleton(b), k, c, at = 0, j;
  if (nj < 0) return -1;
  for (j = 0; j < nj; j++) cm_joint_move(&b->sk, j, m[j]);
  for (k = 0; k < n; k++) {
    const double *p = rest + 3 * k;
    double x = 0, y = 0, z = 0;
    for (c = 0; c < count[k]; c++, at++) {
      const double *a = joint[at] >= 0 && joint[at] < nj ? m[joint[at]] : none, wgt = weight[at];
      x += wgt * (a[0] * p[0] + a[4] * p[1] + a[8] * p[2] + a[12]);
      y += wgt * (a[1] * p[0] + a[5] * p[1] + a[9] * p[2] + a[13]);
      z += wgt * (a[2] * p[0] + a[6] * p[1] + a[10] * p[2] + a[14]);
    }
    framed(frame, x, y, z, out + 3 * k);
  }
  return n;
}
