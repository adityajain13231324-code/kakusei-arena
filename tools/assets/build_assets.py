"""Original KAKUSEI ARENA assets. Run with Blender 5.2 --background --python.
Coordinates below are Blender metres: Z up, front -Y. glTF exports Y up/+Z front.
"""
import bpy, math, json, sys, os
from pathlib import Path
from mathutils import Vector
from array import array

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/characters'
PRE = ROOT / 'public/characters/previews'
PRE.mkdir(parents=True, exist_ok=True)
S = 1.0
objects = []
palette = []
rig = None
mat = None

def reset():
    global objects
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.data.orphans_purge(do_recursive=True)
    objects = []

def uvcell(i):
    return ((i % 8 + .5)/8, (i // 8 + .5)/8)

def paint(obj, color, bone=None, outline=True):
    obj.data.materials.clear(); obj.data.materials.append(mat)
    uv = obj.data.uv_layers.active or obj.data.uv_layers.new(name='Atlas')
    uv.name='Atlas'
    for l in uv.data: l.uv = uvcell(color)
    if bone:
        obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))),1,'REPLACE')
    obj['outline'] = outline
    objects.append(obj)
    return obj

def mesh(name, verts, faces, color, bone=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata([tuple(Vector(v)*S) for v in verts],[],faces); data.update()
    obj = bpy.data.objects.new(name,data); bpy.context.collection.objects.link(obj)
    return paint(obj,color,bone)

def ell(name, loc, scale, color, bone=None, seg=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=rings,location=Vector(loc)*S)
    obj=bpy.context.object; obj.name=name; obj.scale=Vector(scale)*S
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    return paint(obj,color,bone)

def box(name, loc, scale, color, bone=None, bevel=.0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=Vector(loc)*S)
    obj=bpy.context.object; obj.name=name; obj.scale=Vector(scale)*S
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    if bevel:
        mod=obj.modifiers.new('Small edge bevel','BEVEL');mod.width=bevel*S;mod.segments=1
        bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=mod.name)
    return paint(obj,color,bone)

def tube(name, centers, radii, color, bone=None, sides=12, weights=None):
    verts=[]; faces=[]
    for j,c in enumerate(centers):
        t=Vector(centers[min(j+1,len(centers)-1)])-Vector(centers[max(0,j-1)])
        t.normalize(); u=t.cross(Vector((0,1,0))).normalized(); v=t.cross(u).normalized()
        rr=radii[j]; a,b=rr if isinstance(rr,tuple) else (rr,rr)
        for k in range(sides):
            q=2*math.pi*k/sides
            verts.append(Vector(c)+a*math.cos(q)*u+b*math.sin(q)*v)
    for j in range(len(centers)-1):
        for k in range(sides):
            a=j*sides+k;b=j*sides+(k+1)%sides
            faces.append((a,b,b+sides,a+sides))
    faces += [tuple(reversed(range(sides))),tuple((len(centers)-1)*sides+k for k in range(sides))]
    obj=mesh(name,verts,faces,color,bone)
    if weights:
        for j,ws in enumerate(weights):
            for bn,w in ws.items():
                group=obj.vertex_groups.get(bn) or obj.vertex_groups.new(name=bn)
                group.add(list(range(j*sides,(j+1)*sides)),w,'REPLACE')
    return obj

def spike(name,base,tip,width,color,bone='Head'):
    c=Vector(base);t=Vector(tip)
    return tube(name,[c,c.lerp(t,.4),t],[width,width*.75,.002],color,bone,5)

def ribbon(name, points, widths, color, bones):
    verts=[]
    for p,w in zip(points,widths):
        for dy,dx in [(-.008,-w/2),(-.008,w/2),(.008,-w/2),(.008,w/2)]:
            verts.append((p[0]+dx,p[1]+dy,p[2]))
    faces=[]
    for i in range(len(points)-1):
        a=4*i;b=a+4
        faces.extend([(a,a+1,b+1,b),(a+2,b+2,b+3,a+3),(a,b,b+2,a+2),(a+1,a+3,b+3,b+1)])
    faces += [(0,2,3,1),tuple(range(len(verts)-4,len(verts)))]
    obj=mesh(name,verts,[tuple(reversed(f)) for f in faces],color)
    for i,bn in enumerate(bones):
        group=obj.vertex_groups.get(bn) or obj.vertex_groups.new(name=bn)
        group.add(list(range(i*4,i*4+4)),1,'REPLACE')
    return obj

