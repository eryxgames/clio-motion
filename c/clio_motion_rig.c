/* Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE).
   SPDX-License-Identifier: Apache-2.0

   CLIo Motion, stage 5a: the skeleton, live. Joints from a pose, the parts they carry, their draw order, and the
   move of each joint from the template pose. A port of the joints js/rig.js declares and of liveSkeleton, liveParts
   and jointMove in js/bake.js; checked against the numbers in spec/skeleton/. */
#include "clio_motion.h"
#include <math.h>
#include <string.h>

static void set3(double o[3], double x, double y, double z) { o[0] = x; o[1] = y; o[2] = z; }
static void copy3(double o[3], const double a[3]) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; }
static void cross3(const double a[3], const double b[3], double o[3]) { set3(o, a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]); }
static void unit_of(const double a[3], const double b[3], double o[3]) {          /* the direction from b to a */
  double x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2], l = sqrt(x * x + y * y + z * z);
  if (l == 0) l = 1;
  set3(o, x / l, y / l, z / l);
}

const cm_rig *cm_rig_for(const cm_character *ch, const cm_pose *pose) {
  int kit = CM_KIT_NONE, i;
  if (ch->mount_type == CM_MOUNT_HELD) {
    kit = ch->mount_civil ? CM_KIT_HANDS : CM_KIT_RIFLE;
    for (i = 0; i < pose->n_props; i++) if (pose->prop[i].kind == CM_PROP_PISTOL && kit != CM_KIT_SWORD) kit = CM_KIT_PISTOLS; else if (pose->prop[i].kind == CM_PROP_SWORD) kit = CM_KIT_SWORD;
      else if (pose->prop[i].kind == CM_PROP_CASE) kit = CM_KIT_CASE; else if (pose->prop[i].kind == CM_PROP_TROLLEY) kit = CM_KIT_TROLLEY;
    for (i = 0; i < pose->n_props; i++) if (pose->prop[i].kind == CM_PROP_SIDEGUN) kit = CM_KIT_CHAINGUNS; else if (pose->prop[i].kind == CM_PROP_CHAINGUN) kit = CM_KIT_CHAINGUN;
      else if (pose->prop[i].kind == CM_PROP_SHOTGUN) kit = CM_KIT_SHOTGUN; else if (pose->prop[i].kind == CM_PROP_LAUNCHER) kit = CM_KIT_RPG; else if (pose->prop[i].kind == CM_PROP_FLAMER) kit = CM_KIT_FLAMER;
  }
  for (i = 0; i < cm_rig_count(); i++) { const cm_rig *r = cm_rig_at(i); if (!strcmp(r->id, ch->id) && r->kit == kit) return r; }
  return 0;
}

