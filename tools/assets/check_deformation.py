"""Reimport the delivered GLBs and render a bent-arm / raised-knee stress pose."""
import bpy, sys, math, json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import build_assets as build
root=build.ROOT
reports={}
for kind in ['kaito','shiori','ren','goro']:
    build.reset();build.S=1.2 if kind=='goro' else 1
    bpy.ops.import_scene.gltf(filepath=str(root/'public/characters'/kind/'model.glb'))
    rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers)]
    bpy.context.view_layer.update()
    # Measure evaluated rest pose in glTF coordinates after Blender's axis conversion.
    pts=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
    minz=min(v.z for v in pts);maxz=max(v.z for v in pts)
    assert abs(minz)<.005,(kind,minz)
    for name,angle in [('LeftForeArm',-95),('RightForeArm',-70),('LeftUpLeg',-55),('LeftLeg',90)]:
        p=rig.pose.bones[name];p.rotation_mode='XYZ';p.rotation_euler.x=math.radians(angle)
    bpy.context.view_layer.update()
    for obj in meshes:
        ev=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());m=ev.to_mesh()
        assert all(math.isfinite(c) for v in m.vertices for c in v.co)
        ev.to_mesh_clear()
    cam=build.setup_render();cam.location=(3,-5,1.8*build.S)
    from mathutils import Vector
    cam.rotation_euler=(Vector((0,0,1.0*build.S))-cam.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.scene.render.filepath=str(build.PRE/f'{kind}_deformation.png')
    bpy.ops.render.render(write_still=True)
    reports[kind]={'feet_z_m':minz,'height_m':maxz,'reimported_skinned_meshes':len(meshes),'finite_deformed_vertices':True,'stress_pose_degrees':{'LeftForeArm':-95,'RightForeArm':-70,'LeftUpLeg':-55,'LeftLeg':90}}
(root/'public/characters/deformation-check.json').write_text(json.dumps(reports,indent=2))
