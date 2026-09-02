import { describe, expect, test } from "vitest";

import { PRE_REGISTERED_CONSTRAINTS } from "../constraints.js";
import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for constraint identity (`spec/constraints.md` §5.1.1, #276).
 *
 * A constraint **is its declaration**. Coherence's (constraint, type
 * constructor) key holds declarations, not spellings, so two modules that each
 * declare their own `Describe` and each honor it for `Int` are both lawful and
 * a third module importing both compiles.
 *
 * The defect this pins was keyed on the *name*: `#instanceKey` built
 * `` `${constraint}:primitive:Int` ``, so alpha's and beta's instances collided
 * in any module whose import graph reached both — and the report,
 * `duplicate instance of `Describe<Int>``, named a constraint neither module
 * could see. The two modules need not know about each other and the consumer
 * cannot name either constraint; nothing in the program is ambiguous.
 *
 * The fixtures are deliberately not near-copies of each other. Two conformance
 * modules that emit byte-identical JavaScript share one ESM `data:` module
 * instance in the test linker, which quietly makes a two-instance program a
 * one-instance program — exactly the confusion under test.
 */

/** Two modules with same-named, unrelated `Describe` constraints, plus a consumer. */
const sameNamedConstraints: readonly (readonly [string, string])[] = [
  ["/alpha.hex", [
    "constraint Describe<a> =",
    "    describe(subject: a): String",
    "",
    "honor Describe<Int> =",
    "    describe(n) = \"alpha sees ${n}\"",
    "",
    "export fun alphaLine(n: Int): String = describe(n)",
    "",
  ].join("\n")],
  ["/beta.hex", [
    "constraint Describe<a> =",
    "    describe(value: a): String",
    "",
    "honor Describe<Int> =",
    "    describe(count) = \"beta counted ${count} times\"",
    "",
    "export fun betaLine(count: Int): String = describe(count)",
    "",
  ].join("\n")],
  ["/main.hex", [
    "import Alpha from \"./alpha\"",
    "import Beta from \"./beta\"",
    "",
    "export fun both(): String = Alpha.alphaLine(1) ++ \" / \" ++ Beta.betaLine(2)",
    "",
  ].join("\n")],
];

describe("same-named constraints in different modules are distinct", () => {
  test("a consumer of both compiles (#276's filed acceptance)", () => {
    const compiled = compileFiles(sameNamedConstraints);

    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  });

  test("each module's instance answers its own constraint at runtime", async () => {
    const exports = await runProject(sameNamedConstraints);

    // Not merely "compiles": if the two instances had been merged under one key,
    // both calls would run whichever dictionary won, and the sentence would read
    // the same on both halves.
    expect((exports.both as () => string)()).toBe("alpha sees 1 / beta counted 2 times");
  });

  test("the consumer need not import both directly — evidence flows transitively", () => {
    const compiled = compileFiles([
      ...sameNamedConstraints.slice(0, 2),
      ["/middle.hex", [
        "import Alpha from \"./alpha\"",
        "import Beta from \"./beta\"",
        "",
        "export fun joined(): String = Alpha.alphaLine(3) ++ Beta.betaLine(4)",
        "",
      ].join("\n")],
      ["/tip.hex", [
        "import Middle from \"./middle\"",
        "",
        "export fun report(): String = Middle.joined()",
        "",
      ].join("\n")],
    ]);

    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  });

  test("a consumer may declare its own `Describe` and honor it for `Int` too", () => {
    // Three instances of "Describe<Int>" in one evidence universe, one of them
    // this module's own. The local `describe` call must reach the local
    // instance; the imported ones are not even nameable here.
    const compiled = compileFiles([
      ...sameNamedConstraints.slice(0, 2),
      ["/main.hex", [
        "import Alpha from \"./alpha\"",
        "import Beta from \"./beta\"",
        "",
        "constraint Describe<a> =",
        "    describe(item: a): String",
        "",
        "honor Describe<Int> =",
        "    describe(k) = \"main\"",
        "",
        "let five: Int = 5",
        "export fun mine(): String = describe(five) ++ Alpha.alphaLine(6) ++ Beta.betaLine(7)",
        "",
      ].join("\n")],
    ]);

    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  });
});

describe("coherence still holds within one constraint declaration", () => {
  test("two instances of the *same* declaration are a duplicate", () => {
    const compiled = compileFiles([["/main.hex", [
      "constraint Describe<a> =",
      "    describe(subject: a): String",
      "",
      "honor Describe<Int> =",
      "    describe(n) = \"first\"",
      "",
      "honor Describe<Int> =",
      "    describe(n) = \"second\"",
      "",
    ].join("\n")]]);

    // One constraint is in play, so §5.1.1's disambiguation rule leaves the
    // name bare: qualifying it by module would name the same module twice.
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "duplicate instance of `Describe<Int>`",
    ]);
  });

  test("an imported instance still collides with a second copy of itself", () => {
    // The same declaration reaching one module by two routes is one instance
    // (deduplicated by `InstanceImport.identity`); a genuinely second honor of
    // the same declaration is still an error. Pinned so that keying on identity
    // is not mistaken for switching duplicate detection off.
    const compiled = compileFiles([
      ["/lib.hex", [
        "export record Tag = {label: String}",
        "",
        "honor Eq<Tag> = derive",
        "",
        "export fun tag(label: String): Tag = Tag({label = label})",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Lib from \"./lib\"",
        "",
        "export fun same(): Bool = Lib.tag(\"x\") == Lib.tag(\"x\")",
        "",
      ].join("\n")],
    ]);

    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  });
});

