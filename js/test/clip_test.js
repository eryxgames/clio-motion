// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
var M = require('../core.js'), R = require('../rig.js'), B = require('../bake.js')(M, R);
function nan(o) { if (typeof o === 'number') return !isFinite(o); if (o && typeof o === 'object') for (var k in o) if (nan(o[k])) return true; return false; }
Object.keys(M.CHARACTERS).forEach(function (id) {
  var ch = M.CHARACTERS[id], t0 = Date.now(), clips = B.recordAll(ch, {});
  console.log(id, clips.map(function (c) { var np = c.frames.map(function (f) { return R.buildPrims(f, ch, { flash: false, model: true }).length; }), nj = c.frames.map(function (f) { return R.buildPrims(f, ch, { flash: false, model: true }).joints.length; });
    return c.name + ':' + c.frames.length + (c.loop ? 'L' : '') + '(' + c.duration.toFixed(2) + 's' + (nan(c.frames) ? ' NAN' : '') + (Math.min.apply(null, np) !== Math.max.apply(null, np) ? ' PARTS VARY' : '') + ' p' + np[0] + ' j' + nj[0] + ')'; }).join(' '), (Date.now() - t0) + ' ms');
});
