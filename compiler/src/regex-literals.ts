/**
 * *(#1468, `regex.md` §8.)* Literal patterns run while the program is compiled.
 *
 * A string literal with no interpolation handed to `Hex.Regex`'s `compile` is
 * run by the compiler, through the program's own emitted `Hex.Regex` and the
 * modules beneath it: the same parser and the same constructor the call runs. A
 * literal `compile` refuses is reported at the codepoint its position names; one
 * it accepts is written into the emitted module as the `Regex` it built, as
 * JavaScript data (§7, §9).
 *
 * The emitted modules are ES modules, which a host can only load
 * asynchronously, and `compileProject` is synchronous. So this module links
 * them itself: each module's import lines become reads of modules it has
 * already evaluated, and its export lines become getters, and the text is
 * evaluated as a function body. The emitted graph is acyclic, and its import
 * and export lines are the few single-line forms the emitter writes; any other
 * is a compiler defect, and is thrown as one.
 */
import type * as Emitted from "./emission/index.js";
import type * as Diagnostics from "./support/diagnostics.js";
import type * as Source from "./support/source.js";

/** One emitted file, by its `.js` path from the output root. */
export interface LinkedText {
  readonly path: string;
  readonly text: string;
}

/** What `compile` did with one literal. */
export type RegexLiteralOutcome =
  | { readonly kind: "built"; readonly write: (vectorOf: string) => string }
  | { readonly kind: "refused"; readonly message: string; readonly position: number };

/** The program's `Hex.Regex`, linked and ready to run literals. */
export interface RegexBuilder {
  run(pattern: string): RegexLiteralOutcome;
}

const MEMO_LIMIT = 1024;

/**
 * Links `texts` from `regexPath` down and answers a builder over its `compile`.
 * `vectorTriePath` is the vector trie's emitted file, whose iteration method is
 * what tells a vector apart from the plain objects around it.
 */
export function linkRegexBuilder(
  texts: readonly LinkedText[],
  regexPath: string,
  vectorTriePath: string,
): RegexBuilder {
  const load = linkModules(new Map(texts.map(({ path, text }) => [path, text])));
  const regex = load(regexPath);
  const compile = regex["compile"] as ((pattern: string) => unknown) | undefined;
  if (typeof compile !== "function") {
    throw new Error(`compiler defect: ${regexPath} exports no \`compile\` to run literal patterns with`);
  }
  const trie = load(vectorTriePath);
  const empty = trie["empty"] as Record<PropertyKey, unknown> | undefined;
  const vectorIterate = empty?.[Symbol.iterator];
  if (typeof vectorIterate !== "function") {
    throw new Error(`compiler defect: ${vectorTriePath} exports no \`empty\` vector to recognise vectors by`);
  }
  const memo = new Map<string, RegexLiteralOutcome>();
  return {
    run(pattern) {
      const known = memo.get(pattern);
      if (known !== undefined) return known;
      let outcome: RegexLiteralOutcome;
      try {
        const built = compile(pattern);
        // Printed at once, before anything can search the value and fill its
        // memos: the constant is the storage the build filled (`regex.md` §7).
        const write = printer(built, vectorIterate);
        outcome = { kind: "built", write };
      } catch (error) {
        const fault = error as { readonly name?: unknown; readonly message?: unknown; readonly position?: unknown };
        if (
          fault === null || typeof fault !== "object" || fault.name !== "RegexCompileFault" ||
          typeof fault.message !== "string" || typeof fault.position !== "number"
        ) {
          throw error;
        }
        const suffix = ` (position: ${fault.position})`;
        const message = fault.message.endsWith(suffix)
          ? fault.message.slice(0, -suffix.length)
          : fault.message;
        outcome = { kind: "refused", message, position: fault.position };
      }
      if (memo.size >= MEMO_LIMIT) memo.delete(memo.keys().next().value!);
      memo.set(pattern, outcome);
      return outcome;
    },
  };
}

// ---------------------------------------------------------------------------
// Linking

