import { describe, expect, test } from "vitest";

import { AnalysisSession } from "../analysis/session.js";
import { compileFiles, compileMain, runMain } from "../support/test-project";

/**
 * A literal handed to `Regex.compile` is run while the program is compiled
 * (`spec/regex.md` §8, #1468): a bad one is refused at the call, on the
 * codepoint its position names, with §2.9's message spelled as the literal's
 * source; a good one is emitted already built, as JavaScript data. A literal
 * handed to `Regex.parse` is the caller's to read when the call runs.
 */
const HEADER = "module Main\nimport Hex.Regex as Regex\n\n";

/** Each report as the source text it underlines, then its message. */
function reports(source: string): string[] {
  return compileMain(source).diagnostics.map(({ primary, message }) =>
    `${source.slice(primary.start.offset, primary.end.offset)}: ${message}`
  );
}

describe("a bad literal is refused while compiling (§8)", () => {
  test("on the codepoint its position names", () => {
    expect(reports(HEADER + 'export let r: Regex.Regex = Regex.compile("a(b")\n')).toEqual([
      "(: missing `)` for the group opened here; close it, or write `\\\\(` for a literal",
    ]);
    expect(reports(HEADER + 'export let r: Regex.Regex = Regex.compile("(?=a)")\n')).toEqual([
      "?: `(?=` is lookahead, which the dialect does not have",
    ]);
  });

  test("an escape sequence is underlined whole, and a pattern that ends early at the closing quote", () => {
    // The pattern `a\q`: its `\` is the source's `\\`.
    expect(reports(HEADER + 'export let r: Regex.Regex = Regex.compile("a\\\\q")\n')).toEqual([
      "\\\\: `\\\\q` is not an escape; write `q`, or see the escape table",
    ]);
    // The pattern `(a`, its `(` written as a Unicode escape.
    expect(reports(HEADER + 'export let r: Regex.Regex = Regex.compile("\\u{28}a")\n')).toEqual([
      "\\u{28}: missing `)` for the group opened here; close it, or write `\\\\(` for a literal",
    ]);
    // The pattern `ab\`: position 4, its length + 1.
    expect(reports(HEADER + 'export let r: Regex.Regex = Regex.compile("ab\\\\")\n')).toEqual([
      "\": pattern ends inside an escape; write `\\\\\\\\` for a literal backslash",
    ]);
  });

  test("positions count codepoints, through astral codepoints, escapes and a physical CRLF", () => {
    expect(reports(HEADER + 'export let r: Regex.Regex = Regex.compile("😀😀(x")\n')).toEqual([
      "(: missing `)` for the group opened here; close it, or write `\\\\(` for a literal",
    ]);
    expect(reports(HEADER + 'export let r: Regex.Regex = Regex.compile("\\u{1F600}\\n(x")\n')).toEqual([
      "(: missing `)` for the group opened here; close it, or write `\\\\(` for a literal",
    ]);
    // A physical CRLF inside the literal is one `\n` (Lexer §6.2).
    const crlf = HEADER + 'export let r: Regex.Regex = Regex.compile("a\r\n(b")\n';
    expect(reports(crlf)).toEqual([
      "(: missing `)` for the group opened here; close it, or write `\\\\(` for a literal",
    ]);
  });

  test("the message quotes every spelling as the source writes it", () => {
    expect(reports(HEADER + 'export let r: Regex.Regex = Regex.compile("[\\\\b]")\n')).toEqual([
      "\\\\: `\\\\b` is an assertion, not a codepoint; a class cannot hold it, so write it outside the class, " +
      "or `\\\\u{8}` for a backspace",
    ]);
    expect(reports(HEADER + 'export let r: Regex.Regex = Regex.compile("\\\\p{Cyrilic}")\n')).toEqual([
      "\\\\: `\\\\p{Cyrilic}` names no supported property; did you mean `\\\\p{Cyrillic}`?",
    ]);
    // A quote in the pattern is the source's escape too.
    expect(reports(HEADER + 'export let r: Regex.Regex = Regex.compile("[z-\\"]")\n')).toEqual([
      '\\": range `z-\\"` is reversed; write `\\"-z`',
    ]);
  });

  test("the report names why it was made at compile time", () => {
    const [report] = compileMain(HEADER + 'export let r: Regex.Regex = Regex.compile("(")\n').diagnostics;
    expect(report!.notes).toEqual(["a pattern written as a literal is checked when the program is compiled"]);
  });

  test("every literal call is checked: a pipe, an alias, a function never called, a call a `try` would catch", () => {
    expect(reports(HEADER + 'export let r: Regex.Regex = "a(" |> Regex.compile\n')).toEqual([
      "(: missing `)` for the group opened here; close it, or write `\\\\(` for a literal",
    ]);
    expect(reports('module Main\nimport Hex.Regex as R\n\nexport let r: R.Regex = R.compile("a(")\n')).toEqual([
      "(: missing `)` for the group opened here; close it, or write `\\\\(` for a literal",
    ]);
    expect(reports(HEADER + 'let never(text: String): Bool = Regex.compile("a(").isMatch(text)\n')).toEqual([
      "(: missing `)` for the group opened here; close it, or write `\\\\(` for a literal",
    ]);
    const caught = HEADER + [
      "export let caught(): String =",
      "    try",
      '        Regex.compile("a(").source()',
      "    catch",
      "        Regex.RegexCompileFault(message, _, _) => message",
      "",
    ].join("\n");
    expect(reports(caught)).toEqual([
      "(: missing `)` for the group opened here; close it, or write `\\\\(` for a literal",
    ]);
  });

  test("each bad literal is reported, one report per pattern", () => {
    expect(reports(HEADER + [
      'export let a: Regex.Regex = Regex.compile("(")',
      'export let b: Regex.Regex = Regex.compile("a**")',
      'export let c: Regex.Regex = Regex.compile("(")',
      "",
    ].join("\n"))).toEqual([
      "(: missing `)` for the group opened here; close it, or write `\\\\(` for a literal",
      "*: `**` repeats a repetition; write `(?:a*)*`",
      "(: missing `)` for the group opened here; close it, or write `\\\\(` for a literal",
    ]);
  });

  test("a literal emitted more than once is reported once: copies of a generic function, an interpolation's hole", () => {
    const missing = "(: missing `)` for the group opened here; close it, or write `\\\\(` for a literal";
    expect(reports(HEADER + [
      'export let tagged<a: Show>(x: a): String = Regex.compile("(").source() ++ show(x)',
      "",
    ].join("\n"))).toEqual([missing]);
    expect(reports(HEADER + [
      'export let hole(): String = "v=${Regex.compile("(").source()}"',
      "",
    ].join("\n"))).toEqual([missing]);
    // A generic function another module copies once per type it is used at.
    const other = [
      "module Other",
      "import Hex.Regex as Regex",
      "",
      'export let both<a: Show, b: Show>(x: a, y: b): String = Regex.compile("(").source() ++ show(x) ++ show(y)',
      "",
    ].join("\n");
    const main = [
      "module Main",
      "import Other",
      "",
      'export let used(): String = Other.both(1, "a") ++ Other.both(True, 2.5) ++ Other.both("b", 3)',
      "",
    ].join("\n");
    const compiled = compileFiles([["/main.hex", main], ["/other.hex", other]]);
    expect(compiled.diagnostics.map(({ primary, message }) =>
      `${Number(primary.fileId)} ${[main, other][Number(primary.fileId)]!.slice(primary.start.offset, primary.end.offset)}: ${message}`
    )).toEqual([`1 ${missing}`]);
  });

  test("the language server reports it where the editor shows it", () => {
    const text = HEADER + 'export let r: Regex.Regex = Regex.compile("a(b")\n';
    const session = new AnalysisSession();
    session.setFile("/main.hex", text);
    const found = session.diagnostics("/main.hex").map(({ primary, message }) =>
      `${text.slice(primary.start.offset, primary.end.offset)}: ${message}`
    );
    expect(found).toEqual(["(: missing `)` for the group opened here; close it, or write `\\\\(` for a literal"]);
  });
});

