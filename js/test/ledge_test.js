// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
// Ledge grab: hang by the hands from an edge, pull up over it, stand on top. Each line must end "nan false".
var M = require('../core.js'), ST = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 };
function bad(o) { var b = false; (function w(v) { if (typeof v === 'number') { if (!isFinite(v)) b = true; } else if (v && typeof v === 'object') for (var k in v) w(v[k]); })(o); return b; }
function d3(a, b) { return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2])); }
function run(tag, H, head, base, rate) {
  var ch = M.CHARACTERS.soldier, wx = 3, inp = { speed: 0, aim: null }, dt = 1 / rate, nan = false, ev = [], i;
  var env = { terrain: function (x, z) { var u = x * Math.cos(head) + (z || 0) * Math.sin(head); return base(x, z) + (u > wx ? H : 0); } }, S = M.createState(ch, env);
  M.place(S, ch, env, (wx - 0.4) * Math.cos(head), (wx - 0.4) * Math.sin(head), head);
  function step(n) { for (i = 0; i < n; i++) { M.step(S, ch, inp, ST, env, dt); nan = nan || bad(S.pose); S.events.forEach(function (e) { ev.push(e.type); }); S.events.length = 0; } }
  step(rate / 2);
  var edge = [wx * Math.cos(head), base(wx * Math.cos(head), wx * Math.sin(head)) + H, wx * Math.sin(head)];
  var ok = M.grabLedge(S, ch, env, edge); step(rate);
  var P = S.pose, hands = Math.max.apply(null, P.arms.map(function (m) { return Math.abs(m.hand[1] - edge[1] - 0.02); }));
  var inWall = function () { var w = 0; S.local.legs.forEach(function (l) { if (l.knee[1] < S.ledge.ey) w = Math.max(w, l.knee[0] - S.ledge.ex); }); return w; }, knee = inWall();
  var hangY = S.y, t0 = S.t; inp.climb = true; step(1); inp.climb = false;
  var maxJump = 0, prev = S.pose.root.slice(), n = 0;
  while (S.mode === 'ledge' && n < 4 * rate) { step(1); n++; if (S.mode === 'ledge') knee = Math.max(knee, inWall()); maxJump = Math.max(maxJump, d3(S.pose.root, prev) / dt); prev = S.pose.root.slice(); }
  var took = n / rate; step(rate / 2); inp.speed = 1.4; step(2 * rate);
  var top = env.terrain(S.px, S.pz), feet = Math.max.apply(null, S.pose.legs.map(function (l) { return Math.abs(l.ball[1] - env.terrain(l.ball[0], l.ball[2])); }));
  console.log(tag, '| grab', ok, '| hands off lip', (100 * hands).toFixed(1), 'cm | knee past wall', (100 * knee).toFixed(1), 'cm | hang hip', (edge[1] - hangY).toFixed(2), 'm below | climb', took.toFixed(2), 's | fastest hip', maxJump.toFixed(1), 'm/s | mode', S.mode, '| on top', (top - base(S.px, S.pz)).toFixed(2), '| feet off ground', (100 * feet).toFixed(1), 'cm | v', S.stats.v.toFixed(2), '|', ev.join(','), '| nan', nan);
}
var flat = function () { return 0; }, hill = function (x, z) { return 0.25 * Math.sin(0.5 * x) + 0.2 * Math.sin(0.4 * (z || 0)); };
run('wall 2.3 m      ', 2.3, 0, flat, 60);
run('wall 2.0 m      ', 2.0, 0, flat, 60);
run('wall 2.6 m      ', 2.6, 0, flat, 60);
run('facing 2 rad    ', 2.3, 2.0, flat, 60);
run('rolling ground  ', 2.3, 0, hill, 60);
run('30 steps a sec  ', 2.3, 0, flat, 30);
run('240 steps a sec ', 2.3, 0, flat, 240);
// a drop from the hang, and a creature that cannot hang
(function () {
  var ch = M.CHARACTERS.soldier, inp = { speed: 0 }, env = { terrain: function (x) { return x > 3 ? 2.3 : 0; } }, S = M.createState(ch, env), i, nan = false;
  M.place(S, ch, env, 2.6, 0, 0); M.grabLedge(S, ch, env, [3, 2.3, 0]);
  for (i = 0; i < 60; i++) { M.step(S, ch, inp, ST, env, 1 / 60); nan = nan || bad(S.pose); }
  inp.drop = true; M.step(S, ch, inp, ST, env, 1 / 60); inp.drop = false;
  for (i = 0; i < 90; i++) { M.step(S, ch, inp, ST, env, 1 / 60); nan = nan || bad(S.pose); }
  console.log('drop            | mode', S.mode, '| hip height', (S.y - env.terrain(S.px, 0)).toFixed(2), '| nan', nan);
  var h = M.CHARACTERS.hyena, Sh = M.createState(h, env);
  console.log('hyena           | grab', M.grabLedge(Sh, h, env, [3, 2.3, 0]), '| mode', Sh.mode, '| nan', false);
})();