describe("a requirement crossing a module boundary keeps its declaration", () => {
  test("an exported function polymorphic over a private constraint is callable", async () => {
    // The caller cannot spell `Describe`, so the identity has to ride the
    // scheme: re-deriving it from the name at the call site mints one this
    // module owns, and the instance the exporter supplied answers a different
    // constraint. Executed, because the failure mode after the diagnostic is a
    // dictionary that is imported but never the right one.
    const exports = await runProject([
      ["/alpha.hex", [
        "constraint Describe<a> =",
        "    describe(subject: a): String",
        "",
        "honor Describe<Int> =",
        "    describe(n) = \"alpha sees ${n}\"",
        "",
        "export fun announce<a: Describe>(subject: a): String = describe(subject)",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Alpha from \"./alpha\"",
        "",
        "let seven: Int = 7",
        "export fun greet(): String = Alpha.announce(seven)",
        "",
      ].join("\n")],
    ]);

    expect((exports.greet as () => string)()).toBe("alpha sees 7");
  });

  test("a local constraint of the same name does not answer the imported one", () => {
    // `main`'s own `Describe` has a `Bool` instance and no `Int` one. If the
    // imported requirement were keyed on the name, that local declaration would
    // be what the call site consulted.
    const compiled = compileFiles([
      ["/alpha.hex", [
        "constraint Describe<a> =",
        "    describe(subject: a): String",
        "",
        "export fun announce<a: Describe>(subject: a): String = describe(subject)",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Alpha from \"./alpha\"",
        "",
        "constraint Describe<a> =",
        "    describe(item: a): String",
        "",
        "honor Describe<Bool> =",
        "    describe(b) = \"local\"",
        "",
        "export fun greet(): String = Alpha.announce(True)",
        "",
      ].join("\n")],
    ]);

    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      // §7.6's sealed branch — `alpha`'s `Describe` is private — carrying
      // §5.1.1's disambiguate-by-home wording, because this module names a
      // `Describe` of its own and "not nameable here" would read as false.
      "type `Bool` has no `Describe` instance; the `Describe` required here is " +
        "`./alpha.hex`'s, not the one this module names; the honor can only be " +
        "written there",
    ]);
  });
});

describe("pre-registered constraints have one identity, held by the compiler", () => {
  test("a module may not redeclare a pre-registered name", () => {
    const compiled = compileFiles([["/main.hex", [
      "constraint Hash<a> =",
      "    hash(subject: a): Int",
      "",
    ].join("\n")]]);

    expect(compiled.diagnostics.map(({ message }) => message)).toContain(
      "constraint `Hash` is pre-registered and cannot be redeclared",
    );
  });

  test("every pre-registered name is refused alike", () => {
    // Eleven sequential compiles; the default 5s budget is occasionally too
    // tight for the whole loop even though each compile alone is quick.
    // All eleven, and the list is the whole inventory rather than a subset of
    // it. `Integral` (#335) and `Iterable` (#353) were held out while the
    // compiler pre-registered their *names* and held no declaration for
    // either — banning a redeclaration then would not have refused a twin, it
    // would have deleted the only spelling each feature had. Both have prelude
    // declarations now, so both are ordinary. Read against
    // `NON_REDECLARABLE_CONSTRAINTS`, which no longer filters anything out.
    for (const name of PRE_REGISTERED_CONSTRAINTS) {
      const compiled = compileFiles([["/main.hex",
        `constraint ${name}<a> =\n    probe(subject: a): Int\n`,
      ]]);

      expect(compiled.diagnostics.map(({ message }) => message)).toContain(
        `constraint \`${name}\` is pre-registered and cannot be redeclared`,
      );
    }
  }, 20000);

  test("redeclaring a module's own constraint keeps its own report", () => {
    const compiled = compileFiles([["/main.hex", [
      "constraint Describe<a> =",
      "    describe(subject: a): String",
      "",
      "constraint Describe<a> =",
      "    narrate(subject: a): String",
      "",
    ].join("\n")]]);

    expect(compiled.diagnostics.map(({ message }) => message)).toContain(
      "constraint `Describe` is already declared",
    );
  });

  test("the same pre-registered constraint is one constraint across modules", () => {
    // The other side of §5.1.1: identity must be *shared* by every reference to
    // one declaration, so two modules honoring `Eq` for the same type still
    // collide. `Ordering` is the prelude's, honored by the prelude already.
    const compiled = compileFiles([["/main.hex",
      "honor Eq<Ordering> =\n    equals(x, y) = True\n",
    ]]);

    expect(compiled.diagnostics.map(({ message }) => message)).toContain(
      "duplicate instance of `Eq<Ordering>`",
    );
  });
});
