# Hexagon Spec: `Regex`

**Status:** Decided (#927 — the eight rulings this document records; the foundations it stands on landed at #928). Shipped: `stdlib/Regex/Syntax.hex` (the parser and tree, §2, §5), `stdlib/Runtime/Regex.hex` (the engine, §6), and `stdlib/Regex.hex` (the surface, §4), with a literal handed to `compile` checked and built while the program is compiled, and one handed to `parse` compiled once per load (§8). This document is the contract of all three (`stdlib-roadmap.md` §5 records the row). Amended 2026-11-01 (#1414): §6.2's subject memo and cursor, and §6.4's `findFrom` bound: a `findFrom` start far from any cursor is located through Collections Part 3 §9. Amended 2026-11-03 (#1427): a pattern is compiled two ways — `compile`, for a pattern the programmer wrote, throws the fault `RegexCompileFault`, and `parse`, for text from outside the program, throws the tracked exception `RegexError` (§2.9, §4.2, §5, §8). Amended 2026-11-06 (#1468): a literal handed to `compile` is checked and built while the program is compiled, a bad one refused at the call and a good one emitted as a constant, by every host alike, while a literal handed to `parse` stays once per load; every refusal §2.9 lists names what to write, or the limitation it meets, and a report made while compiling spells it as a string literal does; possessive repetition, atomic groups, conditionals, recursion, the comment group `(?#`, and other engines' `\k`, `\g`, `\K`, `\G` and `\c` are refused by name; an unknown property takes the near-miss form; the name table of a `Regex` and a `Match` is a vector in group order (§2.3, §2.4, §2.5, §2.6, §2.8, §2.9, §4.1, §4.2, §4.5, §5, §6.1, §6.3, §6.4, §7, §8, §9, §10, §11, §12, §13). Amended 2026-11-08 (#1487): a refusal carries as data each rewrite its message names that writes the one reading the refused text has, `RegexError` and `RegexCompileFault` each gaining a third slot, `rewrites`, of `Syntax.Rewrite` values, each its words and its edits of the pattern; a report made while compiling carries each as a fix on the literal; a repetition repeated is written in a group that captures nothing, `(?:a*)+`, so that no later group's number moves; the `U` refusal names both directions a repetition takes under it (§2.5, §2.9, §4.2, §5, §8).
**Scope:** The pattern language (the dialect), matching semantics, the public surface of `Regex`, the public syntax tree of `Regex.Syntax`, the obligations on the engine `Hex.Runtime.Regex`, the door inventory the three modules declare, and literal patterns: their check and construction while the program is compiled, and their emission.
**Not in scope:** The intrinsic `type` form and the Hex-wide door (Intrinsics §3.3, §5.2 — assumed); species (d) itself (Effects §6.2 — assumed); the String companion's own text-processing surface (`string-text-processing.md`, whose currency this document adopts and whose one divergence it names); typed captures (§10, a later ruling).
**Companions:** `string-text-processing.md` (positions, the codepoint unit, Unicode version, full folding), `intrinsics.md` (§3.3 the `type` form, §4.2 sealed rows, §5.2 the gate), `effects.md` (§6.2 species (d), §7 the sequence posture), Loops §6 (`Seq`), Modules §4.2 (`opaque`), Method Syntax §4 (the dot), `stdlib-roadmap.md`.

---

## 1. Doctrine

**`Regex` is a standard-library module outside the prelude — `import Regex` — with its own engine, written in Hexagon, on the RE2 path.** It does not wrap the host's `RegExp`. The String spec pins every Unicode-sensitive answer to the compiler's Unicode 17.0.0 tables and forbids a host operation from deciding public semantics (`string-text-processing.md` §1); a host `\p{…}` or `/i` would decide exactly that, with whichever Unicode version the host happens to carry. The engine therefore answers every property and folding question from the same tables `String.hex` reads, and a program's matches are the same on every host beneath unchanged compiler bits.

Four commitments, each a ruling of #927, shape everything below:

- **The unit is the codepoint** — the String spec's currency (§3.1). `.` and a class consume one codepoint; a span is a 1-based codepoint position and a codepoint count; a lone surrogate is one codepoint with no properties. Grapheme clusters are not the unit and no flag makes them one.
- **The dialect is RE2's, restricted** (§2): no backreferences, no lookaround, leftmost-first matching only. Every pattern the parser accepts matches in time linear in the subject (§6.4); there is no pattern whose ambiguity a subject can turn against the program.
- **The engine is one construction** (§6): one Thompson NFA, a lazy DFA for the scan and a Pike VM for captures and as the always-linear fallback. Derivative-based matching was rejected because captures would then be a second semantic definition of the pattern beside the one the DFA implements.
- **The surface is pure and the engine is not** (§7): the engine is written `->~` wherever it touches a buffer's contents, and purity is claimed once, at two sealed `->` rows whose lowerings are its compiled bodies — Effects §6.2's species (d), owned scratch, with the lazy-DFA cache and the resolved classes (§6.2) the two owned memos a compiled `Regex` carries. A `Regex` is a value: comparing, sharing, hoisting, and dropping a search are the compiler's to do as with any pure call.

The surface is small by design (§4): `compile` for a pattern the programmer wrote and `parse` for one that arrives as data, flags inline in the pattern, a lazy `Seq(Match)` where there are many matches, and a `Match ->! String` function where a replacement needs the match — no replacement-token language.

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
              | '(?<' name '>' alternation ')' | '(?P<' name '>' alternation ')'
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

`literal` is any codepoint that is not a metacharacter at its position; `punct` is any codepoint that is not an ASCII letter or digit (§2.3); `hex` is a hexadecimal digit, one to six of them (§2.3); `property` is §2.4's `\p`/`\P` forms. The grammar reads a stream from which `x`-mode scanning (§2.6) has already removed ignored whitespace and comments; that scanning is driven by the parser's current flag state — it takes effect immediately after the `)` of a `(?x)` setting or at the `:` of a `(?x:…)` group and ends where the flag's scope ends — so it is a mode of the parser, not a pass before it. A counted repetition and a `\u{…}` escape are read whole: `a{1, 3}` and `\u{6 1}` are refused under `x` as under any flag (§2.5, §2.9). An anchor and a flag setting are not atoms: a quantifier after one (`^*`, `\b+`, `(?i)*`) is refused as having nothing to repeat (§2.5).

An empty pattern, an empty branch of an alternation (`a|`), and an empty group (`()`) are legal and match the empty string. Precedence is the grammar's: a quantifier binds tighter than concatenation, concatenation tighter than `|`, and a group overrides.

The metacharacters — the codepoints that do not stand for themselves outside a class — are `\ . + * ? ( ) | [ { ^ $`. `]` and `}` outside their constructs are literals; `{` is not (§2.5). Every other codepoint is a literal matching itself. Under `x` (§2.6), `#` and every `White_Space` codepoint join them outside a class. Inside a class the metacharacters are `\ ] [ ^ -` (§2.4) — `^` only first, `-` except first, last, or escaped, so `[-a]`, `[a-]`, and `[a^b]` read the hyphen and the caret as literals.

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

Refused by name, with a message that says what the dialect has instead (§2.9): `\1`…`\9` (a backreference), `\x` (write `\u{…}`), `\f`/`\v`/`\a`/`\e`/`\0` (write `\u{…}`), `\Q`…`\E` (use `Regex.escape`), `\R` and `\h` (no linebreak or horizontal-space atom: write the alternation or class meant, such as `\r?\n` or `[\t\p{Zs}]`), `\X` and `\C` (no grapheme or byte atom: the dialect matches codepoints, §3.1, and nothing in it spells a grapheme or a byte), `\Z` (write `\z`; the dialect has no before-final-newline anchor), and other engines' escapes, each by its meaning there: `\k` (a named backreference), `\g` (a backreference, or recursion), `\K` (capture the part to keep in a group), `\G` (search with `findFrom` and check where the match starts), and `\c` (write `\u{…}`).

### 2.4 Classes

**Bracket classes.** `[…]` matches one codepoint in the set; `[^…]` one codepoint not in it. Inside the brackets:

- a single codepoint or an escape (§2.3) is a member; `a-z` is the inclusive range by codepoint value, and a range whose low end exceeds its high end is refused; a range's ends are single codepoints, so `[\d-z]` and `[a-z-0]` are refused at the `-` — write `\-` for a literal hyphen beside a class escape or a range;
- `-` is literal first, last, or escaped; anywhere else it is a range;
- `^` negates only as the first codepoint; elsewhere it is literal;
- `]` closes the class wherever it appears, so a literal `]` is written `\]`, and an empty class (`[]`, `[^]`) is refused rather than read as a class beginning with `]`;
- `[` inside a class is refused unless escaped — there are no nested classes and no POSIX classes, and `[[:alpha:]]` is refused at its inner `[` with `\p{Alphabetic}` named as the spelling (§2.9); this is one of the dialect's refusals of something RE2 accepts (§2.8 collects them), taken to keep `[[:alpha:]]` from reading silently as a class followed by a literal;
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
| `\p{Any}`, `\p{ASCII}`, `\p{Assigned}` | every codepoint; U+0000–U+007F; every codepoint whose General_Category is not `Cn`, surrogates excluded (§7) |

The names are Unicode's canonical long names and Unicode's own aliases: every alias PropertyAliases.txt gives an admitted *property* (`WSpace`, `White_Space`, and `space` all name White_Space), only the short and long value names — the second and third fields — of PropertyValueAliases.txt for a *value* (so `\p{digit}`, `\p{punct}`, and `\p{cntrl}`, its later fields, are out), and `Any`, `ASCII`, `Assigned` as UTS #18 spells them — matched **exactly** — case, underscores, and spacing as Unicode writes them. There is no loose matching (RL1.2a is not adopted): `\p{lu}`, `\p{uppercase letter}`, and `\p{Greek_}` are refused, each naming the canonical spelling. A name that is no admitted spelling, even loosely, is an unknown name, and its refusal offers the nearest admitted spelling where one is near (§2.9). A bare name is looked up in one order — as a General_Category value, then a Script value, then one of the binary properties and `Any`/`ASCII`/`Assigned` of the table above; the three name spaces are disjoint over the admitted set, so the order settles determinism rather than a contest. `=` and `:` are both accepted between a property name and its value. `\P{…}` is the complement of `\p{…}`; the `\p{^Greek}` spelling is refused. The set is **closed**: no other property, no property of strings, no `=Yes`/`=No` form on the binary properties. A property joins by ruling and by table together — `\p{Emoji}` is the likely first request — never by a name the parser happens to accept.

A **lone surrogate** has no properties (§3.6): every `\p{…}` naming a property excludes it — `\p{Any}` alone includes it, being the whole codepoint space rather than a property — and every `\P{…}` naming a property, every negated class, and `.` include it (`\P{Any}` is empty). Since a well-formed pair is decoded to one scalar and a lone surrogate has no category, no codepoint the engine sees is a surrogate by category: `\p{Cs}` is admitted — the ruling admits General_Category verbatim — and matches nothing, `\P{Cs}` matches everything, and `\p{C}` reaches its other members.

### 2.5 Repetition

`x*`, `x+`, `x?`, `x{n}`, `x{n,}`, and `x{n,m}` are greedy; the same with a trailing `?` are lazy — preferring fewer iterations (§3.2). There are no possessive quantifiers and no atomic groups, and both are refused by name (§2.8, §2.9). Bounds: `0 ≤ n ≤ m ≤ 1000` — RE2's per-operator limit — and, this dialect's own and tighter than RE2's program-size budget, across nested counted repetitions the product of the maxima (`n` standing for `{n,}`, unbounded operators counting 1) is at most 1000, which bounds the expanded program at a thousand times the pattern's length. A count or a product past its bound is refused, and the longer run is written as a sequence, which pays for itself in the pattern's length: `x{1000}x{500}` for `x{1500}`, and the outer repetition of a nest repeated in sequence. A capturing group so written keeps its number when the earlier runs are written `(?:…)`, and its last capture too wherever the last run cannot be empty: `(?:ab){1000}(ab){500}` for `(ab){1500}`.

A quantifier must follow an atom: `*a`, `|*`, `(*)`, a quantifier on an assertion or a flag setting (`^*`, `\b+`, `(?i)?`), and a quantifier on a quantifier (`a**`, `a+?*`) are refused — write `(?:a*)*` if that is meant, a group that captures nothing, so that no later group's number moves. `+` directly after a greedy quantifier (`a*+`, `a{3}+`) is possessive repetition in other engines, and its refusal says so before it names `(?:a*)+`. `{` that does not begin a well-formed counted repetition (`a{`, `a{,3}`, `a{x}`) is refused, never read as a literal brace; the literal is `\{`. That is the Scala-refusal rule of this corpus at the pattern's scale: one committed reading or a refusal that names the boundary.

Nesting of groups is bounded at depth 1000, refused at the opening beyond; a quantifier nests only through a group, so the bound holds the tree's depth too. A flag setting `(?i)` opens no group and does not count.

### 2.6 Groups, names, and flags

`(…)` is a **capturing group**, numbered by the position of its `(` among capturing groups, from 1; group 0 is the whole match. `(?:…)` groups without capturing. `(?<name>…)` captures under a name as well as a number and is the canonical spelling; `(?P<name>…)`, RE2's other spelling, is accepted and means the same. A name is `[A-Za-z_][A-Za-z0-9_]*`, refused otherwise, and a name used twice in one pattern is refused.

**Flags are inline only.** `(?flags)` sets flags for the rest of the enclosing group (or the pattern) — to its closing `)`, across `|`, so that in `a(?i)b|c` the `c` is folded, as in RE2 and Rust; `(?flags:…)` sets them for the group's body alone. `flags` is a sequence of the letters below, optionally followed by `-` and letters to clear, each letter at most once across both sides (`(?i-i)` is refused) — `(?i)`, `(?-i)`, `(?i-s:…)`. `(?)`, `(?-)` and `(?i-)` are refused. There is no flags argument to `compile` (§4.2) and no other flag: `U` (RE2's ungreedy) is refused by name, with a lazy repetition named as the spelling, and `-U` as nothing to clear, naming what to drop, or the `(?:` to write for `(?-U:`.

