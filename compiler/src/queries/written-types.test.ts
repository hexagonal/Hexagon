import { describe, expect, test } from "vitest";
import { AnalysisSession, type CodeAction } from "../analysis/session.js";
import { HEADER_TITLE, PATTERN_REFUSAL, removeTitle, writeTitle } from "./written-types.js";

/** The program without its caret, or its selection between two carets, and where they were. */
function marked(source: string): { readonly text: string; readonly start: number; readonly end: number } {
  const start = source.indexOf("‸");
  if (start < 0) throw new Error("no caret in the source");
  const second = source.indexOf("‸", start + 1);
  const text = source.replaceAll("‸", "");
  return { text, start, end: second < 0 ? start : second - 1 };
}

/** Other files of the program, by path. */
type Files = Readonly<Record<string, string>>;

function session(text: string, files: Files = {}): AnalysisSession {
  const opened = new AnalysisSession();
  for (const [path, written] of Object.entries(files)) opened.setFile(path, written);
  opened.setFile("/main.hex", text);
  return opened;
}

const program = (...lines: readonly string[]): string => ["module Main", ...lines, ""].join("\n");

const isOurs = (title: string): boolean => title === HEADER_TITLE || /^(Write down the inferred|Remove the written) /.test(title);

/** The refactorings this offers at the caret or selection, by title. */
function offered(source: string, files: Files = {}): ReadonlyMap<string, CodeAction> {
  const { text, start, end } = marked(source);
  return new Map(
    session(text, files).codeActions("/main.hex", { start, end }, { invoked: true })
      .filter(({ title }) => isOurs(title))
      .map((action) => [action.title, action]),
  );
}

const titles = (source: string, files: Files = {}): readonly string[] => [...offered(source, files).keys()];

/** What the program reports, in each of its files. */
function reports(text: string, files: Files = {}): readonly string[] {
  const opened = session(text, files);
  return ["/main.hex", ...Object.keys(files)].flatMap((path) => opened.diagnostics(path).map(({ message }) => message));
}

/** The program after the refactoring named `title` is applied, or why it is refused. */
function applied(source: string, title: string, files: Files = {}): string {
  const action = offered(source, files).get(title);
  if (action === undefined) return "not offered";
  if (action.disabled !== undefined) return `refused: ${action.disabled}`;
  expect(action.edits.length).toBeGreaterThan(0);
  expect(action.preferred).toBeUndefined();
  const edits = [...action.edits].sort((left, right) => right.span.start.offset - left.span.start.offset);
  return edits.reduce(
    (written, { span, replacement }) => written.slice(0, span.start.offset) + replacement + written.slice(span.end.offset),
    marked(source).text,
  );
}

/** As `applied`, where the program and what it becomes each report nothing. */
function rewritten(source: string, title: string, files: Files = {}): string {
  const after = applied(source, title, files);
  if (after === "not offered" || after.startsWith("refused: ")) return after;
  expect(reports(marked(source).text, files)).toEqual([]);
  expect(reports(after, files)).toEqual([]);
  return after;
}

/** The hover type of the declaration named `name`, in the program as written. */
function faceOf(text: string, name: string): string | undefined {
  return session(text).hover("/main.hex", text.indexOf(name))?.displayedType;
}

