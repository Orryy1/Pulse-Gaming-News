"""The Pulse 3D kit's shared parts: render setup, the look (light, lens, bloom), brand colours, type that is
measured to fit the frame, keyframes with easing and the drifting dust every scene uses.

Every scene module builds its set in an empty file from code alone (no .blend files), so a scene is the same on
any machine with the same Blender and the same asset folder (fetch_assets.py).
"""
import json
import math
import os
import random
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

# Brand colours (factory/src/render/brand.ts). No neon, no colour gradients.
BRAND = {
    "ink": "#0B0B0E",
    "paper": "#F5F5F2",
    "muted": "#B4B4BC",
    "chrome": "#848180",
    "amber": "#FF6B1A",
    "alert": "#FF3B3B",
    "verify": "#38BDF8",
    "up": "#22C55E",
    "gold": "#FFC21A",
    "violet": "#8B5CF6",
}

FPS = 30


def lin(hexstr, alpha=1.0):
    """An sRGB hex colour as Blender's linear RGBA."""
    h = hexstr.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i : i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, alpha)


def args():
    """The scene's parameters: --json <file or inline JSON> after Blender's own "--"."""
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    raw = argv[argv.index("--json") + 1] if "--json" in argv else "{}"
    if not raw.lstrip().startswith("{"):
        with open(raw, encoding="utf-8") as f:
            raw = f.read()
    p = json.loads(raw)
    # Overrides for another machine running the same parameters (the Mac's own folders).
    for flag, field in (("--out", "out"), ("--assets", "assets")):
        if flag in argv:
            p[field] = argv[argv.index(flag) + 1]
    return p


class Ctx:
    """One render's settings, read from the parameters with the kit's defaults."""

    def __init__(self, p):
        self.p = p
        self.width = int(p.get("width", 1920))
        self.height = int(p.get("height", 1080))
        self.vertical = self.height > self.width
        self.seconds = float(p.get("seconds", 5))
        self.frames = max(2, round(self.seconds * FPS))
        self.quality = p.get("quality", "final")
        self.alpha = bool(p.get("alpha", False))
        self.out = p["out"]
        self.assets = p.get("assets") or os.environ.get("BLENDER_ASSETS") or "D:/pulse-data/blender/assets"
        self.seed = int(p.get("seed", 7))
        self.accent = p.get("accent") or BRAND["amber"]
        self.still = p.get("still")  # a list of frames: render only these (previews)
        random.seed(self.seed)

    def asset(self, rel):
        return os.path.join(self.assets, rel)

    def at(self, seconds):
        """A frame number for a time in the clip, clamped to the clip."""
        return max(1, min(self.frames, round(seconds * FPS) + 1))


MANIFEST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "manifest.json")


def manifest_files():
    """Every file the asset folder must hold, from assets/manifest.json: the downloads and the files made from
    them (the logo trace lives in git, not the asset folder). [(relative path, md5 or None), ...]"""
    with open(MANIFEST, encoding="utf-8") as f:
        man = json.load(f)
    out = [(e["file"], e.get("md5")) for e in man.get("files", [])]
    for e in man.get("made", []):
        for part in str(e.get("file", "")).split(","):
            part = part.strip()
            if part and "(in git)" not in part:
                out.append((part, None))
    return out


def check_assets(ctx):
    """Stops the render, loudly, when the asset folder is missing a file or holds a broken one. A scene built
    without its textures renders a wrong picture with no error at all, so this runs before anything is built."""
    import hashlib

    bad = []
    for rel, md5 in manifest_files():
        path = ctx.asset(rel)
        if not os.path.isfile(path) or os.path.getsize(path) == 0:
            bad.append(f"{rel} (missing)")
        elif md5:
            with open(path, "rb") as f:
                if hashlib.md5(f.read()).hexdigest() != md5:
                    bad.append(f"{rel} (checksum differs)")
    if bad:
        raise RuntimeError(f"asset folder {ctx.assets} is incomplete: {', '.join(bad)}; run fetch_assets.py or copy them from the PC")


