"""Original Chapter 2 designs built from the existing v2 loft/SDF/atlas pipeline."""
import math
import copy
import numpy as np
from v2_geom import *
import v2_chars as C
import v2_face as F

SPECS = {}
for name in ['mika', 'lyra']:
    spec = copy.deepcopy(C.SHIORI)
    spec['head'].update(jaw_w=.076 if name == 'mika' else .079,
                        chin_z=1.566 if name == 'mika' else 1.559, nu=44, nv=34)
    spec['hand'] = {'curl': .17, 'k': 1.02}
    spec['ao_samples'] = 24
    spec['extra_bones'] = {}
    SPECS[name] = spec
SPECS['mika']['notes'] = 'Mika Volt Raiden: cobalt cropped track jacket with asymmetric yellow circuit panels, neck headphones, short swept electric-blue twin tails, tapered joggers and running shoes. Storm Heart atlas adds cyan lightning seams.'
SPECS['lyra']['notes'] = 'Lyra Ashveil: ash-grey layered shrine-inspired wrap jacket, teal split ceremonial panels, bell cords, folded paper hair charms and ashen side-swept hair. Nine-Tail Bond atlas lights the teal spirit seals.'
for s, side in [(1,'Left'),(-1,'Right')]:
    SPECS['mika']['extra_bones'][side+'Tail_01'] = ((s*.095,.035,1.75),(s*.19,.075,1.60),'Head')
    SPECS['mika']['extra_bones'][side+'Tail_02'] = ((s*.19,.075,1.60),(s*.24,.095,1.42),side+'Tail_01')
SPECS['lyra']['extra_bones'].update({
    'Charm_01': ((.10,.015,1.73),(.14,.03,1.57),'Head'),
    'SkirtFront_01': ((0,-.11,1.02),(0,-.14,.65),'Hips'),
    'SkirtBack_01': ((0,.11,1.02),(0,.16,.65),'Hips'),
})

PALETTES={
 'mika':{'skin':('f1bd99','c88572'),'cloth':('235eac','183567'),'accent':('ffd55b','c49334'),
         'dark':('172c46','111b30'),'light':('e8f4ee','a4bfcb'),'metal':('98b5cb','526c86'),
         'hair':('1389d3','154c89'),'hair_hi':('72dbef','72dbef'),'hair_tip':('69d7f0','287ab4'),
         'ink':('17243a','17243a')},
 'lyra':{'skin':('e9c9b6','bc9194'),'cloth':('bbc2c6','737d8e'),'accent':('298e90','21585e'),
         'dark':('2c394b','1b2435'),'light':('f3e8cf','b2b1ac'),'metal':('d7bc78','877545'),
         'hair':('7d889a','485366'),'hair_hi':('c2c7cb','c2c7cb'),'hair_tip':('61b0ae','3c747d'),
         'ink':('28303e','28303e')},
}

def sphere(name, loc, radii, mat, bone='Spine2', S=1, nu=16, nv=10):
    return C.blob(name,np.array(loc)*S,np.array(radii)*S,nu=nu,nv=nv,mat=mat,fixed=bone)

def cord(name, pts, radius, mat, bone, S=1, sides=8, n=14):
    return loft(name,catmull(np.asarray(pts)*S,n),lambda t:(radius*S, radius*S,radius*S,2,0),
                sides=sides, hint=(0,-1,0),frames='rmf',cap0=True,cap1=True,mat=mat,fixed=bone)

def panel(name, points, widths, mat, bone, S=1, rows=14, cols=7, thickness=.003):
    cent=catmull(np.asarray(points)*S,rows)
    grid=[]
    for i,p in enumerate(cent):
        t=i/(rows-1);w=np.interp(t,np.linspace(0,1,len(widths)),widths)*S
        grid.append([p+np.array([(j/(cols-1)-.5)*w,.006*S*math.sin(t*8+j),0]) for j in range(cols)])
    return shell(name,np.array(grid),thickness*S,outward=np.array([0,0,.9])*S,
                 mat=mat,inner_mat='dark',fixed=bone)

def jacket(S, female, mat='cloth', bottom=1.02):
    keys=C.TORSO_F if female else C.TORSO_M
    keys=[(z,r+.014,f+.014,b+.014,e,o) for z,r,f,b,e,o in keys if bottom<=z<=1.475]
    return C.torso_part(S,keys,mat=mat,name='TailoredJacket',n=24,sides=28)

