import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, writeFile, readFile, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Program} from '../scripts/programs.js';
import {sb3} from '../scripts/zip.js';
const cli = fileURLToPath(new URL('../bin/scratch-bridge.js', import.meta.url));
const fixture = fileURLToPath(new URL('../examples/factorial.sb3', import.meta.url));
const invoke = args => spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8', timeout: 5000});
test('CLI converts, writes a map, runs offline, and refuses overwrite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-cli-'));
  try {
    const output = join(dir, 'factorial.mjs');
    assert.equal(invoke([fixture, '-o', output]).status, 0);
    const executed = spawnSync(process.execPath, [output], {encoding: 'utf8', timeout: 5000});
    assert.equal(executed.status, 0);
    assert.equal(JSON.parse(executed.stdout).variables.find(v => v.id === 'result').value, 720);
    assert.ok(JSON.parse(await readFile(`${output}.map.json`)).mappings.length);
    const previous = await readFile(output);
    assert.equal(invoke([fixture, '-o', output]).status, 1);
    assert.deepEqual(await readFile(output), previous);
    const limited = spawnSync(process.execPath, [output, '--max-steps=1'], {encoding: 'utf8', timeout: 5000});
    assert.equal(limited.status, 1); assert.equal(JSON.parse(limited.stderr).code, 'STEP_LIMIT');
    const invalid = spawnSync(process.execPath, [output, 'garbage'], {encoding: 'utf8', timeout: 5000});
    assert.equal(invalid.status, 1); assert.equal(JSON.parse(invalid.stderr).code, 'INVALID_ARGUMENT');
  } finally { await rm(dir, {recursive: true, force: true}); }
});
test('check-only validates without writing or executing an infinite program', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-check-'));
  try {
    const p = new Program(); const project = p.finish([p.repeat(p.literal('Infinity'), [])]);
    const input = join(dir, 'infinite.sb3'); await writeFile(input, sb3(project));
    const result = invoke([input, '--check']); assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).compatible, true);
    assert.deepEqual(await readdir(dir), ['infinite.sb3']);
  } finally { await rm(dir, {recursive: true, force: true}); }
});
test('CLI errors are machine-readable and leave no partial output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-error-'));
  try {
    const output = join(dir, 'out.mjs');
    for (const args of [[], [fixture], [fixture, '--unknown'], [fixture, '--check', '--max-steps', '-1'], [fixture, '-o', join(dir, 'wrong.js')]]) {
      const result = invoke(args); assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).code, 'INVALID_ARGUMENT');
    }
    const bad = join(dir, 'bad.sb3'); await writeFile(bad, 'invalid');
    const result = invoke([bad, '-o', output]); assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).code, 'INVALID_ARCHIVE');
    assert.deepEqual(await readdir(dir), ['bad.sb3']);
    await writeFile(output, 'keep');
    assert.equal(invoke([fixture, '-o', output]).status, 1);
    assert.deepEqual((await readdir(dir)).sort(), ['bad.sb3', 'out.mjs']);
    assert.equal(await readFile(output, 'utf8'), 'keep');
  } finally { await rm(dir, {recursive: true, force: true}); }
});
