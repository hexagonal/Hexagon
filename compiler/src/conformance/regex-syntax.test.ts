import { beforeAll, describe, expect, test } from "vitest";
import { compileMain, runMain } from "../support/test-project.js";
import { STDLIB_SOURCES } from "../stdlib-sources.js";

// `Regex.Syntax` (`spec/regex.md` §2, §5): the dialect's parser and its public
// tree. The tree is read through a renderer written against the public surface,
// so these pins hold the module to what a program can see: `[…]i` is a folded
// class, `\p{gc=Nd}` a property item, `rep{2,3}?` a lazy repetition, `cap1<y>` a
// named capture, and `#45` a codepoint the renderer will not print bare.
const RENDERER = String.raw`module Main
import Hex.Regex.Syntax as Syntax

let pointText(point: Int): String =
    if point >= 33 and point <= 126 and point != 45 and point != 93 then
        match String.fromCodepoint(point)
            Some(text) => text
            None => "?"
    else
        "#" ++ show(point)

let kindText(kind: Syntax.PropertyKind): String = match kind
    Syntax.GeneralCategory => "gc"
    Syntax.Script => "sc"
    Syntax.ScriptExtensions => "scx"
    Syntax.Binary => "bin"
    Syntax.Any => "Any"
    Syntax.Ascii => "ASCII"
    Syntax.Assigned => "Assigned"
    Syntax.Word => "Word"

let itemText(item: Syntax.ClassItem): String = match item
    Syntax.Range(low, high) =>
        if low == high then pointText(low) else pointText(low) ++ "-" ++ pointText(high)
    Syntax.Property(kind, value, negated) =>
        let letter = if negated then "\\P" else "\\p"
        if value == "" then letter ++ "{" ++ kindText(kind) ++ "}" else letter ++ "{" ++ kindText(kind) ++ "=" ++ value ++ "}"

let anchorText(kind: Syntax.AnchorKind): String = match kind
    Syntax.TextStart => "\\A"
    Syntax.TextEnd => "\\z"
    Syntax.LineStart => "^m"
    Syntax.LineEnd => "$m"
    Syntax.WordBoundary => "\\b"
    Syntax.NotWordBoundary => "\\B"

let joined(parts: Vector(String), separator: String): String = String.join(Iterable.toSeq(parts), separator)

fun render(expr: Syntax.Expr): String = match expr
    Syntax.Empty => "()"
    Syntax.Literal(point) => pointText(point)
    Syntax.Dot(newline) => if newline then ".s" else "."
    Syntax.Class(items, negated, folded) =>
        var texts: Vector(String) = []
        for item in items
            texts := texts.append(itemText(item))
        (if negated then "[^" else "[") ++ joined(texts, " ") ++ (if folded then "]i" else "]")
    Syntax.Anchor(kind) => anchorText(kind)
    Syntax.Concat(parts) =>
        var texts: Vector(String) = []
        for part in parts
            texts := texts.append(render(part))
        "cat(" ++ joined(texts, " ") ++ ")"
    Syntax.Alternate(branches) =>
        var texts: Vector(String) = []
        for branch in branches
            texts := texts.append(render(branch))
        "alt(" ++ joined(texts, " | ") ++ ")"
    Syntax.Repeat(body, min, max, greedy) =>
        let upper = match max
            Some(value) => show(value)
            None => ""
        "rep{" ++ show(min) ++ "," ++ upper ++ (if greedy then "}(" else "}?(") ++ render(body) ++ ")"
    Syntax.Capture(body, index, name) =>
        let label = match name
            Some(text) => "<" ++ text ++ ">"
            None => ""
        "cap" ++ show(index) ++ label ++ "(" ++ render(body) ++ ")"

export let describe(pattern: String): String = match Syntax.parse(pattern)
    Ok(parsed) => render(parsed.root) ++ " #" ++ show(parsed.groupCount)
    Err(error) => "error " ++ show(error.position) ++ ": " ++ error.message

export let groupIndex(pattern: String, name: String): Int = match Syntax.parse(pattern)
    Ok(parsed) => match Map.get(parsed.names, name)
        Some(index) => index
        None => 0
    Err(_) => -1
`;