def basic_body(kind,S,hands):
    spec=SPECS[kind];P,sdf=C.build_head(S,spec['head'],spec['face_box'])
    P.append(C.torso_part(S,C.TORSO_F,mat='body',n=26))
    lk=[(0,.087,.086,.094,2,0),(.12,.090,.088,.098,2,0),(.30,.075,.073,.080,2,0),
        (.50,.055,.055,.057,2,0),(.65,.057,.059,.060,2,0),(.85,.043,.044,.045,2,0),(1,.039,.041,.041,2,0)]
    for side,s in [('Left',1),('Right',-1)]:
        P.append(C.limb_part(side+'Sleeve',S,C.arm_pts(s),[(t,r+.008,f+.008,b+.008,e,o) for t,r,f,b,e,o in C.ARM_F],
                   cands=C.arm_cands(side),mat='sleeve',n=28,sides=20,meta={'side':side}))
        P+=C.hand_parts(side,hands[side],S,mat='skin',finger_r=.008)
        P.append(C.limb_part(side+'Leg',S,C.leg_pts(s),lk,sides=18,mat='trousers',cands=C.leg_cands(side),n=30,power=6))
        P+=C.shoe_parts(s,S,top='shoe',sole='light',wide=.92)
    return P,sdf

def haircut(kind,sdf,S):
    hk=C.HairKit(sdf,S);P=[]
    low=lambda az: 35-55*min(abs(az)/105,1)
    P.append(hk.cap('HairCap',low,off=.013,nu=36,nv=11))
    # Offset layered fringe and temple locks, not a symmetric helmet.
    for j,(az,tipaz,el) in enumerate([(-60,-76,-9),(-35,-48,4),(-12,-25,12),(10,0,23),(32,20,30),(52,49,12),(74,84,-18)]):
        P.append(hk.clump('SweptFringe', [hk.surf(az*.7,60,-.005),hk.surf(az,35,.022),hk.surf(tipaz,el,.013)],
                          .038,.014,sides=8,n=11,flat=.60,bulge=.15))
    if kind=='mika':
        for s,side in [(1,'Left'),(-1,'Right')]:
            for j in range(3):
                pts=np.array([(s*.09,.035,1.75),(s*(.16+j*.014),.06,1.69),
                              (s*(.205+j*.015),.08,1.54),(s*(.23+j*.020),.07,1.43+j*.035)])*S
                P.append(hk.clump(side+'TwinTail',pts,.038,.023,n=18,sides=10,
                                  cands=[side+'Tail_01',side+'Tail_02'],taper=.6))
            P.append(sphere('TailClasp',(s*.105,.025,1.736),(.023,.025,.016),'accent','Head',S,12,6))
    else:
        for j,az in enumerate([110,140,170,-160,-130,-105]):
            P.append(hk.clump('AshNape',[hk.surf(az,45,0),hk.surf(az,-5,.019),hk.surf(az,-50,.018)],
                              .041,.018,n=13,sides=8,bone='Ponytail_01' if abs(az)>130 else 'Head'))
    return P

def build_mika(S,segs,hands):
    P,sdf=basic_body('mika',S,hands);P.append(jacket(S,True,bottom=1.03))
    # Rounded neck headphones; headphones rest against the clavicle, not on the ears.
    arc=[(.09*math.cos(a),.07*math.sin(a),1.465-.03*max(0,-math.sin(a))) for a in np.linspace(0,math.pi,20)]
    P.append(cord('HeadphoneBand',arc,.012,'dark','Neck',S))
    for s in [-1,1]:
        P.append(sphere('HeadphoneCup',(s*.089,-.067,1.441),(.032,.022,.044),'dark','Spine2',S))
        P.append(sphere('HeadphoneAccent',(s*.089,-.088,1.441),(.023,.004,.032),'accent','Spine2',S))
    P.append(cord('Zip',[(0,-.113,1.09),(0,-.13,1.32),(0,-.094,1.45)],.0035,'light','Spine2',S,sides=6,n=16))
    P.append(sphere('ZipPull',(0,-.103,1.436),(.009,.004,.016),'metal','Spine2',S,10,6))
    for s in [-1,1]:
        P.append(sphere('ShoeHeel',(s*.145,.06,.072),(.047,.025,.046),'accent',('Left' if s==1 else 'Right')+'Foot',S,12,8))
    P+=haircut('mika',sdf,S)
    return P

