/* Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE).
   SPDX-License-Identifier: Apache-2.0

   Stage 3: the upper body of upright characters, their weapons and their actions. A port of upperBody, actTick
   and fireControl in js/core.js, statement for statement; checked against the replays in spec/body/.
   Bipeds: spine, head, arms, sideways aim, the kits held and stowed, firing and recoil, reloading, the sword's
   swings and the shield's block, throwing, lifting and carrying a crate, the fighting stance and punches.
   The mech: the hull, its turn towards the aim, and its guns. */
#include "clio_motion_internal.h"
#include <math.h>
#include <string.h>

#define TAU 6.283185307179586
#define PI 3.141592653589793
#define G CM_G

typedef struct { double len, body, grip[2], grip_low[2]; int has_fore; double fore[2], mag_a[2], mag_b[2], kick, rise; int rounds; double reload, seat; } prop_def;
static const prop_def PROPS[6] = {
  { 0.91, 0.57, { 0.24, -0.06 }, { 0.225, -0.115 }, 1, { 0.53, -0.035 }, { 0.35, -0.035 }, { 0.35, -0.15 }, 1.5, 5, 30, 1.7, 0.80 },      /* rifle */
  { 0.20, 0.12, { 0.025, -0.03 }, { 0.0, -0.11 }, 0, { 0, 0 }, { 0.012, -0.045 }, { 0.012, -0.12 }, 1.6, 3, 12, 1.1, 0.60 },              /* pistol */
  { 0.95, 0.15, { 0.07, 0 }, { 0.13, -0.09 }, 0, { 0, 0 }, { 0.13, 0.09 }, { 0.13, -0.09 }, 0, 0, 0, 0, 0 },                              /* sword */
  { 0.62, 0.31, { 0.31, 0.06 }, { 0.31, 0.02 }, 0, { 0, 0 }, { 0.26, 0.0 }, { 0.36, 0.0 }, 0, 0, 0, 0, 0 },                               /* shield */
  /* what people who are not soldiers carry. A case by its handle: its rear end and muzzle are its top corners, the magazine's ends its
     bottom ones. A case on wheels: its rear end is the axle, 'body' where the case ends and the rods begin, the muzzle the grip; the
     magazine's ends are the middle line of the case itself */
  { 0.42, 0.21, { 0.21, 0.035 }, { 0.21, 0 }, 0, { 0, 0 }, { 0, -0.30 }, { 0.42, -0.30 }, 0, 0, 0, 0, 0 },                                /* case */
  { 0.98, 0.56, { 0.98, 0 }, { 0.90, 0 }, 0, { 0, 0 }, { 0.03, 0.11 }, { 0.56, 0.11 }, 0, 0, 0, 0, 0 }                                    /* trolley */
};
#define TROLLEY_WHEEL 0.035
/* civil: a kit for people who are not soldiers; in the hand whether or not weapons are asked for. pace: the fastest it is taken along */
typedef struct { int n, props[2]; double rate; int melee, civil; double pace; } kit_def;
static const kit_def KITS[7] = {
  { 0, { 0, 0 }, 0, 0, 0, 0 },
  { 1, { CM_PROP_RIFLE, 0 }, 9, 0, 0, 0 },
  { 2, { CM_PROP_PISTOL, CM_PROP_PISTOL }, 7, 0, 0, 0 },
  { 2, { CM_PROP_SWORD, CM_PROP_SHIELD }, 0, 1, 0, 0 },
  { 0, { 0, 0 }, 0, 1, 1, 0 },
  { 1, { CM_PROP_CASE, 0 }, 0, 1, 1, 0 },
  { 1, { CM_PROP_TROLLEY, 0 }, 0, 1, 1, 1.0 }
};
static int kit_fits(const cm_character *ch, int kit) { return kit >= CM_KIT_RIFLE && kit <= CM_KIT_TROLLEY && !KITS[kit].civil == !ch->mount_civil; }
/* how fast what is in the hand lets the body go: 0 for as fast as it likes */
double cm_kit_pace(const cm_state *S, const cm_character *ch) { return ch->mount_type == CM_MOUNT_HELD && S->kit && S->armed.x > 0.5 ? KITS[S->kit].pace : 0; }
static const double SWING_DUR[4] = { 0, 0.62, 0.70, 0.55 };
static const struct { int hand; double dur, hit; } PUNCH[4] = { { 0, 0, 0 }, { 1, 0.34, 0.36 }, { 0, 0.50, 0.42 }, { 1, 0.56, 0.46 } };
static const double CRATE[3] = { 0.44, 0.36, 0.50 };          /* depth, height, width */

typedef struct { double lean, tw, ext, load, wind, hit, jaw, alert, sting, rear, shut; int ink; } act_out;
typedef struct { double o[2], th, z; } place_t;

static void add3(const double a[3], const double b[3], double o[3]) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; }
static void sub3(const double a[3], const double b[3], double o[3]) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; }
static double dot3(const double a[3], const double b[3]) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
static double len3(const double a[3]) { return sqrt(dot3(a, a)); }
static void lerp3(const double a[3], const double b[3], double t, double o[3]) { o[0] = cm_lerp(a[0], b[0], t); o[1] = cm_lerp(a[1], b[1], t); o[2] = cm_lerp(a[2], b[2], t); }
static void set3(double o[3], double x, double y, double z) { o[0] = x; o[1] = y; o[2] = z; }
static void copy3(double o[3], const double a[3]) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; }

static void scale3(const double a[3], double k, double o[3]) { o[0] = a[0] * k; o[1] = a[1] * k; o[2] = a[2] * k; }
static void axpy3(const double a[3], const double d[3], double k, double o[3]) { set3(o, a[0] + d[0] * k, a[1] + d[1] * k, a[2] + d[2] * k); }
static void unit3(double a[3]) { double l = len3(a); if (l == 0) l = 1; scale3(a, 1 / l, a); }
static void cross3(const double a[3], const double b[3], double o[3]) { set3(o, a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]); }

static const kit_def *held_kit(const cm_state *S, const cm_character *ch) { return ch->mount_type == CM_MOUNT_HELD && S->kit ? &KITS[S->kit] : 0; }
static void full_ammo(cm_state *S) {
  const kit_def *k = &KITS[S->kit];
  int i;
  S->ammo[0] = S->ammo[1] = 0;
  for (i = 0; i < k->n; i++) S->ammo[i] = PROPS[k->props[i]].rounds;
}
void cm_kit_fill(cm_state *S) { full_ammo(S); }

/* A prop at a place: o is its rear end, th its angle in the body's forward-up plane, z how far to the side. */
static void prop_at(int kind, const double o[2], double th, double z, cm_prop_pose *w) {
  const prop_def *D = &PROPS[kind];
  double d[2], n[2];
  d[0] = cos(th); d[1] = sin(th); n[0] = -sin(th); n[1] = cos(th);
  memset(w, 0, sizeof *w);
  w->kind = kind; w->has_fore = D->has_fore;
  set3(w->o, o[0], o[1], z);
#define PT(dst, ax, ay) set3(dst, o[0] + d[0] * (ax) + n[0] * (ay), o[1] + d[1] * (ax) + n[1] * (ay), z)
  PT(w->muzzle, D->len, 0); PT(w->body, D->body, 0); PT(w->grip, D->grip[0], D->grip[1]); PT(w->grip_low, D->grip_low[0], D->grip_low[1]);
  if (D->has_fore) PT(w->fore, D->fore[0], D->fore[1]);
  PT(w->mag_a, D->mag_a[0], D->mag_a[1]); PT(w->mag_b, D->mag_b[0], D->mag_b[1]);
#undef PT
  set3(w->dir, d[0], d[1], 0); set3(w->up, n[0], n[1], 0);
}
static place_t stow_place(int kind, int k, const double root[3], const double u[3], const double f[3], double zc) {
  double down = atan2(-u[1], -u[0]);
  place_t p;
  if (kind == CM_PROP_RIFLE) { p.o[0] = root[0] + 0.65 * u[0] - 0.22 * f[0]; p.o[1] = root[1] + 0.65 * u[1] - 0.22 * f[1]; p.th = down; p.z = zc - 0.02; }                  /* muzzle down across the back */
  else if (kind == CM_PROP_SWORD) { p.o[0] = root[0] + 0.10 * u[0] + 0.06 * f[0]; p.o[1] = root[1] + 0.10 * u[1] + 0.06 * f[1]; p.th = down - 0.45; p.z = root[2] - 0.17; }  /* in a scabbard on the left hip */
  else if (kind == CM_PROP_SHIELD) { p.o[0] = root[0] + 0.10 * u[0] - 0.20 * f[0]; p.o[1] = root[1] + 0.10 * u[1] - 0.20 * f[1]; p.th = down + PI; p.z = zc; }              /* slung on the back */
  else if (kind == CM_PROP_CASE) { p.o[0] = root[0] - 0.12 * u[0] - 0.21 * f[0]; p.o[1] = root[1] - 0.12 * u[1] - 0.21 * f[1]; p.th = atan2(f[1], f[0]); p.z = root[2] + 0.20; }   /* let go of: against the right thigh */
  else if (kind == CM_PROP_TROLLEY) { p.o[0] = root[0] - 0.80 * u[0] - 0.34 * f[0]; p.o[1] = root[1] - 0.80 * u[1] - 0.34 * f[1]; p.th = down + PI; p.z = zc + 0.22; }           /* let go of: standing behind */
  else { p.o[0] = root[0] + 0.05 * u[0] + 0.03 * f[0]; p.o[1] = root[1] + 0.05 * u[1] + 0.03 * f[1]; p.th = down + 0.2; p.z = root[2] + (k == 0 ? 0.15 : -0.15); }           /* hip holsters */
  return p;
}
static place_t ready_place(int kind, int k, const double chest[3], const double u[3], const double f[3], double W, double kick) {
  place_t p;
  if (kind == CM_PROP_RIFLE) {
    double a = kick - 0.15;                                    /* the butt sits in the shoulder pocket */
    p.o[0] = chest[0] - 0.11 * u[0] + 0.10 * f[0] + cos(W) * a; p.o[1] = chest[1] - 0.11 * u[1] + 0.10 * f[1] + sin(W) * a; p.th = W; p.z = chest[2] + 0.04;
  } else if (kind == CM_PROP_SWORD) { p.o[0] = chest[0] - 0.24 * u[0] + 0.20 * f[0]; p.o[1] = chest[1] - 0.24 * u[1] + 0.20 * f[1]; p.th = 0.95 + 0.3 * W; p.z = chest[2] + 0.21; }
  else if (kind == CM_PROP_SHIELD) { p.o[0] = chest[0] - 0.36 * u[0] + 0.30 * f[0]; p.o[1] = chest[1] - 0.36 * u[1] + 0.30 * f[1]; p.th = atan2(u[1], u[0]) - 0.12; p.z = chest[2] - 0.20; }
  /* a case hangs level from the right hand at the end of a straight arm; a case on wheels leans from its axle up to the hand held low behind */
  else if (kind == CM_PROP_CASE) { p.o[0] = chest[0] - 0.04 * u[0] - 0.19; p.o[1] = chest[1] - 0.04 * u[1] - 0.565; p.th = 0; p.z = chest[2] + 0.25; }
  else if (kind == CM_PROP_TROLLEY) { p.o[0] = chest[0] - 0.04 * u[0] - 0.20 - 0.98 * cos(0.85); p.o[1] = chest[1] - 0.04 * u[1] - 0.50 - 0.98 * sin(0.85); p.th = 0.85; p.z = chest[2] + 0.22; }
  else {
    double r = 0.50 + kick;                                    /* arm's length; recoil also flips the muzzle up */
    p.o[0] = chest[0] + 0.03 * u[0] + cos(W) * r; p.o[1] = chest[1] + 0.03 * u[1] + sin(W) * r; p.th = W - 8 * kick; p.z = chest[2] + (k == 0 ? 0.08 : -0.08);
  }
  return p;
}
static place_t belt_place(int k, const double root[3], const double u[3], const double f[3]) {      /* a pistol brought down to the magazine holder on the belt */
  place_t p;
  p.o[0] = root[0] + 0.20 * u[0] + 0.16 * f[0]; p.o[1] = root[1] + 0.20 * u[1] + 0.16 * f[1]; p.th = 0.1; p.z = root[2] + (k == 0 ? 0.12 : -0.12);
  return p;
}
static place_t mix_place(place_t a, place_t b, double t) {
  place_t p;
  p.o[0] = cm_lerp(a.o[0], b.o[0], t); p.o[1] = cm_lerp(a.o[1], b.o[1], t); p.th = a.th + cm_wrap_pi(b.th - a.th) * t; p.z = cm_lerp(a.z, b.z, t);
  return p;
}
static void simple_event(cm_state *S, int type, int gun) {
  cm_event e;
  memset(&e, 0, sizeof e);
  e.type = type; e.gun = gun; e.leg = -1;
  cm_event_push(S, &e);
}
static cm_action *new_action(cm_state *S, int name, double dur) {
  memset(&S->action, 0, sizeof S->action);
  S->act = name; S->action.dur = dur;
  return &S->action;
}

int cm_start_reload(cm_state *S, const cm_character *ch, int asked) {
  const kit_def *kit = held_kit(S, ch);
  int q[2], nq = 0, i;
  cm_action *a;
  if (!kit || kit->melee || S->act || S->armed.x < 0.8 || (S->mode != CM_MODE_GROUND && S->mode != CM_MODE_RIDE)) return 0;
  for (i = 0; i < kit->n; i++) if (S->ammo[i] < PROPS[kit->props[i]].rounds) q[nq++] = i;
  if (!nq && asked) for (i = 0; i < kit->n; i++) q[nq++] = i;
  if (!nq) return 0;
  a = new_action(S, CM_ACT_RELOAD, PROPS[kit->props[q[0]]].reload * sqrt(ch->L / 0.92));
  a->n_queue = nq; a->queue[0] = q[0]; a->queue[1] = nq > 1 ? q[1] : 0; a->gun = q[0];
  simple_event(S, CM_EV_RELOAD, q[0]);
  return 1;
}

static void fire_control(cm_state *S, const cm_character *ch, const cm_input *inp, double dt) {
  const kit_def *kit = held_kit(S, ch);
  int n = kit ? kit->n : ch->mount_n, i, g = -1;
  if (kit && kit->melee) { S->flash[0] = S->flash[1] = 0; return; }       /* blades are swung, not fired */
  S->cool -= dt;
  for (i = 0; i < 2; i++) { S->flash[i] = fmax(0, S->flash[i] - dt / 0.06); cm_spring_step(&S->kick[i], 0, ch->mount_omega, 0.6, dt); }
  cm_spring_step(&S->rise, 0, ch->mount_omega * 0.7, 0.7, dt);
  if (!inp->fire || S->cool > 0 || (S->mode != CM_MODE_GROUND && S->mode != CM_MODE_RIDE) || S->act > CM_ACT_RELOAD || ch->mount_type == CM_MOUNT_JAW) return;
  if (kit) {
    if (S->armed.x < 0.8) return;
    /* the next gun in turn that has rounds and is not being reloaded; with none left, fire starts a reload */
    for (i = 1; i <= n && g < 0; i++) { int c = (S->gun + i) % n; if (S->ammo[c] > 0 && !(S->act == CM_ACT_RELOAD && S->action.gun == c)) g = c; }
    if (g < 0) { cm_start_reload(S, ch, 0); return; }
    S->ammo[g]--;
  } else g = n == 2 ? 1 - S->gun : 0;
  S->gun = g;
  S->cool = 1 / (kit ? kit->rate : ch->mount_rate); S->flash[g] = 1;
  S->kick[g].v -= kit ? PROPS[kit->props[g]].kick : ch->mount_kick; S->rise.v += kit ? PROPS[kit->props[g]].rise : ch->mount_rise;
  S->lean.v -= ch->mount_body_kick != 0 ? ch->mount_body_kick : 0.5;
  simple_event(S, CM_EV_FIRE, g);
}

static double fold_half(double a) { a = cm_wrap_pi(a); return a > PI / 2 ? a - PI : a < -PI / 2 ? a + PI : a; }

/* Timed actions for upright characters. Each one takes over the hands and adds to the lean, the turn of the
   torso and the crouch, while the legs carry on underneath. */
static void act_tick(cm_state *S, const cm_character *ch, const cm_input *inp, double dt, const cm_bctx *B, act_out *AC) {
  cm_action *a = &S->action;
  int has = S->act != CM_ACT_NONE, idle = !has && S->jump.stage == CM_JUMP_NONE;
  double k = sqrt(ch->L / 0.92), g, q;
  memset(AC, 0, sizeof *AC);
  cm_spring_step(&S->guard, inp->guard && !S->carry && !(has && S->act == CM_ACT_THROW) ? 1 : 0, 16, 1, dt);
  cm_spring_step(&S->block, inp->block && (inp->guard || (S->kit == CM_KIT_SWORD && S->armed.x > 0.5)) ? 1 : 0, 24, 1, dt);
  g = cm_clamp(S->guard.x, 0, 1);
  S->act_crouch = 0.12 * g + 0.10 * cm_clamp(S->block.x, 0, 1); S->act_back = 0;
  if (inp->swing && S->kit == CM_KIT_SWORD && S->armed.x > 0.8 && !S->carry && S->jump.stage == CM_JUMP_NONE && (!has || (S->act == CM_ACT_SWING && a->t > 0.8 * a->dur))) {
    int sk0 = inp->swing >= CM_SWING_SLASH && inp->swing <= CM_SWING_THRUST ? inp->swing : CM_SWING_SLASH;
    a = new_action(S, CM_ACT_SWING, SWING_DUR[sk0] * k); a->kind = sk0; has = 1;
  }
  if (inp->has_throw && idle && !S->carry && g < 0.3) {
    a = new_action(S, CM_ACT_THROW, 1.25 * k); has = 1;
    if (inp->has_throw > 1) { a->has_target = 1; copy3(a->target, inp->throw_target); }
  }
  if (inp->has_pickup && idle && !S->carry && S->standing && g < 0.3) {
    cm_carry *c = &S->crate;
    memset(c, 0, sizeof *c);
    copy3(c->size, inp->pickup_has_size ? inp->pickup_size : CRATE);
    if (inp->pickup_has_at) copy3(c->at, inp->pickup_at);
    else { double lx = S->x + 0.20 * k + c->size[0] / 2, p[3]; set3(p, lx, cm_ter(&B->fr, lx, 0) + c->size[1] / 2, 0); cm_to_w(&B->fr, p, c->at); }
    c->yaw = inp->pickup_has_heading ? fold_half(inp->pickup_heading - S->h) : 0;
    S->carry = 1;
    a = new_action(S, CM_ACT_PICKUP, 1.7 * k); has = 1;
  }
  if (inp->putdown && idle && S->carry && S->crate.held && S->standing) {
    cm_carry *c = &S->crate;
    double lx = S->x + 0.20 * k + c->size[0] / 2, p[3];
    c->yaw = 0;
    set3(p, lx, cm_ter(&B->fr, lx, 0) + c->size[1] / 2, 0); cm_to_w(&B->fr, p, c->at);
    a = new_action(S, CM_ACT_PUTDOWN, 1.5 * k); has = 1;
  }
  if (inp->punch && g > 0.5 && !S->carry && (!has || (S->act == CM_ACT_PUNCH && a->t > 0.7 * a->dur))) {
    int kind = inp->punch >= CM_PUNCH_JAB && inp->punch <= CM_PUNCH_HOOK ? inp->punch : CM_PUNCH_JAB;
    /* a punch may follow another before that one is quite finished: start from where the hands and shoulders are */
    a = new_action(S, CM_ACT_PUNCH, PUNCH[kind].dur * k); has = 1;
    a->kind = kind; a->hand = PUNCH[kind].hand; a->hit = PUNCH[kind].hit; a->tw0 = S->ac_tw;
    if (inp->has_punch_target) { a->has_target = 1; copy3(a->target, inp->punch_target); }
    a->has_rel0[0] = S->has_ho_rel[0]; a->has_rel0[1] = S->has_ho_rel[1]; memcpy(a->rel0, S->ho_rel, sizeof a->rel0);
  }
  if (has && S->act != CM_ACT_RELOAD) {
    int name = S->act;
    a->t += dt; q = fmin(a->t / a->dur, 1);
    if (name == CM_ACT_THROW) {
      /* wind up turning away and leaning back, then whip round and through */
      AC->tw = 0.55 * cm_smooth(0.24, 0.50, q) - 1.0 * cm_smooth(0.56, 0.70, q) + 0.45 * cm_smooth(0.78, 1, q);
      AC->lean = -0.14 * cm_smooth(0.24, 0.50, q) + 0.36 * cm_smooth(0.56, 0.70, q) - 0.22 * cm_smooth(0.78, 1, q);
    } else if (name == CM_ACT_PICKUP || name == CM_ACT_PUTDOWN) {
      cm_carry *c = &S->crate;
      /* how far down the handles are decides how deep the squat is: a crate on a table needs none */
      double dk = cm_clamp((0.95 - (c->at[1] + 0.25 * c->size[1] - S->g_ref.x) / ch->L) / 0.66, 0.1, 1), down;
      if (name == CM_ACT_PICKUP) {
        down = cm_smooth(0, 0.34, q) * (1 - cm_smooth(0.48, 0.95, q));
        c->hk = cm_smooth(0.08, 0.36, q); c->ca = cm_smooth(0.45, 1, q);
        if (!c->held && q >= 0.42) { c->held = 1; simple_event(S, CM_EV_GRAB, 0); }
      } else {
        down = cm_smooth(0.04, 0.46, q) * (1 - cm_smooth(0.66, 1, q));
        c->ca = 1 - cm_smooth(0.14, 0.58, q); c->hk = 1 - cm_smooth(0.66, 0.95, q);
        if (c->held && q >= 0.60) {
          cm_event e;
          c->held = 0;
          memset(&e, 0, sizeof e); e.type = CM_EV_PUTDOWN; e.leg = -1; copy3(e.pos, c->at); e.hd = S->h;
          cm_event_push(S, &e);
        }
      }
      /* a proper squat: hips go back as they go down, and the back leans over the load */
      S->act_crouch = 1.25 * dk * down; S->act_back = 0.24 * k * dk * down; AC->lean = 0.47 * dk * down;
    } else if (name == CM_ACT_SWING) {
      /* wind up, land, recover */
      AC->wind = cm_smooth(0, 0.26, q) * (1 - cm_smooth(0.28, 0.42, q)); AC->hit = cm_smooth(0.28, 0.42, q) * (1 - cm_smooth(0.56, 1, q));
      a->live = q > 0.28 && q < 0.50;
      if (a->kind == CM_SWING_SLASH) { AC->tw = 0.80 * AC->wind - 0.70 * AC->hit; AC->lean = 0.08 * AC->hit; }
      else if (a->kind == CM_SWING_CHOP) { AC->tw = 0.15 * AC->wind - 0.12 * AC->hit; AC->lean = -0.08 * AC->wind + 0.20 * AC->hit; }
      else { AC->tw = 0.20 * AC->wind - 0.22 * AC->hit; AC->lean = 0.16 * AC->hit; }
      S->act_back = -0.08 * k * AC->hit;                       /* the weight goes into it */
    } else if (name == CM_ACT_PUNCH) {
      if (inp->has_track && q < 0.7 * a->hit) { a->has_target = 1; copy3(a->target, inp->track); }      /* still on its way out: follow the target */
      if (a->kind == CM_PUNCH_JAB) { AC->ext = cm_smooth(0, 0.36, q) * (1 - cm_smooth(0.46, 1, q)); AC->tw = 0.22 * AC->ext; AC->lean = 0.05 * AC->ext; }
      else if (a->kind == CM_PUNCH_CROSS) {
        /* the hips and shoulders turn first and the fist follows */
        AC->ext = cm_smooth(0.10, 0.42, q) * (1 - cm_smooth(0.52, 1, q)); AC->tw = -0.85 * cm_smooth(0, 0.40, q) * (1 - cm_smooth(0.52, 1, q)); AC->lean = 0.12 * AC->ext;
      } else {
        double sw = cm_smooth(0.22, 0.46, q), ret = cm_smooth(0.60, 1, q);
        AC->load = cm_smooth(0, 0.22, q) * (1 - ret); AC->ext = sw * (1 - ret);
        AC->tw = 0.2 * cm_smooth(0, 0.22, q) * (1 - sw) - 0.6 * AC->ext; AC->lean = 0.04 * AC->ext;
      }
      if (a->t < 0.1) AC->tw = cm_lerp(a->tw0, AC->tw, cm_smooth(0, 0.1, a->t));
    }
    if (a->t >= a->dur) { if (name == CM_ACT_PUTDOWN) S->carry = 0; S->act = CM_ACT_NONE; }
  }
  S->ac_tw = AC->tw;
  if (S->carry) AC->lean -= 0.08 * S->crate.ca;                /* lean back against the load */
  AC->tw += 0.35 * g; AC->lean += (0.05 - 0.10 * cm_clamp(S->block.x, 0, 1)) * g;
}

