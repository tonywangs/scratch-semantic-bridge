# Recorded upstream corpus results

Observed 2026-09-27T02:37:45.518Z. Source revision: `e6f5711f25f607ce8370a5a7afcfb391b349a6e1`.

**0/34 compatible** with the configured sequential subset. 13/34 completed incompatible inspections; 21/34 incomplete inspections; 0 skipped and 0 omitted.

The corpus is all 34 upstream SB3 regression fixtures at the pinned revision. It is not a representative user-project sample. No imported project was executed. Zero compatible projects is the measured result, not an experiment failure.

## Reproducibility and measurements

Environment: v24.20.0, linux/x64, kernel 6.8.0-124-generic, Python 3.12.3; reported CPU DO-Regular, 4 logical CPUs. Node 22 and other operating systems were not tested.

| Installed offline run | Wall seconds | Peak individual process RSS (KiB) | Exit |
| --- | ---: | ---: | ---: |
| 1 | 6.6 | 73504 | 2 |
| 2 | 7.01 | 73748 | 2 |
| 3 | 7.51 | 73288 | 2 |

GNU time measurements include startup and inspection children. RSS is the largest process peak, not simultaneous aggregate memory. Filesystem caches were uncontrolled. Exit 2 truthfully reports incomplete analysis. Network/eval/Function API guards were active in the installed CLI and workers; they are not an OS firewall.

All three deterministic reports: **90156 bytes**, SHA-256 `ebc86575a8bd03d49073f9d27a7467a6802358116bd501567aa0897572aacb9f`. Input SHA-256 values were unchanged for all 34 files in both the original cache and isolated copy.

| Artifact | Bytes |
| --- | ---: |
| Original SB3 inputs (ignored acquisition cache) | 2749647 |
| corpus-report.json | 90156 |
| batch-audit.json | 17454 |

Charged input bytes: 2749647; declared expanded bytes: 3577403; graph/validation work units: 4389. These budget charges are not CPU-instruction measurements or asset decompression measurements.

## Project-level blocker frequencies

Each code counts a project once; every denominator is 34, including the three archive failures. Codes overlap. Findings are lower bounds for incomplete analyses.

| Code | Projects / all fixtures |
| --- | ---: |
| EXTRA_SCRIPT | 15/34 |
| INVALID_ARCHIVE | 3/34 |
| INVALID_BLOCK | 1/34 |
| INVALID_PARENT | 1/34 |
| INVALID_PROCEDURE | 1/34 |
| INVALID_VARIABLE | 4/34 |
| SCRIPT_COUNT | 28/34 |
| UNREACHABLE_BLOCK | 1/34 |
| UNSUPPORTED_FEATURE | 9/34 |
| UNSUPPORTED_OPCODE | 18/34 |

The most frequent blocker is the one-green-flag requirement. Unsupported operations, additional entry/detached scripts, extensions/broadcasts and cloud flags also occur. The large pen fixture adds procedure and saved-graph issues. These counts describe the fixture set, not Scratch users.

## Fixture outcomes and incomplete cases

Three archives lack a root project.json. The other 18 incomplete cases retain unanalyzed script semantics after rejection; the pen fixture also has structural/procedure issues. No timeout, cancellation, batch resource exhaustion, worker failure, or report omission occurred in this corpus run.

| Fixture | Status | Analysis limitation |
| --- | --- | --- |
| broadcast_special_chars | incomplete | SEMANTIC_REGIONS_UNANALYZED |
| cloud_variables_exceeded_limit | incompatible | Completed configured passes |
| cloud_variables_limit | incompatible | Completed configured passes |
| cloud_variables_local | incompatible | Completed configured passes |
| cloud_variables_simple | incompatible | Completed configured passes |
| comments | incomplete | SEMANTIC_REGIONS_UNANALYZED |
| comments_no_duplicate_id_serialization | incomplete | SEMANTIC_REGIONS_UNANALYZED |
| corrupt_png | incompatible | Completed configured passes |
| corrupt_sound | incompatible | Completed configured passes |
| corrupt_svg | incomplete | INPUT_NOT_ANALYZED |
| default | incompatible | Completed configured passes |
| draggable | incompatible | Completed configured passes |
| edge-triggered-hat | incomplete | SEMANTIC_REGIONS_UNANALYZED |
| order-library-reverse | incomplete | SEMANTIC_REGIONS_UNANALYZED |
| order-library | incomplete | SEMANTIC_REGIONS_UNANALYZED |
| list-monitor-rename | incompatible | Completed configured passes |
| ev3-simple-project | incomplete | SEMANTIC_REGIONS_UNANALYZED |
| microbit-simple-project | incomplete | SEMANTIC_REGIONS_UNANALYZED |
| music-simple-project | incomplete | SEMANTIC_REGIONS_UNANALYZED |
| pen-dolphin-3d | incomplete | SEMANTIC_REGIONS_UNANALYZED |
| pen-simple-project | incomplete | SEMANTIC_REGIONS_UNANALYZED |
| text2speech-simple-project | incomplete | SEMANTIC_REGIONS_UNANALYZED |
| videoSensing-simple-project | incomplete | SEMANTIC_REGIONS_UNANALYZED |
| wedo2-simple-project | incomplete | SEMANTIC_REGIONS_UNANALYZED |
| missing_png | incompatible | Completed configured passes |
| missing_sound | incompatible | Completed configured passes |
| missing_svg | incomplete | INPUT_NOT_ANALYZED |
| monitored_variables | incompatible | Completed configured passes |
| monitors | incomplete | SEMANTIC_REGIONS_UNANALYZED |
| origin-absent | incompatible | Completed configured passes |
| origin | incomplete | INPUT_NOT_ANALYZED |
| timer-monitor | incomplete | SEMANTIC_REGIONS_UNANALYZED |
| top-level-reporters | incomplete | SEMANTIC_REGIONS_UNANALYZED |
| variable_characters | incomplete | SEMANTIC_REGIONS_UNANALYZED |

## Expected versus observed

All 34 source-derived rejection expectations matched. Required diagnostic categories matched without discrepancy for 30/34 fixtures; unsupported-opcode expectations matched for all fixtures. Four cloud fixtures expected UNSUPPORTED_FEATURE but received the existing INVALID_VARIABLE category. The frozen oracle and these disagreements are preserved; no semantics were changed to make them agree.

The Python source audit independently checked ZIP structure, saved block facts, input hashes, the documented opcode policy, and 357 reported diagnostic locations. This is not an external human review or a complete semantic oracle. Unexpected additional diagnostics are recorded as observations, not certified by that necessary-condition oracle.

Compiler code-generation checks cover all 0 compatible corpus fixtures (vacuous here). Two separate installed synthetic controls passed both inspection and code generation with identical settings, including an infinite-loop program that was not run. Existing synthetic Scratch VM differential checks remain separate from this audit.

See [protocol and offline replay](../docs/corpus-audit.md), [source manifest](../corpus/sources.json), [frozen expectations](../corpus/expectations.json), [discrepancies](../corpus/discrepancies.json), [deterministic report](corpus-report.json), and [measurement evidence](batch-audit.json). Fresh runs write .verification; they do not rewrite these snapshots.