def image(path, non_color=False):
    """Loads a picture or stops with its name: Blender would otherwise render a missing or unreadable file as
    flat magenta (or nothing) and carry on."""
    if not os.path.isfile(path):
        raise RuntimeError(f"missing image {path}")
    img = bpy.data.images.load(path, check_existing=True)
    if img.size[0] == 0 or img.size[1] == 0:
        raise RuntimeError(f"unreadable image {path}")
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def setup_render(ctx, samples=None):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = ctx.width
    sc.render.resolution_y = ctx.height
    sc.render.resolution_percentage = int(ctx.p.get("scale", 100))
    sc.render.fps = FPS
    sc.frame_start = 1
    sc.frame_end = ctx.frames
    ee = sc.eevee
    ee.taa_render_samples = samples or (16 if ctx.quality == "draft" else 64)
    ee.use_shadows = True
    ee.shadow_ray_count = 2
    ee.shadow_step_count = 8
    ee.use_raytracing = True
    ee.ray_tracing_method = "SCREEN"
    ee.ray_tracing_options.resolution_scale = "1"
    ee.use_fast_gi = True
    ee.volumetric_tile_size = "8"
    ee.volumetric_samples = 64
    ee.volumetric_end = 60
    ee.use_volumetric_shadows = True
    ee.motion_blur_steps = 1
    sc.render.use_motion_blur = True
    sc.render.motion_blur_shutter = 0.5
    sc.render.film_transparent = ctx.alpha
    sc.render.dither_intensity = 1.0
    vs = sc.view_settings
    vs.view_transform = "AgX"
    vs.look = "AgX - Medium High Contrast"
    vs.exposure = float(ctx.p.get("exposure", 0))
    im = sc.render.image_settings
    im.file_format = "PNG"
    im.color_mode = "RGBA" if ctx.alpha else "RGB"
    im.color_depth = "8"
    im.compression = 15
    sc.render.filepath = os.path.join(ctx.out, "frames", "f_")
    sc.render.use_file_extension = True
    bloom(sc, ctx)


def bloom(sc, ctx, strength=0.45, threshold=1.0):
    """A soft bloom in the compositor: bright accents glow a little, nothing else changes."""
    ng = bpy.data.node_groups.new("pulse_comp", "CompositorNodeTree")
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    sc.compositing_node_group = ng
    rl = ng.nodes.new("CompositorNodeRLayers")
    gl = ng.nodes.new("CompositorNodeGlare")
    gl.inputs["Type"].default_value = "Bloom"
    gl.inputs["Quality"].default_value = "High"
    gl.inputs["Threshold"].default_value = threshold
    gl.inputs["Strength"].default_value = strength
    gl.inputs["Size"].default_value = 0.6
    out = ng.nodes.new("NodeGroupOutput")
    ng.links.new(rl.outputs["Image"], gl.inputs["Image"])
    if ctx.alpha:
        sa = ng.nodes.new("CompositorNodeSetAlpha")
        sa.inputs["Type"].default_value = "Replace Alpha"
        ng.links.new(gl.outputs["Image"], sa.inputs["Image"])
        ng.links.new(rl.outputs["Alpha"], sa.inputs["Alpha"])
        ng.links.new(sa.outputs["Image"], out.inputs[0])
    else:
        ng.links.new(gl.outputs["Image"], out.inputs[0])


