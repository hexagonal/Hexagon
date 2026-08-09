import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * `stdlib/Iterable.hex` and Collections Part 5's operational half (#353).
 *
 * The arc this file covers has one shape worth stating before the assertions,
 * because most of them are only interesting in its light: **the table is the
 * constraint** (Part 5 §1). `Iterable` was pre-registered by name with no
 * declaration behind it, so its members were reachable only through a user's
 * own `constraint Iterable<c> = ...` — the thing §5.1.1 calls a compiler gap
 * rather than a spec freedom. The declaring module closes it, and the nine
 * provided rows of §4 stop being a hard-wired dispatch table beside the
 * constraint system and become ordinary coherence slots inside it.
 *
 * What that buys is testable, and is what this file tests: `toSeq` is one bare
 * name with one exporter that works at every provided type; the per-type
 * qualified spellings survive as Modules §5.3 uniform-access reads even though
 * no companion exports them; the `Item` projection instantiates to the right
 * element type at each row; and the slots are occupied, which is what lets the
 * orphan report say the prelude already fills them.
 *
 * The rows keep **no source form** (§4). Nothing below writes one, and the
 * refusals that make writing one impossible are asserted rather than assumed.
 */

const mainOf = async (source: string): Promise<unknown> => {
  const exports = await runMain(source);
  return (exports["main"] as () => unknown)();
};

const messagesOf = (files: readonly (readonly [string, string])[]): readonly string[] =>
  compileFiles(files).diagnostics.map(({ message }) => message);

describe("the declaration lands, and the twin is refused", () => {
  /**
   * The other half of the ban. Until this arc the compiler held no `Iterable`
   * declaration, so banning the redeclaration would not have refused a twin —
   * it would have deleted the only spelling the feature had. With
   * `stdlib/Iterable.hex` a prelude member, the ban is the ordinary one all
   * eleven names now carry (Constraints §5.1.1).
   */
  test("a source `constraint Iterable` is refused like every other pre-registered name", () => {
    expect(projectDiagnostics(
      "constraint Iterable<c> =\n" +
        "    type Item\n" +
        "    toSeq(xs: c): Seq(Item)\n",
    )).toContain("constraint `Iterable` is pre-registered and cannot be redeclared");
  });

  test("the member is in bare scope with no import, and qualified at its declaring module", async () => {
    expect(await mainOf(
      "export let main(): Int = Seq.length(Iterable.toSeq([1, 2, 3]))\n",
    )).toBe(3);
  });

  /**
   * Part 5 §2.3's sole-exporter bullet, from the failing side. While `Vector`,
   * `Map` and `Set` each plain-exported `toSeq` the bare name was a four-way
   * Modules §5.5 collision and *every* bare call in §2.3 was refused naming
   * every home. One exporter is what makes the section's examples compile.
   */
  test("`toSeq` has one prelude exporter, so the bare name is not ambiguous", () => {
    expect(projectDiagnostics("export let main(): Int = Seq.length(toSeq([1]))\n"))
      .toEqual([]);
  });
});

describe("the provided rows: bare `toSeq` and the `Item` projection", () => {
  /**
   * Each row's element type is asserted through a *use* that only typechecks at
   * that type, never by reading the projection back: `++` needs `Concat`, `+`
   * needs `Num`, and a tuple pattern needs a pair. A row whose `Item` failed to
   * instantiate could not type any of these bodies.
   */
  test("Vector(a) gives a", async () => {
    expect(await mainOf(
      'export let main(): String = Seq.fold(toSeq(["a", "b"]), "", (acc, s) => acc ++ s)\n',
    )).toBe("ab");
  });

  test("Set(a) gives a", async () => {
    expect(await mainOf(
      "export let main(): Int = Seq.fold(toSeq(Set.fromVector([1, 2, 3])), 0, (acc, n) => acc + n)\n",
    )).toBe(6);
  });

  test("Map(k, v) gives the pair (k, v)", async () => {
    expect(await mainOf(
      'export let main(): String = Seq.fold(toSeq(Map.fromVector([(1, "a")])), "", (acc, pair) =>\n' +
        "    match pair\n" +
        '        (key, value) => acc ++ show(key) ++ value)\n',
    )).toBe("1a");
  });

  test("Range gives Int", async () => {
    expect(await mainOf(
      "export let main(): Int = Seq.fold(toSeq(1..4), 0, (acc, n) => acc + n)\n",
    )).toBe(10);
  });

  /**
   * §5.1: `Item = String`, one **codepoint** per item, permanently. The astral
   * character is the whole test — a UTF-16 code-unit walk would see four items
   * here, and a grapheme walk is explicitly not what the instance is.
   */
  test("String gives one-codepoint Strings", async () => {
    expect(await mainOf(
      'export let main(): Int = Seq.length(toSeq("h\u{1F600}i"))\n',
    )).toBe(3);
  });

  /**
   * §4's identity row, and the purity that makes it lawful: a persistent pure
   * sequence is re-traversable, so the sequence view of itself *is* itself. The
   * consumer this row exists for is the one normalizing a mixed bag of
   * iterables — it should pay nothing for the ones already in the currency.
   */
  test("Seq(a) is the identity, not a re-wrapping", async () => {
    expect(await mainOf(
      "export let main(): Int =\n" +
        "    let source: Seq(Int) = Vector.toSeq([1, 2, 3])\n" +
        "    Seq.fold(toSeq(source), 0, (acc, n) => acc + n)\n",
    )).toBe(6);
  });

  /**
   * Ruling 2 of the issue, on the emitted text: the checker's structural `For`
   * arms are the rows' **erasure**, not a mechanism beside them. A vector loop
   * asks for no evidence and emits a native `for…of`, exactly as it did before
   * the rows existed.
   */
  test("`for..in` over a provided type still erases to a native loop", () => {
    const project = compileFiles([[
      "/main.hex",
      "export let main(): Int =\n" +
        "    var total = 0\n" +
        "    for n in [1, 2, 3]\n" +
        "        total := total + n\n" +
        "    total\n",
    ]]);
    expect(project.diagnostics).toEqual([]);
    const javascript = project.modules
      .find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(javascript).toContain("for (const n of __hex_vectorOf([1, 2, 3]))");
    expect(javascript).not.toContain("toSeq");
  });
});

