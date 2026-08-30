import { describe, expect, test } from "vitest";

import { PRE_REGISTERED_CONSTRAINTS, preRegisteredConstraintIdentity } from "../constraints.js";
import { compileFiles, runProject } from "../support/test-project.js";
import { emitJavaScript } from "../passes/emitter/emitter.js";
import {
  fundamentalInstancesOf,
  planFundamentalSpecializations,
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
 * That no prelude module *currently* mints an edition from a row it cannot see
 * is true and is not the reason this is safe. Every eligible prelude export
 * happens to sit at or after `String.hex`'s seat, which is an unwritten
 * invariant of the seat order and nothing else; the program table is what makes
 * the answer independent of it.
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

    // The channel itself, pinned: hand emission an empty table and the
    // pre-registered binder mints nothing, while the module's own view of the
    // prelude is untouched and would mint all seven. Without this the option
    // could quietly stop being threaded and every assertion above would still
    // pass, the module's own answer being the right one for `/main.hex`.
    expect(emitJavaScript(core, { fundamentalInstances: new Set() }).text)
      .not.toContain("renderInt");
    expect(emitJavaScript(core, { fundamentalInstances: compiled.fundamentalInstances }).text)
      .toContain("function renderInt(");
  });

  test("no prelude module's plan differs today, which is not why this is safe", () => {
    const compiled = project([["/main.hex", COLLECTIONS]]);
    const differing = compiled.modules.filter(({ core }) => {
      const visible = fundamentalInstancesOf([core], preludeBoolUnion(core));
      return planFundamentalSpecializations(core, compiled.fundamentalInstances)
          .specializations.length !==
        planFundamentalSpecializations(core, visible).specializations.length;
    });

    // Every eligible prelude export sits at or after `String.hex`'s seat, where
    // the shortfall is zero — an unwritten invariant of the seat order, and the
    // reason the row above is a *shortfall* count rather than an edition-count
    // difference. This row records that the invariant holds today; nothing in
    // the implementation relies on it, and re-seating one prelude module would
    // break it without breaking a compile.
    expect(differing.map(({ source }) => source.path)).toEqual([]);
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
    const compiled = project([["/main.hex", DESCRIBE]]);
    const module = main(compiled);
    const bool = preludeBoolUnion(module);
    const identity = "0:Describe";

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
    ].join("\n");
    const exports = await runProject([["/main.hex", source]]);

    for (const edition of ["Nat", "Int", "Float", "BigInt", "Bool", "String", "Unit"]) {
      expect(typeof exports[`keyed${edition}`]).toBe("function");
    }
    // Ground, not merely present: each edition hashes at its own type.
    expect((exports.keyedString as (x: string) => number)("a"))
      .toBe((exports.keyedString as (x: string) => number)("a"));
    expect((exports.keyedInt as (x: number) => number)(1))
      .not.toBe((exports.keyedInt as (x: number) => number)(2));
  });
});
