import { describe, expect, test } from "vitest";

import { compileFiles } from "../support/test-project.js";
import type * as Diagnostics from "../support/diagnostics.js";

/**
 * Conformance for **#829** — a module is a named declaration, a file is a
 * container — at the seats a file's own *text* owns: the header, the closer,
 * the names two modules may not share, and the address the emitted files take.
 *
 * Modules §13(o)'s headers and closers, §13(p)'s reachable rows, and every §10
 * row those two reach with the package set this slice has, `{project, Hex}`.
 * The import head's own family is `module-imports.test.ts`'s §13(n); what is
 * here is everything that happens before an import is read, plus Packages §6's
 * layout, which is the one rule an emitted path can get wrong silently.
 */

/** Every message the project reported, in order. */
function messages(
  files: readonly (readonly [string, string])[],
  options: Parameters<typeof compileFiles>[1] = {},
): readonly string[] {
  return compileFiles(files, options).diagnostics.map(({ message }) => message);
}

/** Every diagnostic the project reported, for the fixits and notes. */
function reports(
  files: readonly (readonly [string, string])[],
): readonly Diagnostics.Diagnostic[] {
  return compileFiles(files).diagnostics;
}

/**
 * One file's text with every edit of one diagnostic's sole fix applied — the
 * proof that a rewrite is the repair and not a gesture at one (Declarations
 * Preamble §1.1). Edits are applied last-first so earlier spans keep their
 * offsets.
 */
function applied(text: string, diagnostic: Diagnostics.Diagnostic | undefined): string {
  const [fix, ...rest] = diagnostic?.fixes ?? [];
  expect(rest).toEqual([]);
  return [...fix?.edits ?? []]
    .sort((left, right) => right.span.start.offset - left.span.start.offset)
    .reduce(
      (document, { span, replacement }) =>
        document.slice(0, span.start.offset) + replacement + document.slice(span.end.offset),
      text,
    );
}

/** The emitted addresses of a project's own modules — the prelude's dropped. */
function projectPaths(
  files: readonly (readonly [string, string])[],
  options: Parameters<typeof compileFiles>[1] = {},
): readonly string[] {
  return compileFiles(files, options).modules
    .filter(({ name }) => !name.startsWith("Hex."))
    .map(({ path }) => path);
}

const POINT = "export record Point = {x: Float, y: Float}\n";