def build_lyra(S,segs,hands):
    P,sdf=basic_body('lyra',S,hands)
    P.append(jacket(S,True,bottom=1.03))
    # Overlapping, thickened lapels and split skirt preserve space for kicks.
    for s,side in [(1,'Left'),(-1,'Right')]:
        P+=panel('CrossedLapel',[(s*.09,-.089,1.46),(s*.06,-.131,1.30),(-s*.06,-.106,1.09)],
                 [.043,.045,.036],'light','Spine2',S,rows=11,cols=4)
        for y,nm,bn in [(-.13,'Front','SkirtFront_01'),(.14,'Back','SkirtBack_01')]:
            panels=panel(nm+'Skirt',[(s*.08,y,1.04),(s*.13,y*1.2,.83),(s*.17,y*1.4,.57)],
                         [.16,.20,.21],'accent',bn,S,rows=13,cols=6)
            def skirt_weights(V,side=side,bn=bn):
                w=np.clip((1.04-V[:,2]/S)/.16,0,1)*.95
                return [{'Hips':float(1-a),side+'UpLeg':float(a)} for a in w]
            for p in panels:p.fixed=skirt_weights
            P+=panels
        # Bell sleeves, curved in depth, with open cuffs and lining.
        sleeve=C.limb_part(side+'BellSleeve',S,[(s*.28,0,1.37),(s*.38,0,1.30),(s*.48,0,1.22)],
             [(0,.060,.063,.060,2,0),(.5,.070,.085,.075,2,0),(1,.080,.11,.10,2,0)],
             sides=16,n=10,mat='cloth',cands=C.arm_cands(side))
        G=sleeve.V.reshape(10,17,3)
        P+=shell(side+'CeremonialSleeve',G,.004*S,outward=G.mean(1),mat='cloth',inner_mat='dark',
                 cands=C.arm_cands(side),power=6)
    ring=C.ring_path(1.065,.135,.108,30,S=S)
    P.append(C.closed_loft('TealObi',ring,lambda t:(.03*S,.012*S,.01*S,2,0),sides=10,mat='accent',fixed='Hips'))
    P+=haircut('lyra',sdf,S)
    for s in [-1,1]:
        P+=panel('FoldedPaperCharm',[(s*.10,-.012,1.75),(s*.13,-.016,1.69),(s*.137,-.010,1.59)],
                 [.036,.039,.031],'paper','Charm_01' if s==1 else 'Head',S,rows=8,cols=4)
    for s in [-1,1]:
        P.append(cord('BellCord',[(s*.07,-.123,1.07),(s*.09,-.15,.95),(s*.075,-.15,.88)],.003,'light','Hips',S,n=14))
        P.append(sphere('SpiritBell',(s*.075,-.15,.875),(.014,.014,.021),'metal','Hips',S,12,8))
    return P

