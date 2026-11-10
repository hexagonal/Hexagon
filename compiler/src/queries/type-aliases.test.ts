import { describe, expect, test } from "vitest";
import { AnalysisSession, type CodeAction } from "../analysis/session.js";
import * as Source from "../support/source.js";
import {
  changed,
  INTRODUCE_TITLE,
  introduceEverywhereTitle,
  readsIntroduced,
  WRITE_OUT_EVERYWHERE_TITLE,
  WRITE_OUT_TITLE,
} from "./type-aliases.js";

const TITLES = [WRITE_OUT_TITLE, WRITE_OUT_EVERYWHERE_TITLE, INTRODUCE_TITLE];
const isAliasTitle = (title: string): boolean => TITLES.includes(title) || title.startsWith(`${INTRODUCE_TITLE} for its `);

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

/** The alias refactorings offered at the caret or selection, by title. */
function offered(source: string, files: Files = {}): ReadonlyMap<string, CodeAction> {
  const { text, start, end } = marked(source);
  return new Map(
    session(text, files).codeActions("/main.hex", { start, end }, { invoked: true })
      .filter(({ kind, title }) => kind === "refactor" && isAliasTitle(title))
      .map((action) => [action.title, action]),
  );
}

const titles = (source: string, files: Files = {}): readonly string[] => [...offered(source, files).keys()];

/** What the program reports, in each of its files. */
function reports(text: string, files: Files = {}): readonly string[] {
  const opened = session(text, files);
  return ["/main.hex", ...Object.keys(files)].flatMap((path) => opened.diagnostics(path).map(({ message }) => message));
}

/**
 * The program after the refactoring named `title` is applied, every edit of
 * it, or why it is refused. The program and what it becomes each report nothing.
 */
function rewritten(source: string, title: string, files: Files = {}): string {
  const action = offered(source, files).get(title);
  if (action === undefined) return "not offered";
  if (action.disabled !== undefined) return `refused: ${action.disabled}`;
  const { text } = marked(source);
  const edits = [...action.edits].sort((left, right) => right.span.start.offset - left.span.start.offset);
  const after = edits.reduce(
    (written, { span, replacement }) => written.slice(0, span.start.offset) + replacement + written.slice(span.end.offset),
    text,
  );
  expect(reports(text, files)).toEqual([]);
  expect(reports(after, files)).toEqual([]);
  return after;
}

describe("an alias written out at a use", () => {
  test("its body in the use's place, the use's arguments in place of its parameters", () => {
    expect(rewritten(program("type Point = (Float, Float)", "export let area(s: Po‸int): Float = 1.0"), WRITE_OUT_TITLE))
      .toBe(program("type Point = (Float, Float)", "export let area(s: (Float, Float)): Float = 1.0"));
    expect(rewritten(program("type Swap(a, b) = (b, a)", "export let p: Sw‸ap(Int, String) = (\"x\", 1)"), WRITE_OUT_TITLE))
      .toBe(program("type Swap(a, b) = (b, a)", "export let p: (String, Int) = (\"x\", 1)"));
    expect(rewritten(program("type Lookup(k, v) = (k) -> Option(v)", "export let find(l: Lo‸okup(String, a)): Unit = ()"), WRITE_OUT_TITLE))
      .toBe(program("type Lookup(k, v) = (k) -> Option(v)", "export let find(l: (String) -> Option(a)): Unit = ()"));
  });

  test("in parentheses where the body or an argument would otherwise parse as another type", () => {
    const HANDLER = "type Handler(a) = a -> Unit";
    // The body where a parameter goes, which as written would take `Unit -> Unit` for its result.
    expect(rewritten(program(HANDLER, "export let run(h: Hand‸ler(Int) -> Unit): Unit = ()"), WRITE_OUT_TITLE))
      .toBe(program(HANDLER, "export let run(h: (Int -> Unit) -> Unit): Unit = ()"));
    // A function argument where the body writes a parameter.
    expect(rewritten(program(HANDLER, "export let run(h: Hand‸ler(Int -> Int)): Unit = ()"), WRITE_OUT_TITLE))
      .toBe(program(HANDLER, "export let run(h: (Int -> Int) -> Unit): Unit = ()"));
    // A tuple argument, which as written would be two parameters.
    expect(rewritten(program(HANDLER, "export let run(h: Hand‸ler((Int, Int))): Unit = ()"), WRITE_OUT_TITLE))
      .toBe(program(HANDLER, "export let run(h: ((Int, Int)) -> Unit): Unit = ()"));
    // Both.
    expect(rewritten(program(HANDLER, "export let run(h: Hand‸ler(Int -> Int) -> Unit): Unit = ()"), WRITE_OUT_TITLE))
      .toBe(program(HANDLER, "export let run(h: ((Int -> Int) -> Unit) -> Unit): Unit = ()"));
    // A body that writes its parameter in parentheses already takes a tuple as it is.
    expect(rewritten(program("type Sink(a) = (a) -> Unit", "export let run(h: Si‸nk((Int, Int))): Unit = ()"), WRITE_OUT_TITLE))
      .toBe(program("type Sink(a) = (a) -> Unit", "export let run(h: ((Int, Int)) -> Unit): Unit = ()"));
    // A tuple's element needs none.
    expect(rewritten(program("type Point = (Float, Float)", "export let p: Vector(Po‸int) = []"), WRITE_OUT_TITLE))
      .toBe(program("type Point = (Float, Float)", "export let p: Vector((Float, Float)) = []"));
  });

  test("wherever a type is written", () => {
    const POINT = "type Point = (Float, Float)";
    const out = (line: string): string => rewritten(program(POINT, line), WRITE_OUT_TITLE);
    expect(out("export let origin(): Po‸int = (0.0, 0.0)")).toBe(program(POINT, "export let origin(): (Float, Float) = (0.0, 0.0)"));
    expect(out("export record Box = { p: Po‸int }")).toBe(program(POINT, "export record Box = { p: (Float, Float) }"));
    expect(out("export union Shape = Dot(at: Po‸int) | Blank")).toBe(program(POINT, "export union Shape = Dot(at: (Float, Float)) | Blank"));
    expect(out("export type Line = (Point, Po‸int)")).toBe(program(POINT, "export type Line = (Point, (Float, Float))"));
    expect(out("export let f(): Point =\n    let q: Po‸int = (1.0, 2.0)\n    q"))
      .toBe(program(POINT, "export let f(): Point =\n    let q: (Float, Float) = (1.0, 2.0)\n    q"));
    expect(out("let g = (p: Po‸int) => p")).toBe(program(POINT, "let g = (p: (Float, Float)) => p"));
    expect(out("export let size(r: {at: Po‸int}): Float = 1.0")).toBe(program(POINT, "export let size(r: {at: (Float, Float)}): Float = 1.0"));
  });

  test("in a pattern declaration's head", () => {
    const source = (result: string): string => program(
      "export record Box = {value: Int}",
      "type Boxed = Box",
      `export pattern boxed(value: Int): ${result}`,
      "    view(box) = box.value",
      "    build(value) = Box({value = value})",
    );
    expect(rewritten(source("Box‸ed"), WRITE_OUT_TITLE)).toBe(source("Box"));
  });

  test("the innermost use around the caret, from its name or its arguments", () => {
    const HANDLER = "type Handler(a) = (a) -> Unit";
    expect(rewritten(program(HANDLER, "export let run(h: Handler(Hand‸ler(Int))): Unit = ()"), WRITE_OUT_TITLE))
      .toBe(program(HANDLER, "export let run(h: Handler((Int) -> Unit)): Unit = ()"));
    expect(rewritten(program(HANDLER, "export let run(h: Handler(Handler(I‸nt))): Unit = ()"), WRITE_OUT_TITLE))
      .toBe(program(HANDLER, "export let run(h: Handler((Int) -> Unit)): Unit = ()"));
    expect(rewritten(program(HANDLER, "export let run(h: Hand‸ler(Handler(Int))): Unit = ()"), WRITE_OUT_TITLE))
      .toBe(program(HANDLER, "export let run(h: (Handler(Int)) -> Unit): Unit = ()"));
  });

  test("its arguments as written, over lines", () => {
    expect(rewritten(
      program("type Lookup(k, v) = (k) -> Option(v)", "export let find(l: Look‸up(", "    String,", "    Int", ")): Unit = ()"),
      WRITE_OUT_TITLE,
    )).toBe(program("type Lookup(k, v) = (k) -> Option(v)", "export let find(l: (String) -> Option(Int)): Unit = ()"));
  });

  test("its arguments' comments kept with them", () => {
    expect(rewritten(program("type Sink(a) = (a) -> Unit", "export let run(h: Si‸nk(Int (* id *))): Unit = ()"), WRITE_OUT_TITLE))
      .toBe(program("type Sink(a) = (a) -> Unit", "export let run(h: (Int (* id *)) -> Unit): Unit = ()"));
  });

  test("a `_` given for a parameter the body writes once", () => {
    expect(rewritten(program("type Maybe(a) = Option(a)", "export let f(): Int =", "    let o: May‸be(_) = Some(1)", "    1"), WRITE_OUT_TITLE))
      .toBe(program("type Maybe(a) = Option(a)", "export let f(): Int =", "    let o: Option(_) = Some(1)", "    1"));
  });

  test("in an honor's implied type and an honor group's item", () => {
    const source = (written: string): string => program(
      "type Count = Int",
      "constraint Source<a> =",
      "    type Item",
      "    get(value: a) -> Item",
      "record Box = {value: Int}",
      "record Bag = {value: Int}",
      "honor",
      "    Source<Box> =",
      `        type Item = ${written}`,
      "        get(box) = box.value",
      "    Show<Bag> =",
      "        show(bag) = \"bag\"",
    );
    expect(rewritten(source("Cou‸nt"), WRITE_OUT_TITLE)).toBe(source("Int"));
  });

  test("a constrained `_`, its constraints with it", () => {
    expect(rewritten(program("type Maybe(a) = Option(a)", "let f(x: Ma‸ybe(_ : Show)): Unit = ()"), WRITE_OUT_TITLE))
      .toBe(program("type Maybe(a) = Option(a)", "let f(x: Option(_ : Show)): Unit = ()"));
    expect(rewritten(program("type Maybe(a) = Option(a)", "let f(x: Ma‸ybe(_ : (Eq, Show))): Unit = ()"), WRITE_OUT_TITLE))
      .toBe(program("type Maybe(a) = Option(a)", "let f(x: Option(_ : (Eq, Show))): Unit = ()"));
    expect(rewritten(program("type Two(a) = (a, Int)", "let f(x: T‸wo(_ : Show)): Unit = ()"), WRITE_OUT_TITLE))
      .toBe(program("type Two(a) = (a, Int)", "let f(x: (_ : Show, Int)): Unit = ()"));
  });

  test("in a file whose lines end in CRLF, from over lines", () => {
    const crlf = (...lines: readonly string[]): string => ["module Main", ...lines, ""].join("\r\n");
    const alias = "type Lookup(k, v) = (k) -> Option(v)";
    expect(rewritten(crlf(alias, "export let find(l: Look‸up(String,", "    Int)): Unit = ()"), WRITE_OUT_TITLE))
      .toBe(crlf(alias, "export let find(l: (String) -> Option(Int)): Unit = ()"));
  });

  test("of an alias of another module's type of its name", () => {
    expect(rewritten(program("import Geo", "type Point = Geo.Point", "export let f(p: Po‸int): Float = p.x"), WRITE_OUT_TITLE, GEO))
      .toBe(program("import Geo", "type Point = Geo.Point", "export let f(p: Geo.Point): Float = p.x"));
  });

  test("in a `fun` block's member", () => {
    const POINT = "type Point = (Float, Float)";
    expect(rewritten(program(POINT, "fun", "    a(p: Po‸int): Float = 1.0", "    b(p: Point): Float = a(p)"), WRITE_OUT_TITLE))
      .toBe(program(POINT, "fun", "    a(p: (Float, Float)): Float = 1.0", "    b(p: Point): Float = a(p)"));
  });
});

