import { describe, expect, test } from "vitest";

import * as Source from "./support/source.js";
import { compileFiles } from "./support/test-project.js";
import {
  compileProject,
  resetStandardLibraryCache,
  standardLibraryCacheStatistics,
  STANDARD_LIBRARY_MODULE_NAMES,
  type CompiledProject,
} from "./project.js";
import { LIBRARY_MODULES, PRELUDE_MODULES } from "./prelude.js";

/**
 * The standard-library cache (#987): `compileProject` checks and emits the
 * members of `Hex` once per process and hands the same structures to every
 * compile after.
 *
 * Every pin here is structural. `architecture/testing.md` §8 forbids wall-clock
 * thresholds in correctness tests, and the claims worth protecting are not
 * about duration anyway: that the answer does not change, that the work is not
 * repeated, that a trusted replacement invalidates exactly its own seat and the
 * seats after it, and that nothing downstream writes to what is shared.
 */

/** The injected list's length — prelude, runtime and library members alike. */
const SEATS = STANDARD_LIBRARY_MODULE_NAMES.length;

function main(body: string): readonly [string, string] {
  return ["/main.hex", `module Main\n\n${body}`];
}

function messagesOf(project: CompiledProject): readonly string[] {
  return project.diagnostics.map(({ message }) => message);
}

/** A registered member supplied as a project file, for a trusted replacement. */
function supplied(
  member: { readonly name: string; readonly source: string },
): readonly [string, string] {
  return [`/${member.name.replaceAll(".", "-")}.hex`, member.source];
}

function replacing(
  member: { readonly name: string; readonly source: string },
): CompiledProject {
  return compileFiles([supplied(member), main("export let x: Int = 1\n")], {
    trustedStandardLibraryModules: new Set([member.name]),
  });
}

describe("one standard library per process", () => {
  test("two projects are handed the same members, emitted byte for byte", () => {
    resetStandardLibraryCache();
    const first = compileFiles([main(
      "export let n: Int = 1\nexport let shown: String = show(n)\n",
    )]);
    // Three files against one, so a member's identity that followed the
    // project's file count rather than its own seat would move here.
    const second = compileFiles([
      ["/shapes.hex", "module Shapes\n\nexport union Shape = Circle(r: Float) | Square(n: Float)\n"],
      ["/labels.hex", "module Labels\n\nexport fun label(n: Int): String = show(n)\n"],
      main(
        "import Shapes\n" +
        "import Labels\n\n" +
        "export let shown: String = Labels.label(2)\n" +
        "export let some: Option(Int) = Some(3)\n" +
        "export let round: Shapes.Shape = Shapes.Circle(1.0)\n",
      ),
    ]);
    expect(messagesOf(first)).toEqual([]);
    expect(messagesOf(second)).toEqual([]);

    const injected = (project: CompiledProject) =>
      new Map(project.modules
        .filter(({ name }) => name.startsWith("Hex."))
        .map(({ path, javascript, declarations }) =>
          [path, { javascript: javascript.text, declarations: declarations.text }] as const
        ));
    const [before, after] = [injected(first), injected(second)];
    const shared = [...before.keys()].filter((path) => after.has(path));
    expect(shared.length).toBeGreaterThan(0);
    for (const path of shared) expect(after.get(path)).toEqual(before.get(path));

    // The members' file identities are a fact about the members, and the
    // project's own is what a compile with no standard library would give it.
    const identities = (project: CompiledProject) =>
      new Map(project.modules.map(({ path, source }) => [path, Number(source.id)]));
    const [firstIds, secondIds] = [identities(first), identities(second)];
    for (const path of shared) expect(secondIds.get(path)).toBe(firstIds.get(path));
    const own = (project: CompiledProject) =>
      project.modules
        .filter(({ name }) => !name.startsWith("Hex."))
        .map(({ source }) => Number(source.id));
    for (const project of [first, second]) {
      const ids = own(project);
      // Numbered from zero, exactly as a compile with no standard library
      // would have numbered them, and below every woven member's.
      expect([...ids].sort((left, right) => left - right))
        .toEqual(ids.map((_, at) => at));
      const members = [...(project === first ? firstIds : secondIds)]
        .flatMap(([path, id]) => shared.includes(path) ? [id] : []);
      expect(Math.min(...members)).toBeGreaterThan(Math.max(...ids));
    }
  });

  test("the standard library is checked once, however many projects compile", () => {
    resetStandardLibraryCache();
    for (
      const body of [
        "export let n: Int = 1\n",
        "export record Point = {x: Float, y: Float}\n",
        "export let names: Vector(String) = [\"a\"]\n",
      ]
    ) {
      expect(messagesOf(compileFiles([main(body)]))).toEqual([]);
    }
    expect(standardLibraryCacheStatistics()).toEqual({
      compiles: 3,
      seats: SEATS,
      seatsChecked: SEATS,
      seatsReused: 2 * SEATS,
      seatsEmitted: SEATS,
      emissionsReused: 2 * SEATS,
    });
  });

  test("the shipped standard library compiles clean, so every seat is kept", () => {
    // The cache keeps clean seats only, so a member that started reporting
    // would switch the cache off from its seat onward and nothing else would
    // say so.
    resetStandardLibraryCache();
    expect(messagesOf(compileFiles([main("export let n: Int = 1\n")]))).toEqual([]);
    expect(standardLibraryCacheStatistics().seats).toBe(SEATS);
  });
});