describe("write down the inferred type, at one place", () => {
  test("a parameter: the type its hint shows, letters included", () => {
    expect(rewritten(program("let apply(‸f, x) = f(x)"), writeTitle("parameter", "f")))
      .toBe(program("let apply(f: a -> b, x) = f(x)"));
    expect(rewritten(program("let apply(f, ‸x) = f(x)"), writeTitle("parameter", "x")))
      .toBe(program("let apply(f, x: a) = f(x)"));
    expect(rewritten(program("let getX(r‸) = r.x"), writeTitle("parameter", "r")))
      .toBe(program("let getX(r: {x: a, ...b}) = r.x"));
    // The parameter alone: its header's action stands on the header's name.
    expect(titles(program("let apply(‸f, x) = f(x)"))).toEqual([writeTitle("parameter", "f")]);
  });

  test("a lambda's parameter, in the parentheses a bare one needs", () => {
    expect(rewritten(program("let g = [1, 2].map(x‸ => x + 1)"), writeTitle("parameter", "x")))
      .toBe(program("let g = [1, 2].map((x: Int) => x + 1)"));
    expect(rewritten(program("let g = [1, 2].map((x‸) => x + 1)"), writeTitle("parameter", "x")))
      .toBe(program("let g = [1, 2].map((x: Int) => x + 1)"));
    // A lambda that is a binding's whole value has no hint of its own: the binding's shows its parameters.
    expect(titles(program("let f = (x‸) => x + 1"))).toEqual([]);
  });

  test("an instance member's parameter", () => {
    const head = ["constraint Sized<t> =", "    size(x: t) -> Int", "honor Sized<Int> ="];
    expect(rewritten(program(...head, "    size(n‸) = n"), writeTitle("parameter", "n")))
      .toBe(program(...head, "    size(n: Int) = n"));
  });

  test("a `let` or `var`, with the binder list its type needs", () => {
    expect(rewritten(program("let double(x) = x * 2", "let ‸y = double(2.5)"), writeTitle("binding", "y")))
      .toBe(program("let double(x) = x * 2", "let y: Float = double(2.5)"));
    expect(rewritten(program("let outer(n) =", "    var ‸count = n", "    count"), writeTitle("binding", "count")))
      .toBe(program("let outer(n) =", "    var count: a = n", "    count"));
    expect(rewritten(program("let show2(x) = \"${x}\"", "let ‸shown = show2"), writeTitle("binding", "shown")))
      .toBe(program("let show2(x) = \"${x}\"", "let shown<a: Show>: a -> String = show2"));
  });

  test("a result a caller hands a function in to, as the constant hover shows (#1184)", () => {
    const SINK = "record Sink(a) = { put: (a) ->! Unit }";
    expect(rewritten(program(SINK, "fun mk()‸ = Sink({ put = (h) => h!(() => ()) })"), writeTitle("result", "mk")))
      .toBe(program(SINK, "fun mk(): Sink((() -> Unit) ->! Unit) = Sink({ put = (h) => h!(() => ()) })"));
  });

  test("a header's result, from its `)` to its `=`", () => {
    const after = program("let h(n: Int): Int = n + 1");
    expect(rewritten(program("let h(n: Int)‸ = n + 1"), writeTitle("result", "h"))).toBe(after);
    expect(rewritten(program("let h(n: Int) ‸= n + 1"), writeTitle("result", "h"))).toBe(after);
    expect(rewritten(program("let h(n: Int) =‸ n + 1"), writeTitle("result", "h"))).toBe(after);
    // Not on the name, nor inside the parameters.
    expect(titles(program("let ‸h(n: Int) = n + 1"))).toEqual([]);
    expect(titles(program("let h(n‸: Int) = n + 1"))).toEqual([removeTitle("parameter", "n")]);
    expect(titles(program("let h(n: Int‸) = n + 1"))).toEqual([removeTitle("parameter", "n")]);
  });

  test("a binder list, on the name it goes after, or entries a written one lacks", () => {
    expect(rewritten(program("let ‸double(x: a) = x * 2"), writeTitle("binder", "double")))
      .toBe(program("let double<a: Num>(x: a) = x * 2"));
    expect(rewritten(program("let ‸pair<a: Num>(x: a, y: b): (a, String) = (x + x, \"${y}\")"), writeTitle("binder", "pair")))
      .toBe(program("let pair<a: Num, b: Show>(x: a, y: b): (a, String) = (x + x, \"${y}\")"));
  });

  test("a `fun` block's binder list, refused where any member does not check", () => {
    const members = ["    twice(n: a): a = n + n", "    say(x: b): String = \"${x}\" ++ nope"];
    const refused = "refused: the body of `say` has an error to fix first: unknown name `nope`";
    expect(applied(program("f‸un", ...members), writeTitle("binder", undefined))).toBe(refused);
    expect(applied(program("f‸un<a: Num>", ...members), writeTitle("binder", undefined))).toBe(refused);
    expect(applied(program("f‸un<a: Num>", ...members), removeTitle("binder", undefined))).toBe(refused);
  });

  test("a `fun` block's binder list, on its keyword", () => {
    expect(rewritten(program("f‸un", "    twice(n: a): a = n + n", "    say(x: b): String = \"${x}\""), writeTitle("binder", undefined)))
      .toBe(program("fun<a: Num, b: Show>", "    twice(n: a): a = n + n", "    say(x: b): String = \"${x}\""));
    // Its members are the declarations that must check.
    expect(applied(program("f‸un", "    twice(n: a): a = n + nope", "    say(x: b): String = \"${x}\""), writeTitle("binder", undefined)))
      .toBe("refused: the body of `twice` has an error to fix first: unknown name `nope`");
  });

  test("an exported function's piece, its report of an incomplete signature changed but not added to", () => {
    const before = program("export let pub(x‸) = x + 1");
    expect(reports(marked(before).text)).toEqual([
      "exported function `pub` requires a complete signature; add type for parameter `x` and a return type",
      "exported function `pub` must declare every constraint in its signature; write `<a: Num>`",
    ]);
    const after = applied(before, writeTitle("parameter", "x"));
    expect(after).toBe(program("export let pub(x: a) = x + 1"));
    expect(reports(after)).toEqual([
      "exported function `pub` requires a complete signature; add a return type",
      "exported function `pub` must declare every constraint in its signature; write `<a: Num>`",
    ]);
  });

  test("an exported value's type, which ends its report", () => {
    expect(reports(program("export let x = 1"))).toEqual(["exported value `x` requires a type annotation"]);
    const x = applied(program("export let ‸x = 1"), writeTitle("binding", "x"));
    expect(x).toBe(program("export let x: Int = 1"));
    expect(reports(x)).toEqual([]);
    const SHOW = "let show2(x) = \"${x}\"";
    const shown = applied(program(SHOW, "export let ‸shown = show2"), writeTitle("binding", "shown"));
    expect(shown).toBe(program(SHOW, "export let shown<a: Show>: a -> String = show2"));
    expect(reports(shown)).toEqual([]);
  });

  test("a `let` pattern's variable is refused, since the grammar has no place for its type", () => {
    expect(applied(program("let (a, ‸b) = (1, \"x\")"), writeTitle("pattern", "b"))).toBe(`refused: ${PATTERN_REFUSAL}`);
  });
});

