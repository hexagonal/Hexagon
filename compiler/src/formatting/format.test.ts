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
      "    match source with",
      "        Some(value) => Some(transform!(value))",
      "        None => None",
      "",
      "let ready =",
      "    configured and connected",
      "            and notExpired(session)",
      "",
      "let corners = [",
      "    { x = 0, y = 0 },",
      "    { x = 1, y = 1 },",
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

  it("leaves §5.3's example as it is", () => {
    const text = lines(
      "module Example",
      "",
      "export let clamp(reading: Option(Int),",
      "        limit: Int): Int =",
      "    match reading with",
      "        Some(n) when n > 0",
      "                and n < limit =>",
      "            n",
      "        _ => 0",
    );
    expect(format(text)).toBe(text);
  });

  it("re-indents blocks, open brackets and carried-on lines to their levels", () => {
    expect(format(lines(
      "module Example",
      "let f(x: Int): Int =",
      "  match x with",
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
      "    match x with",
      "        0 => 1",
      "        _ =>",
      "            let y = x +",
      "                    1",
      "            y",
      "",
      "let corners = [",
      "    { x = 0, y = 0 },",
      "    { x = 1, y = 1 },",
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
      "        x,",
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
      "let u = match xs with",
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
      "let u = match xs with",
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
    expect(format("module A\nunion Box(a)derives(Eq) = | Box(a)\n")).toBe("module A\nunion Box(a) derives (Eq) = | Box(a)\n");
    expect(format("module A\nlet y = x band derives(1)\n")).toBe("module A\nlet y = x band derives(1)\n");
    expect(format("module A\nlet a = f(x)\nderives(1)\n")).toBe("module A\nlet a = f(x)\nderives(1)\n");
    expect(format("module A\nlet f(x: Int): Int =\n    match x with\n        (k)derives => k\n")).toBe(
      "module A\nlet f(x: Int): Int =\n    match x with\n        (k)derives => k\n");
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

describe("Inside a string (§7.4)", () => {
  it("spaces the code in a hole as code is spaced anywhere, and leaves the string's text alone", () => {
    expect(format(lines(
      "module A",
      'let a = "Does 10/12 = 5/6? ${10 // 12 == 5 // 6}"',
      'let b = "${ count+1 } of ${f( a ,b )}"',
      'let c = "two  spaces ${x}  stay\tas written"',
    ))).toBe(lines(
      "module A",
      'let a = "Does 10/12 = 5/6? ${10//12 == 5//6}"',
      'let b = "${count + 1} of ${f(a, b)}"',
      'let c = "two  spaces ${x}  stay\tas written"',
    ));
  });

  it("keeps a wider gap in a hole with Collapse extra spaces off, collapses it on, and turns a tab into spaces (§7.3)", () => {
    const text = lines("module A", 'let d = "${a  +  b}"');
    expect(format(text)).toBe(text);
    expect(format(text, { collapseExtraSpaces: true })).toBe(lines("module A", 'let d = "${a + b}"'));
    expect(format('module A\nlet t = "${a\t+ b}"\n')).toBe('module A\nlet t = "${a    + b}"\n');
    expect(format('module A\nlet t = "${a\t+ b}"\n', { collapseExtraSpaces: true })).toBe('module A\nlet t = "${a + b}"\n');
  });

  it("writes a hole's braces tight, and a record's inside it spaced", () => {
    expect(format(lines(
      "module A",
      'let r = "${ {x=1}.x }"',
      'let n = "${ -x } ${-x} ${- -x}"',
    ), { collapseExtraSpaces: true })).toBe(lines(
      "module A",
      'let r = "${{ x = 1 }.x}"',
      'let n = "${-x} ${-x} ${- -x}"',
    ));
  });

  it("spaces a string inside a hole, at any depth", () => {
    expect(format('module A\nlet c = "nested ${g( "in  ${ y*2 }" )}"\n')).toBe(
      'module A\nlet c = "nested ${g("in  ${y * 2}")}"\n');
  });

  it("keeps the lines of a hole written over several as they are, and adds no comma there", () => {
    expect(format(lines(
      "module A",
      'let e = "multi ${',
      "    a+  ",
      '      b } end"',
      'let f = "${f([',
      "    1,",
      "    2",
      '])}"',
    ))).toBe(lines(
      "module A",
      'let e = "multi ${',
      "    a +  ",
      '      b} end"',
      'let f = "${f([',
      "    1,",
      "    2",
      '])}"',
    ));
  });

  it("keeps a comment inside a hole and its gaps, with at least one space before one that ends its line", () => {
    const text = lines("module A", 'let g = "${x {- note -}  + 1}"');
    expect(format(text, { collapseExtraSpaces: true })).toBe(text);
    expect(format('module A\nlet h = "${x-- note\n}"\n')).toBe('module A\nlet h = "${x -- note\n}"\n');
  });

  it("checks each string's text as written, not only its value (§1)", () => {
    const spelled = read('module A\nlet s = "\\u{41} ${x}"\n');
    expect(sameText(spelled, read('module A\nlet s = "\\u{41} ${x}"\n'))).toBe(true);
    expect(sameText(spelled, read('module A\nlet s = "A ${x}"\n'))).toBe(false);
    expect(sameText(spelled, read('module A\nlet s = "\\u{41} ${ x }"\n'))).toBe(true);
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
      "    match x with",
      "{- n -}   _ => x",
    ))).toBe(lines(
      "module A",
      "let f(x: Int): Int =",
      "    match x with",
      "{- n -} _ => x",
    ));
  });

  it("never changes the inside of a comment that leads code, tabs included (§8.1)", () => {
    expect(format(lines(
      "module A",
      "let f(x: Int): Int =",
      "    match x with",
      "{-a\tb-} _ => x",
    ))).toBe(lines(
      "module A",
      "let f(x: Int): Int =",
      "    match x with",
      "{-a\tb-} _ => x",
    ));
  });

  it("keeps a tabbed comment at its column, so a second run agrees", () => {
    const once = format(lines("module A", "let f(x: Int): Int =", "    match x with", " {-\t-} _ => x"));
    expect(once).toBe(lines("module A", "let f(x: Int): Int =", "    match x with", " {-\t-}  _ => x"));
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
      "    match x with",
      "{- n -}   _ => x",
    ), { collapseExtraSpaces: true })).toBe(lines(
      "module A",
      "let f(x: Int): Int =",
      "    match x with",
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
      "            gamma,",
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
      "    height: Float,",
      "): Float =",
      "    width * height",
      "let label =",
      "    describe(",
      "        firstName,",
      "        lastName,",
      "        middleName,",
      "    )",
    ));
  });

  it("carries an operator on at two levels, the carried-on line beginning with its loosest operator (§9.4 rule 5, §9.5)", () => {
    expect(format(lines(
      "module A",
      "let total =",
      "    first * second + third * fourth + fifth",
    ), { maximumLineLength: 30 })).toBe(lines(
      "module A",
      "let total =",
      "    first * second",
      "            + third * fourth",
      "            + fifth",
    ));
  });

  it("begins a carried-on line with `-` or `band` and keeps what the program means", () => {
    expect(format(lines(
      "module A",
      "let total =",
      "    alpha - beta - gamma - delta",
      "let masked =",
      "    alpha band beta band gamma",
    ), { maximumLineLength: 20 })).toBe(lines(
      "module A",
      "let total =",
      "    alpha",
      "            - beta",
      "            - gamma",
      "            - delta",
      "let masked =",
      "    alpha",
      "            band beta",
      "            band gamma",
    ));
  });

  it("never leaves an operator alone on a line when the author ended a long line with it", () => {
    expect(format(lines(
      "module A",
      "let total =",
      "    alpha + beta + gamma + delta +",
      "            epsilon",
    ), { maximumLineLength: 20 })).toBe(lines(
      "module A",
      "let total =",
      "    alpha",
      "            + beta",
      "            + gamma",
      "            + delta +",
      "            epsilon",
    ));
  });

  it("leaves an operator the author put at the end of a line where it is", () => {
    const text = lines(
      "module A",
      "let total =",
      "    first * second +",
      "            third * fourth",
    );
    expect(format(text, { maximumLineLength: 30 })).toBe(text);
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

  it("moves a value's clauses beneath its `=` with it, and leaves a lambda's owner's clauses", () => {
    expect(format(lines(
      "module A",
      "let f(c: Bool): Int =",
      "    let x = if c then firstValue(alpha, beta)",
      "    else 2",
      "    x",
    ), { maximumLineLength: 40 })).toBe(lines(
      "module A",
      "let f(c: Bool): Int =",
      "    let x =",
      "        if c then",
      "            firstValue(alpha, beta)",
      "        else 2",
      "    x",
    ));
  });

  it("breaks a head only once nothing else on its line is left, and ends it with its closing word (§9.4 rule 7)", () => {
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
      "    b: Bool,",
      "): Int =",
      "    if a",
      "            and b",
      "            and a",
      "            and b",
      "            and a then",
      "        1",
      "    else",
      "        2",
    ));
  });

  it("breaks a conditional with another in its branch before any head", () => {
    expect(format(lines(
      "module A",
      "let f(a: Bool, b: Bool): Int =",
      "    if a and b then if a then 1 else 2 else 3",
    ), { maximumLineLength: 30 })).toBe(lines(
      "module A",
      "let f(a: Bool, b: Bool): Int =",
      "    if a and b then",
      "        if a then 1 else 2",
      "    else",
      "        3",
    ));
  });

  it("opens a `for` head's source, not its pattern, and an `else if` head's condition", () => {
    expect(format(lines(
      "module A",
      "let f(totals: Vector((String, Int))): Unit =",
      "    for (name, total) in someSource(argumentOne, argumentTwo) do",
      "        print(name)",
    ), { maximumLineLength: 50 })).toBe(lines(
      "module A",
      "let f(totals: Vector((String, Int))): Unit =",
      "    for (name, total) in someSource(",
      "        argumentOne,",
      "        argumentTwo,",
      "    ) do",
      "        print(name)",
    ));
    expect(format(lines(
      "module A",
      "let f(a: Int): Int =",
      "    if a > 1 then",
      "        1",
      "    else if a > 100 and a < 200 and a != 150 then",
      "        2",
      "    else",
      "        3",
    ), { maximumLineLength: 40 })).toBe(lines(
      "module A",
      "let f(a: Int): Int =",
      "    if a > 1 then",
      "        1",
      "    else if a > 100",
      "            and a < 200",
      "            and a != 150 then",
      "        2",
      "    else",
      "        3",
    ));
  });

  it("puts a branch after an assignment beneath `then` before opening its brackets", () => {
    expect(format(lines(
      "module A",
      "let f(c: Bool): Unit =",
      "    var x = 0",
      "    if c then x := compute(alpha, beta)",
    ), { maximumLineLength: 36 })).toBe(lines(
      "module A",
      "let f(c: Bool): Unit =",
      "    var x = 0",
      "    if c then",
      "        x := compute(alpha, beta)",
    ));
  });

  it("moves a loop body's continuation lines with it beneath `do`", () => {
    expect(format(lines(
      "module A",
      "let f(items: Vector(Int)): Unit =",
      "    for item in items do register(item, x =>",
      "        handle(x))",
    ), { maximumLineLength: 40 })).toBe(lines(
      "module A",
      "let f(items: Vector(Int)): Unit =",
      "    for item in items do",
      "        register(item, x =>",
      "            handle(x))",
    ));
  });

  it("writes §9.4's head example at a limit of 40", () => {
    expect(format(lines(
      "module A",
      "let run(job: Job): Unit =",
      "    var remaining = 10",
      "    while remaining > 0 and not cancelled(job) do",
      "        remaining := step(remaining)",
    ), { maximumLineLength: 40 })).toBe(lines(
      "module A",
      "let run(job: Job): Unit =",
      "    var remaining = 10",
      "    while remaining > 0",
      "            and not cancelled(job) do",
      "        remaining := step(remaining)",
    ));
  });

  it("puts a loop's body beneath its `do` before it breaks the head (§9.4 rule 6)", () => {
    expect(format(lines(
      "module A",
      "let run(items: Vector(Int)): Unit =",
      "    for item in items do print(describe(item))",
    ), { maximumLineLength: 30 })).toBe(lines(
      "module A",
      "let run(",
      "    items: Vector(Int),",
      "): Unit =",
      "    for item in items do",
      "        print(describe(item))",
    ));
  });

  it("opens a `match` head's brackets and keeps its `with` at the end", () => {
    expect(format(lines(
      "module A",
      "let pick(a: Int, b: Int): Int =",
      "    match compare(firstArgument, secondArgument) with",
      "        _ => 0",
    ), { maximumLineLength: 40 })).toBe(lines(
      "module A",
      "let pick(a: Int, b: Int): Int =",
      "    match compare(",
      "        firstArgument,",
      "        secondArgument,",
      "    ) with",
      "        _ => 0",
    ));
  });
});