describe("§13 (o) — every file declares its module", () => {
  test("a headerless file is refused, and the fixit inserts the derived header", () => {
    const text = "export fun parse(s: String): Int = 1\n";
    const [diagnostic, ...rest] = reports([["/search-params.hex", text]]);
    expect(diagnostic?.message).toBe(
      "every file declares its module; write `module SearchParams`",
    );
    expect(rest).toEqual([]);
    // The derivation is the fixit's alone: it upper-cases each separator-
    // delimited segment and joins them, and the compiler reads no name off a
    // path (§2.1, §9.2).
    expect(applied(text, diagnostic)).toBe(`module SearchParams\n\n${text}`);
    expect(messages([["/search-params.hex", applied(text, diagnostic)]])).toEqual([]);
  });

  test("a basename yielding no uppercase-start identifier names the slot, with no edit", () => {
    const [diagnostic, ...rest] = reports([["/2d-utils.hex", "export let n: Int = 1\n"]]);
    expect(diagnostic?.message).toBe("every file declares its module; write `module <Name>`");
    expect(diagnostic?.fixes ?? []).toEqual([]);
    expect(rest).toEqual([]);
  });

  test("items above a header are code outside a module, and the header is named", () => {
    // §2.2's family, not §2.1's: the file *does* declare its module, so no name
    // derived from a path is offered — a spelling the language never reads.
    expect(messages([["/f.hex", "let stray: Int = 1\nmodule Geometry\n" + POINT]])).toEqual([
      "code outside a module: `module Geometry` opens the file's first module below; " +
      "move this item under that header",
    ]);
  });

  test("a second header met with one open is refused, and the fixit closes the first", () => {
    const text = `module Geometry\n${POINT}module Shapes\nexport let n: Int = 1\n`;
    const [diagnostic, ...rest] = reports([["/f.hex", text]]);
    expect(diagnostic?.message).toBe(
      "a file holding several modules closes each with `end module Geometry`",
    );
    expect(rest).toEqual([]);
    expect(applied(text, diagnostic)).toBe(
      `module Geometry\n${POINT}end module Geometry\n\nmodule Shapes\nexport let n: Int = 1\n`,
    );
    expect(messages([["/f.hex", applied(text, diagnostic)]])).toEqual([]);
  });

  test("a closer naming another module is refused, and the fixit names the open one", () => {
    const text = `module Geometry\n${POINT}end module Shapes\n`;
    const [diagnostic, ...rest] = reports([["/f.hex", text]]);
    expect(diagnostic?.message).toBe(
      "`end module Shapes` closes `module Geometry`; write `end module Geometry`",
    );
    expect(rest).toEqual([]);
    expect(applied(text, diagnostic)).toBe(`module Geometry\n${POINT}end module Geometry\n`);
    expect(messages([["/f.hex", applied(text, diagnostic)]])).toEqual([]);
  });

  test("code after a closer is refused, once, at the first such item", () => {
    expect(messages([[
      "/f.hex",
      `module Geometry\n${POINT}end module Geometry\nlet stray: Int = 1\nlet other: Int = 2\n`,
    ]])).toEqual([
      "code outside a module: `end module Geometry` ended the module above; " +
      "open another with `module Name`",
    ]);
  });

  test("a closer with no module open is refused", () => {
    expect(messages([["/f.hex", `module Geometry\n${POINT}end module Geometry\nend module Geometry\n`]]))
      .toEqual([
        "`end module Geometry` closes no module; open one with `module Name`",
      ]);
  });

  test("the closer is optional in a one-module file, and legal there", () => {
    expect(messages([["/f.hex", `module Geometry\n${POINT}end module Geometry\n`]])).toEqual([]);
    expect(messages([["/f.hex", `module Geometry\n${POINT}`]])).toEqual([]);
  });

  test("two modules sharing a file are strangers: neither's names are in scope", () => {
    expect(messages([[
      "/f.hex",
      `module Geometry\n${POINT}end module Geometry\n` +
      "module Shapes\nexport fun unit(): Geometry.Point = Geometry.Point({x = 1.0, y = 2.0})\n",
    ]])).toEqual([
      "unknown module alias `Geometry`",
      "unknown name `Geometry`",
    ]);
  });

  test("a header below the top level is refused, the name uppercase-start", () => {
    expect(messages([[
      "/f.hex",
      "module Geometry\nfun f(): Int =\n    module Inner\n    1\n",
    ]])).toEqual([
      "`module` and `end module` mark a module at a file's top level; " +
      "a module cannot be declared or closed inside a block",
    ]);
  });
});