/* A beast's own actions. bite: the neck shoots out, the jaws snap. A pounce (handled with the jump) leaps onto a
   target with the jaws open. */
static void beast_tick(cm_state *S, const cm_character *ch, const cm_input *inp, double dt, act_out *AC) {
  cm_action *a = &S->action;
  const cm_jump *J = &S->jump;
  double k = sqrt(ch->L / 0.7), q;
  memset(AC, 0, sizeof *AC);
  S->act_back = 0; S->act_crouch = 0;
  if (inp->bite && !S->act && (S->mode == CM_MODE_GROUND || S->mode == CM_MODE_FLY) && J->stage == CM_JUMP_NONE) { a = new_action(S, CM_ACT_BITE, 0.46 * k); if (inp->bite > 1) { a->has_target = 1; copy3(a->target, inp->bite_target); } }
  if (S->act == CM_ACT_BITE) {
    a->t += dt; q = fmin(a->t / a->dur, 1);
    AC->ext = cm_smooth(0.05, 0.34, q) * (1 - cm_smooth(0.42, 1, q));
    AC->jaw = 0.9 * cm_smooth(0, 0.22, q) * (1 - cm_smooth(0.33, 0.37, q));
    AC->alert = 1; AC->lean = 0.10 * AC->ext; S->act_back = -0.12 * k * AC->ext; S->act_crouch = 0.2 * AC->ext;
    if (a->t >= a->dur) S->act = CM_ACT_NONE;
  }
  if (J->stage != CM_JUMP_NONE && J->pounce) {
    AC->alert = 1;
    AC->jaw = J->stage == CM_JUMP_AIR ? 0.85 : J->stage == CM_JUMP_LAND ? 0.85 * (1 - cm_smooth(0, 0.07, J->t)) : 0.25;
    AC->ext = J->stage == CM_JUMP_AIR ? 0.7 : J->stage == CM_JUMP_LAND ? 0.7 * (1 - cm_smooth(0, 0.3, J->t)) : 0;
  }
}
/* An arthropod's own actions. pinch: the nearer claw shoots out and shuts. sting: the tail rears back, then whips
   over the head onto the target. */
static void arthro_tick(cm_state *S, const cm_character *ch, const cm_input *inp, double dt, act_out *AC) {
  cm_action *a = &S->action;
  int free_ = !S->act && (S->mode == CM_MODE_GROUND || S->mode == CM_MODE_FLY);
  double q;
  memset(AC, 0, sizeof *AC);
  S->act_back = 0; S->act_crouch = 0;
  if (ch->arthro_rock != 0 && S->standing && S->mode == CM_MODE_GROUND) S->act_back = ch->arthro_rock * sin(TAU * S->t / 1.4);       /* a mantis rocks like a leaf in the wind */
  if (inp->pinch && free_) { a = new_action(S, CM_ACT_PINCH, ch->arthro_strike); if (inp->pinch > 1) { a->has_target = 1; copy3(a->target, inp->pinch_target); } }
  else if (inp->sting && free_ && ch->has_tail) { a = new_action(S, CM_ACT_STING, 0.72); if (inp->sting > 1) { a->has_target = 1; copy3(a->target, inp->sting_target); } }
  if (S->act == CM_ACT_PINCH || S->act == CM_ACT_STING) {
    a->t += dt; q = fmin(a->t / a->dur, 1); AC->alert = 1;
    if (S->act == CM_ACT_PINCH) {
      AC->ext = cm_smooth(0.05, 0.36, q) * (1 - cm_smooth(0.52, 1, q)); AC->jaw = cm_smooth(0, 0.2, q);
      AC->shut = cm_smooth(0.36, 0.41, q) * (1 - cm_smooth(0.62, 0.92, q)); S->act_back = -0.06 * AC->ext;
    } else {
      AC->rear = cm_smooth(0, 0.20, q) * (1 - cm_smooth(0.22, 0.32, q));
      AC->sting = cm_smooth(0.22, 0.40, q) * (1 - cm_smooth(0.52, 1, q)); S->act_back = -0.14 * AC->sting; AC->lean = 0.3 * AC->sting;
    }
    if (a->t >= a->dur) S->act = CM_ACT_NONE;
  }
}
/* grab: the nearest arm lifts off the ground, shoots out and curls round the target. ink: a puff of ink. */
static void octo_tick(cm_state *S, const cm_input *inp, double dt, act_out *AC) {
  cm_action *a = &S->action;
  double q;
  memset(AC, 0, sizeof *AC);
  S->act_back = 0; S->act_crouch = 0; S->ink_t = fmax(0, S->ink_t - dt);
  if (inp->grab && !S->act && S->mode == CM_MODE_GROUND) { a = new_action(S, CM_ACT_GRAB, 0.8); a->arm = -1; if (inp->grab > 1) { a->has_target = 1; copy3(a->target, inp->grab_target); } }
  if (S->act == CM_ACT_GRAB) {
    a->t += dt; q = fmin(a->t / a->dur, 1); AC->alert = 1;
    AC->ext = cm_smooth(0.04, 0.40, q) * (1 - cm_smooth(0.62, 1, q)); AC->lean = 0.15 * AC->ext; S->act_back = -0.05 * AC->ext;
    if (a->t >= a->dur) S->act = CM_ACT_NONE;
  }
  if (inp->ink && S->ink_t <= 0) { S->ink_t = 1.2; AC->ink = 1; S->jaw.v += 9; }
  cm_spring_step(&S->jaw, 0, 14, 0.6, dt);                     /* the mantle's squeeze, shared by ink and jets */
}

typedef struct { double lift, yaw, curl, pull_k; double (*pull_pts)[3]; } chain_ctl;

/* A tail as a row of links, each with its own direction and turning speed. A spring turns a link to carry on from
   the one before it, bent by 'curl', so a movement at the root runs down the chain and reaches the tip late. Each
   link is also a pendulum on a moving pivot: when the body speeds up, stops, bounces or turns, the links swing the
   other way. With pull_k > 0 the links are turned to pass through pull_pts (a strike). pts gets the n + 1 points,
   in the body's frame. */
static void chain_step(cm_state *S, cm_chain *C, const cm_chain_def *T, double l_size, const cm_frame *fr, const double dr[2], const double base[3], double body_ang, const chain_ctl *ctl, double dt, double (*pts)[3]) {
  int n = T->n, k, sub, nsub, pulling = ctl->pull_pts && ctl->pull_k > 0;
  double sz = sqrt(l_size / 0.7), om0 = T->omega / sz, zeta = T->zeta, soft = T->soft, seg = T->seg, bend = T->bend;
  double th0 = body_ang + PI + T->rest - ctl->lift, ps0 = cm_clamp(ctl->yaw, -1.2, 1.2), curl = T->curl + ctl->curl, sag = T->sag;
  double vy, kf, hdt, inert = T->inert, pth, pps, pvt, pvp;
  if (C->n != n) {
    memset(C, 0, sizeof *C);
    C->n = n; C->by = base[1]; C->dr[0] = dr[0]; C->dr[1] = dr[1];
    for (k = 0; k < n; k++) { C->th[k] = th0 + k * curl; C->ps[k] = ps0; }
  }
  /* how the root of the tail is being thrown about: forwards, up and down (the gait's bounce), sideways (a turn, a shove) */
  vy = (base[1] - C->by) / dt; kf = cm_decay(25, dt);
  C->ay += (cm_clamp((vy - C->vy) / dt, -3 * G, 3 * G) - C->ay) * kf; C->vy = vy; C->by = base[1];
  C->ax += (cm_clamp(S->a + (dr[0] - C->dr[0]) / dt, -4 * G, 4 * G) - C->ax) * kf;
  C->az += (cm_clamp(S->v * S->om + (dr[1] - C->dr[1]) / dt, -4 * G, 4 * G) - C->az) * kf; C->dr[0] = dr[0]; C->dr[1] = dr[1];
  /* worked in steps of 1/120 s at most, so that a game running at 30 steps a second gets the same tail */
  nsub = (int)ceil(dt * 120 - 1e-6); if (nsub < 1) nsub = 1;
  hdt = dt / nsub;
  for (sub = 0; sub < nsub; sub++) {
    copy3(pts[0], base); pth = th0 - curl; pps = ps0; pvt = 0; pvp = 0;
    for (k = 0; k < n; k++) {
      double om = om0 * (1 - soft * k / (n - 1 > 1 ? n - 1 : 1)), ell = fmax(0.5 * seg * (n - k), seg) * 2.2 / inert;
      double th = C->th[k], ps = C->ps[k], tt = pth + curl, tp = k == 0 ? pps : 0.94 * pps, cps = cos(ps), fth, fps, bmax, off, smax, gy, *q = pts[k + 1];
      const double *prev = pts[k];
      fth = -(-C->ax * sin(th) + (C->ay + sag * G) * cos(th)) / ell;
      fps = -(C->az * cps - C->ax * cos(th) * sin(ps)) / ell;
      C->vth[k] += (om * om * cm_wrap_pi(tt - th) - 2 * zeta * om * (C->vth[k] - pvt) + fth) * hdt;
      C->vps[k] += (om * om * (tp - ps) - 2 * zeta * om * (C->vps[k] - pvp) + fps) * hdt;
      th += C->vth[k] * hdt; ps += C->vps[k] * hdt - S->om * hdt * cos(th) * 0.8;       /* the body turns under a tail that would rather keep pointing where it did */
      if (pulling) {
        const double *a = ctl->pull_pts[k], *b = ctl->pull_pts[k + 1];
        double dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], dl = sqrt(dx * dx + dy * dy + dz * dz);
        if (dl == 0) dl = 1;
        th += cm_wrap_pi(atan2(dy, dx) - th) * ctl->pull_k; ps += (asin(cm_clamp(dz / dl, -1, 1)) - ps) * ctl->pull_k;
        C->vth[k] *= 1 - ctl->pull_k; C->vps[k] *= 1 - ctl->pull_k;
      }
      /* a link bends only so far from the one before, and does not go through the ground */
      bmax = pulling ? 2.5 : bend; off = cm_wrap_pi(th - tt);
      if (fabs(off) > bmax) { th = tt + cm_clamp(off, -bmax, bmax); C->vth[k] = 0; }
      smax = k == 0 ? 1.35 : fabs(pps) + bend;
      if (fabs(ps) > smax) { ps = cm_clamp(ps, -smax, smax); C->vps[k] = 0; }
      cps = cos(ps);
      set3(q, prev[0] + seg * cos(th) * cps, prev[1] + seg * sin(th) * cps, prev[2] + seg * sin(ps));
      gy = cm_ter(fr, q[0], q[2]) + 0.03;
      if (q[1] < gy && prev[1] >= gy - 1e-6) {
        double sv = cm_clamp((gy - prev[1]) / (seg * fmax(cps, 0.2)), -1, 1), a1 = asin(sv), a2 = PI - a1;
        th = fabs(cm_wrap_pi(a1 - th)) < fabs(cm_wrap_pi(a2 - th)) ? a1 : a2; if (C->vth[k] * cos(th) < 0) C->vth[k] = 0;
        set3(q, prev[0] + seg * cos(th) * cps, prev[1] + seg * sin(th) * cps, prev[2] + seg * sin(ps));
      }
      C->th[k] = th; C->ps[k] = ps;
      pth = th; pps = ps; pvt = C->vth[k]; pvp = C->vps[k];
    }
  }
}

static void tail_step(cm_state *S, const cm_character *ch, const cm_bctx *B, const double base[3], double body_ang, const chain_ctl *ctl, double dt, double (*pts)[3]) {
  cm_chain_def T;
  T.n = ch->tail_n; T.seg = ch->tail_seg; T.rest = ch->tail_rest; T.curl = ch->tail_curl; T.omega = ch->tail_omega; T.zeta = ch->tail_zeta;
  T.soft = ch->tail_soft; T.sag = ch->tail_sag; T.bend = ch->tail_bend; T.inert = ch->tail_inert;
  chain_step(S, &S->tail, &T, ch->L, &B->fr, B->drift, base, body_ang, ctl, dt, pts);
}

/* An octopus arm through its leg: seven points on a curve from hip to tip, with links of one length. */
static void arm_curve(const double hip[3], const double knee[3], const double foot[3], double seg, double (*pts)[3]) {
  double c[3];
  int i, j;
  for (j = 0; j < 3; j++) c[j] = 2 * knee[j] - 0.5 * (hip[j] + foot[j]);
  for (i = 0; i <= 6; i++) { double u = i / 6.0, w = 1 - u; for (j = 0; j < 3; j++) pts[i][j] = w * w * hip[j] + 2 * w * u * c[j] + u * u * foot[j]; }
  cm_reach_chain(pts, 6, hip, foot, seg, 1);
}

static void wing_dir(const double ax[3], const double up[3], int s, double a, double sweep, double d[3]) {
  double c = cos(a), sn = sin(a), ss = sin(sweep);
  set3(d, up[0] * sn - ax[0] * ss * c, up[1] * sn - ax[1] * ss * c, s * c * cos(sweep));
}
/* which way the membrane hangs from a bone: behind it when spread, in against the body when folded */
static void wing_hang(const double up[3], int s, const double dv[3], double t[3]) {
  double tl;
  set3(t, s * (dv[1] * up[2] - dv[2] * up[1]), s * (dv[2] * up[0] - dv[0] * up[2]), s * (dv[0] * up[1] - dv[1] * up[0]));
  tl = len3(t); if (tl == 0) tl = 1;
  set3(t, t[0] * (1 / tl), t[1] * (1 / tl), t[2] * (1 / tl));
}
/* Two wings of two bones each. fa, fa2: how far the arm and the hand are raised; fold: 0 spread, 1 folded like a Z
   along the body (so no bone changes length). */
static void wing_pose(const cm_character *ch, const double root[3], const double ax[3], const double up[3], double fa, double fa2, double fold, cm_wing_pose out[2]) {
  int i;
  for (i = 0; i < 2; i++) {
    int s = i == 0 ? 1 : -1;
    cm_wing_pose *w = &out[i];
    double d1[3], d2[3];
    set3(w->root, root[0] + ax[0] * ch->fly_at[0] + up[0] * ch->fly_at[1], root[1] + ax[1] * ch->fly_at[0] + up[1] * ch->fly_at[1], root[2] + s * ch->fly_at[2]);
    wing_dir(ax, up, s, cm_lerp(fa, 0.22, fold), cm_lerp(ch->fly_sweep, 1.40, fold), d1);
    wing_dir(ax, up, s, cm_lerp(fa2, 0.30, fold), cm_lerp(ch->fly_sweep + 0.2, ch->fly_zfold ? -1.25 : 1.5, fold), d2);
    set3(w->mid, w->root[0] + d1[0] * ch->fly_w1, w->root[1] + d1[1] * ch->fly_w1, w->root[2] + d1[2] * ch->fly_w1);
    set3(w->tip, w->mid[0] + d2[0] * ch->fly_w2, w->mid[1] + d2[1] * ch->fly_w2, w->mid[2] + d2[2] * ch->fly_w2);
    wing_hang(up, s, d1, w->t1); wing_hang(up, s, d2, w->t2);
    w->chord = ch->fly_chord; w->side = s;
  }
}

/* turn a direction round the body's own long axis (u); a positive angle turns forward towards the right */
static void twd(const double u[3], const double v[3], double a, double o[3]) {
  double c = cos(a), s = sin(a), q = dot3(u, v) * (1 - c), r[3];
  r[0] = v[0] * c + (v[1] * u[2] - v[2] * u[1]) * s + u[0] * q;
  r[1] = v[1] * c + (v[2] * u[0] - v[0] * u[2]) * s + u[1] * q;
  r[2] = v[2] * c + (v[0] * u[1] - v[1] * u[0]) * s + u[2] * q;
  copy3(o, r);
}
static void twp(const double u[3], const double p[3], const double c0[3], double a, double o[3]) {
  double d[3], t[3];
  sub3(p, c0, d); twd(u, d, a, t); add3(c0, t, o);
}
/* Where the weapon points. Up and down: a spring chases the aim point and recoil is added on top. Sideways: the
   upper body turns towards the point, as far as its limit allows; a point behind the body is let go. */
static double aim_from(cm_state *S, const cm_character *ch, const cm_bctx *B, const double pivot[3], double share, double dt) {
  double lim = ch->mount_has_yaw ? ch->mount_yaw : 1, want, yw;
  int round = lim >= PI;
  want = ch->mount_type == CM_MOUNT_HELD ? -0.5 * cm_smooth(0.8, 2.2, S->idle_t) : 0.12 * B->idle * cm_idle_noise(S->t, B->P != 0 ? B->P : 4, 6.0);
  yw = round ? S->twist.x - cm_wrap_pi(S->twist.x) : 0;
  if (B->has_aim) {
    double dx = B->aim[0] - pivot[0], dz = B->aim[2] - pivot[2], y = atan2(dz, dx), reach = 1;
    if (round) yw = S->twist.x + cm_wrap_pi(y - S->twist.x);
    else { reach = 1 - cm_smooth(lim + 0.25, lim + 0.8, fabs(y)); yw = cm_clamp(y, -lim, lim) * reach * share; }
    want = reach * atan2(B->aim[1] - pivot[1], fmax(sqrt(dx * dx + dz * dz), 0.05 * ch->L));
  }
  cm_spring_step(&S->aim, cm_clamp(want, ch->mount_min, ch->mount_max), ch->mount_aim_omega, 0.9, dt);
  cm_spring_step(&S->twist, yw, ch->mount_aim_omega * 0.7, 1, dt);
  return S->aim.x + S->rise.x;
}

typedef struct { int on; double p[3], k, pole[3]; } hand_over;
static void pos_event(cm_state *S, const cm_frame *fr, int type, const double local[3], int has_target, const double target[3], int which) {
  cm_event e;
  double d[3];
  memset(&e, 0, sizeof e); e.type = type; e.leg = -1; e.hand = which;
  cm_to_w(fr, local, e.pos);
  if (has_target) { sub3(e.pos, target, d); e.miss = len3(d); }
  cm_event_push(S, &e);
}

/* Horizontal bodies: animals, the quadruped robot, arthropods, the octopus, the spider mech. Worked out in the
   body's frame; cm_step moves the result to the world. */
