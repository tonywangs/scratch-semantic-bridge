import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {inspect} from '../src/inspect.js';
import {compile} from '../src/compiler.js';
import {readSb3} from '../src/archive.js';
import {Program} from './programs.js';
import {inspectionCases, inspectionCase, inspectionSeedStart, inspectionSeedCount} from './inspection-cases.js';
import {checkExpectation} from './inspection-expectations.js';
import {sb3} from './zip.js';

const hash = value => createHash('sha256').update(value).digest('hex');
export async function verifyInspection({cli, cwd, temporary, env, output}) {
  const evidence = {schemaVersion: 1, observedAtUtc: new Date().toISOString(), status: 'running',
    environment: {node: process.version, platform: process.platform, arch: process.arch, scratchVm: JSON.parse(await readFile('node_modules/scratch-vm/package.json')).version,
      npm: spawnSync('npm', ['--version'], {encoding: 'utf8', env}).stdout.trim()},
    policy: 'Synthetic fixtures; assertions are specified by mutation, not inferred from compiler outcomes. Compiler acceptance is checked for every compatible fixture.',
    offline: 'Package installed with npm --offline and no runtime dependencies. CLI runs under Node read-only filesystem permissions with a preload that rejects networking, subprocesses, eval and Function. No kernel network namespace is available; this is an API guard, not a network sandbox.',
    measurement: 'Three separate installed CLI processes per workload, GNU time elapsed seconds and maximum RSS in KiB. Runtime includes Node startup; filesystem cache is uncontrolled. Hashes exclude measurement timestamps.',
    seedStart: inspectionSeedStart, seedCount: inspectionSeedCount, fixtures: [], workloads: []};
  const dir = join(temporary, 'inspection'); await mkdir(dir);
  const evidenceFile = join(output, 'inspection.json');
  try {
    for (const fixture of inspectionCases()) {
      const report = inspect(fixture.project);
      checkExpectation(fixture, report);
      const bytes = JSON.stringify(report) + '\n';
      assert.equal(JSON.stringify(inspect(fixture.project)) + '\n', bytes);
      evidence.fixtures.push({seed: fixture.seed, kind: fixture.kind, compatible: report.compatible,
        complete: report.complete, inputSha256: hash(JSON.stringify(fixture.project)), reportSha256: hash(bytes), reportBytes: Buffer.byteLength(bytes),
        expectedFindings: fixture.expected.findings});
    }
    evidence.fixtureSummary = {total: evidence.fixtures.length, compatible: evidence.fixtures.filter(f => f.compatible).length, expectationsPassed: evidence.fixtures.length};
    const guard = join(dir, 'offline-guard.mjs');
    await writeFile(guard, `import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import dns from 'node:dns';
import child from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const deny = () => { throw new Error('OFFLINE_GUARD: execution or network API invoked'); };
net.Socket.prototype.connect = deny; net.connect = deny; net.createConnection = deny; net.createServer = deny;
tls.connect = deny; http.request = deny; http.get = deny; https.request = deny; https.get = deny; dgram.createSocket = deny;
for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse']) dns[key] = deny;
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) child[key] = deny;
globalThis.fetch = deny; globalThis.eval = deny; globalThis.Function = deny;
syncBuiltinESMExports();
`);
    const supported = inspectionCase(inspectionSeedStart, 'supported').project;
    const many = new Program(); const manyProject = many.finish(Array.from({length: 1200}, () => many.set('result', many.literal(1))));
    const disconnected = new Program(); const disconnectedProject = disconnected.finish([]);
    for (let i = 0; i < 400; i++) disconnected.block('unknown_extension_operation');
    const infinite = new Program(); const infiniteProject = infinite.finish([infinite.repeat(infinite.literal('Infinity'), [])]);
    const workloads = [
      {name: 'supported-json', input: JSON.stringify(supported), ext: 'json', exit: 0},
      {name: 'supported-sb3', input: sb3(supported), ext: 'sb3', exit: 0},
      {name: 'unsupported-multiple', input: JSON.stringify(inspectionCase(inspectionSeedStart, 'simultaneous-errors').project), ext: 'json', exit: 2},
      {name: 'malformed-json', input: '{', ext: 'json', exit: 2},
      {name: 'malformed-archive', input: 'invalid zip', ext: 'sb3', exit: 2},
      {name: 'block-limit', input: JSON.stringify(supported), ext: 'json', args: ['--max-blocks', '1'], exit: 2},
      {name: 'archive-limit', input: sb3(supported), ext: 'sb3', args: ['--max-archive-bytes', '1'], exit: 2},
      {name: 'output-limit', input: JSON.stringify(manyProject), ext: 'json', args: ['--max-report-bytes', '4096'], exit: 2},
      {name: 'linear-1200', input: JSON.stringify(manyProject), ext: 'json', exit: 0},
      {name: 'disconnected-400', input: JSON.stringify(disconnectedProject), ext: 'json', exit: 2},
      {name: 'infinite-loop-not-executed', input: sb3(infiniteProject), ext: 'sb3', exit: 0}
    ];
    for (const workload of workloads) {
      const input = join(dir, `${workload.name}.${workload.ext}`), resource = join(dir, 'resource.json');
      await writeFile(input, workload.input);
      const before = await readFile(input), samples = [];
      const args = [process.execPath, '--permission', `--allow-fs-read=${temporary}`, '--import', guard, cli, 'inspect', input, '--json', ...(workload.args ?? [])];
      for (let repetition = 0; repetition < 3; repetition++) {
        const result = spawnSync('/usr/bin/time', ['-f', '{"elapsedSeconds":%e,"peakRssKiB":%M}', '-o', resource, ...args], {cwd, env, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024});
        assert.ifError(result.error); assert.equal(result.status, workload.exit, `${workload.name}: ${result.stderr}`); assert.equal(result.stderr, '');
        const report = JSON.parse(result.stdout);
        assert.ok(Buffer.byteLength(result.stdout) <= report.limits.maxReportBytes);
        assert.equal(report.compatible, workload.exit === 0);
        if (report.compatible && repetition === 0) {
          const project = workload.ext === 'json' ? JSON.parse(before) : readSb3(before);
          const options = Object.fromEntries(['maxBlocks', 'maxDepth', 'maxSteps', 'maxCallDepth', 'maxListLength'].map(key => [key, report.limits[key]]));
          assert.doesNotThrow(() => compile(project, options));
        }
        const resourceText = await readFile(resource, 'utf8');
        // GNU time prefixes nonzero exits with a status line, outside the JSON.
        const measurement = JSON.parse(resourceText.trim().split('\n').at(-1));
        samples.push({...measurement, reportBytes: Buffer.byteLength(result.stdout), reportSha256: hash(result.stdout), exitCode: result.status});
      }
      assert.equal(new Set(samples.map(s => s.reportSha256)).size, 1);
      assert.deepEqual(await readFile(input), before);
      evidence.workloads.push({name: workload.name, inputBytes: before.length, inputSha256: hash(before), arguments: workload.args ?? [], repetitions: samples});
    }
    assert.equal(evidence.workloads[0].repetitions[0].reportSha256, evidence.workloads[1].repetitions[0].reportSha256);
    evidence.status = 'pass';
    console.log(`Inspection verification passed: ${evidence.fixtures.length} seeded expectations and ${evidence.workloads.length} installed offline workloads, three repetitions each.`);
  } catch (error) {
    evidence.status = 'fail'; evidence.error = {message: error.message}; throw error;
  } finally { await writeFile(evidenceFile, JSON.stringify(evidence, null, 2) + '\n'); }
  return {status: evidence.status, fixtures: evidence.fixtureSummary, workloads: evidence.workloads.length};
}
