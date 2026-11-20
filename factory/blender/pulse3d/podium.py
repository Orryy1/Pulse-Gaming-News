"""Ranking reveal: the entry's number rises out of a lit plinth, the ring light flares as it lands and the title
and its line of facts arrive beside it while the camera swings round to the hero view.

params: rank (int), title, meta ("2018 · PS4", optional), kicker (optional, e.g. "NUMBER 7 OF 10"), accent.
Landscape: the plinth on the left, the words on the right. Vertical: the words above the plinth.
"""
import math

import bmesh
import bpy
from mathutils import Vector

from . import common as c


def plinth(ctx, x):
    me = bpy.data.meshes.new("plinth")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=96, radius1=1.25, radius2=1.25, depth=1.0)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 0.5))
    bm.to_mesh(me)
    bm.free()
    body = c.material("plinth", "#141418", metallic=0.85, roughness=0.32, coat=0.4)
    o = c.mesh_object("plinth", me, body)
    o.location = (x, 0, 0)
    c.bevel(o, 0.035, 4)
    c.smooth(o)
    rings = []
    for z, h, k in ((0.86, 0.045, 1.0), (0.1, 0.02, 0.35)):
        rm = bpy.data.meshes.new("ring")
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, segments=96, radius1=1.262, radius2=1.262, depth=h)
        bm.to_mesh(rm)
        bm.free()
        mat = c.emit_material(f"ring{z}", ctx.accent, 0.0)
        r = c.mesh_object("ring", rm, mat)
        r.location = (x, 0, z)
        rings.append((r, mat, k))
    return o, rings


