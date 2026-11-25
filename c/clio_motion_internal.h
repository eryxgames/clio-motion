/* Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE).
   SPDX-License-Identifier: Apache-2.0

   Shared between the library's own source files. Not part of the interface. */
#ifndef CLIO_MOTION_INTERNAL_H
#define CLIO_MOTION_INTERNAL_H
#include "clio_motion.h"

/* a rider's seat in the mount's frame: forward along the mount, up from its back, to its right */
typedef struct { double o[3], ax[3], up[3], sv[3]; } cm_seat;
/* the body's frame for one step: live place and local x from the state, heading fixed after the turn.
   seat: a rider works in the seat's frame, which sits in the mount's (then there is no ground under him) */
typedef struct { const cm_state *s; double hc, hs; cm_terrain_fn fn; void *user; const cm_seat *seat; } cm_frame;

static inline void cm_to_w(const cm_frame *f, const double p[3], double o[3]) {
  double x, y = p[1], z = p[2];
  if (f->seat) {
    const cm_seat *q = f->seat;
    x = q->o[0] + q->ax[0] * p[0] + q->up[0] * p[1] + q->sv[0] * p[2] - f->s->x;
    y = q->o[1] + q->ax[1] * p[0] + q->up[1] * p[1] + q->sv[1] * p[2];
    z = q->o[2] + q->ax[2] * p[0] + q->up[2] * p[1] + q->sv[2] * p[2];
  } else x = p[0] - f->s->x;
  o[0] = f->s->px + x * f->hc - z * f->hs; o[1] = y; o[2] = f->s->pz + x * f->hs + z * f->hc;
}
static inline void cm_to_l(const cm_frame *f, const double p[3], double o[3]) {
  double x = p[0] - f->s->px, z = p[2] - f->s->pz;
  o[0] = f->s->x + x * f->hc + z * f->hs; o[1] = p[1]; o[2] = -x * f->hs + z * f->hc;
  if (f->seat) {
    const cm_seat *q = f->seat;
    double d0 = o[0] - q->o[0], d1 = o[1] - q->o[1], d2 = o[2] - q->o[2];
    o[0] = d0 * q->ax[0] + d1 * q->ax[1] + d2 * q->ax[2]; o[1] = d0 * q->up[0] + d1 * q->up[1] + d2 * q->up[2]; o[2] = d0 * q->sv[0] + d1 * q->sv[1] + d2 * q->sv[2];
  }
}
/* ground height under a point given in the body's frame */
static inline double cm_ter(const cm_frame *f, double lx, double lz) {
  const cm_state *s = f->s;
  if (f->seat) return -1e9;
  return f->fn(s->px + (lx - s->x) * f->hc - lz * f->hs, s->pz + (lx - s->x) * f->hs + lz * f->hc, f->user);
}

/* what the ground step hands to the upper body */
typedef struct {
  cm_frame fr;
  double root[3], pitch, Tn, idle, P, bank, sway0, flex, prep, lean_base, aim[3], drift[2];
  double hip[CM_MAX_LEGS][3], knee[CM_MAX_LEGS][3], ankle[CM_MAX_LEGS][3];      /* the legs in the body's frame */
  int has_aim, leg0_side, has_hands;
  double hands[2][3];                          /* reins or handles for hands with nothing else to do */
  double fly_ax[3], fly_up[3];                 /* in the air: the body's long axis and its up, before the back's own lean */
  cm_gait_params gp;
} cm_bctx;

void cm_ground_core(cm_state *S, const cm_character *ch, const cm_input *inp, const cm_style *st, cm_terrain_fn terrain, void *user, double dt, cm_ground_pose *out, cm_bctx *B);
void cm_event_push(cm_state *s, const cm_event *e);
void cm_kit_fill(cm_state *s);                 /* full magazines for the kit in hand */

#endif
