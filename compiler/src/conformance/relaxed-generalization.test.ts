import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { COMPILER_CLAIMS } from "../passes/checker/variance.js";
import { PRELUDE_SOURCES } from "../prelude-sources.js";
import { compileFiles, projectDiagnostics, runMain } from "../support/test-project.js";
import type * as Typed from "../syntax/typed/index.js";

/**
 * Conformance for Step 2 of the #205 ruling (closure doc
 * `spec/decisions-ml-dialect-generalization-2026-08.md` §4–§6, §11.1): the
 * relaxed value restriction, the variance analysis, and declared variance on
 * `export opaque`.
 *
 * Step 1's items (i)–(vi) live in `value-list.test.ts`.
 */

function scheme(source: string, name: string): Typed.Scheme {
  const compiled = compileFiles([["/main.hex", source]]);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const typed = compiled.modules.find((module) => module.source.path === "/main.hex")!.typed;
  const symbol = typed.symbols.find(
    (candidate) => candidate.name === name && candidate.kind !== "parameter",
  );
  if (symbol === undefined) throw new Error(`no symbol \`${name}\``);
  return symbol.scheme;
}

describe("§4.1 the relaxed rule, per variable", () => {
  test("§4.4 `let xs = makeEmpty()` generalizes: unconstrained, covariant-only", () => {
    // Functions §8.2's own former counterexample. `Vector(+a)` is a
    // compiler-side claim (§5.3), the variable is unconstrained, and levels
    // admit it — so all three clauses pass. SML rejects this program; the whole
    // reason Step 2 exists is that OCaml does not.
    expect(
      projectDiagnostics(
        "fun makeEmpty<a>(): Vector(a) = []\n" +
          "let xs = makeEmpty()\n" +
          "export let n: Int = Vector.at(xs, 1)\n" +
          'export let s: String = Vector.at(xs, 1)\n',
      ),
    ).toEqual([]);
  });

  test("§4.4 a constructor with neither a claim nor a row is invariant", () => {
    // The outcome above is contingent on the row. `Map` has no row today —
    // §11.4 sequences its claim after its own milestone — so its variables are
    // declined and the first use pins them.
    const messages = projectDiagnostics(
      "fun makeEmpty<k: Hash, v>(): Map(k, v) = Map.empty()\n" +
        "let m = makeEmpty()\n" +
        "export let a: Option(Int) = Map.get(m, 1)\n" +
        'export let b: Option(String) = Map.get(m, "k")\n',
    );
    expect(messages.length).toBeGreaterThan(0);
  });

  test("§4.3 a constrained variable is declined, even though it is covariant at the root", () => {
    // `Conjure ?1 => ?1` puts the variable covariantly at the root, so the
    // variance test alone would generalize it — straight into §3's coherence
    // dilemma: one computed value used at two representations, or evidence
    // abstraction re-running the right-hand side per use. Clause (a) is
    // Hexagon's own addition to Garrigue's rule, and it is load-bearing.
    //
    // The specimen is a *non-defaultable* constraint on purpose (§3's own care
    // in choosing a demonstration): under `Num` alone, Numeric Literals §4
    // resolves the variable to `Int` before any of this is observable.
    const declarations = "constraint Conjure<a> =\n" +
      "    make(): a\n" +
      "honor Conjure<Int> =\n" +
      "    make() = 1\n" +
      "honor Conjure<String> =\n" +
      '    make() = "x"\n';
    const messages = projectDiagnostics(
      declarations +
        "let y = make()\n" +
        "export let n: Int = y\n" +
        "export let s: String = y\n",
    );
    expect(messages.length).toBeGreaterThan(0);
    // The control: the same shape with the constraint gone generalizes.
    expect(
      projectDiagnostics(
        "fun makeEmpty<a>(): Vector(a) = []\n" +
          "let y = makeEmpty()\n" +
          "export let n: Int = Vector.at(y, 1)\n" +
          'export let s: String = Vector.at(y, 1)\n',
      ),
    ).toEqual([]);
  });

  test("§4.4 the multi-item block: the argument variable is pinned, the result generalizes", () => {
    // Functions §8.2's `lookup` example, with the signatures the argument
    // depends on. `?k` occurs contravariantly and is pinned by its first use;
    // `?v` occurs covariantly, is unconstrained, and generalizes — soundly,
    // because the once-loaded table can contain no elements (§4.2 leg 1).
    const source = "record Table(k, v) = { rows: Vector((k, v)) }\n" +
      "fun load<k, v>(): Table(k, v) = Table({ rows = [] })\n" +
      "exception Missing\n" +
      "fun find<k, v>(table: Table(k, v), key: k): v = throw(Missing)\n" +
      "let lookup =\n" +
      "    let table = load()\n" +
      "    (key) => find(table, key)\n";
    // The result variable is free: two uses may read it at two types.
    expect(
      projectDiagnostics(
        source +
          "export let n: Int = lookup(1)\n" +
          "export let s: String = lookup(1)\n",
      ),
    ).toEqual([]);
    // The argument variable is not: the first use pins it.
    const pinned = projectDiagnostics(
      source +
        "export let n: Int = lookup(1)\n" +
        'export let s: Int = lookup("k")\n',
    );
    expect(pinned.length).toBeGreaterThan(0);
  });

  test("§4.5 one binding, some variables quantified and some not", () => {
    // Per-variable is the intended reading, and this is the shape that shows it:
    // a scheme with exactly one quantified variable where the type mentions two.
    const source = "record Table(k, v) = { rows: Vector((k, v)) }\n" +
      "fun load<k, v>(): Table(k, v) = Table({ rows = [] })\n" +
      "exception Missing\n" +
      "fun find<k, v>(table: Table(k, v), key: k): v = throw(Missing)\n" +
      "let lookup =\n" +
      "    let table = load()\n" +
      "    (key) => find(table, key)\n" +
      "export let n: Int = lookup(1)\n";
    expect(scheme(source, "lookup").variables.length).toBe(1);
  });

  test("§4.4 `memoize` of a generalized sequence generalizes", () => {
    // `Seq(+a)` by written sigil after the sweep, and `seqMemoize` is parametric
    // (§7): the memoized spine shared across instantiations can hold only values
    // pulled from a source that, by parametricity, never produced any.
    expect(
      projectDiagnostics(
        "let e = empty\n" +
          "let m = Seq.memoize(e)\n" +
          "export let ys: Seq(Int) = cons(42, m)\n" +
          'export let xs: Seq(String) = cons("Briar", m)\n',
      ),
    ).toEqual([]);
  });

  test("`fun` bindings are untouched: their right-hand sides are always values", () => {
    expect(scheme("fun id<a>(x: a): a = x\n", "id").variables.length).toBe(1);
  });

  test("(vii) an annotated expansive binding generalizes when every variable passes", () => {
    expect(
      projectDiagnostics(
        "fun makeEmpty<a>(): Vector(a) = []\n" +
          "let xs: Vector(a) = makeEmpty()\n" +
          "export let n: Int = Vector.at(xs, 1)\n" +
          'export let s: String = Vector.at(xs, 1)\n',
      ),
    ).toEqual([]);
  });

  test("(vii) a declined variable under an annotation is a declaration-site error", () => {
    const messages = projectDiagnostics(
      "fun double<a: Num>(value: a): a = value + value\n" +
        "let y: a = double(42)\n",
    );
    expect(messages).toContain(
      "`a` is a declared type variable, but this right-hand side is a computation " +
        "that cannot be generalized in `a` (`a` is constrained by `Num`); " +
        "bind where the type is known, or remove the annotation",
    );
  });

  test("(vii) clause (b) names its own reason", () => {
    const messages = projectDiagnostics(
      "fun make<a>(): (a -> a) = (x) => x\n" +
        "let f: (a -> a) = make()\n",
    );
    expect(messages.some((message) => message.includes("occurs in an invariant position"))).toBe(
      true,
    );
  });

  test("(vii) an export inherits the error through its mandatory signature", () => {
    const messages = projectDiagnostics(
      "fun double<a: Num>(value: a): a = value + value\n" +
        "export let y: a = double(42)\n",
    );
    expect(messages.some((message) => message.includes("cannot be generalized in `a`"))).toBe(true);
  });

  test("§4.4 defaulting does not fire on item 7's account", () => {
    // A clause-(a)-declined variable is not "a type variable that would
    // otherwise be quantified": item 7's decision *is* the quantification
    // decision. The variable behaves exactly as it did before #205 — the first
    // use pins it, and `BigInt` is reachable.
    expect(
      projectDiagnostics(
        "fun double<a: Num>(value: a): a = value + value\n" +
          "let y = double(42)\n" +
          "export let big: BigInt = y\n",
      ),
    ).toEqual([]);
  });
});

