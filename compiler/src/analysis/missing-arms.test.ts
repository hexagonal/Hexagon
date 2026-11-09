import { describe, expect, test } from "vitest";
import { AnalysisSession, type CodeAction } from "./session.js";

/**
 * The repair on "match is missing cases": the missing arms, written below the
 * last arm, each body a `Debug.todo` naming the case (language-server decision
 * 5). The witnesses are the checker's, so the arms are written from the one
 * solve, never guessed.
 */

const SHAPE = "export union Shape = Circle(radius: Float) | Square(side: Float) | Tri(a: Float, b: Float)";

function session(files: Readonly<Record<string, string>>): AnalysisSession {
  const analysis = new AnalysisSession();
  for (const [path, text] of Object.entries(files)) analysis.setFile(path, text);
  return analysis;
}

function program(...lines: readonly string[]): string {
  return ["module Main", SHAPE, ...lines].join("\n") + "\n";
}

/** The repairs offered on the `match` (the first one in the text), asked as the editor asks on its own. */
function repairs(text: string, files: Readonly<Record<string, string>> = {}): readonly CodeAction[] {
  const at = text.indexOf("match");
  return session({ ...files, "/main.hex": text }).codeActions("/main.hex", { start: at, end: at })
    .filter(({ diagnostic }) => diagnostic?.message.startsWith("match is missing cases") === true);
}

function applied(text: string, action: CodeAction): string {
  return [...action.edits].reverse().reduce(
    (written, { span, replacement }) => written.slice(0, span.start.offset) + replacement + written.slice(span.end.offset),
    text,
  );
}

/** The program after the one missing-arms repair, and what it then reports. */
function filled(text: string): { readonly text: string; readonly diagnostics: readonly string[] } {
  const [repair, ...others] = repairs(text);
  expect(others).toEqual([]);
  if (repair === undefined) throw new Error("no repair offered");
  const after = applied(text, repair);
  return { text: after, diagnostics: session({ "/main.hex": after }).diagnostics("/main.hex").map(({ message }) => message) };
}

