#!/usr/bin/env node
// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
/* Writes the files every version of the library is checked against:
     spec/characters.json      the built-in characters, as data
     spec/kernel_vectors.txt   inputs and expected outputs for the numeric kernel, one case a line:
                               name  n_in  in...  n_out  out...
     spec/rigs.json            the rigs as data, for the live skeleton: joints and the parts they carry
   and, from the same data, c/clio_motion_characters.c, c/clio_motion_rigs.c and the Python package's copies.
   The JavaScript version is the reference; the C and Python versions must reproduce these numbers.
     node tools/spec.js */
const fs = require('fs'), path = require('path');
const M = require('../js/core.js'), K = M.kernel, R = require('../js/rig.js'), B = require('../js/bake.js')(M, R);
const dir = path.join(__dirname, '..', 'spec');
fs.writeFileSync(path.join(dir, 'characters.json'), JSON.stringify(M.CHARACTERS, null, 1) + '\n');
fs.writeFileSync(path.join(dir, '..', 'python', 'clio_motion', 'characters.json'), JSON.stringify(M.CHARACTERS, null, 1) + '\n');   // the Python package carries its own copy

// the same characters as a C table, with what the ported stages read
(function () {
  const KIND = { biped: 'CM_BIPED', mech: 'CM_MECH', quad: 'CM_QUAD', hex: 'CM_HEX' };
  const MOUNT = { held: 'CM_MOUNT_HELD', fixed: 'CM_MOUNT_FIXED', turret: 'CM_MOUNT_TURRET', jaw: 'CM_MOUNT_JAW' }, KITC = { rifle: 'CM_KIT_RIFLE', pistols: 'CM_KIT_PISTOLS', sword: 'CM_KIT_SWORD', hands: 'CM_KIT_HANDS', 'case': 'CM_KIT_CASE', trolley: 'CM_KIT_TROLLEY', chaingun: 'CM_KIT_CHAINGUN', chainguns: 'CM_KIT_CHAINGUNS', shotgun: 'CM_KIT_SHOTGUN', rpg: 'CM_KIT_RPG', flamer: 'CM_KIT_FLAMER' };
  const num = function (x) { const t = String(x); return /[.e]/.test(t) ? t : t + '.0'; };
  const list = function (a) { return '{ ' + a.map(num).join(', ') + ' }'; };
  const gait = function (g) { return g ? '{ ' + list(g.phases) + ', ' + list(g.duty) + ' }' : '{ { 0.0 }, { 0.0, 0.0 } }'; };
  const ids = Object.keys(M.CHARACTERS), out = [];
  out.push('/* Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE).', '   SPDX-License-Identifier: Apache-2.0', '',
    '   Written by tools/spec.js from js/core.js. Do not edit: change the reference and run the tool. */', '#include "clio_motion.h"', '#include <string.h>', '',
    'static const cm_character CHARACTERS[] = {');
  ids.forEach(function (id) {
    const c = M.CHARACTERS[id], g = c.gait, gg = g.gallop;
    out.push('  { "' + id + '", ' + KIND[c.kind] + ', ' + [c.L, c.rootHeight, c.crouchDrop, c.runDrop, c.vmax, c.jumpH || 0, c.bob, c.sway, c.liftWalk, c.liftRun].map(num).join(', ') + ',');
    out.push('    { ' + [c.L, c.crouchDrop, c.runStride, g.frRun, g.frMax].map(num).join(', ') + ', ' + c.legs.length + ', ' + (g.run ? 1 : 0) + ', ' + (gg ? 1 : 0) + ',');
    out.push('      ' + gait(g.walk) + ', ' + gait(g.run) + ', ' + gait(gg) + ', ' + num(gg ? gg.fr : 0) + ', ' + num(gg ? gg.frMax : 0) + ' },');
    out.push('    ' + c.legs.length + ', {');
    c.legs.forEach(function (l) {
      const f = l.foot;
      out.push('      { ' + list(l.attach) + ', ' + list(l.rest) + ', ' + num(l.upper) + ', ' + num(l.lower) + ', ' + list(l.pole) + ', ' + l.side + ', ' + (f ? 1 : 0) + ', '
        + (f ? list([f.fb, f.hb, f.toe, f.ah, f.heelLift, f.strike]) : '{ 0.0, 0.0, 0.0, 0.0, 0.0, 0.0 }') + ' },');
    });
    out.push('    },');
    const b = c.beast, fs = c.fight && c.fight.stance;
    out.push('    ' + (b ? 1 : 0) + ', ' + (b && b.mid ? 1 : 0) + ', ' + num(b ? b.flex : 0) + ', ' + num(b ? b.rock : 0) + ', ' + (fs ? 1 : 0) + ', { ' + (fs ? fs.map(list).join(', ') : '{ 0.0, 0.0 }') + ' }, '
      + num(c.arthro && c.arthro.rock ? c.arthro.rock : 0) + ',');
    const m = c.mount || {}, T = c.torso || {}, A = c.arms || {}, P = c.pod || {};
    out.push('    ' + (MOUNT[m.type] || 'CM_MOUNT_TURRET') + ', ' + (KITC[m.kit] || 'CM_KIT_NONE') + ', ' + (m.n || 1) + ', ' + (m.yaw === undefined ? 0 : 1) + ', ' + (m.civil ? 1 : 0) + ', '
      + [m.rate || 0, m.kick || 0, m.rise || 0, m.omega || 0, m.aimOmega || 0, m.min || 0, m.max || 0, m.yaw === undefined ? 1 : m.yaw, m.bodyKick || 0].map(num).join(', ') + ',');
    out.push('    ' + [T.len || 0, T.neck || 0, T.headR || 0, T.shoulderW || 0, A.upper || 0, A.lower || 0, P.h || 0, P.r || 0, P.gunZ || 0, P.gunLen || 0].map(num).join(', ') + ',');
    const bz = c.beast || {}, tl = c.tail, az = c.arthro, cw = az && az.claw, oc = c.octo, fl = c.fly, or = function (x, d) { return x === undefined || x === null ? d : x; };
    out.push('    ' + [bz.half || 0, bz.back || bz.half || 0, bz.neck || 0, bz.neckUp || 0, bz.skull || 0, bz.jaw || 0, bz.tilt || 0].map(num).join(', ') + ',');
    out.push('    ' + (tl ? 1 : 0) + ', ' + (tl ? tl.n : 0) + ', ' + list(tl ? tl.at : [0, 0]) + ', '
      + (tl ? [tl.seg, tl.rest, tl.curl, tl.omega, tl.zeta || 0.45, or(tl.soft, 0.5), or(tl.sag, 0.2), tl.bend || 1.3, tl.lift, tl.wag, tl.alert, tl.sway, or(tl.inert, 1)] : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).map(num).join(', ') + ',');
    out.push('    ' + [az ? 1 : 0, az && az.both ? 1 : 0, az && az.under ? 1 : 0, az && az.thorax ? 1 : 0, az && az.head ? 1 : 0, az && az.stingAt ? 1 : 0, cw ? 1 : 0, cw && cw.strikeAt ? 1 : 0].join(', ') + ', '
      + num(az ? az.half : 0) + ', ' + num(az ? az.strike || 0.5 : 0) + ', ' + list(az && az.thorax || [0, 0, 0, 0]) + ', ' + list(az && az.head || [0, 0]) + ', ' + list(az && az.stingAt || [0, 0]) + ',');
    out.push('    ' + list(cw ? cw.at : [0, 0, 0]) + ', ' + [cw ? cw.upper : 0, cw ? cw.lower : 0, cw ? cw.hand : 0].map(num).join(', ') + ', ' + list(cw ? cw.rest : [0, 0, 0]) + ', ' + list(cw && cw.strikeAt || [0, 0, 0]) + ',');
    out.push('    ' + (oc ? 1 : 0) + ', ' + num(oc ? oc.mantle : 0) + ', ' + num(oc ? oc.arm.seg : 0) + ', ' + (fl ? 1 : 0) + ', ' + (fl && fl.zfold === false ? 0 : 1) + ', ' + list(fl ? fl.at : [0, 0, 0]) + ', '
      + [fl ? fl.w1 : 0, fl ? fl.w2 : 0, fl ? fl.chord : 0, fl ? fl.sweep || 0.15 : 0].map(num).join(', ') + ',');
    const oa = oc && oc.arm, F = fl || {};
    out.push('    ' + num(oc ? oc.vswim : 0) + ', { ' + (oa ? oa.n : 0) + ', ' + (oa ? [oa.seg, oa.rest, oa.curl, oa.omega, oa.zeta || 0.45, or(oa.soft, 0.5), or(oa.sag, 0.2), oa.bend || 1.3, or(oa.inert, 1)] : [0, 0, 0, 0, 0, 0, 0, 0, 0]).map(num).join(', ') + ' },');
    out.push('    ' + (F.hover ? 1 : 0) + ', ' + (F.glide ? 1 : 0) + ', ' + [F.beat || 0, F.amp || 0, F.vmin || 0, F.vmax || 0, F.turn || 0, F.acc || 0, F.climb || 0, F.sink || 0, F.height || 0, F.low || 0, F.heave || 0, F.pitch0 || 0, F.slowPitch || 0].map(num).join(', ') + ', ' + list(F.hang || [0, 0]) + ',');
    const sd = c.saddle;
    out.push('    ' + (sd ? 1 : 0) + ', ' + (sd ? (sd.reins === 'bit' ? 1 : sd.reins === 'neck' ? 2 : 0) : 0) + ', ' + list(sd ? sd.at : [0, 0]) + ', ' + list(sd ? sd.stirrup : [0, 0, 0]) + ', ' + list(sd ? sd.hands : [0, 0, 0]) + ' },');
  });
  out.push('};', '', 'int cm_character_count(void) { return (int)(sizeof CHARACTERS / sizeof CHARACTERS[0]); }',
    'const cm_character *cm_character_at(int i) { return i >= 0 && i < cm_character_count() ? &CHARACTERS[i] : 0; }',
    'const cm_character *cm_character_find(const char *id) {', '  int i;', '  for (i = 0; i < cm_character_count(); i++) if (!strcmp(CHARACTERS[i].id, id)) return &CHARACTERS[i];', '  return 0;', '}', '');
  fs.writeFileSync(path.join(dir, '..', 'c', 'clio_motion_characters.c'), out.join('\n'));
})();

