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
static const prop_def PROPS[4] = {
  { 0.91, 0.57, { 0.24, -0.06 }, { 0.225, -0.115 }, 1, { 0.53, -0.035 }, { 0.35, -0.035 }, { 0.35, -0.15 }, 1.5, 5, 30, 1.7, 0.80 },      /* rifle */
  { 0.20, 0.12, { 0.025, -0.03 }, { 0.0, -0.11 }, 0, { 0, 0 }, { 0.012, -0.045 }, { 0.012, -0.12 }, 1.6, 3, 12, 1.1, 0.60 },              /* pistol */
  { 0.95, 0.15, { 0.07, 0 }, { 0.13, -0.09 }, 0, { 0, 0 }, { 0.13, 0.09 }, { 0.13, -0.09 }, 0, 0, 0, 0, 0 },                              /* sword */
  { 0.62, 0.31, { 0.31, 0.06 }, { 0.31, 0.02 }, 0, { 0, 0 }, { 0.26, 0.0 }, { 0.36, 0.0 }, 0, 0, 0, 0, 0 }                                /* shield */
};
typedef struct { int n, props[2]; double rate; int melee; } kit_def;
static const kit_def KITS[4] = {
  { 0, { 0, 0 }, 0, 0 },
  { 1, { CM_PROP_RIFLE, 0 }, 9, 0 },
  { 2, { CM_PROP_PISTOL, CM_PROP_PISTOL }, 7, 0 },
  { 2, { CM_PROP_SWORD, CM_PROP_SHIELD }, 0, 1 }
};
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
  if (!kit || kit->melee || S->act || S->armed.x < 0.8) return 0;
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
  if (!inp->fire || S->cool > 0 || S->act > CM_ACT_RELOAD || ch->mount_type == CM_MOUNT_JAW) return;
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
  if (inp->bite && !S->act && J->stage == CM_JUMP_NONE) { a = new_action(S, CM_ACT_BITE, 0.46 * k); if (inp->bite > 1) { a->has_target = 1; copy3(a->target, inp->bite_target); } }
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
  int free_ = !S->act;
  double q;
  memset(AC, 0, sizeof *AC);
  S->act_back = 0; S->act_crouch = 0;
  if (ch->arthro_rock != 0 && S->standing) S->act_back = ch->arthro_rock * sin(TAU * S->t / 1.4);       /* a mantis rocks like a leaf in the wind */
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
  if (inp->grab && !S->act) { a = new_action(S, CM_ACT_GRAB, 0.8); a->arm = -1; if (inp->grab > 1) { a->has_target = 1; copy3(a->target, inp->grab_target); } }
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
static void tail_step(cm_state *S, const cm_character *ch, const cm_bctx *B, const double base[3], double body_ang, const chain_ctl *ctl, double dt, double (*pts)[3]) {
  cm_chain *C = &S->tail;
  int n = ch->tail_n, k, sub, nsub, pulling = ctl->pull_pts && ctl->pull_k > 0;
  double sz = sqrt(ch->L / 0.7), om0 = ch->tail_omega / sz, zeta = ch->tail_zeta, soft = ch->tail_soft, seg = ch->tail_seg, bend = ch->tail_bend;
  double th0 = body_ang + PI + ch->tail_rest - ctl->lift, ps0 = cm_clamp(ctl->yaw, -1.2, 1.2), curl = ch->tail_curl + ctl->curl, sag = ch->tail_sag;
  double vy, kf, hdt, inert = ch->tail_inert, pth, pps, pvt, pvp;
  const double *dr = B->drift;
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
      gy = cm_ter(&B->fr, q[0], q[2]) + 0.03;
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
static void scale3(const double a[3], double k, double o[3]) { o[0] = a[0] * k; o[1] = a[1] * k; o[2] = a[2] * k; }
static void axpy3(const double a[3], const double d[3], double k, double o[3]) { set3(o, a[0] + d[0] * k, a[1] + d[1] * k, a[2] + d[2] * k); }
static void unit3(double a[3]) { double l = len3(a); if (l == 0) l = 1; scale3(a, 1 / l, a); }
static void cross3(const double a[3], const double b[3], double o[3]) { set3(o, a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]); }
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
static void dir_w(const cm_frame *fr, double d[3]) { double x = d[0] * fr->hc - d[2] * fr->hs, z = d[0] * fr->hs + d[2] * fr->hc; d[0] = x; d[2] = z; }

