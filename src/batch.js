import {open, realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname, resolve, relative, isAbsolute, sep} from 'node:path';
import {fork} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {BridgeError, fail, positiveLimit} from './errors.js';
import {inspectionOptions} from './inspection-report.js';

export const BATCH_LIMITS = Object.freeze({
  maxFiles: 128, maxManifestBytes: 256 * 1024,
  maxTotalInputBytes: 64 * 1024 * 1024, maxTotalExpandedBytes: 256 * 1024 * 1024,
  maxTotalWork: 2000000, maxBatchReportBytes: 4 * 1024 * 1024,
  maxFileMs: 5000, maxTotalMs: 60000
});
const workerPath = fileURLToPath(new URL('./batch-worker.js', import.meta.url));
const size = value => Buffer.byteLength(JSON.stringify(value)) + 1;
const inside = (root, path) => { const r = relative(root, path); return r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r); };
function optionsFor(options) {
  for (const key of Object.keys(options)) if (!Object.hasOwn(BATCH_LIMITS, key)) fail('INVALID_LIMIT', 'Unknown batch limit');
  const limits = {...BATCH_LIMITS, ...options};
  for (const [key, value] of Object.entries(limits)) {
    positiveLimit(value, key);
    if (value > BATCH_LIMITS[key] || (key === 'maxBatchReportBytes' && value < 4096)) fail('INVALID_LIMIT', 'Batch limit outside allowed range');
  }
  return limits;
}

export async function readManifest(path, maxBytes = BATCH_LIMITS.maxManifestBytes) {
  positiveLimit(maxBytes, 'maxManifestBytes');
  if (maxBytes > BATCH_LIMITS.maxManifestBytes) fail('INVALID_LIMIT', 'Manifest limit exceeds ceiling');
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  let value;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes) fail('MANIFEST_LIMIT', 'Manifest must be a bounded regular file');
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length !== stat.size) fail('MANIFEST_LIMIT', 'Manifest changed while reading');
    try { value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, length))); }
    catch { fail('INVALID_MANIFEST', 'Manifest is not UTF-8 JSON'); }
  } finally { await file.close(); }
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.files) || Object.keys(value).some(k => !['schemaVersion', 'files'].includes(k)) || value.files.length > 1024) fail('INVALID_MANIFEST', 'Expected version 1 manifest with at most 1024 files');
  const ids = new Set();
  for (const row of value.files) {
    if (!row || typeof row !== 'object' || Object.keys(row).length !== 2 || typeof row.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(row.id) || ids.has(row.id) || typeof row.path !== 'string' || !row.path || row.path.length > 1024 || row.path.includes('\0')) fail('INVALID_MANIFEST', 'Each file needs a unique short ASCII id and a path');
    ids.add(row.id);
  }
  return value;
}

