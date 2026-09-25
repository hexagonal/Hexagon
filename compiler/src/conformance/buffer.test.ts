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
 * Every specimen rides in the shipped `stdlib/Runtime/Regex.hex`'s own text,
 * explicitly trusted as the registered `Runtime.Regex` member, and `buffer`'s
 * inventory entry names that module as its one declarer, so this is the only
 * seat the rows exist in.
 */

/**
 * The specialized harness explicitly grants the registered `Runtime.Regex`
 * identity to this supplied declaration, which carries the member seat's
 * privileges independently of the fixture path. `buffer`'s inventory entry names
 * `Hex.Runtime.Regex` as its one declarer, so this is the only seat the rows
 * exist in, and the shipped text rides along so the specimen compiles beside
 * the rows it is about.
 */
const PROBE_PATH = "/Regex.hex";
const TRUST_RUNTIME = { trustedStandardLibraryModules: new Set(["Runtime.Regex"]) } as const;

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
  return compileFiles([[PROBE_PATH, `${regexRuntimeSource}\n${source}`]], TRUST_RUNTIME)
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
      { ...TRUST_RUNTIME, entry: PROBE_PATH },
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
   * parameter — the empty claim, meaning invariant. `buffer` writes no sigil,
   * so every slot of `Buffer(a)` is invariant.
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
    // The variable is reached through a **covariant** `Seq` slot, so the only
    // thing that can make it invariant is `Buffer`'s own row. Reached directly
    // it would be invariant anyway — a `Buffer`-valued binding pins its slot by
    // unification whatever the variance table says — and the test would pass
    // against a compiler whose row read `co`. Through one covariant hop it does
    // not: the sign that arrives at `a` is the product, and the product is the
    // row.
    expect(diagnostics(
      "let nested(k: Int): Seq(Buffer(a)) = Seq.empty\n" +
      "let shared = nested(1)\n" +
      "let asInt: Seq(Buffer(Int)) = shared\n" +
      "let asText: Seq(Buffer(String)) = shared\n",
    )).toEqual(["type mismatch: expected String, found Int"]);
    // The **control**, one constructor different and otherwise identical:
    // `Seq(+a)`'s sigil is written in `stdlib/Seq.hex`, so the same shape
    // generalizes and the two consumers instantiate independently. Without it
    // this test would pass against a compiler that generalized nothing at all.
    expect(diagnostics(
      "let nested(k: Int): Seq(Seq(a)) = Seq.empty\n" +
      "let shared = nested(1)\n" +
      "let asInt: Seq(Seq(Int)) = shared\n" +
      "let asText: Seq(Seq(String)) = shared\n",
    )).toEqual([]);
  });

  /**
   * The third reader of the same row, and the only one that is an *annotation*
   * walk rather than a type walk (`variance.ts`): a declaration whose field
   * holds a `Buffer(a)` uses `a` invariantly, so a `+` claim over it is refused
   * by the closure doc's §6.3 verification, with the field named as witness.
   *
   * The `Seq` control again, the same shape one constructor different, so the
   * refusal is about `Buffer`'s row and not about the machinery being broken.
   */
  test("a field holding a `Buffer(a)` uses `a` invariantly", () => {
    expect(diagnostics("opaque record Box(+a) = {slots: Buffer(a)}\n")).toEqual([
      "`a` cannot be declared covariant in `Box`: field `slots` uses `a` in an " +
      "invariant position. Remove the `+`, or change the field",
    ]);
    expect(diagnostics("opaque record Box(+a) = {slots: Seq(a)}\n")).toEqual([]);
  });
});

