import {ListProgram, inSprite} from './list-programs.js';

export class ProcedureProgram extends ListProgram {
  procedure(code, parameters = [], {warp = false, ids = parameters.map((_, i) => `input${i}`)} = {}) {
    const types = [...code.matchAll(/%([snb])/g)].map(match => match[1]);
    const inputs = Object.fromEntries(parameters.map(([name], i) => {
      const id = this.block(types[i] === 'b' ? 'argument_reporter_boolean' : 'argument_reporter_string_number', {}, {VALUE: [name]});
      this.blocks[id].shadow = true;
      return [ids[i], [1, id]];
    }));
    const prototypeId = this.block('procedures_prototype', inputs);
    this.blocks[prototypeId].shadow = true;
    const mutation = {tagName: 'mutation', children: [], proccode: code, argumentids: JSON.stringify(ids), warp: String(warp)};
    this.blocks[prototypeId].mutation = {...mutation, argumentnames: JSON.stringify(parameters.map(([name]) => name)), argumentdefaults: JSON.stringify(parameters.map(([, value]) => value))};
    const id = this.block('procedures_definition', {custom_block: [1, prototypeId]});
    Object.assign(this.blocks[id], {topLevel: true, x: 300, y: this.serial * 20});
    return {id, prototypeId, ids, parameters, mutation};
  }
  body(procedure, ids) {
    const first = this.chain(ids);
    this.blocks[procedure.id].next = first;
    if (first) this.blocks[first].parent = procedure.id;
    return procedure;
  }
  argument(name, boolean = false) {
    return [2, this.block(boolean ? 'argument_reporter_boolean' : 'argument_reporter_string_number', {}, {VALUE: [name]})];
  }
  call(procedure, args = []) {
    const inputs = Object.fromEntries(procedure.ids.flatMap((id, i) => args[i] === undefined ? [] : [[id, args[i]]]));
    const id = this.block('procedures_call', inputs);
    this.blocks[id].mutation = {...procedure.mutation};
    return id;
  }
}

export function procedureExamples() {
  // Expectations are hand-specified from the algorithms, not copied from either runtime.
  const f = new ProcedureProgram({items: ['input', [-3, 0, 2, 7, -1, 4]], selected: ['selected', []]}, {i: ['i', 0], count: ['count', 0]});
  const keep = f.procedure('keep %s if %b', [['value', ''], ['keep?', false]]);
  f.body(keep, [f.branch(f.argument('keep?', true), [f.add(f.argument('value'), 'selected')])]);
  const filter = f.procedure('filter above %n', [['threshold', 0]]);
  f.body(filter, [f.clear('selected'), f.set('i', f.literal(1)), f.repeat(f.length(), [
    f.call(keep, [f.item(f.variable('i')), f.op('operator_gt', f.item(f.variable('i')), f.argument('threshold'))]),
    f.change('i', f.literal(1))
  ]), f.set('count', f.length('selected'))]);
  const filtering = f.finish([f.call(filter), f.call(filter, [f.literal(3)])]);

  const a = new ProcedureProgram({items: ['measurements', [3, '4', -2, 0.5]], totals: ['totals', []]}, {i: ['i', 0], sum: ['sum', 0]});
  const accumulate = a.procedure('accumulate %s times %n', [['value', 0], ['weight', 1]], {warp: true});
  a.body(accumulate, [a.change('sum', a.op('operator_multiply', a.argument('value'), a.argument('weight')))]);
  const aggregate = a.procedure('weighted total %n', [['weight', 1]]);
  a.body(aggregate, [a.set('sum', a.literal(0)), a.set('i', a.literal(1)), a.repeat(a.length(), [
    a.call(accumulate, [a.item(a.variable('i')), a.argument('weight')]), a.change('i', a.literal(1))
  ]), a.add(a.variable('sum'), 'totals')]);
  const aggregation = a.finish([a.call(aggregate), a.call(aggregate, [a.literal(2)])]);

  const s = new ProcedureProgram({items: ['numbers', [5, -2, 5, 0, 3, 1]]}, {j: ['j', 0], temp: ['temp', 0]});
  const swap = s.procedure('swap %n and %n', [['left', 1], ['right', 2]]);
  s.body(swap, [s.set('temp', s.item(s.argument('left'))), s.replace(s.argument('left'), s.item(s.argument('right'))), s.replace(s.argument('right'), s.variable('temp'))]);
  const sort = s.procedure('sort list');
  const next = () => s.op('operator_add', s.variable('j'), s.literal(1));
  s.body(sort, [s.repeat(s.length(), [s.set('j', s.literal(1)), s.repeat(s.op('operator_subtract', s.length(), s.literal(1)), [
    s.branch(s.op('operator_gt', s.item(s.variable('j')), s.item(next())), [s.call(swap, [s.variable('j'), next()])]), s.change('j', s.literal(1))
  ])])]);
  const sorting = s.finish([s.call(sort), s.call(sort)]);
  return {
    'procedure-filtering': {project: filtering, expected: {i: 7, count: 2}, expectedLists: {items: [-3, 0, 2, 7, -1, 4], selected: [7, 4]}},
    'procedure-aggregation': {project: aggregation, expected: {i: 5, sum: 11}, expectedLists: {items: [3, '4', -2, 0.5], totals: [5.5, 11]}},
    'procedure-sorting': {project: sorting, expected: {j: 6, temp: 3}, expectedLists: {items: [-2, 0, 1, 3, 5, 5]}}
  };
}

