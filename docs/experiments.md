# Reproducible behavioral experiment

## Question and baseline

Do generated Node programs produce the same final scalar values and complete list contents as
` scratch-vm@5.0.300 ` for the documented sequential subset? The baseline is the
actual VM's `loadProject`, green flag, and scheduler, not a second handwritten
interpreter or just calls to individual block primitives.

No performance claim is tested. Rendering, sound, monitors, scheduling timing,
concurrency, and personal projects are not part of this experiment.

## Inputs and seeds

* Nine synthetic examples are preserved as ZIP archives, readable project JSON,
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
* `test/fixtures/lists-generated.jsonl` preserves 192 additional list programs,
  with independent seeds `0x11570000` through `0x115700bf` (290914304–290914495).
  `scripts/list-programs.js` uses Mulberry32, with 16 operations before a loop,
  a fixed 1–3 iteration repeat of another 16 operations, and a three-iteration
  repeat-until loop. Two mutable source lists and an append-only trace list
  exercise every supported list opcode, primitive contents reporters, dynamic
  indices, and numeric/string/boolean/Unicode values. The trace retains selected
  intermediate reads as part of the final state. Programs alternate between
  stage execution, sprite access to stage lists, and sprite list shadowing.
* `scripts/list-edge-cases.js` builds 82 targeted programs: 27 index values on
  empty/nonempty lists, 11 contents/separator cases, 13 search queries, exceptional
  numbers, two scope cases, and sanitized Unicode IDs. All run through the whole
  VM loader and scheduler. Random/any indices are excluded from equivalence checks
  and tested separately as intentional compile/runtime rejections.
* `test/fixtures/procedures-generated.jsonl` preserves 192 procedure programs,
  with independent Mulberry32 seeds `0xc0110000`–`0xc01100bf` (3222339584–3222339775).
  `scripts/procedure-programs.js` generates 3–6 parameterized procedures and one
  zero-argument leaf. Edges go only to a higher-index procedure, making the graph
  acyclic. Each body mutates scalars/lists, records parameters before and after
  nested calls, branches on Boolean parameters and makes bounded 1–2 iteration
  calls. Some calls omit arguments to exercise defaults; shared parameter names
  test isolation. The entry script calls the root twice. Programs alternate stage
  execution, sprite access to stage lists, and sprite-local list shadowing. Warp
  flags, values, graph edges and counts vary by seed. These are small synthetic
  DAGs, not an exhaustive sample of arbitrary procedure graphs.
* `scripts/procedure-edge-cases.js` preserves 18 targeted builders: parameter
  isolation through nested and zero-argument calls, five Boolean socket forms
  under both warp settings, raw defaults and empty sockets, value snapshots,
  repeated empty procedures, Unicode/identifier collisions, missing definitions,
  and same-named definitions across targets. Expected outputs for these cases and
  the three procedure examples are specified separately from either runtime.
* Procedure examples demonstrate a threshold filter calling a Boolean-gated
  append, a weighted aggregation calling an accumulator, and a zero-argument sort
  calling a parameterized swap. They exercise repeated calls and defaults and
  retain independently specified final scalar and complete list expectations.
* The sorting example uses six bubble-sort passes over six fixed values; filtering
  preserves input order and selects positive numbers; aggregation adds four fixed
  values with Scratch numeric coercion. Their expected scalar/list outputs are
  specified as constants, independently of the generated code and VM outputs.
* `scripts/zip.js` writes deterministic stored/deflated ZIPs with a fixed DOS date.
  A deterministic blank SVG is included only for file validity.
* The verifier checks that the corpus regenerates byte-for-byte, and that example
  archives match their builders. Each differential result records an input ZIP
  SHA-256; the report also hashes all three corpora and the npm lockfile.

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

Results compare every input variable and list by target index and original ID, retaining
value types. IDs are translated through the VM's own sanitization helper only
when looking up its loaded values. NaN, infinities, and negative zero are tagged
before comparison, including within every list item, so JSON serialization cannot
hide differences. List order and value types are compared without normalization. VM tick counts
are not compared or claimed as reproducible measurements.

