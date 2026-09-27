# Bounded offline batch inspection

After installing Node 22 or newer, run:

```sh
node bin/scratch-bridge.js inspect-batch corpus/manifest.json --json
node bin/scratch-bridge.js inspect-batch corpus/manifest.json --output report.txt
```

Acquire the corpus once as described in [the corpus audit](corpus-audit.md).
For your own projects, create a manifest next to the input files:

```json
{"schemaVersion":1,"files":[{"id":"first","path":"projects/first.sb3"},{"id":"second","path":"second.json"}]}
```

The command accepts only an explicit version 1 JSON manifest, with no directory
scan or glob expansion. IDs must be unique ASCII letters/digits/dot/underscore/
hyphen, start with a letter or digit, and contain at most 64 characters. Paths
are relative to the manifest's directory. Absolute paths and paths escaping
that directory are skipped; symlinks must resolve within that directory.
Input format follows the resolved filename: `.json` means project JSON,
otherwise SB3. Files must be regular files. The manifest itself is at most
256 KiB and 1,024 rows. Unknown manifest fields and duplicate IDs are errors.

Order is preserved. Each canonical path is attempted once; a subsequent alias
gets `DUPLICATE_INPUT` and is skipped. Different files with identical content,
including hard links with different paths, are separate manifest inputs. No
project scripts, extensions, asset files, or generated modules are executed or
loaded. Only root `project.json` is decompressed. Inputs are opened read-only;
no archives are extracted. Batch inspection has no runtime dependencies beyond
Node builtins.

`--output` exclusively creates a new file after inspection. Existing files,
symlinks and hard links are never overwritten. Output paths matching the
manifest or an input, including a missing input reached through a directory
alias, are refused. A failed write removes only its newly created output.
For this protection use `--output`; shell redirection is outside the CLI's
control and can truncate files before the command starts.

## Outcomes and report schema

JSON is deterministic for the same ordered inputs, options and outcomes. Timing,
PIDs, machine paths and environment details do not appear in the report. A
near-deadline run can have different outcomes, so it need not have the same hash.
The schema is `schemaVersion: 1`, policy `scratch-semantic-bridge/batch-v1`.

Each row retains the manifest index and ID, a SHA-256 when bytes were fully read,
status, explicit reason, compiler check, diagnostic locations, blocker counts,
and the inspection coverage summary. Status is one of:

* `compatible`: all required passes completed and both validation and code
  generation accepted under the identical block/depth/call/list/step settings.
* `incompatible`: inspection completed and found a policy or structural blocker.
* `incomplete`: input failed, analysis stopped, semantic content remains
  unanalyzed, a worker failed/timed out, or code generation disagreed.
* `skipped`: no inspection was attempted (for example duplicate input,
  cancellation before dispatch, path escape, or exhausted batch budget).

An incomplete row can contain decisive blockers. It is never counted compatible.
The existing inspector deliberately stops semantic validation at the first
error in each script; see [inspection coverage](inspection.md). Structural
inventory can therefore be complete while semantic analysis is incomplete.
A compiler disagreement also makes the row incomplete. Compiler acceptance is
compatibility with this repository's configured sequential subset, not
behavioral equivalence or general Scratch compatibility.

Diagnostics contain codes, severity, target index, script ID, block ID, opcode
and source. They exclude target display names, variable names/values, procedure
text, asset paths, comments and compiler error messages. IDs and opcodes are
bounded by the existing metadata limit and are necessary to locate findings.
`blockerCounts` counts reported error diagnostics by code, including separate
passes reporting the same underlying issue. `projectBlockerFrequency` counts
**projects** containing each code once. Frequencies are lower bounds for partial
inspections, not estimates of all defects. Resource/input/cancellation reasons
also appear as codes; they should not be mistaken for Scratch semantic defects.

The denominator `totalFiles` always includes duplicates, skipped and omitted
rows. `counts` separates each status, reported rows and omitted rows. When report
space is exhausted, a row is replaced with an incomplete `REPORT_LIMIT` row;
later rows are skipped, or counted explicitly in `omittedEntries` if even their
small summaries do not fit. The overall result becomes incomplete. Any retained
compatible rows describe only those files, never omitted inputs.

Exit codes are 0 for all-compatible (or an empty no-op manifest), 1 for completed
incompatible, 2 for any incomplete/skipped/omitted analysis, and 3 for manifest,
argument or output I/O errors. An empty manifest has `compatible: false` even
though its no-op command exits 0. Text output uses the same statuses and escapes
location strings; independently bounded text truncation is labeled explicitly.

## Resource limits and cancellation

All batch ceilings below can be lowered, never raised. All per-file flags from
`inspect --help` also apply; compiler semantics and conversion defaults have
not changed.

| Flag | Default / ceiling |
| --- | ---: |
| `--max-files` | 128 attempted manifest positions |
| `--max-manifest-bytes` | 262144 |
| `--max-total-input-bytes` | 67108864 |
| `--max-total-expanded-bytes` | 268435456 |
| `--max-total-work` | 2000000 |
| `--max-batch-report-bytes` | 4194304 (minimum 4096) |
| `--max-file-ms` | 5000 |
| `--max-total-ms` | 60000 |

The per-file defaults include 16 MiB compressed input, 4 MiB project JSON,
64 MiB declared expanded archive size, 2,048 entries, 10,000 blocks, 200,000
traversal/validation work units and a 1 MiB inspection report. A JSON input is
charged its byte length as both input and expanded bytes. A ZIP is charged
bytes actually read and declared expanded sizes from its central directory;
asset bytes are not inflated or validated. Invalid expansion metadata cannot
cause unbounded decompression: actual project inflation also has a ceiling.

Each file runs in a fresh child process with a 128 MiB V8 old-space limit.
This is not a total RSS limit: buffers, runtime and other allocations also use
memory. The parent caps the child timeout by the remaining batch deadline and
kills timed-out or cancelled children with SIGKILL, awaiting process close
before returning. SIGINT and SIGTERM request cancellation: completed rows remain,
the active row becomes incomplete, and pending rows become cancelled/skipped.
Children create no temporary files. This isolation can stop synchronous ZIP,
JSON, graph traversal, validation and code generation.

Aggregate byte/work budgets reduce the next child's per-file allowance. A
worker that returns usage is charged that usage, capped at its allowance. A
killed or failed worker that returns no trustworthy usage reserves its entire
allocation, a conservative charge rather than a measurement. Code generation
reserves an additional block-plus-target work charge before a positive result.
Work units bound graph passes rather than count CPU instructions; deadlines
also cover expensive validation. Manifest handling, path resolution, process
startup/reaping and final bounded report serialization add overhead outside a
child's timer. These are operational deadlines, not hard real-time guarantees
against a stalled kernel or filesystem.

The command does not defend against a concurrent actor mutating directory
symlinks or file contents during inspection. It rejects observed file-size
changes, avoids following final-component symlinks in the worker, and verifies
source hashes in the corpus experiment. Run against a stable local input tree.
No claim is made that the child process is a sandbox for executable hostile
code: imported projects remain data throughout.

The public API is `inspectBatch(manifestPath, {limits, inspection, signal,
onMetrics})`. The optional callback receives nondeterministic elapsed time and
parent/largest-child peak RSS separately from the report. `readManifest`,
`formatBatch`, `batchExitCode` and `BATCH_LIMITS` are also exported.