/* the joints as the rig declares them: where each is, the point its bone aims at, and its own side if it has one */
typedef struct { int n; double o[CM_MAX_JOINTS][3], aim[CM_MAX_JOINTS][3], side[CM_MAX_JOINTS][3]; int own[CM_MAX_JOINTS]; } decl;
static void add(decl *D, const double o[3], const double aim[3], const double *side) {
  if (D->n >= CM_MAX_JOINTS) { D->n++; return; }
  copy3(D->o[D->n], o); copy3(D->aim[D->n], aim); D->own[D->n] = side != 0;
  if (side) copy3(D->side[D->n], side);
  D->n++;
}
static void add_dir(decl *D, const double o[3], const double dir[3], const double *side) { double a[3]; set3(a, o[0] + dir[0], o[1] + dir[1], o[2] + dir[2]); add(D, o, a, side); }
static void add_wings(decl *D, const cm_pose *p) {
  int k;
  for (k = 0; k < p->n_wings; k++) { add(D, p->wing[k].root, p->wing[k].mid, p->wing[k].t1); add(D, p->wing[k].mid, p->wing[k].tip, p->wing[k].t2); }
}
static void declare(const cm_character *c, const cm_pose *p, const cm_rig *rig, decl *D) {
  double hd = p->base.heading, rt[3], u3[3], t[3], a[3];
  const double *rtu;
  int i, k, n = p->base.legs, sided = (p->body == CM_BODY_BIPED || p->body == CM_BODY_MECH || p->body == CM_BODY_BEAST || p->body == CM_BODY_QUAD) && !p->climbing;
  const cm_leg_pose *L = p->base.leg;
  set3(rt, -sin(hd), 0, cos(hd));
  rtu = sided ? p->side : rt;
  D->n = 0;
  if (p->body == CM_BODY_BIPED || p->body == CM_BODY_MECH) {
    for (i = 0; i < n; i++) {
      add(D, L[i].hip, L[i].knee, 0); add(D, L[i].knee, L[i].ankle, 0);
      unit_of(L[i].ball, L[i].heel, u3); add_dir(D, L[i].ankle, u3, 0);
      unit_of(L[i].toe, L[i].ball, u3); add_dir(D, L[i].ball, u3, 0);
    }
    if (p->body == CM_BODY_MECH) {
      add(D, p->base.root, p->chest, 0); add_dir(D, p->chest, p->u, rtu);
      for (i = 0; i < 2; i++) add_dir(D, p->mount[i].base, p->mount[i].dir, 0);
      return;
    }
    {
      const double *root = p->base.root, *u = p->u, *f = p->f;
      double mid[3], pa[3], pb[3], gp[3], cc[3];
      set3(mid, (root[0] + p->chest[0]) / 2, (root[1] + p->chest[1]) / 2, (root[2] + p->chest[2]) / 2);
      set3(pa, p->chest[0] + (f[0] * -0.21 + u[0] * -0.04), p->chest[1] + (f[1] * -0.21 + u[1] * -0.04) + p->pack, p->chest[2] + (f[2] * -0.21 + u[2] * -0.04));
      set3(pb, mid[0] + f[0] * -0.20, mid[1] + f[1] * -0.20 + p->pack, mid[2] + f[2] * -0.20);
      add(D, root, p->chest, 0); add(D, pa, pb, 0); add(D, mid, p->chest, rtu);
      cross3(rtu, p->gaze, t); add_dir(D, p->head, t, rtu);
      for (k = 0; k < p->n_props; k++) {
        const cm_prop_pose *w = &p->prop[k];
        double sv[3];
        cross3(w->dir, w->up, sv);
        add(D, w->o, w->muzzle, sv);
        if (w->kind != CM_PROP_SWORD && w->kind != CM_PROP_SHIELD && w->kind != CM_PROP_CASE && w->kind != CM_PROP_TROLLEY) add(D, w->mag_a, w->mag_b, sv);      /* a firearm's magazine */
      }
      if (!p->climbing && !p->down) copy3(gp, p->grenade);
      else set3(gp, root[0] + (u[0] * 0.09 + f[0] * 0.07) + rt[0] * 0.185, root[1] + (u[1] * 0.09 + f[1] * 0.07) + rt[1] * 0.185, root[2] + (u[2] * 0.09 + f[2] * 0.07) + rt[2] * 0.185);
      add_dir(D, gp, u, 0);
      if (p->has_carry && !p->climbing) add_dir(D, p->carry.c, p->carry.u, p->carry.side);
      else { set3(cc, root[0] + (f[0] * 0.34 + u[0] * 0.22), root[1] + (f[1] * 0.34 + u[1] * 0.22), root[2] + (f[2] * 0.34 + u[2] * 0.22)); add_dir(D, cc, u, rtu); }
      for (i = 0; i < 2; i++) {
        const cm_arm_pose *s = &p->arm[i];
        add(D, s->shoulder, s->elbow, 0); add(D, s->elbow, s->hand, 0);
        set3(a, 2 * s->hand[0] - s->elbow[0], 2 * s->hand[1] - s->elbow[1], 2 * s->hand[2] - s->elbow[2]); add(D, s->hand, a, 0);
      }
    }
  } else if (p->body == CM_BODY_BEAST) {
    double nd[3];
    if (p->n_tail_pts > 1) for (i = 0; i + 1 < p->n_tail_pts; i++) add(D, p->tail_pts[i], p->tail_pts[i + 1], 0);
    else add(D, p->back, p->tail, 0);
    add(D, p->base.root, p->back, 0); add(D, p->base.root, p->front, 0);
    unit_of(p->head, p->neck, nd);
    add(D, p->neck, p->head, 0); add_dir(D, p->head, nd, 0); add_dir(D, p->head, p->gaze, rtu);
    if (rig->ears != 0) {                        /* ears: they go back when the animal is roused */
      double hup[3], ear[3], es = rig->ears, g = (-0.03 - 0.05 * p->alert) * es;
      cross3(rtu, p->gaze, hup);
      set3(ear, p->head[0] + (hup[0] * 0.085 * es + p->gaze[0] * g), p->head[1] + (hup[1] * 0.085 * es + p->gaze[1] * g), p->head[2] + (hup[2] * 0.085 * es + p->gaze[2] * g));
      add_dir(D, ear, p->gaze, rtu);
    }
    add(D, p->mount[0].base, p->mount[0].tip, rtu);
    for (i = 0; i < n; i++) {
      add(D, L[i].hip, L[i].knee, 0); add(D, L[i].knee, L[i].ankle, 0);
      if (L[i].has_foot) {                       /* walks on its toes */
        unit_of(L[i].ball, L[i].heel, u3); add_dir(D, L[i].ankle, u3, 0);
        unit_of(L[i].toe, L[i].ball, u3); add_dir(D, L[i].ball, u3, 0);
      }
    }
    add_wings(D, p);
  } else if (p->body == CM_BODY_OCTO) {
    add_dir(D, p->base.root, p->axis, 0); add(D, p->mantle_c, p->mantle_tip, 0); add_dir(D, p->eye, p->axis, 0);
    for (k = 0; k < p->n_arms; k++) for (i = 0; i < 6; i++) add(D, p->arms[k][i], p->arms[k][i + 1], 0);
  } else if (p->body == CM_BODY_ARTHRO) {
    double sax[3];
    unit_of(p->front, p->back, sax);
    add(D, p->back, p->front, 0);
    for (i = 0; i + 1 < p->n_tail_pts; i++) add(D, p->tail_pts[i], p->tail_pts[i + 1], 0);
    if (c->arthro_has_thorax) { add(D, p->thorax[0], p->thorax[1], 0); add_dir(D, p->eye, sax, 0); }
    else if (c->arthro_has_head) add_dir(D, p->eye, sax, 0);
    for (k = 0; k < p->n_claws; k++) {
      const cm_claw_pose *cl = &p->claw[k];
      add(D, cl->shoulder, cl->elbow, 0); add(D, cl->elbow, cl->wrist, 0); add(D, cl->wrist, cl->tip, 0); add(D, cl->finger_a, cl->finger_b, 0);
    }
    for (i = 0; i < n; i++) { add(D, L[i].hip, L[i].knee, 0); add(D, L[i].knee, L[i].ankle, 0); }
    add_wings(D, p);
  } else if (p->body == CM_BODY_QUAD) {
    add(D, p->back, p->front, 0); add(D, p->back, p->tail, 0);
    set3(a, p->front[0] + p->up[0] * 0.03, p->front[1] + p->up[1] * 0.03, p->front[2] + p->up[2] * 0.03);
    add(D, a, p->head, 0); add_dir(D, p->head, p->gaze, rtu);
    for (i = 0; i < n; i++) { add(D, L[i].hip, L[i].knee, 0); add(D, L[i].knee, L[i].ankle, 0); }
  } else {
    add(D, p->back, p->front, 0); add_dir(D, p->mount[0].base, p->mount[0].dir, 0);
    for (i = 0; i < n; i++) { add(D, L[i].hip, L[i].knee, 0); add(D, L[i].knee, L[i].ankle, 0); }
  }
}

