import { describe, expect, test } from "vitest";
import { AnalysisSession } from "../analysis/session.js";
import { compileMain } from "../support/test-project.js";
import { regexHoverAt } from "./regex-groups.js";

const HEADER = "module Main\nimport Hex.Regex as Regex\n\n";

function sessionWith(text: string): AnalysisSession {
  const session = new AnalysisSession();
  session.setFile("/main.hex", text);
  return session;
}

/** A program handing `compile` the literal `literal`, written as its source spells it. */
const program = (literal: string) => HEADER + `export let r: Regex.Regex = Regex.compile(${literal})\n`;

/** The hover at the first `needle` in `text`: the text it covers, and what it says. */
function hoverAt(text: string, needle: string, after = 0) {
  const offset = text.indexOf(needle) + after;
  if (offset < after) throw new Error(`no ${needle}`);
  const hover = sessionWith(text).hover("/main.hex", offset);
  return hover === undefined
    ? undefined
    : {
      over: text.slice(hover.span.start.offset, hover.span.end.offset),
      type: hover.displayedType,
      says: hover.documentation,
    };
}

describe("hover inside a literal handed to `Regex.compile` (regex.md §5)", () => {
  const dated = program('"^(?<year>\\\\d{4})-([0-9]{2})$"');

  test("on a group: its number, its name, its text spelled as a string literal writes it, and how a match reads it", () => {
    expect(hoverAt(dated, "(?<year>")).toEqual({
      over: "(?<year>\\\\d{4})",
      type: "String",
      says: "group 1, `year`: `(?<year>\\\\d{4})`\n\nRead it with `m.named(\"year\")` or `m.group(1)`.",
    });
    // Anywhere in the group, its closing `)` included.
    expect(hoverAt(dated, "d{4})", 4)?.over).toBe("(?<year>\\\\d{4})");
    expect(hoverAt(dated, "[0-9]{2}")).toEqual({
      over: "([0-9]{2})",
      type: "String",
      says: "group 2: `([0-9]{2})`\n\nRead it with `m.group(2)`.",
    });
  });

  test("elsewhere in the literal, quotes included: its groups in order", () => {
    const whole = {
      over: '"^(?<year>\\\\d{4})-([0-9]{2})$"',
      type: "String",
      says: "2 capturing groups, in the order `Regex.group` numbers them:\n\n" +
        "- group 1, `year`: `(?<year>\\\\d{4})`\n- group 2: `([0-9]{2})`",
    };
    expect(hoverAt(dated, ")-(", 1)).toEqual(whole);
    expect(hoverAt(dated, '"^')).toEqual(whole);
    expect(hoverAt(dated, '$"', 1)).toEqual(whole);
    expect(hoverAt(program('"(a)"'), '"(')?.says)
      .toBe("One capturing group, in the order `Regex.group` numbers them:\n\n- group 1: `(a)`");
    expect(hoverAt(program('"a(?:b)c"'), "b")?.says).toBe("No capturing groups.");
  });

  test("the innermost group that holds the position answers", () => {
    const nested = program('"((a)(b))"');
    expect(hoverAt(nested, "(a)", 1)?.says).toBe("group 2: `(a)`\n\nRead it with `m.group(2)`.");
    expect(hoverAt(nested, ")(", 1)?.says).toBe("group 3: `(b)`\n\nRead it with `m.group(3)`.");
    expect(hoverAt(nested, '"(')?.over).toBe('"((a)(b))"');
    expect(hoverAt(nested, '"((', 1)?.says).toBe("group 1: `((a)(b))`\n\nRead it with `m.group(1)`.");
  });

  test("what the parser reads, not what looks like a group: escapes, classes, comments under `x`", () => {
    const tricky = program('"\\\\((?x) [(] # (no group\\n (z) \\\\u{28}"');
    expect(hoverAt(tricky, "(z)")?.says).toBe("group 1: `(z)`\n\nRead it with `m.group(1)`.");
    expect(hoverAt(tricky, "(no")?.says).toContain("One capturing group");
    expect(hoverAt(tricky, "\\\\((")?.says).toContain("One capturing group");
    // A backtick in the group's text takes a longer fence.
    expect(hoverAt(program('"(`a)"'), "`a")?.says).toBe("group 1: ``(`a)``\n\nRead it with `m.group(1)`.");
    // A codepoint the source writes as an escape is placed whole.
    const escaped = program('"\\u{28}a)b"');
    expect(hoverAt(escaped, "a)")?.over).toBe("\\u{28}a)");
  });

  test("only the literal under the offset is parsed", () => {
    const text = HEADER + 'export let a: Regex.Regex = Regex.compile("(a)")\nexport let b: Regex.Regex = Regex.compile("(b)")\n';
    const project = compileMain(text);
    const module = project.modules.find(({ source }) => source.text === text)!;
    const asked: string[] = [];
    const groupsOf = (pattern: string) => {
      asked.push(pattern);
      return project.regexGroups!(pattern);
    };
    expect(regexHoverAt(module.source, module, groupsOf, text.indexOf("(b)"))?.documentation).toContain("group 1: `(b)`");
    expect(asked).toEqual(["(b)"]);
  });

  test("a literal the build refused, and a string that is no `compile` literal, show only their type", () => {
    for (const text of [program('"(a"'), HEADER + 'export let r: Option(Regex.Regex) = Regex.parse?("(a)")\n', HEADER + 'export let s: String = "(a)"\n']) {
      const hover = hoverAt(text, '"(a', 2);
      expect(hover?.type).toBe("String");
      expect(hover?.says).toBeUndefined();
    }
  });
});

