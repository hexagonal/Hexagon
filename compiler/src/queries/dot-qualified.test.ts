import { describe, expect, test } from "vitest";
import { AnalysisSession, type CodeAction } from "../analysis/session.js";
import { applyLayout } from "../passes/layout/layout.js";
import { lex } from "../passes/lexer/lexer.js";
import { parseFile } from "../passes/parser/parser.js";
import * as Source from "../support/source.js";
import { dotCallAt, readsAsQualified } from "./dot-qualified.js";

const GEO = [
  "module Geo",
  "export union Shape = Circle(radius: Float) | Square(side: Float)",
  'extern from "./shim.js"',
  "    fun log(n: Float) ->! Unit",
  "export let area(s: Shape): Float = 1.0",
  "export let scale(s: Shape, by: Float): Shape = s",
  "export let mix(s: Shape, t: Shape): Shape = s",
  "export let draw(s: Shape): Unit = log!(1.0)",
  "",
].join("\n");

/** The module `Geo` declares, as `Home`, for the calls written in their home module. */
const HOME = GEO.replace("module Geo", "module Home");

const OTHER = "module Other\nimport Geo\nexport let shape: Geo.Shape = Geo.Circle(1.0)\n";

function session(main: string): AnalysisSession {
  const opened = new AnalysisSession();
  opened.setFile("/geo.hex", GEO);
  opened.setFile("/other.hex", OTHER);
  opened.setFile("/main.hex", main);
  return opened;
}

/** The program without its caret, and where the caret was. */
function marked(source: string): { readonly text: string; readonly at: number } {
  const at = source.indexOf("‸");
  if (at < 0) throw new Error("no caret in the source");
  return { text: source.slice(0, at) + source.slice(at + 1), at };
}

/** The refactorings offered at the caret, by title. */
function offered(source: string): ReadonlyMap<string, CodeAction> {
  const { text, at } = marked(source);
  return new Map(
    session(text).codeActions("/main.hex", { start: at, end: at }, { invoked: true })
      .filter(({ kind }) => kind === "refactor")
      .map((action) => [action.title, action]),
  );
}

function reports(text: string): readonly string[] {
  return session(text).diagnostics("/main.hex").map(({ message }) => message);
}

/**
 * The program after the refactoring named `title` is applied at the caret, or
 * why it is refused. The program and what it becomes each report nothing.
 */
function rewritten(source: string, title: string): string {
  const action = offered(source).get(title);
  if (action === undefined) return "not offered";
  if (action.disabled !== undefined) return `refused: ${action.disabled}`;
  const { text } = marked(source);
  const [edit] = action.edits;
  const after = text.slice(0, edit!.span.start.offset) + edit!.replacement + text.slice(edit!.span.end.offset);
  expect(reports(text)).toEqual([]);
  expect(reports(after)).toEqual([]);
  return after;
}

/** The titles of this rewrite offered at the caret, beside whatever others are. */
const titles = (source: string): readonly string[] =>
  [...offered(source).keys()].filter((title) => title.startsWith("Write the dot call"));
const as = (spelling: string): string => `Write the dot call as \`${spelling}(…)\``;
const main = (...lines: readonly string[]): string => ["module Main", "import Geo", ...lines, ""].join("\n");
const prelude = (...lines: readonly string[]): string => ["module Main", ...lines, ""].join("\n");

