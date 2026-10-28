// src/core/storage.ts
// Type-safe localStorage adapter with fallback protection

export function safeJSONParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(key)
      : null;
    return safeJSONParse<T>(raw, fallback);
  } catch {
    return fallback;
  }
}

export function saveToStorage<T>(key: string, value: T): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  } catch (err) {
    console.warn(`[Storage] Failed to save key "${key}":`, err);
  }
}

export function removeFromStorage(key: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch (err) {
    console.warn(`[Storage] Failed to remove key "${key}":`, err);
  }
}
