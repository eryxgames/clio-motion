// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
// The octopus, headless: crawling, grabbing, swimming.
var M = require('../core.js'), ch = M.CHARACTERS.octopus, st = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 };
function nan(o) { if (typeof o === 'number') return !isFinite(o); if (o && typeof o === 'object') for (var k in o) if (nan(o[k])) return true; return false; }
function d(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0)); }
function mk() { var env = { terrain: function (x) { return 0.08 * Math.sin(x / 1.3); } }, S = M.createState(ch, env); return { S: S, env: env, inp: { speed: 0 }, ev: [], bad: false,
  run: function (sec, each, hz) { var dt = 1 / (hz || 120), o = this; for (var n = Math.round(sec / dt), i = 0; i < n; i++) { M.step(S, ch, o.inp, st, env, dt); if (nan(S.pose)) o.bad = true; S.events.forEach(function (e) { e.t = S.t; o.ev.push(e); }); S.events.length = 0; if (each) each(dt); } } }; }
console.log('--- crawling');
[0.4, 0.9, 1.4].forEach(function (v) { var o = mk(), S = o.S, slide = 0, prev = null, down = 8, lo = 9, hi = 0; o.inp.speed = v; o.run(5);
  o.run(4, function () { down = Math.min(down, S.legs.filter(function (l) { return !l.swing; }).length); var h = S.pose.root[1] - o.env.terrain(S.px); lo = Math.min(lo, h); hi = Math.max(hi, h);
    var cur = S.legs.map(function (l, i) { return l.swing ? null : S.pose.legs[i].ball; }); if (prev) cur.forEach(function (q, i) { if (q && prev[i]) slide = Math.max(slide, Math.hypot(q[0] - prev[i][0], q[2] - prev[i][2])); }); prev = cur; });
  console.log((v + ' m/s').padEnd(8), '| stride', S.stats.stride.toFixed(2), 'm | fewest arms down', down, '| body', lo.toFixed(2) + '..' + hi.toFixed(2), 'm over the ground | planted tips slide', (slide * 1000).toFixed(2), 'mm | nan', o.bad); });
[[0.8, 0.5, 0.3], [0.5, 0.9, -0.4], [-0.6, 0.3, 0.5], [1.6, 0.4, 0]].forEach(function (tg) { var o = mk(), S = o.S; o.run(1.5); o.inp.grab = { target: tg }; o.run(1 / 120); o.inp.grab = null; o.run(1.2); var e = o.ev.filter(function (x) { return x.type === 'grab'; })[0];
  console.log('grab at', tg.join(','), '|', e ? 'arm ' + ch.legs[e.arm].name + ', tip ' + (e.miss * 100).toFixed(1) + ' cm from it' : 'NO EVENT', '| nan', o.bad); });
console.log('--- swimming');
[[0, 1.2], [0.8, 1.2], [1.6, 2.0], [3.0, 0.6]].forEach(function (c) { [120, 30].forEach(function (hz) {
  var o = mk(), S = o.S; o.run(1); M.enterSwim(S, ch, o.env); o.inp = { speed: c[0], depth: c[1] }; o.run(8, null, hz);
  var x0 = S.px, vmin = 9, vmax = 0, hLo = 9, hHi = 0, segErr = 0, tipMax = 0, prevTip = null, spreadMin = 9, spreadMax = 0, T = 6;
  o.run(T, function (dt) { vmin = Math.min(vmin, S.v); vmax = Math.max(vmax, S.v); var h = S.y - o.env.terrain(S.px); hLo = Math.min(hLo, h); hHi = Math.max(hHi, h);
    S.pose.arms.forEach(function (a) { for (var k = 1; k < a.length; k++) segErr = Math.max(segErr, Math.abs(d(a[k], a[k - 1]) - ch.octo.arm.seg)); });
    var tips = S.pose.arms.map(function (a) { return a[a.length - 1]; }), sp = 0; tips.forEach(function (p) { tips.forEach(function (q) { sp = Math.max(sp, d(p, q)); }); }); spreadMin = Math.min(spreadMin, sp); spreadMax = Math.max(spreadMax, sp);
    var rel = [tips[0][0] - S.px, tips[0][1] - S.y, tips[0][2] - S.pz]; if (prevTip) tipMax = Math.max(tipMax, d(rel, prevTip) / dt); prevTip = rel; }, hz);
  console.log(('asked ' + c[0] + ' m/s at ' + c[1] + ' m').padEnd(24), (hz + ' Hz').padEnd(7), S.stats.gait.padEnd(6), '| went', ((S.px - x0) / T).toFixed(2), 'm/s on average, between', vmin.toFixed(2), 'and', vmax.toFixed(2), '| height', hLo.toFixed(2) + '..' + hHi.toFixed(2),
    '| arm tips spread', spreadMin.toFixed(2) + '..' + spreadMax.toFixed(2), 'm | fastest tip', tipMax.toFixed(1), 'm/s | link error', (segErr * 1000).toFixed(3), 'mm | nan', o.bad); }); });
(function () { var o = mk(), S = o.S; o.run(1); M.enterSwim(S, ch, o.env); o.inp = { speed: 1.5, depth: 1.2 }; o.run(5); var h0 = S.h; o.inp.steer = 1; o.run(2); var turned = M.wrapPi(S.h - h0); o.inp.steer = 0; var v0 = S.v; o.inp.ink = true; o.run(1 / 120); o.inp.ink = false; var v1 = S.v; o.run(1);
  o.inp = { speed: 0, depth: 0.3 }; o.run(5); var h = S.y - o.env.terrain(S.px); M.leaveSwim(S, ch, o.env); o.run(2);
  console.log('steering for 2 s turns it', (turned * 57.3).toFixed(0) + '° | ink:', o.ev.filter(function (e) { return e.type === 'ink'; }).length, 'puff, speed', v0.toFixed(2), '->', v1.toFixed(2), '| sinks to', h.toFixed(2), 'm, then back on its arms: mode', S.mode + ', body at', (S.y - o.env.terrain(S.px)).toFixed(2), 'm | nan', o.bad); })();
