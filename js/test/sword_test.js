// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
// Sword and shield, headless.
var M = require('../core.js'), ch = M.CHARACTERS.soldier, st = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 }, DT = 1 / 120;
function nan(o) { if (typeof o === 'number') return !isFinite(o); if (o && typeof o === 'object') for (var k in o) if (nan(o[k])) return true; return false; }
function d(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0)); }
var env = { terrain: function () { return 0; } }, S = M.createState(ch, env), inp = { speed: 0, armed: true, kit: 'sword' }, ev = [], bad = false, worstGrip = [0, 0], lenErr = 0, tipFast = 0, prevTip = null;
function run(sec, each) { for (var n = Math.round(sec / DT), i = 0; i < n; i++) { M.step(S, ch, inp, st, env, DT); if (nan(S.pose)) bad = true; S.events.forEach(function (e) { e.t = S.t; ev.push(e); }); S.events.length = 0;
  var p = S.pose; if (p.props.length === 2 && S.kit === 'sword' && S.armed.x > 0.98) { for (var k = 0; k < 2; k++) worstGrip[k] = Math.max(worstGrip[k], d(p.arms[k].hand, p.props[k].grip)); lenErr = Math.max(lenErr, Math.abs(d(p.props[0].o, p.props[0].muzzle) - M.PROPS.sword.len), Math.abs(d(p.props[1].o, p.props[1].muzzle) - M.PROPS.shield.len)); var tp = [p.props[0].muzzle[0] - S.px, p.props[0].muzzle[1], p.props[0].muzzle[2] - S.pz]; if (prevTip) tipFast = Math.max(tipFast, d(tp, prevTip) / DT); prevTip = tp; }
  if (each) each(); } }
run(3); var p = S.pose;
console.log('kit', S.kit, '| sword point', p.props[0].muzzle.map(function (v) { return v.toFixed(2); }).join(','), '| shield from', p.props[1].o[1].toFixed(2), 'to', p.props[1].muzzle[1].toFixed(2), 'm high,', (p.props[1].o[0] - S.px).toFixed(2), 'm in front | nan', bad);
['slash', 'chop', 'thrust'].forEach(function (k) {
  ev.length = 0; tipFast = 0; var t0 = S.t, far = 0, hi = 0, lat = [9, -9]; inp.swing = { kind: k }; run(DT); inp.swing = null;
  run(1.2, function () { if (S.act && S.act.live) { var t = S.pose.props[0].muzzle; far = Math.max(far, t[0] - S.px); hi = Math.max(hi, t[1]); lat[0] = Math.min(lat[0], t[2]); lat[1] = Math.max(lat[1], t[2]); } });
  var e = ev.filter(function (x) { return x.type === 'strike'; })[0];
  console.log(k.padEnd(7), '| lands after', e ? (e.t - t0).toFixed(2) + ' s, point at ' + (e.point[0] - S.px).toFixed(2) + ' m out, ' + e.point[1].toFixed(2) + ' m high, travelling ' + e.dir.map(function (v) { return v.toFixed(1); }).join(',') : 'NO EVENT', '| while live the point reaches', far.toFixed(2), 'm out and sweeps', (lat[1] - lat[0]).toFixed(2), 'm across | fastest', tipFast.toFixed(0), 'm/s | nan', bad); });
var s0 = S.pose.props[1].o.slice(), head = S.pose.head; inp.block = true; run(0.5); var up = S.pose.props[1];
console.log('block: shield top goes from', (s0[1] + 0.62).toFixed(2), 'to', up.muzzle[1].toFixed(2), 'm (head at', head[1].toFixed(2) + '), and to', (up.o[2] - S.pz).toFixed(2), 'm off the centre line'); inp.block = false; run(0.5);
inp.speed = 3; run(3); inp.swing = { kind: 'slash' }; run(DT); inp.swing = null; run(1); console.log('swinging at a walk:', ev.filter(function (x) { return x.type === 'strike'; }).length, 'strikes so far, speed', S.v.toFixed(1));
inp.speed = 0; inp.armed = false; run(1.5); console.log('put away: sword', (S.pose.props[0].stow).toFixed(2), 'shield', S.pose.props[1].stow.toFixed(2), '| sword at the hip', (S.pose.props[0].o[1]).toFixed(2), 'm, shield on the back', (S.pose.props[1].o[0] - S.px).toFixed(2), 'm');
inp.armed = true; inp.kit = 'rifle'; run(2.5); console.log('back to the rifle:', S.kit, 'props', S.pose.props.length);
console.log('hands off their grips at most (sword, shield):', (worstGrip[0] * 100).toFixed(1), (worstGrip[1] * 100).toFixed(1), 'cm | length error', (lenErr * 1e6).toFixed(2), 'micrometres | nan', bad);
