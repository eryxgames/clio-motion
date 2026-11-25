/* Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE).
   SPDX-License-Identifier: Apache-2.0

   Plays replays from spec/body/ through the whole C step (legs, upper body, weapons, actions) and compares every
   number of the pose, the count of each event and the sum of what the events carried, with the JavaScript reference.
     test_body spec/body/soldier_rifle.txt ... */
#include "clio_motion.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAXW 8
#define MAXV 900
#define MAXLINE 20000
#define NIN 72

typedef struct { int n; double w[MAXW][4]; int wall; double wx, wh; } ground;

static double height(double x, double z, void *user) {
  const ground *g = (const ground *)user;
  double y = 0;
  int i;
  for (i = 0; i < g->n; i++) y += g->w[i][0] * sin(g->w[i][1] * x + g->w[i][2] * z + g->w[i][3]);
  return y + (g->wall && x > g->wx ? g->wh : 0);
}
static int numbers(char *p, double *v, int most) {
  int n = 0;
  char *e;
  for (;;) { double x = strtod(p, &e); if (e == p || n >= most) break; v[n++] = x; p = e; }
  return n;
}
static void c3(double *d, const double *s) { d[0] = s[0]; d[1] = s[1]; d[2] = s[2]; }
static void inputs(const double *v, cm_input *in) {
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
}
static void put3(double *v, int *n, const double *p) { v[(*n)++] = p[0]; v[(*n)++] = p[1]; v[(*n)++] = p[2]; }

/* every number of the pose in the order the reference writes them: keys in alphabetical order at every level */
static int flatten(const cm_pose *P, double *v) {
  int n = 0, i, j, b = P->body, up = b == CM_BODY_BIPED || b == CM_BODY_MECH, hd = b == CM_BODY_BIPED || b == CM_BODY_BEAST || b == CM_BODY_QUAD;
  if (b == CM_BODY_BEAST) v[n++] = P->alert;
  if (b == CM_BODY_BIPED) for (i = 0; i < 2; i++) { put3(v, &n, P->arm[i].elbow); put3(v, &n, P->arm[i].hand); put3(v, &n, P->arm[i].shoulder); v[n++] = P->arm[i].side; }
  for (i = 0; i < P->n_arms; i++) for (j = 0; j < 7; j++) put3(v, &n, P->arms[i][j]);
  if (!up) { put3(v, &n, P->axis); put3(v, &n, P->back); }
  if (P->has_carry) { put3(v, &n, P->carry.c); put3(v, &n, P->carry.f); v[n++] = P->carry.held; put3(v, &n, P->carry.side); put3(v, &n, P->carry.size); put3(v, &n, P->carry.u); }
  if (up) put3(v, &n, P->chest);
  for (i = 0; i < P->n_claws; i++) {
    const cm_claw_pose *c = &P->claw[i];
    put3(v, &n, c->elbow); put3(v, &n, c->finger_a); put3(v, &n, c->finger_b); v[n++] = c->open; put3(v, &n, c->shoulder); v[n++] = c->side; put3(v, &n, c->tip); put3(v, &n, c->wrist);
  }
  v[n++] = P->base.crouch;
  if (b == CM_BODY_OCTO || b == CM_BODY_ARTHRO || b == CM_BODY_SPIDER) { put3(v, &n, P->dome); put3(v, &n, P->eye); }
  if (up) put3(v, &n, P->f);
  if (b == CM_BODY_BEAST) v[n++] = P->flex;
  if (!up) put3(v, &n, P->front);
  if (hd) put3(v, &n, P->gaze);
  if (b == CM_BODY_BIPED) { v[n++] = P->grenade_held; put3(v, &n, P->grenade); }
  if (hd) put3(v, &n, P->head);
  v[n++] = P->base.heading;
  if (b == CM_BODY_BEAST) v[n++] = P->jaw;
  v[n++] = P->lean;
  for (i = 0; i < P->base.legs; i++) {
    const cm_leg_pose *l = &P->base.leg[i];
    put3(v, &n, l->ankle); put3(v, &n, l->ball); if (l->has_foot) put3(v, &n, l->heel);
    put3(v, &n, l->hip); put3(v, &n, l->knee); v[n++] = l->planted; v[n++] = l->side;
    if (!l->planted) put3(v, &n, l->target);
    if (l->has_foot) put3(v, &n, l->toe);
  }
  if (P->has_mantle) { put3(v, &n, P->mantle_c); v[n++] = P->mantle_r; put3(v, &n, P->mantle_tip); }
  for (i = 0; i < P->n_mounts; i++) { const cm_mount_pose *m = &P->mount[i]; put3(v, &n, m->base); put3(v, &n, m->dir); v[n++] = m->flash; put3(v, &n, m->joint); v[n++] = m->side; put3(v, &n, m->tip); }
  if (b == CM_BODY_BEAST || b == CM_BODY_QUAD) put3(v, &n, P->neck);
  v[n++] = P->pack; v[n++] = P->base.pitch;
  for (i = 0; i < P->n_props; i++) {
    const cm_prop_pose *w = &P->prop[i];
    put3(v, &n, w->body); put3(v, &n, w->dir); v[n++] = w->flash; if (w->has_fore) put3(v, &n, w->fore);
    put3(v, &n, w->grip); put3(v, &n, w->grip_low); put3(v, &n, w->mag_a); put3(v, &n, w->mag_b); put3(v, &n, w->muzzle); put3(v, &n, w->o); v[n++] = w->stow; put3(v, &n, w->up);
  }
  put3(v, &n, P->base.root);
  if (up || hd) put3(v, &n, P->side);
  if (!up && b != CM_BODY_SPIDER) put3(v, &n, P->tail);
  for (i = 0; i < P->n_tail_pts; i++) put3(v, &n, P->tail_pts[i]);
  if (P->has_thorax) { put3(v, &n, P->thorax[0]); put3(v, &n, P->thorax[1]); }
  if (up) put3(v, &n, P->u); else put3(v, &n, P->up);
  for (i = 0; i < P->n_wings; i++) { const cm_wing_pose *w = &P->wing[i]; v[n++] = w->chord; put3(v, &n, w->mid); put3(v, &n, w->root); v[n++] = w->side; put3(v, &n, w->t1); put3(v, &n, w->t2); put3(v, &n, w->tip); }
  return n;
}
static int tally_slot(int type) {
  switch (type) {
    case CM_EV_FIRE: return 0; case CM_EV_RELOAD: return 1; case CM_EV_LOADED: return 2; case CM_EV_THROW: return 3; case CM_EV_GRAB: return 4; case CM_EV_PUTDOWN: return 5;
    case CM_EV_PUNCH: return 6; case CM_EV_STRIKE: return 7; case CM_EV_LAND: return 8; case CM_EV_JUMP: return 9; case CM_EV_HIT: return 10; case CM_EV_DROP: return 11;
    case CM_EV_BITE: return 12; case CM_EV_POUNCE: return 13; case CM_EV_PINCH: return 14; case CM_EV_STING: return 15; case CM_EV_INK: return 16;
  }
  return -1;
}

