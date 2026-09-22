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
import { moduleInterface } from "./passes/resolver/resolver.js";

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

/** A module exporting a pattern called `boxed`, for the collision below. */
function boxing(name: string): readonly [string, string] {
  return [
    `/${name.toLowerCase()}.hex`,
    `module ${name}\n\nexport record ${name} = {value: Int}\n` +
    `export pattern boxed(value: Int): ${name}\n` +
    `    view(b) = b.value\n` +
    `    build(value) = ${name}({value = value})\n`,
  ];
}

/**
 * Two doors of one pattern name, which refuses with a "choose `…`" fix — the
 * one fix `validatePatternFixes` proves by compiling the whole program again,
 * from inside the compile that raised it.
 */
const COLLIDING_PATTERNS: readonly (readonly [string, string])[] = [
  boxing("Alpha"),
  boxing("Beta"),
  main("import Alpha\nimport Beta\n\nexport let value: Int = (1)boxed\n"),
];

describe("one standard library per process", () => {
  test("library imports determine the shared checking and emission order", () => {
    resetStandardLibraryCache();
    const body = main(
      "import Hex.Experimental.File as File\n" +
      "import Hex.Experimental.Node.File as NodeFile\n\n" +
      "export let read(path: String): String = File.readText!(path)\n" +
      "export let raw(path: String): String = NodeFile.readText!(path)\n",
    );
    const cold = compileFiles([body]);
    expect(messagesOf(cold)).toEqual([]);
    const names = cold.modules.map(({ name }) => name);
    expect(names.indexOf("Hex.Experimental.Node.File"))
      .toBeLessThan(names.indexOf("Hex.Experimental.File"));
    const snapshot = (project: CompiledProject) => project.modules.map((module) => ({
      name: module.name,
      javascript: module.javascript.text,
      declarations: module.declarations.text,
    }));
    const before = standardLibraryCacheStatistics();
    const warm = compileFiles([body]);
    expect(messagesOf(warm)).toEqual([]);
    expect(snapshot(warm)).toEqual(snapshot(cold));
    const after = standardLibraryCacheStatistics();
    expect(after.seatsParsed - before.seatsParsed).toBe(0);
    expect(after.seatsChecked - before.seatsChecked).toBe(0);
    expect(after.seatsReused - before.seatsReused).toBe(SEATS);
    expect(after.emissionsReused - before.emissionsReused).toBe(SEATS);
  });

  test("project import order does not perturb independent library seats", () => {
    resetStandardLibraryCache();
    const body = (first: string, second: string) => main(
      `import Hex.${first} as First\n` +
      `import Hex.${second} as Second\n\n` +
      "export let n: Int = 1\n",
    );
    expect(messagesOf(compileFiles([body("Rat", "Experimental.File")]))).toEqual([]);
    const before = standardLibraryCacheStatistics();
    expect(messagesOf(compileFiles([body("Experimental.File", "Rat")]))).toEqual([]);
    const after = standardLibraryCacheStatistics();
    expect(after.seatsChecked - before.seatsChecked).toBe(0);
    expect(after.seatsParsed - before.seatsParsed).toBe(0);
    expect(after.seatsReused - before.seatsReused).toBe(SEATS);
  });

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
      seatsParsed: SEATS,
      seatsEmitted: SEATS,
      emissionsReused: 2 * SEATS,
    });
  });

  test("`compiles` counts the host's compiles, not the fix validation inside one", () => {
    // A refusal carrying fixes makes `validatePatternFixes` compile the whole
    // program again from inside this call, with the same injected list — and
    // how many of those a refusal needs is a fact about its fixes.
    resetStandardLibraryCache();
    expect(messagesOf(compileFiles(COLLIDING_PATTERNS))).toEqual([
      "pattern `boxed` is exported by `Alpha` and `Beta`; declare a private pattern alias to choose one",
    ]);
    const after = standardLibraryCacheStatistics();
    // The re-entries happened — or the count above would say nothing.
    expect(after.seatsReused).toBeGreaterThan(0);
    expect(after.compiles).toBe(1);
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

describe("one chain, whatever the project is called", () => {
  test("alternating package names reuse every seat", () => {
    // A seat is keyed by its layout address, and the package name decides
    // nothing else about an injected module — so a host that opens one session
    // per project directory keeps the chain across every switch between them.
    resetStandardLibraryCache();
    const first = compileFiles([main("export let n: Int = 1\n")], { packageName: "Alpha" });
    expect(messagesOf(first)).toEqual([]);
    const warm = standardLibraryCacheStatistics();
    expect(warm.seatsChecked).toBe(SEATS);

    // The unnamed project is one of the alternatives: a host that names none
    // of its projects and one that names them all share the chain too.
    for (const packageName of ["Beta", undefined, "Alpha", "Beta"]) {
      const project = compileFiles(
        [main("export let n: Int = 1\n")],
        packageName === undefined ? {} : { packageName },
      );
      expect(messagesOf(project)).toEqual([]);
    }
    const after = standardLibraryCacheStatistics();
    expect(after.seatsChecked - warm.seatsChecked).toBe(0);
    expect(after.seatsReused - warm.seatsReused).toBe(4 * SEATS);
    expect(after.emissionsReused - warm.emissionsReused).toBe(4 * SEATS);
  });

  test("a project named `Hex` moves every member, and re-seats the chain", () => {
    // The one thing the name does decide: `Hex` elides its own segment, so the
    // members lie at `/Option.hex` rather than `/Hex/Option.hex` (Packages §6)
    // and no cached seat is at the address this compile asks for.
    resetStandardLibraryCache();
    const body = main("export let some: Option(Int) = Some(3)\n");
    expect(messagesOf(compileFiles([body]))).toEqual([]);
    const warm = standardLibraryCacheStatistics();

    const named = compileFiles([body], { packageName: "Hex" });
    expect(messagesOf(named)).toEqual([]);
    expect(named.modules.map(({ path }) => path)).toContain("/Option.hex");
    const after = standardLibraryCacheStatistics();
    expect(after.seatsChecked - warm.seatsChecked).toBe(SEATS);
    expect(after.seatsReused - warm.seatsReused).toBe(0);
  });
});

describe("a trusted replacement invalidates from its own seat", () => {
  test("an edited library import reorders seats and rebuilds the changed suffix", () => {
    resetStandardLibraryCache();
    const body = main(
      "import Hex.Experimental.File as File\n" +
      "import Hex.Experimental.Node.File as NodeFile\n\n" +
      "export let n: Int = File.answer\n" +
      "export let raw(path: String): String = NodeFile.readText!(path)\n",
    );
    const original = LIBRARY_MODULES.find(({ name }) => name === "Experimental.File")!;
    const replacement = supplied(original)[0];
    const withImport = `${original.source}\nexport let answer: Int = 1\n`;
    const withoutImport = "module Experimental.File\n\nexport let answer: Int = 2\n";
    const compile = (source: string) => compileFiles([
      [replacement, source], body,
    ], { trustedStandardLibraryModules: new Set([original.name]) });
    const result = (project: CompiledProject) => ({
      diagnostics: messagesOf(project),
      modules: project.modules.map(({ name, javascript, declarations }) => ({
        name, javascript: javascript.text, declarations: declarations.text,
      })),
    });

    const originalResult = result(compile(withImport));
    expect(originalResult.diagnostics).toEqual([]);
    const before = standardLibraryCacheStatistics();
    const changed = compile(withoutImport);
    expect(messagesOf(changed)).toEqual([]);
    const names = changed.modules.map(({ name }) => name);
    expect(names.indexOf("Hex.Experimental.File"))
      .toBeLessThan(names.indexOf("Hex.Experimental.Node.File"));
    const after = standardLibraryCacheStatistics();
    expect(after.seatsChecked - before.seatsChecked).toBeGreaterThan(1);
    expect(after.seatsReused - before.seatsReused).toBeLessThan(SEATS);
    expect(after.seatsParsed - before.seatsParsed).toBe(0);
    const warmChanged = result(compile(withoutImport));
    expect(warmChanged).toEqual(result(changed));
    expect(standardLibraryCacheStatistics().seatsChecked - after.seatsChecked).toBe(0);
    resetStandardLibraryCache();
    expect(result(compile(withoutImport))).toEqual(warmChanged);
    // Restoring the original edge must recover the original ordering and
    // emitted identities, regardless of the cache chain's intervening shape.
    expect(result(compile(withImport))).toEqual(originalResult);
    resetStandardLibraryCache();
    expect(result(compile(withImport))).toEqual(originalResult);
  });

  test("a cyclic trusted library replacement cannot leave reusable seats", () => {
    resetStandardLibraryCache();
    const original = LIBRARY_MODULES.find(({ name }) => name === "Experimental.File")!;
    const cyclic = compileFiles([
      [supplied(original)[0],
        "module Experimental.File\nimport Experimental.File as Self\nexport let answer: Int = 1\n"],
      main("export let n: Int = 1\n"),
    ], { trustedStandardLibraryModules: new Set([original.name]) });
    expect(messagesOf(cyclic).some((message) => message.includes("import cycle"))).toBe(true);
    expect(standardLibraryCacheStatistics().seats).toBe(0);
    const repeated = compileFiles([
      [supplied(original)[0],
        "module Experimental.File\nimport Experimental.File as Self\nexport let answer: Int = 1\n"],
      main("export let n: Int = 1\n"),
    ], { trustedStandardLibraryModules: new Set([original.name]) });
    expect(messagesOf(repeated)).toEqual(messagesOf(cyclic));
    expect(standardLibraryCacheStatistics().seats).toBe(0);
    expect(standardLibraryCacheStatistics().seatsReused).toBe(0);
  });

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

  test("a rebuilt seat is re-checked, never re-read and re-parsed", () => {
    // Parsing is a function of the file alone, so it does not follow the
    // reusable prefix: replacing the *first* member re-checks every seat after
    // it, and not one of them is lexed again — the chain hands each its file
    // and its tree, which is also what makes a reused seat's `parsed` the very
    // tree the compiled module carries.
    resetStandardLibraryCache();
    const body = main(
      "export let some: Option(Int) = Some(3)\n" +
      "export let shown: String = show(1)\n",
    );
    const first = compileFiles([body]);
    expect(messagesOf(first)).toEqual([]);
    // Every member lexed and parsed exactly once, the chain having been empty.
    // Counted rather than read off `project.modules`, which holds the members
    // this program *reached* — five of the forty-five for this body.
    expect(standardLibraryCacheStatistics().seatsParsed).toBe(SEATS);

    const member = PRELUDE_MODULES[0]!;
    const rebuilt = compileFiles(
      [supplied(member), body],
      { trustedStandardLibraryModules: new Set([member.name]) },
    );
    expect(messagesOf(rebuilt)).toEqual([]);
    // And not one of them a second time: the replaced member is a file of the
    // project's own, and the forty-four seats re-checked behind it read their
    // trees off the chain.
    expect(standardLibraryCacheStatistics().seatsParsed).toBe(SEATS);

    const trees = (project: CompiledProject) =>
      new Map(project.modules
        .filter(({ name }) => name.startsWith("Hex.") && name !== `Hex.${member.name}`)
        .map(({ path, parsed }) => [path, parsed] as const));
    const [before, after] = [trees(first), trees(rebuilt)];
    const shared = [...before.keys()].filter((path) => after.has(path));
    // Every member the second compile surfaced, not merely some of them.
    expect(new Set(shared)).toEqual(new Set(after.keys()));
    expect(shared.length).toBeGreaterThan(0);
    for (const path of shared) expect(after.get(path)).toBe(before.get(path));
  });

  test("an edited replacement re-seats its member, at the file the last one came from", () => {
    // The seat's key holds its **text**, not only its file: a host that edits a
    // standard-library source and compiles again hands the same file identity
    // at the same path, and the seat built from the previous text answers for
    // nothing. Written as a visible export rather than as a counter, so the
    // pin is what the second compile can *see*.
    resetStandardLibraryCache();
    const member = LIBRARY_MODULES.at(-1)!;
    const compile = (source: string) =>
      compileFiles([
        [supplied(member)[0], source],
        main(
          `import ${member.name}\n\n` +
          `export let added: Int = ${member.name}.addedByThisTest\n`,
        ),
      ], { trustedStandardLibraryModules: new Set([member.name]) });

    expect(messagesOf(compile(member.source)).length).toBeGreaterThan(0);
    expect(messagesOf(compile(`${member.source}\nexport let addedByThisTest: Int = 7\n`)))
      .toEqual([]);
  });

  test("a verbatim replacement at the member's own address is still the host's file", () => {
    // The seat's key holds its **file identity** as well as its text and its
    // two addresses, and this is the one compile where the other three cannot
    // answer: a host developing the standard library hands the member's own
    // source, unedited, at the very path the embedded one is read from. Only
    // the identity differs — the host's, from its own allocator — and taking
    // the seat would hand the program the *embedded* module under the host's
    // file, so every span the replacement owns would resolve to the wrong one.
    resetStandardLibraryCache();
    const member = LIBRARY_MODULES.at(-1)!;
    const body = main(`import ${member.name}\n\nexport let x: Int = 1\n`);
    const embedded = compileFiles([body]).modules
      .find(({ name }) => name === `Hex.${member.name}`)!;
    // The address the replacement is about to be supplied at, read from the
    // compiler rather than spelled here, and an identity out of the reserved
    // range because that is what the chain holds.
    expect(Number(embedded.source.id)).toBeGreaterThanOrEqual(1_000_000);

    const replaced = compileFiles(
      [[embedded.source.path, member.source], body],
      { trustedStandardLibraryModules: new Set([member.name]) },
    );
    expect(messagesOf(replaced)).toEqual([]);
    expect(Number(
      replaced.modules.find(({ name }) => name === `Hex.${member.name}`)!.source.id,
    )).toBe(0);
  });
});

describe("a seat's emission is bounded by the stems it is asked for", () => {
  /**
   * A root module named `Hex` claims the `hex` stem, so §8.3's probe settles on
   * `hex1`; adding one named `Hex1` pushes it to `hex2`. Three distinct stems
   * is one more than a seat keeps.
   */
  const CLAIMS_HEX = ["/one.hex", "module Hex\n\nexport let z: Int = 0\n"] as const;
  const CLAIMS_HEX1 = ["/two.hex", "module Hex1\n\nexport let z: Int = 0\n"] as const;
  const BODY = main("export let n: Int = 1\n");

  test("a third stem evicts the oldest, and the other two are still there", () => {
    resetStandardLibraryCache();
    let last = standardLibraryCacheStatistics();
    /** Whether this compile emitted the injected seats or reused them. */
    const emitted = (files: readonly (readonly [string, string])[]): boolean => {
      expect(messagesOf(compileFiles(files))).toEqual([]);
      const now = standardLibraryCacheStatistics();
      const built = now.seatsEmitted - last.seatsEmitted;
      const reused = now.emissionsReused - last.emissionsReused;
      last = now;
      expect(built + reused).toBe(SEATS);
      return built === SEATS;
    };

    expect(emitted([BODY])).toBe(true);
    expect(emitted([CLAIMS_HEX, BODY])).toBe(true);
    expect(emitted([CLAIMS_HEX, CLAIMS_HEX1, BODY])).toBe(true);
    // `hex1` and `hex2` are the two the seats hold …
    expect(emitted([CLAIMS_HEX, BODY])).toBe(false);
    // … and `hex`, the oldest, was evicted when the third arrived.
    expect(emitted([BODY])).toBe(true);
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

  /**
   * Programs that **refuse**, with the message each one owes.
   *
   * A refusal reads inputs a clean compile never asks for, and both of these
   * walk the shared module set: the first asks whether `import Rat` would
   * resolve here (Modules §5.1 rule 1's repair clause), the second asks which
   * modules export a pattern of this name and which of those the program could
   * import. The third refuses with a "choose `…`" fix, which
   * `validatePatternFixes` proves by compiling the whole program again from
   * inside this compile — against the same frozen chain.
   */
  const REFUSALS: readonly (readonly [
    readonly (readonly [string, string])[],
    readonly string[],
  ])[] = [
    [[main("export let n: Int = Rat.zero\n")], ["no module alias `Rat`; `import Rat`"]],
    [[
      ["/box.hex",
        "module Box\n\n" +
        "export record Box = {value: Int}\n" +
        "export pattern boxed(value: Int): Box\n" +
        "    view(box) = box.value\n" +
        "    build(value) = Box({value = value})\n"],
      main("export let value: Int = (1)boxed\n"),
    ], ["no `boxed` here; `import Box`"]],
    [COLLIDING_PATTERNS, [
      "pattern `boxed` is exported by `Alpha` and `Beta`; declare a private pattern alias to choose one",
    ]],
  ];

  test("a frozen prefix survives the corpus", () => {
    // Every structure the cache keeps refuses mutation from here on, `Map` and
    // `Set` contents included, so a write anywhere downstream fails at the
    // write rather than as a wrong answer three compiles later.
    resetStandardLibraryCache({ freezeEntries: true });
    try {
      // Twice: the second pass is the one every seat is already frozen for.
      for (let pass = 0; pass < 2; pass += 1) {
        for (const files of CORPUS) {
          expect(messagesOf(compileFiles(files))).toEqual([]);
        }
        for (const [files, messages] of REFUSALS) {
          expect(messagesOf(compileFiles(files))).toEqual(messages);
        }
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
      // The `ModuleInterface` beside them, which is not reached through the
      // seat at all: it is the resolver's memo, keyed by the tree the chain
      // keeps alive, and handed to **every** importer of this member in every
      // compile after. `newStandardLibrarySeat` seals it where it seals the
      // tree, and nothing else would.
      expect(() =>
        (moduleInterface(member.resolved).terms as Map<string, unknown>).set("anything", 0)
      ).toThrow(TypeError);

      // Neither the corpus nor the refusals replaces a member, and a trusted
      // replacement is the one route that hands a **cached** tree back to
      // resolve, check and elaborate: the seats after the replaced one are
      // built again, each over the frozen file and tree `gatherModules` reads
      // off the chain for it.
      const warm = standardLibraryCacheStatistics();
      const option = PRELUDE_MODULES.find(({ name }) => name === "Option")!;
      expect(messagesOf(replacing(option))).toEqual([]);
      const fromOption = standardLibraryCacheStatistics().seatsChecked - warm.seatsChecked;
      // `Option`'s own seat and every seat after it, and none before.
      expect(fromOption).toBeGreaterThan(1);
      expect(fromOption).toBeLessThan(SEATS);

      // And seat zero's, which re-checks the whole list over frozen trees.
      expect(messagesOf(replacing(PRELUDE_MODULES[0]!))).toEqual([]);
      const after = standardLibraryCacheStatistics();
      expect(after.seatsChecked - warm.seatsChecked - fromOption).toBe(SEATS);
      // One member re-read across both: the `Option` seat the compile before
      // left holding a supplied file. The other forty-four came off the chain.
      expect(after.seatsParsed - warm.seatsParsed).toBe(1);
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