describe("a dot call written as its qualified call", () => {
  test("through the import that brings its module, under the import's alias", () => {
    expect(rewritten(main("export let a(s: Geo.Shape): Float = s.ar‸ea()"), as("Geo.area")))
      .toBe(main("export let a(s: Geo.Shape): Float = Geo.area(s)"));
    expect(rewritten(main("export let a(s: Geo.Shape): Geo.Shape = s.sc‸ale(2.0)"), as("Geo.scale")))
      .toBe(main("export let a(s: Geo.Shape): Geo.Shape = Geo.scale(s, 2.0)"));
    const aliased = (line: string): string => ["module Main", "import Geo as G", line, ""].join("\n");
    expect(rewritten(aliased("export let a(s: G.Shape): G.Shape = s.sc‸ale(2.0)"), as("G.scale")))
      .toBe(aliased("export let a(s: G.Shape): G.Shape = G.scale(s, 2.0)"));
  });

  test("a prelude companion's, by the prelude module's name", () => {
    expect(rewritten(prelude("export let n: Int = [1, 2].len‸gth()"), as("Vector.length")))
      .toBe(prelude("export let n: Int = Vector.length([1, 2])"));
    expect(rewritten(prelude("export let o: Option(Int) = Some(1).m‸ap((x) => x + 1)"), as("Option.map")))
      .toBe(prelude("export let o: Option(Int) = Option.map(Some(1), (x) => x + 1)"));
    expect(rewritten(prelude('export let s: String = "ab".toUp‸per()'), as("String.toUpper")))
      .toBe(prelude('export let s: String = String.toUpper("ab")'));
    // An import that gives its alias to another name leaves the prelude's alone.
    expect(rewritten(main("export let n: Int = [1, 2].len‸gth()"), as("Vector.length")))
      .toBe(main("export let n: Int = Vector.length([1, 2])"));
  });

  test("in its home module, by its bare name", () => {
    const home = (line: string): string => HOME + line + "\n";
    expect(rewritten(home("export let twice(s: Shape): Float = s.ar‸ea() * 2.0"), as("area")))
      .toBe(home("export let twice(s: Shape): Float = area(s) * 2.0"));
    expect(rewritten(home("export let c(s: Shape): Float = match s\n    Circle(_) => s.ar‸ea()\n    _ => 0.0"), as("area")))
      .toBe(home("export let c(s: Shape): Float = match s\n    Circle(_) => area(s)\n    _ => 0.0"));
  });

  test("from its dot or its name, and not from its receiver or arguments", () => {
    const written = main("export let a(s: Geo.Shape): Geo.Shape = Geo.scale(s, 2.0)");
    expect(rewritten(main("export let a(s: Geo.Shape): Geo.Shape = s‸.scale(2.0)"), as("Geo.scale"))).toBe(written);
    expect(rewritten(main("export let a(s: Geo.Shape): Geo.Shape = s.‸scale(2.0)"), as("Geo.scale"))).toBe(written);
    expect(rewritten(main("export let a(s: Geo.Shape): Geo.Shape = s.scale‸(2.0)"), as("Geo.scale"))).toBe(written);
    expect(titles(main("export let a(s: Geo.Shape): Geo.Shape = ‸s.scale(2.0)"))).toEqual([]);
    expect(titles(main("export let a(s: Geo.Shape): Geo.Shape = s.scale(2‸.0)"))).toEqual([]);
  });

  test("the call the dot is on, in a chain", () => {
    expect(rewritten(main("export let a(s: Geo.Shape): Float = s.sc‸ale(2.0).area()"), as("Geo.scale")))
      .toBe(main("export let a(s: Geo.Shape): Float = Geo.scale(s, 2.0).area()"));
    expect(rewritten(main("export let a(s: Geo.Shape): Float = s.scale(2.0).ar‸ea()"), as("Geo.area")))
      .toBe(main("export let a(s: Geo.Shape): Float = Geo.area(s.scale(2.0))"));
    expect(rewritten(prelude("export let n: Int = [1, 2]", "    .map((x) => x + 1)", "    .len‸gth()"), as("Vector.length")))
      .toBe(prelude("export let n: Int = Vector.length([1, 2]", "    .map((x) => x + 1))"));
    // The call around it starts where it does, and reaches another module.
    expect(rewritten(main("export let a(s: Geo.Shape): Bool = s.ar‸ea().isNan()"), as("Geo.area")))
      .toBe(main("export let a(s: Geo.Shape): Bool = Geo.area(s).isNan()"));
  });

  test("keeping its mark, its arguments' lines and comments, and dropping the receiver's parentheses", () => {
    expect(rewritten(main("export let go(s: Geo.Shape): Unit = s.dr‸aw!()"), as("Geo.draw")))
      .toBe(main("export let go(s: Geo.Shape): Unit = Geo.draw!(s)"));
    expect(rewritten(main("export let a(s: Geo.Shape): Geo.Shape = s.sc‸ale(", "    2.0)"), as("Geo.scale")))
      .toBe(main("export let a(s: Geo.Shape): Geo.Shape = Geo.scale(s,", "    2.0)"));
    expect(rewritten(main("export let a(s: Geo.Shape): Geo.Shape = s.sc‸ale(2.0 (* twice *))"), as("Geo.scale")))
      .toBe(main("export let a(s: Geo.Shape): Geo.Shape = Geo.scale(s, 2.0 (* twice *))"));
    expect(rewritten(main("export let a(s: Geo.Shape): Float = s.ar‸ea((* none *))"), as("Geo.area")))
      .toBe(main("export let a(s: Geo.Shape): Float = Geo.area(s (* none *))"));
    expect(rewritten(prelude("export let n: Int = [1, (* two *) 2].len‸gth()"), as("Vector.length")))
      .toBe(prelude("export let n: Int = Vector.length([1, (* two *) 2])"));
    expect(rewritten(main("export let a(s: Geo.Shape): Float = (s).ar‸ea()"), as("Geo.area")))
      .toBe(main("export let a(s: Geo.Shape): Float = Geo.area(s)"));
    expect(rewritten(main("export let a(s: Geo.Shape): Float = s.ar‸ea() // the area"), as("Geo.area")))
      .toBe(main("export let a(s: Geo.Shape): Float = Geo.area(s) // the area"));
  });

  test("with space or a line break between its name and its arguments", () => {
    const written = main("export let a(s: Geo.Shape): Geo.Shape = Geo.scale(s, 2.0)");
    expect(rewritten(main("export let a(s: Geo.Shape): Geo.Shape = s.sc‸ale (2.0)"), as("Geo.scale"))).toBe(written);
    expect(rewritten(main("export let a(s: Geo.Shape): Geo.Shape = s.sc‸ale", "    (2.0)"), as("Geo.scale"))).toBe(written);
  });

  test("by the prelude's name where the only import of the module stands below", () => {
    expect(rewritten(prelude("export let n: Bool = Some(1).isS‸ome()", "import Hex.Option as O"), as("Option.isSome")))
      .toBe(prelude("export let n: Bool = Option.isSome(Some(1))", "import Hex.Option as O"));
  });

  test("in a `fun` block's member, an honor group's item, and as a block's last line", () => {
    expect(rewritten(main("fun", "    g(s: Geo.Shape): Float = s.ar‸ea() + h(s)", "    h(s: Geo.Shape): Float = 1.0"), as("Geo.area")))
      .toBe(main("fun", "    g(s: Geo.Shape): Float = Geo.area(s) + h(s)", "    h(s: Geo.Shape): Float = 1.0"));
    const group = (call: string): string => main(
      "record Box = { s: Geo.Shape }",
      "honor",
      "    Show<Box> =",
      `        show(b) = "\${${call}}"`,
    );
    expect(rewritten(group("b.s.ar‸ea()"), as("Geo.area"))).toBe(group("Geo.area(b.s)"));
    expect(rewritten(main("export let a(s: Geo.Shape): Float =", "    let t = s", "    t.ar‸ea()"), as("Geo.area")))
      .toBe(main("export let a(s: Geo.Shape): Float =", "    let t = s", "    Geo.area(t)"));
  });

  test("inside a string's `${…}`", () => {
    expect(rewritten(prelude('export let s: String = "${[1].len‸gth()}"'), as("Vector.length")))
      .toBe(prelude('export let s: String = "${Vector.length([1])}"'));
  });

  test("with a line break before the next item", () => {
    expect(rewritten(main("export let a(s: Geo.Shape): Float = s.ar‸ea()\r", "export let b: Int = 1\r"), as("Geo.area")))
      .toBe(main("export let a(s: Geo.Shape): Float = Geo.area(s)\r", "export let b: Int = 1\r"));
  });
});

