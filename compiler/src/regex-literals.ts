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

/**
 * A rewrite a refusal names, as `Regex.Syntax` builds it (`regex.md` §2.9): its
 * words, and its edits over the pattern's 1-based codepoints, `end` exclusive.
 */
export interface RegexRewrite {
  readonly title: string;
  readonly edits: readonly { readonly start: number; readonly end: number; readonly text: string }[];
}

/** What `compile` did with one literal. */
export type RegexLiteralOutcome =
  | { readonly kind: "built"; readonly write: (vectorOf: string, array: string) => string }
  | {
    readonly kind: "refused";
    readonly message: string;
    readonly position: number;
    readonly rewrites: readonly RegexRewrite[];
  };

/**
 * One capturing group of a literal pattern, as `Regex.Syntax` reads it
 * (`regex.md` §5): its number, its name, and where it is written.
 */
export interface RegexGroup {
  /** The number `Regex.group` reads it by. */
  readonly index: number;
  /** Its name, where the pattern names it. */
  readonly name?: string;
  /** Its `(`'s 1-based codepoint position in the pattern. */
  readonly start: number;
  /** Its codepoint count, from its `(` through its `)`. */
  readonly length: number;
}

/** The program's `Hex.Regex`, linked and ready to run literals. */
export interface RegexBuilder {
  run(pattern: string): RegexLiteralOutcome;
  /**
   * The capturing groups of `pattern` in group order, as the program's own
   * `Regex.Syntax` parses it; `undefined` for a pattern it refuses.
   */
  groups(pattern: string): readonly RegexGroup[] | undefined;
}

const MEMO_LIMIT = 1024;

/** The length from which an array holding one value throughout is written filled. */
const FILL_LENGTH = 16;

/**
 * Links `texts` from `regexPath` down and answers a builder over its `compile`.
 * `vectorTriePath` is the vector trie's emitted file, whose iteration method is
 * what tells a vector apart from the plain objects around it.
 */
export function linkRegexBuilder(
  texts: readonly LinkedText[],
  regexPath: string,
  vectorTriePath: string,
  syntaxPath: string,
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
  const groupMemo = new Map<string, readonly RegexGroup[] | undefined>();
  return {
    groups(pattern) {
      if (groupMemo.has(pattern)) return groupMemo.get(pattern);
      const parse = load(syntaxPath)["parse"] as ((pattern: string) => unknown) | undefined;
      if (typeof parse !== "function") {
        throw new Error(`compiler defect: ${syntaxPath} exports no \`parse\` to read a literal's groups with`);
      }
      let groups: readonly RegexGroup[] | undefined;
      try {
        groups = groupsOf(parse(pattern));
      } catch (error) {
        if ((error as { readonly name?: unknown } | null)?.name !== "RegexError") throw error;
        groups = undefined;
      }
      if (groupMemo.size >= MEMO_LIMIT) groupMemo.delete(groupMemo.keys().next().value!);
      groupMemo.set(pattern, groups);
      return groups;
    },
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
        const fault = error as {
          readonly name?: unknown;
          readonly message?: unknown;
          readonly position?: unknown;
          readonly rewrites?: unknown;
        };
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
        outcome = { kind: "refused", message, position: fault.position, rewrites: rewritesOf(fault.rewrites) };
      }
      if (memo.size >= MEMO_LIMIT) memo.delete(memo.keys().next().value!);
      memo.set(pattern, outcome);
      return outcome;
    },
  };
}

/**
 * A parsed `Pattern`'s groups as plain data: its `spans` in group order, each
 * named from its `names`, whose entries iterate as pairs. Any other shape is a
 * compiler defect, since the standard library's `Regex.Syntax` builds it.
 */
function groupsOf(parsed: unknown): readonly RegexGroup[] {
  const defect = () => new Error("compiler defect: `Regex.Syntax.parse` answered a pattern of a shape it cannot read");
  const each = (value: unknown): readonly unknown[] => {
    if (value === null || typeof value !== "object" || !(Symbol.iterator in value)) throw defect();
    return [...(value as Iterable<unknown>)];
  };
  const { spans, names } = (parsed ?? {}) as { readonly spans?: unknown; readonly names?: unknown };
  const named = new Map<number, string>();
  for (const entry of each(names)) {
    const [name, index] = Array.isArray(entry) ? entry as unknown[] : [];
    if (typeof name !== "string" || typeof index !== "number") throw defect();
    named.set(index, name);
  }
  return each(spans).map((span, at) => {
    const { start, length } = (span ?? {}) as { readonly start?: unknown; readonly length?: unknown };
    if (typeof start !== "number" || typeof length !== "number") throw defect();
    const name = named.get(at + 1);
    return { index: at + 1, ...(name === undefined ? {} : { name }), start, length };
  });
}

/**
 * The fault's rewrites as plain data. They are `Vector`s of records, which
 * iterate as JavaScript does; any other shape is a compiler defect, since the
 * standard library's `Regex.Syntax` is what builds them.
 */
