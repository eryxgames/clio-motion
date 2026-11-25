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

   The ground:  { "waves": [[height, kx, kz, phase], ...], "wall": { "x": 3, "h": 2.3 } }
   height(x, z) = sum of height * sin(kx * x + kz * z + phase), plus h beyond the wall.  No waves: flat.
   A script entry: [time, { input: value, ... }] changes inputs from that time on; an input named with a "!"
   in front is given for one step only ("!jump": true).  [time, "call", name, ...arguments] calls one of
   enterSwim, leaveSwim, enterFly, leaveFly, enterLadder, leaveLadder, grabLedge, place. */
const fs = require('fs'), path = require('path');
const M = require('../js/core.js');
const dir = path.join(__dirname, '..', 'spec'), out = path.join(dir, 'golden');
const STYLE = { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 };

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

function play(sc) {
  const ch = M.CHARACTERS[sc.character], env = { terrain: ground(sc.ground) };
  if (sc.ladder) env.ladder = sc.ladder;
  const S = M.createState(ch, env), hz = sc.hz || 60, dt = 1 / hz, every = sc.every || 10, n = Math.round(sc.seconds * hz);
  const inp = { speed: 0 }, script = sc.script.slice(), lines = ['# ' + sc.id + ' ' + sc.character + ' ' + hz];
  let at = 0, lastIn = null, lands = 0, jumps = 0;
  const G2 = sc.stage === 2 ? [] : null, gw = (sc.ground && sc.ground.waves) || [], wl = sc.ground && sc.ground.wall;
  if (G2) {
    G2.push('# ' + sc.id + ' ' + sc.character + ' ' + hz + ' ' + n + ' ' + every);
    G2.push('g ' + gw.length + ' ' + [].concat.apply([], gw).map(fmt17).join(' ') + (gw.length ? ' ' : '') + (wl ? '1 ' + fmt17(wl.x) + ' ' + fmt17(wl.h) : '0 0 0'));
  }
  play.ground = G2;
  const seen = play.events = [];
  for (let i = 0; i < n; i++) {
    const t = i * dt, once = [];
    while (at < script.length && script[at][0] <= t + 1e-9) {
      const e = script[at++];
      if (e[1] === 'call') M[e[2]].apply(null, [S, ch, env].concat(e.slice(3)));
      else Object.keys(e[1]).forEach(function (k) { if (k[0] === '!') { inp[k.slice(1)] = e[1][k]; once.push(k.slice(1)); } else inp[k] = e[1][k]; });
    }
    if (G2) { const iv = inputLine(inp); if (iv !== lastIn) { G2.push('i ' + i + ' ' + iv); lastIn = iv; } }
    M.step(S, ch, inp, STYLE, env, dt);
    S.events.forEach(function (e) { if (e.type === 'land') lands++; else if (e.type === 'jump') jumps++; });
    S.events.forEach(function (e) { seen.push(e.type); });
    S.events.length = 0;
    once.forEach(function (k) { delete inp[k]; });
    if (G2 && i % every === every - 1) G2.push('p ' + groundLine(S, ch, lands, jumps));
    if (i % every === every - 1) { const v = flat(S.pose, []); lines.push(fmt((i + 1) * dt) + ' ' + S.mode + ' ' + v.length + ' ' + v.map(fmt).join(' ')); }
  }
  return lines.join('\n') + '\n';
}

const scenarios = JSON.parse(fs.readFileSync(path.join(dir, 'scenarios.json'), 'utf8')).scenarios, check = process.argv.indexOf('--check') >= 0;
let bad = 0, samples = 0, bytes = 0, grounds = 0;
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
  if (check) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { bad++; console.log(sc.id + ': differs from the recorded run'); } }
  else fs.writeFileSync(file, text);
});
console.log((check ? 'checked ' : 'recorded ') + scenarios.length + ' runs, ' + samples + ' poses, ' + Math.round(bytes / 1024) + ' KB, ' + grounds + ' ground replays' + (bad ? ', ' + bad + ' wrong' : ''));
process.exit(bad ? 1 : 0);
