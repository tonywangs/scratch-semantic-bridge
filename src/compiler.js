import {fail, positiveLimit} from './errors.js';
import {createRuntime, encodeValue} from './runtime.js';
import {normalizedVariableId} from './identifiers.js';

const arithmetic = {operator_add: '+', operator_subtract: '-', operator_multiply: '*', operator_divide: '/'};
const comparisons = {operator_lt: '<', operator_equals: '===', operator_gt: '>'};
const literals = new Set(['math_number', 'math_positive_number', 'math_whole_number', 'math_integer', 'math_angle', 'text']);
const statements = new Set(['data_setvariableto', 'data_changevariableby', 'control_repeat', 'control_repeat_until', 'control_if', 'control_if_else']);
const reporters = new Set([...Object.keys(arithmetic), ...Object.keys(comparisons), ...literals, 'operator_mod', 'operator_round', 'operator_and', 'operator_or', 'operator_not', 'data_variable']);
export const SUPPORTED_OPCODES = Object.freeze(['event_whenflagclicked', ...statements, ...reporters].sort());
const own = (object, key) => Object.hasOwn(object, key);
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const safeText = x => typeof x === 'string' && !x.includes('\b');
const scalar = x => safeText(x) || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x));
const quote = value => {
  if (Object.is(value, -0)) return '-0';
  if (Array.isArray(value)) return `[${value.map(quote).join(',')}]`;
  if (record(value)) return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}:${quote(v)}`).join(',')}}`;
  return JSON.stringify(value).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
};