static void horizontal(cm_state *S, const cm_character *ch, const cm_bctx *B, cm_pose *pose, const act_out *AC, double lean, double FL, double dt) {
  const double *root = B->root;
  double cp = cos(B->pitch + lean * 0.3), sn = sin(B->pitch + lean * 0.3), idle = B->idle, P = B->P;
  cm_action *act = &S->action;
  cm_mount_pose *mp = &pose->mount[0];
  int i;
#define LOC(dst, x, y, z) set3(dst, root[0] + (x) * cp - (y) * sn, root[1] + (x) * sn + (y) * cp, root[2] + (z))
  set3(pose->axis, cp, sn, 0); set3(pose->up, -sn, cp, 0);
  pose->n_mounts = 1; memset(mp, 0, sizeof *mp);
  if (ch->kind == CM_QUAD && ch->has_beast) {
    /* An animal's body: the spine bends in the middle (flex), the neck carries the head high at rest and low and
       forward at speed, the head turns to what it watches, the jaw is hinged, the tail is a chain. */
    const cm_gait_params *gq = &B->gp;
    double flex = B->flex, pa = B->pitch + lean * 0.3 + ch->beast_tilt, fa2 = pa - flex, nb[3], Wb, tb2, carry, na, nlen, hdp[3], ga2, gzb[3], sdb[3], gub[3], jo, hinge[3], jd[3], t[3], sdot;
    int bite = S->act == CM_ACT_BITE;
    cm_jump *Jb = &S->jump;
#define LOCB(dst, x, y) do { double a2_ = pa + ((x) < 0 ? flex : -flex), c2_ = cos(a2_), s2_ = sin(a2_); set3(dst, root[0] + (x) * c2_ - (y) * s2_, root[1] + (x) * s2_ + (y) * c2_, root[2]); } while (0)
    pose->body = CM_BODY_BEAST;
    LOCB(nb, ch->beast_half + 0.03, 0.10);
    Wb = aim_from(S, ch, B, nb, 1, dt); tb2 = S->twist.x;
    cm_spring_step(&S->jaw, AC->jaw, 60, 0.75, dt);
    carry = ch->beast_neck_up * (1 - 0.55 * gq->run - 0.3 * gq->gal) - 0.35 * AC->ext + 0.12 * idle * cm_idle_noise(S->t, P, 5.0) - 0.4 * fmax(0, FL);
    na = fa2 + carry + 0.5 * Wb; nlen = ch->beast_neck * (1 + 0.28 * AC->ext);
    set3(hdp, nb[0] + nlen * cos(na) * cos(0.6 * tb2), nb[1] + nlen * sin(na), nb[2] + nlen * cos(na) * sin(0.6 * tb2));
    ga2 = 0.35 * fa2 + 0.9 * Wb - 0.10 * (1 - AC->alert) + 0.10 * idle * cm_idle_noise(S->t, P, 6.0);
    set3(gzb, cos(ga2) * cos(tb2), sin(ga2), cos(ga2) * sin(tb2));
    if (bite && act->has_target && AC->ext > 0) {
      /* biting at something: the head goes to it as far as the neck will stretch, muzzle first */
      double tl[3], want[3], wd[3], wl, wmax = ch->beast_neck * 1.45, td2[3], tl2;
      cm_to_l(&B->fr, act->target, tl);
      axpy3(tl, gzb, -ch->beast_skull, want); sub3(want, nb, wd); wl = len3(wd); if (wl == 0) wl = 1;
      if (wl > wmax) axpy3(nb, wd, wmax / wl, want);
      lerp3(hdp, want, AC->ext, hdp);
      sub3(tl, hdp, td2); tl2 = len3(td2);
      if (tl2 > 1e-4) { scale3(td2, 1 / tl2, td2); lerp3(gzb, td2, 0.8 * AC->ext, gzb); unit3(gzb); }
    }
    set3(sdb, -sin(tb2), 0, cos(tb2));
    /* keep the head's side vector square to where it looks */
    sdot = dot3(sdb, gzb); axpy3(sdb, gzb, -sdot, sdb); unit3(sdb);
    cross3(sdb, gzb, gub);
    jo = cm_clamp(S->jaw.x, 0, 1.1);
    set3(hinge, hdp[0] + (gzb[0] * 0.02 + gub[0] * -0.035), hdp[1] + (gzb[1] * 0.02 + gub[1] * -0.035), hdp[2] + (gzb[2] * 0.02 + gub[2] * -0.035));
    set3(jd, gzb[0] * cos(jo) + gub[0] * -sin(jo), gzb[1] * cos(jo) + gub[1] * -sin(jo), gzb[2] * cos(jo) + gub[2] * -sin(jo));
    LOCB(pose->back, -ch->beast_back, 0); LOCB(pose->front, ch->beast_half, 0);
    copy3(pose->neck, nb); copy3(pose->head, hdp); copy3(pose->gaze, gzb); copy3(pose->side, sdb);
    copy3(mp->joint, hdp); copy3(mp->base, hinge); axpy3(hinge, jd, ch->beast_jaw, mp->tip); copy3(mp->dir, jd);
    pose->jaw = jo; pose->alert = AC->alert; pose->flex = flex;
    axpy3(hdp, gzb, ch->beast_skull, t);
    if (bite && !act->done && act->t >= 0.365 * act->dur) {
      cm_event e;
      double d[3];
      act->done = 1;
      memset(&e, 0, sizeof e); e.type = CM_EV_BITE; e.leg = -1;
      cm_to_w(&B->fr, t, e.pos);
      set3(e.vel, gzb[0] * cos(S->h) - gzb[2] * sin(S->h), gzb[1], gzb[0] * sin(S->h) + gzb[2] * cos(S->h));
      if (act->has_target) { sub3(e.pos, act->target, d); e.miss = len3(d); }
      cm_event_push(S, &e);
    }
    if (Jb->stage == CM_JUMP_LAND && Jb->pounce && !Jb->struck) { Jb->struck = 1; pos_event(S, &B->fr, CM_EV_POUNCE, t, 0, t, 0); }
    if (ch->has_tail) {
      /* the tail streams out at speed, goes up when the animal is roused, tucks under after a blow, and wags at rest */
      chain_ctl ctl;
      double tbase[3];
      memset(&ctl, 0, sizeof ctl);
      ctl.yaw = ch->tail_wag * idle * sin(4 * TAU * S->t / P) + 0.6 * ch->tail_wag * AC->alert * sin(19 * S->t) + ch->tail_sway * gq->moving * sin(TAU * S->phase);
      ctl.lift = ch->tail_lift * (0.45 * gq->run + 0.75 * gq->gal) + ch->tail_alert * AC->alert - 0.7 * fabs(FL);
      LOCB(tbase, ch->tail_at[0], ch->tail_at[1]);
      tail_step(S, ch, B, tbase, pa + flex, &ctl, dt, pose->tail_pts);
      pose->n_tail_pts = ch->tail_n + 1; copy3(pose->tail, pose->tail_pts[ch->tail_n]);
    } else LOCB(pose->tail, -ch->beast_half - 0.2, 0.05);
#undef LOCB
  } else if (ch->kind == CM_QUAD) {
    double hd[3], Wq, tq, dq[3], qs[3], qup[3], hb[3];
    pose->body = CM_BODY_QUAD;
    LOC(pose->neck, 0.40, 0.08, 0); LOC(hd, 0.60, 0.22, 0);
    Wq = (aim_from(S, ch, B, hd, 1, dt) + 0.2 * idle * cm_idle_noise(S->t, P, 5.0)) * 0.8; tq = S->twist.x;      /* the head turns on the neck */
    set3(dq, cos(Wq) * cos(tq), sin(Wq), cos(Wq) * sin(tq)); set3(qs, -sin(tq), 0, cos(tq));
    LOC(pose->back, -0.36, 0.02, 0); LOC(pose->front, 0.36, 0.02, 0); copy3(pose->head, hd); copy3(pose->gaze, dq); copy3(pose->side, qs);
    LOC(pose->tail, -0.72, 0.16 + pose->pack * 2.2, 0.09 * idle * sin(4 * TAU * S->t / P));
    /* the gun hangs under the head, fixed to it */
    cross3(qs, dq, qup);
    set3(hb, (hd[0] + dq[0] * S->kick[0].x) + qup[0] * -0.07, (hd[1] + dq[1] * S->kick[0].x) + qup[1] * -0.07, (hd[2] + dq[2] * S->kick[0].x) + qup[2] * -0.07);
    copy3(mp->joint, hd); copy3(mp->base, hb); axpy3(hb, dq, 0.34, mp->tip); copy3(mp->dir, dq); mp->flash = S->flash[0];
  } else if (ch->has_octo) {
    /* crawling: the mantle sits behind the head and wobbles after it; each arm is a curve through its leg */
    double breathe = 1 + 0.05 * sin(TAU * S->t / 1.9) - 0.2 * cm_clamp(S->jaw.x, 0, 1), piv[3], seg7 = ch->octo_arm_seg;
    int grab = S->act == CM_ACT_GRAB, k;
    pose->body = CM_BODY_OCTO;
    LOC(piv, 0.15, 0.1, 0); aim_from(S, ch, B, piv, 1, dt);
    LOC(pose->back, -0.2, 0, 0); LOC(pose->front, 0.2, 0, 0); LOC(pose->eye, 0.10, 0.12, 0);
    pose->has_mantle = 1; LOC(pose->mantle_c, -0.10, 0.13, 0); LOC(pose->mantle_tip, -0.40, 0.20 + pose->pack * 2.5, 0.05 * idle * sin(2 * TAU * S->t / P));
    pose->mantle_r = ch->octo_mantle * breathe; copy3(pose->dome, pose->mantle_c);
    pose->n_arms = ch->legs;
    for (i = 0; i < ch->legs; i++) arm_curve(B->hip[i], B->knee[i], B->ankle[i], seg7, pose->arms[i]);
    if (grab) {
      /* the arm nearest the target leaves the ground and reaches for it, link by link */
      double gT[3], best = 1e9, guess[7][3], (*cur)[3], d[3];
      if (act->has_target) cm_to_l(&B->fr, act->target, gT); else LOC(gT, 0.85, 0.35, 0.2);
      if (act->arm < 0) for (i = 0; i < ch->legs; i++) { double dq; sub3(gT, B->hip[i], d); dq = len3(d); if (dq < best) { best = dq; act->arm = i; } }
      cur = pose->arms[act->arm];
      for (k = 0; k <= 6; k++) set3(guess[k], cur[k][0], cur[k][1] + 0.25 * sin(PI * k / 6), cur[k][2]);
      cm_reach_chain(guess, 6, B->hip[act->arm], gT, seg7, 0);
      for (k = 0; k <= 6; k++) lerp3(cur[k], guess[k], AC->ext, cur[k]);
      for (k = 1; k <= 6; k++) { double al2; sub3(cur[k], cur[k - 1], d); al2 = len3(d); if (al2 == 0) al2 = 1; axpy3(cur[k - 1], d, seg7 / al2, cur[k]); }     /* its links keep their length */
      if (!act->done && act->t >= 0.42 * act->dur) { act->done = 1; pos_event(S, &B->fr, CM_EV_GRAB, cur[6], act->has_target, act->target, act->arm); }
    }
    if (AC->ink) {
      cm_event e;
      double ip[3];
      memset(&e, 0, sizeof e); e.type = CM_EV_INK; e.leg = -1;
      LOC(ip, -0.3, 0.1, 0); cm_to_w(&B->fr, ip, e.pos); set3(e.vel, -cos(S->h), 0.2, -sin(S->h));
      cm_event_push(S, &e);
    }
    copy3(pose->tail, pose->arms[0][6]);
    copy3(mp->joint, root); copy3(mp->base, root); copy3(mp->tip, pose->eye); set3(mp->dir, cp, sn, 0);
  } else if (ch->has_arthro) {
    /* A scorpion-like body: a low carapace, two clawed arms held out in front, and a tail curled up over the back.
       The claws drift towards what is being watched; one shoots out to pinch. The tail is the same chain as any
       other tail, with a rest shape that curls forward, and a strike that drags it onto a target. */
    int pinch = S->act == CM_ACT_PINCH, sting = S->act == CM_ACT_STING, has_pT = 0, cs;
    double piv[3], pT[3] = { 0, 0, 0 };
    pose->body = CM_BODY_ARTHRO;
    LOC(piv, ch->arthro_half, 0.05, 0); aim_from(S, ch, B, piv, 1, dt);
    cm_spring_step(&S->jaw, AC->jaw, 60, 0.8, dt);
    LOC(pose->back, -ch->arthro_half, 0, 0); LOC(pose->front, ch->arthro_half, 0, 0); LOC(pose->dome, 0.04, 0.05, 0);
    if (ch->arthro_has_head) LOC(pose->eye, ch->arthro_head[0], ch->arthro_head[1], 0); else LOC(pose->eye, ch->arthro_half + 0.02, 0.07, 0);
    if (ch->arthro_has_thorax) { pose->has_thorax = 1; LOC(pose->thorax[0], ch->arthro_thorax[0], ch->arthro_thorax[1], 0); LOC(pose->thorax[1], ch->arthro_thorax[2], ch->arthro_thorax[3], 0); }
    if (ch->has_claw && pinch) {
      has_pT = 1;
      if (act->has_target) cm_to_l(&B->fr, act->target, pT);
      else if (ch->claw_has_strike_at) LOC(pT, ch->claw_strike_at[0], ch->claw_strike_at[1], ch->claw_strike_at[2]);
      else LOC(pT, ch->claw_rest[0] + 0.28, ch->claw_rest[1] + 0.05, 0.12);
    }
    if (has_pT && !act->side) act->side = pT[2] - root[2] >= 0 ? 1 : -1;
    for (cs = 0; ch->has_claw && cs < 2; cs++) {
      int sg = cs == 0 ? 1 : -1, mine = has_pT && (ch->arthro_both || act->side == sg);
      cm_claw_pose *cl = &pose->claw[cs];
      double shc[3], tipT[3], open = 0.4 + 0.25 * AC->alert, rd[3], rl, hdv[3], tgt[3], pole[3], inw[3], io, fd3[3];
      LOC(shc, ch->claw_at[0], ch->claw_at[1], sg * ch->claw_at[2]);
      LOC(tipT, ch->claw_rest[0], ch->claw_rest[1] + 0.03 * idle * cm_idle_noise(S->t, P, 3 + cs), sg * ch->claw_rest[2]);
      if (B->has_aim) { tipT[1] += cm_clamp(0.3 * (B->aim[1] - tipT[1]), -0.08, 0.3); tipT[2] += cm_clamp(0.3 * (B->aim[2] - tipT[2]), -0.18, 0.18); }
      if (mine) {
        double to[3];
        copy3(to, pT); if (ch->arthro_both) to[2] = pT[2] + sg * 0.06;
        lerp3(tipT, to, AC->ext, tipT); open = (0.4 + 0.8 * cm_clamp(S->jaw.x, 0, 1)) * (1 - 0.9 * AC->shut);
      }
      /* the hand points mostly forwards, turning towards what it reaches for */
      sub3(tipT, shc, rd); rl = len3(rd); if (rl == 0) rl = 1;
      set3(hdv, 0.5 * cp + 0.5 * rd[0] / rl, 0.5 * sn + 0.5 * rd[1] / rl, 0.5 * rd[2] / rl); unit3(hdv);
      axpy3(tipT, hdv, -ch->claw_hand, tgt); set3(pole, 0, 1, sg * 0.8);
      set3(tgt, tipT[0] - hdv[0] * ch->claw_hand, tipT[1] - hdv[1] * ch->claw_hand, tipT[2] - hdv[2] * ch->claw_hand);
      cm_ik2(shc, tgt, ch->claw_upper, ch->claw_lower, pole, cl->elbow, cl->wrist);
      copy3(cl->shoulder, shc); axpy3(cl->wrist, hdv, ch->claw_hand, cl->tip);
      set3(inw, 0, 0, -sg); io = dot3(inw, hdv); axpy3(inw, hdv, -io, inw); unit3(inw);
      axpy3(cl->wrist, hdv, 0.30 * ch->claw_hand, cl->finger_a);
      set3(fd3, hdv[0] * cos(open) + inw[0] * sin(open), hdv[1] * cos(open) + inw[1] * sin(open), hdv[2] * cos(open) + inw[2] * sin(open));
      axpy3(cl->finger_a, fd3, 0.72 * ch->claw_hand, cl->finger_b);
      cl->side = sg; cl->open = open; pose->n_claws = cs + 1;
      if (mine && !act->done && act->t >= 0.41 * act->dur) { act->done = 1; pos_event(S, &B->fr, CM_EV_PINCH, cl->tip, act->has_target, act->target, cs); }
    }
    if (ch->has_tail) {
      int n = ch->tail_n, rk;
      double tb3[3], sT[3] = { 0, 0, 0 }, rp[CM_MAX_CHAIN + 1][3], seg = ch->tail_seg, d[3];
      chain_ctl ctl;
      memset(&ctl, 0, sizeof ctl);
      LOC(tb3, ch->tail_at[0], ch->tail_at[1], 0);
      if (sting) {
        if (act->has_target) cm_to_l(&B->fr, act->target, sT);
        else if (ch->arthro_has_sting_at) LOC(sT, ch->arthro_sting_at[0], ch->arthro_sting_at[1], 0);
        else LOC(sT, ch->arthro_half + 0.42, 0.02, 0);
        if (AC->sting > 0) {
          /* a first guess that arches over the back, then links of the right length fitted to it
             (a wasp's sting curls round from below) */
          double top = ch->arthro_under ? fmin(tb3[1], sT[1]) - 0.3 * n * seg : fmax(tb3[1], sT[1]) + 0.42 * n * seg, clear_y = root[1] + 0.40;
          for (rk = 0; rk <= n; rk++) {
            double gt = (double)rk / n, g1 = 1 - gt;
            set3(rp[rk], g1 * g1 * tb3[0] + 2 * g1 * gt * (0.5 * tb3[0] + 0.5 * sT[0]) + gt * gt * sT[0], g1 * g1 * tb3[1] + 2 * g1 * gt * top + gt * gt * sT[1],
                 g1 * g1 * tb3[2] + 2 * g1 * gt * 0.5 * (tb3[2] + sT[2]) + gt * gt * sT[2]);
          }
          /* it must go over the body, not through it: links above the back are kept clear of it */
          cm_reach_chain(rp, n, tb3, sT, seg, 0.86);
          if (!ch->arthro_under) for (rk = 1; rk < n; rk++) if (rp[rk][0] < root[0] + ch->arthro_half + 0.12 && rp[rk][1] < clear_y) rp[rk][1] = clear_y;
          for (rk = 1; rk <= n; rk++) { double rl2; sub3(rp[rk], rp[rk - 1], d); rl2 = len3(d); if (rl2 == 0) rl2 = 1; axpy3(rp[rk - 1], d, seg / rl2, rp[rk]); }
          ctl.pull_pts = rp; ctl.pull_k = AC->sting;
        }
      }
      ctl.lift = -0.45 * AC->rear - 0.25 * fabs(FL); ctl.curl = -0.10 * AC->rear;
      ctl.yaw = ch->tail_wag * idle * sin(2 * TAU * S->t / P) + ch->tail_sway * B->gp.moving * sin(TAU * S->phase) + 0.4 * S->twist.x;
      tail_step(S, ch, B, tb3, B->pitch + lean * 0.3, &ctl, dt, pose->tail_pts);
      pose->n_tail_pts = n + 1; copy3(pose->tail, pose->tail_pts[n]);
      copy3(mp->joint, pose->tail_pts[n - 1]); copy3(mp->base, pose->tail_pts[n - 1]); copy3(mp->tip, pose->tail_pts[n]);
      sub3(pose->tail_pts[n], pose->tail_pts[n - 1], mp->dir); unit3(mp->dir);
      if (sting && !act->done && act->t >= 0.42 * act->dur) { act->done = 1; pos_event(S, &B->fr, CM_EV_STING, pose->tail_pts[n], act->has_target, act->target, 0); }
    } else { copy3(pose->tail, pose->back); copy3(mp->joint, root); copy3(mp->base, root); copy3(mp->tip, pose->eye); set3(mp->dir, cp, sn, 0); }
  } else {
    double tb[3], Wh, tt, dh[3], bb[3];
    pose->body = CM_BODY_SPIDER;
    LOC(tb, 0.05, 0.72, 0);
    Wh = aim_from(S, ch, B, tb, 1, dt); tt = S->twist.x;        /* the turret goes all the way round */
    set3(dh, cos(Wh) * cos(tt), sin(Wh), cos(Wh) * sin(tt));
    axpy3(tb, dh, S->kick[0].x, bb);
    LOC(pose->back, -0.5, 0.12, 0); LOC(pose->front, 0.5, 0.12, 0); LOC(pose->dome, -0.05, 0.36, 0); LOC(pose->eye, 1.0, 0.08, 0);
    copy3(mp->joint, tb); copy3(mp->base, bb); axpy3(bb, dh, 1.45, mp->tip); copy3(mp->dir, dh); mp->flash = S->flash[0];
  }
#undef LOC
}


static void point_w(const cm_frame *fr, double p[3]) { double t[3]; cm_to_w(fr, p, t); copy3(p, t); }
static void dir_w(const cm_frame *fr, double d[3]) {
  double x, z;
  if (fr->seat) { const cm_seat *q = fr->seat; double a = d[0], b = d[1], c = d[2]; set3(d, q->ax[0] * a + q->up[0] * b + q->sv[0] * c, q->ax[1] * a + q->up[1] * b + q->sv[1] * c, q->ax[2] * a + q->up[2] * b + q->sv[2] * c); }
  x = d[0] * fr->hc - d[2] * fr->hs; z = d[0] * fr->hs + d[2] * fr->hc; d[0] = x; d[2] = z;
}

typedef struct { const cm_frame *fr; const double *fixed; int roll; double c[3], ax[3], cs, sn; } xform;
static void x_dir(const xform *x, double d[3]) {
  if (x->roll) { double dp = dot3(x->ax, d) * (1 - x->cs), r[3]; cross3(x->ax, d, r); set3(d, d[0] * x->cs + r[0] * x->sn + x->ax[0] * dp, d[1] * x->cs + r[1] * x->sn + x->ax[1] * dp, d[2] * x->cs + r[2] * x->sn + x->ax[2] * dp); }
  else if (x->fixed) { double dx = d[0] * x->fixed[3] - d[2] * x->fixed[4], dz = d[0] * x->fixed[4] + d[2] * x->fixed[3]; d[0] = dx; d[2] = dz; }
  else dir_w(x->fr, d);
}
static void x_pt(const xform *x, double p[3]) {
  if (x->roll) { double v[3]; sub3(p, x->c, v); x_dir(x, v); add3(x->c, v, p); }
  else if (x->fixed) { double px = p[0] - x->fixed[0], pz = p[2]; set3(p, x->fixed[1] + px * x->fixed[3] - pz * x->fixed[4], p[1], x->fixed[2] + px * x->fixed[4] + pz * x->fixed[3]); }
  else point_w(x->fr, p);
}
/* every point and direction of a horizontal body's pose, rolled about its long axis or moved to the world */
static void x_pose(const xform *x, cm_pose *pose, int legs) {
  int k, j;
  x_dir(x, pose->axis); x_dir(x, pose->up); x_pt(x, pose->back); x_pt(x, pose->front); x_pt(x, pose->tail);
  if (pose->body == CM_BODY_BEAST || pose->body == CM_BODY_QUAD) { x_pt(x, pose->neck); x_pt(x, pose->head); x_dir(x, pose->gaze); x_dir(x, pose->side); }
  else { x_pt(x, pose->dome); x_pt(x, pose->eye); }
  x_pt(x, pose->mount[0].joint); x_pt(x, pose->mount[0].base); x_pt(x, pose->mount[0].tip); x_dir(x, pose->mount[0].dir);
  for (k = 0; k < pose->n_tail_pts; k++) x_pt(x, pose->tail_pts[k]);
  for (k = 0; k < pose->n_claws; k++) {
    cm_claw_pose *cl = &pose->claw[k];
    x_pt(x, cl->shoulder); x_pt(x, cl->elbow); x_pt(x, cl->wrist); x_pt(x, cl->tip); x_pt(x, cl->finger_a); x_pt(x, cl->finger_b);
  }
  if (pose->has_thorax) { x_pt(x, pose->thorax[0]); x_pt(x, pose->thorax[1]); }
  for (k = 0; k < pose->n_arms; k++) for (j = 0; j < 7; j++) x_pt(x, pose->arms[k][j]);
  if (pose->has_mantle) { x_pt(x, pose->mantle_c); x_pt(x, pose->mantle_tip); }
  for (k = 0; k < pose->n_wings; k++) { cm_wing_pose *w = &pose->wing[k]; x_pt(x, w->root); x_pt(x, w->mid); x_pt(x, w->tip); x_dir(x, w->t1); x_dir(x, w->t2); }
  if (legs) {
    x_pt(x, pose->base.root);
    for (k = 0; k < pose->base.legs; k++) { cm_leg_pose *l = &pose->base.leg[k]; x_pt(x, l->hip); x_pt(x, l->knee); x_pt(x, l->ankle); x_pt(x, l->ball); if (l->has_foot) { x_pt(x, l->heel); x_pt(x, l->toe); } }
  }
}

/* The upper body, weapons and actions, on legs that are already worked out. On the ground the legs in pose->base are
   in the world already; flying (wing_a, wing_a2: the wings' stroke), they are in the body's frame and are rolled and moved
   with the rest. */
