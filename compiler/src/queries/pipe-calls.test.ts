import { describe, expect, test } from "vitest";
import { AnalysisSession, type CodeAction } from "../analysis/session.js";
import { applyLayout } from "../passes/layout/layout.js";
import { lex } from "../passes/lexer/lexer.js";
import { parseFile } from "../passes/parser/parser.js";
import * as Source from "../support/source.js";
import { CALLS_TO_PIPE_TITLE, PIPE_TO_CALLS_TITLE, rewrite } from "./pipe-calls.js";
import { keepsReading } from "./same-reading.js";

/**
 * A program and where in it: `‸` is a caret, `«…»` a selection. Both marks are
 * removed before compiling.
 */
function marked(source: string): { readonly text: string; readonly start: number; readonly end: number } {
  const caret = source.indexOf("‸");
  if (caret >= 0) return { text: source.slice(0, caret) + source.slice(caret + 1), start: caret, end: caret };
  const open = source.indexOf("«");
  const close = source.indexOf("»");
  if (open < 0 || close < open) throw new Error("no caret or selection in the source");
  return {
    text: source.slice(0, open) + source.slice(open + 1, close) + source.slice(close + 1),
    start: open,
    end: close - 1,
  };
}

const PRELUDE = [
  "module Main",
  "let f(x: Int): Int = x + 1",
  "let g(x: Int, y: Int): Int = x + y",
  "let save(x: Int): Int = x",
  "let xs = [1, 2, 3]",
  "",
].join("\n");

/** The refactorings offered at the mark, by title. */
function offered(body: string): ReadonlyMap<string, CodeAction> {
  const { text, start, end } = marked(PRELUDE + body);
  const session = new AnalysisSession();
  session.setFile("/main.hex", text);
  return new Map(
    session.codeActions("/main.hex", { start, end }, { invoked: true })
      .filter(({ kind }) => kind === "refactor")
      .map((action) => [action.title, action]),
  );
}

/** The body after the refactoring named `title` is applied at the mark, or why it is refused. */
function rewritten(body: string, title: string): string {
  const action = offered(body).get(title);
  if (action === undefined) return "not offered";
  if (action.disabled !== undefined) return `refused: ${action.disabled}`;
  const { text } = marked(PRELUDE + body);
  const [edit] = action.edits;
  const after = text.slice(0, edit!.span.start.offset) + edit!.replacement + text.slice(edit!.span.end.offset);
  return after.slice(PRELUDE.length);
}

const asCalls = (body: string): string => rewritten(body, PIPE_TO_CALLS_TITLE);
const asPipeline = (body: string): string => rewritten(body, CALLS_TO_PIPE_TITLE);