describe("The shapes brackets break in (§9.4 rule 2)", () => {
  it("writes §9.4's bracket example at a limit of 50", () => {
    expect(format(lines(
      "module A",
      'let codes = Map.fromVector([("en", "English"), ("fr", "French"), ("de", "German"), ("es", "Spanish")])',
      "let total = Vector.fold(values, 0, (sum, value) => sum + value * weight)",
    ), { maximumLineLength: 50 })).toBe(lines(
      "module A",
      "let codes =",
      "    Map.fromVector([",
      '        ("en", "English"), ("fr", "French"),',
      '        ("de", "German"), ("es", "Spanish"),',
      "    ])",
      "let total =",
      "    Vector.fold(values, 0, (sum, value) =>",
      "        sum + value * weight",
      "    )",
    ));
  });

  it("opens brackets with their only item, a record or a tuple, and closes them together", () => {
    expect(format(lines(
      "module A",
      "let piece = Piece({ expr = Anchor(kind), kind = Asserted(point), start = position })",
      "let pair = Some((combine(leftValue, rightValue), zipWith(leftRest, rightRest)))",
    ), { maximumLineLength: 50 })).toBe(lines(
      "module A",
      "let piece =",
      "    Piece({",
      "        expr = Anchor(kind),",
      "        kind = Asserted(point),",
      "        start = position,",
      "    })",
      "let pair =",
      "    Some((",
      "        combine(leftValue, rightValue),",
      "        zipWith(leftRest, rightRest),",
      "    ))",
    ));
  });

  it("keeps a call's last-argument lambda's head on its line, and only the body moves", () => {
    expect(format(lines(
      "module A",
      "let total = fold(values, 0, (sum, value) => sum + value * weight)",
      "let k = callIt(alpha, beta, xs => xs.size + alpha)",
    ), { maximumLineLength: 40 })).toBe(lines(
      "module A",
      "let total =",
      "    fold(values, 0, (sum, value) =>",
      "        sum + value * weight",
      "    )",
      "let k =",
      "    callIt(alpha, beta, xs =>",
      "        xs.size + alpha",
      "    )",
    ));
  });

  it("opens the call one argument per line where the lambda's head does not fit, its body beside it if that fits", () => {
    expect(format(lines(
      "module A",
      "let longer = Vector.fold(someValues, initialValue, (sum, value) => sum + value)",
      "let longest = Vector.fold(someValues, initialValue, (sum, value) => compute(sum, value, weight))",
    ), { maximumLineLength: 40 })).toBe(lines(
      "module A",
      "let longer =",
      "    Vector.fold(",
      "        someValues,",
      "        initialValue,",
      "        (sum, value) => sum + value,",
      "    )",
      "let longest =",
      "    Vector.fold(",
      "        someValues,",
      "        initialValue,",
      "        (sum, value) =>",
      "            compute(sum, value, weight)",
      "    )",
    ));
  });

  it("opens the call before a lambda whose body is already beneath it, or a bare `match`, where the head line is too long", () => {
    expect(format(lines(
      "module A",
      "let g = computeTheThing(firstArgument, (x) =>",
      "    x + 1",
      ")",
      "let classify = items.map(firstArgument, match",
      "    Small => 1",
      "    Large => 2",
      ")",
    ), { maximumLineLength: 30 })).toBe(lines(
      "module A",
      "let g =",
      "    computeTheThing(",
      "        firstArgument,",
      "        (x) =>",
      "            x + 1",
      "    )",
      "let classify =",
      "    items.map(",
      "        firstArgument,",
      "        match",
      "            Small => 1",
      "            Large => 2",
      "    )",
    ));
  });

  it("moves a value and the closing bracket after it beneath its `=` together", () => {
    expect(format(lines(
      "module A",
      "let classify = itemsList.map(match",
      "    Small => 1",
      "    Large => 2",
      ")",
      "let g = computeTheThing(firstArgument, (x) =>",
      "    x + 1",
      ")",
    ), { maximumLineLength: 30 })).toBe(lines(
      "module A",
      "let classify =",
      "    itemsList.map(match",
      "        Small => 1",
      "        Large => 2",
      "    )",
      "",
      "let g =",
      "    computeTheThing(",
      "        firstArgument,",
      "        (x) =>",
      "            x + 1",
      "    )",
    ));
  });

  it("opens the brackets one item to a line where a trailing comma leaves no room to keep the lambda's head", () => {
    expect(format(lines(
      "module A",
      "let y = f(2, x => compute(x, x, x, x, x),)",
    ), { maximumLineLength: 20 })).toBe(lines(
      "module A",
      "let y =",
      "    f(",
      "        2,",
      "        x => compute(",
      "            x,",
      "            x,",
      "            x,",
      "            x,",
      "            x,",
      "        ),",
      "    )",
    ));
  });

  it("does not open brackets with an only item that is an expression in parentheses", () => {
    expect(format(lines(
      "module A",
      "let x = f((alpha + beta * gamma - delta))",
    ), { maximumLineLength: 30 })).toBe(lines(
      "module A",
      "let x =",
      "    f(",
      "        (",
      "            alpha",
      "                    + beta * gamma",
      "                    - delta",
      "        ),",
      "    )",
    ));
  });

  it("keeps a record's last-field lambda's head on its line, inside a call's brackets too", () => {
    expect(format(lines(
      "module A",
      "let r = { first = 1, pull = () => compute(alpha, beta, gamma) }",
      "let s = Seq({ pull = () => compute(alpha, beta, gamma) })",
      "let q = Seq({ first = alphabet, nextValueOf = () => compute(alpha) })",
    ), { maximumLineLength: 40 })).toBe(lines(
      "module A",
      "let r =",
      "    { first = 1, pull = () =>",
      "        compute(alpha, beta, gamma)",
      "    }",
      "let s =",
      "    Seq({ pull = () =>",
      "        compute(alpha, beta, gamma)",
      "    })",
      "let q =",
      "    Seq({",
      "        first = alphabet,",
      "        nextValueOf = () =>",
      "            compute(alpha)",
      "    })",
    ));
  });

  it("fills brackets of literals: numbers with or without `-`, strings, and tuples of those, mixed", () => {
    expect(format(lines(
      "module A",
      "let a = [-1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11]",
      'let b = ["one", "two", "three", "four", "five", "six"]',
      'let c = [1.5, 2, 3n, 4.25d, (1, "one"), (2, "two"), 3]',
      "let i = foo((1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13))",
    ), { maximumLineLength: 30 })).toBe(lines(
      "module A",
      "let a =",
      "    [",
      "        -1, -2, -3, -4, -5,",
      "        -6, -7, -8, -9, -10,",
      "        -11,",
      "    ]",
      "let b =",
      "    [",
      '        "one", "two", "three",',
      '        "four", "five", "six",',
      "    ]",
      "let c =",
      "    [",
      "        1.5, 2, 3n, 4.25d,",
      '        (1, "one"),',
      '        (2, "two"), 3,',
      "    ]",
      "let i =",
      "    foo((",
      "        1, 2, 3, 4, 5, 6, 7,",
      "        8, 9, 10, 11, 12, 13,",
      "    ))",
    ));
  });

  it("fills a line to exactly the limit", () => {
    expect(format(lines(
      "module A",
      "let a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 1]",
    ), { maximumLineLength: 38 })).toBe(lines(
      "module A",
      "let a =",
      "    [",
      "        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,",
      "        11, 12, 13, 1,",
      "    ]",
    ));
  });

  it("keeps the head only of a call's or a record's last lambda, not a tuple's or a vector's", () => {
    expect(format(lines(
      "module A",
      "let t = (alpha, beta, (x) => compute(x, alpha))",
      "let v = [alpha, beta, (x) => compute(x, alpha)]",
    ), { maximumLineLength: 40 })).toBe(lines(
      "module A",
      "let t =",
      "    (",
      "        alpha,",
      "        beta,",
      "        (x) => compute(x, alpha),",
      "    )",
      "let v =",
      "    [",
      "        alpha,",
      "        beta,",
      "        (x) => compute(x, alpha),",
      "    ]",
    ));
  });

  it("leaves the items of brackets that are carried on, not open, together", () => {
    const text = lines(
      "module A",
      "let label = describe(firstName,",
      "        lastName, middleName, otherName, more,",
      "        last)",
    );
    expect(format(text, { maximumLineLength: 40 })).toBe(text);
  });

  it("opens brackets whose closer is on a later line only for a last-argument lambda", () => {
    expect(format(lines(
      "module A",
      "let label = describeTheThing(firstName, lastName, middle,",
      "        other)",
    ), { maximumLineLength: 40 })).toBe(lines(
      "module A",
      "let label =",
      "    describeTheThing(firstName, lastName, middle,",
      "            other)",
    ));
  });

  it("puts one item to a line where any item is not a literal", () => {
    for (const [items, count] of [
      ['"one ${x}", "two", "three", "four", "five"', 5],
      ["Some(1), Some(2), Some(3), Some(4), Some(5)", 5],
      ["((1, 2), 3), ((4, 5), 6), ((7, 8), 9)", 3],
      ["(), (), (), (), (), (), (), (), (), (), ()", 11],
      ["one, two, three, four, five, six, seven", 7],
      ["-x, -2, -3, -4, -5, -6, -7, -8, -9, -10", 10],
      ["(1), (2), (3), (4), (5), (6), (7), (8)", 8],
    ] as const) {
      const formatted = format(lines("module A", `let c = [${items}]`), { maximumLineLength: 40 });
      // Besides `module A`, `let c =`, the two brackets and the last line end, a line for each item.
      expect([items, formatted.split("\n").length - 5]).toEqual([items, count]);
    }
  });

  it("breaks a line inside open brackets between its items first, filled where the brackets are", () => {
    expect(format(lines(
      "module A",
      "let primes =",
      "    Set.fromVector([",
      "        2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47,",
      "        53, 59",
      "    ])",
      "let rows =",
      "    Vector.from([",
      "        compute(alpha), compute(beta), compute(gamma), compute(delta),",
      "        tail",
      "    ])",
      "let tuples =",
      "    Vector.from([",
      '        ("en", "English"), ("fr", French), ("de", "German"),',
      "    ])",
    ), { maximumLineLength: 50 })).toBe(lines(
      "module A",
      "let primes =",
      "    Set.fromVector([",
      "        2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31,",
      "        37, 41, 43, 47,",
      "        53, 59,",
      "    ])",
      "let rows =",
      "    Vector.from([",
      "        compute(alpha),",
      "        compute(beta),",
      "        compute(gamma),",
      "        compute(delta),",
      "        tail,",
      "    ])",
      "let tuples =",
      "    Vector.from([",
      '        ("en", "English"),',
      '        ("fr", French),',
      '        ("de", "German"),',
      "    ])",
    ));
  });
});

