import type { RecordId } from "./tree.js";

export * from "./tree.js";

export function recordId(value: number): RecordId {
  return value as RecordId;
}
