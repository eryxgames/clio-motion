// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
/* Baker. Records clips from the motion core and writes them out as
   - a pixel sprite sheet (RGBA) with a JSON atlas,
   - a glTF 2.0 binary (.glb) with one animation per clip,
   - sprite frames in CLIo's sprites.json form.
   No DOM and no Node APIs: the same file runs in the bench page and in the command-line tool. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GaitBake = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return function make(M, R) {
    var G = M.G, DT = 1 / 120;
    var DEF_STYLE = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 };
    function flat() { return 0; }
    function walkSpeed(c) { return Math.round(Math.sqrt(0.22 * G * c.L) * 20) / 20; }
    function runSpeed(c) { return c.gait.run ? Math.min(c.vmax, Math.round(Math.sqrt(1.7 * G * c.L) * 20) / 20) : c.vmax; }
    function clipNames(ch) { var n = clipBase(ch).filter(function (c) { return c !== 'sting' || ch.tail; }), at; n.splice(n.indexOf('walk') + 1, 0, 'back', 'left', 'right'); at = n.indexOf('hit'); if (ch.fly) n.splice(at, 0, 'fly'); if (ch.fly && ch.fly.hover) n.splice(at + 1, 0, 'hover'); return n; }
    function clipBase(ch) { return ch.octo ? ['idle', 'walk', 'sneak', 'attack', 'swim', 'hover', 'hit', 'turn', 'die'] : ch.arthro ? ['idle', 'walk', 'run', 'sneak', 'attack', 'sting', 'hit', 'turn', 'die'] : ch.beast ? ['idle', 'walk', 'run', 'gallop', 'sneak', 'jump', 'attack', 'pounce', 'hit', 'turn', 'die'] : ch.kind === 'biped' ? ['idle', 'walk', 'run', 'sneak', 'jump', 'attack', 'reload', 'chop', 'thrust', 'block', 'throw', 'pickup', 'carry', 'putdown', 'guard', 'jab', 'cross', 'hook', 'hit', 'turn', 'climb', 'hang', 'climbup', 'die'] : ['idle', 'walk', 'run', 'sneak', 'jump', 'attack', 'hit', 'turn', 'die']; }

    // ------------------------------------------------------------ recording
    // Every clip is recorded in place (the forward travel is removed) on flat ground.
    // Looping clips cover exactly one cycle, so the last frame leads back into the first.
    function record(ch, name, o) {
      o = o || {};
      var st = o.style || DEF_STYLE, N = o.frames || 8, env = { terrain: flat, ladder: null };
      var S = M.createState(ch, env), y0 = null;
      var inp = { speed: 0, crouch: 0, aim: null, fire: false, armed: o.armed !== false, jump: false, die: null, hit: null, heading: null, reload: false, kit: null };
      function step(dt) { if (o.aimAt) inp.aim = o.aimAt(S); M.step(S, ch, inp, st, env, dt); S.events.length = 0; }
      function run(sec) { for (var n = Math.round(sec / DT), i = 0; i < n; i++) step(DT); }
      var lastCarry = null;
      function grab() {
        if (y0 === null) y0 = S.y;
        var dy = name === 'climb' || name === 'hang' || name === 'climbup' ? y0 - S.y : 0, p = R.shiftPose(S.pose, -S.px, dy, -S.pz); p.ladderShift = dy;
        // a crate that has been set down stays in the picture to the end of the clip
        if (p.carry) lastCarry = p.carry; else if (lastCarry && name === 'putdown') { p.carry = { c: lastCarry.c, f: lastCarry.f, u: lastCarry.u, side: lastCarry.side, size: lastCarry.size, held: false }; }
        return p;
      }
      function cycle(T) {
        var sub = Math.max(1, Math.round(T / N / DT)), dt = T / (N * sub), fr = [];
        for (var k = 0; k < N; k++) { fr.push(grab()); for (var j = 0; j < sub; j++) step(dt); }
        return fr;
      }
      function toWrap() { var prev, guard = 0; do { prev = S.phase; step(DT); } while (S.phase >= prev && guard++ < 4000); }
      function timed(sec, fps) {
        var fr = [], per = Math.round(1 / fps / DT), n = Math.round(sec * fps);
        for (var k = 0; k < n; k++) { fr.push(grab()); for (var j = 0; j < per; j++) step(DT); }
        return fr;
      }
      // record at a steady rate until done() says so, plus a few frames more
      function untilDone(done, extra, rate) {
        var fr = [], per = Math.round(1 / (o.fps || rate || 12) / DT), end = 0;
        while (fr.length < 80 && end <= extra) { fr.push(grab()); for (var j = 0; j < per; j++) step(DT); if (done()) end++; }
        return fr;
      }
      var frames, dur, loop = true, speed = 0, travel = 0, rise = 0;
      if (o.kit && M.KITS[o.kit] && S.kit && o.kit !== S.kit) { inp.kit = o.kit; run(1.5); }      // put the default weapons away and bring this kit up
      if (name === 'idle') { run(4); dur = M.idlePeriod(ch); frames = cycle(dur); }
      else if (name === 'walk' || name === 'run' || name === 'sneak' || name === 'gallop' || name === 'back' || name === 'left' || name === 'right') {
        if (name === 'gallop' && !ch.gait.gallop) return null;
        // walking backwards and stepping sideways are asked for at the walking pace; the core itself slows them
        if (name === 'back') inp.dir = Math.PI; else if (name === 'left') inp.dir = -Math.PI / 2; else if (name === 'right') inp.dir = Math.PI / 2;
        inp.speed = name === 'gallop' ? 0.75 * ch.vmax : name === 'run' ? runSpeed(ch) : name === 'sneak' ? 0.7 * walkSpeed(ch) : walkSpeed(ch);
        inp.crouch = name === 'sneak' ? 0.6 : 0;
        run(8); toWrap(); dur = S.stats.period; speed = S.v; frames = cycle(dur);
      } else if (name === 'jump') {
        run(3); inp.jump = true; step(DT); inp.jump = false;
        var fps = o.fps || 12, per = Math.round(1 / fps / DT), tail = 0; frames = [];
        while (frames.length < 40 && tail < 2) { frames.push(grab()); for (var j = 0; j < per; j++) step(DT); if (!S.jump) tail++; }
        dur = frames.length / fps; loop = false;
      } else if (name === 'attack') {
        if (ch.mount.civil) return null;                                     // people in plain clothes have no weapon to attack with (they have fists: guard, jab, cross, hook)
        inp.aim = [1e4, 0]; run(2); inp.aim = [1e4, S.y + 0.3 * ch.L]; run(1);
        if (ch.beast) { inp.bite = {}; step(DT); inp.bite = null; }          // an animal's attack is its bite
        else if (ch.arthro && ch.arthro.claw) { inp.pinch = {}; step(DT); inp.pinch = null; }  // a scorpion's is its claw, a mantis's both forelegs
        else if (ch.arthro) { inp.sting = {}; step(DT); inp.sting = null; }  // a wasp's is its sting
        else if (ch.octo) { inp.grab = {}; step(DT); inp.grab = null; }      // an octopus's is an arm shot out to grab
        else if (S.kit === 'sword') { inp.swing = { kind: 'slash' }; step(DT); inp.swing = null; }
        else if (M.KITS[S.kit] && (M.KITS[S.kit].spin || M.KITS[S.kit].stream)) inp.fire = true;         // a chaingun: the trigger is held while the barrels come up, and through the burst; a launcher is steadied first; a flamethrower streams
        else { inp.fire = true; step(DT); inp.fire = false; }
        dur = S.kit === 'sword' ? 0.75 : inp.fire ? 1.0 : 0.5; frames = timed(dur, o.fps || 12); loop = false; inp.fire = false;
      } else if (name === 'chop' || name === 'thrust' || name === 'block') {
        // only with sword and shield: the other two swings, and the shield brought up and held
        if (S.kit !== 'sword') return null;
        run(2);
        if (name === 'block') { inp.block = true; frames = timed(0.5, o.fps || 12); dur = 0.5; loop = false; }
        else { inp.swing = { kind: name }; step(DT); inp.swing = null; frames = timed(0.75, o.fps || 12); dur = 0.75; loop = false; }
      } else if (name === 'fly' || (name === 'hover' && ch.fly)) {
        // in the air: one wingbeat at cruising speed, or (for those that can) one hanging in place
        if (!ch.fly) return null;
        run(1); M.enterFly(S, ch, env); inp.height = 0.8 * ch.fly.height; inp.speed = name === 'fly' ? 0.55 * ch.fly.vmax : 0; run(8); toWrap();
        dur = S.stats.period; speed = S.v; frames = cycle(dur); y0 = null;
      } else if (name === 'swim' || name === 'hover') {
        // in the water: one jet cycle at cruising speed, or hanging in place with the arms spread
        if (!ch.octo) return null;
        run(1); M.enterSwim(S, ch, env); inp.depth = 0.9; inp.speed = name === 'swim' ? 0.55 * ch.octo.vswim : 0; run(8);
        if (name === 'swim') { toWrap(); dur = S.stats.period; speed = inp.speed; } else dur = 5.2;
        frames = cycle(dur);
      } else if (name === 'sting') {
        if (!ch.arthro) return null;
        run(3); inp.sting = {}; step(DT); inp.sting = null;
        frames = untilDone(function () { return !S.act; }, 2); dur = frames.length / (o.fps || 12); loop = false;
      } else if (name === 'pounce') {
        // a leap of about three and a half leg lengths; the clip is in place, and its travel is given with it
        if (!ch.beast) return null;
        run(3); var px0 = S.px; inp.pounce = {}; step(DT); inp.pounce = null;
        frames = untilDone(function () { return !S.jump && S.v < 0.05; }, 2); dur = frames.length / (o.fps || 12); loop = false; travel = S.px - px0;
      } else if (name === 'reload') {
        // with empty magazines, so every weapon of the kit is reloaded in turn
        if (!S.ammo || (S.kit && M.KITS[S.kit].melee)) return null;
        inp.aim = [1e4, 0]; run(2); inp.aim = [1e4, S.y + 0.3 * ch.L]; run(1);                 // weapons up and level, as when firing
        S.ammo = S.ammo.map(function () { return 0; }); inp.reload = true; step(DT); inp.reload = false;
        var fpsR = o.fps || 12, perR = Math.round(1 / fpsR / DT), endR = 0, jr; frames = [];
        while (frames.length < 60 && endR < 2) { frames.push(grab()); for (jr = 0; jr < perR; jr++) step(DT); if (!S.act) endR++; }
        dur = frames.length / fpsR; loop = false;
      } else if (name === 'throw') {
        if (ch.kind !== 'biped' || ch.mount.civil) return null;
        inp.aim = [1e4, 0]; run(2); inp.aim = [1e4, S.y + 0.3 * ch.L]; run(1);
        inp.throw = { target: [9 * ch.L, 0, 0] }; step(DT); inp.throw = null;
        frames = untilDone(function () { return !S.act; }, 2); dur = frames.length / (o.fps || 12); loop = false;
      } else if (name === 'pickup' || name === 'carry' || name === 'putdown') {
        // a crate from the ground in front: squat, lift, walk with it, set it down again
        if (ch.kind !== 'biped') return null;
        run(2); inp.pickup = {}; step(DT); inp.pickup = null;
        if (name === 'pickup') { frames = untilDone(function () { return !S.act; }, 2); dur = frames.length / (o.fps || 12); loop = false; }
        else {
          run(2.5);
          if (name === 'carry') { inp.speed = walkSpeed(ch); run(8); toWrap(); dur = S.stats.period; speed = S.v; frames = cycle(dur); }
          else { inp.putdown = true; step(DT); inp.putdown = false; frames = untilDone(function () { return !S.act && !S.carry && S.armed.x > (inp.armed ? 0.97 : -1); }, 2); dur = frames.length / (o.fps || 12); loop = false; }
        }
      } else if (name === 'guard' || M.PUNCH[name]) {
        // fists up in a fighting stance; the punches go straight ahead at head height and come back to the guard
        if (ch.kind !== 'biped' || !ch.fight) return null;
        inp.guard = true; run(4);
        if (name === 'guard') { dur = M.idlePeriod(ch); frames = cycle(dur); }
        else { inp.punch = { kind: name }; step(DT); inp.punch = null; frames = untilDone(function () { return !S.act; }, 1, 24); dur = frames.length / (o.fps || 24); loop = false; }
      } else if (name === 'hit') {
        // a blow from the front that staggers but does not floor: recorded until the body has settled
        run(3); inp.hit = { impulse: o.hitImpulse || [-1.6, 0, 0] }; step(DT); inp.hit = null;
        frames = timed(1.0 * Math.sqrt(ch.L / 0.92), o.fps || 12); dur = frames.length / (o.fps || 12); loop = false;
      } else if (name === 'turn') {
        // turn round on the spot: ends facing the other way
        run(3); inp.heading = Math.PI;
        var fpsT = o.fps || 12, perT = Math.round(1 / fpsT / DT), settled = 0, jt; frames = [];
        while (frames.length < 60 && settled < 3) {
          frames.push(grab()); for (jt = 0; jt < perT; jt++) step(DT);
          if (Math.abs(M.wrapPi(Math.PI - S.h)) < 0.02 && !S.legs.some(function (l) { return l.swing; })) settled++;
        }
        dur = frames.length / fpsT; loop = false;
      } else if (name === 'die') {
        // a blow from the front, then the ragdoll runs until it lies still
        run(2); inp.die = { impulse: o.impulse || [-2.4, 1.0] }; step(DT); inp.die = null;
        var fpsD = o.fps || 12, perD = Math.round(1 / fpsD / DT), rest = 0, jd; frames = [];
        while (frames.length < 48 && rest < 3) { frames.push(grab()); for (jd = 0; jd < perD; jd++) step(DT); if (S.rag && S.rag.asleep) rest++; }
        dur = frames.length / fpsD; loop = false;
      } else if (name === 'hang' || name === 'climbup') {
        // hanging from a ledge, and the climb up onto it. Both are in place: the atlas gives how far the climb moves the body, forwards and up
        if (ch.kind !== 'biped') return null;
        run(2); M.grabLedge(S, ch, env, [S.px + 0.38, 2.3, S.pz]); run(2); y0 = null;
        if (name === 'hang') { dur = 2.6; frames = cycle(dur); }
        else { var hx = S.px, hy = S.y; inp.climb = true; step(DT); inp.climb = false; frames = untilDone(function () { return S.mode !== 'ledge' || S.ledge.t > 0.95 * 1.5 * Math.sqrt(ch.L / 0.92); }, 0); dur = frames.length / (o.fps || 12); loop = false; travel = S.px - hx; rise = S.y - hy; }
      } else if (name === 'climb') {
        if (ch.kind !== 'biped') return null;
        env.ladder = { x: 0.36, y0: 0, spacing: 0.3, rung: function (k) { return k * 0.3; } };
        run(0.5); M.enterLadder(S, ch, env); inp.speed = 2.5; run(4); toWrap();
        dur = S.stats.period; speed = S.v; frames = cycle(dur);
      } else return null;
      return { name: name, frames: frames, duration: dur, loop: loop, speed: speed, travel: travel, rise: rise, ladder: name === 'climb' };
    }
    function recordAll(ch, o) {
      var out = [];
      clipNames(ch).forEach(function (n) { if (!o || !o.clips || o.clips.indexOf(n) >= 0) { var c = record(ch, n, o); if (c) out.push(c); } });
      return out;
    }

    // ---------------------------------------------------------- rasteriser
    // Hard-edged, no anti-aliasing: a pixel belongs to a part when its centre is inside it.
    // pal collects every colour used, so a whole sheet shares one palette.
    function newPalette() { return { list: [], map: {} }; }
    function palIndex(pal, key, rgb) {
      var i = pal.map[key];
      if (i === undefined) { pal.list.push(rgb); i = pal.map[key] = pal.list.length; }
      return i;
    }
    function rasterize(prims, P, w, h, dz, pal, outline) {
      var idx = new Uint8Array(w * h), sorted = R.order(prims, R.projector(P), null), i, q;
      for (i = 0; i < sorted.length; i++) {
        q = sorted[i];
        var c = R.shade(q.col, R.level(q)), ci = palIndex(pal, c.key, c.rgb);
        var r = Math.max(q.r * P.ppm, 0.62), ax = q.pa[0], ay = q.pa[1], bx = q.pb ? q.pb[0] : ax, by = q.pb ? q.pb[1] : ay;
        var x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r));
        var y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
        var ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey, r2 = r * r;
        for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
          var px = x + 0.5 - ax, py = y + 0.5 - ay, t = l2 > 1e-9 ? (px * ex + py * ey) / l2 : 0;
          if (q.sq && (t < 0 || t > 1)) continue;                      // square-ended: nothing beyond the ends
          t = Math.max(0, Math.min(1, t));
          var dx = px - t * ex, dy = py - t * ey;
          if (dx * dx + dy * dy <= r2) idx[y * w + x] = ci;
        }
      }
      if (outline !== false) {
        var oi = palIndex(pal, 'outline', [22, 24, 29]), solid = idx.slice();
        for (i = 0; i < solid.length; i++) {
          if (solid[i]) continue;
          var X = i % w, Y = (i / w) | 0;
          if ((X > 0 && solid[i - 1]) || (X < w - 1 && solid[i + 1]) || (Y > 0 && solid[i - w]) || (Y < h - 1 && solid[i + w])) idx[i] = oi;
        }
      }
      return idx;
    }
    function framePrims(ch, clip, pose) {
      var prims = R.buildPrims(pose, ch);
      if (clip && clip.ladder) { var off = (pose.ladderShift || 0) - 30; R.ladderPrims(prims, { x: 0.36, y0: off, spacing: 0.3, rung: function (k) { return off + k * 0.3; } }, pose.root[1] - 4, pose.root[1] + 4); }
      return prims;
    }
    function spriteView(ch, fw, fh, pose, ladder) {
      var sp = R.SPRITE[ch.id];
      return { cx: sp.cx, cy: ladder ? pose.root[1] - ch.rootHeight - 0.1 : 0, ppm: sp.ppm * fw / 64, yaw: 0, pit: 0, ox: fw / 2, oy: fh - 4 };
    }

    // --------------------------------------------------------- sprite sheet
    // o.render(pose, clip) may supply the pixels of a frame instead (the bench uses this for image parts).
    function sheet(ch, clips, o) {
      o = o || {};
      var fw = o.fw || 64, fh = o.fh || 64, cols = o.cols || 8, pal = newPalette(), rows = 0, cells = [];
      clips.forEach(function (c) { c.frames.forEach(function (f, i) { cells.push({ clip: c, i: i, col: i % cols, row: rows + ((i / cols) | 0) }); }); rows += Math.ceil(c.frames.length / cols); });
      var W = fw * cols, H = fh * rows, rgba = new Uint8Array(W * H * 4), frames = {}, anims = {}, tags = [], n = 0;
      clips.forEach(function (c) { tags.push({ name: c.name, from: n, to: n + c.frames.length - 1, direction: 'forward', loop: c.loop }); n += c.frames.length; anims[c.name] = []; });
      cells.forEach(function (cell) {
        var c = cell.clip, pose = c.frames[cell.i], ox = cell.col * fw, oy = cell.row * fh, x, y, k;
        if (o.render) {
          var px = o.render(pose, c, fw, fh);
          for (y = 0; y < fh; y++) for (x = 0; x < fw; x++) { k = ((oy + y) * W + ox + x) * 4; var s = (y * fw + x) * 4; rgba[k] = px[s]; rgba[k + 1] = px[s + 1]; rgba[k + 2] = px[s + 2]; rgba[k + 3] = px[s + 3]; }
        } else {
          var idx = rasterize(framePrims(ch, c, pose), spriteView(ch, fw, fh, pose, c.ladder), fw, fh, R.SPRITE[ch.id].dz, pal);
          for (y = 0; y < fh; y++) for (x = 0; x < fw; x++) {
            var v = idx[y * fw + x]; if (!v) continue;
            k = ((oy + y) * W + ox + x) * 4; var col = pal.list[v - 1]; rgba[k] = col[0]; rgba[k + 1] = col[1]; rgba[k + 2] = col[2]; rgba[k + 3] = 255;
          }
        }
        var name = c.name + '_' + cell.i;
        frames[name] = { frame: { x: ox, y: oy, w: fw, h: fh }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: fw, h: fh },
          sourceSize: { w: fw, h: fh }, duration: Math.round(1000 * c.duration / c.frames.length) };
        anims[c.name].push(name);
      });
      var info = {};
      clips.forEach(function (c) { info[c.name] = { loop: c.loop, seconds: +c.duration.toFixed(4), metresPerSecond: +c.speed.toFixed(3) }; if (c.travel) info[c.name].metres = +c.travel.toFixed(3); if (c.rise) info[c.name].metresUp = +c.rise.toFixed(3); });
      var atlas = { frames: frames, animations: anims, meta: { app: 'Gait Bench', version: '0.2', image: (o.image || ch.id + '_sheet.png'), format: 'RGBA8888',
        size: { w: W, h: H }, scale: '1', frameTags: tags, pivot: { x: 0.5, y: (fh - 4) / fh }, pixelsPerMetre: +(R.SPRITE[ch.id].ppm * fw / 64).toFixed(2), clips: info } };
      return { rgba: rgba, w: W, h: H, atlas: atlas };
    }

    // ---------------------------------------------------------------- cutout
    // The character as a 2D cutout: every part a picture of its own, and for every clip where each picture is, frame
    // by frame. A game plays it by moving the pictures (js/cutout.js shows how), so the motion is smooth at any frame
    // rate and the pictures can be swapped. Seen from the right side, in place, like the sprite sheet.
    //   o.parts   pictures by part name, as a drawing gives them (drawing.js); each needs its pixels as rgba
    //             (w * h * 4 bytes) or a canvas img. Parts without a picture, and everything else, are plain shapes.
    //   o.ppm     pixels to a metre for the plain shapes (default: the character about 512 pixels tall)
    // Returns { json, rgba, w, h }: the description (see js/README.md) and the atlas the pictures are packed in.
    function capsulePixels(L, rp, rgb, sq, m) {
      var w = Math.ceil(L + 2 * rp) + 2 * m, h = Math.ceil(2 * rp) + 2 * m, px = new Uint8Array(w * h * 4), x, y, cy = m + rp, x0 = m + rp, x1 = m + rp + L;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var fx = x + 0.5, fy = y + 0.5, d;
        if (sq) d = Math.max(Math.abs(fy - cy) - rp, m + 0.0 - (fx - m) > 0 ? m - fx : fx - (m + L + 2 * rp)) + rp;          // a box from end to end
        else { var qx = fx < x0 ? x0 : fx > x1 ? x1 : fx; d = Math.sqrt((fx - qx) * (fx - qx) + (fy - cy) * (fy - cy)); }
        var a = rp - d + 0.5; if (a <= 0) continue;
        var k = (y * w + x) * 4; px[k] = rgb[0]; px[k + 1] = rgb[1]; px[k + 2] = rgb[2]; px[k + 3] = Math.round(255 * (a > 1 ? 1 : a));
      }
      return { w: w, h: h, rgba: px };
    }
    function packRects(sizes, pad) {        // shelves, tallest first
      var area = 0, widest = 0, idx = sizes.map(function (s, i) { area += (s[0] + pad) * (s[1] + pad); widest = Math.max(widest, s[0]); return i; });
      idx.sort(function (a, b) { return (sizes[b][1] - sizes[a][1]) || (a - b); });
      var W = 64; while (W < widest + 2 * pad || W * W < area * 1.25) W *= 2;
      var at = new Array(sizes.length), x = pad, y = pad, shelf = 0;
      idx.forEach(function (i) {
        var s = sizes[i];
        if (x + s[0] + pad > W) { x = pad; y += shelf + pad; shelf = 0; }
        at[i] = [x, y]; x += s[0] + pad; shelf = Math.max(shelf, s[1]);
      });
      return { w: W, h: y + shelf + pad, at: at };
    }
    function cutout(ch, clips, o) {
      o = o || {};
      var parts = o.parts || null, ppm = o.ppm || Math.round(512 / R.SPRITE[ch.id].tall), M2 = 2, name = o.name || ch.id;
      var proj = R.projector({ cx: 0, cy: 0, cz: 0, yaw: 0, pit: 0, ppm: 1, ox: 0, oy: 0 });          // x forward, y down, metres, the ground at 0
      var first = R.buildPrims(clips[0].frames[0], ch, { flash: false, model: true }), n = first.length;
      var images = [], imgOf = {}, sprites = [], spriteOf = [], i;
      function r5(v) { return Math.round(v * 1e5) / 1e5 + 0; }
      first.forEach(function (q, k) {
        spriteOf[k] = -1;
        if (parts && q.of && parts[q.of]) return;
        var key, im, sp;
        if (parts && q.part && parts[q.part]) {
          im = parts[q.part]; key = 'p:' + q.part;
          if (imgOf[key] === undefined) { imgOf[key] = images.length; images.push({ part: q.part, w: im.w, h: im.h, src: im }); }
          var bx = im.box, pv = bx ? [-bx[0] * im.w / (bx[2] - bx[0]), -bx[1] * im.h / (bx[3] - bx[1])] : im.axis === 'ball' || !(q.end || q.b) ? [im.w / 2, im.h / 2] : im.axis === 'right' ? [0, im.h / 2] : [im.w / 2, 0];
          sp = { name: q.g + '/' + q.part, part: q.part, joint: q.j, image: imgOf[key], pivot: pv, prim: k };
        } else {
          var d = q.b ? [q.b[0] - q.a[0], q.b[1] - q.a[1], q.b[2] - q.a[2]] : null, L = d ? Math.round(Math.sqrt(dot3(d, d)) * ppm) : 0, rp = Math.max(Math.round(q.r * ppm * 4) / 4, 0.75);
          key = 's:' + L + ':' + rp + ':' + q.col + (q.sq ? 'q' : '') + (q.b ? '' : 'o');
          if (imgOf[key] === undefined) { var cp = capsulePixels(L, rp, R.shade(q.col, -1).rgb, !!q.sq && !!q.b, M2); imgOf[key] = images.length; images.push({ w: cp.w, h: cp.h, rgba: cp.rgba, L: L, rp: rp }); }
          sp = { name: q.g + '/' + (q.part || q.of || 'shape'), part: null, joint: q.j, image: imgOf[key], pivot: [M2 + rp, M2 + rp], capsule: [L, rp], prim: k };
        }
        spriteOf[k] = sprites.length; sprites.push(sp);
      });
      // the atlas
      var pk = packRects(images.map(function (im) { return [im.w, im.h]; }), 1), W = pk.w, H = pk.h, rgba = new Uint8Array(W * H * 4), missing = [];
      images.forEach(function (im, k) {
        var px = im.rgba, x, y;
        if (!px && im.src) px = im.src.rgba || (im.src.img && im.src.img.getContext ? im.src.img.getContext('2d').getImageData(0, 0, im.w, im.h).data : null);
        if (!px) { missing.push(im.part); return; }
        for (y = 0; y < im.h; y++) rgba.set(px.subarray ? px.subarray(y * im.w * 4, (y + 1) * im.w * 4) : px.slice(y * im.w * 4, (y + 1) * im.w * 4), ((pk.at[k][1] + y) * W + pk.at[k][0]) * 4);
      });
      if (missing.length) throw new Error('No pixels were given for the picture of: ' + missing.join(', '));
      var json = { format: 'clio-motion-cutout', version: 1, id: ch.id, name: name, image: name + '_cutout.png', size: [W, H],
        axes: 'x forward (to the right), y down, metres; the ground under the body is y = 0. Angles in radians, clockwise on the screen.',
        frame: ['x', 'y', 'angle', 'scaleX', 'scaleY', 'order', 'tint'],
        sprites: sprites.map(function (sp) {
          var im = images[sp.image], at = pk.at[sp.image], o2 = { name: sp.name, part: sp.part, joint: sp.joint, rigPart: sp.prim, rect: [at[0], at[1], im.w, im.h], pivot: [r5(sp.pivot[0]), r5(sp.pivot[1])] };
          if (sp.capsule) o2.capsule = sp.capsule;          // a plain shape: its length between the round ends and its radius, in picture pixels
          return o2;
        }),
        clips: {} };
      // for drawing live instead of from the clips: each drawn part's picture, as partPlace wants it
      json.pictures = {};
      images.forEach(function (im, k) { if (im.part) { var s2 = im.src, at = pk.at[k]; json.pictures[im.part] = { rect: [at[0], at[1], im.w, im.h], axis: s2.axis }; if (s2.box) { json.pictures[im.part].box = s2.box.map(r5); json.pictures[im.part].len = r5(s2.len); json.pictures[im.part].r = r5(s2.r); } } });
      clips.forEach(function (c) {
        // a climb is in place: the body is brought down to where it would stand
        var frames = [], ok = true, lift = c.ladder ? c.frames[0].root[1] - ch.rootHeight - 0.1 : 0;
        c.frames.forEach(function (pose) {
          var prims = R.buildPrims(pose, ch, { flash: false, model: true });
          if (prims.length !== n) { ok = false; return; }
          var items = R.sprites(prims, proj, 1, parts), row = new Array(sprites.length);
          items.forEach(function (it, z) {
            var q = it.q, sp = spriteOf[q.i], S = sprites[sp], im = images[S.image], x, y, ang, sx, sy, tint;
            if (it.kind === 'part') {
              var at = it.at, lx = at.fx * (at.dx + S.pivot[0] * at.dw / im.w), ly = at.fy * (at.dy + S.pivot[1] * at.dh / im.h), cs = Math.cos(at.rot), sn = Math.sin(at.rot);
              x = at.x + cs * lx - sn * ly; y = at.y + sn * lx + cs * ly; ang = at.rot; sx = at.fx * at.dw / im.w; sy = at.fy * at.dh / im.h; tint = it.dark ? 0.68 : 1;
            } else {
              var a = q.pa, b = q.pb, ex = b ? b[0] - a[0] : 0, ey = b ? b[1] - a[1] : 0, dist = Math.sqrt(ex * ex + ey * ey), lv = R.level(q);
              ang = dist > 1e-9 ? Math.atan2(ey, ex) : 0; sy = q.r / im.rp; sx = b ? (dist + 2 * q.r) / (im.L + 2 * im.rp) : sy;
              var off = b ? -q.r + im.rp * sx : 0;                  // the picture's pivot is the middle of its first round end
              x = a[0] + Math.cos(ang) * off; y = a[1] + Math.sin(ang) * off; tint = lv < 0 ? 1 : 0.6 + 0.1 * lv;
            }
            row[sp] = [r5(x), r5(y + lift), r5(ang), +sx.toPrecision(6), +sy.toPrecision(6), z, Math.round(tint * 100) / 100];
          });
          frames.push(row);
        });
        if (!ok) return;
        var nF = frames.length, info = { loop: c.loop, seconds: +c.duration.toFixed(4), metresPerSecond: +c.speed.toFixed(3), times: [], frames: frames };
        for (i = 0; i < nF; i++) info.times.push(+(c.duration * i / nF).toFixed(5));
        if (c.travel) info.metres = +c.travel.toFixed(3);
        if (c.rise) info.metresUp = +c.rise.toFixed(3);
        json.clips[c.name] = info;
      });
      return { json: json, rgba: rgba, w: W, h: H };
    }

    // ----------------------------------------------------------------- CLIo
    // CLIo draws a sprite as rows of palette letters, with optional "walk" and "attack" drawings
    // of the same size. Its first-person levels show monsters from the front, so that is the default view.
    var LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    function clio(ch, clips, o) {
      o = o || {};
      var size = o.size || 28, front = o.view !== 'side', sp = R.SPRITE[ch.id], ppm = size / sp.tall, W = Math.round(size * 2.4), H = Math.round(size * 1.5);
      var P = { cx: front ? 0 : sp.cx, cy: 0, ppm: ppm, yaw: front ? -Math.PI / 2 : 0, pit: 0, ox: W / 2, oy: H - 2 };
      var dz = front ? 0.6 * ch.L : sp.dz, pal = newPalette(), by = {}, shots = [], muzzle = null;
      clips.forEach(function (c) { by[c.name] = c; });
      function shot(pose, flash) { var prims = R.buildPrims(pose, ch, { flash: flash }); var g = rasterize(prims, P, W, H, dz, pal, o.outline); shots.push(g); return g; }
      var stand = shot(by.idle.frames[0], false), walk = [], attack = null, wN = o.walkFrames || 4, i;
      if (by.walk) for (i = 0; i < wN; i++) walk.push(shot(by.walk.frames[Math.floor(i * by.walk.frames.length / wN)], false));
      if (by.attack) {
        var ap = by.attack.frames[ch.beast || ch.arthro || ch.octo ? Math.round(0.3 * by.attack.frames.length) : Math.min(1, by.attack.frames.length - 1)]; attack = shot(ap, true);
        var tip = ap.props && ap.props.length ? ap.props[0].muzzle : ap.mounts && ap.mounts[0].tip;
        if (tip) muzzle = R.projector(P)(tip);
      }
      // crop every drawing to the same box
      var x0 = W, x1 = -1, y0 = H, y1 = -1;
      shots.forEach(function (g) { for (var k = 0; k < g.length; k++) if (g[k]) { var x = k % W, y = (k / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } });
      if (pal.list.length > LETTERS.length) throw new Error('too many colours for a letter palette');
      function rowsOf(g) { var rows = []; for (var y = y0; y <= y1; y++) { var s = ''; for (var x = x0; x <= x1; x++) { var v = g[y * W + x]; s += v ? LETTERS[v - 1] : '.'; } rows.push(s); } return rows; }
      var palette = {};
      pal.list.forEach(function (c, k) { palette[LETTERS[k]] = '#' + c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join(''); });
      var spr = { palette: palette, pixels: rowsOf(stand) };
      if (walk.length) spr.walk = walk.map(rowsOf);
      if (attack) { spr.attack = rowsOf(attack); if (muzzle) spr.muzzle = [Math.max(0, Math.min(x1 - x0, Math.round(muzzle[0]) - x0)), Math.max(0, Math.min(y1 - y0, Math.round(muzzle[1]) - y0))]; }
      var res = {}; res[o.name || ch.id] = spr; return res;
    }

    // ----------------------------------------------------------------- glTF
    // Each rig part becomes one small mesh on its own node; every clip is a node animation.
    // glTF axes: +Y up, +Z forward, +X to the model's left. Ours: x forward, y up, z right.
    function conv(p) { return [-p[2], p[1], p[0]]; }
    function capsuleMesh(len, r) {
      var seg = 8, rings = 3, pos = [], nor = [], ind = [], lat = [], i, j;
      for (i = 0; i <= rings; i++) lat.push([-Math.PI / 2 + (Math.PI / 2) * i / rings, -len / 2]);
      for (i = 0; i <= rings; i++) lat.push([(Math.PI / 2) * i / rings, len / 2]);
      for (i = 0; i < lat.length; i++) for (j = 0; j < seg; j++) {
        var ph = lat[i][0], th = 2 * Math.PI * j / seg, cx = Math.cos(ph) * Math.cos(th), cy = Math.sin(ph), cz = Math.cos(ph) * Math.sin(th);
        pos.push(r * cx, lat[i][1] + r * cy, r * cz); nor.push(cx, cy, cz);
      }
      for (i = 0; i + 1 < lat.length; i++) for (j = 0; j < seg; j++) {
        var a = i * seg + j, b = i * seg + (j + 1) % seg, c = (i + 1) * seg + j, d = (i + 1) * seg + (j + 1) % seg;
        if (len < 1e-6 && i === rings) continue;            // a ball has no cylinder band
        if (i > 0) ind.push(a, c, b);                       // skip the collapsed triangles at the poles
        if (i + 2 < lat.length) ind.push(b, c, d);
      }
      return { pos: pos, nor: nor, ind: ind };
    }
    function quatFromY(dir, ref) {
      var d = ref[0] * dir[0] + ref[1] * dir[1] + ref[2] * dir[2];
      var x = [ref[0] - dir[0] * d, ref[1] - dir[1] * d, ref[2] - dir[2] * d], xl = Math.sqrt(x[0] * x[0] + x[1] * x[1] + x[2] * x[2]);
      if (xl < 1e-5) return null;
      x = [x[0] / xl, x[1] / xl, x[2] / xl];
      var z = [x[1] * dir[2] - x[2] * dir[1], x[2] * dir[0] - x[0] * dir[2], x[0] * dir[1] - x[1] * dir[0]];
      var m00 = x[0], m10 = x[1], m20 = x[2], m01 = dir[0], m11 = dir[1], m21 = dir[2], m02 = z[0], m12 = z[1], m22 = z[2];
      var tr = m00 + m11 + m22, q, s;
      if (tr > 0) { s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]; }
      else if (m00 > m11 && m00 > m22) { s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
      else if (m11 > m22) { s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]; }
      else { s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]; }
      var n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
      return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
    }
    function srgbToLinear(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }

    // side and forward reference directions for a pose, in glTF axes: they turn with the model
    function refsFor(prims) { var h = prims.heading || 0, c = Math.cos(h), s = Math.sin(h); return { lat: conv([s, 0, -c]), fwd: conv([c, 0, s]) }; }
    function glb(ch, clips, o) {
      o = o || {};
      var rest = R.buildPrims(clips[0].frames[0], ch, { flash: false, model: true }), np = rest.length;
      var chunks = [], byteLen = 0, views = [], accs = [];
      function pushData(typed, target) {
        var pad = (4 - byteLen % 4) % 4; if (pad) { chunks.push(new Uint8Array(pad)); byteLen += pad; }
        var u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
        views.push(target ? { buffer: 0, byteOffset: byteLen, byteLength: u8.length, target: target } : { buffer: 0, byteOffset: byteLen, byteLength: u8.length });
        chunks.push(u8); byteLen += u8.length; return views.length - 1;
      }
      function acc(typed, type, comp, target, minmax) {
        var size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type], a = { bufferView: pushData(typed, target), componentType: comp, count: typed.length / size, type: type };
        if (minmax) {
          var mn = [], mx = [], k, i;
          for (k = 0; k < size; k++) { mn.push(Infinity); mx.push(-Infinity); }
          for (i = 0; i < typed.length; i++) { k = i % size; if (typed[i] < mn[k]) mn[k] = typed[i]; if (typed[i] > mx[k]) mx[k] = typed[i]; }
          a.min = mn; a.max = mx;
        }
        accs.push(a); return accs.length - 1;
      }
      var mats = [], matOf = {}, meshes = [], nodes = [], refs = [], restLen = [], i, q;
      function material(q) {
        var key = q.col + (q.raw ? 'g' : '');
        if (matOf[key] === undefined) {
          var n = parseInt(q.col.slice(1), 16), lin = [srgbToLinear((n >> 16) & 255), srgbToLinear((n >> 8) & 255), srgbToLinear(n & 255)];
          var m = { name: 'c_' + q.col.slice(1) + (q.raw ? '_glow' : ''), pbrMetallicRoughness: { baseColorFactor: [lin[0], lin[1], lin[2], 1], metallicFactor: 0.1, roughnessFactor: 0.8 } };
          if (q.raw) m.emissiveFactor = lin;
          matOf[key] = mats.length; mats.push(m);
        }
        return matOf[key];
      }
      function place(q) {
        var a = conv(q.a), b = q.b ? conv(q.b) : a, d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
        return { t: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], len: l, dir: l > 1e-6 ? [d[0] / l, d[1] / l, d[2] / l] : [0, 1, 0] };
      }
      var counts = {};
      for (i = 0; i < np; i++) {
        q = rest[i];
        var pl = place(q), mesh = capsuleMesh(pl.len, q.r);
        restLen.push(pl.len);
        refs.push(Math.abs(pl.dir[0]) > 0.8 ? 'fwd' : 'lat');                 // a steady side vector for this part
        var prim = { attributes: { POSITION: acc(new Float32Array(mesh.pos), 'VEC3', 5126, 34962, true), NORMAL: acc(new Float32Array(mesh.nor), 'VEC3', 5126, 34962) },
          indices: acc(new Uint16Array(mesh.ind), 'SCALAR', 5123, 34963), material: material(q) };
        var base = q.g + '_' + (q.part || q.of || 'part'); counts[base] = (counts[base] || 0) + 1;
        var nm = base + (counts[base] > 1 ? '_' + counts[base] : '');
        meshes.push({ name: nm, primitives: [prim] });
        nodes.push({ name: nm, mesh: i, translation: pl.t, rotation: quatFromY(pl.dir, refsFor(rest)[refs[i]]) || [0, 0, 0, 1] });
      }
      var kids = []; for (i = 0; i < np; i++) kids.push(i);
      nodes.push({ name: o.name || ch.id, children: kids });
      var anims = [];
      clips.forEach(function (c) {
        var fr = c.frames.slice(), nF, k, f;
        if (c.loop) fr.push(c.frames[0]);                                   // close the loop
        nF = fr.length;
        var lists = fr.map(function (p) { return R.buildPrims(p, ch, { flash: false, model: true }); });
        if (lists.some(function (l) { return l.length !== np; })) return;   // a clip whose part list differs cannot share these nodes
        var times = new Float32Array(nF);
        for (f = 0; f < nF; f++) times[f] = c.loop ? c.duration * f / (nF - 1) : c.duration * f / nF;
        var tAcc = acc(times, 'SCALAR', 5126, null, true), samplers = [], channels = [];
        for (k = 0; k < np; k++) {
          var T = new Float32Array(nF * 3), Q = new Float32Array(nF * 4), Sc = null, prev = null;
          for (f = 0; f < nF; f++) {
            var pl2 = place(lists[f][k]), qq = quatFromY(pl2.dir, refsFor(lists[f])[refs[k]]) || prev || [0, 0, 0, 1];
            if (prev && qq[0] * prev[0] + qq[1] * prev[1] + qq[2] * prev[2] + qq[3] * prev[3] < 0) qq = [-qq[0], -qq[1], -qq[2], -qq[3]];
            prev = qq; T.set(pl2.t, f * 3); Q.set(qq, f * 4);
            if (restLen[k] > 1e-4 && Math.abs(pl2.len / restLen[k] - 1) > 0.02) { if (!Sc) { Sc = new Float32Array(nF * 3).fill(1); } Sc[f * 3 + 1] = pl2.len / restLen[k]; }
          }
          samplers.push({ input: tAcc, output: acc(T, 'VEC3', 5126), interpolation: 'LINEAR' }); channels.push({ sampler: samplers.length - 1, target: { node: k, path: 'translation' } });
          samplers.push({ input: tAcc, output: acc(Q, 'VEC4', 5126), interpolation: 'LINEAR' }); channels.push({ sampler: samplers.length - 1, target: { node: k, path: 'rotation' } });
          if (Sc) { samplers.push({ input: tAcc, output: acc(Sc, 'VEC3', 5126), interpolation: 'LINEAR' }); channels.push({ sampler: samplers.length - 1, target: { node: k, path: 'scale' } }); }
        }
        anims.push({ name: c.name, samplers: samplers, channels: channels });
      });
      var pad = (4 - byteLen % 4) % 4; if (pad) { chunks.push(new Uint8Array(pad)); byteLen += pad; }
      var doc = { asset: { version: '2.0', generator: 'Gait Bench 0.2' }, scene: 0, scenes: [{ name: ch.id, nodes: [np] }], nodes: nodes, meshes: meshes, materials: mats,
        animations: anims, accessors: accs, bufferViews: views, buffers: [{ byteLength: byteLen }] };
      var json = new TextEncoder().encode(JSON.stringify(doc)), jpad = (4 - json.length % 4) % 4, total = 12 + 8 + json.length + jpad + 8 + byteLen;
      var out = new Uint8Array(total), dv = new DataView(out.buffer), at = 0;
      dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true); at = 12;
      dv.setUint32(at, json.length + jpad, true); dv.setUint32(at + 4, 0x4E4F534A, true); at += 8; out.set(json, at); at += json.length;
      for (i = 0; i < jpad; i++) out[at++] = 0x20;
      dv.setUint32(at, byteLen, true); dv.setUint32(at + 4, 0x004E4942, true); at += 8;
      chunks.forEach(function (c) { out.set(c, at); at += c.length; });
      return out;
    }

    // ------------------------------------------------------- glTF, skinned
    // A real skeleton: the joints declared by the rig, parented into a hierarchy, with one mesh
    // skinned to them (every vertex follows exactly one joint). Clips animate joint rotations,
    // plus translation on the root and on the few joints that slide (weapon recoil, backpack).
    function basisY(dir, ref) {
      var d = ref[0] * dir[0] + ref[1] * dir[1] + ref[2] * dir[2];
      var x = [ref[0] - dir[0] * d, ref[1] - dir[1] * d, ref[2] - dir[2] * d], xl = Math.sqrt(x[0] * x[0] + x[1] * x[1] + x[2] * x[2]);
      if (xl < 1e-4) return null;
      x = [x[0] / xl, x[1] / xl, x[2] / xl];
      return [x, dir, [x[1] * dir[2] - x[2] * dir[1], x[2] * dir[0] - x[0] * dir[2], x[0] * dir[1] - x[1] * dir[0]]];
    }
    function quatOfBasis(B) {
      var x = B[0], y = B[1], z = B[2], m00 = x[0], m10 = x[1], m20 = x[2], m01 = y[0], m11 = y[1], m21 = y[2], m02 = z[0], m12 = z[1], m22 = z[2];
      var tr = m00 + m11 + m22, q, s;
      if (tr > 0) { s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]; }
      else if (m00 > m11 && m00 > m22) { s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
      else if (m11 > m22) { s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]; }
      else { s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]; }
      var n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
      return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
    }
    function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function toLocal(B, v) { return [dot3(B[0], v), dot3(B[1], v), dot3(B[2], v)]; }
    var IDENT = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

    // The skeleton a list of parts declares: joints, parents, and the world frame of every joint for any pose.
    // Which way a joint's side axis is taken from (refs) is settled once, from the pose the parts are given in.
    function skeleton(bind) {
      var J = bind.joints, jIdx = {};
      J.forEach(function (j, n) { jIdx[j.name] = n; });
      var parent = J.map(function (j) { return j.parent === null ? -1 : jIdx[j.parent]; });
      function dirOf(j) { var a = conv(j.o), b = conv(j.aim), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.sqrt(dot3(d, d)); return l > 1e-6 ? [d[0] / l, d[1] / l, d[2] / l] : [0, 1, 0]; }
      var refs = J.map(function (j) { return Math.abs(dirOf(j)[0]) > 0.9 ? 'fwd' : 'lat'; });
      function frames(prims, prev) {            // world frame of every joint for one pose
        var rf = refsFor(prims);
        return prims.joints.map(function (j, n) { return { o: conv(j.o), B: basisY(dirOf(j), j.side ? conv(j.side) : rf[refs[n]]) || (prev ? prev[n].B : IDENT) }; });
      }
      function locals(F) {
        return F.map(function (w, n) {
          var p = parent[n];
          if (p < 0) return { t: w.o, B: w.B };
          var P = F[p], d = [w.o[0] - P.o[0], w.o[1] - P.o[1], w.o[2] - P.o[2]];
          return { t: toLocal(P.B, d), B: [toLocal(P.B, w.B[0]), toLocal(P.B, w.B[1]), toLocal(P.B, w.B[2])] };
        });
      }
      return { J: J, jIdx: jIdx, parent: parent, refs: refs, frames: frames, locals: locals };
    }
    // o.bind: build the mesh and the skeleton in this pose instead of the first frame of the first clip.
    // o.clips === false: no animations (a rest-pose file).
    function glbSkinned(ch, clips, o) {
      o = o || {};
      var bind = R.buildPrims(o.bind || clips[0].frames[0], ch, { flash: false, model: true }), sk = skeleton(bind), J = sk.J, nj = J.length, jIdx = sk.jIdx, i, k;
      var parent = sk.parent, frames = sk.frames, locals = sk.locals;
      var chunks = [], byteLen = 0, views = [], accs = [];
      function pushData(typed, target) {
        var pad = (4 - byteLen % 4) % 4; if (pad) { chunks.push(new Uint8Array(pad)); byteLen += pad; }
        var u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength), v = { buffer: 0, byteOffset: byteLen, byteLength: u8.length };
        if (target) v.target = target;
        views.push(v); chunks.push(u8); byteLen += u8.length; return views.length - 1;
      }
      function acc(typed, type, comp, target, minmax) {
        var size = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type], a = { bufferView: pushData(typed, target), componentType: comp, count: typed.length / size, type: type };
        if (minmax) {
          var mn = [], mx = [], c, n;
          for (c = 0; c < size; c++) { mn.push(Infinity); mx.push(-Infinity); }
          for (n = 0; n < typed.length; n++) { c = n % size; if (typed[n] < mn[c]) mn[c] = typed[n]; if (typed[n] > mx[c]) mx[c] = typed[n]; }
          a.min = mn; a.max = mx;
        }
        accs.push(a); return accs.length - 1;
      }
      // --- mesh: every part's capsule, placed in the bind pose and tied to its joint
      var mats = [], matOf = {}, buckets = [];
      bind.forEach(function (q) {
        var key = q.col + (q.raw ? 'g' : ''), mi = matOf[key];
        if (mi === undefined) {
          var n = parseInt(q.col.slice(1), 16), lin = [srgbToLinear((n >> 16) & 255), srgbToLinear((n >> 8) & 255), srgbToLinear(n & 255)];
          var m = { name: 'c_' + q.col.slice(1) + (q.raw ? '_glow' : ''), pbrMetallicRoughness: { baseColorFactor: [lin[0], lin[1], lin[2], 1], metallicFactor: 0.1, roughnessFactor: 0.8 } };
          if (q.raw) m.emissiveFactor = lin;
          mi = matOf[key] = mats.length; mats.push(m); buckets.push({ pos: [], nor: [], jnt: [], wgt: [], ind: [] });
        }
        var a = conv(q.a), b = q.b ? conv(q.b) : a, d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.sqrt(dot3(d, d));
        var dir = len > 1e-6 ? [d[0] / len, d[1] / len, d[2] / len] : [0, 1, 0], Bq = basisY(dir, Math.abs(dir[0]) > 0.9 ? [0, 0, 1] : [1, 0, 0]) || IDENT;
        var t = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], mesh = capsuleMesh(len, q.r), bk = buckets[mi], base = bk.pos.length / 3, ji = jIdx[q.j];
        for (var v = 0; v < mesh.pos.length; v += 3) {
          var x = mesh.pos[v], y = mesh.pos[v + 1], z = mesh.pos[v + 2], nx = mesh.nor[v], ny = mesh.nor[v + 1], nz = mesh.nor[v + 2];
          bk.pos.push(t[0] + x * Bq[0][0] + y * Bq[1][0] + z * Bq[2][0], t[1] + x * Bq[0][1] + y * Bq[1][1] + z * Bq[2][1], t[2] + x * Bq[0][2] + y * Bq[1][2] + z * Bq[2][2]);
          bk.nor.push(nx * Bq[0][0] + ny * Bq[1][0] + nz * Bq[2][0], nx * Bq[0][1] + ny * Bq[1][1] + nz * Bq[2][1], nx * Bq[0][2] + ny * Bq[1][2] + nz * Bq[2][2]);
          bk.jnt.push(ji, 0, 0, 0); bk.wgt.push(1, 0, 0, 0);
        }
        mesh.ind.forEach(function (n2) { bk.ind.push(base + n2); });
      });
      var prims = buckets.map(function (bk, mi) {
        return { attributes: { POSITION: acc(new Float32Array(bk.pos), 'VEC3', 5126, 34962, true), NORMAL: acc(new Float32Array(bk.nor), 'VEC3', 5126, 34962),
          JOINTS_0: acc(new Uint8Array(bk.jnt), 'VEC4', 5121, 34962), WEIGHTS_0: acc(new Float32Array(bk.wgt), 'VEC4', 5126, 34962) },
          indices: acc(new Uint16Array(bk.ind), 'SCALAR', 5123, 34963), material: mi };
      });
      // --- skeleton
      var F0 = frames(bind, null), L0 = locals(F0), ibm = new Float32Array(16 * nj), nodes = [];
      for (k = 0; k < nj; k++) {
        var w = F0[k], Bk = w.B;
        ibm.set([Bk[0][0], Bk[1][0], Bk[2][0], 0, Bk[0][1], Bk[1][1], Bk[2][1], 0, Bk[0][2], Bk[1][2], Bk[2][2], 0, -dot3(Bk[0], w.o), -dot3(Bk[1], w.o), -dot3(Bk[2], w.o), 1], k * 16);
        nodes.push({ name: J[k].name, translation: L0[k].t, rotation: quatOfBasis(L0[k].B) });
      }
      var roots = [];
      for (k = 0; k < nj; k++) { if (parent[k] < 0) roots.push(k); else (nodes[parent[k]].children = nodes[parent[k]].children || []).push(k); }
      nodes.push({ name: (o.name || ch.id) + '_armature', children: roots });
      nodes.push({ name: o.name || ch.id, mesh: 0, skin: 0 });
      var jointList = []; for (k = 0; k < nj; k++) jointList.push(k);
      var skin = { name: ch.id + '_skin', joints: jointList, inverseBindMatrices: acc(ibm, 'MAT4', 5126), skeleton: roots[0] };
      // --- clips
      // every clip is worked out first: a joint that slides in any of them has its place written in all of them,
      // so that a tool which leaves unwritten channels as the last clip had them (Blender does) shows each clip right
      var anims = [], work = [], slides = parent.map(function (p) { return p < 0; });
      (o.clips === false ? [] : clips).forEach(function (c) {
        var fr = c.frames.slice(); if (c.loop) fr.push(c.frames[0]);
        var nF = fr.length, f, prev = F0, Ls = [], ok = true;
        for (f = 0; f < nF; f++) {
          var pr = R.buildPrims(fr[f], ch, { flash: false, model: true });
          if (pr.joints.length !== nj) { ok = false; break; }
          prev = frames(pr, prev); Ls.push(locals(prev));
        }
        if (!ok) return;
        var times = new Float32Array(nF), Qs = [], Ts = [];
        for (f = 0; f < nF; f++) times[f] = c.loop ? c.duration * f / (nF - 1) : c.duration * f / nF;
        for (k = 0; k < nj; k++) {
          var Q = new Float32Array(nF * 4), T = new Float32Array(nF * 3), pq = null;
          for (f = 0; f < nF; f++) {
            var l = Ls[f][k], qq = quatOfBasis(l.B);
            if (pq && qq[0] * pq[0] + qq[1] * pq[1] + qq[2] * pq[2] + qq[3] * pq[3] < 0) qq = [-qq[0], -qq[1], -qq[2], -qq[3]];
            pq = qq; Q.set(qq, f * 4); T.set(l.t, f * 3);
            if (Math.abs(l.t[0] - L0[k].t[0]) + Math.abs(l.t[1] - L0[k].t[1]) + Math.abs(l.t[2] - L0[k].t[2]) > 0.003 * ch.L) slides[k] = true;
          }
          Qs.push(Q); Ts.push(T);
        }
        work.push({ name: c.name, times: times, Q: Qs, T: Ts });
      });
      work.forEach(function (wk) {
        var tAcc = acc(wk.times, 'SCALAR', 5126, null, true), samplers = [], channels = [];
        for (k = 0; k < nj; k++) {
          samplers.push({ input: tAcc, output: acc(wk.Q[k], 'VEC4', 5126), interpolation: 'LINEAR' }); channels.push({ sampler: samplers.length - 1, target: { node: k, path: 'rotation' } });
          if (slides[k]) { samplers.push({ input: tAcc, output: acc(wk.T[k], 'VEC3', 5126), interpolation: 'LINEAR' }); channels.push({ sampler: samplers.length - 1, target: { node: k, path: 'translation' } }); }
        }
        anims.push({ name: wk.name, samplers: samplers, channels: channels });
      });
      var doc = { asset: { version: '2.0', generator: 'Gait Bench 0.3' }, scene: 0, scenes: [{ name: ch.id, nodes: [nj, nj + 1] }], nodes: nodes,
        meshes: [{ name: ch.id, primitives: prims }], skins: [skin], materials: mats, animations: anims, accessors: accs, bufferViews: views, buffers: [{ byteLength: 0 }] };
      if (!anims.length) delete doc.animations;
      return packGlb(doc, chunks, byteLen);
    }
    // --------------------------------------------------- templates for artists
    // The pose a model is built in: standing still, weapons put away, and a biped's arms held straight, out and down.
    function templatePose(ch, o) {
      o = o || {};
      var env = { terrain: flat, ladder: null }, S = M.createState(ch, env), inp = { speed: 0, armed: false, kit: null }, n, i;
      // held still, so that nothing sways, breathes or looks to one side: the two halves of the body match
      var st = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3, still: 1 };
      function run(sec) { for (n = Math.round(sec / DT), i = 0; i < n; i++) { M.step(S, ch, inp, st, env, DT); S.events.length = 0; } }
      if (o.kit && M.KITS[o.kit] && S.kit && o.kit !== S.kit) { inp.kit = o.kit; run(1.5); }
      run(8);
      var p = JSON.parse(JSON.stringify(R.shiftPose(S.pose, -S.px, 0, -S.pz)));
      if (p.kind === 'biped' && p.arms && ch.arms) {
        var a = o.arms === undefined ? 0.78 : o.arms, u = p.u, sd = p.side || [0, 0, 1], ca = Math.cos(a), sa = Math.sin(a);
        p.arms.forEach(function (s) {
          var d = [-u[0] * ca + sd[0] * s.side * sa, -u[1] * ca + sd[1] * s.side * sa, -u[2] * ca + sd[2] * s.side * sa];
          s.elbow = [s.shoulder[0] + d[0] * ch.arms.upper, s.shoulder[1] + d[1] * ch.arms.upper, s.shoulder[2] + d[2] * ch.arms.upper];
          s.hand = [s.elbow[0] + d[0] * ch.arms.lower, s.elbow[1] + d[1] * ch.arms.lower, s.elbow[2] + d[2] * ch.arms.lower];
        });
      }
      return p;
    }
    function r6(v) { return v.map(function (x) { return Math.round(x * 1e6) / 1e6 + 0; }); }
    // The rig as data, for other tools: joints with their parents and where they are in the template pose, and
    // every part of the stand-in model with the joint it hangs on. glTF axes and metres.
    function rig(ch, o) {
      o = o || {};
      var kit = ch.mount.type === 'held' && o.kit && o.kit !== ch.mount.kit ? o.kit : null;
      var prims = R.buildPrims(templatePose(ch, { kit: kit }), ch, { flash: false, model: true }), top = 0;
      prims.forEach(function (q) { top = Math.max(top, q.a[1] + q.r, q.b ? q.b[1] + q.r : 0); });
      // a bone ends where a child begins, if it aims there; otherwise where the parts it carries end
      function tailOf(j) {
        var h = conv(j.o), a = conv(j.aim), d = [a[0] - h[0], a[1] - h[1], a[2] - h[2]], len = Math.sqrt(dot3(d, d)), dir = len > 1e-6 ? [d[0] / len, d[1] / len, d[2] / len] : [0, 1, 0], ext = 0;
        var child = len > 1e-6 && prims.joints.some(function (c) { var q = conv(c.o); return c.parent === j.name && Math.abs(q[0] - a[0]) + Math.abs(q[1] - a[1]) + Math.abs(q[2] - a[2]) < 1e-4; });
        if (!child) prims.forEach(function (q) { if (q.j === j.name) [q.a, q.b].forEach(function (pt) { if (pt) { var c = conv(pt); ext = Math.max(ext, (c[0] - h[0]) * dir[0] + (c[1] - h[1]) * dir[1] + (c[2] - h[2]) * dir[2] + q.r); } }); });
        var bl = child ? len : Math.max(ext, 0.03 * top);
        return [h[0] + dir[0] * bl, h[1] + dir[1] * bl, h[2] + dir[2] * bl];
      }
      return {
        format: 'clio-motion-rig', version: 1, id: ch.id, name: kit ? ch.id + '_' + kit : ch.id, kit: kit || (ch.mount.type === 'held' ? ch.mount.kit : null), kind: ch.kind,
        units: 'metres', axes: { up: '+Y', forward: '+Z', right: '-X' }, height: Math.round(top * 1e4) / 1e4, leg: ch.L, pose: 'template',
        // carried: a joint for something the body carries (a weapon, its magazine, a pack, a load), not part of the body
        joints: prims.joints.map(function (j) { var o2 = { name: j.name, parent: j.parent, head: r6(conv(j.o)), tail: r6(tailOf(j)) }; if (ch.kind === 'biped' && /^(Weapon|Magazine|Shield|Case|Grenade|Carry|Pack)/.test(j.name)) o2.carried = true; return o2; }),
        parts: prims.map(function (q) { return { joint: q.j, group: q.g, slot: q.part || q.of || null, a: r6(conv(q.a)), b: q.b ? r6(conv(q.b)) : null, r: q.r, color: q.col }; }),
        slots: slotsOf(ch, prims).map(function (sl) { return { id: sl[0], label: sl[1], axis: sl[2] }; }),
        clips: clipNames(ch)
      };
    }
    // The stand-in model in the template pose, skinned, with no clips: what a modeller starts from.
    function glbTemplate(ch, o) {
      o = o || {};
      var kit = ch.mount.type === 'held' && o.kit && o.kit !== ch.mount.kit ? o.kit : null;
      return glbSkinned(ch, [], { bind: templatePose(ch, { kit: kit }), clips: false, name: o.name });
    }

    // ------------------------------------------------- the skeleton, live
    // What a game needs to move a model, or to draw the parts, from a pose while it runs. This is the reference for
    // the C and Python versions (clio_motion_rig.c, rig.py), which are checked against it.
    //   rigData(ch, { kit })        the rig as data: joints (parent, which side reference, where they are in the
    //                               template pose) and parts (the stand-in model's, each in its joint's own frame)
    //   liveSkeleton(ch, pose, prev) where every joint is for this pose: { rig, frames: [{ o, x, y, z }] } in the
    //                               pose's axes; y runs along the bone, x to its side. prev: what the last call
    //                               returned for this character (a bone seen end on keeps the turn it had)
    //   liveParts(sk, heading)      the parts carried by those joints, as buildPrims lists them (for R.sprites)
    //   jointMove(sk, j)            the 4 x 4 matrix (glTF axes, column after column) that takes anything bound to
    //                               joint j from the template pose to where it is now: world = move * rest
    function unconv(g) { return [g[2], g[1], -g[0]]; }
    // the image parts of a character that this rig has (a person with empty hands has no case to draw)
    function slotsOf(ch, prims) { return (R.SLOTS[ch.id] || []).filter(function (sl) { return prims.some(function (q) { return q.part === sl[0]; }); }); }
    // The kits a character's clips and templates are kept with (as files; any kit it can carry is recorded and made when asked
    // for): all of a person's, every weapon for the soldier, and for the other bodies that bear arms the one they come with -
    // the weapons' own joints are the soldier's. [null] for a character that carries none.
    function kitsKept(ch) { return ch.mount.type !== 'held' ? [null] : ch.mount.civil || ch.id === 'soldier' ? M.kitsOf(ch) : [ch.mount.kit]; }
    function kitOf(ch, pose) {
      if (ch.mount.type !== 'held' || !pose.props) return null;
      var kinds = pose.props.map(function (w) { return w.kind; }), kit = kinds.indexOf('sword') >= 0 ? 'sword' : kinds.indexOf('pistol') >= 0 ? 'pistols' : 'rifle';
      if (kinds.indexOf('sidegun') >= 0) kit = 'chainguns'; else if (kinds.indexOf('chaingun') >= 0) kit = 'chaingun';
      else if (kinds.indexOf('shotgun') >= 0) kit = 'shotgun'; else if (kinds.indexOf('launcher') >= 0) kit = 'rpg'; else if (kinds.indexOf('flamer') >= 0) kit = 'flamer';
      if (ch.mount.civil) kit = kinds.indexOf('case') >= 0 ? 'case' : kinds.indexOf('trolley') >= 0 ? 'trolley' : 'hands';      // a person who is not a soldier
      return kit === ch.mount.kit ? null : kit;
    }
    var rigs = {};
    function rigData(ch, o) {
      o = o || {};
      var kit = ch.mount.type === 'held' && o.kit && o.kit !== ch.mount.kit ? o.kit : null, key = ch.id + (kit ? '_' + kit : '');
      if (rigs[key]) return rigs[key];
      var base = rig(ch, { kit: kit }), tp = R.buildPrims(templatePose(ch, { kit: kit }), ch, { flash: false, model: true });
      var std = R.buildPrims(record(ch, 'idle', { frames: 8, kit: kit }).frames[0], ch, { flash: false, model: true }), sk = skeleton(std), F0 = sk.frames(std, null), Fr = sk.frames(tp, F0);
      function local(F, pt) { var c = conv(pt), d = [c[0] - F.o[0], c[1] - F.o[1], c[2] - F.o[2]]; return r6([dot3(F.B[0], d), dot3(F.B[1], d), dot3(F.B[2], d)]); }
      var K2 = R.LOOK && R.LOOK[ch.id], data = { name: base.name, id: ch.id, kit: base.kit, leg: ch.L, ears: K2 && K2.ears ? Math.round(K2.head / 0.088 * 1e6) / 1e6 : 0, sk: sk,
        joints: sk.J.map(function (j, k) { return { name: j.name, parent: sk.parent[k], ref: sk.refs[k] === 'fwd' ? 1 : 0, own: j.side ? 1 : 0, carried: !!base.joints[k].carried,
          o: r6(unconv(Fr[k].o)), x: r6(unconv(Fr[k].B[0])), y: r6(unconv(Fr[k].B[1])), z: r6(unconv(Fr[k].B[2])) }; }),
        parts: tp.map(function (q) {
          var k = sk.jIdx[q.j], F = Fr[k];
          return { joint: k, a: local(F, q.a), b: q.b ? local(F, q.b) : null, end: q.end ? local(F, q.end) : null, on: q.on ? local(F, q.on) : null, r: q.r, color: q.col, group: q.g, layer: q.ly, shade: q.sh,
            part: q.part || null, of: q.of || null, raw: !!q.raw, sq: !!q.sq };
        }) };
      // the template pose as the data has it (rounded), in glTF axes: what a bone seen end on falls back to, and what moves are measured from
      data.tpl = data.joints.map(function (j) { return { o: conv(j.o), B: [conv(j.x), conv(j.y), conv(j.z)] }; });
      rigs[key] = data;
      return data;
    }
    // The wardrobe of a person who is not a soldier, for other languages: every part of every option (R.OPTIONS), placed as rigData
    // places a rig's parts, each with the option it belongs to ('tag': "hair=long", or null for what is always worn) and the name of
    // its colour ('ck'). 'body' is the person's own parts, by the name of the joint that carries each; 'props' what each kit adds;
    // 'at' is where in 'body' they come in the draw order. 'wear' is what the character wears as it comes, 'palette' its colours by
    // name (skirt: null - the top's, unless one is given).
    function wardrobe(ch) {
      var base = R.wearOf(ch.id), out = { wear: base, palette: {}, body: null, at: 0, props: {} };
      if (!base) return null;
      R.COLOURS.forEach(function (k) { var c = R.PAL[ch.id][k]; out.palette[k] = c || (k === 'skirt' ? null : k === 'hat' || k === 'band' ? '#f2c230' : k === 'glass' ? '#7fb6c9' : R.PAL[ch.id].dark); });
      Object.keys(M.KITS).filter(function (k) { return M.kitFits(ch, k); }).forEach(function (kitName) {
        var kit = kitName === ch.mount.kit ? null : kitName, d = rigData(ch, { kit: kit }), sk = d.sk;
        var tp = R.buildPrims(templatePose(ch, { kit: kit }), ch, { flash: false, model: true, all: true });
        var std = R.buildPrims(record(ch, 'idle', { frames: 8, kit: kit }).frames[0], ch, { flash: false, model: true }), F0 = sk.frames(std, null), Fr = sk.frames(tp, F0);
        function local(F, pt) { var c = conv(pt), dd = [c[0] - F.o[0], c[1] - F.o[1], c[2] - F.o[2]]; return r6([dot3(F.B[0], dd), dot3(F.B[1], dd), dot3(F.B[2], dd)]); }
        var parts = tp.map(function (q) {
          var F = Fr[sk.jIdx[q.j]];
          return { joint: q.j, a: local(F, q.a), b: q.b ? local(F, q.b) : null, end: q.end ? local(F, q.end) : null, on: q.on ? local(F, q.on) : null, r: q.r, color: q.col, ck: q.ck || null, tag: q.tag || null,
            group: q.g, layer: q.ly, shade: q.sh, part: q.part || null, of: q.of || null, raw: !!q.raw, sq: !!q.sq };
        });
        var body = parts.filter(function (q) { return !/^prop/.test(q.group); }), first = parts.findIndex(function (q) { return /^prop/.test(q.group); });
        if (!out.body) { out.body = body; out.at = body.length; }
        if (first >= 0) out.at = first;
        out.props[kitName] = parts.filter(function (q) { return /^prop/.test(q.group); });
      });
      return out;
    }
    // What a person so dressed is made of, as rigData's 'parts' are: the wardrobe's parts that go with what is worn, in their
    // colours, as thick as the build makes them. (What other languages must arrive at from the wardrobe.)
    function dressedParts(ch, o) {
      o = o || {};
      var kit = ch.mount.type === 'held' && o.kit && o.kit !== ch.mount.kit ? o.kit : null, d = rigData(ch, { kit: kit }), sk = d.sk;
      var look = { flash: false, model: true, wear: o.wear, colors: o.colors, build: o.build };
      var tp = R.buildPrims(templatePose(ch, { kit: kit }), ch, look);
      var std = R.buildPrims(record(ch, 'idle', { frames: 8, kit: kit }).frames[0], ch, { flash: false, model: true }), F0 = sk.frames(std, null), Fr = sk.frames(tp, F0);
      function local(F, pt) { var c = conv(pt), dd = [c[0] - F.o[0], c[1] - F.o[1], c[2] - F.o[2]]; return r6([dot3(F.B[0], dd), dot3(F.B[1], dd), dot3(F.B[2], dd)]); }
      return tp.map(function (q) {
        var k = sk.jIdx[q.j], F = Fr[k];
        return { joint: k, a: local(F, q.a), b: q.b ? local(F, q.b) : null, end: q.end ? local(F, q.end) : null, on: q.on ? local(F, q.on) : null, r: q.r, color: q.col, group: q.g, layer: q.ly, shade: q.sh,
          part: q.part || null, of: q.of || null, raw: !!q.raw, sq: !!q.sq };
      });
    }
    // Things in the hands change their place in the draw order with what the hands are doing: a weapon in the hand is
    // in front of the body, put away it is behind or at the hip; a grenade in the hand is in front of the arm.
    // By group name: [layer, shade].
    function heldLayers(pose) {
      var o = {};
      (pose.props || []).forEach(function (w, k) {
        var st = w.stow > 0.5;
        o['prop' + k] = w.kind === 'pistol' || w.kind === 'sidegun' ? [k === 0 ? (st ? 2.1 : 3.1) : (st ? -2.1 : -2.9), k === 0 ? 3 : 1] : w.kind === 'sword' ? [st ? -2.3 : 3.1, 3] : w.kind === 'shield' ? [st ? -0.6 : -2.6, 1] : w.kind === 'case' ? [2.6, 3] : w.kind === 'trolley' ? [-2.4, 1] : [st ? -0.5 : 0.5, 2];
      });
      if (pose.kind === 'biped') o.grenade = [pose.grenade && pose.grenade.held ? 3.05 : 2.2, 3];
      return o;
    }
    function liveSkeleton(ch, pose, prev) {
      var data = rigData(ch, { kit: kitOf(ch, pose) }), prims = R.buildPrims(pose, ch, { flash: false, model: true });
      if (prims.joints.length !== data.joints.length) throw new Error('The pose has ' + prims.joints.length + ' joints; the rig ' + data.name + ' has ' + data.joints.length + '.');
      var G2 = data.sk.frames(prims, prev && prev.rig === data ? prev.g : data.tpl);          // (with nothing before it, a bone seen end on is turned as in the template pose)
      return { rig: data, g: G2, heading: prims.heading, held: heldLayers(pose), frames: G2.map(function (F) { return { o: unconv(F.o), x: unconv(F.B[0]), y: unconv(F.B[1]), z: unconv(F.B[2]) }; }) };
    }
    function liveParts(sk) {
      var F = sk.frames, out = sk.rig.parts.map(function (q) {
        var f = F[q.joint];
        function at(l) { return l ? [f.o[0] + f.x[0] * l[0] + f.y[0] * l[1] + f.z[0] * l[2], f.o[1] + f.x[1] * l[0] + f.y[1] * l[1] + f.z[1] * l[2], f.o[2] + f.x[2] * l[0] + f.y[2] * l[1] + f.z[2] * l[2]] : null; }
        var hl = sk.held[q.group], o2 = { a: at(q.a), b: at(q.b), r: q.r, col: q.color, g: q.group, ly: hl ? hl[0] : q.layer, sh: hl ? hl[1] : q.shade, j: sk.rig.joints[q.joint].name };
        if (q.end) o2.end = at(q.end);
        if (q.on) o2.on = at(q.on);
        if (q.part) o2.part = q.part;
        if (q.of) o2.of = q.of;
        if (q.raw) o2.raw = true;
        if (q.sq) o2.sq = true;
        return o2;
      });
      out.heading = sk.heading;
      return out;
    }
    function jointMove(sk, j) {
      var A = sk.g[j].B, Bq = sk.rig.tpl[j].B, R3 = [], c, r, o0 = sk.rig.tpl[j].o, o1 = sk.g[j].o;
      for (c = 0; c < 3; c++) for (r = 0; r < 3; r++) R3[c * 3 + r] = A[0][r] * Bq[0][c] + A[1][r] * Bq[1][c] + A[2][r] * Bq[2][c];
      return [R3[0], R3[1], R3[2], 0, R3[3], R3[4], R3[5], 0, R3[6], R3[7], R3[8], 0,
        o1[0] - (R3[0] * o0[0] + R3[3] * o0[1] + R3[6] * o0[2]), o1[1] - (R3[1] * o0[0] + R3[4] * o0[1] + R3[7] * o0[2]), o1[2] - (R3[2] * o0[0] + R3[5] * o0[1] + R3[8] * o0[2]), 1];
    }

    // A drawing template for Inkscape: the figure seen from its right side in the template pose (a biped's arms
    // hanging), as a locked guide layer, and above it one empty layer for each image part (rig.js, SLOTS).
    // The guide carries, for each part, the bone its picture lies along: a line clio-bone-<part> from the joint to
    // the bone's end (none for a part whose picture stays upright), and a circle clio-joint-<part> at the joint, as
    // wide as the part. A reader needs only those, and the scale bar clio-scale (one metre), to take the drawing apart.
    // A part listed in APART (a weapon) has its bone laid level under the figure, where it is easier to draw.
    var APART = { weapon: 1, 'case': 1 };
    function svgTemplate(ch) {
      var prims = R.buildPrims(templatePose(ch, { arms: 0 }), ch, { flash: false, model: true }), slots = slotsOf(ch, prims);
      var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, i;
      prims.forEach(function (q) { [q.a, q.b, q.end].forEach(function (p) { if (p) { x0 = Math.min(x0, p[0] - q.r); x1 = Math.max(x1, p[0] + q.r); y0 = Math.min(y0, p[1] - q.r); y1 = Math.max(y1, p[1] + q.r); } }); });
      y0 = Math.min(y0, 0);
      var ppm = Math.round(680 / Math.max(x1 - x0, y1 - y0)), pad = 70, figW = (x1 - x0) * ppm, figH = (y1 - y0) * ppm;
      var sorted = R.order(prims, R.projector({ cx: x0, cy: y1, cz: 0, yaw: 0, pit: 0, ppm: ppm, ox: pad, oy: pad }));
      function n2(v) { return String(Math.round(v * 100) / 100); }
      function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
      function shape(q, a, b, extra) {
        var col = R.shade(q.col, R.level(q)).css, r = Math.max(q.r * ppm, 0.6);
        if (!b) return '<circle cx="' + n2(a[0]) + '" cy="' + n2(a[1]) + '" r="' + n2(r) + '" fill="' + col + '"' + (extra || '') + '/>';
        return '<line x1="' + n2(a[0]) + '" y1="' + n2(a[1]) + '" x2="' + n2(b[0]) + '" y2="' + n2(b[1]) + '" stroke="' + col + '" stroke-width="' + n2(2 * r) + '" stroke-linecap="' + (q.sq ? 'butt' : 'round') + '"' + (extra || '') + '/>';
      }
      // the bone of each part: the copy of it nearest the eye
      var ref = {}, apartY = pad + figH + 46, bottom = pad + figH, fig = [], aside = [], bones = [], labels = [], layers = [];
      slots.forEach(function (sl) {
        var best = null;
        sorted.forEach(function (q) { if (q.part === sl[0] && (!best || q.k > best.k)) best = q; });
        if (best) ref[sl[0]] = best;
      });
      sorted.forEach(function (q) { if (!q.fx) fig.push('   ' + shape(q, q.pa, q.pb)); });
      slots.forEach(function (sl) {
        var q = ref[sl[0]]; if (!q) return;
        var a = q.pa, b = sl[2] === 'ball' ? null : (q.pe || q.pb), r = q.r * ppm, move = null;
        if (APART[sl[0]] && b) {
          // turn the part level and set it down under the figure, with everything that belongs to it
          var ang = Math.atan2(b[1] - a[1], b[0] - a[0]), ca = Math.cos(-ang), sa = Math.sin(-ang), ox = pad + 40, oy = apartY + 40;
          move = function (p) { var dx = p[0] - a[0], dy = p[1] - a[1]; return [ox + dx * ca - dy * sa, oy + dx * sa + dy * ca]; };
          sorted.forEach(function (w) { if ((w.part === sl[0] || w.of === sl[0]) && w.j && w.g === q.g && !w.fx) aside.push('   ' + shape(w, move(w.pa), w.pb ? move(w.pb) : null)); });
          var a2 = move(a); b = move(b); a = a2; bottom = Math.max(bottom, oy + 60); apartY = oy + 80;
        }
        if (b) bones.push('   <line id="clio-bone-' + sl[0] + '" x1="' + n2(a[0]) + '" y1="' + n2(a[1]) + '" x2="' + n2(b[0]) + '" y2="' + n2(b[1]) + '"/>');
        bones.push('   <circle id="clio-joint-' + sl[0] + '" cx="' + n2(a[0]) + '" cy="' + n2(a[1]) + '" r="' + n2(r) + '"/>');
        var lx = b ? (a[0] + b[0]) / 2 : a[0], ly = b ? (a[1] + b[1]) / 2 : a[1];
        labels.push('   <text x="' + n2(lx + r + 5) + '" y="' + n2(ly + 3) + '">' + esc(sl[1]) + '</text>');
        layers.push({ k: move ? 1e6 : q.k, text: ' <g inkscape:groupmode="layer" id="clio-part-' + sl[0] + '" inkscape:label="' + esc(sl[1]) + '"/>' });
      });
      layers.sort(function (m, n) { return m.k - n.k; });
      var W = Math.ceil(Math.max(figW + 2 * pad, 560)), H = Math.ceil(bottom + pad + 96), gy = pad + (y1 - 0) * ppm, out = [];
      out.push('<?xml version="1.0" encoding="UTF-8"?>');
      out.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" id="clio-motion-' + ch.id + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">');
      out.push(' <title>CLIo Motion drawing template: ' + esc(ch.label || ch.id) + '</title>');
      out.push(' <sodipodi:namedview pagecolor="#ffffff" bordercolor="#999999" inkscape:document-units="px" showgrid="false"/>');
      out.push(' <g inkscape:groupmode="layer" id="clio-guides-' + ch.id + '" inkscape:label="Guide: ' + esc(ch.label || ch.id) + ' (locked, leave as it is)" sodipodi:insensitive="true">');
      out.push('  <line x1="' + n2(pad * 0.4) + '" y1="' + n2(gy) + '" x2="' + n2(W - pad * 0.4) + '" y2="' + n2(gy) + '" stroke="#b9bec6" stroke-width="1"/>');
      out.push('  <g id="clio-figure" opacity="0.38">'); out.push(fig.join('\n')); out.push('  </g>');
      if (aside.length) { out.push('  <g id="clio-apart" opacity="0.38">'); out.push(aside.join('\n')); out.push('  </g>'); }
      out.push('  <g id="clio-bones" fill="none" stroke="#d6217f" stroke-width="1.4">'); out.push(bones.join('\n')); out.push('  </g>');
      out.push('  <g id="clio-labels" font-family="sans-serif" font-size="11" fill="#a3175f">'); out.push(labels.join('\n')); out.push('  </g>');
      var sb = Math.min(ppm, W - 2 * pad), sy = H - 84;        // the scale bar: one metre, or half of one if the page is narrow
      if (sb < ppm) sb = ppm / 2;
      out.push('  <line id="clio-scale" x1="' + pad + '" y1="' + sy + '" x2="' + n2(pad + sb) + '" y2="' + sy + '" stroke="#444a54" stroke-width="2"/>');
      out.push('  <g font-family="sans-serif" font-size="11" fill="#444a54">');
      out.push('   <text id="clio-scale-length" x="' + n2(pad + sb + 8) + '" y="' + (sy + 4) + '">' + (sb < ppm ? '0.5 m' : '1 m') + '</text>');
      ['Draw each part in the layer that has its name, over the figure.', 'The figure faces right. A line is a bone; the circle is its joint.',
        'One drawing serves both sides. An empty layer keeps its plain shape.', 'Leave this guide layer in the file: it says where the bones are.'].forEach(function (t, k) {
        out.push('   <text x="' + pad + '" y="' + (sy + 22 + 14 * k) + '">' + t + '</text>');
      });
      out.push('  </g>');
      out.push(' </g>');
      layers.forEach(function (l) { out.push(l.text); });
      out.push('</svg>'); out.push('');
      return out.join('\n');
    }

    // 4 x 4 matrices as glTF writes them (column after column)
    function m4mul(a, b) {
      var o = new Array(16), c, r;
      for (c = 0; c < 4; c++) for (r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      return o;
    }
    function m4trs(t, q, sc) {
      var x = q[0], y = q[1], z = q[2], w = q[3], sx = sc[0], sy = sc[1], sz = sc[2];
      return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
        2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, t[0], t[1], t[2], 1];
    }
    function m4inv(m) {            // of a matrix whose last row is 0 0 0 1
      var a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
      var A = e * i - f * h, B2 = f * g - d * i, C = d * h - e * g, det = a * A + b * B2 + c * C, k = 1 / det;
      var r = [A * k, B2 * k, C * k, 0, (c * h - b * i) * k, (a * i - c * g) * k, (b * g - a * h) * k, 0, (b * f - c * e) * k, (c * d - a * f) * k, (a * e - b * d) * k, 0, 0, 0, 0, 1];
      r[12] = -(r[0] * m[12] + r[4] * m[13] + r[8] * m[14]); r[13] = -(r[1] * m[12] + r[5] * m[13] + r[9] * m[14]); r[14] = -(r[2] * m[12] + r[6] * m[13] + r[10] * m[14]);
      return r;
    }
    function m4pt(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]; }
    function parseGlb(bytes) {
      var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      if (u8.length < 20 || dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a .glb file (a binary glTF is needed, not .gltf, .blend or .fbx)');
      var jl = dv.getUint32(12, true), doc = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jl))), at = 20 + jl, bin = new Uint8Array(0);
      if (at + 8 <= u8.length && dv.getUint32(at + 4, true) === 0x004E4942) bin = u8.subarray(at + 8, at + 8 + dv.getUint32(at, true));
      return { doc: doc, bin: bin };
    }
    function glbWorlds(doc) {      // parent and world matrix of every node, as the file has them at rest
      var n = doc.nodes.length, par = new Array(n).fill(-1), W = new Array(n), i;
      doc.nodes.forEach(function (nd, k) { (nd.children || []).forEach(function (c) { par[c] = k; }); });
      function local(nd) { return nd.matrix ? nd.matrix.slice() : m4trs(nd.translation || [0, 0, 0], nd.rotation || [0, 0, 0, 1], nd.scale || [1, 1, 1]); }
      function world(k) { if (!W[k]) W[k] = par[k] < 0 ? local(doc.nodes[k]) : m4mul(world(par[k]), local(doc.nodes[k])); return W[k]; }
      for (i = 0; i < n; i++) world(i);
      return { parent: par, world: W };
    }
    // Compare a model made by someone else with the rig: are all the joints there, under the right parents, and
    // where the template has them?  Returns { ok, errors: [text], warnings: [text], joints, offset (largest, metres) }.
    function glbCheck(ch, bytes, o) {
      o = o || {};
      var rep = { ok: false, errors: [], warnings: [], joints: 0, offset: 0 }, g, kit = ch.mount.type === 'held' && o.kit && o.kit !== ch.mount.kit ? o.kit : null;
      try { g = parseGlb(bytes); } catch (e) { rep.errors.push(e.message); return rep; }
      var doc = g.doc, tp = R.buildPrims(templatePose(ch, { kit: kit }), ch, { flash: false, model: true }), sk = skeleton(tp), J = sk.J, byName = {}, inSkin = {}, i;
      if (!doc.nodes || !doc.nodes.length) { rep.errors.push('The file has no nodes.'); return rep; }
      (doc.skins || []).forEach(function (s) { s.joints.forEach(function (n) { inSkin[n] = true; }); });
      doc.nodes.forEach(function (nd, k) { if (nd.name !== undefined && (byName[nd.name] === undefined || (inSkin[k] && !inSkin[byName[nd.name]]))) byName[nd.name] = k; });
      var node = J.map(function (j) { return byName[j.name] === undefined ? -1 : byName[j.name]; }), missing = J.filter(function (j, k) { return node[k] < 0; }).map(function (j) { return j.name; });
      if (missing.length) {
        rep.errors.push('Missing joint' + (missing.length > 1 ? 's' : '') + ': ' + missing.join(', ') + '. Bone names must be exactly those of the template'
          + (missing.length === J.length ? ' (none was found: is this the right character?)' : missing.length > J.length / 2 ? ' (most are missing: is this a model of the ' + (ch.label || ch.id).toLowerCase() + '?)' : ch.mount.type === 'held' && missing.every(function (m) { return /^(Weapon|Magazine|Shield)/.test(m); }) ? ' (the model looks built for another kit: name it with --kit, or choose it in the bench)' : '') + '.');
        return rep;
      }
      var gw = glbWorlds(doc), jointOf = {}, L = ch.L;
      node.forEach(function (n, k) { jointOf[n] = k; });
      rep.joints = J.length;
      if (!(doc.skins || []).length) rep.warnings.push('No skin: the mesh is not bound to the bones (in Blender: parent the mesh to the armature with an Armature modifier and vertex groups named after the bones).');
      else {
        var unbound = J.filter(function (j, k) { return !inSkin[node[k]]; }).map(function (j) { return j.name; });
        if (unbound.length === J.length) rep.warnings.push('The skin uses none of the rig\'s joints.');
        var extra = Object.keys(inSkin).filter(function (n) { return jointOf[n] === undefined; }).map(function (n) { return doc.nodes[n].name || '#' + n; });
        if (extra.length) rep.warnings.push(extra.length + ' extra bone' + (extra.length > 1 ? 's' : '') + ' in the skin (' + extra.slice(0, 6).join(', ') + (extra.length > 6 ? ', ...' : '') + '): they will follow the nearest rig joint above them, rigidly.');
      }
      for (i = 0; i < J.length; i++) {
        var m = gw.world[node[i]], sx = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]), sy = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]), sz = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]);
        if (Math.abs(sx - sy) > 1e-3 * sx || Math.abs(sx - sz) > 1e-3 * sx) { rep.errors.push('Joint ' + J[i].name + ' is scaled unevenly (' + [sx, sy, sz].map(function (v) { return v.toFixed(3); }).join(', ') + '). Apply the scale of the armature and of its bones.'); return rep; }
        // the nearest rig joint above this one in the file should be its parent in the rig
        var up = gw.parent[node[i]]; while (up >= 0 && jointOf[up] === undefined) up = gw.parent[up];
        var found = up < 0 ? null : J[jointOf[up]].name;
        if (found !== J[i].parent) rep.warnings.push('Joint ' + J[i].name + ' hangs under ' + (found || 'nothing') + ', the template has it under ' + (J[i].parent || 'nothing') + '.');
        var c0 = conv(J[i].o), dd = Math.sqrt(Math.pow(m[12] - c0[0], 2) + Math.pow(m[13] - c0[1], 2) + Math.pow(m[14] - c0[2], 2));
        if (dd > rep.offset) { rep.offset = dd; rep.offsetJoint = J[i].name; }
      }
      if (rep.offset > 0.5 * L) { rep.errors.push('Joint ' + rep.offsetJoint + ' is ' + rep.offset.toFixed(2) + ' m from where the template has it. The model must stand in the template pose, at the template\'s size, facing +Z with +Y up (in Blender: export with "+Y Up" on).'); return rep; }
      if (rep.offset > 0.03 * L) rep.warnings.push('Joint ' + rep.offsetJoint + ' is ' + (rep.offset * 100).toFixed(1) + ' cm from where the template has it. The clips will still follow the rig exactly; parts around that joint may look bent or stretched.');
      rep.ok = true; rep._ = { doc: doc, bin: g.bin, gw: gw, node: node, jointOf: jointOf, tp: tp, kit: kit };
      return rep;
    }
    // Put the clips onto someone else's model. The model must have the rig's joints by name (glbCheck); its bones may
    // point any way and have any roll, as they do after a trip through Blender: every joint is given the same
    // movement in the world that the rig's joint makes, measured from the template pose.
    // Returns { glb: bytes or null, report }.
    function glbFit(ch, clips, bytes, o) {
      o = o || {};
      var rep = glbCheck(ch, bytes, o);
      if (!rep.ok) return { glb: null, report: rep };
      var X = rep._, doc = X.doc, gw = X.gw, node = X.node, jointOf = X.jointOf, nj = node.length, k, f; delete rep._;
      var std = R.buildPrims(record(ch, 'idle', { frames: 8, kit: X.kit }).frames[0], ch, { flash: false, model: true }), sk = skeleton(std);
      if (std.joints.length !== nj) { rep.ok = false; rep.errors.push('The rig has changed its joints between poses.'); return { glb: null, report: rep }; }
      var F0 = sk.frames(std, null), Fr = sk.frames(X.tp, F0);
      // which rig joint carries each node: itself, or the nearest one above it
      var owner = doc.nodes.map(function (nd, n) { var up = n; while (up >= 0 && jointOf[up] === undefined) up = gw.parent[up]; return up < 0 ? -1 : jointOf[up]; });
      function delta(Fn, j) {        // the movement of rig joint j from the template pose to this pose, in the world
        var A = Fn[j].B, Bq = Fr[j].B, R3 = [], c, r, o0 = Fr[j].o, o1 = Fn[j].o;
        for (c = 0; c < 3; c++) for (r = 0; r < 3; r++) R3[c * 3 + r] = A[0][r] * Bq[0][c] + A[1][r] * Bq[1][c] + A[2][r] * Bq[2][c];
        return [R3[0], R3[1], R3[2], 0, R3[3], R3[4], R3[5], 0, R3[6], R3[7], R3[8], 0,
          o1[0] - (R3[0] * o0[0] + R3[3] * o0[1] + R3[6] * o0[2]), o1[1] - (R3[1] * o0[0] + R3[4] * o0[1] + R3[7] * o0[2]), o1[2] - (R3[2] * o0[0] + R3[5] * o0[1] + R3[8] * o0[2]), 1];
      }
      var chunks = [X.bin], byteLen = X.bin.length, views = doc.bufferViews = doc.bufferViews || [], accs = doc.accessors = doc.accessors || [];
      if (!doc.buffers || !doc.buffers.length) doc.buffers = [{ byteLength: 0 }];
      if (doc.buffers[0].uri) { rep.ok = false; rep.errors.push('The file keeps its data outside itself. Export a single .glb.'); return { glb: null, report: rep }; }
      function push(typed) {
        var pad = (4 - byteLen % 4) % 4; if (pad) { chunks.push(new Uint8Array(pad)); byteLen += pad; }
        var u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
        views.push({ buffer: 0, byteOffset: byteLen, byteLength: u8.length }); chunks.push(u8); byteLen += u8.length; return views.length - 1;
      }
      function acc(typed, type, minmax) {
        var size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type], a = { bufferView: push(typed), componentType: 5126, count: typed.length / size, type: type };
        if (minmax) { a.min = [Math.min.apply(null, typed)]; a.max = [Math.max.apply(null, typed)]; }
        accs.push(a); return accs.length - 1;
      }
      var rest = node.map(function (n) { var p = gw.parent[n], Lm = p < 0 ? gw.world[n] : m4mul(m4inv(gw.world[p]), gw.world[n]); return [Lm[12], Lm[13], Lm[14]]; });
      // every clip is worked out first: a joint that slides in any of them gets its place written in all of them,
      // so that a tool which leaves unwritten channels as the last clip had them (Blender does) shows each clip right
      var anims = [], work = [], slides = node.map(function (n) { var pn = gw.parent[n]; return pn < 0 || owner[pn] < 0; });
      clips.forEach(function (c) {
        var fr = c.frames.slice(); if (c.loop) fr.push(c.frames[0]);
        var nF = fr.length, prev = F0, Ds = [], ok = true;
        for (f = 0; f < nF; f++) {
          var pr = R.buildPrims(fr[f], ch, { flash: false, model: true });
          if (pr.joints.length !== nj) { ok = false; break; }
          prev = sk.frames(pr, prev);
          var Fn = prev; Ds.push(Fn.map(function (w, j) { return delta(Fn, j); }));
        }
        if (!ok) { rep.warnings.push('Clip ' + c.name + ' was left out: it uses other joints (another kit?).'); return; }
        var times = new Float32Array(nF), Qs = [], Ts = [];
        for (f = 0; f < nF; f++) times[f] = c.loop ? c.duration * f / (nF - 1) : c.duration * f / nF;
        for (k = 0; k < nj; k++) {
          var n = node[k], pn = gw.parent[n], po = pn < 0 ? -1 : owner[pn], Q = new Float32Array(nF * 4), T = new Float32Array(nF * 3), pq = null;
          for (f = 0; f < nF; f++) {
            var Wn = m4mul(Ds[f][k], gw.world[n]), Wp = pn < 0 ? null : po < 0 ? gw.world[pn] : m4mul(Ds[f][po], gw.world[pn]), Lm = Wp ? m4mul(m4inv(Wp), Wn) : Wn;
            var sx = Math.sqrt(Lm[0] * Lm[0] + Lm[1] * Lm[1] + Lm[2] * Lm[2]) || 1, sy = Math.sqrt(Lm[4] * Lm[4] + Lm[5] * Lm[5] + Lm[6] * Lm[6]) || 1, sz = Math.sqrt(Lm[8] * Lm[8] + Lm[9] * Lm[9] + Lm[10] * Lm[10]) || 1;
            var qq = quatOfBasis([[Lm[0] / sx, Lm[1] / sx, Lm[2] / sx], [Lm[4] / sy, Lm[5] / sy, Lm[6] / sy], [Lm[8] / sz, Lm[9] / sz, Lm[10] / sz]]);
            if (pq && qq[0] * pq[0] + qq[1] * pq[1] + qq[2] * pq[2] + qq[3] * pq[3] < 0) qq = [-qq[0], -qq[1], -qq[2], -qq[3]];
            pq = qq; Q.set(qq, f * 4); T[f * 3] = Lm[12]; T[f * 3 + 1] = Lm[13]; T[f * 3 + 2] = Lm[14];
            // (the straight distance, so that the answer does not depend on which way the model's bones happen to point)
            if (Math.sqrt(Math.pow(Lm[12] - rest[k][0], 2) + Math.pow(Lm[13] - rest[k][1], 2) + Math.pow(Lm[14] - rest[k][2], 2)) > 0.002 * ch.L) slides[k] = true;
          }
          Qs.push(Q); Ts.push(T);
        }
        work.push({ name: c.name, times: times, Q: Qs, T: Ts });
      });
      work.forEach(function (wk) {
        var tAcc = acc(wk.times, 'SCALAR', true), samplers = [], channels = [];
        for (k = 0; k < nj; k++) {
          samplers.push({ input: tAcc, output: acc(wk.Q[k], 'VEC4'), interpolation: 'LINEAR' }); channels.push({ sampler: samplers.length - 1, target: { node: node[k], path: 'rotation' } });
          if (slides[k]) { samplers.push({ input: tAcc, output: acc(wk.T[k], 'VEC3'), interpolation: 'LINEAR' }); channels.push({ sampler: samplers.length - 1, target: { node: node[k], path: 'translation' } }); }
        }
        anims.push({ name: wk.name, samplers: samplers, channels: channels });
      });
      if ((doc.animations || []).length) rep.warnings.push('The ' + doc.animations.length + ' animation' + (doc.animations.length > 1 ? 's' : '') + ' the file had were replaced.');
      doc.animations = anims; rep.clips = anims.length;
      // a joint that was written as a matrix cannot be animated: give it the same thing as translation, rotation, scale
      node.forEach(function (n) {
        var nd = doc.nodes[n]; if (!nd.matrix) return;
        var m = nd.matrix, sx = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]), sy = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]), sz = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]);
        nd.translation = [m[12], m[13], m[14]]; nd.scale = [sx, sy, sz];
        nd.rotation = quatOfBasis([[m[0] / sx, m[1] / sx, m[2] / sx], [m[4] / sy, m[5] / sy, m[6] / sy], [m[8] / sz, m[9] / sz, m[10] / sz]]); delete nd.matrix;
      });
      // a skinned mesh takes its place from its joints alone; Blender hangs it under the armature, which the format
      // advises against. Lift it to the top of its scene: nothing moves.
      doc.nodes.forEach(function (nd, n) {
        if (nd.skin === undefined || nd.mesh === undefined || gw.parent[n] < 0 || (nd.children || []).length) return;
        var top = n; while (gw.parent[top] >= 0) top = gw.parent[top];
        var pc = doc.nodes[gw.parent[n]].children; pc.splice(pc.indexOf(n), 1); if (!pc.length) delete doc.nodes[gw.parent[n]].children;
        (doc.scenes || []).forEach(function (sc) { if ((sc.nodes || []).indexOf(top) >= 0) sc.nodes.push(n); });
        delete nd.translation; delete nd.rotation; delete nd.scale; delete nd.matrix;
      });
      return { glb: packGlb(doc, chunks, byteLen), report: rep };
    }
    // How well a skinned file follows the rig: every part of the stand-in model is carried by its joint through
    // every clip in the file, and its ends are compared with where the rig puts them. Distances as a share of leg length.
    // bindPose: the pose the file's mesh was built in (the template pose for a fitted file).
    function glbFollows(ch, clips, bytes, bindPose) {
      var g = parseGlb(bytes), doc = g.doc, bin = g.bin, dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength), gw = glbWorlds(doc), skin = doc.skins[0], byName = {}, worst = 0, sum = 0, cnt = 0, what = '';
      function read(i) { var a = doc.accessors[i], v = doc.bufferViews[a.bufferView], n = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type], o = [], at = (v.byteOffset || 0) + (a.byteOffset || 0), st = v.byteStride || n * 4; for (var e = 0; e < a.count; e++) for (var c = 0; c < n; c++) o.push(dv.getFloat32(at + e * st + c * 4, true)); return o; }
      var ibm = read(skin.inverseBindMatrices), slot = {};
      skin.joints.forEach(function (n, k) { slot[doc.nodes[n].name] = k; });
      var bind = R.buildPrims(bindPose || clips[0].frames[0], ch, { flash: false, model: true });
      (doc.animations || []).forEach(function (an) {
        var clip = clips.filter(function (c) { return c.name === an.name; })[0]; if (!clip) return;
        var chs = an.channels.map(function (c) { return { node: c.target.node, path: c.target.path, out: read(an.samplers[c.sampler].output) }; });
        for (var f = 0; f < clip.frames.length; f++) {
          var loc = doc.nodes.map(function (nd) { return nd.matrix ? null : { t: (nd.translation || [0, 0, 0]).slice(), q: (nd.rotation || [0, 0, 0, 1]).slice(), s: nd.scale || [1, 1, 1] }; });
          chs.forEach(function (c) { if (c.path === 'rotation') loc[c.node].q = c.out.slice(f * 4, f * 4 + 4); else if (c.path === 'translation') loc[c.node].t = c.out.slice(f * 3, f * 3 + 3); });
          var W = [], world = function (n) { if (!W[n]) { var m = loc[n] ? m4trs(loc[n].t, loc[n].q, loc[n].s) : doc.nodes[n].matrix; W[n] = gw.parent[n] < 0 ? m : m4mul(world(gw.parent[n]), m); } return W[n]; };
          var now = R.buildPrims(clip.frames[f], ch, { flash: false, model: true });
          bind.forEach(function (q, k) {
            var js = slot[q.j]; if (js === undefined) return;
            var m = m4mul(world(skin.joints[js]), ibm.slice(js * 16, js * 16 + 16));
            [[q.a, now[k].a], [q.b, now[k].b]].forEach(function (pp) {
              if (!pp[0]) return;
              var sp = m4pt(m, conv(pp[0])), e = conv(pp[1]), err = Math.sqrt(Math.pow(sp[0] - e[0], 2) + Math.pow(sp[1] - e[1], 2) + Math.pow(sp[2] - e[2], 2)) / ch.L;
              sum += err; cnt++; if (err > worst) { worst = err; what = an.name + ' frame ' + f + ' ' + q.g + '/' + (q.part || q.of || '') + ' on ' + q.j; }
            });
          });
        }
      });
      return { mean: cnt ? sum / cnt : 0, worst: worst, where: what, clips: (doc.animations || []).length, points: cnt };
    }

    function packGlb(doc, chunks, byteLen) {
      var pad = (4 - byteLen % 4) % 4, i; if (pad) { chunks.push(new Uint8Array(pad)); byteLen += pad; }
      doc.buffers[0].byteLength = byteLen;
      var json = new TextEncoder().encode(JSON.stringify(doc)), jpad = (4 - json.length % 4) % 4, total = 12 + 8 + json.length + jpad + 8 + byteLen;
      var out = new Uint8Array(total), dv = new DataView(out.buffer), at = 12;
      dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
      dv.setUint32(at, json.length + jpad, true); dv.setUint32(at + 4, 0x4E4F534A, true); at += 8; out.set(json, at); at += json.length;
      for (i = 0; i < jpad; i++) out[at++] = 0x20;
      dv.setUint32(at, byteLen, true); dv.setUint32(at + 4, 0x004E4942, true); at += 8;
      chunks.forEach(function (c) { out.set(c, at); at += c.length; });
      return out;
    }

    // ------------------------------------------------------------ PNG and zip
    var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    function crc32(u8, crc) { crc = (crc === undefined ? 0 : crc) ^ 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) crc = CRC[(crc ^ u8[i]) & 255] ^ (crc >>> 8); return (crc ^ 0xFFFFFFFF) >>> 0; }
    function pngScanlines(rgba, w, h) { var raw = new Uint8Array((w * 4 + 1) * h); for (var y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); return raw; }
    function zlibStored(raw) {
      var blocks = Math.max(1, Math.ceil(raw.length / 65535)), out = new Uint8Array(2 + raw.length + blocks * 5 + 4), at = 2, a = 1, b = 0, i;
      out[0] = 0x78; out[1] = 0x01;
      for (i = 0; i < blocks; i++) {
        var s = raw.subarray(i * 65535, Math.min(raw.length, (i + 1) * 65535)), n = s.length;
        out[at++] = i === blocks - 1 ? 1 : 0; out[at++] = n & 255; out[at++] = n >> 8; out[at++] = ~n & 255; out[at++] = (~n >> 8) & 255; out.set(s, at); at += n;
      }
      for (i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
      out[at++] = b >> 8; out[at++] = b & 255; out[at++] = a >> 8; out[at++] = a & 255;
      return out;
    }
    // zdata: the scanlines in zlib form. Pass your platform's deflate result, or zlibStored(scanlines).
    function png(w, h, zdata) {
      function chunk(type, data) {
        var c = new Uint8Array(12 + data.length), dv = new DataView(c.buffer), i;
        dv.setUint32(0, data.length); for (i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i); c.set(data, 8);
        dv.setUint32(8 + data.length, crc32(c.subarray(4, 8 + data.length))); return c;
      }
      var ih = new Uint8Array(13), dv = new DataView(ih.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ih[8] = 8; ih[9] = 6;
      var parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zdata), chunk('IEND', new Uint8Array(0))];
      var n = parts.reduce(function (s, p) { return s + p.length; }, 0), out = new Uint8Array(n), at = 0;
      parts.forEach(function (p) { out.set(p, at); at += p.length; }); return out;
    }
    function zip(files) {            // [{name, data: Uint8Array}] stored without compression
      var enc = new TextEncoder(), locals = [], central = [], off = 0;
      files.forEach(function (f) {
        var name = enc.encode(f.name), data = f.data, crc = crc32(data);
        var lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
        dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true); dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true);
        dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true); dv.setUint16(26, name.length, true); lh.set(name, 30);
        var ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
        cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
        cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, off, true); ch.set(name, 46);
        locals.push(lh, data); central.push(ch); off += lh.length + data.length;
      });
      var cl = central.reduce(function (s, p) { return s + p.length; }, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
      ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cl, true); ev.setUint32(16, off, true);
      var all = locals.concat(central, [end]), out = new Uint8Array(off + cl + 22), at = 0;
      all.forEach(function (p) { out.set(p, at); at += p.length; }); return out;
    }

    return { record: record, recordAll: recordAll, clipNames: clipNames, walkSpeed: walkSpeed, runSpeed: runSpeed, newPalette: newPalette, rasterize: rasterize,
      framePrims: framePrims, spriteView: spriteView, sheet: sheet, clio: clio, glb: glb, glbSkinned: glbSkinned,
      templatePose: templatePose, rig: rig, glbTemplate: glbTemplate, svgTemplate: svgTemplate, cutout: cutout,
      rigData: rigData, kitsKept: kitsKept, wardrobe: wardrobe, dressedParts: dressedParts, liveSkeleton: liveSkeleton, liveParts: liveParts, jointMove: jointMove, glbCheck: glbCheck, glbFit: glbFit, glbFollows: glbFollows, parseGlb: parseGlb, pngScanlines: pngScanlines, zlibStored: zlibStored, png: png, zip: zip, crc32: crc32 };
  };
});
