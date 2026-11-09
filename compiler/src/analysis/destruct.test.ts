import { describe, expect, test } from "vitest";
import { AnalysisSession, type CodeAction } from "./session.js";

/**
 * Destruct (language-server plan, section C, tier 2): on a `match` with no
 * arms yet, the editor writes one arm per case of the subject's type, each
 * body a `Debug.todo` naming the case (decision 5), as the repair for the
 * report of the missing arm block.
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

/** The repairs offered on the first `match`, asked as the editor asks on its own. */
function repairs(text: string): readonly CodeAction[] {
  const at = text.indexOf("match");
  return session({ "/main.hex": text }).codeActions("/main.hex", { start: at, end: at })
    .filter(({ diagnostic }) => diagnostic?.message === "expected an indented block of match arms");
}

function applied(text: string, action: CodeAction): string {
  return [...action.edits].reverse().reduce(
    (written, { span, replacement }) => written.slice(0, span.start.offset) + replacement + written.slice(span.end.offset),
    text,
  );
}

/** The program after the one repair, and what it then reports. */
function destructed(text: string): { readonly text: string; readonly diagnostics: readonly string[] } {
  const [repair, ...others] = repairs(text);
  expect(others).toEqual([]);
  if (repair === undefined) throw new Error("no repair offered");
  const after = applied(text, repair);
  return { text: after, diagnostics: session({ "/main.hex": after }).diagnostics("/main.hex").map(({ message }) => message) };
}

describe("destruct on a `match` with no arms", () => {
  test("one arm per case of the subject's type, in declaration order", () => {
    const text = program("export let area(s: Shape): Float =", "    match s", "export let one: Int = 1");
    expect(repairs(text).map(({ title, kind, preferred }) => ({ title, kind, preferred })))
      .toEqual([{ title: "Add the 3 arms", kind: "quickfix", preferred: undefined }]);
    expect(destructed(text)).toEqual({
      text: program(
        "export let area(s: Shape): Float =",
        "    match s",
        "        Circle(_) => Debug.todo(\"Circle(_)\")",
        "        Square(_) => Debug.todo(\"Square(_)\")",
        "        Tri(_, _) => Debug.todo(\"Tri(_, _)\")",
        "export let one: Int = 1",
      ),
      diagnostics: [],
    });
  });

  test("its stand-ins selected in turn", () => {
    const text = program("export let area(s: Shape): Float =", "    match s");
    expect(repairs(text)[0]?.edits.map(({ snippet }) => snippet?.text)).toEqual([
      "        Circle(_) => ${1:Debug.todo(\"Circle(_)\")}\n" +
      "        Square(_) => ${2:Debug.todo(\"Square(_)\")}\n" +
      "        Tri(_, _) => ${3:Debug.todo(\"Tri(_, _)\")}\n",
    ]);
  });

  test("a match function's, from its parameter's type", () => {
    const text = program("let area: Shape -> Float =", "    match", "export let one: Float = area(Circle(1.0))");
    expect(destructed(text)).toEqual({
      text: program(
        "let area: Shape -> Float =",
        "    match",
        "        Circle(_) => Debug.todo(\"Circle(_)\")",
        "        Square(_) => Debug.todo(\"Square(_)\")",
        "        Tri(_, _) => Debug.todo(\"Tri(_, _)\")",
        "export let one: Float = area(Circle(1.0))",
      ),
      diagnostics: [],
    });
  });

  test("one step in from where the `match`'s line begins, below its comments", () => {
    const text = program("export let area(s: Shape): Float = match s // to do", "export let one: Int = 1");
    expect(destructed(text)).toEqual({
      text: program(
        "export let area(s: Shape): Float = match s // to do",
        "    Circle(_) => Debug.todo(\"Circle(_)\")",
        "    Square(_) => Debug.todo(\"Square(_)\")",
        "    Tri(_, _) => Debug.todo(\"Tri(_, _)\")",
        "export let one: Int = 1",
      ),
      diagnostics: [],
    });
  });

  test("nested cases are the type's own: `Bool`, `Option`", () => {
    const text = program("export let f(o: Option(Bool)): Int =", "    match o");
    expect(destructed(text)).toEqual({
      text: program(
        "export let f(o: Option(Bool)): Int =",
        "    match o",
        "        Some(_) => Debug.todo(\"Some(_)\")",
        "        None => Debug.todo(\"None\")",
      ),
      diagnostics: [],
    });
  });

  test("with the file's line ending", () => {
    const text = program("export let area(s: Shape): Float =", "    match s", "export let one: Int = 1").replaceAll("\n", "\r\n");
    expect(destructed(text).text).toBe(program(
      "export let area(s: Shape): Float =",
      "    match s",
      "        Circle(_) => Debug.todo(\"Circle(_)\")",
      "        Square(_) => Debug.todo(\"Square(_)\")",
      "        Tri(_, _) => Debug.todo(\"Tri(_, _)\")",
      "export let one: Int = 1",
    ).replaceAll("\n", "\r\n"));
  });

  test("not where there are no cases to name, or the file was not read as written", () => {
    expect(repairs(program("export let f(n: Int): Int =", "    match n"))).toEqual([]);
    expect(repairs(program("export let f(p: { x: Int }): Int =", "    match p"))).toEqual([]);
    expect(repairs(program("export record Point = { x: Int, y: Int }", "export let f(p: Point): Int =", "    match p")))
      .toEqual([]);
    expect(repairs(program("export let area(s: Shape): Float =", "    match s", ")"))).toEqual([]);
    expect(repairs(program("module Debug", "export let area(s: Shape): Float =", "    match s"))).toEqual([]);
  });
});

