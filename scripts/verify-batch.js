import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {cpus, release} from 'node:os';
import {Program} from './programs.js';
import {sb3} from './zip.js';

const hash = b => createHash('sha256').update(b).digest('hex');
export async function verifyBatch({cli, cwd, temporary, env, output}) {
  const sourcesBytes = await readFile('corpus/sources.json'), expectationBytes = await readFile('corpus/expectations.json');
  const sources = JSON.parse(sourcesBytes), expectations = JSON.parse(expectationBytes), manifest = JSON.parse(await readFile('corpus/manifest.json'));
  const approved = JSON.parse(await readFile('corpus/discrepancies.json'));
  assert.equal(hash(sourcesBytes), approved.frozenSourcesSha256);
  assert.equal(hash(expectationBytes), approved.frozenExpectationsSha256);
  const sourceAudit = spawnSync('python3', ['scripts/audit-corpus-source.py'], {encoding: 'utf8', timeout: 15000});
  assert.equal(sourceAudit.status, 0, `Acquire corpus first: node scripts/acquire-corpus.js\n${sourceAudit.stderr}`);
  const dir = join(temporary, 'batch'); await mkdir(dir);
  const localManifest = join(dir, 'manifest.json');
  await writeFile(localManifest, JSON.stringify(manifest));
  for (const [i, row] of manifest.files.entries()) {
    const destination = join(dir, row.path); await mkdir(dirname(destination), {recursive: true});
    await copyFile(join('corpus', row.path), destination);
    assert.equal(hash(await readFile(destination)), sources.files[i].sha256);
  }
  const guard = join(dir, 'offline-guard.mjs');
  const worker = join(dirname(dirname(cli)), 'scratch-semantic-bridge', 'src', 'batch-worker.js');
  // npm's .bin path resolves into node_modules; dirname(dirname(cli)) is node_modules.
  await writeFile(guard, `import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import dns from 'node:dns';
import child from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const deny = () => { throw new Error('OFFLINE_GUARD: network or execution API invoked'); };
net.Socket.prototype.connect = deny; net.connect = deny; net.createConnection = deny; net.createServer = deny;
tls.connect = deny; http.request = deny; http.get = deny; https.request = deny; https.get = deny; dgram.createSocket = deny;
for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse']) dns[key] = deny;
for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse']) dns.promises[key] = deny;
const fork = child.fork;
child.fork = (path, args, options) => {
  if (path !== ${JSON.stringify(worker)} || args.length || process.argv[1] === path) return deny();
  return fork(path, args, options);
};
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) child[key] = deny;
globalThis.fetch = deny; globalThis.eval = deny; globalThis.Function = deny;
syncBuiltinESMExports();
`);
  const guardedEnv = {...env, NODE_OPTIONS: `--import=${pathToFileURL(guard).href}`};
  const evidence = {schemaVersion: 1, status: 'running', observedAtUtc: new Date().toISOString(),
    environment: {node: process.version, platform: process.platform, arch: process.arch, kernel: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
      python: spawnSync('python3', ['--version'], {encoding: 'utf8'}).stdout.trim()},
    sourceRevision: sources.revision, sourcesSha256: hash(sourcesBytes), expectationsSha256: hash(expectationBytes), sourceAudit: JSON.parse(sourceAudit.stdout),
    population: sources.population, offline: 'Isolated npm --offline install. Network/eval/Function APIs denied in parent and children; only the installed inspection worker can be forked. API guards are not an OS firewall or hostile-code sandbox.',
    measurement: 'GNU time wall seconds and maximum resident set size (KiB), including process startup. RSS is the largest process peak in the process tree, not the simultaneous sum. Filesystem cache uncontrolled. Three installed corpus runs; deterministic report excludes timing.',
    importedProjectsExecuted: 0, inputBytes: sources.files.reduce((n, f) => n + f.bytes, 0), repetitions: [], discrepancies: [], fixtureFindings: []};
  try {
    let report, bytes;
    for (let repetition = 0; repetition < 3; repetition++) {
      const measurementPath = join(dir, 'resource.json');
      const run = spawnSync('/usr/bin/time', ['-f', '{"elapsedSeconds":%e,"peakProcessRssKiB":%M}', '-o', measurementPath,
        process.execPath, cli, 'inspect-batch', localManifest, '--json'], {cwd, env: guardedEnv, encoding: 'utf8', timeout: 90000, maxBuffer: 5 * 1024 * 1024});
      assert.ifError(run.error); assert.equal(run.status, 2, run.stderr); assert.equal(run.stderr, '');
      const current = JSON.parse(run.stdout);
      assert.equal(current.totalFiles, 34); assert.equal(current.omittedEntries, 0);
      if (bytes) assert.equal(run.stdout, bytes);
      report = current; bytes = run.stdout;
      const measurement = JSON.parse((await readFile(measurementPath, 'utf8')).trim().split('\n').at(-1));
      evidence.repetitions.push({...measurement, exitCode: run.status, reportBytes: Buffer.byteLength(bytes), reportSha256: hash(bytes)});
    }
    const discrepancies = [];
    for (const [i, e] of report.entries.entries()) {
      const expected = expectations.fixtures[i];
      assert.equal(e.id, expected.id); assert.equal(e.compatible, expected.compatible);
      const observedCodes = Object.keys(e.blockerCounts).sort();
      const observedOpcodes = [...new Set(e.diagnostics.filter(d => d.code === 'UNSUPPORTED_OPCODE').map(d => d.opcode))].sort();
      const missingCodes = expected.requiredCodes.filter(c => !observedCodes.includes(c));
      const missingOpcodes = expected.unsupportedOpcodes.filter(op => !observedOpcodes.includes(op));
      assert.deepEqual(missingOpcodes, []);
      for (const code of missingCodes) {
        const accepted = approved.discrepancies.find(d => d.id === e.id && d.expected === code);
        assert.ok(accepted, `Unreviewed discrepancy: ${e.id} ${code}`);
        assert.ok(observedCodes.includes(accepted.actual)); discrepancies.push(accepted);
      }
      if (e.compatible) assert.equal(e.compilerCheck, 'accepted');
      assert.ok(!['skipped'].includes(e.status));
      assert.ok(!['TIMEOUT', 'WORKER_FAILURE', 'REPORT_LIMIT'].includes(e.reason));
      assert.equal(hash(await readFile(join(dir, manifest.files[i].path))), sources.files[i].sha256);
      assert.equal(hash(await readFile(join('corpus', manifest.files[i].path))), sources.files[i].sha256);
      evidence.fixtureFindings.push({id: e.id, status: e.status, reason: e.reason, expectedCodes: expected.requiredCodes,
        observedCodes, missingCodes, missingOpcodes, semanticCoverage: e.inspection?.truncation ?? ['INPUT_NOT_ANALYZED']});
    }
    assert.deepEqual(discrepancies, approved.discrepancies);
    evidence.discrepancies = discrepancies;
    evidence.counts = report.counts; evidence.projectBlockerFrequency = report.projectBlockerFrequency;
    evidence.inputsUnchanged = true;
    evidence.compilerAcceptance = {corpusCompatible: report.counts.compatible, checked: report.entries.filter(e => e.compilerCheck === 'accepted').length,
      note: 'Zero corpus-compatible projects makes this corpus check vacuous; installed synthetic controls below exercise code generation.'};
    // Positive controls make sure the installed worker can actually compile.
    const p = new Program(); const good = p.finish([p.set('result', p.literal(42))]);
    const inf = new Program(); const infinite = inf.finish([inf.repeat(inf.literal('Infinity'), [])]);
    await writeFile(join(dir, 'positive.sb3'), sb3(good));
    await writeFile(join(dir, 'infinite.sb3'), sb3(infinite));
    const positiveManifest = join(dir, 'positive.json');
    await writeFile(positiveManifest, JSON.stringify({schemaVersion: 1, files: [{id: 'positive', path: 'positive.sb3'}, {id: 'infinite', path: 'infinite.sb3'}]}));
    const positive = spawnSync(process.execPath, [cli, 'inspect-batch', positiveManifest, '--json'], {cwd, env: guardedEnv, encoding: 'utf8', timeout: 15000});
    assert.equal(positive.status, 0, positive.stderr);
    const positiveReport = JSON.parse(positive.stdout);
    assert.equal(positiveReport.counts.compatible, 2);
    assert.ok(positiveReport.entries.every(e => e.compilerCheck === 'accepted'));
    evidence.positiveControls = {compatible: 2, compilerAccepted: 2, infiniteProgramNotExecuted: true};
    await writeFile(join(output, 'corpus-report.json'), bytes);
    const locations = spawnSync('python3', ['scripts/audit-corpus-source.py', '--report', join(output, 'corpus-report.json')], {encoding: 'utf8', timeout: 15000});
    assert.equal(locations.status, 0, locations.stderr);
    evidence.sourceLocationAudit = JSON.parse(locations.stdout);
    evidence.status = 'pass';
    console.log(`Batch audit passed: 34 frozen upstream fixtures, 3 identical installed offline reports, ${discrepancies.length} preserved diagnostic-category discrepancies, 2 compiler-accepted controls.`);
  } catch (error) { evidence.status = 'fail'; evidence.error = error.message; throw error; }
  finally { await writeFile(join(output, 'batch-audit.json'), JSON.stringify(evidence, null, 2) + '\n'); }
  return evidence;
}
