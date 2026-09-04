import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for Dictionary Sharing §5's naming and collision rules and §8's
 * exported spellings (#425).
 *
 * Two claims, and everything here is one or the other:
 *
 * - **A bare dictionary name certifies an uncontested spelling.** A consumer
 *   binds an imported dictionary under the exporter's interface name, unaliased,
 *   and a re-export chain re-binds that same name at every hop — so transit
 *   names no longer compound. The unconditional per-file alias prefix this
 *   replaced grew one hop's worth of prefix per hop.
 * - **A contested spelling suffixes every contestant.** None keeps the bare
 *   name, the numbering runs from 1, and the order is canonical: declared
 *   instances in declaration order, then imports in specifier order. §8 then
 *   puts the bare spelling back on the *interface*, so a consumer of a module
 *   that had a local collision still reads an uncontested name.
 *
 * Several tests execute the emitted graph. Names are exactly the kind of change
 * that compiles clean and fails at load: a dictionary bound twice under one
 * name is `SyntaxError: Identifier has already been declared`, and a name
 * spelled at a use site that no binding introduces is a `ReferenceError` —
 * neither visible to a diagnostics-only test.
 *
 * Each module's emitted text is kept distinct from its siblings' on purpose:
 * two tests whose emitted JavaScript is byte-identical share one module instance
 * through the data-URL import cache.
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

function lines(javascript: string, prefix: string): readonly string[] {
  return javascript.split("\n").filter((line) => line.startsWith(prefix));
}

/** Every mention of a dictionary in the `Show` family, in emission order. */
function showNames(javascript: string): readonly string[] {
  return [...javascript.matchAll(/__Show_\w+/gu)].map(([name]) => name);
}

describe("an uncontested spelling is bare on both sides", () => {
  /**
   * The headline. `b.hex` names `a.hex`'s dictionary exactly as `a.hex` exports
   * it — no alias clause at all, which is the whole of "aliasing is
   * collision-only".
   */
  test("an imported dictionary binds under the exporter's interface name", async () => {
    const files = [
      ["/a.hex",
        "module A\n\n" + "export record Crate = {size: Int}\n" +
        "honor Show<Crate> =\n" +
        '    show(c) = "crate ${c.size}"\n' +
        "export fun crate(size: Int): Crate = Crate({size = size})\n"],
      ["/b.hex",
        "module B\n\n" + 'import A\n' +
        'export fun label(size: Int): String = "${A.crate(size)}"\n'],
    ] as const;

    const a = emitted(files, "/a.hex");
    // The member seat and the record it fills, both bare — the seat is a
    // first-phase contestant like the dictionary (§5, as amended for #444).
    expect(lines(a, "const __Show_Crate")).toEqual([
      'const __Show_Crate_show = c => "crate " + String(c.size);',
      "const __Show_Crate = { show: __Show_Crate_show };",
    ]);
    expect(lines(a, "export { __Show_Crate")).toEqual([
      "export { __Show_Crate };",
      "export { __Show_Crate_show };",
    ]);

    const b = emitted(files, "/b.hex");
    // No `as`: the import binds the exported spelling itself.
    expect(lines(b, "import { __Show_Crate")).toEqual([
      'import { __Show_Crate } from "./A.js";',
    ]);
    expect(b).toContain("__Show_Crate.show(");

    const main = await runProject([
      ...files,
      ["/main.hex",
        "module Main\n\n" + 'import B\n' +
        "export fun run(size: Int): String = B.label(size)\n"],
    ]);
    expect((main["run"] as (size: number) => string)(3)).toBe("crate 3");
  });

  /**
   * §5's determinism clause, tested as the clause states it: same module, same
   * names, every compile. A naming pass that read a hash table's iteration order
   * or a counter carried across modules would pass every other test here and
   * fail this one.
   */
  test("the same project compiles to the same text twice", () => {
    const files = [
      ["/a.hex",
        "module A\n\n" + "export record Tally = {count: Int}\n" +
        "honor Show<Tally> =\n" +
        '    show(t) = "tally ${t.count}"\n' +
        "honor Eq<Tally> =\n" +
        "    equals(l, r) = l.count == r.count\n" +
        "export fun tally(count: Int): Tally = Tally({count = count})\n"],
      ["/b.hex",
        "module B\n\n" + 'import A\n' +
        'export fun twice(n: Int): String = "${A.tally(n)}${A.tally(n)}"\n' +
        "export fun same(n: Int): Bool = A.tally(n) == A.tally(n)\n"],
    ] as const;

    for (const path of ["/a.hex", "/b.hex"]) {
      expect(emitted(files, path)).toBe(emitted(files, path));
    }
  });
});

describe("a re-export chain stops compounding", () => {
  /**
   * The measured defect this replaced: each hop wrapped the previous hop's local
   * in a fresh per-file alias prefix, so evidence reaching a consumer two hops
   * from its declaration was named for every file it had passed through.
   * Non-prelude transit is load-bearing (Modules §7) and is unchanged — only its
   * names are.
   *
   * `c.hex` never names `Relayed` and never imports `a.hex`; its evidence for
   * `Show<Relayed>` exists only because `b.hex` re-exported it. So the name it
   * binds is a transit name, and the pin is that it is the same one `a.hex`
   * published.
   */
  test("transited evidence keeps the declaring module's spelling", async () => {
    const files = [
      ["/a.hex",
        "module A\n\n" + "export record Relayed = {tag: Int}\n" +
        "honor Show<Relayed> =\n" +
        '    show(r) = "relayed ${r.tag}"\n'],
      ["/b.hex",
        "module B\n\n" + 'import A\n' +
        "export fun viaB(tag: Int): A.Relayed = A.Relayed({tag = tag})\n"],
      ["/c.hex",
        "module C\n\n" + 'import B\n' +
        'export fun render(tag: Int): String = "${B.viaB(tag)}"\n'],
    ] as const;

    for (const path of ["/b.hex", "/c.hex"]) {
      expect(new Set(showNames(emitted(files, path)))).toEqual(
        new Set(["__Show_Relayed"]),
      );
    }
    expect(lines(emitted(files, "/b.hex"), "export { __Show_Relayed")).toEqual([
      "export { __Show_Relayed };",
    ]);
    expect(lines(emitted(files, "/c.hex"), "import { __Show_Relayed")).toEqual([
      'import { __Show_Relayed } from "./B.js";',
    ]);

    const main = await runProject([
      ...files,
      ["/main.hex",
        "module Main\n\n" + 'import C\n' +
        "export fun run(tag: Int): String = C.render(tag)\n"],
    ]);
    expect((main["run"] as (tag: number) => string)(7)).toBe("relayed 7");
  });
});

describe("a contested spelling suffixes every contestant", () => {
  /**
   * Flattening is not injective and an import can meet a local: `b.hex` declares
   * its own `Ledger` and imports a module that exports `Show<Ledger>` for a
   * *different* `Ledger`. Both dictionaries want `__Show_Ledger`.
   *
   * §5: neither keeps it. §8: `b.hex`'s own instance is still exported under the
   * bare spelling, because what renamed its `const` was an internal name — so a
   * consumer of `b.hex` sees an uncontested interface and predicts nothing.
   */
  test("an import and a local instance both take suffixes, and the export stays bare", async () => {
    const files = [
      ["/a.hex",
        "module A\n\n" + "export record Ledger = {rows: Int}\n" +
        "honor Show<Ledger> =\n" +
        '    show(l) = "a-ledger ${l.rows}"\n' +
        "export fun aLedger(rows: Int): Ledger = Ledger({rows = rows})\n"],
      ["/b.hex",
        "module B\n\n" + 'import A\n' +
        "export record Ledger = {name: String}\n" +
        "honor Show<Ledger> =\n" +
        '    show(l) = "b-ledger ${l.name}"\n' +
        'export fun mine(name: String): String = "${Ledger({name = name})}"\n' +
        'export fun theirs(rows: Int): String = "${A.aLedger(rows)}"\n'],
    ] as const;

    const b = emitted(files, "/b.hex");
    // Declared instances first, then imports in specifier order — so the local
    // takes `_1` and the import `_2`. Neither is bare.
    expect(lines(b, "const __Show_Ledger")).toEqual([
      // The seat's own spelling is uncontested — only one instance here has a
      // `show` member under the `__Show_Ledger` stem — so it stays bare while
      // the record it fills is suffixed (§5, as amended for #444).
      'const __Show_Ledger_show = l => "b-ledger " + l.name;',
      "const __Show_Ledger_1 = { show: __Show_Ledger_show };",
    ]);
    expect(lines(b, "import { __Show_Ledger")).toEqual([
      'import { __Show_Ledger as __Show_Ledger_2 } from "./A.js";',
    ]);
    expect(b).not.toMatch(/(?<![_\w])__Show_Ledger(?![_\w])\s*[=.]/u);

    // §8: the interface publishes the bare spelling over the suffixed local for
    // the instance this module declares, and the transited one keeps the local
    // name it was given — a consumer reads both from the interface.
    expect(lines(b, "export { __Show_Ledger")).toEqual([
      "export { __Show_Ledger_2 };",
      "export { __Show_Ledger_1 as __Show_Ledger };",
      "export { __Show_Ledger_show };",
    ]);

    // A consumer therefore imports an uncontested `__Show_Ledger`, which is
    // `b.hex`'s instance — the collision was `b.hex`'s business and stayed there.
    const files2 = [
      ...files,
      ["/c.hex",
        "module C\n\n" + 'import B\n' +
        'export fun show(name: String): String = "${B.Ledger({name = name})}"\n'],
    ] as const;
    const c = emitted(files2, "/c.hex");
    // Both of `b.hex`'s exported dictionaries transit, and both spellings are
    // uncontested *here* — so neither is aliased, and the one `c.hex` selects is
    // the bare `__Show_Ledger`, which is `b.hex`'s own instance. The collision
    // was `b.hex`'s business and stayed there.
    expect(lines(c, "import { __Show_Ledger")).toEqual([
      'import { __Show_Ledger_2, __Show_Ledger } from "./B.js";',
    ]);
    expect(c).toContain("__Show_Ledger.show(");

    const main = await runProject([
      ...files,
      ["/main.hex",
        "module Main\n\n" + 'import B\n' +
        "export fun runMine(name: String): String = B.mine(name)\n" +
        "export fun runTheirs(rows: Int): String = B.theirs(rows)\n"],
    ]);
    expect((main["runMine"] as (name: string) => string)("q")).toBe("b-ledger q");
    expect((main["runTheirs"] as (rows: number) => string)(2)).toBe("a-ledger 2");
  });

  /**
   * The probe, at source level and inside the dictionary family. A third
   * dictionary *prefers* one of the suffixed spellings the two contestants are
   * about to take — `Show<Note_1>` flattens to `__Show_Note_1` — so the
   * numbering has to keep going rather than hand the same name out twice. That
   * is Lexer §3.2's "rename everything renameable, never the thing that is not",
   * applied where every contestant is renameable.
   */
  test("the numbering probes past a spelling another dictionary already prefers", () => {
    const files = [
      ["/a.hex",
        "module A\n\n" + "export record Note = {n: Int}\n" +
        "honor Show<Note> =\n" +
        '    show(x) = "a-note ${x.n}"\n' +
        "export fun aNote(n: Int): Note = Note({n = n})\n"],
      ["/b.hex",
        "module B\n\n" + 'import A\n' +
        "export record Note = {m: Int}\n" +
        "export record Note_1 = {k: Int}\n" +
        "honor Show<Note> =\n" +
        '    show(x) = "b-note ${x.m}"\n' +
        "honor Show<Note_1> =\n" +
        '    show(x) = "b-note-1 ${x.k}"\n' +
        'export fun a(n: Int): String = "${A.aNote(n)}"\n' +
        'export fun b(m: Int): String = "${Note({m = m})}"\n' +
        'export fun c(k: Int): String = "${Note_1({k = k})}"\n'],
    ] as const;

    const b = emitted(files, "/b.hex");
    // `Show<Note_1>` is uncontested, so it keeps `__Show_Note_1` bare — and the
    // two `__Show_Note` contestants have to number *past* it rather than collide
    // with it. They take `_2` and `_3`, in the canonical order: the declared
    // instance, then the import.
    expect(lines(b, "const __Show_")).toEqual([
      'const __Show_Note_show = x => "b-note " + String(x.m);',
      "const __Show_Note_2 = { show: __Show_Note_show };",
      'const __Show_Note_1_show = x => "b-note-1 " + String(x.k);',
      "const __Show_Note_1 = { show: __Show_Note_1_show };",
    ]);
    expect(lines(b, "import { __Show_Note")).toEqual([
      'import { __Show_Note as __Show_Note_3 } from "./A.js";',
    ]);
  });
});