function rewritesOf(value: unknown): readonly RegexRewrite[] {
  const defect = () => new Error("compiler defect: a `RegexCompileFault` carries rewrites of a shape it cannot read");
  const each = (vector: unknown): readonly unknown[] => {
    if (vector === null || typeof vector !== "object" || !(Symbol.iterator in vector)) throw defect();
    return [...(vector as Iterable<unknown>)];
  };
  return each(value).map((rewrite) => {
    const { title, edits } = (rewrite ?? {}) as { readonly title?: unknown; readonly edits?: unknown };
    if (typeof title !== "string") throw defect();
    return {
      title,
      edits: each(edits).map((edit) => {
        const { start, end, text } = (edit ?? {}) as { readonly start?: unknown; readonly end?: unknown; readonly text?: unknown };
        if (typeof start !== "number" || typeof end !== "number" || typeof text !== "string") throw defect();
        return { start, end, text };
      }),
    };
  });
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
 * literals, a long one every slot of which holds one value as that value
 * filled in, each vector through the module's vector construction, and
 * strings, numbers and booleans as themselves.
 *
 * Only a buffer is mutable, so only an array reached twice is bound once and
 * shared; an object reached twice is written twice, which no program can tell
 * apart (Unions §6.1). Anything else — a function, a `Map`'s trie, a class
 * instance — is a compiler defect, since a program has none.
 */
function printer(root: unknown, vectorIterate: unknown): (vectorOf: string, array: string) => string {
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
      if (Object.keys(value).length !== value.length) {
        throw new Error("compiler defect: a built `Regex` holds an array with holes");
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
  print(root, "__vectorOf", "Array");
  return (vectorOf, array) => print(root, vectorOf, array);

  function print(value: unknown, vectorOf: string, array: string): string {
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
        const first: unknown = item[0];
        const filled = item.length >= FILL_LENGTH && (first === null || typeof first !== "object") &&
          item.every((element: unknown) => Object.is(element, first));
        text = filled
          ? `new ${array}(${item.length}).fill(${leaf(first)})`
          : `[${item.map((element: unknown) => write(element, depth + 1)).join(", ")}]`;
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
 * that ended early, with each rewrite the message names as a fix on the
 * literal's source.
 */
export function refusedLiteral(
  file: Source.File,
  site: Emitted.RegexLiteralSite,
  message: string,
  position: number,
  rewrites: readonly RegexRewrite[] = [],
): Diagnostics.Diagnostic {
  if (site.span.fileId !== file.id) {
    throw new Error(`compiler defect: ${file.path} reports a literal pattern another file holds`);
  }
  const located = literalCodepoints(file.text, site.span.start.offset, site.span.end.offset);
  const primary = located === undefined
    ? site.span
    : position >= 1 && position <= located.codepoints.length
    ? file.span(located.codepoints[position - 1]![0], located.codepoints[position - 1]![1])
    : file.span(located.closing, located.closing + 1);
  const fixes = located === undefined ? [] : rewrites.map((rewrite) => ({
    message: sourceSpelling(rewrite.title),
    edits: rewrite.edits.map((edit) => sourceEdit(file, located, [...site.pattern], edit)),
  }));
  return {
    severity: "error",
    message: sourceSpelling(message),
    primary,
    notes: [
      "a pattern written as a literal is checked when the program is compiled",
    ],
    ...(fixes.length === 0 ? {} : { fixes }),
  };
}

/**
 * One edit of the pattern as an edit of the literal's source: its codepoints'
 * source text replaced by the new text spelled as the literal spells it. A `$`
 * or `#` and a `{` that the edit would bring together are spelled apart, as
 * `sourceSpelling` spells them within its text, so that the edit opens no
 * interpolation; where the one before the edit is written bare, the edit takes
 * it in and writes it again.
 */
function sourceEdit(
  file: Source.File,
  located: { readonly codepoints: readonly (readonly [number, number])[]; readonly closing: number },
  pattern: readonly string[],
  edit: RegexRewrite["edits"][number],
): Diagnostics.Edit {
  const offsetOf = (position: number): number =>
    position <= located.codepoints.length ? located.codepoints[position - 1]![0] : located.closing;
  let start = edit.start;
  let text = edit.text;
  const after = pattern[edit.end - 1];
  const before = pattern[start - 2];
  const opens = (point: string | undefined) => point === "$" || point === "#";
  if (opens(before) && (text + (after ?? "")).startsWith("{")) {
    const [from, to] = located.codepoints[start - 2]!;
    if (file.text.slice(from, to) === before) {
      start -= 1;
      text = before + text;
    }
  }
  const spelled = after === "{" && opens([...text].at(-1))
    ? sourceSpelling(`${text}{`).slice(0, -1)
    : sourceSpelling(text);
  return { span: file.span(offsetOf(start), offsetOf(edit.end)), replacement: spelled };
}
