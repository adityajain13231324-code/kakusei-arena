"""KAKUSEI ARENA v2 fighters: smooth lofted anime bodies, SDF-sculpted heads, layered hair clumps,
cloth shells with thickness, painted cel atlas with expression strip, finger bones.

Run (pip bpy 5.3 + numpy + Pillow + scipy):
    python3 tools/assets/build_assets_v2.py [kaito shiori ren goro] [--no-render]
Coordinates: Blender metres, Z up, front -Y. The glTF exporter writes Y up / +Z front.
"""
import sys, os, math, json, time
from pathlib import Path
import numpy as np
import bpy
from mathutils import Vector, Matrix
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from v2_geom import *          # noqa
import v2_face as FA
import v2_chars as CH
import v2_ch2 as CH2
CH2.register(CH)

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/characters'
PRE = OUT / 'previews'
PRE.mkdir(parents=True, exist_ok=True)

FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']


def log(*a):
    print('[v2]', *a, flush=True)


# ------------------------------------------------------------------ scene utils
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def base_bones(S):
    """Exact v1 bone layout (kept for renderer compatibility). name -> (head, tail, parent)."""
    B = {}

    def bone(n, h, t, p=None):
        B[n] = (np.array(h) * S, np.array(t) * S, p)
    bone('Hips', (0, 0, .88), (0, 0, 1.02))
    bone('Spine', (0, 0, 1.02), (0, 0, 1.18), 'Hips')
    bone('Spine1', (0, 0, 1.18), (0, 0, 1.34), 'Spine')
    bone('Spine2', (0, 0, 1.34), (0, 0, 1.48), 'Spine1')
    bone('Neck', (0, 0, 1.48), (0, 0, 1.57), 'Spine2')
    bone('Head', (0, 0, 1.57), (0, 0, 1.79), 'Neck')
    for side, s in [('Left', 1), ('Right', -1)]:
        bone(side + 'Shoulder', (s * .04, 0, 1.43), (s * .22, 0, 1.43), 'Spine2')
        bone(side + 'Arm', (s * .22, 0, 1.43), (s * .46, 0, 1.24), side + 'Shoulder')
        bone(side + 'ForeArm', (s * .46, 0, 1.24), (s * .65, 0, 1.04), side + 'Arm')
        bone(side + 'Hand', (s * .65, 0, 1.04), (s * .75, 0, .95), side + 'ForeArm')
        bone(side + 'UpLeg', (s * .105, 0, .94), (s * .13, 0, .53), 'Hips')
        bone(side + 'Leg', (s * .13, 0, .53), (s * .145, 0, .12), side + 'UpLeg')
        bone(side + 'Foot', (s * .145, 0, .12), (s * .145, -.14, .05), side + 'Leg')
        bone(side + 'ToeBase', (s * .145, -.14, .05), (s * .145, -.23, .05), side + 'Foot')
    bone('Hair_01', (0, .05, 1.73), (0, .13, 1.84), 'Head')
    bone('Scarf_01', (0, .07, 1.46), (-.12, .10, 1.19), 'Spine2')
    bone('Scarf_02', (-.12, .10, 1.19), (-.28, .10, .88), 'Scarf_01')
    bone('Ponytail_01', (0, .12, 1.69), (0, .17, 1.39), 'Head')
    bone('Ponytail_02', (0, .17, 1.39), (.04, .19, 1.10), 'Ponytail_01')
    return B