/**
 * Why the rewrite titled `title` is refused at the caret in `/main.hex`, with
 * `files` beside it in a session opened with `options`. Every file reports nothing.
 */
function refusedAmong(
  files: Readonly<Record<string, string>>,
  source: string,
  title: string,
  options?: ConstructorParameters<typeof AnalysisSession>[0],
): readonly (string | undefined)[] {
  const opened = new AnalysisSession(options);
  for (const [path, text] of Object.entries(files)) opened.setFile(path, text);
  const { text, at } = marked(source);
  opened.setFile("/main.hex", text);
  for (const path of [...Object.keys(files), "/main.hex"]) expect(opened.diagnostics(path)).toEqual([]);
  return opened.codeActions("/main.hex", { start: at, end: at }, { invoked: true })
    .filter((action) => action.title === title).map(({ disabled }) => disabled);
}

describe("where it is refused", () => {
  test("a dot reaching a module this one does not import, naming the import", () => {
    const source = ["module Main", "import Other", "export let a: Float = Other.shape.ar‸ea()", ""].join("\n");
    const refusal = "This module does not import `Geo`, where `area` is declared. Write `import Geo` first.";
    expect(rewritten(source, as("Geo.area"))).toBe(`refused: ${refusal}`);
    // Named for the module whose text declares it, not for another in its file.
    const pad = "module Pad\nexport let pad: Int = 1\n";
    expect(refusedAmong({ "/geo.hex": `${pad}end module Pad\n${GEO}`, "/other.hex": OTHER }, source, as("Geo.area")))
      .toEqual([refusal]);
    expect(refusedAmong({ "/geo.hex": `${GEO}end module Geo\n${pad}`, "/other.hex": OTHER }, source, as("Geo.area")))
      .toEqual([refusal]);
  });

  test("naming it as this module would import it: whole, or without its own package's name", () => {
    const source = ["module Main", "import Other", "export let a: Float = Other.shape.ar‸ea()", ""].join("\n");
    const shapes = {
      "/geo.hex": GEO.replace("module Geo", "module Shapes.Geo"),
      "/other.hex": "module Other\nimport Shapes.Geo\nexport let shape: Geo.Shape = Geo.Circle(1.0)\n",
    };
    expect(refusedAmong(shapes, source, as("Geo.area")))
      .toEqual(["This module does not import `Shapes.Geo`, where `area` is declared. Write `import Shapes.Geo` first."]);
    expect(refusedAmong({ "/geo.hex": GEO, "/other.hex": OTHER }, source, as("Geo.area"), { packageName: "Acme" }))
      .toEqual(["This module does not import `Geo`, where `area` is declared. Write `import Geo` first."]);
  });

  test("a home module that is another module of this file", () => {
    const source = [
      "module Home",
      "export union Shape = Circle(radius: Float)",
      "export let area(s: Shape): Float = 1.0",
      "export let shape: Shape = Circle(1.0)",
      "end module Home",
      "module Mid",
      "import Home",
      "export let s: Home.Shape = Home.shape",
      "end module Mid",
      "module Main",
      "import Mid",
      "export let x: Float = Mid.s.ar‸ea()",
      "",
    ].join("\n");
    expect(refusedAmong({}, source, as("Home.area")))
      .toEqual(["This module does not import `Home`, where `area` is declared. Write `import Home` first."]);
  });

  test("an extern member reached through another module's value", () => {
    const web = [
      "module Web",
      'extern from "web"',
      "    export type Params",
      "    export fun make() ->! Params",
      "    export method get(params: Params, key: String) ->! Nullable(String)",
      "",
    ].join("\n");
    const src = "module Src\nimport Web\nexport let p(): Web.Params = Web.make!()\n";
    const source = ["module Main", "import Src", 'export let v(): Nullable(String) = Src.p!().g‸et!("k")', ""].join("\n");
    expect(refusedAmong({ "/web.hex": web, "/src.hex": src }, source, as("Web.get")))
      .toEqual(["This module does not import `Web`, where `get` is declared. Write `import Web` first."]);
  });

  test("an import below the call, which does not reach it yet, named as it is written", () => {
    const below = (line: string): string => `refused: This module's \`${line}\` stands below this call, and an import ` +
      "is read from where it stands (Modules §3). Move it above the call first.";
    expect(rewritten(["module Main", "export let a(s: Geo.Shape): Float = s.ar‸ea()", "import Geo", ""].join("\n"), as("Geo.area")))
      .toBe(below("import Geo"));
    expect(rewritten(["module Main", "export let a(s: G.Shape): Float = s.ar‸ea()", "import Geo as G", ""].join("\n"), as("G.area")))
      .toBe(below("import Geo as G"));
    // The prelude's own module, imported below under its own name.
    expect(rewritten(["module Main", "export let n: Bool = Some(1).isS‸ome()", "import Hex.Option", ""].join("\n"), as("Option.isSome")))
      .toBe(below("import Hex.Option"));
  });

  test("a bare call a binder in the item would capture, and not a qualified one", () => {
    const home = (line: string): string => HOME + line + "\n";
    const captured = "refused: `area` is bound here as well, so `area(…)` could call that instead.";
    expect(rewritten(home("export let c(area: Float, s: Shape): Float = s.ar‸ea()"), as("area"))).toBe(captured);
    expect(rewritten(home("export let d(s: Shape): Float = ((area: Float) => s.ar‸ea())(1.0)"), as("area"))).toBe(captured);
    expect(rewritten(home("export let e(s: Shape): Float = match 1.0\n    area => s.ar‸ea()"), as("area"))).toBe(captured);
    expect(rewritten(home("export let f(s: Shape): Float = match 1.0\n    _ as area => s.ar‸ea()"), as("area"))).toBe(captured);
    expect(rewritten(main("export let c(area: Float, s: Geo.Shape): Float = s.ar‸ea()"), as("Geo.area")))
      .toBe(main("export let c(area: Float, s: Geo.Shape): Float = Geo.area(s)"));
  });

  test("and one a local declaration would, though it cannot be written without an error", () => {
    for (const local of ["let area = 1.0", "var area = 1.0", "fun area() = 1.0"]) {
      const source = HOME + `export let g(s: Shape): Float =\n    ${local}\n    s.ar‸ea()\n`;
      expect(reports(marked(source).text).length).toBeGreaterThan(0);
      expect(offered(source).get(as("area"))?.disabled).toBe("`area` is bound here as well, so `area(…)` could call that instead.");
    }
  });

  test("a prelude module whose name an import here gives another module", () => {
    expect(rewritten(["module Main", "import Geo as String", 'export let s: String = "ab".toUp‸per()', ""].join("\n"), as("String.toUpper")))
      .toBe("refused: `String` here names `Geo`, imported as `String`, so `String.toUpper(…)` would not reach the prelude's `String`.");
  });

  test("a comment before the dot or before the arguments, which would be lost", () => {
    const lost = "refused: A comment inside it would be lost. Move the comment out first.";
    expect(rewritten(main("export let a(s: Geo.Shape): Float = s // the shape", "    .ar‸ea()"), as("Geo.area"))).toBe(lost);
    expect(rewritten(main("export let a(s: Geo.Shape): Geo.Shape = s.sc‸ale(* by *)(2.0)"), as("Geo.scale"))).toBe(lost);
    expect(rewritten(main("export let a(s: Geo.Shape): Geo.Shape = s.sc‸ale // by", "    (2.0)"), as("Geo.scale"))).toBe(lost);
  });
});

