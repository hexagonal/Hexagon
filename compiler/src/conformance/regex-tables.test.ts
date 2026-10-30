import { beforeAll, describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project";
import regexRuntimeSource from "../../../stdlib/Runtime/Regex.hex?raw";

/**
 * The engine's two Unicode tables (`spec/regex.md` §7, #927 arc 3a), run
 * through the emitted JavaScript and checked against the `@unicode/unicode-17.0.0`
 * package the generator read: every stored property, every grouping and derived
 * set the helper builds, and the simple-fold orbits.
 *
 * As in `buffer.test.ts`, the specimen rides in the shipped
 * `stdlib/Runtime/Regex.hex`'s own text, trusted as the registered member, with
 * an importer so that the module is emitted.
 */
const PROBE_PATH = "/Regex.hex";
const TRUST_RUNTIME = { trustedStandardLibraryModules: new Set(["Runtime.Regex"]) } as const;
const TOUCH: readonly [string, string] = [
  "/Main.hex",
  "module Main\n\nimport Runtime.Regex\n\nexport let touched: Int = Regex.probe\n",
];

const PROBE = `
let kindOf(name: String): Syntax.PropertyKind = match name
    "GeneralCategory" => Syntax.GeneralCategory
    "Script" => Syntax.Script
    "ScriptExtensions" => Syntax.ScriptExtensions
    "Binary" => Syntax.Binary
    "Any" => Syntax.Any
    "Ascii" => Syntax.Ascii
    "Assigned" => Syntax.Assigned
    _ => Syntax.Word

export let ranges(kind: String, value: String): Vector((Int, Int)) = propertyRanges(kindOf(kind), value)
export let orbit(point: Int): Vector(Int) = foldOrbit(point)
export let probe: Int = 1
`;

// The package's data, read through Node's own loader: the compiler's type
// configuration carries no Node types, so the two modules are reached through
// `process.getBuiltinModule` with the narrow shapes used here.
interface NodeShim {
  readonly process: {
    cwd(): string;
    getBuiltinModule(name: "module"): { createRequire(path: string): (id: string) => unknown };
    getBuiltinModule(name: "fs"): {
      readdirSync(path: string, options: { withFileTypes: true }):
        readonly { readonly name: string; isDirectory(): boolean }[];
    };
  };
}
const { process } = globalThis as unknown as NodeShim;
const UNICODE = "@unicode/unicode-17.0.0";
const require = process.getBuiltinModule("module").createRequire(`${process.cwd()}/package.json`);
const directories = (family: string): readonly string[] =>
  process.getBuiltinModule("fs")
    .readdirSync(`${process.cwd()}/node_modules/${UNICODE}/${family}`, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map(({ name }) => name);
const pointsOf = (directory: string): readonly number[] =>
  require(`${UNICODE}/${directory}/code-points.js`) as number[];
const DATA = { get: (directory: string): unknown => require(`${UNICODE}/${directory}/code-points.js`) };

type Ranges = readonly (readonly [number, number])[];

/** Sorted inclusive ranges of `points`, the surrogate block carved out (§7). */
function rangesOf(points: Iterable<number>): Ranges {
  const ranges: [number, number][] = [];
  for (const point of [...points].sort((left, right) => left - right)) {
    if (point >= 0xD800 && point <= 0xDFFF) continue;
    const last = ranges.at(-1);
    if (last !== undefined && last[1] + 1 === point) last[1] = point;
    else ranges.push([point, point]);
  }
  return ranges;
}

const union = (...sets: readonly (readonly number[])[]): Ranges => rangesOf(new Set(sets.flat()));

let ranges: (kind: string, value: string) => Ranges;
let orbit: (point: number) => readonly number[];

beforeAll(async () => {
  const exports = await runProject(
    [[PROBE_PATH, `${regexRuntimeSource}\n${PROBE}`], TOUCH],
    { ...TRUST_RUNTIME, entry: PROBE_PATH },
  );
  const asArray = <T>(vector: unknown): T[] => [...(vector as Iterable<T>)];
  const rangesRow = exports.ranges as (kind: string, value: string) => unknown;
  const orbitRow = exports.orbit as (point: number) => unknown;
  ranges = (kind, value) => asArray<[number, number]>(rangesRow(kind, value));
  orbit = (point) => asArray<number>(orbitRow(point));
}, 60_000);

describe("`propertyRanges` (§7)", () => {
  // Both rows are `->`: a bare call compiles clean, where a `->~` row's would be
  // refused for its missing mark (as `buffer.test.ts` pins for `create`).
  test("the rows declare cleanly, and their calls wear no mark", () => {
    const project = compileFiles([[PROBE_PATH,
      `${regexRuntimeSource}\nlet pure(point: Int): Int =\n` +
      "    Vector.length(propertyRanges(Syntax.GeneralCategory, \"Lu\")) + Vector.length(foldOrbit(point))\n"]],
    TRUST_RUNTIME);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  });

  const LEAVES = ["Cc", "Cf", "Cn", "Co", "Cs", "Ll", "Lm", "Lo", "Lt", "Lu", "Mc", "Me", "Mn", "Nd",
    "Nl", "No", "Pc", "Pd", "Pe", "Pf", "Pi", "Po", "Ps", "Sc", "Sk", "Sm", "So", "Zl", "Zp", "Zs"];
  const LONG: Readonly<Record<string, string>> = {
    Cc: "Control", Cf: "Format", Cn: "Unassigned", Co: "Private_Use", Cs: "Surrogate",
    Ll: "Lowercase_Letter", Lm: "Modifier_Letter", Lo: "Other_Letter", Lt: "Titlecase_Letter",
    Lu: "Uppercase_Letter", Mc: "Spacing_Mark", Me: "Enclosing_Mark", Mn: "Nonspacing_Mark",
    Nd: "Decimal_Number", Nl: "Letter_Number", No: "Other_Number", Pc: "Connector_Punctuation",
    Pd: "Dash_Punctuation", Pe: "Close_Punctuation", Pf: "Final_Punctuation",
    Pi: "Initial_Punctuation", Po: "Other_Punctuation", Ps: "Open_Punctuation",
    Sc: "Currency_Symbol", Sk: "Modifier_Symbol", Sm: "Math_Symbol", So: "Other_Symbol",
    Zl: "Line_Separator", Zp: "Paragraph_Separator", Zs: "Space_Separator",
    L: "Letter", LC: "Cased_Letter", M: "Mark", N: "Number", P: "Punctuation", S: "Symbol",
    Z: "Separator", C: "Other",
  };

  test("every General_Category value and grouping, by its short name", () => {
    for (const value of [...LEAVES, "L", "LC", "M", "N", "P", "S", "Z", "C"]) {
      expect(ranges("GeneralCategory", value), value)
        .toEqual(rangesOf(pointsOf(`General_Category/${LONG[value]}`)));
    }
  });

  test("every Script and Script_Extensions value, by its long name", () => {
    expect(directories("Script").length).toBe(175);
    for (const name of directories("Script")) {
      expect(ranges("Script", name), name).toEqual(rangesOf(pointsOf(`Script/${name}`)));
    }
    for (const name of directories("Script_Extensions")) {
      expect(ranges("ScriptExtensions", name), name)
        .toEqual(rangesOf(pointsOf(`Script_Extensions/${name}`)));
    }
    // A Script value with no codepoints of its own in Unicode 17.0.0.
    expect(ranges("Script", "Katakana_Or_Hiragana")).toEqual([]);
  });

  test("the six binary properties", () => {
    for (const name of ["Alphabetic", "Uppercase", "Lowercase", "White_Space",
      "Noncharacter_Code_Point", "Default_Ignorable_Code_Point"]) {
      expect(ranges("Binary", name), name).toEqual(rangesOf(pointsOf(`Binary_Property/${name}`)));
    }
  });

  test("`Any` is the whole codepoint space; `ASCII` and `Assigned` and `Word` are derived", () => {
    expect(ranges("Any", "")).toEqual([[0, 0x10FFFF]]);
    expect(ranges("Ascii", "")).toEqual([[0, 0x7F]]);
    expect(ranges("Assigned", "")).toEqual(rangesOf(pointsOf("Binary_Property/Assigned")));
    expect(ranges("Word", "")).toEqual(union(
      pointsOf("Binary_Property/Alphabetic"),
      pointsOf("General_Category/Mark"),
      pointsOf("General_Category/Decimal_Number"),
      pointsOf("General_Category/Connector_Punctuation"),
      [0x200C, 0x200D],
    ));
  });

  test("no property but `Any` holds a surrogate (§2.4, §3.6)", () => {
    const touchesSurrogates = (set: Ranges): boolean =>
      set.some(([low, high]) => low <= 0xDFFF && high >= 0xD800);
    expect(ranges("GeneralCategory", "Cs")).toEqual([]);
    for (const value of ["C", "Cn", "L"]) expect(touchesSurrogates(ranges("GeneralCategory", value))).toBe(false);
    expect(touchesSurrogates(ranges("Assigned", ""))).toBe(false);
    expect(touchesSurrogates(ranges("Any", ""))).toBe(true);
  });

  test("an unknown name answers the empty vector", () => {
    expect(ranges("Script", "Klingon")).toEqual([]);
    expect(ranges("Binary", "ID_Start")).toEqual([]);
    // A prototype member's name is no table entry (the helper's tables are Maps).
    for (const value of ["toString", "constructor", "__proto__", "Lx"]) {
      expect(ranges("GeneralCategory", value), value).toEqual([]);
    }
    expect(ranges("Script", "constructor")).toEqual([]);
  });
});

describe("`foldOrbit` (§3.4)", () => {
  test("§3.4's examples: K, S, and ß", () => {
    expect(orbit(0x6B)).toEqual([0x4B, 0x6B, 0x212A]);
    expect(orbit(0x212A)).toEqual([0x4B, 0x6B, 0x212A]);
    expect(orbit(0x73)).toEqual([0x53, 0x73, 0x17F]);
    expect(orbit(0xDF)).toEqual([0xDF, 0x1E9E]);
    expect(orbit(0x31)).toEqual([0x31]);
  });

  test("every orbit is the class of simple foldings (statuses C and S), from every member", () => {
    const fold = new Map<number, number>([
      ...DATA.get("Case_Folding/C") as [number, number][],
      ...DATA.get("Case_Folding/S") as [number, number][],
    ]);
    const classes = new Map<number, Set<number>>();
    for (const [point, target] of fold) {
      const members = classes.get(target) ?? new Set([target]);
      members.add(point);
      classes.set(target, members);
    }
    for (const members of classes.values()) {
      const expected = [...members].sort((left, right) => left - right);
      for (const member of members) expect(orbit(member), String(member)).toEqual(expected);
    }
  });
});
