# Bounded offline inspection

`inspect` explains why a project cannot be converted by the documented sequential
subset. It reads `.sb3` archives or UTF-8 project `.json` files, emits text or JSON
to stdout, and never writes project files. It does not generate or execute
JavaScript, load extensions, fetch assets, inflate asset data, or invoke Scratch
VM. Only the archive's `project.json` is inflated. The installed command uses Node
builtins and has no runtime dependencies.

```sh
scratch-bridge inspect project.sb3
scratch-bridge inspect project.json --json
scratch-bridge inspect project.sb3 --max-blocks 500 --max-work 10000 --json
scratch-bridge inspect --help
```

Files ending in `.json` (case-insensitive) use the JSON reader; every other filename
uses the archive reader. This is an explicit filename convention, not content
sniffing. Non-regular files are rejected; FIFO opens are nonblocking on the tested
Linux platform. Input byte counts are checked before allocation and while reading.
Concurrent file growth fails; concurrent same-size modification is not locked out.
Inspect a stable copy when another application may be saving the project.

## Meaning of the result

`compatible: true` requires all of the following:

1. All configured inspection passes completed without omitted analysis or output.
2. The **unchanged conversion front end** accepted the original whole project with
   the same `maxBlocks`, `maxDepth`, `maxSteps`, `maxListLength`, and `maxCallDepth`.
3. No inspection error diagnostic was found. Warnings can remain.

The front end is shared by `compile` and inspection's validation function. The
validation path returns before code generation. Saved hashes verify that code,
source maps, and metadata for all 512 retained seeded supported programs remain
byte-for-byte unchanged after extracting this path.

Compatibility is with **this converter and these settings**. It is not general
Scratch compatibility, proof of termination, successful execution within budgets,
or proof that a procedure call stays within the runtime call-depth limit. Dynamic
list indices and runtime capacity failures can still reject during execution.
Scheduling, event interleaving, concurrency, rendering, sound, and extension
behavior are outside the subset.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Complete report; original project accepted; no error diagnostics |
| 1 | Incompatible, but all configured regions were checked (for example, two individually supported green-flag scripts violate the single-entry rule) |
| 2 | Incomplete: input failure, exhausted limit, truncated metadata/output, or semantic regions left unanalyzed after a first error |
| 3 | Invalid invocation/limits or unexpected CLI failure; JSON error on stderr |

Codes 1 and 2 both mean **do not treat the project as convertible**. Many ordinary
unsupported projects return 2: a compiler validation stops at its first error and
cannot certify the remainder of that script. This deliberately exposes incomplete
analysis rather than presenting a list of discovered blockers as exhaustive.
Findings for codes 0–2 are reports on stdout, including unreadable/malformed inputs.
This differs from the preexisting conversion CLI's stderr error convention.

## Structural reachability

Inspection inventories blocks in target-index order and lexicographic block-ID
order, using locale-independent comparisons. Next links and all recognizable
input references are traversed, including both conditional branches, substacks,
reporters, and obscured fallback shadows. Parent pointers are checked but are not
traversal edges. Literals are not evaluated. Even a call beneath `if false` or a
zero-repeat loop is a structural call edge.

Definitions and calls resolve by procedure code **within the same target**. Calls
can precede definitions. Every duplicate definition is included as a possible
structural destination and receives an ambiguity diagnostic. Recursion checks
include unused definitions and dead branches. The analysis is an iterative graph
walk, not recursive execution or inlining.

| Reachability | Meaning |
| --- | --- |
| `entry` | Member of a green-flag script's next/input region |
| `called-procedure` | Definition region reached transitively by structural calls from a green-flag script |
| `uncalled-procedure` | Indexed definition with no discovered entry-to-definition call path, after complete graph discovery |
| `other-script` | Another saved top-level root, outside the conversion entry model |
| `disconnected` | No structural path from an entry or definition; conversion rejects these blocks too |
| `unanalyzed` | Malformed graph/metadata or a limit prevents a trustworthy absence-of-path conclusion |

