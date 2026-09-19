# Supported subset, version 0.1

## Execution model

* Input is a Scratch 3 ZIP with one root `project.json`, a `meta.semver` beginning
  with `3.`, exactly one stage at target index 0, and zero or more sprites.
* Exactly one `event_whenflagclicked` script exists across all targets. Additional
  hats, detached scripts/reporters, unreachable blocks, and unsupported opcodes
  are rejected. Obscured shadow inputs are validated but never executed.
* Saved scalar variable values initialize execution. A sprite resolves variable
  IDs in its local scope before stage scope. Other sprites' variables are not
  visible. Unknown IDs, mismatched names, cloud variables, lists, and broadcasts
  are rejected. Display names can be duplicated; Unicode is allowed.
* Statements execute sequentially. Reporters have no observable side effects.
  No scheduler timing, frame rate, redraw, monitor behavior, or interleaving is
  modeled. There are no procedures, external effects, or project-supplied code.
* A run returns final variables for every target, including unchanged variables
  in targets with no script. Repeated `run()` calls start fresh.
* Conversion validates and emits code; it never interprets or evaluates a script.
  Generated `.mjs` files use Node's built-in `node:url` module and no package,
  network, renderer, or credential dependencies.

## Opcode table

Only the following 26 opcodes are accepted. All unlisted opcodes are errors,
including when they occur in dead branches or detached blocks.

| Opcode(s) | Inputs / fields | Behavior |
| --- | --- | --- |
| `event_whenflagclicked` | none | The one non-shadow, top-level entry point |
| `data_setvariableto` | `VALUE`; field `VARIABLE: [name, id]` | Assign without coercion |
| `data_changevariableby` | `VALUE`; field `VARIABLE` | Coerce both old value and delta to numbers, then add |
| `data_variable` | field `VARIABLE` | Read by scoped ID |
| `operator_add`, `operator_subtract`, `operator_multiply`, `operator_divide` | `NUM1`, `NUM2` | Numeric arithmetic |
| `operator_mod` | `NUM1`, `NUM2` | Scratch's divisor-sign remainder |
| `operator_round` | `NUM` | JavaScript `Math.round` after Scratch numeric coercion |
| `operator_lt`, `operator_equals`, `operator_gt` | `OPERAND1`, `OPERAND2` | Scratch comparison |
| `operator_and`, `operator_or` | `OPERAND1`, `OPERAND2` | Boolean coercion; both reporter trees are evaluated |
| `operator_not` | `OPERAND` | Boolean negation |
| `control_if`, `control_if_else` | `CONDITION`, `SUBSTACK`, optional `SUBSTACK2` for if/else | Conditional branch |
| `control_repeat` | `TIMES`, `SUBSTACK` | Snapshot the initial rounded count, then repeat |
| `control_repeat_until` | `CONDITION`, `SUBSTACK` | Re-evaluate the condition before every iteration |
| `math_number`, `math_positive_number`, `math_whole_number`, `math_integer`, `math_angle` | field `NUM: [value]` | Return the saved scalar, without early coercion |
| `text` | field `TEXT: [value]` | Return the saved scalar |

Substacks use `[2, blockId]` or `[2, null]`. Missing substacks are empty.
An absent boolean socket (`CONDITION` or a boolean operator input) is false.
Other missing inputs are rejected. Reporter blocks cannot have a `next` block.
Every linked block must have its expected `parent`; shared references and cycles
are errors. Blocks require explicit `next`, `parent`, `topLevel`, `shadow`,
`inputs`, and `fields`. Unexpected inputs/fields and mutations are rejected.

Input modes 1 (shadow), 2 (no shadow), and 3 (active reporter plus obscured shadow)
are supported. Inline primitive tags 4–8 and 10 carry saved numeric/text scalars;
tag 12 carries `[12, name, variableId]`. Other primitive tags, including color,
broadcast, and list primitives, are rejected. Standalone compressed reporter
arrays in `blocks` are outside the accepted canonical graph.

## Coercion and loops

Numeric coercion uses JavaScript `Number`, replacing NaN with zero when a number
is requested. A nonnumeric value can still be assigned and returned unchanged.
Booleans use Scratch's special treatment of `""`, `"0"`, and case-insensitive
`"false"` as false. Whitespace strings other than the empty string are true.

Comparisons use numeric values where possible. Whitespace/empty strings are
compared as strings rather than equated with zero; nonnumeric strings compare
case-insensitively using JavaScript lowercase and lexical order. Matching signed
infinities compare equal. This is not locale-aware collation.

A repeat count is numerically coerced and rounded with `Math.round` when entering
the loop; nonpositive counts skip the body. Changing the source variable does
not change that loop's count. Repeat-until checks before running its body.
Every loop back edge consumes a step even with an empty body. Infinite or very
large loops fail at the execution budget. “Bounded” here means enforced at run
time, not statically proven termination. A budget failure produces an error and
no successful final-state result.

