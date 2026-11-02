/**
 * Conformance for Zero-Cost Fundamental Exports' one-variable rule (§3.2 step
 * 1) and §8.3's copies on demand (#1438).
 *
 * An export with two or more constrained type variables publishes no
 * specialization. A Hexagon call to it that instantiates every constrained
 * variable at a fundamental type reaches a **copy** instead: the export
 * instantiated at that one tuple, dictionary-free, emitted in the declaring
 * module under a reserved `__` spelling, exported for Hexagon importers and
 * declared in no `.d.ts`. A copy exists only at a tuple some call uses.
 *
 * The exporter cannot see its callers, so the copies a module writes are the
 * ones its importers report (`JavaScript.copyDemands`). That is a channel a
 * clean compile can get wrong in silence: an importer that calls a copy its
 * exporter never wrote compiles clean and fails at load. So most rows here run
 * the graph rather than read it, and each executed graph is made byte-distinct
 * (`distinct`), since the module registry caches by text.
 */

import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";
import { emitJavaScript } from "../passes/emitter/emitter.js";
import type { CompiledModule } from "../project.js";
import { STDLIB_SOURCES } from "../stdlib-sources.js";

function distinct(label: string): (path: string, javascript: string) => string {
  return (_path, javascript) => `// ${label}\n${javascript}`;
}

function compiled(
  files: readonly (readonly [string, string])[],
): (path: string) => CompiledModule {
  const project = compileFiles(files);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return (path) => {
    const module = project.modules.find(({ source, path: address }) =>
      source.path === path || address === path
    );
    if (module === undefined) {
      throw new Error(
        `no emitted module at ${path}; emitted: ${
          project.modules.map(({ path: address }) => address).join(", ")
        }`,
      );
    }
    return module;
  };
}

/** The `__`-spelled functions a module defines whose names start with `stem`. */
function copiesIn(javascript: string, stem: string): readonly string[] {
  return [...javascript.matchAll(new RegExp(`^function (__${stem}_\\w+)\\(`, "gmu"))]
    .map((match) => match[1]!);
}

const PAIR = "module Pair\n\n" +
  'export let pair<a: Show, b: Show>(x: a, y: b): String = "${x}|${y}"\n';

describe("an export with two constrained variables", () => {
  test("publishes no specialization and is listed as having no typed entry point", () => {
    const module = compiled([["/pair.hex", PAIR]])("/pair.hex");

    expect(module.javascript.text).not.toMatch(/function pair[A-Z]/u);
    expect(module.javascript.text).not.toMatch(/export \{ pair[A-Z]/u);
    expect(module.declarations.text).not.toContain("pair");
    expect(module.declarations.zeroEntryPointExports).toEqual(["pair"]);
    // No call, so no copy: §8.3 item 2.
    expect(copiesIn(module.javascript.text, "pair")).toEqual([]);
    expect(module.javascript.generatedSections).toEqual([]);
  });

  test("still publishes all seven specializations of a one-variable export beside it", () => {
    const module = compiled([[
      "/pair.hex",
      PAIR + 'export let one<a: Show>(x: a): String = "${x}"\n',
    ]])("/pair.hex");

    expect(
      module.javascript.generatedSections.map(({ generatedName }) => generatedName),
    ).toEqual(["oneNat", "oneInt", "oneFloat", "oneBigInt", "oneBool", "oneString", "oneUnit"]);
  });
});

describe("a call from another module at fundamental types", () => {
  const files = [
    ["/pair.hex", PAIR],
    [
      "/main.hex",
      "module Main\n\nimport Pair\n\n" +
        'export let answer: String = Pair.pair(1, "x")\n',
    ],
  ] as const;

  test("reaches the one copy it uses, which its exporter writes and exports", () => {
    const module = compiled(files);
    const pair = module("/pair.hex").javascript;
    const main = module("/main.hex").javascript;

    expect(main.text).toContain('const answer = __pair_IntString(1, "x");');
    expect(main.text).toMatch(/import \{[^}]*\b__pair_IntString\b[^}]*\} from "\.\/Pair\.js";/u);
    expect(main.copyDemands).toEqual([
      { specifier: "./Pair", module: "Pair", term: "pair", types: ["Int", "String"] },
    ]);

    expect(copiesIn(pair.text, "pair")).toEqual(["__pair_IntString"]);
    expect(pair.text).toContain("export { __pair_IntString };");
    // Dictionary-free: no evidence parameter and no member dispatch.
    expect(pair.text).toContain(
      'function __pair_IntString(x, y) {\n  return String(x) + "|" + y;\n}',
    );
    // Linkage, not surface: no `.d.ts` row, and no specialization row in §10's
    // report, where it is a copy row instead.
    expect(module("/pair.hex").declarations.text).not.toContain("__pair");
    expect(pair.generatedSections.map(({ kind, generatedName, typeArguments }) => ({
      kind,
      generatedName,
      typeArguments,
    }))).toEqual([
      { kind: "Copy", generatedName: "__pair_IntString", typeArguments: ["Int", "String"] },
    ]);
  });

  test("computes what the generic edition would have", async () => {
    const exports = await runProject(files, { transform: distinct("copies: cross-module") });
    expect(exports["answer"]).toBe("1|x");
  });

  test("keeps the tuple's order when two calls use the same types the other way round", async () => {
    const both = [
      ["/pair.hex", PAIR],
      [
        "/main.hex",
        "module Main\n\nimport Pair\n\n" +
          'export let first: String = Pair.pair(1, "x")\n' +
          'export let second: String = Pair.pair("y", 2)\n',
      ],
    ] as const;
    const pair = compiled(both)("/pair.hex").javascript.text;
    expect(copiesIn(pair, "pair")).toEqual(["__pair_IntString", "__pair_StringInt"]);

    const exports = await runProject(both, { transform: distinct("copies: both orders") });
    expect(exports["first"]).toBe("1|x");
    expect(exports["second"]).toBe("y|2");
  });
});

