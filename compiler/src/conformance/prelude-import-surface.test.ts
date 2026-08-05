import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

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
 * and growing an `__hex_imported_N_` prefix at every hop. Non-prelude imports
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
      "export record Box = {map: (Int) -> Int}\n" +
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
      "export record Ruler = {length: (Int) -> Int}\n" +
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
    expect(importLines(emitted([["/main.hex", source]], "/main.hex"))).toEqual([
      'import { fromSeq, toSeq } from "./Vector.js";',
      'import { map } from "./Seq.js";',
    ]);
    const main = await runProject([["/main.hex", source]]);
    expect(main["out"]).toEqual([2, 4, 6]);
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
    const javascript = emitted([["/main.hex", source]], "/main.hex");
    // `Seq.js` comes first because the `r.length(4)` candidate registered its
    // `length` before anything named `Vector.hex` — one import item per
    // specifier, in the order the module first reached that member.
    expect(importLines(javascript)).toEqual([
      'import { map } from "./Seq.js";',
      'import { fromSeq, toSeq } from "./Vector.js";',
    ]);
    const main = await runProject([["/main.hex", source]]);
    expect(main["out"]).toEqual([10, 12]);
    const run = main["run"] as (r: { length: (n: number) => number }) => number;
    expect(run({ length: (n) => n + 1 })).toBe(5);
  });

  /**
   * The collision-cleared local (Modules §6.4). A module that binds `map` at top
   * level reaches the prelude's under `__hex_prelude_map`, and the filter has to
   * keep the *local*, not fall back to the imported name — falling back would
   * redeclare the module's own binding, a `SyntaxError` at load.
   *
   * Reached qualified here because that is the spelling this collision was first
   * observed through. A module-level `fun map` used to occlude companion dispatch
   * of `map` as well — the checker resolved a dot call through a flat by-name
   * table, which the local won — so the dispatch spelling could not reach a
   * renamed prelude local at all. #267 ended that: dispatch consults the
   * receiver's companion, so a `Seq` receiver reaches the prelude's `map` under
   * `__hex_prelude_map` whatever the module binds at top level. Both dispatch
   * flavours are below — the `extern` one here, the `fun` one in
   * `companion-dispatch.test.ts`.
   */
  test("a distinguished local survives the filter and runs", async () => {
    const source =
      "export fun map(x: Int): Int = x * 10\n" +
      "export let out: Vector(Int) =\n" +
      "    Vector.fromSeq(Seq.prepend(Seq.map(Vector.toSeq([7, 8]), x => x + 1), 0))\n";
    const javascript = emitted([["/main.hex", source]], "/main.hex");
    expect(importLines(javascript)).toEqual([
      'import { fromSeq, toSeq } from "./Vector.js";',
      'import { prepend, map as __hex_prelude_map } from "./Seq.js";',
    ]);
    const main = await runProject([["/main.hex", source]]);
    expect(main["out"]).toEqual([0, 8, 9]);
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
      'extern from "lib"\n' +
      "    fun map(x: Int): Int\n" +
      "export let out: Vector(Int) =\n" +
      "    Vector.fromSeq(Vector.toSeq([9]).map(x => x * 2))\n",
    ]], "/main.hex");
    expect(importLines(javascript)).toEqual([
      'import { fromSeq, toSeq } from "./Vector.js";',
      'import { map as __hex_prelude_map } from "./Seq.js";',
      'import { map } from "lib";',
    ]);
    expect(javascript).toContain("__hex_prelude_map(");
  });

  /**
   * A synthesized import with nothing left must emit nothing — never the
   * side-effect form `import "./Seq.js";`, which would be a load-order
   * dependency the source never wrote and would keep the module in the graph.
   */
  test("a fully filtered import does not degrade to a side-effect import", () => {
    const javascript = emitted([[
      "/a.hex",
      "export record Box = {map: (Int) -> Int, length: (Int) -> Int}\n" +
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
  test("a named import of a prelude module imports and re-exports no dictionary", () => {
    const javascript = emitted([[
      "/a.hex",
      'import { Some } from "./Option"\n' +
      "export fun mk(x: Int): Option(Int) = Some(x)\n",
    ]], "/a.hex");
    expect(importLines(javascript)).toEqual(['import { Some } from "./Option.js";']);
    expect(exportLines(javascript)).toEqual(["export { mk };"]);
  });

  /** A namespace import is the same import item and answers the same way. */
  test("a namespace import of a prelude module carries none either", () => {
    const javascript = emitted([[
      "/a.hex",
      'import * as Option from "./Option"\n' +
      "export fun mk(x: Int): Option(Int) = Option.Some(x)\n",
    ]], "/a.hex");
    expect(javascript).not.toContain("__hex_instance_");
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
      'import { Some } from "./Option"\n' +
      "export fun same(a: Option(Int), b: Option(Int)): Bool = a == b\n" +
      "export fun mk(x: Int): Option(Int) = Some(x + 20)\n";
    const javascript = emitted([["/main.hex", source]], "/main.hex");
    expect(importLines(javascript)).toEqual([
      'import { __hex_instance_Eq_Option as __hex_imported_3___hex_instance_Eq_Option } from "./Option.js";',
      'import { Some } from "./Option.js";',
    ]);
    expect(exportLines(javascript)).toEqual(["export { same };", "export { mk };"]);

    const main = await runProject([["/main.hex", source]]);
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
      "export let out: Vector(Int) =\n" +
      "    Vector.fromSeq(Seq.take(Seq.iterate(30, x => x + 1), 3))\n",
    ]]);
    expect(main["out"]).toEqual([30, 31, 32]);
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
      compileFiles([["/main.hex", source]]).diagnostics.map(({ message }) => message);
    expect(messages(`import { True } from "./Bool"\n${orphan}`)).toEqual([
      "orphan instance: this module declares neither `Eq` nor the instance subject",
    ]);
    expect(messages(orphan)).toEqual([
      "orphan instance: this module declares neither `Eq` nor the instance subject",
    ]);
    // `Ordering` is on the channel, so its orphan still collides — the asymmetry
    // is `Bool`'s filter, not the explicit import.
    expect(messages('import { Less } from "./Prelude"\nhonor Eq<Ordering> =\n    equals(a, b) = True\n'))
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
        "export record Box = {v: Int}\n" +
        "honor Show<Box> =\n" +
        '    show(b) = "box"\n'],
      ["/b.hex",
        'import { Box } from "./a"\n' +
        "export fun mk(v: Int): Box = Box({v = v})\n"],
      ["/c.hex",
        'import { mk } from "./b"\n' +
        'export fun s(v: Int): String = "${mk(v)}"\n'],
    ] as const;
    const b = emitted(files, "/b.hex");
    expect(importLines(b)).toEqual([
      'import { Box } from "./a.js";',
      'import { __hex_instance_Show_Box as __hex_imported_0___hex_instance_Show_Box } from "./a.js";',
    ]);
    expect(exportLines(b)).toEqual([
      "export { __hex_imported_0___hex_instance_Show_Box };",
      "export { mk };",
    ]);
    expect(emitted(files, "/c.hex")).toContain(
      "__hex_imported_1___hex_imported_0___hex_instance_Show_Box",
    );

    const main = await runProject([
      ...files.slice(0, 2),
      ["/main.hex",
        'import { mk } from "./b"\n' +
        'export fun t(v: Int): String = "<${mk(v)}>"\n'],
    ] as const);
    expect((main["t"] as (v: number) => string)(1)).toBe("<box>");
  });
});
