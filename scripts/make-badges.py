"""Makes the small pictures the configurator needs to recolour the Citroën logo on the front and back of the Ami 2025.
For every car colour and view it finds the logo in the photo, removes it (inpainting) and saves:
  badge-<trim>-<view>-bg.png : the photo patch without the logo (drawn over the original)
  badge-<trim>-<view>-a.png  : the logo as a shape (alpha) with its shading, recoloured in the browser
and badges.json with where each patch goes (in the 2000x1125 photo space).  Dev tool: python3 scripts/make-badges.py
"""
import json, sys, numpy as np, cv2
from PIL import Image
SRC = sys.argv[1] if len(sys.argv) > 1 else 'public/assets/img/ami/'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'public/assets/img/badge/'
import os; os.makedirs(OUT, exist_ok=True)
GUESS = {'front': (1000, 596), 'back': (1176, 564), 'front34': (656, 554)}
GUESS_OVR = {('browncolor', 'front34'): (1000+ (1210-990)//1 - 0, 0)}  # unused placeholder
meta = {}
def find(rgb, a, guess, R=150):
    x, y = guess
    x0, y0 = max(0, x-R), max(0, y-R); crop = rgb[y0:y+R, x0:x+R].astype(np.float32)
    bg = cv2.medianBlur(crop.astype(np.uint8), 41).astype(np.float32)
    d = np.linalg.norm(crop-bg, axis=2)
    m = (d > 38).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, lab, st, cen = cv2.connectedComponentsWithStats(m)
    best = None
    for i in range(1, n):
        ar = st[i, 4]
        if ar < 150: continue
        cx, cy = cen[i]; dist = np.hypot(cx-(x-x0), cy-(y-y0))
        if best is None or dist < best[0]: best = (dist, i)
    if best is None: return None
    i = best[1]; comp = (lab == i).astype(np.uint8)
    ys, xs = np.nonzero(comp); return x0+xs.min(), y0+ys.min(), x0+xs.max(), y0+ys.max()
def find_keyed(rgb, guess, trim, R=40):
    x, y = guess; x0, y0 = x-R, y-R
    crop = rgb[y0:y+R, x0:x+R].astype(np.int32)
    sat = crop.max(2)-crop.min(2); lum = crop.mean(2)
    key = (lum > 140) & (sat < 50) if trim == 'purple' else (sat > (40 if trim == 'yellow' else 75))
    key = cv2.morphologyEx(key.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, lab, st, cen = cv2.connectedComponentsWithStats(key)
    ids = [i for i in range(1, n) if st[i, 4] >= 25]
    if not ids: return None
    big1 = max(ids, key=lambda i: st[i, 4]); ids = [i for i in ids if np.hypot(*(cen[i]-cen[big1])) < 26]
    keep = np.isin(lab, ids); ys, xs = np.nonzero(keep)
    full = np.zeros(rgb.shape[:2], np.uint8); full[y0:y+R, x0:x+R] = keep
    return x0+xs.min(), y0+ys.min(), x0+xs.max(), y0+ys.max(), full
for trim in ['yellow', 'purple', 'brown', 'browncolor']:
    for ang in ['front', 'back', 'front34']:
        im = Image.open(f'{SRC}{trim}-{ang}.webp').convert('RGBA'); arr = np.array(im); rgb = arr[:, :, :3]
        g = GUESS[ang]
        if trim == 'brown' and ang == 'front34': g = (649, 561)
        if trim == 'browncolor' and ang == 'front34': g = (693, 557)
        KEY = None
        if ang == 'front34':
            r = find_keyed(rgb, g, trim); bb = r[:4] if r else None
        else: bb = find(rgb, arr[:, :, 3], g)
        print(trim, ang, bb)
        if not bb: continue
        x0, y0, x1, y1 = bb; P = 14
        X0, Y0, X1, Y1 = x0-P, y0-P, x1+P+1, y1+P+1
        crop = rgb[Y0:Y1, X0:X1].copy()
        bgm = cv2.medianBlur(crop, 41 if min(crop.shape[:2]) > 41 else 21).astype(np.float32)
        diff = np.linalg.norm(crop.astype(np.float32)-bgm, axis=2)
        mask = (diff > 34).astype(np.uint8)
        if ang == 'front34':
            km = r[4][Y0:Y1, X0:X1]
            mask = cv2.dilate(km, np.ones((3, 3), np.uint8))
            diff = np.where(mask > 0, diff, 0)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        big = cv2.dilate(mask, np.ones((5, 5), np.uint8))
        clean = cv2.inpaint(crop, big, 4, cv2.INPAINT_NS).astype(np.float32)
        # coverage of the logo colour in every pixel
        top = np.argsort(diff.ravel())[-max(20, int(mask.sum()*.15)):]
        C0 = crop.reshape(-1, 3)[top].astype(np.float32).mean(0); Bm = np.median(clean[big == 0], axis=0) if (big == 0).any() else clean.mean((0, 1))
        v = C0-Bm; den = float((v*v).sum()) or 1.0
        alpha = np.clip(((crop.astype(np.float32)-clean)*v).sum(2)/den, 0, 1)
        alpha[big == 0] = 0
        alpha = np.clip((alpha-.04)/.9, 0, 1)
        # shading of the logo (glossy highlights) relative to its average
        lum = crop.astype(np.float32) @ np.array([.299, .587, .114], np.float32)
        l0 = float(lum[alpha > .8].mean()) if (alpha > .8).any() else 1.0
        shade = np.clip(lum/ max(l0, 1.0), .75, 1.25) if trim != 'purple' else np.clip(lum/max(l0, 1.0), .8, 1.15)
        shade = cv2.GaussianBlur(shade, (0, 0), 1.2)
        # a: grey = shade, alpha = coverage
        a_img = np.zeros(crop.shape[:2]+(4,), np.uint8)
        a_img[:, :, :3] = np.clip(shade*204, 0, 255).astype(np.uint8)[:, :, None]; a_img[:, :, 3] = (alpha*255).astype(np.uint8)
        # bg patch: inpainted pixels inside big mask, feathered
        feather = cv2.GaussianBlur(big.astype(np.float32), (0, 0), 1.6); feather = np.clip(feather*1.6, 0, 1)
        bg_img = np.dstack([np.clip(clean, 0, 255).astype(np.uint8), (feather*255).astype(np.uint8)])
        k = f'{trim}-{ang}'
        Image.fromarray(bg_img, 'RGBA').save(f'{OUT}badge-{k}-bg.png', optimize=True)
        Image.fromarray(a_img, 'RGBA').save(f'{OUT}badge-{k}-a.png', optimize=True)
        meta[k] = [int(X0), int(Y0), int(X1-X0), int(Y1-Y0)]
json.dump(meta, open(OUT+'badges.json', 'w'), indent=1)
