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
   *
   * The behavioural half alone **cannot fail for that property**: a row that
   * re-wrapped the sequence in a fresh adapter spine would sum to 3 just the
   * same, and "pay nothing" is exactly what a sum cannot observe. So the
   * emitted slot is read as well. `__hex_source => __hex_source` is the claim;
   * `__hex_seqFromIterable` in that position would be the defect.
   *
   * The sequence is built from `Seq`'s own producers rather than with
   * `Vector.toSeq`, and that is what makes the negative assertion mean
   * anything: a `Vector` read in the same fixture emits the *vector* row, whose
   * slot is legitimately `__hex_seqFromIterable`, and the two rows' dictionaries
   * are indistinguishable by text.
   */
  test("Seq(a) is the identity, not a re-wrapping", async () => {
    const source =
      "export let main(): Int =\n" +
      "    let sequence: Seq(Int) = Seq.prepend(Seq.prepend(Seq.empty, 2), 1)\n" +
      "    Seq.fold(toSeq(sequence), 0, (acc, n) => acc + n)\n";
    const project = compileFiles([["/main.hex", source]]);
    expect(project.diagnostics).toEqual([]);
    const javascript = project.modules
      .find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
    expect(javascript).toContain("({ toSeq: __hex_source => __hex_source })");
    expect(javascript).not.toContain("({ toSeq: __hex_seqFromIterable })");
    expect(await mainOf(source)).toBe(3);
  });

  /**
   * The member's result is a `Seq`, and a `Seq` is **persistent** — traversing
   * it does not consume it (Loops §6.2/§6.4). That is not free at a row whose
   * subject is a single-shot JavaScript iterable: `seqFromIterable`'s memoizing
   * spine is what makes the second traversal replay rather than find the source
   * exhausted, and this is the assertion that would catch its loss. A
   * non-memoizing adapter answers 3 + 0 here, not 3 + 6.
   */
  test("the member's `Seq` is re-traversable", async () => {
    expect(await mainOf(
      "export let main(): Int =\n" +
        "    let sequence: Seq(Int) = toSeq([1, 2, 3])\n" +
        "    Seq.length(sequence) + Seq.fold(sequence, 0, (acc, n) => acc + n)\n",
    )).toBe(9);
  });

  /**
   * The one FFI-owned row that has a type to key a slot on. `Array(a)` is the
   * borrowed foreign view (FFI Part 2 §§6, 8–9), and Part 5 §6 records the
   * obligation as discharged there — so the row belongs in the table even
   * though nothing about the borrow contract is this file's business.
   * Typecheck only: executing it would need a real foreign module, and what is
   * in doubt is whether the slot exists, not what JavaScript does with an array.
   *
   * Its two siblings, `JsMap(k, v)` and `JsSet(a)`, are deliberately absent:
   * neither is representable in the type system yet — no `Mono`, no annotation
   * kind — so there is no subject to key their slots on. They land with FFI
   * Part 10's types.
   */
  test("Array(a) gives a", () => {
    expect(messagesOf([["/main.hex",
      'extern from "./rows.js"\n' +
        "    fun rows(): Array(Int)\n" +
        "\n" +
        "export let main(): Int = Seq.length(toSeq(rows!()))\n",
    ]])).toEqual([]);
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

  /**
   * Part 5 §9.3: **no `Iterable`, `Item`, or `Iterable`-instance machinery
   * appears in `.d.ts`.** The guarantee is by construction rather than by
   * filtering — the constraint cannot leak, because no binder can carry it
   * (Part 2 §8), instances are never exports (Modules §11.5), and the v1
   * reference ban keeps `Item` out of every signature — which is precisely why
   * it is worth an assertion: a by-construction property has no code to review
   * when it stops holding.
   *
   * Asked of a *user* instance, since that is the only kind with a dictionary
   * that could be exported at all. The scope is `Iterable` machinery
   * specifically; other constraints' foreign representation is the FFI spec's
   * business and is asserted neither way (§18.2).
   *
   * `Bag` holds a `Vector`, not a `Seq`, and the substitution is load-bearing:
   * a `Seq(a)` *itself* faces as `Iterable<a>` (Loops §6.5), which §9.3 calls
   * out as a statement about `Seq` rather than about the constraint. A fixture
   * holding one would put the word in the face honestly and leave the
   * assertion unable to tell that from a leak.
   */
  test("no `Iterable` machinery reaches the `.d.ts` face", () => {
    const project = compileFiles([["/main.hex",
      "export record Bag = {items: Vector(Int)}\n" +
        "honor Iterable<Bag> =\n" +
        "    type Item = Int\n" +
        "    toSeq(bag) = Vector.toSeq(bag.items)\n" +
        "export let count(bag: Bag): Int = Vector.length(bag.items)\n",
    ]]);
    expect(project.diagnostics).toEqual([]);
    const face = project.modules
      .find(({ source }) => source.path === "/main.hex")!.declarations.text;
    expect(face).toContain("Bag");
    expect(face).not.toContain("Iterable");
    expect(face).not.toContain("Item");
    expect(face).not.toContain("toSeq");
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
