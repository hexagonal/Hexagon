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
      { specifier: "./Pair", term: "pair", types: ["Int", "String"] },
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
  test("publish no typed entry point, and a Hexagon call still reaches a copy", async () => {
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
      { specifier: "./Hex/Vector", term: "both", types: ["Int", "Int"] },
    ]);
    expect(copiesIn(vector.text, "both")).toEqual(["__both_IntInt"]);
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