let parse: (pattern: string) => string;
let groupIndex: (pattern: string, name: string) => number;

beforeAll(async () => {
  const module = await runMain(RENDERER);
  parse = module.describe as typeof parse;
  groupIndex = module.groupIndex as typeof groupIndex;
}, 60_000);

describe("Regex.Syntax: the module", () => {
  test("a program imports it and the renderer compiles cleanly", () => {
    expect(compileMain(RENDERER).diagnostics).toEqual([]);
  });

  const originals = import.meta.glob("../../../stdlib/Regex/Syntax.hex", {
    eager: true, query: "?raw", import: "default",
  }) as Record<string, string>;

  test("the embedded source matches the canonical module, which declares no door rows (§5)", () => {
    const [source] = Object.values(originals);
    expect(STDLIB_SOURCES["Regex.Syntax"]).toBe(source);
    expect(source).not.toMatch(/^\s*extern\b/mu);
  });
});

describe("Regex.Syntax: trees (§5)", () => {
  test.each([
    ["", "() #0"],
    ["a|b", "alt(a | b) #0"],
    ["a|", "alt(a | ()) #0"],
    ["()", "cap1(()) #1"],
    ["(?:ab)c", "cat(cat(a b) c) #0"],
    [".", ". #0"],
    ["(?s).", ".s #0"],
    ["^$", "cat(\\A \\z) #0"],
    ["(?m)^$", "cat(^m $m) #0"],
    ["\\b\\B\\A\\z", "cat(\\b \\B \\A \\z) #0"],
    ["a{2,3}?", "rep{2,3}?(a) #0"],
    ["a{2,}", "rep{2,}(a) #0"],
    ["a{3}", "rep{3,3}(a) #0"],
    ["x*?y+z?", "cat(rep{0,}?(x) rep{1,}(y) rep{0,1}(z)) #0"],
    ["(?<y>a)(b)(?P<z>c)", "cat(cap1<y>(a) cap2(b) cap3<z>(c)) #3"],
    ["\\u{1F600}", "#128512 #0"],
    ["\\.\\\\\\(\\-", "cat(. \\ ( #45) #0"],
    ["\\é", "#233 #0"],
    ["]}", "cat(#93 }) #0"],
    ["#{2}", "rep{2,2}(#) #0"],
  ])("%j", (pattern, tree) => {
    expect(parse(pattern)).toBe(tree);
  });

  test.each([
    ["(?i)k", "[k]i #0"],
    ["(?i)[a-z]", "[a-z]i #0"],
    ["(?i)\\d", "[\\p{gc=Nd}]i #0"],
    ["a(?i)b|c", "alt(cat(a [b]i) | [c]i) #0"],
    ["(?i:a)b", "cat([a]i b) #0"],
    ["(?i-s:a)", "[a]i #0"],
    ["(?i)a(?-i)b", "cat([a]i b) #0"],
    ["((?i)a)b", "cat(cap1([a]i) b) #1"],
  ])("flags resolve in the tree: %j", (pattern, tree) => {
    expect(parse(pattern)).toBe(tree);
  });

  test.each([
    ["\\d", "[\\p{gc=Nd}] #0"],
    ["\\D", "[^\\p{gc=Nd}] #0"],
    ["\\s", "[\\p{bin=White_Space}] #0"],
    ["\\w", "[\\p{Word}] #0"],
    ["\\W", "[^\\p{Word}] #0"],
    ["\\P{L}", "[^\\p{gc=L}] #0"],
    ["[\\P{L}]", "[\\P{gc=L}] #0"],
    ["[\\W\\d]", "[\\P{Word} \\p{gc=Nd}] #0"],
    ["[a-z\\d]", "[a-z \\p{gc=Nd}] #0"],
    ["[\\dx-za-c]", "[a-c x-z \\p{gc=Nd}] #0"],
    ["[b-da-cf]", "[a-d f] #0"],
    ["[a-cd-f]", "[a-f] #0"],
    ["[-a]", "[#45 a] #0"],
    ["[a-]", "[#45 a] #0"],
    ["[^-a]", "[^#45 a] #0"],
    ["[a^b]", "[^ a-b] #0"],
    ["[a--]", "error 4: range `a--` is reversed"],
    ["[\\-]", "[#45] #0"],
    ["[\\]]", "[#93] #0"],
  ])("classes: %j", (pattern, tree) => {
    expect(parse(pattern)).toBe(tree);
  });

  test.each([
    ["(?x) a b # c\n c", "cat(a b c) #0"],
    ["(?x)[ ]", "[#32] #0"],
    ["(?x)\\ a", "cat(#32 a) #0"],
    ["(?x)\\#", "# #0"],
    ["(?x)a #x\n *", "rep{0,}(a) #0"],
    ["(?x:a b)c d", "cat(cat(a b) c #32 d) #0"],
    ["(?x)a{1, 3}", "error 6: `{` must begin a counted repetition `{n}`, `{n,}`, or `{n,m}`; write `\\{` for a literal"],
    ["(?x)\\u{6 1}", "error 5: `\\u{…}` takes one to six hexadecimal digits up to 10FFFF, not a surrogate"],
  ])("x mode scans as the parser reads: %j", (pattern, tree) => {
    expect(parse(pattern)).toBe(tree);
  });

  test.each([
    ["\\p{Uppercase_Letter}", "[\\p{gc=Lu}] #0"],
    ["\\p{gc=Uppercase_Letter}", "[\\p{gc=Lu}] #0"],
    ["\\p{General_Category:Nd}", "[\\p{gc=Nd}] #0"],
    ["\\p{LC}", "[\\p{gc=LC}] #0"],
    ["\\p{Cs}", "[\\p{gc=Cs}] #0"],
    ["\\p{Grek}", "[\\p{sc=Greek}] #0"],
    ["\\p{Script=Latn}", "[\\p{sc=Latin}] #0"],
    ["\\p{scx=Zinh}", "[\\p{scx=Inherited}] #0"],
    ["\\p{Hrkt}", "[\\p{sc=Katakana_Or_Hiragana}] #0"],
    ["\\p{Gara}", "[\\p{sc=Garay}] #0"],
    ["\\p{WSpace}", "[\\p{bin=White_Space}] #0"],
    ["\\p{space}", "[\\p{bin=White_Space}] #0"],
    ["\\p{Alpha}", "[\\p{bin=Alphabetic}] #0"],
    ["\\p{Upper}", "[\\p{bin=Uppercase}] #0"],
    ["\\p{Lower}", "[\\p{bin=Lowercase}] #0"],
    ["\\p{NChar}", "[\\p{bin=Noncharacter_Code_Point}] #0"],
    ["\\p{DI}", "[\\p{bin=Default_Ignorable_Code_Point}] #0"],
    ["\\pN", "[\\p{gc=N}] #0"],
    ["\\p{Any}", "[\\p{Any}] #0"],
    ["\\p{ASCII}", "[\\p{ASCII}] #0"],
    ["\\P{Assigned}", "[^\\p{Assigned}] #0"],
    ["\\p{digit}", "error 1: `\\p{digit}` names no supported property"],
    ["\\p{punct}", "error 1: `\\p{punct}` names no supported property"],
    ["\\p{Combining_Mark}", "error 1: `\\p{Combining_Mark}` names no supported property"],
    ["\\p{Qaai}", "error 1: `\\p{Qaai}` names no supported property"],
    ["\\p{Word}", "error 1: `\\p{Word}` names no supported property"],
    ["\\p{ID_Start}", "error 1: `\\p{ID_Start}` names no supported property"],
    ["\\p{Uppercase_Letter=Yes}", "error 1: `\\p{Uppercase_Letter=Yes}` names no supported property"],
    ["\\p{alpha}", "error 1: `\\p{alpha}` names no supported property; write `\\p{Alpha}`"],
    ["\\p{uppercase letter}", "error 1: `\\p{uppercase letter}` names no supported property; write `\\p{Uppercase_Letter}`"],
    ["\\p{sc=greek}", "error 1: `\\p{sc=greek}` names no supported property; write `\\p{sc=Greek}`"],
    ["\\p{any}", "error 1: `\\p{any}` names no supported property; write `\\p{Any}`"],
  ])("Unicode 17.0.0's property names, exactly (§2.4): %j", (pattern, tree) => {
    expect(parse(pattern)).toBe(tree);
  });

  test("group names map to their numbers", () => {
    expect(groupIndex("(a)(?<year>b)(?P<day>c)", "year")).toBe(2);
    expect(groupIndex("(a)(?<year>b)(?P<day>c)", "day")).toBe(3);
    expect(groupIndex("(a)(?<year>b)", "month")).toBe(0);
  });
});

