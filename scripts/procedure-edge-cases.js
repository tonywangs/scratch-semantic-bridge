import {ProcedureProgram} from './procedure-programs.js';
import {inSprite} from './list-programs.js';

export function procedureEdgeCases() {
  const cases = [];
  const trace = () => new ProcedureProgram({items: ['items', []]}, {result: ['result', 0]});
  {
    const p = trace(), outer = p.procedure('outer %s', [['x', 12]]), inner = p.procedure('inner %s', [['x', 99]]), empty = p.procedure('zero');
    p.body(empty, [p.add(p.argument('x')), p.add(p.argument('x', true))]);
    p.body(inner, [p.add(p.argument('x')), p.call(empty), p.add(p.argument('x'))]);
    p.body(outer, [p.add(p.argument('x')), p.call(inner), p.add(p.argument('x')), p.call(inner, [p.argument('x')]), p.add(p.argument('x'))]);
    cases.push({name: 'procedure-parameter-isolation', project: p.finish([p.call(outer, [p.literal('caller')]), p.call(outer), p.add(p.argument('x'))]), expected: {result: 0}, expectedLists: {items: ['caller', 99, 0, 0, 99, 'caller', 'caller', 0, 0, 'caller', 'caller', 12, 99, 0, 0, 99, 12, 12, 0, 0, 12, 12, 0]}});
  }
  for (const warp of [false, true]) {
    for (const supplied of ['missing', 'null', 'false', 'text', 'number']) {
      const p = trace(), proc = p.procedure('Boolean %b', [['flag', true]], {warp});
      p.body(proc, [p.add(p.argument('flag', true)), p.add(p.argument('flag')), p.branch(p.argument('flag', true), [p.set('result', p.literal('yes'))], [p.set('result', p.literal('no'))])]);
      const args = {missing: undefined, null: [2, null], false: () => p.literal(false), text: () => p.literal('false'), number: () => p.literal(2)};
      const selected = args[supplied];
      const expectedValue = ['missing', 'null'].includes(supplied) ? true : supplied === 'false' ? false : supplied === 'text' ? 'false' : 2;
      cases.push({name: `procedure-boolean-${supplied}-warp-${warp}`, project: p.finish([p.call(proc, [typeof selected === 'function' ? selected() : selected])]), expected: {result: ['missing', 'null', 'number'].includes(supplied) ? 'yes' : 'no'}, expectedLists: {items: [expectedValue, expectedValue]}});
    }
  }
  {
    const p = trace(), proc = p.procedure('defaults %s %n %b', [['text', '你好'], ['number', '01'], ['boolean', false]]);
    p.body(proc, ['text', 'number', 'boolean'].map(name => p.add(p.argument(name))));
    cases.push({name: 'procedure-default-types', project: p.finish([p.call(proc), p.call(proc, [p.literal(''), p.literal(0), p.literal(true)]), p.call(proc, [[2, null], [2, null], [2, null]])]), expectedLists: {items: ['你好', '01', false, '', 0, true, '你好', '01', false]}});
  }
  {
    const p = trace(), proc = p.procedure('snapshots %s %s', [['before', 0], ['also', 0]]);
    p.body(proc, [p.set('result', p.literal(88)), p.add(p.argument('before')), p.add(p.argument('also')), p.clear(), p.add(p.argument('before')), p.add(p.argument('also'))]);
    cases.push({name: 'procedure-value-snapshots', project: p.finish([p.add(p.literal('a')), p.call(proc, [p.variable('result'), p.contents()])]), expected: {result: 88}, expectedLists: {items: [0, 'a']}});
  }
  {
    const p = trace(), proc = p.procedure('empty body');
    cases.push({name: 'procedure-empty-repeated', project: p.finish([p.repeat(p.literal(5), [p.call(proc)]), p.set('result', p.literal('done'))]), expected: {result: 'done'}, expectedLists: {items: []}});
  }
  {
    const p = trace();
    const names = ['你好', 'x-y', 'x_y', 'arg0', 'callBlockId', 'rt', 'constructor', 'toString', ''];
    const proc = p.procedure('文字 "\\\n\u2028 ' + names.map(() => '%s').join(' '), names.map((name, i) => [name, i]));
    p.body(proc, names.map(name => p.add(p.argument(name))));
    const same = p.procedure('a-b'), collision = p.procedure('a_b');
    p.body(same, [p.add(p.literal('first'))]); p.body(collision, [p.add(p.literal('second'))]);
    cases.push({name: 'procedure-unicode-and-identifiers', project: p.finish([p.call(proc), p.call(same), p.call(collision)]), expectedLists: {items: [...names.map((_, i) => i), 'first', 'second']}});
  }
  {
    const p = trace(), proc = p.procedure('unknown %s', [['value', 'unused']]);
    const call = p.call(proc, [p.op('operator_add', p.literal(2), p.literal(3))]);
    // Keep only the call and main chain: copied custom blocks can lack definitions.
    delete p.blocks[proc.id];
    const prototype = p.blocks[proc.prototypeId];
    for (const descriptor of Object.values(prototype.inputs)) delete p.blocks[descriptor[1]];
    delete p.blocks[proc.prototypeId];
    cases.push({name: 'procedure-missing-definition', project: p.finish([call, p.set('result', p.literal('continued'))]), expected: {result: 'continued'}, expectedLists: {items: []}});
  }
  for (const localDefinition of [false, true]) {
    const p = trace(), proc = p.procedure('same %s', [['x', 'local-default']]);
    p.body(proc, [p.add(p.argument('x')), p.set('result', p.literal('local'))]);
    const project = inSprite(p.finish([p.call(proc)]));
    // Same code and block IDs on a different target must not leak into resolution.
    const stage = new ProcedureProgram({items: ['items', []]}, {result: ['result', 0]});
    const stageProc = stage.procedure('same %s', [['x', 'stage-default']]);
    stage.body(stageProc, [stage.add(stage.argument('x')), stage.set('result', stage.literal('stage'))]);
    project.targets[0].blocks = stage.blocks;
    if (!localDefinition) {
      const sprite = project.targets[1];
      const keep = new Set(Object.entries(sprite.blocks).filter(([, b]) => ['event_whenflagclicked', 'procedures_call'].includes(b.opcode)).map(([id]) => id));
      for (const id of Object.keys(sprite.blocks)) if (!keep.has(id)) delete sprite.blocks[id];
    }
    cases.push({name: `procedure-target-local-${localDefinition}`, project, expected: {result: localDefinition ? 'local' : 0}, expectedLists: {items: localDefinition ? ['local-default'] : []}});
  }
  return cases;
}
