/* SPDX-License-Identifier: Apache-2.0
   Copyright 2026 Daniel Sandner

   A character drawn live in 2D from C: the core steps, the skeleton says where the joints are, the parts they carry
   are drawn back to front. Writes a strip of moments as one SVG file, the same file python/examples/live2d_svg.py
   writes.

       cc -std=c99 -O2 -ffp-contract=off -I.. live2d_svg.c ../libclio_motion.a -lm -o live2d_svg
       ./live2d_svg soldier soldier_live.svg

   A game does the same every frame, with its own drawing calls in place of the SVG text. */
#include "clio_motion.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

static double ground(double x, double z, void *user) { (void)z; (void)user; return 0.12 * sin(0.6 * x); }

/* the part's colour at a shade level (0 dark .. 4 light; -1: as it is) */
static void shade(unsigned color, int level, int rgb[3]) {
  double f = level < 0 ? 1.0 : 0.6 + 0.1 * level; int i;
  for (i = 0; i < 3; i++) rgb[i] = (int)floor(((color >> (16 - 8 * i)) & 255) * f + 0.5);
}

int main(int argc, char **argv) {
  const char *name = argc > 1 ? argv[1] : "soldier";
  const cm_character *ch = cm_character_find(name);
  static cm_state S; static cm_pose pose; static cm_skeleton sk; static cm_part parts[CM_MAX_PARTS];
  int order[CM_MAX_PARTS], step, moments = 6, cell = 330, n = 0;
  double ppm = 0.0, speed;                           /* ppm: pixels to a metre, set at the first moment to fit the body */
  char path[256];
  FILE *f;
  if (!ch) { fprintf(stderr, "no character called %s\n", name); return 2; }
  if (argc > 2) snprintf(path, sizeof path, "%s", argv[2]); else snprintf(path, sizeof path, "%s_live.svg", name);
  f = fopen(path, "w");
  if (!f) { fprintf(stderr, "cannot write %s\n", path); return 2; }
  speed = fmin(ch->vmax, 1.5 * sqrt(ch->L / 0.92));
  cm_state_init(&S, ch, ground, NULL);
  memset(&sk, 0, sizeof sk);                        /* once, before its first use */
  fprintf(f, "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"%d\" height=\"300\" viewBox=\"0 0 %d 300\"><rect width=\"100%%\" height=\"100%%\" fill=\"#f6f6f3\"/>\n", cell * moments, cell * moments);
  for (step = 0; step < 60 * moments; step++) {
    cm_input in; int k = step / 60, i, x; double ox, oy = 250, g0;
    memset(&in, 0, sizeof in);
    in.speed = step < 60 * (moments - 1) ? speed : 0.0; in.armed = 1;
    if (step == 60 * (moments - 1) + 20) in.die = 1;            /* the last moment: knocked down */
    cm_step(&S, ch, &in, &CM_STYLE, ground, NULL, 1.0 / 60, &pose);
    S.n_events = 0;
    if (step % 60 != 59) continue;
    /* where the joints are, the parts they carry, and the order to draw them in for a view from the side */
    cm_skeleton_step(ch, &pose, &sk);
    n = cm_skeleton_parts(&sk, parts);
    cm_parts_order(parts, n, sk.heading, 0.0, order);
    ox = cell * k + cell / 2.0; g0 = ground(S.px, 0, NULL);
    if (ppm == 0.0) {
      double x0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (i = 0; i < n; i++) {
        const cm_part *q = &parts[i]; double r = q->def->r; int e;
        for (e = 0; e <= q->def->has_b; e++) { const double *p = e ? q->b : q->a; x0 = fmin(x0, p[0] - r); x1 = fmax(x1, p[0] + r); y1 = fmax(y1, p[1] + r); }
      }
      ppm = fmin(150.0, fmin(290.0 / (x1 - x0), 215.0 / (y1 - g0)));
    }
    fprintf(f, "<polyline points=\"");
    for (x = cell * k; x <= cell * (k + 1); x += 10) fprintf(f, "%s%.1f,%.1f", x > cell * k ? " " : "", (double)x, oy - (ground(S.px + (x - ox) / ppm, 0, NULL) - g0) * ppm);
    fprintf(f, "\" fill=\"none\" stroke=\"#b4b8b0\"/>\n");
    for (i = 0; i < n; i++) {
      const cm_part *q = &parts[order[i]]; int rgb[3];
      double ax = ox + (q->a[0] - S.px) * ppm, ay = oy - (q->a[1] - g0) * ppm, r = fmax(q->def->r * ppm, 0.6);
      shade(q->def->color, q->level, rgb);
      if (q->def->has_b)
        fprintf(f, "<line x1=\"%.1f\" y1=\"%.1f\" x2=\"%.1f\" y2=\"%.1f\" stroke=\"rgb(%d,%d,%d)\" stroke-width=\"%.1f\" stroke-linecap=\"%s\"/>\n", ax, ay,
          ox + (q->b[0] - S.px) * ppm, oy - (q->b[1] - g0) * ppm, rgb[0], rgb[1], rgb[2], 2 * r, q->def->sq ? "butt" : "round");
      else
        fprintf(f, "<circle cx=\"%.1f\" cy=\"%.1f\" r=\"%.1f\" fill=\"rgb(%d,%d,%d)\"/>\n", ax, ay, r, rgb[0], rgb[1], rgb[2]);
    }
  }
  fprintf(f, "</svg>\n");
  fclose(f);
  printf("%s: %d moments of the %s, %d joints, %d parts\n", path, moments, name, sk.n, n);
  return 0;
}
