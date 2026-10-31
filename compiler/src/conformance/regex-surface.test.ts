import fc from "fast-check";
import { beforeAll, describe, expect, test } from "vitest";

import { compileMain, runMain } from "../support/test-project";

/**
 * The `Regex` surface (`spec/regex.md` §4, #927 arc 4b), through a program that
 * imports it as any program would. Each export renders what the surface
 * answered, so the pins read as the spec's own examples do: `2+3'aaa'` is a match
 * starting at position 2, three codepoints long, with that text.
 */
const PROGRAM = String.raw`module Main
import Hex.Regex as Regex

let shown(found: Option(Regex.Match)): String = match found
    Some(m) => show(m.start()) ++ "+" ++ show(m.length()) ++ "'" ++ m.text() ++ "'"
    None => "none"

let groupShown(group: Option(Regex.Group)): String = match group
    Some(g) => show(g.start) ++ "+" ++ show(g.length) ++ "'" ++ g.text ++ "'"
    None => "-"

// Every pattern below compiles; a refused one would show as its fallback.
let using(pattern: String, fallback: b, answer: Regex.Regex -> b): b = match Regex.compile(pattern)
    Ok(regex) => answer(regex)
    Err(_) => fallback

export let compileError(pattern: String): String = match Regex.compile(pattern)
    Ok(regex) => "ok " ++ show(regex)
    Err(error) => show(error.position) ++ ": " ++ error.message

export let find(pattern: String, text: String): String = using(pattern, "refused", (regex) => shown(regex.find(text)))

export let findFrom(pattern: String, text: String, start: Int): String = using(pattern, "refused", (regex) => shown(regex.findFrom(text, start)))

export let isMatch(pattern: String, text: String): Bool = using(pattern, False, (regex) => regex.isMatch(text))

let allShown(regex: Regex.Regex, text: String): String =
    var texts: Vector(String) = []
    for m in regex.findAll(text)
        texts := texts.append(shown(Some(m)))
    String.join(Iterable.toSeq(texts), ",")

export let findAll(pattern: String, text: String): String = using(pattern, "refused", (regex) => allShown(regex, text))

export let replace(pattern: String, text: String, replacement: String): String =
    using(pattern, "refused", (regex) => regex.replace(text, replacement))

export let replaceFirst(pattern: String, text: String, replacement: String): String =
    using(pattern, "refused", (regex) => regex.replaceFirst(text, replacement))

export let replaceWith(pattern: String, text: String): String =
    using(pattern, "refused", (regex) => regex.replaceWith(text, (m) => "<" ++ String.toUpper(m.text()) ++ ">"))

export let replaceFirstWith(pattern: String, text: String): String =
    using(pattern, "refused", (regex) => regex.replaceFirstWith(text, (m) => "<" ++ show(m.start()) ++ ">"))

export let split(pattern: String, text: String): String =
    using(pattern, "refused", (regex) => String.join(Iterable.toSeq(regex.split(text)), "|"))

export let splitCount(pattern: String, text: String): Int = using(pattern, -1, (regex) => Vector.length(regex.split(text)))

let groupsShown(found: Option(Regex.Match)): String = match found
    Some(m) =>
        var texts: Vector(String) = [groupShown(m.group(0))]
        for group in m.groups()
            texts := texts.append(groupShown(group))
        texts := texts.append("[" ++ groupShown(m.group(-1)) ++ "," ++ groupShown(m.group(99)) ++ "]")
        String.join(Iterable.toSeq(texts), " ")
    None => "none"

export let groups(pattern: String, text: String): String = using(pattern, "refused", (regex) => groupsShown(regex.find(text)))

let namedShown(found: Option(Regex.Match), name: String): String = match found
    Some(m) => groupShown(m.named(name))
    None => "none"

export let named(pattern: String, text: String, name: String): String =
    using(pattern, "refused", (regex) => namedShown(regex.find(text), name))

let indexOr(index: Option(Int)): Int = match index
    Some(value) => value
    None => 0

export let groupIndex(pattern: String, name: String): Int = using(pattern, -1, (regex) => indexOr(regex.groupIndex(name)))

export let groupCount(pattern: String): Int = using(pattern, -1, (regex) => regex.groupCount())

export let source(pattern: String): String = using(pattern, "refused", (regex) => regex.source())

export let escape(text: String): String = Regex.escape(text)

export let escapedFinds(text: String, subject: String): String = match Regex.compile(Regex.escape(text))
    Ok(regex) =>
        var starts: Vector(String) = []
        for m in regex.findAll(subject)
            starts := starts.append(show(m.start()))
        String.join(Iterable.toSeq(starts), ",")
    Err(error) => "error " ++ error.message

export let reconstructs(pattern: String, text: String, separator: String): Bool =
    using(pattern, False, (regex) => String.join(Iterable.toSeq(regex.split(text)), separator) == text)

exception Boom(text: String)

// A callback that fails on the letter b: the call propagates its failure.
export let failing(text: String): String = match Regex.compile("[a-z]")
    Ok(regex) => regex.replaceWith^(text, (m) => if m.text() == "b" then throw^(Boom(m.text())) else m.text())
    Err(_) => "refused"

// The callback sees each replaced match, in order: each replacement names its match.
export let calls(pattern: String, text: String): String =
    using(pattern, "refused", (regex) => regex.replaceWith(text, (m) => "<" ++ show(m.start()) ++ m.text() ++ ">"))
`;

