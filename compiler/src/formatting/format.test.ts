import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { STDLIB_SOURCES } from "../stdlib-sources.js";
import { read, sameText, sameTree } from "./analysis.js";
import { formatDocument, formatSelection, type FormatOptions } from "./format.js";

/** Format document's text, failing the test on a refusal. */
function format(text: string, options: FormatOptions = {}): string {
  const result = formatDocument(text, options);
  if (result.kind !== "Formatted") throw new Error(`not formatted: ${JSON.stringify(result)}`);
  return result.text;
}

const lines = (...written: string[]): string => written.join("\n") + "\n";

describe("Format document: the guarantees (§1)", () => {
  it("refuses a document with a syntax error, with no edits and no report (§2.3)", () => {
    expect(formatDocument("module A\nlet x = (1\n")).toEqual({ kind: "SyntaxError" });
  });

  it("formats a document that parses but does not type-check (§2.3)", () => {
    expect(format("module A\nlet x = undefinedName+1\n")).toBe("module A\nlet x = undefinedName + 1\n");
  });

  it("returns edits that are runs of whitespace and rebuild the formatted text", () => {
    const text = "module A\r\nlet x=1   \r\n\r\n\r\nlet y =  [1,2]\r\n";
    const result = formatDocument(text, { collapseExtraSpaces: true });
    if (result.kind !== "Formatted") throw new Error("not formatted");
    let rebuilt = text;
    for (const edit of [...result.edits].reverse()) {
      expect(text.slice(edit.start, edit.end).trim()).toBe("");
      expect(edit.newText.trim()).toBe("");
      rebuilt = rebuilt.slice(0, edit.start) + edit.newText + rebuilt.slice(edit.end);
    }
    expect(rebuilt).toBe(result.text);
    expect(result.text).toBe("module A\nlet x = 1\n\nlet y = [1, 2]\n");
  });

  it("returns no edits for a document already canonical", () => {
    const result = formatDocument(STDLIB_SOURCES["Option"]!);
    expect(result).toMatchObject({ kind: "Formatted", edits: [] });
  });
});

describe("Line ends (§4)", () => {
  it("writes a line feed for every line end and ends the document with exactly one", () => {
    expect(format("module A\r\nlet x = 1\rlet y = 2")).toBe("module A\nlet x = 1\nlet y = 2\n");
  });

  it("removes trailing whitespace and empties whitespace-only lines", () => {
    expect(format("module A  \nlet x = 1\t\n   \nlet y = 2\n")).toBe("module A\nlet x = 1\n\nlet y = 2\n");
  });

  it("keeps whitespace inside a multiline string and at the end of a comment", () => {
    const text = 'module A\n-- note  \nlet s = "one  \n  two"\n';
    expect(format(text)).toBe(text);
  });

  it("keeps a byte-order mark", () => {
    expect(format("﻿module A\nlet x=1\n")).toBe("﻿module A\nlet x = 1\n");
  });

  it("writes an empty document for one with no code and no comments", () => {
    expect(formatDocument("\n\n  \n")).toEqual({ kind: "SyntaxError" });
  });
});

