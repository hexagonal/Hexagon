import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for a union that reaches a module **only through an imported
 * function's type** — Modules §4.2's import-insensitivity read over unions, and
 * #605's repair.
 *
 * Registration was keyed on the import of the type *name*: `module.unions`
 * carries what this module declared and what its imports named, so a union
 * arriving as an imported function's result — `make()` where nothing here writes
 * `Flag` — had no row in the checker's tables at all. Four judgments answered
 * from that absence, and none of them abstained:
 *
 * - the coverage column took the arms *as* the signature, so a live trailing `_`
 *   read as dead and a genuinely non-exhaustive match passed in silence;
 * - constructor-pattern typing missed `#constructorUnions` and returned having
 *   unified nothing, so a union constructor pattern against a `String` scrutinee
 *   was accepted;
 * - the emitter read the same absence as *untagged*, so a tagged union's match
 *   compiled to a switch over the scrutinee value against `case "Dot"` where the
 *   value is `{tag: "Dot"}` — the case never matched and every `Dot` took the
 *   wrong arm.
 *
 * The repair is #587's program-nominals materialization extended to unions: the
 * home declaration is registered lazily from the program table at the seats that
 * miss, stamped as an imported copy is, and carried in the typed module so the
 * emitter's constructor table and tagging judgment answer from it too.
 *
 * Witness spelling is bare-name **parity** with the import case, deliberately:
 * whether a witness should say where the name is declared is one message-design
 * question across both routes, and it is #607.
 */

/** `union Flag = On | Off`, and a maker in a second module whose result carries it. */
const FLAG = [
  ["/a.hex", "export union Flag = On | Off\n"],
  [
    "/b.hex",
    "import { Flag, On } from \"./a\"\n" +
    "export fun make(): Flag = On\n",
  ],
] as const;