function resolvePath(from: string, specifier: string): string {
  const parts: string[] = [];
  for (const part of `${from.slice(0, from.lastIndexOf("/"))}/${specifier}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

const IMPORT_ALL = /^import \* as ([\w$]+) from "([^"]+)";$/u;
const IMPORT_NAMES = /^import \{([^}]*)\} from "([^"]+)";$/u;
const IMPORT_BARE = /^import "([^"]+)";$/u;
const EXPORT_NAMES = /^export \{([^}]*)\};$/u;
const EXPORT_CONST = /^export const ([\w$]+) = /u;
const MODULE_SYNTAX = /^\s*(import|export)\b/u;

/**
 * One emitted module as a function body: its imports, which a module hoists,
 * read first, and each export a getter over its local, which is what a module
 * binding is to its importers once the module has run.
 */
function functionBody(path: string, text: string): string {
  const imports: string[] = [];
  const load = (specifier: string) => `__load(${JSON.stringify(resolvePath(path, specifier))})`;
  const names = (list: string) => list.split(",").map((name) => name.trim()).filter((name) => name !== "");
  const body = text.split("\n").map((line) => {
    let match: RegExpExecArray | null;
    if ((match = IMPORT_ALL.exec(line)) !== null) {
      imports.push(`const ${match[1]} = ${load(match[2]!)};`);
      return "";
    }
    if ((match = IMPORT_NAMES.exec(line)) !== null) {
      const bindings = names(match[1]!).map((name) => name.replace(/^(\S+) as (\S+)$/u, "$1: $2"));
      imports.push(`const { ${bindings.join(", ")} } = ${load(match[2]!)};`);
      return "";
    }
    if ((match = IMPORT_BARE.exec(line)) !== null) {
      imports.push(`${load(match[1]!)};`);
      return "";
    }
    if ((match = EXPORT_NAMES.exec(line)) !== null) {
      return names(match[1]!).map((name) => {
        const [local, exported = local] = name.split(/ as /u);
        return `__export(${JSON.stringify(exported)}, () => ${local});`;
      }).join(" ");
    }
    if ((match = EXPORT_CONST.exec(line)) !== null) {
      return `${line.replace(/^export const/u, "const")} __export(${JSON.stringify(match[1])}, () => ${match[1]});`;
    }
    if (MODULE_SYNTAX.test(line)) {
      throw new Error(`compiler defect: ${path} has module syntax the literal-pattern linker cannot read: ${line}`);
    }
    return line;
  }).join("\n");
  return `${imports.join("\n")}\n${body}`;
}

function linkModules(texts: ReadonlyMap<string, string>): (path: string) => Record<string, unknown> {
  const loaded = new Map<string, Record<string, unknown>>();
  const load = (path: string): Record<string, unknown> => {
    const done = loaded.get(path);
    if (done !== undefined) return done;
    const text = texts.get(path);
    if (text === undefined) {
      throw new Error(`compiler defect: the literal-pattern linker found no emitted module at ${path}`);
    }
    const exports: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    loaded.set(path, exports);
    const define = (name: string, read: () => unknown) =>
      Object.defineProperty(exports, name, { get: read, enumerable: true });
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function("__load", "__export", functionBody(path, text)) as (
      load: (path: string) => Record<string, unknown>,
      define: (name: string, read: () => unknown) => void,
    ) => void;
    run(load, define);
    return exports;
  };
  return load;
}

// ---------------------------------------------------------------------------
// Printing

/**
 * The value `compile` built, as a JavaScript expression that builds it again:
 * records and union values as object literals, buffers and tuples as array
 * literals with their holes, each vector through the module's vector
 * construction, and strings, numbers and booleans as themselves.
 *
 * Only a buffer is mutable, so only an array reached twice is bound once and
 * shared; an object reached twice is written twice, which no program can tell
 * apart (Unions §6.1). Anything else — a function, a `Map`'s trie, a class
 * instance — is a compiler defect, since a program has none.
 */
function printer(root: unknown, vectorIterate: unknown): (vectorOf: string) => string {
  const isVector = (value: object): boolean =>
    Object.hasOwn(value, Symbol.iterator) &&
    (value as Record<PropertyKey, unknown>)[Symbol.iterator] === vectorIterate;
  const arrays = new Map<unknown, number>();
  const path = new Set<unknown>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (path.has(value)) throw new Error("compiler defect: a built `Regex` holds a cycle");
    if (Array.isArray(value)) {
      const seen = arrays.get(value) ?? 0;
      arrays.set(value, seen + 1);
      if (seen > 0) return;
    }
    path.add(value);
    if (isVector(value)) {
      for (const element of value as Iterable<unknown>) visit(element);
    } else {
      check(value);
      for (const key of Object.keys(value)) visit((value as Record<string, unknown>)[key]);
    }
    path.delete(value);
  };
  const check = (value: object): void => {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) throw new Error("compiler defect: a built `Regex` holds an array subclass");
      if (Object.keys(value).some((key) => !/^(?:0|[1-9]\d*)$/u.test(key))) {
        throw new Error("compiler defect: a built `Regex` holds an array with named keys");
      }
    } else if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("compiler defect: a built `Regex` holds an object that is not plain data");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error("compiler defect: a built `Regex` holds a collection it cannot write, such as a `Map`");
    }
  };
  visit(root);
  // Printed once now, so that a value no printer can write is reported where
  // it was built rather than when the module is written.
  print(root, "__vectorOf");
  return (vectorOf) => print(root, vectorOf);

  function print(value: unknown, vectorOf: string): string {
    const shared = new Map<unknown, string>();
    const bindings: string[] = [];
    const leaf = (item: unknown): string => {
      switch (typeof item) {
        case "string":
          return JSON.stringify(item);
        case "number":
          if (!Number.isFinite(item)) throw new Error("compiler defect: a built `Regex` holds a number it cannot write");
          return Object.is(item, -0) ? "-0" : String(item);
        case "boolean":
          return String(item);
        case "undefined":
          return "undefined";
        default:
          if (item === null) return "null";
          throw new Error(`compiler defect: a built \`Regex\` holds a ${typeof item} it cannot write`);
      }
    };
    const key = (name: string) => (/^[A-Za-z_$][\w$]*$/u.test(name) ? name : JSON.stringify(name));
    // The record and its program one field to a line; everything below them on
    // the line of its field.
    const write = (item: unknown, depth: number): string => {
      if (item === null || typeof item !== "object") return leaf(item);
      const bound = shared.get(item);
      if (bound !== undefined) return bound;
      let text: string;
      if (isVector(item)) {
        text = `${vectorOf}([${[...(item as Iterable<unknown>)].map((element) => write(element, depth + 1)).join(", ")}])`;
      } else if (Array.isArray(item)) {
        const elements: string[] = [];
        for (let index = 0; index < item.length; index += 1) {
          elements.push(Object.hasOwn(item, index) ? write(item[index], depth + 1) : "");
        }
        const trailingHole = item.length > 0 && !Object.hasOwn(item, item.length - 1);
        text = `[${elements.join(", ")}${trailingHole ? "," : ""}]`;
      } else {
        const fields = Object.keys(item).map((name) =>
          `${key(name)}: ${write((item as Record<string, unknown>)[name], depth + 1)}`
        );
        if (Object.getPrototypeOf(item) === null) fields.unshift("__proto__: null");
        if (fields.length === 0) text = "{}";
        else if (depth < 2) {
          const indent = "  ".repeat(depth + 1);
          text = `{\n${fields.map((field) => `${indent}${field},`).join("\n")}\n${"  ".repeat(depth)}}`;
        } else text = `{ ${fields.join(", ")} }`;
      }
      if (Array.isArray(item) && (arrays.get(item) ?? 0) > 1) {
        const name = `__shared${bindings.length}`;
        bindings.push(`${name} = ${text}`);
        shared.set(item, name);
        return name;
      }
      return text;
    };
    const body = write(value, 0);
    return bindings.length === 0 ? body : `(() => { const ${bindings.join(", ")}; return ${body}; })()`;
  }
}

