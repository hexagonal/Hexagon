# Hexagon Spec: `Regex`

**Status:** Decided (#927 — the eight rulings this document records; the foundations it stands on landed at #928). Scheduled, nothing shipped: `stdlib/Regex.hex`, `stdlib/Regex/Syntax.hex`, and `stdlib/Runtime/Regex.hex` implement this surface when the arc's implementation lands, and this document is their contract (`stdlib-roadmap.md` §5 records the row).
**Scope:** The pattern language (the dialect), matching semantics, the public surface of `Regex`, the public syntax tree of `Regex.Syntax`, the obligations on the engine `Hex.Runtime.Regex`, the door inventory the three modules declare, and literal-pattern emission.
**Not in scope:** The intrinsic `type` form and the Hex-wide door (Intrinsics §3.3, §5.2 — assumed); species (d) itself (Effects §6.2 — assumed); the String companion's own text-processing surface (`string-text-processing.md`, whose currency this document adopts and whose one divergence it names); compile-time diagnostics for literal patterns and typed captures (§10, later rulings).
**Companions:** `string-text-processing.md` (positions, the codepoint unit, Unicode version, full folding), `intrinsics.md` (§3.3 the `type` form, §4.2 sealed rows, §5.2 the gate), `effects.md` (§6.2 species (d), §7 the sequence posture), Loops §6 (`Seq`), Modules §4.2 (`opaque`), Method Syntax §4 (the dot), `stdlib-roadmap.md`.

---

## 1. Doctrine

**`Regex` is a standard-library module outside the prelude — `import Regex` — with its own engine, written in Hexagon, on the RE2 path.** It does not wrap the host's `RegExp`. The String spec pins every Unicode-sensitive answer to the compiler's Unicode 17.0.0 tables and forbids a host operation from deciding public semantics (`string-text-processing.md` §1); a host `\p{…}` or `/i` would decide exactly that, with whichever Unicode version the host happens to carry. The engine therefore answers every property and folding question from the same tables `String.hex` reads, and a program's matches are the same on every host beneath unchanged compiler bits.

Four commitments, each a ruling of #927, shape everything below:

- **The unit is the codepoint** — the String spec's currency (§3.1). `.` and a class consume one codepoint; a span is a 1-based codepoint position and a codepoint count; a lone surrogate is one codepoint with no properties. Grapheme clusters are not the unit and no flag makes them one.
- **The dialect is RE2's, restricted** (§2): no backreferences, no lookaround, leftmost-first matching only. Every pattern the parser accepts matches in time linear in the subject (§6.4); there is no pattern whose ambiguity a subject can turn against the program.
- **The engine is one construction** (§6): one Thompson NFA, a lazy DFA for the scan and a Pike VM for captures and as the always-linear fallback. Derivative-based matching was rejected because captures would then be a second semantic definition of the pattern beside the one the DFA implements.
- **The surface is pure and the engine is not** (§7): the engine is written `->!` throughout over confined `Buffer` storage, and purity is claimed once, at two sealed `->` rows whose lowerings are its compiled bodies — Effects §6.2's species (d), owned scratch, with the lazy-DFA cache a compiled `Regex` owns as the species' one owned memo. A `Regex` is a value: comparing, sharing, hoisting, and dropping a search are the compiler's to do as with any pure call.

The surface is small by design (§4): one `compile`, flags inline in the pattern, `Result` where a pattern can be wrong, a lazy `Seq(Match)` where there are many matches, and a `Match -> String` function where a replacement needs the match — no replacement-token language.

## 2. The pattern language

### 2.1 A pattern is a `String`

A pattern is an ordinary Hexagon `String`, read by codepoint. The lexer's escapes act first: `"\\d"` reaches the parser as the two codepoints `\d`, and `"\u{1F600}"` reaches it as one codepoint, already a literal. The pattern language has its own backslash escapes (§2.3), so a pattern written as a literal doubles every backslash the pattern needs — the JavaScript, Rust, and Go convention, without a raw-string form (§10 records the literal form as a later ruling). `#{` is the lexer's reserved sequence inside a literal (Lexer §6.2); a pattern that needs those two codepoints — `#{2}`, or a comment under `x` mode beginning `#{` — writes `\#{`, the lexer's own fix-it.

Positions in a pattern, as reported in a `RegexError` (§2.9), are 1-based codepoint positions in the pattern string.

### 2.2 Grammar

```
pattern     ::= alternation
alternation ::= concat ('|' concat)*
concat      ::= piece*
piece       ::= atom quantifier? | anchor | setting
quantifier  ::= ('*' | '+' | '?' | '{' n '}' | '{' n ',' '}' | '{' n ',' m '}') '?'?
atom        ::= literal | '.' | class | classescape | codeescape | group
group       ::= '(' alternation ')'
              | '(?:' alternation ')'
              | '(?P<' name '>' alternation ')' | '(?<' name '>' alternation ')'
              | '(?' flags ':' alternation ')'
setting     ::= '(?' flags ')'
flags       ::= flag+ ('-' flag+)? | '-' flag+   -- flag ::= 'i' | 'm' | 's' | 'x', each at most once
anchor      ::= '^' | '$' | '\A' | '\z' | '\b' | '\B'
class       ::= '[' '^'? item+ ']'
item        ::= single | single '-' single | classescape
single      ::= literal | codeescape                 -- one codepoint
classescape ::= '\d' | '\D' | '\s' | '\S' | '\w' | '\W' | property
codeescape  ::= '\n' | '\t' | '\r' | '\u{' hex+ '}' | '\' punct
name        ::= [A-Za-z_] [A-Za-z0-9_]*
n, m        ::= decimal digits
```

`literal` is any codepoint that is not a metacharacter at its position; `punct` is any codepoint that is not an ASCII letter or digit (§2.3); `property` is §2.4's `\p`/`\P` forms. An anchor and a flag setting are not atoms: a quantifier after one (`^*`, `\b+`, `(?i)*`) is refused as having nothing to repeat (§2.5).

An empty pattern, an empty branch of an alternation (`a|`), and an empty group (`()`) are legal and match the empty string. Precedence is the grammar's: a quantifier binds tighter than concatenation, concatenation tighter than `|`, and a group overrides.

The metacharacters — the codepoints that do not stand for themselves outside a class — are `\ . + * ? ( ) | [ { ^ $`. `]` and `}` outside their constructs are literals; `{` is not (§2.5). Every other codepoint is a literal matching itself. Under `x` (§2.6), `#` and every `White_Space` codepoint join them outside a class. Inside a class the metacharacters are `\ ] [ ^ -` (§2.4).

### 2.3 Escapes

Backslash before a codepoint that is **not an ASCII letter or digit** is that codepoint, literally: `\.`, `\\`, `\(`, `\ ` (a space), `\-`, `\_`. That is the rule `Regex.escape` (§4.2) relies on, and it makes any punctuation safe to escape whether or not it is a metacharacter.

Backslash before an ASCII letter or digit is an escape from this closed table, and any other is a `RegexError` (§2.9) — there is no fallback to the letter:

| Escape | Meaning |
|---|---|
| `\n`, `\t`, `\r` | line feed, tab, carriage return — Lexer §6.2's spellings, so the two escape sets agree wherever both define a spelling |
| `\u{H…}` | one codepoint, one to six hexadecimal digits, at most U+10FFFF, not a surrogate — Lexer §6.2's form, same bounds |
| `\d`, `\D` | `\p{Nd}` and its complement (§2.4) |
| `\s`, `\S` | `\p{White_Space}` and its complement |
| `\w`, `\W` | the word class and its complement (§2.4) |
| `\p{…}`, `\P{…}`, `\pL`, `\PL` | a Unicode property class and its complement (§2.4) |
| `\b`, `\B` | word boundary and its complement (§2.7) |
| `\A`, `\z` | text start and text end (§2.7) |

Refused by name, with a message that says what the dialect has instead (§2.9): `\1`…`\9` (a backreference), `\x` (write `\u{…}`), `\f`/`\v`/`\a`/`\e`/`\0` (write `\u{…}`), `\Q`…`\E` (use `Regex.escape`), `\X`/`\R`/`\h`/`\C` (no grapheme, linebreak, horizontal-space, or byte atoms), and `\Z` (write `\z`; the dialect has no before-final-newline anchor).

### 2.4 Classes

**Bracket classes.** `[…]` matches one codepoint in the set; `[^…]` one codepoint not in it. Inside the brackets:

- a single codepoint or an escape (§2.3) is a member; `a-z` is the inclusive range by codepoint value, and a range whose low end exceeds its high end is refused; a range's ends are single codepoints, so `[\d-z]` and `[a-z-0]` are refused at the `-` — write `\-` for a literal hyphen beside a class escape or a range;
- `-` is literal first, last, or escaped; anywhere else it is a range;
- `^` negates only as the first codepoint; elsewhere it is literal;
- `]` closes the class wherever it appears, so a literal `]` is written `\]`, and an empty class (`[]`, `[^]`) is refused rather than read as a class beginning with `]`;
- `[` inside a class is refused unless escaped — there are no nested classes and no POSIX classes, and `[:alpha:]` is refused with `\p{Alphabetic}` named as the spelling (§2.9); this is one of the dialect's refusals of something RE2 accepts (§2.8 collects them), taken to keep `[[:alpha:]]` from reading silently as a class followed by a literal;
- `\d`, `\s`, `\w`, `\p{…}` and their complements are members, contributing their sets;
- `\b`, `\B`, `\A`, `\z` are assertions and are refused in a class.

Under `i` (§2.6) a class is closed under simple case folding (§3.4) — every codepoint whose fold equals a member's fold is a member — and that includes a property class: `(?i)\p{Lu}` matches `a`, as it does in RE2 and Rust.

**Perl classes** are Unicode Regular Expressions Annex C's definitions, verbatim:

| Class | Set |
|---|---|
| `\d` | `\p{Nd}` — General_Category Decimal_Number |
| `\s` | `\p{White_Space}` — the set `String.words` and `String.trim` use (`string-text-processing.md` §2, §4); U+FEFF is not in it |
| `\w` | `\p{Alphabetic}` ∪ `\p{M}` ∪ `\p{Nd}` ∪ `\p{Pc}` ∪ Join_Control (U+200C, U+200D) |

**Property classes** admit UTS #18 RL1.2's set, verbatim and closed:

| Spelling | Property |
|---|---|
| `\p{Lu}`, `\p{Uppercase_Letter}`, `\pL`, `\p{L}`, `\p{gc=Lu}`, `\p{General_Category=Lu}` | General_Category, every value and grouping (`L`, `LC`, `Lu` … `Cn`), long or short name |
| `\p{Greek}`, `\p{Grek}`, `\p{sc=Greek}`, `\p{Script=Greek}` | Script, long or short name |
| `\p{scx=Greek}`, `\p{Script_Extensions=Greek}` | Script_Extensions — always written with its property name, so that a bare script name means Script |
| `\p{Alphabetic}`/`\p{Alpha}`, `\p{Uppercase}`/`\p{Upper}`, `\p{Lowercase}`/`\p{Lower}`, `\p{White_Space}`/`\p{WSpace}`/`\p{space}`, `\p{Noncharacter_Code_Point}`/`\p{NChar}`, `\p{Default_Ignorable_Code_Point}`/`\p{DI}` | the six binary properties RL1.2 names, long name or Unicode's own alias |
| `\p{Any}`, `\p{ASCII}`, `\p{Assigned}` | every codepoint; U+0000–U+007F; every codepoint whose General_Category is not `Cn` |

The names are Unicode's canonical long names and Unicode's own short aliases (PropertyAliases.txt, PropertyValueAliases.txt), matched **exactly** — case, underscores, and spacing as Unicode writes them. There is no loose matching (RL1.2a is not adopted): `\p{lu}`, `\p{uppercase letter}`, and `\p{Greek_}` are refused, each naming the canonical spelling. A bare name is looked up in one order — as a General_Category value, then a Script value, then one of the binary properties and `Any`/`ASCII`/`Assigned` of the table above; the three name spaces are disjoint over the admitted set, so the order settles determinism rather than a contest. `=` and `:` are both accepted between a property name and its value. `\P{…}` is the complement of `\p{…}`; the `\p{^Greek}` spelling is refused. The set is **closed**: no other property, no property of strings, no `=Yes`/`=No` form on the binary properties. A property joins by ruling and by table together — `\p{Emoji}` is the likely first request — never by a name the parser happens to accept.

A **lone surrogate** has no properties (§3.6): every `\p{…}` naming a property excludes it — `\p{Any}` alone includes it, being the whole codepoint space rather than a property — and every `\P{…}`, every negated class, and `.` include it. Since a well-formed pair is decoded to one scalar and a lone surrogate has no category, no codepoint the engine sees is a surrogate by category, and `\p{Cs}` (`\p{Surrogate}`, `\P{Cs}`) is **refused** rather than admitted as a class that can never match (§2.9); `\p{C}` stays admitted, its other members being reachable.

### 2.5 Repetition

`x*`, `x+`, `x?`, `x{n}`, `x{n,}`, and `x{n,m}` are greedy; the same with a trailing `?` are lazy — preferring fewer iterations (§3.2). There are no possessive quantifiers and no atomic groups. Bounds: `0 ≤ n ≤ m ≤ 1000` — RE2's per-operator limit — and, this dialect's own and tighter than RE2's program-size budget, across nested counted repetitions the product of the maxima (`n` standing for `{n,}`, unbounded operators counting 1) is at most 1000, which bounds the expanded program at a thousand times the pattern's length. A count or a product past its bound is refused.

A quantifier must follow an atom: `*a`, `|*`, `(*)`, a quantifier on an assertion or a flag setting (`^*`, `\b+`, `(?i)?`), and a quantifier on a quantifier (`a**`, `a+?*`) are refused — write `(a*)*` if that is meant. `{` that does not begin a well-formed counted repetition (`a{`, `a{,3}`, `a{x}`) is refused, never read as a literal brace; the literal is `\{`. That is the Scala-refusal rule of this corpus at the pattern's scale: one committed reading or a refusal that names the boundary.

Nesting of groups and quantifiers is bounded at depth 1000, refused beyond.

### 2.6 Groups, names, and flags

`(…)` is a **capturing group**, numbered by the position of its `(` among capturing groups, from 1; group 0 is the whole match. `(?:…)` groups without capturing. `(?P<name>…)` and `(?<name>…)` — both of RE2's spellings — capture under a name as well as a number; a name is `[A-Za-z_][A-Za-z0-9_]*`, refused otherwise, and a name used twice in one pattern is refused.

**Flags are inline only.** `(?flags)` sets flags for the rest of the enclosing group (or the pattern) — to its closing `)`, across `|`, so that in `a(?i)b|c` the `c` is folded, as in RE2 and Rust; `(?flags:…)` sets them for the group's body alone. `flags` is a sequence of the letters below, each at most once, optionally followed by `-` and letters to clear — `(?i)`, `(?-i)`, `(?i-s:…)`. `(?)` and `(?i-)` are refused. There is no flags argument to `compile` (§4.2) and no other flag: `U` (RE2's ungreedy) is refused by name.

