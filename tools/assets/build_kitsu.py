"""Kitsu, Lyra's original spectral fox, using the v2 geometry, atlas and export pipeline."""
import sys,math,json,shutil
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import bpy
import numpy as np
from mathutils import Vector
from PIL import Image,ImageFilter
import build_assets_v2 as B
import v2_chars as C
import v2_face as F
from v2_geom import *

def make_rig():
    bones={
      'Hips':((0,.32,.43),(0,.13,.46),None),
      'Spine':((0,.13,.46),(0,-.12,.49),'Hips'),
      'Spine1':((0,-.12,.49),(0,-.27,.53),'Spine'),
      'Neck':((0,-.27,.53),(0,-.36,.63),'Spine1'),
      'Head':((0,-.36,.63),(0,-.51,.65),'Neck'),
      'Tail_01':((0,.35,.44),(0,.62,.49),'Hips'),
      'Tail_02':((0,.62,.49),(0,.85,.61),'Tail_01'),
      'Tail_03':((0,.85,.61),(.05,1.02,.82),'Tail_02')}
    for label,y in [('Front',-.22),('Hind',.28)]:
        for side,x in [('Left',.105),('Right',-.105)]:
            n=label+side
            bones[n+'UpLeg']=((x,y,.46),(x,y+(.055 if label=='Hind' else 0),.25),'Hips' if label=='Hind' else 'Spine1')
            bones[n+'Leg']=(bones[n+'UpLeg'][1],(x,y-.025,.065),n+'UpLeg')
            bones[n+'Foot']=(bones[n+'Leg'][1],(x,y-.12,.035),n+'Leg')
    arm=bpy.data.armatures.new('KitsuSkeleton');rig=bpy.data.objects.new('Armature',arm);bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT');eb={}
    for name,(h,t,parent)in bones.items():
        b=arm.edit_bones.new(name);b.head=h;b.tail=t
        if parent:b.parent=eb[parent]
        eb[name]=b
    bpy.ops.object.mode_set(mode='OBJECT');rig.select_set(False)
    return rig,{n:(np.asarray(h),np.asarray(t)) for n,(h,t,p)in bones.items()}