describe("a pipeline written as calls", () => {
  test("the whole pipeline, from either `|>`", () => {
    expect(asCalls("let a = xs |> Seq.map(f) ‸|> Seq.take(3)")).toBe("let a = Seq.take(Seq.map(xs, f), 3)");
    expect(asCalls("let a = xs ‸|> Seq.map(f) |> Seq.take(3)")).toBe("let a = Seq.take(Seq.map(xs, f), 3)");
  });

  test("from a stage's name, its mark or its parentheses", () => {
    expect(asCalls("let a = xs |> Seq.m‸ap(f) |> Seq.take(3)")).toBe("let a = Seq.take(Seq.map(xs, f), 3)");
    expect(asCalls("let a = 1 |> g‸")).toBe("let a = g(1)");
    expect(asCalls("let a = xs |> Seq.take(3‸)")).toBe("not offered");
  });

  test("not from its first value, or from inside a stage's arguments", () => {
    expect(asCalls("let a = x‸s |> Seq.take(3)")).toBe("not offered");
    expect(asCalls("let a = 1‸2 |> g")).toBe("not offered");
    expect(asCalls("let a = xs |> Seq.map(f‸)")).toBe("not offered");
    expect(asCalls("let a = xs |> Seq.map((x) => f(‸x))")).toBe("not offered");
  });

  test("a bare stage is called, keeping its mark", () => {
    expect(asCalls("let a = 1 ‸|> save!")).toBe("let a = save!(1)");
    expect(asCalls("let a = \"1\" ‸|> Int.parse?")).toBe("let a = Int.parse?(\"1\")");
    expect(asCalls("let a = 1 ‸|> g~?")).toBe("let a = g~?(1)");
  });

  test("a stage with its own list takes the value first, keeping its mark", () => {
    expect(asCalls("let a = 1 ‸|> g!(2)")).toBe("let a = g!(1, 2)");
  });

  test("a mark the parser reported is kept as written", () => {
    expect(asCalls("let a = 1 ‸|> save!?")).toBe("let a = save!?(1)");
  });

  test("a mark after a stage's own list refuses it, since it marks nothing", () => {
    expect(asCalls("let a = 1 ‸|> g(2)!")).toBe(
      "refused: A mark after a stage's own argument list marks nothing, and would be lost. Mark the list instead, as in `take!(3)`.",
    );
    expect(asCalls("let a = 1 |> g(2)! ‸|> f")).toBe(
      "refused: A mark after a stage's own argument list marks nothing, and would be lost. Mark the list instead, as in `take!(3)`.",
    );
  });

  test("a stage that is not a callee by its form is parenthesized", () => {
    expect(asCalls("let a = 1 ‸|> (x => x + 1)")).toBe("let a = (x => x + 1)(1)");
    expect(asCalls("let a = 1 ‸|> (g(2))")).toBe("let a = (g(2))(1)");
    expect(asCalls("let fs = [f]\nlet a = 1 ‸|> fs[0]")).toBe("let fs = [f]\nlet a = fs[0](1)");
    expect(asCalls("let a = 1 ‸|> x => x + 1")).toBe("let a = (x => x + 1)(1)");
  });

  test("a stage that ends a line keeps the line break outside the call", () => {
    expect(asCalls("let a = 1 ‸|> match\n    1 => 2\n    _ => 3\nlet b = 2\n"))
      .toBe("let a = (match\n    1 => 2\n    _ => 3)(1)\nlet b = 2\n");
  });

  test("a pipeline over several lines becomes one call", () => {
    expect(asCalls("let a =\n    xs\n    ‸|> Seq.map(f)\n    |> Seq.take(3)\n"))
      .toBe("let a =\n    Seq.take(Seq.map(xs, f), 3)\n");
  });

  test("a comment it would lose refuses it", () => {
    expect(asCalls("let a = xs ‸|> (* first *) Seq.take(3)"))
      .toBe("refused: A comment inside it would be lost. Move the comment out first.");
    expect(asCalls("let a = xs ‸|> Seq.take(f((* three *) 3))")).toBe("let a = Seq.take(xs, f((* three *) 3))");
  });

  test("a `//` comment it would keep inside the call refuses it, naming the comment", () => {
    expect(asCalls("let a = 1 ‸|> match\n    1 => 2\n    _ => 3 // the rest\n")).toBe(
      "refused: A `//` comment inside it would swallow what the rewrite writes after it. Move the comment out first.",
    );
    expect(asCalls("let a = 1 ‸|> match\n    1 => 2\n    _ => 3 (* the rest *)\n"))
      .toBe("let a = (match\n    1 => 2\n    _ => 3 (* the rest *))(1)\n");
  });
});