static int body_step(cm_state *S, const cm_character *ch, const cm_input *inp, const cm_style *st, double dt, const cm_bctx *Bp, cm_pose *pose, int flying, double wing_a, double wing_a2) {
  cm_bctx B = *Bp;
  act_out AC;
  const double *root;
  double lean, FL, bank, sway0, u[3], f[3], zax[3];
  int biped = ch->kind == CM_BIPED, kit_want, busy, ready, i;

  root = B.root;
  /* kits: the weapons are put away before changing to another set, then the new ones come up */
  kit_want = ch->mount_type == CM_MOUNT_HELD ? (kit_fits(ch, inp->kit) ? inp->kit : S->kit) : CM_KIT_NONE;
  if (biped) act_tick(S, ch, inp, dt, &B, &AC);
  else if (ch->has_beast) beast_tick(S, ch, inp, dt, &AC);
  else if (ch->has_arthro) arthro_tick(S, ch, inp, dt, &AC);
  else if (ch->has_octo) octo_tick(S, inp, dt, &AC);
  else memset(&AC, 0, sizeof AC);
  /* hands that are busy with a load or a fight cannot hold weapons: those are put away first */
  busy = S->carry || S->guard.x > 0.05 || (biped && inp->guard);
  ready = (inp->armed || ch->mount_civil) && kit_want == S->kit && !busy;
  if (ch->mount_type == CM_MOUNT_HELD && kit_want != S->kit && S->armed.x < 0.04) { S->kit = kit_want; full_ammo(S); S->gun = 0; }
  if (!ready && S->act == CM_ACT_RELOAD) S->act = CM_ACT_NONE;
  if (inp->reload) cm_start_reload(S, ch, 1);
  fire_control(S, ch, inp, dt);
  cm_spring_step(&S->lean, (B.lean_base + AC.lean) * (biped ? 1 : 0.45), 38 / B.Tn, 0.8, dt);
  cm_spring_step(&S->armed, ready ? 1 : 0, 14, 1, dt);
  cm_spring_step(&S->flinch, 0, 27 / B.Tn, 0.5, dt);
  lean = S->lean.x; FL = cm_clamp(S->flinch.x, -0.3, 1.2); bank = B.bank; sway0 = B.sway0;
  set3(u, sin(lean), cos(lean), 0); set3(f, cos(lean), -sin(lean), 0); set3(zax, 0, 0, 1);
  pose->lean = lean; pose->pack = cm_clamp(S->pack.x, -0.06 * ch->L, 0.06 * ch->L);

  if (!biped && ch->kind != CM_MECH) {
    xform x;
    horizontal(S, ch, &B, pose, &AC, lean, FL, dt);
    /* on the ground the wings are folded along the body */
    if (ch->has_fly) { wing_pose(ch, root, flying ? B.fly_ax : pose->axis, flying ? B.fly_up : pose->up, flying ? wing_a : 0, flying ? wing_a2 : 0, flying ? 0 : 1, pose->wing); pose->n_wings = 2; }
    memset(&x, 0, sizeof x); x.fr = &B.fr;
    if (flying) {
      /* the whole body banks: it is rolled about its long axis */
      x.roll = 1; copy3(x.c, root); copy3(x.ax, B.fly_ax); x.cs = cos(S->bank.x); x.sn = sin(S->bank.x);
      copy3(pose->base.root, root); pose->flying = 1;
      x_pose(&x, pose, 1);
      x.roll = 0;
    }
    x_pose(&x, pose, flying);
    return 0;
  }
  pose->body = biped ? CM_BODY_BIPED : CM_BODY_MECH;
  if (ch->kind == CM_MECH) {
    double pc[3], piv[3], Wm, tm, dm[3], d0[3];
    int g;
    set3(pc, root[0] + u[0] * ch->pod_h, root[1] + u[1] * ch->pod_h, root[2] + u[2] * ch->pod_h);
    pc[2] += bank * ch->pod_h;
    set3(piv, pc[0] + 0.1, pc[1] + -0.3, pc[2] + 0);
    Wm = aim_from(S, ch, &B, piv, 1, dt); tm = S->twist.x;        /* the hull turns on the hips */
    set3(d0, cos(Wm), sin(Wm), 0); twd(u, d0, tm, dm);
    copy3(pose->chest, pc); copy3(pose->u, u); twd(u, f, tm, pose->f); twd(u, zax, tm, pose->side);
    pose->n_mounts = 2;
    for (g = 0; g < 2; g++) {
      int sd = g == 0 ? 1 : -1;
      cm_mount_pose *mp = &pose->mount[g];
      double v[3], t[3], b[3];
      set3(v, 0.1 * f[0] - 0.3 * u[0], 0.1 * f[1] - 0.3 * u[1], sd * ch->pod_gun_z);
      twd(u, v, tm, t); add3(pc, t, mp->joint);
      set3(b, mp->joint[0] + dm[0] * S->kick[g].x, mp->joint[1] + dm[1] * S->kick[g].x, mp->joint[2] + dm[2] * S->kick[g].x);
      set3(mp->base, b[0] + dm[0] * -0.35, b[1] + dm[1] * -0.35, b[2] + dm[2] * -0.35);
      set3(mp->tip, b[0] + dm[0] * ch->pod_gun_len, b[1] + dm[1] * ch->pod_gun_len, b[2] + dm[2] * ch->pod_gun_len);
      copy3(mp->dir, dm); mp->flash = S->flash[g]; mp->side = sd;
      point_w(&B.fr, mp->joint); point_w(&B.fr, mp->base); point_w(&B.fr, mp->tip); dir_w(&B.fr, mp->dir);
    }
    point_w(&B.fr, pose->chest); dir_w(&B.fr, pose->u); dir_w(&B.fr, pose->f); dir_w(&B.fr, pose->side);
    return 0;
  }

  {
    const cm_gait_params *gp = &B.gp;
    const kit_def *kit = held_kit(S, ch);
    cm_action *act = &S->action;
    double e = S->armed.x, breath, chest[3], hl, hr_, head[3], piv[3], W, tws, rs = -1, q = 0, eP[2], eH[2], tk = 0, gA, swing, gz, fa[3], fal, g0[3];
    double *hold[2] = { 0, 0 }, hp[3];
    int an, np = 0, in_hand, s;
    cm_prop_pose *props = pose->prop;
    hand_over HO[2];
    cm_arm_pose *arms = pose->arm;

    breath = 0.007 * ch->L * B.idle * sin(TAU * S->t / B.P);
    set3(chest, root[0] + u[0] * ch->torso_len, root[1] + u[1] * ch->torso_len + breath, root[2] - 0.5 * sway0 + bank * ch->torso_len);
    hl = lean * 0.35 + 0.5 * FL * S->flinch_dir;
    hr_ = ch->torso_neck + ch->torso_head_r * 0.7;
    set3(head, chest[0] + sin(hl) * hr_, chest[1] + cos(hl) * hr_, chest[2] + bank * hr_);
    set3(piv, chest[0] + (u[0] * -0.11 + f[0] * 0.10), chest[1] + (u[1] * -0.11 + f[1] * 0.10), chest[2] + (u[2] * -0.11 + f[2] * 0.10));
    W = aim_from(S, ch, &B, piv, cm_lerp(0.5, 1, e), dt) + st->bounce * 0.012 * gp->moving * sin(2 * TAU * S->phase) + 0.25 * FL;
    /* the turn of everything above the hips: sideways aim plus whatever the action adds */
    tws = S->twist.x + AC.tw;

    /* the action in progress: rs is how far through the reload of gun act->gun we are, q how far through any other */
    if (S->act == CM_ACT_RELOAD && kit) {
      const prop_def *AD = &PROPS[kit->props[act->gun]];
      act->t += dt; rs = act->t / act->dur;
      if (!act->done && rs >= AD->seat) { act->done = 1; S->ammo[act->gun] = AD->rounds; S->kick[act->gun].v += 0.6; simple_event(S, CM_EV_LOADED, act->gun); }
      if (rs >= 1) {
        act->queue[0] = act->queue[1]; act->n_queue--;
        if (act->n_queue > 0) { act->gun = act->queue[0]; act->t = 0; act->done = 0; act->dur = PROPS[kit->props[act->gun]].reload * sqrt(ch->L / 0.92); rs = 0; }
        else { S->act = CM_ACT_NONE; rs = -1; }
      }
    }
    an = S->act;
    q = an ? fmin(act->t / act->dur, 1) : 0;

    /* eP: how far each prop is out of its holster; eH: how much each hand is on its weapon.
       A throw takes the right hand away: the rifle is left to the other hand, a pistol goes back in its holster. */
    eP[0] = eP[1] = eH[0] = eH[1] = e;
    if (an == CM_ACT_THROW) { tk = cm_smooth(0, 0.16, q) * (1 - cm_smooth(0.82, 1, q)); eH[0] = e * (1 - tk); if (kit && kit->props[0] == CM_PROP_PISTOL) eP[0] = eH[0]; }

    if (kit) for (i = 0; i < kit->n; i++) {
      int kind = kit->props[i];
      double rel = an == CM_ACT_RELOAD && act->gun == i ? rs : -1, Wi = W, slide = 0;
      place_t place;
      cm_prop_pose *w = &props[np];
      if (kind == CM_PROP_RIFLE && rel >= 0) Wi -= 0.32 * cm_smooth(0, 0.12, rel) * (1 - cm_smooth(0.84, 1, rel));     /* muzzle dips while the hand is away */
      if (kind == CM_PROP_RIFLE) Wi -= 0.45 * tk;
      place = ready_place(kind, i, chest, u, f, Wi, S->kick[i].x);
      if (kind == CM_PROP_PISTOL && rel >= 0) {
        /* one-handed: the pistol comes down to the belt, the magazine drops into the holder and a fresh one is pushed home */
        place = mix_place(place, belt_place(i, root, u, f), cm_smooth(0, 0.3, rel) * (1 - cm_smooth(0.66, 1, rel)));
        slide = 0.10 * (cm_smooth(0.30, 0.42, rel) - cm_smooth(0.48, 0.60, rel));
      }
      if (kind == CM_PROP_SWORD && an == CM_ACT_SWING) {
        double wd = AC.wind, ht = AC.hit, so[2];
        if (act->kind == CM_SWING_SLASH) { place.th = cm_lerp(place.th, 0.30 - 0.2 * ht, fmax(wd, ht)); so[0] = -0.05 * wd + 0.20 * ht; so[1] = 0.14 * wd + 0.16 * ht; }
        else if (act->kind == CM_SWING_CHOP) { place.th = cm_lerp(cm_lerp(place.th, 2.35, wd), -0.30, ht); so[0] = -0.06 * wd + 0.22 * ht; so[1] = 0.30 * wd + 0.12 * ht; }
        else { place.th = cm_lerp(place.th, 0.05, fmax(wd, ht)); so[0] = -0.14 * wd + 0.30 * ht; so[1] = 0.14 * wd + 0.20 * ht; place.z = cm_lerp(place.z, chest[2] + 0.12, ht); }
        place.o[0] = place.o[0] + f[0] * so[0] + u[0] * so[1]; place.o[1] = place.o[1] + f[1] * so[0] + u[1] * so[1];
      }
      if (kind == CM_PROP_CASE) {
        /* it swings a little with the arm that holds it, against the leg on that side */
        double cs = -0.09 * st->arm * gp->moving * S->leg[0].fwd;
        place.o[0] = place.o[0] + cs; place.o[1] = place.o[1] + 0.8 * cs * cs; place.th = 0.5 * cs;
      }
      if (kind == CM_PROP_TROLLEY) {
        /* the hand stays where it is; the axle is put on the ground behind, wherever the ground is there */
        const prop_def *PT = &PROPS[CM_PROP_TROLLEY];
        double hx = place.o[0] + PT->len * cos(place.th), hy = place.o[1] + PT->len * sin(place.th);
        int pass;
        for (pass = 0; pass < 2; pass++) {                    /* twice: where the axle comes to rest depends on how high the ground is there */
          double gw = cm_ter(&B.fr, place.o[0], place.z);
          if (gw > hy - 1.3 * PT->len) {
            double tt = asin(cm_clamp((hy - gw - TROLLEY_WHEEL) / PT->len, 0.12, 0.97));
            place.o[0] = hx - PT->len * cos(tt); place.o[1] = hy - PT->len * sin(tt); place.th = tt;
          }
        }
      }
      if (kind == CM_PROP_SHIELD) {
        /* blocking brings the shield up and across in front of the face and chest; a swing of the sword opens it a little */
        double bk2 = cm_clamp(S->block.x, 0, 1), opn = an == CM_ACT_SWING ? 0.5 * AC.hit : 0;
        place.o[0] = place.o[0] + f[0] * (0.08 * bk2 - 0.06 * opn) + u[0] * 0.20 * bk2; place.o[1] = place.o[1] + f[1] * (0.08 * bk2 - 0.06 * opn) + u[1] * 0.20 * bk2;
        place.z = cm_lerp(place.z, chest[2] - 0.04, bk2) - 0.08 * opn;
      }
      place = mix_place(stow_place(kind, i, root, u, f, chest[2]), place, eP[i]);
      prop_at(kind, place.o, place.th, place.z, w);
      w->flash = S->flash[i]; w->stow = 1 - eP[i];
      if (slide != 0) {
        w->mag_a[0] = w->mag_a[0] - w->up[0] * slide; w->mag_a[1] = w->mag_a[1] - w->up[1] * slide;
        w->mag_b[0] = w->mag_b[0] - w->up[0] * slide; w->mag_b[1] = w->mag_b[1] - w->up[1] * slide;
      }
      np++;
    }
    pose->n_props = np;
    /* hands: the right hand holds prop 0; the left holds prop 1, or the foregrip of a two-handed prop */
    if (np) { hold[0] = props[0].grip; hold[1] = np > 1 ? props[1].grip : props[0].has_fore ? props[0].fore : 0; }
    if (an == CM_ACT_RELOAD && act->gun == 0 && np && props[0].kind == CM_PROP_RIFLE) {
      /* reloading the rifle: the off hand leaves the foregrip, takes the magazine to the pouch on the hip, comes back
         with a fresh one, seats it and returns. Every waypoint is a live point, so it works on the move. */
      cm_prop_pose *w0 = &props[0];
      double nn[3], seat[3], mlen = 0.115, kq = 0, pouch[3], below[3];
      int mag_held = 1;
      copy3(nn, w0->up); copy3(seat, w0->mag_b);
      set3(pouch, root[0] + 0.10 * u[0] + 0.12 * f[0], root[1] + 0.10 * u[1] + 0.12 * f[1], root[2] - 0.16);
      set3(below, seat[0] - 0.07 * nn[0], seat[1] - 0.07 * nn[1], seat[2]);
      if (rs < 0.16) { lerp3(w0->fore, seat, cm_smooth(0, 0.16, rs), hp); mag_held = 0; }
      else if (rs < 0.40) { double pull; kq = cm_smooth(0.16, 0.40, rs); lerp3(seat, pouch, kq, hp); pull = 0.06 * sin(PI * kq); hp[0] -= nn[0] * pull; hp[1] -= nn[1] * pull; }
      else if (rs < 0.50) { kq = 1; set3(hp, pouch[0], pouch[1] - 0.025 * sin(PI * (rs - 0.40) / 0.10), pouch[2]); }
      else if (rs < 0.74) { kq = 1 - cm_smooth(0.50, 0.74, rs); lerp3(below, pouch, kq, hp); }
      else if (rs < 0.80) lerp3(below, seat, cm_smooth(0.74, 0.80, rs), hp);
      else { lerp3(seat, w0->fore, cm_smooth(0.80, 1, rs), hp); mag_held = 0; }
      hold[1] = hp;
      if (mag_held) {
        double mx = cm_lerp(nn[0], u[0], kq), my = cm_lerp(nn[1], u[1], kq), ml = sqrt(mx * mx + my * my);
        if (ml == 0) ml = 1;
        copy3(w0->mag_b, hp); set3(w0->mag_a, hp[0] + mx / ml * mlen, hp[1] + my / ml * mlen, hp[2]);
      }
    }

    /* Hands taken over by an action. Each entry is a target for that hand, how firmly it applies (k) and which way
       the elbow points. Targets are worked out before the torso's turn is applied; a point that must stay put in
       the world or on the hips is turned back first (unturn), so that it ends up there. */
    memset(HO, 0, sizeof HO);
    gA = cm_clamp(S->guard.x, 0, 1);
#define FROM_CHEST(dst, fw, up2, right) set3(dst, chest[0] + f[0] * (fw) + u[0] * (up2), chest[1] + f[1] * (fw) + u[1] * (up2), chest[2] + (right))
    if (gA > 0.01) {
      /* on guard: lead (left) fist out in front of the chin, rear fist by the jaw; blocking pulls both in and up */
      double bk = cm_clamp(S->block.x, 0, 1);
      HO[0].on = 1; FROM_CHEST(HO[0].p, cm_lerp(0.17, 0.15, bk), cm_lerp(0.03, 0.12, bk), 0.08); HO[0].k = gA; set3(HO[0].pole, -0.2, -1, 0.5);
      HO[1].on = 1; FROM_CHEST(HO[1].p, cm_lerp(0.27, 0.20, bk), cm_lerp(0.05, 0.13, bk), -0.09); HO[1].k = gA; set3(HO[1].pole, -0.2, -1, -0.5);
      if (an == CM_ACT_PUNCH) {
        int ph = act->hand, sd2 = ph == 0 ? 1 : -1;
        double PT[3], t[3];
        if (act->has_target) { cm_to_l(&B.fr, act->target, t); twp(u, t, chest, -tws, PT); } else FROM_CHEST(PT, 0.62, 0.06, 0);
        if (act->kind == CM_PUNCH_HOOK) {
          /* the fist goes out to the side with the elbow raised, then the turn of the body brings it round */
          double sidep[3], m1[3], pl[3];
          FROM_CHEST(sidep, 0.20, 0.02, sd2 * 0.36);
          lerp3(HO[ph].p, sidep, AC.load, m1); lerp3(m1, PT, AC.ext, HO[ph].p);
          set3(pl, 0, 0.3, sd2); lerp3(HO[ph].pole, pl, AC.load, HO[ph].pole);
        } else lerp3(HO[ph].p, PT, AC.ext, HO[ph].p);
      }
      /* remember where the fists are, measured from the chest, so that the next punch can start from there */
      for (i = 0; i < 2; i++) {
        double hx2 = HO[i].p[0] - chest[0], hy2 = HO[i].p[1] - chest[1], hr[3];
        set3(hr, hx2 * f[0] + hy2 * f[1], hx2 * u[0] + hy2 * u[1], HO[i].p[2] - chest[2]);
        if (an == CM_ACT_PUNCH && act->has_rel0[i] && act->t < 0.1) { lerp3(act->rel0[i], hr, cm_smooth(0, 0.1, act->t), hr); FROM_CHEST(HO[i].p, hr[0], hr[1], hr[2]); }
        copy3(S->ho_rel[i], hr); S->has_ho_rel[i] = 1;
      }
    } else S->has_ho_rel[0] = S->has_ho_rel[1] = 0;
    if (an == CM_ACT_THROW) {
      /* right hand: to the belt for the grenade, back behind the shoulder, over the top, and through */
      double belt0[3], belt[3], back[3], fol[3], tp[3];
      set3(belt0, root[0] + 0.10 * u[0] + 0.06 * f[0], root[1] + 0.10 * u[1] + 0.06 * f[1], root[2] + 0.17);
      twp(u, belt0, chest, -tws, belt);
      FROM_CHEST(back, -0.22, 0.16, 0.30); FROM_CHEST(fol, 0.42, -0.06, 0.02);
      if (q < 0.24) copy3(tp, belt);
      else if (q < 0.56) lerp3(belt, back, cm_smooth(0.24, 0.52, q), tp);
      else if (q < 0.72) { double sq = cm_smooth(0.56, 0.72, q), arc = 0.34 * sin(PI * sq); lerp3(back, fol, sq, tp); tp[0] += u[0] * arc; tp[1] += u[1] * arc; }
      else copy3(tp, fol);
      HO[0].on = 1; copy3(HO[0].p, tp); HO[0].k = cm_smooth(0, 0.18, q) * (1 - cm_smooth(0.80, 1, q)); set3(HO[0].pole, -0.6, 0.1, 0.8);
    }
    if (S->carry) {
      /* the crate: resting at its place in the world, or held in front of the hips, or on the way between the two */
      const cm_carry *crate = &S->crate;
      const double *cz = crate->size;      /* d, h, w */
      double cb[3], at_l[3], cc[3], yr, fbx, fby, fbl, cf[3], cs[3], cu[3];
      set3(cb, root[0] + f[0] * (0.12 + cz[0] / 2) + u[0] * 0.17, root[1] + f[1] * (0.12 + cz[0] / 2) + u[1] * 0.17, root[2]);
      cm_to_l(&B.fr, crate->at, at_l); lerp3(at_l, cb, crate->ca, cc);
      yr = crate->yaw * (1 - crate->ca);
      if (crate->held && an) {
        /* while it is in the hands it cannot be further from the shoulders than the arms are long */
        double sm[3], hm[3], lat2, hmax, hd2[3], hdl;
        set3(sm, chest[0] - 0.04 * u[0], chest[1] - 0.04 * u[1], root[2]); set3(hm, cc[0], cc[1] + 0.25 * cz[1], cc[2]);
        lat2 = fmax(0, cz[2] / 2 + 0.015 - ch->torso_shoulder_w);
        hmax = sqrt(pow(0.99 * (ch->arm_upper + ch->arm_lower), 2) - lat2 * lat2);
        sub3(hm, sm, hd2); hdl = len3(hd2);
        if (hdl > hmax) { double kx = hmax / hdl - 1; set3(cc, cc[0] + hd2[0] * kx, cc[1] + hd2[1] * kx, cc[2] + hd2[2] * kx); }
      }
      /* it is kept nearly level: only a third of the body's lean reaches it */
      fbx = cm_lerp(1, f[0], 0.33 * crate->ca); fby = cm_lerp(0, f[1], 0.33 * crate->ca); fbl = sqrt(fbx * fbx + fby * fby);
      set3(cf, fbx / fbl * cos(yr), fby / fbl, fbx / fbl * sin(yr)); set3(cs, -sin(yr), 0, cos(yr));
      set3(cu, cs[1] * cf[2] - cs[2] * cf[1], cs[2] * cf[0] - cs[0] * cf[2], cs[0] * cf[1] - cs[1] * cf[0]);
      for (i = 0; i < 2; i++) {
        int sd2 = i == 0 ? 1 : -1;
        double a1 = 0.25 * cz[1], a2 = sd2 * (cz[2] / 2 + 0.015), p[3];
        set3(p, cc[0] + (cu[0] * a1 + cs[0] * a2), cc[1] + (cu[1] * a1 + cs[1] * a2), cc[2] + (cu[2] * a1 + cs[2] * a2));
        HO[i].on = 1; twp(u, p, chest, -tws, HO[i].p); HO[i].k = crate->hk; set3(HO[i].pole, -0.5, -0.7, sd2 * 0.7);
      }
      pose->has_carry = 1;
      copy3(pose->carry.c, cc); copy3(pose->carry.f, cf); copy3(pose->carry.u, cu); copy3(pose->carry.side, cs); copy3(pose->carry.size, cz); pose->carry.held = crate->held;
    }
#undef FROM_CHEST

    /* reins or handles, unless the hand is busy */
    if (B.has_hands) for (i = 0; i < 2; i++) if (!HO[i].on || !(HO[i].k > 0)) { HO[i].on = 1; twp(u, B.hands[i], chest, -tws, HO[i].p); HO[i].k = 1 - eH[i]; set3(HO[i].pole, -0.2, -1, i == 0 ? 0.5 : -0.5); }
    swing = st->arm * 0.2 * gp->moving * B.leg0_side * S->leg[0].fwd * (1 - 0.7 * e);
    for (s = 0; s < 2; s++) {
      int side = s == 0 ? 1 : -1;
      double sh[3], th, el, eb[3], fr_[3], hk, hand[3], pole[3], p0[3], p1[3], mid[3], end[3];
      set3(sh, chest[0] + u[0] * -0.04, chest[1] + u[1] * -0.04, chest[2] + u[2] * -0.04);
      sh[0] -= side * swing * ch->torso_shoulder_w; sh[2] = chest[2] + side * ch->torso_shoulder_w;
      /* nothing in the hand: the arm swings against the leg on its own side */
      th = -st->arm * (0.42 + 0.45 * gp->run) * gp->moving * S->leg[s].fwd + lean * 0.3 + 0.9 * S->air_b - 0.6 * B.prep - 0.6 * FL * S->flinch_dir;
      el = 0.22 + 1.25 * gp->run + 0.35 * fmax(0, th) + 0.3 * S->crouch + 0.4 * S->air_b + 0.6 * fabs(FL);
      set3(eb, sh[0] + sin(th) * ch->arm_upper, sh[1] - cos(th) * ch->arm_upper, sh[2] + side * 0.03);
      set3(fr_, eb[0] + sin(th + el) * ch->arm_lower, eb[1] - cos(th + el) * ch->arm_lower, eb[2]);
      hk = hold[s] ? eH[s] : 0;
      if (hold[s]) lerp3(fr_, hold[s], hk, hand); else copy3(hand, fr_);
      set3(p0, -1, -0.25, side * 0.2); set3(p1, -0.5, -0.9, side * 0.6); lerp3(p0, p1, hk, pole);
      if (HO[s].on && HO[s].k > 0) { lerp3(hand, HO[s].p, HO[s].k, hand); lerp3(pole, HO[s].pole, HO[s].k, pole); }
      cm_ik2(sh, hand, ch->arm_upper, ch->arm_lower, pole, mid, end);
      /* sideways aim: everything above the hips turns about the spine */
      twp(u, sh, chest, tws, arms[s].shoulder); twp(u, mid, chest, tws, arms[s].elbow); twp(u, end, chest, tws, arms[s].hand);
      arms[s].side = side;
    }
    twp(u, head, chest, tws, head);
    for (i = 0; i < np; i++) {
      cm_prop_pose *pw = &props[i];
      double ta = pw->kind == CM_PROP_PISTOL || pw->kind == CM_PROP_SWORD ? tws * eP[i] : tws;     /* holstered pistols and a sheathed sword stay with the hips */
      twp(u, pw->o, chest, ta, pw->o); twp(u, pw->muzzle, chest, ta, pw->muzzle); twp(u, pw->body, chest, ta, pw->body); twp(u, pw->grip, chest, ta, pw->grip);
      twp(u, pw->grip_low, chest, ta, pw->grip_low); if (pw->has_fore) twp(u, pw->fore, chest, ta, pw->fore);
      twp(u, pw->mag_a, chest, ta, pw->mag_a); twp(u, pw->mag_b, chest, ta, pw->mag_b);
      twd(u, pw->dir, ta, pw->dir); twd(u, pw->up, ta, pw->up);
    }
    gz = W * 0.6 * e * (1 - gA) + 0.3 * B.idle * cm_idle_noise(S->t, B.P, 5.0);
    copy3(pose->chest, chest); copy3(pose->head, head);
    set3(g0, cos(gz), sin(gz), 0); twd(u, g0, tws, pose->gaze);
    copy3(pose->u, u); twd(u, f, tws, pose->f); twd(u, zax, tws, pose->side);

    /* the grenade: on the belt until the hand has it, and let go at the top of the swing */
    in_hand = an == CM_ACT_THROW && q >= 0.20 && !act->done;
    sub3(arms[0].hand, arms[0].elbow, fa); fal = len3(fa); if (fal == 0) fal = 1;
    if (in_hand) set3(pose->grenade, arms[0].hand[0] + fa[0] * (0.05 / fal), arms[0].hand[1] + fa[1] * (0.05 / fal), arms[0].hand[2] + fa[2] * (0.05 / fal));
    else set3(pose->grenade, root[0] + 0.09 * u[0] + 0.07 * f[0], root[1] + 0.09 * u[1] + 0.07 * f[1], root[2] + 0.185);
    pose->grenade_held = in_hand;
    if (in_hand && q >= 0.635) {
      cm_event ev;
      double far_[3];
      act->done = 1;
      memset(&ev, 0, sizeof ev); ev.type = CM_EV_THROW; ev.leg = -1;
      cm_to_w(&B.fr, pose->grenade, ev.pos);
      if (act->has_target) copy3(ev.point, act->target); else { set3(far_, S->x + 9 * ch->L, S->g_ref.x, 0); cm_to_w(&B.fr, far_, ev.point); }
      cm_lob(ev.pos, ev.point, 15 * sqrt(ch->L / 0.92), ev.vel);
      cm_event_push(S, &ev);
    }
    if (an == CM_ACT_SWING && !act->done && q >= 0.40) {
      /* as it lands, tell the game where the blade is (hilt and point) and which way it is travelling */
      cm_event ev;
      double bd[3], bl;
      act->done = 1;
      memset(&ev, 0, sizeof ev); ev.type = CM_EV_STRIKE; ev.leg = -1; ev.kind = act->kind;
      cm_to_w(&B.fr, props[0].body, ev.pos); cm_to_w(&B.fr, props[0].muzzle, ev.point);
      if (act->has_prev_tip) sub3(ev.point, act->prev_tip, bd); else set3(bd, 0, 0, 0);
      bl = len3(bd); if (bl == 0) bl = 1;
      set3(ev.vel, bd[0] * (1 / bl), bd[1] * (1 / bl), bd[2] * (1 / bl));
      cm_event_push(S, &ev);
    }
    if (an == CM_ACT_SWING) { cm_to_w(&B.fr, props[0].muzzle, act->prev_tip); act->has_prev_tip = 1; }
    if (an == CM_ACT_PUNCH) {
      /* at full reach, tell the game where the fist is and which way it was going: it decides what was hit */
      double fw[3];
      cm_to_w(&B.fr, arms[act->hand].hand, fw);
      if (!act->done && q >= act->hit) {
        cm_event ev;
        double pd[3], pl2 = 0, shw[3], dm[3];
        act->done = 1;
        if (act->has_prev) { sub3(fw, act->prev, pd); pl2 = len3(pd); }
        if (pl2 < 1e-6) { cm_to_w(&B.fr, arms[act->hand].shoulder, shw); sub3(fw, shw, pd); pl2 = len3(pd); if (pl2 == 0) pl2 = 1; }
        memset(&ev, 0, sizeof ev); ev.type = CM_EV_PUNCH; ev.leg = -1; ev.kind = act->kind; ev.hand = act->hand;
        copy3(ev.pos, fw); set3(ev.vel, pd[0] * (1 / pl2), pd[1] * (1 / pl2), pd[2] * (1 / pl2));
        if (act->has_target) { sub3(fw, act->target, dm); ev.miss = len3(dm); }
        cm_event_push(S, &ev);
      }
      copy3(act->prev, fw); act->has_prev = 1;
    }

    /* the pose, worked out in the body's frame, goes to the world: points are moved and turned, directions only turned */
    point_w(&B.fr, pose->chest); point_w(&B.fr, pose->head); point_w(&B.fr, pose->grenade);
    dir_w(&B.fr, pose->gaze); dir_w(&B.fr, pose->u); dir_w(&B.fr, pose->f); dir_w(&B.fr, pose->side);
    for (s = 0; s < 2; s++) { point_w(&B.fr, arms[s].shoulder); point_w(&B.fr, arms[s].elbow); point_w(&B.fr, arms[s].hand); }
    for (i = 0; i < np; i++) {
      cm_prop_pose *pw = &props[i];
      point_w(&B.fr, pw->o); point_w(&B.fr, pw->muzzle); point_w(&B.fr, pw->body); point_w(&B.fr, pw->grip); point_w(&B.fr, pw->grip_low);
      if (pw->has_fore) point_w(&B.fr, pw->fore);
      point_w(&B.fr, pw->mag_a); point_w(&B.fr, pw->mag_b); dir_w(&B.fr, pw->dir); dir_w(&B.fr, pw->up);
    }
    if (pose->has_carry) { point_w(&B.fr, pose->carry.c); dir_w(&B.fr, pose->carry.f); dir_w(&B.fr, pose->carry.u); dir_w(&B.fr, pose->carry.side); copy3(S->crate_pos, pose->carry.c); }
    S->has_crate_pos = pose->has_carry;
  }
  return 0;
}

