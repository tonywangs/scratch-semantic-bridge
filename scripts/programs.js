import {costume} from './asset.js';
// Synthetic fixtures only. These programs do not come from personal projects.
export class Program {
  constructor(variables = {result: ['result', 0]}) {
    this.project = {targets: [{isStage: true, name: 'Stage', variables, lists: {}, broadcasts: {}, blocks: {}, comments: {}, currentCostume: 0, costumes: [{...costume}], sounds: [], volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'off', textToSpeechLanguage: null}], monitors: [], extensions: [], meta: {semver: '3.0.0', vm: '5.0.300', agent: 'scratch-semantic-bridge synthetic fixture'}};
    this.blocks = this.project.targets[0].blocks;
    this.serial = 0;
  }
  literal(value, type = 10) { return [1, [type, value]]; }
  variable(id) { return [2, [12, this.project.targets[0].variables[id][0], id]]; }
  block(opcode, inputs = {}, fields = {}) {
    const id = `b${this.serial++}`;
    this.blocks[id] = {opcode, next: null, parent: null, inputs, fields, shadow: false, topLevel: false};
    for (const descriptor of Object.values(inputs)) if (typeof descriptor[1] === 'string') this.blocks[descriptor[1]].parent = id;
    return id;
  }
  op(opcode, a, b) {
    const names = ['operator_add', 'operator_subtract', 'operator_multiply', 'operator_divide', 'operator_mod'].includes(opcode) ? ['NUM1', 'NUM2'] : opcode === 'operator_round' ? ['NUM'] : opcode === 'operator_not' ? ['OPERAND'] : ['OPERAND1', 'OPERAND2'];
    return [2, this.block(opcode, Object.fromEntries(names.map((name, i) => [name, [a, b][i]])))];
  }
  set(id, value) { return this.block('data_setvariableto', {VALUE: value}, {VARIABLE: [this.project.targets[0].variables[id][0], id]}); }
  change(id, value) { return this.block('data_changevariableby', {VALUE: value}, {VARIABLE: [this.project.targets[0].variables[id][0], id]}); }
  chain(ids) {
    for (let i = 1; i < ids.length; i++) { this.blocks[ids[i - 1]].next = ids[i]; this.blocks[ids[i]].parent = ids[i - 1]; }
    return ids[0] ?? null;
  }
  repeat(times, ids) { return this.block('control_repeat', {TIMES: times, SUBSTACK: [2, this.chain(ids)]}); }
  until(condition, ids) { return this.block('control_repeat_until', {CONDITION: condition, SUBSTACK: [2, this.chain(ids)]}); }
  branch(condition, yes, no) {
    return this.block(no ? 'control_if_else' : 'control_if', {CONDITION: condition, SUBSTACK: [2, this.chain(yes)], ...(no ? {SUBSTACK2: [2, this.chain(no)]} : {})});
  }
  finish(ids) {
    const first = this.chain(ids), hat = this.block('event_whenflagclicked');
    this.blocks[hat].topLevel = true; this.blocks[hat].x = 0; this.blocks[hat].y = 0;
    this.blocks[hat].next = first;
    if (first) this.blocks[first].parent = hat;
    return this.project;
  }
}

export function examples() {
  const factorial = new Program({n: ['n', 6], result: ['factorial', 1], i: ['i', 1]});
  const f = factorial;
  const fp = f.finish([f.repeat(f.variable('n'), [f.set('result', f.op('operator_multiply', f.variable('result'), f.variable('i'))), f.change('i', f.literal(1, 4))])]);
  const s = new Program({n: ['n', 100], result: ['sum', 0], i: ['i', 1]});
  const sp = s.finish([s.repeat(s.variable('n'), [s.change('result', s.variable('i')), s.change('i', s.literal(1, 4))])]);
  const c = new Program({input: ['input', -7], result: ['classification', '']});
  const cp = c.finish([c.branch(c.op('operator_lt', c.variable('input'), c.literal(0)), [c.set('result', c.literal('negative'))], [c.branch(c.op('operator_equals', c.variable('input'), c.literal(0)), [c.set('result', c.literal('zero'))], [c.set('result', c.literal('positive'))])])]);
  return {factorial: {project: fp, expected: {n: 6, result: 720, i: 7}}, summation: {project: sp, expected: {n: 100, result: 5050, i: 101}}, conditional: {project: cp, expected: {input: -7, result: 'negative'}}};
}

export function generated(seed) {
  // Mulberry32; each seed defines its own program independently.
  let state = seed >>> 0;
  const random = n => {
    let t = state += 0x6d2b79f5;
    t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return Math.floor(((t ^ t >>> 14) >>> 0) / 4294967296 * n);
  };
  const values = [0, 1, -1, 2.5, -2.5, '', ' ', '\t', '0', 'false', 'FALSE', 'true', '010', '1e2', 'hello', 'HELLO', '你好', 'é', 'İ', 'Infinity', '-Infinity', 'NaN', '0x10'];
  const p = new Program({x: ['数值 x', values[random(values.length)]], y: ['y', values[random(values.length)]], result: ['result', 0], count: ['count', 0]});
  const operations = ['operator_add', 'operator_subtract', 'operator_multiply', 'operator_divide', 'operator_mod', 'operator_round', 'operator_lt', 'operator_equals', 'operator_gt', 'operator_and', 'operator_or', 'operator_not'];
  function expression(depth = 0) {
    if (depth >= 3 || random(3) === 0) return random(3) === 0 ? p.variable(['x', 'y', 'result'][random(3)]) : p.literal(values[random(values.length)], random(2) ? 10 : 4);
    const op = operations[random(operations.length)];
    const a = expression(depth + 1);
    return p.op(op, a, ['operator_round', 'operator_not'].includes(op) ? undefined : expression(depth + 1));
  }
  const body = depth => {
    const list = [];
    for (let i = 0, count = 1 + random(4); i < count; i++) {
      const choice = random(depth < 2 ? 5 : 2);
      const variable = ['x', 'y', 'result'][random(3)];
      if (choice === 0) list.push(p.set(variable, expression()));
      else if (choice === 1) list.push(p.change(variable, expression()));
      else if (choice === 2) list.push(p.branch(expression(), body(depth + 1), body(depth + 1)));
      else if (choice === 3) list.push(p.repeat(p.literal(random(5) - 1 + (random(2) ? 0.5 : 0)), body(depth + 1)));
      else list.push(p.branch(expression(), body(depth + 1)));
    }
    return list;
  };
  return p.finish([...body(0), p.until(p.op('operator_gt', p.variable('count'), p.literal(random(4))), [p.change('count', p.literal(1))])]);
}
