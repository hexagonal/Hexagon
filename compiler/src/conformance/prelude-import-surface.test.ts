import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * A crossed `Vector(a)` as a plain array.
 *
 * Readouts that land in a `Vector` go through this since the trie wiring: a
 * `Vector(a)` is a `TrieVector` record, not a JavaScript array. The subject of
 * these tests is unchanged; spreading is what the `Hex.Vector<a> extends
 * Iterable<a>` face promises a consumer can do, so the readout is now also a
 * live check of that contract.
 */
function elements(value: unknown): unknown[] {
  return [...(value as Iterable<unknown>)];
}

/**
 * The trie runtime's import line, as a module holding a vector *literal* spells
 * it: the literal builder needs the shared empty and `append`, and nothing else.
 *
 * It appears in the expectations below because these pin the whole emitted
 * import surface, and the trie is a channel of it — the fourth, after the two
 * prelude ones and the `.d.ts` type one. It is a *runtime* module rather than a
 * prelude one, so it is never subject to the name filtering these tests are
 * about; it is here so that the filtering is asserted against the real list
 * rather than against a convenient subset of it.
 */
const VECTOR_LITERAL_IMPORT =
  'import { empty as __trieEmpty, append as __trieAppend } from "./Hex/VectorTrie.js";';

/**
 * Conformance for what a module's synthesized and explicit prelude imports put
 * on its public ESM surface (#263).
 *
 * Two independent mechanisms, both of which stop a module paying for a name it
 * does not use.
 *
 * **The synthesized import is filtered at emission.**
 * `#noteCompanionCandidate` registers a prelude term for every `x.f(y)` whose
 * field name the prelude exports, because whether that is companion dispatch or
 * a call of a function-valued field depends on the receiver's *type* and the
 * checker decides that long after the import is built. The registration is
 * sound and stays; what changes is that it is *availability* only. Emission
 * renders the synthesized item from the names the elaborated Core references, so
 * `record Box = {map: (Int) -> Int}` no longer imports `Seq.map`, no longer
 * drags `Seq.hex` — and `Bool.hex` behind it — into the emitted graph, and no
 * longer re-exports what rode along.
 *
 * **An explicit import of a prelude module carries no instance evidence.**
 * Since #153 every module reaches prelude instances directly through
 * `Module.preludeInstances`, so a copy on an import item is a second identity
 * for the same instance: predicted by consumers, re-exported by intermediates,
 * and growing a per-file alias prefix at every hop. Non-prelude imports
 * are untouched — an ordinary module's `honor` is reachable three hops away
 * *only* through the intermediates, so that transit is load-bearing.
 *
 * Several tests execute the emitted graph rather than reading it. Both
 * mechanisms have the same silent failure mode if they over-reach: a name the
 * body spells and no import binds is a `ReferenceError` at load, on a project
 * that compiled clean.
 */

function project(files: readonly (readonly [string, string])[]) {
  const compiled = compileFiles(files);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  return compiled;
}

function emitted(
  files: readonly (readonly [string, string])[],
  path: string,
): string {
  const module = project(files).modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`no emitted module at ${path}`);
  return module.javascript.text;
}

/** Every module the project chose to emit, which is what reachability decides. */
function emittedPaths(files: readonly (readonly [string, string])[]): readonly string[] {
  return project(files).modules.map(({ source }) => source.path);
}

function importLines(javascript: string): readonly string[] {
  return javascript.split("\n").filter((line) => line.startsWith("import "));
}

function exportLines(javascript: string): readonly string[] {
  return javascript.split("\n").filter((line) => line.startsWith("export {"));
}

