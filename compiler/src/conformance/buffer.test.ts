import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project";
import regexRuntimeSource from "../../../stdlib/Runtime/Regex.hex?raw";

/**
 * What the `Buffer` rows actually *do* (`spec/regex.md` §7, `spec/intrinsics.md`
 * §3.3, #927) — the behavioural half of the `type` form, where
 * `intrinsic-door.test.ts` holds what the door accepts and what it says when it
 * refuses.
 *
 * Three properties, and each is a different kind of claim:
 *
 *  - the four operations **run**, through the emitted JavaScript, over a plain
 *    array: create fills, write stores, read answers what was stored, and length
 *    is the size the buffer was created with;
 *  - `Buffer(a)` is **invariant**, so a `Buffer(Int)` is not a `Buffer` of
 *    anything else, however the two element types relate;
 *  - the arrows are the **honest** ones — `create`/`read`/`write` are `->!` and
 *    draw the effects discipline's refusal inside a `->`-faced function, while
 *    `length` is `->` and does not.
 *
 * Every specimen rides in the shipped `stdlib/Runtime/Regex.hex`'s own text at
 * `/Regex.hex`: a file is a runtime member by sitting at the member's basename
 * and declaring the member's name (#829), and `buffer`'s inventory entry names
 * that module as its one declarer, so this is the only seat the rows exist in.
 */

/**
 * The one route into a runtime member's seat (#829): a project file at the
 * member's **basename** declaring the member's **name** is adopted as that
 * member, privileges and all. `buffer`'s inventory entry names
 * `Hex.Runtime.Regex` as its one declarer, so this is the only seat the rows
 * exist in, and the shipped text rides along so the specimen compiles beside
 * the rows it is about.
 */
const PROBE_PATH = "/Regex.hex";

/**
 * One ordinary module that reaches the adopted runtime module, so it is emitted.
 *
 * An injected module is emitted only where something emitted imports it
 * (`project.ts`), and nothing reaches the regex engine yet — `Hex.Regex`, its
 * one consumer, is a later arc. So the probe's scalar export is imported here,
 * the way `hash-trie.test.ts`'s `TOUCH` reaches the trie through a `Map`.
 * Nothing in this module is under test; it exists to be an importer.
 */
const TOUCH: readonly [string, string] = [
  "/Main.hex",
  "module Main\n\nimport Runtime.Regex\n\nexport let touched: Int = Regex.probe\n",
];

function diagnostics(source: string): readonly string[] {
  return compileFiles([[PROBE_PATH, `${regexRuntimeSource}\n${source}`]])
    .diagnostics.map((diagnostic) => diagnostic.message);
}

describe("the four operations, run through the emitted JavaScript", () => {
  /**
   * The emitted module is **executed** rather than read, because what is being
   * pinned is the semantics `regex.md` §7 fixes — zero-based, fill required, the
   * size fixed at creation — and a lowering that read plausibly and behaved
   * wrongly would pass a text assertion.
   */
  async function run(body: string): Promise<unknown> {
    const exports = await runProject(
      [[PROBE_PATH, `${regexRuntimeSource}\nexport let probe: Int = ${body}\n`], TOUCH],
      { entry: PROBE_PATH },
    );
    return exports.probe;
  }

  test("`create` fills every slot, and `length` is the size it was created with", async () => {
    expect(await run("length(create!(4, 0))")).toBe(4);
    expect(await run("read!(create!(4, 7), 3)")).toBe(7);
  });

  test("`write` stores at a zero-based index, and `read` answers what was stored", async () => {
    expect(await run(
      "\n" +
      "    let b = create!(3, 0)\n" +
      "    let first = write!(b, 0, 11)\n" +
      "    let last = write!(b, 2, 22)\n" +
      // The untouched middle slot still holds the fill, which is the other half
      // of "fill required": there is no hole to read back.
      "    read!(b, 0) + read!(b, 2) + read!(b, 1)",
    )).toBe(33);
  });

  /**
   * §7: a fresh buffer per call, which is what makes `create`'s `->!` honest —
   * a write to one and a read of the other tell two buffers apart, so the
   * identity a call hands out is observable.
   */
  test("`create` answers a fresh buffer per call", async () => {
    expect(await run(
      "\n" +
      "    let first = create!(2, 0)\n" +
      "    let second = create!(2, 0)\n" +
      "    let stored = write!(first, 0, 5)\n" +
      "    read!(second, 0)",
    )).toBe(0);
  });

  /**
   * `write` answers Unit, which is what the row declares. Asserted through the
   * `Int` probe's own shape rather than by exporting a `Unit`: the write's
   * answer is discarded and the read after it is what the probe carries, which
   * is also how every caller in the engine will use the row.
   */
  test("`write` answers Unit, and the store it made is what is read back", async () => {
    expect(await run(
      "\n" +
      "    let b = create!(1, 0)\n" +
      "    let nothing: Unit = write!(b, 0, 42)\n" +
      "    read!(b, 0)",
    )).toBe(42);
  });
});

