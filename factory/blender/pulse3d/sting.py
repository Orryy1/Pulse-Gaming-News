"""Pulse ident: the three pieces of the Pulse mark (traced from public/logo.png) fly in from depth and lock
together with a flash of the accent light, a light sweeps across the faces and the PULSE. wordmark settles
beside (landscape) or under (vertical) the mark. alpha: true renders it over transparency for end cards.

params: line (optional small line under the wordmark, e.g. "GAMING NEWS"), alpha, accent.
"""
import json
import math
import os

import bmesh
import bpy
from mathutils import Vector

from . import common as c

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def mark_pieces(ctx, scale, mat):
    data = json.load(open(os.path.join(KIT, "assets", "logo_mark.json"), encoding="utf-8"))
    pieces = []
    for i, shape in enumerate(s for s in data["shapes"] if not s["hole"]):
        cu = bpy.data.curves.new(f"mark{i}", "CURVE")
        cu.dimensions = "2D"
        cu.fill_mode = "BOTH"
        cu.extrude = 0.09
        cu.bevel_depth = 0.012
        cu.bevel_resolution = 3
        pts = shape["points"]
        sp = cu.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for k, (x, y) in enumerate(pts):
            sp.points[k].co = (x * scale, y * scale, 0, 1)
        sp.use_cyclic_u = True
        o = bpy.data.objects.new(f"mark{i}", cu)
        c.link(o)
        o.data.materials.append(mat)
        o.rotation_euler = (math.radians(90), 0, 0)
        pieces.append(o)
    return pieces


def build(ctx):
    p = ctx.p
    line = str(p.get("line", "") or "").strip()
    v = ctx.vertical
    c.setup_render(ctx)
    c.world(ctx, strength=0.4, rotation=math.radians(30))
    if not ctx.alpha:
        c.floor(ctx, roughness=0.15, z=-1.6)
        c.haze(ctx, density=0.01)
    gloss = c.material("mark", ctx.accent, metallic=0.35, roughness=0.18, emission=ctx.accent, strength=0.7, coat=1.0)
    rig = c.empty("rig", (0, 0, 0))
    mx = -1.9 if not v else 0.0
    mz = 0.0 if not v else 1.1
    pieces = mark_pieces(ctx, 2.6, gloss)
    lock = ctx.at(0.95)
    starts = [Vector((-3.5, 6, 2.5)), Vector((3.2, 7, -2.0)), Vector((0.5, 9, 3.5))]
    spins = [(-80, 40, 120), (60, -50, -90), (30, 70, 160)]
    for i, o in enumerate(pieces):
        o.parent = rig
        home = Vector((mx, 0, mz))
        s = starts[i % 3]
        c.key_vec(o, "location", [(1, home + s), (lock, home)], ease="OUT")
        r0 = Vector([math.radians(a) for a in spins[i % 3]]) + Vector((math.radians(90), 0, 0))
        c.key_vec(o, "rotation_euler", [(1, r0), (lock, Vector((math.radians(90), 0, 0)))], ease="OUT")
    e = c.bsdf(gloss).inputs["Emission Strength"]
    c.key(e, "default_value", [(1, 0.4), (lock - 1, 0.6), (lock + 1, 18.0), (lock + 14, 1.0), (ctx.frames, 0.9)], idblock=gloss.node_tree)

    paper = c.material("word", c.BRAND["paper"], metallic=0.3, roughness=0.2, coat=0.8, alpha=0.0)
    dot = c.material("dot", ctx.accent, roughness=0.2, emission=ctx.accent, strength=2.0, alpha=0.0)
    words = c.empty("words", (0.5 if not v else 0.0, 0, 0.0 if not v else -1.2))
    word = c.text(ctx, "PULSE", "anton", size=1.55, extrude=0.12, bevel_depth=0.012, mat=paper, align="LEFT" if not v else "CENTER", valign="CENTER", name="word")
    word.rotation_euler = (math.radians(90), 0, 0)
    word.parent = words
    bpy.context.view_layer.update()
    wd = word.dimensions.x
    stop = c.text(ctx, ".", "anton", size=1.55, extrude=0.12, bevel_depth=0.012, mat=dot, align="LEFT", valign="CENTER", name="stop")
    stop.rotation_euler = (math.radians(90), 0, 0)
    stop.parent = words
    stop.location = (wd + 0.02 if not v else wd / 2 + 0.02, 0, 0)
    group = [words]
    if line:
        ln = c.text(ctx, line.upper(), "inter", size=0.26, mat=c.material("line", c.BRAND["muted"], emission=c.BRAND["muted"], strength=0.5), align="LEFT" if not v else "CENTER", valign="TOP", spacing=1.35, name="line")
        ln.rotation_euler = (math.radians(90), 0, 0)
        ln.parent = words
        ln.location = (0.05 if not v else 0, 0, -0.95)
    w0 = lock + 4
    c.key(words, "location", [(w0, -0.6 if not v else 0.0), (w0 + 16, 0.5 if not v else 0.0)], ease="OUT", index=0)
    for mat, d in ((paper, 0), (dot, 6)):
        c.key(c.bsdf(mat).inputs["Alpha"], "default_value", [(1, 0.0), (w0 + d, 0.0), (w0 + d + 10, 1.0)], idblock=mat.node_tree)

    # The sweep: a bright strip passing in front, seen only in the faces.
    sweep = c.area_light("sweep", (-7, -3, 0), 1200, size=0.2, size_y=6, rot=(math.radians(90), 0, math.radians(-12)))
    c.key(sweep, "location", [(1, -7.0), (lock + 6, -7.0), (lock + 40, 7.0)], ease="QUART", index=0)
    c.area_light("key", (-4, -6, 4), 500, size=5, rot=(math.radians(55), 0, math.radians(-30)))
    c.area_light("glow", (0, 4, 0.5), 900, size=8, color=ctx.accent, rot=(math.radians(-90), 0, 0))
    if not ctx.alpha:
        c.dust(ctx, count=200, box=((-6, 6), (-4, 3), (-1.5, 3)))

    cam = c.camera(ctx, lens=50, fstop=2.8)
    focus = c.empty("focus", (0, 0, 0))
    cam.data.dof.focus_object = focus
    c.look_at(cam, (0, 0, 0 if not v else 0.0))
    d = 10.5 if not v else 12.5
    c.key_vec(cam, "location", [(1, Vector((0.8, -d - 1.5, 0.6))), (ctx.frames, Vector((0.0, -d, 0.25)))], ease="BEZIER")
    read = list(range(w0 + 20, ctx.frames + 1, 6)) + [ctx.frames]
    ok_w = c.fit_in_safe(ctx, cam, group, read)
    ok_m = c.fit_in_safe(ctx, cam, pieces, [ctx.frames])
    return {"fitted": ok_w and ok_m}
