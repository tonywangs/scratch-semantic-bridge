import {spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {examples, generated} from './programs.js';
import {listExamples, generatedLists, listSeedStart, listSeedCount} from './list-programs.js';
import {procedureExamples, generatedProcedures, procedureSeedStart, procedureSeedCount} from './procedure-programs.js';
import {sb3} from './zip.js';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const output = resolve('.verification');
await mkdir(output, {recursive: true});
const temporary = await mkdtemp(join(tmpdir(), 'scratch-bridge-verify-'));
const evidence = {node: process.version, commands: [], installedExamples: [], networkPolicy: 'npm pack and installation use --offline; installed package has no dependencies; conversion and generated modules use only Node builtins'};
const env = {...process.env, npm_config_cache: join(temporary, 'cache'), npm_config_userconfig: join(temporary, 'empty.npmrc'), npm_config_globalconfig: join(temporary, 'empty-global.npmrc'), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false'};
await writeFile(env.npm_config_userconfig, ''); await writeFile(env.npm_config_globalconfig, '');
function command(argv, {cwd = root, expected = 0, log = true} = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {cwd, env, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024});
  evidence.commands.push({argv, cwd, status: result.status, stdout: result.stdout, stderr: result.stderr});
  if (log && result.stdout) process.stdout.write(result.stdout);
  if (log && result.stderr) process.stderr.write(result.stderr);
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${argv.join(' ')} exited unexpectedly\n${result.stderr}`);
  return result;
}
try {
  // Fixture drift is a failure, not an implicit rewrite of the baseline.
  for (const [name, {project, expected, expectedLists}] of Object.entries({...examples(), ...listExamples(), ...procedureExamples()})) {
    assert.deepEqual(await readFile(`examples/${name}.sb3`), sb3(project));
    assert.deepEqual(JSON.parse(await readFile(`examples/${name}.project.json`)), project);
    assert.deepEqual(JSON.parse(await readFile(`examples/${name}.expected.json`)), expectedLists ? {variables: expected, lists: expectedLists} : expected);
  }
  const corpus = Array.from({length: 128}, (_, i) => { const seed = 0x5eed0000 + i; return {seed, project: generated(seed)}; });
  assert.equal(await readFile('test/fixtures/generated.jsonl', 'utf8'), corpus.map(c => JSON.stringify(c)).join('\n') + '\n');
  const listCorpus = Array.from({length: listSeedCount}, (_, i) => { const seed = listSeedStart + i; return {seed, project: generatedLists(seed)}; });
  assert.equal(await readFile('test/fixtures/lists-generated.jsonl', 'utf8'), listCorpus.map(c => JSON.stringify(c)).join('\n') + '\n');
  const procedureCorpus = Array.from({length: procedureSeedCount}, (_, i) => { const seed = procedureSeedStart + i; return {seed, project: generatedProcedures(seed)}; });
  assert.equal(await readFile('test/fixtures/procedures-generated.jsonl', 'utf8'), procedureCorpus.map(c => JSON.stringify(c)).join('\n') + '\n');
  const tests = command([process.execPath, '--test', 'test/archive.test.js', 'test/coercion.test.js', 'test/compiler.test.js', 'test/cli.test.js', 'test/lists.test.js', 'test/procedures.test.js']);
  await writeFile(join(output, 'tests.log'), tests.stdout + tests.stderr);
  command([process.execPath, 'scripts/differential.js', '--output', join(output, 'differential')]);
  const packed = command(['npm', 'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', temporary], {log: false});
  const filename = JSON.parse(packed.stdout)[0].filename;
  const tarball = join(temporary, filename);
  evidence.tarballSha256 = createHash('sha256').update(await readFile(tarball)).digest('hex');
  const installed = join(temporary, 'isolated'); await mkdir(installed);
  await writeFile(join(installed, 'package.json'), JSON.stringify({name: 'offline-smoke-test', version: '1.0.0', private: true}));
  command(['npm', 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball], {cwd: installed});
  const installedPackage = JSON.parse(await readFile(join(installed, 'node_modules/scratch-semantic-bridge/package.json')));
  assert.equal(Object.keys(installedPackage.dependencies ?? {}).length, 0);
  const cli = join(installed, 'node_modules/.bin/scratch-bridge');
  for (const [name, {expected, expectedLists}] of Object.entries({...examples(), ...listExamples(), ...procedureExamples()})) {
    // Use the installed package's fixture, from a working directory outside the repository.
    const input = join(installed, 'node_modules/scratch-semantic-bridge/examples', `${name}.sb3`);
    const generatedFile = join(installed, `${name}.mjs`);
    command([cli, input, '-o', generatedFile], {cwd: installed});
    command([process.execPath, '--check', generatedFile], {cwd: installed});
    const result = JSON.parse(command([process.execPath, generatedFile], {cwd: installed}).stdout);
    assert.deepEqual(Object.fromEntries(result.variables.map(v => [v.id, v.value])), expected);
    assert.deepEqual(Object.fromEntries(result.lists.map(v => [v.id, v.value])), expectedLists ?? {});
    assert.ok(JSON.parse(await readFile(`${generatedFile}.map.json`)).mappings.length);
    evidence.installedExamples.push({name, expected, ...(expectedLists ? {expectedLists} : {}), actual: result});
  }
  evidence.status = 'pass';
  console.log('Verification passed: unit tests, Scratch VM differential corpus, and isolated offline CLI installation.');
} catch (error) {
  evidence.status = 'fail'; evidence.error = {message: error.message, stack: error.stack};
  throw error;
} finally {
  await writeFile(join(output, 'verification.json'), JSON.stringify(evidence, null, 2) + '\n');
  await rm(temporary, {recursive: true, force: true});
}
