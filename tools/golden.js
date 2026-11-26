#!/usr/bin/env node
// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
/* Recorded runs: what a whole character does, step by step, for the ports to be checked against.

   spec/scenarios.json describes each run as data only: the character, the ground, and the inputs with the
   time each one starts.  This tool plays them through the JavaScript reference and writes spec/golden/<id>.txt:
     line 1    # id character steps-a-second
     others    time  mode  n  v1 ... vn      every number in the pose, keys in alphabetical order at every level

     node tools/golden.js            write the files
     node tools/golden.js --check    play again and compare with the files (exit 1 on a difference)
     node tools/golden.js --check --events    also list the events each run gave

   A run marked "stage": 2 uses only what the ground step reads (speed, crouch, steer, heading, dir, jump, hit,
   move, pounce).  For those, spec/ground/<id>.txt is written too, a replay that needs no JSON reader:
     # id character steps-a-second steps sample-every
     g nwaves [height kx kz phase]... wall x h
     i step  <19 input numbers>           the inputs from this step on (see inputLine below)
     p n v1 ... vn                        what the ground step left behind (see groundLine below)

   A run marked "stage": 2, 3 or 4 is written to spec/body/<id>.txt instead of spec/golden/, the same way
   (stage 4 runs also swim, fly, climb a ladder or a ledge: they have c lines, "c step call arguments", with call
   1 enterSwim, 2 leaveSwim, 3 enterFly, 4 leaveFly, 5 enterLadder, 6 leaveLadder, 7 grabLedge x y z, 8 place x z heading, 9 stand,
   and an l line for a ladder: x y0 spacing amp freq phase): i lines with every input (see inputLine3 below), and p lines with the
   whole pose (every number, keys in alphabetical order at every level) followed by how many of each event
   there have been so far (fire reload loaded throw grab putdown punch strike land jump hit drop bite pounce pinch
   sting ink grip top die mount dismount), and the sum of
   every number the events have carried (positions, velocities, which gun or hand), and the mode the body is in
   (0 ground, 1 ladder, 2 ragdoll, 3 swim, 4 fly, 5 ledge, 6 ride).

   The ground:  { "waves": [[height, kx, kz, phase], ...], "wall": { "x": 3, "h": 2.3 } }
   height(x, z) = sum of height * sin(kx * x + kz * z + phase), plus h beyond the wall.  No waves: flat.
   For every third sample of a whole-body run, spec/skeleton/<id>.txt has what the live skeleton makes of that pose
   (B.liveSkeleton, B.liveParts, B.jointMove), boiled down so that the files stay small:
     k sample rig n  a b  a b ...  parts order shade move
   for each of the n joints, a = its place and b = its three axes, each weighed into one number (see skeletonLine);
   then the parts those joints carry, their draw order and shading seen from the side, and the joints' moves from
   the template pose, each as one number.

   A run with "style": { ... } is played with those style settings over the usual ones; its replay has an s line:
   bounce stride arm lean step snap still.

   A run with a rider has "mount": the character ridden, and "mountScript": its own script.  The replay then has
   an m line (the mount's character), j lines (the mount's inputs, like i lines) and d lines (calls on the mount,
   like c lines); calls 10 mountUp and 11 dismount are the rider's.  Each step the mount is stepped first, then
   the rider; the p lines are the rider's.

   A script entry: [time, { input: value, ... }] changes inputs from that time on; an input named with a "!"
   in front is given for one step only ("!jump": true).  [time, "call", name, ...arguments] calls one of
   enterSwim, leaveSwim, enterFly, leaveFly, enterLadder, leaveLadder, grabLedge, place. */
const fs = require('fs'), path = require('path');
const M = require('../js/core.js'), R = require('../js/rig.js'), B = require('../js/bake.js')(M, R);
const dir = path.join(__dirname, '..', 'spec'), out = path.join(dir, 'golden');
const STYLE0 = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3, still: 0 };