/* ------------------------------------------------------------------------------------------- off the ground
   Stage 4: swimming (the octopus), flight (the wasp, the dragon), the ladder and the ledge (the soldier). Ports of
   stepSwim, stepFly, stepLadder, stepLedge and their enter and leave functions in js/core.js. */

static const double LAD_PH[4] = { 0, 0.5, 0.55, 0.05 }, LAD_OFF[4] = { 0.62, 0.62, -0.60, -0.60 };
#define LAD_DUTY 0.62

/* whatever the hands were doing stops: a crate is dropped, an action is given up */
static void let_go(cm_state *S) {
  if (S->carry && S->crate.held) {
    cm_event e;
    memset(&e, 0, sizeof e); e.type = CM_EV_DROP; e.leg = -1; e.hd = S->h;
    copy3(e.pos, S->has_crate_pos ? S->crate_pos : S->crate.at);
    cm_event_push(S, &e);
  }
  S->carry = 0; S->act_crouch = 0; S->act_back = 0;
  if (S->act > CM_ACT_RELOAD) S->act = CM_ACT_NONE;
}
static void no_chains(cm_state *S) { int i; S->tail.n = 0; for (i = 0; i < CM_MAX_LEGS; i++) S->arm[i].n = 0; }

void cm_leave_ladder(cm_state *S, const cm_character *ch, cm_terrain_fn terrain, void *user) {
  double hc, hs;
  int i;
  S->mode = CM_MODE_GROUND; S->v = 0; S->standing = 1; S->reach_drop = 0; S->jump.stage = CM_JUMP_NONE; S->hop.x = S->hop.v = 0; S->air_b = 0;
  S->om = 0; S->kv[0] = S->kv[1] = 0; S->bank.x = S->bank.v = 0; S->side.x = S->side.v = 0;
  S->mv[0] = S->mv[1] = 0; S->act_crouch = 0; S->act_back = 0; no_chains(S); S->has_vl = 0; S->tv[0] = 1; S->tv[1] = 0;
  S->guard.x = S->guard.v = 0; S->stance.x = S->stance.v = 0; S->mount = 0; S->mount_ch = 0;
  hc = cos(S->h); hs = sin(S->h);
  S->g_ref.x = terrain(S->px, S->pz, user); S->g_ref.v = 0; S->y = S->last_y = S->g_ref.x + ch->root_height;
  for (i = 0; i < ch->legs; i++) {
    const double *r = ch->leg[i].rest;
    cm_leg_state *lg = &S->leg[i];
    memset(lg, 0, sizeof *lg);
    set3(lg->ball, S->x + r[0], terrain(S->px + r[0] * hc - r[1] * hs, S->pz + r[0] * hs + r[1] * hc, user), r[1]);
    lg->ref_y = S->g_ref.x; lg->hd = S->h;
  }
}
void cm_place(cm_state *S, const cm_character *ch, cm_terrain_fn terrain, void *user, double x, double z, double heading) {
  S->px = x; S->pz = z; S->h = heading; S->act = CM_ACT_NONE; S->carry = 0;
  cm_leave_ladder(S, ch, terrain, user);
}

int cm_enter_swim(cm_state *S, const cm_character *ch) {
  if (!ch->has_octo || S->mode != CM_MODE_GROUND) return 0;
  let_go(S); S->mode = CM_MODE_SWIM; S->swim_vm = 0; S->v = 0; S->a = 0; S->om = 0; no_chains(S); S->pitch.x = S->pitch.v = 0; S->jump.stage = CM_JUMP_NONE;
  S->kv[0] = S->kv[1] = 0; S->mv[0] = S->mv[1] = 0;
  return 1;
}
int cm_leave_swim(cm_state *S, const cm_character *ch, cm_terrain_fn terrain, void *user) {
  if (S->mode != CM_MODE_SWIM) return 0;
  cm_leave_ladder(S, ch, terrain, user);
  return 1;
}
/* inputs in the water: speed, steer or heading, depth (metres above the bottom), ink */
static void step_swim(cm_state *S, const cm_character *ch, const cm_input *inp, cm_terrain_fn terrain, void *user, double dt, cm_pose *pose) {
  act_out AC;
  cm_frame fr;
  xform x;
  cm_mount_pose *mp = &pose->mount[0];
  double he = inp->has_heading ? cm_wrap_pi(inp->heading - S->h) : 0, om_t = inp->has_heading ? cm_clamp(he * 3, -1.8, 1.8) : cm_clamp(inp->steer, -1, 1) * 1.8;
  double hc, hs, k, P, drag = 2.4, stroke, v0, floor_, yT, vy, cpi, sp2, hov, root[3], ax[3], up[3], squeeze, spread, ang, drift[2] = { 0, 0 };
  int i;
  S->t += dt;
  S->om += (om_t - S->om) * cm_decay(5, dt); S->h = cm_wrap_pi(S->h + S->om * dt);
  hc = cos(S->h); hs = sin(S->h);
  fr.s = S; fr.hc = hc; fr.hs = hs; fr.fn = terrain; fr.user = user; fr.seat = 0;
  octo_tick(S, inp, dt, &AC);
  /* jets: a stroke takes the first third of the cycle; drag does the rest */
  S->swim_vm += (cm_clamp(inp->speed, 0, ch->octo_vswim) - S->swim_vm) * cm_decay(1.6, dt);
  k = S->swim_vm / ch->octo_vswim; P = cm_lerp(1.5, 0.8, k);
  S->phase = cm_frac(S->phase + dt / P);
  stroke = S->phase < 0.32 ? sin(PI * S->phase / 0.32) : 0; v0 = S->v;
  S->v += (drag * S->swim_vm / 0.204 * stroke - drag * S->v) * dt;
  if (AC.ink) S->v += 1.6;
  S->a += ((S->v - v0) / dt - S->a) * cm_decay(30, dt);
  /* depth: it climbs or sinks towards the height asked for, nose following the path */
  floor_ = cm_ter(&fr, S->x, 0); yT = floor_ + cm_clamp(inp->has_depth ? inp->depth : 1.2, 0.32, 8);
  vy = cm_clamp((yT - S->y) * 1.6, -0.9, 0.9) * (0.35 + 0.65 * fmin(1, S->v / 0.8 + 0.3));
  S->y = fmax(S->y + vy * dt, floor_ + 0.28); S->last_y = S->y;
  cm_spring_step(&S->pitch, cm_clamp(atan2(vy, fmax(S->v, 0.6)), -0.7, 0.7), 6, 1, dt);
  cm_spring_step(&S->bank, cm_clamp(S->v * S->om / G * 1.5, -0.5, 0.5), 8, 1, dt);
  cpi = cos(S->pitch.x); sp2 = sin(S->pitch.x);
  S->x += S->v * cpi * dt; S->px += hc * S->v * cpi * dt; S->pz += hs * S->v * cpi * dt;
  S->g_ref.x = floor_; S->standing = 0;
  cm_spring_step(&S->lean, 0, 10, 1, dt); cm_spring_step(&S->flinch, 0, 14, 0.5, dt);
  /* the body: it travels mantle first, so the mantle is ahead and the arms trail behind */
  hov = 1 - cm_smooth(0.05, 0.5, S->swim_vm);
  set3(root, S->x, S->y + 0.03 * hov * sin(TAU * S->t / 2.6), 0.05 * hov * sin(TAU * S->t / 3.7));
  set3(ax, cpi, sp2, 0); set3(up, -sp2, cpi, 0);
  squeeze = cm_clamp(0.9 * stroke * (0.3 + 0.7 * k) + S->jaw.x * 0.3, 0, 1);
#define AT(dst, f_, u_, z_) set3(dst, root[0] + ax[0] * (f_) + up[0] * (u_), root[1] + ax[1] * (f_) + up[1] * (u_), root[2] + (z_))
  pose->body = CM_BODY_OCTO; pose->swimming = 1; pose->base.pitch = S->pitch.x; pose->base.heading = S->h;
  copy3(pose->base.root, root); copy3(pose->axis, ax); copy3(pose->up, up);
  AT(pose->back, -0.2, 0, 0); AT(pose->front, 0.2, 0, 0); AT(pose->eye, 0.02, 0.10, 0);
  pose->has_mantle = 1; AT(pose->mantle_c, 0.16, 0.02, 0); AT(pose->mantle_tip, 0.16 + 0.34 * (1 + 0.3 * squeeze), 0.03, 0);
  pose->mantle_r = ch->octo_mantle * (1 - 0.22 * squeeze + 0.04 * sin(TAU * S->t / 1.7) * hov); copy3(pose->dome, pose->mantle_c);
  spread = cm_lerp(0.62, 0.10, cm_smooth(0, 0.6, squeeze)) + 0.5 * hov; ang = S->pitch.x;
  pose->n_arms = 8;
  for (i = 0; i < 8; i++) {
    double ra = TAU * (i + 0.5) / 8, sw = 0.22 * sin(TAU * S->t / 2.3 + 1.9 * i) * (0.4 + 0.6 * hov), base[3];
    chain_ctl ctl;
    memset(&ctl, 0, sizeof ctl);
    /* hovering, the arms hang below and spread like a skirt; under way they stream straight back */
    ctl.lift = -(spread * sin(ra) + sw) - 0.9 * hov; ctl.yaw = spread * cos(ra) * (1 + 0.8 * hov) + 0.5 * sw + 0.3 * S->bank.x;
    AT(base, -0.09, 0.05 * sin(ra), 0.06 * cos(ra));
    chain_step(S, &S->arm[i], &ch->octo_arm, ch->L, &fr, drift, base, ang, &ctl, dt, pose->arms[i]);
  }
  copy3(pose->tail, pose->arms[0][ch->octo_arm.n]);
  pose->n_mounts = 1; memset(mp, 0, sizeof *mp); copy3(mp->joint, root); copy3(mp->base, root); copy3(mp->tip, pose->eye); copy3(mp->dir, ax);
  if (AC.ink) {
    cm_event e;
    double ip[3];
    memset(&e, 0, sizeof e); e.type = CM_EV_INK; e.leg = -1;
    AT(ip, -0.05, -0.05, 0); cm_to_w(&fr, ip, e.pos); set3(e.vel, -hc * cpi, -sp2, -hs * cpi);
    cm_event_push(S, &e);
  }
#undef AT
  memset(&x, 0, sizeof x); x.fr = &fr;
  x_pose(&x, pose, 1);
}

int cm_enter_fly(cm_state *S, const cm_character *ch) {
  if (!ch->has_fly || S->mode != CM_MODE_GROUND) return 0;
  let_go(S); S->mode = CM_MODE_FLY; S->fly_vy = 0; S->fly_effort = 0.6; S->om = 0; S->jump.stage = CM_JUMP_NONE;
  S->kv[0] = S->kv[1] = 0; S->mv[0] = S->mv[1] = 0; S->a = 0; S->reach_drop = 0;
  return 1;
}
int cm_leave_fly(cm_state *S, const cm_character *ch, cm_terrain_fn terrain, void *user) {
  if (S->mode != CM_MODE_FLY) return 0;
  cm_leave_ladder(S, ch, terrain, user);
  return 1;
}
/* inputs in the air: speed, steer or heading, height (metres above the ground), aim, and the creature's own attacks */
static int step_fly(cm_state *S, const cm_character *ch, const cm_input *inp, const cm_style *st, cm_terrain_fn terrain, void *user, double dt, cm_pose *pose) {
  cm_bctx B;
  double L = ch->L, he = inp->has_heading ? cm_wrap_pi(inp->heading - S->h) : 0;
  double om_t = inp->has_heading ? cm_clamp(he * 2.5, -ch->fly_turn, ch->fly_turn) : cm_clamp(inp->steer, -1, 1) * ch->fly_turn;
  double hc, hs, vT, dv, floor_, yT, slow, glide, amp_k, freq, ph, fa, fa2, heave, cp, sn, hov, root[3], ax[3], up[3];
  int i;
  S->t += dt;
  S->om += (om_t - S->om) * cm_decay(4, dt); S->h = cm_wrap_pi(S->h + S->om * dt);
  hc = cos(S->h); hs = sin(S->h);
  memset(&B, 0, sizeof B);
  B.fr.s = S; B.fr.hc = hc; B.fr.hs = hs; B.fr.fn = terrain; B.fr.user = user;
  /* speed: a big flier cannot go slower than its wings will carry it */
  vT = cm_clamp(inp->speed, ch->fly_hover ? 0 : ch->fly_vmin, ch->fly_vmax); dv = cm_clamp(vT - S->v, -ch->fly_acc * dt, ch->fly_acc * dt);
  S->a += (dv / dt - S->a) * cm_decay(12, dt); S->v += dv;
  floor_ = cm_ter(&B.fr, S->x, 0); yT = floor_ + cm_clamp(inp->has_height ? inp->height : ch->fly_height, ch->fly_low, 40);
  S->fly_vy += (cm_clamp((yT - S->y) * 1.3, -ch->fly_sink, ch->fly_climb) - S->fly_vy) * cm_decay(3, dt);
  S->y = fmax(S->y + S->fly_vy * dt, floor_ + ch->fly_low * 0.8); S->last_y = S->y; S->g_ref.x = floor_; S->standing = 0;
  /* how hard the wings work: more to climb and to fly slowly, less at speed or coming down, where a glider stops beating */
  slow = ch->fly_hover ? 1 - 0.4 * S->v / ch->fly_vmax : 1 - (S->v - ch->fly_vmin) / (ch->fly_vmax - ch->fly_vmin);
  S->fly_effort += (cm_clamp(0.35 + 0.5 * slow + 0.6 * S->fly_vy / ch->fly_climb, 0, 1.3) - S->fly_effort) * cm_decay(4, dt);
  glide = ch->fly_glide ? 1 - cm_smooth(0.18, 0.42, S->fly_effort) : 0;
  amp_k = (0.55 + 0.45 * fmin(S->fly_effort, 1)) * (1 - 0.88 * glide); freq = ch->fly_beat * (0.75 + 0.45 * S->fly_effort);
  S->phase = cm_frac(S->phase + dt * freq);
  ph = TAU * S->phase; fa = ch->fly_amp * amp_k * sin(ph) + 0.14 * glide;
  fa2 = ch->fly_amp * amp_k * 1.15 * sin(ph - 0.8) - 0.3 * amp_k * fmax(0, cos(ph)) + 0.05 * glide;
  heave = -ch->fly_heave * amp_k * cos(ph - TAU / 4);          /* the body rises through each downstroke */
  cm_spring_step(&S->pitch, cm_clamp(ch->fly_pitch0 + 0.7 * atan2(S->fly_vy, fmax(S->v, 0.4 * ch->fly_vmax)) + ch->fly_slow_pitch * cm_smooth(0.55, 1, slow), -0.8, 1.0), 5, 1, dt);
  cm_spring_step(&S->bank, cm_clamp(atan(S->v * S->om / G) + 0.25 * S->om, -1.0, 1.0), 6, 1, dt);
  cp = cos(S->pitch.x); sn = sin(S->pitch.x);
  S->x += S->v * dt; S->px += hc * S->v * dt; S->pz += hs * S->v * dt;
  hov = ch->fly_hover ? 1 - cm_smooth(0.05, 0.5, S->v / ch->fly_vmax) : 0;
  set3(root, S->x, S->y + heave + 0.02 * L * hov * sin(TAU * S->t / 1.9), 0.05 * L * hov * sin(TAU * S->t / 2.7));
  set3(ax, cp, sn, 0); set3(up, -sn, cp, 0);
  /* legs: they hang (or are held tucked) under the body and swing back when it speeds up */
  pose->base.legs = ch->legs;
  for (i = 0; i < ch->legs; i++) {
    const cm_leg_def *ld = &ch->leg[i];
    cm_leg_pose *o = &pose->base.leg[i];
    const double *at = ld->attach;
    double len2 = ld->upper + ld->lower, lag = cm_clamp(-0.03 * S->a, -0.2, 0.2) + 0.03 * sin(TAU * S->t / 1.3 + 1.7 * i), foot[3];
    memset(o, 0, sizeof *o);
    set3(o->hip, root[0] + ax[0] * at[0] + up[0] * at[1], root[1] + ax[1] * at[0] + up[1] * at[1], at[2]);
    set3(foot, o->hip[0] + (ch->fly_hang[0] + lag) * len2, o->hip[1] + ch->fly_hang[1] * len2, at[2] + ld->side * 0.3 * fabs(ld->rest[1] - at[2]));
    cm_ik2(o->hip, foot, ld->upper, ld->lower, ld->pole, o->knee, o->ankle);
    copy3(o->ball, o->ankle); o->side = ld->side;
  }
  copy3(B.root, root); copy3(B.fly_ax, ax); copy3(B.fly_up, up); B.pitch = S->pitch.x; B.Tn = TAU * sqrt(L / G); B.idle = hov; B.P = 2.1 * TAU * sqrt(L / G);
  B.gp.run = ch->fly_hover ? 0.3 : 1; B.gp.moving = 1 - hov; B.gp.Tn = B.Tn;
  B.has_aim = inp->has_aim != 0;
  if (B.has_aim) { double a3[3]; set3(a3, inp->aim[0], inp->aim[1], inp->has_aim > 2 ? inp->aim[2] : S->pz); cm_to_l(&B.fr, a3, B.aim); }
  pose->base.pitch = S->pitch.x; pose->base.heading = S->h; pose->base.crouch = S->crouch;
  return body_step(S, ch, inp, st, dt, &B, pose, 1, fa, fa2);
}

