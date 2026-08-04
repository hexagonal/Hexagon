import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for what a module's prelude imports put on its public ESM surface
 * (#263).
 *
 * **An explicit import of a prelude module carries no instance evidence.**
 * Since #153 every module reaches prelude instances directly through
 * `Module.preludeInstances`, so a copy on an import item is a second identity
 * for the same instance: predicted by consumers, re-exported by intermediates,
 * and growing an `__hex_imported_N_` prefix at every hop. Non-prelude imports
 * are untouched — an ordinary module's `honor` is reachable three hops away
 * *only* through the intermediates, so that transit is load-bearing.
 *
 * Several tests execute the emitted graph rather than reading it: a name the
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

function importLines(javascript: string): readonly string[] {
  return javascript.split("\n").filter((line) => line.startsWith("import "));
}

function exportLines(javascript: string): readonly string[] {
  return javascript.split("\n").filter((line) => line.startsWith("export {"));
}

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