describe("§13 (o) — the miscased header (#838)", () => {
  test("`module geometry` is refused with the header's own rewrite", () => {
    const text = `module geometry\n${POINT}`;
    const [diagnostic, ...rest] = reports([["/f.hex", text]]);
    expect(diagnostic?.message).toBe(
      "a module name is uppercase-start; write `module Geometry`",
    );
    // The reading recovers as the rewrite spells it, so the file has its
    // header: no headerless report follows it.
    expect(rest).toEqual([]);
    expect(applied(text, diagnostic)).toBe(`module Geometry\n${POINT}`);
    expect(messages([["/f.hex", applied(text, diagnostic)]])).toEqual([]);
  });

  test("each dot-separated segment is upper-cased and the dots are kept", () => {
    const text = `module render.geometry\n${POINT}`;
    expect(messages([["/f.hex", text]])).toEqual([
      "a module name is uppercase-start; write `module Render.Geometry`",
    ]);
    expect(applied(text, reports([["/f.hex", text]])[0])).toBe(
      `module Render.Geometry\n${POINT}`,
    );
    // One segment wrong is the same one name (§2.3), not a name and a stray dot.
    expect(messages([["/f.hex", `module Render.geometry\n${POINT}`]])).toEqual([
      "a module name is uppercase-start; write `module Render.Geometry`",
    ]);
  });

  test("a header whose upper-casing is a no-op names the slot and carries no edit", () => {
    const [diagnostic, ...rest] = reports([["/f.hex", `module 用户\n${POINT}`]]);
    expect(diagnostic?.message).toBe(
      "a module name is uppercase-start; write `module <Name>`",
    );
    expect(diagnostic?.fixes ?? []).toEqual([]);
    expect(rest).toEqual([]);
  });

  test("the slot's test is that no *lawful* name results, not that nothing changed", () => {
    // §13(o)'s `internal.hex`. Upper-casing `_internal.util` yields
    // `_internal.Util` — a different spelling, and still no module name, since
    // every segment has to be uppercase-start. The message names the slot, and
    // no edit is offered: writing `_internal.Util` would repair one refusal
    // into another (#838).
    const [diagnostic, ...rest] = reports([["/internal.hex", `module _internal.util\n${POINT}`]]);
    expect(diagnostic?.message).toBe("a module name is uppercase-start; write `module <Name>`");
    expect(diagnostic?.fixes ?? []).toEqual([]);
    expect(rest).toEqual([]);
    // And the reading recovers under the *written* spelling, there being no
    // other: the file has its header, so no headerless report follows, and the
    // name the file's own checks see is `_internal.util`.
    expect(
      compileFiles([["/internal.hex", `module _internal.util\n${POINT}`]])
        .modules.filter(({ name }) => !name.startsWith("Hex."))
        .map(({ name }) => name),
    ).toEqual(["_internal.util"]);
  });

  test("the recovered name meets §2.2's first-segment rule at the same header", () => {
    // §13(o)'s `util.hex`: two reports at one line. The casing rewrite names
    // the very spelling the first-segment rule then refuses, so the rewrite is
    // one repair of two and the rename is the one that reaches legal code.
    expect(messages([["/util.hex", `module hex.util\n${POINT}`]])).toEqual([
      "a module name is uppercase-start; write `module Hex.Util`",
      "`Hex.Util` begins with the name of the package `Hex`; a dotted module's first " +
      "segment cannot name a package in the program; rename the module",
    ]);
    // At the slot the reach is the same: a dotted slot name whose first segment
    // names a package draws the first-segment report beside the casing one,
    // against the spelling the file recovered under.
    expect(messages([["/i.hex", `module Hex._internal\n${POINT}`]])).toEqual([
      "a module name is uppercase-start; write `module <Name>`",
      "`Hex._internal` begins with the name of the package `Hex`; a dotted module's first " +
      "segment cannot name a package in the program; rename the module",
    ]);
  });

  test("a slot name is a declaration for the package's duplicate rule, and renames", () => {
    // §13(o)'s `a.hex`/`b.hex`. The written spelling is a declaration for the
    // file's and the package's own checks — no importer can spell it — so two
    // files declaring `用户` collide. The dotted hint is unspellable here, no
    // dotting making such a name lawful, so the hint is a rename instead.
    const [first, second, duplicate, ...rest] = reports([
      ["/a.hex", `module 用户\n${POINT}`],
      ["/b.hex", "module 用户\nexport let n: Int = 1\n"],
    ]);
    // a.hex draws its casing report; b.hex draws its own and the duplicate.
    expect([first?.message, second?.message, duplicate?.message]).toEqual([
      "a module name is uppercase-start; write `module <Name>`",
      "a module name is uppercase-start; write `module <Name>`",
      "module `用户` is declared twice: `/a.hex` (line 1) and `/b.hex` (line 1)",
    ]);
    expect(duplicate?.notes).toEqual(["rename the module"]);
    expect(rest).toEqual([]);
    // A lawful name keeps the dotted hint: the rename is the slot's answer,
    // not the rule's.
    expect(
      reports([
        ["/a.hex", `module Geometry\n${POINT}`],
        ["/b.hex", "module Geometry\nexport let n: Int = 1\n"],
      ])[0]?.notes,
    ).toEqual(["give one a dotted name, `module Render.Geometry`"]);
  });

  test("§2.2's reports fire against the rewritten name, each at its own seat", () => {
    // The closer is never a casing seat: `end module geometry` under the
    // recovered `Geometry` draws §2.2's closer-naming rule and nothing else.
    expect(messages([["/f.hex", `module geometry\n${POINT}end module geometry\n`]])).toEqual([
      "a module name is uppercase-start; write `module Geometry`",
      "`end module geometry` closes `module Geometry`; write `end module Geometry`",
    ]);
    // A second header, judged against the recovered name.
    expect(messages([["/f.hex", `module geometry\n${POINT}module Shapes\nlet n: Int = 1\n`]]))
      .toEqual([
        "a module name is uppercase-start; write `module Geometry`",
        "a file holding several modules closes each with `end module Geometry`",
      ]);
    // And the duplicate-name rule, against the recovered name too.
    expect(messages([
      ["/a.hex", `module Geometry\n${POINT}`],
      ["/b.hex", "module geometry\nexport let n: Int = 1\n"],
    ])).toEqual([
      "a module name is uppercase-start; write `module Geometry`",
      "module `Geometry` is declared twice: `/a.hex` (line 1) and `/b.hex` (line 1)",
    ]);
  });

  test("a header both miscased and second draws both reports, edits that compose", () => {
    const text = `module Geometry\n${POINT}module shapes\nexport let n: Int = 1\n`;
    const [casing, second, ...rest] = reports([["/f.hex", text]]);
    expect([casing?.message, second?.message]).toEqual([
      "a module name is uppercase-start; write `module Shapes`",
      "a file holding several modules closes each with `end module Geometry`",
    ]);
    expect(rest).toEqual([]);
    // Neither edit stands in the other's way: applying both — the later span
    // first, as a host applying two edits to one document does — reaches a
    // file that compiles.
    expect(messages([["/f.hex", applied(applied(text, casing), second)]])).toEqual([]);
  });

  test("the module the file recovers under is the one an importer names", () => {
    expect(messages([
      ["/g.hex", `module geometry\n${POINT}`],
      ["/main.hex", "module Main\n\nimport Geometry\nexport let p: Geometry.Point = " +
        "Geometry.Point({x = 1.0, y = 2.0})\n"],
    ])).toEqual(["a module name is uppercase-start; write `module Geometry`"]);
  });

  test("below the top level `module geometry` is the ordinary parse error", () => {
    // The seat is not claimed there: no header was ever possible, so there is
    // nothing to redirect to (§2.1).
    expect(messages([["/f.hex", "module Geometry\nfun f(): Int =\n    module geometry\n    1\n"]]))
      .toEqual([
        "unknown name `module`",
        "expected a newline or `;` between block items",
      ]);
  });
});

