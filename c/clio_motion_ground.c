/* Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE).
   SPDX-License-Identifier: Apache-2.0

   Stage 2: the ground step. A port of stepGround in js/core.js, kept statement for statement so that it gives
   the same numbers; checked against the replays in spec/ground/. */
#include "clio_motion.h"
#include <math.h>
#include <string.h>

#define TAU 6.283185307179586
#define PI 3.141592653589793
#define G CM_G

const cm_style CM_STYLE = { 1.0, 1.0, 1.0, 1.0, 1.0, 0.3 };

/* the body's frame for one step: live place and local x from the state, heading fixed after the turn */
typedef struct { const cm_state *s; double hc, hs; cm_terrain_fn fn; void *user; } frame;

static void to_w(const frame *f, const double p[3], double o[3]) {
  double x = p[0] - f->s->x, z = p[2];
  o[0] = f->s->px + x * f->hc - z * f->hs; o[1] = p[1]; o[2] = f->s->pz + x * f->hs + z * f->hc;
}
static void to_l(const frame *f, const double p[3], double o[3]) {
  double x = p[0] - f->s->px, z = p[2] - f->s->pz;
  o[0] = f->s->x + x * f->hc + z * f->hs; o[1] = p[1]; o[2] = -x * f->hs + z * f->hc;
}
/* ground height under a point given in the body's frame */
static double ter(const frame *f, double lx, double lz) {
  const cm_state *s = f->s;
  return f->fn(s->px + (lx - s->x) * f->hc - lz * f->hs, s->pz + (lx - s->x) * f->hs + lz * f->hc, f->user);
}
static double slope_at(const frame *f, double x, double w) {
  return cm_clamp(atan2(ter(f, x + w, 0) - ter(f, x - w, 0), 2 * w), -0.45, 0.45);
}
static void event(cm_state *s, int type, int leg, int side, double x, double y, double z, double hd) {
  cm_event *e;
  if (s->n_events >= CM_MAX_EVENTS) return;
  e = &s->events[s->n_events++];
  e->type = type; e->leg = leg; e->side = side; e->x = x; e->y = y; e->z = z; e->hd = hd;
}
static void swing_start(cm_leg_state *lg, int manual, double rate, double psi0, int air, int early, int with_target) {
  cm_swing *sw = &lg->swing;
  memset(sw, 0, sizeof *sw);
  sw->active = 1; sw->air = air; sw->manual = manual; sw->early = early; sw->rate = rate; sw->psi0 = psi0;
  sw->start[0] = lg->ball[0]; sw->start[1] = lg->ball[1]; sw->start[2] = lg->ball[2];
  sw->alpha0 = lg->alpha; sw->ty = lg->ball[1];
  if (with_target) { sw->tx = lg->ball[0]; sw->tz = lg->ball[2]; sw->has_tz = 1; }
}
static void rest_of(const cm_character *ch, int k, double stK, double r[2]) {
  r[0] = ch->leg[k].rest[0]; r[1] = ch->leg[k].rest[1];
  if (stK > 0) { r[0] = r[0] + stK * ch->fight_stance[k][0]; r[1] = r[1] + stK * ch->fight_stance[k][1]; }
}
static int any_swing(const cm_state *s) {
  int i;
  for (i = 0; i < s->legs; i++) if (s->leg[i].swing.active) return 1;
  return 0;
}

void cm_state_init(cm_state *s, const cm_character *ch, cm_terrain_fn terrain, void *user) {
  double g0 = terrain(0.0, 0.0, user);
  int i;
  memset(s, 0, sizeof *s);
  s->y = g0 + ch->root_height; s->last_y = s->y;
  s->standing = 1;
  s->g_ref.x = g0;
  s->flinch_dir = -1;
  s->tv[0] = 1;
  s->legs = ch->legs;
  for (i = 0; i < ch->legs; i++) {
    cm_leg_state *lg = &s->leg[i];
    lg->ball[0] = ch->leg[i].rest[0]; lg->ball[1] = terrain(ch->leg[i].rest[0], 0.0, user); lg->ball[2] = ch->leg[i].rest[1];
    lg->ref_y = g0;
  }
}

