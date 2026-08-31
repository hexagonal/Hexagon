import fc from "fast-check";
import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import type * as Parsed from "../../syntax/parsed/index.js";
import { applyLayout } from "../layout/layout.js";
import { lex } from "../lexer/lexer.js";
import { parse } from "./parser.js";

describe("parse", () => {
  test("parses named, aliased, default, type-only, and effect extern declarations", () => {
    const module = parseSource(
      "extern from \"tiny-json\"\n" +
        "    export type JsonValue\n" +
        "    export fun parse(text: String): JsonValue\n" +
        "    let VERSION as version: String\n" +
        "    export default fun createClient(): JsonValue\n" +
        "extern import \"telemetry/register\"",
    );

    expect(module.items).toMatchObject([
      {
        kind: "ExternBlock",
        specifier: "tiny-json",
        declarations: [
          { kind: "ExternType", exported: true, localName: { text: "JsonValue" } },
          { kind: "ExternFun", exported: true, localName: { text: "parse" } },
          {
            kind: "ExternLet",
            foreignName: { text: "VERSION" },
            localName: { text: "version" },
          },
          { kind: "ExternFun", default: true, localName: { text: "createClient" } },
        ],
      },
      { kind: "ExternImport", specifier: "telemetry/register" },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  /**
   * Lexer §3.2's reserved `__` prefix is selected **by position** (#425): the
   * lexer emits the token, and the seat decides the message. Three seats, three
   * answers, all in one module so their ordering is visible.
   *
   * The foreign side of an FFI `as` alias is not a Hexagon name seat at all
   * (Part 4 §3.2) — `__internal` is a common JavaScript-library spelling and has
   * to stay bindable, or the export is unreachable from Hexagon. An *unaliased*
   * extern seat is both sides at once, and takes that part's alias rewrite: never
   * a rename of the foreign name, which would bind a different export. Anywhere
   * else the answer is §10's rename fix-it.
   */
  test("the reserved `__` prefix is decided by the seat the name sits in", () => {
    const module = parseSource(
      'extern from "vendor"\n' +
        "    export fun __internal as internal(): String\n" +
        "    export type __Handle as THandle\n" +
        "    let __state: Int\n" +
        "    export type __Raw\n" +
        "let __mine = 1",
    );

    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      // The two aliased foreign names are silent, and bind.
      "foreign term `__state` uses the reserved `__` prefix; " +
        "bind it with an alias: `let __state as state`",
      "foreign type `__Raw` uses the reserved `__` prefix; " +
        "bind it with an alias: `type __Raw as Raw`",
      "names beginning `__` are reserved for compiler-generated code",
    ]);
    expect(module.items[0]).toMatchObject({
      kind: "ExternBlock",
      declarations: [
        { kind: "ExternFun", foreignName: { text: "__internal" }, localName: { text: "internal" } },
        { kind: "ExternType", foreignName: { text: "__Handle" }, localName: { text: "THandle" } },
        // The two refused seats still parse — the repair is named, not guessed.
        { kind: "ExternLet", localName: { text: "__state" } },
        { kind: "ExternType", localName: { text: "__Raw" } },
      ],
    });
    // The rename fix-it strips one underscore, per §10's table row.
    const reserved = module.diagnostics.at(-1)!;
    expect(reserved.fixes?.[0]?.edits[0]?.replacement).toBe("_mine");
  });

  /**
   * The local side of `as` is an ordinary seat, so it takes the rename rather
   * than the exemption — the exemption is about where the *foreign* spelling
   * sits, not about the declaration form.
   */
  test("an extern alias's local side is an ordinary name seat", () => {
    const module = parseSource(
      'extern from "vendor"\n' +
        "    export fun ok as __shadow(): String",
    );

    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "names beginning `__` are reserved for compiler-generated code",
    ]);
  });

  test("uses extern-specific rewrites and rejects bodies", () => {
    const module = parseSource(
      "extern from \"broken\"\n" +
        "    let parse(text: String): String\n" +
        "    fun version: String\n" +
        "    let callback: String -> String\n" +
        "    default fun create as make(): String\n" +
        "    fun run(): Unit = ()",
    );
    const messages = module.diagnostics.map(({ message }) => message);

    expect(messages).toContain(
      "extern callable declarations use `fun`; write `fun parse(...)` with explicit parameters",
    );
    expect(messages).toContain(
      "extern `fun` declares a callable and requires a parameter list; for a foreign value, write `let version: Type`",
    );
    expect(messages).toContain(
      "extern callable declarations use `fun`; write `fun callback(...)` with explicit parameters",
    );
    expect(messages).toContain(
      "`as` aliases a foreign export name; a `default` binding has none — name the binding directly",
    );
    expect(messages).toContain("extern declarations have no bodies");
  });
  test("parses aliases, qualified types, and opaque nominal exports", () => {
    const module = parseSource(
      "export type Pair(a) = (a, a)\n" +
        "opaque record Token = {value: Int}\n" +
        "opaque union Handle = File(Int) | Socket(Int)\n" +
        "let value: Api.Pair(Int) = (1, 2)",
    );

    expect(module.items).toMatchObject([
      { kind: "TypeAlias", exported: true, name: { text: "Pair" }, parameters: [{ text: "a" }] },
      { kind: "RecordDeclaration", exported: true, opaque: true },
      { kind: "Union", exported: true, opaque: true },
      { kind: "Let", annotation: { kind: "AppliedType", qualifier: { text: "Api" }, constructor: { text: "Pair" } } },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("parses module items with the specified arithmetic precedence", () => {
    const module = parseSource("let answer = 1 + 2 * 3 ** 2\nprint(answer)");

    expect(module.items).toHaveLength(2);
    expect(module.items[0]).toMatchObject({
      kind: "Let",
      name: { text: "answer" },
      value: {
        kind: "Binary",
        operator: "Add",
        right: {
          kind: "Binary",
          operator: "Multiply",
          right: { kind: "Binary", operator: "Power" },
        },
      },
    });
    expect(module.items[1]).toMatchObject({
      kind: "ExprItem",
      expression: { kind: "Call", callee: { kind: "Name" } },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("normalizes function headers and explicit lambdas to Lambda expressions", () => {
    const module = parseSource(
      "let add(x, y) = x + y\nlet increment = x => x + 1\nlet unit = () => ()",
    );
    const bindings = module.items as readonly Parsed.LetItem[];

    expect(bindings[0]?.value).toMatchObject({
      kind: "Lambda",
      parameters: [{ name: { text: "x" } }, { name: { text: "y" } }],
      body: { kind: "Binary", operator: "Add" },
    });
    expect(bindings[1]?.value).toMatchObject({
      kind: "Lambda",
      parameters: [{ name: { text: "x" } }],
    });
    expect(bindings[2]?.value).toMatchObject({
      kind: "Lambda",
      parameters: [],
      body: { kind: "Unit" },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("parses primitive parameter and result annotations", () => {
    const module = parseSource(
      "export let plus(x:Int, y: Int): Int = x + y\n" +
        "let negate = (value: Float): Float => -value",
    );
    const bindings = module.items as readonly Parsed.LetItem[];

    expect(bindings[0]?.value).toMatchObject({
      kind: "Lambda",
      parameters: [
        { name: { text: "x" }, annotation: { name: { text: "Int" } } },
        { name: { text: "y" }, annotation: { name: { text: "Int" } } },
      ],
      returnAnnotation: { name: { text: "Int" } },
    });
    expect(bindings[1]?.value).toMatchObject({
      kind: "Lambda",
      parameters: [
        { name: { text: "value" }, annotation: { name: { text: "Float" } } },
      ],
      returnAnnotation: { name: { text: "Float" } },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("parses recursive fun headers, fused and blocked", () => {
    // *(#700.)* `fun` is header-only: the lambda right-hand side this test once
    // read is a parse error, and the second spelling here is the block.
    const module = parseSource(
      "export fun fact(n: Int): Int = if n <= 1 then 1 else n * fact(n - 1)\n" +
        "fun\n    loop(value) = loop(value)\n",
    );

    expect(module.items).toMatchObject([
      {
        kind: "Fun",
        exported: true,
        name: { text: "fact" },
        value: {
          kind: "Lambda",
          parameters: [
            { name: { text: "n" }, annotation: { name: { text: "Int" } } },
          ],
          returnAnnotation: { name: { text: "Int" } },
        },
      },
      {
        kind: "Fun",
        exported: false,
        name: { text: "loop" },
        value: { kind: "Lambda", parameters: [{ name: { text: "value" } }] },
      },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("rejects every `fun name =` right-hand side and recovers at the next item", () => {
    // *(#700.)* There is no `fun name =` production at all; each retired
    // spelling carries its own mechanical rewrite (Functions §10).
    const module = parseSource("fun answer = 42\nlet good = 1");

    expect(module.items).toMatchObject([
      { kind: "ErrorItem" },
      { kind: "Let", name: { text: "good" } },
    ]);
    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "`fun` defines functions by header; write `fun answer(params) = …`, or bind the " +
        "value with `let`",
    ]);

    expect(
      parseSource("fun loop = value => loop(value)").diagnostics.map(({ message }) => message),
    ).toEqual([
      "`fun` defines functions by header; write `fun loop(value) = …`",
    ]);
  });

  test("recovers locally from a non-uppercase-start primitive annotation", () => {
    const module = parseSource("let bad(x: int) = x\nlet good = 1");

    expect(module.items).toMatchObject([
      {
        kind: "Let",
        name: { text: "bad" },
        value: { kind: "Lambda", parameters: [{ name: { text: "x" } }] },
      },
      { kind: "Let", name: { text: "good" } },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("distinguishes tuple literals and types from grouping and parameters", () => {
    const module = parseSource(
      "let pair = (1, \"one\")\n" +
        "let grouped = (1)\n" +
        "let second(value: (String, Int)): Int = value.item2",
    );

    expect(module.items).toMatchObject([
      { kind: "Let", value: { kind: "Tuple", elements: [{ kind: "Integer" }, { kind: "String" }] } },
      { kind: "Let", value: { kind: "Group", expression: { kind: "Integer" } } },
      {
        kind: "Let",
        value: {
          kind: "Lambda",
          parameters: [{ annotation: { kind: "Tuple", elements: [{ kind: "NamedType" }, { kind: "NamedType" }] } }],
          returnAnnotation: { kind: "NamedType" },
          body: { kind: "Access", field: { text: "item2" } },
        },
      },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("parses tuple patterns as let binders", () => {
    const module = parseSource("let (name, _, (x, y)) = (\"point\", True, (3, 4))");

    expect(module.items).toMatchObject([
      {
        kind: "LetPattern",
        pattern: {
          kind: "Tuple",
          elements: [
            { kind: "Binding", name: { text: "name" } },
            { kind: "Wildcard" },
            {
              kind: "Tuple",
              elements: [
                { kind: "Binding", name: { text: "x" } },
                { kind: "Binding", name: { text: "y" } },
              ],
            },
          ],
        },
      },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  /**
   * `let` is one of Pattern Matching §1's five positions, and the vector pattern
   * is an ordinary form of the one grammar (Collections Part 3 §3), so `[` opens
   * a pattern binding exactly as `(` and `{` do. Before #603 it did not, and both
   * of Collections Part 3 §3.4's worked examples — the legal one included — died
   * at "`let` requires a non-uppercase-start name" before any judgment could be
   * drawn. Refutability is the checker's question, not the parser's, so both
   * parse here.
   */
  test("parses vector patterns as let binders", () => {
    const module = parseSource(
      "let [...all] = xs\nlet [x, ...rest] = xs\nlet [...] = xs",
    );

    expect(module.items).toMatchObject([
      {
        kind: "LetPattern",
        pattern: {
          kind: "Vector",
          elements: [],
          rest: { pattern: { kind: "Binding", name: { text: "all" } } },
        },
      },
      {
        kind: "LetPattern",
        pattern: {
          kind: "Vector",
          elements: [{ kind: "Binding", name: { text: "x" } }],
          rest: { pattern: { kind: "Binding", name: { text: "rest" } } },
        },
      },
      {
        kind: "LetPattern",
        pattern: { kind: "Vector", elements: [], rest: { index: 0 } },
      },
    ]);
    // The anonymous rest carries no sub-pattern: it binds nothing (§3.1).
    const anonymous = module.items[2];
    expect(
      anonymous?.kind === "LetPattern" && anonymous.pattern.kind === "Vector"
        ? anonymous.pattern.rest?.pattern
        : "not a vector let pattern",
    ).toBeUndefined();
    expect(module.diagnostics).toEqual([]);
  });

  test("parses nullary unions and match expressions", () => {
    const module = parseSource(
      "union Suit =\n" +
        "    | Clubs\n    | Diamonds\n    | Hearts\n    | Spades\n" +
        "let color(suit: Suit): String = match suit\n" +
        '    Clubs => "black"\n    Diamonds => "red"\n' +
        '    Hearts => "red"\n    Spades => "black"',
    );

    expect(module.items).toMatchObject([
      {
        kind: "Union",
        name: { text: "Suit" },
        constructors: [
          { name: { text: "Clubs" } },
          { name: { text: "Diamonds" } },
          { name: { text: "Hearts" } },
          { name: { text: "Spades" } },
        ],
      },
      {
        kind: "Let",
        value: {
          kind: "Lambda",
          body: {
            kind: "Match",
            arms: [
              { pattern: { kind: "Constructor", name: { text: "Clubs" } } },
              { pattern: { kind: "Constructor", name: { text: "Diamonds" } } },
              { pattern: { kind: "Constructor", name: { text: "Hearts" } } },
              { pattern: { kind: "Constructor", name: { text: "Spades" } } },
            ],
          },
        },
      },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("records module-level exported let bindings", () => {
    const module = parseSource("export let answer = 42\nlet privateValue = 1");

    expect(module.items).toMatchObject([
      { kind: "Let", exported: true, name: { text: "answer" } },
      { kind: "Let", exported: false, name: { text: "privateValue" } },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  /**
   * The seat where #595 was read: the lexer's keyword table inherited
   * `Object.prototype`, so `toString` never reached the binder as a name and
   * `let` reported a name it had been given correctly. The repair is the
   * lexer's; this is the message that must never come back.
   */
  test("a binder spelled like an `Object.prototype` member is an ordinary name", () => {
    const module = parseSource("export let toString: Int = 3\nlet valueOf = toString");

    expect(module.items).toMatchObject([
      { kind: "Let", exported: true, name: { text: "toString" } },
      { kind: "Let", exported: false, name: { text: "valueOf" } },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("freely interleaves access, calls, and indexing", () => {
    const module = parseSource("users.at(1).profile.names[2]");

    expect(expression(module)).toMatchObject({
      kind: "Index",
      receiver: {
        kind: "Access",
        field: { text: "names" },
        receiver: {
          kind: "Access",
          field: { text: "profile" },
          receiver: { kind: "Call" },
        },
      },
      index: { kind: "Integer", decimal: "2" },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("puts exponentiation above unary minus and comparisons above not", () => {
    const module = parseSource("let number = -2 ** 2\nlet flag = not a == b and c");
    const bindings = module.items as readonly Parsed.LetItem[];

    expect(bindings[0]?.value).toMatchObject({
      kind: "Unary",
      operator: "Negate",
      operand: { kind: "Binary", operator: "Power" },
    });
    expect(bindings[1]?.value).toMatchObject({
      kind: "Binary",
      operator: "And",
      left: {
        kind: "Unary",
        operator: "Not",
        operand: { kind: "Comparison", operators: ["Equal"] },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("preserves comparison chains and rejects non-associative chains", () => {
    const module = parseSource("a < middle <= z\n1..2..3\nx := y := z");

    expect(expression(module)).toMatchObject({
      kind: "Comparison",
      operands: [{ kind: "Name" }, { kind: "Name" }, { kind: "Name" }],
      operators: ["Less", "LessEqual"],
    });
    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "`..` does not chain; write separate ranges",
      "`:=` does not chain; assignment produces `Unit`",
    ]);
  });

  test("parses inline and multiline conditionals with nested blocks", () => {
    const module = parseSource(
      "let choose = if ready then yes else no\n" +
      "let act(x) =\n" +
      "    if x then\n" +
      "        print(x)\n" +
      "    else\n" +
      "        print(0)\n" +
      "    x",
    );
    const bindings = module.items as readonly Parsed.LetItem[];

    expect(bindings[0]?.value).toMatchObject({
      kind: "If",
      consequence: { kind: "Name" },
      alternative: { kind: "Name" },
    });
    expect(bindings[1]?.value).toMatchObject({
      kind: "Lambda",
      body: {
        kind: "Block",
        items: [
          {
            kind: "ExprItem",
            expression: {
              kind: "If",
              consequence: { kind: "Block" },
              alternative: { kind: "Block" },
            },
          },
          { kind: "ExprItem", expression: { kind: "Name" } },
        ],
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("rejects the former layout conditional without then", () => {
    const module = parseSource(
      "let choose =\n" +
        "    if ready\n" +
        "        yes\n" +
        "    else\n" +
        "        no",
    );

    expect(module.diagnostics.map(({ message }) => message)).toContain(
      "`if` requires `then`; write `if condition then` before the indented true branch",
    );
  });

  test("accepts an else-less conditional as `else ()` sugar", () => {
    const module = parseSource(
      "let act(ready: Bool) =\n" +
        "    if ready then\n" +
        "        print(\"ready\")",
    );

    expect(module.diagnostics).toEqual([]);
    expect(module.items[0]).toMatchObject({
      kind: "Let",
      value: {
        kind: "Lambda",
        body: {
          kind: "Block",
          items: [
            {
              kind: "ExprItem",
              expression: {
                kind: "If",
                consequence: { kind: "Block" },
                alternative: { kind: "Unit" },
                elseless: true,
              },
            },
          ],
        },
      },
    });
  });

  test("dangling else binds to the inner conditional (Operators §11.2)", () => {
    // `if c1 then if c2 then a else b`: the inner `if` claims the `else`
    // (eats-to-the-right); the outer becomes the `else ()` sugar. Pinned so a
    // parser refactor cannot silently flip the binding.
    const module = parseSource("let pick(c1: Bool, c2: Bool) = if c1 then if c2 then 1 else 2");

    expect(module.diagnostics).toEqual([]);
    expect(module.items[0]).toMatchObject({
      kind: "Let",
      value: {
        kind: "Lambda",
        body: {
          kind: "If",
          elseless: true,
          alternative: { kind: "Unit" },
          consequence: {
            kind: "If",
            elseless: false,
            consequence: { kind: "Integer" },
            alternative: { kind: "Integer" },
          },
        },
      },
    });
  });

  test("an else-if chain may omit the final else", () => {
    // `if a then x else if b then y` nests as
    // `if a then x else (if b then y else ())`: only the innermost
    // conditional is else-less.
    const module = parseSource(
      "let act(a: Bool, b: Bool) =\n" +
        "    if a then log(\"x\") else if b then log(\"y\")",
    );

    expect(module.diagnostics).toEqual([]);
    expect(module.items[0]).toMatchObject({
      kind: "Let",
      value: {
        kind: "Lambda",
        body: {
          kind: "Block",
          items: [
            {
              kind: "ExprItem",
              expression: {
                kind: "If",
                elseless: false,
                alternative: {
                  kind: "If",
                  elseless: true,
                  alternative: { kind: "Unit" },
                },
              },
            },
          ],
        },
      },
    });
  });

  test("parses the canonical multiline conditional", () => {
    const module = parseSource(
      "fun fact(n: Int): Int =\n" +
        "    if n <= 1 then\n" +
        "        1\n" +
        "    else\n" +
        "        n * fact(n - 1)",
    );

    expect(module.items[0]).toMatchObject({
      kind: "Fun",
      value: {
        kind: "Lambda",
        body: {
          kind: "Block",
          items: [
            {
              kind: "ExprItem",
              expression: {
                kind: "If",
                condition: {
                  kind: "Comparison",
                  operators: ["LessEqual"],
                },
                consequence: { kind: "Block" },
                alternative: { kind: "Block" },
              },
            },
          ],
        },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("parses expressions nested inside string interpolation", () => {
    const module = parseSource('"Hello, ${user.profile}!"');

    expect(expression(module)).toMatchObject({
      kind: "String",
      parts: [
        { kind: "Text", value: "Hello, " },
        {
          kind: "Interpolation",
          expression: {
            kind: "Access",
            receiver: { kind: "Name" },
            field: { text: "profile" },
          },
        },
        { kind: "Text", value: "!" },
      ],
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("parses mutable bindings, inclusive ranges, and while blocks", () => {
    const module = parseSource(
      "fun countdown(start: Int) =\n" +
        "    var current: Int = start\n" +
        "    let bounds = 1..current\n" +
        "    while current > 0\n" +
        "        current := current - 1\n" +
        "    bounds",
    );

    expect(module.items[0]).toMatchObject({
      kind: "Fun",
      value: {
        body: {
          kind: "Block",
          items: [
            { kind: "Var", name: { text: "current" } },
            { kind: "Let", value: { kind: "Binary", operator: "Range" } },
            {
              kind: "ExprItem",
              expression: {
                kind: "While",
                body: {
                  items: [{ expression: { kind: "Assignment" } }],
                },
              },
            },
            { kind: "ExprItem", expression: { kind: "Name" } },
          ],
        },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("parses for loops over ranges and strings", () => {
    const module = parseSource(
      "fun visit(): Unit =\n" +
        "    for number in 1..3\n" +
        "        log(\"${number}\")\n" +
        "    for character in \"ab\"\n" +
        "        log(character)",
    );

    expect(module.items[0]).toMatchObject({
      kind: "Fun",
      value: {
        body: {
          items: [
            {
              expression: {
                kind: "For",
                pattern: { kind: "Binding", name: { text: "number" } },
                iterable: { kind: "Binary", operator: "Range" },
              },
            },
            {
              expression: {
                kind: "For",
                pattern: { kind: "Binding", name: { text: "character" } },
                iterable: { kind: "String" },
              },
            },
          ],
        },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("recovers at layout separators and parses later items", () => {
    const module = parseSource(
      "record Point = {x: Int}\nlet = 1\nlet good = 2",
    );

    expect(module.items.map(({ kind }) => kind)).toEqual([
      "RecordDeclaration",
      "ErrorItem",
      "Let",
    ]);
    expect(module.items[2]).toMatchObject({ kind: "Let", name: { text: "good" } });
    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "`let` requires a non-uppercase-start name",
    ]);
  });

  test("parses implied type declarations and instance bindings", () => {
    const module = parseSource(
      "constraint Source<a> =\n" +
        "    type Item\n" +
        "    get(value: a): Item\n" +
        "honor Source<Int> =\n" +
        "    type Item = String\n" +
        '    get(value) = "${value}"',
    );

    expect(module.items).toMatchObject([
      {
        kind: "ConstraintDeclaration",
        impliedTypes: [{ name: { text: "Item" } }],
        members: [{ name: { text: "get" }, returnAnnotation: { name: { text: "Item" } } }],
      },
      {
        kind: "Honor",
        impliedTypes: [{ name: { text: "Item" }, annotation: { name: { text: "String" } } }],
      },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("parses defaults, derives headers, and parameterized honors", () => {
    const module = parseSource(
      "constraint Same<a> =\n" +
        "    same(left: a, right: a): Bool\n" +
        "    different(left: a, right: a): Bool = not same(left, right)\n" +
        "record Box(a) derives (Eq, Show) = {value: a}\n" +
        "honor<a: Eq> Eq<Box(a)> = derive",
    );

    expect(module.items).toMatchObject([
      {
        kind: "ConstraintDeclaration",
        members: [{}, { defaultValue: { kind: "Lambda" } }],
      },
      {
        kind: "RecordDeclaration",
        derives: [{ text: "Eq" }, { text: "Show" }],
      },
      {
        kind: "Honor",
        derived: true,
        typeParameters: [{ name: { text: "a" }, constraints: [{ text: "Eq" }] }],
      },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("parses explicit function types with zero, one, and many parameters", () => {
    const module = parseSource(
      "type Nullary = () -> String\n" +
        "type Unary = Int -> String\n" +
        "type Binary = (Int, String) -> Bool\n" +
        "type TupleUnary = ((Int, String)) -> Bool\n" +
        "type Higher = (Int -> String) -> Bool\n" +
        "type Chain = Int -> String -> Bool",
    );

    expect(module.items).toMatchObject([
      {
        kind: "TypeAlias",
        annotation: { kind: "Function", parameters: [], result: { kind: "NamedType", name: { text: "String" } } },
      },
      {
        kind: "TypeAlias",
        annotation: { kind: "Function", parameters: [{ kind: "NamedType", name: { text: "Int" } }] },
      },
      {
        kind: "TypeAlias",
        annotation: { kind: "Function", parameters: [{ kind: "NamedType" }, { kind: "NamedType" }] },
      },
      {
        kind: "TypeAlias",
        annotation: { kind: "Function", parameters: [{ kind: "Tuple", elements: [{}, {}] }] },
      },
      {
        kind: "TypeAlias",
        annotation: { kind: "Function", parameters: [{ kind: "Function" }] },
      },
      {
        kind: "TypeAlias",
        annotation: { kind: "Function", result: { kind: "Function" } },
      },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("redirects a bare `()` in type position to `Unit`", () => {
    // Products §6 (#159): `()` is not a type expression; its only type-syntax
    // role is the zero-parameter domain of a function type.
    const module = parseSource("type Wrong = ()");

    expect(module.diagnostics.map(({ message }) => message)).toContain(
      "the empty tuple's type is written `Unit`; `()` in type syntax is only " +
        "the zero-parameter domain `() -> T`",
    );
  });

  test("accepts function types in lambda annotations and layout continuations", () => {
    const module = parseSource(
      "type Callback =\n" +
        "    Int ->\n" +
        "        String\n" +
        "let keep = (callback: Int -> String): Int -> String => callback",
    );

    expect(module.items).toMatchObject([
      { kind: "TypeAlias", annotation: { kind: "Function" } },
      {
        kind: "Let",
        value: {
          kind: "Lambda",
          parameters: [{ annotation: { kind: "Function" } }],
          returnAnnotation: { kind: "Function" },
        },
      },
    ]);
    expect(module.diagnostics).toEqual([]);
  });

  test("parses guarded catch arms and reserves finally with one targeted error", () => {
    const module = parseSource(
      "exception Wrapped(value: Int)\n" +
        "let result = try\n" +
        "    throw(Wrapped(1))\n" +
        "catch\n" +
        "    Wrapped(value) when value > 0 => value\n" +
        "    _ => 0\n" +
        "finally\n" +
        "    cleanup()",
    );

    expect(module.items).toMatchObject([
      { kind: "Exception" },
      {
        kind: "Let",
        value: {
          kind: "Try",
          arms: [
            { pattern: { kind: "Constructor" }, guard: { kind: "Comparison" } },
            { pattern: { kind: "Wildcard" } },
          ],
        },
      },
    ]);
    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "Hexagon has no `finally`; resources are scoped with `use`",
    ]);
  });

  test("uses representation-specific diagnostics for reserved exception fields", () => {
    const module = parseSource(
      "exception Named(name: String)\n" +
        "exception Stacked(stack: String)",
    );

    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "`name` is reserved as the exception's discriminant field; rename this field",
      "`stack` is reserved for the exception's stack trace; rename this field",
    ]);
  });

  test("recovers from arbitrary text with bounded public spans", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const module = parseSource(text);

        expect(module.span.start.offset).toBeGreaterThanOrEqual(0);
        expect(module.span.end.offset).toBeLessThanOrEqual(text.length);
        for (const diagnostic of module.diagnostics) {
          expect(diagnostic.primary.start.offset).toBeGreaterThanOrEqual(0);
          expect(diagnostic.primary.end.offset).toBeLessThanOrEqual(text.length);
        }
      }),
      { numRuns: 250 },
    );
  });

  // Products §3.1/§6/§8, Pattern Matching §2.4/§12/§16: term-position record fields
  // bind with `=`; `:` stays the type-position separator.
  describe("term-position record fields bind with `=`", () => {
    test("literals, update spreads, and patterns take `=`, and types keep `:`", () => {
      const module = parseSource(
        "record Point = {x: Float, y: Float}\n" +
          "let p = {x = 1.0, y = 2.0}\n" +
          "let q = {p with x = 3.0}\n" +
          "fun getX(r: {x: Float, ...}): Float = r.x\n" +
          "let {x = first} = p\n",
      );

      expect(module.diagnostics).toEqual([]);
    });

    test("punning still needs no separator in either position", () => {
      const module = parseSource("let x = 1\nlet r = {x}\nlet {x} = r\n");

      expect(module.diagnostics).toEqual([]);
    });

    test("`:` in a literal is a parse error naming the `=` fixit", () => {
      const module = parseSource("let p = {x: 1}");

      expect(module.diagnostics).toMatchObject([
        { severity: "error", message: "record fields bind with `=`: `{x = …}`; `:` gives a field its type in record types" },
      ]);
    });

    test("`:` in a pattern reports once and still parses the sub-pattern", () => {
      const module = parseSource("let {name: n} = user");

      expect(module.diagnostics).toHaveLength(1);
      expect(module.diagnostics[0]?.message).toContain("record fields bind with `=`");
    });

    test("an uppercase-start value in a pattern adds the annotate-outside hint (F4)", () => {
      const module = parseSource("let {x: Float} = p");

      expect(module.diagnostics[0]?.message).toContain(
        "if you meant a type, patterns destructure values — annotate outside the pattern",
      );
    });

    test("the annotate-outside hint is pattern-only, not offered for literals", () => {
      const module = parseSource("let p = {x: Float}");

      expect(module.diagnostics[0]?.message).not.toContain("annotate outside the pattern");
    });

    test("`:=` in a literal gets its own fixit", () => {
      const module = parseSource("let p = {x := 1}");

      expect(module.diagnostics).toMatchObject([
        { severity: "error", message: "did you mean `=`? `:=` assigns to a `var`" },
      ]);
    });

    test("`=>` in a literal gets the hash-rocket fixit", () => {
      const module = parseSource("let p = {x => 1}");

      expect(module.diagnostics).toMatchObject([
        {
          severity: "error",
          message: "did you mean `=`? `=>` is the lambda arrow — a lambda-valued field is `{x = arg => …}`",
        },
      ]);
    });

    test("a near-miss separator yields exactly one diagnostic per field", () => {
      const module = parseSource("let p = {x: 1, y: 2, z: 3}");

      expect(module.diagnostics).toHaveLength(3);
    });
  });

  // Effects §2/§9 (#410): `=>` is a term arrow only, so a fat arrow where a type
  // arrow belongs gets the family's targeted redirect rather than a parse cascade.
  describe("the type-position `=>` redirect", () => {
    const message = "Hexagon's type arrows are `->`, `->?`, `->!`; `=>` is the lambda arrow — " +
      "for a function type write `Int -> Int` (or `->?` / `->!` for its colour)";

    test("fires in every type slot whose `=>` can have no other reading", () => {
      // One source per slot, so a slot that stops opting in shows up as a
      // missing message rather than as a shorter cascade somewhere else.
      const slots = [
        "type H = (Int) => Int", // alias right-hand side
        "record R = {f: (Int) => Int}", // record declaration field
        "type R = {f: (Int) => Int}", // record type field
        "union U = C((Int) => Int)", // union constructor slot
        "exception E(f: (Int) => Int)", // exception payload slot
        "let f(g: (Int) => Int): Int = g(1)", // parameter annotation
        "let f = (g: (Int) => Int) => g(1)", // lambda parameter annotation
        'extern from "m"\n    fun g(x: Int): (Int) => Int\n', // extern row result
        'extern from "m"\n    fun g(x: (Int) => Int): Int\n', // extern row parameter
        "type H = ((Int) => Int, Int)", // nested inside a tuple type
        "type H = Box((Int) => Int)", // nested inside a type argument
        "type H = () => Int", // the zero-parameter domain, not the `()` redirect
      ];

      expect(slots.map((text) => parseSource(text).diagnostics.map(({ message: m }) => m)))
        .toEqual(slots.map(() => [message]));
    });

    test("resolves the arrow and retains it, so the annotation still parses", () => {
      const module = parseSource("type H = (Int) => Int");

      expect(module.items).toMatchObject([
        { kind: "TypeAlias", annotation: { kind: "Function", result: { kind: "NamedType" } } },
      ]);
      expect(module.diagnostics).toMatchObject([
        {
          severity: "error",
          message,
          fixes: [{ message: "write `->`", edits: [{ replacement: "->" }] }],
        },
      ]);
    });

    test("`=>!`, the retired impure spelling, resolves to `->!` over both its tokens", () => {
      const module = parseSource("type H = (Int) =>! Int");
      const [diagnostic] = module.diagnostics;

      expect(module.items).toMatchObject([
        { kind: "TypeAlias", annotation: { kind: "Function", effect: "constant" } },
      ]);
      expect(diagnostic?.message).toBe(message);
      expect(diagnostic?.fixes).toMatchObject([
        { message: "write `->!`", edits: [{ replacement: "->!" }] },
      ]);
      // The fixit covers `=>!` entire — both tokens — not the fat arrow alone.
      expect(diagnostic?.fixes?.[0]?.edits[0]?.span).toMatchObject({
        start: { offset: 15 },
        end: { offset: 18 },
      });
    });

    test("an unglued `!` is not the retired spelling", () => {
      // `=>!` is two tokens (Lexer §8.1), so only adjacency distinguishes it
      // from a fat arrow followed by whatever a stray `!` starts.
      const module = parseSource("type H = (Int) => ! Int");

      expect(module.diagnostics[0]?.fixes).toMatchObject([{ message: "write `->`" }]);
    });

    test("stays silent in a lambda's return annotation, where the `=>` is the body's", () => {
      // Effects §2.6's own pair. The redirect must not reach this slot: the
      // annotation is complete and the fat arrow after it belongs to the body.
      const module = parseSource(
        "let f = (x): a => y => x\n" +
          "let k = (x: Int): (Int) -> Int => (y: Int) => x\n",
      );

      expect(module.items).toMatchObject([
        { kind: "Let", value: { kind: "Lambda", returnAnnotation: { kind: "TypeVariable" } } },
        { kind: "Let", value: { kind: "Lambda", returnAnnotation: { kind: "Function" } } },
      ]);
      expect(module.diagnostics).toEqual([]);
    });

    test("stays silent in a `let`/`var` annotation, where the `=>` competes with `=`", () => {
      const module = parseSource("let f(x: Int): Int => x");

      expect(module.diagnostics.map(({ message: m }) => m)).toEqual([
        "expected `=` in `let` binding",
      ]);
    });
  });

  // Products §3.3/§6/§9: functional update is `{p with x = e}`; `{...p}` stays the bare
  // copy; the retired spread idioms keep permanent fixits.
  describe("functional update `{p with x = e}`", () => {
    test("parses the update, its dotted heads, and its punning composition", () => {
      const module = parseSource(
        "let a = {p with x = 3.0}\n" +
          'let b = {settings with port = 8080, host = "::1"}\n' +
          "let c = {p.position with x = 3.0}\n" +
          "let d = {Config.default with port = 8080}\n" +
          "let e = {p with x}\n",
      );

      expect(module.diagnostics).toEqual([]);
    });

    test("the head becomes the emitted spread, so copy and update share one node", () => {
      const update = expression(parseSource("{p with x = 3.0}"));
      const copy = expression(parseSource("{...p}"));

      expect(update).toMatchObject({
        kind: "Record",
        spread: { kind: "Name", name: { text: "p" } },
        fields: [{ name: { text: "x" }, punned: false }],
      });
      expect(copy).toMatchObject({ kind: "Record", spread: { kind: "Name" }, fields: [] });
    });

    test("`{p with x}` expands to `{p with x = x}` through ordinary punning", () => {
      expect(expression(parseSource("{p with x}"))).toMatchObject({
        fields: [{ name: { text: "x" }, punned: true, value: { kind: "Name", name: { text: "x" } } }],
      });
    });

    // Products §3.3/§9.3: `with` is contextual, not reserved — the ES2023
    // `Array.prototype.with` case depends on it staying an ordinary name.
    test("`with` stays an ordinary name in every position that is not an update", () => {
      const module = parseSource(
        "let with = 3\n" +
          "let field = {with = 3}\n" +
          "let punned = {with}\n" +
          "let value = {x = with}\n" +
          "let trailing = {a = 1, with}\n",
      );

      expect(module.diagnostics).toEqual([]);
      expect(expression(parseSource("{with = 3}"))).toMatchObject({
        kind: "Record",
        fields: [{ name: { text: "with" }, punned: false }],
      });
    });

    test("a head named `with` still parses as an update", () => {
      const module = parseSource("let q = {with with x = 3}");

      expect(module.diagnostics).toEqual([]);
      expect(expression(parseSource("{with with x = 3}"))).toMatchObject({
        kind: "Record",
        spread: { kind: "Name", name: { text: "with" } },
        fields: [{ name: { text: "x" } }],
      });
    });

    test("a nested update's `with` belongs to its own brace", () => {
      const module = parseSource(
        "let a = {outer = {p with x = 1}, z = 2}\n" +
          "let b = {p with x = {inner with y = 1}}\n",
      );

      expect(module.diagnostics).toEqual([]);
    });

    test("spread-spelled update keeps its permanent fixit and parses on", () => {
      const module = parseSource("let q = {...p, x = 3.0}");

      expect(module.diagnostics).toMatchObject([
        {
          severity: "error",
          message: "records update with `with`: `{p with x = 3.0}`; `{...p}` alone is the copy/crossing",
        },
      ]);
      expect(expression(parseSource("{...p, x = 3.0}"))).toMatchObject({
        kind: "Record",
        spread: { kind: "Name", name: { text: "p" } },
        fields: [{ name: { text: "x" } }],
      });
    });

    test("a late spread is the same habit and the same fixit", () => {
      const module = parseSource("let q = {x = 1, ...b}");

      expect(module.diagnostics).toMatchObject([
        { message: "records update with `with`: `{p with x = 3.0}`; `{...p}` alone is the copy/crossing" },
      ]);
    });

    test("`{...a, ...b}` gets the merge fixit, once, however many spreads follow", () => {
      expect(parseSource("let q = {...a, ...b}").diagnostics).toMatchObject([
        {
          severity: "error",
          message: "Hexagon has no record merge; `{...p}` copies, `{p with f = e}` updates",
        },
      ]);
      expect(parseSource("let q = {...a, ...b, ...c}").diagnostics).toHaveLength(1);
    });

    test("a non-path head names the fixit and still parses its overrides", () => {
      const module = parseSource("let q = {f(x) with y = 3}");

      expect(module.diagnostics).toMatchObject([
        {
          severity: "error",
          message: "a record update head must be a name or a dotted path; bind the base first: `let base = f(x)`",
        },
      ]);
      expect(expression(parseSource("{f(x) with y = 3}"))).toMatchObject({
        kind: "Record",
        fields: [{ name: { text: "y" } }],
      });
    });

    test("an empty override list points at the bare copy", () => {
      const module = parseSource("let q = {p with}");

      expect(module.diagnostics).toMatchObject([
        {
          severity: "error",
          message: "a record update needs at least one override; the no-override copy is `{...p}`",
        },
      ]);
    });

    test("the bare copy stays exactly what it was", () => {
      expect(parseSource("let q = {...p}").diagnostics).toEqual([]);
    });
  });

  // Functions §4.2, issue #65: `let f = <a: Num>(x: a): a => …` is "equivalent, same AST
  // node" as the header form `let f<a: Num>(x: a): a = …`.
  describe("type-parameter lambdas", () => {
    test("build the same node the header form builds", () => {
      const lambda = parseSource("let plus = <a: Num>(x: a, y: a): a => x + y");
      const header = parseSource("let plus<a: Num>(x: a, y: a): a = x + y");
      const shape = {
        kind: "Let",
        name: { text: "plus" },
        value: {
          kind: "Lambda",
          typeParameters: [{ name: { text: "a" }, constraints: [{ text: "Num" }] }],
          parameters: [{ name: { text: "x" } }, { name: { text: "y" } }],
          returnAnnotation: { kind: "TypeVariable", name: { text: "a" } },
          body: { kind: "Binary", operator: "Add" },
        },
      };

      expect(lambda.items).toMatchObject([shape]);
      expect(header.items).toMatchObject([shape]);
      expect(lambda.diagnostics).toEqual([]);
      expect(header.diagnostics).toEqual([]);
    });

    test("accept bare, multiple, and parenthesized-list binders", () => {
      const module = parseSource(
        "let id = <a>(x: a): a => x\n" +
          "let pair = <a, b>(x: a, y: b): (a, b) => (x, y)\n" +
          "let both = <a: (Eq, Show)>(x: a): a => x\n" +
          "let inferred = <a>(x: a) => x\n",
      );

      expect(module.diagnostics).toEqual([]);
      expect(module.items).toMatchObject([
        { value: { typeParameters: [{ constraints: [] }] } },
        { value: { typeParameters: [{ name: { text: "a" } }, { name: { text: "b" } }] } },
        {
          value: {
            typeParameters: [{ constraints: [{ text: "Eq" }, { text: "Show" }] }],
          },
        },
        { value: { typeParameters: [{ name: { text: "a" } }] } },
      ]);
    });

    test("are refused on a `fun` right-hand side, which no longer exists", () => {
      // *(#700.)* The position restriction now admits the `fun` **header** and
      // the block head; the right-hand side it once admitted is retired, and the
      // header rewrite is what the author is handed — once, not twice.
      expect(
        parseSource("fun id = <a>(x: a): a => x").diagnostics.map(({ message }) => message),
      ).toEqual(["`fun` defines functions by header; write `fun id(x) = …`"]);
      expect(parseSource("fun id<a>(x: a): a = x").diagnostics).toEqual([]);
      expect(parseSource("fun<a>\n    id(x: a): a = x\n").diagnostics).toEqual([]);
    });

    test("are accepted when the right-hand side is written on its own line", () => {
      const module = parseSource("let plus =\n    <a: Num>(x: a, y: a): a => x + y");

      expect(module.diagnostics).toEqual([]);
    });

    // Parentheses are pure grouping, so a parenthesized right-hand side is the same
    // right-hand side and raises no question about what `<a>` scopes over.
    test("are accepted when the right-hand side is parenthesized", () => {
      const wrapped = [
        "let f = (<a>(x: a): a => x)",
        "let f = ((<a>(x: a): a => x))",
        "let f =\n    (<a>(x: a): a => x)",
      ];

      for (const source of wrapped) {
        expect(parseSource(source).diagnostics).toEqual([]);
      }
    });

    // Functions §4.2's position restriction — what keeps rank-2 types inexpressible.
    test("are a parse error anywhere but a `let`/`fun` right-hand side", () => {
      const misplaced = [
        "let r = apply(<a>(x: a) => x, 1)",
        "let r = if c then <a>(x: a) => x else g",
        "let r = {f = <a>(x: a) => x}",
        "let r = [<a>(x: a) => x]",
        "<a>(x: a) => x",
        "fun f() =\n    var g = <a>(x: a) => x\n    g",
        // The result of a header-form function, not its right-hand side: the rank-2
        // return the position restriction exists to keep inexpressible. Parenthesizing
        // it does not make it a right-hand side either.
        "fun f() = <a>(x: a): a => x",
        "fun f() = (<a>(x: a): a => x)",
        // Immediately applied: the binding's value is the call, not the lambda.
        "let r = (<a>(x: a): a => x)(1)",
      ];

      for (const source of misplaced) {
        expect(parseSource(source).diagnostics).toContainEqual(
          expect.objectContaining({
            severity: "error",
            message:
              "`<...>` type parameters are permitted only on a lambda bound by `let` or `fun`; " +
              "bind this lambda to a name first",
          }),
        );
      }
    });

    test("a multi-item block is the block's result, not the binding's right-hand side", () => {
      const module = parseSource("let g =\n    let n = 1\n    <a>(x: a): a => x");

      expect(module.diagnostics).toMatchObject([
        { message: expect.stringContaining("`<...>` type parameters are permitted only") },
      ]);
    });

    test("a leading `<` that is not a binder list still reports as itself", () => {
      const module = parseSource("let g = <a: >(x) => x");

      expect(module.diagnostics).toMatchObject([
        { message: "expected a constraint name" },
      ]);
    });

    test("comparison is untouched", () => {
      expect(parseSource("let ok = 1 < 2\nlet also = a < b and b < c").diagnostics).toEqual([]);
    });
  });

  // Pattern Matching §6.5, issue #83: a single parameter without parens may be any
  // paren-free pattern. The parenthesized spellings already worked (#82); these are the
  // forms that had to be told apart from the expressions they begin like.
  describe("paren-free pattern parameters", () => {
    test("bind exactly as the parenthesized spelling does", () => {
      const bare = parseSource("let f = {x} => x");
      const parenthesized = parseSource("let f = ({x}) => x");

      // One synthetic parameter, and the pattern hangs on the head beside it —
      // the resolver opens the body with it, once the binders are classified.
      const shape = {
        value: {
          kind: "Lambda",
          parameters: [{ name: { text: "__parameter0" } }],
          destructurings: [
            { name: { text: "__parameter0" }, pattern: { kind: "Record" } },
          ],
          body: { kind: "Name" },
        },
      };

      expect(bare.items).toMatchObject([shape]);
      expect(parenthesized.items).toMatchObject([shape]);
      expect(bare.diagnostics).toEqual([]);
      expect(parenthesized.diagnostics).toEqual([]);
    });

    test("accept every paren-free pattern §6.5 names", () => {
      const sources = [
        "let f = {a, b} => a",
        "let f = UserId(n) => n",
        "let f = x as v => v",
        "let f = {x} as r => x",
        "let f = _ as v => v",
        "let f = [a, b] => a",
        "let f = Wrap(_) | Empty => 1",
        "let f = {u = UserId(n)} => n",
      ];

      for (const source of sources) {
        expect(parseSource(source).diagnostics).toEqual([]);
      }
    });

    test("leave the bare-name and wildcard forms alone", () => {
      const module = parseSource("let f = x => x\nlet g = _ => 1\nlet h = () => 2");

      expect(module.items).toMatchObject([
        { value: { parameters: [{ name: { text: "x" } }] } },
        { value: { parameters: [{ name: { text: "__parameter0" } }] } },
        { value: { parameters: [] } },
      ]);
      expect(module.diagnostics).toEqual([]);
    });

    // The arrow is the whole signal, so everything that merely *starts* like a pattern
    // and is not followed by one stays the expression it was.
    test("do not capture the expressions they begin like", () => {
      const module = parseSource(
        "let literal = {x = 1}\n" +
          "let holdingALambda = {f = x => x}\n" +
          "let punned = {x}\n" +
          "let updated = {p with x = 3}\n" +
          "let vector = [1, 2]\n" +
          "let call = UserId(1)\n" +
          "let sum = a + b\n" +
          "let applied = g(1)\n",
      );

      expect(module.diagnostics).toEqual([]);
      expect(module.items).toMatchObject([
        { value: { kind: "Record" } },
        { value: { kind: "Record" } },
        { value: { kind: "Record" } },
        { value: { kind: "Record", spread: { kind: "Name" } } },
        { value: { kind: "Vector" } },
        { value: { kind: "Call" } },
        { value: { kind: "Binary" } },
        { value: { kind: "Call" } },
      ]);
    });
  });

  // Pattern Matching §6.5's guard pin: a top-level `=>` after `when` always belongs to the
  // arm, never to a lambda. Before #83 the most ordinary guard of all — a bare boolean
  // name — was swallowed as a lambda parameter, stranding the arm without its arrow.
  describe("guards keep their arrow", () => {
    const union = "union Box = Wrap(v: Int) | Empty\n";
    const rest = "        Wrap(_) => 9\n        Empty => 0\n";

    test("whatever shape the guard takes", () => {
      const guards = ["flag", "(flag)", "not flag", "x > 1", "flag and x > 0"];

      for (const guard of guards) {
        const module = parseSource(
          `${union}fun f(b: Box, flag: Bool): Int =\n` +
            "    match b\n" +
            `        Wrap(x) when ${guard} => x\n` +
            rest,
        );

        expect(module.diagnostics).toEqual([]);
      }
    });

    test("in `catch` arms too", () => {
      const module = parseSource(
        "exception Bad\n" +
          "fun f(flag: Bool): Int =\n" +
          "    try\n" +
          "        1\n" +
          "    catch\n" +
          "        Bad when flag => 2\n",
      );

      expect(module.diagnostics).toEqual([]);
    });

    // The claim is the arm's, and it does not reach inside a bracket: the bracket must
    // close before the arm's arrow can arrive, so a lambda written in there is still legal.
    test("without stopping lambdas nested inside the guard", () => {
      const guards = ["apply(y => y > 0, x)", "any([y => y > 0])", "apply(({v} => v > 0), x)"];

      for (const guard of guards) {
        const module = parseSource(
          `${union}fun f(b: Box): Int =\n` +
            "    match b\n" +
            `        Wrap(x) when ${guard} => x\n` +
            rest,
        );

        expect(module.diagnostics).toEqual([]);
      }
    });

    test("and an arm body may still be a lambda", () => {
      const module = parseSource(
        `${union}fun f(b: Box): Int =\n` +
          "    match b\n" +
          "        Wrap(x) => (y => y + x)(1)\n" +
          "        Empty => 0\n",
      );

      expect(module.diagnostics).toEqual([]);
    });
  });

  /**
   * The parenthesized element rule (Ascription §2.1): every element is
   * `expression (: Type)?`. The two readings of `(a: Int, b)` are told apart by
   * the token that already told them apart — the arrow after the matching `)` —
   * and nothing inside the parentheses decides it (§2.3).
   */
  describe("ascription", () => {
    test("`(e: T)` is an ascription, not a group around something", () => {
      // The group parentheses *are* the ascription's delimiters: one form
      // written, one node parsed.
      expect(expression(parseSource("(42: Nat)"))).toMatchObject({
        kind: "Ascription",
        expression: { kind: "Integer", decimal: "42" },
        annotation: { kind: "NamedType", name: { text: "Nat" } },
      });
    });

    test("`(e)` with no colon is still grouping", () => {
      expect(expression(parseSource("(42)"))).toMatchObject({ kind: "Group" });
    });

    test("`(a: Int, b)` is a tuple whose first component is ascribed", () => {
      expect(expression(parseSource("(a: Int, b)"))).toMatchObject({
        kind: "Tuple",
        elements: [
          { kind: "Ascription", expression: { kind: "Name" } },
          { kind: "Name", name: { text: "b" } },
        ],
      });
    });

    test("`(a: Int, b) => e` is a lambda — the arrow is the entire signal", () => {
      expect(expression(parseSource("(a: Int, b) => a"))).toMatchObject({
        kind: "Lambda",
        parameters: [
          { name: { text: "a" }, annotation: { kind: "NamedType", name: { text: "Int" } } },
          { name: { text: "b" } },
        ],
      });
    });

    test("`(params): T => body` is still an annotated lambda", () => {
      expect(expression(parseSource("(x): Int => x"))).toMatchObject({
        kind: "Lambda",
        returnAnnotation: { kind: "NamedType", name: { text: "Int" } },
      });
    });

    test("an inner `(...):` with an unrelated later `=>` is not a lambda head", () => {
      // §2.3: the return-annotation lookahead accepts the arrow only when it
      // immediately follows one well-formed type. A loose scan reads the whole
      // line as a lambda head off the `x => x` at the end.
      const module = parseSource("((a, b): (Int, String)) |> map(x => x)");
      expect(module.diagnostics).toEqual([]);
      expect(expression(module)).toMatchObject({
        kind: "Binary",
        operator: "Pipe",
        left: { kind: "Ascription", annotation: { kind: "Tuple" } },
      });
    });

    test("the colon ends the element, so an eats-right form is what gets ascribed", () => {
      // §2.2: `(x => x : a -> a)` is `((x => x) : a -> a)`, never
      // `x => (x : a -> a)`.
      expect(expression(parseSource("(x => x : a -> a)"))).toMatchObject({
        kind: "Ascription",
        expression: { kind: "Lambda" },
        annotation: { kind: "Function" },
      });
    });

    test("holes and constrained holes come free with the annotation grammar", () => {
      expect(expression(parseSource("(xs : Vector(_))"))).toMatchObject({
        kind: "Ascription",
        annotation: { kind: "AppliedType", arguments: [{ kind: "Hole", constraints: [] }] },
      });
      expect(expression(parseSource("(v : _ : Num)"))).toMatchObject({
        kind: "Ascription",
        annotation: { kind: "Hole", constraints: [{ text: "Num" }] },
      });
    });

    test("`(x: 1, y: 2)` reports Products §2.2's hint at the term, not the colon", () => {
      const module = parseSource("(x: 1, y: 2)");
      const hint = module.diagnostics.find(({ message }) =>
        message.startsWith("tuples are positional")
      );
      expect(hint?.message).toBe(
        "tuples are positional; for named fields use a record: `{x = 1, y = 2}`",
      );
      expect(hint?.primary.start.offset).toBe("(x: ".length);
    });

    test("a non-name element ascribed to a term gets the ordinary type error", () => {
      // The record hint is reserved for the shape the C# habit produces. `(1: 2)`
      // is not that shape, and telling its author about named fields would name a
      // rewrite that has nothing to do with what they wrote.
      const module = parseSource("(1: 2)");
      expect(module.diagnostics.map(({ message }) => message)).toContain(
        "expected a type annotation",
      );
    });
  });

  /**
   * `union` is a **contextual** keyword since the Set step (#373). Collections
   * Part 4 §6.2 mandates `Set.union`, and a reserved word is unspellable in
   * every binder position, so the word joined `with`, `when` and `opaque`:
   * Products §3.3's mechanism, one token of lookahead, keyword only where a
   * type name follows.
   *
   * Every case below can fail on its own. The declaration rows would fail if the
   * lookahead were dropped; the term rows would fail if the word were still
   * reserved; and the two diagnostics would fail if the predicate were narrowed
   * to `UpperName` alone or widened past the item grammar.
   */
  /**
   * `widens` is contextual on `union`'s mechanism (Lexer §4.2, Constraints
   * §4.7, #546), and its head is a **list** — which gives the parser one
   * verdict of its own to reach.
   *
   * The binding's name is derived from the members the head lists, so the
   * listed spellings have to agree: they jointly determine one name, and two
   * different words determine none. That is a syntactic fact, decidable here,
   * and it is pinned here rather than over a whole compile because in a real
   * project a disagreeing head is malformed in several ways at once — the
   * second path names a member the first's derived name cannot serve — and the
   * other diagnostics would bury the one this line owns.
   */
  describe("`widens` is contextual and its head is a list (#546)", () => {
    const messages = (text: string): readonly string[] =>
      parseSource(text).diagnostics.map(({ message }) => message);

    const itemKinds = (text: string): readonly string[] =>
      parseSource(text).items.map(({ kind }) => kind);

    test("an agreeing list parses clean, as one binding item", () => {
      const text = "widens Pow.pow, Mul.pow(value: Box, exponent: Float): Box =\n" +
        "    value\n";
      expect(messages(text)).toEqual([]);
      // A term binding, not a declaration form of its own: the item *is* the
      // binding it introduces.
      expect(itemKinds(text)).toEqual(["Let"]);
      expect(parseSource(text).items[0]).toMatchObject({
        kind: "Let",
        name: { text: "pow" },
        widens: [
          { module: { text: "Pow" }, member: { text: "pow" } },
          { module: { text: "Mul" }, member: { text: "pow" } },
        ],
      });
    });

    test("a disagreeing list has no name to derive, and is refused", () => {
      expect(messages(
        "widens Pow.pow, Mul.raise(value: Box, exponent: Float): Box =\n" +
        "    value\n",
      )).toContain(
        "a `widens` declaration binds one name, derived from the members it " +
          "lists; `pow` and `raise` disagree",
      );
    });

    test("the word is still an ordinary name everywhere else", () => {
      // Contextual, not reserved: one token of lookahead is the whole test, and
      // only an *uppercase* module alias can follow a head.
      expect(messages("let widens: Int = 2\n")).toEqual([]);
      expect(itemKinds("let widens: Int = 2\n")).toEqual(["Let"]);
      expect(messages("widens(2)\n")).toEqual([]);
      expect(itemKinds("widens(2)\n")).toEqual(["ExprItem"]);
    });
  });

  describe("`union` is contextual (#373)", () => {
    const messages = (text: string): readonly string[] =>
      parseSource(text).diagnostics.map(({ message }) => message);

    const itemKinds = (text: string): readonly string[] =>
      parseSource(text).items.map(({ kind }) => kind);

    test("a declaration head still declares, bare and exported", () => {
      expect(itemKinds("union Colour = Red | Green")).toEqual(["Union"]);
      expect(messages("union Colour = Red | Green")).toEqual([]);
      expect(itemKinds("export union Colour = Red | Green")).toEqual(["Union"]);
      expect(messages("export union Colour = Red | Green")).toEqual([]);
      expect(itemKinds("opaque union Box(a) = Wrap(v: a)")).toEqual(["Union"]);
      expect(messages("opaque union Box(a) = Wrap(v: a)")).toEqual([]);
    });

    /**
     * The layout half, which is a separate failure mode from the parse: a union
     * head must not open a block, or its indented alternatives get a VOPEN and
     * the `|` lines stop belonging to the declaration. `expectsBlock` used to
     * read the keyword token kind and now reads the same contextual shape.
     */
    test("an indented alternative list still belongs to its declaration", () => {
      const module = parseSource("union Tree(a) =\n    | Leaf\n    | Node(v: a)\n");
      expect(module.diagnostics.map(({ message }) => message)).toEqual([]);
      expect(module.items.map(({ kind }) => kind)).toEqual(["Union"]);
    });

    test("the word binds, names a field, and names a parameter", () => {
      expect(messages("let union = 3")).toEqual([]);
      expect(itemKinds("let union = 3")).toEqual(["Let"]);
      expect(messages("let r = { union = 1 }")).toEqual([]);
      expect(messages("let f(union: Int): Int = union")).toEqual([]);
      expect(messages("var union = 1")).toEqual([]);
    });

    /**
     * The three call spellings, and the reason the ruling was asked for. The
     * bare one is a **new capability**: `Set.hex` is the only prelude member
     * exporting `union`, so the name is uncollided and resolves bare — which a
     * reserved word made impossible to write at all.
     */
    test("qualified, dotted, and bare calls all parse", () => {
      expect(messages("let u = Set.union(a, b)")).toEqual([]);
      expect(messages("let u = s.union(t)")).toEqual([]);
      expect(messages("let u = union(a, b)")).toEqual([]);
    });

    /**
     * The lookahead is a name, not an uppercase name, so a mis-cased type name
     * stays a union declaration with the wrong name rather than falling out of
     * the item grammar into a much worse message.
     */
    test("a lower-cased type name keeps the targeted diagnostic", () => {
      expect(messages("union colour = Red")).toContain(
        "`union` requires an uppercase type name",
      );
    });

    test("a declaration below module level keeps its own diagnostic", () => {
      expect(messages("fun f(): Int =\n    union Bad = A\n    1\n")).toContain(
        "`union` is only allowed at module top level",
      );
    });
  });

  /**
   * `opaque` fills the head's visibility slot on its own since #590 (Modules §4,
   * Lexer §4.2), so the word left `export`'s shadow and joined `union` and
   * `widens` on Products §3.3's mechanism: one token of lookahead, keyword only
   * where a declaration follows, an ordinary name everywhere else.
   *
   * The lookahead is **wider** than either sibling's, on purpose. `union` and
   * `widens` recognize only their lawful shape; `opaque` recognizes its refused
   * subjects too, because a head that stopped at `record`/`union` could not
   * redirect them — `opaque type Name = String` would fall out of the item
   * grammar and be answered by whatever the expression parser made of two
   * adjacent words. Each row below fails on its own: the first if the head were
   * never recognized, the redirects if the lookahead were narrowed, and the term
   * rows if the word were reserved or the lookahead widened past a declaration.
   */
  describe("`opaque` is contextual and fills the head's slot (#590)", () => {
    const messages = (text: string): readonly string[] =>
      parseSource(text).diagnostics.map(({ message }) => message);

    const itemKinds = (text: string): readonly string[] =>
      parseSource(text).items.map(({ kind }) => kind);

    test("the bare head declares, and carries both flags", () => {
      const module = parseSource(
        "opaque record Token = {value: Int}\n" +
          "opaque union Handle = File(Int) | Socket(Int)\n",
      );
      expect(module.diagnostics).toEqual([]);
      // Exactly what `export opaque` produced before #590: the type name
      // crosses, the representation stays home.
      expect(module.items).toMatchObject([
        { kind: "RecordDeclaration", exported: true, opaque: true },
        { kind: "Union", exported: true, opaque: true },
      ]);
    });

    test("the pair is refused, in the introducer the author wrote", () => {
      expect(messages("export opaque record Token = {value: Int}\n")).toEqual([
        "`opaque` already exports the type name; write `opaque record Point = …`",
      ]);
      expect(messages("export opaque union Handle = File(Int)\n")).toEqual([
        "`opaque` already exports the type name; write `opaque union Handle = …`",
      ]);
      // Refused, then read anyway: the migration reports once per line.
      expect(itemKinds("export opaque record Token = {value: Int}\n"))
        .toEqual(["RecordDeclaration"]);
      expect(parseSource("export opaque union Handle = File(Int)\n").items)
        .toMatchObject([{ kind: "Union", exported: true, opaque: true }]);
    });

    test("the redirected subjects are recognized, so they can be redirected", () => {
      expect(messages("opaque type Name = String\n")).toEqual([
        "aliases are transparent; make it a `record` or single-constructor `union`",
      ]);
      for (const text of [
        "opaque let width: Int = 3\n",
        "opaque fun width(): Int = 3\n",
        "opaque exception Torn(reason: String)\n",
        "opaque constraint Hidden<a> =\n    peek(subject: a): Int\n",
      ]) {
        expect(messages(text)).toEqual([
          "`opaque` applies to `record` and `union` declarations",
        ]);
      }
    });

    test("the word binds, names a field, and names a parameter", () => {
      expect(messages("let opaque = 3")).toEqual([]);
      expect(itemKinds("let opaque = 3")).toEqual(["Let"]);
      expect(messages("let r = { opaque = 1 }")).toEqual([]);
      expect(messages("let f(opaque: Int): Int = opaque")).toEqual([]);
      expect(messages("var opaque = 1")).toEqual([]);
      expect(messages("opaque(2)\n")).toEqual([]);
      expect(itemKinds("opaque(2)\n")).toEqual(["ExprItem"]);
    });

    test("a head below module level keeps its own diagnostic", () => {
      expect(messages("fun f(): Int =\n    opaque record Bad = {n: Int}\n    1\n")).toContain(
        "`opaque` is only allowed at module top level",
      );
    });
  });

  /**
   * Modules §3.3 and Lexer §4.2's new row: the namespace head is
   * `import module Geo from "./geometry"`, and `*` has left the import grammar
   * entirely.
   *
   * The context is one position wide — between `import` and the alias — and it
   * is total there because nothing else could ever stand in it: before #565 an
   * `import` admitted only `{`, `*`, or a string, so no name after `import` was
   * ever a legal program. That is why recognition is unconditional rather than
   * gated on an uppercase name ahead, and why the degenerate `import module
   * module` reaches the alias seat and dies of the seat's own start-class rule
   * instead of a special case written for the spelling.
   */
  describe("`module` is contextual in the import head (#565)", () => {
    const messages = (text: string): readonly string[] =>
      parseSource(text).diagnostics.map(({ message }) => message);

    const itemKinds = (text: string): readonly string[] =>
      parseSource(text).items.map(({ kind }) => kind);

    test("the head binds an alias, and nothing else changed about the form", () => {
      const module = parseSource('import module Geo from "./geometry"\n');
      expect(module.diagnostics).toEqual([]);
      expect(module.items).toMatchObject([{
        kind: "Import",
        specifier: "./geometry",
        form: { kind: "Namespace", alias: { text: "Geo", startClass: "upper" } },
      }]);
    });

    /**
     * A legal head is not a line — comments are trivia between its tokens and it
     * may break across them. The old spelling held both properties and the new
     * one inherits them, because the change is which tokens the head is made of,
     * not how the parser walks them. The Playground's alias scan (#537) reads the
     * same token stream and depends on exactly this.
     */
    test("the head is tokens, not a line", () => {
      expect(messages('import (* why *) module Geo from "./geometry"\n')).toEqual([]);
      expect(messages('import\n    module Geo from "./geometry"\n')).toEqual([]);
    });

    test("the word still binds, names a field, and names a parameter", () => {
      expect(messages("let module = 3")).toEqual([]);
      expect(itemKinds("let module = 3")).toEqual(["Let"]);
      expect(messages("let r = { module = 1 }")).toEqual([]);
      expect(messages("let f(module: Int): Int = module")).toEqual([]);
      expect(messages("var module = 1")).toEqual([]);
      expect(messages("module(2)")).toEqual([]);
    });

    /**
     * §2's refusal is untouched: the context is the import head and reaches no
     * declaration seat, so a header line is read as the two ordinary items it
     * lexes as, exactly as before, and no import diagnostic is spoken over it.
     */
    test("`module Geometry` at a declaration seat is no import head", () => {
      expect(messages("module Geometry\n")).toEqual([
        "expected a newline or `;` between block items",
      ]);
    });

    /**
     * The degenerate spelling. `module` in the alias seat is a non-uppercase-start
     * name and the seat refuses it as it refuses any other — the message is the
     * alias seat's own, not a rule about this word. The refusal is followed by
     * the same recovery cascade any rejected alias has drawn since before #565
     * (`import * as module from "./x"` reached these four messages by this exact
     * path), so the first message is what is pinned.
     */
    test("`import module module` dies in the alias seat, by start class", () => {
      expect(messages('import module module from "./x"\n')[0]).toBe(
        "module aliases must be uppercase-start names",
      );
    });

    /**
     * JavaScript's default-import muscle memory. It draws the start-class refusal
     * because `from` is a non-uppercase-start name standing in the alias seat —
     * which is what §3.3 says it gets. A targeted redirect naming the missing
     * alias is a recorded diagnostics candidate, deliberately not invented here.
     */
    test("`import module from` draws the same start-class refusal, alone", () => {
      expect(messages('import module from "./x"\n')).toEqual([
        "module aliases must be uppercase-start names",
      ]);
    });

    test("a name where the head belongs names the three heads that exist", () => {
      expect(messages('import geo from "./x"\n')[0]).toBe(
        "expected `{`, `module`, or a module string after `import`",
      );
    });

    /**
     * The Rewrite Rule applied to JavaScript's own head (§3.3, §10). The message
     * carries the spec's exemplar and the fix-it carries the user's line: the two
     * tokens `* as` become the one word `module`, leaving alias and path as
     * written. Parsing continues into the alias seat, so one pasted JavaScript
     * import costs one diagnostic rather than a cascade.
     */
    test("JavaScript's `import * as` head is refused with its rewrite", () => {
      const module = parseSource('import * as Geo from "./geometry"\n');
      expect(module.diagnostics.map(({ message }) => message)).toEqual([
        'namespace imports are spelled `import module Geo from "./geometry"`',
      ]);
      const [fix] = module.diagnostics[0]?.fixes ?? [];
      expect(fix?.message).toBe("write `import module`");
      expect(fix?.edits.map(({ span, replacement }) => [
        module.diagnostics[0]!.primary.fileId === span.fileId,
        span.start.offset,
        span.end.offset,
        replacement,
      ])).toEqual([[true, 7, 11, "module"]]);
      // The edit is over `* as` exactly, so applying it yields the head the
      // message names — the alias and the path are never retyped.
      const text = 'import * as Geo from "./geometry"\n';
      expect(
        text.slice(0, 7) + "module" + text.slice(11),
      ).toBe('import module Geo from "./geometry"\n');
      expect(module.items).toMatchObject([{
        kind: "Import",
        form: { kind: "Namespace", alias: { text: "Geo" } },
      }]);
    });

    /**
     * With no `as` there is no two-token span to rewrite, so the redirect stands
     * on its message — the restraint the lexer's JavaScript-block-comment
     * redirect shows when it finds no closing delimiter.
     */
    test("a `*` head with no `as` keeps the message and offers no edit", () => {
      const module = parseSource('import * Geo from "./geometry"\n');
      expect(module.diagnostics.map(({ message, fixes }) => [message, fixes])).toEqual([
        ['namespace imports are spelled `import module Geo from "./geometry"`', undefined],
      ]);
    });
  });
});

function parseSource(text: string): Parsed.Module {
  const source = new Source.File(Source.fileId(0), "test.hex", text);
  return parse(applyLayout(lex(source)));
}

function expression(module: Parsed.Module): Parsed.Expr {
  const item = module.items[0];
  if (item?.kind !== "ExprItem") {
    throw new Error("expected one expression item");
  }
  return item.expression;
}
