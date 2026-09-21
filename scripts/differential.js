import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compile} from '../src/compiler.js';
import {readSb3} from '../src/archive.js';
import {examples, generated} from './programs.js';
import {listExamples, generatedLists, listSeedStart, listSeedCount} from './list-programs.js';
import {listEdgeCases} from './list-edge-cases.js';
import {procedureEdgeCases} from './procedure-edge-cases.js';
import {edgeCases} from './edge-cases.js';
import {procedureExamples, generatedProcedures, procedureSeedStart, procedureSeedCount} from './procedure-programs.js';
import {sb3} from './zip.js';
import {runVm, vmVersion} from './oracle.js';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = variables => variables.map(({targetIndex, id, value}) => ({targetIndex, id, value}));

export async function differential({output = '.verification/differential', only} = {}) {
  await mkdir(output, {recursive: true});
  assert.equal(vmVersion, '5.0.300', 'Oracle must be pinned Scratch VM');
  const corpusBytes = await readFile(new URL('../test/fixtures/generated.jsonl', import.meta.url));
  const corpus = corpusBytes.toString().trim().split('\n').map(line => JSON.parse(line));
  assert.equal(corpus.length, 128);
  const cases = Object.entries({...examples(), ...listExamples(), ...procedureExamples()}).map(([name, {project, expected, expectedLists}]) => ({name, project, expected, expectedLists, kind: 'example'}));
  cases.push(...edgeCases().map(c => ({...c, kind: 'edge'})));
  cases.push(...corpus.map(({seed, project}, index) => {
    assert.equal(seed, 0x5eed0000 + index);
    assert.deepEqual(project, generated(seed), `Seed ${seed} no longer reproduces its fixture`);
    return {name: `seed-${seed}`, project, seed, kind: 'generated'};
  }));
  const listCorpusBytes = await readFile(new URL('../test/fixtures/lists-generated.jsonl', import.meta.url));
  const listCorpus = listCorpusBytes.toString().trim().split('\n').map(line => JSON.parse(line));
  assert.equal(listCorpus.length, listSeedCount);
  cases.push(...listEdgeCases().map(c => ({...c, kind: 'list-edge'})));
  cases.push(...listCorpus.map(({seed, project}, index) => {
    assert.equal(seed, listSeedStart + index);
    assert.deepEqual(project, generatedLists(seed), `List seed ${seed} no longer reproduces its fixture`);
    return {name: `list-seed-${seed}`, project, seed, kind: 'list-generated'};
  }));
  const procedureCorpusBytes = await readFile(new URL('../test/fixtures/procedures-generated.jsonl', import.meta.url));
  const procedureCorpus = procedureCorpusBytes.toString().trim().split('\n').map(line => JSON.parse(line));
  assert.equal(procedureCorpus.length, procedureSeedCount);
  cases.push(...procedureEdgeCases().map(c => ({...c, kind: 'procedure-edge'})));
  cases.push(...procedureCorpus.map(({seed, project}, index) => {
    assert.equal(seed, procedureSeedStart + index);
    assert.deepEqual(project, generatedProcedures(seed), `Procedure seed ${seed} no longer reproduces its fixture`);
    return {name: `procedure-seed-${seed}`, project, seed, kind: 'procedure-generated'};
  }));
  const report = {
    schemaVersion: 1, node: process.version, scratchVm: vmVersion,
    procedureCorpusSha256: sha(procedureCorpusBytes), corpusSha256: sha(corpusBytes), listCorpusSha256: sha(listCorpusBytes), lockfileSha256: sha(await readFile(new URL('../package-lock.json', import.meta.url))),
    oracle: 'Scratch VM loadProject and headless turbo scheduler; 20000-tick ceiling; no renderer or storage',
    scope: 'Final scalar values and complete list contents, with types; IEEE exceptional values tagged; scheduler timing is not compared',
    cases: [], mismatches: []
  };
  for (const item of cases.filter(c => !only || c.name === only)) {
    const {name, project, seed, kind} = item;
    const archive = sb3(project), row = {name, kind, ...(seed === undefined ? {} : {seed}), sb3Sha256: sha(archive)};
    try {
      const compiled = compile(readSb3(archive));
      assert.deepEqual(compiled, compile(readSb3(archive)), 'Generated code and mappings must be deterministic');
      const {code} = compiled;
      const {run} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
      const actual = run();
      row.generatedSteps = actual.steps;
      row.actual = canonical(actual.variables); row.actualLists = canonical(actual.lists);
      const expected = await runVm(project);
      row.expected = expected.variables; row.expectedLists = expected.lists;
      assert.deepEqual(row.actual, row.expected);
      assert.deepEqual(row.actualLists, row.expectedLists);
      if (item.expected) assert.deepEqual(Object.fromEntries(row.actual.map(v => [v.id, v.value])), item.expected);
      if (item.expectedLists) assert.deepEqual(Object.fromEntries(row.actualLists.map(v => [v.id, v.value])), item.expectedLists);
      row.status = 'pass';
    } catch (error) {
      row.status = 'fail'; row.error = {code: error.code, message: error.message ?? String(error)};
      report.mismatches.push(row);
      // Preserve exact mismatching input and both outcomes. No failures are skipped.
      const stem = `failure-${report.mismatches.length}`;
      await writeFile(resolve(output, `${stem}.sb3`), archive);
      await writeFile(resolve(output, `${stem}.project.json`), JSON.stringify(project, null, 2) + '\n');
    }
    report.cases.push(row);
  }
  assert.ok(report.cases.length, 'No matching differential case');
  report.summary = {total: report.cases.length, passed: report.cases.filter(c => c.status === 'pass').length, failed: report.mismatches.length};
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({differential: report.summary, report: resolve(output, 'report.json')}));
  if (report.mismatches.length) throw new Error(`${report.mismatches.length} Scratch VM differential checks failed; see ${output}/report.json`);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--output', '--case'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node scripts/differential.js [--output DIR] [--case NAME]');
    opts[args[i] === '--output' ? 'output' : 'only'] = args[i + 1];
  }
  await differential(opts);
}