describe("an alias written out, refused", () => {
  test("where its body holds a comment", () => {
    expect(rewritten(program("type Point = (Float, (* y *) Float)", "export let area(s: Po‸int): Float = 1.0"), WRITE_OUT_TITLE))
      .toBe("refused: The alias's body holds a comment, which writing it out would copy. Move the comment out first.");
  });

  test("where a `_` would be written twice, and stand for two types", () => {
    expect(rewritten(program("type Pair(a) = (a, a)", "export let f(): Int =", "    let p: Pa‸ir(_) = (1, 2)", "    1"), WRITE_OUT_TITLE))
      .toBe(
        "refused: `Pair` writes `a` in more than one place, and the `_` given for it is one type in all of them; " +
          "written out, each `_` would be a type of its own. Write the type in place of `_` first.",
      );
  });

  test("where a comment would be copied", () => {
    expect(rewritten(program("type Pair(a) = (a, a)", "export let p: Pa‸ir(Int (* n *)) = (1, 2)"), WRITE_OUT_TITLE))
      .toBe("refused: A comment inside it would be copied to each place `Pair` writes `a`. Move the comment out first.");
  });

  test("in a constraint's members, where its implied type takes a name the body writes", () => {
    // There the name means the implied type (reading 10), and the body means the module's.
    const source = (use: string): string => program(
      "record Item = {x: Int}",
      "type Thing = Item",
      "constraint Source<a> =",
      "    type Item",
      `    get(value: a, t: ${use}) -> Int`,
      "record Box = {value: Int}",
      "honor Source<Box> =",
      "    type Item = String",
      "    get(box, t) = t.x",
    );
    expect(rewritten(source("Thi‸ng"), WRITE_OUT_TITLE)).toBe(
      "refused: Inside `Source`'s members `Item` is its implied type, so the alias's body, written out here, would name " +
        "that instead of the `Item` it names now.",
    );
  });

  test("where a comment between its name and its arguments would be lost", () => {
    expect(rewritten(program("type Sink(a) = (a) -> Unit", "export let run(h: Si‸nk (* of ints *) (Int)): Unit = ()"), WRITE_OUT_TITLE))
      .toBe("refused: A comment inside it would be lost. Move the comment out first.");
  });
});

describe("an alias written out, not offered", () => {
  test("on another type, or on a name the alias does not take", () => {
    expect(titles(program("type Point = (Float, Float)", "export let area(s: Point, n: In‸t): Float = 1.0"))).not.toContain(WRITE_OUT_TITLE);
    // Declared twice, the name is in error, and is no one alias's.
    expect(titles(program("type Point = (Float, Float)", "record Point = { x: Float }", "export let area(s: Po‸int): Float = 1.0")))
      .not.toContain(WRITE_OUT_TITLE);
    expect(titles(program("type Point = (Float, Float)", "export union Point = P", "export let area(s: Po‸int): Float = 1.0")))
      .not.toContain(WRITE_OUT_TITLE);
  });

  test("on a use with the wrong number of arguments, or an alias in error", () => {
    expect(titles(program("type Point = (Float, Float)", "extern from \"geo\"", "    type Point", "export let area(s: Po‸int): Float = 1.0")))
      .not.toContain(WRITE_OUT_TITLE);
    expect(titles(program("type Pair(a) = (a, a)", "export let p: Pa‸ir(Int, Int) = (1, 2)"))).not.toContain(WRITE_OUT_TITLE);
    expect(titles(program("type Pair(a) = (a, a)", "export let p: Pa‸ir = (1, 2)"))).not.toContain(WRITE_OUT_TITLE);
    expect(titles(program("type T = Option(T)", "export let p: ‸T = None"))).not.toContain(WRITE_OUT_TITLE);
    expect(titles(program("type T(a) = Option(T(a))", "export let p: ‸T(Int) = None"))).not.toContain(WRITE_OUT_TITLE);
    expect(titles(program("type F(a) = (a) -> b", "export let p(f: ‸F(Int)): Unit = ()"))).not.toContain(WRITE_OUT_TITLE);
  });

  test("where a constraint's implied type of the same name stands", () => {
    const source = program(
      "type Item = String",
      "constraint Source<a> =",
      "    type Item",
      "    get(value: a) -> It‸em",
    );
    expect(titles(source)).not.toContain(WRITE_OUT_TITLE);
  });

  test("but offered in an honor's body, where its implied type cannot be written (Collections Part 2 §7.3)", () => {
    const honored = (written: string): string => program(
      "type Item = String",
      "constraint Source<a> =",
      "    type Item",
      "    get(value: a) -> Item",
      "record Box = {value: Int}",
      "honor Source<Box> =",
      "    type Item = Int",
      "    get(box) =",
      `        let label: ${written} = "box"`,
      "        box.value",
    );
    expect(rewritten(honored("It‸em"), WRITE_OUT_TITLE)).toBe(honored("String"));
  });
});

/** A module of the program besides `Main`, in its own file. */
const beside = (name: string, ...lines: readonly string[]): Files => ({
  [`/${name.toLowerCase()}.hex`]: [`module ${name}`, ...lines, ""].join("\n"),
});

const GEO = beside(
  "Geo",
  "export record Point = { x: Float, y: Float }",
  "export type Segment = (Point, Point)",
  "export type Pair(a) = (a, Point)",
  "export type Lookup(v) = (String) -> Option(v)",
);