**Structurally reachable does not mean executes.** Likewise, `uncalled-procedure`
is relative to this saved structural model, not a general Scratch dead-code proof.
Unknown opcodes still have recognizable saved next/input links traversed, but their
runtime semantics are never inferred. Invalid descriptors are diagnosed rather
than guessed. Malformed metadata can prevent call resolution; affected negative
reachability conclusions become `unanalyzed`.

Each block is assigned one region. Entry roots are assigned first, then procedure
roots, other top-level roots, and remaining disconnected components. Another saved
root is not absorbed through an invalid edge. Shared references, cycles, and parent
mismatches are diagnosed; ownership on malformed shared graphs is merely a stable
reporting location, not a claim of valid Scratch structure.

## Supported scripts and unanalyzed content

The whole-project validation runs once. If it accepts, its entry and definition
regions are validated. Otherwise, each entry and each procedure is independently
validated with its transitive target-local callees. Other block roots are omitted
from this temporary in-memory validation input; variable scopes, targets, metadata,
extensions, and conversion options remain. A procedure-only check gets a synthetic
empty green-flag root; this checks its body and callees without executing it.

A script's `support` is:

* `supported`: this isolated region passed the converter front end;
* `unsupported`: a front-end rejection occurred, or this is an unsupported root or
  disconnected region;
* `unanalyzed`: validation was not attempted, usually due to a limit.

This is not a promise that the script can be extracted without adjusting its
project, nor that the original whole project converts. A global restriction such
as extensions or malformed variable declarations can also reject an isolated
script. A rejected script has `analysis: "first-error"`; its blocks have
`analysis: "unanalyzed"`. Structural findings still cover the inventoried graph,
but later field/socket/value errors in that same script may remain undiscovered.
Other scripts are still checked within the shared budgets.

There is no repair-and-retry compiler loop. Independent structural errors are
aggregated, and independent script checks can reveal different semantic errors.
An invalid prototype can produce a missing-definition warning as well as a
metadata error. The same issue may appear from distinct diagnostic sources;
`source` distinguishes structural discovery, whole-project compilation validation,
and isolated script validation.

Missing definitions alone are **warnings**, preserving conversion behavior: supplied
inputs are evaluated and the call itself is a no-op. Recursion, malformed metadata,
duplicate definitions, unsupported operations, detached blocks, and concurrent
entry scripts remain errors. No procedure code, argument value, variable value,
comment, costume data, or asset path is embedded in a report.

## JSON version 1

JSON output is one compact UTF-8 object followed by a newline. It contains no
wall-clock timestamps, local paths, or measurements. Repeating the same parsed
project and options under this implementation yields the same report bytes.
Object-key permutation is **not** a promised invariant: the shared compiler's
first failure can depend on original saved order. Array order is significant.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Integer `1`; incompatible report shape changes require a new version |
| `policy` | `scratch-semantic-bridge/sequential-v1`, the conversion policy identifier |
| `compatible`, `complete`, `truncated` | Separate acceptance, analysis completeness, and omission flags |
| `compiler` | Original-project front-end status: `accepted`, `rejected` with `code`, or `not-run` |
| `limits` | All effective budgets, including conversion settings |
| `counts` | Targets, encountered block keys, discovered scripts, charged work, and validation attempts |
| `truncation` | Reasons for incomplete analysis, including semantic/input gaps that need not set `truncated` |
| `diagnostics` | Severity, code, static explanation, target index/name, script ID, block ID, opcode, source |
| `scripts` | Root locations, kind, reachability, support, analysis, and owned block count |
| `blocks` | Block locations, region ID, reachability, and semantic validation coverage |

A diagnostic location field is explicitly `null` when unavailable or project-wide.
Script IDs are saved root block IDs, scoped by target index. Use target index and
block ID together; names and IDs can repeat across targets. The diagnostic code is
machine-readable; explanations can improve within this schema version.
Location strings are the only retained project text. Text output JSON-quotes them
to escape control characters. Limits and truncation can remove suffixes of the
record arrays, so do not infer absence of an error from a partial report.
`counts.blocks` counts dictionary keys encountered during bounded inventory; it is
not a total-project count if inventory stopped before later targets. Counts are
not reduced when output records are omitted.

