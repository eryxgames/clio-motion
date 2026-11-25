// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
var M = require('../core.js'), FT = require('../fight.js');
var st = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 }, L = 0.92;
function nan(o) { if (typeof o === 'number') return !isFinite(o); if (o && typeof o === 'object') for (var k in o) if (nan(o[k])) return true; return false; }
var T = { flat: function () { return 0; }, rough: function (x) { return L * (0.10 * Math.sin(x / (1.9 * L)) + 0.05 * Math.sin(x / (0.73 * L) + 1.3)); },
  steps: function (x) { var k = ((Math.floor(x / (1.3 * L)) % 8) + 8) % 8; return L * 0.17 * [0, 1, 2, 3, 3, 2, 1, 0][k]; } };
Object.keys(T).forEach(function (tn) {
  var ch = M.CHARACTERS.soldier, env = { terrain: T[tn] }, F = FT.create({ M: M, chars: [ch, ch], env: env, style: st, seed: 7, at: [3.3, 0] }), bad = false, under = 0, low = 9, kd = 0, air = 0;
  for (var i = 0; i < 90 * 120; i++) { FT.step(F, 1 / 120); F.fighters.forEach(function (f) { var p = f.S.pose; if (nan(p)) bad = true; f.events.length = 0;
    if (f.S.mode === 'ground') { p.legs.forEach(function (l, j) { if (f.S.legs[j].swing) return; var gs = [-0.03, 0, 0.03].map(function (o) { return T[tn](l.ball[0] + o); }); under = Math.max(under, Math.min.apply(null, gs.map(function (g) { return g - l.ball[1]; }))); air = Math.max(air, Math.min.apply(null, gs.map(function (g) { return l.ball[1] - g; }))); }); low = Math.min(low, p.root[1] - T[tn](p.root[0])); } }); }
  var s = F.fighters.map(function (f) { return f.stats.thrown + '/' + f.stats.landed + '/' + f.stats.blocked + '/' + f.stats.missed + ' kd ' + f.stats.knockdowns; });
  console.log(tn.padEnd(6), '90 s | nan', bad, '| thrown/landed/blocked/missed A', s[0], '| B', s[1], '| planted foot below ground at most', (under * 100).toFixed(1), 'cm, above', (air * 100).toFixed(1), 'cm | lowest hips over ground', low.toFixed(2));
});
