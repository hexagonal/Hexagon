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

function session(text: string): AnalysisSession {
  const opened = new AnalysisSession();
  opened.setFile("/main.hex", text);
  return opened;
}

const program = (...lines: readonly string[]): string => ["module Main", ...lines, ""].join("\n");

/** The alias refactorings offered at the caret or selection, by title. */
function offered(source: string): ReadonlyMap<string, CodeAction> {
  const { text, start, end } = marked(source);
  return new Map(
    session(text).codeActions("/main.hex", { start, end }, { invoked: true })
      .filter(({ kind, title }) => kind === "refactor" && isAliasTitle(title))
      .map((action) => [action.title, action]),
  );
}

const titles = (source: string): readonly string[] => [...offered(source).keys()];

function reports(text: string): readonly string[] {
  return session(text).diagnostics("/main.hex").map(({ message }) => message);
}

/**
 * The program after the refactoring named `title` is applied, every edit of
 * it, or why it is refused. The program and what it becomes each report nothing.
 */
function rewritten(source: string, title: string): string {
  const action = offered(source).get(title);
  if (action === undefined) return "not offered";
  if (action.disabled !== undefined) return `refused: ${action.disabled}`;
  const { text } = marked(source);
  const edits = [...action.edits].sort((left, right) => right.span.start.offset - left.span.start.offset);
  const after = edits.reduce(
    (written, { span, replacement }) => written.slice(0, span.start.offset) + replacement + written.slice(span.end.offset),
    text,
  );
  expect(reports(text)).toEqual([]);
  expect(reports(after)).toEqual([]);
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

  test("on a type of another module of the same name", () => {
    const opened = new AnalysisSession();
    opened.setFile("/geo.hex", "module Geo\nexport type Point = (Float, Float)\n");
    opened.setFile("/geo.hex", "module Geo\nexport type Point = (Float, Float)\nexport type Pair(a) = (a, a)\n");
    for (const use of ["Geo.Po‸int", "Geo.Pa‸ir(Int)"]) {
      const source = program("import Geo", "type Point = (Int, Int)", "type Pair(a) = (a, Int)", `export let area(s: ${use}, t: Point, u: Pair(Int)): Float = 1.0`);
      const { text, start, end } = marked(source);
      opened.setFile("/main.hex", text);
      expect(opened.diagnostics("/main.hex")).toEqual([]);
      expect(opened.codeActions("/main.hex", { start, end }, { invoked: true }).map(({ title }) => title)).not.toContain(WRITE_OUT_TITLE);
    }
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

  test("the declaration as the file's last line", () => {
    expect(rewritten("module Main\nexport let area(s: Point): Float = 1.0\ntype Po‸int = (Float, Float)", WRITE_OUT_EVERYWHERE_TITLE))
      .toBe("module Main\nexport let area(s: (Float, Float)): Float = 1.0\n");
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

  test("for a selection with space before it", () => {
    expect(rewritten(program("export let area(s:‸ (Float, Float)‸): Float = 1.0"), INTRODUCE_TITLE))
      .toBe(program("type NewType = (Float, Float)", "", "export let area(s: NewType): Float = 1.0"));
  });

  test("below a comment that ends the line above, which is that line's", () => {
    expect(rewritten(program("let n: Int = 1 // one", "export let area(s: (Float, Fl‸oat)): Float = 1.0"), INTRODUCE_TITLE))
      .toBe(program("let n: Int = 1 // one", "type NewType = (Float, Float)", "", "export let area(s: NewType): Float = 1.0"));
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
