/* Small baseline JPEG encoder with NO chroma subsampling (4:4:4), for the print files (admin page only).
   Why not canvas.toBlob('image/jpeg'): browsers pick the chroma subsampling themselves (usually 4:2:0, which smears coloured edges), and the
   JFIF resolution cannot be set. This writes what the supplier needs: quality up to 100, every component sampled 1x1, JFIF density in dpi.
   Standard (Annex K) quantisation tables scaled like libjpeg (quality 100 = all ones) and the standard luminance Huffman tables for all
   three components. Colour: JFIF full-range YCbCr, sRGB. */

const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const QL = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 92, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const QC = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, ...new Array(32).fill(99)];

const DC_COUNTS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_COUNTS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_VALUES = [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa];

/* code / length per symbol from the (counts per length, values) description */
function huffman(counts: number[], values: number[]) {
  const code = new Int32Array(256), size = new Uint8Array(256);
  let c = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < counts[len - 1]; i++) { code[values[k]] = c; size[values[k]] = len; c++; k++; }
    c <<= 1;
  }
  return { code, size };
}

const scaleTable = (base: number[], quality: number) => {
  const q = Math.min(100, Math.max(1, Math.round(quality)));
  const s = q < 50 ? 5000 / q : 200 - 2 * q;
  return base.map((v) => Math.min(255, Math.max(1, Math.floor((v * s + 50) / 100))));
};

/* DCT basis: COS[u * 8 + x] = c(u) / 2 * cos((2x + 1) u pi / 16) */
const COS = new Float64Array(64);
for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) COS[u * 8 + x] = (u === 0 ? Math.SQRT1_2 : 1) / 2 * Math.cos(((2 * x + 1) * u * Math.PI) / 16);

export interface JpegOptions { quality?: number; dpi?: number }

/* rgba: width*height*4 bytes. Returns the JPEG file bytes. */
export function encodeJpeg444(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, { quality = 100, dpi = 72 }: JpegOptions = {}): Uint8Array {
  const qL = scaleTable(QL, quality), qC = scaleTable(QC, quality);
  const dcT = huffman(DC_COUNTS, DC_VALUES), acT = huffman(AC_COUNTS, AC_VALUES);
  const bw = Math.ceil(width / 8), bh = Math.ceil(height / 8);

  // ---- output buffer
  let buf = new Uint8Array(Math.max(1 << 16, width * height / 2)), pos = 0;
  const need = (n: number) => { if (pos + n > buf.length) { const nb = new Uint8Array(Math.max(buf.length * 2, pos + n)); nb.set(buf); buf = nb; } };
  const b = (v: number) => { need(1); buf[pos++] = v; };
  const w16 = (v: number) => { b(v >> 8); b(v & 255); };
  const marker = (m: number, len: number) => { b(0xff); b(m); w16(len + 2); };

  b(0xff); b(0xd8); // SOI
  marker(0xe0, 14); [0x4a, 0x46, 0x49, 0x46, 0].forEach(b); b(1); b(1); b(1); w16(dpi); w16(dpi); b(0); b(0); // JFIF 1.01, density in dpi
  for (let t = 0; t < 2; t++) { marker(0xdb, 65); b(t); const tab = t ? qC : qL; for (let i = 0; i < 64; i++) b(tab[ZIGZAG[i]]); } // DQT (8-bit)
  marker(0xc0, 15); b(8); w16(height); w16(width); b(3); [[1, 0], [2, 1], [3, 1]].forEach(([id, tq]) => { b(id); b(0x11); b(tq); }); // SOF0, all components 1x1 = 4:4:4
  marker(0xc4, 17 + 12); b(0x00); DC_COUNTS.forEach(b); DC_VALUES.forEach(b); // DHT DC table 0
  marker(0xc4, 17 + 162); b(0x10); AC_COUNTS.forEach(b); AC_VALUES.forEach(b); // DHT AC table 0
  marker(0xda, 10); b(3); [1, 2, 3].forEach((id) => { b(id); b(0x00); }); b(0); b(63); b(0); // SOS (all components use table 0)

  // ---- entropy coded data
  let acc = 0, nbits = 0;
  const bits = (v: number, n: number) => {
    if (!n) return;
    acc = (acc << n) | (v & ((1 << n) - 1)); nbits += n;
    while (nbits >= 8) { const o = (acc >> (nbits - 8)) & 255; b(o); if (o === 0xff) b(0); nbits -= 8; }
    acc &= (1 << nbits) - 1;
  };
  const cat = (v: number) => { v = Math.abs(v); let n = 0; while (v) { n++; v >>= 1; } return n; };
  const tmp = new Float64Array(64), blk = new Float64Array(64), q = new Int32Array(64), prevDC = [0, 0, 0];
  const planes = [new Float64Array(64), new Float64Array(64), new Float64Array(64)];

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      // gather the 8x8 pixels (edges are repeated) and convert to level-shifted Y, Cb, Cr
      for (let y = 0; y < 8; y++) {
        const sy = Math.min(height - 1, by * 8 + y);
        for (let x = 0; x < 8; x++) {
          const i = (sy * width + Math.min(width - 1, bx * 8 + x)) * 4, r = rgba[i], g = rgba[i + 1], bl = rgba[i + 2], k = y * 8 + x;
          planes[0][k] = 0.299 * r + 0.587 * g + 0.114 * bl - 128;
          planes[1][k] = -0.168736 * r - 0.331264 * g + 0.5 * bl;
          planes[2][k] = 0.5 * r - 0.418688 * g - 0.081312 * bl;
        }
      }
      for (let c = 0; c < 3; c++) {
        const src = planes[c], tab = c ? qC : qL;
        // rows then columns
        for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += src[y * 8 + x] * COS[u * 8 + x]; tmp[y * 8 + u] = s; }
        for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let s = 0; for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[v * 8 + y]; blk[v * 8 + u] = s; }
        for (let i = 0; i < 64; i++) { const z = ZIGZAG[i]; q[i] = Math.round(blk[z] / tab[z]); }
        // DC
        const diff = q[0] - prevDC[c]; prevDC[c] = q[0];
        const dn = cat(diff); bits(dcT.code[dn], dcT.size[dn]); bits(diff < 0 ? diff - 1 : diff, dn);
        // AC
        let run = 0;
        for (let i = 1; i < 64; i++) {
          const v = q[i];
          if (v === 0) { run++; continue; }
          while (run > 15) { bits(acT.code[0xf0], acT.size[0xf0]); run -= 16; }
          const n = cat(v), sym = (run << 4) | n;
          bits(acT.code[sym], acT.size[sym]); bits(v < 0 ? v - 1 : v, n); run = 0;
        }
        if (run) bits(acT.code[0], acT.size[0]); // EOB
      }
    }
  }
  if (nbits) bits(0x7f, 8 - nbits); // pad with 1s
  b(0xff); b(0xd9); // EOI
  return buf.slice(0, pos);
}
