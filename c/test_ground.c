/* Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE).
   SPDX-License-Identifier: Apache-2.0

   Plays replays from spec/ground/ through the C ground step and compares with the JavaScript reference.
     test_ground spec/ground/soldier_gaits.txt ... */
#include "clio_motion.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAXW 8
#define MAXV 400
#define MAXLINE 16384

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
static void inputs(const double *v, cm_input *in) {
  memset(in, 0, sizeof *in);
  in->speed = v[0]; in->crouch = v[1]; in->steer = v[2]; in->has_heading = v[3] != 0; in->heading = v[4]; in->dir = v[5]; in->jump = v[6] != 0;
  in->has_hit = v[7] != 0; in->hit[0] = v[8]; in->hit[1] = v[9]; in->hit[2] = v[10];
  in->has_move = v[11] != 0; in->move[0] = v[12]; in->move[1] = v[13];
  in->has_pounce = v[14] != 0; in->has_pounce_target = v[15] != 0; in->pounce_target[0] = v[16]; in->pounce_target[1] = v[17]; in->pounce_target[2] = v[18];
}
static void put3(double *v, int *n, const double *p) { v[(*n)++] = p[0]; v[(*n)++] = p[1]; v[(*n)++] = p[2]; }

/* one replay: returns the number of samples that differ, or -1 if the file cannot be used */
static int play(const char *path, int *samples, double *worst) {
  static char line[MAXLINE];
  static double v[MAXV], got[MAXV];
  FILE *f = fopen(path, "r");
  char id[64], name[64];
  int hz, steps, every, i = 0, k, n, bad = 0, lands = 0, jumps = 0, shown = 0;
  ground g;
  const cm_character *ch;
  cm_state S;
  cm_input in;
  cm_ground_pose P;
  long next_step = -1;
  double pending[32] = { 0 };
  if (!f) return -1;
  if (!fgets(line, MAXLINE, f) || sscanf(line, "# %63s %63s %d %d %d", id, name, &hz, &steps, &every) != 5) { fclose(f); return -1; }
  ch = cm_character_find(name);
  if (!ch || !fgets(line, MAXLINE, f) || line[0] != 'g') { fclose(f); return -1; }
  n = numbers(line + 1, v, MAXV);
  memset(&g, 0, sizeof g);
  g.n = (int)v[0];
  if (g.n > MAXW || n < 4 + 4 * g.n) { fclose(f); return -1; }
  for (k = 0; k < g.n; k++) memcpy(g.w[k], v + 1 + 4 * k, 4 * sizeof(double));
  g.wall = v[1 + 4 * g.n] != 0; g.wx = v[2 + 4 * g.n]; g.wh = v[3 + 4 * g.n];
  cm_state_init(&S, ch, height, &g);
  memset(&in, 0, sizeof in);
  while (i < steps) {
    /* read ahead to the next sample line, taking input changes as their steps come up */
    if (next_step < 0 && fgets(line, MAXLINE, f)) {
      if (line[0] == 'i') { n = numbers(line + 1, v, MAXV); if (n < 20) { fclose(f); return -1; } next_step = (long)v[0]; memcpy(pending, v + 1, 19 * sizeof(double)); }
      else if (line[0] == 'p') next_step = steps + 1;      /* a sample: no more input changes before it */
    }
    if (next_step == i) { inputs(pending, &in); next_step = -1; continue; }
    cm_step_ground(&S, ch, &in, &CM_STYLE, height, &g, 1.0 / hz, &P);
    for (k = 0; k < S.n_events; k++) { if (S.events[k].type == CM_EV_LAND) lands++; else if (S.events[k].type == CM_EV_JUMP) jumps++; }
    S.n_events = 0;
    if (i % every == every - 1) {
      int ng = 0, nw;
      double err = 0;
      if (line[0] != 'p') { fclose(f); return -1; }
      nw = numbers(line + 1, v, MAXV) - 1;
      got[ng++] = S.px; got[ng++] = S.pz; got[ng++] = S.h; got[ng++] = S.x; got[ng++] = S.y; got[ng++] = S.v; got[ng++] = S.a; got[ng++] = S.phase;
      got[ng++] = S.om; got[ng++] = S.crouch; got[ng++] = S.gait.run; got[ng++] = S.gait.gal; got[ng++] = S.g_ref.x; got[ng++] = S.pitch.x;
      got[ng++] = S.reach_drop; got[ng++] = S.hop.x; got[ng++] = S.bank.x; got[ng++] = S.side.x;
      put3(got, &ng, P.root); got[ng++] = P.pitch; got[ng++] = lands; got[ng++] = jumps;
      for (k = 0; k < P.legs; k++) {
        const cm_leg_pose *l = &P.leg[k];
        got[ng++] = l->planted; put3(got, &ng, l->hip); put3(got, &ng, l->knee); put3(got, &ng, l->ankle); put3(got, &ng, l->ball);
        if (l->has_foot) { put3(got, &ng, l->heel); put3(got, &ng, l->toe); }
        if (!l->planted) put3(got, &ng, l->target);
      }
      (*samples)++;
      if (ng != nw || ng != (int)v[0]) { bad++; if (!shown++) printf("%s: sample at step %d has %d values, expected %d\n", id, i + 1, ng, nw); }
      else {
        int at = 0;
        for (k = 0; k < ng; k++) { double e = fabs(got[k] - v[k + 1]) / (1 + fabs(v[k + 1])); if (!(e <= err)) { err = e; at = k; } }
        if (!(err <= 1e-6)) { bad++; if (!shown++) printf("%s: step %d value %d: got %.12g, expected %.12g\n", id, i + 1, at, got[at], v[at + 1]); }
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
  printf("C ground step: %d replays, %d samples, %d replays wrong, largest difference %.3g\n", runs, samples, wrong, worst);
  return wrong || !runs ? 1 : 0;
}
