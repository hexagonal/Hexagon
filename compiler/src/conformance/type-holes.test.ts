/**
 * Conformance for type holes — `_` in type position — per the closure document
 * `spec/decisions-ml-dialect-annotations-2026-08.md` §8, one observation per
 * obligation. Functions §4.1 carries the surface.
 *
 * The ruling's whole claim is that a hole introduces *no new semantics*: it
 * elaborates to the same fresh variable an unannotated position gets (§4.1), and
 * unification, constraint accumulation, defaulting and generalization then reach
 * it unchanged. So most of what is asserted below is an equality between an
 * annotated program and its unannotated twin — the form in which "nothing new
 * happened" is actually falsifiable.
 */

import { describe, expect, test } from "vitest";

import { AnalysisSession } from "../analysis/session.js";
import { compileMain, projectDiagnostics } from "../support/test-project.js";
import * as Typed from "../syntax/typed/index.js";

/** The scheme the checker gave a top-level binding, as it renders it. */
function scheme(source: string, name: string): string {
  const compiled = compileMain(source);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const typed = compiled.modules.find(({ source: file }) => file.path === "/main.hex")!.typed;
  const symbol = typed.symbols.find(
    (candidate) => candidate.name === name && candidate.kind !== "parameter",
  );
  if (symbol === undefined) throw new Error(`no symbol \`${name}\``);
  return Typed.displayScheme(symbol.scheme);
}

// Proves this file's harness can observe a failure.
test("the harness reports a broken module rather than passing it", () => {
  expect(projectDiagnostics("export let broken: Int = missing(1)\n").length).toBeGreaterThan(0);
});

describe("§8.1 the proof pair", () => {
  test("§6.2 `let n: _ = 42` is inference wearing an annotation: `n : Int`", () => {
    // Numeric Literals §4 reaches the hole because the hole is an ordinary
    // inference variable. No clause anywhere mentions holes and defaulting.
    expect(scheme("let n: _ = 42\nexport let out: Int = n\n", "n")).toBe("Int");
  });

  test("§6.2 `let n: a = 42` is refused by Functions §10's forced-to-a-concrete-type row", () => {
    // The same rule reaches both halves and they diverge there: defaulting
    // reaches the variable either way, the hole accepts the narrowing and the
    // declared variable, being rigid, refuses it. Pinned to this row and not
    // merely to the family — the evidence-seat row is a different member, about
    // constraints defaulting cannot discharge, and it is not what fires here.
    const messages = projectDiagnostics("let n: a = 42\nexport let out: Int = n\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`a` is a declared type variable, but the body requires `Int`");
    // The Rewrite Rule: the diagnostic says what to write instead.
    expect(messages[0]).toContain("change the annotation to `Int`");
  });
});

describe("§8.2 the degenerate whole-type hole is inert", () => {
  test("§5.2 a hole-annotated parameter schemes exactly as a bare one", () => {
    const tail = "export let out: Int = f(1)\n";
    expect(scheme(`let f(x: _) = x\n${tail}`, "f")).toBe(scheme(`let f(x) = x\n${tail}`, "f"));
    expect(scheme(`let f(x: _) = x\n${tail}`, "f")).toBe("a -> a");
  });

  test("§5.2 a hole-annotated `let` binding schemes exactly as an unannotated one", () => {
    const tail = "export let out: Int = Vector.length(xs)\n";
    expect(scheme(`let xs: _ = [1]\n${tail}`, "xs")).toBe(scheme(`let xs = [1]\n${tail}`, "xs"));
  });

  test("§5.2 a hole in a `var` binding is inert too", () => {
    expect(projectDiagnostics(
      "export let out(): Int =\n    var total: _ = 0\n    total := total + 1\n    total\n",
    )).toEqual([]);
  });
});

describe("§8.3 a constructor-claim hole", () => {
  test("§5.1 `Vector(_)` accepts a vector", () => {
    expect(projectDiagnostics(
      "let count(xs: Vector(_)): Int = Vector.length(xs)\n" +
        "export let out: Int = count([1, 2])\n",
    )).toEqual([]);
  });

  test("§5.1 `Vector(_)` still rejects a non-vector", () => {
    // The claim written *around* the hole is a claim like any other.
    const messages = projectDiagnostics(
      "let count(xs: Vector(_)): Int = Vector.length(xs)\n" +
        'export let out: Int = count("no")\n',
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join("\n")).toContain("Vector");
  });

  test("§4.1 the element generalizes when nothing fixes it", () => {
    expect(scheme(
      "let count(xs: Vector(_)): Int = Vector.length(xs)\n" +
        "export let out: Int = count([1])\n",
      "count",
    )).toBe("Vector(a) -> Int");
  });
});

