/* Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE).
   SPDX-License-Identifier: Apache-2.0

   The interface for other languages (cm_body_...), used from C: every call once, on every character, with what
   they give checked against the calls they stand for. python/tests/test_native.py plays the recorded runs
   through the same interface. */
#include "clio_motion.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int bad = 0;
static void check(int ok, const char *what, const char *who) { if (!ok) { bad++; printf("FAIL  %s: %s\n", who, what); } }
static double flat(double x, double z, void *user) { (void)x; (void)z; (void)user; return 0.0; }

int main(void) {
  int c, bodies = 0;
  for (c = 0; c < cm_character_count(); c++) {
    const cm_character *ch = cm_character_at(c);
    void *b = malloc((size_t)cm_body_size());
    static cm_state S; static cm_pose P; static cm_skeleton sk;
    cm_input in;
    double v[CM_NIN], st[8], joints[12 * CM_MAX_JOINTS], moves[16 * CM_MAX_JOINTS], pts[3 * 4], skin[3 * 2];
    double frame[12] = { 0, 0, 2, 2, 0, 0, 0, 2, 0, 5, 6, 7 }, local[12] = { 0, 0, 0, 0.1, 0.2, 0.3, 0, 0, 0, -0.2, 0.1, 0 };
    double rest[6] = { 0.1, 0.9, 0.2, -0.3, 0.4, 0.1 }, weight[3] = { 1.0, 0.25, 0.75 };
    int joint[4] = { 0, 0, 1, 1 }, count[2] = { 1, 2 }, sj[3] = { 0, 0, 1 }, ev[CM_NEV], i, n, lands = 0;
    double worst = 0, m0[16], m1[16], w[3];
    if (!b) return 2;
    check(cm_body_init(b, ch->id, NULL) == 0, "it starts", ch->id);
    cm_state_init(&S, ch, flat, NULL); memset(&sk, 0, sizeof sk);
    memset(v, 0, sizeof v); v[0] = 0.8 * (ch->vmax < 2 ? ch->vmax : 2); v[3] = 1; v[4] = 0.5; v[24] = 1;
    cm_input_from_numbers(v, &in);
    check(cm_body_joints(b, joints) == -1, "no skeleton before a step", ch->id);
    for (i = 0; i < 180; i++) {
      check(cm_body_step(b, i == 0 ? v : NULL, 1.0 / 60) == 0, "a step", ch->id);
      cm_step(&S, ch, &in, &CM_STYLE, flat, NULL, 1.0 / 60, &P); S.n_events = 0;
      cm_body_events(b, ev); lands += ev[CM_EV_LAND - 1];
    }
    cm_body_state(b, st);
    check(fabs(st[0] - S.px) < 1e-12 && fabs(st[1] - S.pz) < 1e-12 && fabs(st[2] - S.h) < 1e-12 && fabs(st[3] - S.v) < 1e-12 && st[5] == S.mode && st[0] > 0.3, "it is where the plain step puts it", ch->id);
    check(lands > 0, "its feet were put down", ch->id);
    n = cm_skeleton_step(ch, &P, &sk);
    check(cm_body_joints(b, joints) == n && cm_body_moves(b, moves) == n && n > 1 && !strcmp(cm_body_rig(b), sk.rig->name), "its skeleton is the pose's", ch->id);
    for (i = 0; i < n; i++) { int k; for (k = 0; k < 3; k++) { double d = fabs(joints[12 * i + k] - sk.joint[i].o[k]); if (d > worst) worst = d; d = fabs(joints[12 * i + 6 + k] - sk.joint[i].y[k]); if (d > worst) worst = d; } }
    check(worst < 1e-12, "joint for joint", ch->id);
    check(cm_body_points(b, 4, joint, local, NULL, pts) == 4 && fabs(pts[0] - sk.joint[0].o[0]) < 1e-12 && fabs(pts[7] - sk.joint[1].o[1]) < 1e-12, "a point at a joint is the joint", ch->id);
    check(cm_body_points(b, 4, joint, local, frame, pts) == 4 && fabs(pts[0] - (2 * sk.joint[0].o[2] + 5)) < 1e-12 && fabs(pts[1] - (2 * sk.joint[0].o[0] + 6)) < 1e-12 && fabs(pts[2] - (2 * sk.joint[0].o[1] + 7)) < 1e-12, "and through a frame", ch->id);
    joint[3] = n;
    check(cm_body_points(b, 4, joint, local, NULL, pts) == -1, "a joint the rig has not is refused", ch->id);
    cm_joint_move(&sk, 0, m0); cm_joint_move(&sk, 1, m1);
    for (i = 0; i < 3; i++) w[i] = 0.25 * (m0[i] * rest[3] + m0[4 + i] * rest[4] + m0[8 + i] * rest[5] + m0[12 + i]) + 0.75 * (m1[i] * rest[3] + m1[4 + i] * rest[4] + m1[8 + i] * rest[5] + m1[12 + i]);
    check(cm_body_skin(b, 2, rest, count, sj, weight, NULL, skin) == 2 && fabs(skin[3] - w[0]) < 1e-12 && fabs(skin[4] - w[1]) < 1e-12 && fabs(skin[5] - w[2]) < 1e-12, "a skin's corner is its joints' moves, weighed", ch->id);
    /* knocked down, it falls and lies; stood up, it stands */
    memset(v, 0, sizeof v); v[78] = 1;
    cm_body_step(b, v, 1.0 / 60); v[78] = 0; cm_body_step(b, v, 1.0 / 60);
    for (i = 0; i < 600; i++) cm_body_step(b, NULL, 1.0 / 60);
    cm_body_state(b, st);
    check(st[5] == 2 && st[6] == 1, "knocked down it lies still", ch->id);
    check(cm_body_call(b, 9, NULL) == 1 && (cm_body_step(b, NULL, 1.0 / 60), cm_body_state(b, st), st[5] == 0), "and stands again", ch->id);
    /* a ground as a grid: it stands on it */
    {
      double grid[6] = { 1.0, 1.0, 1.0, 2.0, 2.0, 2.0 };
      check(cm_body_ground_grid(b, -5, -5, 10, 3, 2, grid) == 0 && cm_body_ground_grid(b, 0, 0, 0, 3, 2, grid) == -1, "a grid is taken, one of no size refused", ch->id);
      cm_body_reset(b); cm_body_step(b, NULL, 1.0 / 60); cm_body_state(b, st);
      check(st[4] > 1.4 && st[4] < 1.6 + 3 * ch->L, "on a ground one and a half up it stands one and a half up", ch->id);
      cm_body_ground_flat(b); cm_body_reset(b);
    }
    check(cm_body_ground_waves(b, 9, local, 0, 0, 0) == -1, "nine waves are too many", ch->id);
    free(b); bodies++;
  }
  {
    void *r = malloc((size_t)cm_body_size()), *h = malloc((size_t)cm_body_size());
    double st[8];
    int i;
    check(cm_body_init(r, "soldier", NULL) == 0 && cm_body_init(h, "horse", NULL) == 0 && cm_body_init(r, "unicorn", NULL) == -1, "who is there starts, who is not does not", "riding");
    cm_body_init(r, "soldier", NULL);
    check(cm_body_mount(r, h) == 1, "the soldier mounts the horse", "riding");
    for (i = 0; i < 60; i++) { cm_body_step(h, NULL, 1.0 / 60); cm_body_step(r, NULL, 1.0 / 60); }
    cm_body_state(r, st);
    check(st[5] == 6, "and rides", "riding");
    check(cm_body_call(r, 11, NULL) == 1 && (cm_body_step(r, NULL, 1.0 / 60), cm_body_state(r, st), st[5] == 0), "and gets down", "riding");
    free(r); free(h);
  }
  printf("C interface for other languages (%s): %d characters, %d wrong\n", cm_version(), bodies, bad);
  return bad ? 1 : 0;
}
