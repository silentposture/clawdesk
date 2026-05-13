import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const size = 256;
const data = Buffer.alloc(size * size * 4);

for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const index = (y * size + x) * 4;
    const dx = x - size / 2;
    const dy = y - size / 2;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const inside = distance < 108;
    const ring = distance > 82 && distance < 104;

    data[index] = inside ? (ring ? 18 : 15) : 0;
    data[index + 1] = inside ? (ring ? 128 : 111) : 0;
    data[index + 2] = inside ? (ring ? 105 : 92) : 0;
    data[index + 3] = inside ? 255 : 0;

    if (inside && Math.abs(dx) < 18 && Math.abs(dy) < 68) {
      data[index] = 247;
      data[index + 1] = 248;
      data[index + 2] = 245;
    }
    if (inside && Math.abs(dy) < 18 && Math.abs(dx) < 68) {
      data[index] = 247;
      data[index + 1] = 248;
      data[index + 2] = 245;
    }
  }
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const name = Buffer.from(type);
  const crcInput = Buffer.concat([name, body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([length, name, body, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
header[10] = 0;
header[11] = 0;
header[12] = 0;

const scanlines = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y += 1) {
  const rowStart = y * (size * 4 + 1);
  scanlines[rowStart] = 0;
  data.copy(scanlines, rowStart + 1, y * size * 4, (y + 1) * size * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(scanlines, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

await mkdir("src-tauri/icons", { recursive: true });
await writeFile("src-tauri/icons/icon.png", png);

const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);

const icoEntry = Buffer.alloc(16);
icoEntry[0] = 0;
icoEntry[1] = 0;
icoEntry[2] = 0;
icoEntry[3] = 0;
icoEntry.writeUInt16LE(1, 4);
icoEntry.writeUInt16LE(32, 6);
icoEntry.writeUInt32LE(png.length, 8);
icoEntry.writeUInt32LE(icoHeader.length + icoEntry.length, 12);

await writeFile("src-tauri/icons/icon.ico", Buffer.concat([icoHeader, icoEntry, png]));
console.log("generated src-tauri/icons/icon.png and src-tauri/icons/icon.ico");
