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
 * - the emitter read the same absence as the bare-string representation an
 *   all-nullary union then had, so a payload-carrying union's match compiled to
 *   a switch over the scrutinee value against `case "Dot"` where the value is
 *   `{tag: "Dot"}` — the case never matched and every `Dot` took the wrong arm.
 *   That third symptom cannot recur in that form since #771 retired the string
 *   representation: there is one shape, and the emitter reads a tag whether or
 *   not it found the declaration. The registration still decides the arms'
 *   payload field names and the derived instances, so it is pinned below.
 *
 * The repair is #587's program-nominals materialization extended to unions: the
 * home declaration is registered lazily from the program table at the seats that
 * miss, stamped as an imported copy is, and carried in the typed module so the
 * emitter's constructor table answers from it too.
 *
 * Witness spelling is bare-name **parity** with the reached case, deliberately:
 * whether a witness should say where the name is declared is one message-design
 * question across every route the constructor door does not reach, and it is
 * #607.
 *
 * Imports bind modules, never names smaller than one (#762): every fixture
 * below reaches `./a` and `./b` through a module alias. A constructor pattern's
 * head still reads bare — #763's door supplies it from the scrutinee's expected
 * type, with no import of the constructor's home module required at all — so
 * only *expression*-position constructions and type annotations need the
 * alias's dot; pattern heads stay bare throughout.
 */

/** `union Flag = On | Off`, and a maker in a second module whose result carries it. */
const FLAG = [
  ["/a.hex", "export union Flag = On | Off\n"],
  [
    "/b.hex",
    "import A from \"./a\"\n" +
    "export fun make(): A.Flag = A.On\n",
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
        "import B from \"./b\"\n" +
        "export fun probe(): Int =\n" +
        "    match B.make()\n" +
        "        _ => 1\n",
      ],
    ])).toEqual([]);
  });

  test("a reached union's missing constructor is named (#605 symptom 2)", () => {
    expect(diagnostics([
      ...FLAG,
      [
        "/main.hex",
        "import B from \"./b\"\n" +
        "export fun probe(): Int =\n" +
        "    match B.make()\n" +
        "        On => 1\n",
      ],
    ])).toEqual([
      // #607, respelled for #762: the witness prints the bare spelling with no
      // route clause at all — #763's door reaches `Off` in a pattern from the
      // scrutinee's expected type alone, with no import of `./a` required, so
      // §7.3's route-clause tiers have nothing left to add here. (They still
      // exist for the one case the door cannot help: a bare spelling this
      // module's own scope has taken for something else, so the door's
      // "scope first" rule would resolve it wrong — see the coverage-tiers
      // fixtures that cover that shadowing directly.)
      "match is missing cases: `Off`",
    ]);
  });

  test("a reached union's missing payload carries its slot witness", () => {
    expect(diagnostics([
      ["/a.hex", "export union Shape = Dot | Circle(radius: Float)\n"],
      [
        "/b.hex",
        "import A from \"./a\"\n" +
        "export fun make(): A.Shape = A.Dot\n",
      ],
      [
        "/main.hex",
        "import B from \"./b\"\n" +
        "export fun probe(): Int =\n" +
        "    match B.make()\n" +
        "        Dot => 1\n",
      ],
    ])).toEqual([
      "match is missing cases: `Circle(_)`",
    ]);
  });

  test("the already-aliased case reports the same missing cases — the door, not the import, decides", () => {
    // `Flag` is imported here, so this module always had a row for it, before
    // and after #762. The repaired lazy-registration route (symptom 2, above)
    // prints exactly what this prints — that parity is the ruling — and #763
    // sharpens *why*: the bare spelling a witness prints comes from the door,
    // which reads the pattern's expected type, not from whether this module
    // happens to hold an alias for the constructor's home module too.
    expect(diagnostics([
      ["/a.hex", "export union Flag = On | Off\n"],
      [
        "/main.hex",
        "import A from \"./a\"\n" +
        "export fun probe(f: A.Flag): Int =\n" +
        "    match f\n" +
        "        On => 1\n",
      ],
    ])).toEqual([
      "match is missing cases: `Off`",
    ]);
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
        "import A from \"./a\"\n" +
        "export fun probe(): Int =\n" +
        "    match A.make()\n" +
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
        "import A from \"./a\"\n" +
        "export fun probe(): Int =\n" +
        "    match A.make()\n" +
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
    // The pattern has to resolve to a real symbol *without* going through the
    // door for that seat to be exercised at all — the door reads the expected
    // type first and `String` is not a union, so a bare `On` would only draw
    // the closed door's "has no constructor" refusal. Scope answers instead:
    // `A.On`, qualified through the alias, resolves at name resolution and
    // never asks the door at all (§763: "scope first").
    const messages = diagnostics([
      ["/a.hex", "export union Flag = On | Off\n"],
      [
        "/main.hex",
        "import A from \"./a\"\n" +
        "export fun probe(s: String): Int =\n" +
        "    match s\n" +
        "        A.On => 1\n" +
        "        _ => 2\n",
      ],
    ]);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toMatch(/String/u);
    expect(messages[0]).toMatch(/Flag/u);
  });
});

describe("the emitter reads a reached union from the same declaration", () => {
  test("a reached payload-carrying union's arms compile and run (#605 symptom 4)", async () => {
    // Textually distinct from the harness below on purpose: byte-identical
    // emitted JavaScript shares one module instance across the `data:` URL cache.
    const exports = await runProject([
      ["/a.hex", "export union Shape = Dot | Circle(radius: Float)\n"],
      [
        "/b.hex",
        "import A from \"./a\"\n" +
        "export fun dot(): A.Shape = A.Dot\n" +
        "export fun circle(r: Float): A.Shape = A.Circle(r)\n",
      ],
      [
        "/main.hex",
        "import B from \"./b\"\n" +
        "export let atDot: Int =\n" +
        "    match B.dot()\n" +
        "        Dot => 11\n" +
        "        Circle(r) => 12\n" +
        "export let atCircle: Int =\n" +
        "    match B.circle(1.5)\n" +
        "        Dot => 21\n" +
        "        Circle(r) => 22\n",
      ],
    ]);
    expect(exports.atDot).toBe(11);
    expect(exports.atCircle).toBe(22);
  });

  test("a reached union of nullary constructors runs without a `RangeError`", async () => {
    const exports = await runProject([
      ["/a.hex", "export union Signal = Red | Green\n"],
      [
        "/b.hex",
        "import A from \"./a\"\n" +
        "export fun red(): A.Signal = A.Red\n" +
        "export fun green(): A.Signal = A.Green\n",
      ],
      [
        "/main.hex",
        "import B from \"./b\"\n" +
        "export let atRed: Int =\n" +
        "    match B.red()\n" +
        "        Red => 7\n" +
        "        Green => 8\n" +
        "export let atGreen: Int =\n" +
        "    match B.green()\n" +
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
        "import B from \"./b\"\n" +
        "export fun probe(): Int =\n" +
        "    match B.make()\n" +
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
        "import A from \"./a\"\n" +
        "export fun pass(): A.Pair = A.make()\n" +
        "export fun probe(): Int =\n" +
        "    match pass()\n" +
        "        (f, n) =>\n" +
        "            match f\n" +
        "                _ => n\n",
      ],
    ])).toEqual([]);
  });
});