function ground(g) {
  g = g || {};
  const w = g.waves || [], wall = g.wall;
  return function (x, z) {
    let y = 0; z = z || 0;
    for (let i = 0; i < w.length; i++) y += w[i][0] * Math.sin(w[i][1] * x + w[i][2] * z + w[i][3]);
    return y + (wall && x > wall.x ? wall.h : 0);
  };
}
function flat(v, acc) {
  if (typeof v === 'number') acc.push(v);
  else if (typeof v === 'boolean') acc.push(v ? 1 : 0);
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) flat(v[i], acc);
  else if (v && typeof v === 'object') Object.keys(v).sort().forEach(function (k) { flat(v[k], acc); });
  return acc;
}
function fmt17(x) { return Number(x).toPrecision(17).replace(/\.?0+$/, '').replace(/\.?0+e/, 'e'); }
/* The inputs the ground step reads, as numbers: speed crouch steer hasHeading heading dir jump hasHit hx hy hz
   hasMove mx mz hasPounce hasTarget tx ty tz */
function inputLine(inp) {
  const h = inp.hit && inp.hit.impulse, m = inp.move, pc = inp.pounce, t = pc && pc.target;
  return [inp.speed || 0, inp.crouch || 0, inp.steer || 0, inp.heading != null ? 1 : 0, inp.heading || 0, inp.dir || 0, inp.jump ? 1 : 0,
    h ? 1 : 0, h ? h[0] : 0, h ? h[1] : 0, h ? h[2] || 0 : 0, m ? 1 : 0, m ? m[0] || 0 : 0, m ? m[1] || 0 : 0, pc ? 1 : 0, t ? 1 : 0, t ? t[0] : 0, t ? t[1] : 0, t ? t[2] || 0 : 0].map(fmt17).join(' ');
}
/* Everything a whole biped or mech reads: the 19 numbers of inputLine, then
   aim (0 none, 2 or 3 numbers given) ax ay az, fire, armed, kit (0 unsaid, 1 rifle, 2 pistols, 3 sword, 4 hands, 5 case, 6 trolley, 7 chaingun, 8 chainguns, 9 shotgun, 10 rpg, 11 flamer), reload,
   throw (0, 1 no target, 2 target) tx ty tz, pickup, hasAt ax ay az, hasHeading heading, hasSize d h w, putdown, guard, block,
   punch (0, 1 jab, 2 cross, 3 hook), hasTarget tx ty tz, hasTrack tx ty tz, swing (0, 1 slash, 2 chop, 3 thrust),
   then bite, pinch, sting and grab, each as (0, 1 no target, 2 target) tx ty tz, and ink,
   then hasDepth depth (swimming), hasHeight height (flying), climb, drop (hanging from a ledge),
   then die (0, 1 knocked down from straight ahead, 2 with the impulse given) ix iy iz */
