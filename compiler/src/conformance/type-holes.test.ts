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
  const compiled = compileMain("module Main\n\n" + source);
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
  expect(projectDiagnostics("module Main\n\n" + "export let broken: Int = missing(1)\n").length).toBeGreaterThan(0);
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
    const messages = projectDiagnostics("module Main\n\n" + "let n: a = 42\nexport let out: Int = n\n");
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
    expect(projectDiagnostics("module Main\n\n" + "export let out(): Int =\n    var total: _ = 0\n    total := total + 1\n    total\n",
    )).toEqual([]);
  });
});

describe("§8.3 a constructor-claim hole", () => {
  test("§5.1 `Vector(_)` accepts a vector", () => {
    expect(projectDiagnostics("module Main\n\n" + "let count(xs: Vector(_)): Int = Vector.length(xs)\n" +
        "export let out: Int = count([1, 2])\n",
    )).toEqual([]);
  });

  test("§5.1 `Vector(_)` still rejects a non-vector", () => {
    // The claim written *around* the hole is a claim like any other.
    const messages = projectDiagnostics("module Main\n\n" + "let count(xs: Vector(_)): Int = Vector.length(xs)\n" +
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
    expect(projectDiagnostics("module Main\n\n" + 'let pair(p: (_, _)): Int = 1\nexport let out: Int = pair((1, "two"))\n',
    )).toEqual([]);
  });

  test("§4.1 independence is between *written* holes, not between nodes", () => {
    // The companion to §8.9 below: two `_` written side by side are two holes,
    // and an alias that mentions its parameter twice is still one.
    expect(scheme(
      "type Both(a, b) = (a, b)\nlet g(p: Both(_, _)) = p\nexport let out: Int = 1\n",
      "g",
    )).toBe("((a, b)) -> (a, b)");
  });

  test("§2.3 a hole links nothing — unlike a written variable", () => {
    // The same two positions, written `a` twice, claim generality *and* link.
    // The contrast is the point: no annotation form links without claiming.
    expect(projectDiagnostics("module Main\n\n" + 'let pair(p: (a, a)): Int = 1\nexport let out: Int = pair((1, "two"))\n',
    ).length).toBeGreaterThan(0);
  });
});

describe("§8.5 constraints accumulate through a hole", () => {
  test("§2.1 `+` on a hole-typed parameter yields a `Num`-constrained scheme", () => {
    // Not `Int` — nothing defaults it here — and not an error.
    expect(scheme(
      "let add1(x: _) = x + 1\nexport let out: Int = add1(1)\n",
      "add1",
    )).toBe("<a: Num> a -> a");
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
      const messages = projectDiagnostics("module Main\n\n" + source);
      expect(messages).toContain(
        `an exported signature is complete (Modules §4.1.1); ${rewrite}`,
      );
    }
  });

  test("an exported function's *body* is still an inference surface", () => {
    // The fence is on the signature. Fencing the body would make holes useless
    // in exactly the module that exports anything.
    expect(projectDiagnostics("module Main\n\n" + "export let f(x: Int): Int =\n    let n: _ = x\n    n\n",
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
      expect(projectDiagnostics("module Main\n\n" + source)).toContain(
        `${form} writes its types in full; ${rewrite}`,
      );
    }
  });

  test("the intrinsic door is a declaration surface too", () => {
    // `spec/intrinsics.md` §3.4 grants the door *genericity*, which a hole is
    // not: it is still a written signature checked against no body.
    expect(projectDiagnostics("module Main\n\n" + 'extern from "hex:intrinsic"\n    fun seqMemoize as memoize(source: _): Int\n' +
        "export let out: Int = 1\n",
    )).toContain(`an \`extern\` declaration writes its types in full; ${rewrite}`);
  });

  test("an instance head is fenced, and the fence speaks before coherence does", () => {
    const messages = projectDiagnostics("module Main\n\n" + "constraint C<a> =\n    m(x: a): Int\n" +
        "honor C<_> =\n    m(x) = 1\n" +
        "export let out: Int = 1\n",
    );
    expect(messages[0]).toBe(`an \`honor\` declaration names its subject in full; ${rewrite}`);
  });

  test("a hole among the subject's *arguments* is fenced too", () => {
    const messages = projectDiagnostics("module Main\n\n" + "constraint C<a> =\n    m(x: a): Int\n" +
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
    const hole = projectDiagnostics("module Main\n\n" + 'extern from "./foreign.js"\n    fun f(x: _): Int\nexport let out: Int = 1\n',
    );
    expect(hole).not.toContain("generic extern declarations are not part of Hexagon v1");
    expect(projectDiagnostics("module Main\n\n" + 'extern from "./foreign.js"\n    fun f(x: a): Int\nexport let out: Int = 1\n',
    )).toContain("generic extern declarations are not part of Hexagon v1");
  });

  // The fence reports the *written* hole (§4.1's unit), not the nodes alias
  // substitution made from it. Every surface below reached a hole through
  // `Pair`, whose body mentions its parameter twice, and said the same sentence
  // twice.
  describe("one written hole is one fence error, through an alias", () => {
    const PAIR = "type Pair(a) = (a, a)\n";
    const fences = (source: string): readonly string[] =>
      projectDiagnostics("module Main\n\n" + source).filter((message) => message.includes(rewrite));

    test("an exported signature reports `Pair(_)` once", () => {
      expect(fences(`${PAIR}export let h(q: Pair(_)): Int = 1\n`)).toEqual([
        `an exported signature is complete (Modules §4.1.1); ${rewrite}`,
      ]);
    });

    test("a constrained hole reports once too — the suffix rides the one node", () => {
      // `Pair(_ : Num)` also draws the undeclared-constraint error, which is a
      // different rule and not what this counts.
      expect(fences(`${PAIR}export let h(q: Pair(_ : Num)): Int = 1\n`)).toEqual([
        `an exported signature is complete (Modules §4.1.1); ${rewrite}`,
      ]);
    });

    test("an alias defined through another still reports once", () => {
      expect(fences(
        `${PAIR}type Same(b) = Pair(b)\nexport let h(q: Same(_)): Int = 1\n`,
      )).toHaveLength(1);
    });

    test("every non-export fence surface reports once as well", () => {
      // The duplication was never about exports: it is one walk, shared by all
      // of §5.4's rows.
      const cases: readonly (readonly [string, string])[] = [
        [`type T = Pair(_)\n${TAIL}`, "a `type` declaration"],
        [`record R = { a: Pair(_) }\n${TAIL}`, "a `record` declaration"],
        [`union U = A(Pair(_))\n${TAIL}`, "a `union` declaration"],
        [`exception Boom(payload: Pair(_))\n${TAIL}`, "an `exception` declaration"],
        [
          `extern from "./foreign.js"\n    fun f(x: Pair(_)): Int\n${TAIL}`,
          "an `extern` declaration",
        ],
        [`extern from "./foreign.js"\n    let v: Pair(_)\n${TAIL}`, "an `extern` declaration"],
        [`constraint C<a> =\n    m(x: Pair(_)): Int\n${TAIL}`, "a `constraint` declaration"],
        [
          `constraint C<a> =\n    m(x: a): Int\nhonor C<Pair(_)> =\n    m(x) = 1\n${TAIL}`,
          "an `honor` declaration names its subject in full;",
        ],
      ];
      for (const [source, form] of cases) {
        const message = form.endsWith(";")
          ? `${form} ${rewrite}`
          : `${form} writes its types in full; ${rewrite}`;
        expect(fences(`${PAIR}${source}`), form).toEqual([message]);
      }
    });

    test("two written holes are still two errors", () => {
      // The guard against over-deduping: `Both`'s body mentions each parameter
      // once, so nothing is copied, and two `_` must stay two.
      expect(fences(
        `type Both(a, b) = (a, b)\nexport let h(q: Both(_, _)): Int = 1\n`,
      )).toHaveLength(2);
      expect(fences("export let h(q: Map(_, _)): Int = 1\n")).toHaveLength(2);
    });

    test("two declarations each get their own hole's error", () => {
      // Written holes are distinct ids however they agree on anything else, so
      // sharing an alias does not merge two declarations' complaints.
      expect(fences(
        `${PAIR}export let g(p: Pair(_)): Int = 1\nexport let h(q: Pair(_)): Int = 1\n`,
      )).toHaveLength(2);
    });

    test("the surviving error still carets the written `_`", () => {
      // What changed is the count. The copies always carried the written span —
      // `withTypeSpan` exempts holes from substitution's re-pointing — so the
      // one error left is the one that was always right.
      const source = "module Main\n\n" + `${PAIR}export let h(q: Pair(_)): Int = 1\n`;
      const { diagnostics } = compileMain(source);
      expect(diagnostics).toHaveLength(1);
      const { start, end } = diagnostics[0]!.primary;
      expect(source.split("\n")[start.line]!.slice(start.column, end.column)).toBe("_");
    });
  });
});

describe("§8.7 no hole in a constraint binder list (§5.3)", () => {
  test("`<a: _>` is a parse error, with no rule of its own to make it one", () => {
    // A constraint reference is an uppercase name, so there is no hole-shaped
    // position here to reject. The grammar already answers.
    expect(projectDiagnostics("module Main\n\n" + "let f<a: _>(x: a) = x\n")).toContain("expected a constraint name");
  });

  test("`<_: C>` is a parse error", () => {
    expect(projectDiagnostics("module Main\n\n" + "let f<_: Num>(x: Int) = x\n")).toContain(
      "type parameters must be non-uppercase-start names",
    );
  });
});

describe("§8.9 one written hole is one metavariable through substitution", () => {
  const PAIR = "type Pair(a) = (a, a)\n";

  test("§4.1 `Pair(_)` rejects a mixed tuple — it is a pair of one type", () => {
    // The alias body mentions `a` twice, so substitution copies the hole into
    // both positions. Freshening per copy would make `Pair(_)` mean `(a, b)`
    // and accept this, un-writing the alias's own contract.
    const messages = projectDiagnostics("module Main\n\n" + `${PAIR}let f(p: Pair(_)): Int = 1\nexport let out: Int = f((1, "two"))\n`,
    );
    expect(messages.length).toBeGreaterThan(0);
  });

  test("§4.1 `Pair(_)` accepts a tuple of one type", () => {
    expect(projectDiagnostics("module Main\n\n" + `${PAIR}let f(p: Pair(_)): Int = 1\nexport let out: Int = f((1, 2))\n`,
    )).toEqual([]);
  });

  test("§4.1 the unfixed element schemes as one shared variable", () => {
    // `((a, b)) -> (a, b)` is the shape this rules out, and the shape the
    // implementation produced before the rule was pinned.
    expect(scheme(`${PAIR}let g(p: Pair(_)) = p\nexport let out: Int = 1\n`, "g"))
      .toBe("((a, a)) -> (a, a)");
  });

  test("§4.1 sharing does not leak between two definitions using the alias", () => {
    // The copies carry the *written* hole's identity, not the alias body's
    // position — which two definitions would otherwise agree on.
    const source = `${PAIR}let g(p: Pair(_)): Int = 1\n` +
      "let h(q: Pair(String)): Int = 1\n" +
      "export let out: Int = g((1, 2)) + h((\"a\", \"b\"))\n";
    expect(projectDiagnostics("module Main\n\n" + source)).toEqual([]);
  });

  test("§4.1 sharing survives an alias defined in terms of another", () => {
    expect(scheme(
      `${PAIR}type Same(b) = Pair(b)\nlet g(p: Same(_)) = p\nexport let out: Int = 1\n`,
      "g",
    )).toBe("((a, a)) -> (a, a)");
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

  test("a substituted hole hovers at the `_` the user wrote", () => {
    // Substitution re-points a copy at the alias body's variable; a hole keeps
    // its own span, or hover would answer inside the alias declaration — at an
    // offset with no `_` at it — and say nothing at the one the user can see.
    const source = "type Pair(a) = (a, a)\nlet p: Pair(_) = (1, 2)\n" +
      "export let out: Int = 1\n";
    const session = new AnalysisSession();
    session.setFile("/main.hex", source);
    const hover = session.hover("/main.hex", source.indexOf("Pair(_)") + 5);
    expect(hover?.name).toBe("_");
    expect(hover?.displayedType).toBe("Int");
    // One answer, not one per substituted copy.
    const holeSpan = source.indexOf("Pair(_)") + 5;
    expect(session.hoverSpans("/main.hex").filter(({ start }) => start === holeSpan))
      .toHaveLength(1);
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

/**
 * Constrained holes, `_ : C` (§4.4). The list seeds the hole's constraint set at
 * introduction and then gets out of the way: accumulation, defaulting,
 * generalization and instance resolution are the same machinery reading the same
 * register, which is why the assertions below are again mostly equalities with a
 * program that reaches the constraint some other way.
 */

const TAIL = "export let out: Int = 1\n";

describe("§8.10 a seeded constraint reaches the scheme", () => {
  test("§4.4 `let f(x: _ : Show) = x` receives `<a: Show> a -> a`", () => {
    // Seeded, not accumulated: the body demands nothing of `x`, so the written
    // list is the only place the constraint can have come from.
    expect(scheme(`let f(x: _ : Show) = x\n${TAIL}`, "f")).toBe("<a: Show> a -> a");
    expect(scheme(`let f(x: _) = x\n${TAIL}`, "f")).toBe("a -> a");
  });

  test("§4.4 the seed is what a binder would have stated, and states it the same way", () => {
    // The complementary split's claim in one line: the two forms are the same
    // fact written at the only home each has.
    expect(scheme(`let f(x: _ : Show) = x\n${TAIL}`, "f"))
      .toBe(scheme(`let f<a: Show>(x: a) = x\n${TAIL}`, "f"));
  });

  test("§4.4 a floor, never a cap: accumulation continues past the seed", () => {
    // §9 item 10. A cap would reject this — and rejecting a program the bare
    // `_` accepts is what makes the cap reading incoherent.
    expect(scheme(`let f(x: _ : Show) = x + 1\n${TAIL}`, "f")).toBe("<a: (Num, Show)> a -> a");
  });

  test("§4.4 base constraints ride along unstated", () => {
    // The constraint-list form is reused wholesale, entailment included: `Hash`
    // has `Eq` as a base, so `==` is reachable and adds nothing to the scheme.
    expect(projectDiagnostics("module Main\n\n" + `let f(x: _ : Hash) = x == x\n${TAIL}`)).toEqual([]);
    expect(scheme(`let f(x: _ : Hash) = x == x\n${TAIL}`, "f")).toBe("<a: Hash> a -> Bool");
  });
});

describe("§8.11 a seeded constraint refuses a bad fill", () => {
  test("§6.1 `_ : Num` filled at `Bool` is the ordinary missing-instance error", () => {
    // No new diagnostic family (§6.1): the error arises at the use that fixes
    // the fill, from ordinary instance resolution, and says only what it says.
    expect(projectDiagnostics("module Main\n\n" + `let f(x: _ : Num) = x and True\n${TAIL}`))
      .toEqual([
        "type `Bool` has no `Num` instance; its only legal homes are the module declaring " +
          "`Num` and the prelude module declaring `Bool`, both outside project source, so " +
          "this pair's honored set is closed — change the type, or go through the " +
          "operations those homes export",
      ]);
  });

  test("§6.1 the same message an accumulated `Num` gets at the same fill", () => {
    // Seeded and accumulated are one register (§2.1), so the two must be
    // indistinguishable here. The binder is *not* the twin to compare against:
    // a written variable is rigid, and rigidity answers first with Functions
    // §10's forced-to-a-concrete-type row — §3's divergence, not this one.
    expect(projectDiagnostics("module Main\n\n" + `let f(x: _ : Num) = x and True\n${TAIL}`))
      .toEqual(projectDiagnostics("module Main\n\n" + `let f(x: _) = x + x and True\n${TAIL}`));
    expect(projectDiagnostics("module Main\n\n" + `let f(x: _ : Num) = x and True\n${TAIL}`))
      .toEqual(projectDiagnostics("module Main\n\n" + `let f(x: Bool) = x + x\n${TAIL}`));
  });

  test("§4.4 a fill that satisfies the seed is accepted, dictionary and all", () => {
    expect(projectDiagnostics("module Main\n\n" + "let double(x: _ : Num) = x + x\nexport let out: Int = double(21)\n",
    )).toEqual([]);
  });
});

describe("§8.12 defaulting through a constrained hole", () => {
  test("§4.4 `let n: _ : Num = 42` gives `n : Int`", () => {
    // Numeric Literals §4 consults the constraint set as always; it does not
    // care that this member of the set was written rather than accumulated.
    expect(scheme(`let n: _ : Num = 42\nexport let out: Int = n\n`, "n")).toBe("Int");
  });

  test("§4.4 the seed alone does not force a default", () => {
    // Defaulting needs a literal to reach; a seeded `Num` with nothing numeric
    // in the body generalizes, exactly as an accumulated one does.
    expect(scheme(`let f(x: _ : Num) = x\n${TAIL}`, "f")).toBe("<a: Num> a -> a");
  });
});

describe("§8.13 grammar boundaries", () => {
  test("§4.4 `_ : Num -> a` is `(_ : Num) -> a` — the suffix is bounded", () => {
    // The operand ends when the suffix does, so the arrow is the enclosing type's.
    // The parenthesized twin is the falsifier: were the arrow swallowed, the two
    // would not agree, and neither would name a function *from* the hole.
    expect(scheme(`let f(g: _ : Num -> Bool) = g\n${TAIL}`, "f"))
      .toBe(scheme(`let f(g: (_ : Num) -> Bool) = g\n${TAIL}`, "f"));
    expect(scheme(`let f(g: _ : Num -> Bool) = g\n${TAIL}`, "f"))
      .toBe("<a: Num> (a -> Bool) -> a -> Bool");
  });

  test("§4.4 in a tuple type the `,` belongs to the tuple", () => {
    expect(scheme(`let f(p: (_ : Num, Int)) = p\n${TAIL}`, "f"))
      .toBe("<a: Num> ((a, Int)) -> (a, Int)");
  });

  test("§4.4 the conjunction `_ : (Eq, Show)` seeds both", () => {
    expect(scheme(`let f(x: _ : (Eq, Show)) = x\n${TAIL}`, "f")).toBe("<a: (Eq, Show)> a -> a");
  });

  test("§4.4 the seed's written order does not survive into the display", () => {
    // The bracket's conjuncts sort by constraint name, matching the evidence
    // suffix's second key within one variable, regardless of what was written
    // (Functions §5.1, FFI Part 9 §6.2). Written `(Show, Eq)` therefore displays exactly
    // as written `(Eq, Show)` does — the pair above is the falsifier.
    expect(scheme(`let f(x: _ : (Show, Eq)) = x\n${TAIL}`, "f")).toBe("<a: (Eq, Show)> a -> a");
    expect(scheme(`let f(x: _ : (Show, Eq)) = x\n${TAIL}`, "f"))
      .toBe(scheme(`let f(x: _ : (Eq, Show)) = x\n${TAIL}`, "f"));
  });

  test("§9 item 9 `x: Int : Num` is a parse error", () => {
    // Only a hole admits the suffix. A written type's instances are facts the
    // checker already knows, so the claim would be redundant where it is true.
    const messages = projectDiagnostics("module Main\n\n" + `let f(x: Int : Num) = x\n${TAIL}`);
    expect(messages).toContain("expected `)` after parameters");
  });

  test("§9 item 9 `Vector(a : Show)` is a parse error", () => {
    // The named variable's constraint home is its binder, and nothing changed
    // about that: the suffix rides the hole, not the type-argument position.
    const messages = projectDiagnostics("module Main\n\n" + `let f(xs: Vector(a : Show)) = xs\n${TAIL}`);
    expect(messages).toContain("expected `)` after type arguments");
  });

  test("§5.3 the binder list still refuses both hole shapes", () => {
    // §8.7's pins restated against the new grammar: adding the suffix to the
    // hole must not have opened a hole-shaped position inside `<...>`.
    expect(projectDiagnostics("module Main\n\n" + "let f<a: _>(x: a) = x\n")).toContain("expected a constraint name");
    expect(projectDiagnostics("module Main\n\n" + "let f<_: Num>(x: Int) = x\n")).toContain(
      "type parameters must be non-uppercase-start names",
    );
  });

  test("§4.4 an unknown constraint reads exactly as it does in a binder", () => {
    expect(projectDiagnostics("module Main\n\n" + `let f(x: _ : Nope) = x\n${TAIL}`))
      .toEqual(projectDiagnostics("module Main\n\n" + `let f<a: Nope>(x: a) = x\n${TAIL}`));
    expect(projectDiagnostics("module Main\n\n" + `let f(x: _ : Nope) = x\n${TAIL}`))
      .toContain(
        "unknown constraint `Nope`; import its home module under the alias " +
          "`Nope` for qualified access",
      );
  });

  test("§5.1 the suffix reaches every type position a hole reaches", () => {
    for (const annotation of [
      "_ : Show",
      "Vector(_ : Show)",
      "(_ : Show, Int)",
      "{ name: _ : Show }",
      "Map(String, _ : Show)",
    ]) {
      expect(projectDiagnostics("module Main\n\n" + `let f(x: ${annotation}) = x\n${TAIL}`), annotation).toEqual([]);
    }
  });
});

describe("§8.14 seeding survives substitution as one obligation", () => {
  const PAIR = "type Pair(a) = (a, a)\n";

  test("§4.4 `Pair(_ : Num)` schemes as one shared `Num`-constrained variable", () => {
    // Two copies of one written hole, so one metavariable (§4.1) carrying one
    // seed. `<a: Num, b: Num> ((a, b)) -> (a, b)` is the shape this rules out.
    expect(scheme(`${PAIR}let g(p: Pair(_ : Num)) = p\n${TAIL}`, "g"))
      .toBe("<a: Num> ((a, a)) -> (a, a)");
  });

  test("§4.4 one obligation, not two — one dictionary reaches the emitted function", () => {
    // The scheme's display would dedupe a doubled obligation; the evidence
    // parameter list is where a second variable would actually show.
    const compiled = compileMain("module Main\n\n" + `${PAIR}let g(p: Pair(_ : Num)) = p\n${TAIL}`);
    expect(compiled.diagnostics).toEqual([]);
    const emitted = compiled.modules.find(({ source }) => source.path === "/main.hex")!.javascript;
    expect(emitted.text.match(/__Num_a\b/g) ?? []).toHaveLength(1);
  });

  test("§4.4 the shared seed is checked once, at whatever fixes the fill", () => {
    expect(projectDiagnostics("module Main\n\n" + `${PAIR}let g(p: Pair(_ : Num)): Int = 1\nexport let out: Int = g(("a", "b"))\n`,
    )).toEqual([
      "type `String` has no `Num` instance; its only legal homes are the module declaring " +
        "`Num` and `String`'s prelude companion module, both outside project source, so " +
        "this pair's honored set is closed — change the type, or go through the operations " +
        "those homes export",
    ]);
  });
});

describe("§8 residue: the fence and hover need no new case (§5.4, §7)", () => {
  test("§5.4 a constrained hole in a fenced position still errors", () => {
    // The suffix rides the hole, so the existing sweep already sees it.
    expect(projectDiagnostics("module Main\n\n" + "export let f(x: _ : Show): Int = 1\n")).toContain(
      "an exported signature is complete (Modules §4.1.1); replace `_` with the intended type",
    );
    expect(projectDiagnostics("module Main\n\n" + `type T = Vector(_ : Show)\n${TAIL}`)).toContain(
      "a `type` declaration writes its types in full; replace `_` with the intended type",
    );
  });

  test("§7 hover shows the seeded constraint, through the existing scheme display", () => {
    const source = `let f(x: _ : Show) = x\n${TAIL}`;
    const session = new AnalysisSession();
    session.setFile("/main.hex", source);
    const hover = session.hover("/main.hex", source.indexOf("_"));
    expect(hover?.name).toBe("_");
    expect(hover?.displayedType).toBe("<a: Show> a");
  });

  test("§7 hover at a constrained hole the body fixed shows the fill", () => {
    const source = "let n: _ : Num = 42\nexport let out: Int = n\n";
    const session = new AnalysisSession();
    session.setFile("/main.hex", source);
    expect(session.hover("/main.hex", source.indexOf("_"))?.displayedType).toBe("Int");
  });
});