describe("the rewrite a refusal names is a fix on the literal (§2.9, §8)", () => {
  /** Each fix the report carries: its title, and the program with its edits applied. */
  function fixed(source: string): { readonly title: string; readonly source: string }[] {
    const [report] = compileMain(source).diagnostics;
    return (report?.fixes ?? []).map((fix) => {
      let out = source;
      for (const edit of [...fix.edits].sort((left, right) => right.span.start.offset - left.span.start.offset)) {
        out = out.slice(0, edit.span.start.offset) + edit.replacement + out.slice(edit.span.end.offset);
      }
      return { title: fix.message, source: out };
    });
  }
  const call = (literal: string) => HEADER + `export let r: Regex.Regex = Regex.compile(${literal})\n`;

  test("each edit spelled as the literal spells it, and the program it leaves compiles", () => {
    const cases: readonly (readonly [string, readonly (readonly [string, string])[]])[] = [
      ['"a(b"', [["close the group", '"a(b)"'], ["write `\\\\(` for a literal `(`", '"a\\\\(b"']]],
      ['"[z-a]"', [["write `a-z`", '"[a-z]"']]],
      ['"a\\\\"', [["write `\\\\\\\\` for a literal backslash", '"a\\\\\\\\"']]],
      ['"a{1500}"', [["write the run as a sequence", '"a{1000}a{500}"']]],
      ['"a(?U)b*"', [["drop the `U`, and write each repetition it reaches as it reads it", '"ab*?"']]],
      ['"a*+"', [["write `(?:a*)+`", '"(?:a*)+"']]],
      ['"(?:x{100}){20}"', [["write the outer repetition as a sequence", '"(?:x{100}){10}(?:x{100}){10}"']]],
    ];
    for (const [literal, fixes] of cases) {
      const found = fixed(call(literal));
      expect(found.map(({ title, source }) => [title, source.slice(source.indexOf("compile(") + 8, source.lastIndexOf(")"))]))
        .toEqual(fixes);
      for (const { source } of found) expect(compileMain(source).diagnostics).toEqual([]);
    }
  });

  test("an edit's span counts codepoints through escapes, astral codepoints and a physical CRLF", () => {
    // `(` written as a Unicode escape is replaced whole.
    expect(fixed(call('"\\u{28}a"')).map(({ source }) => source.slice(source.indexOf("compile(") + 8, source.lastIndexOf(")"))))
      .toEqual(['"\\u{28}a)"', '"\\\\(a"']);
    expect(fixed(call('"😀\\n(x"')).map(({ source }) => source.slice(source.indexOf("compile(") + 8, source.lastIndexOf(")"))))
      .toEqual(['"😀\\n(x)"', '"😀\\n\\\\(x"']);
    const crlf = fixed(call('"a\r\n(b"'));
    expect(crlf.map(({ source }) => source.slice(source.indexOf("compile(") + 8, source.lastIndexOf(")"))))
      .toEqual(['"a\r\n(b)"', '"a\r\n\\\\(b"']);
  });

  test("an edit that would bring a `$` or `#` and a `{` together spells them apart, so it opens no interpolation", () => {
    for (const [literal, after] of [['"$(?){"', '"\\${"'], ['"#(?){"', '"\\#{"'], ['"\\u{24}(?){"', '"\\u{24}{"']] as const) {
      const [only] = fixed(call(literal));
      expect(only?.source.slice(only.source.indexOf("compile(") + 8, only.source.lastIndexOf(")"))).toBe(after);
      // What is left is the next fault, a `{` that begins no count, and no interpolation.
      expect(reports(only!.source)).toEqual([
        "{: `{` must begin a counted repetition `{n}`, `{n,}`, or `{n,m}`; write `\\\\{` for a literal",
      ]);
    }
    // An edit whose own text ends in `$` before a `{`: the range's ends swapped.
    const [swap] = fixed(call('"[$-!{]"'));
    expect(swap?.source.slice(swap.source.indexOf("compile(") + 8, swap.source.lastIndexOf(")"))).toBe('"[!-\\${]"');
    expect(compileMain(swap!.source).diagnostics).toEqual([]);
  });

  test("a refusal whose rewrite needs the programmer's choice, or meets a limitation, carries no fix", () => {
    for (const literal of ['"\\\\p{Cyrilic}"', '"(?=a)"', '"(?<n>a)(?<n>b)"', '"(a){1500}"', '"\\\\x41"']) {
      expect(compileMain(call(literal)).diagnostics.map(({ fixes }) => fixes)).toEqual([undefined]);
    }
  });

  test("the language server offers each fix where the report is", () => {
    const text = call('"a(b"');
    const session = new AnalysisSession();
    session.setFile("/main.hex", text);
    const at = text.indexOf("(b");
    expect(session.codeActions("/main.hex", { start: at, end: at }).map(({ title, edits }) =>
      [title, edits.map(({ replacement }) => replacement)]
    )).toEqual([["close the group", [")"]], ["write `\\\\(` for a literal `(`", ["\\\\("]]]);
  });
});

