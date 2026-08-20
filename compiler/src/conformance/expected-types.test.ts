import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for **expected-type propagation** — Functions §4.3, #513.
 *
 * > An expected type flows in from the seats that write one, through the forms
 * > that return a subexpression's value, and lands at lambdas.
 *
 * The section is an **ordering device over the same HM judgments**, not a new
 * one: it performs early exactly the unifications the seat's final check
 * performs anyway. Three sentences of it are normative and shape this file:
 *
 * - **Landing only at lambdas.** Everywhere else the expectation is inert —
 *   never a diagnostic, never a conversion, never a Numeric Literals §5.1
 *   widening target. The tuple-component and widening pins below are what make
 *   that testable rather than merely asserted.
 * - **Left to right.** Arguments are checked in source order, each expectation
 *   read as resolved at its turn. The two-pass order (lambdas last) is
 *   *refuted*, not merely unchosen, by the order-race specimens here.
 * - **Monotone.** Every program accepted without propagation is accepted with
 *   it, at the same types. The whole existing suite is that sweep; the
 *   spot-checks here name the shapes the arc actually moved.
 *
 * The everyday beneficiary is the match function (Pattern Matching §6.7), whose
 * parameter type is often fixed by nothing *inside* it — so the guard-only
 * numeric match function is the probe used at every seat: its arms constrain
 * without resolving, and before this rule §6.1's refusal fired on a type written
 * one token away.
 */

/** The probe: arms that constrain the parameter without resolving it. */
const guardOnly = (indent: string): string =>
  `${indent}n when n < 0 => "negative"\n${indent}_ => "other"\n`;

/** §6.1's refusal, with #513's rider for an undetermined lambda parameter. */
const rider = "cannot match on a value of abstract type; the parameter's " +
  "type is not determined here; give the parameter a type — bind the " +
  "function with its own annotated `let`, or use it where its parameter " +
  "type is known";

describe("the supplying seats (§4.3)", () => {
  test("an annotated `let` right-hand side", () => {
    expect(projectDiagnostics(
      "let sign: (Int) -> String = match\n" +
        guardOnly("    ") +
        "export let a: String = sign(3)\n",
    )).toEqual([]);
  });

  test("a written return annotation — the header-sugar spelling of the same seat", () => {
    // §4.1's annotated right-hand side, spelled with a header: the written
    // return type is what the seat wrote around the body, so it supplies the
    // body exactly as a binding annotation supplies its value.
    expect(projectDiagnostics(
      "let make(flag: Bool): (Int) -> String = match\n" +
        guardOnly("    ") +
        "export let a: String = make(True)(3)\n",
    )).toEqual([]);
  });

  test("an argument of a known callee, subject-first", async () => {
    // §5.4's convention is what makes the left-to-right order *pay*: the
    // subject resolves `Seq.map`'s instantiation, and only then is the
    // callback's expectation read — concrete, `Int`.
    const exports = await runMain(
      "let xs: Seq(Int) = [1, -2].toSeq()\n" +
        "export let ys: Vector(String) = Vector.fromSeq(Seq.map(xs, match\n" +
        guardOnly("    ") +
        "))\n",
    );
    expect(Array.from(exports["ys"] as Iterable<string>))
      .toEqual(["other", "negative"]);
  });

  test("a dot call at a head-known receiver", () => {
    // Method Syntax §2.2's second entry moment: the receiver is head-known at
    // the dot, so the goal resolves *before* the arguments are elaborated and
    // the resolved member's signature supplies them. This adds expectations
    // without reordering elaboration — §11.3's rejection is untouched.
    expect(projectDiagnostics(
      "let xs: Seq(Int) = [1, -2].toSeq()\n" +
        "export let ys: Seq(String) = xs.map(match\n" +
        guardOnly("    ") +
        ")\n",
    )).toEqual([]);
  });

  test("an ascription", () => {
    expect(projectDiagnostics(
      "let sign = (match\n" +
        guardOnly("    ") +
        ": (Int) -> String)\n" +
        "export let a: String = sign(3)\n",
    )).toEqual([]);
  });

  test("an annotated `var`'s initializer, and every `:=` right-hand side", () => {
    expect(projectDiagnostics(
      "export let run(): String =\n" +
        "    var sign: (Int) -> String = match\n" +
        guardOnly("        ") +
        "    sign := match\n" +
        "        n when n > 0 => \"positive\"\n" +
        "        _ => \"other\"\n" +
        "    sign(3)\n",
    )).toEqual([]);
  });

  test("a constraint member's body, whose own expected type is a function", () => {
    // The member's *parameters* have taken their expected types since members
    // existed — that half is Constraints §4.1's, not #513's. What #513 adds is
    // the body: its expected type is the declaration's result with the subject
    // substituted, so a match function standing there lands.
    expect(projectDiagnostics(
      "export constraint Pick<a> =\n" +
        "    pick(value: a): (Int) -> String\n" +
        "honor Pick<Int> =\n" +
        "    pick(value) = match\n" +
        guardOnly("        ") +
        "let three: Int = 3\n" +
        "export let a: String = pick(three)(1)\n",
    )).toEqual([]);
  });

  test("a constraint member's body", () => {
    // Constraints §4.1 already stated member typing as checking rather than
    // inference; #513 is the one mechanism that makes the sentence reach a
    // member's lambda parameters before its body is inferred.
    expect(projectDiagnostics(
      "export constraint Sign<a> =\n" +
        "    sign(value: a): String\n" +
        "honor Sign<Int> =\n" +
        "    sign(value) = match value\n" +
        guardOnly("        ") +
        "let three: Int = 3\n" +
        "export let a: String = sign(three)\n",
    )).toEqual([]);
  });
});

