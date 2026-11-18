"""Character construction + painting for KAKUSEI ARENA v2 (original designs)."""
import math
import numpy as np
from v2_geom import *     # noqa
import v2_face as FA

HEAD_C = np.array([0, 0.0, 1.665])


# ===================================================================== generic body builders
def head_sdf(hp, S):
    cr_c = np.array([0, hp.get('cr_y', 0.012), hp.get('cr_z', 1.688)])
    cr_r = np.array(hp.get('cr_r', (0.097, 0.110, 0.104)))
    jaw_w = hp.get('jaw_w', 0.080)
    chin = np.array([0, hp.get('chin_y', -0.064), hp.get('chin_z', 1.553)])
    chin_w = hp.get('chin_w', 0.012)
    face_y = hp.get('face_y', -0.104)
    jaw_ang = hp.get('jaw_ang', 0.86)

    k = hp.get('scale', 1.0)
    piv = np.array([0, 0, 1.60])

    def f(p):
        p = (p / S - piv) / k + piv
        cr = sd_ellipsoid(p, cr_c, cr_r)
        jaw = sd_ellipsoid(p, (0, -0.020, hp.get('jaw_z', 1.636)), (jaw_w, 0.084, hp.get('jaw_h', 0.078)))
        for s in (-1, 1):
            jaw = smax(jaw, sd_plane(p, chin + np.array([s * chin_w, 0, 0]), (s * jaw_ang, 0.12, -0.50)), 0.014)
        jaw = smax(jaw, sd_plane(p, chin, (0, 0.40, -1.0)), 0.012)
        d = smin(cr, jaw, 0.030)
        d = smax(d, sd_plane(p, (0, face_y, 0), (0, -1, 0)), 0.022)
        # cheekbone softness: slight side flatten
        for s in (-1, 1):
            d = smax(d, sd_plane(p, (s * hp.get('side_x', 0.094), 0, 0), (s, 0, 0)), 0.03)
        nose = sd_capsule(p, (0, face_y + 0.004, 1.668), (0, face_y - hp.get('nose_len', 0.011), 1.632), (0.003, 0.0042))
        d = smin(d, nose, 0.008)
        if hp.get('brow_ridge'):
            d = smin(d, sd_capsule(p, (-0.05, face_y + .006, 1.702), (0.05, face_y + .006, 1.702), 0.010), 0.02)
        return d * S * k
    return f


def build_head(S, hp, face_box, bone='Head'):
    """Returns parts [Face(Face_Expressions, abs uv), HeadBack, Ear L/R], sdf."""
    sdf = head_sdf(hp, S)
    face_box = tuple(v * S for v in face_box)
    c = HEAD_C * S
    nu, nv = hp.get('nu', 44), hp.get('nv', 34)
    dirs = sphere_grid(nu, nv, z_bias=lambda a: a)
    P = radial_surface(sdf, c, dirs.reshape(-1, 3), rmax=0.3 * S).reshape(nv + 1, nu + 1, 3)
    V = P.reshape(-1, 3)
    Fq = []
    for i in range(nv):
        for j in range(nu):
            a = i * (nu + 1) + j
            Fq.append((a, a + 1, a + 1 + (nu + 1), a + (nu + 1)))
    N = compute_normals(V, Fq)
    xmin, xmax, zmin, zmax = face_box
    dvec = dirs.reshape(-1, 3)
    front_ok = (-dvec[:, 1] > hp.get('face_front', 0.42)) & (V[:, 2] < hp.get('face_top', 1.765) * S) & (V[:, 2] > zmin + 0.004 * S)
    faceF, backF = [], []
    for f in Fq:
        (faceF if all(front_ok[i] for i in f) else backF).append(f)

    def sub(Fs, name, uvfn, **kw):
        used = sorted({i for f in Fs for i in f})
        remap = {o: n for n, o in enumerate(used)}
        Vs = V[used]
        Ns = N[used]
        F2 = [tuple(remap[i] for i in f) for f in Fs]
        return Part(name, Vs, F2, uvfn(np.array(used), Vs), normals=Ns, fixed=bone, **kw)

    def face_uv(idx, Vs):
        u = (Vs[:, 0] - xmin) / (xmax - xmin)
        v = (Vs[:, 2] - zmin) / (zmax - zmin)
        return np.stack([u * 0.25, 0.75 + v * 0.25], -1)
    face = sub(faceF, 'Face', face_uv, abs_uv=True, group='Face_Expressions', mat='face')

    def back_uv(idx, Vs):
        i = idx // (nu + 1)
        j = idx % (nu + 1)
        return np.stack([j / nu, i / nv], -1)
    back = sub(backF, 'HeadBack', back_uv, mat='headback', size=(0.62 * S, 0.30 * S))
    parts = [face, back]
    build_head.last = dict(P=P, N=N.reshape(P.shape), dirs=dirs, nu=nu, nv=nv)
    # ears
    for s in (-1, 1):
        ec = np.array([s * hp.get('ear_x', 0.100), hp.get('ear_y', 0.008), hp.get('ear_z', 1.652)]) * S
        ed = sphere_grid(10, 8)
        er = np.array([0.012, 0.022, 0.032]) * S * hp.get('ear_k', 1.0)
        EP = ec + ed.reshape(-1, 3) * er
        # tilt back & flatten against head
        EP = EP.reshape(9, 11, 3)
        g = grid_part('Ear', EP, mat='ear', fixed=bone, size=(0.08 * S, 0.06 * S))
        parts.append(g)
    return parts, sdf


def prof_keys(keys):
    """keys: list of (t, rs, rf, rb, ex, off) -> prof(t)."""
    def f(t):
        return tuple(interp_keys([(k[0], k[1:]) for k in keys], t))
    return f


def torso_part(S, keys, mat='torso', sides=28, cands=None, name='Torso', **kw):
    """keys: (z, rs, rf, rb, ex, yoff). Lofted along Z from bottom to top (neck)."""
    zs = [k[0] for k in keys]
    z0, z1 = zs[0], zs[-1]
    nring = kw.pop('n', 30)
    C = np.array([[0, 0, z] for z in np.linspace(z0, z1, nring)]) * S
    tk = [((k[0] - z0) / (z1 - z0), k[1] * S, k[2] * S, k[3] * S, k[4], k[5] * S) for k in keys]
    p = loft(name, C, prof_keys(tk), sides=sides, hint=(0, -1, 0), frames='hint', cap0=True, mat=mat,
             cands=cands or ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'RightShoulder',
                             'LeftUpLeg', 'RightUpLeg'], power=5, **kw)
    return p


def limb_part(name, S, pts, keys, sides=20, mat='skin', cands=None, n=26, power=7, hint=(0, -1, 0), **kw):
    C = catmull(np.array(pts) * S, n)
    tk = [(k[0],) + tuple(x * S if i < 3 else x for i, x in enumerate(k[1:])) for k in keys]
    return loft(name, C, prof_keys(tk), sides=sides, hint=hint, frames='hint', mat=mat, cands=cands, power=power, **kw)


def hand_parts(side, hl, S, mat='skin', palm_mat=None, k=1.0, finger_r=0.0088):
    sign = 1 if side == 'Left' else -1
    w, d, f, n = hl['wrist'], hl['d'], hl['f'], hl['n']
    parts = []
    s = S * hl.get('k', k)
    C = [w - d * 0.012 * s, w + d * 0.02 * s, w + d * 0.055 * s, w + d * 0.088 * s, w + d * 0.097 * s]
    keys = [(0, .024 * s, .015 * s, .013 * s, 2.6, 0), (.25, .030 * s, .016 * s, .012 * s, 3.0, 0),
            (.6, .038 * s, .015 * s, .011 * s, 3.2, 0), (.88, .041 * s, .012 * s, .010 * s, 3.0, 0), (1, .036 * s, .008 * s, .007 * s, 2.5, 0)]
    pc = [side + 'ForeArm', (side + 'Hand', w, w + d * 0.085 * s)] + [side + 'Hand' + fn + '1' for fn in ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']]
    palm = loft(side + 'Palm', catmull(C, 10), prof_keys(keys), sides=14, hint=n, frames='hint', cap1=0.004 * s,
                mat=palm_mat or mat, cands=pc, power=8, meta={'side': side, 'hand': True})
    parts.append(palm)
    for fn in ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']:
        pts = hl['chains'][fn]
        dir0 = nrm(pts[1] - pts[0])
        chain = [pts[0] - dir0 * (0.012 if fn != 'Thumb' else 0.02) * s] + list(pts)
        r0 = finger_r * s * (1.35 if fn == 'Thumb' else (0.88 if fn == 'Pinky' else 1.0))
        keys = [(0, r0 * 1.05, r0, r0, 2, 0), (0.3, r0, r0 * .92, r0 * .95, 2, 0), (0.8, r0 * .86, r0 * .8, r0 * .82, 2, 0),
                (0.93, r0 * .74, r0 * .7, r0 * .7, 2, 0), (1.0, r0 * .25, r0 * .25, r0 * .25, 2, 0)]
        cands = [(side + 'Hand', w, pts[0])] + [side + 'Hand' + fn + str(j) for j in (1, 2, 3)]
        fp = loft(side + fn, catmull(chain, 13), prof_keys(keys), sides=8, hint=n, frames='hint', cap1=0.0015 * s,
                  mat=mat, cands=cands, power=9, meta={'side': side, 'finger': fn, 'hand': True})
        parts.append(fp)
    return parts


def ring_path(cz, a, b, n, front_drop=0.0, S=1.0, yoff=0.0):
    pts = []
    for i in range(n + 1):
        th = 2 * math.pi * i / n + math.pi / 2   # start at back (+Y)
        x, y = a * math.cos(th), b * math.sin(th) + yoff
        z = cz - front_drop * max(0, -math.sin(th)) ** 2
        pts.append((x * S, y * S, z * S))
    return np.array(pts)


def closed_loft(name, C, prof, sides=10, center=None, **kw):
    """Loft along a closed path C (first==last) with F = outward from center."""
    cen = np.asarray(center if center is not None else C[:-1].mean(0))
    H = C - cen
    H[:, 2] = 0
    return loft(name, C, prof, sides=sides, hint=nrm(H), frames='hint', **kw)


def blob(name, c, r, nu=12, nv=8, **kw):
    d = sphere_grid(nu, nv)
    P = np.asarray(c) + d.reshape(-1, 3) * np.asarray(r)
    return grid_part(name, P.reshape(nv + 1, nu + 1, 3), **kw)


# ------------------------------------------------------------------ hair
class HairKit:
    def __init__(self, sdf, S, center=None):
        self.sdf = sdf
        self.S = S
        self.c = (HEAD_C if center is None else np.asarray(center)) * S

    def dir(self, az, el):
        az, el = math.radians(az), math.radians(el)
        return np.array([math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)])

    def surf(self, az, el, off=0.0):
        d = self.dir(az, el)
        p = radial_surface(self.sdf, self.c, d[None], rmax=0.3 * self.S)[0]
        return p + d * off * self.S

    def clump(self, name, pts, width, thick, sides=8, n=12, bone='Head', mat='hair', taper=0.85,
              ex=1.5, flat=0.55, bulge=0.25, tipw=0.0006, cands=None, **kw):
        C = catmull(pts, n)
        H = nrm(C - self.c)
        S = self.S

        def prof(t):
            env = (1 - t) ** taper * (1 + bulge * math.sin(math.pi * min(1.0, t * 1.4)))
            w = max(width * S * env, tipw * S)
            th = max(thick * S * env, tipw * S * .7)
            return (w, th, th * flat, ex, 0)
        kw2 = dict(mat=mat, meta={'hair': True}, **kw)
        if cands:
            kw2['cands'] = cands
            kw2['power'] = kw.get('power', 4)
        else:
            kw2['fixed'] = bone
        return loft(name, C, prof, sides=sides, hint=H, frames='hint', cap0=True, **kw2)

    def cap(self, name, el_min, off=0.010, nu=36, nv=10, bone='Head', mat='hair'):
        """Hair volume shell over the scalp above el_min(az) (degrees)."""
        rows = []
        for i in range(nv + 1):
            row = []
            for j in range(nu + 1):
                az = 360.0 * j / nu - 180  # start at back
                e0 = el_min(az)
                t = i / nv
                el = e0 + (89.0 - e0) * (1 - (1 - t) ** 1.6)
                row.append(self.dir(az, el))
            rows.append(row)
        D = np.array(rows).reshape(-1, 3)
        sdf2 = lambda p: self.sdf(p) - off * self.S
        P = radial_surface(sdf2, self.c, D, rmax=0.3 * self.S).reshape(nv + 1, nu + 1, 3)
        return grid_part(name, P, mat=mat, fixed=bone, meta={'hair': True, 'cap': True})


# ===================================================================== KAITO
KAITO = dict(
    S=1.0, body_h=1.80,
    hand={'curl': 0.20, 'k': 1.08},
    head={'scale': 1.07, 'jaw_w': 0.082, 'chin_y': -0.060, 'chin_z': 1.562, 'face_y': -0.100, 'cr_r': (0.100, 0.110, 0.104), 'nose_len': 0.003, 'jaw_ang': 0.80, 'jaw_z': 1.638, 'jaw_h': 0.074},
    face_box=(-0.12, 0.12, 1.53, 1.77),
    ao_cut=(0.50, 0.62),
    notes='Kaito Homura: spiky red/orange hair, tank top, gakuran tied at waist with crimson lining, bandaged hands, red sneakers.',
)

TORSO_M = [  # z, rs, rf, rb, ex, yoff   (male athletic)
    (0.850, 0.118, 0.080, 0.088, 2.3, 0.000),
    (0.900, 0.146, 0.090, 0.104, 2.4, 0.000),
    (0.960, 0.150, 0.092, 0.104, 2.4, -0.002),
    (1.030, 0.134, 0.086, 0.090, 2.4, 0.000),
    (1.100, 0.125, 0.086, 0.082, 2.4, 0.004),
    (1.180, 0.133, 0.096, 0.084, 2.5, 0.008),
    (1.260, 0.150, 0.108, 0.088, 2.6, 0.010),
    (1.330, 0.163, 0.112, 0.092, 2.7, 0.008),
    (1.395, 0.178, 0.100, 0.094, 2.7, 0.002),
    (1.440, 0.172, 0.080, 0.086, 2.6, -0.004),
    (1.475, 0.125, 0.062, 0.070, 2.4, -0.006),
    (1.500, 0.076, 0.058, 0.060, 2.1, -0.004),
    (1.525, 0.058, 0.054, 0.053, 2.0, -0.001),
    (1.570, 0.054, 0.051, 0.049, 2.0, 0.004),
    (1.625, 0.050, 0.045, 0.045, 2.0, 0.010),
]


def arm_pts(sign):
    return [(sign * .125, 0, 1.455), (sign * .180, 0, 1.462), (sign * .228, 0, 1.438), (sign * .30, 0, 1.370),
            (sign * .38, 0, 1.303), (sign * .46, 0, 1.240), (sign * .54, 0, 1.155), (sign * .60, 0, 1.090), (sign * .652, 0, 1.037)]


