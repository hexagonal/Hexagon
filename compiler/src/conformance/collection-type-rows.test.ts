import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { INTRINSIC_INVENTORY } from "../intrinsics";
import { STDLIB_SOURCES } from "../stdlib-sources";
import { compileFiles, runMain } from "../support/test-project.js";

/**
 * Conformance for #1071: `Vector`, `Map`, and `Set` are declared by their
 * companions' **public** intrinsic `type` rows (`spec/intrinsics.md` §3.3,
 * §4.1). The row binds the name to the built-in kind the key names — the kind
 * is the key's one identity, which is why a vector literal is a `Vector` in
 * every module — and the name is then an ordinary declared type of its
 * companion: seeded by the prelude, reachable qualified, occludable, the home
 * the orphan rule reads, and a legal instance head.
 *
 * Elsewhere, beside what each pins already: the claims are checked at the row
 * against the representation records (`vector-trie-wiring.test.ts`,
 * `hash-trie-wiring.test.ts`); the faces name the companions' seats
 * (`runtime-collection-faces.test.ts`); and a same-named import still outranks
 * the prelude's type (`import-occludes-prelude-type.test.ts`).
 */

function diagnostics(source: string): readonly string[] {
  return compileFiles([["/main.hex", "module Main\n\n" + source]]).diagnostics
    .map(({ message }) => message);
}

describe("the rows (§3.3, §4.1)", () => {
  test.each([
    ["vector", "Vector", "export type vector as Vector(+a)", "Runtime.VectorTrie", "TrieVector"],
    ["map", "Map", "export type map as Map(+k, +v)", "Runtime.HashTrie", "HashTrie"],
    ["set", "Set", "export type set as Set(+a)", "Runtime.HashTrie", "HashSet"],
  ])("`%s` is public, declared by `Hex.%s` alone, over its record", (key, companion, row, module, record) => {
    expect(INTRINSIC_INVENTORY.get(key)).toMatchObject({
      grade: "type",
      declarers: [companion],
      reach: "public",
      kind: companion,
      representation: { module, record },
    });
    expect(STDLIB_SOURCES[companion]).toContain(`    ${row}\n`);
  });

  test("a public row is not confined: its companion exports it and nothing refuses", () => {
    const project = compileFiles([["/main.hex", "module Main\n\n" + "export let n: Int = Vector.length([1])\n"]]);
    expect(project.diagnostics).toEqual([]);
    const vector = project.modules.find(({ source }) => source.path === "/Hex/Vector.hex")!;
    const rows = vector.typed.items.flatMap((item) =>
      item.kind === "ExternBlock"
        ? item.declarations.filter((declaration) => declaration.kind === "ExternType")
        : []
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ localName: "Vector", exported: true });
    expect(rows[0]).not.toHaveProperty("confined");
  });

  test("a trusted module other than the companion may not declare a public key", () => {
    const refused = compileProject([
      new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + "export let ok: Int = 1\n"),
      new Source.File(
        Source.fileId(1),
        "/Debug.hex",
        "module Debug\n\n" + 'extern from "hex:intrinsic"\n' + "    type vector as V(+a)\n",
      ),
    ], { trustedStandardLibraryModules: new Set(["Debug"]) }).diagnostics
      .map(({ message }) => message);
    expect(refused).toEqual([
      "`vector` may be declared only in `Hex.Vector`; the type is reached from there, as `Vector`",
    ]);
  });
});

