"""A game's HUD layout (src/hudreader/profiles/<game>.json): boxes as fractions of the frame, so one profile reads
any resolution. The calibration tool (hudcore/calibrate.py) writes the same shape for a new game."""

import json
import re


class Profile:
    def __init__(self, data):
        self.data = data
        self.game = data.get("game", "unknown")
        self.events = []
        for e in data.get("events", []):
            self.events.append(
                {
                    "kind": e["kind"],
                    "regions": e.get("region", "banner").split("|"),
                    "re": re.compile(e["pattern"], re.I),
                    "label": e.get("label", e["kind"]),
                }
            )
        money = data.get("money") or {}
        self.money_re = re.compile(money["pattern"]) if money.get("pattern") else None
        self.delta_re = re.compile(money["deltaPattern"]) if money.get("deltaPattern") else None
        self.area_re = re.compile(data["areaPattern"]) if data.get("areaPattern") else None
        self.ignore_re = re.compile(data["ignoreText"], re.I) if data.get("ignoreText") else None

    @staticmethod
    def load(path):
        with open(path, "r", encoding="utf-8") as f:
            return Profile(json.load(f))

    def get(self, *keys, default=None):
        d = self.data
        for k in keys:
            if not isinstance(d, dict) or k not in d:
                return default
            d = d[k]
        return d


def px_box(box, w, h):
    """A fractional box as integer pixels (x0, y0, x1, y1), clipped to the frame."""
    x0, y0, x1, y1 = box
    return (
        max(0, int(round(x0 * w))),
        max(0, int(round(y0 * h))),
        min(w, int(round(x1 * w))),
        min(h, int(round(y1 * h))),
    )


def crop(frame, box):
    h, w = frame.shape[:2]
    x0, y0, x1, y1 = px_box(box, w, h)
    return frame[y0:y1, x0:x1]