describe("another module's alias written out where it is imported", () => {
  test("its body, each name in it as this module reaches the type, the use's arguments in place of its parameters", () => {
    expect(rewritten(program("import Geo", "export let length(s: Geo.Seg‸ment): Float = 1.0"), WRITE_OUT_TITLE, GEO))
      .toBe(program("import Geo", "export let length(s: (Geo.Point, Geo.Point)): Float = 1.0"));
    expect(rewritten(program("import Geo as G", "export let length(s: G.Pa‸ir(String)): Float = 1.0"), WRITE_OUT_TITLE, GEO))
      .toBe(program("import Geo as G", "export let length(s: (String, G.Point)): Float = 1.0"));
    // The prelude's and the compiler's own types, bare.
    expect(rewritten(program("import Geo", "export let find(l: Geo.Look‸up(Int)): Unit = ()"), WRITE_OUT_TITLE, GEO))
      .toBe(program("import Geo", "export let find(l: (String) -> Option(Int)): Unit = ()"));
  });

  test("from its qualifier, and the innermost use around the caret", () => {
    const pairs = { ...GEO, ...beside("Two", "export type Both(a) = (a, a)") };
    const source = (use: string): string => program("import Geo", "import Two", `export let length(s: ${use}): Float = 1.0`);
    expect(rewritten(source("Tw‸o.Both(Geo.Segment)"), WRITE_OUT_TITLE, pairs))
      .toBe(source("(Geo.Segment, Geo.Segment)"));
    expect(rewritten(source("Two.Both(Geo.Seg‸ment)"), WRITE_OUT_TITLE, pairs))
      .toBe(source("Two.Both((Geo.Point, Geo.Point))"));
  });

  test("bare, where it is reached through the companion fallback, and naming types the same way", () => {
    const point = beside("Point", "export record Point = { x: Float }");
    const geo = { ...point, ...beside("Geo", "import Point", "export type Segment = (Point, Point)") };
    expect(rewritten(program("import Geo", "import Point", "export let length(s: Geo.Seg‸ment): Float = 1.0"), WRITE_OUT_TITLE, geo))
      .toBe(program("import Geo", "import Point", "export let length(s: (Point, Point)): Float = 1.0"));
    expect(rewritten(program("import Geo", "import Point as P", "export let length(s: Geo.Seg‸ment): Float = 1.0"), WRITE_OUT_TITLE, geo))
      .toBe(program("import Geo", "import Point as P", "export let length(s: (P.Point, P.Point)): Float = 1.0"));
    const rat = beside("Rat", "export type Rat = (Int, Int)");
    expect(rewritten(program("import Rat", "export let half(r: R‸at): Float = 1.0"), WRITE_OUT_TITLE, rat))
      .toBe(program("import Rat", "export let half(r: (Int, Int)): Float = 1.0"));
  });

  test("a prelude type this module's own declaration takes the name of, through the prelude's module", () => {
    expect(rewritten(
      program("import Geo", "union Option = Yes | No", "export let find(l: Geo.Look‸up(Int)): Unit = ()"),
      WRITE_OUT_TITLE,
      GEO,
    )).toBe(program("import Geo", "union Option = Yes | No", "export let find(l: (String) -> Option.Option(Int)): Unit = ()"));
  });

  test("an alias its module exports kept, and one it keeps to itself written out", () => {
    const geo = beside(
      "Geo",
      "export record Point = { x: Float }",
      "export type Pt = Point",
      "export type Segment = (Pt, Pt)",
      "type Inner(x, y) = (y, x)",
      "export type Pair(a) = Inner(Point, a)",
      "type Step = Int -> Int",
      "export type Steps = Step -> Int",
      "type Two = (Int, Int)",
      "export type Sum = Two -> Int",
    );
    const source = (type: string): string => program("import Geo", `export let run(s: ${type}): Unit = ()`);
    expect(rewritten(source("Geo.Seg‸ment"), WRITE_OUT_TITLE, geo)).toBe(source("(Geo.Pt, Geo.Pt)"));
    expect(rewritten(source("Geo.Pa‸ir(String)"), WRITE_OUT_TITLE, geo)).toBe(source("(String, Geo.Point)"));
    // In parentheses where a function or a tuple written out would otherwise be another type.
    expect(rewritten(source("Geo.St‸eps"), WRITE_OUT_TITLE, geo)).toBe(source("(Int -> Int) -> Int"));
    expect(rewritten(source("Geo.S‸um"), WRITE_OUT_TITLE, geo)).toBe(source("((Int, Int)) -> Int"));
  });

  test("one it keeps to itself inside another, or given a function, in parentheses where it needs them", () => {
    const geo = beside(
      "Geo",
      "type Step = Int -> Int",
      "type Steps = Step -> Int",
      "export type Via = Steps",
      "type Apply(x) = x -> Int",
      "export type Applied = Apply(Int -> Int)",
      "export record Point = { x: Float }",
      "type Inner(x, y) = (y, x)",
      "export type From(a) = (Inner(Point, a)) -> Int",
    );
    const source = (type: string): string => program("import Geo", `export let run(s: ${type}): Unit = ()`);
    expect(rewritten(source("Geo.V‸ia"), WRITE_OUT_TITLE, geo)).toBe(source("(Int -> Int) -> Int"));
    expect(rewritten(source("Geo.Appl‸ied"), WRITE_OUT_TITLE, geo)).toBe(source("(Int -> Int) -> Int"));
    expect(rewritten(source("Geo.Fr‸om(String)"), WRITE_OUT_TITLE, geo)).toBe(source("((String, Geo.Point)) -> Int"));
    // Written in parentheses there already, it goes inside them.
    const grouped = beside("Geo", "type Step = Int -> Int", "export type Paired = ((Step), Int)");
    expect(rewritten(source("Geo.Pai‸red"), WRITE_OUT_TITLE, grouped)).toBe(source("((Int -> Int), Int)"));
  });

  test("each name in a record's fields and a function's parameters and result", () => {
    const geo = beside(
      "Geo",
      "export record Point = { x: Float }",
      "export type Placed = {at: Point, name: String}",
      "export type Visit = (Point) -> Unit",
      "export type Make = () -> Point",
    );
    const source = (type: string): string => program("import Geo", `export let run(s: ${type}): Unit = ()`);
    expect(rewritten(source("Geo.Pla‸ced"), WRITE_OUT_TITLE, geo)).toBe(source("{at: Geo.Point, name: String}"));
    expect(rewritten(source("Geo.Vis‸it"), WRITE_OUT_TITLE, geo)).toBe(source("(Geo.Point) -> Unit"));
    expect(rewritten(source("Geo.Ma‸ke"), WRITE_OUT_TITLE, geo)).toBe(source("() -> Geo.Point"));
  });

  test("a type a third module declares, through this module's import of it", () => {
    const web = beside("Web", "export record Params = { q: String }", "export type Query = String");
    const geo = { ...web, ...beside("Geo", "import Web as W", "export type Request = (W.Params, W.Query)") };
    expect(rewritten(program("import Geo", "import Web", "export let send(r: Geo.Requ‸est): Unit = ()"), WRITE_OUT_TITLE, geo))
      .toBe(program("import Geo", "import Web", "export let send(r: (Web.Params, Web.Query)): Unit = ()"));
    // A private alias of the same name there is not the one its qualifier names.
    const shadowed = { ...web, ...beside("Geo", "import Web as W", "type Params = Int", "export type Request = W.Params") };
    expect(rewritten(program("import Geo", "import Web", "export let send(r: Geo.Requ‸est): Unit = ()"), WRITE_OUT_TITLE, shadowed))
      .toBe(program("import Geo", "import Web", "export let send(r: Web.Params): Unit = ()"));
  });

  test("through this module's first import of the module, and qualified where its own type takes the name", () => {
    const geo = beside("Geo", "export record Point = { x: Float }", "export type Segment = (Point, Point)");
    expect(rewritten(program("import Geo", "import Geo as G", "export let run(s: G.Seg‸ment): Unit = ()"), WRITE_OUT_TITLE, geo))
      .toBe(program("import Geo", "import Geo as G", "export let run(s: (Geo.Point, Geo.Point)): Unit = ()"));
    const point = beside("Point", "export record Point = { x: Float }");
    const through = { ...point, ...beside("Geo", "import Point", "export type Segment = (Point, Point)") };
    const source = (type: string): string => program("import Geo", "import Point", "record Point = { y: Int }", `export let run(s: ${type}): Unit = ()`);
    expect(rewritten(source("Geo.Seg‸ment"), WRITE_OUT_TITLE, through)).toBe(source("(Point.Point, Point.Point)"));
    // Or a constraint's implied type.
    const implied = (type: string): string => program(
      "import Geo",
      "import Point",
      "constraint Source<a> =",
      "    type Point",
      "    get(value: a) -> Point",
      `export let run(s: ${type}): Unit = ()`,
    );
    expect(rewritten(implied("Geo.Seg‸ment"), WRITE_OUT_TITLE, through)).toBe(implied("(Point.Point, Point.Point)"));
    // An import of another module that takes the name reaches that module's type, not Geo's.
    const other = { ...geo, ...beside("Other", "export record Point = { o: Int }") };
    const aliased = (type: string): string => program("import Geo", "import Other as Point", `export let run(s: ${type}): Unit = ()`);
    expect(rewritten(aliased("Geo.Seg‸ment"), WRITE_OUT_TITLE, other)).toBe(aliased("(Geo.Point, Geo.Point)"));
  });

  test("a prelude type its module names, where an import there takes the name but brings no such type", () => {
    const rat = beside("Rat", "export type Rat = (Int, Int)");
    const geo = { ...rat, ...beside("Geo", "import Rat as Option", "export type Maybe = Option(Int)", "export type Ints = Seq(Int)") };
    const source = (type: string): string => program("import Geo", `export let run(s: ${type}): Unit = ()`);
    expect(rewritten(source("Geo.May‸be"), WRITE_OUT_TITLE, geo)).toBe(source("Option(Int)"));
    expect(rewritten(source("Geo.In‸ts"), WRITE_OUT_TITLE, geo)).toBe(source("Seq(Int)"));
    // An import of a module the program does not have brings nothing, though its module reports it.
    const nowhere = beside("Geo", "import Nowhere as Option", "export type Maybe = Option(Int)");
    const action = offered(source("Geo.May‸be"), nowhere).get(WRITE_OUT_TITLE);
    expect(action?.disabled).toBeUndefined();
    const { text } = marked(source("Geo.May‸be"));
    const [edit] = action!.edits;
    expect(text.slice(0, edit!.span.start.offset) + edit!.replacement + text.slice(edit!.span.end.offset)).toBe(source("Option(Int)"));
  });

  test("an extern type it names, through the module that declares it", () => {
    const geo = beside("Geo", "extern from \"widgets\"", "    export type Widget", "export type Tagged = (Widget, Int)");
    expect(rewritten(program("import Geo", "export let show(w: Geo.Tag‸ged): Unit = ()"), WRITE_OUT_TITLE, geo))
      .toBe(program("import Geo", "export let show(w: (Geo.Widget, Int)): Unit = ()"));
  });

  test("the compiler's boundary types, bare", () => {
    const geo = beside("Geo", "export type Foreign = (JsValue, Nullable(Int))");
    expect(rewritten(program("import Geo", "export let take(f: Geo.Fore‸ign): Unit = ()"), WRITE_OUT_TITLE, geo))
      .toBe(program("import Geo", "export let take(f: (JsValue, Nullable(Int))): Unit = ()"));
  });

  test("in parentheses where an argument would otherwise parse as another type", () => {
    const geo = beside("Geo", "export type Handler(a) = a -> Unit");
    expect(rewritten(program("import Geo", "export let run(h: Geo.Hand‸ler(Int -> Int)): Unit = ()"), WRITE_OUT_TITLE, geo))
      .toBe(program("import Geo", "export let run(h: (Int -> Int) -> Unit): Unit = ()"));
  });

  test("not this module's alias of the same name, nor that one as the other module's", () => {
    const geo = beside("Geo", "export type Point = (Float, Float)", "export type Pair(a) = (a, a)");
    const source = (first: string, second: string): string =>
      program("import Geo", "type Point = (Int, Int)", "type Pair(a) = (a, String)", `export let area(s: ${first}, t: ${second}): Float = 1.0`);
    expect(rewritten(source("Geo.Po‸int", "Pair(Int)"), WRITE_OUT_TITLE, geo)).toBe(source("(Float, Float)", "Pair(Int)"));
    expect(rewritten(source("Geo.Pa‸ir(Int)", "Pair(Int)"), WRITE_OUT_TITLE, geo)).toBe(source("(Int, Int)", "Pair(Int)"));
    expect(rewritten(source("Geo.Point", "Pa‸ir(Int)"), WRITE_OUT_TITLE, geo)).toBe(source("Geo.Point", "(Int, String)"));
  });
});