export const procedureSeedStart = 0xc0110000;
export const procedureSeedCount = 192;
export function generatedProcedures(seed) {
  let state = seed >>> 0;
  const random = n => {
    let t = state += 0x6d2b79f5;
    t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return Math.floor(((t ^ t >>> 14) >>> 0) / 4294967296 * n);
  };
  const values = [0, 1, -2, 2.5, '', ' ', '0', 'false', 'FALSE', '01', '1e2', 'NaN', 'Infinity', 'a', 'A', '你好', '😀', false, true];
  const value = () => values[random(values.length)];
  const p = new ProcedureProgram({items: ['items', [value(), value(), value()]], trace: ['trace', []]}, {result: ['result', 0], count: ['count', 0]});
  const procedures = Array.from({length: 3 + random(4)}, (_, i) => p.procedure(`处理 ${i} %s %b %n`, [['x', value()], ['flag', Boolean(random(2))], ['amount', random(5) - 2]], {warp: Boolean(random(2))}));
  const leaf = p.procedure('zero arguments');
  p.body(leaf, [p.add(p.argument('x'), 'trace'), p.change('count', p.literal(1))]);
  const arg = () => p.argument('x');
  const operand = () => random(2) ? arg() : p.literal(value());
  for (let i = procedures.length - 1; i >= 0; i--) {
    const body = [p.add(arg(), 'trace'), p.set('result', p.argument('flag', true)), p.change('count', p.argument('amount'))];
    body.push(p.branch(p.argument('flag', true), [p.add(operand())], [p.replace(p.literal('last'), operand())]));
    body.push(p.insert(operand(), p.literal(1)), p.remove(p.literal([0, 2, 'last'][random(3)])));
    if (i + 1 < procedures.length) {
      const callee = procedures[i + 1 + random(procedures.length - i - 1)];
      body.push(p.repeat(p.literal(1 + random(2)), [p.call(callee, [random(3) ? operand() : undefined, random(3) ? p.op('operator_not', p.argument('flag', true)) : undefined, p.op('operator_add', p.argument('amount'), p.literal(1))])]));
      if (random(2)) body.push(p.call(procedures[i + 1]));
    } else body.push(p.call(leaf));
    body.push(p.add(arg(), 'trace'), p.add(p.argument('flag', true), 'trace'), p.add(p.argument('unknown'), 'trace'));
    body.push(p.set('result', p.report('data_listcontainsitem', 'items', {ITEM: arg()})));
    p.body(procedures[i], body);
  }
  const project = p.finish([p.call(procedures[0], [p.literal(value()), p.literal(Boolean(random(2))), p.literal(random(5))]), p.call(procedures[0]), p.add(p.argument('x'), 'trace')]);
  if (seed % 3) inSprite(project, seed % 3 === 2 ? {items: ['items', ['local', value()]]} : {});
  return project;
}
