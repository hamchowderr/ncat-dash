/**
 * Small things this browser keeps between visits (the calendar's view, a guest's name on a
 * shared review), under keys that start with the product's name.
 */
const PREFIX = "takewon:";
/** The prefix the same keys had before the app was renamed. Read once, then moved over. */
const OLD_PREFIX = "ncat-dash:";

/** The full browser-storage key for one setting. */
export function storedKey(name: string) {
  return PREFIX + name;
}

/**
 * The saved value, or null. A value saved under the old key is moved to the new one, so
 * nobody loses a choice they made before the rename.
 */
export function readStored(name: string): string | null {
  const storage = window.localStorage;
  const value = storage.getItem(storedKey(name));
  if (value !== null) return value;
  const old = storage.getItem(OLD_PREFIX + name);
  if (old === null) return null;
  try {
    storage.setItem(storedKey(name), old);
    storage.removeItem(OLD_PREFIX + name);
  } catch {
    // Storage full or blocked: the old value still answers this time.
  }
  return old;
}

export function writeStored(name: string, value: string) {
  window.localStorage.setItem(storedKey(name), value);
}
