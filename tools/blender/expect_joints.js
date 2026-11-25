#!/usr/bin/env node
// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
/* For test_addon.py: where the rig puts every joint, frame by frame, for a few clips of some characters (glTF axes).
     node tools/blender/expect_joints.js out.json soldier horse scorpion */
'use strict';
const fs = require('fs'), M = require('../../js/core.js'), R = require('../../js/rig.js'), B = require('../../js/bake.js')(M, R);
const out = {};
process.argv.slice(3).forEach(function (id) {
  const ch = M.CHARACTERS[id];
  out[id] = {};
  B.recordAll(ch, { frames: 8, clips: ['idle', 'walk', 'run', 'attack', 'die'] }).forEach(function (c) {
    const n = c.frames.length + (c.loop ? 1 : 0), o = out[id][c.name] = { times: [], frames: [] };
    c.frames.forEach(function (p, f) {
      const j = {};
      R.buildPrims(p, ch, { flash: false, model: true }).joints.forEach(function (q) { j[q.name] = [-q.o[2], q.o[1], q.o[0]]; });
      o.frames.push(j); o.times.push(c.loop ? c.duration * f / (n - 1) : c.duration * f / n);
    });
  });
});
fs.writeFileSync(process.argv[2], JSON.stringify(out));