def hand_layout(sign, S, hp):
    """Finger joint chains in world space. hp: dict of hand proportions. Returns dict."""
    wrist = np.array([sign * .65, 0, 1.04]) * S
    d = nrm([sign * .10, 0, -.09])
    f = np.array([0, -1., 0])
    n = sign * nrm(np.cross(d, f))          # palm normal, toward the body
    k = hp.get('k', 1.0) * S
    out = {'wrist': wrist, 'd': d, 'f': f, 'n': n, 'chains': {}, 'k': hp.get('k', 1.0)}
    specs = {  # knuckle along d, across f, lengths, fan, curl per joint
        'Index': (0.086, 0.025, (0.033, 0.022, 0.019), 0.10),
        'Middle': (0.089, 0.0085, (0.036, 0.024, 0.020), 0.02),
        'Ring': (0.086, -0.0085, (0.033, 0.022, 0.019), -0.06),
        'Pinky': (0.080, -0.024, (0.026, 0.018, 0.016), -0.14),
    }
    for nm, (kd, kf, lens, fan) in specs.items():
        p = wrist + (d * kd + f * kf - n * 0.002) * k
        pts = [p]
        dirv = nrm(d + f * fan)
        for j, L in enumerate(lens):
            dirv = nrm(dirv + n * hp.get('curl', 0.20))
            p = p + dirv * L * k
            pts.append(p)
        out['chains'][nm] = pts
    # thumb
    p = wrist + (d * 0.018 + f * 0.020 + n * 0.012) * k
    dirv = nrm(d * 0.55 + f * 0.62 + n * 0.45)
    pts = [p]
    for L in (0.034, 0.027, 0.022):
        p = p + dirv * L * k
        pts.append(p)
        dirv = nrm(dirv + n * 0.18 + d * 0.05)
    out['chains']['Thumb'] = pts
    return out


def make_rig(S, hands, extra_bones=None):
    B = base_bones(S)
    for name, (head, tail, parent) in (extra_bones or {}).items():
        B[name] = (np.asarray(head) * S, np.asarray(tail) * S, parent)
    arm = bpy.data.armatures.new('MixamoHumanoid')
    rig = bpy.data.objects.new('Armature', arm)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for nm, (h, t, p) in B.items():
        e = arm.edit_bones.new(nm)
        e.head = Vector(h)
        e.tail = Vector(t)
        if p:
            e.parent = eb[p]
        eb[nm] = e
    segs = {nm: (h, t) for nm, (h, t, p) in B.items()}
    finger_bones = []
    for side, sign in [('Left', 1), ('Right', -1)]:
        hl = hands[side]
        for fn in FINGERS:
            pts = hl['chains'][fn]
            parent = eb[side + 'Hand']
            for j in range(3):
                nm = f'{side}Hand{fn}{j + 1}'
                e = arm.edit_bones.new(nm)
                e.head = Vector(pts[j])
                e.tail = Vector(pts[j + 1])
                e.align_roll(Vector(hl['n']))   # local Z = palm normal -> curl about local X
                e.parent = parent
                e.use_connect = False
                parent = e
                eb[nm] = e
                segs[nm] = (np.array(pts[j]), np.array(pts[j + 1]))
                finger_bones.append(nm)
    bpy.ops.object.mode_set(mode='OBJECT')
    rig.select_set(False)
    return rig, segs, finger_bones


# ------------------------------------------------------------------ mesh creation
def build_mesh(name, parts, rig, mat):
    V, Fc, UVc, N = [], [], [], []
    vgroups = {}
    off = 0
    smooth_flags = []
    for p in parts:
        A = atlas_uv(p)
        V.append(p.V)
        N.append(p.normals)
        for f in p.F:
            Fc.append(tuple(i + off for i in f))
            UVc.extend(A[i] for i in f)
            smooth_flags.append(p.smooth)
        for i, w in enumerate(p.weights):
            for b, x in w.items():
                vgroups.setdefault(b, []).append((i + off, x))
        off += len(p.V)
    V = np.vstack(V)
    N = np.vstack(N)
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], Fc)
    me.update()
    uvl = me.uv_layers.new(name='Atlas')
    uvl.data.foreach_set('uv', np.array(UVc, np.float32).reshape(-1))
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    me.normals_split_custom_set_from_vertices([tuple(n) for n in N])
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    for b, lst in vgroups.items():
        g = ob.vertex_groups.new(name=b)
        # group by weight value for fewer calls
        for idx, w in lst:
            g.add([idx], float(w), 'REPLACE')
    mod = ob.modifiers.new('Humanoid Skin', 'ARMATURE')
    mod.object = rig
    return ob