/* the sum of every number an event carries, as the reference adds them up */
static double carried(const cm_event *e) {
  double s3 = 0;
  switch (e->type) {
    case CM_EV_LAND: return e->leg + e->x + e->y + e->z + e->hd + e->side;
    case CM_EV_FIRE: case CM_EV_RELOAD: case CM_EV_LOADED: return e->gun;
    case CM_EV_THROW: s3 = e->pos[0] + e->pos[1] + e->pos[2] + e->vel[0] + e->vel[1] + e->vel[2] + e->point[0] + e->point[1] + e->point[2]; return s3;
    case CM_EV_PUTDOWN: return e->pos[0] + e->pos[1] + e->pos[2] + e->hd;
    case CM_EV_PUNCH: return e->hand + e->pos[0] + e->pos[1] + e->pos[2] + e->vel[0] + e->vel[1] + e->vel[2] + e->miss;
    case CM_EV_STRIKE: return e->pos[0] + e->pos[1] + e->pos[2] + e->point[0] + e->point[1] + e->point[2] + e->vel[0] + e->vel[1] + e->vel[2];
    case CM_EV_BITE: return e->pos[0] + e->pos[1] + e->pos[2] + e->vel[0] + e->vel[1] + e->vel[2] + e->miss;
    case CM_EV_POUNCE: return e->pos[0] + e->pos[1] + e->pos[2];
    case CM_EV_PINCH: case CM_EV_GRAB: return e->pos[0] + e->pos[1] + e->pos[2] + e->hand + e->miss;
    case CM_EV_STING: return e->pos[0] + e->pos[1] + e->pos[2] + e->miss;
    case CM_EV_INK: return e->pos[0] + e->pos[1] + e->pos[2] + e->vel[0] + e->vel[1] + e->vel[2];
  }
  return s3;
}