describe("every route to the name reaches the kind", () => {
  test("bare, through the prelude's seed", () => {
    expect(diagnostics(
      "export let v: Vector(Int) = [1]\n" +
        "export let m: Map(String, Int) = Map.empty\n" +
        "export let s: Set(Int) = Set.empty\n",
    )).toEqual([]);
  });

  /** The companion is the type's home, so `Vector.Vector` names it (#1071). */
  test("qualified through the companion", () => {
    expect(diagnostics(
      "export let v: Vector.Vector(Int) = [1]\n" +
        "export let m: Map.Map(String, Int) = Map.empty\n" +
        "export let s: Set.Set(Int) = Set.empty\n" +
        "export let both: Vector(Int) = Vector.append(v, 2)\n",
    )).toEqual([]);
  });

  test("each route states the kind's arity", () => {
    expect(diagnostics("export let v: Vector = [1]\n"))
      .toEqual(["type `Vector` expects 1 argument, but 0 were provided"]);
    expect(diagnostics("export let m: Map(Int) = Map.empty\n"))
      .toEqual(["type `Map` expects 2 arguments, but 1 were provided"]);
    expect(diagnostics("export let v: Vector.Vector(Int, Int) = [1]\n"))
      .toEqual(["type `Vector` expects 1 argument, but 2 were provided"]);
  });

  /**
   * The name is an ordinary declaration's, so a module's own `Vector` occludes
   * it (Modules §5.4): the export below refuses on the module's *private*
   * record, which only that record can draw.
   */
  test("a module's own declaration of the spelling wins", () => {
    expect(diagnostics(
      "record Vector(a) = { x: a }\n" + "export let v: Vector(Int) = Vector({ x = 1 })\n",
    )).toEqual([
      "exported binding `v` exposes private type `Vector`; export the type, " +
        "perhaps opaquely, or keep the binding private",
    ]);
  });
});

describe("the companion is the type's home (Constraints §4.4, §5.3)", () => {
  const DESCRIBE = "export constraint Describe<t> =\n    describe(x: t) -> String\n\n";

  /**
   * A program honors its own constraint at a declared collection exactly as at
   * any declared type: the head is lawful, and owning the constraint is the
   * orphan rule's other half. End to end, through a generic caller.
   */
  test("a program's own constraint is honored at all three", async () => {
    const main = await runMain(
      "module Main\n\n" + DESCRIBE +
        "honor<a: Show> Describe<Vector(a)> =\n    describe(x) = \"many: \" ++ show(x)\n\n" +
        "honor Describe<Map(k, v)> =\n    describe(m) = \"map\"\n\n" +
        "honor Describe<Set(a)> =\n    describe(s) = \"set\"\n\n" +
        "export fun twice<t: Describe>(x: t): String = describe(x) ++ describe(x)\n" +
        "export let one: String = describe([1, 2])\n" +
        "export let two: String = twice([[3]])\n" +
        "export let map: String = describe(Map.singleton(1, 2))\n" +
        "export let set: String = describe(Set.singleton(1))\n",
    );
    expect([main.one, main.two, main.map, main.set])
      .toEqual(["many: [1, 2]", "many: [[3]]many: [[3]]", "map", "set"]);
  });

  test("a head names the constructor applied to distinct variables, as any head does", () => {
    expect(diagnostics(DESCRIBE + "honor Describe<Vector(Int)> =\n    describe(x) = \"v\"\n"))
      .toEqual([
        "a parameterized instance head must be a nominal constructor applied once to each " +
          "distinct instance parameter",
      ]);
  });

  /**
   * The home, from the other side: the companion itself may honor a constraint
   * it does not declare at its own type, because its row *is* the declaration
   * the orphan rule asks for — the seat `honor Iterable<Vector(a)>` will take.
   * The same honor in a program is an orphan. `Concat` is used because no
   * compiler-provided row stands at `Vector` for it.
   */
  test("the declaring companion may honor a prelude constraint at its type; a program may not", () => {
    const CONCAT = "\nhonor Concat<Vector(a)> =\n    concat(left, right) = left\n";
    const companion = compileProject([
      new Source.File(
        Source.fileId(0),
        "/main.hex",
        "module Main\n\n" + "export let v: Vector(Int) = Vector.append([1], 2)\n",
      ),
      new Source.File(Source.fileId(1), "/Vector.hex", STDLIB_SOURCES["Vector"]! + CONCAT),
    ], { trustedStandardLibraryModules: new Set(["Vector"]) }).diagnostics;
    expect(companion.map(({ message }) => message)).toEqual([]);
    expect(diagnostics(CONCAT))
      .toEqual(["orphan instance: this module declares neither `Concat` nor the instance subject"]);
  });

  /** A program owns neither `Show` nor `Vector`, so this is the orphan it always was. */
  test("a standard constraint at a collection is an orphan in a program", () => {
    expect(diagnostics("honor Show<Vector(a)> =\n    show(x) = \"v\"\n"))
      .toEqual(["orphan instance: this module declares neither `Show` nor the instance subject"]);
  });
});
