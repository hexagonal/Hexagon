import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

import type * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import {
  createGrammarLoader,
  createTokensProvider,
  hexagonScopeName,
  javascriptScopeName,
  typescriptScopeName,
} from "./monaco-textmate";

/**
 * Drives the real bridge — the VS Code grammar, the Oniguruma engine, and the Monaco
 * tokens provider `monaco.ts` installs — over real Hexagon source, so these assertions
 * are the token strings Playground hands Monaco rather than what a regex looks like it
 * should do.
 *
 * The cases are the ones the deleted Monarch tests covered, so nothing #160 established
 * is lost in the swap, plus the rows #145 listed as diverging, which Playground now
 * inherits from the grammar for free. Scope-level assertions are not repeated here:
 * `editors/vscode/src/grammar.test.ts` owns those, and after #161 it owns them for both
 * editors. What this file is for is the bridge — that a scope survives the trip into
 * Monaco intact, and that the Playground-only injection loads.
 */

const require = createRequire(import.meta.url);

const onigLib = (async () => {
  const oniguruma = require("vscode-oniguruma") as typeof import("vscode-oniguruma");
  await oniguruma.loadWASM(await readFile(require.resolve("vscode-oniguruma/release/onig.wasm")));
  return {
    createOnigScanner: (sources: string[]) => new oniguruma.OnigScanner(sources),
    createOnigString: (text: string) => new oniguruma.OnigString(text),
  };
})();

const loadGrammar = createGrammarLoader(onigLib);

const providerFor = (scopeName: string): Promise<monaco.languages.TokensProvider> =>
  loadGrammar(scopeName).then((grammar) => createTokensProvider(scopeName, grammar));

const provider = providerFor(hexagonScopeName);

interface Painted {
  readonly text: string;
  readonly token: string;
}

/** Every non-blank token, in source order, exactly as Monaco receives it. */
async function paintWith(
  provider: Promise<monaco.languages.TokensProvider>,
  source: string,
): Promise<Painted[]> {
  const tokens = await provider;
  const painted: Painted[] = [];
  let state = tokens.getInitialState();
  for (const line of source.split("\n")) {
    const result = tokens.tokenize(line, state);
    result.tokens.forEach((token, index) => {
      const end = result.tokens[index + 1]?.startIndex ?? line.length;
      const text = line.slice(token.startIndex, end);
      if (text.trim() !== "") painted.push({ text: text.trim(), token: token.scopes });
    });
    state = result.endState;
  }
  return painted;
}

const paint = (source: string): Promise<Painted[]> => paintWith(provider, source);

const tokenOf = async (source: string, text: string): Promise<string | undefined> =>
  (await paint(source)).find((entry) => entry.text === text)?.token;

const allTokensFor = async (source: string, text: string): Promise<string[]> =>
  (await paint(source)).filter((entry) => entry.text === text).map((entry) => entry.token);

const nominal = "entity.name.type.hexagon";
const typeParameter = "entity.name.type.parameter.hexagon";
const namespace = "entity.name.namespace.hexagon";
const constraint = "entity.name.type.constraint.hexagon";
const callable = "entity.name.function.hexagon";
const term = "variable.other.hexagon";
const binder = "variable.other.definition.hexagon";
const parameter = "variable.parameter.hexagon";
const control = "keyword.control.hexagon";
const storage = "storage.type.hexagon";

describe("type variables reach the nominal family in every type position", () => {
  // Ported from the Monarch tests. TextMate distinguishes a type variable from a
  // nominal type by scope where Monarch could not, but `.vscode/settings.json` puts
  // both in the nominal family, so the colour these assert is the same one.
  test("a parameter annotation", async () => {
    expect(await allTokensFor("fun size(v: Vector(a)): Int = length(v)", "a")).toEqual([
      typeParameter,
    ]);
  });

  test("a bare parameter annotation and a result type", async () => {
    const source = "fun identity(value: a): a = value";
    expect(await allTokensFor(source, "a")).toEqual([typeParameter, typeParameter]);
    expect(await allTokensFor(source, "value")).toEqual([parameter, term]);
  });

  test("a union payload", async () => {
    const source = "export union Option(a) derives (Eq, Show) =\n    | Some(value: a)\n    | None";
    expect(await allTokensFor(source, "a")).toEqual([typeParameter, typeParameter]);
    expect(await tokenOf(source, "None")).toBe(nominal);
  });

  test("a record type's fields, with the field names left as terms", async () => {
    const source = "record Pair(a, b) = {left: a, right: b}";
    expect(await allTokensFor(source, "a")).toEqual([typeParameter, typeParameter]);
    expect(await allTokensFor(source, "b")).toEqual([typeParameter, typeParameter]);
    expect(await tokenOf(source, "left")).toBe(parameter);
  });

  test("a type alias, header and right-hand side alike", async () => {
    expect(await allTokensFor("type Handler(a) = a -> Option(a)", "a")).toEqual([
      typeParameter,
      typeParameter,
      typeParameter,
    ]);
  });

  test("an angle-bracket binder", async () => {
    const source = "export fun first<a>(values: Vector(a)): Option(a) = None";
    expect(await allTokensFor(source, "a")).toEqual([
      typeParameter,
      typeParameter,
      typeParameter,
    ]);
  });
});

