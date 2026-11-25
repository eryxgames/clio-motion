// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
// Throw, crate and fighting moves: one character, headless.
var M = require('../core.js');
var st = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 }, DT = 1 / 120;
function nan(o) { if (typeof o === 'number') return !isFinite(o); if (o && typeof o === 'object') for (var k in o) if (nan(o[k])) return true; return false; }
function d(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0)); }
function mk(kit, armed) {
  var ch = M.CHARACTERS.soldier, env = { terrain: function () { return 0; } }, S = M.createState(ch, env);
  var inp = { speed: 0, armed: armed, kit: kit };
  var o = { ch: ch, env: env, S: S, inp: inp, bad: false, ev: [], maxHand: 0, prevH: null, minY: 9,
    step: function () {
      M.step(S, ch, inp, st, env, DT); if (nan(S.pose)) o.bad = true;
      S.events.forEach(function (e) { e.t = S.t; o.ev.push(e); }); S.events.length = 0;
      var h = S.pose.arms.map(function (a) { return a.hand; });
      if (o.prevH) for (var i = 0; i < 2; i++) o.maxHand = Math.max(o.maxHand, d(h[i], o.prevH[i]));
      o.prevH = h; o.minY = Math.min(o.minY, S.pose.root[1]);
    },
    run: function (sec, each) { for (var n = Math.round(sec / DT), i = 0; i < n; i++) { o.step(); if (each) each(); } } };
  o.run(kit && kit !== 'rifle' ? 2.5 : 1.5);
  return o;
}
console.log('--- throw');
[['rifle', true], ['pistols', true], ['rifle', false]].forEach(function (c) {
  [[8, 0, 0], [14, 0, 0], [5, 1.5, 3], [2, 0, 0]].forEach(function (tg) {
    var o = mk(c[0], c[1]); o.maxHand = 0;
    o.inp.throw = { target: tg }; o.step(); o.inp.throw = null;
    var gripMax = 0;
    o.run(1.6, function () { });
    var ev = o.ev.filter(function (e) { return e.type === 'throw'; })[0], land = null;
    if (ev) { var p = ev.pos.slice(), v = ev.vel.slice(); for (var k = 0; k < 4000 && p[1] > tg[1]  || v[1] > 0; k++) { v[1] -= M.G * 0.002; p[0] += v[0] * 0.002; p[1] += v[1] * 0.002; p[2] += v[2] * 0.002; if (k > 4000) break; } land = p; }
    var w = o.S.pose.props[0], back = c[1] ? d(o.S.pose.arms[0].hand, w.grip) : -1;
    console.log((c[0] + (c[1] ? ' ready ' : ' stowed')).padEnd(15), 'target', tg.join(','), '| nan', o.bad, '| released', ev ? 'at ' + (ev.t - 1.5 - (c[0] === 'pistols' ? 1 : 0)).toFixed(2) + ' s, height ' + ev.pos[1].toFixed(2) + ' m, speed ' + Math.hypot.apply(null, ev.vel).toFixed(1) + ' m/s' : 'NO',
      '| lands', land ? d(land, tg).toFixed(2) + ' m off' : '-', '| hand back on grip', back < 0 ? 'n/a' : (back * 100).toFixed(1) + ' cm', '| fastest hand', (o.maxHand / DT).toFixed(1), 'm/s | act', o.S.act ? o.S.act.name : 'none');
  });
});
console.log('--- crate');
[[null, 'on the ground'], [[0.20 + 0.22, 0.75 + 0.18, 0], 'on a table 0.75 m'], [[0.48, 0.18, 0.10], 'off centre']].forEach(function (c) {
  var o = mk('rifle', true), S = o.S, worstHandle = 0, jump = 0, prevC = null, worstCarry = 0;
  o.inp.pickup = c[0] ? { at: c[0] } : {}; o.step(); o.inp.pickup = null;
  var place = S.carry.at.slice(), lowest = 9, deepest = 0;
  function watch() {
    var cr = S.pose.carry; if (!cr) return;
    if (prevC) jump = Math.max(jump, d(cr.c, prevC)); prevC = cr.c;
    lowest = Math.min(lowest, S.pose.root[1]); deepest = Math.max(deepest, S.crouch);
    if (cr.held) for (var i = 0; i < 2; i++) {
      var sd = i === 0 ? 1 : -1, h = [0, 1, 2].map(function (k) { return cr.c[k] + cr.u[k] * 0.25 * cr.size.h + cr.side[k] * sd * (cr.size.w / 2 + 0.015); });
      worstHandle = Math.max(worstHandle, d(h, S.pose.arms[i].hand));
    }
  }
  o.run(2.0, watch);
  var up = S.pose.carry.c.slice(), afterPick = S.act ? S.act.name : 'none';
  o.inp.speed = 3.0; o.run(4, watch); var vWalk = S.v, gait = S.stats.gait; worstCarry = worstHandle;
  o.inp.speed = 0; o.run(1.2, watch);
  o.inp.putdown = true; var tries = 0; while (!(S.act && S.act.name === 'putdown') && tries++ < 600) { o.step(); watch(); } o.inp.putdown = false;
  o.run(2.0, watch);
  var pd = o.ev.filter(function (e) { return e.type === 'putdown'; })[0];
  console.log(c[1].padEnd(18), '| nan', o.bad, '| events', o.ev.filter(function (e) { return e.type !== 'land'; }).map(function (e) { return e.type; }).join(','), '| squat to', lowest.toFixed(2), 'm (crouch ' + deepest.toFixed(2) + ')',
    '| carried at', (up[1] - S.pose.root[1] + (S.pose.root[1] - 0.89)).toFixed(2), 'm | walk', vWalk.toFixed(2), 'm/s', gait, '| hands off handles at most', (worstHandle * 100).toFixed(1), 'cm | crate moves at most', (jump * 1000).toFixed(1), 'mm/step',
    '| set down', pd ? (pd.pos[0] - S.px).toFixed(2) + ' m ahead at height ' + pd.pos[1].toFixed(2) : 'NO', '| carry', S.carry ? 'still' : 'none', '| weapon back', (d(S.pose.arms[0].hand, S.pose.props[0].grip) * 100).toFixed(1) + ' cm');
});
console.log('--- fight: stance, punches, footwork');
(function () {
  var o = mk('rifle', true), S = o.S;
  o.inp.guard = true; o.run(1.5);
  var p = S.pose, fx = p.legs.map(function (l) { return (l.ball[0] - S.px).toFixed(2) + '/' + (l.ball[2] - S.pz).toFixed(2); });
  console.log('stance feet (fwd/right) R', fx[0], 'L', fx[1], '| fists R', p.arms[0].hand.map(function (v, k) { return (v - p.chest[k]).toFixed(2); }).join(','), 'L', p.arms[1].hand.map(function (v, k) { return (v - p.chest[k]).toFixed(2); }).join(','), '| weapon stowed', (1 - S.armed.x).toFixed(2), '| root', p.root[1].toFixed(2));
  ['jab', 'cross', 'hook'].forEach(function (kind) {
    [[0.62, 1.50, 0], [0.70, 1.25, 0.05], [1.2, 1.5, 0]].forEach(function (tg) {
      o.ev.length = 0; o.maxHand = 0;
      o.inp.punch = { kind: kind, target: tg }; o.step(); o.inp.punch = null;
      var t0 = S.t; o.run(0.8);
      var e = o.ev.filter(function (x) { return x.type === 'punch'; })[0];
      console.log(kind.padEnd(6), 'at', tg.join(','), '| contact after', e ? (e.t - t0).toFixed(2) + ' s' : 'NONE', '| fist', e ? (e.miss * 100).toFixed(1) + ' cm from target' : '', '| dir', e ? e.dir.map(function (v) { return v.toFixed(2); }).join(',') : '', '| fastest hand', (o.maxHand / DT).toFixed(1), 'm/s | nan', o.bad, '| back on guard', (d(S.pose.arms[PUNCHHAND(kind)].hand, p0(S, PUNCHHAND(kind))) * 100).toFixed(1), 'cm');
    });
  });
  function PUNCHHAND(k) { return M.PUNCH[k].hand; }
  function p0(S, h) { return S.pose.arms[h].hand; }
  // footwork: drift in each direction; planted feet must not slide
  [[0.6, 0], [-0.6, 0], [0, 0.6], [0.45, -0.45]].forEach(function (mv) {
    var slide = 0, steps = 0, prev = null, x0 = S.px, z0 = S.pz, low = 9, h0 = S.h; o.ev.length = 0;
    o.inp.move = mv;
    o.run(2.0, function () {
      var cur = S.legs.map(function (l, i) { return l.swing ? null : [S.pose.legs[i].ball[0], S.pose.legs[i].ball[2]]; });
      if (prev) cur.forEach(function (c, i) { if (c && prev[i]) slide = Math.max(slide, Math.hypot(c[0] - prev[i][0], c[1] - prev[i][1])); });
      prev = cur; low = Math.min(low, S.pose.root[1]);
    });
    o.inp.move = null;
    steps = o.ev.filter(function (e) { return e.type === 'land'; }).length;
    console.log('drift', mv.join(','), '| moved', (S.px - x0).toFixed(2) + ',' + (S.pz - z0).toFixed(2), 'm in 2 s | steps', steps, '| planted feet slide', (slide * 1000).toFixed(2), 'mm | lowest root', low.toFixed(2), '| heading kept', (S.h - h0).toFixed(3), '| nan', o.bad);
    o.run(0.8);
  });
  o.inp.guard = false; o.run(1.5);
  console.log('guard off: weapon back in hand', (d(S.pose.arms[0].hand, S.pose.props[0].grip) * 100).toFixed(1), 'cm | feet', S.pose.legs.map(function (l) { return (l.ball[0] - S.px).toFixed(2); }).join(' '));
})();