describe("a copy demanded inside generated code", () => {
  test("is made for each tuple a one-variable export's specializations call it at", async () => {
    const files = [
      [
        "/pair.hex",
        PAIR + "export let tagged<c: Show>(z: c): String = pair(z, True)\n",
      ],
      [
        "/main.hex",
        "module Main\n\nimport Pair\n\n" +
          "export let answer: String = Pair.tagged(2.5)\n",
      ],
    ] as const;
    const pair = compiled(files)("/pair.hex").javascript.text;

    // Every specialization of `tagged` calls `pair` at `(c, Bool)`, so each of
    // `c`'s seven candidates demands one copy, and nothing else does.
    expect(copiesIn(pair, "pair")).toEqual([
      "__pair_NatBool",
      "__pair_IntBool",
      "__pair_FloatBool",
      "__pair_BigIntBool",
      "__pair_BoolBool",
      "__pair_StringBool",
      "__pair_UnitBool",
    ]);
    expect(pair).toContain("function taggedFloat(z) {\n  return __pair_FloatBool(z, true);\n}");

    const exports = await runProject(files, { transform: distinct("copies: in specializations") });
    expect(exports["answer"]).toBe("2.5|True");
  });

  test("follows a copy's own calls, in its module and across an import", async () => {
    const files = [
      [
        "/inner.hex",
        "module Inner\n\n" +
          'export let inner<a: Show, b: Show>(x: a, y: b): String = "<${x},${y}>"\n',
      ],
      [
        "/outer.hex",
        "module Outer\n\nimport Inner\n\n" +
          "export let middle<a: Show, b: Show>(x: a, y: b): String = Inner.inner(y, x)\n" +
          "export let outer<a: Show, b: Show>(x: a, y: b): String = middle(x, y)\n",
      ],
      [
        "/main.hex",
        "module Main\n\nimport Outer\n\n" +
          'export let answer: String = Outer.outer(7, "q")\n',
      ],
    ] as const;
    const module = compiled(files);

    expect(copiesIn(module("/outer.hex").javascript.text, "outer")).toEqual(["__outer_IntString"]);
    expect(copiesIn(module("/outer.hex").javascript.text, "middle")).toEqual([
      "__middle_IntString",
    ]);
    expect(module("/outer.hex").javascript.text).toContain(
      "function __outer_IntString(x, y) {\n  return __middle_IntString(x, y);\n}",
    );
    // `middle` swaps its arguments, so the copy it demands of `inner` is at
    // the swapped tuple.
    expect(copiesIn(module("/inner.hex").javascript.text, "inner")).toEqual([
      "__inner_StringInt",
    ]);

    const exports = await runProject(files, { transform: distinct("copies: chained") });
    expect(exports["answer"]).toBe("<q,7>");
  });

  test("is made once when the same module calls its own export", async () => {
    const files = [[
      "/main.hex",
      "module Main\n\n" + PAIR.replace("module Pair\n\n", "") +
        'export let a: String = pair(1, "x")\n' +
        'export let b: String = pair(2, "y")\n',
    ]] as const;
    const main = compiled(files)("/main.hex").javascript.text;

    expect(copiesIn(main, "pair")).toEqual(["__pair_IntString"]);
    expect(main).toContain('const a = __pair_IntString(1, "x");');
    expect(main).toContain('const b = __pair_IntString(2, "y");');

    const exports = await runProject(files, { transform: distinct("copies: own module") });
    expect(exports["a"]).toBe("1|x");
    expect(exports["b"]).toBe("2|y");
  });
});