describe("annotations end where their surrounding syntax ends", () => {
  test("a right-hand side after the annotation stays ordinary", async () => {
    const source = "let n: Int = compute(alpha, beta)";
    expect(await tokenOf(source, "Int")).toBe(nominal);
    expect(await tokenOf(source, "alpha")).toBe(term);
    expect(await tokenOf(source, "beta")).toBe(term);
    expect(await tokenOf(source, "compute")).toBe(callable);
  });

  test("a record literal uses `=` and is untouched", async () => {
    const source = "let p = {left = 1, right = 2}";
    expect(await tokenOf(source, "left")).toBe(term);
    expect(await tokenOf(source, "right")).toBe(term);
  });

  test("`:=` is assignment, not an annotation", async () => {
    expect(await tokenOf("searching := False", "searching")).toBe(term);
  });

  test("a match arm's body is not a type", async () => {
    const source = "match x\n    | Some(v) => v\n    | None => 0";
    expect(await allTokensFor(source, "v")).toEqual([term, term]);
  });
});

describe("a type context never outlives what encloses it", () => {
  // The Monarch tokenizer could not observe end of line, so every state opened with a
  // `^` rule that popped the whole stack. Oniguruma honours `$`, so the grammar ends
  // these contexts where they actually end — but the leak these guard against is the
  // same one, so the cases are kept.
  test("an ordinary line after an annotated line is unaffected", async () => {
    const source = "let n: Int\nlet m = compute(alpha)";
    expect(await tokenOf(source, "m")).toBe(binder);
    expect(await tokenOf(source, "compute")).toBe(callable);
    expect(await tokenOf(source, "alpha")).toBe(term);
    expect(await allTokensFor(source, "let")).toEqual([storage, storage]);
  });

  test("an extern block's later members keep their own scopes", async () => {
    // spec/ffi-part5-extern-classes.md §3.1, verbatim.
    const source = [
      'extern from "web-response"',
      "    export type Response",
      "",
      "    export get status(response: Response): Int",
      "    export get headers(response: Response): Headers",
    ].join("\n");
    expect(await allTokensFor(source, "export")).toEqual([
      "keyword.control.import.hexagon",
      "keyword.control.import.hexagon",
      "keyword.control.import.hexagon",
    ]);
    expect(await tokenOf(source, "headers")).toBe(callable);
    expect(await allTokensFor(source, "Response")).toEqual([nominal, nominal, nominal]);
  });

  test("an indented implied type member does not swallow its block", async () => {
    // Collections Part 2 §5.1/§5.3: `type Item = a` is legal inside an `honor` block.
    const source = [
      "honor<a> Iterable<Bag(a)> =",
      "    type Item = a",
      "    toSeq(xs) = Bag.contents(xs)",
      "    other(ys) = length(ys)",
    ].join("\n");
    expect(await tokenOf(source, "toSeq")).toBe(callable);
    expect(await tokenOf(source, "xs")).toBe(term);
    expect(await tokenOf(source, "other")).toBe(callable);
    expect(await tokenOf(source, "ys")).toBe(term);
  });

  test("a multi-line derives list keeps its constraints", async () => {
    // The Monarch tokenizer could not do this — its `^` reset tore the list open at
    // each line start. This list keeps its colour under #162's hanging split because
    // its `(` is the last thing on the line, which is what dissolved that trade-off.
    const source = "record P derives (\n    Eq,\n    Show)\nlet after = 1";
    expect(await allTokensFor(source, "Eq")).toEqual([constraint]);
    expect(await allTokensFor(source, "Show")).toEqual([constraint]);
    expect(await tokenOf(source, "after")).toBe(binder);
  });

  test("an unterminated group does not repaint what follows it", async () => {
    // #162, and the one case the port from Monarch briefly lost. The grammar contains
    // it with `^`-anchored end patterns, which only work if each line is handed to the
    // engine as its own string — a property of this bridge, not of the grammar, so it
    // is asserted here as well as in editors/vscode/src/grammar.test.ts.
    const source = "record P(a\nlet after = 1";
    expect(await allTokensFor(source, "a")).toEqual([typeParameter]);
    expect(await tokenOf(source, "let")).toBe(storage);
    expect(await tokenOf(source, "after")).toBe(binder);
  });
});

