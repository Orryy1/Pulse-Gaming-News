"""Chapter title card: the chapter's name in deep extruded type over a glossy floor, a light sweeping across
the bevels, dust drifting through the beam and the focus pulling from the foreground onto the words.

params: number (int), title, kicker (default "CHAPTER <number>"), year (optional), accent.
"""
import math

import bmesh
import bpy
from mathutils import Vector

from . import common as c


def build(ctx):
    p = ctx.p
    number = p.get("number")
    title = str(p.get("title", "")).strip() or "Untitled"
    kicker = str(p.get("kicker") or (f"CHAPTER {number}" if number is not None else "")).strip()
    year = str(p.get("year", "") or "").strip()
    v = ctx.vertical
    c.setup_render(ctx)
    c.world(ctx, strength=0.25, rotation=math.radians(200))
    c.floor(ctx, roughness=0.18)
    c.haze(ctx, density=0.02, center=(0, 2, 5))

    paper = c.material("title", c.BRAND["paper"], metallic=0.35, roughness=0.22, coat=0.8, alpha=0.0)
    accent = c.material("kicker", ctx.accent, roughness=0.3, emission=ctx.accent, strength=2.5, alpha=0.0)
    muted = c.material("year", c.BRAND["muted"], roughness=0.5, emission=c.BRAND["muted"], strength=0.4, alpha=0.0)
    lines = c.wrap(title.upper(), 11 if v else 18)[:3]
    size = 1.15
    lead = size * 1.0
    base_z = 1.15 + (0.55 if year else 0.0)
    holder = c.empty("words", (0, 0, base_z))
    group = [holder]
    for n, line in enumerate(reversed(lines)):
        t = c.text(ctx, line, "anton", size=size, extrude=0.22, bevel_depth=0.02, mat=paper, valign="BOTTOM_BASELINE", name=f"title{n}")
        t.rotation_euler = (math.radians(90), 0, 0)
        t.parent = holder
        t.location = (0, 0, n * lead)
        c.fit_width(t, 6.2 if v else 11.0)
        group.append(t)
    top = len(lines) * lead
    k = None
    if kicker:
        k = c.text(ctx, kicker.upper(), "inter", size=0.34, mat=accent, valign="BOTTOM_BASELINE", spacing=1.25, name="kicker")
        k.rotation_euler = (math.radians(90), 0, 0)
        k.parent = holder
        k.location = (0, -0.05, top + 0.25)
        group.append(k)
        for side in (-1, 1):
            r = c.mesh_object("rule", bpy.data.meshes.new("rule"), c.emit_material(f"rule{side}", ctx.accent, 5.0))
            bm = bmesh.new()
            bmesh.ops.create_cube(bm, size=1)
            bm.to_mesh(r.data)
            bm.free()
            r.parent = holder
            bpy.context.view_layer.update()
            half = k.dimensions.x / 2 + 0.25
            r.location = (side * (half + 0.45), -0.05, top + 0.38)
            r.dimensions = (0.9, 0.02, 0.03)
            c.key(r, "scale", [(1, 0.0), (ctx.at(0.5), 0.0), (ctx.at(1.0), r.scale.x)], ease="OUT", index=0)
    if year:
        y = c.text(ctx, year, "inter", size=0.3, mat=muted, valign="TOP", spacing=1.2, name="year")
        y.rotation_euler = (math.radians(90), 0, 0)
        y.parent = holder
        y.location = (0, -0.05, -0.25)
        group.append(y)

    # The words rise a little as they fade in; the kicker follows.
    c.key(holder, "location", [(1, base_z - 0.35), (ctx.at(1.1), base_z)], ease="OUT", index=2)
    for mat, a, b in ((paper, 0.1, 0.9), (accent, 0.45, 1.0), (muted, 0.7, 1.25)):
        c.key(c.bsdf(mat).inputs["Alpha"], "default_value", [(1, 0.0), (ctx.at(a), 0.0), (ctx.at(b), 1.0)], idblock=mat.node_tree)

    # Light: a warm glow behind the words, a cool key, and the sweep: a tall bright strip passing in front of the
    # type (unseen by the camera, seen in every bevel and in the floor).
    c.area_light("glow", (0, 4.5, base_z + 1.5), 2500, size=7, color=ctx.accent, rot=(math.radians(-90), 0, 0))
    c.area_light("key", (-5, -6, 6), 500, size=5, color="#DCE4FF", rot=(math.radians(50), 0, math.radians(-40)))
    sweep = c.area_light("sweep", (-9, -3.2, base_z + 1.2), 1600, size=0.25, size_y=7, shape="RECTANGLE", rot=(math.radians(90), 0, 0))
    strip = c.mesh_object("strip", bpy.data.meshes.new("strip"), c.emit_material("strip", "#FFFFFF", 25.0))
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bm.to_mesh(strip.data)
    bm.free()
    strip.dimensions = (0.18, 0.05, 6.5)
    strip.parent = sweep
    strip.rotation_euler = (math.radians(-90), 0, 0)
    strip.visible_camera = False
    s0, s1 = ctx.at(0.9), ctx.at(2.6)
    c.key(sweep, "location", [(1, -9.0), (s0, -9.0), (s1, 9.0)], ease="QUART", index=0)
    c.dust(ctx, count=380, box=((-7, 7), (-8, 2), (0.2, 6)), size=0.014)

    # Camera: a slow push with a little drift; focus racks from the near dust onto the words.
    focus = c.empty("focus", (0, -7.5, base_z + 1))
    c.key(focus, "location", [(1, -7.5), (ctx.at(0.3), -7.5), (ctx.at(1.2), 0.0)], ease="QUART", index=1)
    cam = c.camera(ctx, lens=45 if not v else 40, fstop=1.8, focus=focus)
    mid = base_z + top / 2
    c.look_at(cam, (0, 0, mid))
    dist = 11.5 if v else 10.5
    c.key_vec(cam, "location", [(1, Vector((-0.8, -dist - 1.6, mid - 0.4))), (ctx.frames, Vector((0.6, -dist, mid + 0.3)))], ease="LINEAR")

    read = list(range(ctx.at(1.3), ctx.frames + 1, 8)) + [ctx.frames]
    fitted = c.fit_in_safe(ctx, cam, group, read, pivot=Vector((0, 0, base_z)))
    return {"lines": lines, "fitted": fitted}
