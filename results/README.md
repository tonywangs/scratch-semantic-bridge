# Observed verification results

The saved experiment was run on 2026-09-19 using Node 24.20.0, npm 11.19.0, and
Scratch VM 5.0.300. These are observations from executed checks, not estimates.

| Check | Observed result |
| --- | --- |
| Unit, archive, compiler, coercion, and CLI tests | 43 passed, 0 failed |
| Full-program VM differential checks | 170 passed, 0 failed |
| Preserved seeded programs within those checks | 128 passed, seeds `0x5eed0000`–`0x5eed007f` |
| Targeted whole-program edge cases | 39 passed |
| Synthetic example whole-program comparisons | 3 passed |
| Direct coercion values / pairwise comparisons | 33 / 1,089 checked |
| Isolated offline package install | Succeeded with empty npm cache and no runtime dependencies |
| Installed factorial / summation / conditional | `720` / `5050` / `"negative"` |

[verification-summary.json](verification-summary.json) preserves the command,
environment, installed-example outputs, and source/corpus/lockfile hashes.
[tests.log](tests.log) is actual test output.
[differential.json](differential.json) preserves each input hash, seed where
applicable, both final-variable outcomes, and all mismatch rows (none in the
successful run). Timing in the unit log is incidental, not a benchmark.

Two initial harness failures are preserved in
[initial-harness-failures.json](initial-harness-failures.json). The initial run
passed 168 of 170 cases; one VM lookup failed after ID sanitization and one
synthetic sprite failed file-schema validation. Repairing the harness and fixture
allowed the final comparison to execute those cases successfully.

[identifier-probes.json](identifier-probes.json) records actual pinned-VM errors
for three reserved variable IDs. These inputs are now explicitly unsupported,
not counted as successful equivalence checks. A final code review also found
and fixed multiline-runtime offsets in the generated block map; the mapping
regression test now checks the exact statement at each reported step line.

There are no unresolved value mismatches in the supported tested corpus. This
does not establish correctness for all Scratch inputs: presentation, timing,
concurrency, personal projects, arbitrary untested graphs, and other VM releases
remain unvalidated. Runtime step exhaustion is an intentional difference from an
unbounded Scratch run. See the [specification](../docs/specification.md) and
[experiment protocol](../docs/experiments.md) for the full boundary.

Re-run from a checkout with development dependencies installed:

```sh
node scripts/verify.js
```

Fresh results go to `.verification/`; the command does not overwrite this saved
snapshot or alter baseline fixtures.
