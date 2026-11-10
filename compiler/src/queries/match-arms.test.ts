import { describe, expect, test } from "vitest";
import { AnalysisSession, type CodeAction } from "../analysis/session.js";
import { applyLayout } from "../passes/layout/layout.js";
import { lex } from "../passes/lexer/lexer.js";
import { parseFile } from "../passes/parser/parser.js";
import * as Source from "../support/source.js";
import type * as Parsed from "../syntax/parsed/index.js";
import { SPLIT_TITLE, combineTitle, readsCombined, readsSplit } from "./match-arms.js";
import { matchedBody } from "./same-reading.js";

const TYPES = [
  "module Main",
  "export union Shape = Circle(size: Float) | Square(size: Float) | Dot",
  "export union Item = Num(n: Int) | Text(s: String)",
  "export union Two(a, b) = L(a) | R(b)",
  "exception Bad(code: Int)",
  "exception Worse(code: Int)",
  "export let f(s: Shape): Float = 1.0",
].join("\n");

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

const program = (...lines: readonly string[]): string => [TYPES, ...lines, ""].join("\n");

/** The arm refactorings offered at the caret or selection, by title. */
function offered(source: string): ReadonlyMap<string, CodeAction> {
  const { text, start, end } = marked(source);
  return new Map(
    session(text).codeActions("/main.hex", { start, end }, { invoked: true })
      .filter(({ kind, title }) => kind === "refactor" && (title.startsWith("Combine") || title.startsWith("Split")))
      .map((action) => [action.title, action]),
  );
}

const titles = (source: string): readonly string[] => [...offered(source).keys()];

function reports(text: string): readonly string[] {
  return session(text).diagnostics("/main.hex").map(({ message }) => message);
}

