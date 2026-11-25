/* Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE).
   SPDX-License-Identifier: Apache-2.0

   Shared between the library's own source files. Not part of the interface. */
#ifndef CLIO_MOTION_INTERNAL_H
#define CLIO_MOTION_INTERNAL_H
#include "clio_motion.h"

/* the body's frame for one step: live place and local x from the state, heading fixed after the turn */
typedef struct { const cm_state *s; double hc, hs; cm_terrain_fn fn; void *user; } cm_frame;

static inline void cm_to_w(const cm_frame *f, const double p[3], double o[3]) {
  double x = p[0] - f->s->x, z = p[2];
  o[0] = f->s->px + x * f->hc - z * f->hs; o[1] = p[1]; o[2] = f->s->pz + x * f->hs + z * f->hc;
}
static inline void cm_to_l(const cm_frame *f, const double p[3], double o[3]) {
  double x = p[0] - f->s->px, z = p[2] - f->s->pz;
  o[0] = f->s->x + x * f->hc + z * f->hs; o[1] = p[1]; o[2] = -x * f->hs + z * f->hc;
}
/* ground height under a point given in the body's frame */
static inline double cm_ter(const cm_frame *f, double lx, double lz) {
  const cm_state *s = f->s;
  return f->fn(s->px + (lx - s->x) * f->hc - lz * f->hs, s->pz + (lx - s->x) * f->hs + lz * f->hc, f->user);
}

/* what the ground step hands to the upper body */
typedef struct {
  cm_frame fr;
  double root[3], pitch, Tn, idle, P, bank, sway0, flex, prep, lean_base, aim[3], drift[2];
  double hip[CM_MAX_LEGS][3], knee[CM_MAX_LEGS][3], ankle[CM_MAX_LEGS][3];      /* the legs in the body's frame */
  int has_aim, leg0_side;
  cm_gait_params gp;
} cm_bctx;

void cm_ground_core(cm_state *S, const cm_character *ch, const cm_input *inp, const cm_style *st, cm_terrain_fn terrain, void *user, double dt, cm_ground_pose *out, cm_bctx *B);
void cm_event_push(cm_state *s, const cm_event *e);
void cm_kit_fill(cm_state *s);                 /* full magazines for the kit in hand */

#endif
