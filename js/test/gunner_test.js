// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
// Gunners: the soldier's body heavily built, who come with a chaingun at the hip; and the chainguns in anyone's hands who bears arms.
const M = require('../core.js'), R = require('../rig.js'), B = require('../bake.js')(M, R);
const st = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 };
let fails = 0;
function ok(c, msg) { if (!c) { fails++; console.log('FAIL ' + msg); } }
function fin(o) { if (typeof o === 'number') return isFinite(o); if (o && typeof o === 'object') { for (const k in o) if (!fin(o[k])) return false; } return true; }
const GUNNERS = ['gunner', 'commando'], HEAVY = ['chaingun', 'chainguns'], lim = Math.sqrt(M.G * 0.92);
// run one: inp(t) -> inputs; each(pose, S, t, events)
function run(id, inp, secs, each, terr) {
  const ch = M.CHARACTERS[id], env = { terrain: terr || (x => 0) }, S = M.createState(ch, env); let p = null;
  for (let i = 0; i < Math.round(secs * 120); i++) { const t = i / 120, a = inp(t, S); p = M.step(S, ch, a, st, env, 1 / 120); const ev = S.events.slice(); S.events.length = 0; if (each) each(p, S, t, ev); }
  return S;
}
const ahead = S => [S.px + 20 * Math.cos(S.h), 1.2, S.pz + 20 * Math.sin(S.h)];
// who may carry what
for (const id of GUNNERS) { const c = M.CHARACTERS[id], so = M.CHARACTERS.soldier;
  ok(c.kind === 'biped' && c.L === so.L && c.legs === so.legs && c.mount.kit === 'chaingun' && !c.mount.civil, id + ' is the soldier\'s body with a chaingun'); }
// any body that bears arms carries any weapon; people who are not soldiers carry their own things, and only those
const ARMS = ['rifle', 'pistols', 'sword', 'chaingun', 'chainguns', 'shotgun', 'rpg', 'flamer'], CIVIL = ['hands', 'case', 'trolley'];
for (const id of ['soldier', 'gunner', 'commando']) { const c = M.CHARACTERS[id];
  ok(JSON.stringify(M.kitsOf(c)) === JSON.stringify(ARMS), id + ' carries ' + M.kitsOf(c));
  for (const k of CIVIL) ok(!M.kitFits(c, k), id + ' does not carry ' + k); }
for (const id of ['person', 'woman', 'technician', 'scientist', 'hazmat']) ok(JSON.stringify(M.kitsOf(M.CHARACTERS[id])) === JSON.stringify(CIVIL), id + ' carries ' + M.kitsOf(M.CHARACTERS[id]));
ok(M.kitsOf(M.CHARACTERS.hyena).length === 0 && M.kitsOf(M.CHARACTERS.mech).length === 0 && !M.kitFits(M.CHARACTERS.hyena, 'rifle'), 'who has no hands carries nothing');
ok(JSON.stringify(B.kitsKept(M.CHARACTERS.soldier)) === JSON.stringify(ARMS) && JSON.stringify(B.kitsKept(M.CHARACTERS.gunner)) === '["chaingun"]' && B.kitsKept(M.CHARACTERS.woman).length === 3 && B.kitsKept(M.CHARACTERS.hyena)[0] === null, 'the kits kept as files');
{ // weapons change hands: each puts away what it has and takes the other up
  for (const [id, kit, kind] of [['soldier', 'chainguns', 'sidegun'], ['soldier', 'chaingun', 'chaingun'], ['gunner', 'rifle', 'rifle'], ['commando', 'sword', 'sword'], ['gunner', 'pistols', 'pistol']]) {
    let shots = 0, gap = 0, bad = false;
    const S = run(id, (t, S2) => ({ armed: true, kit: kit, speed: 1.2, aim: ahead(S2), fire: t > 3.2 }), 5, (p, S2, t, ev) => { if (!fin(p)) bad = true; shots += ev.filter(e => e.type === 'fire').length;
      if (t > 3) { const w = p.props[0], h = p.arms[0].hand; gap = Math.max(gap, Math.hypot(h[0] - w.grip[0], h[1] - w.grip[1], h[2] - w.grip[2])); } });
    ok(!bad && S.kit === kit && S.local.props[0].kind === kind && S.armed.x > 0.95 && gap < 0.03, id + ' takes up ' + kit + ' (' + gap.toFixed(3) + ' m from the grip)');
    ok(kit === 'sword' ? shots === 0 : shots > 3, id + ' fires ' + kit + ' (' + shots + ')');
    const pr = R.buildPrims(S.local, M.CHARACTERS[id], { flash: false }), d = B.rigData(M.CHARACTERS[id], { kit: kit });
    ok(pr.joints.length === d.joints.length && d.name === id + '_' + kit, 'its rig is ' + d.name);
  }
  let S = run('person', (t, S2) => ({ armed: true, kit: 'chaingun', speed: 1.4 }), 3); ok(S.kit === 'hands', 'a person asked for a chaingun keeps his hands empty');
  // a soldier is not pushed over by a chaingun either: how hard a round pushes is the gun's
  let lean = 0; run('soldier', (t, S2) => ({ armed: true, kit: 'chaingun', aim: ahead(S2), fire: t > 3 }), 7, (p, S2, t) => { if (t > 3) lean = Math.max(lean, Math.abs(Math.atan2(S2.local.u[0], S2.local.u[1]))); });
  ok(lean < 0.30, 'a soldier stands up to a chaingun (leans ' + lean.toFixed(2) + ' rad)'); }