def pieces():
    P=[]
    P.append(loft('FoxBody',catmull([(0,.39,.43),(0,.20,.46),(0,-.06,.49),(0,-.26,.53)],32),
      C.prof_keys([(0,.07,.10,.09,2,0),(.3,.13,.16,.12,2,0),(.7,.12,.15,.12,2,0),(1,.08,.09,.08,2,0)]),
      sides=34,hint=(0,0,1),frames='hint',cap0=True,cap1=True,mat='fur',cands=['Hips','Spine','Spine1','Neck'],power=5))
    P.append(loft('FoxNeck',catmull([(0,-.18,.52),(0,-.29,.57),(0,-.38,.64)],18),
      lambda t:(.083,.09,.085,2,0),sides=22,hint=(0,0,1),frames='rmf',cap0=True,cap1=True,
      mat='cream',cands=['Spine1','Neck','Head'],power=5))
    head=C.blob('FoxHead',(0,-.38,.64),(.139,.143,.132),nu=48,nv=32,mat='fur',fixed='Head')
    head.normals=compute_normals(head.V,head.F)
    for front in [True,False]:
        faces=[f for f in head.F if bool(head.V[list(f),1].mean()<-.426)==front]
        used=sorted({i for f in faces for i in f});remap={v:i for i,v in enumerate(used)};V=head.V[used]
        uv=np.stack([(V[:,0]+.18)/.36*.25,.75+(V[:,2]-.46)/.36*.25],-1) if front else head.uv[used]
        P.append(Part('FoxFace' if front else 'FoxHead',V,[tuple(remap[i]for i in f)for f in faces],uv,
                      abs_uv=front,group='Face_Expressions' if front else 'Fighter',mat='face' if front else 'fur',fixed='Head',normals=head.normals[used]))
    P.append(loft('Muzzle',catmull([(0,-.47,.595),(0,-.53,.588),(0,-.60,.588)],18),
                  C.prof_keys([(0,.068,.043,.038,2,0),(.5,.044,.031,.026,2,0),(1,.018,.018,.014,2,0)]),
                  sides=20,hint=(0,0,1),frames='hint',cap0=True,cap1=True,mat='cream',fixed='Head'))
    P.append(C.blob('Nose',(0,-.614,.594),(.021,.012,.014),nu=12,nv=8,mat='dark',fixed='Head'))
    for sign in [-1,1]:
        # Thick, curved triangular ears with inset teal interiors.
        for inner in [False,True]:
            rows=[]
            for i,t in enumerate(np.linspace(0,1,13)):
                width=(.075 if not inner else .050)*(1-t)+.001
                row=[]
                for u in np.linspace(-1,1,9):
                    row.append((sign*(.093+.055*t)+u*width,-.35+.03*t-.017*(1-u*u)-(.014 if inner else 0),.72+.18*t))
                rows.append(row)
            P+=shell('EarInner' if inner else 'Ear',np.asarray(rows),.009 if not inner else .002,
                     outward=(0,0,.7),mat='teal' if inner else 'fur',inner_mat='dark' if inner else 'fur',fixed='Head')
        for j in range(4):
            c=np.array([sign*.11,-.30,.59-j*.021]);tip=c+np.array([sign*(.08-j*.009),.045,-.02-j*.012])
            P.append(loft('CheekTuft',catmull([c,c+(tip-c)*.5,tip],10),lambda t:(.028*(1-t)+.001,.022*(1-t)+.001,.02*(1-t)+.001,1.6,0),
                          sides=8,hint=(0,-1,0),frames='hint',cap0=True,cap1=True,mat='cream',fixed='Head'))
    for label,y in [('Front',-.22),('Hind',.28)]:
        for side,x in [('Left',.105),('Right',-.105)]:
            n=label+side
            pts=[(x*.75,y,.52),(x,y+(.055 if label=='Hind' else .0),.28),(x,y-.025,.065)]
            P.append(loft(n+'Leg',catmull(pts,26),C.prof_keys([(0,.055,.065,.060,2,0),(.4,.040,.043,.04,2,0),(.7,.026,.029,.026,2,0),(1,.022,.024,.023,2,0)]),
                          sides=18,hint=(0,-1,0),frames='hint',cap0=True,cap1=True,mat='fur',cands=[n+'UpLeg',n+'Leg',n+'Foot'],power=5))
            paw=C.blob(n+'Paw',(x,y-.045,.045),(.041,.073,.045),nu=20,nv=12,mat='cream',fixed=n+'Foot')
            P.append(paw)
    for idx in range(9):
        offset=0 if idx==0 else (idx-4.5)*.12
        pts=[(0,.35,.44),(offset*.4,.62,.49),(offset,.85,.61+abs(offset)*.12),(offset*1.2+.04,1.02,.82)]
        P.append(loft('Tail' if idx==0 else 'SpiritTail'+str(idx),catmull(pts,30 if idx==0 else 13),
             C.prof_keys([(0,.035,.04,.04,2,0),(.25,.09,.095,.09,2,0),(.6,.11,.115,.11,2,0),(.83,.065,.07,.07,2,0),(1,.002,.002,.002,2,0)]),
             sides=22 if idx==0 else 10,hint=(0,0,1),frames='rmf',cap0=True,cap1=True,mat='tail',
             group='Fighter' if idx==0 else 'AwakenedTails',cands=['Tail_01','Tail_02','Tail_03'],power=4))
    return P

def painter(p,pos,nor,uv,awake):
    n=len(pos);u,v=uv.T
    key=p.mat
    colors={'fur':('bacbd2','647d92'),'cream':('f0f4e8','a0bfc0'),'dark':('233c50','132536'),
            'face':('bacbd2','647d92'),'teal':('4daaad','26647b'),'tail':('78b8be','426c8e')}
    base=C.fill(n,hexc(colors[key][0]));shade=C.fill(n,hexc(colors[key][1]));glow=np.zeros(n)
    if key=='tail':
        m=v>.65;base[m]=hexc('e1fbeb');shade[m]=hexc('96cbd1')
        if awake:glow=smoothstep(.4,.95,v)
    if key=='fur':
        pale=(nor[:,2]<-.15);base[pale]=hexc('e1efe8');shade[pale]=hexc('91b5c3')
        marks=(np.abs(np.sin(v*20+u*8))<.13)&(v>.3)&(v<.8)
        base[marks]=hexc('51acaf');shade[marks]=hexc('337282')
        if awake:glow[marks]=.9
    if awake and key=='teal':base[:]=hexc('b2fff0');glow[:]=1
    return {'base':base,'shade':shade,'glow':glow}