describe("the forwarding forms (§4.3)", () => {
  const conducts = (body: string): readonly string[] =>
    projectDiagnostics(
      "let flag: Bool = True\n" +
        `let sign: (Int) -> String =\n${body}` +
        "export let a: String = sign(3)\n",
    );

  test("grouping parentheses", () => {
    // Pinned at an *argument* seat rather than a binding one on purpose: the
    // resolver peels grouping parens (and a one-item layout block) off a
    // binding's value before the checker ever sees them, so a `let`-seat group
    // would exercise nothing. Everywhere else the parentheses are a real node,
    // and §3.1's forwarding is what carries the expectation through them.
    expect(projectDiagnostics(
      "let apply(transform: (Int) -> String, value: Int): String = transform(value)\n" +
        "export let a: String = apply((match\n" +
        guardOnly("    ") +
        "), 3)\n",
    )).toEqual([]);
  });

  test("a block's final expression", () => {
    expect(conducts(
      "    let prefix = \"negative\"\n" +
        "    match\n" +
        "        n when n < 0 => prefix\n" +
        "        _ => \"other\"\n",
    )).toEqual([]);
  });

  test("both branches of `if`", () => {
    expect(conducts(
      "    if flag then\n" +
        "        match\n" +
        guardOnly("            ") +
        "    else\n" +
        "        match\n" +
        "            n when n > 0 => \"positive\"\n" +
        "            _ => \"other\"\n",
    )).toEqual([]);
  });

  test("every arm body of `match`", () => {
    expect(conducts(
      "    match flag\n" +
        "        True => match\n" +
        guardOnly("            ") +
        "        False => match\n" +
        "            n when n > 0 => \"positive\"\n" +
        "            _ => \"other\"\n",
    )).toEqual([]);
  });

  test("a `try`'s body block, and its catch arm bodies", () => {
    expect(projectDiagnostics(
      "exception Boom(reason: String)\n" +
        "let sign: (Int) -> String =\n" +
        "    try\n" +
        "        match\n" +
        guardOnly("            ") +
        "    catch\n" +
        "        Boom(_) => match\n" +
        "            n when n > 0 => \"positive\"\n" +
        "            _ => \"other\"\n" +
        "export let a: String = sign(3)\n",
    )).toEqual([]);
  });

  /**
   * The **one-sided** shapes, for every branching form that forwards.
   *
   * A specimen with a match function in *both* branches proves less than it
   * looks: the seat only has to notice one of them to open, so the second read
   * is never exercised and a compiler that consulted only the first would pass.
   * Each pin below puts the lambda in exactly one branch and an ordinary
   * reference in the other, so every branch read is load-bearing on its own.
   */
  describe("one branch at a time", () => {
    const other = "let other: (Int) -> String = value => \"other\"\n";

    const oneSided = (body: string): readonly string[] =>
      projectDiagnostics(
        other +
          "let flag: Bool = True\n" +
          `let sign: (Int) -> String =\n${body}` +
          "export let a: String = sign(3)\n",
      );

    test("`if` — the lambda in only the *then* branch", () => {
      expect(oneSided(
        "    if flag then\n" +
          "        match\n" +
          guardOnly("            ") +
          "    else\n" +
          "        other\n",
      )).toEqual([]);
    });

    test("`if` — the lambda in only the *else* branch", () => {
      expect(oneSided(
        "    if flag then\n" +
          "        other\n" +
          "    else\n" +
          "        match\n" +
          guardOnly("            "),
      )).toEqual([]);
    });

    test("`match` — the lambda in only the first arm body", () => {
      expect(oneSided(
        "    match flag\n" +
          "        True => match\n" +
          guardOnly("            ") +
          "        False => other\n",
      )).toEqual([]);
    });

    test("`match` — the lambda in only the last arm body", () => {
      expect(oneSided(
        "    match flag\n" +
          "        True => other\n" +
          "        False => match\n" +
          guardOnly("            "),
      )).toEqual([]);
    });

    test("`try` — the lambda in only the body", () => {
      expect(projectDiagnostics(
        "exception Boom(reason: String)\n" +
          other +
          "let sign: (Int) -> String =\n" +
          "    try\n" +
          "        match\n" +
          guardOnly("            ") +
          "    catch\n" +
          "        Boom(_) => other\n" +
          "export let a: String = sign(3)\n",
      )).toEqual([]);
    });

    test("the match catch clause — the lambda in only a catch arm body", () => {
      // Catch arms occupy two seats with one grammar (Pattern Matching §6.2),
      // and the clause on a `match` is the second. Its arm bodies are value
      // paths of the construct exactly as `try`'s are, so they forward too.
      expect(projectDiagnostics(
        "exception Boom(reason: String)\n" +
          other +
          "let risky(flag: Bool): Bool = if flag then throw(Boom(\"x\")) else True\n" +
          "let flag: Bool = True\n" +
          "let sign: (Int) -> String =\n" +
          "    match risky(flag)\n" +
          "        True => other\n" +
          "        False => other\n" +
          "    catch\n" +
          "        Boom(_) => match\n" +
          guardOnly("            ") +
          "export let a: String = sign(3)\n",
      )).toEqual([]);
    });

    test("`try` — the lambda in only a catch arm body", () => {
      expect(projectDiagnostics(
        "exception Boom(reason: String)\n" +
          other +
          "let sign: (Int) -> String =\n" +
          "    try\n" +
          "        other\n" +
          "    catch\n" +
          "        Boom(_) => match\n" +
          guardOnly("            ") +
          "export let a: String = sign(3)\n",
      )).toEqual([]);
    });
  });

  test("no other form forwards: a tuple component declines", () => {
    // The pin that makes "no other form forwards" a claim with teeth. A tuple
    // literal's components synthesize exactly as before, so the match function
    // sees a variable and takes §6.1's refusal with the rider — even though the
    // annotation one line up spells its parameter type.
    expect(projectDiagnostics(
      "let pair: ((Int) -> String, Int) = (match\n" +
        guardOnly("    ") +
        ", 1)\n",
    )).toEqual([rider]);
  });
});

