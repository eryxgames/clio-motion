# Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
"""Builds Gait Bench into one self-contained page: docs/index.html (what GitHub Pages serves).

    python bench/build.py
"""
import os
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
page = open(os.path.join(here, 'page.html'), encoding='utf-8').read()
parts = (('/*__CORE__*/', 'js/core.js'), ('/*__RIG__*/', 'js/rig.js'), ('/*__BAKE__*/', 'js/bake.js'),
         ('/*__FIGHT__*/', 'js/fight.js'), ('/*__DRAWING__*/', 'js/drawing.js'), ('/*__APP__*/', 'bench/app.js'))
for tag, name in parts:
    body = open(os.path.join(root, name), encoding='utf-8').read()
    assert '</script' not in body, name
    assert page.count(tag) == 1, tag
    page = page.replace(tag, body)
out = os.path.join(root, 'docs', 'index.html')
open(out, 'w', encoding='utf-8').write(page)
print('docs/index.html', round(len(page) / 1024), 'KB')
