import fc from "fast-check";
import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import type * as LaidOut from "../../syntax/laid-out/index.js";
import { lex } from "../lexer/lexer.js";
import { applyLayout } from "./layout.js";

describe("applyLayout", () => {
  test("wraps the module and separates top-level items", () => {
    expect(kinds(layout("let x = 1\nprint(x)").tokens)).toEqual([
      "VOpen", "NonUpperName", "UpperName", "VSep", "Let", "NonUpperName", "Equal", "Integer",
      "VSep", "NonUpperName", "LeftParen", "NonUpperName", "RightParen",
      "VClose", "Eof",
    ]);
  });

  test("keeps comment-only lines invisible to the offside rule", () => {
    const result = layout(
      "while ready do\n    first()\n-- deliberately outdented\n            {- padded -}\n    second()",
    );

    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VSep", "VOpen", "VSep", "VClose", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  describe("an assignment's `:=` (§2.1)", () => {
    test("a line ending in `:=` opens the value's block, as a binding's `=` does", () => {
      for (const text of [
        "total :=\n    count + 1",
        "total :=\n    let doubled = count * 2\n    doubled + 1",
        "let total =\n    count + 1",
      ]) {
        const result = layout(text);
        const virtual = virtualKinds(result.tokens);
        expect(virtual.slice(0, 3), text).toEqual(["VOpen", "VSep", "VOpen"]);
        expect(virtual.slice(-2), text).toEqual(["VClose", "VClose"]);
        expect(result.diagnostics, text).toEqual([]);
      }
      const kindsOf = kinds(layout("total :=\n    count + 1").tokens);
      expect(kindsOf[kindsOf.indexOf("Assign") + 1]).toBe("VOpen");
    });

    test("an assignment with its value on its line opens nothing", () => {
      for (const text of ["total := count\n    + 1", "total := count + 1"]) {
        const result = layout(text);
        expect(virtualKinds(result.tokens), text).toEqual(["VOpen", "VSep", "VClose"]);
        expect(result.diagnostics, text).toEqual([]);
      }
    });
  });

  describe("heads and their closing words (§2.4)", () => {
    test("a head is carried on by deeper lines to its closing word", () => {
      for (const text of [
        "if ready\n        and steady then\n    go()",
        "while remaining > 0\n        and not cancelled(job) do\n    step()",
        "for (name, total)\n        in totals do\n    show(name)",
        "match parse(\n        input) with\n    Some(n) => n",
        "match first\n        |> second with\n    Some(n) => n",
      ]) {
        const result = layout(text);
        expect(virtualKinds(result.tokens), text).toEqual(["VOpen", "VSep", "VOpen", "VClose", "VClose"]);
        expect(result.diagnostics, text).toEqual([]);
      }
    });

    test("brackets hold a head open, and a line inside them opens no block for it (§2.2)", () => {
      for (const text of [
        "while waiting(first,\n        second) do\n    step()",
        "if (a and\n        b) then\n    go()",
        "for x in [\n        a,\n        b\n    ] do\n    visit(x)",
        "match (\n        a,\n        b\n    ) with\n    _ => 0",
      ]) {
        const result = layout(text);
        expect(virtualKinds(result.tokens), text).toEqual(["VOpen", "VSep", "VOpen", "VClose", "VClose"]);
        expect(result.diagnostics, text).toEqual([]);
      }
    });

    test("a block opened inside brackets leaves the head going on after them", () => {
      const result = layout("while xs.any(x =>\n        x > 0) do\n    step()");
      expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VSep", "VOpen", "VClose", "VOpen", "VClose", "VClose"]);
      expect(result.diagnostics).toEqual([]);
    });

    test("an unfinished head opens no block: the deeper lines continue its item", () => {
      for (const text of ["while ready\n    step()", "for x in xs\n    visit(x)", "match o\n    None => 0", "if ready\n    go()"]) {
        const result = layout(text);
        expect(virtualKinds(result.tokens), text).toEqual(["VOpen", "VSep", "VClose"]);
        expect(result.diagnostics, text).toEqual([]);
      }
    });

    test("no block opens inside an unfinished head, except within brackets", () => {
      const bare = layout("while if a then\n        b\n    else c do\n    step()");
      expect(virtualKinds(bare.tokens)).toEqual(["VOpen", "VSep", "VOpen", "VClose", "VClose"]);
      const bracketed = layout("for x in (match cached with\n        Some(xs) => xs\n        None => []) do\n    visit(x)");
      expect(virtualKinds(bracketed.tokens)).toEqual([
        "VOpen", "VSep", "VOpen", "VSep", "VClose", "VOpen", "VClose", "VClose",
      ]);
      expect(bracketed.diagnostics).toEqual([]);
    });

    test("a closing word with more on its line opens no block", () => {
      const result = layout("while n > 0 do n := n - 1\nfor x in set do visit(x); finish()");
      expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VSep", "VSep", "VClose"]);
      expect(result.diagnostics).toEqual([]);
    });

    test("`then` at the item's column continues it; `do` and `with` there begin an item that still opens the block", () => {
      expect(virtualKinds(layout("if a\nthen\n    go()").tokens)).toEqual(["VOpen", "VSep", "VOpen", "VClose", "VClose"]);
      expect(virtualKinds(layout("while a\ndo\n    go()").tokens)).toEqual([
        "VOpen", "VSep", "VSep", "VOpen", "VClose", "VClose",
      ]);
      expect(virtualKinds(layout("match a\nwith\n    _ => 0").tokens)).toEqual([
        "VOpen", "VSep", "VSep", "VOpen", "VClose", "VClose",
      ]);
      // A lone `with` after no unfinished `match` is a name, and opens nothing.
      expect(virtualKinds(layout("let a = 1\nwith\n    .show()").tokens)).toEqual(["VOpen", "VSep", "VSep", "VClose"]);
    });

    test("`with` closes a `match` head only in the closing seat", () => {
      // The match function is a bare `match`; `match with with` matches a value named `with`.
      expect(virtualKinds(layout("let f = match\n    _ => 0").tokens)).toEqual(["VOpen", "VSep", "VOpen", "VClose", "VClose"]);
      expect(virtualKinds(layout("let f = match with with\n    _ => 0").tokens)).toEqual([
        "VOpen", "VSep", "VOpen", "VClose", "VClose",
      ]);
      // `match with` has no scrutinee before its `with`, and `(a, b)with` is a suffix.
      expect(virtualKinds(layout("let f = match with\n    _ => 0").tokens)).toEqual(["VOpen", "VSep", "VClose"]);
      expect(virtualKinds(layout("let f = match (a, b)with\n    _ => 0").tokens)).toEqual(["VOpen", "VSep", "VClose"]);
      // A keyword in a name seat heads nothing.
      expect(virtualKinds(layout("let k = ev.match\nlet j = p.then\n").tokens)).toEqual(["VOpen", "VSep", "VSep", "VClose"]);
    });
  });

  test("opens nested blocks and closes repeated dedents", () => {
    const result = layout("fun f(x) =\n    if x then\n        print(x)\n    else\n        print(0)\n    print(1)\nprint(2)");

    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VSep", "VOpen", "VOpen", "VClose", "VOpen", "VClose",
      "VSep", "VClose", "VSep", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("treats deeper declaration lines as continuations", () => {
    const result = layout("union Shape\n        derives Eq =\n    | Circle\n    | Point\nlet x = 1");

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VSep", "VSep", "VClose"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("recognizes exported block declarations", () => {
    const result = layout("export constraint Visible<a> =\n    show(x: a) -> String");

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VSep", "VOpen", "VClose", "VClose"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("opens a pattern member block but leaves a pattern alias on one line", () => {
    const declaration = layout(
      "export pattern pair(left: Int, right: Int): Pair\n" +
        "    view(value) = parts(value)\n" +
        "    build = create",
    );
    expect(virtualKinds(declaration.tokens)).toEqual([
      "VOpen", "VSep", "VOpen", "VSep", "VClose", "VClose",
    ]);
    expect(declaration.diagnostics).toEqual([]);

    const alias = layout("pattern pair = Pair.pair\nlet x = 1");
    expect(virtualKinds(alias.tokens)).toEqual(["VOpen", "VSep", "VSep", "VClose"]);
    expect(alias.diagnostics).toEqual([]);
  });

  test("keeps an aligned multiline chain in a value binding's block one item", () => {
    // The RHS opens a block, but `.take(5)` at the block's own indentation can
    // only continue an expression, so it receives no VSEP.
    const result = layout(
      "export let selected: Seq(Int) =\n" +
        "    numbers\n" +
        "    .take(5)",
    );

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VSep", "VOpen", "VClose", "VClose"]);
    expect(result.diagnostics).toEqual([]);
  });

  // Lexer & Layout §2.3: `<` left the continuation set when Functions §4.2's
  // type-parameter lambda made it expression-initial (issue #65). A line starting
  // with `<` at a block's own indentation must now start a new item.
  test("starts a new item on a leading `<`, which can now begin an expression", () => {
    const result = layout(
      "fun f() =\n" +
        "    let g = 1\n" +
        "    <a>(x: a): a => x",
    );

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VSep", "VOpen", "VSep", "VClose", "VClose"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("keeps `>` a continuation — it closes a binder list but never opens one", () => {
    const result = layout(
      "let ok =\n" +
        "    a\n" +
        "    > b",
    );

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VSep", "VOpen", "VClose", "VClose"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("opens a block for a value binding whose body is a sequence of items", () => {
    const result = layout(
      "let x =\n" +
        "    let y = 40\n" +
        "    y + 2",
    );

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VSep", "VOpen", "VSep", "VClose", "VClose"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("opens extern module binding blocks", () => {
    const result = layout(
      "extern from \"tiny-json\"\n" +
        "    export type JsonValue\n" +
        "    export fun parse(text: String) ->! JsonValue\n" +
        "extern import \"telemetry/register\"",
    );

    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VSep", "VOpen", "VSep", "VClose", "VSep", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("attaches else and catch clauses without an intervening separator", () => {
    const result = layout(
      "if ready then\n    run()\nelse\n    wait()\ntry\n    risky()\ncatch\n    Failure => recover()",
    );

    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VSep", "VOpen", "VClose", "VOpen", "VClose", "VSep",
      "VOpen", "VClose", "VOpen", "VClose", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("opens a then-branch block after mandatory then", () => {
    const result = layout(
      "fun fact(n: Int): Int =\n" +
        "    if n <= 1 then\n" +
        "        1\n" +
        "    else\n" +
        "        n * fact(n - 1)",
    );

    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen",
      "VSep",
      "VOpen",
      "VOpen",
      "VClose",
      "VOpen",
      "VClose",
      "VClose",
      "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("ignores newlines inside physical delimiters", () => {
    const result = layout("let value = call(\n    first,\n    second\n)\nprint(value)");

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VSep", "VSep", "VClose"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("allows a layout lambda body inside a physical delimiter", () => {
    const result = layout("map(values, x =>\n    inspect(x); transform(x)\n)\nprint(\"done\")");

    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VSep", "VOpen", "VClose", "VSep", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  // §2.2 for the shape `stdlib/Seq.hex` is written in: a lambda inside a record
  // literal, whose body is a block. The nested blocks must all close on the
  // dedent to `})`, leaving the record literal open for its physical `}`.
  //
  // Pinned because the prelude was written around a belief that this could not
  // work (#177). It always could. The *other* inline spelling — head on the
  // `pull =` line, `})` trailing the last arm — genuinely did not, and is
  // defect-log finding 5; it is fixed below by the group-closing rule.
  test("keeps a record literal open across a multi-arm match in a field value", () => {
    const result = layout(
      "Seq({ pull = () =>\n" +
      "    match next(source) with\n" +
      "        None => None\n" +
      "        Some((value, rest)) => Some((value, rest))\n" +
      "})",
    );

    // Module, lambda body, arm block; the two inner closes land before `})`.
    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VSep", "VOpen", "VOpen", "VSep", "VClose", "VClose", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("keeps a record literal open across a statement block in a field value", () => {
    const result = layout(
      "Seq({ pull = () =>\n" +
      "    var current = source\n" +
      "    while searching do\n" +
      "        current := rest\n" +
      "    current\n" +
      "})",
    );

    // Module, lambda body — separated statements — and the `while` body within.
    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VSep", "VOpen", "VSep", "VOpen", "VClose", "VSep", "VClose", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  // §2.2's other half: the group's closer ends what its lines opened. Defect-log
  // finding 5 — these shapes parsed as if the `}` were the next match arm,
  // because the offside rule sees dedents and a trailing `})` is not one.
  test("closes a layout block at the delimiter that ends its group", () => {
    const result = layout(
      "let m =\n" +
      "    Seq({ pull = () => match next(source) with\n" +
      "        None => None\n" +
      "        Some((v, r)) => Some((v, r)) })",
    );

    // The arm block's VClose lands on the `}`, before it — not after `})` at EOF.
    const closer = result.tokens.findIndex(({ kind }) => kind === "RightBrace");
    expect(result.tokens[closer - 1]?.kind).toBe("VClose");
    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VSep", "VOpen", "VOpen", "VSep", "VClose", "VClose", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("closes a layout block at a `)` too — the group's kind is irrelevant", () => {
    const result = layout(
      "let m =\n" +
      "    f(() => match next(source) with\n" +
      "        None => None\n" +
      "        Some((v, r)) => Some((v, r)))",
    );

    // Position, not just the multiset: without the rule the VCloses still all
    // appear, just after the `)` at EOF, which is what misparsed.
    const closer = result.tokens.findLastIndex(({ kind }) => kind === "RightParen");
    expect(result.tokens[closer - 1]?.kind).toBe("VClose");
    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VSep", "VOpen", "VOpen", "VSep", "VClose", "VClose", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("one closer unwinds every block its group opened", () => {
    const result = layout(
      "let m =\n" +
      "    f(x => match a with\n" +
      "        A => match b with\n" +
      "            B => 1)",
    );

    // Two arm blocks and the lambda body, all ended by the single `)`.
    const closer = result.tokens.findIndex(({ kind }) => kind === "RightParen");
    expect(result.tokens.slice(closer - 2, closer).map(({ kind }) => kind))
      .toEqual(["VClose", "VClose"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("blocks opened outside the group survive its closer", () => {
    const result = layout(
      "let m =\n" +
      "    match x with\n" +
      "        A => f({ y = 1 })\n" +
      "        B => 2",
    );

    // The `}` and `)` close nothing: the arm block predates the group, and `B`
    // still gets its VSep as a sibling arm.
    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VSep", "VOpen", "VOpen", "VSep", "VClose", "VClose", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("closes a layout block at a `]`, and at a `}` reached through `]`", () => {
    const result = layout(
      "let m =\n" +
      "    [match p with\n" +
      "        True => 1\n" +
      "        False => 0]",
    );

    const closer = result.tokens.findIndex(({ kind }) => kind === "RightBracket");
    expect(result.tokens[closer - 1]?.kind).toBe("VClose");
    expect(result.diagnostics).toEqual([]);
  });

  test("a closer of the wrong kind closes nothing", () => {
    // `)` against an open `[` matches no group, so it must not unwind the arm
    // block — same reasoning as the unmatched case, different branch value.
    const result = layout("let m =\n    id([match p with\n        True => 1)\n");

    const closer = result.tokens.findIndex(({ kind }) => kind === "RightParen");
    expect(result.tokens[closer - 1]?.kind).not.toBe("VClose");
    expect(virtualKinds(result.tokens).filter((kind) => kind === "VOpen"))
      .toHaveLength(virtualKinds(result.tokens).filter((kind) => kind === "VClose").length);
  });

  test("a trailing `;` before a group's closer is still diagnosed", () => {
    // The closer ends the block, so the `;` is trailing — §5 owes the diagnostic
    // whichever line the closer sits on. Both spellings must agree.
    const trailing = layout("let m =\n    id(match p with\n        True => 1\n        False => 0;)");
    const dedented = layout("let m =\n    id(match p with\n        True => 1\n        False => 0;\n    )");

    expect(trailing.diagnostics.map(({ message }) => message)).toEqual([
      "`;` separates statements; Hexagon lines don't end with one",
    ]);
    expect(trailing.diagnostics.map(({ message }) => message))
      .toEqual(dedented.diagnostics.map(({ message }) => message));
  });

  test("brackets inside a string do not reach the group-closing rule", () => {
    // §2's interpolation clause. A string is one composite physical token, so
    // its `}` and `)` are invisible here — pinned because the rule would close
    // real blocks on them if that ever stopped being true.
    const result = layout(
      "let m =\n" +
      "    id(match p with\n" +
      "        True => \"a${ 1 }b)\"\n" +
      "        False => \"}\")",
    );

    expect(result.diagnostics).toEqual([]);
    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VSep", "VOpen", "VOpen", "VSep", "VClose", "VClose", "VClose",
    ]);
  });

  test("an unmatched closer closes no block", () => {
    const result = layout("let m =\n    match x with\n        A => 1)\n");

    // One stray `)` must not unwind the arm block into a cascade of errors.
    const closer = result.tokens.findIndex(({ kind }) => kind === "RightParen");
    expect(result.tokens[closer - 1]?.kind).not.toBe("VClose");
    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VSep", "VOpen", "VOpen", "VClose", "VClose", "VClose",
    ]);
  });

  test("validates semicolons as same-line block separators", () => {
    const result = layout("; let x = 1;; let y = (1; 2)\nlet z = 3;");

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      "`;` must have a statement on both sides",
      "`;` must have a statement on both sides",
      "`;` must have a statement on both sides",
      "did you mean `,`? `;` only separates statements",
      "`;` separates statements; Hexagon lines don't end with one",
    ]);
  });

  test("retains a legal semicolon without adding a virtual separator", () => {
    const result = layout("let f = x => print(x); print(\"done\")");

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VSep", "VClose"]);
    expect(result.tokens.filter(({ kind }) => kind === "Semicolon")).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
  });

  test("reports inconsistent dedents and recovers at the revealed block", () => {
    const result = layout("if x then\n    if y then\n        a\n      b\nelse\n    c");

    expect(result.diagnostics.map(({ message }) => message)).toContain(
      "inconsistent dedent; expected one of columns 0, 4",
    );
    expect(result.tokens.at(-1)?.kind).toBe("Eof");
  });

  test("preserves lexical diagnostics and closes an empty module", () => {
    const empty = layout("");
    expect(kinds(empty.tokens)).toEqual(["VOpen", "NonUpperName", "UpperName", "VClose", "Eof"]);

    const invalid = layout("@\nlet x = 1");
    expect(invalid.diagnostics.map(({ message }) => message)).toContain(
      'invalid character "@" (U+0040)',
    );
  });

  test("reports a block head left open at end of file", () => {
    const result = layout("if ready then");

    expect(result.diagnostics.map(({ message }) => message)).toContain(
      "expected an indented block",
    );
  });

  test("an honor in a group opens its member block past an `export` the parser refuses", () => {
    // It lays out as the honor it is, and the parser refuses the `export`.
    const laid = layout("honor\n    export Show<Ping> =\n        show(p) = \"ping\"\nlet x = 1");
    expect(virtualKinds(laid.tokens)).toEqual(["VOpen", "VSep", "VOpen", "VOpen", "VClose", "VClose", "VSep", "VClose"]);
  });

  test("reports an honor group's last honor that a line ends without its block", () => {
    // Its member block is required (§2.1's row), whether a dedent ends it or a
    // line at its own column, and the parser reads it as an empty honor with no
    // report of its own.
    const message = ({ message, primary }: { message: string; primary: Source.Span }): string =>
      `${primary.start.line}:${primary.start.column} ${message}`;
    expect(layout("honor\n    Show<Ping> =\nlet x = 1").diagnostics.map(message))
      .toEqual(["4:0 expected an indented block"]);
    expect(layout("honor\n    Show<Ping> =\n    Show<Pong> =\n        show(p) = \"pong\"").diagnostics.map(message))
      .toEqual(["4:4 expected an indented block"]);
    // A head with binders is an honor too.
    expect(layout("honor\n    <a: Show> Show<Rose(a)> =\nlet x = 1").diagnostics.map(message))
      .toEqual(["4:0 expected an indented block"]);
    // Another block's item that a dedent ends is the parser's to report, which
    // it does in its own words, as is a group's item that is no honor.
    expect(layout("fun\n    g() =\nlet x = 1").diagnostics).toEqual([]);
    for (const item of ["f(x) =", "match x with", "fun", "honor", "honor Show<Ping> =", "widens M.f =", "let x =", "Show<Pong>"]) {
      expect(layout(`honor\n    Show<Ping> =\n        show(p) = "ping"\n    ${item}\nlet x = 1`).diagnostics).toEqual([]);
    }
  });

  test("keeps virtual tokens balanced over bracket and indentation soup", () => {
    // `fc.string()` below is a good crash guard but almost never produces a block
    // head, a delimiter, and a dedent in one input — the combination the
    // group-closing rule works on. This generator does nothing else.
    const line = fc.tuple(
      fc.nat({ max: 3 }).map((depth) => " ".repeat(depth * 4)),
      fc.constantFrom(
        "match x with", "f(", "g({ a = ", "h([", "x =>", "if p then", "while p do",
        "let y =", ")", "}", "]", "})", "])", "A => 1", "1", "y", ");",
        "{ a = 1 }", "1;", "1;)",
      ),
    ).map(([indent, body]) => indent + body);

    fc.assert(
      fc.property(fc.array(line, { maxLength: 12 }), (lines) => {
        const result = layout(lines.join("\n"));
        let depth = 0;

        for (const token of result.tokens) {
          if (token.kind === "VOpen") depth += 1;
          if (token.kind === "VClose") depth -= 1;
          expect(depth).toBeGreaterThanOrEqual(0);
        }

        expect(depth).toBe(0);
        expect(result.tokens.at(-1)?.kind).toBe("Eof");
      }),
      { numRuns: 500 },
    );
  });

  test("keeps virtual tokens balanced while recovering from arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = layout(text);
        let depth = 0;

        for (const token of result.tokens) {
          if (token.kind === "VOpen") depth += 1;
          if (token.kind === "VClose") depth -= 1;
          expect(depth).toBeGreaterThanOrEqual(0);
          expect(token.span.start.offset).toBeGreaterThanOrEqual(0);
          expect(token.span.end.offset).toBeLessThanOrEqual(HEADER.length + text.length);
        }

        expect(depth).toBe(0);
        expect(result.tokens.at(-1)?.kind).toBe("Eof");
      }),
      { numRuns: 250 },
    );
  });
});

const HEADER = "module Test\n\n";

function layout(text: string): LaidOut.File {
  const source = new Source.File(Source.fileId(0), "test.hex", HEADER + text);
  return applyLayout(lex(source));
}

function kinds(tokens: readonly LaidOut.Token[]): readonly LaidOut.Token["kind"][] {
  return tokens.map(({ kind }) => kind);
}

function virtualKinds(tokens: readonly LaidOut.Token[]): readonly string[] {
  return tokens.flatMap(({ kind }) =>
    kind === "VOpen" || kind === "VSep" || kind === "VClose" ? [kind] : [],
  );
}
