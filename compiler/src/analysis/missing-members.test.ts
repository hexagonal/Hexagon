import { describe, expect, test } from "vitest";
import { AnalysisSession, type CodeAction } from "./session.js";

/**
 * The repair on "instance is missing required member": each missing member,
 * written from its constraint's header as a `Debug.todo` naming it
 * (language-server decision 5). The head writes the member's name and its
 * parameters' names, and no types: a member's type is the constraint's at the
 * honored head (Constraints §4.1).
 */

const SHAPE = [
  "export record Point = { x: Int, y: Int }",
  "export record Line = { length: Int }",
  "constraint Shape<a> =",
  "    area(s: a) -> Float",
  "    name(s: a) -> String",
  "    scaled(s: a, by: Float) -> a",
];

function session(files: Readonly<Record<string, string>>): AnalysisSession {
  const analysis = new AnalysisSession();
  for (const [path, text] of Object.entries(files)) analysis.setFile(path, text);
  return analysis;
}

function program(...lines: readonly string[]): string {
  return ["module Main", ...SHAPE, ...lines].join("\n") + "\n";
}

/** The repairs offered on the honor (the first one in the text, or `at`), asked as the editor asks on its own. */
function repairs(text: string, at = text.indexOf("honor"), files: Readonly<Record<string, string>> = {}): readonly CodeAction[] {
  return session({ ...files, "/main.hex": text }).codeActions("/main.hex", { start: at, end: at })
    .filter(({ diagnostic }) => diagnostic?.message.startsWith("instance is missing required member") === true);
}

function applied(text: string, action: CodeAction): string {
  return [...action.edits].reverse().reduce(
    (written, { span, replacement }) => written.slice(0, span.start.offset) + replacement + written.slice(span.end.offset),
    text,
  );
}

/** The program after the one missing-members repair, and what it then reports. */
function filled(text: string, at?: number): { readonly text: string; readonly diagnostics: readonly string[] } {
  const [repair, ...others] = repairs(text, at);
  expect(others).toEqual([]);
  if (repair === undefined) throw new Error("no repair offered");
  const after = applied(text, repair);
  return { text: after, diagnostics: session({ "/main.hex": after }).diagnostics("/main.hex").map(({ message }) => message) };
}