def make_rig(bulk=False):
    global rig
    arm=bpy.data.armatures.new('MixamoHumanoid')
    rig=bpy.data.objects.new('Armature',arm);bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig;rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    b={}
    def bone(name,head,tail,parent=None):
        e=arm.edit_bones.new(name);e.head=Vector(head)*S;e.tail=Vector(tail)*S
        if parent:e.parent=b[parent]
        b[name]=e
    bone('Hips',(0,0,.88),(0,0,1.02))
    bone('Spine',(0,0,1.02),(0,0,1.18),'Hips')
    bone('Spine1',(0,0,1.18),(0,0,1.34),'Spine')
    bone('Spine2',(0,0,1.34),(0,0,1.48),'Spine1')
    bone('Neck',(0,0,1.48),(0,0,1.57),'Spine2')
    bone('Head',(0,0,1.57),(0,0,1.79),'Neck')
    for side,sign in [('Left',1),('Right',-1)]:
        bone(side+'Shoulder',(sign*.04,0,1.43),(sign*.22,0,1.43),'Spine2')
        bone(side+'Arm',(sign*.22,0,1.43),(sign*.46,0,1.24),side+'Shoulder')
        bone(side+'ForeArm',(sign*.46,0,1.24),(sign*.65,0,1.04),side+'Arm')
        bone(side+'Hand',(sign*.65,0,1.04),(sign*.75,0,.95),side+'ForeArm')
        bone(side+'UpLeg',(sign*.105,0,.94),(sign*.13,0,.53),'Hips')
        bone(side+'Leg',(sign*.13,0,.53),(sign*.145,0,.12),side+'UpLeg')
        bone(side+'Foot',(sign*.145,0,.12),(sign*.145,-.14,.05),side+'Leg')
        bone(side+'ToeBase',(sign*.145,-.14,.05),(sign*.145,-.23,.05),side+'Foot')
    bone('Hair_01',(0,.05,1.73),(0,.13,1.84),'Head')
    bone('Scarf_01',(0,.07,1.46),(-.12,.10,1.19),'Spine2')
    bone('Scarf_02',(-.12,.10,1.19),(-.28,.10,.88),'Scarf_01')
    bone('Ponytail_01',(0,.12,1.69),(0,.17,1.39),'Head')
    bone('Ponytail_02',(0,.17,1.39),(.04,.19,1.10),'Ponytail_01')
    bpy.ops.object.mode_set(mode='OBJECT');rig.select_set(False)

