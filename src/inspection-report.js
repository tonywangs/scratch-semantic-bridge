import {positiveLimit, fail} from './errors.js';
import {ARCHIVE_LIMITS} from './archive.js';

// Inspection can lower these ceilings, never raise them. Conversion limits remain unchanged.
export const INSPECTION_LIMITS = Object.freeze({
  ...ARCHIVE_LIMITS, maxTargets: 128, maxBlocks: 10000, maxScripts: 256,
  maxWork: 200000, maxValidationRuns: 128, maxDiagnostics: 1000,
  maxReportBytes: 1024 * 1024, maxMetadataChars: 200,
  maxDataDepth: 256, maxDataNodes: 500000, maxDepth: 128,
  maxCallDepth: 64, maxListLength: 10000, maxSteps: 100000
});
const ceilings = {...INSPECTION_LIMITS, maxDepth: 256, maxCallDepth: 256, maxListLength: 200000, maxSteps: Number.MAX_SAFE_INTEGER};
export function inspectionOptions(options = {}) {
  for (const key of Object.keys(options)) if (!Object.hasOwn(ceilings, key)) fail('INVALID_LIMIT', 'Unknown inspection limit');
  const limits = {...INSPECTION_LIMITS, ...options};
  for (const [key, value] of Object.entries(limits)) {
    positiveLimit(value, key);
    if (value > ceilings[key] || (key === 'maxReportBytes' && value < 4096)) fail('INVALID_LIMIT', `Inspection ${key} is outside its allowed range`);
  }
  return limits;
}

// Explanations deliberately never interpolate literals, variable names, procedure
// codes, archive paths, or the compiler's potentially project-derived messages.
export const explanations = Object.freeze({
  INVALID_PROJECT: 'Expected Scratch 3 metadata and exactly one stage as the first target.',
  INVALID_TARGET: 'Target must contain a text name, Boolean isStage, and block and variable dictionaries.',
  UNSUPPORTED_FEATURE: 'Extensions, broadcasts, cloud data, or this mutation are outside the sequential conversion model.',
  INVALID_BLOCK: 'Malformed block record or block used in an unsupported statement/reporter position.',
  UNSUPPORTED_OPCODE: 'This operation is outside the supported sequential subset.',
  UNSUPPORTED_IDENTIFIER: 'An identifier conflicts with Scratch VM object/cache properties or contains unsupported characters.',
  IDENTIFIER_COLLISION: 'Variable/list identifiers collide in a scope or after Scratch VM normalization.',
  INVALID_VARIABLE: 'Variable definition or reference has an invalid shape, name, kind, or value.',
  MISSING_VARIABLE: 'Referenced variable ID has no visible target-local or stage definition.',
  INVALID_LIST: 'List definition or reference has an invalid shape, name, kind, or value.',
  MISSING_LIST: 'Referenced list ID has no visible target-local or stage definition.',
  UNSUPPORTED_LIST_INDEX: 'Literal random/any list indices are outside the deterministic subset.',
  INVALID_INPUT: 'Input socket or primitive descriptor is malformed or does not match the operation.',
  INVALID_FIELD: 'A required field is missing, malformed, or unexpected for this operation.',
  EXTRA_SCRIPT: 'Detached top-level blocks and additional event types are outside the one-green-flag model.',
  SCRIPT_COUNT: 'Conversion requires exactly one green-flag script across all targets.',
  MISSING_BLOCK: 'A next, input, or parent reference points to an absent target-local block.',
  INVALID_PARENT: 'The saved parent does not match an incoming structural reference.',
  SHARED_BLOCK: 'More than one structural reference points to the same block.',
  BLOCK_CYCLE: 'The next/input graph contains a cycle; traversal cannot represent a valid block tree.',
  UNREACHABLE_BLOCK: 'Block is disconnected from an entry script or procedure definition; conversion rejects it.',
  INVALID_PROCEDURE: 'Procedure mutation, prototype attachment, parameter metadata, or call arguments are malformed or inconsistent.',
  AMBIGUOUS_PROCEDURE: 'Multiple definitions have the same procedure code in this target.',
  MISSING_PROCEDURE: 'No valid target-local definition was indexed. With otherwise valid metadata, conversion accepts the missing call as a no-op after evaluating supplied inputs.',
  RECURSIVE_PROCEDURE: 'The structural procedure call graph contains recursion, including unused definitions and unexecuted branches.',
  BLOCK_LIMIT: 'Block inventory exceeds the inspection or conversion block limit.',
  DEPTH_LIMIT: 'Block nesting exceeds the conversion depth limit.',
  LIST_LIMIT: 'An initial list exceeds the configured conversion list limit.',
  TARGET_LIMIT: 'Target inventory exceeds the inspection limit.',
  SCRIPT_LIMIT: 'Script inventory exceeds the inspection limit.',
  WORK_LIMIT: 'The shared traversal and validation work budget was exhausted.',
  VALIDATION_LIMIT: 'The number of isolated script validations reached its limit.',
  DIAGNOSTIC_LIMIT: 'Additional diagnostics were omitted after reaching the diagnostic limit.',
  OUTPUT_LIMIT: 'Report records were omitted to keep the serialized report within its byte limit.',
  METADATA_LIMIT: 'Location metadata was shortened; the report is incomplete.',
  DATA_LIMIT: 'Input exceeds the JSON size, depth, or node limit.',
  INVALID_JSON: 'Input must be valid UTF-8 JSON containing only finite JSON values.',
  INVALID_ARCHIVE: 'Archive structure, compression, project.json, or checksum is invalid or unsupported.',
  ARCHIVE_LIMIT: 'Input exceeds an archive, entry, expanded-size, or project-size limit.',
  IO_ERROR: 'Input could not be read as a regular file.',
  INTERNAL_ERROR: 'Unexpected validation failure; no compatibility conclusion is available.'
});

