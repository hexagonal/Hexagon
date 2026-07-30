# Hexagon Spec: Comments

**Status:** Decided (July 2026). Block-comment spelling re-ruled to `(* *)` on 2026-07-30 (issue #171, `decisions-ml-dialect-comments-2026-07.md`) under the ML-dialect doctrine; applied throughout in place, with the correction record at §11. Shipped-source comment doctrine added as §12 in the same ruling.
**Scope:** Line comments, nested block comments, reserved doc-comment forms, detection of the JavaScript block-comment spellings, interaction with the layout pass, diagnostics, comment doctrine for shipped `.hex` source.
**Not in scope:** Doc-comment *semantics* and tooling (attachment rules, Markdown flavour, `.d.ts`/JSDoc emission) — owed to a future documentation spec; v1 only reserves the syntax. Comment preservation in emitted JS — codegen quality-of-implementation, noted in §6 but not mandated.
**Companions:** Physical Lexer (comments as trivia and token interaction), Lexer & Layout (offside rule), Primitive Types §5 (string lexing; comments and strings do not lex inside each other), `decisions-ml-dialect-comments-2026-07.md` (the #171 ruling; authoritative for the re-spelling until fully consolidated here).

---

## 1. The forms

| Form | Meaning |
|---|---|
| `// ...` | Line comment: from `//` to end of line (exclusive of the newline). |
| `(* ... *)` | Block comment: **nests**. May span lines. |
| `/// ...` | **Reserved for doc comments.** In v1: lexes as an ordinary line comment. |
| `(** ... *)` | **Reserved for doc comments.** In v1: lexes as an ordinary block comment. |

No other comment syntax exists. `--`, `{- -}`, `#` are not comments (§7). The JavaScript spellings `/*` and `*/` are not comments either — they are **detected and redirected** (§3.1). *(Block forms re-spelled from `/* */` / `/** */`, 2026-07-30, #171 — §11.)*

## 2. Line comments

- `//` begins a comment anywhere outside a string literal or char-level construct; it runs to end of line. There is no line-continuation mechanism; the newline ends the comment and participates in layout normally.
- **Maximal munch is permanent:** `//` is never an operator and never will be. In particular, a future integer-division operator cannot be spelled `//`; that spelling is spent. (Integer division remains `Int.div` / whatever the numerics surface provides.)
- `///` is three slashes: v1 lexes it identically to `//`. The distinction becomes meaningful only when the documentation spec lands; because doc comments carry metadata rather than semantics, upgrading `///` later is non-breaking.
- The #171 re-spelling did not touch this section's rules: `//` is the same spelling in JavaScript and in F#, so ML lineage and JS convention agree here — the observation §7 always made now carries the section.

## 3. Block comments nest

- `(*` opens a comment and pushes depth; each `(*` inside pushes; each `*)` pops; the comment ends when depth returns to zero. This is F#'s and OCaml's form with F#'s and OCaml's semantics — ML block comments nest natively, and always have. (Under the old `/* */` spelling the nesting was Rust's repair of JS's wart; under the ML spelling there was never a wart to repair.)
- **Strings are not lexed inside comments.** A `*)` inside a string literal inside commented-out code terminates (a level of) the comment. This is a **chosen divergence from OCaml**, which lexes string literals inside comments and errors on a lone `"` in comment prose; Hexagon's rule stands on its own merit — lexing strings inside comments imports string-escape rules into dead text and turns ordinary prose into a lexing hazard. Not a diagnostic case; it's just the rule. *(Rationale corrected 2026-07-30, #171 — the previous text claimed every nesting language shares this, which OCaml falsifies; the rule itself is unchanged.)*
- Comments are not lexed inside strings, symmetrically: `"//"` and `"(*"` are two-character strings with no comment significance. (Interaction with interpolation holes: a hole `${...}` is expression territory — comments are legal inside it, per Primitive Types §5.2's "expression-level" framing.)
- `(**)` is an empty block comment (the `(**` prefix rule does not apply — doc-comment recognition, when it comes, requires `(**` followed by at least one character that is not `)`; the lexer need not care in v1 since both lex as comments).
- `(*)` is an **unterminated comment**, not a three-character expression: `(*` opens, `)` is comment text. OCaml's classic `( * )` trap does not arise — Hexagon has no operator-as-value syntax and no prefix `*` (Operators §1.1; the #171 audit), so there is no legal reading to protect and the ordinary unterminated-comment error covers it.
- An unterminated block comment at EOF is a **hard error** reporting the position of the **innermost** unclosed `(*` and the current depth (§5). With nesting, "you forgot a `*)`" errors point at the right opener instead of the first one.
- A `*)` encountered at depth zero is a **hard error** ("unmatched `*)`"), not two operator tokens. No legal program contains infix `*` immediately followed by `)`, so the error steals nothing (the #171 audit; `**)` is unaffected — maximal munch matches `**` positionally before `*)` can be considered).

### 3.1 The JavaScript spellings are detected *(added 2026-07-30, #171)*

Wherever a token may begin, the two-character sequences `/*` and `*/` are **hard lexical errors** naming the Hexagon spelling — never lexed as `/` then `*` (or `*` then `/`). The adjacency occurs in no legal program: `/` is infix-only, and the sole non-infix `*` in the language — the `import * as` glob (Modules §3.3) — has both neighbours fixed by its grammar (`import` before, `as` after), so neither sequence can arise there or anywhere else; detection is free and the Rewrite Rule (Declarations Preamble §1.1) demands the targeted redirect at the exact place a JavaScript author's muscle memory fires. Messages in §5. Recommended recovery: on `/*`, scan to the nearest `*/` — JavaScript's own non-nesting rule — and resume after it, so one pasted JS comment yields one diagnostic; the recovery is quality-of-implementation, the error and its shape are normative. `//` needs no detection: it is the same spelling in both languages.

## 4. Comments and layout

Comments are **whitespace to the layout pass**. Precisely:

- A line whose only content (after leading whitespace) is a comment — or that is entirely interior to a multi-line block comment — contributes **nothing** to the offside rule: no VSEP, no VOPEN/VCLOSE, no column comparison. Comment-only lines may sit at any column, including column 0 inside a deeply indented block.
- On a line containing code, the layout-relevant column is that of the **first non-comment token**. A block comment closing mid-line before code (`(* why *) let x = 1`) means `let`'s actual column is what layout sees — comment width effectively pads indentation. Legal, same as Haskell; the formatter may frown, the lexer does not.
- The **tab-in-leading-whitespace error** (Decisions Batch 2026-07 §4) is unchanged: it regulates literal whitespace characters from start-of-line to the first non-whitespace character. A tab *inside* a comment is interior text, not indentation, and is not this rule's business — even in a comment that precedes code on its line.
- A trailing comment after code (`let x = 1 // note`) is invisible to layout; the line's block membership is determined by its first token as usual.

## 5. Required diagnostics

| Situation | Message (shape) |
|---|---|
| EOF inside block comment | "unterminated block comment; opened at line L, column C" — L,C of the **innermost** unclosed `(*`; if depth > 1, append "(nested N levels deep; each `(*` needs its own `*)`)". |
| `*)` at depth zero | "unmatched `*)` — no open block comment." |
| `(*` apparently intended to *end* at a `*)` that instead closed an inner comment (heuristic: unterminated-comment error where the comment body itself contains balanced `(* *)` pairs) | append hint: "block comments nest in Hexagon; a `(*` inside a comment must be matched before the comment ends." Optional but recommended — commented-out code containing `(*` is the standing hazard this row addresses. |
| `/*` where a token may begin (§3.1) — including `/**` | "JavaScript block comment syntax — Hexagon block comments are `(* ... *)`"; when the opener is `/**`, append "(documentation form: `(** ... *)`)". *(Added 2026-07-30, #171.)* |
| Stray `*/` where a token may begin (§3.1) | "`*/` is JavaScript's block comment closer — Hexagon spells it `*)`; no block comment is open here." *(Added 2026-07-30, #171.)* |

No warnings; per house rule there is no warning tier.

## 6. Emission and doc-comment horizon

- Comments have no Hexagon semantics, but the readable-JS doctrine makes source
  comments part of the default JavaScript presentation. The compiler preserves
  comments at top-level item boundaries in source order. A trailing line
  comment remains trailing when its item is emitted on one line. Blank lines between
  top-level items and comments are preserved as item separation; exact interior
  whitespace is formatter territory.
- **Emitted comments use JavaScript's comment syntax, and the emitted file must remain valid JS** *(clause added 2026-07-30, #171 — closing a gap that predates the re-spelling)*: `//` comments emit verbatim; a `(* ... *)` comment whose text does not contain the sequence `*/` emits as `/* text */` — interior `(*` / `*)` pairs are inert text to JavaScript and may be carried as-is or re-spelled; a body that does contain `*/` is re-presented as a run of `//` comments occupying **whole lines** (a `//` run must never share its lines with following code). (The gap predates the re-spelling: under the old delimiters a *nested* comment's body necessarily contained `*/`, so it was never verbatim-emittable into non-nesting JS, and the old text never said what to do about it.) Content is preserved; presentation choices beyond the validity requirement are quality-of-implementation.
- The exception on the horizon: when the documentation spec lands, `///` / `(** *)` content should flow to **JSDoc in the `.d.ts`**. The payoff is unchanged by the re-spelling — doc *content* flows to JSDoc regardless of source delimiters, and under the ML-dialect doctrine the source spelling no longer needs to be JS-shaped to earn it. Attachment rules (what declaration a doc comment binds to), inner-doc forms (Rust's `//!`), and Markdown processing are all deferred with it.

## 7. Rejected alternatives (do not relitigate)

- **`--` line comments** (Haskell, Elm, Lua, SQL): lexical hazard with unary minus — `x --1` / `x--1` silently comments out the rest of the line; a documented gotcha in both Elm and Haskell. Also visually crowds `..` in range-heavy code. F#, the primary expression-model reference, itself uses `//`, so ML lineage and JS convention agree here; `--` had no constituency.
- **`(* ... *)`** (F#/OCaml) — *(superseded 2026-07-30, #171: **adopted**; see §11)*. The entry's grounds were audited in the ruling and did not survive: the "classic collision surface with parenthesized-operator syntax" is empty in Hexagon (no operator-as-value, no prefix `*`), "reads as line noise to the JS audience" is the tiebreaker the ML-dialect doctrine demoted, and the F#-continuity Hexagon "didn't need" is now the posture the doctrine names. Recorded here per the house rule that superseded text is annotated in place, never silently deleted.
- **Keeping `/* */`** (the pre-#171 decision): correct under the superseded doctrine; reversed by issue-and-ruling procedure (`decisions-ml-dialect-comments-2026-07.md` §9). The spelling is not merely retired but **redirected** (§3.1).
- **Accepting `/* */` alongside `(* *)` as an alias**: two spellings for one form, against the corpus's one-spelling doctrine (Operators §1.2 is its sharpest statement); and it would keep JS's non-nesting expectation alive under a form that nests. *(Added 2026-07-30, #171.)*
- **No detection of the JS spellings** (lex `/*` as `/` then `*`): abandons the JS author at the highest-traffic muscle-memory site in the language for a bewildered parse error one token later; the adjacency is never legal, so detection is free and the Rewrite Rule demands it. *(Added 2026-07-30, #171.)*
- **A deprecation window for `/* */`**: nothing to deprecate — no shipped or corpus code used the form, the language is pre-1.0, and no warning tier exists. *(Added 2026-07-30, #171.)*
- **OCaml's string-aware comment lexing** (a `"` inside a comment opens a string that must balance): imports escape rules into dead text and makes unpaired quotes in ordinary prose a lexing hazard; what it buys — commenting out code containing `*)` inside a string — is bought more cheaply by accepting that the comment ends there, with a local error. *(Added 2026-07-30, #171.)*
- **`{- ... -}`** (Haskell): dead on arrival — `{` is unconditionally a record in Hexagon (Lexer & Layout §4); a comment opener starting with `{` would reintroduce the context-dependence that design paid to eliminate.
- **Non-nesting block comments** (JS as-is): fails at the main job — commenting out code that contains a block comment. Nesting only adds programs that lex; Hexagon keeps it under the new spelling exactly as under the old.
- **No block comments at all** (option considered): rejected; region comment-out is a real workflow, editors' line-comment toggling notwithstanding, and the nested form is cheap.
- **`#` line comments** (Python/shell): `#` is spent — `#{` is reserved in strings for future `Debug` interpolation (Primitive Types §5.4), and keeping `#` free for future attribute/directive syntax is worth more than a redundant comment spelling.

## 8. Acceptance tests

Each line (with its marked continuation) is its own source file with its own expectation; the block is not one program.

```
let x = 1 // trailing comment            -- OK (x = 1); comment invisible to layout
// full-line comment at any column       -- contributes nothing to any block
let y = (* inline *) 2                   -- OK (y = 2)
(* outer (* inner *) still outer *)      -- one comment, depth returns to 0 at the end
let s = "not a // comment"               -- s contains the slashes
(* "unclosed string with *) let z = 1    -- comment ended at the *) inside the quotes; z = 1
*)                                       -- ERROR: unmatched `*)`
(* opened, never closed                  -- ERROR at EOF: unterminated, points here
let a = 1 /// still just a comment in v1 -- OK
(**)                                     -- empty block comment
(*)                                      -- ERROR at EOF: unterminated (the `)` is comment text)
let b = a **) 2                          -- never comment machinery: `**` munches first; parse error at `)`
/* JS habit */                           -- ERROR: JavaScript block comment syntax — use (* ... *)
*/                                       -- ERROR: JS closer — Hexagon spells it `*)`
x --1                                    -- NOT a comment: `--` isn't a token;
                                         -- lexes as `x`, `-`, `-`, `1` → unary minus applies: x - (-1). OK.
```

(The last line is the `--`-rejection payoff made concrete: under `--`-comments it would have silently discarded `-1`.)

## 9. Decisions log

| Decision | Where |
|---|---|
| `//` line, `(* *)` nested block; only comment forms; JS spellings redirected *(re-spelled #171)* | §1–§3 |
| `//` permanently not an operator (integer division can never be `//`) | §2 |
| Block comments nest; strings not lexed inside comments (and vice versa — a chosen divergence from OCaml) | §3 |
| Unterminated / unmatched block-comment hard errors, innermost-opener reporting; `(*)` unterminated; `(**)` empty | §3, §5 |
| `/*` (incl. `/**`) and stray `*/` are hard errors with Rewrite Rule redirects; scan-to-`*/` recovery recommended | §3.1, §5 |
| Comments are whitespace to layout; comment-only lines invisible; first non-comment token's column counts | §4 |
| Tab rule regulates literal leading whitespace only; tabs inside comments unregulated | §4 |
| Emitted comments use JS syntax; unsafe bodies re-present as `//` runs *(#171, gap closure)* | §6 |
| `///` and `(** *)` reserved for doc comments; v1 lexes them as ordinary comments; JSDoc-in-`.d.ts` is the intended payoff | §1, §5, §6 |
| Doc-comment semantics, attachment, inner-doc forms deferred to documentation spec | §6 |
| Rejected: `--`, `{- -}`, non-nesting block comments, `#`, JS-spelling aliases, no-detection, deprecation window, OCaml string-aware comments | §7 |
| Shipped-source comment doctrine (1–2 lines, purpose, manual-suitable, omit the obvious) | §12 |

## 10. Edit notes to existing specs

- **Lexer & Layout §2 / §6:** the "comments" item in the owed-to-full-lexer-spec list is now resolved here; update the flag table to point at this document. *(Still owed — verified open at the #171 review, 2026-07-30.)*
- **Primitive Types §5.4:** unchanged, but this doc's §7 records that `#` remains reserved territory partly on its account.
- **Physical Lexer §7 / §8.2 / §10:** re-spelled and extended for §3.1's detection in the #171 PR. *(Applied — added 2026-07-30.)*

## 11. Correction record — the #171 re-spelling *(added 2026-07-30)*

Ruled in `decisions-ml-dialect-comments-2026-07.md` (issue #171; James's directive under the ML-dialect doctrine): the block-comment delimiters are `(* *)`, re-spelled from `/* */` throughout this spec **in place** — the re-spelling is a delimiter substitution, and every rule of §§3–5 holds verbatim of the new spelling. §7's "do not relitigate" entry for `(* *)` was reopened by the issue-and-ruling procedure that doctrine §1.2 requires, and is superseded in place above. Beyond the substitution, the semantic deltas are exactly these:

1. **§3.1 added**: the JS spellings `/*` and `*/` are detected hard errors with Rewrite Rule redirects (two new §5 rows). Previously `/* */` *was* the comment form; no detection existed or was needed.
2. **§6 gains the emission-translation clause**: emitted comments use JS syntax; bodies unsafe for `/* */` re-present as `//` runs. Closes a gap that predates the re-spelling (nested comments were never verbatim-emittable into JS). *(Corrected 2026-07-31, at implementation: this entry said no behaviour changed "since no emitter yet preserves block comments". hexc does preserve them — top-level comments are emitted in source order — so the clause is a live obligation, and the emitter now translates rather than copying the delimiters.)*
3. **§3's string-noninteraction rationale corrected**: the claim "every nesting language shares this" was false of OCaml; the rule is unchanged and now recorded as a chosen divergence.
4. **Doc-comment block reservation moved** from `/** */` to `(** *)`; `///` untouched; the `/**` spelling now falls under §3.1's detection with a doc-form addendum.
5. **§12 added** (shipped-source comment doctrine — an addition riding the same ruling, not a consequence of the re-spelling).
6. **Smaller in-place revisions riding the substitution:** §2 gains the F#-agreement bullet; §5 row 3's rationale respells (the JS-divergence framing gave way to the standing commented-out-code hazard); §6's doc-comment horizon bullet is re-grounded (ruling §5); and §7 gains four **new binding** rejected-alternatives entries (aliases, no-detection, deprecation window, OCaml string-aware lexing) — new doctrine, not substitution.

The prior text of the superseded passages is preserved in git history and in the ruling document's quotations; per house rule, nothing was silently deleted.

## 12. Comments in shipped Hexagon source *(added 2026-07-30, #171 — doctrine)*

Comments in `.hex` source shipped with the compiler — the standard library and the embedded prelude — must be:

1. **one or two lines long**;
2. **describing purpose or function to the developer**;
3. **suitable for a later manual**; and
4. **omitted entirely when the code says it already** — a comment too obvious to survive editing should not be written.

What shipped-source comments must **not** carry: history, doctrine, ruling numbers, spec cross-references, or change narration. That material has homes — the spec corpus, the decisions documents, issues, and git history — and it belongs in them. A comment may *state* a load-bearing normative fact with no code expression (e.g. "constructor order is normative"); the justification behind the fact, and the citation for it, stay in the spec — a reader who wants the why greps the corpus.

The "later manual" criterion is this section's reason for living here rather than in a style note: when the documentation spec activates `///` and `(** *)`, manual-facing comment content upgrades to doc comments mechanically, and comments written to this standard are the ones that upgrade cleanly. The doctrine binds new shipped code immediately; the sweep bringing existing files into compliance is issue #172.