describe("calls written as a pipeline", () => {
  test("the call and the calls in its first argument, innermost first", () => {
    expect(asPipeline("let a = Seq.ta‸ke(Seq.map(xs, f), 3)")).toBe("let a = xs |> Seq.map(f) |> Seq.take(3)");
    expect(asPipeline("let a = f‸(f(1))")).toBe("let a = 1 |> f |> f");
  });

  test("from just before the list, whatever the callee", () => {
    expect(asPipeline("let a = (x => x + 1)‸(2)")).toBe("let a = 2 |> (x => x + 1)");
    expect(asPipeline("let fs = [f]\nlet a = fs[0]‸(2)")).toBe("let fs = [f]\nlet a = 2 |> fs[0]");
    expect(asPipeline("let k(x: Int): Int -> Int = y => x + y\nlet a = k(1)‸(2)"))
      .toBe("let k(x: Int): Int -> Int = y => x + y\nlet a = 2 |> k(1)()");
  });

  test("a call that is a pipe's first value", () => {
    expect(asPipeline("let a = ‸f(1) |> g(2)")).toBe("let a = 1 |> f |> g(2)");
  });

  test("from the call's name, mark or parentheses, not from inside its arguments", () => {
    expect(asPipeline("let a = g(1,‸ 2)")).toBe("let a = 1 |> g(2)");
    expect(asPipeline("let a = g(f‸(1), 2)")).toBe("let a = g(1 |> f, 2)");
    expect(asPipeline("let a = g(f(1), (x => ‸x)(2))")).toBe("not offered");
  });

  test("keeping each call's mark", () => {
    expect(asPipeline("let a = sa‸ve!(1)")).toBe("let a = 1 |> save!");
    expect(asPipeline("let a = Int.pa‸rse?(\"1\")")).toBe("let a = \"1\" |> Int.parse?");
    expect(asPipeline("let a = g‸!(1, 2)")).toBe("let a = 1 |> g!(2)");
  });

  test("not for a call with no argument, a pipe's own stage, or a dot call", () => {
    expect(asPipeline("let h() = 1\nlet a = h‸()")).toBe("not offered");
    expect(asPipeline("let a = xs |> Seq.ta‸ke(3)")).toBe("not offered");
    expect(asPipeline("let a = xs.ta‸ke(3)")).toBe("not offered");
    expect(asPipeline("let a = Main.xs.ta‸ke(3)")).toBe("not offered");
    expect(asPipeline("let a = (xs).ta‸ke(3)")).toBe("not offered");
    // An upper-case receiver that is no module's alias is a term: `None` here.
    expect(asPipeline("let a = None.defaultV‸alue(2)")).toBe("not offered");
  });

  test("a name an import brings is a module's, so its call is qualified", () => {
    expect(asPipeline("import Regex\nlet a = Regex.comp‸ile(\"a\")")).toBe("import Regex\nlet a = \"a\" |> Regex.compile");
    expect(asPipeline("import Regex\nlet a = Seq.ta‸ke(Regex.compile(\"a\"), 3)"))
      .toBe("import Regex\nlet a = \"a\" |> Regex.compile |> Seq.take(3)");
  });

  test("a dot call ends the chain, as the pipeline's first value", () => {
    expect(asPipeline("let a = Seq.ta‸ke(xs.map(f), 3)")).toBe("let a = xs.map(f) |> Seq.take(3)");
  });

  test("parenthesized where it would bind too loosely, bare where it stands alone", () => {
    expect(asPipeline("let a = ‸f(1) + 1")).toBe("let a = (1 |> f) + 1");
    expect(asPipeline("let a = ‸f(1).toString()")).toBe("let a = (1 |> f).toString()");
    expect(asPipeline("let a = [‸f(1), 2]")).toBe("let a = [1 |> f, 2]");
  });

  test("a first value that binds tighter than `|>` stands bare", () => {
    expect(asPipeline("let a = ‸f(1 + 2)")).toBe("let a = 1 + 2 |> f");
    expect(asPipeline("let a = ‸f(-1)")).toBe("let a = -1 |> f");
    const bare = [
      "()",
      "\"s\"",
      "1n",
      "1.5d",
      "1.5",
      "[1]",
      "(1, 2)",
      "{x = 1}",
      "(1 + 2)",
      "(1 : Int)",
      "xs[0]",
      "1 < 2",
      "r.x",
      "None",
      "(1, 2)p",
    ];
    for (const value of bare) {
      expect(asPipeline(`let r = {x = 1}\nlet a = Debug.lo‸g(${value})`)).toBe(`let r = {x = 1}\nlet a = ${value} |> Debug.log`);
    }
  });

  test("a first value whose last operand reaches to the right is parenthesized", () => {
    expect(asPipeline("let c = true\nlet a = ‸f(1 + if c then 2 else 3)")).toBe("let c = true\nlet a = (1 + if c then 2 else 3) |> f");
  });

  test("a first value that reaches to the right, or binds looser, is parenthesized", () => {
    expect(asPipeline("let b(x: Bool): Bool = x\nlet a = ‸b(not true)")).toBe("let b(x: Bool): Bool = x\nlet a = (not true) |> b");
    expect(asPipeline("let apply(k: Int -> Int, x: Int): Int = k(x)\nlet a = app‸ly(x => x + 1, 2)"))
      .toBe("let apply(k: Int -> Int, x: Int): Int = k(x)\nlet a = (x => x + 1) |> apply(2)");
  });

  test("from just after a call that is an argument, that call", () => {
    expect(asPipeline("let a = g(f(1)‸, 2)")).toBe("let a = g(1 |> f, 2)");
  });

  test("not from inside a plain argument", () => {
    expect(asPipeline("let a = f(1‸2)")).toBe("not offered");
    expect(asPipeline("let a = g(1, [2‸])")).toBe("not offered");
  });

  test("a `//` comment that runs over nothing is not named as the reason", () => {
    const apply = "let apply(k: Int -> Int, x: Int): Int = k(x)\n";
    expect(asPipeline(apply + "let a = app‸ly(x => // c\n    x + 1, 2)\n")).toBe(
      "refused: Written the other way here, it would parse as a different program.",
    );
  });

  test("in a file whose lines end CRLF, its lines do too", () => {
    expect(asPipeline("let a =\r\n    Seq.ta‸ke(\r\n        Seq.map(xs, f),\r\n        3)\r\n"))
      .toBe("let a =\r\n    xs\r\n    |> Seq.map(f)\r\n    |> Seq.take(3)\r\n");
  });

  test("a callee's own call, from its name or as a selection, is that call", () => {
    const k = "let k(x: Int): Int -> Int = y => x + y\n";
    expect(asPipeline(k + "let a = ‸k(1)(2)")).toBe(k + "let a = (1 |> k)(2)");
    expect(asPipeline(k + "let a = «k(1)»(2)")).toBe(k + "let a = (1 |> k)(2)");
  });

  test("a selection of a callee that is no name is not on the call", () => {
    expect(asPipeline("let a = «(x => x + 1)»(2)")).toBe("not offered");
  });

  test("a callee that is itself a call keeps an empty list", () => {
    expect(asPipeline("let k(x: Int): Int -> Int = y => x + y\nlet a = «k(1)(2)»"))
      .toBe("let k(x: Int): Int -> Int = y => x + y\nlet a = 2 |> k(1)()");
  });

  test("on one line, one line, wherever it stands", () => {
    expect(asPipeline("let a =\n    ‸f(f(1))\n")).toBe("let a =\n    1 |> f |> f\n");
    expect(asPipeline("let a = Seq.ta‸ke(\n    Seq.map(xs, f),\n    3)\n")).toBe("let a = xs |> Seq.map(f) |> Seq.take(3)\n");
  });

  test("on a line of its own over several lines, a stage to a line at the first value's column", () => {
    expect(asPipeline("let a =\n    Seq.ta‸ke(\n        Seq.map(xs, f),\n        3)\n"))
      .toBe("let a =\n    xs\n    |> Seq.map(f)\n    |> Seq.take(3)\n");
  });

  test("over several lines with more after it on its last line, one line", () => {
    expect(asPipeline("let a =\n    ‸g(\n        f(1),\n        2) + 1\n")).toBe("let a =\n    (1 |> f |> g(2)) + 1\n");
  });

  test("a comment it would lose refuses it", () => {
    expect(asPipeline("let a = g‸(1, f((* two *) 2))")).toBe("let a = 1 |> g(f((* two *) 2))");
    expect(asPipeline("let a = g‸((* one *) 1, 2)")).toBe(
      "refused: A comment inside it would be lost. Move the comment out first.",
    );
  });
});