Every differential case is compiled twice and the complete code and map must
match exactly. Unit tests separately compare 33 coercion edge values and all 1,089 pairwise
comparisons against the pinned `Cast` helper. These helper checks supplement the
whole-program VM comparisons; they do not replace them. Deterministic list-index
coercion is checked for 30 values, five lengths, and both accept-all modes (300
checks). Separate regression tests cover malformed references, identifier
collisions, repeated-run isolation, source mappings, list growth, step exhaustion,
and literal/dynamic random/any diagnostics including empty lists. Procedure tests
also cover recursion (including dead branches and unused procedures), malformed
metadata, duplicate definitions, stale call IDs, unsupported bodies, all mapped
procedure block kinds, runtime parameter reset, call-depth enforcement across
400-definition acyclic graphs, and shared step/list budgets. Limit/rejection
checks intentionally do not claim equivalent behavior to the VM.

## Commands and evidence

After `npm ci --ignore-scripts --no-audit --no-fund`:

```sh
node scripts/verify.js
```

The command runs the tests and differential checks, packs the real npm package,
and installs it outside the checkout with an empty npm cache and `--offline`.
It invokes the installed bin link on all nine installed `.sb3` examples, checks
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
node scripts/differential.js --case list-seed-290914304 --output .verification/list-replay
node scripts/differential.js --case procedure-seed-3222339584 --output .verification/procedure-replay
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

The first expanded list run passed 255 of 447 cases; 192 cases failed VM loading.
`results/list-initial-failures.json` preserves every failed row and its input hash,
and `results/list-initial-inputs.jsonl.gz` preserves every original failing project
in matching row order. Direct inspection of the pinned parser schema identified
invalid boolean text primitives and sprite layerOrder 0. The fixture builder now
uses boolean operator reporters and valid sprite layer order. The compiler also
rejects saved boolean numeric/text primitives instead of accepting inputs the
oracle cannot load. The corrected run includes all those cases; none were counted
as passes until loading and execution succeeded. No value mismatches were observed
in those initial failures because the VM never returned a final state.

List growth limits intentionally differ from Scratch's silent handling at its
200,000-item ceiling. Default lists stop at 10,000 items with an explicit error;
random/any indexing is unsupported even for empty lists. Neither a block-step
budget nor a per-list item ceiling bounds total memory or string length. These
resource-limit exclusions are documented in the specification and tested as
errors, not counted as equivalent VM behavior.

The first procedure differential run passed 658 of 660 cases. Two **value
mismatches** occurred for explicit empty Boolean sockets `[2, null]` with a true
saved default, under both warp settings: the compiler returned false while the
VM used true. These were compiler errors, not invalid fixtures. The VM's input
execution cache omits an argument when the socket has no block, causing the
procedure primitive to use its definition default. Call compilation now handles
empty sockets this way for every parameter type. The exact two failing inputs
and both outcomes are retained in `results/procedure-initial-inputs.jsonl.gz` and
`results/procedure-initial-failures.json`. Regression expectations cover missing,
empty, Boolean, text and numeric inputs. Both initial failures were rerun and
passed after the fix; none were skipped or relabeled as successful initial runs.

## Inspection experiment

`node scripts/verify.js` also runs `test/inspect.test.js` and
`scripts/verify-inspection.js`. The latter evaluates 24 explicit mutation kinds
across 24 xorshift32 seeds starting at `0x1a5e0000` (576 cases), retaining each seed,
kind, input SHA-256, report SHA-256/size, and independently specified expected
findings in `.verification/inspection.json`. `scripts/inspection-cases.js`
reconstructs every input. Expected diagnoses are authored with each mutation;
neither the inspector nor compiler supplies expected outcomes. Every compatible
case is additionally compiled with identical defaults. The existing 512 supported
seeded inputs are also inspected and compiled; pre-change hashes protect generated
code, maps, and metadata. No original corpus or behavioral baseline was relaxed.

Inspection is explicitly nonexecuting. An infinite-loop fixture is accepted by
the installed inspector without hanging. Installed runs use read-only Node
permissions plus an API guard, and hash input bytes before and after inspection.
Malformed JSON/archive, unsupported content, archive/block/output limit exhaustion,
a 1,200-statement chain, and 400 disconnected unknown operations are included.
Three separate processes per workload record GNU time elapsed seconds and peak
RSS (KiB), report sizes and stable hashes. Startup and cache effects are included;
no warm/cold-cache control or performance comparison is claimed. Fresh evidence
is saved under `.verification/`, separate from the checked-in observed snapshot.
