import { describe, expect, test } from "vitest";
import { AnalysisSession } from "../analysis/session.js";
import { signatureMarkdown } from "../analysis/signature-text.js";
import type { SignatureHelp } from "./signature-help.js";

/** The cursor is `‸`, removed before compiling (`completions.test.ts` says why not `|`). */
function at(marked: string): { readonly text: string; readonly offset: number } {
  const offset = marked.indexOf("‸");
  if (offset < 0) throw new Error("no cursor in the source");
  return { text: marked.slice(0, offset) + marked.slice(offset + 1), offset };
}

const HEAD = [
  "module Main",
  "(** Adds two numbers. *)",
  "fun add(a: Int, b: Int): Int = a + b",
  "fun negate(n: Int): Int = 0 - n",
  "fun pair((x, y): (Int, Int), c: Int): Int = x + y + c",
  "record Point = { x: Int, y: Int, h: (Int) -> Int }",
  "",
].join("\n");

function helpIn(marked: string, head = HEAD): SignatureHelp | undefined {
  const { text, offset } = at(head + marked);
  const session = new AnalysisSession();
  session.setFile("/main.hex", text);
  return session.signatureHelp("/main.hex", offset);
}

/**
 * The label, each parameter as the text it covers there, and the active one. A
 * named parameter covers its name with its type, so its name must begin what
 * it covers; an unnamed one is marked `_=`.
 */
function shown(help: SignatureHelp | undefined): string | undefined {
  if (help === undefined) return undefined;
  const parameters = help.parameters
    .map(({ range: [start, end], name }) => {
      const covered = help.label.slice(start, end);
      if (name === undefined) return `_=${covered}`;
      if (!covered.startsWith(`${name}: `)) throw new Error(`\`${name}\` covers \`${covered}\``);
      return covered;
    })
    .join(", ");
  return `${help.label} [${parameters}] @${help.activeParameter}`;
}

const ADD = "add: (a: Int, b: Int) -> Int [a: Int, b: Int]";

