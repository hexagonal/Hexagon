import { describe, expect, test } from "vitest";

import { PRELUDE_MODULES } from "../prelude.js";
import { compileMain, runMain } from "../support/test-project.js";

function elements(value: unknown): unknown[] {
  return [...(value as Iterable<unknown>)];
}

describe("String text processing", () => {
  test("the companion follows Iterable and Vector", () => {
    const order = PRELUDE_MODULES.map(({ name }) => name);
    expect(order.indexOf("String")).toBeGreaterThan(order.indexOf("Iterable"));
    expect(order.indexOf("String")).toBeGreaterThan(order.indexOf("Vector"));
  });

  test("length, lines, words, splitting, drops, and trimming use codepoints", async () => {
    const exports = await runMain([
      "module Main",
      "",
      'export let count: Int = "😀a".length()',
      'export let lineParts: Vector(String) = "a\\r\\nb\\rc\\n\\n".lines()',
      'export let wordParts: Vector(String) = " \\u{85}a\\tb\\u{FEFF}c ".words()',
      'export let exactParts: Vector(String) = ",a,".split(",")',
      'export let emptyParts: Vector(String) = "😀a".split("")',
      'export let foldedParts: Vector(String) = "OneENDTwoendThree".splitCi("end")',
      'export let dropped: String = "😀abc".dropFirstN(2)',
      'export let kept: String = "abc".dropLastN(-3)',
      'export let trimmed: String = " \\u{FEFF}x ".trim()',
      "",
    ].join("\n"));

    expect(exports["count"]).toBe(2);
    expect(elements(exports["lineParts"])).toEqual(["a", "b", "c", ""]);
    expect(elements(exports["wordParts"])).toEqual(["a", "b\uFEFFc"]);
    expect(elements(exports["exactParts"])).toEqual(["", "a", ""]);
    expect(elements(exports["emptyParts"])).toEqual(["", "😀", "a", ""]);
    expect(elements(exports["foldedParts"])).toEqual(["One", "Two", "Three"]);
    expect(exports["dropped"]).toBe("bc");
    expect(exports["kept"]).toBe("abc");
    expect(exports["trimmed"]).toBe("\uFEFFx");
  });

  test("full folding observes original-codepoint boundaries", async () => {
    const exports = await runMain([
      "module Main",
      "",
      'export let whole: Bool = "Straße".containsCi("STRASSE")',
      'export let expansion: Bool = "ß".containsCi("ss")',
      'export let reverse: Bool = "ss".containsCi("ß")',
      'export let half: Bool = "ß".containsCi("s")',
      'export let prefixHalf: Bool = "ß".startsWithCi("s")',
      'export let suffixHalf: Bool = "ß".endsWithCi("s")',
      'export let exactEmpty: Bool = "".startsWith("") and "".endsWith("")',
      "",
    ].join("\n"));

    expect(exports).toMatchObject({
      whole: true,
      expansion: true,
      reverse: true,
      half: false,
      prefixHalf: false,
      suffixHalf: false,
      exactEmpty: true,
    });
  });

  test("replacement is literal, non-overlapping, and boundary-aware", async () => {
    const exports = await runMain([
      "module Main",
      "",
      'export let overlap: String = "aaa".replace("aa", "x")',
      'export let inserted: String = "😀a".replace("", "-")',
      'export let insertedEmpty: String = "".replace("", "-")',
      'export let first: String = "ab".replaceFirst("", "-")',
      'export let folded: String = "aßb".replaceCi("SS", "!")',
      'export let foldedFirst: String = "ß SS".replaceFirstCi("ss", "!")',
      'export let tokensLiteral: String = "a$a".replace("$", "$&")',
      "",
    ].join("\n"));

    expect(exports).toMatchObject({
      overlap: "xa",
      inserted: "-😀-a-",
      insertedEmpty: "-",
      first: "-ab",
      folded: "a!b",
      foldedFirst: "! SS",
      tokensLiteral: "a$&a",
    });
  });

  test("joining and first/last searches use sequence order and 1-based positions", async () => {
    const exports = await runMain([
      "module Main",
      "",
      'export let joined: String = String.join(Iterable.toSeq(["a", "", "b"]), "/")',
      'export let first: Option(Int) = "😀hello".indexOf("hello")',
      'export let last: Option(Int) = "aaa".lastIndexOf("aa")',
      'export let firstFolded: Option(Int) = "xßy".indexOfCi("ss")',
      'export let lastEmpty: Option(Int) = "😀a".lastIndexOf("")',
      'export let absent: Option(Int) = "abc".indexOf("z")',
      "",
    ].join("\n"));

    expect(exports["joined"]).toBe("a//b");
    expect(exports["first"]).toEqual({ tag: "Some", value: 2 });
    expect(exports["last"]).toEqual({ tag: "Some", value: 2 });
    expect(exports["firstFolded"]).toEqual({ tag: "Some", value: 2 });
    expect(exports["lastEmpty"]).toEqual({ tag: "Some", value: 3 });
    expect(exports["absent"]).toEqual({ tag: "None" });
  });

  test("Unicode 17 casing, folding, and scalar conversions are checked", async () => {
    const exports = await runMain([
      "module Main",
      "",
      'export let upper: String = "Straße".toUpper()',
      'export let lowerFinal: String = "ΟΣ".toLower()',
      'export let lowerMedial: String = "ΟΣΑ".toLower()',
      'export let lowerFinalIgnored: String = String.toLower("Α\\u{301}Σ")',
      'export let lowerMedialIgnored: String = String.toLower("ΑΣ\\u{301}Β")',
      'export let folded: String = "Straße".caseFold()',
      'export let point: Option(Int) = "😀".toCodepoint()',
      'export let made: Option(String) = String.fromCodepoint(128_512)',
      'export let multi: Option(Int) = "ab".toCodepoint()',
      'export let surrogate: Option(String) = String.fromCodepoint(55_296)',
      "",
    ].join("\n"));

    expect(exports).toMatchObject({
      upper: "STRASSE",
      lowerFinal: "ος",
      lowerMedial: "οσα",
      lowerFinalIgnored: "α\u0301ς",
      lowerMedialIgnored: "ασ\u0301β",
      folded: "strasse",
      point: { tag: "Some", value: 128512 },
      made: { tag: "Some", value: "😀" },
      multi: { tag: "None" },
      surrogate: { tag: "None" },
    });
  });

  test("trusted-FFI lone surrogates round-trip but are not scalars", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "export let inspect(value: String): (Int, String, String, Option(Int)) =",
      "    (value.length(), value.replace(\"\", \"-\"), value.caseFold(), value.toCodepoint())",
      "",
    ].join("\n"));
    const inspect = exports["inspect"] as (value: string) => unknown[];
    expect(inspect("\uD800")).toEqual([1, "-\uD800-", "\uD800", { tag: "None" }]);
  });

  test("the emitted companion owns policy and references pinned table helpers", () => {
    const project = compileMain(
      "module Main\n\n" + 'export let folded: String = "Straße".caseFold()\n',
    );
    expect(project.diagnostics).toEqual([]);
    const text = project.modules.find(({ source }) => source.path.endsWith("/String.hex"))!
      .javascript.text;
    expect(text).toContain("const caseFold = text =>");
    expect(text).toContain("new RegExp(");
    expect(text).toContain("new Map(");
    expect(text).not.toContain("toLocaleLowerCase");
    expect(text).not.toContain("toLocaleUpperCase");
  });
});
