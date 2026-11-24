"""Measures the five Ami Pop photos (public/assets/img/ami/pop-<angle>.webp, 2000 x 1125, transparent) and writes everything the car
renderer needs to put the stickers on them:  src/data/pop.json, public/assets/img/ami-sil-pop.png and ami-pop-lights-<angle>.png.

    pip install pillow numpy scipy      (once; not project dependencies)
    python scripts/make-pop.py

The photos show the car with its factory stickers, and our stickers are drawn over them, so the factory stickers are also the
reference that finds the sticker zones in every angle:
  * side photo: the door zone is the factory door sticker's box (left / top / bottom edge) widened to wrap the handle recess exactly like on
    the Ami 2025 (the same proportions as before: 267 x 106 for a 209.6 x 104.8 factory sticker); the window zone is the red half of the
    factory ring (outer arc, inner arc, and the straight edge along the body seam), fitted with circles.
  * the other four photos: the same factory stickers are found by colour and the side zones are carried over with a homography (door, fitted
    on the sticker outline) and an affine map (window ring), so each zone lands on the stickers of that photo.
Angles: front = pop-front (most frontal), front34 = pop-front34, side, back34 = pop-back34, back = pop-back (most rear).
"""
import json
import re
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.optimize import least_squares

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / 'public/assets/img'
ANGLES = ['front', 'front34', 'side', 'back34', 'back']
PHOTO = {a: IMG / 'ami' / f'pop-{a}.webp' for a in ANGLES}


def load(a):
    return np.asarray(Image.open(PHOTO[a]).convert('RGBA')).astype(float)


IM = {a: load(a) for a in ANGLES}
# ------------------------------------------------------------------ factory stickers (colour masks)
DOOR_BOX = {'back': (690, 670, 880, 805), 'back34': (740, 670, 970, 810), 'side': (845, 675, 1095, 810), 'front34': (1040, 675, 1250, 820), 'front': (1145, 680, 1295, 820)}
RING_BOX = {'back': (1000, 375, 1075, 462), 'back34': (1105, 375, 1195, 468), 'side': (1225, 370, 1305, 475), 'front34': (1315, 385, 1390, 478), 'front': (1318, 398, 1368, 478)}
RING_TH = {'back': (140, 50, 35), 'back34': (135, 30, 22), 'side': (140, 50, 35), 'front34': (150, 28, 22), 'front': (140, 50, 35)}


def biggest(m):
    lab, n = ndi.label(m)
    sz = ndi.sum(m, lab, range(1, n + 1))
    return lab == (np.argmax(sz) + 1)


def door_mask(a):
    im = IM[a]; R, G, B, A = im[..., 0], im[..., 1], im[..., 2], im[..., 3]
    m = ((R > 200) & (G < 125) & (B < 120) & (A > 200)) | ((R > 190) & (G > 190) & (B < 110) & (A > 200))
    x0, y0, x1, y1 = DOOR_BOX[a]; z = np.zeros_like(m); z[y0:y1, x0:x1] = True; m &= z
    lab, n = ndi.label(ndi.binary_dilation(m, iterations=2)); sz = ndi.sum(m, lab, range(1, n + 1)); m &= lab == (np.argmax(sz) + 1)
    return ndi.binary_closing(m, structure=np.ones((3, 3)))


def ring_mask(a):
    im = IM[a]; R, G, B, A = im[..., 0], im[..., 1], im[..., 2], im[..., 3]
    t = RING_TH[a]
    m = (R > t[0]) & (R - G > t[1]) & (R - B > t[2]) & (A > 200)
    x0, y0, x1, y1 = RING_BOX[a]; z = np.zeros_like(m); z[y0:y1, x0:x1] = True; m &= z
    m = ndi.binary_opening(m, structure=np.ones((2, 2)))
    return ndi.binary_fill_holes(biggest(m))


def edge(m):
    return m & ~ndi.binary_erosion(m)


def bbox(m):
    y, x = np.nonzero(m)
    return x.min(), y.min(), x.max() + 1, y.max() + 1


def fit_circle(P):
    A = np.c_[2 * P[:, 0], 2 * P[:, 1], np.ones(len(P))]
    c = np.linalg.lstsq(A, (P ** 2).sum(1), rcond=None)[0]
    return c[:2], float(np.sqrt(c[2] + c[0] ** 2 + c[1] ** 2))


