import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createRuntime} from '../src/runtime.js';
const require = createRequire(import.meta.url);
const Cast = require('../node_modules/scratch-vm/src/util/cast.js');
const samples = [0, -0, 1, -1, 2.5, NaN, Infinity, -Infinity, true, false, '', ' ', '\t', '\n', '0', '00', '0.0', 'false', 'FALSE', 'False ', 'Infinity', '-Infinity', 'NaN', 'word', 'WORD', 'É', 'é', 'İ', '你好', '1e2', '0x10', null, undefined];
const rt = createRuntime(100, 0, 'Stage');
test('numeric and boolean coercion agree with pinned Scratch Cast on 33 edge values', () => {
  for (const value of samples) { assert.equal(rt.number(value), Cast.toNumber(value)); assert.equal(rt.boolean(value), Cast.toBoolean(value)); }
});
test('all pairwise comparisons agree with pinned Scratch Cast', () => {
  for (const left of samples) for (const right of samples) {
    const actual = rt.compare(left, right), expected = Cast.compare(left, right);
    assert.deepEqual([actual < 0, actual === 0, actual > 0], [expected < 0, expected === 0, expected > 0], `compare(${String(left)}, ${String(right)})`);
  }
});
