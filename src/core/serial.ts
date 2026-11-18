/**
 * Serialisation, cloning and hashing of plain-JSON game state.
 * Key order is insertion order, which is deterministic as long as the sim
 * always creates objects with the same shape (createMatch initialises every field).
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

export function serializeJson<T>(v: T): Uint8Array {
  return enc.encode(JSON.stringify(v));
}

export function deserializeJson<T>(bytes: Uint8Array): T {
  return JSON.parse(dec.decode(bytes)) as T;
}

/**
 * Deep copy of plain data. structuredClone preserves property insertion order, so
 * hashes of clones match the original (verified by tests). Falls back to JSON.
 */
const sc: (<T>(v: T) => T) | undefined = (globalThis as { structuredClone?: <T>(v: T) => T }).structuredClone;
export function cloneJson<T>(v: T): T {
  return sc ? sc(v) : (JSON.parse(JSON.stringify(v)) as T);
}

/** 32-bit FNV-1a over bytes */
export function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashJson<T>(v: T): number {
  return fnv1a(serializeJson(v));
}
