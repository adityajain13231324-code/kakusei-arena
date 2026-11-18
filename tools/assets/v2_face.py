"""Vector-style anime face art (eyes, brows, mouth) painted into 512px expression panels.
Panel coordinates are a planar front projection of the face: world x -> panel x, world z -> panel y.
"""
import math
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

SS = 4  # supersampling


def bez(p0, p1, p2, p3=None, n=24):
    pts = []
    for i in range(n + 1):
        t = i / n
        if p3 is None:
            x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0]
            y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]
        else:
            x = ((1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t * t * p2[0] + t ** 3 * p3[0])
            y = ((1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t * t * p2[1] + t ** 3 * p3[1])
        pts.append((x, y))
    return pts


def stroke(draw, pts, w0, w1=None, color=(20, 18, 30, 255), wmid=None):
    """Tapered stroke as polygon. widths at start/end (and optional mid)."""
    w1 = w0 if w1 is None else w1
    n = len(pts)
    left, right = [], []
    for i, (x, y) in enumerate(pts):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, n - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L, dx / L
        t = i / (n - 1)
        if wmid is not None:
            w = (w0 + (wmid - w0) * (t / .5)) if t < .5 else (wmid + (w1 - wmid) * ((t - .5) / .5))
        else:
            w = w0 + (w1 - w0) * t
        left.append((x + nx * w / 2, y + ny * w / 2))
        right.append((x - nx * w / 2, y - ny * w / 2))
    draw.polygon(left + right[::-1], fill=color)


class FaceCanvas:
    def __init__(self, base_rgb, box):
        """base_rgb: (512,512,3) float 0..1 panel background (skin + shadows). box: (xmin,xmax,zmin,zmax) world."""
        self.size = base_rgb.shape[0]
        self.box = box
        self.S = self.size * SS
        self.img = Image.fromarray((np.clip(base_rgb, 0, 1) * 255).astype(np.uint8)).convert('RGBA').resize((self.S, self.S), Image.BICUBIC)
        self.glow = Image.new('L', (self.S, self.S), 0)

    def P(self, x, z):
        xmin, xmax, zmin, zmax = self.box
        return ((x - xmin) / (xmax - xmin) * self.S, (1 - (z - zmin) / (zmax - zmin)) * self.S)

    def L(self, metres):
        xmin, xmax, _, _ = self.box
        return metres / (xmax - xmin) * self.S

    def layer(self):
        return Image.new('RGBA', (self.S, self.S), (0, 0, 0, 0))

    def comp(self, layer, mask=None):
        if mask is not None:
            a = layer.split()[3]
            from PIL import ImageChops
            a = ImageChops.multiply(a, mask)
            layer.putalpha(a)
        self.img = Image.alpha_composite(self.img, layer)

    def result(self):
        out = self.img.resize((self.size, self.size), Image.LANCZOS).convert('RGB')
        g = self.glow.resize((self.size, self.size), Image.LANCZOS)
        return np.asarray(out).astype(np.float32) / 255, np.asarray(g).astype(np.float32) / 255


def rgba(h, a=255):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def draw_eye(fc, cx, cz, side, st, mode='open', glow=False):
    """side: +1 = character's left (screen right in front view). st: style dict.
    modes: open, wide, narrow, closed, squeeze, glare"""
    w = fc.L(st['eye_w'])
    h = fc.L(st['eye_h'])
    x0, y0 = fc.P(cx, cz)
    ink = rgba(st.get('ink', '1b1622'))
    tilt = st.get('tilt', 0.0)  # positive: outer corner up
    open_k = {'open': 1.0, 'wide': 1.12, 'narrow': 0.62, 'glare': 0.55, 'closed': 0, 'squeeze': 0}[mode]
    inner = (x0 - side * w * 0.50, y0 + h * 0.10)
    outer = (x0 + side * w * 0.52, y0 - h * (0.12 + tilt))
    if mode in ('closed', 'squeeze'):
        L = fc.layer()
        d = ImageDraw.Draw(L)
        if mode == 'closed':
            # calm downward arc with lash flick
            pts = bez((inner[0], inner[1] - h * .05), (x0, y0 + h * 0.32), (outer[0], outer[1] + h * .25))
            stroke(d, pts, w * .05, w * .09, ink, wmid=w * .11)
            stroke(d, bez(pts[-1], (outer[0] + side * w * .08, outer[1] + h * .2), (outer[0] + side * w * .16, outer[1] + h * .08)), w * .07, w * .01, ink)
            # small lower lashes
            for k in range(3):
                t = .35 + k * .2
                px, py = pts[int(t * (len(pts) - 1))]
                stroke(d, [(px, py), (px + side * w * .03, py + h * .16)], w * .03, w * .005, ink)
        else:
            # > < squeeze
            a = (x0 - side * w * .45, y0 - h * .35)
            b = (x0 + side * w * .35, y0)
            c = (x0 - side * w * .45, y0 + h * .3)
            stroke(d, bez(a, (x0, y0 - h * .1), b), w * .05, w * .13, ink)
            stroke(d, bez(b, (x0, y0 + h * .1), c), w * .13, w * .05, ink)
        fc.comp(L)
        return
    top_y = y0 - h * 0.62 * open_k
    bot_y = y0 + h * 0.42 * min(open_k, 1.0)
    if mode == 'glare':
        top_y = y0 - h * 0.30
    upper = bez(inner, (x0 - side * w * 0.25, top_y - h * 0.05), (x0 + side * w * 0.25, top_y - h * 0.02 - tilt * h * .6), outer)
    lower = bez(outer, (x0 + side * w * 0.30, bot_y + h * 0.05), (x0 - side * w * 0.20, bot_y + h * 0.02), inner)
    sclera_poly = upper + lower
    mask = Image.new('L', (fc.S, fc.S), 0)
    ImageDraw.Draw(mask).polygon(sclera_poly, fill=255)
    # sclera
    L = fc.layer()
    d = ImageDraw.Draw(L)
    d.polygon(sclera_poly, fill=rgba(st.get('sclera', 'fbf8f4')))
    # lid shadow
    sh = bez((inner[0], inner[1] - h * .02), (x0 - side * w * .2, top_y + h * .25), (x0 + side * w * .25, top_y + h * .22), (outer[0], outer[1] + h * .12))
    d.polygon(upper + sh[::-1], fill=rgba(st.get('sclera_shade', 'c9cde0')))
    fc.comp(L)
    # iris with vertical gradient
    iw = w * st.get('iris_w', 0.50) * (0.82 if mode == 'wide' else 1)
    ih = h * st.get('iris_h', 0.95) * (0.82 if mode == 'wide' else 1)
    icx = x0 + side * w * st.get('iris_dx', 0.02)
    icy = y0 - h * 0.08
    L = fc.layer()
    d = ImageDraw.Draw(L)
    top = np.array(rgba(st['iris_top'])[:3], float)
    bot = np.array(rgba(st['iris_bot'])[:3], float)
    steps = 40
    for i in range(steps):
        t = i / (steps - 1)
        c = top * (1 - t) + bot * t
        yy0 = icy - ih / 2 + ih * i / steps
        yy1 = icy - ih / 2 + ih * (i + 1) / steps + 1
        # clip the slice by ellipse via drawing ellipse into temp mask later
        d.rectangle([icx - iw / 2, yy0, icx + iw / 2, yy1], fill=(int(c[0]), int(c[1]), int(c[2]), 255))
    emask = Image.new('L', (fc.S, fc.S), 0)
    ImageDraw.Draw(emask).ellipse([icx - iw / 2, icy - ih / 2, icx + iw / 2, icy + ih / 2], fill=255)
    from PIL import ImageChops
    emask = ImageChops.multiply(emask, mask)
    Ld = ImageDraw.Draw(L)
    # iris ring + pupil + lower light crescent
    Ld.ellipse([icx - iw / 2, icy - ih / 2, icx + iw / 2, icy + ih / 2], outline=rgba(st.get('iris_ring', '2a1a18')), width=int(w * .045))
    pw, ph = iw * st.get('pupil', 0.42), ih * st.get('pupil', 0.42) * 1.15
    Ld.ellipse([icx - pw / 2, icy - ph / 2 - ih * .05, icx + pw / 2, icy + ph / 2 - ih * .05], fill=rgba(st.get('pupil_c', '160f14')))
    cres = st.get('iris_light', None)
    if cres:
        Ld.chord([icx - iw * .38, icy, icx + iw * .38, icy + ih * .44], 0, 180, fill=rgba(cres, 200))
    fc.comp(L, emask)
    if glow:
        g = Image.new('L', (fc.S, fc.S), 0)
        ImageDraw.Draw(g).ellipse([icx - iw / 2, icy - ih / 2, icx + iw / 2, icy + ih / 2], fill=255)
        fc.glow.paste(255, (0, 0), ImageChops.multiply(g, mask))
    # highlights
    L = fc.layer()
    d = ImageDraw.Draw(L)
    hx, hy = icx - side * iw * 0.18, icy - ih * 0.22
    r1 = iw * 0.20
    d.ellipse([hx - r1, hy - r1 * 1.25, hx + r1, hy + r1 * 1.25], fill=(255, 255, 255, 245))
    r2 = iw * 0.09
    hx2, hy2 = icx + side * iw * 0.20, icy + ih * 0.22
    d.ellipse([hx2 - r2, hy2 - r2, hx2 + r2, hy2 + r2], fill=(255, 255, 255, 230))
    fc.comp(L, mask)
    # lash line (thick upper lid) with outer wing
    L = fc.layer()
    d = ImageDraw.Draw(L)
    lw = w * st.get('lash_w', 0.10)
    stroke(d, upper, lw * .45, lw * 1.0, ink, wmid=lw * 1.1)
    wing = st.get('wing', 0.12)
    ox, oy = outer
    stroke(d, bez((ox - side * w * .05, oy + h * .02), (ox + side * w * wing * .6, oy - h * .02), (ox + side * w * wing, oy - h * wing * 0.9)), lw * .9, lw * .1, ink)
    if st.get('lash_lower', True):
        lo = lower[2:int(len(lower) * .55)]
        stroke(d, lo, lw * .32, lw * .08, rgba(st.get('ink_soft', '4a3238')))
    # crease line above
    if st.get('crease', True) and mode != 'glare':
        cr = bez((x0 - side * w * .2, top_y - h * .18), (x0 + side * w * .1, top_y - h * .28), (x0 + side * w * .42, outer[1] - h * .22))
        stroke(d, cr, lw * .12, lw * .25, rgba(st.get('ink_soft', '4a3238'), 200))
    fc.comp(L)


def draw_brow(fc, cx, cz, side, st, angle=0.0, raise_=0.0):
    """angle>0: inner end lowered (angry/determined); angle<0 worried."""
    w = fc.L(st['brow_w'])
    x0, y0 = fc.P(cx, cz + raise_)
    th = fc.L(st.get('brow_t', 0.006))
    inner = (x0 - side * w * .5, y0 + w * (0.10 + angle * 0.35))
    outer = (x0 + side * w * .5, y0 + w * (0.06 - angle * 0.10))
    mid = (x0, y0 - w * (0.08 + st.get('brow_arch', 0.0)))
    L = fc.layer()
    d = ImageDraw.Draw(L)
    stroke(d, bez(inner, mid, outer), th * 1.15, th * .25, rgba(st.get('brow_c', '2b1d1f')), wmid=th)
    fc.comp(L)


def draw_mouth(fc, cx, cz, st, mode='neutral'):
    w = fc.L(st['mouth_w'])
    x0, y0 = fc.P(cx, cz)
    ink = rgba(st.get('mouth_ink', '5a2a2a'))
    L = fc.layer()
    d = ImageDraw.Draw(L)
    if mode == 'line':
        stroke(d, bez((x0 - w * .5, y0), (x0, y0 + w * .05), (x0 + w * .5, y0 - w * .02)), w * .04, w * .05, ink, wmid=w * .06)
    elif mode == 'smile':
        stroke(d, bez((x0 - w * .5, y0 - w * .06), (x0, y0 + w * .16), (x0 + w * .5, y0 - w * .08)), w * .04, w * .05, ink, wmid=w * .07)
    elif mode == 'grin':
        # confident lopsided grin with small fang
        top = bez((x0 - w * .55, y0 - w * .02), (x0 - w * .1, y0 + w * .02), (x0 + w * .55, y0 - w * .14))
        bot = bez((x0 + w * .55, y0 - w * .14), (x0 + w * .15, y0 + w * .32), (x0 - w * .55, y0 - w * .02))
        d.polygon(top + bot, fill=rgba('6e2430'))
        d.polygon(top + bez((x0 + w * .5, y0 - w * .12), (x0, y0 + w * .12), (x0 - w * .5, y0 + 0)), fill=rgba('fbf7f2'))
        fx = x0 + w * .22
        d.polygon([(fx - w * .07, y0 - w * .04), (fx + w * .03, y0 - w * .07), (fx - w * .01, y0 + w * .12)], fill=rgba('fbf7f2'))
        stroke(d, top, w * .045, w * .06, ink)
    elif mode in ('shout', 'roar'):
        k = 1.0 if mode == 'shout' else 1.25
        top = bez((x0 - w * .5 * k, y0 - w * .02), (x0, y0 - w * .14), (x0 + w * .5 * k, y0 - w * .02))
        bot = bez((x0 + w * .5 * k, y0 - w * .02), (x0 + w * .30, y0 + w * .9 * k), (x0 - w * .30, y0 + w * .9 * k), (x0 - w * .5 * k, y0 - w * .02))
        poly = top + bot
        d.polygon(poly, fill=rgba('5a1a26'))
        m = Image.new('L', (fc.S, fc.S), 0)
        ImageDraw.Draw(m).polygon(poly, fill=255)
        T = fc.layer()
        td = ImageDraw.Draw(T)
        td.rectangle([x0 - w, y0 - w * .3, x0 + w, y0 + w * .07], fill=rgba('fbf7f2'))
        td.ellipse([x0 - w * .35, y0 + w * .45 * k, x0 + w * .35, y0 + w * 1.1 * k], fill=rgba('d0606a'))
        from PIL import ImageChops
        a = ImageChops.multiply(T.split()[3], m)
        T.putalpha(a)
        L = Image.alpha_composite(L, T)
        d = ImageDraw.Draw(L)
        stroke(d, top, w * .05, w * .05, ink)
        stroke(d, bot, w * .04, w * .04, ink, wmid=w * .06)
    elif mode == 'grit':
        top = bez((x0 - w * .5, y0 - w * .1), (x0, y0 - w * .16), (x0 + w * .5, y0 - w * .1))
        bot = bez((x0 + w * .5, y0 - w * .1), (x0 + w * .2, y0 + w * .22), (x0 - w * .2, y0 + w * .22), (x0 - w * .5, y0 - w * .1))
        d.polygon(top + bot, fill=rgba('fbf7f2'))
        for k in range(-2, 3):
            xx = x0 + k * w * .17
            stroke(d, [(xx, y0 - w * .14), (xx, y0 + w * .16)], w * .025, w * .025, rgba('8a6a6a'))
        stroke(d, [(x0 - w * .45, y0 + .02 * w), (x0 + w * .45, y0 + .02 * w)], w * .025, w * .025, rgba('8a6a6a'))
        stroke(d, top + bot[1:], w * .045, w * .045, ink)
    elif mode == 'frown':
        stroke(d, bez((x0 - w * .45, y0 + w * .08), (x0, y0 - w * .1), (x0 + w * .45, y0 + w * .08)), w * .05, w * .05, ink, wmid=w * .07)
    elif mode == 'small':
        stroke(d, bez((x0 - w * .3, y0), (x0, y0 + w * .04), (x0 + w * .3, y0)), w * .04, w * .04, ink, wmid=w * .055)
    fc.comp(L)


def draw_nose(fc, cx, cz, st):
    x0, y0 = fc.P(cx, cz)
    w = fc.L(st.get('nose_w', 0.012))
    L = fc.layer()
    d = ImageDraw.Draw(L)
    stroke(d, bez((x0 - w * .6, y0 + w * .1), (x0 - w * .1, y0 + w * .45), (x0 + w * .4, y0 + w * .2)), w * .18, w * .08, rgba(st.get('nose_c', 'b8806e'), 220))
    fc.comp(L)


def blush(fc, cx, cz, side, st, strength=0.35, lines=False):
    x0, y0 = fc.P(cx, cz)
    rx, ry = fc.L(0.022), fc.L(0.011)
    L = fc.layer()
    d = ImageDraw.Draw(L)
    d.ellipse([x0 - rx, y0 - ry, x0 + rx, y0 + ry], fill=rgba(st.get('blush', 'f08a8a'), int(255 * strength)))
    L = L.filter(ImageFilter.GaussianBlur(fc.L(0.006)))
    if lines:
        d = ImageDraw.Draw(L)
        for k in range(3):
            xx = x0 + (k - 1) * rx * .5
            stroke(d, [(xx + rx * .15, y0 - ry * .5), (xx - rx * .1, y0 + ry * .5)], rx * .07, rx * .05, rgba('d0605e', 200))
    fc.comp(L)


def sweat(fc, cx, cz, st):
    x0, y0 = fc.P(cx, cz)
    r = fc.L(0.007)
    L = fc.layer()
    d = ImageDraw.Draw(L)
    d.polygon([(x0, y0 - r * 2.2), (x0 - r, y0), (x0 + r, y0)], fill=(190, 225, 255, 230))
    d.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=(190, 225, 255, 230))
    d.ellipse([x0 - r * .4, y0 - r * .6, x0, y0 - r * .1], fill=(255, 255, 255, 240))
    fc.comp(L)


def marks(fc, polylines, color, width, glow=False):
    """Generic world-space polylines (list of [(x,z),...]) e.g. ember marks/scars."""
    L = fc.layer()
    d = ImageDraw.Draw(L)
    for pl in polylines:
        pts = [fc.P(x, z) for x, z in pl]
        stroke(d, pts, fc.L(width), fc.L(width * .2), rgba(color), wmid=fc.L(width * 1.2))
    fc.comp(L)
    if glow:
        from PIL import ImageChops
        fc.glow = ImageChops.lighter(fc.glow, L.split()[3])