/* a point or a direction of the frame the body had when it took hold of a ladder or a ledge, in the world */
static void lf_pt(const double fr[5], double p[3]) { double x = p[0] - fr[0], z = p[2]; set3(p, fr[1] + x * fr[3] - z * fr[4], p[1], fr[2] + x * fr[4] + z * fr[3]); }
static void lf_dir(const double fr[5], double d[3]) { double x = d[0] * fr[3] - d[2] * fr[4], z = d[0] * fr[4] + d[2] * fr[3]; d[0] = x; d[2] = z; }
static void frame_now(const cm_state *S, double fr[5]) { fr[0] = S->x; fr[1] = S->px; fr[2] = S->pz; fr[3] = cos(S->h); fr[4] = sin(S->h); }
static int nearest_rung(const cm_ladder *lad, double y, int kmin) {
  int k0 = (int)floor((y - lad->y0) / lad->spacing + 0.5), best = k0, k;
  double bd = 1e9;
  for (k = k0 - 2; k <= k0 + 2; k++) { double d = fabs(lad->rung(k, lad->user) - y); if (d < bd) { bd = d; best = k; } }
  return best > kmin ? best : kmin;
}
int cm_enter_ladder(cm_state *S, const cm_character *ch, const cm_ladder *ladder) {
  double y;
  int i;
  if (ch->kind != CM_BIPED || !ladder || !ladder->rung) return 0;
  let_go(S);
  S->ladder = ladder; frame_now(S, S->lad_frame);          /* the ladder stands where the body faced it */
  S->mode = CM_MODE_LADDER; S->jump.stage = CM_JUMP_NONE; S->hop.x = S->hop.v = 0; S->air_b = 0; S->om = 0; S->kv[0] = S->kv[1] = 0; S->act = CM_ACT_NONE;
  S->twist.x = S->twist.v = 0;
  y = ladder->y0 + ch->root_height + 0.75; S->lad_y = y;
  for (i = 0; i < 4; i++) {
    S->limb[i].k = nearest_rung(ladder, y + LAD_OFF[i] + (i % 2 ? 0.15 : -0.15) * (i < 2 ? 1 : -1), -99);
    S->limb[i].swinging = 0; S->limb[i].psi = cm_frac(S->phase + LAD_PH[i]);
  }
  S->v = 0;
  return 1;
}
/* the weapons on their way to their stowed places: the rifle across the back, pistols in their holsters */
static void stowed_props(cm_state *S, const cm_character *ch, const double root[3], const double chest[3], const double u[3], const double f[3], double zc, cm_pose *pose) {
  const kit_def *kit = held_kit(S, ch);
  int i;
  pose->n_props = 0;
  if (kit) for (i = 0; i < kit->n; i++) {
    place_t pl = mix_place(stow_place(kit->props[i], i, root, u, f, zc), ready_place(kit->props[i], i, chest, u, f, 0, 0), S->armed.x);
    cm_prop_pose *w = &pose->prop[pose->n_props++];
    prop_at(kit->props[i], pl.o, pl.th, pl.z, w); w->stow = 1 - S->armed.x;
  }
}
/* a climbing biped's pose, from the frame it took hold in to the world */
static void climb_to_world(const double fr[5], cm_pose *pose) {
  int i;
  lf_pt(fr, pose->base.root); lf_pt(fr, pose->chest); lf_pt(fr, pose->head); lf_dir(fr, pose->gaze); lf_dir(fr, pose->u); lf_dir(fr, pose->f);
  for (i = 0; i < 2; i++) {
    cm_leg_pose *l = &pose->base.leg[i];
    lf_pt(fr, l->hip); lf_pt(fr, l->knee); lf_pt(fr, l->ankle); lf_pt(fr, l->heel); lf_pt(fr, l->toe); lf_pt(fr, l->ball);
    lf_pt(fr, pose->arm[i].shoulder); lf_pt(fr, pose->arm[i].elbow); lf_pt(fr, pose->arm[i].hand);
  }
  for (i = 0; i < pose->n_props; i++) {
    cm_prop_pose *pw = &pose->prop[i];
    lf_pt(fr, pw->o); lf_pt(fr, pw->muzzle); lf_pt(fr, pw->body); lf_pt(fr, pw->grip); lf_pt(fr, pw->grip_low); if (pw->has_fore) lf_pt(fr, pw->fore);
    lf_pt(fr, pw->mag_a); lf_pt(fr, pw->mag_b); lf_dir(fr, pw->dir); lf_dir(fr, pw->up);
  }
}
/* Hands and feet each hold a real rung. A limb lets go, reaches for the rung nearest to where it wants to be, and
   the body is carried by the other three. */
static int step_ladder(cm_state *S, const cm_character *ch, const cm_input *inp, const cm_style *st, double dt, cm_pose *pose) {
  const cm_ladder *lad = S->ladder;
  cm_input quiet;
  double vc, T, px, pz, pts[4][3], root[3], lean, u[3], f[3], chest[3], head[3], wr[3];
  int moving, i, held[4];
  if (!lad) return -1;
  S->t += dt;
  S->crouch += (0 - S->crouch) * cm_decay(6, dt);
  vc = cm_clamp(inp->speed * 0.3, 0, 1.3);
  S->v += cm_clamp(vc - S->v, -2 * dt, 2 * dt);
  T = 2 * lad->spacing / fmax(S->v, 0.05);
  moving = S->v > 0.03;
  if (moving) S->phase = cm_frac(S->phase + dt / T);
  S->lad_y += S->v * dt;
  px = lad->x - 0.36 + 0.012 * sin(2 * TAU * S->phase); pz = 0.02 * sin(TAU * S->phase);
  for (i = 0; i < 4; i++) {
    int hand = i < 2, side = i % 2 == 0 ? 1 : -1;
    double psi = cm_frac(S->phase + LAD_PH[i]), z = side * (hand ? 0.13 : 0.11), x0 = lad->x;
    if (!S->limb[i].swinging && moving && psi >= LAD_DUTY && S->limb[i].psi < LAD_DUTY) {
      double dur = (1 - LAD_DUTY) * T, want = S->lad_y + S->v * dur + LAD_OFF[i] + S->v * LAD_DUTY * T * 0.5;
      S->limb[i].swinging = 1; S->limb[i].s = 0; S->limb[i].dur = dur; S->limb[i].from = S->limb[i].k; S->limb[i].to = nearest_rung(lad, want, S->limb[i].k + 1);
    }
    S->limb[i].psi = psi;
    set3(pts[i], x0, lad->rung(S->limb[i].k, lad->user), z);
    if (S->limb[i].swinging) {
      S->limb[i].s += dt / S->limb[i].dur;
      if (S->limb[i].s >= 1) {
        cm_event e;
        S->limb[i].k = S->limb[i].to; S->limb[i].swinging = 0; set3(pts[i], x0, lad->rung(S->limb[i].k, lad->user), z);
        memset(&e, 0, sizeof e); e.type = CM_EV_GRIP; e.leg = -1; e.hand = i; cm_event_push(S, &e);
      } else {
        double e = cm_ease(S->limb[i].s, st->snap), arc = sin(PI * S->limb[i].s);
        set3(pts[i], x0 - (hand ? 0.10 : 0.13) * arc * st->step, cm_lerp(lad->rung(S->limb[i].from, lad->user), lad->rung(S->limb[i].to, lad->user), e) + 0.02 * arc, z);
      }
    }
    held[i] = !S->limb[i].swinging;
  }
  S->x = px; S->y = S->lad_y; S->last_y = S->y;
  set3(wr, px, 0, 0); lf_pt(S->lad_frame, wr); S->px = wr[0]; S->pz = wr[2];
  set3(root, px, S->lad_y, pz);
  pose->body = CM_BODY_BIPED; pose->climbing = 1; pose->base.legs = 2; pose->base.heading = S->h;
  for (i = 0; i < 2; i++) {
    const cm_leg_def *ld = &ch->leg[i];
    const cm_foot *F = &ld->foot;
    cm_leg_pose *o = &pose->base.leg[i];
    const double *ball = pts[2 + i];
    double ankle[3], pole[3];
    memset(o, 0, sizeof *o);
    set3(o->hip, root[0] + ld->attach[0], root[1] + ld->attach[1], root[2] + ld->attach[2]);
    set3(ankle, ball[0] - F->fb, ball[1] + F->ah, ball[2]); set3(pole, 0.35, 0.1, ld->side);
    cm_ik2(o->hip, ankle, ld->upper, ld->lower, pole, o->knee, o->ankle);
    set3(o->heel, ball[0] - F->fb - F->hb, ball[1], ball[2]); set3(o->toe, ball[0] + F->toe, ball[1], ball[2]); copy3(o->ball, ball);
    o->planted = held[2 + i]; o->has_foot = 1; o->side = ld->side;
  }
  memset(&quiet, 0, sizeof quiet);
  fire_control(S, ch, &quiet, dt);
  cm_spring_step(&S->lean, 0.15, 12, 1, dt); cm_spring_step(&S->armed, 0, 14, 1, dt); cm_spring_step(&S->pack, 0, 30, 0.4, dt);
  lean = S->lean.x; set3(u, sin(lean), cos(lean), 0); set3(f, cos(lean), -sin(lean), 0);
  set3(chest, root[0] + u[0] * ch->torso_len, root[1] + u[1] * ch->torso_len, root[2] * 0.5);
  set3(head, chest[0] + 0.03, chest[1] + ch->torso_neck + ch->torso_head_r * 0.7, chest[2]);
  for (i = 0; i < 2; i++) {
    int sd = i == 0 ? 1 : -1;
    double sh[3], pole[3];
    set3(sh, chest[0] + u[0] * -0.04, chest[1] + u[1] * -0.04, chest[2] + sd * ch->torso_shoulder_w); set3(pole, -0.4, -1, sd * 0.7);
    copy3(pose->arm[i].shoulder, sh); cm_ik2(sh, pts[i], ch->arm_upper, ch->arm_lower, pole, pose->arm[i].elbow, pose->arm[i].hand); pose->arm[i].side = sd;
  }
  stowed_props(S, ch, root, chest, u, f, chest[2], pose);
  copy3(pose->base.root, root); pose->lean = lean; copy3(pose->chest, chest); copy3(pose->head, head); set3(pose->gaze, cos(0.5), sin(0.5), 0); copy3(pose->u, u); copy3(pose->f, f);
  climb_to_world(S->lad_frame, pose);
  return 0;
}

int cm_grab_ledge(cm_state *S, const cm_character *ch, const double edge[3]) {
  double x, z;
  cm_event e;
  if (ch->kind != CM_BIPED || (S->mode != CM_MODE_GROUND && S->mode != CM_MODE_LADDER)) return 0;
  let_go(S);
  frame_now(S, S->lad_frame);
  x = edge[0] - S->lad_frame[1]; z = edge[2] - S->lad_frame[2];
  S->mode = CM_MODE_LEDGE; S->jump.stage = CM_JUMP_NONE; S->hop.x = S->hop.v = 0; S->air_b = 0; S->om = 0; S->kv[0] = S->kv[1] = 0; S->mv[0] = S->mv[1] = 0;
  S->act = CM_ACT_NONE; S->twist.x = S->twist.v = 0; S->has_vl = 0;
  S->ledge.ex = S->lad_frame[0] + x * S->lad_frame[3] + z * S->lad_frame[4]; S->ledge.ey = edge[1]; S->ledge.up = 0; S->ledge.t = 0;
  S->ledge.sw.x = cm_clamp(0.12 * S->v, 0, 0.5); S->ledge.sw.v = 0;
  S->v = 0; S->a = 0;
  memset(&e, 0, sizeof e); e.type = CM_EV_GRAB; e.leg = -1; cm_event_push(S, &e);
  return 1;
}
static int ground_step(cm_state *S, const cm_character *ch, const cm_input *inp, const cm_style *st, cm_terrain_fn terrain, void *user, double dt, cm_pose *pose) {
  cm_bctx B;
  memset(&B, 0, sizeof B);
  cm_ground_core(S, ch, inp, st, terrain, user, dt, &pose->base, &B);
  return body_step(S, ch, inp, st, dt, &B, pose, 0, 0, 0);
}
/* Hanging by the hands with the feet against the wall. climb (or jump) pulls up: chin to the edge, chest over, a knee
   up, stand. drop lets go. */
static int step_ledge(cm_state *S, const cm_character *ch, const cm_input *inp, const cm_style *st, cm_terrain_fn terrain, void *user, double dt, cm_pose *pose) {
  double k = ch->L / 0.92, ex = S->ledge.ex, ey = S->ledge.ey, q = 0, dur, a, b, c, sway, lean, u[3], f[3], top[2], cx, cy, chest[3], root[3], head[3], hr, off, wr[3], swx;
  cm_input quiet;
  cm_event ev;
  int i;
  S->t += dt; S->ledge.t += dt;
  S->crouch += (0 - S->crouch) * cm_decay(6, dt);
  memset(&quiet, 0, sizeof quiet);
  if (!S->ledge.up) {
    if (inp->drop) {
      cm_leave_ladder(S, ch, terrain, user);
      memset(&ev, 0, sizeof ev); ev.type = CM_EV_DROP; ev.leg = -1; cm_event_push(S, &ev);
      return ground_step(S, ch, &quiet, st, terrain, user, dt, pose);
    }
    if ((inp->climb || inp->jump) && S->ledge.t > 0.25) { S->ledge.up = 1; S->ledge.t = 0; }
  }
  dur = 1.5 * sqrt(k);
  if (S->ledge.up) q = fmin(S->ledge.t / dur, 1);
  cm_spring_step(&S->ledge.sw, 0, 5.5, 0.25, dt);              /* the swing left over from arriving dies away */
  swx = S->ledge.sw.x;
  /* where the chest is, and how far the back leans: hanging; pulled up; over the edge; standing on top */
  a = cm_smooth(0, 0.38, q); b = cm_smooth(0.33, 0.62, q); c = cm_smooth(0.56, 1, q); sway = 0.02 * sin(TAU * S->t / 2.6) * (1 - a);
  lean = cm_lerp(cm_lerp(cm_lerp(0.10, 0.36, a), 0.62, b), 0.06, c) - 0.5 * swx * (1 - a);
  set3(u, sin(lean), cos(lean), 0); set3(f, cos(lean), -sin(lean), 0);
  top[0] = ex + 0.22 * k + u[0] * ch->torso_len; top[1] = ey + ch->root_height + u[1] * ch->torso_len;
  cx = cm_lerp(cm_lerp(cm_lerp(ex - 0.20 * k, ex - 0.13 * k, a), ex + 0.10 * k, b), top[0], c) - 0.3 * swx * (1 - a);
  cy = cm_lerp(cm_lerp(cm_lerp(ey - 0.43 * k, ey + 0.10 * k, a), ey + 0.56 * k, b), top[1], c) + sway;
  set3(chest, cx, cy, 0); set3(root, cx - u[0] * ch->torso_len, cy - u[1] * ch->torso_len, 0);
  hr = ch->torso_neck + ch->torso_head_r * 0.7;
  set3(head, chest[0] + sin(lean * 0.4) * hr, chest[1] + cos(lean * 0.4) * hr, 0);
  pose->body = CM_BODY_BIPED; pose->climbing = 1; pose->base.legs = 2; pose->base.heading = S->h;
  /* hands: on the lip, pressing down on it as the body comes over, and off it at the end */
  off = cm_smooth(0.68, 0.92, q);
  for (i = 0; i < 2; i++) {
    int sd = i == 0 ? 1 : -1;
    double sh[3], grip[3], loose[3], hand[3], p0[3], p1[3], pole[3];
    set3(sh, chest[0] + u[0] * -0.04, chest[1] + u[1] * -0.04, sd * ch->torso_shoulder_w);
    set3(grip, ex - 0.01, ey + 0.02, sd * 0.17); set3(loose, sh[0] + 0.05, sh[1] - 0.50 * k, sd * 0.24); lerp3(grip, loose, off, hand);
    set3(p0, -0.3, -1, sd * 0.6); set3(p1, -0.8, 0.6, sd * 0.7); lerp3(p0, p1, b * (1 - off), pole);
    copy3(pose->arm[i].shoulder, sh); cm_ik2(sh, hand, ch->arm_upper, ch->arm_lower, pole, pose->arm[i].elbow, pose->arm[i].hand); pose->arm[i].side = sd;
  }
  /* feet: toes on the wall while hanging and pulling; then one foot up onto the top, then the other */
  for (i = 0; i < 2; i++) {
    const cm_leg_def *ld = &ch->leg[i];
    const cm_foot *F = &ld->foot;
    cm_leg_pose *o = &pose->base.leg[i];
    double wall[3], on, upp[3], ball[3], ankle[3], pole[3], mid[3], end[3];
    memset(o, 0, sizeof *o);
    set3(o->hip, root[0] + ld->attach[0], root[1] + ld->attach[1], ld->attach[2]);
    set3(wall, ex - 0.03 - F->toe, o->hip[1] - cm_lerp(0.95, 0.74, a) * ch->L + (i ? 0.05 : 0) * k - 0.25 * swx, ld->attach[2]);
    wall[0] -= 0.35 * fmax(0, swx);
    on = cm_smooth(i ? 0.62 : 0.40, i ? 0.86 : 0.64, q); set3(upp, ex + (i ? 0.20 : 0.10) * k + (i ? 0.02 : 0.04), ey, ld->rest[1]);
    lerp3(wall, upp, on, ball); ball[1] += 0.16 * k * sin(PI * on); ball[0] -= 0.12 * k * sin(PI * on);
    set3(ankle, ball[0] - F->fb, ball[1] + F->ah, ball[2]); set3(pole, 1, 0.2, ld->side * 0.4);
    cm_ik2(o->hip, ankle, ld->upper, ld->lower, pole, mid, end);
    if (mid[0] > ex - 0.09 * k && mid[1] < ey) {               /* a knee that would go into the wall turns outwards instead */
      double lo = 0, hi = 1.45, km[3], ke[3];
      int j;
      for (j = 0; j < 7; j++) { double ph = 0.5 * (lo + hi); set3(pole, cos(ph), 0.2, ld->side * (0.4 + sin(ph))); cm_ik2(o->hip, ankle, ld->upper, ld->lower, pole, km, ke); if (km[0] > ex - 0.09 * k) lo = ph; else hi = ph; }
      set3(pole, cos(hi), 0.2, ld->side * (0.4 + sin(hi))); cm_ik2(o->hip, ankle, ld->upper, ld->lower, pole, mid, end);
    }
    copy3(o->knee, mid); copy3(o->ankle, end);
    set3(o->heel, ball[0] - F->fb - F->hb, ball[1], ball[2]); set3(o->toe, ball[0] + F->toe, ball[1], ball[2]); copy3(o->ball, ball);
    o->planted = on <= 0 || on >= 1; o->has_foot = 1; o->side = ld->side;
  }
  fire_control(S, ch, &quiet, dt);
  cm_spring_step(&S->lean, lean, 12, 1, dt); cm_spring_step(&S->armed, 0, 14, 1, dt); cm_spring_step(&S->pack, 0, 30, 0.4, dt);
  stowed_props(S, ch, root, chest, u, f, 0, pose);
  S->x = root[0]; S->y = root[1]; S->last_y = S->y;
  set3(wr, root[0], 0, 0); lf_pt(S->lad_frame, wr); S->px = wr[0]; S->pz = wr[2];
  copy3(pose->base.root, root); pose->lean = lean; copy3(pose->chest, chest); copy3(pose->head, head);
  set3(pose->gaze, cos(0.45 * (1 - c)), sin(0.45 * (1 - c)), 0); copy3(pose->u, u); copy3(pose->f, f);
  climb_to_world(S->lad_frame, pose);
  if (q >= 1) {                                                /* on its feet on the top: the ground code takes over */
    cm_leave_ladder(S, ch, terrain, user);
    memset(&ev, 0, sizeof ev); ev.type = CM_EV_TOP; ev.leg = -1; cm_event_push(S, &ev);
  }
  return 0;
}

/* ------------------------------------------------------------------------------------------------ the ragdoll
   Stage 4b. A port of ragdollStart, stepRagdoll and ragPose in js/core.js. */

