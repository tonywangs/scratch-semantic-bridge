import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {SUPPORTED_OPCODES, validate} from './compiler.js';
import {procedureMetadata} from './procedures.js';
import {readSb3} from './archive.js';
import {BridgeError} from './errors.js';
import {inspectionOptions, newReport, reportWriter, finalizeReport} from './inspection-report.js';
export {INSPECTION_LIMITS, formatInspection, inspectionExitCode} from './inspection-report.js';

const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const safeText = x => typeof x === 'string' && !x.includes('\b');
const sorted = object => Object.keys(object).sort();
const supported = new Set(SUPPORTED_OPCODES);
const compilerOptions = limits => Object.fromEntries(['maxBlocks', 'maxDepth', 'maxSteps', 'maxCallDepth', 'maxListLength'].map(key => [key, limits[key]]));

// Bound the in-memory API too. This accepts JSON data, not live objects with
// accessors/proxies. Iterators avoid recursively walking hostile JSON nesting.
function checkData(project, limits) {
  let nodes = 0, bytes = 0;
  const active = new Set();
  const stack = [{value: project, depth: 0}];
  while (stack.length) {
    const frame = stack.at(-1);
    if (frame.iterator) {
      const next = frame.iterator.next();
      if (next.done) { active.delete(frame.value); stack.pop(); continue; }
      const key = next.value;
      bytes += Buffer.byteLength(key) + 4;
      stack.push({value: frame.value[key], depth: frame.depth + 1});
      continue;
    }
    const {value, depth} = frame;
    if (++nodes > limits.maxDataNodes || depth > limits.maxDataDepth || bytes > limits.maxProjectBytes) throw new BridgeError('DATA_LIMIT', 'Input data limit');
    if (value && typeof value === 'object') {
      if (active.has(value)) throw new BridgeError('INVALID_JSON', 'Cyclic object');
      active.add(value); bytes += 2;
      frame.iterator = Object.keys(value)[Symbol.iterator]();
    } else {
      if (!(value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))) throw new BridgeError('INVALID_JSON', 'Non-JSON value');
      if (typeof value === 'string' && value.length > limits.maxProjectBytes) throw new BridgeError('DATA_LIMIT', 'String limit');
      bytes += Buffer.byteLength(JSON.stringify(value)) + 1; stack.pop();
    }
  }
  // The rough accounting above can overcount array keys; the exact bound also
  // handles escaping in object keys, without risking recursive stringify depth.
  if (Buffer.byteLength(JSON.stringify(project)) > limits.maxProjectBytes) throw new BridgeError('DATA_LIMIT', 'Project bytes limit');
}

