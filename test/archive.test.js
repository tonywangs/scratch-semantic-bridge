import test from 'node:test';
import assert from 'node:assert/strict';
import {readSb3} from '../src/archive.js';
import {zip, sb3} from '../scripts/zip.js';
import {examples} from '../scripts/programs.js';
const project = examples().factorial.project;
test('stored and deflated archives return project JSON', () => {
  for (const deflate of [false, true]) assert.deepEqual(readSb3(zip({'project.json': JSON.stringify(project)}, {deflate})), project);
});
test('compressed, expanded, project and entry count limits fail explicitly', () => {
  const archive = sb3(project);
  for (const options of [{maxArchiveBytes: 1}, {maxProjectBytes: 1}, {maxExpandedBytes: 1}, {maxEntries: 1}]) assert.throws(() => readSb3(archive, options), {code: 'ARCHIVE_LIMIT'});
});
test('actual inflate size is bounded even when metadata lies', () => {
  const archive = zip({'project.json': ' '.repeat(100000)});
  archive.writeUInt32LE(1, 22);
  const central = archive.indexOf(Buffer.from('504b0102', 'hex'));
  archive.writeUInt32LE(1, central + 24);
  assert.throws(() => readSb3(archive, {maxProjectBytes: 100}), {code: 'ARCHIVE_LIMIT'});
});
test('truncations and arbitrary input reject with structured diagnostics', () => {
  const archive = sb3(project);
  for (const length of [0, 1, 4, 20, archive.length - 1]) assert.throws(() => readSb3(archive.subarray(0, length)), {code: 'INVALID_ARCHIVE'});
  assert.throws(() => readSb3(Buffer.from('not a zip')), {code: 'INVALID_ARCHIVE'});
});
test('CRC corruption and header disagreement are detected', () => {
  const archive = zip({'project.json': JSON.stringify(project)}, {deflate: false});
  archive[42] ^= 1;
  assert.throws(() => readSb3(archive), {code: 'INVALID_ARCHIVE'});
  const corrupt = sb3(project); corrupt.writeUInt16LE(99, 8);
  assert.throws(() => readSb3(corrupt), {code: 'INVALID_ARCHIVE'});
});
test('missing project and invalid UTF-8 or JSON are explicit errors', () => {
  assert.throws(() => readSb3(zip({'other.json': '{}'})), {code: 'INVALID_ARCHIVE'});
  for (const content of ['{bad', Buffer.from([0xff])]) assert.throws(() => readSb3(zip({'project.json': content})), {code: 'INVALID_JSON'});
});
test('duplicate names, encryption, ZIP64 and multi-disk are rejected', () => {
  const duplicate = zip({'project.json': '{}', 'project.jsom': '{}'});
  for (let index = 0; (index = duplicate.indexOf('project.jsom', index)) !== -1; index++) duplicate.write('project.json', index);
  assert.throws(() => readSb3(duplicate), {code: 'INVALID_ARCHIVE'});
  for (const edit of [b => b.writeUInt16LE(1, b.length - 18), b => b.writeUInt32LE(0xffffffff, b.length - 6), b => { b.writeUInt16LE(1, 6); b.writeUInt16LE(1, b.indexOf(Buffer.from('504b0102', 'hex')) + 8); }]) {
    const archive = zip({'project.json': '{}'}); edit(archive);
    assert.throws(() => readSb3(archive), {code: 'INVALID_ARCHIVE'});
  }
});
test('asset paths are ignored and never extracted', () => {
  assert.deepEqual(readSb3(zip({'project.json': '{}', '../../not-written': 'content'})), {});
});