describe("§2.2 — two modules of one name in one package", () => {
  test("the second header is refused, both files named, with the dotted hint", () => {
    const [diagnostic, ...rest] = reports([
      ["/render.hex", `module Geometry\n${POINT}`],
      ["/physics.hex", "module Geometry\nexport let n: Int = 1\n"],
    ]);
    expect(diagnostic?.message).toBe(
      "module `Geometry` is declared twice: `/render.hex` (line 1) and `/physics.hex` (line 1)",
    );
    expect(diagnostic?.notes).toEqual(["give one a dotted name, `module Render.Geometry`"]);
    expect(rest).toEqual([]);
  });

  test("the file the duplicate shadows keeps its own parse reports", () => {
    // Only one of two same-named modules is compiled — they share one layout
    // address (Packages §6) — and the other's reports would go down with it.
    // A file's *parse* reports are the file's, whatever the index then decides
    // (§2.1's stage line), so the shadowed file still draws them.
    expect(messages([
      ["/a.hex", "module Geometry\nexport let n: Int = \n"],
      ["/b.hex", `module Geometry\n${POINT}`],
    ])).toEqual([
      "expected an indented block",
      "expected an expression, found the end of a block",
      "module `Geometry` is declared twice: `/a.hex` (line 1) and `/b.hex` (line 1)",
    ]);
  });

  test("the comparison folds case, on the emitted filesystem's account (§11.1)", () => {
    expect(messages([
      ["/a.hex", `module Geometry\n${POINT}`],
      ["/b.hex", "module GEOMETRY\nexport let n: Int = 1\n"],
    ])).toEqual([
      "module `GEOMETRY` is declared twice: `/a.hex` (line 1) and `/b.hex` (line 1)",
    ]);
  });

  test("two modules of one name in *different* packages are legal", () => {
    // The project's own `Option` beside the prelude's — §5.4's occlusion, and
    // the case the case-fold rule must not catch.
    expect(messages([["/o.hex", "module Option\nexport let n: Int = 1\n"]])).toEqual([]);
  });
});

