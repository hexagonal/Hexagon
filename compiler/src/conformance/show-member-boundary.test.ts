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
 * The second half of this file is PR β's baseline: the occlusion and
 * split-spelling behaviors the note's consequence 3 will overturn, measured
 * and pinned as they stand today so β's change is a visible diff rather than
 * an assumed one.
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
   * Inner layers may occlude nothing — prelude included (Modules §5.4, the
   * layer-identity test) — so this is the existing prelude-name law reaching a
   * new name, not new law. Measured: the refusal arrives with a cascade (the
   * refused binding leaves `show` meaning the polymorphic member, which the
   * body then mistypes); the pin asserts the refusal itself.
   */
  test("an inner-layer `let show` is refused, as for every prelude name (§5.4)", () => {
    const diagnostics = projectDiagnostics([
      "export let f(n: Int): String =",
      "    let show = \"not the member\"",
      "    show",
      "",
    ].join("\n"));

    expect(diagnostics.some((message) => /`show` is already bound/u.test(message))).toBe(true);
  });
});

describe("PR β's baseline: the split-spelling defect still compiles today", () => {
  /**
   * The measured defect the note's consequence 3 retires: a module exporting a
   * `show` *while* honoring `Show` at its own type compiles with the spellings
   * split — the module-level binding takes bare use and export position, the
   * honor member takes interpolation. Two meanings, silently. Under consequence
   * 3 this becomes the ordinary rebinding refusal; until β lands, this pin is
   * the record of what that change repairs.
   */
  test("`export let show` beside `honor Show<Box>` compiles, spellings split", async () => {
    const exports = await runProject([
      ["/box.hex", [
        "export record Box = {value: Int}",
        "",
        "honor Show<Box> =",
        "    show(box) = \"member ${box.value}\"",
        "",
        "export let show(box: Box): String = \"export ${box.value}\"",
        "",
        "export let bareInModule: String = show(Box({value = 1}))",
        "export let interpolated: String = \"${Box({value = 2})}\"",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import { bareInModule, interpolated } from \"./box\"",
        "",
        "export let bare: String = bareInModule",
        "export let member: String = interpolated",
        "",
      ].join("\n")],
    ]);

    expect(exports.bare).toBe("export 1");
    expect(exports.member).toBe("member 2");
  });

  /**
   * The other half of the same baseline: an honor member binds nothing at
   * module level today, so bare `show` inside the honoring module is the
   * *prelude's* polymorphic member, which evidence-selects the module's own
   * instance at its own type. The note's §5 item 8 re-reads this spelling as
   * the member binding itself (monomorphic); at this shape the two readings
   * agree observationally, so β's change here is doctrine rather than output.
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
