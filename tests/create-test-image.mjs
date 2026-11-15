import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const output = resolve('tests/fixtures/synthetic-radiograph.png');
const outputSecond = resolve('tests/fixtures/synthetic-radiograph-detail.png');
const width = 960;
const height = 480;
const bytes = Buffer.alloc((width * 3 + 1) * height);
for (let y = 0; y < height; y += 1) {
  const row = y * (width * 3 + 1);
  bytes[row] = 0;
  for (let x = 0; x < width; x += 1) {
    const arch = Math.abs(y - (220 + 70 * Math.sin((x / width) * Math.PI * 2)));
    const toothBand = Math.floor(x / 54) % 2 === 0 ? 32 : 0;
    const value = Math.max(12, Math.min(225, 42 + toothBand + (arch < 48 ? 120 - arch : 0) + Math.round(18 * Math.sin(x / 25))));
    const index = row + 1 + x * 3;
    bytes[index] = value;
    bytes[index + 1] = value;
    bytes[index + 2] = value;
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return result;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;
ihdr[9] = 2;
mkdirSync(dirname(output), { recursive: true });
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(bytes)),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(output, png);
writeFileSync(outputSecond, png);
console.log(`${output}\n${outputSecond}`);
