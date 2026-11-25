/* Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE).
   SPDX-License-Identifier: Apache-2.0

   Runs the C kernel over spec/kernel_vectors.txt and compares with what the JavaScript reference gave.
     test_kernel spec/kernel_vectors.txt */
#include "clio_motion.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAXV 256

int main(int argc, char **argv) {
  FILE *f = fopen(argc > 1 ? argv[1] : "spec/kernel_vectors.txt", "r");
  char name[32];
  static double in[MAXV], want[MAXV], got[MAXV];
  int ni, no, i, k, cases = 0, bad = 0, unknown = 0;
  double worst = 0, tol = 1e-9;
  if (!f) { fprintf(stderr, "cannot open the vectors file\n"); return 2; }
  while (fscanf(f, "%31s %d", name, &ni) == 2) {
    int ng = 0;
    if (ni > MAXV) return 2;
    for (i = 0; i < ni; i++) if (fscanf(f, "%lf", &in[i]) != 1) return 2;
    if (fscanf(f, "%d", &no) != 1 || no > MAXV) return 2;
    for (i = 0; i < no; i++) if (fscanf(f, "%lf", &want[i]) != 1) return 2;
    if (!strcmp(name, "smooth")) { got[0] = cm_smooth(in[0], in[1], in[2]); ng = 1; }
    else if (!strcmp(name, "decay")) { got[0] = cm_decay(in[0], in[1]); ng = 1; }
    else if (!strcmp(name, "ease")) { got[0] = cm_ease(in[0], in[1]); ng = 1; }
    else if (!strcmp(name, "wrapPi")) { got[0] = cm_wrap_pi(in[0]); ng = 1; }
    else if (!strcmp(name, "idleNoise")) { got[0] = cm_idle_noise(in[0], in[1], in[2]); ng = 1; }
    else if (!strcmp(name, "spring50")) {
      cm_spring s; s.x = in[0]; s.v = in[1];
      for (k = 0; k < 50; k++) cm_spring_step(&s, in[2], in[3], in[4], in[5]);
      got[0] = s.x; got[1] = s.v; ng = 2;
    }
    else if (!strcmp(name, "ik2")) { cm_ik2(in, in + 3, in[6], in[7], in + 8, got, got + 3); ng = 6; }
    else if (!strcmp(name, "lob")) { cm_lob(in, in + 3, in[6], got); ng = 3; }
    else if (!strcmp(name, "reachChain")) {
      int n = (int)in[0];
      if (n < 1 || n > 15) return 2;
      double pts[16][3];
      memcpy(pts, in + 8, sizeof(double) * 3 * (size_t)(n + 1));
      cm_reach_chain(pts, n, in + 2, in + 5, in[1], 0);
      memcpy(got, pts, sizeof(double) * 3 * (size_t)(n + 1)); ng = 3 * (n + 1);
    }
    else if (!strcmp(name, "gait6")) {
      cm_gait_config c; cm_gait_state s; cm_gait_params o;
      const double *p = in;
      memset(&c, 0, sizeof c);
      c.L = *p++; c.crouch_drop = *p++; c.run_stride = *p++; c.fr_run = *p++; c.fr_max = *p++; c.legs = (int)*p++;
      for (i = 0; i < c.legs; i++) c.walk.phases[i] = *p++;
      c.walk.duty[0] = *p++; c.walk.duty[1] = *p++;
      c.has_run = (int)*p++;
      if (c.has_run) { for (i = 0; i < c.legs; i++) c.run.phases[i] = *p++; c.run.duty[0] = *p++; c.run.duty[1] = *p++; }
      c.has_gallop = (int)*p++;
      if (c.has_gallop) { for (i = 0; i < c.legs; i++) c.gallop.phases[i] = *p++; c.gallop.duty[0] = *p++; c.gallop.duty[1] = *p++; c.gallop_fr = *p++; c.gallop_fr_max = *p++; }
      {
        double crouch = p[0], v = p[1], stride = p[6], dt = p[7];
        s.run_want = (int)p[2]; s.run = p[3]; s.gal_want = (int)p[4]; s.gal = p[5];
        for (k = 0; k < 6; k++) cm_gait_params_step(&c, &s, v, crouch, stride, dt, &o);
      }
      got[0] = o.Leff; got[1] = o.Tn; got[2] = o.Fr; got[3] = o.run; got[4] = o.stride; got[5] = o.period; got[6] = o.duty;
      got[7] = o.moving; got[8] = o.Aw; got[9] = o.Ar; got[10] = o.gal; got[11] = s.run_want; got[12] = s.gal_want;
      for (i = 0; i < c.legs; i++) got[13 + i] = o.phases[i];
      ng = 13 + c.legs;
    }
    else { unknown++; continue; }
    cases++;
    if (ng != no) { bad++; printf("%s: %d values, expected %d\n", name, ng, no); continue; }
    for (i = 0; i < no; i++) {
      double e = fabs(got[i] - want[i]) / (1 + fabs(want[i]));
      if (!(e <= tol)) { if (bad < 10) printf("%s value %d: got %.17g, expected %.17g\n", name, i, got[i], want[i]); bad++; break; }
      if (e > worst) worst = e;
    }
  }
  fclose(f);
  printf("C kernel: %d cases, %d wrong, %d not known, largest difference %.3g\n", cases, bad, unknown, worst);
  return bad || unknown || !cases ? 1 : 0;
}
