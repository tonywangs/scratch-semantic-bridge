import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {compile} from '../src/compiler.js';
import {createRuntime} from '../src/runtime.js';
import {ListProgram, listExamples, inSprite} from '../scripts/list-programs.js';
import {execute, values} from './helpers.js';
const require = createRequire(import.meta.url);
const Cast = require('../node_modules/scratch-vm/src/util/cast.js');
const listValues = result => Object.fromEntries(result.lists.map(l => [l.id, l.value]));
const rejects = (p, code, blockId) => assert.throws(() => compile(p), e => e.code === code && (blockId === undefined || e.blockId === blockId));

for (const [name, {project, expected, expectedLists}] of Object.entries(listExamples())) test(`list example: ${name}`, async () => {
  const result = await execute(project);
  assert.deepEqual(values(result), expected);
  assert.deepEqual(listValues(result), expectedLists);
});

test('every deterministic index agrees with pinned Cast across empty and nonempty lengths', () => {
  const rt = createRuntime(100, 0, 'Stage');
  for (const length of [0, 1, 2, 3, 100]) for (const all of [true, false]) {
    for (const index of [undefined, null, true, false, NaN, Infinity, -Infinity, -0, 0, -1, -0.5, 1, 1.9, 2, 100, 101, '', ' ', '\t', 'NaN', 'Infinity', '0x2', '2.9', 'all', 'last', 'LAST', 'All', 'RANDOM', ' any ', '你好']) {
      const expected = Cast.toListIndex(index, length, all);
      assert.equal(rt.listIndex(index, length, all, 'index'), expected === Cast.LIST_INVALID ? 0 : expected === Cast.LIST_ALL ? 'all' : expected);
    }
  }
});

test('all list operations preserve values, first-match search, and invalid-index behavior', async () => {
  const p = new ListProgram({items: ['items', [1, '01', 'a']]}, {result: ['result', 0], contains: ['contains', false], text: ['text', ''], missing: ['missing', 0]});
  const project = p.finish([
    p.add(p.literal('你好')), p.insert(p.literal('z'), p.literal('last')), p.replace(p.literal('2.9'), p.literal('A')),
    p.remove(p.literal(0)), p.replace(p.literal('all'), p.literal('ignored')),
    p.set('result', p.report('data_itemnumoflist', 'items', {ITEM: p.literal('a')})),
    p.set('contains', p.report('data_listcontainsitem', 'items', {ITEM: p.literal('01')})),
    p.set('missing', p.item(p.literal('all'))), p.set('text', p.contents())
  ]);
  const result = await execute(project);
  assert.deepEqual(listValues(result), {items: [1, 'A', 'a', '你好', 'z']});
  assert.deepEqual(values(result), {result: 2, contains: true, text: '1 A a 你好 z', missing: ''});
});

test('contents uses UTF-16 single-string characters, not stringified numbers or Unicode code points', async () => {
  for (const [initial, expected] of [[[], ''], [['a', 'b'], 'ab'], [['你', '好'], '你好'], [['😀', '😁'], '😀 😁'], [[1, 2], '1 2'], [['1', '2'], '12'], [['a', ''], 'a '], [[false, true], 'false true']]) {
    const p = new ListProgram({items: ['items', initial]});
    assert.equal(values(await execute(p.finish([p.set('result', p.contents())]))).result, expected);
  }
});

test('clear and delete all empty lists; insert last into an empty list appends', async () => {
  const p = new ListProgram({items: ['items', [1, 2]], trace: ['trace', []]});
  const result = await execute(p.finish([
    p.remove(p.literal('all')), p.add(p.length(), 'trace'),
    p.insert(p.literal('a'), p.literal('last')), p.add(p.contents(), 'trace'),
    p.clear(), p.add(p.item(p.literal('last')), 'trace'), p.add(p.length(), 'trace')
  ]));
  assert.deepEqual(listValues(result), {items: [], trace: [0, 'a', '', 0]});
});

test('saved lists and scalar/list metadata do not share mutable runtime storage', async () => {
  const p = new ListProgram({items: ['items', ['a']]});
  const project = p.finish([p.add(p.literal('b'))]);
  const {code} = compile(project);
  const {run, listMetadata} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const first = run(); first.lists[0].value.push('external'); first.lists[0].initialValue.push('external');
  assert.deepEqual(listMetadata[0].initialValue, ['a']);
  assert.deepEqual(listValues(run()), {items: ['a', 'b']});
  assert.deepEqual(project.targets[0].lists.items[1], ['a']);
});