int cm_skeleton_step(const cm_character *ch, const cm_pose *pose, cm_skeleton *sk) {
  decl D;
  const cm_rig *rig = cm_rig_for(ch, pose);
  double hd = pose->base.heading, lat[3], fwd[3];
  int k, kept;
  if (!rig) return -1;
  declare(ch, pose, rig, &D);
  if (D.n != rig->n_joints || D.n > CM_MAX_JOINTS) return -1;
  kept = sk->rig == rig && sk->n == D.n;
  set3(lat, sin(hd), 0, -cos(hd)); set3(fwd, cos(hd), 0, sin(hd));
  for (k = 0; k < D.n; k++) {
    cm_joint *J = &sk->joint[k];
    const cm_rig_joint *T = &rig->joints[k];
    double d[3], ln, y[3], x[3], t, xl;
    const double *ref = D.own[k] ? D.side[k] : T->ref ? fwd : lat;
    set3(d, D.aim[k][0] - D.o[k][0], D.aim[k][1] - D.o[k][1], D.aim[k][2] - D.o[k][2]);
    ln = sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    if (ln > 1e-6) set3(y, d[0] / ln, d[1] / ln, d[2] / ln); else set3(y, 0, 1, 0);
    t = ref[0] * y[0] + ref[1] * y[1] + ref[2] * y[2];
    set3(x, ref[0] - y[0] * t, ref[1] - y[1] * t, ref[2] - y[2] * t);
    xl = sqrt(x[0] * x[0] + x[1] * x[1] + x[2] * x[2]);
    copy3(J->o, D.o[k]);
    if (xl < 1e-4) {                             /* the bone points along its side reference: it keeps the turn it had */
      if (!kept) { copy3(J->x, T->x); copy3(J->y, T->y); copy3(J->z, T->z); }
      continue;
    }
    set3(J->x, x[0] / xl, x[1] / xl, x[2] / xl); copy3(J->y, y); cross3(J->x, J->y, J->z);
  }
  sk->rig = rig; sk->n = D.n; sk->heading = hd;
  /* things in the hands change their place in the draw order with what the hands are doing */
  for (k = 0; k < 3; k++) sk->held[k].on = 0;
  for (k = 0; k < pose->n_props && k < 2; k++) {
    const cm_prop_pose *w = &pose->prop[k];
    int st = w->stow > 0.5;
    sk->held[k].on = 1;
    if (w->kind == CM_PROP_PISTOL || w->kind == CM_PROP_SIDEGUN) { sk->held[k].layer = k == 0 ? (st ? 2.1 : 3.1) : (st ? -2.1 : -2.9); sk->held[k].shade = k == 0 ? 3 : 1; }
    else if (w->kind == CM_PROP_SWORD) { sk->held[k].layer = st ? -2.3 : 3.1; sk->held[k].shade = 3; }
    else if (w->kind == CM_PROP_SHIELD) { sk->held[k].layer = st ? -0.6 : -2.6; sk->held[k].shade = 1; }
    else if (w->kind == CM_PROP_CASE) { sk->held[k].layer = 2.6; sk->held[k].shade = 3; }
    else if (w->kind == CM_PROP_TROLLEY) { sk->held[k].layer = -2.4; sk->held[k].shade = 1; }
    else { sk->held[k].layer = st ? -0.5 : 0.5; sk->held[k].shade = 2; }
  }
  if (pose->body == CM_BODY_BIPED) { sk->held[2].on = 1; sk->held[2].layer = !pose->climbing && !pose->down && pose->grenade_held ? 3.05 : 2.2; sk->held[2].shade = 3; }
  return D.n;
}