// Await process close even after timeout/cancellation, so no child survives a
// returned report. No temp files, archive extraction, or project script loading.
function inspectChild(path, limits, timeoutMs, signal) {
  return new Promise(resolveResult => {
    let message, failure, child;
    const stop = code => { if (!failure) failure = code; child?.kill('SIGKILL'); };
    const abort = () => stop('CANCELLED');
    try {
      child = fork(workerPath, [], {execArgv: ['--max-old-space-size=128'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json'});
    } catch { resolveResult({error: 'WORKER_FAILURE'}); return; }
    const timer = setTimeout(() => stop('TIMEOUT'), Math.max(1, timeoutMs));
    signal?.addEventListener('abort', abort, {once: true});
    child.once('error', () => stop('WORKER_FAILURE'));
    child.once('message', data => { message = data; });
    child.once('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      resolveResult(failure ? {error: failure} : code === 0 && message ? message : {error: 'WORKER_FAILURE'});
    });
    if (signal?.aborted) abort();
    else child.send({path, limits}, error => { if (error) stop('WORKER_FAILURE'); });
  });
}

function entry(index, id, status = 'skipped', reason = null) {
  return {index, id, status, compatible: false, complete: false, reason, sha256: null,
    compilerCheck: 'not-run', blockerCounts: reason ? {[reason]: 1} : {}, diagnostics: [], inspection: null};
}
function summarize(report) {
  const counts = {total: report.totalFiles, reported: report.entries.length, compatible: 0, incompatible: 0, incomplete: 0, skipped: 0, omitted: report.omittedEntries};
  const frequencies = {};
  for (const e of report.entries) {
    counts[e.status]++;
    for (const code of Object.keys(e.blockerCounts)) frequencies[code] = (frequencies[code] ?? 0) + 1;
  }
  report.counts = counts;
  report.projectBlockerFrequency = Object.fromEntries(Object.entries(frequencies).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  report.complete = report.omittedEntries === 0 && report.entries.every(e => e.complete) && report.reasons.length === 0;
  // An empty manifest is a completed no-op, never a compatibility claim.
  report.compatible = report.totalFiles > 0 && report.complete && counts.compatible === report.totalFiles;
}

export async function inspectBatch(manifestPath, {limits: supplied = {}, inspection: suppliedInspection = {}, signal, onMetrics} = {}) {
  const started = performance.now(), limits = optionsFor(supplied), inspection = inspectionOptions(suppliedInspection);
  const manifest = await readManifest(manifestPath, limits.maxManifestBytes);
  const root = await realpath(dirname(resolve(manifestPath)));
  const report = {schemaVersion: 1, policy: 'scratch-semantic-bridge/batch-v1', complete: false, compatible: false,
    limits, inspectionLimits: inspection, totalFiles: manifest.files.length, omittedEntries: 0, reasons: [],
    usage: {inputBytes: 0, expandedBytes: 0, work: 0, accounting: 'charged upper bounds; failed workers reserve their allocated budgets'},
    counts: {}, projectBlockerFrequency: {}, entries: []};
  const seen = new Set(); let peakChildRssKiB = 0, stopped = false;
  for (const [index, row] of manifest.files.entries()) {
    const e = entry(index, row.id);
    const remainingMs = limits.maxTotalMs - (performance.now() - started);
    if (signal?.aborted) e.reason = 'CANCELLED';
    else if (index >= limits.maxFiles) e.reason = 'FILE_LIMIT';
    else if (remainingMs <= 0) e.reason = 'TOTAL_TIMEOUT';
    else if (stopped) e.reason = 'REPORT_LIMIT';
    else if (report.usage.inputBytes >= limits.maxTotalInputBytes) e.reason = 'TOTAL_INPUT_LIMIT';
    else if (report.usage.expandedBytes >= limits.maxTotalExpandedBytes) e.reason = 'TOTAL_EXPANDED_LIMIT';
    else if (report.usage.work >= limits.maxTotalWork) e.reason = 'TOTAL_WORK_LIMIT';
    else {
      const path = resolve(root, row.path);
      // Both lexical and real paths are confined. No globbing or directory walk.
      if (isAbsolute(row.path) || !inside(root, path)) e.reason = 'PATH_OUTSIDE_ROOT';
      else {
        let actual;
        try { actual = await realpath(path); }
        catch { e.status = 'incomplete'; e.reason = 'IO_ERROR'; }
        if (actual && !inside(root, actual)) e.reason = 'PATH_OUTSIDE_ROOT';
        else if (actual && seen.has(actual)) e.reason = 'DUPLICATE_INPUT';
        else if (actual) {
          seen.add(actual);
          const perFile = {...inspection,
            maxArchiveBytes: Math.min(inspection.maxArchiveBytes, limits.maxTotalInputBytes - report.usage.inputBytes),
            maxExpandedBytes: Math.min(inspection.maxExpandedBytes, limits.maxTotalExpandedBytes - report.usage.expandedBytes),
            maxWork: Math.min(inspection.maxWork, limits.maxTotalWork - report.usage.work)};
          const timeLeft = limits.maxTotalMs - (performance.now() - started);
          const result = timeLeft <= 0 ? {error: 'TOTAL_TIMEOUT', skipped: true, usage: {inputBytes: 0, expandedBytes: 0, work: 0}} : await inspectChild(actual, perFile, Math.min(limits.maxFileMs, timeLeft), signal);
          peakChildRssKiB = Math.max(peakChildRssKiB, result.peakRssKiB ?? 0);
          // On a killed/failed worker nothing trustworthy was returned. Reserve
          // the full allocation instead of silently resetting aggregate limits.
          report.usage.inputBytes += Math.min(perFile.maxArchiveBytes, result.usage?.inputBytes ?? perFile.maxArchiveBytes);
          report.usage.expandedBytes += Math.min(perFile.maxExpandedBytes, result.usage?.expandedBytes ?? perFile.maxExpandedBytes);
          report.usage.work += Math.min(perFile.maxWork, result.usage?.work ?? perFile.maxWork);
          e.status = result.skipped ? 'skipped' : 'incomplete';
          e.sha256 = result.sha256 ?? null;
          if (result.error) e.reason = result.error;
          else {
            const r = result.report;
            e.sha256 = result.sha256;
            e.compilerCheck = result.compilerCheck;
            e.complete = r.complete && result.compilerCheck !== 'rejected';
            e.compatible = e.complete && r.compatible && result.compilerCheck === 'accepted';
            e.status = e.compatible ? 'compatible' : e.complete ? 'incompatible' : 'incomplete';
            e.reason = result.compilerCheck === 'rejected' ? 'COMPILER_DISAGREEMENT' : r.complete ? null : 'INSPECTION_INCOMPLETE';
            // Locations and opcodes only: target display names and project text
            // are not needed for a batch compatibility audit.
            e.diagnostics = r.diagnostics.map(({code, severity, targetIndex, scriptId, blockId, opcode, source}) => ({code, severity, targetIndex, scriptId, blockId, opcode, source}));
            e.inspection = {complete: r.complete, truncated: r.truncated, truncation: r.truncation, counts: r.counts, compiler: r.compiler};
            for (const d of e.diagnostics) if (d.severity === 'error') e.blockerCounts[d.code] = (e.blockerCounts[d.code] ?? 0) + 1;
          }
        }
      }
    }
    if (e.reason && !['INSPECTION_INCOMPLETE'].includes(e.reason)) e.blockerCounts[e.reason] = 1;
    report.entries.push(e); summarize(report);
    if (size(report) > limits.maxBatchReportBytes) {
      // Reserve room for later summaries; never emit a shortened compatible row.
      report.entries[report.entries.length - 1] = entry(index, row.id, 'incomplete', 'REPORT_LIMIT');
      stopped = true;
      if (!report.reasons.includes('REPORT_LIMIT')) report.reasons.push('REPORT_LIMIT');
      summarize(report);
      if (size(report) > limits.maxBatchReportBytes) {
        report.entries.pop(); report.omittedEntries = manifest.files.length - report.entries.length;
        summarize(report);
        // Summary fields can grow slightly when adding the omitted count.
        while (size(report) > limits.maxBatchReportBytes && report.entries.length) {
          report.entries.pop(); report.omittedEntries++; summarize(report);
        }
        break;
      }
    }
  }
  summarize(report);
  onMetrics?.({elapsedMs: performance.now() - started, peakChildRssKiB, parentPeakRssKiB: process.resourceUsage().maxRSS});
  return report;
}

export const batchExitCode = report => report.compatible || (report.complete && report.totalFiles === 0) ? 0 : report.complete ? 1 : 2;
export function formatBatch(report) {
  const lines = [`Scratch bridge batch v${report.schemaVersion}: ${report.counts.compatible}/${report.totalFiles} compatible with the configured subset`,
    `Analysis: ${report.complete ? 'complete' : 'incomplete'}; incompatible ${report.counts.incompatible}; incomplete ${report.counts.incomplete}; skipped ${report.counts.skipped}; omitted ${report.omittedEntries}.`,
    'Compiler acceptance is not behavioral equivalence. Imported projects were not executed.'];
  for (const e of report.entries) {
    lines.push(`${e.index} ${e.id}: ${e.status}${e.reason ? ' (' + e.reason + ')' : ''}; blockers ${JSON.stringify(e.blockerCounts)}`);
    for (const d of e.diagnostics) lines.push(`  ${d.code} target=${d.targetIndex} script=${JSON.stringify(d.scriptId)} block=${JSON.stringify(d.blockId)} opcode=${JSON.stringify(d.opcode)}`);
  }
  let output = '';
  const suffix = 'Text output incomplete: REPORT_LIMIT; use JSON for structured outcomes.\n';
  for (const line of lines) {
    if (Buffer.byteLength(output + line + '\n' + suffix) > report.limits.maxBatchReportBytes) return output + suffix;
    output += line + '\n';
  }
  return output;
}
