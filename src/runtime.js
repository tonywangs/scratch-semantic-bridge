// Embedded in generated modules: no project strings are interpreted as code.
export function createRuntime(maxSteps, targetIndex, targetName, maxListLength = 10000, maxCallDepth = 64) {
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) {
    throw Object.assign(new Error('maxSteps must be a positive safe integer'), {code: 'INVALID_LIMIT'});
  }
  if (!Number.isSafeInteger(maxListLength) || maxListLength < 1 || maxListLength > 200000) {
    throw Object.assign(new Error('maxListLength must be an integer from 1 to 200000'), {code: 'INVALID_LIMIT'});
  }
  if (!Number.isSafeInteger(maxCallDepth) || maxCallDepth < 1 || maxCallDepth > 256) {
    throw Object.assign(new Error('maxCallDepth must be an integer from 1 to 256'), {code: 'INVALID_LIMIT'});
  }
  let steps = 0, callDepth = 0;
  return {
    enterCall(blockId) {
      if (callDepth >= maxCallDepth) throw Object.assign(new Error(`Execution exceeded ${maxCallDepth} procedure calls in depth`), {
        code: 'CALL_DEPTH_LIMIT', targetIndex, targetName, blockId
      });
      callDepth++;
    },
    leaveCall() { callDepth--; },
    tick(blockId) {
      if (++steps > maxSteps) throw Object.assign(new Error(`Execution exceeded ${maxSteps} steps`), {
        code: 'STEP_LIMIT', targetIndex, targetName, blockId
      });
    },
    get steps() { return steps; },
    listIndex(value, length, acceptAll, blockId) {
      if (value === 'random' || value === 'any') throw Object.assign(new Error(`Unsupported list index: ${value}`), {
        code: 'UNSUPPORTED_LIST_INDEX', targetIndex, targetName, blockId
      });
      if (value === 'all') return acceptAll ? 'all' : 0;
      if (value === 'last') return length;
      const index = Math.floor(this.number(value));
      return index >= 1 && index <= length ? index : 0;
    },
    listCapacity(length, blockId) {
      if (length > maxListLength) throw Object.assign(new Error(`List exceeds ${maxListLength} items`), {
        code: 'LIST_LIMIT', targetIndex, targetName, blockId
      });
    },
    listAdd(list, item, blockId) {
      this.listCapacity(list.length + 1, blockId);
      list.push(item);
    },
    listInsert(list, item, index, blockId) {
      const i = this.listIndex(index, list.length + 1, false, blockId);
      if (i) { this.listCapacity(list.length + 1, blockId); list.splice(i - 1, 0, item); }
    },
    listReplace(list, index, item, blockId) {
      const i = this.listIndex(index, list.length, false, blockId);
      if (i) list[i - 1] = item;
    },
    listDelete(list, index, blockId) {
      const i = this.listIndex(index, list.length, true, blockId);
      if (i === 'all') list.length = 0;
      else if (i) list.splice(i - 1, 1);
    },
    listClear(list) { list.length = 0; },
    listItem(list, index, blockId) {
      const i = this.listIndex(index, list.length, false, blockId);
      return i ? list[i - 1] : '';
    },
    listItemNumber(list, item) { return list.findIndex(value => this.compare(value, item) === 0) + 1; },
    listContains(list, item) { return list.indexOf(item) >= 0 || this.listItemNumber(list, item) > 0; },
    listLength(list) { return list.length; },
    listContents(list) { return list.join(list.every(item => typeof item === 'string' && item.length === 1) ? '' : ' '); },
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