describe("a constraint, spelled as this module names it", () => {
  const metric = {
    "/metric.hex": [
      "module Metric",
      "export constraint Scale<a> =",
      "    scale(x: a, n: Int) -> a",
      "honor Scale<Int> =",
      "    scale(x, n) = x * n",
      "",
    ].join("\n"),
  };

  test("through the module that declares it, by the name it is imported as", () => {
    expect(rewritten(["module Main", "import Metric", "let ‸twice(x) = Metric.scale(x, 2)", ""].join("\n"), HEADER_TITLE, metric))
      .toBe(["module Main", "import Metric", "let twice<a: Metric.Scale>(x: a): a = Metric.scale(x, 2)", ""].join("\n"));
    expect(rewritten(["module Main", "import Metric as M", "let ‸twice(x) = M.scale(x, 2)", ""].join("\n"), HEADER_TITLE, metric))
      .toBe(["module Main", "import Metric as M", "let twice<a: M.Scale>(x: a): a = M.scale(x, 2)", ""].join("\n"));
    const binding = ["module Main", "import Metric", "let tw(x) = Metric.scale(x, 2)"];
    expect(rewritten([...binding, "let ‸t2 = tw", ""].join("\n"), writeTitle("binding", "t2"), metric))
      .toBe([...binding, "let t2<a: Metric.Scale>: a -> a = tw", ""].join("\n"));
    // The entries a written list lacks.
    const lacking = (head: string): string =>
      ["module Main", "import Metric", `let ${head}(x: a, y: b): (a, b) = (Metric.scale(x, 2), y)`, ""].join("\n");
    expect(rewritten(lacking("‸tw<b>"), writeTitle("binder", "tw"), metric)).toBe(lacking("tw<b, a: Metric.Scale>"));
  });

  test("bare where the module has a bare name for it", () => {
    const scale = {
      "/scale.hex": metric["/metric.hex"].replace("module Metric", "module Scale"),
    };
    // A module whose alias is its constraint's own name lends that name bare (Modules §5.1).
    expect(rewritten(["module Main", "import Scale", "let ‸twice(x) = Scale.scale(x, 2)", ""].join("\n"), HEADER_TITLE, scale))
      .toBe(["module Main", "import Scale", "let twice<a: Scale>(x: a): a = Scale.scale(x, 2)", ""].join("\n"));
    const own = ["constraint Twice<a> =", "    twice(x: a) -> a", "honor Twice<Int> =", "    twice(x) = x + x"];
    expect(rewritten(program(...own, "let ‸quad(x) = twice(twice(x))"), HEADER_TITLE))
      .toBe(program(...own, "let quad<a: Twice>(x: a): a = twice(twice(x))"));
  });

  test("two on one variable, in the order the hint shows them", () => {
    expect(rewritten(program("let ‸f(x) = \"${x}\" ++ (if x == x then \"\" else \"\")"), HEADER_TITLE))
      .toBe(program("let f<a: (Eq, Show)>(x: a): String = \"${x}\" ++ (if x == x then \"\" else \"\")"));
  });

  test("refused where this module has no name for it", () => {
    const files = {
      ...metric,
      "/mid.hex": ["module Mid", "import Metric", "export let tw<a: Metric.Scale>(x: a): a = Metric.scale(x, 2)", ""].join("\n"),
    };
    expect(applied(["module Main", "import Mid", "let ‸t2 = Mid.tw", ""].join("\n"), writeTitle("binding", "t2"), files))
      .toBe("refused: the type of `t2` cannot be written here: `Scale` is declared in another module and this one has no name for it");
    expect(applied(["module Main", "import Mid", "let ‸t3(x) = Mid.tw(x)", ""].join("\n"), HEADER_TITLE, files))
      .toBe("refused: the binder list of `t3` cannot be written here: `Scale` is declared in another module and this one has no name for it");
  });
});