describe("an honor's missing members, written as `Debug.todo`", () => {
  test("each below the last member, in the constraint's order, headed by its name and its parameters' names", () => {
    const text = program(
      "honor Shape<Point> =",
      "    area(p) = 1.0",
    );
    // One report per missing member, and one repair for them all.
    expect(session({ "/main.hex": text }).diagnostics("/main.hex").map(({ message }) => message)).toEqual([
      "instance is missing required member `name`",
      "instance is missing required member `scaled`",
    ]);
    expect(repairs(text).map(({ title, kind }) => ({ title, kind })))
      .toEqual([{ title: "Add the 2 missing members", kind: "quickfix" }]);
    expect(filled(text)).toEqual({
      text: program(
        "honor Shape<Point> =",
        "    area(p) = 1.0",
        "    name(s) = Debug.todo(\"name\")",
        "    scaled(s, by) = Debug.todo(\"scaled\")",
      ),
      diagnostics: [],
    });
  });

  test("one member is named as one; a defaulted member is not written", () => {
    const text = program(
      "honor Eq<Point> =",
      "    notEquals(p, q) = p.x != q.x",
    );
    expect(repairs(text).map(({ title }) => title)).toEqual(["Add the missing member"]);
    expect(filled(text)).toEqual({
      text: program(
        "honor Eq<Point> =",
        "    notEquals(p, q) = p.x != q.x",
        "    equals(left, right) = Debug.todo(\"equals\")",
      ),
      diagnostics: [],
    });
  });

  test("a member with no parameters, a parameterized head, and an implied type bound below the members", () => {
    expect(filled([
      "module Main",
      "export record Point = { x: Int, y: Int }",
      "constraint Origin<a> =",
      "    origin() -> a",
      "    label(s: a) -> String",
      "honor Origin<Point> =",
      "    label(p) = \"p\"",
      "",
    ].join("\n")).text).toContain("    label(p) = \"p\"\n    origin() = Debug.todo(\"origin\")\n");
    expect(filled([
      "module Main",
      "constraint Sized<a> =",
      "    size(s: a) -> Int",
      "    label(s: a) -> String",
      "honor<t: Show> Sized<Option(t)> =",
      "    size(o) = 1",
      "",
    ].join("\n"))).toEqual({
      text: [
        "module Main",
        "constraint Sized<a> =",
        "    size(s: a) -> Int",
        "    label(s: a) -> String",
        "honor<t: Show> Sized<Option(t)> =",
        "    size(o) = 1",
        "    label(s) = Debug.todo(\"label\")",
        "",
      ].join("\n"),
      diagnostics: [],
    });
    const bag = (...block: readonly string[]): string => [
      "module Main",
      "record Bag = {x: Int}",
      "constraint Coll<c> =",
      "    type Elem",
      "    first(xs: c) -> Elem",
      "    count(xs: c) -> Int",
      "honor Coll<Bag> =",
      ...block,
      "",
    ].join("\n");
    expect(filled(bag("    first(b) = b.x", "    type Elem = Int"))).toEqual({
      text: bag("    first(b) = b.x", "    type Elem = Int", "    count(xs) = Debug.todo(\"count\")"),
      diagnostics: [],
    });
    expect(filled(bag("    type Elem = Int", "    first(b) = b.x")).text)
      .toBe(bag("    type Elem = Int", "    first(b) = b.x", "    count(xs) = Debug.todo(\"count\")"));
  });

  test("a pattern parameter, which the constraint refuses, is written `_`", () => {
    const text = program(
      "constraint Paired<a> =",
      "    first((x, y): (a, Int)) -> a",
      "    label(s: a) -> String",
      "honor Paired<Point> =",
      "    label(p) = \"p\"",
    );
    expect(filled(text, text.indexOf("honor Paired"))).toEqual({
      text: program(
        "constraint Paired<a> =",
        "    first((x, y): (a, Int)) -> a",
        "    label(s: a) -> String",
        "honor Paired<Point> =",
        "    label(p) = \"p\"",
        "    first(_) = Debug.todo(\"first\")",
      ),
      diagnostics: ["constraint members take plain parameter names, not patterns"],
    });
  });

  test("a member this module widens is written as its accounting line, never as a body (Constraints §4.7)", () => {
    const scale = "module Scale\n\nexport constraint Scale<a> =\n    scale(value: a, factor: Int) -> a\n" +
      "    label(value: a) -> String\n    size(value: a) -> Int\n";
    const matrix = (...block: readonly string[]): string => [
      "module Matrix",
      "import Scale",
      "export record Matrix = {n: Float}",
      "widens Scale.scale(value: Matrix, factor: Float): Matrix =",
      "    Matrix({n = value.n * factor})",
      "honor Scale.Scale<Matrix> =",
      ...block,
      "",
    ].join("\n");
    const files = { "/scale.hex": scale };
    const text = matrix("    label(value) = \"matrix\"");
    const [repair, ...others] = repairs(text, text.indexOf("honor"), files);
    expect(others).toEqual([]);
    expect(repair?.title).toBe("Add the 2 missing members");
    const after = applied(text, repair!);
    expect(after).toBe(matrix(
      "    label(value) = \"matrix\"",
      "    scale = widened",
      "    size(value) = Debug.todo(\"size\")",
    ));
    expect(session({ ...files, "/main.hex": after }).diagnostics("/main.hex")).toEqual([]);
    // Accounting lines alone write no stand-in: the resolver's report names
    // that rewrite.
    const accounted = matrix("    label(value) = \"matrix\"", "    size(value) = 1");
    expect(session({ ...files, "/main.hex": accounted }).diagnostics("/main.hex").map(({ message }) => message))
      .toContain("instance is missing required member `scale`");
    expect(repairs(accounted, accounted.indexOf("honor"), files)).toEqual([]);
    // A door for another constraint's member of the same name accounts for
    // nothing here.
    const grow = "module Grow\n\nexport constraint Grow<a> =\n    size(value: a, by: Int) -> a\n";
    const both = [
      "module Matrix",
      "import Scale",
      "import Grow",
      "export record Matrix = {n: Float}",
      "widens Grow.size(value: Matrix, by: Float): Matrix = value",
      "honor Grow.Grow<Matrix> =",
      "    size = widened",
      "honor Scale.Scale<Matrix> =",
      "    label(value) = \"matrix\"",
      "    scale(value, factor) = value",
      "",
    ].join("\n");
    const [other] = repairs(both, both.indexOf("honor Scale"), { ...files, "/grow.hex": grow });
    expect(other?.edits.map(({ replacement }) => replacement)).toEqual(["\n    size(value) = Debug.todo(\"size\")"]);
    // A widened member's line is required even where the member has a
    // default, so the fill writes it too.
    const defaulted = { "/scale.hex": scale.replace("scale(value: a, factor: Int) -> a", "scale(value: a, factor: Int) -> a = value") };
    const [complete] = repairs(text, text.indexOf("honor"), defaulted);
    expect(complete?.title).toBe("Add the 2 missing members");
    expect(session({ ...defaulted, "/main.hex": applied(text, complete!) }).diagnostics("/main.hex")).toEqual([]);
  });

  test("it keeps the instance's colour: a fault, which a pure contract admits", () => {
    const text = program(
      "honor Shape<Point> =",
      "    area(p) = 1.0",
      "    name(p) = \"p\"",
      "export let grown: Point = scaled(Point({ x = 1, y = 2 }), 2.0)",
    );
    expect(filled(text).diagnostics).toEqual([]);
  });

  test("never preferred, since it makes the program compile without making it right", () => {
    const [repair] = repairs(program("honor Shape<Point> =", "    area(p) = 1.0"));
    expect(repair?.placeholders).toBe(true);
    expect(repair?.preferred).toBeUndefined();
  });
});

