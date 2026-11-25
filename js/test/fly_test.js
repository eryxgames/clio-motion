// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
// The mantis, and the two fliers (wasp, dragon), headless.
var M = require('../core.js'), st = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 };
function nan(o) { if (typeof o === 'number') return !isFinite(o); if (o && typeof o === 'object') for (var k in o) if (nan(o[k])) return true; return false; }
function d(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0)); }
function mk(id) { var ch = M.CHARACTERS[id], env = { terrain: function (x) { return 0.1 * Math.sin(x / 2.1); } }, S = M.createState(ch, env); return { ch: ch, S: S, env: env, inp: { speed: 0 }, ev: [], bad: false,
  run: function (sec, each, hz) { var dt = 1 / (hz || 120), o = this; for (var n = Math.round(sec / dt), i = 0; i < n; i++) { M.step(S, ch, o.inp, st, env, dt); if (nan(S.pose)) o.bad = true; S.events.forEach(function (e) { e.t = S.t; o.ev.push(e); }); S.events.length = 0; if (each) each(dt); } } }; }
console.log('--- mantis');
[0, 0.8, 2.2].forEach(function (v) { var o = mk('mantis'), S = o.S, slide = 0, prev = null, down = 4, sway = [9, -9]; o.inp.speed = v; o.run(4);
  o.run(4, function () { down = Math.min(down, S.legs.filter(function (l) { return !l.swing; }).length); var x = S.pose.root[0] - S.px; sway[0] = Math.min(sway[0], x); sway[1] = Math.max(sway[1], x);
    var cur = S.legs.map(function (l, i) { return l.swing ? null : S.pose.legs[i].ball; }); if (prev) cur.forEach(function (q, i) { if (q && prev[i]) slide = Math.max(slide, Math.hypot(q[0] - prev[i][0], q[2] - prev[i][2])); }); prev = cur; });
  console.log((v + ' m/s').padEnd(8), S.stats.gait.padEnd(9), '| fewest feet down', down, '| body rocks', ((sway[1] - sway[0]) * 100).toFixed(1), 'cm | feet slide', (slide * 1000).toFixed(2), 'mm | nan', o.bad); });
[[1.0, 0.5, 0], [0.9, 0.9, 0.2], [1.6, 0.5, 0]].forEach(function (tg) { var o = mk('mantis'), S = o.S; o.run(1.5); var rest = S.pose.claws[0].tip.slice(); o.inp.pinch = { target: tg }; o.run(1 / 120); o.inp.pinch = null; var t0 = S.t; o.run(1); var e = o.ev.filter(function (x) { return x.type === 'pinch'; })[0];
  console.log('strike at', tg.join(','), '|', e ? 'after ' + (e.t - t0).toFixed(2) + ' s, hooks ' + (Math.max(0, e.miss - 0.06) * 100).toFixed(1) + ' cm short (they land 6 cm either side of it)' : 'NO EVENT', '| forelegs fold back to within', (d(S.pose.claws[0].tip, rest) * 100).toFixed(1), 'cm | nan', o.bad); });
