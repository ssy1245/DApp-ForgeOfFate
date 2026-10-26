import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

// Read-only PNG inspection, including filtered alpha values away from corners.
export function inspectRgbaPng(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8); assert.equal(bytes[25], 6); assert.equal(bytes[28], 0);
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const filtered = inflateSync(Buffer.concat(chunks));
  const stride = width * 4, pixels = new Uint8Array(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  let position = 0;
  for (let y = 0; y < height; y++) {
    const filter = filtered[position++];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const left = x >= 4 ? pixels[i - 4] : 0, up = y ? pixels[i - stride] : 0, corner = y && x >= 4 ? pixels[i - stride - 4] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, corner);
      pixels[i] = (filtered[position++] + predictor) & 255;
    }
  }
  let transparent = 0, opaque = 0, partial = 0, edgeMax = 0;
  const bounds = { left: width, right: -1, top: height, bottom: -1 };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = pixels[(y * width + x) * 4 + 3];
    if (alpha === 0) transparent++; else if (alpha === 255) opaque++; else partial++;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edgeMax = Math.max(edgeMax, alpha);
    if (alpha >= 250) {
      bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x);
      bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
    }
  }
  return { width, height, transparent, opaque, partial, edgeMax, bounds, pixel: (x, y) => [...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)] };
}