describe("signature help", () => {
  test("an unclosed call: hover's line, each parameter's place and name, the documentation", () => {
    const help = helpIn("fun t(q: Int): Int = add(q, ‸\n");
    expect(shown(help)).toBe(`${ADD} @1`);
    expect(help?.documentation).toBe("Adds two numbers.");
    expect(help?.colourOwners).toBeUndefined();
  });

  test("the label's face is the one hover shows for the callee", () => {
    const { text, offset } = at(HEAD + "fun t(v: Vector(Int)): Int = v.fold(0, ‸)\n");
    const session = new AnalysisSession();
    session.setFile("/main.hex", text);
    const hover = session.hover("/main.hex", text.indexOf("fold") + 1);
    const help = session.signatureHelp("/main.hex", offset);
    expect(help?.label).toBe(`fold: ${hover?.signature}`);
    expect(hover?.signature).toBe("(values: Vector(a), initial: b, combine: (b, a) ->! b) >-> b");
    expect(help?.colourOwners).toEqual(hover?.colourOwners);
    expect(help?.colourOwners).toHaveLength(1);
  });

  test("the text under the signature: the gloss in sentences, then the documentation", () => {
    const help = helpIn("fun t(v: Vector(Int)): Int = v.fold(0, ‸)\n");
    // The gloss is stored as a phrase and shown on a line of its own as
    // sentences (Declarations Preamble §1.3).
    expect(help?.colourOwners).toEqual(["impure only if `combine` is impure; may fail only if `combine` may fail"]);
    expect(signatureMarkdown(help!)?.split("\n\n")[0])
      .toBe("Impure only if `combine` is impure. May fail only if `combine` may fail.");
  });

  test("which parameter: the commas behind the caret", () => {
    expect(shown(helpIn("fun t(q: Int): Int = add(‸q, 1)\n"))).toBe(`${ADD} @0`);
    expect(shown(helpIn("fun t(q: Int): Int = add(q‸, 1)\n"))).toBe(`${ADD} @0`);
    // In the space before an argument, and in the space before a comma.
    expect(shown(helpIn("fun t(q: Int): Int = add(‸ q, 1)\n"))).toBe(`${ADD} @0`);
    expect(shown(helpIn("fun t(q: Int): Int = add(q ‸, 1)\n"))).toBe(`${ADD} @0`);
    expect(shown(helpIn("fun t(q: Int): Int = add(q,‸ 1)\n"))).toBe(`${ADD} @1`);
    expect(shown(helpIn("fun t(q: Int): Int = add(q, ‸1)\n"))).toBe(`${ADD} @1`);
    expect(shown(helpIn("fun t(q: Int): Int = add(q, 1‸)\n"))).toBe(`${ADD} @1`);
    expect(shown(helpIn("fun t(q: Int): Int = add(‸)\n"))).toBe(`${ADD} @0`);
    expect(shown(helpIn("fun t(q: Int): Int = add(q, 1, ‸)\n"))).toBe(`${ADD} @2`);
  });

  test("a comma in a comment or a string is not one", () => {
    expect(shown(helpIn("fun t(q: Int): Int = add(q (* a, b *)‸\n"))).toBe(`${ADD} @0`);
    expect(shown(helpIn("fun t(q: Int): Int = add(q, (* a, b *)‸\n"))).toBe(`${ADD} @1`);
    expect(shown(helpIn("fun t(q: String): Int = add(q.length(), \"a, b‸\".length())\n"))).toBe(`${ADD} @1`);
  });

  test("outside the parentheses there is no call to help with", () => {
    expect(helpIn("fun t(q: Int): Int = add(q, 1)‸\n")).toBeUndefined();
    expect(helpIn("fun t(q: Int): Int = ad‸d(q, 1)\n")).toBeUndefined();
    expect(helpIn("fun t(q: Int): Int = add‸(q, 1)\n")).toBeUndefined();
  });

  test("the innermost call holds the caret, and the outer one resumes after it closes", () => {
    expect(shown(helpIn("fun t(q: Int): Int = add(q, negate(‸\n"))).toBe(
      "negate: (n: Int) -> Int [n: Int] @0",
    );
    expect(shown(helpIn("fun t(q: Int): Int = add(negate(q)‸, 1)\n"))).toBe(`${ADD} @0`);
    expect(shown(helpIn("fun t(q: Int): Int = add(negate(q), ‸1)\n"))).toBe(`${ADD} @1`);
  });

  test("at the very end of the text, with no newline after it", () => {
    expect(shown(helpIn("fun t(q: Int): Int = add(‸"))).toBe(`${ADD} @0`);
    expect(shown(helpIn("fun t(q: Int): Int = add(q, ‸"))).toBe(`${ADD} @1`);
  });

  test("an unclosed call reaches over the spaces, line breaks and comments after it, to the next token", () => {
    expect(shown(helpIn("fun t(q: Int): Int = add(q, (* a *)\n    // b\n    (* c *) ‸"))).toBe(`${ADD} @1`);
    // Past the last argument kept, with no comma after it yet: a tab and a
    // carriage return are spaces and line breaks too.
    expect(shown(helpIn("fun t(q: Int): Int = add(q\t‸"))).toBe(`${ADD} @0`);
    expect(shown(helpIn("fun t(q: Int): Int = add(q\r\n‸"))).toBe(`${ADD} @0`);
    // An unterminated comment runs to the end of the text, and so does the call.
    expect(shown(helpIn("fun t(q: Int): Int = add(q, (* a ‸"))).toBe(`${ADD} @1`);
    // The next token is not the call's to reach past.
    expect(helpIn("fun t(q: Int): Int = add(q, \nfun u(): Int = ‸1\n")).toBeUndefined();
  });

  test("an unclosed call in the middle of a block", () => {
    expect(shown(helpIn("fun t(q: Int): Int =\n    let z = add(q, ‸\n    z\n"))).toBe(`${ADD} @1`);
  });

  test("a mark or a space between the callee and its `(`", () => {
    expect(shown(helpIn("fun t(q: Int): Int = add!(q, ‸)\n"))).toBe(`${ADD} @1`);
    expect(shown(helpIn("fun t(q: Int): Int = add (q, ‸)\n"))).toBe(`${ADD} @1`);
    // Before the `(`, past the mark, the caret is not inside yet.
    expect(helpIn("fun t(q: Int): Int = add!‸(q, 1)\n")).toBeUndefined();
  });

  test("a `(` on the next line, after a comment, is the call's own", () => {
    expect(shown(helpIn("fun t(q: Int): Int = add // note\n    (q, ‸1)\n"))).toBe(`${ADD} @1`);
    // Not inside yet: in the comment, and in the indentation before the `(`.
    expect(helpIn("fun t(q: Int): Int = add // no‸te\n    (q, 1)\n")).toBeUndefined();
    expect(helpIn("fun t(q: Int): Int = add // note\n  ‸  (q, 1)\n")).toBeUndefined();
  });

  test("a receiver is the first argument, so the highlight counts it", () => {
    const help = helpIn("fun t(v: Vector(Int)): Vector(Int) = v.map(‸\n");
    expect(shown(help)).toBe("map: (values: Vector(a), transform: a ->! b) >-> Vector(b) [values: Vector(a), transform: a ->! b] @1");
    expect(help?.documentation).toContain("calling the function `transform` on each element");
    // The same operation through its module counts every written argument.
    expect(shown(helpIn("fun t(v: Vector(Int)): Vector(Int) = Vector.map(v, ‸\n"))).toBe(
      "map: (values: Vector(a), transform: a ->! b) >-> Vector(b) [values: Vector(a), transform: a ->! b] @1",
    );
  });

  test("a piped value is the first argument too", () => {
    expect(shown(helpIn("fun t(q: Int): Int = q |> add(‸\n"))).toBe(`${ADD} @1`);
    expect(shown(helpIn("fun t(q: Int): Int = q |> add(1‸)\n"))).toBe(`${ADD} @1`);
  });

  test("an argument the compiler adapts is still the outer call's", () => {
    // `v` is handed to a `Seq` parameter through an adaptation the compiler
    // writes (Collections Part 5 §3.6); that is a call no source wrote.
    expect(shown(helpIn("fun t(v: Vector(Int)): Seq(Int) = Seq.map((v‸), (n) => n)\n"))).toBe(
      "map: (source: Seq(a), transform: a -> b) -> Seq(b) [source: Seq(a), transform: a -> b] @0",
    );
  });

  test("...even where the adapted argument begins with a `(`", () => {
    // The adaptation starts where its argument does, at `(v)`'s parenthesis,
    // which is not a call's.
    expect(shown(helpIn("fun t(v: Vector(Int)): Seq(Int) = Seq.map((v‸).map((n) => n), (m) => m)\n"))).toBe(
      "map: (source: Seq(a), transform: a -> b) -> Seq(b) [source: Seq(a), transform: a -> b] @0",
    );
  });

  test("a `|>` stage with no parentheses of its own is not a call being written", () => {
    // The stage `q |> negate` is a call, and what follows it is the vector's.
    expect(helpIn("fun t(q: Int): Vector(Int) = [q |> negate, ‸1]\n")).toBeUndefined();
  });

  test("a constrained member called on its subject: the subject fills the only parameter", () => {
    const help = helpIn("fun t(): String = 1.show(‸)\n");
    expect(shown(help)).toBe("show: <a: Show> (value: a) -> String [value: a] @1");
    expect(help?.documentation).toBe("The canonical textual form of `value`.");
  });

  test("a constraint member at a known instance: the instance's face, as hover shows it", () => {
    const READER = [
      "record Job = { id: Int }",
      "constraint Reader<r> =",
      "    read(source: r, n: Int) ->! String",
      "honor Reader<Job> =",
      "    read(job, n) = \"x\"",
      "",
    ].join("\n");
    expect(shown(helpIn(`${READER}fun t(j: Job): String = read(j, ‸1)\n`))).toBe(
      "read: (source: Job, n: Int) -> String [source: Job, n: Int] @1",
    );
    expect(shown(helpIn(`${READER}fun t(j: Job): String = j.read(‸1)\n`))).toBe(
      "read: (source: Job, n: Int) -> String [source: Job, n: Int] @1",
    );
    // In generic code, the member's contract.
    expect(shown(helpIn(`${READER}fun t<a: Reader>(j: a): String = read!(j, ‸1)\n`))).toBe(
      "read: <a: Reader> (source: a, n: Int) ->! String [source: a, n: Int] @1",
    );
  });

  test("names come from the declaration, where it has one", () => {
    // A constructor's named slots, and an exception's; an unnamed slot is only
    // its place, and has none.
    expect(shown(helpIn("fun t(): Option(Int) = Some(‸\n"))).toBe("Some: (value: a) -> Option(a) [value: a] @0");
    const SHAPE = "union Shape =\n    | Rect(w: Int, h: Int)\n    | Dot(Int, Int)\n";
    expect(shown(helpIn(`${SHAPE}fun t(): Shape = Rect(1, ‸\n`))).toBe("Rect: (w: Int, h: Int) -> Shape [w: Int, h: Int] @1");
    expect(shown(helpIn(`${SHAPE}fun t(): Shape = Dot(1, ‸\n`))).toBe("Dot: (Int, Int) -> Shape [_=Int, _=Int] @1");
    // A refused mix of the two keeps its unnamed slot's place to itself.
    expect(shown(helpIn("union Mixed =\n    | Mixed(a: Int, Int)\nfun t(): Mixed = Mixed(1, ‸\n"))).toBe(
      "Mixed: (a: Int, Int) -> Mixed [a: Int, _=Int] @1",
    );
    expect(shown(helpIn("exception Oops(code: Int, why: String)\nfun t(): Unit = throw^(Oops(1, ‸\n"))).toBe(
      "Oops: (code: Int, why: String) -> Exn [code: Int, why: String] @1",
    );
    // A record field holding a function: its type, no names.
    expect(shown(helpIn("fun t(p: Point): Int = p.h(‸\n"))).toBe("h: Int -> Int [_=Int] @0");
    // A pattern parameter's binder is the compiler's own.
    expect(shown(helpIn("fun t(): Int = pair((1, 2), ‸\n"))).toBe(
      "pair: ((Int, Int), c: Int) -> Int [_=(Int, Int), c: Int] @1",
    );
    // A `let` bound to a lambda.
    expect(shown(helpIn("fun t(): Int =\n    let g = (m: Int, n: Int) => m * n\n    g(1, ‸\n"))).toBe(
      "g: (m: Int, n: Int) -> Int [m: Int, n: Int] @1",
    );
    // A `let` bound to another name, not to a lambda: no parameter list of its own.
    expect(shown(helpIn("fun t(): Int =\n    let h = add\n    h(1, ‸\n"))).toBe(
      "h: (Int, Int) -> Int [_=Int, _=Int] @1",
    );
    // A parameter holding a function has a type and nothing to name its parameters.
    expect(shown(helpIn("fun t(f: (Int, Int) -> Int): Int = f(1, ‸\n"))).toBe(
      "f: (Int, Int) -> Int [_=Int, _=Int] @1",
    );
    // A constraint member's own declaration names them, and so does an extern one.
    expect(shown(helpIn(
      "constraint Tag<a> =\n    tag(s: a, n: Int) -> String\nfun t<a: Tag>(v: a): String = tag(v, ‸\n",
    ))).toBe("tag: <a: Tag> (s: a, n: Int) -> String [s: a, n: Int] @1");
    expect(shown(helpIn("extern from \"m\"\n    fun twice(count: Int) ->! Int\nfun t(): Int = twice!(‸\n"))).toBe(
      "twice: (count: Int) ->! Int [count: Int] @0",
    );
  });

  test("a callee that is not a function, or not known, has no signature", () => {
    expect(helpIn("fun t(q: Int): Int = q(‸\n")).toBeUndefined();
    expect(helpIn("fun t(q: Int): Int = nothing(1, ‸\n")).toBeUndefined();
  });
});