def body(kind):
    bulk=kind=='goro'; w=1.38 if bulk else (0.88 if kind=='shiori' else 1)
    # Ring topology and gradual blend weights across torso and major joints.
    tube('Torso',[(0,0,z) for z in [.90,1.01,1.10,1.20,1.31,1.40,1.46]],
         [(x*w,y*w) for x,y in [(.135,.10),(.145,.10),(.12,.085),(.15,.105),(.19,.12),(.21,.10),(.16,.075)]],
         0,None,16,[{'Hips':1},{'Hips':.7,'Spine':.3},{'Spine':.8,'Spine1':.2},{'Spine1':1},{'Spine1':.3,'Spine2':.7},{'Spine2':1},{'Spine2':1}])
    tube('Neck',[(0,0,1.43),(0,0,1.55),(0,0,1.59)],[.065*w,.056*w,.06*w],0,None,12,[{'Spine2':.4,'Neck':.6},{'Neck':.8,'Head':.2},{'Head':1}])
    tube('Trouser_Pelvis',[(0,0,.86),(0,0,.94),(0,0,1.025)],[(.166*w,.105*w),(.17*w,.108*w),(.146*w,.105*w)],2,'Hips',16)
    # Shaped chin, cheek and cranium rings. Flat cheeks leave room for graphic facial features.
    tube('Face',[(0,-.018,z) for z in [1.535,1.56,1.60,1.65,1.70,1.75,1.79,1.81]],
         [(a*(1.13 if bulk else 1),b) for a,b in [(.035,.045),(.070,.075),(.105,.093),(.116,.105),(.115,.106),(.103,.094),(.07,.063),(.01,.01)]],0,'Head',20)
    for side,sign in [('Left',1),('Right',-1)]:
        ell('Ear_'+side,(sign*.115,-.004,1.655),(.025,.018,.04),0,'Head',10,6)
        ell(side+'_ArmSkin_Deltoid',(sign*.208,0,1.408),(.083*w,.081*w,.079*w),0,side+'Arm',16,10)
        a=[(sign*x,0,z) for x,z in [(.19,1.425),(.24,1.41),(.34,1.335),(.43,1.265),(.46,1.24),(.485,1.215),(.56,1.14),(.63,1.06),(.66,1.03)]]
        tube(side+'_ArmSkin',a,[r*w for r in [.075,.084,.071,.059,.058,.059,.061,.04,.038]],0,None,12,
             [{side+'Arm':1}]*3+[{side+'Arm':.8,side+'ForeArm':.2},{side+'Arm':.5,side+'ForeArm':.5},{side+'Arm':.2,side+'ForeArm':.8}]+[{side+'ForeArm':1}]*3)
        tube(side+'_Palm',[(sign*.65,0,1.04),(sign*.70,-.005,.995),(sign*.735,-.008,.96)],[.038,.045,.036],0,side+'Hand',10)
        for j in range(4):
            offset=(j-1.5)*.019;length=.064-abs(j-1.3)*.012
            x=.724+offset*.7;z=.969+offset*.7
            tube(side+'_Finger'+str(j),[(sign*x,-.008,z),(sign*(x+length*.55),-.01,z-length*.55),(sign*(x+length),-.006,z-length)],[.010,.009,.007],0,side+'Hand',7)
        tube(side+'_Thumb',[(sign*.68,-.033,1.014),(sign*.69,-.067,.98),(sign*.72,-.075,.962)],[.016,.014,.009],0,side+'Hand',7)
        tube(side+'_Trousers',[(sign*x,0,z) for x,z in [(.105,.96),(.11,.87),(.12,.71),(.128,.575),(.13,.53),(.132,.49),(.14,.33),(.145,.16)]],
             [r*w for r in [.102,.108,.084,.066,.063,.064,.066,.047]],2,None,12,
             [{side+'UpLeg':1}]*3+[{side+'UpLeg':.8,side+'Leg':.2},{side+'UpLeg':.5,side+'Leg':.5},{side+'UpLeg':.2,side+'Leg':.8},{side+'Leg':1},{side+'Leg':1}])
        tube(side+'_Boot',[(sign*.145,.018,.03),(sign*.145,.018,.08),(sign*.145,0,.20)],[ (.067,.09),(.065,.09),(.05,.055)],2,side+'Foot',12)
        ell(side+'_Shoe',(sign*.145,-.085,.061),(.066,.15,.06),2,side+'Foot',12,6)
        box(side+'_Sole',(sign*.145,-.07,.013),(.14,.27,.026),6,side+'Foot',.01)
    face(kind)

def face(kind):
    # Eye pieces have distinct atlas cells, including normal/awakened Ren expression.
    for sign in [-1,1]:
        x=sign*.049
        ell('Eye_White',(x,-.111,1.674),(.041,.012,.024),7,'Head',16,8)
        ell('Iris',(x+sign*.002,-.124,1.673),(.015,.004,.021),8,'Head',12,8)
        ell('Pupil',(x+sign*.002,-.128,1.672),(.006,.002,.014),9,'Head',10,6)
        ell('Eye_Glint',(x-.005,-.131,1.681),(.005,.002,.006),10,'Head',8,6)
        tube('Upper_Lash',[(x-sign*.038,-.120,1.680),(x,-.130,1.695),(x+sign*.034,-.113,1.686)],[.003,.004,.003],11,'Head',6)
        if kind=='ren':
            tube('Closed_Eyelid',[(x-.033,-.127,1.671),(x,-.132,1.667),(x+.033,-.127,1.671)],[.002,.0025,.002],15,'Head',6)
        tube('Brow',[(x-sign*.029,-.111,1.712),(x,-.117,1.718),(x+sign*.033,-.106,1.711)],[.005,.006,.003],3,'Head',6)
    mesh('Nose',[(-.011,-.111,1.649),(.011,-.111,1.649),(0,-.140,1.626),(0,-.109,1.617)],[(0,2,1),(0,3,2),(1,2,3)],0,'Head')
    tube('Mouth', [(-.024,-.104,1.594),(0,-.113,1.590),(.024,-.104,1.594)],[.002,.0025,.002],12,'Head',6)

