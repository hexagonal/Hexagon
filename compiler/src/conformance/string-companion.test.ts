import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * PR δ3 of #344: **`String` is a source companion.** `stdlib/String.hex` is the
 * primitive's home module (Constraints §5.3) and its five instances — `Eq`,
 * `Ord`, `Show`, `Concat`, `Hash` — are ordinary `honor` blocks. It exports
 * nothing else: length, slicing, and joining belong to the listing and
 * collections surfaces, so the companion is instances and nothing more, and its
 * milestone retired `String`'s wired rows and Modules §5.3's transitional
 * spelling in the same change.
 *
 * Two of the five carry semantics no operator has. `Ord<String>` is the
 * codepoint order of Primitive Types §5, which disagrees with the host's own
 * `<` on exactly the astral characters — and no strictly simpler Hexagon can
 * express it, the language having no codepoint API. `Show<String>` is the
 * identity by ruling, which is why interpolation splices a string bare instead
 * of calling anything. **Everything that can run, runs**, because a re-homing
 * that quietly reverted either to the host's default would still compile.
 *
 * The programs are deliberately byte-distinct from one another: two conformance
 * modules whose emitted JavaScript is identical share one instance through the
 * ESM data-URL cache, and a pin that silently measures its neighbour's module is
 * a pin that cannot fail.
 */

