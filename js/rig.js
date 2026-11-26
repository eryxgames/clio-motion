// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
/* Rig drawing data. Turns a pose from the motion core into a list of simple parts
   (capsules and balls), grouped by body part so that draw order is stable.
   No DOM: the bench page, the software rasteriser and the glTF writer all use this list. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GaitRig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function mix(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function upY(p, d) { return [p[0], p[1] + d, p[2]]; }
  function atZ(p, z) { return [p[0], p[1], z]; }

  var PAL = {
    soldier: { suit: '#4d545e', armor: '#e2711d', pack: '#b9581a', dark: '#2a2e35', metal: '#3b4048', glow: '#ffd23f' },
    soldier2: { suit: '#474c57', armor: '#3d7cc0', pack: '#2c5d94', dark: '#23262c', metal: '#3b4048', glow: '#a8ecff' },   // a second team, for telling two apart
    // people: suit is the trousers, top the jacket, coat or overall; box and trim are the colours of what is carried
    person: { suit: '#3b4252', top: '#4c5a73', skin: '#d6a27c', hair: '#3a2a1f', shoe: '#1e1e22', glove: '#d6a27c', dark: '#22252b', metal: '#8d949e', box: '#6b4a2f', trim: '#c9a04a', pack: '#4c5a73' },
    technician: { suit: '#2f6690', top: '#2f6690', skin: '#c99874', hair: '#2a2420', shoe: '#2c2622', glove: '#c98a2b', dark: '#22252b', metal: '#8d949e', box: '#b3362b', trim: '#3b4048', hat: '#f2c230', band: '#f2c230', pack: '#2f6690' },
    scientist: { suit: '#4a4f58', top: '#eef0f2', skin: '#dcae8b', hair: '#7a7d82', shoe: '#26262a', glove: '#dcae8b', dark: '#22252b', metal: '#8d949e', box: '#b8bec6', trim: '#5c636d', pack: '#eef0f2' },
    hazmat: { suit: '#e3c62f', top: '#e3c62f', skin: '#e3c62f', hair: '#e3c62f', shoe: '#2d5f8f', glove: '#2d5f8f', dark: '#1d2a33', metal: '#8d949e', box: '#d9622b', trim: '#22252b', glass: '#7fb6c9', pack: '#8a9097' },
    mech: { hull: '#6f8146', hull2: '#58683b', dark: '#2f3430', metal: '#4c5157', accent: '#e2711d', glass: '#a5d6e8' },
    quad: { hull: '#5b6068', armor: '#a8432f', dark: '#2b2d31', eye: '#ff6a3c' },
    raptor: { coat: '#6f8a5a', mane: '#3f5a3c', belly: '#c9c08f', leg: '#5c7350', muzzle: '#56704a', dark: '#22281f', eye: '#ffb62e', spot: '#3f5a3c' },
    dragon: { coat: '#93352d', mane: '#4f1f1c', belly: '#d8b06a', leg: '#7a302a', muzzle: '#84302a', dark: '#1f1413', eye: '#ffd23f', spot: '#4f1f1c', wing: '#c98f52', wingBone: '#5c2420' },
    mantis: { shell: '#6f9f47', shell2: '#8dbd5c', limb: '#5c8a3b', dark: '#2a3a1e', sting: '#c9402b', eye: '#2a1f1a', wing: '#a9cf7b' },
    wasp: { shell: '#2a2421', shell2: '#e0a81c', limb: '#3b2f26', dark: '#17120f', sting: '#17120f', eye: '#6a2014', wing: '#c3d8e8', wingBone: '#8ea8bc' },
    octopus: { skin: '#b9483d', skin2: '#9b3a33', pale: '#ecc7ad', dark: '#2c1513' },
    scorpion: { shell: '#4a3327', shell2: '#6a4630', limb: '#8a5a2c', dark: '#211712', sting: '#c9402b', eye: '#ffd23f' },
    horse: { coat: '#8a5a34', mane: '#2a1d16', spot: '#2a1d16', leg: '#3a2a20', muzzle: '#4a3426', dark: '#1c1512', eye: '#16100c', tack: '#5a3a22' },
    hyena: { coat: '#b3935c', mane: '#6f5636', spot: '#5a4429', leg: '#7a6040', muzzle: '#3a2d22', dark: '#2a211a', eye: '#ffd23f' },
    spider: { hull: '#8b957b', hull2: '#a3ad92', dark: '#3a3d38', metal: '#55585a', eye: '#3fb8ff' }
  };
  // sprite framing: pixels per metre in a 64-pixel frame, forward offset of the frame centre, depth range for shading, standing height
  var SPRITE = {
    soldier: { ppm: 24.4, cx: 0.25, dz: 0.3, tall: 1.95 }, person: { ppm: 24.4, cx: 0.0, dz: 0.3, tall: 1.95 }, technician: { ppm: 24.4, cx: 0.0, dz: 0.3, tall: 1.95 },
    scientist: { ppm: 24.4, cx: 0.0, dz: 0.3, tall: 1.95 }, hazmat: { ppm: 24.4, cx: 0.0, dz: 0.3, tall: 1.95 }, mech: { ppm: 8.9, cx: 0.45, dz: 1.3, tall: 5.1 },
    quad: { ppm: 31, cx: 0.12, dz: 0.25, tall: 0.95 }, hyena: { ppm: 26, cx: 0.10, dz: 0.25, tall: 1.1 }, horse: { ppm: 14.5, cx: 0.2, dz: 0.35, tall: 2.05 }, raptor: { ppm: 15.5, cx: -0.15, dz: 0.3, tall: 1.85 }, scorpion: { ppm: 22, cx: 0.15, dz: 0.8, tall: 1.4 }, octopus: { ppm: 24, cx: -0.1, dz: 0.7, tall: 1.0 }, mantis: { ppm: 22, cx: 0.0, dz: 0.5, tall: 1.2 }, wasp: { ppm: 34, cx: 0.0, dz: 0.4, tall: 0.75 }, dragon: { ppm: 6.6, cx: -0.4, dz: 0.5, tall: 3.2 }, spider: { ppm: 13.4, cx: 0.25, dz: 1.5, tall: 2.0 }
  };
  // Image slots. axis says how a part's picture is laid along its bone:
  // down = top of the picture at the parent joint, up = bottom at the parent joint,
  // right = left edge at the first joint (feet, weapons, long bodies), ball = centred and upright.
  var CIVIL_SLOTS = [['head', 'Head', 'ball'], ['torso', 'Torso', 'up', 1.5], ['upperArm', 'Upper arm', 'down'], ['forearm', 'Forearm and hand', 'down'],
    ['thigh', 'Thigh', 'down'], ['shin', 'Shin', 'down'], ['foot', 'Foot', 'right'], ['case', 'Case', 'right']];
  /* How people who are not soldiers are dressed. boots: the lower shin is the shoe's colour. coat: how far a coat hangs below the
     hips (m). hat: a hard hat. hood: the head is inside the suit, behind a visor. tank: an air tank on the back. band: a bright band
     round the chest. box: how many slabs the case in the hand is made of, one under the other, each as thick as it is high (three: a
     briefcase, thin; two: a tool box, thick). */
  var DRESS = {
    person: { box: 3 },
    technician: { boots: true, hat: true, band: true, box: 2 },
    scientist: { coat: 0.30, box: 3 },
    hazmat: { boots: true, hood: true, tank: true, box: 2 }
  };
  var SLOTS = {
    soldier: [['head', 'Head', 'ball'], ['torso', 'Torso', 'up', 1.5], ['pack', 'Backpack', 'down'], ['upperArm', 'Upper arm', 'down'], ['forearm', 'Forearm and hand', 'down'],
      ['thigh', 'Thigh', 'down'], ['shin', 'Shin', 'down'], ['foot', 'Foot', 'right'], ['weapon', 'Weapon', 'right']],
    person: CIVIL_SLOTS, technician: CIVIL_SLOTS, scientist: CIVIL_SLOTS, hazmat: CIVIL_SLOTS.concat([['pack', 'Air tank', 'down']]),
    mech: [['hull', 'Hull', 'ball'], ['gun', 'Gun', 'right'], ['thigh', 'Thigh', 'down'], ['shin', 'Shin', 'down'], ['foot', 'Foot', 'right']],
    quad: [['body', 'Body', 'right'], ['head', 'Head', 'right'], ['upperLeg', 'Upper leg', 'down'], ['lowerLeg', 'Lower leg', 'down']],
    raptor: [['body', 'Body', 'right'], ['head', 'Head', 'ball'], ['upperLeg', 'Thigh', 'down'], ['lowerLeg', 'Shin', 'down']],
    dragon: [['body', 'Body', 'right'], ['head', 'Head', 'ball'], ['upperLeg', 'Upper leg', 'down'], ['lowerLeg', 'Lower leg', 'down'], ['wing', 'Wing arm', 'right']],
    mantis: [['body', 'Abdomen', 'right'], ['head', 'Head', 'ball'], ['claw', 'Foreleg hook', 'right'], ['upperLeg', 'Upper leg', 'down'], ['lowerLeg', 'Lower leg', 'down']],
    wasp: [['body', 'Thorax', 'right'], ['head', 'Head', 'ball'], ['upperLeg', 'Upper leg', 'down'], ['lowerLeg', 'Lower leg', 'down'], ['wing', 'Wing', 'right']],
    octopus: [['mantle', 'Mantle', 'right'], ['head', 'Head', 'ball']],
    scorpion: [['body', 'Carapace', 'right'], ['claw', 'Claw', 'right'], ['upperLeg', 'Upper leg', 'down'], ['lowerLeg', 'Lower leg', 'down']],
    hyena: [['body', 'Body', 'right'], ['head', 'Head', 'ball'], ['upperLeg', 'Upper leg', 'down'], ['lowerLeg', 'Lower leg', 'down']],
    horse: [['body', 'Body', 'right'], ['head', 'Head', 'ball'], ['upperLeg', 'Upper leg', 'down'], ['lowerLeg', 'Lower leg', 'down']],
    spider: [['body', 'Body', 'right'], ['turret', 'Turret', 'right'], ['upperLeg', 'Upper leg', 'down'], ['lowerLeg', 'Lower leg', 'down']]
  };

  // the build of each animal: radii of tail (root, tip), hindquarters, chest, neck (base, top), head, muzzle, legs (fore, hind, lower), and its markings
  var LOOK = {
    horse: { tail: [0.07, 0.03], tailDark: true, tailCol: 'mane', hind: 0.27, chest: 0.29, crest: 0.055, neck: [0.17, 0.115], head: 0.105, muzzle: 0.075, nose: true, ears: true, leg: [0.085, 0.10, 0.045], saddle: true },
    hyena: { tail: [0.036, 0.024], tailDark: true, hind: 0.125, chest: 0.155, crest: 0.05, neck: [0.098, 0.09], head: 0.088, muzzle: 0.05, nose: true, ears: true, leg: [0.058, 0.066, 0.04],
      spots: [[-0.26, 0.05, 0.036], [-0.12, 0.09, 0.03], [-0.02, -0.02, 0.034], [0.12, 0.08, 0.03], [0.24, 0.0, 0.036], [-0.2, -0.06, 0.026]] },
    dragon: { tail: [0.21, 0.035], stripes: true, hind: 0.33, chest: 0.36, belly: true, crest: 0.08, neck: [0.21, 0.13], head: 0.15, muzzle: 0.10, nose: false, leg: [0.14, 0.16, 0.085], wing: [0.26, 0.05] },
    raptor: { tail: [0.105, 0.022], stripes: true, hind: 0.17, chest: 0.16, belly: true, crest: 0.045, neck: [0.10, 0.075], head: 0.085, muzzle: 0.062, arms: 0.16, leg: [0.09, 0.105, 0.05] }
  };

  var shadeCache = {};
  function shade(hex, lvl) {
    var key = hex + lvl, c = shadeCache[key];
    if (c) return c;
    var n = parseInt(hex.slice(1), 16), f = lvl < 0 ? 1 : 0.6 + 0.1 * lvl;
    var rgb = [Math.round(((n >> 16) & 255) * f), Math.round(((n >> 8) & 255) * f), Math.round((n & 255) * f)];
    c = shadeCache[key] = { css: 'rgb(' + rgb.join(',') + ')', rgb: rgb, key: key };
    return c;
  }

  function projector(P) {
    var cy = Math.cos(P.yaw), sy = Math.sin(P.yaw), cp = Math.cos(P.pit), sp = Math.sin(P.pit);
    var cz = P.cz || 0;
    var fn = function (p) {
      var dx = p[0] - P.cx, dy = p[1] - P.cy, z = (p[2] || 0) - cz;
      var X = dx * cy + z * sy, D = -dx * sy + z * cy;
      return [P.ox + X * P.ppm, P.oy - (dy * cp - D * sp) * P.ppm, D];
    };
    fn.yaw = P.yaw;
    return fn;
  }

  // A box drawn as three upright slabs (far side, middle, near side), square-ended. o.ly is its draw layer.
  var CRATE_COL = { wood: '#96713c', band: '#3b4048' };
  function cratePrims(out, cr, o) {
    var c = cr.c, f = cr.f, u = cr.u, sd = cr.side, z = cr.size, ly = o && o.ly !== undefined ? o.ly : 2.5, j = (o && o.j) || null, k, zs;
    function at(a, b, w) { return [c[0] + f[0] * a + u[0] * b + sd[0] * w, c[1] + f[1] * a + u[1] * b + sd[1] * w, c[2] + f[2] * a + u[2] * b + sd[2] * w]; }
    for (k = 0; k < 3; k++) {
      zs = k - 1;
      out.push({ a: at(-z.d / 2, 0, zs * z.w / 2), b: at(z.d / 2, 0, zs * z.w / 2), r: z.h / 2, col: CRATE_COL.wood, g: 'crate', ly: ly, sh: 1 + k, j: j, sq: true, mid: true, zs: zs });
    }
    for (k = -1; k <= 1; k += 2) out.push({ a: at(k * z.d * 0.27, -z.h / 2, z.w / 2), b: at(k * z.d * 0.27, z.h / 2, z.w / 2), r: 0.018, col: CRATE_COL.band, g: 'crate', ly: ly, sh: 3, j: j, sq: true, mid: true, zs: 1.1 });
    return out;
  }

  // opt.flash === false leaves muzzle flashes out (the part list then never changes length).
  // opt.model: only what belongs to the character's own model (no crate in the hands). opt.pal: other colours.
  function buildPrims(p, c, opt) {
    var out = [], C = (opt && opt.pal) || PAL[c.id], grp = 'body', ly = 0, sh = 2, withFlash = !opt || opt.flash !== false;
    // a group is one body part: ly is its place in the draw order (low = behind), sh its shade (0 dark .. 4 light)
    function G(name, layer, shadeLevel) { grp = name; ly = layer; sh = shadeLevel; }
    // skeleton: J() declares a joint (its origin, and the point its bone aims at); parts drawn after it are bound to it
    var joints = [], curJ = null;
    // side, when given, is the joint's own right-hand direction; without it the model's is used
    function J(name, parent, o, aim, side) { joints.push({ name: name, parent: parent, o: o, aim: aim, side: side || null }); curJ = name; }
    function useJ(name) { curJ = name; }
    function sideName(base, k) { return base + (k === 0 ? '_R' : '_L'); }
    function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
    function unit(a) { var l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
    // the model's own right-hand direction in the world, and 'up' for something pointing along d
    var hd0 = p.heading || 0, rt = [-Math.sin(hd0), 0, Math.cos(hd0)];
    function perp(d) { return [rt[1] * d[2] - rt[2] * d[1], rt[2] * d[0] - rt[0] * d[2], rt[0] * d[1] - rt[1] * d[0]]; }
    function aside(pt, dist) { return add(pt, mul(rt, dist)); }
    // the same for whatever turns to aim sideways (torso and head, hull, the quadruped's head)
    var rtU = p.side || rt;
    function perpU(d) { return [rtU[1] * d[2] - rtU[2] * d[1], rtU[2] * d[0] - rtU[0] * d[2], rtU[0] * d[1] - rtU[1] * d[0]]; }
    function asideU(pt, dist) { return add(pt, mul(rtU, dist)); }
    function toward(a, b, dist) { return add(a, mul(unit(sub(b, a)), dist)); }
    function put(a, b, r, col, o) { var q = { a: a, b: b, r: r, col: col, g: grp, ly: ly, sh: sh, j: curJ }, k; if (o) for (k in o) q[k] = o[k]; out.push(q); }
    function cap(a, b, r, col, o) { put(a, b, r, col, o); }
    function ball(a, r, col, o) { put(a, null, r, col, o); }
    function flash(m, r) {
      if (!withFlash || !(m.flash > 0.05)) return;
      ball(add(m.tip, mul(m.dir, r * 0.9)), r * (0.6 + 0.6 * m.flash), '#ffd23f', { raw: true, fx: true });
      ball(add(m.tip, mul(m.dir, r * 0.7)), r * 0.45, '#fff6c9', { raw: true, fx: true });
    }
    var i, l, s;
    // wings: an arm bone and a hand bone each, with a membrane hung between them and the body
    function wingPrims(wings, parent, rMem, rBone) {
      wings.forEach(function (w, k) {
        var nm = k === 0 ? 'R' : 'L';
        G('wing' + k, k === 0 ? 3.6 : -3.6, k === 0 ? 3 : 1);
        var c1 = 0.42 * w.chord, c2 = 0.30 * w.chord;
        J('Wing_' + nm, parent, w.root, w.mid, w.t1);
        cap(add(w.root, mul(w.t1, c1)), add(mix(w.root, w.mid, 0.92), mul(w.t1, c1)), c1, C.wing, { of: 'wing' });
        cap(w.root, w.mid, rBone, C.wingBone || C.wing, { part: 'wing' });
        J('WingTip_' + nm, 'Wing_' + nm, w.mid, w.tip, w.t2);
        cap(add(w.mid, mul(w.t2, c2)), add(mix(w.mid, w.tip, 0.8), mul(w.t2, c2)), c2, C.wing, { of: 'wing' });
        cap(w.mid, w.tip, rBone * 0.7, C.wingBone || C.wing, { of: 'wing' });
      });
    }
    if (p.kind === 'biped') {
      var D = DRESS[c.id] || null;                 // null: a soldier, in armour
      for (i = 0; i < p.legs.length; i++) {
        l = p.legs[i]; if (i === 0) G('leg0', 2, 3); else G('leg1', -2, 1);
        J(sideName('UpperLeg', i), 'Hips', l.hip, l.knee);
        cap(l.hip, l.knee, 0.078, C.suit, { part: 'thigh' });
        J(sideName('LowerLeg', i), sideName('UpperLeg', i), l.knee, l.ankle);
        cap(l.knee, l.ankle, 0.058, C.suit, { part: 'shin' });
        if (!D) { cap(mix(l.knee, l.ankle, 0.5), l.ankle, 0.066, C.armor, { of: 'shin' }); ball(l.knee, 0.066, C.armor, { of: 'shin' }); }
        else if (D.boots) cap(mix(l.knee, l.ankle, 0.55), l.ankle, 0.064, C.shoe, { of: 'shin' });
        var fd = unit(sub(l.ball, l.heel)), fn = perp(fd), td = unit(sub(l.toe, l.ball)), tn = perp(td);
        J(sideName('Foot', i), sideName('LowerLeg', i), l.ankle, add(l.ankle, fd));
        cap(add(l.heel, mul(fn, 0.04)), add(l.ball, mul(fn, 0.04)), 0.046, D ? C.shoe : C.armor, { part: 'foot', end: add(l.toe, mul(tn, 0.04)) });
        J(sideName('Toe', i), sideName('Foot', i), l.ball, add(l.ball, td));
        cap(add(l.ball, mul(tn, 0.035)), add(l.toe, mul(tn, 0.035)), 0.04, D ? C.shoe : C.armor, { of: 'foot' });
      }
      var mid = mix(p.root, p.chest, 0.5), u = p.u, f = p.f;
      G('torso', 0, 2);
      var pkA = upY(add(p.chest, add(mul(f, -0.21), mul(u, -0.04))), p.pack), pkB = upY(add(mid, mul(f, -0.20)), p.pack);
      J('Hips', null, p.root, p.chest); J('Pack', 'Hips', pkA, pkB);
      if (!D) cap(pkA, pkB, 0.10, C.pack, { part: 'pack' });
      else if (D.tank) cap(add(pkA, mul(f, 0.03)), add(pkB, mul(f, 0.03)), 0.07, C.pack, { part: 'pack' });
      useJ('Hips');
      cap(p.legs[0].hip, p.legs[1].hip, 0.098, C.suit, { of: 'torso' });
      var gu = perpU(p.gaze), eye;
      if (!D) {
        cap(add(p.root, mul(u, 0.05)), mid, 0.122, C.suit, { part: 'torso', end: p.chest });
        J('Spine', 'Hips', mid, p.chest, rtU);
        cap(mid, add(p.chest, mul(u, -0.07)), 0.148, C.armor, { of: 'torso' });
        cap(p.arms[0].shoulder, p.arms[1].shoulder, 0.074, C.armor, { of: 'torso' });
        G('head', 0.1, 2);
        J('Head', 'Spine', p.head, add(p.head, perpU(p.gaze)), rtU);
        ball(p.head, 0.115, C.armor, { part: 'head' });
        ball(add(p.head, add(mul(p.gaze, 0.055), mul(gu, -0.022))), 0.076, C.dark, { of: 'head', on: p.head });
        eye = add(p.head, add(mul(p.gaze, 0.105), mul(gu, 0.012)));
        ball(asideU(eye, -0.04), 0.024, C.glow, { of: 'head', raw: true, on: p.head });
        ball(asideU(eye, 0.04), 0.024, C.glow, { of: 'head', raw: true, on: p.head });
      } else {
        // plain clothes: a jacket, coat or overall over the trousers, a bare head or a hat or a hood
        if (D.coat) cap(add(p.root, mul(u, 0.04)), add(p.root, mul(u, -D.coat)), 0.128, C.top, { of: 'torso' });
        cap(add(p.root, mul(u, 0.05)), mid, 0.120, C.top, { part: 'torso', end: p.chest });
        J('Spine', 'Hips', mid, p.chest, rtU);
        cap(mid, add(p.chest, mul(u, -0.07)), 0.134, C.top, { of: 'torso' });
        if (D.band) cap(add(mid, mul(u, 0.03)), add(mid, mul(u, 0.07)), 0.139, C.band, { of: 'torso' });
        cap(p.arms[0].shoulder, p.arms[1].shoulder, 0.066, C.top, { of: 'torso' });
        G('head', 0.1, 2);
        J('Head', 'Spine', p.head, add(p.head, perpU(p.gaze)), rtU);
        if (D.hood) {
          ball(p.head, 0.128, C.top, { part: 'head' });
          ball(add(p.head, add(mul(p.gaze, 0.062), mul(gu, -0.012))), 0.082, C.dark, { of: 'head', on: p.head });
          ball(add(p.head, add(mul(p.gaze, 0.082), mul(gu, -0.012))), 0.064, C.glass, { of: 'head', raw: true, on: p.head });
        } else {
          ball(p.head, 0.105, C.skin, { part: 'head' });
          if (D.hat) {
            ball(add(p.head, mul(gu, 0.035)), 0.108, C.hat, { of: 'head', on: p.head });
            cap(add(p.head, mul(gu, 0.045)), add(p.head, add(mul(p.gaze, 0.13), mul(gu, 0.040))), 0.022, C.hat, { of: 'head', on: p.head });
          } else ball(add(p.head, add(mul(p.gaze, -0.034), mul(gu, 0.030))), 0.090, C.hair, { of: 'head', on: p.head });
          eye = add(p.head, add(mul(p.gaze, 0.093), mul(gu, 0.008)));
          ball(asideU(eye, -0.036), 0.014, C.dark, { of: 'head', raw: true, on: p.head });
          ball(asideU(eye, 0.036), 0.014, C.dark, { of: 'head', raw: true, on: p.head });
        }
      }
      // a rider's reins, from the hands to the mount's mouth or neck
      if (p.reins) p.reins.forEach(function (r) { cap(r[0], r[1], 0.007, '#2a211a', { of: 'torso', raw: true }); });
      // props: whatever the character carries, in the hands or stowed. Each has its own joint, and its magazine another.
      (p.props || []).forEach(function (w, k) {
        var stowed = w.stow > 0.5, pistol = w.kind === 'pistol', civil = w.kind === 'case' || w.kind === 'trolley';
        var nm = pistol ? sideName('Weapon', k) : w.kind === 'shield' ? 'Shield' : civil ? 'Case' : 'Weapon';
        var sv = [w.dir[1] * w.up[2] - w.dir[2] * w.up[1], w.dir[2] * w.up[0] - w.dir[0] * w.up[2], w.dir[0] * w.up[1] - w.dir[1] * w.up[0]];
        if (pistol) G('prop' + k, k === 0 ? (stowed ? 2.1 : 3.1) : (stowed ? -2.1 : -2.9), k === 0 ? 3 : 1);
        else G('prop' + k, stowed ? -0.5 : 0.5, 2);
        J(nm, 'Hips', w.o, w.muzzle, sv);
        if (w.kind === 'case') {
          // a case seen from the side: slabs one under the other from its top edge down, and the handle above
          var bx = (D && D.box) || 3, bh = 0.30 / bx, zb;
          G('prop' + k, 2.6, 3);
          for (zb = 0; zb < bx; zb++) cap(add(w.o, mul(w.up, -bh * (zb + 0.5))), add(w.muzzle, mul(w.up, -bh * (zb + 0.5))), bh / 2, C.box, zb ? { of: 'case', sq: true } : { part: 'case', sq: true });
          cap(add(w.grip, mul(w.dir, -0.05)), add(w.grip, mul(w.dir, 0.05)), 0.012, C.trim, { of: 'case' });
          cap(add(w.body, mul(w.up, -0.02)), add(w.body, mul(w.up, -0.07)), 0.018, C.trim, { of: 'case' });
          return;
        }
        if (w.kind === 'trolley') {
          // a case on wheels: two slabs side by side lying on its handle's rods, the rods and the grip, and a wheel at each end of the axle
          G('prop' + k, -2.4, 1);
          for (zb = -1; zb <= 1; zb += 2) cap(add(w.magA, mul(sv, 0.09 * zb)), add(w.magB, mul(sv, 0.09 * zb)), 0.10, C.box, zb < 0 ? { part: 'case', sq: true } : { of: 'case', sq: true });
          cap(w.body, w.muzzle, 0.011, C.metal, { of: 'case' });
          cap(add(w.muzzle, mul(sv, -0.06)), add(w.muzzle, mul(sv, 0.06)), 0.014, C.trim, { of: 'case' });
          ball(add(w.o, mul(sv, -0.13)), 0.035, C.dark, { of: 'case' });
          ball(add(w.o, mul(sv, 0.13)), 0.035, C.dark, { of: 'case' });
          return;
        }
        if (w.kind === 'sword') {
          G('prop' + k, stowed ? -2.3 : 3.1, 3);
          cap(w.o, w.body, 0.022, C.dark, { part: 'weapon', end: w.muzzle });        // hilt
          cap(w.magA, w.magB, 0.018, '#b98a3a', { of: 'weapon' });                   // crossguard
          cap(w.body, mix(w.body, w.muzzle, 0.93), 0.026, '#c9ced6', { of: 'weapon', sq: true });
          cap(mix(w.body, w.muzzle, 0.9), w.muzzle, 0.012, '#c9ced6', { of: 'weapon' });
          return;
        }
        if (w.kind === 'shield') {
          // a board seen edge-on from the side: three upright slabs across its width, and a boss
          G('prop' + k, stowed ? -0.6 : -2.6, 1);
          for (var zk = -1; zk <= 1; zk++) cap(add(w.o, mul(sv, 0.19 * zk)), add(w.muzzle, mul(sv, 0.19 * zk)), 0.035, zk ? C.armor : C.pack, { of: 'shield', sq: true });
          ball(add(w.body, mul(w.up, -0.04)), 0.06, C.metal, { of: 'shield' });
          return;
        }
        if (pistol) {
          cap(w.o, w.muzzle, 0.024, C.metal, { part: 'weapon' });
          cap(w.grip, w.gripLow, 0.021, C.dark, { of: 'weapon' });
        } else {
          cap(w.o, w.body, 0.04, C.metal, { part: 'weapon', end: w.muzzle });
          cap(w.body, w.muzzle, 0.022, C.metal, { of: 'weapon' });
          cap(w.grip, w.gripLow, 0.024, C.dark, { of: 'weapon' });
        }
        J(pistol ? sideName('Magazine', k) : 'Magazine', nm, w.magA, w.magB, sv);
        cap(w.magA, w.magB, pistol ? 0.017 : 0.026, C.dark, { of: 'weapon' });
        if (!stowed) flash({ tip: w.muzzle, dir: w.dir, flash: w.flash }, pistol ? 0.06 : 0.09);
      });
      // a grenade on the belt, or in the throwing hand; and the place where a carried load sits
      var gr = p.grenade || { p: aside(add(p.root, add(mul(u, 0.09), mul(f, 0.07))), 0.185), held: false };
      G('grenade', gr.held ? 3.05 : 2.2, 3);
      J('Grenade', 'Hips', gr.p, add(gr.p, u));
      if (!D) ball(gr.p, 0.036, '#566238', { part: 'grenade' });
      var cr = p.carry || { c: add(p.root, add(mul(f, 0.34), mul(u, 0.22))), f: f, u: u, side: rtU };
      J('Carry', 'Hips', cr.c, add(cr.c, cr.u), cr.side);
      if (p.carry && !(opt && opt.model)) cratePrims(out, p.carry, { j: 'Carry' });
      for (i = 0; i < 2; i++) {
        s = p.arms[i]; if (i === 0) G('arm0', 3, 3); else G('arm1', -3, 1);
        J(sideName('UpperArm', i), 'Spine', s.shoulder, s.elbow);
        cap(s.shoulder, s.elbow, D ? 0.048 : 0.052, D ? C.top : C.suit, { part: 'upperArm' });
        J(sideName('LowerArm', i), sideName('UpperArm', i), s.elbow, s.hand);
        cap(s.elbow, s.hand, D ? 0.043 : 0.048, D ? C.top : C.armor, { part: 'forearm' });
        J(sideName('Hand', i), sideName('LowerArm', i), s.hand, add(s.hand, sub(s.hand, s.elbow)));
        ball(s.hand, D ? 0.042 : 0.046, D ? C.glove : C.dark, { of: 'forearm' });
      }
    } else if (p.kind === 'mech') {
      for (i = 0; i < p.legs.length; i++) {
        l = p.legs[i]; if (i === 0) G('leg0', 2, 3); else G('leg1', -2, 1);
        J(sideName('UpperLeg', i), 'Hips', l.hip, l.knee);
        cap(l.hip, l.knee, 0.27, C.hull, { part: 'thigh' });
        J(sideName('LowerLeg', i), sideName('UpperLeg', i), l.knee, l.ankle);
        cap(l.knee, l.ankle, 0.2, C.hull2, { part: 'shin' });
        cap(mix(l.knee, l.ankle, 0.28), mix(l.knee, l.ankle, 0.62), 0.24, C.accent, { of: 'shin' });
        ball(l.knee, 0.3, C.dark, { of: 'thigh' }); ball(l.ankle, 0.22, C.dark, { of: 'shin' });
        var md = unit(sub(l.ball, l.heel)), mn = perp(md), me = unit(sub(l.toe, l.ball)), mt = perp(me);
        J(sideName('Foot', i), sideName('LowerLeg', i), l.ankle, add(l.ankle, md));
        cap(add(l.heel, mul(mn, 0.16)), add(l.ball, mul(mn, 0.16)), 0.17, C.dark, { part: 'foot', end: add(l.toe, mul(mt, 0.13)) });
        J(sideName('Toe', i), sideName('Foot', i), l.ball, add(l.ball, me));
        cap(add(l.ball, mul(mt, 0.13)), add(l.toe, mul(mt, 0.13)), 0.14, C.dark, { of: 'foot' });
      }
      var pc = p.chest, mu = p.u, mf = p.f;
      G('hull', 0, 2);
      J('Hips', null, p.root, pc);
      cap(p.legs[0].hip, p.legs[1].hip, 0.3, C.dark, { of: 'hull' });
      cap(p.root, add(pc, mul(mu, -0.5)), 0.3, C.metal, { of: 'hull' });
      J('Hull', 'Hips', pc, add(pc, mu), rtU);
      ball(pc, 0.9, C.hull, { part: 'hull' });
      ball(asideU(add(pc, add(mul(mf, 0.5), mul(mu, 0.12))), 0.3), 0.43, C.glass, { of: 'hull' });
      for (i = 0; i < 2; i++) {
        var sd = i === 0 ? 1 : -1, m = p.mounts[i];
        var ra = asideU(add(pc, add(mul(mu, 0.95), mul(mf, -0.3))), sd * 0.72), rb = asideU(add(pc, add(mul(mu, 0.95), mul(mf, 0.3))), sd * 0.72);
        G('rack' + i, sd * 3, sd > 0 ? 3 : 1); useJ('Hull');
        cap(ra, rb, 0.27, C.hull2, { of: 'hull' }); ball(add(rb, mul(mf, 0.22)), 0.1, C.accent, { of: 'hull' });
        G('gun' + i, sd * 4, sd > 0 ? 4 : 0);
        ball(m.joint, 0.3, C.dark, { of: 'gun' });
        J(sideName('Gun', i), 'Hull', m.base, add(m.base, m.dir));
        cap(m.base, add(m.base, mul(m.dir, 1.2)), 0.27, C.hull2, { part: 'gun', end: m.tip });
        cap(add(m.base, mul(m.dir, 1.1)), m.tip, 0.17, C.metal, { of: 'gun' });
        flash(m, 0.4);
      }
    } else if (p.kind === 'quad' && c.beast) {
      // an animal: two body halves on a bending spine, neck, head with a hinged jaw, a chain of tail links, legs. LOOK holds its build.
      var BL = [[2, 3], [2.5, 3], [-2, 1], [-2.5, 1]], hup = perpU(p.gaze), bz = c.beast, K = LOOK[c.id], twoLegs = p.legs.length === 2, wide = Math.abs(c.legs[twoLegs ? 0 : 1].attach[2]);
      // each half of the body has its own 'up', since the spine bends between them
      var axF = unit(sub(p.front, p.root)), axB = unit(sub(p.back, p.root)), bu = perp(axF), buB = mul(perp(axB), -1);
      var nd = unit(sub(p.head, p.neck)), nu = perp(nd);
      G('tail', -0.3, 2);
      var tp = p.tailPts || [p.back, p.tail], tn = tp.length - 1;
      for (i = 0; i < tn; i++) {
        var tr = lerp(K.tail[0], K.tail[1], i / Math.max(tn - 1, 1)), tdv = unit(sub(tp[i + 1], tp[i]));
        J('Tail' + (i + 1), i ? 'Tail' + i : 'Hips', tp[i], tp[i + 1]);
        cap(tp[i], tp[i + 1], tr, K.tailCol ? C[K.tailCol] : K.tailDark && i >= tn - 2 ? C.dark : C.coat, { of: 'body' });
        if (K.stripes) cap(add(tp[i], mul(perp(tdv), -tr * 0.55)), add(mix(tp[i], tp[i + 1], 0.45), mul(perp(tdv), -tr * 0.55)), tr * 0.62, C.mane, { of: 'body' });
      }
      G('body', 0, 2);
      J('Hips', null, p.root, p.back);
      cap(p.root, p.back, K.hind, C.coat, { part: 'body', end: p.front });
      if (K.stripes) cap(add(p.root, mul(buB, K.hind * 0.6)), add(p.back, mul(buB, K.hind * 0.55)), K.hind * 0.55, C.mane, { of: 'body' });
      J('Chest', 'Hips', p.root, p.front);
      cap(p.root, add(p.front, mul(bu, -0.02)), K.chest, C.coat, { of: 'body' });
      if (K.belly) cap(add(p.root, mul(bu, -K.chest * 0.5)), add(p.front, mul(bu, -K.chest * 0.55)), K.chest * 0.62, C.belly, { of: 'body' });
      cap(add(mix(p.root, p.front, 0.2), mul(bu, K.chest * 0.82)), add(p.neck, mul(bu, 0.05)), K.crest, C.mane, { of: 'body' });      // the crest over the shoulders
      // the neck is two sleeves, one on the shoulders and one on the head, so that it can stretch for a bite
      J('Neck', 'Chest', p.neck, p.head);
      cap(add(p.neck, mul(nd, -0.05)), add(p.neck, mul(nd, 0.62 * bz.neck)), K.neck[0], C.coat, { of: 'body' });
      cap(add(p.neck, mul(nu, K.neck[0] * 0.7)), add(p.neck, add(mul(nd, 0.6 * bz.neck), mul(nu, K.neck[0] * 0.7))), K.crest * 0.8, C.mane, { of: 'body' });
      J('NeckTop', 'Neck', p.head, add(p.head, nd));
      cap(add(p.head, mul(nd, -0.6 * bz.neck)), p.head, K.neck[1], C.coat, { of: 'body' });
      if (K.saddle) {
        // tack: a saddle on the back, and its girth
        useJ('Chest');
        var sdl = add(p.root, mul(bu, K.chest * 0.93));
        cap(add(sdl, mul(axF, -0.15)), add(sdl, mul(axF, 0.17)), 0.06, C.tack, { of: 'body' });
        cap(add(p.root, add(mul(axF, 0.10), mul(bu, K.chest * 0.8))), add(p.root, add(mul(axF, 0.10), mul(bu, -K.chest * 0.8))), 0.025, C.tack, { of: 'body' });
      }
      if (K.spots) K.spots.forEach(function (sp) {
        for (s = -1; s <= 1; s += 2) {
          var ax2 = sp[0] < 0 ? axB : axF, n2 = sp[0] < 0 ? buB : bu;
          G('spots' + (s > 0 ? 'N' : 'F'), s * 1.2, s > 0 ? 3 : 1); useJ(sp[0] < 0 ? 'Hips' : 'Chest');
          ball(aside(add(p.root, add(mul(ax2, Math.abs(sp[0])), mul(n2, sp[1]))), s * (wide + 0.035)), sp[2], C.spot, { of: 'body' });
        }
      });
      if (K.arms) for (s = -1; s <= 1; s += 2) {
        // small arms, held folded under the chest
        G('arm' + (s > 0 ? 'N' : 'F'), s * 1.5, s > 0 ? 3 : 1); useJ('Chest');
        var as = aside(add(p.front, add(mul(axF, -0.10), mul(bu, -K.chest * 0.7))), s * (wide * 0.8)), ae = add(as, add(mul(axF, 0.05), mul(bu, -K.arms))), ah = add(ae, add(mul(axF, K.arms * 0.9), mul(bu, 0.03)));
        cap(as, ae, 0.032, C.coat, { of: 'body' }); cap(ae, ah, 0.026, C.leg, { of: 'body' }); ball(ah, 0.03, C.dark, { of: 'body' });
      }
      G('head', 0.5, 2);
      J('Head', 'Neck', p.head, add(p.head, p.gaze), rtU);
      ball(p.head, K.head, C.coat, { part: 'head' });
      cap(add(p.head, mul(p.gaze, K.head * 0.7)), add(p.head, add(mul(p.gaze, bz.skull - K.muzzle), mul(hup, -0.004))), K.muzzle, C.muzzle, { of: 'head' });
      if (K.nose) ball(add(p.head, mul(p.gaze, bz.skull - 0.02)), 0.03, C.dark, { of: 'head' });
      for (s = -1; s <= 1; s += 2) ball(asideU(add(p.head, add(mul(p.gaze, K.head * 0.8), mul(hup, K.head * 0.35))), s * K.head * 0.57), 0.017, C.eye, { of: 'head', raw: true, on: p.head });
      if (K.ears) {
        // ears: they go back when the animal is roused
        var es = K.head / 0.088, earAt = add(p.head, add(mul(hup, 0.085 * es), mul(p.gaze, (-0.03 - 0.05 * (p.alert || 0)) * es)));
        J('Ears', 'Head', earAt, add(earAt, p.gaze), rtU);
        for (s = -1; s <= 1; s += 2) ball(asideU(earAt, s * 0.062 * es), 0.04 * es, C.mane, { of: 'head' });
      }
      var jw = p.mounts[0];
      G('jaw', 0.4, 1);
      J('Jaw', 'Head', jw.base, jw.tip, rtU);
      cap(jw.base, jw.tip, K.muzzle * 0.6, C.muzzle, { of: 'head' });
      for (i = 0; i < p.legs.length; i++) {
        l = p.legs[i]; var lyr = twoLegs ? (i === 0 ? [2, 3] : [-2, 1]) : BL[i]; G('leg' + i, lyr[0], lyr[1]);
        var front = c.legs[i].attach[0] > 0;
        J('UpperLeg_' + c.legs[i].name, front ? 'Chest' : 'Hips', l.hip, l.knee);
        cap(l.hip, l.knee, front ? K.leg[0] : K.leg[1], C.coat, { part: 'upperLeg' });
        J('LowerLeg_' + c.legs[i].name, 'UpperLeg_' + c.legs[i].name, l.knee, l.ankle);
        if (l.heel) {
          // walks on its toes: shin, then the long foot bone down to the toes, then the toes and a claw
          var fd2 = unit(sub(l.ball, l.heel)), td3 = unit(sub(l.toe, l.ball));
          cap(l.knee, l.ankle, K.leg[2], C.coat, { part: 'lowerLeg' });
          J('Foot_' + c.legs[i].name, 'LowerLeg_' + c.legs[i].name, l.ankle, add(l.ankle, fd2));
          cap(l.ankle, add(l.ball, mul(perp(fd2), 0.03)), K.leg[2] * 0.8, C.leg, { of: 'lowerLeg' });
          J('Toe_' + c.legs[i].name, 'Foot_' + c.legs[i].name, l.ball, add(l.ball, td3));
          cap(add(l.ball, mul(perp(td3), 0.03)), add(l.toe, mul(perp(td3), 0.03)), 0.032, C.leg, { of: 'lowerLeg' });
          cap(add(l.toe, mul(perp(td3), 0.03)), add(l.toe, add(mul(td3, 0.06), mul(perp(td3), 0.012))), 0.016, C.dark, { of: 'lowerLeg' });
        } else {
          var pe = toward(l.ankle, l.knee, 0.035);
          cap(l.knee, pe, K.leg[2], C.leg, { part: 'lowerLeg' });
          ball(pe, K.leg[2] + 0.005, C.dark, { of: 'lowerLeg' });
        }
      }
      if (p.wings) wingPrims(p.wings, 'Chest', K.wing ? K.wing[0] : 0.2, K.wing ? K.wing[1] : 0.05);
    } else if (c.octo) {
      // an octopus: a mantle, a head with two eyes, and eight arms of six tapering links each
      var om = p.mantle, oax = unit(sub(om.tip, om.c)), oup = perp(oax), on4 = p.arms.length / 2;
      G('body', 0, 2);
      J('Body', null, p.root, add(p.root, p.axis));
      J('Mantle', 'Body', om.c, om.tip);
      cap(om.c, om.tip, om.r, C.skin, { part: 'mantle' });
      ball(add(om.tip, mul(oax, om.r * 0.1)), om.r * 0.86, C.skin2, { of: 'mantle' });
      for (s = -1; s <= 1; s += 2) ball(aside(add(mix(om.c, om.tip, 0.45), mul(oup, om.r * 0.55)), s * om.r * 0.5), om.r * 0.2, C.pale, { of: 'mantle' });
      useJ('Body');
      ball(p.root, c.octo.head, C.skin, { part: 'head' });
      J('Eyes', 'Body', p.eye, add(p.eye, p.axis));              // the eyes sit between mantle and arms, wherever those are
      for (s = -1; s <= 1; s += 2) { ball(aside(p.eye, s * 0.085), 0.042, C.pale, { of: 'head', on: p.eye }); ball(aside(add(p.eye, mul(p.mounts[0].dir, 0.012)), s * 0.105), 0.02, C.dark, { of: 'head', raw: true, on: p.eye }); }
      p.arms.forEach(function (arm, k) {
        var near = k < on4, lyr2 = (near ? 1 : -1) * (2 + 0.2 * (k % on4)), an = arm.length - 1;
        G('arm' + k, lyr2, near ? 3 : 1);
        for (i = 0; i < an; i++) {
          J('Arm' + k + '_' + (i + 1), i ? 'Arm' + k + '_' + i : 'Body', arm[i], arm[i + 1]);
          cap(arm[i], arm[i + 1], lerp(0.075, 0.018, i / (an - 1)), i % 2 ? C.skin : C.skin2, i === 0 ? { part: 'arm' } : { of: 'arm' });
        }
      });
    } else if (c.arthro) {
      // arthropods: a scorpion (carapace, beaded tail with a sting, two claws), a mantis (upright front, folded striking forelegs), a wasp (thorax, hanging striped abdomen, wings)
      var az = c.arthro, look = az.look || 'scorpion', sax = unit(sub(p.front, p.back)), sup = perp(sax), sn4 = p.legs.length / 2, st4 = p.tailPts, sn5 = st4 ? st4.length - 1 : 0;
      J('Body', null, p.back, p.front);
      G('tail', look === 'wasp' ? -0.2 : 0.7, 2);
      for (i = 0; i < sn5; i++) {
        J('Tail' + (i + 1), i ? 'Tail' + i : 'Body', st4[i], st4[i + 1]);
        if (look === 'wasp') {
          cap(st4[i], mix(st4[i], st4[i + 1], 0.85), [0.10, 0.105, 0.07][i] || 0.06, i % 2 ? C.shell : C.shell2, { of: 'body' });
          if (i === sn5 - 1) cap(mix(st4[i], st4[i + 1], 0.85), add(st4[i + 1], mul(unit(sub(st4[i + 1], st4[i])), 0.07)), 0.014, C.dark, { of: 'body' });
        } else if (i < sn5 - 1) { cap(st4[i], mix(st4[i], st4[i + 1], 0.8), lerp(0.075, 0.055, i / sn5), C.shell, { of: 'body' }); ball(st4[i + 1], 0.045, C.dark, { of: 'body' }); }
        else { ball(mix(st4[i], st4[i + 1], 0.3), 0.07, C.sting, { of: 'body' }); cap(mix(st4[i], st4[i + 1], 0.5), st4[i + 1], 0.02, C.dark, { of: 'body' }); }
      }
      G('body', 0, 2); useJ('Body');
      if (look === 'scorpion') {
        cap(mix(p.back, p.front, 0.45), p.front, 0.17, C.shell, { part: 'body', end: p.back });
        for (i = 0; i < 4; i++) ball(mix(p.back, p.front, 0.38 - 0.13 * i), 0.165 - 0.018 * i, i % 2 ? C.shell : C.shell2, { of: 'body' });
        ball(add(p.front, mul(sup, 0.06)), 0.03, C.eye, { of: 'body', raw: true });
      } else if (look === 'mantis') {
        // a long abdomen behind with the wings folded over it, a thin upright front, a small head with big eyes and feelers
        cap(add(p.back, mul(sax, -0.55)), mix(p.back, p.front, 0.5), 0.085, C.shell, { part: 'body', end: p.front });
        cap(add(p.back, add(mul(sax, -0.62), mul(sup, 0.07))), add(mix(p.back, p.front, 0.7), mul(sup, 0.07)), 0.06, C.wing, { of: 'body' });
        cap(mix(p.back, p.front, 0.5), p.thorax[0], 0.07, C.shell2, { of: 'body' });
        J('Thorax', 'Body', p.thorax[0], p.thorax[1]);
        cap(p.thorax[0], p.thorax[1], 0.045, C.shell2, { of: 'body' });
        J('Head', 'Thorax', p.eye, add(p.eye, sax));
        ball(p.eye, 0.07, C.shell, { part: 'head' });
        for (s = -1; s <= 1; s += 2) {
          ball(aside(add(p.eye, add(mul(sax, 0.02), mul(sup, 0.03))), s * 0.065), 0.04, C.eye, { of: 'head', raw: true, on: p.eye });
          cap(aside(add(p.eye, mul(sup, 0.06)), s * 0.02), aside(add(p.eye, add(mul(sax, 0.16), mul(sup, 0.26))), s * 0.07), 0.008, C.dark, { of: 'head' });
        }
      } else {
        cap(p.back, p.front, 0.105, C.shell, { part: 'body' });
        ball(mix(p.back, p.front, 0.5), 0.115, C.shell2, { of: 'body' });
        J('Head', 'Body', p.eye, add(p.eye, sax));
        ball(p.eye, 0.085, C.shell2, { part: 'head' });
        for (s = -1; s <= 1; s += 2) {
          ball(aside(add(p.eye, add(mul(sax, 0.03), mul(sup, 0.02))), s * 0.06), 0.045, C.eye, { of: 'head', raw: true, on: p.eye });
          cap(aside(add(p.eye, mul(sup, 0.06)), s * 0.03), aside(add(p.eye, add(mul(sax, 0.14), mul(sup, 0.12))), s * 0.06), 0.008, C.dark, { of: 'head' });
        }
      }
      (p.claws || []).forEach(function (cl, k) {
        var nm = k === 0 ? 'R' : 'L', hd3 = unit(sub(cl.tip, cl.wrist)), mt = look === 'mantis';
        G('claw' + k, k === 0 ? 3.2 : -3.2, k === 0 ? 3 : 1);
        J('ClawUpper_' + nm, mt ? 'Thorax' : 'Body', cl.shoulder, cl.elbow); cap(cl.shoulder, cl.elbow, mt ? 0.05 : 0.045, mt ? C.shell : C.limb, { of: 'claw' });
        J('ClawLower_' + nm, 'ClawUpper_' + nm, cl.elbow, cl.wrist); cap(cl.elbow, cl.wrist, mt ? 0.036 : 0.045, C.limb, { of: 'claw' });
        J('ClawHand_' + nm, 'ClawLower_' + nm, cl.wrist, cl.tip);
        if (mt) cap(cl.wrist, cl.tip, 0.02, C.dark, { part: 'claw' });
        else { cap(cl.wrist, add(cl.wrist, mul(hd3, 0.3 * az.claw.hand)), 0.075, C.shell, { part: 'claw' }); cap(add(cl.wrist, mul(hd3, 0.3 * az.claw.hand)), cl.tip, 0.028, C.shell2, { of: 'claw' }); }
        J('ClawFinger_' + nm, 'ClawHand_' + nm, cl.fingerA, cl.fingerB);
        cap(cl.fingerA, mt ? mix(cl.fingerA, cl.fingerB, 0.4) : cl.fingerB, mt ? 0.012 : 0.024, mt ? C.dark : C.shell2, { of: 'claw' });
      });
      for (i = 0; i < p.legs.length; i++) {
        l = p.legs[i]; var near = i < sn4, ord = (near ? 1 : -1) * (2 + 0.2 * (i % sn4)), lr = look === 'scorpion' ? 1 : 0.75; G('leg' + i, ord, near ? 3 : 1);
        J('UpperLeg_' + c.legs[i].name, 'Body', l.hip, l.knee);
        cap(l.hip, l.knee, 0.034 * lr, C.limb, { part: 'upperLeg' });
        J('LowerLeg_' + c.legs[i].name, 'UpperLeg_' + c.legs[i].name, l.knee, l.ankle);
        cap(l.knee, mix(l.knee, l.ankle, 0.7), 0.028 * lr, C.limb, { part: 'lowerLeg' });
        cap(mix(l.knee, l.ankle, 0.7), l.ankle, 0.014 * lr, C.dark, { of: 'lowerLeg' });
        ball(l.knee, 0.036 * lr, look === 'scorpion' ? C.shell2 : C.limb, { of: 'upperLeg' });
      }
      if (p.wings) wingPrims(p.wings, 'Body', 0.045, 0.02);
    } else if (p.kind === 'quad') {
      var up = p.up, QL = [[2, 3], [2.5, 3], [-2, 1], [-2.5, 1]];
      G('body', 0, 2);
      J('Body', null, p.back, p.front); J('Tail', 'Body', p.back, p.tail);
      cap(p.back, p.tail, 0.03, C.dark, { of: 'body' });
      useJ('Body');
      cap(p.back, p.front, 0.15, C.hull, { part: 'body' });
      cap(add(mix(p.back, p.front, 0.25), mul(up, 0.06)), add(mix(p.back, p.front, 0.75), mul(up, 0.06)), 0.125, C.armor, { of: 'body' });
      J('Neck', 'Body', add(p.front, mul(up, 0.03)), p.head);
      cap(add(p.front, mul(up, 0.03)), p.head, 0.075, C.hull, { of: 'body' });
      G('head', 0.5, 2);
      J('Head', 'Neck', p.head, add(p.head, p.gaze), rtU);
      cap(p.mounts[0].base, p.mounts[0].tip, 0.028, C.dark, { of: 'head' });
      cap(p.head, add(p.head, mul(p.gaze, 0.2)), 0.085, C.armor, { part: 'head' });
      var qu = perpU(p.gaze);
      ball(asideU(add(p.head, add(mul(p.gaze, 0.21), mul(qu, 0.03))), 0.05), 0.03, C.eye, { of: 'head', raw: true, on: add(p.head, mul(p.gaze, 0.21)) });
      flash(p.mounts[0], 0.07);
      for (i = 0; i < p.legs.length; i++) {
        l = p.legs[i]; G('leg' + i, QL[i][0], QL[i][1]);
        J('UpperLeg_' + c.legs[i].name, 'Body', l.hip, l.knee);
        cap(l.hip, l.knee, 0.058, C.hull, { part: 'upperLeg' });
        ball(l.hip, 0.085, C.armor, { of: 'upperLeg' });
        J('LowerLeg_' + c.legs[i].name, 'UpperLeg_' + c.legs[i].name, l.knee, l.ankle);
        var qe = toward(l.ankle, l.knee, 0.04);
        cap(l.knee, qe, 0.045, C.hull, { part: 'lowerLeg' });
        ball(qe, 0.048, C.dark, { of: 'lowerLeg' });
      }
    } else {
      var HL = [2, 4, 3, -2, -4, -3];           // the middle legs reach furthest out to the side
      G('body', 0, 2);
      J('Body', null, p.back, p.front);
      cap(p.back, p.front, 0.5, C.hull, { part: 'body' });
      ball(p.dome, 0.62, C.hull2, { of: 'body' });
      ball(p.eye, 0.1, C.eye, { of: 'body', raw: true });
      var t = p.mounts[0];
      G('turret', 0.5, 2);
      ball(t.joint, 0.22, C.dark, { of: 'turret' });
      J('Turret', 'Body', t.base, add(t.base, t.dir));
      cap(t.base, add(t.base, mul(t.dir, 0.55)), 0.14, C.dark, { of: 'turret' });
      cap(t.base, t.tip, 0.08, C.metal, { part: 'turret' });
      flash(t, 0.22);
      for (i = 0; i < p.legs.length; i++) {
        l = p.legs[i]; G('leg' + i, HL[i], HL[i] > 0 ? 3 : 1);
        J('UpperLeg_' + c.legs[i].name, 'Body', l.hip, l.knee);
        cap(l.hip, l.knee, 0.1, C.hull, { part: 'upperLeg' });
        ball(l.hip, 0.16, C.dark, { of: 'upperLeg' });
        J('LowerLeg_' + c.legs[i].name, 'UpperLeg_' + c.legs[i].name, l.knee, l.ankle);
        var he = toward(l.ankle, l.knee, 0.05);
        cap(l.knee, he, 0.072, C.hull2, { part: 'lowerLeg' });
        cap(mix(l.knee, l.ankle, 0.82), he, 0.05, C.dark, { of: 'lowerLeg' });
        ball(l.knee, 0.13, C.dark, { of: 'upperLeg' });
      }
    }
    out.joints = joints; out.heading = p.heading || 0;
    return out;
  }

  function ladderPrims(out, lad, yA, yB) {
    var col = '#7d868b';
    out.push({ a: [lad.x, yA, -0.22], b: [lad.x, yB, -0.22], r: 0.02, col: col, g: 'railFar', ly: -10, sh: 1 });
    var k0 = Math.floor((yA - lad.y0) / lad.spacing), k1 = Math.ceil((yB - lad.y0) / lad.spacing);
    for (var k = Math.max(k0, 0); k <= k1; k++) out.push({ a: [lad.x, lad.rung(k), -0.22], b: [lad.x, lad.rung(k), 0.22], r: 0.014, col: col, g: 'rungs', ly: 0.6, sh: 2 });
    out.push({ a: [lad.x, yA, 0.22], b: [lad.x, yB, 0.22], r: 0.02, col: col, g: 'railNear', ly: 10, sh: 3 });
  }

  /* Draw order. Every part belongs to a group (a leg, the torso, the head) with an authored layer,
     the way a 2D cut-out rig lists its parts back to front: far arm, far leg, torso, head, weapon,
     near leg, near arm. Inside a group parts keep the order they were written in, so nothing
     flickers. Layers of 1 and above are the parts on one side of the body: when the camera sees
     the model's other side (it has turned round), those swap over, near for far. */
  function flipped(prims, proj) { return Math.cos((prims.heading || 0) - (proj.yaw || 0)) < -1e-9; }
  function order(prims, proj) {
    var i, q, fl = flipped(prims, proj);
    for (i = 0; i < prims.length; i++) {
      q = prims[i]; q.pa = proj(q.a); q.pb = q.b ? proj(q.b) : null; q.pe = q.end ? proj(q.end) : null; q.i = i;
      // mid: something on the centre line that is in front whichever side it is seen from (a box in the arms);
      // only its own slabs swap over
      var side = Math.abs(q.ly) >= 1 && !q.mid;
      q.k = (fl && side ? -q.ly : q.ly) + (q.mid ? (fl ? -0.01 : 0.01) * (q.zs || 0) : 0) + (q.kb || 0);
      // something on the surface of a rounder part (an eye on a head): on the side turned away from the viewer it goes behind that part
      if (q.on && q.pa[2] < proj(q.on)[2] - 0.004) q.k -= 0.005;
      q.lv = q.raw ? -1 : fl && (side || q.mid) ? 4 - q.sh : q.sh;
    }
    var res = prims.slice().sort(function (m, n) { return (m.k - n.k) || (m.i - n.i); });
    res.flip = fl;
    return res;
  }
  function level(q) { return q.lv === undefined ? q.sh : q.lv; }

  // ---- pictures on bones
  /* Where a part's picture goes on the screen. a, b: the bone's ends on the screen (b null for a ball), rs: the part's
     radius there, ppm: pixels to a metre, flip: the body is seen from its other side.
     A plain picture (im.w, im.h, im.axis) covers the part's capsule, as SLOTS describes. A picture taken from a
     drawing also has im.box = [x0, y0, x1, y1]: the picture's own box in the bone's frame, in metres, as it was drawn
     over a bone im.len long and im.r thick. Along the bone it stretches with the bone, so that what was drawn at the
     joint stays at the joint and what was drawn at the far end stays there; across the bone it keeps its size.
     Returns where to draw: move to (x, y), turn by rot, scale by (fx, fy), then the picture's box (dx, dy, dw, dh). */
  function partPlace(im, a, b, rs, ppm, flip) {
    var o = { x: a[0], y: a[1], rot: 0, fx: 1, fy: 1 }, bx = im.box, t;
    if (im.axis === 'ball' || !b) {
      if (flip) o.fx = -1;
      if (bx) { o.dx = bx[0] * ppm; o.dy = bx[1] * ppm; o.dw = (bx[2] - bx[0]) * ppm; o.dh = (bx[3] - bx[1]) * ppm; }
      else { o.dh = 2.3 * rs; o.dw = o.dh * im.w / im.h; o.dx = -o.dw / 2; o.dy = -o.dh / 2; }
      return o;
    }
    if (im.axis === 'up') { t = a; a = b; b = t; o.x = a[0]; o.y = a[1]; }
    var ex = b[0] - a[0], ey = b[1] - a[1], dist = Math.sqrt(ex * ex + ey * ey), len = dist + 2 * rs, ang = Math.atan2(ey, ex);
    // a bone seen end on has no length on the screen: the picture is then no shorter than the part is thick
    var k = bx ? Math.max(dist / (im.len * ppm), 2 * rs / ((im.len + 2 * im.r) * ppm)) : 1;
    if (im.axis === 'right') {
      o.rot = ang; if (flip) o.fy = -1;
      if (bx) { o.dx = bx[0] * ppm * k; o.dy = bx[1] * ppm; o.dw = (bx[2] - bx[0]) * ppm * k; o.dh = (bx[3] - bx[1]) * ppm; }
      else { o.dh = len * im.h / im.w; o.dw = len; o.dx = -rs; o.dy = -o.dh / 2; }
    } else {
      o.rot = ang - Math.PI / 2; if (flip) o.fx = -1;
      if (bx) { o.dx = bx[0] * ppm; o.dy = bx[1] * ppm * k; o.dw = (bx[2] - bx[0]) * ppm; o.dh = (bx[3] - bx[1]) * ppm * k; }
      else { o.dw = len * im.w / im.h; o.dh = len; o.dx = -o.dw / 2; o.dy = -rs; }
    }
    return o;
  }
  /* What to draw for a body, back to front: for a game that draws in 2D, live. prims: buildPrims(pose, character);
     proj: a projector; ppm: its pixels to a metre; parts (optional): pictures by part name, as a drawing gives them
     (drawing.js) or as loaded one by one ({ img, w, h, axis }). Each item is one of
       { kind: 'part', slot, im, dark, at }      a picture: at is where it goes (partPlace); dark: on the far side
       { kind: 'cap', a, b, r, col, sq }         a plain capsule from a to b on the screen, r thick; sq: square ends
       { kind: 'ball', a, r, col }               a plain disc
     col is { css, rgb }. A part that has a picture hides the plain shapes it stands for. */
  function sprites(prims, proj, ppm, parts) {
    var sorted = order(prims, proj), out = [], i, q, lv;
    for (i = 0; i < sorted.length; i++) {
      q = sorted[i]; lv = level(q);
      if (parts && q.of && parts[q.of]) continue;
      if (parts && q.part && parts[q.part]) out.push({ kind: 'part', slot: q.part, im: parts[q.part], dark: lv < 2, at: partPlace(parts[q.part], q.pa, q.pe || q.pb, q.r * ppm, ppm, sorted.flip), q: q });
      else out.push({ kind: q.pb ? 'cap' : 'ball', a: q.pa, b: q.pb, r: Math.max(q.r * ppm, 0.6), col: shade(q.col, lv), sq: !!q.sq, q: q });
    }
    return out;
  }
  /* Draws what sprites() lists on a 2D canvas. A picture is im.img, or im.dark for the far side if there is one. */
  function drawSprites(c, items) {
    for (var i = 0; i < items.length; i++) {
      var s = items[i];
      if (s.kind === 'part') {
        var o = s.at;
        c.save(); c.translate(o.x, o.y); if (o.rot) c.rotate(o.rot); if (o.fx !== 1 || o.fy !== 1) c.scale(o.fx, o.fy);
        c.drawImage(s.dark && s.im.dark ? s.im.dark : s.im.img, o.dx, o.dy, o.dw, o.dh); c.restore();
      } else if (s.kind === 'cap') {
        var bx = s.b[0], by = s.b[1];
        if (Math.abs(bx - s.a[0]) + Math.abs(by - s.a[1]) < 0.05) bx += 0.05;
        c.lineCap = s.sq ? 'butt' : 'round'; c.strokeStyle = s.col.css; c.lineWidth = 2 * s.r; c.beginPath(); c.moveTo(s.a[0], s.a[1]); c.lineTo(bx, by); c.stroke();
      } else { c.fillStyle = s.col.css; c.beginPath(); c.arc(s.a[0], s.a[1], s.r, 0, 6.2832); c.fill(); }
    }
  }
  /* The other way, for reading a drawing: the turn and shift that take a point of the page into the bone's frame
     (the one im.box is measured in), for a bone drawn from a to b on the page. { rot (radians), x, y }: turn the page
     by rot about the origin after moving (x, y) to it. */
  function partFrame(axis, a, b) {
    if (axis === 'ball' || !b) return { rot: 0, x: a[0], y: a[1] };
    if (axis === 'up') { var t = a; a = b; b = t; }
    var ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return { rot: axis === 'right' ? -ang : Math.PI / 2 - ang, x: a[0], y: a[1] };
  }
  // A rider's parts and its mount's as one list to draw: the rider's far side goes behind the whole mount, the rest in front of it.
  function pair(mount, rider) {
    var out = mount.slice(), i, q;
    for (i = 0; i < rider.length; i++) { q = rider[i]; if (Math.abs(q.ly) >= 1 && !q.mid) q.ly += q.ly < 0 ? -10 : 10; else q.kb = 10; out.push(q); }
    out.joints = mount.joints; out.heading = mount.heading;
    return out;
  }

  var DIRS = { gaze: 1, u: 1, f: 1, dir: 1, axis: 1, up: 1, side: 1, t1: 1, t2: 1 };
  function shiftPose(o, dx, dy, dz) {
    dz = dz || 0;
    function go(v, key) {
      if (Array.isArray(v)) {
        if (v.length === 3 && typeof v[0] === 'number') return DIRS[key] ? v : [v[0] + dx, v[1] + dy, v[2] + dz];
        return v.map(function (e) { return go(e, key); });
      }
      if (v && typeof v === 'object') { var r = {}; for (var k in v) r[k] = go(v[k], k); return r; }
      return v;
    }
    return go(o, null);
  }

  return { LOOK: LOOK, partPlace: partPlace, partFrame: partFrame, sprites: sprites, drawSprites: drawSprites, PAL: PAL, SPRITE: SPRITE, SLOTS: SLOTS, shade: shade, shadeCache: shadeCache, projector: projector, buildPrims: buildPrims,
    ladderPrims: ladderPrims, cratePrims: cratePrims, order: order, level: level, shiftPose: shiftPose, pair: pair };
});
