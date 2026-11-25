// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
/* Runs every test without a screen.  A test fails if it stops with an error, prints "nan true",
   or prints fewer result lines than expected.  Then the recorded runs in spec/scenarios.json are played again
   and compared: any change in what the core computes shows up there.  Last, the template files are made again
   and compared with those in templates/.
     node js/test/run.js */
const cp = require('child_process'), path = require('path');
const root = path.join(__dirname, '..', '..');
const tests = [['act_test.js', 28], ['fight_test.js 30 60', 4], ['fight_terrain.js', 1], ['beast_test.js', 23], ['creature_test.js', 26],
  ['octo_test.js', 16], ['fly_test.js', 20], ['sword_test.js', 5], ['omni_test.js', 36], ['ledge_test.js', 9], ['ride_test.js', 9], ['beast_test.js horse', 23],
  ['test.js', 0], ['rag_test.js', 0], ['turn_test.js', 0], ['hit_test.js', 0], ['prop_test.js', 0], ['clip_test.js', 0], ['template_test.js', 0], ['cutout_test.js', 0]];
let bad = 0;
function run(label, cmd, want) {
  let out = '', ok = true;
  try { out = cp.execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }); } catch (e) { ok = false; out = String(e.stdout || '') + String(e.stderr || ''); }
  const good = (out.match(/nan false/g) || []).length, nan = /nan true|NaN/.test(out);
  if (!ok || nan || good < want) { bad++; console.log('FAIL  ' + label + (ok ? '' : '  (stopped with an error)') + (nan ? '  (a value is not a number)' : '') + (good < want ? '  (' + good + ' of ' + want + ' results)' : '')); }
  else console.log('ok    ' + label + (want ? '  ' + good + ' results' : ''));
}
tests.forEach(function (t) { run(t[0], 'node js/test/' + t[0], t[1]); });
run('recorded runs (spec/body, spec/ground)', 'node tools/golden.js --check', 0);
run('templates are what the code makes now (templates/)', 'node tools/templates.js --check', 0);
console.log(bad ? bad + ' failed' : 'all passed');
process.exit(bad ? 1 : 0);
