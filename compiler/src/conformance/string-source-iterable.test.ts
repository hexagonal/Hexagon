import { describe, expect, test } from "vitest";

import { STDLIB_SOURCES } from "../stdlib-sources.js";
import { compileFiles, compileMain, runMain } from "../support/test-project.js";

const SOURCE_INSTANCE =
  "honor Iterable<String> =\n" +
  "    type Item = String\n" +
  "    toSeq(text) = nativeToSeq(text)\n\n";

function withoutStringInstance(): string {
  const source = STDLIB_SOURCES["String"]!;
  expect(source).toContain(SOURCE_INSTANCE);
  return source.replace(SOURCE_INSTANCE, "");
}

describe("String owns its Iterable instance in source", () => {
  test("the canonical source is the sole coherence provider", () => {
    const source = STDLIB_SOURCES["String"]!;
    expect(source).toContain("fun stringToSeq as nativeToSeq(text: String): Seq(String)");
    expect(source).toContain(SOURCE_INSTANCE.trim());
    expect(source).toContain("Vector.fromSeq(toSeq(text))");
    expect(source).toContain("fromSeq(Iterable.toSeq(chunks))");

    const project = compileFiles([
      ["/String.hex", withoutStringInstance()],
      ["/main.hex", "module Main\n\nexport let view: Seq(String) = Iterable.toSeq(\"abc\")\n"],
    ]);
    expect(project.diagnostics.map(({ message }) => message).join("\n"))
      .toContain("type `String` has no `Iterable` instance");
  });

  test("declaring-module, honoring-module, and dot calls share the lazy replayable adapter", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "export let spellings(text: String): (String, String, String) =",
      "    (String.fromSeq(Iterable.toSeq(text)),",
      "     String.fromSeq(String.toSeq(text)),",
      "     String.fromSeq(text.toSeq()))",
      "",
      "export let replay(text: String): String =",
      "    let view = String.toSeq(text)",
      '    String.fromSeq(view) ++ "|" ++ String.fromSeq(view)',
      "",
    ].join("\n"));

    const spellings = exports["spellings"] as (text: string) => unknown[];
    expect(spellings("A😀B")).toEqual(["A😀B", "A😀B", "A😀B"]);
    expect(spellings("\uD800")).toEqual(["\uD800", "\uD800", "\uD800"]);
    const replay = exports["replay"] as (text: string) => string;
    expect(replay("A😀\uD800")).toBe("A😀\uD800|A😀\uD800");

    const project = compileMain(
      "module Main\n\nexport let view: Seq(String) = String.toSeq(\"abc\")\n",
    );
    expect(project.diagnostics).toEqual([]);
    const stringModule = project.modules.find(({ source }) => source.path === "/Hex/String.hex")!;
    expect(stringModule.javascript.text).toContain("const nativeToSeq = __seqFromIterable;");
  });

  test("the canonical instance keeps direct loops as native string iteration", async () => {
    const source = [
      "module Main",
      "",
      "export let count(text: String): Int =",
      "    var total = 0",
      "    for _ in text",
      "        total := total + 1",
      "    total",
      "",
    ].join("\n");
    const project = compileMain(source);
    expect(project.diagnostics).toEqual([]);
    const javascript = project.modules.find(({ source: file }) => file.path === "/main.hex")!
      .javascript.text;
    expect(javascript).toMatch(/for \(const __item of text\)/u);
    expect(javascript).not.toContain("seqFromIterable");
    expect(javascript).not.toContain("Iterable_String");
    expect(javascript).not.toContain("toSeq(text)");

    const exports = await runMain(source);
    const count = exports["count"] as (text: string) => number;
    expect(count("A😀\uD800")).toBe(3);
  });

  test("a same-shaped noncanonical declaration receives the ordinary member call", () => {
    const iterable = STDLIB_SOURCES["Iterable"]! +
      '\nextern from "hex:intrinsic"\n' +
      "    fun stringToSeq as nativeToSeq(text: String): Seq(String)\n\n" +
      "honor Iterable<String> =\n" +
      "    type Item = String\n" +
      "    toSeq(text) = nativeToSeq(text)\n";
    const project = compileFiles([
      ["/Iterable.hex", iterable],
      [
        "/String.hex",
        withoutStringInstance().replace(
          "Vector.fromSeq(toSeq(text))",
          "Vector.fromSeq(Iterable.toSeq(text))",
        ),
      ],
      ["/main.hex", [
        "module Main",
        "",
        "export let count(text: String): Int =",
        "    var total = 0",
        "    for _ in text",
        "        total := total + 1",
        "    total",
        "",
      ].join("\n")],
    ]);
    expect(project.diagnostics).toEqual([]);
    const javascript = project.modules.find(({ source }) => source.path === "/main.hex")!
      .javascript.text;
    expect(javascript).toContain("__Iterable_String.toSeq(text)");
    expect(javascript).not.toMatch(/for \(const __item of text\)/u);
  });
});
