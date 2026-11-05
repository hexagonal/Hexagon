export const sourceStorageKey = "hexagon.playground.source";
export const inputStorageKey = "hexagon.playground.input";

export interface SourceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Reads persisted source without making restricted storage fatal to startup. */
export function readStoredSource(storage: SourceStorage): string | undefined {
  return readStored(storage, sourceStorageKey);
}

/** Persists the current source when the host makes storage available. */
export function writeStoredSource(storage: SourceStorage, source: string): void {
  writeStored(storage, sourceStorageKey, source);
}

/** Reads the persisted input box's text, as `readStoredSource` reads source. */
export function readStoredInput(storage: SourceStorage): string | undefined {
  return readStored(storage, inputStorageKey);
}

/** Persists the input box's text, as `writeStoredSource` persists source. */
export function writeStoredInput(storage: SourceStorage, input: string): void {
  writeStored(storage, inputStorageKey, input);
}

function readStored(storage: SourceStorage, key: string): string | undefined {
  try {
    return storage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStored(storage: SourceStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // The current editor session remains usable without persistent storage.
  }
}
