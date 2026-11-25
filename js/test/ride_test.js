// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
// Riding: a soldier on the horse, the spider mech and the dragon (on the ground and in the air). Each line must end "nan false".
var M = require('../core.js'), ST = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 };
function bad(o) { var b = false; (function w(v) { if (typeof v === 'number') { if (!isFinite(v)) b = true; } else if (v && typeof v === 'object') for (var k in v) w(v[k]); })(o); return b; }
function d3(a, b) { return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2])); }
var hill = function (x, z) { return 0.25 * Math.sin(0.3 * x) + 0.15 * Math.sin(0.23 * (z || 0) + 1); };
function ride(tag, id, rate, fly) {
  var cm = M.CHARACTERS[id], cr = M.CHARACTERS.soldier, env = { terrain: hill }, Sm = M.createState(cm, env), Sr = M.createState(cr, env), renv = { terrain: hill, mount: { S: Sm, ch: cm } };
  var dt = 1 / rate, n = 14 * rate, i, k, nan = false, sd = cm.saddle, seatMax = 0, lift = [0, 0], foot = 0, hands = 0, stretch = 0, fires = 0, low = 9, speedMax = 0, bankMax = 0;
  M.step(Sm, cm, { speed: 0 }, ST, env, dt); Sm.events.length = 0;
  var ok = M.mountUp(Sr, cr, env, renv.mount);
  for (i = 0; i < n; i++) {
    var t = i * dt, sp = t < 2 ? 0.15 * cm.vmax : t < 7 ? 0.95 * cm.vmax : t < 10 ? 0.4 * cm.vmax : 0, armed = t > 8;
    if (fly && i === 2 * rate) M.enterFly(Sm, cm, env);
    M.step(Sm, cm, { speed: fly && t >= 2 ? Math.max(sp, 8) : sp, steer: t > 4 && t < 6 ? 0.7 : t > 11 && t < 12.5 ? -1 : 0, height: 5 }, ST, env, dt); Sm.events.length = 0;
    var p = M.step(Sr, cr, { aim: [Sm.px + 20 * Math.cos(Sm.h + 0.6), 1.5, Sm.pz + 20 * Math.sin(Sm.h + 0.6)], armed: armed, fire: t > 9 && t < 10.5 }, ST, renv, dt);
    Sr.events.forEach(function (e) { if (e.type === 'fire') fires++; }); Sr.events.length = 0;
    nan = nan || bad(p);
    var L = Sm.local, ax = L.axis, up = L.up, sv = [ax[1] * up[2] - ax[2] * up[1], ax[2] * up[0] - ax[0] * up[2], ax[0] * up[1] - ax[1] * up[0]], fr = M.frameOf(Sm);
    var at = function (a, b, c) { return M.l2w(fr, [L.root[0] + ax[0] * (sd.at[0] + a) + up[0] * (sd.at[1] + b) + sv[0] * c, L.root[1] + ax[1] * (sd.at[0] + a) + up[1] * (sd.at[1] + b) + sv[1] * c, L.root[2] + ax[2] * (sd.at[0] + a) + up[2] * (sd.at[1] + b) + sv[2] * c]); };
    var off = d3(p.root, at(0, 0, 0)); seatMax = Math.max(seatMax, off); lift[0] = Math.min(lift[0], Sr.ride.d.x); lift[1] = Math.max(lift[1], Sr.ride.d.x);
    for (k = 0; k < 2; k++) {
      var sg = k === 0 ? 1 : -1, lg = p.legs[k];
      foot = Math.max(foot, d3(lg.ball, at(sd.stirrup[0], sd.stirrup[1], sg * sd.stirrup[2])));
      stretch = Math.max(stretch, d3(lg.hip, lg.ankle) / (cr.legs[k].upper + cr.legs[k].lower));
      if (!armed && t > 1) hands = Math.max(hands, d3(p.arms[k].hand, at(sd.hands[0], sd.hands[1] + Sr.ride.d.x * 0, sg * sd.hands[2])));
    }
    low = Math.min(low, p.head[1] - p.root[1]); speedMax = Math.max(speedMax, Sm.v); if (Sm.bank) bankMax = Math.max(bankMax, Math.abs(Sm.bank.x));
  }
  console.log(tag, '| on', ok, '| top speed', speedMax.toFixed(1), 'm/s | hips from seat', (100 * seatMax).toFixed(1), 'cm (lift', (100 * lift[0]).toFixed(1), 'to', (100 * lift[1]).toFixed(1), ') | feet from stirrups', (100 * foot).toFixed(2), 'cm | leg stretch', stretch.toFixed(2),
    '| hands from reins', (100 * hands).toFixed(1), 'cm | head above hips', low.toFixed(2), 'm | shots', fires, '| bank', bankMax.toFixed(2), '| mode', Sm.mode + '/' + Sr.mode, '| nan', nan);
}
ride('horse 60       ', 'horse', 60); ride('horse 30       ', 'horse', 30); ride('horse 120      ', 'horse', 120);
ride('spider mech 60 ', 'spider', 60); ride('dragon 60      ', 'dragon', 60); ride('dragon flying  ', 'dragon', 60, true); ride('dragon flying 30', 'dragon', 30, true);
// thrown: the mount goes down and the rider falls from the saddle; and a rider who gets down stands beside the mount
(function () {
  var cm = M.CHARACTERS.horse, cr = M.CHARACTERS.soldier, env = { terrain: hill }, Sm = M.createState(cm, env), Sr = M.createState(cr, env), renv = { terrain: hill, mount: { S: Sm, ch: cm } }, i, nan = false, top = 0;
  M.step(Sm, cm, { speed: 0 }, ST, env, 1 / 60); M.mountUp(Sr, cr, env, renv.mount);
  for (i = 0; i < 400; i++) {
    var die = i === 150 ? { impulse: [-120, 40, 60] } : null;
    M.step(Sm, cm, { speed: 9, die: die }, ST, env, 1 / 60); var p = M.step(Sr, cr, { die: die }, ST, renv, 1 / 60); Sm.events.length = 0; Sr.events.length = 0;
    nan = nan || bad(p) || bad(Sm.pose); if (i > 150) top = Math.max(top, p.root[1] - hill(p.root[0], p.root[2]));
  }
  console.log('thrown at 9 m/s | modes', Sm.mode + '/' + Sr.mode, '| rider ends', (p.root[1] - hill(p.root[0], p.root[2])).toFixed(2), 'm above the ground, was', top.toFixed(2), '| apart', d3(p.root, Sm.pose.root).toFixed(1), 'm | nan', nan);
  var S2 = M.createState(cr, env), Sh = M.createState(cm, env); M.step(Sh, cm, { speed: 0 }, ST, env, 1 / 60); M.mountUp(S2, cr, env, { S: Sh, ch: cm });
  for (i = 0; i < 60; i++) { M.step(Sh, cm, { speed: 0 }, ST, env, 1 / 60); M.step(S2, cr, {}, ST, { terrain: hill, mount: { S: Sh, ch: cm } }, 1 / 60); }
  var ok = M.dismount(S2, cr, env); for (i = 0; i < 60; i++) M.step(S2, cr, { speed: 0 }, ST, env, 1 / 60);
  console.log('getting down    | done', ok, '| mode', S2.mode, '| hips', (S2.y - hill(S2.px, S2.pz)).toFixed(2), 'm up | beside by', Math.hypot(S2.px - Sh.px, S2.pz - Sh.pz).toFixed(2), 'm | a hyena cannot be ridden:', M.mountUp(M.createState(cr, env), cr, env, { S: M.createState(M.CHARACTERS.hyena, env), ch: M.CHARACTERS.hyena }), '| nan', bad(S2.pose));
})();