describe("a trusted replacement invalidates from its own seat", () => {
  test("the last member's replacement rebuilds one seat and reuses the rest", () => {
    resetStandardLibraryCache();
    expect(messagesOf(compileFiles([main("export let n: Int = 1\n")]))).toEqual([]);
    const warm = standardLibraryCacheStatistics();

    const last = LIBRARY_MODULES.at(-1)!;
    expect(messagesOf(replacing(last))).toEqual([]);
    const after = standardLibraryCacheStatistics();
    expect(after.seatsChecked - warm.seatsChecked).toBe(1);
    expect(after.seatsReused - warm.seatsReused).toBe(SEATS - 1);
    expect(after.seats).toBe(SEATS);
    // Emission is the whole prefix's or nobody's: `fundamentalInstances` is
    // read off every prelude module, so one rebuilt seat can change what any
    // of them plans.
    expect(after.emissionsReused - warm.emissionsReused).toBe(0);
  });

  test("an earlier member's replacement rebuilds more of the list than a later one's", () => {
    const rebuilt = (member: { readonly name: string; readonly source: string }): number => {
      resetStandardLibraryCache();
      compileFiles([main("export let n: Int = 1\n")]);
      const warm = standardLibraryCacheStatistics();
      expect(messagesOf(replacing(member))).toEqual([]);
      return standardLibraryCacheStatistics().seatsChecked - warm.seatsChecked;
    };
    const first = rebuilt(PRELUDE_MODULES[0]!);
    const last = rebuilt(LIBRARY_MODULES.at(-1)!);
    expect(last).toBe(1);
    expect(first).toBeGreaterThan(last);
  });

  test("a replacement that reports is not kept, and neither is anything after it", () => {
    resetStandardLibraryCache();
    compileFiles([main("export let n: Int = 1\n")]);
    const last = LIBRARY_MODULES.at(-1)!;
    const broken = compileFiles([
      [supplied(last)[0], `${last.source}\nlet ruined: Int = "not an Int"\n`],
      main("export let n: Int = 1\n"),
    ], { trustedStandardLibraryModules: new Set([last.name]) });
    expect(messagesOf(broken).length).toBeGreaterThan(0);
    expect(standardLibraryCacheStatistics().seats).toBe(SEATS - 1);
  });
});