describe("the synthesized prelude import is what Core references", () => {
  /**
   * #263's reproduction. `b.map` is a record field of function type; the checker
   * knows it is not a dispatch, and now emission does too.
   */
  test("a function-valued record field imports nothing", () => {
    const files = [[
      "/a.hex",
      "module A\n\n" + "export record Box = {map: (Int) -> Int}\n" +
      "export fun run(b: Box): Int = b.map(3)\n",
    ]] as const;
    const javascript = emitted(files, "/a.hex");
    expect(importLines(javascript)).toEqual([]);
    expect(exportLines(javascript)).toEqual(["export { Box };", "export { run };"]);
    // Reachability, not just this file's text: a dead import kept `Seq.hex` and
    // `Bool.hex` in the emitted graph of every module with such a field.
    expect(emittedPaths(files)).toEqual(["/a.hex"]);
  });

  /** `length` is the same shape and the likelier field name (Collections Part 1 §3.1). */
  test("a field named `length` imports nothing either", () => {
    const files = [[
      "/a.hex",
      "module A\n\n" + "export record Ruler = {length: (Int) -> Int}\n" +
      "export fun run(r: Ruler): Int = r.length(2)\n",
    ]] as const;
    expect(importLines(emitted(files, "/a.hex"))).toEqual([]);
    expect(emittedPaths(files)).toEqual(["/a.hex"]);
  });

  /**
   * The direction the filter must never take. A genuine dispatch is a reference
   * in Core, so its name survives — and this executes, because an emitted body
   * spelling a name no import binds is a `ReferenceError` at load on a project
   * that compiled clean.
   */
  test("a genuine companion dispatch keeps its import and runs", async () => {
    const source =
      "export let out: Vector(Int) =\n" +
      "    Vector.fromSeq(Vector.toSeq([1, 2, 3]).map(x => x * 2))\n";
    // No `Iterable.js` line since #444: `Vector.toSeq(...)` is a source-written
    // member call at a concrete head, and `Iterable<Vector(a)>` is a provided
    // row whose evidence is compiler-built, so the call reads the member off
    // Dictionary Sharing §3.4's hoisted binding rather than importing the
    // forwarder (Constraints §6.1's third arm).
    expect(importLines(emitted([["/main.hex", "module Main\n\n" + source]], "/main.hex"))).toEqual([
      'import { fromSeq } from "./Hex/Vector.js";',
      'import { map } from "./Hex/Seq.js";',
      VECTOR_LITERAL_IMPORT,
    ]);
    const main = await runProject([["/main.hex", "module Main\n\n" + source]]);
    expect(elements(main["out"])).toEqual([2, 4, 6]);
  });

  /**
   * Both shapes in one module, which is where a filter keyed on anything coarser
   * than the individual name would fail: `Seq.map` is referenced and `Seq.length`
   * is not, from the same specifier. `Vector.hex` exports a `length` too, and it
   * is filtered out by the same name-level test.
   */
  test("a false candidate and a real dispatch in one module", async () => {
    const source =
      "export record Ruler = {length: (Int) -> Int}\n" +
      "export fun run(r: Ruler): Int = r.length(4)\n" +
      "export let out: Vector(Int) =\n" +
      "    Vector.fromSeq(Vector.toSeq([5, 6]).map(x => x * 2))\n";
    const javascript = emitted([["/main.hex", "module Main\n\n" + source]], "/main.hex");
    // `Seq.js` comes first because the `r.length(4)` candidate registered its
    // `length` before anything named `Vector.hex` — one import item per
    // specifier, in the order the module first reached that member.
    expect(importLines(javascript)).toEqual([
      'import { map } from "./Hex/Seq.js";',
      'import { fromSeq } from "./Hex/Vector.js";',
      VECTOR_LITERAL_IMPORT,
    ]);
    const main = await runProject([["/main.hex", "module Main\n\n" + source]]);
    expect(elements(main["out"])).toEqual([10, 12]);
    const run = main["run"] as (r: { length: (n: number) => number }) => number;
    expect(run({ length: (n) => n + 1 })).toBe(5);
  });

  /**
   * The collision-cleared local (Modules §6.4). A module that binds `map` at top
   * level reaches the prelude's under `__prelude_map`, and the filter has to
   * keep the *local*, not fall back to the imported name — falling back would
   * redeclare the module's own binding, a `SyntaxError` at load.
   *
   * Reached qualified here because that is the spelling this collision was first
   * observed through. A module-level `fun map` used to occlude companion dispatch
   * of `map` as well — the checker resolved a dot call through a flat by-name
   * table, which the local won — so the dispatch spelling could not reach a
   * renamed prelude local at all. #267 ended that: dispatch consults the
   * receiver's companion, so a `Seq` receiver reaches the prelude's `map` under
   * `__prelude_map` whatever the module binds at top level. Both dispatch
   * flavours are below — the `extern` one here, the `fun` one in
   * `companion-dispatch.test.ts`.
   */
  test("a distinguished local survives the filter and runs", async () => {
    const source =
      "export fun map(x: Int): Int = x * 10\n" +
      "export let out: Vector(Int) =\n" +
      "    Vector.fromSeq(Seq.prepend(Seq.map(Vector.toSeq([7, 8]), x => x + 1), 0))\n";
    const javascript = emitted([["/main.hex", "module Main\n\n" + source]], "/main.hex");
    expect(importLines(javascript)).toEqual([
      'import { fromSeq } from "./Hex/Vector.js";',
      'import { prepend, map as __prelude_map } from "./Hex/Seq.js";',
      VECTOR_LITERAL_IMPORT,
    ]);
    const main = await runProject([["/main.hex", "module Main\n\n" + source]]);
    expect(elements(main["out"])).toEqual([0, 8, 9]);
    expect((main["map"] as (x: number) => number)(3)).toBe(30);
  });

  /**
   * The dispatch flavour of the same collision: an `extern` binding takes the
   * top-level name, so `.map` is spelled by the distinguished local. The
   * `extern` is load-bearing for a second reason since #267 — an ordinary
   * foreign binding is symbol kind `extern`, not `fun`, which is what keeps it
   * out of §4.2's candidate set even before the home-module filter is asked.
   * Compiled, not run — the foreign module is not linkable here.
   */
  test("a dispatch through a distinguished local keeps the local", () => {
    const javascript = emitted([[
      "/main.hex",
      "module Main\n\n" + 'extern from "lib"\n' +
      "    fun map(x: Int): Int\n" +
      "export let out: Vector(Int) =\n" +
      "    Vector.fromSeq(Vector.toSeq([9]).map(x => x * 2))\n",
    ]], "/main.hex");
    expect(importLines(javascript)).toEqual([
      'import { fromSeq } from "./Hex/Vector.js";',
      'import { map as __prelude_map } from "./Hex/Seq.js";',
      VECTOR_LITERAL_IMPORT,
      'import { map } from "lib";',
    ]);
    expect(javascript).toContain("__prelude_map(");
  });

  /**
   * A synthesized import with nothing left must emit nothing — never the
   * side-effect form `import "./Seq.js";`, which would be a load-order
   * dependency the source never wrote and would keep the module in the graph.
   */
  test("a fully filtered import does not degrade to a side-effect import", () => {
    const javascript = emitted([[
      "/a.hex",
      "module A\n\n" + "export record Box = {map: (Int) -> Int, length: (Int) -> Int}\n" +
      "export fun run(b: Box): Int = b.map(b.length(1))\n",
    ]], "/a.hex");
    expect(javascript).not.toContain("Seq.js");
    expect(javascript).not.toContain("import");
  });
});