describe("§2.2 — a dotted module's first segment never names a package", () => {
  test("the standard library's own name is refused at the header", () => {
    expect(messages([["/f.hex", "module Hex.Util\nexport let n: Int = 1\n"]])).toEqual([
      "`Hex.Util` begins with the name of the package `Hex`; a dotted module's first " +
      "segment cannot name a package in the program; rename the module",
    ]);
  });

  test("a listed dependency's name is refused at the header", () => {
    expect(messages(
      [["/f.hex", "module Acme.Geometry\nexport let n: Int = 1\n"]],
      { dependencies: ["Acme"] },
    )).toEqual([
      "`Acme.Geometry` begins with the name of the package `Acme`; a dotted module's " +
      "first segment cannot name a package in the program; rename the module",
    ]);
  });

  test("the project's own name is refused at the header too", () => {
    expect(messages(
      [["/f.hex", "module MyApp.Geometry\nexport let n: Int = 1\n"]],
      { packageName: "MyApp" },
    )).toEqual([
      "`MyApp.Geometry` begins with the name of the package `MyApp`; a dotted module's " +
      "first segment cannot name a package in the program; rename the module",
    ]);
  });

  test("an undotted name beside a package of that name is fine", () => {
    // §13(o)'s fourth file: `module Json` beside a dependency `Json`.
    expect(messages(
      [["/f.hex", "module Json\nexport let n: Int = 1\n"]],
      { dependencies: ["Json"] },
    )).toEqual([]);
  });

  test("a dotted name whose first segment names no package is fine", () => {
    expect(messages([["/f.hex", `module Render.Geometry\n${POINT}`]])).toEqual([]);
  });
});

describe("§13 (p) — the rows a `{project, Hex}` program reaches", () => {
  test("a package qualifying its own module draws the self-qualified report", () => {
    expect(messages(
      [
        ["/g.hex", `module Geometry\n${POINT}`],
        ["/main.hex", "module Main\n\nimport MyApp.Geometry\n"],
      ],
      { packageName: "MyApp" },
    )).toEqual([
      "no module `MyApp.Geometry`; a package's own modules are imported by their " +
      "declared names: `import Geometry`",
    ]);
  });

  test("an unknown module names the near misses, a dotted suffix included", () => {
    expect(messages([
      ["/g.hex", `module Render.Geometry\n${POINT}`],
      ["/main.hex", "module Main\n\nimport Geometry\n"],
    ])).toEqual(["no module `Geometry`; did you mean `Render.Geometry`?"]);
  });

  test("an unknown module with no near miss names none", () => {
    expect(messages([["/main.hex", "module Main\n\nimport Nowhere\n"]])).toEqual([
      "no module `Nowhere`",
    ]);
  });

  test("a dotted import binds the last segment", () => {
    expect(messages([
      ["/g.hex", `module Render.Geometry\n${POINT}`],
      ["/main.hex", "module Main\n\nimport Render.Geometry\n" +
        "export let p: Geometry.Point = Geometry.Point({x = 1.0, y = 2.0})\n"],
    ])).toEqual([]);
  });

  test("two imports landing on one alias collide, and `as` is the fixit", () => {
    expect(messages([
      ["/r.hex", `module Render.Geometry\n${POINT}`],
      ["/p.hex", "module Physics.Geometry\nexport let n: Int = 1\n"],
      ["/main.hex", "module Main\n\nimport Render.Geometry\nimport Physics.Geometry\n"],
    ])).toEqual([
      "module alias `Geometry` is already bound; write `import Physics.Geometry as <Alias>`",
    ]);
  });

  test("a second alias onto a prelude module is legal", () => {
    expect(messages([[
      "/main.hex",
      "module Main\n\nimport Option as Opt\nexport let n: Opt.Option(Int) = Opt.Some(1)\n",
    ]])).toEqual([]);
  });

  test("the prelude is reachable by its full name too", () => {
    expect(messages([[
      "/main.hex",
      "module Main\n\nimport Hex.Option as Opt\nexport let n: Opt.Option(Int) = Opt.Some(1)\n",
    ]])).toEqual([]);
  });

  test("the project's own module occludes a package's of the same name, silently", () => {
    expect(messages([
      ["/o.hex", "module Option\nexport fun mine(n: Int): Int = n\n"],
      ["/main.hex", "module Main\n\nimport Option\nexport let n: Int = Option.mine(1)\n"],
    ])).toEqual([]);
  });
});