export function newReport(limits) {
  return {schemaVersion: 1, policy: 'scratch-semantic-bridge/sequential-v1', compatible: false,
    complete: true, truncated: false, compiler: {status: 'not-run'}, limits,
    counts: {targets: 0, blocks: 0, scripts: 0, work: 0, validationRuns: 0},
    truncation: [], diagnostics: [], scripts: [], blocks: []};
}
export function reportWriter(report) {
  const keys = new Set();
  function incomplete(reason, truncated = false) {
    report.complete = false; report.compatible = false;
    if (truncated) report.truncated = true;
    if (!report.truncation.includes(reason)) report.truncation.push(reason);
  }
  function text(value) {
    if (typeof value !== 'string') return null;
    if (value.length > report.limits.maxMetadataChars) {
      incomplete('METADATA_LIMIT', true);
      return value.slice(0, report.limits.maxMetadataChars) + '…';
    }
    return value;
  }
  function add(code, location = {}, severity = 'error', source = 'structure') {
    const row = {severity, code, explanation: explanations[code] ?? explanations.INTERNAL_ERROR,
      targetIndex: location.targetIndex ?? null, targetName: text(location.targetName),
      scriptId: text(location.scriptId), blockId: text(location.blockId), opcode: text(location.opcode), source};
    const key = JSON.stringify([code, row.targetIndex, location.blockId ?? null, source]);
    if (keys.has(key)) return;
    if (report.diagnostics.length >= report.limits.maxDiagnostics) { incomplete('DIAGNOSTIC_LIMIT', true); return; }
    keys.add(key); report.diagnostics.push(row);
  }
  return {add, text, incomplete};
}

export function finalizeReport(report) {
  report.compatible = report.complete && report.compiler.status === 'accepted' && !report.diagnostics.some(d => d.severity === 'error');
  // A deterministic order independent of dictionary insertion order. Locale-free.
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  report.diagnostics.sort((a, b) => compare(a.targetIndex ?? -1, b.targetIndex ?? -1) || compare(a.scriptId ?? '', b.scriptId ?? '') || compare(a.blockId ?? '', b.blockId ?? '') || compare(a.code, b.code) || compare(a.source, b.source));
  const size = () => Buffer.byteLength(JSON.stringify(report)) + 1;
  if (size() > report.limits.maxReportBytes) {
    report.complete = false; report.compatible = false; report.truncated = true;
    if (!report.truncation.includes('OUTPUT_LIMIT')) report.truncation.push('OUTPUT_LIMIT');
    // Drop suffixes geometrically: bounded serialization work, not quadratic deletion.
    for (const key of ['blocks', 'scripts', 'diagnostics']) {
      while (report[key].length && size() > report.limits.maxReportBytes) report[key].length = Math.floor(report[key].length / 2);
    }
  }
  return report;
}
export const inspectionExitCode = report => report.compatible ? 0 : report.complete ? 1 : 2;
export function formatInspection(report) {
  const quoted = value => JSON.stringify(value ?? null);
  const lines = [`Scratch bridge inspection v${report.schemaVersion}: ${report.compatible ? 'compatible with the configured converter' : 'not compatible / not established'}`,
    `Analysis: ${report.complete ? 'complete' : 'incomplete'}; compiler: ${report.compiler.status}; targets ${report.counts.targets}; blocks ${report.counts.blocks}.`,
    'Structural reachability does not mean execution. Compiler acceptance is not general Scratch compatibility.'];
  for (const reason of report.truncation) lines.push(`Incomplete: ${reason}`);
  for (const s of report.scripts) lines.push(`Script target=${s.targetIndex} ${quoted(s.targetName)} root=${quoted(s.scriptId)} kind=${s.kind} reachability=${s.reachability} support=${s.support} analysis=${s.analysis}`);
  for (const d of report.diagnostics) lines.push(`${d.severity.toUpperCase()} ${d.code} target=${d.targetIndex} ${quoted(d.targetName)} script=${quoted(d.scriptId)} block=${quoted(d.blockId)} opcode=${quoted(d.opcode)}: ${d.explanation}`);
  // JSON records have greater structural overhead than these lines, but enforce
  // the text limit independently and signal any text-only omission.
  const suffix = '\nText output truncated: OUTPUT_LIMIT (use --json for the bounded structured report).\n';
  let output = '';
  for (const line of lines) {
    if (Buffer.byteLength(output) + Buffer.byteLength(line) + 1 + Buffer.byteLength(suffix) > report.limits.maxReportBytes) return output + suffix;
    output += line + '\n';
  }
  return output;
}
