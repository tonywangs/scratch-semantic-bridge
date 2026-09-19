// Scratch VM rewrites these characters while loading variable IDs.
export const normalizedVariableId = id => id.replace(/[<>&'"]/g, c => ({'<': 'lt', '>': 'gt', '&': 'amp', "'": 'apos', '"': 'quot'})[c]);