let exports: Record<string, (...values: never[]) => unknown>;
const call = <T>(name: string, ...values: unknown[]): T =>
  (exports[name] as unknown as (...values: unknown[]) => T)(...values);

beforeAll(async () => {
  exports = await runMain(PROGRAM) as typeof exports;
}, 120_000);

describe("the program compiles against the surface", () => {
  test("no diagnostics", () => {
    expect(compileMain(PROGRAM).diagnostics.map(({ message }) => message)).toEqual([]);
  });

  test("a program that does not import `Regex` emits none of it", () => {
    const project = compileMain("module Main\n\nexport let n: Int = 1\n");
    expect(project.modules.some(({ name }) => name.includes("Regex"))).toBe(false);
  });

  test("the program type is confined: no module outside `Hex.Regex` names it", () => {
    const diagnostics = compileMain(
      "module Main\nimport Hex.Regex as Regex\n\nexport let p(x: Regex.Program): Int = 1\n",
    ).diagnostics.map(({ message }) => message);
    expect(diagnostics).toEqual(["module `Regex` does not export type `Program`"]);
    // Nor may a project module declare the key itself (Intrinsics §3.3, §5.1).
    const impostor = compileMain(
      'module Main\n\nextern from "hex:intrinsic"\n    type regexProgram as Program\n',
    ).diagnostics.map(({ message }) => message);
    expect(impostor.join("\n")).toContain("reserved to standard-library source");
  });
});

describe("compilation (§4.2)", () => {
  test("a bad pattern answers its RegexError; a good one shows its source", () => {
    expect(call("compileError", "a(b")).toBe("2: missing `)` for the group opened here");
    expect(call("compileError", "\\q")).toBe("1: `\\q` is not an escape; write `q`, or see the escape table");
    expect(call("compileError", "a|b")).toBe("ok a|b");
  });

  test("source, groupCount and groupIndex", () => {
    expect(call("source", "(?<y>\\d+)-(\\d+)")).toBe("(?<y>\\d+)-(\\d+)");
    expect(call("groupCount", "(?<y>\\d+)-(\\d+)")).toBe(2);
    expect(call("groupIndex", "(a)(?<y>b)", "y")).toBe(2);
    expect(call("groupIndex", "(a)(?<y>b)", "z")).toBe(0);
  });

  test("escape writes every metacharacter and White_Space behind a backslash", () => {
    expect(call("escape", "a.b*c (d)")).toBe("a\\.b\\*c\\ \\(d\\)");
    expect(call("escape", "#-{}[]^$|?+\\")).toBe("\\#\\-\\{\\}\\[\\]\\^\\$\\|\\?\\+\\\\");
    expect(call("escape", "")).toBe("");
  });

  test("an escaped text matches exactly its own occurrences, under every flag", () => {
    fc.assert(fc.property(
      fc.string({ unit: fc.constantFrom("a", ".", "*", " ", "#", "-", "[", "(", "\\", "😀"), maxLength: 4 }),
      fc.string({ unit: fc.constantFrom("a", ".", "*", " ", "#", "-", "[", "(", "\\", "😀", "b"), maxLength: 10 }),
      (text, subject) => {
        // §3.5's enumeration of a literal: non-overlapping occurrences, left to
        // right; an empty text matches at every boundary.
        const points = [...subject];
        const needle = [...text];
        const expected: number[] = [];
        if (needle.length === 0) {
          for (let position = 1; position <= points.length + 1; position += 1) expected.push(position);
        } else {
          for (let at = 0; at + needle.length <= points.length;) {
            if (needle.every((point, offset) => points[at + offset] === point)) {
              expected.push(at + 1);
              at += needle.length;
            } else {
              at += 1;
            }
          }
        }
        expect(call("escapedFinds", text, subject)).toBe(expected.join(","));
      },
    ), { numRuns: 200 });
  });
});

