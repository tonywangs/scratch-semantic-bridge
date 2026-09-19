import {inflateRawSync} from 'node:zlib';
import {open} from 'node:fs/promises';
import {fail, positiveLimit} from './errors.js';

export const ARCHIVE_LIMITS = Object.freeze({maxArchiveBytes: 16 * 1024 * 1024, maxProjectBytes: 4 * 1024 * 1024, maxExpandedBytes: 64 * 1024 * 1024, maxEntries: 2048});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Read only project.json. Asset paths are never written to the filesystem.
export function readSb3(bytes, options = {}) {
  const limits = {...ARCHIVE_LIMITS, ...options};
  for (const [key, value] of Object.entries(limits)) positiveLimit(value, key);
  if (!Buffer.isBuffer(bytes)) fail('INVALID_ARCHIVE', 'Expected an sb3 Buffer');
  if (bytes.length > limits.maxArchiveBytes) fail('ARCHIVE_LIMIT', 'Compressed archive exceeds maxArchiveBytes');
  const bad = message => fail('INVALID_ARCHIVE', message);
  const bounds = (offset, length) => { if (offset < 0 || offset + length > bytes.length) bad('Truncated ZIP structure'); };
  const u16 = p => { bounds(p, 2); return bytes.readUInt16LE(p); };
  const u32 = p => { bounds(p, 4); return bytes.readUInt32LE(p); };
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === bytes.length) { end = p; break; }
  }
  if (end < 0) bad('ZIP end record missing');
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) bad('Multi-disk ZIP is unsupported');
  const count = u16(end + 10), size = u32(end + 12), start = u32(end + 16);
  if (count === 65535 || size === 0xffffffff || start === 0xffffffff) bad('ZIP64 is unsupported');
  if (count > limits.maxEntries) fail('ARCHIVE_LIMIT', 'Archive exceeds maxEntries');
  if (start + size !== end) bad('Invalid central directory bounds');
  let p = start, total = 0, project;
  const names = new Set();
  const ranges = [];
  for (let i = 0; i < count; i++) {
    bounds(p, 46);
    if (u32(p) !== 0x02014b50) bad('Invalid central directory entry');
    const flags = u16(p + 8), method = u16(p + 10), crc = u32(p + 16);
    const compressed = u32(p + 20), expanded = u32(p + 24);
    const nameLength = u16(p + 28), extraLength = u16(p + 30), commentLength = u16(p + 32), local = u32(p + 42);
    if (u16(p + 34) || compressed === 0xffffffff || expanded === 0xffffffff || local === 0xffffffff) bad('ZIP64 or multi-disk entry is unsupported');
    bounds(p + 46, nameLength + extraLength + commentLength);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLength);
    const name = nameBytes.toString('utf8');
    if (names.has(name)) bad(`Duplicate ZIP entry: ${name}`);
    names.add(name);
    if (flags & ~0x080e || flags & 1) bad('Unsupported ZIP flags or encryption');
    if (method !== 0 && method !== 8) bad('Only stored and deflated ZIP entries are supported');
    total += expanded;
    if (total > limits.maxExpandedBytes) fail('ARCHIVE_LIMIT', 'Declared expanded archive exceeds maxExpandedBytes');
    bounds(local, 30);
    if (u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) bad('Central and local ZIP headers disagree');
    const localNameLength = u16(local + 26), dataStart = local + 30 + localNameLength + u16(local + 28);
    bounds(local + 30, localNameLength);
    if (!nameBytes.equals(bytes.subarray(local + 30, local + 30 + localNameLength))) bad('Central and local ZIP names disagree');
    if (!(flags & 8) && (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== expanded)) bad('Central and local ZIP sizes or CRC disagree');
    if (dataStart + compressed > start) bad('ZIP entry overlaps central directory');
    ranges.push([local, dataStart + compressed]);
    if (name === 'project.json') {
      if (expanded > limits.maxProjectBytes) fail('ARCHIVE_LIMIT', 'project.json exceeds maxProjectBytes');
      const packed = bytes.subarray(dataStart, dataStart + compressed);
      try { project = method === 0 ? packed : inflateRawSync(packed, {maxOutputLength: limits.maxProjectBytes}); }
      catch (error) { fail(error.code === 'ERR_BUFFER_TOO_LARGE' ? 'ARCHIVE_LIMIT' : 'INVALID_ARCHIVE', 'Cannot inflate project.json within its limit'); }
      if (project.length !== expanded || crc32(project) !== crc) bad('project.json size or CRC mismatch');
    }
    p += 46 + nameLength + extraLength + commentLength;
  }
  if (p !== start + size) bad('Central directory size mismatch');
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) bad('Overlapping ZIP entries');
  if (!project) bad('Root project.json is missing');
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(project)); }
  catch { fail('INVALID_JSON', 'project.json must be valid UTF-8 JSON'); }
}

export async function loadSb3(path, options = {}) {
  const max = positiveLimit(options.maxArchiveBytes ?? ARCHIVE_LIMITS.maxArchiveBytes, 'maxArchiveBytes');
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile()) fail('INVALID_ARCHIVE', 'Input must be a regular file');
    if (stat.size > max) fail('ARCHIVE_LIMIT', 'Compressed archive exceeds maxArchiveBytes');
    // Bounded read also protects against growth between stat and read.
    const buffer = Buffer.alloc(Math.min(stat.size + 1, max + 1));
    let length = 0;
    while (length < buffer.length) {
      const {bytesRead} = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > stat.size) fail('ARCHIVE_LIMIT', 'Input grew while reading');
    return readSb3(buffer.subarray(0, length), options);
  } finally { await file.close(); }
}