describe("acceptance test (l): constraints only fundamental types honor", () => {
  // §16(l): fundamental evidence alone triggers `shift`'s generic edition
  // (§4.1, §13.4), which is its typed entry point once Algorithm G is emitted.
  // It is not yet (see #1442), so what is pinned here is today's emission: no
  // specialization, no `.d.ts` face, its entry in the zero-entry-point list (an
  // emission fact; see build-report-obligations.test.ts), and the copy.
  test("publish no specialization, and a Hexagon call still reaches a copy", async () => {
    const files = [[
      "/main.hex",
      "module Main\n\n" +
        "export let shift<a: Bitwise, n: Integral>(x: a, by: n): a =\n" +
        "    if by > Integral.div(by, by) then Bitwise.shiftLeft(x, 1) else x\n" +
        "export let answer: Int = shift(1, 2)\n",
    ]] as const;
    const main = compiled(files)("/main.hex");

    expect(main.declarations.zeroEntryPointExports).toEqual(["shift"]);
    expect(main.declarations.text).not.toContain("shift");
    expect(main.javascript.text).toContain(
      "function __shift_IntInt(x, by) {\n" +
        "  return by > __Integral_Int_div(by, by) ? __Bitwise_Int_shiftLeft(x, 1) : x;\n}",
    );
    expect(main.javascript.text).toContain("const answer = __shift_IntInt(1, 2);");

    const exports = await runProject(files, { transform: distinct("copies: test (l)") });
    expect(exports["answer"]).toBe(2);
  });
});

describe("a call that is not at fundamental types", () => {
  test("keeps its trailing evidence, and demands no copy", () => {
    const module = compiled([
      ["/pair.hex", PAIR],
      [
        "/main.hex",
        "module Main\n\nimport Pair\n\n" +
          "export let answer(v: Vector(Int)): String = Pair.pair(v, 1)\n" +
          // Private, so it has no specializations to make the call concrete.
          "let open<t: Show>(x: t): String = Pair.pair(x, 1)\n" +
          "export let used: String = open(())\n",
      ],
    ]);
    const main = module("/main.hex").javascript;

    expect(main.copyDemands).toEqual([]);
    expect(main.text).toMatch(/const answer = v => __pair\(v, 1, \w+, __Show_Int\);/u);
    expect(copiesIn(module("/pair.hex").javascript.text, "pair")).toEqual([]);
  });
});

describe("a tuple outside the exporter's candidates", () => {
  /**
   * §8.3 item 2 asks §3.2 step 2's judgment, and a prelude module answers it
   * from its own seat (Modules §5.5): `Vector.hex` is seated before
   * `String.hex`, so a `Vector` export has no `String` candidate. A trusted
   * replacement of `Vector.hex` gives it a two-variable export to show that on.
   */
  test("keeps trailing evidence, while a tuple inside them reaches a copy", () => {
    const project = compileFiles([
      [
        "/Vector.hex",
        STDLIB_SOURCES["Vector"]! +
          "\nexport let both<a: Ord, b: Ord>(x: a, y: b): Bool = x <= x and y <= y\n",
      ],
      [
        "/main.hex",
        "module Main\n\n" +
          'export let outside: Bool = Vector.both("a", 1)\n' +
          "export let inside: Bool = Vector.both(2, 1)\n",
      ],
    ], { trustedStandardLibraryModules: new Set(["Vector"]) });
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!.javascript;
    const vector = project.modules.find(({ source }) => source.path === "/Vector.hex")!.javascript;

    expect(main.text).toContain('const outside = both("a", 1, __Ord_String, __Ord_Int);');
    expect(main.text).toContain("const inside = __both_IntInt(2, 1);");
    expect(main.copyDemands).toEqual([
      { specifier: "./Hex/Vector", module: "Hex.Vector", term: "both", types: ["Int", "Int"] },
    ]);
    expect(copiesIn(vector.text, "both")).toEqual(["__both_IntInt"]);

    // An importer plans from the exporter's own seat, so it never demands such a
    // tuple; a host that hands one over anyway gets a compiler defect, and no copy.
    const seat = project.modules.find(({ source }) => source.path === "/Vector.hex")!;
    const handed = emitJavaScript(seat.core, {
      exportInstanceEvidence: true,
      runtimes: seat.runtimes,
      dataOnlyHomes: seat.dataOnlyHomes,
      fundamentalInstances: project.fundamentalSeats.get(seat.name) ?? project.fundamentalInstances,
      fundamentalSeats: project.fundamentalSeats,
      copyDemand: new Map([["both", [["String", "Int"], ["Int", "Int"]]]]),
    });
    expect(handed.diagnostics.map(({ message }) => message)).toEqual([
      "compiler defect: another module demands a copy of `both` at `(String, Int)`, " +
        "which its candidate types do not admit",
    ]);
    expect(copiesIn(handed.text, "both")).toEqual(["__both_IntInt"]);
  });
});