describe("another module's alias written out, refused", () => {
  test("where it names a type this module does not import, naming the import", () => {
    const web = beside("Web", "export record Params = { q: String }");
    const geo = { ...web, ...beside("Geo", "import Web", "export type Request = (Web.Params, Int)") };
    expect(rewritten(program("import Geo", "export let send(r: Geo.Requ‸est): Unit = ()"), WRITE_OUT_TITLE, geo)).toBe(
      "refused: `Geo.Request` names `Params`, declared in `Web`, which this module does not import. Write `import Web` first.",
    );
  });

  test("where this module's own type takes the name of a compiler's or the prelude's type it names", () => {
    const geo = beside("Geo", "export type Pair = (Float, Float)", "export type Ints = Vector(Int)");
    expect(rewritten(program("import Geo", "record Float = { f: Int }", "export let run(p: Geo.Pa‸ir): Unit = ()"), WRITE_OUT_TITLE, geo))
      .toBe("refused: `Geo.Pair` names the compiler's `Float`, and a type this module reaches takes that name here.");
    expect(rewritten(program("import Geo", "record Vector = { v: Int }", "export let run(p: Geo.In‸ts): Unit = ()"), WRITE_OUT_TITLE, geo))
      .toBe("refused: `Geo.Ints` names the prelude's `Vector`, and a type this module reaches takes that name here.");
    // A prelude union taken bare, and its module's name taken by an import.
    const rat = beside("Rat", "export type Rat = (Int, Int)");
    expect(rewritten(
      program("import Geo", "import Rat as Option", "union Option = Yes | No", "export let find(l: Geo.Look‸up(Int)): Unit = ()"),
      WRITE_OUT_TITLE,
      { ...GEO, ...rat },
    )).toBe("refused: `Geo.Lookup` names the prelude's `Option`, and a type this module reaches takes that name here.");
    // But an import of the name that brings no such type takes nothing.
    expect(rewritten(program("import Geo", "import Rat as Option", "export let find(l: Geo.Look‸up(Int)): Unit = ()"), WRITE_OUT_TITLE, { ...GEO, ...rat }))
      .toBe(program("import Geo", "import Rat as Option", "export let find(l: (String) -> Option(Int)): Unit = ()"));
    const vector = beside("Vec", "export type Vec = Int");
    expect(rewritten(program("import Geo", "import Vec as Vector", "export let run(p: Geo.In‸ts): Unit = ()"), WRITE_OUT_TITLE, { ...geo, ...vector }))
      .toBe(program("import Geo", "import Vec as Vector", "export let run(p: Vector(Int)): Unit = ()"));
    // Taken by an import that brings a type of the name, or by a constraint's implied type.
    const records = beside("Vec", "export record Vector = { v: Int }");
    expect(rewritten(program("import Geo", "import Vec as Vector", "export let run(p: Geo.In‸ts): Unit = ()"), WRITE_OUT_TITLE, { ...geo, ...records }))
      .toBe("refused: `Geo.Ints` names the prelude's `Vector`, and a type this module reaches takes that name here.");
    expect(rewritten(
      program("import Geo", "constraint Source<a> =", "    type Vector", "    get(value: a) -> Vector", "export let run(p: Geo.In‸ts): Unit = ()"),
      WRITE_OUT_TITLE,
      geo,
    )).toBe("refused: `Geo.Ints` names the prelude's `Vector`, and a type this module reaches takes that name here.");
  });

  test("where this module takes the name of a compiler's boundary type it names", () => {
    const geo = beside("Geo", "export type Foreign = (JsValue, Nullable(Int))");
    const source = (...lines: readonly string[]): string => program("import Geo", ...lines, "export let take(f: Geo.Fore‸ign): Unit = ()");
    expect(rewritten(source("record JsValue = { v: Int }"), WRITE_OUT_TITLE, geo))
      .toBe("refused: `Geo.Foreign` names the compiler's `JsValue`, and a type this module reaches takes that name here.");
    expect(rewritten(source("record Nullable(a) = { v: a }"), WRITE_OUT_TITLE, geo))
      .toBe("refused: `Geo.Foreign` names the compiler's `Nullable`, and a type this module reaches takes that name here.");
    // A bare `JsValue` is read after the implied types' names, which take it anywhere in the module.
    expect(rewritten(source("constraint Source<a> =", "    type JsValue", "    get(value: a) -> Int"), WRITE_OUT_TITLE, geo))
      .toBe("refused: `Geo.Foreign` names the compiler's `JsValue`, and a type this module reaches takes that name here.");
  });

  test("in a constraint's members, where its implied type takes a name the body is spelled with, but not outside them", () => {
    const geo = beside("Geo", "export type Pred = (Int) -> Bool", "export type Ints = (Int, Int)", "export type Find = (String) -> Option(Int)");
    const source = (implied: string, member: string, outside: string): string => program(
      "import Geo",
      "constraint Source<a> =",
      `    type ${implied}`,
      `    test(value: a, p: ${member}) -> String`,
      `export let run(p: ${outside}): Unit = ()`,
    );
    const refusal = (name: string): string =>
      `refused: Inside \`Source\`'s members \`${name}\` is its implied type, so the alias's body, written out here, would name ` +
      `that instead of the \`${name}\` it names now.`;
    expect(rewritten(source("Bool", "Geo.Pr‸ed", "Geo.Pred"), WRITE_OUT_TITLE, geo)).toBe(refusal("Bool"));
    expect(rewritten(source("Int", "Geo.In‸ts", "Geo.Pred"), WRITE_OUT_TITLE, geo)).toBe(refusal("Int"));
    expect(rewritten(source("Option", "Geo.Fi‸nd", "Geo.Pred"), WRITE_OUT_TITLE, geo)).toBe(refusal("Option"));
    expect(rewritten(source("Bool", "Geo.Pred", "Geo.Pr‸ed"), WRITE_OUT_TITLE, geo)).toBe(source("Bool", "Geo.Pred", "(Int) -> Bool"));
  });

  test("where its body, or the body of an alias it writes out, holds a comment", () => {
    const geo = beside("Geo", "export type Pair = (Int, (* the second *) Int)", "type Inner = (Int, (* the second *) Int)", "export type Outer = Option(Inner)");
    expect(rewritten(program("import Geo", "export let run(p: Geo.Pa‸ir): Unit = ()"), WRITE_OUT_TITLE, geo))
      .toBe("refused: The alias's body holds a comment, which writing it out would copy. Move the comment out first.");
    expect(rewritten(program("import Geo", "export let run(p: Geo.Out‸er): Unit = ()"), WRITE_OUT_TITLE, geo))
      .toBe("refused: The alias's body holds a comment, which writing it out would copy. Move the comment out first.");
  });

  test("where it names a type its module does not export", () => {
    // Which its module reports.
    const geo = beside("Geo", "record Hidden = { h: Int }", "export type Shown = (Hidden, Int)");
    const action = offered(program("import Geo", "export let run(p: Geo.Sh‸own): Unit = ()"), geo).get(WRITE_OUT_TITLE);
    expect(action?.disabled).toBe("`Geo.Shown` names `Hidden`, which `Geo` does not export, so this module cannot write it.");
    const extern = beside("Geo", "extern from \"widgets\"", "    type Widget", "export type Tagged = (Widget, Int)");
    expect(offered(program("import Geo", "export let show(w: Geo.Tag‸ged): Unit = ()"), extern).get(WRITE_OUT_TITLE)?.disabled)
      .toBe("`Geo.Tagged` names `Widget`, which `Geo` does not export, so this module cannot write it.");
  });
});

