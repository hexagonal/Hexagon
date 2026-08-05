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

  test("§4.4 an invariant constructor declines what a covariant one grants", () => {
    // The outcome above is contingent on clause (b): read the same shape
    // through a constructor whose parameter is invariant and the variable is
    // declined instead. The two specimens differ in exactly one token — `Inv`
    // carries one extra field, `sink: a -> Unit`, which puts `a`
    // contravariantly alongside its covariant occurrence in `items`, and §5.1's
    // join of `co` and `contra` is `inv`.
    //
    // Two properties this specimen has and the `Set(a)` one it replaces did
    // not. First, `makeEmpty` typechecks: `Set.empty()` did not, so the whole
    // former assertion was satisfied by a diagnostic from the *first line*, and
    // the binding and the two conflicting uses contributed nothing. Second, `a`
    // is **unconstrained** — `Set(a)` demands `a: Hash`, so clause (a) declined
    // it whatever the variance row said, and flipping the row could not change
    // the answer. Here clause (a) and clause (c) both pass in both specimens,
    // so clause (b) is the only thing between them.
    expect(
      projectDiagnostics(
        "export record Co(a) = { items: Vector(a) }\n" +
          "fun makeEmpty<a>(): Co(a) = Co({ items = [] })\n" +
          "let xs = makeEmpty()\n" +
          "export let n: Co(Int) = xs\n" +
          "export let t: Co(String) = xs\n",
      ),
    ).toEqual([]);
    expect(
      projectDiagnostics(
        "export record Inv(a) = { items: Vector(a), sink: a -> Unit }\n" +
          "fun makeEmpty<a>(): Inv(a) = Inv({ items = [], sink = (value) => () })\n" +
          "let xs = makeEmpty()\n" +
          "export let n: Inv(Int) = xs\n" +
          "export let t: Inv(String) = xs\n",
      ),
    ).toEqual(["type mismatch: expected String, found Int"]);
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
        "let e = Seq.empty\n" +
          "let m = Seq.memoize(e)\n" +
          "export let ys: Seq(Int) = Seq.prepend(m, 42)\n" +
          'export let xs: Seq(String) = Seq.prepend(m, "Briar")\n',
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

  // Every (vii) assertion below compares the *whole* list, not a membership.
  // The declined variable is sunk to `ERROR` in `#generalize` precisely so this
  // is the only message the author gets; left unsolved it is defaulted instead
  // and collects a second one telling them to `change the annotation to `Int``,
  // which contradicts this one's "remove the annotation". `toContain` and
  // `.some()` cannot see an extra message, so they held nothing here.
  const declined = (reason: string) =>
    "`a` is a declared type variable, but this right-hand side is a computation " +
    `that cannot be generalized in \`a\` (${reason}); ` +
    "bind where the type is known, or remove the annotation";

  test("(vii) a declined variable under an annotation is a declaration-site error", () => {
    expect(
      projectDiagnostics(
        "fun double<a: Num>(value: a): a = value + value\n" +
          "let y: a = double(42)\n",
      ),
    ).toEqual([declined("`a` is constrained by `Num`")]);
  });

  test("(vii) clause (b) names its own reason", () => {
    expect(
      projectDiagnostics(
        "fun make<a>(): (a -> a) = (x) => x\n" +
          "let f: (a -> a) = make()\n",
      ),
    ).toEqual([declined("`a` occurs in an invariant position")]);
  });

  test("(vii) an export inherits the error through its mandatory signature", () => {
    expect(
      projectDiagnostics(
        "fun double<a: Num>(value: a): a = value + value\n" +
          "export let y: a = double(42)\n",
      ),
    ).toEqual([declined("`a` is constrained by `Num`")]);
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

  test("§4.4 ...and still fires at a *value* binding, where item 7 never ran", () => {
    // The other side of the same gate, and the one that has no ruling behind it:
    // §4.4 excuses a rigid variable from defaulting at an expansive binding
    // because item 7's decision is the quantification decision there. At a value
    // binding item 7 never fires, the ruling says nothing, and defaulting keeps
    // its pre-#205 behaviour — binding `a` to `Int`, which Functions §4.1 then
    // reports against with its rewrite named.
    //
    // Ungating the skip loses that: `a` stays unsolved, the §4.1 diagnostic
    // never fires, and the author's one mistake collects `missing \`Num\`
    // evidence during JavaScript emission` — a note that reads like a compiler
    // defect — over an emitted `const x = undefined.fromNat(42)`.
    const source = "export let x: a = 42\n";
    expect(projectDiagnostics(source)).toEqual([
      "`a` is a declared type variable, but the body requires `Int`; " +
        "change the annotation to `Int`, or remove it to let the type be inferred",
    ]);
    const javascript = compileProject([
      new Source.File(Source.fileId(0), "/main.hex", source),
    ]).modules.find((module) => module.source.path === "/main.hex")!.javascript.text;
    expect(javascript).not.toContain("fromNat");
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

  test("§6.3 the witness is the *first* offending occurrence", () => {
    // Which occurrence gets named was unheld: every specimen elsewhere in this
    // file has exactly one, so `find` and `findLast` were indistinguishable.
    // With two, the choice is visible — and it should be the first, because
    // that is the one the author's eye reaches first in their own declaration.
    const text = "export opaque record Sink(+a) = { first: a -> Unit, second: a -> Unit }\n";
    const compiled = compileFiles([["/main.hex", text]]);
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "`a` cannot be declared covariant in `Sink`: field `first` uses `a` in " +
      "argument position. Remove the `+`, or change the field",
    ]);
    // ...and the label follows the message, rather than pointing somewhere else.
    const label = compiled.diagnostics[0]!.labels![0]!;
    expect(label.span.start.offset).toBeLessThan(text.indexOf("second"));
    expect(label.span.start.offset).toBeGreaterThan(text.indexOf("first"));
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
    // `Seq`'s own shape, and it does *not* discriminate: an in-SCC read gives
    // the running estimate, an out-of-SCC read goes through `#effective`, and
    // for `Chain` that returns the written `+` claim. Both readings agree, so
    // the case is a regression guard on the shape the stdlib ships and nothing
    // more — recorded because it looked like the SCC test and is not.
    expect(
      projectDiagnostics(
        "export opaque record Chain(+a) = { pull: () -> Option((a, Chain(a))) }\n",
      ),
    ).toEqual([]);

    // These do discriminate. `a` appears *only* under the self-reference, so the
    // fixpoint's least solution is `unused` — a phantom, which supports any
    // claim. Read the self-reference as an outsider and it contributes the
    // declared claim instead: `+` flipped by the argument position becomes
    // contravariant and the `+a` is refused, `-` flipped becomes covariant and
    // the `-a` is refused. Both were verified to fail with `#slotVariance`'s
    // in-SCC branch removed.
    expect(
      projectDiagnostics("export opaque record Odd(+a) = { f: (Odd(a)) -> Unit }\n"),
    ).toEqual([]);
    expect(
      projectDiagnostics("export opaque record Neg(-a) = { f: (Neg(a)) -> Unit }\n"),
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

  // §6.1/§6.2 again, on a *union*. Everything above declares a record, and the
  // two declaration forms carry their claims down separate lines of the
  // resolver: replacing the union's `declaredParameters` with `[]` leaves every
  // record test above green while silently discarding every claim a union ever
  // makes, in-module and cross-module alike. The union was covered only for the
  // over-claim error and the parse errors, neither of which reads a *believed*
  // claim.
  const UNION_BOX = (sigil: string) =>
    `export opaque union Box(${sigil}a) = Empty | Full(item: a)\n` +
    "export fun makeBox<a>(): Box(a) = Empty\n";
  const USE_BOX = "let b = makeBox()\n" +
    "export let n: Box(Int) = b\n" +
    "export let s: Box(String) = b\n";

  test("§6.1 a covariant claim on an opaque union is believed", () => {
    expect(projectDiagnostics(UNION_BOX("+") + USE_BOX)).toEqual([]);
  });

  test("§6.2 the same union bare declines — the claim is what did the work", () => {
    expect(projectDiagnostics(UNION_BOX("") + USE_BOX)).toEqual([
      "type mismatch: expected String, found Int",
    ]);
  });

  test("§6.4 a union's claim travels with the imported declaration", () => {
    const client = 'import * as B from "./box.hex"\n' +
      "let b = B.makeBox()\n" +
      "export let n: B.Box(Int) = b\n" +
      "export let s: B.Box(String) = b\n";
    expect(
      compileFiles([["/box.hex", UNION_BOX("+")], ["/main.hex", client]])
        .diagnostics.map(({ message }) => message),
    ).toEqual([]);
    expect(
      compileFiles([["/box.hex", UNION_BOX("")], ["/main.hex", client]])
        .diagnostics.map(({ message }) => message),
    ).toEqual(["type mismatch: expected String, found Int"]);
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

  test("§6.4 a claim travels through a module that was never imported", () => {
    // `/main.hex` imports two functions and no type at all. `Box` is reached only
    // through `emptyCrate`'s scheme and `/mid.hex`'s alias, so it is in neither
    // `module.records` nor `module.unions` there — which is why the analysis is
    // sourced from the program and not from a module's own view.
    const compiled = compileFiles([
      ["/box.hex", BOX],
      ["/mid.hex", MID],
      ["/main.hex", MAIN],
    ]);
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  });

  test("§6.4 an unrelated import does not change the answer", () => {
    // The uniformity property itself, stated as the ruling states it: identical
    // text must not compile in one module and fail one import away. Adding an
    // import that `/main.hex` makes no use of is the sharpest form of "one import
    // away" — nothing about the program changes except what the module can see.
    const without = compileFiles([
      ["/box.hex", BOX],
      ["/mid.hex", MID],
      ["/main.hex", MAIN],
    ]);
    const with_ = compileFiles([
      ["/box.hex", BOX],
      ["/mid.hex", MID],
      ["/main.hex", 'import * as Unused from "./box.hex"\n' + MAIN],
    ]);
    expect(without.diagnostics.map(({ message }) => message))
      .toEqual(with_.diagnostics.map(({ message }) => message));
  });
});

/** A covariant opaque type, three modules away from where it is generalized. */
const BOX = "export opaque record Box(+a) = { get: () -> a }\n" +
  "exception Empty\n" +
  "export fun makeBox<a>(): Box(a) = Box({ get = () => throw(Empty) })\n";

/** Re-exports `Box` under an alias, so the declaration's own name never travels. */
const MID = 'import { Box, makeBox } from "./box.hex"\n' +
  "export type Crate(a) = Box(a)\n" +
  "export fun makeCrate<a>(): Crate(a) = makeBox()\n";

const MAIN = 'import { Crate, makeCrate } from "./mid.hex"\n' +
  "let c = makeCrate()\n" +
  "export let n: Crate(Int) = c\n" +
  "export let s: Crate(String) = c\n";

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
    // Declarations Preamble §2.1's normative text, exactly. It carries **no**
    // corrected spelling: the caret is on the sigil, so "remove the `+`" is an
    // exact single-token edit, and §13.5 struck the worked rewrite the message
    // used to append. Every shape below got one that produced a fresh error when
    // applied — `Pair(+Int, String)` was told to write `Pair(Int)`.
    const message = "remove the `+` — variance is declared on the type's declaration, " +
      "never written at a use site";
    const declarations = "export opaque record Box(+a) = { get: () -> a }\n" +
      "export opaque record Pair(+a, +b) = { first: () -> a, second: () -> b }\n" +
      "exception Empty\n";
    for (const annotation of [
      "Box(+Int)",
      "Pair(+Int, String)",
      "Pair(Int, +String)",
      "Box(+Vector(Int))",
      "Box(+(Int, Int))",
    ]) {
      expect(
        projectDiagnostics(`${declarations}export let b: ${annotation} = throw(Empty)\n`),
      ).toContain(message);
    }
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

  test("every row is consulted, and says what the table says", () => {
    // §6.3's verification reads a row through the same `multiply` that Step 2's
    // covariance test does, so a declaration site is where a row's effect can be
    // asserted for *every* row at once — including `Array` and `Nullable`, which
    // no source form can produce a value of in v1 and which therefore cannot be
    // observed at a generalization site at all.
    //
    // `Node` is absent deliberately: it is not nameable in a type annotation
    // (`unknown generic type \`Node\``), which is what makes its row's warrant
    // `intrinsics.md` §4.2 rather than anything a user could write.
    expect(projectDiagnostics("export opaque record W(+a) = { v: Vector(a) }\n")).toEqual([]);
    for (const field of ["Map(String, a)", "Set(a)", "Array(a)", "Nullable(a)"]) {
      expect(projectDiagnostics(`export opaque record W(+a) = { v: ${field} }\n`)).toContain(
        "`a` cannot be declared covariant in `W`: field `v` uses `a` in an " +
          "invariant position. Remove the `+`, or change the field",
      );
    }
  });
});

describe("§13.2 nothing else may generalize a `var`'s type", () => {
  // Statements & Mutability §7.2's alias assertion, which this branch added to
  // the spec and never wrote: `var v = makeEmpty()`, then `let e = v`. The
  // alias is expansive (a `var` read is not a value, §2.3), so item 7 runs on
  // it, and clauses (a) and (b) both pass in every specimen below —
  // unconstrained, covariant. Only level admission can decline, and it can only
  // decline because the `var`'s type was sunk to its block's level when the
  // `var` was bound (`#lowerLevels`, `checker.ts`).
  //
  // One specimen per *arm* of that walk, because the arms are independent code
  // and the covered ones (`Record`, `Union`/`NominalRecord`) do not exercise
  // these. Neutering any single arm below leaves this file's other tests green
  // and turns exactly one of these programs silent — which is the bug §13.2
  // exists to forbid: a polymorphic view of a binding that can still be
  // assigned at one type.
  const EMPTY = "exception Empty\n";

  test("the `Vector`/`Set`/`Array`/`Node` arm: an element variable", () => {
    expect(
      projectDiagnostics(
        EMPTY + "fun makeEmpty<a>(): Vector(a) = []\n" +
          "export fun use(): Int =\n" +
          "    var v = makeEmpty()\n" +
          "    let e = v\n" +
          "    let n: Int = Vector.at(e, 0)\n" +
          "    let s: String = Vector.at(e, 0)\n" +
          "    n\n",
      ),
    ).toEqual(["type mismatch: expected String, found Int"]);
  });

  test("§7.2's `:=` half: the assignment pins the alias's variable too", () => {
    // The assertion Statements §7.2 names explicitly. `e`'s use pins the
    // element type; the *assignment to `v`* at a second one is then the
    // ordinary pinned-type error — which is only true because `e` never
    // received a scheme quantifying the variable.
    expect(
      projectDiagnostics(
        EMPTY + "fun makeEmpty<a>(): Vector(a) = []\n" +
          "export fun use(): Int =\n" +
          "    var v = makeEmpty()\n" +
          "    let e = v\n" +
          "    let n: Int = Vector.at(e, 0)\n" +
          '    v := ["a"]\n' +
          "    n\n",
      ),
    ).toEqual(["type mismatch: expected Int, found String"]);
  });

  test("the `Tuple` arm: an element variable", () => {
    expect(
      projectDiagnostics(
        EMPTY + "fun makePair<a>(): (a, Int) = (throw(Empty), 1)\n" +
          "export fun use(): Int =\n" +
          "    var v = makePair()\n" +
          "    let e = v\n" +
          "    let n: Int = e.item1\n" +
          "    let s: String = e.item1\n" +
          "    n\n",
      ),
    ).toEqual(["type mismatch: expected String, found Int"]);
  });

  test("the `Function` arm: a result variable", () => {
    // The result, not the parameter: a variable in argument position is
    // contravariant and clause (b) would decline it whatever its level, so a
    // parameter specimen could not tell the two builds apart.
    expect(
      projectDiagnostics(
        EMPTY + "fun makeMaker<a>(): (Int) -> a = (n) => throw(Empty)\n" +
          "export fun use(): Int =\n" +
          "    var v = makeMaker()\n" +
          "    let e = v\n" +
          "    let n: Int = e(1)\n" +
          "    let s: String = e(1)\n" +
          "    n\n",
      ),
    ).toEqual(["type mismatch: expected String, found Int"]);
  });
});

describe("the acceptance test still runs", () => {
  /**
   * `Seq.`-qualified because `stdlib/Seq.hex` and `stdlib/Vector.hex` both export
   * `empty` and `prepend` (Collections Part 1 §3.1's shared vocabulary) and the
   * prelude scope keeps one binding per name. The program is about a generalized
   * empty sequence, so it names the member it means.
   */
  test("§1.1's empty-sequence program produces both sequences", async () => {
    const exports = await runMain(
      "let e = Seq.empty\n" +
        "export let ys: Int = Seq.length(Seq.prepend(e, 42))\n" +
        'export let xs: Int = Seq.length(Seq.prepend(e, "Briar"))\n',
    );
    expect(exports.ys).toBe(1);
    expect(exports.xs).toBe(1);
  });

  test("a generalized expansive binding still emits one shared value", async () => {
    const source = "fun makeEmpty<a>(): Vector(a) = []\n" +
      "let xs = makeEmpty()\n" +
      "export let n: Int = Vector.length(xs)\n";
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