for (const id of GUNNERS) for (const kit of HEAVY) {
  // the barrels come up to speed before the first round, each time the trigger is pulled; then the rounds come fast
  const shots = [], guns = [], pair = kit === 'chainguns'; let bad = false, gap = 0, lean = 0, loaded = 0, n = 0, low = 9, high = -9;
  const S = run(id, (t, S2) => ({ armed: true, kit: kit, speed: t < 9 ? 1.2 : 0, aim: ahead(S2), fire: (t >= 3 && t < 5) || (t >= 6 && t < 7.5) }), 9, (p, S2, t, ev) => {
    if (!fin(p)) bad = true;
    ev.forEach(e => { if (e.type === 'fire') { shots.push(t); guns.push(e.gun); } if (e.type === 'loaded') loaded++; });
    if (t > 2.5) { p.props.forEach((w, k) => { const h = p.arms[k].hand; gap = Math.max(gap, Math.hypot(h[0] - w.grip[0], h[1] - w.grip[1], h[2] - w.grip[2])); });
      if (!pair) { const h = p.arms[1].hand, w = S2.local.props[0], F = p.props[0].fore; if (F) gap = Math.max(gap, Math.hypot(h[0] - F[0], h[1] - F[1], h[2] - F[2])); }
      lean = Math.max(lean, Math.abs(Math.atan2(S2.local.u[0], S2.local.u[1]))); n++;
      const w = S2.local.props[0]; low = Math.min(low, w.muzzle[1] - S2.gRef.x); high = Math.max(high, w.muzzle[1] - S2.gRef.x); }
  }, x => 0.04 * Math.sin(x / 1.3));
  const tag = id + ' ' + kit + ': ';
  ok(!bad && S.kit === kit && S.local.props.length === (pair ? 2 : 1), tag + 'whole poses, the kit in hand');
  const a = shots.filter(t => t < 5.5), b = shots.filter(t => t >= 5.5);
  ok(a.length > 25 && a[0] >= 3 + 0.33 && a[0] < 3 + 0.40, tag + 'the first round comes ' + (a[0] - 3).toFixed(3) + ' s after the trigger');
  ok(b.length > 15 && b[0] >= 6 + 0.33 && b[0] < 6 + 0.40, tag + 'and so again after the trigger was let go (' + (b[0] - 6).toFixed(3) + ' s)');
  const rate = (a.length - 1) / (a[a.length - 1] - a[0]);
  ok(pair ? rate > 22 && rate < 31 : rate > 18 && rate < 23, tag + rate.toFixed(1) + ' rounds a second');
  ok(a[a.length - 1] < 5.01 && shots.every(t => t < 7.51), tag + 'no round after the trigger is let go');
  if (pair) ok(guns.every((g, i) => i === 0 || g !== guns[i - 1]) && guns.indexOf(0) >= 0 && guns.indexOf(1) >= 0, tag + 'the two guns fire in turn');
  ok(gap < 0.012, tag + 'the hands stay on the grips (' + gap.toFixed(4) + ' m)');
  ok(lean < 0.30, tag + 'the fire does not push the gunner over (leans ' + lean.toFixed(2) + ' rad at most)');
  ok(low > 0.55 && high < 1.35, tag + 'fired from the hip (the muzzle is ' + low.toFixed(2) + ' to ' + high.toFixed(2) + ' m up)');
  const full = M.PROPS[M.KITS[kit].props[0]].rounds;
  ok(S.ammo.reduce((x, y) => x + y, 0) === full * (pair ? 2 : 1) - shots.length, tag + 'each round is counted');
  // it is not run with while it is in the hands; put away, the gunner runs
  let v1 = 0, v2 = 0;
  run(id, (t, S2) => ({ armed: t < 5, kit: kit, speed: 6 }), 9, (p, S2, t) => { if (t > 3 && t < 5) v1 = Math.max(v1, S2.v); if (t > 8) v2 = Math.max(v2, S2.v); });
  ok(v1 < M.KITS[kit].pace * lim + 0.05 && v1 > M.KITS[kit].pace * lim - 0.3, tag + 'carried at ' + v1.toFixed(2) + ' m/s at most');
  ok(v2 > 4.5 && S.local.props.every(w => w.stow !== undefined), tag + 'put away, he runs (' + v2.toFixed(2) + ' m/s)');
  // the aim: up and down with the target
  for (const [ty, sgn] of [[4.5, 1], [-1.5, -1]]) { const S3 = run(id, (t, S2) => ({ armed: true, kit: kit, aim: [S2.px + 6, ty, 0] }), 3); ok(sgn * S3.local.props[0].dir[1] > 0.2, tag + 'aims ' + (sgn > 0 ? 'up' : 'down')); }
}
// held down, the belt runs out; a new one is fed in (the muzzle goes down) and the fire goes on
{ const shots = [], loads = [], dips = []; let reloading = 0;
  run('commando', (t, S2) => ({ armed: true, aim: ahead(S2), fire: true }), 16, (p, S2, t, ev) => { ev.forEach(e => { if (e.type === 'fire') shots.push(t); if (e.type === 'loaded') loads.push(t); });
    if (S2.act && S2.act.name === 'reload') { reloading++; dips.push(S2.local.props[0].dir[1]); } });
  const dry = shots[199], again = shots[200];
  ok(shots.length > 200 && again - dry > 3.0 && again - dry < 3.8, 'a belt of 200, and ' + (again - dry).toFixed(2) + ' s to feed in another');
  ok(loads.length === 1 && loads[0] > dry + 2.4 && loads[0] < again, 'the new belt is in before the fire goes on');
  ok(Math.min.apply(null, dips) < -0.3, 'the muzzle goes down while it is fed in (' + Math.min.apply(null, dips).toFixed(2) + ')'); }