describe("another module's alias written out, not offered", () => {
  test("for an alias it keeps to itself, or a use with the wrong number of arguments", () => {
    const geo = beside("Geo", "type Inner = (Int, Int)", "export type Pair(a) = (a, a)");
    expect(titles(program("import Geo", "export let run(p: Geo.Inn‸er): Unit = ()"), geo)).not.toContain(WRITE_OUT_TITLE);
    expect(titles(program("import Geo", "export let run(p: Geo.Pa‸ir(Int, Int)): Unit = ()"), geo)).not.toContain(WRITE_OUT_TITLE);
    expect(titles(program("import Geo", "export let run(p: Geo.Pa‸ir): Unit = ()"), geo)).not.toContain(WRITE_OUT_TITLE);
  });

  test("for an alias whose body its module reports: a cycle, a wrong number of arguments, an unknown name, an implied type", () => {
    // Each of which its module reports.
    const source = (type: string): string => program("import Geo", `export let run(s: ${type}): Unit = ()`);
    const bodies: readonly (readonly string[])[] = [
      ["type A = B", "type B = A", "export type Alias = A"],
      ["type Inner(x) = (x, x)", "export type Alias = Inner"],
      ["export type Alias = Nope"],
      ["import Nowhere", "export type Alias = (Nowhere.Thing, Int)"],
      ["import Point", "constraint Source<a> =", "    type Point", "    get(value: a) -> Point", "export type Alias = (Point, Point)"],
      // A prelude type given the wrong number of arguments: `Range` takes none, and `Result` one.
      ["export type Alias = (Range(Int), Int)"],
      ["export type Alias = Result(Int, String)"],
    ];
    const point = beside("Point", "export record Point = { x: Float }");
    for (const body of bodies) {
      expect(titles(source("Geo.Al‸ias"), { ...point, ...beside("Geo", ...body) })).not.toContain(WRITE_OUT_TITLE);
    }
  });

  test("for a name this module declares itself or a constraint of it takes", () => {
    const rat = beside("Rat", "export type Rat = (Int, Int)");
    expect(rewritten(program("import Rat", "type Rat = Int", "export let half(r: R‸at): Float = 1.0"), WRITE_OUT_TITLE, rat))
      .toBe(program("import Rat", "type Rat = Int", "export let half(r: Int): Float = 1.0"));
    expect(titles(program("import Rat", "record Rat = { n: Int }", "export let half(r: R‸at): Float = 1.0"), rat)).not.toContain(WRITE_OUT_TITLE);
    expect(titles(
      program("import Rat", "constraint Source<a> =", "    type Rat", "    get(value: a) -> R‸at"),
      rat,
    )).not.toContain(WRITE_OUT_TITLE);
  });
});