describe("§8.4 holes are independent", () => {
  test("§4.1 two holes in one annotation fill independently", () => {
    expect(projectDiagnostics(
      'let pair(p: (_, _)): Int = 1\nexport let out: Int = pair((1, "two"))\n',
    )).toEqual([]);
  });

  test("§2.3 a hole links nothing — unlike a written variable", () => {
    // The same two positions, written `a` twice, claim generality *and* link.
    // The contrast is the point: no annotation form links without claiming.
    expect(projectDiagnostics(
      'let pair(p: (a, a)): Int = 1\nexport let out: Int = pair((1, "two"))\n',
    ).length).toBeGreaterThan(0);
  });
});

describe("§8.5 constraints accumulate through a hole", () => {
  test("§2.1 `+` on a hole-typed parameter yields a `Num`-constrained scheme", () => {
    // Not `Int` — nothing defaults it here — and not an error.
    expect(scheme(
      "let add1(x: _) = x + 1\nexport let out: Int = add1(1)\n",
      "add1",
    )).toBe("Num a => a -> a");
  });

  test("§3 the hole's scheme is the unannotated one, and the written variable's too", () => {
    const tail = "export let out: Int = add1(1)\n";
    expect(scheme(`let add1(x: _) = x + 1\n${tail}`, "add1"))
      .toBe(scheme(`let add1(x) = x + 1\n${tail}`, "add1"));
    // §3's table rows 2 and 1 agree here: a bare annotation claims shape and
    // accumulates constraints, and a hole claims no shape at all.
    expect(scheme(`let add1(x: a) = x + 1\n${tail}`, "add1"))
      .toBe(scheme(`let add1(x: _) = x + 1\n${tail}`, "add1"));
  });
});

describe("§8.6 the total-contract fence (§5.4)", () => {
  const rewrite = "replace `_` with the intended type";

  test("an exported signature names Modules §4.1.1 and the rewrite", () => {
    for (const source of [
      "export let f(x: _): Int = 1\n",
      "export let f(x: Int): _ = 1\n",
      "export fun f(x: _): Int = 1\n",
      "export let v: _ = 42\n",
    ]) {
      const messages = projectDiagnostics(source);
      expect(messages).toContain(
        `an exported signature is complete (Modules §4.1.1); ${rewrite}`,
      );
    }
  });

  test("an exported function's *body* is still an inference surface", () => {
    // The fence is on the signature. Fencing the body would make holes useless
    // in exactly the module that exports anything.
    expect(projectDiagnostics(
      "export let f(x: Int): Int =\n    let n: _ = x\n    n\n",
    )).toEqual([]);
  });

  test("each declaration surface names its own form and the rewrite", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["type T = Vector(_)\nexport let out: Int = 1\n", "a `type` declaration"],
      ["record R = { a: _ }\nexport let out: Int = 1\n", "a `record` declaration"],
      ["union U = A(_)\nexport let out: Int = 1\n", "a `union` declaration"],
      ["exception Boom(payload: _)\nexport let out: Int = 1\n", "an `exception` declaration"],
      [
        'extern from "./foreign.js"\n    fun f(x: _): Int\nexport let out: Int = 1\n',
        "an `extern` declaration",
      ],
      [
        'extern from "./foreign.js"\n    let v: _\nexport let out: Int = 1\n',
        "an `extern` declaration",
      ],
      [
        "constraint C<a> =\n    m(x: a): _\nexport let out: Int = 1\n",
        "a `constraint` declaration",
      ],
    ];
    for (const [source, form] of cases) {
      expect(projectDiagnostics(source)).toContain(
        `${form} writes its types in full; ${rewrite}`,
      );
    }
  });

  test("the intrinsic door is a declaration surface too", () => {
    // `spec/intrinsics.md` §3.4 grants the door *genericity*, which a hole is
    // not: it is still a written signature checked against no body.
    expect(projectDiagnostics(
      'extern from "hex:intrinsic"\n    fun seqMemoize as memoize(source: _): Int\n' +
        "export let out: Int = 1\n",
    )).toContain(`an \`extern\` declaration writes its types in full; ${rewrite}`);
  });

  test("an instance head is fenced, and the fence speaks before coherence does", () => {
    const messages = projectDiagnostics(
      "constraint C<a> =\n    m(x: a): Int\n" +
        "honor C<_> =\n    m(x) = 1\n" +
        "export let out: Int = 1\n",
    );
    expect(messages[0]).toBe(`an \`honor\` declaration names its subject in full; ${rewrite}`);
  });

  test("a hole among the subject's *arguments* is fenced too", () => {
    const messages = projectDiagnostics(
      "constraint C<a> =\n    m(x: a): Int\n" +
        "honor C<Vector(_)> =\n    m(x) = 1\n" +
        "export let out: Int = 1\n",
    );
    expect(messages).toContain(
      `an \`honor\` declaration names its subject in full; ${rewrite}`,
    );
  });

  test("a hole cannot buy an extern the genericity v1 refuses it", () => {
    // The two refusals answer different questions and must not be confused: the
    // fence fires for `_`, the generic-extern rule for a written variable.
    const hole = projectDiagnostics(
      'extern from "./foreign.js"\n    fun f(x: _): Int\nexport let out: Int = 1\n',
    );
    expect(hole).not.toContain("generic extern declarations are not part of Hexagon v1");
    expect(projectDiagnostics(
      'extern from "./foreign.js"\n    fun f(x: a): Int\nexport let out: Int = 1\n',
    )).toContain("generic extern declarations are not part of Hexagon v1");
  });
});