/** `/main.hex`'s emitted JavaScript, which must have compiled cleanly. */
function emitted(source: string): string {
  const project = compileMain(source);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

/** `stdlib/String.hex`'s emitted JavaScript, as the prelude compiled it. */
function companion(source: string): string {
  const project = compileMain(source);
  expect(project.diagnostics).toEqual([]);
  return project.modules
    .find(({ source: file }) => file.path.endsWith("/String.hex"))!.javascript.text;
}

/** Every diagnostic message a multi-module project produced, in order. */
function diagnostics(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

describe("the control: diagnostics are project-level, so prove the probe can fail", () => {
  test("an unknown name is still refused", () => {
    expect(projectDiagnostics('export let r: String = joyn("a", "b")\n'))
      .toEqual(["unknown name `joyn`"]);
  });
});

describe("the four spellings are one implementation", () => {
  /**
   * At `String` the fourth spelling is the strangest of the language's four:
   * interpolation of a string into a string, where `Show`'s identity means the
   * value is spliced with nothing called at all. It must still agree with the
   * other three, because it is the same instance.
   */
  test("`show` agrees qualified, after a dot, interpolated, and under a bound", async () => {
    const exports = await runMain([
      'export let qualified: String = String.show("raw")',
      'export let dotted: String = "raw".show()',
      'export let interpolated: String = "${"raw"}"',
      "let render<a: Show>(value: a): String = show(value)",
      'export let generic: String = render("raw")',
      "",
    ].join("\n"));

    expect(exports["qualified"]).toBe("raw");
    expect(exports["dotted"]).toBe("raw");
    expect(exports["interpolated"]).toBe("raw");
    expect(exports["generic"]).toBe("raw");
  });

  /**
   * And `concat`, whose fourth spelling is the `++` operator — the one that
   * inlines, and therefore the one that could silently stop agreeing with the
   * slot the other three reach.
   */
  test("`concat` agrees qualified, after a dot, under a bound, and as `++`", async () => {
    const exports = await runMain([
      'export let qualified: String = String.concat("north", "wind")',
      'let opening: String = "north"',
      'export let dotted: String = opening.concat("wind")',
      // `Concat.concat` rather than bare: `concat` has had two exporters since
      // the `Seq.hex` landing, so the bare spelling is a Modules §5.5 refusal —
      // the same accepted regression `mod`/`rem` took at this one.
      "let join2<a: Concat>(left: a, right: a): a = Concat.concat(left, right)",
      'export let generic: String = join2("north", "wind")',
      'export let operator: String = "north" ++ "wind"',
      "",
    ].join("\n"));

    expect(exports["qualified"]).toBe("northwind");
    expect(exports["dotted"]).toBe("northwind");
    expect(exports["generic"]).toBe("northwind");
    expect(exports["operator"]).toBe("northwind");
  });
});

describe("Primitive Types §5's codepoint order, executed", () => {
  /**
   * The case the host gets wrong. JavaScript's `<` compares UTF-16 code units,
   * so `"\u{10000}"` — whose first unit is a surrogate at 0xD800 — sorts
   * *before* `"\u{FFFF}"`. Hexagon's order is by code point, so the astral
   * character sorts after every character of the basic plane. This is why
   * `stringCompare` crosses the door: no simpler Hexagon can say it.
   */
  test("an astral character orders after the whole basic plane", async () => {
    const exports = await runMain([
      'let lastOfPlane: String = "\\u{FFFF}"',
      'let firstAstral: String = "\\u{10000}"',
      "export let byCodepoint: Bool = lastOfPlane < firstAstral",
      "export let notTheOtherWay: Bool = firstAstral < lastOfPlane",
      "export let ordered: Ordering = Ord.compare(firstAstral, lastOfPlane)",
      "",
    ].join("\n"));

    expect(exports["byCodepoint"]).toBe(true);
    expect(exports["notTheOtherWay"]).toBe(false);
    expect(exports["ordered"]).toBe("Greater");
  });

  /** The ordinary cases, which must not have been traded away for that one. */
  test("prefixes, case, and equal text order as they always did", async () => {
    const exports = await runMain([
      'export let alphabetical: Bool = "apple" < "banana"',
      'export let prefixFirst: Bool = "app" < "apple"',
      'export let upperFirst: Bool = "Zebra" < "apple"',
      'export let ties: Ordering = Ord.compare("same", "same")',
      'export let empty: Bool = "" < "a"',
      "",
    ].join("\n"));

    expect(exports["alphabetical"]).toBe(true);
    expect(exports["prefixFirst"]).toBe(true);
    expect(exports["upperFirst"]).toBe(true);
    expect(exports["ties"]).toBe("Equal");
    expect(exports["empty"]).toBe(true);
  });

  /** `Eq<String>` is the host's `===`, and `Hash<String>` agrees with it. */
  test("equal text is equal and hashes equally", async () => {
    const exports = await runMain([
      'let built: String = "ab" ++ "c"',
      'export let same: Bool = built == "abc"',
      'export let hashesAgree: Bool = Hash.hash(built) == Hash.hash("abc")',
      'export let differs: Bool = "abc" != "abd"',
      'let keys: Set(String) = Set.add(Set.add(Set.empty, built), "abc")',
      "export let collapsed: Int = Set.size(keys)",
      "",
    ].join("\n"));

    expect(exports["same"]).toBe(true);
    expect(exports["hashesAgree"]).toBe(true);
    expect(exports["differs"]).toBe(true);
    expect(exports["collapsed"]).toBe(1);
  });
});

describe("`Show<String>` is the identity, and takes no key for it", () => {
  /**
   * Primitive Types §7's ruling: a string's canonical textual form is the
   * string, with no quoting and no escaping. The body is the plain binding
   * `value`, so the strictly-simpler doctrine keeps it out of the door
   * altogether — the `Signed<Int>.fromInt` precedent, at the other companion.
   */
  test("`show` returns its argument, quotes and newlines untouched", async () => {
    const exports = await runMain([
      'export let plain: String = show("hello")',
      'export let quoted: String = show("she said \\"go\\"")',
      'export let empty: String = show("")',
      'export let escaped: String = show("a\\nb")',
      "",
    ].join("\n"));

    expect(exports["plain"]).toBe("hello");
    expect(exports["quoted"]).toBe('she said "go"');
    expect(exports["empty"]).toBe("");
    expect(exports["escaped"]).toBe("a\nb");
  });

  /**
   * The emitted shape the identity buys: interpolating a string splices it
   * bare, where interpolating a `Float` calls the host's `String`. If
   * `Show<String>` ever stopped being the identity, this is the line that would
   * change in every module in the corpus.
   */
  test("interpolation splices a string bare and converts everything else", () => {
    const text = emitted([
      'let name: String = "ada"',
      'export let greeting: String = "hi ${name}"',
      'export let mixed: String = "${name} is ${36}"',
      "",
    ].join("\n"));

    expect(text).toContain('const greeting = "hi " + name;');
    expect(text).toContain('const mixed = name + " is " + String(36);');
  });

  /** And the companion's own body is the binding, with no host call behind it. */
  test("`String.js` holds `show` as the plain binding", () => {
    const text = companion('export let rendered: String = String.show("x")\n');

    // The member's implementation is its own module-level binding since #444 —
    // §4.6's law reaching emission — and the record's slot names it.
    expect(text).toContain("const __Show_String_show = value => value;");
    expect(text).toContain("const __Show_String = { show: __Show_String_show };");
    expect(text).not.toContain("show: value => String(value)");
  });
});

describe("the wired rows are gone, not dormant", () => {
  /**
   * The load-bearing describe. A row that merely stopped being *selected* would
   * be emitted again the moment anything reached it, so this asserts absence in
   * the output rather than agreement in the answers — reinstating the retired
   * `supports` table or the `primitiveDictionary` builder has to fail here.
   */
  test("no dictionary literal is built beside the companion's export", () => {
    const text = emitted([
      "let join3<a: Concat>(left: a, right: a): a = Concat.concat(left, right)",
      'export let joined: String = join3("water", "fall")',
      "let least<a: Ord>(left: a, right: a): a = if left < right then left else right",
      'export let earlier: String = least("beta", "alpha")',
      "",
    ].join("\n"));

    expect(text).not.toContain("concat: (__a, __b) => __a + __b");
    expect(text).not.toContain("show: __a => __a");
    expect(text).toContain('__Concat_String } from "./String.js"');
    expect(text).toContain('__Ord_String } from "./String.js"');
  });

  /**
   * `String.hex` exports no terms at all, so every qualified spelling that is
   * not an honored member misses as an ordinary does-not-export at a real
   * module — the same report a user's own module would give, with no curated
   * companion sentence anywhere.
   */
  test("`String.length` misses as an ordinary export, and so does `String.join`", () => {
    expect(projectDiagnostics('export let n: Int = String.length("abc")\n'))
      .toEqual(["module `String` does not export `length`"]);
    expect(projectDiagnostics('export let j: String = String.join("a", "b")\n'))
      .toEqual(["module `String` does not export `join`"]);
  });

  /**
   * And the dot call takes Method Syntax §9's neither-error for the same names,
   * while the honored members it *does* have keep resolving — which is what
   * makes this a routing pin rather than a blanket refusal.
   */
  test("a `length` dot call takes the neither-error, `concat` does not", () => {
    expect(projectDiagnostics('export let n: Int = "abc".length()\n')).toEqual([
      "`String` has no field `length`, its companion exports no operation " +
        "`length`, and no constraint honored at `String` has a subject-first " +
        "member `length`; call an available subject-first function explicitly",
    ]);
    expect(projectDiagnostics('export let c: String = "ab".concat("cd")\n')).toEqual([]);
  });
});

describe("Constraints §6.1's inlining survives the move", () => {
  /**
   * `++` at `String` keeps inlining as `+`, and `==` as `===`; only `<` reaches
   * a helper, because the codepoint order is not what the host's operator does.
   * Byte-stability here is the readable-JavaScript goal: string building must
   * not become a dictionary call because its instance changed address.
   */
  test("`++` and `==` still emit as operators, `<` as the codepoint comparator", () => {
    const text = emitted([
      'export let joined: String = "left" ++ "right"',
      'export let identical: Bool = "left" == "left"',
      'export let different: Bool = "left" != "right"',
      'export let ordered: Bool = "left" < "right"',
      "",
    ].join("\n"));

    expect(text).toContain('const joined = "left" + "right";');
    expect(text).toContain('const identical = "left" === "left";');
    // `!=` is `Eq`'s defaulted `notEquals`, which is the negation of `equals` —
    // so the inlining shows through it rather than around it.
    expect(text).toContain('const different = !("left" === "right");');
    expect(text).toContain('const ordered = __compareString("left", "right") < 0;');
  });

  /**
   * The derived leaves keep their inline arms too (#278's guard exempts a
   * primitive component, which has exactly one instance to bypass). A container
   * deriving over a `String` field must not start calling a dictionary slot for
   * what the table renders directly — and `Show`'s identity means the field is
   * spliced rather than converted.
   */
  test("a record deriving over a `String` field still inlines its leaf arms", async () => {
    const source = [
      "export record Label derives (Eq, Ord, Show, Hash) = {text: String}",
      'let here = Label({text = "north"})',
      'let alsoHere = Label({text = "north"})',
      "export let same: Bool = here == alsoHere",
      "export let shown: String = show(here)",
      "export let hashed: Bool = Hash.hash(here) == Hash.hash(alsoHere)",
      "",
    ].join("\n");
    const exports = await runMain(source);
    const text = emitted(source);

    expect(exports["same"]).toBe(true);
    expect(exports["shown"]).toBe("{text = north}");
    expect(exports["hashed"]).toBe(true);
    expect(text).toContain("__left.text === __right.text");
    expect(text).toContain("__ordering(__compareString(__left.text, __right.text))");
    // `Show<String>`'s identity, in a derived body: the field is spliced.
    expect(text).toContain('"text = " + __value.text');
  });

  /**
   * The syntax forms that read a string's contents are not the companion's and
   * never were — `s[i]` and `s[a..b]` are Primitive Types' own indexing, over
   * their own helpers, and they must survive a landing that touched neither.
   */
  test("indexing and slicing keep their own helpers", async () => {
    const exports = await runMain([
      'let word: String = "hexagon"',
      // One-based, and by code point: Primitive Types' own indexing, over the
      // `stringIndex`/`stringSlice` helpers, which the companion never touched.
      "export let third: String = word[3]",
      "export let head: String = word[1..3]",
      "",
    ].join("\n"));

    expect(exports["third"]).toBe("x");
    expect(exports["head"]).toBe("hex");
  });
});

describe("`String.hex` is instances and nothing else", () => {
  /**
   * The companion declares no exception, no conversion, and no export beyond
   * its five instances — `String` has no partial operation to guard, and its
   * contents belong to the listing surfaces. This is the shape assertion that
   * would notice a helpful addition creeping in.
   */
  test("the emitted module holds five natives, five dictionaries, and no guard", () => {
    // A program that reaches every instance through a dictionary, so the whole
    // companion is compiled and none of its blocks can be dead.
    const text = companion([
      "let least<a: Ord>(left: a, right: a): a = if left < right then left else right",
      "let render<a: Show>(value: a): String = show(value)",
      "let join5<a: Concat>(left: a, right: a): a = Concat.concat(left, right)",
      "let key<a: Hash>(value: a): Int = Hash.hash(value)",
      'export let all: String = render(join5(least("b", "a"), "c")) ++ show(key("z"))',
      "",
    ].join("\n"));

    expect(text).toContain("const nativeConcat = (__a, __b) => __a + __b;");
    expect(text).toContain("const nativeEquals = (__a, __b) => __a === __b;");
    expect(text).toContain(
      "const nativeCompare = (__a, __b) => " +
        "__ordering(__compareString(__a, __b));",
    );
    expect(text).toContain("const nativeHash = __a => __stableHash(__a);");
    // The fifth native (#353): Collections Part 5 §5.3's `String.fromSeq`, and
    // its binding implementation note — collect chunks and **join**, never the
    // fold of `++` the section describes semantically, which would be quadratic.
    expect(text).toContain(
      'const fromSeq = __values => [...__seqToIterable(__values)].join("");',
    );
    for (const constraint of ["Eq", "Ord", "Show", "Concat", "Hash"]) {
      expect(text).toContain(`__${constraint}_String`);
    }
    // "No guard" is a claim about *this companion's* code, and it is asked of
    // exactly that: the module's own bindings are the unindented `const` and
    // `export` lines, while the runtime helper bodies above them are indented.
    // The distinction became load-bearing when `fromSeq` pulled in the `Seq`
    // driver, which throws `ReentrancyError` — a helper's guard, not
    // `String`'s. A string still has no partial operation.
    const own = text.split("\n")
      .filter((line) => line.startsWith("const ") || line.startsWith("export "))
      .join("\n");
    expect(own).not.toContain("throw");
    expect(own).not.toContain("Error(");
  });

  /**
   * A user module may still export names the companion does not, and reach them
   * bare — `String.hex` claiming the module name takes nothing out of the
   * bare namespace, because a companion's instances bind qualifiably rather
   * than as bare exports (Constraints §4.6's one-exporter law).
   */
  test("a user module's own `length` and `join` are unaffected", async () => {
    const exports = await runProjectLike();

    expect(exports["size"]).toBe(3);
    expect(exports["joined"]).toBe("a/b");
  });
});

/** The multi-module case above, kept out of the test body for readability. */
async function runProjectLike(): Promise<Record<string, unknown>> {
  const files = [
    ["/text.hex",
      "export let length(value: String): Int = 3\n" +
      "export let join(left: String, right: String): String = left ++ \"/\" ++ right\n"],
    ["/main.hex",
      'import { length, join } from "./text"\n' +
      'export let size: Int = length("abc")\n' +
      'export let joined: String = join("a", "b")\n'],
  ] as const;

  expect(diagnostics(files)).toEqual([]);
  const { runProject } = await import("../support/test-project.js");
  return (await runProject(files)) as Record<string, unknown>;
}
