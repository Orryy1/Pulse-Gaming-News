"""Globe flyover: a dark stylised Earth of glowing land dots turns to bring the place into view while the camera
dives towards it; the highlighted countries rise in the accent colour, pins drop with a pulse ring and a label,
and arcs of light join the pins in order.

params: countries: ["JPN", "United Kingdom", ...] (ISO 3166-1 alpha-3 or Natural Earth names, highlighted), pins: [{"lat": 35.0, "lon": 135.8,
"label": "Kyoto, Japan"}] (at most 4; the first is where the camera ends up), title (optional, top line), accent.
"""
import json
import math

import bmesh
import bpy
from mathutils import Vector

from . import common as c

R = 2.0


def ll(lat, lon, r=R):
    la, lo = math.radians(lat), math.radians(lon)
    return Vector((r * math.cos(la) * math.cos(lo), r * math.cos(la) * math.sin(lo), r * math.sin(la)))


def earth(ctx):
    me = bpy.data.meshes.new("earth")
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=192, v_segments=96, radius=R)
    bm.to_mesh(me)
    bm.free()
    m = c.material("earth", "#0B1018", metallic=0.0, roughness=0.55, coat=0.6)
    nt = m.node_tree
    b = c.bsdf(m)
    # Equirectangular lookup from the object position (longitude 0 on +x, as ll() places pins).
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    atan = nt.nodes.new("ShaderNodeMath")
    atan.operation = "ARCTAN2"
    nt.links.new(sep.outputs["Y"], atan.inputs[0])
    nt.links.new(sep.outputs["X"], atan.inputs[1])
    u = nt.nodes.new("ShaderNodeMapRange")
    u.inputs["From Min"].default_value = -math.pi
    u.inputs["From Max"].default_value = math.pi
    nt.links.new(atan.outputs["Value"], u.inputs["Value"])
    norm = nt.nodes.new("ShaderNodeVectorMath")
    norm.operation = "NORMALIZE"
    nt.links.new(tc.outputs["Object"], norm.inputs[0])
    sep2 = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(norm.outputs["Vector"], sep2.inputs["Vector"])
    asin = nt.nodes.new("ShaderNodeMath")
    asin.operation = "ARCSINE"
    nt.links.new(sep2.outputs["Z"], asin.inputs[0])
    vv = nt.nodes.new("ShaderNodeMapRange")
    vv.inputs["From Min"].default_value = -math.pi / 2
    vv.inputs["From Max"].default_value = math.pi / 2
    nt.links.new(asin.outputs["Value"], vv.inputs["Value"])
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(u.outputs["Result"], comb.inputs["X"])
    nt.links.new(vv.outputs["Result"], comb.inputs["Y"])
    land = nt.nodes.new("ShaderNodeTexImage")
    land.image = c.image(ctx.asset("geo/land_4096.png"), non_color=True)
    land.interpolation = "Linear"
    nt.links.new(comb.outputs["Vector"], land.inputs["Vector"])
    # A dot grid: dots where a fine lattice lands on land.
    sc = nt.nodes.new("ShaderNodeVectorMath")
    sc.operation = "MULTIPLY"
    sc.inputs[1].default_value = (360, 180, 1)
    nt.links.new(comb.outputs["Vector"], sc.inputs[0])
    fr = nt.nodes.new("ShaderNodeVectorMath")
    fr.operation = "FRACTION"
    nt.links.new(sc.outputs["Vector"], fr.inputs[0])
    sub = nt.nodes.new("ShaderNodeVectorMath")
    sub.operation = "SUBTRACT"
    sub.inputs[1].default_value = (0.5, 0.5, 0)
    nt.links.new(fr.outputs["Vector"], sub.inputs[0])
    flat = nt.nodes.new("ShaderNodeVectorMath")
    flat.operation = "MULTIPLY"
    flat.inputs[1].default_value = (1, 1, 0)
    nt.links.new(sub.outputs["Vector"], flat.inputs[0])
    ln = nt.nodes.new("ShaderNodeVectorMath")
    ln.operation = "LENGTH"
    nt.links.new(flat.outputs["Vector"], ln.inputs[0])
    dot = nt.nodes.new("ShaderNodeMath")
    dot.operation = "LESS_THAN"
    dot.inputs[1].default_value = 0.3
    nt.links.new(ln.outputs["Value"], dot.inputs[0])
    mask = nt.nodes.new("ShaderNodeMath")
    mask.operation = "MULTIPLY"
    nt.links.new(dot.outputs["Value"], mask.inputs[0])
    nt.links.new(land.outputs["Color"], mask.inputs[1])
    col = nt.nodes.new("ShaderNodeMix")
    col.data_type = "RGBA"
    col.inputs["A"].default_value = c.lin("#0B1018")
    col.inputs["B"].default_value = c.lin("#8C8C99")
    nt.links.new(mask.outputs["Value"], col.inputs["Factor"])
    nt.links.new(col.outputs["Result"], b.inputs["Base Color"])
    b.inputs["Emission Color"].default_value = c.lin("#9A9AA8")
    em = nt.nodes.new("ShaderNodeMath")
    em.operation = "MULTIPLY"
    em.inputs[1].default_value = 0.9
    nt.links.new(mask.outputs["Value"], em.inputs[0])
    nt.links.new(em.outputs["Value"], b.inputs["Emission Strength"])
    o = c.mesh_object("earth", me, m)
    c.smooth(o, 80)
    return o


