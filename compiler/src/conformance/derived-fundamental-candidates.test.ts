import { describe, expect, test } from "vitest";

import { PRE_REGISTERED_CONSTRAINTS, preRegisteredConstraintIdentity } from "../constraints.js";
import { compileFiles, runProject } from "../support/test-project.js";
import { emitJavaScript } from "../passes/emitter/emitter.js";
import {
  fundamentalInstancesOf,
  planFundamentalSpecializations,
  planImportedSpecializations,
  preludeBoolUnion,
  sourceInstanceDictionary,
  type FundamentalType,
} from "../passes/emitter/specializations.js";
import type * as Core from "../syntax/core/index.js";

/**
 * Conformance for Algorithm S's candidate judgment (issue #679, leg 2).
 *
 * Zero-Cost Fundamental Exports §3.2 clause 2 defines `candidates(vi)` as the
 * ordinary Constraints §4/§5 lawfulness judgment — "No new instance judgment is
 * introduced" — and the implementation answered it from a hand table instead
 * (`fundamentalSupports`). A mirror drifts, and this one had: it carried no
 * `Hash` row for any fundamental, though all seven hold a lawful `Hash`, so
 * every `Hash`-bound export minted nothing and the whole `Set`/`Map` API
 * published no JavaScript entry point at all (§3.4's legal-but-listed case, at
 * library scale). It was also keyed on the constraint's *name*, so a constraint
 * a module declared could never match a row however it was honored.
 *
 * The table is retired. The judgment now reads the instances, on two grounds
 * that answer for the two kinds of constraint:
 *
 * - a **pre-registered** constraint from the program's table, read off the
 *   prelude once every prelude module is checked;
 * - a **declared** constraint from the module's own three instance channels.
 *
 * ## Why the pre-registered half cannot come from the planning module
 *
 * A prelude module sees only the members before its own seat (Modules §5.5), so
 * asking it would have `Nat.hex` plan one edition set for its own exports and
 * every consumer recompute a larger one (`planImportedSpecializations`) — an
 * importer emitting a call to a name the exporter never published. The first
 * block below measures that gap rather than asserting it is absent: nine prelude
 * modules see strictly fewer rows than the program does.
 *
 * ## What the table did not remove
 *
 * The table removed exporter/importer **disagreement**. It did not remove the
 * exporter's duty to **resolve** what it plans, and the prelude seat order is
 * what discharges that duty — so the seat order is load-bearing here, not
 * incidental. An edition at a primitive carries `Primitive` evidence, which
 * `#emitEvidence` resolves from the *emitting* module's own channels; a prelude
 * module planning an edition at a fundamental whose companion sits after its own
 * seat cannot see the dictionary. Measured, by adding one well-formed
 * `export fun ordEq<a: Ord>(…)` to `stdlib/Ord.hex`: five editions mint and five
 * compiler-defect diagnostics follow. Loud rather than silent, which is what
 * makes the dependence safe — and the last row of the second block is that
 * obligation asserted rather than assumed.
 *
 * ## Why the declared half can
 *
 * The orphan rule (Constraints §5.3, with each primitive's fixed companion as
 * its home module) puts a declared constraint's fundamental instances in the
 * constraint's own declaring module, and a module that names the constraint has
 * imported that module — transitively, which `ImportItem.instances` carries. So
 * exporter and importer read the same rows without a program table.
 */

/** The compiled project of one program, asserted to have reported nothing. */
function project(files: readonly (readonly [string, string])[]): ReturnType<typeof compileFiles> {
  const compiled = compileFiles(files);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  return compiled;
}

function main(compiled: ReturnType<typeof compileFiles>): Core.Module {
  return compiled.modules.find(({ source }) => source.path === "/main.hex")!.core;
}

/** The judgment's rows, as a `Fundamental -> constraint names` reading. */
function rows(instances: ReadonlySet<string>): ReadonlyMap<string, readonly string[]> {
  const byType = new Map<string, string[]>();
  for (const row of instances) {
    const [identity, type] = row.split("|") as [string, string];
    byType.set(type, [...(byType.get(type) ?? []), identity]);
  }
  return new Map(
    [...byType].map(([type, identities]) => [type, [...identities].sort()] as const),
  );
}

function preRegistered(...names: readonly string[]): readonly string[] {
  return names.map(preRegisteredConstraintIdentity).sort();
}

