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
        inp.aim = [1e4, 0]; run(2); inp.aim = [1e4, S.y + 0.3 * ch.L]; run(1);
        if (ch.beast) { inp.bite = {}; step(DT); inp.bite = null; }          // an animal's attack is its bite
        else if (ch.arthro && ch.arthro.claw) { inp.pinch = {}; step(DT); inp.pinch = null; }  // a scorpion's is its claw, a mantis's both forelegs
        else if (ch.arthro) { inp.sting = {}; step(DT); inp.sting = null; }  // a wasp's is its sting
        else if (ch.octo) { inp.grab = {}; step(DT); inp.grab = null; }      // an octopus's is an arm shot out to grab
        else if (S.kit === 'sword') { inp.swing = { kind: 'slash' }; step(DT); inp.swing = null; }
        else { inp.fire = true; step(DT); inp.fire = false; }
        dur = S.kit === 'sword' ? 0.75 : 0.5; frames = timed(dur, o.fps || 12); loop = false;
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
        if (ch.kind !== 'biped') return null;
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

    function glbSkinned(ch, clips, o) {
      o = o || {};
      var bind = R.buildPrims(clips[0].frames[0], ch, { flash: false, model: true }), J = bind.joints, nj = J.length, jIdx = {}, i, k;
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
      var anims = [];
      clips.forEach(function (c) {
        var fr = c.frames.slice(); if (c.loop) fr.push(c.frames[0]);
        var nF = fr.length, f, prev = F0, Ls = [], ok = true;
        for (f = 0; f < nF; f++) {
          var pr = R.buildPrims(fr[f], ch, { flash: false, model: true });
          if (pr.joints.length !== nj) { ok = false; break; }
          prev = frames(pr, prev); Ls.push(locals(prev));
        }
        if (!ok) return;
        var times = new Float32Array(nF);
        for (f = 0; f < nF; f++) times[f] = c.loop ? c.duration * f / (nF - 1) : c.duration * f / nF;
        var tAcc = acc(times, 'SCALAR', 5126, null, true), samplers = [], channels = [];
        for (k = 0; k < nj; k++) {
          var Q = new Float32Array(nF * 4), T = new Float32Array(nF * 3), pq = null, slides = parent[k] < 0;
          for (f = 0; f < nF; f++) {
            var l = Ls[f][k], qq = quatOfBasis(l.B);
            if (pq && qq[0] * pq[0] + qq[1] * pq[1] + qq[2] * pq[2] + qq[3] * pq[3] < 0) qq = [-qq[0], -qq[1], -qq[2], -qq[3]];
            pq = qq; Q.set(qq, f * 4); T.set(l.t, f * 3);
            if (Math.abs(l.t[0] - L0[k].t[0]) + Math.abs(l.t[1] - L0[k].t[1]) + Math.abs(l.t[2] - L0[k].t[2]) > 0.003 * ch.L) slides = true;
          }
          samplers.push({ input: tAcc, output: acc(Q, 'VEC4', 5126), interpolation: 'LINEAR' }); channels.push({ sampler: samplers.length - 1, target: { node: k, path: 'rotation' } });
          if (slides) { samplers.push({ input: tAcc, output: acc(T, 'VEC3', 5126), interpolation: 'LINEAR' }); channels.push({ sampler: samplers.length - 1, target: { node: k, path: 'translation' } }); }
        }
        anims.push({ name: c.name, samplers: samplers, channels: channels });
      });
      var doc = { asset: { version: '2.0', generator: 'Gait Bench 0.3' }, scene: 0, scenes: [{ name: ch.id, nodes: [nj, nj + 1] }], nodes: nodes,
        meshes: [{ name: ch.id, primitives: prims }], skins: [skin], materials: mats, animations: anims, accessors: accs, bufferViews: views, buffers: [{ byteLength: 0 }] };
      return packGlb(doc, chunks, byteLen);
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
      framePrims: framePrims, spriteView: spriteView, sheet: sheet, clio: clio, glb: glb, glbSkinned: glbSkinned, pngScanlines: pngScanlines, zlibStored: zlibStored, png: png, zip: zip, crc32: crc32 };
  };
});
