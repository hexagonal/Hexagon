import { describe, expect, test } from "vitest";

import { PRELUDE_MODULES } from "../prelude.js";
import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";

/**
 * Conformance for `Vector`'s intrinsic-door milestone (`spec/intrinsics.md`
 * §9.2): `stdlib/Vector.hex` is a prelude module, its seven
 * representation-crossing operations are declared through the door
 * (Collections Part 3 §7's boundary), and the public-name door is gone.
 *
 * Three claims are load-bearing and each has its own section here.
 *
 * 1. **Consumers see nothing new** (§8.2). `Vector.length(v)` used to resolve
 *    through the resolver's `Map`/`Set`/`Vector` guard to a compiler-owned
 *    operation; it now resolves to an export of a prelude module. Same spelling,
 *    same answers — including the `IndexError` payloads, which were the one
 *    place the two paths could have diverged, since the emitter throws that
 *    exception from a helper and `Vector.hex` declares it.
 * 2. **Joining the prelude drags nothing in.** A prelude member is emitted only
 *    where a consumer references it, and a vector *literal* is still compiler
 *    lowered — so a program that never names a companion function must not grow
 *    a `Vector.js` import (the failure #263 fixed for `Seq.hex`).
 * 3. **Two prelude members now export the same bare names.** `empty`,
 *    `singleton`, `prepend`, and `length` are `Seq.hex`'s and `Vector.hex`'s
 *    alike (Collections Part 1 §3.1's naming doctrine). What the resolver does
 *    with that is pinned below, because nothing in Modules §5.5 states it.
 */

/** One project's emitted JavaScript, by source path. */
function emitted(files: readonly (readonly [string, string])[], path: string): string {
  const compiled = compileFiles(files);
  expect(compiled.diagnostics).toEqual([]);
  const module = compiled.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`${path} was not emitted`);
  return module.javascript.text;
}

/** Every source path the project emitted, in dependency order. */
function emittedPaths(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).modules.map(({ source }) => source.path);
}

describe("the module", () => {
  /**
   * #218's embedding half. Before this milestone `stdlib/Vector.hex` was
   * compiled by nothing — no test, no CI path, no prelude embedding — so it
   * could drift arbitrarily from the language it is written in. Membership is
   * the coverage: every project in this suite now compiles it.
   */
  test("`Vector.hex` is the last prelude member", () => {
    expect(PRELUDE_MODULES.map(({ basename }) => basename)).toEqual([
      "Bool.hex",
      "Prelude.hex",
      "Option.hex",
      "Seq.hex",
      "Result.hex",
      "Vector.hex",
    ]);
  });

  test("it compiles with no diagnostics of its own", () => {
    const compiled = compileFiles([["/main.hex", "export let n: Int = Vector.length([1])\n"]]);
    const vector = compiled.modules.find(({ source }) => source.path === "/Vector.hex")!;
    expect(vector.typed.diagnostics).toEqual([]);
    expect(vector.javascript.diagnostics).toEqual([]);
  });

  /**
   * The door's seven lowerings, read off the module that declares them. The
   * representation is unchanged by this milestone — plain JS arrays, per
   * Collections Part 3 §2's emission — and the swap to the trie is a later
   * change to these bodies and nothing else.
   */
  test("each declaration binds its lowering", () => {
    const javascript = emitted([["/main.hex", "export let n: Int = Vector.length([1])\n"]], "/Vector.hex");
    expect(javascript).toContain("const length = __hex_values => __hex_values.length;");
    expect(javascript).toContain(
      "const append = (__hex_values, __hex_value) => [...__hex_values, __hex_value];",
    );
    expect(javascript).toContain(
      "const prepend = (__hex_values, __hex_value) => [__hex_value, ...__hex_values];",
    );
    expect(javascript).toContain("const at = __hex_vectorAt;");
    expect(javascript).toContain("const set = __hex_vectorSet;");
    expect(javascript).toContain(
      "const fromSeq = __hex_values => Array.from(__hex_seqToIterable(__hex_values));",
    );
    expect(javascript).toContain("const toSeq = __hex_seqFromIterable;");
    // `fromSeq` takes a top-level `Seq(a)` *parameter*, so its export site takes
    // FFI Part 7 §7 occasion 1's wrapper exactly as an exported `.hex` function
    // of that signature would (`spec/intrinsics.md` §8.3's edit note). `toSeq`
    // returns one and takes none, so it exports as itself.
    expect(javascript).toContain(
      "const __hex_fromSeqBoundary0 = __hex_argument0 => fromSeq(__hex_seqInbound(__hex_argument0));",
    );
    expect(javascript).toContain("export { toSeq };");
  });
});