/** A program that reaches most of the prelude, so most of it is emitted. */
const COLLECTIONS = [
  "export let s: Set(Int) = Set.add(Set.empty, 1)",
  "export let m: Map(Int, String) = Map.set(Map.empty, 1, \"a\")",
  "export let v: Vector(Int) = [1, 2, 3]",
  "export let shown: String = \"${v}\"",
  "export let scaled: Float = 1.5",
  "export let big: BigInt = 9n",
  "",
].join("\n");

/**
 * The same, plus what it takes to pull the **early constraint seats** into the
 * emitted set.
 *
 * A ground `compare(1, 2)` does not: it lowers monomorphically and names no
 * member forwarder. A *generic* one does, and each of these reaches its own
 * declaration module — `Show.hex` is the first prelude seat of all.
 */
const REACHES_EARLY_SEATS = [
  "export fun say<a: Show>(x: a): String = show(x)",
  "export fun same<a: Eq>(x: a, y: a): Bool = Eq.equals(x, y)",
  "export fun rank<a: Ord>(x: a, y: a): Ordering = Ord.compare(x, y)",
  "export fun keyed<a: Hash>(x: a): Int = Hash.hash(x)",
  "export fun neg<a: Signed>(x: a): a = Signed.negate(x)",
  "export fun sq<a: Pow>(x: a, n: Nat): a = Pow.pow(x, n)",
  COLLECTIONS,
].join("\n");

describe("the judgment over the pre-registered constraints", () => {
  test("is the prelude's instances, and this is the whole of it", () => {
    const compiled = project([["/main.hex", "export let x: Int = 1\n"]]);

    // The full inventory, spelled out. This is the row set the retired table
    // held **plus `Hash` on all seven** — the drift #679 was filed for — and it
    // is here so that a `stdlib/` edit changing which fundamentals honor what is
    // caught at the planner rather than in a `.d.ts` golden three files away.
    expect(rows(compiled.fundamentalInstances)).toEqual(new Map([
      ["Nat", preRegistered("Num", "Eq", "Ord", "Show", "Pow", "Integral", "Hash")],
      ["Int", preRegistered("Num", "Signed", "Eq", "Ord", "Show", "Pow", "Integral", "Hash")],
      ["Float", preRegistered("Num", "Signed", "Frac", "Eq", "Ord", "Show", "Pow", "Hash")],
      ["BigInt", preRegistered("Num", "Signed", "Eq", "Ord", "Show", "Pow", "Integral", "Hash")],
      ["String", preRegistered("Eq", "Ord", "Show", "Concat", "Hash")],
      // The two enumeration-membered fundamentals answer from the #147/#159 pin
      // — the four the compiler can derive — because that is exactly what an
      // edition's `Structural` evidence at them will render.
      ["Bool", preRegistered("Eq", "Ord", "Show", "Hash")],
      ["Unit", preRegistered("Eq", "Ord", "Show", "Hash")],
    ]));
  });

  test("`Iterable`'s provided row is not a candidate", () => {
    const compiled = project([["/main.hex", "export let x: Int = 1\n"]]);

    // `String` satisfies `Iterable` through a *provided* row (Collections Part 5
    // §4) — a coherence slot no module writes an instance for and no module
    // exports a dictionary for. It contributes no row here, so an
    // `Iterable`-bound export stays generic-only, which is where it was before
    // this change. Whether §3.2's judgment ought to count provided rows is a
    // separate question from #679's, and this pins today's answer rather than
    // settling it.
    for (const type of ["Nat", "Int", "Float", "BigInt", "String", "Bool", "Unit"]) {
      expect(compiled.fundamentalInstances.has(`hex:Iterable|${type}`)).toBe(false);
    }
  });

  test("every pre-registered constraint is accounted for, none silently absent", () => {
    const compiled = project([["/main.hex", "export let x: Int = 1\n"]]);
    const seen = new Set(
      [...compiled.fundamentalInstances].map((row) => row.slice(0, row.lastIndexOf("|"))),
    );

    // Derived from the inventory rather than restated: a twelfth pre-registered
    // constraint has to be classified here deliberately, and cannot arrive with
    // no row and no notice — which is the failure mode the hand table had.
    expect([...seen].sort()).toEqual(
      PRE_REGISTERED_CONSTRAINTS
        .filter((name) => !["Iterable"].includes(name))
        .map(preRegisteredConstraintIdentity)
        .sort(),
    );
  });
});

