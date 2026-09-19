# scratch-semantic-bridge

Convert a small, explicit Scratch 3 subset into readable, standalone JavaScript.
The CLI runs offline, needs only Node.js, and **does not execute a project during
conversion**. Generated programs expose their final variables and a map back to
Scratch block IDs.

This is a sequential logic tool, not a replacement for the Scratch player. It
accepts exactly one green-flag script across the project, scalar variables,
arithmetic, comparisons, boolean operations, conditionals, and loops with an
execution budget. Unsupported blocks are errors, including disconnected ones.

## Quick start

Requires Node.js 22 or newer and npm. Verified on Node 24.20.0 / npm 11.19.0.
There are **no runtime package dependencies**. From this checkout:

```sh
node bin/scratch-bridge.js examples/factorial.sb3 -o /tmp/factorial.mjs
node /tmp/factorial.mjs
```

The output contains `result = 720`. The converter also writes
`/tmp/factorial.mjs.map.json`; neither output file may already exist.

To install the CLI from a local package, without fetching dependencies:

```sh
npm pack --offline --ignore-scripts
npm install --offline --ignore-scripts --no-audit --no-fund --prefix /tmp/bridge-install ./scratch-semantic-bridge-0.1.0.tgz
/tmp/bridge-install/node_modules/.bin/scratch-bridge examples/summation.sb3 -o /tmp/summation.mjs
node /tmp/summation.mjs
```

Nothing needs to be published to a registry. Use an npm `--cache` directory you
can write to if your environment restricts the default cache.

## CLI

```text
scratch-bridge INPUT.sb3 -o OUTPUT.mjs [--max-steps N]
scratch-bridge INPUT.sb3 --check
scratch-bridge --help
```

`--check` validates the entire supported graph and returns compatibility metadata
without writing files or running blocks. It does not prove that a loop terminates.
`--max-archive-bytes N` and `--max-project-bytes N` adjust input limits.

Run the generated module with Node, or import it:

```sh
node /tmp/factorial.mjs --max-steps=1000
```

```js
import {run, blockMap, variableMetadata} from '/tmp/factorial.mjs';
const result = run({maxSteps: 1000});
console.log(result.variables.find(v => v.id === 'result').value); // 720
```

Each call starts from the project's saved variable values. Result records include
`targetIndex`, `targetName`, original variable `id`, display `name`, `initialValue`,
and final `value`. IDs are authoritative; names need not be unique. Non-finite
numbers and negative zero use tags such as `{"$number":"NaN"}` rather than losing
information through JSON. The step count measures this converter's execution
budget, not Scratch VM frames or timing.

Errors go to stderr as JSON with a nonzero exit code. Block errors include the
target index, target name, and block ID; archive and project-level errors may not
have a block location. Existing outputs are never overwritten.

## Synthetic examples

These fixtures were created for this project, not taken from personal projects.
Their archives include a blank SVG to satisfy Scratch's costume requirement.

| Fixture | Computation | Expected final result |
| --- | --- | --- |
| [factorial.sb3](examples/factorial.sb3) | Product of integers 1 through 6 | `720` |
| [summation.sb3](examples/summation.sb3) | Sum of integers 1 through 100 | `5050` |
| [conditional.sb3](examples/conditional.sb3) | Nested classification of −7 | `"negative"` |

Each has a readable `.project.json` and complete `.expected.json` alongside it.
Run `npm run fixtures` to deliberately regenerate the examples and seeded corpus.
Verification checks fixture drift; it never silently rewrites expected inputs.

## Reproduce verification

Development checks use the exact `scratch-vm@5.0.300` package and the committed
npm lockfile. Fetch these development dependencies once (network required unless
already cached):

```sh
npm ci --ignore-scripts --no-audit --no-fund
```

Then one command covers unit tests, differential execution, package creation,
isolated installation with an empty npm cache in offline mode, and execution of
all three examples from that installed package:

```sh
node scripts/verify.js
```

It writes fresh evidence under `.verification/`, returns nonzero on any failed
check, and removes temporary installations. See [verification results](results/README.md)
for the saved measurements, and [experiment protocol](docs/experiments.md) for
seeds, input hashes, replay commands, and limitations. The development VM's
transitive dependencies are not installed for CLI users.

## Compatibility and existing work

Read the [supported-opcode and execution-model specification](docs/specification.md)
before converting other projects. Graphics, sound, broadcasts, clones, lists,
extensions, procedures, random/time-dependent operations, and concurrent scripts
are outside the supported subset. Assets and monitors do not participate in the
result. No personal Scratch projects have been tested.

Compiling Scratch to JavaScript is established work. [Leopard](https://leopardjs.com/)
and [sb-edit](https://github.com/leopard-js/sb-edit) provide conversion aimed at
richer projects. [TurboWarp](https://docs.turbowarp.org/how) compiles Scratch for
its player. This project offers a deliberately smaller offline CLI, explicit
compatibility errors, readable code, and reproducible final-variable comparisons
against [Scratch VM](https://github.com/scratchfoundation/scratch-vm). No novelty
or performance advantage over those tools is claimed. [Sources and attribution](docs/sources.md)
identify the implementations used to establish the semantics.

## API

```js
import {loadSb3, compile} from 'scratch-semantic-bridge';
const project = await loadSb3('example.sb3');
const {code, map, variables} = compile(project, {maxSteps: 100000});
// Save code as .mjs; conversion has not run the Scratch script.
```

`readSb3(Buffer, limits)` is also exported, along with `BridgeError`,
`SUPPORTED_OPCODES`, and `ARCHIVE_LIMITS`. The compilation API expects plain
JSON data; it is not an isolation boundary for arbitrary JavaScript objects with
getters or proxies. See the specification for limits and diagnostic codes.

## License

AGPL-3.0-only; see [LICENSE](LICENSE). The semantic helpers are informed by the
AGPL-licensed Scratch VM implementation, which is also the development oracle.
Generated modules embed this project's runtime helpers. Scratch project content
retains its own provenance. This tool is not affiliated with the Scratch Foundation.