// what they are made of
{ const sol = R.buildPrims(run('soldier', (t, S2) => ({ armed: true }), 2).local, M.CHARACTERS.soldier, { flash: false });
  ok(sol.length === 32 && sol.joints.length === 22, 'a soldier is as he was');
  for (const id of GUNNERS) for (const kit of HEAVY) { const ch = M.CHARACTERS[id], S = run(id, (t, S2) => ({ armed: true, kit: kit, speed: 1.2 }), 3), pr = R.buildPrims(S.local, ch, { flash: false }), C = R.PAL[id], H = R.HEAVY[id], pair = kit === 'chainguns';
    const names = pr.joints.map(j => j.name), tag = id + ' ' + kit + ': ';
    ok(pair ? ['Weapon_R', 'Magazine_R', 'Weapon_L', 'Magazine_L'].every(n => names.indexOf(n) >= 0) && names.length === 24 : names.indexOf('Weapon') >= 0 && names.indexOf('Magazine') >= 0 && names.length === 22, tag + 'joints');
    const thigh = pr.find(q => q.part === 'thigh'), sthigh = sol.find(q => q.part === 'thigh');
    ok(Math.abs(thigh.r - sthigh.r * H.scale) < 1e-12 && H.scale > 1.1, tag + 'heavily built');
    ok(pr.find(q => q.part === 'head').r === (H.bare ? 0.108 : 0.115) && pr.filter(q => q.part === 'weapon').length === (pair ? 2 : 1), tag + 'a head as it was, a gun in each hand that has one');
    ok(pr.filter(q => q.of === 'weapon' && q.col === C.dark && q.r === 0.016).length === (pair ? 6 : 3), tag + 'three barrels to a gun');
    ok(pr.every(q => /^#[0-9a-f]{6}$/.test(q.col) && q.r > 0) && pr.length === R.buildPrims(S.local, ch, { flash: false, model: true }).length, tag + 'whole parts');
    ok((pr.filter(q => q.col === C.skin).length >= 5) === !!H.bare && pr.some(q => q.j === 'Head' && q.col === C.band) === !!H.bare && pr.some(q => q.j === 'Head' && q.col === C.glow) === !H.bare, tag + (H.bare ? 'bare arms and a headband' : 'armour and a visor'));
    ok((pr.filter(q => q.g === 'torso' && q.b === null).length === 2) === !!H.pads, tag + 'shoulder pads');
    const d = B.rigData(ch, { kit: kit === ch.mount.kit ? null : kit }); ok(d.name === (pair ? id + '_chainguns' : id) && d.joints.length === names.length, tag + 'its rig is ' + d.name);
    ok(R.wearOf(id) === null && B.wardrobe(ch) === null, tag + 'no wardrobe'); }
}
// clips: the attack is a burst with the trigger held through the barrels' coming up
for (const id of GUNNERS) for (const kit of HEAVY) { const ch = M.CHARACTERS[id], c = B.record(ch, 'attack', { kit: kit === ch.mount.kit ? null : kit, fps: 12 });
  const fl = c.frames.map(p => Math.max.apply(null, p.props.map(w => w.flash || 0)));
  ok(Math.abs(c.duration - 1.0) < 0.1 && fl.slice(0, 4).every(x => x === 0) && fl.slice(5).some(x => x > 0), id + ' ' + kit + ': attack is a second long, the fire in its later part');
  const names = B.recordAll(ch, { frames: 8, kit: kit === ch.mount.kit ? null : kit }).map(x => x.name);
  ok(['idle', 'walk', 'run', 'attack', 'reload', 'hit', 'die', 'jump', 'throw'].every(n => names.indexOf(n) >= 0), id + ' ' + kit + ': clips ' + names.length); }
console.log(fails ? fails + ' FAILED' : 'gunners: all passed');
process.exit(fails ? 1 : 0);
