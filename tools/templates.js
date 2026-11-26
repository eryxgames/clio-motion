#!/usr/bin/env node
// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
/* Writes the templates artists start from, for every built-in character (and each of the soldier's kits):
     templates/3d/<name>.rig.json   the rig as data: joints, parents, where they are in the template pose, the parts
     templates/3d/<name>.glb        the stand-in model in the template pose, skinned, no clips
     templates/2d/<id>.svg          a drawing template for Inkscape: one layer per image part, over the figure

     node tools/templates.js            write them
     node tools/templates.js --check    make them again and compare with the files (exit 1 on a difference)
   See templates/README.md for how they are used. */
'use strict';
const fs = require('fs'), path = require('path');
const M = require('../js/core.js'), R = require('../js/rig.js'), B = require('../js/bake.js')(M, R);
const root = path.join(__dirname, '..', 'templates'), check = process.argv.indexOf('--check') >= 0;
let bad = 0, files = 0, bytes = 0;
/* The same file, give or take the last digits of its numbers: another version of Node may round a sine differently.
   Text: every piece that is not a number must match, every number to a part in 100,000. A .glb: its JSON part
   likewise, its binary part as 32-bit floats. */
function sameText(a, b) {
  const num = /-?\d+\.?\d*(?:e[-+]?\d+)?/gi, wa = a.split(num), wb = b.split(num), na = a.match(num) || [], nb = b.match(num) || [];
  if (wa.length !== wb.length || wa.some(function (w, i) { return w !== wb[i]; })) return false;
  return na.every(function (x, i) { return Math.abs(+x - +nb[i]) <= 1e-5 * Math.max(1, Math.abs(+x)); });
}
function same(a, b, glb) {
  if (a.equals(b)) return true;
  if (!glb) return sameText(a.toString('utf8'), b.toString('utf8'));
  const ja = a.readUInt32LE(12), jb = b.readUInt32LE(12);
  if (!sameText(a.slice(20, 20 + ja).toString('utf8').trim(), b.slice(20, 20 + jb).toString('utf8').trim())) return false;
  const ba = a.slice(28 + ja), bb = b.slice(28 + jb);
  if (ba.length !== bb.length) return false;
  for (let i = 0; i + 4 <= ba.length; i += 4) if (ba.readUInt32LE(i) !== bb.readUInt32LE(i) && !(Math.abs(ba.readFloatLE(i) - bb.readFloatLE(i)) <= 1e-5)) return false;
  return true;
}
function put(rel, data) {
  const file = path.join(root, rel), buf = Buffer.from(data);
  files++; bytes += buf.length;
  if (check) { if (!fs.existsSync(file) || !same(fs.readFileSync(file), buf, /\.glb$/.test(rel))) { bad++; console.log(rel + ': differs from what the code makes now'); } }
  else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); }
}
Object.keys(M.CHARACTERS).forEach(function (id) {
  const ch = M.CHARACTERS[id], kits = ch.mount.type === 'held' ? Object.keys(M.KITS).filter(function (k) { return M.kitFits(ch, k); }) : [null];
  kits.forEach(function (kit) {
    const rig = B.rig(ch, { kit: kit });
    put('3d/' + rig.name + '.rig.json', JSON.stringify(rig, null, 1) + '\n');
    put('3d/' + rig.name + '.glb', B.glbTemplate(ch, { kit: kit, name: rig.name }));
  });
  if (B.svgTemplate) put('2d/' + id + '.svg', B.svgTemplate(ch));
});
console.log((check ? 'checked ' : 'wrote ') + files + ' template files, ' + Math.round(bytes / 1024) + ' KB' + (bad ? ', ' + bad + ' differ' : ''));
process.exit(bad ? 1 : 0);