def atmosphere(ctx):
    me = bpy.data.meshes.new("atmo")
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=48, radius=R * 1.035)
    bm.to_mesh(me)
    bm.free()
    m = bpy.data.materials.new("atmo")
    m.surface_render_method = "BLENDED"
    nt = m.node_tree
    nt.nodes.clear()
    fres = nt.nodes.new("ShaderNodeLayerWeight")
    fres.inputs["Blend"].default_value = 0.35
    pw = nt.nodes.new("ShaderNodeMath")
    pw.operation = "POWER"
    pw.inputs[1].default_value = 2.5
    nt.links.new(fres.outputs["Facing"], pw.inputs[0])
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = c.lin(ctx.accent)
    e.inputs["Strength"].default_value = 3.0
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(pw.outputs["Value"], mx.inputs["Fac"])
    nt.links.new(tr.outputs["BSDF"], mx.inputs[1])
    nt.links.new(e.outputs["Emission"], mx.inputs[2])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(mx.outputs["Shader"], out.inputs["Surface"])
    o = c.mesh_object("atmo", me, m)
    o.visible_shadow = False
    c.smooth(o, 80)
    return o


def country_mesh(ctx, iso3s, parent, mat):
    """The named countries as raised shells over the sphere, from Natural Earth's outlines."""
    if not iso3s:
        return []
    data = json.load(open(ctx.asset("geo/ne_50m_admin_0_countries.geojson"), encoding="utf-8"))
    want = {s.upper() for s in iso3s}
    out = []
    for feat in data["features"]:
        pr = feat["properties"]
        # ISO codes ("JPN") or names as the factory's place list writes them ("United States of America").
        codes = {str(pr.get(k, "")).upper() for k in ("ISO_A3", "ADM0_A3", "ISO_A3_EH", "NAME", "ADMIN", "NAME_LONG")}
        if not codes & want:
            continue
        g = feat["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        cu = bpy.data.curves.new(f"c_{pr.get('ADM0_A3')}", "CURVE")
        cu.dimensions = "2D"
        cu.fill_mode = "BOTH"
        for poly in polys:
            for ring in poly:
                if len(ring) < 4:
                    continue
                sp = cu.splines.new("POLY")
                sp.points.add(len(ring) - 2)
                for k, (lon, lat) in enumerate(ring[:-1]):
                    sp.points[k].co = (lon, lat, 0, 1)
                sp.use_cyclic_u = True
        tmp = bpy.data.objects.new("tmp", cu)
        c.link(tmp)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
        bpy.data.objects.remove(tmp)
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        for _ in range(4):  # break long triangles so the shell follows the curve of the Earth
            long_edges = [e for e in bm.edges if e.calc_length() > 1.5]
            if not long_edges:
                break
            bmesh.ops.subdivide_edges(bm, edges=long_edges, cuts=1, use_grid_fill=False)
            bmesh.ops.triangulate(bm, faces=bm.faces)
        for vert in bm.verts:
            vert.co = ll(vert.co.y, vert.co.x, R * 1.006)
        bm.to_mesh(me)
        bm.free()
        o = c.mesh_object(f"country_{pr.get('ADM0_A3')}", me, mat)
        o.parent = parent
        sol = o.modifiers.new("shell", "SOLIDIFY")
        sol.thickness = 0.012
        out.append(o)
    return out


def arc(ctx, a, b, parent, mat, f0, f1):
    pa, pb = ll(a["lat"], a["lon"], R * 1.01), ll(b["lat"], b["lon"], R * 1.01)
    lift = 1.0 + min(0.45, (pa - pb).length * 0.18)
    cu = bpy.data.curves.new("arc", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 0.008
    cu.bevel_resolution = 3
    sp = cu.splines.new("POLY")
    steps = 48
    sp.points.add(steps)
    for k in range(steps + 1):
        t = k / steps
        q = pa.lerp(pb, t).normalized() * (R * (1.01 + (lift - 1) * math.sin(math.pi * t)))
        sp.points[k].co = (*q, 1)
    o = bpy.data.objects.new("arc", cu)
    c.link(o)
    o.data.materials.append(mat)
    o.parent = parent
    c.key(cu, "bevel_factor_end", [(1, 0.0), (f0, 0.0), (f1, 1.0)], ease="QUART")
    return o


def build(ctx):
    p = ctx.p
    pins = [x for x in (p.get("pins") or []) if "lat" in x and "lon" in x][:4]
    countries = list(p.get("countries") or [])
    title = str(p.get("title", "") or "").strip()
    v = ctx.vertical
    c.setup_render(ctx)
    c.world(ctx, strength=0.15, backdrop="#040406", stars=True)
    spin = c.empty("spin")
    e = earth(ctx)
    e.parent = spin
    atmosphere(ctx)
    hot = c.material("country", ctx.accent, roughness=0.35, emission=ctx.accent, strength=2.2)
    shells = country_mesh(ctx, countries, spin, hot)
    target = pins[0] if pins else ({"lat": 20.0, "lon": 0.0} if not shells else None)
    if target is None:
        # The camera ends over the middle of the first highlighted country.
        vs = [shells[0].data.vertices[k].co for k in range(0, len(shells[0].data.vertices), 7)]
        mid = sum(vs, Vector()) / max(1, len(vs))
        target = {"lat": math.degrees(math.asin(max(-1, min(1, mid.normalized().z)))), "lon": math.degrees(math.atan2(mid.y, mid.x))}

    # The Earth turns so the target ends facing the camera (which waits on -y); a little latitude tilt too.
    end_rot = -math.radians(target["lon"]) - math.pi / 2
    c.key(spin, "rotation_euler", [(1, end_rot + math.radians(70)), (ctx.frames, end_rot)], ease="QUART", index=2)

    paper = c.material("pin_label", c.BRAND["paper"], roughness=0.4, emission=c.BRAND["paper"], strength=0.9, alpha=0.0)
    beam_mat = c.emit_material("beam", ctx.accent, 10.0)
    words = []
    land = ctx.at(ctx.seconds * 0.55)
    for i, pin in enumerate(pins):
        pos = ll(pin["lat"], pin["lon"])
        normal = pos.normalized()
        holder = c.empty(f"pin{i}", pos)
        holder.parent = spin
        holder.rotation_euler = normal.to_track_quat("Z", "Y").to_euler()
        f0 = land + i * 8
        beam = c.mesh_object(f"beam{i}", bpy.data.meshes.new(f"beam{i}"), beam_mat)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.012, radius2=0.004, depth=1.0)
        bmesh.ops.translate(bm, vec=(0, 0, 0.5), verts=bm.verts)
        bm.to_mesh(beam.data)
        bm.free()
        beam.parent = holder
        c.key(beam, "scale", [(1, 0.001), (f0, 0.001), (f0 + 14, 0.32)], ease="OUT", index=2)
        ring = c.mesh_object(f"ring{i}", bpy.data.meshes.new(f"ring{i}"), c.emit_material(f"ringm{i}", ctx.accent, 8.0))
        bm = bmesh.new()
        bmesh.ops.create_circle(bm, cap_ends=False, segments=48, radius=1.0)
        bm.to_mesh(ring.data)
        bm.free()
        ring.parent = holder
        sk = ring.modifiers.new("w", "WIREFRAME")
        sk.thickness = 0.01
        c.key_vec(ring, "scale", [(f0, Vector((0.001,) * 3)), (f0 + 24, Vector((0.16,) * 3))], ease="OUT")
        if pin.get("label"):
            t = c.text(ctx, str(pin["label"]).upper(), "inter", size=0.085, mat=paper, align="LEFT", valign="CENTER", spacing=1.1, name=f"label{i}")
            t.parent = holder
            t.location = (0.05, 0, 0.36)
            words.append(t)
    al = c.bsdf(paper).inputs["Alpha"]
    c.key(al, "default_value", [(1, 0.0), (land + 10, 0.0), (land + 22, 1.0)], idblock=paper.node_tree)
    arc_mat = c.emit_material("arc", ctx.accent, 6.0)
    for i in range(len(pins) - 1):
        arc(ctx, pins[i], pins[i + 1], spin, arc_mat, land + 6 + 10 * i, land + 30 + 10 * i)

    # Light: a sun from the upper left, a faint fill.
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 2.5
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(50), math.radians(-30), math.radians(-20))
    c.link(so)

    # Camera: far and level, diving towards the target (which the turning Earth brings round to face it).
    tgt_cam = ll(target["lat"], -90.0)
    cam = c.camera(ctx, lens=40 if not v else 32, fstop=3.2)
    focus = c.empty("focus", tgt_cam)
    cam.data.dof.focus_object = focus
    aim = c.look_at(cam, Vector((0, 0, 0)))
    far, near = tgt_cam.normalized() * (R * 4.2), tgt_cam.normalized() * (R * 2.15)
    c.key_vec(cam, "location", [(1, far + Vector((0, 0, 1.2))), (ctx.frames, near + Vector((0, 0, 0.35)))], ease="QUART")
    c.key_vec(aim, "location", [(1, Vector((0, 0, 0))), (ctx.frames, tgt_cam * 0.7)], ease="QUART")
    for t in words:  # each label turns to face the camera
        con = t.constraints.new("TRACK_TO")
        con.target = cam
        con.track_axis = "TRACK_Z"
        con.up_axis = "UP_Y"
    if title:
        tt = c.text(ctx, title.upper(), "anton", size=0.16, mat=paper, name="heading")
        tt.parent = cam
        tt.location = (0, 0.42 if not v else 0.7, -2.2)
        words.append(tt)

    read = list(range(land + 26, ctx.frames + 1, 8)) + [ctx.frames]
    fitted = True
    if words:
        fitted = c.fit_in_safe(ctx, cam, words, read)
    return {"pins": len(pins), "countries": len(shells), "fitted": fitted}
