import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for **the match function** — `match` without a scrutinee (Pattern
 * Matching §6.7, #505).
 *
 * A `match` that *ends its logical item* is the unary function literal matching
 * its argument against the arm block. §6.7 gives it by desugar — `$x => match $x
 * …` for a fresh, unnameable binder — and the tests are organised around what
 * "by desugar" buys, because that is the whole design:
 *
 * - **It is a lambda.** Its type is a lambda's, the expected type flows in from
 *   context as a lambda's does, it satisfies Functions §7.1's written-form check
 *   like a lambda literal, and it is a syntactic value. Nothing here is a second
 *   implementation of any of that; the pins check that the one implementation is
 *   what the form reaches.
 * - **It is a `match`.** Exhaustiveness is demanded over the parameter type and
 *   reachability is ordinary — which is the form's *point*, since §6.5's
 *   irrefutability gate is what refuses `Some(x) => e` at a lambda head.
 * - **The disambiguation is one token.** Anything after `match` on the same line
 *   is the scrutinee form, unchanged; that regression pin is load-bearing,
 *   because a bare `match` at line end simply had no parse before.
 * - **It takes no `catch`, ever** (Exceptions §5.4, §9), at either of the two
 *   seats a `catch` can reach it from.
 *
 * One interaction worth naming here rather than in each test: an **exported**
 * binding whose value is any lambda must annotate its parameters
 * (Modules §4.1.1), and a match function has nowhere to write one. That is the
 * pre-existing rule — `export let f: (Int) -> Int = x => x` is refused the same
 * way — so the pins below bind match functions privately and export a wrapper,
 * which is what a writer does today for every unannotatable lambda.
 */

const maybe = "export union Maybe = Just(Int) | Nothing\n";

describe("a scrutinee-less `match` is a unary function literal", () => {
  test("it parses as a lambda whose body is a match on its own parameter", () => {
    const project = compileMain(
      maybe +
        "let describe = match\n" +
        "    Just(n) => n\n" +
        "    Nothing => 0\n" +
        "export let answer: Int = describe(Just(42))\n",
    );

    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    const binding = main.parsed.items.find(
      (item) => item.kind === "Let" && item.name.text === "describe",
    );
    // The desugar, in the tree: one lambda, one parameter, a `Match` body whose
    // scrutinee is a reference to that parameter. No dedicated node survives to
    // any later pass, because none is made.
    expect(binding).toMatchObject({
      kind: "Let",
      value: {
        kind: "Lambda",
        parameters: [{ name: { text: "__parameter0" } }],
        body: {
          kind: "Match",
          scrutinee: { kind: "Name", name: { text: "__parameter0" } },
          arms: [
            { pattern: { kind: "Constructor", name: { text: "Just" } } },
            { pattern: { kind: "Constructor", name: { text: "Nothing" } } },
          ],
        },
      },
    });
  });

  test("the binder occupies no source, so no position query can land on it", () => {
    const project = compileMain(
      maybe +
        "let describe = match\n" +
        "    Just(n) => n\n" +
        "    Nothing => 0\n" +
        "export let answer: Int = describe(Just(42))\n",
    );
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    const binding = main.parsed.items.find(
      (item) => item.kind === "Let" && item.name.text === "describe",
    )!;
    const lambda = (binding as { value: { parameters: readonly { span: { start: { offset: number }; end: { offset: number } } }[] } }).value;
    const { start, end } = lambda.parameters[0]!.span;
    expect(end.offset).toBe(start.offset);
  });

  test("the parameter's type and the arms' bodies give the function's type", async () => {
    const exports = await runMain(
      maybe +
        "let describe = match\n" +
        "    Just(n) => n\n" +
        "    Nothing => 0\n" +
        "export let present: Int = describe(Just(42))\n" +
        "export let absent: Int = describe(Nothing)\n",
    );

    expect([exports["present"], exports["absent"]]).toEqual([42, 0]);
  });

  test("the expected type flows in from context, as for any lambda", () => {
    // The annotation's result type is what resolves these literals: nothing in
    // the arms says `BigInt`, and the emitted `1n`/`0n` is the observation.
    const project = compileMain(
      maybe +
        "let size: (Maybe) -> BigInt = match\n" +
        "    Just(_) => 1\n" +
        "    Nothing => 0\n" +
        "export let answer: BigInt = size(Nothing)\n",
    );

    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(main.javascript.text).toContain("return 1n;");
    expect(main.javascript.text).toContain("return 0n;");
  });

  /**
   * The other direction of "as for any lambda", and the honest half.
   *
   * A `match` needs its scrutinee's type known where it is checked, and this
   * compiler does not push an annotation's parameter type inward before a
   * lambda's body is inferred. So a match function whose arms are bare binders
   * has nothing to fix its parameter type with, and takes the ordinary
   * abstract-scrutinee refusal — **exactly as the hand-written desugar does**.
   * That equality is the claim §6.7 makes, and it is what is pinned; the
   * limitation itself is the checker's, older than this form, and shared.
   */
  test("a bare-binder match function is refused exactly as its desugar is", () => {
    const armsOnly = "    n when n > 0 => \"positive\"\n    _ => \"other\"\n";
    const abstract = "cannot match on a value of abstract type; " +
      "use the operations its constraints provide";

    const written = projectDiagnostics(
      "let sign: (Int) -> String = value =>\n" +
        "    match value\n" +
        armsOnly.replaceAll("    ", "        ") +
        "export let a: String = sign(3)\n",
    );
    const desugared = projectDiagnostics(
      "let sign: (Int) -> String = match\n" +
        armsOnly +
        "export let a: String = sign(3)\n",
    );

    expect(written).toEqual([abstract]);
    expect(desugared).toEqual(written);
  });

  test("guards work in the arms, as in every match", async () => {
    // With constructor patterns fixing the parameter type, a guard is ordinary.
    const exports = await runMain(
      maybe +
        "let describe = match\n" +
        "    Just(n) when n > 0 => \"positive\"\n" +
        "    Just(_) => \"other\"\n" +
        "    Nothing => \"none\"\n" +
        "export let a: String = describe(Just(3))\n" +
        "export let b: String = describe(Just(-3))\n" +
        "export let c: String = describe(Nothing)\n",
    );

    expect([exports["a"], exports["b"], exports["c"]])
      .toEqual(["positive", "other", "none"]);
  });
});

describe("callback position — the form's reason to exist", () => {
  test("an argument's arm block closes with the call's own `)`", () => {
    // James's `Vector.map` shape, with a local higher-order function standing in
    // for it: the arm block ends at the dedent, and the closing paren follows.
    expect(projectDiagnostics(
      maybe +
        "let apply(value: Maybe, transform: (Maybe) -> Int): Int = transform(value)\n" +
        "export let answer(value: Maybe): Int =\n" +
        "    apply(value, match\n" +
        "        Just(n) => n\n" +
        "        Nothing => 0\n" +
        "    )\n",
    )).toEqual([]);
  });

  test("it maps a sequence, run end to end", async () => {
    const exports = await runMain(
      "let labels(values: Vector(Option(String))): Vector(String) =\n" +
        "    Vector.fromSeq(Seq.map(values.toSeq(), match\n" +
        "        Some(value) => value\n" +
        "        None => \"missing\"\n" +
        "    ))\n" +
        "export let result: Vector(String) = labels([Some(\"a\"), None, Some(\"c\")])\n",
    );

    expect(Array.from(exports["result"] as Iterable<string>))
      .toEqual(["a", "missing", "c"]);
  });

  test("§6.5's gate is untouched, and its refusal now names this form", () => {
    // The pair that motivates §6.7: a refutable pattern is still refused at a
    // lambda head, and the refusal points at the construct that accepts it.
    expect(projectDiagnostics(
      maybe +
        "let unwrap = Just(n) => n\n" +
        "export let g: Int = 1\n",
    )).toEqual([
      "a constructor pattern is refutable and cannot be used in a binding position; " +
        "use `match` — for a match function, write `match` with arms",
    ]);
  });

  test("the fixit is offered at the lambda seat only", () => {
    // A `let` pattern's refusal is unchanged: a match function is not the
    // rewrite there.
    expect(projectDiagnostics(
      maybe +
        "let value: Maybe = Just(1)\n" +
        "let Just(n) = value\n" +
        "export let g: Int = 1\n",
    )).toEqual([
      "a constructor pattern is refutable and cannot be used in a binding position; use `match`",
    ]);
  });
});

describe("it is a `match`: exhaustiveness and reachability are demanded", () => {
  test("a missing case is the ordinary missing-cases error, with witnesses", () => {
    expect(projectDiagnostics(
      maybe +
        "let describe = match\n" +
        "    Just(n) => n\n" +
        "export let answer: Int = describe(Nothing)\n",
    )).toEqual(["match is missing cases: `Nothing`"]);
  });

  test("an arm after a catch-all is unreachable, as in every match", () => {
    expect(projectDiagnostics(
      maybe +
        "let describe = match\n" +
        "    _ => 0\n" +
        "    Just(n) => n\n" +
        "export let answer: Int = describe(Nothing)\n",
    )).toEqual(["this match arm is unreachable; an earlier pattern matches everything"]);
  });

  test("an arm block is still required", () => {
    expect(projectDiagnostics("let describe = match\n"))
      .toContain("expected an indented block of match arms");
  });
});

describe("it is a lambda literal for the written-form checks", () => {
  test("`fun f = match` line-final is accepted, and recurses", async () => {
    const exports = await runMain(
      "union Peano = Zero | Succ(Peano)\n" +
        "fun depth = match\n" +
        "    Zero => 0\n" +
        "    Succ(inner) => 1 + depth(inner)\n" +
        "export let two: Int = depth(Succ(Succ(Zero)))\n",
    );

    expect(exports["two"]).toBe(2);
  });

  test("`fun f =` with the `match` on the next line stays refused", () => {
    // Functions §7.1 asks what the right-hand side *is*, and a wrapped arrival
    // is the binding block's item rather than the written form — the same
    // refusal a parenthesized or next-line lambda literal takes. #505 widens the
    // set of literals, not the rule about where one may sit.
    expect(projectDiagnostics(
      "union Peano = Zero | Succ(Peano)\n" +
        "fun depth =\n" +
        "    match\n" +
        "        Zero => 0\n" +
        "        Succ(inner) => 1 + depth(inner)\n",
    )).toContain("`fun` requires a function header or lambda literal on its right-hand side");
  });

  test("a match function is a syntactic value, so it generalizes", () => {
    // The value restriction lets a lambda's binding generalize; this one is used
    // at two element types, which only type-checks if it did.
    expect(projectDiagnostics(
      "let firstOr(fallback: a): (Option(a)) -> a = match\n" +
        "    Some(value) => value\n" +
        "    None => fallback\n" +
        "export let text: String = firstOr(\"none\")(Some(\"a\"))\n" +
        "export let number: Int = firstOr(0)(None)\n",
    )).toEqual([]);
  });
});

describe("disambiguation is one token of lookahead", () => {
  test("`match e` with a scrutinee is unchanged", async () => {
    // The regression pin. A token after `match` on the same line means §6.1's
    // form, whatever that token is.
    const exports = await runMain(
      maybe +
        "export let describe(value: Maybe): Int =\n" +
        "    match value\n" +
        "        Just(n) => n\n" +
        "        Nothing => 0\n" +
        "export let answer: Int = describe(Just(7))\n",
    );

    expect(exports["answer"]).toBe(7);
  });

  test("an arm body may itself be a match function", async () => {
    // `=> match` at the end of an arm's line: the arm body ends its own item, so
    // the inner head is scrutinee-less too, and the two binders nest.
    const exports = await runMain(
      maybe +
        "let choose = match\n" +
        "    Just(n) => match\n" +
        "        Just(m) => n + m\n" +
        "        Nothing => n\n" +
        "    Nothing => match\n" +
        "        Just(m) => m\n" +
        "        Nothing => 0\n" +
        "export let both: Int = choose(Just(3))(Just(4))\n" +
        "export let neither: Int = choose(Nothing)(Nothing)\n",
    );

    expect([exports["both"], exports["neither"]]).toEqual([7, 0]);
  });
});

describe("no `catch` clause, at either seat (Exceptions §5.4, §9)", () => {
  const boom = "exception Boom(message: String)\n";
  const noClause = "a match function's parameter is already a value; there is nothing here " +
    "for `catch` to observe — to guard the arm bodies, write a lambda whose body is " +
    "`try match x …` with `catch` aligned to the `try`";

  test("a `catch` at the head's own column", () => {
    expect(projectDiagnostics(
      maybe + boom +
        "let describe =\n" +
        "    match\n" +
        "        Just(n) => n\n" +
        "        Nothing => 0\n" +
        "    catch\n" +
        "        Boom(_) => 1\n" +
        "export let answer: Int = describe(Nothing)\n",
    )).toEqual([noClause]);
  });

  test("a `catch` indented among the arms", () => {
    // The seat that would otherwise take the align-with-`match` fixit; there is
    // no clause to align anything to here, so it takes this message instead.
    expect(projectDiagnostics(
      maybe + boom +
        "let describe = match\n" +
        "    Just(n) => n\n" +
        "    Nothing => 0\n" +
        "    catch\n" +
        "        Boom(_) => 1\n" +
        "export let answer: Int = describe(Nothing)\n",
    )).toEqual([noClause]);
  });

  test("a `catch` at an enclosing item's column, after a trailing match function", () => {
    // Exceptions §9's short-circuit: this is the alignment seat, and the item's
    // trailing construct is scrutinee-less, so the alignment message — advice
    // about a column that would attach nothing — gives way to this one.
    expect(projectDiagnostics(
      maybe + boom +
        "export let answer(value: Maybe): Int =\n" +
        "    let describe = match\n" +
        "        Just(n) => n\n" +
        "        Nothing => 0\n" +
        "    catch\n" +
        "        Boom(_) => 1\n" +
        "    describe(value)\n",
    )).toEqual([noClause]);
  });

  test("the alignment message still stands where the trailing match has a scrutinee", () => {
    // The control for the short-circuit above: same shape, one scrutinee added.
    expect(projectDiagnostics(
      maybe + boom +
        "export let answer(value: Maybe): Int =\n" +
        "    let described =\n" +
        "        match value\n" +
        "            Just(n) => n\n" +
        "            Nothing => 0\n" +
        "    catch\n" +
        "        Boom(_) => 1\n" +
        "    described\n",
    )).toEqual([
      "a `catch` clause must align with a `match` that begins its line — align the " +
      "`catch` with the `match`'s column; if the `match` head is mid-line, move it " +
      "onto its own line",
    ]);
  });

  test("the rewrite the message names compiles", () => {
    // `try match x …` inside a lambda body, the `try` heading its own line —
    // the one legal layout of that composition under §5.4's attachment rules.
    expect(projectDiagnostics(
      maybe + boom +
        "let risky(n: Int): Int = if n > 0 then n else throw(Boom(\"negative\"))\n" +
        "let describe = value =>\n" +
        "    try match value\n" +
        "        Just(n) => risky(n)\n" +
        "        Nothing => 0\n" +
        "    catch\n" +
        "        Boom(_) => 1\n" +
        "export let answer: Int = describe(Just(-1))\n",
    )).toEqual([]);
  });

  test("the rewrite compiles in callback position too — the book's shape", () => {
    // Where the match function would have gone: the lambda's body block holds a
    // `try` heading its own line, and the whole thing is still one argument.
    expect(projectDiagnostics(
      maybe + boom +
        "let risky(n: Int): Int = if n > 0 then n else throw(Boom(\"negative\"))\n" +
        "let apply(value: Maybe, transform: (Maybe) -> Int): Int = transform(value)\n" +
        "export let answer(value: Maybe): Int =\n" +
        "    apply(value, option =>\n" +
        "        try match option\n" +
        "            Just(n) => risky(n)\n" +
        "            Nothing => 0\n" +
        "        catch\n" +
        "            Boom(_) => 1\n" +
        "    )\n",
    )).toEqual([]);
  });
});

describe("emission: an arrow over the ordinary match lowering", () => {
  test("the desugar's shape, with a hygienic binder", () => {
    const project = compileMain(
      maybe +
        "let describe = match\n" +
        "    Just(n) => n\n" +
        "    Nothing => 0\n" +
        "export let answer: Int = describe(Just(42))\n",
    );

    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(main.javascript.text).toContain(
      [
        "const describe = __parameter0 => {",
        "  const __match = __parameter0;",
        "  switch (__match.tag) {",
        "    case \"Just\":",
        "      const n = __match.item1;",
        "      return n;",
        "    case \"Nothing\":",
        "      return 0;",
      ].join("\n"),
    );
  });

  test("in expression position it is just an arrow argument", () => {
    const project = compileMain(
      maybe +
        "let apply(value: Maybe, transform: (Maybe) -> Int): Int = transform(value)\n" +
        "export let answer(value: Maybe): Int =\n" +
        "    apply(value, match\n" +
        "        Just(n) => n\n" +
        "        Nothing => 0\n" +
        "    )\n",
    );

    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(main.javascript.text).toContain("return apply(value, __parameter0 => {");
  });

  test("nested match functions shadow rather than collide", () => {
    // Both binders take the same unwritable spelling, and JavaScript's own
    // scoping keeps them apart — the inner arrow's parameter shadows the outer's,
    // which is exactly what the desugar means.
    const project = compileMain(
      maybe +
        "let choose = match\n" +
        "    Just(n) => match\n" +
        "        Just(m) => n + m\n" +
        "        Nothing => n\n" +
        "    Nothing => match\n" +
        "        Just(m) => m\n" +
        "        Nothing => 0\n" +
        "export let answer: Int = choose(Just(3))(Just(4))\n",
    );

    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(main.javascript.text.split("__parameter0 =>").length - 1).toBe(3);
  });

  test("no source can spell the binder, so nothing can capture it", () => {
    // Lexer §3.2 reserves the prefix, and the reserved-name sweep reads tokens —
    // which the desugar's name is not. The seat stays closed from both sides.
    expect(projectDiagnostics(
      maybe +
        "let describe = match\n" +
        "    Just(__parameter0) => __parameter0\n" +
        "    Nothing => 0\n" +
        "export let answer: Int = describe(Nothing)\n",
    )).toEqual([
      "names beginning `__` are reserved for compiler-generated code",
      "names beginning `__` are reserved for compiler-generated code",
    ]);
  });
});
