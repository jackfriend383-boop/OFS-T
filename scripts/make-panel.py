"""One-off tool: samples the colour of the bare door panel (shown in the gap of the door sticker) from each car photo.
Run again only if the car photos change:  python3 scripts/make-panel.py   (needs numpy, opencv-python, pillow)
Writes src/data/panel.json, one colour per car colour + angle (and 'pop')."""
import numpy as np, cv2, json, glob, os
from PIL import Image
I = 'public/assets/img/'
rect = lambda x, y, w, h: np.array([[x, y], [x+w, y], [x+w, y+h], [x, y+h]], np.float32)
DQ = {'front34': [[1012.4,645.8],[1242.8,632.6],[1241,731.7],[1010.9,751.5]], 'back': [[731.3,634.9],[829.4,645.7],[832.6,747.7],[733.8,727.1]],
      'browncolor-front34': [[1081.1,649.4],[1281.8,629.2],[1283.2,732.3],[1084.1,753]]}
def sample(im, poly, scale=1.0):
    H, W = im.shape[:2]; m = np.zeros((H, W), np.uint8); cv2.fillPoly(m, [poly.astype(np.int32)], 255)
    k = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2*r+1, 2*r+1))
    ring = cv2.dilate(m, k(int(18*scale))) & ~cv2.dilate(m, k(int(7*scale)))  # band just outside the door
    px = im[ring > 0]; return px[px.sum(1) > 40]
hexc = lambda px, k=1.0: '#%02x%02x%02x' % tuple(int(v * k) for v in np.median(px, 0))
DARKER = {'yellow': 0.5, 'purple': 0.5}  # the Ami 2025 black/yellow and black/purple show a darker gap (as asked)
out = {}
for f in sorted(glob.glob(I + 'ami/*.webp')):
    n = os.path.basename(f)[:-5]; trim, ang = n.rsplit('-', 1)
    if ang == 'front': continue
    im = np.array(Image.open(f).convert('RGB'))
    out[n] = hexc(sample(im, rect(876, 658, 271, 104) if ang == 'side' else np.array(DQ.get(n, DQ[ang]), np.float32)), DARKER.get(trim, 1.0))
im = np.array(Image.open(I + 'ami-pop.webp').convert('RGB')); s = 1376.8 / 1721
out['pop'] = hexc(sample(im, ((rect(878, 657, 267, 106) - [555.9, 294.8]) / s).astype(np.float32), 1 / s))
json.dump(out, open('src/data/panel.json', 'w'), indent=1)
