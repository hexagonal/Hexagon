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
    [
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
      ["/main.hex", [
        "import { Box } from \"./box\"",
        "",
        "export let atInt: String = show(42)",
        "export let atBox: String = show(Box({value = 3}))",
        "",
      ].join("\n")],
    ]);

    expect(exports.atInt).toBe("42");
    expect(exports.atBox).toBe("Box(3)");
  });

  test("the honoring module exports no `show` an importer could name", () => {
    const compiled = compileFiles([
      box,
      ["/main.hex", 'import { show } from "./box"\nexport let r: String = show(42)\n'],
    ]);

    expect(compiled.diagnostics.map(({ message }) => message)).toContain(
      "module `./box` does not export `show`",
    );
  });
});

describe("occlusion and shadowing (the note's §5 item 6, pinned)", () => {
  test("a module-level `let show` occludes the prelude member (§5.4, layer test)", async () => {
    const exports = await runMain([
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
   * The binding is **exported** in both, so what decides them now is §4.6's
   * generalising-export exemption (#541) rather than the claim itself — and it
   * decides them the same way, because these two signatures are identical and
   * an identical signature generalises nothing. The message names the law, so
   * the repair the law wants (widen it, or rename) is the one offered.
   */
  test("`honor Show<Box>` then `export let show` is refused", () => {
    expect(projectDiagnostics([
      "export record Box = {value: Int}",
      "",
      "honor Show<Box> =",
      "    show(box) = \"member ${box.value}\"",
      "",
      "export let show(box: Box): String = \"export ${box.value}\"",
      "",
    ].join("\n"))).toEqual([
      "`show` is already bound: the `Show<Box>` instance binds it as a member " +
        "(line 3); an exported binding of a member's spelling is legal only when " +
        "it properly generalises the member (Modules §5.3) — same subject seat, " +
        "same result, at least one remaining seat properly wider — so widen it " +
        "or choose a different name.",
    ]);
  });

  test("`export let show` then `honor Show<Box>` is refused", () => {
    expect(projectDiagnostics([
      "export record Box = {value: Int}",
      "",
      "export let show(box: Box): String = \"export ${box.value}\"",
      "",
      "honor Show<Box> =",
      "    show(box) = \"member ${box.value}\"",
      "",
    ].join("\n"))).toEqual([
      "the `Show<Box>` instance binds `show`, which is already bound (line 3); " +
        "an exported binding of a member's spelling is legal only when it " +
        "properly generalises the member (Modules §5.3) — same subject seat, " +
        "same result, at least one remaining seat properly wider — so widen it " +
        "or choose a different name.",
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