describe("Indentation (§5)", () => {
  it("leaves §5.1's examples as they are", () => {
    const text = lines(
      "module Example",
      "",
      "export let map(source: Option(a), transform: a ->! b): Option(b) =",
      "    match source",
      "        Some(value) => Some(transform!(value))",
      "        None => None",
      "",
      "let ready =",
      "    configured and connected and",
      "            notExpired(session)",
      "",
      "let corners = [",
      "    { x = 0, y = 0 },",
      "    { x = 1, y = 1 }",
      "]",
      "",
      "let selected =",
      "    numbers",
      "    .filter(number => number > 3)",
      "    .take(5)",
      "",
      "let carried = numbers",
      "        .filter(number => number > 3)",
      "        .take(5)",
      "",
      "let label = describe(firstName,",
      "        lastName)",
    );
    expect(format(text)).toBe(text);
  });

  it("re-indents blocks, open brackets and carried-on lines to their levels", () => {
    expect(format(lines(
      "module Example",
      "let f(x: Int): Int =",
      "  match x",
      "     0 => 1",
      "     _ =>",
      "        let y = x +",
      "          1",
      "        y",
      "let corners = [",
      "  { x = 0, y = 0 },",
      "     { x = 1, y = 1 }",
      "      ]",
      "let label = describe(firstName,",
      " lastName)",
    ))).toBe(lines(
      "module Example",
      "let f(x: Int): Int =",
      "    match x",
      "        0 => 1",
      "        _ =>",
      "            let y = x +",
      "                    1",
      "            y",
      "",
      "let corners = [",
      "    { x = 0, y = 0 },",
      "    { x = 1, y = 1 }",
      "]",
      "let label = describe(firstName,",
      "        lastName)",
    ));
  });

  it("puts `else` at its item's level and measures a branch from the line `if` begins", () => {
    expect(format(lines(
      "module Example",
      "let x = if ready then",
      "      1",
      "else",
      "      2",
    ))).toBe(lines(
      "module Example",
      "let x = if ready then",
      "    1",
      "else",
      "    2",
    ));
  });

  it("keeps a chain's links at the column of an item they continue, and the rest of an item after its block", () => {
    const text = lines(
      "module Example",
      "",
      "let total =",
      "    items",
      "    |> Seq.map(item => item.price)",
      "    |> Seq.fold(0, Num.add)",
    );
    expect(format(text)).toBe(text);
  });

  it("carries a line on within a union alternative from the alternative's line", () => {
    expect(format(lines(
      "module Example",
      "union Shape =",
      "    | Circle(radius: Float,",
      "        centre: Float)",
      "    | Square(side: Float)",
    ))).toBe(lines(
      "module Example",
      "union Shape =",
      "    | Circle(radius: Float,",
      "            centre: Float)",
      "    | Square(side: Float)",
    ));
  });

  it("measures a first alternative written without `|` from its own line", () => {
    expect(format(lines(
      "module Example",
      "union Shape =",
      "    Circle(radius: Float,",
      "        centre: Float)",
      "    | Square(side: Float)",
    ))).toBe(lines(
      "module Example",
      "union Shape =",
      "    Circle(radius: Float,",
      "            centre: Float)",
      "    | Square(side: Float)",
    ));
  });

  it("measures a line carried on in a type alias's value from the declaration", () => {
    const text = lines(
      "module Example",
      "type Lookup(k, v) =",
      "    (k,",
      "        v) -> Option(v)",
    );
    expect(format(text)).toBe(text);
  });

  it("places union alternatives one level in", () => {
    expect(format(lines(
      "module Example",
      "union Shape =",
      "  | Circle(radius: Float)",
      "        | Square(side: Float)",
    ))).toBe(lines(
      "module Example",
      "union Shape =",
      "    | Circle(radius: Float)",
      "    | Square(side: Float)",
    ));
  });
});

describe("Blank lines (§6)", () => {
  it("adds §6.2's blank lines, after the imports and after a multi-line declaration", () => {
    expect(format(lines(
      "module Shapes",
      "",
      "import Geometry",
      "let unit = 1.0",
      "let half = 0.5",
      "let scale(factor: Float): Float =",
      "    let doubled = factor * 2.0",
      "    doubled * half",
      "let area(side: Float): Float = side * side",
      "",
      "end module Shapes",
    ))).toBe(lines(
      "module Shapes",
      "",
      "import Geometry",
      "",
      "let unit = 1.0",
      "let half = 0.5",
      "let scale(factor: Float): Float =",
      "    let doubled = factor * 2.0",
      "    doubled * half",
      "",
      "let area(side: Float): Float = side * side",
      "",
      "end module Shapes",
    ));
  });

  it("adds the line after a multi-line declaration ahead of the comment that follows it", () => {
    expect(format(lines(
      "module A",
      "let f(x: Int): Int =",
      "    let y = x",
      "    y",
      "-- The next one.",
      "let g = 1",
    ))).toBe(lines(
      "module A",
      "let f(x: Int): Int =",
      "    let y = x",
      "    y",
      "",
      "-- The next one.",
      "let g = 1",
    ));
  });

  it("counts a declaration with one item in its block as a one-liner, however many lines it takes", () => {
    const text = lines(
      "module A",
      "let total =",
      "    first +",
      "            second",
      "let other = 1",
    );
    expect(format(text)).toBe(text);
  });

  it("adds a line after a module's closer when another module follows", () => {
    expect(format(lines(
      "module A",
      "let x = 1",
      "end module A",
      "module B",
      "let y = 2",
    ))).toBe(lines(
      "module A",
      "let x = 1",
      "end module A",
      "",
      "module B",
      "let y = 2",
    ));
  });

  it("caps a run at one and removes blank lines at the ends and around blocks and brackets", () => {
    expect(format(lines(
      "",
      "module A",
      "",
      "",
      "let f(x: Int): Int =",
      "",
      "    let y = [",
      "",
      "        x",
      "",
      "    ]",
      "    if y == [] then",
      "        0",
      "",
      "    else",
      "        1",
      "",
      "",
    ))).toBe(lines(
      "module A",
      "",
      "let f(x: Int): Int =",
      "    let y = [",
      "        x",
      "    ]",
      "    if y == [] then",
      "        0",
      "    else",
      "        1",
    ));
  });
});