describe("an explicit import of a prelude module carries no evidence", () => {
  /**
   * The amplifier. The instances used to ride the import item, be re-exported by
   * `#exportEvidence`, and grow a prefix at every downstream hop — all for a copy
   * no consumer reads, because every module reaches `Option`'s instances
   * directly.
   */
  test("a module import of a prelude module imports and re-exports no dictionary", () => {
    const javascript = emitted([[
      "/a.hex",
      "module A\n\n" + 'import Option\n' +
      "export fun mk(x: Int): Option(Int) = Option.Some(x)\n",
    ]], "/a.hex");
    // One line, the namespace import the module alias itself always carries.
    // `Option.Some(x)` is an application, so since #770 it erases into its
    // object literal and names the constructor nowhere — the named import that
    // used to bind `Some` has nothing left to bind. Neither line is a
    // dictionary: that is the property this test is about.
    expect(importLines(javascript)).toEqual([
      'import * as Option from "./Hex/Option.js";',
    ]);
    expect(javascript).toContain('return { tag: "Some", value: x };');
    expect(exportLines(javascript)).toEqual(["export { mk };"]);
  });

  /** A namespace import is the same import item and answers the same way. */
  test("a namespace import of a prelude module carries none either", () => {
    const javascript = emitted([[
      "/a.hex",
      "module A\n\n" + 'import Option\n' +
      "export fun mk(x: Int): Option(Int) = Option.Some(x)\n",
    ]], "/a.hex");
    expect(javascript).not.toContain("__");
  });

  /**
   * The case the two channels could collide on. A module that *uses* an
   * `Option` instance and also imports `Option` explicitly must bind the
   * dictionary exactly once: both channels build the local from the same file id
   * and the same dictionary, so two bindings would be character-for-character
   * equal and `SyntaxError: Identifier has already been declared` at load. This
   * executes rather than reading the text for that reason.
   */
  test("a used instance beside an explicit import binds one dictionary", async () => {
    const source =
      'import Option\n' +
      "export fun same(a: Option(Int), b: Option(Int)): Bool = a == b\n" +
      "export fun mk(x: Int): Option(Int) = Option.Some(x + 20)\n";
    const javascript = emitted([["/main.hex", "module Main\n\n" + source]], "/main.hex");
    // The `Eq<Int>` line is the *component* instance `Eq<Option(Int)>` selects
    // (#278), and it is an import since #344 because `Int`'s instances are
    // `stdlib/Int.hex`'s source. The point of the case is the `Option.js` pair:
    // one dictionary binding, not two.
    expect(importLines(javascript)).toEqual([
      'import { __Eq_Option } from "./Hex/Option.js";',
      'import { __Eq_Int } from "./Hex/Int.js";',
      'import * as Option from "./Hex/Option.js";',
    ]);
    expect(exportLines(javascript)).toEqual(["export { same };", "export { mk };"]);

    const main = await runProject([["/main.hex", "module Main\n\n" + source]]);
    const same = main["same"] as (a: unknown, b: unknown) => boolean;
    const mk = main["mk"] as (x: number) => unknown;
    expect(same(mk(1), mk(1))).toBe(true);
    expect(same(mk(1), mk(2))).toBe(false);
  });

  /**
   * The prelude's own members import each other explicitly (`Seq.hex` imports
   * `Option`), so the rule applies inside the prelude too — a member's visible
   * prelude is the members declared before it. Reached through a real dispatch so
   * the emitted `Seq.js` is linked and run.
   */
  test("the prelude's own explicit imports still link and run", async () => {
    const main = await runProject([[
      "/main.hex",
      "module Main\n\n" + "export let out: Vector(Int) =\n" +
      "    Vector.fromSeq(Seq.take(Seq.iterate(30, x => x + 1), 3))\n",
    ]]);
    expect(elements(main["out"])).toEqual([30, 31, 32]);
  });

  /**
   * A behaviour change worth stating rather than discovering. `Bool`'s four
   * instances are deliberately absent from the availability channel — the #147
   * pin answers a `Bool` requirement structurally, so a universe holding no
   * `Bool` instance is the truthful one — and an explicit `import … from
   * "./Bool"` used to smuggle them back in. It no longer does, so an orphan
   * `honor Eq<Bool>` reports only the orphan error whatever the import list
   * says, matching the module that does not import `Bool` at all. Both messages
   * are errors, so no program changes status.
   */
  test("an orphan `honor Eq<Bool>` reports the same with or without the import", () => {
    const orphan = "honor Eq<Bool> =\n    equals(a, b) = True\n";
    const messages = (source: string): readonly string[] =>
      compileFiles([["/main.hex", "module Main\n\n" + source]]).diagnostics.map(({ message }) => message);
    expect(messages(`import Bool\n${orphan}`)).toEqual([
      "orphan instance: this module declares neither `Eq` nor the instance subject",
    ]);
    expect(messages(orphan)).toEqual([
      "orphan instance: this module declares neither `Eq` nor the instance subject",
    ]);
    // `Ordering` is on the channel, so its orphan still collides — the asymmetry
    // is `Bool`'s filter, not the explicit import.
    expect(messages('import Ordering\nhonor Eq<Ordering> =\n    equals(a, b) = True\n'))
      .toEqual([
        "orphan instance: this module declares neither `Eq` nor the instance subject",
        "duplicate instance of `Eq<Ordering>`",
      ]);
  });
});