describe("A binding whose value is a lambda (§9.4 rule 1)", () => {
  it("puts an arm's body beneath its `=>` even where the body is a lambda", () => {
    expect(format(lines(
      "module A",
      "let f(o: Option(Int)): Int =",
      "    match o with",
      "        Some(v) => (w) => compute(v, w, alpha, beta)",
      "        None => (w) => w",
    ), { maximumLineLength: 40 })).toBe(lines(
      "module A",
      "let f(o: Option(Int)): Int =",
      "    match o with",
      "        Some(v) =>",
      "            (w) =>",
      "                compute(",
      "                    v,",
      "                    w,",
      "                    alpha,",
      "                    beta,",
      "                )",
      "        None => (w) => w",
    ));
  });

  it("moves a lambda body's clauses beneath its `=>` with it", () => {
    expect(format(lines(
      "module A",
      "let f(b: Bool): Int =",
      "    let g = (c) => if c then computeTheFirst(alpha)",
      "    else 2",
      "    g(b)",
    ), { maximumLineLength: 40 })).toBe(lines(
      "module A",
      "let f(b: Bool): Int =",
      "    let g = (c) =>",
      "        if c then computeTheFirst(alpha)",
      "        else 2",
      "    g(b)",
    ));
  });

  it("keeps the lambda's head on the `=`'s line, and moves only the body", () => {
    expect(format(lines(
      "module A",
      "let f = (alpha, beta) => compute(alpha, beta, gamma, delta)",
      "let h = <a: Eq>(x: a): Bool => compute(x, alpha, beta, gamma)",
    ), { maximumLineLength: 40 })).toBe(lines(
      "module A",
      "let f = (alpha, beta) =>",
      "    compute(alpha, beta, gamma, delta)",
      "let h = <a: Eq>(x: a): Bool =>",
      "    compute(x, alpha, beta, gamma)",
    ));
  });

  it("moves the value beneath the `=` where the head does not fit, and the body beneath `=>` only if it must", () => {
    expect(format(lines(
      "module A",
      "let g = (alphaParameter, betaParameter) => compute(alphaParameter)",
      "let k = (alphaParameter, betaParamete) => x",
    ), { maximumLineLength: 40 })).toBe(lines(
      "module A",
      "let g =",
      "    (alphaParameter, betaParameter) =>",
      "        compute(alphaParameter)",
      "let k =",
      "    (alphaParameter, betaParamete) => x",
    ));
  });
});