describe("the missing arms, written as `Debug.todo`", () => {
  test("one per missing case, below the last arm, in the order the report finds them", () => {
    const text = program(
      "export let area(s: Shape): Float =",
      "    match s",
      "        Circle(r) => r * r",
    );
    expect(repairs(text).map(({ title, kind }) => ({ title, kind })))
      .toEqual([{ title: "Add the 2 missing arms", kind: "quickfix" }]);
    expect(filled(text)).toEqual({
      text: program(
        "export let area(s: Shape): Float =",
        "    match s",
        "        Circle(r) => r * r",
        "        Square(_) => Debug.todo(\"Square(_)\")",
        "        Tri(_, _) => Debug.todo(\"Tri(_, _)\")",
      ),
      diagnostics: [],
    });
  });

  test("one arm is named as one", () => {
    const text = program(
      "export let f(b: Bool, c: Bool): Int =",
      "    match (b, c)",
      "        (True, _) => 1",
    );
    expect(repairs(text).map(({ title }) => title)).toEqual(["Add the missing arm"]);
    expect(filled(text).text).toContain("        (False, _) => Debug.todo(\"(False, _)\")\n");
  });

  test("nested cases, a catch-all, and arms with a guard, which cover nothing", () => {
    expect(filled(program(
      "export let f(o: Option(Shape)): Int =",
      "    match o",
      "        Some(Circle(_)) => 1",
      "        None => 0",
    )).text).toContain([
      "        None => 0",
      "        Some(Square(_)) => Debug.todo(\"Some(Square(_))\")",
      "        Some(Tri(_, _)) => Debug.todo(\"Some(Tri(_, _))\")",
    ].join("\n"));
    expect(filled(program("export let f(i: Int): Int =", "    match i", "        0 => 1")).text)
      .toContain("        0 => 1\n        _ => Debug.todo(\"_\")\n");
    expect(filled(program(
      "export let f(s: Shape): Int =",
      "    match s",
      "        Circle(r) when r > 0.0 => 1",
      "        Square(_) | Tri(_, _) => 2",
    ))).toEqual({
      text: program(
        "export let f(s: Shape): Int =",
        "    match s",
        "        Circle(r) when r > 0.0 => 1",
        "        Square(_) | Tri(_, _) => 2",
        "        Circle(_) => Debug.todo(\"Circle(_)\")",
      ),
      diagnostics: [],
    });
  });

  test("every case missing, beneath the constructors the arms name as well as the ones they don't", () => {
    const flag = "export union Flag = A | B";
    const text = program(flag, "export let f(o: Option(Flag)): Int =", "    match o", "        Some(A) => 1");
    expect(session({ "/main.hex": text }).diagnostics("/main.hex").map(({ message }) => message))
      .toEqual(["match is missing cases: `None`, `Some(B)`"]);
    expect(filled(text).text).toContain("        Some(A) => 1\n        None => Debug.todo(\"None\")\n        Some(B) => Debug.todo(\"Some(B)\")\n");
    expect(filled(program(
      "export let f(a: Bool, b: Bool, c: Bool): Int =",
      "    match (a, b, c)",
      "        (True, True, True) => 1",
    ))).toEqual({
      text: program(
        "export let f(a: Bool, b: Bool, c: Bool): Int =",
        "    match (a, b, c)",
        "        (True, True, True) => 1",
        "        (False, _, _) => Debug.todo(\"(False, _, _)\")",
        "        (True, False, _) => Debug.todo(\"(True, False, _)\")",
        "        (True, True, False) => Debug.todo(\"(True, True, False)\")",
      ),
      diagnostics: [],
    });
  });

  test("one `_` where a column has no constructors to name, which covers what its literals miss", () => {
    expect(filled(program("export let f(i: Int, b: Bool): Int =", "    match (i, b)", "        (0, True) => 1"))).toEqual({
      text: program(
        "export let f(i: Int, b: Bool): Int =",
        "    match (i, b)",
        "        (0, True) => 1",
        "        (_, _) => Debug.todo(\"(_, _)\")",
      ),
      diagnostics: [],
    });
  });

  test("keeping the function's colour: a caller needs no mark", () => {
    const { diagnostics } = filled(program(
      "export let area(s: Shape): Float =",
      "    match s",
      "        Circle(r) => r * r",
      "export let doubled(s: Shape): Float = area(s) * 2.0",
    ));
    expect(diagnostics).toEqual([]);
  });

  test("where a type, a constructor, a fault or an `import` takes the name `Debug` or `TodoFault`, or none does", () => {
    const lines = ["export let f(s: Shape): Int =", "    match s", "        Circle(_) => 1"];
    for (const declared of ["union Mode = Debug | Release", "record Debug = { level: Int }", "fault TodoFault(message: String)"]) {
      expect(filled(program(declared, ...lines)).diagnostics).toEqual([]);
    }
    const imported = ["module Main", "import Debug", SHAPE, ...lines, ""].join("\n");
    expect(filled(imported)).toEqual({
      text: imported.replace("=> 1\n", "=> 1\n" + [
        "        Square(_) => Debug.todo(\"Square(_)\")",
        "        Tri(_, _) => Debug.todo(\"Tri(_, _)\")",
        "",
      ].join("\n")),
      diagnostics: [],
    });
  });

  test("never preferred: it makes the program compile without making it right", () => {
    const [repair] = repairs(program("export let f(s: Shape): Int =", "    match s", "        Circle(_) => 1"));
    expect(repair?.preferred).toBeUndefined();
    expect(repair?.placeholders).toBe(true);
  });

  test("each `Debug.todo` selected in turn, for the dev to type over (decision 5, point 3)", () => {
    // The snippet begins the line below the last arm, where an editor has no
    // indentation of its own to add to the lines.
    const text = program("export let f(s: Shape): Int =", "    match s", "        Circle(_) => 1");
    const [edit] = repairs(text)[0]!.edits;
    expect(edit?.snippet?.span.start).toMatchObject({ line: 5, column: 0 });
    expect(edit?.snippet?.text).toBe(
      "        Square(_) => ${1:Debug.todo(\"Square(_)\")}\n" +
        "        Tri(_, _) => ${2:Debug.todo(\"Tri(_, _)\")}\n",
    );
    // Before what closes on the `match`'s last line, the lines would begin
    // inside it, so the arms are written as they stand, with nothing selected.
    const closing = program(
      "export let areas(xs: Vector(Shape)): Vector(Float) = xs.map(match",
      "    Circle(r) => r)",
    );
    expect(repairs(closing)[0]!.edits.map(({ snippet }) => snippet)).toEqual([undefined]);
  });
});

