import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {compile} from '../src/compiler.js';
import {ProcedureProgram, procedureExamples} from '../scripts/procedure-programs.js';
import {procedureEdgeCases} from '../scripts/procedure-edge-cases.js';
import {sb3} from '../scripts/zip.js';
import {execute, values} from './helpers.js';
const listValues = result => Object.fromEntries(result.lists.map(list => [list.id, list.value]));
const simple = () => {
  const p = new ProcedureProgram(), proc = p.procedure('set %s', [['value', 'default']]);
  p.body(proc, [p.set('result', p.argument('value'))]);
  const call = p.call(proc), project = p.finish([call]);
  return {p, proc, call, project};
};
const rejects = (project, code, blockId, options) => assert.throws(() => compile(project, options), error => error.code === code && error.blockId === blockId && Number.isInteger(error.targetIndex));

for (const [name, {project, expected, expectedLists}] of Object.entries(procedureExamples())) test(`procedure example: ${name}`, async () => {
  const result = await execute(project);
  assert.deepEqual(values(result), expected); assert.deepEqual(listValues(result), expectedLists);
});
for (const {name, project, expected, expectedLists} of procedureEdgeCases().filter(c => c.expected || c.expectedLists)) test(name, async () => {
  const result = await execute(project);
  if (expected) assert.deepEqual(values(result), expected);
  if (expectedLists) assert.deepEqual(listValues(result), expectedLists);
});
test('procedure mappings cover definitions, prototypes, parameters, calls and bodies deterministically', () => {
  const project = procedureExamples()['procedure-filtering'].project;
  const first = compile(project), second = compile(structuredClone(project));
  assert.deepEqual(first, second);
  const lines = first.code.split('\n');
  assert.deepEqual(new Set(first.map.mappings.map(m => m.blockId)), new Set(Object.keys(project.targets[0].blocks)));
  for (const m of first.map.mappings) {
    assert.equal(m.targetIndex, 0); assert.ok(lines[m.generatedLine - 1]);
    if (['definition', 'prototype', 'parameter'].includes(m.kind)) assert.match(lines[m.generatedLine - 1].trim(), /^function procedure\d+\(/);
    if (project.targets[0].blocks[m.blockId].opcode === 'procedures_call' && m.kind === 'statement') assert.match(lines[m.generatedLine - 1].trim(), /^procedure\d+\(/);
  }
});
test('procedure mapping retains target when identical block IDs exist on multiple targets', () => {
  const {project} = procedureEdgeCases().find(c => c.name === 'procedure-target-local-true');
  const {map} = compile(project);
  for (const m of map.mappings) assert.ok(project.targets[m.targetIndex].blocks[m.blockId]);
  assert.deepEqual(new Set(map.mappings.filter(m => m.kind === 'definition').map(m => m.targetIndex)), new Set([0, 1]));
});
test('repeated run calls reset lists, globals, parameters and depth accounting', async () => {
  const {code} = compile(procedureExamples()['procedure-filtering'].project, {maxCallDepth: 2});
  const {run} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const first = run(); assert.deepEqual(run(), first);
  first.lists[1].value.push('external mutation');
  assert.deepEqual(run().lists[1].value, [7, 4]);
  assert.throws(() => run({maxSteps: 3}), {code: 'STEP_LIMIT'});
  assert.deepEqual(run().lists[1].value, [7, 4]);
});
test('missing definitions evaluate supplied reporters before their no-op', async () => {
  const p = new ProcedureProgram();
  const fake = {ids: ['x'], mutation: {tagName: 'mutation', children: [], proccode: 'missing %s', argumentids: '["x"]', warp: 'false'}};
  const reporter = p.item(p.literal('random'));
  // A computed unsupported index demonstrates evaluation at runtime.
  p.blocks[reporter[1]].inputs.INDEX = p.variable('result');
  p.project.targets[0].variables.result[1] = 'random';
  const call = p.call(fake, [reporter]);
  await assert.rejects(() => execute(p.finish([call])), e => e.code === 'UNSUPPORTED_LIST_INDEX' && e.blockId === reporter[1]);
});
test('rejects direct, mutual, dead-branch and unused recursion with the closing call ID', () => {
  for (const variant of ['direct', 'mutual', 'dead', 'unused']) {
    const p = new ProcedureProgram(), a = p.procedure('a'), b = p.procedure('b');
    const closing = p.call(a);
    if (variant === 'mutual') { p.body(a, [p.call(b)]); p.body(b, [closing]); }
    else p.body(a, variant === 'dead' ? [p.branch(p.literal(false), [closing])] : [closing]);
    rejects(p.finish(variant === 'unused' ? [] : [p.call(a)]), 'RECURSIVE_PROCEDURE', closing);
  }
});
test('rejects ambiguous definitions on the same target', () => {
  const p = new ProcedureProgram(); p.procedure('same'); const duplicate = p.procedure('same');
  rejects(p.finish([]), 'AMBIGUOUS_PROCEDURE', duplicate.id);
});
test('rejects malformed prototype metadata with actionable prototype IDs', () => {
  const edits = [
    m => delete m.argumentids, m => m.argumentids = ['x'], m => m.argumentids = '{}', m => m.argumentids = '[',
    m => m.argumentids = '["x","x"]', m => m.argumentids = '["mutation"]', m => m.argumentids = '["custom_block"]',
    m => m.argumentnames = '[]', m => m.argumentnames = '[null]', m => m.argumentnames = '["__proto__"]',
    m => m.argumentdefaults = '[]', m => m.argumentdefaults = '[null]', m => m.argumentdefaults = '[{}]',
    m => m.proccode = 'wrong %b %s', m => m.proccode = 'wrong %q', m => m.proccode = '',
    m => m.warp = true, m => m.warp = 'sometimes', m => m.children = [{}], m => m.tagName = 'wrong',
    m => m.extra = 'unrecognized', m => m.argumentnames = '["back\\bspace"]'
  ];
  for (const edit of edits) {
    const {p, proc, project} = simple(); edit(p.blocks[proc.prototypeId].mutation);
    rejects(project, 'INVALID_PROCEDURE', proc.prototypeId);
  }
  const p = new ProcedureProgram(), proc = p.procedure('two %s %s', [['x', 0], ['x', 1]]);
  rejects(p.finish([]), 'INVALID_PROCEDURE', proc.prototypeId);
});
test('rejects reserved procedure names and excessive parameter arrays', () => {
  for (const name of Object.getOwnPropertyNames(Object.prototype)) {
    const p = new ProcedureProgram(), proc = p.procedure(name);
    rejects(p.finish([]), 'UNSUPPORTED_IDENTIFIER', proc.prototypeId);
  }
  const p = new ProcedureProgram(), proc = p.procedure(Array(129).fill('%s').join(' '), Array.from({length: 129}, (_, i) => [`x${i}`, 0]));
  rejects(p.finish([]), 'INVALID_PROCEDURE', proc.prototypeId);
});
test('rejects stale and malformed call metadata, unexpected sockets and fields', () => {
  const edits = [b => delete b.mutation, b => b.mutation.argumentids = '["stale"]', b => b.mutation.argumentnames = '["value"]', b => b.mutation.warp = 'invalid'];
  for (const edit of edits) { const {p, call, project} = simple(); edit(p.blocks[call]); rejects(project, 'INVALID_PROCEDURE', call); }
  const {p, call, project} = simple(); p.blocks[call].inputs.extra = p.literal(1); rejects(project, 'INVALID_INPUT', call);
  delete p.blocks[call].inputs.extra; p.blocks[call].fields.VALUE = ['unexpected']; rejects(project, 'INVALID_FIELD', call);
});
test('rejects missing, malformed, nonshadow and mismatched prototype attachments', () => {
  for (const edit of [
    (p, proc) => delete p.blocks[proc.id].inputs.custom_block,
    (p, proc) => p.blocks[proc.id].inputs.custom_block[0] = 2,
    (p, proc) => p.blocks[proc.id].inputs.custom_block[1] = 'missing',
    (p, proc) => p.blocks[proc.prototypeId].shadow = false,
    (p, proc) => p.blocks[proc.prototypeId].next = proc.id,
    (p, proc) => p.blocks[proc.prototypeId].parent = null
  ]) { const {p, proc, project} = simple(); edit(p, proc); rejects(project, 'INVALID_PROCEDURE', proc.id); }
  for (const edit of [b => b.shadow = false, b => b.fields.VALUE = ['wrong'], b => b.opcode = 'argument_reporter_boolean']) {
    const {p, proc, project} = simple(), arg = p.blocks[proc.prototypeId].inputs.input0[1];
    edit(p.blocks[arg]); rejects(project, 'INVALID_PROCEDURE', arg);
  }
});
test('argument reporters validate fields even outside procedures', () => {
  const p = new ProcedureProgram(), arg = p.argument('x');
  p.blocks[arg[1]].fields.VALUE = [7];
  rejects(p.finish([p.set('result', arg)]), 'INVALID_FIELD', arg[1]);
});
test('unused procedure bodies and obscured shadows are validated', () => {
  const {p, proc, project} = simple(); const body = p.blocks[proc.id].next;
  p.blocks[body].opcode = 'motion_movesteps'; rejects(project, 'UNSUPPORTED_OPCODE', body);
  const q = new ProcedureProgram(), f = q.procedure('f %s', [['x', 0]]);
  const badShadow = q.block('operator_random'); q.blocks[badShadow].shadow = true;
  const call = q.call(f, [[3, [10, 'active'], badShadow]]); q.blocks[badShadow].parent = call;
  rejects(q.finish([call]), 'UNSUPPORTED_OPCODE', badShadow);
});
function callChain(length) {
  const p = new ProcedureProgram(), procedures = Array.from({length}, (_, i) => p.procedure(`p${i}`)), calls = [];
  for (let i = 0; i + 1 < length; i++) { calls.push(p.call(procedures[i + 1])); p.body(procedures[i], [calls.at(-1)]); }
  p.body(procedures.at(-1), [p.set('result', p.literal('done'))]);
  return {p, calls, project: p.finish([p.call(procedures[0]), p.call(procedures[0])])};
}
test('call-depth limit spans nested calls, resets on returns, and reports caller location', async () => {
  const {project, calls} = callChain(4);
  assert.equal(values(await execute(project, {maxCallDepth: 4})).result, 'done');
  await assert.rejects(() => execute(project, {maxCallDepth: 3}), e => e.code === 'CALL_DEPTH_LIMIT' && e.blockId === calls[2] && e.targetIndex === 0);
  await assert.rejects(() => execute(project, {}, {maxCallDepth: 2}), e => e.code === 'CALL_DEPTH_LIMIT' && e.blockId === calls[1]);
  for (const limit of [0, -1, 1.5, 257, Infinity, NaN]) {
    assert.throws(() => compile(project, {maxCallDepth: limit}), {code: 'INVALID_LIMIT'});
    await assert.rejects(() => execute(project, {}, {maxCallDepth: limit}), {code: 'INVALID_LIMIT'});
  }
});
test('long acyclic call graph fails by documented limit rather than overflowing the JS stack', async () => {
  const {project} = callChain(400);
  await assert.rejects(() => execute(project), {code: 'CALL_DEPTH_LIMIT'});
});
test('steps, list capacity and loop limits remain global across procedure boundaries', async () => {
  const p = new ProcedureProgram(), leaf = p.procedure('append'), outer = p.procedure('outer');
  const add = p.add(p.literal(1)); p.body(leaf, [add]); p.body(outer, [p.repeat(p.literal(10), [p.call(leaf)])]);
  const project = p.finish([p.call(outer)]);
  await assert.rejects(() => execute(project, {maxListLength: 3}), e => e.code === 'LIST_LIMIT' && e.blockId === add);
  await assert.rejects(() => execute(project, {maxSteps: 15}), {code: 'STEP_LIMIT'});
  const q = new ProcedureProgram(), proc = q.procedure('infinite'), loop = q.until(q.literal(false), []);
  q.body(proc, [loop]);
  await assert.rejects(() => execute(q.finish([q.call(proc)]), {maxSteps: 20}), e => e.code === 'STEP_LIMIT' && e.blockId === loop);
});
test('CLI exposes call-depth limits, maps procedure calls and produces block-level runtime errors', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'bridge-procedures-'));
  try {
    const input = join(temp, 'input.sb3'), output = join(temp, 'output.mjs');
    const {project, calls} = callChain(3); await writeFile(input, sb3(project));
    const converted = spawnSync(process.execPath, ['bin/scratch-bridge.js', input, '-o', output, '--max-call-depth', '2'], {encoding: 'utf8'});
    assert.equal(converted.status, 0, converted.stderr);
    assert.ok(JSON.parse(await readFile(`${output}.map.json`)).mappings.some(m => m.kind === 'definition'));
    const run = spawnSync(process.execPath, [output], {encoding: 'utf8'});
    assert.equal(run.status, 1); const error = JSON.parse(run.stderr);
    assert.equal(error.code, 'CALL_DEPTH_LIMIT'); assert.equal(error.blockId, calls[1]);
    const invalid = spawnSync(process.execPath, ['bin/scratch-bridge.js', input, '--check', '--max-call-depth', '257'], {encoding: 'utf8'});
    assert.equal(invalid.status, 1); assert.equal(JSON.parse(invalid.stderr).code, 'INVALID_LIMIT');
  } finally { await rm(temp, {recursive: true, force: true}); }
});