describe("an alias written out everywhere", () => {
  test("every use, and the declaration, with a blank line where it stood between two", () => {
    expect(rewritten(
      program(
        "type Po‸int = (Float, Float)",
        "",
        "export let area(s: Point): Float = 1.0",
        "",
        "export let move(s: Point, by: Float): Point = s",
      ),
      WRITE_OUT_EVERYWHERE_TITLE,
    )).toBe(program(
      "",
      "export let area(s: (Float, Float)): Float = 1.0",
      "",
      "export let move(s: (Float, Float), by: Float): (Float, Float) = s",
    ));
    expect(rewritten(
      program("export let n: Int = 1", "", "type Po‸int = (Float, Float)", "", "export let area(s: Point): Float = 1.0"),
      WRITE_OUT_EVERYWHERE_TITLE,
    )).toBe(program("export let n: Int = 1", "", "export let area(s: (Float, Float)): Float = 1.0"));
  });

  test("an exported alias's uses, the declaration kept for other modules", () => {
    expect(rewritten(
      program("export type Po‸int = (Float, Float)", "", "export let area(s: Point): Float = 1.0"),
      WRITE_OUT_EVERYWHERE_TITLE,
    )).toBe(program("export type Point = (Float, Float)", "", "export let area(s: (Float, Float)): Float = 1.0"));
  });

  test("a use inside another's argument, written out where the outer body puts it", () => {
    expect(rewritten(
      program("type Hand‸ler(a) = a -> Unit", "export let run(h: Handler(Handler(Int))): Unit = ()"),
      WRITE_OUT_EVERYWHERE_TITLE,
    )).toBe(program("export let run(h: (Int -> Unit) -> Unit): Unit = ()"));
    expect(rewritten(
      program("type Pa‸ir(a) = (a, a)", "export let p: Pair(Pair(Int)) = ((1, 2), (3, 4))"),
      WRITE_OUT_EVERYWHERE_TITLE,
    )).toBe(program("export let p: ((Int, Int), (Int, Int)) = ((1, 2), (3, 4))"));
  });

  test("uses in a `fun` block's members and in another alias's body", () => {
    expect(rewritten(
      program(
        "type Po‸int = (Float, Float)",
        "export type Line = (Point, Point)",
        "fun",
        "    a(p: Point): Float = 1.0",
        "    b(p: Point): Float = a(p)",
      ),
      WRITE_OUT_EVERYWHERE_TITLE,
    )).toBe(program(
      "export type Line = ((Float, Float), (Float, Float))",
      "fun",
      "    a(p: (Float, Float)): Float = 1.0",
      "    b(p: (Float, Float)): Float = a(p)",
    ));
  });

  test("the declaration alone where another item shares its line, with the `;` between them", () => {
    const uses = "export let area(s: Point): Float = 1.0";
    const written = "export let area(s: (Float, Float)): Float = 1.0";
    expect(rewritten(program("type Po‸int = (Float, Float); export let n: Int = 1", uses), WRITE_OUT_EVERYWHERE_TITLE))
      .toBe(program("export let n: Int = 1", written));
    expect(rewritten(program("export let n: Int = 1; type Po‸int = (Float, Float)", "export let m: Int = n", uses), WRITE_OUT_EVERYWHERE_TITLE))
      .toBe(program("export let n: Int = 1", "export let m: Int = n", written));
    expect(rewritten(program("export let n: Int = 1; type Po‸int = (Float, Float)  ", uses), WRITE_OUT_EVERYWHERE_TITLE))
      .toBe(program("export let n: Int = 1", written));
    expect(rewritten(program("let a: Int = 1; type Po‸int = (Float, Float);  export let b: Int = a", uses), WRITE_OUT_EVERYWHERE_TITLE))
      .toBe(program("let a: Int = 1; export let b: Int = a", written));
    // A comment after the other item is that item's, and stays.
    expect(rewritten(program("type Po‸int = (Float, Float); export let n: Int = 1 // n", uses), WRITE_OUT_EVERYWHERE_TITLE))
      .toBe(program("export let n: Int = 1 // n", written));
  });

  test("the declaration kept where an honor's subject names it", () => {
    const source = (use: string): string =>
      program("export record Box = {v: Int}", "type B‸x = Box", "honor Show<Bx> =", "    show(b) = \"box\"", `export let f(b: ${use}): Int = 1`);
    expect(rewritten(source("Bx"), WRITE_OUT_EVERYWHERE_TITLE)).toBe(source("Box").replace("‸", ""));
  });

  test("the declaration as the file's last line", () => {
    expect(rewritten("module Main\nexport let area(s: Point): Float = 1.0\ntype Po‸int = (Float, Float)", WRITE_OUT_EVERYWHERE_TITLE))
      .toBe("module Main\nexport let area(s: (Float, Float)): Float = 1.0\n");
    expect(rewritten("module Main\nexport let area(s: Point): Float = 1.0\nexport let n: Int = 1; type Po‸int = (Float, Float)", WRITE_OUT_EVERYWHERE_TITLE))
      .toBe("module Main\nexport let area(s: (Float, Float)): Float = 1.0\nexport let n: Int = 1");
  });

  test("uses in an honor group's items", () => {
    const source = (count: string, alias: readonly string[]): string => program(
      ...alias,
      "constraint Source<a> =",
      "    type Item",
      "    get(value: a) -> Item",
      "record Box = {value: Int}",
      "record Bag = {value: Int}",
      "honor",
      "    Source<Box> =",
      `        type Item = ${count}`,
      "        get(box) = box.value",
      "    Source<Bag> =",
      `        type Item = ${count}`,
      "        get(bag) = bag.value",
    );
    expect(rewritten(source("Count", ["type Cou‸nt = Int"]), WRITE_OUT_EVERYWHERE_TITLE)).toBe(source("Int", []));
  });

  test("not offered where it would write the alias out more than 256 times", () => {
    const nested = (depth: number): string => depth === 0 ? "Int" : `Pair(${nested(depth - 1)})`;
    const source = (depth: number): string => program("type Pa‸ir(a) = (a, a)", "", `export let p(x: ${nested(depth)}): Unit = ()`);
    expect(titles(source(8))).toContain(WRITE_OUT_EVERYWHERE_TITLE);
    expect(titles(source(9))).not.toContain(WRITE_OUT_EVERYWHERE_TITLE);
  });

  test("refused where a comment is on the declaration that would go, but not on one that stays", () => {
    const lost = "refused: A comment on the alias would be lost with its declaration. Move the comment out first.";
    const uses = "export let area(s: Point): Float = 1.0";
    expect(rewritten(program("(** A point. *)", "type Po‸int = (Float, Float)", uses), WRITE_OUT_EVERYWHERE_TITLE)).toBe(lost);
    expect(rewritten(program("// A point.", "type Po‸int = (Float, Float)", uses), WRITE_OUT_EVERYWHERE_TITLE)).toBe(lost);
    expect(rewritten(program("type Po‸int = (Float, Float) // A point.", uses), WRITE_OUT_EVERYWHERE_TITLE)).toBe(lost);
    // Where another item shares its line, the comments its declaration would leave on that item.
    expect(rewritten(program("export let n: Int = 1; type Po‸int = (Float, Float) // A point.", uses), WRITE_OUT_EVERYWHERE_TITLE))
      .toBe(lost);
    expect(rewritten(program("(** A point. *)", "type Po‸int = (Float, Float); export let n: Int = 1", uses), WRITE_OUT_EVERYWHERE_TITLE))
      .toBe(lost);
    expect(rewritten(program("let a: Int = 1; type Po‸int = (* a point *) (Float, Float); export let b: Int = a", uses), WRITE_OUT_EVERYWHERE_TITLE))
      .toBe(lost);
    expect(rewritten(program("let a: Int = 1; type Po‸int = (Float, Float) (* a point *); export let b: Int = a", uses), WRITE_OUT_EVERYWHERE_TITLE))
      .toBe(lost);
    // A comment that ends the line above is that line's.
    expect(rewritten(program("export let n: Int = 1 // one", "type Po‸int = (Float, Float)", uses), WRITE_OUT_EVERYWHERE_TITLE))
      .toBe(program("export let n: Int = 1 // one", "export let area(s: (Float, Float)): Float = 1.0"));
    expect(rewritten(program("// About n.", "export let n: Int = 1; type Po‸int = (Float, Float)", uses), WRITE_OUT_EVERYWHERE_TITLE))
      .toBe(program("// About n.", "export let n: Int = 1", "export let area(s: (Float, Float)): Float = 1.0"));
    expect(rewritten(program("// About a.", "let a: Int = 1; type Po‸int = (Float, Float); export let b: Int = a", uses), WRITE_OUT_EVERYWHERE_TITLE))
      .toBe(program("// About a.", "let a: Int = 1; export let b: Int = a", "export let area(s: (Float, Float)): Float = 1.0"));
    // A comment with a blank line between is not the declaration's, and stays.
    expect(rewritten(program("// Shapes.", "", "type Po‸int = (Float, Float)", "", uses), WRITE_OUT_EVERYWHERE_TITLE))
      .toBe(program("// Shapes.", "", "export let area(s: (Float, Float)): Float = 1.0"));
    expect(rewritten(program("(** A point. *)", "export type Po‸int = (Float, Float)", uses), WRITE_OUT_EVERYWHERE_TITLE))
      .toBe(program("(** A point. *)", "export type Point = (Float, Float)", "export let area(s: (Float, Float)): Float = 1.0"));
  });

  test("refused where its body holds a comment, or a use cannot be written out", () => {
    expect(rewritten(program("type Po‸int = (Float, (* y *) Float)", "export let area(s: Point): Float = 1.0"), WRITE_OUT_EVERYWHERE_TITLE))
      .toBe("refused: The alias's body holds a comment, which writing it out would copy. Move the comment out first.");
    expect(rewritten(
      program("type Pa‸ir(a) = (a, a)", "export let p: Pair(Int) = (1, 2)", "export let f(): Int =", "    let q: Pair(_) = (1, 2)", "    1"),
      WRITE_OUT_EVERYWHERE_TITLE,
    )).toBe(
      "refused: `Pair` writes `a` in more than one place, and the `_` given for it is one type in all of them; " +
        "written out, each `_` would be a type of its own. Write the type in place of `_` first.",
    );
    expect(rewritten(
      program("type P‸red = (Int) -> Bool", "constraint Source<a> =", "    type Bool", "    get(value: a, p: Pred) -> Int", "export let f(p: Pred): Int = 1"),
      WRITE_OUT_EVERYWHERE_TITLE,
    )).toBe(
      "refused: Inside `Source`'s members `Bool` is its implied type, so the alias's body, written out here, would name " +
        "that instead of the `Bool` it names now.",
    );
  });

  test("not offered with no use, or off the alias's name", () => {
    expect(titles(program("type Po‸int = (Float, Float)", "export let n: Int = 1"))).not.toContain(WRITE_OUT_EVERYWHERE_TITLE);
    expect(titles(program("‸type Point = (Float, Float)", "export let area(s: Point): Float = 1.0"))).not.toContain(WRITE_OUT_EVERYWHERE_TITLE);
    expect(titles(program("type Point = (Float, Fl‸oat)", "export let area(s: Point): Float = 1.0"))).not.toContain(WRITE_OUT_EVERYWHERE_TITLE);
  });
});