describe("what is not a literal call is not checked (§8)", () => {
  test("a literal handed to parse, a function value, a pattern bound first, an interpolation", async () => {
    const source = HEADER + [
      'export let parsed(): Option(Regex.Regex) = Regex.parse?("(")',
      "let make: String -> Regex.Regex = Regex.compile",
      'export let valued(): String = make("(").source()',
      "export let bound(): String =",
      '    let pattern = "("',
      "    Regex.compile(pattern).source()",
      'export let interpolated(x: String): String = Regex.compile("(${x}").source()',
      "",
    ].join("\n");
    expect(compileMain(source).diagnostics.map(({ message }) => message)).toEqual([]);
    const program = await runMain(source);
    const fault = (name: string, ...values: unknown[]): string => {
      try {
        (program[name] as (...values: unknown[]) => unknown)(...values);
        return "no fault";
      } catch (error) {
        return (error as Error).name;
      }
    };
    expect((program.parsed as () => unknown)()).toEqual({ tag: "None" });
    expect(fault("valued")).toBe("RegexCompileFault");
    expect(fault("bound")).toBe("RegexCompileFault");
    expect(fault("interpolated", "a")).toBe("RegexCompileFault");
    expect((program.interpolated as (x: string) => string)(")")).toBe("()");
  });
});