describe("constraints and callables", () => {
  test("a parameterized instance head names its constraint", async () => {
    // spec/constraints.md §4.3.
    const source = 'honor<a: Show> Show<Vector(a)> =\n    show(xs) = "x"';
    expect(await allTokensFor(source, "Show")).toEqual([constraint, constraint]);
    expect(await tokenOf(source, "Vector")).toBe(nominal);
  });

  test("a constraint head, its bounds, and its members", async () => {
    const source = "constraint Integral<a: (Num, Ord)> =\n    div(left: a, right: a): a";
    expect(await tokenOf(source, "Integral")).toBe(constraint);
    expect(await tokenOf(source, "Num")).toBe(constraint);
    expect(await tokenOf(source, "Ord")).toBe(constraint);
    expect(await tokenOf(source, "div")).toBe(callable);
    expect(await tokenOf(source, "left")).toBe(parameter);
    expect(await allTokensFor(source, "a")).toEqual([
      typeParameter,
      typeParameter,
      typeParameter,
      typeParameter,
    ]);
  });

  test("a derives list, with the declared name and constructors left nominal", async () => {
    const source = "export union Bool derives (Eq, Ord, Show, Hash) =\n    | False\n    | True";
    expect(await tokenOf(source, "Bool")).toBe(nominal);
    expect(await tokenOf(source, "Eq")).toBe(constraint);
    expect(await tokenOf(source, "Hash")).toBe(constraint);
    expect(await tokenOf(source, "True")).toBe(nominal);
  });

  test("an instance head names a constraint and supplies a type", async () => {
    const source = 'honor Show<Rat> =\n    show(r: Rat): String = ""';
    expect(await tokenOf(source, "Show")).toBe(constraint);
    expect(await allTokensFor(source, "Rat")).toEqual([nominal, nominal]);
  });

  test("keywords still win over the call-head rule", async () => {
    const source = "fun f(x) = if (x) then g(x) else h(x)";
    expect(await tokenOf(source, "if")).toBe(control);
    expect(await tokenOf(source, "g")).toBe(callable);
  });
});

