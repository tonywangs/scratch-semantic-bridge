// Render an existing measured result; never fabricate timings or overwrite it.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory = process.argv[2] ?? '.verification';
const auditBytes = await readFile(`${directory}/batch-audit.json`);
const reportBytes = await readFile(`${directory}/corpus-report.json`);
const audit = JSON.parse(auditBytes), report = JSON.parse(reportBytes);
if (audit.status !== 'pass') throw new Error('A completed verified audit is required');
const digest = createHash('sha256').update(reportBytes).digest('hex');
if (!audit.repetitions.every(r => r.reportSha256 === digest && r.reportBytes === reportBytes.length)) throw new Error('Evidence/report mismatch');
const lines = [
  '# Recorded upstream corpus results', '',
  `Observed ${audit.observedAtUtc}. Source revision: \`${audit.sourceRevision}\`.`, '',
  `**${report.counts.compatible}/${report.totalFiles} compatible** with the configured sequential subset. ` +
    `${report.counts.incompatible}/${report.totalFiles} completed incompatible inspections; ` +
    `${report.counts.incomplete}/${report.totalFiles} incomplete inspections; ` +
    `${report.counts.skipped} skipped and ${report.omittedEntries} omitted.`, '',
  'The corpus is all 34 upstream SB3 regression fixtures at the pinned revision. It is not a representative user-project sample. No imported project was executed. Zero compatible projects is the measured result, not an experiment failure.', '',
  '## Reproducibility and measurements', '',
  `Environment: ${audit.environment.node}, ${audit.environment.platform}/${audit.environment.arch}, kernel ${audit.environment.kernel}, ${audit.environment.python}; reported CPU ${audit.environment.cpu}, ${audit.environment.logicalCpus} logical CPUs. Node 22 and other operating systems were not tested.`, '',
  '| Installed offline run | Wall seconds | Peak individual process RSS (KiB) | Exit |',
  '| --- | ---: | ---: | ---: |',
  ...audit.repetitions.map((r, i) => `| ${i + 1} | ${r.elapsedSeconds} | ${r.peakProcessRssKiB} | ${r.exitCode} |`), '',
  'GNU time measurements include startup and inspection children. RSS is the largest process peak, not simultaneous aggregate memory. Filesystem caches were uncontrolled. Exit 2 truthfully reports incomplete analysis. Network/eval/Function API guards were active in the installed CLI and workers; they are not an OS firewall.', '',
  `All three deterministic reports: **${reportBytes.length} bytes**, SHA-256 \`${digest}\`. Input SHA-256 values were unchanged for all ${report.totalFiles} files in both the original cache and isolated copy.`, '',
  '| Artifact | Bytes |', '| --- | ---: |',
  `| Original SB3 inputs (ignored acquisition cache) | ${audit.inputBytes} |`,
  `| corpus-report.json | ${reportBytes.length} |`,
  `| batch-audit.json | ${auditBytes.length} |`, '',
  `Charged input bytes: ${report.usage.inputBytes}; declared expanded bytes: ${report.usage.expandedBytes}; graph/validation work units: ${report.usage.work}. These budget charges are not CPU-instruction measurements or asset decompression measurements.`, '',
  '## Project-level blocker frequencies', '',
  'Each code counts a project once; every denominator is 34, including the three archive failures. Codes overlap. Findings are lower bounds for incomplete analyses.', '',
  '| Code | Projects / all fixtures |', '| --- | ---: |',
  ...Object.entries(report.projectBlockerFrequency).map(([code, n]) => `| ${code} | ${n}/34 |`), '',
  'The most frequent blocker is the one-green-flag requirement. Unsupported operations, additional entry/detached scripts, extensions/broadcasts and cloud flags also occur. The large pen fixture adds procedure and saved-graph issues. These counts describe the fixture set, not Scratch users.', '',
  '## Fixture outcomes and incomplete cases', '',
  'Three archives lack a root project.json. The other 18 incomplete cases retain unanalyzed script semantics after rejection; the pen fixture also has structural/procedure issues. No timeout, cancellation, batch resource exhaustion, worker failure, or report omission occurred in this corpus run.', '',
  '| Fixture | Status | Analysis limitation |', '| --- | --- | --- |',
  ...audit.fixtureFindings.map(f => `| ${f.id} | ${f.status} | ${f.semanticCoverage.length ? f.semanticCoverage.join(', ') : 'Completed configured passes'} |`), '',
  '## Expected versus observed', '',
  `All 34 source-derived rejection expectations matched. Required diagnostic categories matched without discrepancy for ${34 - audit.discrepancies.length}/34 fixtures; unsupported-opcode expectations matched for all fixtures. Four cloud fixtures expected UNSUPPORTED_FEATURE but received the existing INVALID_VARIABLE category. The frozen oracle and these disagreements are preserved; no semantics were changed to make them agree.`, '',
  `The Python source audit independently checked ZIP structure, saved block facts, input hashes, the documented opcode policy, and ${audit.sourceLocationAudit.diagnosticLocationChecks} reported diagnostic locations. This is not an external human review or a complete semantic oracle. Unexpected additional diagnostics are recorded as observations, not certified by that necessary-condition oracle.`, '',
  `Compiler code-generation checks cover all ${audit.compilerAcceptance.corpusCompatible} compatible corpus fixtures (vacuous here). Two separate installed synthetic controls passed both inspection and code generation with identical settings, including an infinite-loop program that was not run. Existing synthetic Scratch VM differential checks remain separate from this audit.`, '',
  'See [protocol and offline replay](../docs/corpus-audit.md), [source manifest](../corpus/sources.json), [frozen expectations](../corpus/expectations.json), [discrepancies](../corpus/discrepancies.json), [deterministic report](corpus-report.json), and [measurement evidence](batch-audit.json). Fresh runs write .verification; they do not rewrite these snapshots.', ''
];
process.stdout.write(lines.join('\n'));