describe("non-prelude instance evidence still transits", () => {
  /**
   * The case the narrowing must not touch. `A` declares its own `honor`, `C` is
   * two hops away and reaches it only through `B`; coherence makes the instance
   * global once `A` is in the graph, and there is no direct channel for it.
   * Executed, because a dropped transit is a `ReferenceError` at load.
   */
  test("A honors, B relays, C uses", async () => {
    const files = [
      ["/a.hex",
        "module A\n\n" + "export record Box = {v: Int}\n" +
        "honor Show<Box> =\n" +
        '    show(b) = "box"\n'],
      ["/b.hex",
        "module B\n\n" +
        // The alias's own spelling equals the exported record's, so `Box` is
        // reached bare through rule 3's companion fallback (Modules §3.2,
        // #762) — nothing binds it, so there is nothing new for the
        // collision rule to find.
        'import A as Box\n' +
        "export fun mk(v: Int): Box = Box({v = v})\n"],
      ["/c.hex",
        "module C\n\n" + 'import B\n' +
        'export fun s(v: Int): String = "${B.mk(v)}"\n'],
    ] as const;
    const b = emitted(files, "/b.hex");
    expect(importLines(b)).toEqual([
      'import * as Box from "./A.js";',
      'import { __Show_Box } from "./A.js";',
    ]);
    expect(exportLines(b)).toEqual([
      "export { __Show_Box };",
      "export { mk };",
    ]);
    // The hop that used to compound. `c.hex` reaches the dictionary through
    // `b.hex`, and binds it under the same interface name `a.hex` published —
    // where the per-file alias prefix used to wrap `b.hex`'s already-prefixed
    // local in a second prefix (#425).
    expect(importLines(emitted(files, "/c.hex"))).toContain(
      'import { __Show_Box } from "./B.js";',
    );

    const main = await runProject([
      ...files.slice(0, 2),
      ["/main.hex",
        "module Main\n\n" + 'import B\n' +
        'export fun t(v: Int): String = "<${B.mk(v)}>"\n'],
    ] as const);
    expect((main["t"] as (v: number) => string)(1)).toBe("<box>");
  });
});
