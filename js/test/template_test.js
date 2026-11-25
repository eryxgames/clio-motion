// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
/* The templates for artists: the rig as data, the rest-pose model, clips fitted onto a model that another program
   has been at, and the drawing template with the placing of pictures on bones.  Stops with an error if anything fails. */
var M = require('../core.js'), R = require('../rig.js'), B = require('../bake.js')(M, R);
var bad = 0, seed = 7;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function check(ok, what) { if (!ok) { bad++; console.log('FAIL  ' + what); } return ok; }
function qmul(a, b) { return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]; }
function qconj(q) { return [-q[0], -q[1], -q[2], q[3]]; }
function qrot(q, v) { var p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q)); return [p[0], p[1], p[2]]; }
function qrand() { var q = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]); return q.map(function (x) { return x / n; }); }
function pack(doc, bin) {            // a .glb from its two parts
  var json = Buffer.from(JSON.stringify(doc)), jp = (4 - json.length % 4) % 4, bp = (4 - bin.length % 4) % 4, out = Buffer.alloc(28 + json.length + jp + bin.length + bp, 0x20), at = 20;
  out.writeUInt32LE(0x46546C67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8); out.writeUInt32LE(json.length + jp, 12); out.writeUInt32LE(0x4E4F534A, 16);
  json.copy(out, at); at += json.length + jp; out.writeUInt32LE(bin.length + bp, at); out.writeUInt32LE(0x004E4942, at + 4); Buffer.from(bin).copy(out, at + 8); out.fill(0, at + 8 + bin.length);
  return new Uint8Array(out);
}
/* What a trip through a modelling program does to a skeleton: every bone gets some other orientation of its own
   (the joints stay where they are), and the whole thing hangs under one more node. */
function reoriented(bytes) {
  var g = B.parseGlb(bytes), doc = JSON.parse(JSON.stringify(g.doc)), bin = Buffer.from(g.bin), skin = doc.skins[0], n = doc.nodes.length, par = new Array(n).fill(-1), W = [];
  doc.nodes.forEach(function (nd, k) { (nd.children || []).forEach(function (c) { par[c] = k; }); });
  function world(k) { if (!W[k]) { var nd = doc.nodes[k], t = nd.translation || [0, 0, 0], q = nd.rotation || [0, 0, 0, 1]; if (par[k] < 0) W[k] = { t: t, q: q }; else { var p = world(par[k]), r = qrot(p.q, t); W[k] = { t: [p.t[0] + r[0], p.t[1] + r[1], p.t[2] + r[2]], q: qmul(p.q, q) }; } } return W[k]; }
  for (var k = 0; k < n; k++) world(k);
  var N = skin.joints.map(function (j) { return { t: W[j].t, q: qmul(W[j].q, qrand()) }; }), at = {};
  skin.joints.forEach(function (j, s) { at[j] = s; });
  skin.joints.forEach(function (j, s) {
    var nd = doc.nodes[j], p = par[j], P = p >= 0 && at[p] !== undefined ? N[at[p]] : p >= 0 ? W[p] : { t: [0, 0, 0], q: [0, 0, 0, 1] }, d = [N[s].t[0] - P.t[0], N[s].t[1] - P.t[1], N[s].t[2] - P.t[2]];
    nd.translation = qrot(qconj(P.q), d); nd.rotation = qmul(qconj(P.q), N[s].q);
    // the inverse bind matrix is the inverse of the joint's new place
    var a = doc.accessors[skin.inverseBindMatrices], v = doc.bufferViews[a.bufferView], o = (v.byteOffset || 0) + (a.byteOffset || 0) + s * 64, qi = qconj(N[s].q), ti = qrot(qi, N[s].t).map(function (x) { return -x; });
    var x = qi[0], y = qi[1], z = qi[2], w = qi[3], m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, ti[0], ti[1], ti[2], 1];
    m.forEach(function (val, e) { bin.writeFloatLE(val, o + e * 4); });
  });
  doc.scenes[0].nodes = [doc.nodes.length]; doc.nodes.push({ name: 'Scene_root', children: g.doc.scenes[0].nodes.slice() });
  return { bytes: pack(doc, bin), doc: doc, bin: bin };
}