static void conv(const double v[3], double o[3]) { set3(o, -v[2], v[1], v[0]); }          /* the pose's axes to glTF's */
void cm_joint_move(const cm_skeleton *sk, int j, double m[16]) {
  const cm_joint *f = &sk->joint[j];
  const cm_rig_joint *t = &sk->rig->joints[j];
  double A[3][3], B[3][3], o0[3], o1[3], R[9];
  int c, r;
  conv(f->x, A[0]); conv(f->y, A[1]); conv(f->z, A[2]); conv(t->x, B[0]); conv(t->y, B[1]); conv(t->z, B[2]); conv(t->o, o0); conv(f->o, o1);
  for (c = 0; c < 3; c++) for (r = 0; r < 3; r++) R[c * 3 + r] = A[0][r] * B[0][c] + A[1][r] * B[1][c] + A[2][r] * B[2][c];
  m[0] = R[0]; m[1] = R[1]; m[2] = R[2]; m[3] = 0; m[4] = R[3]; m[5] = R[4]; m[6] = R[5]; m[7] = 0; m[8] = R[6]; m[9] = R[7]; m[10] = R[8]; m[11] = 0;
  m[12] = o1[0] - (R[0] * o0[0] + R[3] * o0[1] + R[6] * o0[2]); m[13] = o1[1] - (R[1] * o0[0] + R[4] * o0[1] + R[7] * o0[2]); m[14] = o1[2] - (R[2] * o0[0] + R[5] * o0[1] + R[8] * o0[2]); m[15] = 1;
}

