// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
// Three more weapons, each with moves of its own: a shotgun pumped between shots, a launcher steadied, fired and loaded again,
// a flamethrower streamed from the hip with its tanks on the back.
const M = require('../core.js'), R = require('../rig.js'), B = require('../bake.js')(M, R);
const st = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 };
let fails = 0;
function ok(c, msg) { if (!c) { fails++; console.log('FAIL ' + msg); } }
function fin(o) { if (typeof o === 'number') return isFinite(o); if (o && typeof o === 'object') { for (const k in o) if (!fin(o[k])) return false; } return true; }
function run(id, inp, secs, each, terr) {
  const ch = M.CHARACTERS[id], env = { terrain: terr || (x => 0) }, S = M.createState(ch, env); let p = null;
  for (let i = 0; i < Math.round(secs * 120); i++) { const t = i / 120; p = M.step(S, ch, inp(t, S), st, env, 1 / 120); const ev = S.events.slice(); S.events.length = 0; if (each) each(p, S, t, ev); }
  return S;
}
const ahead = S => [S.px + 20 * Math.cos(S.h), 1.3, S.pz + 20 * Math.sin(S.h)], lim = Math.sqrt(M.G * 0.92);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ARMS = ['rifle', 'pistols', 'sword', 'chaingun', 'chainguns', 'shotgun', 'rpg', 'flamer'], BODIES = ['soldier', 'gunner', 'commando'];
for (const id of BODIES) ok(JSON.stringify(M.kitsOf(M.CHARACTERS[id])) === JSON.stringify(ARMS), id + ' carries ' + M.kitsOf(M.CHARACTERS[id]));
for (const k of ['shotgun', 'rpg', 'flamer']) ok(!M.kitFits(M.CHARACTERS.person, k) && !M.kitFits(M.CHARACTERS.hyena, k), k + ' is for those who bear arms');
ok(JSON.stringify(B.kitsKept(M.CHARACTERS.soldier)) === JSON.stringify(ARMS) && B.kitsKept(M.CHARACTERS.commando).length === 1, 'the soldier\'s templates and clips are kept for every weapon');
for (const id of BODIES) {
  // ---- the shotgun
  { const shots = [], ev2 = []; let pump = 0, atShot = 9, grip = 0, bad = false, lean = 0, muz = [];
    const S = run(id, (t, S2) => ({ armed: true, kit: 'shotgun', aim: ahead(S2), fire: t >= 3 && t < 12, speed: t < 2.5 ? 1.2 : 0 }), 12.5, (p, S2, t, ev) => {
      if (!fin(p)) bad = true;
      ev.forEach(e => { if (e.type === 'fire') { shots.push(t); atShot = Math.min(atShot, 9); } if (e.type === 'reload' || e.type === 'loaded') ev2.push([e.type, t]); });
      if (t > 2.6) { const w = p.props[0]; grip = Math.max(grip, dist(p.arms[0].hand, w.grip)); lean = Math.max(lean, Math.abs(Math.atan2(S2.local.u[0], S2.local.u[1])));
        if (!S2.act) { const d = dist(p.arms[1].hand, w.fore); pump = Math.max(pump, d); if (shots.length && Math.abs(t - shots[shots.length - 1]) < 0.02) atShot = Math.min(atShot, d); muz.push(S2.local.props[0].muzzle[1] - S2.gRef.x); } } });
    const gaps = shots.slice(1, 8).map((t, i) => t - shots[i]), tag = id + ' shotgun: ';
    ok(!bad && S.kit === 'shotgun' && S.local.props[0].kind === 'shotgun', tag + 'in hand');
    ok(shots.length >= 9 && Math.abs(shots[0] - 3) < 0.02 && gaps.every(g => g > 0.68 && g < 0.76), tag + 'a shot at once, then one every ' + gaps[0].toFixed(2) + ' s');
    ok(pump > 0.085 && pump < 0.115 && atShot < 0.02, tag + 'the fore-end is worked ' + pump.toFixed(3) + ' m back, and is forward again for the shot');
    ok(grip < 0.012 && lean < 0.5, tag + 'the right hand keeps the grip (' + grip.toFixed(4) + '), the kick is stood (' + lean.toFixed(2) + ' rad)');
    ok(ev2.length >= 2 && ev2[0][0] === 'reload' && ev2[0][1] > shots[7] + 0.6 && ev2[1][0] === 'loaded' && shots[8] > ev2[1][1], tag + 'eight shells, then it is loaded again and the fire goes on');
    ok(Math.min.apply(null, muz) > 1.1, tag + 'shouldered (the muzzle is ' + Math.min.apply(null, muz).toFixed(2) + ' m up at least)'); }
  // ---- the launcher
  { const shots = [], rel = [], loaded = []; let grip = 0, fore = 0, bad = false, out = [], inside = [], inHand = 9, away = 9, muz = [], lean = 0, vmax = 0;
    const S = run(id, (t, S2) => ({ armed: true, kit: 'rpg', aim: ahead(S2), fire: (t >= 3 && t < 3.2) || (t >= 4 && t < 9), speed: t > 9.5 ? 6 : 0 }), 12, (p, S2, t, ev) => {
      if (!fin(p)) bad = true;
      ev.forEach(e => { if (e.type === 'fire') shots.push(t); if (e.type === 'reload') rel.push(t); if (e.type === 'loaded') loaded.push(t); });
      if (t > 2.6) { const w = S2.local.props[0], reach = (w.magB[0] - w.muzzle[0]) * w.dir[0] + (w.magB[1] - w.muzzle[1]) * w.dir[1] + (w.magB[2] - w.muzzle[2]) * w.dir[2];
        grip = Math.max(grip, dist(p.arms[0].hand, p.props[0].grip)); lean = Math.max(lean, Math.abs(Math.atan2(S2.local.u[0], S2.local.u[1])));
        if (!S2.act) { fore = Math.max(fore, dist(p.arms[1].hand, p.props[0].fore)); (S2.ammo[0] > 0 ? out : inside).push(reach); if (t < 9) muz.push(w.o[1] - S2.gRef.x); }
        else if (S2.ammo[0] === 0 && S2.act.t / S2.act.dur > 0.45 && S2.act.t / S2.act.dur < 0.7) inHand = Math.min(inHand, dist(p.arms[1].hand, p.props[0].magB));
        else if (S2.ammo[0] === 0 && S2.act.t / S2.act.dur > 0.2 && S2.act.t / S2.act.dur < 0.38) away = Math.min(away, dist(p.arms[1].hand, p.props[0].magB));
        if (t > 11) vmax = Math.max(vmax, S2.v); } });
    const tag = id + ' rpg: ';
    ok(!bad && S.kit === 'rpg' && S.local.props[0].kind === 'launcher', tag + 'in hand');
    ok(shots.length === 2 && shots[0] > 4 + 0.43 && shots[0] < 4 + 0.50, tag + 'a touch of the trigger fires nothing; held, it is steadied ' + (shots[0] - 4).toFixed(2) + ' s and fires');
    ok(rel.length === 2 && rel[0] - shots[0] < 0.02 && loaded.length === 2 && loaded[0] - shots[0] > 2.0 && loaded[0] - shots[0] < 2.4, tag + 'it is loaded again at once (' + (loaded[0] - shots[0]).toFixed(2) + ' s to the rocket\'s seat)');
    ok(shots[1] - shots[0] > 2.75 && shots[1] - shots[0] < 2.95, tag + 'and fires again ' + (shots[1] - shots[0]).toFixed(2) + ' s after');
    ok(out.every(r => Math.abs(r - 0.19) < 1e-6) && out.length > 100, tag + 'a rocket in its mouth, its nose 0.19 m out');
    ok(inHand < 0.02 && away > 0.15, tag + 'the hand goes down empty (' + away.toFixed(2) + ' m from any rocket) and the next rocket comes up in it (' + inHand.toFixed(3) + ' m)');
    ok(grip < 0.012 && fore < 0.012 && lean < 0.6, tag + 'both hands on it (' + grip.toFixed(4) + ', ' + fore.toFixed(4) + ')');
    ok(Math.min.apply(null, muz) > 1.25 && Math.max.apply(null, muz) < 1.75, tag + 'on the shoulder (its rear end ' + Math.min.apply(null, muz).toFixed(2) + ' to ' + Math.max.apply(null, muz).toFixed(2) + ' m up)');
    ok(vmax < 0.85 * lim + 0.05 && vmax > 2.2, tag + 'carried at ' + vmax.toFixed(2) + ' m/s at most');
    // fired and not yet loaded (the reload is broken off by putting it away): the tube is empty
    let emp = [];
    run(id, (t, S2) => ({ armed: t < 4.6, kit: 'rpg', aim: ahead(S2), fire: t >= 3 && t < 4 }), 6, (p, S2, t) => { if (t > 4.4 && S2.ammo[0] === 0 && !S2.act) { const w = S2.local.props[0]; emp.push((w.magB[0] - w.muzzle[0]) * w.dir[0] + (w.magB[1] - w.muzzle[1]) * w.dir[1] + (w.magB[2] - w.muzzle[2]) * w.dir[2]); } });
    ok(emp.length > 50 && emp.every(r => r < -0.4), tag + 'fired, there is no rocket in its mouth (' + (emp[0] || 0).toFixed(2) + ' m: inside the tube)'); }
  // ---- the flamethrower
  { const shots = []; let grip = 0, fore = 0, bad = false, vmax = 0, muz = [];
    const S = run(id, (t, S2) => ({ armed: true, kit: 'flamer', aim: ahead(S2), fire: t >= 3 && t < 6, speed: 6 }), 7, (p, S2, t, ev) => {
      if (!fin(p)) bad = true; ev.forEach(e => { if (e.type === 'fire') shots.push(t); });
      if (t > 2.6) { grip = Math.max(grip, dist(p.arms[0].hand, p.props[0].grip)); fore = Math.max(fore, dist(p.arms[1].hand, p.props[0].fore)); vmax = Math.max(vmax, S2.v); muz.push(S2.local.props[0].muzzle[1] - S2.gRef.x); } }, x => 0.04 * Math.sin(x / 1.3));
    const tag = id + ' flamer: ', rate = (shots.length - 1) / (shots[shots.length - 1] - shots[0]);
    ok(!bad && S.kit === 'flamer' && S.local.props[0].kind === 'flamer', tag + 'in hand');
    ok(Math.abs(shots[0] - 3) < 0.02 && rate > 11 && rate < 15 && shots[shots.length - 1] < 6.01, tag + 'a stream of ' + rate.toFixed(1) + ' puffs a second for as long as the trigger is held');
    ok(S.ammo[0] === 120 - shots.length, tag + 'the fuel is counted');
    ok(grip < 0.012 && fore < 0.012, tag + 'both hands on the lance (' + grip.toFixed(4) + ', ' + fore.toFixed(4) + ')');
    ok(vmax < 0.80 * lim + 0.05 && vmax > 2.0, tag + 'walked with (' + vmax.toFixed(2) + ' m/s)');
    ok(Math.max.apply(null, muz) < 1.3 && Math.min.apply(null, muz) > 0.5, tag + 'from the hip');
    const pr = R.buildPrims(S.local, M.CHARACTERS[id], { flash: false }), C = R.PAL[id], back = pr.filter(q => q.j === 'Pack');
    ok(back.length === 2 && back.every(q => q.col === C.metal) && Math.abs(back[0].a[2] - back[1].a[2]) > 0.1, tag + 'two tanks on the back, side by side, in place of the pack'); }
  // ---- what they are made of
  for (const kit of ['shotgun', 'rpg', 'flamer']) { const ch = M.CHARACTERS[id], S = run(id, (t, S2) => ({ armed: true, kit: kit, speed: 1.2 }), 3), pr = R.buildPrims(S.local, ch, { flash: false }), names = pr.joints.map(j => j.name);
    ok(names.length === 22 && names.indexOf('Weapon') >= 0 && names.indexOf('Magazine') >= 0, id + ' ' + kit + ': the soldier\'s joints, a weapon and what it is loaded with');
    ok(pr.every(q => /^#[0-9a-f]{6}$/.test(q.col) && q.r > 0) && pr.filter(q => q.part === 'weapon').length === 1 && pr.length === R.buildPrims(S.local, ch, { flash: false, model: true }).length, id + ' ' + kit + ': whole parts');
    ok((pr.filter(q => q.j === 'Pack').length === 2) === (kit === 'flamer'), id + ' ' + kit + ': the pack is as it should be');
    const d = B.rigData(ch, { kit: kit }); ok(d.name === id + '_' + kit && d.joints.length === 22, id + ' ' + kit + ': its rig is ' + d.name);
    const c = B.record(ch, 'attack', { kit: kit, fps: 12 }), fl = c.frames.map(p => p.props[0].flash || 0);
    ok(Math.abs(c.duration - (kit === 'shotgun' ? 0.5 : 1.0)) < 0.1 && fl.some(x => x > 0) && (kit !== 'rpg' || fl.slice(0, 5).every(x => x === 0)), id + ' ' + kit + ': its attack clip'); }
}
// the pack of a soldier with any other weapon is as it was
{ const pr = R.buildPrims(run('soldier', (t, S2) => ({ armed: true }), 2).local, M.CHARACTERS.soldier, { flash: false });
  ok(pr.length === 32 && pr.filter(q => q.j === 'Pack').length === 1, 'a soldier with his rifle is as he was'); }
console.log(fails ? fails + ' FAILED' : 'troopers: all passed');
process.exit(fails ? 1 : 0);
