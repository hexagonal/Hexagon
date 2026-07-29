import { describe, expect, test } from "vitest";

// @ts-expect-error Internal Monaco modules intentionally have no declaration files.
import { compile } from "monaco-editor/esm/vs/editor/standalone/common/monarch/monarchCompile.js";
// @ts-expect-error Internal Monaco modules intentionally have no declaration files.
import { MonarchTokenizer } from "monaco-editor/esm/vs/editor/standalone/common/monarch/monarchLexer.js";

import { hexagonLanguage, hexagonTokens } from "./monaco-language";

/**
 * Drives the real Monarch tokenizer over real Hexagon source, so these assertions are
 * what the Playground editor paints rather than what a regex looks like it should do.
 *
 * The families here are the same ones `editors/vscode/THEME-COLORS.md` documents; the
 * VS Code grammar is authoritative and Playground follows it.
 */
function tokenize(source: string): { text: string; token: string }[] {
  const lexer = compile(hexagonLanguage, hexagonTokens);
  const subscription = { dispose() {} };
  const tokenizer = new MonarchTokenizer(
    { getLanguageId: () => hexagonLanguage, getLanguageIdByMimeType: () => hexagonLanguage },
    { getColorTheme: () => ({ tokenTheme: {} }), onDidColorThemeChange: () => subscription },
    hexagonLanguage,
    lexer,
    {
      onDidChangeConfiguration: () => subscription,
      getValue: () => 20_000,
    },
  );

  const out: { text: string; token: string }[] = [];
  let state = tokenizer.getInitialState();
  for (const line of source.split("\n")) {
    const result = tokenizer.tokenize(line, true, state);
    result.tokens.forEach((token: { offset: number; type: string }, index: number) => {
      const end = index + 1 < result.tokens.length
        ? result.tokens[index + 1].offset
        : line.length;
      const text = line.slice(token.offset, end).trim();
      if (text !== "") out.push({ text, token: token.type });
    });
    state = result.endState;
  }
  return out;
}

const tokenOf = (source: string, text: string): string | undefined =>
  tokenize(source).find((entry) => entry.text === text)?.token;

const allTokensFor = (source: string, text: string): string[] =>
  tokenize(source).filter((entry) => entry.text === text).map((entry) => entry.token);

const nominal = `type.identifier.${hexagonLanguage}`;
const constraint = `type.constraint.${hexagonLanguage}`;
const callable = `entity.function.${hexagonLanguage}`;
const ordinary = `identifier.${hexagonLanguage}`;
const keyword = `keyword.${hexagonLanguage}`;

describe("type variables reach the nominal family in every type position", () => {
  test("a parameter annotation", () => {
    expect(allTokensFor("fun size(v: Vector(a)): Int = length(v)", "a")).toEqual([nominal]);
  });

  test("a bare parameter annotation and a result type", () => {
    const source = "fun identity(value: a): a = value";
    expect(allTokensFor(source, "a")).toEqual([nominal, nominal]);
    expect(tokenOf(source, "value")).toBe(ordinary);
  });

  test("a union payload", () => {
    const source = "export union Option(a) derives (Eq, Show) =\n    | Some(value: a)\n    | None";
    expect(allTokensFor(source, "a")).toEqual([nominal, nominal]);
    expect(tokenOf(source, "None")).toBe(nominal);
  });

  test("a record type's fields, with the field names left as terms", () => {
    const source = "record Pair(a, b) = {left: a, right: b}";
    expect(allTokensFor(source, "a")).toEqual([nominal, nominal]);
    expect(allTokensFor(source, "b")).toEqual([nominal, nominal]);
    expect(tokenOf(source, "left")).toBe(ordinary);
  });

  test("a type alias, header and right-hand side alike", () => {
    expect(allTokensFor("type Handler(a) = a -> Option(a)", "a")).toEqual([
      nominal,
      nominal,
      nominal,
    ]);
  });

  test("an angle-bracket binder", () => {
    expect(allTokensFor("export fun first<a>(values: Vector(a)): Option(a) = None", "a")).toEqual([
      nominal,
      nominal,
      nominal,
    ]);
  });
});

describe("annotations end where their surrounding syntax ends", () => {
  test("a right-hand side after the annotation stays ordinary", () => {
    const source = "let n: Int = compute(alpha, beta)";
    expect(tokenOf(source, "Int")).toBe(nominal);
    expect(tokenOf(source, "alpha")).toBe(ordinary);
    expect(tokenOf(source, "beta")).toBe(ordinary);
    expect(tokenOf(source, "compute")).toBe(callable);
  });

  test("a record literal uses `=` and is untouched", () => {
    const source = "let p = {left = 1, right = 2}";
    expect(tokenOf(source, "left")).toBe(ordinary);
    expect(tokenOf(source, "right")).toBe(ordinary);
  });

  test("`:=` is assignment, not an annotation", () => {
    expect(tokenOf("searching := False", "searching")).toBe(ordinary);
  });

  test("a match arm's body is not a type", () => {
    const source = "match x\n    | Some(v) => v\n    | None => 0";
    expect(allTokensFor(source, "v")).toEqual([ordinary, ordinary]);
  });
});

