#!/usr/bin/env node
import {writeFile, unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {compile, loadSb3, BridgeError} from '../src/index.js';
import {inspectionCli} from '../src/inspection-cli.js';

const help = `Usage: scratch-bridge INPUT.sb3 -o OUTPUT.mjs [options]
       scratch-bridge INPUT.sb3 --check [options]
       scratch-bridge inspect INPUT.sb3|INPUT.json [--json] [limits]

Convert one sequential green-flag script without executing it.
Writes a standalone Node ES module and OUTPUT.mjs.map.json.
Existing files are never overwritten.

Options:
  --max-call-depth N     Maximum nested procedure calls (64; ceiling 256)
  --max-list-length N    Maximum items per list (10000; ceiling 200000)
  --max-steps N           Default execution budget (100000)
  --max-archive-bytes N   Maximum compressed input (16777216)
  --max-project-bytes N   Maximum project.json size (4194304)
  --check                Validate compatibility without writing code
  --help                 Show this help
`;
if (process.argv[2] === 'inspect') {
  await inspectionCli(process.argv.slice(3));
} else {
try {
  const args = process.argv.slice(2), options = {};
  let input, output, check = false;
  const used = new Set();
  const bad = message => { throw new BridgeError('INVALID_ARGUMENT', message); };
  if (args.length === 1 && args[0] === '--help') console.log(help);
  else {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('-')) {
        if (used.has(arg)) bad(`Repeated option: ${arg}`);
        used.add(arg);
        if (arg === '--check') { check = true; continue; }
        const keys = {'--max-call-depth': 'maxCallDepth', '--max-steps': 'maxSteps', '--max-list-length': 'maxListLength', '--max-archive-bytes': 'maxArchiveBytes', '--max-project-bytes': 'maxProjectBytes'};
        if (arg !== '-o' && !Object.hasOwn(keys, arg)) bad(`Unknown option: ${arg}`);
        const value = args[++i];
        if (value === undefined) bad(`Missing value for ${arg}`);
        if (arg === '-o') output = value;
        else {
          if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) bad(`${arg} requires a positive safe integer`);
          options[keys[arg]] = Number(value);
        }
      } else if (input === undefined) input = arg;
      else bad('Expected exactly one input file');
    }
    if (!input || (!check && !output) || (check && output)) bad(help.trim());
    if (output && !output.endsWith('.mjs')) bad('Output must have .mjs extension');
    if (output && [output, `${output}.map.json`].some(p => resolve(p) === resolve(input))) bad('Output must differ from input');
    const project = await loadSb3(input, Object.fromEntries(Object.entries(options).filter(([key]) => !['maxSteps', 'maxListLength', 'maxCallDepth'].includes(key))));
    const result = compile(project, {maxCallDepth: options.maxCallDepth, maxSteps: options.maxSteps, maxListLength: options.maxListLength});
    if (check) console.log(JSON.stringify({compatible: true, variables: result.variables, lists: result.lists, mappedLines: result.map.mappings.length}));
    else {
      const mapPath = `${output}.map.json`;
      await writeFile(mapPath, JSON.stringify(result.map, null, 2) + '\n', {flag: 'wx'});
      try { await writeFile(output, result.code, {flag: 'wx'}); }
      catch (error) { await unlink(mapPath); throw error; }
      console.log(JSON.stringify({output, map: mapPath}));
    }
  }
} catch (error) {
  console.error(JSON.stringify(error instanceof BridgeError ? error.toJSON() : {code: error.code ?? 'IO_ERROR', message: error.message}));
  process.exitCode = 1;
}
}