describe("where it is not offered", () => {
  test("a constraint member, whose qualified call is its open call", () => {
    expect(titles(prelude("export let c: Ordering = 1.comp‸are(2)"))).toEqual([]);
    expect(titles(prelude("export let s: String = 1.sh‸ow()"))).toEqual([]);
  });

  test("a field called through the dot, or read and then called", () => {
    expect(titles(prelude("export let n(r: { g: (Int) -> Int }): Int = r.‸g(1)"))).toEqual([]);
    expect(titles(prelude("export let n(r: { g: (Int) -> Int }): Int = (r.‸g)(1)"))).toEqual([]);
  });

  test("a dot the text does not decide, which is refused", () => {
    expect(titles(prelude("let f(x) = x.len‸gth()"))).toEqual([]);
  });

  test("a pipe's stage written as a dot call, whose receiver is not the pipe's first argument", () => {
    const stage = main("export let a(s: Geo.Shape, t: Geo.Shape): Geo.Shape = t |> s.m‸ix()");
    expect(reports(marked(stage).text)).toEqual([]);
    expect(titles(stage)).toEqual([]);
  });

  test("a qualified call already", () => {
    expect(titles(main("export let a(s: Geo.Shape): Float = Geo.ar‸ea(s)"))).toEqual([]);
  });

  test("a call whose argument list is not closed", () => {
    const open = main("export let a(s: Geo.Shape): Geo.Shape = s.sc‸ale(2.0");
    expect(reports(marked(open).text)).toEqual(["expected `)` after arguments"]);
    expect(titles(open)).toEqual([]);
  });
});