describe("the qualified spellings survive the retirement (Modules §5.3)", () => {
  /**
   * The companions no longer *export* `toSeq` — Constraints §4.6 forbids a
   * module-level binding of a member's spelling beside the instance — and every
   * per-type spelling still reads. That is the uniform-access read of a
   * provided row, homed at the companion the way `Int.show` is homed at
   * `stdlib/Int.hex`.
   */
  test("Vector, Set, Map and String all answer their qualified read", async () => {
    expect(await mainOf(
      "export let main(): Int =\n" +
        "    let vector = Seq.length(Vector.toSeq([1, 2]))\n" +
        "    let elements = Seq.length(Set.toSeq(Set.fromVector([1])))\n" +
        "    let pairs = Seq.length(Map.toSeq(Map.fromVector([(1, 2)])))\n" +
        '    let text = Seq.length(String.toSeq("abc"))\n' +
        "    vector + elements + pairs + text\n",
    )).toBe(7);
  });

  /**
   * The qualifier is not decoration: the read pins the row's subject, so the
   * wrong companion's spelling is a type error rather than a synonym for the
   * bare member.
   */
  test("the qualifier pins the subject", () => {
    expect(projectDiagnostics(
      "export let main(): Int = Seq.length(Map.toSeq([1, 2]))\n",
    )).not.toEqual([]);
  });

  /**
   * The name is no longer importable from the companion, which is the same fact
   * the surface tests state from the export side.
   */
  test("`toSeq` cannot be imported from a companion", () => {
    expect(messagesOf([
      ["/main.hex", 'import { toSeq } from "./Vector"\nexport let main(): Int = 1\n'],
    ])).toContain("module `./Vector` does not export `toSeq`");
  });
});

describe("occlusion (Modules §5.4, per Part 5 §2.3)", () => {
  /**
   * Ordinary prelude occlusion, asserted because §2.3 promises it explicitly:
   * a module-level user `toSeq` takes the bare name module-wide, and the
   * qualified form stays reachable. Nothing about the member being a member
   * changes either half.
   */
  test("a module-level `toSeq` occludes the bare member, and the qualified read survives", async () => {
    expect(await mainOf(
      "let toSeq(n: Int): Int = n * 2\n" +
        "export let main(): Int = toSeq(21) + Seq.length(Vector.toSeq([1]))\n",
    )).toBe(43);
  });
});