def world(ctx, strength=0.5, rotation=0.0, backdrop="#08080A", hdri="hdri/studio_small_09_2k.hdr", stars=False):
    """HDRI light from Poly Haven; the camera sees a near-black backdrop (or stars) instead of the studio."""
    w = bpy.data.worlds.new("pulse_world")
    bpy.context.scene.world = w
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = (0, 0, rotation)
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = image(ctx.asset(hdri))
    light = nt.nodes.new("ShaderNodeBackground")
    light.inputs["Strength"].default_value = strength
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], env.inputs["Vector"])
    nt.links.new(env.outputs["Color"], light.inputs["Color"])
    seen = nt.nodes.new("ShaderNodeBackground")
    seen.inputs["Color"].default_value = lin(backdrop)
    seen.inputs["Strength"].default_value = 1.0
    if stars:
        # Small far stars: a Voronoi field thresholded hard, a few brighter than the rest.
        vor = nt.nodes.new("ShaderNodeTexVoronoi")
        vor.feature = "DISTANCE_TO_EDGE"
        vor.inputs["Scale"].default_value = 260
        ramp = nt.nodes.new("ShaderNodeMapRange")
        ramp.inputs["From Min"].default_value = 0.0
        ramp.inputs["From Max"].default_value = 0.012
        ramp.inputs["To Min"].default_value = 0.0
        ramp.inputs["To Max"].default_value = 1.0
        inv = nt.nodes.new("ShaderNodeMath")
        inv.operation = "SUBTRACT"
        inv.inputs[0].default_value = 1.0
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs["A"].default_value = lin(backdrop)
        mix.inputs["B"].default_value = (0.9, 0.9, 1.0, 1)
        nt.links.new(tc.outputs["Generated"], vor.inputs["Vector"])
        nt.links.new(vor.outputs["Distance"], ramp.inputs["Value"])
        nt.links.new(ramp.outputs["Result"], inv.inputs[1])
        nt.links.new(inv.outputs["Value"], mix.inputs["Factor"])
        nt.links.new(mix.outputs["Result"], seen.inputs["Color"])
    lp = nt.nodes.new("ShaderNodeLightPath")
    mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Camera Ray"], mx.inputs["Fac"])
    nt.links.new(light.outputs["Background"], mx.inputs[1])
    nt.links.new(seen.outputs["Background"], mx.inputs[2])
    o = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(mx.outputs["Shader"], o.inputs["Surface"])
    return w


def material(name, color="#16161A", metallic=0.0, roughness=0.4, emission=None, strength=0.0, coat=0.0, alpha=None, specular=0.5):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    b.inputs["Specular IOR Level"].default_value = specular
    b.inputs["Coat Weight"].default_value = coat
    if emission:
        b.inputs["Emission Color"].default_value = lin(emission)
        b.inputs["Emission Strength"].default_value = strength
    if alpha is not None:
        m.surface_render_method = "DITHERED"
        b.inputs["Alpha"].default_value = alpha
    return m


def bsdf(m):
    return m.node_tree.nodes["Principled BSDF"]


def emit_material(name, color, strength=4.0):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = lin(color)
    e.inputs["Strength"].default_value = strength
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs["Emission"], o.inputs["Surface"])
    return m


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_object(name, mesh, mat=None):
    o = bpy.data.objects.new(name, mesh)
    link(o)
    if mat:
        o.data.materials.append(mat)
    return o


def smooth(obj, angle=35):
    """Smooth shading with edges sharper than the angle kept hard (meshes only)."""
    if obj.type != "MESH":
        return
    try:
        obj.data.set_sharp_from_angle(angle=math.radians(angle))
    except Exception:
        for p in obj.data.polygons:
            p.use_smooth = True