// ---------------------------------------------------------------------------
// Reporting

/**
 * Each codepoint of the string literal at `span`, as the source text that
 * writes it (Lexer §6.2): one character, a surrogate pair, a whole escape
 * sequence, or a line break, `\r\n` included. `undefined` where the span does
 * not hold a plain string literal.
 */
export function literalCodepoints(
  text: string,
  start: number,
  end: number,
): { readonly codepoints: readonly (readonly [number, number])[]; readonly closing: number } | undefined {
  if (text[start] !== "\"" || text[end - 1] !== "\"" || end - start < 2) return undefined;
  const codepoints: (readonly [number, number])[] = [];
  let offset = start + 1;
  const closing = end - 1;
  while (offset < closing) {
    const from = offset;
    const unit = text[offset]!;
    if (unit === "\\") {
      const next = text[offset + 1];
      if (next === "u" && text[offset + 2] === "{") {
        const close = text.indexOf("}", offset + 3);
        if (close < 0 || close >= closing) return undefined;
        offset = close + 1;
      } else {
        offset += 2;
      }
    } else if (unit === "\r" && text[offset + 1] === "\n") {
      offset += 2;
    } else {
      const point = text.codePointAt(offset)!;
      offset += point > 0xffff ? 2 : 1;
    }
    codepoints.push([from, offset]);
  }
  return offset === closing ? { codepoints, closing } : undefined;
}

/**
 * A parser message with every spelling it quotes written as a string literal's
 * source writes it (regex.md §8, Lexer §6.2): the pattern's `\\` is the
 * source's `\\\\`. The parser's prose holds none of the codepoints rewritten
 * here, so the whole message can be rewritten rather than its quoted spans,
 * which a quoted backtick would make ambiguous.
 */
export function sourceSpelling(message: string): string {
  let written = "";
  const codepoints = [...message];
  for (const [index, point] of codepoints.entries()) {
    const next = codepoints[index + 1];
    if (point === "\\") written += "\\\\";
    else if (point === '"') written += '\\"';
    else if (point === "\n") written += "\\n";
    else if (point === "\t") written += "\\t";
    else if (point === "\r") written += "\\r";
    else if ((point === "$" || point === "#") && next === "{") written += "\\" + point;
    else if (/^\p{Cc}$/u.test(point)) written += `\\u{${point.codePointAt(0)!.toString(16).toUpperCase()}}`;
    else written += point;
  }
  return written;
}

/**
 * The report for a literal `compile` refuses (`regex.md` §8): §2.9's message,
 * on the codepoint its position names, or on the closing quote for a pattern
 * that ended early.
 */
export function refusedLiteral(
  file: Source.File,
  site: Emitted.RegexLiteralSite,
  message: string,
  position: number,
): Diagnostics.Diagnostic {
  const located = literalCodepoints(file.text, site.span.start.offset, site.span.end.offset);
  const primary = located === undefined
    ? site.span
    : position >= 1 && position <= located.codepoints.length
    ? file.span(located.codepoints[position - 1]![0], located.codepoints[position - 1]![1])
    : file.span(located.closing, located.closing + 1);
  return {
    severity: "error",
    message: sourceSpelling(message),
    primary,
    notes: [
      "a pattern written as a literal is checked when the program is compiled",
    ],
  };
}
