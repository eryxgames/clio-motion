#!/usr/bin/env node
// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
/* Writes the files every version of the library is checked against:
     spec/characters.json      the built-in characters, as data
     spec/kernel_vectors.txt   inputs and expected outputs for the numeric kernel, one case a line:
                               name  n_in  in...  n_out  out...
   The JavaScript version is the reference; the C and Python versions must reproduce these numbers.
     node tools/spec.js */
const fs = require('fs'), path = require('path');
const M = require('../js/core.js'), K = M.kernel;
const dir = path.join(__dirname, '..', 'spec');
fs.writeFileSync(path.join(dir, 'characters.json'), JSON.stringify(M.CHARACTERS, null, 1) + '\n');
fs.writeFileSync(path.join(dir, '..', 'python', 'clio_motion', 'characters.json'), JSON.stringify(M.CHARACTERS, null, 1) + '\n');   // the Python package carries its own copy

// the same characters as a C table, with what the ported stages read
(function () {
  const KIND = { biped: 'CM_BIPED', mech: 'CM_MECH', quad: 'CM_QUAD', hex: 'CM_HEX' };
  const MOUNT = { held: 'CM_MOUNT_HELD', fixed: 'CM_MOUNT_FIXED', turret: 'CM_MOUNT_TURRET', jaw: 'CM_MOUNT_JAW' }, KITC = { rifle: 'CM_KIT_RIFLE', pistols: 'CM_KIT_PISTOLS', sword: 'CM_KIT_SWORD' };
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
    out.push('    ' + (MOUNT[m.type] || 'CM_MOUNT_TURRET') + ', ' + (KITC[m.kit] || 'CM_KIT_NONE') + ', ' + (m.n || 1) + ', ' + (m.yaw === undefined ? 0 : 1) + ', '
      + [m.rate || 0, m.kick || 0, m.rise || 0, m.omega || 0, m.aimOmega || 0, m.min || 0, m.max || 0, m.yaw === undefined ? 1 : m.yaw, m.bodyKick || 0].map(num).join(', ') + ',');
    out.push('    ' + [T.len || 0, T.neck || 0, T.headR || 0, T.shoulderW || 0, A.upper || 0, A.lower || 0, P.h || 0, P.r || 0, P.gunZ || 0, P.gunLen || 0].map(num).join(', ') + ' },');
  });
  out.push('};', '', 'int cm_character_count(void) { return (int)(sizeof CHARACTERS / sizeof CHARACTERS[0]); }',
    'const cm_character *cm_character_at(int i) { return i >= 0 && i < cm_character_count() ? &CHARACTERS[i] : 0; }',
    'const cm_character *cm_character_find(const char *id) {', '  int i;', '  for (i = 0; i < cm_character_count(); i++) if (!strcmp(CHARACTERS[i].id, id)) return &CHARACTERS[i];', '  return 0;', '}', '');
  fs.writeFileSync(path.join(dir, '..', 'c', 'clio_motion_characters.c'), out.join('\n'));
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
fs.writeFileSync(path.join(dir, 'kernel_vectors.txt'), lines.join('\n') + '\n');
console.log('spec/characters.json', Object.keys(M.CHARACTERS).length, 'characters | spec/kernel_vectors.txt', lines.length, 'cases');
