export class BridgeError extends Error {
  constructor(code, message, location = {}) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    Object.assign(this, location);
  }
  toJSON() {
    return Object.fromEntries(['code', 'message', 'targetIndex', 'targetName', 'blockId'].filter(k => this[k] !== undefined).map(k => [k, this[k]]));
  }
}
export function fail(code, message, location) { throw new BridgeError(code, message, location); }
export function positiveLimit(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_LIMIT', `${name} must be a positive safe integer`);
  return value;
}
