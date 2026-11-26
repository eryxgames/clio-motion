// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
// People who are not soldiers: plain clothes, nothing in the hands or a case in one of them.
const M = require('../core.js'), R = require('../rig.js'), B = require('../bake.js')(M, R);
const st = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 };
let fails = 0;
function ok(c, msg) { if (!c) { fails++; console.log('FAIL ' + msg); } }
function fin(o) { if (typeof o === 'number') return isFinite(o); if (o && typeof o === 'object') { for (const k in o) if (!fin(o[k])) return false; } return true; }
const rough = x => 0.92 * (0.10 * Math.sin(x / 1.75) + 0.05 * Math.sin(x / 0.67 + 1.3));
const PEOPLE = ['person', 'technician', 'scientist', 'hazmat', 'woman'], CIVIL = ['hands', 'case', 'trolley'];
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
const want = { person: { hair: 1 }, technician: { hat: 1, band: 1, boots: 1 }, scientist: { coat: 1, hair: 1 }, hazmat: { hood: 1, tank: 1, boots: 1 }, woman: { hair: 1 } };
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
  ok(pr.every(q => q.tag === undefined), id + ' ' + kit + ': no part is marked with an option unless all are asked for');
  const d = B.rigData(ch, { kit: kit === ch.mount.kit ? null : kit }); ok(d.joints.length === names.length && d.name === (kit === ch.mount.kit ? id : id + '_' + kit), id + ' ' + kit + ': its rig is ' + d.name);
}
{ const S = walk('scientist', { speed: 0 }, 1), pr = R.buildPrims(S.local, M.CHARACTERS.scientist, {}), top = R.PAL.scientist.top;
  const low = Math.min.apply(null, pr.filter(q => q.col === top && q.j === 'Hips').map(q => Math.min(q.a[1], q.b ? q.b[1] : q.a[1]) - q.r));
  ok(low < S.local.root[1] - 0.35 && low > S.local.root[1] - 0.6, 'the lab coat hangs below the hips (' + (S.local.root[1] - low).toFixed(2) + ' m)'); }