describe("what Playground gains by inheriting the grammar (#145)", () => {
  // Every row here was painted wrongly by the Monarch tokenizer. None of them needed
  // work: the grammar already had them, and Playground now runs the grammar.
  test("a numeric separator is part of the literal", async () => {
    expect(await tokenOf("let n = 1_000", "1_000")).toBe("constant.numeric.integer.hexagon");
  });

  test("an exponent is part of the literal", async () => {
    expect(await tokenOf("let f = 1.5e-10", "1.5e-10")).toBe("constant.numeric.float.hexagon");
  });

  test("a BigInt suffix is part of the literal", async () => {
    expect(await tokenOf("let b = 42n", "42n")).toBe("constant.numeric.bigint.hexagon");
  });

  test("an interpolation hole is lexed as code, not as string content", async () => {
    const source = 'let greeting = "hi ${name} there"';
    expect(await tokenOf(source, "${")).toBe("punctuation.section.interpolation.begin.hexagon");
    expect(await tokenOf(source, "name")).toBe(term);
    expect(await tokenOf(source, "there")).toBe("string.quoted.double.hexagon");
  });

  test("a string may span physical newlines", async () => {
    const source = 'let banner = "first\nsecond"\nlet after = 1';
    expect(await tokenOf(source, "second")).toBe("string.quoted.double.hexagon");
    // The line after the closing quote is code again, so the string really ended.
    expect(await tokenOf(source, "after")).toBe(binder);
  });

  test("block comments nest", async () => {
    const source = "(* outer (* inner *) still comment *)\nlet after = 1";
    expect(await tokenOf(source, "still comment")).toBe("comment.block.hexagon");
    expect(await tokenOf(source, "after")).toBe(binder);
  });

  test("doc comments have their own scope", async () => {
    expect(await tokenOf("(** doc *)\nlet x = 1", "doc")).toBe(
      "comment.block.documentation.hexagon",
    );
    // The one doc form, and only it: spec/doc-comments.md §2.2 keeps banners ordinary
    // and §2.3 gives `///` no status, so both reach the ordinary comment scopes.
    expect(await tokenOf("(*** banner ***)\nlet x = 1", "** banner **")).toBe(
      "comment.block.hexagon",
    );
    expect(await tokenOf("/// doc\nlet x = 1", "/ doc")).toBe(
      "comment.line.double-slash.hexagon",
    );
  });

  test("contextual keywords are painted in their positions", async () => {
    expect(await tokenOf('import {a} from "./m"', "from")).toBe("keyword.other.from.hexagon");
    expect(await tokenOf("let q = {p with x = 3}", "with")).toBe("keyword.other.with.hexagon");
    expect(await tokenOf("match e\n    | N(x) when x > 0 => x", "when")).toBe(
      "keyword.other.when.hexagon",
    );
  });

  test("contextual keywords stay ordinary names out of position", async () => {
    expect(await tokenOf("let when = 1", "when")).toBe(binder);
    expect(await tokenOf("let r = {with = 3}", "with")).toBe(term);
  });

  test("the §8.2 and §10 error rows are painted as errors", async () => {
    expect(await tokenOf("let a = x && y", "&&")).toBe("invalid.illegal.operator.hexagon");
    expect(await tokenOf("let a = x || y", "||")).toBe("invalid.illegal.operator.hexagon");
    expect(await tokenOf("let a = !x", "!")).toBe("invalid.illegal.operator.hexagon");
    expect(await tokenOf("let a = 0xFF", "0xFF")).toBe("invalid.illegal.numeric-base.hexagon");
    expect(await tokenOf("let a = 12cats", "12cats")).toBe(
      "invalid.illegal.numeric-literal.hexagon",
    );
    expect(await tokenOf("let true = 1", "true")).toBe(
      "invalid.illegal.reserved-redirect-word.hexagon",
    );
    expect(await tokenOf("let __t = 1", "__t")).toBe(
      "invalid.illegal.reserved-identifier.hexagon",
    );
  });

  test("`->` is its own token rather than one greedy operator run", async () => {
    // #145's `->` row; the spec ruling it waits on is #144, which does not change this.
    expect(await tokenOf("type H(a) = a -> Int", "->")).toBe(
      "keyword.operator.type.arrow.hexagon",
    );
  });
});

describe("the Playground-only module notation (injection)", () => {
  // `module X` / `end module X` create a virtual file and are not `.hex` syntax, so
  // they live in playground-module.tmLanguage.json rather than in the shared grammar.
  const source = [
    "module Numbers",
    "export let answer: Int = 21",
    "end module Numbers",
    "let n = Numbers.answer",
  ].join("\n");

  test("both headers are painted, name included", async () => {
    expect(await tokenOf(source, "module")).toBe(control);
    expect(await tokenOf(source, "end module")).toBe(control);
    expect(await allTokensFor(source, "Numbers")).toEqual([namespace, namespace, namespace]);
  });

  test("the base grammar still runs inside the block", async () => {
    expect(await tokenOf(source, "answer")).toBe(binder);
    expect(await tokenOf(source, "Int")).toBe(nominal);
  });

  test("an international module name is recognized by start class", async () => {
    // src/examples/international-identifiers.ts uses exactly this.
    const named = "module Mगणित\nexport let x = 1\nend module Mगणित";
    expect(await allTokensFor(named, "Mगणित")).toEqual([namespace, namespace]);
  });

  test("`module` is an ordinary name when the line is not a header", async () => {
    expect(await tokenOf("let module = 1", "module")).toBe(binder);
    expect(await tokenOf("let x = module", "module")).toBe(term);
  });

  test("recognizes every header the host recognizes, valid name or not", async () => {
    // workspace-source.ts takes any non-blank run as the name and opens the module
    // even while reporting a diagnostic, so a header the host acts on must not be
    // painted as ordinary code. The host's diagnostic is what flags the bad name.
    for (const name of ["foo", "_X", "N.M", "Numbers extra"]) {
      expect(`${name}: ${await tokenOf(`module ${name}`, "module")}`).toBe(
        `${name}: ${control}`,
      );
      expect(`${name}: ${await tokenOf(`module ${name}`, name)}`).toBe(
        `${name}: ${namespace}`,
      );
    }
  });
});