describe("where the arms go", () => {
  test("below a comment that ends the last arm's line", () => {
    expect(filled(program("export let f(s: Shape): Int =", "    match s", "        Circle(_) => 1 // round")).text)
      .toContain("        Circle(_) => 1 // round\n        Square(_) => Debug.todo(\"Square(_)\")\n");
  });

  test("below a comment that ends the last arm's line, which stays with its arm", () => {
    expect(filled(program(
      "export let f(s: Shape): Int =",
      "    match s",
      "        Circle(_) => 1 // round",
      "        Square(_) => match s // again",
      "            Circle(_) => 3",
      "            _ => 4 // inner",
    )).text).toContain("            _ => 4 // inner\n        Tri(_, _) => Debug.todo(\"Tri(_, _)\")\n");
  });

  test("above the comments and declarations after a `match` nested in the last arm", () => {
    expect(filled(program(
      "export let f(s: Shape): Int =",
      "    match s",
      "        Circle(_) => 1",
      "        Square(_) => match s",
      "            Circle(_) => 3",
      "            _ => 4",
      "",
      "(** Doubles `n`. *)",
      "export let g(n: Int): Int = n * 2",
    ))).toEqual({
      text: program(
        "export let f(s: Shape): Int =",
        "    match s",
        "        Circle(_) => 1",
        "        Square(_) => match s",
        "            Circle(_) => 3",
        "            _ => 4",
        "        Tri(_, _) => Debug.todo(\"Tri(_, _)\")",
        "",
        "(** Doubles `n`. *)",
        "export let g(n: Int): Int = n * 2",
      ),
      diagnostics: [],
    });
  });

  test("below block comments that end the last arm's line, nested ones too", () => {
    expect(filled(program("export let f(s: Shape): Int =", "    match s", "        Circle(_) => 1 (* round *) // and whole")).text)
      .toContain("        Circle(_) => 1 (* round *) // and whole\n        Square(_) => Debug.todo(\"Square(_)\")\n");
    expect(filled(program("export let f(s: Shape): Int =", "    match s", "        Circle(_) => 1 (* a (* b *) c *)")).text)
      .toContain("        Circle(_) => 1 (* a (* b *) c *)\n        Square(_) => Debug.todo(\"Square(_)\")\n");
    expect(filled(program("export let f(s: Shape): Int =", "    match s", "        Circle(_) => 1\t// round")).text)
      .toContain("        Circle(_) => 1\t// round\n        Square(_) => Debug.todo(\"Square(_)\")\n");
  });

  test("before a block comment that the last arm's line leaves open", () => {
    // Block comments nest (Comments §3), so the `//` is inside one still open.
    expect(filled(program(
      "export let f(s: Shape): Int =",
      "    match s",
      "        Circle(_) => 1 (* (* x *) // y",
      "           more *)",
      "export let g: Int = 2",
    ))).toEqual({
      text: program(
        "export let f(s: Shape): Int =",
        "    match s",
        "        Circle(_) => 1",
        "        Square(_) => Debug.todo(\"Square(_)\")",
        "        Tri(_, _) => Debug.todo(\"Tri(_, _)\") (* (* x *) // y",
        "           more *)",
        "export let g: Int = 2",
      ),
      diagnostics: [],
    });
  });

  test("before what closes around the `match` on its last line", () => {
    expect(filled(program(
      "export let areas(xs: Vector(Shape)): Vector(Float) = xs.map(match",
      "    Circle(r) => r)",
    ))).toEqual({
      text: program(
        "export let areas(xs: Vector(Shape)): Vector(Float) = xs.map(match",
        "    Circle(r) => r",
        "    Square(_) => Debug.todo(\"Square(_)\")",
        "    Tri(_, _) => Debug.todo(\"Tri(_, _)\"))",
      ),
      diagnostics: [],
    });
  });

  test("before a `catch` clause", () => {
    expect(filled(program(
      "export let parse(text: String): Int =",
      "    match Int.parse^(text)",
      "        0 => 0",
      "    catch",
      "        NumberFormatError(_) => -1",
    )).text).toContain("        0 => 0\n        _ => Debug.todo(\"_\")\n    catch\n");
  });

  test("with the file's line endings", () => {
    const text = program("export let f(s: Shape): Int =", "    match s", "        Circle(_) => 1").replaceAll("\n", "\r\n");
    expect(filled(text)).toEqual({
      text: program(
        "export let f(s: Shape): Int =",
        "    match s",
        "        Circle(_) => 1",
        "        Square(_) => Debug.todo(\"Square(_)\")",
        "        Tri(_, _) => Debug.todo(\"Tri(_, _)\")",
      ).replaceAll("\n", "\r\n"),
      diagnostics: [],
    });
    const commented = program("export let f(s: Shape): Int =", "    match s", "        Circle(_) => 1 // round")
      .replaceAll("\n", "\r\n");
    expect(filled(commented).text).toContain("        Circle(_) => 1 // round\r\n        Square(_) => Debug.todo(\"Square(_)\")\r\n");
    const unended = program("export let f(s: Shape): Int =", "    match s", "        Circle(_) => 1").replaceAll("\n", "\r\n")
      .replace(/\r\n$/, "");
    expect(filled(unended).text).toBe(unended + "\r\n        Square(_) => Debug.todo(\"Square(_)\")\r\n        Tri(_, _) => Debug.todo(\"Tri(_, _)\")");
  });
});

