/**
 * Serializes supported local data deterministically without JSON's lossy
 * treatment of dates and undefined values.
 */
export function createCanonicalSerialization(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === undefined) return ['undefined'];
  if (value === null) return ['null'];
  if (value instanceof Date) return ['date', value.toISOString()];

  switch (typeof value) {
    case 'boolean':
    case 'number':
    case 'string':
      return [typeof value, value];
    case 'bigint':
      return ['bigint', value.toString()];
    case 'object': {
      if (Array.isArray(value)) return ['array', value.map(canonicalize)];
      return ['object', Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])])];
    }
    default:
      return [typeof value];
  }
}
