import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for prelude instance **availability** (#153).
 *
 * Modules §5.5 puts every prelude module implicitly in scope everywhere. Instance
 * availability used not to follow: the checker's evidence universe was this
 * module's `Honor` items plus the `instances` on its `Import` items, and the
 * prelude's copies rode the *synthesized* prelude import — which only an
 * expression-position reference to a prelude **term** synthesizes. So a module
 * that named only prelude *types* had no evidence, and
 *
 * ```
 * export fun f(a: Ordering, b: Ordering): Bool = a == b
 * ```
 *
 * reported `type \`Ordering\` has no \`Eq\` instance` for an instance that is
 * unconditionally in scope. The blast radius was `Eq`/`Show` of `Ordering` and
 * of `Option`: `Bool`'s four are satisfied structurally by the #147 pin, and
 * nothing else in the v1 prelude declares an instance.
 *
 * The fix splits the two questions that had been one. **Availability** is
 * `Resolved.Module.preludeInstances`, computed once per module from the visible
 * prelude interfaces and seeded into the checker before any import item.
 * **Emission** is derived afterwards, from the dictionaries the elaborated Core
 * actually names. Neither is inferred from the other.
 *
 * Three properties the old design had that this deliberately drops, each pinned
 * below because each is a way the defect could come back:
 *
 * 1. Evidence no longer transits intermediate modules. `a.hex` used to re-export
 *    `Option`'s dictionaries merely for having mentioned `Some`, and a consumer
 *    reached them through `./a.js`. That transit is what made the defect
 *    *intermittently* invisible — it cured `b.hex` by accident — so leaving it in
 *    place would leave the defect's mask in place.
 * 2. Consumers import from the module that **declares** the dictionary, so a
 *    two-hop chain reaches the declaring module directly, and a diamond no
 *    longer imports one dictionary twice.
 * 3. The prelude channel never re-exports. Reaching prelude evidence never
 *    requires asking an intermediate for it.
 *
 * Several tests **execute** the emitted graph. The defect had a diagnostic, but
 * its fix has a silent failure mode of its own: a prelude module is emitted only
 * when something emitted imports it, and this channel's imports are decided
 * during emission rather than declared as import items. Get that wrong and the
 * project compiles clean while emitting `import … from "./Prelude.js"` beside no
 * `Prelude.js` — defect 8, invisible to a diagnostics-only test. `danglingImports`
 * and the executing tests are both there for that.
 */

function diagnostics(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

function emitted(
  files: readonly (readonly [string, string])[],
  path: string,
): string {
  const project = compileFiles(files);
  const module = project.modules.find(({ source }) => source.path === path);
  if (module === undefined) {
    throw new Error(
      `no emitted module at ${path}; emitted: ${
        project.modules.map(({ source }) => source.path).join(", ")
      }`,
    );
  }
  return module.javascript.text;
}

/**
 * Relative imports in the emitted JavaScript naming a module the project did not
 * emit — defect 8's general form. Empty is the only acceptable value.
 */
function danglingImports(
  files: readonly (readonly [string, string])[],
): readonly string[] {
  const project = compileFiles(files);
  const paths = new Set(project.modules.map(({ source }) => source.path));
  const dangling: string[] = [];
  for (const module of project.modules) {
    for (const match of module.javascript.text.matchAll(/from\s+"(\.[^"]+)"/gu)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const target = `${specifier.replace(/\.js$/u, "")}.hex`.replace(/^\.\//u, "/");
      if (!paths.has(target)) dangling.push(`${module.source.path} -> ${specifier}`);
    }
  }
  return dangling;
}

/** Import lines only — the shape assertions are about the module graph, not bodies. */
function importLines(javascript: string): readonly string[] {
  return javascript.split("\n").filter((line) => line.startsWith("import "));
}

/** Re-export lines only. */
function exportLines(javascript: string): readonly string[] {
  return javascript.split("\n").filter((line) => line.startsWith("export {"));
}

describe("a type-only prelude mention has its instances", () => {
  /**
   * The filed defect, and the one test that runs the program. Compiling clean is
   * only half the claim: the dictionary has to be the *real* one, imported from
   * a module that was actually emitted, and reached at run time.
   */
  test("`Ordering` equality compiles, links, and computes", async () => {
    const source = "export fun f(a: Ordering, b: Ordering): Bool = a == b\n";
    expect(diagnostics([["/main.hex", source]])).toEqual([]);

    const javascript = emitted([["/main.hex", source]], "/main.hex");
    // Imported from `Prelude.js`, which declares it — not from an intermediate,
    // and not re-exported onward.
    expect(importLines(javascript)).toEqual([
      'import { __Eq_Ordering } from "./Prelude.js";',
    ]);
    expect(exportLines(javascript)).toEqual(["export { f };"]);
    expect(danglingImports([["/main.hex", source]])).toEqual([]);

    const main = await runProject([[
      "/main.hex",
      // `l`/`g` distinguish this module's emitted text from every sibling test's.
      // Two tests whose emitted JavaScript is byte-identical share one module
      // instance through the data-URL import cache.
      "export fun l(a: Ordering, b: Ordering): Bool = a == b\n",
    ]]);
    const l = main["l"] as (a: string, b: string) => boolean;
    expect(l("Less", "Less")).toBe(true);
    expect(l("Less", "Greater")).toBe(false);
  });

  test("`Option` equality compiles and computes", async () => {
    const source = "export fun f(a: Option(Int), b: Option(Int)): Bool = a == b\n";
    expect(diagnostics([["/main.hex", source]])).toEqual([]);
    expect(importLines(emitted([["/main.hex", source]], "/main.hex"))).toEqual([
      'import { __Eq_Option } from "./Option.js";',
      // The component instance `Eq<Option(Int)>` selects (#278), an import
      // since #344 because `Int`'s instances are `stdlib/Int.hex`'s source.
      'import { __Eq_Int } from "./Int.js";',
    ]);
    expect(danglingImports([["/main.hex", source]])).toEqual([]);

    // `mk` is here only so the test can build `Option` values without hard-coding
    // their runtime representation; the type-only claim is the assertions above,
    // which run against a module that names no `Option` term at all.
    const main = await runProject([[
      "/main.hex",
      "export fun o(a: Option(Int), b: Option(Int)): Bool = a == b\n" +
      "export fun mk(x: Int): Option(Int) = Some(x)\n",
    ]]);
    const o = main["o"] as (a: unknown, b: unknown) => boolean;
    const mk = main["mk"] as (x: number) => unknown;
    expect(o(mk(1), mk(1))).toBe(true);
    expect(o(mk(1), mk(2))).toBe(false);
  });

  /**
   * Interpolation is the second demanding surface, and it demands `Show` rather
   * than `Eq` — so it proves the channel carries a whole prelude interface and
   * not just whatever `==` happens to need.
   */
  test("interpolating an `Ordering` has `Show`", () => {
    const source = 'export fun f(a: Ordering): String = "v: ${a}"\n';
    expect(diagnostics([["/main.hex", source]])).toEqual([]);
    expect(importLines(emitted([["/main.hex", source]], "/main.hex"))).toEqual([
      'import { __Show_Ordering } from "./Prelude.js";',
    ]);
  });

  /**
   * Pattern-position constructor use does not synthesize a prelude import — the
   * arms compile to tag strings, so nothing is imported and nothing needs to be.
   * That was correct for emission and fatal for evidence: a module could `match`
   * on `Ordering` all day and still not be allowed to compare two.
   */
  test("matching on a constructor and comparing in one module", () => {
    expect(diagnostics([[
      "/main.hex",
      "export fun g(a: Ordering): Int =\n" +
      "    match a\n" +
      "        Less => 0\n" +
      "        _ => 1\n" +
      "export fun f(a: Ordering, b: Ordering): Bool = a == b\n",
    ]])).toEqual([]);
  });

  /**
   * The `Bool` pin must keep winning structurally (#147). This is the case the
   * reverted type-triggered fix broke, and the reason the channel filters `Bool`
   * out rather than seeding four instances that would compete with the
   * structural answer.
   */
  test("type-only `Bool` equality still emits inline structural code", () => {
    const javascript = emitted(
      [["/main.hex", "export fun f(a: Bool, b: Bool): Bool = a == b\n"]],
      "/main.hex",
    );
    expect(importLines(javascript)).toEqual([]);
    expect(javascript).toContain("return a === b;");
    expect(javascript).not.toContain("__Eq_Bool");
  });
});

describe("transit shapes keep working and shrink", () => {
  const A = ["/a.hex", "export fun mk(x: Int): Option(Int) = Some(x)\n"] as const;

  /**
   * `b` names no `Option` term, so before the fix it had no prelude import of
   * its own and compiled *only* because `a`'s interface transited `Eq<Option>`.
   * It must still compile — and now for the right reason, reaching `Option.js`
   * directly while `a` stops carrying evidence it never used.
   */
  test("a named import still sees `Eq<Option>`, now from `Option.js`", async () => {
    const files = [
      A,
      ["/b.hex", 'import { mk } from "./a"\nexport fun g(x: Int): Bool = mk(x) == mk(x)\n'],
    ] as const;
    expect(diagnostics(files)).toEqual([]);
    expect(danglingImports(files)).toEqual([]);

    const b = emitted(files, "/b.hex");
    expect(importLines(b)).toEqual([
      'import { __Eq_Option } from "./Option.js";',
      // The component instance `Eq<Option(Int)>` selects (#278), an import
      // since #344 because `Int`'s instances are `stdlib/Int.hex`'s source.
      'import { __Eq_Int } from "./Int.js";',
      'import { mk } from "./a.js";',
    ]);
    // The point of the fix: no evidence re-export anywhere on the path.
    expect(exportLines(b)).toEqual(["export { g };"]);

    const a = emitted(files, "/a.hex");
    expect(importLines(a)).toEqual(['import { Some } from "./Option.js";']);
    expect(exportLines(a)).toEqual(["export { mk };"]);

    const main = await runProject([
      A,
      ["/b.hex", 'import { mk } from "./a"\nexport fun t(x: Int): Bool = mk(x) == mk(x)\n'],
    ], { entry: "/b.hex" });
    expect((main["t"] as (x: number) => boolean)(7)).toBe(true);
  });

  /** A bare effect import cured the defect before; it must not be needed now. */
  test("an effect import needs no evidence from the module it loads", () => {
    const files = [
      A,
      ["/b.hex", 'import "./a"\nexport fun g(a: Option(Int), b: Option(Int)): Bool = a == b\n'],
    ] as const;
    expect(diagnostics(files)).toEqual([]);
    expect(importLines(emitted(files, "/b.hex"))).toEqual([
      'import { __Eq_Option } from "./Option.js";',
      // The component instance `Eq<Option(Int)>` selects (#278), an import
      // since #344 because `Int`'s instances are `stdlib/Int.hex`'s source.
      'import { __Eq_Int } from "./Int.js";',
      'import "./a.js";',
    ]);
    expect(exportLines(emitted(files, "/a.hex"))).toEqual(["export { mk };"]);
  });

  /**
   * Two hops. The old chain re-exported through every intermediate and named the
   * dictionary through every intermediate; `c` now
   * imports the declaring module directly and `b` carries nothing.
   */
  test("a two-hop chain reaches the declaring module in one hop", () => {
    const files = [
      A,
      ["/b.hex", 'import { mk } from "./a"\nexport fun h(x: Int): Option(Int) = mk(x)\n'],
      ["/c.hex", 'import { h } from "./b"\nexport fun g(x: Int): Bool = h(x) == h(x)\n'],
    ] as const;
    expect(diagnostics(files)).toEqual([]);
    expect(importLines(emitted(files, "/c.hex"))).toEqual([
      'import { __Eq_Option } from "./Option.js";',
      // The component instance `Eq<Option(Int)>` selects (#278), an import
      // since #344 because `Int`'s instances are `stdlib/Int.hex`'s source.
      'import { __Eq_Int } from "./Int.js";',
      'import { h } from "./b.js";',
    ]);
    expect(exportLines(emitted(files, "/b.hex"))).toEqual(["export { h };"]);
  });

  /**
   * #263's false-positive companion candidate. The field access `b.map` — not a
   * dispatch — synthesizes an import of `Seq.js`, whose interface used to transit
   * `Eq<Option>`; that accident is what made this defect look like an
   * `Ordering`-shaped curiosity rather than a general one. No instance may ride
   * that import, and since #263 the import itself is gone too: emission renders
   * a synthesized item from the names Core references, and Core references no
   * `Seq.map` here.
   */
  test("a false companion candidate no longer smuggles evidence", () => {
    const files = [[
      "/main.hex",
      "export record Box = {map: (Int) -> Int}\n" +
      "export fun run(b: Box): Int = b.map(3)\n" +
      "export fun eq(x: Option(Int), y: Option(Int)): Bool = x == y\n",
    ]] as const;
    expect(diagnostics(files)).toEqual([]);
    const javascript = emitted(files, "/main.hex");
    expect(importLines(javascript)).toEqual([
      'import { __Eq_Option } from "./Option.js";',
      // The component instance `Eq<Option(Int)>` selects (#278), an import
      // since #344 because `Int`'s instances are `stdlib/Int.hex`'s source.
      'import { __Eq_Int } from "./Int.js";',
    ]);
    expect(javascript).not.toContain("Seq.js");
    expect(exportLines(javascript)).toEqual([
      "export { Box };",
      "export { run };",
      "export { eq };",
    ]);
  });
});

describe("an explicit import of a prelude module coexists with the channel", () => {
  /**
   * Exactly one statement may bind the dictionary. Both sides build the local
   * from the same file id and the same dictionary, so two bindings would be
   * character-for-character equal and `SyntaxError: Identifier has already been
   * declared` at load, on a project that compiled clean — which is why this
   * executes rather than reading the text. Since #263 the channel is the one
   * that binds it: an explicit import of a prelude module carries no evidence at
   * all, so there is nothing for it to own.
   */
  test("no duplicate binding when the prelude module is imported explicitly", async () => {
    const source =
      'import { Less } from "./Prelude"\n' +
      "export fun f(a: Ordering, b: Ordering): Bool = a == b\n" +
      "export let first: Ordering = Less\n";
    expect(diagnostics([["/main.hex", source]])).toEqual([]);

    const javascript = emitted([["/main.hex", source]], "/main.hex");
    // Unaliased since #425: the spelling is uncontested here, so the consumer
    // binds the exporter's interface name as it stands.
    const binding = importLines(javascript).filter((line) =>
      line.includes("__Eq_Ordering")
    );
    expect(binding).toEqual([
      'import { __Eq_Ordering } from "./Prelude.js";',
    ]);
    // And nothing re-exports it: the channel never calls `#exportEvidence`, and
    // the import item has no evidence to export (#263).
    expect(exportLines(javascript)).toEqual(["export { f };", "export { first };"]);

    const main = await runProject([["/main.hex", source]]);
    expect((main["f"] as (a: string, b: string) => boolean)("Less", "Less")).toBe(true);
    expect(main["first"]).toBe("Less");
  });

  /**
   * There is no second copy of a prelude instance to rank any more, which is the
   * point: `a` imports `./Option` explicitly and still carries no `Eq<Option>`
   * (#263), so `b` meets the identity once, from the module that declares it.
   *
   * Before #263 it met the identity twice — once from the channel and once
   * through `./a.js` — and which one survived was decided
   * purely by the channel being seeded first. Both halves are asserted because
   * either mechanism failing brings the transit copy back.
   */
  test("a prelude instance reaches a consumer by one name only", () => {
    const files = [
      ["/a.hex", 'import { Some } from "./Option"\nexport fun mk(x: Int): Option(Int) = Some(x)\n'],
      ["/b.hex", 'import { mk } from "./a"\nexport fun g(x: Int): Bool = mk(x) == mk(x)\n'],
    ] as const;
    expect(diagnostics(files)).toEqual([]);
    expect(exportLines(emitted(files, "/a.hex"))).toEqual(["export { mk };"]);
    const b = emitted(files, "/b.hex");
    expect(b).toContain(
      "return __Eq_Option(",
    );
    // One arrival, so the name is bare. A second copy of the identity would be a
    // second contestant for the spelling, and §5's collision rule would suffix
    // *both* — so a suffixed spelling anywhere here is the transit copy coming
    // back, under the naming this arc replaced the prefix with (#425).
    expect(b).not.toMatch(/__Eq_Option_\d/u);
    expect(
      b.split("\n").filter((line) => line.includes("__Eq_Option")),
    ).toHaveLength(2);
  });
});

describe("seeding is universal, so coherence reports are too", () => {
  /**
   * A behaviour change worth stating rather than discovering. A user module
   * declaring `honor Eq<Ordering>` is an orphan either way and was always
   * rejected; but *whether it was also told the instance already exists* used to
   * depend on whether the module happened to import `Prelude` — evidence it had
   * only by accident. Now the collision is reported whatever the import list
   * says. Both messages are errors, so no program changes status.
   */
  test("an orphan honor of a prelude instance also collides with it", () => {
    expect(diagnostics([[
      "/main.hex",
      "honor Eq<Ordering> =\n" +
      "    equals(a, b) = True\n",
    ]])).toEqual([
      "orphan instance: this module declares neither `Eq` nor the instance subject",
      "duplicate instance of `Eq<Ordering>`",
    ]);
  });

  /** A local subject is untouched: the channel adds candidates, never collides with one. */
  test("honoring a constraint for a locally declared union is unaffected", () => {
    expect(diagnostics([[
      "/main.hex",
      "export union Colour = Red | Blue\n" +
      "honor Eq<Colour> =\n" +
      "    equals(a, b) = True\n",
    ]])).toEqual([]);
  });
});