describe("not offered where the arms would not be the whole of what is missing, or would not paste", () => {
  test("more cases than the report looks for", () => {
    const union = (count: number) =>
      `export union Many = ${Array.from({ length: count }, (_, index) => `C${index}`).join(" | ")}`;
    const text = (count: number) =>
      ["module Main", union(count), "export let f(m: Many): Int =", "    match m", "        C0 => 1", ""].join("\n");
    // The search lists a hundred in full, so 101 missing cases offer none,
    // and the report's count is a floor.
    const report = (count: number) =>
      session({ "/main.hex": text(count) }).diagnostics("/main.hex").map(({ message }) => message);
    expect(report(102)).toEqual(["match is missing cases: `C1`, `C2`, `C3` …and at least 98 more"]);
    expect(report(101)).toEqual(["match is missing cases: `C1`, `C2`, `C3` …and 97 more"]);
    expect(repairs(text(102))).toEqual([]);
    expect(repairs(text(101)).map(({ title }) => title)).toEqual(["Add the 100 missing arms"]);
  });

  test("anywhere the parser did not read the file as written, whose recovery's arms are not the block's", () => {
    const lines = ["export let f(s: Shape): Int =", "    match s", "        Circle(_) => 1"];
    expect(repairs(program(...lines, "export let broken: Int = (1 +"))).toEqual([]);
    // Recovery reads a line of a nested block as an arm.
    expect(repairs(program(...lines, "        fun g() =", "            Square(_) => 2"))).toEqual([]);
    // A doc comment's error is about the comment, and leaves the code read as
    // written.
    expect(repairs(program(...lines, "(** nothing *)")).map(({ title }) => title)).toEqual(["Add the 2 missing arms"]);
  });

  test("a vector's missing length, one of unboundedly many", () => {
    expect(repairs(program("export let f(v: Vector(Int)): Int =", "    match v", "        [x] => x"))).toEqual([]);
  });

  test("a case this module cannot spell until it imports a module (Pattern Matching §7.3 tier 3)", () => {
    const files = {
      "/flags.hex": "module Flags\n\nexport union Flag = On | Off\n",
      "/b.hex": "module B\n\nimport Flags as F\nexport fun make(): F.Flag = F.On\n",
    };
    const text = ["module Main", "import B", "union Local = Off | Other", "export fun f(): Int =", "    match B.make()", "        On => 1", ""]
      .join("\n");
    expect(session({ ...files, "/main.hex": text }).diagnostics("/main.hex").map(({ message }) => message)).toEqual([
      "match is missing cases: `Off` — `Off` is declared in module `Flags`, and this module binds another `Off`; " +
      "`import Flags` and spell it `Flags.Off`",
    ]);
    expect(repairs(text, files)).toEqual([]);
  });

  test("a first arm that does not begin its line, whose column the new arms could not match", () => {
    expect(repairs(program("export let f(s: Shape): Int =", "    match s", "        (* round *) Circle(_) => 1"))).toEqual([]);
  });

  test("an `import Debug` below the `match`, which the arms could not yet read (Modules §3)", () => {
    const lines = ["export let f(s: Shape): Int =", "    match s", "        Circle(_) => 1"];
    expect(repairs(["module Main", SHAPE, ...lines, "import Debug", ""].join("\n"))).toEqual([]);
  });

  test("where `Debug` is not the prelude's", () => {
    const text = ["module Main", "import Debug", SHAPE, "export let f(s: Shape): Int =", "    match s", "        Circle(_) => 1", ""]
      .join("\n");
    const own = { "/Debug.hex": "module Debug\nexport let todo(what: String): Int = 0\n" };
    expect(session({ ...own, "/main.hex": text }).diagnostics("/main.hex").map(({ message }) => message))
      .toEqual(["match is missing cases: `Square(_)`, `Tri(_, _)`"]);
    expect(repairs(text, own)).toEqual([]);
  });
});
