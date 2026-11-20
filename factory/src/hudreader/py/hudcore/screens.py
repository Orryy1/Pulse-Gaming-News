"""What kind of screen a frame is: live play with the HUD on it, the pause menu or map, black, or something else
(loading screens, cutscenes, the phone over a hidden HUD). Only `hud` frames are read for the minimap and stars."""

import cv2
import numpy as np

from .profile import crop


def bars_share(frame, profile):
    """The share of the minimap's health and armour strip that is coloured (GTA V: green, blue and yellow bars)."""
    box = profile.get("minimap", "bars", "box")
    if not box:
        return 0.0
    c = crop(frame, box)
    if c.size == 0:
        return 0.0
    hsv = cv2.cvtColor(c, cv2.COLOR_BGR2HSV)
    col = (hsv[..., 1] > 70) & (hsv[..., 2] > 70)
    # A column counts when most of its rows are coloured, so a bright sky behind the strip does not.
    return float((col.mean(axis=0) > 0.5).mean())


def menu_score(frame, profile):
    """The pause menu's tab row: mostly dark boxes with one bright selected tab."""
    box = profile.get("menu", "tabs")
    if not box:
        return 0.0
    c = crop(frame, box)
    if c.size == 0:
        return 0.0
    v = cv2.cvtColor(c, cv2.COLOR_BGR2HSV)[..., 2]
    dark = float((v < 70).mean())
    bright_cols = (v > 200).mean(axis=0) > 0.5
    # The selected tab is one bright run of about a sixth of the row.
    run, best = 0, 0
    for b in bright_cols:
        run = run + 1 if b else 0
        best = max(best, run)
    tab = best / max(1, len(bright_cols))
    return dark if 0.06 <= tab <= 0.3 else dark * 0.5


def classify(frame, profile):
    v = cv2.cvtColor(frame[::8, ::8], cv2.COLOR_BGR2GRAY)
    if float(v.mean()) < 12:
        return "black", 0.0
    share = bars_share(frame, profile)
    if share >= profile.get("minimap", "bars", "minShare", default=0.6):
        return "hud", share
    m = menu_score(frame, profile)
    if m >= profile.get("menu", "minDarkShare", default=0.55):
        return "menu", m
    return "other", share