export function compile(project, options = {}) {
  const maxSteps = positiveLimit(options.maxSteps ?? 100000, 'maxSteps');
  const maxBlocks = positiveLimit(options.maxBlocks ?? 10000, 'maxBlocks');
  const maxDepth = positiveLimit(options.maxDepth ?? 128, 'maxDepth');
  // Hard recursion ceiling remains in force even when the caller raises limits.
  if (maxDepth > 256) fail('INVALID_LIMIT', 'maxDepth cannot exceed 256');
  if (!record(project) || !Array.isArray(project.targets) || !project.targets.length) fail('INVALID_PROJECT', 'Expected a Scratch 3 project with targets');
  if (!record(project.meta) || !/^3\./.test(project.meta.semver)) fail('INVALID_PROJECT', 'Expected meta.semver 3.x');
  if (project.extensions !== undefined && (!Array.isArray(project.extensions) || project.extensions.length)) fail('UNSUPPORTED_FEATURE', 'Extensions are outside the sequential subset');
  if (project.targets.filter(t => t?.isStage === true).length !== 1 || project.targets[0]?.isStage !== true) fail('INVALID_PROJECT', 'Exactly one stage must be the first target');
  const variables = [], scopes = [], hats = [];
  const normalizedIds = new Map();
  let count = 0;
  project.targets.forEach((target, ti) => {
    const loc = {targetIndex: ti, targetName: target?.name};
    if (!record(target) || !safeText(target.name) || typeof target.isStage !== 'boolean' || !record(target.blocks) || !record(target.variables)) fail('INVALID_TARGET', 'Target needs name, isStage, blocks, and variables', loc);
    for (const key of ['lists', 'broadcasts']) if (target[key] !== undefined && (!record(target[key]) || Object.keys(target[key]).length)) fail('UNSUPPORTED_FEATURE', `${key} are outside the sequential subset`, loc);
    const scope = new Map();
    for (const [id, entry] of Object.entries(target.variables)) {
      if (!id || !safeText(id) || !Array.isArray(entry) || entry.length < 2 || entry.length > 3 || !safeText(entry[0]) || !scalar(entry[1]) || (entry.length === 3 && entry[2] !== false)) fail('INVALID_VARIABLE', 'Expected a non-cloud scalar variable [name, value]', loc);
      if (Object.hasOwn(Object.prototype, id)) fail('UNSUPPORTED_IDENTIFIER', `Scratch VM cannot reliably preserve the reserved variable ID: ${id}`, loc);
      const normalized = normalizedVariableId(id);
      if (normalizedIds.has(normalized) && normalizedIds.get(normalized) !== id) fail('IDENTIFIER_COLLISION', `Variable IDs collide after Scratch VM sanitization: ${id} and ${normalizedIds.get(normalized)}`, loc);
      normalizedIds.set(normalized, id);
      scope.set(id, variables.length);
      variables.push({targetIndex: ti, targetName: target.name, id, name: entry[0], initialValue: entry[1]});
    }
    scopes.push(scope);
    for (const [id, b] of Object.entries(target.blocks)) {
      const at = {...loc, blockId: id};
      if (++count > maxBlocks) fail('BLOCK_LIMIT', 'Project exceeds maxBlocks', at);
      if (!id || !safeText(id) || !record(b) || typeof b.opcode !== 'string' || !record(b.inputs) || !record(b.fields) || typeof b.topLevel !== 'boolean' || typeof b.shadow !== 'boolean' || !(b.next === null || typeof b.next === 'string') || !(b.parent === null || typeof b.parent === 'string')) fail('INVALID_BLOCK', 'Malformed block record', at);
      if (Object.hasOwn(Object.prototype, id)) fail('UNSUPPORTED_IDENTIFIER', `Scratch VM cannot reliably preserve the reserved block ID: ${id}`, at);
      if (!SUPPORTED_OPCODES.includes(b.opcode)) fail('UNSUPPORTED_OPCODE', `Unsupported opcode: ${b.opcode}`, at);
      if (b.mutation !== undefined) fail('UNSUPPORTED_FEATURE', 'Block mutations are unsupported', at);
      if (b.opcode === 'event_whenflagclicked') {
        if (!b.topLevel || b.parent !== null || b.shadow) fail('INVALID_BLOCK', 'Green flag must be a non-shadow root', at);
        hats.push({ti, id});
      } else if (b.topLevel) fail('EXTRA_SCRIPT', 'Only one green-flag script is accepted; detached blocks are rejected', at);
    }
  });
  if (hats.length !== 1) fail('SCRIPT_COUNT', `Expected one green-flag script; found ${hats.length}`, hats.length ? {targetIndex: hats.at(-1).ti, targetName: project.targets[hats.at(-1).ti].name, blockId: hats.at(-1).id} : {});
  const {ti, id: hat} = hats[0], target = project.targets[ti], blocks = target.blocks;
  const location = id => ({targetIndex: ti, targetName: target.name, blockId: id});
  const error = (code, message, id) => fail(code, message, location(id));
  const seen = new Set(), active = new Set();
  function enter(id, parent, depth, kind) {
    if (depth > maxDepth) error('DEPTH_LIMIT', 'Block nesting exceeds maxDepth', id);
    if (!own(blocks, id)) error('MISSING_BLOCK', `Referenced block does not exist: ${id}`, parent ?? id);
    if (active.has(id)) error('BLOCK_CYCLE', 'Cycle in block graph', id);
    if (seen.has(id)) error('SHARED_BLOCK', 'A block cannot have multiple incoming references', id);
    const b = blocks[id];
    if (b.parent !== parent) error('INVALID_PARENT', `Expected parent ${quote(parent)}`, id);
    if (parent !== null && b.topLevel) error('INVALID_BLOCK', 'Nested block cannot be top-level', id);
    if (kind === 'statement' && (!statements.has(b.opcode) || b.shadow)) error('INVALID_BLOCK', 'Expected a non-shadow statement block', id);
    if (kind === 'reporter' && (!reporters.has(b.opcode) || b.next !== null)) error('INVALID_BLOCK', 'Expected a reporter with no next block', id);
    active.add(id); seen.add(id);
    return b;
  }
  function variable(field, id) {
    if (!Array.isArray(field) || field.length !== 2 || typeof field[0] !== 'string' || typeof field[1] !== 'string') error('INVALID_VARIABLE', 'Variable field needs [name, id]', id);
    const slot = scopes[ti].get(field[1]) ?? scopes[0].get(field[1]);
    if (slot === undefined) error('MISSING_VARIABLE', `Unknown variable ID: ${field[1]}`, id);
    if (variables[slot].name !== field[0]) error('INVALID_VARIABLE', 'Variable name does not match its ID', id);
    return slot;
  }
  function shape(b, id, inputNames, fieldNames = []) {
    for (const key of Object.keys(b.inputs)) if (!inputNames.includes(key)) error('INVALID_INPUT', `Unexpected input ${key}`, id);
    for (const key of Object.keys(b.fields)) if (!fieldNames.includes(key)) error('INVALID_FIELD', `Unexpected field ${key}`, id);
    for (const key of fieldNames) if (!own(b.fields, key)) error('INVALID_FIELD', `Missing field ${key}`, id);
  }
  function primitive(desc, owner) {
    if (!Array.isArray(desc)) error('INVALID_INPUT', 'Expected a primitive descriptor', owner);
    const [type, value, vid] = desc;
    if (type === 12 && desc.length === 3) return {type: 'variable', slot: variable([value, vid], owner)};
    if (![4, 5, 6, 7, 8, 10].includes(type) || desc.length !== 2 || !scalar(value)) error('INVALID_INPUT', 'Unsupported or malformed primitive input', owner);
    return {type: 'literal', value};
  }
  function input(b, name, owner, depth, substack = false) {
    if (!own(b.inputs, name)) {
      if (substack) return [];
      // Scratch's empty boolean sockets evaluate to false.
      if (name === 'CONDITION' || ['operator_and', 'operator_or', 'operator_not'].includes(b.opcode)) return {type: 'literal', value: false};
      error('INVALID_INPUT', `Missing input ${name}`, owner);
    }
    const descriptor = b.inputs[name];
    if (!Array.isArray(descriptor) || ![1, 2, 3].includes(descriptor[0]) || descriptor.length !== (descriptor[0] === 3 ? 3 : 2)) error('INVALID_INPUT', `Malformed input ${name}`, owner);
    const parse = (value, hidden = false) => {
      if (value === null && descriptor[0] === 2 && (substack || name === 'CONDITION' || ['operator_and', 'operator_or', 'operator_not'].includes(b.opcode))) return substack ? [] : {type: 'literal', value: false};
      if (typeof value === 'string') {
        if (hidden && (!own(blocks, value) || !blocks[value].shadow)) error('INVALID_INPUT', 'Fallback block must be a shadow', owner);
        return substack ? sequence(value, owner, depth + 1) : expression(value, owner, depth + 1);
      }
      if (substack) error('INVALID_INPUT', 'Substack must reference a block', owner);
      return primitive(value, owner);
    };
    if (substack && descriptor[0] !== 2) error('INVALID_INPUT', 'Substack must use input type 2', owner);
    const result = parse(descriptor[1]);
    if (descriptor[0] === 3) parse(descriptor[2], true); // Validate even obscured shadows, without emitting them.
    return result;
  }
  function expression(id, parent, depth) {
    const b = enter(id, parent, depth, 'reporter'), op = b.opcode;
    let node;
    if (literals.has(op)) {
      const field = op === 'text' ? 'TEXT' : 'NUM';
      shape(b, id, [], [field]);
      if (!Array.isArray(b.fields[field]) || b.fields[field].length !== 1 || !scalar(b.fields[field][0])) error('INVALID_FIELD', 'Literal field must contain one scalar', id);
      node = {type: 'literal', value: b.fields[field][0]};
    } else if (op === 'data_variable') {
      shape(b, id, [], ['VARIABLE']); node = {type: 'variable', slot: variable(b.fields.VARIABLE, id)};
    } else {
      const names = own(arithmetic, op) || op === 'operator_mod' ? ['NUM1', 'NUM2'] : op === 'operator_round' ? ['NUM'] : op === 'operator_not' ? ['OPERAND'] : ['OPERAND1', 'OPERAND2'];
      shape(b, id, names);
      node = {type: 'operation', op, args: names.map(name => input(b, name, id, depth))};
    }
    active.delete(id);
    return {...node, id};
  }
  function sequence(first, parent, depth) {
    const nodes = [], chain = [];
    let id = first, previous = parent;
    while (id !== null) {
      const b = enter(id, previous, depth, 'statement'), op = b.opcode;
      const node = {id, op};
      if (op.startsWith('data_')) {
        shape(b, id, ['VALUE'], ['VARIABLE']);
        node.slot = variable(b.fields.VARIABLE, id); node.value = input(b, 'VALUE', id, depth);
      } else {
        const key = op === 'control_repeat' ? 'TIMES' : 'CONDITION';
        shape(b, id, [key, 'SUBSTACK', ...(op === 'control_if_else' ? ['SUBSTACK2'] : [])]);
        node.value = input(b, key, id, depth);
        node.body = input(b, 'SUBSTACK', id, depth, true);
        if (op === 'control_if_else') node.other = input(b, 'SUBSTACK2', id, depth, true);
      }
      nodes.push(node); chain.push(id); previous = id; id = b.next;
    }
    for (const id of chain) active.delete(id);
    return nodes;
  }
  const root = enter(hat, null, 0, 'hat');
  shape(root, hat, []);
  const program = sequence(root.next, hat, 1);
  active.delete(hat);
  project.targets.forEach((t, index) => {
    for (const id of Object.keys(t.blocks)) if (index !== ti || !seen.has(id)) fail('UNREACHABLE_BLOCK', 'Block is outside the one supported script', {targetIndex: index, targetName: t.name, blockId: id});
  });

  const lines = ['// Generated by scratch-semantic-bridge. Embedded runtime: AGPL-3.0-only.', '// Run with Node; conversion did not execute this project.', "import {pathToFileURL} from 'node:url';", '', createRuntime.toString(), '', encodeValue.toString(), '', `export const variableMetadata = ${quote(variables)};`, `export function run({maxSteps = ${maxSteps}} = {}) {`, `  const rt = createRuntime(maxSteps, ${ti}, ${quote(target.name)});`, `  const v = ${quote(variables.map(v => v.initialValue))};`].flatMap(line => line.split('\n'));
  const mappings = [];
  let indent = 1, serial = 0;
  const emit = (line, id, kind = 'statement') => {
    lines.push('  '.repeat(indent) + line);
    if (id !== undefined) mappings.push({generatedLine: lines.length, ...location(id), kind});
  };
  const tick = id => emit(`rt.tick(${quote(id)});`, id, 'step');
  function expr(node) {
    let result;
    if (node.type === 'literal') result = quote(node.value);
    else if (node.type === 'variable') result = `v[${node.slot}]`;
    else {
      const args = node.args.map(expr), [a, b] = args, op = node.op;
      if (own(arithmetic, op)) result = `rt.number(${a}) ${arithmetic[op]} rt.number(${b})`;
      else if (own(comparisons, op)) result = `rt.compare(${a}, ${b}) ${comparisons[op]} 0`;
      else if (op === 'operator_mod') result = `rt.mod(${a}, ${b})`;
      else if (op === 'operator_round') result = `Math.round(rt.number(${a}))`;
      else if (op === 'operator_not') result = `!rt.boolean(${a})`;
      else result = `rt.boolean(${a}) ${op === 'operator_and' ? '&&' : '||'} rt.boolean(${b})`;
    }
    if (node.id === undefined) return result;
    tick(node.id);
    const temp = `r${serial++}`;
    emit(`const ${temp} = ${result};`, node.id, 'reporter');
    return temp;
  }
  function generate(nodes) {
    for (const n of nodes) {
      tick(n.id);
      if (n.op === 'control_repeat_until') {
        emit('while (true) {', n.id); indent++;
        tick(n.id);
        const value = expr(n.value);
        emit(`if (rt.boolean(${value})) break;`, n.id);
        generate(n.body); indent--; emit('}');
        continue;
      }
      const value = expr(n.value);
      if (n.op === 'data_setvariableto' || n.op === 'data_changevariableby') {
        emit(`v[${n.slot}] = ${n.op === 'data_setvariableto' ? value : `rt.number(v[${n.slot}]) + rt.number(${value})`};`, n.id);
      } else if (n.op === 'control_repeat') {
        const counter = `remaining${serial++}`;
        emit(`for (let ${counter} = Math.round(rt.number(${value})); ${counter} > 0; ${counter}--) {`, n.id);
        indent++; tick(n.id); generate(n.body); indent--; emit('}');
      } else {
        emit(`if (rt.boolean(${value})) {`, n.id); indent++; generate(n.body); indent--;
        if (n.other) { emit('} else {', n.id); indent++; generate(n.other); indent--; }
        emit('}');
      }
    }
  }
  tick(hat); generate(program);
  emit('return {steps: rt.steps, variables: variableMetadata.map((meta, slot) => ({...meta, value: encodeValue(v[slot])}))};');
  indent = 0; emit('}');
  emit(`export const blockMap = ${quote({version: 1, mappings})};`);
  emit('if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {');
  indent++;
  emit('try {'); indent++;
  emit("if (process.argv.length > 3 || (process.argv[2] !== undefined && !/^--max-steps=[1-9][0-9]*$/.test(process.argv[2]))) throw Object.assign(new Error('Usage: node output.mjs [--max-steps=N]'), {code: 'INVALID_ARGUMENT'});");
  emit('const maxSteps = process.argv[2] === undefined ? undefined : Number(process.argv[2].split("=")[1]);');
  emit('console.log(JSON.stringify(run({maxSteps})));'); indent--;
  emit('} catch (error) {'); indent++;
  emit("console.error(JSON.stringify({code: error.code ?? 'RUNTIME_ERROR', message: error.message, targetIndex: error.targetIndex, targetName: error.targetName, blockId: error.blockId}));");
  emit('process.exitCode = 1;'); indent--; emit('}'); indent--; emit('}');
  return {code: lines.join('\n') + '\n', map: {version: 1, mappings}, variables};
}