describe("the program table is what makes a prelude module's plan the consumer's", () => {
  test("nine prelude modules see strictly fewer rows than the program does", () => {
    const compiled = project([["/main.hex", COLLECTIONS]]);
    const shortfalls = compiled.modules
      .map(({ source, core }) => ({
        path: source.path,
        missing: [...compiled.fundamentalInstances]
          .filter((row) => !fundamentalInstancesOf([core], preludeBoolUnion(core)).has(row))
          .length,
      }))
      .filter(({ missing }) => missing > 0);

    // Modules §5.5's visibility, measured. `Int.hex` cannot see `Nat`'s rows,
    // `Nat.hex` cannot see `Float`'s, and the four constraint declarations
    // before them see no companion at all. Every one of these would plan a
    // smaller edition set for its own exports than a consumer recomputes.
    expect(shortfalls.map(({ path }) => path)).toEqual([
      "/Pow.hex",
      "/Hash.hex",
      "/Integral.hex",
      "/Option.hex",
      "/Int.hex",
      "/Nat.hex",
      "/Float.hex",
      "/BigInt.hex",
      "/Seq.hex",
    ]);
    expect(shortfalls.find(({ path }) => path === "/Int.hex")?.missing).toBe(28);
    expect(shortfalls.find(({ path }) => path === "/Nat.hex")?.missing).toBe(21);
  });

  test("emission plans from the table it is handed, not from the module", () => {
    const compiled = project([["/main.hex", [
      "export fun render<a: Show>(x: a): String = \"${x}\"",
      "",
    ].join("\n")]]);
    const core = main(compiled);

    // The **option** works, which is a narrower claim than it looks and is
    // stated narrowly on purpose: hand emission an empty table and the
    // pre-registered binder mints nothing; hand it the program's and it mints.
    //
    // What this row does *not* show is that `compileProject` threading the
    // table changes any output, because today it does not — deleting
    // `fundamentalInstances` from both emission calls leaves the whole suite
    // green, the two answers coinciding on this prelude. The next row is the
    // tripwire for when that stops being true.
    expect(emitJavaScript(core, { fundamentalInstances: new Set() }).text)
      .not.toContain("renderInt");
    expect(emitJavaScript(core, { fundamentalInstances: compiled.fundamentalInstances }).text)
      .toContain("function renderInt(");
  });

  test("no prelude module's plan differs from its own view — the tripwire", () => {
    const compiled = project([["/main.hex", COLLECTIONS]]);
    const differing = compiled.modules.filter(({ core }) => {
      const visible = fundamentalInstancesOf([core], preludeBoolUnion(core));
      return planFundamentalSpecializations(core, compiled.fundamentalInstances)
          .specializations.length !==
        planFundamentalSpecializations(core, visible).specializations.length;
    });

    // The program table and a prelude module's own view answer differently only
    // where the module *plans* from a row it cannot see, and no prelude module
    // does today: every eligible prelude export sits at or after `String.hex`'s
    // seat. That is why the shortfall row above is a shortfall count and not an
    // edition-count difference, and it is why threading the table is currently
    // unobservable.
    //
    // So this row is a tripwire, not a guarantee. When it reddens — a
    // constrained export added at an early prelude seat, or a module re-seated
    // — the seam has started to matter and needs a pin of its own that fails
    // when the table is not threaded. Read it beside the obligation below,
    // which is the half that is load-bearing today.
    expect(differing.map(({ source }) => source.path)).toEqual([]);
  });

  test("every edition a module plans, it can resolve the dictionaries for", () => {
    // The obligation the seat order actually carries, and the correction to
    // this file's first draft, which said nothing relied on it.
    //
    // The program table removed exporter/importer *disagreement*. It did not
    // remove the exporter's duty to **resolve** what it plans: an edition at a
    // primitive carries `Primitive` evidence, and `#emitEvidence` resolves that
    // from the emitting module's own channels. A prelude module planning an
    // edition at a fundamental whose companion sits after its own seat cannot
    // see the dictionary and reports a compiler defect. Measured, by adding one
    // well-formed `export fun ordEq<a: Ord>(…)` to `stdlib/Ord.hex` (seat 10):
    // five editions mint, five `` compiler defect: `Ord<Nat>` is a source
    // instance of a migrated primitive companion, but no dictionary for it
    // reached this module `` diagnostics follow, and this row goes from zero
    // unresolvable to five. Loud rather than silent, which is what makes the
    // seat order safe to depend on — but depend on it we do.
    //
    // `Bool` and `Unit` are skipped because their editions carry `Structural`
    // evidence, which is rendered from the type and asks no channel anything.
    // `compileFiles` rather than the `project` helper, so the loop below is
    // what detects a violation rather than the helper's blanket
    // no-diagnostics guard. The symptom is asserted too, separately: the two
    // are the same fact read at its cause and at its report, and neither
    // should be able to go quiet while the other holds.
    const compiled = compileFiles([["/main.hex", REACHES_EARLY_SEATS]]);
    const unresolvable: string[] = [];
    for (const { source, core } of compiled.modules) {
      const bool = preludeBoolUnion(core);
      const plan = planFundamentalSpecializations(core, compiled.fundamentalInstances);
      for (const specialization of plan.specializations) {
        const declaration = core.symbols.find(({ id }) => id === specialization.sourceSymbol);
        for (const { variable, type } of specialization.assignment) {
          if (type === "Bool" || type === "Unit") continue;
          for (const constraint of declaration?.scheme.constraints ?? []) {
            if (constraint.type.kind !== "Variable" || constraint.type.id !== variable) continue;
            if (sourceInstanceDictionary(core, constraint.identity, type, bool) === undefined) {
              unresolvable.push(`${source.path} ${specialization.name} ${constraint.identity}`);
            }
          }
        }
      }
    }

    expect(unresolvable).toEqual([]);
    expect(
      compiled.diagnostics
        .map(({ message }) => message)
        .filter((message) => message.startsWith("compiler defect:")),
    ).toEqual([]);
    // The loop reaches only what a project *emits*, so the corpus has to reach
    // the seats the obligation is about or the row asserts nothing about them.
    // `Show.hex` is prelude seat 1 and the hardest case there is.
    const emitted = compiled.modules.map(({ source }) => source.path);
    for (const seat of ["/Show.hex", "/Eq.hex", "/Ord.hex", "/Hash.hex", "/Signed.hex"]) {
      expect(emitted).toContain(seat);
    }
  });
});

