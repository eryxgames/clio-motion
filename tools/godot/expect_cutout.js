#!/usr/bin/env node
// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
/* For tools/godot/check_cutout.gd: where the tested player (js/cutout.js) puts every picture of a cutout at a few
   moments of every clip. For each sprite: where the two ends of its picture's top edge lie (x, y, x, y, in metres)
   and its place in the draw order.
     node tools/godot/expect_cutout.js out/soldier_cutout.json out/soldier_expect.json */
'use strict';
const fs = require('fs'), C = require('../../js/cutout.js');
const pack = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), moments = [];
Object.keys(pack.clips).forEach(function (name) {
  const c = pack.clips[name];
  [0, 0.31, 0.5, 0.83, 0.999].forEach(function (u) {
    const t = +(u * c.seconds).toFixed(5), fr = C.sample(pack, name, t);
    moments.push({ clip: name, time: t, sprites: fr.map(function (f, k) {
      if (!f) return null;
      const sp = pack.sprites[k], cs = Math.cos(f.angle), sn = Math.sin(f.angle);
      const at = function (u2, v2) { const lx = (u2 - sp.pivot[0]) * f.scaleX, ly = (v2 - sp.pivot[1]) * f.scaleY; return [f.x + cs * lx - sn * ly, f.y + sn * lx + cs * ly]; };
      const a = at(0, 0), b = at(sp.rect[2], 0);
      return [a[0], a[1], b[0], b[1], f.order].map(function (x) { return +x.toFixed(6); });
    }) });
  });
});
fs.writeFileSync(process.argv[3], JSON.stringify({ name: pack.name, moments: moments }));
console.log(process.argv[3] + ': ' + moments.length + ' moments of ' + Object.keys(pack.clips).length + ' clips');
