"""Quick look: import a fighter GLB and render a contact sheet (front, 3/4, side, back, face close-up).
python3 tools/assets/v2_preview.py kaito [awakened] [pose]  -> /tmp/sheet_<kind>.png
"""
import sys, math
from pathlib import Path
import bpy
from mathutils import Vector, Euler
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
kind = sys.argv[1]
awake = 'awakened' in sys.argv
pose = 'pose' in sys.argv
S = 1.2 if kind == 'goro' else 1.0
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT / f'public/characters/{kind}/model.glb'))
if awake:
    img = bpy.data.images.load(str(ROOT / f'public/characters/{kind}/tex_awakened.png'))
    for m in bpy.data.materials:
        if m.node_tree:
            for n in m.node_tree.nodes:
                if n.type == 'TEX_IMAGE':
                    n.image = img
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
if pose:
    P = rig.pose.bones
    def rot(n, x=0, y=0, z=0):
        b = P[n]; b.rotation_mode = 'XYZ'; b.rotation_euler = Euler((math.radians(x), math.radians(y), math.radians(z)))
    # punch with right arm, raise left knee (kick chamber), fists
    rot('RightArm', 0, 0, 60); rot('RightForeArm', 0, 0, 20)
    rot('LeftForeArm', -100, 0, 0); rot('LeftArm', -30, 0, 0)
    rot('LeftUpLeg', -80, 0, 0); rot('LeftLeg', 100, 0, 0)
    rot('RightUpLeg', -20, 0, 0); rot('RightLeg', 30, 0, 0)
    rot('Spine1', 10, 0, 0)
    for side in ('Left', 'Right'):
        for f in ('Index', 'Middle', 'Ring', 'Pinky'):
            for j in (1, 2, 3):
                if f'{side}Hand{f}{j}' in P:
                    rot(f'{side}Hand{f}{j}', 80 if j == 1 else 90)
        if f'{side}HandThumb2' in P:
            rot(f'{side}HandThumb2', 40); rot(f'{side}HandThumb3', 40)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 10
scene.cycles.use_denoising = True
scene.view_settings.view_transform = 'Standard'
scene.world = bpy.data.worlds.new('W')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.12, .14, .19, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = 1.1
for name, loc, power, size in [('Key', (-2.5, -4, 4.5), 500, 3), ('Rim', (1.5, 4, 3.5), 350, 2)]:
    d = bpy.data.lights.new(name, 'AREA'); d.energy = power * S * S; d.size = size
    o = bpy.data.objects.new(name, d); scene.collection.objects.link(o); o.location = Vector(loc) * S
    o.rotation_euler = (Vector((0, 0, S)) - o.location).to_track_quat('-Z', 'Y').to_euler()
cd = bpy.data.cameras.new('C'); cam = bpy.data.objects.new('C', cd); scene.collection.objects.link(cam); scene.camera = cam
cd.type = 'ORTHO'
scene.render.use_freestyle = True
scene.render.line_thickness_mode = 'ABSOLUTE'
vl = scene.view_layers[0]; vl.use_freestyle = True
ls = vl.freestyle_settings.linesets[0] if vl.freestyle_settings.linesets else vl.freestyle_settings.linesets.new('L')
ls.select_border = False; ls.select_crease = False
if ls.linestyle is None: ls.linestyle = bpy.data.linestyles.new('LS')
ls.linestyle.color = (0.05, 0.06, 0.1); ls.linestyle.thickness = 1.3
shots = [('front', (0, -6, 1.0), .98, 2.1, (360, 680)), ('q', (3.6, -4.6, 1.3), .98, 2.1, (360, 680)),
         ('side', (6, 0, 1.0), .98, 2.1, (360, 680)), ('back', (0, 6, 1.0), .98, 2.1, (360, 680)),
         ('face', (0.9, -5, 1.68), 1.66, 0.42, (360, 680))]
ims = []
for nm, loc, tz, osz, res in shots:
    scene.render.resolution_x, scene.render.resolution_y = res
    cd.ortho_scale = osz * S
    cam.location = Vector(loc) * S
    cam.rotation_euler = (Vector((0, 0, tz * S)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = f'/tmp/shot_{nm}.png'
    bpy.ops.render.render(write_still=True)
    ims.append(Image.open(f'/tmp/shot_{nm}.png').convert('RGB'))
W = sum(i.size[0] for i in ims); H = max(i.size[1] for i in ims)
sheet = Image.new('RGB', (W, H))
x = 0
for i in ims:
    sheet.paste(i, (x, 0)); x += i.size[0]
out = f'/tmp/sheet_{kind}{"_awake" if awake else ""}{"_pose" if pose else ""}.png'
sheet.save(out)
print('SHEET', out)
