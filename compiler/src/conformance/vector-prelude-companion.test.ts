import { describe, expect, test } from "vitest";

import { PRELUDE_MODULES } from "../prelude.js";
import { PRELUDE_SOURCES } from "../prelude-sources.js";
import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";

/**
 * A crossed `Vector(a)` as a plain array.
 *
 * Readouts that land in a `Vector` go through this since the trie wiring: a
 * `Vector(a)` is a `TrieVector` record, not a JavaScript array. Spreading is
 * what the `Hex.Vector<a> extends Iterable<a>` face promises a consumer can do.
 */
function elements(value: unknown): unknown[] {
  return [...(value as Iterable<unknown>)];
}

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
 *    alike (Collections Part 1 §3.1's naming doctrine). A collided bare name is
 *    *refused*, naming every qualified home; the section below pins the rule and
 *    the two spellings that survive it.
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
   * The door's seven lowerings, read off the module that declares them —
   * against the trie (Collections Part 3 §4), which is what the milestone that
   * pinned these bodies to plain JS arrays said would replace them.
   *
   * Four of the seven are now the trie operation itself under its imported
   * name, and `length` being one of them is the §7 O(1) row: `size` is
   * `capacity - origin`. `at` and `set` still reach helpers, because a bounds
   * check followed by a return is statements. Both `Seq` bridges go through the
   * representation contract rather than the trie — `toSeq` hands the whole
   * vector to the inbound adapter because a vector is iterable, and `fromSeq`
   * is the literal builder over a different source.
   */
  test("each declaration binds its lowering", () => {
    const javascript = emitted([["/main.hex", "export let n: Int = Vector.length([1])\n"]], "/Vector.hex");
    expect(javascript).toContain("const length = __hex_vectorSize;");
    expect(javascript).toContain("const append = __hex_vectorAppend;");
    expect(javascript).toContain("const prepend = __hex_vectorPrepend;");
    expect(javascript).toContain("const at = __hex_vectorAt;");
    expect(javascript).toContain("const set = __hex_vectorSet;");
    expect(javascript).toContain(
      "const fromSeq = __hex_values => __hex_vectorOf(__hex_seqToIterable(__hex_values));",
    );
    expect(javascript).toContain("const toSeq = __hex_seqFromIterable;");
    // The trie arrives as one import line, and `length`'s lowering being an
    // imported name rather than a body is the whole of what makes it O(1).
    expect(javascript).toContain('} from "./VectorTrie.js";');
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
    expect(elements(main["ended"])).toEqual([10, 20, 30, 40]);
    expect(elements(main["begun"])).toEqual([0, 10, 20, 30]);
    expect(main["signed"]).toBe(30);
    expect(elements(main["replaced"])).toEqual([10, 25, 30]);
    expect(elements(main["round"])).toEqual([10, 20, 30]);
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

    expect(elements(main["window"])).toEqual([]);
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
   * A vector literal is compiler-lowered, so it needs no companion — a program
   * that names no companion function must emit no `Vector.js` import and must
   * not pull the module into its graph.
   *
   * What it *does* pull in since the trie wiring is `VectorTrie.js`, and the
   * two halves of that are the point. The runtime module is emitted, because a
   * literal, a `++`, and a bracket read are all trie operations and the
   * emitted program cannot run without them. `Vector.js` still is not, because
   * none of the three is a companion call — the prelude member stays out of a
   * program that never names it, exactly as before.
   */
  test("a program of literals alone imports no `Vector.js`", () => {
    const files = [[
      "/main.hex",
      "export let values: Vector(Int) = [1, 2, 3]\n" +
      "export let joined: Vector(Int) = [1] ++ [2]\n" +
      "export let head: Int = values[1]\n",
    ]] as const;

    expect(emitted(files, "/main.hex")).not.toContain('from "./Vector.js"');
    expect(emittedPaths(files)).toEqual(["/VectorTrie.hex", "/main.hex"]);
  });

  /**
   * The other side of that guarantee: no vector, no trie. This is what keeps
   * the runtime module from being a tax every program pays — it is reached the
   * way a prelude module is, by something the emitter actually wrote.
   */
  test("a program with no vector emits no trie runtime", () => {
    const files = [["/main.hex", "export let n: Int = 1 + 2\n"]] as const;

    expect(emitted(files, "/main.hex")).not.toContain("VectorTrie");
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
   * **The rule: a collided bare prelude name is refused.** `empty`,
   * `singleton`, `prepend`, and `length` are exported by both `Seq.hex` and
   * `Vector.hex`, and neither member owns the bare spelling: a reference to one
   * is an error, and the diagnostic names every qualified home so the rewrite is
   * local and obvious (the house Rewrite Rule). This is the F#/ML answer to the
   * same collision — `List.map` and `Seq.map` coexist and you qualify — and it
   * is the only answer that does not silently change what a bare `empty` meant
   * the moment a member joins the prelude.
   *
   * Refusal is the *bare* spelling's alone. Qualification answers, a module's
   * own declaration occludes the whole layer as it always did (Modules §5.4),
   * and dot call is untouched, because dispatch is type-directed (Method Syntax
   * §1) and never consults this scope at all.
   */
  test("the bare name is refused, and the diagnostic names every home", () => {
    expect(projectDiagnostics("export let e: Vector(Int) = empty\n")).toEqual([
      "the prelude name `empty` is ambiguous: exported by `Seq` and `Vector`; " +
      "write `Seq.empty` or `Vector.empty`",
    ]);
  });

  /**
   * All four collided names, and only those: `isEmpty` is `Vector.hex`'s alone
   * and `map` is `Seq.hex`'s alone, so both stay bare-legal in the same module
   * that four refusals are reported against. One diagnostic per reference, and
   * nothing downstream — the refused reference resolves to an error the checker
   * treats as poisoned, so no type error piles on behind it.
   */
  test("every collided name is refused, and only those", () => {
    expect(projectDiagnostics(
      "export let a: Vector(Int) = empty\n" +
      "export let b: Vector(Int) = singleton(1)\n" +
      "export let c: Vector(Int) = prepend(b, 1)\n" +
      "export let d: Int = length(b)\n" +
      "export let e: Bool = isEmpty(b)\n" +
      "export let f: Seq(Int) = map(Seq.empty, (x: Int): Int => x)\n",
    )).toEqual([
      "the prelude name `empty` is ambiguous: exported by `Seq` and `Vector`; " +
      "write `Seq.empty` or `Vector.empty`",
      "the prelude name `singleton` is ambiguous: exported by `Seq` and `Vector`; " +
      "write `Seq.singleton` or `Vector.singleton`",
      "the prelude name `prepend` is ambiguous: exported by `Seq` and `Vector`; " +
      "write `Seq.prepend` or `Vector.prepend`",
      "the prelude name `length` is ambiguous: exported by `Seq` and `Vector`; " +
      "write `Seq.length` or `Vector.length`",
    ]);
  });

  /**
   * Modules §5.4's occlusion is unchanged and is the second rewrite: a module
   * that declares the name means its own, with no ambiguity to report — the
   * prelude layer is occluded whole, collided or not.
   */
  test("a module's own declaration still occludes the whole layer", async () => {
    const main = await runProject([[
      "/main.hex",
      "let empty: Int = 0\n" +
      "export let mine: Int = empty\n",
    ]]);

    expect(main["mine"]).toBe(0);
  });

  /**
   * An explicit import of one member's term is a module-level binding too
   * (§5.4), so it occludes the layer exactly as a declaration does and the bare
   * spelling means the member the reader chose. This is the pin that keeps the
   * refusal keyed to the *layer a name resolved in* rather than to the symbol: a
   * prelude term and an explicit import of that term are one `SymbolId`, and a
   * test on the symbol would refuse this program, which names no ambiguity at
   * all.
   */
  test("an explicit import of one member settles the name", async () => {
    const main = await runProject([[
      "/main.hex",
      "import { empty, length } from \"./Seq\"\n" +
      "export let n: Int = length(empty)\n",
    ]]);

    expect(main["n"]).toBe(0);
  });

  /**
   * **The collision set is computed from the members *visible here*, not from
   * the prelude list.** A prelude member sees the members before it and only
   * those (Modules §5.5), so inside `Result.hex` exactly one member exports
   * `empty` and the bare spelling is ordinary — while the same spelling in a
   * consumer, which sees `Vector.hex` too, is refused. One project, one name,
   * two verdicts.
   *
   * `Result.hex` is supplied by the project rather than embedded, the idiom the
   * prelude injection path already carries; its real source is extended rather
   * than replaced, so this pins the rule and not a transcription.
   */
  test("a member that sees one exporter keeps the name bare", () => {
    const compiled = compileFiles([
      ["/main.hex", "export let consumer: Vector(Int) = empty\n"],
      [
        "/Result.hex",
        `${PRELUDE_SOURCES["Result.hex"]!}\n` +
        "export let member: Seq(Int) = empty\n",
      ],
    ]);

    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "the prelude name `empty` is ambiguous: exported by `Seq` and `Vector`; " +
      "write `Seq.empty` or `Vector.empty`",
    ]);
  });

  /**
   * **Every home, in prelude order — not the two the prelude happens to have
   * today.** A third exporter is reachable only through a supplied member, and
   * it is worth reaching: with two homes the message is a pair, and a rule that
   * only ever prints pairs is indistinguishable from one that names the winner
   * and the runner-up. Three shows the enumeration is the whole visible set, and
   * shows the list reading as English on both sides of the semicolon.
   */
  test("a third exporter joins the enumeration in prelude order", () => {
    const compiled = compileFiles([
      ["/main.hex", "export let e: Vector(Int) = empty\n"],
      [
        "/Result.hex",
        `${PRELUDE_SOURCES["Result.hex"]!}\n` +
        "export let empty: Int = 0\n",
      ],
    ]);

    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "the prelude name `empty` is ambiguous: exported by `Seq`, `Result`, and " +
      "`Vector`; write `Seq.empty`, `Result.empty`, or `Vector.empty`",
    ]);
  });

  /** Modules §6.4's qualified home is the rewrite the diagnostic points at. */
  test("the qualified spellings answer", async () => {
    const main = await runProject([[
      "/main.hex",
      "export let lazy: Int = Seq.length(Seq.prepend(Seq.empty, 1))\n" +
      "export let eager: Int = Vector.length(Vector.prepend(Vector.empty, 1))\n" +
      "export let one: Vector(Int) = Vector.singleton(7)\n",
    ]]);

    expect(main["lazy"]).toBe(1);
    expect(main["eager"]).toBe(1);
    expect(elements(main["one"])).toEqual([7]);
  });

  /**
   * Dispatch does not consult the prelude scope at all (Method Syntax §1:
   * type-directed, never lexical), so the refusal must not reach it — dot call
   * is the sanctioned mitigation, and a receiver answers whichever member owns
   * its type. Both receivers in one module, run: the two `length`s cannot share
   * an emitted name, and the module that gets that wrong compiles clean and
   * calls the wrong function.
   */
  test("the refusal does not decide a dot call", async () => {
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
   * collision rather than a module-level one). Which one is whichever the module
   * reached second — an emission detail and not a rule worth having, but a
   * spelling neither may share, since two `const length`s at one top level is a
   * `SyntaxError` at load after a clean compile. Refusing the *bare* spelling
   * does not retire this: the two routes that survive, qualification and dot
   * call, are exactly the two that reach both members from one module.
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
    expect(javascript).toContain("const eager = __hex_prelude_length(__hex_vectorOf([1, 2]));");
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
