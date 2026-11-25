#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""Puts this version of the Python package into a checkout of CLIo, where the engine carries a copy
(engine/motion/clio_motion/), as it carries Ballistic's sound engine.

    python tools/clio/carry.py ../CLIo            # copy
    python tools/clio/carry.py ../CLIo --check    # say whether CLIo's copy is this one (exit 1 if not)

After copying: in CLIo, `python -m engine.editor.hosted` (the web page's list of files) and its tests.
"""
import filecmp
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "..", "python", "clio_motion")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args or not os.path.isdir(os.path.join(args[0], "engine")):
        print(__doc__.strip())
        return 2
    dst = os.path.join(args[0], "engine", "motion", "clio_motion")
    names = sorted(n for n in os.listdir(SRC) if n.endswith((".py", ".json")))
    if "--check" in sys.argv:
        there = sorted(n for n in os.listdir(dst) if n.endswith((".py", ".json"))) if os.path.isdir(dst) else []
        off = [n for n in names if n not in there or not filecmp.cmp(os.path.join(SRC, n), os.path.join(dst, n), shallow=False)]
        off += [n for n in there if n not in names]
        print("CLIo's copy is this version" if not off else "CLIo's copy differs in: " + ", ".join(off))
        return 1 if off else 0
    os.makedirs(dst, exist_ok=True)
    for n in os.listdir(dst):
        if n.endswith((".py", ".json")) and n not in names:
            os.remove(os.path.join(dst, n))
    for n in names:
        shutil.copyfile(os.path.join(SRC, n), os.path.join(dst, n))
    print("%d files to %s" % (len(names), os.path.normpath(dst)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