describe("an alias introduced", () => {
  test("for the whole type the caret is in, above the item, with the alias in its place", () => {
    expect(rewritten(program("export let area(s: (Float, Fl‸oat)): Float = 1.0"), INTRODUCE_TITLE))
      .toBe(program("type NewType = (Float, Float)", "", "export let area(s: NewType): Float = 1.0"));
    expect(rewritten(program("export let origin(): (Float, Fl‸oat) = (0.0, 0.0)"), INTRODUCE_TITLE))
      .toBe(program("type NewType = (Float, Float)", "", "export let origin(): NewType = (0.0, 0.0)"));
    expect(rewritten(program("export record Box = { p: (Float, Fl‸oat) }"), INTRODUCE_TITLE))
      .toBe(program("type NewType = (Float, Float)", "", "export record Box = { p: NewType }"));
    expect(rewritten(program("export type Line = ((Float, Float), (Float, Fl‸oat))"), INTRODUCE_TITLE))
      .toBe(program("type NewType = ((Float, Float), (Float, Float))", "", "export type Line = NewType"));
  });

  test("its type variables its parameters, in the order the type first writes them", () => {
    expect(rewritten(program("export let f(g: (a) -> Opt‸ion(a)): Unit = ()"), INTRODUCE_TITLE))
      .toBe(program("type NewType(a) = (a) -> Option(a)", "", "export let f(g: NewType(a)): Unit = ()"));
    expect(rewritten(program("export let f(g: (b, a) -> Opt‸ion((a, b))): Unit = ()"), INTRODUCE_TITLE))
      .toBe(program("type NewType(b, a) = (b, a) -> Option((a, b))", "", "export let f(g: NewType(b, a)): Unit = ()"));
  });

  test("for the one type a selection covers, with its parentheses or without", () => {
    expect(rewritten(program("export let p: Vector(‸(Float, Float)‸) = []"), INTRODUCE_TITLE))
      .toBe(program("type NewType = (Float, Float)", "", "export let p: Vector(NewType) = []"));
    // The parentheses a parameter list writes around a function go with it, which a name needs none of.
    expect(rewritten(program("export let run(h: ‸(Int -> Unit)‸ -> Unit): Unit = ()"), INTRODUCE_TITLE))
      .toBe(program("type NewType = Int -> Unit", "", "export let run(h: NewType -> Unit): Unit = ()"));
    expect(rewritten(program("export let run(h: (‸Int -> Unit‸) -> Unit): Unit = ()"), INTRODUCE_TITLE))
      .toBe(program("type NewType = Int -> Unit", "", "export let run(h: NewType -> Unit): Unit = ()"));
    // And a tuple keeps its own.
    expect(rewritten(program("export let run(h: (‸(Int, Int)‸) -> Unit): Unit = ()"), INTRODUCE_TITLE))
      .toBe(program("type NewType = (Int, Int)", "", "export let run(h: NewType -> Unit): Unit = ()"));
    expect(titles(program("export let run(h: (In‸t -> Un‸it) -> Unit): Unit = ()"))).not.toContain(INTRODUCE_TITLE);
    // Parentheses written twice go twice.
    expect(rewritten(program("export let run(h: ‸((Int -> Unit))‸ -> Unit): Unit = ()"), INTRODUCE_TITLE))
      .toBe(program("type NewType = Int -> Unit", "", "export let run(h: NewType -> Unit): Unit = ()"));
  });

  test("for another module's type, qualified", () => {
    const geo = beside("Geo", "export type Pair(a) = (a, a)");
    expect(rewritten(program("import Geo", "export let p: Vector(‸Geo.Pair(Int)‸) = []"), INTRODUCE_TITLE, geo))
      .toBe(program("import Geo", "type NewType = Geo.Pair(Int)", "", "export let p: Vector(NewType) = []"));
  });

  test("for a selection with space before it", () => {
    expect(rewritten(program("export let area(s:‸ (Float, Float)‸): Float = 1.0"), INTRODUCE_TITLE))
      .toBe(program("type NewType = (Float, Float)", "", "export let area(s: NewType): Float = 1.0"));
  });

  test("below a comment that ends the line above, which is that line's", () => {
    expect(rewritten(program("let n: Int = 1 // one", "export let area(s: (Float, Fl‸oat)): Float = 1.0"), INTRODUCE_TITLE))
      .toBe(program("let n: Int = 1 // one", "type NewType = (Float, Float)", "", "export let area(s: NewType): Float = 1.0"));
  });

  test("from the start of a line another item shares", () => {
    expect(rewritten(program("let a: Int = 1; export let f(s: (Fl‸oat, Float)): Float = 1.0"), INTRODUCE_TITLE))
      .toBe(program("type NewType = (Float, Float)", "", "let a: Int = 1; export let f(s: NewType): Float = 1.0"));
  });

  test("with the file's line breaks", () => {
    const crlf = (...lines: readonly string[]): string => ["module Main", ...lines, ""].join("\r\n");
    expect(rewritten(crlf("export let area(s: (Float, Fl‸oat)): Float = 1.0"), INTRODUCE_TITLE))
      .toBe(crlf("type NewType = (Float, Float)", "", "export let area(s: NewType): Float = 1.0"));
  });

  test("above an honor group, for a type one of its items gives", () => {
    const group = (item: string): readonly string[] => [
      "honor",
      "    Source<Box> =",
      `        type Item = ${item}`,
      "        get(box) = (box.value, box.value)",
      "    Show<Box> =",
      "        show(box) = \"box\"",
    ];
    const head = ["constraint Source<a> =", "    type Item", "    get(value: a) -> Item", "record Box = {value: Int}"];
    expect(rewritten(program(...head, ...group("(Int, I‸nt)")), INTRODUCE_TITLE))
      .toBe(program(...head, "type NewType = (Int, Int)", "", ...group("NewType")));
  });

  test("above a local's item, a `fun` block, and the comments just above them", () => {
    expect(rewritten(program("export let f(): Int =", "    let q: (Float, Fl‸oat) = (1.0, 2.0)", "    1"), INTRODUCE_TITLE))
      .toBe(program("type NewType = (Float, Float)", "", "export let f(): Int =", "    let q: NewType = (1.0, 2.0)", "    1"));
    expect(rewritten(program("fun", "    a(p: Float): Float = p", "    b(p: (Float, Fl‸oat)): Float = a(1.0)"), INTRODUCE_TITLE))
      .toBe(program("type NewType = (Float, Float)", "", "fun", "    a(p: Float): Float = p", "    b(p: NewType): Float = a(1.0)"));
    expect(rewritten(program("", "// Shapes.", "(** The area. *)", "export let area(s: (Float, Fl‸oat)): Float = 1.0"), INTRODUCE_TITLE))
      .toBe(program("", "type NewType = (Float, Float)", "", "// Shapes.", "(** The area. *)", "export let area(s: NewType): Float = 1.0"));
  });

  test("above a constraint, for a type in a member's signature", () => {
    expect(rewritten(program("constraint Area<s> =", "    area(x: s, at: (Int, I‸nt)) -> Int"), INTRODUCE_TITLE))
      .toBe(program("type NewType = (Int, Int)", "", "constraint Area<s> =", "    area(x: s, at: NewType) -> Int"));
    // Another module's type of the name an implied type takes.
    const geo = beside("Geo", "export record Item = { i: Int }");
    const source = (type: string): readonly string[] => ["constraint Source<a> =", "    type Item", `    get(value: a, other: ${type}) -> Item`];
    expect(rewritten(program("import Geo", ...source("Geo.It‸em")), INTRODUCE_TITLE, geo))
      .toBe(program("import Geo", "type NewType = Geo.Item", "", ...source("NewType")));
    const pair = beside("Geo", "export type Pair(a) = (a, a)");
    const applied = (type: string): readonly string[] => ["constraint Source<a> =", "    type Pair", `    get(value: a, other: ${type}) -> Pair`];
    expect(rewritten(program("import Geo", ...applied("Geo.Pa‸ir(Int)")), INTRODUCE_TITLE, pair))
      .toBe(program("import Geo", "type NewType = Geo.Pair(Int)", "", ...applied("NewType")));
  });

  test("named for no type the module writes", () => {
    expect(rewritten(program("type NewType = Int", "export let area(s: (Float, Fl‸oat), n: NewType): Float = 1.0"), INTRODUCE_TITLE))
      .toBe(program("type NewType = Int", "type NewType2 = (Float, Float)", "", "export let area(s: NewType2, n: NewType): Float = 1.0"));
  });

  test("its name one stand-in in both places, typed once", () => {
    const { text, start, end } = marked(program("export let area(s: (Float, Fl‸oat)): Float = 1.0"));
    const action = session(text).codeActions("/main.hex", { start, end }, { invoked: true })
      .find(({ title }) => title === INTRODUCE_TITLE);
    expect(action?.edits.map(({ snippet }) => snippet?.text)).toEqual([
      "type ${1:NewType} = (Float, Float)\n\nexport let area(s: ${1:NewType}$0",
    ]);
    // From the start of the line, where an editor takes a snippet.
    const shared = marked(program("let a: Int = 1; export let area(s: (Float, Fl‸oat)): Float = 1.0"));
    expect(session(shared.text).codeActions("/main.hex", shared, { invoked: true })
      .find(({ title }) => title === INTRODUCE_TITLE)?.edits.map(({ snippet }) => snippet?.text)).toEqual([
        "type ${1:NewType} = (Float, Float)\n\nlet a: Int = 1; export let area(s: ${1:NewType}$0",
      ]);
  });

  test("refused for a type an alias cannot be", () => {
    expect(rewritten(program("export let f(): Int =", "    let p: (Int, ‸_) = (1, 2)", "    1"), INTRODUCE_TITLE)).toBe(
      "refused: A `type` declaration writes its types in full, and this type has a `_` in it. Write the type in place of " +
        "`_` first, or introduce the alias for a part of it without one.",
    );
    expect(rewritten(program("export let run(f: () ->! Unit): () >-‸> Unit = f"), INTRODUCE_TITLE)).toBe(
      "refused: An alias is a type fragment, not a signature, so a following arrow in it has nothing handed to it " +
        "(Declarations Preamble §5.1.1). Introduce the alias for a part of the type without one.",
    );
    // A marked arrow that does not follow is a type fragment like any.
    expect(rewritten(program("export let run(h: (In‸t) ->! Unit): Unit = ()"), INTRODUCE_TITLE))
      .toBe(program("type NewType = (Int) ->! Unit", "", "export let run(h: NewType): Unit = ()"));
    expect(rewritten(program("export let f(x: {n: Int, ...r‸}): {n: Int, ...r} = x"), INTRODUCE_TITLE)).toBe(
      "refused: A `type` alias's row tail is fresh at each use, so it cannot be named, and this type names `...r`. " +
        "Introduce the alias for a part of the type without it.",
    );
    expect(rewritten(program("export let area(s: (Float, (* y *) Fl‸oat)): Float = 1.0"), INTRODUCE_TITLE))
      .toBe("refused: A comment inside the type would move into the alias. Move the comment out first.");
  });

  test("not offered for a type variable alone, an honor's subject, or an implied type", () => {
    expect(titles(program("export let f(x: ‸a): a = x"))).not.toContain(INTRODUCE_TITLE);
    expect(titles(program("export let f(): Int =", "    let p: ‸_ = 1", "    p"))).not.toContain(INTRODUCE_TITLE);
    expect(titles(program("record Box = {value: Int}", "honor Show<B‸ox> =", "    show(b) = \"box\""))).not.toContain(INTRODUCE_TITLE);
    expect(titles(program(
      "constraint Source<a> =",
      "    type Item",
      "    get(value: a) -> Opt‸ion(Item)",
    ))).not.toContain(INTRODUCE_TITLE);
    // Nor applied, which v1 refuses there (Collections Part 2 §7.3).
    const applied = program("constraint Source<a> =", "    type Item", "    get(value: a) -> Opt‸ion(Item(a))");
    expect(reports(marked(applied).text)).toEqual(["`Item` is an implied type of `Source` and cannot be applied in v1"]);
    expect(titles(applied)).not.toContain(INTRODUCE_TITLE);
  });

  test("not offered for a type the parser put in place of one missing", () => {
    const missing = program("constraint Source<a> =", "    ge‸t(value: a) ->");
    expect(reports(marked(missing).text)).toEqual(["expected a type annotation"]);
    expect(titles(missing)).not.toContain(INTRODUCE_TITLE);
    // Or its arrow too, which the parser reports.
    expect(titles(program("constraint Source<a> =", "    ge‸t(value: a)"))).not.toContain(INTRODUCE_TITLE);
  });
});

