// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
/* The live skeleton (the reference the C and Python versions are checked against): the joints of a pose, the parts
   they carry against the rig's own parts, their draw order, and each joint's move from the template pose.
   Stops with an error if anything fails. */
var M = require('../core.js'), R = require('../rig.js'), B = require('../bake.js')(M, R);
var bad = 0;
function check(ok, what) { if (!ok) { bad++; console.log('FAIL  ' + what); } return ok; }
var views = [R.projector({ cx: 0, cy: 0, cz: 0, yaw: 0, pit: 0, ppm: 1, ox: 0, oy: 0 }), R.projector({ cx: 0, cy: 0, cz: 0, yaw: 0.7, pit: 0.3, ppm: 1, ox: 0, oy: 0 }), R.projector({ cx: 0, cy: 0, cz: 0, yaw: 2.6, pit: 0, ppm: 1, ox: 0, oy: 0 })];
Object.keys(M.CHARACTERS).forEach(function (id) {
  var ch = M.CHARACTERS[id];
  (ch.mount.type === 'held' ? Object.keys(M.KITS) : [null]).forEach(function (kit) {
    var k0 = kit === ch.mount.kit ? null : kit, bad0 = bad, clips = B.recordAll(ch, { frames: 6, kit: k0 }), data = B.rigData(ch, { kit: k0 });
    var sum = 0, n = 0, worst = 0, where = '', orderOff = 0, shadeOff = 0, moveOff = 0, orth = 0, frames = 0;
    clips.forEach(function (c) {
      var sk = null;
      c.frames.forEach(function (pose, f) {
        sk = B.liveSkeleton(ch, pose, sk); frames++;
        var got = B.liveParts(sk), want = R.buildPrims(pose, ch, { flash: false, model: true });
        check(sk.rig === data && got.length === want.length, data.name + ' ' + c.name + ': the pose belongs to its rig');
        want.forEach(function (q, k) {
          [[q.a, got[k].a], [q.b, got[k].b]].forEach(function (pp) { if (!pp[0]) return; var e = Math.hypot(pp[0][0] - pp[1][0], pp[0][1] - pp[1][1], pp[0][2] - pp[1][2]) / ch.L; sum += e; n++; if (e > worst) { worst = e; where = c.name + ' frame ' + f + ' ' + q.g; } });
        });
        views.forEach(function (P) {
          R.order(want, P); var ka = want.map(function (q) { return q.k; }), la = want.map(function (q) { return q.lv; });
          R.order(got, P);
          if (got.some(function (q, k) { return Math.abs(q.k - ka[k]) > 1e-9; })) orderOff++;
          if (got.some(function (q, k) { return q.lv !== la[k]; })) shadeOff++;
        });
        sk.frames.forEach(function (F, j) {
          // a joint's axes are at right angles and of length one, and its move takes its place in the template to its place now
          orth = Math.max(orth, Math.abs(F.x[0] * F.y[0] + F.x[1] * F.y[1] + F.x[2] * F.y[2]), Math.abs(Math.hypot(F.x[0], F.x[1], F.x[2]) - 1), Math.abs(Math.hypot(F.z[0], F.z[1], F.z[2]) - 1));
          var m = B.jointMove(sk, j), t = data.joints[j].o, g = [-t[2], t[1], t[0]], w = [m[0] * g[0] + m[4] * g[1] + m[8] * g[2] + m[12], m[1] * g[0] + m[5] * g[1] + m[9] * g[2] + m[13], m[2] * g[0] + m[6] * g[1] + m[10] * g[2] + m[14]];
          moveOff = Math.max(moveOff, Math.hypot(w[0] + F.o[2], w[1] - F.o[1], w[2] - F.o[0]));
        });
      });
    });
    check(sum / n < 0.002 && worst < 0.25, data.name + ': parts carried by the joints are where the rig puts them (mean ' + sum / n + ', worst ' + worst + ' of leg length)');
    check(orderOff === 0 && shadeOff === 0, data.name + ': the same draw order and shading as the rig, from three sides (' + orderOff + ', ' + shadeOff + ' off)');
    check(orth < 1e-9 && moveOff < 1e-5, data.name + ': joint axes are square (' + orth + ') and each move brings the template joint to where it is now (' + moveOff + ' m)');
    console.log((bad > bad0 ? 'FAIL  ' : 'ok    ') + data.name.padEnd(16) + data.joints.length + ' joints, ' + data.parts.length + ' parts, ' + frames + ' poses: parts within ' + (sum / n * 100).toFixed(3) + '% of leg length on average (worst '
      + (worst * 100).toFixed(1) + '%, ' + where + ')');
  });
});
console.log(bad ? bad + ' failed' : 'skeleton: all passed');
process.exit(bad ? 1 : 0);
