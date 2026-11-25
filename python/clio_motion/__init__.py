# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""CLIo Motion: characters that move by rule, not by keyframe.  Pure Python, standard library only.

Stage 1 is the numeric kernel (springs, two-bone IK, the gait rules) with the built-in characters as data;
stage 2 is the ground step (``create_state``, ``step_ground``): legs and hips for every character.  The upper
body follows, checked stage by stage against the JavaScript reference.
Source: https://github.com/eryxgames/clio-motion
"""
from __future__ import annotations

import json
import os

from .ground import STYLE, State, create_state, step_ground
from .kernel import (G, TAU, GaitState, Spring, clamp, decay, ease, frac, gait_params, idle_noise, idle_period,
                     ik2, lerp, lob, reach_chain, smooth, wrap_pi)

__version__ = "0.14.0"
__all__ = ["G", "TAU", "GaitState", "STYLE", "Spring", "State", "characters", "create_state", "step_ground", "clamp", "decay", "ease", "frac", "gait_params",
           "idle_noise", "idle_period", "ik2", "lerp", "lob", "reach_chain", "smooth", "wrap_pi"]

_characters = None


def characters():
    """The built-in characters, by id: the same data the JavaScript and C versions use."""
    global _characters
    if _characters is None:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "characters.json"), encoding="utf-8") as f:
            _characters = json.load(f)
    return _characters