describe("write down this header's types", () => {
  test("on a function's name, every unwritten place in one edit", () => {
    expect(rewritten(program("let ‸apply(f, x) = f(x)"), HEADER_TITLE)).toBe(program("let apply(f: a -> b, x: a): b = f(x)"));
    expect(rewritten(program("let ‸double(x) = x * 2"), HEADER_TITLE)).toBe(program("let double<a: Num>(x: a): a = x * 2"));
    expect(rewritten(program("let ‸pick(f, x) = if f(x) then Some(x) else None"), HEADER_TITLE))
      .toBe(program("let pick(f: a -> Bool, x: a): Option(a) = if f(x) then Some(x) else None"));
    expect(rewritten(program("let outer(n) =", "    let ‸inner(x) = x + n", "    inner(1)"), HEADER_TITLE))
      .toBe(program("let outer(n) =", "    let inner(x: a): a = x + n", "    inner(1)"));
    // Every later declaration is found again where the edit moved it.
    expect(rewritten(program("let ‸double(x) = x * 2", "let y = double(2.5)", "let z = double(2)"), HEADER_TITLE))
      .toBe(program("let double<a: Num>(x: a): a = x * 2", "let y = double(2.5)", "let z = double(2)"));
  });

  test("an open row stays open, where writing its result alone would close it", () => {
    const source = program("fun ‸copy(r) = {...r}");
    expect(rewritten(source, HEADER_TITLE)).toBe(program("fun copy(r: {...a}): {...a} = {...r}"));
    expect(faceOf(program("fun copy(r: {...a}): {...a} = {...r}"), "copy")).toBe(faceOf(marked(source).text, "copy"));
    expect(applied(program("fun copy(r) =‸ {...r}"), writeTitle("result", "copy")))
      .toBe("refused: writing `: {...a}` would change the type of `copy` from `{...a} -> {...a}` to `{} -> {}`");
    // A local, whose face is no module's: its own type is compared.
    expect(applied(program("let outer() =", "    let copy(r) =‸ {...r}", "    copy({})"), writeTitle("result", "copy")))
      .toBe("refused: writing `: {...a}` would change the type of `copy` from `{...a} -> {...a}` to `{} -> {}`");
  });

  test("an exported function's whole signature, which ends its report", () => {
    const after = applied(program("export let ‸pub(x) = x + 1"), HEADER_TITLE);
    expect(after).toBe(program("export let pub<a: Num>(x: a): a = x + 1"));
    expect(reports(after)).toEqual([]);
  });

  test("an instance member's parameters", () => {
    const head = ["constraint Two<t> =", "    two(x: t, y: t) -> Int", "honor Two<Int> ="];
    expect(rewritten(program(...head, "    ‸two(n, m) = n + m"), HEADER_TITLE)).toBe(program(...head, "    two(n: Int, m: Int) = n + m"));
  });

  test("refused, naming the header", () => {
    expect(applied(program("let keep(f) = f", "fun ‸m(z) = keep((r) => {...r})"), HEADER_TITLE))
      .toBe("refused: writing the types of `m`'s header would change the type of `m` from `a -> {...b} -> {...b}` to `a -> {} -> {}`");
  });

  test("an exported `fun` block member's, whose binder list goes on the block's head", () => {
    const after = applied(program("fun", "    export ‸twice(n) = n + n"), HEADER_TITLE);
    expect(after).toBe(program("fun", "    export twice(n: a): a = n + n"));
    expect(reports(after)).toEqual([
      "exported function `twice` must declare every constraint in its signature; declare the constraint on the block head: `fun<a: Num>`",
    ]);
    const headed = applied(program("f‸un", "    export twice(n: a): a = n + n"), writeTitle("binder", undefined));
    expect(headed).toBe(program("fun<a: Num>", "    export twice(n: a): a = n + n"));
    expect(reports(headed)).toEqual([]);
  });

  test("only where two or more places are unwritten", () => {
    expect(titles(program("let ‸h(n: Int) = n + 1"))).toEqual([]);
    expect(titles(program("let ‸h(n) = n ++ \"!\""))).toEqual([HEADER_TITLE]);
  });
});

