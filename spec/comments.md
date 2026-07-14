# Hexagon Spec: Comments

**Status:** Decided (July 2026)
**Scope:** Line comments, nested block comments, reserved doc-comment forms, interaction with the layout pass, diagnostics.
**Not in scope:** Doc-comment *semantics* and tooling (attachment rules, Markdown flavour, `.d.ts`/JSDoc emission) — owed to a future documentation spec; v1 only reserves the syntax. Comment preservation in emitted JS — codegen quality-of-implementation, noted in §6 but not mandated.
**Companions:** Physical Lexer (comments as trivia and token interaction), Lexer & Layout (offside rule), Primitive Types §5 (string lexing; comments and strings do not lex inside each other).

---

## 1. The forms

| Form | Meaning |
|---|---|
| `// ...` | Line comment: from `//` to end of line (exclusive of the newline). |
| `/* ... */` | Block comment: **nests**. May span lines. |
| `/// ...` | **Reserved for doc comments.** In v1: lexes as an ordinary line comment. |
| `/** ... */` | **Reserved for doc comments.** In v1: lexes as an ordinary block comment. |

No other comment syntax exists. `--`, `(* *)`, `{- -}`, `#` are not comments (§7).

## 2. Line comments

- `//` begins a comment anywhere outside a string literal or char-level construct; it runs to end of line. There is no line-continuation mechanism; the newline ends the comment and participates in layout normally.
- **Maximal munch is permanent:** `//` is never an operator and never will be. In particular, a future integer-division operator cannot be spelled `//`; that spelling is spent. (Integer division remains `Int.div` / whatever the numerics surface provides.)
- `///` is three slashes: v1 lexes it identically to `//`. The distinction becomes meaningful only when the documentation spec lands; because doc comments carry metadata rather than semantics, upgrading `///` later is non-breaking.

## 3. Block comments nest

- `/*` opens a comment and pushes depth; each `/*` inside pushes; each `*/` pops; the comment ends when depth returns to zero. This is Rust's semantics with Rust's spelling — JS's spelling, minus JS's wart.
- **Strings are not lexed inside comments.** A `*/` inside a string literal inside commented-out code terminates (a level of) the comment. Every nesting language shares this; the alternative — lexing strings inside comments — imports string-escape rules into dead text and is worse. Not a diagnostic case; it's just the rule.
- Comments are not lexed inside strings, symmetrically: `"//"` and `"/*"` are two- and two-character strings with no comment significance. (Interaction with interpolation holes: a hole `${...}` is expression territory — comments are legal inside it, per Primitive Types §5.2's "expression-level" framing.)
- `/**/` is an empty block comment (the `/**` prefix rule does not apply — doc-comment recognition, when it comes, requires `/**` followed by at least one character that is not `/`; the lexer need not care in v1 since both lex as comments).
- An unterminated block comment at EOF is a **hard error** reporting the position of the **innermost** unclosed `/*` and the current depth (§5). With nesting, "you forgot a `*/`" errors point at the right opener instead of the first one.
- A `*/` encountered at depth zero is a **hard error** ("unmatched `*/`"), not two operator tokens. JS would also fail here, just less legibly; Hexagon names the problem.

## 4. Comments and layout

Comments are **whitespace to the layout pass**. Precisely:

- A line whose only content (after leading whitespace) is a comment — or that is entirely interior to a multi-line block comment — contributes **nothing** to the offside rule: no VSEP, no VOPEN/VCLOSE, no column comparison. Comment-only lines may sit at any column, including column 0 inside a deeply indented block.
- On a line containing code, the layout-relevant column is that of the **first non-comment token**. A block comment closing mid-line before code (`/* why */ let x = 1`) means `let`'s actual column is what layout sees — comment width effectively pads indentation. Legal, same as Haskell; the formatter may frown, the lexer does not.
- The **tab-in-leading-whitespace error** (Decisions Batch 2026-07 §4) is unchanged: it regulates literal whitespace characters from start-of-line to the first non-whitespace character. A tab *inside* a comment is interior text, not indentation, and is not this rule's business — even in a comment that precedes code on its line.
- A trailing comment after code (`let x = 1 // note`) is invisible to layout; the line's block membership is determined by its first token as usual.

## 5. Required diagnostics

| Situation | Message (shape) |
|---|---|
| EOF inside block comment | "unterminated block comment; opened at line L, column C" — L,C of the **innermost** unclosed `/*`; if depth > 1, append "(nested N levels deep; each `/*` needs its own `*/`)". |
| `*/` at depth zero | "unmatched `*/` — no open block comment." |
| `/*` apparently intended to *end* at a `*/` that instead closed an inner comment (heuristic: unterminated-comment error where the comment body itself contains balanced `/* */` pairs) | append hint: "block comments nest in Hexagon; a `/*` inside a comment must be matched before the comment ends." Optional but recommended — this is the one behavioural divergence from JS a JS developer can hit. |

No warnings; per house rule there is no warning tier.

## 6. Emission and doc-comment horizon

- Comments have no semantics; the AST need not retain them for correctness. **Preserving comments in emitted JS is desirable** under the readable-JS doctrine and recommended as a codegen goal, but is quality-of-implementation, not spec.
- The exception on the horizon: when the documentation spec lands, `///` / `/** */` content should flow to **JSDoc in the `.d.ts`** — that's the payoff for reserving JS-shaped doc syntax now. Attachment rules (what declaration a doc comment binds to), inner-doc forms (Rust's `//!`), and Markdown processing are all deferred with it.