# ------------------------------------------------------------------ side photo: door rect and window zone
# Door zone (see the module note): the sticker sheet is drawn into this rectangle [x, y, w, h, corner radius].
DOOR = [858.5, 685.4, 289.7, 115.0, 43.0]

RM = {a: ring_mask(a) for a in ANGLES}
edge_s = edge(RM['side']); P = np.c_[np.nonzero(edge_s)[1], np.nonzero(edge_s)[0]].astype(float) + .5
rng = np.random.default_rng(1); best = None
for _ in range(600):                                              # the body seam cuts the ring: a straight edge of the red half
    i, j = rng.choice(len(P), 2, replace=False); d = P[j] - P[i]; L = np.hypot(*d)
    if L < 20: continue
    nrm = np.array([-d[1], d[0]]) / L; c = (np.abs((P - P[i]) @ nrm) < 0.9).sum()
    if best is None or c > best[0]: best = (c, P[i], d / L)
_, p0, u = best; nrm = np.array([-u[1], u[0]])
Q = P[np.abs((P - p0) @ nrm) >= 1.2]
C = np.array([1282., 422.])
for _ in range(6):
    d = np.hypot(*(Q - C).T); thr = (d.max() + d.min()) / 2
    co, ro = fit_circle(Q[d > thr]); ci, ri = fit_circle(Q[d <= thr]); C = (co + ci) / 2
ro += 0.9; ri -= 0.9                                              # a hair wider than the factory ring: no red edge shows
n = nrm if nrm[0] < 0 else -nrm                                   # towards the red (left) side
off = float((p0 - C) @ n) - 0.8
an = np.arctan2(n[1], n[0])


def arc(r, a0, a1):
    k = max(8, int(abs(a1 - a0) * r / 2.7))
    return [C + r * np.array([np.cos(a), np.sin(a)]) for a in np.linspace(a0, a1, k + 1)]


da = np.arccos(np.clip(off / ro, -1, 1)); db = np.arccos(np.clip(off / ri, -1, 1))
outer = arc(ro, an + da, an - da); inner = arc(ri, an - db, an + db)
if outer[0][1] < outer[-1][1]: outer = outer[::-1]               # outer arc from the lower end of the seam to the upper one
if inner[0][1] > inner[-1][1]: inner = inner[::-1]               # inner arc from the upper end to the lower one
poly = np.array(outer + inner)
WIN_PATH = 'M' + ' L'.join('%.1f %.1f' % (x, y) for x, y in poly) + 'Z'
WIN_BOX = [float(np.floor(poly[:, 0].min() - 1.5)), float(np.floor(poly[:, 1].min() - 1.5)), 0, 0]
WIN_BOX[2] = float(np.ceil(poly[:, 0].max() + 1.5) - WIN_BOX[0]); WIN_BOX[3] = float(np.ceil(poly[:, 1].max() + 1.5) - WIN_BOX[1])
print('window zone: centre', C.round(2), 'ro', round(ro, 2), 'ri', round(ri, 2), 'box', WIN_BOX, file=sys.stderr)

# ------------------------------------------------------------------ other angles: homography (door) / affine (window)
DM = {a: door_mask(a) for a in ANGLES}


def hp(h, Pt):
    H = np.append(h, 1).reshape(3, 3); Qp = np.c_[Pt, np.ones(len(Pt))] @ H.T
    return Qp[:, :2] / Qp[:, 2:3]


