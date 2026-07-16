/** Formats console arguments deterministically before crossing the worker boundary. */
export function formatConsoleArguments(values: readonly unknown[]): string {
  return values.map((value) => formatConsoleValue(value, new WeakSet(), 0)).join(" ");
}

function formatConsoleValue(
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
): string {
  if (typeof value === "string") return value;
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "function") return `[Function${value.name === "" ? "" : `: ${value.name}`}]`;
  if (depth >= 4) return "[…]";
  if (ancestors.has(value)) return "[Circular]";

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) =>
        formatConsoleValue(item, ancestors, depth + 1)
      ).join(", ")}]`;
    }
    return `{${Object.entries(value).map(([key, item]) =>
      `${key}: ${formatConsoleValue(item, ancestors, depth + 1)}`
    ).join(", ")}}`;
  } catch {
    return Object.prototype.toString.call(value);
  } finally {
    ancestors.delete(value);
  }
}
