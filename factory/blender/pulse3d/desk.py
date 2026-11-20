"""Case file: the story's photos and documents dealt onto a wooden desk under a warm lamp, a manila folder with
the case title, then a slow push-in onto the lead picture with the focus on it.

params: title (on the folder), label (folder tab, default "CASE FILE"), images: [paths] (1 to 5; missing or
unreadable files become typed documents), captions: ["EXHIBIT A", ...] (default lettered), accent.
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Vector

from . import common as c

INK = "#1B1B20"


def plane(name, w, h, mat, segments=1):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=segments, y_segments=segments, size=0.5)
    bmesh.ops.scale(bm, vec=(w, h, 1), verts=bm.verts)
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp in f.loops:
            co = lp.vert.co
            lp[uv].uv = (co.x / w + 0.5, co.y / h + 0.5)
    bm.to_mesh(me)
    bm.free()
    return c.mesh_object(name, me, mat)


def slab(name, w, h, d, mat):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(w, h, d), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, d / 2), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    return c.mesh_object(name, me, mat)


def wood(ctx):
    m = c.material("desk", "#5A3A22", roughness=0.5, coat=0.15)
    nt = m.node_tree
    b = c.bsdf(m)
    b.inputs["Coat Roughness"].default_value = 0.22  # a satin varnish, not a mirror
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.22, 0.22, 0.22)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    for key_, sock, non_color in (("tex/wood_table_001_diff_2k.jpg", "Base Color", False), ("tex/wood_table_001_rough_2k.jpg", "Roughness", True)):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = c.image(ctx.asset(key_), non_color=non_color)
        nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
        nt.links.new(t.outputs["Color"], b.inputs[sock])
    nt_ = nt.nodes.new("ShaderNodeTexImage")
    nt_.image = c.image(ctx.asset("tex/wood_table_001_nor_gl_2k.jpg"), non_color=True)
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(mp.outputs["Vector"], nt_.inputs["Vector"])
    nt.links.new(nt_.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    return m


def photo_material(name, path):
    m = c.material(name, "#FFFFFF", roughness=0.42, coat=0.08)
    nt = m.node_tree
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = c.image(path)
    t.extension = "EXTEND"
    nt.links.new(t.outputs["Color"], c.bsdf(m).inputs["Base Color"])
    return m, t.image


def document_material(name, seed):
    """A typed page: soft grey lines of 'text' on off-white paper (for a picture that would not load)."""
    m = c.material(name, "#EDE7DA", roughness=0.7)
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "Y"
    wave.inputs["Scale"].default_value = 9.0
    wave.inputs["Distortion"].default_value = 0.0
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 18.0 + seed
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.75
    mr.inputs["From Max"].default_value = 0.95
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    gate = nt.nodes.new("ShaderNodeMath")
    gate.operation = "GREATER_THAN"
    gate.inputs[1].default_value = 0.35
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = c.lin("#EDE7DA")
    mix.inputs["B"].default_value = c.lin("#4A4A52")
    nt.links.new(tc.outputs["UV"], wave.inputs["Vector"])
    nt.links.new(tc.outputs["UV"], noise.inputs["Vector"])
    nt.links.new(wave.outputs["Fac"], mr.inputs["Value"])
    nt.links.new(noise.outputs["Fac"], gate.inputs[0])
    nt.links.new(mr.outputs["Result"], mul.inputs[0])
    nt.links.new(gate.outputs["Value"], mul.inputs[1])
    nt.links.new(mul.outputs["Value"], mix.inputs["Factor"])
    nt.links.new(mix.outputs["Result"], c.bsdf(m).inputs["Base Color"])
    return m


def curl(obj, angle=4):
    """A slight bend so prints and pages are not perfectly flat."""
    mod = obj.modifiers.new("curl", "SIMPLE_DEFORM")
    mod.deform_method = "BEND"
    mod.angle = math.radians(angle)
    mod.deform_axis = "Y"


def build(ctx):
    p = ctx.p
    title = str(p.get("title", "") or "").strip()
    tab = str(p.get("label", "") or "CASE FILE").strip()
    paths = [x for x in (p.get("images") or []) if isinstance(x, str)][:5]
    captions = list(p.get("captions") or [])
    v = ctx.vertical
    c.setup_render(ctx)
    c.world(ctx, strength=0.18, rotation=math.radians(90), backdrop="#050506")
    desk = plane("desk", 14, 10, wood(ctx))

    # The folder, the case title on its label and a pen beside it.
    manila = c.material("manila", "#C9A86A", roughness=0.75)
    folder = slab("folder", 3.1, 2.3, 0.03, manila)
    folder.location = (0.95 if not v else 0.0, -0.35 if not v else -1.05, 0.0)
    folder.rotation_euler = (0, 0, math.radians(-6))
    tabm = slab("tab", 1.1, 0.35, 0.03, manila)
    tabm.parent = folder
    tabm.location = (-0.85, 1.3, 0)
    ink = c.material("ink", INK, roughness=0.6)
    words = []
    tt = c.text(ctx, tab.upper(), "inter", size=0.13, mat=ink, spacing=1.2, name="tab_label")
    tt.parent = folder
    tt.location = (-0.85, 1.32, 0.032)
    words.append(tt)
    label = slab("label", 2.3, 0.62, 0.004, c.material("label", "#F2EEE4", roughness=0.8))
    label.parent = folder
    label.location = (0.15, -0.55, 0.03)
    if title:
        lines = c.wrap(title.upper(), 22)[:2]
        tl = c.text(ctx, "\n".join(lines), "anton", size=0.2, mat=ink, name="case_title")
        tl.parent = folder
        tl.location = (0.15, -0.55, 0.036)
        c.fit_width(tl, 2.1)
        words.append(tl)
    stamp = c.text(ctx, "ARCHIVE", "inter", size=0.16, mat=c.material("stamp", c.BRAND["alert"], roughness=0.8, alpha=0.75), spacing=1.4, name="stamp")
    stamp.parent = folder
    stamp.location = (0.85, 0.55, 0.033)
    stamp.rotation_euler = (0, 0, math.radians(12))
    pen = c.mesh_object("pen", bpy.data.meshes.new("pen"), c.material("pen", "#0E0E10", metallic=0.4, roughness=0.18, coat=1.0))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=0.045, radius2=0.045, depth=1.6)
    bm.to_mesh(pen.data)
    bm.free()
    pen.location = (2.75 if not v else 1.25, -0.2 if not v else -2.6, 0.05)
    pen.rotation_euler = (0, math.radians(90), math.radians(78))
    c.smooth(pen)
    nib = c.mesh_object("nib", bpy.data.meshes.new("nib"), c.material("nib", c.BRAND["gold"], metallic=1.0, roughness=0.2))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=0.045, radius2=0.0, depth=0.16)
    bm.to_mesh(nib.data)
    bm.free()
    nib.parent = pen
    nib.location = (0, 0, 0.88)

    # The prints, dealt one after another onto the left of the desk, the lead one last and on top.
    rnd = random.Random(ctx.seed)
    n = max(1, len(paths)) if paths else 3
    slots = [(-1.55, 0.35, -7), (-2.35, -0.95, 9), (-0.75, -1.35, -4), (-2.6, 0.95, 5), (0.1, 0.85, -10)]
    if v:
        slots = [(-0.2, 1.35, -6), (-0.6, 0.15, 8), (0.55, 0.55, -4), (-0.9, 2.25, 5), (0.7, 2.0, -10)]
    hero = None
    deal0, deal_step = ctx.at(0.15), max(5, ctx.at(0.45) - ctx.at(0.15))
    for i in range(n):
        path = paths[i] if i < len(paths) else None
        img = None
        if path and os.path.exists(path):
            try:
                mat, img = photo_material(f"photo{i}", path)
            except Exception:
                img = None
        if img is None or img.size[0] == 0:
            mat = document_material(f"doc{i}", i)
            aspect = 0.77
        else:
            aspect = img.size[0] / max(1, img.size[1])
        w = 1.55 if aspect >= 1 else 1.15
        h = w / aspect
        border = 0.07
        bottom = 0.26 if img is not None else border
        backing = c.material(f"border{i}", "#F4F1EA", roughness=0.55)
        card = plane(f"card{i}", w + 2 * border, h + border + bottom, backing, segments=8)
        pic = plane(f"pic{i}", w, h, mat, segments=8)
        pic.parent = card
        pic.location = (0, (bottom - border) / 2, 0.003)
        curl(card, rnd.uniform(-5, 5))
        x, y, r = slots[i % len(slots)]
        z = 0.035 + 0.006 * (n - i)
        cap = (captions[i] if i < len(captions) else f"EXHIBIT {'ABCDE'[i]}").upper()
        if img is not None:
            ct = c.text(ctx, cap, "inter600", size=0.085, mat=ink, spacing=1.15, name=f"cap{i}")
            ct.parent = card
            ct.location = (0, -(h + border + bottom) / 2 + bottom / 2, 0.003)
        f0 = deal0 + deal_step * (n - 1 - i)
        c.key_vec(card, "location", [(1, Vector((x + 3.5, y + 5.0, 1.2))), (f0, Vector((x + 3.5, y + 5.0, 1.2))), (f0 + 16, Vector((x, y, z)))], ease="OUT")
        c.key_vec(card, "rotation_euler", [(f0, Vector((0, 0, math.radians(r + 40)))), (f0 + 18, Vector((0, 0, math.radians(r))))], ease="OUT")
        if i == 0:
            hero = card
            if img is not None:
                words.append(ct)

    # Light: a warm desk lamp from the upper left, aimed (a Track To, not hand-set angles: the old rotation sent
    # the pool 7 m behind the desk and left the set lit by the faint world alone), a soft warm spill so the wood
    # reads past the pool, and a faint cool bounce from the right. The fills cast no reflections (a big square
    # light mirrored in the varnish at a grazing angle drew a hard white bar across the desk) and the lamp only a
    # soft one.
    pool = Vector((-0.6, -0.3, 0)) if not v else Vector((0.0, 0.4, 0))
    lamp = c.spot("lamp", (-3.4, 2.4, 5.6), 2100, angle=60, blend=1.0, color="#FFD2A0", radius=0.9)
    lamp.data.specular_factor = 0.3
    c.look_at(lamp, pool)
    spill = c.area_light("spill", (-3.5, 3.0, 6.0), 110, size=8, color="#FFD8B0")
    c.look_at(spill, pool)
    bounce = c.area_light("bounce", (4, -5, 4), 70, size=6, color="#A9BCE0", rot=(math.radians(55), 0, math.radians(40)))
    for fill in (spill, bounce):
        fill.data.specular_factor = 0.0
    # No drifting dust here: at this distance and aperture the motes stayed sharp and read as stars on the wood.

    # Camera: high over the desk, pushing in to the lead print; focus on it.
    focus = c.empty("focus", (0, 0, 0))
    focus.parent = hero
    cam = c.camera(ctx, lens=40, fstop=4.5, focus=focus)
    aim = c.look_at(cam, (0, 0, 0))
    hx, hy, _ = slots[0]
    fx, fy = folder.location.x, folder.location.y
    centre_end = Vector(((hx + fx) / 2, (hy + fy) / 2, 0))
    if v:
        start, end = Vector((0.2, -7.2, 9.2)), Vector((centre_end.x, centre_end.y - 3.0, 6.4))
    else:
        start, end = Vector((-0.4, -6.4, 7.8)), Vector((centre_end.x, centre_end.y - 3.4, 5.0))
    c.key_vec(cam, "location", [(1, start), (ctx.frames, end)], ease="BEZIER")
    c.key_vec(aim, "location", [(1, Vector((-0.4, 0, 0))), (ctx.frames, centre_end)], ease="BEZIER")

    read = list(range(max(1, ctx.frames - 40), ctx.frames + 1, 8)) + [ctx.frames]
    sc = bpy.context.scene
    left, right, bottom_, top = c.safe_margins(ctx)
    fitted = False
    for _ in range(20):
        ok = True
        for f in read:
            sc.frame_set(f)
            box = c.screen_box(cam, words)
            if box is None or box[0] < left or box[1] > right or box[2] < bottom_ or box[3] > top:
                ok = False
                break
        if ok:
            fitted = True
            break
        end = centre_end + (end - centre_end) * 1.07
        for fc in c.fcurves_of(cam):
            if fc.data_path == "location":
                for kp in fc.keyframe_points:
                    if kp.co.x == ctx.frames:
                        kp.co.y = end[fc.array_index]
                fc.update()
    sc.frame_set(ctx.frames)
    box = c.screen_box(cam, words)
    print(f"PULSE3D_BOX desk: frame {ctx.frames} box {tuple(round(x, 3) for x in box) if box else None}")
    return {"images": len(paths), "fitted": fitted}