ARM_M = [  # t, rs, rf, rb, ex, off
    (0.00, .052, .052, .052, 2, 0), (0.08, .064, .064, .062, 2, 0), (0.16, .068, .066, .064, 2, 0),
    (0.27, .057, .056, .053, 2, 0), (0.40, .051, .056, .049, 2, 0.003), (0.52, .043, .043, .042, 2, 0),
    (0.60, .045, .047, .044, 2, 0), (0.72, .040, .041, .038, 2, 0), (0.88, .029, .033, .030, 2, 0), (1.0, .024, .031, .028, 2, 0)]


def arm_cands(side):
    return ['Spine2', side + 'Shoulder', side + 'Arm', side + 'ForeArm', side + 'Hand']


def leg_pts(sign, z0=1.0):
    return [(sign * .080, 0, z0), (sign * .100, 0, .92), (sign * .115, 0, .75), (sign * .130, 0, .53),
            (sign * .138, 0, .33), (sign * .145, 0, .12), (sign * .146, 0, .07)]


def leg_cands(side):
    return ['Hips', side + 'UpLeg', side + 'Leg', side + 'Foot']


def shoe_parts(sign, S, top='shoe', sole='sole', h=1.0, wide=1.0, name='Shoe'):
    side = 'Left' if sign == 1 else 'Right'
    x = sign * .145
    C = [(x, .060, .062), (x, .030, .068), (x, -.040, .062), (x, -.120, .050), (x, -.195, .040), (x, -.232, .033)]
    keys = [(0, .043 * wide, .055 * h, .060, 2.2, 0), (.15, .046 * wide, .070 * h, .062, 2.4, 0), (.45, .048 * wide, .055 * h, .060, 2.6, 0),
            (.72, .050 * wide, .036 * h, .048, 2.6, 0), (.92, .042 * wide, .026 * h, .036, 2.4, 0), (1, .030 * wide, .018 * h, .028, 2.2, 0)]
    cands = [side + 'Leg', side + 'Foot', side + 'ToeBase']
    up = loft(side + name, catmull(np.array(C) * S, 16), prof_keys([(k[0],) + tuple(v * S if i < 3 else v for i, v in enumerate(k[1:])) for k in keys]),
              sides=16, hint=(0, 0, 1), frames='hint', cap0=0.01 * S, cap1=0.006 * S, mat=top, cands=cands, power=6, meta={'side': side, 'shoe': True})
    # sole: flat slab following outline
    Cs = [(x, .072, .014), (x, .0, .014), (x, -.12, .014), (x, -.205, .016), (x, -.242, .02)]
    ks = [(0, .046 * wide, .016, .014, 3.5, 0), (.4, .050 * wide, .016, .014, 3.5, 0), (.75, .054 * wide, .016, .014, 3.2, 0),
          (.95, .040 * wide, .016, .012, 3.0, 0), (1, .02 * wide, .012, .010, 2.4, 0)]
    so = loft(side + 'Sole', catmull(np.array(Cs) * S, 14), prof_keys([(k[0],) + tuple(v * S if i < 3 else v for i, v in enumerate(k[1:])) for k in ks]),
              sides=14, hint=(0, 0, 1), frames='hint', cap0=0.008 * S, cap1=0.004 * S, mat=sole, cands=cands, power=6, meta={'side': side})
    # make sole bottom exactly z=0
    so.V[:, 2] -= so.V[:, 2].min()
    return [up, so]


