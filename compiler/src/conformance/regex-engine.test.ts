import fc from "fast-check";
import { beforeAll, describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project";
import regexRuntimeSource from "../../../stdlib/Runtime/Regex.hex?raw";

/**
 * The regex engine (`spec/regex.md` §6, #927 arc 3b): program construction and
 * the Pike VM, run through the emitted JavaScript. The specimen rides in the
 * shipped `stdlib/Runtime/Regex.hex`'s own text, trusted as the registered
 * member, as `buffer.test.ts` does, with probes over the module's own
 * functions: the program as instructions, a class's resolved set, and a search
 * rendered as text.
 */
const PROBE_PATH = "/Regex.hex";
const TRUST_RUNTIME = { trustedStandardLibraryModules: new Set(["Runtime.Regex"]) } as const;
const TOUCH: readonly [string, string] = [
  "/Main.hex",
  "module Main\n\nimport Runtime.Regex\n\nexport let touched: Int = Regex.probe\n",
];

const PROBE = `
let opText(program: Compiled, at: Int): String =
    let op = read~(program.ops, at)
    let first = show(read~(program.first, at))
    let second = show(read~(program.second, at))
    if op == opMatch then "match"
    else if op == opConsume then "c" ++ first
    else if op == opSplit then "split " ++ first ++ "," ++ second
    else if op == opJump then "jump " ++ first
    else if op == opSave then "save " ++ first
    else "assert " ++ first

export let program(pattern: String): String = match Syntax.parse(pattern)
    Ok(parsed) =>
        let compiled = compile~(parsed)
        var texts: Vector(String) = []
        var at = 0
        while at < compiled.size
            texts := texts.append(show(at) ++ ":" ++ opText~(compiled, at))
            at := at + 1
        String.join(Iterable.toSeq(texts), "; ")
    Err(error) => error.message

export let set(pattern: String): Vector((Int, Int)) = match Syntax.parse(pattern)
    Ok(parsed) => classOf~(compile~(parsed), 0)
    Err(_) => []

let groupText(group: Option((Int, Int, String))): String = match group
    Some((start, length, text)) => show(start) ++ "+" ++ show(length) ++ "'" ++ text ++ "'"
    None => "-"

let rendered(answer: Option((Vector(Option((Int, Int, String))), (Int, Int)))): String = match answer
    Some((groups, (position, offset))) =>
        var texts: Vector(String) = []
        for group in groups
            texts := texts.append(groupText(group))
        String.join(Iterable.toSeq(texts), " ") ++ " @" ++ show(position) ++ "/" ++ show(offset)
    None => "none"

export let find(pattern: String, text: String, start: Int): String = match Syntax.parse(pattern)
    Ok(parsed) => rendered(search~(compile~(parsed), text, start, (1, 0), True))
    Err(error) => "error " ++ error.message

export let findWith(pattern: String, text: String, start: Int, position: Int, offset: Int, spans: Bool): String =
    match Syntax.parse(pattern)
        Ok(parsed) => rendered(search~(compile~(parsed), text, start, (position, offset), spans))
        Err(error) => "error " ++ error.message

export let findVm(pattern: String, text: String, start: Int, spans: Bool): String = match Syntax.parse(pattern)
    Ok(parsed) => rendered(searchByVm~(compile~(parsed), text, start, spans))
    Err(error) => "error " ++ error.message

export let probe: Int = 1
`;

let program: (pattern: string) => string;
let set: (pattern: string) => readonly (readonly [number, number])[];
let find: (pattern: string, text: string, start: number) => string;
let findWith: (pattern: string, text: string, start: number, position: number, offset: number, spans: boolean) => string;
let findVm: (pattern: string, text: string, start: number, spans: boolean) => string;

beforeAll(async () => {
  const exports = await runProject(
    [[PROBE_PATH, `${regexRuntimeSource}\n${PROBE}`], TOUCH],
    { ...TRUST_RUNTIME, entry: PROBE_PATH },
  );
  program = exports.program as typeof program;
  const setRow = exports.set as (pattern: string) => unknown;
  set = (pattern) => [...(setRow(pattern) as Iterable<[number, number]>)];
  find = exports.find as typeof find;
  findWith = exports.findWith as typeof findWith;
  findVm = exports.findVm as typeof findVm;
}, 60_000);

describe("the shipped engine compiles cleanly", () => {
  test("no diagnostics", () => {
    expect(compileFiles([[PROBE_PATH, regexRuntimeSource]], TRUST_RUNTIME).diagnostics).toEqual([]);
  });
});

describe("the NFA (§6.1): every split in §3.2's priority order", () => {
  test.each([
    ["a", "0:save 0; 1:c0; 2:save 1; 3:match"],
    ["a|b|c", "0:save 0; 1:split 2,4; 2:c0; 3:jump 8; 4:split 5,7; 5:c1; 6:jump 8; 7:c2; 8:save 1; 9:match"],
    ["a*", "0:save 0; 1:split 2,4; 2:c0; 3:jump 1; 4:save 1; 5:match"],
    ["a*?", "0:save 0; 1:split 4,2; 2:c0; 3:jump 1; 4:save 1; 5:match"],
    ["a+", "0:save 0; 1:c0; 2:split 3,5; 3:c0; 4:jump 2; 5:save 1; 6:match"],
    ["a?", "0:save 0; 1:split 2,3; 2:c0; 3:save 1; 4:match"],
    ["a??", "0:save 0; 1:split 3,2; 2:c0; 3:save 1; 4:match"],
    ["a{2,4}", "0:save 0; 1:c0; 2:c0; 3:split 4,7; 4:c0; 5:split 6,7; 6:c0; 7:save 1; 8:match"],
    // A star over a body that can match empty is `(?:x+)?` (RE2, Go issue 46123).
    ["(?:|a)*", "0:save 0; 1:split 2,6; 2:split 3,4; 3:jump 5; 4:c0; 5:split 2,6; 6:save 1; 7:match"],
    ["(a)", "0:save 0; 1:save 2; 2:c0; 3:save 3; 4:save 1; 5:match"],
    ["^a$", "0:save 0; 1:assert 0; 2:c0; 3:assert 1; 4:save 1; 5:match"],
    ["(?:ab|c)*d", "0:save 0; 1:split 2,8; 2:split 3,6; 3:c0; 4:c1; 5:jump 7; 6:c2; 7:jump 1; 8:c3; 9:save 1; 10:match"],
  ])("%j", (pattern, instructions) => {
    expect(program(pattern)).toBe(instructions);
  });
});

describe("class resolution (§6.1, §3.4)", () => {
  test("a class the program already holds is reused, so a repetition's copies resolve once", () => {
    expect(program("(?i)\\p{L}{3}")).toBe("0:save 0; 1:c0; 2:c0; 3:c0; 4:save 1; 5:match");
    expect(program("abab")).toBe("0:save 0; 1:c0; 2:c1; 3:c0; 4:c1; 5:save 1; 6:match");
  });

  test.each([
    ["(?i)k", [[0x4B, 0x4B], [0x6B, 0x6B], [0x212A, 0x212A]]],
    ["(?i)[a-z]", [[0x41, 0x5A], [0x61, 0x7A], [0x17F, 0x17F], [0x212A, 0x212A]]],
    ["(?i)ß", [[0xDF, 0xDF], [0x1E9E, 0x1E9E]]],
    // Fold before complement: `(?i)[^a]` matches neither `a` nor `A`.
    ["(?i)[^a]", [[0, 0x40], [0x42, 0x60], [0x62, 0x10FFFF]]],
    // `.` is everything but `\n`, lone surrogates included (§2.7, §3.6).
    [".", [[0, 9], [11, 0x10FFFF]]],
    ["(?s).", [[0, 0x10FFFF]]],
  ])("%j", (pattern, ranges) => {
    expect(set(pattern)).toEqual(ranges);
  });

  test("a folded property class is closed under folding: `(?i)\\p{Lu}` holds `a`", () => {
    const ranges = set("(?i)\\p{Lu}");
    expect(ranges.some(([low, high]) => low <= 0x61 && 0x61 <= high)).toBe(true);
  });
});

describe("matching semantics (§3), through the Pike VM", () => {
  test.each([
    // §3.2 leftmost-first.
    ["a|ab", "ab", 1, "1+1'a' @2/1"],
    ["a*?", "aaa", 1, "1+0'' @1/0"],
    ["(a+)(a*)", "aaa", 1, "1+3'aaa' 1+3'aaa' 4+0'' @4/3"],
    ["a{2,3}", "aaaa", 1, "1+3'aaa' @4/3"],
    ["a{2,3}?", "aaaa", 1, "1+2'aa' @3/2"],
    // §3.3 captures: the last entry, never reset; a group not entered is absent.
    ["(?:(a)|b)*", "ab", 1, "1+2'ab' 1+1'a' @3/2"],
    ["(a)|b", "b", 1, "1+1'b' - @2/1"],
    ["(\\d+)-(\\d+)", "tel 12-345", 1, "5+6'12-345' 5+2'12' 8+3'345' @11/10"],
    // §3.1 codepoint positions, with the cursor's code-unit offset beside them.
    ["hello", "😀hello", 1, "2+5'hello' @7/7"],
    ["[^a]", "a😀", 1, "2+1'😀' @3/3"],
    // §2.7 anchors, and §4.3: the text before `start` is seen.
    ["^b", "ab", 2, "none"],
    ["\\bb", "ab", 2, "none"],
    ["b$", "ab", 1, "2+1'b' @3/2"],
    ["b$", "ab\n", 1, "none"],
    ["(?m)^b", "a\nb", 1, "3+1'b' @4/3"],
    ["(?m)a$", "a\r\nb", 1, "none"],
    ["(?m)a\\r$", "a\r\nb", 1, "1+2'a\r' @3/2"],
    [".", "\n", 1, "none"],
    ["(?s).", "\n", 1, "1+1'\n' @2/1"],
    ["\\w+", "héllo wörld", 1, "1+5'héllo' @6/5"],
    ["\\b\\w", "  ab", 1, "3+1'a' @4/3"],
    ["\\Bb", "ab", 1, "2+1'b' @3/2"],
    ["\\p{Greek}+", "abc αβγ", 1, "5+3'αβγ' @8/7"],
    // §3.4 simple folding, and the recorded divergence from full folding.
    ["(?i)k", "K", 1, "1+1'K' @2/1"],
    ["(?i)strasse", "Straße", 1, "none"],
    // §3.5 empty matches at boundary positions.
    ["a*", "baaab", 1, "1+0'' @1/0"],
    ["a*", "baaab", 2, "2+3'aaa' @5/4"],
    ["", "abc", 4, "4+0'' @4/3"],
    ["a", "abc", 5, "none"],
    // §3.6 a lone surrogate is one codepoint with no properties.
    [".", "\uD800", 1, "1+1'\uD800' @2/1"],
    ["\\p{Any}", "\uD800", 1, "1+1'\uD800' @2/1"],
    ["\\p{C}", "\uD800", 1, "none"],
    ["\\W", "\uD800", 1, "1+1'\uD800' @2/1"],
  ])("%j on %j from %i", (pattern, text, start, answer) => {
    expect(find(pattern, text, start)).toBe(answer);
  });
});

/**
 * Repetitions whose body can match empty, where engines part (§3.2, §3.3). The
 * answers are RE2's, as Go's `regexp` gives them since issue 46123, recorded
 * here as `[start, end, group 1 start, group 1 end]` code-unit offsets: the
 * dialect is RE2's, and this is the construction it names.
 */
describe("nullable repetitions answer as RE2 and Go do", () => {
  test.each([
    ["(|a)*", "aa", "1+0'' 1+0'' @1/0"],
    ["(?:|a){0,5}", "aa", "1+0'' @1/0"],
    ["(a*)*", "b", "1+0'' 1+0'' @1/0"],
    ["(a|)*", "aa", "1+2'aa' 2+1'a' @3/2"],
    ["(a*?)+?b", "aab", "1+3'aab' 1+2'aa' @4/3"],
    ["(a*)+", "b", "1+0'' 1+0'' @1/0"],
    ["(a|)+", "aa", "1+2'aa' 2+1'a' @3/2"],
    ["(?:a|)*b", "aab", "1+3'aab' @4/3"],
  ])("%j on %j", (pattern, text, answer) => {
    expect(find(pattern, text, 1)).toBe(answer);
  });
});

describe("the cursor (§6.2)", () => {
  test("a cursor this row answered resumes the walk, and decides nothing else", () => {
    const text = "😀a😀a😀a";
    expect(find("a", text, 1)).toBe("2+1'a' @3/3");
    // Resuming from the answered cursor at the next start: the same answer as
    // a walk from the string's start.
    expect(findWith("a", text, 3, 3, 3, true)).toBe(find("a", text, 3));
    expect(findWith("a", text, 5, 3, 3, true)).toBe(find("a", text, 5));
    // A cursor past `start` is not used.
    expect(findWith("a", text, 2, 5, 6, true)).toBe(find("a", text, 2));
  });

  test("with spans clear, only whether there is a match, and the cursor echoed", () => {
    expect(findWith("b", "abc", 1, 1, 0, false)).toBe(" @1/0");
    expect(findWith("z", "abc", 1, 1, 0, false)).toBe("none");
  });
});

/**
 * Leftmost-first is the matching order JavaScript's own engine has (§3.2), so
 * over patterns where the two dialects agree — no Perl class, no word boundary,
 * no folding, and only the whole match compared, since JavaScript resets a
 * group on each iteration (§3.3) — the whole match is the same span.
 */
describe("the whole match agrees with JavaScript's leftmost-first engine", () => {
  const atom = fc.constantFrom("a", "b", "c", ".", "[ab]", "[^a]", "(?:a|b)", "(?:ab|a)", "(?:)", "^", "$");
  const piece = fc.tuple(atom, fc.constantFrom("", "*", "+", "?", "*?", "+?", "??", "{2}", "{1,2}", "{0,2}?"))
    .map(([body, quantifier]) => (body === "^" || body === "$" ? body : body + quantifier));
  const branch = fc.array(piece, { minLength: 0, maxLength: 4 }).map((pieces) => pieces.join(""));
  const pattern = fc.array(branch, { minLength: 1, maxLength: 3 }).map((branches) => branches.join("|"));
  const subject = fc.array(fc.constantFrom("a", "b", "c", "\n", "😀"), { maxLength: 8 }).map((chars) => chars.join(""));

  // JavaScript searches from a code-unit `lastIndex`; the engine from a
  // codepoint position, with the text before it still seen by `^` (§4.3).
  test("for every generated pattern, subject and start", () => {
    fc.assert(fc.property(pattern, subject, fc.nat(9), (source, text, skip) => {
      const points = [...text];
      const start = Math.min(skip, points.length) + 1;
      const host = new RegExp(source, "gu");
      host.lastIndex = points.slice(0, start - 1).join("").length;
      const found = host.exec(text);
      const expected = found === null
        ? "none"
        : `${[...text.slice(0, found.index)].length + 1}+${[...found[0]].length}'${found[0]}'`;
      const answer = find(source, text, start);
      expect(answer === "none" ? "none" : answer.split(" ")[0]).toBe(expected);
    }), { numRuns: 400 });
  });
});

/**
 * The lazy DFA (§6.2) runs in front of the VM: the forward scan finds the match's
 * end, the reverse scan its start, and the VM assigns captures over that span.
 * Every route answers the same match, so the DFA route is checked against the
 * VM alone, groups and cursor included, over patterns with captures and every
 * assertion.
 */
describe("the DFA route answers what the VM alone answers", () => {
  const atom = fc.constantFrom("a", "b", ".", "[ab]", "[^a]", "\\w", "\\W", "(a)", "(a|b)", "(?:ab|a)", "(b*)",
    "(?:)", "^", "$", "\\b", "\\B", "\\A", "\\z", "(?m:^)", "(?m:$)", "(|a)");
  const piece = fc.tuple(atom, fc.constantFrom("", "*", "+", "?", "*?", "+?", "{2}", "{0,2}"))
    // An assertion takes no quantifier (§2.5).
    .map(([body, quantifier]) => (["^", "$", "\\b", "\\B", "\\A", "\\z"].includes(body) ? body : body + quantifier));
  const branch = fc.array(piece, { maxLength: 4 }).map((pieces) => pieces.join(""));
  const pattern = fc.array(branch, { minLength: 1, maxLength: 3 }).map((branches) => branches.join("|"));
  const subject = fc.array(fc.constantFrom("a", "b", " ", "\n", "😀"), { maxLength: 8 }).map((chars) => chars.join(""));

  test("for every generated pattern, subject and start", () => {
    fc.assert(fc.property(pattern, subject, fc.nat(9), fc.boolean(), (source, text, skip, spans) => {
      const start = Math.min(skip, [...text].length + 1) + 1;
      const viaDfa = findWith(source, text, start, 1, 0, spans);
      const viaVm = findVm(source, text, start, spans);
      expect(viaDfa).toBe(spans ? viaVm : viaVm.replace(/ @.*$/u, " @1/0"));
    }), { numRuns: 400 });
  });

  test("a cache that fills is discarded, and a second fill hands the search to the VM", () => {
    // `(a|b)*a(a|b){12}` needs a state for every window of the last thirteen
    // codepoints, past the budget on a long enough subject.
    const source = "(a|b)*a(a|b){12}";
    // A pseudo-random subject, so that the windows are many and the states with
    // them: a linear congruential generator, seeded, so the subject is fixed.
    let text = "";
    let seed = 12345;
    for (let index = 0; index < 20000; index += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      text += Math.floor(seed / 65536) % 2 === 0 ? "a" : "b";
    }
    expect(findWith(source, text, 1, 1, 0, true)).toBe(findVm(source, text, 1, true));
  }, 60_000);
});