describe("the decline paths (§4.3)", () => {
  test("arity mismatch yields the seat's ordinary error, with no propagation artifact", () => {
    // Silent means silent: no diagnostic names propagation, in either outcome.
    const diagnostics = projectDiagnostics("let f: (Int, Int) -> String = x => \"a\"\n");
    expect(diagnostics).toEqual(["function arity mismatch: 2 and 1"]);
    for (const message of diagnostics) {
      expect(message).not.toMatch(/expected type|propagat/iu);
    }
  });

  test("a dot call whose receiver is still unsolved at the dot declines", () => {
    // Method Syntax §3.6's asymmetry, on the arguments' side: the goal pends,
    // the arguments synthesize, and the arms see a variable. Evidence arriving
    // later resolves the dispatch identically but cannot hand expectations to
    // arguments already checked.
    expect(projectDiagnostics(
      "fun go(v) = v.map(match\n" + guardOnly("    ") + ")\n",
    )).toEqual([rider]);
  });

  test("a data-last call to a generic callee declines; the concrete shape supplies", () => {
    const generic = "let apply(transform: (a) -> b, values: Vector(a)): Vector(b) =\n" +
      "    [transform(values[0])]\n";
    const concrete = "let apply(transform: (Int) -> String, values: Vector(Int)): Vector(String) =\n" +
      "    [transform(values[0])]\n";
    const call = "let xs: Vector(Int) = [1]\n" +
      "export let ys: Vector(String) = apply(match\n" +
      guardOnly("    ") +
      ", xs)\n";

    // At the callback's turn the instantiation is unresolved — the subject
    // stands to its *right* — so the arms see a variable.
    expect(projectDiagnostics(generic + call)).toEqual([rider]);
    // The same shape at concrete parameter types supplies and succeeds.
    expect(projectDiagnostics(concrete + call)).toEqual([]);
  });

  test("a bare unannotated binding still refuses, with the rider", () => {
    // No seat, and defaulting does not rescue a dispatch that fired
    // mid-inference.
    expect(projectDiagnostics("let f = match\n" + guardOnly("    "))).toEqual([rider]);
  });
});

