// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
(function () {
  'use strict';
  var M = MotionCore, R = GaitRig, B = GaitBake(M, R), G = M.G;
  function $(id) { return document.getElementById(id); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  var PRESETS = {
    neutral: { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3, fps: 0 },
    heavy: { bounce: 1.5, stride: 0.84, arm: 0.6, lean: 1.5, step: 0.8, snap: 0.62, fps: 0 },
    sneak: { bounce: 0.25, stride: 0.78, arm: 0.35, lean: 1.7, step: 1.7, snap: 0.1, fps: 0, crouch: 0.5 },
    cartoon: { bounce: 2.2, stride: 1.2, arm: 1.9, lean: 0.6, step: 2.0, snap: 0.9, fps: 12 }
  };
  var LIMB_NAMES = ['Hand R', 'Hand L', 'Foot R', 'Foot L'];

  var boot = (window.claude && window.claude.hot && window.claude.hot.data) || {};
  var set = {
    ch: boot.ch || 'soldier', speed: boot.speed != null ? boot.speed : 1.4, crouch: boot.crouch || 0, terrain: boot.terrain || 'rough',
    ladder: false, armed: boot.armed !== false, view: boot.view || 'side', fps: boot.fps || 0, overlays: boot.overlays !== false,
    preset: boot.preset || 'neutral', style: boot.style || { bounce: 1, stride: 1, arm: 1, lean: 1, step: 1, snap: 0.3 },
    paused: false, slow: false, down: false, steer: 0, heading: null, dir: 0, kit: boot.kit === 'pistols' || boot.kit === 'sword' ? boot.kit : 'rifle'
  };
  if (!M.CHARACTERS[set.ch]) set.ch = 'soldier';
  if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
    window.claude.hot.snapshot(function () {
      return { ch: set.ch, speed: set.speed, crouch: set.crouch, terrain: set.terrain, armed: set.armed, kit: set.kit, view: set.view, fps: set.fps, overlays: set.overlays, preset: set.preset, style: set.style };
    });
  }

  // ------------------------------------------------------------- world
  var ch, env, S, yOff = 0, pose = null, footprints = [], trail = [], xf = null, held = null, keep = {};
  var cam = { y: 0, z: 0, look: 1, yaw: 0, pit: 0, fx: 0 }, aimScreen = null, firing = false, fireOnce = false, jumpOnce = false, dieOnce = null, hitOnce = null, reloadOnce = false, ladFrame = null, lastK = -1, simTick = 0;
  var rider = null, riderArmed = false;                          // a soldier on the back of the character on stage
  var IMG = { soldier: {}, mech: {}, quad: {}, hyena: {}, horse: {}, raptor: {}, scorpion: {}, octopus: {}, mantis: {}, wasp: {}, dragon: {}, spider: {} };      // image parts per character and slot
  // things in the world that the actions deal with, and the two-character fight
  var wall = null, baseTerrain = null, climbOnce = false, dropOnce = false, swingOnce = null, blockHeld = false, camView = 2, pounceOnce = null, stingOnce = null, inkOnce = false, swimDown = false, inks = [], grenades = [], sparks = [], crateObj = null, cratePending = null, wantPick = false, wantPut = false, throwOnce = null, guardOn = false, punchOnce = null;
  var FT = typeof GaitFight !== 'undefined' ? GaitFight : null, F = null, say = { text: '', t: 9 }, lastAim = null;
  var TEAM = [{ name: 'Orange', col: '#e2711d', pal: null }, { name: 'Blue', col: '#3d7cc0', pal: R.PAL.soldier2 }];
  function partsOf(id) { var o = IMG[id], k; for (k in o) return o; return null; }

  function makeTerrain(kind, L) {
    var base;
    if (kind === 'flat') base = function () { return 0; };
    else if (kind === 'rough') base = function (x) { return L * (0.10 * Math.sin(x / (1.9 * L)) + 0.05 * Math.sin(x / (0.73 * L) + 1.3)); };
    else base = function (x) { var k = ((Math.floor(x / (1.3 * L)) % 8) + 8) % 8; return L * 0.17 * [0, 1, 2, 3, 3, 2, 1, 0][k]; };
    return function (x) { return base(x) + yOff; };
  }

  function reset(keepSpeed) {
    ch = M.CHARACTERS[set.ch]; yOff = 0;
    wall = null; baseTerrain = makeTerrain(set.terrain, ch.L);
    env = { terrain: function (x, z) { return baseTerrain(x, z) + (wall && x > wall.x ? wall.h : 0); }, ladder: null };
    S = M.createState(ch, env); rider = null; riderArmed = false;
    footprints = []; trail = []; xf = null; held = null; lastK = -1; set.ladder = false; set.down = false; set.steer = 0; set.heading = null; set.dir = 0; ladFrame = null; keep = {};
    grenades = []; sparks = []; inks = []; swimDown = false; crateObj = null; cratePending = null; wantPick = false; wantPut = false; throwOnce = null; guardOn = false; punchOnce = null; F = null;
    cam.y = S.gRef.x; cam.z = 0; cam.look = 1;
    if (!keepSpeed) set.speed = B.walkSpeed(ch);
    set.speed = clamp(set.speed, 0, ch.vmax);
    pose = null; clearStrip();
    for (var i = 0; i < 360; i++) simStep(1 / 120);   // start mid-stride, not from a standstill
    syncUI(); syncSlots();
  }

  function aimWorld() {
    if (!aimScreen) return null;
    var P = projParams();
    var X = (aimScreen[0] - P.ox) / P.ppm, Yup = (P.oy - aimScreen[1]) / P.ppm;
    if (set.view !== 'side' && P.pit > 0.12) {
      // three-quarter view: the pointer picks a spot on a level plane at chest height, so it can be off to either side
      var yA = S.y + 0.3 * ch.L, D = clamp(((yA - P.cy) * Math.cos(P.pit) - Yup) / Math.sin(P.pit), -6 * ch.L, 6 * ch.L);
      return [P.cx + X * Math.cos(P.yaw) - D * Math.sin(P.yaw), yA, P.cz + X * Math.sin(P.yaw) + D * Math.cos(P.yaw)];
    }
    var dx = X / Math.cos(P.yaw), dy = (Yup - dx * Math.sin(P.yaw) * Math.sin(P.pit)) / Math.cos(P.pit);
    return [P.cx + dx, P.cy + dy, P.cz];          // side view: a point in the vertical plane through the body
  }

  // grenades in flight, the crate when nobody holds it, and short-lived marks (a pop, a landed punch)
  function worldStep(dt) {
    var i, g;
    for (i = grenades.length - 1; i >= 0; i--) {
      g = grenades[i]; g.t += dt;
      if (g.pop) { g.pop += dt; if (g.pop > 0.55) grenades.splice(i, 1); continue; }
      g.v[1] -= G * dt; g.p[0] += g.v[0] * dt; g.p[1] += g.v[1] * dt; g.p[2] += g.v[2] * dt;
      var gy = env.terrain(g.p[0]) + 0.036;
      if (g.p[1] < gy) {
        g.p[1] = gy;
        if (g.v[1] < -0.5) { g.v[1] *= -0.3; g.v[0] *= 0.5; g.v[2] *= 0.5; } else { g.v[1] = 0; g.v[0] *= Math.exp(-dt * 6); g.v[2] *= Math.exp(-dt * 6); }
      }
      if (g.t > 2.3) {
        // a harmless pop; anyone standing close is shoved away from it
        g.pop = 1e-6;
        var dx = S.px - g.p[0], dz = S.pz - g.p[2], d = Math.sqrt(dx * dx + dz * dz);
        if (!F && d < 2.4 && S.mode === 'ground') hitOnce = { impulse: [1.5 * dx / (d || 1), 0, 1.5 * dz / (d || 1)] };
      }
    }
    for (i = sparks.length - 1; i >= 0; i--) { sparks[i].t += dt; if (sparks[i].t > 0.22) sparks.splice(i, 1); }
    if (crateObj && crateObj.fall) {
      crateObj.vy -= G * dt; crateObj.pos[1] += crateObj.vy * dt;
      var cy = env.terrain(crateObj.pos[0]) + M.CRATE.h / 2;
      if (crateObj.pos[1] <= cy) { crateObj.pos[1] = cy; crateObj.fall = false; }
    }
    say.t += dt;
  }

  var TEXT = { jab: 'a jab', cross: 'a cross', hook: 'a hook' };
  function fightStep(dt) {
    var before = [F.fighters[0].S.pose, F.fighters[1].S.pose], mx = 0, mz = 0, my = 1e9;
    F.style = set.style;
    FT.step(F, dt);
    F.fighters.forEach(function (f, k) {
      f.events.forEach(function (e) {
        if (e.type === 'land') { e.who = k; footprints.push(e); if (footprints.length > 24) footprints.shift(); }
        if (e.type === 'getup') { f.xf = { from: before[k], t: 0, dur: 0.6 }; say.text = TEAM[k].name + ' gets up'; say.t = 0; }
      });
      f.events.length = 0;
      if (f.xf) { f.xf.t += dt / f.xf.dur; if (f.xf.t >= 1) f.xf = null; }
      mx += f.S.px / 2; mz += f.S.pz / 2; my = Math.min(my, f.S.mode === 'ground' ? f.S.gRef.x : env.terrain(f.S.px));
    });
    while (F.log.length) {
      var e = F.log.shift(), me = TEAM[e.by].name, op = TEAM[1 - e.by].name;
      if (e.type !== 'miss') sparks.push({ p: e.pos, t: 0, kind: e.type });
      if (e.type === 'hit') { say.text = me + ': ' + TEXT[e.kind] + ' to the ' + e.where; say.t = 0; }
      else if (e.type === 'block') { say.text = op + ' blocks ' + TEXT[e.kind]; say.t = 0; }
      else if (e.type === 'down') { say.text = op + ' is down'; say.t = -1.2; }
    }
    pose = F.fighters[0].S.pose;
    var ck = 1 - Math.exp(-dt * 4);
    cam.y += (my - cam.y) * ck; cam.z += (mz - cam.z) * ck; cam.fx += (mx - cam.fx) * ck;
    worldStep(dt);
  }

  function simStep(dt) {
    if (F) { fightStep(dt); return; }
    var busy = wantPick || wantPut;
    var inp = { speed: busy ? 0 : set.speed, crouch: set.crouch, aim: aimWorld(), fire: firing || fireOnce, armed: set.armed, kit: set.kit, reload: reloadOnce, jump: jumpOnce, die: dieOnce, hit: hitOnce,
      steer: set.steer, heading: set.steer ? null : set.heading, dir: set.dir * Math.PI / 180, climb: climbOnce || (S.mode === 'ledge' && jumpOnce), drop: dropOnce, guard: guardOn, punch: punchOnce, throw: throwOnce,
      swing: swingOnce || (S.kit === 'sword' && (firing || fireOnce) ? { kind: 'slash' } : null), block: S.kit === 'sword' && blockHeld,
      bite: ch.beast && (firing || fireOnce) && !(rider && riderArmed) ? { target: aimWorld() } : null, pounce: pounceOnce,
      pinch: ch.arthro && ch.arthro.claw && (firing || fireOnce) ? { target: aimWorld() } : null,
      sting: stingOnce || (ch.arthro && !ch.arthro.claw && (firing || fireOnce) ? { target: aimWorld() } : null),
      grab: ch.octo && (firing || fireOnce) ? { target: aimWorld() } : null, ink: inkOnce, depth: swimDown ? 0.3 : 0.4 + 1.6 * (1 - set.crouch),
      height: ch.fly ? (swimDown ? ch.fly.low : ch.fly.low + (1 - set.crouch) * (1.6 * ch.fly.height - ch.fly.low)) : undefined };
    var quiet = S.mode === 'ground' && S.standing && !S.act && !S.jump;
    if (wantPick && quiet && !S.carry && crateObj && !crateObj.fall) inp.pickup = { at: crateObj.pos, heading: crateObj.heading };
    if (wantPut && quiet && S.carry) inp.putdown = true;
    pose = M.step(S, ch, inp, set.style, env, dt);
    if (rider) {
      // the rider is stepped after its mount, with the mount handed to it
      var rin = { aim: aimWorld(), armed: riderArmed, fire: riderArmed && (firing || fireOnce), kit: 'rifle', die: inp.die, hit: inp.hit };
      M.step(rider.S, rider.ch, rin, set.style, { terrain: env.terrain, mount: { S: S, ch: ch } }, dt);
      rider.S.events.length = 0;
    }
    fireOnce = false; jumpOnce = false; dieOnce = null; hitOnce = null; reloadOnce = false; throwOnce = null; punchOnce = null; pounceOnce = null; stingOnce = null; inkOnce = false; swingOnce = null; climbOnce = false; dropOnce = false;
    // a wall ahead: on reaching it the soldier takes hold of the top and hangs; Space (or the button again) climbs up
    if (wall && !wall.done && S.mode === 'ground' && S.px > wall.x - 0.40 && S.px < wall.x) { xf = { from: pose, t: 0, dur: 0.3 }; M.grabLedge(S, ch, env, [wall.x, baseTerrain(wall.x) + wall.h, S.pz]); wall.done = true; set.speed = 0; syncUI(); }
    if (wall && wall.done && S.mode === 'ground' && S.px > wall.x + 4) { wall = null; syncUI(); }
    for (var i = 0; i < S.events.length; i++) {
      var e = S.events[i];
      if (e.type === 'land') { footprints.push(e); if (footprints.length > 18) footprints.shift(); }
      else if (e.type === 'ink') { for (var ik = 0; ik < 7; ik++) inks.push({ p: [e.pos[0] + 0.1 * Math.sin(ik * 2.4), e.pos[1] + 0.08 * Math.cos(ik * 1.7), e.pos[2] + 0.1 * Math.cos(ik * 2.9)], v: [e.dir[0] * (0.5 + 0.12 * ik), 0.1 * Math.sin(ik * 1.3), e.dir[2] * (0.5 + 0.12 * ik)], t: 0, r: 0.12 + 0.03 * (ik % 3) }); }
      else if (e.type === 'throw') grenades.push({ p: e.pos.slice(), v: e.vel.slice(), t: 0, pop: 0 });
      else if (e.type === 'putdown') cratePending = { pos: e.pos.slice(), heading: e.heading, vy: 0, fall: false };
      else if (e.type === 'drop') { crateObj = { pos: e.pos.slice(), heading: e.heading, vy: 0, fall: true }; cratePending = null; }
    }
    S.events.length = 0;
    // an octopus asked to crawl again first sinks to the bottom, then puts its arms down
    if (swimDown && S.mode === 'fly' && S.y - env.terrain(S.px) < ch.fly.low * 1.12) { xf = { from: pose, t: 0, dur: 0.5 }; M.leaveFly(S, ch, env); swimDown = false; set.speed = Math.min(set.speed, B.walkSpeed(ch)); syncUI(); }
    if (swimDown && S.mode === 'swim' && S.y - env.terrain(S.px) < 0.42) { xf = { from: pose, t: 0, dur: 0.5 }; M.leaveSwim(S, ch, env); swimDown = false; syncUI(); }
    for (var iq = inks.length - 1; iq >= 0; iq--) { var nk = inks[iq]; nk.t += dt; nk.p[0] += nk.v[0] * dt; nk.p[1] += nk.v[1] * dt; nk.p[2] += nk.v[2] * dt; nk.v[0] *= Math.exp(-dt * 1.8); nk.v[2] *= Math.exp(-dt * 1.8); if (nk.t > 3) inks.splice(iq, 1); }
    // the core draws the crate from the moment it is reached for until the hands are off it again
    if (S.carry) { if (crateObj && !crateObj.fall) crateObj = null; wantPick = false; }
    else if (cratePending) { crateObj = cratePending; cratePending = null; }
    if (wantPut && (!S.carry || (S.act && S.act.name === 'putdown'))) wantPut = false;
    if ((wantPick || wantPut) && S.mode !== 'ground') { wantPick = false; wantPut = false; }
    worldStep(dt);
    if ((simTick++ & 1) === 0) { trail.push([S.px, S.y, S.pz]); if (trail.length > 170) trail.shift(); }
    if (xf) { xf.t += dt / xf.dur; if (xf.t >= 1) xf = null; }
    var target = S.mode === 'ladder' || S.mode === 'ledge' ? S.y - ch.rootHeight : S.mode === 'ragdoll' ? env.terrain(S.px) : S.gRef.x, ck = 1 - Math.exp(-dt * 5);
    cam.y += (target - cam.y) * ck; cam.z += (S.pz - cam.z) * ck; cam.look += (Math.cos(S.h) - cam.look) * (1 - Math.exp(-dt * 2.5));
    var k = Math.floor(S.phase * 8) % 8;
    if (k !== lastK && S.stats.v > 0.02) { lastK = k; bake(k); }
  }

  // Knock down: the motion core hands the body to its ragdoll. The push comes from the pointer's side.
  function knockDown() {
    var imp = null, aim = aimWorld();
    if (aim) {
      var dx = S.px - aim[0], dy = (S.y + 0.3 * ch.L) - aim[1], dz = S.pz - aim[2], l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      imp = [2.6 * dx / l, Math.max(0.4, 2.6 * dy / l + 0.6), 2.6 * dz / l];
    }
    dieOnce = { impulse: imp }; set.down = true; set.steer = 0; footprints = []; held = null; syncUI();
  }
  // A lighter blow: the body staggers, takes a step or two and recovers.
  function hitOnceNow() {
    var aim = aimWorld(), hx = -Math.cos(S.h), hz = -Math.sin(S.h);          // no pointer: from straight ahead
    if (aim) { hx = S.px - aim[0]; hz = S.pz - aim[2]; var hl = Math.sqrt(hx * hx + hz * hz) || 1; hx /= hl; hz /= hl; }
    hitOnce = { impulse: [1.6 * hx, 0, 1.6 * hz] };
  }
  function getUp() {
    xf = { from: pose, t: 0, dur: 0.6 };
    env.ladder = null; ladFrame = null; set.ladder = false; set.down = false; set.heading = null;
    M.stand(S, ch, env); footprints = []; trail = []; held = null;
    if (rider) { M.stand(rider.S, rider.ch, env); M.step(S, ch, { speed: 0 }, set.style, env, 1 / 120); S.events.length = 0; M.mountUp(rider.S, rider.ch, env, { S: S, ch: ch }); rider.S.events.length = 0; }
    syncUI();
  }

  // a beast leaps at the ground under the place pointed at, if that is ahead of it; otherwise a standard leap
  function pounceNow() {
    if (!ch.beast || set.ladder || set.down || F) return;
    var am = aimWorld() || (lastAim && performance.now() - lastAim.t < 8000 ? lastAim.p : null), tg = null;
    if (am) { var ax = am[0] - S.px, az = (am.length > 2 ? am[2] : S.pz) - S.pz; if (ax * Math.cos(S.h) + az * Math.sin(S.h) > 0.8) tg = [am[0], env.terrain(am[0]), S.pz + az]; }
    pounceOnce = { target: tg };
  }
  // the tail strikes at the place pointed at (it reaches about a metre in front), or straight ahead
  function stingNow() {
    if (!ch.arthro || set.down || F) return;
    var am = aimWorld() || (lastAim && performance.now() - lastAim.t < 8000 ? lastAim.p : null);
    stingOnce = { target: am ? [am[0], am[1], am.length > 2 ? am[2] : S.pz] : null };
  }
  function swimNow() {
    if (ch.fly && !set.down && !F) {
      // take off, or come down: it descends first and puts its feet down when it is low enough
      if (S.mode === 'fly') swimDown = !swimDown;
      else { xf = { from: pose, t: 0, dur: 0.5 }; M.enterFly(S, ch, env); swimDown = false; footprints = []; set.speed = 0.55 * ch.fly.vmax; }
      syncUI(); return;
    }
    if (!ch.octo || set.down || F) return;
    if (S.mode === 'swim') swimDown = !swimDown;
    else { xf = { from: pose, t: 0, dur: 0.4 }; M.enterSwim(S, ch, env); swimDown = false; footprints = []; if (set.speed < 0.3) set.speed = 1.2; }
    syncUI();
  }
  // ---- hands and fists
  function freeHands() { return ch.kind === 'biped' && !F && !set.ladder && !set.down; }
  function throwNow() {
    if (!freeHands() || S.carry || guardOn) return;
    // to the ground under the pointer, if that is somewhere ahead; otherwise a standard lob
    var am = aimWorld() || (lastAim && performance.now() - lastAim.t < 8000 ? lastAim.p : null), tg = null;
    if (am) {
      var ax = am[0] - S.px, az = (am.length > 2 ? am[2] : S.pz) - S.pz, ahead = ax * Math.cos(S.h) + az * Math.sin(S.h);
      if (ahead > 1.2) tg = [am[0], env.terrain(am[0]), S.pz + az];
    }
    throwOnce = { target: tg };
  }
  function crateNow() {
    if (!freeHands() || S.act || guardOn) return;
    if (S.carry) { wantPut = true; set.speed = 0; syncUI(); return; }      // it is set down, and the walk does not carry on through it
    // a crate is set on the ground where the character will have come to a stop
    var stop = S.v * S.v / (2 * 0.65 * G), lx = S.x + stop + 0.20 + M.CRATE.d / 2, w = M.l2w(M.frameOf(S), [lx, 0, 0]);
    crateObj = { pos: [w[0], env.terrain(w[0]) + M.CRATE.h / 2, w[2]], heading: S.h, vy: 0, fall: false };
    wantPick = true; set.steer = 0; set.heading = S.h;
  }
  function guardNow(on) { if (!freeHands() || S.carry) return; guardOn = on; if (on) { wantPick = false; } syncUI(); }
  function punchNow(kind) {
    // with sword and shield the same three keys are the three swings
    if (freeHands() && S.kit === 'sword' && set.armed && !guardOn) { swingOnce = { kind: kind === 'jab' ? 'slash' : kind === 'cross' ? 'chop' : 'thrust' }; return; }
    if (!freeHands() || !guardOn) return; var am = aimWorld(); punchOnce = { kind: kind, target: am ? [am[0], am[1], am.length > 2 ? am[2] : S.pz] : null }; }
  function fightNow(on) {
    if (!FT) return;
    if (!on) { reset(true); return; }
    if (set.ch !== 'soldier') { set.ch = 'soldier'; }
    reset(true);
    F = FT.create({ M: M, chars: [ch, ch], env: env, style: set.style, seed: ((Date.now() / 7) & 0xffff) + 1, at: [S.px + 0.85, S.pz], temper: [0.5, 0.65] });
    S = F.fighters[0].S; cam.fx = S.px + 0.85; cam.z = S.pz; footprints = []; trail = []; say.text = ''; say.t = 9;
    for (var i = 0; i < 40; i++) fightStep(1 / 120);
    clearStrip(); syncUI();
  }

  // put a wall 2.3 m high a few steps ahead (the soldier faces along the track to meet it), or, when hanging from it, climb up
  function rideNow() {
    if (!ch.saddle || F || set.down) return;
    if (rider) { rider = null; riderArmed = false; syncUI(); return; }
    var rc = M.CHARACTERS.soldier, rs = M.createState(rc, env);
    if (!S.local) return;
    if (M.mountUp(rs, rc, env, { S: S, ch: ch })) { rs.events.length = 0; rider = { S: rs, ch: rc }; }
    syncUI();
  }
  function ledgeNow() {
    if (ch.kind !== 'biped' || set.down || set.ladder || F) return;
    if (S.mode === 'ledge') { climbOnce = true; return; }
    if (wall) return;
    set.heading = 0; set.steer = 0; set.dir = 0; guardOn = false;
    wall = { x: S.px + 2.6 + S.v * 0.6, h: 2.3, done: false }; if (set.speed < 0.3) set.speed = B.walkSpeed(ch); set.speed = Math.min(set.speed, 2.2); syncUI();
  }
  function toggleLadder(on) {
    if (ch.kind !== 'biped' || set.down) return;
    xf = { from: pose, t: 0, dur: 0.35 };
    if (on) {
      // the ladder stands 0.36 m ahead of the body, square to the way it faces
      var lx = S.x + 0.36, y0 = env.terrain(M.l2w(M.frameOf(S), [lx, 0, 0])[0]);
      env.ladder = { x: lx, y0: y0, spacing: 0.3, rung: function (k) { return y0 + k * 0.3 + 0.04 * Math.sin(k * 2.4); } };
      M.enterLadder(S, ch, env); ladFrame = S.ladFrame; set.steer = 0; set.heading = null;
    } else {
      // step off at the top: the ground is now wherever the climber got to
      yOff += (S.y - ch.rootHeight) - env.terrain(S.px);
      env.ladder = null; ladFrame = null;
      M.leaveLadder(S, ch, env);
    }
    set.ladder = on; footprints = []; trail = []; held = null;
    syncUI();
  }

  // --------------------------------------------------------- projection
  var stage = $('stage'), ctx = stage.getContext('2d'), W = 800, H = 400, dpr = 1;
  function projParams() {
    var vh = ch.viewH * (S.mode === 'fly' ? ch.fly.view : 1); camView += (vh - camView) * 0.06; if (Math.abs(camView - vh) > 3 * ch.viewH) camView = vh;
    var ppm = Math.min(H * 0.70 / camView, W / (camView * 1.75));
    return { cx: F ? cam.fx : S.px + cam.look * (W * 0.09) / ppm, cy: cam.y, cz: cam.z, ppm: ppm, yaw: cam.yaw, pit: cam.pit, ox: W * 0.5, oy: H * 0.80 };
  }

  // ------------------------------------------------------------ drawing
  var TOK = {};
  function readTokens() {
    var cs = getComputedStyle(document.documentElement);
    ['stage', 'ink', 'muted', 'accent', 'trace', 'ground-top', 'ground-cut', 'outline', 'line'].forEach(function (k) { TOK[k] = cs.getPropertyValue('--' + k).trim(); });
    TOK.mono = cs.getPropertyValue('--mono').trim(); TOK.display = cs.getPropertyValue('--display').trim();
  }

  // A picture laid along its bone. See GaitRig.SLOTS for what each axis means.
  function drawPart(c, q, im, ppm, dark, flip) {
    var o = R.partPlace(im, q.pa, q.pe || q.pb, q.r * ppm, ppm, flip);
    c.imageSmoothingEnabled = !!im.box;          // pictures from a drawing are smoothed; small pixel pictures are not
    c.save(); c.translate(o.x, o.y); if (o.rot) c.rotate(o.rot); if (o.fx !== 1 || o.fy !== 1) c.scale(o.fx, o.fy);
    c.drawImage(dark ? im.dark : im.img, o.dx, o.dy, o.dw, o.dh); c.restore();
  }

  function drawPrims(c, proj, ppm, prims, dz, outlineW, outlineCol, keepOrder, imgs) {
    var sorted = R.order(prims, proj), i, q;
    c.lineCap = 'round';
    for (i = 0; i < sorted.length; i++) {
      q = sorted[i];
      var lvl = R.level(q, dz);
      if (imgs) {
        if (q.of && imgs[q.of]) continue;
        if (q.part && imgs[q.part]) { drawPart(c, q, imgs[q.part], ppm, lvl < 2, sorted.flip); continue; }
      }
      var col = R.shade(q.col, lvl).css, r = Math.max(q.r * ppm, 0.6);
      if (q.pb) {
        var bx = q.pb[0], by = q.pb[1];
        if (Math.abs(bx - q.pa[0]) + Math.abs(by - q.pa[1]) < 0.05) bx += 0.05;
        var ax = q.pa[0], ay = q.pa[1];
        c.lineCap = q.sq ? 'butt' : 'round';
        if (outlineW && !q.raw) {
          var ox = 0, oy = 0;
          if (q.sq) { var ol = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) || 1; ox = (bx - ax) / ol * outlineW; oy = (by - ay) / ol * outlineW; }   // a square end needs its outline carried past it
          c.strokeStyle = outlineCol; c.lineWidth = 2 * r + 2 * outlineW; c.beginPath(); c.moveTo(ax - ox, ay - oy); c.lineTo(bx + ox, by + oy); c.stroke();
        }
        c.strokeStyle = col; c.lineWidth = 2 * r; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
      } else {
        if (outlineW && !q.raw) { c.fillStyle = outlineCol; c.beginPath(); c.arc(q.pa[0], q.pa[1], r + outlineW, 0, 6.2832); c.fill(); }
        c.fillStyle = col; c.beginPath(); c.arc(q.pa[0], q.pa[1], r, 0, 6.2832); c.fill();
      }
    }
  }

  function addLadder(prims, yA, yB) {
    var tmp = [], fr = ladFrame || M.frameOf(S);
    R.ladderPrims(tmp, env.ladder, yA, yB);
    tmp.forEach(function (q) { q.a = M.l2w(fr, q.a); q.b = M.l2w(fr, q.b); prims.push(q); });
  }

  function drawGround(P, proj) {
    var half = W / P.ppm / Math.max(Math.cos(P.yaw), 0.5) * 0.5 + ch.viewH;
    var pad = (W * 0.09) / P.ppm, x0 = P.cx - half - pad, x1 = P.cx + half + pad, dx = ch.L * 0.035, zH = (ch.kind === 'hex' ? 2.0 : 1.5) * ch.L, zc = P.cz;
    var front = [], back = [], x;
    for (x = x0; x <= x1; x += dx) { var y = env.terrain(x); front.push(proj([x, y, zc + zH])); back.push(proj([x, y, zc - zH])); }
    var n = front.length, i;
    ctx.fillStyle = TOK['ground-cut'];
    ctx.beginPath(); ctx.moveTo(front[0][0], H + 2);
    for (i = 0; i < n; i++) ctx.lineTo(front[i][0], front[i][1]);
    ctx.lineTo(front[n - 1][0], H + 2); ctx.closePath(); ctx.fill();
    if (Math.abs(P.yaw) > 0.01) {
      ctx.fillStyle = TOK['ground-top'];
      ctx.beginPath(); ctx.moveTo(back[0][0], back[0][1]);
      for (i = 1; i < n; i++) ctx.lineTo(back[i][0], back[i][1]);
      for (i = n - 1; i >= 0; i--) ctx.lineTo(front[i][0], front[i][1]);
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = TOK.muted; ctx.lineWidth = 1.25; ctx.beginPath();
    for (i = 0; i < n; i++) { if (i) ctx.lineTo(front[i][0], front[i][1]); else ctx.moveTo(front[i][0], front[i][1]); }
    ctx.stroke();
    // a tape measure along the track: real metres
    var stepM = [1, 2, 5, 10, 20].filter(function (s) { return s * P.ppm >= 64; })[0] || 50;
    ctx.font = '10.5px ' + TOK.mono; ctx.fillStyle = TOK.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.globalAlpha = 0.75; ctx.lineWidth = 1;
    for (var m = Math.ceil(x0); m <= x1; m++) {
      var gy = env.terrain(m), a = proj([m, gy, zc + zH]), major = m % stepM === 0;
      if (Math.abs(P.yaw) > 0.01) { var b = proj([m, gy, zc - zH]); ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.globalAlpha = 0.75; }
      if (P.ppm >= 14 || major) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0], a[1] + (major ? 9 : 5)); ctx.stroke(); }
      if (major) ctx.fillText(m + ' m', a[0], a[1] + 12);
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    var P = projParams(), proj = R.projector(P), i;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = TOK.stage; ctx.fillRect(0, 0, W, H);
    // the gait, set as a headline behind the action
    ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = TOK.ink; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.font = '900 ' + Math.round(Math.min(H * 0.5, W * 0.24)) + 'px ' + TOK.display;
    var big = F ? 'Fight' : S.carry ? 'Carry' : S.guard.x > 0.5 ? 'Guard' : S.stats.gait === 'Standing' ? 'Idle' : S.stats.gait;
    ctx.fillText(big.toUpperCase(), W - 14, H * 0.66); ctx.restore();

    drawGround(P, proj);

    var shown = pose;
    if (xf) { var t = xf.t; shown = M.blendPose(xf.from, pose, t * t * (3 - 2 * t)); }
    if (set.fps > 0 && !F) {
      var fi = Math.floor(S.t * set.fps);
      if (!held || held.fi !== fi) held = { fi: fi, pose: shown, x0: S.px, y0: S.y, z0: S.pz };
      shown = R.shiftPose(held.pose, S.px - held.x0, S.mode === 'ladder' ? S.y - held.y0 : 0, S.pz - held.z0);
    } else held = null;

    if (set.overlays && S.mode === 'ground') {
      // footprints and the measured stride of the first leg
      var last = null, prev = null;
      for (i = 0; i < footprints.length; i++) {
        var fp = footprints[i], fc = Math.cos(fp.hd || 0) * ch.L, fs = Math.sin(fp.hd || 0) * ch.L;
        var a = proj([fp.x - 0.06 * fc, fp.y, fp.z - 0.06 * fs]), b = proj([fp.x + 0.1 * fc, fp.y, fp.z + 0.1 * fs]);
        ctx.strokeStyle = TOK.ink; ctx.globalAlpha = fp.side > 0 ? 0.85 : 0.35; ctx.lineWidth = 3.5; ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(a[0], a[1] + 2.5); ctx.lineTo(b[0], b[1] + 2.5); ctx.stroke();
        if (fp.leg === 0) { prev = last; last = fp; }
      }
      ctx.globalAlpha = 1;
      var pa = last && prev ? proj([prev.x, prev.y, prev.z]) : null, strideLen = pa ? Math.sqrt(Math.pow(last.x - prev.x, 2) + Math.pow(last.z - prev.z, 2)) : 0;
      if (!F && pa && pa[0] > 40 && pa[0] < W - 40 && strideLen > 0.1 * ch.L && Math.abs(proj([last.x, last.y, last.z])[0] - pa[0]) > 30) {
        var pb = proj([last.x, last.y, last.z]), yy = Math.max(pa[1], pb[1]) + 34;
        ctx.strokeStyle = TOK.accent; ctx.fillStyle = TOK.accent; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pa[0], pa[1] + 8); ctx.lineTo(pa[0], yy + 4); ctx.moveTo(pb[0], pb[1] + 8); ctx.lineTo(pb[0], yy + 4); ctx.moveTo(pa[0], yy); ctx.lineTo(pb[0], yy); ctx.stroke();
        ctx.font = '600 11px ' + TOK.mono; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(strideLen.toFixed(2) + ' m stride', (pa[0] + pb[0]) / 2, yy + 4);
      }
    }
    if (set.overlays && trail.length > 2 && !F) {
      ctx.strokeStyle = TOK.trace; ctx.lineWidth = 1.75; ctx.lineJoin = 'round';
      for (i = 1; i < trail.length; i++) {
        var q0 = proj(trail[i - 1]), q1 = proj(trail[i]);
        ctx.globalAlpha = 0.85 * i / trail.length; ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // who is on stage: one character, or the two fighters (the one further from the camera is drawn first)
    var actors = F ? F.fighters.map(function (f, k) { var t2 = f.xf ? f.xf.t : 1; return { pose: f.xf ? M.blendPose(f.xf.from, f.S.pose, t2 * t2 * (3 - 2 * t2)) : f.S.pose, team: k, f: f }; }) : [{ pose: shown, team: 0 }];
    var lists = actors.map(function (a) {
      var pr = R.buildPrims(a.pose, ch, TEAM[a.team].pal ? { pal: TEAM[a.team].pal } : undefined);
      if (!F && rider && rider.S.pose) { var dpt = proj(a.pose.root)[2]; pr = R.pair(pr, R.buildPrims(rider.S.pose, rider.ch)); pr.depth = dpt; return pr; }
      pr.depth = proj(a.pose.root)[2]; return pr;
    });
    if (!F) {
      if (env.ladder) addLadder(lists[0], Math.max(env.ladder.y0, P.cy - H / P.ppm), P.cy + H / P.ppm);
      if (crateObj) {
        var hc = Math.cos(crateObj.heading), hs = Math.sin(crateObj.heading);
        R.cratePrims(lists[0], { c: crateObj.pos, f: [hc, 0, hs], u: [0, 1, 0], side: [-hs, 0, hc], size: M.CRATE });
      }
    }
    lists.sort(function (m, n) { return m.depth - n.depth; }).forEach(function (pr) { drawPrims(ctx, proj, P.ppm, pr, R.SPRITE[ch.id].dz, 1.5, TOK.outline, keep, rider ? null : partsOf(ch.id)); });

    for (i = 0; i < inks.length; i++) {
      var nk2 = inks[i], np = proj(nk2.p); ctx.globalAlpha = 0.5 * (1 - nk2.t / 3); ctx.fillStyle = '#1d1a22';
      ctx.beginPath(); ctx.arc(np[0], np[1], (nk2.r + 0.16 * nk2.t) * P.ppm, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1;
    }
    // grenades and the marks they and the punches leave
    for (i = 0; i < grenades.length; i++) {
      var gr = grenades[i], gp = proj(gr.p);
      if (!gr.pop) {
        var grr = Math.max(2.2, 0.036 * P.ppm);
        ctx.fillStyle = TOK.outline; ctx.beginPath(); ctx.arc(gp[0], gp[1], grr + 1.5, 0, 6.2832); ctx.fill();
        ctx.fillStyle = '#6b7a45'; ctx.beginPath(); ctx.arc(gp[0], gp[1], grr, 0, 6.2832); ctx.fill();
      } else {
        var pk = gr.pop / 0.55, rr = (0.25 + 1.3 * Math.sqrt(pk)) * P.ppm, flat = P.pit > 0.05 ? Math.max(Math.sin(P.pit), 0.2) : 0.16;
        ctx.strokeStyle = TOK.accent; ctx.globalAlpha = 1 - pk; ctx.lineWidth = 2.5 * (1 - pk) + 0.5;
        ctx.beginPath(); ctx.ellipse(gp[0], gp[1], rr, rr * flat, 0, 0, 6.2832); ctx.stroke();
        ctx.fillStyle = TOK.muted; ctx.globalAlpha = 0.5 * (1 - pk);
        for (var pf = 0; pf < 5; pf++) { var pa2 = pf * 1.2566 + 0.4; ctx.beginPath(); ctx.arc(gp[0] + Math.cos(pa2) * rr * 0.45, gp[1] - (0.3 + 0.5 * pk) * P.ppm * (0.6 + 0.4 * Math.sin(pf * 2.1)), (0.1 + 0.16 * pk) * P.ppm, 0, 6.2832); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
    }
    for (i = 0; i < sparks.length; i++) {
      var sk = sparks[i], sp2 = proj(sk.p), st2 = sk.t / 0.22, sr = (sk.kind === 'block' ? 5 : 9) + 14 * st2;
      ctx.globalAlpha = 1 - st2; ctx.strokeStyle = sk.kind === 'block' ? TOK.muted : TOK.accent; ctx.lineWidth = sk.kind === 'block' ? 1.5 : 2.5; ctx.lineCap = 'round';
      ctx.beginPath();
      for (var sj = 0; sj < 7; sj++) { var sa = sj * 0.8976 + 0.3; ctx.moveTo(sp2[0] + Math.cos(sa) * sr * 0.45, sp2[1] + Math.sin(sa) * sr * 0.45); ctx.lineTo(sp2[0] + Math.cos(sa) * sr, sp2[1] + Math.sin(sa) * sr); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (F) {
      // health above each head, and what just happened
      actors.forEach(function (a) {
        var hp2 = proj([a.pose.head[0], a.pose.head[1] + 0.34, a.pose.head[2]]), bw = 46, frac = clamp(a.f.hp / F.health, 0, 1);
        if (a.f.S.mode !== 'ground') return;
        ctx.fillStyle = TOK.outline; ctx.fillRect(hp2[0] - bw / 2 - 1.5, hp2[1] - 4.5, bw + 3, 8);
        ctx.fillStyle = TOK.stage; ctx.fillRect(hp2[0] - bw / 2, hp2[1] - 3, bw, 5);
        ctx.fillStyle = TEAM[a.team].col; ctx.fillRect(hp2[0] - bw / 2, hp2[1] - 3, bw * frac, 5);
      });
      if (say.t < 1.4 && say.text) {
        ctx.globalAlpha = clamp((1.4 - say.t) / 0.3, 0, 1); ctx.fillStyle = TOK.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.font = '600 13px ' + TOK.mono; ctx.fillText(say.text, W / 2, 44); ctx.globalAlpha = 1;
      }
    }

    var am = set.view !== 'side' && set.overlays && !set.down && !F ? aimWorld() : null;
    if (am && am.length === 3 && P.pit > 0.12) {
      // where the aim point is over the ground: a mark on the ground and a line up to it
      var g0 = proj([am[0], env.terrain(am[0]), am[2]]), g1 = proj(am);
      ctx.strokeStyle = TOK.accent; ctx.lineWidth = 1; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(g0[0], g0[1], 9, 3.5, 0, 0, 6.2832); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (set.overlays && S.mode === 'ground') {
      ctx.strokeStyle = TOK.accent; ctx.lineWidth = 1.5;
      actors.forEach(function (a) {
        if (!a.pose.legs) return;
        for (var li = 0; li < a.pose.legs.length; li++) {
          var tg = a.pose.legs[li].target;
          if (tg) { var tp = proj(tg); ctx.beginPath(); ctx.arc(tp[0], tp[1], 5, 0, 6.2832); ctx.stroke(); }
        }
      });
    }
  }

  // ----------------------------------------------------- sprite baking
  var strip = $('strip'), sctx = strip.getContext('2d'), spr = $('sprite').getContext('2d');
  var off = document.createElement('canvas'), octx = off.getContext('2d', { willReadFrequently: true });
  function clearStrip() { sctx.clearRect(0, 0, 256, 112); spr.clearRect(0, 0, 64, 56); }
  // One frame as RGBA pixels. Shapes go through the hard-edged rasteriser that the exporter also uses;
  // image parts are drawn by the canvas and then cut to hard edges.
  function framePixels(p, prims, P, w, h) {
    var imgs = partsOf(ch.id), out = new Uint8ClampedArray(w * h * 4), i;
    if (!imgs) {
      var pal = B.newPalette(), idx = B.rasterize(prims, P, w, h, R.SPRITE[ch.id].dz, pal);
      for (i = 0; i < idx.length; i++) if (idx[i]) { var c = pal.list[idx[i] - 1]; out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255; }
      return out;
    }
    if (off.width !== w || off.height !== h) { off.width = w; off.height = h; }
    octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, w, h);
    drawPrims(octx, R.projector(P), P.ppm, prims, R.SPRITE[ch.id].dz, 0, null, null, imgs);
    var d = octx.getImageData(0, 0, w, h).data;
    for (i = 0; i < w * h; i++) if (d[i * 4 + 3] >= 120) { out[i * 4] = d[i * 4]; out[i * 4 + 1] = d[i * 4 + 1]; out[i * 4 + 2] = d[i * 4 + 2]; out[i * 4 + 3] = 255; }
    return out;
  }
  function bake(k) {
    if (!pose) return;
    var sp = R.SPRITE[ch.id], ref = S.mode === 'ladder' ? S.y - ch.rootHeight - 0.1 : S.gRef.x;
    var P = { cx: S.px + sp.cx * Math.cos(S.h), cy: ref, cz: S.pz, ppm: sp.ppm, yaw: 0, pit: 0, ox: 32, oy: 53 };
    var prims = R.buildPrims(pose, ch);
    if (env.ladder) addLadder(prims, S.y - 4, S.y + 4);
    var img = new ImageData(framePixels(pose, prims, P, 64, 56), 64, 56);
    sctx.putImageData(img, (k % 4) * 64, (k >> 2) * 56); spr.putImageData(img, 0, 0);
  }

  // ------------------------------------------------------ image parts
  // more (optional): { box, len, r } for a picture taken from a drawing (see GaitRig.partPlace)
  function storePart(id, slot, axis, source, w, h, label, more) {
    var a = document.createElement('canvas'); a.width = w; a.height = h; a.getContext('2d').drawImage(source, 0, 0, w, h);
    var d = document.createElement('canvas'); d.width = w; d.height = h; var dc = d.getContext('2d');
    dc.drawImage(a, 0, 0); dc.globalCompositeOperation = 'source-atop'; dc.fillStyle = 'rgba(0,0,0,0.32)'; dc.fillRect(0, 0, w, h);
    IMG[id][slot] = { img: a, dark: d, w: w, h: h, axis: axis, label: label };
    if (more) { IMG[id][slot].box = more.box; IMG[id][slot].len = more.len; IMG[id][slot].r = more.r; }
  }
  // A whole character drawn on its template (templates/2d, or "Save the template"): every layer that has something
  // in it becomes the picture of its part, cut out along the bone the guide layer gives for it.
  function loadDrawing(file) {
    var note = $('drawingNote'), id = ch.id, rd = new FileReader();
    function say(t) { note.textContent = t; }
    rd.onerror = function () { say('That file could not be read.'); };
    rd.onload = function () {
      var doc = new DOMParser().parseFromString(String(rd.result), 'image/svg+xml'), root = doc.documentElement;
      if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) { say('That is not an SVG file this browser can read. In Inkscape, save as Inkscape SVG or Plain SVG.'); return; }
      // nothing in the file may run
      [].slice.call(doc.querySelectorAll('script, foreignObject, iframe, object, embed')).forEach(function (n) { n.parentNode.removeChild(n); });
      [].slice.call(doc.querySelectorAll('*')).forEach(function (el) {
        [].slice.call(el.attributes).forEach(function (at) { if (/^on/i.test(at.name) || (/href$/i.test(at.name) && /^\s*javascript:/i.test(at.value))) el.removeAttribute(at.name); });
      });
      var guide = doc.querySelector('[id^="clio-guides-"]');
      if (!guide) { say('This drawing was not made on a template: its guide layer is missing. Save the template, draw in its layers, and load that file.'); return; }
      var who = guide.id.slice(12);
      if (who !== id) { say('This drawing is for the ' + (M.CHARACTERS[who] ? M.CHARACTERS[who].label.toLowerCase() : who) + '. Choose that character first, then load it.'); return; }
      // lay the file out, unseen, so that the browser can measure it
      var host = document.createElement('div'); host.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none';
      var live = document.importNode(root, true), NS = 'http://www.w3.org/2000/svg', jobs = [], empty = [], lost = [], linked = [];
      host.appendChild(live); document.body.appendChild(host);
      try {
        var inv = live.getCTM().inverse();
        var toRoot = function (el) { return inv.multiply(el.getCTM()); };          // from an element's own measure to the page's
        var at = function (m, x, y) { return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; };
        var bar = live.querySelector('#clio-scale'), barLen = live.querySelector('#clio-scale-length'), ppmT = 0;
        if (bar) {
          var bm = toRoot(bar), p1 = at(bm, bar.x1.baseVal.value, bar.y1.baseVal.value), p2 = at(bm, bar.x2.baseVal.value, bar.y2.baseVal.value);
          ppmT = Math.sqrt(Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2)) / (parseFloat(barLen ? barLen.textContent : '1') || 1);
        }
        if (!(ppmT > 0)) { say('The guide layer of this drawing has lost its scale bar. Start again from a fresh template and paste your layers in.'); return; }
        var ser = new XMLSerializer(), defs = [].slice.call(live.querySelectorAll('defs, style')).map(function (d) { return ser.serializeToString(d); }).join('');
        R.SLOTS[id].forEach(function (sl) {
          var layer = live.querySelector('#clio-part-' + sl[0]), joint = live.querySelector('#clio-joint-' + sl[0]), bone = live.querySelector('#clio-bone-' + sl[0]);
          if (!layer || !joint) { lost.push(sl[1]); return; }
          layer.style.display = ''; if (layer.getAttribute('display') === 'none') layer.removeAttribute('display');          // a layer hidden in Inkscape still counts
          if (!layer.querySelector('path, rect, circle, ellipse, line, polyline, polygon, image, text, use')) { empty.push(sl[1]); return; }
          // a picture that is only linked from another file cannot come along
          if ([].slice.call(layer.querySelectorAll('image')).some(function (n) { var h = n.getAttribute('href') || n.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || ''; return !/^data:/i.test(h.trim()); })) linked.push(sl[1]);
          var jm = toRoot(joint), a = at(jm, joint.cx.baseVal.value, joint.cy.baseVal.value), rT = joint.r.baseVal.value * Math.sqrt(Math.abs(jm.a * jm.d - jm.b * jm.c)), b = null;
          if (bone && sl[2] !== 'ball') { var bm2 = toRoot(bone); b = at(bm2, bone.x2.baseVal.value, bone.y2.baseVal.value); }
          var fr = R.partFrame(sl[2], a, b), pm = toRoot(layer.parentNode);
          var tf = 'rotate(' + (fr.rot * 180 / Math.PI) + ') translate(' + (-fr.x) + ' ' + (-fr.y) + ') matrix(' + [pm.a, pm.b, pm.c, pm.d, pm.e, pm.f].join(' ') + ')';
          // its box in the bone's frame
          var outer = document.createElementNS(NS, 'g'), inner = document.createElementNS(NS, 'g');
          inner.setAttribute('transform', tf); inner.appendChild(layer.cloneNode(true)); outer.appendChild(inner); live.appendChild(outer);
          var bb = outer.getBBox(); live.removeChild(outer);
          if (!(bb.width > 0.5) || !(bb.height > 0.5)) { empty.push(sl[1]); return; }
          var pad = 3 + 0.06 * Math.max(bb.width, bb.height), x0 = bb.x - pad, y0 = bb.y - pad, w = bb.width + 2 * pad, h = bb.height + 2 * pad;        // room for the width of the strokes
          var k = Math.min(3, 640 / Math.max(w, h)), W2 = Math.max(2, Math.round(w * k)), H2 = Math.max(2, Math.round(h * k));
          var xml = '<svg xmlns="' + NS + '" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W2 + '" height="' + H2 + '" viewBox="' + [x0, y0, w, h].join(' ') + '">' + defs
            + '<g transform="' + tf + '">' + ser.serializeToString(layer) + '</g></svg>';
          jobs.push({ sl: sl, xml: xml, w: W2, h: H2, more: { box: [x0 / ppmT, y0 / ppmT, (x0 + w) / ppmT, (y0 + h) / ppmT], r: rT / ppmT,
            len: b ? Math.sqrt(Math.pow(b[0] - a[0], 2) + Math.pow(b[1] - a[1], 2)) / ppmT : 0 } });
        });
      } catch (e) { say('This drawing could not be measured (' + (e && e.message ? e.message : e) + ').'); return; }
      finally { document.body.removeChild(host); }
      if (!jobs.length) { say('The part layers of this drawing are all empty. Draw each part in the layer that has its name.'); return; }
      var left = jobs.length, done = [], failed = [];
      jobs.forEach(function (j) {
        var im = new Image(), url = null;
        im.onload = function () { storePart(id, j.sl[0], j.sl[2], im, j.w, j.h, file.name, j.more); if (url) URL.revokeObjectURL(url); done.push(j.sl[1]); fin(); };
        im.onerror = function () {
          // where pictures may not be given as data, hand the same thing over as a file in memory
          if (!url) { try { url = URL.createObjectURL(new Blob([j.xml], { type: 'image/svg+xml' })); im.src = url; return; } catch (e) { url = 'none'; } }
          else if (url !== 'none') URL.revokeObjectURL(url);
          failed.push(j.sl[1]); fin();
        };
        im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(j.xml);
      });
      function fin() {
        if (--left) return;
        clearStrip(); if (ch.id === id) syncSlots();
        say((done.length ? 'Loaded ' + done.length + ' part' + (done.length > 1 ? 's' : '') + ' from ' + file.name + ': ' + done.join(', ') + '.' : 'No part could be drawn from ' + file.name + '.')
          + (failed.length ? ' Could not be drawn: ' + failed.join(', ') + '.' : '')
          + (linked.length ? ' Pictures linked from other files were left out of ' + linked.join(', ') + ': embed them in the drawing (in Inkscape: Extensions > Images > Embed Images).' : '')
          + (empty.length ? ' Left as shapes (empty layers): ' + empty.join(', ') + '.' : '') + (lost.length ? ' Missing from the file: ' + lost.join(', ') + '.' : ''));
      }
    };
    rd.readAsText(file);
  }
  function loadPart(slot, axis, file) {
    var id = ch.id, url = URL.createObjectURL(file), im = new Image();
    im.onload = function () {
      var k = Math.min(1, 512 / Math.max(im.naturalWidth, im.naturalHeight));
      storePart(id, slot, axis, im, Math.max(1, Math.round(im.naturalWidth * k)), Math.max(1, Math.round(im.naturalHeight * k)), file.name);
      URL.revokeObjectURL(url); clearStrip(); syncSlots();
    };
    im.onerror = function () { URL.revokeObjectURL(url); $('slots').dataset.error = slot; syncSlots('That file is not an image this browser can read. Try a PNG.'); };
    im.src = url;
  }
  // Stand-in pictures, drawn here so the feature can be tried without any files:
  // a small armour plate per part, sized from the rig's own proportions.
  function sampleParts() {
    var id = ch.id, prims = R.buildPrims(pose, ch, { flash: false }), seen = {};
    R.SLOTS[id].forEach(function (sl) {
      var q = prims.filter(function (p) { return p.part === sl[0]; })[0];
      if (!q || seen[sl[0]]) return; seen[sl[0]] = 1;
      var e = q.end || q.b, len = e ? Math.sqrt(Math.pow(e[0] - q.a[0], 2) + Math.pow(e[1] - q.a[1], 2) + Math.pow(e[2] - q.a[2], 2)) : 0;
      var long = len + 2 * q.r, wide = 2 * q.r * (sl[3] || 1.15), axis = sl[2], ball = axis === 'ball' || !e;
      var L = ball ? 28 : Math.max(14, Math.min(120, Math.round(long / wide * 14))), Wd = ball ? 28 : Math.max(5, Math.round(L * wide / long));
      var c = document.createElement('canvas'), horiz = axis === 'right'; c.width = horiz ? L : Wd; c.height = horiz ? Wd : L;
      var x = c.getContext('2d'), w = c.width, h = c.height, base = R.shade(q.col, -1).rgb;
      function rgb(f) { return 'rgb(' + base.map(function (v) { return Math.max(0, Math.min(255, Math.round(v * f))); }).join(',') + ')'; }
      function plate(inset, fill) {
        var rr = Math.min(w, h) / 2 - inset; x.fillStyle = fill; x.beginPath();
        if (x.roundRect) x.roundRect(inset, inset, w - 2 * inset, h - 2 * inset, Math.max(rr, 1)); else x.rect(inset, inset, w - 2 * inset, h - 2 * inset);
        x.fill();
      }
      plate(0, '#16181d'); plate(1.2, rgb(0.78)); plate(2.6, rgb(1.08));
      x.fillStyle = rgb(1.32);
      if (horiz) x.fillRect(4, 3, w - 8, 2); else x.fillRect(w - 6, 4, 2, h - 8);                 // a highlight along one edge
      x.fillStyle = '#16181d';
      if (ball) { x.fillRect(w * 0.45, h * 0.36, w * 0.5, h * 0.2); x.fillStyle = '#ffd23f'; x.fillRect(w * 0.72, h * 0.4, 4, 3); }
      else if (horiz) { for (var i = 1; i < 4; i++) x.fillRect(Math.round(w * i / 4), 3, 1, h - 6); }
      else { for (var j = 1; j < 3; j++) x.fillRect(3, Math.round(h * j / 3), w - 6, 1); x.fillRect(w / 2 - 1, 4, 2, 2); x.fillRect(w / 2 - 1, h - 6, 2, 2); }
      storePart(id, sl[0], axis, c, w, h, 'sample');
    });
    clearStrip(); syncSlots();
  }
  function syncSlots(msg) {
    var box = $('slots'), parts = IMG[ch.id];
    box.textContent = '';
    R.SLOTS[ch.id].forEach(function (sl) {
      var row = document.createElement('div'); row.className = 'slot';
      var name = document.createElement('span'); name.textContent = sl[1];
      var st = document.createElement('span'); st.className = 'state'; st.textContent = parts[sl[0]] ? parts[sl[0]].label : 'shape';
      name.appendChild(document.createTextNode(' ')); name.appendChild(st);
      var pick = document.createElement('label'); pick.className = 'btn pick'; pick.textContent = 'Choose image';
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.id = 'part-' + sl[0]; inp.setAttribute('aria-label', 'Image for ' + sl[1]);
      inp.addEventListener('change', function () { if (inp.files && inp.files[0]) loadPart(sl[0], sl[2], inp.files[0]); });
      pick.appendChild(inp);
      var clr = document.createElement('button'); clr.className = 'btn'; clr.textContent = 'Remove'; clr.disabled = !parts[sl[0]];
      clr.setAttribute('aria-label', 'Remove image for ' + sl[1]);
      clr.addEventListener('click', function () { delete IMG[ch.id][sl[0]]; clearStrip(); syncSlots(); });
      row.appendChild(name); row.appendChild(pick); row.appendChild(clr); box.appendChild(row);
    });
    if (msg) { var p = document.createElement('p'); p.className = 'note'; p.setAttribute('role', 'alert'); p.textContent = msg; box.appendChild(p); }
  }

  // ------------------------------------------------------------ export
  var downloads = null;
  function deflate(raw) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(B.zlibStored(raw));
    try {
      var cs = new CompressionStream('deflate'), wr = cs.writable.getWriter();
      wr.write(raw); wr.close();
      return new Response(cs.readable).arrayBuffer().then(function (b) { return new Uint8Array(b); }).catch(function () { return B.zlibStored(raw); });
    } catch (e) { return Promise.resolve(B.zlibStored(raw)); }
  }
  function readme(id, clips, withImages) {
    return ['Gait Bench export: ' + id, '',
      id + '_sheet.png   sprite sheet, 64 x 64 pixel frames, one clip per row (long clips wrap)',
      id + '_sheet.json  atlas in the JSON-hash form (TexturePacker / Aseprite style): frames, animations, meta.frameTags',
      id + '.glb         glTF 2.0, a skinned skeleton (one mesh, a joint hierarchy), one animation per clip',
      id + '_parts.glb   the same clips with every part as its own rigid node (no skin)',
      id + '_clio.json   an entry for CLIo sprites.json: palette letters, with walk and attack drawings (front view)', '',
      'Clips: ' + clips.map(function (c) { return c.name + ' (' + c.frames.length + ' frames, ' + (c.loop ? 'loops' : 'plays once') + ')'; }).join(', '),
      'All clips are in place. meta.clips in the atlas gives each clip\'s length in seconds and its ground speed in metres per second.',
      'The style sliders set on the bench at export time are baked in.',
      withImages ? 'The sheet uses your image parts. The glTF and CLIo files use the plain shapes.' : '',
      '', 'Unity: drop the .glb in with a glTF importer (glTFast); slice the sheet by 64 x 64 or import the atlas.',
      'Godot: the .glb imports directly; for 2D use the sheet with an AnimatedSprite2D or an Aseprite-JSON importer.',
      'Unreal: import the .glb through Interchange as a skeletal mesh with its animations.',
      'The die clip is a recorded ragdoll fall. It plays once and ends lying still.',
      'hit is a stagger from a blow from the front; turn is a half turn on the spot and ends facing the other way.',
      'With sword and shield (--kit sword on the command line), attack is a slash, chop and thrust are the other two swings, and block brings the shield up.',
      'back, left and right are walking backwards and stepping sideways while facing forwards; each clip is in place, with its speed in the atlas.',
      'hang is hanging from a ledge and climbup the climb onto it; both are in place, and the atlas gives how far climbup moves the body (metres forwards, metresUp).',
      'reload starts with empty magazines and reloads every weapon of the kit in turn.',
      'throw is an overarm grenade throw; the grenade leaves the hand about two thirds of the way through.',
      'pickup, carry and putdown go together: a crate 0.44 x 0.36 x 0.50 m, lifted from the ground, walked with, set down.',
      'In the sprite sheet the crate is drawn. In the glTF files it is not: attach your own box to the joint named Carry.',
      'guard is the fighting stance; jab, cross and hook start and end in it (recorded at 24 frames a second).',
      'For the octopus, walk is a crawl on the bottom, attack is an arm shot out to grab, swim is one jet cycle and hover hangs in the water.',
      'fly is one wingbeat at cruising speed, in place (its speed is in the atlas); hover, for those that can, is one beat hanging in the air.',
      'For the scorpion, attack is a pinch with one claw and sting is the tail strike.',
      'For an animal, attack is a bite and pounce is a leap; meta.clips gives the distance the pounce covers (metres).',
      'CLIo: python clio.py GAME --import-model ' + id + '.glb, or paste the entry from ' + id + '_clio.json into sprites.json.', ''].join('\n');
  }
  function doExport() {
    var btn = $('export'), note = $('exportNote'), id = ch.id, imgs = partsOf(id), enc = new TextEncoder();
    var kit = ch.mount.type === 'held' && set.kit !== ch.mount.kit ? set.kit : null, nm = kit ? id + '_' + kit : id;
    btn.disabled = true; note.textContent = 'Baking clips.';
    setTimeout(function () {
      var clips = B.recordAll(ch, { style: set.style, frames: 8, kit: kit });
      var sh = B.sheet(ch, clips, imgs ? { render: function (p, c, fw, fh) { return framePixels(p, B.framePrims(ch, c, p), B.spriteView(ch, fw, fh, p, c.ladder), fw, fh); }, image: nm + '_sheet.png' } : { image: nm + '_sheet.png' });
      var glb = B.glbSkinned(ch, clips), parts = B.glb(ch, clips), cl = B.clio(ch, clips, { name: nm });
      deflate(B.pngScanlines(sh.rgba, sh.w, sh.h)).then(function (z) {
        var zip = B.zip([
          { name: nm + '_sheet.png', data: B.png(sh.w, sh.h, z) },
          { name: nm + '_sheet.json', data: enc.encode(JSON.stringify(sh.atlas, null, 1)) },
          { name: nm + '.glb', data: glb },
          { name: nm + '_parts.glb', data: parts },
          { name: nm + '_clio.json', data: enc.encode(JSON.stringify(cl, null, 1)) },
          { name: 'README.txt', data: enc.encode(readme(nm, clips, !!imgs)) }
        ]);
        return downloads.save({ filename: nm + '_gaitbench.zip', data: new Blob([zip]) });
      }).then(function () { note.textContent = 'Saved ' + clips.length + ' clips for the ' + ch.label.toLowerCase() + '.'; })
        .catch(function (e) {
          var code = e && e.code;
          note.textContent = code === 'declined' ? 'Nothing was saved.' : code === 'rate_limited' ? 'A save is already waiting for your answer. Try again in a moment.'
            : 'The file could not be saved here' + (code ? ' (' + code + ')' : '') + '. The command-line baker writes the same files.';
        }).then(function () { btn.disabled = false; });
    }, 30);
  }
  function exportReady(d) {
    downloads = d || null;
    $('export').hidden = !downloads; $('saveDrawing').hidden = !downloads; $('modelRow').hidden = !downloads; $('modelNote').hidden = !downloads;
    $('exportNote').textContent = downloads ? 'Bakes every clip, from idle to the ragdoll death, with the current style settings.'
      : 'Saving files is not available in this view. The command-line baker writes the same files.';
  }
  if (window.claude && typeof window.claude.use === 'function') window.claude.use('downloads').then(exportReady, function () { exportReady(null); });
  else exportReady({ save: function (o) {                    // an ordinary web page: the browser's own download
    return new Promise(function (res) {
      var u = URL.createObjectURL(o.data), l = document.createElement('a');
      l.href = u; l.download = o.filename; document.body.appendChild(l); l.click(); l.remove();
      setTimeout(function () { URL.revokeObjectURL(u); res(); }, 500);
    });
  } });
  $('export').addEventListener('click', function () { if (downloads) doExport(); });

  // -------------------------------------------------- footfall diagram
  var ff = $('footfall'), fctx = ff.getContext('2d');
  function drawFootfall() {
    var w = ff.clientWidth, h = ff.clientHeight;
    if (ff.width !== Math.round(w * dpr)) { ff.width = Math.round(w * dpr); ff.height = Math.round(h * dpr); }
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0); fctx.clearRect(0, 0, w, h);
    var st = S.stats, ladder = S.mode === 'ladder', n = st.phases.length, lab = 44, bw = w - lab - 2, rh = Math.min(13, (h - 4) / n), i;
    fctx.font = '10.5px ' + TOK.mono; fctx.textBaseline = 'middle'; fctx.textAlign = 'left';
    for (i = 0; i < n; i++) {
      var y = 2 + i * ((h - 4) / n), name = ladder ? LIMB_NAMES[i] : ch.legs[i].name;
      fctx.fillStyle = TOK.muted; fctx.fillText(name, 0, y + rh / 2);
      fctx.fillStyle = TOK.line; fctx.fillRect(lab, y + rh / 2 - 0.5, bw, 1);
      var a = ((1 - st.phases[i]) % 1 + 1) % 1, b = a + st.duty;
      fctx.fillStyle = TOK.ink;
      fctx.fillRect(lab + a * bw, y + 1, (Math.min(b, 1) - a) * bw, rh - 3);
      if (b > 1) fctx.fillRect(lab, y + 1, (b - 1) * bw, rh - 3);
    }
    fctx.fillStyle = TOK.accent; fctx.fillRect(lab + S.phase * bw - 1, 0, 2, h);
  }

  // ----------------------------------------------------------------- UI
  var STYLE_IDS = { bounce: 'sBounce', stride: 'sStride', arm: 'sArm', lean: 'sLean', step: 'sStep', snap: 'sSnap' };
  function press(el, on) { el.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  function syncUI() {
    var biped = ch.kind === 'biped', k;
    [].forEach.call($('chars').children, function (b) { press(b, b.dataset.ch === set.ch); });
    [].forEach.call($('terrain').children, function (b) { press(b, b.dataset.t === set.terrain); b.disabled = set.ladder; });
    [].forEach.call($('presets').children, function (b) { press(b, b.dataset.p === set.preset); });
    [].forEach.call($('fps').children, function (b) { press(b, +b.dataset.f === set.fps); });
    $('speed').max = ch.vmax; $('speed').value = set.speed;
    $('speedOut').textContent = (set.ladder ? clamp(set.speed * 0.3, 0, 1.3) : set.speed).toFixed(2) + ' m/s';
    $('crouch').value = set.crouch; $('crouchOut').textContent = Math.round(set.crouch * 100) + '%'; $('crouch').disabled = set.ladder;
    for (k in STYLE_IDS) { $(STYLE_IDS[k]).value = set.style[k]; $(STYLE_IDS[k] + 'Out').textContent = (+set.style[k]).toFixed(2); }
    $('ladder').hidden = !biped; $('ladderNote').hidden = !biped; $('jump').disabled = set.ladder || set.down; $('ladder').disabled = set.down;
    press($('knock'), set.down); $('knock').textContent = set.down ? 'Get up' : 'Knock down';
    var noTurn = set.ladder || set.down;
    $('turnRound').disabled = noTurn; $('steerL').disabled = noTurn; $('steerR').disabled = noTurn; $('hit').disabled = noTurn;
    press($('ladder'), set.ladder); $('ladder').textContent = set.ladder ? 'Step off the ladder' : 'Climb a ladder';
    $('holdSeg').hidden = !biped; press($('armedOn'), set.armed); press($('armedOff'), !set.armed);
    $('kitSeg').hidden = !biped; $('reload').hidden = !biped; $('ammoNote').hidden = !biped;
    [].forEach.call($('kitSeg').children, function (b) { press(b, b.dataset.kit === set.kit); b.disabled = set.ladder || set.down; });
    $('fire').disabled = set.ladder || set.down || (biped && !set.armed);
    $('reload').disabled = set.ladder || set.down || !set.armed;
    [].forEach.call($('dirSeg').children, function (b) { press(b, +b.dataset.dir === set.dir); b.disabled = set.ladder || set.down || !!F || (S && (S.mode === 'swim' || S.mode === 'fly')); });
    $('ride').hidden = !ch.saddle; $('ride').disabled = set.down || !!F; press($('ride'), !!rider); $('ride').textContent = rider ? 'Take the rider off' : 'Put a rider on';
    $('riderArmed').hidden = !rider; press($('riderArmed'), riderArmed); $('rideNote').hidden = !rider;
    $('ledge').hidden = !biped; $('ledge').disabled = set.down || set.ladder || !!F || (!!wall && S.mode !== 'ledge'); press($('ledge'), !!wall);
    $('ledge').textContent = S && S.mode === 'ledge' ? 'Climb up' : wall ? 'Walking to the wall' : 'Wall ahead';
    $('pounce').hidden = !ch.beast; $('pounce').disabled = set.down; $('gGallop').hidden = !ch.gait.gallop;
    $('sting').hidden = !(ch.arthro && ch.tail && ch.arthro.claw); $('sting').disabled = set.down; if (!ch.jumpH) $('jump').disabled = true;
    var swimming = !!(S && S.mode === 'swim'), flying = !!(S && S.mode === 'fly');
    $('swim').hidden = !ch.octo && !ch.fly; $('ink').hidden = !ch.octo; $('swim').disabled = set.down; $('ink').disabled = set.down; press($('swim'), (swimming || flying) && !swimDown);
    $('swim').textContent = ch.fly ? (!flying ? 'Take off' : swimDown ? 'Coming down' : 'Land') : !swimming ? 'Swim' : swimDown ? 'Sinking to the bottom' : 'Back to crawling';
    $('speed').max = swimming ? ch.octo.vswim : flying ? ch.fly.vmax : ch.vmax; $('speed').value = set.speed;
    if (flying) ['hit', 'jump', 'turnRound', 'pounce'].forEach(function (id2) { $(id2).disabled = true; });
    if (swimming) { ['hit', 'knock', 'fire', 'turnRound'].forEach(function (id2) { $(id2).disabled = true; }); }
    if (biped && set.kit === 'sword') $('reload').disabled = true;
    $('fire').textContent = biped && set.kit === 'sword' ? 'Slash' : ch.beast ? 'Bite' : ch.arthro ? (!ch.arthro.claw ? 'Sting' : ch.arthro.both ? 'Strike' : 'Pinch') : ch.octo ? 'Grab' : 'Hold to fire';
    $('weaponNote').textContent = ch.fly ? (ch.arthro ? 'The abdomen is a chain that hangs behind and curls round from below to sting. In the air the wings beat faster the harder they work, the body banks into turns, and the legs hang and trail. The crouch slider sets the height.'
        : 'The head follows the pointer and bites. In the air the dragon cannot hang still: it keeps at least 5 m/s, beats harder when slow or climbing, and glides when fast or coming down. Neck and tail are the same chains as on the ground. The crouch slider sets the height.')
      : ch.arthro && ch.arthro.look === 'mantis' ? 'The forelegs are held folded, drift towards the pointer, and strike together. Standing, it rocks like a leaf.' : ch.octo ? 'On the bottom each arm is planted, lifted and planted again like a leg, and drawn as one curve. Grab lifts the nearest arm and reaches for the pointer. Swimming is by jets, mantle first, with the arms trailing as eight sprung chains. The crouch slider sets the swimming depth.' : ch.arthro ? 'The claws drift towards the pointer, and the nearer one shoots out to pinch. The sting whips the tail over the head onto the pointer, as far as it reaches. The tail is a chain of sprung links with a rest shape that curls forward.' : ch.beast ? 'The head follows the pointer. A bite shoots the neck out and snaps the jaws. A pounce is a leap along the way it faces that lands jaws first. The tail is a chain of sprung links.' : biped ? 'Weapons are separate objects with grip points. Stowed, the rifle goes across the back and pistols into hip holsters. Firing an empty weapon reloads it.'
      : ch.kind === 'hex' ? 'The turret tracks the pointer all the way round. Recoil pushes the gun back and tips the body.'
      : ch.kind === 'quad' ? 'The gun is fixed under the head, which turns to track the pointer. Recoil pushes it back and tips the body.'
      : 'The hull turns on the hips to track the pointer. Recoil pushes each gun back and tips the body.';
    $('gRun').textContent = ch.kind === 'quad' && ch.legs.length > 2 ? 'Trot' : ch.gait.run ? 'Run' : 'Fast';
    // hands and fists
    var fighting = !!F, off = set.ladder || set.down || fighting, carrying = !!(S && S.carry);
    $('actGroup').hidden = !biped;
    $('throw').disabled = off || carrying || guardOn;
    $('crate').disabled = off || guardOn; press($('crate'), carrying); $('crate').textContent = carrying ? 'Put the crate down' : 'Pick up a crate';
    $('guard').disabled = off || carrying; press($('guard'), guardOn); $('guard').textContent = guardOn ? 'Fists down' : 'Fists up';
    ['pJab', 'pCross', 'pHook'].forEach(function (id2) { $(id2).disabled = off || !guardOn; });
    $('fight').hidden = !FT; $('fightNote').hidden = !FT; press($('fight'), fighting); $('fight').textContent = fighting ? 'Stop the fight' : 'Start a fistfight';
    if (fighting) {
      ['speed', 'crouch', 'gStand', 'gWalk', 'gRun', 'turnRound', 'steerL', 'steerR', 'jump', 'hit', 'knock', 'ladder', 'fire', 'reload', 'armedOn', 'armedOff'].forEach(function (id2) { $(id2).disabled = true; });
      [].forEach.call($('kitSeg').children, function (b) { b.disabled = true; });
    } else ['speed', 'gStand', 'gWalk', 'gRun', 'knock', 'armedOn', 'armedOff'].forEach(function (id2) { $(id2).disabled = false; });
    if (!fighting && (carrying || guardOn)) { $('fire').disabled = true; $('reload').disabled = true; }
    press($('viewSide'), set.view === 'side'); press($('view34'), set.view !== 'side');
    press($('pause'), set.paused); $('pause').textContent = set.paused ? 'Play' : 'Pause';
    press($('slow'), set.slow); $('overlays').checked = set.overlays; $('legend').hidden = !set.overlays || set.ladder;
    $('hint').textContent = F ? 'Both fighters run on the same motion core. The pointer does nothing here.' : set.down ? 'The body is a ragdoll now: bone lengths, joint limits, gravity and the ground.' : set.ladder ? 'The speed slider sets the climbing speed.'
      : set.view !== 'side' ? 'The pointer picks a spot around the character and the upper body turns to aim at it. Press to fire.'
      : S.kit === 'sword' && set.armed && ch.kind === 'biped' ? 'Sword and shield. Press, or key 1, to slash; 2 chops, 3 thrusts; hold B to bring the shield up. Arrow keys steer.'
      : guardOn ? 'Fists up. Keys 1, 2 and 3 throw a jab, a cross and a hook at the pointer. F lowers the fists.'
      : ch.fly ? (S.mode === 'fly' ? 'Flying. Speed sets the pace, the crouch slider the height, arrow keys steer. S comes down to land.' : 'S takes off. ' + (ch.arthro ? 'Press to sting at the pointer.' : 'Press to bite, P to pounce.'))
      : ch.octo ? (S.mode === 'swim' ? 'Swimming by jets. Speed sets the pace, the crouch slider the depth, arrow keys steer, I squirts ink.' : 'Press to grab at the pointer with the nearest arm. S swims, I squirts ink, arrow keys steer.')
      : ch.arthro && ch.arthro.both ? 'The forelegs follow the pointer. Press to strike with both, arrow keys to steer.'
      : ch.arthro ? 'The claws follow the pointer. Press to pinch, T to sting at the pointer, arrow keys to steer.'
      : ch.beast ? 'It watches the pointer. Press to bite, P to pounce at the pointer, Space to jump, arrow keys to steer.'
      : ch.kind === 'biped' ? 'Point to aim, press to fire. Space jumps, arrow keys steer. G throws a grenade at the pointer, C lifts a crate, F puts the fists up.'
      : 'Move the pointer over the stage to aim. Press to fire. Space to jump, arrow keys to steer.';
  }
  function setSpeed(v) { set.speed = clamp(v, 0, S.mode === 'swim' ? ch.octo.vswim : S.mode === 'fly' ? ch.fly.vmax : ch.vmax); syncUI(); }

  $('chars').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; set.ch = b.dataset.ch; reset(false); });
  $('terrain').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b || b.disabled) return; set.terrain = b.dataset.t; reset(true); });
  $('presets').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var p = PRESETS[b.dataset.p]; set.preset = b.dataset.p;
    set.style = { bounce: p.bounce, stride: p.stride, arm: p.arm, lean: p.lean, step: p.step, snap: p.snap };
    set.fps = p.fps; set.crouch = p.crouch || 0; held = null; syncUI();
  });
  $('fps').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; set.fps = +b.dataset.f; held = null; syncUI(); });
  $('speed').addEventListener('input', function () { setSpeed(+this.value); });
  $('crouch').addEventListener('input', function () { set.crouch = +this.value; syncUI(); });
  Object.keys(STYLE_IDS).forEach(function (k) {
    $(STYLE_IDS[k]).addEventListener('input', function () { set.style[k] = +this.value; set.preset = ''; syncUI(); });
  });
  $('gStand').addEventListener('click', function () { setSpeed(0); });
  $('gWalk').addEventListener('click', function () { setSpeed(B.walkSpeed(ch)); });
  $('gRun').addEventListener('click', function () { setSpeed(B.runSpeed(ch)); });
  $('gGallop').addEventListener('click', function () { setSpeed(0.75 * ch.vmax); });
  $('pounce').addEventListener('click', pounceNow);
  $('ledge').addEventListener('click', ledgeNow);
  $('ride').addEventListener('click', rideNow);
  $('riderArmed').addEventListener('click', function () { riderArmed = !riderArmed; syncUI(); });
  $('dirSeg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b || b.disabled) return; set.dir = +b.dataset.dir; if (set.speed < 0.1) set.speed = B.walkSpeed(ch); clearStrip(); syncUI(); });
  $('sting').addEventListener('click', stingNow);
  $('swim').addEventListener('click', swimNow);
  $('ink').addEventListener('click', function () { if (ch.octo) inkOnce = true; });
  $('ladder').addEventListener('click', function () { if (F) return; guardOn = false; toggleLadder(!set.ladder); });
  $('jump').addEventListener('click', function () { if (!F) jumpOnce = true; });
  $('knock').addEventListener('click', function () { if (F) return; if (set.down) getUp(); else { guardOn = false; knockDown(); } });
  $('hit').addEventListener('click', function () { if (!set.down && !set.ladder && !F) hitOnceNow(); });
  $('turnRound').addEventListener('click', function () { if (set.down || set.ladder || F) return; set.heading = M.wrapPi((set.heading != null ? set.heading : S.h) + Math.PI); });
  function steerHold(btn, dir) {
    function on(e) { if (btn.disabled) return; set.steer = dir; set.heading = null; try { btn.setPointerCapture(e.pointerId); } catch (err) {} }
    function offFn() { if (set.steer === dir) { set.steer = 0; set.heading = S.h; } }
    btn.addEventListener('pointerdown', on);
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (n) { btn.addEventListener(n, offFn); });
    btn.addEventListener('keydown', function (e) { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { set.steer = dir; set.heading = null; } });
    btn.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') offFn(); });
  }
  steerHold($('steerL'), -1); steerHold($('steerR'), 1);
  $('armedOn').addEventListener('click', function () { set.armed = true; syncUI(); });
  $('armedOff').addEventListener('click', function () { set.armed = false; syncUI(); });
  $('kitSeg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b || b.disabled) return; set.kit = b.dataset.kit; set.armed = true; clearStrip(); syncUI(); });
  $('reload').addEventListener('click', function () { reloadOnce = true; });
  $('throw').addEventListener('click', throwNow);
  $('crate').addEventListener('click', crateNow);
  $('guard').addEventListener('click', function () { guardNow(!guardOn); });
  $('pJab').addEventListener('click', function () { punchNow('jab'); });
  $('pCross').addEventListener('click', function () { punchNow('cross'); });
  $('pHook').addEventListener('click', function () { punchNow('hook'); });
  $('fight').addEventListener('click', function () { fightNow(!F); });
  $('viewSide').addEventListener('click', function () { set.view = 'side'; syncUI(); });
  $('view34').addEventListener('click', function () { set.view = '34'; syncUI(); });
  $('pause').addEventListener('click', function () { set.paused = !set.paused; syncUI(); });
  $('slow').addEventListener('click', function () { set.slow = !set.slow; syncUI(); });
  $('overlays').addEventListener('change', function () { set.overlays = this.checked; syncUI(); });
  $('sampleParts').addEventListener('click', sampleParts);
  $('clearParts').addEventListener('click', function () { IMG[ch.id] = {}; clearStrip(); syncSlots(); });
  $('drawing').addEventListener('change', function () { if (this.files && this.files[0]) loadDrawing(this.files[0]); this.value = ''; });
  $('saveDrawing').addEventListener('click', function () {
    if (!downloads) return;
    var note = $('drawingNote');
    downloads.save({ filename: ch.id + '_template.svg', data: new Blob([B.svgTemplate(ch)], { type: 'image/svg+xml' }) })
      .then(function () { note.textContent = 'Saved. Open it in Inkscape, draw each part in the layer that has its name, save, and load the file here.'; }, function () { note.textContent = 'Nothing was saved.'; });
  });
  $('saveModel').addEventListener('click', function () {
    if (!downloads) return;
    var note = $('modelNote'), kit = ch.mount.type === 'held' && set.kit !== ch.mount.kit ? set.kit : null, rig = B.rig(ch, { kit: kit }), enc = new TextEncoder();
    var zip = B.zip([{ name: rig.name + '.glb', data: B.glbTemplate(ch, { kit: kit, name: rig.name }) }, { name: rig.name + '.rig.json', data: enc.encode(JSON.stringify(rig, null, 1) + '\n') },
      { name: 'README.txt', data: enc.encode(['CLIo Motion 3D template: ' + rig.name, '',
        rig.name + '.rig.json  the skeleton as data: ' + rig.joints.length + ' joints, in the template pose. The Blender add-on (tools/blender/clio_motion_blender.py',
        '                      in the repository) builds the armature and a stand-in model from it, checks your model and exports it.',
        rig.name + '.glb       the same skeleton with the stand-in model, skinned, for any other program.', '',
        'Model round the skeleton and keep the bones\' names. Export a .glb, then in Gait Bench choose "Put the clips on my model",',
        'or run: node tools/gaitbake.js ' + ch.id + (kit ? ' --kit ' + kit : '') + ' --model your.glb', '',
        'https://github.com/eryxgames/clio-motion', ''].join('\n')) }]);
    downloads.save({ filename: rig.name + '_template3d.zip', data: new Blob([zip]) })
      .then(function () { note.textContent = 'Saved the skeleton and stand-in model of the ' + ch.label.toLowerCase() + (kit ? ' (' + kit + ')' : '') + '.'; }, function () { note.textContent = 'Nothing was saved.'; });
  });
  $('fitModel').addEventListener('change', function () {
    var file = this.files && this.files[0], note = $('modelNote'); this.value = '';
    if (!file || !downloads) return;
    var rd = new FileReader(), c0 = ch, kit = ch.mount.type === 'held' && set.kit !== ch.mount.kit ? set.kit : null;
    note.textContent = 'Baking clips for ' + file.name + '.';
    rd.onerror = function () { note.textContent = 'That file could not be read.'; };
    rd.onload = function () {
      setTimeout(function () {
        var fit;
        try { fit = B.glbFit(c0, B.recordAll(c0, { style: set.style, frames: 8, kit: kit }), new Uint8Array(rd.result), { kit: kit }); }
        catch (e) { note.textContent = 'That model could not be read (' + (e && e.message ? e.message : e) + ').'; return; }
        var rep = fit.report, warn = rep.warnings.length ? ' ' + rep.warnings.join(' ') : '';
        if (!fit.glb) { note.textContent = rep.errors.join(' '); return; }
        // in a zip, like the other exports: not every view that can save files will save a bare .glb
        var base = file.name.replace(/\.glb$/i, '') + '_clips';
        downloads.save({ filename: base + '.zip', data: new Blob([B.zip([{ name: base + '.glb', data: fit.glb }])]) })
          .then(function () { note.textContent = 'Saved ' + base + '.glb (in a zip): ' + rep.clips + ' clips on the ' + rep.joints + ' joints of ' + file.name + '.' + warn; }, function () { note.textContent = 'Nothing was saved.' + warn; });
      }, 30);
    };
    rd.readAsArrayBuffer(file);
  });
  function typing(e) { var t = e.target && e.target.tagName; return t === 'BUTTON' || t === 'INPUT' || t === 'LABEL' || t === 'SELECT' || t === 'TEXTAREA'; }
  document.addEventListener('keydown', function (e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    var free = !set.ladder && !set.down && !F;
    // letters and digits work wherever the focus is (there is nothing to type into on this page)
    if (e.code === 'KeyW' || e.code === 'KeyX' || e.code === 'KeyQ' || e.code === 'KeyE') { if (free) { set.dir = e.code === 'KeyW' ? 0 : e.code === 'KeyX' ? 180 : e.code === 'KeyQ' ? -90 : 90; if (set.speed < 0.1) set.speed = B.walkSpeed(ch); syncUI(); } return; }
    if (e.code === 'KeyL') { ledgeNow(); return; }
    if (e.code === 'KeyB') { blockHeld = true; return; }
    if (e.code === 'KeyP') { pounceNow(); return; }
    if (e.code === 'KeyT') { stingNow(); return; }
    if (e.code === 'KeyS') { swimNow(); return; }
    if (e.code === 'KeyI') { if (ch.octo) inkOnce = true; return; }
    if (e.code === 'KeyG') { throwNow(); return; }
    if (e.code === 'KeyC') { crateNow(); return; }
    if (e.code === 'KeyF') { guardNow(!guardOn); return; }
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') { punchNow(e.code === 'Digit1' ? 'jab' : e.code === 'Digit2' ? 'cross' : 'hook'); return; }
    if (typing(e)) return;
    if (e.code === 'Space') { if (free) jumpOnce = true; e.preventDefault(); }
    else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { if (free) { set.steer = e.code === 'ArrowLeft' ? -1 : 1; set.heading = null; } e.preventDefault(); }
  });
  document.addEventListener('keyup', function (e) {
    if (e.code === 'KeyB') blockHeld = false;
    if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && set.steer) { set.steer = 0; set.heading = S.h; }
  });

  var fireBtn = $('fire');
  fireBtn.addEventListener('pointerdown', function (e) { if (fireBtn.disabled) return; firing = true; try { fireBtn.setPointerCapture(e.pointerId); } catch (err) {} });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (n) { fireBtn.addEventListener(n, function () { firing = false; }); });
  fireBtn.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') fireOnce = true; });

  // the last place pointed at is remembered for a while, so that a button outside the stage can still use it
  function aimAt(e) { var r = stage.getBoundingClientRect(); aimScreen = [e.clientX - r.left, e.clientY - r.top]; lastAim = { p: aimWorld(), t: performance.now() }; }
  stage.addEventListener('pointermove', aimAt);
  stage.addEventListener('pointerdown', function (e) { aimAt(e); if (!$('fire').disabled && !F) firing = true; });   // (a disabled Fire button also blocks stage fire)
  ['pointerup', 'pointercancel'].forEach(function (n) { stage.addEventListener(n, function () { firing = false; }); });
  stage.addEventListener('pointerleave', function (e) { firing = false; if (e.pointerType === 'mouse') aimScreen = null; });

  function resize() {
    var box = $('stageBox');
    W = Math.max(box.clientWidth, 100); H = Math.max(box.clientHeight, 100); dpr = Math.min(window.devicePixelRatio || 1, 2);
    stage.width = Math.round(W * dpr); stage.height = Math.round(H * dpr);
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe($('stageBox'));
  window.addEventListener('resize', resize);
  new MutationObserver(readTokens).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', readTokens);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(readTokens);

  // ---------------------------------------------------------------- loop
  var lastT = 0, acc = 0, uiClock = 0, DT = 1 / 120, uiCarry = false, uiKd = 0;
  function frame(now) {
    var real = Math.min((now - lastT) / 1000, 0.1); lastT = now;
    var wantYaw = set.view === 'side' ? 0 : -0.5, wantPit = set.view === 'side' ? 0 : 0.28, kk = 1 - Math.exp(-real * 7);
    cam.yaw += (wantYaw - cam.yaw) * kk; cam.pit += (wantPit - cam.pit) * kk;
    if (Math.abs(cam.yaw - wantYaw) < 0.002) { cam.yaw = wantYaw; cam.pit = wantPit; }
    if (!set.paused) {
      acc += real * (set.slow ? 0.25 : 1);
      while (acc >= DT) { simStep(DT); acc -= DT; }
    }
    render(); drawFootfall();
    uiClock += real;
    if (uiClock > 0.12) {
      uiClock = 0; var st = S.stats;
      $('rGait').textContent = st.gait === 'Standing' ? 'Idle' : st.gait; $('rSpeed').textContent = st.v.toFixed(2);
      $('rFr').textContent = S.mode === 'ladder' ? 'n/a' : st.Fr.toFixed(2);
      $('rStride').textContent = st.stride.toFixed(2); $('rSteps').textContent = Math.round(st.steps);
      $('rDuty').textContent = Math.round(st.duty * 100);
      var cNow = !!S.carry;
      if (cNow !== uiCarry || (F && F.fighters[0].stats.knockdowns + F.fighters[1].stats.knockdowns !== uiKd)) {
        uiCarry = cNow; uiKd = F ? F.fighters[0].stats.knockdowns + F.fighters[1].stats.knockdowns : 0; syncUI();
        if (F) $('hint').textContent = 'Both fighters run on the same motion core. Knockdowns scored: orange ' + F.fighters[0].stats.knockdowns + ', blue ' + F.fighters[1].stats.knockdowns + '.';
      }
      if (st.ammo && S.kit) {
        var cap = M.PROPS[M.KITS[S.kit].props[0]].rounds;
        $('ammoNote').textContent = 'Rounds ' + st.ammo.join(' + ') + ' of ' + cap + (st.ammo.length > 1 ? ' each' : '') + (st.action === 'reload' ? ', reloading' : '');
      }
    }
    requestAnimationFrame(frame);
  }

  readTokens(); resize();
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) set.paused = true;
  reset(boot.speed != null);
  requestAnimationFrame(function (t) { lastT = t; requestAnimationFrame(frame); });
})();
