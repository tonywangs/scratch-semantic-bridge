// One input per process. Only trusted bridge code runs here; project data is
// parsed and compiled, never imported/evaluated. The parent enforces deadlines.
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {readSb3} from './archive.js';
import {inspect} from './inspect.js';
import {compile} from './compiler.js';
import {BridgeError} from './errors.js';

process.once('message', async ({path, limits}) => {
  let file, result, sha256 = null;
  const usage = {inputBytes: 0, expandedBytes: 0, work: 0};
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile()) throw new BridgeError('IO_ERROR', 'Regular file required');
    const json = path.toLowerCase().endsWith('.json');
    const max = Math.min(limits.maxArchiveBytes, json ? limits.maxProjectBytes : limits.maxArchiveBytes);
    if (stat.size > max) throw new BridgeError('ARCHIVE_LIMIT', 'Input limit');
    const buffer = Buffer.alloc(Math.min(stat.size + 1, max + 1));
    let length = 0;
    while (length < buffer.length) {
      const {bytesRead} = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    usage.inputBytes = length;
    if (length !== stat.size) throw new BridgeError('INPUT_CHANGED', 'Input changed');
    const bytes = buffer.subarray(0, length);
    sha256 = createHash('sha256').update(bytes).digest('hex');
    let project;
    if (json) {
      usage.expandedBytes = length;
      if (length > limits.maxExpandedBytes) throw new BridgeError('ARCHIVE_LIMIT', 'Expanded limit');
      try { project = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
      catch { throw new BridgeError('INVALID_JSON', 'Invalid JSON'); }
    } else {
      project = readSb3(bytes, Object.fromEntries(['maxArchiveBytes', 'maxProjectBytes', 'maxExpandedBytes', 'maxEntries'].map(k => [k, limits[k]])), usage);
    }
    const report = inspect(project, limits);
    usage.work = report.counts.work;
    // Independent code-generation acceptance check, under identical settings.
    // Generated code and maps are discarded; neither is ever executed.
    let compilerCheck = 'not-applicable';
    if (report.compatible) {
      const compileWork = report.counts.blocks + report.counts.targets;
      if (usage.work + compileWork > limits.maxWork) {
        usage.work = limits.maxWork;
        throw new BridgeError('WORK_LIMIT', 'Code-generation work reservation exceeds budget');
      }
      usage.work += compileWork;
      try {
        compile(project, Object.fromEntries(['maxBlocks', 'maxDepth', 'maxSteps', 'maxCallDepth', 'maxListLength'].map(k => [k, limits[k]])));
        compilerCheck = 'accepted';
      } catch { compilerCheck = 'rejected'; }
    }
    result = {report, sha256, compilerCheck};
  } catch (error) {
    result = {error: error instanceof BridgeError ? error.code : 'IO_ERROR', sha256};
  } finally {
    if (file) await file.close();
  }
  // Metrics are separate from deterministic report data.
  process.send?.({...result, usage, peakRssKiB: process.resourceUsage().maxRSS}, () => process.disconnect());
});