describe("a copy's spelling", () => {
  test("probes past an export that holds the preferred one, on both sides", async () => {
    const files = [
      [
        "/pair.hex",
        PAIR + "export let pair_IntString<a: Show>(x: a): String = \"${x}!\"\n",
      ],
      [
        "/main.hex",
        "module Main\n\nimport Pair\n\n" +
          'export let answer: String = Pair.pair(1, "x")\n' +
          'export let other: String = Pair.pair_IntString(True)\n',
      ],
    ] as const;
    const module = compiled(files);

    expect(copiesIn(module("/pair.hex").javascript.text, "pair")).toEqual([
      "__pair_IntString_1",
    ]);
    expect(module("/main.hex").javascript.text).toContain(
      'const answer = __pair_IntString_1(1, "x");',
    );

    const exports = await runProject(files, { transform: distinct("copies: probed spelling") });
    expect(exports["answer"]).toBe("1|x");
    expect(exports["other"]).toBe("True!");
  });
});

describe("an exporter's text", () => {
  // Two importers demand different copies of `eqs`, and each copy's body
  // hoists a dictionary on first use, so the order bodies render in shows in
  // the text. Swapping the importers swaps the order the demands arrive in.
  const pair = [
    "/pair.hex",
    "module Pair\n\n" +
      "export let eqs<a: Eq, b: Eq>(x: a, y: b): Bool = [x] == [x] and Some(y) == Some(y)\n",
  ] as const;
  const a = ["/a.hex", 'module A\n\nimport Pair\n\nexport let a: Bool = Pair.eqs(1.5, "x")\n'] as const;
  const b = ["/b.hex", "module B\n\nimport Pair\n\nexport let b: Bool = Pair.eqs(1, 2)\n"] as const;
  const main = [
    "/main.hex",
    "module Main\n\nimport A\nimport B\n\nexport let r: Bool = A.a and B.b\n",
  ] as const;

  test("is the same whichever importer's demand arrives first", async () => {
    const one = compiled([pair, a, b, main])("/pair.hex").javascript.text;
    const two = compiled([pair, b, a, main])("/pair.hex").javascript.text;

    expect(copiesIn(one, "eqs")).toEqual(["__eqs_IntInt", "__eqs_FloatString"]);
    expect(two).toBe(one);

    const exports = await runProject([pair, b, a, main], { transform: distinct("copies: arrival order") });
    expect(exports["r"]).toBe(true);
  });
});

describe("§10's report of a module with copies", () => {
  test("lists a copy where it sits, beside its export and ahead of a later export's editions", () => {
    // The copy is rendered after every edition but placed beside `pair`, which
    // is declared first; the report lists rows in text order, so the copy leads.
    const module = compiled([
      ["/pair.hex", PAIR + 'export let one<a: Show>(x: a): String = "${x}"\n'],
      ["/main.hex", 'module Main\n\nimport Pair\n\nexport let answer: String = Pair.pair(1, "x")\n'],
    ])("/pair.hex").javascript;
    const sections = module.generatedSections;

    expect(sections.map(({ kind, generatedName }) => `${kind} ${generatedName}`)).toEqual([
      "Copy __pair_IntString",
      ...["Nat", "Int", "Float", "BigInt", "Bool", "String", "Unit"]
        .map((type) => `FundamentalSpecialization one${type}`),
    ]);
    for (const [index, section] of sections.entries()) {
      expect(module.text.slice(section.startOffset, section.endOffset))
        .toMatch(new RegExp(`^function ${section.generatedName}\\(`, "u"));
      if (index > 0) expect(section.startOffset).toBeGreaterThanOrEqual(sections[index - 1]!.endOffset);
    }
    expect(sections[0]).toMatchObject({ sourceName: "pair", typeArguments: ["Int", "String"] });
  });
});