static void carry(const cm_joint *f, const double l[3], double o[3]) {
  set3(o, f->o[0] + f->x[0] * l[0] + f->y[0] * l[1] + f->z[0] * l[2], f->o[1] + f->x[1] * l[0] + f->y[1] * l[1] + f->z[1] * l[2], f->o[2] + f->x[2] * l[0] + f->y[2] * l[1] + f->z[2] * l[2]);
}
int cm_skeleton_parts(const cm_skeleton *sk, cm_part *out) {
  const cm_rig *rig = sk->rig;
  int i;
  if (!rig) return 0;
  for (i = 0; i < rig->n_parts; i++) {
    const cm_rig_part *q = &rig->parts[i];
    const cm_joint *f = &sk->joint[q->joint];
    cm_part *o = &out[i];
    int h = !strcmp(q->group, "prop0") ? 0 : !strcmp(q->group, "prop1") ? 1 : !strcmp(q->group, "grenade") ? 2 : -1;
    memset(o, 0, sizeof *o);
    o->def = q; carry(f, q->a, o->a);
    if (q->has_b) carry(f, q->b, o->b);
    if (q->has_end) carry(f, q->end, o->end);
    if (q->has_on) carry(f, q->on, o->on);
    if (h >= 0 && sk->held[h].on) { o->layer = sk->held[h].layer; o->shade = sk->held[h].shade; } else { o->layer = q->layer; o->shade = q->shade; }
  }
  return rig->n_parts;
}

void cm_parts_order(cm_part *parts, int n, double heading, double yaw, int *order) {
  int flip = cos(heading - yaw) < -1e-9, i, j;
  double sy = sin(yaw), cy = cos(yaw);
  for (i = 0; i < n; i++) {
    cm_part *q = &parts[i];
    int side = fabs(q->layer) >= 1;
    q->key = flip && side ? -q->layer : q->layer;
    /* something on the surface of a rounder part (an eye on a head): on the side turned away it goes behind that part */
    if (q->def->has_on && (-q->a[0] * sy + q->a[2] * cy) < (-q->on[0] * sy + q->on[2] * cy) - 0.004) q->key -= 0.005;
    q->level = q->def->raw ? -1 : flip && side ? 4 - q->shade : q->shade;
  }
  if (!order) return;
  for (i = 0; i < n; i++) {                      /* by key, and for equal keys in the rig's order */
    for (j = i; j > 0 && parts[order[j - 1]].key > parts[i].key; j--) order[j] = order[j - 1];
    order[j] = i;
  }
}

void cm_part_place(const cm_picture *im, const double a0[2], const double *b0, double rs, double ppm, int flip, cm_placing *o) {
  const double *a = a0, *b = b0, *bx = im->box;
  double ex, ey, dist, len, ang, k = 1;
  o->x = a[0]; o->y = a[1]; o->rot = 0; o->fx = 1; o->fy = 1;
  if (im->axis == CM_AXIS_BALL || !b) {
    if (flip) o->fx = -1;
    if (im->has_box) { o->dx = bx[0] * ppm; o->dy = bx[1] * ppm; o->dw = (bx[2] - bx[0]) * ppm; o->dh = (bx[3] - bx[1]) * ppm; }
    else { o->dh = 2.3 * rs; o->dw = o->dh * im->w / im->h; o->dx = -o->dw / 2; o->dy = -o->dh / 2; }
    return;
  }
  if (im->axis == CM_AXIS_UP) { a = b0; b = a0; o->x = a[0]; o->y = a[1]; }
  ex = b[0] - a[0]; ey = b[1] - a[1]; dist = sqrt(ex * ex + ey * ey); len = dist + 2 * rs; ang = atan2(ey, ex);
  /* a bone seen end on has no length on the screen: the picture is then no shorter than the part is thick */
  if (im->has_box) k = fmax(dist / (im->len * ppm), 2 * rs / ((im->len + 2 * im->r) * ppm));
  if (im->axis == CM_AXIS_RIGHT) {
    o->rot = ang; if (flip) o->fy = -1;
    if (im->has_box) { o->dx = bx[0] * ppm * k; o->dy = bx[1] * ppm; o->dw = (bx[2] - bx[0]) * ppm * k; o->dh = (bx[3] - bx[1]) * ppm; }
    else { o->dh = len * im->h / im->w; o->dw = len; o->dx = -rs; o->dy = -o->dh / 2; }
  } else {
    o->rot = ang - 3.14159265358979323846 / 2; if (flip) o->fx = -1;
    if (im->has_box) { o->dx = bx[0] * ppm; o->dy = bx[1] * ppm * k; o->dw = (bx[2] - bx[0]) * ppm; o->dh = (bx[3] - bx[1]) * ppm * k; }
    else { o->dw = len * im->w / im->h; o->dh = len; o->dx = -o->dw / 2; o->dy = -rs; }
  }
}