| Flag | Effect |
|---|---|
| `i` | case-insensitive matching by simple case folding (§3.4) |
| `m` | multi-line: `^` and `$` match at line boundaries as well as text boundaries (§2.7) |
| `s` | `.` matches `\n` too (§2.7) |
| `x` | extended: outside a class, White_Space is ignored and `#` begins a comment that runs to the next `\n` or the end of the pattern; inside a class both are literal (Perl's and Python's `/x`, not Rust's, which strips inside a class too — §11); the `x` scanner (§2.2) honours the backslash, so an escaped `White_Space` codepoint is kept and `\#` begins no comment, and `\ ` is a literal space anywhere |

Lookaround — `(?=`, `(?!`, `(?<=`, `(?<!` — and the named backreference `(?P=name)` are refused by name (§2.9). `(?<` followed by `=` or `!` is lookbehind and refused; otherwise it opens a named group. The atomic group `(?>`, the conditional `(?(`, and the recursion forms `(?R`, `(?` followed by a digit or by `+` or `-` and a digit, `(?&` and `(?P>` are refused by name too (§2.8), and so is the comment group `(?#`, with dropping it, or the `x` flag's `#` comment ended by a newline, named as the spelling. Any other `(?` prefix is refused.

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

- **Backreferences** (`\1`, `(?P=name)`, and other engines' `\k<name>` and `\g1`): matching with backreferences is NP-hard in general, and no linear-time engine implements them. Refused by name, so the message names the fact rather than an unknown escape.
- **Lookaround**: expressible on a linear engine only in restricted forms, and each form is a second matching semantics beside leftmost-first. Refused by name.
- **Possessive quantifiers, atomic groups, conditionals**: backtracking-engine devices; the engine has no backtracking to cut. Refused by name (§2.5, §2.6), so a message never steers one toward a construct that means something else.
- **Recursion** (`(?R)`, `(?1)`, `(?-1)`, `(?+1)`, `(?&name)`, `(?P>name)`, and other engines' `\g<name>`): it matches what no finite automaton can, such as balanced nesting. Refused by name (§2.3, §2.6), so a message never steers one toward a construct that means something else.
- **POSIX classes** (`[[:alpha:]]`): ASCII-only by definition in RE2, which this dialect's Unicode posture cannot carry; `\p{…}` says the same thing in Unicode. Refused rather than misread (§2.4).
- **Loose property-name matching**: refused (§2.4) — one spelling per property, so a misspelling is an error, never a loose match that silently matches something.
- **A flags argument, a global-match flag, a leftmost-longest (POSIX) mode**: the surface has one pair, `compile` and `parse`, and one matching semantics (§3.2); `findAll` is the global form.
- **Readings RE2 gives that this dialect refuses rather than misreads**, collected: a bare `{` and `a{,3}` (literal text in RE2); `[` inside a class; a range ending in a class escape or a range (`[\d-z]`, `[a-z-0]`); `\p{^Greek}`; `\x41` and `\x{…}` (write `\u{…}`); `\Q…\E`; `\C`; `\a`, `\f`, `\v`; the `U` flag; a quantifier on an assertion. Each is refused where it is met (§2.3–§2.6) with the spelling the dialect has.

### 2.9 `RegexError`

A pattern the parser refuses is reported by one exception, thrown by `Regex.parse` (§4.2) and by `Syntax.parse` (§5):

```
export exception RegexError(
    message: String,             -- one sentence, naming the defect and the spelling the dialect has instead
    position: Int,               -- 1-based codepoint position in the pattern; length + 1 when the pattern ended early
    rewrites: Vector(Rewrite)    -- each spelling the message names that keeps the text's one reading, as data
)

export record Rewrite = { title: String, edits: Vector(Edit) }
export record Edit = { start: Int, end: Int, text: String }
```

A bad pattern that arrives as data is an expected failure, one the caller should plan for, so `RegexError` is an exception and is tracked (Exceptions §1): every call of `parse` is marked, and the programmer reads it as `Int.parse` is read — passed on with `^`, as an `Option` with `?`, kept with `attempt`, declared impossible with `assume`, or caught by name for its slots:

```
let checked(text: String): String =
    try
        Regex.parse^(text).source()
    catch
        Syntax.RegexError(message, position, _) => "bad at ${position}: ${message}"
        e => "${e}"
```

Its home is `Regex.Syntax` (§5), where the parser lives, so an arm that names it writes `import Regex.Syntax` and `Syntax.RegexError(…)`; a catch-all needs no import, and shows it as ``RegexError: missing `)` for the group opened here`` (Exceptions §8.6), the message without the position. A pattern the programmer wrote is not data, and `compile` reports one that is wrong with a fault carrying the same three slots, its message also naming the position (§4.2). The message family, position rule per row:

| Defect | Position | Message |
|---|---|---|
| `(` without `)` | the first `(` left open | missing `)` for the group opened here; close it, or write `\(` for a literal |
| `)` without `(` | the `)` | unmatched `)`; write `\)` for a literal |
| `[` without `]` | the `[` | missing `]` for the class opened here; close it, or write `\[` for a literal |
| `[]`, `[^]` | the `[` | empty class; write `\]` for a literal `]` |
| `[` inside a class | the inner `[` | `[` inside a class must be written `\[` — and, when followed by `:`: POSIX classes are not part of the dialect; write `\p{Alphabetic}` |
| name without `>` | the `<` | group name is not closed; write `(?<year>…)` |
| reversed range | the range's high end | range `z-a` is reversed; write `a-z` (a `^` brought to the front written `\^`, so the class cannot open negated, and a `-` written `\-`, so it cannot read as a range's hyphen; where an end is a lone surrogate, which has no spelling, swap its ends) |
| range end not a single codepoint | the `-` | a range's ends are single codepoints; write `\-` for a literal hyphen |
| assertion in a class | the escape | `\B` is an assertion, not a codepoint; a class cannot hold it, so write it outside the class — and, for `\b`, which other engines read as backspace in a class: or `\u{8}` for a backspace |
| quantifier without an atom | the quantifier | nothing to repeat before `*?` — and, after an assertion or a flag setting: `^` is an assertion, not an atom — and last: write `\*\?` for a literal `*?` |
| quantifier on a quantifier | the second | `**` repeats a repetition; write `(?:a*)*` — and, for `+` after a greedy quantifier: `*+` is possessive repetition, which the dialect does not have; to repeat a repetition, write `(?:a*)+` |
| `{` not a counted repetition | the `{` | `{` must begin a counted repetition `{n}`, `{n,}`, or `{n,m}`; write `\{` for a literal |
| count past the bound | the `{` | repetition count exceeds 1000; write a longer run as a sequence, such as `x{1000}x{500}` for `x{1500}` |
| nested counts past the bound | the outermost `{` | nested repetition counts multiply past 1000; write the outer repetition as a sequence, such as `(?:x{100}){10}(?:x{100}){10}` for `(?:x{100}){20}` |
| reversed counted repetition | the `{` | `{3,1}` has a minimum above its maximum; write `{1,3}` |
| nesting past the bound | the opening | nesting deeper than 1000 |
| trailing `\` | length + 1 | pattern ends inside an escape; write `\\` for a literal backslash |
| unknown escape | the `\` | `\q` is not an escape; write `q`, or see the escape table |
| refused escape | the `\` | one sentence per §2.3's refused list: `\1` is a backreference, which the dialect does not have; `\x` is not an escape, write `\u{…}`; `\h` is not an escape, the dialect has no horizontal-space atom, write the class meant, such as `[\t\p{Zs}]`; `\k` is a named backreference, which the dialect does not have; `\K` resets where the match starts, …, capture the part to keep in a group, and read the group; … |
| bad `\u{…}` | the `\` | `\u{…}` takes one to six hexadecimal digits up to 10FFFF, not a surrogate |
| unknown property | the `\` | `\p{Foo}` names no supported property — and, for a loose spelling of a supported one, the canonical spelling: write `\p{Lu}` — and otherwise, for a near miss: did you mean `\p{Cyrillic}`? |
| bad `\p` form | the `\` | `\p` takes one letter or a braced name; `\p{^Greek}` is not a spelling, write `\P{Greek}` |
| bad group prefix | the `?` | `(?=` is lookahead, which the dialect does not have; `(?<=` is lookbehind, …; `(?P=` is a backreference, …; `(?>` is an atomic group, …; `(?#` begins a comment in other engines, …, drop it, or under the `x` flag write the comment after `#`, ending it with a newline; `(?(` is a conditional, …; `(?R`, `(?1`, `(?-1`, `(?&`, `(?P>` are recursion, …; `(?` must be followed by `:`, `P<`, `<`, or flags |
| bad flags | the offending letter, else the `)` or `:` | one sentence per defect: `q` is not a flag; the flags are `i`, `m`, `s`, `x`. `U` is not a flag; the dialect has no ungreedy mode, so write each repetition as `U` reads it: a greedy one lazy, such as `*?`, and a lazy one greedy — or, after `-`: so there is nothing to clear: drop the `-U` (or the `U`, or the whole `(?-U)`, or write `(?:` for `(?-U:`, whichever fits what is written). `i` is set twice; write it once. Nothing follows `-`; name a flag to clear, or drop the `-`. `(?)` sets no flag; drop it, and `(?-)` the same |
| bad name | the name | group name must match `[A-Za-z_][A-Za-z0-9_]*` |
| duplicate name | the second name | group `year` is already defined; give this group another name |

**Every message names what to write instead**, or the fix for the defect it names, with two kinds of exception. **An unknown property is an unknown name**, refused as every unknown name in Hexagon is (Pattern Matching §12): the message offers the admitted spelling nearest the one written where it is within a third of its own length, at least one edit, an adjacent transposition counting as one, the compiler's own near-miss rule, ties going to the spelling that sorts first, and a near property name offered only with a value that property has; a one-codepoint name has no near miss, and where nothing is near, the sentence stands alone. A property Unicode defines outside the closed set (`\p{Emoji}`) takes the same row: whether it joins is the open question §10 records, one ruling and one table each. **A construct with no rewrite inside the dialect names the limitation it meets**, and no rewrite: a construct §2.8 refuses to keep matching linear-time and leftmost-first — a backreference (`\1`, `\k<name>`, `\g1`, `(?P=name)`), which no linear-time engine matches in general; lookaround, which a linear engine has only in restricted forms, each a second matching semantics; possessive repetition, an atomic group and a conditional, §2.8's backtracking-engine devices; and recursion, which matches what no finite automaton can, such as balanced nesting — whose rewrite elsewhere is an engine §1 rejects (possessive repetition's message also names the spelling of its other reading, a repetition repeated); a grapheme or byte atom, `\X` or `\C` (§2.3), where the dialect matches codepoints (§3.1); and nesting past §2.5's depth, which no local rewrite removes without changing what the groups capture. They are named limitations in Declarations Preamble §1.1's sense, and the Rewrite Rule reaches them because a literal handed to `compile` is refused with these messages when the program is compiled (§8). The same messages serve `RegexError` and `RegexCompileFault` at run time, where the spellings they quote are the pattern's own; a report made while compiling quotes them as a string literal spells them (§8).

**A rewrite that keeps the pattern's reading is also data.** `rewrites` holds each spelling the message names that writes, in one fixed edit of the pattern, the one reading the refused text has (below), in the message's order. A `Rewrite` is its `title`, the words the message uses for it with what it writes named (`write the run as a sequence`, ``drop the second `i` ``), and its `edits`, in the pattern's order and apart, each starting after the one before it ends. An `Edit` replaces the codepoints from `start` up to, not including, `end` with `text`; both are positions as `position` is, 1-based codepoints, `length + 1` the end of the pattern, and an insertion has `start` equal to `end`. Applying every edit of one rewrite writes the pattern its words name. The parser builds each rewrite where it words it, so the words and the edits are one decision: a program that reads patterns from its users can offer the same correction the compiler offers on a literal (§8).

**A rewrite is carried where the refused text has one reading,** defined by the dialect or by Unicode, and the edit writes that reading in a form the dialect accepts; that is what makes it a fix and not a guess at what the programmer meant (Declarations Preamble §1.1). The rows that carry one: a count past its bound, which the dialect reads as that many repetitions and refuses for its limit, written as a sequence of at most 100 pieces, its atoms 10,000 codepoints at most in all, the sequence keeping every count inside the bound, the product of the counts nested in the atom included, so that `(?:a{10}){1500}` is written as runs of `{100}`; what a flag setting writes to no effect, dropped: a letter set twice on one side of the `-`, a `-` with nothing after it, and `(?)` and `(?-)`; a comment group, which reads as nothing, dropped, or, under `x`, written after `#` and ended with a newline unless its text holds a newline; a loose spelling of a property, which Unicode's loose matching (UAX44-LM3) makes the same name, written canonically, and `\P{Greek}` for `\p{^Greek}`; and a repetition repeated, which the message reads as one, written in `(?:…)`. A row that names two such spellings carries two rewrites, in the message's order.

`rewrites` is empty everywhere else. It is so where the refused text has no reading, so that a spelling would pick the one it supposes the programmer meant, though the message still names it: a missing `)` or `]`, which may close anywhere or be meant as a literal; an unmatched `)`; a `{` that begins no count; a hyphen or a `[` a class cannot hold; `[\b]`; a trailing `\`; a quantifier with nothing to repeat; a reversed range or counted repetition; an empty class; a comment group with no `)`; and another engine's construct to which the dialect gives no reading: an unknown escape, `\Z`, the `U` flag set or cleared, and a letter both set and cleared. It is so where the message names a form and leaves the spelling to the programmer: another name for a duplicate group, a closed name for `(?<year>`, the flag meant for an unknown letter, the digits of `\u{…}` for a bad one or for another engine's code escape (`\x41`, `\f`, `\cA`), the class or alternation meant for `\h` or `\R`, the property meant for a POSIX class, which `\p{Alphabetic}` names by example, and where an assertion a class holds is written instead. It is so where the message names a limitation, the second kind of exception above, and where it offers a near miss. And it is so in six cases where the spelling the words show would not keep the text's reading, or would be no single step to it: a count past its bound on an atom that holds a capturing group, whose runs would write the group twice and renumber every later one; a count whose optional part would need two runs, which a sequence reads in another priority order; a count past its bound whose ends are reversed too; a count whose sequence would take more than 100 pieces, or more than 10,000 codepoints of atom, which a rewrite does not write out; a setting or a comment group with a quantifier after it, whose drop would hand the quantifier to the piece before; and a possessive repetition, which never gives back what it took, where the group the words show around it would.

One report per pattern, at the first defect in reading order; the parser does not recover and go on. A lone surrogate a message quotes is written as its code, `U+D800`, since it is no character to show. Three routings the table cannot carry: a well-formed `{3}` with nothing before it takes the nothing-to-repeat row, not the `{` row; `[[:` takes the `[`-inside-a-class row with its POSIX clause, never the missing-`]` row; and `(?)` takes the bad-flags row, not the bad-prefix row.

## 3. Matching semantics

### 3.1 Unit and positions

The subject is read as a sequence of codepoints — a well-formed surrogate pair is one codepoint, a lone surrogate is one codepoint — and every span is a **1-based codepoint start position** and a **codepoint count**. `"😀hello"` matched by `hello` has start 2 and length 5, exactly as `String.indexOf` answers `Some(2)` (`string-text-processing.md` §8). An empty match has length 0 at a boundary position: before the first codepoint at 1, after the last at `length + 1`. No code unit reaches the public surface: not a span, not a position argument, not a `RegexError`. The one code-unit offset outside the engine is the second component of the search row's resumption cursor (§6.2, §7), inside `Regex.hex`, written by the surface only as `(1, 0)` and otherwise carried back to the row uninterpreted.

### 3.2 Leftmost-first

Of every way the pattern can match the subject, the match is the one whose start is **leftmost**; among matches with that start, the one **first in priority order**. Priority order is the backtracking order Perl, RE2, Rust, and JavaScript share, stated without a backtracker:

- in `x|y`, every match through `x` precedes every match through `y`;
- in a greedy repetition, more iterations precede fewer; in a lazy one, fewer precede more;
- in `xy`, the priority of `x` decides first, and `y` decides among matches that agree on `x`;
- a repetition whose body can match the empty string reads as RE2 and Go compile it: `x*` as `(?:x+)?`, entered at most once without consuming (Go issue 46123). So `(|a)*` on `aa` matches the empty string, as `(?:|a){0,5}` does, and `(a*)*` on `b` captures the empty string in group 1. Perl agrees on the whole match and parts from RE2 on some captures under such a repetition — `(a|)*` on `aa` captures `a` here and the empty string in Perl — and where they part, this dialect answers as RE2.

So `a|ab` on `ab` matches `a`; `a*?` on `aaa` matches the empty string at 1; `(a+)(a*)` on `aaa` captures `aaa` and the empty string. This is the only matching mode: there is no leftmost-longest (POSIX) mode, and the DFA's states are ordered so that the scan finds the leftmost-first match's end, not the longest's (§6.2).

### 3.3 Captures

A capturing group's capture is the span of the group's **last entry on the chosen path**; a group the chosen path never enters has no capture, and its `Group` is `None` (§4.5). Nothing resets a capture — in `(?:(a)|b)*` on `ab` group 1 captures `a`, the second iteration having not entered it — which is what a Pike VM computes and what RE2 and Perl answer; JavaScript, alone among §3.2's engines, resets a group on each iteration of an enclosing quantifier, and this dialect does not. Group 0 is the whole match and always present.

### 3.4 Case-insensitivity is simple case folding

Under `i` (§2.6) two codepoints match when their **simple case foldings** are equal — Unicode's `CaseFolding.txt` statuses C and S, UTS #18 RL1.5 — and every literal and class is closed under that relation once, before any codepoint is matched — at the program's first use, §6.1 — never per codepoint at match time: `(?i)k` matches `k`, `K`, and U+212A KELVIN SIGN; `(?i)[a-z]` matches `a`–`z`, `A`–`Z`, U+212A, and U+017F LATIN SMALL LETTER LONG S (whose simple fold is `s`), and nothing else; `(?i)ß` matches `ß` and U+1E9E and not `ss`. The unit stays one codepoint, which is what lets a class be a set of codepoints and the DFA's alphabet a partition of them.

**This is the one divergence between this module and the String companion's `Ci` family**, and it is recorded here and in `string-text-processing.md` §5: `containsCi` uses *full* folding — `"Straße".containsCi("STRASSE")` is `True` — while `(?i)strasse` does not match `Straße`. Full folding changes codepoint length, and a match that may begin or end inside a fold's expansion is a second matching semantics that an RE2 engine does not carry; the ruling accepts the divergence with regret and declines to research past it. A program that needs full-fold matching folds both sides with `String.caseFold` first and matches the folded text, accepting that positions then index the folded text.

### 3.5 Empty matches and iteration

A pattern may match the empty string, and `findAll` (§4.3) enumerates successive non-overlapping matches from left to right under one rule, RE2's and Go's: **after a match ending at `e` (its start plus its length) the search resumes at `e`; an empty match whose start equals the previous match's end is discarded; after any empty match, yielded or discarded, the search resumes one codepoint past it**. So `a*` on `baaab` yields the empty match at 1, `aaa` at 2, and the empty match at 6 — not an empty match at 5 abutting `aaa` — and `""` on `abc` yields four empty matches, at 1, 2, 3, and 4. `Regex.split` (§4.4) is defined over that enumeration and therefore agrees with `String.split` on the empty pattern: both give `["", "a", "b", "c", ""]`. Python's rule, which admits the abutting empty match, is not adopted.

### 3.6 Lone surrogates and the Unicode version

A lone surrogate reaching the engine through a JavaScript string is one codepoint with no properties (§2.4) that matches itself literally, matches `.` and every negated class, and is neither `\w` nor `\s`. In the subject it is never rejected and never replaced with U+FFFD. In a pattern it can arrive only from JavaScript, since `\u{D800}` is refused there as Lexer §6.2 refuses it, and there it is one codepoint too, a literal matching itself; but its value is a reading `String.toCodepoint` deliberately does not give (`string-text-processing.md` §1), so the parser reads it through a door row of its own (§5). The Unicode version is the repository's, 17.0.0, adopted by a recorded compatibility update together with every table (`string-text-processing.md` §1); no host setting reaches the engine.

## 4. The surface — `Regex.hex`

Signatures below are the normative qualified API, not declaration syntax. Every function whose first parameter is a `Regex` or a `Match` is dot-callable on it by Method Syntax §4.2's home-module rule — `Regex`, `Match`, and `Group` all live in `Regex.hex`, so `regex.find(text)` and `match.group(1)` both resolve there; `compile`, `parse` and `escape` take a `String` first and are written qualified, `Regex.compile(p)`. Inside `Regex.hex` the opaque records' fields are visible, so the fused `r.source()`, `r.groupCount()`, and `m.groups()` are Method Syntax §6's field/method collisions against the same-spelled exports — the module writes its bare calls internally; abroad no field is visible and no collision arises. `Regex.hex` imports `Regex.Syntax` under its default alias `Syntax`, and the blocks below write `Syntax.RegexError` as a consumer must (§4.1). Every function is `->` except `parse`, which is `->^` (§4.2), and the two whose replacement callback makes them conduits (§4.4).

### 4.1 Types

```
opaque record Regex = { source: String, groupCount: Int, names: Vector((String, Int)), program: Program }
opaque record Match = { whole: Group, groups: Vector(Option(Group)), names: Vector((String, Int)) }
export record Group derives (Eq, Show) = { start: Int, length: Int, text: String }
```

- **`Regex`** is a compiled pattern: a value, immutable, sharable, with no `Eq`, `Ord`, or `Hash` instance — two regexes are compared by `source`. It carries a **`Program`**, the confined type its door row declares (§7), and inside that the two memos the program owns, the lazy-DFA cache and the resolved classes (§6.2); the record is `opaque` because a confined type may travel only inside an opaque carrier (Intrinsics §3.3), and it derives nothing for the same reason. `Show<Regex>` is honored by hand and shows the source. Its **name table** is `Pattern.names`'s entries (§5) in group order, each name with its number. It is a vector, not a `Map`, so that a `Regex` the compiler builds can be written into the emitted program (§8): a `Map`'s layout depends on a placement seeded per process (Collections Part 2 §2.4), so a map built while compiling would have to be hashed again, name by name, when the program loads, where a vector is rebuilt by appending its entries in order and needs no hash. A pattern names few groups, and `groupIndex` and `named` read the table from the start.
- **`Match`** is one match against one subject: group 0 as `whole`, every capturing group as a `Group` — its span and its text — or `None` where it did not participate, and the name table. The texts are cut by the engine, which holds the subject's code-unit offsets while it has them (§6.2, §7), so no accessor ever walks the subject, and the surface builds the record once from the row's answer (§7). The cost, accepted: every group's text is cut and retained for every match, read or not — `g` strings per `Match` for a pattern with `g` groups — and a `replace` with a literal replacement pays it too; §10 names the growth path if it bites. The record is opaque so that its face is the accessors of §4.5 and its layout is the library's to change. No instances in v1.
- **`Group`** is a captured span with its text, transparent, the value every accessor answers with. `RegexError` is §2.9's exception, home `Regex.Syntax`: a program that catches it with `_` or `e` needs no second import, and one that *names* it in a catch arm writes `import Regex.Syntax` and `Syntax.RegexError` — the cost of one parser owning its error and Hexagon having no re-exports (Modules §12, question 2), taken with eyes open (§4.6).

### 4.2 Compilation

```
export fault RegexCompileFault(message: String, position: Int, rewrites: Vector(Syntax.Rewrite))

Regex.compile(pattern: String): Regex        -- String -> Regex; a bad pattern throws the fault RegexCompileFault
Regex.parse(pattern: String): Regex          -- String ->^ Regex; a bad pattern throws the exception Syntax.RegexError
Regex.escape(text: String): String
Regex.source(regex: Regex): String
Regex.groupCount(regex: Regex): Int
Regex.groupIndex(regex: Regex, name: String): Option(Int)
```

- **Two functions, one parse and one construction.** Each parses (§5) and constructs the program (§6.1); they differ only in what a bad pattern is. The one door: a literal pattern takes the same parser and the same constructor (§8). There is no further entry point with flags, options, or a size budget.
- **`compile` is for a pattern the programmer wrote**, and takes no mark. A pattern that does not parse is the programmer's mistake, as an index out of range is, so `compile` throws the fault `RegexCompileFault`, exported by `Regex.hex` beside it. Its `position` and `rewrites` are §2.9's, and its `message` is §2.9's followed by ` (position: <n>)`, so that an uncaught one says where: ``RegexCompileFault: missing `)` for the group opened here (position: 2)``. Nothing tracks it; a program catches it by name or with `fault e` (Exceptions §5.2). A programmer who hands `compile` text from outside the program is vouching for it.
  ```
  let yearMonth: Regex = Regex.compile("^([0-9]{4})-([0-9]{2})$")
  ```
  The two are Collections Part 1 §3.3's second pair, beside `[]` and `get`: a function whose failure is the programmer's mistake, so a fault that takes no mark, and a sibling that gives the caller the choice. A literal handed to `compile` is run while the program is compiled (§8): a bad one is refused at the call with §2.9's message, a good one is emitted already built, and the programmer's code is the same either way.
- **`parse` is for a pattern that arrives as data** — typed by a program's user, read from a file — and is read like `Int.parse` (`numeric-parsing.md`): one tracked function, `->^`, whose caller chooses at the call how to read its `RegexError` (§2.9). `Regex.parse?(text)` is the "is it a pattern?" question, an `Option(Regex)`. A literal handed to `parse` is not checked while compiling: its failure is the caller's to read, when the call runs (§8).
- `escape` answers `text` with a backslash before every codepoint that is a metacharacter in any position — `\ . + * ? ( ) | [ ] { } ^ $ # -` — and before every `White_Space` codepoint, so that the result is a literal under every flag including `x`. `compile(escape(t))` matches exactly the occurrences of `t` — `escape("")` is the empty pattern, matching at every boundary (§3.5) — and `Regex.escape` is the sanctioned way to embed untrusted text in a pattern.
- `groupCount` is the number of capturing groups, group 0 excluded. `groupIndex` answers the number of a named group, `None` for a name the pattern does not define.

### 4.3 Searching

```
Regex.isMatch(regex: Regex, text: String): Bool
Regex.find(regex: Regex, text: String): Option(Match)
Regex.findFrom(regex: Regex, text: String, start: Int): Option(Match)
Regex.findAll(regex: Regex, text: String): Seq(Match)
```

- `find` is the leftmost-first match (§3.2), or `None`. `isMatch` answers whether `find` would answer `Some`, asking the search row for no spans (§7) so that the engine runs the forward scan alone (§6.2).
- `findFrom` is `find` restricted to matches starting at position `start` or later. The whole text remains the subject — `^`, `\b`, and `$` see the codepoints before `start` — so `findFrom(re, "ab", 2)` with `^b` is `None` and with `\bb` is `None` too. A `start` below 1 acts as 1; a `start` past `length + 1` answers `None`.
- `findAll` is the lazy sequence of §3.5's enumeration: pure, re-derived on each traversal (Loops §6.4), `Seq.memoize`d by the caller who wants retention, and each element is produced by one search from §3.5's resumption position — two where §3.5 discards an abutting empty match — with the cursor the previous search answered (§7) carried beside it in the sequence's state — the two differ by one after an empty match — so that no resumption re-walks the subject. Nothing is scanned until the first pull.

### 4.4 Replacement and splitting

```
Regex.replace(regex: Regex, text: String, replacement: String): String
Regex.replaceFirst(regex: Regex, text: String, replacement: String): String
Regex.replaceWith(regex: Regex, text: String, replacement: Match ->! String): String
Regex.replaceFirstWith(regex: Regex, text: String, replacement: Match ->! String): String
Regex.split(regex: Regex, text: String): Vector(String)
```

- `replace` and `replaceFirst` replace every match of §3.5's enumeration, or the first, with `replacement` **unchanged** — a literal, with no `$1`, `${name}`, or `\1` interpretation, the String companion's rule (`string-text-processing.md` §6). Unmatched text keeps its spelling; inserted text is never searched again; no match leaves the input unchanged.
- `replaceWith` and `replaceFirstWith` compute each replacement from its `Match` — group text, positions, the subject — which is the whole of what a token language would have said, in Hexagon. The callback is a `->!` callback on the `Seq` consumers' precedent, with a colour of its own on each colour (Effects §2.4): a replacer that is pure and cannot fail leaves the call bare, and any other makes the call wear the mark its colours call for (Effects §3.1). This amends Decision 7, which wrote the parameter `Match -> String`: the callback makes an effectful replacer ordinary under its mark where the pure arrow would make it a type error (§13). The callback is invoked once per replaced match, in order, and never for a match it does not replace; an exception it throws propagates from the call, and no partial result escapes.
- `split` answers the pieces of `text` between the matches of §3.5's enumeration — assembled in one pass over the subject, as are the unmatched runs of the `replace` family (§6.4) —, preserving empty pieces at both ends and between adjacent matches, so that `String.join(regex.split(text).toSeq(), sep)` reconstructs `text` when every match spelled `sep`. On the empty pattern it agrees with `String.split(text, "")`; a pattern that matches nowhere answers `[text]`.

### 4.5 `Match` accessors

```
Regex.start(match: Match): Int
Regex.length(match: Match): Int
Regex.text(match: Match): String
Regex.group(match: Match, index: Int): Option(Group)
Regex.named(match: Match, name: String): Option(Group)
Regex.groups(match: Match): Vector(Option(Group))
```

- `start`, `length`, `text` are group 0's — the whole match. There is no `end`: the position after the match is `start + length`, and `findFrom(re, text, m.start() + m.length())` is not the enumeration (§3.5 skips an abutting empty match; `findAll` is the enumeration).
- `group(m, 0)` is the whole match as a `Group`; `group(m, i)` for `1 ≤ i ≤ groupCount` is the group's capture, `None` where it did not participate; an index outside that range is `None`, never a fault. `named` is `group` through the name table; an undefined name is `None`.
- `groups` is the record's `groups` field: groups 1 through `groupCount` in order — `[]` for a pattern with no capturing group — `Vector`-indexed from 1 like every vector, so for `1 ≤ i ≤ groupCount` `groups(m)[i]` and `group(m, i)` agree; outside that range they part on purpose — `group` is total, 0 answering the whole match and anything else `None`, while the bracket throws `IndexFault` like any vector's and `Vector.get` is the total sibling. No accessor walks the subject (§6.4): `start`, `length`, `text`, and `group(m, 0)` are field reads of `whole`; `group(m, i)` and `groups` are one vector read; `named` reads the name table, which holds one entry per named group, and then that read.

### 4.6 What the surface refuses

- **No token language in replacements** — `replaceWith` (§4.4). Recorded against re-litigation: `$1` syntaxes differ across every host, escape badly, and say less than a function.
- **No flags argument, no `compileWith`** — flags are inline (§2.6). One `compile`, one `parse`.
- **No host `RegExp` in or out** — nothing converts a `Regex` to a JavaScript `RegExp` or back; the dialects differ and the Unicode versions would too.
- **No `Eq`/`Hash` on `Regex`** — `source` is the identity that matters, and two compilations of one source are one regex for every purpose but reference identity.
- **No re-export of `RegexError`** — the exception's home is the parser's module (§2.9, §4.1); an arm naming it imports `Regex.Syntax`. A copy in `Regex.hex` would be a second exception, and re-exports are deferred corpus-wide (Modules §12, question 2).
- **No `Result`-returning compile, and no `try`-prefixed one** — the reading gives the `Option` (`parse?`), `attempt` gives the `Result`, and the `try` prefix is not a stdlib spelling (Collections Part 1 §3.3).
- **No `matchAll`-into-`Vector`, no `count`** — `findAll` with `Vector.fromSeq` and `Seq.length` are one call away; a minimal surface is easier to grow than to shrink (`stdlib-roadmap.md` owns additions).

## 5. `Regex.Syntax` — the public syntax tree

`Regex.Syntax` (`stdlib/Regex/Syntax.hex`, `module Regex.Syntax`) is an ordinary pure module with **one door row**: the parser, the tree, the name lists, and the class-set algebra over explicit ranges are all expressible Hexagon, and Unicode tables are the engine's (§7). The row reads a codepoint's value, a lone surrogate's included (§3.6), which `String.toCodepoint` deliberately does not answer: a `->` read of a value under `String.hex`'s own key, `stringCodepointUnchecked`. Its tree is public API so that the compiler and the language server load one parser (§8) and a program that wants to inspect a pattern can.

*Decision 4 assigned the Unicode-table keys and folding to `Regex.Syntax`; this document amends it.* The tree carries a property by **name** and a fold by a **flag**, and resolving either needs tables, so this document places the table keys and the resolution in the engine (§6.1, §7) and leaves `Regex.Syntax` free of table keys. It resolves a tension inside the rulings rather than departing from Decision 4 alone: Ruling 3 already keeps the Unicode tables in the runtime, referenced by name. What it costs: a language server that wants to know what `\p{Greek}` matches goes through the engine. What it buys: one parser with no lowering to load, and the tables in one place. The admitted **names** are a generated table in `Regex.Syntax`, regenerated from PropertyAliases.txt and PropertyValueAliases.txt with every Unicode update alongside the engine's range tables (`string-text-processing.md` §1): the names are the parser's, the ranges the engine's, and a version bump touches both or neither.

```
export union Expr =
    | Empty
    | Literal(point: Int)
    | Dot(newline: Bool)                     -- `.`; newline = True under `s`
    | Class(items: Vector(ClassItem), negated: Bool, folded: Bool)
    | Anchor(kind: AnchorKind)
    | Concat(parts: Vector(Expr))
    | Alternate(branches: Vector(Expr))
    | Repeat(body: Expr, min: Int, max: Option(Int), greedy: Bool)
    | Capture(body: Expr, index: Int, name: Option(String))

export union ClassItem =
    | Range(low: Int, high: Int)             -- inclusive, low ≤ high
    | Property(kind: PropertyKind, value: String, negated: Bool)

export union PropertyKind = GeneralCategory | Script | ScriptExtensions | Binary | Any | Ascii | Assigned | Word
export union AnchorKind = TextStart | TextEnd | LineStart | LineEnd | WordBoundary | NotWordBoundary

export record Pattern = { root: Expr, groupCount: Int, names: Map(String, Int) }
export record Edit = { start: Int, end: Int, text: String }
export record Rewrite = { title: String, edits: Vector(Edit) }
export exception RegexError(message: String, position: Int, rewrites: Vector(Rewrite))
```

```
Syntax.parse(pattern: String): Pattern       -- String ->^ Pattern
```

The eight declarations and `parse` — a qualified-API signature in §4's sense, not declaration syntax — are the module's whole exported surface. The tree is `Expr`, not `Node`: `Node` is the spelling of the compiler-owned boundary type that answers bare in a runtime-privileged module (Modules §5.5, Intrinsics §3.3), and `Hex.Runtime.Regex` is one and imports this module (§6.1) — the one module that would see both. `Dot` rather than `Any`, since `PropertyKind` has an `Any` and two unions of one module may not share a constructor (Unions §2). `Property.value` is the canonical value spelling for `GeneralCategory`, `Script`, `ScriptExtensions`, and `Binary`, and `""` for `Any`, `Ascii`, `Assigned`, and `Word`, which the engine's table answers by kind alone (§7). `Word` is §2.4's `\w` and has no `\p{…}` spelling: `\p{Word}` names no supported property.

- **Flags are resolved in the tree.** `x` is consumed by the scanner the parser drives (§2.2); `m` selects `LineStart`/`LineEnd` over `TextStart`/`TextEnd` for `^`/`$`; `s` sets `Dot`'s `newline`; `i` sets `folded` on a `Class` and turns a literal under it into a one-range `Class` with `folded = True`. No flag survives into a node, so the engine reads no flags.
- **Perl classes desugar**: `\d` is `Class([Property(GeneralCategory, "Nd", negated = False)], negated = False, folded = …)` — `folded` per the `i` flag in scope at the construct —, `\s` likewise over `Property(Binary, "White_Space")`, `\w` over `Property(Word, "")`, the one item that stands for §2.4's whole set, so that its complement is an item too; `\D`, `\S`, `\W` are the same item in a `Class` with `negated = True`; inside a written class each contributes its item, with `negated` set on the item for `\D`, `\S`, `\W` — so `[\W\d]` is `Class([Property(Word, "", negated = True), Property(GeneralCategory, "Nd", negated = False)], negated = False, folded = …)`. A non-capturing group `(?:…)` has no node of its own: it is its body. Property values are stored under **one canonical spelling per value** whatever alias was written — General_Category under its short name (`Property(GeneralCategory, "Lu")` for `\p{Uppercase_Letter}`), Script and Script_Extensions under their long names (`Property(Script, "Greek")` for `\p{Grek}`), binary properties under their long names — so the engine's tables are keyed once. A bare `\P{…}` is `Class([Property(…, negated = False)], negated = True, folded = …)`; `Property.negated` is set only for a complemented item written *inside* a class, `[\P{L}\d]`, so every construct has one tree.
- **Explicit ranges are normalized**: within a `Class`, `Range` items are sorted, disjoint, and merged, and precede the property items, which keep written order. Property items are left by name; their sets, and the negation and folding of a class that holds one, are the engine's work (§6.1), because they need tables. The tree fixes a class's written ranges and its `negated`/`folded` flags; item complement, union, folding, and class complement are the engine's for every class, because folding needs the fold key and the complement's range is the engine's (§6.1).
- **Captures carry their index** in §2.6's numbering (the constructor is `Capture`, not `Group`, so that `Regex.Group` — §4.1's record — is the only `Group` in the library); `Pattern.names` maps each name to its index. `Concat` and `Alternate` hold two or more parts; a one-part sequence is the part; an empty sequence is `Empty`.
- **Every limit of §2.5 is the parser's**: a `Pattern` the parser answers is one the engine constructs without refusal.

The tree carries no source spans in v1. The compile-time check of a literal (§8) needs only the error's `position`, and adding spans to nodes later is an additive change to a public union.

## 6. The engine — `Hex.Runtime.Regex`

`Hex.Runtime.Regex` (`stdlib/Runtime/Regex.hex`, `module Runtime.Regex`) is a runtime module in `Hex.Runtime.HashTrie`'s sense (Packages §2.4): it exports nothing at the Hexagon level, its operations reach the program through `Regex.hex`'s sealed rows (§7), and it is written **`->~` wherever it touches a buffer's contents**, impure and unable to fail — `bufferLength`, the two table rows, and the three subject reads are `->` reads of values, Intrinsics §3.3. What follows is its contract; the construction it names is the ruling's (§1), and the bounds are what the surface promises.

### 6.1 Program construction

`Regex.hex`'s `compileProgram` row (§7) answers a `Program`, and its lowering is this module's `compile(pattern: Syntax.Pattern) ->~ Compiled` — `Compiled` an unexported record of this module over `Buffer` storage, and `Program` a name only `Regex.hex` writes. The two are one representation under the door, the linkage `Map`'s keys take over `HashTrie` (Intrinsics §3.4, §4.2). `compile` builds the NFA (the third bullet); class resolution and the alphabet (the first two) are deferred to the program's first use and memoised in it (§6.2):

- **Class resolution.** Every `Class` becomes a set of codepoint ranges, in this order: each item's set is resolved — a property item through the property-table key (§7) by canonical name — and complemented over U+0000–U+10FFFF where the item is `negated`; the union is taken; a `folded` class is closed under simple case folding through the fold key; a `negated` class is complemented over U+0000–U+10FFFF. Fold before complement is what makes `(?i)[^a]` not match `A`, as in RE2 and Rust. Resolution is per class, once, **on the program's first use**, memoised in the program (a transparent memo, §6.2) — so that the program construction itself reads no table, and a program built while the program is compiled (§8) carries its properties by name and resolves them against the tables the emitted runtime module carries.
- **The alphabet.** The boundaries of every resolved class and literal partition the codepoint space into equivalence classes; the DFA reads a codepoint's equivalence class, not the codepoint. That is what makes a class over `\p{L}` cost the same as a class over `[a-z]` at scan time. The partition is built with the resolution, on first use.
- **The NFA.** One Thompson construction over the tree: literals and classes as consuming states, `Empty`, anchors and `\b`/`\B` as non-consuming states carrying their assertion, `Alternate` and `Repeat` as split states ordered by §3.2's priority, groups as capture-save states, counted repetitions expanded within §2.5's bounds. The program's size is linear in the expanded pattern, and the expansion is bounded by §2.5's product rule, so a program is at most a thousand instructions per pattern codepoint.
- **Totality.** The engine refuses nothing: a `Pattern` the parser answered always constructs (§5).
- **Imports.** This module imports `Regex.Syntax` for the `Pattern` it compiles — the first shipped runtime module with an import line. Modules §5.1 rule 2 read that no shipped runtime source holds one; the sentence is corrected in place to what it relied on, that none binds a boundary type's name (edit applied with this document).

### 6.2 The search

`Regex.hex`'s `searchProgram` row (§7) lowers to this module's `search(program: Compiled, text: String, start: Int, cursor: (Int, Int), spans: Bool) ->~ Option((Vector(Option((Int, Int, String))), (Int, Int)))` — the row's result type of §7, with `Compiled` for `Program` —, which answers the leftmost-first match at or after the start position — every group's span and text when `spans` is set, and with it clear only whether there is one — together with a resumption cursor:

- **The lazy DFA** is built on demand from the NFA — a state is a *priority-ordered* set of NFA states, so that the forward scan finds the end of the leftmost-first match, not the longest (§3.2). The forward scan from the start position finds the match end; a reverse DFA over the reversed program, anchored at that end, finds the match start; where the program has no capturing groups the search ends there, no capture pass run; and with `spans` clear (`isMatch`, §4.3) the search ends at the forward scan's first match end, neither the reverse scan nor the VM run — RE2's existence test. The texts the row answers are cut here, from the code-unit offsets the scan has in hand, so a `Match` carries them and never walks the subject (§4.1).
- **The Pike VM** runs over the span the DFAs found to assign captures (§3.3) — the NFA simulation carrying one capture vector per thread — and it runs the whole search from the start position when the DFA cannot: whenever the DFA cache's budget is exhausted and flushed for the second time in one search, the VM finishes it. Every route answers the same match; the route is never observable.
- **The cache** is the program's owned memo (Effects §6.2 species (d)): every DFA state is a value function of the NFA state set it names, a hit and a miss are indistinguishable, and nothing in it records call history. It is bounded by a constant the engine fixes; exhaustion discards it and a later search rebuilds what it needs. One more transparent memo is admitted on the same terms, two in all: the resolved classes and alphabet of §6.1, a value function of the program. The engine keeps no memo of the subject of its own: a memo keyed on the last subject would pin that string for the life of the `Regex`, and a literal pattern's `Regex` lives as long as its module (§8). The enumerations need none, since they carry a cursor (below). Only a `start` far from any cursor, which `findFrom` alone can ask for, is read through brackets on the subject, and Collections Part 3 §9's memo then keeps that subject reachable as it keeps any bracketed string: until brackets on other long subjects in the engine's module displace it (§9), and for the life of that module if none do. That is the price of addressing a codepoint position, the one a bracket pays (§9).
- **The cursor.** Locating codepoint position `start` in a JavaScript string is a walk from the string's start, `O(start)`, which would make an enumeration of `k` matches quadratic. The row therefore takes and answers a **cursor** — a `(position, code-unit offset)` pair — and walks to `start` from the cursor where the cursor's position is at or before `start` and at most 64 codepoints before it, as it always is in an enumeration. Otherwise, where `start` is above 1 and position `start - 1` exists, the row reads `start`'s offset as the code-unit length of `text[1..start - 1]`, through Collections Part 3 §9's positions and at the costs §9 states; where `start` is above 1 and that position does not exist, `start` is past `length + 1` and the row answers no match; and a `start` at or below 1 is searched from position 1. With `spans` set the cursor answered is for the whole match's end position, and with it clear the row echoes the cursor it was given (§7); the surface carries it, unread, in the enumeration's state and hands it back with the next `start` (§4.3), so a traversal walks the subject once. **The row is specified only where `cursor` is `(1, 0)` or a cursor this row answered for this same `text`.** Over that domain the answer does not depend on which such cursor is passed — the cursor shortens the walk to `start` and decides nothing else — so the row is a value function of `(program, text, start, spans)` and the cursor is a hint; `(1, 0)` is valid for every subject, which is what lets `find`, `findFrom`, and `isMatch` pass it whatever `start` the caller chose. Passing any other cursor is a conformance violation of `Regex.hex`, as a buffer index out of range is one of the engine's (§7): never checked, and never reachable from outside `Regex.hex`, the row being unexported. No amendment rides on this: whatever cursor is passed the row is deterministic in its five arguments, so species (d)'s value-function obligation holds of the row as declared; the precondition governs only whether the surface's answer is the match §3.2 defines.
- **Assertions at a start position** read the subject before that position (§4.3): `\b` and `^` at `start` are decided by the codepoints on both sides.

### 6.3 Storage

Every mutable structure — DFA state tables, the alphabet map, the VM's thread lists and capture vectors — is a `Buffer` (Intrinsics §3.3): allocated by the engine, or, for a program a literal call's constant carries, by the emitted module as it loads (§7, §8), addressable by nothing outside the modules the type's inventory entry names, written through `->~` rows (a copy's filling as the emitted module loads excepted, which no row performs), and never reachable from a `Regex` a program holds except through the two sealed rows. The program and cache a `Regex` carries are values to every Hexagon expression (Effects §6.2, §7); to foreign code holding an exported `Regex`, they are opaque representation, and mutating them is an FFI Part 1 §3.1 contract violation like any other.

### 6.4 Bounds

For a subject of `n` codepoints from the start position and a program of `m` NFA states:

| Operation | Bound |
|---|---|
| `compile`, `parse` | linear in the expanded pattern; the first search of a program additionally pays each class's resolution once — a folded `\p{L}` costs its membership then and never again |
| `isMatch`, `find`, `findFrom` | `O(n)` on the DFA route, amortised over the cache, for `isMatch` or a program with no capturing groups; `O(n + span · m)` with capturing groups, the VM running over the span alone; `O(n · m)` on the VM route; never worse, whatever the pattern; plus the texts cut for `find` and `findFrom` (§4.1), and for `findFrom` locating `start`: a walk of at most 64 codepoints near the subject's beginning, and otherwise one scan of the subject on its first read and amortised O(1) on a subject read again, at the costs Collections Part 3 §9 states |
| `findAll` over a whole subject | linear in the subject, plus the sum of the match lengths (each times `m` where the program has capturing groups), plus the texts cut — the cursor (§6.2) keeps each resumption from re-walking the subject, so the subject is walked once per traversal |
| `Match` accessors | field reads of `whole`, one vector read for a group, and for `named` a read of the name table, linear in the pattern's named groups; none walks the subject, the texts having been cut (§4.1) |
| `replace` family, `split` | one enumeration plus the output — the unmatched runs assembled in one pass over the subject's codepoints (`String.toSeq`, cut at the match boundaries, joined once), never by per-match slicing, which would re-walk the subject from its start at every match |

No pattern the parser accepts has super-linear behaviour in the subject: that is the RE2 path's whole purpose, and a subject that makes an accepted pattern slow is a conformance defect of the engine, not a hazard to document.

## 7. The door: rows and keys

All three of the arc's modules declare through the door; the inventory (Intrinsics §4.1) gains the type key `regexProgram` beside the foundations' `buffer`, and seven operation keys beside its four. `Regex.Syntax` declares no key of its own: its one row, the codepoint read of §5, is `stringCodepointUnchecked`'s (§3.6).

**`Hex.Runtime.Regex`** — the storage, honest arrows (Intrinsics §3.3), and the two Unicode tables:

```hexagon
extern from "hex:intrinsic"
    type buffer as Buffer(a)
    fun bufferCreate as create(size: Int, fill: a) ->~ Buffer(a)
    fun bufferRead as read(buffer: Buffer(a), index: Int) ->~ a
    fun bufferWrite as write(buffer: Buffer(a), index: Int, value: a) ->~ Unit
    fun bufferLength as length(buffer: Buffer(a)) -> Int
    fun regexPropertyRanges as propertyRanges(kind: Syntax.PropertyKind, value: String) -> Vector((Int, Int))   -- surrogates excluded
    fun regexFoldOrbit as foldOrbit(point: Int) -> Vector(Int)
    fun regexCodepointAt as codepointAt(text: String, offset: Int) -> Int
    fun regexCodeUnits as codeUnits(text: String) -> Int
    fun regexCut as cut(text: String, from: Int, to: Int) -> String
```

- `Buffer` is zero-based, fill required, bounds unchecked under runtime discipline — the engine never reads or writes outside a buffer it sized, and that is a conformance obligation on the engine, not a check.
- `propertyRanges` answers a property's codepoints as sorted, disjoint, inclusive ranges, keyed by §5's `PropertyKind` and canonical value (the runtime module imports `Regex.Syntax` for the `Pattern` it compiles, so the kind is the tree's own); the tables are the compiler's Unicode 17.0.0 tables, generated from the same pinned Unicode data as those `String.hex`'s rows read, kept in the runtime module's emitted helpers and **referenced by name, never inlined** into an emitted program (§8). **Every property's ranges exclude U+D800–U+DFFF** — the table carves the surrogate block out of `C`, `Cs`, `Assigned`, and every other property, so that no `\p{…}` naming a property matches a lone surrogate (§2.4, §3.6) — and `Any` alone answers U+0000–U+10FFFF whole. `Word` answers §2.4's union, Alphabetic, `M`, `Nd`, `Pc`, and Join_Control, from the same tables. An unknown name is unreachable — the parser closed the set — and answers the empty vector rather than a fault.
- `foldOrbit` answers every codepoint whose simple case folding equals `point`'s, `point` included, ascending: the closure §3.4 needs. Both rows are `->` reads of fixed tables, the shape `stringIsWhitespace` already takes.
- `codepointAt`, `codeUnits`, and `cut` read the subject by code unit: the codepoint whose first code unit is at a zero-based offset (a well-formed pair one codepoint, a lone surrogate itself, §3.6), the length in code units, and the text between two offsets. They are what lets the search walk to `start` once, scan forward, and cut each group's text from the offsets the scan has in hand (§6.2, §6.4) — readings the public `String` surface deliberately does not offer, which reads by codepoint position and gives a lone surrogate no value. Each is a `->` read of a value, the shape `stringCodepointUnchecked` already takes; like every row of this block, none is reachable outside the runtime module.

**`Regex.hex`** — the confined program type and the two sealed rows (Intrinsics §4.2, Effects §6.2 species (d)):

```hexagon
extern from "hex:intrinsic"
    type regexProgram as Program
    fun regexCompile as compileProgram(syntax: Syntax.Pattern) -> Program
    fun regexSearch as searchProgram(program: Program, text: String, start: Int, cursor: (Int, Int), spans: Bool) -> Option((Vector(Option((Int, Int, String))), (Int, Int)))
```

- `regexProgram`'s inventory entry names **`Hex.Regex`** as its one declarer: a `Program` is constructed only by `compileProgram`, or by an emitted module's load as a copy of a program `compileProgram` built (§8), is inspected by no row but `searchProgram` (the compiler reads one only to copy it, §8), travels only inside the opaque `Regex` (§4.1), and is the carrier through which a value over `Buffer` storage — a compiled program with its cache — reaches a program without the storage being addressable anywhere but the runtime module. The type has arity 0. The foundations declared one confined type key, `buffer`; this is a second, and it meets Intrinsics §3.3's **confinement bar** (#930): never addressable outside its declarer, with no constructor, pattern, or derived instance — what `Map` and `Vector` cannot have and `Program` has. That the engine keeps its `Compiled` record (§6.1) behind it settles nothing, as `HashTrie` behind `Map` settles nothing: no module names it, no row exposes it.
- `compileProgram` and `searchProgram` write `->`, and their lowerings are the runtime module's compiled `->~` bodies of §6.1 and §6.2: the linkage `Map`'s keys take over `Hex.Runtime.HashTrie`, with the colour crossing species (d) licenses. Each is a value function of its arguments, and the two discharge it differently. `searchProgram` by construction for its own scratch (the VM's thread lists and capture vectors, §6.3) and by the transparency of the two memos §6.2 names — and, for its cursor, by the independence §6.2 states: over the row's domain the answer does not depend on which valid cursor is passed. `compileProgram` by the third shape, **frozen storage** (Effects §6.2, Intrinsics §4.2 — the shape this document added to the species): the buffers it allocates it fills before it returns, and no lowering writes them afterwards, its two memos excepted on the memo limb's terms, so every later read is a read of a value, and the fresh identity each call hands out is unobservable through any row — `Regex.hex`'s block declares no row that compares, hashes, or renders a `Program`, and a confined type has no pattern and derives nothing (Intrinsics §3.3), foreign code's view of an exported `Regex`'s representation is Effects §6.2's existing caveat, and `searchProgram`, the only row that inspects a program, answers from nothing but the `Pattern` the program was built from. That is why `Buffer.create` is `->~` while this row is `->`: a fresh buffer's identity is observable, a write to one and a read of the other telling them apart; a fresh program's is not, because nothing writes its frozen part. Confinement rules out interference from every module but the declarer and the lowering the door links: `Hex.Regex` is `regexProgram`'s one declarer, and `Hex.Runtime.Regex`, which handles the same values as `Compiled`, is the lowering the door names, its buffers confined in turn under `buffer`, whose declarer it is. The engine's obligation is the one sentence Effects §6.2 states, specialised: never write a frozen program again. **A program the compiler writes into an emitted module** (§8) discharges it on the same terms. It is a copy of the storage one `compileProgram` call filled, taken before any search read it: its frozen part holds what that call wrote, and its memos and scratch hold what a fresh call's hold, so it is that call's answer in everything a row can read. The module allocates and fills it as it loads, before any code can reach it, and no lowering writes its frozen part afterwards. It is written as plain data, so no Hexagon module can name it, and its identity is as unobservable as any fresh program's. Each takes no function-typed parameter, so nothing re-enters the engine mid-write. `searchProgram`'s answer, with `spans` set, is the spans — element 1 the whole match, always `Some`, and element `i + 1` group `i`, each `(start, length, text)` or `None`, from which the surface builds a `Match` once (§4.1) — paired with the cursor for the match's end (§6.2); with `spans` clear it is `Some` of the empty vector and the cursor it was given where a match exists, and `None` otherwise — unambiguous, since a spans answer always has its element 1.
- `compileProgram` and `searchProgram` are the only `->` rows over confined **state**: every row that reads or writes a buffer's contents is `->~`, `bufferLength` being `->` because a buffer's size is fixed at creation (Intrinsics §3.3), and the two table rows being `->` reads of fixed tables. No third sealed row is scheduled: `isMatch`, `findAll`, and the replacement family are ordinary Hexagon over `searchProgram`.

## 8. Literal patterns

A call of `Regex.compile` or `Regex.parse`, however its failure is marked or read, whose argument is a **string literal with no interpolation** is a **literal call**. It is written as a call or through `|>`, under any alias of the module. A function value of either function, or a call whose argument is not a literal, is compiled where it is evaluated, as any call is.

**A literal handed to `compile` is run while the program is compiled.** The compiler runs `compile` on the literal's text, with the same parser and the same constructor the call runs (§4.2, §5, §6.1), and it does so for every literal call to `compile` in every module it compiles, whether or not the call is ever reached.

- **A literal that `compile` refuses is refused at the call.** Where the call would throw `RegexCompileFault`, the program does not compile. The report is §2.9's message for the defect, without the position the fault's message adds. It is placed inside the literal at the codepoint the position names: on its source text, which is a whole escape sequence where the literal writes one (Lexer §6.2), and on the closing quote where the position is the pattern's length + 1. A bad literal in a function that is never called stops the build too: the check reads the literal, and no run of the program is needed. So does one inside a `try` that would catch the fault: the pattern is wrong text wherever it stands, and a program that means to meet the fault when it runs hands `compile` a pattern that is not a literal, such as one bound by `let`. The message names what to write, or the limitation the pattern meets (§2.9), and **quotes every spelling as a string literal spells it**, each backslash doubled and each codepoint Lexer §6.2 escapes written as its escape, because the report sits on the source: `Regex.compile("a\\")` is refused at its closing quote with "pattern ends inside an escape; write `\\\\` for a literal backslash". The report carries one note, that a pattern written as a literal is checked when the program is compiled, which says why the error is the compiler's; it names no other function to call.
- **Each rewrite the fault carries is a fix on the report** (§2.9). Its title is the rewrite's words, quoted as the message is, and its edits are placed on the literal as the report is: the codepoints an edit replaces are their source text, an edit at the pattern's length + 1 is placed before the closing quote, and the text an edit writes is spelled as a string literal spells it. Where an edit would bring a `$` or a `#` and a `{` together, it writes them apart, as `\$` or `\#`, so that the literal it leaves opens no interpolation. A refusal that carries no rewrite carries no fix, and the programmer writes the change the message names.
- **A literal that `compile` accepts is emitted already built.** The `Regex` the call answers is written into the emitted module as JavaScript data: its source, group count and name table, and its program. The module builds that value once, when it loads, and every evaluation of the call reads it. The program is a copy of the storage the build filled (§7): the instructions and classes as they were written, each property by name, the Unicode tables left in the runtime module (§7), and the memos and scratch as a fresh program's are. A compiler may keep each literal's answer for as long as it runs, since `compile` is a value function of its text.
- **A literal handed to `parse` is compiled once per load**, because its failure is the caller's to read at the call (§4.2). The compiler lifts the call into a module-level constant, built at its first successful evaluation, and every later evaluation of that call reads the same `Regex`. A literal that does not parse is never kept: each evaluation throws `RegexError` again, as the dynamic call would, and a call that is never evaluated throws nothing.

No semantics ride on where a `Regex` is built. Both functions are value functions of their argument (Effects §6.2, Intrinsics §4.2), and a value function may be shared or hoisted like any pure call, which is what lets the compiler run `compile` before the program does. A `Regex` is a value whose memos are transparent (§6.2). So the program observes the `Regex` the call would produce each time, whether that value was built while compiling, once per load, or at each call.

**Every host compiles alike.** The installed compiler, the language server and the playground check the same literals, refuse the same programs and emit the same constants, so a program one of them refuses, all of them refuse, as `program-io.md` §6 holds the playground's answers to Node's when a program runs. The check needs the compiler to run the JavaScript it emits for `Hex.Regex` and the modules beneath it, so a host where the compiler cannot run JavaScript is not a conforming host for a program with a literal call to `compile`: no host skips the check. A constant is written in the engine's own layout (§6.1), so it binds the module that carries it to the `Hex.Regex` and runtime modules the same compilation emitted, which the compiler links it against; a module emitted by one compiler is never linked against another's runtime modules.

## 9. Emission and the boundary

`Regex` and `Match` are opaque records and take FFI Part 7 §5's brand-only `.d.ts` face; `Group` and `Syntax`'s tree are transparent records and unions with the ordinary representation, and `RegexError` and `RegexCompileFault` are throwables with Exceptions §7.5's face. A `Program` has no `.d.ts` face — it is inside an opaque record, and a confined type never has one (Intrinsics §3.3). A `Seq(Match)` crossing the boundary is FFI Part 3's. Marks and colours erase with the rest of the effects discipline (Effects §8); the runtime module's emitted JavaScript carries its operations out under an export list the emitter writes, as `HashTrie.js` does, and a Hexagon module that imports it reaches nothing (Packages §2.4). A `Regex` built while compiling (§8) is emitted in the module whose literal it is, as JavaScript data: records as object literals; tuples and buffers as array literals, a long one holding one value in every slot written filled (`new Array(n).fill(v)`), storage two fields share written once and shared again; each union value in Unions §6.1's form, a nullary constructor as its own object; each vector through the vector construction the emitter writes for a vector literal; and no Unicode table.

## 10. Later phases — not scheduled

Each below needs its own ruling; none is implied by this document.

- **Typed captures**: a pattern whose groups are a record type in the program (the Swift `Regex` shape). The parse §8 runs while compiling would give the groups; what it needs beyond that is a literal syntax slot — a regex-literal form or a `pattern`-declaration door — which is a lexer and parser ruling, not a library one.
- **A regex-literal form** (no doubled backslashes): the same slot.
- **A texts-free spans mode** for `replace` with a literal and for `split`, which read no group text: the growth path if §4.1's eager cut bites. It widens `regexSearch`'s mode parameter from `Bool` to three values — a change to an existing key's declared scheme (Intrinsics §4.2), not a new key.
- **`\p{Emoji}`** and further properties: one ruling and one table each (§2.4).
- **`\p{…}` over grapheme clusters, or a grapheme unit**: rejected as the unit (§1); a later `String` grapheme surface, if one comes, is not this module's.
- **Leftmost-longest mode, `Stream`-driven subjects, streaming search**: no demand recorded.

## 11. Rejected alternatives (do not re-litigate without new information)

- **Wrapping the host `RegExp`**: §1 — the String spec forbids a host from deciding Unicode semantics; `\p` and `/i` are exactly that.
- **Derivative-based matching**: §1 — captures would be a second definition.
- **Backreferences and lookaround**: §2.8 — not linear; refused by name so the message says why.
- **Full case folding under `i`**: §3.4 — a second matching semantics; recorded with the divergence from `containsCi`.
- **Loose property-name matching (RL1.2a)**, **POSIX classes**, **the `\Z` anchor**, **CR/CRLF as `m`-mode line terminators**: §2.4, §2.7 — one spelling, one reading, one codepoint of lookahead.
- **A flags argument**, **a replacement-token language**, **`RegExp` conversion**, **`Eq`/`Hash` on `Regex`**, **a `Result`-returning or `try`-prefixed compile**: §4.6.
- **Grapheme clusters as the unit**: §1 — a class over clusters has no partition for a DFA to read.
- **A third sealed row (`findAll` in the engine)**: §7 — a `Seq` handed out by the engine would run impure code beneath a pure `pull` at every later step, a colour crossing at no sealed row; the enumeration is ordinary Hexagon over `searchProgram`, at the cost the cursor of §6.2 removes.
- **Python's empty-match rule**: §3.5.
- **Rust's `x` mode inside a class**: §2.6 — Perl's and Python's reading taken, so `[ ]` is a space class under every flag and a class reads the same with and without `x`.
- **`\x{…}` for the codepoint escape**: §2.3 — the lexer's `\u{…}` is the one form a Hexagon programmer already knows.
- **Running more than `compile` while compiling** (#1468, decision 1): a door through which any standard-library function opts in, or every value function whose arguments are literals, the program's own included. §8 — the first has no second customer, since the other faults a literal can trigger (`Int.div(7, 0)`, `[1, 2, 3][5]`) belong to operations the compiler knows itself; the second changes what a fault means for every function, refusing a program for a fault it may raise on purpose in code it never runs, where a pattern written into the program is wrong text wherever it stands, and needs a budget for a call that never finishes. Every colleague that checks patterns before the run checks them per API, on literals.
- **Checking a literal handed to `parse`** (#1468, decision 2), always or only under `assume`: §4.2, §8 — `parse` is the form whose failure the caller reads, and checking it would undo the split between the two functions for exactly the callers who chose `parse` to read its failure. Swift, TypeScript, .NET and Error Prone check only their written-pattern form.
- **A playground that compiles differently** (#1468, decision 3), checking literals but building them once per load, or not checking them: §8 — the first emits what the installed compiler does not, the second accepts what it refuses.
- **A second parser for the compiler's check**: #927's one-parser ruling; the compiler runs `Regex.Syntax` itself (§8).
- **A message that defers rather than fixes**, ending every compile-time report with "or hand the text to `Regex.parse`" (#1468, decision 4): §2.9 — it meets the Rewrite Rule's letter with advice a programmer with a bad pattern never needs, and still names no fix.
- **The dialect's rewrite-less refusals as an open question** (#1468, decision 4): §2.9 — they are refused for good (this section), so "open" would be untrue; they are named limitations instead.
- **A compile-time report quoting the pattern's spellings**: §8 — the report sits on the source, where the pattern's `\\` is written `\\\\`, so a rewrite quoted as the pattern spells it would be a lexer error or the text already written.

## 12. Precedents consulted

- [RE2 syntax](https://github.com/google/re2/wiki/Syntax) and [Go `regexp/syntax`](https://pkg.go.dev/regexp/syntax): the dialect, its refusals, the repetition bound, the empty-match rule, `$` without `m`.
- [Rust `regex` syntax](https://docs.rs/regex/latest/regex/#syntax): `x` mode, `\p{…}` spellings, `escape`, the `find_at` shape.
- [UTS #18 Unicode Regular Expressions](https://unicode.org/reports/tr18/): RL1.2's property set, RL1.5 simple folding, Annex C's `\d \s \w \b`.
- [Unicode PropertyAliases.txt and PropertyValueAliases.txt](https://www.unicode.org/Public/17.0.0/ucd/): the exact spellings admitted.
- Russ Cox, [Regular Expression Matching Can Be Simple And Fast](https://swtch.com/~rsc/regexp/regexp1.html), [the Virtual Machine Approach](https://swtch.com/~rsc/regexp/regexp2.html), [in the Wild](https://swtch.com/~rsc/regexp/regexp3.html): the construction — Thompson NFA, Pike VM, lazy DFA with a bounded cache, forward-then-reverse scan.
- [Swift `Regex`](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0350-regex-type-overview.md): typed captures, deferred (§10).
- Checks of written patterns before the run (§8): [Swift's regex literals](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0354-regex-literals.md), parsed by the compiler "diagnosing any errors at compile time"; [clippy's `invalid_regex`](https://rust-lang.github.io/rust-clippy/master/index.html#invalid_regex), which parses a literal handed to `Regex::new` with the `regex` crate's own parser; [staticcheck's SA1000](https://staticcheck.dev/docs/checks/#SA1000); [Error Prone's `InvalidPatternSyntax`](https://errorprone.info/bugpattern/InvalidPatternSyntax), which "deliberately do[es] not check `java.util.regex.Pattern#compile`"; and [.NET's SYSLIB1042](https://learn.microsoft.com/en-us/dotnet/fundamentals/syslib-diagnostics/syslib1040-1049) for `[GeneratedRegex]`, whose generator also emits the pattern already compiled.

## 13. Decisions log

| Decision | Where |
|---|---|
| Own engine on the RE2 path; no host `RegExp`; codepoint unit; pure surface over a `->~` engine | §1 |
| Spans are 1-based codepoint positions and counts; empty matches at boundary positions; no code unit on the public surface, the search row's cursor the one internal exception | §3.1 |
| Lone surrogates: one codepoint, no properties, never rejected or replaced in the subject (in a pattern, refused until §5's row lands); Unicode 17.0.0 by recorded update | §3.6 |
| A pattern is a `String`; positions 1-based codepoints; no raw-string form in v1 | §2.1 |
| Grammar; metacharacters; `]`/`}` literal outside, `{` refused unless a counted repetition | §2.2, §2.5 |
| Escapes: Lexer §6.2's table plus the class/assertion escapes; `\` + non-alphanumeric is literal; `\x`, `\f`, `\v`, `\Q`, `\Z`, backreferences refused by name | §2.3 |
| Classes: no nesting, no POSIX; `[]` refused; Annex C Perl classes; RL1.2 properties, exact spelling, closed set; folding closes classes including property classes | §2.4 |
| Repetition bound 1000 per operator and per nested product; nesting depth 1000 | §2.5 |
| Groups numbered by `(`; both named spellings; ASCII names; flags inline only, `i m s x`, with `-` clearing | §2.6 |
| `\n` is the only line terminator; `$` never before a final newline; `\b` over `\w` | §2.7 |
| `RegexError(message, position, rewrites)`, an exception, home `Regex.Syntax`, thrown by `Regex.parse` and `Syntax.parse`; one report per pattern; the message table *(#1427)*; each spelling a message names that keeps the refused text's one reading carried as a `Rewrite` of `Edit`s *(#1487)* | §2.9 |
| Leftmost-first only, priority order stated; captures = last entry, never reset | §3.2, §3.3 |
| `i` = simple folding; the one recorded divergence from `containsCi` | §3.4 |
| Empty-match iteration = RE2/Go's rule; `split` agrees with `String.split` on `""` | §3.5 |
| `Regex` opaque over `Program`, no `Eq`/`Hash`, `Show` = source; `Match` opaque — `whole`, `groups`, `names` — holding its `Group`s with texts cut by the engine, eager cut accepted, accessors are reads — a field read, one vector read, one name-table lookup *(#1468: a read of the name table from its start, §4.5)*; `Group` transparent | §4.1, §4.5 |
| *(#1427)* `compile` is for a pattern the programmer wrote and throws the exported fault `RegexCompileFault(message, position, rewrites)`, its message naming the position; `parse` is for a pattern that arrives as data and is one tracked function, `->^`, read at the call like `Int.parse` | §4.2 |
| Surface: `compile`, `parse`, `RegexCompileFault`, `escape`, `source`, `groupCount`, `groupIndex`, `isMatch`, `find`, `findFrom`, `findAll`, `replace`/`replaceFirst`/`replaceWith`/`replaceFirstWith`, `split` | §4.2–§4.4 |
| Decision 7 amended: replacement callbacks are `Match ->! String` callbacks where it wrote `Match -> String`; an effectful replacer is ordinary under its mark rather than a type error | §4.4 |
| Refusals: no token language, no flags argument, no `RegExp` conversion, no `Eq`/`Hash`, no re-export of `RegexError`, no `Vector`/`count` conveniences, no `Result`-returning or `try`-prefixed compile | §4.6 |
| `Regex.Syntax` pure, with one door row, the codepoint read a lone surrogate needs; flags resolved in the tree; property values canonical; explicit ranges normalized; one tree per construct; no source spans in v1 | §5 |
| A lone surrogate in a pattern is one codepoint, read through `Regex.Syntax`'s one door row | §3.6, §5 |
| `\w` is one item, `Property(Word, "")`, answered by the engine's table by kind alone, so that `\W` inside a class (`[\W\d]`) has a tree; `Word` has no `\p{…}` spelling | §5, §7 |
| Decision 4 amended: the Unicode-table keys and the resolution they serve move from `Regex.Syntax` to the engine; the parser keeps the names as a generated table | §5, §7 |
| Engine: class resolution on first use, fold before complement; alphabet partition; ordered lazy DFA forward then reverse; Pike VM for captures and fallback; two transparent memos (the cache Ruling 3 named, and the resolved classes) and no memo of the subject of its own, a far `findFrom` start located through Collections Part 3 §9's; a resumption cursor; a runtime module with an import; bounds table | §6 |
| Door: `buffer` + four rows, the two table keys and the three subject reads by code unit in the runtime, every property's ranges excluding surrogates; two sealed rows in `Regex.hex`, the search row taking a cursor and a spans mode and cutting the texts; no third sealed row | §7 |
| `regexProgram`, a second confined type key beyond the foundations' `buffer`, declarer `Hex.Regex`, under Intrinsics §3.3's confinement bar (#930): the engine's unexported `Compiled` record is the door's linkage, as `HashTrie` is `Map`'s, not a representation of the row's type | §7, Intrinsics §3.3 |
| Species (d) gains a third shape, frozen storage — filled before the row returns, never written again, its memos excepted — beside scratch and memo; `compileProgram` is its first member, its fresh identity unobservable through any row; Effects §6.2 and Intrinsics §4.2 carry the shape | §7, Effects §6.2, Intrinsics §4.2 |
| *(#1468)* A copy of a program `compileProgram` built, filled by an emitted module's load before any code can reach it, is frozen storage on the same terms | §6.3, §7, §8, Effects §6.2, Intrinsics §3.3 |
| Opaque brands for `Regex`/`Match`; transparent faces for `Group` and the tree; throwable faces for `RegexError` and `RegexCompileFault`; no face for `Program` | §9 |
| Literal patterns compiled once per load, through the same parser and constructor, for `compile` and `parse` alike, and only a successful result kept; build-time construction and literal diagnostics a later arc *(#1468: now §8's for `compile`, two rows below; `parse` keeps once per load)* | §8, §10 |
| *(#1468)* A literal call is a call of `compile` or `parse` on a string literal with no interpolation, through any alias or a pipe | §8 |
| *(#1468)* A literal handed to `compile` is run while the program is compiled, in every module and whether or not the call is reached or caught: a bad one refused at the call, at the codepoint its position names, with §2.9's message spelled as a string literal spells it; a good one emitted as JavaScript data, built once at load, its program a copy of the build's storage with properties by name and memos empty, bound to the runtime modules of the same compilation; every host alike, and none skips the check | §8, §7, §9 |
| *(#1468)* Every §2.9 message names what to write, the two count bounds a sequence; an unknown property takes the near-miss form; the rows for a construct §2.8 refuses to keep matching linear-time and leftmost-first, a grapheme or byte atom, and nesting past the depth bound name the limitation: named limitations in Declarations Preamble §1.1's sense | §2.9 |
| *(#1468)* Possessive repetition, atomic groups, conditionals, recursion, `(?#`, and other engines' `\k`, `\g`, `\K`, `\G` and `\c` refused by name; `U` names a lazy repetition; `[\b]` names the backspace too | §2.5, §2.6, §2.8, §2.9 |
| *(#1468)* The name table of a `Regex` and a `Match` is a vector of name and number in group order, so a built `Regex` can be written into the emitted program | §4.1, §6.4 |
