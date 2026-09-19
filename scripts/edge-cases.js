import {Program} from './programs.js';
export function edgeCases() {
  const cases = [];
  const add = (name, build, variables) => { const p = new Program(variables); cases.push({name, project: p.finish(build(p))}); };
  for (const value of [-3, -0.5, 0, 0.49, 0.5, 1.5, 2.5, 'false', ' ', '3.5']) {
    add(`repeat-${JSON.stringify(value)}`, p => [p.repeat(p.literal(value), [p.change('result', p.literal(1))])]);
  }
  add('repeat-bound-snapshot', p => [p.repeat(p.variable('n'), [p.change('result', p.literal(1)), p.set('n', p.literal(0))])], {n: ['n', 2.5], result: ['result', 0]});
  add('nested-until-if', p => [p.until(p.op('operator_gt', p.variable('result'), p.literal(4)), [p.branch(p.op('operator_equals', p.variable('result'), p.literal(2)), [p.change('result', p.literal(2))], [p.change('result', p.literal(1))])])]);
  add('empty-boolean', p => [p.block('control_if', {})]);
  add('empty-not', p => [p.set('result', [2, p.block('operator_not', {})])]);
  add('numeric-shadow-retains-string', p => [p.set('result', p.literal('010', 4))]);
  add('obscured-primitive-shadow', p => { const r = p.op('operator_add', p.literal(3), p.literal(4)); return [p.set('result', [3, r[1], [10, 'ignored']])]; });
  add('obscured-block-shadow', p => {
    const shadow = p.block('text', {}, {TEXT: ['ignored']}); p.blocks[shadow].shadow = true;
    const r = p.op('operator_add', p.literal(3), p.literal(4));
    const s = p.set('result', [3, r[1], shadow]); p.blocks[shadow].parent = s;
    return [s];
  });
  for (const op of ['operator_divide', 'operator_mod']) for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [-5, 3], [5, -3], ['Infinity', 3]]) {
    add(`${op}-${a}-${b}`, p => [p.set('result', p.op(op, p.literal(a), p.literal(b)))]);
  }
  for (const [a, b] of [['', 0], [' ', 0], ['Infinity', 'Infinity'], ['É', 'é'], ['İ', 'i'], ['你好', '你好']]) {
    add(`compare-${a}-${b}`, p => [p.set('result', p.op('operator_equals', p.literal(a), p.literal(b)))]);
  }
  add('literal-shadow-block', p => { const id = p.block('math_number', {}, {NUM: ['001']}); p.blocks[id].shadow = true; return [p.set('result', [1, id])]; });
  add('boolean-variable', p => [p.set('result', p.op('operator_and', p.variable('yes'), p.op('operator_not', p.variable('no'))))], {yes: ['yes', true], no: ['no', false], result: ['result', 0]});
  add('unicode-variable-and-injection-string', p => [p.set('结果"\\\n', p.literal('";throw new Error("injection");//\n你好\u2028'))], {'结果"\\\n': ['名字', 0]});
  const p = new Program({shared: ['same', 100], result: ['same', 0]});
  const project = p.finish([p.change('shared', p.literal(2)), p.set('result', p.variable('shared'))]);
  const stage = project.targets[0];
  project.targets.push({...structuredClone(stage), isStage: false, name: 'Sprite', layerOrder: 1, variables: {shared: ['same', 5]}, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around', visible: true});
  stage.blocks = {};
  cases.push({name: 'stage-sprite-local-precedence', project});
  return cases;
}
