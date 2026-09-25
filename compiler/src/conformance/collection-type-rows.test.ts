import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { INTRINSIC_INVENTORY } from "../intrinsics";
import { STDLIB_SOURCES } from "../stdlib-sources";
import { compileFiles, runMain, runProject } from "../support/test-project.js";

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

/** A shipped companion's own source with `extra` appended, compiled in its real seat. */
function inCompanion(companion: string, extra: string): readonly string[] {
  return compileProject([
    new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + "export let n: Int = 1\n"),
    new Source.File(Source.fileId(1), `/${companion}.hex`, STDLIB_SOURCES[companion]! + extra),
  ], { trustedStandardLibraryModules: new Set([companion]) }).diagnostics
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

/**
 * The representation records a row's claim is checked against are the trusted
 * runtime modules' alone (`project.ts`). A program's own module spelled
 * `Runtime.VectorTrie`, declaring a `TrieVector` that would break the claim, is
 * a different module — `Hex.Runtime.VectorTrie` is the standard library's — and
 * must not become the record `Hex.Vector`'s row is read against.
 */
test("a program's own record of the same spelling is not the representation", () => {
  // `Hex.Vector` is supplied in its real seat so its row is checked in this
  // compilation rather than answered from the standard-library cache.
  const project = compileFiles([
    ["/rt.hex", "module Runtime.VectorTrie\n\n" + "export record TrieVector(a) = { f: a -> Int }\n"],
    ["/main.hex", "module Main\n\n" + "import Runtime.VectorTrie as Rt\n" +
      "export let n: Int = Vector.length([1])\n" +
      "export let r: Rt.TrieVector(Int) = Rt.TrieVector({ f = (x) => x })\n"],
    ["/Vector.hex", STDLIB_SOURCES["Vector"]!],
  ], { trustedStandardLibraryModules: new Set(["Vector"]) });
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
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

  /**
   * An instance at a collection crosses modules like any instance: declared in
   * one program module and used from another, at a generic call (the head's
   * binder carrying its own evidence) and through an implied type.
   */
  test("a program's instances at the collections are used from another module", async () => {
    const main = await runProject([
      [
        "/lib.hex",
        "module Lib\n\n" +
          "export constraint Sized<t> =\n    size(x: t) -> Int\n\n" +
          "export constraint Parts<t> =\n    type Part\n    parts(x: t) -> Vector(Part)\n\n" +
          "honor<a: Show> Sized<Vector(a)> =\n    size(x) = Vector.length(x)\n\n" +
          "honor Sized<Map(k, v)> =\n    size(m) = Map.size(m)\n\n" +
          "honor Parts<Set(a)> =\n    type Part = a\n    parts(s) = Vector.fromSeq(Set.toSeq(s))\n",
      ],
      [
        "/main.hex",
        "module Main\n\n" + "import Lib\n\n" +
          "fun twice<t: Lib.Sized>(x: t): Int = Lib.size(x) + Lib.size(x)\n\n" +
          "export let a: Int = twice([1, 2, 3])\n" +
          "export let b: Int = Lib.size(Map.singleton(1, 2))\n" +
          "export let c: Vector(Int) = Lib.parts(Set.singleton(7))\n",
      ],
    ]);
    expect([main.a, main.b, [...(main.c as Iterable<number>)]]).toEqual([6, 1, [7]]);
  });

  /**
   * A missing instance at a collection names its homes (Modules §7.6): the
   * companion declares the type since #1071, so it is named as fact beside the
   * constraint's module, as the prelude's other types are.
   */
  test("a missing instance at a collection names the companion as a home", () => {
    expect(diagnostics(
      "constraint Pretty<t> =\n    pretty(x: t) -> Int\n\n" + "export let n: Int = pretty([1])\n",
    )).toEqual([
      "type `Vector(a)` has no `Pretty` instance; it could only be declared in module `Main` " +
        "(declares `Pretty`) or the prelude module declaring `Vector`",
    ]);
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
   * The same honor in a program is an orphan. `Concat` at `Map` is used because
   * no compiler-provided row stands in that slot.
   */
  test("the declaring companion may honor a prelude constraint at its type; a program may not", () => {
    const CONCAT = "\nhonor Concat<Map(k, v)> =\n    concat(left, right) = left\n";
    expect(inCompanion("Map", CONCAT)).toEqual([]);
    expect(diagnostics(CONCAT))
      .toEqual(["orphan instance: this module declares neither `Concat` nor the instance subject"]);
  });

  /**
   * *(Ruled 2026-09-26.)* A slot the compiler fills — structurally, or by a
   * provided `Iterable` row — takes no source instance beside it: an instance
   * there is one or the other (Intrinsics §3.3), and moving one into source
   * deletes the compiler's in the same change. Only the standard library can
   * write one, so the refusal is a guard on our own edits. Before it, `Show`
   * was accepted and never used, `Iterable` was dropped without a word, and
   * `Hash` passed the checker and faulted in emission.
   *
   * `Hash` also pins the companion's hand-written-`Hash` privilege (Constraints
   * §4.5's standard-library exception): the one refusal is this one, not the
   * derivable-only law's.
   */
  test.each([
    ["Vector", "Show<Vector(a)>", "honor Show<Vector(a)> =\n    show(x) = \"v\"\n"],
    ["Vector", "Hash<Vector(a)>", "honor<a: Hash> Hash<Vector(a)> =\n    hash(x) = 0\n"],
    ["Vector", "Concat<Vector(a)>", "honor Concat<Vector(a)> =\n    concat(left, right) = left\n"],
    [
      "Vector",
      "Iterable<Vector(a)>",
      "honor Iterable<Vector(a)> =\n    type Item = a\n    toSeq(x) = elements(x)\n",
    ],
    [
      "Set",
      "Iterable<Set(a)>",
      "honor Iterable<Set(a)> =\n    type Item = a\n    toSeq(x) = Seq.empty\n",
    ],
  ])("the companion `%s` may not honor `%s`, a slot the compiler fills", (companion, head, honor) => {
    expect(inCompanion(companion, `\n${honor}`))
      .toEqual([`duplicate instance of \`${head}\`: the compiler provides it`]);
  });

  /**
   * A slot the compiler leaves open is the companion's to fill — `Ord` at `Map`
   * has no structural answer — and its head binds its variables like any
   * head's (Constraints §4.4, #390): written bare, the base constraint's demand
   * on them is reported at the header; written with the prefix, it is admitted.
   */
  test("the companion's own head binds its variables, as any head does", () => {
    expect(inCompanion("Map", "\nhonor Ord<Map(k, v)> =\n    compare(l, r) = Ordering.Equal\n"))
      .toEqual([
        "`k` is declared without constraints, but the body requires `Hash`; write `<k: Hash>` on the `honor` header",
        "`v` is declared without constraints, but the body requires `Eq`; write `<v: Eq>` on the `honor` header",
      ]);
    expect(inCompanion(
      "Map",
      "\nhonor<k: Hash, v: Eq> Ord<Map(k, v)> =\n    compare(l, r) = Ordering.Equal\n",
    )).toEqual([]);
  });

  /**
   * A head at a collection introduces its variables as binders, with nothing
   * the prefix does not say (Constraints §4.4, #390): what the constraint's
   * base or the body demands of them is reported at the header, as it is at
   * `Option(a)`. An unbound variable here once reached emission and faulted.
   */
  test.each([
    ...(["Eq", "Hash", "Show"] as const).flatMap((base) => [
      [base, "Vector(a)", ["a"]],
      [base, "Set(a)", ["a"]],
      [base, "Map(k, v)", ["k", "v"]],
    ] as const),
    ["Ord", "Vector(a)", ["a"]] as const,
  ])("a bare `%s`-based head at `%s` asks the header for its binders' constraints", (base, head, binders) => {
    const messages = diagnostics(
      `constraint Pretty<t: ${base}> =\n    pretty(x: t) -> Int\n\n` +
        `honor Pretty<${head}> =\n    pretty(x) = 0\n`,
    );
    expect(messages).toHaveLength(binders.length);
    binders.forEach((binder, index) => {
      expect(messages[index]).toMatch(
        new RegExp(`^\`${binder}\` is declared without constraints, but the body requires `),
      );
    });
  });

  test("a body's demand on a bare head's variable is reported at the header", () => {
    expect(diagnostics(
      "constraint Pretty<t> =\n    pretty(x: t) -> String\n\n" +
        "honor Pretty<Set(a)> =\n    pretty(x) = show(x)\n",
    )).toEqual([
      "`a` is declared without constraints, but the body requires `Show`; write `<a: Show>` on the `honor` header",
    ]);
  });

  /** A program owns neither `Show` nor `Vector`, so this is the orphan it always was. */
  test("a standard constraint at a collection is an orphan in a program", () => {
    expect(diagnostics("honor Show<Vector(a)> =\n    show(x) = \"v\"\n"))
      .toEqual(["orphan instance: this module declares neither `Show` nor the instance subject"]);
  });
});