void cm_step_ground(cm_state *S, const cm_character *ch, const cm_input *inp, const cm_style *st, cm_terrain_fn terrain, void *user, double dt, cm_ground_pose *out) {
  double L = ch->L, Tn0, he, om_spot, om_max, om_t, hc, hs, vT, a_max, dv, dx = 1, dz = 0, d_in;
  double duty, period, stance_travel, kd, mvx, mvz, mv_max, mvm, kmv, mvl[2], mvs, stK;
  double mean_y = 0, mx = 0, sxx = 0, sxy = 0, pitch_t, pitch, flex = 0, cp, sn, h, phi_mid, c, bob, sway, idle, P, ix, iy, bank_t, sway0, y0, need = 0, vy;
  double hips[CM_MAX_LEGS][3], ankles[CM_MAX_LEGS][3], heels[CM_MAX_LEGS][3], toes[CM_MAX_LEGS][3], balls[CM_MAX_LEGS][3];
  cm_gait_params gp;
  cm_jump *J = &S->jump;
  frame fr;
  int n = S->legs, i, hasJ, air, standing;

  S->t += dt;
  Tn0 = TAU * sqrt(L / G);
  /* steering: a turn rate, limited by sideways grip at speed and by how fast the feet can shuffle on the spot */
  he = inp->has_heading ? cm_wrap_pi(inp->heading - S->h) : 0.0;
  om_spot = 5 / Tn0 * cm_clamp(1.8 - S->lag / 0.2, 0.2, 1) * cm_clamp(1 - S->v / (0.5 * sqrt(G * L)), 0, 1);
  om_max = fmax(om_spot, S->v > 0.01 ? fmin(0.35 * G / S->v, S->v / (1.1 * L)) : 0) * cm_clamp(1 - S->reach_drop / (0.05 * L), 0.1, 1);
  om_t = inp->has_heading ? cm_clamp(he * 6, -om_max, om_max) : cm_clamp(inp->steer, -1, 1) * om_max;
  if (J->stage == CM_JUMP_AIR) om_t = S->om;
  S->om += (om_t - S->om) * cm_decay(16 / Tn0, dt);
  S->h = cm_wrap_pi(S->h + S->om * dt);
  hc = cos(S->h); hs = sin(S->h);
  fr.s = S; fr.hc = hc; fr.hs = hs; fr.fn = terrain; fr.user = user;

  /* a blow that does not floor the body: it slides, the torso snaps away, the knees give */
  if (inp->has_hit) {
    const double *hi = inp->hit;
    double kq = sqrt(L / 0.92), hf = hi[0] * hc + hi[2] * hs, hlat = -hi[0] * hs + hi[2] * hc, hm = sqrt(hf * hf + hlat * hlat);
    S->kv[0] += 0.6 * kq * hi[0]; S->kv[1] += 0.6 * kq * hi[2];
    S->lean.v += 7 * hf / kq; S->hop.v -= 1.1 * hm * kq; S->side.v += 1.2 * hlat * kq; S->rise.v += 8 * hm; S->flinch.v += 16 * hm;
    S->flinch_dir = hf < 0 ? -1 : 1;
    event(S, CM_EV_HIT, -1, 0, 0, 0, 0, 0);
  }
  S->crouch += (fmax(cm_clamp(inp->crouch, 0, 1), S->act_crouch) - S->crouch) * cm_decay(14 / Tn0, dt);
  vT = cm_clamp(inp->speed, 0, ch->vmax * (1 - 0.65 * fmin(S->crouch, 1)));
  if (S->carry) vT = S->act ? 0 : fmin(vT, 0.62 * sqrt(G * L));
  if (inp->has_heading) vT *= cm_clamp(1.5 - fabs(he) / 0.8, 0, 1);       /* brake for a sharp turn, pivot, then go */
  a_max = (vT > S->v ? 0.4 : 0.65) * G;
  if (J->stage == CM_JUMP_LAND && J->pounce) a_max = 1.3 * G;              /* dig in after a pounce */
  dv = cm_clamp(vT - S->v, -a_max * dt, a_max * dt);
  if (J->stage == CM_JUMP_AIR) dv = 0;                                     /* no steering in the air */
  d_in = inp->dir;
  if (d_in != 0 || S->has_vl) {
    /* travel in any direction while facing another: the velocity is steered as a vector */
    double cA = cos(d_in), sA = sin(d_in), vK = 1 - 0.62 * sA * sA - (cA < 0 ? 0.5 * cA * cA : 0), tvx, tvz, tl, am, nv;
    if (!S->has_vl) { S->has_vl = 1; S->vl[0] = S->v; S->vl[1] = 0; }
    tvx = vT * vK * cA - S->vl[0]; tvz = vT * vK * sA - S->vl[1]; tl = sqrt(tvx * tvx + tvz * tvz); am = 0.55 * G * dt;
    if (J->stage != CM_JUMP_AIR) {
      if (tl > am) { tvx *= am / tl; tvz *= am / tl; }
      S->vl[0] += tvx; S->vl[1] += tvz;
    }
    nv = sqrt(S->vl[0] * S->vl[0] + S->vl[1] * S->vl[1]);
    dv = nv - S->v;
    if (nv > 1e-3) { S->tv[0] = S->vl[0] / nv; S->tv[1] = S->vl[1] / nv; }
    dx = S->tv[0]; dz = S->tv[1];
    if (d_in == 0 && fabs(S->vl[1]) < 1e-4 && S->vl[0] >= 0 && tl < 1e-6) { S->has_vl = 0; dx = 1; dz = 0; }   /* going straight ahead again */
  }
  S->a += (dv / dt - S->a) * cm_decay(30 / Tn0, dt);
  S->v += dv;
  cm_gait_params_step(&ch->gait, &S->gait, S->v, S->crouch, st->stride, dt, &gp);
  duty = gp.duty; period = gp.period;

  /* jump: crouch (prep), leave the ground on a ballistic arc (air), absorb the landing with a spring (land) */
  if (inp->jump && J->stage == CM_JUMP_NONE && ch->jump_h != 0 && !S->carry && !(S->act > 1)) {
    memset(J, 0, sizeof *J);
    J->stage = CM_JUMP_PREP; J->v0 = sqrt(2 * G * ch->jump_h * L);
  }
  if (inp->has_pounce && J->stage == CM_JUMP_NONE && ch->has_beast && !S->act) {
    /* a leap onto something: a flat arc along the heading, far enough to bring the jaws down on the target */
    double pt0[3], pdist, pv0;
    if (inp->has_pounce_target) to_l(&fr, inp->pounce_target, pt0); else { pt0[0] = S->x + 3.4 * L; pt0[1] = 0; pt0[2] = 0; }
    pdist = cm_clamp(pt0[0] - S->x - 1.3 * L - S->v * (0.11 * Tn0 + 0.12), 1.2 * L, 5.5 * L);
    pv0 = sqrt(0.3 * G * pdist);
    memset(J, 0, sizeof *J);
    J->stage = CM_JUMP_PREP; J->v0 = pv0; J->pounce = 1; J->vx = pdist * G / (2 * pv0);
  }
  hasJ = J->stage != CM_JUMP_NONE;
  if (hasJ) {
    J->t += dt;
    if (J->stage == CM_JUMP_PREP && J->t > 0.11 * Tn0) {
      /* push off: constant thrust over the crouch depth, so take-off speed is reached at standing height */
      J->stage = CM_JUMP_PUSH; J->t = 0; J->acc = J->v0 * J->v0 / (2 * fmax(-S->hop.x, 0.05 * L)); S->hop.v = 0;
    }
    if (J->stage == CM_JUMP_PUSH && S->hop.x >= 0) {
      J->stage = CM_JUMP_AIR; J->t = 0; J->vy = fmin(S->hop.v, 1.1 * J->v0); J->y = S->y; S->reach_drop = 0;
      if (J->pounce) { S->v = fmax(S->v, J->vx); S->a = 0; }
      J->phi = cm_frac(0.02 - gp.phases[0] + 1);              /* the stride phase to land in */
      for (i = 0; i < n; i++) { swing_start(&S->leg[i], 1, 0, 0, 1, 0, 0); S->leg[i].swing.tx = S->leg[i].ball[0]; }
      event(S, CM_EV_JUMP, -1, 0, 0, 0, 0, 0);
    }
  }
  air = J->stage == CM_JUMP_AIR;
  if (air) {
    double gl = 0;
    J->vy -= G * dt; J->y += J->vy * dt;
    for (i = 0; i < n; i++) gl += ter(&fr, S->x + ch->leg[i].rest[0], 0);
    gl /= n;
    if (J->vy < 0 && J->y <= gl + ch->root_height * (1 - ch->crouch_drop * S->crouch)) {
      J->stage = CM_JUMP_LAND; J->t = 0; J->landed = 1; air = 0;
      S->g_ref.x = gl; S->g_ref.v = 0; S->phase = J->phi;
      for (i = 0; i < n; i++) {
        cm_leg_state *lg = &S->leg[i];
        double lx = lg->ball[0], ly = ter(&fr, lx, 0), wj[3];
        lg->ball[1] = ly; lg->swing.active = 0; lg->has_w = 0; lg->hd = S->h; lg->strike = 0; lg->alpha = 0; lg->ref_y = ly; lg->drop = 0;
        lg->slope = ch->leg[i].has_foot ? slope_at(&fr, lx, 0.5 * ch->leg[i].foot.fb) : 0;
        to_w(&fr, lg->ball, wj);
        event(S, CM_EV_LAND, i, ch->leg[i].side, wj[0], ly, wj[2], S->h);
      }
    }
  }
  S->air_b += ((air ? 1 : 0) - S->air_b) * cm_decay(24 / Tn0, dt);
  standing = vT <= 1e-4 && S->v < 0.05 * sqrt(G * L);
  if (standing && !S->standing) {
    /* stopping: let any foot in the air finish its step on its own clock */
    for (i = 0; i < n; i++) {
      cm_swing *sw0 = &S->leg[i].swing;
      if (sw0->active && !sw0->manual) {
        double tr = cm_clamp((1 - sw0->s) * (1 - duty) * period, 0.06 * gp.Tn, 0.2 * gp.Tn);
        sw0->manual = 1; sw0->rate = fmax(1 - sw0->s, 0.05) / tr;
      }
    }
  }
  if (!standing && S->standing && !any_swing(S)) S->phase = cm_frac(duty - gp.phases[0] + 1);     /* first leg is about to lift */
  S->standing = standing;
  if (!standing && !air) S->phase = cm_frac(S->phase + dt / period);
  S->x += S->v * dx * dt;
  kd = exp(-dt / (0.12 * Tn0));
  /* drift: slow movement in any direction without turning to face it; the feet shuffle to keep up */
  mvx = standing && inp->has_move ? inp->move[0] : 0; mvz = standing && inp->has_move ? inp->move[1] : 0;
  mv_max = 0.33 * sqrt(G * L); mvm = sqrt(mvx * mvx + mvz * mvz); kmv = cm_decay(20 / Tn0, dt);
  if (mvm > mv_max) { mvx *= mv_max / mvm; mvz *= mv_max / mvm; }
  S->mv[0] += (mvx - S->mv[0]) * kmv; S->mv[1] += (mvz - S->mv[1]) * kmv;
  mvl[0] = S->mv[0] * hc + S->mv[1] * hs; mvl[1] = -S->mv[0] * hs + S->mv[1] * hc; mvs = sqrt(mvl[0] * mvl[0] + mvl[1] * mvl[1]);
  S->px += (hc * S->v * dx - hs * S->v * dz + S->kv[0] + S->mv[0]) * dt; S->pz += (hs * S->v * dx + hc * S->v * dz + S->kv[1] + S->mv[1]) * dt;
  S->kv[0] *= kd; S->kv[1] *= kd;
  /* fighting stance: the feet stand staggered while on guard */
  cm_spring_step(&S->stance, standing && ch->has_fight && S->guard.x > 0.5 ? 1 : 0, 14, 1, dt);
  stK = ch->has_fight ? cm_clamp(S->stance.x, 0, 1) : 0;
  /* feet are remembered in the world: find where each one is in the body's frame this step */
  for (i = 0; i < n; i++) {
    cm_leg_state *lg = &S->leg[i];
    cm_swing *swp = &lg->swing;
    if (swp->active && !swp->air) {
      if (!swp->has_start_w) { if (lg->has_w) memcpy(swp->start_w, lg->w, sizeof lg->w); else to_w(&fr, swp->start, swp->start_w); swp->has_start_w = 1; }
      to_l(&fr, swp->start_w, swp->start);
    } else if (!swp->active && lg->has_w) to_l(&fr, lg->w, lg->ball);
  }
  S->idle_t = standing && !hasJ && fabs(S->om) < 0.2 ? S->idle_t + dt : 0;

  stance_travel = duty * gp.stride;
  for (i = 0; i < n; i++) {
    cm_leg_state *lg = &S->leg[i];
    const cm_leg_def *ld = &ch->leg[i];
    cm_swing *sw;
    double psi;
    if (air) {
      /* feet trail the body: legs stretch at take-off, tuck at the top, reach down to land */
      double psi_l = cm_frac(J->phi + gp.phases[i]);
      double offx = psi_l < duty ? stance_travel * (0.5 - psi_l / duty) : -0.3 * stance_travel;
      double h_stand = ch->root_height + ld->attach[1];
      double lat = ld->rest[1] - ld->attach[2], lmx = 0.96 * (ld->upper + ld->lower);
      double ext = cm_clamp((sqrt(fmax(lmx * lmx - lat * lat, 0)) + (ld->has_foot ? ld->foot.ah : 0)) / h_stand, 1, 1.1);
      double tuck = fmax(0, 0.3 * (1 - pow(J->vy / J->v0, 2))), txa, tya, kA, t_land;
      if (J->pounce) offx += ch->beast_mid && J->vy < 0 ? 0.22 * L : ld->attach[0] > 0 ? (J->vy < 0 ? 0.50 : 0.30) * L : -0.30 * L * fmax(0, J->vy / J->v0);
      txa = S->x + ld->rest[0] + offx * dx;
      tya = fmax(J->y + ld->attach[1] - h_stand * ext * (1 - tuck), ter(&fr, txa, 0) + 0.01 * L);
      kA = cm_decay(34 / Tn0, dt);
      lg->ball[0] = cm_lerp(lg->ball[0] + S->v * dt, txa, kA); lg->ball[1] = cm_lerp(lg->ball[1], tya, kA); lg->ball[2] = ld->rest[1];
      lg->alpha = ld->has_foot ? 0.12 + 0.6 * fmax(0, J->vy / J->v0) : 0;
      t_land = (J->vy + sqrt(J->vy * J->vy + 2 * G * fmax(0, J->y - (S->g_ref.x + ch->root_height)))) / G;
      lg->swing.tx = txa + S->v * t_land; lg->swing.ty = ter(&fr, lg->swing.tx, 0);
      lg->ref_y = ter(&fr, S->x + ld->rest[0], 0); lg->psi = psi_l; lg->drop = 0;
      continue;
    }
    psi = cm_frac(S->phase + gp.phases[i]);
    lg->psi = psi;
    lg->drop *= exp(-dt / 0.03);
    if (!lg->swing.active && !standing && psi >= duty) swing_start(lg, 0, 0, fmin(psi, 0.97), 0, 0, 0);
    sw = &lg->swing;
    if (sw->active) {
      int done = 0, up;
      double t_rem, vL, lead, fwd, ang, ca, sa, rr[2], rx, rz, ch2, sh2, tx, tz, ty, e, bx, bz, dist, lift, ey, eY, by;
      if (sw->manual) { sw->s += sw->rate * dt; if (sw->s >= 1) { sw->s = 1; done = 1; } }
      else if (psi < duty && !sw->early) { sw->s = 1; done = 1; }
      else { sw->s = fmax(sw->s, (psi - sw->psi0) / (1 - sw->psi0)); if (psi >= duty) sw->early = 0; }
      t_rem = done ? 0 : sw->manual ? (1 - sw->s) / sw->rate : (1 - psi) * period;
      /* land ahead of the hip so that mid-stance ends up under it; allow for speeding up or slowing down */
      vL = cm_clamp(S->v + S->a * t_rem, 0, ch->vmax);
      lead = 0.5 * duty * gp.stride * pow(cm_clamp(vL / fmax(S->v, 0.05 * sqrt(G * L)), 0.4, 1.8), 0.6);
      if (sw->manual) {
        double pl = cm_frac(psi + t_rem / period);
        lead = standing || pl >= duty ? 0 : S->v * period * (duty - pl - duty / 2);
      }
      /* where the foot's place under the body will be when it lands: the body will have moved on and turned */
      fwd = S->v * t_rem + 0.5 * S->a * t_rem * t_rem * (standing ? 0 : 1); ang = S->om * t_rem; ca = cos(ang); sa = sin(ang);
      rest_of(ch, i, stK, rr); rx = rr[0] + lead * dx; rz = rr[1] + lead * dz; ch2 = cos(ang / 2); sh2 = sin(ang / 2);
      if (dz != 0) rz = ld->side > 0 ? fmax(rz, 0.02 * L) : fmin(rz, -0.02 * L);     /* going sideways, a foot closes up to the other but does not cross it */
      tx = S->x + fwd * (dx * ch2 - dz * sh2) + rx * ca - rz * sa; tz = fwd * (dx * sh2 + dz * ch2) + rx * sa + rz * ca;
      if (standing && mvs > 1e-4) { double ahead = t_rem + 0.09 * gp.Tn; tx += mvl[0] * ahead; tz += mvl[1] * ahead; }   /* drifting: step to where the body is going */
      ty = ter(&fr, tx, tz);
      sw->tx = tx; sw->ty = ty; sw->tz = tz; sw->has_tz = 1;
      e = cm_ease(sw->s, st->snap);
      bx = cm_lerp(sw->start[0], tx, e); bz = cm_lerp(sw->start[2], tz, e);
      dist = sqrt(pow(tx - sw->start[0], 2) + pow(tz - sw->start[2], 2));
      lift = L * cm_lerp(ch->lift_walk, ch->lift_run, S->gait.run) * st->step * cm_clamp(dist / (0.3 * L), 0.2, 1) * (sw->manual ? 0.7 : 1);
      up = ty > sw->start[1];
      ey = up ? 1 - pow(1 - sw->s, 3) : pow(sw->s, 3);       /* rise early onto a ledge, drop late off one */
      eY = cm_lerp(e, ey, cm_clamp(fabs(ty - sw->start[1]) / (0.1 * L), 0, 1));
      by = cm_lerp(sw->start[1], ty, eY) + lift * sin(PI * sw->s);
      by = fmax(by, ter(&fr, bx, bz) + 0.004 * L);
      if (ld->has_foot) {
        double land_a = -ld->foot.strike * (1 - 0.8 * S->gait.run) * cm_clamp(dist / (0.3 * L), 0, 1) * (sw->manual ? 0.3 : 1);
        lg->alpha = sw->alpha0 * (1 - cm_smooth(0, 0.55, sw->s)) + land_a * cm_smooth(0.5, 0.95, sw->s);
      }
      if (done) {
        double gy = ter(&fr, bx, bz), wl[3];
        lg->drop = by - gy; lg->ball[0] = bx; lg->ball[1] = gy; lg->ball[2] = bz; sw->active = 0; lg->has_w = 0; lg->hd = S->h;
        lg->strike = lg->alpha; lg->slope = ld->has_foot ? slope_at(&fr, bx, 0.5 * ld->foot.fb) : 0;
        lg->ref_y = gy;
        to_w(&fr, lg->ball, wl);
        event(S, CM_EV_LAND, i, ld->side, wl[0], gy, wl[2], S->h);
      } else { lg->ball[0] = bx; lg->ball[1] = by; lg->ball[2] = bz; lg->ref_y = ty; }
    } else lg->ref_y = lg->ball[1];
  }
  if (!standing) S->lag = 0;
  if (standing && !any_swing(S)) {
    /* standing still (or turning on the spot): bring the worst-placed foot back under the body */
    int worst = -1;
    double worst_d = 0.09 * L, offs[CM_MAX_LEGS], most = 0;
    const double *grp = ch->gait.has_run ? ch->gait.run.phases : ch->gait.walk.phases;
    for (i = 0; i < n; i++) {
      const double *bl = S->leg[i].ball;
      double rs[2], off;
      rest_of(ch, i, stK, rs);
      off = sqrt(pow(bl[0] - (S->x + rs[0]), 2) + pow(bl[2] - rs[1], 2)) + 0.2 * L * fabs(cm_wrap_pi(S->h - S->leg[i].hd));
      offs[i] = off;
      if (i == 0 || off > most) most = off;
      if (off > worst_d) { worst_d = off; worst = i; }
    }
    S->lag = most / L;
    for (i = 0; worst >= 0 && i < n; i++) {
      /* legs that move together in the gait step together here too (the spider's tripods) */
      if (i != worst && (offs[i] < 0.045 * L || fabs(cm_wrap_pi(TAU * (grp[i] - grp[worst]))) > 0.1)) continue;
      swing_start(&S->leg[i], 1, 1 / ((0.17 - 0.05 * cm_clamp(mvs / (0.5 * mv_max), 0, 1)) * gp.Tn), 0, 0, 0, 1);
    }
  }

  /* body height follows the feet, softened by a spring */
  for (i = 0; i < n; i++) { mean_y += S->leg[i].ref_y; mx += ch->leg[i].rest[0]; }
  mean_y /= n; mx /= n;
  cm_spring_step(&S->g_ref, mean_y, 27 / Tn0, 1, dt);
  for (i = 0; i < n; i++) { double rx = ch->leg[i].rest[0] - mx; sxx += rx * rx; sxy += rx * (S->leg[i].ref_y - mean_y); }
  pitch_t = sxx > 1e-6 ? cm_clamp(atan(sxy / sxx), -0.4, 0.4) : 0;
  if (air && J->pounce) pitch_t = cm_clamp(0.8 * atan2(J->vy, fmax(S->v, 0.5)), -0.45, 0.45);      /* nose follows the arc */
  cm_spring_step(&S->pitch, pitch_t, 20 / Tn0, 1, dt);
  pitch = S->pitch.x;
  if (ch->has_beast && gp.gal > 1e-3) {
    /* gallop: the back stretches out as the hind legs drive and bunches up in the air */
    flex = -ch->beast_flex * gp.gal * cos(TAU * (S->phase - 0.42));
    pitch += ch->beast_rock * gp.gal * cos(TAU * (S->phase - 0.10));
  }
  cp = cos(pitch); sn = sin(pitch);

  h = ch->root_height * (1 - ch->crouch_drop * S->crouch) * (1 - ch->run_drop * gp.run);
  phi_mid = duty / 2 - gp.phases[0];
  c = cos(2 * TAU * (S->phase - phi_mid));
  c = (c < 0 ? -1 : 1) * pow(fabs(c), 1 - 0.6 * st->snap);
  bob = st->bounce * ch->bob * gp.moving * ((1 - gp.run) * gp.Aw - gp.run * gp.Ar) * c;
  if (gp.gal > 1e-3) bob = cm_lerp(bob, st->bounce * ch->bob * 0.075 * L * cos(TAU * (S->phase - 0.95)), gp.gal);   /* one rise and fall a stride */
  sway = 0.02 * L * ch->sway * (1 - gp.run) * gp.moving * cos(TAU * (S->phase - phi_mid)) * ch->leg[0].side;
  /* idle: slow weight shifts; the planted feet stay put, so the knees and hips do the work */
  idle = (1 - gp.moving) * (hasJ ? 0 : 1); P = 2.1 * TAU * sqrt(L / G);
  ix = 0.012 * L * idle * cm_idle_noise(S->t, P, 1.0) - S->act_back; iy = -0.008 * L * idle * (1 + cm_idle_noise(S->t, P, 3.0));
  sway += 0.03 * L * idle * cm_idle_noise(S->t, P, 2.0);
  /* lean into a turn, from the feet up, by the angle that balances the sideways pull */
  cm_spring_step(&S->bank, cm_clamp(atan(S->v * S->om / G) * st->lean, -0.4, 0.4), 30 / Tn0, 1, dt);
  cm_spring_step(&S->side, 0, 26 / Tn0, 0.7, dt);
  bank_t = tan(S->bank.x); sway0 = sway + S->side.x;
  sway = sway0 + bank_t * h;
  if (hasJ && J->stage == CM_JUMP_PREP) cm_spring_step(&S->hop, -0.22 * h, 30 / Tn0, 1, dt);
  else if (hasJ && J->stage == CM_JUMP_PUSH) { S->hop.v += J->acc * dt; S->hop.x += S->hop.v * dt; }
  else if (!air) {
    if (hasJ && J->landed) { J->landed = 0; S->hop.x = J->y - (S->g_ref.x + h + bob); S->hop.v = J->vy; }
    cm_spring_step(&S->hop, 0, 21 / Tn0, 0.75, dt);
    if (hasJ && J->stage == CM_JUMP_LAND && J->t > 0.3 * Tn0 && fabs(S->hop.x) < 0.01 * L) J->stage = CM_JUMP_NONE;
  } else { S->hop.x = 0; S->hop.v = 0; }
  S->hop.x = fmax(S->hop.x, -0.45 * h);
  y0 = air ? J->y : S->g_ref.x + h + bob + iy + S->hop.x;

  for (i = 0; i < n; i++) {
    cm_leg_state *lg = &S->leg[i];
    const cm_leg_def *ld = &ch->leg[i];
    const double *at = ld->attach;
    double cpl = cp, snl = sn, raw, *hip = hips[i], *ball = balls[i], *ankle = ankles[i];
    if (flex != 0) { double fa = pitch + (at[0] < 0 ? flex : -flex); cpl = cos(fa); snl = sin(fa); }     /* each end of a bending spine carries its own legs */
    hip[0] = S->x + ix + at[0] * cpl - at[1] * snl; hip[1] = y0 + at[0] * snl + at[1] * cpl; hip[2] = at[2] + sway;
    ball[0] = lg->ball[0]; ball[1] = lg->ball[1] + lg->drop; ball[2] = lg->ball[2];
    ankle[0] = ball[0]; ankle[1] = ball[1]; ankle[2] = ball[2];
    if (ld->has_foot) {
      const cm_foot *F = &ld->foot;
      double al, rot, ca, sa, b2[3];
      if (!lg->swing.active) {
        double behind;
        lg->strike *= exp(-dt / (0.035 * gp.Tn));
        behind = (hip[0] - ball[0]) / L;
        lg->alpha = lg->strike + F->heel_lift * cm_smooth(0.2, 0.62, behind) * (0.4 + 0.6 * gp.moving);
      }
      al = lg->alpha; rot = al - (lg->swing.active ? 0 : lg->slope);
      ca = cos(rot); sa = sin(rot);
      b2[0] = ball[0]; b2[1] = ball[1] + fmax(0, (F->fb + F->hb) * sin(-al)); b2[2] = ball[2];     /* toes up: pivot on the heel */
      ankle[0] = b2[0] - F->fb * ca + F->ah * sa; ankle[1] = b2[1] + F->fb * sa + F->ah * ca; ankle[2] = b2[2];
      heels[i][0] = b2[0] - (F->fb + F->hb) * ca; heels[i][1] = b2[1] + (F->fb + F->hb) * sa; heels[i][2] = b2[2];
      if (rot > 0) { toes[i][0] = b2[0] + F->toe; toes[i][1] = b2[1]; } else { toes[i][0] = b2[0] + F->toe * ca; toes[i][1] = b2[1] - F->toe * sa; }
      toes[i][2] = b2[2];
      ball[0] = b2[0]; ball[1] = b2[1]; ball[2] = b2[2];
    }
    if (!lg->swing.active) {
      double l_max = 0.985 * (ld->upper + ld->lower);
      double dh2 = pow(ankle[0] - hip[0], 2) + pow(ankle[2] - hip[2], 2);
      double top = ankle[1] + sqrt(fmax(l_max * l_max - dh2, 0));
      lg->over = hip[1] - top; lg->behind = hip[0] - ankle[0];
      need = fmax(need, lg->over);
    } else lg->over = 0;
    raw = cm_clamp((lg->ball[0] - hip[0]) / (0.5 * stance_travel + 0.08 * L), -1, 1);
    lg->fwd += (raw - lg->fwd) * cm_decay(40 / Tn0, dt);
  }
  /* a trailing foot that has run out of reach steps early, as long as enough other feet are down */
  if (!standing) {
    int down = 0, least = (n >> 1) - 1;
    if (least < 1) least = 1;
    for (i = 0; i < n; i++) if (!S->leg[i].swing.active) down++;
    for (i = 0; i < n; i++) {
      cm_leg_state *lg = &S->leg[i];
      if (!lg->swing.active && lg->over > 0.03 * L && lg->behind > 0 && down - 1 >= least && lg->psi < duty - 0.02) {
        if (lg->psi > duty - 0.2) swing_start(lg, 0, 0, lg->psi, 0, 1, 1);     /* close to its normal lift-off: start the real step a little early */
        else swing_start(lg, 1, 1 / fmax(0.7 * (1 - duty) * period, 0.08 * gp.Tn), 0, 0, 0, 1);   /* far out of step: one quick corrective step */
        down--;
      }
    }
  }
  /* if a planted leg still cannot reach, the body sinks instead of the foot sliding */
  need = fmin(need, 0.4 * h);
  S->reach_drop += (need - S->reach_drop) * (need > S->reach_drop ? cm_decay(50, dt) : cm_decay(1 / (0.08 * gp.Tn), dt));
  S->y = y0 - S->reach_drop;

  /* backpack / tail: a loose spring dragged along by the body's vertical motion */
  vy = (S->y - S->last_y) / dt; S->last_y = S->y;
  S->pack.v -= (vy - S->pack_vy) * 0.6; S->pack_vy = vy;
  cm_spring_step(&S->pack, 0, 60 / Tn0, 0.35, dt);

  if (out) {
    double root[3];
    out->legs = n;
    for (i = 0; i < n; i++) {
      const cm_leg_state *lg = &S->leg[i];
      const cm_leg_def *ld = &ch->leg[i];
      cm_leg_pose *o = &out->leg[i];
      double hip[3], knee[3], end[3];
      hip[0] = hips[i][0]; hip[1] = hips[i][1] - S->reach_drop; hip[2] = hips[i][2];
      cm_ik2(hip, ankles[i], ld->upper, ld->lower, ld->pole, knee, end);
      memset(o, 0, sizeof *o);
      to_w(&fr, hip, o->hip); to_w(&fr, knee, o->knee); to_w(&fr, end, o->ankle); to_w(&fr, balls[i], o->ball);
      o->has_foot = ld->has_foot; o->side = ld->side; o->planted = !lg->swing.active;
      if (ld->has_foot) { to_w(&fr, heels[i], o->heel); to_w(&fr, toes[i], o->toe); }
      if (lg->swing.active) {
        double tg[3];
        tg[0] = lg->swing.tx; tg[1] = lg->swing.ty; tg[2] = lg->swing.has_tz ? lg->swing.tz : ld->rest[1];
        to_w(&fr, tg, o->target);
      }
    }
    root[0] = S->x + ix; root[1] = S->y; root[2] = sway;
    to_w(&fr, root, out->root);
    out->pitch = pitch; out->heading = S->h; out->crouch = S->crouch;
    out->gait = air ? CM_GAIT_JUMP : standing || S->v < 0.02 ? CM_GAIT_STANDING : gp.gal > 0.5 ? CM_GAIT_GALLOP
      : gp.run > 0.5 ? (ch->kind == CM_QUAD && n > 2 ? CM_GAIT_TROT : CM_GAIT_RUN) : CM_GAIT_WALK;
    out->Fr = gp.Fr; out->stride = gp.stride; out->period = period; out->duty = duty; out->run = gp.run; out->v = S->v; out->turn = S->om;
  }
  for (i = 0; i < n; i++) {
    cm_leg_state *lg = &S->leg[i];
    if (!lg->swing.active && !lg->has_w) { to_w(&fr, lg->ball, lg->w); lg->has_w = 1; }
  }
  /* The one thing the action layer (stage 3) feeds back into the ground step when nothing is being done:
     a mantis rocks like a leaf in the wind while it stands. */
  if (ch->arthro_rock != 0) S->act_back = standing ? ch->arthro_rock * sin(TAU * S->t / 1.4) : 0;
}