describe("the ordering pin (§4.3)", () => {
  test("the widening pair: the propagated face is not a widening boundary", () => {
    // Both members. Propagation moves unifications earlier; it does not move
    // `Float` into the body's arithmetic (Numeric Literals §5.1's
    // "independently established" list is closed against it).
    expect(projectDiagnostics("let g: (Int) -> Float = x => x + x\n"))
      .toEqual(["type mismatch: expected Float, found Int"]);
    // The *written* return annotation is a widening boundary, as it always was.
    expect(projectDiagnostics(
      "let g = (x: Int): Float => x + x\nexport let a: Float = g(1)\n",
    )).toEqual([]);
  });

  test("the order race: a source-first lambda pins what a sibling then widens", () => {
    // The pin that guards the left-to-right order. `x => useFloat(p)` exactly
    // pins the enclosing parameter at `Float`; the sibling `p + one` then
    // widens to follow it. Under the two-pass order (lambdas last) the sibling
    // would type `p` at `Int` first and strand this program — which is why that
    // order is refused whole rather than adopted in part.
    const source = "let useFloat(value: Float): String = \"f\"\n" +
      "let one: Int = 1\n" +
      "let combine(label: (Int) -> String, total: Float): String = label(0)\n" +
      "fun race(p) = combine(x => useFloat(p), p + one)\n" +
      "export let a: String = race(1.5)\n";
    expect(projectDiagnostics(source)).toEqual([]);
    expect(schemeOf(source, "race")).toMatchObject({
      parameters: [{ kind: "Primitive", name: "Float" }],
      result: { kind: "Primitive", name: "String" },
    });
  });

  test("a mismatched argument reports once, however many landings precede it", () => {
    // The prefix and the closing sweep partition the arguments: every index is
    // dispositioned by exactly one of them. An argument the prefix declines is
    // left where it stands rather than filed, or each later landing — and the
    // sweep after them — would file it again, and a copy of a *failing*
    // unification is a copy of its diagnostic.
    //
    // Here `n` is an `Int` against the variable parameter `a`, so it is
    // deferred; two match-function arguments follow it, each opening a prefix;
    // and `"boom"` then settles `a` at `String`, which the deferred `Int` no
    // longer meets. The named-function spelling of the same call is the
    // control — it lands nothing, opens no prefix, and has always reported once.
    const call = (callbacks: string): string =>
      "let g(a1: a, m1: (Int) -> String, m2: (Int) -> String, a2: a): String = \"x\"\n" +
      "let n: Int = 1\n" +
      "let sign: (Int) -> String = match\n" +
      guardOnly("    ") +
      `export let r: String = g(n, ${callbacks}, "boom")\n`;

    const landings = "match\n" + guardOnly("    ") + ", match\n" + guardOnly("    ");
    expect(projectDiagnostics(call(landings)))
      .toEqual(["type mismatch: expected String, found Int"]);
    expect(projectDiagnostics(call("sign, sign")))
      .toEqual(["type mismatch: expected String, found Int"]);
  });

  test("the callee-position flavours keep compiling at `p : Float` (#517's ledger)", () => {
    // An application elaborates its callee before its arguments, and the pipe
    // rewrites to exactly such an application. Both lambda-literal callee kinds
    // are pinned here: the plain lambda, and the match function whose patterns
    // fix its own type. A free reference in the callee's body pins `p` at
    // `Float` before the argument's arithmetic is ever reached; argument-first
    // would re-type it at `Int` and strand these callers.
    const plain = "let useFloat(value: Float): String = \"f\"\n" +
      "let one: Int = 1\n" +
      "fun flavour(p) = (p + one) |> (x => useFloat(p))\n" +
      "export let a: String = flavour(1.5)\n";
    const matched = "let useFloat(value: Float): String = \"f\"\n" +
      "let one: Int = 1\n" +
      "fun flavour(p) = (show(p + one)) |> match\n" +
      "    \"0\" => useFloat(p)\n" +
      "    _ => \"other\"\n" +
      "export let a: String = flavour(1.5)\n";

    for (const source of [plain, matched]) {
      expect(projectDiagnostics(source)).toEqual([]);
      expect(schemeOf(source, "flavour")).toMatchObject({
        parameters: [{ kind: "Primitive", name: "Float" }],
      });
    }
  });
});

