import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inspect, inspectFile, formatInspection, inspectionExitCode, INSPECTION_LIMITS} from '../src/inspect.js';
import {compile, validate} from '../src/compiler.js';
import {Program} from '../scripts/programs.js';
import {inspectionCases, inspectionCase, inspectionKinds} from '../scripts/inspection-cases.js';
import {sb3} from '../scripts/zip.js';

import {checkExpectation} from '../scripts/inspection-expectations.js';

for (const kind of inspectionKinds) test(`independent seeded inspection expectations: ${kind}`, () => {
  for (const fixture of inspectionCases()) {
    if (fixture.kind !== kind) continue;
    const before = JSON.stringify(fixture.project), report = inspect(fixture.project);
    checkExpectation(fixture, report);
    assert.equal(JSON.stringify(fixture.project), before);
    assert.equal(JSON.stringify(inspect(fixture.project)), JSON.stringify(report));
    assert.ok(Buffer.byteLength(JSON.stringify(report)) + 1 <= report.limits.maxReportBytes);
    for (const d of report.diagnostics.filter(d => d.blockId)) { assert.equal(typeof d.targetIndex, 'number'); assert.equal(typeof d.opcode, 'string'); assert.equal(typeof d.scriptId, 'string'); }
  }
});

test('compiler generated artifacts match hashes captured before validation extraction', async () => {
  const baseline = JSON.parse(await readFile(new URL('./fixtures/compiler-artifacts.json', import.meta.url)));
  for (const [name, expected] of Object.entries(baseline)) {
    const rows = (await readFile(new URL(`./fixtures/${name}.jsonl`, import.meta.url), 'utf8')).trim().split('\n').map(JSON.parse);
    const digest = createHash('sha256');
    assert.equal(rows.length, expected.count);
    for (const {project} of rows) { validate(project); digest.update(JSON.stringify(compile(project))); assert.equal(inspect(project).compatible, true); }
    assert.equal(digest.digest('hex'), expected.sha256);
  }
});

test('explicit limits never yield compatibility or claim complete coverage', () => {
  const project = inspectionCase(1, 'supported').project;
  for (const options of [{maxBlocks: 1}, {maxTargets: 1, maxWork: 1}, {maxScripts: 1}, {maxDataNodes: 1}, {maxDataDepth: 1}, {maxProjectBytes: 100}, {maxMetadataChars: 1}, {maxDepth: 1}]) {
    const r = inspect(project, options); assert.equal(r.compatible, false, JSON.stringify(options)); assert.equal(r.complete, false, JSON.stringify(options));
  }
  for (const options of [{maxDiagnostics: 1}, {maxValidationRuns: 1}]) {
    const r = inspect(inspectionCase(1, 'simultaneous-errors').project, options);
    assert.equal(r.compatible, false); assert.equal(r.complete, false); assert.equal(r.truncated, true);
  }
  const p = new Program(); const ids = Array.from({length: 150}, () => p.set('result', p.literal(1)));
  const report = inspect(p.finish(ids), {maxReportBytes: 4096});
  assert.equal(report.compatible, false); assert.equal(report.complete, false); assert.ok(report.truncation.includes('OUTPUT_LIMIT'));
  assert.ok(Buffer.byteLength(JSON.stringify(report)) + 1 <= 4096); assert.ok(Buffer.byteLength(formatInspection(report)) <= 4096);
  for (const options of [{unknown: 1}, {maxBlocks: 10001}, {maxReportBytes: 4095}, {maxWork: 0}, {maxDepth: 257}, {maxSteps: NaN}]) assert.throws(() => inspect(project, options), {code: 'INVALID_LIMIT'});
});

test('reports omit project literals, variable names, comments, assets and compiler messages', () => {
  const p = new Program({result: ['SECRET_NAME', 'SECRET_VALUE']});
  const id = p.set('result', p.literal('SECRET_INPUT')); const project = p.finish([id]);
  p.blocks[id].fields.VARIABLE = ['SECRET_MISSING_NAME', 'SECRET_MISSING_ID'];
  project.targets[0].comments = {private: {text: 'SECRET_COMMENT'}};
  project.targets[0].costumes = [{name: 'SECRET_ASSET', md5ext: 'SECRET_PATH'}];
  const json = JSON.stringify(inspect(project)); assert.doesNotMatch(json, /SECRET_/);
});

test('arbitrary malformed JSON data yields bounded incomplete or incompatible reports', () => {
  const cyclic = {}; cyclic.self = cyclic;
  let deep = {}; for (let i = 0; i < 1000; i++) deep = {child: deep};
  for (const project of [null, [], 1, 'text', {}, {targets: []}, {targets: [null]}, {targets: [{blocks: []}]}, cyclic, deep]) {
    const r = inspect(project); assert.equal(r.compatible, false); assert.ok(r.diagnostics.length);
  }
  for (const value of [null, [], 42, {}, {opcode: 'motion_move'}]) {
    const p = new Program(); const project = p.finish([]); p.blocks.bad = value;
    const r = inspect(project); assert.equal(r.compatible, false); assert.ok(r.diagnostics.some(d => d.code === 'INVALID_BLOCK'));
  }
});