describe("`Buffer(a)` is invariant (§3.3)", () => {
  /**
   * There is no representation for the closure doc's §6.3 to verify a variance
   * claim against, so §3.3 gives the row the opaque-declaration rule's bare
   * parameter — the empty claim, meaning invariant — and a written sigil is
   * refused at the parser.
   *
   * The consequence at a **use** site: a `Buffer(Int)` is not a buffer of
   * anything else, and the contextual widening that carries an `Int` literal to
   * a `Float` (Numeric Literals §5.1) does not reach inside the constructor —
   * the buffer is already a `Buffer(Int)` when the argument is read.
   */
  test("a `Buffer(Int)` does not stand where a `Buffer(Float)` is wanted", () => {
    expect(diagnostics(
      "let ints: Buffer(Int) = create!(1, 0)\n" +
      "let widened(b: Buffer(Float)): Int = 0\n" +
      "let probe: Int = widened(ints)\n",
    )).toEqual(["type mismatch: expected Float, found Int"]);
    expect(diagnostics(
      "let ints: Buffer(Int) = create!(1, 0)\n" +
      "let floats: Buffer(Float) = ints\n",
    )).toEqual(["type mismatch: expected Float, found Int"]);
  });

  /**
   * The **generalization** side of the same fact, and the one that reads the
   * variance table rather than unification (closure doc §5.1, §7): the relaxed
   * value restriction generalizes an expansive binding's unconstrained,
   * covariant-only variables, and refuses a variable that occurs in an invariant
   * position. So a `Buffer`-valued expansive binding is monomorphic and its two
   * consumers contend for one slot.
   *
   * The `Seq` half is the **control**, and it is what makes the `Buffer` half
   * mean something: `Seq(+a)`'s sigil is written in `stdlib/Seq.hex`, the same
   * expansive shape generalizes there, and the two consumers instantiate
   * independently. Without it this test would pass against a compiler that
   * generalized nothing at all.
   */
  test("a variable inside a `Buffer` slot is not generalized; a `Seq(+a)`'s is", () => {
    expect(diagnostics(
      "let identity(b: Buffer(a)): Buffer(a) = b\n" +
      "let shared = identity(create!(1, 0))\n" +
      "let asInt: Buffer(Int) = shared\n" +
      "let asText: Buffer(String) = shared\n",
    )).toEqual(["type mismatch: expected String, found Int"]);
    expect(diagnostics(
      "let identity(s: Seq(a)): Seq(a) = s\n" +
      "let shared = identity(Seq.empty)\n" +
      "let asInt: Seq(Int) = shared\n" +
      "let asText: Seq(String) = shared\n",
    )).toEqual([]);
  });
});

describe("the honest arrows (§3.3, `regex.md` §7)", () => {
  /**
   * `create`, `read` and `write` are `->!`, so a `->`-faced function calling one
   * draws the effects discipline's refusal — which is the whole content of the
   * arrows being *written* rather than left to the `:` spelling's pure default.
   * `bufferLength` is `->`, because a buffer's size is fixed at creation and no
   * row changes it, so the same function calling it is at home.
   *
   * The face is pinned by an **annotation** rather than by a header: an
   * implementation header writes `:` and infers its colour (Functions §4.1), so
   * a body that ran effects would simply come out `->!` and prove nothing. The
   * annotated binding is what fixes the face in advance and makes the call a
   * contradiction.
   */
  const REFUSAL = "this call performs effects, and the enclosing function's face is " +
    "the pure arrow `->` — a pure face cannot run effects";

  test("a `read` inside a `->`-faced function is refused", () => {
    expect(diagnostics(
      "let reads: (Buffer(Int)) -> Int = (b) => read!(b, 0)\n",
    )).toEqual([REFUSAL]);
  });

  test("a `create` and a `write` inside a `->`-faced function are refused too", () => {
    expect(diagnostics(
      "let makes: () -> Int = () => length(create!(1, 0))\n",
    )).toEqual([REFUSAL]);
    expect(diagnostics(
      "let writes: (Buffer(Int)) -> Unit = (b) => write!(b, 0, 1)\n",
    )).toEqual([REFUSAL]);
  });

  /** `length` is the one that is not: a read of a value, at a pure face. */
  test("a `length` inside a `->`-faced function is not", () => {
    expect(diagnostics(
      "let sized: (Buffer(Int)) -> Int = (b) => length(b)\n",
    )).toEqual([]);
  });

  /**
   * And the three `->!` rows are at home in an ordinary inferred-face function,
   * each call carrying its `!` mark (Effects §3.2) — which is the same fact from
   * the other side: the marks are there because the arrows are.
   */
  test("the three `->!` rows are at home behind their marks", () => {
    expect(diagnostics(
      "let scratch(): Int =\n" +
      "    let b = create!(2, 0)\n" +
      "    let stored = write!(b, 1, 9)\n" +
      "    read!(b, 1)\n",
    )).toEqual([]);
  });
});