test('list statements and reporters map to the exact emitted source lines', () => {
  const p = new ListProgram();
  const project = p.finish([p.add(p.literal(1)), p.insert(p.literal(2), p.literal(1)), p.replace(p.literal(1), p.literal(3)), p.remove(p.literal('last')), p.set('result', p.item(p.literal(1))), p.set('result', p.contents()), p.clear()]);
  const {code, map} = compile(project), lines = code.split('\n');
  assert.deepEqual(new Set(map.mappings.map(m => m.blockId)), new Set(Object.keys(p.blocks)));
  for (const [id, block] of Object.entries(p.blocks)) if (block.fields.LIST) {
    const mapped = map.mappings.filter(m => m.blockId === id && m.kind !== 'step');
    assert.equal(mapped.length, 1);
    assert.match(lines[mapped[0].generatedLine - 1], /rt\.list[A-Za-z]+\(l\[0\]/);
  }
});

const indexOperations = (p, index) => [
  () => p.insert(p.literal('x'), index), () => p.replace(index, p.literal('x')),
  () => p.remove(index), () => p.set('result', p.item(index))
];
test('literal random and any indices reject at compile time with the owning block ID', () => {
  for (const keyword of ['random', 'any']) for (let op = 0; op < 4; op++) for (const form of ['primitive', 'shadow']) {
    const p = new ListProgram();
    let index = p.literal(keyword);
    if (form === 'shadow') { const id = p.block('text', {}, {TEXT: [keyword]}); p.blocks[id].shadow = true; index = [1, id]; }
    const statement = indexOperations(p, index)[op]();
    const owner = op === 3 ? p.blocks[statement].inputs.VALUE[1] : statement;
    rejects(p.finish([statement]), 'UNSUPPORTED_LIST_INDEX', owner);
  }
});

test('computed random and any indices reject at runtime, including on empty lists', async () => {
  for (const keyword of ['random', 'any']) for (const initial of [[], [1]]) for (let op = 0; op < 4; op++) for (const source of ['variable', 'item', 'contents']) {
    const p = new ListProgram({items: ['items', initial], indexList: ['index list', [keyword]]}, {result: ['result', 0], index: ['index', keyword]});
    const index = source === 'variable' ? p.variable('index') : source === 'item' ? p.item(p.literal(1), 'indexList') : p.contents('indexList');
    const statement = indexOperations(p, index)[op]();
    const owner = op === 3 ? p.blocks[statement].inputs.VALUE[1] : statement;
    const project = p.finish([statement]);
    compile(project);
    await assert.rejects(() => execute(project), e => e.code === 'UNSUPPORTED_LIST_INDEX' && e.blockId === owner && e.targetIndex === 0 && e.targetName === 'Stage');
  }
});

test('random and any remain ordinary data outside index sockets', async () => {
  const p = new ListProgram({items: ['items', ['random']]});
  const result = await execute(p.finish([p.add(p.literal('any')), p.set('result', p.report('data_itemnumoflist', 'items', {ITEM: p.literal('random')}))]));
  assert.deepEqual(listValues(result), {items: ['random', 'any']});
  assert.equal(values(result).result, 1);
});

test('list scope uses IDs with local precedence and preserves inactive targets', async () => {
  const p = new ListProgram({items: ['same', ['stage']], global: ['same', []]});
  const project = inSprite(p.finish([p.add(p.literal('local')), p.add(p.contents(), 'global')]), {items: ['same', ['sprite']]});
  const result = await execute(project);
  assert.deepEqual(result.lists.map(({targetIndex, id, value}) => ({targetIndex, id, value})), [
    {targetIndex: 0, id: 'items', value: ['stage']}, {targetIndex: 0, id: 'global', value: ['sprite local']}, {targetIndex: 1, id: 'items', value: ['sprite', 'local']}
  ]);
});

test('missing, mismatched, malformed, wrong-kind and other-sprite list references fail explicitly', () => {
  for (const field of [null, ['items'], ['wrong name', 'items'], ['items', 0]]) {
    const p = new ListProgram(); const id = p.add(p.literal(1)); p.blocks[id].fields.LIST = field;
    rejects(p.finish([id]), 'INVALID_LIST', id);
  }
  const p = new ListProgram(); const id = p.add(p.literal(1)); p.blocks[id].fields.LIST[1] = 'unknown'; rejects(p.finish([id]), 'MISSING_LIST', id);
  const q = new ListProgram(); const qid = q.add(q.literal(1)); q.blocks[qid].fields.LIST = ['result', 'result']; rejects(q.finish([qid]), 'INVALID_LIST', qid);
  const r = new ListProgram(); const rid = r.set('result', [2, [13, 'items', 'unknown']]); rejects(r.finish([rid]), 'MISSING_LIST', rid);
  const s = new ListProgram(); const sid = s.add(s.literal(1)); const project = s.finish([sid]);
  project.targets.push({...structuredClone(project.targets[0]), isStage: false, name: 'Other', blocks: {}});
  project.targets[0].lists = {}; rejects(project, 'MISSING_LIST', sid);
  const t = new ListProgram(); const tid = t.add(t.literal(1)); const wrongKind = inSprite(t.finish([tid]));
  wrongKind.targets[1].variables.items = ['items', 1]; rejects(wrongKind, 'INVALID_LIST', tid);
});

test('list definitions must contain only saved scalar values and valid names', () => {
  for (const definition of [[], ['items'], ['items', 3], ['items', [null]], ['items', [{}]], ['items', [[]]], ['items', [Infinity]], ['items', ['a\bb']], [5, []], ['items', [], false]]) {
    const p = new ListProgram({items: definition}); rejects(p.finish([]), 'INVALID_LIST');
  }
  for (const lists of [null, [], 'bad']) { const p = new ListProgram(lists); rejects(p.finish([]), 'INVALID_LIST'); }
});

test('list IDs reject reserved names and scalar/list sanitization collisions', () => {
  for (const id of Object.getOwnPropertyNames(Object.prototype)) {
    const p = new ListProgram(Object.fromEntries([[id, ['items', []]]])); rejects(p.finish([]), 'UNSUPPORTED_IDENTIFIER');
  }
  for (const lists of [{result: ['items', []]}, {'x<': ['items', []], xlt: ['other', []]}]) {
    const p = new ListProgram(lists); rejects(p.finish([]), 'IDENTIFIER_COLLISION');
  }
  const p = new ListProgram({'x<': ['items', []]}, {xlt: ['scalar', 1]}); rejects(p.finish([]), 'IDENTIFIER_COLLISION');
  const q = new ListProgram({'x<': ['items', []]}); const project = inSprite(q.finish([]), {xlt: ['local', []]}); rejects(project, 'IDENTIFIER_COLLISION');
});

test('oversized initial lists reject before emission and when a run lowers its budget', async () => {
  const p = new ListProgram({items: ['items', Array(10001).fill(0)]}); rejects(p.finish([]), 'LIST_LIMIT');
  const q = new ListProgram({items: ['items', [1, 2]]}); const project = q.finish([]);
  assert.throws(() => compile(project, {maxListLength: 1}), {code: 'LIST_LIMIT'});
  await assert.rejects(() => execute(project, {}, {maxListLength: 1}), {code: 'LIST_LIMIT'});
  for (const limit of [0, -1, 1.5, Infinity, NaN, 200001]) {
    assert.throws(() => compile(project, {maxListLength: limit}), {code: 'INVALID_LIMIT'});
    await assert.rejects(() => execute(project, {}, {maxListLength: limit}), {code: 'INVALID_LIMIT'});
  }
});

test('append and valid insert fail at growth limit with block ID; invalid insert is a no-op', async () => {
  for (const insert of [false, true]) {
    const p = new ListProgram({items: ['items', [1, 2]]});
    const id = insert ? p.insert(p.literal(3), p.literal(1)) : p.add(p.literal(3));
    await assert.rejects(() => execute(p.finish([id]), {maxListLength: 2}), e => e.code === 'LIST_LIMIT' && e.blockId === id);
  }
  const p = new ListProgram({items: ['items', [1, 2]]});
  const result = await execute(p.finish([p.insert(p.literal(3), p.literal(0)), p.replace(p.literal(2), p.literal(4)), p.remove(p.literal(1)), p.add(p.literal(5))]), {maxListLength: 2});
  assert.deepEqual(listValues(result), {items: [4, 5]});
});

test('list-driven loops still obey execution limits', async () => {
  const p = new ListProgram(); const id = p.until(p.op('operator_gt', p.length(), p.literal(100)), [p.add(p.literal(1))]);
  await assert.rejects(() => execute(p.finish([id]), {maxSteps: 30}), {code: 'STEP_LIMIT'});
});

test('boolean numeric/text primitives are invalid SB3 while boolean reporters and saved list items work', async () => {
  const p = new ListProgram(); const id = p.add([1, [10, true]]); rejects(p.finish([id]), 'INVALID_INPUT', id);
  const q = new ListProgram({items: ['items', [true]]});
  assert.deepEqual(listValues(await execute(q.finish([q.add(q.literal(false))]))), {items: [true, false]});
});