/** Every diagnostic message a multi-file project produced, in order. */
function diagnostics(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

describe("the coverage column answers from the reached declaration", () => {
  test("a lone `_` over a reached union is live (#605 symptom 1)", () => {
    expect(diagnostics([
      ...FLAG,
      [
        "/main.hex",
        "import { make } from \"./b\"\n" +
        "export fun probe(): Int =\n" +
        "    match make()\n" +
        "        _ => 1\n",
      ],
    ])).toEqual([]);
  });

  test("a reached union's missing constructor is named (#605 symptom 2)", () => {
    expect(diagnostics([
      ...FLAG,
      [
        "/main.hex",
        "import { make } from \"./b\"\n" +
        "import { On } from \"./a\"\n" +
        "export fun probe(): Int =\n" +
        "    match make()\n" +
        "        On => 1\n",
      ],
    ])).toEqual(["match is missing cases: `Off`"]);
  });

  test("a reached union's missing payload carries its slot witness", () => {
    expect(diagnostics([
      ["/a.hex", "export union Shape = Dot | Circle(radius: Float)\n"],
      [
        "/b.hex",
        "import { Shape, Dot } from \"./a\"\n" +
        "export fun make(): Shape = Dot\n",
      ],
      [
        "/main.hex",
        "import { make } from \"./b\"\n" +
        "import { Dot } from \"./a\"\n" +
        "export fun probe(): Int =\n" +
        "    match make()\n" +
        "        Dot => 1\n",
      ],
    ])).toEqual(["match is missing cases: `Circle(_)`"]);
  });

  test("the already-shipped partial-import case is unchanged", () => {
    // `Flag` is imported here, so this module always had the row. The repaired
    // route prints exactly what this prints — that parity is the ruling.
    expect(diagnostics([
      ["/a.hex", "export union Flag = On | Off\n"],
      [
        "/main.hex",
        "import { Flag, On } from \"./a\"\n" +
        "export fun probe(f: Flag): Int =\n" +
        "    match f\n" +
        "        On => 1\n",
      ],
    ])).toEqual(["match is missing cases: `Off`"]);
  });

  test("a reached `opaque` union still admits its catch-all", () => {
    // §4.2 withholds the representation, not the type. A `_` arm names nothing
    // the opacity hides, and it is the whole of the match's exhaustiveness.
    expect(diagnostics([
      [
        "/a.hex",
        "opaque union Flag = On | Off\n" +
        "export fun make(): Flag = On\n",
      ],
      [
        "/main.hex",
        "import { make } from \"./a\"\n" +
        "export fun probe(): Int =\n" +
        "    match make()\n" +
        "        _ => 1\n",
      ],
    ])).toEqual([]);
  });

  test("a private union carried abroad adds nothing to the escape report", () => {
    // The other route into the un-registered column, and the one that stays a
    // question of a program already being refused: §4.3 reports the escape at
    // the exporter, and the importer's match must not pile a second fault on it.
    const files = [
      [
        "/a.hex",
        "union Flag = On | Off\n" +
        "export fun make(): Flag = On\n",
      ],
      [
        "/main.hex",
        "import { make } from \"./a\"\n" +
        "export fun probe(): Int =\n" +
        "    match make()\n" +
        "        _ => 1\n",
      ],
    ] as const;
    expect(diagnostics(files)).toEqual([
      "exported binding `make` exposes private type `Flag`; " +
      "export the type, perhaps opaquely, or keep the binding private",
    ]);
    // The one report carries §4.3's secondary label, at the union's own
    // declaration in `/a.hex` — every member of the family does (#621).
    const [escape] = compileFiles(files).diagnostics;
    expect(escape?.labels?.map(({ message }) => message)).toEqual([
      "`Flag` is declared private here",
    ]);
    const label = escape!.labels![0]!.span;
    expect(files[0][1].slice(label.start.offset, label.end.offset)).toBe("Flag");
    // In `/a.hex`, not in the importer — the fix goes on the declaration.
    expect(label.fileId).toBe(escape!.primary.fileId);
    expect(label.start.line).toBe(0);
  });
});

describe("constructor-pattern typing answers from the reached declaration", () => {
  test("a reached constructor against a `String` scrutinee is a type error (#605 symptom 3)", () => {
    // No union type is expected at this pattern at all — the scrutinee is a
    // `String` — so the union has to be found from the constructor's own symbol
    // or the arm unifies nothing and the confusion is accepted in silence.
    const messages = diagnostics([
      ["/a.hex", "export union Flag = On | Off\n"],
      [
        "/main.hex",
        "import { On } from \"./a\"\n" +
        "export fun probe(s: String): Int =\n" +
        "    match s\n" +
        "        On => 1\n" +
        "        _ => 2\n",
      ],
    ]);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toMatch(/String/u);
    expect(messages[0]).toMatch(/Flag/u);
  });
});

describe("the emitter judges a reached union's tagging from the same declaration", () => {
  test("a reached tagged union's arms compile and run (#605 symptom 4)", async () => {
    // Textually distinct from the harness below on purpose: byte-identical
    // emitted JavaScript shares one module instance across the `data:` URL cache.
    const exports = await runProject([
      ["/a.hex", "export union Shape = Dot | Circle(radius: Float)\n"],
      [
        "/b.hex",
        "import { Shape, Dot, Circle } from \"./a\"\n" +
        "export fun dot(): Shape = Dot\n" +
        "export fun circle(r: Float): Shape = Circle(r)\n",
      ],
      [
        "/main.hex",
        "import { dot, circle } from \"./b\"\n" +
        "import { Dot, Circle } from \"./a\"\n" +
        "export let atDot: Int =\n" +
        "    match dot()\n" +
        "        Dot => 11\n" +
        "        Circle(r) => 12\n" +
        "export let atCircle: Int =\n" +
        "    match circle(1.5)\n" +
        "        Dot => 21\n" +
        "        Circle(r) => 22\n",
      ],
    ]);
    expect(exports.atDot).toBe(11);
    expect(exports.atCircle).toBe(22);
  });

  test("a reached untagged union's arms run without a `RangeError`", async () => {
    const exports = await runProject([
      ["/a.hex", "export union Signal = Red | Green\n"],
      [
        "/b.hex",
        "import { Signal, Red, Green } from \"./a\"\n" +
        "export fun red(): Signal = Red\n" +
        "export fun green(): Signal = Green\n",
      ],
      [
        "/main.hex",
        "import { red, green } from \"./b\"\n" +
        "import { Red, Green } from \"./a\"\n" +
        "export let atRed: Int =\n" +
        "    match red()\n" +
        "        Red => 7\n" +
        "        Green => 8\n" +
        "export let atGreen: Int =\n" +
        "    match green()\n" +
        "        Red => 9\n" +
        "        Green => 10\n",
      ],
    ]);
    expect(exports.atRed).toBe(7);
    expect(exports.atGreen).toBe(10);
  });

  test("the reaching module declares nothing the reached union brought", () => {
    // Registration is a checker table, not an emission inventory: the emitted
    // declarations walk `module.items`, which this module has none of.
    const compiled = compileFiles([
      ...FLAG,
      [
        "/main.hex",
        "import { make } from \"./b\"\n" +
        "export fun probe(): Int =\n" +
        "    match make()\n" +
        "        _ => 1\n",
      ],
    ]);
    expect(compiled.diagnostics).toEqual([]);
    const main = compiled.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(main.javascript.text).not.toMatch(/\bOn\b/u);
    expect(main.javascript.text).not.toMatch(/\bOff\b/u);
  });
});

describe("a reached union is still the importer's copy, for §4.3's reading", () => {
  test("an exported signature over a reached union is no escape", () => {
    // The alias is what puts the union in an exported signature without ever
    // naming it: `Pair` binds here, `Flag` does not, and the inner `match` is
    // what materializes it. The materialized copy is stamped
    // `representationVisible: false` exactly as an imported copy is, because
    // §4.3's check reads that flag as "this copy is the declaring module's own"
    // — a `true` here would refuse a public union as an escaping private type.
    expect(diagnostics([
      [
        "/a.hex",
        "export union Flag = On | Off\n" +
        "export type Pair = (Flag, Int)\n" +
        "export fun make(): Pair = (On, 1)\n",
      ],
      [
        "/main.hex",
        "import { Pair, make } from \"./a\"\n" +
        "export fun pass(): Pair = make()\n" +
        "export fun probe(): Int =\n" +
        "    match pass()\n" +
        "        (f, n) =>\n" +
        "            match f\n" +
        "                _ => n\n",
      ],
    ])).toEqual([]);
  });
});
