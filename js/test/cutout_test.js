// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
/* The 2D cutout: the pictures in the atlas, where each one is put in every frame, and the player.
   Stops with an error if anything fails. */
var M = require('../core.js'), R = require('../rig.js'), B = require('../bake.js')(M, R), C = require('../cutout.js');
var bad = 0;
function check(ok, what) { if (!ok) { bad++; console.log('FAIL  ' + what); } return ok; }
var proj = R.projector({ cx: 0, cy: 0, cz: 0, yaw: 0, pit: 0, ppm: 1, ox: 0, oy: 0 });
// where a point of a sprite's picture (pixels in its rect) is in the world, by the file's own rule
function place(sp, f, u, v) { var lx = (u - sp.pivot[0]) * f[3], ly = (v - sp.pivot[1]) * f[4], c = Math.cos(f[2]), s = Math.sin(f[2]); return [f[0] + c * lx - s * ly, f[1] + s * lx + c * ly]; }
function turn(a) { a = a % (2 * Math.PI); return Math.abs(a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a); }          // an angle's size, the short way round
function far(a, b) { return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1])); }
Object.keys(M.CHARACTERS).forEach(function (id) {
  var ch = M.CHARACTERS[id], bad0 = bad, clips = B.recordAll(ch, { frames: 6, clips: ['idle', 'walk', 'run', 'attack', 'turn', 'die', 'climb', 'fly', 'swim'] });
  // --- plain shapes only
  var cu = B.cutout(ch, clips), J = cu.json, W = cu.w, H = cu.h, rects = {}, worstBox = 0, worstJoint = 0, worstEnd = 0, n = 0, i;
  J.sprites.forEach(function (sp) { rects[sp.rect.join(',')] = sp.rect; });
  var list = Object.keys(rects).map(function (k) { return rects[k]; });
  check(list.every(function (r) { return r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= W && r[1] + r[3] <= H; }), id + ': every picture is inside the atlas');
  check(list.every(function (a, x) { return list.every(function (b, y) { return x >= y || a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1]; }); }), id + ': no two pictures overlap in the atlas');
  check(list.every(function (r) { var k = ((r[1] + (r[3] >> 1)) * W + r[0] + (r[2] >> 1)) * 4; return cu.rgba[k + 3] === 255; }), id + ': every picture has something in it');
  check(cu.rgba.length === W * H * 4 && J.size[0] === W && J.size[1] === H, id + ': the atlas is the size the file says');
  Object.keys(J.clips).forEach(function (name) {
    var c = J.clips[name], clip = clips.filter(function (k) { return k.name === name; })[0], lift = clip.ladder ? clip.frames[0].root[1] - ch.rootHeight - 0.1 : 0;
    check(c.frames.length === clip.frames.length && c.times.length === c.frames.length && c.times.every(function (t, k) { return k === 0 ? t === 0 : t > c.times[k - 1]; }) && c.seconds > c.times[c.times.length - 1], id + ' ' + name + ': times rise and end before the clip does');
    c.frames.forEach(function (row, f) {
      // the plain picture of a part must cover exactly the part: its box round the capsule, by the rig's own points
      var sorted = R.order(R.buildPrims(clip.frames[f], ch, { flash: false, model: true }), proj);
      check(row.length === J.sprites.length && sorted.length === row.length, id + ' ' + name + ': a place for every sprite');
      sorted.forEach(function (q, z) {
        var sp = J.sprites[q.i], fr = row[q.i], a = [q.pa[0], q.pa[1] + lift], b = q.pb ? [q.pb[0], q.pb[1] + lift] : a, L = sp.capsule[0], rp = sp.capsule[1], m = sp.pivot[0] - rp;
        var d = far(a, b), ux = d > 1e-9 ? (b[0] - a[0]) / d : 1, uy = d > 1e-9 ? (b[1] - a[1]) / d : 0, r = q.r;
        [[m, m, -r, -r, a], [m + L + 2 * rp, m, r, -r, b], [m, m + 2 * rp, -r, r, a], [m + L + 2 * rp, m + 2 * rp, r, r, b]].forEach(function (k) {
          var want = [k[4][0] + ux * k[2] - uy * k[3], k[4][1] + uy * k[2] + ux * k[3]];
          worstBox = Math.max(worstBox, far(place(sp, fr, k[0], k[1]), want)); n++;
        });
        check(fr[5] === z, id + ' ' + name + ': drawn in the rig\'s order');
      });
    });
  });
  check(worstBox < 3e-5, id + ': each plain picture covers its part exactly (off by ' + worstBox + ' m)');
  // --- with pictures as a drawing gives them: each is held to its joint, and its bone's end to the bone's end
  var first = R.order(R.buildPrims(clips[0].frames[0], ch, { flash: false, model: true }), proj), parts = {};
  R.SLOTS[id].forEach(function (sl) {
    var q = first.filter(function (p) { return p.part === sl[0]; })[0]; if (!q) return;
    var e = sl[2] === 'ball' ? null : (q.pe || q.pb), len = e ? far(q.pa, e) : 0, w = 40, h = 24, px = new Uint8Array(w * h * 4).fill(200);
    if (e && len < 0.02) return;                                   // a bone seen end on in this pose: no picture for it here
    parts[sl[0]] = { w: w, h: h, axis: sl[2], box: sl[2] === 'right' ? [-0.07, -0.09, len + 0.05, 0.08] : sl[2] === 'ball' ? [-0.1, -0.12, 0.11, 0.09] : [-0.09, -0.07, 0.08, len + 0.05], len: len, r: q.r, rgba: px };
  });
  var cu2 = B.cutout(ch, clips, { parts: parts }), J2 = cu2.json, pictured = 0;
  check(J2.sprites.length <= J.sprites.length, id + ': a part with a picture hides the plain shapes it stands for');
  Object.keys(J2.clips).forEach(function (name) {
    var clip = clips.filter(function (k) { return k.name === name; })[0], lift = clip.ladder ? clip.frames[0].root[1] - ch.rootHeight - 0.1 : 0;
    J2.clips[name].frames.forEach(function (row, f) {
      var sorted = R.order(R.buildPrims(clip.frames[f], ch, { flash: false, model: true }), proj), k = 0;
      sorted.forEach(function (q) {
        if (q.of && parts[q.of]) return;
        var sp = J2.sprites.filter(function (s2, x) { return row[x] && row[x][5] === k; })[0], fr = row[J2.sprites.indexOf(sp)]; k++;
        if (!q.part || !parts[q.part]) return;
        var im = parts[q.part], e = im.axis === 'ball' ? null : (q.pe || q.pb), a = [q.pa[0], q.pa[1] + lift], b = e ? [e[0], e[1] + lift] : null;
        if (im.axis === 'up') { var t = a; a = b; b = t; }
        pictured++;
        worstJoint = Math.max(worstJoint, far([fr[0], fr[1]], a));                                   // the pivot is the joint
        if (b && far(a, b) / im.len > 2 * q.r / (im.len + 2 * im.r) + 1e-6) {                          // (unless the bone is seen nearly end on)
          var bx = im.box, u = sp.pivot[0] + (im.axis === 'right' ? im.len * im.w / (bx[2] - bx[0]) : 0), v = sp.pivot[1] + (im.axis === 'right' ? 0 : im.len * im.h / (bx[3] - bx[1]));
          worstEnd = Math.max(worstEnd, far(place(sp, fr, u, v), b));
        }
      });
    });
  });
  check(pictured > 0 && worstJoint < 3e-5 && worstEnd < 3e-5, id + ': a drawn part is held at its joint (' + worstJoint + ' m) and at its bone\'s end (' + worstEnd + ' m)');
  // --- the player
  var ok = true, jump = 0;
  Object.keys(J.clips).forEach(function (name) {
    var c = J.clips[name];
    c.times.forEach(function (t, f) { var s = C.sample(J, name, t); s.forEach(function (o, k) { var a = c.frames[f][k]; if (Math.abs(o.x - a[0]) + Math.abs(o.y - a[1]) + turn(o.angle - a[2]) + Math.abs(o.scaleX - a[3]) > 1e-6 || o.order !== a[5]) ok = false; }); });
    // nothing leaps from one moment to the next, also where a loop runs from its last frame into its first
    for (var t = 0; t < c.seconds * (c.loop ? 2 : 1); t += c.seconds / 97) {
      var s0 = C.sample(J, name, t), s1 = C.sample(J, name, t + 0.002);
      s0.forEach(function (o, k) { if (o.scaleX * s1[k].scaleX > 0) jump = Math.max(jump, far([o.x, o.y], [s1[k].x, s1[k].y]) / ch.L, turn(s1[k].angle - o.angle) / 6); });
    }
    // halfway between two frames a picture has turned half the way, the short way round
    for (var f2 = 0; f2 + 1 < c.frames.length; f2++) {
      var mid = C.sample(J, name, (c.times[f2] + c.times[f2 + 1]) / 2);
      mid.forEach(function (o, k) { var a = c.frames[f2][k], b = c.frames[f2 + 1][k]; if (a[3] * b[3] > 0 && a[4] * b[4] > 0 && Math.abs(turn(o.angle - a[2]) - turn(b[2] - a[2]) / 2) > 1e-6) ok = false; });
    }
    var endT = C.sample(J, name, c.seconds + 5), wantF = c.loop ? null : c.frames[c.frames.length - 1];
    if (wantF && Math.abs(endT[0].x - wantF[0][0]) > 1e-9) ok = false;
  });
  check(ok, id + ': the player gives each frame back as it is, and holds the end of a clip that plays once');
  check(jump < 0.25, id + ': nothing leaps between one moment and the next (' + jump + ')');
  console.log((bad > bad0 ? 'FAIL  ' : 'ok    ') + id.padEnd(9) + J.sprites.length + ' pictures (' + list.length + ' different) in ' + W + ' x ' + H + ', ' + Object.keys(J.clips).length + ' clips; plain parts covered to '
    + worstBox.toExponential(1) + ' m; with ' + Object.keys(parts).length + ' drawn parts ' + J2.sprites.length + ' pictures, joints held to ' + worstJoint.toExponential(1) + ' m');
});
console.log(bad ? bad + ' failed' : 'cutout: all passed');
process.exit(bad ? 1 : 0);
