# Upstream SB3 compatibility audit

This experiment asks which saved Scratch VM test fixtures meet the bridge's
existing sequential conversion policy, and which practical blockers appear.
It is not a user-project acceptance-rate estimate or a behavioral equivalence
study. No imported project, upstream test, extension, or asset was executed.
Compiler semantics were not expanded to improve the outcome.

## Frozen population and independent source expectations

The corpus contains **all 34 `.sb3` files** in
[Scratch VM revision e6f5711f25f607ce8370a5a7afcfb391b349a6e1](https://github.com/scratchfoundation/scratch-vm/tree/e6f5711f25f607ce8370a5a7afcfb391b349a6e1),
the source revision declared by the already pinned `scratch-vm@5.0.300` package.
Selection is lexicographic by repository path, with no SB3 exclusions.
SB/SB2 projects and sprite archives are excluded by the format rule. This is a
small, deliberately unusual regression-fixture population, with empty projects,
cloud-variable imports, corrupt or missing assets, monitors, extension-loading
cases, and execution-order tests. Even the large pen example is included because
it is an upstream extension test, not because it represents typical user work.

[Source provenance](../corpus/sources.json) freezes revision, paths, Git blob IDs,
SHA-256, sizes, attribution, license basis, selection and exclusions before
inspector evaluation. The root repository declares AGPL-3.0-only; source files
and contribution history remain at the immutable upstream links. Fixture-specific
license overrides were not found. Individual embedded asset authorship is not
established here, so original SB3 archives are acquired into an ignored local
cache and not redistributed in this repository or npm package. Do not infer a
new license for embedded media from this audit.

[Expectations](../corpus/expectations.json) were written from archive structure,
raw block inventories, and the documented opcode table before evaluating the
inspector. [Source review](../corpus/source-review.json) records upstream test
intent and hashed test-source references for every fixture. The independent
Python [source auditor](../scripts/audit-corpus-source.py) uses only `zipfile`,
JSON and the specification; it imports neither compiler nor inspector. It
checks all frozen structural facts and necessary-condition rejections, then
checks reported diagnostic target/block/script locations against the original
source records in a separate pass.
This is an independent source-derived check, not an external human review, a
second compiler, or a complete semantic oracle. Extra observed findings are
not retroactively added to the frozen expectations.

All 34 were expected to be incompatible. Three (`corrupt_svg`, `missing_svg`,
`origin`) contain a nested `project.json` but no root `project.json`, so they
cannot be parsed under the documented archive policy. The upstream
[fixture helper](https://github.com/scratchfoundation/scratch-vm/blob/e6f5711f25f607ce8370a5a7afcfb391b349a6e1/test/fixtures/readProjectFile.js)
can find nested project JSON; that difference is recorded rather than silently
normalizing or modifying the inputs.

Four diagnostic-category disagreements were found and retained in
[discrepancies](../corpus/discrepancies.json): source-derived expectations used
`UNSUPPORTED_FEATURE` for cloud variables, while the existing compiler uses
`INVALID_VARIABLE` for truthy cloud flags in variable tuples. Both reject the
feature; the expected diagnostic category was wrong. No implementation fix was
needed. All other required codes and unsupported opcode sets matched the first
pass. Focused regression tests preserve the distinction between cloud-variable,
extension and broadcast diagnostics.

## Acquisition, setup and offline replay

Requirements: Node 22 or newer, npm, Python 3, and GNU `/usr/bin/time` on Linux
for the measured verification harness. The recorded environment is in the
result JSON; other platforms and Node versions are not implicitly validated.

```sh
npm ci --ignore-scripts
node scripts/acquire-corpus.js
node scripts/verify.js
```

`acquire-corpus.js` is the explicit network step. It fetches only immutable raw
GitHub URLs, bounds bytes and time, verifies SHA-256 and Git blob hashes, and
refuses to replace a changed cached file. To use an existing source checkout
without network access:

```sh
node scripts/acquire-corpus.js --from /path/to/pinned/scratch-vm
```

After dependencies and fixtures are present, **`node scripts/verify.js`** is the
single offline verification command. It preserves the existing synthetic,
generated-code and pinned VM differential checks, audits source facts, packs and
installs the CLI with `npm --offline` outside the repository, then runs the
installed batch command three times. API guards deny networking and dynamic
execution in the batch parent and children; only the installed inspection worker
can be forked. This is an API guard, not an OS network firewall. The historical
synthetic VM comparisons still execute synthetic fixtures; imported upstream
fixtures never enter the VM.

The three corpus runs must have identical report hashes and unchanged input
hashes. Every reported-compatible fixture must pass actual code generation
under the same settings; with zero compatible corpus fixtures, two installed
synthetic positive controls separately exercise this path. One has an infinite
loop, demonstrating that inspection/code generation do not run its program.

Fresh reproducible outputs are written to `.verification/corpus-report.json`
and `.verification/batch-audit.json`. The first is deterministic; the second
contains environment and observed measurements. The checked-in counterparts
under `results/` record the actual completed run, not thresholds or estimates.
Full verification also checks mixed success/failure, duplicate inputs and IDs,
malformed archives/manifests, ordering, path escape, exhausted budgets, output
collisions, SIGTERM/API cancellation, and cleanup.

See [batch inspection](batch-inspection.md) for report schema, accounting and
limits, and [results](../results/corpus-audit.md) for exact denominators,
project-level blocker frequencies, incomplete cases, runtime, memory and sizes.

## Interpretation limits

Known blockers are lower bounds. A script's first semantic error leaves its
remaining content explicitly unanalyzed. Neither successful structural
inventory nor a compiler rejection enumerates every semantic problem. Asset
corruption is not an audit target: assets are not decompressed, fetched or
rendered, and most corresponding fixtures are rejected for having no entry
script. Timings include Node startup and child-process overhead; filesystem
caches are uncontrolled. Peak RSS is the largest individual process peak in
the measured process tree, not the sum of concurrently resident processes.
There is no inference about Scratch's full language or ordinary user projects,
and no claim of novelty over existing importers, compilers or static analyzers.
