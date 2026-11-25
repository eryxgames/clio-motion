// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
// Two soldiers fight for a while, headless. Counts what happened and checks the motion stays sound.
var M = require('../core.js'), FT = require('../fight.js');
var st = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 };
function nan(o) { if (typeof o === 'number') return !isFinite(o); if (o && typeof o === 'object') for (var k in o) if (nan(o[k])) return true; return false; }
var secs = +(process.argv[2] || 60), hz = +(process.argv[3] || 120), verbose = process.argv[4] === 'v';
[1, 2, 3, 4].forEach(function (seed) {
  var ch = M.CHARACTERS.soldier, env = { terrain: function () { return 0; } };
  var F = FT.create({ M: M, chars: [ch, ch], env: env, style: st, seed: seed, temper: [0.5, 0.7] }), DT = 1 / hz;
  var bad = false, dmin = 9, dmax = 0, slide = 0, low = 9, prev = [null, null], steps = [0, 0], maxHand = 0, prevHand = [null, null], inside = 0, n = Math.round(secs * hz), faceErr = 0, moved = [0, 0], last = [null, null];
  for (var i = 0; i < n; i++) {
    FT.step(F, DT);
    var d = Math.hypot(F.fighters[0].S.px - F.fighters[1].S.px, F.fighters[0].S.pz - F.fighters[1].S.pz);
    F.fighters.forEach(function (f, k) {
      var S = f.S, p = S.pose; if (nan(p)) bad = true;
      f.events.forEach(function (e) { if (e.type === 'land') steps[k]++; }); f.events.length = 0;
      if (last[k]) moved[k] += Math.hypot(S.px - last[k][0], S.pz - last[k][1]); last[k] = [S.px, S.pz];
      if (S.mode !== 'ground') { prev[k] = null; prevHand[k] = null; return; }
      var cur = S.legs.map(function (l, j) { return l.swing ? null : [p.legs[j].ball[0], p.legs[j].ball[2]]; });
      if (prev[k]) cur.forEach(function (c, j) { if (c && prev[k][j]) slide = Math.max(slide, Math.hypot(c[0] - prev[k][j][0], c[1] - prev[k][j][1])); });
      prev[k] = cur; low = Math.min(low, p.root[1]);
      var o = F.fighters[1 - k].S;
      if (o.mode === 'ground') { faceErr = Math.max(faceErr, Math.abs(M.wrapPi(Math.atan2(o.pz - S.pz, o.px - S.px) - S.h))); }
      var h = p.arms.map(function (a) { return a.hand; });
      if (prevHand[k]) h.forEach(function (v, j) { maxHand = Math.max(maxHand, Math.hypot(v[0] - prevHand[k][j][0], v[1] - prevHand[k][j][1], v[2] - prevHand[k][j][2]) / DT); });
      prevHand[k] = h;
    });
    if (F.fighters[0].S.mode === 'ground' && F.fighters[1].S.mode === 'ground') { dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); if (d < 0.45) inside++; }
  }
  var s0 = F.fighters[0].stats, s1 = F.fighters[1].stats;
  function line(s) { return s.thrown + ' thrown, ' + s.landed + ' landed, ' + s.blocked + ' blocked, ' + s.missed + ' missed, ' + s.knockdowns + ' knockdowns'; }
  console.log('seed', seed, '|', secs + ' s at ' + hz + ' Hz | nan', bad, '\n  A:', line(s0), '\n  B:', line(s1),
    '\n  apart', dmin.toFixed(2) + '..' + dmax.toFixed(2), 'm | steps', steps.join('/'), '| ground covered', moved.map(function (v) { return v.toFixed(1); }).join('/'), 'm | planted feet slide', (slide * 1000).toFixed(2), 'mm | lowest hips', low.toFixed(2), 'm | worst facing error', (faceErr * 57.3).toFixed(0) + '° | fastest hand', maxHand.toFixed(1), 'm/s | steps closer than 0.45 m:', inside);
  if (verbose && seed === 1) F.log.slice(0, 40).forEach(function (e) { console.log('   ', e.t.toFixed(2), 'AB'[e.by], e.kind, e.type, e.where || '', e.hp !== undefined ? 'hp ' + e.hp : ''); });
});