def make_material(img):
    m = bpy.data.materials.new('ToonAtlas')
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Roughness'].default_value = 1
    p.inputs['Specular IOR Level'].default_value = 0
    tex = m.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Linear'
    m.node_tree.links.new(tex.outputs['Color'], p.inputs['Base Color'])
    return m, tex


def np_to_image(name, arr):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = arr[::-1]
    img.pixels.foreach_set(rgba.reshape(-1))
    return img


def bake_ao(objs, mat, size=1024, samples=48, dist=0.18):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    if scene.world is None:
        scene.world = bpy.data.worlds.new('W')
    scene.world.light_settings.distance = dist
    img = bpy.data.images.new('AO', size, size, alpha=False, float_buffer=True)
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = img
    mat.node_tree.nodes.active = node
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    scene.render.bake.margin = 6
    t = time.time()
    bpy.ops.object.bake(type='AO', margin=6, use_clear=True)
    log('AO bake', round(time.time() - t, 1), 's')
    px = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(px)
    ao = px.reshape(size, size, 4)[::-1, :, 0].copy()
    mat.node_tree.nodes.remove(node)
    return ao


def export_glb(path, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                              export_yup=True, export_animations=False, export_skins=True,
                              export_extras=False, export_materials='EXPORT', export_texcoords=True,
                              export_normals=True, export_morph=False, export_image_format='AUTO')


