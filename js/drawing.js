// Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
/* Reads a character drawn on its template (templates/2d/<character>.svg) and cuts it into the pictures of its parts.
   Browser only: it lets the browser lay the drawing out, measure it and paint it.

     GaitDrawing.read(svgText, character, GaitRig).then(function (art) {
       art.parts      pictures by part name, ready for GaitRig.sprites and for the baker: { img, dark, w, h, axis, box, len, r }
       art.done       the names of the parts that were drawn; art.empty: layers left empty; art.missing: layers the file lacks;
       art.failed     parts whose picture could not be painted; art.linked: parts with pictures linked from other files (left out)
     }, function (error) { error.message says what is wrong with the file });

   Every layer clio-part-<part> that has something in it becomes one picture, cut out along the bone the guide layer
   gives for it (line clio-bone-<part>, circle clio-joint-<part>), at up to 640 pixels on its longer side.
   img is a canvas; dark is the same picture darkened, for the far side of the body. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GaitDrawing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  function fail(msg) { return Promise.reject(new Error(msg)); }
  // a picture and its darker twin, as canvases
  function canvases(source, w, h) {
    var a = document.createElement('canvas'); a.width = w; a.height = h; a.getContext('2d').drawImage(source, 0, 0, w, h);
    var d = document.createElement('canvas'); d.width = w; d.height = h; var dc = d.getContext('2d');
    dc.drawImage(a, 0, 0); dc.globalCompositeOperation = 'source-atop'; dc.fillStyle = 'rgba(0,0,0,0.32)'; dc.fillRect(0, 0, w, h);
    return { img: a, dark: d };
  }
  function read(text, ch, R, o) {
    o = o || {};
    if (typeof document === 'undefined' || typeof DOMParser === 'undefined') return fail('A drawing can only be read in a browser.');
    var doc = new DOMParser().parseFromString(String(text), 'image/svg+xml'), root = doc.documentElement, id = ch.id;
    if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return fail('That is not an SVG file this browser can read. In Inkscape, save as Inkscape SVG or Plain SVG.');
    // nothing in the file may run
    [].slice.call(doc.querySelectorAll('script, foreignObject, iframe, object, embed')).forEach(function (n) { n.parentNode.removeChild(n); });
    [].slice.call(doc.querySelectorAll('*')).forEach(function (el) {
      [].slice.call(el.attributes).forEach(function (at) { if (/^on/i.test(at.name) || (/href$/i.test(at.name) && /^\s*javascript:/i.test(at.value))) el.removeAttribute(at.name); });
    });
    var guide = doc.querySelector('[id^="clio-guides-"]');
    if (!guide) return fail('This drawing was not made on a template: its guide layer is missing. Save the template, draw in its layers, and load that file.');
    var who = guide.id.slice(12);
    if (who !== id) { var e = new Error('This drawing is for the ' + (o.label ? o.label(who) : who) + '. Choose that character first, then load it.'); e.character = who; return Promise.reject(e); }
    // lay the file out, unseen, so that the browser can measure it
    var host = document.createElement('div'); host.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none';
    var live = document.importNode(root, true), jobs = [], art = { id: id, parts: {}, done: [], empty: [], missing: [], failed: [], linked: [] };
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
      if (!(ppmT > 0)) return fail('The guide layer of this drawing has lost its scale bar. Start again from a fresh template and paste your layers in.');
      var ser = new XMLSerializer(), defs = [].slice.call(live.querySelectorAll('defs, style')).map(function (d) { return ser.serializeToString(d); }).join('');
      R.SLOTS[id].forEach(function (sl) {
        var layer = live.querySelector('#clio-part-' + sl[0]), joint = live.querySelector('#clio-joint-' + sl[0]), bone = live.querySelector('#clio-bone-' + sl[0]);
        if (!layer || !joint) { art.missing.push(sl[1]); return; }
        layer.style.display = ''; if (layer.getAttribute('display') === 'none') layer.removeAttribute('display');          // a layer hidden in Inkscape still counts
        if (!layer.querySelector('path, rect, circle, ellipse, line, polyline, polygon, image, text, use')) { art.empty.push(sl[1]); return; }
        // a picture that is only linked from another file cannot come along
        if ([].slice.call(layer.querySelectorAll('image')).some(function (n) { var h = n.getAttribute('href') || n.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || ''; return !/^data:/i.test(h.trim()); })) art.linked.push(sl[1]);
        var jm = toRoot(joint), a = at(jm, joint.cx.baseVal.value, joint.cy.baseVal.value), rT = joint.r.baseVal.value * Math.sqrt(Math.abs(jm.a * jm.d - jm.b * jm.c)), b = null;
        if (bone && sl[2] !== 'ball') { var bm2 = toRoot(bone); b = at(bm2, bone.x2.baseVal.value, bone.y2.baseVal.value); }
        var fr = R.partFrame(sl[2], a, b), pm = toRoot(layer.parentNode);
        var tf = 'rotate(' + (fr.rot * 180 / Math.PI) + ') translate(' + (-fr.x) + ' ' + (-fr.y) + ') matrix(' + [pm.a, pm.b, pm.c, pm.d, pm.e, pm.f].join(' ') + ')';
        // its box in the bone's frame
        var outer = document.createElementNS(NS, 'g'), inner = document.createElementNS(NS, 'g');
        inner.setAttribute('transform', tf); inner.appendChild(layer.cloneNode(true)); outer.appendChild(inner); live.appendChild(outer);
        var bb = outer.getBBox(); live.removeChild(outer);
        if (!(bb.width > 0.5) || !(bb.height > 0.5)) { art.empty.push(sl[1]); return; }
        var pad = 3 + 0.06 * Math.max(bb.width, bb.height), x0 = bb.x - pad, y0 = bb.y - pad, w = bb.width + 2 * pad, h = bb.height + 2 * pad;        // room for the width of the strokes
        var k = Math.min(3, (o.size || 640) / Math.max(w, h)), W2 = Math.max(2, Math.round(w * k)), H2 = Math.max(2, Math.round(h * k));
        var xml = '<svg xmlns="' + NS + '" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W2 + '" height="' + H2 + '" viewBox="' + [x0, y0, w, h].join(' ') + '">' + defs
          + '<g transform="' + tf + '">' + ser.serializeToString(layer) + '</g></svg>';
        jobs.push({ sl: sl, xml: xml, w: W2, h: H2, box: [x0 / ppmT, y0 / ppmT, (x0 + w) / ppmT, (y0 + h) / ppmT], r: rT / ppmT,
          len: b ? Math.sqrt(Math.pow(b[0] - a[0], 2) + Math.pow(b[1] - a[1], 2)) / ppmT : 0 });
      });
    } catch (e2) { return fail('This drawing could not be measured (' + (e2 && e2.message ? e2.message : e2) + ').'); }
    finally { document.body.removeChild(host); }
    if (!jobs.length) return fail('The part layers of this drawing are all empty. Draw each part in the layer that has its name.');
    return Promise.all(jobs.map(function (j) {
      return new Promise(function (res) {
        var im = new Image(), url = null;
        im.onload = function () {
          var cv = canvases(im, j.w, j.h); if (url) URL.revokeObjectURL(url);
          art.parts[j.sl[0]] = { img: cv.img, dark: cv.dark, w: j.w, h: j.h, axis: j.sl[2], box: j.box, len: j.len, r: j.r }; art.done.push(j.sl[1]); res();
        };
        im.onerror = function () {
          // where pictures may not be given as data, hand the same thing over as a file in memory
          if (!url) { try { url = URL.createObjectURL(new Blob([j.xml], { type: 'image/svg+xml' })); im.src = url; return; } catch (e3) { url = 'none'; } }
          else if (url !== 'none') URL.revokeObjectURL(url);
          art.failed.push(j.sl[1]); res();
        };
        im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(j.xml);
      });
    })).then(function () { return art; });
  }
  return { read: read, canvases: canvases };
});