// The wardrobe: what each of them can wear instead
{ const ch = M.CHARACTERS.woman, S = walk('woman', { speed: 1.4, kit: 'case' }, 3), p = S.local, O = R.OPTIONS;
  const plain = R.buildPrims(p, ch, { flash: false }), all = R.buildPrims(p, ch, { flash: false, all: true });
  ok(JSON.stringify(R.wearOf('woman')) === JSON.stringify({ shape: 'f', hair: 'long', hat: 'none', hood: 'none', coat: 'none', skirt: 'none', sleeves: 'long', legs: 'long', band: 'none', tank: 'none', pack: 'none', boots: 'none', box: 'brief' }), 'what a woman wears as she comes');
  ok(R.wearOf('soldier') === null && R.wearOf('hyena', { hat: 'cap' }) === null, 'only people have a wardrobe');
  const w2 = R.wearOf('person', { hat: true, band: true, hair: 'green', skirt: 'knee', coat: null, nothing: 1 });
  ok(w2.hat === 'none' && w2.band === 'on' && w2.hair === 'short' && w2.skirt === 'knee' && w2.coat === 'none' && !('nothing' in w2), 'what is not understood is passed over');
  // every value of every option changes what she is made of, and is in the wardrobe under its name
  for (const k in O) for (const v of O[k]) {
    const pr = R.buildPrims(p, ch, { flash: false, wear: { [k]: v } }), base = R.wearOf('woman')[k];
    const sig = a => JSON.stringify(a.map(q => [q.r, q.col, q.part || q.of]));
    ok((sig(pr) === sig(plain)) === (v === base), 'woman, ' + k + ' ' + v + (v === base ? ' is what she has' : ' is something else'));
    ok(v === 'none' || all.some(q => q.tag === k + '=' + v), 'the wardrobe has ' + k + '=' + v);
    ok(pr.joints.length === plain.joints.length && pr.every(q => /^#[0-9a-f]{6}$/.test(q.col) && q.r > 0), k + ' ' + v + ': the same skeleton, whole parts');
    // what is worn is what the wardrobe's marks say
    const w = R.wearOf('woman', { [k]: v }), from = all.filter(q => !q.tag || w[q.tag.split('=')[0]] === q.tag.split('=')[1]);
    ok(sig(from) === sig(pr), k + ' ' + v + ': chosen from the wardrobe it is the same');
  }
  ok(all.length > 2 * plain.length && all.every(q => q.tag === undefined || /^[a-z]+=[a-z]+$/.test(q.tag)), 'the wardrobe is everything (' + all.length + ' parts)');
  ok(all.filter(q => q.g !== 'prop0' || true).every(q => typeof q.ck === 'string' && R.COLOURS.indexOf(q.ck) >= 0), 'every part of a person has a colour by name');
  // colours by name; a dress is a skirt the colour of the top
  const red = R.buildPrims(p, ch, { flash: false, wear: { skirt: 'knee', legs: 'bare' }, colors: { top: '#B3202E', hair: 'black', torso: '#ffffff' } });
  ok(red.filter(q => q.col === '#b3202e').length >= 9 && !red.some(q => q.col === R.PAL.woman.top || q.col === '#ffffff') && red.some(q => q.col === R.PAL.woman.hair), 'a red dress: the top and the skirt, and nothing by a name that is not a colour\'s');
  ok(red.filter(q => q.ck === 'skin').length === 5, 'bare legs and a face');
  const two = R.buildPrims(p, ch, { flash: false, wear: { skirt: 'long' }, colors: { top: '#b3202e', skirt: '#22252b' } });
  ok(two.filter(q => q.ck === 'skirt').every(q => q.col === '#22252b') && two.filter(q => q.ck === 'skirt').length === 5, 'a skirt of its own colour, to the shins');
  ok(R.PAL.woman.top === '#8a5a78' && plain.some(q => q.col === '#8a5a78'), 'the character\'s own colours are not changed by it');
  // build: the body's parts are thicker, the head and the case are not
  const heavy = R.buildPrims(p, ch, { flash: false, build: 1.25 });
  ok(heavy.every((q, i) => Math.abs(q.r - plain[i].r * (/^(torso|leg|arm)/.test(q.g) ? 1.25 : 1)) < 1e-12), 'build');
  // a woman's body is slighter than a man's at the waist and the shoulders, and wider at the hips
  const man = R.buildPrims(walk('person', { speed: 0 }, 1).local, M.CHARACTERS.person, {}), wom = R.buildPrims(walk('woman', { speed: 0 }, 1).local, ch, {});
  const tor = a => a.filter(q => q.g === 'torso').map(q => q.r);
  ok(tor(wom)[0] > tor(man)[0] && tor(wom)[1] < tor(man)[1] && tor(wom)[3] < tor(man)[3], 'a woman\'s shape (' + tor(wom) + ' against ' + tor(man) + ')');
  ok(M.CHARACTERS.woman.sway > M.CHARACTERS.person.sway, 'and her hips sway more');
  // dressed for other languages: the wardrobe's table, and a look made from it
  const wd = B.wardrobe(ch);
  ok(wd.body.length === all.filter(q => !/^prop/.test(q.g)).length && wd.at > 20 && wd.at < wd.body.length && wd.props.hands.length === 0 && wd.props['case'].length === 7 && wd.props.trolley.length === 6, 'the wardrobe as data');
  ok(wd.palette.skirt === null && wd.palette.top === '#8a5a78' && Object.keys(wd.palette).length === R.COLOURS.length, 'its palette');
  ok(B.wardrobe(M.CHARACTERS.soldier) === null, 'a soldier has none');
  for (const id of PEOPLE) for (const kit of CIVIL) { const c2 = M.CHARACTERS[id];
    ok(JSON.stringify(B.dressedParts(c2, { kit: kit })) === JSON.stringify(B.rigData(c2, { kit: kit === c2.mount.kit ? null : kit }).parts), id + ' ' + kit + ': dressed as it comes is its rig'); }
}
// a soldier is as it was
{ const S = walk('soldier', { speed: 1.4, armed: true }, 2), pr = R.buildPrims(S.local, M.CHARACTERS.soldier, { flash: false });
  ok(pr.length === 32 && pr.joints.length === 22 && pr.some(q => q.part === 'grenade') && pr.some(q => q.part === 'pack'), 'a soldier has its armour, pack and grenade'); }
// clips: a person has no weapon to attack with and no grenade
for (const id of PEOPLE) { const names = B.recordAll(M.CHARACTERS[id], { frames: 8 }).map(c => c.name);
  ok(names.indexOf('attack') < 0 && names.indexOf('throw') < 0 && names.indexOf('reload') < 0 && ['idle', 'walk', 'run', 'jump', 'hit', 'die', 'jab', 'climb'].every(n => names.indexOf(n) >= 0), id + ': clips ' + names.length); }
console.log(fails ? fails + ' FAILED' : 'people: all passed');
process.exit(fails ? 1 : 0);