def bevel(obj, width=0.02, segments=3):
    m = obj.modifiers.new("bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.harden_normals = False
    return m


_fonts = {}


def font(ctx, which="anton"):
    path = ctx.asset({"anton": "fonts/anton-400.ttf", "inter": "fonts/inter-800.ttf", "inter600": "fonts/inter-600.ttf"}[which])
    if path not in _fonts:
        _fonts[path] = bpy.data.fonts.load(path, check_existing=True)
    return _fonts[path]


def text(ctx, body, which="anton", size=1.0, extrude=0.0, bevel_depth=0.0, mat=None, align="CENTER", valign="CENTER", spacing=1.0, name="text"):
    """A text object lying in its XY plane (rotate it to stand up)."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.font = font(ctx, which)
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.bevel_depth = bevel_depth
    cu.bevel_resolution = 3
    cu.align_x = align
    cu.align_y = valign
    cu.space_character = spacing
    o = bpy.data.objects.new(name, cu)
    link(o)
    if mat:
        o.data.materials.append(mat)
    return o


def wrap(words_text, max_chars):
    """Breaks a line into lines of at most max_chars where it can (never mid-word)."""
    words, lines, cur = words_text.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > max_chars:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}" if cur else w
    if cur:
        lines.append(cur)
    return lines


def fit_width(obj, max_w):
    """Scales a text object down (never up) so its width is at most max_w."""
    bpy.context.view_layer.update()
    w = obj.dimensions.x
    if w > max_w > 0:
        s = max_w / w
        obj.scale = (obj.scale[0] * s, obj.scale[1] * s, obj.scale[2] * s)
    return obj


def corners(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    return [ev.matrix_world @ Vector(c) for c in ev.bound_box]


def screen_box(cam, objs):
    sc = bpy.context.scene
    xs, ys = [], []
    for o in objs:
        for c in corners(o):
            v = world_to_camera_view(sc, cam, c)
            if v.z <= 0:
                return None
            xs.append(v.x)
            ys.append(v.y)
    return min(xs), max(xs), min(ys), max(ys)


def safe_margins(ctx):
    """Inner frame edges text must stay inside: (left, right, bottom, top) as fractions of the frame.
    Shorts keep clear of the channel row, caption rail and right-hand buttons (brand/BRAND.md)."""
    if ctx.vertical:
        return 0.07, 0.86, 0.17, 0.91
    return 0.06, 0.94, 0.08, 0.92


def fit_in_safe(ctx, cam, group, frames, pivot=None, tries=24):
    """Scales a group of objects about a pivot until every one is inside the safe frame on every listed frame.
    group: the objects to scale (their children follow); frames: the frames the text is meant to be read on."""
    sc = bpy.context.scene
    left, right, bottom, top = safe_margins(ctx)
    pivot = Vector(pivot) if pivot is not None else None
    for _ in range(tries):
        ok = True
        for f in frames:
            sc.frame_set(f)
            box = screen_box(cam, group)
            if box is None or box[0] < left or box[1] > right or box[2] < bottom or box[3] > top:
                ok = False
                last = (f, box)
                break
        if ok:
            sc.frame_set(frames[-1])
            box = screen_box(cam, group)
            print(f"PULSE3D_BOX {group[0].name}: frame {frames[-1]} box {tuple(round(x, 3) for x in box)}")
            return True
        print(f"PULSE3D_FIT {group[0].name}: frame {last[0]} box {tuple(round(x, 3) for x in last[1]) if last[1] else None}")
        for o in group:
            if o.parent in group:
                continue
            o.scale = o.scale * 0.92
            if pivot is not None:
                o.location = pivot + (o.location - pivot) * 0.92
    return False


def fcurves_of(idblock):
    ad = getattr(idblock, "animation_data", None)
    if not ad or not ad.action:
        return []
    act = ad.action
    legacy = getattr(act, "fcurves", None)
    if legacy:
        return list(legacy)
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            cb = strip.channelbag(ad.action_slot)
            if cb:
                out.extend(cb.fcurves)
    return out


def key(owner, path, keys, ease="BEZIER", index=-1, idblock=None):
    """Keyframes owner.<path> at [(frame, value), ...]. ease: BEZIER (in and out), OUT (expo out), BACK
    (overshoot), LINEAR or CONSTANT. idblock: the datablock that owns the animation when owner is a node socket."""
    for f, v in keys:
        if index >= 0:
            getattr(owner, path)[index] = v
        else:
            setattr(owner, path, v)
        owner.keyframe_insert(path, frame=f, index=index)
    target = idblock or owner.id_data
    full = owner.path_from_id(path) if hasattr(owner, "path_from_id") and owner != target else path
    mine = {float(f) for f, _ in keys}
    for fc in fcurves_of(target):
        if fc.data_path != full or (index >= 0 and fc.array_index != index):
            continue
        for kp in fc.keyframe_points:
            if kp.co.x not in mine:  # keys set by an earlier call keep their own easing
                continue
            if ease == "LINEAR":
                kp.interpolation = "LINEAR"
            elif ease == "CONSTANT":
                kp.interpolation = "CONSTANT"
            elif ease == "OUT":
                kp.interpolation = "EXPO"
                kp.easing = "EASE_OUT"
            elif ease == "QUART":
                kp.interpolation = "QUART"
                kp.easing = "EASE_IN_OUT"
            elif ease == "BACK":
                kp.interpolation = "BACK"
                kp.easing = "EASE_OUT"
                kp.back = 1.4
            else:
                kp.interpolation = "BEZIER"
                kp.handle_left_type = "AUTO_CLAMPED"
                kp.handle_right_type = "AUTO_CLAMPED"


def key_vec(obj, path, keys, ease="BEZIER"):
    for i in range(3):
        key(obj, path, [(f, v[i]) for f, v in keys], ease=ease, index=i)


def camera(ctx, lens=50, fstop=2.8, focus=None, name="cam"):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.sensor_width = 36
    cd.sensor_fit = "HORIZONTAL" if not ctx.vertical else "VERTICAL"
    if ctx.vertical:
        cd.sensor_height = 36
    cd.clip_start = 0.05
    cd.clip_end = 400
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = fstop
    cd.dof.aperture_blades = 7
    if focus is not None:
        cd.dof.focus_object = focus
    cam = bpy.data.objects.new(name, cd)
    link(cam)
    bpy.context.scene.camera = cam
    return cam


def look_at(obj, target):
    """A Track To constraint on an empty at target (returned), so camera moves stay aimed."""
    if not isinstance(target, bpy.types.Object):
        e = bpy.data.objects.new(f"{obj.name}_aim", None)
        e.location = target
        link(e)
        target = e
    c = obj.constraints.new("TRACK_TO")
    c.target = target
    c.track_axis = "TRACK_NEGATIVE_Z"
    c.up_axis = "UP_Y"
    return target


def empty(name, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    link(e)
    return e


def area_light(name, loc, power, size=2.0, color="#FFFFFF", rot=(0, 0, 0), shape="RECTANGLE", size_y=None):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = power
    ld.size = size
    ld.shape = shape
    if size_y is not None:
        ld.size_y = size_y
    ld.color = lin(color)[:3]
    o = bpy.data.objects.new(name, ld)
    o.location = loc
    o.rotation_euler = rot
    link(o)
    return o


def spot(name, loc, power, angle=40, blend=0.4, color="#FFFFFF", radius=0.1):
    ld = bpy.data.lights.new(name, "SPOT")
    ld.energy = power
    ld.spot_size = math.radians(angle)
    ld.spot_blend = blend
    ld.shadow_soft_size = radius
    ld.color = lin(color)[:3]
    o = bpy.data.objects.new(name, ld)
    o.location = loc
    link(o)
    return o


def point(name, loc, power, color="#FFFFFF", radius=0.2):
    ld = bpy.data.lights.new(name, "POINT")
    ld.energy = power
    ld.shadow_soft_size = radius
    ld.color = lin(color)[:3]
    o = bpy.data.objects.new(name, ld)
    o.location = loc
    link(o)
    return o


def haze(ctx, size=(30, 30, 12), center=(0, 0, 5), density=0.012, color="#FFFFFF", anisotropy=0.35):
    """A box of thin fog so lights draw beams and depth falls away."""
    import bmesh

    me = bpy.data.meshes.new("haze")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(me)
    bm.free()
    o = mesh_object("haze", me)
    o.location = center
    o.scale = size
    m = bpy.data.materials.new("haze")
    nt = m.node_tree
    nt.nodes.clear()
    v = nt.nodes.new("ShaderNodeVolumePrincipled")
    v.inputs["Density"].default_value = density
    v.inputs["Color"].default_value = lin(color)
    v.inputs["Anisotropy"].default_value = anisotropy
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(v.outputs["Volume"], out.inputs["Volume"])
    o.data.materials.append(m)
    o.visible_shadow = False
    return o


def floor(ctx, size=200, color="#0D0D10", roughness=0.28, z=0.0, grid=0.0, grid_color="#3A3A44"):
    """The stage floor: dark, glossy enough to mirror the lights, with a faint roughness grain. grid: glow of
    fine lines a unit apart (0 for none)."""
    import bmesh

    me = bpy.data.meshes.new("floor")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    bm.to_mesh(me)
    bm.free()
    m = material("floor", color, metallic=0.0, roughness=roughness, specular=0.6)
    nt = m.node_tree
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.0
    noise.inputs["Detail"].default_value = 6
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["To Min"].default_value = roughness * 0.75
    mr.inputs["To Max"].default_value = roughness * 1.35
    nt.links.new(noise.outputs["Fac"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], bsdf(m).inputs["Roughness"])
    if grid > 0:
        # Lines where the world x or y is near a whole number, fading with distance from the centre.
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
        acc = None
        for axis in ("X", "Y"):
            fr = nt.nodes.new("ShaderNodeMath")
            fr.operation = "PINGPONG"
            fr.inputs[1].default_value = 0.5
            nt.links.new(sep.outputs[axis], fr.inputs[0])
            st = nt.nodes.new("ShaderNodeMath")
            st.operation = "LESS_THAN"
            st.inputs[1].default_value = 0.012
            nt.links.new(fr.outputs["Value"], st.inputs[0])
            if acc is None:
                acc = st
            else:
                mx = nt.nodes.new("ShaderNodeMath")
                mx.operation = "MAXIMUM"
                nt.links.new(acc.outputs["Value"], mx.inputs[0])
                nt.links.new(st.outputs["Value"], mx.inputs[1])
                acc = mx
        ln = nt.nodes.new("ShaderNodeVectorMath")
        ln.operation = "LENGTH"
        nt.links.new(tc.outputs["Object"], ln.inputs[0])
        fade = nt.nodes.new("ShaderNodeMapRange")
        fade.inputs["From Min"].default_value = 4.0
        fade.inputs["From Max"].default_value = 22.0
        fade.inputs["To Min"].default_value = grid
        fade.inputs["To Max"].default_value = 0.0
        nt.links.new(ln.outputs["Value"], fade.inputs["Value"])
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        nt.links.new(acc.outputs["Value"], mul.inputs[0])
        nt.links.new(fade.outputs["Result"], mul.inputs[1])
        b = bsdf(m)
        b.inputs["Emission Color"].default_value = lin(grid_color)
        nt.links.new(mul.outputs["Value"], b.inputs["Emission Strength"])
    o = mesh_object("floor", me, m)
    o.location.z = z
    return o


def dust(ctx, count=260, box=((-8, 8), (-6, 6), (0, 6)), drift=(0.4, 0.2, 0.35), size=0.012, color="#FFE2C8", strength=1.5, name="dust"):
    """Motes floating in the light: points with a tiny glowing sphere on each, every one drifting on its own
    path over the clip (a shape key), so they blur and fall into bokeh like real dust."""
    import bmesh

    pts = bpy.data.meshes.new(name)
    verts = [
        (random.uniform(*box[0]), random.uniform(*box[1]), random.uniform(*box[2]))
        for _ in range(count)
    ]
    pts.from_pydata(verts, [], [])
    carrier = mesh_object(name, pts)
    carrier.instance_type = "VERTS"
    carrier.shape_key_add(name="rest")
    moved = carrier.shape_key_add(name="drift")
    for i, v in enumerate(moved.data):
        v.co = Vector(verts[i]) + Vector(
            (random.uniform(-1, 1) * drift[0], random.uniform(-1, 1) * drift[1], random.uniform(-0.3, 1) * drift[2])
        )
    key(moved, "value", [(1, 0.0), (ctx.frames, 1.0)], ease="LINEAR")
    sm = bpy.data.meshes.new(f"{name}_mote")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=size)
    bm.to_mesh(sm)
    bm.free()
    mote = mesh_object(f"{name}_mote", sm, emit_material(f"{name}_glow", color, strength))
    mote.parent = carrier
    return carrier


def render(ctx):
    sc = bpy.context.scene
    os.makedirs(os.path.join(ctx.out, "frames"), exist_ok=True)
    if ctx.still:
        for f in ctx.still:
            sc.frame_set(int(f))
            sc.render.filepath = os.path.join(ctx.out, "frames", f"still_{int(f):04d}")
            bpy.ops.render.render(write_still=True)
    else:
        bpy.ops.render.render(animation=True)
    if ctx.p.get("save_blend"):
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ctx.out, "scene.blend"))
