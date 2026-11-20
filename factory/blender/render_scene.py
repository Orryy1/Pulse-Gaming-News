"""Renders one scene of the Pulse 3D kit headless:

  blender -b --factory-startup -P render_scene.py -- --json params.json

params: {"scene": "podium" | "data" | "chapter" | "desk" | "globe" | "sting", "out": folder, plus the scene's own
fields (see each module in pulse3d/) and the common ones: width, height, seconds, quality (final | draft), alpha,
seed, still (a list of frames: render only those, for previews), assets (the asset folder), save_blend}.

Writes PNG frames to <out>/frames and <out>/scene.json (what was built, for the runner's checks). The runner
(factory/src/render/blenderrun.ts) encodes the frames, adds the grain and checks the result.
"""
import importlib
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pulse3d import common  # noqa: E402

SCENES = ("podium", "data", "chapter", "desk", "globe", "sting")


def main():
    p = common.args()
    scene = p.get("scene")
    if scene not in SCENES:
        raise SystemExit(f"unknown scene {scene!r}; one of {', '.join(SCENES)}")
    t0 = time.time()
    common.reset()
    ctx = common.Ctx(p)
    common.check_assets(ctx)  # a missing texture fails here by name, not as a silently wrong picture
    mod = importlib.import_module(f"pulse3d.{scene}")
    info = mod.build(ctx) or {}
    built = time.time() - t0
    if not p.get("dry"):  # dry: build and check the scene only, no render
        common.render(ctx)
    info.update(scene=scene, frames=ctx.frames, width=ctx.width, height=ctx.height, build_s=round(built, 1),
                render_s=round(time.time() - t0 - built, 1))
    os.makedirs(ctx.out, exist_ok=True)
    with open(os.path.join(ctx.out, "scene.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, indent=1)
    print("PULSE3D_DONE " + json.dumps(info))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except BaseException as e:  # a clear last line for the runner, then a non-zero exit
        import traceback

        traceback.print_exc()
        print(f"PULSE3D_FAILED {e}")
        sys.stdout.flush()
        os._exit(2)