describe("the pipe seat's deferral (#517)", () => {
  test("a guard-only pipe match refuses with the rider, in both §6.7 spellings", () => {
    // The seat is deferred *whole*: `value |> match …` is the application whose
    // callee is a lambda literal, and that seat would need the argument
    // elaborated before the callee's body — the reorder the pins above forbid.
    // So both spellings synthesize alike, and the rider's first rewrite (a
    // preceding annotated `let`, then `value |> classify`) is the working pipe
    // spelling.
    const written = projectDiagnostics(
      "let classify: (Int) -> String = value =>\n" +
        "    value |> (v =>\n" +
        "        match v\n" +
        "            n when n > 0 => \"positive\"\n" +
        "            _ => \"other\")\n",
    );
    const desugared = projectDiagnostics(
      "let classify: (Int) -> String = value =>\n" +
        "    value |> match\n" +
        "        n when n > 0 => \"positive\"\n" +
        "        _ => \"other\"\n",
    );
    expect(desugared).toEqual([rider]);
    expect(written).toEqual(desugared);
  });

  test("the rider's own rewrite is the working pipe spelling", () => {
    expect(projectDiagnostics(
      "let classify: (Int) -> String = match\n" +
        "    n when n > 0 => \"positive\"\n" +
        "    _ => \"other\"\n" +
        "export let a: String = 3 |> classify\n",
    )).toEqual([]);
  });

  test("a literal-heavy pipe match compiles exactly as it does without propagation", () => {
    expect(projectDiagnostics(
      "export fun classify(value: Int): String = value |> match\n" +
        "    0 => \"zero\"\n" +
        "    _ => \"other\"\n",
    )).toEqual([]);
  });
});