// the rigs: for each character (and each of the soldier's kits) its joints and the parts they carry
(function () {
  const rigs = {}, c = [], num = function (x) { const t = String(x); return /[.e]/.test(t) ? t : t + '.0'; }, v3 = function (a) { return a ? '{ ' + a.map(num).join(', ') + ' }' : '{ 0.0, 0.0, 0.0 }'; };
  const str = function (t) { return t ? '"' + t + '"' : '0'; };
  c.push('/* Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE).', '   SPDX-License-Identifier: Apache-2.0', '',
    '   Written by tools/spec.js from js/rig.js and js/bake.js. Do not edit: change the reference and run the tool. */', '#include "clio_motion.h"', '#include <string.h>', '');
  const names = [];
  Object.keys(M.CHARACTERS).forEach(function (id) {
    const ch = M.CHARACTERS[id];
    (ch.mount.type === 'held' ? M.kitsOf(ch) : [null]).forEach(function (kit) {
      const d = B.rigData(ch, { kit: kit }), cid = d.name.replace(/[^A-Za-z0-9]/g, '_');
      rigs[d.name] = { name: d.name, id: d.id, kit: d.kit, leg: d.leg, ears: d.ears, joints: d.joints, parts: d.parts };
      names.push([d.name, cid, d]);
      c.push('static const cm_rig_joint J_' + cid + '[] = {');
      d.joints.forEach(function (j) { c.push('  { "' + j.name + '", ' + j.parent + ', ' + j.ref + ', ' + (j.carried ? 1 : 0) + ', ' + v3(j.o) + ', ' + v3(j.x) + ', ' + v3(j.y) + ', ' + v3(j.z) + ' },'); });
      c.push('};', 'static const cm_rig_part P_' + cid + '[] = {');
      d.parts.forEach(function (q) {
        c.push('  { ' + q.joint + ', ' + (q.b ? 1 : 0) + ', ' + (q.end ? 1 : 0) + ', ' + (q.on ? 1 : 0) + ', ' + v3(q.a) + ', ' + v3(q.b) + ', ' + v3(q.end) + ', ' + v3(q.on) + ', ' + num(q.r) + ', 0x' + q.color.slice(1) + 'u, "' + q.group + '", '
          + num(q.layer) + ', ' + q.shade + ', ' + str(q.part) + ', ' + str(q.of) + ', ' + (q.raw ? 1 : 0) + ', ' + (q.sq ? 1 : 0) + ' },');
      });
      c.push('};', '');
    });
  });
  c.push('static const cm_rig RIGS[] = {');
  const KITN = { rifle: 'CM_KIT_RIFLE', pistols: 'CM_KIT_PISTOLS', sword: 'CM_KIT_SWORD', hands: 'CM_KIT_HANDS', 'case': 'CM_KIT_CASE', trolley: 'CM_KIT_TROLLEY', chaingun: 'CM_KIT_CHAINGUN', chainguns: 'CM_KIT_CHAINGUNS', shotgun: 'CM_KIT_SHOTGUN', rpg: 'CM_KIT_RPG', flamer: 'CM_KIT_FLAMER' };
  names.forEach(function (n) { c.push('  { "' + n[0] + '", "' + n[2].id + '", ' + (KITN[n[2].kit] || 'CM_KIT_NONE') + ', ' + num(n[2].ears) + ', ' + n[2].joints.length + ', ' + n[2].parts.length + ', J_' + n[1] + ', P_' + n[1] + ' },'); });
  c.push('};', '', 'int cm_rig_count(void) { return (int)(sizeof RIGS / sizeof RIGS[0]); }', 'const cm_rig *cm_rig_at(int i) { return i >= 0 && i < cm_rig_count() ? &RIGS[i] : 0; }',
    'const cm_rig *cm_rig_find(const char *name) {', '  int i;', '  for (i = 0; i < cm_rig_count(); i++) if (!strcmp(RIGS[i].name, name)) return &RIGS[i];', '  return 0;', '}', '');
  fs.writeFileSync(path.join(dir, '..', 'c', 'clio_motion_rigs.c'), c.join('\n'));
  const text = JSON.stringify(rigs) + '\n';
  fs.writeFileSync(path.join(dir, 'rigs.json'), text);
  fs.writeFileSync(path.join(dir, '..', 'python', 'clio_motion', 'rigs.json'), text);
  process.stdout.write('spec/rigs.json ' + names.length + ' rigs, ' + Math.round(text.length / 1024) + ' KB | ');

  // The wardrobe of the people who are not soldiers: every part of every option, for other languages to dress them from
  // (python/clio_motion/rig.py: dressed). And looks.json: people dressed this way and that, and the parts the reference
  // makes each of - what dressing from the wardrobe must arrive at.
  const people = {};
  Object.keys(M.CHARACTERS).forEach(function (id) { const w = B.wardrobe(M.CHARACTERS[id]); if (w) people[id] = w; });
  const wtext = JSON.stringify({ about: 'What people who are not soldiers can wear: tools/spec.js writes this from js/rig.js. options: each option and its values. colours: the names of their colours. people: by character - wear (as it comes), palette, body (its parts, by joint name; tag: the option a part belongs to, ck: its colour by name), at (where a kit\'s parts come in the draw order), props (by kit).',
    options: R.OPTIONS, colours: R.COLOURS, people: people }) + '\n';
  fs.writeFileSync(path.join(dir, 'wardrobe.json'), wtext);
  fs.writeFileSync(path.join(dir, '..', 'python', 'clio_motion', 'wardrobe.json'), wtext);
  let seed = 20261;
  function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
  function one(a) { return a[Math.floor(rnd() * a.length)]; }
  const HEX = ['#b3202e', '#d8793a', '#3f7a4d', '#2f6690', '#eef0f2', '#22252b', '#C9A24A'], looks = [];
  Object.keys(people).forEach(function (id) {
    const ch = M.CHARACTERS[id], kits = Object.keys(people[id].props);
    for (let n = 0; n < 9; n++) {
      const look = { character: id, kit: one(kits), wear: {}, colors: {}, build: n % 3 === 0 ? 1 : Math.round((0.8 + 0.5 * rnd()) * 100) / 100 };
      if (n === 0) { delete look.wear; delete look.colors; }                      // as the character comes
      else {
        Object.keys(R.OPTIONS).forEach(function (k) { if (rnd() < 0.45) look.wear[k] = one(R.OPTIONS[k]); });
        R.COLOURS.forEach(function (k) { if (rnd() < 0.3) look.colors[k] = one(HEX); });
        if (n === 4) { look.wear.hat = true; look.wear.band = true; look.wear.hair = 'green'; look.colors.top = 'red'; look.colors.torso = '#ffffff'; }      // what is not understood is passed over
      }
      look.parts = B.dressedParts(ch, look);
      looks.push(look);
    }
  });
  fs.writeFileSync(path.join(dir, 'looks.json'), JSON.stringify({ about: 'People dressed this way and that (character, kit, wear, colors, build) and the parts the reference makes of each, as a rig\'s parts are given. tools/spec.js writes this.', looks: looks }) + '\n');
  process.stdout.write('spec/wardrobe.json ' + Object.keys(people).length + ' people, ' + Math.round(wtext.length / 1024) + ' KB | spec/looks.json ' + looks.length + ' looks | ');
})();

