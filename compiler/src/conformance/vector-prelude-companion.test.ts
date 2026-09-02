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
  test("`Debug.hex` is the last prelude member, `Stream.hex` the one before it", () => {
    expect(PRELUDE_MODULES.map(({ basename }) => basename)).toEqual([
      "Show.hex",
      "Num.hex",
      "Signed.hex",
      "Frac.hex",
      "Pow.hex",
      "Concat.hex",
      "Bool.hex",
      "Eq.hex",
      "Hash.hex",
      // #742 rehomed the `Ordering` union to a module of its own, so that its
      // now-qualified-only constructors have one to be spelled through
      // (`Ordering.Less`, Modules §3.3/§5.5). It takes `Prelude.hex`'s old
      // seat — after `Eq`/`Show`, which it derives, and before `Ord`, whose
      // `compare` answers `Ordering` — and `Prelude.hex` keeps `ignore` alone.
      "Ordering.hex",
      "Prelude.hex",
      "Ord.hex",
      "Integral.hex",
      "Option.hex",
      "Int.hex",
      "Nat.hex",
      "Float.hex",
      // #533 moved `BigInt.hex` past `Float.hex`: `BigInt.toFloat`'s guard
      // throws `Float.hex`'s `FloatRangeError`, and a module seats after what
      // it uses. Nothing before it names a `BigInt`, so the move costs the
      // three companions above it nothing.
      "BigInt.hex",
      // #353 swapped `String.hex` past `Seq.hex`. Its instances need nothing
      // later than `Ord.hex` and its old seat here was a convenience, but
      // Collections Part 5 §5.3's `String.fromSeq : Seq(String) -> String`
      // cannot be written before `Seq.hex` seats. `Seq.hex` names no string, so
      // the swap takes nothing from it.
      "Seq.hex",
      "String.hex",
      // #353 also seats the eleventh and last constraint declaration, and the
      // only one that cannot sit with the other ten: `toSeq(xs: c): Seq(Item)`
      // names `Seq`, and honoring the reverse order is a genuine cycle — which
      // is why Collections Part 5 §4's rows have no source form.
      "Iterable.hex",
      "Result.hex",
      "Vector.hex",
      // #370 displaced `Vector.hex` from the last seat: `Map.hex` needs `Hash`,
      // `Option`, `Seq` and `Vector` itself, and nothing after it names a `Map`.
      "Map.hex",
      // #373 displaced `Map.hex` in turn: `Set.hex` needs `Hash`, `Seq` and
      // `Vector`, needs nothing from `Map.hex` — the two are siblings over one
      // runtime module, not layers.
      "Set.hex",
      // #364: `Stream.hex` names `Seq` at `fromSeq`, `Option` at every pull,
      // and `Vector` at `collect`, so it sits after all three — and nothing
      // before it can name a `Stream`, because no pure module has business with
      // the impure sibling.
      "Stream.hex",
      // #511: FFI Part 2's companion of the borrowed `Array(a)`, opening the
      // boundary block. One edge is forced — `get` answers with an `Option` —
      // and the lateness is deliberate: its two exports are `length` and `get`,
      // and from here they are visible to no prelude module that spells either
      // word, so the Modules §5.5 arithmetic is settled in user code.
      "Array.hex",
      // #511: FFI Part 11's four. The first three each declare one union and
      // exist as modules of their own because `spec/ffi.md` §12 (as extended
      // for #511) makes every one of their constructors qualified-only, which
      // needs the module addressable under the union's name. Only one edge
      // among them is forced — `JsConversionReason.hex` names
      // `Vector(JsPathSegment)` — and `JsValue.hex` then sits after all three
      // plus `Result.hex` and `Vector.hex`, which its decoders' answers name.
      "JsKind.hex",
      "JsPathSegment.hex",
      "JsConversionReason.hex",
      "JsValue.hex",
      // #509: the `JsError` door closes the boundary block. Its seat is forced
      // twice — the payload slot and both accessors name `JsValue`, and the
      // verdicts over the guarded reads name `Result` and `Option` — and it is a
      // module of its own for `JsKind.hex`'s reason: FFI Part 11 §7 spells the
      // accessors `JsError.message` and `JsError.stack`, so the home has to be
      // addressable under that name. From here the two bare words it exports,
      // `message` and `stack`, are visible to no prelude module at all.
      "JsError.hex",
      // #407 closes the list, and is the one member no signature places:
      // `log` names `String` and `Unit`, `trace` names `Show`, all of which
      // seat in the first dozen. It is last for what the seat denies — from
      // here the two names are visible to no prelude module, so nothing in the
      // standard library can quietly acquire a probe, and no prelude module's
      // own bare names are ever in scope where these two are.
      "Debug.hex",
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
    expect(javascript).toContain("const length = __trieSize;");
    expect(javascript).toContain("const append = __trieAppend;");
    expect(javascript).toContain("const prepend = __triePrepend;");
    expect(javascript).toContain("const at = __vectorAt;");
    expect(javascript).toContain("const set = __vectorSet;");
    expect(javascript).toContain(
      "const fromSeq = __values => __vectorOf(__seqToIterable(__values));",
    );
    // The eager/lazy bridge still crosses the door, but unexported and under a
    // plain name since #353: `Iterable<Vector(a)>` is a provided row, so `toSeq`
    // at a vector is the constraint member and Constraints §4.6 forbids a
    // module-level binding of a member's spelling beside the instance.
    expect(javascript).toContain("const elements = __seqFromIterable;");
    expect(javascript).not.toContain("const toSeq =");
    expect(javascript).not.toContain("export { toSeq };");
    // The trie arrives as one import line, and `length`'s lowering being an
    // imported name rather than a body is the whole of what makes it O(1).
    expect(javascript).toContain('} from "./VectorTrie.js";');
    // `fromSeq` takes a top-level `Seq(a)` *parameter*, so its export site takes
    // FFI Part 7 §7 occasion 1's wrapper exactly as an exported `.hex` function
    // of that signature would (`spec/intrinsics.md` §8.3's edit note).
    expect(javascript).toContain(
      "const __fromSeqBoundary = __argument0 => fromSeq(__seqInbound(__argument0));",
    );
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
      expect.objectContaining({ name: "IndexError", $hex: "Vector", index: 9, size: 0 }),
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
      expect.objectContaining({ name: "IndexError", $hex: "Vector", index: 99, size: 2 }),
    );
    await expect(runProject([[
      "/main.hex",
      "let values: Vector(Int) = [10, 20]\n" +
      "export let bad: Int = values[7]\n",
    ]])).rejects.toThrowError(
      expect.objectContaining({ name: "IndexError", $hex: "Vector", index: 7, size: 2 }),
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
   * The gap this arrived as a `test.fails` against is closed (#469): the
   * checker's exception table is every exception constructor *in scope*, so the
   * prelude's `IndexError` is catchable here by the bare name §5.5 puts in
   * scope — the flip the old comment asked for, made once the table learned
   * about the constructors this module did not write.
   */
  test("a `catch` arm can name the prelude `IndexError`", async () => {
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
    // The trie brings its own dependencies since #344: its index arithmetic is
    // `Integral<Int>`'s members at `stdlib/Int.hex`, which in turn names
    // `Pow.hex`'s and `Integral.hex`'s exceptions and `Option.hex`'s answer for
    // the checked family. `Vector.hex` is what must stay out, and does.
    expect(emittedPaths(files)).toEqual([
      "/Pow.hex", "/Integral.hex", "/Option.hex", "/Int.hex", "/VectorTrie.hex", "/main.hex",
    ]);
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
   * **The rule: a collided bare prelude name is refused.** `empty` and
   * `singleton` are exported by `Seq.hex`, `Vector.hex`, `Map.hex` (#370) and
   * `Set.hex` (#373) — four homes each; `prepend` and `length` by the first two;
   * `isEmpty`, `toSeq`, `fromSeq` and `fromVector` by the last three; `get` and
   * `set` by `Vector.hex` and `Map.hex`; `contains` and `add` by `Set.hex`
   * alone, and `remove` by `Map.hex` and `Set.hex`. No member owns any of the
   * collided bare spellings: a reference to one
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
      "no bare `empty`; write `Seq.empty`, `Vector.empty`, `Map.empty`, " +
      "or `Set.empty`",
    ]);
  });

  /**
   * Every collided name reported, and only those: `last` is `Vector.hex`'s
   * alone, so it stays bare-legal in the same module that six refusals are
   * reported against. One diagnostic per reference, and nothing downstream —
   * the refused reference resolves to an error the checker treats as poisoned,
   * so no type error piles on behind it.
   *
   * Two names have moved sides as members joined, which is the rule doing
   * exactly what it exists to do — a name stops being bare-legal the moment a
   * second member exports it, rather than silently changing which module it
   * meant. `isEmpty` moved at #370, from `Vector.hex`'s alone to shared with
   * `Map.hex`. `map` moved at #364: it was `Seq.hex`'s alone until
   * `Stream.hex` joined, and this test's own fixture is where that shows,
   * because the line was written to demonstrate a name staying bare. #373
   * moved nothing and only lengthened three enumerations, and #511's
   * `Array.hex` moved nothing either — it lengthens `length`'s, and its other
   * export `get` was already `Vector`'s and `Map`'s.
   */
  test("every collided name is refused, and only those", () => {
    expect(projectDiagnostics(
      "export let a: Vector(Int) = empty\n" +
      "export let b: Vector(Int) = singleton(1)\n" +
      "export let c: Vector(Int) = prepend(b, 1)\n" +
      "export let d: Int = length(b)\n" +
      "export let e: Bool = isEmpty(b)\n" +
      "export let f: Seq(Int) = map(Seq.empty, (x: Int): Int => x)\n" +
      "export let g: Option(Int) = last(b)\n",
    )).toEqual([
      "no bare `empty`; write `Seq.empty`, `Vector.empty`, `Map.empty`, " +
      "or `Set.empty`",
      "no bare `singleton`; write `Seq.singleton(1)`, `Vector.singleton(1)`, " +
      "`Map.singleton(1)`, or `Set.singleton(1)`",
      "no bare `prepend`; write `b.prepend(1)`, `Seq.prepend(b, 1)`, " +
      "or `Vector.prepend(b, 1)`",
      "no bare `length`; write `b.length()`, `Seq.length(b)`, `Vector.length(b)`, " +
      "or `Array.length(b)`",
      "no bare `isEmpty`; write `b.isEmpty()`, `Vector.isEmpty(b)`, " +
      "`Map.isEmpty(b)`, or `Set.isEmpty(b)`",
      "no bare `map`; write `Seq.empty.map((x: Int): Int => x)`, " +
      "`Seq.map(Seq.empty, (x: Int): Int => x)`, " +
      "or `Stream.map(Seq.empty, (x: Int): Int => x)`",
      "no bare `last`; write `b.last()` or `Vector.last(b)`",
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
   * An ordinary declaration sourced from one member's term (§3.2, #762 — what
   * stands where the named import stood) is a module-level binding too
   * (§5.4), so it occludes the layer exactly as any other declaration does and
   * the bare spelling means the member the reader chose. This is the pin that
   * keeps the refusal keyed to the *layer a name resolved in* rather than to
   * the symbol: a prelude term and a declaration sourced from that term are
   * one `SymbolId`, and a test on the symbol would refuse this program, which
   * names no ambiguity at all.
   */
  test("a declaration sourced from one member settles the name", async () => {
    const main = await runProject([[
      "/main.hex",
      'import Seq from "./Seq"\n' +
      "let empty = Seq.empty\n" +
      "let length = Seq.length\n" +
      "export let n: Int = length(empty)\n",
    ]]);

    expect(main["n"]).toBe(0);
  });

  /**
   * **Prelude source is governed identically, its prelude layer being the
   * visible prefix** (Modules §5.5's last sentence, #742): a prelude module
   * reaches a predecessor's functions *qualified*, exactly as a consumer does,
   * and only its own exports bare. Before the inversion this seat pinned the
   * opposite half — a member seeing one exporter kept the bare spelling — and
   * the pin is kept, turned over, because the discipline it guards is the same
   * one: what a stdlib module may write, a user module may write.
   *
   * The route the message names is computed from the members *visible here*, so
   * the same source draws a one-home rewrite inside `Result.hex` (`Seq.hex`
   * alone precedes it) and a four-home one in the consumer. One project, one
   * name, two sentences.
   *
   * `Result.hex` is supplied by the project rather than embedded, the idiom the
   * prelude injection path already carries; its real source is extended rather
   * than replaced, so this pins the rule and not a transcription.
   */
  test("a prelude member reaches a predecessor's function qualified, not bare", () => {
    const compiled = compileFiles([
      ["/main.hex", "export let consumer: Vector(Int) = empty\n"],
      [
        "/Result.hex",
        `${PRELUDE_SOURCES["Result.hex"]!}\n` +
        "export let member: Seq(Int) = empty\n",
      ],
    ]);

    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "no bare `empty`; write `Seq.empty`, `Vector.empty`, `Map.empty`, " +
      "or `Set.empty`",
      "no bare `empty`; write `Seq.empty`",
    ]);
  });

  /** And the qualified spelling is what the member is expected to write. */
  test("the same member compiles once the predecessor is qualified", () => {
    const compiled = compileFiles([
      ["/main.hex", "export let consumer: Vector(Int) = Vector.empty\n"],
      [
        "/Result.hex",
        `${PRELUDE_SOURCES["Result.hex"]!}\n` +
        "export let member: Seq(Int) = Seq.empty\n",
      ],
    ]);

    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  });

  /**
   * **Every home, in prelude order.** A *fifth* exporter is reachable only
   * through a supplied member, and it is worth reaching: a rule that only ever
   * printed the homes the prelude happens to have would be indistinguishable
   * from one naming a winner and its runners-up. The extra home shows the
   * enumeration is the whole visible set, and shows the list reading as English
   * on both sides of the semicolon at a length the shipped prelude does not
   * reach on its own.
   */
  test("a further exporter joins the enumeration in prelude order", () => {
    const compiled = compileFiles([
      ["/main.hex", "export let e: Vector(Int) = empty\n"],
      [
        "/Result.hex",
        `${PRELUDE_SOURCES["Result.hex"]!}\n` +
        "export let empty: Int = 0\n",
      ],
    ]);

    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "no bare `empty`; write `Seq.empty`, `Result.empty`, `Vector.empty`, " +
      "`Map.empty`, or `Set.empty`",
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
    // `Vector.toSeq` no longer comes from `Vector.js` (#353) — it is the
    // provided row's member, so the companion contributes only the collided
    // `length`, under its distinguished local.
    expect(javascript).toContain(
      'import { length as __prelude_length } from "./Vector.js";',
    );
    expect(javascript).toContain("const lazy = length(source);");
    expect(javascript).toContain("const eager = __prelude_length(__vectorOf([1, 2]));");
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
