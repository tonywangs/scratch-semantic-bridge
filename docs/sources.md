# Existing implementations and semantic sources

Inspected for the scalar implementation on 2026-09-19 and the list extension on
2026-09-20:

* [Scratch VM](https://github.com/scratchfoundation/scratch-vm): the actual behavioral
  baseline, pinned here to npm `scratch-vm@5.0.300`. The repository notes its
  migration into Scratch's editor monorepo. This project deliberately pins the
  old package rather than silently following a moving release.
* [Scratch casting](https://github.com/scratchfoundation/scratch-vm/blob/develop/src/util/cast.js),
  [operators](https://github.com/scratchfoundation/scratch-vm/blob/develop/src/blocks/scratch3_operators.js),
  [control](https://github.com/scratchfoundation/scratch-vm/blob/develop/src/blocks/scratch3_control.js),
  [data](https://github.com/scratchfoundation/scratch-vm/blob/develop/src/blocks/scratch3_data.js),
  [SB3 serialization](https://github.com/scratchfoundation/scratch-vm/blob/develop/src/serialization/sb3.js),
  and [execution](https://github.com/scratchfoundation/scratch-vm/blob/develop/src/engine/execute.js)
  establish input forms, assignment, coercion, comparison, and repeat semantics.
  The linked branch may move; the installed sources in the lockfile-pinned npm
  package were inspected and are what the verification uses.
* [scratch-parser](https://github.com/scratchfoundation/scratch-parser): the pinned
  VM's loader validates file metadata and strips backspace characters. Its actual
  resolved version and integrity are in `package-lock.json`.
* [Leopard](https://leopardjs.com/) and
  [sb-edit](https://github.com/leopard-js/sb-edit): an existing Scratch-to-JavaScript
  route, including `.sb3` import and export to Leopard. The intended scope is
  richer than this project's sequential final-variable tool.
* [TurboWarp compiler explanation](https://docs.turbowarp.org/how): an existing
  compiler integrated into a Scratch player. No comparison benchmark was run.

The Scratch VM dependency and its parser use AGPL-3.0-only. The semantic helper
implementation is informed by those sources and this project uses the same
license; see `LICENSE`. The VM and its dependency tree are development-only and
are not copied into the installable CLI tarball. The small runtime helpers in
`src/runtime.js` are embedded in generated code.

Synthetic sample programs, corpus generation, compatibility policy, and the
experiment harness are maintained in this repository. There is no claim that
Scratch compilation, static analysis, or differential testing is novel.

For list support, the installed `scratch-vm@5.0.300` sources were inspected again:
`src/blocks/scratch3_data.js` (all list operations and the 200,000-item ceiling),
`src/util/cast.js` (`toListIndex` and comparisons), and `src/engine/target.js`
(local-first ID lookup). The resolved `scratch-parser` SB3 schema was also
inspected after it rejected boolean text primitives in early fixtures. The
compiler now rejects that encoding and the fixtures use boolean reporters.
The sb-edit README and TurboWarp compiler explanation linked above were revisited
for related work; no novelty or performance comparison is claimed.

For custom procedure support (2026-09-21), the installed lockfile-pinned sources
were inspected: `src/blocks/scratch3_procedures.js` (defaults, missing definitions,
and argument reporters), `src/engine/thread.js` (parameter frame isolation),
`src/engine/blocks.js` (target-local definitions and parameter metadata),
`src/engine/execute.js` (input evaluation and absent inputs), and
`src/serialization/sb3.js` (prototype/field/input encoding). The public
[procedure implementation](https://github.com/scratchfoundation/scratch-vm/blob/develop/src/blocks/scratch3_procedures.js)
and [TurboWarp compiler explanation](https://docs.turbowarp.org/how) were also
revisited. The installed version remains the behavioral authority; no new
compiler technique or performance advantage is claimed. In particular, direct
inspection and a failing VM comparison established that an empty procedure
socket uses its definition default, unlike a regular empty Boolean operator
socket. The preserved negative result is documented in the experiment protocol.