def chamfer(M, E, DT, sample, affine):
    def fit(k):
        b3, bk = bbox(M['side']), bbox(M[k]); sx, sy = (bk[2] - bk[0]) / (b3[2] - b3[0]), (bk[3] - bk[1]) / (b3[3] - b3[1])
        h0 = np.array([sx, 0, bk[0] - b3[0] * sx, 0, sy, bk[1] - b3[1] * sy] + ([] if affine else [0, 0]))
        P3, Pk = sample(E['side']), sample(E[k])

        def full(h):
            return np.array([[h[0], h[1], h[2]], [h[3], h[4], h[5]], [0, 0, 1]]) if affine else np.append(h, 1).reshape(3, 3)

        def app(H, Pt):
            Qp = np.c_[Pt, np.ones(len(Pt))] @ H.T; return Qp[:, :2] / Qp[:, 2:3]

        def resid(h):
            H = full(h)
            a = ndi.map_coordinates(DT[k], app(H, P3)[:, ::-1].T, order=1, mode='nearest')
            try: Hi = np.linalg.inv(H)
            except np.linalg.LinAlgError: return np.ones(len(P3) + len(Pk)) * 50
            b = ndi.map_coordinates(DT['side'], app(Hi, Pk)[:, ::-1].T, order=1, mode='nearest')
            return np.r_[a, b]
        xs = np.array([.1, .1, 50, .1, .1, 50] + ([] if affine else [1e-3, 1e-3]))
        r = least_squares(resid, h0, loss='soft_l1', f_scale=1.5 if not affine else 1.0, x_scale=xs, max_nfev=500)
        print(('window' if affine else 'door'), k, 'rms', round(float(np.sqrt((resid(r.x) ** 2).mean())), 2), file=sys.stderr)
        return full(r.x)
    return fit


def pts_edge(E, k=500):
    y, x = np.nonzero(E); Pt = np.c_[x, y].astype(float) + .5
    return Pt[np.linspace(0, len(Pt) - 1, k).astype(int)] if len(Pt) > k else Pt


ED = {a: edge(DM[a]) for a in ANGLES}; DTD = {a: ndi.distance_transform_edt(~ED[a]) for a in ANGLES}
ER = {a: edge(RM[a]) for a in ANGLES}; DTR = {a: ndi.distance_transform_edt(~ER[a]) for a in ANGLES}
fit_door = chamfer(DM, ED, DTD, pts_edge, False)
fit_win = chamfer(RM, ER, DTR, pts_edge, True)


def rect_pts(x, y, w, h):
    return np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], float)


def apply(H, Pt):
    Qp = np.c_[Pt, np.ones(len(Pt))] @ H.T; return Qp[:, :2] / Qp[:, 2:3]


zones = {}
for a in ANGLES:
    if a == 'side': continue
    Hd, Hw = fit_door(a), fit_win(a)
    zones[a] = dict(dq=np.round(apply(Hd, rect_pts(*DOOR[:4])), 1).tolist(), wq=np.round(apply(Hw, rect_pts(*WIN_BOX)), 1).tolist())

# ------------------------------------------------------------------ views (camera boxes): the car, shadow included, centred; same body size on screen for every angle
views = {}
for a in ANGLES:
    al = IM[a][..., 3] > 20; x0, y0, x1, y1 = bbox(al); w = x1 - x0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2 + 4
    fw = w * 1.12; fh = fw * 646 / 1080; tw = w * 1.065; th = tw * 594 / 1032
    views[a] = dict(full=[round(cx - fw / 2, 1), round(cy - fh / 2, 1), round(fw, 1), round(fh, 1)], thumb=[round(cx - tw / 2, 1), round(cy - th / 2, 1), round(tw, 1), round(th, 1)])
dc = (DOOR[0] + DOOR[2] / 2, DOOR[1] + DOOR[3] / 2); k = DOOR[2] / 267
dw, dh = 372 * k, 222 * k
views['side']['door'] = [round(dc[0] - dw / 2, 1), round(dc[1] - dh / 2, 1), round(dw, 1), round(dh, 1)]
ww, wh = 230 * k, 138 * k
views['side']['window'] = [round(C[0] - ww / 2, 1), round(C[1] - wh / 2, 1), round(ww, 1), round(wh, 1)]

