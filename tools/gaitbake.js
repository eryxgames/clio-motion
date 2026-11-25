#!/usr/bin/env node
// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
/* Command-line baker.
   node tools/gaitbake.js [character|all] [--out DIR] [--clips idle,walk,...] [--frames 8] [--frame 64x64]
                    [--clio-size 28] [--clio-view front|side] [--kit rifle|pistols|sword]
   Writes, per character: <id>.glb (skinned skeleton), <id>_parts.glb (separate rigid parts),
   <id>_sheet.png, <id>_sheet.json, <id>_clio.json
   (js/fight.js is an example of game code driving two characters; see the README.) */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const M = require('../js/core.js'), R = require('../js/rig.js'), B = require('../js/bake.js')(M, R);

const args = process.argv.slice(2), opt = { out: 'out', frames: 8, fw: 64, fh: 64, clioSize: 28, clioView: 'front' };
let who = 'all';
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') opt.out = args[++i];
  else if (a === '--clips') opt.clips = args[++i].split(',');
  else if (a === '--frames') opt.frames = +args[++i];
  else if (a === '--frame') { const m = args[++i].split('x'); opt.fw = +m[0]; opt.fh = +m[1]; }
  else if (a === '--clio-size') opt.clioSize = +args[++i];
  else if (a === '--clio-view') opt.clioView = args[++i];
  else if (a === '--kit') opt.kit = args[++i];
  else if (a[0] !== '-') who = a;
}
const ids = who === 'all' ? Object.keys(M.CHARACTERS) : [who];
fs.mkdirSync(opt.out, { recursive: true });
for (const id of ids) {
  const ch = M.CHARACTERS[id];
  if (!ch) { console.error('Unknown character "' + id + '". Known: ' + Object.keys(M.CHARACTERS).join(', ')); process.exit(1); }
  const kit = ch.mount.type === 'held' && opt.kit && opt.kit !== ch.mount.kit ? opt.kit : null;
  if (kit && !M.KITS[kit]) { console.error('Unknown kit "' + kit + '". Known: ' + Object.keys(M.KITS).join(', ')); process.exit(1); }
  const name = kit ? id + '_' + kit : id;
  const clips = B.recordAll(ch, { frames: opt.frames, clips: opt.clips, kit: kit });
  if (!clips.length || clips[0].name !== 'idle') { console.error('The clip list must include idle (it is the rest pose).'); process.exit(1); }
  const sh = B.sheet(ch, clips, { fw: opt.fw, fh: opt.fh, image: name + '_sheet.png' });
  const png = B.png(sh.w, sh.h, new Uint8Array(zlib.deflateSync(Buffer.from(B.pngScanlines(sh.rgba, sh.w, sh.h)), { level: 9 })));
  const glb = B.glbSkinned(ch, clips), parts = B.glb(ch, clips);
  const clio = B.clio(ch, clips, { size: opt.clioSize, view: opt.clioView, name: name });
  fs.writeFileSync(path.join(opt.out, name + '_sheet.png'), png);
  fs.writeFileSync(path.join(opt.out, name + '_sheet.json'), JSON.stringify(sh.atlas, null, 1));
  fs.writeFileSync(path.join(opt.out, name + '.glb'), glb);
  fs.writeFileSync(path.join(opt.out, name + '_parts.glb'), parts);
  fs.writeFileSync(path.join(opt.out, name + '_clio.json'), JSON.stringify(clio, null, 1));
  console.log(name.padEnd(8), clips.map(c => c.name + ':' + c.frames.length + (c.loop ? '' : '*')).join(' '),
    '| sheet', sh.w + 'x' + sh.h, (png.length / 1024).toFixed(1) + ' KB', '| glb', (glb.length / 1024).toFixed(0) + ' KB',
    '| clio', clio[name].pixels[0].length + 'x' + clio[name].pixels.length);
}