describe("where the members go", () => {
  test("an empty honor: below the `=`, one step in from the head, and the parse errors go with it", () => {
    const text = program(
      "honor Shape<Point> =",
      "export let unit: Unit = ()",
    );
    expect(session({ "/main.hex": text }).diagnostics("/main.hex").map(({ message }) => message))
      .toContain("expected an indented instance body");
    expect(filled(text)).toEqual({
      text: program(
        "honor Shape<Point> =",
        "    area(s) = Debug.todo(\"area\")",
        "    name(s) = Debug.todo(\"name\")",
        "    scaled(s, by) = Debug.todo(\"scaled\")",
        "export let unit: Unit = ()",
      ),
      diagnostics: [],
    });
  });

  test("an empty honor keeps the comments that end its head's line, at the end of the file too", () => {
    expect(filled(program("honor Shape<Line> = (* soon *)", "", "export let unit: Unit = ()")).text).toBe(program(
      "honor Shape<Line> = (* soon *)",
      "    area(s) = Debug.todo(\"area\")",
      "    name(s) = Debug.todo(\"name\")",
      "    scaled(s, by) = Debug.todo(\"scaled\")",
      "",
      "export let unit: Unit = ()",
    ));
    const text = ["module Main", ...SHAPE, "honor Shape<Line> = // soon"].join("\n");
    expect(filled(text)).toEqual({
      text: text + [
        "",
        "    area(s) = Debug.todo(\"area\")",
        "    name(s) = Debug.todo(\"name\")",
        "    scaled(s, by) = Debug.todo(\"scaled\")",
      ].join("\n"),
      diagnostics: [],
    });
  });

  test("below the comments that end the last member's line, and below a nested `match`, above what follows it", () => {
    expect(filled(program(
      "honor Shape<Point> =",
      "    area(p) = 1.0 // for now",
      "    name(p) = \"p\" (* (* nested *) still *)",
    )).text).toContain("    name(p) = \"p\" (* (* nested *) still *)\n    scaled(s, by) = Debug.todo(\"scaled\")\n");
    const text = program(
      "honor Shape<Point> =",
      "    area(p) = match p.x",
      "        0 => 0.0",
      "        _ => 1.0",
      "",
      "// The other shapes.",
      "(** A line. *)",
      "export let line: Line = Line({ length = 1 })",
    );
    expect(filled(text)).toEqual({
      text: program(
        "honor Shape<Point> =",
        "    area(p) = match p.x",
        "        0 => 0.0",
        "        _ => 1.0",
        "    name(s) = Debug.todo(\"name\")",
        "    scaled(s, by) = Debug.todo(\"scaled\")",
        "",
        "// The other shapes.",
        "(** A line. *)",
        "export let line: Line = Line({ length = 1 })",
      ),
      diagnostics: [],
    });
  });

  test("an honor in a group, at its own block's indentation", () => {
    const text = program(
      "honor",
      "    Shape<Point> =",
      "        area(p) = 1.0",
      "        name(p) = \"p\"",
      "        scaled(p, by) = p",
      "    Shape<Line> =",
      "        area(l) = 2.0",
    );
    expect(filled(text, text.indexOf("Shape<Line>"))).toEqual({
      text: program(
        "honor",
        "    Shape<Point> =",
        "        area(p) = 1.0",
        "        name(p) = \"p\"",
        "        scaled(p, by) = p",
        "    Shape<Line> =",
        "        area(l) = 2.0",
        "        name(s) = Debug.todo(\"name\")",
        "        scaled(s, by) = Debug.todo(\"scaled\")",
      ),
      diagnostics: [],
    });
    const empty = program(
      "honor",
      "    Shape<Line> =",
      "export let unit: Unit = ()",
    );
    expect(filled(empty, empty.indexOf("Shape<Line>")).text).toBe(program(
      "honor",
      "    Shape<Line> =",
      "        area(s) = Debug.todo(\"area\")",
      "        name(s) = Debug.todo(\"name\")",
      "        scaled(s, by) = Debug.todo(\"scaled\")",
      "export let unit: Unit = ()",
    ));
  });

  test("with the file's line ending, CRLF included, on the head's first line too", () => {
    const text = program("honor Shape<Point> =", "    area(p) = 1.0").replaceAll("\n", "\r\n");
    expect(filled(text)).toEqual({
      text: program(
        "honor Shape<Point> =",
        "    area(p) = 1.0",
        "    name(s) = Debug.todo(\"name\")",
        "    scaled(s, by) = Debug.todo(\"scaled\")",
      ).replaceAll("\n", "\r\n"),
      diagnostics: [],
    });
    // The module header is missing, so the head's line is the first.
    const [first] = repairs("honor Show<Int> =\r\n");
    expect(first?.edits.map(({ replacement }) => replacement)).toEqual(["\r\n    show(value) = Debug.todo(\"show\")"]);
  });
});

