// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
/* Two characters in a fistfight. This is game code, not part of the motion core: it only sets the
   core's inputs (heading, move, guard, block, punch, track, hit, die) and reads its events and poses.
   Each fighter keeps its distance, circles, steps in to throw a short combination and steps out again;
   the other one covers up, backs off, or gets hit. Whether a punch lands is decided from where the fist
   actually is at full reach, so a late step back makes it miss. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GaitFight = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function rng(seed) {                                   // small seeded generator, so a fight can be replayed
    var s = seed >>> 0;
    return function () { s = (s + 0x6D2B79F5) >>> 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function dist(a, b) { return Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2) + Math.pow((a[2] || 0) - (b[2] || 0), 2)); }
  function segDist(p, a, b) {
    var ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    var t = clamp((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1), 0, 1);
    return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
  }

  var COMBOS = [['jab'], ['jab'], ['jab', 'cross'], ['jab', 'cross'], ['jab', 'jab', 'cross'], ['cross'], ['jab', 'cross', 'hook'], ['hook', 'cross'], ['jab', 'hook']];
  var POWER = { jab: 0.7, cross: 1.5, hook: 1.3 };
  // how close the two must be (hip to hip) before each punch is worth throwing
  var REACH = { jab: 0.84, cross: 0.82, hook: 0.67 };

  /* o: { M (the motion core), chars: [a, b], env, style, seed, gap, health, temper: [a, b] }
     temper 0..1: how eager each fighter is (shorter waits between attacks, fewer blocks). */
  function create(o) {
    var M = o.M, gap = o.gap || 1.7, r = rng(o.seed || 1), F = { M: M, env: o.env, style: o.style, t: 0, rand: r, log: [], fighters: [], flip: false, health: o.health || 100 };
    for (var i = 0; i < 2; i++) {
      var ch = o.chars[i], S = M.createState(ch, o.env), k = i === 0 ? -1 : 1;
      M.place(S, ch, o.env, (o.at ? o.at[0] : 0) + k * gap / 2, o.at ? o.at[1] : 0, i === 0 ? 0 : Math.PI);
      F.fighters.push({
        id: i, ch: ch, S: S, inp: { speed: 0, armed: false, guard: true }, hp: F.health, state: 'range', cool: 0.5 + i * 0.7 + r() * 0.8, combo: null, timer: 0,
        circle: r() < 0.5 ? 1 : -1, circleT: 1 + r() * 2, react: null, blockT: 0, backT: 0, stun: 0, downT: 0, temper: o.temper ? o.temper[i] : 0.5,
        hitNext: null, dieNext: null, events: [], stats: { thrown: 0, landed: 0, blocked: 0, missed: 0, knockdowns: 0 }
      });
    }
    return F;
  }

  function think(F, me, op, dt) {
    var M = F.M, S = me.S, O = op.S, r = F.rand, inp = me.inp;
    var dx = O.px - S.px, dz = O.pz - S.pz, d = Math.sqrt(dx * dx + dz * dz) || 1e-6, ux = dx / d, uz = dz / d;
    inp.speed = 0; inp.guard = true; inp.armed = false; inp.punch = null; inp.track = null; inp.block = false; inp.move = null;
    inp.hit = me.hitNext; inp.die = me.dieNext; me.hitNext = null; me.dieNext = null;
    if (S.mode !== 'ground') {
      // knocked down: lie there for a while, then get up
      me.downT += dt;
      if (me.downT > 2.6 && (!S.rag || S.rag.asleep || me.downT > 4.5)) { M.stand(S, me.ch, F.env); me.hp = Math.round(F.health * 0.6); me.state = 'range'; me.cool = 1.2; me.stun = 0.5; me.downT = 0; me.events.push({ type: 'getup' }); }
      return;
    }
    inp.heading = Math.atan2(dz, dx);
    me.cool -= dt; me.stun -= dt; me.blockT -= dt; me.backT -= dt; me.circleT -= dt; me.timer += dt;
    if (me.circleT <= 0) { me.circle = -me.circle; me.circleT = 1 + r() * 2.5; }
    var opDown = O.mode !== 'ground', want = 1.12, radial, tang = 0.22 * me.circle;

    // defence: notice a punch as it starts, and after a short delay cover up or step back (or fail to)
    var oa = O.act && O.act.name === 'punch' ? O.act : null;
    if (oa && me.react !== oa && d < 1.15) {
      me.react = oa;
      var roll = r(), pBlock = 0.50 - 0.2 * me.temper, pBack = 0.22;
      if (me.stun > 0) roll = 1;                                           // still dazed: takes it
      if (roll < pBlock) { me.blockT = 0.34 + 0.1 * r(); me.cool = r() < 0.35 ? 0.2 : Math.max(me.cool, 0.4 + 0.5 * r()); }      // cover up; sometimes counter straight after
      else if (roll < pBlock + pBack) { me.backT = 0.30; me.cool = Math.max(me.cool, 0.45 + 0.5 * r()); }
      else me.cool = Math.max(me.cool, 0.3 + 0.4 * r());
    }
    if (me.blockT > 0) inp.block = true;

    if (opDown) { me.state = 'range'; me.combo = null; want = 1.45; tang = 0; }
    else if (me.state === 'range') {
      // seeing the other one come in, a fighter often waits for it and answers afterwards
      if (op.state === 'attack' && me.saw !== op.combo) { me.saw = op.combo; if (r() < 0.6) me.cool = Math.max(me.cool, 0.45 + 0.6 * r()); }
      if (me.cool <= 0 && me.stun <= 0 && !S.act) { me.state = 'attack'; me.combo = COMBOS[(r() * COMBOS.length) | 0].slice(); me.timer = 0; }
    }
    if (me.state === 'attack') {
      var next = me.combo[0];
      want = next ? REACH[next] - 0.10 : 1.12; tang *= 0.3;
      var busy = S.act && S.act.name === 'punch' && S.act.t < 0.7 * S.act.dur;
      if (next && !busy && S.guard.x > 0.6 && d < REACH[next] && me.stun <= 0) {
        var body = r() < 0.3, P = O.pose, tgt = body ? [P.chest[0], P.chest[1] - 0.16, P.chest[2]] : P.head.slice();
        inp.punch = { kind: next, target: tgt }; me.aimBody = body; me.combo.shift(); me.stats.thrown++;
      }
      if ((!me.combo.length && !busy && !inp.punch) || me.timer > 2.6 || me.stun > 0) { me.state = 'range'; me.cool = (0.45 + 1.7 * r()) * (1.3 - 0.6 * me.temper); me.combo = null; }
    }
    // a punch on its way keeps following the target for the first part of its travel
    if (S.act && S.act.name === 'punch') { var Q = O.pose; inp.track = me.aimBody ? [Q.chest[0], Q.chest[1] - 0.16, Q.chest[2]] : Q.head.slice(); }
    if (me.backT > 0) want = Math.max(want, 1.15);
    radial = clamp((d - want) * 4.5, -0.95, 0.95);
    if (d < 0.52) radial = -0.95;                                          // never stand inside each other
    inp.move = [ux * radial - uz * tang, uz * radial + ux * tang];
  }

  // what a punch at full reach did: the fist has to be at the head or the body, and not on the guard
  function resolve(F, me, op, e) {
    var P = op.S.pose, O = op.S;
    if (O.mode !== 'ground') { me.stats.missed++; return; }
    var head = dist(e.pos, P.head) < 0.19, body = !head && segDist(e.pos, [P.root[0], P.root[1] + 0.12, P.root[2]], P.chest) < 0.21;
    if (!head && !body) { me.stats.missed++; F.log.push({ t: F.t, type: 'miss', by: me.id, kind: e.kind, pos: e.pos }); return; }
    var pw = POWER[e.kind], hx = e.dir[0], hz = e.dir[2], hl = Math.sqrt(hx * hx + hz * hz) || 1;
    // a hook comes round the side: most of its push is sideways, the rest away from the puncher
    var ax = op.S.px - me.S.px, az = op.S.pz - me.S.pz, al = Math.sqrt(ax * ax + az * az) || 1;
    hx = 0.6 * hx / hl + 0.4 * ax / al; hz = 0.6 * hz / hl + 0.4 * az / al;
    if (O.block.x > 0.5) {
      me.stats.blocked++; op.hitNext = { impulse: [0.3 * pw * hx, 0, 0.3 * pw * hz] };
      F.log.push({ t: F.t, type: 'block', by: me.id, kind: e.kind, pos: e.pos }); return;
    }
    me.stats.landed++;
    op.hp -= pw * (head ? 13 : 8); op.stun = 0.22 + 0.12 * pw;
    F.log.push({ t: F.t, type: 'hit', by: me.id, kind: e.kind, where: head ? 'head' : 'body', pos: e.pos, hp: Math.max(0, Math.round(op.hp)) });
    if (op.hp <= 0) {
      op.dieNext = { impulse: [2.3 * hx, 0.9, 2.3 * hz] }; op.downT = 0; me.stats.knockdowns++;
      F.log.push({ t: F.t, type: 'down', by: me.id, kind: e.kind, pos: e.pos });
    } else op.hitNext = { impulse: [0.95 * pw * hx, 0, 0.95 * pw * hz] };
  }

  function step(F, dt) {
    var M = F.M, a = F.flip ? 1 : 0, i, k;
    F.flip = !F.flip; F.t += dt;
    for (k = 0; k < 2; k++) {
      i = (a + k) % 2;
      var me = F.fighters[i], op = F.fighters[1 - i];
      if (!op.S.pose) M.step(op.S, op.ch, { speed: 0, guard: true }, F.style, F.env, 1e-4);
      think(F, me, op, dt);
      M.step(me.S, me.ch, me.inp, F.style, F.env, dt);
      for (var n = 0; n < me.S.events.length; n++) {
        var e = me.S.events[n];
        if (e.type === 'punch') resolve(F, me, op, e);
        me.events.push(e);
      }
      me.S.events.length = 0;
    }
  }

  return { create: create, step: step, COMBOS: COMBOS, POWER: POWER, REACH: REACH };
});
