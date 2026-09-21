import {fail} from './errors.js';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && !value.includes('\b');
const scalar = value => text(value) || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
export const argumentOpcodes = ['argument_reporter_string_number', 'argument_reporter_boolean'];

// VM procedure and input caches use ordinary objects. Reject names which their
// inherited properties or special input handling make unreliable.
const reservedInput = id => Object.hasOwn(Object.prototype, id) || ['mutation', 'custom_block', 'BROADCAST_INPUT'].includes(id);
export function procedureMetadata(block, location, prototype = false) {
  const bad = message => fail('INVALID_PROCEDURE', message, location);
  const mutation = block.mutation;
  const allowed = ['tagName', 'children', 'proccode', 'argumentids', 'warp', ...(prototype ? ['argumentnames', 'argumentdefaults'] : [])];
  if (!record(mutation)) bad('Procedure needs mutation metadata');
  if (Object.keys(mutation).some(key => !allowed.includes(key))) bad('Unexpected procedure mutation attribute');
  if (mutation.tagName !== 'mutation' || !Array.isArray(mutation.children) || mutation.children.length) bad('Expected an empty mutation element');
  if (!text(mutation.proccode) || !mutation.proccode.length) bad('proccode must be nonempty text');
  if (Object.hasOwn(Object.prototype, mutation.proccode)) fail('UNSUPPORTED_IDENTIFIER', 'Procedure code conflicts with Scratch VM cache properties', location);
  if (!['true', 'false'].includes(mutation.warp)) bad('warp must be the string "true" or "false"');
  const array = key => {
    let value;
    try { if (typeof mutation[key] !== 'string') bad(`${key} must be a JSON array string`); value = JSON.parse(mutation[key]); }
    catch { bad(`${key} must be a JSON array string`); }
    if (!Array.isArray(value)) bad(`${key} must decode to an array`);
    return value;
  };
  const ids = array('argumentids');
  if (ids.length > 128) bad('At most 128 parameters per procedure are supported');
  if (ids.some(id => !text(id) || !id || reservedInput(id))) bad('Argument IDs must be nonempty text without reserved VM input names');
  if (new Set(ids).size !== ids.length) bad('Argument IDs must be unique');
  const types = [...mutation.proccode.matchAll(/%([a-zA-Z])/g)].map(match => match[1]);
  if (types.some(type => !['s', 'n', 'b'].includes(type)) || types.length !== ids.length) bad('proccode placeholders (%s, %n, %b) must match argumentids');
  const metadata = {code: mutation.proccode, ids, types, warp: mutation.warp === 'true'};
  if (prototype) {
    const names = array('argumentnames'), defaults = array('argumentdefaults');
    if (names.length !== ids.length || defaults.length !== ids.length) bad('Argument IDs, names, and defaults must have equal lengths');
    if (names.some(name => !text(name) || name === '__proto__')) bad('Argument names must be text other than __proto__');
    if (new Set(names).size !== names.length) bad('Argument names must be unique; duplicate names are ambiguous');
    if (!defaults.every(scalar)) bad('Argument defaults must be finite scalar values');
    Object.assign(metadata, {names, defaults});
  }
  return metadata;
}

// Validate every definition, including unused ones, without recursive JS graph
// traversal. An edge in a dead branch still makes recursion unsupported.
export function validateCallGraph(procedures) {
  const done = new Set(), active = new Set();
  for (const start of procedures) {
    if (done.has(start)) continue;
    const stack = [{procedure: start, next: 0}];
    active.add(start);
    while (stack.length) {
      const frame = stack.at(-1), edge = frame.procedure.calls[frame.next++];
      if (!edge) {
        active.delete(frame.procedure); done.add(frame.procedure); stack.pop();
      } else if (active.has(edge.procedure)) {
        fail('RECURSIVE_PROCEDURE', `Recursive call to ${JSON.stringify(edge.procedure.code)}; nonrecursive procedures only`, edge.location);
      } else if (!done.has(edge.procedure)) {
        active.add(edge.procedure); stack.push({procedure: edge.procedure, next: 0});
      }
    }
  }
}
