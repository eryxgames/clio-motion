// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
/* Plays a 2D cutout (<name>_cutout.json and <name>_cutout.png, written by the baker and by Gait Bench): the pictures of
   a character's parts, moved about frame by frame. No other file of the library is needed.

     var frame = GaitCutout.sample(pack, 'walk', seconds);        // where every picture is at that moment
     GaitCutout.draw(ctx, pack, image, frame, { x: 200, y: 300, ppm: 120, mirror: false });

   pack: the parsed .json. image: the .png (an Image or a canvas). x, y: where the ground point under the body goes
   on the canvas; ppm: pixels to a metre; mirror: face left instead of right.

   The file, for players in other engines. sprites[i]: rect [x, y, w, h] in the picture file, pivot [u, v] in that
   rect (pixels from its top left). clips[name]: loop, seconds, times, and frames[f][i] = [x, y, angle, scaleX, scaleY,
   order, tint] for sprite i: put the sprite's pivot at (x, y) (metres; x to the right, y down, the ground at 0), turn
   it by angle (radians, clockwise on the screen), scale it by scaleX and scaleY (metres to a picture pixel; negative:
   mirrored), draw sprites in rising order, and multiply the picture's colour by tint. Between two frames: move, turn
   (the short way round) and scale in a straight line; take order and tint from the earlier frame; and if a scale
   changes sign between the two (the body has turned round), hold the earlier frame. A looping clip runs on from its
   last frame into its first; another clip holds its last frame. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GaitCutout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var TAU = Math.PI * 2;
  function sample(pack, clip, t) {
    var c = pack.clips[clip];
    if (!c) throw new Error('No clip "' + clip + '" in this cutout. It has: ' + Object.keys(pack.clips).join(', '));
    var n = c.times.length, T = c.seconds, i, j, u;
    if (c.loop) t = ((t % T) + T) % T; else t = t < 0 ? 0 : t > c.times[n - 1] ? c.times[n - 1] : t;
    for (i = n - 1; i > 0 && c.times[i] > t; i--);
    j = i + 1 < n ? i + 1 : c.loop ? 0 : i;
    var t0 = c.times[i], t1 = j > i ? c.times[j] : c.loop ? T : t0;
    u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    var A = c.frames[i], B = c.frames[j], out = new Array(A.length);
    for (var s = 0; s < A.length; s++) {
      var a = A[s], b = B[s];
      if (!a) { out[s] = null; continue; }
      if (!b || u === 0 || a[3] * b[3] < 0 || a[4] * b[4] < 0) { out[s] = { x: a[0], y: a[1], angle: a[2], scaleX: a[3], scaleY: a[4], order: a[5], tint: a[6] }; continue; }
      var d = (b[2] - a[2]) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
      out[s] = { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, angle: a[2] + d * u, scaleX: a[3] + (b[3] - a[3]) * u, scaleY: a[4] + (b[4] - a[4]) * u, order: a[5], tint: a[6] };
    }
    return out;
  }
  // a picture darkened by tint, made once
  var shaded = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function tinted(image, rect, tint) {
    if (!(tint < 0.995) || typeof document === 'undefined') return null;
    var per = shaded && shaded.get(image); if (!per) { per = {}; if (shaded) shaded.set(image, per); }
    var key = rect.join(',') + '|' + Math.round(tint * 50), cv = per[key];
    if (!cv) {
      cv = per[key] = document.createElement('canvas'); cv.width = rect[2]; cv.height = rect[3];
      var c = cv.getContext('2d'); c.drawImage(image, rect[0], rect[1], rect[2], rect[3], 0, 0, rect[2], rect[3]);
      c.globalCompositeOperation = 'source-atop'; c.fillStyle = 'rgba(0,0,0,' + (1 - tint) + ')'; c.fillRect(0, 0, rect[2], rect[3]);
    }
    return cv;
  }
  function draw(ctx, pack, image, frame, view) {
    var ids = [], k;
    for (k = 0; k < frame.length; k++) if (frame[k]) ids.push(k);
    ids.sort(function (a, b) { return frame[a].order - frame[b].order; });
    ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.mirror ? -view.ppm : view.ppm, view.ppm);
    for (k = 0; k < ids.length; k++) {
      var f = frame[ids[k]], sp = pack.sprites[ids[k]], r = sp.rect, dark = tinted(image, r, f.tint);
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.angle); ctx.scale(f.scaleX, f.scaleY);
      if (dark) ctx.drawImage(dark, -sp.pivot[0], -sp.pivot[1]); else ctx.drawImage(image, r[0], r[1], r[2], r[3], -sp.pivot[0], -sp.pivot[1], r[2], r[3]);
      ctx.restore();
    }
    ctx.restore();
  }
  return { sample: sample, draw: draw };
});