static int play(const char *path, int *samples, double *worst) {
  static char line[MAXLINE];
  static double v[MAXV], got[MAXV];
  static cm_state S;
  static cm_pose P;
  FILE *f = fopen(path, "r");
  char id[64], name[64];
  int hz, steps, every, i = 0, k, n, bad = 0, shown = 0, tally[17];
  ground g;
  const cm_character *ch;
  cm_input in;
  long next_step = -1;
  double pending[NIN] = { 0 }, evsum = 0;
  if (!f) return -1;
  if (!fgets(line, MAXLINE, f) || sscanf(line, "# %63s %63s %d %d %d", id, name, &hz, &steps, &every) != 5) { fclose(f); return -1; }
  ch = cm_character_find(name);
  if (!ch || !fgets(line, MAXLINE, f) || line[0] != 'g') { fclose(f); return -1; }
  n = numbers(line + 1, v, MAXV);
  memset(&g, 0, sizeof g); memset(tally, 0, sizeof tally);
  g.n = (int)v[0];
  if (g.n > MAXW || n < 4 + 4 * g.n) { fclose(f); return -1; }
  for (k = 0; k < g.n; k++) memcpy(g.w[k], v + 1 + 4 * k, 4 * sizeof(double));
  g.wall = v[1 + 4 * g.n] != 0; g.wx = v[2 + 4 * g.n]; g.wh = v[3 + 4 * g.n];
  cm_state_init(&S, ch, height, &g);
  memset(&in, 0, sizeof in);
  while (i < steps) {
    if (next_step < 0 && fgets(line, MAXLINE, f)) {
      if (line[0] == 'i') { n = numbers(line + 1, v, MAXV); if (n < NIN + 1) { fclose(f); return -1; } next_step = (long)v[0]; memcpy(pending, v + 1, NIN * sizeof(double)); }
      else if (line[0] == 'p') next_step = steps + 1;
    }
    if (next_step == i) { inputs(pending, &in); next_step = -1; continue; }
    if (cm_step(&S, ch, &in, &CM_STYLE, height, &g, 1.0 / hz, &P) != 0) { fclose(f); return -1; }
    for (k = 0; k < S.n_events; k++) { int t = tally_slot(S.events[k].type); if (t >= 0) tally[t]++; evsum += carried(&S.events[k]); }
    S.n_events = 0;
    if (i % every == every - 1) {
      int ng, nw;
      double err = 0;
      if (line[0] != 'p') { fclose(f); return -1; }
      nw = numbers(line + 1, v, MAXV) - 1;
      ng = flatten(&P, got);
      for (k = 0; k < 17; k++) got[ng++] = tally[k];
      got[ng++] = evsum;
      (*samples)++;
      if (ng != nw || ng != (int)v[0]) { bad++; if (!shown++) printf("%s: sample at step %d has %d values, expected %d\n", id, i + 1, ng, nw); }
      else {
        int at = 0;
        for (k = 0; k < ng; k++) { double e = fabs(got[k] - v[k + 1]) / (1 + fabs(v[k + 1])); if (!(e <= err)) { err = e; at = k; } }
        if (!(err <= 1e-6)) { bad++; if (!shown++) printf("%s: step %d value %d of %d: got %.12g, expected %.12g\n", id, i + 1, at, ng, got[at], v[at + 1]); }
        else if (err > *worst) *worst = err;
      }
      next_step = -1;
    }
    i++;
  }
  fclose(f);
  return bad;
}

int main(int argc, char **argv) {
  int a, runs = 0, wrong = 0, samples = 0;
  double worst = 0;
  for (a = 1; a < argc; a++) {
    int bad = play(argv[a], &samples, &worst);
    runs++;
    if (bad < 0) { printf("%s: cannot be read\n", argv[a]); wrong++; }
    else if (bad) wrong++;
  }
  printf("C whole body: %d replays, %d samples, %d replays wrong, largest difference %.3g\n", runs, samples, wrong, worst);
  return wrong || !runs ? 1 : 0;
}