describe("remove the written type", () => {
  test("a parameter's, from its name or its type", () => {
    const after = program("let h(n): Int = n + 1");
    expect(rewritten(program("let h(n‸: Int): Int = n + 1"), removeTitle("parameter", "n"))).toBe(after);
    expect(rewritten(program("let h(‸n: Int): Int = n + 1"), removeTitle("parameter", "n"))).toBe(after);
    expect(rewritten(program("let h(n: I‸nt): Int = n + 1"), removeTitle("parameter", "n"))).toBe(after);
    expect(rewritten(program("let g = [1, 2].map((x‸: Int) => x + 1)"), removeTitle("parameter", "x")))
      .toBe(program("let g = [1, 2].map((x) => x + 1)"));
  });

  test("a result's, and a binding's", () => {
    expect(rewritten(program("let h(n: Int)‸: Int = n + 1"), removeTitle("result", "h"))).toBe(program("let h(n: Int) = n + 1"));
    expect(rewritten(program("let h(n: Int) : Int ‸= n + 1"), removeTitle("result", "h"))).toBe(program("let h(n: Int) = n + 1"));
    expect(rewritten(program("let h(n: Int)‸ : Int = n + 1"), removeTitle("result", "h"))).toBe(program("let h(n: Int) = n + 1"));
    expect(rewritten(program("let ‸x: Int = 1"), removeTitle("binding", "x"))).toBe(program("let x = 1"));
    // With the space before the `:`, which goes with it.
    expect(rewritten(program("let ‸x : Int = 1"), removeTitle("binding", "x"))).toBe(program("let x = 1"));
  });

  test("a binder list's, after a name or on a `fun` block's keyword", () => {
    expect(rewritten(program("let id<a>‸(x: a): a = x"), removeTitle("binder", "id"))).toBe(program("let id(x: a): a = x"));
    expect(rewritten(program("let ‸id <a>(x: a): a = x"), removeTitle("binder", "id"))).toBe(program("let id(x: a): a = x"));
    expect(rewritten(program("let ‸pair<a: Num>(x: a, y: b): (a, String) = (x + x, \"${y}\")"), removeTitle("binder", "pair")))
      .toBe(program("let pair(x: a, y: b): (a, String) = (x + x, \"${y}\")"));
    expect(rewritten(program("f‸un<a: Num>", "    twice(n: a): a = n + n", "    thrice(n: a): a = n + n + n"), removeTitle("binder", undefined)))
      .toBe(program("fun", "    twice(n: a): a = n + n", "    thrice(n: a): a = n + n + n"));
  });

  test("a binder list on a lambda value, which leaves its binding's `=`", () => {
    expect(rewritten(program("let ‸id = <a>(x: a): a => x"), removeTitle("binder", "id"))).toBe(program("let id = (x: a): a => x"));
    // And the space after it, where there is one.
    expect(rewritten(program("let id = <‸a> (x: a): a => x"), removeTitle("binder", "id"))).toBe(program("let id = (x: a): a => x"));
  });

  test("a comment beside it stays", () => {
    expect(rewritten(program("let ‸x (* c *) : Int = 1"), removeTitle("binding", "x"))).toBe(program("let x (* c *) = 1"));
    expect(rewritten(program("let h(n: Int) // c", "    ‸: Int = n + 1"), removeTitle("result", "h")))
      .toBe(program("let h(n: Int) // c", "    = n + 1"));
  });

  test("a binding's binder list, beside its written type", () => {
    const SHOW = "let show2(x) = \"${x}\"";
    const source = program(SHOW, "let shown<a: Show>‸: a -> String = show2");
    expect(rewritten(source, removeTitle("binder", "shown"))).toBe(program(SHOW, "let shown: a -> String = show2"));
    expect(applied(source, removeTitle("binding", "shown"))).toBe(
      "refused: removing `: a -> String` would report a new problem: `a` is a declared type variable, but this declaration's " +
        "type does not mention it, so no call can choose it or supply its `Show` evidence; use `a` in the binding's type, or " +
        "remove `a` from the binder list",
    );
  });

  test("never on an exported term's, whose signature Modules §4.1.1 requires whole", () => {
    expect(titles(program("export let h(n‸: Int): Int = n + 1"))).toEqual([]);
    expect(titles(program("export fun h(n‸: Int): Int = n + 1"))).toEqual([]);
    expect(titles(program("export let h(n: Int)‸: Int = n + 1"))).toEqual([]);
    expect(titles(program("export let ‸pub<a: Num>(x: a): a = x + 1"))).toEqual([]);
    expect(titles(program("export let ‸x: Int = 1"))).toEqual([]);
    // A block's head is its exported members' binder list (Functions §7.3).
    expect(titles(program("f‸un<a: Num>", "    twice(n: a): a = n + n", "    export thrice(n: a): a = n + n + n"))).toEqual([]);
    expect(titles(program("f‸un<a: Num>", "    twice(n: a): a = n + n", "    thrice(n: a): a = n + n + n")))
      .toEqual([removeTitle("binder", undefined)]);
    // A local of an exported function is the dev's own to remove.
    expect(rewritten(program("export let f(n: Int): Int =", "    let ‸m: Int = n", "    m"), removeTitle("binding", "m")))
      .toBe(program("export let f(n: Int): Int =", "    let m = n", "    m"));
  });

  test("refused where the type at the place would change, though nothing reports it and no face changes", () => {
    const source = program("export let g(n: Int): Float =", "    let m‸: Float = n", "    m / 2");
    expect(reports(program("export let g(n: Int): Float =", "    let m = n", "    m / 2"))).toEqual([]);
    expect(applied(source, removeTitle("binding", "m")))
      .toBe("refused: removing `: Float` would change the type of `m` from `Float` to `Int`");
  });
});

