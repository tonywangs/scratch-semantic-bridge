#!/usr/bin/env python3
"""Independent source review: standard-library ZIP/JSON, no bridge/VM imports.
Checks frozen structural facts without executing any imported project or assets.
"""
import collections
import argparse
import hashlib
import json
import pathlib
import re
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--report', type=pathlib.Path, help='Also verify diagnostic locations against original source blocks')
args = parser.parse_args()
actual = json.loads(args.report.read_text()) if args.report else None
location_checks = 0
sources = json.loads((ROOT / 'corpus/sources.json').read_text())
manifest = json.loads((ROOT / 'corpus/manifest.json').read_text())
if actual is not None:
    assert actual['schemaVersion'] == 1 and actual['totalFiles'] == 34
    assert [e['id'] for e in actual['entries']] == [e['id'] for e in manifest['files']]
expectations = json.loads((ROOT / 'corpus/expectations.json').read_text())
discrepancies = json.loads((ROOT / 'corpus/discrepancies.json').read_text())
selection = json.loads((ROOT / 'corpus/selection.json').read_text())
review = json.loads((ROOT / 'corpus/source-review.json').read_text())
assert selection['treeResponseTruncated'] is False
assert selection['selectionOverrides'] == []
assert selection['sb3CandidateCount'] == 34
assert selection['selectedPaths'] == [s['sourcePath'] for s in sources['files']]
assert [r['id'] for r in review['fixtures']] == [s['id'] for s in sources['files']]
assert all(r['upstreamTests'] for r in review['fixtures'])
for name, key in [('sources', 'frozenSourcesSha256'), ('expectations', 'frozenExpectationsSha256')]:
    assert hashlib.sha256((ROOT / f'corpus/{name}.json').read_bytes()).hexdigest() == discrepancies[key]
assert len(sources['files']) == len(manifest['files']) == len(expectations['fixtures']) == 34
spec = (ROOT / 'docs/specification.md').read_text().split('## Opcode table')[1].split('Substacks use')[0]
allowed = set(re.findall(r'`([a-z][a-z0-9_]+)`', spec))
for source, row, expected in zip(sources['files'], manifest['files'], expectations['fixtures']):
    assert source['id'] == row['id'] == expected['id']
    path = ROOT / 'corpus' / row['path']
    data = path.read_bytes()
    assert len(data) == source['bytes']
    assert hashlib.sha256(data).hexdigest() == source['sha256']
    assert hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() == source['gitBlob']
    with zipfile.ZipFile(path) as archive:
        if 'project.json' not in archive.namelist():
            assert expected['sourceFacts'] == {'rootProject': False}
            assert expected['requiredCodes'] == ['INVALID_ARCHIVE']
            continue
        assert archive.getinfo('project.json').file_size <= 4 * 1024 * 1024
        project = json.loads(archive.read('project.json'))
    targets = project['targets']
    blocks = [b for t in targets for b in t.get('blocks', {}).values() if isinstance(b, dict)]
    ops = collections.Counter(b['opcode'] for b in blocks)
    facts = {'rootProject': True, 'targets': len(targets), 'blocks': len(blocks),
             'greenFlags': ops['event_whenflagclicked'],
             'cloudVariables': sum(bool(isinstance(v, list) and len(v) > 2 and v[2])
                                   for t in targets for v in t.get('variables', {}).values()),
             'broadcasts': sum(len(t.get('broadcasts', {})) for t in targets),
             'extensions': project.get('extensions', []), 'opcodeCounts': dict(sorted(ops.items()))}
    assert facts == expected['sourceFacts'], source['id']
    assert sorted(set(ops) - allowed) == expected['unsupportedOpcodes'], source['id']
    # A simple necessary-condition rejection oracle. It intentionally does not
    # replicate the compiler or purport to recognize all malformed graphs.
    assert facts['greenFlags'] != 1 or facts['cloudVariables'] or facts['broadcasts'] or facts['extensions'] or expected['unsupportedOpcodes']
    assert expected['compatible'] is False
    if actual is not None:
        observed = next(e for e in actual['entries'] if e['id'] == source['id'])
        for diagnostic in observed['diagnostics']:
            if diagnostic['code'] == 'UNSUPPORTED_OPCODE':
                assert diagnostic['blockId'] is not None
            ti = diagnostic['targetIndex']
            for key in ('blockId', 'scriptId'):
                if diagnostic[key] is not None:
                    assert isinstance(ti, int) and 0 <= ti < len(targets)
                    assert diagnostic[key] in targets[ti]['blocks'], (source['id'], key)
            if diagnostic['blockId'] is not None:
                block = targets[ti]['blocks'][diagnostic['blockId']]
                opcode = block.get('opcode') if isinstance(block, dict) else None
                assert diagnostic['opcode'] == opcode, source['id']
                location_checks += 1
print(json.dumps({'schemaVersion': 1, 'status': 'pass', 'fixtures': 34,
                  'diagnosticLocationChecks': location_checks,
                  'method': 'Independent Python ZIP/source facts and documented opcode table; no project execution'}))
