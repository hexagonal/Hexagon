/**
 * Conformance for expression-level type ascription — `(e: Type)` — per
 * `spec/ascription.md` §9.8, one observation per obligation.
 *
 * The ruling's whole claim is that the form introduces **zero new semantics**
 * (§1): an ascription does to an expression exactly what a `let` annotation does
 * to a binding. So the assertions below are mostly equalities between an
 * ascribed program and the program that means the same thing another way — the
 * form in which "nothing new happened" is actually falsifiable — plus the four
 * error paths, which are where a rigid variable's contract is observable.
 */

import { describe, expect, test } from "vitest";

import { AnalysisSession } from "../analysis/session.js";
import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";
import * as Typed from "../syntax/typed/index.js";

/** The scheme the checker gave a top-level binding, as it renders it. */
function scheme(source: string, name: string): string {
  const compiled = compileMain(source);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const typed = compiled.modules.find(({ source: file }) => file.path === "/main.hex")!.typed;
  const symbol = typed.symbols.find(
    (candidate) =>
      candidate.name === name &&
      candidate.kind !== "parameter" &&
      candidate.bindingSpan.fileId === typed.fileId,
  );
  if (symbol === undefined) throw new Error(`no symbol \`${name}\``);
  return Typed.displayScheme(symbol.scheme);
}

/** `/main.hex`'s emitted JavaScript, with blank lines dropped. */
function emission(source: string): string {
  const compiled = compileMain(source);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  return compiled.modules
    .find(({ source: file }) => file.path === "/main.hex")!
    .javascript.text.split("\n").filter((line) => line.trim() !== "").join("\n");
}

/** `/main.hex`'s emitted `.d.ts`. */
function declarations(source: string): string {
  const compiled = compileMain(source);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  return compiled.modules
    .find(({ source: file }) => file.path === "/main.hex")!
    .declarations.text;
}

/**
 * `Tag` is deliberately non-defaultable: under `Num` the variable is gone before
 * any of the seat rules are observable. Lifted from `value-list.test.ts`, which
 * learned that the hard way.
 */
const TAG = "constraint Tag<a> =\n" +
  "    label(value: a): String\n" +
  "honor Tag<String> =\n" +
  '    label(value) = "string"\n' +
  "fun describe<a: Tag>(value: a): String = label(value)\n";

/**
 * §3.1's orphan specimen calls `ignore`, which the mandated prelude does not yet
 * supply (#313), so the module declares its own. Nothing about the observation
 * depends on whose it is — the point is a call that consumes the ascription and
 * whose result type mentions nothing of it.
 */
const IGNORE = "fun ignore<a>(value: a): Unit = ()\n";

// Proves this file's harness can observe a failure.
test("the harness reports a broken module rather than passing it", () => {
  expect(projectDiagnostics("export let broken: Int = missing(1)\n").length).toBeGreaterThan(0);
});

