// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
// People who are not soldiers: plain clothes, nothing in the hands or a case in one of them.
const M = require('../core.js'), R = require('../rig.js'), B = require('../bake.js')(M, R);
const st = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 };
let fails = 0;
function ok(c, msg) { if (!c) { fails++; console.log('FAIL ' + msg); } }
function fin(o) { if (typeof o === 'number') return isFinite(o); if (o && typeof o === 'object') { for (const k in o) if (!fin(o[k])) return false; } return true; }
const rough = x => 0.92 * (0.10 * Math.sin(x / 1.75) + 0.05 * Math.sin(x / 0.67 + 1.3));
const PEOPLE = ['person', 'technician', 'scientist', 'hazmat'], CIVIL = ['hands', 'case', 'trolley'];
function walk(id, inp, secs, each, terr) {
  const ch = M.CHARACTERS[id], env = { terrain: terr || rough }, S = M.createState(ch, env);
  for (let i = 0; i < secs * 120; i++) { const p = M.step(S, ch, typeof inp === 'function' ? inp(i / 120) : inp, st, env, 1 / 120); if (each) each(p, S, i / 120, env, ch); }
  return S;
}
// they are the soldier's body
for (const id of PEOPLE) {
  const c = M.CHARACTERS[id], so = M.CHARACTERS.soldier;
  ok(c.kind === 'biped' && c.L === so.L && c.rootHeight === so.rootHeight && c.legs === so.legs, id + ' has the soldier\'s body');
  ok(c.mount.civil === true && M.KITS[c.mount.kit].civil, id + ' starts with a civil kit');
  for (const k of CIVIL) ok(M.kitFits(c, k), id + ' may carry ' + k);
  for (const k of ['rifle', 'pistols', 'sword', 'nothing']) ok(!M.kitFits(c, k), id + ' may not carry ' + k);
}
for (const k of CIVIL) ok(!M.kitFits(M.CHARACTERS.soldier, k), 'a soldier does not carry ' + k);
ok(M.kitFits(M.CHARACTERS.soldier, 'sword') && !M.kitFits(M.CHARACTERS.hyena, 'case'), 'kits fit whom they should');
// a kit asked for that does not fit is not taken; one that fits is, weapons asked for or not
{ let S = walk('person', { speed: 1.4, kit: 'rifle', armed: true }, 3); ok(S.kit === 'hands' && S.local.props.length === 0, 'a person does not take a rifle');
  S = walk('soldier', { speed: 1.4, kit: 'trolley', armed: true }, 3); ok(S.kit === 'rifle' && S.local.props[0].kind === 'rifle', 'a soldier does not take a case on wheels');
  for (const armed of [false, true]) { S = walk('scientist', { speed: 1.4, kit: 'case', armed: armed }, 3); ok(S.kit === 'case' && S.armed.x > 0.99 && S.local.props[0].stow < 0.01, 'the case is in the hand, armed ' + armed); } }
// the hand is on the handle, on rough ground, walking, turning and running
for (const id of PEOPLE) for (const kit of ['case', 'trolley']) {
  let worst = 0, bad = false, off = 0, low = 9, n = 0;
  const S = walk(id, t => ({ speed: t < 5 ? 1.4 : 4.0, kit: kit, heading: t > 3 ? 1.2 : null }), 8, (p, S2, t, env, ch) => {
    if (!fin(p)) bad = true;
    if (t < 2.5) return;                                    // the kit is changed to first
    const w = p.props[0], h = p.arms[0].hand; worst = Math.max(worst, Math.hypot(h[0] - w.grip[0], h[1] - w.grip[1], h[2] - w.grip[2])); n++;
    if (kit === 'trolley') { const w = S2.local.props[0]; const g = env.terrain(S2.px + (w.o[0] - S2.x) * Math.cos(S2.h) - w.o[2] * Math.sin(S2.h), S2.pz + (w.o[0] - S2.x) * Math.sin(S2.h) + w.o[2] * Math.cos(S2.h)); off = Math.max(off, Math.abs(w.o[1] - g - M.PROPS.trolley.wheel)); }
    else low = Math.min(low, Math.min(w.magA[1], w.magB[1]) - S2.gRef.x);
  });
  ok(!bad && n > 600, id + ' ' + kit + ': every number is a number');
  ok(worst < 0.03, id + ' ' + kit + ': the hand stays on the handle (' + worst.toFixed(3) + ' m)');
  if (kit === 'trolley') ok(off < 0.012, id + ': the wheels are on the ground (' + off.toFixed(4) + ' m)');
  else ok(low > 0.25, id + ': the case clears the ground (' + low.toFixed(2) + ' m)');
}
// a case on wheels is not run with; a case in the hand is
{ const lim = Math.sqrt(M.G * 0.92);
  let S = walk('person', { speed: 5, kit: 'trolley' }, 6, null, x => 0); ok(S.v < lim + 0.05 && S.v > lim - 0.4, 'a case on wheels is taken at a jog (' + S.v.toFixed(2) + ' m/s)');
  S = walk('person', { speed: 5, kit: 'case' }, 6, null, x => 0); ok(S.v > 4.6, 'a case in the hand is run with (' + S.v.toFixed(2) + ' m/s)');
  S = walk('person', { speed: 9 }, 6, null, x => 0); ok(Math.abs(S.v - M.CHARACTERS.person.vmax) < 0.2 && M.CHARACTERS.person.vmax < M.CHARACTERS.soldier.vmax, 'a person runs, slower than a soldier'); }