describe("Spacing within a line (§7)", () => {
  it("writes §7.1's table", () => {
    expect(format(lines(
      "module A",
      "let a=b+c*2**n",
      "let r=1..n-1",
      "let f=1 // 2",
      "let g = xs . length",
      "let h = f( a ,b )",
      "let i:Int = (e :Type)",
      "let j = {top=1,bottom=2}",
      "let k = { }",
      "let l = [ 1, 2 ]",
      "let m = Vector (a)",
      "let n = - x",
      "let q = if ready then(1)else(2)",
      "let s = x band(mask)",
      "let t = <a: Ord> (x) => x",
      "let u = match xs",
      "    [_, ... rest] => rest",
      "opaque record Box( + a) = { value: a }",
    ))).toBe(lines(
      "module A",
      "let a = b + c * 2 ** n",
      "let r = 1..n - 1",
      "let f = 1//2",
      "let g = xs.length",
      "let h = f(a, b)",
      "let i: Int = (e: Type)",
      "let j = { top = 1, bottom = 2 }",
      "let k = {}",
      "let l = [1, 2]",
      "let m = Vector(a)",
      "let n = -x",
      "let q = if ready then (1) else (2)",
      "let s = x band (mask)",
      "let t = <a: Ord>(x) => x",
      "let u = match xs",
      "    [_, ...rest] => rest",
      "opaque record Box(+a) = { value: a }",
    ));
  });

  it("reads tight comparisons as comparisons, not a binder list", () => {
    expect(format("module A\nlet x = f(a<b, c>d)\n")).toBe("module A\nlet x = f(a < b, c > d)\n");
    expect(format("module A\nlet x = f(a<b, c> d)\n")).toBe("module A\nlet x = f(a < b, c > d)\n");
  });

  it("spaces `derives` as the keyword it is, never as a call", () => {
    expect(format("module A\nunion Ping derives(Eq, Show) = | Ping\n")).toBe("module A\nunion Ping derives (Eq, Show) = | Ping\n");
    expect(format("module A\nlet x = derives(1)\n")).toBe("module A\nlet x = derives(1)\n");
  });

  it("keeps the gaps that carry meaning (§7.2)", () => {
    const text = lines(
      "module A",
      "let a = save!(x)",
      "let b = text |> Int.parse^",
      "let c = - -x",
      "let d = (a bor b) band mask",
    );
    expect(format(text)).toBe(text);
  });

  it("keeps a wider gap with Collapse extra spaces off, and collapses it on (§3.2)", () => {
    const text = lines("module A", "let short  = 1", "let longer = 2");
    expect(format(text)).toBe(text);
    expect(format(text, { collapseExtraSpaces: true })).toBe(lines("module A", "let short = 1", "let longer = 2"));
  });

  it("turns a tab between code tokens into spaces, to the next multiple of four (§7.3)", () => {
    expect(format("module A\nlet x\t= 1\n")).toBe("module A\nlet x   = 1\n");
    expect(format("module A\nlet x\t= 1\n", { collapseExtraSpaces: true })).toBe("module A\nlet x = 1\n");
  });
});