describe("an alias introduced for every place its type is written", () => {
  test("beside the one place, where the module writes the type more than once, with the count", () => {
    const source = program(
      "export let area(s: (Float, Fl‸oat)): Float = 1.0",
      "export let move(s: (Float, Float)): (Float, Float) = s",
      "export let size(s: (Float, Int)): Float = 1.0",
    );
    expect(titles(source)).toEqual([INTRODUCE_TITLE, introduceEverywhereTitle(3)]);
    expect(rewritten(source, introduceEverywhereTitle(3))).toBe(program(
      "type NewType = (Float, Float)",
      "",
      "export let area(s: NewType): Float = 1.0",
      "export let move(s: NewType): NewType = s",
      "export let size(s: (Float, Int)): Float = 1.0",
    ));
    expect(titles(program("export let area(s: (Float, Fl‸oat)): Float = 1.0", "export let size(s: (Float, Int)): Float = 1.0")))
      .toEqual([INTRODUCE_TITLE]);
  });

  test("each place that reads as the type, however it is laid out, inside another type or in parentheses", () => {
    expect(rewritten(program(
      "export let area(s: (Float, Fl‸oat)): Float = 1.0",
      "export let all(s: Vector(( Float,",
      "    Float ))): Float = 1.0",
      "export let run(h: ((Float, Float)) -> Unit): Unit = ()",
    ), introduceEverywhereTitle(3))).toBe(program(
      "type NewType = (Float, Float)",
      "",
      "export let area(s: NewType): Float = 1.0",
      "export let all(s: Vector(NewType)): Float = 1.0",
      "export let run(h: NewType -> Unit): Unit = ()",
    ));
  });

  test("its type variables matched by name", () => {
    expect(rewritten(program(
      "export let wrap(x: a, f: (a) -> Op‸tion(a)): Option(a) = f(x)",
      "export let keep(f: (a) -> Option(a)): (a) -> Option(a) = f",
      "export let other(f: (b) -> Option(b)): (b) -> Option(b) = f",
    ), introduceEverywhereTitle(3))).toBe(program(
      "type NewType(a) = (a) -> Option(a)",
      "",
      "export let wrap(x: a, f: NewType(a)): Option(a) = f(x)",
      "export let keep(f: NewType(a)): NewType(a) = f",
      "export let other(f: (b) -> Option(b)): (b) -> Option(b) = f",
    ));
  });

  test("declared above the first place, from whichever place it is asked on", () => {
    expect(rewritten(program(
      "(** The area. *)",
      "export let area(s: (Float, Float)): Float = 1.0",
      "",
      "export let move(s: (Float, Fl‸oat)): Float = 1.0",
    ), introduceEverywhereTitle(2))).toBe(program(
      "type NewType = (Float, Float)",
      "",
      "(** The area. *)",
      "export let area(s: NewType): Float = 1.0",
      "",
      "export let move(s: NewType): Float = 1.0",
    ));
  });

  test("in an alias's body, a `fun` block's members and an honor group's items", () => {
    expect(rewritten(program(
      "type Line = ((Float, Float), (Float, Float))",
      "record Box = {value: Int}",
      "honor",
      "    Show<Box> =",
      "        show(b) =",
      "            let p: (Float, Float) = (1.0, 2.0)",
      "            \"box\"",
      "fun",
      "    f(s: (Float, Fl‸oat)): Float = g(s)",
      "    g(s: (Float, Float)): Float = 1.0",
    ), introduceEverywhereTitle(5))).toBe(program(
      "type NewType = (Float, Float)",
      "",
      "type Line = (NewType, NewType)",
      "record Box = {value: Int}",
      "honor",
      "    Show<Box> =",
      "        show(b) =",
      "            let p: NewType = (1.0, 2.0)",
      "            \"box\"",
      "fun",
      "    f(s: NewType): Float = g(s)",
      "    g(s: NewType): Float = 1.0",
    ));
  });

  test("its name one stand-in in every place, typed once", () => {
    const { text, start, end } = marked(program(
      "export let area(s: (Float, Fl‸oat)): Float = 1.0",
      "export let move(s: (Float, Float)): Float = 1.0",
    ));
    const action = session(text).codeActions("/main.hex", { start, end }, { invoked: true })
      .find(({ title }) => title === introduceEverywhereTitle(2));
    expect(action?.edits.map(({ snippet }) => snippet?.text)).toEqual([
      "type ${1:NewType} = (Float, Float)\n\nexport let area(s: ${1:NewType}): Float = 1.0\nexport let move(s: ${1:NewType}$0",
    ]);
  });

  test("not counting a place where a constraint's implied type takes a name in it", () => {
    expect(titles(program(
      "type Item = Int",
      "export let first(x: Opt‸ion(Item)): Int = 0",
      "constraint Source<a> =",
      "    type Item",
      "    get(value: a) -> Option(Item)",
    ))).toEqual([INTRODUCE_TITLE]);
  });

  test("refused where a comment inside the type in another place would be lost", () => {
    const source = program(
      "export let area(s: (Float, Fl‸oat)): Float = 1.0",
      "export let move(s: (Float, (* y *) Float)): Float = 1.0",
    );
    expect(rewritten(source, introduceEverywhereTitle(2)))
      .toBe("refused: A comment inside the type in another of its places would be lost. Move the comment out first.");
    expect(rewritten(source, INTRODUCE_TITLE)).toBe(program(
      "type NewType = (Float, Float)",
      "",
      "export let area(s: NewType): Float = 1.0",
      "export let move(s: (Float, (* y *) Float)): Float = 1.0",
    ));
  });
});

describe("the check of what an introduced alias leaves", () => {
  const text = "module Main\nexport let area(s: (Float, Float)): Float = 1.0\n";
  const file = new Source.File(Source.fileId(1), "/main.hex", text);
  const start = text.indexOf("export");
  const end = text.indexOf("): Float");
  const to = text.length - 1;
  const reads = (declared: string, used: string, name = "NewType"): boolean => {
    const replacement = `${declared}\n\n${text.slice(start, text.indexOf("(Float"))}${used}`;
    return readsIntroduced(file, { start, end, replacement }, to, name, [[replacement.length - used.length, replacement.length]]);
  };

  test("takes the alias expanded at its use as the type it replaced", () => {
    expect(reads("type NewType = (Float, Float)", "NewType")).toBe(true);
  });

  test("and no other text", () => {
    expect(reads("type NewType = (Float, Int)", "NewType")).toBe(false);
    expect(reads("type NewType(a) = (a, a)", "NewType(Int)")).toBe(false);
    expect(reads("type Other = (Float, Float)", "Other")).toBe(false);
    expect(reads("type Other = (Float, Float)", "NewType")).toBe(false);
    expect(reads("let NewType = 1", "Float")).toBe(false);
    expect(reads("type NewType = (Float, Float)", "Float")).toBe(false);
    expect(reads("type NewType = (Float, Float)\n// note", "NewType")).toBe(false);
    expect(reads("type NewType = (Float, Float)\n(** note *)", "NewType")).toBe(false);
  });

  test("nor an alias not written where the type was", () => {
    const replacement = `type NewType = (Float, Float)\n\n${text.slice(start, end)}`;
    const name = replacement.indexOf("area");
    expect(readsIntroduced(file, { start, end, replacement }, to, "NewType", [[name, name + "area".length]])).toBe(false);
  });

  test("nor a documentation comment moved onto the alias", () => {
    const documented = "module Main\n(** The area. *)\nexport let area(s: (Float, Float)): Float = 1.0\n";
    const at = documented.indexOf("(**");
    const replacement = "(** The area. *)\ntype NewType = (Float, Float)\nexport let area(s: NewType";
    const edit = { start: at, end: documented.indexOf("): Float"), replacement };
    const placed = new Source.File(Source.fileId(1), "/main.hex", documented);
    expect(readsIntroduced(placed, edit, documented.length - 1, "NewType", [[replacement.length - "NewType".length, replacement.length]])).toBe(false);
  });

  test("nor a documentation comment written otherwise", () => {
    const documented = "module Main\n(** The area. *)\nexport let area(s: (Float, Float)): Float = 1.0\n";
    const at = documented.indexOf("(**");
    const placed = new Source.File(Source.fileId(1), "/main.hex", documented);
    const reads = (doc: string): boolean => {
      const replacement = `type NewType = (Float, Float)\n\n${doc}\nexport let area(s: NewType`;
      const edit = { start: at, end: documented.indexOf("): Float"), replacement };
      return readsIntroduced(placed, edit, documented.length - 1, "NewType", [[replacement.length - "NewType".length, replacement.length]]);
    };
    expect(reads("(** The area. *)")).toBe(true);
    expect(reads("(** The size. *)")).toBe(false);
  });
});

describe("the edit written for an item's new text", () => {
  test("over only what differs, the text both share at either end kept", () => {
    expect(changed("let p: Pair(Int) = x", "let p: (Int, Int) = x", 10)).toEqual({ start: 17, end: 22, replacement: "(Int, " });
    expect(changed("same", "same", 3)).toEqual({ start: 7, end: 7, replacement: "" });
  });

  test("never taking a character for both ends", () => {
    expect(changed("ab", "abab", 0)).toEqual({ start: 2, end: 2, replacement: "ab" });
    expect(changed("abab", "ab", 0)).toEqual({ start: 2, end: 4, replacement: "" });
  });
});