describe("every name the module declares keeps its type", () => {
  // Each name alone is `a` either way; together, `x` and `y` are untied.
  test("a local function's, and its parameters' ties", () => {
    expect(applied(
      program("let apply2(f, p, q) = f(p, q)", "let outer() =", "    let g(n, m) = apply2((x: a, ‸y: a) => x, n, m)", "    \"${g(1, 2)}\""),
      removeTitle("parameter", "y"),
    )).toBe("refused: removing `: a` would change the type of `g` from `(a, a) -> a` to `(a, b) -> a`");
    expect(applied(program("let outer() =", "    let pick(x: a, ‸y: a) = x", "    \"${pick(1, 2)}\""), removeTitle("parameter", "y")))
      .toBe("refused: removing `: a` would change the type of `pick` from `(a, a) -> a` to `(a, b) -> a`");
  });

  test("a lambda no name holds, whose parameters are each `a` on their own either way", () => {
    expect(applied(program("let ignore(f) = ()", "let outer() = ignore((x: a, ‸y: a) => x)"), removeTitle("parameter", "y")))
      .toBe("refused: removing `: a` would change the type of `y` from `a` to `b`");
  });

  test("a face, and a pattern's variable's", () => {
    expect(applied(program("let apply2(f, p, q) = f(p, q)", "let outer(n, m) = apply2((x: a, ‸y: a) => x, n, m)"), removeTitle("parameter", "y")))
      .toBe("refused: removing `: a` would change the type of `outer` from `(a, a) -> a` to `(a, b) -> a`");
    expect(applied(program("let (f, k) = ((x: a, ‸y: a) => x, 1)"), removeTitle("parameter", "y")))
      .toBe("refused: removing `: a` would change the type of `f` from `(a, a) -> a` to `(a, b) -> a`");
  });

  test("a parameter's callback, whose colour is the constant it accepts whether written or inferred", () => {
    expect(rewritten(program("let outer(g) =", "    let ‸run(f) = f!()", "    run!(g)"), HEADER_TITLE))
      .toBe(program("let outer(g) =", "    let run(f: () ->! b): b = f!()", "    run!(g)"));
  });
});