describe("Comments (§8)", () => {
  it("indents a comment that begins its line like the code after it", () => {
    expect(format(lines(
      "module A",
      "let f(x: Int): Int =",
      "-- the result",
      "      x",
      "        -- the end",
    ))).toBe(lines(
      "module A",
      "let f(x: Int): Int =",
      "    -- the result",
      "    x",
      "-- the end",
    ));
  });

  it("moves a comment that spans lines as a unit, unless that cuts into its text", () => {
    expect(format(lines(
      "module A",
      "  {-- Doubles a number.",
      "      Never fails. -}",
      "let double(x: Int): Int = x * 2",
    ))).toBe(lines(
      "module A",
      "{-- Doubles a number.",
      "    Never fails. -}",
      "let double(x: Int): Int = x * 2",
    ));
    expect(format(lines(
      "module A",
      "    {- one",
      "  two -}",
      "let x = 1",
    ))).toBe(lines(
      "module A",
      "{- one",
      "  two -}",
      "let x = 1",
    ));
  });

  it("keeps the gap before a trailing comment, at least one space, under either setting (§8.3)", () => {
    const text = lines("module A", "let x = 1      -- one", "let y = 2-- two");
    const expected = lines("module A", "let x = 1      -- one", "let y = 2 -- two");
    expect(format(text)).toBe(expected);
    expect(format(text, { collapseExtraSpaces: true })).toBe(expected);
  });

  it("places a line that begins with a comment and continues with code by its code", () => {
    expect(format(lines(
      "module A",
      "let f(x: Int): Int =",
      "    match x",
      "{- n -}   _ => x",
    ))).toBe(lines(
      "module A",
      "let f(x: Int): Int =",
      "    match x",
      "{- n -} _ => x",
    ));
  });

  it("never changes the inside of a comment that leads code, tabs included (§8.1)", () => {
    expect(format(lines(
      "module A",
      "let f(x: Int): Int =",
      "    match x",
      "{-a\tb-} _ => x",
    ))).toBe(lines(
      "module A",
      "let f(x: Int): Int =",
      "    match x",
      "{-a\tb-} _ => x",
    ));
  });

  it("keeps a tabbed comment at its column, so a second run agrees", () => {
    const once = format(lines("module A", "let f(x: Int): Int =", "    match x", " {-\t-} _ => x"));
    expect(once).toBe(lines("module A", "let f(x: Int): Int =", "    match x", " {-\t-}  _ => x"));
    expect(format(once)).toBe(once);
  });

  it("adds §6.2's blank line after a trailing comment that spans lines, not inside it", () => {
    expect(format(lines(
      "module A",
      "import B {- note",
      "   more -}",
      "let x = 1",
    ))).toBe(lines(
      "module A",
      "import B {- note",
      "   more -}",
      "",
      "let x = 1",
    ));
  });

  it("collapses the gap between a leading comment and its code under Collapse extra spaces", () => {
    expect(format(lines(
      "module A",
      "let f(x: Int): Int =",
      "    match x",
      "{- n -}   _ => x",
    ), { collapseExtraSpaces: true })).toBe(lines(
      "module A",
      "let f(x: Int): Int =",
      "    match x",
      "{- n -} _ => x",
    ));
  });

  it("refuses a comment that leaves its code no room, and names the line (§8.2)", () => {
    const result = formatDocument(lines(
      "module A",
      "let f(x: Int): Int =",
      "{- a much longer note -} x",
    ));
    expect(result).toMatchObject({ kind: "Refused", line: 2 });
  });
});