def painter(kind):
    S=SPECS[kind]['S']
    def paint(p,pos,nor,uv,awake):
        tab=dict(PALETTES[kind]);n=len(pos);x,y,z=(pos/S).T;u,v=uv.T
        if awake:
            if kind=='mika':tab.update(hair=('9be9ff','3c93cd'),hair_hi=('ffffff','ffffff'),hair_tip=('e4ffff','75c6ef'))
            else:tab.update(accent=('75e6d8','368e9b'),hair_tip=('c7fff1','54b4bd'))
        if p.mat in ['face','headback','ear','skin']:
            return C.skin_head_paint(p,pos/S,nor,uv,tab)
        if p.meta.get('hair'):
            out=C.hair_paint(n,uv,pos,tab,awake)
            if awake:out['glow']=smoothstep(.65,.93,v)*.7
            return out
        key={'body':'dark','sleeve':'cloth','trousers':'dark','shoe':'cloth','paper':'light'}.get(p.mat,p.mat)
        base=C.fill(n,C.C(tab,key));shade=C.fill(n,C.C(tab,key,1));ink=np.zeros(n);glow=np.zeros(n)
        if p.mat=='body':
            skin=z>1.478;base[skin]=C.C(tab,'skin');shade[skin]=C.C(tab,'skin',1)
        if p.mat in ['cloth','sleeve','trousers']:
            ink=C.cloth_folds(pos,[(1.10,.07,60),(1.24,.045,68),(.54,.08,53),(.17,.045,70)],S)*.23
            if kind=='mika':
                strip=((np.abs(x+.10+(z-1.25)*.65)<.023)&(y<-.045)&(z>1.10)&(z<1.43))
                strip|=(p.mat=='sleeve')&(v>.18)&(v<.26)
                if p.mat=='trousers':strip=(np.abs(nor[:,0])>.8)&(z>.25)
                base[strip]=C.C(tab,'accent');shade[strip]=C.C(tab,'accent',1)
            else:
                hem=(v<.07)|(v>.94);base[hem]=C.C(tab,'accent');shade[hem]=C.C(tab,'accent',1)
        if p.mat=='paper':
            # Abstract original seal strokes, deliberately not copied calligraphy.
            mark=(np.abs(u-.5)<.055)&(v>.22)&(v<.80)
            mark|=(np.abs(v-.34)<.025)&(u>.22)&(u<.78)
            mark|=(np.abs(v-.63+.16*(u-.5))<.025)&(u>.25)&(u<.72)
            base[mark]=C.C(tab,'accent');shade[mark]=C.C(tab,'accent',1);glow[mark]=.9 if awake else 0
        if p.mat=='accent' and kind=='lyra':
            edge=(u<.07)|(u>.93)|(v<.06);base[edge]=C.C(tab,'light');shade[edge]=C.C(tab,'metal',1)
        if p.mat=='shoe':
            lace=(nor[:,2]>.4)&(y<-.03)&(y>-.16);base[lace]=C.C(tab,'light');ink+=lace*C.stripe(y,85,.20)*.4
        if awake and kind=='mika' and p.mat in ['cloth','sleeve','trousers']:
            bolt=(np.abs(u-(.35+.08*np.sin(v*26)+.025*np.sign(np.sin(v*45))))<.012)&(v>.12)&(v<.94)
            base[bolt]=hexc('cbffff');shade[bolt]=hexc('80dbff');glow[bolt]=1
        return {'base':base,'shade':shade,'ink':np.clip(ink,0,1),'ink_color':C.C(tab,'ink'),'glow':glow}
    return paint

def face(kind,S):
    tab=PALETTES[kind];box=tuple(v*S for v in SPECS[kind]['face_box'])
    st=dict(eye_w=.045,eye_h=.038 if kind=='mika' else .035,iris_top='246369' if kind=='mika' else '304b77',
            iris_bot='d3e874' if kind=='mika' else '79c4ce',iris_ring='1b354b',iris_light='e3fff6',
            tilt=.10 if kind=='mika' else .02,wing=.16,lash_w=.13,brow_w=.037,brow_t=.0045,
            brow_c=tab['hair'][1],mouth_w=.023,ink='202338',ink_soft='8e625c',iris_w=.52,iris_h=.92)
    def draw(panel,expression,awake):
        fc=F.FaceCanvas(panel,box);s=dict(st)
        if awake:s.update(iris_top='4b9bba',iris_bot='e3fff7',iris_light='ffffff')
        mode,brow,mouth={'neutral':('open',.13,'smile' if kind=='mika' else 'small'),
                         'shout':('wide',.65,'shout'),'pain':('squeeze',-.40,'grit'),
                         'determined':('narrow',.50,'grin' if kind=='mika' else 'small')}[expression]
        for sign in [-1,1]:
            F.draw_eye(fc,sign*.044*S,1.665*S,sign,s,mode,glow=awake)
            F.draw_brow(fc,sign*.046*S,1.708*S,sign,s,angle=brow)
        F.draw_nose(fc,.003*S,1.632*S,s);F.draw_mouth(fc,0,1.596*S,s,mouth)
        if kind=='mika':F.marks(fc,[[(-.072*S,1.635*S),(-.065*S,1.626*S),(-.073*S,1.617*S)]],'8cbfd4' if not awake else 'dcffff',.002*S,glow=awake)
        return fc.result()
    return draw

def register(registry):
    registry.SPECS.update(SPECS)
    registry.BUILDERS.update(mika=build_mika,lyra=build_lyra)
    for name in SPECS:
        registry.PAINTERS[name]=lambda k=name:painter(k)
        registry.FACES[name]=lambda S,k=name:face(k,S)