describe("a group's number as an inlay hint at its `(` (regex.md §5)", () => {
  test("each capturing group, numbered as `Regex.group` reads it, with its hover as the tooltip", () => {
    const text = program('"^(?<year>\\\\d{4})-(?:([0-9]{2}))(?i)$"');
    const hints = sessionWith(text).inlayHints("/main.hex").filter(({ kind }) => kind === "regexGroup");
    expect(hints.map(({ offset, label }) => [text.slice(offset, offset + 3), label])).toEqual([
      ["(?<", "1"],
      ["([0", "2"],
    ]);
    expect(hints[0]?.tooltip).toBe("group 1, `year`: `(?<year>\\\\d{4})`\n\nRead it with `m.named(\"year\")` or `m.group(1)`.");
  });

  test("in the order of the text, among the types, and only those in the range asked", () => {
    const text = HEADER + 'let pair = (Regex.compile("(a)"), 1)\nexport let n(x: Int): Int = x\nlet r = Regex.compile("(b)")\n';
    const session = sessionWith(text);
    const all = session.inlayHints("/main.hex");
    expect(all.map(({ offset }) => offset)).toEqual([...all.map(({ offset }) => offset)].sort((a, b) => a - b));
    expect(all.filter(({ kind }) => kind === "regexGroup").map(({ offset }) => text.slice(offset, offset + 3)))
      .toEqual(["(a)", "(b)"]);
    const second = text.indexOf("(b)");
    expect(session.inlayHints("/main.hex", { start: second - 3, end: second + 3 }).map(({ label, kind }) => [kind, label]))
      .toEqual([["regexGroup", "1"]]);
    // A range that ends at the `(` holds its hint, one that ends before it doesn't.
    expect(session.inlayHints("/main.hex", { start: second - 3, end: second }).map(({ kind }) => kind)).toEqual(["regexGroup"]);
    expect(session.inlayHints("/main.hex", { start: second - 3, end: second - 1 })).toEqual([]);
  });

  test("a literal the build refused has none", () => {
    expect(sessionWith(program('"(a)(b"')).inlayHints("/main.hex").filter(({ kind }) => kind === "regexGroup"))
      .toEqual([]);
  });
});