def build(ctx):
    p = ctx.p
    rank = int(p.get("rank", 1))
    title = str(p.get("title", "")).strip() or "Untitled"
    meta = str(p.get("meta", "")).strip()
    kicker = str(p.get("kicker", "")).strip()
    c.setup_render(ctx)
    c.world(ctx, strength=0.35, rotation=math.radians(140))
    c.floor(ctx)
    c.haze(ctx, density=0.018)
    v = ctx.vertical
    px = 0.0 if v else -2.15
    base, rings = plinth(ctx, px)

    # The number, rising out of the plinth.
    num_mat = c.material("rank", ctx.accent, metallic=0.55, roughness=0.22, emission=ctx.accent, strength=0.9, coat=0.6)
    num = c.text(ctx, str(rank), "anton", size=3.0, extrude=0.16, bevel_depth=0.018, mat=num_mat, valign="BOTTOM_BASELINE", name="rank")
    num.rotation_euler = (math.radians(90), 0, 0)
    c.fit_width(num, 2.2)
    land, rise = ctx.at(1.05), ctx.at(0.2)
    c.key(num, "location", [(1, -3.3), (rise, -3.3), (land, 1.0)], ease="BACK", index=2)
    num.location.x = px
    num.location.y = 0.0

    # A dim giant copy far behind, out of focus: depth behind the hero.
    ghost = c.text(ctx, str(rank), "anton", size=11, extrude=0.4, mat=c.material("ghost", "#101014", metallic=0.6, roughness=0.5, emission=ctx.accent, strength=0.05), valign="CENTER", name="ghost")
    ghost.rotation_euler = (math.radians(90), 0, 0)
    ghost.location = (px + (0 if v else 5.5), 14, 4.5)

    # The ring light flares when the number lands.
    for r, mat, k in rings:
        e = mat.node_tree.nodes["Emission"].inputs["Strength"]
        c.key(e, "default_value", [(1, 0.6 * k), (land - 2, 2.0 * k), (land + 2, 60.0 * k), (land + 22, 9.0 * k), (ctx.frames, 8.0 * k)], idblock=mat.node_tree)

    # The words.
    words = []
    paper = c.material("title", c.BRAND["paper"], roughness=0.35, emission=c.BRAND["paper"], strength=0.55, alpha=0.0)
    muted = c.material("meta", c.BRAND["muted"], roughness=0.5, emission=c.BRAND["muted"], strength=0.35, alpha=0.0)
    rule_mat = c.emit_material("rule", ctx.accent, 6.0)
    lines = c.wrap(title.upper(), 14 if v else 16)[:3]
    align = "CENTER" if v else "LEFT"
    tx = 0.0 if v else -0.35
    size = 0.78
    lead = size * 1.02
    block_h = lead * len(lines)
    kick_h = 0.36 if kicker else 0.0
    meta_h = 0.46 if meta else 0.0
    H = kick_h + block_h + meta_h
    centre_z = (3.3 + 0.5 + H / 2) if v else 2.05
    holder = c.empty("words", (tx, 0, centre_z))
    y0 = H / 2
    if kicker:
        k = c.text(ctx, kicker.upper(), "inter", size=0.2, mat=muted, align=align, valign="BOTTOM_BASELINE", spacing=1.15, name="kicker")
        k.rotation_euler = (math.radians(90), 0, 0)
        k.parent = holder
        k.location = (0, 0, y0 - 0.16)
        words.append(k)
        y0 -= kick_h
    rule = c.mesh_object("rule", bpy.data.meshes.new("rule"), rule_mat)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bm.to_mesh(rule.data)
    bm.free()
    rule.parent = holder
    rule.dimensions = (1.0, 0.02, 0.035)
    rule.location = (0 if v else 0.5, 0, y0 + 0.1)
    for n, line in enumerate(lines):
        t = c.text(ctx, line, "anton", size=size, extrude=0.04, bevel_depth=0.004, mat=paper, align=align, valign="TOP", name=f"title{n}")
        t.rotation_euler = (math.radians(90), 0, 0)
        t.parent = holder
        t.location = (0, 0, y0 - 0.06 - n * lead)
        c.fit_width(t, 4.6 if v else 4.0)
        words.append(t)
    if meta:
        m = c.text(ctx, meta.upper(), "inter", size=0.24, mat=muted, align=align, valign="TOP", spacing=1.1, name="meta")
        m.rotation_euler = (math.radians(90), 0, 0)
        m.parent = holder
        m.location = (0, 0, y0 - 0.06 - block_h - 0.14)
        c.fit_width(m, 4.0)
        words.append(m)
    top_z = centre_z
    a0 = land + 4
    c.key(rule, "scale", [(1, 0.0), (a0, 0.0), (a0 + 12, 1.0 if v else 1.0)], ease="OUT", index=0)
    if not v:
        # The rule grows from the left edge of the block.
        c.key(rule, "location", [(a0, 0.0), (a0 + 12, 0.5)], ease="OUT", index=0)
    c.key(holder, "location", [(a0, top_z - 0.25), (a0 + 18, top_z)], ease="OUT", index=2)
    for mat, d in ((paper, 4), (muted, 10)):
        al = c.bsdf(mat).inputs["Alpha"]
        c.key(al, "default_value", [(1, 0.0), (a0 + d, 0.0), (a0 + d + 12, 1.0)], idblock=mat.node_tree)

    # Light: a key from the front left, a beam from above through the haze, an accent rim from behind.
    c.area_light("key", (-4 if not v else -3, -5, 5), 900, size=4, rot=(math.radians(55), 0, math.radians(-35)))
    c.area_light("fill", (5, -4, 2), 120, size=6, color="#C8D4FF", rot=(math.radians(75), 0, math.radians(50)))
    beam = c.spot("beam", (px, 0.6, 9), 4500, angle=26, blend=0.5, radius=0.3)
    beam.rotation_euler = (math.radians(-4), 0, 0)
    c.point("rim", (px + 0.4, 2.6, 1.8), 600, color=ctx.accent, radius=0.6)
    c.dust(ctx, count=320, box=((px - 3, px + 3), (-2.5, 2.5), (0.2, 5.5)))

    # Camera: low and to the side, swinging round to the hero view, then a slow push.
    focus = c.empty("focus", (px, 0, 2.0 if not v else 2.6))
    cam = c.camera(ctx, lens=40, fstop=2.4, focus=focus)
    aim_end = Vector((0.0, 0, 1.85)) if not v else Vector((0.0, 0, 3.45))
    aim = c.look_at(cam, aim_end)
    settle = ctx.at(2.4)
    if v:
        start, end, push = Vector((3.0, -6.5, 0.7)), Vector((0.0, -9.6, 3.0)), Vector((0.0, -9.1, 3.1))
        c.key_vec(aim, "location", [(1, Vector((0, 0, 2.2))), (settle, aim_end)])
    else:
        start, end, push = Vector((4.6, -6.2, 0.55)), Vector((0.2, -9.2, 2.15)), Vector((0.25, -8.7, 2.25))
        c.key_vec(aim, "location", [(1, Vector((-1.4, 0, 1.5))), (settle, aim_end)])
    c.key_vec(cam, "location", [(1, start), (settle, end)], ease="QUART")
    c.key_vec(cam, "location", [(settle, end), (ctx.frames, push)], ease="LINEAR")

    read = list(range(a0 + 30, ctx.frames + 1, 8)) + [ctx.frames]
    fitted = c.fit_in_safe(ctx, cam, [holder] + [w for w in words], read, pivot=holder.location.copy())
    hero = c.fit_in_safe(ctx, cam, [num], [ctx.frames])
    return {"rank": rank, "lines": lines, "fitted": fitted and hero}