describe("where it is not offered", () => {
  test("where the module's own `Debug` hides the prelude's, or is imported below the honor", () => {
    const honor = ["honor Shape<Point> =", "    area(p) = 1.0"];
    const above = ["module Main", "import Debug", ...SHAPE, ...honor, ""].join("\n");
    const own = { "/Debug.hex": "module Debug\nexport let todo(what: String): Int = 0\n" };
    expect(session({ ...own, "/main.hex": above }).diagnostics("/main.hex").map(({ message }) => message))
      .toEqual(["instance is missing required member `name`", "instance is missing required member `scaled`"]);
    expect(repairs(above, above.indexOf("honor"), own)).toEqual([]);
    // With no module of the program's to find, `import Debug` reaches the
    // prelude's, but only below it.
    expect(filled(above).diagnostics).toEqual([]);
    expect(repairs(program(...honor, "import Debug"))).toEqual([]);
  });

  test("where the first member does not begin its line, whose column the new members could not match", () => {
    const text = program("honor Shape<Point> =", "    (* first *) area(p) = 1.0", "                name(p) = \"p\"");
    expect(session({ "/main.hex": text }).diagnostics("/main.hex").map(({ message }) => message))
      .toEqual(["instance is missing required member `scaled`"]);
    expect(repairs(text)).toEqual([]);
    // Nor an empty honor's head, whose column the members are one step past.
    const empty = program("honor", "    (* note *) Shape<Point> =", "export let unit: Unit = ()");
    expect(session({ "/main.hex": empty }).diagnostics("/main.hex").map(({ message }) => message))
      .toContain("instance is missing required member `area`");
    expect(repairs(empty, empty.indexOf("Shape<Point>"))).toEqual([]);
  });

  test("where something other than a comment follows an empty honor's `=`", () => {
    const text = program("honor Shape<Point> = 42", "export let unit: Unit = ()");
    expect(session({ "/main.hex": text }).diagnostics("/main.hex").map(({ message }) => message))
      .toContain("instance is missing required member `area`");
    expect(repairs(text)).toEqual([]);
  });

  test("where the members stand no deeper than the head, so no block opened", () => {
    const text = program("honor Shape<Point> =", "area(p) = 1.0", "export let unit: Unit = ()");
    expect(session({ "/main.hex": text }).diagnostics("/main.hex").map(({ message }) => message))
      .toContain("instance is missing required member `name`");
    expect(repairs(text)).toEqual([]);
    const grouped = program("honor", "    Shape<Point> =", "    area(p) = 1.0");
    expect(session({ "/main.hex": grouped }).diagnostics("/main.hex").map(({ message }) => message))
      .toContain("instance is missing required member `name`");
    expect(repairs(grouped, grouped.indexOf("Shape<Point>"))).toEqual([]);
  });

  test("where the head does not begin its line, its block opens deeper than the line", () => {
    for (const before of ["export let unit: Unit = (); ", "honor Show<Line> = derive; "]) {
      const text = program(`${before}honor Shape<Point> =`, "    area(p) = 1.0");
      expect(filled(text, text.indexOf("honor Shape"))).toEqual({
        text: program(
          `${before}honor Shape<Point> =`,
          "    area(p) = 1.0",
          "    name(s) = Debug.todo(\"name\")",
          "    scaled(s, by) = Debug.todo(\"scaled\")",
        ),
        diagnostics: [],
      });
    }
  });

  test("where something follows the head's `=` before its block", () => {
    const text = program("honor Shape<Point> = ;", "    area(p) = 1.0", "export let unit: Unit = ()");
    expect(session({ "/main.hex": text }).diagnostics("/main.hex").map(({ message }) => message))
      .toContain("instance is missing required member `name`");
    expect(repairs(text)).toEqual([]);
  });

  test("where the head has no `=`", () => {
    const text = program("honor Shape<Point> 42", "export let unit: Unit = ()");
    expect(session({ "/main.hex": text }).diagnostics("/main.hex").map(({ message }) => message))
      .toContain("instance is missing required member `area`");
    expect(repairs(text)).toEqual([]);
  });

  test("where an empty honor's block was read from another honor's lines", () => {
    // The parser reads `Shape<Line>`'s block as `Shape<Point>`'s, so that block
    // is not where `Shape<Point>`'s members go.
    const text = program(
      "honor",
      "    Shape<Point> =",
      "    Shape<Line> =",
      "        name(l) = \"l\"",
      "        scaled(l, by) = l",
    );
    expect(session({ "/main.hex": text }).diagnostics("/main.hex").map(({ message }) => message))
      .toContain("instance is missing required member `area`");
    expect(repairs(text, text.indexOf("Shape<Point>"))).toEqual([]);
  });
});