/**
 * The program after the refactoring named `title` is applied, or why it is
 * refused. The program and what it becomes each report nothing.
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

const GUARDED = "refused: An arm with a `when` guard runs it once per `match`, after the first alternative that matches " +
  "(Pattern Matching §3), so its alternatives and separate arms are not the same.";

describe("arms with one body combined into one", () => {
  test("adjacent arms, as one or-pattern in their order", () => {
    expect(rewritten(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Ci‸rcle(_) => 0",
      "        Square(_) => 0",
      "        Dot => 1",
    ), combineTitle(2))).toBe(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) | Square(_) => 0",
      "        Dot => 1",
    ));
  });

  test("the whole run around the arm asked on, from its pattern or its arrow, not its body", () => {
    const run = (at: string): string => program(
      "export let g(o: Option(Int)): Int =",
      "    match o",
      "        Some(1) => 0",
      "        Some(2) => 1",
      `        Some(3) ${at}`,
      "        Some(4) => 1",
      "        _ => 1",
    );
    const combined = program(
      "export let g(o: Option(Int)): Int =",
      "    match o",
      "        Some(1) => 0",
      "        Some(2) | Some(3) | Some(4) | _ => 1",
    );
    expect(rewritten(run("‸=> 1"), combineTitle(4))).toBe(combined);
    expect(rewritten(run("=‸> 1"), combineTitle(4))).toBe(combined);
    expect(titles(run("=> ‸1"))).toEqual([]);
  });

  test("binding the same names at the same types", () => {
    expect(rewritten(program(
      "export let g(s: Shape): Float =",
      "    match s",
      "        Circle(‸x) => x * 2.0",
      "        Square(x) => x * 2.0",
      "        Dot => 0.0",
    ), combineTitle(2))).toBe(program(
      "export let g(s: Shape): Float =",
      "    match s",
      "        Circle(x) | Square(x) => x * 2.0",
      "        Dot => 0.0",
    ));
  });

  test("an or-pattern among them, and an `as` in parentheses", () => {
    expect(rewritten(program(
      "export let g(s: Shape): Float =",
      "    match s",
      "        Circle(_) | Dot ‸=> 0.0",
      "        Square(_) => 0.0",
    ), combineTitle(2))).toBe(program(
      "export let g(s: Shape): Float =",
      "    match s",
      "        Circle(_) | Dot | Square(_) => 0.0",
    ));
    expect(rewritten(program(
      "export let g(s: Shape): Float =",
      "    match s",
      "        Circle(_) as t ‸=> f(t)",
      "        (Square(_) as t) => f(t)",
      "        Dot => 0.0",
    ), combineTitle(2))).toBe(program(
      "export let g(s: Shape): Float =",
      "    match s",
      "        (Circle(_) as t) | (Square(_) as t) => f(t)",
      "        Dot => 0.0",
    ));
  });

  test("a body over lines, a body laid out differently, and comments in what is kept", () => {
    expect(rewritten(program(
      "export let g(s: Shape): Float =",
      "    match s",
      "        Circle(_) (* round *) ‸=>",
      "            let r = 1.0",
      "            r // the first",
      "        Square(_) =>",
      "            let r =   1.0",
      "            r",
      "        Dot => 0.0",
    ), combineTitle(2))).toBe(program(
      "export let g(s: Shape): Float =",
      "    match s",
      "        Circle(_) | Square(_) (* round *) =>",
      "            let r = 1.0",
      "            r // the first",
      "        Dot => 0.0",
    ));
  });

  test("literal and record patterns", () => {
    expect(rewritten(program(
      "export let g(n: Int): String =",
      "    match n",
      "        0 ‸=> \"small\"",
      "        1 => \"small\"",
      "        _ => \"big\"",
    ), combineTitle(2))).toBe(program(
      "export let g(n: Int): String =",
      "    match n",
      "        0 | 1 => \"small\"",
      "        _ => \"big\"",
    ));
    expect(rewritten(program(
      "export let g(r: {x: Int, y: Int}): Int =",
      "    match r",
      "        {x = 0, y} ‸=> y",
      "        {x = 1, y} => y",
      "        _ => 0",
    ), combineTitle(2))).toBe(program(
      "export let g(r: {x: Int, y: Int}): Int =",
      "    match r",
      "        {x = 0, y} | {x = 1, y} => y",
      "        _ => 0",
    ));
  });

  test("the arms a selection touches, and no others", () => {
    expect(rewritten(program(
      "export let g(o: Option(Int)): Int =",
      "    match o",
      "        Some(1) => 1",
      "        So‸me(2) => 1",
      "        Some(3)‸ => 1",
      "        _ => 0",
    ), combineTitle(2))).toBe(program(
      "export let g(o: Option(Int)): Int =",
      "    match o",
      "        Some(1) => 1",
      "        Some(2) | Some(3) => 1",
      "        _ => 0",
    ));
  });

  test("a selection of an arm's head up to its body, as a caret there", () => {
    expect(rewritten(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        ‸Circle(_) => ‸0",
      "        Square(_) => 0",
      "        Dot => 1",
    ), combineTitle(2))).toBe(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) | Square(_) => 0",
      "        Dot => 1",
    ));
  });

  test("a selection in a `match` inside an arm, which takes the inner arms", () => {
    expect(rewritten(program(
      "export let g(s: Shape, n: Int): Int =",
      "    match s",
      "        Dot =>",
      "            match n",
      "                ‸0 => 1",
      "                1 => 1‸",
      "                _ => 2",
      "        _ => 3",
    ), combineTitle(2))).toBe(program(
      "export let g(s: Shape, n: Int): Int =",
      "    match s",
      "        Dot =>",
      "            match n",
      "                0 | 1 => 1",
      "                _ => 2",
      "        _ => 3",
    ));
  });

  test("in a `match`'s `catch` clause", () => {
    const throwing = "let parse(n: Int) = if n > 0 then throw^(Bad(n)) else n";
    expect(rewritten(program(
      throwing,
      "export let h(s: Int): Int =",
      "    match parse^(s)",
      "        n => n",
      "    catch",
      "        Bad(c) ‸=> c",
      "        Worse(c) => c",
    ), combineTitle(2))).toBe(program(
      throwing,
      "export let h(s: Int): Int =",
      "    match parse^(s)",
      "        n => n",
      "    catch",
      "        Bad(c) | Worse(c) => c",
    ));
  });

  test("moving each comment with what it is in", () => {
    // The first arm's comment after its body follows the patterns now, and
    // the second pattern's comment comes before it.
    expect(rewritten(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle((* any *) _) ‸=> 0\t// round",
      "        Square((* side *) _) => 0",
      "        Dot => 1",
    ), combineTitle(2))).toBe(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle((* any *) _) | Square((* side *) _) => 0\t// round",
      "        Dot => 1",
    ));
  });

  test("arms sharing a line", () => {
    expect(rewritten(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) ‸=> 0; Square(_) => 0",
      "        Dot => 1",
    ), combineTitle(2))).toBe(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) | Square(_) => 0",
      "        Dot => 1",
    ));
  });

  test("in a match function, and in `try`'s arms", () => {
    expect(rewritten(program(
      "let g: (Shape) -> Int = match",
      "    Circle(_) ‸=> 0",
      "    Square(_) => 0",
      "    Dot => 1",
    ), combineTitle(2))).toBe(program(
      "let g: (Shape) -> Int = match",
      "    Circle(_) | Square(_) => 0",
      "    Dot => 1",
    ));
    expect(rewritten(program(
      "export let h(n: Int): Int =",
      "    try",
      "        if n > 0 then throw^(Bad(n)) else n",
      "    catch",
      "        Bad(c) ‸=> c",
      "        Worse(c) => c",
    ), combineTitle(2))).toBe(program(
      "export let h(n: Int): Int =",
      "    try",
      "        if n > 0 then throw^(Bad(n)) else n",
      "    catch",
      "        Bad(c) | Worse(c) => c",
    ));
  });

  test("in a `fun` block's member, combined and split", () => {
    const block = (...arms: readonly string[]): string => program(
      "fun",
      "    g(s: Shape): Int = h(s)",
      "    h(s: Shape): Int =",
      "        match s",
      ...arms,
    );
    expect(rewritten(block("            Circle(_) ‸=> 0", "            Square(_) => 0", "            Dot => 1"), combineTitle(2)))
      .toBe(block("            Circle(_) | Square(_) => 0", "            Dot => 1"));
    expect(rewritten(block("            Circle(_) | Square(_) ‸=> 0", "            Dot => 1"), SPLIT_TITLE))
      .toBe(block("            Circle(_) => 0", "            Square(_) => 0", "            Dot => 1"));
  });
});

describe("arms combined, refused", () => {
  test("a guarded arm with its neighbour", () => {
    const source = program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(x) when x > 1.0 ‸=> 0",
      "        Square(_) => 0",
      "        _ => 1",
    );
    expect(rewritten(source, combineTitle(2))).toBe(GUARDED);
    expect(rewritten(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        ‸Circle(x) when x > 1.0 => 0",
      "        Square(_) => 0‸",
      "        _ => 1",
    ), combineTitle(2))).toBe(GUARDED);
    expect(rewritten(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Square(_) => 0",
      "        Circle(x) when x > 1.0 ‸=> 0",
      "        _ => 1",
    ), combineTitle(2))).toBe(GUARDED);
  });

  test("a guarded arm with a guarded neighbour, which its run takes", () => {
    expect(rewritten(program(
      "export let g(o: Option(Int)): Int =",
      "    match o",
      "        Some(n) when n > 0 => 1",
      "        Some(n) when n < 0 ‸=> 1",
      "        _ => 0",
    ), combineTitle(2))).toBe(GUARDED);
  });

  test("names bound in one arm and not another", () => {
    expect(rewritten(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(x) ‸=> 0",
      "        Square(y) => 0",
      "        Dot => 1",
    ), combineTitle(2))).toBe(
      "refused: `x` is bound in one of these arms and not in another, and an or-pattern binds the same names in every " +
        "alternative (Pattern Matching §2.6).",
    );
  });

  test("a name bound at two types, written or inferred", () => {
    expect(rewritten(program(
      "export let g(i: Item): Int =",
      "    match i",
      "        Num(v) ‸=> 0",
      "        Text(v) => 0",
    ), combineTitle(2))).toBe(
      "refused: `v` is `Int` in one of these arms and `String` in another, and an or-pattern binds it at one type.",
    );
    expect(rewritten(program(
      "export let g(t: Two(a, b)): Int =",
      "    match t",
      "        L(v) ‸=> 0",
      "        R(v) => 0",
    ), combineTitle(2))).toBe("refused: `v` has a different type in each of these arms, and an or-pattern binds it at one type.");
  });

  test("but not one type written through two names", () => {
    const source = (...arms: readonly string[]): string => [
      "module Main",
      "import Hex.Option as O",
      "export union Pair = A(o: Option(Int)) | B(o: O.Option(Int))",
      "let h(o: Option(Int)): Int = 0",
      "export let g(p: Pair): Int =",
      "    match p",
      ...arms,
      "",
    ].join("\n");
    expect(rewritten(source("        A(o) ‸=> h(o)", "        B(o) => h(o)"), combineTitle(2)))
      .toBe(source("        A(o) | B(o) => h(o)"));
  });

  test("a comment only a later arm holds", () => {
    expect(rewritten(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) ‸=> 0",
      "        Square(_) => (* squares too *) 0",
      "        Dot => 1",
    ), combineTitle(2))).toBe("refused: A comment inside it would be lost. Move the comment out first.");
    expect(rewritten(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) ‸=> 0",
      "        // and squares",
      "        Square(_) => 0",
      "        Dot => 1",
    ), combineTitle(2))).toBe("refused: A comment inside it would be lost. Move the comment out first.");
  });

  test("one after a later arm's body, on its line", () => {
    expect(rewritten(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) ‸=> 0",
      "        Square(_) => 0 // squares too",
      "        Dot => 1",
    ), combineTitle(2))).toBe("refused: A comment inside it would be lost. Move the comment out first.");
  });

  test("but not one after the first arm's body, which the arm keeps, nor one after the arms", () => {
    expect(rewritten(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) ‸=> 0 // round ones",
      "        Square(_) => 0",
      "        // the rest",
      "        Dot => 1",
    ), combineTitle(2))).toBe(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) | Square(_) => 0 // round ones",
      "        // the rest",
      "        Dot => 1",
    ));
  });
});

describe("arms combined, not offered", () => {
  test("bodies that differ, or the same body in arms apart", () => {
    expect(titles(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) ‸=> 0",
      "        Square(_) => 1",
      "        Dot => 0",
    ))).toEqual([]);
  });

  test("a guarded arm beside the arm asked on ends the run", () => {
    expect(titles(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(x) when x > 1.0 => 0",
      "        Square(_) ‸=> 0",
      "        Dot => 1",
    ))).toEqual([]);
  });

  test("a fault arm, which ends the run", () => {
    expect(rewritten(program(
      "export let h(n: Int): Int =",
      "    try",
      "        if n > 0 then throw^(Bad(n)) else n",
      "    catch",
      "        Bad(_) ‸=> 0",
      "        Worse(_) => 0",
      "        fault _ => 0",
    ), combineTitle(2))).toBe(program(
      "export let h(n: Int): Int =",
      "    try",
      "        if n > 0 then throw^(Bad(n)) else n",
      "    catch",
      "        Bad(_) | Worse(_) => 0",
      "        fault _ => 0",
    ));
    expect(titles(program(
      "export let h(n: Int): Int =",
      "    try",
      "        if n > 0 then throw^(Bad(n)) else n",
      "    catch",
      "        Bad(_) => 0",
      "        ‸fault _ => 0",
    ))).toEqual([]);
    expect(titles(program(
      "export let h(n: Int): Int =",
      "    try",
      "        if n > 0 then throw^(Bad(n)) else n",
      "    catch",
      "        ‸Bad(_) => 0",
      "        fault _ => 0‸",
    ))).toEqual([]);
  });

  test("a selection ending where the next arm starts, or starting where the last ends, which touches one arm", () => {
    expect(titles(program(
      "export let g(o: Option(Int)): Int =",
      "    match o",
      "        Some(1) => 1",
      "        So‸me(2) => 1",
      "        ‸Some(3) => 1",
      "        _ => 0",
    ))).toEqual([]);
    expect(titles(program(
      "export let g(o: Option(Int)): Int =",
      "    match o",
      "        Some(1) => 1‸",
      "        Some(2) => ‸1",
      "        _ => 0",
    ))).toEqual([]);
  });

  test("a selection reaching out of the arms' `match`", () => {
    expect(titles(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Dot => 0",
      "        _ => 1",
      "export let h(s: Shape): Int =",
      "    match s",
      "        Dot => 1",
      "        Ci‸rcle(_) => 1",
      "        Square(_) => 1",
      "export let k(s: Shape): Int =",
      "    match s",
      "        Dot‸ => 1",
      "        _ => 0",
    ))).toEqual([]);
    expect(titles(program(
      "export let g(s: Shape): Int =",
      "    ma‸tch s",
      "        Circle(_) => 1",
      "        Square(_)‸ => 1",
      "        Dot => 0",
    ))).toEqual([]);
  });

  test("but a `match` with no arms yet, as one being written, is passed over", () => {
    const source = program(
      "export let g(s: Shape): Int =",
      "    match s",
      "export let h(o: Option(Int)): Int =",
      "    match o",
      "        So‸me(1) => 1",
      "        Some(2)‸ => 1",
      "        _ => 0",
    );
    expect(reports(marked(source).text)).toContain("expected an indented block of match arms");
    expect(titles(source)).toEqual([combineTitle(2)]);
  });

  test("a selection whose arms' bodies differ", () => {
    expect(titles(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Cir‸cle(_) => 0",
      "        Square(_) => 1‸",
      "        Dot => 0",
    ))).toEqual([]);
  });

  test("an arm whose pattern the checker could not read as written", () => {
    const source = program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Nope(x) ‸=> 0",
      "        Square(x) => 0",
      "        _ => 1",
    );
    expect(reports(marked(source).text)).toEqual(["`Shape` has no constructor `Nope`"]);
    expect(titles(source)).toEqual([]);
  });
});

describe("an or-pattern's arm split", () => {
  test("into one arm per alternative, each with the body", () => {
    expect(rewritten(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) | ‸Square(_) | Dot => 0",
    ), SPLIT_TITLE)).toBe(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) => 0",
      "        Square(_) => 0",
      "        Dot => 0",
    ));
  });

  test("alternatives that are `as` patterns, without their parentheses", () => {
    expect(rewritten(program(
      "export let g(s: Shape): Float =",
      "    match s",
      "        (Circle(_) as t) | (Square(_) as t) ‸=> f(t)",
      "        Dot => 0.0",
    ), SPLIT_TITLE)).toBe(program(
      "export let g(s: Shape): Float =",
      "    match s",
      "        Circle(_) as t => f(t)",
      "        Square(_) as t => f(t)",
      "        Dot => 0.0",
    ));
  });

  test("under an `as`, which each arm keeps", () => {
    expect(rewritten(program(
      "export let g(s: Shape): Float =",
      "    match s",
      "        Circle(_) | Square(_) as t ‸=> f(t)",
      "        Dot => 0.0",
    ), SPLIT_TITLE)).toBe(program(
      "export let g(s: Shape): Float =",
      "    match s",
      "        Circle(_) as t => f(t)",
      "        Square(_) as t => f(t)",
      "        Dot => 0.0",
    ));
    expect(rewritten(program(
      "export let g(s: Shape): Float =",
      "    match s",
      "        (Circle(_) as u) | (Square(_) as u) as t ‸=> f(t)",
      "        Dot => 0.0",
    ), SPLIT_TITLE)).toBe(program(
      "export let g(s: Shape): Float =",
      "    match s",
      "        (Circle(_) as u) as t => f(t)",
      "        (Square(_) as u) as t => f(t)",
      "        Dot => 0.0",
    ));
  });

  test("with a body over lines and its comments, copied into every arm", () => {
    expect(rewritten(program(
      "export let g(s: Shape): Float =",
      "    match s",
      "        Circle(x) | Square(x) (* either *) ‸=>",
      "            let y = x // the size",
      "            y",
      "        Dot => 0.0",
    ), SPLIT_TITLE)).toBe(program(
      "export let g(s: Shape): Float =",
      "    match s",
      "        Circle(x) (* either *) =>",
      "            let y = x // the size",
      "            y",
      "        Square(x) (* either *) =>",
      "            let y = x // the size",
      "            y",
      "        Dot => 0.0",
    ));
  });

  test("with a comment after the body, copied into every arm", () => {
    expect(rewritten(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) | Square(_) ‸=> 0 // round or square",
      "        Dot => 1",
    ), SPLIT_TITLE)).toBe(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) => 0 // round or square",
      "        Square(_) => 0 // round or square",
      "        Dot => 1",
    ));
  });

  test("and combined again, which undoes it", () => {
    const split = program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) => 0",
      "        Square(_) => 0",
      "        Dot => 1",
    );
    const combined = rewritten(split.replace("Circle(_) =>", "Circle(_) ‸=>"), combineTitle(2));
    expect(rewritten(combined.replace("Square(_) =>", "Square(_) ‸=>"), SPLIT_TITLE)).toBe(split);
  });

  test("beside a combine, where its neighbour shares its body", () => {
    expect(titles(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) | Square(_) ‸=> 0",
      "        Dot => 0",
    ))).toEqual([combineTitle(2), SPLIT_TITLE]);
  });
});

describe("an arm split, refused or not offered", () => {
  test("a guarded arm, refused", () => {
    expect(rewritten(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(x) | Square(x) when x > 1.0 ‸=> 0",
      "        _ => 1",
    ), SPLIT_TITLE)).toBe(GUARDED);
  });

  test("a comment between alternatives, refused", () => {
    expect(rewritten(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) | (* or *) Square(_) ‸=> 0",
      "        Dot => 1",
    ), SPLIT_TITLE)).toBe("refused: A comment inside it would be lost. Move the comment out first.");
  });

  test("an arm that does not start its line, not offered", () => {
    expect(titles(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Dot => 1; Circle(_) | Square(_) ‸=> 0",
    ))).toEqual([]);
  });

  test("an or-pattern inside a pattern, or none at all, not offered", () => {
    expect(titles(program(
      "export let g(o: Option(Int)): Int =",
      "    match o",
      "        Some(0 | 1) ‸=> 0",
      "        _ => 1",
    ))).toEqual([]);
  });
});

describe("the rewrites", () => {
  test("are offered only when the dev asks, as refactorings, never preferred", () => {
    const { text, start } = marked(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) | Square(_) ‸=> 0",
      "        Dot => 0",
    ));
    const opened = session(text);
    expect(opened.codeActions("/main.hex", { start, end: start }).map(({ title }) => title)).toEqual([]);
    expect(opened.codeActions("/main.hex", { start, end: start }, { invoked: true })
      .filter(({ title }) => title.startsWith("Combine") || title.startsWith("Split"))
      .map(({ title, kind, preferred }) => ({ title, kind, preferred })))
      .toEqual([
        { title: combineTitle(2), kind: "refactor", preferred: undefined },
        { title: SPLIT_TITLE, kind: "refactor", preferred: undefined },
      ]);
  });
});

describe("the check of what an edit leaves", () => {
  const arms = (text: string) => {
    const file = new Source.File(1 as Source.FileId, "/main.hex", text);
    const [module] = parseFile(applyLayout(lex(file)), file.path);
    const match = matchedBody((module!.items.at(-1) as Parsed.LetItem).value as Parsed.LambdaExpr)!;
    const edit = (replacement: string) => ({
      start: match.arms[0]!.span.start.offset,
      end: match.arms[1]!.span.end.offset,
      replacement,
    });
    return { file, module: module!, arms: match.arms, edit };
  };

  test("takes the arms combined in their order, and no other text", () => {
    const { file, module, arms: list, edit } = arms(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) => 0",
      "        Square(_) => 0",
      "        Dot => 1",
    ));
    const reads = readsCombined(file, module, list, [0, 1], []);
    expect(reads(edit("Circle(_) | Square(_) => 0"))).toBe(true);
    expect(reads(edit("Square(_) | Circle(_) => 0"))).toBe(false);
    expect(reads(edit("Circle(_) | Square(_) => 1"))).toBe(false);
  });

  test("takes the arm split in its order, and no other text", () => {
    const { file, module, arms: list, edit } = arms(program(
      "export let g(s: Shape): Int =",
      "    match s",
      "        Circle(_) | Square(_) => 0",
      "        Dot => 1",
    ));
    const reads = readsSplit(file, module, list, 0, list[0]!.body.span);
    const at = (replacement: string) => ({ ...edit(replacement), end: list[0]!.span.end.offset });
    expect(reads(at("Circle(_) => 0\n        Square(_) => 0"))).toBe(true);
    expect(reads(at("Square(_) => 0\n        Circle(_) => 0"))).toBe(false);
    expect(reads(at("Circle(_) => 0\n        Square(_) => 1"))).toBe(false);
  });
});
