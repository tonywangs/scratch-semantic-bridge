# Observed verification results

The procedure milestone was verified on 2026-09-21 using Node 24.20.0, npm 11.19.0,
and Scratch VM 5.0.300. These are executed checks, not estimates.

| Check | Observed result |
| --- | --- |
| Unit, archive, compiler, coercion, list, procedure, and CLI tests | 101 passed, 0 failed |
| Full-program VM differential checks | 660 passed, 0 failed |
| Retained scalar seeded programs | 128 passed, seeds `0x5eed0000`–`0x5eed007f` |
| Retained list seeded programs | 192 passed, seeds `0x11570000`–`0x115700bf` |
| New procedure seeded programs | 192 passed, seeds `0xc0110000`–`0xc01100bf` |
| Targeted whole-program edge cases | 39 scalar + 82 list + 18 procedure cases passed |
| Synthetic example whole-program comparisons | 9 passed |
| Direct scalar coercion / pairwise comparison checks | 33 / 1,089 |
| Direct deterministic list-index comparisons | 300 |
| Isolated offline package install | Succeeded with empty npm cache and no runtime dependencies |
| Installed factorial / summation / conditional | `720` / `5050` / `"negative"` |
| Installed sorting | `[-2, 0, 1, 3, 5, 5]` |
| Installed filtering | Selected `[2, 7, 4]`, count `3` |
| Installed aggregation | Sum `5.5`, mean `1.375` |
| Installed procedure filtering | Selected `[7, 4]`, count `2` |
| Installed procedure aggregation | Totals `[5.5, 11]`, final sum `11` |
| Installed procedure sorting | `[-2, 0, 1, 3, 5, 5]` after two calls |
| Deterministic compiler artifacts | Code and maps matched on repeat compilation for all 660 cases |

[verification-summary.json](verification-summary.json) records the verification
command, environment, installed-example outputs, and source/corpus/lockfile
hashes. [tests.log](tests.log) is actual test output. [differential.json](differential.json)
preserves each input hash, seed where applicable, final scalar values and complete
lists from both executions, and all mismatch rows (none in the successful run).
Unit-test durations are incidental, not performance measurements.

The first procedure run passed 658 of 660 cases. Two comparisons exposed a
compiler error: explicit empty Boolean procedure sockets used false instead of
the definition's true default. [procedure-initial-failures.json](procedure-initial-failures.json)
retains both actual/expected outcomes and input hashes;
[procedure-initial-inputs.jsonl.gz](procedure-initial-inputs.jsonl.gz) retains the
exact inputs. The compiler now treats `[2, null]` as an absent procedure argument,
matching VM execution. Final verification includes both cases and explicit
expectations for missing/empty/Boolean/text/numeric sockets under both warp flags.
No failed case was skipped or counted as an initial pass.

The first list run passed 255 of 447 cases. The other 192 failed VM loading due
to invalid fixture encodings: booleans in text primitives and sprite layerOrder 0.
[list-initial-failures.json](list-initial-failures.json) preserves every failure,
its input hash, and the resolution. [list-initial-inputs.jsonl.gz](list-initial-inputs.jsonl.gz)
contains all original failed inputs in the report's row order. Fixture repairs
use boolean operator reporters and valid sprite metadata; the compiler now also
rejects boolean numeric/text primitives. The corrected full run re-executed all
cases successfully. No failed case was skipped or counted as a pass.

Earlier scalar harness failures remain in
[initial-harness-failures.json](initial-harness-failures.json): an unsanitized
oracle ID lookup and invalid sprite metadata were repaired before the scalar
milestone's final run. [identifier-probes.json](identifier-probes.json) preserves
the pinned VM's errors for reserved variable IDs, which remain explicitly
unsupported.

No supported-subset value mismatch remains unresolved in this tested corpus.
Finite synthetic tests do not establish general Scratch compatibility or
semantic equivalence. Graphics, sound, timing, concurrency, real personal
projects, arbitrary untested graphs, and other VM releases remain unvalidated.
Node 22 is the declared minimum but was not exercised in this environment.

Recursion, ambiguous/stale procedure metadata, VM-sensitive identifiers,
random/any indices, and call-depth/step/list-size exhaustion are
intentional departures from Scratch, checked separately as errors. List-size
limits do not bound string lengths or total process memory. Offline installation
uses npm's `--offline` mode with an empty cache; it does not use an OS firewall.
See the [specification](../docs/specification.md) and
[experiment protocol](../docs/experiments.md) for the full boundary.

Re-run with development dependencies installed:

```sh
node scripts/verify.js
```

Fresh results go to `.verification/`; verification does not rewrite the saved
snapshot or baseline fixtures.