describe("§3.1 the four-example block", () => {
  test("`let f(x: a): a = (x : a)` — the inner `a` IS the declaration's", () => {
    // The observation that makes this line worth writing down is not that it
    // compiles but that it compiles *without narrowing*: `f` is still fully
    // general. A fresh-per-ascription `a` would meet the signature's and give
    // "distinct declared type variables".
    expect(scheme(
      "let f(x: a): a = (x : a)\nexport let out: Int = f(1)\n",
      "f",
    )).toBe("a -> a");
  });

  test("`let id = (x => x : a -> a)` — the identity genuinely is that general", () => {
    expect(scheme(
      "let id = (x => x : a -> a)\nexport let out: Int = id(1)\n",
      "id",
    )).toBe("a -> a");
  });

  test("`let inc = (x => x + 1 : a -> a)` — `inc : <a: Num> a -> a`", () => {
    // The accumulation contract at work, and deliberately not an error: `+`
    // demands `Num`, the demand accumulates on rigid `a`, and `inc` elaborates
    // constrained-polymorphic. This is the line that separates Hexagon from
    // OCaml's silent monomorphization (§7 item 1).
    expect(scheme(
      "let inc = (x => x + 1 : a -> a)\nexport let out: Int = inc(1)\n",
      "inc",
    )).toBe("<a: Num> a -> a");
  });

  test("...and `inc` is usable at two numeric types", () => {
    // The scheme is the claim; two call sites are the proof. One numeric type
    // would be satisfied by a monomorphized `a` too.
    expect(projectDiagnostics(
      "let inc = (x => x + 1 : a -> a)\n" +
        "export let i: Int = inc(1)\n" +
        "export let f: Float = inc(1.5)\n",
    )).toEqual([]);
  });

  test("`let n = (42 : a)` — defaulting reaches declared `a`; rigidity refuses", () => {
    // The proof pair's second half at expression granularity (closure doc §6.2).
    // §5 words this row for *this* spelling: no body demanded `Int`, defaulting
    // proposed it, so the binder spelling's "the body requires `Int`" would
    // misdescribe what happened.
    const messages = projectDiagnostics("let n = (42 : a)\nexport let out: Int = 1\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe(
      "`a` is a declared type variable, but `42` can be only a `Num` type; " +
        "ascribe the concrete type you mean — `(42 : Int)` — or remove the " +
        "ascription to let the literal default to `Int`",
    );
    // The Rewrite Rule: both named edits have to compile.
    expect(projectDiagnostics("let n = (42 : Int)\nexport let out: Int = n\n")).toEqual([]);
    expect(projectDiagnostics("let n = 42\nexport let out: Int = n\n")).toEqual([]);
  });

  test("the binder spelling keeps Functions §10's own wording", () => {
    // The two spellings are different reports on purpose. Pinned so a later
    // simplification cannot quietly collapse them onto one sentence.
    const messages = projectDiagnostics("let n: a = 42\nexport let out: Int = 1\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("the body requires `Int`");
    expect(messages[0]).not.toContain("ascribe");
  });
});

describe("§3.1 the annotation scope is the declaration's", () => {
  test("two ascriptions in one declaration write the same variable", () => {
    // The mutation-coverage observation §9.8 asks for. Under a
    // fresh-per-ascription reading each `a` is its own variable, each refuses
    // defaulting on its own, and this reports *twice*. One report is the join.
    const messages = projectDiagnostics(
      "let pair = ((1 : a), (2 : a))\nexport let out: Int = 1\n",
    );
    expect(messages).toHaveLength(1);
  });

  test("an ascription joins the signature's variable rather than shadowing it", () => {
    // Fresh-per-ascription would make the body's `a` distinct from the
    // parameter's, and `#bind`'s rigid-versus-rigid arm would say so.
    expect(projectDiagnostics(
      "let pick(x: a, y: a): a = (if 1 == 1 then x else y : a)\n" +
        "export let out: Int = pick(1, 2)\n",
    )).toEqual([]);
  });

  test("two different declarations do not share a variable", () => {
    // The scope is one declaration (§3.1), so the second `let` starts clean —
    // a module-wide scope would hand it a variable the first already quantified.
    expect(projectDiagnostics(
      "let id = (x => x : a -> a)\n" +
        "let other = (y => y : a -> a)\n" +
        "export let out: Int = id(other(1))\n",
    )).toEqual([]);
  });
});

describe("§2.2 the colon ends the element", () => {
  test("`(x => x : a -> a)` ascribes the LAMBDA", () => {
    // Not `x => (x : a -> a)`: `:` binds loosest within an element, so the whole
    // eats-right form is what gets ascribed. Reading it the other way would
    // demand `x : a -> a` and give `id : (a -> a) -> a -> a`.
    expect(scheme(
      "let id = (x => x : a -> a)\nexport let out: Int = id(1)\n",
      "id",
    )).toBe("a -> a");
  });

  test("`(if p then 1 else 2 : Int)` ascribes the if-expression", () => {
    expect(scheme(
      "let v = (if 1 == 1 then 1 else 2 : Int)\nexport let out: Int = v\n",
      "v",
    )).toBe("Int");
  });

  test("to ascribe inside such a form, parenthesize inside it", () => {
    // §2.2's stated resolution, and the shape that distinguishes the two
    // readings: here `x` is `Int` and the lambda is `Int -> Int`.
    expect(scheme(
      "let f = x => (x : Int)\nexport let out: Int = f(1)\n",
      "f",
    )).toBe("Int -> Int");
  });
});

describe("§2.3 the lambda-header lookalike", () => {
  test("`(a: Int, b)` with no arrow is a tuple of ascribed components", () => {
    expect(scheme(
      'let t = (1: Int, "x")\nexport let out: Int = 1\n',
      "t",
    )).toBe("(Int, String)");
  });

  test("`(a: Int, b) => e` is still a lambda", () => {
    expect(scheme(
      "let f = (a: Int, b) => a\nexport let out: Int = f(1, 2)\n",
      "f",
    )).toBe("(Int, a) -> Int");
  });

  test("`(params): T => body` is still an annotated lambda", () => {
    expect(scheme(
      "let f = (x): Int => x + 1\nexport let out: Int = f(1)\n",
      "f",
    )).toBe("Int -> Int");
  });

  test("`(params): T -> U => body` — a function-typed return annotation too", () => {
    // The tightened scan steps over arrows inside the type; stopping at the
    // first `->` would refuse this lambda.
    expect(scheme(
      "let f = (x: Int): Int -> Int => (y => y + x)\nexport let out: Int = f(1)(2)\n",
      "f",
    )).toBe("Int -> Int -> Int");
  });

  test("`((a, b): (Int, String)) |> map(x => x)` is an ascription, not a lambda head", () => {
    // §2.3's specimen, arrow included: a colon after an inner `)` with an
    // *unrelated* `=>` later on the same line. The scan the arrow has to be
    // there to falsify — without one it stops at the layout boundary and gets
    // the right answer for the wrong reason.
    expect(projectDiagnostics(
      "let mapFirst(p: (Int, String), g: (Int) -> Int): Int = g(p.item1)\n" +
        'let a = 1\nlet b = "x"\n' +
        "export let out: Int = ((a, b): (Int, String)) |> mapFirst(x => x)\n",
    )).toEqual([]);
  });

  test("`f(((a, b): (Int, String)), z => z)` is an ascription too", () => {
    // The same shape with a real lambda as a later argument, so the arrow the
    // old scan would have latched onto genuinely exists.
    expect(projectDiagnostics(
      "let apply(p: (Int, String), g: (Int) -> Int): Int = g(p.item1)\n" +
        'let a = 1\nlet b = "x"\n' +
        "export let out: Int = apply(((a, b): (Int, String)), z => z)\n",
    )).toEqual([]);
  });
});

describe("§5 the diagnostics this spec re-mechanizes and retires", () => {
  test("`(x: 1, y: 2)` still errors with Products §2.2's record hint", () => {
    const messages = projectDiagnostics("let p = (x: 1, y: 2)\nexport let out: Int = 1\n");
    expect(messages).toContain(
      "tuples are positional; for named fields use a record: `{x = 1, y = 2}`",
    );
    // The Rewrite Rule: the named rewrite compiles.
    expect(projectDiagnostics(
      "let p = {x = 1, y = 2}\nexport let out: Int = p.x\n",
    )).toEqual([]);
  });

  test("the hint arises one token later — on the term, not the colon", () => {
    // §5's mechanism sentence: the element colon is grammar now, and `1` is a
    // term where a type must stand. Carets the `1`, not the `:`.
    const source = "let p = (x: 1, y: 2)\nexport let out: Int = 1\n";
    const diagnostic = compileMain(source).diagnostics.find(({ message }) =>
      message.startsWith("tuples are positional")
    )!;
    expect(source.slice(diagnostic.primary.start.offset, diagnostic.primary.end.offset)).toBe("1");
  });

  test("`(x: Int, y: String)` parses, as a tuple of ascribed components", () => {
    // The deliberate flip side of the hint: the same surface shape with types in
    // it is the ascription reading, not named elements. `x` and `y` are the
    // *terms* being ascribed here, which is exactly the reading claimed.
    expect(scheme(
      'let x = 1\nlet y = "s"\nlet p = (x: Int, y: String)\nexport let out: Int = 1\n',
      "p",
    )).toBe("(Int, String)");
  });

  test("`(42: Nat)` no longer dies at the colon", () => {
    // The retired parse error. That token is grammar; there is no shim, because
    // the spelling had no prior meaning.
    expect(projectDiagnostics("let q = (42: Nat)\nexport let out: Nat = q\n")).toEqual([]);
  });

  test("a mismatch reports against the written type, at the ascribed expression", () => {
    const source = 'let n = ("s" : Int)\nexport let out: Int = 1\n';
    const messages = projectDiagnostics(source);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("expected Int");
    expect(messages[0]).toContain("found String");
  });

  test("the ascription introduces no conversion of its own", () => {
    // §3's no-coercion bullet, asserted the only way it is falsifiable here: an
    // ascription admits exactly what the equivalent `let` annotation admits and
    // nothing besides. The numeric *widening* both accept is Numeric Literals'
    // rule reaching an annotated position, and it reaches this one identically —
    // which is §1's claim, not an exception to it.
    expect(projectDiagnostics("let x: Int = 1\nlet y = (x : Float)\nexport let out: Float = y\n"))
      .toEqual(projectDiagnostics("let x: Int = 1\nlet y: Float = x\nexport let out: Float = y\n"));
    // What no annotation admits, the ascription does not admit either.
    const messages = projectDiagnostics(
      'let x: String = "s"\nlet y = (x : Float)\nexport let out: Int = 1\n',
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join("\n")).toContain("Float");
  });
});

describe("§4 emission: an ascription erases", () => {
  test("`(42: Nat)` emits exactly as the bare literal does", () => {
    // The export carries its own signature either way (Modules §4.1.1) — an
    // ascription is a body position and does not stand in for one — so the two
    // programs differ in exactly the ascription.
    const ascribed = emission("export let q: Nat = (42: Nat)\n");
    expect(ascribed).toBe(emission("export let q: Nat = 42\n"));
    expect(ascribed).toContain("42");
    // No wrapper, no comment, nothing naming the type.
    expect(ascribed).not.toContain("Nat");
  });

  test("an ascription leaves no `.d.ts` trace", () => {
    // The declaration surfaces are computed from types, which the ascription
    // only ever influenced through ordinary unification (§4).
    expect(declarations("export let q: Nat = (42: Nat)\n"))
      .toBe(declarations("export let q: Nat = 42\n"));
  });

  test("parenthesization follows precedence, not the ascription", () => {
    expect(emission("export let q: Int = (42: Int) + (1: Int)\n"))
      .toBe(emission("export let q: Int = 42 + 1\n"));
  });

  test("an ascribed program runs", async () => {
    // Vary the emitted value from every other executed specimen in this file:
    // two conformance tests emitting byte-identical JavaScript share one ESM
    // `data:` URL module instance.
    const exports = await runMain(
      "export let total: Int = ((17 : Int) + (4 : Int) : Int)\n",
    );
    expect(exports.total).toBe(21);
  });
});

describe("§3.2 holes in ascribed types", () => {
  test("`(e : Vector(_))` claims the constructor and infers the element", () => {
    expect(scheme(
      "let v = ([1, 2] : Vector(_))\nexport let out: Int = Vector.length(v)\n",
      "v",
    )).toBe("Vector(Int)");
  });

  test("`(e : Vector(_))` still rejects a non-vector", () => {
    // The claim written *around* the hole is a claim like any other.
    const messages = projectDiagnostics(
      'let v = ("no" : Vector(_))\nexport let out: Int = 1\n',
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join("\n")).toContain("Vector");
  });

  test("the constrained-hole floor: `(x => x + 1 : (_ : Num) -> _)`", () => {
    // §3.1's written floor — the same generality `inc` gets, claimed without a
    // variable. The seed is a floor, not a cap: accumulation continues past it.
    expect(scheme(
      "let g = (x => x + 1 : (_ : Num) -> _)\nexport let out: Int = g(1)\n",
      "g",
    )).toBe("<a: Num> a -> a");
  });

  test("a whole-type constrained hole is a floor with no structure claim", () => {
    expect(projectDiagnostics(
      "export let total: Int = ((1 + 1) : _ : Num)\n",
    )).toEqual([]);
  });

  test("`let n = (42 : _)` defaults to `Int`", () => {
    // §6.2: the hole is an ordinary inference variable, so the literal defaults
    // through it exactly as `let n: _ = 42` does. This is the line that makes
    // the declared-variable refusal above a *contract*, not an accident.
    expect(scheme("let n = (42 : _)\nexport let out: Int = n\n", "n")).toBe("Int");
    expect(scheme("let n = (42 : _)\nexport let out: Int = n\n", "n"))
      .toBe(scheme("let n: _ = 42\nexport let out: Int = n\n", "n"));
  });

  test("the fence never fires on a body position", () => {
    // An ascription is a body position, and the total-contract fence governs
    // export and declaration *surfaces* (§3.2). An exported definition's body
    // admits holes exactly as a private one does.
    expect(projectDiagnostics(
      "export let count(xs: Vector(Int)): Int = Vector.length((xs : Vector(_)))\n",
    )).toEqual([]);
  });
});

describe("§9.3 the four declared-variable error paths", () => {
  test("(1) defaulting refusal at a non-function value binding", () => {
    const messages = projectDiagnostics("let n = (42 : a)\nexport let out: Int = 1\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`a` is a declared type variable");
    expect(messages[0]).toContain("can be only a `Num` type");
  });

  test("(2) the declined seat at a non-function value binding", () => {
    // Functions §8's evidence-seat arm keys on an annotated binding's declared
    // variable; here the binder has no annotation and the *ascription* declared
    // the variable. Declaredness, not the binder's punctuation, is the key.
    const messages = projectDiagnostics(
      `${TAG}let holder = { f = (describe : a -> String) }\nexport let out: Int = 1\n`,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`a` is a declared type variable");
    expect(messages[0]).toContain("cannot carry its `Tag` constraint");
    expect(messages[0]).toContain("evidence rides only a function's trailing parameters");
    // The Rewrite Rule: both named edits compile.
    expect(projectDiagnostics(
      `${TAG}let holder = { f = (describe : String -> String) }\n` +
        'export let out: String = (holder.f)("x")\n',
    )).toEqual([]);
    expect(projectDiagnostics(
      `${TAG}let holder = { f = describe }\nexport let out: String = (holder.f)("x")\n`,
    )).toEqual([]);
  });

  test("(2) reports where the binder spelling reports, and says the same thing", () => {
    // The arm is one arm. If the ascription path grew its own sentence the two
    // spellings would describe one rule two ways.
    const ascribed = projectDiagnostics(
      `${TAG}let holder = { f = (describe : a -> String) }\nexport let out: Int = 1\n`,
    );
    const annotated = projectDiagnostics(
      `${TAG}let holder: { f: a -> String } = { f = describe }\nexport let out: Int = 1\n`,
    );
    expect(ascribed).toEqual(annotated);
  });

  test("(3) the destructuring case: a component cannot pin a rigid variable", () => {
    // A destructuring `let`'s components never quantify constrained variables,
    // and a rigid variable cannot be pinned — so the ascription-declared `a`
    // the destructuring sentence would otherwise pin is the same hard error.
    const messages = projectDiagnostics(
      `${TAG}let (g, n) = ((describe : a -> String), 1)\nexport let out: Int = 1\n`,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`a` is a declared type variable");
    expect(messages[0]).toContain("cannot carry its `Tag` constraint");
  });

  test("(3) the same destructuring without the ascription still compiles", () => {
    // The error is about the *claim*, not about destructuring: without a
    // declared variable the component declines and pins at its first use, which
    // is what every expansive binding already does.
    expect(projectDiagnostics(
      `${TAG}let (g, n) = (describe, 1)\nexport let out: String = g("x")\n`,
    )).toEqual([]);
  });

  test("(4) the orphaned variable: an error at the declaration, never a default", () => {
    // §3.1's newly reachable corner: `a` occurs nowhere in the declaration's
    // type, so it would quantify with the function and no call site could ever
    // determine its evidence. It must be surfaced, not quietly defaulted.
    const messages = projectDiagnostics(
      `${IGNORE}let f() = ignore((42 : a))\nexport let out: Int = 1\n`,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`a` is a declared type variable");
    // Not defaulted: `f`'s scheme never acquired an `Int` nobody wrote.
    expect(projectDiagnostics(
      `${IGNORE}let f() = ignore((42 : Int))\nexport let out: Int = 1\n`,
    )).toEqual([]);
  });

  test("(4) an orphan defaulting cannot discharge is surfaced too", () => {
    // The `Num` orphan is caught by defaulting's own refusal. One carrying a
    // constraint defaulting never touches has no other reader, so without its
    // own report the declaration compiled with an obligation nothing can meet.
    const messages = projectDiagnostics(
      `${TAG}${IGNORE}let f() = ignore((describe : a -> String))\nexport let out: Int = 1\n`,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`a` is a declared type variable");
    expect(messages[0]).toContain("this declaration's type does not mention");
    expect(messages[0]).toContain("`Tag`");
  });
});

describe("§3 an ascription of a syntactic value is a syntactic value", () => {
  test("`let id = (x => x : a -> a)` generalizes as `let id = (x => x)` does", () => {
    // Functions §8's read-through gains the ascription wrapper. An ascription
    // wraps; it does not evaluate.
    const tail = "export let out: Int = id(1)\n";
    expect(scheme(`let id = (x => x : a -> a)\n${tail}`, "id"))
      .toBe(scheme(`let id = (x => x)\n${tail}`, "id"));
  });

  test("an ascribed computation is still expansive", () => {
    // The read-through reads *through*; it does not make a value of what is
    // underneath. A call is a call either way.
    const head = "fun make(): Vector(a) = []\n";
    const tail = "export let out: Int = Vector.length(xs)\n";
    expect(scheme(`${head}let xs = (make() : Vector(_))\n${tail}`, "xs"))
      .toBe(scheme(`${head}let xs = make()\n${tail}`, "xs"));
  });
});

describe("§9.5 the LSP reaches an ascribed type", () => {
  const session = (source: string): AnalysisSession => {
    const analysis = new AnalysisSession();
    analysis.setFile("/main.hex", source);
    return analysis;
  };

  test("hover on a hole in an ascription reports the fill", () => {
    const source = "let v = ([1, 2] : Vector(_))\nexport let out: Int = Vector.length(v)\n";
    const hover = session(source).hover("/main.hex", source.indexOf("Vector(_)") + 7);
    expect(hover?.name).toBe("_");
    expect(hover?.displayedType).toBe("Int");
  });

  test("go-to-definition reaches a type name inside an ascription", () => {
    const source = "record Point = {x: Int}\n" +
      "let p = (Point({x = 1}) : Point)\nexport let out: Int = p.x\n";
    const analysis = session(source);
    const definitions = analysis.definitions("/main.hex", source.lastIndexOf("Point"));
    expect(definitions.length).toBeGreaterThan(0);
    expect(definitions[0]!.span.start.offset).toBe(source.indexOf("Point"));
  });

  test("find-references counts the ascribed occurrence", () => {
    const source = "record Point = {x: Int}\n" +
      "let p = (Point({x = 1}) : Point)\nexport let out: Int = p.x\n";
    const analysis = session(source);
    const references = analysis.references("/main.hex", source.indexOf("Point"), {
      includeDeclaration: true,
    });
    // The declaration, the constructor call, and the ascribed type name.
    expect(references.map(({ span }) => span.start.offset))
      .toContain(source.lastIndexOf("Point"));
  });

  test("semantic tokens classify an ascribed type name as a type", () => {
    const source = "record Point = {x: Int}\n" +
      "let p = (Point({x = 1}) : Point)\nexport let out: Int = p.x\n";
    const tokens = session(source).semanticTokens("/main.hex");
    const ascribed = tokens.find(
      ({ span }) => span.start.offset === source.lastIndexOf("Point"),
    );
    expect(ascribed?.type).toBe("struct");
  });
});
