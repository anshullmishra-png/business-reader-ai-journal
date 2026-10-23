// Zips /extension into /public/downloads/send-to-journal.zip so readers can
// download it from the Install page. Run `npm run pack-extension` after changing the extension.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'extension');
const out = join(root, 'public', 'downloads', 'send-to-journal.zip');

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(src);

// Minimal ZIP writer (deflate, no extras). Everything sits inside a send-to-journal/ folder.
const local = [];
const central = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(`send-to-journal/${relative(src, file).split(sep).join('/')}`);
  const data = readFileSync(file);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
  head.writeUInt16LE(8, 8); head.writeUInt32LE(0x00210000, 10); // fixed 1980-01-01 timestamp: same input, same zip
  head.writeUInt32LE(crc, 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(name.length, 26);
  local.push(head, name, packed);

  const dir = Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8);
  dir.writeUInt16LE(8, 10); dir.writeUInt32LE(0x00210000, 12);
  dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(data.length, 24);
  dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
  central.push(dir, name);
  offset += head.length + name.length + packed.length;
}
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([...local, centralBuf, end]));
console.log(`[pack-extension] ${files.length} files → ${relative(root, out)}`);