describe("Pattern Matching §6.1's refusal, reduced and re-worded", () => {
  test("a declared type variable keeps the constraint-operations advice, and names itself", () => {
    // Determined, and abstract by declaration. The name was missing from the
    // shipped report; §6.1 has always quoted it.
    expect(projectDiagnostics(
      "export let describe<a: Show>(value: a): String = match value\n" +
        "    _ => \"x\"\n",
    )).toEqual([
      "cannot match on a value of abstract type `a`; " +
        "use the operations its constraints provide",
    ]);
  });

  test("a `Float` scrutinee is matchable, with the catch-all §7.1 demands", async () => {
    // The specimen a supplying seat can now hand to the dispatch. §6.1 admits
    // any scrutinee but its two permanent exclusions; §2.5 bans the Float
    // *literal pattern* alone.
    const exports = await runMain(
      "let f: (Float) -> String = match\n" +
        "    n when n < 0.5 => \"small\"\n" +
        "    _ => \"big\"\n" +
        "export let a: String = f(0.25)\n" +
        "export let b: String = f(2.5)\n",
    );
    expect([exports["a"], exports["b"]]).toEqual(["small", "big"]);

    // Guards contribute nothing to exhaustiveness (§7.1), here as everywhere.
    expect(projectDiagnostics(
      "let f: (Float) -> String = match\n" +
        "    n when n < 0.5 => \"small\"\n",
    )).toEqual(["a match on `Float` needs a catch-all pattern"]);

    // And §2.5's ban stands: `Int` and `String` are the literal-pattern types,
    // so an integer literal against a `Float` scrutinee is the ordinary
    // mismatch, and a `Float` literal never parses as a pattern at all.
    expect(projectDiagnostics(
      "let f: (Float) -> String = match\n" +
        "    0 => \"zero\"\n" +
        "    _ => \"other\"\n",
    )).toEqual(["type mismatch: expected Float, found Int"]);
    expect(projectDiagnostics(
      "let f: (Float) -> String = match\n" +
        "    1.5 => \"one and a half\"\n" +
        "    _ => \"other\"\n",
    )).toContain(
      "Float literals cannot appear in patterns; bind a name and compare it in a guard",
    );
  });
});

describe("monotonicity spot-checks (§4.3)", () => {
  test("a callback lambda infers what it always did", () => {
    const source = "let xs: Seq(Int) = [1, 2].toSeq()\n" +
      "export let ys: Seq(Int) = Seq.map(xs, x => x + 1)\n";
    expect(projectDiagnostics(source)).toEqual([]);
  });

  test("a row-polymorphic bare parameter is untouched", () => {
    // Method Syntax §3.5: `fun f(r) = r.callback(3)` infers
    // `{callback: Int -> a, ...} -> a` exactly as before this spec existed.
    const source = "export fun getX(p: {x: Int, ...a}): Int = p.x\n" +
      "fun apply(r) = r.callback(3)\n" +
      "export let used: Int = apply({callback = (n: Int) => n})\n";
    expect(projectDiagnostics(source)).toEqual([]);
  });

  test("a sibling argument still establishes an earlier one's type", () => {
    // The Nat/Int deferral inside one call's argument check is untouched: an
    // argument still sitting on an unsolved variable is never decided from its
    // parameter ahead of a sibling that decides it.
    const source = "let g(a: Float, b: Int): String = \"x\"\n" +
      "let one: Int = 1\n" +
      "fun f(p) = g(p, p + one)\n" +
      "export let r: String = f(2)\n";
    expect(projectDiagnostics(source)).toEqual([]);
    expect(schemeOf(source, "f")).toMatchObject({
      parameters: [{ kind: "Primitive", name: "Int" }],
    });
  });

  test("an unsolved argument is still decided by its sibling, not by its parameter", () => {
    // The same race as the ordering pin above, in the shape the argument seat
    // could have broken: a *lambda* argument means the arguments to its left are
    // checked early, so the sweep stops at the first one that is not already
    // concrete. `p` establishes nothing at its turn; the lambda's body decides
    // it, and the first argument then widens to `Float` exactly as it did
    // before propagation existed. Unifying `p` from its parameter here would
    // type it `Float` and break the body.
    const source = "let useInt(value: Int): String = \"i\"\n" +
      "let g(a: Float, b: (Int) -> String): String = b(0)\n" +
      "fun f(p) = g(p, x => useInt(p))\n" +
      "export let r: String = f(2)\n";
    expect(projectDiagnostics(source)).toEqual([]);
    expect(schemeOf(source, "f")).toMatchObject({
      parameters: [{ kind: "Primitive", name: "Int" }],
    });
  });

  test("the generalized scheme of a polymorphic binding is unchanged", () => {
    const source = "export fun identity(value: a): a = value\n" +
      "export let apply(transform: (a) -> b, value: a): b = transform(value)\n";
    expect(projectDiagnostics(source)).toEqual([]);
    expect(schemeOf(source, "apply")).toMatchObject({ kind: "Function" });
  });
});

function schemeOf(source: string, name: string): unknown {
  const project = compileMain(source);
  const main = project.modules.find(({ source: file }) => file.path === "/main.hex")!;
  const found = main.typed.symbols.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`expected symbol ${name}`);
  return found.scheme.type;
}
