// Per-device preferences in localStorage. Storage can be blocked (private mode, disabled site
// data), so every access is guarded: reads fall back, writes are silently dropped and the
// choice just isn't remembered.

export function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Stores `value`, or removes the key when it is null. */
export function writeString(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable
  }
}

/**
 * Reads a JSON value and passes it through `sanitize`, which must turn anything (missing,
 * old or hand-edited data) into a valid value. Missing or unparsable data arrives as null.
 */
export function readJson<T>(key: string, sanitize: (raw: unknown) => T): T {
  const raw = readString(key);
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    // corrupt value: treat as missing
  }
  return sanitize(parsed);
}

export function writeJson(key: string, value: unknown) {
  writeString(key, JSON.stringify(value));
}
