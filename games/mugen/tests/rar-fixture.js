import { crc32 } from 'node:zlib';

// A real RAR 4 archive using the store method, decoded by UnRAR in tests.
export function rarFixture(files) {
  const header = (type, flags, body) => {
    const bytes = Buffer.alloc(7 + body.length);
    bytes[2] = type;
    bytes.writeUInt16LE(flags, 3);
    bytes.writeUInt16LE(bytes.length, 5);
    body.copy(bytes, 7);
    bytes.writeUInt16LE(crc32(bytes.subarray(2)) & 0xffff, 0);
    return bytes;
  };
  const chunks = [Buffer.from('526172211a0700', 'hex'), header(0x73, 0, Buffer.alloc(6))];
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = Buffer.from(file.data ?? '');
    const body = Buffer.alloc(25 + name.length);
    body.writeUInt32LE(data.length, 0);
    body.writeUInt32LE(file.size ?? data.length, 4);
    body[8] = 3; // Unix host
    body.writeUInt32LE(crc32(data), 9);
    body[17] = 20;
    body[18] = 0x30; // stored
    body.writeUInt16LE(name.length, 19);
    body.writeUInt32LE(0x81a4, 21);
    name.copy(body, 25);
    chunks.push(header(0x74, 0x8000 | (file.encrypted ? 4 : 0), body), data);
  }
  chunks.push(header(0x7b, 0, Buffer.alloc(0)));
  return Buffer.concat(chunks);
}
