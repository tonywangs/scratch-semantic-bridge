import {inspectFile, INSPECTION_LIMITS, formatInspection, inspectionExitCode} from './inspect.js';
import {BridgeError} from './errors.js';

export const inspectionHelp = `Usage: scratch-bridge inspect INPUT.sb3|INPUT.json [--json] [limits]

Inspect offline without running code, loading extensions, or fetching assets.
Default output is readable text; --json emits a deterministic version 1 report.
Exit: 0 compatible; 1 incompatible with completed passes; 2 incomplete; 3 usage error.
Supported scripts are checked in isolation, not promises that the whole project converts.

Limits (positive integers; inspection ceilings cannot be raised):
${Object.entries(INSPECTION_LIMITS).map(([key, value]) => `  --${key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())} ${value}`).join('\n')}
max-report-bytes minimum: 4096. max-depth / max-call-depth ceiling: 256.
max-list-length ceiling: 200000; max-steps accepts any positive safe integer.
See docs/inspection.md for coverage, reachability, and report semantics.
`;
export async function inspectionCli(args) {
  try {
    if (args.length === 1 && args[0] === '--help') { process.stdout.write(inspectionHelp); return; }
    const keys = Object.fromEntries(Object.keys(INSPECTION_LIMITS).map(key => ['--' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), key]));
    const used = new Set(), options = {};
    let path, json = false;
    const bad = () => { throw new BridgeError('INVALID_ARGUMENT', 'Use scratch-bridge inspect --help for accepted arguments and limits'); };
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg.startsWith('-')) { if (path !== undefined) bad(); path = arg; continue; }
      if (used.has(arg)) bad();
      used.add(arg);
      if (arg === '--json') { json = true; continue; }
      if (!Object.hasOwn(keys, arg)) bad();
      const value = args[++i];
      if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) bad();
      options[keys[arg]] = Number(value);
    }
    if (path === undefined) bad();
    const report = await inspectFile(path, options);
    process.stdout.write(json ? JSON.stringify(report) + '\n' : formatInspection(report));
    process.exitCode = inspectionExitCode(report);
  } catch (error) {
    process.stderr.write(JSON.stringify({code: error instanceof BridgeError ? error.code : 'INTERNAL_ERROR', message: error instanceof BridgeError ? error.message : 'Inspection failed unexpectedly'}) + '\n');
    process.exitCode = 3;
  }
}