def face(panel,expression,awake):
    fc=F.FaceCanvas(panel,(-.18,.18,.46,.82))
    st=dict(eye_w=.052,eye_h=.041,iris_top='1d7779',iris_bot='c7eb8f',iris_ring='18556a',iris_light='ffffff',
            tilt=.22,wing=.18,lash_w=.1,brow_w=.04,brow_t=.003,brow_c='46758a',mouth_w=.03,
            ink='1c354b',ink_soft='558795',iris_w=.30,iris_h=.98)
    mode={'neutral':'open','shout':'wide','pain':'squeeze','determined':'narrow'}[expression]
    if awake:st.update(iris_top='6fcfd2',iris_bot='e1fff0')
    for s in [-1,1]:F.draw_eye(fc,s*.071,.667,s,st,mode,glow=awake)
    return fc.result()

def main():
    B.reset();folder=B.OUT/'kitsu';folder.mkdir(parents=True,exist_ok=True)
    rig,segs=make_rig();P=pieces()
    for p in P:p.normals=p.normals if p.normals is not None else compute_normals(p.V,p.F);p.weights=compute_weights(p,segs)
    pack(P);blank=B.np_to_image('blank',np.zeros((32,32,3),np.float32));mat,node=B.make_material(blank)
    groups={}
    for p in P:groups.setdefault(p.group,[]).append(p)
    objs={g:B.build_mesh(g,ps,rig,mat)for g,ps in groups.items()}
    r=rasterize(P);pid,(pos,nor,uv)=dilate(r[2],[r[0],r[1],r[3]]);r=(pos,nor,pid,uv)
    ao=B.bake_ao([o for g,o in objs.items()if g!='AwakenedTails'],mat,size=1024,samples=24)
    ai=Image.fromarray(np.uint8(np.clip(ao,0,1)*255)).resize((ATLAS,ATLAS),Image.BICUBIC).filter(ImageFilter.GaussianBlur(2))
    mask=smoothstep(.62,.5,np.asarray(ai)/255)
    tex,g0=B.compose_atlas(P,r,mask,painter,False,face,'kitsu');awake,g1=B.compose_atlas(P,r,mask,painter,True,face,'kitsu')
    for name,a in [('tex',tex),('tex_awakened',awake)]:B.save_png(a,folder/(name+'.png'));B.save_png(a,folder/(name+'_1024.png'),1024)
    Image.fromarray(np.uint8(np.maximum(g0,g1)*255)).resize((512,512),Image.LANCZOS).save(folder/'tex_glow.png')
    for file,texture in [('model.glb','tex.png'),('model_1024.glb','tex_1024.png')]:
        node.image=bpy.data.images.load(str(folder/texture));B.export_glb(folder/file,[rig]+[o for g,o in objs.items()if g!='AwakenedTails'])
    node.image=bpy.data.images.load(str(folder/'tex_awakened.png'));B.export_glb(folder/'awakened_tails.glb',[rig,objs['AwakenedTails']])
    count=lambda ps:int(sum(len(f)-2 for p in ps for f in p.F))
    report={'version':2,'species':'spectral fox','triangles':count([p for p in P if p.group!='AwakenedTails']),
      'awakened_triangles':count(P),'bones':list(segs),'materials':1,'height_m':float(max(p.V[:,2].max()for p in P)),
      'expressions':{'mesh':'Face_Expressions','panels':EXPRESSIONS,'uv_offset_gltf':{e:[i*.25,0]for i,e in enumerate(EXPRESSIONS)}},
      'notes':'One base tail and eight optional spirit tails. Three shared tail bones. +Z forward, Y up, metre scale; all four paws touch the ground.'}
    (folder/'manifest.json').write_text(json.dumps(report,indent=2))
    shutil.copy2(folder/'model.glb',B.OUT/'lyra/kitsu.glb')
    print(json.dumps(report),flush=True)

if __name__=='__main__':main()