const KITN = { rifle: 1, pistols: 2, sword: 3, hands: 4, 'case': 5, trolley: 6, chaingun: 7, chainguns: 8, shotgun: 9, rpg: 10, flamer: 11 }, PUNCHN = { jab: 1, cross: 2, hook: 3 }, SWINGN = { slash: 1, chop: 2, thrust: 3 };
const TALLY = ['fire', 'reload', 'loaded', 'throw', 'grab', 'putdown', 'punch', 'strike', 'land', 'jump', 'hit', 'drop', 'bite', 'pounce', 'pinch', 'sting', 'ink', 'grip', 'top', 'die', 'mount', 'dismount'];
const MODES = ['ground', 'ladder', 'ragdoll', 'swim', 'fly', 'ledge', 'ride'], CALLS = ['', 'enterSwim', 'leaveSwim', 'enterFly', 'leaveFly', 'enterLadder', 'leaveLadder', 'grabLedge', 'place', 'stand', 'mountUp', 'dismount'];
// a ladder as data: rung k is at y0 + k * spacing + amp * sin(freq * k + phase), so the rungs can be uneven
function ladderOf(l) { return { x: l.x, y0: l.y0, spacing: l.spacing, rung: function (k) { return l.y0 + k * l.spacing + (l.amp || 0) * Math.sin((l.freq || 0) * k + (l.phase || 0)); } }; }
function inputLine3(inp) {
  const v3 = function (a) { return a ? [a[0], a[1], a[2] || 0] : [0, 0, 0]; };
  const aimed = function (x) { return [x ? (x.target ? 2 : 1) : 0].concat(v3(x && x.target)); };
  const a = inp.aim, th = inp.throw, pk = inp.pickup, pu = inp.punch, tr = inp.track, sw = inp.swing, sz = pk && pk.size;
  const v = [a ? a.length : 0].concat(v3(a), [inp.fire ? 1 : 0, inp.armed ? 1 : 0, KITN[inp.kit] || 0, inp.reload ? 1 : 0,
    th ? (th.target ? 2 : 1) : 0], v3(th && th.target), [pk ? 1 : 0, pk && pk.at ? 1 : 0], v3(pk && pk.at), [pk && pk.heading != null ? 1 : 0, pk && pk.heading || 0,
    sz ? 1 : 0, sz ? sz.d : 0, sz ? sz.h : 0, sz ? sz.w : 0, inp.putdown ? 1 : 0, inp.guard ? 1 : 0, inp.block ? 1 : 0,
    pu ? PUNCHN[pu.kind] || 1 : 0, pu && pu.target ? 1 : 0], v3(pu && pu.target), [tr ? 1 : 0], v3(tr), [sw ? SWINGN[sw.kind] || 1 : 0],
    aimed(inp.bite), aimed(inp.pinch), aimed(inp.sting), aimed(inp.grab), [inp.ink ? 1 : 0],
    [inp.depth === undefined ? 0 : 1, inp.depth || 0, inp.height === undefined ? 0 : 1, inp.height || 0, inp.climb ? 1 : 0, inp.drop ? 1 : 0],
    [inp.die ? (inp.die.impulse ? 2 : 1) : 0], v3(inp.die && inp.die.impulse));
  return inputLine(inp) + ' ' + v.map(fmt17).join(' ');
}
/* What the ground step leaves behind: px pz h x y v a phase om crouch run gal ground pitch-state reach-drop hop bank side,
   root (3) and pitch as drawn, landings and jumps so far, then for each leg: planted, hip, knee, ankle, ball,
   heel and toe if it has a foot, and the place it is stepping to if it is in the air.  Points are in the world. */
function groundLine(S, ch, lands, jumps) {
  const P = S.pose, v = [S.px, S.pz, S.h, S.x, S.y, S.v, S.a, S.phase, S.om, S.crouch, S.run, S.gal || 0, S.gRef.x, S.pitch.x, S.reachDrop, S.hop.x, S.bank.x, S.side.x]
    .concat(P.root, [P.pitch, lands, jumps]);
  P.legs.forEach(function (l, k) {
    v.push(l.planted ? 1 : 0); [].push.apply(v, l.hip.concat(l.knee, l.ankle, l.ball));
    if (ch.legs[k].foot) [].push.apply(v, l.heel.concat(l.toe));
    if (!l.planted) [].push.apply(v, l.target);
  });
  return v.length + ' ' + v.map(fmt).join(' ');
}
function fmt(x) { return Number.isFinite(x) ? Number(x.toPrecision(10)).toString() : 'nan'; }

/* The live skeleton of a pose as a few numbers. sk: B.liveSkeleton's answer. */
const SIDE = R.projector({ cx: 0, cy: 0, cz: 0, yaw: 0, pit: 0, ppm: 1, ox: 0, oy: 0 });
function skeletonLine(sk) {
  const v = [];
  sk.frames.forEach(function (f) {
    v.push(f.o[0] + 0.7 * f.o[1] + 0.3 * f.o[2]);
    v.push(0.9 * f.x[0] + 0.5 * f.x[1] + 0.2 * f.x[2] + 0.4 * f.y[0] + f.y[1] + 0.6 * f.y[2] + 0.3 * f.z[0] + 0.8 * f.z[1] + 1.1 * f.z[2]);
  });
  const parts = B.liveParts(sk); let p1 = 0, ok = 0, ol = 0, mv = 0;
  parts.forEach(function (q, i) { p1 += ((i % 7) + 1) * (q.a[0] + 0.7 * q.a[1] + 0.3 * q.a[2] + (q.b ? 0.5 * q.b[0] + 0.9 * q.b[1] + 0.4 * q.b[2] : 0)); });
  R.order(parts, SIDE);
  parts.forEach(function (q, i) { ok += q.k * ((i % 5) + 1); ol += q.lv * ((i % 3) + 1); });
  sk.frames.forEach(function (f, j) { B.jointMove(sk, j).forEach(function (x, e) { mv += x * ((e % 4) + 1); }); });
  return sk.rig.name + ' ' + sk.frames.length + ' ' + v.concat([p1 / parts.length, ok, ol, mv / sk.frames.length]).map(fmt).join(' ');
}