int cm_step(cm_state *S, const cm_character *ch, const cm_input *inp, const cm_style *st, cm_terrain_fn terrain, void *user, double dt, cm_pose *pose) {
  cm_bctx B;
  act_out AC;
  const double *root;
  double lean, FL, bank, sway0, u[3], f[3], zax[3];
  int biped = ch->kind == CM_BIPED, kit_want, busy, ready, i;

  memset(pose, 0, sizeof *pose);
  pose->kind = ch->kind;
  cm_ground_core(S, ch, inp, st, terrain, user, dt, &pose->base, &B);
  root = B.root;
  /* kits: the weapons are put away before changing to another set, then the new ones come up */
  kit_want = ch->mount_type == CM_MOUNT_HELD ? (inp->kit >= CM_KIT_RIFLE && inp->kit <= CM_KIT_SWORD ? inp->kit : S->kit) : CM_KIT_NONE;
  if (biped) act_tick(S, ch, inp, dt, &B, &AC);
  else if (ch->has_beast) beast_tick(S, ch, inp, dt, &AC);
  else if (ch->has_arthro) arthro_tick(S, ch, inp, dt, &AC);
  else if (ch->has_octo) octo_tick(S, inp, dt, &AC);
  else memset(&AC, 0, sizeof AC);
  /* hands that are busy with a load or a fight cannot hold weapons: those are put away first */
  busy = S->carry || S->guard.x > 0.05 || (biped && inp->guard);
  ready = inp->armed && kit_want == S->kit && !busy;
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
    int k, j;
    horizontal(S, ch, &B, pose, &AC, lean, FL, dt);
    if (ch->has_fly) { wing_pose(ch, root, pose->axis, pose->up, 0, 0, 1, pose->wing); pose->n_wings = 2; }      /* on the ground the wings are folded along the body */
    /* to the world: points are moved and turned, directions only turned */
    dir_w(&B.fr, pose->axis); dir_w(&B.fr, pose->up); point_w(&B.fr, pose->back); point_w(&B.fr, pose->front); point_w(&B.fr, pose->tail);
    if (pose->body == CM_BODY_BEAST || pose->body == CM_BODY_QUAD) { point_w(&B.fr, pose->neck); point_w(&B.fr, pose->head); dir_w(&B.fr, pose->gaze); dir_w(&B.fr, pose->side); }
    else { point_w(&B.fr, pose->dome); point_w(&B.fr, pose->eye); }
    point_w(&B.fr, pose->mount[0].joint); point_w(&B.fr, pose->mount[0].base); point_w(&B.fr, pose->mount[0].tip); dir_w(&B.fr, pose->mount[0].dir);
    for (k = 0; k < pose->n_tail_pts; k++) point_w(&B.fr, pose->tail_pts[k]);
    for (k = 0; k < pose->n_claws; k++) {
      cm_claw_pose *cl = &pose->claw[k];
      point_w(&B.fr, cl->shoulder); point_w(&B.fr, cl->elbow); point_w(&B.fr, cl->wrist); point_w(&B.fr, cl->tip); point_w(&B.fr, cl->finger_a); point_w(&B.fr, cl->finger_b);
    }
    if (pose->has_thorax) { point_w(&B.fr, pose->thorax[0]); point_w(&B.fr, pose->thorax[1]); }
    for (k = 0; k < pose->n_arms; k++) for (j = 0; j < 7; j++) point_w(&B.fr, pose->arms[k][j]);
    if (pose->has_mantle) { point_w(&B.fr, pose->mantle_c); point_w(&B.fr, pose->mantle_tip); }
    for (k = 0; k < pose->n_wings; k++) { cm_wing_pose *w = &pose->wing[k]; point_w(&B.fr, w->root); point_w(&B.fr, w->mid); point_w(&B.fr, w->tip); dir_w(&B.fr, w->t1); dir_w(&B.fr, w->t2); }
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
    if (pose->has_carry) { point_w(&B.fr, pose->carry.c); dir_w(&B.fr, pose->carry.f); dir_w(&B.fr, pose->carry.u); dir_w(&B.fr, pose->carry.side); }
  }
  return 0;
}