var ids = Object.keys(M.CHARACTERS);
ids.forEach(function (id) {
  var ch = M.CHARACTERS[id];
  (ch.mount.type === 'held' ? Object.keys(M.KITS) : [null]).forEach(function (kit) {
    var bad0 = bad, rig = B.rig(ch, { kit: kit }), by = {}, worst = 0, k0 = rig.kit === ch.mount.kit ? null : rig.kit, pairs = 0;
    rig.joints.forEach(function (j) { by[j.name] = j; });
    check(rig.joints.every(function (j) { return j.parent === null || by[j.parent]; }) && rig.parts.every(function (p) { return by[p.joint]; }), rig.name + ': every parent and every part\'s joint is a joint');
    rig.joints.forEach(function (j) {
      var m = j.name.match(/^(.*)_R(.*)$/), o = m && by[m[1] + '_L' + m[2]];
      if (o) { pairs++; worst = Math.max(worst, Math.abs(j.head[0] + o.head[0]), Math.abs(j.head[1] - o.head[1]), Math.abs(j.head[2] - o.head[2])); }
    });
    check(worst < 2e-6, rig.name + ': left and right joints mirror each other (off by ' + worst + ' m)');
    var p1 = B.templatePose(ch, { kit: k0 }), p2 = B.templatePose(ch, { kit: k0 });
    check(JSON.stringify(p1) === JSON.stringify(p2), rig.name + ': the template pose is the same every time');
    // the clips, onto the template itself and onto a copy with every bone turned some other way
    var clips = B.recordAll(ch, { frames: 4, kit: k0, clips: ['idle', 'walk', 'run', 'attack', 'die', 'swim', 'fly'] }), tpl = B.glbTemplate(ch, { kit: k0 });
    var chk = B.glbCheck(ch, tpl, { kit: k0 });
    check(chk.ok && !chk.warnings.length && chk.offset < 1e-6, rig.name + ': its own template passes the check (' + chk.errors.concat(chk.warnings).join(' ') + ')');
    var own = B.glbFollows(ch, clips, B.glbSkinned(ch, clips)), f1 = B.glbFit(ch, clips, tpl, { kit: k0 }), tp = B.templatePose(ch, { kit: k0 });
    var a1 = f1.glb ? B.glbFollows(ch, clips, f1.glb, tp) : { mean: 1, worst: 1 };
    var re = reoriented(tpl), f2 = B.glbFit(ch, clips, re.bytes, { kit: k0 }), a2 = f2.glb ? B.glbFollows(ch, clips, f2.glb, tp) : { mean: 1, worst: 1 };
    check(f1.glb && a1.clips === clips.length && a1.mean < own.mean + 1e-3 && a1.worst < 1.5 * own.worst + 0.01, rig.name + ': clips fitted onto the template follow the rig as the baker\'s own file does');
    check(f2.glb && Math.abs(a2.mean - a1.mean) < 2e-5 && Math.abs(a2.worst - a1.worst) < 2e-4, rig.name + ': and the same with every bone turned another way (' + a2.mean + ' against ' + a1.mean + ')');
    // a bone renamed, a bone moved, a bone stretched out of shape
    var d1 = JSON.parse(JSON.stringify(re.doc)); d1.nodes[0].name = 'Wrong';
    check(!B.glbFit(ch, clips, pack(d1, re.bin), { kit: k0 }).glb, rig.name + ': a renamed bone is refused');
    var d2 = JSON.parse(JSON.stringify(re.doc)), leaf = d2.skins[0].joints.filter(function (j) { return !(d2.nodes[j].children || []).length; })[0]; d2.nodes[leaf].translation[1] += 0.06 * ch.L / 0.92;
    var r2 = B.glbCheck(ch, pack(d2, re.bin), { kit: k0 });
    check(r2.ok && r2.warnings.some(function (w) { return /cm from where/.test(w); }), rig.name + ': a bone moved a little is a warning');
    var d3 = JSON.parse(JSON.stringify(re.doc)); d3.nodes[d3.skins[0].joints[0]].scale = [1, 2, 1];
    check(!B.glbCheck(ch, pack(d3, re.bin), { kit: k0 }).ok, rig.name + ': a bone scaled unevenly is refused');
    console.log((bad > bad0 ? 'FAIL  ' : 'ok    ') + rig.name.padEnd(16) + rig.joints.length + ' joints, ' + pairs + ' mirrored pairs, template ' + Math.round(tpl.length / 1024) + ' KB, ' + a1.clips + ' clips fitted: mean ' + (a1.mean * 100).toFixed(3)
      + '% of leg length (own file ' + (own.mean * 100).toFixed(3) + '%), bones turned ' + (a2.mean * 100).toFixed(3) + '%');
  });
  // the drawing template
  var svg = B.svgTemplate(ch), open = (svg.match(/<g[ >]/g) || []).length, selfc = (svg.match(/<g [^>]*\/>/g) || []).length, close = (svg.match(/<\/g>/g) || []).length;
  check(open - selfc === close && svg.indexOf('id="clio-guides-' + id + '"') > 0 && svg.indexOf('id="clio-scale"') > 0, id + ': the drawing template is well formed and has its guide and scale');
  R.SLOTS[id].forEach(function (sl) {
    check(svg.indexOf('id="clio-part-' + sl[0] + '"') > 0 && svg.indexOf('id="clio-joint-' + sl[0] + '"') > 0, id + ': the drawing template has a layer and a joint for ' + sl[1]);
    if (sl[2] === 'ball') check(svg.indexOf('id="clio-bone-' + sl[0] + '"') < 0, id + ': an upright part (' + sl[1] + ') has no bone line');
  });
});
// a picture cut out of a drawing goes back exactly where it was drawn, and keeps to its bone when the bone moves
var worstBack = 0, worstEnd = 0;
['ball', 'up', 'down', 'right'].forEach(function (axis) {
  for (var i = 0; i < 300; i++) {
    var a = [rnd() * 400, rnd() * 400], b = [rnd() * 400, rnd() * 400], rT = 5 + rnd() * 30, ppmT = 100 + rnd() * 300, fr = R.partFrame(axis, a, b), c = Math.cos(fr.rot), s = Math.sin(fr.rot);
    var toBone = function (p) { var x = p[0] - fr.x, y = p[1] - fr.y; return [x * c - y * s, x * s + y * c]; };
    var P = [rnd() * 400, rnd() * 400], Q = [rnd() * 400, rnd() * 400], lp = toBone(P), lq = toBone(Q);
    var im = { axis: axis, w: 10, h: 10, box: [Math.min(lp[0], lq[0]) / ppmT, Math.min(lp[1], lq[1]) / ppmT, Math.max(lp[0], lq[0]) / ppmT, Math.max(lp[1], lq[1]) / ppmT], r: rT / ppmT,
      len: axis === 'ball' ? 0 : Math.hypot(b[0] - a[0], b[1] - a[1]) / ppmT };
    // drawn again on the same bone at the same size: each corner of the box is where it was on the page
    var o = R.partPlace(im, a, axis === 'ball' ? null : b, rT, ppmT, false), co = Math.cos(o.rot), so = Math.sin(o.rot);
    [[o.dx, o.dy, im.box[0], im.box[1]], [o.dx + o.dw, o.dy + o.dh, im.box[2], im.box[3]]].forEach(function (q) {
      var back = [o.x + q[0] * co - q[1] * so, o.y + q[0] * so + q[1] * co], want = [fr.x + (q[2] * ppmT) * c + (q[3] * ppmT) * s, fr.y - (q[2] * ppmT) * s + (q[3] * ppmT) * c];
      worstBack = Math.max(worstBack, Math.hypot(back[0] - want[0], back[1] - want[1]));
    });
    // on a bone twice as long, seen at twice the size and turned: what was drawn at the far end is still at the far end
    if (axis !== 'ball') {
      var a2 = [50, 60], th = rnd() * 6.28, L0 = Math.hypot(b[0] - a[0], b[1] - a[1]), L2 = 2 * L0 * 2 + 2 * rT * 2, b2 = [a2[0] + Math.cos(th) * (L2 - 4 * rT), a2[1] + Math.sin(th) * (L2 - 4 * rT)];
      [[axis === 'up' ? a : b, axis === 'up' ? a2 : b2], [axis === 'up' ? b : a, axis === 'up' ? b2 : a2]].forEach(function (e) {       // the far end, then the joint
        var lf = toBone(e[0]), im2 = { axis: axis, w: 10, h: 10, box: [lf[0] / ppmT, lf[1] / ppmT, lf[0] / ppmT + 0.01, lf[1] / ppmT + 0.01], r: im.r, len: im.len };
        var o2 = R.partPlace(im2, a2, b2, 2 * rT, 2 * ppmT, false), c2 = Math.cos(o2.rot), s2 = Math.sin(o2.rot), got = [o2.x + o2.dx * c2 - o2.dy * s2, o2.y + o2.dx * s2 + o2.dy * c2];
        worstEnd = Math.max(worstEnd, Math.hypot(got[0] - e[1][0], got[1] - e[1][1]));
      });
    }
  }
});
check(worstBack < 1e-6, 'a picture from a drawing is put back where it was drawn (off by ' + worstBack + ' pixels)');
check(worstEnd < 1e-6, 'and what was drawn at a bone\'s joint and at its end stays there when the bone is longer, bigger and turned (off by ' + worstEnd + ')');
console.log((worstBack < 1e-6 && worstEnd < 1e-6 ? 'ok    ' : 'FAIL  ') + 'pictures on bones: back in place to ' + worstBack.toExponential(1) + ' px, ends kept to ' + worstEnd.toExponential(1) + ' px');
console.log(bad ? bad + ' failed' : 'templates: all passed');
process.exit(bad ? 1 : 0);
