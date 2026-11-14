/**
 * toPlain — strip reactivity before anything reaches IndexedDB.
 *
 * Why this exists: blocks/notes are read through `liveQuery → ref`, which makes them DEEPLY
 * reactive, so `block.props.rows` is a Vue **Proxy**, not a plain array. IndexedDB stores values
 * with the structured clone algorithm, and structuredClone cannot clone a Proxy — it throws
 *     DataCloneError: Proxy object could not be cloned.
 * A component that echoes a slice of its own props back into a write (e.g. the table sending
 * `rows` straight back) would fail silently-ish at the DB layer.
 *
 * Rebuilding the value as plain objects/arrays reads *through* any proxy and yields clone-safe
 * data. Done in the service layer (the one write path) so no component has to remember it.
 * Binary/date values are passed through by identity — they're already clone-safe.
 */
export function toPlain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Blob || value instanceof Date || value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) return value;
  if (Array.isArray(value)) return value.map((v) => toPlain(v)) as unknown as T;

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = toPlain((value as Record<string, unknown>)[key]);
  }
  return out as T;
}