let seed = 12345;
function rnd() { seed = (seed + 0x6D2B79F5) >>> 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
function r(a, b) { return a + (b - a) * rnd(); }
const lines = [];
function put(name, ins, outs) { lines.push([name, ins.length].concat(ins.map(f), [outs.length], outs.map(f)).join(' ')); }
function f(x) { return typeof x === 'boolean' ? (x ? '1' : '0') : Number(x).toPrecision(17); }
let i, k;
for (i = 0; i < 40; i++) { const a = r(-2, 2), b = a + r(0.1, 3), x = r(-4, 6); put('smooth', [a, b, x], [K.smooth(a, b, x)]); }
for (i = 0; i < 20; i++) { const a = r(0, 40), d = r(0.001, 0.05); put('decay', [a, d], [K.decay(a, d)]); }
for (i = 0; i < 20; i++) { const s = r(0, 1), sn = r(0, 1); put('ease', [s, sn], [K.ease(s, sn)]); }
for (i = 0; i < 20; i++) { const a = r(-20, 20); put('wrapPi', [a], [M.wrapPi(a)]); }
for (i = 0; i < 20; i++) { const t = r(0, 30), P = r(1, 6), kk = r(0, 8); put('idleNoise', [t, P, kk], [K.idleNoise(t, P, kk)]); }
for (i = 0; i < 20; i++) {                                   // a spring followed for 50 steps
  const s = { x: r(-1, 1), v: r(-3, 3) }, tg = r(-1, 1), om = r(2, 40), ze = r(0.2, 1.2), dt = r(1 / 240, 1 / 30), ins = [s.x, s.v, tg, om, ze, dt];
  for (k = 0; k < 50; k++) K.spring(s, tg, om, ze, dt);
  put('spring50', ins, [s.x, s.v]);
}
for (i = 0; i < 60; i++) {                                   // two-bone IK, including targets out of reach and poles along the limb
  const root = [r(-1, 1), r(0, 2), r(-1, 1)], tg = [root[0] + r(-1.4, 1.4), root[1] + r(-1.4, 1.4), root[2] + r(-0.6, 0.6)], l1 = r(0.2, 0.7), l2 = r(0.2, 0.7), pole = [r(-1, 1), r(-1, 1), r(-1, 1)];
  const o = M.ik2(root, tg, l1, l2, pole); put('ik2', root.concat(tg, [l1, l2], pole), o.mid.concat(o.end));
}
for (i = 0; i < 30; i++) { const p = [r(-2, 2), r(0, 2), r(-2, 2)], t = [r(-15, 15), r(-1, 3), r(-15, 15)], vm = r(6, 20); put('lob', p.concat(t, [vm]), M.lob(p, t, vm)); }
for (i = 0; i < 20; i++) {                                   // a chain of links fitted between two points
  const n = 3 + ((rnd() * 6) | 0), seg = r(0.1, 0.3), a = [r(-1, 1), r(0, 1), r(-1, 1)], b = [a[0] + r(-1.5, 1.5), a[1] + r(-1, 1.5), a[2] + r(-1, 1)], pts = [];
  for (k = 0; k <= n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n + 0.3 * Math.sin(Math.PI * k / n), a[2] + (b[2] - a[2]) * k / n]);
  const ins = [n, seg].concat(a, b, [].concat.apply([], pts)), out = K.reachChain(pts.map(p => p.slice()), a, b, seg);
  put('reachChain', ins, [].concat.apply([], out));
}
// gait rules: every character taken up through its speeds and down again, so the walk-run (and gallop) switches are crossed both ways
Object.keys(M.CHARACTERS).forEach(function (id) {
  const ch = M.CHARACTERS[id], g = ch.gait, n = g.walk.phases.length, st = { stride: 1 }, S = { crouch: 0, v: 0, run: 0, runWant: false, gal: 0, galWant: false };
  const cfg = [ch.L, ch.crouchDrop, ch.runStride, g.frRun, g.frMax, n].concat(g.walk.phases, g.walk.duty, [g.run ? 1 : 0], g.run ? g.run.phases.concat(g.run.duty) : [], [g.gallop ? 1 : 0], g.gallop ? g.gallop.phases.concat(g.gallop.duty, [g.gallop.fr, g.gallop.frMax]) : []);
  for (i = 0; i <= 60; i++) {
    const u = i <= 30 ? i / 30 : (60 - i) / 30, dt = 1 / 60; S.v = ch.vmax * u; S.crouch = i % 20 === 7 ? 0.6 : 0; st.stride = 0.8 + 0.4 * ((i * 7) % 10) / 10;
    const ins = cfg.concat([S.crouch, S.v, S.runWant, S.run, S.galWant, S.gal || 0, st.stride, dt]);
    for (k = 0; k < 6; k++) var gp = K.gaitParams(ch, S, st, dt);                  // a few steps at each speed lets the blends move
    put('gait6', ins, [gp.Leff, gp.Tn, gp.Fr, gp.run, gp.stride, gp.period, gp.duty, gp.moving, gp.Aw, gp.Ar, gp.gal, S.runWant, S.galWant].concat(gp.phases));
  }
});
// where a part's picture goes on its bone. In: axis (0 ball, 1 up, 2 down, 3 right), has b, a, b, radius on screen,
// pixels to a metre, flipped, picture w h, has box, box, the bone's length and radius when drawn. Out: x y turn fx fy dx dy dw dh
for (i = 0; i < 160; i++) {
  const axis = i % 4, hasB = i % 9 ? 1 : 0, a = [r(-200, 200), r(-200, 200)], b = [r(-200, 200), r(-200, 200)], rs = r(1, 30), ppm = r(40, 300), flip = i % 3 === 0, w = Math.round(r(4, 200)), h = Math.round(r(4, 200));
  const hasBox = i % 5 ? 1 : 0, x0 = r(-0.3, 0), y0 = r(-0.3, 0), box = [x0, y0, x0 + r(0.1, 0.9), y0 + r(0.1, 0.9)], len = i % 11 === 10 ? 4 : r(0.1, 0.8), rr = r(0.02, 0.15);
  const im = { axis: ['ball', 'up', 'down', 'right'][axis], w: w, h: h }; if (hasBox) { im.box = box; im.len = len; im.r = rr; }
  const o = R.partPlace(im, a, hasB ? b : null, rs, ppm, flip);
  put('partPlace', [axis, hasB].concat(a, b, [rs, ppm, flip, w, h, hasBox], box, [len, rr]), [o.x, o.y, o.rot, o.fx, o.fy, o.dx, o.dy, o.dw, o.dh]);
}
fs.writeFileSync(path.join(dir, 'kernel_vectors.txt'), lines.join('\n') + '\n');
console.log('spec/characters.json', Object.keys(M.CHARACTERS).length, 'characters | spec/kernel_vectors.txt', lines.length, 'cases');
