import { describe, expect, test } from "vitest";

import { compileFiles } from "../support/test-project.js";
import { planFundamentalSpecializations } from "../passes/emitter/specializations.js";
import type * as Emitted from "../emission/emitted.js";
import type { CompiledModule } from "../project.js";

/**
 * Conformance for the two build-report obligations of Zero-Cost Fundamental
 * Exports (issue #687, compiler leg).
 *
 * §10 makes the Cartesian product's code growth acceptable **on the condition
 * that it is measurable**: the compiler must make available, per emitted module,
 * the emitted JS size and `.d.ts` size attributable to generated
 * specializations, and the same report must list every zero-entry-point export
 * (§3.4). The first half existed for the JavaScript alone
 * (`JavaScript.generatedSections`); the `.d.ts` half and the list did not.
 *
 * Both are now always-on metadata on the emitted artefacts rather than a
 * reporting mode. The compiler is a library and prints nothing, so there is no
 * terminal to keep quiet; a gated mode would only add a second configuration in
 * which the report path and the emission path can drift apart, which is the one
 * failure a report of an emission must not have.
 *
 * ## What "zero entry point" is asserted to mean here
 *
 * §3.4's own condition conjoins an empty lawful-tuple product with §4's trigger
 * being unmet. What is implemented, and what these rows pin, is the **emission
 * fact**: a §3.1-eligible export that published no typed face. Algorithm G is
 * unimplemented, so the two coincide today; the emission-fact phrasing is what
 * keeps the list truthful without this file adjudicating #423, which records
 * that FFI Part 7 §7 gives the generic edition no `.d.ts` face anyway.
 *
 * The distinction is not decorative. A list computed by re-deriving §3.4 would
 * be a second opinion about the module, and the first thing a second opinion
 * does is disagree — the retired `fundamentalSupports` table (#679) is this
 * repository's own demonstration, having silently emptied every `Hash`-bound
 * export's surface while the planner believed otherwise. The rows below
 * therefore compare the list against the *faces the module emitted*, not
 * against a recomputed plan: wire the list to a parallel planner invocation and
 * "a module's every listed export has no face" is the row that reddens.
 */

function compile(files: readonly (readonly [string, string])[]): {
  readonly module: (path: string) => CompiledModule;
} {
  const project = compileFiles(files);
  // §3.4 is legal, not an error, and every source below is expected to compile
  // clean — the point of the list is that nothing else tells the author.
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return {
    module: (path) => {
      const found = project.modules.find(({ source }) => source.path === path);
      expect(found, `no compiled module at ${path}`).toBeDefined();
      return found!;
    },
  };
}

/** One module compiled as `/main.hex`, prelude included. */
function main(source: string): CompiledModule {
  return compile([["/main.hex", source]]).module("/main.hex");
}

