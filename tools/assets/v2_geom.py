"""KAKUSEI ARENA v2 character pipeline: pure numpy geometry, weights, UV packing,
rasterisation and paint helpers. No Blender imports here.
Coordinates: Blender metres, Z up, character faces -Y.
"""
import math
import numpy as np

ATLAS = 2048
FACE_ROW = 512          # top PNG row band holds 4 face/expression panels of 512x512
PANEL = 512
EXPRESSIONS = ['neutral', 'shout', 'pain', 'determined']


# ----------------------------------------------------------------- small math
def nrm(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def catmull(points, n):
    """Resample a polyline with Catmull-Rom into n points (uniform in parameter)."""
    P = np.asarray(points, float)
    if len(P) == 2:
        return np.array([P[0] + (P[1] - P[0]) * t for t in np.linspace(0, 1, n)])
    P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    seg = len(P) - 3
    out = []
    for t in np.linspace(0, seg, n):
        i = min(int(t), seg - 1)
        u = t - i
        p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[i + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return np.array(out)


def interp_keys(keys, t):
    """keys: list of (t, value-or-tuple) sorted; smooth (cosine) interpolation."""
    ts = [k[0] for k in keys]
    vals = [np.atleast_1d(np.asarray(k[1], float)) for k in keys]
    if t <= ts[0]:
        return vals[0]
    if t >= ts[-1]:
        return vals[-1]
    for i in range(len(ts) - 1):
        if ts[i] <= t <= ts[i + 1]:
            u = (t - ts[i]) / (ts[i + 1] - ts[i])
            # Catmull-like smoothing using neighbours for C1 continuity
            v0 = vals[max(i - 1, 0)]
            v1, v2 = vals[i], vals[i + 1]
            v3 = vals[min(i + 2, len(vals) - 1)]
            return 0.5 * ((2 * v1) + (-v0 + v2) * u + (2 * v0 - 5 * v1 + 4 * v2 - v3) * u * u
                          + (-v0 + 3 * v1 - 3 * v2 + v3) * u ** 3)


def rmf(centers, hint):
    """Rotation-minimising frames. Returns tangents T, side S, front F (each (n,3)).
    hint: initial 'front' direction (F)."""
    C = np.asarray(centers, float)
    n = len(C)
    T = np.zeros_like(C)
    for i in range(n):
        a = C[max(i - 1, 0)]
        b = C[min(i + 1, n - 1)]
        T[i] = b - a
    T = nrm(T)
    F = np.zeros_like(C)
    f = np.asarray(hint, float)
    f = f - T[0] * np.dot(f, T[0])
    if np.linalg.norm(f) < 1e-6:
        f = np.cross(T[0], [1, 0, 0])
    F[0] = nrm(f)
    for i in range(1, n):
        # double reflection method
        v1 = C[i] - C[i - 1]
        c1 = np.dot(v1, v1)
        if c1 < 1e-14:
            F[i] = F[i - 1]
            continue
        rL = F[i - 1] - (2 / c1) * np.dot(v1, F[i - 1]) * v1
        tL = T[i - 1] - (2 / c1) * np.dot(v1, T[i - 1]) * v1
        v2 = T[i] - tL
        c2 = np.dot(v2, v2)
        F[i] = rL - (2 / c2) * np.dot(v2, rL) * v2 if c2 > 1e-14 else rL
        F[i] = nrm(F[i] - T[i] * np.dot(F[i], T[i]))
    S = nrm(np.cross(T, F))
    return T, S, F


def hint_frames(centers, hint):
    """Frames where F follows a fixed hint direction (projected), no twist accumulation."""
    C = np.asarray(centers, float)
    n = len(C)
    T = np.zeros_like(C)
    for i in range(n):
        T[i] = C[min(i + 1, n - 1)] - C[max(i - 1, 0)]
    T = nrm(T)
    H = np.asarray(hint, float)
    if H.ndim == 1:
        H = np.tile(H, (n, 1))
    F = nrm(H - T * np.sum(H * T, axis=1, keepdims=True))
    S = nrm(np.cross(T, F))
    return T, S, F


# ----------------------------------------------------------------- parts
class Part:
    """A mesh piece. V (n,3), faces list of index tuples, uv (n,2) local [0,1] island coords
    (or absolute atlas UV if abs_uv), size (w_m, h_m) for packing."""

    def __init__(self, name, V, F, uv, size=(0.1, 0.1), mat='skin', group='Fighter',
                 cands=None, power=6.0, fixed=None, density=1.0, abs_uv=False,
                 normals=None, meta=None, bake=True, smooth=True):
        self.name = name
        self.V = np.asarray(V, float)
        self.F = [tuple(int(i) for i in f) for f in F]
        self.uv = np.asarray(uv, float)
        self.size = size
        self.mat = mat
        self.group = group
        self.cands = cands
        self.power = power
        self.fixed = fixed
        self.density = density
        self.abs_uv = abs_uv
        self.normals = normals
        self.meta = meta or {}
        self.bake = bake
        self.smooth = smooth
        self.rect = None
        self.weights = None   # list of dict per vertex


def orient_faces(V, F, refs):
    """Flip each face so its normal points away from its inside reference point."""
    out = []
    for f, r in zip(F, refs):
        p = V[list(f)]
        c = p.mean(0)
        nn = np.zeros(3)
        for k in range(1, len(f) - 1):
            nn += np.cross(p[k] - p[0], p[k + 1] - p[0])
        out.append(tuple(reversed(f)) if np.dot(nn, c - r) < 0 else tuple(f))
    return out


def loft(name, centers, prof, sides=12, hint=(0, -1, 0), frames='rmf', cap0=False, cap1=False,
         n=None, u0=0.0, close_tip=False, **kw):
    """Loft a tube. prof(t, theta) -> radius or prof(t) -> (rs, rf, rb[, exp]).
    theta measured so u=0 is back (-F), u=0.5 front (+F), u=0.25 is +S.
    Returns Part. Duplicates the seam column for clean UVs."""
    C = catmull(centers, n) if n else np.asarray(centers, float)
    m = len(C)
    T, S, Fv = (rmf(C, hint) if frames == 'rmf' else hint_frames(C, hint))
    seglen = np.r_[0, np.cumsum(np.linalg.norm(np.diff(C, axis=0), axis=1))]
    L = seglen[-1] if seglen[-1] > 0 else 1
    tt = seglen / L
    V, UV = [], []
    circ = 0
    for i in range(m):
        t = tt[i]
        r = prof(t)
        rs, rf, rb = r[0], r[1], r[2]
        ex = r[3] if len(r) > 3 else 2.0
        off = r[4] if len(r) > 4 else 0.0     # offset along F
        ring = []
        for k in range(sides + 1):
            u = (k / sides + u0) % 1.0 if k < sides else (u0 % 1.0) + 1.0
            th = 2 * math.pi * (k / sides + u0) - math.pi / 2
            c, s = math.cos(th), math.sin(th)
            cx = math.copysign(abs(c) ** (2 / ex), c)
            sy = math.copysign(abs(s) ** (2 / ex), s)
            ry = rf if s > 0 else rb
            p = C[i] + rs * cx * S[i] + (ry * sy + off) * Fv[i]
            V.append(p)
            UV.append((k / sides, t))
        if i == m // 2:
            pts = np.array(V[-(sides + 1):])
            circ = np.sum(np.linalg.norm(np.diff(pts, axis=0), axis=1))
    F = []
    W = sides + 1
    for i in range(m - 1):
        for k in range(sides):
            a = i * W + k
            F.append((a, a + 1, a + 1 + W, a + W))
    V = list(V)
    if cap0 or close_tip == 'start':
        ci = len(V)
        V.append(C[0] - T[0] * (0.0 if not isinstance(cap0, float) else cap0))
        UV.append((0.5, 0.0))
        for k in range(sides):
            F.append((k + 1, k, ci))
    if cap1:
        ci = len(V)
        V.append(C[-1] + T[-1] * (0.0 if not isinstance(cap1, float) else cap1))
        UV.append((0.5, 1.0))
        b = (m - 1) * W
        for k in range(sides):
            F.append((b + k, b + k + 1, ci))
    size = kw.pop('size', (max(circ, 0.01), max(L, 0.01)))
    V = np.array(V)
    refs = []
    nt = (m - 1) * sides
    for fi, f in enumerate(F):
        if fi < nt:
            i = fi // sides
            refs.append((C[i] + C[i + 1]) / 2)
        elif cap0 and fi < nt + sides:
            refs.append(C[min(1, m - 1)])
        else:
            refs.append(C[max(m - 2, 0)])
    F = orient_faces(V, F, refs)
    return Part(name, V, F, np.array(UV), size=size, **kw)


def grid_part(name, P, uv=None, closed_u=False, size=None, **kw):
    """P: (rows, cols, 3) grid -> quad part. uv default from indices."""
    P = np.asarray(P, float)
    R, Cc = P.shape[:2]
    V = P.reshape(-1, 3)
    if uv is None:
        uu, vv = np.meshgrid(np.linspace(0, 1, Cc), np.linspace(0, 1, R))
        uv = np.stack([uu, vv], -1).reshape(-1, 2)
    F = []
    for i in range(R - 1):
        for j in range(Cc - 1):
            a = i * Cc + j
            F.append((a, a + 1, a + 1 + Cc, a + Cc))
    if size is None:
        w = np.mean(np.sum(np.linalg.norm(np.diff(P, axis=1), axis=2), axis=1))
        h = np.mean(np.sum(np.linalg.norm(np.diff(P, axis=0), axis=2), axis=0))
        size = (max(w, .01), max(h, .01))
    return Part(name, V, F, uv, size=size, **kw)


def shell(name, P, thick, outward=None, mat='cloth', inner_mat=None, rim_mat=None, **kw):
    """Open surface grid (rows, cols, 3) -> list of Parts: outer, inner (offset -normal), rim.
    Gives cloth visible thickness with separate islands for lining."""
    P = np.asarray(P, float)
    R, Cc = P.shape[:2]
    # grid normals
    du = np.gradient(P, axis=1)
    dv = np.gradient(P, axis=0)
    N = nrm(np.cross(du, dv))
    if outward is not None:
        # orient so normals point away from 'outward' reference axis point
        ref = np.asarray(outward, float)
        d = P - (ref[:, None, :] if ref.ndim == 2 else ref)
        if np.sum(np.sum(N * d, axis=-1)) < 0:
            N = -N
    Pin = P - N * thick
    outer = grid_part(name, P, mat=mat, **kw)
    inner = grid_part(name + '_In', Pin, mat=inner_mat or mat, **kw)
    Nf = N.reshape(-1, 3)
    outer.F = orient_faces(outer.V, outer.F, [outer.V[list(f)].mean(0) - Nf[list(f)].mean(0) for f in outer.F])
    inner.F = orient_faces(inner.V, inner.F, [inner.V[list(f)].mean(0) + Nf[list(f)].mean(0) for f in inner.F])
    # rim around the boundary
    idx = ([(0, j) for j in range(Cc)] + [(i, Cc - 1) for i in range(1, R)]
           + [(R - 1, j) for j in range(Cc - 2, -1, -1)] + [(i, 0) for i in range(R - 2, 0, -1)])
    if kw.get('closed_u'):
        idx = [(R - 1, j) for j in range(Cc)]
        idx2 = [(0, j) for j in range(Cc)]
    ring_o = np.array([P[i, j] for i, j in idx])
    ring_i = np.array([Pin[i, j] for i, j in idx])
    rimP = np.stack([ring_o, ring_i], 0)
    kw2 = dict(kw)
    kw2.pop('closed_u', None)
    rim = grid_part(name + '_Rim', rimP, mat=rim_mat or inner_mat or mat, **kw2)
    rim.size = (max(rim.size[0], .01), 0.012)
    # rim faces must point away from the cloth interior (next grid point inwards)
    cen = P.reshape(-1, 3).mean(0)
    inward = []
    for (i, j) in idx:
        ii = min(max(i, 1), R - 2) if R > 2 else i
        jj = min(max(j, 1), Cc - 2) if Cc > 2 else j
        inward.append(P[ii, jj] if (ii, jj) != (i, j) else cen)
    nrim = len(idx)
    refs = []
    for f in rim.F:
        col = min(f) % nrim
        refs.append(inward[col])
    rim.F = orient_faces(rim.V, rim.F, refs)
    return [outer, inner, rim]


# ----------------------------------------------------------------- SDF helpers
def sd_ellipsoid(p, c, r):
    q = (p - np.asarray(c)) / np.asarray(r)
    k0 = np.linalg.norm(q, axis=-1)
    k1 = np.linalg.norm(q / np.asarray(r), axis=-1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def sd_capsule(p, a, b, r):
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    pa = p - a
    ba = b - a
    h = np.clip(np.sum(pa * ba, -1) / np.dot(ba, ba), 0, 1)
    return np.linalg.norm(pa - ba * h[..., None], axis=-1) - (r if np.isscalar(r) else (r[0] + (r[1] - r[0]) * h))


def sd_plane(p, point, normal):
    n = nrm(np.asarray(normal, float))
    return np.sum((p - np.asarray(point)) * n, -1)


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def radial_surface(sdf, center, dirs, rmax=0.4):
    """Bisection along rays from center; returns surface points (n,3)."""
    c = np.asarray(center, float)
    lo = np.zeros(len(dirs))
    hi = np.full(len(dirs), rmax)
    for _ in range(34):
        mid = (lo + hi) / 2
        inside = sdf(c + dirs * mid[:, None]) < 0
        lo = np.where(inside, mid, lo)
        hi = np.where(inside, hi, mid)
    return c + dirs * lo[:, None]


def sphere_grid(nu, nv, z_bias=None):
    """Lat-long directions grid (nv+1 rows from bottom to top, nu+1 cols with seam dup)."""
    rows = []
    for i in range(nv + 1):
        a = i / nv
        if z_bias:
            a = z_bias(a)
        phi = -math.pi / 2 + math.pi * a
        row = []
        for j in range(nu + 1):
            th = 2 * math.pi * j / nu + math.pi / 2  # j=0 at back (+Y)
            row.append((math.cos(phi) * math.cos(th), math.cos(phi) * math.sin(th), math.sin(phi)))
        rows.append(row)
    return np.array(rows)


# ----------------------------------------------------------------- normals
def compute_normals(V, F):
    V = np.asarray(V, float)
    N = np.zeros_like(V)
    for f in F:
        p0 = V[f[0]]
        for k in range(1, len(f) - 1):
            fn = np.cross(V[f[k]] - p0, V[f[k + 1]] - p0)
            for idx in (f[0], f[k], f[k + 1]):
                N[idx] += fn
    # weld by position
    key = np.round(V / 1e-5).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    acc = np.zeros((inv.max() + 1, 3))
    np.add.at(acc, inv, N)
    return nrm(acc[inv])


# ----------------------------------------------------------------- weights
def seg_dist(P, a, b):
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    ba = b - a
    h = np.clip(np.sum((P - a) * ba, -1) / max(np.dot(ba, ba), 1e-12), 0, 1)
    return np.linalg.norm(P - (a + ba * h[:, None]), axis=-1)


def compute_weights(part, segs):
    """segs: bone -> (head, tail) used as weighting segments. part.cands: list of bone names or
    (name, a, b) overrides. Returns list of dicts."""
    P = part.V
    if part.fixed:
        if isinstance(part.fixed, str):
            return [{part.fixed: 1.0} for _ in range(len(P))]
        return part.fixed(P)
    names, D = [], []
    for c in part.cands:
        if isinstance(c, tuple):
            nm, a, b = c
        else:
            nm = c
            a, b = segs[c]
        names.append(nm)
        D.append(seg_dist(P, a, b))
    D = np.maximum(np.array(D), 1e-4)
    W = 1.0 / D ** part.power
    W /= W.sum(0, keepdims=True)
    out = []
    for i in range(len(P)):
        order = np.argsort(-W[:, i])[:4]
        w = {names[j]: W[j, i] for j in order if W[j, i] > 0.015}
        s = sum(w.values())
        out.append({k: v / s for k, v in w.items()})
    return out


# ----------------------------------------------------------------- packing
def pack(parts, region=(0, FACE_ROW, ATLAS, ATLAS), pad=4):
    """Shelf pack non-abs parts into region (x0, y0, x1, y1) in PNG pixel coords."""
    todo = [p for p in parts if not p.abs_uv]
    area = sum(p.size[0] * p.size[1] * p.density ** 2 for p in todo)
    avail = (region[2] - region[0]) * (region[3] - region[1])
    D = math.sqrt(avail * 0.80 / area)
    for _ in range(60):
        ok = True
        rects = {}
        x, y, rowh = region[0], region[1], 0
        order = sorted(todo, key=lambda p: -(p.size[1] * D * p.density))
        for p in order:
            w = int(math.ceil(p.size[0] * D * p.density)) + 2 * pad
            h = int(math.ceil(p.size[1] * D * p.density)) + 2 * pad
            w = min(max(w, 10), region[2] - region[0])
            h = min(max(h, 10), region[3] - region[1])
            if x + w > region[2]:
                x, y, rowh = region[0], y + rowh, 0
            if y + h > region[3]:
                ok = False
                break
            rects[id(p)] = (x, y, w, h)
            x += w
            rowh = max(rowh, h)
        if ok:
            for p in todo:
                p.rect = rects[id(p)]
            return D
        D *= 0.96
    raise RuntimeError('packing failed')


def atlas_uv(part, pad=4):
    """Convert part local uv to Blender atlas UV (v up)."""
    if part.abs_uv:
        return part.uv.copy()
    x, y, w, h = part.rect
    px = x + pad + part.uv[:, 0] * (w - 2 * pad)
    py = y + pad + (1 - part.uv[:, 1]) * (h - 2 * pad)
    return np.stack([px / ATLAS, 1 - py / ATLAS], -1)


# ----------------------------------------------------------------- rasteriser
def rasterize(parts, size=ATLAS):
    """Rasterise all parts into UV space. Returns pos (H,W,3), nrm (H,W,3), pid (H,W) (-1 empty),
    luv (H,W,2) local island uv (interpolated)."""
    H = W = size
    pos = np.zeros((H, W, 3), np.float32)
    nor = np.zeros((H, W, 3), np.float32)
    luv = np.zeros((H, W, 2), np.float32)
    pid = np.full((H, W), -1, np.int32)
    for pi, p in enumerate(parts):
        A = atlas_uv(p)
        X = A[:, 0] * size
        Y = (1 - A[:, 1]) * size
        N = p.normals
        for f in p.F:
            for k in range(1, len(f) - 1):
                tri = (f[0], f[k], f[k + 1])
                xs = X[list(tri)]
                ys = Y[list(tri)]
                x0, x1 = int(max(math.floor(xs.min()) - 1, 0)), int(min(math.ceil(xs.max()) + 1, W - 1))
                y0, y1 = int(max(math.floor(ys.min()) - 1, 0)), int(min(math.ceil(ys.max()) + 1, H - 1))
                if x1 < x0 or y1 < y0:
                    continue
                gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
                d = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
                if abs(d) < 1e-12:
                    continue
                l0 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / d
                l1 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / d
                l2 = 1 - l0 - l1
                m = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02)
                if not m.any():
                    continue
                L = np.stack([l0[m], l1[m], l2[m]], -1)
                yy, xx = np.nonzero(m)
                yy = yy + y0
                xx = xx + x0
                pos[yy, xx] = L @ p.V[list(tri)]
                nor[yy, xx] = L @ N[list(tri)]
                luv[yy, xx] = L @ p.uv[list(tri)]
                pid[yy, xx] = pi
    return pos, nor, pid, luv


def dilate(pid, arrays, iters=None):
    """Fill empty texels with nearest filled texel values (for seam padding)."""
    from scipy import ndimage
    empty = pid < 0
    _, (iy, ix) = ndimage.distance_transform_edt(empty, return_indices=True)
    out = [a[iy, ix] for a in arrays]
    return pid[iy, ix], out


# ----------------------------------------------------------------- noise
def _hash(ix, iy, iz, seed):
    h = (ix * 374761393 + iy * 668265263 + iz * 1274126177 + seed * 1013904223) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return (h & 0xFFFF) / 65535.0


def noise3(P, scale=1.0, seed=0):
    p = np.asarray(P, float) * scale
    i = np.floor(p).astype(np.int64)
    f = p - i
    f = f * f * (3 - 2 * f)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[..., 0] if dx else 1 - f[..., 0]) * (f[..., 1] if dy else 1 - f[..., 1]) * (f[..., 2] if dz else 1 - f[..., 2])
                out = out + w * _hash(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz, seed)
    return out


def fbm(P, scale=1.0, seed=0, oct=3):
    s, a, tot = scale, 1.0, 0
    out = 0
    for o in range(oct):
        out = out + a * noise3(P, s, seed + o * 17)
        tot += a
        s *= 2.03
        a *= 0.5
    return out / tot


def hexc(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def stripe(f, freq, width, aa=0.6):
    """Antialiased thin lines at integer level sets of f*freq. width as fraction of period."""
    x = f * freq
    d = np.abs(x - np.round(x))
    fw = np.maximum(np.abs(np.gradient(x)[0]) if x.ndim == 2 else 0.02, 0.02)
    return 1 - smoothstep(width * 0.5, width * 0.5 + 0.03 * aa, d)