| Flag | Effect |
|---|---|
| `i` | case-insensitive matching by simple case folding (§3.4) |
| `m` | multi-line: `^` and `$` match at line boundaries as well as text boundaries (§2.7) |
| `s` | `.` matches `\n` too (§2.7) |
| `x` | extended: outside a class, White_Space is ignored and `#` begins a comment that runs to the next `\n` or the end of the pattern; inside a class both are literal (Perl's and Python's `/x`, not Rust's, which strips inside a class too — §11); the `x` lexer honours the backslash, so an escaped `White_Space` codepoint is kept and `\#` begins no comment, and `\ ` is a literal space anywhere |

Lookaround — `(?=`, `(?!`, `(?<=`, `(?<!` — and the named backreference `(?P=name)` are refused by name (§2.9). `(?<` followed by `=` or `!` is lookbehind and refused; otherwise it opens a named group. Any other `(?` prefix is refused.

### 2.7 Anchors and assertions

Every assertion consumes nothing.

| Assertion | Without `m` | With `m` |
|---|---|---|
| `^` | at the start of the text | at the start of the text, or immediately after a `\n` |
| `$` | at the end of the text | at the end of the text, or immediately before a `\n` |
| `\A` | at the start of the text | the same |
| `\z` | at the end of the text | the same |

The line terminator is `\n` alone: `\r\n` ends a line at its `\n`, and a bare `\r` does not end one — RE2's rule, chosen because `$` must be decidable one codepoint ahead for the DFA. `String.lines` recognizes CR, LF, and CRLF (`string-text-processing.md` §2), and that divergence is deliberate: `lines` splits a text into lines; `m` mode positions an anchor. A program that wants CR-terminated lines splits with `lines` first. `$` without `m` matches only at the very end, never before a final `\n` — RE2 and Rust, not Perl.

`.` matches any codepoint except `\n`; under `s`, any codepoint. `\b` matches between a `\w` codepoint and a non-`\w` codepoint, either order, with the text's two edges counting as non-`\w`; `\B` matches wherever `\b` does not. The word class is §2.4's `\w`, and `i` does not change it.

### 2.8 What the dialect refuses, and why

- **Backreferences** (`\1`, `(?P=name)`): matching with backreferences is NP-hard in general, and no linear-time engine implements them. Refused by name, so the message names the fact rather than an unknown escape.
- **Lookaround**: expressible on a linear engine only in restricted forms, and each form is a second matching semantics beside leftmost-first. Refused by name.
- **Possessive quantifiers, atomic groups, conditionals, recursion**: backtracking-engine devices; the engine has no backtracking to cut.
- **POSIX classes** (`[[:alpha:]]`): ASCII-only by definition in RE2, which this dialect's Unicode posture cannot carry; `\p{…}` says the same thing in Unicode. Refused rather than misread (§2.4).
- **Loose property-name matching**: refused (§2.4) — one spelling per property, so a misspelling is an error, not a near-miss that matches something.
- **A flags argument, a global-match flag, a leftmost-longest (POSIX) mode**: the surface has one `compile` and one matching semantics (§3.2); `findAll` is the global form.

### 2.9 `RegexError`

A pattern the parser refuses answers `Err(RegexError)` from `compile` (§4.2) and from `Syntax.parse` (§5):

```
export record RegexError derives (Eq, Show) = {
    message: String,    -- one sentence, naming the fault and the spelling the dialect has instead
    position: Int,      -- 1-based codepoint position in the pattern; length + 1 when the pattern ended early
}
```

The record is ordinary data — a bad pattern is an answer, not a fault — and its home is `Regex.Syntax` (§5), where the parser lives; its fields travel with the type (Modules §4.2), so `Err(e) => e.message` needs no import of `Regex.Syntax`, and only a signature that *names* the type does. The message family, position rule per row:

| Fault | Position | Message |
|---|---|---|
| `(` without `)` | the `(` | missing `)` for the group opened here |
| `)` without `(` | the `)` | unmatched `)`; write `\)` for a literal |
| `[` without `]` | the `[` | missing `]` for the class opened here |
| `[]`, `[^]` | the `[` | empty class; write `\]` for a literal `]` |
| `[` inside a class | the inner `[` | `[` inside a class must be written `\[` — and, when followed by `:`: POSIX classes are not part of the dialect; write `\p{Alphabetic}` |
| reversed range | the range's high end | range `z-a` is reversed |
| range end not a single codepoint | the `-` | a range's ends are single codepoints; write `\-` for a literal hyphen |
| assertion in a class | the escape | `\b` is an assertion, not a codepoint; a class cannot hold it |
| quantifier without an atom | the quantifier | nothing to repeat before `*` — and, after an assertion or a flag setting: `^` is an assertion, not an atom |
| quantifier on a quantifier | the second | `**` repeats a repetition; write `(a*)*` |
| `{` not a counted repetition | the `{` | `{` must begin a counted repetition `{n}`, `{n,}`, or `{n,m}`; write `\{` for a literal |
| count past the bound | the `{` | repetition count exceeds 1000 |
| nested counts past the bound | the outermost `{` | nested repetition counts multiply past 1000 |
| nesting past the bound | the opening | nesting deeper than 1000 |
| trailing `\` | length + 1 | pattern ends inside an escape |
| unknown escape | the `\` | `\q` is not an escape; write `q`, or see the escape table |
| refused escape | the `\` | one sentence per §2.3's refused list: `\1` is a backreference, which the dialect does not have; `\x` is not an escape, write `\u{…}`; … |
| bad `\u{…}` | the `\` | `\u{…}` takes one to six hexadecimal digits up to 10FFFF, not a surrogate |
| unknown property | the `\` | `\p{Foo}` names no supported property — and, for a loose spelling of a supported one, the canonical spelling: write `\p{Lu}` |
| bad `\p` form | the `\` | `\p` takes one letter or a braced name; `\p{^Greek}` is not a spelling, write `\P{Greek}` |
| `\p{Cs}` | the `\` | `\p{Cs}` names the surrogate category, which no codepoint this engine sees carries (§3.6) |
| bad group prefix | the `?` | `(?=` is lookahead, which the dialect does not have; `(?<=` is lookbehind, …; `(?P=` is a backreference, …; `(?` must be followed by `:`, `P<`, `<`, or flags |
| bad flags | the offending letter | `U` is not a flag; the flags are `i`, `m`, `s`, `x`; `i` is set twice; nothing follows `-`; `(?)` sets no flag |
| bad name | the name | group name must match `[A-Za-z_][A-Za-z0-9_]*` |
| duplicate name | the second name | group `year` is already defined |

One report per pattern, at the first fault in reading order; the parser does not recover and go on.

## 3. Matching semantics

### 3.1 Unit and positions

The subject is read as a sequence of codepoints — a well-formed surrogate pair is one codepoint, a lone surrogate is one codepoint — and every span is a **1-based codepoint start position** and a **codepoint count**. `"😀hello"` matched by `hello` has start 2 and length 5, exactly as `String.indexOf` answers `Some(2)` (`string-text-processing.md` §8). An empty match has length 0 at a boundary position: before the first codepoint at 1, after the last at `length + 1`. UTF-16 code units never appear: not in a span, not in a position argument, not in a `RegexError`.

### 3.2 Leftmost-first

Of every way the pattern can match the subject, the match is the one whose start is **leftmost**; among matches with that start, the one **first in priority order**. Priority order is the backtracking order Perl, RE2, Rust, and JavaScript share, stated without a backtracker:

- in `x|y`, every match through `x` precedes every match through `y`;
- in a greedy repetition, more iterations precede fewer; in a lazy one, fewer precede more;
- in `xy`, the priority of `x` decides first, and `y` decides among matches that agree on `x`;
- an empty iteration of a repetition is never taken twice in a row.

So `a|ab` on `ab` matches `a`; `a*?` on `aaa` matches the empty string at 1; `(a+)(a*)` on `aaa` captures `aaa` and the empty string. This is the only matching mode: there is no leftmost-longest (POSIX) mode, and the DFA's states are ordered so that the scan finds the leftmost-first match's end, not the longest's (§6.2).

### 3.3 Captures

A capturing group's capture is the span of the group's **last entry on the chosen path**; a group the chosen path never enters has no capture, and its `Group` is `None` (§4.5). Nothing resets a capture — in `(?:(a)|b)*` on `ab` group 1 captures `a`, the second iteration having not entered it — which is what a Pike VM computes and what Perl and RE2 answer; JavaScript, alone among §3.2's engines, resets a group on each iteration of an enclosing quantifier, and this dialect does not. Group 0 is the whole match and always present.

### 3.4 Case-insensitivity is simple case folding

Under `i` (§2.6) two codepoints match when their **simple case foldings** are equal — Unicode's `CaseFolding.txt` statuses C and S, UTS #18 RL1.5 — and every literal and class is closed under that relation at compile time (§6.1): `(?i)k` matches `k`, `K`, and U+212A KELVIN SIGN; `(?i)[a-z]` matches `A`–`Z`, U+212A, and U+017F LATIN SMALL LETTER LONG S (whose simple fold is `s`), and nothing else; `(?i)ß` matches `ß` and U+1E9E and not `ss`. The unit stays one codepoint, which is what lets a class be a set of codepoints and the DFA's alphabet a partition of them.

**This is the one divergence between this module and the String companion's `Ci` family**, and it is recorded here and in `string-text-processing.md` §5: `containsCi` uses *full* folding — `"Straße".containsCi("STRASSE")` is `True` — while `(?i)strasse` does not match `Straße`. Full folding changes codepoint length, and a match that may begin or end inside a fold's expansion is a second matching semantics that an RE2 engine does not carry; the ruling accepts the divergence with regret and declines to research past it. A program that needs full-fold matching folds both sides with `String.caseFold` first and matches the folded text, accepting that positions then index the folded text.

### 3.5 Empty matches and iteration

A pattern may match the empty string, and `findAll` (§4.3) enumerates successive non-overlapping matches from left to right under one rule, RE2's and Go's: **after a match ending at `e` (its start plus its length) the search resumes at `e`; an empty match whose start equals the previous match's end is discarded; after any empty match, yielded or discarded, the search resumes one codepoint past it**. So `a*` on `baaab` yields the empty match at 1, `aaa` at 2, and the empty match at 6 — not an empty match at 5 abutting `aaa` — and `""` on `abc` yields four empty matches, at 1, 2, 3, and 4. `Regex.split` (§4.4) is defined over that enumeration and therefore agrees with `String.split` on the empty pattern: both give `["", "a", "b", "c", ""]`. Python's rule, which admits the abutting empty match, is not adopted.

### 3.6 Lone surrogates and the Unicode version

A lone surrogate reaching the engine through a JavaScript string is one codepoint with no properties (§2.4) that matches itself literally, matches `.` and every negated class, and is neither `\w` nor `\s`. It is never rejected and never replaced with U+FFFD, in the subject or in the pattern; `\u{D800}` in a pattern is refused, as Lexer §6.2 refuses it. The Unicode version is the repository's, 17.0.0, adopted by a recorded compatibility update together with every table (`string-text-processing.md` §1); no host setting reaches the engine.

## 4. The surface — `Regex.hex`

Signatures below are the normative qualified API, not declaration syntax. Every function is receiver-first — the `Regex`, or the `Match` for §4.5's accessors — and dot-callable on it by Method Syntax §4.2's home-module rule — `Regex`, `Match`, and `Group` all live in `Regex.hex`, so `regex.find(text)` and `match.group(1)` both resolve there. Every function is `->` except the two whose replacement callback makes them conduits (§4.4).

### 4.1 Types

```
opaque record Regex = { source: String, groupCount: Int, names: Map(String, Int), program: Program }
opaque record Match = { subject: String, spans: Vector(Option((Int, Int))), names: Map(String, Int) }
export record Group derives (Eq, Show) = { start: Int, length: Int, text: String }
```

- **`Regex`** is a compiled pattern: a value, immutable, sharable, with no `Eq`, `Ord`, or `Hash` instance — two regexes are compared by `source`. It carries a **`Program`**, the confined type its door row declares (§7), and inside that the lazy-DFA cache the program owns; the record is `opaque` because a confined type may travel only inside an opaque carrier (Intrinsics §3.3), and it derives nothing for the same reason. `Show<Regex>` is honored by hand and shows the source.
- **`Match`** is one match against one subject: the subject, the spans of group 0 and every capturing group (start, length) or `None` where the group did not participate, and the name table. It is opaque so that group text is sliced on demand rather than materialised for every group of every match; the accessors of §4.5 are its face. No instances in v1.
- **`Group`** is a captured span with its text, transparent, the value every accessor answers with. `RegexError` is §2.9's, home `Regex.Syntax`: a program that only matches on it needs no second import, and one that *names* it in a signature writes `import Regex.Syntax` and `Syntax.RegexError` — the cost of one parser owning its error and Hexagon having no re-exports (Modules §12.2), taken with eyes open (§4.6).

### 4.2 Compilation

```
Regex.compile(pattern: String): Result(Regex, RegexError)
Regex.escape(text: String): String
Regex.source(regex: Regex): String
Regex.groupCount(regex: Regex): Int
Regex.groupIndex(regex: Regex, name: String): Option(Int)
```

- `compile` parses (§5) and constructs the program (§6.1). The one door: a literal pattern takes the same parser and the same constructor (§8). There is no second entry point with flags, options, or a size budget.
- `escape` answers `text` with a backslash before every codepoint that is a metacharacter in any position — `\ . + * ? ( ) | [ ] { } ^ $ # -` — and before every `White_Space` codepoint, so that the result is a literal under every flag including `x`. `compile(escape(t))` matches exactly the occurrences of `t` — `escape("")` is the empty pattern, matching at every boundary (§3.5) — and `Regex.escape` is the sanctioned way to embed untrusted text in a pattern.
- `groupCount` is the number of capturing groups, group 0 excluded. `groupIndex` answers the number of a named group, `None` for a name the pattern does not define.

### 4.3 Searching

```
Regex.isMatch(regex: Regex, text: String): Bool
Regex.find(regex: Regex, text: String): Option(Match)
Regex.findFrom(regex: Regex, text: String, start: Int): Option(Match)
Regex.findAll(regex: Regex, text: String): Seq(Match)
```

- `find` is the leftmost-first match (§3.2), or `None`. `isMatch` answers whether `find` would answer `Some`, asking the search row for no captures (§7) so that the engine runs no capture pass (§6.2).
- `findFrom` is `find` restricted to matches starting at position `start` or later. The whole text remains the subject — `^`, `\b`, and `$` see the codepoints before `start` — so `findFrom(re, "ab", 2)` with `^b` is `None` and with `\bb` is `None` too. A `start` below 1 acts as 1; a `start` past `length + 1` answers `None`.
- `findAll` is the lazy sequence of §3.5's enumeration: pure, re-derived on each traversal (Loops §6.4), `Seq.memoize`d by the caller who wants retention, and each element is produced by one search from the previous match's resumption point. Nothing is scanned until the first pull.

### 4.4 Replacement and splitting

```
Regex.replace(regex: Regex, text: String, replacement: String): String
Regex.replaceFirst(regex: Regex, text: String, replacement: String): String
Regex.replaceWith(regex: Regex, text: String, replacement: Match ->? String): String
Regex.replaceFirstWith(regex: Regex, text: String, replacement: Match ->? String): String
Regex.split(regex: Regex, text: String): Vector(String)
```

- `replace` and `replaceFirst` replace every match of §3.5's enumeration, or the first, with `replacement` **unchanged** — a literal, with no `$1`, `${name}`, or `\1` interpretation, the String companion's rule (`string-text-processing.md` §6). Unmatched text keeps its spelling; inserted text is never searched again; no match leaves the input unchanged.
- `replaceWith` and `replaceFirstWith` compute each replacement from its `Match` — group text, positions, the subject — which is the whole of what a token language would have said, in Hexagon. The callback is a linked `->?` conduit on the `Seq` consumers' precedent (Effects §2.2.1): pure in, pure and bare out; impure in, and the call wears `!`. The callback is invoked once per replaced match, in order, and never for a match it does not replace; an exception it throws propagates from the call, and no partial result escapes.
- `split` answers the pieces of `text` between the matches of §3.5's enumeration, preserving empty pieces at both ends and between adjacent matches, so that `String.join(regex.split(text).toSeq(), sep)` reconstructs `text` when every match spelled `sep`. On the empty pattern it agrees with `String.split(text, "")`; a pattern that matches nowhere answers `[text]`.

### 4.5 `Match` accessors

```
Regex.start(match: Match): Int
Regex.length(match: Match): Int
Regex.text(match: Match): String
Regex.group(match: Match, index: Int): Option(Group)
Regex.named(match: Match, name: String): Option(Group)
Regex.groups(match: Match): Vector(Option(Group))
```

- `start`, `length`, `text` are group 0's — the whole match. There is no `end`: the position after the match is `start + length`, and `findFrom(re, text, m.start() + m.length())` is not the enumeration (§3.5 skips an abutting empty match; `findAll` is).
- `group(m, 0)` is the whole match as a `Group`; `group(m, i)` for `1 ≤ i ≤ groupCount` is the group's capture, `None` where it did not participate; an index outside that range is `None`, never a fault. `named` is `group` through the name table; an undefined name is `None`.
- `groups` is groups 1 through `groupCount` in order — `[]` for a pattern with no capturing group — `Vector`-indexed from 1 like every vector, so `groups(m)[i]` and `group(m, i)` agree.

### 4.6 What the surface refuses

- **No token language in replacements** — `replaceWith` (§4.4). Recorded against re-litigation: `$1` syntaxes differ across every host, escape badly, and say less than a function.
- **No flags argument, no `compileWith`** — flags are inline (§2.6). One `compile`.
- **No host `RegExp` in or out** — nothing converts a `Regex` to a JavaScript `RegExp` or back; the dialects differ and the Unicode versions would too.
- **No `Eq`/`Hash` on `Regex`** — `source` is the identity that matters, and two compilations of one source are one regex for every purpose but reference identity.
- **No re-export of `RegexError`** — the type's home is the parser's module (§2.9, §4.1); a signature naming it imports `Regex.Syntax`. A copy in `Regex.hex` would be a second type, and re-exports are deferred corpus-wide (Modules §12.2).
- **No `matchAll`-into-`Vector`, no `count`** — `findAll` with `Vector.fromSeq` and `Seq.length` are one call away; a minimal surface is easier to grow than to shrink (`stdlib-roadmap.md` owns additions).

## 5. `Regex.Syntax` — the public syntax tree

`Regex.Syntax` (`stdlib/Regex/Syntax.hex`, `module Regex.Syntax`) is an ordinary pure module with **no door rows**: the parser, the tree, the name lists, and the class-set algebra over explicit ranges are all expressible Hexagon, and Unicode tables are the engine's (§7). Its tree is public API so that the compiler and the language server load one parser (§8, §10) and a program that wants to inspect a pattern can.

*Amendment for ratification (#927 Decision 4 assigned the Unicode-table keys and folding to `Regex.Syntax`).* The tree carries a property by **name** and a fold by a **flag**, and resolving either needs tables, so this document places the table keys and the resolution in the engine (§6.1, §7) and leaves `Regex.Syntax` door-free. What it costs: a language server that wants to know what `\p{Greek}` matches goes through the engine. What it buys: one parser with no lowering to load, and the tables in one place. The admitted **names** are a generated table in `Regex.Syntax`, regenerated from PropertyAliases.txt and PropertyValueAliases.txt with every Unicode update alongside the engine's range tables (`string-text-processing.md` §1): the names are the parser's, the ranges the engine's, and a version bump touches both or neither.

```
export union Node =
    | Empty
    | Literal(point: Int)
    | Any(newline: Bool)                     -- `.`; newline = True under `s`
    | Class(items: Vector(ClassItem), negated: Bool, folded: Bool)
    | Anchor(kind: AnchorKind)
    | Concat(parts: Vector(Node))
    | Alternate(branches: Vector(Node))
    | Repeat(body: Node, min: Int, max: Option(Int), greedy: Bool)
    | Capture(body: Node, index: Int, name: Option(String))

export union ClassItem =
    | Range(low: Int, high: Int)             -- inclusive, low ≤ high
    | Property(kind: PropertyKind, value: String, negated: Bool)

export union PropertyKind = GeneralCategory | Script | ScriptExtensions | Binary | Any | Ascii | Assigned
export union AnchorKind = TextStart | TextEnd | LineStart | LineEnd | WordBoundary | NotWordBoundary

export record Pattern = { root: Node, groupCount: Int, names: Map(String, Int) }
export record RegexError derives (Eq, Show) = { message: String, position: Int }

Syntax.parse(pattern: String): Result(Pattern, RegexError)
```

- **Flags are resolved in the tree.** `x` is consumed by the lexer; `m` selects `LineStart`/`LineEnd` over `TextStart`/`TextEnd` for `^`/`$`; `s` sets `Any`'s `newline`; `i` sets `folded` on a `Class` and turns a literal under it into a one-range `Class` with `folded = True`. No flag survives into a node, so the engine reads no flags.
- **Perl classes desugar**: `\d` is `Property(GeneralCategory, "Nd")`, `\s` is `Property(Binary, "White_Space")`, `\w` is the five items of §2.4's table, `Range(0x200C, 0x200D)` standing for Join_Control; `\D`, `\S`, `\W` are the same items in a `Class` with `negated = True`. Property values are stored under **one canonical spelling per value** whatever alias was written — General_Category under its short name (`Property(GeneralCategory, "Lu")` for `\p{Uppercase_Letter}`), Script and Script_Extensions under their long names (`Property(Script, "Greek")` for `\p{Grek}`), binary properties under their long names — so the engine's tables are keyed once. A bare `\P{…}` is `Class([Property(…, negated = False)], negated = True)`; `Property.negated` is set only for a complemented item written *inside* a class, `[\P{L}\d]`, so every construct has one tree.
- **Explicit ranges are normalized**: within a `Class`, `Range` items are sorted, disjoint, and merged. Property items are left by name; their sets, and the negation and folding of a class that holds one, are the engine's work (§6.1), because they need tables. A class with no property items is fully determined in the tree.
- **Captures carry their index** in §2.6's numbering (the constructor is `Capture`, not `Group`, so that `Regex.Group` — §4.1's record — is the only `Group` in the library); `Pattern.names` maps each name to its index. `Concat` and `Alternate` hold two or more parts; a one-part sequence is the part; an empty sequence is `Empty`.
- **Every limit of §2.5 is the parser's**: a `Pattern` the parser answers is one the engine constructs without refusal.

The tree carries no source spans in v1. The literal-diagnostics arc (§10) needs only `RegexError.position`, and adding spans to nodes then is an additive change to a public union.

## 6. The engine — `Hex.Runtime.Regex`

`Hex.Runtime.Regex` (`stdlib/Runtime/Regex.hex`, `module Runtime.Regex`) is a runtime module in `Hex.Runtime.HashTrie`'s sense (Packages §2.4): it exports nothing at the Hexagon level, its operations reach the program through `Regex.hex`'s sealed rows (§7), and it is written **`->!` throughout** over `Buffer` storage. What follows is its contract; the construction it names is the ruling's (§1), and the bounds are what the surface promises.

### 6.1 Program construction

`Regex.hex`'s `compileProgram` row (§7) answers a `Program`, and its lowering is this module's `compile(pattern: Syntax.Pattern) ->! Compiled` — `Compiled` an unexported record of this module over `Buffer` storage, and `Program` a name only `Regex.hex` writes. The two are one representation under the door, the linkage `Map`'s keys take over `HashTrie` (Intrinsics §3.4, §4.2). `compile`:

- **Class resolution.** Every `Class` becomes a set of codepoint ranges, in this order: each item's set is resolved — a property item through the property-table key (§7) by canonical name — and complemented where the item is `negated`; the union is taken; a `folded` class is closed under simple case folding through the fold key; a `negated` class is complemented over U+0000–U+10FFFF. Fold before complement is what makes `(?i)[^a]` not match `A`, as in RE2 and Rust. Resolution is per class, once, **on the program's first use**, memoised in the program (a transparent memo, §6.2) — so that the program construction itself reads no table, and a program emitted as a constant (§8) carries its properties by name and resolves them against the tables the emitted runtime module carries, the same tables `String.hex`'s rows read.
- **The alphabet.** The boundaries of every resolved class and literal partition the codepoint space into equivalence classes; the DFA reads a codepoint's equivalence class, not the codepoint. That is what makes a class over `\p{L}` cost the same as a class over `[a-z]` at scan time. The partition is built with the resolution, on first use.
- **The NFA.** One Thompson construction over the tree: literals and classes as consuming states, `Empty`, anchors and `\b`/`\B` as non-consuming states carrying their assertion, `Alternate` and `Repeat` as split states ordered by §3.2's priority, groups as capture-save states, counted repetitions expanded within §2.5's bounds. The program's size is linear in the expanded pattern, and the expansion is bounded by §2.5's product rule, so a program is at most a thousand instructions per pattern codepoint.
- **Totality.** The engine refuses nothing: a `Pattern` the parser answered always constructs (§5).
- **Imports.** This module imports `Regex.Syntax` for the `Pattern` it compiles — the first shipped runtime module with an import line. Modules §5.1 rule 2 read that no shipped runtime source holds one; the sentence is corrected in place to what it relied on, that none binds a boundary type's name (edit applied with this document).

### 6.2 The search

`Regex.hex`'s `searchProgram` row (§7) lowers to this module's `search(program: Compiled, text: String, start: Int, captures: Bool) ->! …`, which answers the leftmost-first match at or after the start position, as spans — every group's when `captures` is set, group 0's alone otherwise:

- **The lazy DFA** is built on demand from the NFA — a state is a *priority-ordered* set of NFA states, so that the forward scan finds the end of the leftmost-first match, not the longest (§3.2). The forward scan from the start position finds the match end; a reverse DFA over the reversed program, anchored at that end, finds the match start; where the program has no capturing groups, or the caller asked for no captures (`isMatch`, §4.3), the search ends there, no capture pass run.
- **The Pike VM** runs over the span the DFAs found to assign captures (§3.3) — the NFA simulation carrying one capture vector per thread — and it runs the whole search from the start position when the DFA cannot: whenever the DFA cache's budget is exhausted and flushed for the second time in one search, the VM finishes it. Every route answers the same match; the route is never observable.
- **The cache** is the program's owned memo (Effects §6.2 species (d)): every DFA state is a value function of the NFA state set it names, a hit and a miss are indistinguishable, and nothing in it records call history. It is bounded by a constant the engine fixes; exhaustion discards it and a later search rebuilds what it needs. Two more transparent memos are admitted on the same terms, three in all: the resolved classes and alphabet of §6.1, a value function of the program; and the code-unit offset of the last codepoint position answered for the last subject, so that resuming a search from a position does not re-walk the subject from its start (§6.4).
- **Assertions at a start position** read the subject before that position (§4.3): `\b` and `^` at `start` are decided by the codepoints on both sides.

### 6.3 Storage

Every mutable structure — DFA state tables, the alphabet map, the VM's thread lists and capture vectors, the search's position memo — is a `Buffer` (Intrinsics §3.3): allocated by the engine, addressable by nothing outside the modules the type's inventory entry names, written through `->!` rows, and never reachable from a `Regex` a program holds except through the two sealed rows. The program and cache a `Regex` carries are values to every Hexagon expression (Effects §6.2, §7); to foreign code holding an exported `Regex`, they are opaque representation, and mutating them is an FFI Part 1 §3.1 contract violation like any other.

### 6.4 Bounds

For a subject of `n` codepoints from the start position and a program of `m` NFA states:

| Operation | Bound |
|---|---|
| `compile` | linear in the expanded pattern; the first search of a program additionally pays each class's resolution once — a folded `\p{L}` costs its membership then and never again |
| `isMatch`, `find`, `findFrom` | `O(n)` on the DFA route, amortised over the cache, for a program with no capturing groups or a search asking no captures; `O(n + span · m)` with captures, the VM running over the span alone; `O(n · m)` on the VM route; never worse, whatever the pattern |
| `findAll` over a whole subject | linear in the subject plus the sum of match lengths, times `m` where the program captures — the position memo (§6.2) keeps each resumption from re-walking the subject |
| `Match` accessors | `start`, `length`: constant; `group`, `named`, `groups`, `text`: a `Group` carries its text (§4.1), sliced when the value is built — linear in the span, plus a walk to the span's start where the position memo does not hold that subject |
| `replace` family, `split` | one enumeration plus the output |

No pattern the parser accepts has super-linear behaviour in the subject: that is the RE2 path's whole purpose, and a subject that makes an accepted pattern slow is a conformance defect of the engine, not a hazard to document.

## 7. The door: rows and keys

Two of the arc's three modules declare through the door; the inventory (Intrinsics §4.1) gains the type key `regexProgram` beside the foundations' `buffer`, and four operation keys beside its four. `Regex.Syntax` declares nothing (§5).

**`Hex.Runtime.Regex`** — the storage, honest arrows (Intrinsics §3.3), and the two Unicode tables:

```hexagon
extern from "hex:intrinsic"
    type buffer as Buffer(a)
    fun bufferCreate as create(size: Int, fill: a) ->! Buffer(a)
    fun bufferRead as read(buffer: Buffer(a), index: Int) ->! a
    fun bufferWrite as write(buffer: Buffer(a), index: Int, value: a) ->! Unit
    fun bufferLength as length(buffer: Buffer(a)) -> Int
    fun regexPropertyRanges as propertyRanges(kind: Syntax.PropertyKind, value: String) -> Vector((Int, Int))
    fun regexFoldOrbit as foldOrbit(point: Int) -> Vector(Int)
```

- `Buffer` is zero-based, fill required, bounds unchecked under runtime discipline — the engine never reads or writes outside a buffer it sized, and that is a conformance obligation on the engine, not a check.
- `propertyRanges` answers a property's codepoints as sorted, disjoint, inclusive ranges, keyed by §5's `PropertyKind` and canonical value (the runtime module imports `Regex.Syntax` for the `Pattern` it compiles, so the kind is the tree's own); the tables are the compiler's Unicode 17.0.0 tables, the ones `String.hex`'s rows read, kept in one place and **referenced by name, never inlined** into an emitted program (§8). An unknown name is unreachable — the parser closed the set — and answers the empty vector rather than a fault.
- `foldOrbit` answers every codepoint whose simple case folding equals `point`'s, `point` included, ascending: the closure §3.4 needs. Both rows are `->` reads of fixed tables, the shape `stringIsWhitespace` already takes.

**`Regex.hex`** — the confined program type and the two sealed rows (Intrinsics §4.2, Effects §6.2 species (d)):

```hexagon
extern from "hex:intrinsic"
    type regexProgram as Program
    fun regexCompile as compileProgram(syntax: Syntax.Pattern) -> Program
    fun regexSearch as searchProgram(program: Program, text: String, start: Int, captures: Bool) -> Option(Vector(Option((Int, Int))))
```

- `regexProgram`'s inventory entry names **`Hex.Regex`** as its one declarer: a `Program` is constructed and inspected only by the two rows, travels only inside the opaque `Regex` (§4.1), and is the carrier through which a value over `Buffer` storage — a compiled program with its cache — reaches a program without the storage being addressable anywhere but the runtime module. The type has arity 0.
- `compileProgram` and `searchProgram` write `->`, and their lowerings are the runtime module's compiled `->!` bodies of §6.1 and §6.2: the linkage `Map`'s keys take over `Hex.Runtime.HashTrie`, with the colour crossing species (d) licenses. Each is a value function of its arguments — `compileProgram` because the program it answers denotes the same matcher for the same `Pattern`, its unfilled memos (§6.1) transparent on the terms of §6.2, so its discharge is the memo limb, not the scratch limb; `searchProgram` by the transparency of the three memos §6.2 names — and each takes no function-typed parameter, so nothing re-enters the engine mid-write. `searchProgram`'s answer is the spans: element 1 the whole match, element `i + 1` group `i`, each `(start, length)` or `None`; with `captures` clear the vector holds element 1 alone.
- These two are the only `->` faces over the engine. Every other row that touches a `Buffer` is `->!`, and no third sealed row is scheduled: `isMatch`, `findAll`, and the replacement family are ordinary Hexagon over `searchProgram`.

## 8. Literal patterns

A call `Regex.compile(p)` whose argument is a **string literal** is compiled as data: the compiler runs the emitted `Regex.Syntax` parser and the emitted `Hex.Runtime.Regex` constructor at compile time — the same code a dynamic `compile` runs, one door — and emits the resulting program as a constant in the module, its property classes referencing the runtime's tables by name (§7). The value the program observes is the same `Result(Regex, RegexError)` the dynamic call would produce: `Ok` of a `Regex` over the constant, or the same `Err`. No semantics ride on the emission; it is an evaluation the compiler is entitled to perform because `compile` is a value function of its argument (Effects §6.2, Intrinsics §4.2) and the argument is known, and it is why a module's patterns cost their parse once at build rather than once per load. A program emitted as a constant is the one value of a confined type not produced by a `fun` row at run time (Intrinsics §3.3): the compiler runs the row's own lowering at build and emits its result, the value that row would have answered, its memos (§6.1) unfilled in the constant and filled per load.

Reporting a literal pattern's `RegexError` as a compile-time diagnostic — turning the constant `Err` into a refusal at the call, with the message and position §2.9 fixes — is the literal-diagnostics arc (§10), a later landing over this mechanism. Until it lands, a literal that does not compile is an `Err` at runtime like any other.

## 9. Emission and the boundary

`Regex` and `Match` are opaque records and take FFI Part 7 §5's brand-only `.d.ts` face; `Group`, `RegexError`, and `Syntax`'s tree are transparent records and unions with the ordinary representation. A `Program` has no `.d.ts` face — it is inside an opaque record, and a confined type never has one (Intrinsics §3.3). A `Seq(Match)` crossing the boundary is FFI Part 3's. Marks and colours erase with the rest of the effects discipline (Effects §8); the runtime module's emitted JavaScript carries its operations out under an export list the emitter writes, as `HashTrie.js` does, and no Hexagon module can import it (Packages §2.4).

## 10. Later phases — not scheduled

Each below needs its own ruling; none is implied by this document.

- **Compile-time literal diagnostics**: §8's constant `Err` reported at the call. Needs only the mechanism §8 lands.
- **Typed captures**: a pattern whose groups are a record type in the program (the Swift `Regex` shape). Needs a literal syntax slot — a regex-literal form or a `pattern`-declaration door — which is a lexer and parser ruling, not a library one.
- **A regex-literal form** (no doubled backslashes): the same slot.
- **`\p{Emoji}`** and further properties: one ruling and one table each (§2.4).
- **`\p{…}` over grapheme clusters, or a grapheme unit**: rejected as the unit (§1); a later `String` grapheme surface, if one comes, is not this module's.
- **Leftmost-longest mode, `Stream`-driven subjects, streaming search**: no demand recorded.

## 11. Rejected alternatives (do not re-litigate without new information)

- **Wrapping the host `RegExp`**: §1 — the String spec forbids a host from deciding Unicode semantics; `\p` and `/i` are exactly that.
- **Derivative-based matching**: §1 — captures would be a second definition.
- **Backreferences and lookaround**: §2.8 — not linear; refused by name so the message says why.
- **Full case folding under `i`**: §3.4 — a second matching semantics; recorded with the divergence from `containsCi`.
- **Loose property-name matching (RL1.2a)**, **POSIX classes**, **the `\Z` anchor**, **CR/CRLF as `m`-mode line terminators**: §2.4, §2.7 — one spelling, one reading, one codepoint of lookahead.
- **A flags argument**, **a replacement-token language**, **`RegExp` conversion**, **`Eq`/`Hash` on `Regex`**: §4.6.
- **Grapheme clusters as the unit**: §1 — a class over clusters has no partition for a DFA to read.
- **A third sealed row (`findAll` in the engine)**: §7 — a `Seq` handed out by the engine would run `->!` code beneath a pure `pull` at every later step, a colour crossing at no sealed row; the enumeration is ordinary Hexagon over `searchProgram`, at the cost §6.4's position memo removes.
- **Python's empty-match rule**: §3.5.
- **Rust's `x` mode inside a class**: §2.6 — Perl's and Python's reading taken, so `[ ]` is a space class under every flag and a class reads the same with and without `x`.
- **`\x{…}` for the codepoint escape**: §2.3 — the lexer's `\u{…}` is the one form a Hexagon programmer already knows.

## 12. Precedents consulted

- [RE2 syntax](https://github.com/google/re2/wiki/Syntax) and [Go `regexp/syntax`](https://pkg.go.dev/regexp/syntax): the dialect, its refusals, the repetition bound, the empty-match rule, `$` without `m`.
- [Rust `regex` syntax](https://docs.rs/regex/latest/regex/#syntax): `x` mode, `\p{…}` spellings, `escape`, the `find_at` shape.
- [UTS #18 Unicode Regular Expressions](https://unicode.org/reports/tr18/): RL1.2's property set, RL1.5 simple folding, Annex C's `\d \s \w \b`.
- [Unicode PropertyAliases.txt and PropertyValueAliases.txt](https://www.unicode.org/Public/17.0.0/ucd/): the exact spellings admitted.
- Russ Cox, [Regular Expression Matching Can Be Simple And Fast](https://swtch.com/~rsc/regexp/regexp1.html), [the Virtual Machine Approach](https://swtch.com/~rsc/regexp/regexp2.html), [in the Wild](https://swtch.com/~rsc/regexp/regexp3.html): the construction — Thompson NFA, Pike VM, lazy DFA with a bounded cache, forward-then-reverse scan.
- [Swift `Regex`](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0350-regex-type-overview.md): typed captures, deferred (§10).

## 13. Decisions log

| Decision | Where |
|---|---|
| Own engine on the RE2 path; no host `RegExp`; codepoint unit; pure surface over a `->!` engine | §1 |
| Spans are 1-based codepoint positions and counts; empty matches at boundary positions; no code units anywhere | §3.1 |
| Lone surrogates: one codepoint, no properties, never rejected or replaced; Unicode 17.0.0 by recorded update | §3.6 |
| A pattern is a `String`; positions 1-based codepoints; no raw-string form in v1 | §2.1 |
| Grammar; metacharacters; `]`/`}` literal outside, `{` refused unless a counted repetition | §2.2, §2.5 |
| Escapes: Lexer §6.2's table plus the class/assertion escapes; `\` + non-alphanumeric is literal; `\x`, `\f`, `\v`, `\Q`, `\Z`, backreferences refused by name | §2.3 |
| Classes: no nesting, no POSIX; `[]` refused; Annex C Perl classes; RL1.2 properties, exact spelling, closed set; folding closes classes including property classes | §2.4 |
| Repetition bound 1000 per operator and per nested product; nesting depth 1000 | §2.5 |
| Groups numbered by `(`; both named spellings; ASCII names; flags inline only, `i m s x`, with `-` clearing | §2.6 |
| `\n` is the only line terminator; `$` never before a final newline; `\b` over `\w` | §2.7 |
| `RegexError` = `{message, position}`, home `Regex.Syntax`, one report per pattern; the message table | §2.9 |
| Leftmost-first only, priority order stated; captures = last entry, never reset | §3.2, §3.3 |
| `i` = simple folding; the one recorded divergence from `containsCi` | §3.4 |
| Empty-match iteration = RE2/Go's rule; `split` agrees with `String.split` on `""` | §3.5 |
| `Regex` opaque over `Program`, no `Eq`/`Hash`, `Show` = source; `Match` opaque with accessors; `Group` transparent | §4.1, §4.5 |
| Surface: `compile`, `escape`, `source`, `groupCount`, `groupIndex`, `isMatch`, `find`, `findFrom`, `findAll`, `replace`/`replaceFirst`/`replaceWith`/`replaceFirstWith`, `split` | §4.2–§4.4 |
| **Amendment for ratification** — replacement callbacks are `Match ->? String` conduits where Decision 7 wrote `Match -> String`: an effectful replacer is ordinary under `?` rather than a type error | §4.4 |
| Refusals: no token language, no flags argument, no `RegExp` conversion, no `Eq`/`Hash`, no re-export of `RegexError`, no `Vector`/`count` conveniences | §4.6 |
| `Regex.Syntax` door-free and pure; flags resolved in the tree; property values canonical; explicit ranges normalized; one tree per construct; no source spans in v1 | §5 |
| **Amendment for ratification** — the Unicode-table keys and the resolution they serve move from `Regex.Syntax` (Decision 4) to the engine; the parser keeps the names as a generated table | §5, §7 |
| Engine: class resolution on first use, fold before complement; alphabet partition; ordered lazy DFA forward then reverse; Pike VM for captures and fallback; three transparent memos; a runtime module with an import; bounds table | §6 |
| Door: `buffer` + four rows and the two table keys in the runtime; **`regexProgram` — a second confined type key beyond the foundations' `buffer`, declarer `Hex.Regex`, logged for ratification** — + two sealed rows in `Regex.hex`, the search row taking a captures mode; no third sealed row | §7 |
| Opaque brands for `Regex`/`Match`; transparent faces for `Group`, `RegexError`, the tree; no face for `Program` | §9 |
| Literal patterns compiled as data through the same parser and constructor; diagnostics a later arc | §8, §10 |