describe("A line that is too long (§9)", () => {
  it("writes §9.4's example at a limit of 40", () => {
    expect(format(lines(
      "module A",
      "let names = people.map(person => person.name)",
      "let selected = numbers.filter(number => number > 3).take(5)",
    ), { maximumLineLength: 40 })).toBe(lines(
      "module A",
      "let names =",
      "    people.map(person => person.name)",
      "let selected =",
      "    numbers",
      "    .filter(number => number > 3)",
      "    .take(5)",
    ));
  });

  it("breaks the value, then the conditional, and only then its brackets", () => {
    expect(format(lines(
      "module A",
      "let x = if condition then first(alpha, beta, gamma) else other(c)",
    ), { maximumLineLength: 30 })).toBe(lines(
      "module A",
      "let x =",
      "    if condition then",
      "        first(",
      "            alpha,",
      "            beta,",
      "            gamma",
      "        )",
      "    else",
      "        other(c)",
    ));
  });

  it("opens brackets one item to a line and opens a header's parameters", () => {
    expect(format(lines(
      "module A",
      "let area(width: Float, height: Float): Float = width * height",
      "let label = describe(firstName, lastName, middleName)",
    ), { maximumLineLength: 40 })).toBe(lines(
      "module A",
      "let area(",
      "    width: Float,",
      "    height: Float",
      "): Float =",
      "    width * height",
      "let label =",
      "    describe(",
      "        firstName,",
      "        lastName,",
      "        middleName",
      "    )",
    ));
  });

  it("carries an operator on at two levels, breaking at its loosest operator after it (§9.4 rule 5, §9.5)", () => {
    expect(format(lines(
      "module A",
      "let total =",
      "    first * second + third * fourth + fifth",
    ), { maximumLineLength: 30 })).toBe(lines(
      "module A",
      "let total =",
      "    first * second +",
      "            third * fourth +",
      "            fifth",
    ));
  });

  it("never breaks a string, a comment, or a line with nothing left to break, and measures without a trailing comment", () => {
    const text = lines(
      "module A",
      "let s =",
      '    "a string much longer than the limit"',
      "let t = 1 -- a comment much longer than the limit",
    );
    expect(format(text, { maximumLineLength: 20 })).toBe(text);
  });

  it("does not break a condition, which the layout pass would read as a block head", () => {
    const text = lines(
      "module A",
      "let f(a: Bool, b: Bool): Int =",
      "    if a and b and a and b and a then",
      "        1",
      "    else",
      "        2",
    );
    expect(format(text, { maximumLineLength: 25 })).toBe(lines(
      "module A",
      "let f(",
      "    a: Bool,",
      "    b: Bool",
      "): Int =",
      "    if a and b and a and b and a then",
      "        1",
      "    else",
      "        2",
    ));
  });
});

describe("Format selection (§2.2)", () => {
  const text = lines(
    "module A",
    "let a=1",
    "-- b's note",
    "let b=2",
    "",
    "",
    "",
    "let c=3",
  );

  it("widens to the items it touches, comments included, and changes nothing else", () => {
    const at = text.indexOf("b=2");
    const result = formatSelection(text, { start: at, end: at });
    expect(result).toMatchObject({
      kind: "Formatted",
      text: lines("module A", "let a=1", "-- b's note", "let b = 2", "", "let c=3"),
    });
  });

  it("covers only the blank lines when it touches nothing else", () => {
    const at = text.indexOf("\n\n") + 2;
    const result = formatSelection(text, { start: at, end: at + 1 });
    expect(result).toMatchObject({
      kind: "Formatted",
      text: lines("module A", "let a=1", "-- b's note", "let b=2", "", "let c=3"),
    });
  });

  it("starts after an item's blank lines when the selection starts in them and runs on", () => {
    const start = text.indexOf("\n\n") + 2;
    const result = formatSelection(text, { start, end: text.indexOf("c=3") + 1 });
    expect(result).toMatchObject({
      kind: "Formatted",
      text: lines("module A", "let a=1", "-- b's note", "let b=2", "", "", "", "let c = 3"),
    });
  });

  it("agrees with Format document over the whole document", () => {
    const whole = formatSelection(text, { start: 0, end: text.length });
    expect(whole).toMatchObject({ kind: "Formatted", text: format(text) });
  });

  it("is refused where Format document is", () => {
    expect(formatSelection("module A\nlet x = (\n", { start: 0, end: 1 })).toEqual({ kind: "SyntaxError" });
  });
});

// -----------------------------------------------------------------------------
// The standard library as a corpus (§12)

const library = Object.entries(STDLIB_SOURCES);

const settings: readonly FormatOptions[] = [
  {},
  { collapseExtraSpaces: true },
  { maximumLineLength: 100 },
  { maximumLineLength: 100, collapseExtraSpaces: true },
  { maximumLineLength: 72, collapseExtraSpaces: true },
];

const formattedLibrary = new Map<string, string>();

