"""Makes the car-preview artwork of the Flame Camo design from the final design picture (src/data/masters/flame-final-door.jpg).

    pip install pillow numpy scipy      (once; not project dependencies, only this script uses them)
    python scripts/make-art.py

Output: public/assets/img/art-flame-1000.png and art-flame-1600.png (the cropped sticker sheet, same aspect), and it prints
the size of the cropped sheet in "2000 px" source units, which is ART_SIZE in src/lib/car.ts.

The pictures are TONE MASKS the browser recolours (car.ts toneMatrix): black stays black, white = pure blue, colour family 1 = pure red,
colour family 2 = pure green. Pixels are classified by luminance (black 0 / c1 ~51 / c2 ~91 / white 255); JPEG noise and the anti-aliasing
rings are cleaned. The white page around the sticker is removed to transparency (flood fill from the border); white inside the sticker
(the O frame) stays, and so do the thin white gaps between the panel and the two lower strips (they are transparent: the bare door shows).
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'src/data/masters/flame-final-door.jpg'
OUT = ROOT / 'public/assets/img'

L = np.asarray(Image.open(SRC).convert('L'), dtype=np.float64)
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
    from PIL import ImageDraw
    m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).polygon([tuple(p) for p in hv], fill=255)
    return np.asarray(m) > 0

# find the horizontal gap between the panel and the strips (a bright row band around y 650) and the vertical gap between strips
gap_rows = np.nonzero(L[:, 200:1800].mean(axis=1) > 200)[0]
gap_rows = gap_rows[(gap_rows > H * 0.6) & (gap_rows < H * 0.9)]
panel_bot, strip_top = gap_rows.min() - 1, gap_rows.max() + 1
strips = L[strip_top + 20:strip_top + 100]
coldark = (strips < 150).mean(axis=0)
mid = np.arange(W // 3, 2 * W // 3)
gx = mid[np.argmin(coldark[mid])]
print('panel bottom', panel_bot, 'strips from', strip_top, 'gap x', gx, file=sys.stderr)
hull = hull_mask((0, panel_bot + 2), (0, W)) | hull_mask((strip_top - 1, H), (0, gx - 2)) | hull_mask((strip_top - 1, H), (gx + 3, W))
hull_in = ndi.binary_erosion(hull, iterations=2)
sticker |= hull_in

# 3. Anti-aliased rim: pixels within 2 px of the page take the tone of the nearest solid pixel and get partial transparency.
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
cls = np.digitize(Lc, [25, 71, 173])
# anti-aliasing rings between two far-apart tones pass through the tones in between: remove thin (<= 2 px) c1 / c2 strips
st = np.ones((3, 3), bool)
for k in (1, 2):
    m = cls == k
    thin = m & ~ndi.binary_opening(m, structure=st)
    if thin.any():
        solid = ~thin
        j = ndi.distance_transform_edt(thin, return_distances=False, return_indices=True)
        cls = np.where(thin, cls[j[0], j[1]], cls)

# 5. One-hot -> soft edges -> RGB (R = c1, G = c2, B = white, none = black).
rgb = np.zeros((H, W, 3))
for k, ch in ((1, 0), (2, 1), (3, 2)):
    rgb[..., ch] = ndi.gaussian_filter((cls == k).astype(np.float64), 0.7)
rgb = np.clip(rgb, 0, 1)
a8 = np.clip(alpha, 0, 1)
a8 = ndi.gaussian_filter(a8, 0.4) * sticker
# transparent pixels keep a neighbouring colour so scaling does not bleed black / white fringes
out = np.dstack([rgb, a8])
out = (out * 255 + .5).astype(np.uint8)

# 6. Crop to the sticker and write both sizes.
ys, xs = np.nonzero(a8 > 0.5)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
img = Image.fromarray(out, 'RGBA').crop((x0, y0, x1, y1))
cw, ch_ = img.size
print(f'ART_SIZE = [{cw}, {ch_}]  (crop box {x0},{y0},{x1},{y1} of {W}x{H}); aspect {cw / ch_:.4f}')
for w in (1000, 1600):
    h = round(w * ch_ / cw)
    r = img.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')
    r.save(OUT / f'art-flame-{w}.png', optimize=True)
    print('wrote', OUT / f'art-flame-{w}.png', r.size)