describe("§8.7 no hole in a constraint binder list (§5.3)", () => {
  test("`<a: _>` is a parse error, with no rule of its own to make it one", () => {
    // A constraint reference is an uppercase name, so there is no hole-shaped
    // position here to reject. The grammar already answers.
    expect(projectDiagnostics("let f<a: _>(x: a) = x\n")).toContain("expected a constraint name");
  });

  test("`<_: C>` is a parse error", () => {
    expect(projectDiagnostics("let f<_: Num>(x: Int) = x\n")).toContain(
      "type parameters must be non-uppercase-start names",
    );
  });
});

describe("§8.8 hover reports the filled type (§7)", () => {
  const hoverAt = (source: string, nth = 1): { name?: string; displayedType?: string } => {
    const session = new AnalysisSession();
    session.setFile("/main.hex", source);
    let offset = -1;
    for (let found = 0; found < nth; found += 1) offset = source.indexOf("_", offset + 1);
    return session.hover("/main.hex", offset) ?? {};
  };

  test("a hole the body fixed hovers as the concrete type", () => {
    const hover = hoverAt("let n: _ = 42\nexport let out: Int = n\n");
    expect(hover.name).toBe("_");
    expect(hover.displayedType).toBe("Int");
  });

  test("a hole nothing fixed hovers as the variable it generalized to", () => {
    const hover = hoverAt(
      "let count(xs: Vector(_)): Int = Vector.length(xs)\n" +
        "export let out: Int = count([1])\n",
    );
    expect(hover.displayedType).toBe("a");
  });

  test("two holes in one annotation hover separately", () => {
    const source = 'let p: (_, _) = (1, "two")\nexport let out: Int = 1\n';
    expect(hoverAt(source, 1).displayedType).toBe("Int");
    expect(hoverAt(source, 2).displayedType).toBe("String");
  });

  test("hover answers from the hole's own span, not the annotation's", () => {
    // The constructor next to the hole is a name the occurrence index does
    // know, and it must keep its own answer.
    const source = "union Box(a) =\n    | Boxed(item: a)\n" +
      "let unbox(b: Box(_)): Int = 1\n" +
      "export let out: Int = unbox(Boxed(1))\n";
    const session = new AnalysisSession();
    session.setFile("/main.hex", source);
    expect(session.hover("/main.hex", source.indexOf("Box(_)"))?.target?.kind).toBe("union");
    expect(session.hover("/main.hex", source.indexOf("_)"))?.name).toBe("_");
  });
});
