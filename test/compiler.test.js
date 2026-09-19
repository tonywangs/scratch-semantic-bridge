import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, SUPPORTED_OPCODES} from '../src/compiler.js';
import {Program, examples} from '../scripts/programs.js';
import {execute, values} from './helpers.js';

for (const [name, {project, expected}] of Object.entries(examples())) test(`example: ${name}`, async () => {
  assert.deepEqual(values(await execute(project)), expected);
});
const simple = () => { const p = new Program(); return p.finish([p.set('result', p.literal('safe'))]); };
const rejects = (project, code, blockId) => assert.throws(() => compile(project), e => e.code === code && (blockId === undefined || e.blockId === blockId));

test('mapping refers to actual generated lines and original IDs', () => {
  const project = examples().factorial.project, {code, map} = compile(project), lines = code.split('\n');
  assert.equal(map.version, 1);
  assert.deepEqual(new Set(map.mappings.map(m => m.blockId)), new Set(Object.keys(project.targets[0].blocks)));
  for (const entry of map.mappings) {
    const line = lines[entry.generatedLine - 1]?.trim();
    assert.ok(line); assert.equal(entry.targetName, 'Stage'); assert.equal(entry.targetIndex, 0);
    if (entry.kind === 'step') assert.equal(line, `rt.tick(${JSON.stringify(entry.blockId)});`);
    if (entry.kind === 'reporter') assert.match(line, /^const r[0-9]+ = /);
    if (entry.kind === 'statement') assert.match(line, /^(v\[|for \(let )/);
  }
  assert.ok(code.includes('for (let remaining'));
  assert.ok(code.includes('rt.number('));
});
test('generated run resets variables on every invocation', async () => {
  const {code} = compile(examples().summation.project);
  const {run} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  assert.deepEqual(run(), run());
});
test('coercion, case-insensitive compare and non-JSON numbers', async () => {
  const p = new Program({result: ['result', 'word'], nan: ['nan', 0], inf: ['inf', 0], eq: ['eq', 0], mod: ['mod', 0]});
  const project = p.finish([p.change('result', p.literal('2')), p.set('nan', p.op('operator_divide', p.literal(0), p.literal(0))), p.set('inf', p.op('operator_divide', p.literal(1), p.literal(0))), p.set('eq', p.op('operator_equals', p.literal('É'), p.literal('é'))), p.set('mod', p.op('operator_mod', p.literal(-5), p.literal(3)))]);
  assert.deepEqual(values(await execute(project)), {result: 2, nan: {$number: 'NaN'}, inf: {$number: 'Infinity'}, eq: true, mod: 1});
});
test('negative zero survives direct API compilation', async () => {
  const p = new Program({result: ['result', -0]});
  assert.deepEqual(values(await execute(p.finish([]))), {result: {$number: '-0'}});
});
test('repeat rounds its initial count and does not change it when variable changes', async () => {
  const p = new Program({n: ['n', 2.5], result: ['result', 0]});
  const project = p.finish([p.repeat(p.variable('n'), [p.change('result', p.literal(1)), p.set('n', p.literal(0))])]);
  assert.equal(values(await execute(project)).result, 3);
});
test('repeat until re-evaluates condition', async () => {
  const p = new Program();
  const project = p.finish([p.until(p.op('operator_equals', p.variable('result'), p.literal(4)), [p.change('result', p.literal(1))])]);
  assert.equal(values(await execute(project)).result, 4);
});
test('empty boolean sockets and empty substacks are accepted', async () => {
  const p = new Program(); const id = p.block('control_if', {});
  assert.equal(values(await execute(p.finish([id]))).result, 0);
});
test('empty arithmetic/comparison input is rejected rather than guessed', () => {
  const p = new Program(); const r = p.block('operator_equals', {});
  const project = p.finish([p.set('result', [2, r])]);
  rejects(project, 'INVALID_INPUT', r);
});
test('obscured primitive and block shadows validate without executing', async () => {
  const p = new Program();
  const shadow = p.block('text', {}, {TEXT: ['ignored']}); p.blocks[shadow].shadow = true;
  const report = p.op('operator_add', p.literal(2), p.literal(3));
  const set = p.set('result', [3, report[1], shadow]); p.blocks[shadow].parent = set;
  assert.equal(values(await execute(p.finish([set]))).result, 5);
});
test('Unicode, JS-like IDs and duplicate variable names are data', async () => {
  const malicious = 'x"; throw new Error("injected"); //\n\u2028你好';
  const p = new Program(Object.fromEntries([['prototype', ['same', 7]], ['$constructor', ['same', 9]], [malicious, ['名\n字', '初始']]]));
  const project = p.finish([p.set(malicious, p.variable('prototype'))]);
  project.targets[0].name = malicious;
  const result = await execute(project);
  assert.equal(result.variables.find(v => v.id === malicious).value, 7);
  assert.equal(result.variables.find(v => v.id === '$constructor').value, 9);
});
test('stage and sprite variables resolve by ID with local precedence', async () => {
  const p = new Program({shared: ['shared', 100], result: ['result', 0]});
  const project = p.finish([p.change('shared', p.literal(2)), p.set('result', p.variable('shared'))]);
  const stage = project.targets[0];
  project.targets.push({...structuredClone(stage), isStage: false, name: 'Sprite', variables: {shared: ['shared', 5]}, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around', visible: true});
  stage.blocks = {};
  const result = (await execute(project)).variables;
  assert.equal(result.find(v => v.targetIndex === 0 && v.id === 'shared').value, 100);
  assert.equal(result.find(v => v.targetIndex === 0 && v.id === 'result').value, 7);
  assert.equal(result.find(v => v.targetIndex === 1 && v.id === 'shared').value, 7);
});
test('unsupported executable opcode includes target and block identifiers', () => {
  const project = simple(); project.targets[0].blocks.b0.opcode = 'motion_movesteps';
  assert.throws(() => compile(project), e => e.code === 'UNSUPPORTED_OPCODE' && e.blockId === 'b0' && e.targetIndex === 0 && e.targetName === 'Stage');
});
test('rejects concurrent hats across targets', () => {
  const project = simple();
  project.targets.push({...structuredClone(project.targets[0]), isStage: false, name: 'Other'});
  rejects(project, 'SCRIPT_COUNT', 'b1');
});
test('rejects detached scripts and unsupported unreachable blocks', () => {
  const project = simple(); project.targets[0].blocks.b0.topLevel = true;
  rejects(project, 'EXTRA_SCRIPT', 'b0');
  project.targets[0].blocks.b0.topLevel = false; project.targets[0].blocks.b1.next = null;
  rejects(project, 'UNREACHABLE_BLOCK', 'b0');
});
test('rejects missing next reference', () => {
  const project = simple(); project.targets[0].blocks.b0.next = 'missing'; rejects(project, 'MISSING_BLOCK', 'b0');
});
test('rejects next cycles before generating JavaScript', () => {
  const project = simple(); project.targets[0].blocks.b0.next = 'b0'; rejects(project, 'BLOCK_CYCLE', 'b0');
});
test('rejects reporter cycles', () => {
  const p = new Program(); const r = p.op('operator_not', p.literal(1)); const project = p.finish([p.set('result', r)]);
  p.blocks[r[1]].inputs.OPERAND = [2, r[1]];
  rejects(project, 'BLOCK_CYCLE', r[1]);
});
test('rejects shared reporter references', () => {
  const p = new Program(); const r = p.op('operator_round', p.literal(1)); const add = p.op('operator_add', r, r); const project = p.finish([p.set('result', add)]);
  rejects(project, 'SHARED_BLOCK', r[1]);
});
test('rejects dangling parent and variable IDs', () => {
  const project = simple(); project.targets[0].blocks.b0.parent = 'wrong'; rejects(project, 'INVALID_PARENT', 'b0');
  project.targets[0].blocks.b0.parent = 'b1'; project.targets[0].blocks.b0.fields.VARIABLE[1] = 'missing'; rejects(project, 'MISSING_VARIABLE', 'b0');
});
test('rejects malformed inputs, fields, primitive descriptors and mutations', () => {
  for (const edit of [b => b.inputs.VALUE = [7, [10, 'x']], b => b.inputs.VALUE = [1, [99, 'x']], b => b.inputs.VALUE = [1, [10, {}]], b => b.inputs.EXTRA = [1, [10, 'x']]]) {
    const project = simple(); edit(project.targets[0].blocks.b0); rejects(project, 'INVALID_INPUT', 'b0');
  }
  const project = simple(); project.targets[0].blocks.b0.fields.EXTRA = ['x']; rejects(project, 'INVALID_FIELD', 'b0');
  delete project.targets[0].blocks.b0.fields.EXTRA; project.targets[0].blocks.b0.mutation = {}; rejects(project, 'UNSUPPORTED_FEATURE', 'b0');
});
test('rejects cloud variables, lists, broadcasts and extensions', () => {
  const project = simple(); project.targets[0].variables.result.push(true); rejects(project, 'INVALID_VARIABLE');
  for (const key of ['lists', 'broadcasts']) { const p = simple(); p.targets[0][key] = {x: []}; rejects(p, 'UNSUPPORTED_FEATURE'); }
  const extended = simple(); extended.extensions = ['pen']; rejects(extended, 'UNSUPPORTED_FEATURE');
});
test('conversion limits fail explicitly', () => {
  assert.throws(() => compile(simple(), {maxBlocks: 1}), {code: 'BLOCK_LIMIT'});
  const p = new Program(); let expression = p.literal(1);
  for (let i = 0; i < 20; i++) expression = p.op('operator_not', expression);
  assert.throws(() => compile(p.finish([p.set('result', expression)]), {maxDepth: 8}), {code: 'DEPTH_LIMIT'});
  for (const limit of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => compile(simple(), {maxSteps: limit}), {code: 'INVALID_LIMIT'});
});
test('even empty infinite loops exhaust the execution budget with block location', async () => {
  for (const kind of ['repeat', 'until']) {
    const p = new Program(); const loop = kind === 'repeat' ? p.repeat(p.literal('Infinity'), []) : p.until(p.literal('false'), []);
    const project = p.finish([loop]);
    compile(project); // Compilation itself never executes an infinite project.
    await assert.rejects(() => execute(project, {maxSteps: 10}), e => e.code === 'STEP_LIMIT' && e.blockId === loop && e.targetIndex === 0);
  }
});
test('runtime budget override validates and applies', async () => {
  await assert.rejects(() => execute(simple(), {}, {maxSteps: 0}), {code: 'INVALID_LIMIT'});
  await assert.rejects(() => execute(simple(), {}, {maxSteps: 1}), {code: 'STEP_LIMIT'});
});
test('supported opcode list is unique and stable', () => { assert.equal(new Set(SUPPORTED_OPCODES).size, SUPPORTED_OPCODES.length); assert.ok(SUPPORTED_OPCODES.includes('control_repeat_until')); });
test('rejects variable IDs that collide under Scratch VM sanitization', () => {
  const p = new Program({'x<': ['first', 1], xlt: ['second', 2]});
  rejects(p.finish([]), 'IDENTIFIER_COLLISION');
});
test('rejects reserved IDs and backspace values affected by Scratch loading', () => {
  for (const id of Object.getOwnPropertyNames(Object.prototype)) {
    const p = new Program(Object.fromEntries([[id, ['unsafe', 1]]]));
    rejects(p.finish([]), 'UNSUPPORTED_IDENTIFIER');
  }
  const q = new Program(); const project = q.finish([q.set('result', q.literal('a\bb'))]);
  rejects(project, 'INVALID_INPUT');
  const r = simple(); r.targets[0].variables.result[1] = 'a\bb'; rejects(r, 'INVALID_VARIABLE');
});