describe("nothing downstream writes to the cached prefix", () => {
  /**
   * Programs chosen to reach the families that share structure with the
   * prelude: unions and their constructors, records and their companions,
   * declared constraints and instances at both a project type and a primitive,
   * exceptions across a module boundary, the foreign boundary, patterns, and
   * the runtime collections.
   */
  const CORPUS: readonly (readonly (readonly [string, string])[])[] = [
    [main(
      "export union Shape = Circle(radius: Float) | Square(side: Float)\n" +
      "export fun area(s: Shape): Float =\n" +
      "    match s\n" +
      "        Circle(r) => r * r * 3.0\n" +
      "        Square(n) => n * n\n" +
      "export fun label<a: Show>(x: a): String = show(x)\n",
    )],
    [
      ["/box.hex",
        "module Box\n\n" +
        "export record Box = {n: Float}\n" +
        "export fun double(value: Box): Box = Box({n = value.n * 2.0})\n" +
        "export fun reading(value: Box): Float = value.n\n"],
      main("import Box\n\nexport let out: Float = Box.reading(Box.Box({n = 1.5}).double())\n"),
    ],
    [main(
      "constraint Label<a> =\n" +
      "    label(subject: a) -> String\n" +
      "\n" +
      "record Room = {number: Int}\n" +
      "\n" +
      "honor Label<Room> =\n" +
      "    label(r) = \"room ${r.number}\"\n" +
      "\n" +
      "honor Label<Int> =\n" +
      "    label(n) = show(n)\n" +
      "\n" +
      "export fun describe<a: Label>(x: a): String = label(x)\n" +
      "export let room: String = describe(Room({number = 12}))\n" +
      "let counted: Int = 4\n" +
      "export let four: String = describe(counted)\n",
    )],
    [
      ["/errors.hex", "module Errors\n\nexport exception Boom(code: Int)\n"],
      main(
        "import Errors\n\n" +
        "export fun go(): Int =\n" +
        "    try\n" +
        "        throw(Errors.Boom(1))\n" +
        "    catch\n" +
        "        Errors.Boom(c) => c\n",
      ),
    ],
    [main(
      "extern from \"./raw.js\"\n" +
      "    fun raw() ->! JsValue\n" +
      "\n" +
      "export let loose: JsValue = raw!()\n" +
      "export record Envelope = { payload: JsValue }\n",
    )],
    [main(
      "export let numbers: Vector(Int) = [1, 2, 3]\n" +
      "export let counted: Int = Vector.length(numbers)\n" +
      "export let mapped: Map(String, Int) = Map.empty\n",
    )],
  ];

  test("a frozen prefix survives the corpus", () => {
    // Every structure the cache keeps refuses mutation from here on, `Map` and
    // `Set` contents included, so a write anywhere downstream fails at the
    // write rather than as a wrong answer three compiles later.
    resetStandardLibraryCache({ freezeEntries: true });
    try {
      for (const files of CORPUS) {
        expect(messagesOf(compileFiles(files))).toEqual([]);
      }
      // A second pass over the same programs, now that every seat is frozen.
      for (const files of CORPUS) {
        expect(messagesOf(compileFiles(files))).toEqual([]);
      }
      expect(standardLibraryCacheStatistics().seatsChecked).toBe(SEATS);

      // The hook has to be freezing something, or the pin above holds
      // vacuously — and the `Map` is the half `Object.freeze` cannot do.
      const member = compileFiles(CORPUS[0]!).modules
        .find(({ name }) => name.startsWith("Hex."))!;
      expect(Object.isFrozen(member.typed)).toBe(true);
      expect(Object.isFrozen(member.javascript)).toBe(true);
      expect(() => (member.runtimes as Map<string, unknown>).set("Anything", "self"))
        .toThrow(TypeError);
    } finally {
      resetStandardLibraryCache();
    }
  });
});

describe("the reserved file-identity range", () => {
  test("a host identity inside it is refused", () => {
    expect(() =>
      compileProject([
        new Source.File(Source.fileId(1_000_000), "/main.hex", "module Main\n\nlet n: Int = 1\n"),
      ])
    ).toThrow(/file identities must be below/u);
  });
});
