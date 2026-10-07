import * as fs from 'node:fs';

/**
 * Reads image dimensions from PNG or JPEG headers without loading the image.
 * Throws for unsupported formats.
 */
export function imageSize(filePath: string): { width: number; height: number } {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(64);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    if (read < 24) {
      throw new Error('file too small to be an image');
    }

    // PNG: 8-byte signature, then IHDR length(4) type(4) width(4) height(4)
    const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (head.subarray(0, 8).equals(PNG_SIG)) {
      return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    }

    // JPEG: scan for a start-of-frame marker.
    if (head[0] === 0xff && head[1] === 0xd8) {
      const buf = Buffer.alloc(256 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      let off = 2;
      while (off + 9 < n) {
        if (buf[off] !== 0xff) {
          off += 1;
          continue;
        }
        const marker = buf[off + 1];
        // SOF0..SOF15 except DHT(0xC4), JPG(0xC8), DAC(0xCC)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
        }
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
          off += 2;
          continue;
        }
        const segLen = buf.readUInt16BE(off + 2);
        off += 2 + segLen;
      }
      throw new Error('no SOF marker found in JPEG');
    }

    throw new Error('unsupported image format (PNG and JPEG only)');
  } finally {
    fs.closeSync(fd);
  }
}
