import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runProject, runMain } from "../support/test-project.js";

/**
 * The #335 pilot's collision arithmetic (the direction note's §5 item 8, last
 * paragraph): **bare `show` in consumer code has exactly one exporter,
 * `Show.hex`.** An honoring module's member binding must not become a bare
 * export to consumers — if every honoring prelude companion poured its member
 * bindings into bare scope, Modules §5.5 would refuse the name everywhere and
 * recreate the collision explosion the design eliminates.
 *
 * The second half of this file was PR β's baseline. Consequence 3 has landed,
 * so the split-spelling defect is now the refusal the baseline predicted; the
 * reading-(i) pin beneath it stands until PR γ, whose own-name refusal flips
 * it. Occlusion (§5 item 6) was never β's to change and is unmoved.
 */

describe("an honoring module's member is not a bare export (the §5 item 8 boundary)", () => {
  const box = [
    "/box.hex",
    "module Box\n\n" + [
      "export record Box = {value: Int}",
      "",
      "honor Show<Box> =",
      "    show(box) = \"Box(${box.value})\"",
      "",
    ].join("\n"),
  ] as const;

  test("a consumer's bare `show` is still the polymorphic member, at Int and at Box", async () => {
    const exports = await runProject([
      box,
      ["/main.hex", "module Main\n\n" + [
        "import Box",
        "",
        "export let atInt: String = show(42)",
        "export let atBox: String = show(Box({value = 3}))",
        "",
      ].join("\n")],
    ]);

    expect(exports.atInt).toBe("42");
    expect(exports.atBox).toBe("Box(3)");
  });

  /**
   * Respelt for #762: a member was never nameable as a bare import, and now
   * neither is anything else — `import { show } from "./box"` is refused at
   * the parser, before any export list is consulted, so the boundary this file
   * is about shows up one layer earlier than it used to. The member stays
   * reachable, at its honored type, through the module alias (`Box.show`,
   * Modules §3.2, #762) or bare via the polymorphic member itself, pinned
   * above.
   */
  test("a named import of the member is a parse error, not an export refusal", () => {
    const compiled = compileFiles([
      box,
      ["/main.hex", "module Main\n\n" + 'import { show } from "./box"\nexport let r: String = show(42)\n'],
    ]);

    expect(compiled.diagnostics.map(({ message }) => message)).toContain(
      "Hexagon imports name modules: write `import Box` and reach " +
        "`show` as `Box.show`",
    );
  });
});

describe("occlusion and shadowing (the note's §5 item 6, pinned)", () => {
  test("a module-level `let show` occludes the prelude member (§5.4, layer test)", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "export let show(n: Int): String = \"local ${n}\"",
      "",
      "export let r: String = show(7)",
      "export let qualified: String = Show.show(7)",
      "",
    ].join("\n"));

    expect(exports.r).toBe("local 7");
    // The prelude version stays reachable qualified (Modules §6.4).
    expect(exports.qualified).toBe("7");
  });

  /**
   * An inner layer may shadow the prelude and nothing else (Modules §5.4 since
   * #464), so this is the existing prelude-name law reaching a new name, not new
   * law: `show` is a prelude binding like any other here, and the local wins for
   * its block. It used to be refused, and the refusal came with a cascade — the
   * refused binding left `show` meaning the polymorphic member, which the body
   * then mistyped.
   */
  test("an inner-layer `let show` shadows, as for every prelude name (§5.4)", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "export let f(n: Int): String =",
      "    let show = \"not the member\"",
      "    show",
      "",
      "export let r: String = f(1)",
      "",
    ].join("\n"));

    expect(exports.r).toBe("not the member");
  });
});

describe("the split-spelling defect is now refused (consequence 3)", () => {
  /**
   * What the baseline measured: a module exporting a `show` *while* honoring
   * `Show` at its own type compiled with the spellings split — the module-level
   * binding took bare use and export position, the honor member took
   * interpolation. Two meanings, silently. The program is now unwritable, and
   * the diagnostic is the one the language already owns for binding a name
   * twice.
   *
   * Both orders, because the claim is order-free: a member binding enters the
   * module's term space wherever its block sits, so a `let` before the block
   * and a `let` after it are the same collision. Each is reported at the
   * *later* of the two, which is where a reader would make the fix.
   *
   * The binding is **exported** in both, and since #546 that changes nothing:
   * the claim is unconditional, no export is exempt, and the export grammar
   * carries no exemption. A member's wider face is a `widens` declaration
   * (Constraints §4.7) — which `show` has no seat for anyway, so neither of
   * these could ever have been one, and both take the plain refusal.
   */
  test("`honor Show<Box>` then `export let show` is refused", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "export record Box = {value: Int}",
      "",
      "honor Show<Box> =",
      "    show(box) = \"member ${box.value}\"",
      "",
      "export let show(box: Box): String = \"export ${box.value}\"",
      "",
    ].join("\n"))).toEqual([
      "`show` is already bound: the `Show<Box>` instance binds it as a member " +
        "(line 5); Hexagon does not allow rebinding — choose a different name.",
    ]);
  });

  test("`export let show` then `honor Show<Box>` is refused", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "export record Box = {value: Int}",
      "",
      "export let show(box: Box): String = \"export ${box.value}\"",
      "",
      "honor Show<Box> =",
      "    show(box) = \"member ${box.value}\"",
      "",
    ].join("\n"))).toEqual([
      "the `Show<Box>` instance binds `show`, which is already bound (line 5); " +
        "Hexagon does not allow rebinding — choose a different name.",
    ]);
  });

  /**
   * The other half of the same baseline: an honor member binds nothing at
   * module level today, so bare `show` inside the honoring module is the
   * *prelude's* polymorphic member, which evidence-selects the module's own
   * instance at its own type. The note's §5 item 8 re-reads this spelling as
   * the member binding itself (monomorphic); at this shape the two readings
   * agree observationally, so the change here is doctrine rather than output,
   * and it is PR γ's — β claims the spelling without binding it.
   */
  test("bare `show` inside an honoring module reaches the honored instance via evidence", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "export record Tag = {name: String}",
      "",
      "honor Show<Tag> =",
      "    show(tag) = \"#${tag.name}\"",
      "",
      "export let r: String = show(Tag({name = \"pin\"}))",
      "",
    ].join("\n"));

    expect(exports.r).toBe("#pin");
  });
});