function play(sc) {
  const STYLE = Object.assign({}, STYLE0, sc.style || {});
  const ch = M.CHARACTERS[sc.character], env = { terrain: ground(sc.ground) };
  if (sc.ladder) env.ladder = ladderOf(sc.ladder);
  const cmt = sc.mount ? M.CHARACTERS[sc.mount] : null, envM = { terrain: env.terrain }, Sm = cmt ? M.createState(cmt, envM) : null, inpM = { speed: 0 }, scriptM = (sc.mountScript || []).slice();
  let atM = 0, lastInM = null;
  if (cmt) env.mount = { S: Sm, ch: cmt };
  const S = M.createState(ch, env), hz = sc.hz || 60, dt = 1 / hz, every = sc.every || 10, n = Math.round(sc.seconds * hz);
  const inp = { speed: 0 }, script = sc.script.slice(), lines = ['# ' + sc.id + ' ' + sc.character + ' ' + hz];
  let at = 0, lastIn = null, lands = 0, jumps = 0;
  const G2 = sc.stage === 2 ? [] : null, gw = (sc.ground && sc.ground.waves) || [], wl = sc.ground && sc.ground.wall;
  if (G2) {
    G2.push('# ' + sc.id + ' ' + sc.character + ' ' + hz + ' ' + n + ' ' + every);
    G2.push('g ' + gw.length + ' ' + [].concat.apply([], gw).map(fmt17).join(' ') + (gw.length ? ' ' : '') + (wl ? '1 ' + fmt17(wl.x) + ' ' + fmt17(wl.h) : '0 0 0'));
  }
  play.ground = G2;
  // a whole-body replay for every run that stays on the ground (no calls into other modes)
  const whole = sc.stage === 2 || sc.stage === 3 || sc.stage === 4;
  const B3 = whole ? ['# ' + sc.id + ' ' + sc.character + ' ' + hz + ' ' + n + ' ' + every, G2 ? G2[1] : 'g ' + gw.length + ' ' + [].concat.apply([], gw).map(fmt17).join(' ') + (gw.length ? ' ' : '') + (wl ? '1 ' + fmt17(wl.x) + ' ' + fmt17(wl.h) : '0 0 0')] : null;
  if (B3 && sc.ladder) B3.push('l ' + [sc.ladder.x, sc.ladder.y0, sc.ladder.spacing, sc.ladder.amp || 0, sc.ladder.freq || 0, sc.ladder.phase || 0].map(fmt17).join(' '));
  if (B3 && cmt) B3.push('m ' + sc.mount);
  if (B3 && sc.style) B3.push('s ' + [STYLE.bounce, STYLE.stride, STYLE.arm, STYLE.lean, STYLE.step, STYLE.snap, STYLE.still].map(fmt17).join(' '));
  const tally = TALLY.map(function () { return 0; });
  let lastIn3 = null, evsum = 0;
  play.body = B3;
  const K3 = whole ? ['# ' + sc.id + ' ' + sc.character] : null; let skPrev = null, nSample = 0;
  play.skeleton = K3;
  const seen = play.events = [];
  for (let i = 0; i < n; i++) {
    const t = i * dt, once = [], onceM = [];
    while (cmt && atM < scriptM.length && scriptM[atM][0] <= t + 1e-9) {
      const e = scriptM[atM++];
      if (e[1] === 'call') { M[e[2]].apply(null, [Sm, cmt, envM].concat(e.slice(3))); B3.push('d ' + i + ' ' + CALLS.indexOf(e[2]) + ' ' + [].concat.apply([], e.slice(3)).map(fmt17).join(' ')); }
      else Object.keys(e[1]).forEach(function (k) { if (k[0] === '!') { inpM[k.slice(1)] = e[1][k]; onceM.push(k.slice(1)); } else inpM[k] = e[1][k]; });
    }
    while (at < script.length && script[at][0] <= t + 1e-9) {
      const e = script[at++];
      if (e[1] === 'call') {
        if (e[2] === 'mountUp') M.mountUp(S, ch, env, env.mount); else M[e[2]].apply(null, [S, ch, env].concat(e.slice(3)));
        if (B3) B3.push('c ' + i + ' ' + CALLS.indexOf(e[2]) + ' ' + [].concat.apply([], e.slice(3)).map(fmt17).join(' '));
      }
      else Object.keys(e[1]).forEach(function (k) { if (k[0] === '!') { inp[k.slice(1)] = e[1][k]; once.push(k.slice(1)); } else inp[k] = e[1][k]; });
    }
    if (B3) { const iv3 = inputLine3(inp); if (iv3 !== lastIn3) { B3.push('i ' + i + ' ' + iv3); lastIn3 = iv3; } }
    if (G2) { const iv = inputLine(inp); if (iv !== lastIn) { G2.push('i ' + i + ' ' + iv); lastIn = iv; } }
    if (cmt) {
      const ivm = inputLine3(inpM); if (ivm !== lastInM) { B3.push('j ' + i + ' ' + ivm); lastInM = ivm; }
      M.step(Sm, cmt, inpM, STYLE, envM, dt); Sm.events.length = 0; onceM.forEach(function (k) { delete inpM[k]; });
    }
    M.step(S, ch, inp, STYLE, env, dt);
    S.events.forEach(function (e) { if (e.type === 'land') lands++; else if (e.type === 'jump') jumps++; });
    S.events.forEach(function (e) { const k = TALLY.indexOf(e.type); if (k >= 0) tally[k]++; flat(e, []).forEach(function (x) { evsum += x; }); });
    S.events.forEach(function (e) { seen.push(e.type); });
    S.events.length = 0;
    once.forEach(function (k) { delete inp[k]; });
    if (G2 && i % every === every - 1) G2.push('p ' + groundLine(S, ch, lands, jumps));
    if (B3 && i % every === every - 1) {
      const v3 = flat(S.pose, []).concat(tally, [evsum, MODES.indexOf(S.mode)]); B3.push('p ' + v3.length + ' ' + v3.map(fmt).join(' '));
      if (nSample % 3 === 0) { skPrev = B.liveSkeleton(ch, S.pose, skPrev); K3.push('k ' + nSample + ' ' + skeletonLine(skPrev)); }
      nSample++;
    }
    if (i % every === every - 1) { const v = flat(S.pose, []); lines.push(fmt((i + 1) * dt) + ' ' + S.mode + ' ' + v.length + ' ' + v.map(fmt).join(' ')); }
  }
  return lines.join('\n') + '\n';
}