// the case swings with the arm, and less than a free hand does
{ let cx = [], hx = [];
  walk('person', { speed: 1.4, kit: 'case' }, 6, (p, S, t) => { if (t > 3) { cx.push(p.props[0].grip[0] - p.chest[0]); hx.push(p.arms[1].hand[0] - p.chest[0]); } }, x => 0);
  const span = a => Math.max.apply(null, a) - Math.min.apply(null, a);
  ok(span(cx) > 0.05 && span(cx) < 0.6 * span(hx), 'the case swings a little (' + span(cx).toFixed(2) + ' m, the free hand ' + span(hx).toFixed(2) + ')'); }
// fists put the case away; falling lets it go
{ let S = walk('technician', t => ({ guard: t > 1 }), 3); ok(S.armed.x < 0.05 && S.local.props[0].stow > 0.9, 'fists up: the tool box is let go of');
  const ch = M.CHARACTERS.hazmat, env = { terrain: x => 0 }; S = M.createState(ch, env); let p, ev = [];
  for (let i = 0; i < 600; i++) { p = M.step(S, ch, { speed: 1.4, kit: 'trolley', die: i === 300 ? { impulse: [-1.5, 0.5, 0.6] } : null }, st, env, 1 / 120); ev = ev.concat(S.events || []); if (!fin(p)) fails++; }
  ok(S.mode === 'ragdoll' && p.props.length === 1 && p.props[0].kind === 'trolley', 'a fallen body\'s case lies with it');
  ok(Math.abs(p.props[0].o[1]) < 0.25 && Math.abs(p.props[0].muzzle[1]) < 0.45, 'and has come to rest on the ground (' + p.props[0].o[1].toFixed(2) + ', ' + p.props[0].muzzle[1].toFixed(2) + ')'); }
// clothes and joints
const want = { person: { hair: 1 }, technician: { hat: 1, band: 1, boots: 1 }, scientist: { coat: 1, hair: 1 }, hazmat: { hood: 1, tank: 1, boots: 1 } };
for (const id of PEOPLE) for (const kit of CIVIL) {
  const ch = M.CHARACTERS[id], S = walk(id, { speed: 1.4, kit: kit }, 3), pr = R.buildPrims(S.local, ch, { flash: false }), C = R.PAL[id];
  const names = pr.joints.map(j => j.name), cols = pr.map(q => q.col), parts = pr.map(q => q.part).filter(Boolean);
  ok(names.indexOf('Weapon') < 0 && names.indexOf('Magazine') < 0 && (names.indexOf('Case') >= 0) === (kit !== 'hands'), id + ' ' + kit + ': joints');
  ok(names.length === (kit === 'hands' ? 20 : 21) && ['Hips', 'Spine', 'Head', 'Hand_R', 'Hand_L', 'Toe_L', 'Pack', 'Grenade', 'Carry'].every(n => names.indexOf(n) >= 0), id + ' ' + kit + ': the soldier\'s skeleton');
  ok(cols.every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c)), id + ' ' + kit + ': every part has a colour');
  ok((parts.indexOf('case') >= 0) === (kit !== 'hands') && parts.indexOf('weapon') < 0 && parts.indexOf('grenade') < 0, id + ' ' + kit + ': parts');
  const w = want[id];
  ok(pr.some(q => q.j === 'Head' && q.col === C.hat) === !!w.hat, id + ': hat'); ok(pr.some(q => q.j === 'Spine' && q.col === C.band && !!C.band) === !!w.band, id + ': band');
  ok(pr.some(q => q.j === 'Head' && q.col === C.hair && q.col !== C.skin) === !!w.hair, id + ': hair'); ok(pr.some(q => q.of === 'shin' && q.col === C.shoe) === !!w.boots, id + ': boots');
  ok((parts.indexOf('pack') >= 0) === !!w.tank, id + ': tank'); ok((cols.indexOf(C.glass) >= 0 && !!C.glass) === !!w.hood, id + ': visor');
  ok(pr.length === R.buildPrims(S.local, ch, { flash: false, model: true }).length, id + ' ' + kit + ': the same parts as a model');
  const d = B.rigData(ch, { kit: kit === ch.mount.kit ? null : kit }); ok(d.joints.length === names.length && d.name === (kit === ch.mount.kit ? id : id + '_' + kit), id + ' ' + kit + ': its rig is ' + d.name);
}
{ const S = walk('scientist', { speed: 0 }, 1), pr = R.buildPrims(S.local, M.CHARACTERS.scientist, {}), top = R.PAL.scientist.top;
  const low = Math.min.apply(null, pr.filter(q => q.col === top && q.j === 'Hips').map(q => Math.min(q.a[1], q.b ? q.b[1] : q.a[1]) - q.r));
  ok(low < S.local.root[1] - 0.35 && low > S.local.root[1] - 0.6, 'the lab coat hangs below the hips (' + (S.local.root[1] - low).toFixed(2) + ' m)'); }
// a soldier is as it was
{ const S = walk('soldier', { speed: 1.4, armed: true }, 2), pr = R.buildPrims(S.local, M.CHARACTERS.soldier, { flash: false });
  ok(pr.length === 32 && pr.joints.length === 22 && pr.some(q => q.part === 'grenade') && pr.some(q => q.part === 'pack'), 'a soldier has its armour, pack and grenade'); }
// clips: a person has no weapon to attack with and no grenade
for (const id of PEOPLE) { const names = B.recordAll(M.CHARACTERS[id], { frames: 8 }).map(c => c.name);
  ok(names.indexOf('attack') < 0 && names.indexOf('throw') < 0 && names.indexOf('reload') < 0 && ['idle', 'walk', 'run', 'jump', 'hit', 'die', 'jab', 'climb'].every(n => names.indexOf(n) >= 0), id + ': clips ' + names.length); }
console.log(fails ? fails + ' FAILED' : 'people: all passed');
process.exit(fails ? 1 : 0);