describe("searching (§4.3)", () => {
  test.each([
    ["\\d+", "tel 12-345", "5+2'12'"],
    ["x", "abc", "none"],
    ["hello", "😀hello", "2+5'hello'"],
  ])("find %j in %j", (pattern, text, answer) => {
    expect(call("find", pattern, text)).toBe(answer);
  });

  test("findFrom sees the text before start; a start below 1 acts as 1; past the end, none", () => {
    expect(call("findFrom", "^b", "ab", 2)).toBe("none");
    expect(call("findFrom", "\\bb", "ab", 2)).toBe("none");
    expect(call("findFrom", "b", "ab", 2)).toBe("2+1'b'");
    expect(call("findFrom", "a", "ab", -5)).toBe("1+1'a'");
    expect(call("findFrom", "", "ab", 3)).toBe("3+0''");
    expect(call("findFrom", "", "ab", 4)).toBe("none");
  });

  test("isMatch", () => {
    expect(call("isMatch", "b", "abc")).toBe(true);
    expect(call("isMatch", "z", "abc")).toBe(false);
  });

  // §3.5's own examples.
  test.each([
    ["a*", "baaab", "1+0'',2+3'aaa',6+0''"],
    ["", "abc", "1+0'',2+0'',3+0'',4+0''"],
    ["a", "banana", "2+1'a',4+1'a',6+1'a'"],
    ["\\w+", "héllo, wörld", "1+5'héllo',8+5'wörld'"],
    ["x*", "😀😀", "1+0'',2+0'',3+0''"],
  ])("findAll %j in %j", (pattern, text, answer) => {
    expect(call("findAll", pattern, text)).toBe(answer);
  });
});

describe("replacement and splitting (§4.4)", () => {
  test("replace and replaceFirst insert the replacement unchanged", () => {
    expect(call("replace", "a+", "baaacab", "-")).toBe("b-c-b");
    expect(call("replace", "(\\d)", "a1b2", "$1")).toBe("a$1b$1");
    expect(call("replaceFirst", "a+", "baaacab", "-")).toBe("b-cab");
    expect(call("replace", "x", "abc", "-")).toBe("abc");
    expect(call("replace", "", "ab", "-")).toBe("-a-b-");
    expect(call("replace", "a*", "baaab", "-")).toBe("-b-b-");
  });

  test("replaceWith computes each replacement from its match", () => {
    expect(call("replaceWith", "[a-z]+", "ab 12 cd")).toBe("<AB> 12 <CD>");
    expect(call("replaceFirstWith", "b", "abcb")).toBe("a<2>cb");
  });

  test("a failure the callback throws propagates from the call, and no partial result escapes", () => {
    expect(call("failing", "xyz")).toBe("xyz");
    expect(() => call("failing", "abc")).toThrow();
  });

  test("an impure callback makes the call wear its mark, and a pure one leaves it bare", () => {
    const program = (call: string) => compileMain(
      "module Main\nimport Hex.Regex as Regex\nimport Hex.Experimental.Stdio as Stdio\n\n" +
      "export let run(regex: Regex.Regex, text: String): String =\n" +
      `    ${call}(text, (m) =>\n        Stdio.write!(m.text())\n        m.text())\n`,
    ).diagnostics.map(({ message }) => message);
    expect(program("regex.replaceWith!")).toEqual([]);
    expect(program("regex.replaceWith").join("\n")).toContain("wants `!`");
  });

  test("the callback is given each replaced match, in order", () => {
    expect(call("calls", "\\d", "a1b22")).toBe("a<21>b<42><52>");
  });

  test.each([
    [",", "a,b,,c", "a|b||c"],
    ["", "abc", "|a|b|c|"],
    ["x", "abc", "abc"],
    [",", ",a,", "|a|"],
    ["a*", "baaab", "|b|b|"],
  ])("split %j over %j", (pattern, text, answer) => {
    expect(call("split", pattern, text)).toBe(answer);
  });

  test("joining the pieces with what every match spelled reconstructs the text", () => {
    fc.assert(fc.property(
      fc.string({ unit: fc.constantFrom("a", "b", ",", "😀"), maxLength: 10 }),
      (text) => {
        expect(call("reconstructs", ",", text, ",")).toBe(true);
        expect(call("splitCount", ",", text)).toBe(text.split(",").length);
      },
    ), { numRuns: 200 });
  });
});

describe("`Match` accessors (§4.5)", () => {
  test("group 0 is the whole match; a group that took no part, or an index out of range, is absent", () => {
    expect(call("groups", "(a)|(b)", "b")).toBe("1+1'b' - 1+1'b' [-,-]");
    expect(call("groups", "(\\d+)-(\\d+)", "tel 12-345")).toBe("5+6'12-345' 5+2'12' 8+3'345' [-,-]");
    expect(call("groups", "x", "x")).toBe("1+1'x' [-,-]");
  });

  test("named reads a group through the name table", () => {
    expect(call("named", "(?<y>\\d+)-(?<m>\\d+)", "2026-10", "m")).toBe("6+2'10'");
    expect(call("named", "(?<y>\\d+)", "2026", "z")).toBe("-");
  });
});
