export const sourceStorageKey = "hexagon.playground.source";

export interface SourceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Reads persisted source without making restricted storage fatal to startup. */
export function readStoredSource(storage: SourceStorage): string | undefined {
  try {
    return storage.getItem(sourceStorageKey) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Persists the current source when the host makes storage available. */
export function writeStoredSource(storage: SourceStorage, source: string): void {
  try {
    storage.setItem(sourceStorageKey, source);
  } catch {
    // The current editor session remains usable without persistent storage.
  }
}