describe("Packages §6 — the layout a module emits under", () => {
  const MAIN = ["/m.hex", "module Main\nexport let a: Int = 1\n"] as const;
  const NESTED = ["/g.hex", "module Render.Geometry\nexport let b: Int = 1\n"] as const;

  test("an unnamed project's modules lie at the output root, dotted segments as directories", () => {
    expect(projectPaths([MAIN, NESTED])).toEqual(["/Main.hex", "/Render/Geometry.hex"]);
  });

  /**
   * §6's one asymmetry, and the reason it is written down: "*the full name
   * (§2.3) as a path, **with the project's package segment elided because a
   * project may have none***". A project that gains a `name` moves no file and
   * changes no specifier — only its modules' full names gain the segment.
   */
  test("a named project's modules lie at the root too — the package segment is elided", () => {
    expect(projectPaths([MAIN, NESTED], { packageName: "MyApp" })).toEqual([
      "/Main.hex",
      "/Render/Geometry.hex",
    ]);
  });

  test("the full name keeps the segment the layout drops", () => {
    const named = compileFiles([MAIN, NESTED], { packageName: "MyApp" });
    expect(named.modules.filter(({ name }) => !name.startsWith("Hex.")).map(({ name }) => name))
      .toEqual(["MyApp.Main", "MyApp.Render.Geometry"]);
  });

  test("the prelude specifier's depth follows the emitted file, named project or not", () => {
    for (const options of [{}, { packageName: "MyApp" }]) {
      const project = compileFiles(
        [
          ["/m.hex", "module Main\nexport let a: String = show(1)\n"],
          ["/g.hex", "module Render.Geometry\nexport let b: String = show(1)\n"],
        ],
        options,
      );
      const of = (name: string): string =>
        project.modules.find((module) => module.name.endsWith(name))!.javascript.text;
      expect(of("Main")).toContain('"./Hex/');
      expect(of("Render.Geometry")).toContain('"../Hex/');
    }
  });

  /**
   * The collision probe claims root-level names, so it can only work while the
   * project's modules are *at* the root (`runtimeDeclarationsBasename`). A
   * named project whose modules emitted under `MyApp/` would leave the probe
   * unable to fire at all.
   */
  test("a project module named `Hex` moves the generated runtime file, named project or not", () => {
    for (const options of [{}, { packageName: "MyApp" }]) {
      const project = compileFiles(
        [
          ["/hex.hex", "module Hex_\nexport let a: Int = 1\n"],
          ["/main.hex", "module Hex\nexport let b: Int = 1\n"],
        ],
        options,
      );
      expect(project.modules.some(({ path }) => path === "/Hex.hex")).toBe(true);
    }
  });
});

describe("Modules §11.1 / FFI Part 4 §2.1 — a foreign specifier is emitted verbatim", () => {
  /** The specifiers one module's emitted JavaScript imports from. */
  function specifiers(javascript: string): readonly string[] {
    return [...javascript.matchAll(/from\s+"([^"]+)"|^import\s+"([^"]+)"/gmu)]
      .map(([, from, bare]) => from ?? bare!);
  }

  test("a dotted module's relative specifier is copied, not re-based", () => {
    // `Deep/Nested.js` names `Deep/world.js`, which Hexagon neither writes nor
    // places: the specifier is JavaScript's own and resolves from the emitted
    // file (FFI Part 4 §2.1, #839).
    const project = compileFiles([[
      "/n.hex",
      "module Deep.Nested\n\n" +
      'extern from "./world.js"\n    fun boom(): Int\n' +
      "export let n: Int = boom()\n",
    ]]);
    const nested = project.modules.find(({ name }) => name === "Deep.Nested")!;
    expect(nested.path).toBe("/Deep/Nested.hex");
    expect(specifiers(nested.javascript.text)).toContain("./world.js");
  });

  test("a module whose source sits in a subdirectory keeps its specifier too", () => {
    const project = compileFiles([[
      "/src/app.hex",
      "module Main\n\n" +
      'extern import "./register.js"\n' +
      "export let n: Int = 1\n",
    ]]);
    const main = project.modules.find(({ name }) => name === "Main")!;
    expect(main.path).toBe("/Main.hex");
    expect(specifiers(main.javascript.text)).toContain("./register.js");
  });

  test("a bare specifier is copied verbatim as well", () => {
    const project = compileFiles([[
      "/n.hex",
      "module Deep.Nested\n\n" +
      'extern from "tiny-json"\n    fun parse(s: String): Int\n' +
      'export let n: Int = parse("1")\n',
    ]]);
    expect(specifiers(project.modules.find(({ name }) => name === "Deep.Nested")!.javascript.text))
      .toContain("tiny-json");
  });
});
