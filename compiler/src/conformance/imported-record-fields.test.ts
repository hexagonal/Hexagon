import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

/**
 * Conformance for Modules §4.1 vs §4.2: which module may see a record's fields.
 *
 * `export record` exports the type *and* the constructor, "fields come with the
 * constructor: construction, `p.x`, patterns, update" (§4.1), and §13(b) pins
 * that row across an import. Only `opaque record` withholds them (§4.2).
 *
 * The defect (#285) was that the checker read one flag for two questions. The
 * resolver stamps `representationVisible: false` on every imported nominal copy
 * regardless of opacity — it records "this copy is not the declaring module's
 * own" — and the field-visibility predicate took that as opacity, so a plain
 * imported record answered every field with the §4.2 diagnostic. Both resolver
 * inclusion paths stamp it, so both are exercised below.
 */

/** One compiled project, with every module's diagnostic messages flattened. */
function project(files: readonly (readonly [string, string])[]) {
  const compiled = compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
  );
  return {
    compiled,
    messages: compiled.modules.flatMap(({ typed }) => typed.diagnostics.map(({ message }) => message)),
  };
}

/** One emitted module, by source path. */
function emitted(compiled: ReturnType<typeof project>["compiled"], path: string) {
  const module = compiled.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`${path} was not emitted`);
  return module;
}

const MAGNET = "export record Magnet = {poles: Int}\n";

describe("a plain exported record carries its fields across the import", () => {
  test("the filed acceptance: field access through the same-spelled alias (#285)", () => {
    const { compiled, messages } = project([
      ["/geo.hex", "module Geo\n\n" + MAGNET],
      [
        "/main.hex",
        // Rule 3's companion fallback (Modules §3.2, #762): the alias's own
        // spelling `Magnet` equals the exported record's, so the annotation
        // reaches it bare with no separate import for the type.
        'import Geo as Magnet\n' +
          "export fun poleCount(m: Magnet): Int = m.poles\n",
      ],
    ]);

    expect(messages).toEqual([]);
    expect(compiled.diagnostics).toEqual([]);
    expect(emitted(compiled, "/main.hex").javascript.text).toContain("return m.poles;");
  });

  test("the whole §4.1 row through the same-spelled alias: construct, read, update", () => {
    const { compiled, messages } = project([
      ["/geo.hex", "module Geo\n\n" + MAGNET],
      [
        "/main.hex",
        "module Main\n\n" + 'import Geo as Magnet\n' +
          "export let north: Magnet = Magnet({poles = 2})\n" +
          "export fun poleCount(m: Magnet): Int = m.poles\n" +
          "export fun retune(m: Magnet): Magnet = {m with poles = 3}\n",
      ],
    ]);

    expect(messages).toEqual([]);
    const javascript = emitted(compiled, "/main.hex").javascript.text;
    expect(javascript).toContain('import * as Magnet from "./geo.js";');
    expect(javascript).toContain("const north = { poles: 2 };");
    expect(javascript).toContain("return m.poles;");
    expect(javascript).toContain("return { ...m, poles: 3 };");
  });

  test("the same row through a namespace import — the other inclusion path", () => {
    const { compiled, messages } = project([
      ["/geo.hex", "module Geo\n\n" + MAGNET],
      [
        "/main.hex",
        "module Main\n\n" + 'import Geo\n' +
          "export let north: Geo.Magnet = Geo.Magnet({poles = 2})\n" +
          "export fun poleCount(m: Geo.Magnet): Int = m.poles\n" +
          "export fun retune(m: Geo.Magnet): Geo.Magnet = {m with poles = 3}\n",
      ],
    ]);

    expect(messages).toEqual([]);
    const javascript = emitted(compiled, "/main.hex").javascript.text;
    expect(javascript).toContain('import * as Geo from "./geo.js";');
    expect(javascript).toContain("return m.poles;");
    expect(javascript).toContain("return { ...m, poles: 3 };");
  });

  test("a visible field wins the dot-call over a same-named companion operation", () => {
    // `show` is a real prelude operation, so the disambiguation has something to
    // lose to: an invisible representation sends `m.show(1)` to companion
    // dispatch, which is a different function with a different type.
    const { compiled, messages } = project([
      ["/geo.hex", "module Geo\n\n" + "export record Magnet = {poles: Int, show: (Int) -> Int}\n"],
      [
        "/main.hex",
        "module Main\n\n" + 'import Geo as Magnet\n' +
          "export fun describe(m: Magnet): Int = m.show(1)\n",
      ],
    ]);

    expect(messages).toEqual([]);
    // The field, called — not `Show.show`, which would emit a companion call.
    expect(emitted(compiled, "/main.hex").javascript.text).toContain("return (m.show)(1);");
  });
});

describe("opacity is unchanged — the control on §4.2", () => {
  // These hold before and after #285's fix. They are here so that a repair
  // reached by unstamping imported copies in the resolver, rather than by
  // asking the declaration whether it is opaque, fails loudly.
  const VAULT = "opaque record Token = {value: Int}\n" +
    "export fun issue(value: Int): Token = Token({value = value})\n";

  test("an opaque record's fields stay private through the same-spelled alias", () => {
    // Rule 3's companion fallback (#762) reaches the *type*, unopposed by
    // opacity — companion-fallback.test.ts pins that the fallback answers the
    // same type, not a looser one — but the fields it withholds stay withheld.
    const { messages } = project([
      ["/vault.hex", "module Vault\n\n" + VAULT],
      [
        "/main.hex",
        "module Main\n\n" + 'import Vault as Token\n' +
          "export fun leak(t: Token): Int = t.value\n",
      ],
    ]);

    expect(messages).toContain(
      "cannot access field `value` of opaque record `Token`; use an operation exported by its home module",
    );
  });

  test("an opaque record cannot be updated through a namespace import", () => {
    const { messages } = project([
      ["/vault.hex", "module Vault\n\n" + VAULT],
      [
        "/main.hex",
        "module Main\n\n" + 'import Vault\n' +
          "export fun bump(t: Vault.Token): Vault.Token = {t with value = 1}\n",
      ],
    ]);

    expect(messages).toContain(
      "cannot update opaque record `Token`; use an operation exported by its home module",
    );
  });

  test("the home module still sees its own opaque record's fields", () => {
    const { messages } = project([
      [
        "/vault.hex",
        VAULT + "export fun reveal(t: Token): Int = t.value\n" +
          "export fun bump(t: Token): Token = {t with value = 1}\n",
      ],
    ]);

    expect(messages).toEqual([]);
  });
});
