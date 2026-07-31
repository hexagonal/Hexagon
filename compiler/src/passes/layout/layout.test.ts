import fc from "fast-check";
import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import type * as LaidOut from "../../syntax/laid-out/index.js";
import { lex } from "../lexer/lexer.js";
import { applyLayout } from "./layout.js";

describe("applyLayout", () => {
  test("wraps the module and separates top-level items", () => {
    expect(kinds(layout("let x = 1\nprint(x)").tokens)).toEqual([
      "VOpen", "Let", "NonUpperName", "Equal", "Integer",
      "VSep", "NonUpperName", "LeftParen", "NonUpperName", "RightParen",
      "VClose", "Eof",
    ]);
  });

  test("keeps comment-only lines invisible to the offside rule", () => {
    const result = layout(
      "while ready\n    first()\n// deliberately outdented\n            (* padded *)\n    second()",
    );

    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VOpen", "VSep", "VClose", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("opens nested blocks and closes repeated dedents", () => {
    const result = layout("fun f(x) =\n    if x then\n        print(x)\n    else\n        print(0)\n    print(1)\nprint(2)");

    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VOpen", "VOpen", "VClose", "VOpen", "VClose",
      "VSep", "VClose", "VSep", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("treats deeper declaration lines as continuations", () => {
    const result = layout("union Shape\n        derives Eq =\n    | Circle\n    | Point\nlet x = 1");

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VSep", "VClose"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("recognizes exported block declarations", () => {
    const result = layout("export constraint Visible<a> =\n    show(x: a): String");

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VOpen", "VClose", "VClose"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("keeps an aligned multiline chain in a value binding's block one item", () => {
    // The RHS opens a block, but `.take(5)` at the block's own indentation can
    // only continue an expression, so it receives no VSEP.
    const result = layout(
      "export let selected: Seq(Int) =\n" +
        "    numbers\n" +
        "    .take(5)",
    );

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VOpen", "VClose", "VClose"]);
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

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VOpen", "VSep", "VClose", "VClose"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("keeps `>` a continuation — it closes a binder list but never opens one", () => {
    const result = layout(
      "let ok =\n" +
        "    a\n" +
        "    > b",
    );

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VOpen", "VClose", "VClose"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("opens a block for a value binding whose body is a sequence of items", () => {
    const result = layout(
      "let x =\n" +
        "    let y = 40\n" +
        "    y + 2",
    );

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VOpen", "VSep", "VClose", "VClose"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("opens extern module binding blocks", () => {
    const result = layout(
      "extern from \"tiny-json\"\n" +
        "    export type JsonValue\n" +
        "    export fun parse(text: String): JsonValue\n" +
        "extern import \"telemetry/register\"",
    );

    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VOpen", "VSep", "VClose", "VSep", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("attaches else and catch clauses without an intervening separator", () => {
    const result = layout(
      "if ready then\n    run()\nelse\n    wait()\ntry\n    risky()\ncatch\n    Failure => recover()",
    );

    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VOpen", "VClose", "VOpen", "VClose", "VSep",
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

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VSep", "VClose"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("allows a layout lambda body inside a physical delimiter", () => {
    const result = layout("map(values, x =>\n    inspect(x); transform(x)\n)\nprint(\"done\")");

    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VOpen", "VClose", "VSep", "VClose",
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
      "    match next(source)\n" +
      "        None => None\n" +
      "        Some((value, rest)) => Some((value, rest))\n" +
      "})",
    );

    // Module, lambda body, arm block; the two inner closes land before `})`.
    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VOpen", "VOpen", "VSep", "VClose", "VClose", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("keeps a record literal open across a statement block in a field value", () => {
    const result = layout(
      "Seq({ pull = () =>\n" +
      "    var current = source\n" +
      "    while searching\n" +
      "        current := rest\n" +
      "    current\n" +
      "})",
    );

    // Module, lambda body — separated statements — and the `while` body within.
    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VOpen", "VSep", "VOpen", "VClose", "VSep", "VClose", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  // §2.2's other half: the group's closer ends what its lines opened. Defect-log
  // finding 5 — these shapes parsed as if the `}` were the next match arm,
  // because the offside rule sees dedents and a trailing `})` is not one.
  test("closes a layout block at the delimiter that ends its group", () => {
    const result = layout(
      "let m =\n" +
      "    Seq({ pull = () => match next(source)\n" +
      "        None => None\n" +
      "        Some((v, r)) => Some((v, r)) })",
    );

    // The arm block's VClose lands on the `}`, before it — not after `})` at EOF.
    const closer = result.tokens.findIndex(({ kind }) => kind === "RightBrace");
    expect(result.tokens[closer - 1]?.kind).toBe("VClose");
    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VOpen", "VOpen", "VSep", "VClose", "VClose", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("closes a layout block at a `)` too — the group's kind is irrelevant", () => {
    const result = layout(
      "let m =\n" +
      "    f(() => match next(source)\n" +
      "        None => None\n" +
      "        Some((v, r)) => Some((v, r)))",
    );

    // Position, not just the multiset: without the rule the VCloses still all
    // appear, just after the `)` at EOF, which is what misparsed.
    const closer = result.tokens.findLastIndex(({ kind }) => kind === "RightParen");
    expect(result.tokens[closer - 1]?.kind).toBe("VClose");
    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VOpen", "VOpen", "VSep", "VClose", "VClose", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("one closer unwinds every block its group opened", () => {
    const result = layout(
      "let m =\n" +
      "    f(x => match a\n" +
      "        A => match b\n" +
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
      "    match x\n" +
      "        A => f({ y = 1 })\n" +
      "        B => 2",
    );

    // The `}` and `)` close nothing: the arm block predates the group, and `B`
    // still gets its VSep as a sibling arm.
    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VOpen", "VOpen", "VSep", "VClose", "VClose", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("closes a layout block at a `]`, and at a `}` reached through `]`", () => {
    const result = layout(
      "let m =\n" +
      "    [match p\n" +
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
    const result = layout("let m =\n    id([match p\n        True => 1)\n");

    const closer = result.tokens.findIndex(({ kind }) => kind === "RightParen");
    expect(result.tokens[closer - 1]?.kind).not.toBe("VClose");
    expect(virtualKinds(result.tokens).filter((kind) => kind === "VOpen"))
      .toHaveLength(virtualKinds(result.tokens).filter((kind) => kind === "VClose").length);
  });

  test("a trailing `;` before a group's closer is still diagnosed", () => {
    // The closer ends the block, so the `;` is trailing — §5 owes the diagnostic
    // whichever line the closer sits on. Both spellings must agree.
    const trailing = layout("let m =\n    id(match p\n        True => 1\n        False => 0;)");
    const dedented = layout("let m =\n    id(match p\n        True => 1\n        False => 0;\n    )");

    expect(trailing.diagnostics.map(({ message }) => message)).toEqual([
      "`;` separates statements; Hexagon lines don't end with one.",
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
      "    id(match p\n" +
      "        True => \"a${ 1 }b)\"\n" +
      "        False => \"}\")",
    );

    expect(result.diagnostics).toEqual([]);
    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VOpen", "VOpen", "VSep", "VClose", "VClose", "VClose",
    ]);
  });

  test("an unmatched closer closes no block", () => {
    const result = layout("let m =\n    match x\n        A => 1)\n");

    // One stray `)` must not unwind the arm block into a cascade of errors.
    const closer = result.tokens.findIndex(({ kind }) => kind === "RightParen");
    expect(result.tokens[closer - 1]?.kind).not.toBe("VClose");
    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VOpen", "VOpen", "VClose", "VClose", "VClose",
    ]);
  });

  test("validates semicolons as same-line block separators", () => {
    const result = layout("; let x = 1;; let y = (1; 2)\nlet z = 3;");

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      "`;` must have a statement on both sides.",
      "`;` must have a statement on both sides.",
      "`;` must have a statement on both sides.",
      "did you mean `,`? `;` only separates statements.",
      "`;` separates statements; Hexagon lines don't end with one.",
    ]);
  });

  test("retains a legal semicolon without adding a virtual separator", () => {
    const result = layout("let f = x => print(x); print(\"done\")");

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VClose"]);
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
    expect(kinds(empty.tokens)).toEqual(["VOpen", "VClose", "Eof"]);

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

  test("keeps virtual tokens balanced over bracket and indentation soup", () => {
    // `fc.string()` below is a good crash guard but almost never produces a block
    // head, a delimiter, and a dedent in one input — the combination the
    // group-closing rule works on. This generator does nothing else.
    const line = fc.tuple(
      fc.nat({ max: 3 }).map((depth) => " ".repeat(depth * 4)),
      fc.constantFrom(
        "match x", "f(", "g({ a = ", "h([", "x =>", "if p then", "while p",
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
          expect(token.span.end.offset).toBeLessThanOrEqual(text.length);
        }

        expect(depth).toBe(0);
        expect(result.tokens.at(-1)?.kind).toBe("Eof");
      }),
      { numRuns: 250 },
    );
  });
});

function layout(text: string): LaidOut.File {
  const source = new Source.File(Source.fileId(0), "test.hex", text);
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