describe("consumers see nothing new (§8.2)", () => {
  test("the qualified spellings answer as before", async () => {
    const main = await runProject([[
      "/main.hex",
      "let values: Vector(Int) = [10, 20, 30]\n" +
      "export let size: Int = Vector.length(values)\n" +
      "export let ended: Vector(Int) = Vector.append(values, 40)\n" +
      "export let begun: Vector(Int) = Vector.prepend(values, 0)\n" +
      "export let signed: Int = Vector.at(values, -1)\n" +
      "export let replaced: Vector(Int) = Vector.set(values, 2, 25)\n" +
      "export let round: Vector(Int) = Vector.fromSeq(Vector.toSeq(values))\n" +
      "export let blank: Bool = Vector.isEmpty(Vector.empty)\n",
    ]]);

    expect(main["size"]).toBe(3);
    expect(main["ended"]).toEqual([10, 20, 30, 40]);
    expect(main["begun"]).toEqual([0, 10, 20, 30]);
    expect(main["signed"]).toBe(30);
    expect(main["replaced"]).toEqual([10, 25, 30]);
    expect(main["round"]).toEqual([10, 20, 30]);
    expect(main["blank"]).toBe(true);
  });

  /**
   * `IndexError` and `SliceError` are `Vector.hex`'s declarations and are now
   * prelude-visible *as terms*: a consumer can name and throw them with no
   * import, which nothing outside `Vector.hex` could do before.
   */
  test("the declared exceptions are constructible with no import", async () => {
    const main = await runProject([[
      "/main.hex",
      "export fun refuse(index: Int): Int = throw(IndexError(index, 0))\n" +
      "export fun reject(start: Int): Int = throw(SliceError(start, 0))\n",
    ]]);

    const refuse = main["refuse"] as (index: number) => number;
    expect(() => refuse(9)).toThrowError(
      expect.objectContaining({ name: "IndexError", $hex: true, index: 9, size: 0 }),
    );
  });

  /**
   * The identity is `name` under the `$hex` brand (Exceptions §7.1), so the
   * exception the emitter's bounds helpers throw and the one `Vector.hex`
   * declares are the same value by construction rather than by arrangement.
   * Read from JavaScript, because a Hexagon `catch` arm cannot name it — see the
   * `test.fails` below.
   */
  test("`at` and bracket indexing throw the declared shape", async () => {
    await expect(runProject([[
      "/main.hex",
      "let values: Vector(Int) = [10, 20]\n" +
      "export let bad: Int = Vector.at(values, 99)\n",
    ]])).rejects.toThrowError(
      expect.objectContaining({ name: "IndexError", $hex: true, index: 99, size: 2 }),
    );
    await expect(runProject([[
      "/main.hex",
      "let values: Vector(Int) = [10, 20]\n" +
      "export let bad: Int = values[7]\n",
    ]])).rejects.toThrowError(
      expect.objectContaining({ name: "IndexError", $hex: true, index: 7, size: 2 }),
    );
  });

  /**
   * `SliceError` is the other declaration, and the slice helper's direction
   * check still raises it — but no Hexagon program can reach that check:
   * Collections Part 3 §6.3 says the only descending `Range` comes from
   * `rangeDown` or a function returning one, and the emitter's `range` helper
   * hardcodes `descending: false` because v1 has no such producer. An empty
   * *ascending* window clamps, which is §6's other half and is what
   * `vector.test.ts` pins. So what is asserted here is the exception's reach,
   * not its raising.
   */
  test("an empty ascending window clamps rather than raising", async () => {
    const main = await runProject([[
      "/main.hex",
      "let values: Vector(Int) = [10, 20, 30]\n" +
      "export let window: Vector(Int) = values[3..1]\n",
    ]]);

    expect(main["window"]).toEqual([]);
  });

  /**
   * **A pre-existing gap, not this milestone's.** The checker's exception table
   * is built from `module.items` alone, so a `catch` arm can only name an
   * exception the *same module* declares: an imported one and a prelude one
   * alike report "`X` is not an exception constructor", and `Seq.hex`'s
   * `ReentrancyError` has been uncatchable since it joined the prelude. Making
   * `IndexError` prelude-visible does not change that, and the fix is a checker
   * change with a scope of its own (every imported exception, not `Vector`'s
   * two).
   *
   * `test.fails` rather than `skip`: when the table learns about imported
   * constructors this goes red, which is the signal to delete the comment and
   * flip it to an ordinary `test`.
   */
  test.fails("a `catch` arm can name the prelude `IndexError`", async () => {
    const main = await runProject([[
      "/main.hex",
      "let values: Vector(Int) = [10, 20]\n" +
      "export let payload: (Int, Int) = try\n" +
      "    (Vector.at(values, 99), 0)\n" +
      "catch\n" +
      "    IndexError(index, size) => (index, size)\n",
    ]]);

    expect(main["payload"]).toEqual([99, 2]);
  });
});

