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
   * The three FFI-owned rows. `Array(a)` is FFI Part 2's borrowed foreign view
   * (§§6, 8–9) and Part 5 §6 records the obligation as discharged there;
   * `JsMap(k, v)` and `JsSet(a)` are Part 10 §6.1's, and they landed last
   * because the rows waited on the types having a representation to key a slot
   * on at all (#396). All three are typecheck-only here: executing them needs a
   * real foreign module, and what is in doubt is whether the slot exists.
   * `js-map-set.test.ts` runs the two views against genuine native values.
   */
  test("Array(a) gives a", () => {
    expect(messagesOf([["/main.hex",
      'extern from "./rows.js"\n' +
        "    fun rows(): Array(Int)\n" +
        "\n" +
        "export let main(): Int = Seq.length(toSeq(rows!()))\n",
    ]])).toEqual([]);
  });

  test("JsMap(k, v) gives the pair (k, v)", () => {
    expect(messagesOf([["/main.hex",
      'extern from "./rows.js"\n' +
        "    fun table(): JsMap(String, Int)\n" +
        "\n" +
        "export let main(): Int = Seq.length(toSeq(table!()))\n",
    ]])).toEqual([]);
  });

  test("JsSet(a) gives a", () => {
    expect(messagesOf([["/main.hex",
      'extern from "./rows.js"\n' +
        "    fun flags(): JsSet(Int)\n" +
        "\n" +
        "export let main(): Int = Seq.length(toSeq(flags!()))\n",
    ]])).toEqual([]);
  });

  /**
   * The element types at the loop head, pinned through uses that only
   * typecheck at the row's own element type: a key that is not a `String`
   * fails `++`, a value or element that is not an `Int` fails `+`. What a
   * `for..in` head exercises is the structural `For` arm — the rows' *erasure*
   * (#353, ruling 2) — so this is the erasure agreeing with Part 10 §6.1's
   * table. The rows' own `Item` bindings are pinned where `toSeq` consults
   * them: `js-map-set.test.ts`'s fold tests fail on a swapped pair.
   */
  test("the borrowed views' `Item` bindings are (k, v) and a", () => {
    expect(messagesOf([["/main.hex",
      'extern from "./rows.js"\n' +
        "    fun table(): JsMap(String, Int)\n" +
        "    fun flags(): JsSet(Int)\n" +
        "\n" +
        "export fun main(): Int =\n" +
        '    var text = ""\n' +
        "    var total = 0\n" +
        "    for (key, value) in table!()\n" +
        "        text := text ++ key\n" +
        "        total := total + value\n" +
        "    for flag in flags!()\n" +
        "        total := total + flag\n" +
        "    total + Seq.length(String.toSeq(text))\n",
    ]])).toEqual([]);
  });

  /** The pair is a pair: a single binder cannot stand for a `JsMap` item. */
  test("a `JsMap` item does not bind at the key's type", () => {
    expect(messagesOf([["/main.hex",
      'extern from "./rows.js"\n' +
        "    fun table(): JsMap(String, Int)\n" +
        "\n" +
        "export fun main(): String =\n" +
        '    var text = ""\n' +
        "    for key in table!()\n" +
        "        text := text ++ key\n" +
        "    text\n",
    ]]).join("\n")).toContain("type mismatch");
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

/**
 * §3.2's four-case taxonomy, and §3.3's two-legal-homes report (#395).
 *
 * Two of the four rows had no implementation before this file asserted them.
 * Both are about *what the compiler already knows and was not saying*: it knows
 * a declared type variable from an unsolved inference variable, and it knows —
 * because the orphan rule makes the search space exactly two — every module
 * that could legally supply a missing instance. The rows are grouped here
 * rather than split across the passes because the taxonomy is one decision:
 * each arm is defined by which other arms it is not.
 *
 * The §3.3 cases are whole *projects* rather than single modules by necessity.
 * The message names a file, so it has a route to compute, and a route needs two
 * positions — the module doing the iterating and the module holding the
 * declaration.
 */
describe("the `for p in e` failure taxonomy (Part 5 §3.2/§3.3)", () => {
  const BAG = "export union Bag(a) = Empty | Full(item: a)\n";

  /** The full §3.3 sentence, once, so the other cases can assert only what they vary. */
  test("a user nominal names both legal homes, leading with the actionable one", () => {
    expect(messagesOf([
      ["/app/bag.hex", BAG],
      ["/app/main.hex",
        'import { Bag, Empty } from "./bag"\n' +
          "let bag: Bag(Int) = Empty\n" +
          "export fun run(): Unit =\n" +
          "    for item in bag\n" +
          "        ()\n",
      ],
    ])).toContain(
      "`Bag(Int)` is not iterable. Define `honor Iterable<Bag(a)>` in `./bag.hex`, " +
        "which declares `Bag`. The only other legal home is the prelude module declaring " +
        "`Iterable`. Alternatively, convert with `Bag.toSeq`-style functions, or take a " +
        "`Seq(a)` parameter.",
    );
  });

  /**
   * The route is computed at the message, from the reporting module's own
   * position — which is why the declaration carries a project-root path rather
   * than one relative to whoever imported it. A same-directory default would
   * pass the case above and fail both of these.
   */
  test("the declaring file is named relative to the module doing the iterating", () => {
    const iterate = (specifier: string): string =>
      `import { Bag, Empty } from "${specifier}"\n` +
      "let bag: Bag(Int) = Empty\n" +
      "export fun run(): Unit =\n" +
      "    for item in bag\n" +
      "        ()\n";

    expect(messagesOf([
      ["/app/lib/bag.hex", BAG],
      ["/app/main.hex", iterate("./lib/bag")],
    ]).join("\n")).toContain("in `./lib/bag.hex`, which declares `Bag`");

    expect(messagesOf([
      ["/app/lib/bag.hex", BAG],
      ["/app/src/main.hex", iterate("../lib/bag")],
    ]).join("\n")).toContain("in `../lib/bag.hex`, which declares `Bag`");
  });

  /** The self-module case is not special-cased; it falls out as `./` plus the basename. */
  test("a nominal declared where it is iterated names that same file", () => {
    expect(messagesOf([
      ["/app/bag.hex",
        BAG +
          "let bag: Bag(Int) = Empty\n" +
          "export fun run(): Unit =\n" +
          "    for item in bag\n" +
          "        ()\n",
      ],
    ]).join("\n")).toContain(
      "Define `honor Iterable<Bag(a)>` in `./bag.hex`, which declares `Bag`",
    );
  });

  /**
   * The fixit is a *head*, so Constraints §5.4 governs its spelling twice over:
   * one constructor applied to distinct variables, which is why it says
   * `Pair(left, right)` and not the `Pair(Int, String)` that failed; and
   * **binder-less**, per §5.4 as amended by #390 — a parameterized head
   * introduces its own binders, and the `<...>` prefix exists to constrain
   * them, not to name them.
   */
  test("the honor fixit spells the declaration's own parameters, binder-less", () => {
    const messages = messagesOf([
      ["/app/pair.hex", "export record Pair(left, right) = {first: left, second: right}\n"],
      ["/app/main.hex",
        'import { Pair } from "./pair"\n' +
          'let pair: Pair(Int, String) = Pair({first = 1, second = "a"})\n' +
          "export fun run(): Unit =\n" +
          "    for item in pair\n" +
          "        ()\n",
      ],
    ]).join("\n");
    expect(messages).toContain(
      "`Pair(Int, String)` is not iterable. Define `honor Iterable<Pair(left, right)>` in " +
        "`./pair.hex`, which declares `Pair`.",
    );
    expect(messages).not.toContain("honor<");
  });

  /** A zero-parameter nominal is applied to nothing, so the head is the bare name. */
  test("a zero-parameter nominal gets an unapplied honor subject", () => {
    expect(messagesOf([
      ["/app/widget.hex", "export record Widget = {size: Int}\n"],
      ["/app/main.hex",
        'import { Widget } from "./widget"\n' +
          "let widget: Widget = Widget({size = 1})\n" +
          "export fun run(): Unit =\n" +
          "    for item in widget\n" +
          "        ()\n",
      ],
    ]).join("\n")).toContain(
      "`Widget` is not iterable. Define `honor Iterable<Widget>` in `./widget.hex`, " +
        "which declares `Widget`.",
    );
  });

  /**
   * `main` never imports the declaring module: the type arrives through
   * `make`'s result, and a nominal reached only that way is in no table `main`
   * built. The whole program's nominals are what answer, and the route is still
   * computed from `main`'s position — which is the case the report is *most*
   * worth having, since the file is exactly the one the user cannot see from
   * the import list.
   */
  test("a nominal reached only through an imported function's type still names its file", () => {
    expect(messagesOf([
      ["/app/lib/bag.hex", BAG],
      ["/app/middle.hex",
        'import { Bag, Empty } from "./lib/bag"\n' +
          "export fun make(): Bag(Int) = Empty\n",
      ],
      ["/app/src/main.hex",
        'import { make } from "../middle"\n' +
          "export fun run(): Unit =\n" +
          "    for item in make()\n" +
          "        ()\n",
      ],
    ]).join("\n")).toContain(
      "`Bag(Int)` is not iterable. Define `honor Iterable<Bag(a)>` in `../lib/bag.hex`, " +
        "which declares `Bag`.",
    );
  });

  /**
   * §4's closing note puts the prelude unions outside the user-nominal arm, and
   * the reason is the fixit: it would name a file the user cannot edit. They
   * take the concrete-non-iterable row's generic report instead.
   */
  test("a prelude union keeps the generic requirement failure", () => {
    const messages = projectDiagnostics(
      "let maybe: Option(Int) = Some(1)\n" +
        "export fun run(): Unit =\n" +
        "    for item in maybe\n" +
        "        ()\n",
    );
    expect(messages).toContain("type `Option(Int)` has no `Iterable` instance");
    expect(messages.join("\n")).not.toContain("is not iterable");
  });

  /**
   * §3.2's other new arm. A declared type variable and an unsolved inference
   * variable both stop step 2 of §3.1 with an unknown outer constructor, and
   * the one message they used to share was a false trail for the first: an
   * annotation fixes an inference variable and cannot fix a generic parameter,
   * which is generic on purpose. The binder ban (Part 2 §9) is the actual fact,
   * surfacing at a use site.
   */
  test("a rigid declared variable and an unsolved one get different messages", () => {
    expect(projectDiagnostics(
      "export fun visit(items: c): Unit =\n" +
        "    for item in items\n" +
        "        ()\n",
    )).toContain(
      "`items` has the generic type `c`, and `Iterable` cannot constrain a " +
        "type variable in v1; take a `Seq(a)` parameter instead",
    );

    // Unchanged by the split, which is the point of splitting rather than rewording.
    expect(projectDiagnostics(
      "export let visit = (items) =>\n" +
        "    for item in items\n" +
        "        ()\n",
    )).toContain(
      "cannot determine how to iterate this value; add a `Range`, `String`, " +
        "or `Seq(a)` type annotation",
    );
  });

  /** The concrete non-nominal row, unchanged: no home to name, so no homes named. */
  test("a concrete non-nominal type keeps its own report", () => {
    const messages = projectDiagnostics(
      "export fun run(): Unit =\n" +
        "    for item in 42\n" +
        "        ()\n",
    );
    expect(messages).toContain("type `Int` has no `Iterable` instance");
    expect(messages.join("\n")).not.toContain("legal home");
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

  /**
   * The same fact at the two FFI Part 10 rows (#396). Worth its own case rather
   * than folded into the `Vector` one: the appendix reads the row back out of
   * the instance table through `#subjectKey`, so a row seeded under a key
   * selection does not mint would leave the sentence silent — and silence is
   * what the `Vector` assertion above cannot distinguish from a missing row.
   */
  test("the borrowed views' rows are found by the same orphan appendix", () => {
    expect(projectDiagnostics(
      "honor Iterable<JsMap(k, v)> =\n" +
        "    type Item = (k, v)\n" +
        "    toSeq(xs) = Seq.empty\n",
    )).toContain(
      "orphan instance: this module declares neither `Iterable` nor the instance " +
        "subject; the prelude already provides `Iterable<JsMap(k, v)>`",
    );
    expect(projectDiagnostics(
      "honor Iterable<JsSet(a)> =\n" +
        "    type Item = a\n" +
        "    toSeq(xs) = Seq.empty\n",
    )).toContain(
      "orphan instance: this module declares neither `Iterable` nor the instance " +
        "subject; the prelude already provides `Iterable<JsSet(a)>`",
    );
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
