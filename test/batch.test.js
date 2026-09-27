import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm, readdir, symlink, link, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {inspectBatch, readManifest, batchExitCode, formatBatch, BATCH_LIMITS} from '../src/batch.js';
import {Program} from '../scripts/programs.js';
import {sb3} from '../scripts/zip.js';
const cli = new URL('../bin/scratch-bridge.js', import.meta.url).pathname;
const invoke = args => spawnSync(process.execPath, [cli, 'inspect-batch', ...args], {encoding: 'utf8', timeout: 10000});
async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-batch-'));
  try {
    const p = new Program();
    await writeFile(join(dir, 'ok.sb3'), sb3(p.finish([p.set('result', p.literal(7))])));
    const infinite = new Program();
    await writeFile(join(dir, 'infinite.json'), JSON.stringify(infinite.finish([infinite.repeat(infinite.literal('Infinity'), [])])));
    await writeFile(join(dir, 'bad.sb3'), 'not a ZIP');
    const manifest = async files => {
      const path = join(dir, 'manifest.json');
      await writeFile(path, JSON.stringify({schemaVersion: 1, files: files.map((path, i) => ({id: `p${i}`, path}))})); return path;
    };
    await fn({dir, manifest});
  } finally { await rm(dir, {recursive: true, force: true}); }
}

test('batch preserves ordering, isolates failures, skips duplicate paths, and never executes', () => fixture(async ({dir, manifest}) => {
  const path = await manifest(['bad.sb3', 'ok.sb3', './ok.sb3', 'absent.sb3', 'infinite.json']);
  const before = await readFile(join(dir, 'ok.sb3'));
  const r = await inspectBatch(path);
  assert.deepEqual(r.entries.map(e => e.status), ['incomplete', 'compatible', 'skipped', 'incomplete', 'compatible']);
  assert.deepEqual(r.entries.map(e => e.reason), ['INVALID_ARCHIVE', null, 'DUPLICATE_INPUT', 'IO_ERROR', null]);
  assert.equal(r.entries[1].compilerCheck, 'accepted'); assert.equal(r.entries[4].compilerCheck, 'accepted');
  assert.equal(r.complete, false); assert.equal(r.compatible, false); assert.equal(batchExitCode(r), 2);
  assert.deepEqual(await inspectBatch(path), r);
  assert.deepEqual(await readFile(join(dir, 'ok.sb3')), before);
  assert.match(formatBatch(r), /2\/5 compatible/);
  assert.equal(r.projectBlockerFrequency.INVALID_ARCHIVE, 1);
}));

test('file count, total bytes, expanded bytes, traversal, report, and time budgets fail closed', () => fixture(async ({dir, manifest}) => {
  const path = await manifest(['ok.sb3', 'infinite.json']);
  let r = await inspectBatch(path, {limits: {maxFiles: 1}});
  assert.equal(r.entries[1].reason, 'FILE_LIMIT');
  const inputSize = (await readFile(join(dir, 'ok.sb3'))).length;
  r = await inspectBatch(path, {limits: {maxTotalInputBytes: inputSize}});
  assert.equal(r.entries[0].compatible, true); assert.equal(r.entries[1].reason, 'TOTAL_INPUT_LIMIT');
  r = await inspectBatch(path, {limits: {maxTotalExpandedBytes: 1}});
  assert.equal(r.entries[0].reason, 'ARCHIVE_LIMIT'); assert.equal(r.entries[1].reason, 'TOTAL_EXPANDED_LIMIT');
  r = await inspectBatch(path, {limits: {maxTotalWork: 1}});
  assert.equal(r.entries[0].compatible, false); assert.equal(r.entries[1].reason, 'TOTAL_WORK_LIMIT');
  r = await inspectBatch(path, {limits: {maxFileMs: 1}});
  assert.equal(r.entries[0].reason, 'TIMEOUT'); assert.equal(r.compatible, false);
  r = await inspectBatch(path, {limits: {maxTotalMs: 1}});
  assert.equal(r.complete, false); assert.equal(r.entries[1].reason, 'TOTAL_TIMEOUT');
  const many = await manifest(Array.from({length: 1000}, () => 'ok.sb3'));
  r = await inspectBatch(many, {limits: {maxBatchReportBytes: 4096}});
  assert.equal(r.complete, false); assert.ok(r.omittedEntries > 0);
  assert.equal(r.counts.reported + r.counts.omitted, 1000);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) + 1 <= 4096);
  assert.ok(Buffer.byteLength(formatBatch(r)) <= 4096);
}));

test('path escape, symlink escape, directories and aliases are explicit outcomes', () => fixture(async ({dir, manifest}) => {
  await symlink('/tmp', join(dir, 'escape'));
  await symlink(join(dir, 'ok.sb3'), join(dir, 'alias.sb3'));
  const path = await manifest(['../outside.sb3', '/tmp/absolute.sb3', 'escape/outside.sb3', '.', 'ok.sb3', 'alias.sb3']);
  const r = await inspectBatch(path);
  assert.equal(r.entries[0].reason, 'PATH_OUTSIDE_ROOT'); assert.equal(r.entries[1].reason, 'PATH_OUTSIDE_ROOT');
  assert.equal(r.entries[2].compatible, false); assert.equal(r.entries[3].reason, 'IO_ERROR');
  assert.equal(r.entries[4].compatible, true); assert.equal(r.entries[5].reason, 'DUPLICATE_INPUT');
}));

