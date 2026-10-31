"""Makes the car-preview artwork of the Flame Camo design from the final design pictures:
  src/data/masters/flame-final-door.jpg    -> public/assets/img/art-flame-1000.png / -1600.png      (door sticker sheet)
  src/data/masters/flame-final-window.png  -> public/assets/img/art-flame-win-1000.png / -1600.png  (Ami Pop rear window)

    pip install pillow numpy scipy      (once; not project dependencies, only this script uses them)
    python scripts/make-art.py

The pictures are TONE MASKS the browser recolours (car.ts toneMatrix): black stays black, white = pure blue, colour family 1 = pure red,
colour family 2 = pure green. Pixels are classified by luminance; JPEG noise and the anti-aliasing rings are cleaned.

DOOR: it prints the size of the cropped sheet in "2000 px" source units, which is ART_SIZE in src/lib/car.ts. The white page around the
sticker is removed to transparency (flood fill from the border); white inside the sticker (streaks, the wedge inside the inner piece,
pinlines, the OFS/T mark) stays. The thin white gaps between the panel and the two lower strips are transparent (the bare door shows), and
so is the white O ring: it is the gap between two separate sticker pieces (the panel, which has a hole, and the small inner piece), so
the panel colour of the car shows through it. The ring is found geometrically: it is the white piece (with the wedge that touches it)
whose filled outline is the hole of the panel; the inner piece is a rounded rectangle fitted to the dark parts inside it. (The cut
contours of the old print master, flame-camo.svg, are close to these but are not the same shape: the final design was redrawn.)

WINDOW: the Ami Pop's rear window zone is a half ring seen on the photo (car.ts MODEL_DEFS.pop.win: two concentric arcs and a slanted
flat edge). The final window artwork is a "C" (half ring with a vertical flat edge, thinner than the zone), so it is warped onto the
zone: radius and angle are mapped so that the C's outer arc, inner arc and flat edge land exactly on the zone's. The output is a picture
in the photo's own axes (rotated as the zone is), covering WINPOP_BOX of car.ts; it is printed at the end.
"""
import re
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public/assets/img'


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def tone_rgba(cls, alpha):
    """One-hot classes (0 black, 1 c1, 2 c2, 3 white) -> soft RGB (R = c1, G = c2, B = white) + alpha, as uint8 RGBA."""
    rgb = np.zeros(cls.shape + (3,))
    for k, ch in ((1, 0), (2, 1), (3, 2)):
        rgb[..., ch] = ndi.gaussian_filter((cls == k).astype(np.float64), 0.7)
    return np.clip(rgb, 0, 1), alpha


def clean_thin(cls):
    """Anti-aliasing rings between two far-apart tones pass through the tones in between: remove thin (<= 2 px) c1 / c2 strips."""
    st = np.ones((3, 3), bool)
    for k in (1, 2):
        m = cls == k
        thin = m & ~ndi.binary_opening(m, structure=st)
        if thin.any():
            j = ndi.distance_transform_edt(thin, return_distances=False, return_indices=True)
            cls = np.where(thin, cls[j[0], j[1]], cls)
    return cls


