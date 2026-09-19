# Reproducible behavioral experiment

## Question and baseline

Do generated Node programs produce the same final scalar variable values as
` scratch-vm@5.0.300 ` for the documented sequential subset? The baseline is the
actual VM's `loadProject`, green flag, and scheduler, not a second handwritten
interpreter or just calls to individual block primitives.

No performance claim is tested. Rendering, sound, monitors, scheduling timing,
concurrency, and personal projects are not part of this experiment.

## Inputs and seeds

* Three synthetic examples are preserved as ZIP archives, readable project JSON,
  and independently specified expected final values under `examples/`.
* `scripts/edge-cases.js` builds 39 targeted projects covering rounding, nested
  control, numeric/text coercion, exceptional numbers, shadow forms, Unicode,
  ID sanitization, and local-versus-stage variables.
* `test/fixtures/generated.jsonl` preserves all 128 generated input projects and
  their seeds: consecutive integers `0x5eed0000` through `0x5eed007f`.
* `scripts/programs.js` defines the independent-seed Mulberry32 generator.
  Expressions are at most three recursive levels; nested structured statements
  are limited to two recursive levels. Repeats use small nonnegative/negative
  fractional bounds; each generated project finishes with a repeat-until loop
  whose dedicated counter advances toward a fixed bound. Arithmetic deliberately
  includes strings and zero divisors, so NaN and infinities are meaningful results.
* `scripts/zip.js` writes deterministic stored/deflated ZIPs with a fixed DOS date.
  A deterministic blank SVG is included only for file validity.
* The verifier checks that the corpus regenerates byte-for-byte, and that example
  archives match their builders. Each differential result records an input ZIP
  SHA-256; the report also hashes the corpus and npm lockfile.

## Execution and comparison

The converter reads the generated archive, validates it, emits JavaScript, and
imports that generated module. The VM independently loads the project's JSON
through its Scratch parser. Input objects are serialized separately, so VM
mutation cannot change compiler inputs. Examples' ZIPs are additionally exercised
through the installed CLI.

The headless VM has no storage, renderer, external extensions, or running clock
interval. The harness sets turbo mode and `currentStepTime = 1000 / 30`, then
calls `_step()` until no threads remain, with a 20,000-tick ceiling. Those private
APIs are intentionally coupled to the pinned VM version. Expected missing-renderer
or storage logging is disabled through minilog. The harness never treats a
load/runtime error or timeout as a passing comparison. An outer process timeout
in the verifier bounds the complete differential command.

Results compare every input variable by target index and original ID, retaining
value types. IDs are translated through the VM's own sanitization helper only
when looking up its loaded values. NaN, infinities, and negative zero are tagged
before comparison, so JSON serialization cannot hide differences. VM tick counts
are not compared or claimed as reproducible measurements.

Unit tests separately compare 33 coercion edge values and all 1,089 pairwise
comparisons against the pinned `Cast` helper. These helper checks supplement the
whole-program VM comparisons; they do not replace them.

## Commands and evidence

After `npm ci --ignore-scripts --no-audit --no-fund`:

```sh
node scripts/verify.js
```

The command runs the tests and differential checks, packs the real npm package,
and installs it outside the checkout with an empty npm cache and `--offline`.
It invokes the installed bin link on all three installed `.sb3` examples, checks
the generated modules with `node --check`, runs them, and compares their outputs
with the independent example expectations. The isolated package has no runtime
dependencies. This verifies offline package resolution and execution without an
OS-level network namespace or firewall.

Fresh evidence is written to `.verification/tests.log`,
`.verification/differential/report.json`, and `.verification/verification.json`.
The committed `results/` snapshot records actual completed checks, not an
assertion that every future environment will pass.

Run only the differential experiment, or replay one preserved seed:

```sh
node scripts/differential.js
node scripts/differential.js --case seed-1592590336 --output .verification/replay
```

Failures write both the exact `.sb3` and readable project JSON to the selected
output directory. The report contains both compared outcomes when available,
or the load/conversion/runtime error. Failure artifacts are retained until the
caller removes them; only rows in the current report belong to its current run.

## Interpretation and limits

Agreement on this finite corpus is evidence for this subset, not proof of
semantic equivalence for all accepted inputs. Seeded generation samples a modest
program space. The compiler is stricter than Scratch's loader on malformed
references, disconnected blocks, identifier collisions, and backspace text.
A runtime budget deliberately terminates programs that Scratch might keep
running. The oracle and compiler share JavaScript numeric and Unicode behavior;
this experiment does not test another language's implementation or another
Scratch release. Node 22 is the declared minimum but the saved run used Node 24.

Initial harness failures are preserved in
`results/initial-harness-failures.json`: one lookup used an unsanitized ID and one
sprite fixture had invalid metadata. They were repaired before the final run.
The successful result does not count those initial failures as passes.