# ------------------------------------------------------------------ rendering
def setup_render(S, res=(640, 860), samples=20, freestyle=True):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.view_settings.view_transform = 'Standard'
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new('W')
    w = scene.world
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (.10, .12, .17, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 0.55
    for o in [o for o in scene.objects if o.type in ('LIGHT', 'CAMERA')]:
        bpy.data.objects.remove(o)
    for name, loc, power, size in [('Key', (-2.5, -4, 4.5), 260, 3), ('Fill', (3, -3, 2), 70, 4), ('Rim', (1.5, 3.5, 3.5), 260, 2)]:
        d = bpy.data.lights.new(name, 'AREA')
        d.energy = power * S * S
        d.size = size
        o = bpy.data.objects.new(name, d)
        scene.collection.objects.link(o)
        o.location = Vector(loc) * S
        o.rotation_euler = (Vector((0, 0, 1 * S)) - o.location).to_track_quat('-Z', 'Y').to_euler()
    d = bpy.data.cameras.new('PreviewCamera')
    cam = bpy.data.objects.new('PreviewCamera', d)
    scene.collection.objects.link(cam)
    scene.camera = cam
    d.type = 'ORTHO'
    d.ortho_scale = 2.2 * S
    scene.render.use_freestyle = freestyle
    if freestyle:
        scene.render.line_thickness_mode = 'ABSOLUTE'
        scene.render.line_thickness = 1.4
        vl = scene.view_layers[0]
        vl.use_freestyle = True
        fs = vl.freestyle_settings
        ls = fs.linesets[0] if fs.linesets else fs.linesets.new('L')
        ls.select_by_visibility = True
        ls.select_silhouette = True
        ls.select_border = False
        ls.select_crease = False
        if ls.linestyle is None:
            ls.linestyle = bpy.data.linestyles.new('LS')
        ls.linestyle.color = (0.06, 0.07, 0.11)
        ls.linestyle.thickness = 1.6
    return cam


def render_views(kind, cam, S, suffix='', views=('front', 'side', 'back')):
    scene = bpy.context.scene
    locs = {'front': (0, -6, 1.0), 'side': (6, 0, 1.0), 'back': (0, 6, 1.0), 'three': (3.2, -5.2, 1.25)}
    for view in views:
        cam.location = Vector(locs[view]) * S
        cam.rotation_euler = (Vector((0, 0, .98 * S)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(PRE / f'{kind}{suffix}_{view}.png')
        t = time.time()
        bpy.ops.render.render(write_still=True)
        log('render', view, round(time.time() - t, 1), 's')


# ------------------------------------------------------------------ painting
def compose_atlas(parts, raster, ao_mask, painter, awake, face_fn, kind):
    pos, nor, pid, luv = raster
    H = pos.shape[0]
    out = np.zeros((H, H, 3), np.float32)
    glow = np.zeros((H, H), np.float32)
    out[:] = hexc('202634')
    for i, p in enumerate(parts):
        m = pid == i
        if not m.any():
            continue
        r = painter(p, pos[m], nor[m], luv[m], awake)
        base, shade = r['base'], r['shade']
        sh = ao_mask[m] * r.get('shadow_k', 1.0)
        if 'shadow_extra' in r:
            sh = np.maximum(sh, r['shadow_extra'])
        col = base * (1 - sh[:, None]) + shade * sh[:, None]
        if 'ink' in r:
            a = np.clip(r['ink'], 0, 1)[:, None]
            col = col * (1 - a) + r['ink_color'] * a
        if 'over' in r:   # overlay after shading (e.g. glowing marks)
            a = np.clip(r['over_a'], 0, 1)[:, None]
            col = col * (1 - a) + r['over'] * a
        out[m] = col
        if 'glow' in r:
            glow[m] = r['glow']
    # face panels
    panel0 = out[0:PANEL, 0:PANEL].copy()
    for k, ex in enumerate(EXPRESSIONS):
        rgb, g = face_fn(panel0, ex, awake)
        out[0:PANEL, k * PANEL:(k + 1) * PANEL] = rgb
        glow[0:PANEL, k * PANEL:(k + 1) * PANEL] = np.maximum(glow[0:PANEL, k * PANEL:(k + 1) * PANEL], g)
    return np.clip(out, 0, 1), np.clip(glow, 0, 1)


def save_png(arr, path, size=None):
    im = Image.fromarray((np.clip(arr, 0, 1) * 255 + .5).astype(np.uint8))
    if size and size != im.size[0]:
        im = im.resize((size, size), Image.LANCZOS)
    im.save(path, optimize=True)
    return im


# ------------------------------------------------------------------ main per character
def character(kind, render=True):
    t0 = time.time()
    reset()
    spec = CH.SPECS[kind]
    S = spec['S']
    hands = {side: hand_layout(sign, S, spec['hand']) for side, sign in [('Left', 1), ('Right', -1)]}
    rig, segs, finger_bones = make_rig(S, hands, spec.get('extra_bones'))
    parts = CH.build(kind, S, segs, hands)
    # weights + normals
    for p in parts:
        if p.normals is None:
            p.normals = compute_normals(p.V, p.F)
        p.weights = compute_weights(p, segs)
    D = pack(parts)
    log(kind, 'parts', len(parts), 'texel density px/m', round(D))
    folder = OUT / kind
    folder.mkdir(parents=True, exist_ok=True)
    blank = np_to_image('tex_tmp', np.zeros((64, 64, 3), np.float32))
    mat, node = make_material(blank)
    groups = {}
    for p in parts:
        groups.setdefault(p.group, []).append(p)
    objs = {g: build_mesh(g, ps, rig, mat) for g, ps in groups.items()}
    # raster + AO
    t = time.time()
    raster = rasterize(parts)
    pid0 = raster[2]
    pid, (pos, nor, luv) = dilate(pid0, [raster[0], raster[1], raster[3]])
    raster = (pos, nor, pid, luv)
    log('raster', round(time.time() - t, 1), 's')
    bake_objs = [o for g, o in objs.items() if g != 'ShoulderPlates']
    ao = bake_ao(bake_objs, mat, size=1024, samples=spec.get('ao_samples', 40))
    ao_img = Image.fromarray(np.clip(ao * 255, 0, 255).astype(np.uint8)).resize((ATLAS, ATLAS), Image.BICUBIC)
    from PIL import ImageFilter
    ao_img = ao_img.filter(ImageFilter.GaussianBlur(2.2))
    aoa = np.asarray(ao_img).astype(np.float32) / 255
    lo, hi = spec.get('ao_cut', (0.50, 0.60))
    ao_mask = smoothstep(hi, lo, aoa)
    painter = CH.painter(kind)
    face_fn = CH.face_painter(kind, S)
    tex, glow0 = compose_atlas(parts, raster, ao_mask, painter, False, face_fn, kind)
    texa, glow1 = compose_atlas(parts, raster, ao_mask, painter, True, face_fn, kind)
    save_png(tex, folder / 'tex.png')
    save_png(texa, folder / 'tex_awakened.png')
    save_png(tex, folder / 'tex_1024.png', 1024)
    save_png(texa, folder / 'tex_awakened_1024.png', 1024)
    glow = np.maximum(glow0, glow1)
    Image.fromarray((glow * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS).save(folder / 'tex_glow.png', optimize=True)
    img_n = bpy.data.images.load(str(folder / 'tex.png'))
    img_a = bpy.data.images.load(str(folder / 'tex_awakened.png'))
    img_s = bpy.data.images.load(str(folder / 'tex_1024.png'))
    node.image = img_n
    base = [o for g, o in objs.items() if g != 'ShoulderPlates']
    plates = [o for g, o in objs.items() if g == 'ShoulderPlates']
    export_glb(folder / 'model.glb', [rig] + base)
    node.image = img_s
    export_glb(folder / 'model_1024.glb', [rig] + base)
    node.image = img_n
    if plates:
        export_glb(folder / 'shoulder_plates.glb', [rig] + plates)

    def tris(ps):
        return int(sum(sum(len(f) - 2 for f in p.F) for p in ps))
    base_parts = [p for p in parts if p.group != 'ShoulderPlates']
    plate_parts = [p for p in parts if p.group == 'ShoulderPlates']
    allV = np.vstack([p.V for p in base_parts])
    exprs = {ex: [k * 0.25, 0.0] for k, ex in enumerate(EXPRESSIONS)}
    manifest = {
        'version': 2,
        'triangles': tris(base_parts),
        'base_triangles': tris(base_parts),
        'awakened_triangles': tris(base_parts) + tris(plate_parts),
        'triangles_by_mesh': {g: tris(ps) for g, ps in groups.items()},
        'bones': [b.name for b in rig.data.bones],
        'finger_bones': finger_bones,
        'finger_curl_axis': 'local +X (bone roll aligns local Z with the palm normal); positive X rotation curls toward the palm',
        'materials': 1,
        'height_m': float(allV[:, 2].max()),
        'body_height_m': float(spec.get('body_h', 1.80) * S),
        'mesh_count': len(base),
        'meshes': [o.name for o in base],
        'atlas': {'size': 2048, 'mobile': 1024, 'uv_layout': 'unique painted unwrap (v2), not the v1 8x8 palette grid',
                  'glow_mask': 'tex_glow.png (512, white = emissive when awakened)'},
        'expressions': {
            'mesh': 'Face_Expressions',
            'panels': EXPRESSIONS,
            'uv_offset_gltf': exprs,
            'how': 'Add the offset to the Face_Expressions UVs (or set texture.offset on a cloned map for that mesh only). Panels live in the top 512 px row of both atlases.',
            'default': 'neutral',
        },
        'notes': spec.get('notes', ''),
    }
    (folder / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    log(kind, 'tris', manifest['triangles'], 'export done', round(time.time() - t0, 1), 's')
    if render:
        for o in plates:
            o.hide_render = True
        cam = setup_render(S)
        render_views(kind, cam, S)
        node.image = img_a
        for o in plates:
            o.hide_render = False
        render_views(kind, cam, S, '_awakened')
        node.image = img_n
    return manifest


if __name__ == '__main__':
    cli = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    args = [a for a in cli if not a.startswith('--')]
    render = '--no-render' not in sys.argv
    kinds = args or ['kaito', 'shiori', 'ren', 'goro']
    for k in kinds:
        character(k, render)