describe("a type context never outlives its line", () => {
  // Monarch has no way to observe end of line, so every one of these would repaint
  // the whole rest of the file if the states did not reset at the next line's start.
  test("an ordinary line after an annotated line is unaffected", () => {
    const source = "let n: Int\nlet m = compute(alpha)";
    expect(tokenOf(source, "m")).toBe(ordinary);
    expect(tokenOf(source, "compute")).toBe(callable);
    expect(tokenOf(source, "alpha")).toBe(ordinary);
    expect(allTokensFor(source, "let")).toEqual([keyword, keyword]);
  });

  test("an extern block's later members keep their own scopes", () => {
    // spec/ffi-part5-extern-classes.md §3.1, verbatim.
    const source = [
      'extern from "web-response"',
      "    export type Response",
      "",
      "    export get status(response: Response): Int",
      "    export get headers(response: Response): Headers",
    ].join("\n");
    expect(allTokensFor(source, "export")).toEqual([keyword, keyword, keyword]);
    expect(tokenOf(source, "headers")).toBe(callable);
    expect(allTokensFor(source, "Response")).toEqual([nominal, nominal, nominal]);
  });

  test("an indented implied type member does not swallow its block", () => {
    // Collections Part 2 §5.1/§5.3: `type Item = a` is legal inside an `honor` block.
    const source = [
      "honor<a> Iterable<Bag(a)> =",
      "    type Item = a",
      "    iterate(xs) = Bag.toSeq(xs)",
      "    other(ys) = length(ys)",
    ].join("\n");
    expect(tokenOf(source, "iterate")).toBe(callable);
    expect(tokenOf(source, "xs")).toBe(ordinary);
    expect(tokenOf(source, "other")).toBe(callable);
    expect(tokenOf(source, "ys")).toBe(ordinary);
  });

  test("an unterminated derives list does not leak", () => {
    const source = "record P derives (Eq\nlet after = compute(1)";
    expect(tokenOf(source, "let")).toBe(keyword);
    expect(tokenOf(source, "after")).toBe(ordinary);
    expect(tokenOf(source, "compute")).toBe(callable);
  });
});

describe("constraints and callables", () => {
  test("a parameterized instance head names its constraint", () => {
    // spec/constraints.md §4.3 — must agree with the TextMate grammar.
    const source = 'honor<a: Show> Show<Vector(a)> =\n    show(xs) = "x"';
    expect(allTokensFor(source, "Show")).toEqual([constraint, constraint]);
    expect(tokenOf(source, "Vector")).toBe(nominal);
  });

  test("a constraint head, its bounds, and its members", () => {
    const source = "constraint Integral<a: (Num, Ord)> =\n    div(left: a, right: a): a";
    expect(tokenOf(source, "Integral")).toBe(constraint);
    expect(tokenOf(source, "Num")).toBe(constraint);
    expect(tokenOf(source, "Ord")).toBe(constraint);
    expect(tokenOf(source, "div")).toBe(callable);
    expect(tokenOf(source, "left")).toBe(ordinary);
    expect(allTokensFor(source, "a")).toEqual([nominal, nominal, nominal, nominal]);
  });

  test("a derives list, with the declared name and constructors left nominal", () => {
    const source = "export union Bool derives (Eq, Ord, Show, Hash) =\n    | False\n    | True";
    expect(tokenOf(source, "Bool")).toBe(nominal);
    expect(tokenOf(source, "Eq")).toBe(constraint);
    expect(tokenOf(source, "Hash")).toBe(constraint);
    expect(tokenOf(source, "True")).toBe(nominal);
  });

  test("an instance head names a constraint and supplies a type", () => {
    const source = 'honor Show<Rat> =\n    show(r: Rat): String = ""';
    expect(tokenOf(source, "Show")).toBe(constraint);
    expect(allTokensFor(source, "Rat")).toEqual([nominal, nominal]);
  });

  test("keywords still win over the call-head rule", () => {
    const source = "fun f(x) = if (x) then g(x) else h(x)";
    expect(tokenOf(source, "if")).toBe(keyword);
    expect(tokenOf(source, "g")).toBe(callable);
  });
});