describe("the two rewrites", () => {
  test("undo one another", () => {
    const calls = "let a = Seq.take(Seq.map(xs, f), 3)";
    const pipeline = asPipeline(calls.replace("Seq.take", "Seq.ta‸ke"));
    expect(pipeline).toBe("let a = xs |> Seq.map(f) |> Seq.take(3)");
    expect(asCalls(pipeline.replace("|> Seq.take", "‸|> Seq.take"))).toBe(calls);
  });

  test("are offered only when the dev asks, not as the caret moves", () => {
    const { text, start, end } = marked(PRELUDE + "let a = xs |> Seq.ma‸p(f)");
    const session = new AnalysisSession();
    session.setFile("/main.hex", text);
    expect(session.codeActions("/main.hex", { start, end }).map(({ title }) => title)).toEqual([]);
    expect(session.codeActions("/main.hex", { start, end }, { invoked: false }).map(({ title }) => title)).toEqual([]);
    expect(session.codeActions("/main.hex", { start, end }, { invoked: true }).map(({ title }) => title))
      .toEqual([PIPE_TO_CALLS_TITLE]);
  });

  test("are refactorings, never preferred", () => {
    const actions = [...offered("let a = xs |> Seq.ma‸p(f)").values(), ...offered("let a = f‸(1)").values()];
    expect(actions.map(({ title, kind, preferred }) => ({ title, kind, preferred }))).toEqual([
      { title: PIPE_TO_CALLS_TITLE, kind: "refactor", preferred: undefined },
      { title: CALLS_TO_PIPE_TITLE, kind: "refactor", preferred: undefined },
    ]);
  });
});

