// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
// Travel in any direction while facing another, and ground that varies both ways. Headless.
var M = require('../core.js'), st = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 }, DT = 1 / 120;
function nan(o) { if (typeof o === 'number') return !isFinite(o); if (o && typeof o === 'object') for (var k in o) if (nan(o[k])) return true; return false; }
function mk(id, terrain) { var ch = M.CHARACTERS[id], env = { terrain: terrain || function () { return 0; } }, S = M.createState(ch, env); return { ch: ch, S: S, env: env, inp: { speed: 0, armed: true }, bad: false, slide: 0, prev: null, low: 9, cross: 9, under: 0,
  run: function (sec, each) { var o = this; for (var n = Math.round(sec / DT), i = 0; i < n; i++) { M.step(S, ch, o.inp, st, env, DT); if (nan(S.pose)) o.bad = true; S.events.length = 0;
    var cur = S.legs.map(function (l, k) { return l.swing ? null : S.pose.legs[k].ball; }); if (o.prev) cur.forEach(function (q, k) { if (q && o.prev[k]) o.slide = Math.max(o.slide, Math.hypot(q[0] - o.prev[k][0], q[2] - o.prev[k][2])); }); o.prev = cur;
    cur.forEach(function (q) { if (q) o.under = Math.max(o.under, env.terrain(q[0], q[2]) - q[1]); });
    o.low = Math.min(o.low, (S.pose.root[1] - env.terrain(S.px, S.pz)) / ch.rootHeight);
    if (ch.legs.length === 2) { var f = M.frameOf(S), a = M.w2l(f, S.pose.legs[0].ball), b = M.w2l(f, S.pose.legs[1].ball); o.cross = Math.min(o.cross, a[2] - b[2]); }
    if (each) each(); } } }; }
console.log('--- each direction at a walk (speed asked: the walking pace)');
['soldier', 'raptor', 'hyena', 'spider', 'scorpion'].forEach(function (id) {
  [0, 45, 90, 135, 180, -90].forEach(function (deg) {
    var o = mk(id), S = o.S, v = Math.sqrt(0.22 * M.G * o.ch.L); o.inp.speed = v; o.inp.dir = deg * Math.PI / 180; o.run(5); o.slide = 0; o.low = 9; o.cross = 9;
    var x0 = S.px, z0 = S.pz; o.run(4); var ex = (S.px - x0) / 4, ez = (S.pz - z0) / 4, sp = Math.hypot(ex, ez);
    console.log(id.padEnd(9), (deg + '°').padStart(5), '| goes', (Math.atan2(ez, ex) * 57.3).toFixed(0).padStart(4) + '° at', sp.toFixed(2), 'm/s (' + Math.round(100 * sp / v) + '% of the pace asked) |', S.stats.gait.padEnd(5), 'stride', S.stats.stride.toFixed(2),
      '| hips no lower than', Math.round(o.low * 100) + '% of standing | planted feet slide', (o.slide * 1000).toFixed(2), 'mm' + (o.ch.legs.length === 2 ? ' | right foot stays ' + (o.cross * 100).toFixed(0) + ' cm or more to the right of the left' : ''), '| nan', o.bad); }); });
console.log('--- changes of direction, soldier');
(function () {
  var o = mk('soldier'), S = o.S; o.inp.speed = 3; o.run(4); var x1 = S.px; o.inp.dir = Math.PI; var tStop = 0, vmin = 9, t = 0; o.run(3, function () { t += DT; if (S.v < vmin) { vmin = S.v; tStop = t; } }); var back = S.px;
  console.log('forwards at 3 m/s, then told to go backwards: slowest', vmin.toFixed(2), 'm/s after', tStop.toFixed(2), 's, then', S.v.toFixed(2), 'm/s backwards | slide', (o.slide * 1000).toFixed(2), 'mm | hips', Math.round(o.low * 100) + '% | nan', o.bad);
  o.inp.dir = 0; o.run(4); console.log('and forwards again:', S.v.toFixed(2), 'm/s, the plain forward code is back in charge:', S.vl === null);
  // circle strafe: face a point, go sideways round it
  var c = [S.px + 4, S.pz], r0, rmin = 99, rmax = 0, ang = 0, pa = Math.atan2(S.pz - c[1], S.px - c[0]); o.slide = 0; o.low = 9; o.inp.dir = Math.PI / 2; o.inp.speed = 2;
  o.run(12, function () { o.inp.heading = Math.atan2(c[1] - S.pz, c[0] - S.px); var r = Math.hypot(S.px - c[0], S.pz - c[1]); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); var a = Math.atan2(S.pz - c[1], S.px - c[0]); ang += M.wrapPi(a - pa); pa = a; });
  console.log('circling a point 4 m away, facing it: went', (Math.abs(ang) * 57.3).toFixed(0) + '° round in 12 s, distance', rmin.toFixed(2) + '..' + rmax.toFixed(2), 'm | slide', (o.slide * 1000).toFixed(2), 'mm | hips', Math.round(o.low * 100) + '% | nan', o.bad);
})();
console.log('--- ground that varies both ways (hills 0.25 m high, about 5 m across)');
['soldier', 'hyena', 'spider', 'raptor'].forEach(function (id) {
  var hills = function (x, z) { return 0.25 * Math.sin(x / 1.6) * Math.cos((z || 0) / 1.3); };
  var o = mk(id, hills), S = o.S, v = Math.sqrt(0.22 * M.G * o.ch.L), hi = [9, -9]; o.inp.speed = v;
  o.run(40, function () { o.inp.steer = Math.sin(S.t / 3.1); o.inp.dir = S.t % 16 > 10 ? Math.PI / 2 : 0; var g = hills(S.px, S.pz); hi[0] = Math.min(hi[0], g); hi[1] = Math.max(hi[1], g); });
  console.log(id.padEnd(9), '| wandered over ground from', hi[0].toFixed(2), 'to', hi[1].toFixed(2), 'm, turning and sidestepping | planted feet sink at most', (o.under * 1000).toFixed(1), 'mm, slide', (o.slide * 1000).toFixed(2), 'mm | hips no lower than', Math.round(o.low * 100) + '% of standing | nan', o.bad); });