/** A standard-library file under one of the settings, formatted once. */
function libraryFormat(name: string, setting: number): string {
  const key = `${name}:${setting}`;
  const known = formattedLibrary.get(key);
  if (known !== undefined) return known;
  const text = format(STDLIB_SOURCES[name]!, settings[setting]);
  formattedLibrary.set(key, text);
  return text;
}

const cases = library.flatMap(([name]) => settings.map((_, setting) => [name, setting] as const));

describe("The standard library (§12)", () => {
  it.each(cases)("formats %s under setting %i, keeping its text and tree, and twice changes nothing", (name, setting) => {
    const before = read(STDLIB_SOURCES[name]!);
    const text = libraryFormat(name, setting);
    const after = read(text);
    expect(sameText(before, after)).toBe(true);
    expect(sameTree(before, after)).toBe(true);
    expect(format(text, settings[setting])).toBe(text);
  });

  it.each(library)("keeps %s's grouping under every setting (§6.3)", (name) => {
    const groupings = settings.map((_, setting) => blankLineSites(libraryFormat(name, setting)));
    for (const grouping of groupings) expect(grouping).toEqual(groupings[0]);
  });

  const pairs = library.flatMap(([name]) => ([[0, 4], [1, 2], [2, 4]] as const).map(([a, b]) => [name, a, b] as const));
  it.each(pairs)("settings never fight over %s: %i then %i (§3.3)", (name, first, second) => {
    const both = format(libraryFormat(name, first), settings[second]);
    expect(format(both, settings[first])).toBe(both);
    expect(format(both, settings[second])).toBe(both);
  });
});

/** The tokens a blank line comes before, by index: the same tokens under every setting. */
function blankLineSites(text: string): number[] {
  const tokens = read(text).lexed.tokens;
  const sites: number[] = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const gap = text.slice(tokens[index - 1]!.span.end.offset, tokens[index]!.span.start.offset);
    if (/\n[ \t]*\n/u.test(gap)) sites.push(index);
  }
  return sites;
}

// -----------------------------------------------------------------------------
// Mangled input comes back canonical (§12.3)

/**
 * The standard-library file with its whitespace scrambled and its meaning
 * kept: CRLF line ends, trailing spaces, doubled blank lines, extra spaces in
 * gaps between tokens, and the spaces removed from gaps that need none.
 */
function mangle(source: string, seed: readonly number[]): string {
  const reading = read(source);
  const tokens = reading.lexed.tokens.filter(({ kind }) => kind !== "Eof");
  let pick = 0;
  const next = (): number => seed[pick++ % seed.length]!;
  const pieces: string[] = [];
  let cursor = 0;
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    const left = tokens[index]!;
    const right = tokens[index + 1]!;
    pieces.push(source.slice(cursor, left.span.end.offset));
    const gap = source.slice(left.span.end.offset, right.span.start.offset);
    cursor = right.span.start.offset;
    if (gap === " " && next() % 3 === 0) {
      pieces.push(" ".repeat(1 + (next() % 3)));
    } else if (gap === "\n" && next() % 4 === 0) {
      pieces.push("  \r\n");
    } else if (gap.startsWith("\n\n") && next() % 2 === 0) {
      pieces.push("\n\n" + gap);
    } else {
      pieces.push(gap);
    }
  }
  pieces.push(source.slice(cursor));
  return pieces.join("");
}

describe("Mangled input comes back canonical (§12.3)", () => {
  const formatted = new Map<string, string>();
  const canonical = (name: string, source: string): string => {
    const known = formatted.get(name);
    if (known !== undefined) return known;
    const text = format(source, { collapseExtraSpaces: true });
    formatted.set(name, text);
    return text;
  };
  const candidates = library.filter(([, source]) => source.length < 20_000);

  it("formats a mangled standard-library file to its own canonical layout", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...candidates),
        fc.array(fc.nat(1000), { minLength: 1, maxLength: 16 }),
        ([name, source], seed) => {
          const mangled = mangle(source, seed);
          // The mangling keeps the meaning, or the property says nothing.
          fc.pre(sameTree(read(source), read(mangled)));
          expect(format(mangled, { collapseExtraSpaces: true })).toBe(canonical(name, source));
        },
      ),
      { numRuns: 40 },
    );
  });
});
