"""Makes the WEIGHT MAPS the admin uses to build the print files (src/lib/printfile.ts):
  src/data/masters/flame-final-door.jpg    -> public/assets/print/flame-door-map.png
  src/data/masters/flame-final-window.png  -> public/assets/print/flame-win-map.png

Each map has the SAME pixel size as its source. Channel R = weight of colour 1, G = weight of colour 2, B = weight of white; the weight of
black is what is left (255 - R - G - B). The browser makes the print file as  w_black*#000000 + w_c1*colour1 + w_c2*colour2 + w_white*#FFFFFF,
so shapes, edges, pinlines and the white page are exactly those of the owner's artwork and only the two greys change colour.

How the weights are found (per pixel, from the luminance L of the source):
  * four class levels per source (black, c1, c2, white), measured on the pictures; each class has a small plateau (JPEG noise is flattened),
  * between two neighbouring levels the weights blend linearly (soft anti-aliased edges),
  * but only levels that really exist near the pixel are used: an anti-aliased edge between c1 and white passes through the grey level of
    c2, and it must NOT become a c2 halo. c1 / c2 count as present only where a 2 x 2 block of that class exists within 2 px
    of the pixel; black / white count as present when any plateau pixel of them is within 2 px (so 1-2 px white pinlines survive).

    pip install pillow numpy scipy      (once; not project dependencies)
    python scripts/make-print-maps.py
"""
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public/assets/print'
R_NEAR = 2


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def thick(m):
    """Pixels that belong to a 2 x 2 block of the same plateau. A ramp pixel on an edge is never in one (its iso-luminance contour is 1 px wide), a region or a 2 px line is."""
    s = np.ones((2, 2), bool)
    return ndi.binary_dilation(ndi.binary_erosion(m, structure=s), structure=s)

def weights(L, levels, tols):
    """L: float luminance (H, W). levels: [black, c1, c2, white] ascending. Returns (H, W, 4) weights summing to 1."""
    H, W = L.shape
    st3 = np.ones((3, 3), bool)
    present = []
    for k in range(4):
        plate = np.abs(L - levels[k]) <= tols[k]
        if k in (1, 2):                      # c1 / c2 only where a region >= 3 px thick exists (not in an edge ring)
            plate = thick(plate)
        present.append(ndi.binary_dilation(plate, structure=disk(R_NEAR)))
    # a pixel always keeps its own nearest class available when it sits on that class' plateau (so nothing is lost where the
    # neighbourhood test is too strict)
    # black and white are the ends of the scale: a ramp pixel never turns into them by accident, so they are always available (this
    # keeps thin pinlines whose peak is a little below pure white)
    present[0][:] = True
    present[3][:] = True
    P = np.stack(present, axis=-1)           # (H, W, 4)
    none = ~P.any(axis=-1)
    P[none] = True
    lev = np.asarray(levels, float)
    # lower bracket: highest present level <= L; upper: lowest present level >= L
    big = 1e9
    lo_lev = np.where(P, lev[None, None, :], -big)
    lo_lev = np.where(lo_lev <= L[..., None], lo_lev, -big)
    lo_idx = np.argmax(lo_lev, axis=-1); lo_val = np.take_along_axis(lo_lev, lo_idx[..., None], -1)[..., 0]
    hi_lev = np.where(P, lev[None, None, :], big)
    hi_lev = np.where(hi_lev >= L[..., None], hi_lev, big)
    hi_idx = np.argmin(hi_lev, axis=-1); hi_val = np.take_along_axis(hi_lev, hi_idx[..., None], -1)[..., 0]
    no_lo, no_hi = lo_val < -big / 2, hi_val > big / 2
    # plateau half-widths: within the plateau of the bracketing level the weight is 1
    tl = np.asarray(tols, float)
    lo_pl = np.where(no_lo, 0, lo_val + tl[lo_idx]); hi_pl = np.where(no_hi, 0, hi_val - tl[hi_idx])
    t = np.clip((L - lo_pl) / np.maximum(hi_pl - lo_pl, 1e-6), 0, 1)
    W_ = np.zeros((H, W, 4))
    ii, jj = np.indices((H, W))
    w_hi = np.where(no_lo, 1.0, np.where(no_hi, 0.0, t))
    i_hi = np.where(no_lo, hi_idx, np.where(no_hi, lo_idx, hi_idx))
    i_lo = np.where(no_hi, lo_idx, np.where(no_lo, hi_idx, lo_idx))
    W_[ii, jj, i_lo] += 1.0 - w_hi
    W_[ii, jj, i_hi] += w_hi
    return W_


def pack(Wt):
    """Weights (H, W, 4) -> RGB map uint8 (c1, c2, white); black = remainder. Rounds so the three never exceed 255."""
    q = np.rint(Wt[..., 1:] * 255).astype(np.int32)
    s = q.sum(-1)
    over = s > 255
    if over.any():                           # take the excess off the largest channel
        k = np.argmax(q, axis=-1)
        ii, jj = np.indices(k.shape)
        q[ii, jj, k] -= np.where(over, s - 255, 0)
    return q.astype(np.uint8)


def recolour(m, c):
    """map (H,W,3) uint8 + colours for [black, c1, c2, white] (rgb tuples) -> uint8 image."""
    w = m.astype(np.float64) / 255
    wb = 1 - w.sum(-1, keepdims=True)
    out = wb * np.asarray(c[0], float) + w[..., 0:1] * np.asarray(c[1], float) + w[..., 1:2] * np.asarray(c[2], float) + w[..., 2:3] * np.asarray(c[3], float)
    return np.clip(out + .5, 0, 255).astype(np.uint8)


JOBS = {
    # name: (source, levels [black, c1, c2, white], plateau half-widths)
    'flame-door-map.png': ('flame-final-door.jpg', [0, 51, 92, 254], [7, 8, 8, 7]),
    'flame-win-map.png': ('flame-final-window.png', [0, 51, 71, 255], [5, 4, 4, 5]),
}

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (src, levels, tols) in JOBS.items():
        img = Image.open(ROOT / 'src/data/masters' / src).convert('RGB')
        L = np.asarray(img.convert('L'), dtype=np.float64)
        m = pack(weights(L, levels, tols))
        Image.fromarray(m, 'RGB').save(OUT / name, optimize=True)
        rec = recolour(m, [(0, 0, 0), (levels[1],) * 3, (levels[2],) * 3, (255, 255, 255)])
        d = np.abs(rec.astype(int) - np.asarray(img).astype(int)).max(-1)
        print(f'{name}: {img.size}  mean abs diff {d.mean():.3f}  >12: {(d > 12).sum()} px  >40: {(d > 40).sum()} px  max {d.max()}')