describe("the parse that checks it", () => {
  test("reads the new call's mark against the dot call's", () => {
    const text = main("export let go(s: Geo.Shape): Unit = s.draw!()");
    const file = new Source.File(1 as Source.FileId, "/main.hex", text);
    const [module] = parseFile(applyLayout(lex(file)), file.path);
    const at = text.indexOf("draw");
    const call = dotCallAt(file, module!, at, at)!;
    const edit = (replacement: string) => ({ start: call.span.start.offset, end: call.span.end.offset, replacement });
    expect(readsAsQualified(file, module!, edit("Geo.draw!(s)"), call)).toBe(true);
    expect(readsAsQualified(file, module!, edit("Geo.draw(s)"), call)).toBe(false);
    expect(readsAsQualified(file, module!, edit("Geo.draw!(s, s)"), call)).toBe(false);
    expect(readsAsQualified(file, module!, edit("Geo.draw!"), call)).toBe(false);
  });
});

describe("the rewrite", () => {
  test("is offered only when the dev asks, as a refactoring, never preferred", () => {
    const { text, at } = marked(main("export let a(s: Geo.Shape): Float = s.ar‸ea()"));
    const opened = session(text);
    expect(opened.codeActions("/main.hex", { start: at, end: at }).map(({ title }) => title)).toEqual([]);
    expect(opened.codeActions("/main.hex", { start: at, end: at }, { invoked: true })
      .map(({ title, kind, preferred }) => ({ title, kind, preferred })))
      .toEqual([{ title: as("Geo.area"), kind: "refactor", preferred: undefined }]);
  });
});