describe("the parse that checks a rewrite", () => {
  const text = PRELUDE + "let a = f(1)\n";
  const file = new Source.File(1 as Source.FileId, "/main.hex", text);
  const [module] = parseFile(applyLayout(lex(file)), file.path);
  const call = text.indexOf("f(1)");
  const value = (module!.items.at(-1) as { readonly value: Parameters<typeof rewrite>[3] }).value;

  test("takes the first text that reads the same, and refuses when none does", () => {
    expect(rewrite(file, module!, "t", value, { texts: ["f(2)", "1 |> f"], kept: [] }))
      .toEqual({ title: "t", edit: { start: call, end: call + 4, replacement: "1 |> f" } });
    expect(rewrite(file, module!, "t", value, { texts: ["f(2)"], kept: [] }))
      .toEqual({ title: "t", disabled: "Written the other way here, it would parse as a different program." });
  });

  test("names a `//` comment as the reason only where it ends a kept text", () => {
    const source = PRELUDE + "let a = f(1) (* one *)\nlet b = f(1) // two\n";
    const commented = new Source.File(1 as Source.FileId, "/main.hex", source);
    const [parsed] = parseFile(applyLayout(lex(commented)), commented.path);
    const refused = (name: string, comment: string) => {
      const item = parsed!.items.find((each) => each.kind === "Let" && source.slice(each.span.start.offset).startsWith(`let ${name}`));
      const value = (item as { readonly value: Parameters<typeof rewrite>[3] }).value;
      const kept = commented.span(value.span.start.offset, source.indexOf(comment) + comment.length);
      return rewrite(commented, parsed!, "t", value, { texts: ["f(2)"], kept: [kept] }).disabled;
    };
    expect(refused("b", "// two")).toBe("A `//` comment inside it would swallow what the rewrite writes after it. Move the comment out first.");
    expect(refused("a", "(* one *)")).toBe("Written the other way here, it would parse as a different program.");
  });

  test("reads no edit outside a top-level item as keeping the program", () => {
    expect(keepsReading(file, module!, { start: 0, end: "module".length, replacement: "module" })).toBe(false);
    expect(keepsReading(file, module!, { start: call, end: call + 4, replacement: "(f(1))" })).toBe(true);
  });

  test("reads an edit at either end of an item as inside it", () => {
    const item = text.lastIndexOf("let a");
    expect(keepsReading(file, module!, { start: item, end: item + 3, replacement: "let" })).toBe(true);
    expect(keepsReading(file, module!, { start: call, end: call + 4, replacement: "f(2)" })).toBe(false);
    expect(keepsReading(file, module!, { start: call + 3, end: call + 4, replacement: ")" })).toBe(true);
  });

  test("keeps the parentheses that make a field's call of a dot call", () => {
    const source = PRELUDE + "let r = {h = f}\nlet a = r.h(2)\n";
    const fields = new Source.File(1 as Source.FileId, "/main.hex", source);
    const [parsed] = parseFile(applyLayout(lex(fields)), fields.path);
    const at = source.indexOf("r.h(2)");
    const edit = (replacement: string) => ({ start: at, end: at + "r.h(2)".length, replacement });
    expect(keepsReading(fields, parsed!, edit("(r.h)(2)"))).toBe(false);
    expect(keepsReading(fields, parsed!, edit("(r).h(2)"))).toBe(true);
    const field = new Source.File(1 as Source.FileId, "/main.hex", source.replace("r.h(2)", "(r.h)(2)"));
    const [grouped] = parseFile(applyLayout(lex(field)), field.path);
    expect(keepsReading(field, grouped!, { start: at, end: at + "(r.h)(2)".length, replacement: "((r.h))(2)" })).toBe(true);
  });
});