describe("provided rows occupy real slots (Part 5 §7.3)", () => {
  /**
   * The slot being genuinely occupied is what this asserts, and the message is
   * how it shows. A user `honor Iterable<Vector(a)>` fails the orphan rule
   * first — the file declares neither `Iterable` nor `Vector` — and the report
   * appends the fact worth knowing rather than leaving the user to guess why no
   * module may supply it.
   *
   * A duplicate-instance error proper is deliberately *absent*: §7.3 pins it as
   * unreachable for a prelude pair from user code, since satisfying the orphan
   * rule would mean editing the prelude.
   */
  test("the orphan report names the row the prelude already provides", () => {
    const messages = projectDiagnostics(
      "honor Iterable<Vector(a)> =\n" +
        "    type Item = a\n" +
        "    toSeq(xs) = Vector.toSeq(xs)\n",
    );
    expect(messages).toContain(
      "orphan instance: this module declares neither `Iterable` nor the instance " +
        "subject; the prelude already provides `Iterable<Vector(a)>`",
    );
    expect(messages.some((message) => message.startsWith("duplicate instance"))).toBe(false);
  });

  /** No source form, from the other side: a structural head is not a legal subject. */
  test("a structural head is refused outright (Constraints §5.4)", () => {
    expect(projectDiagnostics(
      "honor Iterable<Vector(a)> =\n" +
        "    type Item = a\n" +
        "    toSeq(xs) = Vector.toSeq(xs)\n",
    )).toContain("an instance head must name a primitive or nominal type constructor");
  });

  /**
   * The table's public door still opens. A user collection needs exactly one
   * small `honor` block (§8.1's recipe), and the orphan hint does not fire for
   * it — the slot is the user's, not the prelude's.
   */
  test("a user row at a user nominal is accepted, and the hint stays silent", async () => {
    expect(await mainOf(
      "record Bag(a) = {items: Vector(a)}\n" +
        "honor Iterable<Bag(a)> =\n" +
        "    type Item = a\n" +
        "    toSeq(bag) = Vector.toSeq(bag.items)\n" +
        "export let main(): Int =\n" +
        "    var total = 0\n" +
        "    for n in Bag({items = [1, 2, 3]})\n" +
        "        total := total + n\n" +
        "    total\n",
    )).toBe(6);
  });
});

describe("`String.fromSeq`, the full §5.3 contract", () => {
  test("the empty sequence produces the empty string", async () => {
    expect(await mainOf(
      'export let main(): String = String.fromSeq(Seq.empty) ++ "|"\n',
    )).toBe("|");
  });

  /**
   * Forgiving, like every `from*` constructor: elements are strings of any
   * length, concatenated in traversal order. `Vector.fromSeq` accepts any `Seq`
   * rather than only ones its own `toSeq` produced, and this is the same
   * stance — the strict codepoints-only alternative is a rejected one (§13.3).
   */
  test("elements may be any length, and concatenate in traversal order", async () => {
    expect(await mainOf(
      'export let main(): String = String.fromSeq(toSeq(["ab", "", "c"]))\n',
    )).toBe("abc");
  });

  /**
   * The round-trip law, and it is deliberately **one-sided**: `fromSeq ∘ toSeq`
   * is the identity on every string, while the converse makes no chunk-boundary
   * claim at all. Nothing here asserts one — `toSeq(fromSeq(xs))` yields
   * one-codepoint items, not `xs`'s original chunks, and the second expectation
   * pins exactly that rather than leaving it to be assumed.
   */
  test("`fromSeq(toSeq(s)) == s`, and the converse preserves no chunks", async () => {
    expect(await mainOf(
      'export let main(): String = String.fromSeq(String.toSeq("h\u{1F600}i, wörld"))\n',
    )).toBe("h\u{1F600}i, wörld");
    expect(await mainOf(
      'export let main(): Int = Seq.length(String.toSeq(String.fromSeq(toSeq(["ab", "cd"]))))\n',
    )).toBe(4);
  });

  /**
   * No normalization, ever (§5.3). The two inputs here are the composed and
   * decomposed spellings of the same character; `fromSeq` must return the
   * codepoints it was given, so the results differ in length. A `fromSeq` that
   * canonicalized would make these equal and the difference would vanish
   * silently.
   */
  test("no Unicode normalization occurs", async () => {
    expect(await mainOf(
      'export let main(): Bool = String.fromSeq(toSeq(["é"])) == String.fromSeq(toSeq(["é"]))\n',
    )).toBe(false);
  });

  /**
   * The implementation note is **binding on the emitter** (§5.3): collect
   * chunks and join. The fold of `++` the section gives as the semantics must
   * not be what runs, because repeated immutable concatenation is quadratic and
   * the same sentence rules it out by name. Read off the emitted text, since
   * behaviour alone cannot distinguish the two.
   */
  test("the lowering joins rather than folding `++`", () => {
    const project = compileFiles([[
      "/main.hex",
      'export let main(): String = String.fromSeq(toSeq(["a"]))\n',
    ]]);
    expect(project.diagnostics).toEqual([]);
    const javascript = project.modules
      .find(({ source }) => source.path === "/String.hex")!.javascript.text;
    expect(javascript).toContain('.join("")');
  });

  /** `Seq` is exempt from the conversion suite: the currency needs none into itself. */
  test("there is no `Seq.fromSeq`", () => {
    expect(projectDiagnostics(
      "export let main(): Seq(Int) = Seq.fromSeq(Vector.toSeq([1]))\n",
    )).toContain("module `Seq` does not export `fromSeq`");
  });

  /** `Range` is iterable but is not a collection, so it has no `fromSeq` either (§1). */
  test("there is no `Range.fromSeq`", () => {
    expect(projectDiagnostics(
      "export let main(): Int = Range.fromSeq(Vector.toSeq([1]))\n",
    )).not.toEqual([]);
  });
});