describe("§6 declared variance on `export opaque`", () => {
  test("§6.1 a covariant claim on an opaque record is legal and believed", () => {
    expect(
      projectDiagnostics(
        "export opaque record Box(+a) = { get: () -> a }\n" +
          "exception Empty\n" +
          "export fun makeBox<a>(): Box(a) = Box({ get = () => throw(Empty) })\n" +
          "let b = makeBox()\n" +
          "export let n: Box(Int) = b\n" +
          "export let s: Box(String) = b\n",
      ),
    ).toEqual([]);
  });

  test("§6.1 a contravariant claim is legal on a consumer", () => {
    expect(
      projectDiagnostics(
        "export opaque record Sink(-a) = { accept: a -> Unit }\n",
      ),
    ).toEqual([]);
  });

  test("§6.2 bare means invariant: the empty claim declines generalization", () => {
    // The same declaration without the sigil. Under-claiming is legal forever,
    // and this is what it costs — the client's binding is pinned by its first
    // use, exactly as `Map`'s is.
    const messages = projectDiagnostics(
      "export opaque record Box(a) = { get: () -> a }\n" +
        "exception Empty\n" +
        "export fun makeBox<a>(): Box(a) = Box({ get = () => throw(Empty) })\n" +
        "let b = makeBox()\n" +
        "export let n: Box(Int) = b\n" +
        "export let s: Box(String) = b\n",
    );
    expect(messages.length).toBeGreaterThan(0);
  });

  test("§6.3 an over-claim is a hard error naming a witness occurrence", () => {
    const messages = projectDiagnostics(
      "export opaque record Sink(+a) = { accept: a -> Unit }\n",
    );
    expect(messages).toContain(
      "`a` cannot be declared covariant in `Sink`: field `accept` uses `a` in argument " +
        "position. Remove the `+`, or change the field",
    );
  });

  test("§6.3 the witness is a real span, not garnish", () => {
    const compiled = compileFiles([
      ["/main.hex", "export opaque record Sink(+a) = { accept: a -> Unit }\n"],
    ]);
    const diagnostic = compiled.diagnostics.find(({ message }) =>
      message.includes("cannot be declared covariant")
    )!;
    expect(diagnostic.labels?.length).toBe(1);
    const label = diagnostic.labels![0]!;
    const text = "export opaque record Sink(+a) = { accept: a -> Unit }\n";
    expect(text.slice(label.span.start.offset, label.span.end.offset)).toBe("a");
    // The label points at the offending occurrence, not at the declaration head.
    expect(label.span.start.offset).toBeGreaterThan(text.indexOf("accept"));
  });

  test("§6.3 an over-claimed contravariance reports too", () => {
    const messages = projectDiagnostics(
      "export opaque record Box(-a) = { get: () -> a }\n",
    );
    expect(messages.some((message) =>
      message.includes("`a` cannot be declared contravariant in `Box`") &&
      message.includes("in result position")
    )).toBe(true);
  });

  test("§6.3 a union's constructor slot is a witness too", () => {
    const messages = projectDiagnostics(
      "export opaque union Handler(+a) = OnEach(step: a -> Unit)\n",
    );
    expect(messages.some((message) =>
      message.includes("constructor slot `OnEach.step`")
    )).toBe(true);
  });

  test("§6.3 an unused parameter admits any claim", () => {
    expect(
      projectDiagnostics("export opaque record Tag(+a) = { name: String }\n"),
    ).toEqual([]);
    expect(
      projectDiagnostics("export opaque record Tag(-a) = { name: String }\n"),
    ).toEqual([]);
  });

  test("§6.3 the SCC rule: a self-recursive occurrence contributes the fixpoint", () => {
    // `Seq`'s own shape. Read through the bare-parameter claim instead of the
    // fixpoint, the recursive `Seq(a)` occurrence would be invariant and the
    // `+a` claim would be refused — by the declaration it is being computed for.
    expect(
      projectDiagnostics(
        "export opaque record Chain(+a) = { pull: () -> Option((a, Chain(a))) }\n",
      ),
    ).toEqual([]);
  });

  test("§6.4 the claim governs in the home module too", () => {
    // No private view: an under-claiming author sees exactly what a client sees.
    const messages = projectDiagnostics(
      "export opaque record Box(a) = { get: () -> a }\n" +
        "exception Empty\n" +
        "fun makeBox<a>(): Box(a) = Box({ get = () => throw(Empty) })\n" +
        "let b = makeBox()\n" +
        "export let n: Box(Int) = b\n" +
        "export let s: Box(String) = b\n",
    );
    expect(messages.length).toBeGreaterThan(0);
  });

  test("§6.4 a claim travels with an imported declaration", () => {
    const compiled = compileFiles([
      ["/box.hex",
        "export opaque record Box(+a) = { get: () -> a }\n" +
        "exception Empty\n" +
        "export fun makeBox<a>(): Box(a) = Box({ get = () => throw(Empty) })\n"],
      ["/main.hex",
        'import * as B from "./box.hex"\n' +
        "let b = B.makeBox()\n" +
        "export let n: B.Box(Int) = b\n" +
        "export let s: B.Box(String) = b\n"],
    ]);
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  });
});