def hair(kind):
    if kind=='goro':
        ell('Topknot',(0,.035,1.83),(.046,.048,.055),3,'Hair_01',12,8)
        tube('Topknot_Tie',[(0,.035,1.79),(0,.035,1.805)],[.036,.038],4,'Head',12)
        return
    # Open cap follows cranium, avoids a spherical helmet over the face.
    verts=[]; faces=[];n=20
    for row in range(5):
        for k in range(n):
            ang=2*math.pi*k/n
            lower=1.70 if math.sin(ang)<-.3 else 1.62
            t=row/4
            z=lower+(1.825-lower)*t
            radius=.002 if row==4 else .130*math.sqrt(max(.01,1-((z-1.68)/.15)**2))
            verts.append((math.cos(ang)*radius,-.008+math.sin(ang)*radius,z))
    for row in range(4):
        for k in range(n):
            a=row*n+k;b=row*n+(k+1)%n;faces.append((a,b,b+n,a+n))
    faces.append(tuple(4*n+k for k in range(n)))
    mesh('Hair_Cap',verts,faces,3,'Head')
    if kind=='kaito':
        for j in range(11):
            ang=2*math.pi*j/11
            base=(.08*math.cos(ang),.07*math.sin(ang),1.76)
            tip=(.17*math.cos(ang)+.027,.13*math.sin(ang),1.85+.07*((j%3)/2))
            spike('Flame_Lock',base,tip,.055,3 if j%3 else 4)
        for j in range(5):
            x=(j-2)*.039
            spike('Fringe',(x,-.084,1.79),(x-.025,-.125,1.70+(j%2)*.025),.032,3)
    else:
        for j in range(6):
            x=(j-2.5)*.036
            spike('Swept_Fringe',(x,-.075,1.79),(x-.035,-.124,1.69+(j%3)*.012),.032,5 if kind=='shiori' and j==3 else 3)
        if kind=='ren':
            tube('Ponytail',[(0,.095,1.76),(0,.15,1.69),(0,.19,1.51),(.015,.20,1.35),(.04,.21,1.15)], [.045,.045,.039,.031,.004],3,None,10,[{'Head':1},{'Ponytail_01':1},{'Ponytail_01':1},{'Ponytail_01':.3,'Ponytail_02':.7},{'Ponytail_02':1}])
            box('Ponytail_Clasp',(0,.15,1.70),(.075,.04,.04),4,'Ponytail_01',.007)

