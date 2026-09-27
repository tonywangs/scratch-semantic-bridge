import {open, unlink, realpath} from 'node:fs/promises';
import {resolve, dirname, basename} from 'node:path';
import {BATCH_LIMITS, inspectBatch, readManifest, batchExitCode, formatBatch} from './batch.js';
import {INSPECTION_LIMITS} from './inspection-report.js';
import {BridgeError} from './errors.js';

const flag = key => '--' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
async function canonicalPotentialPath(path) {
  let ancestor = resolve(path);
  const tail = [];
  for (;;) {
    try { return resolve(await realpath(ancestor), ...tail); }
    catch (error) {
      if (error.code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error;
      tail.unshift(basename(ancestor)); ancestor = dirname(ancestor);
    }
  }
}
export const batchHelp = `Usage: scratch-bridge inspect-batch MANIFEST.json [--json] [--output NEW_FILE] [limits]

Manifest: {"schemaVersion":1,"files":[{"id":"sample","path":"sample.sb3"}]}
Paths are relative to the manifest directory and confined to it. No globs.
Order is preserved. Repeated canonical paths are skipped as DUPLICATE_INPUT.
Reports omit paths and target display names. No imported code is executed.
Existing output files are never overwritten. SIGINT/SIGTERM cancel inspection
and return partial outcomes after terminating the active worker.
Exit: 0 all compatible (or empty); 1 incompatible; 2 incomplete; 3 usage/I/O error.

Batch limits (positive integers, can only be lowered):
${Object.entries(BATCH_LIMITS).map(([key, value]) => `  ${flag(key)} ${value}`).join('\n')}
max-batch-report-bytes minimum: 4096; manifest hard ceiling: 1024 rows.
All per-file limits from inspect --help are also accepted.
See docs/batch-inspection.md for accounting and deadline limitations.
`;
export async function batchCli(args) {
  let controller;
  const cancel = () => controller?.abort();
  try {
    if (args.length === 1 && args[0] === '--help') { process.stdout.write(batchHelp); return; }
    const keys = Object.fromEntries([...Object.keys(BATCH_LIMITS), ...Object.keys(INSPECTION_LIMITS)].map(k => [flag(k), k]));
    const used = new Set(), limits = {}, inspection = {};
    let manifestPath, output, json = false;
    const bad = () => { throw new BridgeError('INVALID_ARGUMENT', 'Use scratch-bridge inspect-batch --help'); };
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg.startsWith('-')) { if (manifestPath !== undefined) bad(); manifestPath = arg; continue; }
      if (used.has(arg)) bad(); used.add(arg);
      if (arg === '--json') { json = true; continue; }
      if (arg === '--output') { output = args[++i]; if (!output || output.startsWith('-')) bad(); continue; }
      if (!Object.hasOwn(keys, arg)) bad();
      const raw = args[++i];
      if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) bad();
      const key = keys[arg]; (Object.hasOwn(BATCH_LIMITS, key) ? limits : inspection)[key] = Number(raw);
    }
    if (manifestPath === undefined) bad();
    if (output) {
      const manifest = await readManifest(manifestPath, limits.maxManifestBytes);
      const target = await canonicalPotentialPath(output);
      const inputs = await Promise.all([manifestPath, ...manifest.files.map(e => resolve(dirname(resolve(manifestPath)), e.path))].map(canonicalPotentialPath));
      if (inputs.includes(target)) throw new BridgeError('OUTPUT_COLLISION', 'Output must differ from manifest and every input');
    }
    controller = new AbortController();
    process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
    const report = await inspectBatch(manifestPath, {limits, inspection, signal: controller.signal});
    const content = json ? JSON.stringify(report) + '\n' : formatBatch(report);
    if (output) {
      // O_EXCL refuses existing files, symlinks, and hard-link aliases. Only a
      // newly created file is removed when writing fails; inputs stay untouched.
      const file = await open(output, 'wx');
      try { await file.writeFile(content); }
      catch (error) { await file.close(); await unlink(output); throw error; }
      await file.close();
    } else process.stdout.write(content);
    process.exitCode = batchExitCode(report);
  } catch (error) {
    process.stderr.write(JSON.stringify({code: error instanceof BridgeError ? error.code : ['EEXIST', 'ENOENT', 'EACCES'].includes(error.code) ? error.code : 'IO_ERROR', message: error instanceof BridgeError ? error.message : 'Batch command could not read inputs or write output'}) + '\n');
    process.exitCode = 3;
  } finally {
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  }
}
