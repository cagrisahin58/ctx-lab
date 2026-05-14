import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

const size = 256;
const output = join(process.cwd(), "electron", "assets", "icon.ico");

const palette = {
  bg: [11, 16, 32, 255],
  bg2: [19, 32, 54, 255],
  line: [229, 244, 255, 255],
  muted: [128, 164, 188, 255],
  teal: [45, 212, 191, 255],
  amber: [245, 158, 11, 255],
  red: [239, 68, 68, 255]
};

const pixels = new Uint8Array(size * size * 4);
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const offset = (y * size + x) * 4;
    const rounded = insideRoundRect(x, y, 0, 0, size, size, 48);
    const color = rounded ? mix(palette.bg, palette.bg2, y / size) : [0, 0, 0, 0];
    pixels.set(color, offset);
  }
}

rect(48, 62, 134, 18, 5, palette.line);
rect(48, 102, 86, 18, 5, palette.line);
rect(48, 142, 122, 18, 5, palette.line);
rect(48, 182, 72, 12, 4, palette.muted);
circle(194, 124, 26, palette.teal);
circle(168, 176, 15, palette.amber);
circle(206, 184, 10, palette.red);

const png = makePng(size, size, pixels);
const ico = Buffer.alloc(22 + png.length);
ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico.writeUInt8(0, 6);
ico.writeUInt8(0, 7);
ico.writeUInt8(0, 8);
ico.writeUInt8(0, 9);
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
png.copy(ico, 22);

await mkdir(dirname(output), { recursive: true });
await writeFile(output, ico);
console.log(`icon written: ${output}`);

function rect(x, y, width, height, radius, color) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      if (insideRoundRect(xx, yy, x, y, width, height, radius)) setPixel(xx, yy, color);
    }
  }
}

function circle(cx, cy, radius, color) {
  const radius2 = radius * radius;
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius2) setPixel(x, y, color);
    }
  }
}

function setPixel(x, y, color) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  pixels.set(color, (y * size + x) * 4);
}

function insideRoundRect(px, py, x, y, width, height, radius) {
  const right = x + width - 1;
  const bottom = y + height - 1;
  const cx = px < x + radius ? x + radius : px > right - radius ? right - radius : px;
  const cy = py < y + radius ? y + radius : py > bottom - radius ? bottom - radius : py;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function mix(a, b, t) {
  return a.map((value, index) => Math.round(value + (b[index] - value) * t));
}

function makePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, rowStart + 1);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