describe("membership drags nothing in", () => {
  /**
   * A vector literal is compiler-lowered to a JS array (Collections Part 3 §2),
   * so it needs no companion — and a program that names no companion function
   * must emit no `Vector.js` import and must not pull the module into its graph.
   */
  test("a program of literals alone imports no `Vector.js`", () => {
    const files = [[
      "/main.hex",
      "export let values: Vector(Int) = [1, 2, 3]\n" +
      "export let joined: Vector(Int) = [1] ++ [2]\n" +
      "export let head: Int = values[1]\n",
    ]] as const;

    expect(emitted(files, "/main.hex")).not.toContain("Vector.js");
    expect(emittedPaths(files)).toEqual(["/main.hex"]);
  });

  test("one that names a companion function imports exactly that name", () => {
    const files = [["/main.hex", "export let n: Int = Vector.length([1, 2])\n"]] as const;

    expect(emitted(files, "/main.hex")).toContain('import { length } from "./Vector.js";');
    expect(emittedPaths(files)).toContain("/Vector.hex");
  });
});

describe("two prelude members exporting one bare name", () => {
  /**
   * **The observed rule: the later member wins, silently.** Prelude terms are
   * seeded into one fallback scope in normative prelude order, and the scope
   * keeps one binding per name (`Scope.define` overwrites), so `Vector.hex`
   * being last makes the bare `empty`, `singleton`, `prepend`, and `length` its
   * own. There is no diagnostic and no ambiguity report; Modules §5.5 states
   * ordered *visibility* between members and says nothing about a collision
   * between them.
   *
   * This is pinned as measured, not endorsed: it silently changes what a bare
   * `empty` meant in every program written before the milestone.
   */
  test("the bare name is the later member's", async () => {
    const main = await runProject([[
      "/main.hex",
      "let e = empty\n" +
      "export let grown: Vector(Int) = prepend(e, 1)\n" +
      "export let one: Vector(Int) = singleton(7)\n" +
      "export let n: Int = length(grown)\n",
    ]]);

    expect(main["grown"]).toEqual([1]);
    expect(main["one"]).toEqual([7]);
    expect(main["n"]).toBe(1);
  });

  /** Modules §6.4's qualified home is what keeps the occluded member reachable. */
  test("the occluded member is reachable qualified", async () => {
    const main = await runProject([[
      "/main.hex",
      "export let n: Int = Seq.length(Seq.prepend(Seq.empty, 1))\n",
    ]]);

    expect(main["n"]).toBe(1);
  });

  /**
   * Dispatch does not consult the prelude scope at all (Method Syntax §1:
   * type-directed, never lexical), so occlusion must not reach it. Both
   * receivers in one module, run: the two `length`s cannot share an emitted
   * name, and the module that gets that wrong compiles clean and calls the
   * wrong function.
   */
  test("occlusion does not decide a dot call", async () => {
    const main = await runProject([[
      "/main.hex",
      "let source: Seq(Int) = Vector.toSeq([1, 2, 3])\n" +
      "export let lazy: Int = source.length()\n" +
      "export let eager: Int = [1, 2].length()\n",
    ]]);

    expect(main["lazy"]).toBe(3);
    expect(main["eager"]).toBe(2);
  });

  /**
   * The same claim on the emitted text: one of the two takes a distinguished
   * local (Modules §6.4's mechanism, reused here for a prelude-internal
   * collision rather than a module-level one). Which one is whichever the
   * module reached second — not a rule worth having, but a spelling neither may
   * share, since two `const length`s at one top level is a `SyntaxError` at load
   * after a clean compile.
   */
  test("both reach their own import when both are used", () => {
    const javascript = emitted([[
      "/main.hex",
      "let source: Seq(Int) = Vector.toSeq([1, 2, 3])\n" +
      "export let lazy: Int = source.length()\n" +
      "export let eager: Int = Vector.length([1, 2])\n",
    ]], "/main.hex");

    expect(javascript).toContain('import { length } from "./Seq.js";');
    expect(javascript).toContain(
      'import { toSeq, length as __hex_prelude_length } from "./Vector.js";',
    );
    expect(javascript).toContain("const lazy = length(source);");
    expect(javascript).toContain("const eager = __hex_prelude_length([1, 2]);");
  });
});

describe("the public-name door is gone", () => {
  /**
   * The guard the milestone removes let `Vector.anything` resolve while no
   * module claimed the name, and the checker answered from a row table. With
   * the rows deleted, an unknown operation is an ordinary "no export" error
   * against a module that is now perfectly ordinary.
   */
  test("an operation the module does not export is an ordinary missing export", () => {
    expect(projectDiagnostics("export let n: Int = Vector.reverse([1, 2])\n")).toEqual([
      "module `Vector` does not export `reverse`",
    ]);
  });
});