## Identifier and loader boundaries

Scratch VM rewrites `<`, `>`, `&`, `'`, and `"` in variable IDs to `lt`, `gt`,
`amp`, `apos`, and `quot`. This converter retains original IDs for mapping and
output, and rejects any two distinct IDs that collide after that rewriting,
including across targets. The oracle maps original IDs to loaded VM IDs before
comparing values. Block and variable IDs matching own properties of `Object.prototype` (including
`__proto__`, `constructor`, `toString`, and `hasOwnProperty`) are rejected because
the pinned VM cannot reliably preserve them in its object dictionaries.

Scratch's parser removes U+0008 backspace characters while loading JSON. The
converter rejects backspace in executable identifiers, names, and scalar values
instead of silently altering them. Other Unicode text, escaped JavaScript-like
strings, whitespace, and line separators are treated as data, never injected as
code. Initial values must be finite numbers, strings, or booleans, not null,
objects, or arrays. Infinity and NaN may arise during execution.

This is a subset validator, not the full Scratch file schema validator. Unused
presentation metadata, assets, and monitors are ignored. Runtime-compatible
project metadata beyond this subset does not establish rendering compatibility.

## Results and source map

`run({maxSteps})` returns `{steps, variables}`. Each variable record has
`targetIndex`, `targetName`, `id`, `name`, `initialValue`, and `value`. The final
`value` is a scalar or one of these tags:

```json
{"$number":"NaN"}
{"$number":"Infinity"}
{"$number":"-Infinity"}
{"$number":"-0"}
```

The custom map has `{version: 1, mappings: [...]}`. Each entry contains a
one-based `generatedLine`, zero-based `targetIndex`, `targetName`, `blockId`, and
`kind` (`statement`, `reporter`, or `step`). A block can map to several lines.
Inline primitives have no original block ID and belong to the enclosing block.
Hidden shadow blocks produce no statements. The map is embedded as `blockMap`
and written to `OUTPUT.mjs.map.json`; it is **not** a Source Map v3 file or a
browser debugger integration. Runtime limit errors report the responsible block.

## Resource limits

| Limit | Default | Configuration |
| --- | --- | --- |
| Compressed archive | 16 MiB | CLI/API `maxArchiveBytes` |
| Inflated `project.json` | 4 MiB | CLI/API `maxProjectBytes` |
| Sum of declared expanded ZIP entries | 64 MiB | Archive API `maxExpandedBytes` |
| ZIP entries | 2,048 | Archive API `maxEntries` |
| Blocks across targets | 10,000 | Compile API `maxBlocks` |
| Reporter/control nesting | 128 | Compile API `maxDepth`, hard ceiling 256 |
| Execution steps | 100,000 | Compile option, CLI default, or generated run override |

Steps count the hat, statement entries, explicit reporter block evaluations, and
loop iterations/checks. Inline literals/variable primitives and support-code
lines do not count. These counts are deliberately independent of Scratch VM
scheduler ticks. All limits must be positive safe integers.

The ZIP reader supports stored and deflated entries, including central sizes for
entries using data descriptors. It rejects ZIP64, multi-disk archives, encryption,
unknown compression methods, duplicate names, overlaps, truncated directories,
and inconsistent headers. It checks `project.json` CRC and actual inflated size;
a false declared size cannot bypass the inflation bound. Assets are not inflated,
CRC-checked, or extracted. The aggregate asset limit concerns declared sizes only.
The CLI reads regular files with a size bound before allocating the input buffer.
These are resource limits, not a formal proof of parser security.

## Diagnostics

Errors expose stable `code` and `message` fields. Graph errors normally also
expose `targetIndex`, `targetName`, and `blockId`. Representative codes:

* `INVALID_ARCHIVE`, `INVALID_JSON`, `ARCHIVE_LIMIT`
* `INVALID_PROJECT`, `INVALID_TARGET`, `INVALID_BLOCK`, `INVALID_INPUT`, `INVALID_FIELD`
* `UNSUPPORTED_OPCODE`, `UNSUPPORTED_FEATURE`, `UNSUPPORTED_IDENTIFIER`
* `SCRIPT_COUNT`, `EXTRA_SCRIPT`, `UNREACHABLE_BLOCK`
* `MISSING_BLOCK`, `INVALID_PARENT`, `BLOCK_CYCLE`, `SHARED_BLOCK`
* `INVALID_VARIABLE`, `MISSING_VARIABLE`, `IDENTIFIER_COLLISION`
* `BLOCK_LIMIT`, `DEPTH_LIMIT`, `STEP_LIMIT`, `INVALID_LIMIT`, `INVALID_ARGUMENT`

Validation stops at the first error; fixing it may reveal another. Filesystem
errors retain Node's code, for example `ENOENT` or `EEXIST`.