describe("a good literal is emitted already built (§8, §9)", () => {
  const PATTERNS = [
    "(?<year>[0-9]{4})-(?<month>[0-9]{2})(?:-(?<day>[0-9]{2}))?",
    "(?i)straße|ǅ+",
    "\\p{Greek}+|\\p{Han}+",
    "^(\\d+)-(\\d+) (\\w): (\\w+)$",
    "(a|ab)(c|bcd)(d*)",
    "\\bfoo\\b|(?m)^bar$",
    "",
  ];
  const TEXTS = [
    "2026-11-06 and 1999-12",
    "STRASSE Straße ǅǆǄ",
    "abc αβγ 漢字 δ",
    "1-3 a: abcde",
    "abcd abcdd",
    "foo food\nbar\nbarn",
  ];
  const describeMatches = String.raw`
let groupText(group: Option(Regex.Group)): String = match group
    Some(g) => show(g.start) ++ "+" ++ show(g.length) ++ "'" ++ g.text ++ "'"
    None => "-"

let described(regex: Regex.Regex, text: String): String =
    var parts: Vector(String) = [regex.source(), show(regex.groupCount())]
    for name in ["year", "month", "day", "nope"]
        parts := parts.append(name ++ "=" ++ show(regex.groupIndex(name)))
    for m in regex.findAll(text)
        parts := parts.append(groupText(m.group(0)))
        for group in m.groups()
            parts := parts.append(groupText(group))
        for name in ["year", "month", "day"]
            parts := parts.append(name ++ ":" ++ groupText(m.named(name)))
    String.join(Iterable.toSeq(parts), " ")
`;
  const literalSource = (pattern: string): string =>
    pattern.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const source = HEADER + describeMatches + "\n" +
    PATTERNS.map((pattern, index) =>
      `export let literal${index}(text: String): String = described(Regex.compile("${literalSource(pattern)}"), text)`
    ).join("\n") + "\n" +
    "export let built(pattern: String, text: String): String = described(Regex.compile(pattern), text)\n";

  test("it answers as the same pattern built at run time", async () => {
    expect(compileMain(source).diagnostics.map(({ message }) => message)).toEqual([]);
    const program = await runMain(source);
    for (const [index, pattern] of PATTERNS.entries()) {
      const literal = program[`literal${index}`] as (text: string) => string;
      const built = program.built as (pattern: string, text: string) => string;
      for (const text of TEXTS) {
        // Twice, so the memos the first search fills are read by the second.
        for (let round = 0; round < 2; round += 1) {
          expect(literal(text), `${pattern} on ${JSON.stringify(text)}`).toBe(built(pattern, text));
        }
      }
    }
  });

  test("one constant per pattern in a module, however often the literal is emitted", async () => {
    const generic = HEADER + [
      'export let tagged<a: Show>(x: a): String = Regex.compile("a+").replace(show(x), "-")',
      'export let hole(text: String): String = "v=${Regex.compile("a+").replace(text, "-")}"',
      'export let again(text: String): String = Regex.compile("a+").replace(text, "=")',
      "",
    ].join("\n");
    expect(compileMain(generic).diagnostics.map(({ message }) => message)).toEqual([]);
    const main = compileMain(generic).modules.find(({ name }) => name === "Main")!.javascript.text;
    expect(main.split('source: "a+"').length - 1).toBe(1);
    const program = await runMain(generic);
    expect((program.hole as (text: string) => string)("baab")).toBe("v=b-b");
    expect((program.again as (text: string) => string)("baab")).toBe("b=b");
  });

  test("a filled array is written through the global `Array` where the module binds the name", async () => {
    const source = [
      "module Main",
      "import Hex.Regex as Regex",
      "import Hex.Array as Array",
      "",
      'export let plates(text: String): Bool = Regex.compile("[a-z]{3}\\\\d{4}x{20}(?i)\\\\p{L}+").isMatch(text)',
      "export let size(values: Array.Array(Int)): Int = Array.length(values)",
      "",
    ].join("\n");
    expect(compileMain(source).diagnostics.map(({ message }) => message)).toEqual([]);
    const main = compileMain(source).modules.find(({ name }) => name === "Main")!.javascript.text;
    expect(main).toMatch(/new [\w$]+\(\d+\)\.fill\(-1\)/u);
    expect(main).not.toMatch(/new Array\(/u);
    const program = await runMain(source);
    expect((program.plates as (text: string) => boolean)("abc1234" + "x".repeat(20) + "Q")).toBe(true);
    expect((program.size as (values: number[]) => number)([1, 2, 3])).toBe(3);
  });

  test("it is data: no call of compile, the properties by name, and no table", () => {
    const main = compileMain(source).modules.find(({ name }) => name === "Main")!.javascript.text;
    expect(main).not.toContain("Regex.compile(\"");
    expect(main).not.toContain("??= Regex.compile");
    expect(main).toContain("__vectorOf([");
    expect(main).toContain('value: "Greek"');
    expect(main).toContain('source: "\\\\p{Greek}+|\\\\p{Han}+"');
    expect(main.length).toBeLessThan(100_000);
  });
});
