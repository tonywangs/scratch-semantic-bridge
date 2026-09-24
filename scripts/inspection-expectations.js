import assert from 'node:assert/strict';
import {compile} from '../src/compiler.js';

export function checkExpectation(fixture, report) {
  const {expected, kind, seed} = fixture;
  const label = `${kind} seed ${seed}`;
  assert.equal(report.compatible, expected.compatible, label);
  for (const finding of expected.findings) assert.ok(report.diagnostics.some(d => d.code === finding.code && d.severity === finding.severity && (finding.blockId === undefined || d.blockId === finding.blockId) && (!finding.possibleBlockIds || finding.possibleBlockIds.includes(d.blockId)) && (finding.blockId === undefined || d.targetIndex === finding.targetIndex)), `${label}: missing ${JSON.stringify(finding)}; got ${JSON.stringify(report.diagnostics)}`);
  if (expected.reachability) for (const [id, reachability] of Object.entries(expected.reachability)) assert.equal(report.scripts.find(s => s.scriptId === id)?.reachability, reachability, label);
  if (expected.disconnected) assert.equal(report.blocks.find(b => b.blockId === expected.disconnected)?.reachability, 'disconnected', label);
  if (expected.allEntriesSupported) assert.ok(report.scripts.filter(s => s.kind === 'entry').every(s => s.support === 'supported'), label);
  if (report.compatible) {
    assert.equal(report.complete, true); assert.equal(report.compiler.status, 'accepted');
    const options = Object.fromEntries(['maxBlocks', 'maxDepth', 'maxSteps', 'maxCallDepth', 'maxListLength'].map(key => [key, report.limits[key]]));
    assert.doesNotThrow(() => compile(fixture.project, options), label);
  }
}