describe("Regex.Syntax: bounds (§2.5)", () => {
  test("nesting is bounded at a thousand groups, refused at the opening beyond", () => {
    expect(parse("(".repeat(1000) + "a" + ")".repeat(1000))).toMatch(/^cap1\(/u);
    expect(parse("(".repeat(1001) + "a" + ")".repeat(1001))).toBe("error 1001: nesting deeper than 1000");
  });

  test.each([
    ["a{1000}", "rep{1000,1000}(a) #0"],
    ["((a{10}){10}){10}", "rep{10,10}(cap1(rep{10,10}(cap2(rep{10,10}(a))))) #2"],
    ["(a*){1000}", "rep{1000,1000}(cap1(rep{0,}(a))) #1"],
    ["a{1001}", "error 2: repetition count exceeds 1000"],
    ["a{0,1001}", "error 2: repetition count exceeds 1000"],
    ["(a{40}){40}", "error 8: nested repetition counts multiply past 1000"],
    ["(a{40}){0,40}", "error 8: nested repetition counts multiply past 1000"],
    ["((a{10}){10}){11}", "error 14: nested repetition counts multiply past 1000"],
    ["(a{40}|b){40}", "error 10: nested repetition counts multiply past 1000"],
  ])("%j", (pattern, tree) => {
    expect(parse(pattern)).toBe(tree);
  });

  test("a long pattern parses", () => {
    expect(parse("ab".repeat(5000))).toMatch(/^cat\(a b a b /u);
  });
});

// One test per §2.9 row, at the row's position.
describe("Regex.Syntax: RegexError (§2.9)", () => {
  test.each([
    ["(", "error 1: missing `)` for the group opened here"],
    ["(a(b)", "error 1: missing `)` for the group opened here"],
    ["(?i", "error 1: missing `)` for the group opened here"],
    [")", "error 1: unmatched `)`; write `\\)` for a literal"],
    ["a)", "error 2: unmatched `)`; write `\\)` for a literal"],
    ["[", "error 1: missing `]` for the class opened here"],
    ["[a", "error 1: missing `]` for the class opened here"],
    ["[]", "error 1: empty class; write `\\]` for a literal `]`"],
    ["[^]", "error 1: empty class; write `\\]` for a literal `]`"],
    ["[]a]", "error 1: empty class; write `\\]` for a literal `]`"],
    ["[[:alpha:]]", "error 2: `[` inside a class must be written `\\[`; POSIX classes are not part of the dialect; write `\\p{Alphabetic}`"],
    ["[[:", "error 2: `[` inside a class must be written `\\[`; POSIX classes are not part of the dialect; write `\\p{Alphabetic}`"],
    ["[a[]", "error 3: `[` inside a class must be written `\\[`"],
    ["(?<year", "error 3: group name is not closed; write `(?<year>…)`"],
    ["(?<year)", "error 3: group name is not closed; write `(?<year>…)`"],
    ["[z-a]", "error 4: range `z-a` is reversed"],
    ["[\\u{7A}-a]", "error 9: range `\\u{7A}-a` is reversed"],
    ["[\\d-z]", "error 4: a range's ends are single codepoints; write `\\-` for a literal hyphen"],
    ["[a-z-0]", "error 5: a range's ends are single codepoints; write `\\-` for a literal hyphen"],
    ["[a-\\d]", "error 3: a range's ends are single codepoints; write `\\-` for a literal hyphen"],
    ["[\\b]", "error 2: `\\b` is an assertion, not a codepoint; a class cannot hold it"],
    ["[\\A]", "error 2: `\\A` is an assertion, not a codepoint; a class cannot hold it"],
    ["*a", "error 1: nothing to repeat before `*`"],
    ["|*", "error 2: nothing to repeat before `*`"],
    ["(*)", "error 2: nothing to repeat before `*`"],
    ["{3}", "error 1: nothing to repeat before `{3}`"],
    ["^*", "error 2: nothing to repeat before `*`; `^` is an assertion, not an atom"],
    ["\\b+", "error 3: nothing to repeat before `+`; `\\b` is an assertion, not an atom"],
    ["(?i)?", "error 5: nothing to repeat before `?`; `(?i)` sets flags, not an atom"],
    ["a(?i)*", "error 6: nothing to repeat before `*`; `(?i)` sets flags, not an atom"],
    ["a**", "error 3: `**` repeats a repetition; write `(a*)*`"],
    ["a+?*", "error 4: `+?*` repeats a repetition; write `(a+?)*`"],
    ["a{2}{3}", "error 5: `{2}{3}` repeats a repetition; write `(a{2}){3}`"],
    ["a{", "error 2: `{` must begin a counted repetition `{n}`, `{n,}`, or `{n,m}`; write `\\{` for a literal"],
    ["a{,3}", "error 2: `{` must begin a counted repetition `{n}`, `{n,}`, or `{n,m}`; write `\\{` for a literal"],
    ["a{x}", "error 2: `{` must begin a counted repetition `{n}`, `{n,}`, or `{n,m}`; write `\\{` for a literal"],
    ["{x", "error 1: `{` must begin a counted repetition `{n}`, `{n,}`, or `{n,m}`; write `\\{` for a literal"],
    ["a{3,1}", "error 2: `{3,1}` has a minimum above its maximum"],
    ["\\", "error 2: pattern ends inside an escape"],
    ["ab\\", "error 4: pattern ends inside an escape"],
    ["\\q", "error 1: `\\q` is not an escape; write `q`, or see the escape table"],
    ["\\E", "error 1: `\\E` is not an escape; write `E`, or see the escape table"],
    ["\\1", "error 1: `\\1` is a backreference, which the dialect does not have"],
    ["\\9", "error 1: `\\9` is a backreference, which the dialect does not have"],
    ["\\0", "error 1: `\\0` is not an escape; write `\\u{…}`"],
    ["\\x41", "error 1: `\\x` is not an escape; write `\\u{…}`"],
    ["\\f", "error 1: `\\f` is not an escape; write `\\u{…}`"],
    ["\\v", "error 1: `\\v` is not an escape; write `\\u{…}`"],
    ["\\a", "error 1: `\\a` is not an escape; write `\\u{…}`"],
    ["\\e", "error 1: `\\e` is not an escape; write `\\u{…}`"],
    ["\\Q", "error 1: `\\Q` is not an escape; quote text with `Regex.escape`"],
    ["\\X", "error 1: `\\X` is not an escape; the dialect has no grapheme atom"],
    ["\\R", "error 1: `\\R` is not an escape; the dialect has no linebreak atom"],
    ["\\h", "error 1: `\\h` is not an escape; the dialect has no horizontal-space atom"],
    ["\\C", "error 1: `\\C` is not an escape; the dialect has no byte atom"],
    ["\\Z", "error 1: `\\Z` is not an escape; write `\\z`, since the dialect has no before-final-newline anchor"],
    ["\\u{D800}", "error 1: `\\u{…}` takes one to six hexadecimal digits up to 10FFFF, not a surrogate"],
    ["\\u{110000}", "error 1: `\\u{…}` takes one to six hexadecimal digits up to 10FFFF, not a surrogate"],
    ["\\u{}", "error 1: `\\u{…}` takes one to six hexadecimal digits up to 10FFFF, not a surrogate"],
    ["\\u{1234567}", "error 1: `\\u{…}` takes one to six hexadecimal digits up to 10FFFF, not a surrogate"],
    ["\\u41", "error 1: `\\u{…}` takes one to six hexadecimal digits up to 10FFFF, not a surrogate"],
    ["\\u{41", "error 1: `\\u{…}` takes one to six hexadecimal digits up to 10FFFF, not a surrogate"],
    ["\\p{Foo}", "error 1: `\\p{Foo}` names no supported property"],
    ["\\pQ", "error 1: `\\pQ` names no supported property"],
    ["\\p{Alphabetic=Yes}", "error 1: `\\p{Alphabetic=Yes}` names no supported property"],
    ["\\p{lu}", "error 1: `\\p{lu}` names no supported property; write `\\p{Lu}`"],
    ["\\p{Greek_}", "error 1: `\\p{Greek_}` names no supported property; write `\\p{Greek}`"],
    ["\\P{GC=lu}", "error 1: `\\P{GC=lu}` names no supported property; write `\\P{gc=Lu}`"],
    ["\\p", "error 1: `\\p` takes one letter or a braced name"],
    ["\\p{", "error 1: `\\p` takes one letter or a braced name"],
    ["\\p{}", "error 1: `\\p` takes one letter or a braced name"],
    ["\\p1", "error 1: `\\p` takes one letter or a braced name"],
    ["\\p{^Greek}", "error 1: `\\p{^Greek}` is not a spelling; write `\\P{Greek}`"],
    ["\\P{^Greek}", "error 1: `\\P{^Greek}` is not a spelling; write `\\p{Greek}`"],
    ["(?=a)", "error 2: `(?=` is lookahead, which the dialect does not have"],
    ["(?!a)", "error 2: `(?!` is negative lookahead, which the dialect does not have"],
    ["(?<=a)", "error 2: `(?<=` is lookbehind, which the dialect does not have"],
    ["(?<!a)", "error 2: `(?<!` is negative lookbehind, which the dialect does not have"],
    ["(?P=n)", "error 2: `(?P=` is a backreference, which the dialect does not have"],
    ["(?#c)", "error 2: `(?` must be followed by `:`, `P<`, `<`, or flags"],
    ["(?", "error 2: `(?` must be followed by `:`, `P<`, `<`, or flags"],
    ["(?U)", "error 3: `U` is not a flag; the flags are `i`, `m`, `s`, `x`"],
    ["(?iq:a)", "error 4: `q` is not a flag; the flags are `i`, `m`, `s`, `x`"],
    ["(?ii)", "error 4: `i` is set twice"],
    ["(?i-i)", "error 5: `i` is set twice"],
    ["(?i-)", "error 5: nothing follows `-`"],
    ["(?-)", "error 4: nothing follows `-`"],
    ["(?)", "error 3: `(?)` sets no flag"],
    ["(?<1a>x)", "error 4: group name must match `[A-Za-z_][A-Za-z0-9_]*`"],
    ["(?<>x)", "error 4: group name must match `[A-Za-z_][A-Za-z0-9_]*`"],
    ["(?<a-b>x)", "error 4: group name must match `[A-Za-z_][A-Za-z0-9_]*`"],
    ["(?<a>x)(?<a>y)", "error 11: group `a` is already defined"],
    ["(?<a>x)(?P<a>y)", "error 12: group `a` is already defined"],
  ])("%j", (pattern, refusal) => {
    expect(parse(pattern)).toBe(refusal);
  });

  test("the first fault in reading order is the one reported", () => {
    expect(parse("\\q(")).toBe("error 1: `\\q` is not an escape; write `q`, or see the escape table");
    expect(parse("(a{40}\\q){40}")).toBe("error 7: `\\q` is not an escape; write `q`, or see the escape table");
    expect(parse("a)\\q")).toBe("error 2: unmatched `)`; write `\\)` for a literal");
  });
});
