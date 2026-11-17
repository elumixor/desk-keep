/**
 * What this device remembers, in `localStorage`, which a private window or blocked storage may refuse: a read refused
 * is nothing stored, a write refused is only warned about.
 */
export function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** A value kept as JSON; `fallback` when there is none or it cannot be read. */
export function storedJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : (JSON.parse(value) as T);
  } catch {
    return fallback;
  }
}

export function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn("[keep] could not remember", key, error);
  }
}

export const storeJson = (key: string, value: unknown) => store(key, JSON.stringify(value));