describe("§6.1 the sigil grammar", () => {
  test("a sigil on a transparent declaration is a parse error", () => {
    for (const declaration of [
      "record Box(+a) = { get: () -> a }\n",
      "export record Box(+a) = { get: () -> a }\n",
      "union Maybe(+a) = Just(value: a) | Nothing\n",
      "export union Maybe(-a) = Just(value: a) | Nothing\n",
    ]) {
      // Declarations Preamble §2.1's normative text, exactly.
      expect(projectDiagnostics(declaration)).toContain(
        `variance is inferred for transparent types; remove the \`${
          declaration.includes("(+a)") ? "+" : "-"
        }\``,
      );
    }
  });

  test("a sigil on a `type` alias is a parse error", () => {
    // One message for all three forms: an alias is transparent by definition.
    expect(projectDiagnostics("type Pair(+a) = (a, a)\n")).toContain(
      "variance is inferred for transparent types; remove the `+`",
    );
  });

  test("a sigil at a use site is a parse error", () => {
    const messages = projectDiagnostics(
      "export opaque record Box(+a) = { get: () -> a }\n" +
        "exception Empty\n" +
        "export let b: Box(+Int) = throw(Empty)\n",
    );
    expect(messages).toContain(
      "remove the `+` — variance is declared on the type's declaration, " +
        "never written at a use site; write `Box(Int)`",
    );
  });

  test("§5.4 an annotation naming an opaque type carries no sigil and needs none", () => {
    expect(
      projectDiagnostics(
        "export opaque record Box(+a) = { get: () -> a }\n" +
          "exception Empty\n" +
          "export fun makeBox<a>(): Box(a) = Box({ get = () => throw(Empty) })\n" +
          "let b: Box(a) = makeBox()\n" +
          "export let n: Box(Int) = b\n",
      ),
    ).toEqual([]);
  });
});

