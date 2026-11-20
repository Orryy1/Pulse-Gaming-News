"""3D data: bars that grow from a glowing floor grid with their values riding on top (mode "bars"), or a
timeline whose markers rise along a line of light (mode "timeline"), with the camera flying along the row and
pulling back to show the whole set.

params:
  mode: "bars" (default) or "timeline"
  title: optional heading behind the set
  items: bars: [{"label": "PS2", "value": 160, "display": "160M"}], at most 8; display defaults to the value
         with unit. timeline: [{"label": "First trailer", "year": "2023"}], at most 8, in order.
  unit: appended to values without a display ("M")
  highlight: index of the item in the accent colour (bars: default the largest)
"""
import math

import bmesh
import bpy
from mathutils import Vector

from . import common as c

MAX_ITEMS = 8


def box_mesh(name, w, d, h_unit=1.0):
    """A bevel-ready box whose origin sits at the middle of its base, height 1 (scaled on z to grow)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(w, d, h_unit), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, h_unit / 2), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    return me


def fmt(v, unit):
    if isinstance(v, (int, float)):
        s = f"{v:,.1f}".rstrip("0").rstrip(".") if abs(v) < 100 and v != int(v) else f"{int(round(v)):,}"
    else:
        s = str(v)
    return f"{s}{unit}"


def label_lines(text, max_chars=12):
    return "\n".join(c.wrap(text.upper(), max_chars)[:2])


def stand(o):
    o.rotation_euler = (math.radians(90), 0, 0)
    return o


def build(ctx):
    p = ctx.p
    mode = p.get("mode", "bars")
    items = list(p.get("items") or [])[:MAX_ITEMS]
    if not items:
        raise ValueError("data scene needs items")
    v = ctx.vertical
    c.setup_render(ctx)
    c.world(ctx, strength=0.3, rotation=math.radians(60))
    c.floor(ctx, roughness=0.22, grid=0.9)
    c.haze(ctx, density=0.012)
    n = len(items)
    gap = 1.55 if not v else 1.25
    xs = [(i - (n - 1) / 2) * gap for i in range(n)]
    span = xs[-1] - xs[0] if n > 1 else 1.0
    paper = c.material("label", c.BRAND["paper"], roughness=0.4, emission=c.BRAND["paper"], strength=0.5)
    muted = c.material("name", c.BRAND["muted"], roughness=0.5, emission=c.BRAND["muted"], strength=0.45)
    accent_text = c.material("accent_text", ctx.accent, roughness=0.3, emission=ctx.accent, strength=2.0)
    texts = []
    t_start = ctx.at(0.35)
    step = max(3, round(ctx.at(2.2) / max(1, n)))
    done_at = t_start + step * (n - 1) + 26

    if mode == "timeline":
        line = c.mesh_object("line", box_mesh("line", 1, 0.05, 0.04), c.emit_material("line", ctx.accent, 8.0))
        line.location = (xs[0] - 0.8, 0, 0.02)
        line.rotation_euler = (0, math.radians(90), 0)
        length = span + 1.6
        # The line draws from the left: its height (on the rotated z, now x) grows.
        c.key(line, "scale", [(1, 0.001), (t_start, 0.001), (done_at, length)], ease="OUT", index=2)
        top = 0.0
        for i, (x, it) in enumerate(zip(xs, items)):
            h = 1.15 if i % 2 == 0 else 1.75
            top = max(top, h)
            f0 = t_start + step * i
            post = c.mesh_object(f"post{i}", box_mesh(f"post{i}", 0.05, 0.05), c.emit_material(f"post{i}", c.BRAND["muted"], 1.5))
            post.location = (x, 0, 0)
            c.key(post, "scale", [(1, 0.001), (f0, 0.001), (f0 + 18, h)], ease="OUT", index=2)
            dot = c.mesh_object(f"dot{i}", bpy.data.meshes.new(f"dot{i}"), c.emit_material(f"dot{i}", ctx.accent, 12.0))
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=0.09)
            bm.to_mesh(dot.data)
            bm.free()
            dot.location = (x, 0, 0)
            c.key(dot, "location", [(1, 0.0), (f0, 0.0), (f0 + 18, h)], ease="OUT", index=2)
            year = stand(c.text(ctx, str(it.get("year", "")), "anton", size=0.5, mat=accent_text, valign="BOTTOM_BASELINE", name=f"year{i}"))
            year.location = (x, 0, h + 0.2)
            lab = stand(c.text(ctx, label_lines(str(it.get("label", "")), 14), "inter", size=0.17, mat=paper, valign="TOP", name=f"lab{i}"))
            lab.location = (x, 0, h - 0.08)
            lab.location.x = x + 0.0
            for t in (year, lab):
                c.fit_width(t, gap * 0.92)
                c.key(t, "scale", [(1, 0.0), (f0 + 10, 0.0), (f0 + 22, t.scale.x)], ease="OUT", index=2)
                texts.append(t)
        set_h = top + 0.9
    else:
        vals = [float(it.get("value", 0) or 0) for it in items]
        hi = int(p.get("highlight", max(range(n), key=lambda i: vals[i])))
        vmax = max(vals) or 1.0
        unit = str(p.get("unit", ""))
        H = 3.6
        steel = c.material("bar", "#26262C", metallic=0.9, roughness=0.28, coat=0.5)
        hot = c.material("bar_hot", ctx.accent, metallic=0.2, roughness=0.25, emission=ctx.accent, strength=0.6, coat=0.8)
        cap_cool = c.emit_material("cap", c.BRAND["paper"], 2.0)
        cap_hot = c.emit_material("cap_hot", ctx.accent, 14.0)
        top = 0.0
        for i, (x, it, val) in enumerate(zip(xs, items, vals)):
            h = max(0.08, H * val / vmax)
            top = max(top, h)
            f0 = t_start + step * i
            bar = c.mesh_object(f"bar{i}", box_mesh(f"bar{i}", gap * 0.62, gap * 0.62), hot if i == hi else steel)
            c.bevel(bar, 0.03, 3)
            bar.location = (x, 0, 0)
            c.key(bar, "scale", [(1, 0.001), (f0, 0.001), (f0 + 26, h)], ease="OUT", index=2)
            cap = c.mesh_object(f"cap{i}", box_mesh(f"cap{i}", gap * 0.62 + 0.01, gap * 0.62 + 0.01, 0.025), cap_hot if i == hi else cap_cool)
            cap.location = (x, 0, 0)
            c.key(cap, "location", [(1, 0.0), (f0, 0.0), (f0 + 26, h)], ease="OUT", index=2)
            val_t = stand(c.text(ctx, str(it.get("display") or fmt(val, unit)), "anton", size=0.42, mat=accent_text if i == hi else paper, valign="BOTTOM_BASELINE", name=f"val{i}"))
            val_t.location = (x, -gap * 0.31, h + 0.16)
            c.fit_width(val_t, gap * 0.95)
            full = val_t.scale.x
            c.key(val_t, "scale", [(1, 0.0), (f0 + 18, 0.0), (f0 + 30, full)], ease="OUT", index=0)
            c.key(val_t, "scale", [(1, 0.0), (f0 + 18, 0.0), (f0 + 30, full)], ease="OUT", index=2)
            name_t = stand(c.text(ctx, label_lines(str(it.get("label", ""))), "inter", size=0.2, mat=muted, valign="TOP", name=f"name{i}"))
            name_t.location = (x, -gap * 0.5, -0.0)
            # Names lie just in front of the bars, tipped back so a camera above can read them.
            name_t.rotation_euler = (math.radians(62), 0, 0)
            name_t.location = (x, -gap * 0.42 - 0.12, 0.02)
            c.fit_width(name_t, gap * 0.95)
            texts += [val_t, name_t]
        set_h = top + 0.5

    title = str(p.get("title", "") or "").strip()
    if title:
        tt = stand(c.text(ctx, title.upper(), "anton", size=0.62, mat=paper, valign="BOTTOM_BASELINE", name="heading"))
        tt.location = (0, 1.2, set_h + 0.35)
        c.fit_width(tt, span + 2.0)
        texts.append(tt)

    # Light: soft key from the front, cool fill, an accent glow behind the set.
    c.area_light("key", (-3, -7, 7), 900, size=6, rot=(math.radians(50), 0, math.radians(-20)))
    c.area_light("fill", (6, -3, 3), 200, size=5, color="#C8D4FF", rot=(math.radians(70), 0, math.radians(60)))
    c.area_light("back", (0, 5, 2.5), 1500, size=max(8, span + 4), size_y=2, color=ctx.accent, rot=(math.radians(-80), 0, 0))
    c.dust(ctx, count=220, box=((xs[0] - 3, xs[-1] + 3), (-4, 3), (0.2, set_h + 2)))

    # Camera: low along the row first, then back to the whole set.
    mid_z = set_h * 0.48
    focus = c.empty("focus", (xs[0], 0, mid_z))
    cam = c.camera(ctx, lens=32, fstop=4.0, focus=focus)
    aim = c.look_at(cam, (xs[0], 0, mid_z))
    fly = ctx.at(min(ctx.seconds * 0.55, 3.2))
    end_d = (span * 0.55 + 4.2) * (1.55 if v else 1.0)
    start = Vector((xs[0] - 2.2, -3.0, 0.7))
    mid = Vector((xs[-1] * 0.4, -end_d * 0.7, set_h * 0.7))
    end = Vector((0.0, -end_d, set_h * 0.85 + (1.0 if v else 0.4)))
    c.key_vec(cam, "location", [(1, start), (fly, mid), (ctx.frames, end)], ease="BEZIER")
    c.key_vec(aim, "location", [(1, Vector((xs[0] + 1.0, 0, mid_z * 0.7))), (ctx.frames, Vector((0, 0, mid_z)))], ease="BEZIER")
    c.key_vec(focus, "location", [(1, Vector((xs[0], 0, mid_z))), (ctx.frames, Vector((0, 0, mid_z)))], ease="BEZIER")

    read = list(range(max(done_at + 6, ctx.frames - 30), ctx.frames + 1, 6)) + [ctx.frames]
    fitted = True
    sc = bpy.context.scene
    left, right, bottom, topm = c.safe_margins(ctx)
    # The set is fixed in place, so the camera backs off until every label is inside the safe frame.
    for _ in range(24):
        ok = True
        for f in read:
            sc.frame_set(f)
            box = c.screen_box(cam, texts)
            if box is None or box[0] < left or box[1] > right or box[2] < bottom or box[3] > topm:
                ok = False
                break
        if ok:
            break
        end = end * 1.07
        mid = mid * 1.04
        for fc in c.fcurves_of(cam):
            if fc.data_path == "location":
                for kp in fc.keyframe_points:
                    if kp.co.x == ctx.frames:
                        kp.co.y = end[fc.array_index]
                    elif kp.co.x == fly:
                        kp.co.y = mid[fc.array_index]
                fc.update()
    else:
        fitted = False
    sc.frame_set(ctx.frames)
    box = c.screen_box(cam, texts)
    print(f"PULSE3D_BOX data: frame {ctx.frames} box {tuple(round(x, 3) for x in box) if box else None}")
    return {"mode": mode, "items": n, "fitted": fitted}