Programmatic API (pass parsed JSON data, not proxies or live accessor objects):

```js
import {inspect, inspectFile, formatInspection, inspectionExitCode} from 'scratch-semantic-bridge';
const report = await inspectFile('project.sb3', {maxBlocks: 500});
console.log(formatInspection(report));
const inMemory = inspect(JSON.parse(projectJson), {maxReportBytes: 16384});
process.exitCode = inspectionExitCode(inMemory);
```

## Resource limits

Inspection limits can be lowered. Most defaults are also hard ceilings; unlike
conversion's older archive API, inspection does not allow increasing them.
CLI spellings use hyphens, for example `maxValidationRuns` is
`--max-validation-runs`. All values must be positive safe integers.

| Setting | Default and ceiling |
| --- | --- |
| `maxArchiveBytes` | 16 MiB compressed input |
| `maxProjectBytes` | 4 MiB project JSON; also a conservative in-memory data-size guard |
| `maxExpandedBytes` | 64 MiB sum of declared expanded archive entry sizes |
| `maxEntries` | 2,048 ZIP entries |
| `maxTargets` | 128 |
| `maxBlocks` | 10,000 across all targets |
| `maxScripts` | 256 discovered regions, including disconnected roots |
| `maxWork` | 200,000 charged inventory/traversal steps and blocks passed to validators |
| `maxValidationRuns` | 128, shared by original-project and isolated checks |
| `maxDiagnostics` | 1,000 retained findings |
| `maxReportBytes` | 1 MiB serialized JSON including newline; minimum 4,096 bytes |
| `maxMetadataChars` | 200 UTF-16 code units per location string (plus truncation marker) |
| `maxDataDepth` | 256 levels of JSON structure, checked iteratively |
| `maxDataNodes` | 500,000 JSON values |
| `maxDepth` | 128 block-nesting levels; ceiling 256 |
| `maxCallDepth` | Runtime setting 64; ceiling 256 |
| `maxListLength` | 10,000 initial/runtime items per list; ceiling 200,000 |
| `maxSteps` | Runtime setting 100,000; ceiling `Number.MAX_SAFE_INTEGER` |

Work is an implementation budget, not CPU instructions or a time estimate. Saved
JSON and archive size bounds also constrain uncharged metadata scanning and Node
parser work. Isolated checks consume block charges and an attempt even when they
reject immediately. Report suffixes are dropped geometrically to avoid repeated
single-record serialization. Both text and JSON have output byte limits.
Shortened location metadata marks the report incomplete and incompatible, even
when conversion validation accepted. Partial graph/semantic analysis can never
produce `compatible: true`.

These are bounded-input/work/output defenses, **not** an OS memory quota or formal
worst-case latency guarantee. JSON parsing occurs before the JSON-depth pass;
Node and zlib allocate their own buffers. Runtime output string growth in generated
programs is unrelated to inspection limits. Measurements cover the synthetic
workloads in [the observed evidence](../results/inspection.json), not arbitrary
adversarial programs or every supported platform. No private project access or
paid compute is required.

## Reproduction and related work

```sh
node --test test/inspect.test.js
node scripts/verify.js
```

The full verification reruns all compiler regressions and 660 pinned Scratch VM
comparisons, then installs a local tarball with an empty npm cache and `--offline`.
It checks 576 explicitly expected seeded inspection cases and runs eleven installed
CLI workloads three times, recording runtime, peak RSS, report bytes, input hashes,
and repeated report hashes. The installed inspection commands run under Node's
read-only filesystem permissions and a preload rejecting networking, subprocess,
`eval`, and `Function` APIs. The API guard is not an OS firewall. The measurement
harness requires Linux/GNU `/usr/bin/time`; the normal CLI does not.

See [semantic sources and existing implementations](sources.md) for Scratch VM's
block/procedure representation, sb-edit/Leopard, and TurboWarp. This is a diagnostic
interface for this converter's small policy, with no novelty or comparative
performance claim. No real-project compatibility rate has been measured.