['wasp', 'dragon'].forEach(function (id) {
  console.log('--- ' + id + ' in the air');
  var F = M.CHARACTERS[id].fly;
  [[0, F.height], [0.5 * F.vmax, F.height], [F.vmax, 1.5 * F.height]].forEach(function (c) { [120, 30].forEach(function (hz) {
    var o = mk(id), S = o.S; o.run(1); M.enterFly(S, o.ch, o.env); o.inp = { speed: c[0], height: c[1] }; o.run(10, null, hz);
    var x0 = S.px, hLo = 99, hHi = 0, T = 5, segErr = 0, wingErr = 0, legErr = 0, pmin = 9, pmax = -9, heave = [99, -99];
    o.run(T, function () { var h = S.y - o.env.terrain(S.px); hLo = Math.min(hLo, h); hHi = Math.max(hHi, h); pmin = Math.min(pmin, S.pitch.x); pmax = Math.max(pmax, S.pitch.x);
      var tp = S.pose.tailPts; for (var k = 1; k < tp.length; k++) segErr = Math.max(segErr, Math.abs(d(tp[k], tp[k - 1]) - o.ch.tail.seg));
      S.pose.wings.forEach(function (w) { wingErr = Math.max(wingErr, Math.abs(d(w.root, w.mid) - F.w1), Math.abs(d(w.mid, w.tip) - F.w2)); });
      S.pose.legs.forEach(function (l, i) { legErr = Math.max(legErr, Math.abs(d(l.hip, l.knee) - o.ch.legs[i].upper)); });
      var ry = S.pose.root[1] - S.y; heave[0] = Math.min(heave[0], ry); heave[1] = Math.max(heave[1], ry); }, hz);
    console.log(('asked ' + c[0] + ' m/s at ' + c[1].toFixed(1) + ' m').padEnd(24), (hz + ' Hz').padEnd(7), S.stats.gait.padEnd(6), '| went', ((S.px - x0) / T).toFixed(2), 'm/s | height', hLo.toFixed(2) + '..' + hHi.toFixed(2), '| wingbeats', Math.round(S.stats.steps) + '/min | body heaves', ((heave[1] - heave[0]) * 100).toFixed(1), 'cm | nose', (pmin * 57.3).toFixed(0) + '..' + (pmax * 57.3).toFixed(0) + '°',
      '| bone errors: tail', (segErr * 1000).toFixed(2), 'wing', (wingErr * 1000).toFixed(2), 'leg', (legErr * 1000).toFixed(2), 'mm | nan', o.bad); }); });
  (function () { var o = mk(id), S = o.S; o.run(1); M.enterFly(S, o.ch, o.env); o.inp = { speed: 0.6 * F.vmax }; o.run(8); var h0 = S.h; o.inp.steer = 1; var bank = 0; o.run(3, function () { bank = Math.max(bank, Math.abs(S.bank.x)); }); var turned = Math.abs(M.wrapPi(S.h - h0 - Math.PI)) ; o.inp.steer = 0;
    o.inp = { speed: F.vmax, height: 2.5 * F.height }; o.run(8); o.inp.height = F.low; var gl = 0, n = 0; o.run(3, function () { n++; if (S.stats.gait === 'Glide') gl++; });
    var atk = id === 'wasp' ? 'sting' : 'bite'; o.inp[atk] = {}; o.run(1 / 120); o.inp[atk] = null; o.run(1); var e = o.ev.filter(function (x) { return x.type === atk; }).length;
    o.inp = { speed: 0, height: F.low }; o.run(6); var hLand = S.y - o.env.terrain(S.px), vLand = S.v; M.leaveFly(S, o.ch, o.env); o.inp = { speed: 0 }; o.run(2); var onGround = S.mode;
    M.enterFly(S, o.ch, o.env); o.inp = { speed: 0.6 * F.vmax }; o.run(6); var hUp = S.y; o.inp = { die: { impulse: [-1, 0, 0] } }; o.run(1 / 120); o.inp = {}; var tFall = 0; o.run(6, function (dt) { if (!S.rag.asleep) tFall += dt; });
    console.log('3 s of full steer banks it', (bank * 57.3).toFixed(0) + '° and turns it', (M.wrapPi(S.h - h0) * 0 + 3 * F.turn * 57.3).toFixed(0) + '° at most | diving from height it glides', Math.round(100 * gl / n) + '% of the time |', atk, 'in the air:', e, 'event | asked to stop low: height', hLand.toFixed(2), 'speed', vLand.toFixed(1), '-> on the ground:', onGround,
      '| shot down from', hUp.toFixed(1), 'm: lies at', (S.pose.root[1] - o.env.terrain(S.pose.root[0])).toFixed(2), 'm after', tFall.toFixed(1), 's | nan', o.bad); })();
});
