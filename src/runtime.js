// Embedded in generated modules: no project strings are interpreted as code.
export function createRuntime(maxSteps, targetIndex, targetName) {
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) {
    throw Object.assign(new Error('maxSteps must be a positive safe integer'), {code: 'INVALID_LIMIT'});
  }
  let steps = 0;
  return {
    tick(blockId) {
      if (++steps > maxSteps) throw Object.assign(new Error(`Execution exceeded ${maxSteps} steps`), {
        code: 'STEP_LIMIT', targetIndex, targetName, blockId
      });
    },
    get steps() { return steps; },
    number(value) { const n = Number(value); return Number.isNaN(n) ? 0 : n; },
    boolean(value) {
      return typeof value === 'string' ? value !== '' && value !== '0' && value.toLowerCase() !== 'false' : Boolean(value);
    },
    compare(a, b) {
      const white = v => v === null || (typeof v === 'string' && v.trim() === '');
      let x = Number(a), y = Number(b);
      if (x === 0 && white(a)) x = NaN;
      else if (y === 0 && white(b)) y = NaN;
      if (Number.isNaN(x) || Number.isNaN(y)) {
        const left = String(a).toLowerCase(), right = String(b).toLowerCase();
        return left < right ? -1 : left > right ? 1 : 0;
      }
      return x === y ? 0 : x - y;
    },
    mod(a, b) {
      const n = this.number(a), divisor = this.number(b), remainder = n % divisor;
      return remainder / divisor < 0 ? remainder + divisor : remainder;
    }
  };
}

// Preserve non-JSON IEEE values and negative zero without confusing them with strings.
export function encodeValue(value) {
  if (typeof value !== 'number') return value;
  if (Number.isNaN(value)) return {$number: 'NaN'};
  if (value === Infinity) return {$number: 'Infinity'};
  if (value === -Infinity) return {$number: '-Infinity'};
  if (Object.is(value, -0)) return {$number: '-0'};
  return value;
}