export function inspect(project, options = {}) {
  const limits = inspectionOptions(options), report = newReport(limits);
  const {add, text, incomplete} = reportWriter(report);
  const done = () => finalizeReport(report);
  const stop = code => { add(code); incomplete(code, true); };
  try { checkData(project, limits); }
  catch (error) { add(error instanceof BridgeError ? error.code : 'INVALID_JSON'); incomplete('INPUT_NOT_ANALYZED'); return done(); }
  if (!record(project) || !Array.isArray(project.targets)) { add('INVALID_PROJECT'); incomplete('INPUT_NOT_ANALYZED'); return done(); }
  report.counts.targets = project.targets.length;
  if (project.targets.length > limits.maxTargets) { stop('TARGET_LIMIT'); return done(); }

  let exhausted = false;
  function work(amount = 1) {
    if (exhausted) return false;
    if (report.counts.work + amount > limits.maxWork) { exhausted = true; stop('WORK_LIMIT'); return false; }
    report.counts.work += amount; return true;
  }
  const targets = [], allScripts = [];
  let inventoryComplete = true;
  for (const [ti, target] of project.targets.entries()) {
    const loc = {targetIndex: ti, targetName: target?.name};
    const state = {ti, target, nodes: new Map(), scripts: [], definitions: new Map(), metadata: new Map(), reachabilityComplete: true};
    targets.push(state);
    if (!record(target) || !safeText(target.name) || typeof target.isStage !== 'boolean' || !record(target.blocks) || !record(target.variables)) {
      add('INVALID_TARGET', loc); incomplete('INVALID_TARGET'); inventoryComplete = false; continue;
    }
    const ids = sorted(target.blocks);
    report.counts.blocks += ids.length;
    if (report.counts.blocks > limits.maxBlocks) { stop('BLOCK_LIMIT'); inventoryComplete = false; break; }
    for (const id of ids) {
      if (!work()) break;
      const b = target.blocks[id];
      const node = {id, b, loc: {...loc, blockId: id, opcode: b?.opcode}, edges: [], owner: null, reached: false};
      state.nodes.set(id, node);
      if (!id || !safeText(id) || !record(b) || typeof b.opcode !== 'string' || !record(b.inputs) || !record(b.fields) || typeof b.topLevel !== 'boolean' || typeof b.shadow !== 'boolean' || !(b.next === null || typeof b.next === 'string') || !(b.parent === null || typeof b.parent === 'string')) {
        add('INVALID_BLOCK', node.loc); state.reachabilityComplete = false;
      }
      if (!record(b)) continue;
      if (typeof b.opcode === 'string' && !supported.has(b.opcode)) add('UNSUPPORTED_OPCODE', node.loc);
      if (Object.hasOwn(Object.prototype, id)) add('UNSUPPORTED_IDENTIFIER', node.loc);
      if (b.mutation !== undefined && !['procedures_prototype', 'procedures_call'].includes(b.opcode)) add('UNSUPPORTED_FEATURE', node.loc);
      if (b.topLevel && !['event_whenflagclicked', 'procedures_definition'].includes(b.opcode)) add('EXTRA_SCRIPT', node.loc);
      if (['procedures_call', 'procedures_prototype'].includes(b.opcode)) {
        try { state.metadata.set(id, procedureMetadata(b, node.loc, b.opcode === 'procedures_prototype')); }
        catch (error) { add(error instanceof BridgeError ? error.code : 'INVALID_PROCEDURE', node.loc); state.reachabilityComplete = false; }
      }
    }
  }
  if (!inventoryComplete || exhausted) {
    incomplete('INVENTORY_NOT_ANALYZED');
    // No partial inventory is allowed to drive a compiler acceptance decision.
    return done();
  }

  for (const state of targets) {
    const {nodes, target, ti} = state;
    // All structurally recognizable input slots, including hidden shadows, are
    // followed. Unknown opcodes do not suppress the inspection of their children.
    const incoming = new Map();
    for (const node of nodes.values()) {
      if (!work()) break;
      const {b, loc} = node;
      if (!record(b)) continue;
      if (typeof b.parent === 'string' && !nodes.has(b.parent)) add('MISSING_BLOCK', loc);
      const edge = id => {
        if (!work()) return;
        if (!nodes.has(id)) { add('MISSING_BLOCK', loc); state.reachabilityComplete = false; return; }
        node.edges.push(id);
        if (nodes.get(id).b?.parent !== node.id) add('INVALID_PARENT', nodes.get(id).loc);
        incoming.set(id, (incoming.get(id) ?? 0) + 1);
      };
      if (typeof b.next === 'string') edge(b.next);
      if (record(b.inputs)) for (const name of sorted(b.inputs)) {
        if (!work()) break;
        const d = b.inputs[name];
        if (!Array.isArray(d) || ![1, 2, 3].includes(d[0]) || d.length !== (d[0] === 3 ? 3 : 2)) { add('INVALID_INPUT', loc); state.reachabilityComplete = false; continue; }
        for (const value of d.slice(1)) if (typeof value === 'string') edge(value);
      }
      if (b.opcode === 'procedures_definition') {
        const d = b.inputs?.custom_block;
        const prototype = Array.isArray(d) && d.length === 2 && d[0] === 1 && typeof d[1] === 'string' ? nodes.get(d[1]) : undefined;
        const metadata = prototype && state.metadata.get(prototype.id);
        if (!prototype || prototype.b?.opcode !== 'procedures_prototype' || !prototype.b.shadow || prototype.b.topLevel || prototype.b.next !== null || prototype.b.parent !== node.id) {
          add('INVALID_PROCEDURE', loc); state.reachabilityComplete = false;
        }
        if (metadata) {
          const definitions = state.definitions.get(metadata.code) ?? [];
          if (definitions.length) add('AMBIGUOUS_PROCEDURE', loc);
          definitions.push(node.id); state.definitions.set(metadata.code, definitions);
        }
      }
    }
    for (const [id, count] of incoming) if (count > 1) add('SHARED_BLOCK', nodes.get(id).loc);
    for (const node of nodes.values()) {
      if (node.b?.opcode !== 'procedures_call') continue;
      const metadata = state.metadata.get(node.id);
      if (!metadata) continue;
      const definitions = state.definitions.get(metadata.code);
      if (!definitions) add('MISSING_PROCEDURE', node.loc, 'warning');
      else for (const id of definitions) {
        const d = nodes.get(id).b.inputs.custom_block;
        const prototype = state.metadata.get(d[1]);
        if (prototype && (metadata.ids.length !== prototype.ids.length || metadata.ids.some((arg, i) => arg !== prototype.ids[i]))) add('INVALID_PROCEDURE', node.loc);
      }
    }

    // Iterative DFS, including disconnected components, detects back edges.
    const color = new Map();
    for (const start of nodes.keys()) {
      if (color.has(start) || exhausted) continue;
      const stack = [{id: start, cursor: 0}]; color.set(start, 1);
      while (stack.length && work()) {
        const frame = stack.at(-1), node = nodes.get(frame.id), id = node.edges[frame.cursor++];
        if (id === undefined) { color.set(frame.id, 2); stack.pop(); }
        else if (color.get(id) === 1) add('BLOCK_CYCLE', node.loc);
        else if (!color.has(id)) { color.set(id, 1); stack.push({id, cursor: 0}); }
      }
    }
    function script(root, kind) {
      if (allScripts.length >= limits.maxScripts) { stop('SCRIPT_LIMIT'); exhausted = true; return; }
      const s = {state, root, kind, ids: [], calls: [], reached: kind === 'entry', result: null};
      state.scripts.push(s); allScripts.push(s);
      const queue = [root];
      while (queue.length && work()) {
        const id = queue.pop(), node = nodes.get(id);
        if (node.owner) continue;
        // Do not absorb another saved root into this script, even on malformed
        // edges. The compiler will diagnose the invalid connection separately.
        if (id !== root && (node.b?.topLevel || ['event_whenflagclicked', 'procedures_definition'].includes(node.b?.opcode))) continue;
        node.owner = s; s.ids.push(id);
        for (let i = node.edges.length - 1; i >= 0; i--) queue.push(node.edges[i]);
      }
    }
    for (const kind of ['entry', 'procedure', 'other-script']) {
      for (const node of nodes.values()) {
        if (exhausted) break;
        const op = node.b?.opcode;
        const selected = kind === 'entry' ? op === 'event_whenflagclicked' : kind === 'procedure' ? op === 'procedures_definition' : node.b?.topLevel && !['event_whenflagclicked', 'procedures_definition'].includes(op);
        if (selected && !node.owner) script(node.id, kind);
      }
    }
    for (const node of nodes.values()) {
      if (exhausted) break;
      if (!node.owner) script(node.id, 'disconnected');
    }
    for (const s of state.scripts) for (const id of s.ids) {
      const node = nodes.get(id), metadata = state.metadata.get(id);
      if (s.kind === 'disconnected') add('UNREACHABLE_BLOCK', node.loc);
      if (node.b?.opcode === 'procedures_call' && metadata) {
        for (const definition of state.definitions.get(metadata.code) ?? []) {
          const callee = nodes.get(definition).owner;
          if (callee) s.calls.push({callee, node});
        }
      }
    }
    // A call in either branch, an obscured input, or an unused procedure is a
    // structural edge. This is deliberately not an execution predictor.
    const reachQueue = state.scripts.filter(s => s.kind === 'entry');
    for (let i = 0; i < reachQueue.length && work(); i++) {
      for (const {callee} of reachQueue[i].calls) if (!callee.reached) { callee.reached = true; reachQueue.push(callee); }
    }
    const visited = new Set(), active = new Set();
    for (const s of state.scripts.filter(s => s.kind === 'procedure')) {
      if (visited.has(s) || exhausted) continue;
      const stack = [{s, cursor: 0}]; active.add(s);
      while (stack.length && work()) {
        const f = stack.at(-1), edge = f.s.calls[f.cursor++];
        if (!edge) { active.delete(f.s); visited.add(f.s); stack.pop(); }
        else if (active.has(edge.callee)) add('RECURSIVE_PROCEDURE', edge.node.loc);
        else if (!visited.has(edge.callee)) { active.add(edge.callee); stack.push({s: edge.callee, cursor: 0}); }
      }
    }
  }
  report.counts.scripts = allScripts.length;
  const entries = allScripts.filter(s => s.kind === 'entry');
  if (entries.length !== 1) add('SCRIPT_COUNT');

  function runValidation(input, count, source, fallback = {}) {
    if (report.counts.validationRuns >= limits.maxValidationRuns) { stop('VALIDATION_LIMIT'); return {status: 'not-run'}; }
    if (!work(count + project.targets.length)) return {status: 'not-run'};
    report.counts.validationRuns++;
    try { validate(input, compilerOptions(limits)); return {status: 'accepted'}; }
    catch (error) {
      if (!(error instanceof BridgeError)) { add('INTERNAL_ERROR', fallback, 'error', source); incomplete('VALIDATION_FAILED'); return {status: 'not-run'}; }
      const state = targets[error.targetIndex], node = state?.nodes.get(error.blockId);
      add(error.code, {...fallback, targetIndex: error.targetIndex ?? fallback.targetIndex,
        targetName: state?.target?.name ?? fallback.targetName, blockId: error.blockId ?? fallback.blockId,
        opcode: node?.b?.opcode ?? fallback.opcode}, 'error', source);
      return {status: 'rejected', code: error.code};
    }
  }
  if (!exhausted) report.compiler = runValidation(project, report.counts.blocks, 'compiler');
  for (const s of allScripts) {
    if (report.compiler.status === 'accepted') s.result = {status: 'accepted'};
    else if (['entry', 'procedure'].includes(s.kind) && !exhausted) {
      // Validate one script plus its transitive target-local callees. Keep all
      // variable scopes and project-level settings; omit unrelated block roots.
      const ids = new Set(), seen = new Set(), queue = [s];
      while (queue.length && work()) {
        const next = queue.pop();
        if (seen.has(next)) continue;
        seen.add(next);
        for (const id of next.ids) { if (!work()) break; ids.add(id); }
        for (const {callee} of next.calls) queue.push(callee);
      }
      if (!exhausted) {
        const blocks = Object.fromEntries([...ids].sort().map(id => [id, s.state.nodes.get(id).b]));
        if (s.kind === 'procedure') {
          let synthetic = '__inspection_entry__';
          while (Object.hasOwn(blocks, synthetic)) synthetic += '_';
          blocks[synthetic] = {opcode: 'event_whenflagclicked', next: null, parent: null, inputs: {}, fields: {}, topLevel: true, shadow: false};
        }
        const isolated = {...project, targets: project.targets.map((t, i) => ({...t, blocks: i === s.state.ti ? blocks : {}}))};
        s.result = runValidation(isolated, Object.keys(blocks).length, 'script-validator', s.state.nodes.get(s.root).loc);
      }
    }
    const status = s.result?.status ?? 'not-run';
    if (status !== 'accepted') incomplete('SEMANTIC_REGIONS_UNANALYZED');
    const support = status === 'accepted' ? 'supported' : status === 'rejected' || ['other-script', 'disconnected'].includes(s.kind) ? 'unsupported' : 'unanalyzed';
    let reachability = s.kind === 'entry' ? 'entry' : s.kind === 'procedure' ? s.reached ? 'called-procedure' : 'uncalled-procedure' : s.kind;
    // Positive discovered paths remain useful. Absence of a path is unknown
    // when malformed sockets/metadata or a budget prevented graph discovery.
    if ((exhausted || !s.state.reachabilityComplete) && ['uncalled-procedure', 'disconnected'].includes(reachability)) reachability = 'unanalyzed';
    report.scripts.push({targetIndex: s.state.ti, targetName: text(s.state.target.name), scriptId: text(s.root),
      opcode: text(s.state.nodes.get(s.root).b?.opcode), kind: s.kind, reachability,
      support, analysis: status === 'accepted' ? 'complete' : status === 'rejected' ? 'first-error' : 'not-run', blockCount: s.ids.length});
    for (const id of s.ids.sort()) {
      const node = s.state.nodes.get(id);
      report.blocks.push({targetIndex: s.state.ti, scriptId: text(s.root), blockId: text(id), opcode: text(node.b?.opcode),
        reachability, analysis: status === 'accepted' ? 'validated' : 'unanalyzed'});
    }
  }
  // Locations are resolved after ownership discovery; retain null for project-
  // level diagnostics and for data that never received a bounded inventory.
  for (const diagnostic of report.diagnostics) {
    const node = targets[diagnostic.targetIndex]?.nodes.get(diagnostic.blockId);
    if (node?.owner) diagnostic.scriptId = text(node.owner.root);
  }
  if (exhausted) incomplete('TRAVERSAL_NOT_ANALYZED');
  return done();
}