const scenarios = JSON.parse(fs.readFileSync(path.join(dir, 'scenarios.json'), 'utf8')).scenarios, check = process.argv.indexOf('--check') >= 0;
let bad = 0, samples = 0, bytes = 0, grounds = 0, bodies = 0;
if (!check) fs.mkdirSync(out, { recursive: true });
scenarios.forEach(function (sc) {
  const text = play(sc), file = path.join(out, sc.id + '.txt');
  if (process.argv.indexOf('--events') >= 0) console.log(sc.id + ': ' + play.events.join(' '));
  if (/ nan/.test(text)) { bad++; console.log(sc.id + ': a pose value is not a number'); }
  samples += text.split('\n').length - 2; bytes += text.length;
  if (play.ground) {
    const gt = play.ground.join('\n') + '\n', gf = path.join(dir, 'ground', sc.id + '.txt'); grounds++;
    if (/ nan/.test(gt)) { bad++; console.log(sc.id + ': a ground value is not a number'); }
    if (check) { if (!fs.existsSync(gf) || fs.readFileSync(gf, 'utf8') !== gt) { bad++; console.log(sc.id + ': ground replay differs from the recorded one'); } }
    else { fs.mkdirSync(path.join(dir, 'ground'), { recursive: true }); fs.writeFileSync(gf, gt); }
  }
  if (play.body) {
    const bt = play.body.join('\n') + '\n', bf = path.join(dir, 'body', sc.id + '.txt'); bodies++;
    if (/ nan/.test(bt)) { bad++; console.log(sc.id + ': a body value is not a number'); }
    if (check) { if (!fs.existsSync(bf) || fs.readFileSync(bf, 'utf8') !== bt) { bad++; console.log(sc.id + ': body replay differs from the recorded one'); } }
    else { fs.mkdirSync(path.join(dir, 'body'), { recursive: true }); fs.writeFileSync(bf, bt); }
  }
  if (play.skeleton) {
    const kt = play.skeleton.join('\n') + '\n', kf = path.join(dir, 'skeleton', sc.id + '.txt');
    if (/ nan/.test(kt)) { bad++; console.log(sc.id + ': a skeleton value is not a number'); }
    if (check) { if (!fs.existsSync(kf) || fs.readFileSync(kf, 'utf8') !== kt) { bad++; console.log(sc.id + ': skeleton differs from the recorded one'); } }
    else { fs.mkdirSync(path.join(dir, 'skeleton'), { recursive: true }); fs.writeFileSync(kf, kt); }
  }
  if (play.body) return;                                    // the whole-body replay holds the same poses
  if (check) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { bad++; console.log(sc.id + ': differs from the recorded run'); } }
  else fs.writeFileSync(file, text);
});
/* Clips: spec/clips.txt has every clip of every character (and of each of the soldier's kits), as the baker records
   it with eight poses to a cycle. One line a clip:
     c character kit|- name poses loops seconds speed travel rise  then one number for each pose
   where a pose's number is the sum of its values, each times (its place in the pose mod 11) + 1, over how many. */