describe("a copy whose spelling its own module also imports", () => {
  // `Mid` imports `Pair`'s copy `__pair_IntString` and also declares its own
  // `pair`, whose copy at the same tuple has the same spelling. Whichever is
  // claimed first keeps the local; the other is probed, and its import or
  // export line aliases it, so every importer still finds the spelling it
  // computes.
  const tagged = (tag: string) =>
    `export let pair<a: Show, b: Show>(x: a, y: b): String = "${tag}\${x}|\${y}"\n`;
  const pair = ["/pair.hex", "module Pair\n\n" + tagged("P:")] as const;
  const mid = [
    "/mid.hex",
    "module Mid\n\nimport Pair\n\n" + tagged("M:") +
      'export let fromPair: String = Pair.pair(1, "x")\n' +
      'export let own: String = pair(1, "y")\n',
  ] as const;

  test("is bound under a probed local and exported under its spelling", async () => {
    // Only `Mid`'s own call demands its copy, after the import took the local.
    const files = [
      pair,
      mid,
      ["/main.hex", 'module Main\n\nimport Mid\n\nexport let r: String = Mid.fromPair ++ " " ++ Mid.own\n'],
    ] as const;
    const text = compiled(files)("/mid.hex").javascript.text;

    expect(text).toContain('import { __pair, __pair_IntString } from "./Pair.js";');
    expect(copiesIn(text, "pair")).toEqual(["__pair_IntString_1"]);
    expect(text).toContain('const own = __pair_IntString_1(1, "y");');
    expect(text).toContain("export { __pair_IntString_1 as __pair_IntString };");

    const exports = await runProject(files, { transform: distinct("copies: aliased export") });
    expect(exports["r"]).toBe("P:1|x M:1|y");
  });

  test("keeps its spelling where another module demands it, and the import is aliased", async () => {
    // `Main`'s demand is claimed before any of `Mid`'s bodies render.
    const files = [
      pair,
      mid,
      [
        "/main.hex",
        "module Main\n\nimport Mid\n\n" +
          'export let r: String = Mid.fromPair ++ " " ++ Mid.own ++ " " ++ Mid.pair(1, "z")\n',
      ],
    ] as const;
    const module = compiled(files);
    const text = module("/mid.hex").javascript.text;

    expect(text).toContain(
      'import { __pair, __pair_IntString as __pair_IntString_1 } from "./Pair.js";',
    );
    expect(copiesIn(text, "pair")).toEqual(["__pair_IntString"]);
    expect(text).toContain('const fromPair = __pair_IntString_1(1, "x");');
    expect(text).toContain("export { __pair_IntString };");
    expect(module("/main.hex").javascript.text).toContain('__pair_IntString(1, "z")');

    const exports = await runProject(files, { transform: distinct("copies: aliased import") });
    expect(exports["r"]).toBe("P:1|x M:1|y M:1|z");
  });
});

describe("a copy of a prelude export", () => {
  const calling = [[
    "/main.hex",
    "module Main\n\n" +
      'export let answer: Option((String, Int)) = Map.max(Map.fromEntries([("a", 1), ("b", 2)]))\n',
  ]] as const;
  const quiet = [[
    "/main.hex",
    "module Main\n\nexport let answer: Bool = Map.isEmpty(Map.fromEntries([(1, 2)]))\n",
  ]] as const;

  test("is written into the prelude module only for the program that calls it", () => {
    const map = (files: readonly (readonly [string, string])[]): string =>
      compiled(files)("/Hex/Map.hex").javascript.text;

    // The order is the point: the standard library's emission is cached across
    // compiles, and a cached `Map.js` carrying one program's copies, or a
    // program re-using a copy-free one, would each be wrong in silence.
    expect(copiesIn(map(quiet), "max")).toEqual([]);
    expect(copiesIn(map(calling), "max")).toEqual(["__max_StringInt"]);
    expect(copiesIn(map(quiet), "max")).toEqual([]);
    expect(copiesIn(map(calling), "max")).toEqual(["__max_StringInt"]);
  });

  test("is not in `Map`'s `.d.ts`, which has no `max` face at all", () => {
    const map = compiled(calling)("/Hex/Map.hex");
    expect(map.declarations.text).not.toMatch(/\bmax(?:[A-Z]\w*)?\(/u);
    expect(map.declarations.zeroEntryPointExports).toEqual(
      expect.arrayContaining(["max", "min"]),
    );
  });

  test("computes the greatest entry", async () => {
    const exports = await runProject(calling, { transform: distinct("copies: prelude Map.max") });
    expect(exports["answer"]).toEqual({ tag: "Some", value: ["b", 2] });
  });
});
