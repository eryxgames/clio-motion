// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
// Raptor and scorpion, and the tail chain on all three tailed creatures, headless.
var M = require('../core.js');
var st = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 };
function nan(o) { if (typeof o === 'number') return !isFinite(o); if (o && typeof o === 'object') for (var k in o) if (nan(o[k])) return true; return false; }
function d(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0)); }
function mk(id) { var ch = M.CHARACTERS[id], env = { terrain: function () { return 0; } }, S = M.createState(ch, env); return { ch: ch, S: S, env: env, inp: { speed: 0 }, ev: [], bad: false,
  step: function (dt) { M.step(this.S, ch, this.inp, st, env, dt); if (nan(this.S.pose)) this.bad = true; var o = this; this.S.events.forEach(function (e) { e.t = o.S.t; o.ev.push(e); }); this.S.events.length = 0; },
  run: function (sec, each, hz) { var dt = 1 / (hz || 120); for (var n = Math.round(sec / dt), i = 0; i < n; i++) { this.step(dt); if (each) each(dt); } } }; }
function tipRel(S) { var f = M.frameOf(S), tp = S.pose.tailPts, a = M.w2l(f, tp[0]), b = M.w2l(f, tp[tp.length - 1]); return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; }
console.log('--- tails: does a movement at the root reach the tip late, and does the chain stay calm');
['hyena', 'raptor', 'scorpion'].forEach(function (id) {
  [120, 30].forEach(function (hz) {
    var o = mk(id), S = o.S, T = o.ch.tail, fast = id === 'scorpion' ? 2.5 : 6, segErr = 0, maxTurn = 0, prev = null;
    function watch(dt) { var tp = S.pose.tailPts; for (var k = 1; k < tp.length; k++) segErr = Math.max(segErr, Math.abs(d(tp[k], tp[k - 1]) - T.seg)); var r = tipRel(S); if (prev) maxTurn = Math.max(maxTurn, d(r, prev) / dt); prev = r; }
    o.inp.speed = fast; o.run(5, watch, hz);
    var run = tipRel(S), side = 0; o.inp.steer = 1; o.run(1.2, function (dt) { watch(dt); var r = tipRel(S); if (Math.abs(r[2]) > Math.abs(side)) side = r[2]; }, hz);
    o.inp.steer = 0; o.run(2, watch, hz);
    var fwd = -9, back = 9; o.inp.speed = 0; o.run(1.5, function (dt) { watch(dt); var r = tipRel(S); fwd = Math.max(fwd, r[0]); back = Math.min(back, r[0]); }, hz);
    o.run(4, watch, hz); var rest = tipRel(S), rest2; o.run(3, watch, hz); rest2 = tipRel(S);
    // lag: when does the sideways swing of the first link peak, and when the last, over walking strides
    o.inp.speed = id === 'scorpion' ? 1.2 : 1.5; o.run(4, null, hz); var series = [];
    o.run(3, function () { var f = M.frameOf(S), tp = S.pose.tailPts.map(function (p) { return M.w2l(f, p); }); series.push([tp[1][2] - tp[0][2], tp[tp.length - 1][2] - tp[tp.length - 2][2], S.phase]); }, hz);
    function peakPhase(ix) { var best = -9, ph = 0; series.forEach(function (s) { if (s[ix] > best) { best = s[ix]; ph = s[2]; } }); return ph; }
    var lag = ((peakPhase(1) - peakPhase(0)) % 1 + 1) % 1;
    console.log(id.padEnd(9), (hz + ' Hz').padEnd(7), '| at speed the tip rides', run[1].toFixed(2), 'm from root height; in a turn it swings', (Math.abs(side) * 100).toFixed(0), 'cm aside | stopping throws it', ((fwd - rest[0]) * 100).toFixed(0), 'cm forward of where it hangs',
      '| the stride\'s swing reaches the tip', Math.round(lag * 100) + '% of a stride after the root | settles to within', (d(rest, rest2) * 100).toFixed(1), 'cm (idle wag included) | fastest tip', maxTurn.toFixed(1), 'm/s | link error', (segErr * 1000).toFixed(3), 'mm | nan', o.bad);
  });
});
console.log('--- raptor');
(function () {
  [0, 1.4, 4, 8, 12].forEach(function (v) { var o = mk('raptor'), S = o.S, low = 9, hi = 0, slide = 0, prev = null; o.inp.speed = v; o.run(5);
    o.run(3, function () { low = Math.min(low, S.pose.root[1]); hi = Math.max(hi, S.pose.root[1]); var cur = S.legs.map(function (l, i) { return l.swing ? null : S.pose.legs[i].ball; }); if (prev) cur.forEach(function (q, i) { if (q && prev[i]) slide = Math.max(slide, Math.hypot(q[0] - prev[i][0], q[2] - prev[i][2])); }); prev = cur; });
    console.log((v + ' m/s').padEnd(8), S.stats.gait.padEnd(9), 'Fr', S.stats.Fr.toFixed(2), '| stride', S.stats.stride.toFixed(2), 'm, duty', S.stats.duty.toFixed(2), '| hips', low.toFixed(2) + '..' + hi.toFixed(2), '| head at', (S.pose.head[1]).toFixed(2), 'm | feet slide', (slide * 1000).toFixed(2), 'mm | nan', o.bad); });
  [[1.5, 1.2, 0], [1.3, 0.5, 0], [1.4, 1.6, 0.3]].forEach(function (tg) { var o = mk('raptor'), S = o.S; o.inp.aim = tg; o.run(1.5); o.inp.bite = { target: tg }; o.step(1 / 120); o.inp.bite = null; o.run(0.8); var e = o.ev.filter(function (x) { return x.type === 'bite'; })[0];
    console.log('bite at', tg.join(','), '| muzzle', e ? (e.miss * 100).toFixed(1) + ' cm from it' : 'NO EVENT', '| nan', o.bad); });
  [2.5, 4].forEach(function (dist) { var o = mk('raptor'), S = o.S; o.run(2); var x0 = S.px; o.inp.pounce = { target: [x0 + dist, 0, 0] }; o.step(1 / 120); o.inp.pounce = null; o.run(2.5); var e = o.ev.filter(function (x) { return x.type === 'pounce'; })[0];
    console.log('pounce at', dist, 'm | jaws land', e ? ((e.pos[0] - x0 - dist) * 100).toFixed(0) + ' cm past it' : 'NO EVENT', '| stops', (S.px - x0).toFixed(2), 'm out | nan', o.bad); });
})();
console.log('--- scorpion');
(function () {
  [0, 1.2, 3.4].forEach(function (v) { var o = mk('scorpion'), S = o.S, low = 9, hi = 0, slide = 0, prev = null, down = 8; o.inp.speed = v; o.run(5);
    o.run(3, function () { low = Math.min(low, S.pose.root[1]); hi = Math.max(hi, S.pose.root[1]); down = Math.min(down, S.legs.filter(function (l) { return !l.swing; }).length); var cur = S.legs.map(function (l, i) { return l.swing ? null : S.pose.legs[i].ball; }); if (prev) cur.forEach(function (q, i) { if (q && prev[i]) slide = Math.max(slide, Math.hypot(q[0] - prev[i][0], q[2] - prev[i][2])); }); prev = cur; });
    console.log((v + ' m/s').padEnd(8), S.stats.gait.padEnd(9), '| stride', S.stats.stride.toFixed(2), 'm, duty', S.stats.duty.toFixed(2), '| body height', low.toFixed(2) + '..' + hi.toFixed(2), '| fewest feet down', down, '| feet slide', (slide * 1000).toFixed(2), 'mm | nan', o.bad); });
  [['pinch', [1.2, 0.3, 0.25]], ['pinch', [1.1, 0.5, -0.3]], ['pinch', [1.7, 0.3, 0]], ['sting', [0.8, 0.3, 0]], ['sting', [0.6, 0.9, 0.2]], ['sting', [0.3, 0.1, 0.4]], ['sting', [1.3, 0.3, 0]]].forEach(function (c) {
    var o = mk('scorpion'), S = o.S; o.run(1.5); var tail0 = tipRel(S); o.inp[c[0]] = { target: c[1] }; o.step(1 / 120); o.inp[c[0]] = null; var t0 = S.t; o.run(1.6);
    var e = o.ev.filter(function (x) { return x.type === c[0]; })[0];
    console.log(c[0], 'at', c[1].join(','), '|', e ? 'after ' + (e.t - t0).toFixed(2) + ' s, ' + (e.miss * 100).toFixed(1) + ' cm from it' : 'NO EVENT', '| tail back to within', (d(tipRel(S), tail0) * 100).toFixed(1), 'cm of where it was | nan', o.bad); });
})();