const clipLines = [];
let nClips = 0, nClipPoses = 0;
Object.keys(M.CHARACTERS).forEach(function (id) {
  const ch = M.CHARACTERS[id];
  (B.kitsKept(ch)).forEach(function (kit) {
    B.recordAll(ch, { frames: 8, kit: kit === ch.mount.kit ? null : kit }).forEach(function (c) {
      const nums = c.frames.map(function (p) { const v = flat(p, []); let s = 0; v.forEach(function (x, i) { s += x * ((i % 11) + 1); }); return s / v.length; });
      clipLines.push('c ' + id + ' ' + (kit && kit !== ch.mount.kit ? kit : '-') + ' ' + c.name + ' ' + c.frames.length + ' ' + (c.loop ? 1 : 0) + ' '
        + [c.duration, c.speed, c.travel, c.rise].concat(nums).map(fmt).join(' '));
      nClips++; nClipPoses += c.frames.length;
    });
  });
});
{
  const ct = clipLines.join('\n') + '\n', cf = path.join(dir, 'clips.txt');
  if (/ nan/.test(ct)) { bad++; console.log('clips: a value is not a number'); }
  if (check) { if (!fs.existsSync(cf) || fs.readFileSync(cf, 'utf8') !== ct) { bad++; console.log('clips differ from the recorded ones'); } }
  else fs.writeFileSync(cf, ct);
  console.log((check ? 'checked ' : 'recorded ') + nClips + ' clips, ' + nClipPoses + ' poses');
}
console.log((check ? 'checked ' : 'recorded ') + scenarios.length + ' runs, ' + samples + ' poses, ' + Math.round(bytes / 1024) + ' KB, ' + grounds + ' ground replays, ' + bodies + ' body replays' + (bad ? ', ' + bad + ' wrong' : ''));
process.exit(bad ? 1 : 0);