def clothing(kind):
    if kind=='kaito':
        tube('Tank_Top',[(0,0,z) for z in [1.04,1.14,1.27,1.395]],[ (.143,.109),(.145,.111),(.19,.128),(.205,.115)],1,None,16,[{'Spine':1},{'Spine':.4,'Spine1':.6},{'Spine1':.5,'Spine2':.5},{'Spine2':1}])
        for sign in [-1,1]:
            ribbon('Tank_Strap',[(sign*.13,-.09,1.35),(sign*.145,-.07,1.44),(sign*.145,.065,1.44),(sign*.13,.09,1.35)],[.045]*4,1,['Spine2']*4)
            ribbon('Tied_Jacket_Sleeve',[(sign*.04,-.12,1.02),(sign*.15,-.15,.98),(sign*.20,-.14,.84)],[.08,.065,.055],2,['Hips']*3)
            ribbon('Torn_Jacket_Tail',[(sign*.09,.105,1.04),(sign*.16,.135,.88),(sign*.19,.14,.66),(sign*.22,.14,.71)],[.18,.20,.17,.035],2,['Hips',('Left' if sign==1 else 'Right')+'UpLeg',('Left' if sign==1 else 'Right')+'UpLeg',('Left' if sign==1 else 'Right')+'UpLeg'])
            for j in range(6):
                x=.56+j*.019;z=1.14-j*.019
                tube('Hand_Wrap',[(sign*x,0,z),(sign*(x+.016),0,z-.016)],[.055-j*.002,.054-j*.002],1 if j%2 else 5,('Left' if sign==1 else 'Right')+'ForeArm',10)
            box('Trouser_Red_Tab',(sign*.174,-.02,.72),(.025,.15,.18),4,('Left' if sign==1 else 'Right')+'UpLeg',.005)
        box('Jacket_Knot',(0,-.145,1.015),(.11,.065,.07),4,'Hips',.018)
    elif kind=='shiori':
        tube('Ninja_Tunic',[(0,0,z) for z in [1.00,1.10,1.25,1.39,1.43]],[ (.13,.10),(.12,.091),(.159,.113),(.19,.104),(.14,.081)],2,None,16,[{'Hips':1},{'Spine':1},{'Spine1':1},{'Spine2':1},{'Spine2':1}])
        ell('Half_Mask',(0,-.073,1.604),(.101,.059,.049),2,'Head',16,8)
        tube('Scarf_Collar',[(0,0,1.45),(0,0,1.49),(0,0,1.515)],[.095,.093,.08],4,'Neck',16)
        ribbon('Long_Scarf',[(.05,.09,1.48),(-.06,.14,1.30),(-.17,.16,1.08),(-.29,.16,.87),(-.35,.16,.91)],[.12,.13,.13,.14,.05],4,['Scarf_01','Scarf_01','Scarf_02','Scarf_02','Scarf_02'])
        ribbon('Scarf_Silver_Edge',[(.10,.079,1.48),(-.01,.129,1.30),(-.12,.149,1.08),(-.24,.149,.87)],[.012]*4,5,['Scarf_01','Scarf_01','Scarf_02','Scarf_02'])
        for sign in [-1,1]:
            side='Left' if sign==1 else 'Right'
            tube('Fingerless_Glove',[(sign*.635,0,1.055),(sign*.69,-.003,1.005),(sign*.72,-.005,.978)],[.045,.049,.041],2,side+'Hand',10)
        # Belt-carried kunai leaves the rest pose and retargeting hands unobstructed.
        tube('Kunai_Handle',[(.18,-.08,1.02),(.22,-.08,.90)],[.014,.014],3,'Hips',8)
        mesh('Kunai_Blade',[(.20,-.08,.90),(.27,-.08,.87),(.29,-.08,.70),(.20,-.08,.85),(.24,-.095,.85)],[(0,1,4),(1,2,4),(2,3,4),(3,0,4),(3,2,1,0)],5,'Hips')
    elif kind=='ren':
        # Open haori: independent front panels and back with a split below the hips.
        for sign in [-1,1]:
            ribbon('Haori_Front',[(sign*.145,-.10,1.44),(sign*.14,-.13,1.30),(sign*.105,-.111,1.08),(sign*.15,-.117,.91),(sign*.17,-.12,.74)],[.14,.15,.12,.18,.20],1,['Spine2','Spine1','Spine','Hips',('Left' if sign==1 else 'Right')+'UpLeg'])
            ribbon('Haori_Lapel',[(sign*.078,-.113,1.45),(sign*.068,-.143,1.29),(sign*.052,-.123,1.08)],[.022]*3,5,['Spine2','Spine1','Spine'])
            side='Left' if sign==1 else 'Right'
            tube('Haori_Sleeve',[(sign*.20,0,1.43),(sign*.28,0,1.37),(sign*.39,0,1.29)],[.102,.118,.125],1,side+'Arm',12)
            ribbon('Haori_Back',[(sign*.09,.105,1.43),(sign*.09,.133,1.26),(sign*.08,.113,1.06),(sign*.12,.14,.78)],[.18,.19,.17,.22],1,['Spine2','Spine1','Spine',side+'UpLeg'])
        # Geometric crescent applique, kept separate from the skin's expression atlas.
        verts=[]
        for j in range(21):
            a=math.radians(65+230*j/20)
            verts.extend([(.065*math.cos(a),.147,1.32+.065*math.sin(a)),(.025+.052*math.cos(a),.148,1.32+.052*math.sin(a))])
        mesh('Crescent_Moon',verts,[(j*2,j*2+1,j*2+3,j*2+2) for j in range(20)],4,'Spine1')
        tube('Obi',[(0,0,1.00),(0,0,1.065)],[ (.154,.129),(.149,.125)],3,'Hips',16)
        # Left hip in this coordinate convention is +X. Sword is its own skinned mesh.
        tube('Katana_Sheath',[(.17,.025,1.02),(.30,.075,.90),(.54,.13,.64),(.67,.15,.49)],[.027,.026,.024,.016],3,'Hips',10)
        kat=tube('Katana',[(.17,.025,1.02),(.07,-.018,1.14),(.015,-.04,1.21)],[.018,.018,.016],2,'Hips',8)
        kat['separate_weapon']=True
        blade=mesh('Katana_Blade',[(.17,.02,1.02),(.19,.02,1.00),(.65,.145,.51),(.65,.145,.48),(.18,.01,1.01)],[(0,1,4),(1,2,4),(2,3,4),(3,0,4),(0,3,2,1)],5,'Hips');blade['separate_weapon']=True
        ell('Katana_Tsuba',(.17,.025,1.02),(.055,.047,.016),4,'Hips',12,6)['separate_weapon']=True
        for j in range(5):
            ell('Handle_Diamond',(.055+j*.021,-.043+j*.008,1.164-j*.023),(.01,.007,.008),1,'Hips',6,4)['separate_weapon']=True
        for obj in objects:
            if obj.get('separate_weapon') or obj.name.startswith('Katana_Sheath'):
                for vertex in obj.data.vertices:vertex.co+=Vector((.10,-.15,0))*S
    else:
        tube('Monk_Robe',[(0,0,z) for z in [.70,.81,.94,1.07,1.23,1.40]],[ (.31,.20),(.29,.20),(.26,.18),(.23,.16),(.255,.18),(.295,.17)],1,None,16,
             [{'Hips':1},{'Hips':1},{'Hips':1},{'Spine':1},{'Spine1':1},{'Spine2':1}])
        for sign in [-1,1]:
            side='Left' if sign==1 else 'Right'
            ribbon('Robe_Shoulder',[(sign*.20,-.16,1.37),(sign*.19,-.09,1.46),(sign*.19,.095,1.46),(sign*.20,.16,1.37)],[.09]*4,1,['Spine2']*4)
            for j in range(5):
                x=.49+j*.032;z=1.21-j*.034
                ell('Forearm_Stone',(sign*x,-.025,z),(.068-j*.004,.069,.060),5 if j%2 else 6,side+'ForeArm',7,5)
            plate=ell('Awakened_Shoulder_Plate',(sign*.255,0,1.45),(.14,.14,.13),13,side+'Arm',7,5)
            plate['awakened_plate']=True
        tube('Rope_Belt',[(0,0,1.02),(0,0,1.07)],[ (.247,.176),(.24,.174)],4,'Hips',16)
        for j in range(15):
            a=math.pi*2*j/15
            ell('Prayer_Bead',(.29*math.cos(a),.19*math.sin(a),1.40+.055*math.sin(a)),(.028,.028,.028),3,'Spine2',10,6)
        ell('Bead_Pendant',(0,-.205,1.30),(.037,.022,.05),4,'Spine2',10,6)