describe("a declared constraint's candidates are its own instances", () => {
  const DESCRIBE = [
    "constraint Describe<a> =",
    "    describe(subject: a): String",
    "",
    "honor Describe<Int> =",
    "    describe(n) = \"int ${n}\"",
    "",
    "honor Describe<Bool> =",
    "    describe(b) = if b then \"yes\" else \"no\"",
    "",
    "export fun tell<a: Describe>(x: a): String = describe(x)",
    "",
  ].join("\n");

  test("one edition per fundamental honored, including `Bool`", async () => {
    const compiled = project([["/main.hex", DESCRIBE]]);
    const planned = planFundamentalSpecializations(
      main(compiled),
      compiled.fundamentalInstances,
    ).specializations;

    expect(planned.map(({ name }) => name).sort()).toEqual(["tellBool", "tellInt"]);
    // `Bool` reaches a declared constraint through its ordinary instance row —
    // §3.2's judgment at `Unit` and `Bool` — which is the evidence leg 1 taught
    // the edition to resolve. Before that repair this edition emitted an empty
    // dictionary literal and called a member on it, silently.
    const exports = await runProject([["/main.hex", DESCRIBE]]);
    expect((exports.tellInt as (x: number) => string)(3)).toBe("int 3");
    expect((exports.tellBool as (x: boolean) => string)(true)).toBe("yes");
  });

  test("`Unit` is never among them, which the judgment is obliged to hold", () => {
    // The subject is a **refused** `honor Describe<Unit>`, for the reason leg
    // 1's twin of this row uses one: `DESCRIBE` has no tuple-subject instance,
    // so asking it about `Unit` cannot fail however the walk is written. The
    // refusal still leaves a `Honor` item over the empty tuple in Core, so both
    // halves below are asked for real and redden together if `instanceSubjectHead`
    // ever grows a tuple branch.
    const compiled = compileFiles([["/main.hex", [
      "constraint Describe<a> =",
      "    describe(subject: a): String",
      "",
      "honor Describe<Unit> =",
      "    describe(u) = \"unit\"",
      "",
      "export fun tell<a: Describe>(x: a): String = describe(x)",
      "",
    ].join("\n")]]);
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "instances are keyed on type constructors; tuples and structural records " +
        "have compiler-derived instances only — declare a nominal `record` or " +
        "`union` for a type you control",
    ]);
    const module = compiled.modules.find(({ source }) => source.path === "/main.hex")!.core;
    const bool = preludeBoolUnion(module);
    const identity = "0:Describe";
    expect(module.items.find((item) => item.kind === "Honor")).toMatchObject({
      constraintIdentity: identity,
      subject: { kind: "Tuple", elements: [] },
    });

    // Two halves of one obligation, stated together because each is the other's
    // reason (§3.2's judgment at `Unit`):
    //
    // - no `honor` can name the empty tuple, so the *lookup* answers nothing
    //   there — leg 1's `honoredAt`, pinned in `edition-evidence-identity`;
    // - therefore the *judgment* must never offer `Unit` as a candidate for a
    //   declared constraint, because an edition minted there would resolve its
    //   dictionary to nothing and report a compiler defect.
    expect(fundamentalInstancesOf([module], bool).has(`${identity}|Unit`)).toBe(false);
    expect(sourceInstanceDictionary(module, identity, "Unit", bool)).toBeUndefined();
  });

  test("no instance at any fundamental is §3.4's zero-entry-point export", () => {
    const compiled = project([["/main.hex", [
      "constraint Render<a> =",
      "    render(value: a): String",
      "",
      "export fun show1<a: Render>(x: a): String = render(x)",
      "",
    ].join("\n")]]);

    // Legal, not an error, and the emitted module still carries the generic
    // evidence-taking form as §3.4's plumbing bullet allows.
    expect(
      planFundamentalSpecializations(main(compiled), compiled.fundamentalInstances)
        .specializations,
    ).toEqual([]);
  });

  test("a candidate the judgment admits always resolves to a dictionary", () => {
    const compiled = project([["/main.hex", DESCRIBE]]);
    const module = main(compiled);
    const bool = preludeBoolUnion(module);
    const fundamentals: readonly FundamentalType[] = [
      "Nat",
      "Int",
      "Float",
      "BigInt",
      "Bool",
      "String",
      "Unit",
    ];

    // The pairing `#editionInstanceDictionary`'s compiler-defect report exists
    // for, asserted directly rather than through the report: for a declared
    // constraint the judgment and the evidence lookup read the same three
    // channels, so an admitted candidate cannot fail to resolve. That is why the
    // report is unreachable on a well-formed program, and why it stays — it is
    // the assertion that the two never come apart.
    const admitted = [...fundamentalInstancesOf([module], bool)]
      .filter((row) => row.startsWith("0:"));
    expect(admitted.length).toBeGreaterThan(0);
    for (const row of admitted) {
      const identity = row.slice(0, row.lastIndexOf("|"));
      const type = row.slice(row.lastIndexOf("|") + 1) as FundamentalType;
      expect(fundamentals).toContain(type);
      expect(sourceInstanceDictionary(module, identity, type, bool)).toBeDefined();
    }
  });

  test("exporter and importer agree across a module that never names the declarer", () => {
    // The orphan-rule argument at its full length, which is the shape the
    // two-module rows cannot reach. Three modules:
    //
    //   A declares `Describe` and honors it at `Int`;
    //   B imports A and exports a constrained `tell`;
    //   C imports **only B** and calls `tell` at a ground `Int`.
    //
    // C has to recompute B's plan (`planImportedSpecializations`) to know which
    // edition to call, and it does that from its own instance channels — where
    // `Describe<Int>` arrives only because `ImportItem.instances` carries an
    // instance transitively. C spells neither the constraint's declaring module
    // nor the instance's; if the judgment consulted only what a module names,
    // C would plan nothing here and keep the generic call while `tellInt` sat
    // published in B.
    const compiled = project([
      ["/describe.hex", [
        "export constraint Describe<a> =",
        "    describe(subject: a): String",
        "",
        "honor Describe<Int> =",
        "    describe(n) = \"int ${n}\"",
        "",
      ].join("\n")],
      ["/tell.hex", [
        "import Describe from \"./describe\"",
        "",
        "export fun tell<a: Describe>(x: a): String = Describe.describe(x)",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Tell from \"./tell\"",
        "",
        "let one: Int = 1",
        "export let told: String = Tell.tell(one)",
        "",
      ].join("\n")],
    ]);
    const teller = compiled.modules.find(({ source }) => source.path === "/tell.hex")!.core;
    const consumer = main(compiled);

    // The instance reached C without C asking for it, and through a module that
    // did not declare it.
    const transitive = consumer.items.flatMap((item) =>
      item.kind === "Import" ? item.instances : []
    );
    expect(transitive.map(({ constraintIdentity, localDictionary }) =>
      `${constraintIdentity}=${localDictionary}`
    )).toEqual(["0:Describe=__Describe_Int"]);

    // The agreement itself: what B published, and what C recomputes for the
    // same declaration. A mismatch either way is a defect — an importer calling
    // a name the exporter never wrote, or an exporter publishing one nobody
    // reaches.
    const published = planFundamentalSpecializations(teller, compiled.fundamentalInstances)
      .specializations.map(({ name }) => name);
    const recomputed = planImportedSpecializations(
      consumer.symbols.find(({ name }) => name === "tell")!,
      consumer,
      compiled.fundamentalInstances,
      preludeBoolUnion(consumer),
    ).map(({ name }) => name);

    expect(published).toEqual(["tellInt"]);
    expect(recomputed).toEqual(published);

    // And the emission that rests on it: C reaches the edition by name, from B,
    // naming A nowhere at all. `tell` is never called bare in `/main.hex` —
    // it is reached `Tell.tell` (#762) — so the named line carries the raw
    // private name rather than a `tell`-aliased one; the module-alias line
    // beside it is #762's "emission is unchanged in shape" clause.
    const javascript = compiled.modules
      .find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(javascript).toContain('import * as Tell from "./tell.js";');
    expect(javascript).toContain('import { __tell, tellInt } from "./tell.js";');
    expect(javascript).toContain("const told = tellInt(one);");
    expect(javascript).not.toContain("./describe.js");
  });
});