describe("the generated-code panes go through the same bridge", () => {
  // Not a second look at VS Code's JavaScript grammar, which is not ours to test. What
  // these pin is that the panes reach the families `monaco-theme.ts` paints, over the
  // shapes the emitter actually produces — a call, a declaration, a keyword, a literal.
  const javascript = providerFor(javascriptScopeName);
  const typescript = providerFor(typescriptScopeName);

  const scopeOf = async (
    provider: Promise<monaco.languages.TokensProvider>,
    source: string,
    text: string,
  ): Promise<string | undefined> =>
    (await paintWith(provider, source)).find((entry) => entry.text === text)?.token;

  test("names a callable, which is what Monarch could not do at all", async () => {
    // The whole reason the panes left Monarch: `identifier` was its only verdict here,
    // so the callable family had nothing to paint and generated code read as prose.
    const source = "export const show = (x) => Vector.append(items, x);";
    expect(await scopeOf(javascript, source, "append")).toBe("entity.name.function.js");
    expect(await scopeOf(javascript, source, "items")).toBe("variable.other.readwrite.js");
  });

  test("splits a bigint suffix off its digits, which the theme rejoins", async () => {
    const source = "const big = 42n;";
    expect(await scopeOf(javascript, source, "42")).toBe("constant.numeric.decimal.js");
    expect(await scopeOf(javascript, source, "n")).toBe("storage.type.numeric.bigint.js");
  });

  test("sorts word operators from symbolic ones, as the Hexagon grammar does", async () => {
    const source = "const b = typeof x === 'string' && y + 1;";
    expect(await scopeOf(javascript, source, "typeof")).toBe(
      "keyword.operator.expression.typeof.js",
    );
    expect(await scopeOf(javascript, source, "===")).toBe("keyword.operator.comparison.js");
    expect(await scopeOf(javascript, source, "+")).toBe("keyword.operator.arithmetic.js");
  });

  test("the declarations pane is tokenized as TypeScript, not as JavaScript", async () => {
    const source = "export declare function greet(name: string): string;";
    expect(await scopeOf(typescript, source, "declare")).toBe("storage.modifier.ts");
    expect(await scopeOf(typescript, source, "greet")).toBe("entity.name.function.ts");
    expect(await scopeOf(typescript, source, "string")).toBe("support.type.primitive.ts");
  });

  test("labels a long line with its own root scope, not Hexagon's", async () => {
    // `source.js` has to be as inert against the theme as `source.hexagon` is; handing
    // back the wrong root would paint the skipped line with whatever that root matches.
    const tokens = await javascript;
    const long = tokens.tokenize("x".repeat(20_000), tokens.getInitialState());
    expect(long.tokens).toEqual([{ startIndex: 0, scopes: javascriptScopeName }]);
  });
});

describe("the bridge itself", () => {
  test("hands Monaco the innermost scope, which is what the theme keys on", async () => {
    const painted = await paint("let x: Int = 1");
    expect(painted.map((entry) => [entry.text, entry.token])).toEqual([
      ["let", storage],
      ["x", binder],
      [":", "punctuation.separator.colon.hexagon"],
      ["Int", nominal],
      ["=", "keyword.operator.assignment.hexagon"],
      ["1", "constant.numeric.integer.hexagon"],
    ]);
  });

  test("labels a token no rule claims with the root scope alone", async () => {
    // No theme rule matches it, so it lands on the editor foreground rather than
    // inheriting a colour from some unrelated prefix.
    const tokens = await provider;
    const line = tokens.tokenize("  ", tokens.getInitialState());
    expect(line.tokens.map((token) => token.scopes)).toEqual([hexagonScopeName]);
  });

  test("skips a line past Monaco's tokenization length, preserving state", async () => {
    // What MonarchTokenizer did, and what the adapter behind setTokensProvider does
    // not do for us. Preserving the state is the point: resetting it would reopen a
    // multi-line string on the far side of the long line.
    const tokens = await provider;
    const inString = tokens.tokenize('let s = "open', tokens.getInitialState());
    const long = tokens.tokenize("x".repeat(20_000), inString.endState);
    expect(long.tokens).toEqual([{ startIndex: 0, scopes: hexagonScopeName }]);
    expect(long.endState).toBe(inString.endState);
    expect(tokens.tokenize('closes"', long.endState).tokens[0]?.scopes).toBe(
      "string.quoted.double.hexagon",
    );
  });

  test("threads state across lines so a model tokenizes incrementally", async () => {
    const tokens = await provider;
    const first = tokens.tokenize('let s = "open', tokens.getInitialState());
    // The string is still open, so the next line continues inside it.
    const second = tokens.tokenize('still string"', first.endState);
    expect(second.tokens[0]?.scopes).toBe("string.quoted.double.hexagon");
  });
});