def build_kaito(S, segs, hands):
    P = []
    hp = KAITO['head']
    head, sdf = build_head(S, hp, KAITO['face_box'])
    P += head
    P.append(torso_part(S, TORSO_M, mat='torso'))
    for side, sign in [('Left', 1), ('Right', -1)]:
        P.append(limb_part(side + 'Arm', S, arm_pts(sign), ARM_M, cands=arm_cands(side), mat='arm', meta={'side': side}))
        P += hand_parts(side, hands[side], S, mat='hand')
        # bandage wraps (shell over forearm/wrist)
        bk = [(t, r + .0035, f + .0035, b + .0035, e, o) for t, r, f, b, e, o in ARM_M]
        arm = limb_part('tmp', S, arm_pts(sign), bk, n=26)
        ring = arm.V.reshape(26, -1, 3)[19:26]
        uv = arm.uv.reshape(26, -1, 2)[19:26]
        ww = grid_part(side + 'WristWrap', ring, mat='bandage', cands=arm_cands(side), power=7, meta={'side': side, 'wrap': True})
        rc = ring.mean(1)
        ww.F = orient_faces(ww.V, ww.F, [rc[min(f) // ring.shape[1]] for f in ww.F])
        P.append(ww)
        # trousers legs
        lk = [(0, .090, .088, .095, 2, 0), (.12, .094, .090, .100, 2, 0), (.30, .080, .078, .082, 2, 0), (.50, .060, .060, .060, 2, 0),
              (.62, .060, .060, .064, 2, 0), (.85, .058, .056, .058, 2, 0), (1, .061, .060, .060, 2, 0)]
        P.append(limb_part(side + 'Leg', S, leg_pts(sign), lk, sides=18, mat='trousers', cands=leg_cands(side), n=30, power=6, meta={'side': side}))
        # trouser hem cuff
        hk = [(0, .062, .061, .061, 2, 0), (1, .064, .063, .063, 2, 0)]
        P.append(limb_part(side + 'Hem', S, [(sign * .1455, 0, .110), (sign * .146, 0, .072)], hk, sides=18, n=3, mat='trousers_dark',
                           cands=leg_cands(side), power=6))
        P += shoe_parts(sign, S, top='shoe', sole='sole')
        # loose bandage tail at wrist
        w = hands[side]['wrist']
        tail = [w + np.array([sign * -.012, .025, .02]) * S, w + np.array([sign * -.002, .040, -.03]) * S, w + np.array([sign * .012, .045, -.075]) * S]
        P.append(loft(side + 'WrapTail', catmull(tail, 6), lambda t: (.009 * S * (1 - .5 * t), .0018 * S, .0018 * S, 2.5, 0), sides=6,
                      hint=(1, 0, 0), frames='hint', mat='bandage', cands=[side + 'ForeArm', side + 'Hand'], power=6))
    # tank top hem lip
    lip = [(t, r + .004, f + .004, b + .004, e, o) for (t, r, f, b, e, o) in
           [(0, .126, .086, .083, 2.4, .004), (1, .125, .086, .082, 2.4, .004)]]
    P.append(torso_part(S, [(1.075,) + lip[0][1:], (1.095,) + lip[1][1:]], mat='tank', sides=28, name='TankHem', n=3))
    # ---- jacket tied at waist
    ring = ring_path(1.005, .168, .122, 40, front_drop=.02, S=S)
    P.append(closed_loft('JacketSleeveWrap', ring, lambda t: (.030 * S, .021 * S, .016 * S, 2.2, 0), sides=10, mat='jacket',
                         cands=['Hips', 'Spine', 'LeftUpLeg', 'RightUpLeg'], power=4, meta={'jacket': True}))
    P.append(blob('JacketKnot', np.array([0, -.142, .985]) * S, np.array([.040, .028, .034]) * S, mat='jacket', fixed='Hips', meta={'jacket': True}))
    for sign in (1, -1):
        sl = [(sign * .015, -.140, .985), (sign * .045, -.150, .93), (sign * .070, -.148, .86), (sign * .088, -.140, .80)]
        sk = [(0, .028, .022, .018, 2, 0), (.5, .030, .021, .018, 2, 0), (.85, .034, .022, .020, 2, 0), (1, .038, .024, .022, 2, 0)]
        P.append(limb_part(('L' if sign > 0 else 'R') + 'SleeveEnd', S, sl, sk, sides=10, n=10, mat='jacket', cap1=True,
                           cands=['Hips', 'LeftUpLeg' if sign > 0 else 'RightUpLeg'], power=3, meta={'jacket': True, 'cuff': True}))
    # back skirt of jacket with torn hem
    rows, cols = 12, 30
    G = np.zeros((rows, cols, 3))
    rng = np.random.RandomState(7)
    jag = np.array([0.05 * abs(((j * 0.37) % 1) - .5) + 0.02 * rng.rand() for j in range(cols)])
    jag[9] += .06
    jag[21] += .05
    for i in range(rows):
        t = i / (rows - 1)
        for j in range(cols):
            ang = math.radians(-118 + 236 * j / (cols - 1))   # 0 = back (+Y)
            z_top = 1.012
            z_bot = 0.60 + jag[j] + 0.03 * (abs(ang) / 2.0) ** 2
            z = z_top + (z_bot - z_top) * t
            a = .162 + (.245 - .162) * t ** .8
            b = .118 + (.180 - .118) * t ** .9
            G[i, j] = (a * math.sin(ang) * S, b * math.cos(ang) * S, z * S)
    for p in shell('JacketBack', G, 0.006 * S, outward=np.array([0, 0, .8 * S]), mat='jacket', inner_mat='lining',
                   cands=['Hips', 'LeftUpLeg', 'RightUpLeg'], power=2.5, meta={'jacket': True, 'skirt': True}):
        P.append(p)
    # ---- hair
    P += kaito_hair(sdf, S)
    return P


def kaito_hair(sdf, S):
    hk = HairKit(sdf, S)
    P = []

    def elmin(az):
        a = abs(((az + 180) % 360) - 180)  # 0 front .. 180 back
        if a < 40:
            return 40
        if a < 100:
            return 40 - (a - 40) * 0.55
        return 7 - (a - 100) * 0.30
    P.append(hk.cap('HairCap', elmin, off=0.016, nu=32, nv=9))
    UPB = np.array([0, 0, 1.0])
    BACK = np.array([0, 1.0, 0])

    def spike(az, el, L, w, th, up, back, bend=0.03, bone='Head', twist=0.0):
        root = hk.surf(az, el, -0.016)
        d = hk.dir(az, el)
        tipdir = nrm(d + BACK * back + UPB * up)
        tip = root + tipdir * L * S
        mid = root + (tip - root) * 0.5 + d * bend * S + UPB * bend * .5 * S
        P.append(hk.clump('Spike', [root, mid, tip], w, th, sides=8, n=11, taper=1.0, flat=.6, bulge=.18, bone=bone))
    rng = np.random.RandomState(11)
    lean = 12.0   # whole hairdo leans a little to one side for a dynamic silhouette
    # crown tier: long upward-back flames, varied
    for az, L in [(180, .22), (150, .21), (-152, .19), (122, .20), (-118, .18), (92, .17), (-88, .16), (62, .15), (-60, .14)]:
        az2 = az + rng.uniform(-8, 8)
        spike(az2, 58 + rng.uniform(-6, 6), L * rng.uniform(.9, 1.1), .082, .036, 1.0 + rng.uniform(-.2, .2),
              .55 + rng.uniform(-.15, .15), bone='Hair_01' if abs(az) > 120 else 'Head')
    # mid tier: back/side sweeping out, some point sideways
    for az, L, up in [(168, .16, .25), (-170, .15, .2), (138, .16, .35), (-135, .15, .3), (105, .15, .5), (-102, .14, .45),
                      (78, .12, .7), (-76, .12, .65)]:
        spike(az + rng.uniform(-6, 6), 28 + rng.uniform(-5, 5), L, .078, .034, up, .55, bend=.035)
    # nape tier
    for az, L in [(180, .11), (152, .10), (-150, .10), (125, .085), (-125, .085)]:
        spike(az, 6, L, .066, .028, -.35, .8, bend=.015)
    # front crest: three big swoops up, leaning to the character's right
    for az, L, w in [(-4, .21, .078), (-32, .18, .068), (24, .17, .068), (48, .14, .06)]:
        root = hk.surf(az, 56, -0.016)
        sx = math.sin(math.radians(az + lean))
        tip = root + np.array([sx * .08, .055, .15]) * S * (L / .15)
        mid = root + np.array([sx * .01, -.035, .07]) * S
        P.append(hk.clump('Swoop', [root, mid, tip], w, .034, sides=8, n=11, taper=1.0, flat=.6, bulge=.15))
    # bangs over the forehead: chunky, pointed, slightly asymmetric
    for az, tipaz, tipel, w in [(-28, -40, 12, .048), (-10, -12, 3, .050), (8, 6, 13, .044), (24, 30, 6, .048),
                                (-48, -64, 0, .042), (44, 62, 2, .042)]:
        root = hk.surf(az * .6, 54, -0.012)
        mid = hk.surf((az + tipaz) / 2, 33, 0.020)
        tip = hk.surf(tipaz, tipel, 0.014)
        P.append(hk.clump('Bang', [root, mid, tip], w, .018, sides=8, n=11, taper=.85, flat=.5, bulge=.30))
    # sideburn locks in front of ears
    for s in (-1, 1):
        root = hk.surf(s * 74, 34, -0.010)
        mid = hk.surf(s * 80, 10, 0.014)
        tip = hk.surf(s * 82, -16, 0.016)
        P.append(hk.clump('SideLock', [root, mid, tip], .036, .015, sides=8, n=10, taper=.85))
    return P


# ------------------------------------------------------------------ Kaito paint
KAITO_COL = {
    'skin': ('f6cfb4', 'df9a86'), 'tank': ('f5f2ec', 'b8b6cc'), 'trousers': ('2a3046', '171a2a'),
    'trousers_dark': ('1d2132', '11131d'), 'jacket': ('232838', '12141f'), 'lining': ('b0222e', '6d1420'),
    'shoe': ('d6343c', '8e1d2a'), 'sole': ('f1f1ee', 'a9adbf'), 'bandage': ('f1ebde', 'c2b5a4'),
    'hair': ('e0363a', '92172a'), 'hair_hi': ('ff7b6a', 'ff7b6a'), 'hair_tip': ('ff9b3d', 'c8501f'),
    'gold': ('f0c050', 'b07a26'), 'ink': ('1c1726', '1c1726'),
}
KAITO_AWAKE = {'hair': ('fff3cc', 'e6b155'), 'hair_hi': ('ffffff', 'ffffff'), 'hair_tip': ('ffc04f', 'ff8a2a')}


def C(tab, key, k=0):
    return hexc(tab[key][k])


def fill(n, col):
    return np.tile(col, (n, 1))


def hair_paint(n, luv, pos, tab, awake, tip_from=0.62):
    v = luv[:, 1]
    u = luv[:, 0]
    base = fill(n, C(tab, 'hair'))
    shade = fill(n, C(tab, 'hair', 1))
    r = smoothstep(0.30, 0.0, v)[:, None]
    base = base * (1 - r * .45) + shade * r * .45
    tip = smoothstep(tip_from, 1.0, v)[:, None]
    base = base * (1 - tip) + C(tab, 'hair_tip') * tip
    shade = shade * (1 - tip) + C(tab, 'hair_tip', 1) * tip
    # crisp highlight band on the outer face only (u ~ 0.5)
    outer = smoothstep(0.20, 0.10, np.abs(u - 0.5))
    centre = 0.30 + 0.012 * np.sign(np.sin(u * 22)) * np.abs(np.sin(u * 22)) ** .5
    band = smoothstep(0.006, 0.0, np.abs(v - centre) - 0.028) * outer
    res = {'base': base, 'shade': shade, 'ink': band * 0.75, 'ink_color': C(tab, 'hair_hi')}
    # underside (inner face) always in shade -> gives clumps volume under cel light
    res['shadow_extra'] = smoothstep(0.30, 0.42, np.abs(u - 0.5)) * 0.85
    if awake and tab.get('glow_tips'):
        res['glow'] = tip[:, 0] * 0.9
    return res


def kaito_painter():
    def paint(p, pos, nor, luv, awake):
        tab = dict(KAITO_COL)
        if awake:
            tab.update(KAITO_AWAKE)
            tab['glow_tips'] = True
        n = len(pos)
        x, y, z = pos[:, 0], pos[:, 1], pos[:, 2]
        m = p.mat
        if m in ('face', 'headback', 'ear'):
            base, shade = fill(n, C(tab, 'skin')), fill(n, C(tab, 'skin', 1))
            res = {'base': base, 'shade': shade}
            # hairline: dark hair colour on scalp
            hair_line = 1.735 - 0.06 * smoothstep(0.03, 0.09, np.abs(x)) - 0.10 * smoothstep(-0.02, 0.06, y)
            hm = smoothstep(hair_line - .003, hair_line + .003, z)
            res['ink'] = hm
            res['ink_color'] = C(tab, 'hair', 1)
            if m == 'ear':
                inner = smoothstep(.004, .010, np.abs(x) - .093)
                res['shadow_extra'] = (1 - inner) * .6
            if m == 'face':
                # neck/jaw underside shade and soft cheek shadow
                res['shadow_extra'] = smoothstep(0.05, 0.075, np.abs(x)) * smoothstep(1.585, 1.570, z) * .6
            if awake and m == 'face':
                pass
            return res
        if m in ('hair',):
            r = hair_paint(n, luv, pos, tab, awake)
            if p.meta.get('cap'):
                r['shadow_extra'] = np.zeros(n)
                r['ink'] = np.zeros(n)
                r['base'] = fill(n, C(tab, 'hair') * .8 + C(tab, 'hair', 1) * .2)
            return r
        if m == 'torso':
            skin, skin_s = C(tab, 'skin'), C(tab, 'skin', 1)
            tank, tank_s = C(tab, 'tank'), C(tab, 'tank', 1)
            tr, tr_s = C(tab, 'trousers'), C(tab, 'trousers', 1)
            ax = np.abs(x)
            # tank region: neckline scoop + armholes + straps
            neck = np.where(y < 0, 1.385 - 0.25 * ax ** 2 * 10, 1.43)
            strap = (ax > .055) & (ax < .105)
            arm_hole = 1.36 - smoothstep(.12, .17, ax) * .12
            top = np.where(strap, 1.60, np.minimum(neck, arm_hole) + np.where(ax > .105, 0, 0))
            top = np.where((ax >= .105), arm_hole, top)
            tankm = (z < top) & (z > 1.0)
            trm = z <= 1.01
            base = fill(n, skin)
            shade = fill(n, skin_s)
            base[tankm] = tank
            shade[tankm] = tank_s
            base[trm] = tr
            shade[trm] = tr_s
            ink = np.zeros(n)
            # trim lines along tank edges
            edge = np.abs(z - top)
            ink += (smoothstep(0.004, 0.0015, edge) * (z < 1.62)) * 0.8
            # tank folds near waist sides
            fold = stripe(z * 1 + 0.02 * np.sin(x * 40), 38, 0.06) * smoothstep(.07, .13, ax) * smoothstep(1.25, 1.10, z) * tankm
            ink += fold * .45
            # flame emblem on chest left (+x)
            ex, ez = x - .07, z - 1.30
            flame = (np.sqrt((ex / .022) ** 2 + ((ez + .006) / .03) ** 2) < 1) & (y < 0)
            fl2 = (np.sqrt(((ex - .006) / .011) ** 2 + ((ez - .02) / .02) ** 2) < 1) & (y < 0)
            emb = flame | fl2
            base[emb] = C(tab, 'shoe')
            shade[emb] = C(tab, 'shoe', 1)
            core = (np.sqrt((ex / .01) ** 2 + ((ez + .012) / .014) ** 2) < 1) & (y < 0)
            base[core] = C(tab, 'hair_tip')
            # collarbones
            cb = (smoothstep(0.003, 0.0, np.abs(z - (1.452 - 0.25 * (ax - .02)))) * (ax > .03) * (ax < .07) * (y < -.03))
            ink += cb * 0.5
            # neck shadow under the jaw
            sh_extra = smoothstep(1.536 + .3 * ax, 1.546 + .3 * ax, z) * (z < 1.62) * (y < .02)
            res = {'base': base, 'shade': shade, 'ink': np.clip(ink, 0, 1), 'ink_color': C(tab, 'ink'), 'shadow_extra': sh_extra}
            return res
        if m in ('arm', 'hand'):
            base, shade = fill(n, C(tab, 'skin')), fill(n, C(tab, 'skin', 1))
            res = {'base': base, 'shade': shade}
            if m == 'arm':
                res['shadow_k'] = 0.25 + 0.75 * smoothstep(0.10, 0.22, luv[:, 1])
            ink = np.zeros(n)
            if m == 'hand' or True:
                # bandages: palm + proximal finger segments, spiral lines
                side = p.meta.get('side', 'Left')
                w = np.array([.65 if side == 'Left' else -.65, 0, 1.04])
                dd = nrm([.10 if side == 'Left' else -.10, 0, -.09])
                along = (pos - w) @ dd
                band = (along > -0.035) & (along < (0.098 if p.meta.get('finger') is None else 0.093))
                if p.meta.get('finger') == 'Thumb':
                    band = along < 0.035
                base[band] = C(tab, 'bandage')
                shade[band] = C(tab, 'bandage', 1)
                sp = stripe(along + 0.004 * np.sin(np.arctan2(pos[:, 1], pos[:, 2] - 1.0) * 1), 85, 0.10) * band
                ink += sp * .55
                res['ink_color'] = hexc('a89a86')
            # elbow crease
            if m == 'arm':
                res['ink_color'] = hexc('a89a86')
            res['ink'] = ink
            if awake:
                # ember marks spiralling on forearms
                q = np.arctan2(pos[:, 1], (np.abs(x) - .5)) * 1.0 + np.abs(x) * 30
                em = stripe(q, 0.5, 0.08) * smoothstep(.38, .44, np.abs(x)) * smoothstep(.62, .56, np.abs(x))
                res['over'] = fill(n, hexc('ff7a1e'))
                res['over_a'] = em
                res['glow'] = em
            return res
        if m == 'bandage':
            base, shade = fill(n, C(tab, 'bandage')), fill(n, C(tab, 'bandage', 1))
            ink = stripe(luv[:, 1] + luv[:, 0] * 0.15, 5, 0.12) * 0.5
            return {'base': base, 'shade': shade, 'ink': ink, 'ink_color': hexc('a89a86')}
        if m in ('trousers', 'trousers_dark'):
            base, shade = fill(n, C(tab, m)), fill(n, C(tab, m, 1))
            ink = np.zeros(n)
            # knee and ankle fold lines
            for zc, zw, fr in [(.53, .05, 32), (.17, .06, 40), (.86, .035, 28)]:
                zone = smoothstep(zw, zw * .3, np.abs(z - zc))
                f = z + 0.018 * np.sin(np.arctan2(y, np.abs(x) - .13) * 2 + x * 60)
                ink += stripe(f, fr, 0.07) * zone * .8
            # side seam
            ax = np.abs(x)
            ang = np.arctan2(y, ax - (0.10 + (1.0 - z) * 0.05))
            ink += smoothstep(0.08, 0.03, np.abs(ang)) * 0.35 * (z < .98)
            # crease line down the front
            ink += smoothstep(0.05, 0.015, np.abs(ang + np.pi / 2)) * 0.25 * (z < .9)
            return {'base': base, 'shade': shade, 'ink': np.clip(ink, 0, 1) * .55, 'ink_color': hexc('0c0e16')}
        if m in ('jacket', 'lining'):
            base, shade = fill(n, C(tab, m)), fill(n, C(tab, m, 1))
            ink = np.zeros(n)
            res = {'base': base, 'shade': shade}
            if p.meta.get('skirt') and m == 'jacket':
                # vertical folds + torn hem edge + gold buttons near the front edges
                u, v = luv[:, 0], luv[:, 1]
                ink += stripe(u + 0.01 * np.sin(v * 9), 9, 0.04) * smoothstep(0.2, 0.9, v) * .6
                fr = smoothstep(0.85, 1.0, v)
                ink += fr * stripe(u, 60, 0.3) * .5
                for ue in (0.04, 0.96):
                    for vb in (0.18, 0.42, 0.66):
                        d = np.sqrt(((u - ue) * 1.9) ** 2 + (v - vb) ** 2)
                        b = d < 0.035
                        base[b] = C(tab, 'gold')
                        shade[b] = C(tab, 'gold', 1)
                        ink += smoothstep(0.004, 0.0, np.abs(d - 0.035)) * .8
                # school crest stitching line near top
                ink += smoothstep(0.012, 0.0, np.abs(v - 0.06)) * .5
            elif m == 'jacket':
                u, v = luv[:, 0], luv[:, 1]
                ink += stripe(v * 3 + 0.3 * np.sin(u * 12), 4, 0.05) * .5
                if p.meta.get('cuff'):
                    cuff = v > 0.82
                    ink += smoothstep(0.02, 0.0, np.abs(v - 0.82)) * .8
                    base[cuff] = C(tab, 'jacket') * 1.25
            res['ink'] = np.clip(ink, 0, 1)
            res['ink_color'] = hexc('0b0c12') if m == 'jacket' else hexc('4a0b12')
            return res
        if m == 'shoe':
            base, shade = fill(n, C(tab, 'shoe')), fill(n, C(tab, 'shoe', 1))
            ink = np.zeros(n)
            # white toe cap + laces + side stripe
            yy = y
            toe = (yy < -.17) & (z < .05)
            base[toe] = C(tab, 'sole')
            shade[toe] = C(tab, 'sole', 1)
            top = nor[:, 2] > .55
            lace = top & (yy > -.15) & (yy < -.02) & (np.abs(np.abs(x) - .145) < .022)
            base[lace] = hexc('f4f4f0')
            shade[lace] = hexc('b9bccb')
            ink += lace * stripe(yy, 90, 0.25) * .8
            side = np.abs(nor[:, 0]) > .6
            stripe_m = side & (np.abs(z - (.045 + (yy + .1) * -.15)) < .008) & (yy > -.15) & (yy < .04)
            base[stripe_m] = hexc('f4f4f0')
            # collar
            col = z > .095
            base[col] = hexc('1f2230')
            shade[col] = hexc('11131c')
            return {'base': base, 'shade': shade, 'ink': ink, 'ink_color': hexc('3a3d4c')}
        if m == 'sole':
            base, shade = fill(n, C(tab, 'sole')), fill(n, C(tab, 'sole', 1))
            ink = smoothstep(0.003, 0.0, np.abs(z - 0.006)) * 0.6
            bot = nor[:, 2] < -0.6
            base[bot] = hexc('9aa0b3')
            return {'base': base, 'shade': shade, 'ink': ink, 'ink_color': hexc('6d7285')}
        if m == 'tank':
            return {'base': fill(n, C(tab, 'tank')), 'shade': fill(n, C(tab, 'tank', 1)),
                    'ink': smoothstep(.002, 0, np.abs(z - 1.077)) * .5, 'ink_color': C(tab, 'ink')}
        col = C(tab, m) if m in tab else hexc('ff00ff')
        return {'base': fill(n, col), 'shade': fill(n, col * .6)}
    return paint


def kaito_face(S):
    box = tuple(v * S for v in KAITO['face_box'])
    st = dict(eye_w=0.043, eye_h=0.037, iris_top='7a3a12', iris_bot='ffc14a', iris_ring='3d1c0c', iris_light='ffe39a',
              tilt=0.10, wing=0.14, lash_w=0.11, brow_w=0.042, brow_t=0.0065, brow_c='5a1418', mouth_w=0.026,
              ink='1c1418', ink_soft='6a3a34', iris_w=0.50, iris_h=0.90)
    ex_, ez = 0.045, 1.664

    def face(panel, ex, awake):
        s = dict(st)
        if awake:
            s.update(iris_top='c46a10', iris_bot='fff4b8', iris_light='ffffff', iris_ring='a24a0a', brow_c='e8b64a')
        fc = FA.FaceCanvas(panel, box)
        mode, brow_a, brow_r, mouth = {'neutral': ('open', 0.30, 0, 'smile'), 'shout': ('wide', 0.75, 0.003, 'shout'),
                                       'pain': ('squeeze', -0.45, 0.004, 'grit'), 'determined': ('narrow', 0.65, -0.002, 'grin')}[ex]
        for side in (-1, 1):
            FA.draw_eye(fc, side * ex_ * S, ez * S, side, s, mode, glow=awake)
            FA.draw_brow(fc, side * 0.047 * S, 1.708 * S, side, s, angle=brow_a, raise_=brow_r * S)
        FA.draw_nose(fc, 0.004 * S, 1.630 * S, s)
        FA.draw_mouth(fc, 0.002 * S, 1.596 * S, s, mouth)
        if ex == 'pain':
            FA.sweat(fc, 0.075 * S, 1.69 * S, s)
        if awake:
            for side in (-1, 1):
                FA.marks(fc, [[(side * .062, 1.648), (side * .074, 1.630), (side * .070, 1.612)],
                              [(side * .050, 1.640), (side * .056, 1.624)]], 'ff7a1e', 0.0035 * S, glow=True)
        return fc.result()
    return face


# ===================================================================== shared paint helpers
def skin_head_paint(p, pos, nor, luv, tab, hair_line_fn=None, hair_key='hair'):
    n = len(pos)
    x, y, z = pos[:, 0], pos[:, 1], pos[:, 2]
    base, shade = fill(n, C(tab, 'skin')), fill(n, C(tab, 'skin', 1))
    res = {'base': base, 'shade': shade}
    if hair_line_fn is not None:
        hl = hair_line_fn(x, y, z)
        res['ink'] = smoothstep(hl - .003, hl + .003, z)
        res['ink_color'] = C(tab, hair_key, 1)
    if p.mat == 'ear':
        res['shadow_extra'] = (1 - smoothstep(.004, .010, np.abs(x) - .100)) * .6
    if p.mat == 'face':
        res['shadow_extra'] = smoothstep(0.05, 0.075, np.abs(x)) * smoothstep(1.585, 1.570, z) * .6
    return res


def neck_shadow(x, y, z, S=1.0):
    ax = np.abs(x)
    return smoothstep((1.536 + .3 * ax) * S, (1.546 + .3 * ax) * S, z) * (z < 1.62 * S) * (y < .02 * S)


def cloth_folds(pos, zones, S=1.0, width=0.07):
    x, y, z = pos[:, 0] / S, pos[:, 1] / S, pos[:, 2] / S
    ink = np.zeros(len(pos))
    for zc, zw, fr in zones:
        zone = smoothstep(zw, zw * .3, np.abs(z - zc))
        f = z + 0.018 * np.sin(np.arctan2(y, np.abs(x) - .13) * 2 + x * 60)
        ink += stripe(f, fr, width) * zone
    return np.clip(ink, 0, 1)


def ink_veins(pos, S=1.0, scale=7.0, w=0.018, seed=5):
    f = fbm(pos / S, scale, seed, 3)
    return smoothstep(w, w * .4, np.abs(f - 0.5))


# ===================================================================== SHIORI
SHIORI = dict(
    S=1.0, body_h=1.80,
    hand={'curl': 0.22, 'k': 0.98},
    head={'scale': 1.07, 'jaw_w': 0.078, 'chin_y': -0.058, 'chin_z': 1.566, 'face_y': -0.099, 'cr_r': (0.099, 0.108, 0.103),
          'nose_len': 0.002, 'jaw_ang': 0.78, 'jaw_z': 1.640, 'jaw_h': 0.072, 'chin_w': 0.008},
    face_box=(-0.12, 0.12, 1.53, 1.77),
    ao_cut=(0.50, 0.62),
    notes='Shiori Kageyama: short black layered hair with a silver streak, half mask, long purple scarf on Scarf bones, fingerless gloves, tabards, thigh kunai holster.',
)
TORSO_F = [
    (0.850, 0.112, 0.078, 0.090, 2.3, 0.000),
    (0.905, 0.150, 0.088, 0.110, 2.4, 0.000),
    (0.965, 0.148, 0.088, 0.102, 2.4, -0.002),
    (1.030, 0.122, 0.078, 0.080, 2.3, 0.000),
    (1.100, 0.104, 0.073, 0.070, 2.2, 0.004),
    (1.180, 0.110, 0.079, 0.071, 2.2, 0.006),
    (1.245, 0.122, 0.092, 0.077, 2.2, 0.008),
    (1.300, 0.128, 0.104, 0.079, 2.2, 0.010),
    (1.350, 0.133, 0.092, 0.080, 2.3, 0.006),
    (1.400, 0.142, 0.076, 0.080, 2.4, 0.000),
    (1.440, 0.140, 0.064, 0.072, 2.4, -0.004),
    (1.475, 0.104, 0.054, 0.058, 2.2, -0.005),
    (1.500, 0.064, 0.047, 0.049, 2.0, -0.003),
    (1.525, 0.047, 0.044, 0.043, 2.0, -0.001),
    (1.570, 0.045, 0.042, 0.041, 2.0, 0.004),
    (1.625, 0.043, 0.039, 0.039, 2.0, 0.010),
]
ARM_F = [(t, r * .84, f * .84, b * .84, e, o * .8) for t, r, f, b, e, o in ARM_M]


def mask_part(S, sdf, el_top, off=0.0045, name='HalfMask', mat='mask', az_max=104, nu=30, nv=12):
    """Lower-face mask as a parametric grid: azimuth x elevation from under the chin up to el_top(az)."""
    hk = HairKit(sdf, S)
    rows = []
    for i in range(nv + 1):
        t = i / nv
        row = []
        for j in range(nu + 1):
            az = -az_max + 2 * az_max * j / nu
            e0 = -58.0
            e1 = el_top(az)
            row.append(hk.dir(az, e0 + (e1 - e0) * t))
        rows.append(row)
    D = np.array(rows).reshape(-1, 3)
    sdf2 = lambda p: sdf(p) - off * S
    G = radial_surface(sdf2, hk.c, D, rmax=0.3 * S).reshape(nv + 1, nu + 1, 3)
    g = grid_part(name, G, mat=mat, fixed='Head', size=(0.30 * S, 0.12 * S))
    g.F = orient_faces(g.V, g.F, [hk.c] * len(g.F))
    return g


def kunai(name, base, direction, side_vec, S, bone, scale=1.0):
    d = nrm(direction)
    k = scale * S
    P = []
    ring = loft(name + 'Ring', [base - d * .018 * k + side_vec * .0001, base - d * .012 * k],
                lambda t: (.009 * k, .009 * k, .009 * k, 2, 0), sides=10, hint=side_vec, frames='hint', mat='steel', fixed=bone)
    grip = loft(name + 'Grip', catmull([base - d * .012 * k, base + d * .045 * k], 5),
                lambda t: (.0055 * k, .0055 * k, .0055 * k, 2, 0), sides=8, hint=side_vec, frames='hint', mat='wrap', fixed=bone)
    blade = loft(name + 'Blade', catmull([base + d * .045 * k, base + d * .06 * k, base + d * .09 * k, base + d * .115 * k], 8),
                 lambda t: (max(.016 * k * math.sin(math.pi * min(1, .15 + t * .95)) * (1 - t * .3), .0005), .0028 * k, .0028 * k, 1.3, 0),
                 sides=8, hint=np.cross(d, side_vec), frames='hint', mat='steel', fixed=bone, cap1=True)
    return [ring, grip, blade]


def build_shiori(S, segs, hands):
    P = []
    sp = SHIORI
    head, sdf = build_head(S, sp['head'], sp['face_box'])
    P += head
    P.append(mask_part(S, sdf, lambda az: -9.0 + 14.0 * (abs(az) / 104.0) ** 1.5 - 4.0 * math.cos(math.radians(az * 1.7)) * (abs(az) < 50)))
    P.append(torso_part(S, TORSO_F, mat='suit'))
    for side, sign in [('Left', 1), ('Right', -1)]:
        apts = [(sign * .115, 0, 1.452)] + arm_pts(sign)[1:]
        P.append(limb_part(side + 'Arm', S, apts, ARM_F, cands=arm_cands(side), mat='sleeve', meta={'side': side}))
        P += hand_parts(side, hands[side], S, mat='glovehand', finger_r=0.0080)
        # forearm guard plate (shell with thickness over the forearm top)
        gk = [(t, r + .006, f + .006, b + .006, e, o) for t, r, f, b, e, o in ARM_F]
        arm = limb_part('tmp', S, apts, gk, n=26, sides=20)
        G = arm.V.reshape(26, 21, 3)[14:23, 6:16]
        for q in shell(side + 'ArmGuard', G, 0.003 * S, outward=None, mat='guard', inner_mat='suit_dark',
                       cands=arm_cands(side), power=7):
            P.append(q)
        # legs (bodysuit) + shin wraps + tabi boots
        lk = [(0, .088, .086, .094, 2, 0), (.12, .090, .088, .098, 2, 0), (.30, .074, .072, .078, 2, 0), (.50, .052, .053, .054, 2, 0),
              (.62, .053, .054, .060, 2, 0), (.85, .041, .042, .043, 2, 0), (1, .040, .041, .041, 2, 0)]
        P.append(limb_part(side + 'Leg', S, leg_pts(sign), lk, sides=18, mat='suit', cands=leg_cands(side), n=30, power=6, meta={'side': side}))
        wk = [(0, .046, .047, .048, 2, 0), (.35, .058, .060, .066, 2, 0), (.75, .056, .058, .064, 2, 0), (1, .051, .053, .056, 2, 0)]
        P.append(limb_part(side + 'ShinWrap', S, [(sign * .143, 0, .105), (sign * .140, 0, .25), (sign * .136, 0, .39)], wk, sides=20, n=12,
                           mat='wraps', cands=leg_cands(side), power=6, meta={'side': side}))
        P += shoe_parts(sign, S, top='tabi', sole='tabi_sole', h=0.95, wide=0.86, name='Tabi')
    # tabards (front/back panels) + obi sash with back bow
    for sgn, nm in [(-1, 'TabardFront'), (1, 'TabardBack')]:
        rows, cols = 9, 9
        G = np.zeros((rows, cols, 3))
        for i in range(rows):
            t = i / (rows - 1)
            for j in range(cols):
                u = (j / (cols - 1)) * 2 - 1
                wdt = .085 + .02 * t
                x = u * wdt
                yb = sgn * (.090 + .035 * t + .012 * (1 - u * u))
                z = 1.02 - .30 * t - .02 * (u * u) * t
                G[i, j] = (x * S, yb * S, z * S)
        for q in shell(nm, G, 0.004 * S, outward=np.array([0, 0, 0.9 * S]), mat='tabard', inner_mat='tabard_in',
                       cands=['Hips', 'LeftUpLeg', 'RightUpLeg'], power=2.5, meta={'tabard': True}):
            P.append(q)
    ring = ring_path(1.035, .118, .086, 36, S=S)
    P.append(closed_loft('Obi', ring, lambda t: (.022 * S, .010 * S, .008 * S, 3.0, 0), sides=10, mat='obi',
                         cands=['Hips', 'Spine'], power=4))
    P.append(blob('ObiKnot', np.array([0, .098, 1.035]) * S, np.array([.030, .018, .022]) * S, mat='obi', fixed='Hips'))
    for sgn in (-1, 1):
        P.append(limb_part('ObiTail', S, [(sgn * .01, .100, 1.03), (sgn * .035, .112, .97), (sgn * .05, .118, .90)],
                           [(0, .014, .006, .006, 3, 0), (1, .018, .005, .005, 3, 0)], sides=8, n=6, mat='obi', fixed='Hips', cap1=True))
    # thigh holster with kunai (right leg)
    hold = ring_path(.80, .084, .084, 24, S=S)
    hold[:, 0] -= .118 * S
    P.append(closed_loft('HolsterStrap', hold, lambda t: (.010 * S, .004 * S, .003 * S, 3, 0), sides=8, center=np.array([-.118 * S, 0, .8 * S]),
                         mat='strap', cands=['RightUpLeg', 'RightLeg'], power=6))
    for k, dy in enumerate((-0.035, 0.0, 0.035)):
        base = np.array([-.205, dy, .83]) * S
        P += kunai('Kunai%d' % k, base, np.array([-.05, 0, -1.0]), np.array([0, 1.0, 0]), S, 'RightUpLeg', scale=.9)
    # scarf: neck loop + two trailing tails on scarf bones
    for zc, a, b, h in [(1.488, .078, .070, .030), (1.540, .064, .060, .028)]:
        loop = ring_path(zc, a, b, 30, S=S)
        loop[:, 1] += .004 * S
        P.append(closed_loft('ScarfLoop', loop, lambda t, h=h: (h * S, .020 * S, .010 * S, 2.2, 0), sides=12, mat='scarf',
                             cands=['Spine2', 'Neck', 'Head'], power=4, meta={'scarf': True}))
    for nm, path, width, L in [('ScarfTail', [(.03, .085, 1.48), (-.05, .135, 1.33), (-.13, .155, 1.16), (-.21, .165, .99), (-.29, .175, .82), (-.35, .18, .70)], .12, 1.0),
                               ('ScarfTail2', [(.05, .080, 1.47), (.04, .13, 1.34), (.01, .15, 1.20), (-.03, .16, 1.08)], .095, .6)]:
        C_ = catmull(np.array(path) * S, 14)
        T, Sv, Fv = hint_frames(C_, (0, 1, 0))
        rows, cols = len(C_), 7
        G = np.zeros((rows, cols, 3))
        for i in range(rows):
            t = i / (rows - 1)
            w = width * S * (0.75 + 0.35 * t) * (1 - 0.15 * t)
            for j in range(cols):
                u = j / (cols - 1) - .5
                wave = 0.012 * S * math.sin(t * 9 + u * 3) * t
                G[i, j] = C_[i] + Sv[i] * u * w + Fv[i] * (wave + 0.01 * S * (u * u))
        # torn/ragged end
        cands = ['Spine2', 'Scarf_01', 'Scarf_02'] if L > .8 else ['Spine2', 'Scarf_01']
        for q in shell(nm, G, 0.005 * S, outward=np.array([0, -1.0 * S, 1.1 * S]), mat='scarf', inner_mat='scarf_in',
                       cands=cands, power=3, meta={'scarf': True, 'tail': True}):
            P.append(q)
    P += shiori_hair(sdf, S)
    return P


def shiori_hair(sdf, S):
    hk = HairKit(sdf, S)
    P = []

    def elmin(az):
        a = abs(((az + 180) % 360) - 180)
        if a < 40:
            return 42
        if a < 100:
            return 42 - (a - 40) * 0.6
        return 6 - (a - 100) * 0.25
    P.append(hk.cap('HairCap', elmin, off=0.012, nu=32, nv=9))
    rng = np.random.RandomState(21)
    # layered bob: clumps hugging the skull, flicking out at the ends
    for layer, (el0, el1, step, w) in enumerate([(62, -22, 26, .062), (40, -14, 30, .056)]):
        for az in np.arange(-180, 180, step) + layer * step / 2:
            a = abs(((az + 180) % 360) - 180)
            if a < 58:
                continue
            e1 = el1 + (8 if a < 90 else 0) + rng.uniform(-4, 4)
            pts = [hk.surf(az, el0, -0.010), hk.surf(az, (el0 + e1) / 2 + 6, 0.020), hk.surf(az + 4, e1, 0.024)]
            tip = pts[-1] + (nrm(pts[-1] - hk.c) * 0.022 + np.array([0, 0.01, -0.006])) * S
            P.append(hk.clump('Bob', pts + [tip], w, .018, sides=8, n=9, taper=.9, flat=.55, bulge=.25))
    # crown tufts (small spikes on top for a ninja edge)
    for az, el in [(150, 66), (-150, 66), (180, 58)]:
        root = hk.surf(az, el, -0.012)
        tip = root + nrm(hk.dir(az, el) + np.array([0, 1.0, -.1])) * .075 * S
        P.append(hk.clump('Tuft', [root, root + (tip - root) * .5 + hk.dir(az, el) * .015 * S, tip], .055, .022, sides=8, n=9, taper=1.0))
    # side-swept bangs (part on character's left), one silver streak
    for k, (az, tipaz, tipel, w, mat) in enumerate([(34, 2, 10, .050, 'hair'), (18, -16, 6, .052, 'hair'), (2, -32, 6, .050, 'hair'),
                                                    (-14, -50, 2, .046, 'hair'), (48, 30, 12, .044, 'hair'), (-30, -66, -6, .042, 'hair')]):
        root = hk.surf(az, 58, -0.010)
        mid = hk.surf((az + tipaz) / 2, 36, 0.020)
        tip = hk.surf(tipaz, tipel, 0.014)
        P.append(hk.clump('Bang', [root, mid, tip], w, .016, sides=8, n=11, taper=.8, flat=.5, bulge=.3, mat=mat))
    # thin silver streak lock over the bangs
    pts = [hk.surf(28, 50, -0.006), hk.surf(14, 32, 0.026), hk.surf(-4, 10, 0.022)]
    P.append(hk.clump('SilverStreak', pts, .024, .010, sides=6, n=10, taper=.8, flat=.5, mat='hair_silver'))
    # long side lock on the right (character right = -x)
    for s_, L in [(-1, -34), (1, -20)]:
        pts = [hk.surf(s_ * 64, 34, -0.008), hk.surf(s_ * 70, 4, 0.016), hk.surf(s_ * 70, L, 0.020)]
        P.append(hk.clump('SideLock', pts, .040, .015, sides=8, n=10, taper=.8, mat='hair_silver' if s_ > 0 else 'hair'))
    return P


SHIORI_COL = {
    'skin': ('fbe0cf', 'e5a597'), 'suit': ('262a3e', '141625'), 'suit_dark': ('1a1d2c', '0e1019'), 'sleeve': ('262a3e', '141625'),
    'purple': ('7d4fc8', '482a86'), 'scarf': ('7446c0', '41247a'), 'scarf_in': ('4e2c8a', '2c1650'), 'silver': ('d8dde9', '8e96ad'),
    'glove': ('31354b', '1a1c2a'), 'mask': ('1f2233', '10121c'), 'wraps': ('8e88a6', '585273'), 'tabard': ('2e3249', '171a29'),
    'tabard_in': ('5a3796', '33205a'), 'obi': ('7d4fc8', '482a86'), 'strap': ('3a2e2a', '1f1816'), 'steel': ('c9d0de', '6f7890'),
    'wrap': ('4b3a5e', '281e33'), 'guard': ('aab2c4', '5d6680'), 'tabi': ('2a2d40', '15172a'), 'tabi_sole': ('5c5f72', '33364a'),
    'hair': ('2c3045', '111320'), 'hair_hi': ('6a7396', '6a7396'), 'hair_tip': ('3a3f5a', '161826'),
    'hair_silver': ('cdd3e2', '868ea8'), 'ink': ('151522', '151522'),
}
SHIORI_INK = {k: ('0d0f17', '05060a') for k in SHIORI_COL}


def shiori_painter():
    def paint(p, pos, nor, luv, awake):
        tab = dict(SHIORI_COL)
        n = len(pos)
        x, y, z = pos[:, 0], pos[:, 1], pos[:, 2]
        m = p.mat
        res = None
        if m in ('face', 'headback', 'ear'):
            res = skin_head_paint(p, pos, nor, luv, tab, lambda x, y, z: 1.735 - 0.07 * smoothstep(0.03, 0.09, np.abs(x)) - 0.10 * smoothstep(-0.02, 0.06, y))
        elif m in ('hair', 'hair_silver'):
            t2 = dict(tab)
            if m == 'hair_silver':
                t2['hair'] = tab['hair_silver']
                t2['hair_tip'] = ('c4cbe0', '8a92ab')
                t2['hair_hi'] = ('ffffff', 'ffffff')
            res = hair_paint(n, luv, pos, t2, False, tip_from=0.7)
            if p.meta.get('cap'):
                res = {'base': fill(n, C(tab, 'hair')), 'shade': fill(n, C(tab, 'hair', 1))}
        elif m in ('suit', 'sleeve'):
            base, shade = fill(n, C(tab, 'suit')), fill(n, C(tab, 'suit', 1))
            ink = np.zeros(n)
            # purple piping: collar (high neck), side seams, sleeve ends
            ax = np.abs(x)
            if m == 'suit':
                skin_m = (z > 1.505) & (z < 1.70)   # neck shows above collar (mostly under scarf)
                base[skin_m] = C(tab, 'skin')
                shade[skin_m] = C(tab, 'skin', 1)
                # front crossover (kimono style) collar line
                cross = smoothstep(.006, .002, np.abs((z - 1.47) + 1.6 * (np.abs(x) - 0.0) * (x > 0) + 1.6 * np.abs(x) * (x <= 0) * 0.0 - 0.0)) * 0
                v_line = np.abs(z - (1.45 + 2.5 * (x - .07)))
                lap = (y < 0) & (z > 1.10) & (v_line < .012) & (z < 1.47)
                base[lap] = C(tab, 'purple')
                shade[lap] = C(tab, 'purple', 1)
                ink += cloth_folds(pos, [(1.12, .05, 30), (.53, .05, 30), (.86, .04, 26)], 1.0, 0.06) * .5
            else:
                cuff = luv[:, 1] > 0.86
                ink += cloth_folds(pos, [(1.24, .04, 40)], 1.0, 0.06) * .5
            res = {'base': base, 'shade': shade, 'ink': ink, 'ink_color': hexc('0b0c14'),
                   'shadow_extra': neck_shadow(x, y, z) if m == 'suit' else np.zeros(n)}
        elif m == 'glovehand':
            side = p.meta.get('side', 'Left')
            w = np.array([.65 if side == 'Left' else -.65, 0, 1.04])
            dd = nrm([.10 if side == 'Left' else -.10, 0, -.09])
            along = (pos - w) @ dd
            fing = p.meta.get('finger')
            glove = along < (0.112 if fing and fing != 'Thumb' else (0.05 if fing == 'Thumb' else 1.0))
            base, shade = fill(n, C(tab, 'skin')), fill(n, C(tab, 'skin', 1))
            base[glove] = C(tab, 'glove')
            shade[glove] = C(tab, 'glove', 1)
            knuck = glove & (np.abs(along - .086) < .010) & (np.sum(nor * (-np.array([-.669 if side == 'Left' else .669, 0, -.743])), 1) > .3)
            base[knuck] = C(tab, 'guard')
            res = {'base': base, 'shade': shade, 'ink': smoothstep(.003, 0, np.abs(along - (0.112 if fing and fing != 'Thumb' else .05))) * glove * 0 +
                   smoothstep(.002, 0, np.abs(along - .112)) * .7, 'ink_color': hexc('0b0c14')}
        elif m == 'mask':
            base, shade = fill(n, C(tab, 'mask')), fill(n, C(tab, 'mask', 1))
            ink = smoothstep(.003, 0, np.abs(x)) * (y < 0) * .5   # centre seam
            ink += stripe(z * 1, 120, .08) * smoothstep(1.60, 1.58, z) * .25
            res = {'base': base, 'shade': shade, 'ink': ink, 'ink_color': hexc('3a3e58')}
        elif m in ('scarf', 'scarf_in'):
            base, shade = fill(n, C(tab, m)), fill(n, C(tab, m, 1))
            u, v = luv[:, 0], luv[:, 1]
            ink = np.zeros(n)
            if p.meta.get('tail'):
                ink += stripe(u, 6, .05) * smoothstep(.2, .9, v) * .35
                edge = (u < .06) | (u > .94)
                base[edge] = C(tab, 'silver')
                shade[edge] = C(tab, 'silver', 1)
                ink += smoothstep(.97, 1.0, v) * stripe(u, 18, .4) * .7
            else:
                ink += stripe(v + u * .2, 5, .06) * .35
            res = {'base': base, 'shade': shade, 'ink': ink, 'ink_color': hexc('2a1450')}
        elif m in ('tabard', 'tabard_in'):
            base, shade = fill(n, C(tab, m)), fill(n, C(tab, m, 1))
            u, v = luv[:, 0], luv[:, 1]
            ink = stripe(u + 0.02 * np.sin(v * 8), 4, .04) * smoothstep(.2, .9, v) * .45
            if m == 'tabard':
                trim = (u < .07) | (u > .93) | (v > .92)
                base[trim] = C(tab, 'purple')
                shade[trim] = C(tab, 'purple', 1)
                # crescent-less original crest: three-tomoe-free simple diamond kamon
                d = np.abs(u - .5) * 1.4 + np.abs(v - .32)
                emb = (d < .10) & (d > .075)
                base[emb] = C(tab, 'silver')
            res = {'base': base, 'shade': shade, 'ink': ink, 'ink_color': hexc('0b0c14')}
        elif m == 'wraps':
            base, shade = fill(n, C(tab, 'wraps')), fill(n, C(tab, 'wraps', 1))
            ink = stripe(z * 1 + np.arctan2(y, x) * .004, 55, .12) * .6
            res = {'base': base, 'shade': shade, 'ink': ink, 'ink_color': hexc('5c5674')}
        elif m == 'tabi':
            base, shade = fill(n, C(tab, 'tabi')), fill(n, C(tab, 'tabi', 1))
            toe = (y < -.17) & (np.abs(np.abs(x) - .145) < .004)
            ink = toe * 1.0
            res = {'base': base, 'shade': shade, 'ink': ink * .8, 'ink_color': hexc('0b0c14')}
        elif m == 'guard':
            base, shade = fill(n, C(tab, 'guard')), fill(n, C(tab, 'guard', 1))
            u, v = luv[:, 0], luv[:, 1]
            ink = (smoothstep(.06, .03, np.minimum(np.minimum(u, 1 - u), np.minimum(v, 1 - v)))) * .6
            res = {'base': base, 'shade': shade, 'ink': ink, 'ink_color': hexc('3b4258')}
        if res is None:
            col = tab.get(m, ('ff00ff', '880088'))
            res = {'base': fill(n, hexc(col[0])), 'shade': fill(n, hexc(col[1]))}
        if awake:
            # Moonless mode: ink-black body with white brush edge marks
            dark = 0.10
            res['base'] = res['base'] * dark + hexc('0b0d16') * (1 - dark)
            res['shade'] = res['shade'] * dark * .5 + hexc('05060b') * (1 - dark * .5)
            if 'ink' in res:
                res['ink'] = res['ink'] * 0.3
            veins = ink_veins(pos, 1.0, 6.0, 0.016) * (m not in ('face',))
            u, v = luv[:, 0], luv[:, 1]
            edge = smoothstep(0.035, 0.0, np.minimum(v, 1 - v)) * (p.meta.get('tail', False) or p.meta.get('tabard', False))
            if m in ('hair', 'hair_silver'):
                edge = smoothstep(0.7, 0.95, v) * 0.9
            mark = np.clip(veins * .9 + edge, 0, 1)
            res['over'] = fill(n, hexc('f4f6ff'))
            res['over_a'] = mark
            res['glow'] = mark
        return res
    return paint


def shiori_face(S):
    box = tuple(v * S for v in SHIORI['face_box'])
    st = dict(eye_w=0.046, eye_h=0.041, iris_top='3b2370', iris_bot='c6a8ff', iris_ring='241445', iris_light='e8dcff',
              tilt=0.06, wing=0.17, lash_w=0.13, brow_w=0.036, brow_t=0.0045, brow_c='22243a', mouth_w=0.020,
              ink='15131f', ink_soft='5a4060', iris_w=0.52, iris_h=0.94, blush='f29aa0')
    ex_, ez = 0.045, 1.664

    def face(panel, ex, awake):
        fc = FA.FaceCanvas(panel, box)
        s = dict(st)
        mode, brow_a, brow_r = {'neutral': ('open', 0.10, 0), 'shout': ('wide', 0.6, 0.003),
                                'pain': ('squeeze', -0.5, 0.004), 'determined': ('glare', 0.55, -0.003)}[ex]
        if awake:
            # ink face: everything dark, eyes become white glowing slits
            arr = np.asarray(fc.img).astype(np.float32)
            from PIL import Image as _I
            dark = (arr[..., :3] * 0.08 + np.array([11, 13, 22]) * 0.92).astype(np.uint8)
            fc.img = _I.fromarray(np.dstack([dark, arr[..., 3].astype(np.uint8)]), 'RGBA')
            s.update(sclera='ffffff', sclera_shade='e8ecff', iris_top='ffffff', iris_bot='ffffff', iris_ring='dfe4ff',
                     pupil_c='ffffff', ink='f4f6ff', ink_soft='c8ccff', brow_c='f4f6ff', iris_light=None)
        for side in (-1, 1):
            FA.draw_eye(fc, side * ex_ * S, ez * S, side, s, mode, glow=awake)
            FA.draw_brow(fc, side * 0.047 * S, 1.708 * S, side, s, angle=brow_a, raise_=brow_r * S)
        if not awake:
            FA.blush(fc, 0.062 * S, 1.635 * S, 1, s, 0.25)
            FA.blush(fc, -0.062 * S, 1.635 * S, -1, s, 0.25)
        if ex == 'pain':
            FA.sweat(fc, 0.075 * S, 1.69 * S, s)
        FA.draw_mouth(fc, 0, 1.596 * S, s, 'small')
        rgb, g = fc.result()
        if awake:
            g = np.maximum(g, (rgb.mean(-1) > .8).astype(np.float32))
        return rgb, g
    return face


# ===================================================================== REN
REN = dict(
    S=1.0, body_h=1.80,
    hand={'curl': 0.18, 'k': 1.04},
    head={'scale': 1.06, 'nu': 40, 'jaw_w': 0.079, 'chin_y': -0.062, 'chin_z': 1.562, 'face_y': -0.100, 'cr_r': (0.099, 0.110, 0.104),
          'nose_len': 0.004, 'jaw_ang': 0.84, 'jaw_z': 1.638, 'jaw_h': 0.075, 'chin_w': 0.010},
    face_box=(-0.12, 0.12, 1.53, 1.77),
    ao_cut=(0.50, 0.62),
    notes='Ren Tsukishiro: long dark-navy ponytail, white haori with crescent motif, pleated hakama, closed eyes (open/glowing in awakened atlas). Katana is a separate skinned mesh (Hips) sheathed at the left hip.',
)
TORSO_R = [(z, rs * .95, rf * .95, rb * .95, e, o) for z, rs, rf, rb, e, o in TORSO_M]
KOIGUCHI = np.array([0.165, -0.085, 1.035])
SAYA_D = nrm([0.10, 0.85, -0.42])


def loft_r(name, C, rfun, sides=16, hint=(0, -1, 0), **kw):
    """Loft with an arbitrary radius function rfun(t, theta, S_vec, F_vec) -> radius; theta=0 at +S."""
    C = np.asarray(C, float)
    T, Sv, Fv = hint_frames(C, hint)
    m = len(C)
    G = np.zeros((m, sides + 1, 3))
    for i in range(m):
        t = i / (m - 1)
        for k in range(sides + 1):
            th = 2 * math.pi * k / sides - math.pi / 2
            r = rfun(t, th, Sv[i], Fv[i])
            G[i, k] = C[i] + r * (math.cos(th) * Sv[i] + math.sin(th) * Fv[i])
    g = grid_part(name, G, **kw)
    g.F = orient_faces(g.V, g.F, [C[min(f) // (sides + 1)] for f in g.F])
    return g, G


def build_ren(S, segs, hands):
    P = []
    sp = REN
    head, sdf = build_head(S, sp['head'], sp['face_box'])
    P += head
    P.append(torso_part(S, TORSO_R, mat='kimono'))
    for side, sign in [('Left', 1), ('Right', -1)]:
        apts = arm_pts(sign)
        ak = [(t, r * .93, f * .93, b * .93, e, o) for t, r, f, b, e, o in ARM_M]
        P.append(limb_part(side + 'Arm', S, apts, ak, cands=arm_cands(side), mat='ren_arm', meta={'side': side}))
        P += hand_parts(side, hands[side], S, mat='skin_hand', finger_r=0.0085)
        # wide haori sleeve hanging below the arm
        C_ = catmull(np.array(apts) * S, 20)[2:15]

        def rf(t, th, Sv, Fv):
            down = max(0.0, math.cos(th)) ** 2     # +S is roughly world-down for A-pose arms
            return (0.074 + 0.03 * t + 0.07 * down * t ** 0.8) * S
        sl, G = loft_r(side + 'Sleeve', C_, rf, sides=16)
        for q in shell(side + 'Sleeve', G, 0.005 * S, outward=C_, mat='haori', inner_mat='haori_in', cands=arm_cands(side)[:4], power=5,
                       meta={'side': side, 'sleeve': True}):
            P.append(q)
        # hakama leg: wide pleated tube
        hc = [(sign * .055, 0, 1.03), (sign * .080, 0, .80), (sign * .112, 0, .45), (sign * .145, 0, .085)]
        HC = catmull(np.array(hc) * S, 20)

        def hr(t, th, Sv, Fv):
            base = (0.086 + 0.075 * t ** 0.9) * S
            pleat = 1 + 0.045 * abs(math.sin(th * 3.5)) * (0.3 + t)
            return base * pleat
        hg, G = loft_r(side + 'Hakama', HC, hr, sides=24)
        hg.mat = 'hakama'
        hg.cands = ['Hips', side + 'UpLeg', side + 'Leg']
        hg.power = 4
        hg.meta = {'side': side, 'hakama': True}
        P.append(hg)
        # tabi + zori
        for q in shoe_parts(sign, S, top='tabi_w', sole='zori', h=0.85, wide=0.9, name='Tabi'):
            P.append(q)
        x = sign * .145
        strap = [(x - sign * .03, .00, .045), (x, -.135, .05), (x + sign * .033, .00, .045)]
        P.append(loft(('L' if sign > 0 else 'R') + 'ZoriStrap', catmull(np.array(strap) * S, 9), lambda t: (.007 * S, .005 * S, .004 * S, 2, 0),
                      sides=8, hint=(0, 0, 1), frames='hint', mat='strap_n', cands=[side + 'Foot', side + 'ToeBase'], power=6))
    # haori body: open-front coat draped from the shoulders
    rows, cols = 15, 28
    G = np.zeros((rows, cols, 3))
    zs = np.linspace(1.505, 0.60, rows)
    tk = [(z, rs, rf, rb) for z, rs, rf, rb, e, o in TORSO_R]
    for i, z in enumerate(zs):
        r = interp_keys([(k[0], k[1:]) for k in tk[::-1]][::-1], z) if False else None
        # torso radii at z (use table); flare below waist to clear hakama
        zz = [k[0] for k in tk]
        rs = np.interp(z, zz, [k[1] for k in tk]); rfr = np.interp(z, zz, [k[2] for k in tk]); rb = np.interp(z, zz, [k[3] for k in tk])
        if z > 1.44:
            k = (z - 1.44) / (1.505 - 1.44)
            rs = rs * (1 - k) + 0.085 * k
            rfr = rfr * (1 - k) + 0.07 * k
            rb = rb * (1 - k) + 0.075 * k
        fl = max(0.0, 1.12 - z)
        rs = rs + 0.016 + fl * 0.30 + 0.03 * smoothstep(1.15, 1.0, z)
        rfr = rfr + 0.016 + fl * 0.24 + 0.02 * smoothstep(1.15, 1.0, z)
        rb = rb + 0.018 + fl * 0.26 + 0.02 * smoothstep(1.15, 1.0, z)
        for j in range(cols):
            ang = math.radians(-152 + 304 * j / (cols - 1))   # 0 = back
            open_k = smoothstep(1.30, 1.0, z) * 0 + 1
            yv = rb * math.cos(ang) if math.cos(ang) > 0 else rfr * math.cos(ang)
            G[i, j] = (rs * math.sin(ang) * S, yv * S, z * S)
    for q in shell('Haori', G, 0.006 * S, outward=np.array([0, 0, 1.1 * S]), mat='haori', inner_mat='haori_in',
                   cands=['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder', 'LeftUpLeg', 'RightUpLeg'],
                   power=3.5, meta={'haori': True}):
        P.append(q)
    # haori collar band (eri) along the front edges
    for sgn in (-1, 1):
        j = 0 if sgn < 0 else cols - 1
        band = G[:, j] + np.array([0, -0.004 * S, 0])
        P.append(loft('HaoriCollar', catmull(band, 16), lambda t: (.014 * S, .006 * S, .006 * S, 2.6, 0), sides=8, hint=(0, -1, 0),
                      frames='hint', mat='collar_n', cands=['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftUpLeg', 'RightUpLeg'], power=3.5))
    # obi + hakama himo
    ring = ring_path(1.03, .132, .100, 36, S=S)
    P.append(closed_loft('Obi', ring, lambda t: (.030 * S, .012 * S, .008 * S, 3.0, 0), sides=10, mat='obi_r', cands=['Hips', 'Spine'], power=4))
    ring = ring_path(.985, .138, .108, 36, S=S, front_drop=.01)
    P.append(closed_loft('Himo', ring, lambda t: (.008 * S, .006 * S, .005 * S, 2.0, 0), sides=8, mat='hakama_d', cands=['Hips'], power=4))
    P.append(blob('HimoKnot', np.array([0, -.118, .975]) * S, np.array([.026, .012, .016]) * S, mat='hakama_d', fixed='Hips'))
    # sheath (Fighter) + katana (separate mesh)
    k0 = KOIGUCHI * S
    d = SAYA_D
    up = nrm(np.cross(d, [1, 0, 0]))
    saya = loft('Saya', catmull([k0, k0 + d * .74 * S], 18), lambda t: (.0175 * S * (1 - .15 * t), .0135 * S, .0135 * S, 2.3, 0),
                sides=12, hint=up, frames='hint', cap1=0.004 * S, mat='saya', fixed='Hips', meta={'saya': True})
    P.append(saya)
    P.append(loft('Koiguchi', [k0 - d * .002 * S, k0 + d * .025 * S], lambda t: (.0195 * S, .015 * S, .015 * S, 2.3, 0), sides=12, hint=up,
                  frames='hint', mat='gold', fixed='Hips'))
    P.append(loft('Kojiri', [k0 + d * .70 * S, k0 + d * .745 * S], lambda t: (.0165 * S * (1 - .3 * t), .0128 * S, .0128 * S, 2.3, 0), sides=12,
                  hint=up, frames='hint', cap1=0.004 * S, mat='gold', fixed='Hips'))
    # katana parts in a separate mesh
    kat = dict(group='Katana', fixed='Hips')
    P.append(loft('Blade', catmull([k0 + d * .03 * S, k0 + d * .40 * S, k0 + d * .70 * S], 20),
                  lambda t: (.013 * S * (1 - .25 * t) if t < .96 else .013 * S * .75 * (1 - (t - .96) / .04 * .9), .0032 * S, .0032 * S, 1.4, 0),
                  sides=8, hint=up, frames='hint', cap1=0.006 * S, mat='blade', meta={'blade': True}, **kat))
    P.append(loft('Habaki', [k0 - d * .002 * S, k0 + d * .03 * S], lambda t: (.0155 * S, .0085 * S, .0085 * S, 2.4, 0), sides=10, hint=up,
                  frames='hint', mat='gold', **kat))
    P.append(loft('Tsuba', [k0 - d * .012 * S, k0 - d * .004 * S], lambda t: (.040 * S, .036 * S, .036 * S, 2.0, 0), sides=20, hint=up,
                  frames='hint', cap0=True, cap1=True, mat='tsuba', meta={'tsuba': True}, **kat))
    P.append(loft('Tsuka', catmull([k0 - d * .012 * S, k0 - d * .13 * S, k0 - d * .255 * S], 14),
                  lambda t: (.0155 * S * (1 - .06 * math.sin(t * math.pi)), .0125 * S, .0125 * S, 2.2, 0), sides=10, hint=up, frames='hint',
                  mat='tsuka', meta={'tsuka': True}, **kat))
    P.append(loft('Kashira', [k0 - d * .255 * S, k0 - d * .272 * S], lambda t: (.0160 * S * (1 - .3 * t), .0130 * S, .0130 * S, 2.2, 0), sides=10,
                  hint=up, frames='hint', cap1=0.003 * S, mat='gold', **kat))
    P += ren_hair(sdf, S)
    return P


def ren_hair(sdf, S):
    hk = HairKit(sdf, S)
    P = []

    def elmin(az):
        a = abs(((az + 180) % 360) - 180)
        if a < 40:
            return 44
        if a < 100:
            return 44 - (a - 40) * 0.55
        return 10 - (a - 100) * 0.2
    P.append(hk.cap('HairCap', elmin, off=0.008, nu=32, nv=9))
    tie = hk.surf(180, 20, 0.010)
    # swept-back strands converging on the tie
    for az in [-150, -125, -100, -75, -52, 52, 75, 100, 125, 150, -30, 30, 0, -12, 12]:
        el0 = 52 if abs(az) <= 30 else 40
        s = 1 if az >= 0 else -1
        mid_az = az + (s * 180 - az) * .5
        pts = [hk.surf(az, el0, -0.006), hk.surf(mid_az, (el0 + 40) / 2 + 10, 0.016), tie + np.array([0, 0.004, 0]) * S]
        P.append(hk.clump('Swept', pts, .060, .016, sides=8, n=10, taper=.5, flat=.5, bulge=.2))
    # ponytail: tie clasp + bundle of clumps along Ponytail bones
    clasp_c = tie + np.array([0, .012, 0]) * S
    P.append(loft('PonyClasp', [clasp_c - np.array([0, .012, 0]) * S, clasp_c + np.array([0, .014, -0.004]) * S],
                  lambda t: (.022 * S, .020 * S, .020 * S, 2, 0), sides=12, hint=(0, 0, 1), frames='hint', cap1=True, mat='gold', fixed='Head'))
    path = np.array([clasp_c / S + np.array([0, .01, 0]), (0, .175, 1.66), (0, .20, 1.50), (.01, .21, 1.32), (.03, .215, 1.15), (.05, .21, 1.00)])
    rng = np.random.RandomState(4)
    pc = ['Head', 'Ponytail_01', 'Ponytail_02']
    for k in range(6):
        ang = 2 * math.pi * k / 6
        off = np.array([math.cos(ang) * .018, math.sin(ang) * .010, 0])
        pts = [(path[i] + off * (1.0 - .5 * i / len(path)) + np.array([rng.uniform(-.006, .006), 0, 0]) * (i > 1)) * S for i in range(len(path))]
        pts[-1] = pts[-1] + np.array([math.cos(ang) * .03, .01, rng.uniform(-.04, .03)]) * S
        P.append(hk.clump('Pony', pts, .044, .021, sides=8, n=13, taper=.7, flat=.8, bulge=.25, cands=pc, power=4))
    # framing bangs + long side locks
    for az, tipaz, tipel, w, L in [(-8, -20, 6, .040, 0), (10, 24, 10, .040, 0), (-26, -40, 14, .036, 0), (28, 44, 14, .036, 0)]:
        pts = [hk.surf(az * .5, 56, -0.008), hk.surf((az + tipaz) / 2, 36, 0.018), hk.surf(tipaz, tipel, 0.014)]
        P.append(hk.clump('Bang', pts, w, .014, sides=8, n=10, taper=.8, flat=.5, bulge=.3))
    for s_ in (-1, 1):
        pts = [hk.surf(s_ * 50, 46, -0.006), hk.surf(s_ * 62, 14, 0.018), hk.surf(s_ * 64, -18, 0.026), hk.surf(s_ * 60, -40, 0.040)]
        P.append(hk.clump('SideLock', pts, .036, .014, sides=8, n=12, taper=.75, flat=.5))
    return P


REN_COL = {
    'skin': ('f2cdb5', 'd8957f'), 'kimono': ('cfd8e4', '8592ab'), 'collar_n': ('222c46', '111727'), 'haori': ('f4f3ef', 'b2b7ca'),
    'haori_in': ('2a3552', '151b2e'), 'hakama': ('2a3450', '141a2d'), 'hakama_d': ('1c2338', '0e1220'), 'obi_r': ('c9a862', '7e6633'),
    'gold': ('dcbc68', '8f6f2c'), 'saya': ('20212c', '0c0c12'), 'blade': ('e4ebf3', '93a0b4'), 'tsuba': ('3a3d4b', '1b1c25'),
    'tsuka': ('20305a', '0f1730'), 'tabi_w': ('f4f4f1', 'b8bccb'), 'zori': ('bf9f6c', '7b6340'), 'strap_n': ('222c46', '111727'),
    'hair': ('26314f', '0e1322'), 'hair_hi': ('5a6f9e', '5a6f9e'), 'hair_tip': ('2c3858', '111628'), 'crescent': ('d8bf6e', '9a7f36'),
    'ink': ('161a28', '161a28'),
}


def ren_painter():
    def paint(p, pos, nor, luv, awake):
        tab = dict(REN_COL)
        n = len(pos)
        x, y, z = pos[:, 0], pos[:, 1], pos[:, 2]
        m = p.mat
        u, v = luv[:, 0], luv[:, 1]
        if m in ('face', 'headback', 'ear'):
            return skin_head_paint(p, pos, nor, luv, tab, lambda x, y, z: 1.742 - 0.07 * smoothstep(0.03, 0.09, np.abs(x)) - 0.09 * smoothstep(-0.02, 0.06, y))
        if m == 'hair':
            r = hair_paint(n, luv, pos, tab, False, tip_from=0.8)
            if p.meta.get('cap'):
                r = {'base': fill(n, C(tab, 'hair')), 'shade': fill(n, C(tab, 'hair', 1))}
            return r
        if m == 'kimono':
            base, shade = fill(n, C(tab, 'kimono')), fill(n, C(tab, 'kimono', 1))
            skin_m = (z > 1.43 - 1.6 * np.maximum(0, .06 - np.abs(x)) * 0) & False
            # V neck: skin inside the crossover, navy collar band along it
            vz = 1.47 - 2.2 * np.abs(x + 0.0)
            neck = (z > vz) & (y < 0.02)
            base[neck] = C(tab, 'skin')
            shade[neck] = C(tab, 'skin', 1)
            band = (np.abs(z - vz) < .012) & (y < .02) & (z < 1.52)
            base[band] = C(tab, 'collar_n')
            shade[band] = C(tab, 'collar_n', 1)
            back_neck = (y >= .02) & (z > 1.49)
            base[back_neck] = C(tab, 'skin')
            shade[back_neck] = C(tab, 'skin', 1)
            ink = cloth_folds(pos, [(1.15, .06, 26)], 1.0, .06) * .4
            return {'base': base, 'shade': shade, 'ink': ink, 'ink_color': hexc('45506a'), 'shadow_extra': neck_shadow(x, y, z)}
        if m == 'ren_arm':
            base, shade = fill(n, C(tab, 'kimono')), fill(n, C(tab, 'kimono', 1))
            sk = v > 0.80
            base[sk] = C(tab, 'skin')
            shade[sk] = C(tab, 'skin', 1)
            return {'base': base, 'shade': shade, 'ink': smoothstep(.012, 0, np.abs(v - .80)) * .6, 'ink_color': hexc('45506a')}
        if m == 'skin_hand':
            return {'base': fill(n, C(tab, 'skin')), 'shade': fill(n, C(tab, 'skin', 1))}
        if m in ('haori', 'haori_in'):
            base, shade = fill(n, C(tab, m)), fill(n, C(tab, m, 1))
            ink = np.zeros(n)
            res = {'base': base, 'shade': shade}
            if m == 'haori':
                if p.meta.get('haori'):
                    # navy hem band + crescent on the back + vertical folds
                    hem = z < 0.66
                    base[hem] = C(tab, 'haori_in')
                    shade[hem] = C(tab, 'haori_in', 1)
                    ink += stripe(u + .01 * np.sin(v * 7), 7, .035) * smoothstep(.45, .95, v) * .5
                    cx, cz = 0.0, 1.27
                    rr = np.sqrt((x - cx) ** 2 + (z - cz) ** 2)
                    rr2 = np.sqrt((x - cx - .045) ** 2 + (z - cz - .02) ** 2)
                    cres = (rr < .105) & (rr2 > .092) & (y > .03)
                    base[cres] = C(tab, 'crescent')
                    shade[cres] = C(tab, 'crescent', 1)
                    ink += smoothstep(.003, 0, np.abs(rr - .105)) * (rr2 > .092) * (y > .03) * .6
                    res['cres'] = cres
                    # small crescents on the front panels
                    for sx in (-1, 1):
                        r3 = np.sqrt((x - sx * .12) ** 2 + (z - 1.33) ** 2)
                        r4 = np.sqrt((x - sx * .12 - .012) ** 2 + (z - 1.336) ** 2)
                        c2 = (r3 < .024) & (r4 > .020) & (y < -.02)
                        base[c2] = C(tab, 'crescent')
                        shade[c2] = C(tab, 'crescent', 1)
                if p.meta.get('sleeve'):
                    cuff = v > .90
                    base[cuff] = C(tab, 'haori_in')
                    shade[cuff] = C(tab, 'haori_in', 1)
                    ink += stripe(v * 1.2 + .15 * np.sin(u * 7), 2, .03) * .3
            res['ink'] = np.clip(ink, 0, 1)
            res['ink_color'] = hexc('7f88a0') if m == 'haori' else hexc('0c1020')
            if awake and 'cres' in res:
                res['over'] = fill(n, hexc('c8f2ff'))
                res['over_a'] = res['cres'] * .55
                res['glow'] = res['cres'] * .7
            res.pop('cres', None)
            return res
        if m in ('hakama', 'hakama_d'):
            base, shade = fill(n, C(tab, m)), fill(n, C(tab, m, 1))
            ang = np.arctan2(y, x - np.sign(x) * .1)
            ink = stripe(ang / (2 * np.pi), 7, .05) * .55 + cloth_folds(pos, [(.12, .08, 30)], 1.0, .05) * .3
            return {'base': base, 'shade': shade, 'ink': np.clip(ink, 0, 1), 'ink_color': hexc('0a0e18')}
        if m == 'blade':
            base, shade = fill(n, C(tab, 'blade')), fill(n, C(tab, 'blade', 1))
            ham = smoothstep(.02, 0, np.abs(u - .25 - .03 * np.sin(v * 60)) - .06)
            res = {'base': base, 'shade': shade, 'over': fill(n, hexc('ffffff')), 'over_a': ham * .8, 'shadow_k': .3}
            if awake:
                res['base'] = base * .5 + hexc('aee9ff') * .5
                res['glow'] = np.ones(n)
            return res
        if m == 'tsuka':
            base, shade = fill(n, C(tab, 'tsuka')), fill(n, C(tab, 'tsuka', 1))
            d = np.abs(((u * 2 + v * 9) % 1) - .5) + np.abs(((u * 2 - v * 9) % 1) - .5)
            dia = d < .35
            base[dia] = hexc('ece8de')
            shade[dia] = hexc('a8a497')
            return {'base': base, 'shade': shade}
        if m == 'saya':
            base, shade = fill(n, C(tab, 'saya')), fill(n, C(tab, 'saya', 1))
            gloss = smoothstep(.04, 0, np.abs(u - .62) - .02)
            return {'base': base, 'shade': shade, 'over': fill(n, hexc('6a6f88')), 'over_a': gloss * .6}
        if m == 'tsuba':
            base, shade = fill(n, C(tab, 'tsuba')), fill(n, C(tab, 'tsuba', 1))
            rim = v > .9
            base[rim] = C(tab, 'gold')
            return {'base': base, 'shade': shade}
        col = tab.get(m, ('ff00ff', '880088'))
        return {'base': fill(n, hexc(col[0])), 'shade': fill(n, hexc(col[1]))}
    return paint


def ren_face(S):
    box = tuple(v * S for v in REN['face_box'])
    st = dict(eye_w=0.043, eye_h=0.034, iris_top='2a3f6a', iris_bot='7fb0e0', iris_ring='1a2340', iris_light='cfe6ff',
              tilt=0.12, wing=0.16, lash_w=0.11, brow_w=0.040, brow_t=0.0048, brow_c='1f2844', mouth_w=0.022,
              ink='171a28', ink_soft='4a4a60', iris_w=0.46, iris_h=0.86)
    ex_, ez = 0.045, 1.664

    def face(panel, ex, awake):
        fc = FA.FaceCanvas(panel, box)
        s = dict(st)
        if not awake:
            mode, brow_a, mouth = {'neutral': ('closed', 0.05, 'line'), 'shout': ('closed', 0.5, 'shout'),
                                   'pain': ('squeeze', -0.4, 'grit'), 'determined': ('closed', 0.45, 'frown')}[ex]
        else:
            s.update(iris_top='9fe6ff', iris_bot='ffffff', iris_ring='5fc8ff', iris_light='ffffff', pupil_c='e8fbff', sclera='eef9ff', pupil=0.25)
            mode, brow_a, mouth = {'neutral': ('open', 0.2, 'line'), 'shout': ('wide', 0.6, 'shout'),
                                   'pain': ('squeeze', -0.4, 'grit'), 'determined': ('glare', 0.55, 'frown')}[ex]
        for side in (-1, 1):
            FA.draw_eye(fc, side * ex_ * S, ez * S, side, s, mode, glow=awake)
            FA.draw_brow(fc, side * 0.047 * S, 1.707 * S, side, s, angle=brow_a)
        FA.draw_nose(fc, 0.003 * S, 1.630 * S, s)
        FA.draw_mouth(fc, 0, 1.597 * S, s, mouth)
        if ex == 'pain':
            FA.sweat(fc, 0.075 * S, 1.69 * S, s)
        return fc.result()
    return face


# ===================================================================== GORO
GORO = dict(
    S=1.2, body_h=1.80,
    hand={'curl': 0.22, 'k': 1.18},
    head={'scale': 1.05, 'jaw_w': 0.092, 'chin_y': -0.060, 'chin_z': 1.560, 'face_y': -0.100, 'cr_r': (0.100, 0.108, 0.102),
          'nose_len': 0.008, 'jaw_ang': 0.70, 'jaw_z': 1.632, 'jaw_h': 0.078, 'chin_w': 0.030, 'side_x': 0.098,
          'ear_k': 1.15, 'ear_x': 0.099},
    face_box=(-0.12, 0.12, 1.53, 1.77),
    ao_cut=(0.44, 0.54),
    notes='Goro Ishigami (authored at 1.2x): shaved head + topknot, sleeveless brown robe, rope belt, prayer beads, rock-textured forearms. Awakened shoulder plates in shoulder_plates.glb.',
)
TORSO_G = [
    (0.850, 0.150, 0.105, 0.115, 2.3, 0.000),
    (0.900, 0.190, 0.125, 0.135, 2.4, 0.004),
    (0.960, 0.200, 0.135, 0.132, 2.4, 0.008),
    (1.030, 0.192, 0.140, 0.120, 2.4, 0.014),
    (1.100, 0.185, 0.142, 0.112, 2.4, 0.016),
    (1.180, 0.190, 0.140, 0.112, 2.5, 0.014),
    (1.260, 0.205, 0.145, 0.116, 2.6, 0.012),
    (1.330, 0.218, 0.146, 0.120, 2.7, 0.008),
    (1.395, 0.226, 0.132, 0.120, 2.7, 0.002),
    (1.440, 0.215, 0.106, 0.110, 2.6, -0.004),
    (1.475, 0.165, 0.082, 0.090, 2.4, -0.006),
    (1.505, 0.092, 0.068, 0.070, 2.1, -0.004),
    (1.530, 0.070, 0.064, 0.062, 2.0, -0.001),
    (1.575, 0.066, 0.060, 0.058, 2.0, 0.004),
    (1.625, 0.060, 0.052, 0.052, 2.0, 0.010),
]
ARM_G = [(t, r * 1.42, f * 1.42, b * 1.40, e, o) for t, r, f, b, e, o in ARM_M]


def goro_arm_pts(sign):
    return [(sign * .150, 0, 1.455), (sign * .200, 0, 1.465), (sign * .240, 0, 1.440), (sign * .31, 0, 1.372),
            (sign * .385, 0, 1.305), (sign * .46, 0, 1.240), (sign * .54, 0, 1.155), (sign * .60, 0, 1.090), (sign * .652, 0, 1.037)]


def rock(name, c, r, S, seed, nu=8, nv=6, flat_under=None, **kw):
    rng = np.random.RandomState(seed)
    d = sphere_grid(nu, nv)
    k = 1 + 0.22 * (rng.rand(nv + 1, nu + 1) - .5)
    k[:, -1] = k[:, 0]
    k[0, :] = k[0, 0]
    k[-1, :] = k[-1, 0]
    P = np.asarray(c) + d * np.asarray(r) * k[..., None]
    g = grid_part(name, P, **kw)
    g.F = orient_faces(g.V, g.F, [np.asarray(c)] * len(g.F))
    g.smooth = False
    return g


def torso_radius_at(table, z, ang, S):
    zz = [k[0] for k in table]
    rs = np.interp(z / S, zz, [k[1] for k in table]) * S
    rf = np.interp(z / S, zz, [k[2] for k in table]) * S
    rb = np.interp(z / S, zz, [k[3] for k in table]) * S
    off = np.interp(z / S, zz, [k[5] for k in table]) * S
    c, s_ = math.sin(ang), math.cos(ang)   # ang 0 = back (+Y)
    ex = 2.5
    cx = math.copysign(abs(c) ** (2 / ex), c)
    sy = math.copysign(abs(s_) ** (2 / ex), s_)
    return np.array([rs * cx, (rb if s_ > 0 else rf) * sy - off, z])


def build_goro(S, segs, hands):
    P = []
    sp = GORO
    head, sdf = build_head(S, sp['head'], sp['face_box'])
    P += head
    P.append(torso_part(S, TORSO_G, mat='g_torso', sides=30))
    for side, sign in [('Left', 1), ('Right', -1)]:
        apts = goro_arm_pts(sign)
        P.append(limb_part(side + 'Arm', S, apts, ARM_G, cands=arm_cands(side), mat='g_arm', sides=22, meta={'side': side}))
        P += hand_parts(side, hands[side], S, mat='g_hand', finger_r=0.0098)
        # wrist cloth wrap
        wk = [(t, r + .004, f + .004, b + .004, e, o) for t, r, f, b, e, o in ARM_G]
        arm = limb_part('tmp', S, apts, wk, n=26, sides=22)
        ring = arm.V.reshape(26, 23, 3)[21:26]
        ww = grid_part(side + 'WristWrap', ring, mat='g_wrap', cands=arm_cands(side), power=7)
        rc = ring.mean(1)
        ww.F = orient_faces(ww.V, ww.F, [rc[min(f) // 23] for f in ww.F])
        P.append(ww)
        # rock chunks on the forearm (outer side)
        C_ = catmull(np.array(apts) * S, 26)
        for k_, (ti, rr) in enumerate([(15, .030), (17, .026), (19, .022), (16, .020)]):
            c = C_[ti]
            T = nrm(C_[ti + 1] - C_[ti - 1])
            out = nrm(np.cross(T, [0, 1.0, 0])) * (1 if sign > 0 else -1)
            up = np.array([0, 0, 1.0])
            dirv = nrm(-out * 0.2 + up * .9 + np.array([0, -.3 if k_ % 2 else .3, 0]))
            pos = c + dirv * (0.045 * S + rr * S * .3)
            P.append(rock(side + 'ForeRock%d' % k_, pos, np.array([rr, rr * .9, rr * .6]) * S, S, 30 + k_ + (sign > 0) * 10,
                          mat='rock', fixed=side + 'ForeArm'))
        # awakened shoulder plates (separate GLB)
        c = np.array([sign * .245, 0.0, 1.495]) * S
        P.append(rock(side + 'ShoulderPlate', c, np.array([.115, .125, .085]) * S, S, 77 + (sign > 0), nu=10, nv=7,
                      mat='rock_plate', group='ShoulderPlates', cands=[side + 'Shoulder', side + 'Arm'], power=3))
        P.append(rock(side + 'ShoulderPlate2', c + np.array([sign * .07, .0, -.06]) * S, np.array([.075, .095, .06]) * S, S, 88 + (sign > 0), nu=8, nv=6,
                      mat='rock_plate', group='ShoulderPlates', cands=[side + 'Arm'], power=3))
        # trousers + shin wraps + sandals
        lk = [(0, .118, .115, .125, 2, 0), (.12, .124, .120, .130, 2, 0), (.30, .108, .104, .110, 2, 0), (.50, .082, .082, .084, 2, 0),
              (.62, .080, .080, .086, 2, 0), (.85, .060, .060, .062, 2, 0), (1, .058, .058, .058, 2, 0)]
        lp = [(sign * .085, 0, 1.0), (sign * .108, 0, .92), (sign * .122, 0, .75), (sign * .132, 0, .53), (sign * .139, 0, .33), (sign * .145, 0, .12), (sign * .146, 0, .07)]
        P.append(limb_part(side + 'Leg', S, lp, lk, sides=20, mat='pants', cands=leg_cands(side), n=28, power=6, meta={'side': side}))
        wk = [(0, .064, .064, .066, 2, 0), (.4, .078, .078, .086, 2, 0), (.8, .080, .080, .088, 2, 0), (1, .074, .074, .080, 2, 0)]
        P.append(limb_part(side + 'ShinWrap', S, [(sign * .145, 0, .10), (sign * .141, 0, .24), (sign * .138, 0, .36)], wk, sides=20, n=10,
                           mat='g_wrap', cands=leg_cands(side), power=6))
        P += shoe_parts(sign, S, top='footwrap', sole='straw', h=0.95, wide=1.1, name='Foot')
    # robe skirt (wraps the hips, slit at the front) with thickness
    rows, cols = 12, 34
    G = np.zeros((rows, cols, 3))
    for i in range(rows):
        t = i / (rows - 1)
        z = (1.06 - 0.56 * t) * S
        for j in range(cols):
            ang = math.radians(-166 + 332 * j / (cols - 1))
            p0 = torso_radius_at(TORSO_G, max(z, 0.93 * S), ang, S)
            fl = 1 + 0.08 + 0.42 * t ** 0.9
            G[i, j] = (p0[0] * fl, p0[1] * fl, z)
    for q in shell('RobeSkirt', G, 0.007 * S, outward=np.array([0, 0, 1.0 * S]), mat='robe', inner_mat='robe_in',
                   cands=['Hips', 'LeftUpLeg', 'RightUpLeg'], power=2.5, meta={'skirt': True}):
        P.append(q)
    # rope belt + knot + hanging ends
    ring = np.array([torso_radius_at(TORSO_G, 1.05 * S, math.radians(a_), S) * np.array([1.08, 1.08, 1]) for a_ in np.linspace(0, 360, 41)])
    P.append(closed_loft('RopeBelt', ring, lambda t: (.026 * S, .020 * S, .016 * S, 2.0, 0), sides=10, mat='rope', cands=['Hips', 'Spine'], power=4))
    kc = torso_radius_at(TORSO_G, 1.05 * S, math.radians(180), S) * np.array([1, 1.12, 1])
    P.append(blob('RopeKnot', kc, np.array([.042, .026, .034]) * S, mat='rope', fixed='Hips'))
    for sgn in (-1, 1):
        pts = [kc + np.array([sgn * .02, -.01, -.01]) * S, kc + np.array([sgn * .05, -.03, -.12]) * S, kc + np.array([sgn * .06, -.03, -.26]) * S]
        P.append(loft('RopeEnd', catmull(pts, 10), lambda t: ((.014 if t < .85 else .022) * S, .014 * S, .014 * S, 2, 0), sides=8,
                      hint=(0, -1, 0), frames='hint', cap1=True, mat='rope', cands=['Hips', 'LeftUpLeg' if sgn > 0 else 'RightUpLeg'], power=3))
    # prayer beads around the neck, resting on the chest
    nb = 19
    for k_ in range(nb):
        ang = 2 * math.pi * k_ / nb
        zf = 1.47 - 0.16 * max(0, -math.cos(ang)) ** 1.6
        p0 = torso_radius_at(TORSO_G, zf * S, ang, S)
        out = nrm(np.array([p0[0], p0[1], 0]))
        br = (.030 if k_ else .040) * S
        c = p0 + out * br * .9
        P.append(blob('Bead', c, np.array([br, br, br]), nu=8, nv=6, mat='bead' if k_ else 'bead_big', cands=['Spine2', 'Spine1', 'Neck'], power=4))
    pc = torso_radius_at(TORSO_G, 1.27 * S, math.radians(180), S) + np.array([0, -.035, 0]) * S
    P.append(loft('Tassel', catmull([pc, pc + np.array([0, -.01, -.09]) * S], 6), lambda t: (.012 * S * (1 + 1.4 * t), .012 * S * (1 + 1.4 * t), .012 * S * (1 + 1.4 * t), 2, 0),
                  sides=10, hint=(0, -1, 0), frames='hint', cap1=True, mat='tassel', cands=['Spine1', 'Spine2'], power=4))
    # topknot
    hk = HairKit(sdf, S)
    top = hk.surf(180, 64, 0.02)
    P.append(blob('Topknot', top + np.array([0, .005, .025]) * S, np.array([.040, .044, .040]) * S, nu=12, nv=8, mat='g_hair', fixed='Hair_01'))
    P.append(loft('TopknotTie', [top + np.array([0, .004, -.005]) * S, top + np.array([0, .004, .012]) * S], lambda t: (.026 * S, .026 * S, .026 * S, 2, 0),
                  sides=12, hint=(0, -1, 0), frames='hint', mat='cord', fixed='Hair_01'))
    for sgn in (-1, 1):
        pts = [top + np.array([sgn * .02, .03, .0]) * S, top + np.array([sgn * .04, .07, -.04]) * S, top + np.array([sgn * .05, .085, -.09]) * S]
        P.append(loft('TieTail', catmull(pts, 8), lambda t: (.007 * S, .003 * S, .003 * S, 2, 0), sides=6, hint=(0, 1, 0), frames='hint',
                      mat='cord', fixed='Hair_01'))
    return P


GORO_COL = {
    'skin': ('dba981', 'bb7d5f'), 'robe': ('7c5638', '4a3120'), 'robe_in': ('5a3c26', '35231a'), 'trim': ('3f2a1d', '24170f'),
    'rope': ('d3b47c', '8f7442'), 'bead': ('4a3426', '24170f'), 'bead_big': ('d9a441', '8f6a20'), 'tassel': ('b8392f', '6e1e18'),
    'pants': ('cbbd9c', '8e7f62'), 'g_wrap': ('6a523e', '3d2e22'), 'footwrap': ('5b4636', '33271d'), 'straw': ('cdb27a', '8a7348'),
    'rock': ('a39a8c', '655d52'), 'rock_plate': ('9c9384', '5e574d'), 'g_hair': ('2a2626', '121010'), 'cord': ('b8392f', '6e1e18'),
    'ink': ('1e1814', '1e1814'),
}


def voronoi_rock(pos, S, scale=40.0, seed=3):
    """Returns (crack_line, cell_val) for a stone-plate pattern on world positions."""
    rng = np.random.RandomState(seed)
    p = pos / S * scale
    i = np.floor(p).astype(np.int64)
    best1 = np.full(len(p), 9.0)
    best2 = np.full(len(p), 9.0)
    val = np.zeros(len(p))
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                c = i + np.array([dx, dy, dz])
                h = np.stack([_h3(c, 1), _h3(c, 2), _h3(c, 3)], -1)
                fp = c + h
                d = np.linalg.norm(p - fp, axis=1)
                v = _h3(c, 4)
                closer = d < best1
                best2 = np.where(closer, best1, np.minimum(best2, d))
                val = np.where(closer, v, val)
                best1 = np.where(closer, d, best1)
    return best2 - best1, val


def _h3(c, s):
    h = (c[:, 0] * 73856093 ^ c[:, 1] * 19349663 ^ c[:, 2] * 83492791 ^ (s * 2654435761)) & 0xFFFFFFFF
    h = ((h ^ (h >> 15)) * 2246822519) & 0xFFFFFFFF
    return (h & 0xFFFF) / 65535.0


def goro_painter():
    S = GORO['S']

    def rock_layer(pos, base, shade, awake, mask):
        edge, val = voronoi_rock(pos, S, 24.0)
        rc = hexc('a39a8c') * (0.86 + 0.26 * val[:, None])
        base = np.where(mask[:, None], rc, base)
        shade = np.where(mask[:, None], hexc('655d52') * (0.86 + 0.26 * val[:, None]), shade)
        crack = smoothstep(0.07, 0.025, edge) * mask
        return base, shade, crack

    def paint(p, pos, nor, luv, awake):
        tab = dict(GORO_COL)
        n = len(pos)
        x, y, z = pos[:, 0] / S, pos[:, 1] / S, pos[:, 2] / S
        m = p.mat
        u, v = luv[:, 0], luv[:, 1]
        if m in ('face', 'headback', 'ear'):
            r = skin_head_paint(p, pos / S, nor, luv, tab, None)
            # shaved scalp: faint cool stubble tone over the cranium
            scalp = smoothstep(1.735, 1.75, z) * (1 - smoothstep(-0.02, -0.08, y) * smoothstep(1.76, 1.74, z))
            scalp = np.maximum(scalp, smoothstep(0.0, 0.04, y) * smoothstep(1.62, 1.66, z))
            r['base'] = r['base'] * (1 - scalp[:, None] * .35) + hexc('9a8f8a') * scalp[:, None] * .35
            return r
        if m == 'g_torso':
            skin, skin_s = C(tab, 'skin'), C(tab, 'skin', 1)
            base, shade = fill(n, C(tab, 'robe')), fill(n, C(tab, 'robe', 1))
            ax = np.abs(x)
            vz = 1.47 - 1.9 * ax           # V neck crossover
            neck = (z > vz) & (y < 0.03)
            arm_hole = (ax > 0.175) & (z > 1.30 - (ax - .175) * 2)
            shoulder = (z > 1.43) & (ax > 0.12)
            skin_m = neck | arm_hole | shoulder | ((y >= .03) & (z > 1.47))
            base[skin_m] = skin
            shade[skin_m] = skin_s
            ink = np.zeros(n)
            trim = ((np.abs(z - vz) < .016) & (y < .03) & ~arm_hole & ~shoulder) | ((np.abs(ax - .175 - (1.30 - z) / -2) < 0.012) & (z > 1.24) & ~skin_m)
            base[trim & ~skin_m] = C(tab, 'trim')
            shade[trim & ~skin_m] = C(tab, 'trim', 1)
            ink += cloth_folds(pos, [(1.12, .06, 22)], S, .06) * .4 * ~skin_m
            # pecs / abs hint lines visible in the V
            pec = smoothstep(.004, .0, np.abs(z - (1.34 + 0.25 * (ax - .06) ** 2 * 20))) * (ax < .1) * (ax > .015) * neck
            ink += pec * .5
            res = {'base': base, 'shade': shade, 'ink': ink, 'ink_color': hexc('3a2418'), 'shadow_extra': neck_shadow(pos[:, 0], pos[:, 1], pos[:, 2], S),
                   'shadow_k': 1 - 0.85 * smoothstep(.12, .16, ax) * smoothstep(1.33, 1.38, z)}
            if awake:
                rm = (ax > .15) & (z > 1.30)
                b2, s2, crack = rock_layer(pos, res['base'], res['shade'], awake, rm)
                res['base'], res['shade'] = b2, s2
                res['over'] = fill(n, hexc('ffb347'))
                res['over_a'] = crack
                res['glow'] = crack
            return res
        if m in ('g_arm', 'g_hand'):
            base, shade = fill(n, C(tab, 'skin')), fill(n, C(tab, 'skin', 1))
            ax = np.abs(x)
            lim = 0.47 if not awake else 0.30
            rm = (ax > lim) & (ax < 0.64) & (m == 'g_arm')
            # stone patches thin out toward the elbow (noise edge)
            edge_n = fbm(pos / S, 18, 7, 2)
            rm = rm & ((ax - lim) * 9 + edge_n * .8 > .5)
            b2, s2, crack = rock_layer(pos, base, shade, awake, rm)
            res = {'base': b2, 'shade': s2, 'ink': crack * (0.9 if not awake else 0), 'ink_color': hexc('2e3038'),
                   'shadow_k': (0.25 + 0.75 * smoothstep(0.10, 0.22, v)) if m == 'g_arm' else 1.0}
            if awake:
                res['over'] = fill(n, hexc('ffb347'))
                res['over_a'] = crack
                res['glow'] = crack
            return res
        if m in ('rock', 'rock_plate'):
            base, shade = fill(n, C(tab, m)), fill(n, C(tab, m, 1))
            b2, s2, crack = rock_layer(pos, base, shade, awake, np.ones(n, bool))
            res = {'base': b2, 'shade': s2, 'ink': crack * .9, 'ink_color': hexc('2e3038')}
            if awake or m == 'rock_plate':
                res['over'] = fill(n, hexc('ffb347'))
                res['over_a'] = crack
                res['glow'] = crack
            return res
        if m in ('robe', 'robe_in'):
            base, shade = fill(n, C(tab, m)), fill(n, C(tab, m, 1))
            ink = stripe(u + .012 * np.sin(v * 8), 11, .03) * smoothstep(.15, .9, v) * .5
            if m == 'robe':
                hem = v > .9
                base[hem] = C(tab, 'trim')
                shade[hem] = C(tab, 'trim', 1)
                edge = (u < .025) | (u > .975)
                base[edge] = C(tab, 'trim')
            return {'base': base, 'shade': shade, 'ink': ink, 'ink_color': hexc('2c1c12')}
        if m == 'rope':
            base, shade = fill(n, C(tab, 'rope')), fill(n, C(tab, 'rope', 1))
            ink = stripe(u * 1 + v * 14, 1, .18) * .55
            return {'base': base, 'shade': shade, 'ink': ink, 'ink_color': hexc('6e5630')}
        if m in ('g_wrap', 'footwrap'):
            base, shade = fill(n, C(tab, m)), fill(n, C(tab, m, 1))
            ink = stripe(z + np.arctan2(y, x) * .003, 45, .12) * .5
            return {'base': base, 'shade': shade, 'ink': ink, 'ink_color': hexc('2a1e15')}
        if m == 'straw':
            base, shade = fill(n, C(tab, 'straw')), fill(n, C(tab, 'straw', 1))
            return {'base': base, 'shade': shade, 'ink': stripe(y, 120, .2) * .4, 'ink_color': hexc('8a7348')}
        if m == 'pants':
            base, shade = fill(n, C(tab, 'pants')), fill(n, C(tab, 'pants', 1))
            ink = cloth_folds(pos, [(.53, .06, 28), (.30, .06, 30)], S, .07) * .5
            return {'base': base, 'shade': shade, 'ink': ink, 'ink_color': hexc('6e6048')}
        if m in ('bead', 'bead_big'):
            base, shade = fill(n, C(tab, m)), fill(n, C(tab, m, 1))
            hl = smoothstep(.15, .05, np.abs(u - .55) + np.abs(v - .7))
            return {'base': base, 'shade': shade, 'over': fill(n, hexc('ffffff')), 'over_a': hl * .45}
        col = tab.get(m, ('ff00ff', '880088'))
        return {'base': fill(n, hexc(col[0])), 'shade': fill(n, hexc(col[1]))}
    return paint


def goro_face(S):
    box = tuple(v * S for v in GORO['face_box'])
    st = dict(eye_w=0.036, eye_h=0.028, iris_top='3a2414', iris_bot='b07a3e', iris_ring='241408', iris_light='e8c08a',
              tilt=-0.02, wing=0.06, lash_w=0.10, brow_w=0.046, brow_t=0.0095, brow_c='2a221e', mouth_w=0.032,
              ink='1e1814', ink_soft='5a3a2a', iris_w=0.56, iris_h=0.95, nose_w=0.018, nose_c='9a6a50', crease=True)
    for k_ in ('eye_w', 'eye_h', 'brow_w', 'brow_t', 'mouth_w', 'nose_w'):
        st[k_] *= S
    ex_, ez = 0.046, 1.664

    def face(panel, ex, awake):
        fc = FA.FaceCanvas(panel, box)
        s = dict(st)
        if awake:
            s.update(iris_top='a8580c', iris_bot='ffe08a', iris_light='ffffff', iris_ring='7a3a06')
        mode, brow_a, brow_r, mouth = {'neutral': ('open', -0.20, 0.0, 'smile'), 'shout': ('wide', 0.65, 0.002, 'roar'),
                                       'pain': ('squeeze', -0.5, 0.003, 'grit'), 'determined': ('narrow', 0.55, -0.003, 'frown')}[ex]
        for side in (-1, 1):
            FA.draw_eye(fc, side * ex_ * S, ez * S, side, s, mode, glow=awake)
            FA.draw_brow(fc, side * 0.049 * S, 1.704 * S, side, s, angle=brow_a, raise_=brow_r * S)
        FA.draw_nose(fc, 0.004 * S, 1.628 * S, s)
        FA.draw_mouth(fc, 0, 1.595 * S, s, mouth)
        if ex == 'neutral':
            FA.blush(fc, 0.066 * S, 1.632 * S, 1, s, 0.18)
            FA.blush(fc, -0.066 * S, 1.632 * S, -1, s, 0.18)
        if ex == 'pain':
            FA.sweat(fc, 0.078 * S, 1.69 * S, s)
        return fc.result()
    return face


# ===================================================================== registry
SPECS = {'kaito': KAITO, 'shiori': SHIORI, 'ren': REN, 'goro': GORO}
BUILDERS = {'kaito': build_kaito, 'shiori': build_shiori, 'ren': build_ren, 'goro': build_goro}
PAINTERS = {'kaito': kaito_painter, 'shiori': shiori_painter, 'ren': ren_painter, 'goro': goro_painter}
FACES = {'kaito': kaito_face, 'shiori': shiori_face, 'ren': ren_face, 'goro': goro_face}


def build(kind, S, segs, hands):
    return BUILDERS[kind](S, segs, hands)


def painter(kind):
    return PAINTERS[kind]()


def face_painter(kind, S):
    return FACES[kind](S)