static double rag_d2(const cm_ragdoll *R, const cm_rag_link *c) {
  const cm_particle *a = &R->P[c->a], *b = &R->P[c->b];
  double x = a->p[0] - b->p[0], y = a->p[1] - b->p[1], z = c->has_dz ? c->dz : a->z - b->z;
  return sqrt(x * x + y * y + z * z);
}
static double rag_cross(const cm_particle *a, const cm_particle *b, const cm_particle *c) { return (b->p[0] - a->p[0]) * (c->p[1] - b->p[1]) - (b->p[1] - a->p[1]) * (c->p[0] - b->p[0]); }
typedef struct { cm_ragdoll *R; double vx0, vy0, dt0, L; } rag_build;
static int rb_add(rag_build *b, const double pos[3], double r, double w) {
  cm_particle *q = &b->R->P[b->R->n];
  q->p[0] = pos[0]; q->p[1] = pos[1]; q->z = pos[2]; q->r = r; q->w = w; q->hit = 0;
  q->q[0] = q->p[0] - b->vx0 * b->dt0; q->q[1] = q->p[1] - b->vy0 * b->dt0;
  return b->R->n++;
}
static void rb_link(rag_build *b, cm_rag_link *list, int *n, int pa, int pb, int has_dz, double dz, double rest) {
  cm_rag_link *c = &list[(*n)++];
  c->a = pa; c->b = pb; c->has_dz = has_dz; c->dz = dz;
  c->rest = rest != 0 ? rest : rag_d2(b->R, c);
}
#define RB_BONE(pa, pb) rb_link(b, R->bones, &R->n_bones, pa, pb, 0, 0, 0)
#define RB_MIN(pa, pb, f) rb_link(b, R->mins, &R->n_mins, pa, pb, 0, 0, f)
/* the joint keeps bending the way it bends now */
static void rb_sign(rag_build *b, int pa, int pb, int pc, int dflt) {
  cm_ragdoll *R = b->R;
  cm_rag_sign *g = &R->signs[R->n_signs++];
  double cr = rag_cross(&R->P[pa], &R->P[pb], &R->P[pc]);
  g->a = pa; g->b = pb; g->c = pc; g->sign = fabs(cr) > 1e-3 * b->L * b->L ? (cr > 0 ? 1 : -1) : dflt;
}
/* hip: which body particle each leg hangs from (0: all from one, given) */
static void rb_legs(rag_build *b, const cm_character *ch, const cm_pose *p, const int *hip_of, double knee_r, double foot_r, int bend_default) {
  cm_ragdoll *R = b->R;
  int i;
  for (i = 0; i < p->base.legs; i++) {
    const cm_leg_pose *l = &p->base.leg[i];
    const cm_leg_def *ld = &ch->leg[i];
    double len = ld->upper + ld->lower, an[3];
    int hip = hip_of[i];
    R->knee[i] = rb_add(b, l->knee, knee_r, 0.6);
    copy3(an, l->ankle); if (!ld->has_foot) an[1] += foot_r;
    R->ankle[i] = rb_add(b, an, foot_r, 0.8);
    rb_link(b, R->bones, &R->n_bones, hip, R->knee[i], 1, ld->attach[2] - l->knee[2], ld->upper);     /* the hip sits at its body particle, offset sideways */
    RB_BONE(R->knee[i], R->ankle[i]);
    rb_link(b, R->mins, &R->n_mins, hip, R->ankle[i], 1, ld->attach[2] - l->ankle[2], 0.3 * len);
    if (fabs(ld->rest[1] - ld->attach[2]) < 0.3 * len) rb_sign(b, hip, R->knee[i], R->ankle[i], bend_default);      /* legs splayed sideways have no bend side in this plane */
    if (ld->has_foot) {
      const cm_foot *F = &ld->foot;
      double fl = F->fb + F->toe, tp[3];
      set3(tp, l->toe[0], l->toe[1] + 0.4 * F->ah, l->toe[2]);
      R->toe[i] = rb_add(b, tp, 0.45 * F->ah, 1.2);
      RB_BONE(R->ankle[i], R->toe[i]); rb_sign(b, R->knee[i], R->ankle[i], R->toe[i], 1);
      /* the ankle stays between about 65 and 150 degrees */
      RB_MIN(R->knee[i], R->toe[i], sqrt(ld->lower * ld->lower + fl * fl - 2 * ld->lower * fl * cos(1.15)));
      rb_link(b, R->maxs, &R->n_maxs, R->knee[i], R->toe[i], 0, 0, sqrt(ld->lower * ld->lower + fl * fl - 2 * ld->lower * fl * cos(2.6)));
    }
  }
}
static void inv_pt(const double fr[5], double p[3]) { double x = p[0] - fr[1], z = p[2] - fr[2]; set3(p, fr[0] + x * fr[3] + z * fr[4], p[1], -x * fr[4] + z * fr[3]); }
static void inv_dir(const double fr[5], double d[3]) { double x = d[0] * fr[3] + d[2] * fr[4], z = -d[0] * fr[4] + d[2] * fr[3]; d[0] = x; d[2] = z; }
static void limp_from(cm_limp *Lc, double (*pts)[3], int n, double r) {
  int i;
  Lc->n = n; Lc->on = 1; Lc->r = r;
  for (i = 0; i < n; i++) { copy3(Lc->p[i], pts[i]); copy3(Lc->q[i], pts[i]); if (i) { double d[3]; sub3(pts[i], pts[i - 1], d); Lc->seg[i - 1] = len3(d); } }
}

/* Hand the body, as it was in its last pose, to its ragdoll. */
static void ragdoll_start(cm_state *S, const cm_character *ch, const cm_input *inp) {
  static cm_pose loc;
  cm_pose *p = &loc;
  cm_ragdoll *R = &S->rag;
  rag_build bb, *b = &bb;
  double L = ch->L, sc = sqrt(L / 0.92), wi[3], imp[2];
  int i, k, hip_of[CM_MAX_LEGS];
  memset(R, 0, sizeof *R);
  if (S->mode == CM_MODE_LADDER || S->mode == CM_MODE_LEDGE) memcpy(R->frame, S->lad_frame, sizeof R->frame); else frame_now(S, R->frame);
  R->h = S->h; R->aim = S->aim.x; R->tw = S->twist.x;
  /* the last pose, back in the frame it was worked out in */
  *p = S->last;
  inv_pt(R->frame, p->base.root); inv_pt(R->frame, p->chest); inv_pt(R->frame, p->head); inv_pt(R->frame, p->back); inv_pt(R->frame, p->front); inv_dir(R->frame, p->gaze);
  for (i = 0; i < p->base.legs; i++) { cm_leg_pose *l = &p->base.leg[i]; inv_pt(R->frame, l->knee); inv_pt(R->frame, l->ankle); inv_pt(R->frame, l->toe); }
  for (i = 0; i < 2; i++) { inv_pt(R->frame, p->arm[i].shoulder); inv_pt(R->frame, p->arm[i].elbow); inv_pt(R->frame, p->arm[i].hand); inv_pt(R->frame, p->mount[i].joint); }
  for (i = 0; i < p->n_props; i++) { inv_pt(R->frame, p->prop[i].o); inv_pt(R->frame, p->prop[i].muzzle); }
  for (i = 0; i < p->n_claws; i++) { cm_claw_pose *c = &p->claw[i]; inv_pt(R->frame, c->shoulder); inv_pt(R->frame, c->elbow); inv_pt(R->frame, c->wrist); inv_pt(R->frame, c->tip); }
  for (i = 0; i < p->n_tail_pts; i++) inv_pt(R->frame, p->tail_pts[i]);
  b->R = R; b->L = L; b->dt0 = 1.0 / 120;
  b->vy0 = S->jump.stage == CM_JUMP_AIR ? S->jump.vy : 0; b->vx0 = S->mode == CM_MODE_GROUND ? S->v : 0;
  R->legs = p->base.legs;
  if (ch->kind == CM_BIPED) {
    R->root = rb_add(b, p->base.root, 0.11, 0.25); R->chest = rb_add(b, p->chest, 0.15, 0.3); R->head = rb_add(b, p->head, 0.115, 0.9);
    RB_BONE(R->root, R->chest); RB_BONE(R->chest, R->head);
    RB_MIN(R->root, R->head, 0.86 * (rag_d2(R, &R->bones[0]) + rag_d2(R, &R->bones[1])));
    for (i = 0; i < CM_MAX_LEGS; i++) hip_of[i] = R->root;
    rb_legs(b, ch, p, hip_of, 0.07, 0.075, -1);
    for (i = 0; i < 2; i++) {
      R->elbow[i] = rb_add(b, p->arm[i].elbow, 0.055, 1); R->hand[i] = rb_add(b, p->arm[i].hand, 0.05, 1.3);
      RB_BONE(R->chest, R->elbow[i]); RB_BONE(R->elbow[i], R->hand[i]); rb_sign(b, R->chest, R->elbow[i], R->hand[i], 1);
      RB_MIN(R->chest, R->hand[i], 0.2 * (ch->arm_upper + ch->arm_lower)); RB_MIN(R->chest, R->knee[i], 0.9 * ch->torso_len);
      R->arm_sh_z[i] = p->arm[i].shoulder[2]; R->arm_side[i] = p->arm[i].side;
    }
    R->n_props = p->n_props;
    for (k = 0; k < p->n_props; k++) {                         /* whatever is in the hands is let go and falls on its own */
      const cm_prop_pose *w = &p->prop[k];
      double zm = (w->o[2] + w->muzzle[2]) / 2, a3[3], b3[3];
      R->prop_kind[k] = w->kind; R->prop_s[k] = -1;
      if (w->stow > 0.5) continue;
      set3(a3, w->o[0], w->o[1], zm); set3(b3, w->muzzle[0], w->muzzle[1], zm);
      R->prop_s[k] = rb_add(b, a3, 0.035, 1); R->prop_m[k] = rb_add(b, b3, 0.03, 1); RB_BONE(R->prop_s[k], R->prop_m[k]);
      R->P[R->prop_s[k]].q[1] -= 0.8 * b->dt0; R->P[R->prop_m[k]].q[0] -= 0.6 * b->dt0; R->P[R->prop_m[k]].q[1] -= 1.6 * b->dt0;
    }
    R->upper[0] = R->chest; R->upper[1] = R->head; R->n_upper = 2; R->center[0] = R->root; R->n_center = 1;
  } else if (ch->kind == CM_MECH) {
    double pr[3];
    copy3(pr, p->chest);
    R->root = rb_add(b, p->base.root, 0.3, 0.3); R->chest = rb_add(b, pr, ch->pod_r, 0.25); RB_BONE(R->root, R->chest);
    for (i = 0; i < CM_MAX_LEGS; i++) hip_of[i] = R->root;
    rb_legs(b, ch, p, hip_of, 0.3, 0.26, 1);
    for (i = 0; i < 2; i++) { RB_MIN(R->chest, R->knee[i], 0.6 * ch->pod_h); R->mount_z[i] = p->mount[i].joint[2]; R->mount_side[i] = p->mount[i].side; }
    R->n_mounts = p->n_mounts;
    R->upper[0] = R->chest; R->n_upper = 1; R->center[0] = R->root; R->n_center = 1;
  } else if (ch->kind == CM_QUAD) {
    int mid = ch->has_beast && ch->beast_mid;
    R->back = rb_add(b, p->back, 0.15, 0.3); R->front = rb_add(b, p->front, 0.15, 0.3); R->head = rb_add(b, p->head, 0.09, 0.9);
    RB_BONE(R->back, R->front); RB_BONE(R->front, R->head);
    RB_MIN(R->back, R->head, 0.88 * (rag_d2(R, &R->bones[0]) + rag_d2(R, &R->bones[1])));
    R->gaze_off = atan2(p->gaze[1], p->gaze[0]) - atan2(p->head[1] - p->front[1], p->head[0] - p->front[0]);
    R->mid = -1;
    if (mid) { R->mid = rb_add(b, p->base.root, 0.15, 0.3); RB_BONE(R->back, R->mid); RB_BONE(R->mid, R->front); }
    for (i = 0; i < ch->legs; i++) hip_of[i] = mid ? R->mid : ch->leg[i].attach[0] < 0 ? R->back : R->front;
    rb_legs(b, ch, p, hip_of, 0.05, 0.045, 1);
    R->upper[0] = R->front; R->upper[1] = R->head; R->n_upper = 2; R->center[0] = R->back; R->center[1] = R->front; R->n_center = 2;
  } else {
    double m3[3];
    R->back = rb_add(b, p->back, 0.5, 0.3); R->front = rb_add(b, p->front, 0.5, 0.3);
    set3(m3, (p->back[0] + p->front[0]) / 2, (p->back[1] + p->front[1]) / 2, 0);
    R->mid = rb_add(b, m3, 0.5, 0.3);
    RB_BONE(R->back, R->mid); RB_BONE(R->mid, R->front); RB_BONE(R->back, R->front);
    for (i = 0; i < ch->legs; i++) { double ax = ch->leg[i].attach[0]; hip_of[i] = ax > 0.3 ? R->front : ax < -0.3 ? R->back : R->mid; }
    rb_legs(b, ch, p, hip_of, 0.13, 0.06, 1);
    R->upper[0] = R->front; R->upper[1] = R->mid; R->n_upper = 2; R->center[0] = R->mid; R->n_center = 1;
  }
  /* limp chains start from where those parts were */
  R->n_claws = p->n_claws;
  for (i = 0; i < p->n_claws; i++) {
    double c4[4][3];
    copy3(c4[0], p->claw[i].shoulder); copy3(c4[1], p->claw[i].elbow); copy3(c4[2], p->claw[i].wrist); copy3(c4[3], p->claw[i].tip);
    limp_from(&R->claw[i], c4, 4, 0.05); R->claw_side[i] = p->claw[i].side;
  }
  if (p->n_tail_pts) limp_from(&R->tail, p->tail_pts, p->n_tail_pts, ch->has_beast ? 0.03 : 0.05);
  /* the blow: a push on the upper body, scaled so that big and small bodies fall alike */
  if (inp->die > 1) copy3(wi, inp->die_impulse); else set3(wi, -2.4 * R->frame[3], 1.0, -2.4 * R->frame[4]);     /* given in the world; default: from straight ahead */
  imp[0] = wi[0] * R->frame[3] + wi[2] * R->frame[4]; imp[1] = wi[1];
  for (i = 0; i < R->n_upper; i++) { R->P[R->upper[i]].q[0] -= imp[0] * sc * b->dt0; R->P[R->upper[i]].q[1] -= imp[1] * sc * b->dt0; }
  S->mode = CM_MODE_RAGDOLL; S->jump.stage = CM_JUMP_NONE; S->v = 0; S->om = 0; S->kv[0] = S->kv[1] = 0; S->act = CM_ACT_NONE;
  { cm_event e; memset(&e, 0, sizeof e); e.type = CM_EV_DIE; e.leg = -1; cm_event_push(S, &e); }
}
#undef RB_BONE
#undef RB_MIN

/* move two particles within the plane so that their true distance becomes rest */
static void rag_pull(cm_particle *A, cm_particle *B, double rest, double d) {
  double x = B->p[0] - A->p[0], y = B->p[1] - A->p[1], pl2 = x * x + y * y, k;
  if (pl2 < 0.01 * d * d) return;                              /* almost purely sideways: nothing to do in the plane */
  k = cm_clamp((d - rest) * d / pl2, -0.5, 0.5) / (A->w + B->w);
  A->p[0] += x * k * A->w; A->p[1] += y * k * A->w; B->p[0] -= x * k * B->w; B->p[1] -= y * k * B->w;
}
typedef struct { const double *fr; cm_terrain_fn fn; void *user; } rag_ground;
static double rg_at(const rag_ground *g, double x, double z) { return g->fn(g->fr[1] + (x - g->fr[0]) * g->fr[3] - z * g->fr[4], g->fr[2] + (x - g->fr[0]) * g->fr[4] + z * g->fr[3], g->user); }
/* a limp chain: points on links of fixed length, hanging from wherever its first point is put */
static void limp_step(cm_limp *Lc, const double anchor[3], const rag_ground *g, double dt, double (*out)[3]) {
  int n = Lc->n, i, j, it;
  double h = fmin(dt, 1.0 / 60);
  copy3(Lc->p[0], anchor);
  for (i = 1; i < n; i++) {
    double *p = Lc->p[i], *q = Lc->q[i], v[3];
    set3(v, (p[0] - q[0]) * 0.97, (p[1] - q[1]) * 0.97, (p[2] - q[2]) * 0.9);
    copy3(q, p); p[0] += v[0]; p[1] += v[1] - G * h * h; p[2] += v[2];
  }
  for (it = 0; it < 4; it++) for (i = 1; i < n; i++) {
    double *a = Lc->p[i - 1], *b = Lc->p[i], d[3], l, gy;
    sub3(b, a, d); l = len3(d); if (l == 0) l = 1;
    for (j = 0; j < 3; j++) b[j] = a[j] + d[j] / l * Lc->seg[i - 1];
    gy = rg_at(g, b[0], b[2]) + Lc->r;
    /* it drags on the ground (touching counts, so that every machine agrees) */
    if (b[1] < gy + 1e-7) { if (b[1] < gy) b[1] = gy; Lc->q[i][0] += (b[0] - Lc->q[i][0]) * 0.5; Lc->q[i][2] += (b[2] - Lc->q[i][2]) * 0.5; }
  }
  for (i = 0; i < n; i++) copy3(out[i], Lc->p[i]);
}

static void rp_pt(const cm_ragdoll *R, int k, double o[3]) { set3(o, R->P[k].p[0], R->P[k].p[1], R->P[k].z); }
static void unit2(const double a[3], const double c[3], double o[3]) { double x = c[0] - a[0], y = c[1] - a[1], l = sqrt(x * x + y * y); if (l == 0) l = 1; set3(o, x / l, y / l, 0); }
static void along2(const double o[3], const double d[3], double s, const double *n, double t, double r[3]) { set3(r, o[0] + d[0] * s + (n ? n[0] * t : 0), o[1] + d[1] * s + (n ? n[1] * t : 0), o[2]); }

/* the pose of the fallen body, in the frame it fell in */
static void rag_pose(cm_state *S, const cm_character *ch, const rag_ground *g, cm_pose *pose) {
  cm_ragdoll *R = &S->rag;
  double tw = R->tw;
  int k, i;
  pose->down = 1; pose->base.legs = R->legs;
#define LEGS(HIP) for (k = 0; k < R->legs; k++) { \
    const cm_leg_def *ld = &ch->leg[k]; cm_leg_pose *o = &pose->base.leg[k]; double an[3], d[3], n[3], tp[3]; \
    memset(o, 0, sizeof *o); HIP; rp_pt(R, R->knee[k], o->knee); rp_pt(R, R->ankle[k], an); copy3(o->ankle, an); copy3(o->ball, an); o->side = ld->side; o->has_foot = ld->has_foot; \
    if (ld->has_foot) { const cm_foot *F = &ld->foot; rp_pt(R, R->toe[k], tp); unit2(an, tp, d); set3(n, -d[1], d[0], 0); \
      along2(an, d, -F->hb, n, -F->ah, o->heel); along2(an, d, F->fb, n, -F->ah, o->ball); along2(an, d, F->fb + F->toe, n, -F->ah, o->toe); } \
    else { unit2(o->knee, an, d); along2(o->knee, d, ld->lower, 0, 0, o->ankle); } }
  if (ch->kind == CM_BIPED || ch->kind == CM_MECH) {
    double r[3], c[3], u[3], f[3], ct = cos(tw), sw = sin(tw), f3[3];
    rp_pt(R, R->root, r); rp_pt(R, R->chest, c); unit2(r, c, u); set3(f, u[1], -u[0], 0);
    set3(f3, f[0] * ct, f[1] * ct, sw);                         /* the turn it had is kept */
    pose->body = ch->kind == CM_BIPED ? CM_BODY_BIPED : CM_BODY_MECH;
    copy3(pose->base.root, r); copy3(pose->chest, c); copy3(pose->u, u); copy3(pose->f, f3); set3(pose->side, -f[0] * sw, -f[1] * sw, ct); pose->lean = atan2(u[0], u[1]);
    LEGS(set3(o->hip, r[0], r[1], ld->attach[2]))
    if (ch->kind == CM_BIPED) {
      rp_pt(R, R->head, pose->head); copy3(pose->gaze, f3);
      for (k = 0; k < 2; k++) {
        set3(pose->arm[k].shoulder, c[0] - u[0] * 0.04, c[1] - u[1] * 0.04, R->arm_sh_z[k]); rp_pt(R, R->elbow[k], pose->arm[k].elbow); rp_pt(R, R->hand[k], pose->arm[k].hand);
        pose->arm[k].side = R->arm_side[k];
      }
      pose->n_props = R->n_props;
      for (k = 0; k < R->n_props; k++) {
        cm_prop_pose *w = &pose->prop[k];
        if (R->prop_s[k] >= 0) { double s0[3], m0[3]; rp_pt(R, R->prop_s[k], s0); rp_pt(R, R->prop_m[k], m0); prop_at(R->prop_kind[k], s0, atan2(m0[1] - s0[1], m0[0] - s0[0]), s0[2], w); }
        else { place_t pl = stow_place(R->prop_kind[k], k, r, u, f, c[2]); prop_at(R->prop_kind[k], pl.o, pl.th, pl.z, w); w->stow = 1; }
      }
    } else {
      double a = R->aim, dm[3];
      set3(dm, f3[0] * cos(a) + u[0] * sin(a), f3[1] * cos(a) + u[1] * sin(a), f3[2] * cos(a));
      pose->n_mounts = R->n_mounts;
      for (k = 0; k < R->n_mounts; k++) {
        cm_mount_pose *m = &pose->mount[k];
        set3(m->joint, c[0] + 0.1 * f[0] - 0.3 * u[0], c[1] + 0.1 * f[1] - 0.3 * u[1], R->mount_z[k]);
        along2(m->joint, dm, -0.35, 0, 0, m->base); along2(m->joint, dm, ch->pod_gun_len, 0, 0, m->tip); copy3(m->dir, dm); m->flash = 0; m->side = R->mount_side[k];
      }
    }
  } else {
    int mid = ch->has_beast && ch->beast_mid;
    double bk[3], fr[3], ax[3], up[3], md[3];
    cm_mount_pose *m = &pose->mount[0];
    rp_pt(R, R->back, bk); rp_pt(R, R->front, fr); unit2(bk, fr, ax); set3(up, -ax[1], ax[0], 0);
    if (mid) rp_pt(R, R->mid, md); else set3(md, (bk[0] + fr[0]) / 2, (bk[1] + fr[1]) / 2, 0);
    copy3(pose->back, bk); copy3(pose->front, fr); copy3(pose->axis, ax); copy3(pose->up, up); pose->base.pitch = atan2(ax[1], ax[0]); copy3(pose->base.root, md);
    LEGS({ const double *at = ld->attach; const double *o3 = mid ? md : ch->kind == CM_QUAD ? (at[0] < 0 ? bk : fr) : (at[0] > 0.3 ? fr : at[0] < -0.3 ? bk : md); set3(o->hip, o3[0], o3[1], at[2]); })
    pose->n_mounts = 1; memset(m, 0, sizeof *m);
    if (ch->kind == CM_QUAD) {
      double hd[3], ga, qc = cos(tw), qs = sin(tw), gz[3], sdq[3], gup[3], gb[3];
      rp_pt(R, R->head, hd); ga = atan2(hd[1] - fr[1], hd[0] - fr[0]) + R->gaze_off;
      set3(gz, cos(ga) * qc, sin(ga), cos(ga) * qs); set3(sdq, -qs, 0, qc); cross3(sdq, gz, gup);
      set3(gb, hd[0] - 0.07 * gup[0], hd[1] - 0.07 * gup[1], hd[2] - 0.07 * gup[2]);
      pose->body = ch->has_beast ? CM_BODY_BEAST : CM_BODY_QUAD;
      copy3(pose->side, sdq); copy3(pose->head, hd); copy3(pose->gaze, gz); copy3(pose->neck, fr); along2(bk, ax, -0.36, up, 0.10, pose->tail);
      copy3(m->joint, hd); copy3(m->base, gb); along2(gb, gz, 0.34, 0, 0, m->tip); copy3(m->dir, gz);
      if (ch->has_beast) {
        double hg[3], anchor[3];
        set3(hg, hd[0] + 0.02 * gz[0] - 0.035 * gup[0], hd[1] + 0.02 * gz[1] - 0.035 * gup[1], hd[2] + 0.02 * gz[2] - 0.035 * gup[2]);
        copy3(m->base, hg); along2(hg, gz, ch->beast_jaw, 0, 0, m->tip);
        along2(fr, ax, 0.03, up, 0.10, pose->neck);
        if (ch->has_tail && R->tail.on) {
          along2(bk, ax, ch->tail_at[0] + ch->beast_back, up, ch->tail_at[1], anchor);
          limp_step(&R->tail, anchor, g, R->dt, pose->tail_pts); pose->n_tail_pts = R->tail.n; copy3(pose->tail, pose->tail_pts[ch->tail_n]);
        }
      }
    } else {
      double ta = R->aim * 0.5, tc = cos(tw), tj[3], td[3];
      along2(md, ax, 0.05, up, 0.6, tj);
      set3(td, (ax[0] * cos(ta) + up[0] * sin(ta)) * tc, ax[1] * cos(ta) + up[1] * sin(ta), cos(ta) * sin(tw));
      pose->body = ch->has_octo ? CM_BODY_OCTO : ch->has_arthro ? CM_BODY_ARTHRO : CM_BODY_SPIDER;
      along2(md, ax, -0.05, up, 0.24, pose->dome); along2(fr, ax, 0.5, up, -0.04, pose->eye);
      copy3(m->joint, tj); copy3(m->base, tj); along2(tj, td, 1.45, 0, 0, m->tip); copy3(m->dir, td);
      if (ch->has_octo) {
        pose->n_arms = R->legs;
        for (i = 0; i < R->legs; i++) arm_curve(pose->base.leg[i].hip, pose->base.leg[i].knee, pose->base.leg[i].ankle, ch->octo_arm.seg, pose->arms[i]);
        pose->has_mantle = 1; along2(md, ax, -0.10, up, 0.13, pose->mantle_c); along2(md, ax, -0.40, up, 0.16, pose->mantle_tip); pose->mantle_r = ch->octo_mantle;
        copy3(pose->dome, pose->mantle_c); copy3(pose->tail, pose->arms[0][6]);
        along2(md, ax, 0.10, up, 0.12, pose->eye); copy3(m->joint, md); copy3(m->base, md); copy3(m->tip, pose->eye); copy3(m->dir, ax);
      }
      if (ch->has_arthro) {
        /* claws and tail are limp chains now: they hang from the body, fall with it and lie where they land */
        double hf = ch->arthro_half;
        pose->no_tail = 1; pose->n_claws = R->n_claws;
        for (i = 0; i < R->n_claws; i++) {
          cm_claw_pose *cl = &pose->claw[i];
          double sh[3], c4[4][3], hv[3];
          along2(fr, ax, ch->claw_at[0] - hf, up, ch->claw_at[1], sh); sh[2] = R->claw_side[i] * ch->claw_at[2];
          limp_step(&R->claw[i], sh, g, R->dt, c4);
          sub3(c4[3], c4[2], hv);
          copy3(cl->shoulder, c4[0]); copy3(cl->elbow, c4[1]); copy3(cl->wrist, c4[2]); copy3(cl->tip, c4[3]);
          set3(cl->finger_a, c4[2][0] + hv[0] * 0.3, c4[2][1] + hv[1] * 0.3, c4[2][2] + hv[2] * 0.3);
          set3(cl->finger_b, cl->finger_a[0] + hv[0] * 0.7, cl->finger_a[1] + hv[1] * 0.7, cl->finger_a[2] + hv[2] * 0.7);
          cl->finger_b[1] += 0.02; cl->finger_b[2] -= R->claw_side[i] * 0.05; cl->side = R->claw_side[i]; cl->open = 0.3;
        }
        if (ch->arthro_has_thorax) { pose->has_thorax = 1; along2(md, ax, ch->arthro_thorax[0], up, ch->arthro_thorax[1], pose->thorax[0]); along2(md, ax, ch->arthro_thorax[2], up, ch->arthro_thorax[3], pose->thorax[1]); }
        if (ch->arthro_has_head) along2(md, ax, ch->arthro_head[0], up, ch->arthro_head[1], pose->eye);
        if (ch->has_tail && R->tail.on) {
          double anchor[3];
          int n = ch->tail_n;
          along2(bk, ax, ch->tail_at[0] + hf, up, ch->tail_at[1], anchor);
          limp_step(&R->tail, anchor, g, R->dt, pose->tail_pts); pose->n_tail_pts = R->tail.n; copy3(pose->tail, pose->tail_pts[n]); pose->no_tail = 0;
          copy3(m->joint, pose->tail_pts[n - 1]); copy3(m->base, pose->tail_pts[n - 1]); copy3(m->tip, pose->tail_pts[n]);
          sub3(pose->tail_pts[n], pose->tail_pts[n - 1], m->dir); unit3(m->dir);
        }
      }
    }
  }