test('inspection files and CLI handle supported, malformed, unsupported and limits without writes or execution', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'inspection-test-'));
  const cli = new URL('../bin/scratch-bridge.js', import.meta.url).pathname;
  const invoke = args => spawnSync(process.execPath, [cli, 'inspect', ...args], {encoding: 'utf8', timeout: 5000});
  try {
    const p = new Program(); const project = p.finish([p.repeat(p.literal('Infinity'), [])]);
    const json = join(dir, 'infinite.json'), zip = join(dir, 'infinite.sb3');
    await writeFile(json, JSON.stringify(project)); await writeFile(zip, sb3(project));
    const before = await readFile(zip);
    assert.deepEqual(await inspectFile(json), await inspectFile(zip));
    const out = invoke([zip, '--json']); assert.equal(out.status, 0); assert.equal(JSON.parse(out.stdout).compatible, true);
    const text = invoke([json]); assert.equal(text.status, 0); assert.match(text.stdout, /Structural reachability does not mean execution/);
    assert.equal(invoke([json, '--json', '--max-blocks', '1']).status, 2);
    const unsupported = join(dir, 'unsupported.json'); await writeFile(unsupported, JSON.stringify(inspectionCase(1, 'simultaneous-errors').project));
    assert.equal(invoke([unsupported, '--json']).status, 2);
    const multi = join(dir, 'multi.json'); await writeFile(multi, JSON.stringify(inspectionCase(1, 'multiple-entries').project));
    assert.equal(invoke([multi, '--json']).status, 1);
    const bad = join(dir, 'bad.json'); await writeFile(bad, '{');
    assert.equal(JSON.parse(invoke([bad, '--json']).stdout).diagnostics[0].code, 'INVALID_JSON');
    await writeFile(bad, Buffer.from([0xff])); assert.equal((await inspectFile(bad)).diagnostics[0].code, 'INVALID_JSON');
    assert.equal((await inspectFile(dir)).diagnostics[0].code, 'IO_ERROR');
    assert.equal((await inspectFile(join(dir, 'absent'))).diagnostics[0].code, 'IO_ERROR');
    const badZip = join(dir, 'bad.sb3'); await writeFile(badZip, 'not zip');
    assert.equal((await inspectFile(badZip)).diagnostics[0].code, 'INVALID_ARCHIVE');
    for (const args of [[], [json, '-o', 'no'], [json, '--json', '--json'], [json, '--max-work', '0'], [json, '--max-report-bytes', '8']]) { const r = invoke(args); assert.equal(r.status, 3); assert.equal(r.stdout, ''); }
    assert.deepEqual(await readFile(zip), before);
    assert.deepEqual((await readdir(dir)).sort(), ['bad.json', 'bad.sb3', 'infinite.json', 'infinite.sb3', 'multi.json', 'unsupported.json']);
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('malformed metadata does not turn unresolved call paths into dead-code claims', () => {
  const r = inspect(inspectionCase(1, 'bad-metadata').project);
  assert.equal(r.compatible, false);
  assert.ok(r.scripts.some(s => s.reachability === 'unanalyzed'));
  assert.ok(!r.scripts.some(s => s.reachability === 'uncalled-procedure'));
});

test('fixed-seed malformed-record smoke checks never crash or falsely certify incomplete input', () => {
  const base = inspectionCase(1, 'supported').project;
  let state = 0xfade;
  const random = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
  const values = [null, [], {}, true, 1, '', 'missing', [1], [2, null], {opcode: 'procedures_definition'}];
  const keys = ['inputs', 'fields', 'opcode', 'parent', 'next', 'mutation', 'topLevel', 'shadow'];
  for (let i = 0; i < 1024; i++) {
    const project = structuredClone(base), blocks = project.targets[0].blocks;
    const ids = Object.keys(blocks), id = ids[random(ids.length)];
    if (random(4)) blocks[id][keys[random(keys.length)]] = structuredClone(values[random(values.length)]);
    else blocks[id] = structuredClone(values[random(values.length)]);
    const report = inspect(project);
    if (report.compatible) { assert.equal(report.complete, true); assert.doesNotThrow(() => compile(project)); }
    assert.ok(Buffer.byteLength(JSON.stringify(report)) + 1 <= report.limits.maxReportBytes);
  }
});

test('FIFO input is rejected without waiting for a writer on Linux', {skip: process.platform !== 'linux'}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'inspect-fifo-'));
  try {
    const path = join(dir, 'pipe.sb3');
    assert.equal(spawnSync('mkfifo', [path]).status, 0);
    const result = spawnSync(process.execPath, [new URL('../bin/scratch-bridge.js', import.meta.url).pathname, 'inspect', path, '--json'], {encoding: 'utf8', timeout: 2000});
    assert.ifError(result.error); assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'IO_ERROR');
  } finally { await rm(dir, {recursive: true, force: true}); }
});