# ------------------------------------------------------------------ door
def make_door():
    src = Image.open(ROOT / 'src/data/masters/flame-final-door.jpg').convert('L')
    if src.width != 2000:                                          # the constants below are in "2000 px" source units
        src = src.resize((2000, round(src.height * 2000 / src.width)), Image.LANCZOS)
    L = np.asarray(src, dtype=np.float64)
    H, W = L.shape

    # 1. White page = bright pixels connected to the border.
    lab, _ = ndi.label(L > 232)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    sticker = ~bg

    # 2. White that touches the sticker edge (the streaks on the left edge) leaked into the page: restore it with the convex hull of each
    #    piece (the panel and the two lower strips are convex).
    def hull_mask(rows, cols):
        sub = np.zeros_like(sticker); sub[rows[0]:rows[1], cols[0]:cols[1]] = True
        ys, xs = np.nonzero(sub & (L < 150))
        pts = np.column_stack([xs, ys])
        hv = pts[ConvexHull(pts).vertices]
        m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).polygon([tuple(p) for p in hv], fill=255)
        return np.asarray(m) > 0

    gap_rows = np.nonzero(L[:, 200:1800].mean(axis=1) > 200)[0]
    gap_rows = gap_rows[(gap_rows > H * 0.6) & (gap_rows < H * 0.9)]
    run_end = gap_rows[0]                                          # the gap is the first run of bright rows (the page margin follows below)
    for r_ in gap_rows[1:]:
        if r_ != run_end + 1: break
        run_end = r_
    panel_bot, strip_top = gap_rows.min() - 1, run_end + 1
    strips = L[strip_top + 20:strip_top + 100]
    coldark = (strips < 150).mean(axis=0)
    mid = np.arange(W // 3, 2 * W // 3)
    gx = mid[np.argmin(coldark[mid])]
    print('panel bottom', panel_bot, 'strips from', strip_top, 'gap x', gx, file=sys.stderr)
    hull = hull_mask((0, panel_bot + 2), (0, W)) | hull_mask((strip_top - 1, H), (0, gx - 2)) | hull_mask((strip_top - 1, H), (gx + 3, W))
    hull_in = ndi.binary_erosion(hull, iterations=2)
    sticker |= hull_in

    # 2b. The O ring: a gap between two sticker pieces, transparent.
    #     R = the ring (white, with the wedge inside the inner piece that touches it); thin white bits stuck to it (streaks) are opened away.
    white = L > 200
    wl, _ = ndi.label(white)
    seed = wl[int(H * 0.30), int(W * 0.72)]                      # a point on the top bar of the ring
    assert seed > 0, 'ring not found'
    R = ndi.binary_opening(wl == seed, structure=disk(12))
    # The ring's outer edge: a white streak of the panel runs into the ring's left side (white on white, no visible edge there), so the
    # outline is a rounded rectangle fitted (robustly, ignoring the streak's outline) to the outer boundary of the ring.
    Rf = ndi.binary_fill_holes(R)
    by, bx = np.nonzero(Rf & ~ndi.binary_erosion(Rf))
    bpts = np.column_stack([bx + 0.5, by + 0.5])
    def rr_sd(p, x0_, y0_, x1_, y1_, r_):
        cx_, cy_ = (x0_ + x1_) / 2, (y0_ + y1_) / 2
        qx = np.abs(p[:, 0] - cx_) - ((x1_ - x0_) / 2 - r_); qy = np.abs(p[:, 1] - cy_) - ((y1_ - y0_) / 2 - r_)
        return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r_
    from scipy.optimize import minimize
    ox0, oy0, ox1, oy1 = bpts[:, 0].min(), bpts[:, 1].min(), bpts[:, 0].max(), bpts[:, 1].max()
    cost = lambda v: np.minimum(rr_sd(bpts, *v) ** 2, 9.0).sum()
    best = None
    for x0g in (ox0, 1020, 1030):                                  # the leftmost white is the streak: start near the visible edge
        res = minimize(cost, [x0g, oy0, ox1, oy1, 190], method='Nelder-Mead', options=dict(xatol=0.05, fatol=0.01, maxiter=4000))
        if best is None or res.fun < best.fun: best = res
    ox0, oy0, ox1, oy1, orr = best.x
    print(f'ring outer rounded rect {ox0:.1f},{oy0:.1f}..{ox1:.1f},{oy1:.1f} r {orr:.1f}; {np.mean(np.abs(rr_sd(bpts, *best.x)) < 1.5) * 100:.0f}% of the boundary within 1.5 px', file=sys.stderr)
    S = 4
    def rrect_mask(a, b, c, d, r):
        m = Image.new('L', (W * S, H * S), 0)
        ImageDraw.Draw(m).rounded_rectangle([a * S, b * S, c * S - 1, d * S - 1], radius=r * S, fill=255)
        return np.asarray(m.resize((W, H), Image.BOX)) >= 128
    m_out = 1.5                                                   # the cut is a little outside the fitted edge: no white fringe is left
    O = rrect_mask(ox0 - m_out, oy0 - m_out, ox1 + m_out, oy1 + m_out, orr + m_out)
    # the real outline is not exactly a rounded rectangle: where the ring is a little wider than the fit, follow the picture
    # (up to 7 px beyond the fit), except along the stretch where the panel's streak runs into the ring's left side
    near = ndi.binary_dilation(O, structure=disk(7))
    streak = np.zeros_like(O); streak[380:600, :1080] = True
    O |= Rf & near & ~streak
    # the inner piece: a rounded rectangle fitted around its dark parts (all four sides carry dark pixels)
    D = ndi.binary_opening(Rf & ~R & (L < 100), structure=disk(2))      # the dark holes of the ring = the inner piece's dark parts
    ys, xs = np.nonzero(D)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1.0, ys.min(), ys.max() + 1.0
    px, py = xs + 0.5, ys + 0.5
    # The inner piece is convex and its dark parts reach its border all the way round (only the white wedge hides the border in a few
    # short, nearly straight stretches), so the piece is the convex hull of its dark parts.
    cloud = np.column_stack([px, py])
    hv = cloud[ConvexHull(cloud).vertices]
    hm = Image.new('L', (W * S, H * S), 0)
    ImageDraw.Draw(hm).polygon([tuple(p * S) for p in hv], fill=255)
    inner = np.asarray(hm.resize((W, H), Image.BOX)) >= 128
    inner = ndi.binary_erosion(inner, iterations=1)               # the cut is a little inside the piece: no white sliver is left at its edge
    print(f'ring: inner piece {x0:.0f},{y0:.0f}..{x1:.0f},{y1:.0f} (hull of {len(hv)} points)', file=sys.stderr)
    GAP = O & ~inner
    sticker &= ~GAP
    ring_dbg = (O, inner, GAP)

    # 3. Anti-aliased rim: pixels within 2 px of the page (or of a transparent gap) take the tone of the nearest solid pixel and get
    #    partial transparency.
    core = ndi.binary_erosion(sticker, iterations=3)
    rim = sticker & ~core
    idx = ndi.distance_transform_edt(~core, return_distances=False, return_indices=True)
    Lref = L[idx[0], idx[1]]
    Lc = np.where(core, L, Lref)                  # tone used for classification
    alpha = np.where(core, 1.0, 0.0)
    frac = np.clip((255.0 - L) / np.maximum(255.0 - Lref, 1.0), 0, 1)
    rim_a = np.where(Lref < 200, frac, np.where(hull_in, 1.0, 0.0))
    alpha = np.where(rim, rim_a, alpha)
    alpha[~sticker] = 0

    # 4. Classify: 0 black, 1 c1, 2 c2, 3 white.
    cls = clean_thin(np.digitize(Lc, [25, 71, 173]))

    # 5. One-hot -> soft edges -> RGB.
    rgb, _ = tone_rgba(cls, alpha)
    a8 = np.clip(alpha, 0, 1)
    a8 = ndi.gaussian_filter(a8, 0.4) * sticker
    out = (np.dstack([rgb, a8]) * 255 + .5).astype(np.uint8)

    # 6. Crop to the sticker and write both sizes.
    ys, xs = np.nonzero(a8 > 0.5)
    bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    img = Image.fromarray(out, 'RGBA').crop((bx0, by0, bx1, by1))
    cw, ch_ = img.size
    print(f'ART_SIZE = [{cw}, {ch_}]  (crop box {bx0},{by0},{bx1},{by1} of {W}x{H}); aspect {cw / ch_:.4f}')
    for w in (1000, 1600):
        h = round(w * ch_ / cw)
        r = img.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')
        r.save(OUT / f'art-flame-{w}.png', optimize=True)
        print('wrote', OUT / f'art-flame-{w}.png', r.size)
    return ring_dbg


# ------------------------------------------------------------------ Ami Pop rear window
POP_WIN = None   # read from car.ts


def pop_zone():
    """The Pop's window zone from car.ts: two concentric circles (fitted) and the flat edge (through the outer arc's two end points)."""
    src = (ROOT / 'src/lib/car.ts').read_text(encoding='utf8')
    d = re.search(r"pop: \{.*?win: '(M[^']*)'", src, re.S).group(1)
    pts = np.array([(float(a), float(b)) for a, b in re.findall(r'(-?[\d.]+) (-?[\d.]+)', d)])
    # the path: outer arc, a line across the flat edge to the inner arc, the inner arc, close (the second flat edge piece)
    jumps = np.hypot(*np.diff(pts, axis=0).T)
    cut = int(np.argmax(jumps))                                   # the long step is the flat edge piece between the outer and inner arcs
    outer, inner = pts[:cut + 1], pts[cut + 1:]
    def fit(P):
        A = np.c_[2 * P[:, 0], 2 * P[:, 1], np.ones(len(P))]
        c = np.linalg.lstsq(A, (P ** 2).sum(1), rcond=None)[0]
        return c[:2], float(np.sqrt(c[2] + c[0] ** 2 + c[1] ** 2))
    co, ro = fit(outer); ci, ri = fit(inner)
    C = (co + ci) / 2
    E1, E2 = outer[-1], outer[0]                                  # the outer arc's ends: they lie on the flat edge
    return dict(pts=pts, C=C, ro=ro, ri=ri, E1=E1, E2=E2)


def fit_circle_pts(P):
    A = np.c_[2 * P[:, 0], 2 * P[:, 1], np.ones(len(P))]
    c = np.linalg.lstsq(A, (P ** 2).sum(1), rcond=None)[0]
    return c[:2], float(np.sqrt(c[2] + c[0] ** 2 + c[1] ** 2))


def make_window():
    img0 = Image.open(ROOT / 'src/data/masters/flame-final-window.png').convert('RGB')
    L = np.asarray(img0, dtype=np.float64).mean(axis=2)
    H, W = L.shape
    # shape = everything that is not page; thin white pinlines may reach the edge, so close them (they are <= 4 px wide)
    dark = L < 200
    shape = ndi.binary_closing(np.pad(dark, 8), structure=disk(4))[8:-8, 8:-8]
    shape = ndi.binary_fill_holes(shape)
    shape = ndi.binary_opening(shape, structure=disk(2))
    lab, n = ndi.label(shape)
    shape = lab == (np.argmax(np.bincount(lab.ravel())[1:]) + 1)
    ys, xs = np.nonzero(shape)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    print('window shape bbox', x0, y0, x1, y1, file=sys.stderr)
    # circles of the C: boundary pixels of the arcs
    edge = shape & ~ndi.binary_erosion(shape)
    ey, ex = np.nonzero(edge)
    ex = ex + 0.5; ey = ey + 0.5
    xch = float(x1)                                               # the flat edge
    cx0, cy0 = x1, (y0 + y1) / 2
    dist = np.hypot(ex - cx0, ey - cy0)
    sel = ex < xch - 6
    Po = np.column_stack([ex, ey])[sel & (dist > (dist[sel].max() + dist[sel].min()) / 2)]
    Pi = np.column_stack([ex, ey])[sel & (dist <= (dist[sel].max() + dist[sel].min()) / 2)]
    ca_o, ra_o = fit_circle_pts(Po); ca_i, ra_i = fit_circle_pts(Pi)
    Ca = (ca_o + ca_i) / 2
    print(f'C: outer r {ra_o:.1f} centre {ca_o}, inner r {ra_i:.1f} centre {ca_i}, flat edge x {xch}', file=sys.stderr)

    # tone classes: black 0, c1 51, c2 71, white 255
    core = ndi.binary_erosion(shape, iterations=3)
    idx = ndi.distance_transform_edt(~core, return_distances=False, return_indices=True)
    Lc = np.where(core, L, L[idx[0], idx[1]])
    cls = clean_thin(np.digitize(Lc, [25, 61, 163]))
    rgb, _ = tone_rgba(cls, None)
    alpha = np.clip(ndi.gaussian_filter(shape.astype(np.float64), 0.8), 0, 1) * (ndi.binary_dilation(shape, iterations=2))
    prem = np.dstack([rgb * alpha[..., None], alpha])             # premultiplied, so warping does not bleed fringes

    Z = pop_zone()
    C, ro, ri = Z['C'], Z['ro'], Z['ri']
    u = (Z['E2'] - Z['E1']); u = u / np.hypot(*u)
    n = np.array([-u[1], u[0]])                                   # towards the arc side
    if np.dot(C - Z['E1'], n) > 0 and False:
        n = -n
    xi_c = float(np.dot(C - Z['E1'], n))                          # signed distance of the centre in front of the flat edge
    # which side is the arc on? the outer arc's far point
    mid_out = Z['pts'][len(Z['pts']) // 4]
    if np.dot(mid_out - Z['E1'], n) < 0:
        n = -n; xi_c = -xi_c
    print(f'zone: centre {C}, ro {ro:.2f}, ri {ri:.2f}, chord offset {xi_c:.2f}, u {u}, n {n}', file=sys.stderr)
    xia_c = xch - Ca[0]                                           # same quantity for the art (arc side = left = -x)

    pts = Z['pts']
    bx0, by0 = np.floor(pts.min(0) - 1.5); bx1, by1 = np.ceil(pts.max(0) + 1.5)
    box = [float(bx0), float(by0), float(bx1 - bx0), float(by1 - by0)]
    print(f'WINPOP_BOX = [{box[0]:.0f}, {box[1]:.0f}, {box[2]:.0f}, {box[3]:.0f}]')
    for outw in (1000, 1600):
        ppu = outw / max(box[2], box[3])
        ow, oh = int(round(box[2] * ppu)), int(round(box[3] * ppu))
        gx, gy = np.meshgrid((np.arange(ow) + 0.5) / ppu + box[0], (np.arange(oh) + 0.5) / ppu + box[1])
        vx, vy = gx - C[0], gy - C[1]
        rho = np.hypot(vx, vy)
        th = np.arctan2(vx * u[0] + vy * u[1], vx * n[0] + vy * n[1])           # angle from the arc axis, positive towards u
        the = np.arccos(np.clip(-xi_c / np.maximum(rho, 1e-6), -1, 1))           # half-angle at which the flat edge is met, at this radius
        tau = th / np.maximum(the, 1e-3)                                         # -1..1 across the flat-edge-to-flat-edge span
        rho_a = ra_i + (rho - ri) / (ro - ri) * (ra_o - ra_i)
        the_a = np.arccos(np.clip(-xia_c / np.maximum(rho_a, 1e-6), -1, 1))
        phi = tau * the_a
        sx = Ca[0] - rho_a * np.cos(phi)                                         # art arc axis points to -x; positive angle goes down (+y)
        sy = Ca[1] + rho_a * np.sin(phi)
        coords = [sy - 0.5, sx - 0.5]
        warp = np.dstack([ndi.map_coordinates(prem[..., k], coords, order=1, mode='constant', cval=0) for k in range(4)])
        a = np.clip(warp[..., 3], 0, 1)
        rgbw = np.where(a[..., None] > 1e-4, warp[..., :3] / np.maximum(a[..., None], 1e-4), 0)
        outp = (np.dstack([np.clip(rgbw, 0, 1), a]) * 255 + .5).astype(np.uint8)
        Image.fromarray(outp, 'RGBA').save(OUT / f'art-flame-win-{outw}.png', optimize=True)
        print('wrote', OUT / f'art-flame-win-{outw}.png', (ow, oh))


if __name__ == '__main__':
    make_door()
    make_window()