describe("An assignment laid out as a binding (§9.4 rule 1)", () => {
  it("puts a value too long for its line beneath the `:=` before opening its brackets", () => {
    expect(format(lines(
      "module A",
      "let f(): Int =",
      "    var total = 0",
      "    total := compute(alpha, beta, gamma)",
      "    total",
    ), { maximumLineLength: 36 })).toBe(lines(
      "module A",
      "let f(): Int =",
      "    var total = 0",
      "    total :=",
      "        compute(alpha, beta, gamma)",
      "    total",
    ));
  });

  it("breaks the value, then the conditional, and only then its brackets", () => {
    expect(format(lines(
      "module A",
      "let f(condition: Bool): Unit =",
      "    var x = 0",
      "    x := if condition then first(alpha, beta, gamma) else other(c)",
    ), { maximumLineLength: 34 })).toBe(lines(
      "module A",
      "let f(condition: Bool): Unit =",
      "    var x = 0",
      "    x :=",
      "        if condition then",
      "            first(",
      "                alpha,",
      "                beta,",
      "                gamma,",
      "            )",
      "        else",
      "            other(c)",
    ));
  });

  it("keeps a lambda's head on the `:=`'s line, and moves only the body", () => {
    expect(format(lines(
      "module A",
      "let f(): Unit =",
      "    var g = (x) => x",
      "    g := (alpha, beta) => compute(alpha, beta, gamma)",
    ), { maximumLineLength: 40 })).toBe(lines(
      "module A",
      "let f(): Unit =",
      "    var g = (x) => x",
      "    g := (alpha, beta) =>",
      "        compute(alpha, beta, gamma)",
    ));
  });

  it("puts a branch's assignment beneath `then`, and then its value beneath `:=`", () => {
    expect(format(lines(
      "module A",
      "let f(c: Bool): Unit =",
      "    var x = 0",
      "    if c then x := compute(alpha, beta, gamma, delta)",
    ), { maximumLineLength: 36 })).toBe(lines(
      "module A",
      "let f(c: Bool): Unit =",
      "    var x = 0",
      "    if c then",
      "        x :=",
      "            compute(",
      "                alpha,",
      "                beta,",
      "                gamma,",
      "                delta,",
      "            )",
    ));
  });

  it("indents a value beneath `:=` one level, as a binding's block, and keeps its items", () => {
    expect(format(lines(
      "module A",
      "let f(n: Int): Int =",
      "    var total = 0",
      "    total :=",
      "            match n with",
      "                0 => 1",
      "                _ => n",
      "    total :=",
      "      let doubled = n * 2",
      "      doubled + total",
      "    total",
    ))).toBe(lines(
      "module A",
      "let f(n: Int): Int =",
      "    var total = 0",
      "    total :=",
      "        match n with",
      "            0 => 1",
      "            _ => n",
      "    total :=",
      "        let doubled = n * 2",
      "        doubled + total",
      "    total",
    ));
  });

  it("puts an `else` branch's value beneath its `:=`, as it would a binding's", () => {
    expect(format(lines(
      "module A",
      "let f(c: Bool): Unit =",
      "    var x = 0",
      "    if c then x := 1",
      "    else x := compute(alpha, beta, gamma)",
    ), { maximumLineLength: 36 })).toBe(lines(
      "module A",
      "let f(c: Bool): Unit =",
      "    var x = 0",
      "    if c then x := 1",
      "    else x :=",
      "        compute(alpha, beta, gamma)",
    ));
  });

  it("leaves a value that fits on the `:=` line where it is", () => {
    const text = lines(
      "module A",
      "let f(n: Int): Int =",
      "    var total = 0",
      "    total := n + 1",
      "    total",
    );
    expect(format(text, { maximumLineLength: 24 })).toBe(text);
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

describe("Trailing commas (§14)", () => {
  const leave: FormatOptions = { leaveTrailingCommasAsWritten: true };

  it("adds one after the last item of every list whose closing bracket begins a line", () => {
    expect(format(lines(
      "module A",
      "let corners = [",
      "    { x = 0, y = 0 },",
      "    { x = 1, y = 1 }",
      "]",
      "let total = add(",
      "    first,",
      "    second",
      ")",
      "let point = {",
      "    x = 1,",
      "    y = 2",
      "}",
      "let pair = (",
      "    1,",
      "    2",
      ")",
      "let scale(",
      "    value: Int,",
      "    factor: Int",
      "): Int = value * factor",
      "let table: Map(",
      "    String,",
      "    Int",
      ") = empty",
      "record Size derives (",
      "    Eq,",
      "    Show",
      ") = {",
      "    width: Int,",
      "    height: Int",
      "}",
      "let first(pair: (Int, Int)): Int =",
      "    match pair with",
      "        (",
      "            a,",
      "            b",
      "        ) => a",
    ))).toBe(lines(
      "module A",
      "let corners = [",
      "    { x = 0, y = 0 },",
      "    { x = 1, y = 1 },",
      "]",
      "let total = add(",
      "    first,",
      "    second,",
      ")",
      "let point = {",
      "    x = 1,",
      "    y = 2,",
      "}",
      "let pair = (",
      "    1,",
      "    2,",
      ")",
      "let scale(",
      "    value: Int,",
      "    factor: Int,",
      "): Int = value * factor",
      "let table: Map(",
      "    String,",
      "    Int,",
      ") = empty",
      "record Size derives (",
      "    Eq,",
      "    Show,",
      ") = {",
      "    width: Int,",
      "    height: Int,",
      "}",
      "let first(pair: (Int, Int)): Int =",
      "    match pair with",
      "        (",
      "            a,",
      "            b,",
      "        ) => a",
    ));
  });

  it("adds one to a `<…>` list the author spreads over lines", () => {
    expect(format(lines(
      "module A",
      "export let same<",
      "    a: Eq,",
      "    b: Eq",
      ">(left: (a, b), right: (a, b)): Bool = left == right",
    ))).toBe(lines(
      "module A",
      "export let same<",
      "    a: Eq,",
      "    b: Eq,",
      ">(left: (a, b), right: (a, b)): Bool = left == right",
    ));
  });

  it("indents a spread `<…>` list's items one level in, and its `>` at the line holding the `<` (§5.2)", () => {
    expect(format(lines(
      "module A",
      "export let same<",
      "        a: Eq,",
      "",
      "        b: Eq,",
      "",
      "    >(left: (a, b), right: (a, b)): Bool = left == right",
    ))).toBe(lines(
      "module A",
      "export let same<",
      "    a: Eq,",
      "",
      "    b: Eq,",
      ">(left: (a, b), right: (a, b)): Bool = left == right",
    ));
  });

  it("puts a comma that begins its line at the level of the line holding the opening bracket (§5.1)", () => {
    expect(format(lines(
      "module A",
      "let a =",
      "    f(1, (x) =>",
      "        x",
      "      ,)",
      "let b =",
      "    f(",
      "        first",
      "          , second",
      "    )",
    ))).toBe(lines(
      "module A",
      "let a =",
      "    f(1, (x) =>",
      "        x",
      "    ,)",
      "let b =",
      "    f(",
      "        first",
      "    , second,",
      "    )",
    ));
  });

  it("writes no space between a trailing comma and the bracket that closes its list (§7.1)", () => {
    expect(format(lines(
      "module A",
      "let a = f(1, 2 , )",
      "let b = [1, 2, ]",
      "let c = { x = 1, }",
      "let same<a: Eq, >(x: a) = x",
    ))).toBe(lines(
      "module A",
      "let a = f(1, 2,)",
      "let b = [1, 2,]",
      "let c = { x = 1, }",
      "let same<a: Eq,>(x: a) = x",
    ));
  });

  it("adds none where the closing bracket does not begin a line", () => {
    const text = lines(
      "module A",
      "let total = add(first, second)",
      "let label = describe(firstName,",
      "        lastName)",
      "let piece =",
      "    Piece({",
      "        expr = Empty,",
      "        kind = Setting(flags),",
      "    })",
    );
    expect(format(text)).toBe(text);
  });

  it("adds none after an item that ends in a block", () => {
    const text = lines(
      "module A",
      "let total =",
      "    Vector.fold(values, 0, (sum, value) =>",
      "        sum + value * weight",
      "    )",
      "let sizes = [",
      "    (x) =>",
      "        x",
      "]",
      "let kinds =",
      "    describe(",
      "        value,",
      "        match value with",
      "            Some(_) => 1",
      "            None => 0",
      "    )",
      "",
      "let chosen = choose(",
      "    flag,",
      "    if flag then",
      "        1",
      "    else",
      "        2",
      ")",
    );
    expect(format(text)).toBe(text);
  });

  it("adds one after a lambda whose body is on its `=>`'s own line", () => {
    expect(format(lines(
      "module A",
      "let total = Vector.fold(",
      "    values,",
      "    0,",
      "    (sum, value) => sum + value",
      ")",
    ))).toBe(lines(
      "module A",
      "let total = Vector.fold(",
      "    values,",
      "    0,",
      "    (sum, value) => sum + value,",
      ")",
    ));
  });

  it("adds none inside brackets that hold no list: grouping parentheses, an index, empty brackets", () => {
    const text = lines(
      "module A",
      "let value = (",
      "    alpha + beta",
      ")",
      "let item = items[",
      "    position",
      "]",
      "let nothing = f(",
      ")",
    );
    expect(format(text)).toBe(text);
  });

  it("puts the comma straight after the last item, ahead of a comment on its line", () => {
    expect(format(lines(
      "module A",
      "let names = [",
      "    \"one\",",
      "    \"two\" -- the last",
      "]",
    ))).toBe(lines(
      "module A",
      "let names = [",
      "    \"one\",",
      "    \"two\", -- the last",
      "]",
    ));
  });

  it("adds no second comma, and removes none, whatever the option says", () => {
    const text = lines(
      "module A",
      "let one = f(a, b,)",
      "let two = [",
      "    1,",
      "    2,",
      "]",
    );
    expect(format(text)).toBe(text);
    expect(format(text, leave)).toBe(text);
  });

  it("adds none where Leave trailing commas as written is on (§3.4)", () => {
    const text = lines(
      "module A",
      "let total = add(",
      "    first,",
      "    second",
      ")",
    );
    expect(format(text, leave)).toBe(text);
  });

  it("adds one to brackets the formatter opens (§9.4)", () => {
    expect(format(lines(
      "module A",
      "let total = add(firstArgument, secondArgument)",
    ), { maximumLineLength: 30 })).toBe(lines(
      "module A",
      "let total =",
      "    add(",
      "        firstArgument,",
      "        secondArgument,",
      "    )",
    ));
  });

  it("counts the comma in a line's length, written or not (§9.2)", () => {
    // The item's line is exactly 30 code points long without its comma.
    const text = lines(
      "module A",
      "let total = add(",
      "    firstArgument + secondArgu",
      ")",
    );
    const broken = lines(
      "module A",
      "let total = add(",
      "    firstArgument",
      "            + secondArgu,",
      ")",
    );
    expect(format(text, { maximumLineLength: 30 })).toBe(broken);
    expect(format(text, { maximumLineLength: 30, ...leave })).toBe(broken.replace("secondArgu,", "secondArgu"));
    expect(format(text, { maximumLineLength: 31 })).toBe(text.replace("secondArgu\n", "secondArgu,\n"));
    expect(format(text, { maximumLineLength: 31, ...leave })).toBe(text);
  });

  it("counts the comma when it fills a list", () => {
    // `10` would end the first line at exactly 37 code points without its comma.
    const text = lines("module A", "let a = f([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])");
    const filled = lines(
      "module A",
      "let a =",
      "    f([",
      "        1, 2, 3, 4, 5, 6, 7, 8, 9,",
      "        10,",
      "    ])",
    );
    expect(format(text, { maximumLineLength: 37 })).toBe(filled);
    expect(format(text, { maximumLineLength: 37, ...leave })).toBe(filled.replace("10,", "10"));
  });

  it("returns the added commas in its edits, which rebuild the formatted text", () => {
    const text = "module A\nlet x = f(\n  a,\n  b -- note\n)\n";
    const result = formatDocument(text);
    if (result.kind !== "Formatted") throw new Error("not formatted");
    let rebuilt = text;
    for (const edit of [...result.edits].reverse()) {
      expect(text.slice(edit.start, edit.end).trim()).toBe("");
      expect(edit.newText.replace(",", "").trim()).toBe("");
      rebuilt = rebuilt.slice(0, edit.start) + edit.newText + rebuilt.slice(edit.end);
    }
    expect(rebuilt).toBe(result.text);
    expect(result.text).toBe("module A\nlet x = f(\n    a,\n    b, -- note\n)\n");
  });

  it("adds Format document's commas within Format selection's region, and none outside it", () => {
    const text = lines(
      "module A",
      "let a = f(",
      "    1",
      ")",
      "let b = f(",
      "    2",
      ")",
    );
    const at = text.indexOf("let b");
    expect(formatSelection(text, { start: at, end: at })).toMatchObject({
      kind: "Formatted",
      text: lines("module A", "let a = f(", "    1", ")", "let b = f(", "    2,", ")"),
    });
    expect(formatSelection(text, { start: 0, end: text.length })).toMatchObject({ kind: "Formatted", text: format(text) });
  });

  it("never fights over a comma: either setting after the other changes nothing (§3.3)", () => {
    const text = lines(
      "module A",
      "let total = add(firstArgument, secondArgument)",
      "let more = add(",
      "    first,",
      "    second",
      ")",
    );
    for (const [one, two] of [[{}, leave], [leave, {}]] as const) {
      const options = (base: FormatOptions): FormatOptions => ({ ...base, maximumLineLength: 30 });
      const both = format(format(text, options(one)), options(two));
      expect(format(both, options(one))).toBe(both);
      expect(format(both, options(two))).toBe(both);
    }
  });

  it("sets aside a comma whose refusal the parser reports after it, without trying the others one by one", () => {
    // `a<b` reads as a type-argument list's `<`, so `>` beginning its line is
    // offered a comma before it, which the parser refuses at the `>`.
    const misread = "let c = f(a<b, c\n    >(d))\n";
    const text = "module A\n" + misread.repeat(2_000) + "let total = add(\n    1,\n    2\n)\n";
    const started = Date.now();
    const result = format(text);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(result.endsWith("    2,\n)\n")).toBe(true);
    expect(result).not.toContain("c,");
  });

  it("checks that only commas before closing brackets are added (§12)", () => {
    const before = read("module A\nlet x = f(a, b)\n");
    expect(sameText(before, read("module A\nlet x = f(a, b,)\n"), true)).toBe(true);
    expect(sameText(before, read("module A\nlet x = f(a, b,)\n"))).toBe(false);
    expect(sameText(before, read("module A\nlet x = f(a,, b)\n"), true)).toBe(false);
    expect(sameText(before, read("module A\nlet x = f(a, b),\n"), true)).toBe(false);
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
  { maximumLineLength: 72, leaveTrailingCommasAsWritten: true },
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
    // Only the commas §14 adds, and none where Leave trailing commas as written is on.
    expect(sameText(before, after, true)).toBe(true);
    if (settings[setting]!.leaveTrailingCommasAsWritten === true) expect(sameText(before, after)).toBe(true);
    expect(sameTree(before, after)).toBe(true);
    expect(format(text, settings[setting])).toBe(text);
  });

  // The house settings are setting 3: Maximum line length 100, Collapse extra
  // spaces on (spec/notes/canonical-formatting-and-naming.md H1, H2). The
  // library is house text, so Format document has nothing left to change.
  it.each(library)("leaves %s as it is at the house settings", (name) => {
    expect(libraryFormat(name, 3)).toBe(STDLIB_SOURCES[name]);
  });

  it.each(library)("keeps %s's grouping under every setting (§6.3)", (name) => {
    const groupings = settings.map((_, setting) => blankLineSites(libraryFormat(name, setting)));
    for (const grouping of groupings) expect(grouping).toEqual(groupings[0]);
  });

  const pairs = library.flatMap(([name]) =>
    ([[0, 4], [1, 2], [2, 4], [4, 5], [5, 4]] as const).map(([a, b]) => [name, a, b] as const));
  it.each(pairs)("settings never fight over %s: %i then %i (§3.3)", (name, first, second) => {
    const both = format(libraryFormat(name, first), settings[second]);
    expect(format(both, settings[first])).toBe(both);
    expect(format(both, settings[second])).toBe(both);
  });
});

/**
 * The tokens a blank line comes before, by index: the same tokens under every
 * setting. A trailing comma before a closing bracket is not counted, since
 * §14 adds it under some settings and not others.
 */
function blankLineSites(text: string): number[] {
  const tokens = read(text).lexed.tokens.filter((token, index, all) =>
    token.kind !== "Comma" || !["RightParen", "RightBracket", "RightBrace", "Greater"].includes(all[index + 1]?.kind ?? ""));
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