// Offline, bounded regular-file reads. Assets are never inflated or extracted.
// Format is explicit to avoid guessing a malformed archive is project JSON.
export async function inspectFile(path, options = {}) {
  const limits = inspectionOptions(options), report = newReport(limits);
  const {add, incomplete} = reportWriter(report);
  let file;
  try {
    const json = String(path).toLowerCase().endsWith('.json');
    const max = json ? limits.maxProjectBytes : limits.maxArchiveBytes;
    // Do not block opening a FIFO before we can reject non-regular files.
    file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile()) throw new BridgeError('IO_ERROR', 'Regular files only');
    if (stat.size > max) throw new BridgeError('ARCHIVE_LIMIT', 'Input bytes limit');
    const buffer = Buffer.alloc(Math.min(stat.size + 1, max + 1));
    let length = 0;
    while (length < buffer.length) {
      const {bytesRead} = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > stat.size) throw new BridgeError('ARCHIVE_LIMIT', 'Input grew while reading');
    const bytes = buffer.subarray(0, length);
    let project;
    if (json) {
      try { project = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
      catch { throw new BridgeError('INVALID_JSON', 'Invalid JSON'); }
    } else project = readSb3(bytes, Object.fromEntries(['maxArchiveBytes', 'maxProjectBytes', 'maxExpandedBytes', 'maxEntries'].map(key => [key, limits[key]])));
    return inspect(project, limits);
  } catch (error) {
    add(error instanceof BridgeError ? error.code : 'IO_ERROR');
    incomplete('INPUT_NOT_ANALYZED');
    return finalizeReport(report);
  } finally { if (file) await file.close(); }
}
