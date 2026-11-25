// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
// The hyena: gaits, tail, bite and pounce, headless.
var M = require('../core.js');
var st = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 }, DT = 1 / 120, ch = M.CHARACTERS[process.argv[2] || 'hyena'];
function nan(o) { if (typeof o === 'number') return !isFinite(o); if (o && typeof o === 'object') for (var k in o) if (nan(o[k])) return true; return false; }
function d(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0)); }
function mk(terrain) { var env = { terrain: terrain || function () { return 0; } }, S = M.createState(ch, env); return { S: S, env: env, inp: { speed: 0 }, ev: [], bad: false,
  step: function (dt) { M.step(this.S, ch, this.inp, st, this.env, dt || DT); if (nan(this.S.pose)) this.bad = true; var o = this; this.S.events.forEach(function (e) { e.t = o.S.t; o.ev.push(e); }); this.S.events.length = 0; },
  run: function (sec, each, dt) { for (var n = Math.round(sec / (dt || DT)), i = 0; i < n; i++) { this.step(dt); if (each) each(); } } }; }
console.log('--- gaits and tail');
[0, 1.2, 2.8, 5, 8, 11].forEach(function (v) {
  [120, 30].forEach(function (hz) {
    var o = mk(), S = o.S, tipMax = 0, segErr = 0, low = 9, high = 0, flexMin = 9, flexMax = -9, tipY = [9, -9], prevTip = null, air = 0, n = 0, dt = 1 / hz;
    o.inp.speed = v; o.run(6, null, dt);
    o.run(3, function () {
      var tp = S.pose.tailPts, k; n++;
      for (k = 1; k < tp.length; k++) segErr = Math.max(segErr, Math.abs(d(tp[k], tp[k - 1]) - ch.tail.seg));
      var tip = tp[tp.length - 1], rel = [tip[0] - S.px, tip[1], tip[2] - S.pz];
      if (prevTip) tipMax = Math.max(tipMax, d(rel, prevTip) / dt); prevTip = rel;
      tipY[0] = Math.min(tipY[0], tip[1]); tipY[1] = Math.max(tipY[1], tip[1]);
      low = Math.min(low, S.pose.root[1]); high = Math.max(high, S.pose.root[1]); flexMin = Math.min(flexMin, S.pose.flex); flexMax = Math.max(flexMax, S.pose.flex);
      if (S.legs.every(function (l) { return l.swing; })) air++;
    }, dt);
    console.log((v + ' m/s').padEnd(9), (hz + ' Hz').padEnd(7), S.stats.gait.padEnd(9), 'Fr', S.stats.Fr.toFixed(2).padStart(5), '| stride', S.stats.stride.toFixed(2), 'm,', Math.round(60 / S.stats.period), 'strides/min, duty', S.stats.duty.toFixed(2), '| all feet off', Math.round(100 * air / n) + '%',
      '| hips', low.toFixed(2) + '..' + high.toFixed(2), '| spine', (flexMin * 57.3).toFixed(0) + '..' + (flexMax * 57.3).toFixed(0) + '°', '| tail tip height', tipY[0].toFixed(2) + '..' + tipY[1].toFixed(2), 'fastest', tipMax.toFixed(1), 'm/s, link error', (segErr * 1000).toFixed(2), 'mm | nan', o.bad);
  });
});
console.log('--- tail in a turn, a stop and a blow');
(function () {
  var o = mk(), S = o.S; o.inp.speed = 5; o.run(4);
  var side = 0; o.inp.steer = 1; o.run(1.5, function () { var tp = S.pose.tailPts, tip = tp[tp.length - 1], b = tp[0]; var lat = -(tip[0] - b[0]) * Math.sin(S.h) + (tip[2] - b[2]) * Math.cos(S.h); if (Math.abs(lat) > Math.abs(side)) side = lat; });
  console.log('steering right at 5 m/s: tail tip swings', (Math.abs(side) * 100).toFixed(0), 'cm to the', side < 0 ? 'left (outside of the turn)' : 'right (it trails inside the turn, as a trailer does)');
  o.inp.steer = 0; o.inp.speed = 0; var fwd = -9; o.run(1.2, function () { var tp = S.pose.tailPts, tip = tp[tp.length - 1], b = tp[0]; fwd = Math.max(fwd, (tip[0] - b[0]) * Math.cos(S.h) + (tip[2] - b[2]) * Math.sin(S.h)); });
  console.log('hard stop: tail tip comes forward to', (fwd * 100).toFixed(0), 'cm relative to its root (hangs at', ((S.pose.tailPts[4][0] - S.pose.tailPts[0][0]) * Math.cos(S.h) * 100 + (S.pose.tailPts[4][2] - S.pose.tailPts[0][2]) * Math.sin(S.h) * 100).toFixed(0), 'cm at rest)');
  o.run(2); var y0 = S.pose.tailPts[4][1]; o.inp.hit = { impulse: [-1.6 * Math.cos(S.h), 0, -1.6 * Math.sin(S.h)] }; o.step(); o.inp.hit = null; var lowT = 9; o.run(0.6, function () { lowT = Math.min(lowT, S.pose.tailPts[4][1]); });
  console.log('blow from the front: tail tip drops from', y0.toFixed(2), 'to', lowT.toFixed(2), 'm | nan', o.bad);
})();
console.log('--- bite');
[[1.05, 0.75, 0], [1.0, 0.35, 0], [0.95, 1.0, 0.2], [1.6, 0.7, 0], [0.9, 0.7, -0.35]].forEach(function (tg) {
  var o = mk(), S = o.S; o.inp.aim = tg; o.run(1.5);
  var rest = S.pose.head.slice(); o.inp.bite = { target: tg }; o.step(); o.inp.bite = null; var open = 0, t0 = S.t; o.run(0.7, function () { open = Math.max(open, S.pose.jaw); });
  var e = o.ev.filter(function (x) { return x.type === 'bite'; })[0];
  console.log('target', tg.join(','), '| snap after', e ? (e.t - t0).toFixed(2) + ' s, muzzle ' + (e.miss * 100).toFixed(1) + ' cm from it' : 'NONE', '| jaws opened', (open * 57.3).toFixed(0) + '° | head back to within', (d(S.pose.head, rest) * 100).toFixed(1), 'cm | nan', o.bad);
});
console.log('--- pounce');
[[null, 0], [[2.0, 0, 0], 0], [[3.0, 0, 0], 0], [[4.5, 0, 0], 0], [[3.0, 0, 0], 4]].forEach(function (c) {
  var o = mk(), S = o.S; o.inp.speed = c[1]; o.run(2);
  var x0 = S.px, tg = c[0] ? [x0 + c[0][0], 0, 0] : null, peak = 0, maxPitch = 0, minPitch = 0, slide = 0, prev = null, tAir = 0;
  o.inp.pounce = { target: tg }; o.step(); o.inp.pounce = null; o.inp.speed = 0;
  o.run(2.5, function () { peak = Math.max(peak, S.pose.root[1]); maxPitch = Math.max(maxPitch, S.pitch.x); minPitch = Math.min(minPitch, S.pitch.x); if (S.jump && S.jump.stage === 'air') tAir += DT;
    var cur = S.legs.map(function (l, i) { return l.swing ? null : [S.pose.legs[i].ball[0], S.pose.legs[i].ball[2]]; }); if (prev) cur.forEach(function (q, i) { if (q && prev[i]) slide = Math.max(slide, Math.hypot(q[0] - prev[i][0], q[1] - prev[i][1])); }); prev = cur; });
  var e = o.ev.filter(function (x) { return x.type === 'pounce'; })[0];
  console.log((c[0] ? 'target ' + c[0][0] + ' m' : 'no target').padEnd(13), 'from', c[1], 'm/s | in the air', tAir.toFixed(2), 's, hips up to', peak.toFixed(2), 'm, nose', (maxPitch * 57.3).toFixed(0) + '° up then', (-minPitch * 57.3).toFixed(0) + '° down | jaws land', e ? (e.pos[0] - x0).toFixed(2) + ' m out' + (tg ? ' (' + ((e.pos[0] - tg[0]) * 100).toFixed(0) + ' cm past the target)' : '') : 'NO EVENT',
    '| stops', (S.px - x0).toFixed(2), 'm from the start, speed', S.v.toFixed(2), '| planted feet slide', (slide * 1000).toFixed(2), 'mm | nan', o.bad);
});
