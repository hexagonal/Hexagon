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

/**
 * The one line `Show<Exn>` gives for a failure (`stdlib/Exn.hex`), which is the
 * line the results pane shows for an uncaught throw: the thrown value's `name`
 * and `message` with `": "` between, or whichever is not empty. So an
 * exception with a `message` slot reads `BadPattern: missing )`, one without
 * reads `Oops`, and a foreign error reads `TypeError: x is not a function`.
 *
 * It reads the value as `Show<Exn>` reads it, so that the pane says what a
 * program printing the same failure would say. Each read is guarded: a getter
 * that throws, an absent property, and a value that is not a string all read
 * as `""`. (`Show<Exn>` also keeps each read for the life of the program, and
 * this reads afresh, so only a foreign getter that answers differently each
 * time could make the two disagree.) A value that bears no properties (a thrown string,
 * `null`, a symbol) is `String(value)`. No `toString` of the value's own is
 * ever reached, so an exception with a `toString` slot still reads as its name
 * and message, and describing a failure never throws a second one.
 */
export function describeFailure(thrown: unknown): string {
  const error = withoutJsErrorWrapper(thrown);
  if (!bearsProperties(error)) return String(error);
  const name = readString(error, "name");
  const message = readString(error, "message");
  if (name === "") return message;
  if (message === "") return name;
  return `${name}: ${message}`;
}

/**
 * A `JsError(v)` built in Hexagon and thrown later is the one throw that arrives
 * wrapped (`spec/exceptions.md` §6.2), and `Show<Exn>` describes the `v` inside,
 * as a `JsError(e)` catch arm would see it. The brand is the emitter's.
 */
function withoutJsErrorWrapper(thrown: unknown): unknown {
  return bearsProperties(thrown) &&
      guardedRead(thrown, "$hex") === "Hex.JsError" &&
      guardedRead(thrown, "name") === "JsError"
    ? guardedRead(thrown, "error")
    : thrown;
}

function bearsProperties(value: unknown): value is object {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function readString(value: object, property: string): string {
  const read = guardedRead(value, property);
  return typeof read === "string" ? read : "";
}

function guardedRead(value: object, property: string): unknown {
  try {
    return (value as Record<string, unknown>)[property];
  } catch {
    return undefined;
  }
}