/**
 * Wherever a call is written, the walk finds it: one for each kind of tree that
 * can hold an expression.
 */
describe("signature help finds a call wherever it stands", () => {
  const places: readonly (readonly [string, string])[] = [
    ["a `let`", "fun t(): Int =\n    let z = add(1, ‸2)\n    z\n"],
    ["a `var`", "fun t(): Int =\n    var z = add(1, ‸2)\n    z\n"],
    ["a `let` pattern", "fun t(): Int =\n    let (z, w) = (add(1, ‸2), 3)\n    z + w\n"],
    ["a top-level `let`", "let z: Int = add(1, ‸2)\n"],
    ["a statement", "fun t(): Unit =\n    Debug.log(\"${add(1, ‸2)}\")\n    ()\n"],
    ["a vector", "fun t(): Vector(Int) = [add(1, ‸2)]\n"],
    ["a tuple", "fun t(): (Int, Int) = (add(1, ‸2), 3)\n"],
    ["a record", "fun t(): {x: Int} = { x = add(1, ‸2) }\n"],
    ["a group", "fun t(): Int = (add(1, ‸2))\n"],
    ["an ascription", "fun t(): Int = (add(1, ‸2): Int)\n"],
    ["a lambda", "fun t(): Int -> Int = (n) => add(n, ‸2)\n"],
    ["an `if` condition", "fun t(): Int = if add(1, ‸2) > 0 then 1 else 2\n"],
    ["an `if` branch", "fun t(): Int = if True then add(1, ‸2) else 2\n"],
    ["an `else` branch", "fun t(): Int = if True then 1 else add(1, ‸2)\n"],
    ["a `while` condition", "fun t(): Unit =\n    while add(1, ‸2) > 5\n        ()\n"],
    ["a `while` body", "fun t(): Unit =\n    var n = 0\n    while n < 1\n        n := add(n, ‸1)\n"],
    ["a `for` source", "fun t(): Unit =\n    for n in 1..add(1, ‸2)\n        ()\n"],
    ["a `for` body", "fun t(): Unit =\n    var s = 0\n    for n in 1..3\n        s := add(s, ‸n)\n"],
    ["a `match` scrutinee", "fun t(): Int =\n    match add(1, ‸2)\n        _ => 0\n"],
    ["a `match` arm", "fun t(o: Option(Int)): Int =\n    match o\n        Some(n) => add(n, ‸1)\n        None => 0\n"],
    ["a `match` guard", "fun t(o: Option(Int)): Int =\n    match o\n        Some(n) when add(n, ‸1) > 0 => 1\n        _ => 0\n"],
    ["a `match` catch arm", "exception Bad\nfun risky(n: Int): Int = if n > 0 then n else throw^(Bad)\nfun t(): Int =\n    match risky^(1)\n        n => n\n    catch\n        Bad => add(1, ‸2)\n"],
    ["a record copied", "fun t(p: Point): Int = { ...(if add(1, ‸2) > 0 then p else p) }.x\n"],
    ["a receiver", "fun t(): String = add(1, ‸2).show()\n"],
    ["an index", "fun t(v: Vector(Int)): Int = v[add(0, ‸0)]\n"],
    ["an operator", "fun t(): Int = add(1, ‸2) * 3\n"],
    ["a comparison", "fun t(): Bool = add(1, ‸2) < 3\n"],
    ["`and`", "fun t(): Bool = True and add(1, ‸2) < 3\n"],
    ["`not`", "fun t(): Bool = not (add(1, ‸2) < 3)\n"],
    ["a range", "fun t(): Unit =\n    for n in add(1, ‸2)..5\n        ()\n"],
    ["an assignment", "fun t(): Int =\n    var z = 0\n    z := add(1, ‸2)\n    z\n"],
    ["an argument", "fun t(): Int = negate(add(1, ‸2))\n"],
    ["a callee", "fun pick(n: Int): (Int) -> Int = (m) => m + n\nfun t(): Int = pick(add(1, ‸2))(3)\n"],
    ["the left of `and`", "fun t(): Bool = add(1, ‸2) < 3 and True\n"],
    // Refused (a target is a bare name), and still where the user is typing.
    ["an assignment's target", "fun t(v: Vector(Int)): Unit = v[add(0, ‸0)] := 1\n"],
    ["a `throw`", "exception Bad(n: Int)\nfun t(): Int = throw^(Bad(add(1, ‸2)))\n"],
    ["a `try`", "exception Bad\nfun risky(n: Int): Int = if n > 0 then n else throw^(Bad)\nfun t(): Int =\n    try\n        add(risky^(1), ‸2)\n    catch\n        Bad => 0\n"],
    ["a `catch` arm", "exception Bad\nfun risky(n: Int): Int = if n > 0 then n else throw^(Bad)\nfun t(): Int =\n    try\n        risky^(1)\n    catch\n        Bad => add(1, ‸2)\n"],
    ["a constraint default", "constraint Tag<a> =\n    tag(s: a) -> Int = add(1, ‸2)\n"],
    ["an `honor` member", "constraint Tag<a> =\n    tag(s: a) -> Int\nhonor Tag<Point> =\n    tag(s) = add(s.x, ‸2)\n"],
    ["a pattern's view", "pattern same(value: Int): Int\n    view(value) = add(value, ‸1)\n    build(value) = value\n"],
    ["a pattern's build", "pattern same(value: Int): Int\n    view(value) = value\n    build(value) = add(value, ‸1)\n"],
  ];
  for (const [place, marked] of places) {
    test(`in ${place}`, () => {
      expect(shown(helpIn(marked))).toBe(`${ADD} @1`);
    });
  }

  test("each of those programs is one the compiler accepts, but the refused target", () => {
    for (const [place, marked] of places) {
      const session = new AnalysisSession();
      session.setFile("/main.hex", at(HEAD + marked).text);
      const reports = session.diagnostics("/main.hex").map(({ message }) => message);
      expect([place, reports]).toEqual([
        place,
        place === "an assignment's target"
          ? ["assignment targets a bare name; records and tuples are immutable", "assignment requires a `var` binding"]
          : [],
      ]);
    }
  });
});
