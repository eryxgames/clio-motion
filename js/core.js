// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
/* Motion core. No DOM, no rendering, no engine calls: it turns a character
   description and an input (speed, crouch, aim, fire) into joint positions.
   Units: metres, seconds, radians.
   Axes: x forward, y up, z to the character's right (the near side in a side view).
   A 2D game uses x and y; a 3D game uses all three. The maths is the same. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MotionCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var G = 9.81, TAU = Math.PI * 2;

  // ---------------------------------------------------------------- helpers
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function frac(x) { return x - Math.floor(x); }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function lerp3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function decay(rate, dt) { return 1 - Math.exp(-rate * dt); }

  // A damped spring: the one piece of real-time physics used everywhere
  // (ground following, lean, aim, recoil, backpack and tail).
  function spring(s, target, omega, zeta, dt) {
    var a = -2 * zeta * omega * s.v - omega * omega * (s.x - target);
    s.v += a * dt; s.x += s.v * dt;
  }

  // Two-bone inverse kinematics. Works unchanged in 2D and 3D: the joint
  // bends in the plane that holds root, target and the pole direction.
  function ik2(root, target, l1, l2, pole) {
    var d = sub(target, root), dist = len(d);
    var maxR = (l1 + l2) * 0.999, minR = Math.abs(l1 - l2) + 1e-4;
    var reach = clamp(dist, minR, maxR);
    var dir = dist > 1e-6 ? mul(d, 1 / dist) : [0, -1, 0];
    var cosA = clamp((l1 * l1 + reach * reach - l2 * l2) / (2 * l1 * reach), -1, 1);
    var sinA = Math.sqrt(1 - cosA * cosA);
    var perp = sub(pole, mul(dir, dot(pole, dir))), pl = len(perp);
    perp = pl > 1e-6 ? mul(perp, 1 / pl) : [1, 0, 0];
    return {
      mid: add(root, add(mul(dir, l1 * cosA), mul(perp, l1 * sinA))),
      end: add(root, mul(dir, reach))
    };
  }

  // ------------------------------------------------------------- characters
  // Everything that differs between a soldier and a spider mech is data.
  function leg(name, side, attach, rest, upper, lower, pole, foot) {
    return { name: name, side: side, attach: attach, rest: rest, upper: upper, lower: lower, pole: pole, foot: foot || null };
  }
  var HUMAN_FOOT = { fb: 0.15, hb: 0.06, toe: 0.07, ah: 0.08, heelLift: 1.05, strike: 0.28 };
  var RAPTOR_FOOT = { fb: 0.12, hb: 0.02, toe: 0.15, ah: 0.24, heelLift: 0.9, strike: 0.15 };     // walks on its toes: the 'ankle' is high off the ground
  var MECH_FOOT = { fb: 0.50, hb: 0.30, toe: 0.22, ah: 0.26, heelLift: 0.55, strike: 0.10 };

  var CHARACTERS = {
    soldier: {
      id: 'soldier', label: 'Soldier', kind: 'biped', L: 0.92, rootHeight: 0.89, crouchDrop: 0.40, runDrop: 0.05,
      vmax: 6.5, viewH: 2.25, jumpH: 0.45, bob: 1, sway: 1, liftWalk: 0.075, liftRun: 0.30, runStride: 1.18,
      legs: [
        leg('R', 1, [0, 0, 0.10], [0.02, 0.10], 0.44, 0.43, [1, 0, 0], HUMAN_FOOT),
        leg('L', -1, [0, 0, -0.10], [0.02, -0.10], 0.44, 0.43, [1, 0, 0], HUMAN_FOOT)
      ],
      gait: { walk: { phases: [0, 0.5], duty: [0.66, 0.58] }, run: { phases: [0, 0.5], duty: [0.40, 0.27] }, frRun: 0.5, frMax: 5 },
      torso: { len: 0.50, neck: 0.13, headR: 0.115, shoulderW: 0.19 },
      arms: { upper: 0.29, lower: 0.27 },
      mount: { type: 'held', kit: 'rifle', omega: 38, aimOmega: 16, min: -0.9, max: 1.1, yaw: 1.0 },
      fight: { stance: [[-0.17, 0.05], [0.16, -0.03]] }       // on guard: right foot back, left foot forward
    },
    mech: {
      id: 'mech', label: 'Heavy mech', kind: 'mech', L: 2.6, rootHeight: 2.8, crouchDrop: 0.32, runDrop: 0.04,
      vmax: 5.4, viewH: 6.4, jumpH: 0.16, bob: 1.1, sway: 1, liftWalk: 0.09, liftRun: 0.18, runStride: 1.1,
      legs: [
        leg('R', 1, [0, 0, 0.60], [0.10, 0.62], 1.35, 1.50, [-1, 0.1, 0], MECH_FOOT),
        leg('L', -1, [0, 0, -0.60], [0.10, -0.62], 1.35, 1.50, [-1, 0.1, 0], MECH_FOOT)
      ],
      gait: { walk: { phases: [0, 0.5], duty: [0.70, 0.60] }, run: { phases: [0, 0.5], duty: [0.46, 0.38] }, frRun: 0.5, frMax: 1.4 },
      pod: { h: 1.05, r: 0.9, gunZ: 1.12, gunLen: 1.75 },
      mount: { type: 'fixed', n: 2, rate: 2.6, kick: 9, rise: 1.2, omega: 13, aimOmega: 6, min: -0.5, max: 0.7, yaw: 1.3, bodyKick: 0.9 }
    },
    quad: {
      id: 'quad', label: 'Quadruped', kind: 'quad', L: 0.62, rootHeight: 0.56, crouchDrop: 0.42, runDrop: 0.04,
      vmax: 4.4, viewH: 1.55, jumpH: 0.7, bob: 0.6, sway: 0.4, liftWalk: 0.10, liftRun: 0.20, runStride: 1.1,
      legs: [
        leg('RH', 1, [-0.36, 0, 0.13], [-0.40, 0.16], 0.33, 0.35, [-1, 0.2, 0]),
        leg('RF', 1, [0.36, 0, 0.13], [0.38, 0.16], 0.33, 0.35, [-1, 0.2, 0]),
        leg('LH', -1, [-0.36, 0, -0.13], [-0.40, -0.16], 0.33, 0.35, [-1, 0.2, 0]),
        leg('LF', -1, [0.36, 0, -0.13], [0.38, -0.16], 0.33, 0.35, [-1, 0.2, 0])
      ],
      // walk: one foot at a time; run here is a trot, diagonal pairs together
      gait: { walk: { phases: [0, 0.75, 0.5, 0.25], duty: [0.74, 0.62] }, run: { phases: [0, 0.5, 0.5, 0], duty: [0.46, 0.32] }, frRun: 0.5, frMax: 3 },
      mount: { type: 'fixed', n: 1, rate: 5, kick: 2.2, rise: 2, omega: 30, aimOmega: 12, min: -0.6, max: 0.8, yaw: 0.9, bodyKick: 0.4 }
    },
    hyena: {
      // a living quadruped: sloping back (long forelegs), heavy neck and head, a jaw to bite with, a short tail
      id: 'hyena', label: 'Hyena', kind: 'quad', L: 0.70, rootHeight: 0.68, crouchDrop: 0.36, runDrop: 0.05,
      vmax: 11, viewH: 1.9, jumpH: 0.75, bob: 0.7, sway: 0.5, liftWalk: 0.09, liftRun: 0.16, runStride: 1.05,
      legs: [
        leg('RH', 1, [-0.34, -0.07, 0.10], [-0.36, 0.12], 0.34, 0.36, [-1, 0.25, 0]),
        leg('RF', 1, [0.34, 0.05, 0.11], [0.37, 0.13], 0.38, 0.39, [1, 0.1, 0]),
        leg('LH', -1, [-0.34, -0.07, -0.10], [-0.36, -0.12], 0.34, 0.36, [-1, 0.25, 0]),
        leg('LF', -1, [0.34, 0.05, -0.11], [0.37, -0.13], 0.38, 0.39, [1, 0.1, 0])
      ],
      // (the hind legs bend back at the hock, the forelegs forward at the wrist)
      // walk, then trot (diagonal pairs), then a gallop: hind feet land one after the other, then the fore feet, then the body flies
      gait: { walk: { phases: [0, 0.75, 0.5, 0.25], duty: [0.72, 0.60] }, run: { phases: [0, 0.5, 0.5, 0], duty: [0.46, 0.36] }, frRun: 0.5, frMax: 2.2,
        gallop: { phases: [0.88, 0.43, 0, 0.55], duty: [0.34, 0.24], fr: 2.2, frMax: 14 } },
      beast: { half: 0.36, neck: 0.27, neckUp: 0.55, skull: 0.21, jaw: 0.17, flex: 0.20, rock: 0.08 },
      tail: { at: [-0.40, 0.01], n: 4, seg: 0.085, rest: 1.05, curl: 0.10, omega: 12, zeta: 0.35, soft: 0.5, sag: 0.15, lift: 0.9, wag: 0.35, alert: 1.0, sway: 0.3 },
      mount: { type: 'jaw', n: 1, rate: 2, kick: 0, rise: 0, omega: 30, aimOmega: 11, min: -0.7, max: 0.7, yaw: 1.0, bodyKick: 0 }
    },
    horse: {
      // a riding horse: long legs under a deep chest, a long neck, a tail of hair. Walk, trot, gallop; it can be ridden (saddle)
      id: 'horse', label: 'Horse', kind: 'quad', L: 1.05, rootHeight: 1.12, crouchDrop: 0.30, runDrop: 0.03,
      vmax: 16, viewH: 2.9, jumpH: 0.9, bob: 0.75, sway: 0.35, liftWalk: 0.10, liftRun: 0.17, runStride: 1.06,
      legs: [
        leg('RH', 1, [-0.52, -0.10, 0.15], [-0.56, 0.17], 0.52, 0.57, [-1, 0.25, 0]),
        leg('RF', 1, [0.50, 0.04, 0.16], [0.54, 0.17], 0.57, 0.62, [1, 0.1, 0]),
        leg('LH', -1, [-0.52, -0.10, -0.15], [-0.56, -0.17], 0.52, 0.57, [-1, 0.25, 0]),
        leg('LF', -1, [0.50, 0.04, -0.16], [0.54, -0.17], 0.57, 0.62, [1, 0.1, 0])
      ],
      gait: { walk: { phases: [0, 0.75, 0.5, 0.25], duty: [0.70, 0.60] }, run: { phases: [0, 0.5, 0.5, 0], duty: [0.45, 0.36] }, frRun: 0.5, frMax: 2.4,
        gallop: { phases: [0.88, 0.43, 0, 0.55], duty: [0.32, 0.22], fr: 2.4, frMax: 16 } },
      beast: { half: 0.55, neck: 0.62, neckUp: 0.78, skull: 0.44, jaw: 0.30, flex: 0.06, rock: 0.05, look: 'horse' },
      tail: { at: [-0.60, 0.12], n: 5, seg: 0.15, rest: 1.25, curl: 0.05, omega: 9, zeta: 0.4, soft: 0.6, sag: 0.2, lift: 0.75, wag: 0.25, alert: 0.25, sway: 0.25 },
      mount: { type: 'jaw', n: 1, rate: 2, kick: 0, rise: 0, omega: 30, aimOmega: 8, min: -0.7, max: 0.5, yaw: 0.9, bodyKick: 0 },
      // where a rider sits: the seat from the body's root (along, up); stirrups and hands from the seat (along, up, to the side)
      saddle: { at: [0.02, 0.33], stirrup: [0.10, -0.50, 0.33], hands: [0.34, 0.20, 0.10], reins: 'bit' }
    },
    raptor: {
      // a dinosaur on two legs: the body lies level over the hips, with the neck and head out in front and a long tail behind to balance them
      id: 'raptor', label: 'Raptor', kind: 'quad', L: 0.95, rootHeight: 0.92, crouchDrop: 0.34, runDrop: 0.06,
      vmax: 12, viewH: 2.7, jumpH: 0.6, bob: 0.9, sway: 0.8, liftWalk: 0.10, liftRun: 0.24, runStride: 1.12,
      legs: [
        leg('R', 1, [0, 0, 0.13], [0.05, 0.14], 0.42, 0.48, [1, 0, 0], RAPTOR_FOOT),
        leg('L', -1, [0, 0, -0.13], [0.05, -0.14], 0.42, 0.48, [1, 0, 0], RAPTOR_FOOT)
      ],
      gait: { walk: { phases: [0, 0.5], duty: [0.64, 0.56] }, run: { phases: [0, 0.5], duty: [0.38, 0.24] }, frRun: 0.5, frMax: 6 },
      beast: { half: 0.46, back: 0.30, neck: 0.44, neckUp: 0.85, skull: 0.30, jaw: 0.25, flex: 0, rock: 0, mid: true, tilt: 0.08, look: 'raptor' },
      tail: { at: [-0.30, 0.0], n: 8, seg: 0.17, rest: -0.06, curl: -0.012, omega: 11, zeta: 0.4, soft: 0.5, sag: 0.05, bend: 0.28, lift: 0.2, wag: 0.09, alert: 0.3, sway: 0.16 },      // a stiff tail: each link bends only a little from the last
      mount: { type: 'jaw', n: 1, rate: 2, kick: 0, rise: 0, omega: 30, aimOmega: 10, min: -0.8, max: 0.6, yaw: 1.1, bodyKick: 0 }
    },
    spider: {
      id: 'spider', label: 'Spider mech', kind: 'hex', L: 1.0, rootHeight: 0.95, crouchDrop: 0.45, runDrop: 0,
      saddle: { at: [-0.50, 0.40], stirrup: [0.22, -0.40, 0.30], hands: [0.32, 0.14, 0.17], reins: null },      // a seat behind the turret, footrests, two handles
      vmax: 2.6, viewH: 3.4, jumpH: 0.3, bob: 0.45, sway: 0.3, liftWalk: 0.26, liftRun: 0.26, runStride: 1,
      legs: [
        leg('R1', 1, [0.55, 0.05, 0.38], [1.05, 1.15], 1.0, 1.5, [0.2, 1, 0.3]),
        leg('R2', 1, [0.0, 0.05, 0.45], [0.0, 1.38], 1.0, 1.5, [0, 1, 0.3]),
        leg('R3', 1, [-0.55, 0.05, 0.38], [-1.05, 1.15], 1.0, 1.5, [-0.2, 1, 0.3]),
        leg('L1', -1, [0.55, 0.05, -0.38], [1.05, -1.15], 1.0, 1.5, [0.2, 1, -0.3]),
        leg('L2', -1, [0.0, 0.05, -0.45], [0.0, -1.38], 1.0, 1.5, [0, 1, -0.3]),
        leg('L3', -1, [-0.55, 0.05, -0.38], [-1.05, -1.15], 1.0, 1.5, [-0.2, 1, -0.3])
      ],
      // alternating tripod: R1, L2, R3 move together, then L1, R2, L3
      gait: { walk: { phases: [0, 0.5, 0, 0.5, 0, 0.5], duty: [0.68, 0.52] }, run: null, frRun: 0.7, frMax: 1 },
      mount: { type: 'fixed', n: 1, rate: 2, kick: 4, rise: 1.5, omega: 20, aimOmega: 8, min: -0.25, max: 0.9, yaw: Math.PI, bodyKick: 0.5 }
    }
  };

  // ------------------------------------------------------------ gait rules
  CHARACTERS.scorpion = (function () {
    // eight legs, four a side, stepping in two alternating sets of four; claws in front; a tail that stings
    var legs = [], ax = [0.30, 0.12, -0.06, -0.24], rx = [0.56, 0.20, -0.18, -0.54], rz = [0.50, 0.66, 0.66, 0.52], nm = ['1', '2', '3', '4'];
    [1, -1].forEach(function (sd) { for (var k = 0; k < 4; k++) legs.push(leg((sd > 0 ? 'R' : 'L') + nm[k], sd, [ax[k], 0.02, sd * 0.15], [rx[k], sd * rz[k]], 0.40, 0.52, [0.15 * (1.5 - k), 1, sd * 0.3])); });
    return {
      id: 'scorpion', label: 'Scorpion', kind: 'hex', L: 0.55, rootHeight: 0.30, crouchDrop: 0.35, runDrop: 0,
      vmax: 3.4, viewH: 2.3, jumpH: 0, bob: 0.3, sway: 0.25, liftWalk: 0.16, liftRun: 0.16, runStride: 1,
      legs: legs,
      gait: { walk: { phases: [0, 0.5, 0, 0.5, 0.5, 0, 0.5, 0], duty: [0.70, 0.55] }, run: null, frRun: 0.7, frMax: 1.2 },
      arthro: { half: 0.38, claw: { at: [0.40, 0.02, 0.16], upper: 0.32, lower: 0.34, hand: 0.24, rest: [0.92, 0.10, 0.34] } },
      tail: { at: [-0.42, 0.05], n: 6, seg: 0.22, rest: -1.0, curl: -0.44, omega: 12, zeta: 0.5, soft: 0.3, sag: 0.08, lift: 0, wag: 0.10, alert: 0, sway: 0.08 },
      mount: { type: 'jaw', n: 1, rate: 2, kick: 0, rise: 0, omega: 30, aimOmega: 9, min: -0.3, max: 0.5, yaw: 0.6, bodyKick: 0 }
    };
  })();

  // Dynamic similarity: animals of different sizes move alike at the same
  // Froude number v^2 / (g L). This is what makes the mech stride slowly
  // and the soldier quickly without tuning either by hand.
  function gaitParams(ch, S, st, dt) {
    var Leff = ch.L * (1 - 0.5 * ch.crouchDrop * S.crouch);
    var Tn = TAU * Math.sqrt(Leff / G);              // natural swing period of the leg
    var Fr = S.v * S.v / (G * Leff);
    var gw = ch.gait.walk, gr = ch.gait.run;
    if (gr) {
      S.runWant = Fr > ch.gait.frRun * (S.runWant ? 0.8 : 1);   // hysteresis around the walk-run switch
      S.run += ((S.runWant ? 1 : 0) - S.run) * decay(1 / (0.11 * Tn), dt);
    } else S.run = 0;
    var run = S.run;
    // stride length: Alexander's relation, stride / leg length = 2.3 Fr^0.3
    var stride = Leff * 2.3 * Math.pow(Math.max(Fr, 1e-6), 0.3) * st.stride * lerp(1, ch.runStride, run) * (1 - 0.45 * S.crouch);   // crouched steps are short
    var period = stride / Math.max(S.v, 1e-4);
    if (period > Tn) { period = Tn; stride = S.v * Tn; }       // legs never swing slower than a pendulum
    var wd = lerp(gw.duty[0], gw.duty[1], clamp(Fr / ch.gait.frRun, 0, 1));
    var rd = gr ? lerp(gr.duty[0], gr.duty[1], clamp((Fr - ch.gait.frRun) / (ch.gait.frMax - ch.gait.frRun), 0, 1)) : wd;
    var duty = lerp(wd, rd, run);
    var phases = gw.phases.map(function (p, i) {
      if (!gr) return p;
      var q = gr.phases[i], d = q - p; d -= Math.round(d);     // shortest way round the cycle
      return frac(p + d * run + 1);
    });
    var gg = ch.gait.gallop, gal = 0;
    if (gg) {
      S.galWant = Fr > gg.fr * (S.galWant ? 0.8 : 1);
      S.gal = (S.gal || 0) + ((S.galWant ? 1 : 0) - (S.gal || 0)) * decay(1 / (0.16 * Tn), dt); gal = S.gal;
      duty = lerp(duty, lerp(gg.duty[0], gg.duty[1], clamp((Fr - gg.fr) / (gg.frMax - gg.fr), 0, 1)), gal);
      phases = phases.map(function (p, i) { var d = gg.phases[i] - p; d -= Math.round(d); return frac(p + d * gal + 1); });
    }
    var moving = smooth(0.02, 0.25, S.v / Math.sqrt(G * Leff));
    // walk: the hip vaults over the planted foot like an inverted pendulum (highest mid-step)
    var q4 = Math.min(stride / 4, 0.8 * Leff);
    var Aw = 0.3 * (Leff - Math.sqrt(Leff * Leff - q4 * q4));
    // run: the leg is a spring (lowest mid-step); bounce size follows from step time and gravity
    var Ts = period / 2;
    var Ar = Math.min(G * Ts * Ts / (TAU * TAU) * (1 + 2 * Math.max(0, 0.5 - duty)), 0.09 * Leff);
    return { Leff: Leff, Tn: Tn, Fr: Fr, run: run, stride: stride, period: period, duty: duty, phases: phases, moving: moving, Aw: Aw, Ar: Ar, gal: gal };
  }

  // Idle motion is built from three harmonics of one period, so an idle clip loops exactly.
  function idleNoise(t, P, k) {
    var a = TAU * t / P;
    return (Math.sin(a + k) + 0.6 * Math.sin(2 * a + 2.3 * k) + 0.4 * Math.sin(3 * a + 4.1 * k)) / 2;
  }
  function idlePeriod(ch) { return 2.1 * TAU * Math.sqrt(ch.L / G); }

  function ease(s, snap) {
    var sm = s * s * s * (s * (6 * s - 15) + 10);
    return lerp(s, sm, 0.4 + 0.6 * snap);
  }

  // ------------------------------------------------------------------ frames
  /* The body has a place on the ground (px, pz) and a heading h (0 = facing +x, positive turns
     towards +z, the character's right). All the walking maths is done in the body's own frame,
     x forward and z to the right, and the finished pose is turned into the world at the end.
     Feet, though, are remembered in the world, so a planted foot stays put while the body turns. */
  function wrapPi(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
  function frameNow(S) { return { ox: S.x, px: S.px, pz: S.pz, c: Math.cos(S.h), s: Math.sin(S.h), h: S.h }; }
  function frameOf(S) { return S.mode === 'ladder' || S.mode === 'ledge' ? S.ladFrame : S.mode === 'ragdoll' ? S.rag.frame : frameNow(S); }
  function l2w(fr, p) { var x = p[0] - fr.ox, z = p[2] || 0; return [fr.px + x * fr.c - z * fr.s, p[1], fr.pz + x * fr.s + z * fr.c]; }
  function w2l(fr, p) { var x = p[0] - fr.px, z = (p[2] || 0) - fr.pz; return [fr.ox + x * fr.c + z * fr.s, p[1], -x * fr.s + z * fr.c]; }
  var DIR_KEYS = { gaze: 1, u: 1, f: 1, dir: 1, axis: 1, up: 1, side: 1, t1: 1, t2: 1 };
  function poseToWorld(o, fr, key) {
    if (Array.isArray(o)) {
      if (o.length === 3 && typeof o[0] === 'number') return DIR_KEYS[key] ? [o[0] * fr.c - o[2] * fr.s, o[1], o[0] * fr.s + o[2] * fr.c] : l2w(fr, o);
      return o.map(function (v) { return poseToWorld(v, fr, key); });
    }
    if (o && typeof o === 'object') { var r = {}; for (var k in o) r[k] = poseToWorld(o[k], fr, k); return r; }
    return o;
  }

  // ------------------------------------------------------------------ state
  function sp(x) { return { x: x || 0, v: 0 }; }
  function createState(ch, env) {
    var g0 = env.terrain(0);
    var S = {
      t: 0, x: 0, y: g0 + ch.rootHeight, v: 0, a: 0, phase: 0, run: 0, runWant: false, standing: true, crouch: 0,
      gRef: sp(g0), pitch: sp(0), reachDrop: 0, lean: sp(0), aim: sp(0), armed: sp(1),
      kick: [sp(0), sp(0)], rise: sp(0), flash: [0, 0], cool: 0, gun: 0, pack: sp(0), lastY: g0 + ch.rootHeight,
      mode: 'ground', lad: null, events: [], stats: null, pose: null,
      jump: null, hop: sp(0), airB: 0, idleT: 0,
      px: 0, pz: 0, h: 0, om: 0, kv: [0, 0], bank: sp(0), side: sp(0), flinch: sp(0), flinchDir: -1, local: null, ladFrame: null,
      twist: sp(0), kit: ch.mount.kit || null, ammo: ch.mount.kit ? fullAmmo(ch.mount.kit) : null, act: null,
      jaw: sp(0), gal: 0, galWant: false, chains: {}, vl: null, tv: [1, 0],
      guard: sp(0), block: sp(0), stance: sp(0), carry: null, mv: [0, 0], actCrouch: 0, actBack: 0, acTw: 0, hoRel: [null, null]
    };
    S.legs = ch.legs.map(function (l) {
      return { ball: [l.rest[0], env.terrain(l.rest[0]), l.rest[1]], swing: null, alpha: 0, strike: 0, slope: 0, fwd: 0, drop: 0, refY: g0, w: null, hd: 0 };
    });
    return S;
  }

  function slopeAt(terrain, x, w) { return clamp(Math.atan2(terrain(x + w) - terrain(x - w), 2 * w), -0.45, 0.45); }

  // ------------------------------------------------------- ground movement
  function stepGround(S, ch, inp, st, env, dt) {
    var L = ch.L, i, lg, ld;
    S.t += dt;
    var Tn0 = TAU * Math.sqrt(L / G);
    // steering: a turn rate, limited by sideways grip at speed and by how fast the feet can shuffle on the spot.
    // inp.heading asks for a direction (the body slows down for a sharp turn); inp.steer (-1..1) just turns.
    var he = inp.heading != null ? wrapPi(inp.heading - S.h) : 0;
    // on the move: no tighter than about one leg length of radius, no more than a third of g sideways.
    // on the spot: as fast as the feet can shuffle, easing off whenever a foot falls behind
    var omSpot = 5 / Tn0 * clamp(1.8 - (S.lag || 0) / 0.2, 0.2, 1) * clamp(1 - S.v / (0.5 * Math.sqrt(G * L)), 0, 1);
    var omMax = Math.max(omSpot, S.v > 0.01 ? Math.min(0.35 * G / S.v, S.v / (1.1 * L)) : 0) * clamp(1 - S.reachDrop / (0.05 * L), 0.1, 1);   // and never faster than the legs can reach
    var omT = inp.heading != null ? clamp(he * 6, -omMax, omMax) : clamp(inp.steer || 0, -1, 1) * omMax;
    if (S.jump && S.jump.stage === 'air') omT = S.om;
    S.om += (omT - S.om) * decay(16 / Tn0, dt);
    S.h = wrapPi(S.h + S.om * dt);
    var hc = Math.cos(S.h), hs = Math.sin(S.h);
    function toW(p) { var x = p[0] - S.x, z = p[2] || 0; return [S.px + x * hc - z * hs, p[1], S.pz + x * hs + z * hc]; }
    function toL(p) { var x = p[0] - S.px, z = (p[2] || 0) - S.pz; return [S.x + x * hc + z * hs, p[1], -x * hs + z * hc]; }
    // ground height under a point given in the body's frame
    var terrain = function (lx, lz) { return env.terrain(S.px + (lx - S.x) * hc - (lz || 0) * hs, S.pz + (lx - S.x) * hs + (lz || 0) * hc); };
    // a blow that does not floor the body: it slides, the torso snaps away, the knees give, the aim is thrown
    if (inp.hit) {
      var hi = inp.hit.impulse, kq = Math.sqrt(L / 0.92), hf = hi[0] * hc + (hi[2] || 0) * hs, hlat = -hi[0] * hs + (hi[2] || 0) * hc, hm = Math.sqrt(hf * hf + hlat * hlat);
      S.kv[0] += 0.6 * kq * hi[0]; S.kv[1] += 0.6 * kq * (hi[2] || 0);
      S.lean.v += 7 * hf / kq; S.hop.v -= 1.1 * hm * kq; S.side.v += 1.2 * hlat * kq; S.rise.v += 8 * hm; S.flinch.v += 16 * hm; S.flinchDir = hf < 0 ? -1 : 1;
      S.events.push({ type: 'hit' });
    }
    // an action can ask for a deeper crouch than the player does (squatting down to a crate)
    S.crouch += (Math.max(clamp(inp.crouch || 0, 0, 1), S.actCrouch || 0) - S.crouch) * decay(14 / Tn0, dt);
    var vT = clamp(inp.speed || 0, 0, ch.vmax * (1 - 0.65 * Math.min(S.crouch, 1)));
    if (S.carry) vT = S.act ? 0 : Math.min(vT, 0.62 * Math.sqrt(G * L));       // a load is walked, not run; lifting and setting down are done standing
    var kitNow = heldKit(S, ch);
    if (kitNow && kitNow.pace && S.armed.x > 0.5) vT = Math.min(vT, kitNow.pace * Math.sqrt(G * L));       // nor is a case on wheels run with
    if (inp.heading != null) vT *= clamp(1.5 - Math.abs(he) / 0.8, 0, 1);      // brake for a sharp turn, pivot, then go
    var aMax = (vT > S.v ? 0.4 : 0.65) * G;
    if (S.jump && S.jump.pounce && S.jump.stage === 'land') aMax = 1.3 * G;      // dig in after a pounce
    var dv = clamp(vT - S.v, -aMax * dt, aMax * dt), dx = 1, dz = 0;
    if (S.jump && S.jump.stage === 'air') dv = 0;              // no steering in the air
    if (inp.dir || S.vl) {
      /* Travel in any direction while facing another: inp.dir is the way to go, measured from the way the body
         faces (0 forwards, pi backwards, +pi/2 to its right). The velocity is steered as a vector, so going
         from forwards to backwards slows, stops and sets off again. Backwards is slower than forwards and
         sideways slower still. (dx, dz) is the direction of travel in the body's frame. */
      var dA = inp.dir || 0, cA = Math.cos(dA), sA = Math.sin(dA), vK = 1 - 0.62 * sA * sA - (cA < 0 ? 0.5 * cA * cA : 0);
      if (!S.vl) S.vl = [S.v, 0];
      var tvx = vT * vK * cA - S.vl[0], tvz = vT * vK * sA - S.vl[1], tl = Math.sqrt(tvx * tvx + tvz * tvz), am = 0.55 * G * dt;
      if (!(S.jump && S.jump.stage === 'air')) { if (tl > am) { tvx *= am / tl; tvz *= am / tl; } S.vl[0] += tvx; S.vl[1] += tvz; }
      var nv = Math.sqrt(S.vl[0] * S.vl[0] + S.vl[1] * S.vl[1]);
      dv = nv - S.v;
      if (nv > 1e-3) S.tv = [S.vl[0] / nv, S.vl[1] / nv];
      dx = S.tv[0]; dz = S.tv[1];
      if (!inp.dir && Math.abs(S.vl[1]) < 1e-4 && S.vl[0] >= 0 && tl < 1e-6) { S.vl = null; dx = 1; dz = 0; }       // going straight ahead again
    }
    S.a += (dv / dt - S.a) * decay(30 / Tn0, dt);
    S.v += dv;
    var gp = gaitParams(ch, S, st, dt);
    // jump: crouch (prep), leave the ground on a ballistic arc (air), absorb the landing with a spring (land)
    var J = S.jump, n = S.legs.length;
    if (inp.jump && !J && ch.jumpH && !S.carry && !(S.act && S.act.name !== 'reload')) J = S.jump = { stage: 'prep', t: 0, vy: 0, y: 0, v0: Math.sqrt(2 * G * ch.jumpH * L), phi: 0, landed: false };
    if (inp.pounce && !J && ch.beast && !S.act) {
      // a leap onto something: a flat arc along the heading, far enough to bring the jaws down on the target
      var pt0 = inp.pounce.target ? toL(inp.pounce.target) : [S.x + 3.4 * L, 0, 0];
      // (the muzzle is well ahead of the hips when it lands, and a running start covers ground before the feet leave it)
      var pdist = clamp(pt0[0] - S.x - 1.3 * L - S.v * (0.11 * Tn0 + 0.12), 1.2 * L, 5.5 * L), pv0 = Math.sqrt(0.3 * G * pdist);
      J = S.jump = { stage: 'prep', t: 0, vy: 0, y: 0, v0: pv0, phi: 0, landed: false, pounce: true, vx: pdist * G / (2 * pv0), struck: false };
    }
    if (J) {
      J.t += dt;
      if (J.stage === 'prep' && J.t > 0.11 * Tn0) {
        // push off: constant thrust over the crouch depth, so take-off speed is reached at standing height
        J.stage = 'push'; J.t = 0; J.acc = J.v0 * J.v0 / (2 * Math.max(-S.hop.x, 0.05 * L)); S.hop.v = 0;
      }
      if (J.stage === 'push' && S.hop.x >= 0) {
        J.stage = 'air'; J.t = 0; J.vy = Math.min(S.hop.v, 1.1 * J.v0); J.y = S.y; S.reachDrop = 0;
        if (J.pounce) { S.v = Math.max(S.v, J.vx); S.a = 0; }
        J.phi = frac(0.02 - gp.phases[0] + 1);                 // the stride phase to land in
        for (i = 0; i < n; i++) {
          lg = S.legs[i];
          lg.swing = { air: true, s: 0, manual: true, rate: 0, start: lg.ball.slice(), alpha0: lg.alpha, tx: lg.ball[0], ty: lg.ball[1] };
        }
        S.events.push({ type: 'jump' });
      }
    }
    var air = !!J && J.stage === 'air';
    if (air) {
      J.vy -= G * dt; J.y += J.vy * dt;
      var gl = 0;
      for (i = 0; i < n; i++) gl += terrain(S.x + ch.legs[i].rest[0]);
      gl /= n;
      if (J.vy < 0 && J.y <= gl + ch.rootHeight * (1 - ch.crouchDrop * S.crouch)) {
        J.stage = 'land'; J.t = 0; J.landed = true; air = false;
        S.gRef.x = gl; S.gRef.v = 0; S.phase = J.phi;
        for (i = 0; i < n; i++) {
          lg = S.legs[i];
          var lx = lg.ball[0], ly = terrain(lx);
          lg.ball = [lx, ly, lg.ball[2]]; lg.swing = null; lg.w = null; lg.hd = S.h; lg.strike = 0; lg.alpha = 0; lg.refY = ly; lg.drop = 0;
          lg.slope = ch.legs[i].foot ? slopeAt(terrain, lx, 0.5 * ch.legs[i].foot.fb) : 0;
          var wj = toW(lg.ball); S.events.push({ type: 'land', leg: i, x: wj[0], y: ly, z: wj[2], hd: S.h, side: ch.legs[i].side });
        }
      }
    }
    S.airB += ((air ? 1 : 0) - S.airB) * decay(24 / Tn0, dt);
    var standing = vT <= 1e-4 && S.v < 0.05 * Math.sqrt(G * L);
    if (standing && !S.standing) {
      // stopping: let any foot in the air finish its step on its own clock
      for (i = 0; i < S.legs.length; i++) {
        var sw0 = S.legs[i].swing;
        if (sw0 && !sw0.manual) {
          var tr = clamp((1 - sw0.s) * (1 - gp.duty) * gp.period, 0.06 * gp.Tn, 0.2 * gp.Tn);
          sw0.manual = true; sw0.rate = Math.max(1 - sw0.s, 0.05) / tr;
        }
      }
    }
    if (!standing && S.standing) {
      var anySwing = S.legs.some(function (l) { return l.swing; });
      if (!anySwing) S.phase = frac(gp.duty - gp.phases[0] + 1);  // first leg is about to lift
    }
    S.standing = standing;
    if (!standing && !air) S.phase = frac(S.phase + dt / gp.period);
    S.x += S.v * dx * dt;
    var kd = Math.exp(-dt / (0.12 * Tn0));
    // drift: slow movement in any direction without turning to face it (footwork, sidesteps, backing off).
    // inp.move = [vx, vz] in the world; used only while not walking, and the feet shuffle to keep up
    var mvx = standing && inp.move ? inp.move[0] || 0 : 0, mvz = standing && inp.move ? inp.move[1] || 0 : 0;
    var mvMax = 0.33 * Math.sqrt(G * L), mvm = Math.sqrt(mvx * mvx + mvz * mvz), kmv = decay(20 / Tn0, dt);
    if (mvm > mvMax) { mvx *= mvMax / mvm; mvz *= mvMax / mvm; }
    S.mv[0] += (mvx - S.mv[0]) * kmv; S.mv[1] += (mvz - S.mv[1]) * kmv;
    var mvl = [S.mv[0] * hc + S.mv[1] * hs, -S.mv[0] * hs + S.mv[1] * hc], mvs = Math.sqrt(mvl[0] * mvl[0] + mvl[1] * mvl[1]);
    S.px += (hc * S.v * dx - hs * S.v * dz + S.kv[0] + S.mv[0]) * dt; S.pz += (hs * S.v * dx + hc * S.v * dz + S.kv[1] + S.mv[1]) * dt; S.kv[0] *= kd; S.kv[1] *= kd;
    // fighting stance: the feet stand staggered, one ahead and one behind, while on guard
    spring(S.stance, standing && ch.fight && S.guard.x > 0.5 ? 1 : 0, 14, 1, dt);
    var stK = ch.fight ? clamp(S.stance.x, 0, 1) : 0;
    function restOf(k) { var r0 = ch.legs[k].rest, so = stK > 0 ? ch.fight.stance[k] : null; return so ? [r0[0] + stK * so[0], r0[1] + stK * so[1]] : r0; }
    // feet are remembered in the world: find where each one is in the body's frame this step
    for (i = 0; i < S.legs.length; i++) {
      lg = S.legs[i]; var swp = lg.swing;
      if (swp && !swp.air) { if (!swp.startW) swp.startW = lg.w ? lg.w.slice() : toW(swp.start); swp.start = toL(swp.startW); }
      else if (!swp && lg.w) lg.ball = toL(lg.w);
    }
    S.idleT = standing && !J && Math.abs(S.om) < 0.2 ? S.idleT + dt : 0;

    var stanceTravel = gp.duty * gp.stride;
    for (i = 0; i < S.legs.length; i++) {
      lg = S.legs[i]; ld = ch.legs[i];
      if (air) {
        // feet trail the body: legs stretch at take-off, tuck at the top, reach down to land
        var psiL = frac(J.phi + gp.phases[i]);
        var offx = psiL < gp.duty ? stanceTravel * (0.5 - psiL / gp.duty) : -0.3 * stanceTravel;
        var hStand = ch.rootHeight + ld.attach[1];
        var lat = ld.rest[1] - ld.attach[2], lmx = 0.96 * (ld.upper + ld.lower);
        var ext = clamp((Math.sqrt(Math.max(lmx * lmx - lat * lat, 0)) + (ld.foot ? ld.foot.ah : 0)) / hStand, 1, 1.1);
        var tuck = Math.max(0, 0.3 * (1 - Math.pow(J.vy / J.v0, 2)));
        if (J.pounce) offx += ch.beast.mid && J.vy < 0 ? 0.22 * L : ld.attach[0] > 0 ? (J.vy < 0 ? 0.50 : 0.30) * L : -0.30 * L * Math.max(0, J.vy / J.v0);    // forelegs reach for the landing, hind legs trail
        var txa = S.x + ld.rest[0] + offx * dx;
        var tya = Math.max(J.y + ld.attach[1] - hStand * ext * (1 - tuck), terrain(txa) + 0.01 * L);
        var kA = decay(34 / Tn0, dt);
        lg.ball = [lerp(lg.ball[0] + S.v * dt, txa, kA), lerp(lg.ball[1], tya, kA), ld.rest[1]];
        lg.alpha = ld.foot ? 0.12 + 0.6 * Math.max(0, J.vy / J.v0) : 0;
        var tl = (J.vy + Math.sqrt(J.vy * J.vy + 2 * G * Math.max(0, J.y - (S.gRef.x + ch.rootHeight)))) / G;
        lg.swing.tx = txa + S.v * tl; lg.swing.ty = terrain(lg.swing.tx);
        lg.refY = terrain(S.x + ld.rest[0]); lg.psi = psiL; lg.drop = 0;
        continue;
      }
      var psi = frac(S.phase + gp.phases[i]);
      lg.psi = psi;
      lg.drop *= Math.exp(-dt / 0.03);
      if (!lg.swing && !standing && psi >= gp.duty) {
        lg.swing = { s: 0, psi0: Math.min(psi, 0.97), start: lg.ball.slice(), alpha0: lg.alpha, manual: false, rate: 0, ty: lg.ball[1] };
      }
      var sw = lg.swing;
      if (sw) {
        var done = false;
        if (sw.manual) { sw.s += sw.rate * dt; if (sw.s >= 1) { sw.s = 1; done = true; } }
        else if (psi < gp.duty && !sw.early) { sw.s = 1; done = true; }
        else { sw.s = Math.max(sw.s, (psi - sw.psi0) / (1 - sw.psi0)); if (psi >= gp.duty) sw.early = false; }
        var tRem = done ? 0 : sw.manual ? (1 - sw.s) / sw.rate : (1 - psi) * gp.period;
        // land ahead of the hip so that mid-stance ends up under it; allow for speeding up or slowing down
        var vL = clamp(S.v + S.a * tRem, 0, ch.vmax);
        var lead = 0.5 * gp.duty * gp.stride * Math.pow(clamp(vL / Math.max(S.v, 0.05 * Math.sqrt(G * L)), 0.4, 1.8), 0.6);
        if (sw.manual) {
          var pl = frac(psi + tRem / gp.period);
          lead = standing || pl >= gp.duty ? 0 : S.v * gp.period * (gp.duty - pl - gp.duty / 2);
        }
        // where the foot's place under the body will be when it lands: the body will have moved on and turned
        var fwd = S.v * tRem + 0.5 * S.a * tRem * tRem * (standing ? 0 : 1), ang = S.om * tRem, ca = Math.cos(ang), sa = Math.sin(ang);
        var rr = restOf(i), rx = rr[0] + lead * dx, rz = rr[1] + lead * dz, ch2 = Math.cos(ang / 2), sh2 = Math.sin(ang / 2);
        if (dz) rz = ld.side > 0 ? Math.max(rz, 0.02 * L) : Math.min(rz, -0.02 * L);        // going sideways, a foot closes up to the other but does not cross it
        var tx = S.x + fwd * (dx * ch2 - dz * sh2) + rx * ca - rz * sa, tz = fwd * (dx * sh2 + dz * ch2) + rx * sa + rz * ca;
        if (standing && mvs > 1e-4) { var ahead = tRem + 0.09 * gp.Tn; tx += mvl[0] * ahead; tz += mvl[1] * ahead; }   // drifting: step to where the body is going
        var ty = terrain(tx, tz);
        sw.tx = tx; sw.ty = ty; sw.tz = tz;
        var e = ease(sw.s, st.snap);
        var bx = lerp(sw.start[0], tx, e), bz = lerp(sw.start[2], tz, e);
        var dist = Math.sqrt(Math.pow(tx - sw.start[0], 2) + Math.pow(tz - sw.start[2], 2));
        var lift = L * lerp(ch.liftWalk, ch.liftRun, S.run) * st.step * clamp(dist / (0.3 * L), 0.2, 1) * (sw.manual ? 0.7 : 1);
        var up = ty > sw.start[1];
        var ey = up ? 1 - Math.pow(1 - sw.s, 3) : Math.pow(sw.s, 3);    // rise early onto a ledge, drop late off one
        var eY = lerp(e, ey, clamp(Math.abs(ty - sw.start[1]) / (0.1 * L), 0, 1));
        var by = lerp(sw.start[1], ty, eY) + lift * Math.sin(Math.PI * sw.s);
        by = Math.max(by, terrain(bx, bz) + 0.004 * L);
        if (ld.foot) {
          var landA = -ld.foot.strike * (1 - 0.8 * S.run) * clamp(dist / (0.3 * L), 0, 1) * (sw.manual ? 0.3 : 1);
          lg.alpha = sw.alpha0 * (1 - smooth(0, 0.55, sw.s)) + landA * smooth(0.5, 0.95, sw.s);
        }
        if (done) {
          var gy = terrain(bx, bz);
          lg.drop = by - gy; lg.ball = [bx, gy, bz]; lg.swing = null; lg.w = null; lg.hd = S.h;
          lg.strike = lg.alpha; lg.slope = ld.foot ? slopeAt(terrain, bx, 0.5 * ld.foot.fb) : 0;
          lg.refY = gy;
          var wl = toW(lg.ball); S.events.push({ type: 'land', leg: i, x: wl[0], y: gy, z: wl[2], hd: S.h, side: ld.side });
        } else { lg.ball = [bx, by, bz]; lg.refY = ty; }
      } else lg.refY = lg.ball[1];
    }
    if (!standing) S.lag = 0;
    if (standing && !S.legs.some(function (l) { return l.swing; })) {
      // standing still (or turning on the spot): bring the worst-placed foot back under the body.
      // A foot counts as badly placed when it is off its spot or still points the old way. Feet that mirror each other
      // are equally badly placed, to the last digit or two: of those the first is taken (a later one has to be worse by
      // more than a billionth of a leg), so that every language and every maths library picks the same.
      var worst = -1, worstD = 0.09 * L, offs = [];
      for (i = 0; i < S.legs.length; i++) {
        var bl = S.legs[i].ball, rs = restOf(i);
        var off = Math.sqrt(Math.pow(bl[0] - (S.x + rs[0]), 2) + Math.pow(bl[2] - rs[1], 2)) + 0.2 * L * Math.abs(wrapPi(S.h - S.legs[i].hd));
        offs.push(off);
        if (off > worstD + (worst < 0 ? 0 : 1e-9 * L)) { worstD = off; worst = i; }
      }
      S.lag = Math.max.apply(null, offs) / L;
      for (i = 0; worst >= 0 && i < S.legs.length; i++) {
        // legs that move together in the gait step together here too (the spider's tripods)
        var grp = (ch.gait.run || ch.gait.walk).phases;
        if (i !== worst && (offs[i] < 0.045 * L || Math.abs(wrapPi(TAU * (grp[i] - grp[worst]))) > 0.1)) continue;
        lg = S.legs[i];
        lg.swing = { s: 0, psi0: 0, start: lg.ball.slice(), alpha0: lg.alpha, manual: true, rate: 1 / ((0.17 - 0.05 * clamp(mvs / (0.5 * mvMax), 0, 1)) * gp.Tn), tx: lg.ball[0], ty: lg.ball[1], tz: lg.ball[2] };
      }
    }

    // body height follows the feet, softened by a spring
    var meanY = 0, mx = 0;
    for (i = 0; i < S.legs.length; i++) { meanY += S.legs[i].refY; mx += ch.legs[i].rest[0]; }
    meanY /= S.legs.length; mx /= S.legs.length;
    spring(S.gRef, meanY, 27 / Tn0, 1, dt);
    var sxx = 0, sxy = 0;
    for (i = 0; i < S.legs.length; i++) {
      var rx = ch.legs[i].rest[0] - mx; sxx += rx * rx; sxy += rx * (S.legs[i].refY - meanY);
    }
    var pitchT = sxx > 1e-6 ? clamp(Math.atan(sxy / sxx), -0.4, 0.4) : 0;
    if (air && J.pounce) pitchT = clamp(0.8 * Math.atan2(J.vy, Math.max(S.v, 0.5)), -0.45, 0.45);       // nose follows the arc
    spring(S.pitch, pitchT, 20 / Tn0, 1, dt);
    var pitch = S.pitch.x, flex = 0;
    if (ch.beast && gp.gal > 1e-3) {
      // gallop: the back stretches out as the hind legs drive and bunches up in the air; the body rocks from hind to fore
      flex = -ch.beast.flex * gp.gal * Math.cos(TAU * (S.phase - 0.42));
      pitch += ch.beast.rock * gp.gal * Math.cos(TAU * (S.phase - 0.10));
    }
    var cp = Math.cos(pitch), sn = Math.sin(pitch);

    var h = ch.rootHeight * (1 - ch.crouchDrop * S.crouch) * (1 - ch.runDrop * gp.run);
    var phiMid = gp.duty / 2 - gp.phases[0];
    var c = Math.cos(2 * TAU * (S.phase - phiMid));
    c = (c < 0 ? -1 : 1) * Math.pow(Math.abs(c), 1 - 0.6 * st.snap);
    var bob = st.bounce * ch.bob * gp.moving * ((1 - gp.run) * gp.Aw - gp.run * gp.Ar) * c;
    if (gp.gal > 1e-3) bob = lerp(bob, st.bounce * ch.bob * 0.075 * L * Math.cos(TAU * (S.phase - 0.95)), gp.gal);   // one rise and fall a stride, highest in flight
    var sway = 0.02 * L * ch.sway * (1 - gp.run) * gp.moving * Math.cos(TAU * (S.phase - phiMid)) * ch.legs[0].side;
    // idle: slow weight shifts; the planted feet stay put, so the knees and hips do the work
    // style.still (0..1) takes the life out of a standing body: no shifting of weight, no breathing, no looking about
    var idle = (1 - gp.moving) * (J ? 0 : 1) * (1 - (st.still || 0)), P = idlePeriod(ch);
    var ix = 0.012 * L * idle * idleNoise(S.t, P, 1.0) - (S.actBack || 0), iy = -0.008 * L * idle * (1 + idleNoise(S.t, P, 3.0));
    sway += 0.03 * L * idle * idleNoise(S.t, P, 2.0);
    // lean into a turn, from the feet up, by the angle that balances the sideways pull
    spring(S.bank, clamp(Math.atan(S.v * S.om / G) * st.lean, -0.4, 0.4), 30 / Tn0, 1, dt);
    spring(S.side, 0, 26 / Tn0, 0.7, dt);
    var bankT = Math.tan(S.bank.x), sway0 = sway + S.side.x;
    sway = sway0 + bankT * h;
    if (J && J.stage === 'prep') spring(S.hop, -0.22 * h, 30 / Tn0, 1, dt);
    else if (J && J.stage === 'push') { S.hop.v += J.acc * dt; S.hop.x += S.hop.v * dt; }
    else if (!air) {
      if (J && J.landed) { J.landed = false; S.hop.x = J.y - (S.gRef.x + h + bob); S.hop.v = J.vy; }
      spring(S.hop, 0, 21 / Tn0, 0.75, dt);
      if (J && J.stage === 'land' && J.t > 0.3 * Tn0 && Math.abs(S.hop.x) < 0.01 * L) S.jump = null;
    } else { S.hop.x = 0; S.hop.v = 0; }
    S.hop.x = Math.max(S.hop.x, -0.45 * h);
    var y0 = air ? J.y : S.gRef.x + h + bob + iy + S.hop.x;

    var hips = [], ankles = [], need = 0;
    for (i = 0; i < S.legs.length; i++) {
      lg = S.legs[i]; ld = ch.legs[i];
      var at = ld.attach;
      var cpl = cp, snl = sn;
      if (flex) { var fa = pitch + (at[0] < 0 ? flex : -flex); cpl = Math.cos(fa); snl = Math.sin(fa); }      // each end of a bending spine carries its own legs
      var hip = [S.x + ix + at[0] * cpl - at[1] * snl, y0 + at[0] * snl + at[1] * cpl, at[2] + sway];
      var ball = [lg.ball[0], lg.ball[1] + lg.drop, lg.ball[2]];
      var ankle = ball, heel = null, toe = null;
      if (ld.foot) {
        var F = ld.foot;
        if (!lg.swing) {
          lg.strike *= Math.exp(-dt / (0.035 * gp.Tn));
          var behind = (hip[0] - ball[0]) / L;
          lg.alpha = lg.strike + F.heelLift * smooth(0.2, 0.62, behind) * (0.4 + 0.6 * gp.moving);
        }
        var al = lg.alpha, rot = al - (lg.swing ? 0 : lg.slope);
        var ca = Math.cos(rot), sa = Math.sin(rot);
        var b2 = [ball[0], ball[1] + Math.max(0, (F.fb + F.hb) * Math.sin(-al)), ball[2]];   // toes up: pivot on the heel
        ankle = [b2[0] - F.fb * ca + F.ah * sa, b2[1] + F.fb * sa + F.ah * ca, b2[2]];
        heel = [b2[0] - (F.fb + F.hb) * ca, b2[1] + (F.fb + F.hb) * sa, b2[2]];
        toe = rot > 0 ? [b2[0] + F.toe, b2[1], b2[2]] : [b2[0] + F.toe * ca, b2[1] - F.toe * sa, b2[2]];
        ball = b2;
      }
      hips.push(hip); ankles.push({ ankle: ankle, heel: heel, toe: toe, ball: ball });
      if (!lg.swing) {
        var Lmax = 0.985 * (ld.upper + ld.lower);
        var dh2 = Math.pow(ankle[0] - hip[0], 2) + Math.pow(ankle[2] - hip[2], 2);
        var top = ankle[1] + Math.sqrt(Math.max(Lmax * Lmax - dh2, 0));
        lg.over = hip[1] - top; lg.behind = hip[0] - ankle[0];
        need = Math.max(need, lg.over);
      } else lg.over = 0;
      var raw = clamp((lg.ball[0] - hip[0]) / (0.5 * stanceTravel + 0.08 * L), -1, 1);
      lg.fwd += (raw - lg.fwd) * decay(40 / Tn0, dt);
    }
    // a trailing foot that has run out of reach steps early, as long as enough other feet are down
    if (!standing) {
      var down = S.legs.filter(function (l) { return !l.swing; }).length;
      for (i = 0; i < S.legs.length; i++) {
        lg = S.legs[i];
        if (!lg.swing && lg.over > 0.03 * L && lg.behind > 0 && down - 1 >= Math.max(1, (S.legs.length >> 1) - 1) && lg.psi < gp.duty - 0.02) {
          if (lg.psi > gp.duty - 0.2) {
            // close to its normal lift-off: simply start the real step a little early
            lg.swing = { s: 0, psi0: lg.psi, early: true, start: lg.ball.slice(), alpha0: lg.alpha, manual: false, rate: 0, tx: lg.ball[0], ty: lg.ball[1], tz: lg.ball[2] };
          } else {
            // far out of step (a gait change): one quick corrective step
            lg.swing = { s: 0, psi0: 0, start: lg.ball.slice(), alpha0: lg.alpha, manual: true, rate: 1 / Math.max(0.7 * (1 - gp.duty) * gp.period, 0.08 * gp.Tn), tx: lg.ball[0], ty: lg.ball[1], tz: lg.ball[2] };
          }
          down--;
        }
      }
    }
    // if a planted leg still cannot reach, the body sinks instead of the foot sliding
    need = Math.min(need, 0.4 * h);
    S.reachDrop += (need - S.reachDrop) * (need > S.reachDrop ? decay(50, dt) : decay(1 / (0.08 * gp.Tn), dt));
    S.y = y0 - S.reachDrop;

    var legs = [];
    for (i = 0; i < S.legs.length; i++) {
      lg = S.legs[i]; ld = ch.legs[i];
      hips[i][1] -= S.reachDrop;
      var k = ik2(hips[i], ankles[i].ankle, ld.upper, ld.lower, ld.pole);
      legs.push({
        hip: hips[i], knee: k.mid, ankle: k.end, heel: ankles[i].heel, toe: ankles[i].toe, ball: ankles[i].ball,
        planted: !lg.swing, target: lg.swing ? [lg.swing.tx, lg.swing.ty, lg.swing.tz === undefined ? ld.rest[1] : lg.swing.tz] : null, side: ld.side
      });
    }

    // backpack / tail: a loose spring dragged along by the body's vertical motion
    var vy = (S.y - S.lastY) / dt; S.lastY = S.y;
    S.pack.v -= (vy - (S.packVy || 0)) * 0.6; S.packVy = vy;
    spring(S.pack, 0, 60 / Tn0, 0.35, dt);

    S.stats = {
      Fr: gp.Fr, stride: gp.stride, period: gp.period, duty: gp.duty, run: gp.run, phases: gp.phases, v: S.v,
      gait: air ? 'Jump' : standing || S.v < 0.02 ? 'Standing' : gp.gal > 0.5 ? 'Gallop' : gp.run > 0.5 ? (ch.kind === 'quad' && S.legs.length > 2 ? 'Trot' : 'Run') : 'Walk',
      idlePeriod: P,
      steps: S.v > 0.02 ? 60 * S.legs.length / gp.period : 0,
      air: ch.gait.run ? Math.max(0, 1 - 2 * gp.duty) : 0
    };
    var accLean = Math.atan(S.a / G) * 0.55 * st.lean;
    S.local = upperBody(S, ch, inp, st, dt, legs, {
      root: [S.x + ix, S.y, sway], pitch: pitch, gp: gp, Tn: Tn0, idle: idle, P: P, bank: bankT, sway0: sway0,
      aim: inp.aim && !S.carry ? toL([inp.aim[0], inp.aim[1], inp.aim.length > 2 ? inp.aim[2] : S.pz]) : null,
      toL: toL, toW: toW, terrain: terrain, flex: flex,
      drift: [mvl[0] + S.kv[0] * hc + S.kv[1] * hs, mvl[1] - S.kv[0] * hs + S.kv[1] * hc],
      prep: J && (J.stage === 'prep' || J.stage === 'push') ? clamp(-S.hop.x / (0.22 * h), 0, 1) : 0,
      leanBase: ((0.03 + 0.05 * Math.min(gp.Fr, 2) + 0.09 * gp.run) * st.lean * dx + accLean * dx + 0.42 * S.crouch) - 0.8 * S.hop.x / h - 0.06 * S.airB
    });
    S.local.heading = S.h;
    if (ch.fly) S.local.wings = wingPose(ch, S.local.root, S.local.axis, S.local.up, 0, 0, 1);
    for (i = 0; i < S.legs.length; i++) { lg = S.legs[i]; if (!lg.swing && !lg.w) lg.w = toW(lg.ball); }
    S.stats.heading = S.h; S.stats.turn = S.om; S.stats.ammo = S.ammo ? S.ammo.slice() : null; S.stats.kit = S.kit; S.stats.action = S.act ? S.act.name : null;
    S.pose = poseToWorld(S.local, { ox: S.x, px: S.px, pz: S.pz, c: hc, s: hs });
  }

  // ------------------------------------------------- props, kits and firing
  /* A prop is a thing held in the hands. Its points are [along, up] in metres from its rear end, in the
     prop's own plane. A kit is the set of props a character carries. Every prop has a place when held
     ready and a place when stowed: the rifle across the back, pistols in hip holsters. */
  var PROPS = {
    rifle: { len: 0.91, body: 0.57, grip: [0.24, -0.06], gripLow: [0.225, -0.115], fore: [0.53, -0.035], magA: [0.35, -0.035], magB: [0.35, -0.15],
      kick: 1.5, rise: 5, rounds: 30, reload: 1.7, seat: 0.80 },
    pistol: { len: 0.20, body: 0.12, grip: [0.025, -0.03], gripLow: [0.0, -0.11], fore: null, magA: [0.012, -0.045], magB: [0.012, -0.12],
      kick: 1.6, rise: 3, rounds: 12, reload: 1.1, seat: 0.60 },
    // a sword: 'muzzle' is its point, 'body' where the blade starts. A shield: a board held by a grip behind its middle; it faces the way its 'up' points away from
    sword: { len: 0.95, body: 0.15, grip: [0.07, 0], gripLow: [0.13, -0.09], fore: null, magA: [0.13, 0.09], magB: [0.13, -0.09], kick: 0, rise: 0, rounds: 0, reload: 0, seat: 0 },
    shield: { len: 0.62, body: 0.31, grip: [0.31, 0.06], gripLow: [0.31, 0.02], fore: null, magA: [0.26, 0.0], magB: [0.36, 0.0], kick: 0, rise: 0, rounds: 0, reload: 0, seat: 0 },
    // what people who are not soldiers carry. A case by its handle: 'o' and 'muzzle' are its top corners, 'magA' and 'magB' its bottom ones.
    // A case on wheels pulled by its handle: 'o' is the axle, 'body' where the case ends and the handle's rods begin, 'muzzle' the grip;
    // 'magA' to 'magB' is the middle line of the case itself, which lies on the side of the rods away from the ground.
    'case': { len: 0.42, body: 0.21, grip: [0.21, 0.035], gripLow: [0.21, 0], fore: null, magA: [0, -0.30], magB: [0.42, -0.30], kick: 0, rise: 0, rounds: 0, reload: 0, seat: 0 },
    trolley: { len: 0.98, body: 0.56, grip: [0.98, 0], gripLow: [0.90, 0], fore: null, magA: [0.03, 0.11], magB: [0.56, 0.11], kick: 0, rise: 0, rounds: 0, reload: 0, seat: 0, wheel: 0.035 }
  };
  // civil: a kit for people who are not soldiers (and only for them); it is in the hand whether or not weapons are asked for.
  // pace: the fastest it can be taken along, as a Froude number's root (1 is a hurried jog)
  var KITS = { rifle: { props: ['rifle'], rate: 9 }, pistols: { props: ['pistol', 'pistol'], rate: 7 }, sword: { props: ['sword', 'shield'], rate: 0, melee: true },
    hands: { props: [], rate: 0, melee: true, civil: true }, 'case': { props: ['case'], rate: 0, melee: true, civil: true },
    trolley: { props: ['trolley'], rate: 0, melee: true, civil: true, pace: 1.0 } };
  function kitFits(ch, name) { return !!KITS[name] && !KITS[name].civil === !ch.mount.civil; }
  // the three ways to swing a blade: when it lands (as a share of the whole) and how long it takes
  var SWINGS = { slash: { dur: 0.62 }, chop: { dur: 0.70 }, thrust: { dur: 0.55 } };
  function fullAmmo(kitName) { return KITS[kitName].props.map(function (k) { return PROPS[k].rounds; }); }
  function heldKit(S, ch) { return ch.mount.type === 'held' && S.kit ? KITS[S.kit] : null; }

  // A prop at a place: o is its rear end, th its angle in the body's forward-up plane, z how far to the side.
  function propAt(kind, o, th, z) {
    var D = PROPS[kind], d = [Math.cos(th), Math.sin(th), 0], n = [-Math.sin(th), Math.cos(th), 0];
    function pt(a) { return [o[0] + d[0] * a[0] + n[0] * a[1], o[1] + d[1] * a[0] + n[1] * a[1], z]; }
    return { kind: kind, o: [o[0], o[1], z], muzzle: pt([D.len, 0]), body: pt([D.body, 0]), grip: pt(D.grip), gripLow: pt(D.gripLow), fore: D.fore ? pt(D.fore) : null,
      magA: pt(D.magA), magB: pt(D.magB), dir: d, up: n, flash: 0, stow: 0 };
  }
  function stowPlace(kind, k, root, u, f, zc) {
    var down = Math.atan2(-u[1], -u[0]);
    if (kind === 'rifle') return { o: [root[0] + 0.65 * u[0] - 0.22 * f[0], root[1] + 0.65 * u[1] - 0.22 * f[1]], th: down, z: zc - 0.02 };       // muzzle down across the back
    if (kind === 'sword') return { o: [root[0] + 0.10 * u[0] + 0.06 * f[0], root[1] + 0.10 * u[1] + 0.06 * f[1]], th: down - 0.45, z: root[2] - 0.17 };     // in a scabbard on the left hip, point down and back
    if (kind === 'shield') return { o: [root[0] + 0.10 * u[0] - 0.20 * f[0], root[1] + 0.10 * u[1] - 0.20 * f[1]], th: down + Math.PI, z: zc };             // slung on the back, face outwards
    if (kind === 'case') return { o: [root[0] - 0.12 * u[0] - 0.21 * f[0], root[1] - 0.12 * u[1] - 0.21 * f[1]], th: Math.atan2(f[1], f[0]), z: root[2] + 0.20 };    // let go of: against the right thigh
    if (kind === 'trolley') return { o: [root[0] - 0.80 * u[0] - 0.34 * f[0], root[1] - 0.80 * u[1] - 0.34 * f[1]], th: down + Math.PI, z: zc + 0.22 };            // let go of: standing behind
    return { o: [root[0] + 0.05 * u[0] + 0.03 * f[0], root[1] + 0.05 * u[1] + 0.03 * f[1]], th: down + 0.2, z: root[2] + (k === 0 ? 0.15 : -0.15) };  // hip holsters
  }
  function readyPlace(kind, k, chest, u, f, W, kick) {            // kick: how far recoil has driven the prop back (negative)
    if (kind === 'rifle') {
      var a = kick - 0.15;                                         // the butt sits in the shoulder pocket
      return { o: [chest[0] - 0.11 * u[0] + 0.10 * f[0] + Math.cos(W) * a, chest[1] - 0.11 * u[1] + 0.10 * f[1] + Math.sin(W) * a], th: W, z: chest[2] + 0.04 };
    }
    // sword: held low at the right side, point up and forward. shield: upright on the left forearm, in front of the body
    if (kind === 'sword') return { o: [chest[0] - 0.24 * u[0] + 0.20 * f[0], chest[1] - 0.24 * u[1] + 0.20 * f[1]], th: 0.95 + 0.3 * W, z: chest[2] + 0.21 };
    if (kind === 'shield') return { o: [chest[0] - 0.36 * u[0] + 0.30 * f[0], chest[1] - 0.36 * u[1] + 0.30 * f[1]], th: Math.atan2(u[1], u[0]) - 0.12, z: chest[2] - 0.20 };
    // a case hangs level from the right hand at the end of a straight arm; a case on wheels leans from its axle up to the hand held low behind
    if (kind === 'case') return { o: [chest[0] - 0.04 * u[0] - 0.19, chest[1] - 0.04 * u[1] - 0.565], th: 0, z: chest[2] + 0.25 };
    if (kind === 'trolley') return { o: [chest[0] - 0.04 * u[0] - 0.20 - 0.98 * Math.cos(0.85), chest[1] - 0.04 * u[1] - 0.50 - 0.98 * Math.sin(0.85)], th: 0.85, z: chest[2] + 0.22 };
    var r = 0.50 + kick;                                           // arm's length; recoil also flips the muzzle up
    return { o: [chest[0] + 0.03 * u[0] + Math.cos(W) * r, chest[1] + 0.03 * u[1] + Math.sin(W) * r], th: W - 8 * kick, z: chest[2] + (k === 0 ? 0.08 : -0.08) };
  }
  function beltPlace(k, root, u, f) {                               // a pistol brought down to the magazine holder on the belt
    return { o: [root[0] + 0.20 * u[0] + 0.16 * f[0], root[1] + 0.20 * u[1] + 0.16 * f[1]], th: 0.1, z: root[2] + (k === 0 ? 0.12 : -0.12) };
  }
  function mixPlace(a, b, t) { return { o: [lerp(a.o[0], b.o[0], t), lerp(a.o[1], b.o[1], t)], th: a.th + wrapPi(b.th - a.th) * t, z: lerp(a.z, b.z, t) }; }

  // Actions are timed sequences that take over part of the upper body while the legs carry on. Reload is the first.
  // asked: the player asked for it, so full weapons are reloaded too; otherwise only those that are short
  function startReload(S, ch, asked) {
    var kit = heldKit(S, ch), q = [], i;
    if (!kit || kit.melee || S.act || S.armed.x < 0.8 || (S.mode !== 'ground' && S.mode !== 'ride')) return false;
    for (i = 0; i < kit.props.length; i++) if (S.ammo[i] < PROPS[kit.props[i]].rounds) q.push(i);
    if (!q.length && asked) for (i = 0; i < kit.props.length; i++) q.push(i);
    if (!q.length) return false;
    S.act = { name: 'reload', queue: q, gun: q[0], t: 0, done: false, dur: PROPS[kit.props[q[0]]].reload * Math.sqrt(ch.L / 0.92) };
    S.events.push({ type: 'reload', gun: q[0] });
    return true;
  }

  function fireControl(S, ch, inp, dt) {
    var m = ch.mount, kit = heldKit(S, ch), n = kit ? kit.props.length : (m.n || 1), i, g = -1;
    if (kit && kit.melee) { for (i = 0; i < 2; i++) S.flash[i] = 0; return; }      // blades are swung, not fired: see inp.swing
    S.cool -= dt;
    for (i = 0; i < 2; i++) { S.flash[i] = Math.max(0, S.flash[i] - dt / 0.06); spring(S.kick[i], 0, m.omega, 0.6, dt); }
    spring(S.rise, 0, m.omega * 0.7, 0.7, dt);
    if (!inp.fire || S.cool > 0 || (S.mode !== 'ground' && S.mode !== 'ride') || (S.act && S.act.name !== 'reload') || m.type === 'jaw') return;
    if (kit) {
      if (S.armed.x < 0.8) return;
      // the next gun in turn that has rounds and is not being reloaded; with none left, fire starts a reload
      for (i = 1; i <= n && g < 0; i++) { var c = (S.gun + i) % n; if (S.ammo[c] > 0 && !(S.act && S.act.gun === c)) g = c; }
      if (g < 0) { startReload(S, ch); return; }
      S.ammo[g]--;
    } else g = n === 2 ? 1 - S.gun : 0;
    S.gun = g;
    var D = kit ? PROPS[kit.props[g]] : m;
    S.cool = 1 / (kit ? kit.rate : m.rate); S.flash[g] = 1; S.kick[g].v -= D.kick; S.rise.v += D.rise;
    S.lean.v -= m.bodyKick || 0.5;
    S.events.push({ type: 'fire', gun: g });
  }

  // ------------------------------------------- actions with the hands and body
  /* Timed actions for upright characters. Each one takes over the hands and adds to the lean, the turn of the
     torso and the crouch, while the legs carry on underneath.
       inp.throw   = { target: [x, y, z] }            overarm throw; the 'throw' event gives the release point and velocity
       inp.pickup  = { at: [x, y, z], heading, size } squat, take a crate by its handles, stand up with it ('grab' event)
       inp.putdown = true                             set it down in front ('putdown' event)
       inp.guard, inp.block                           fists up in a fighting stance; cover up
       inp.punch   = { kind: 'jab' | 'cross' | 'hook', target: [x, y, z] }   the 'punch' event tells where the fist is at full reach */
  var CRATE = { d: 0.44, h: 0.36, w: 0.50 };
  var PUNCH = { jab: { hand: 1, dur: 0.34, hit: 0.36 }, cross: { hand: 0, dur: 0.50, hit: 0.42 }, hook: { hand: 1, dur: 0.56, hit: 0.46 } };
  function foldHalf(a) { a = wrapPi(a); return a > Math.PI / 2 ? a - Math.PI : a < -Math.PI / 2 ? a + Math.PI : a; }
  // launch velocity that lobs something from p to t (world), no faster than vmax
  function lob(p, t, vmax) {
    var dx = t[0] - p[0], dz = (t[2] || 0) - (p[2] || 0), dy = t[1] - p[1], d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.3) { dx = dx / (d || 1) * 0.3 || 0.3; dz = dz / (d || 1) * 0.3; d = 0.3; }
    var th = d < 3 ? 0.95 : 0.72, den = d * Math.tan(th) - dy;
    if (den < 0.15 * d) { th = Math.min(Math.atan2(dy, d) + 0.5, 1.35); den = Math.max(d * Math.tan(th) - dy, 0.05 * d); }
    var c = Math.cos(th), v = Math.min(Math.sqrt(G * d * d / (2 * c * c * den)), vmax || 15);
    return [v * c * dx / d, v * Math.sin(th), v * c * dz / d];
  }
  function actTick(S, ch, inp, dt, B) {
    var AC = { lean: 0, tw: 0, ext: 0, load: 0 }, a = S.act, k = Math.sqrt(ch.L / 0.92), q, c, sz;
    var ground = S.mode === 'ground' || S.mode === 'ride', idle = !a && ground && !S.jump;
    spring(S.guard, inp.guard && !S.carry && ground && !(a && a.name === 'throw') ? 1 : 0, 16, 1, dt);
    spring(S.block, inp.block && (inp.guard || (S.kit === 'sword' && S.armed.x > 0.5)) ? 1 : 0, 24, 1, dt);
    var g = clamp(S.guard.x, 0, 1);
    S.actCrouch = 0.12 * g + 0.10 * clamp(S.block.x, 0, 1); S.actBack = 0;
    // inp.swing = { kind: 'slash' | 'chop' | 'thrust' }: one swing of the blade. The 'strike' event gives the blade (hilt and point) as it lands.
    if (inp.swing && S.kit === 'sword' && S.armed.x > 0.8 && ground && !S.carry && !S.jump && (!a || (a.name === 'swing' && a.t > 0.8 * a.dur))) {
      var sk0 = SWINGS[inp.swing.kind] ? inp.swing.kind : 'slash';
      a = S.act = { name: 'swing', kind: sk0, t: 0, dur: SWINGS[sk0].dur * k, done: false, live: false };
    }
    if (inp.throw && idle && !S.carry && g < 0.3) a = S.act = { name: 'throw', t: 0, dur: 1.25 * k, done: false, target: inp.throw.target ? inp.throw.target.slice() : null };
    if (inp.pickup && idle && !S.carry && S.standing && g < 0.3) {
      sz = inp.pickup.size || CRATE;
      S.carry = {
        at: inp.pickup.at ? inp.pickup.at.slice() : B.toW([S.x + 0.20 * k + sz.d / 2, B.terrain(S.x + 0.20 * k + sz.d / 2, 0) + sz.h / 2, 0]),
        size: sz, yaw: inp.pickup.heading != null ? foldHalf(inp.pickup.heading - S.h) : 0, ca: 0, hk: 0, held: false
      };
      a = S.act = { name: 'pickup', t: 0, dur: 1.7 * k, done: false };
    }
    if (inp.putdown && idle && S.carry && S.carry.held && S.standing) {
      c = S.carry; c.yaw = 0;
      c.at = B.toW([S.x + 0.20 * k + c.size.d / 2, B.terrain(S.x + 0.20 * k + c.size.d / 2, 0) + c.size.h / 2, 0]);
      a = S.act = { name: 'putdown', t: 0, dur: 1.5 * k, done: false };
    }
    if (inp.punch && g > 0.5 && ground && !S.carry && (!a || (a.name === 'punch' && a.t > 0.7 * a.dur))) {
      var kind = PUNCH[inp.punch.kind] ? inp.punch.kind : 'jab', pk = PUNCH[kind];
      // a punch may follow another before that one is quite finished: start from where the hands and shoulders are
      a = S.act = { name: 'punch', kind: kind, hand: pk.hand, hit: pk.hit, t: 0, dur: pk.dur * k, done: false, target: inp.punch.target ? inp.punch.target.slice() : null, prev: null,
        tw0: S.acTw || 0, rel0: S.hoRel ? S.hoRel.slice() : null };
    }
    if (a && a.name !== 'reload') {
      a.t += dt; q = Math.min(a.t / a.dur, 1);
      if (a.name === 'throw') {
        // wind up turning away and leaning back, then whip round and through
        AC.tw = 0.55 * smooth(0.24, 0.50, q) - 1.0 * smooth(0.56, 0.70, q) + 0.45 * smooth(0.78, 1, q);
        AC.lean = -0.14 * smooth(0.24, 0.50, q) + 0.36 * smooth(0.56, 0.70, q) - 0.22 * smooth(0.78, 1, q);
      } else if (a.name === 'pickup' || a.name === 'putdown') {
        c = S.carry;
        // how far down the handles are decides how deep the squat is: a crate on a table needs none
        var dk = clamp((0.95 - (c.at[1] + 0.25 * c.size.h - S.gRef.x) / ch.L) / 0.66, 0.1, 1), down;
        if (a.name === 'pickup') {
          down = smooth(0, 0.34, q) * (1 - smooth(0.48, 0.95, q));
          c.hk = smooth(0.08, 0.36, q); c.ca = smooth(0.45, 1, q);
          if (!c.held && q >= 0.42) { c.held = true; S.events.push({ type: 'grab' }); }
        } else {
          down = smooth(0.04, 0.46, q) * (1 - smooth(0.66, 1, q));
          c.ca = 1 - smooth(0.14, 0.58, q); c.hk = 1 - smooth(0.66, 0.95, q);
          if (c.held && q >= 0.60) { c.held = false; S.events.push({ type: 'putdown', pos: c.at.slice(), heading: S.h }); }
        }
        // a proper squat: hips go back as they go down, and the back leans over the load
        S.actCrouch = 1.25 * dk * down; S.actBack = 0.24 * k * dk * down; AC.lean = 0.47 * dk * down;
      } else if (a.name === 'swing') {
        // wind up, land, recover. A slash is carried by the turn of the shoulders, a chop by the arm coming over, a thrust by the reach
        AC.wind = smooth(0, 0.26, q) * (1 - smooth(0.28, 0.42, q)); AC.hit = smooth(0.28, 0.42, q) * (1 - smooth(0.56, 1, q));
        a.live = q > 0.28 && q < 0.50;
        if (a.kind === 'slash') { AC.tw = 0.80 * AC.wind - 0.70 * AC.hit; AC.lean = 0.08 * AC.hit; }
        else if (a.kind === 'chop') { AC.tw = 0.15 * AC.wind - 0.12 * AC.hit; AC.lean = -0.08 * AC.wind + 0.20 * AC.hit; }
        else { AC.tw = 0.20 * AC.wind - 0.22 * AC.hit; AC.lean = 0.16 * AC.hit; }
        S.actBack = -0.08 * k * AC.hit;                          // the weight goes into it
      } else if (a.name === 'punch') {
        if (inp.track && q < 0.7 * a.hit) a.target = inp.track.slice();        // still on its way out: follow the target
        if (a.kind === 'jab') { AC.ext = smooth(0, 0.36, q) * (1 - smooth(0.46, 1, q)); AC.tw = 0.22 * AC.ext; AC.lean = 0.05 * AC.ext; }
        else if (a.kind === 'cross') {
          // the hips and shoulders turn first and the fist follows
          AC.ext = smooth(0.10, 0.42, q) * (1 - smooth(0.52, 1, q)); AC.tw = -0.85 * smooth(0, 0.40, q) * (1 - smooth(0.52, 1, q)); AC.lean = 0.12 * AC.ext;
        } else {
          var sw = smooth(0.22, 0.46, q), ret = smooth(0.60, 1, q);
          AC.load = smooth(0, 0.22, q) * (1 - ret); AC.ext = sw * (1 - ret);
          AC.tw = 0.2 * smooth(0, 0.22, q) * (1 - sw) - 0.6 * AC.ext; AC.lean = 0.04 * AC.ext;
        }
        if (a.t < 0.1) AC.tw = lerp(a.tw0, AC.tw, smooth(0, 0.1, a.t));
      }
      if (a.t >= a.dur) { if (a.name === 'putdown') S.carry = null; S.act = null; }
    }
    S.acTw = AC.tw;
    if (S.carry) AC.lean -= 0.08 * S.carry.ca;                 // lean back against the load
    AC.tw += 0.35 * g; AC.lean += (0.05 - 0.10 * clamp(S.block.x, 0, 1)) * g;
    return AC;
  }

  // --------------------------------------------------- beasts: tails and jaws
  /* A tail (or any trailing chain: antennae, a long neck) is a row of points on sprung links. Each point is
     pulled towards its place in a rest shape that hangs off the body, and otherwise keeps going the way it was:
     so it lags when the body speeds up, swings wide in a turn and settles afterwards.
     ctl.lift raises the whole tail (radians), ctl.yaw swings it sideways. Points are in the body's frame. */
  function tailStep(S, ch, B, base, bodyAng, ctl, dt) { return chainStep(S, 'tail', ch.tail, ch.L, B, base, bodyAng, ctl, dt); }
  function chainStep(S, key, T, Lsize, B, base, bodyAng, ctl, dt) {
    /* Every link has its own direction (an angle up or down, an angle to the side) and turning speed. A spring
       turns it to carry on from the link before it, bent by 'curl': so a movement at the root runs down the
       chain and reaches the tip late, the way a real tail follows through. On top of that each link is a
       pendulum on a moving pivot: when the body speeds up, stops, bounces or turns, the links swing the other
       way, the more the nearer the tip. Links get softer towards the tip. ctl.pull, when given, turns the
       links to pass through a set of points (a strike). Working in angles keeps a long chain calm. */
    var n = T.n, C = S.chains[key], k, sub, sz = Math.sqrt(Lsize / 0.7), om0 = T.omega / sz, zeta = T.zeta || 0.45, soft = T.soft === undefined ? 0.5 : T.soft;
    var th0 = bodyAng + Math.PI + T.rest - ctl.lift, ps0 = clamp(ctl.yaw, -1.2, 1.2), curl = T.curl + (ctl.curl || 0), sag = T.sag === undefined ? 0.2 : T.sag, dr = B.drift || [0, 0];
    if (!C || C.n !== n || !C.th) {
      C = S.chains[key] = { n: n, th: [], ps: [], vth: [], vps: [], by: base[1], vy: 0, ay: 0, dr: dr.slice(), ax: 0, az: 0 };
      for (k = 0; k < n; k++) { C.th.push(th0 + k * curl); C.ps.push(ps0); C.vth.push(0); C.vps.push(0); }
    }
    // how the root of the tail is being thrown about: forwards (speeding up, a shove), up and down (the gait's bounce), sideways (a turn, a shove)
    var vy = (base[1] - C.by) / dt, kf = decay(25, dt);
    C.ay += (clamp((vy - C.vy) / dt, -3 * G, 3 * G) - C.ay) * kf; C.vy = vy; C.by = base[1];
    C.ax += (clamp(S.a + (dr[0] - C.dr[0]) / dt, -4 * G, 4 * G) - C.ax) * kf;
    C.az += (clamp(S.v * S.om + (dr[1] - C.dr[1]) / dt, -4 * G, 4 * G) - C.az) * kf; C.dr = dr.slice();
    // (worked in steps of 1/120 s at most, so that a game running at 30 steps a second gets the same tail)
    var nsub = Math.max(1, Math.ceil(dt * 120 - 1e-6)), hdt = dt / nsub, pts, pth, pps, pvt, pvp, inert = T.inert === undefined ? 1 : T.inert;
    for (sub = 0; sub < nsub; sub++) {
    pts = [base.slice()]; pth = th0 - curl; pps = ps0; pvt = 0; pvp = 0;
    for (k = 0; k < n; k++) {
      var om = om0 * (1 - soft * k / Math.max(n - 1, 1)), ell = Math.max(0.5 * T.seg * (n - k), T.seg) * 2.2 / inert;
      var th = C.th[k], ps = C.ps[k], tt = pth + curl, tp = k === 0 ? pps : 0.94 * pps, cps = Math.cos(ps);
      var fth = -(-C.ax * Math.sin(th) + (C.ay + sag * G) * Math.cos(th)) / ell;
      var fps = -(C.az * cps - C.ax * Math.cos(th) * Math.sin(ps)) / ell;
      C.vth[k] += (om * om * wrapPi(tt - th) - 2 * zeta * om * (C.vth[k] - pvt) + fth) * hdt;
      C.vps[k] += (om * om * (tp - ps) - 2 * zeta * om * (C.vps[k] - pvp) + fps) * hdt;
      th += C.vth[k] * hdt; ps += C.vps[k] * hdt - S.om * hdt * Math.cos(th) * 0.8;       // the body turns under a tail that would rather keep pointing where it did
      if (ctl.pull && ctl.pull.k > 0) {
        var a = ctl.pull.pts[k], b = ctl.pull.pts[k + 1], dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        th += wrapPi(Math.atan2(dy, dx) - th) * ctl.pull.k; ps += (Math.asin(clamp(dz / dl, -1, 1)) - ps) * ctl.pull.k;
        C.vth[k] *= 1 - ctl.pull.k; C.vps[k] *= 1 - ctl.pull.k;
      }
      // a link bends only so far from the one before, and does not go through the ground
      var bmax = ctl.pull && ctl.pull.k > 0 ? 2.5 : T.bend || 1.3, off = wrapPi(th - tt); if (Math.abs(off) > bmax) { th = tt + clamp(off, -bmax, bmax); C.vth[k] = 0; }
      var smax = k === 0 ? 1.35 : Math.abs(pps) + (T.bend || 1.3); if (Math.abs(ps) > smax) { ps = clamp(ps, -smax, smax); C.vps[k] = 0; }
      cps = Math.cos(ps);
      var prev = pts[k], q = [prev[0] + T.seg * Math.cos(th) * cps, prev[1] + T.seg * Math.sin(th) * cps, prev[2] + T.seg * Math.sin(ps)];
      var gy = B.terrain(q[0], q[2]) + 0.03;
      if (q[1] < gy && prev[1] >= gy - 1e-6) {
        var sv = clamp((gy - prev[1]) / (T.seg * Math.max(cps, 0.2)), -1, 1), a1 = Math.asin(sv), a2 = Math.PI - a1;
        th = Math.abs(wrapPi(a1 - th)) < Math.abs(wrapPi(a2 - th)) ? a1 : a2; if (C.vth[k] * Math.cos(th) < 0) C.vth[k] = 0;
        q = [prev[0] + T.seg * Math.cos(th) * cps, prev[1] + T.seg * Math.sin(th) * cps, prev[2] + T.seg * Math.sin(ps)];
      }
      C.th[k] = th; C.ps[k] = ps; pts.push(q);
      pth = th; pps = ps; pvt = C.vth[k]; pvp = C.vps[k];
    }
    }
    return pts;
  }
  // A limp chain: points on links of fixed length, hanging from wherever its first point is put. Used for the
  // tails and arms of a body that has been knocked down. ground(x, z) gives the height it may not go below.
  function limpStep(Lc, anchor, ground, dt) {
    var n = Lc.p.length, i, j, it, h = Math.min(dt, 1 / 60);
    Lc.p[0] = anchor.slice();
    for (i = 1; i < n; i++) {
      var p = Lc.p[i], q = Lc.q[i], v = [(p[0] - q[0]) * 0.97, (p[1] - q[1]) * 0.97, (p[2] - q[2]) * 0.9];
      Lc.q[i] = p.slice(); p[0] += v[0]; p[1] += v[1] - G * h * h; p[2] += v[2];
    }
    for (it = 0; it < 4; it++) for (i = 1; i < n; i++) {
      var a = Lc.p[i - 1], b = Lc.p[i], d = sub(b, a), l = len(d) || 1;
      for (j = 0; j < 3; j++) b[j] = a[j] + d[j] / l * Lc.seg[i - 1];
      var gy = ground(b[0], b[2]) + Lc.r;
      // it drags on the ground. (Touching counts as on the ground, to a tenth of a micron: a point that rests exactly on it
      // would otherwise drag or not by the last bit of a sum, and no two machines would agree.)
      if (b[1] < gy + 1e-7) { if (b[1] < gy) b[1] = gy; Lc.q[i][0] += (b[0] - Lc.q[i][0]) * 0.5; Lc.q[i][2] += (b[2] - Lc.q[i][2]) * 0.5; }
    }
    return Lc.p.map(function (x) { return x.slice(); });
  }
  function limpFrom(pts, r) { var seg = []; for (var i = 1; i < pts.length; i++) seg.push(len(sub(pts[i], pts[i - 1]))); return { p: pts.map(function (x) { return x.slice(); }), q: pts.map(function (x) { return x.slice(); }), seg: seg, r: r }; }
  // links of fixed length from a to a point b that the last one must reach (if it can), starting from a guess
  function reachChain(pts, a, b, seg, most) {
    var n = pts.length - 1, k, it, d, l, tot = n * seg * (most || 0.985), ab = sub(b, a), al = len(ab);
    if (al > tot) b = add(a, mul(ab, tot / al));
    for (it = 0; it < 5; it++) {
      pts[n] = b.slice();
      for (k = n - 1; k >= 1; k--) { d = sub(pts[k], pts[k + 1]); l = len(d) || 1; pts[k] = add(pts[k + 1], mul(d, seg / l)); }
      pts[0] = a.slice();
      for (k = 1; k <= n; k++) { d = sub(pts[k], pts[k - 1]); l = len(d) || 1; pts[k] = add(pts[k - 1], mul(d, seg / l)); }
    }
    return pts;
  }
  // A beast's own actions. inp.bite = { target: [x, y, z] }: the neck shoots out, the jaws snap ('bite' event).
  // inp.pounce (handled with the jump) leaps onto a target with the jaws open ('pounce' event on landing).
  function beastTick(S, ch, inp, dt, B) {
    var AC = { lean: 0, tw: 0, ext: 0, load: 0, jaw: 0, alert: 0 }, a = S.act, k = Math.sqrt(ch.L / 0.7), q, J = S.jump;
    S.actBack = 0; S.actCrouch = 0;
    if (inp.bite && !a && (S.mode === 'ground' || S.mode === 'fly') && !J) a = S.act = { name: 'bite', t: 0, dur: 0.46 * k, done: false, target: inp.bite.target ? inp.bite.target.slice() : null };
    if (a && a.name === 'bite') {
      a.t += dt; q = Math.min(a.t / a.dur, 1);
      AC.ext = smooth(0.05, 0.34, q) * (1 - smooth(0.42, 1, q));
      AC.jaw = 0.9 * smooth(0, 0.22, q) * (1 - smooth(0.33, 0.37, q));
      AC.alert = 1; AC.lean = 0.10 * AC.ext; S.actBack = -0.12 * k * AC.ext; S.actCrouch = 0.2 * AC.ext;
      if (a.t >= a.dur) S.act = null;
    }
    if (J && J.pounce) {
      AC.alert = 1;
      AC.jaw = J.stage === 'air' ? 0.85 : J.stage === 'land' ? 0.85 * (1 - smooth(0, 0.07, J.t)) : 0.25;
      AC.ext = J.stage === 'air' ? 0.7 : J.stage === 'land' ? 0.7 * (1 - smooth(0, 0.3, J.t)) : 0;
    }
    return AC;
  }

  // An arthropod's own actions. inp.pinch = { target }: the nearer claw shoots out and shuts ('pinch' event).
  // inp.sting = { target }: the tail rears back, then whips over the head onto the target ('sting' event).
  function arthroTick(S, ch, inp, dt, B) {
    var AC = { lean: 0, tw: 0, ext: 0, load: 0, jaw: 0, alert: 0, sting: 0, rear: 0, shut: 0 }, a = S.act, q, free = !a && (S.mode === 'ground' || S.mode === 'fly');
    S.actBack = 0; S.actCrouch = 0;
    if (ch.arthro.rock && S.standing && S.mode === 'ground') S.actBack = ch.arthro.rock * Math.sin(TAU * S.t / 1.4);       // a mantis rocks like a leaf in the wind
    if (inp.pinch && free) a = S.act = { name: 'pinch', t: 0, dur: ch.arthro.strike || 0.5, done: false, target: inp.pinch.target ? inp.pinch.target.slice() : null, side: 0 };
    else if (inp.sting && free && ch.tail) a = S.act = { name: 'sting', t: 0, dur: 0.72, done: false, target: inp.sting.target ? inp.sting.target.slice() : null };
    if (a && (a.name === 'pinch' || a.name === 'sting')) {
      a.t += dt; q = Math.min(a.t / a.dur, 1); AC.alert = 1;
      if (a.name === 'pinch') {
        AC.ext = smooth(0.05, 0.36, q) * (1 - smooth(0.52, 1, q)); AC.jaw = smooth(0, 0.2, q);
        AC.shut = smooth(0.36, 0.41, q) * (1 - smooth(0.62, 0.92, q)); S.actBack = -0.06 * AC.ext;
      } else {
        AC.rear = smooth(0, 0.20, q) * (1 - smooth(0.22, 0.32, q));
        AC.sting = smooth(0.22, 0.40, q) * (1 - smooth(0.52, 1, q)); S.actBack = -0.14 * AC.sting; AC.lean = 0.3 * AC.sting;
      }
      if (a.t >= a.dur) S.act = null;
    }
    return AC;
  }

  var PROP_PTS = ['o', 'muzzle', 'body', 'grip', 'gripLow', 'fore', 'magA', 'magB'];
  function upperBody(S, ch, inp, st, dt, legs, B) {
    var root = B.root, m = ch.mount, pose = { kind: ch.kind, root: root, pitch: B.pitch, legs: legs, crouch: S.crouch };
    // kits: the weapons are put away before changing to another set, then the new ones come up
    var kitWant = m.type === 'held' ? (inp.kit && kitFits(ch, inp.kit) ? inp.kit : S.kit) : null;
    var AC = ch.kind === 'biped' ? actTick(S, ch, inp, dt, B) : ch.beast ? beastTick(S, ch, inp, dt, B) : ch.arthro ? arthroTick(S, ch, inp, dt, B) : ch.octo ? octoTick(S, ch, inp, dt) : { lean: 0, tw: 0, ext: 0, load: 0 };
    // hands that are busy with a load or a fight cannot hold weapons: those are put away first
    var busy = !!S.carry || S.guard.x > 0.05 || (ch.kind === 'biped' && !!inp.guard);
    var ready = (!!inp.armed || !!m.civil) && kitWant === S.kit && !busy;
    if (kitWant !== S.kit && S.armed.x < 0.04) { S.kit = kitWant; S.ammo = fullAmmo(S.kit); S.gun = 0; }
    if (!ready && S.act && S.act.name === 'reload') S.act = null;
    if (inp.reload) startReload(S, ch, true);
    fireControl(S, ch, inp, dt);
    spring(S.lean, (B.leanBase + AC.lean) * (ch.kind === 'biped' ? 1 : 0.45), 38 / B.Tn, 0.8, dt);
    spring(S.armed, ready ? 1 : 0, 14, 1, dt);
    spring(S.flinch, 0, 27 / B.Tn, 0.5, dt);
    var lean = S.lean.x, FL = clamp(S.flinch.x, -0.3, 1.2), bank = B.bank || 0, sway0 = B.sway0 || 0;
    var u = [Math.sin(lean), Math.cos(lean), 0], f = [Math.cos(lean), -Math.sin(lean), 0];
    pose.lean = lean; pose.pack = clamp(S.pack.x, -0.06 * ch.L, 0.06 * ch.L);
    // turn a direction round the body's own long axis (u); a positive angle turns forward towards the right
    function twd(v, a) {
      var c = Math.cos(a), s = Math.sin(a), q = dot(u, v) * (1 - c);
      return [v[0] * c + (v[1] * u[2] - v[2] * u[1]) * s + u[0] * q, v[1] * c + (v[2] * u[0] - v[0] * u[2]) * s + u[1] * q, v[2] * c + (v[0] * u[1] - v[1] * u[0]) * s + u[2] * q];
    }
    function twp(p, c0, a) { return add(c0, twd(sub(p, c0), a)); }

    /* Where the weapon points. Up and down: a spring chases the aim point and recoil is added on top.
       Sideways: the upper body (torso, hull, head or turret) turns towards the point, as far as its limit
       allows; a point behind the body is out of reach and is let go. share: how much of the turn is taken. */
    function aimFrom(pivot, share) {
      var lim = m.yaw === undefined ? 1 : m.yaw, round = lim >= Math.PI;
      var want = m.type === 'held' ? -0.5 * smooth(0.8, 2.2, S.idleT) : 0.12 * (B.idle || 0) * idleNoise(S.t, B.P || 4, 6.0);
      var yw = round ? S.twist.x - wrapPi(S.twist.x) : 0;
      if (B.aim) {
        var dx = B.aim[0] - pivot[0], dz = B.aim[2] - pivot[2], y = Math.atan2(dz, dx), reach = 1;
        if (round) yw = S.twist.x + wrapPi(y - S.twist.x);
        else { reach = 1 - smooth(lim + 0.25, lim + 0.8, Math.abs(y)); yw = clamp(y, -lim, lim) * reach * share; }
        want = reach * Math.atan2(B.aim[1] - pivot[1], Math.max(Math.sqrt(dx * dx + dz * dz), 0.05 * ch.L));
      }
      spring(S.aim, clamp(want, m.min, m.max), m.aimOmega, 0.9, dt);
      spring(S.twist, yw, m.aimOmega * 0.7, 1, dt);
      return S.aim.x + S.rise.x;
    }

    if (ch.kind === 'biped') {
      var T = ch.torso, A = ch.arms, gp = B.gp, kit = heldKit(S, ch), e = S.armed.x, i;
      var breath = 0.007 * ch.L * B.idle * Math.sin(TAU * S.t / B.P);
      var chest = [root[0] + u[0] * T.len, root[1] + u[1] * T.len + breath, root[2] - 0.5 * sway0 + bank * T.len];
      var hl = lean * 0.35 + 0.5 * FL * S.flinchDir;
      var head = [chest[0] + Math.sin(hl) * (T.neck + T.headR * 0.7), chest[1] + Math.cos(hl) * (T.neck + T.headR * 0.7), chest[2] + bank * (T.neck + T.headR * 0.7)];
      var W = aimFrom(add(chest, add(mul(u, -0.11), mul(f, 0.10))), lerp(0.5, 1, e)) + st.bounce * 0.012 * gp.moving * Math.sin(2 * TAU * S.phase) + 0.25 * FL;
      // the turn of everything above the hips: sideways aim plus whatever the action adds
      var tws = S.twist.x + AC.tw;

      // the action in progress: rs is how far through the reload of gun act.gun we are, q how far through any other
      var act = S.act, rs = -1;
      if (act && act.name === 'reload' && kit) {
        act.t += dt; rs = act.t / act.dur;
        var AD = PROPS[kit.props[act.gun]];
        if (!act.done && rs >= AD.seat) { act.done = true; S.ammo[act.gun] = AD.rounds; S.kick[act.gun].v += 0.6; S.events.push({ type: 'loaded', gun: act.gun }); }
        if (rs >= 1) {
          act.queue.shift();
          if (act.queue.length) { act.gun = act.queue[0]; act.t = 0; act.done = false; act.dur = PROPS[kit.props[act.gun]].reload * Math.sqrt(ch.L / 0.92); rs = 0; }
          else { S.act = act = null; rs = -1; }
        }
      }
      var an = act ? act.name : null, q = act ? Math.min(act.t / act.dur, 1) : 0;

      // eP: how far each prop is out of its holster; eH: how much each hand is on its weapon.
      // A throw takes the right hand away: the rifle is left to the other hand, a pistol goes back in its holster.
      var eP = [e, e], eH = [e, e], tk = 0;
      if (an === 'throw') { tk = smooth(0, 0.16, q) * (1 - smooth(0.82, 1, q)); eH[0] = e * (1 - tk); if (kit && kit.props[0] === 'pistol') eP[0] = eH[0]; }

      var props = [], hold = [null, null];
      if (kit) for (i = 0; i < kit.props.length; i++) {
        var kind = kit.props[i], rel = an === 'reload' && act.gun === i ? rs : -1, Wi = W, place, slide = 0;
        if (kind === 'rifle' && rel >= 0) Wi -= 0.32 * smooth(0, 0.12, rel) * (1 - smooth(0.84, 1, rel));          // muzzle dips while the hand is away
        if (kind === 'rifle') Wi -= 0.45 * tk;
        place = readyPlace(kind, i, chest, u, f, Wi, S.kick[i].x);
        if (kind === 'pistol' && rel >= 0) {
          // one-handed: the pistol comes down to the belt, the magazine drops into the holder and a fresh one is pushed home
          place = mixPlace(place, beltPlace(i, root, u, f), smooth(0, 0.3, rel) * (1 - smooth(0.66, 1, rel)));
          slide = 0.10 * (smooth(0.30, 0.42, rel) - smooth(0.48, 0.60, rel));
        }
        if (kind === 'sword' && an === 'swing') {
          var wd = AC.wind, ht = AC.hit, so = [0, 0];
          if (act.kind === 'slash') { place.th = lerp(place.th, 0.30 - 0.2 * ht, Math.max(wd, ht)); so = [-0.05 * wd + 0.20 * ht, 0.14 * wd + 0.16 * ht]; }
          else if (act.kind === 'chop') { place.th = lerp(lerp(place.th, 2.35, wd), -0.30, ht); so = [-0.06 * wd + 0.22 * ht, 0.30 * wd + 0.12 * ht]; }
          else { place.th = lerp(place.th, 0.05, Math.max(wd, ht)); so = [-0.14 * wd + 0.30 * ht, 0.14 * wd + 0.20 * ht]; place.z = lerp(place.z, chest[2] + 0.12, ht); }
          place.o = [place.o[0] + f[0] * so[0] + u[0] * so[1], place.o[1] + f[1] * so[0] + u[1] * so[1]];
        }
        if (kind === 'case') {
          // it swings a little with the arm that holds it, against the leg on that side
          var cs = -0.09 * st.arm * gp.moving * S.legs[0].fwd;
          place.o = [place.o[0] + cs, place.o[1] + 0.8 * cs * cs]; place.th = 0.5 * cs;
        }
        if (kind === 'trolley') {
          // the hand stays where it is; the axle is put on the ground behind, wherever the ground is there
          var PT = PROPS.trolley, hx = place.o[0] + PT.len * Math.cos(place.th), hy = place.o[1] + PT.len * Math.sin(place.th);
          for (var pass = 0; pass < 2; pass++) {             // twice: where the axle comes to rest depends on how high the ground is there
            var gw = B.terrain(place.o[0], place.z);
            if (gw > hy - 1.3 * PT.len) {
              var tt = Math.asin(clamp((hy - gw - PT.wheel) / PT.len, 0.12, 0.97));
              place = { o: [hx - PT.len * Math.cos(tt), hy - PT.len * Math.sin(tt)], th: tt, z: place.z };
            }
          }
        }
        if (kind === 'shield') {
          // blocking brings the shield up and across in front of the face and chest; a swing of the sword opens it a little
          var bk2 = clamp(S.block.x, 0, 1), opn = an === 'swing' ? 0.5 * AC.hit : 0;
          place.o = [place.o[0] + f[0] * (0.08 * bk2 - 0.06 * opn) + u[0] * 0.20 * bk2, place.o[1] + f[1] * (0.08 * bk2 - 0.06 * opn) + u[1] * 0.20 * bk2];
          place.z = lerp(place.z, chest[2] - 0.04, bk2) - 0.08 * opn;
        }
        place = mixPlace(stowPlace(kind, i, root, u, f, chest[2]), place, eP[i]);
        var w = propAt(kind, place.o, place.th, place.z);
        w.flash = S.flash[i]; w.stow = 1 - eP[i];
        if (slide) { w.magA = [w.magA[0] - w.up[0] * slide, w.magA[1] - w.up[1] * slide, w.magA[2]]; w.magB = [w.magB[0] - w.up[0] * slide, w.magB[1] - w.up[1] * slide, w.magB[2]]; }
        props.push(w);
      }
      // hands: the right hand holds prop 0; the left holds prop 1, or the foregrip of a two-handed prop
      if (props.length) { hold[0] = props[0].grip; hold[1] = props.length > 1 ? props[1].grip : props[0].fore; }
      if (an === 'reload' && act.gun === 0 && props.length && props[0].kind === 'rifle') {
        // reloading the rifle: the off hand leaves the foregrip, takes the magazine to the pouch on the hip, comes back
        // with a fresh one, seats it and returns. Every waypoint is a live point, so it works on the move.
        var w0 = props[0], nn = w0.up, seat = w0.magB, mlen = 0.115, kq = 0, magHeld = true, hp;
        var pouch = [root[0] + 0.10 * u[0] + 0.12 * f[0], root[1] + 0.10 * u[1] + 0.12 * f[1], root[2] - 0.16];
        var below = [seat[0] - 0.07 * nn[0], seat[1] - 0.07 * nn[1], seat[2]];
        if (rs < 0.16) { hp = lerp3(w0.fore, seat, smooth(0, 0.16, rs)); magHeld = false; }
        else if (rs < 0.40) { kq = smooth(0.16, 0.40, rs); hp = lerp3(seat, pouch, kq); var pull = 0.06 * Math.sin(Math.PI * kq); hp[0] -= nn[0] * pull; hp[1] -= nn[1] * pull; }
        else if (rs < 0.50) { kq = 1; hp = [pouch[0], pouch[1] - 0.025 * Math.sin(Math.PI * (rs - 0.40) / 0.10), pouch[2]]; }
        else if (rs < 0.74) { kq = 1 - smooth(0.50, 0.74, rs); hp = lerp3(below, pouch, kq); }
        else if (rs < 0.80) hp = lerp3(below, seat, smooth(0.74, 0.80, rs));
        else { hp = lerp3(seat, w0.fore, smooth(0.80, 1, rs)); magHeld = false; }
        hold[1] = hp;
        if (magHeld) {
          var mx = lerp(nn[0], u[0], kq), my = lerp(nn[1], u[1], kq), ml = Math.sqrt(mx * mx + my * my) || 1;
          w0.magB = hp.slice(); w0.magA = [hp[0] + mx / ml * mlen, hp[1] + my / ml * mlen, hp[2]];
        }
      }

      /* Hands taken over by an action. Each entry is a target for that hand, how firmly it applies (k) and
         which way the elbow points. Targets are worked out before the torso's turn is applied; a point that
         must stay put in the world or on the hips is turned back first (unturn), so that it ends up there. */
      var HO = [null, null], gA = clamp(S.guard.x, 0, 1), crate = S.carry, sd2;
      var unturn = function (p) { return twp(p, chest, -tws); };
      var fromChest = function (fw, up2, right) { return [chest[0] + f[0] * fw + u[0] * up2, chest[1] + f[1] * fw + u[1] * up2, chest[2] + right]; };
      if (gA > 0.01) {
        // on guard: lead (left) fist out in front of the chin, rear fist by the jaw; blocking pulls both in and up
        var bk = clamp(S.block.x, 0, 1);
        HO[0] = { p: fromChest(lerp(0.17, 0.15, bk), lerp(0.03, 0.12, bk), 0.08), k: gA, pole: [-0.2, -1, 0.5] };
        HO[1] = { p: fromChest(lerp(0.27, 0.20, bk), lerp(0.05, 0.13, bk), -0.09), k: gA, pole: [-0.2, -1, -0.5] };
        if (an === 'punch') {
          var ph = act.hand, PT = act.target ? unturn(B.toL(act.target)) : fromChest(0.62, 0.06, 0);
          sd2 = ph === 0 ? 1 : -1;
          if (act.kind === 'hook') {
            // the fist goes out to the side with the elbow raised, then the turn of the body brings it round
            HO[ph].p = lerp3(lerp3(HO[ph].p, fromChest(0.20, 0.02, sd2 * 0.36), AC.load), PT, AC.ext);
            HO[ph].pole = lerp3(HO[ph].pole, [0, 0.3, sd2], AC.load);
          } else HO[ph].p = lerp3(HO[ph].p, PT, AC.ext);
        }
        // remember where the fists are, measured from the chest, so that the next punch can start from there
        for (i = 0; i < 2; i++) {
          var hx2 = HO[i].p[0] - chest[0], hy2 = HO[i].p[1] - chest[1], hr = [hx2 * f[0] + hy2 * f[1], hx2 * u[0] + hy2 * u[1], HO[i].p[2] - chest[2]];
          if (an === 'punch' && act.rel0 && act.rel0[i] && act.t < 0.1) { hr = lerp3(act.rel0[i], hr, smooth(0, 0.1, act.t)); HO[i].p = fromChest(hr[0], hr[1], hr[2]); }
          S.hoRel[i] = hr;
        }
      } else S.hoRel = [null, null];
      if (an === 'throw') {
        // right hand: to the belt for the grenade, back behind the shoulder, over the top, and through
        var belt = unturn([root[0] + 0.10 * u[0] + 0.06 * f[0], root[1] + 0.10 * u[1] + 0.06 * f[1], root[2] + 0.17]);
        var back = fromChest(-0.22, 0.16, 0.30), fol = fromChest(0.42, -0.06, 0.02), tp;
        if (q < 0.24) tp = belt;
        else if (q < 0.56) tp = lerp3(belt, back, smooth(0.24, 0.52, q));
        else if (q < 0.72) { var sq = smooth(0.56, 0.72, q), arc = 0.34 * Math.sin(Math.PI * sq); tp = lerp3(back, fol, sq); tp[0] += u[0] * arc; tp[1] += u[1] * arc; }
        else tp = fol;
        HO[0] = { p: tp, k: smooth(0, 0.18, q) * (1 - smooth(0.80, 1, q)), pole: [-0.6, 0.1, 0.8] };
      }
      if (crate) {
        // the crate: resting at its place in the world, or held in front of the hips, or on the way between the two
        var cz = crate.size, cb = [root[0] + f[0] * (0.12 + cz.d / 2) + u[0] * 0.17, root[1] + f[1] * (0.12 + cz.d / 2) + u[1] * 0.17, root[2]];
        var cc = lerp3(B.toL(crate.at), cb, crate.ca), yr = crate.yaw * (1 - crate.ca);
        if (crate.held && act) {
          // while it is in the hands it cannot be further from the shoulders than the arms are long
          var sm = [chest[0] - 0.04 * u[0], chest[1] - 0.04 * u[1], root[2]], hm = [cc[0], cc[1] + 0.25 * cz.h, cc[2]];
          var lat2 = Math.max(0, cz.w / 2 + 0.015 - T.shoulderW), hmax = Math.sqrt(Math.pow(0.99 * (A.upper + A.lower), 2) - lat2 * lat2);
          var hd2 = sub(hm, sm), hdl = len(hd2);
          if (hdl > hmax) cc = add(cc, mul(hd2, hmax / hdl - 1));
        }
        // it is kept nearly level: only a third of the body's lean reaches it
        var fbx = lerp(1, f[0], 0.33 * crate.ca), fby = lerp(0, f[1], 0.33 * crate.ca), fbl = Math.sqrt(fbx * fbx + fby * fby);
        var cf = [fbx / fbl * Math.cos(yr), fby / fbl, fbx / fbl * Math.sin(yr)], cs = [-Math.sin(yr), 0, Math.cos(yr)];
        var cu = [cs[1] * cf[2] - cs[2] * cf[1], cs[2] * cf[0] - cs[0] * cf[2], cs[0] * cf[1] - cs[1] * cf[0]];
        for (i = 0; i < 2; i++) {
          sd2 = i === 0 ? 1 : -1;
          HO[i] = { p: unturn(add(cc, add(mul(cu, 0.25 * cz.h), mul(cs, sd2 * (cz.w / 2 + 0.015))))), k: crate.hk, pole: [-0.5, -0.7, sd2 * 0.7] };
        }
        pose.carry = { c: cc, f: cf, u: cu, side: cs, size: cz, held: crate.held };
      } else pose.carry = null;

      if (B.hands) for (i = 0; i < 2; i++) if (!HO[i] || !(HO[i].k > 0)) HO[i] = { p: unturn(B.hands[i]), k: 1 - eH[i], pole: [-0.2, -1, i === 0 ? 0.5 : -0.5] };      // reins or handles, unless the hand is busy
      var swing = st.arm * 0.2 * gp.moving * legs[0].side * S.legs[0].fwd * (1 - 0.7 * e);
      var arms = [];
      for (var s = 0; s < 2; s++) {
        var side = s === 0 ? 1 : -1;
        var sh = add(chest, mul(u, -0.04)); sh[0] -= side * swing * T.shoulderW; sh[2] = chest[2] + side * T.shoulderW;
        // nothing in the hand: the arm swings against the leg on its own side
        var th = -st.arm * (0.42 + 0.45 * gp.run) * gp.moving * S.legs[s].fwd + lean * 0.3 + 0.9 * S.airB - 0.6 * B.prep - 0.6 * FL * S.flinchDir;
        var el = 0.22 + 1.25 * gp.run + 0.35 * Math.max(0, th) + 0.3 * S.crouch + 0.4 * S.airB + 0.6 * Math.abs(FL);
        var eb = [sh[0] + Math.sin(th) * A.upper, sh[1] - Math.cos(th) * A.upper, sh[2] + side * 0.03];
        var free = [eb[0] + Math.sin(th + el) * A.lower, eb[1] - Math.cos(th + el) * A.lower, eb[2]];
        var hk = hold[s] ? eH[s] : 0;
        var hand = hold[s] ? lerp3(free, hold[s], hk) : free;
        var pole = lerp3([-1, -0.25, side * 0.2], [-0.5, -0.9, side * 0.6], hk);
        if (HO[s] && HO[s].k > 0) { hand = lerp3(hand, HO[s].p, HO[s].k); pole = lerp3(pole, HO[s].pole, HO[s].k); }
        var kj = ik2(sh, hand, A.upper, A.lower, pole);
        arms.push({ shoulder: sh, elbow: kj.mid, hand: kj.end, side: side });
      }
      // sideways aim: everything above the hips turns about the spine
      head = twp(head, chest, tws);
      for (i = 0; i < 2; i++) { arms[i].shoulder = twp(arms[i].shoulder, chest, tws); arms[i].elbow = twp(arms[i].elbow, chest, tws); arms[i].hand = twp(arms[i].hand, chest, tws); }
      for (i = 0; i < props.length; i++) {
        var pw = props[i], ta = pw.kind === 'pistol' || pw.kind === 'sword' ? tws * eP[i] : tws;       // holstered pistols and a sheathed sword stay with the hips
        for (var q2 = 0; q2 < PROP_PTS.length; q2++) if (pw[PROP_PTS[q2]]) pw[PROP_PTS[q2]] = twp(pw[PROP_PTS[q2]], chest, ta);
        pw.dir = twd(pw.dir, ta); pw.up = twd(pw.up, ta);
      }
      var gz = W * 0.6 * e * (1 - gA) + 0.3 * B.idle * idleNoise(S.t, B.P, 5.0);
      pose.chest = chest; pose.head = head; pose.gaze = twd([Math.cos(gz), Math.sin(gz), 0], tws);
      pose.arms = arms; pose.props = props; pose.u = u; pose.f = twd(f, tws); pose.side = twd([0, 0, 1], tws);

      // the grenade: on the belt until the hand has it, and let go at the top of the swing
      var inHand = an === 'throw' && q >= 0.20 && !act.done, fa = sub(arms[0].hand, arms[0].elbow), fal = len(fa) || 1;
      pose.grenade = {
        p: inHand ? add(arms[0].hand, mul(fa, 0.05 / fal)) : [root[0] + 0.09 * u[0] + 0.07 * f[0], root[1] + 0.09 * u[1] + 0.07 * f[1], root[2] + 0.185],
        held: inHand
      };
      if (inHand && q >= 0.635) {
        act.done = true;
        var gw = B.toW(pose.grenade.p), tgt = act.target || B.toW([S.x + 9 * ch.L, S.gRef.x, 0]);
        S.events.push({ type: 'throw', pos: gw, vel: lob(gw, tgt, 15 * Math.sqrt(ch.L / 0.92)), target: tgt.slice() });
      }
      if (an === 'swing' && !act.done && q >= 0.40) {
        // as it lands, tell the game where the blade is (hilt and point) and which way it is travelling: the game decides what it cut
        act.done = true;
        var bh = B.toW(props[0].body), bp = B.toW(props[0].muzzle), bd = act.prevTip ? sub(bp, act.prevTip) : [0, 0, 0], bl = len(bd) || 1;
        S.events.push({ type: 'strike', kind: act.kind, hilt: bh, point: bp, dir: mul(bd, 1 / bl) });
      }
      if (an === 'swing') act.prevTip = B.toW(props[0].muzzle);
      if (an === 'punch') {
        // at full reach, tell the game where the fist is and which way it was going: it decides what was hit
        var fw = B.toW(arms[act.hand].hand);
        if (!act.done && q >= act.hit) {
          act.done = true;
          var pd = act.prev ? sub(fw, act.prev) : null, pl2 = pd ? len(pd) : 0;
          if (pl2 < 1e-6) { pd = sub(fw, B.toW(arms[act.hand].shoulder)); pl2 = len(pd) || 1; }
          S.events.push({ type: 'punch', kind: act.kind, hand: act.hand, pos: fw, dir: mul(pd, 1 / pl2), miss: act.target ? len(sub(fw, act.target)) : 0 });
        }
        act.prev = fw;
      }
    } else if (ch.kind === 'mech') {
      var P = ch.pod;
      var pc = add(root, mul(u, P.h)); pc[2] += bank * P.h;
      var Wm = aimFrom(add(pc, [0.1, -0.3, 0]), 1), tm = S.twist.x;          // the hull turns on the hips
      var dm = twd([Math.cos(Wm), Math.sin(Wm), 0], tm);
      pose.chest = pc; pose.u = u; pose.f = twd(f, tm); pose.side = twd([0, 0, 1], tm); pose.mounts = [];
      for (var g = 0; g < 2; g++) {
        var sd = g === 0 ? 1 : -1;
        var base = add(pc, twd([0.1 * f[0] - 0.3 * u[0], 0.1 * f[1] - 0.3 * u[1], sd * P.gunZ], tm));
        var b = add(base, mul(dm, S.kick[g].x));
        pose.mounts.push({ joint: base, base: add(b, mul(dm, -0.35)), tip: add(b, mul(dm, P.gunLen)), dir: dm, flash: S.flash[g], side: sd });
      }
    } else {
      // horizontal bodies: quadruped and spider mech
      var cp = Math.cos(B.pitch + lean * 0.3), sn = Math.sin(B.pitch + lean * 0.3);
      var loc = function (x, y, z) { return [root[0] + x * cp - y * sn, root[1] + x * sn + y * cp, root[2] + (z || 0)]; };
      pose.axis = [cp, sn, 0]; pose.up = [-sn, cp, 0];
      if (ch.kind === 'quad' && ch.beast) {
        /* An animal's body: the spine bends in the middle (flex), the neck carries the head high at rest and
           low and forward at speed, the head turns to what it watches, the jaw is hinged, the tail is a chain. */
        var Bz = ch.beast, flex = B.flex || 0, pa = B.pitch + lean * 0.3 + (Bz.tilt || 0), fa2 = pa - flex, gq = B.gp;
        var locB = function (x, y, z) { var a2 = pa + (x < 0 ? flex : -flex), c2 = Math.cos(a2), s2 = Math.sin(a2); return [root[0] + x * c2 - y * s2, root[1] + x * s2 + y * c2, root[2] + (z || 0)]; };
        var nb = locB(Bz.half + 0.03, 0.10);
        var Wb = aimFrom(nb, 1), tb2 = S.twist.x;
        spring(S.jaw, AC.jaw, 60, 0.75, dt);
        var carry = Bz.neckUp * (1 - 0.55 * gq.run - 0.3 * (gq.gal || 0)) - 0.35 * AC.ext + 0.12 * B.idle * idleNoise(S.t, B.P, 5.0) - 0.4 * Math.max(0, FL);
        var na = fa2 + carry + 0.5 * Wb, nlen = Bz.neck * (1 + 0.28 * AC.ext);
        var hdp = [nb[0] + nlen * Math.cos(na) * Math.cos(0.6 * tb2), nb[1] + nlen * Math.sin(na), nb[2] + nlen * Math.cos(na) * Math.sin(0.6 * tb2)];
        var ga2 = 0.35 * fa2 + 0.9 * Wb - 0.10 * (1 - AC.alert) + 0.10 * B.idle * idleNoise(S.t, B.P, 6.0);
        var gzb = [Math.cos(ga2) * Math.cos(tb2), Math.sin(ga2), Math.cos(ga2) * Math.sin(tb2)];
        var actB = S.act && S.act.name === 'bite' ? S.act : null;
        if (actB && actB.target && AC.ext > 0) {
          // biting at something: the head goes to it as far as the neck will stretch, muzzle first
          var tl = B.toL(actB.target), want = sub(tl, mul(gzb, Bz.skull)), wd = sub(want, nb), wl = len(wd) || 1, wmax = Bz.neck * 1.45;
          if (wl > wmax) want = add(nb, mul(wd, wmax / wl));
          hdp = lerp3(hdp, want, AC.ext);
          var td2 = sub(tl, hdp), tl2 = len(td2);
          if (tl2 > 1e-4) { gzb = lerp3(gzb, mul(td2, 1 / tl2), 0.8 * AC.ext); gzb = mul(gzb, 1 / (len(gzb) || 1)); }
        }
        var sdb = [-Math.sin(tb2), 0, Math.cos(tb2)], sl2 = 1;
        // keep the head's side vector square to where it looks
        var sdot = dot(sdb, gzb); sdb = sub(sdb, mul(gzb, sdot)); sl2 = len(sdb) || 1; sdb = mul(sdb, 1 / sl2);
        var gub = [sdb[1] * gzb[2] - sdb[2] * gzb[1], sdb[2] * gzb[0] - sdb[0] * gzb[2], sdb[0] * gzb[1] - sdb[1] * gzb[0]];
        var jo = clamp(S.jaw.x, 0, 1.1), hinge = add(hdp, add(mul(gzb, 0.02), mul(gub, -0.035)));
        var jd = add(mul(gzb, Math.cos(jo)), mul(gub, -Math.sin(jo))), jtip = add(hinge, mul(jd, Bz.jaw));
        pose.back = locB(-(Bz.back || Bz.half), 0); pose.front = locB(Bz.half, 0); pose.neck = nb; pose.head = hdp; pose.gaze = gzb; pose.side = sdb;
        pose.mounts = [{ joint: hdp, base: hinge, tip: jtip, dir: jd, flash: 0, side: 0 }];
        pose.jaw = jo; pose.alert = AC.alert; pose.flex = flex;
        if (actB && !actB.done && actB.t >= 0.365 * actB.dur) {
          actB.done = true;
          var mz = B.toW(add(hdp, mul(gzb, Bz.skull)));
          S.events.push({ type: 'bite', pos: mz, dir: [gzb[0] * Math.cos(S.h) - gzb[2] * Math.sin(S.h), gzb[1], gzb[0] * Math.sin(S.h) + gzb[2] * Math.cos(S.h)], miss: actB.target ? len(sub(mz, actB.target)) : 0 });
        }
        var Jb = S.jump;
        if (Jb && Jb.pounce && Jb.stage === 'land' && !Jb.struck) { Jb.struck = true; S.events.push({ type: 'pounce', pos: B.toW(add(hdp, mul(gzb, Bz.skull))) }); }
        if (ch.tail) {
          // the tail streams out at speed, goes up when the animal is roused, tucks under after a blow, and wags at rest
          // (the root of the tail also swings with the hips at every stride, and that swing runs down the chain)
          var Tl = ch.tail, wag = Tl.wag * B.idle * Math.sin(4 * TAU * S.t / B.P) + 0.6 * Tl.wag * AC.alert * Math.sin(19 * S.t) + Tl.sway * gq.moving * Math.sin(TAU * S.phase);
          pose.tailPts = tailStep(S, ch, B, locB(Tl.at[0], Tl.at[1]), pa + flex,
            { lift: Tl.lift * (0.45 * gq.run + 0.75 * (gq.gal || 0)) + Tl.alert * AC.alert - 0.7 * Math.abs(FL), yaw: wag }, dt);
          pose.tail = pose.tailPts[Tl.n];
        } else pose.tail = locB(-Bz.half - 0.2, 0.05);
      } else if (ch.kind === 'quad') {
        var neck = loc(0.40, 0.08), hd = loc(0.60, 0.22);
        var Wq = (aimFrom(hd, 1) + 0.2 * B.idle * idleNoise(S.t, B.P, 5.0)) * 0.8, tq = S.twist.x;      // the head turns on the neck
        var dq = [Math.cos(Wq) * Math.cos(tq), Math.sin(Wq), Math.cos(Wq) * Math.sin(tq)];
        pose.back = loc(-0.36, 0.02); pose.front = loc(0.36, 0.02); pose.neck = neck; pose.head = hd; pose.gaze = dq; pose.side = [-Math.sin(tq), 0, Math.cos(tq)];
        pose.tail = loc(-0.72, 0.16 + pose.pack * 2.2, 0.09 * B.idle * Math.sin(4 * TAU * S.t / B.P));
        // the gun hangs under the head, fixed to it
        var qs = pose.side, qup = [qs[1] * dq[2] - qs[2] * dq[1], qs[2] * dq[0] - qs[0] * dq[2], qs[0] * dq[1] - qs[1] * dq[0]];
        var hb = add(add(hd, mul(dq, S.kick[0].x)), mul(qup, -0.07));
        pose.mounts = [{ joint: hd, base: hb, tip: add(hb, mul(dq, 0.34)), dir: dq, flash: S.flash[0], side: 0 }];
      } else if (ch.octo) {
        // crawling: the mantle sits behind the head and wobbles after it; each arm is a curve through its leg
        var Oq = ch.octo, actO = S.act && S.act.name === 'grab' ? S.act : null, breathe = 1 + 0.05 * Math.sin(TAU * S.t / 1.9) - 0.2 * clamp(S.jaw.x, 0, 1);
        aimFrom(loc(0.15, 0.1), 1);
        pose.back = loc(-0.2, 0); pose.front = loc(0.2, 0); pose.eye = loc(0.10, 0.12);
        octoMantle(pose, loc(-0.10, 0.13), loc(-0.40, 0.20 + pose.pack * 2.5, 0.05 * B.idle * Math.sin(2 * TAU * S.t / B.P)), Oq.mantle * breathe);
        pose.arms = legs.map(function (l) { return armCurve(l.hip, l.knee, l.ankle, Oq.arm.seg); });
        if (actO) {
          // the arm nearest the target leaves the ground and reaches for it, link by link
          var gT = actO.target ? B.toL(actO.target) : loc(0.85, 0.35, 0.2), bestD = 1e9;
          if (actO.arm < 0) legs.forEach(function (l, k) { var dq = len(sub(gT, l.hip)); if (dq < bestD) { bestD = dq; actO.arm = k; } });
          var la = legs[actO.arm], cur = pose.arms[actO.arm], seg7 = Oq.arm.seg, guess7 = cur.map(function (q, k) { return [q[0], q[1] + 0.25 * Math.sin(Math.PI * k / 6), q[2]]; });
          var rc7 = reachChain(guess7, la.hip, gT, seg7);
          pose.arms[actO.arm] = cur.map(function (q, k) { return lerp3(q, rc7[k], AC.ext); });
          for (var ak = 1; ak <= 6; ak++) { var aq = pose.arms[actO.arm], ad = sub(aq[ak], aq[ak - 1]), al2 = len(ad) || 1; aq[ak] = add(aq[ak - 1], mul(ad, seg7 / al2)); }      // on the way out and back its links keep their length
          if (!actO.done && actO.t >= 0.42 * actO.dur) {
            actO.done = true;
            var gw7 = B.toW(pose.arms[actO.arm][6]); S.events.push({ type: 'grab', pos: gw7, arm: actO.arm, miss: actO.target ? len(sub(gw7, actO.target)) : 0 });
          }
        }
        if (AC.ink) S.events.push({ type: 'ink', pos: B.toW(loc(-0.3, 0.1)), dir: [-Math.cos(S.h), 0.2, -Math.sin(S.h)] });
        pose.tail = pose.arms[0][6];
        pose.mounts = [{ joint: root, base: root, tip: pose.eye, dir: [cp, sn, 0], flash: 0, side: 0 }];
      } else if (ch.arthro) {
        /* A scorpion-like body: a low carapace, two clawed arms held out in front, and a tail curled up over the
           back. The claws drift towards what is being watched; one shoots out to pinch. The tail is the same chain
           as any other tail, with a rest shape that curls forward, and a strike that drags it onto a target. */
        var Az = ch.arthro, Cw = Az.claw, actA = S.act && (S.act.name === 'pinch' || S.act.name === 'sting') ? S.act : null;
        aimFrom(loc(Az.half, 0.05), 1);
        spring(S.jaw, AC.jaw, 60, 0.8, dt);
        pose.back = loc(-Az.half, 0); pose.front = loc(Az.half, 0); pose.dome = loc(0.04, 0.05); pose.eye = Az.head ? loc(Az.head[0], Az.head[1]) : loc(Az.half + 0.02, 0.07);
        if (Az.thorax) pose.thorax = [loc(Az.thorax[0], Az.thorax[1]), loc(Az.thorax[2], Az.thorax[3])];
        var pT = Cw && actA && actA.name === 'pinch' ? (actA.target ? B.toL(actA.target) : Cw.strikeAt ? loc(Cw.strikeAt[0], Cw.strikeAt[1], Cw.strikeAt[2]) : loc(Cw.rest[0] + 0.28, Cw.rest[1] + 0.05, 0.12)) : null;
        if (pT && !actA.side) actA.side = pT[2] - root[2] >= 0 ? 1 : -1;
        pose.claws = [];
        for (var cs = 0; Cw && cs < 2; cs++) {
          var sg = cs === 0 ? 1 : -1, shc = loc(Cw.at[0], Cw.at[1], sg * Cw.at[2]);
          var tipT = loc(Cw.rest[0], Cw.rest[1] + 0.03 * B.idle * idleNoise(S.t, B.P, 3 + cs), sg * Cw.rest[2]), open = 0.4 + 0.25 * AC.alert;
          if (B.aim) { tipT[1] += clamp(0.3 * (B.aim[1] - tipT[1]), -0.08, 0.3); tipT[2] += clamp(0.3 * (B.aim[2] - tipT[2]), -0.18, 0.18); }
          if (pT && (Az.both || actA.side === sg)) { tipT = lerp3(tipT, Az.both ? [pT[0], pT[1], pT[2] + sg * 0.06] : pT, AC.ext); open = (0.4 + 0.8 * clamp(S.jaw.x, 0, 1)) * (1 - 0.9 * AC.shut); }
          // the hand points mostly forwards, turning towards what it reaches for
          var rd = sub(tipT, shc), rl = len(rd) || 1, hdv = [0.5 * cp + 0.5 * rd[0] / rl, 0.5 * sn + 0.5 * rd[1] / rl, 0.5 * rd[2] / rl], hl = len(hdv) || 1;
          hdv = mul(hdv, 1 / hl);
          var kc = ik2(shc, sub(tipT, mul(hdv, Cw.hand)), Cw.upper, Cw.lower, [0, 1, sg * 0.8]), wr = kc.end, tipC = add(wr, mul(hdv, Cw.hand));
          var inw = [0, 0, -sg], io = dot(inw, hdv); inw = sub(inw, mul(hdv, io)); inw = mul(inw, 1 / (len(inw) || 1));
          var fa3 = add(wr, mul(hdv, 0.30 * Cw.hand)), fd3 = add(mul(hdv, Math.cos(open)), mul(inw, Math.sin(open)));
          pose.claws.push({ shoulder: shc, elbow: kc.mid, wrist: wr, tip: tipC, fingerA: fa3, fingerB: add(fa3, mul(fd3, 0.72 * Cw.hand)), side: sg, open: open });
          if (pT && (Az.both || actA.side === sg) && !actA.done && actA.t >= 0.41 * actA.dur) {
            actA.done = true;
            var cw2 = B.toW(tipC); S.events.push({ type: 'pinch', pos: cw2, claw: cs, miss: actA.target ? len(sub(cw2, actA.target)) : 0 });
          }
        }
        if (ch.tail) {
        var Ts = ch.tail, tb3 = loc(Ts.at[0], Ts.at[1]), pull = null, sT = null;
        if (actA && actA.name === 'sting') {
          sT = actA.target ? B.toL(actA.target) : Az.stingAt ? loc(Az.stingAt[0], Az.stingAt[1], 0) : loc(Az.half + 0.42, 0.02, 0);
          if (AC.sting > 0) {
            // a first guess that arches over the back, then links of the right length fitted to it
            var guess = [], top = Az.under ? Math.min(tb3[1], sT[1]) - 0.3 * Ts.n * Ts.seg : Math.max(tb3[1], sT[1]) + 0.42 * Ts.n * Ts.seg;      // a wasp's sting curls round from below
            for (var gk = 0; gk <= Ts.n; gk++) { var gt = gk / Ts.n, g1 = 1 - gt; guess.push([g1 * g1 * tb3[0] + 2 * g1 * gt * (0.5 * tb3[0] + 0.5 * sT[0]) + gt * gt * sT[0], g1 * g1 * tb3[1] + 2 * g1 * gt * top + gt * gt * sT[1], g1 * g1 * tb3[2] + 2 * g1 * gt * 0.5 * (tb3[2] + sT[2]) + gt * gt * sT[2]]); }
            // it must go over the body, not through it: links above the back are kept clear of it, and the tip lands where that leaves it
            var rp = reachChain(guess, tb3, sT, Ts.seg, 0.86), clearY = root[1] + 0.40, rk;
            if (!Az.under) for (rk = 1; rk < Ts.n; rk++) if (rp[rk][0] < root[0] + Az.half + 0.12 && rp[rk][1] < clearY) rp[rk][1] = clearY;
            for (rk = 1; rk <= Ts.n; rk++) { var rd2 = sub(rp[rk], rp[rk - 1]), rl2 = len(rd2) || 1; rp[rk] = add(rp[rk - 1], mul(rd2, Ts.seg / rl2)); }
            pull = { pts: rp, k: AC.sting };
          }
        }
        pose.tailPts = tailStep(S, ch, B, tb3, B.pitch + lean * 0.3,
          { lift: -0.45 * AC.rear - 0.25 * Math.abs(FL), curl: -0.10 * AC.rear, yaw: Ts.wag * B.idle * Math.sin(2 * TAU * S.t / B.P) + Ts.sway * B.gp.moving * Math.sin(TAU * S.phase) + 0.4 * S.twist.x, pull: pull }, dt);
        var tN = pose.tailPts[Ts.n], tM = pose.tailPts[Ts.n - 1], sd3 = sub(tN, tM);
        pose.tail = tN;
        pose.mounts = [{ joint: tM, base: tM, tip: tN, dir: mul(sd3, 1 / (len(sd3) || 1)), flash: 0, side: 0 }];
        if (actA && actA.name === 'sting' && !actA.done && actA.t >= 0.42 * actA.dur) {
          actA.done = true;
          var sw3 = B.toW(tN); S.events.push({ type: 'sting', pos: sw3, miss: actA.target ? len(sub(sw3, actA.target)) : 0 });
        }
        } else { pose.tail = pose.back; pose.mounts = [{ joint: root, base: root, tip: pose.eye, dir: [cp, sn, 0], flash: 0, side: 0 }]; }
      } else {
        var tb = loc(0.05, 0.72);
        var Wh = aimFrom(tb, 1), tt = S.twist.x;                                                           // the turret goes all the way round
        var dh = [Math.cos(Wh) * Math.cos(tt), Math.sin(Wh), Math.cos(Wh) * Math.sin(tt)];
        var bb = add(tb, mul(dh, S.kick[0].x));
        pose.back = loc(-0.5, 0.12); pose.front = loc(0.5, 0.12); pose.dome = loc(-0.05, 0.36); pose.eye = loc(1.0, 0.08);
        pose.mounts = [{ joint: tb, base: bb, tip: add(bb, mul(dh, 1.45)), dir: dh, flash: S.flash[0], side: 0 }];
      }
    }
    return pose;
  }

  CHARACTERS.mantis = (function () {
    var legs = [];
    [1, -1].forEach(function (sd) { legs.push(leg((sd > 0 ? 'R' : 'L') + '2', sd, [0.12, 0, sd * 0.07], [0.34, sd * 0.42], 0.42, 0.50, [0.1, 1, sd * 0.3])); legs.push(leg((sd > 0 ? 'R' : 'L') + '3', sd, [-0.08, 0, sd * 0.07], [-0.40, sd * 0.40], 0.42, 0.50, [-0.1, 1, sd * 0.3])); });
    return {
      // four walking legs, the front of the body held upright, and two folded forelegs that strike together
      id: 'mantis', label: 'Mantis', kind: 'hex', L: 0.6, rootHeight: 0.42, crouchDrop: 0.35, runDrop: 0,
      vmax: 2.2, viewH: 2.4, jumpH: 0, bob: 0.4, sway: 0.3, liftWalk: 0.2, liftRun: 0.2, runStride: 1,
      legs: legs,
      gait: { walk: { phases: [0, 0.5, 0.5, 0], duty: [0.72, 0.60] }, run: null, frRun: 0.7, frMax: 1.2 },
      arthro: { half: 0.22, look: 'mantis', both: true, strike: 0.34, rock: 0.035, thorax: [0.18, 0.04, 0.50, 0.50], head: [0.56, 0.60],
        claw: { at: [0.46, 0.44, 0.07], upper: 0.30, lower: 0.30, hand: 0.24, rest: [0.66, 0.50, 0.10], strikeAt: [1.12, 0.45, 0] } },
      mount: { type: 'jaw', n: 1, rate: 2, kick: 0, rise: 0, omega: 30, aimOmega: 9, min: -0.3, max: 0.5, yaw: 0.6, bodyKick: 0 }
    };
  })();
  CHARACTERS.wasp = (function () {
    var legs = [], ax = [0.10, 0.0, -0.10], rx = [0.30, 0.02, -0.28], rz = [0.30, 0.36, 0.32];
    [1, -1].forEach(function (sd) { for (var k = 0; k < 3; k++) legs.push(leg((sd > 0 ? 'R' : 'L') + (k + 1), sd, [ax[k], -0.03, sd * 0.07], [rx[k], sd * rz[k]], 0.26, 0.30, [0.15 * (1 - k), 1, sd * 0.3])); });
    return {
      // a giant wasp: six legs in two tripods on the ground, a hanging abdomen that curls round to sting, and wings that carry it
      id: 'wasp', label: 'Giant wasp', kind: 'hex', L: 0.34, rootHeight: 0.26, crouchDrop: 0.3, runDrop: 0,
      vmax: 1.6, viewH: 1.8, jumpH: 0, bob: 0.3, sway: 0.3, liftWalk: 0.2, liftRun: 0.2, runStride: 1,
      legs: legs,
      gait: { walk: { phases: [0, 0.5, 0, 0.5, 0, 0.5], duty: [0.66, 0.52] }, run: null, frRun: 0.7, frMax: 1.2 },
      arthro: { half: 0.16, look: 'wasp', claw: null, head: [0.27, 0.03], under: true, stingAt: [0.12, -0.30] },
      tail: { at: [-0.18, 0.0], n: 3, seg: 0.17, rest: 0.30, curl: 0.25, omega: 14, zeta: 0.5, soft: 0.2, sag: 0.05, bend: 0.5, lift: 0, wag: 0.05, alert: 0, sway: 0.05 },
      fly: { beat: 9, amp: 1.0, w1: 0.30, w2: 0.34, chord: 0.16, zfold: false, at: [0.02, 0.10, 0.07], vmin: 0, vmax: 7, hover: true, glide: false, turn: 3.2, acc: 9, climb: 3, sink: 3, height: 1.3, low: 0.5, heave: 0.012, pitch0: 0.25, hang: [-0.12, -0.75], view: 1.9 },
      mount: { type: 'jaw', n: 1, rate: 2, kick: 0, rise: 0, omega: 30, aimOmega: 9, min: -0.3, max: 0.5, yaw: 0.6, bodyKick: 0 }
    };
  })();
  CHARACTERS.dragon = {
    // four legs, a long neck and tail, and wings: it walks and trots, and it flies, but too heavy to hang in the air it must keep moving
    id: 'dragon', label: 'Dragon', kind: 'quad', L: 1.1, rootHeight: 1.12, crouchDrop: 0.35, runDrop: 0.04,
    vmax: 7, viewH: 4.8, jumpH: 0.45, bob: 0.7, sway: 0.5, liftWalk: 0.10, liftRun: 0.16, runStride: 1.05,
    legs: [
      leg('RH', 1, [-0.62, -0.06, 0.28], [-0.66, 0.36], 0.58, 0.62, [-1, 0.25, 0]),
      leg('RF', 1, [0.62, 0.0, 0.30], [0.66, 0.38], 0.60, 0.62, [1, 0.1, 0]),
      leg('LH', -1, [-0.62, -0.06, -0.28], [-0.66, -0.36], 0.58, 0.62, [-1, 0.25, 0]),
      leg('LF', -1, [0.62, 0.0, -0.30], [0.66, -0.38], 0.60, 0.62, [1, 0.1, 0])
    ],
    gait: { walk: { phases: [0, 0.75, 0.5, 0.25], duty: [0.72, 0.60] }, run: { phases: [0, 0.5, 0.5, 0], duty: [0.48, 0.38] }, frRun: 0.5, frMax: 2.5 },
    beast: { half: 0.70, neck: 1.0, neckUp: 0.7, skull: 0.50, jaw: 0.42, flex: 0, rock: 0, tilt: 0.04, look: 'dragon' },
    saddle: { at: [0.34, 0.44], stirrup: [0.12, -0.44, 0.40], hands: [0.36, 0.16, 0.10], reins: 'neck' },      // astride the shoulders, in front of the wings
    tail: { at: [-0.74, 0.0], n: 9, seg: 0.30, rest: 0.14, curl: 0.03, omega: 8, zeta: 0.45, soft: 0.55, sag: 0.06, bend: 0.3, lift: 0.12, wag: 0.07, alert: 0.2, sway: 0.16 },
    fly: { beat: 1.15, amp: 0.75, w1: 1.5, w2: 2.1, chord: 0.9, at: [0.30, 0.24, 0.26], vmin: 5, vmax: 16, hover: false, glide: true, turn: 0.8, acc: 4, climb: 3.5, sink: 4, height: 4.2, low: 1.7, heave: 0.16, pitch0: 0.04, slowPitch: 0.45, hang: [-0.30, -0.50], view: 2.1 },
    mount: { type: 'jaw', n: 1, rate: 2, kick: 0, rise: 0, omega: 30, aimOmega: 8, min: -0.8, max: 0.6, yaw: 0.9, bodyKick: 0 }
  };
  // ----------------------------------------------------------------- octopus
  /* Eight arms and no bones. On the ground it crawls: each arm is a leg to the gait rules (a tip that is planted,
     lifted and planted again), drawn as one smooth curve from the body through the bend to the tip, with the
     free end curling. In the water it swims mantle first by jets: a short squeeze that drives it forward, then a
     glide while the mantle refills. There the arms are eight of the same chains as a tail, trailing behind,
     drawn together by each stroke and spreading in the glide. */
  CHARACTERS.octopus = (function () {
    var legs = [], ang = [0.45, 1.15, 1.95, 2.7], nm = ['1', '2', '3', '4'];
    [1, -1].forEach(function (sd) { for (var k = 0; k < 4; k++) legs.push(leg((sd > 0 ? 'R' : 'L') + nm[k], sd, [0.12 * Math.cos(ang[k]), -0.04, sd * 0.12 * Math.sin(ang[k])], [0.60 * Math.cos(ang[k]), sd * 0.60 * Math.sin(ang[k])], 0.40, 0.44, [0.2 * Math.cos(ang[k]), 1, sd * 0.3 * Math.sin(ang[k])])); });
    return {
      id: 'octopus', label: 'Octopus', kind: 'hex', L: 0.5, rootHeight: 0.24, crouchDrop: 0.4, runDrop: 0,
      vmax: 1.4, viewH: 2.3, jumpH: 0, bob: 0.5, sway: 0.5, liftWalk: 0.14, liftRun: 0.14, runStride: 1,
      legs: legs,
      // the arms move in a ripple, never more than two at a time
      gait: { walk: { phases: [0, 0.5, 0.25, 0.75, 0.5, 0, 0.75, 0.25], duty: [0.78, 0.70] }, run: null, frRun: 0.7, frMax: 1.2 },
      octo: { mantle: 0.20, head: 0.13, vswim: 3.0, arm: { n: 6, seg: 0.14, rest: 0, curl: 0, omega: 8, zeta: 0.5, soft: 0.55, sag: 0.02, bend: 0.5, inert: 0.6 } },
      mount: { type: 'jaw', n: 1, rate: 2, kick: 0, rise: 0, omega: 30, aimOmega: 8, min: -0.3, max: 0.5, yaw: 0.6, bodyKick: 0 }
    };
  })();
  /* People who are not soldiers: the same body in other clothes (the rig dresses them), with nothing in the
     hands or a case in one of them. They walk, run, crouch, jump, climb, ride, are hit and fall as a soldier does. */
  function civilian(id, label, kit) {
    var so = CHARACTERS.soldier, c = {}, k;
    for (k in so) c[k] = so[k];
    c.id = id; c.label = label; c.vmax = 5.2;
    c.mount = { type: 'held', kit: kit, civil: true, omega: so.mount.omega, aimOmega: so.mount.aimOmega, min: so.mount.min, max: so.mount.max, yaw: so.mount.yaw };
    return c;
  }
  CHARACTERS.person = civilian('person', 'Person', 'hands');
  CHARACTERS.technician = civilian('technician', 'Technician', 'case');
  CHARACTERS.scientist = civilian('scientist', 'Scientist', 'hands');
  CHARACTERS.hazmat = civilian('hazmat', 'Scientist in a hazmat suit', 'hands');
  CHARACTERS.woman = civilian('woman', 'Woman', 'hands');
  CHARACTERS.woman.sway = 1.35; CHARACTERS.woman.vmax = 5.0;      // the hips go from side to side a little more
  // an arm on the ground: six links of fixed length from the body to the planted tip, arching up through the bend of its leg
  function armCurve(hip, knee, foot, seg) {
    var c = [2 * knee[0] - 0.5 * (hip[0] + foot[0]), 2 * knee[1] - 0.5 * (hip[1] + foot[1]), 2 * knee[2] - 0.5 * (hip[2] + foot[2])], pts = [], i;
    for (i = 0; i <= 6; i++) { var u = i / 6, w = 1 - u; pts.push([w * w * hip[0] + 2 * w * u * c[0] + u * u * foot[0], w * w * hip[1] + 2 * w * u * c[1] + u * u * foot[1], w * w * hip[2] + 2 * w * u * c[2] + u * u * foot[2]]); }
    return reachChain(pts, hip, foot, seg, 1);
  }
  // inp.grab = { target }: the nearest arm lifts off the ground, shoots out and curls round the target ('grab' event).
  // inp.ink: a puff of ink ('ink' event), and in the water a burst of speed away from it.
  function octoTick(S, ch, inp, dt) {
    var AC = { lean: 0, tw: 0, ext: 0, load: 0, jaw: 0, alert: 0 }, a = S.act, q;
    S.actBack = 0; S.actCrouch = 0; S.inkT = Math.max(0, (S.inkT || 0) - dt);
    if (inp.grab && !a && S.mode === 'ground') a = S.act = { name: 'grab', t: 0, dur: 0.8, done: false, target: inp.grab.target ? inp.grab.target.slice() : null, arm: -1 };
    if (a && a.name === 'grab') {
      a.t += dt; q = Math.min(a.t / a.dur, 1); AC.alert = 1;
      AC.ext = smooth(0.04, 0.40, q) * (1 - smooth(0.62, 1, q)); AC.lean = 0.15 * AC.ext; S.actBack = -0.05 * AC.ext;
      if (a.t >= a.dur) S.act = null;
    }
    if (inp.ink && S.inkT <= 0) { S.inkT = 1.2; AC.ink = true; S.jaw.v += 9; }
    spring(S.jaw, 0, 14, 0.6, dt);                              // the mantle's squeeze, shared by ink and jets
    return AC;
  }
  function octoMantle(pose, c, tip, r) { pose.mantle = { c: c, tip: tip, r: r }; pose.dome = c; }

  function enterSwim(S, ch, env) {
    if (!ch.octo || S.mode !== 'ground') return false;
    letGo(S); S.mode = 'swim'; S.swim = { vm: 0, depth: 0.6 }; S.v = 0; S.a = 0; S.om = 0; S.chains = {}; S.pitch.x = S.pitch.v = 0; S.jump = null;
    S.kv = [0, 0]; S.mv = [0, 0];
    return true;
  }
  function leaveSwim(S, ch, env) { if (S.mode === 'swim') { S.swim = null; leaveLadder(S, ch, env); } }
  // inputs in the water: speed, steer or heading, depth (metres above the bottom), ink
  function stepSwim(S, ch, inp, st, env, dt) {
    var O = ch.octo, W = S.swim, i;
    S.t += dt;
    var he = inp.heading != null ? wrapPi(inp.heading - S.h) : 0, omT = inp.heading != null ? clamp(he * 3, -1.8, 1.8) : clamp(inp.steer || 0, -1, 1) * 1.8;
    S.om += (omT - S.om) * decay(5, dt); S.h = wrapPi(S.h + S.om * dt);
    var hc = Math.cos(S.h), hs = Math.sin(S.h);
    function toW(p) { var x = p[0] - S.x, z = p[2] || 0; return [S.px + x * hc - z * hs, p[1], S.pz + x * hs + z * hc]; }
    var terrain = function (lx, lz) { return env.terrain(S.px + (lx - S.x) * hc - (lz || 0) * hs, S.pz + (lx - S.x) * hs + (lz || 0) * hc); };
    var AC = octoTick(S, ch, inp, dt);
    // jets: a stroke takes the first third of the cycle; drag does the rest. Thrust is sized to give the speed asked for on average
    W.vm += (clamp(inp.speed || 0, 0, O.vswim) - W.vm) * decay(1.6, dt);
    var k = W.vm / O.vswim, P = lerp(1.5, 0.8, k), drag = 2.4;
    S.phase = frac(S.phase + dt / P);
    var stroke = S.phase < 0.32 ? Math.sin(Math.PI * S.phase / 0.32) : 0, v0 = S.v;
    S.v += (drag * W.vm / 0.204 * stroke - drag * S.v) * dt;
    if (AC.ink) S.v += 1.6;
    S.a += ((S.v - v0) / dt - S.a) * decay(30, dt);
    // depth: it climbs or sinks towards the height asked for, nose following the path
    var floor = terrain(S.x, 0), yT = floor + clamp(inp.depth === undefined ? 1.2 : inp.depth, 0.32, 8), vy = clamp((yT - S.y) * 1.6, -0.9, 0.9) * (0.35 + 0.65 * Math.min(1, S.v / 0.8 + 0.3));
    S.y = Math.max(S.y + vy * dt, floor + 0.28); S.lastY = S.y;
    spring(S.pitch, clamp(Math.atan2(vy, Math.max(S.v, 0.6)), -0.7, 0.7), 6, 1, dt);
    spring(S.bank, clamp(S.v * S.om / G * 1.5, -0.5, 0.5), 8, 1, dt);
    var cpi = Math.cos(S.pitch.x), sp2 = Math.sin(S.pitch.x);
    S.x += S.v * cpi * dt; S.px += hc * S.v * cpi * dt; S.pz += hs * S.v * cpi * dt;
    S.gRef.x = floor; S.standing = false;
    spring(S.lean, 0, 10, 1, dt); spring(S.flinch, 0, 14, 0.5, dt);
    // the body: it travels mantle first, so the mantle is ahead and the arms trail behind
    var hov = 1 - smooth(0.05, 0.5, W.vm), bobY = 0.03 * hov * Math.sin(TAU * S.t / 2.6), root = [S.x, S.y + bobY, 0.05 * hov * Math.sin(TAU * S.t / 3.7)];
    var ax = [cpi, sp2, 0], up = [-sp2, cpi, 0], squeeze = clamp(0.9 * stroke * (0.3 + 0.7 * k) + S.jaw.x * 0.3, 0, 1);
    var at = function (f, u2, z) { return [root[0] + ax[0] * f + up[0] * u2, root[1] + ax[1] * f + up[1] * u2, root[2] + (z || 0)]; };
    var pose = { kind: 'hex', root: root, pitch: S.pitch.x, crouch: 0, pack: 0, lean: 0, legs: [], axis: ax, up: up, swim: true };
    pose.back = at(-0.2, 0); pose.front = at(0.2, 0); pose.eye = at(0.02, 0.10);
    octoMantle(pose, at(0.16, 0.02), at(0.16 + 0.34 * (1 + 0.3 * squeeze), 0.03), O.mantle * (1 - 0.22 * squeeze + 0.04 * Math.sin(TAU * S.t / 1.7) * hov));
    var B = { drift: [0, 0], terrain: terrain }, spread = lerp(0.62, 0.10, smooth(0, 0.6, squeeze)) + 0.5 * hov, ang = S.pitch.x;
    pose.arms = [];
    for (i = 0; i < 8; i++) {
      var ra = TAU * (i + 0.5) / 8, sw = 0.22 * Math.sin(TAU * S.t / 2.3 + 1.9 * i) * (0.4 + 0.6 * hov);
      // hovering, the arms hang below and spread like a skirt; under way they stream straight back
      pose.arms.push(chainStep(S, 'arm' + i, O.arm, ch.L, B, at(-0.09, 0.05 * Math.sin(ra), 0.06 * Math.cos(ra)), ang,
        { lift: -(spread * Math.sin(ra) + sw) - 0.9 * hov, yaw: spread * Math.cos(ra) * (1 + 0.8 * hov) + 0.5 * sw + 0.3 * S.bank.x }, dt));
    }
    pose.tail = pose.arms[0][O.arm.n];
    pose.mounts = [{ joint: root, base: root, tip: pose.eye, dir: ax, flash: 0, side: 0 }];
    if (AC.ink) S.events.push({ type: 'ink', pos: toW(at(-0.05, -0.05)), dir: [-hc * cpi, -sp2, -hs * cpi] });
    S.local = pose; S.local.heading = S.h;
    S.stats = { Fr: 0, stride: S.v * P, period: P, duty: 0.32, run: 0, phases: [0], v: S.v, gait: W.vm > 0.08 ? 'Swim' : 'Hover', steps: 60 / P, air: 0, heading: S.h, turn: S.om, action: null };
    S.pose = poseToWorld(S.local, { ox: S.x, px: S.px, pz: S.pz, c: hc, s: hs });
  }

  // ------------------------------------------------------------------ flying
  /* Wings and flight. A flier has a wingbeat whose rate goes with how hard it is working (climbing, or flying
     slowly), a body that heaves with every stroke, a nose that follows its path, and a bank into every turn.
     Small fliers can hang in the air; big ones cannot and must keep their speed up, and they glide when going
     fast or coming down. Legs hang or tuck and trail a little; tails and necks are the same chains as on the
     ground. On the ground the wings are folded along the body. */
  function wingPose(ch, root, ax, up, fa, fa2, fold) {
    var F = ch.fly, out = [], sw0 = F.sweep || 0.15;
    [1, -1].forEach(function (s) {
      var wr = [root[0] + ax[0] * F.at[0] + up[0] * F.at[1], root[1] + ax[1] * F.at[0] + up[1] * F.at[1], root[2] + s * F.at[2]];
      // spread: out to the side, raised by the stroke angle; folded: swept back along the body
      function dir(a, sweep) { var c = Math.cos(a), sn = Math.sin(a), ss = Math.sin(sweep); return [up[0] * sn - ax[0] * ss * c, up[1] * sn - ax[1] * ss * c, s * c * Math.cos(sweep)]; }
      // (folded like a Z: the arm lies back along the body and the hand doubles forward over it, so no bone changes length)
      var d1 = dir(lerp(fa, 0.22, fold), lerp(sw0, 1.40, fold)), d2 = dir(lerp(fa2, 0.30, fold), lerp(sw0 + 0.2, F.zfold === false ? 1.5 : -1.25, fold));
      var mid = add(wr, mul(d1, F.w1)), tip = add(mid, mul(d2, F.w2));
      // which way the membrane hangs from each bone: behind it when spread, in against the body when folded
      function hang(dv) { var t = [s * (dv[1] * up[2] - dv[2] * up[1]), s * (dv[2] * up[0] - dv[0] * up[2]), s * (dv[0] * up[1] - dv[1] * up[0])], tl = len(t) || 1; return mul(t, 1 / tl); }
      out.push({ root: wr, mid: mid, tip: tip, t1: hang(d1), t2: hang(d2), chord: F.chord, side: s });
    });
    return out;
  }
  // roll a whole pose about a line (the body's long axis): points turn about it, directions just turn
  function rollPose(o, c, ax, ang, key) {
    if (Array.isArray(o)) {
      if (o.length === 3 && typeof o[0] === 'number') {
        var v = DIR_KEYS[key] ? o : sub(o, c), cs = Math.cos(ang), sn = Math.sin(ang), dp = dot(ax, v) * (1 - cs);
        var r = [v[0] * cs + (ax[1] * v[2] - ax[2] * v[1]) * sn + ax[0] * dp, v[1] * cs + (ax[2] * v[0] - ax[0] * v[2]) * sn + ax[1] * dp, v[2] * cs + (ax[0] * v[1] - ax[1] * v[0]) * sn + ax[2] * dp];
        return DIR_KEYS[key] ? r : add(c, r);
      }
      return o.map(function (q) { return rollPose(q, c, ax, ang, key); });
    }
    if (o && typeof o === 'object') { var out = {}; for (var k in o) out[k] = rollPose(o[k], c, ax, ang, k); return out; }
    return o;
  }
  function enterFly(S, ch, env) {
    if (!ch.fly || S.mode !== 'ground') return false;
    letGo(S); S.mode = 'fly'; S.fly = { vy: 0, effort: 0.6 }; S.om = 0; S.jump = null; S.kv = [0, 0]; S.mv = [0, 0]; S.a = 0; S.reachDrop = 0;
    return true;
  }
  function leaveFly(S, ch, env) { if (S.mode === 'fly') { S.fly = null; leaveLadder(S, ch, env); } }
  // inputs in the air: speed, steer or heading, height (metres above the ground), aim, and the creature's own attacks
  function stepFly(S, ch, inp, st, env, dt) {
    var F = ch.fly, W = S.fly, L = ch.L, i;
    S.t += dt;
    var he = inp.heading != null ? wrapPi(inp.heading - S.h) : 0, omT = inp.heading != null ? clamp(he * 2.5, -F.turn, F.turn) : clamp(inp.steer || 0, -1, 1) * F.turn;
    S.om += (omT - S.om) * decay(4, dt); S.h = wrapPi(S.h + S.om * dt);
    var hc = Math.cos(S.h), hs = Math.sin(S.h);
    function toW(p) { var x = p[0] - S.x, z = p[2] || 0; return [S.px + x * hc - z * hs, p[1], S.pz + x * hs + z * hc]; }
    function toL(p) { var x = p[0] - S.px, z = (p[2] || 0) - S.pz; return [S.x + x * hc + z * hs, p[1], -x * hs + z * hc]; }
    var terrain = function (lx, lz) { return env.terrain(S.px + (lx - S.x) * hc - (lz || 0) * hs, S.pz + (lx - S.x) * hs + (lz || 0) * hc); };
    // speed: a big flier cannot go slower than its wings will carry it
    var vT = clamp(inp.speed || 0, F.hover ? 0 : F.vmin, F.vmax), dv = clamp(vT - S.v, -F.acc * dt, F.acc * dt);
    S.a += (dv / dt - S.a) * decay(12, dt); S.v += dv;
    var floor = terrain(S.x, 0), yT = floor + clamp(inp.height === undefined ? F.height : inp.height, F.low, 40);
    W.vy += (clamp((yT - S.y) * 1.3, -F.sink, F.climb) - W.vy) * decay(3, dt);
    S.y = Math.max(S.y + W.vy * dt, floor + F.low * 0.8); S.lastY = S.y; S.gRef.x = floor; S.standing = false;
    // how hard the wings work: more to climb and to fly slowly, less at speed or coming down, where a glider stops beating
    var slow = F.hover ? 1 - 0.4 * S.v / F.vmax : 1 - (S.v - F.vmin) / (F.vmax - F.vmin);
    W.effort += (clamp(0.35 + 0.5 * slow + 0.6 * W.vy / F.climb, 0, 1.3) - W.effort) * decay(4, dt);
    var glide = F.glide ? 1 - smooth(0.18, 0.42, W.effort) : 0, ampK = (0.55 + 0.45 * Math.min(W.effort, 1)) * (1 - 0.88 * glide), freq = F.beat * (0.75 + 0.45 * W.effort);
    S.phase = frac(S.phase + dt * freq);
    var ph = TAU * S.phase, fa = F.amp * ampK * Math.sin(ph) + 0.14 * glide, fa2 = F.amp * ampK * 1.15 * Math.sin(ph - 0.8) - 0.3 * ampK * Math.max(0, Math.cos(ph)) + 0.05 * glide;
    var heave = -F.heave * ampK * Math.cos(ph - TAU / 4);       // the body rises through each downstroke
    spring(S.pitch, clamp(F.pitch0 + 0.7 * Math.atan2(W.vy, Math.max(S.v, 0.4 * F.vmax)) + (F.slowPitch || 0) * smooth(0.55, 1, slow), -0.8, 1.0), 5, 1, dt);      // flying slowly, a big flier rears up
    spring(S.bank, clamp(Math.atan(S.v * S.om / G) + 0.25 * S.om, -1.0, 1.0), 6, 1, dt);
    var cp = Math.cos(S.pitch.x), sn = Math.sin(S.pitch.x), ca = Math.cos(S.pitch.x - F.pitch0);
    S.x += S.v * dt; S.px += hc * S.v * dt; S.pz += hs * S.v * dt;
    var hov = F.hover ? 1 - smooth(0.05, 0.5, S.v / F.vmax) : 0;
    var root = [S.x, S.y + heave + 0.02 * L * hov * Math.sin(TAU * S.t / 1.9), 0.05 * L * hov * Math.sin(TAU * S.t / 2.7)], ax = [cp, sn, 0], up = [-sn, cp, 0];
    // legs: they hang (or are held tucked) under the body and swing back when it speeds up
    var legs = ch.legs.map(function (ld, k) {
      var at = ld.attach, len2 = ld.upper + ld.lower, hip = [root[0] + ax[0] * at[0] + up[0] * at[1], root[1] + ax[1] * at[0] + up[1] * at[1], at[2]];
      var lag = clamp(-0.03 * S.a, -0.2, 0.2) + 0.03 * Math.sin(TAU * S.t / 1.3 + 1.7 * k), hx = (F.hang[0] + lag) * len2, hy = F.hang[1] * len2;
      var foot = [hip[0] + hx, hip[1] + hy, at[2] + ld.side * 0.3 * Math.abs(ld.rest[1] - at[2])];
      var kj = ik2(hip, foot, ld.upper, ld.lower, [ld.pole[0], ld.pole[1], ld.pole[2]]);
      return { hip: hip, knee: kj.mid, ankle: kj.end, ball: kj.end, heel: null, toe: null, planted: false, target: null, side: ld.side };
    });
    var Tn0 = TAU * Math.sqrt(L / G);
    var pose = upperBody(S, ch, inp, st, dt, legs, {
      root: root, pitch: S.pitch.x, gp: { run: F.hover ? 0.3 : 1, gal: 0, moving: 1 - hov, Tn: Tn0, Fr: 0 }, Tn: Tn0, idle: hov, P: idlePeriod(ch), bank: 0, sway0: 0,
      aim: inp.aim ? toL([inp.aim[0], inp.aim[1], inp.aim.length > 2 ? inp.aim[2] : S.pz]) : null, prep: 0, leanBase: 0, toL: toL, toW: toW, terrain: terrain, flex: 0, drift: [0, 0]
    });
    pose.wings = wingPose(ch, root, ax, up, fa, fa2, 0); pose.flying = true;
    S.local = rollPose(pose, root, ax, S.bank.x); S.local.heading = S.h;
    var period = 1 / freq;
    S.stats = { Fr: 0, stride: S.v * period, period: period, duty: 0.5, run: 0, phases: [0], v: S.v, gait: glide > 0.6 ? 'Glide' : S.v < 0.08 * F.vmax && F.hover ? 'Hover' : 'Fly', steps: 60 * freq, air: 1, heading: S.h, turn: S.om, action: S.act ? S.act.name : null };
    S.pose = poseToWorld(S.local, { ox: S.x, px: S.px, pz: S.pz, c: hc, s: hs });
  }

  // ----------------------------------------------------------------- ladder
  // Hands and feet each hold a real rung. A limb lets go, reaches for the rung
  // nearest to where it wants to be, and the body is carried by the other three.
  var LAD_PH = [0, 0.5, 0.55, 0.05], LAD_OFF = [0.62, 0.62, -0.60, -0.60], LAD_DUTY = 0.62;
  function nearestRung(lad, y, kmin) {
    var k0 = Math.round((y - lad.y0) / lad.spacing), best = k0, bd = 1e9;
    for (var k = k0 - 2; k <= k0 + 2; k++) { var d = Math.abs(lad.rung(k) - y); if (d < bd) { bd = d; best = k; } }
    return Math.max(best, kmin);
  }
  function enterLadder(S, ch, env) {
    letGo(S);
    var lad = env.ladder;
    S.ladFrame = frameNow(S);                     // the ladder stands where the body faced it; lad.x is measured in that frame
    S.mode = 'ladder'; S.jump = null; S.hop.x = S.hop.v = 0; S.airB = 0; S.om = 0; S.kv = [0, 0]; S.act = null; S.twist.x = S.twist.v = 0;
    var y = lad.y0 + ch.rootHeight + 0.75;
    S.lad = { y: y, limbs: [] };
    for (var i = 0; i < 4; i++) {
      var k = nearestRung(lad, y + LAD_OFF[i] + (i % 2 ? 0.15 : -0.15) * (i < 2 ? 1 : -1), -99);
      S.lad.limbs.push({ k: k, swing: null, psi: frac(S.phase + LAD_PH[i]) });
    }
    S.v = 0;
  }
  function leaveLadder(S, ch, env) {
    S.mode = 'ground'; S.lad = null; S.v = 0; S.standing = true; S.reachDrop = 0; S.jump = null; S.hop.x = S.hop.v = 0; S.airB = 0;
    S.om = 0; S.kv = [0, 0]; S.bank.x = S.bank.v = 0; S.side.x = S.side.v = 0; S.ladFrame = null;
    S.mv = [0, 0]; S.actCrouch = 0; S.actBack = 0; S.chains = {}; S.ride = null; S.vl = null; S.tv = [1, 0]; S.guard.x = S.guard.v = 0; S.stance.x = S.stance.v = 0;
    var hc = Math.cos(S.h), hs = Math.sin(S.h);
    S.gRef.x = env.terrain(S.px, S.pz); S.gRef.v = 0; S.y = S.lastY = S.gRef.x + ch.rootHeight;
    for (var i = 0; i < S.legs.length; i++) {
      var r = ch.legs[i].rest;
      S.legs[i] = { ball: [S.x + r[0], env.terrain(S.px + r[0] * hc - r[1] * hs, S.pz + r[0] * hs + r[1] * hc), r[1]], swing: null, alpha: 0, strike: 0, slope: 0, fwd: 0, drop: 0, refY: S.gRef.x, w: null, hd: S.h };
    }
  }
  // stand a character somewhere in the world, facing a given way, feet on the ground there
  function place(S, ch, env, x, z, heading) { S.px = x; S.pz = z || 0; S.h = heading || 0; S.act = null; S.carry = null; leaveLadder(S, ch, env); }
  function stepLadder(S, ch, inp, st, env, dt) {
    var lad = env.ladder, Ld = S.lad, i;
    S.t += dt;
    S.crouch += (0 - S.crouch) * decay(6, dt);
    var vc = clamp((inp.speed || 0) * 0.3, 0, 1.3);
    S.v += clamp(vc - S.v, -2 * dt, 2 * dt);
    var T = 2 * lad.spacing / Math.max(S.v, 0.05);
    var moving = S.v > 0.03;
    if (moving) S.phase = frac(S.phase + dt / T);
    Ld.y += S.v * dt;
    var px = lad.x - 0.36 + 0.012 * Math.sin(2 * TAU * S.phase), pz = 0.02 * Math.sin(TAU * S.phase);
    var pts = [];
    for (i = 0; i < 4; i++) {
      var lm = Ld.limbs[i], hand = i < 2, side = i % 2 === 0 ? 1 : -1;
      var psi = frac(S.phase + LAD_PH[i]);
      if (!lm.swing && moving && psi >= LAD_DUTY && lm.psi < LAD_DUTY) {
        var dur = (1 - LAD_DUTY) * T;
        var want = Ld.y + S.v * dur + LAD_OFF[i] + S.v * LAD_DUTY * T * 0.5;
        lm.swing = { s: 0, dur: dur, from: lm.k, to: nearestRung(lad, want, lm.k + 1) };
      }
      lm.psi = psi;
      var z = side * (hand ? 0.13 : 0.11), x0 = lad.x - (hand ? 0 : 0.0);
      var p = [x0, lad.rung(lm.k), z];
      if (lm.swing) {
        var sw = lm.swing; sw.s += dt / sw.dur;
        if (sw.s >= 1) { lm.k = sw.to; lm.swing = null; p = [x0, lad.rung(lm.k), z]; S.events.push({ type: 'grip', limb: i }); }
        else {
          var e = ease(sw.s, st.snap), arc = Math.sin(Math.PI * sw.s);
          p = [x0 - (hand ? 0.10 : 0.13) * arc * st.step, lerp(lad.rung(sw.from), lad.rung(sw.to), e) + 0.02 * arc, z];
        }
      }
      pts.push({ p: p, held: !lm.swing });
    }
    S.x = px; S.y = Ld.y; S.lastY = S.y;
    var wr = l2w(S.ladFrame, [px, 0, 0]); S.px = wr[0]; S.pz = wr[2];
    var root = [px, Ld.y, pz], legs = [];
    for (i = 0; i < 2; i++) {
      var ld = ch.legs[i], F = ld.foot, ball = pts[2 + i].p;
      var hip = [root[0] + ld.attach[0], root[1] + ld.attach[1], root[2] + ld.attach[2]];
      var ankle = [ball[0] - F.fb, ball[1] + F.ah, ball[2]];
      var k = ik2(hip, ankle, ld.upper, ld.lower, [0.35, 0.1, ld.side]);
      legs.push({
        hip: hip, knee: k.mid, ankle: k.end, heel: [ball[0] - F.fb - F.hb, ball[1], ball[2]],
        toe: [ball[0] + F.toe, ball[1], ball[2]], ball: ball, planted: pts[2 + i].held, target: null, side: ld.side
      });
    }
    fireControl(S, ch, { fire: false }, dt);
    spring(S.lean, 0.15, 12, 1, dt);
    spring(S.armed, 0, 14, 1, dt);
    spring(S.pack, 0, 30, 0.4, dt);
    var lean = S.lean.x, u = [Math.sin(lean), Math.cos(lean), 0], f = [Math.cos(lean), -Math.sin(lean), 0];
    var Tt = ch.torso, A = ch.arms;
    var chest = [root[0] + u[0] * Tt.len, root[1] + u[1] * Tt.len, root[2] * 0.5];
    var head = [chest[0] + 0.03, chest[1] + Tt.neck + Tt.headR * 0.7, chest[2]];
    var arms = [];
    for (i = 0; i < 2; i++) {
      var sd = i === 0 ? 1 : -1;
      var sh = add(chest, mul(u, -0.04)); sh[2] = chest[2] + sd * Tt.shoulderW;
      var ka = ik2(sh, pts[i].p, A.upper, A.lower, [-0.4, -1, sd * 0.7]);
      arms.push({ shoulder: sh, elbow: ka.mid, hand: ka.end, side: sd });
    }
    // the weapons go to their stowed places: the rifle across the back, pistols in their holsters
    var kit = heldKit(S, ch), props = [];
    if (kit) for (i = 0; i < kit.props.length; i++) {
      var pl = mixPlace(stowPlace(kit.props[i], i, root, u, f, chest[2]), readyPlace(kit.props[i], i, chest, u, f, 0, 0), S.armed.x);
      var w = propAt(kit.props[i], pl.o, pl.th, pl.z); w.stow = 1 - S.armed.x; props.push(w);
    }
    S.local = {
      kind: 'biped', heading: S.h, root: root, pitch: 0, lean: lean, legs: legs, crouch: 0, pack: 0, chest: chest, head: head,
      gaze: [Math.cos(0.5), Math.sin(0.5), 0], arms: arms, u: u, f: f,
      props: props
    };
    S.pose = poseToWorld(S.local, S.ladFrame);
    S.stats = { Fr: 0, stride: 2 * lad.spacing, period: T, duty: LAD_DUTY, run: 0, phases: LAD_PH, v: S.v, gait: moving ? 'Climb' : 'Holding', steps: moving ? 240 / T : 0, air: 0 };
  }

  // ------------------------------------------------------------------- ledge
  /* Hanging from an edge and climbing up onto it. M.grabLedge(S, ch, env, [x, y, z]) takes hold of the lip of
     a ledge at that point in the world (the wall is in front of the body, the top runs on ahead). The body
     hangs by its hands with its feet against the wall. inp.climb pulls it up: chin to the edge, chest over,
     a knee up, stand. inp.drop lets go. The game's ground function must know the top of the ledge, since
     that is where the feet end up. */
  function grabLedge(S, ch, env, edge) {
    if (ch.kind !== 'biped' || (S.mode !== 'ground' && S.mode !== 'ladder')) return false;
    letGo(S);
    S.ladFrame = frameNow(S);
    var e = w2l(S.ladFrame, edge);
    S.mode = 'ledge'; S.jump = null; S.hop.x = S.hop.v = 0; S.airB = 0; S.om = 0; S.kv = [0, 0]; S.mv = [0, 0]; S.act = null; S.twist.x = S.twist.v = 0; S.vl = null;
    S.ledge = { ex: e[0], ey: e[1], stage: 'hang', t: 0, sw: sp(clamp(0.12 * S.v, 0, 0.5)), top: false };
    S.v = 0; S.a = 0; S.events.push({ type: 'grab', what: 'ledge' });
    return true;
  }
  function stepLedge(S, ch, inp, st, env, dt) {
    var Lg = S.ledge, T = ch.torso, A = ch.arms, k = ch.L / 0.92, ex = Lg.ex, ey = Lg.ey, i, q = 0;
    S.t += dt; Lg.t += dt;
    S.crouch += (0 - S.crouch) * decay(6, dt);
    if (Lg.stage === 'hang') {
      if (inp.drop) { S.ledge = null; leaveLadder(S, ch, env); S.events.push({ type: 'drop', what: 'ledge' }); return stepGround(S, ch, { speed: 0 }, st, env, dt); }
      if ((inp.climb || inp.jump) && Lg.t > 0.25) { Lg.stage = 'up'; Lg.t = 0; }
    }
    var dur = 1.5 * Math.sqrt(k);
    if (Lg.stage === 'up') q = Math.min(Lg.t / dur, 1);
    spring(Lg.sw, 0, 5.5, 0.25, dt);                        // the swing left over from arriving dies away
    // where the chest is, and how far the back leans: hanging; pulled up; over the edge; standing on top
    var a = smooth(0, 0.38, q), b = smooth(0.33, 0.62, q), c = smooth(0.56, 1, q), sway = 0.02 * Math.sin(TAU * S.t / 2.6) * (1 - a);
    var lean = lerp(lerp(lerp(0.10, 0.36, a), 0.62, b), 0.06, c) - 0.5 * Lg.sw.x * (1 - a);
    var u = [Math.sin(lean), Math.cos(lean), 0], f = [Math.cos(lean), -Math.sin(lean), 0];
    var top = [ex + 0.22 * k + u[0] * T.len, ey + ch.rootHeight + u[1] * T.len];
    var cx = lerp(lerp(lerp(ex - 0.20 * k, ex - 0.13 * k, a), ex + 0.10 * k, b), top[0], c) - 0.3 * Lg.sw.x * (1 - a);
    var cy = lerp(lerp(lerp(ey - 0.43 * k, ey + 0.10 * k, a), ey + 0.56 * k, b), top[1], c) + sway;
    var chest = [cx, cy, 0], root = [cx - u[0] * T.len, cy - u[1] * T.len, 0];
    var head = [chest[0] + Math.sin(lean * 0.4) * (T.neck + T.headR * 0.7), chest[1] + Math.cos(lean * 0.4) * (T.neck + T.headR * 0.7), 0];
    // hands: on the lip, pressing down on it as the body comes over, and off it at the end
    var arms = [], legs = [], off = smooth(0.68, 0.92, q);
    for (i = 0; i < 2; i++) {
      var sd = i === 0 ? 1 : -1, sh = add(chest, mul(u, -0.04)); sh[2] = sd * T.shoulderW;
      var grip = [ex - 0.01, ey + 0.02, sd * 0.17], loose = [sh[0] + 0.05, sh[1] - 0.50 * k, sd * 0.24];
      var ka = ik2(sh, lerp3(grip, loose, off), A.upper, A.lower, lerp3([-0.3, -1, sd * 0.6], [-0.8, 0.6, sd * 0.7], b * (1 - off)));
      arms.push({ shoulder: sh, elbow: ka.mid, hand: ka.end, side: sd });
    }
    // feet: toes on the wall while hanging and pulling; then one foot up onto the top, then the other
    for (i = 0; i < 2; i++) {
      var ld = ch.legs[i], F = ld.foot, hip = [root[0] + ld.attach[0], root[1] + ld.attach[1], ld.attach[2]];
      var wall = [ex - 0.03 - F.toe, hip[1] - lerp(0.95, 0.74, a) * ch.L + (i ? 0.05 : 0) * k - 0.25 * Lg.sw.x, ld.attach[2]];
      wall[0] -= 0.35 * Math.max(0, Lg.sw.x);
      var on = smooth(i ? 0.62 : 0.40, i ? 0.86 : 0.64, q), up = [ex + (i ? 0.20 : 0.10) * k + (i ? 0.02 : 0.04), ey, ld.rest[1]];
      var ball = lerp3(wall, up, on); ball[1] += 0.16 * k * Math.sin(Math.PI * on); ball[0] -= 0.12 * k * Math.sin(Math.PI * on);
      var ankle = [ball[0] - F.fb, ball[1] + F.ah, ball[2]], kl = ik2(hip, ankle, ld.upper, ld.lower, [1, 0.2, ld.side * 0.4]);
      if (kl.mid[0] > ex - 0.09 * k && kl.mid[1] < ey) {     // a knee that would go into the wall turns outwards instead
        var lo = 0, hi = 1.45, kk, j;
        for (j = 0; j < 7; j++) { var ph = 0.5 * (lo + hi); kk = ik2(hip, ankle, ld.upper, ld.lower, [Math.cos(ph), 0.2, ld.side * (0.4 + Math.sin(ph))]); if (kk.mid[0] > ex - 0.09 * k) lo = ph; else hi = ph; }
        kl = ik2(hip, ankle, ld.upper, ld.lower, [Math.cos(hi), 0.2, ld.side * (0.4 + Math.sin(hi))]);
      }
      legs.push({ hip: hip, knee: kl.mid, ankle: kl.end, heel: [ball[0] - F.fb - F.hb, ball[1], ball[2]], toe: [ball[0] + F.toe, ball[1], ball[2]], ball: ball, planted: on <= 0 || on >= 1, target: null, side: ld.side });
    }
    fireControl(S, ch, { fire: false }, dt);
    spring(S.lean, lean, 12, 1, dt); spring(S.armed, 0, 14, 1, dt); spring(S.pack, 0, 30, 0.4, dt);
    var kit = heldKit(S, ch), props = [];
    if (kit) for (i = 0; i < kit.props.length; i++) {
      var pl = mixPlace(stowPlace(kit.props[i], i, root, u, f, 0), readyPlace(kit.props[i], i, chest, u, f, 0, 0), S.armed.x);
      var w = propAt(kit.props[i], pl.o, pl.th, pl.z); w.stow = 1 - S.armed.x; props.push(w);
    }
    S.x = root[0]; S.y = root[1]; S.lastY = S.y;
    var wr = l2w(S.ladFrame, [root[0], 0, 0]); S.px = wr[0]; S.pz = wr[2];
    S.local = { kind: 'biped', heading: S.h, root: root, pitch: 0, lean: lean, legs: legs, crouch: 0, pack: 0, chest: chest, head: head,
      gaze: [Math.cos(0.45 * (1 - c)), Math.sin(0.45 * (1 - c)), 0], arms: arms, u: u, f: f, props: props };
    S.pose = poseToWorld(S.local, S.ladFrame);
    S.stats = { Fr: 0, stride: 0, period: dur, duty: 1, run: 0, phases: [0, 0.5], v: 0, gait: Lg.stage === 'hang' ? 'Hanging' : 'Climbing up', steps: 0, air: 0 };
    if (q >= 1) { S.ledge = null; leaveLadder(S, ch, env); S.events.push({ type: 'top' }); }      // on its feet on the top: the ground code takes over
  }

  // ---------------------------------------------------------------- ragdoll
  /* Death. The joints become point masses held together by their bone lengths; gravity,
     ground contact and a few joint limits do the rest. Each particle moves in the character's
     forward-up plane and keeps its sideways offset, which is what a side-view game needs.
     (A 3D engine would hand the skinned skeleton to its own ragdoll instead.) */
  // true length; z never changes. dz, when given, replaces the particles' own sideways gap
  // ----------------------------------------------------------------- riding
  /* A rider on another character. The game steps the mount first, then the rider with env.mount = { S, ch } set
     to the mount's state and character. The mount says where a rider sits (ch.saddle): the seat, measured from
     its body's root along the body and up from it; the stirrups and the place for the hands, measured from the
     seat; and whether there are reins ('bit': to the mouth, 'neck': to a strap round the neck).
     The rider's hips are held to the seat by a spring, so a trot or a gallop lifts him out of the saddle and the
     knees take it up; the feet stay in the stirrups; the back leans with the pace and stays upright when the mount
     pitches; in the air the whole rider rolls with the mount. The hands hold the reins until a weapon is drawn:
     aiming, firing, reloading, the sword and throwing all work from the saddle.
       M.mountUp(S, ch, env, { S: mountState, ch: mountCharacter })   false if that body cannot be ridden
       M.dismount(S, ch, env)                                          stands the rider beside the mount */
  function mountUp(S, ch, env, mount) {
    if (ch.kind !== 'biped' || !mount || !mount.ch || !mount.ch.saddle || !mount.S || S.mode === 'ragdoll') return false;
    letGo(S); S.act = null; S.jump = null; S.lad = null; S.ledge = null; S.ladFrame = null;
    S.mode = 'ride'; S.ride = { d: sp(0), sy: null, svy: 0, acc: 0 };
    S.v = 0; S.a = 0; S.om = 0; S.crouch = 0; S.airB = 0; S.standing = false; S.guard.x = S.guard.v = 0; S.stance.x = S.stance.v = 0; S.vl = null;
    S.events.push({ type: 'mount' });
    return true;
  }
  function dismount(S, ch, env) {
    if (S.mode !== 'ride') return false;
    S.px += 0.95 * Math.sin(S.h); S.pz -= 0.95 * Math.cos(S.h);       // down on the mount's left side
    letGo(S); S.act = null; leaveLadder(S, ch, env);
    S.events.push({ type: 'dismount' });
    return true;
  }
  function stepRide(S, ch, inp, st, env, dt) {
    var Mt = env.mount, Sm = Mt && Mt.S, cm = Mt && Mt.ch, Lm = Sm && Sm.local, sd = cm && cm.saddle, R = S.ride, i;
    if (!Lm || !sd || !Lm.axis || !Lm.up) { dismount(S, ch, env); return stepGround(S, ch, inp, st, env, dt); }      // nothing to sit on
    S.t += dt;
    // the rider's pose is worked out in the mount's own frame
    var fr = frameOf(Sm);
    S.x = fr.ox; S.px = fr.px; S.pz = fr.pz; S.h = fr.h === undefined ? Sm.h : fr.h;
    var ax = Lm.axis, up = Lm.up, sv = [ax[1] * up[2] - ax[2] * up[1], ax[2] * up[0] - ax[0] * up[2], ax[0] * up[1] - ax[1] * up[0]];
    var seat = [Lm.root[0] + ax[0] * sd.at[0] + up[0] * sd.at[1], Lm.root[1] + ax[1] * sd.at[0] + up[1] * sd.at[1], Lm.root[2] + ax[2] * sd.at[0] + up[2] * sd.at[1]];
    // from the seat's frame (forward along the mount, up from its back, to its right) to the mount's frame, and back
    function toM(p) { return [seat[0] + ax[0] * p[0] + up[0] * p[1] + sv[0] * p[2], seat[1] + ax[1] * p[0] + up[1] * p[1] + sv[1] * p[2], seat[2] + ax[2] * p[0] + up[2] * p[1] + sv[2] * p[2]]; }
    function dirM(d) { return [ax[0] * d[0] + up[0] * d[1] + sv[0] * d[2], ax[1] * d[0] + up[1] * d[1] + sv[1] * d[2], ax[2] * d[0] + up[2] * d[1] + sv[2] * d[2]]; }
    function fromM(q) { var d = sub(q, seat); return [dot(d, ax), dot(d, up), dot(d, sv)]; }
    function seatPose(o, key) {
      if (Array.isArray(o)) {
        if (o.length === 3 && typeof o[0] === 'number') return DIR_KEYS[key] ? dirM(o) : toM(o);
        return o.map(function (v) { return seatPose(v, key); });
      }
      if (o && typeof o === 'object') { var r = {}; for (var k2 in o) r[k2] = seatPose(o[k2], k2); return r; }
      return o;
    }
    // the saddle's own rise and fall throws the rider: a spring holds him to it, and he cannot sink into it
    var k = ch.L / 0.92, Tn = TAU * Math.sqrt(ch.L / G), wy = seat[1], vy = R.sy === null ? 0 : (wy - R.sy) / dt;
    R.acc += (clamp((vy - R.svy) / dt, -3 * G, 3 * G) - R.acc) * decay(30, dt); R.sy = wy; R.svy = vy;
    R.d.v -= 0.9 * R.acc * dt; spring(R.d, 0, 13 / Math.sqrt(k), 0.45, dt);
    if (R.d.x < -0.012 * k) { R.d.x = -0.012 * k; R.d.v = Math.max(R.d.v, 0); }
    if (R.d.x > 0.11 * k) { R.d.x = 0.11 * k; R.d.v = Math.min(R.d.v, 0); }
    if (inp.hit) {
      var hi = inp.hit.impulse, hm = Math.sqrt(hi[0] * hi[0] + (hi[2] || 0) * (hi[2] || 0)), hf = hi[0] * fr.c + (hi[2] || 0) * fr.s;
      S.lean.v += 7 * hf / Math.sqrt(k); S.rise.v += 8 * hm; S.flinch.v += 16 * hm; S.flinchDir = hf < 0 ? -1 : 1; R.d.v += 0.6 * hm;
      S.events.push({ type: 'hit' });
    }
    var grounded = Sm.mode === 'ground', gal = grounded ? Sm.gal || 0 : 0, run = grounded ? Sm.run || 0 : 0, still = grounded && Sm.standing ? 1 : 0;
    S.idleT = still ? S.idleT + dt : 0; S.standing = false; S.v = Sm.v || 0; S.crouch = 0; S.airB = 0;
    var root = [0, R.d.x, 0], legs = [];
    for (i = 0; i < 2; i++) {
      var ld = ch.legs[i], F = ld.foot, sg = ld.side, hip = [root[0] + ld.attach[0], root[1] + ld.attach[1], ld.attach[2]];
      var ball = [sd.stirrup[0], sd.stirrup[1], sg * sd.stirrup[2]];
      var kj = ik2(hip, [ball[0] - F.fb, ball[1] + F.ah, ball[2]], ld.upper, ld.lower, [0.6, 0.15, sg]);
      legs.push({ hip: hip, knee: kj.mid, ankle: kj.end, heel: [ball[0] - F.fb - F.hb, ball[1], ball[2]], toe: [ball[0] + F.toe, ball[1], ball[2]], ball: ball, planted: true, target: null, side: sg });
      S.legs[i].fwd = 0; S.legs[i].swing = null;
    }
    var pv = (R.d.v - (R.pv || 0)); R.pv = R.d.v; S.pack.v -= 0.6 * pv; spring(S.pack, 0, 60 / Tn, 0.35, dt);
    var pitchSeat = Math.asin(clamp(ax[1], -1, 1));
    var pose = upperBody(S, ch, inp, st, dt, legs, {
      root: root, pitch: 0, gp: { moving: 0, run: 0, gal: 0, Fr: 0 }, Tn: Tn, idle: still, P: idlePeriod(ch),
      bank: grounded && Sm.bank ? Math.tan(0.7 * Sm.bank.x) : 0, sway0: 0, flex: 0, drift: [0, 0], prep: 0,
      aim: inp.aim ? fromM(w2l(fr, [inp.aim[0], inp.aim[1], inp.aim.length > 2 ? inp.aim[2] : S.pz])) : null,
      toL: function (p) { return fromM(w2l(fr, p)); }, toW: function (p) { return l2w(fr, toM(p)); }, terrain: function () { return -1e9; },
      hands: [[sd.hands[0], sd.hands[1], sd.hands[2]], [sd.hands[0], sd.hands[1], -sd.hands[2]]],
      // forward with the pace, back against a climb or a dive, and up out of the saddle with the bounce
      leanBase: 0.04 + 0.10 * run + 0.22 * gal + (grounded ? 0 : 0.22) + Math.atan((Sm.a || 0) / G) * 0.4 - 0.65 * pitchSeat + 1.2 * R.d.x / k
    });
    S.local = seatPose(pose); S.local.heading = S.h; S.local.riding = cm.id;
    if (sd.reins && S.armed.x < 0.6 && Lm.mounts && Lm.neck) {
      var bit = sd.reins === 'bit' ? Lm.mounts[0].base : [Lm.neck[0] + 0.2 * up[0], Lm.neck[1] + 0.2 * up[1], Lm.neck[2] + 0.2 * up[2]];
      S.local.reins = [[S.local.arms[0].hand, bit.slice()], [S.local.arms[1].hand, bit.slice()]];
    }
    S.y = S.local.root[1]; S.lastY = S.y;
    S.stats = { Fr: 0, stride: 0, period: 0, duty: 1, run: 0, phases: [0, 0.5], v: S.v, gait: 'Riding', steps: 0, air: 0, heading: S.h, turn: Sm.om || 0,
      ammo: S.ammo ? S.ammo.slice() : null, kit: S.kit, action: S.act ? S.act.name : null };
    S.pose = poseToWorld(S.local, fr);
  }

  function d2(a, b, dz) { var x = a.p[0] - b.p[0], y = a.p[1] - b.p[1], z = dz === undefined ? a.z - b.z : dz; return Math.sqrt(x * x + y * y + z * z); }
  function crossAt(a, b, c) { return (b.p[0] - a.p[0]) * (c.p[1] - b.p[1]) - (b.p[1] - a.p[1]) * (c.p[0] - b.p[0]); }
  function ragdollStart(S, ch, env, hit) {
    var p = S.local, L = ch.L, sc = Math.sqrt(L / 0.92), i, l, fr0 = frameOf(S);
    var R = { frame: fr0, P: {}, list: [], bones: [], mins: [], maxs: [], signs: [], t: 0, still: 0, asleep: false, base: p, aim: S.aim.x, tw: S.twist.x, upper: [], phases: ch.gait.walk.phases };
    var vy0 = S.jump && S.jump.stage === 'air' ? S.jump.vy : 0, vx0 = S.mode === 'ground' ? S.v : 0, dt0 = 1 / 120;
    function add(name, pos, r, w) {
      var q = { n: name, p: [pos[0], pos[1]], z: pos[2] || 0, r: r, w: w, hit: false }; q.q = [q.p[0] - vx0 * dt0, q.p[1] - vy0 * dt0];
      R.P[name] = q; R.list.push(q); return q;
    }
    function bone(a, b, dz, rest) { R.bones.push([R.P[a], R.P[b], rest || d2(R.P[a], R.P[b], dz), dz]); }
    function min(a, b, f, dz) { R.mins.push([R.P[a], R.P[b], f, dz]); }
    function max(a, b, f) { R.maxs.push([R.P[a], R.P[b], f]); }
    function sign(a, b, c, dflt) {          // the joint keeps bending the way it bends now
      var A = R.P[a], B = R.P[b], C = R.P[c], cr = crossAt(A, B, C);
      R.signs.push([A, B, C, Math.abs(cr) > 1e-3 * L * L ? (cr > 0 ? 1 : -1) : dflt]);
    }
    function legs(hipOf, kneeR, footR, bendDefault) {
      for (i = 0; i < p.legs.length; i++) {
        l = p.legs[i]; var ld = ch.legs[i], hip = hipOf(i), len = ld.upper + ld.lower;
        add('knee' + i, l.knee, kneeR, 0.6);
        add('ankle' + i, ld.foot ? l.ankle : [l.ankle[0], l.ankle[1] + footR, l.ankle[2]], footR, 0.8);
        var hz = ld.attach[2] - l.knee[2];                    // the hip sits at its body particle, offset sideways
        bone(hip, 'knee' + i, hz, ld.upper); bone('knee' + i, 'ankle' + i); min(hip, 'ankle' + i, 0.3 * len, ld.attach[2] - l.ankle[2]);
        if (Math.abs(ld.rest[1] - ld.attach[2]) < 0.3 * len) sign(hip, 'knee' + i, 'ankle' + i, bendDefault);   // legs splayed sideways have no bend side in this plane
        if (ld.foot) {
          var F = ld.foot, fl = F.fb + F.toe;
          add('toe' + i, [l.toe[0], l.toe[1] + 0.4 * F.ah, l.toe[2]], 0.45 * F.ah, 1.2);
          bone('ankle' + i, 'toe' + i); sign('knee' + i, 'ankle' + i, 'toe' + i, 1);
          min('knee' + i, 'toe' + i, Math.sqrt(ld.lower * ld.lower + fl * fl - 2 * ld.lower * fl * Math.cos(1.15)));   // ankle between about 65 and 150 degrees
          max('knee' + i, 'toe' + i, Math.sqrt(ld.lower * ld.lower + fl * fl - 2 * ld.lower * fl * Math.cos(2.6)));
        }
      }
    }
    if (ch.kind === 'biped') {
      add('root', p.root, 0.11, 0.25); add('chest', p.chest, 0.15, 0.3); add('head', p.head, 0.115, 0.9);
      bone('root', 'chest'); bone('chest', 'head'); min('root', 'head', 0.86 * (d2(R.P.root, R.P.chest) + d2(R.P.chest, R.P.head)));
      legs(function () { return 'root'; }, 0.07, 0.075, -1);
      for (i = 0; i < 2; i++) {
        add('elbow' + i, p.arms[i].elbow, 0.055, 1); add('hand' + i, p.arms[i].hand, 0.05, 1.3);
        bone('chest', 'elbow' + i); bone('elbow' + i, 'hand' + i); sign('chest', 'elbow' + i, 'hand' + i, 1);
        min('chest', 'hand' + i, 0.2 * (ch.arms.upper + ch.arms.lower)); min('chest', 'knee' + i, 0.9 * ch.torso.len);
      }
      (p.props || []).forEach(function (w, k) {       // whatever is in the hands is let go and falls on its own
        if (w.stow > 0.5) return;
        var zm = (w.o[2] + w.muzzle[2]) / 2, a = 'w' + k + 'S', b = 'w' + k + 'M';
        add(a, [w.o[0], w.o[1], zm], 0.035, 1); add(b, [w.muzzle[0], w.muzzle[1], zm], 0.03, 1); bone(a, b);
        R.P[a].q[1] -= 0.8 * dt0; R.P[b].q[0] -= 0.6 * dt0; R.P[b].q[1] -= 1.6 * dt0;
      });
      R.upper = ['chest', 'head']; R.center = ['root'];
    } else if (ch.kind === 'mech') {
      add('root', p.root, 0.3, 0.3); add('chest', p.chest, ch.pod.r, 0.25); bone('root', 'chest');
      legs(function () { return 'root'; }, 0.3, 0.26, 1);
      for (i = 0; i < 2; i++) min('chest', 'knee' + i, 0.6 * ch.pod.h);
      R.upper = ['chest']; R.center = ['root'];
    } else if (ch.kind === 'quad') {
      add('back', p.back, 0.15, 0.3); add('front', p.front, 0.15, 0.3); add('head', p.head, 0.09, 0.9);
      bone('back', 'front'); bone('front', 'head'); min('back', 'head', 0.88 * (d2(R.P.back, R.P.front) + d2(R.P.front, R.P.head)));
      R.gazeOff = Math.atan2(p.gaze[1], p.gaze[0]) - Math.atan2(p.head[1] - p.front[1], p.head[0] - p.front[0]);
      if (ch.beast && ch.beast.mid) { add('mid', p.root, 0.15, 0.3); bone('back', 'mid'); bone('mid', 'front'); }
      legs(function (k) { return ch.beast && ch.beast.mid ? 'mid' : ch.legs[k].attach[0] < 0 ? 'back' : 'front'; }, 0.05, 0.045, 1);
      R.upper = ['front', 'head']; R.center = ['back', 'front'];
    } else {
      add('back', p.back, 0.5, 0.3); add('front', p.front, 0.5, 0.3);
      add('mid', [(p.back[0] + p.front[0]) / 2, (p.back[1] + p.front[1]) / 2, 0], 0.5, 0.3);
      bone('back', 'mid'); bone('mid', 'front'); bone('back', 'front');
      legs(function (k) { var ax = ch.legs[k].attach[0]; return ax > 0.3 ? 'front' : ax < -0.3 ? 'back' : 'mid'; }, 0.13, 0.06, 1);
      R.upper = ['front', 'mid']; R.center = ['mid'];
    }
    // the blow: a push on the upper body, scaled so that big and small bodies fall alike
    var wi = hit && hit.impulse ? hit.impulse : [-2.4 * fr0.c, 1.0, -2.4 * fr0.s];        // given in the world; default: from straight ahead
    var imp = [wi[0] * fr0.c + (wi[2] || 0) * fr0.s, wi[1]];
    R.upper.forEach(function (n) { R.P[n].q[0] -= imp[0] * sc * dt0; R.P[n].q[1] -= imp[1] * sc * dt0; });
    S.mode = 'ragdoll'; S.rag = R; S.jump = null; S.lad = null; S.v = 0; S.om = 0; S.kv = [0, 0]; S.act = null;
    S.events.push({ type: 'die' });
  }

  // Move two particles within the plane so that their true distance becomes rest.
  function pull(A, B, rest, d) {
    var x = B.p[0] - A.p[0], y = B.p[1] - A.p[1], pl2 = x * x + y * y;
    if (pl2 < 0.01 * d * d) return;                        // almost purely sideways: nothing to do in the plane
    var k = clamp((d - rest) * d / pl2, -0.5, 0.5) / (A.w + B.w);
    A.p[0] += x * k * A.w; A.p[1] += y * k * A.w; B.p[0] -= x * k * B.w; B.p[1] -= y * k * B.w;
  }
  function stepRagdoll(S, ch, inp, st, env, dt) {
    var R = S.rag, fr = R.frame, P = R.list, L = ch.L, i, it, c, q, d;
    var terrain = function (q0) { return env.terrain(fr.px + (q0.p[0] - fr.ox) * fr.c - q0.z * fr.s, fr.pz + (q0.p[0] - fr.ox) * fr.s + q0.z * fr.c); };
    S.t += dt; R.t += dt; R.dt = dt; R.env = env;
    for (i = 0; i < 2; i++) { S.flash[i] = 0; }
    if (!R.asleep) {
      var g = G * dt * dt, fastest = 0;
      for (i = 0; i < P.length; i++) {
        q = P[i]; var vx = (q.p[0] - q.q[0]) * 0.998, vy = (q.p[1] - q.q[1]) * 0.998, vm = 14 * Math.sqrt(L) * dt, vl = Math.sqrt(vx * vx + vy * vy);
        if (vl > vm) { vx *= vm / vl; vy *= vm / vl; }
        q.q[0] = q.p[0]; q.q[1] = q.p[1]; q.p[0] += vx; q.p[1] += vy - g; q.hit = false;
      }
      for (it = 0; it < 12; it++) {
        for (i = 0; i < R.bones.length; i++) { c = R.bones[i]; pull(c[0], c[1], c[2], d2(c[0], c[1], c[3])); }
        for (i = 0; i < R.mins.length; i++) { c = R.mins[i]; d = d2(c[0], c[1], c[3]); if (d < c[2]) pull(c[0], c[1], c[2], d); }
        for (i = 0; i < R.maxs.length; i++) { c = R.maxs[i]; d = d2(c[0], c[1]); if (d > c[2]) pull(c[0], c[1], c[2], d); }
        for (i = 0; i < R.signs.length; i++) {      // a knee or elbow never bends backwards: at worst it is straight
          c = R.signs[i];
          var cr = crossAt(c[0], c[1], c[2]);
          if (cr * c[3] < 0) {
            // the joint has gone past straight: push all three points back, each by its share (no net push on the limb)
            var A = c[0], Bm = c[1], C = c[2];
            var gcx = -(Bm.p[1] - A.p[1]), gcy = Bm.p[0] - A.p[0], gax = -(C.p[1] - Bm.p[1]), gay = C.p[0] - Bm.p[0], gbx = -gax - gcx, gby = -gay - gcy;
            var den = A.w * (gax * gax + gay * gay) + Bm.w * (gbx * gbx + gby * gby) + C.w * (gcx * gcx + gcy * gcy);
            if (den > 1e-12) {
              var lam = -cr / den * 0.6;
              A.p[0] += lam * A.w * gax; A.p[1] += lam * A.w * gay; Bm.p[0] += lam * Bm.w * gbx; Bm.p[1] += lam * Bm.w * gby; C.p[0] += lam * C.w * gcx; C.p[1] += lam * C.w * gcy;
            }
          }
        }
        for (i = 0; i < P.length; i++) { q = P[i]; var gy = terrain(q) + q.r; if (q.p[1] < gy + 1e-7) { if (q.p[1] < gy) q.p[1] = gy; q.hit = true; } }      // (touching counts, as for limp chains)
      }
      for (i = 0; i < P.length; i++) {
        q = P[i];
        if (q.hit) { q.q[0] = q.p[0] - (q.p[0] - q.q[0]) * 0.7; if (q.q[1] < q.p[1]) q.q[1] = q.p[1]; }      // ground friction, no bounce
        fastest = Math.max(fastest, Math.abs(q.p[0] - q.q[0]) + Math.abs(q.p[1] - q.q[1]));
      }
      R.still = fastest < 0.06 * Math.sqrt(L) * dt ? R.still + dt : 0;
      if (R.still > 0.5 || R.t > 6) R.asleep = true;
    }
    R.aim += (-0.45 - R.aim) * decay(2.5, dt);
    S.local = ragPose(S, ch); S.local.heading = fr.h;
    if (ch.fly) S.local.wings = wingPose(ch, S.local.root, S.local.axis, S.local.up, 0, 0, 1);      // wings stay folded on a body that is down
    S.pose = poseToWorld(S.local, fr);
    var cx = 0, cy = 0;
    R.center.forEach(function (n) { cx += R.P[n].p[0]; cy += R.P[n].p[1]; });
    S.x = cx / R.center.length; S.y = S.lastY = cy / R.center.length;
    var wc = l2w(fr, [S.x, 0, 0]); S.px = wc[0]; S.pz = wc[2];
    S.stats = { Fr: 0, stride: 0, period: 1, duty: 1, run: 0, phases: R.phases, v: 0, gait: 'Down', steps: 0, air: 0, idlePeriod: idlePeriod(ch), asleep: R.asleep };
  }
  function ragPose(S, ch) {
    var R = S.rag, b = R.base, i;
    function pt(n) { var q = R.P[n]; return [q.p[0], q.p[1], q.z]; }
    function unit(a, c) { var x = c[0] - a[0], y = c[1] - a[1], l = Math.sqrt(x * x + y * y) || 1; return [x / l, y / l, 0]; }
    function along(o, d, s, n, t) { return [o[0] + d[0] * s + (n ? n[0] * t : 0), o[1] + d[1] * s + (n ? n[1] * t : 0), o[2]]; }
    // a limp chain kept with the ragdoll, started from where that part was when the body went down
    function limp(name, anchor, from, r) {
      if (!R.limp) R.limp = {};
      var Lc = R.limp[name]; if (!Lc) Lc = R.limp[name] = limpFrom(from, r);
      var fq = R.frame, gnd = function (x, z) { return R.env ? R.env.terrain(fq.px + (x - fq.ox) * fq.c - (z || 0) * fq.s, fq.pz + (x - fq.ox) * fq.s + (z || 0) * fq.c) : -1e9; };
      if (!R.dt) { Lc.p[0] = anchor.slice(); return Lc.p.map(function (x) { return x.slice(); }); }
      return limpStep(Lc, anchor, gnd, R.dt);
    }
    function legsOf(hipOf) {
      return b.legs.map(function (bl, k) {
        var ld = ch.legs[k], hip = hipOf(k), knee = pt('knee' + k), ankle = pt('ankle' + k), heel = null, toe = null, ball = ankle;
        if (ld.foot) {
          var F = ld.foot, tp = pt('toe' + k);
          var d = unit(ankle, tp), n = [-d[1], d[0], 0];
          heel = along(ankle, d, -F.hb, n, -F.ah); ball = along(ankle, d, F.fb, n, -F.ah); toe = along(ankle, d, F.fb + F.toe, n, -F.ah);
        } else ankle = along(knee, unit(knee, ankle), ld.lower);
        return { hip: hip, knee: knee, ankle: ankle, heel: heel, toe: toe, ball: ball, planted: false, target: null, side: ld.side };
      });
    }
    var pose = { kind: ch.kind, pitch: 0, crouch: 0, pack: 0, lean: 0 };
    if (ch.kind === 'biped' || ch.kind === 'mech') {
      var r = pt('root'), c = pt('chest'), u = unit(r, c), f = [u[1], -u[0], 0];
      var ct = Math.cos(R.tw || 0), sw = Math.sin(R.tw || 0), f3 = [f[0] * ct, f[1] * ct, sw];        // the turn it had is kept
      pose.root = r; pose.chest = c; pose.u = u; pose.f = f3; pose.side = [-f[0] * sw, -f[1] * sw, ct]; pose.lean = Math.atan2(u[0], u[1]);
      pose.legs = legsOf(function (k) { return [r[0], r[1], ch.legs[k].attach[2]]; });
      if (ch.kind === 'biped') {
        pose.head = pt('head'); pose.gaze = f3;
        pose.arms = b.arms.map(function (ba, k) {
          return { shoulder: [c[0] - u[0] * 0.04, c[1] - u[1] * 0.04, ba.shoulder[2]], elbow: pt('elbow' + k), hand: pt('hand' + k), side: ba.side };
        });
        pose.props = (b.props || []).map(function (bp, k) {
          var w;
          if (R.P['w' + k + 'S']) { var s0 = pt('w' + k + 'S'), m0 = pt('w' + k + 'M'); w = propAt(bp.kind, s0, Math.atan2(m0[1] - s0[1], m0[0] - s0[0]), s0[2]); }
          else { var pl = stowPlace(bp.kind, k, r, u, f, c[2]); w = propAt(bp.kind, pl.o, pl.th, pl.z); w.stow = 1; }
          return w;
        });
      } else {
        var a = R.aim, dm = [f3[0] * Math.cos(a) + u[0] * Math.sin(a), f3[1] * Math.cos(a) + u[1] * Math.sin(a), f3[2] * Math.cos(a)];
        pose.mounts = b.mounts.map(function (bm) {
          var j = [c[0] + 0.1 * f[0] - 0.3 * u[0], c[1] + 0.1 * f[1] - 0.3 * u[1], bm.joint[2]];
          return { joint: j, base: along(j, dm, -0.35), tip: along(j, dm, ch.pod.gunLen), dir: dm, flash: 0, side: bm.side };
        });
      }
    } else {
      var bk = pt('back'), fr = pt('front'), ax = unit(bk, fr), up = [-ax[1], ax[0], 0], md = [(bk[0] + fr[0]) / 2, (bk[1] + fr[1]) / 2, 0];
      if (ch.beast && ch.beast.mid) md = pt('mid');
      pose.back = bk; pose.front = fr; pose.axis = ax; pose.up = up; pose.pitch = Math.atan2(ax[1], ax[0]); pose.root = md;
      pose.legs = legsOf(function (k) {
        var at = ch.legs[k].attach, o = ch.beast && ch.beast.mid ? pt('mid') : ch.kind === 'quad' ? (at[0] < 0 ? bk : fr) : (at[0] > 0.3 ? fr : at[0] < -0.3 ? bk : md);
        return [o[0], o[1], at[2]];
      });
      if (ch.kind === 'quad') {
        var hd = pt('head'), ga = Math.atan2(hd[1] - fr[1], hd[0] - fr[0]) + R.gazeOff, qc = Math.cos(R.tw || 0), qs = Math.sin(R.tw || 0);
        var gz = [Math.cos(ga) * qc, Math.sin(ga), Math.cos(ga) * qs], sdq = [-qs, 0, qc];
        var gup = [sdq[1] * gz[2] - sdq[2] * gz[1], sdq[2] * gz[0] - sdq[0] * gz[2], sdq[0] * gz[1] - sdq[1] * gz[0]], gb = [hd[0] - 0.07 * gup[0], hd[1] - 0.07 * gup[1], hd[2] - 0.07 * gup[2]];
        pose.side = sdq;
        pose.head = hd; pose.gaze = gz; pose.neck = fr; pose.tail = along(bk, ax, -0.36, up, 0.10);
        pose.mounts = [{ joint: hd, base: gb, tip: along(gb, gz, 0.34), dir: gz, flash: 0, side: 0 }];
        if (ch.beast) {
          var hg = [hd[0] + 0.02 * gz[0] - 0.035 * gup[0], hd[1] + 0.02 * gz[1] - 0.035 * gup[1], hd[2] + 0.02 * gz[2] - 0.035 * gup[2]];
          pose.mounts = [{ joint: hd, base: hg, tip: along(hg, gz, ch.beast.jaw), dir: gz, flash: 0, side: 0 }];
          pose.jaw = 0; pose.alert = 0; pose.flex = 0;
          pose.neck = along(fr, ax, 0.03, up, 0.10);
          if (ch.tail) pose.tailPts = limp('tail', along(bk, ax, ch.tail.at[0] + (ch.beast.back || ch.beast.half), up, ch.tail.at[1]), b.tailPts, 0.03), pose.tail = pose.tailPts[ch.tail.n];
        }
      } else {
        var ta = R.aim * 0.5, tc = Math.cos(R.tw || 0), tj = along(md, ax, 0.05, up, 0.6);
        var td = [(ax[0] * Math.cos(ta) + up[0] * Math.sin(ta)) * tc, ax[1] * Math.cos(ta) + up[1] * Math.sin(ta), Math.cos(ta) * Math.sin(R.tw || 0)];
        pose.dome = along(md, ax, -0.05, up, 0.24); pose.eye = along(fr, ax, 0.5, up, -0.04);
        pose.mounts = [{ joint: tj, base: tj, tip: along(tj, td, 1.45), dir: td, flash: 0, side: 0 }];
        if (ch.octo) {
          pose.arms = pose.legs.map(function (l) { return armCurve(l.hip, l.knee, l.ankle, ch.octo.arm.seg); });
          octoMantle(pose, along(md, ax, -0.10, up, 0.13), along(md, ax, -0.40, up, 0.16), ch.octo.mantle); pose.tail = pose.arms[0][6];
          pose.eye = along(md, ax, 0.10, up, 0.12); pose.mounts = [{ joint: md, base: md, tip: pose.eye, dir: ax, flash: 0, side: 0 }];
        }
        if (ch.arthro) {
          // claws and tail are limp chains now: they hang from the body, fall with it and lie where they land
          var Cq = ch.arthro.claw, hf = ch.arthro.half, TQ = ch.tail;
          pose.claws = b.claws.map(function (bc, ci) {
            var sh = along(fr, ax, Cq.at[0] - hf, up, Cq.at[1]); sh[2] = bc.side * Cq.at[2];
            var c4 = limp('claw' + ci, sh, [bc.shoulder, bc.elbow, bc.wrist, bc.tip], 0.05), hv = sub(c4[3], c4[2]), hl = len(hv) || 1;
            var fa = add(c4[2], mul(hv, 0.3)), fb = add(fa, mul(hv, 0.7)); fb[1] += 0.02; fb[2] -= bc.side * 0.05;
            return { shoulder: c4[0], elbow: c4[1], wrist: c4[2], tip: c4[3], fingerA: fa, fingerB: fb, side: bc.side, open: 0.3 };
          });
          if (ch.arthro.thorax) pose.thorax = [along(md, ax, ch.arthro.thorax[0], up, ch.arthro.thorax[1]), along(md, ax, ch.arthro.thorax[2], up, ch.arthro.thorax[3])];
          if (ch.arthro.head) pose.eye = along(md, ax, ch.arthro.head[0], up, ch.arthro.head[1]);
          if (TQ) {
          var tq2 = limp('tail', along(bk, ax, TQ.at[0] + hf, up, TQ.at[1]), b.tailPts, 0.05), tqd = sub(tq2[TQ.n], tq2[TQ.n - 1]);
          pose.tailPts = tq2; pose.tail = tq2[TQ.n];
          pose.mounts = [{ joint: tq2[TQ.n - 1], base: tq2[TQ.n - 1], tip: tq2[TQ.n], dir: mul(tqd, 1 / (len(tqd) || 1)), flash: 0, side: 0 }];
          }
        }
      }
    }
    return pose;
  }
  // Back on the feet where the body lies (the bench cross-fades into this; it is not a get-up animation).
  // whatever the hands were doing stops; a load being carried is dropped where it is
  function letGo(S) {
    if (S.carry && S.carry.held) S.events.push({ type: 'drop', pos: S.pose && S.pose.carry ? S.pose.carry.c.slice() : S.carry.at.slice(), heading: S.h });
    S.carry = null; S.actCrouch = 0; S.actBack = 0;
    if (S.act && S.act.name !== 'reload') S.act = null;
  }
  function stand(S, ch, env) { S.rag = null; leaveLadder(S, ch, env); }

  function step(S, ch, inp, st, env, dt) {
    if (inp.die && S.mode === 'swim') leaveSwim(S, ch, env);
    if (inp.die && S.mode !== 'ragdoll' && S.local && S.local.legs && S.local.legs.length) { letGo(S); ragdollStart(S, ch, env, inp.die); }
    if (S.mode === 'ragdoll') stepRagdoll(S, ch, inp, st, env, dt);
    else if (S.mode === 'swim') stepSwim(S, ch, inp, st, env, dt);
    else if (S.mode === 'fly') stepFly(S, ch, inp, st, env, dt);
    else if (S.mode === 'ledge') stepLedge(S, ch, inp, st, env, dt);
    else if (S.mode === 'ride') stepRide(S, ch, inp, st, env, dt);
    else if (S.mode === 'ladder') stepLadder(S, ch, inp, st, env, dt);
    else stepGround(S, ch, inp, st, env, dt);
    return S.pose;
  }

  // Blend two poses of the same character (used to cross-fade between modes).
  function blendPose(a, b, t) {
    if (typeof b === 'number') return typeof a === 'number' ? lerp(a, b, t) : b;
    if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length ? b.map(function (v, i) { return blendPose(a[i], v, t); }) : b;
    if (b && typeof b === 'object') {
      var o = {};
      for (var k in b) o[k] = a && typeof a === 'object' ? blendPose(a[k], b[k], t) : b[k];
      return o;
    }
    return b;
  }

  return {
    G: G, CHARACTERS: CHARACTERS, createState: createState, step: step, enterLadder: enterLadder, leaveLadder: leaveLadder, stand: stand, place: place, enterSwim: enterSwim, leaveSwim: leaveSwim, enterFly: enterFly, leaveFly: leaveFly, grabLedge: grabLedge, mountUp: mountUp, dismount: dismount,
    // the numeric kernel on its own, for the ports in other languages to be checked against
    kernel: { clamp: clamp, lerp: lerp, frac: frac, smooth: smooth, decay: decay, spring: spring, ease: ease, idleNoise: idleNoise, idlePeriod: idlePeriod, gaitParams: gaitParams, reachChain: reachChain }, frameOf: frameOf, l2w: l2w, w2l: w2l, wrapPi: wrapPi,
    blendPose: blendPose, ik2: ik2, PROPS: PROPS, KITS: KITS, kitFits: kitFits, CRATE: CRATE, PUNCH: PUNCH, SWINGS: SWINGS, lob: lob, startReload: startReload, LAD_PH: LAD_PH, LAD_DUTY: LAD_DUTY, idlePeriod: idlePeriod
  };
});