COLORS={
 'kaito':['d99b78','f4edda','202737','b82e35','f04438','b9bdc6','141921','fff8e8','ed9b27','171a25','ffffff','27202a','874f45','dcb56c','111525'],
 'shiori':['d5ae98','c7c2d9','252435','141b2b','7144ac','d8ddeb','171a25','f6f2eb','a48cdb','101624','ffffff','171624','875c62','a4a3b6','111525'],
 'ren':['e6bca2','edece6','29374b','18263d','c1ae76','91aabd','1a2331','e6bca2','e6bca2','e6bca2','e6bca2','e6bca2','946e60','afb6bf','111525','503e43'],
 'goro':['c4906e','77533c','303239','30343c','d6b57a','777f86','535e68','fff3db','806846','242731','ffffff','493d35','87604b','7c8b94','111525']}

def atlas(kind,awake,size,path):
    colors=COLORS[kind].copy()
    if awake:
        if kind=='kaito':colors[3]='fff2c5';colors[4]='ffb547';colors[8]='ffcf77';colors[5]='f5c087'
        if kind=='shiori':
            colors=['080b13','0b0d17','070910','0b0e17','17121f','f4f6ff','080b12','ffffff','ffffff','0b0c13','ffffff','f0f0ff','d8dbe5','111522','f8fbff']
        if kind=='ren':
            colors[7]='f3fbff';colors[8]='a8eaff';colors[9]='d8faff';colors[10]='ffffff';colors[11]='26354d'
            colors[15]='c4f1ff'
    image=bpy.data.images.new(kind+('_awakened' if awake else '')+'_'+str(size),width=size,height=size,alpha=True)
    px=array('f')
    for row in range(8):
        scan=array('f')
        for col in range(8):
            idx=row*8+col;c=colors[idx] if idx<len(colors) else '252c3b'
            scan.extend(array('f',[*(int(c[i:i+2],16)/255 for i in (0,2,4)),1])*(size//8))
        px.extend(scan*(size//8))
    image.pixels.foreach_set(px);image.filepath_raw=str(path);image.file_format='PNG';image.save()
    return image

def material(image):
    m=bpy.data.materials.new('ToonAtlas');m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=1
    p.inputs['Specular IOR Level'].default_value=0
    tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;tex.interpolation='Closest'
    m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
    return m,tex

def bind():
    for obj in objects:
        mod=obj.modifiers.new('Humanoid Skin','ARMATURE');mod.object=rig
        # Static local seams and facets are deliberate; joint rings retain smooth weights.
        smooth=any(s in obj.name for s in ['Face','ArmSkin','Palm','Finger','Thumb','Neck','Ear','Eye','Iris','Pupil','Glint','Mouth','Lash'])
        for p in obj.data.polygons:p.use_smooth=smooth

def consolidate():
    global objects
    groups={}
    for o in objects:
        group='ShoulderPlates' if o.get('awakened_plate') else ('Katana' if o.get('separate_weapon') else ('Face_Expressions' if any(x in o.name for x in ['Eye_','Iris','Pupil','Glint','Lash','Eyelid','Mouth','Brow']) else 'Fighter'))
        groups.setdefault(group,[]).append(o)
    objects=[]
    for name,obs in groups.items():
        select_export(obs);bpy.context.view_layer.objects.active=obs[0]
        bpy.ops.object.join();o=bpy.context.object;o.name=name
        # Shared atlas may create duplicate slots during joining; collapse to one.
        o.data.materials.clear();o.data.materials.append(mat)
        for p in o.data.polygons:p.material_index=0
        if name=='ShoulderPlates':o['awakened_plate']=True
        objects.append(o)

def select_export(obs):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in obs:obj.select_set(True)
    bpy.context.view_layer.objects.active=rig if rig in obs else obs[0]

def export_glb(path,obs):
    select_export(obs)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,
        export_yup=True,export_animations=False,export_skins=True,export_extras=True,
        export_materials='EXPORT',export_texcoords=True,export_normals=True)

def setup_render():
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
    scene.render.resolution_x=650;scene.render.resolution_y=850;scene.render.resolution_percentage=100
    scene.world.color=(.4,.4,.4)
    scene.view_settings.view_transform='Standard'
    scene.render.image_settings.file_format='PNG'
    scene.render.film_transparent=False
    scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.065,.082,.115,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.7
    for name,loc,power,size in [('Key',(-3,-4,6),450,4),('Fill',(3,-2,3),230,3),('Rim',(0,3,4),550,3)]:
        d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size
        o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=loc
        o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
    d=bpy.data.cameras.new('PreviewCamera');cam=bpy.data.objects.new('PreviewCamera',d);scene.collection.objects.link(cam)
    scene.camera=cam;d.type='ORTHO';d.ortho_scale=2.25*S
    return cam

def render_views(kind,cam,suffix=''):
    scene=bpy.context.scene
    for view,loc in [('front',(0,-5,1.0*S)),('side',(5,0,1.0*S)),('back',(0,5,1.0*S))]:
        cam.location=loc;cam.rotation_euler=(Vector((0,0,.98*S))-cam.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=str(PRE/f'{kind}{suffix}_{view}.png');bpy.ops.render.render(write_still=True)

def character(kind):
    global S,mat
    reset();S=1.2 if kind=='goro' else 1
    folder=OUT/kind;folder.mkdir(parents=True,exist_ok=True)
    tex=atlas(kind,False,2048,folder/'tex.png')
    awake=atlas(kind,True,2048,folder/'tex_awakened.png')
    texsmall=atlas(kind,False,1024,folder/'tex_1024.png')
    atlas(kind,True,1024,folder/'tex_awakened_1024.png')
    mat,node=material(tex);make_rig(kind=='goro');body(kind);hair(kind);clothing(kind);bind();consolidate()
    plates=[o for o in objects if o.get('awakened_plate')]
    base=[o for o in objects if o not in plates]
    export_glb(folder/'model.glb',[rig]+base)
    node.image=texsmall;export_glb(folder/'model_1024.glb',[rig]+base);node.image=tex
    if plates:export_glb(folder/'shoulder_plates.glb',[rig]+plates)
    tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects)
    report={'triangles':tris,'base_triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in base),'bones':[b.name for b in rig.data.bones], 'materials':1,'height_m':max(v.co.z for o in base for v in o.data.vertices),'mesh_count':len(base)}
    (folder/'manifest.json').write_text(json.dumps(report,indent=2))
    if os.environ.get('ASSET_SKIP_RENDERS')=='1':return report
    for o in plates:o.hide_render=True
    cam=setup_render();render_views(kind,cam)
    node.image=awake
    for o in plates:o.hide_render=False
    render_views(kind,cam,'_awakened')
    node.image=tex
    return report

def prop(name):
    global S,mat,rig
    reset();S=1;rig=None
    folder=ROOT/'public/props';folder.mkdir(parents=True,exist_ok=True)
    tex=bpy.data.images.load(str(OUT/'goro/tex.png'));tex.scale(128,128);tex.pack();mat,node=material(tex)
    if name=='water_tank':
        tube('Tank',[(0,0,.65),(0,0,.75),(0,0,2.0),(0,0,2.08)],[.56,.62,.62,.52],5,None,16)
        for z in [.8,1.3,1.93]:tube('SteelBand',[(0,0,z),(0,0,z+.05)],[.63,.63],6,None,16)
        for x in [-.4,.4]:
            for y in [-.4,.4]:box('Leg',(x,y,.36),(.08,.08,.72),6)
        box('Ladder_Rail',(-.18,-.67,1.05),(.035,.04,2.1),6);box('Ladder_Rail',(.18,-.67,1.05),(.035,.04,2.1),6)
        for j in range(8):box('Ladder_Rung',(0,-.67,.15+j*.25),(.38,.04,.035),6)
    elif name=='ac_unit':
        box('Housing',(0,0,.4),(1.1,.45,.8),1,bevel=.035)
        for j in range(11):box('Vent',(0,-.232,.18+j*.045),(.88,.015,.013),6)
        for x in [-.37,.37]:box('Foot',(x,0,.03),(.12,.55,.06),6)
    elif name=='neon_sign_frame':
        for x in [-1,1]:box('FrameSide',(x,0,1.1),(.07,.13,1.2),6)
        for z in [.5,1.7]:box('FrameEdge',(0,0,z),(2.07,.13,.07),6)
        box('BlankPanel',(0,.03,1.1),(1.92,.07,1.12),2)
        for x in [-.7,.7]:box('Support',(x,.08,.25),(.07,.07,.5),6)
    elif name=='stone_lantern':
        box('Base',(0,0,.06),(.55,.55,.12),6,bevel=.025)
        tube('Pedestal',[(0,0,.12),(0,0,.20),(0,0,.75)],[.19,.12,.12],5,None,8)
        box('LampBase',(0,0,.79),(.45,.45,.09),5)
        box('LampGlow',(0,0,.98),(.24,.24,.29),4)
        for x in [-.19,.19]:
            for y in [-.19,.19]:box('LampPost',(x,y,.98),(.06,.06,.34),6)
        tube('Roof',[(0,0,1.16),(0,0,1.23),(0,0,1.38)],[.42,.37,.07],6,None,4)
        ell('Finial',(0,0,1.42),(.06,.06,.08),5,None,10,6)
    elif name=='red_shrine_gate':
        # Override brown swatch with red for this independent prop's atlas.
        tex=tex.copy();pix=array('f',[0.0])*len(tex.pixels);tex.pixels.foreach_get(pix);size=tex.size[0]
        for y in range(size//8):
            for x in range(size//8,2*size//8):
                i=(y*size+x)*4;pix[i:i+3]=array('f',[.72,.11,.12])
        tex.pixels.foreach_set(pix);tex.pack();node.image=tex
        for x in [-.85,.85]:
            tube('Pillar',[(x,0,0),(x,0,1.75)],[.09,.075],1,None,12)
            tube('Foot',[(x,0,0),(x,0,.15)],[.13,.13],6,None,12)
        box('Crossbar',(0,0,1.34),(2.15,.14,.13),1)
        tube('Crown',[(-1.25,0,1.83),(-.85,0,1.76),(0,0,1.74),(.85,0,1.76),(1.25,0,1.83)],[.10]*5,1,None,4)
        box('CenterTablet',(0,-.09,1.54),(.22,.05,.27),4,bevel=.015)
    elif name=='cherry_tree':
        tube('Trunk',[(0,0,0),(.04,0,.5),(-.06,.02,1.2),(.08,.01,1.8)],[.17,.15,.11,.06],1,None,9)
        for j in range(7):
            a=2*math.pi*j/7;x=math.cos(a);y=math.sin(a)
            tube('Branch',[(0,0,1.05+j*.08),(x*.42,y*.42,1.65),(x*.8,y*.8,2.0)],[.075,.05,.015],1,None,7)
            ell('Blossom_Cluster',(x*.69,y*.69,2.02+(j%2)*.18),(.58,.50,.40),0 if j%2 else 4,None,10,6)
        ell('Crown',(0,0,2.37),(.65,.6,.42),0,None,12,7)
        # Pink blossom palette specific to this prop.
        tex=tex.copy();pix=array('f',[0.0])*len(tex.pixels);tex.pixels.foreach_get(pix);size=tex.size[0]
        for idx,col in [(0,[.96,.57,.70]),(4,[1,.76,.82])]:
            for y in range(size//8):
                for x in range(idx*size//8,(idx+1)*size//8):
                    i=(y*size+x)*4;pix[i:i+3]=array('f',col)
        tex.pixels.foreach_set(pix);tex.pack();node.image=tex
    export_glb(folder/(name+'.glb'),objects)
    return sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects)

if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    kinds=args or ['kaito','shiori','ren','goro']
    for kind in kinds:
        if kind=='props':
            counts={n:prop(n) for n in ['water_tank','ac_unit','neon_sign_frame','stone_lantern','red_shrine_gate','cherry_tree']}
            (ROOT/'public/props/manifest.json').write_text(json.dumps(counts,indent=2))
        else:character(kind)