describe("§5.3 the compiler-side claim table", () => {
  test("(ix) one claim source per constructor", () => {
    // A constructor holding both a table row and a written sigil is a build-time
    // assertion failure, never a silent precedence question. `Seq` is the case
    // that made the rule: it carried the ruling's transitional row until §11.4's
    // sweep wrote the sigil, and the row had to go in the same change.
    const sigilled = new Set<string>();
    for (const source of Object.values(PRELUDE_SOURCES)) {
      for (const match of source.matchAll(
        /\b(?:record|union)\s+([A-Z][A-Za-z0-9_]*)\s*\([^)]*[+-]/gu,
      )) {
        sigilled.add(match[1]!);
      }
    }
    expect(sigilled).toContain("Seq");
    for (const constructor of sigilled) {
      expect(COMPILER_CLAIMS.has(constructor)).toBe(false);
    }
  });

  test("the borrowed foreign views are invariant in v1", () => {
    expect(COMPILER_CLAIMS.get("Array")).toEqual(["inv"]);
    expect(COMPILER_CLAIMS.get("Nullable")).toEqual(["inv"]);
  });

  test("`Array` declines generalization: a claim may not rest on a boundary contract", () => {
    const messages = projectDiagnostics(
      "fun makeEmpty<a>(): Array(a) = Array.fromVector([])\n" +
        "let xs = makeEmpty()\n" +
        "export let n: Int = Array.at(xs, 1)\n" +
        'export let s: String = Array.at(xs, 1)\n',
    );
    expect(messages.length).toBeGreaterThan(0);
  });
});

describe("the acceptance test still runs", () => {
  test("§1.1's empty-sequence program produces both sequences", async () => {
    const exports = await runMain(
      "let e = empty\n" +
        "export let ys: Int = Seq.length(cons(42, e))\n" +
        'export let xs: Int = Seq.length(cons("Briar", e))\n',
    );
    expect(exports.ys).toBe(1);
    expect(exports.xs).toBe(1);
  });

  test("a generalized expansive binding still emits one shared value", async () => {
    const source = "fun makeEmpty<a>(): Vector(a) = []\n" +
      "let xs = makeEmpty()\n" +
      "export let n: Int = Vector.size(xs)\n";
    const exports = await runMain(source);
    expect(exports.n).toBe(0);
    const javascript = compileProject([
      new Source.File(Source.fileId(0), "/main.hex", source),
    ]).modules.find((module) => module.source.path === "/main.hex")!.javascript.text;
    // Generalization is types-only: the right-hand side still runs once, at its
    // textual position, and unconstrained variables carry no evidence (§11.2).
    expect(javascript).toContain("const xs = makeEmpty()");
  });
});
