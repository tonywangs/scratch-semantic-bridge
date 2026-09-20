import {ListProgram, inSprite} from './list-programs.js';

export function listEdgeCases() {
  const cases = [];
  const indices = [0, -1, 1, 2, 3, 4, 1.9, -0.5, '2.9', '0x2', '1e0', '', ' ', '\t', 'NaN', 'Infinity', '-Infinity', 'last', 'all', 'LAST', 'ALL', ' last ', 'RANDOM', 'Any', true, false, '你好'];
  for (const initial of [[], ['a', 'b', 'c']]) for (const index of indices) {
    const p = new ListProgram({items: ['items', initial], trace: ['trace', []]});
    const capture = () => [p.add(p.contents(), 'trace'), p.add(p.length(), 'trace')];
    cases.push({name: `list-index-${initial.length}-${JSON.stringify(index)}`, project: p.finish([
      p.add(p.item(p.literal(index)), 'trace'),
      p.replace(p.literal(index), p.literal('R')), ...capture(),
      p.insert(p.literal('I'), p.literal(index)), ...capture(),
      p.remove(p.literal(index)), ...capture(),
      p.clear(), p.set('result', p.contents())
    ])});
  }
  const contentLists = [[], ['a', 'b'], ['1', '2'], [1, 2], ['a', 2], ['你', '好'], ['😀', '😁'], ['é', 'e\u0301'], [true, false], ['', 'a'], ['a', ' ']];
  for (const [i, list] of contentLists.entries()) {
    const p = new ListProgram({items: ['items', list]}, {result: ['result', ''], explicit: ['explicit', '']});
    cases.push({name: `list-contents-${i}`, project: p.finish([p.set('result', p.contents()), p.set('explicit', p.report('data_listcontents'))])});
  }
  for (const [i, item] of [1, '01', 0, '', ' ', true, false, 'a', 'É', 'İ', '你好', '😀', 'missing'].entries()) {
    const p = new ListProgram({items: ['items', [1, '01', '1', 0, '', ' ', 'A', 'é', 'İ', '你好', '😀', false]]}, {result: ['result', 0], contains: ['contains', false]});
    cases.push({name: `list-search-${i}`, project: p.finish([
      p.set('result', p.report('data_itemnumoflist', 'items', {ITEM: p.literal(item)})),
      p.set('contains', p.report('data_listcontainsitem', 'items', {ITEM: p.literal(item)}))
    ])});
  }
  {
    const p = new ListProgram({items: ['items', []], trace: ['trace', []]});
    const divide = (n, d) => p.op('operator_divide', p.literal(n), p.literal(d));
    const nan = () => divide(0, 0), inf = () => divide(1, 0);
    cases.push({name: 'list-exceptional-numbers', project: p.finish([
      p.add(nan()), p.add(inf()), p.add(divide(-1, 0)), p.add(p.op('operator_multiply', p.literal(-1), p.literal(0))),
      p.add(p.report('data_itemnumoflist', 'items', {ITEM: nan()}), 'trace'),
      p.add(p.report('data_listcontainsitem', 'items', {ITEM: inf()}), 'trace'),
      p.add(p.item(nan()), 'trace'), p.add(p.item(inf()), 'trace'),
      p.replace(nan(), p.literal('ignored')), p.insert(p.literal('ignored'), inf()), p.remove(inf()),
      p.set('result', p.contents())
    ])});
  }
  for (const local of [false, true]) {
    const p = new ListProgram({items: ['same name', ['stage']], global: ['same name', [7]]});
    const project = p.finish([p.add(p.literal('added')), p.add(p.item(p.literal(1)), 'global'), p.set('result', p.contents())]);
    inSprite(project, local ? {items: ['same name', ['sprite']]} : {});
    // Unchanged data in another sprite must also be compared.
    project.targets.push({...structuredClone(project.targets[1]), name: 'Other', layerOrder: 2, blocks: {}, lists: {items: ['same name', ['untouched']]}});
    cases.push({name: `list-scope-${local ? 'shadow' : 'stage'}`, project});
  }
  {
    const id = 'list<"&\'你好\n\u2028';
    const p = new ListProgram({[id]: ['Unicode 名', ['a', 'b']]});
    cases.push({name: 'list-id-sanitization', project: p.finish([p.add(p.literal('c'), id), p.set('result', p.contents(id))])});
  }
  return cases;
}