#undef LEGS
}

static void step_ragdoll(cm_state *S, const cm_character *ch, cm_terrain_fn terrain, void *user, double dt, cm_pose *pose) {
  cm_ragdoll *R = &S->rag;
  rag_ground g;
  xform x;
  double L = ch->L, cx = 0, cy = 0;
  int i, it;
  g.fr = R->frame; g.fn = terrain; g.user = user;
  S->t += dt; R->t += dt; R->dt = dt;
  S->flash[0] = S->flash[1] = 0;
  if (!R->asleep) {
    double grav = G * dt * dt, fastest = 0, vm = 14 * sqrt(L) * dt;
    for (i = 0; i < R->n; i++) {
      cm_particle *q = &R->P[i];
      double vx = (q->p[0] - q->q[0]) * 0.998, vy = (q->p[1] - q->q[1]) * 0.998, vl = sqrt(vx * vx + vy * vy);
      if (vl > vm) { vx *= vm / vl; vy *= vm / vl; }
      q->q[0] = q->p[0]; q->q[1] = q->p[1]; q->p[0] += vx; q->p[1] += vy - grav; q->hit = 0;
    }
    for (it = 0; it < 12; it++) {
      for (i = 0; i < R->n_bones; i++) { cm_rag_link *c = &R->bones[i]; rag_pull(&R->P[c->a], &R->P[c->b], c->rest, rag_d2(R, c)); }
      for (i = 0; i < R->n_mins; i++) { cm_rag_link *c = &R->mins[i]; double d = rag_d2(R, c); if (d < c->rest) rag_pull(&R->P[c->a], &R->P[c->b], c->rest, d); }
      for (i = 0; i < R->n_maxs; i++) { cm_rag_link *c = &R->maxs[i]; double d = rag_d2(R, c); if (d > c->rest) rag_pull(&R->P[c->a], &R->P[c->b], c->rest, d); }
      for (i = 0; i < R->n_signs; i++) {                       /* a knee or elbow never bends backwards: at worst it is straight */
        cm_rag_sign *c = &R->signs[i];
        cm_particle *A = &R->P[c->a], *Bm = &R->P[c->b], *C = &R->P[c->c];
        double cr = rag_cross(A, Bm, C);
        if (cr * c->sign < 0) {
          /* the joint has gone past straight: push all three points back, each by its share */
          double gcx = -(Bm->p[1] - A->p[1]), gcy = Bm->p[0] - A->p[0], gax = -(C->p[1] - Bm->p[1]), gay = C->p[0] - Bm->p[0], gbx = -gax - gcx, gby = -gay - gcy;
          double den = A->w * (gax * gax + gay * gay) + Bm->w * (gbx * gbx + gby * gby) + C->w * (gcx * gcx + gcy * gcy);
          if (den > 1e-12) {
            double lam = -cr / den * 0.6;
            A->p[0] += lam * A->w * gax; A->p[1] += lam * A->w * gay; Bm->p[0] += lam * Bm->w * gbx; Bm->p[1] += lam * Bm->w * gby; C->p[0] += lam * C->w * gcx; C->p[1] += lam * C->w * gcy;
          }
        }
      }
      for (i = 0; i < R->n; i++) { cm_particle *q = &R->P[i]; double gy = rg_at(&g, q->p[0], q->z) + q->r; if (q->p[1] < gy + 1e-7) { if (q->p[1] < gy) q->p[1] = gy; q->hit = 1; } }     /* touching counts */
    }
    for (i = 0; i < R->n; i++) {
      cm_particle *q = &R->P[i];
      if (q->hit) { q->q[0] = q->p[0] - (q->p[0] - q->q[0]) * 0.7; if (q->q[1] < q->p[1]) q->q[1] = q->p[1]; }      /* ground friction, no bounce */
      fastest = fmax(fastest, fabs(q->p[0] - q->q[0]) + fabs(q->p[1] - q->q[1]));
    }
    R->still = fastest < 0.06 * sqrt(L) * dt ? R->still + dt : 0;
    if (R->still > 0.5 || R->t > 6) R->asleep = 1;
  }
  R->aim += (-0.45 - R->aim) * cm_decay(2.5, dt);
  rag_pose(S, ch, &g, pose);
  pose->base.heading = R->h;
  memset(&x, 0, sizeof x); x.fixed = R->frame;
  if (pose->body == CM_BODY_BIPED || pose->body == CM_BODY_MECH) {
    x_pt(&x, pose->base.root); x_pt(&x, pose->chest); x_dir(&x, pose->u); x_dir(&x, pose->f); x_dir(&x, pose->side);
    for (i = 0; i < pose->base.legs; i++) { cm_leg_pose *l = &pose->base.leg[i]; x_pt(&x, l->hip); x_pt(&x, l->knee); x_pt(&x, l->ankle); x_pt(&x, l->ball); x_pt(&x, l->heel); x_pt(&x, l->toe); }
    if (pose->body == CM_BODY_BIPED) {
      x_pt(&x, pose->head); x_dir(&x, pose->gaze);
      for (i = 0; i < 2; i++) { x_pt(&x, pose->arm[i].shoulder); x_pt(&x, pose->arm[i].elbow); x_pt(&x, pose->arm[i].hand); }
      for (i = 0; i < pose->n_props; i++) {
        cm_prop_pose *pw = &pose->prop[i];
        x_pt(&x, pw->o); x_pt(&x, pw->muzzle); x_pt(&x, pw->body); x_pt(&x, pw->grip); x_pt(&x, pw->grip_low); if (pw->has_fore) x_pt(&x, pw->fore);
        x_pt(&x, pw->mag_a); x_pt(&x, pw->mag_b); x_dir(&x, pw->dir); x_dir(&x, pw->up);
      }
    } else for (i = 0; i < pose->n_mounts; i++) { cm_mount_pose *m = &pose->mount[i]; x_pt(&x, m->joint); x_pt(&x, m->base); x_pt(&x, m->tip); x_dir(&x, m->dir); }
  } else {
    if (ch->has_fly) { wing_pose(ch, pose->base.root, pose->axis, pose->up, 0, 0, 1, pose->wing); pose->n_wings = 2; }      /* wings stay folded on a body that is down */
    x_pose(&x, pose, 1);
  }
  for (i = 0; i < R->n_center; i++) { cx += R->P[R->center[i]].p[0]; cy += R->P[R->center[i]].p[1]; }
  S->x = cx / R->n_center; S->y = S->last_y = cy / R->n_center;
  S->px = R->frame[1] + (S->x - R->frame[0]) * R->frame[3]; S->pz = R->frame[2] + (S->x - R->frame[0]) * R->frame[4];
}
void cm_stand(cm_state *S, const cm_character *ch, cm_terrain_fn terrain, void *user) { cm_leave_ladder(S, ch, terrain, user); }

/* ---------------------------------------------------------------------------------------------------- riding
   A port of mountUp, dismount and stepRide in js/core.js. The mount is stepped first; what the rider needs of it
   (its frame, and its root, long axis, up, neck and mouth) is taken from the pose its last step left. */
int cm_mount_up(cm_state *S, const cm_character *ch, const cm_state *mount, const cm_character *mount_ch) {
  cm_event e;
  if (ch->kind != CM_BIPED || !mount || !mount_ch || !mount_ch->has_saddle || S->mode == CM_MODE_RAGDOLL) return 0;
  let_go(S); S->act = CM_ACT_NONE; S->jump.stage = CM_JUMP_NONE; S->ladder = 0;
  S->mode = CM_MODE_RIDE; memset(&S->ride, 0, sizeof S->ride); S->mount = mount; S->mount_ch = mount_ch;
  S->v = 0; S->a = 0; S->om = 0; S->crouch = 0; S->air_b = 0; S->standing = 0; S->guard.x = S->guard.v = 0; S->stance.x = S->stance.v = 0; S->has_vl = 0;
  memset(&e, 0, sizeof e); e.type = CM_EV_MOUNT; e.leg = -1; cm_event_push(S, &e);
  return 1;
}
int cm_dismount(cm_state *S, const cm_character *ch, cm_terrain_fn terrain, void *user) {
  cm_event e;
  if (S->mode != CM_MODE_RIDE) return 0;
  S->px += 0.95 * sin(S->h); S->pz -= 0.95 * cos(S->h);        /* down on the mount's left side */
  let_go(S); S->act = CM_ACT_NONE; cm_leave_ladder(S, ch, terrain, user);
  memset(&e, 0, sizeof e); e.type = CM_EV_DISMOUNT; e.leg = -1; cm_event_push(S, &e);
  return 1;
}
static int step_ride(cm_state *S, const cm_character *ch, const cm_input *inp, const cm_style *st, cm_terrain_fn terrain, void *user, double dt, cm_pose *pose) {
  const cm_state *Sm = S->mount;
  const cm_character *cmt = S->mount_ch;
  const cm_pose *Pm = Sm ? &Sm->last : 0;
  cm_bctx B;
  cm_seat seat;
  cm_spring *d = &S->ride.d;
  double fr[5], rootm[3], *ax = seat.ax, *up = seat.up, k = ch->L / 0.92, Tn = TAU * sqrt(ch->L / G), wy, vy, pv, pitch_seat, gal, run;
  int i, grounded, still, r;
  if (!Sm || !cmt || !cmt->has_saddle || !Sm->has_last || Pm->body == CM_BODY_BIPED || Pm->body == CM_BODY_MECH) {      /* nothing to sit on */
    cm_dismount(S, ch, terrain, user);
    return ground_step(S, ch, inp, st, terrain, user, dt, pose);
  }
  S->t += dt;
  /* the rider's pose is worked out in the mount's own frame */
  if (Sm->mode == CM_MODE_LADDER || Sm->mode == CM_MODE_LEDGE) { memcpy(fr, Sm->lad_frame, sizeof fr); S->h = Sm->h; }
  else if (Sm->mode == CM_MODE_RAGDOLL) { memcpy(fr, Sm->rag.frame, sizeof fr); S->h = Sm->rag.h; }
  else { frame_now(Sm, fr); S->h = Sm->h; }
  S->x = fr[0]; S->px = fr[1]; S->pz = fr[2];
  copy3(ax, Pm->axis); inv_dir(fr, ax); copy3(up, Pm->up); inv_dir(fr, up); copy3(rootm, Pm->base.root); inv_pt(fr, rootm);
  cross3(ax, up, seat.sv);
  for (i = 0; i < 3; i++) seat.o[i] = rootm[i] + ax[i] * cmt->saddle_at[0] + up[i] * cmt->saddle_at[1];
  memset(&B, 0, sizeof B);
  B.fr.s = S; B.fr.hc = fr[3]; B.fr.hs = fr[4]; B.fr.fn = terrain; B.fr.user = user; B.fr.seat = &seat;
  /* the saddle's own rise and fall throws the rider: a spring holds him to it, and he cannot sink into it */
  wy = seat.o[1]; vy = S->ride.has_sy ? (wy - S->ride.sy) / dt : 0;
  S->ride.acc += (cm_clamp((vy - S->ride.svy) / dt, -3 * G, 3 * G) - S->ride.acc) * cm_decay(30, dt); S->ride.sy = wy; S->ride.svy = vy; S->ride.has_sy = 1;
  d->v -= 0.9 * S->ride.acc * dt; cm_spring_step(d, 0, 13 / sqrt(k), 0.45, dt);
  if (d->x < -0.012 * k) { d->x = -0.012 * k; d->v = fmax(d->v, 0); }
  if (d->x > 0.11 * k) { d->x = 0.11 * k; d->v = fmin(d->v, 0); }
  if (inp->has_hit) {
    double hm = sqrt(inp->hit[0] * inp->hit[0] + inp->hit[2] * inp->hit[2]), hf = inp->hit[0] * fr[3] + inp->hit[2] * fr[4];
    cm_event e;
    S->lean.v += 7 * hf / sqrt(k); S->rise.v += 8 * hm; S->flinch.v += 16 * hm; S->flinch_dir = hf < 0 ? -1 : 1; d->v += 0.6 * hm;
    memset(&e, 0, sizeof e); e.type = CM_EV_HIT; e.leg = -1; cm_event_push(S, &e);
  }
  grounded = Sm->mode == CM_MODE_GROUND; gal = grounded ? Sm->gait.gal : 0; run = grounded ? Sm->gait.run : 0; still = grounded && Sm->standing;
  S->idle_t = still ? S->idle_t + dt : 0; S->standing = 0; S->v = Sm->v; S->crouch = 0; S->air_b = 0;
  set3(B.root, 0, d->x, 0);
  pose->base.legs = 2;
  for (i = 0; i < 2; i++) {
    const cm_leg_def *ld = &ch->leg[i];
    const cm_foot *F = &ld->foot;
    cm_leg_pose *o = &pose->base.leg[i];
    double sg = ld->side, tgt[3], pole[3];
    memset(o, 0, sizeof *o);
    set3(o->hip, B.root[0] + ld->attach[0], B.root[1] + ld->attach[1], ld->attach[2]);
    set3(o->ball, cmt->saddle_stirrup[0], cmt->saddle_stirrup[1], sg * cmt->saddle_stirrup[2]);
    set3(tgt, o->ball[0] - F->fb, o->ball[1] + F->ah, o->ball[2]); set3(pole, 0.6, 0.15, sg);
    cm_ik2(o->hip, tgt, ld->upper, ld->lower, pole, o->knee, o->ankle);
    set3(o->heel, o->ball[0] - F->fb - F->hb, o->ball[1], o->ball[2]); set3(o->toe, o->ball[0] + F->toe, o->ball[1], o->ball[2]);
    o->planted = 1; o->side = ld->side; o->has_foot = 1;
    S->leg[i].fwd = 0; S->leg[i].swing.active = 0;
  }
  pv = d->v - S->ride.pv; S->ride.pv = d->v; S->pack.v -= 0.6 * pv; cm_spring_step(&S->pack, 0, 60 / Tn, 0.35, dt);
  pitch_seat = asin(cm_clamp(ax[1], -1, 1));
  B.Tn = Tn; B.idle = still; B.P = 2.1 * TAU * sqrt(ch->L / G); B.bank = grounded ? tan(0.7 * Sm->bank.x) : 0; B.leg0_side = ch->leg[0].side;
  B.has_aim = inp->has_aim != 0;
  if (B.has_aim) { double a3[3]; set3(a3, inp->aim[0], inp->aim[1], inp->has_aim > 2 ? inp->aim[2] : S->pz); cm_to_l(&B.fr, a3, B.aim); }
  B.has_hands = 1;
  set3(B.hands[0], cmt->saddle_hands[0], cmt->saddle_hands[1], cmt->saddle_hands[2]); set3(B.hands[1], cmt->saddle_hands[0], cmt->saddle_hands[1], -cmt->saddle_hands[2]);
  /* forward with the pace, back against a climb or a dive, and up out of the saddle with the bounce */
  B.lean_base = 0.04 + 0.10 * run + 0.22 * gal + (grounded ? 0 : 0.22) + atan(Sm->a / G) * 0.4 - 0.65 * pitch_seat + 1.2 * d->x / k;
  copy3(pose->base.root, B.root); pose->base.heading = S->h;
  r = body_step(S, ch, inp, st, dt, &B, pose, 0, 0, 0);
  /* hips and legs, from the seat to the world */
  point_w(&B.fr, pose->base.root);
  for (i = 0; i < 2; i++) { cm_leg_pose *o = &pose->base.leg[i]; point_w(&B.fr, o->hip); point_w(&B.fr, o->knee); point_w(&B.fr, o->ankle); point_w(&B.fr, o->ball); point_w(&B.fr, o->heel); point_w(&B.fr, o->toe); }
  pose->riding = 1;
  if (cmt->saddle_reins && S->armed.x < 0.6 && Pm->n_mounts > 0 && (Pm->body == CM_BODY_BEAST || Pm->body == CM_BODY_QUAD)) {
    double bit[3];
    if (cmt->saddle_reins == 1) copy3(bit, Pm->mount[0].base); else set3(bit, Pm->neck[0] + 0.2 * Pm->up[0], Pm->neck[1] + 0.2 * Pm->up[1], Pm->neck[2] + 0.2 * Pm->up[2]);
    pose->n_reins = 2;
    for (i = 0; i < 2; i++) { copy3(pose->reins[i][0], pose->arm[i].hand); copy3(pose->reins[i][1], bit); }
  }
  S->y = S->last_y = pose->base.root[1];
  return r;
}

int cm_step(cm_state *S, const cm_character *ch, const cm_input *inp, const cm_style *st, cm_terrain_fn terrain, void *user, double dt, cm_pose *pose) {
  int r;
  if (inp->die) {
    if (S->mode == CM_MODE_SWIM) cm_leave_swim(S, ch, terrain, user);
    if (S->mode != CM_MODE_RAGDOLL && S->has_last && S->last.base.legs > 0) { let_go(S); ragdoll_start(S, ch, inp); }
  }
  memset(pose, 0, sizeof *pose);
  pose->kind = ch->kind;
  switch (S->mode) {
    case CM_MODE_SWIM: step_swim(S, ch, inp, terrain, user, dt, pose); r = 0; break;
    case CM_MODE_FLY: r = step_fly(S, ch, inp, st, terrain, user, dt, pose); break;
    case CM_MODE_LADDER: r = step_ladder(S, ch, inp, st, dt, pose); break;
    case CM_MODE_LEDGE: r = step_ledge(S, ch, inp, st, terrain, user, dt, pose); break;
    case CM_MODE_RAGDOLL: step_ragdoll(S, ch, terrain, user, dt, pose); r = 0; break;
    case CM_MODE_RIDE: r = step_ride(S, ch, inp, st, terrain, user, dt, pose); break;
    default: r = ground_step(S, ch, inp, st, terrain, user, dt, pose);
  }
  S->last = *pose; S->has_last = 1;
  return r;
}
