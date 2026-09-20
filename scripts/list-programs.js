import {Program} from './programs.js';

export class ListProgram extends Program {
  constructor(lists = {items: ['items', []]}, variables) {
    super(variables);
    this.project.targets[0].lists = lists;
  }
  literal(value, type = 10) {
    // Saved numeric/text primitives cannot hold booleans in the SB3 schema.
    if (typeof value === 'boolean') return this.op('operator_equals', super.literal(1), super.literal(value ? 1 : 0));
    return super.literal(value, type);
  }
  listBlock(opcode, id = 'items', inputs = {}) {
    return this.block(opcode, inputs, {LIST: [this.project.targets[0].lists[id][0], id]});
  }
  report(opcode, id = 'items', inputs = {}) { return [2, this.listBlock(opcode, id, inputs)]; }
  contents(id = 'items') { return [2, [13, this.project.targets[0].lists[id][0], id]]; }
  item(index, id = 'items') { return this.report('data_itemoflist', id, {INDEX: index}); }
  length(id = 'items') { return this.report('data_lengthoflist', id); }
  add(item, id = 'items') { return this.listBlock('data_addtolist', id, {ITEM: item}); }
  insert(item, index, id = 'items') { return this.listBlock('data_insertatlist', id, {ITEM: item, INDEX: index}); }
  replace(index, item, id = 'items') { return this.listBlock('data_replaceitemoflist', id, {INDEX: index, ITEM: item}); }
  remove(index, id = 'items') { return this.listBlock('data_deleteoflist', id, {INDEX: index}); }
  clear(id = 'items') { return this.listBlock('data_deletealloflist', id); }
}

// Move the sole script to a sprite; optionally shadow a stage list with the same ID.
export function inSprite(project, localLists = {}) {
  const stage = project.targets[0];
  project.targets.push({...structuredClone(stage), isStage: false, name: 'Sprite', layerOrder: 1, variables: {}, lists: localLists,
    x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around', visible: true});
  stage.blocks = {};
  return project;
}

export function listExamples() {
  // Fixed expectations below are specified independently of the generated execution.
  const s = new ListProgram({items: ['numbers', [5, -2, 5, 0, 3, 1]]}, {i: ['i', 1], j: ['j', 1], temp: ['temp', 0]});
  const next = () => s.op('operator_add', s.variable('j'), s.literal(1));
  const sort = s.finish([s.repeat(s.length(), [
    s.set('j', s.literal(1)),
    s.repeat(s.op('operator_subtract', s.length(), s.literal(1)), [
      s.branch(s.op('operator_gt', s.item(s.variable('j')), s.item(next())), [
        s.set('temp', s.item(s.variable('j'))),
        s.replace(s.variable('j'), s.item(next())),
        s.replace(next(), s.variable('temp'))
      ]), s.change('j', s.literal(1))
    ]), s.change('i', s.literal(1))
  ])]);
  const f = new ListProgram({items: ['input', [-3, 0, 2, 7, -1, 4]], selected: ['positive values', []]}, {i: ['i', 1], result: ['count', 0]});
  const filter = f.finish([f.clear('selected'), f.repeat(f.length(), [
    f.branch(f.op('operator_gt', f.item(f.variable('i')), f.literal(0)), [f.add(f.item(f.variable('i')), 'selected')]),
    f.change('i', f.literal(1))
  ]), f.set('result', f.length('selected'))]);
  const a = new ListProgram({items: ['measurements', [3, '4', -2, 0.5]]}, {i: ['i', 1], sum: ['sum', 0], mean: ['mean', 0]});
  const aggregate = a.finish([a.repeat(a.length(), [a.change('sum', a.item(a.variable('i'))), a.change('i', a.literal(1))]), a.set('mean', a.op('operator_divide', a.variable('sum'), a.length()))]);
  return {
    sorting: {project: sort, expected: {i: 7, j: 6, temp: 3}, expectedLists: {items: [-2, 0, 1, 3, 5, 5]}},
    filtering: {project: filter, expected: {i: 7, result: 3}, expectedLists: {items: [-3, 0, 2, 7, -1, 4], selected: [2, 7, 4]}},
    aggregation: {project: aggregate, expected: {i: 5, sum: 5.5, mean: 1.375}, expectedLists: {items: [3, '4', -2, 0.5]}}
  };
}

export const listSeedStart = 0x11570000;
export const listSeedCount = 192;
export function generatedLists(seed) {
  let state = seed >>> 0;
  const random = n => {
    let t = state += 0x6d2b79f5;
    t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return Math.floor(((t ^ t >>> 14) >>> 0) / 4294967296 * n);
  };
  const values = [0, 1, -1, 2.5, '', ' ', '\t', '0', '01', '1e2', 'NaN', 'Infinity', 'a', 'A', 'é', 'É', '你', '😀', 'e\u0301', false, true];
  const pickValue = () => values[random(values.length)];
  const initial = Array.from({length: random(7)}, pickValue);
  const p = new ListProgram({items: ['mixed items', initial], other: ['mixed items', ['a', 'b']], trace: ['trace', []]}, {index: ['index', 'last'], result: ['result', 0], count: ['count', 0]});
  const val = () => p.literal(pickValue());
  const index = () => {
    const choice = random(5);
    if (choice === 0) return p.variable('index');
    if (choice === 1) return p.op('operator_add', p.length(), p.literal(random(5) - 2));
    if (choice === 2) return p.item(p.literal('last'), 'other');
    return p.literal([1, 0, -1, 1.9, '2.9', 'last', 'all', '', ' ', true, false, 'LAST', '0x2', 'Infinity', 'NaN'][random(15)]);
  };
  const body = () => {
    const ids = [];
    for (let i = 0; i < 16; i++) {
      const list = random(3) ? 'items' : 'other';
      switch (random(11)) {
        case 0: ids.push(p.add(val(), list)); break;
        case 1: ids.push(p.insert(val(), index(), list)); break;
        case 2: ids.push(p.replace(index(), val(), list)); break;
        case 3: ids.push(p.remove(index(), list)); break;
        case 4: ids.push(p.clear(list)); break;
        case 5: ids.push(p.add(p.item(index(), list), 'trace')); break;
        case 6: ids.push(p.add(p.report('data_itemnumoflist', list, {ITEM: val()}), 'trace')); break;
        case 7: ids.push(p.add(p.report('data_listcontainsitem', list, {ITEM: val()}), 'trace')); break;
        case 8: ids.push(p.add(p.length(list), 'trace')); break;
        case 9: ids.push(p.add(p.contents(list), 'trace')); break;
        case 10: ids.push(p.add(p.report('data_listcontents', list), 'trace')); break;
      }
    }
    return ids;
  };
  const project = p.finish([
    ...body(), p.repeat(p.literal(1 + random(3)), body()),
    p.until(p.op('operator_gt', p.variable('count'), p.literal(2)), [
      p.branch(p.report('data_listcontainsitem', 'items', {ITEM: p.literal('a')}), [p.remove(p.literal('last'))], [p.add(val())]),
      p.change('count', p.literal(1))
    ]), p.set('result', p.contents()), p.set('index', p.length())
  ]);
  if (seed % 3 === 1) inSprite(project);
  if (seed % 3 === 2) inSprite(project, {items: ['mixed items', ['local', 1]]});
  return project;
}
