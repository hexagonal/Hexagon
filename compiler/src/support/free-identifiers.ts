/**
 * The **free identifiers** of a piece of emitted JavaScript — every name it
 * reads that nothing in it binds, which for emitted text is exactly its set of
 * global references.
 *
 * Written for FFI Part 7 §1.2's tripwire, which asserts that the globals the
 * emitter's own text names are a subset of the single-sourced runtime
 * vocabulary. That assertion is only worth the scanner behind it, so this is a
 * lexer rather than a set of substring probes: a `"Map.empty"` inside a derived
 * `show` body is a string, `__error.name` is a property, `{ start: __start }`
 * names a key, and each of the three would be a false global to a grep.
 *
 * It is deliberately **not** a JavaScript parser. It reads the narrow, regular
 * dialect this compiler emits — no `with`, no labels, no `eval`, no regular
 * expression literals, every generated local under Lexer §3.2's `__` prefix —
 * and the tripwire's own self-test is what keeps it honest: it feeds the scanner
 * a body naming a global that is *not* in the vocabulary and asserts the scanner
 * reports it. A scanner that could not fail would assert nothing.
 */
export function freeIdentifiers(javascript: string): ReadonlySet<string> {
  // Comment and string text are blanked in place rather than removed, so a
  // `${…}` substitution inside a template literal is still scanned as the code
  // it is — `String(__key)` in the map bracket's message lives there.
  const scanned = blankInert(javascript);
  const bound = boundNames(scanned);
  // An `export`/`import` clause names bindings and module-side names, never a
  // global: a clause naming an unbound identifier is a `SyntaxError`, so nothing
  // in one can be a global reference. `import * as X` is read for its binding
  // above, before this blanks the named clauses.
  const code = scanned.replace(
    /\b(?:export|import)\s*\{[^}]*\}/gu,
    (clause) => " ".repeat(clause.length),
  );
  const free = new Set<string>();
  for (const match of code.matchAll(IDENTIFIER)) {
    const name = match[0];
    const at = match.index;
    if (JAVASCRIPT_WORDS.has(name) || bound.has(name)) continue;
    // Not the tail of a numeric literal: `0x0f0f0f0f` is one token, whose `x…`
    // suffix matches the identifier pattern on its own.
    if (/[0-9A-Za-z_$]/u.test(code[at - 1] ?? "")) continue;
    // Scanned character by character rather than by slicing the text on either
    // side: the corpus this runs over is whole emitted modules, and a slice per
    // identifier makes the pass quadratic in the file's length.
    const before = significantBefore(code, at);
    // A member name, never a reference: `Math.imul`, `__error.name`.
    if (before === ".") continue;
    // An object-literal key. The opening delimiter is what separates it from a
    // conditional's alternative, whose colon is preceded by an expression.
    if (
      significantAfter(code, at + name.length) === ":" && (before === "{" || before === ",")
    ) continue;
    free.add(name);
  }
  return free;
}

const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/gu;

/** The last non-whitespace character before `at`, or `""` at the start of the text. */
function significantBefore(code: string, at: number): string {
  for (let index = at - 1; index >= 0; index -= 1) {
    const scalar = code[index]!;
    if (!/\s/u.test(scalar)) return scalar;
  }
  return "";
}

/** The first non-whitespace character at or after `at`, or `""` at the end. */
function significantAfter(code: string, at: number): string {
  for (let index = at; index < code.length; index += 1) {
    const scalar = code[index]!;
    if (!/\s/u.test(scalar)) return scalar;
  }
  return "";
}

/**
 * JavaScript's keywords and literal names, which are not identifiers at all —
 * plus the contextual words the emitted dialect uses in keyword position
 * (`of`, `as`, `from`) and `this`, which binds itself.
 */
const JAVASCRIPT_WORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "of",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "set",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

/**
 * Every name the text binds, gathered by binding form rather than by scope.
 *
 * Scope is deliberately ignored: the question is whether a name is *ever* bound
 * here, and a global the emitter references is bound nowhere. Over-gathering
 * would hide a global — which is why the self-test exists — and the forms below
 * are the complete list the emitted dialect uses.
 */