## 7. Rejected alternatives (do not relitigate)

- **`--` line comments** (Haskell, Elm, Lua, SQL): lexical hazard with unary minus — `x --1` / `x--1` silently comments out the rest of the line; a documented gotcha in both Elm and Haskell. Also visually crowds `..` in range-heavy code. F#, the primary expression-model reference, itself uses `//`, so ML lineage and JS convention agree here; `--` had no constituency.
- **`(* ... *)`** (F#/OCaml): chosen by F# for OCaml continuity Hexagon doesn't need; classic collision surface with parenthesized-operator syntax; reads as line noise to the JS audience. Nesting, its one virtue, is kept and re-spelled.
- **`{- ... -}`** (Haskell): dead on arrival — `{` is unconditionally a record in Hexagon (Lexer & Layout §4); a comment opener starting with `{` would reintroduce the context-dependence that design paid to eliminate.
- **Non-nesting `/* */`** (JS as-is): fails at its main job — commenting out code that contains a block comment. Rust proves the fix is free: nesting only adds programs that lex; no comment a JS developer writes changes meaning.
- **No block comments at all** (option considered): rejected; region comment-out is a real workflow, editors' line-comment toggling notwithstanding, and the nested form is cheap.
- **`#` line comments** (Python/shell): `#` is spent — `#{` is reserved in strings for future `Debug` interpolation (Primitive Types §5.4), and keeping `#` free for future attribute/directive syntax is worth more than a redundant comment spelling.

## 8. Acceptance tests

```
let x = 1 // trailing comment            -- OK (x = 1); comment invisible to layout
// full-line comment at any column       -- contributes nothing to any block
let y = /* inline */ 2                   -- OK (y = 2)
/* outer /* inner */ still outer */      -- one comment, depth returns to 0 at the end
let s = "not a // comment"               -- s contains the slashes
/* "unclosed string with */ let z = 1    -- comment ended at the */ inside the quotes; z = 1
*/                                       -- ERROR: unmatched `*/`
/* opened, never closed                  -- ERROR at EOF: unterminated, points here
let a = 1 /// still just a comment in v1 -- OK
/**/                                     -- empty block comment
x --1                                    -- NOT a comment: `x - (-1)`? No — `--` isn't a token;
                                         -- lexes as `x`, `-`, `-`, `1` → unary minus applies: x - (-1). OK.
```

(The last line is the `--`-rejection payoff made concrete: under `--`-comments it would have silently discarded `-1`.)

## 9. Decisions log

| Decision | Where |
|---|---|
| `//` line, `/* */` nested block; only comment forms | §1–3 |
| `//` permanently not an operator (integer division can never be `//`) | §2 |
| Block comments nest; strings not lexed inside comments (and vice versa) | §3 |
| Unterminated / unmatched block-comment hard errors, innermost-opener reporting | §3, §5 |
| Comments are whitespace to layout; comment-only lines invisible; first non-comment token's column counts | §4 |
| Tab rule regulates literal leading whitespace only; tabs inside comments unregulated | §4 |
| `///` and `/** */` reserved for doc comments; v1 lexes them as ordinary comments; JSDoc-in-`.d.ts` is the intended payoff | §1, §6 |
| Doc-comment semantics, attachment, inner-doc forms deferred to documentation spec | §6 |
| Rejected: `--`, `(* *)`, `{- -}`, non-nesting `/* */`, `#` | §7 |

## 10. Edit notes to existing specs

- **Lexer & Layout §2 / §6:** the "comments" item in the owed-to-full-lexer-spec list is now resolved here; update the flag table to point at this document.
- **Primitive Types §5.4:** unchanged, but this doc's §7 records that `#` remains reserved territory partly on its account.