/** Every `export declare function` name the `.d.ts` publishes. */
function declaredFunctions(declarations: Emitted.Declarations): readonly string[] {
  return [...declarations.text.matchAll(/^export declare function (\w+)\(/gmu)]
    .map((match) => match[1]!);
}

/**
 * `constraint Weighty<a>` with no fundamental instance anywhere — §16(h)'s and
 * §16(k)'s constraint, and the reason their exports have empty candidate sets.
 */
const WEIGHTY = [
  "constraint Weighty<a> =",
  "    weight(subject: a): Float",
  "",
].join("\n");

describe("the zero-entry-point list (§3.4)", () => {
  test("lists §16(h)'s worked example by name, and reports nothing else", () => {
    // §16(h) verbatim in shape: a user constraint with no fundamental instance,
    // and an export bound by it. `Weighty` is honored nowhere, so
    // `candidates(a)` is empty, the product is empty, and no entry point is
    // published — legal, and the whole of what the list exists to make visible.
    const module = main(`${WEIGHTY}export fun heaviest<a: Weighty>(x: a, y: a): Float =\n` +
      "    if x.weight() > y.weight() then x.weight() else y.weight()\n");

    expect(module.declarations.zeroEntryPointExports).toEqual(["heaviest"]);
    // The export is absent from the foreign surface and present as a Hexagon
    // one: §3.4's bargain, both halves. The `.d.ts` carries no row for it, and
    // the ESM carries the evidence-taking form the second bullet describes as
    // plumbing — which is exactly why the list is not on the JavaScript.
    expect(declaredFunctions(module.declarations)).toEqual([]);
    expect(module.declarations.generatedSections).toEqual([]);
    expect(module.javascript.text).toContain("heaviest");
  });

  test("empties the product from one variable of several — §16(k)", () => {
    // Both variables are constrained and only one is stocked: `Show` admits
    // every fundamental, `Weighty` admits none, and §3.2 clause 3's product over
    // the two is empty regardless. The interesting failure this excludes is a
    // planner that took the non-empty variable's candidates as the answer and
    // published a partial tuple.
    const module = main(`${WEIGHTY}export fun describe<a: Show, b: Weighty>(x: a, y: b): String =\n` +
      "    \"${x} at ${y.weight()}\"\n");

    expect(module.declarations.zeroEntryPointExports).toEqual(["describe"]);
    expect(declaredFunctions(module.declarations)).toEqual([]);
  });

  test("lists only the eligible export that published nothing", () => {
    const module = main([
      WEIGHTY,
      "export fun heaviest<a: Weighty>(x: a): Float = x.weight()",
      "",
      "export fun stamp<a: Hash>(x: a, salt: Int): Int = x.hash() + salt",
      "",
      "export fun plain(x: Int): Int = x + 1",
      "",
    ].join("\n"));

    // One row, and the other two exports each excluded for their own reason:
    // `stamp` minted editions (all seven fundamentals hold a lawful `Hash` —
    // #679's repair, #686's count), and `plain` is ineligible, carrying no
    // constrained variable at all. A list that reported "published no face"
    // without §3.1's eligibility gate would carry `plain` too.
    expect(module.declarations.zeroEntryPointExports).toEqual(["heaviest"]);
    expect(declaredFunctions(module.declarations)).toEqual([
      "stampNat",
      "stampInt",
      "stampFloat",
      "stampBigInt",
      "stampBool",
      "stampString",
      "stampUnit",
      // `plain`'s own face, which is what makes it a control rather than a
      // second empty case: it publishes an entry point by being ordinary.
      "plain",
    ]);
    // The sections are the *generated* faces alone — `plain`'s row is in the
    // file and not in the accounting, which is what "attributable to generated
    // specializations" means (§10).
    expect(module.declarations.generatedSections).toHaveLength(7);
  });

  test("does not list a private constrained function, in either planner mode", () => {
    const source = `${WEIGHTY}fun heaviest<a: Weighty>(x: a): Float = x.weight()\n` +
      "\n" +
      "export fun weigh(x: Float): Float = x\n";
    const module = main(source);

    expect(module.declarations.zeroEntryPointExports).toEqual([]);
    // The inspection preview's `includePrivate` widens which *editions* are
    // planned and must not widen the list: the report is about the module's real
    // foreign surface, and a private declaration is never on it however a host
    // asks to look at the module.
    expect(
      planFundamentalSpecializations(module.core, undefined, true).zeroEntryPointExports,
    ).toEqual([]);
  });

  test("does not list a constrained non-function export — §3.1 reserves it to §13.3", () => {
    // A bare alias of a constrained function: the binding generalizes with the
    // constraint intact and its value is not a lambda, so it is outside
    // Algorithm S rather than inside it with nothing to show. §3.1's exclusion
    // is a scope statement, and reporting the alias would claim this document
    // owns a surface it explicitly hands to the FFI consolidation.
    const module = main([
      "fun plus<a: Num>(x: a, y: a): a = x + y",
      "",
      "export let add: (a, a) -> a = plus",
      "",
    ].join("\n"));
    const add = module.core.items.find(
      (item) => (item.kind === "Let" || item.kind === "Fun") && item.binding.name === "add",
    );

    // The row is only worth having if the alias is the shape §3.1 excludes, so
    // that is asserted rather than assumed: an exported `Let` whose value is not
    // a lambda and whose generalized scheme really does carry `Num`. A predicate
    // reading "exported, constrained, published no face" — which is what a
    // reader might reasonably expect the list to mean — would list it.
    expect(add?.kind).toBe("Let");
    expect((add as { readonly value: { readonly kind: string } }).value.kind)
      .not.toBe("Lambda");
    expect(add?.binding.scheme.constraints.map(({ name }) => name)).toEqual(["Num"]);
    expect(module.declarations.text).toBe("export {};\n");
    expect(module.declarations.zeroEntryPointExports).toEqual([]);
  });

  test("is the declaring module's alone — an importer repeats nothing", () => {
    const project = compile([
      ["/lib.hex", [
        "export constraint Weighty<a> =",
        "    weight(subject: a): Float",
        "",
        "export fun heaviest<a: Weighty>(x: a): Float = x.weight()",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import {heaviest, Weighty} from \"./lib.hex\"",
        "",
        "export record Grams = {n: Float}",
        "",
        "honor Weighty<Grams> =",
        "    weight(g) = g.n",
        "",
        "export fun heaviestGrams(x: Grams): Float = heaviest(x)",
        "",
      ].join("\n")],
    ]);

    // The row belongs to the module that *declares* the export, once. An
    // importer sees the same empty candidate set — `planImportedSpecializations`
    // recomputes the exporter's plan on purpose — and a list built from that
    // recomputation would report `heaviest` again from every consumer, turning
    // one author's fact into every downstream module's noise.
    expect(project.module("/lib.hex").declarations.zeroEntryPointExports)
      .toEqual(["heaviest"]);
    expect(project.module("/main.hex").declarations.zeroEntryPointExports)
      .toEqual([]);
  });
});

describe("`.d.ts` byte accounting (§10)", () => {
  test("gives every emitted face a section that round-trips at its offsets", () => {
    const module = main("export fun stamp<a: Hash>(x: a, salt: Int): Int = x.hash() + salt\n");
    const { text, generatedSections } = module.declarations;

    expect(generatedSections).toMatchObject([
      { sourceName: "stamp", generatedName: "stampNat", typeArguments: ["Nat"] },
      { sourceName: "stamp", generatedName: "stampInt", typeArguments: ["Int"] },
      { sourceName: "stamp", generatedName: "stampFloat", typeArguments: ["Float"] },
      { sourceName: "stamp", generatedName: "stampBigInt", typeArguments: ["BigInt"] },
      { sourceName: "stamp", generatedName: "stampBool", typeArguments: ["Bool"] },
      { sourceName: "stamp", generatedName: "stampString", typeArguments: ["String"] },
      { sourceName: "stamp", generatedName: "stampUnit", typeArguments: ["Unit"] },
    ]);
    let previous = -1;
    for (const section of generatedSections) {
      const face = text.slice(section.startOffset, section.endOffset);
      // The section is the whole rendered face and nothing else, not a window
      // near it: offsets that drifted a line or a character from what was pushed
      // would still produce plausible numbers, and this is the assertion that
      // plausible is not enough.
      expect(face).toMatch(
        new RegExp(`^export declare function ${section.generatedName}\\(.*;$`, "u"),
      );
      expect(section.bytes).toBe(face.length);
      expect(section.bytes).toBeGreaterThan(0);
      // Disjoint and in file order, which is what makes the sum of `bytes` the
      // module's `.d.ts` size attributable to specializations (§10) rather than
      // a sum over overlapping windows.
      expect(section.startOffset).toBeGreaterThan(previous);
      previous = section.endOffset;
    }
  });

  test("agrees with the JavaScript sections edition for edition", () => {
    const module = main([
      "export fun stamp<a: Hash>(x: a, salt: Int): Int = x.hash() + salt",
      "",
      "export fun sum<a: Num>(x: a, y: a): a = x + y",
      "",
    ].join("\n"));
    const identity = (section: Emitted.GeneratedSection): string =>
      `${section.sourceName} ${section.generatedName} ${section.typeArguments.join("+")}`;

    // The two artefacts' rows are one plan read twice, so their counts and their
    // identities coincide; only `bytes` may differ, and it does, which is why
    // §10 asks for two sizes rather than their sum. Should the `.d.ts` sections
    // ever be rebuilt from a re-render rather than recorded at the push, this is
    // the row that catches an edition rendered into the file but not counted.
    expect(module.declarations.generatedSections.map(identity))
      .toEqual(module.javascript.generatedSections.map(identity));
    expect(module.declarations.generatedSections.length).toBe(11);
    for (const section of module.declarations.generatedSections) {
      const body = module.javascript.generatedSections.find(
        (candidate) => candidate.generatedName === section.generatedName,
      )!;
      expect(
        module.javascript.text.slice(body.startOffset, body.endOffset),
      ).toContain(`function ${section.generatedName}(`);
      expect(body.bytes).toBeGreaterThan(0);
    }
  });

  test("counts a face's bytes in UTF-8 rather than in code units", () => {
    // The one case where `bytes` and the offsets' arithmetic part company. A
    // §10 report is about what the file weighs on disk, and a `.d.ts` is written
    // UTF-8, so a multi-byte character in a rendered face has to count for more
    // than one — while `startOffset`/`endOffset` stay JavaScript indexes so
    // `text.slice` keeps working.
    const module = main([
      "export record Ångström = {picometres: Float}",
      "",
      "export fun scale<a: Num>(x: a, unit: Ångström): Float = unit.picometres",
      "",
    ].join("\n"));
    const [first] = module.declarations.generatedSections;

    expect(first).toBeDefined();
    const face = module.declarations.text.slice(first!.startOffset, first!.endOffset);
    // `Å` and `ö` are two bytes each and one code unit each; every other
    // character in the face is one of both.
    expect(face).toContain("Ångström");
    expect(first!.bytes).toBe(face.length + 2);
  });
});