test('pre-abort and active abort produce partial reports and await worker cleanup', () => fixture(async ({dir, manifest}) => {
  const path = await manifest(['ok.sb3', 'infinite.json']);
  const before = await readdir(dir);
  const pre = new AbortController(); pre.abort();
  let r = await inspectBatch(path, {signal: pre.signal});
  assert.ok(r.entries.every(e => e.reason === 'CANCELLED'));
  const active = new AbortController();
  const timer = setTimeout(() => active.abort(), 10);
  try { r = await inspectBatch(path, {signal: active.signal}); }
  finally { clearTimeout(timer); }
  assert.ok(r.entries.every(e => e.reason === 'CANCELLED')); assert.equal(r.compatible, false);
  assert.deepEqual(await readdir(dir), before);
}));

test('CLI JSON/text, exclusive output, collision detection, malformed manifest, and empty batch', () => fixture(async ({dir, manifest}) => {
  const path = await manifest(['ok.sb3']);
  const first = invoke([path, '--json']); assert.equal(first.status, 0, first.stderr);
  assert.equal(invoke([path, '--json']).stdout, first.stdout);
  assert.match(invoke([path]).stdout, /1\/1 compatible/);
  const output = join(dir, 'report.json');
  assert.equal(invoke([path, '--json', '--output', output]).status, 0);
  assert.equal(await readFile(output, 'utf8'), first.stdout);
  assert.equal(invoke([path, '--output', output]).status, 3);
  assert.equal(invoke([path, '--output', path]).status, 3);
  assert.equal(invoke([path, '--output', join(dir, 'ok.sb3')]).status, 3);
  await link(join(dir, 'ok.sb3'), join(dir, 'hardlink'));
  assert.equal(invoke([path, '--output', join(dir, 'hardlink')]).status, 3);
  await symlink(join(dir, 'ok.sb3'), join(dir, 'symlink'));
  assert.equal(invoke([path, '--output', join(dir, 'symlink')]).status, 3);
  await manifest(['missing.sb3']);
  assert.equal(invoke([path, '--output', join(dir, 'missing.sb3')]).status, 3);
  await symlink(dir, join(dir, 'alias-dir'));
  assert.equal(invoke([path, '--output', join(dir, 'alias-dir/missing.sb3')]).status, 3);
  await assert.rejects(readFile(join(dir, 'missing.sb3')), {code: 'ENOENT'});
  for (const args of [[], [path, '--json', '--json'], [path, '--wat'], [path, '--max-files', '0'], [path, '--max-files', '129'], [path, '--max-batch-report-bytes', '4095']]) assert.equal(invoke(args).status, 3);
  for (const content of ['{', '{"schemaVersion":2,"files":[]}', '{"schemaVersion":1,"files":[{"id":"x","path":"a"},{"id":"x","path":"b"}]}']) {
    await writeFile(path, content); assert.equal(invoke([path]).status, 3);
  }
  await manifest([]);
  assert.equal(invoke([path, '--json']).status, 0);
  const empty = await inspectBatch(path); assert.equal(empty.complete, true); assert.equal(empty.compatible, false);
  await assert.rejects(readManifest(path, 1), {code: 'MANIFEST_LIMIT'});
}));

test('CLI SIGTERM cancels active worker, reports incomplete rows, and creates no scratch files', () => fixture(async ({dir, manifest}) => {
  // Many distinct copies keep the batch active well beyond CLI startup.
  const bytes = await readFile(join(dir, 'ok.sb3'));
  for (let i = 0; i < 20; i++) await writeFile(join(dir, `${i}.sb3`), bytes);
  const path = await manifest(Array.from({length: 20}, (_, i) => `${i}.sb3`));
  const ready = join(dir, 'ready.mjs');
  await writeFile(ready, `const on = process.on;
process.on = function(event, listener) {
  const result = on.call(this, event, listener);
  if (event === 'SIGTERM') process.send?.('ready');
  return result;
};\n`);
  const before = await readdir(dir);
  const r = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', ready, cli, 'inspect-batch', path, '--json'], {stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    let timer;
    child.once('message', message => { assert.equal(message, 'ready'); timer = setTimeout(() => child.kill('SIGTERM'), 20); });
    const watchdog = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Cancellation timed out')); }, 5000);
    child.on('error', reject);
    child.on('close', (code, signal) => { clearTimeout(timer); clearTimeout(watchdog); resolve({code, signal, stdout, stderr}); });
  });
  assert.equal(r.code, 2, JSON.stringify(r));
  const report = JSON.parse(r.stdout); assert.equal(report.complete, false);
  assert.ok(report.entries.some(e => e.reason === 'CANCELLED'));
  assert.deepEqual(await readdir(dir), before);
}));

test('cloud findings retain INVALID_VARIABLE while broadcasts/extensions use UNSUPPORTED_FEATURE', () => fixture(async ({dir, manifest}) => {
  const paths = [];
  for (const kind of ['cloud', 'broadcast', 'extension']) {
    const p = new Program(); const project = p.finish([p.set('result', p.literal(1))]);
    if (kind === 'cloud') project.targets[0].variables.result.push(true);
    if (kind === 'broadcast') project.targets[0].broadcasts = {message: 'DO_NOT_REPORT_BROADCAST_NAME'};
    if (kind === 'extension') project.extensions = ['pen'];
    project.targets[0].name = 'DO_NOT_REPORT_TARGET_NAME';
    project.targets[0].comments = {private: {text: 'DO_NOT_REPORT_COMMENT'}};
    const path = `${kind}.json`; paths.push(path);
    await writeFile(join(dir, path), JSON.stringify(project));
  }
  const r = await inspectBatch(await manifest(paths));
  assert.ok(r.entries[0].blockerCounts.INVALID_VARIABLE);
  assert.ok(r.entries[1].blockerCounts.UNSUPPORTED_FEATURE);
  assert.ok(r.entries[2].blockerCounts.UNSUPPORTED_FEATURE);
  assert.ok(r.entries.every(e => !e.compatible));
  assert.doesNotMatch(JSON.stringify(r), /DO_NOT_REPORT/);
}));