describe("the collections API gains its JavaScript entry points", () => {
  test("`Set` and `Map` publish editions where they published none", () => {
    const compiled = project([["/main.hex", COLLECTIONS]]);
    const editionsOf = (basename: string): number => {
      const module = compiled.modules.find(({ source }) => source.path === `/${basename}.hex`)!;
      return planFundamentalSpecializations(module.core, compiled.fundamentalInstances)
        .specializations.length;
    };

    // Every core collections export is `Hash`-bound, so with no `Hash` row the
    // two companions were §3.4's zero-entry-point case at library scale: the
    // build report's list of exports with no JavaScript surface held all of
    // them, and a JS consumer could reach none. The seven `Hash` candidates are
    // what changes that.
    expect(editionsOf("Set")).toBe(42);
    expect(editionsOf("Map")).toBe(28);
  });

  test("a `Hash`-bound export is callable from JavaScript at every fundamental", async () => {
    const source = [
      "export fun keyed<a: Hash>(x: a): Int = Hash.hash(x)",
      "",
      // The ground answers to compare each edition against, hashed at the
      // concrete type by a program that names no binder at all.
      "export let groundString: Int = Hash.hash(\"a\")",
      "export let groundInt: Int = Hash.hash(1)",
      "export let groundBool: Int = Hash.hash(True)",
      "export let groundUnit: Int = Hash.hash(())",
      "",
    ].join("\n");
    const exports = await runProject([["/main.hex", source]]);

    for (const edition of ["Nat", "Int", "Float", "BigInt", "Bool", "String", "Unit"]) {
      expect(typeof exports[`keyed${edition}`]).toBe("function");
    }
    // Ground parity, not mere determinism: each edition returns what a
    // hand-written call at that type returns. A `keyedString` that hashed
    // through the wrong dictionary would still be a function of its argument.
    expect((exports.keyedString as (x: string) => number)("a")).toBe(exports.groundString);
    expect((exports.keyedInt as (x: number) => number)(1)).toBe(exports.groundInt);
    expect((exports.keyedBool as (x: boolean) => number)(true)).toBe(exports.groundBool);
    expect((exports.keyedUnit as (x: undefined) => number)(undefined))
      .toBe(exports.groundUnit);
  });
});