describe("the honest arrows (§3.3, `regex.md` §7)", () => {
  /**
   * `create`, `read` and `write` are `->!`, so a `->`-faced function calling one
   * draws the effects discipline's refusal — which is the whole content of the
   * arrows being *written*: an extern row's arrow is its effect contract (FFI
   * Part 4 §4.5), and these three contracts say `->!`.
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

/**
 * The walks that now read a `Buffer`'s **argument** (#927): a door type is the
 * first `ExternType` that carries one, and every walk over types had to learn
 * to enter it. Each pin below fails if its walk passes over the argument.
 */
describe("walks that enter a `Buffer`'s argument", () => {
  /**
   * The occurs check. `write!(b, 0, b)` asks `b : Buffer(a)` to hold itself, so
   * `a` would be `Buffer(a)`. Without the argument arm this is not a diagnostic
   * but a stack overflow in the unifier.
   */
  test("a buffer that would hold itself is an infinite type", () => {
    expect(diagnostics("let f(b) = write!(b, 0, b)\n")).toEqual([
      "infinite type: a type variable occurs inside itself",
    ]);
  });

  /**
   * The contract's colours inside a `Buffer` reach an instance body fresh
   * (Effects §13.2), so the body's demand for an impure element is compared at
   * the seat and reported as the instance-against-contract refusal. A walk that
   * did not see the arrow inside `Buffer(Int -> Int)` would hand the body the
   * contract's own `->`, and the report would be a plain colour clash instead.
   */
  /**
   * Level lowering. `b` joins the outer `x` with a buffer built from `g`'s own
   * `y`, so `y`'s level must drop to `x`'s through the `Buffer`'s argument, and
   * `g` must not generalize over it. Without the arm `g` is used at `Int` and at
   * `String` and the program compiles, silently.
   */
  test("a variable reached through a `Buffer` is not generalized past its owner", () => {
    expect(diagnostics(
      "let f(x) =\n" +
      "    let g(y) =\n" +
      "        let b = if True then x else create!(1, y)\n" +
      "        length(b)\n" +
      "    let first = g!(1)\n" +
      "    let second = g!(\"s\")\n" +
      "    first + second\n",
    )).toEqual(["integer literal cannot have type `String`"]);
  });

  /**
   * The captured-collection walk follows a door type's argument like a holder
   * (FFI Part 1 §5.4), so an opaque carrier whose `Buffer` holds a captured
   * collection is item 2's refusal at an exported signature, naming the
   * collection.
   */
  test("a captured collection inside a `Buffer` is found by the capture walk", () => {
    expect(diagnostics(
      "opaque record Cell = {slots: Buffer(Array(Int))}\n" +
      "export let size(cell: Cell): Int = 0\n",
    )).toEqual([
      "opaque type `Cell` names the captured collection `Array(Int)` in its " +
      "representation (`slots`); an opaque value crosses the foreign boundary by " +
      "identity, so its representation cannot be copied at the crossing — keep an " +
      "identity-safe representation such as a `Vector` whose element types name " +
      "none in turn, or expose the collection through an exported accessor",
    ]);
  });

  test("an arrow inside a `Buffer` is recoloured at an instance seat", () => {
    expect(diagnostics(
      "let useImpure(fs: Buffer(Int ->! Int)): Int = length(fs)\n" +
      "constraint Holds<c> =\n" +
      "    first(x: c, fs: Buffer(Int -> Int)) -> Int\n" +
      "record Box = { n: Int }\n" +
      "honor Holds<Box> =\n" +
      "    first(x, fs) = useImpure(fs)\n",
    )).toEqual([
      "this instance demands a function that may perform effects where `first`'s " +
      "contract writes `->` inside the parameter `fs` — an invariant position admits " +
      "no widening — do not require effects of the function inside `fs` here, or, if " +
      "the constraint is yours, write `->!` on that arrow inside the parameter `fs`",
    ]);
  });
});

/**
 * A confined type has no pattern, permanently (§3.3's second property), so a
 * `match` over one is refused without the "yet" the unsupported-scrutinee
 * message otherwise carries: there is no representation for a pattern to read,
 * and no form to promise (Intrinsics §11).
 */
test("a `match` over a `Buffer` is refused as patternless, not as not-yet", () => {
  expect(diagnostics(
    "let f(b: Buffer(Int)): Int =\n" +
    "    match b\n" +
    "        _ => 0\n",
  )).toEqual([
    "`Buffer(Int)` is a compiler-implemented type and has no pattern; its values " +
    "are read only through the rows that declare it",
  ]);
});