/** The splits offered at the `n`-th occurrence of `needle`, as the editor's Refactor menu asks. */
function splits(text: string, needle: string, n = 1): readonly CodeAction[] {
  let at = -1;
  for (let index = 0; index < n; index += 1) at = text.indexOf(needle, at + 1);
  return session({ "/main.hex": text }).codeActions("/main.hex", { start: at, end: at }, { invoked: true })
    .filter(({ title }) => title.startsWith("Split `") || title.startsWith("Write `"));
}

/** The program after the one split offered there, and what it then reports. */
function split(text: string, needle: string, n = 1): { readonly title: string; readonly text: string; readonly diagnostics: readonly string[] } {
  const [action, ...others] = splits(text, needle, n);
  expect(others).toEqual([]);
  if (action === undefined) throw new Error("no split offered");
  expect(action.kind).toBe("refactor");
  const after = applied(text, action);
  return {
    title: action.title,
    text: after,
    diagnostics: session({ "/main.hex": after }).diagnostics("/main.hex").map(({ message }) => message),
  };
}

describe("destruct on a variable or `_` in an arm's pattern", () => {
  test("the arm once per case, each with its body, the variable kept bound where the body names it", () => {
    const text = program(
      "let area(s: Shape): Float = 1.0",
      "export let f(o: Option(Shape)): Float =",
      "    match o",
      "        Some(s) => area(s)",
      "        None => 0.0",
    );
    expect(split(text, "s)", 1)).toEqual({
      title: "Split `s` into 3 arms",
      text: program(
        "let area(s: Shape): Float = 1.0",
        "export let f(o: Option(Shape)): Float =",
        "    match o",
        "        Some(Circle(_) as s) => area(s)",
        "        Some(Square(_) as s) => area(s)",
        "        Some(Tri(_, _) as s) => area(s)",
        "        None => 0.0",
      ),
      diagnostics: [],
    });
  });

  test("only the cases that still reach the arm, and a guard comes along", () => {
    const text = program(
      "let area(s: Shape): Float = 1.0",
      "export let f(o: Option(Shape), big: Bool): Float =",
      "    match o",
      "        Some(Circle(_)) => 0.0",
      "        Some(s) when big => area(s)",
      "        _ => 2.0",
    );
    expect(split(text, "s) when")).toEqual({
      title: "Split `s` into 2 arms",
      text: program(
        "let area(s: Shape): Float = 1.0",
        "export let f(o: Option(Shape), big: Bool): Float =",
        "    match o",
        "        Some(Circle(_)) => 0.0",
        "        Some(Square(_) as s) when big => area(s)",
        "        Some(Tri(_, _) as s) when big => area(s)",
        "        _ => 2.0",
      ),
      diagnostics: [],
    });
  });

  test("a guarded arm above leaves its cases reaching", () => {
    const text = program(
      "export let f(o: Option(Shape), big: Bool): Float =",
      "    match o",
      "        Some(Circle(_)) when big => 0.0",
      "        Some(_) => 1.0",
      "        None => 2.0",
    );
    expect(split(text, "_) => 1.0").title).toBe("Split `_` into 3 arms");
  });

  test("one case left reaching: the variable written as it", () => {
    const text = program(
      "export let f(s: Shape): Float =",
      "    match s",
      "        Circle(_) => 0.0",
      "        Square(_) => 1.0",
      "        other => 2.0",
    );
    expect(split(text, "other")).toEqual({
      title: "Write `other` as `Tri(_, _)`",
      text: program(
        "export let f(s: Shape): Float =",
        "    match s",
        "        Circle(_) => 0.0",
        "        Square(_) => 1.0",
        "        Tri(_, _) => 2.0",
      ),
      diagnostics: [],
    });
  });

  test("a `_` splits with no `as`, and its parts split in turn", () => {
    const text = program(
      "export let f(o: Option(Option(Bool))): Int =",
      "    match o",
      "        Some(_) => 1",
      "        None => 0",
    );
    const once = split(text, "_");
    expect(once).toEqual({
      title: "Split `_` into 2 arms",
      text: program(
        "export let f(o: Option(Option(Bool))): Int =",
        "    match o",
        "        Some(Some(_)) => 1",
        "        Some(None) => 1",
        "        None => 0",
      ),
      diagnostics: [],
    });
    expect(split(once.text, "_").text).toBe(program(
      "export let f(o: Option(Option(Bool))): Int =",
      "    match o",
      "        Some(Some(False)) => 1",
      "        Some(Some(True)) => 1",
      "        Some(None) => 1",
      "        None => 0",
    ));
  });

  test("a whole arm's binder, a tuple's part, and a multi-line body copied whole", () => {
    const text = program(
      "let area(s: Shape): Float = 1.0",
      "export let f(pair: (Shape, Int)): Float =",
      "    match pair",
      "        (s, n) =>",
      "            let k = area(s)",
      "            k",
    );
    expect(split(text, "s, n)").text).toBe(program(
      "let area(s: Shape): Float = 1.0",
      "export let f(pair: (Shape, Int)): Float =",
      "    match pair",
      "        (Circle(_) as s, n) =>",
      "            let k = area(s)",
      "            k",
      "        (Square(_) as s, n) =>",
      "            let k = area(s)",
      "            k",
      "        (Tri(_, _) as s, n) =>",
      "            let k = area(s)",
      "            k",
    ));
    const whole = program(
      "let area(s: Shape): Float = 1.0",
      "export let f(pair: (Shape, Int)): Float =",
      "    match pair",
      "        p => 1.0",
    );
    expect(split(whole, "p =>")).toMatchObject({ title: "Write `p` as `(_, _)`", diagnostics: [] });
    const used = program(
      "let area(s: Shape): Float = 1.0",
      "export let f(v: Vector(Shape)): Float =",
      "    match v",
      "        [s] => area(s)",
      "        _ => 0.0",
    );
    expect(split(used, "s]")).toMatchObject({ title: "Split `s` into 3 arms", diagnostics: [] });
    expect(split(used, "s]").text).toContain("        [Circle(_) as s] => area(s)\n");
    const root = program(
      "let area(s: Shape): Float = 1.0",
      "export let f(s: Shape): Float =",
      "    match s",
      "        other => area(other)",
    );
    expect(split(root, "other =>")).toMatchObject({ title: "Split `other` into 3 arms", diagnostics: [] });
    expect(split(root, "other =>").text).toContain("        Circle(_) as other => area(other)\n");
  });

  test("a variable a field named by punning keeps the field's name", () => {
    const text = [
      "module Main",
      SHAPE,
      "export record Tile = { shape: Shape, n: Int }",
      "let area(s: Shape): Float = 1.0",
      "export let f(t: Tile): Float =",
      "    match t",
      "        Tile({ shape, n }) => area(shape)",
      "",
    ].join("\n");
    expect(split(text, "shape, n")).toMatchObject({
      title: "Split `shape` into 3 arms",
      diagnostics: [],
    });
    expect(split(text, "shape, n").text).toContain("        Tile({ shape = Circle(_) as shape, n }) => area(shape)\n");
  });

  test("a match function's arm splits too", () => {
    const text = program(
      "let f: Option(Bool) -> Int =",
      "    match",
      "        Some(b) => 1",
      "        None => 0",
      "export let one: Int = f(None)",
    );
    expect(split(text, "b)")).toEqual({
      title: "Split `b` into 2 arms",
      text: program(
        "let f: Option(Bool) -> Int =",
        "    match",
        "        Some(False) => 1",
        "        Some(True) => 1",
        "        None => 0",
        "export let one: Int = f(None)",
      ),
      diagnostics: [],
    });
  });

  test("an unused variable is written as its case alone, one under `as` keeps it", () => {
    const text = program(
      "export let f(o: Option(Bool)): Bool =",
      "    match o",
      "        Some(b) => True",
      "        None => False",
    );
    expect(split(text, "b)").text).toContain("        Some(False) => True\n        Some(True) => True\n");
    const named = program(
      "export let f(o: Option(Bool)): Option(Bool) =",
      "    match o",
      "        Some(b as inner) => if b then Some(inner) else None",
      "        None => None",
    );
    expect(split(named, "b as")).toEqual({
      title: "Split `b` into 2 arms",
      text: program(
        "export let f(o: Option(Bool)): Option(Bool) =",
        "    match o",
        "        Some((False as b) as inner) => if b then Some(inner) else None",
        "        Some((True as b) as inner) => if b then Some(inner) else None",
        "        None => None",
      ),
      diagnostics: [],
    });
  });

  test("a variable only the guard names stays bound", () => {
    const text = program(
      "let round(s: Shape): Bool = True",
      "export let f(o: Option(Shape)): Int =",
      "    match o",
      "        Some(s) when round(s) => 1",
      "        _ => 0",
    );
    expect(split(text, "s) when")).toEqual({
      title: "Split `s` into 3 arms",
      text: program(
        "let round(s: Shape): Bool = True",
        "export let f(o: Option(Shape)): Int =",
        "    match o",
        "        Some(Circle(_) as s) when round(s) => 1",
        "        Some(Square(_) as s) when round(s) => 1",
        "        Some(Tri(_, _) as s) when round(s) => 1",
        "        _ => 0",
      ),
      diagnostics: [],
    });
  });

  test("a field's own pattern, a comment after the arm, and a nested `match` in the body", () => {
    const text = [
      "module Main",
      SHAPE,
      "export record Tile = { shape: Shape, n: Int }",
      "export let f(t: Tile, o: Option(Int)): Int =",
      "    match t",
      "        Tile({ shape = s, n }) => // the rest",
      "            match o",
      "                Some(k) => k + n",
      "                None => n",
      "",
    ].join("\n");
    expect(split(text, "s, n")).toEqual({
      title: "Split `s` into 3 arms",
      text: [
        "module Main",
        SHAPE,
        "export record Tile = { shape: Shape, n: Int }",
        "export let f(t: Tile, o: Option(Int)): Int =",
        "    match t",
        "        Tile({ shape = Circle(_), n }) => // the rest",
        "            match o",
        "                Some(k) => k + n",
        "                None => n",
        "        Tile({ shape = Square(_), n }) => // the rest",
        "            match o",
        "                Some(k) => k + n",
        "                None => n",
        "        Tile({ shape = Tri(_, _), n }) => // the rest",
        "            match o",
        "                Some(k) => k + n",
        "                None => n",
        "",
      ].join("\n"),
      diagnostics: [],
    });
  });

  test("with the file's line ending", () => {
    const text = program(
      "export let f(o: Option(Bool)): Int =",
      "    match o",
      "        Some(_) => 1",
      "        None => 0",
    ).replaceAll("\n", "\r\n");
    expect(split(text, "_)")).toEqual({
      title: "Split `_` into 2 arms",
      text: program(
        "export let f(o: Option(Bool)): Int =",
        "    match o",
        "        Some(False) => 1",
        "        Some(True) => 1",
        "        None => 0",
      ).replaceAll("\n", "\r\n"),
      diagnostics: [],
    });
  });

  test("not offered where there are no cases to name, under an or-pattern, or on an unreachable arm", () => {
    const nothing = (text: string, needle: string) => expect(splits(text, needle)).toEqual([]);
    nothing(program("export let f(n: Int): Int =", "    match n", "        0 => 1", "        k => k"), "k =>");
    nothing(program("export let f(o: Option(String)): Int =", "    match o", "        Some(s) => 1", "        None => 0"), "s)");
    nothing(program(
      "export record Point = { x: Int, y: Int }",
      "export let f(p: Point): Int =",
      "    match p",
      "        q => 1",
    ), "q =>");
    nothing(program(
      "export let f(o: Option(Bool)): Int =",
      "    match o",
      "        Some(b) | None => 1",
    ), "b)");
    nothing(program(
      "export let f(o: Option(Bool)): Int =",
      "    match o",
      "        _ => 1",
      "        Some(b) => 2",
    ), "b)");
    // Not unasked: nearly every arm has a variable.
    const text = program("export let f(o: Option(Bool)): Int =", "    match o", "        Some(b) => 1", "        None => 0");
    const at = text.indexOf("b)");
    expect(session({ "/main.hex": text }).codeActions("/main.hex", { start: at, end: at })
      .filter(({ title }) => title.startsWith("Split"))).toEqual([]);
  });
});