function boundNames(code: string): ReadonlySet<string> {
  const bound = new Set<string>();
  const addAll = (list: string): void => {
    for (const match of list.matchAll(IDENTIFIER)) {
      if (!JAVASCRIPT_WORDS.has(match[0])) bound.add(match[0]);
    }
  };
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gu)) {
    bound.add(match[1]!);
  }
  for (const match of code.matchAll(/\b(?:const|let|var)\s*(\[[^\]]*\]|\{[^}]*\})/gu)) {
    addAll(match[1]!);
  }
  for (
    const match of code.matchAll(
      /\bfunction\s*\*?\s*([A-Za-z_$][A-Za-z0-9_$]*)?\s*\(([^)]*)\)/gu,
    )
  ) {
    if (match[1] !== undefined) bound.add(match[1]);
    addAll(match[2]!);
  }
  for (const match of code.matchAll(/\bcatch\s*\(([^)]*)\)/gu)) addAll(match[1]!);
  for (const match of code.matchAll(/\(([^()]*)\)\s*=>/gu)) addAll(match[1]!);
  for (const match of code.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/gu)) bound.add(match[1]!);
  for (const match of code.matchAll(/\bimport\s+\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/gu)) {
    bound.add(match[1]!);
  }
  for (const match of code.matchAll(/\bimport\s*\{([^}]*)\}/gu)) {
    for (const specifier of match[1]!.split(",")) {
      const names = [...specifier.matchAll(IDENTIFIER)].map(({ 0: name }) => name);
      const local = names.at(-1);
      if (local !== undefined) bound.add(local);
    }
  }
  return bound;
}

/**
 * The same text with every comment and string *blanked to spaces* — offsets and
 * line breaks preserved, so a reported position still points where it did.
 *
 * Exported for the reader that wants to ask a question of the code alone rather
 * than of the free names: a module specifier is a string, a tag is a string, and
 * a bare-spelling sweep run over the raw text would find `"./String.js"`.
 * `${…}` substitutions survive, because those are code.
 */
export function codeOnly(javascript: string): string {
  return blankInert(javascript);
}

/** Replaces comment and string text with spaces, preserving every offset. */
function blankInert(text: string): string {
  const out = [...text];
  const blank = (from: number, to: number): void => {
    for (let index = from; index < to; index += 1) {
      if (out[index] !== "\n") out[index] = " ";
    }
  };
  /** Blanks template text from `index`, stopping at the closing tick or `${`. */
  const template = (index: number): { readonly next: number; readonly closed: boolean } => {
    let at = index;
    while (at < text.length) {
      if (text[at] === "\\") {
        blank(at, at + 2);
        at += 2;
        continue;
      }
      if (text[at] === "`") {
        blank(at, at + 1);
        return { next: at + 1, closed: true };
      }
      if (text[at] === "$" && text[at + 1] === "{") {
        blank(at, at + 1);
        return { next: at + 2, closed: false };
      }
      blank(at, at + 1);
      at += 1;
    }
    return { next: at, closed: true };
  };

  let index = 0;
  let templateDepth = 0;
  while (index < text.length) {
    const scalar = text[index];
    if (scalar === "/" && text[index + 1] === "/") {
      const end = text.indexOf("\n", index);
      const stop = end === -1 ? text.length : end;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (scalar === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (scalar === '"' || scalar === "'") {
      let at = index + 1;
      while (at < text.length && text[at] !== scalar) at += text[at] === "\\" ? 2 : 1;
      blank(index, Math.min(at + 1, text.length));
      index = at + 1;
      continue;
    }
    if (scalar === "`") {
      blank(index, index + 1);
      const { next, closed } = template(index + 1);
      if (!closed) templateDepth += 1;
      index = next;
      continue;
    }
    // The `}` that closes a substitution returns to template text. Emitted
    // objects never sit directly inside one, so no `}` of an object literal is
    // mistaken for it.
    if (scalar === "}" && templateDepth > 0) {
      const { next, closed } = template(index + 1);
      if (closed) templateDepth -= 1;
      index = next;
      continue;
    }
    index += 1;
  }
  return out.join("");
}