# ------------------------------------------------------------------ wheels (side photo): rim centre and radius, rolling radius
im = IM['side']; R, G, B, A = im[..., 0], im[..., 1], im[..., 2], im[..., 3]
white = (R > 190) & (G > 190) & (B > 190) & (A > 250)           # the silver outlines of the five hexagons: their centroid is the hub
dark = (R + G + B < 240) & (A > 250)
wheels, rimr, tyrer = [], [], []
yy, xx = np.mgrid[:im.shape[0], :im.shape[1]]
for (cx0, cy0) in ((658, 778), (1352, 776)):
    cx, cy = float(cx0), float(cy0)
    for _ in range(4):
        sel = white & (np.hypot(xx - cx, yy - cy) < 86); cx, cy = xx[sel].mean(), yy[sel].mean()
    d = np.hypot(xx[sel] - cx, yy[sel] - cy)
    wheels.append([round(float(cx), 1), round(float(cy), 1)]); rimr.append(float(np.percentile(d, 99.5)) + 2)
    col = dark[:, int(cx) - 25:int(cx) + 25].any(1); ground = np.nonzero(col)[0].max()   # lowest dark pixel of the tyre
    tyrer.append(ground - cy)
    print('wheel', wheels[-1], 'rim r', round(rimr[-1], 1), 'tyre bottom y', ground, file=sys.stderr)
tyre_r = float(np.mean(tyrer))

# ------------------------------------------------------------------ front accent (yellow strips): recolour masks
lights = {}
for a, (bx0, by0, bx1, by1) in {'side': (552, 536, 585, 575), 'front34': (562, 543, 752, 570), 'front': (622, 551, 898, 577)}.items():
    p = IM[a][by0:by1, bx0:bx1]
    y = np.clip((np.minimum(p[..., 0], p[..., 1]) - p[..., 2] - 40) / 90, 0, 1) * (p[..., 3] > 200)
    y = ndi.maximum_filter(y, 3) * 0 + y                           # (kept as is; no growing)
    S = 4
    Image.fromarray((y * 255).astype(np.uint8)).resize(((bx1 - bx0) * S, (by1 - by0) * S), Image.BICUBIC).save(IMG / f'ami-pop-lights-{a}.png', optimize=True)
    lights[a] = dict(x=bx0, y=by0, w=bx1 - bx0, h=by1 - by0, mask=f'ami-pop-lights-{a}.png')

# ------------------------------------------------------------------ panel colour (bare door panel seen in the sticker's gaps)
panel = {}
yy, xx = np.mgrid[:1125, :2000]
dq_side = rect_pts(*DOOR[:4])
for a in ANGLES:
    quad = dq_side if a == 'side' else np.array(zones[a]['dq'])
    from PIL import ImageDraw
    m = Image.new('L', (2000, 1125), 0); ImageDraw.Draw(m).polygon([tuple(p) for p in quad], fill=255); m = np.asarray(m) > 0
    ring = ndi.binary_dilation(m, iterations=18) & ~ndi.binary_dilation(m, iterations=7)
    im = IM[a]; R, G, B, A = im[..., 0], im[..., 1], im[..., 2], im[..., 3]
    ok = ring & (A > 250) & ~(((R - G) > 60) | ((R > 190) & (G > 190) & (B < 120))) & ((R + G + B) > 240)
    panel[a] = '#%02x%02x%02x' % tuple(int(v) for v in np.median(im[ok][:, :3], 0))

# ------------------------------------------------------------------ silhouette for the "whole car" view button (500 x 281, same placement as the photo)
al = (IM['side'][..., 3] > 200).astype(float)
al = ndi.binary_closing(al > 0.5, structure=np.ones((5, 5)))
sil = Image.fromarray((al * 255).astype(np.uint8)).resize((500, 281), Image.LANCZOS)
sa = ndi.gaussian_filter(np.asarray(sil).astype(float) / 255, 0.8)
rgba = np.zeros((281, 500, 4), np.uint8); rgba[..., 3] = (np.clip((sa - .25) / .5, 0, 1) * 255).astype(np.uint8)
Image.fromarray(rgba, 'RGBA').save(IMG / 'ami-sil-pop.png', optimize=True)

out = dict(
    door=DOOR, win=WIN_PATH, winBox=WIN_BOX, ring=dict(c=[round(float(C[0]), 2), round(float(C[1]), 2)], ro=round(float(ro), 2), ri=round(float(ri), 2)),
    wheels=wheels, rimR=round(float(np.mean(rimr)), 1), tyreR=round(tyre_r, 1), zones=zones, views=views, lights=lights, panel=panel,
)
(ROOT / 'src/data/pop.json').write_text(json.dumps(out, indent=1), encoding='utf8')
print('wrote src/data/pop.json')