describe("refused, with the reason", () => {
  test("a declaration that does not check", () => {
    expect(applied(program("let ‸bad(x) = x + nope"), HEADER_TITLE))
      .toBe("refused: the body of `bad` has an error to fix first: unknown name `nope`");
    expect(applied(program("let bad(x‸: Int): Int = x + nope"), removeTitle("parameter", "x")))
      .toBe("refused: the body of `bad` has an error to fix first: unknown name `nope`");
    expect(applied(program("let bad(x: Nope)‸ = x"), writeTitle("result", "bad")))
      .toBe("refused: the signature of `bad` has an error to fix first: unknown type `Nope`");
    // A report elsewhere stays as it was, and is no reason to refuse.
    expect(applied(program("let other = nope", "let ‸apply(f, x) = f(x)"), HEADER_TITLE))
      .toBe(program("let other = nope", "let apply(f: a -> b, x: a): b = f(x)"));
  });

  test("a type with an error in it, from a declaration elsewhere", () => {
    expect(applied(program("let broken = nope", "let ‸y = broken"), writeTitle("binding", "y")))
      .toBe("refused: the type of `y` cannot be written here: part of the inferred type is unknown, because the definition has an error");
  });

  test("a type this module cannot spell", () => {
    const shapes = (exported: string): Files => ({
      "/shapes.hex": ["module Shapes", `${exported}union Shape = Circle(Float) | Square(Float)`, "export let size(s: Shape): Float = 1.0", ""].join("\n"),
    });
    const source = ["module Main", "import Shapes", "let ‸area(s) = Shapes.size(s)", ""].join("\n");
    expect(applied(source, HEADER_TITLE, shapes("")))
      .toBe("refused: the type of `s` cannot be written here: `Shape` is declared in another module and this one has no name for it");
    expect(applied(source, HEADER_TITLE, shapes("export ")))
      .toBe(["module Main", "import Shapes", "let area(s: Shapes.Shape): Float = Shapes.size(s)", ""].join("\n"));
  });

  test("a callback's arrow is written as the function accepts it, and a following one is refused", () => {
    expect(rewritten(program("let ‸run(f) = f!()"), HEADER_TITLE)).toBe(program("let run(f: () ->! a): a = f!()"));
    expect(rewritten(program("let ‸apply(f, x) = f^(x)"), HEADER_TITLE)).toBe(program("let apply(f: a ->^ b, x: a): b = f^(x)"));
    expect(applied(program("let run(f) = f!()", "let ‸r = run"), writeTitle("binding", "r"))).toBe(
      "refused: the type of `r` cannot be written here: this function type's arrow is an effect variable, " +
        "and writing a following arrow here would link it to the rest of the signature's colour",
    );
  });

  test("an edit that reports a new problem", () => {
    // The binder list alone declares a variable no written type mentions yet.
    expect(applied(program("let ‸double(x) = x * 2"), writeTitle("binder", "double"))).toBe(
      "refused: writing `<a: Num>` would report a new problem: `a` is a declared type variable, but this declaration's type " +
        "does not mention it, so no call can choose it or supply its `Num` evidence; use `a` in a parameter or result type, " +
        "or remove `a` from the binder list",
    );
  });

  test("an edit that changes a face another module reads", () => {
    const use = { "/use.hex": ["module Use", "import Main", "export let use(): Int = Main.m()({x = 1}).x", ""].join("\n") };
    expect(applied(program("let keep(f) = f", "export fun m()‸ = keep((r) => {...r})"), writeTitle("result", "m"), use))
      .toBe("refused: writing `: {...a} -> {...a}` would break `/use.hex`: record fields do not match; unexpected `x`");
    expect(applied(program("let keep(f) = f", "export fun m()‸ = keep((r) => {...r})"), writeTitle("result", "m")))
      .toBe("refused: writing `: {...a} -> {...a}` would change the type of `m` from `() -> {...a} -> {...a}` to `() -> {} -> {}`");
  });
});

describe("only when asked", () => {
  test("never offered unasked, nor preferred", () => {
    const { text, start, end } = marked(program("let ‸apply(f, x) = f(x)"));
    expect(session(text).codeActions("/main.hex", { start, end }).filter(({ title }) => isOurs(title))).toEqual([]);
  });

  test("only where a selection starts, each checked by compiling it", () => {
    expect(titles(program("let ‸f(x) = x + 1", "let g(y) = y‸ + 2"))).toEqual([writeTitle("binder", "f"), HEADER_TITLE]);
    expect(titles(program("‸let f(x) = [1].map((x) => x + 1)‸"))).toEqual([]);
    expect(titles(program("let f(‸x) = [1].map((x) => x + 1)‸"))).toEqual([writeTitle("parameter", "x")]);
  });
});
