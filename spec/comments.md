# Hexagon Spec: Comments

**Status:** Decided (July 2026). Block-comment spelling re-ruled to `(* *)` on 2026-07-30 (issue #171, `decisions-ml-dialect-comments-2026-07.md`) under the ML-dialect doctrine; applied throughout in place, with the correction record at §11. Shipped-source comment doctrine added as §12 in the same ruling. **Doc comments resolved 2026-08-01 (issue #191, `doc-comments.md`): `(** *)` activated as the only doc form, the `///` reservation revoked** — the reservation language throughout is superseded in place, correction record §13. Amended 2026-11-12 (#1526): §12 points to `doc-comments.md` §6.2 for the presence and the length of the standard library's doc comments. **Respelled 2026-11-13 (#1538): comments are `--`, `{- -}` and `{-- -}`, and the spellings of JavaScript and OCaml are refused with Hexagon's named** — applied throughout in place, correction record §14; the #171 ruling document is superseded. Amended 2026-11-14 (#1542): `//` writes a fraction (Operators §6.4), so it leaves §3.1's lexical detection, and a `//` meant as a comment is refused by the parser, naming `--` — correction record §15.
**Scope:** Line comments, nested block comments, the `{-- -}` doc form as a comment form, detection of other languages' comment spellings, interaction with the layout pass, diagnostics, comment doctrine for shipped `.hex` source.
**Not in scope:** Doc-comment *semantics* — recognition predicate, attachment, content model, JSDoc emission — owned by `doc-comments.md`. Comment preservation in emitted JS — codegen quality-of-implementation, noted in §6 but not mandated.
**Companions:** Physical Lexer (comments as trivia and token interaction), Lexer & Layout (offside rule; `{` and records), Primitive Types §5 (string lexing; comments and strings do not lex inside each other), Operators §6.2 (two minus signs written apart), Operators §6.4 (`//` writes a fraction).

---

## 1. The forms

| Form | Meaning |
|---|---|
| `-- ...` | Line comment: from `--` to the end of the line, the newline excluded. |
| `{- ... -}` | Block comment: **nests**. May span lines. |
| `{-- ... -}` | **Doc comment**: a block comment whose opener `{--` is followed by a character that is neither `-` nor `}`. Recognition, attachment and emission: `doc-comments.md`. Lexically a block comment (nests, same errors). |

No other comment syntax exists. `//` is the fraction operator (Operators §6.4), and where it stands as a comment the parser refuses it naming `--`; `/* */` and `(* *)`, with their documentation forms, are not comments: they are **detected and refused**, each with Hexagon's spelling named (§3.1). `#` is not a comment (§7).

Hexagon is an ML dialect, and classic ML has one comment, the nesting block `(* *)`, and no line comment. Hexagon has a line comment, and F#, the ML dialect that added one, spells it `//`, which is the C family's spelling. So Hexagon takes its comments as a set from the neighbouring languages that have both forms, Haskell and Elm, where one character, the dash, marks the line comment `--` and the nesting `{- -}`; the documentation opener `{--` follows the same rule (Doc Comments §1). Taking the set whole keeps the forms consistent with one another, which keeping `(* *)` beside `--` would not (§7). Haskell, Elm, PureScript, Idris and Agda all pair `--` with a nesting `{- -}`.

## 2. Line comments

- `--` begins a comment wherever a token may begin — anywhere outside a string literal and outside another comment — and the comment runs to the end of the line. Nothing beside the dashes changes this: in `--x`, `x--` and `-- x` the comment begins at the dashes, and a run of more dashes, as in a `--------` banner, is one comment. This is Elm's rule, and Haskell's in a language with no operator that contains `--`. There is no line-continuation mechanism; the newline ends the comment and takes part in layout normally.
- **Two minus signs are written apart.** A program that means two minus signs puts a space or a parenthesis between them (Operators §6.2). Written together, the dashes and the rest of the line are a comment:

  | Written | Reads as | Write instead |
  |---|---|---|
  | `x --1`, `x-- 1`, `x -- 1` | `x`, then a comment | `x - -1` |
  | `--x` | a comment | `- -x` or `-(-x)` |
  | `f(--1)` | `f(`, then a comment | `f(- -1)` |
  | a continuation line beginning `--1` | a comment line | a continuation line beginning `- -1` |

  None of these is refused (§7). Where what remains is still a program, its meaning changes without a report: `let y = x --1` binds `y` to the value of `x`. Where it is not, as `f(` is not, the parser reports what is missing.
- A line comment is never documentation, whatever its text begins with: `--- note` and `-- | note` are ordinary comments (Doc Comments §2.3).

## 3. Block comments nest

- `{-` opens a comment and pushes depth; each `{-` inside pushes; each `-}` pops; the comment ends when depth returns to zero. This is Haskell's and Elm's form, with their semantics.
- **Inside a block comment only `{-` and `-}` count.** `--` is comment text there, so `{- a -- b -}` ends at its `-}`, as in Haskell; and strings are not lexed there, so a `-}` inside a string literal inside commented-out code terminates (a level of) the comment. OCaml lexes string literals inside its comments and errors on a lone `"` in comment prose; Hexagon keeps Haskell's rule, because lexing strings inside comments imports string-escape rules into dead text and turns ordinary prose into a lexing hazard. Not a diagnostic case; it's just the rule.
- Comments are not lexed inside strings, symmetrically: `"--"` and `"{-"` are two-character strings with no comment significance. An interpolation hole `${...}` is expression territory, and comments are legal inside it (Primitive Types §5.2). The `{` of `${` belongs to the string (Lexer §6.1), so `"${-x}"` interpolates `-x` and opens no comment.
- **`{` followed directly by `-` opens a comment** wherever a token may begin, ahead of the record brace. This costs no program: after `{`, a record type, literal or pattern begins with a field name, `...` or `}`, and an update with its head, which is a name or a dotted path (Products §3.1, §3.3), so no record begins with `-`. `{ -` with a space between is a brace followed by a minus (Lexer & Layout §4).
- `{--}` is an empty block comment, not documentation: doc recognition requires `{--` followed by a character that is neither `-` nor `}` (Doc Comments §2).
- `{-}` is an **unterminated comment**, not a brace and a minus: `{-` opens, and `}` is comment text, since the `-` of the opener cannot also begin a closer. The ordinary unterminated-comment error covers it.
- An unterminated block comment at EOF is a **hard error** reporting the position of the **innermost** unclosed `{-` and the current depth (§5). With nesting, "you forgot a `-}`" errors point at the right opener instead of the first one.
- A `-}` encountered at depth zero is a **hard error** ("unmatched `-}`"), not a minus followed by a brace. No legal program contains `-` immediately followed by `}`: a minus needs an operand after it, and `}` cannot be one, so the error steals nothing. At a `-`, `--` is matched first, so `--}` is a line comment.

### 3.1 The spellings of other languages are detected

Wherever a token may begin, each of these sequences is a **hard lexical error** naming Hexagon's spelling — never lexed as the tokens its characters would otherwise make:

| Sequence | Comes from | The message names |
|---|---|---|
| `/*`, including `/**` | JavaScript, JSDoc | `{- ... -}`, and the documentation form `{-- ... -}` after `/**` |
| `*/` | JavaScript | `-}` |
| `(*`, including `(**` | OCaml, F#, SML | `{- ... -}`, and the documentation form `{-- ... -}` after OCaml's documentation opener |
| `*)` | OCaml, F#, SML | `-}` |

None of these sequences occurs in a legal program: `*` is infix-only, so it can follow neither `/` nor `(`, which leave it no left operand, and neither `/` nor `)` can begin the right operand that `*` needs. The language's one non-infix `*`, the former namespace-import glob, is gone from the grammar (Modules §3.1), and JavaScript's `import * as` head survives only as the parse-error redirect Modules §3.1 prescribes. Detection is therefore free, and the Rewrite Rule (Declarations Preamble §1.1) demands the targeted redirect at the exact place a habit from another language fires. `**` is matched ahead of `*)` and `*/` by maximal munch, so `a **) 2` is `**` followed by `)`, and fails in the parser. Messages in §5.

Recommended recovery: on `/*`, scan to the nearest `*/` — JavaScript's own non-nesting rule; on `(*`, scan to the matching `*)`, nesting as OCaml does; then resume, so that one pasted comment yields one diagnostic. The fix a report carries rewrites the delimiters it found. The recovery and the fix are quality-of-implementation; the error and its shape are normative.

**`//` is an operator, and its comment refusals are the parser's.** `//` writes a fraction (Operators §6.4), so it is a token, and the lexer cannot tell a fraction from a comment. Two places show a `//` meant as a comment, and the parser refuses at each, naming Hexagon's spelling:

- **Nothing to its left.** A `//` where an operand must begin — at the start of an item, after `=`, `(` or another operator — has no top, so it is never a fraction: "a fraction needs a top; for a comment, write `--`". Recovery takes the rest of the line as the comment it was meant to be. A run of three or more slashes is such a `//` with more after it, refused the same way, with no documentation role (Doc Comments §2.3); its fix turns each `/` into `-`, so `/// note` becomes `--- note`.
- **A syntax error after it on its line.** `let y = 2 // a note` parses `2 // a` and fails at `note`. A syntax error reported anywhere on a `//`'s line after it — the rest of the line being what a comment would have been — adds "for a comment, write `--`" to the parser's own report. The `//` may be a fraction and the error another mistake, so the note is added, never put in the report's place.

A line that begins with `//` at its block's own indentation begins an item, since Lexer Layout §2.3 keeps `//` out of the continuation tokens, so the first refusal takes it. A deeper-indented line continues the line above (Lexer Layout §2), so a `//` that begins one has a top and is a fraction, and only the second refusal can reach it.

Neither reads a type. A `//` whose right side parses is a fraction, and draws what its sides draw: in `let y = 2 // note` with no `note` in scope, the unknown-name report, with no comment note.

## 4. Comments and layout

Comments are **whitespace to the layout pass**. Precisely:

- A line whose only content (after leading whitespace) is a comment — or that is entirely interior to a multi-line block comment — contributes **nothing** to the offside rule: no VSEP, no VOPEN/VCLOSE, no column comparison. Comment-only lines may sit at any column, including column 0 inside a deeply indented block.
- On a line containing code, the layout-relevant column is that of the **first non-comment token**. A block comment closing mid-line before code (`{- why -} let x = 1`) means `let`'s actual column is what layout sees — comment width effectively pads indentation. Legal, same as Haskell; the formatter may frown, the lexer does not.
- The **tab-in-leading-whitespace error** (Decisions Batch 2026-07 §4) is unchanged: it regulates literal whitespace characters from start-of-line to the first non-whitespace character. A tab *inside* a comment is interior text, not indentation, and is not this rule's business — even in a comment that precedes code on its line.
- A trailing comment after code (`let x = 1 -- note`) is invisible to layout; the line's block membership is determined by its first token as usual.

## 5. Required diagnostics

| Situation | Message (shape) |
|---|---|
| EOF inside block comment | "unterminated block comment; opened at line L, column C" — L,C of the **innermost** unclosed `{-`; if depth > 1, append " (nested N levels deep; each `{-` needs its own `-}`)". |
| `-}` at depth zero | "unmatched `-}` — no open block comment" |
| `{-` apparently intended to *end* at a `-}` that instead closed an inner comment (heuristic: unterminated-comment error where the comment body itself contains balanced `{- -}` pairs) | append hint: "block comments nest in Hexagon; a `{-` inside a comment must be matched before the comment ends". Optional but recommended — commented-out code containing `{-` is the standing hazard this row addresses. |
| `//` with nothing to its left (§3.1), and any longer run of `/` there | "a fraction needs a top; for a comment, write `--`" — the parser's, `//` being a token |
| A syntax error after a `//` on its line (§3.1) | the parser's own report, with the note "for a comment, write `--`" |
| `/*` where a token may begin (§3.1) — including `/**` | "JavaScript block comment syntax — Hexagon block comments are `{- ... -}`"; when the opener is `/**`, append " (documentation form: `{-- ... -}`)". |
| Stray `*/` where a token may begin (§3.1) | "`*/` is JavaScript's block comment closer — Hexagon spells it `-}`; no block comment is open here" |
| `(*` where a token may begin (§3.1) — including `(**` | "OCaml block comment syntax — Hexagon block comments are `{- ... -}`"; when the opener is OCaml's documentation opener, `(**` followed by a character that is neither `)` nor `*`, append " (documentation form: `{-- ... -}`)". |
| Stray `*)` where a token may begin (§3.1) | "`*)` is OCaml's block comment closer — Hexagon spells it `-}`; no block comment is open here" |

No warnings; per house rule there is no warning tier.

There are two further comment-adjacent hard errors — a doc comment that documents nothing, and a doc comment trailing code on its line. They are attachment errors, not lexical ones, and their rows live in `doc-comments.md` §5.

## 6. Emission and doc-comment horizon

- Comments have no Hexagon semantics, but the readable-JS doctrine makes source
  comments part of the default JavaScript presentation. The compiler preserves
  comments at top-level item boundaries in source order. A trailing line
  comment remains trailing when its item is emitted on one line. Blank lines between
  top-level items and comments are preserved as item separation; exact interior
  whitespace is formatter territory.
- **Emitted comments use JavaScript's comment syntax, and the emitted file must remain valid JS.** A line comment emits as `//` followed by its text. A `{- ... -}` comment whose text does not contain the sequence `*/` emits as `/* text */` — interior `{-` / `-}` pairs are inert text to JavaScript and are carried as-is; a body that does contain `*/` is re-presented as a run of `//` comments occupying **whole lines** (a `//` run must never share its lines with following code). (*Doc* comments take the other repair for the same hazard — the `*\/` escape, `doc-comments.md` §7.2 — because a `//` run is not JSDoc and would silently drop the documentation.) Content is preserved; presentation choices beyond the validity requirement are quality-of-implementation.
- Doc comment content flows to **JSDoc** in both the `.d.ts` and the readable `.js` (`doc-comments.md` §7). Attachment rules and the Markdown contract live there; module-level docs are deferred with **no** reserved spelling — the JSDoc design target expresses them within the one form (`doc-comments.md` §9.1).

## 7. Rejected alternatives (do not relitigate)

- **`//` line comments and `(* ... *)` block comments** (F#; OCaml writes the second alone). `//` is the C family's spelling, and the pair shares no character (§1); `//` writes a fraction (Operators §6.4). Both are refused with redirects where they stand as comments (§3.1).
- **Keeping `//` a lexical refusal beside the fraction operator**: a token cannot be both. The habit is caught where no fraction can stand — with nothing to the left of the `//`, or with a syntax error after it on its line (§3.1) — and nowhere else, since telling the two apart further would mean reading types to choose a reading.
- **`--` with `(* *)` and `(** *)` kept.** A pairing no colleague language has: dashes would mark one form, and parentheses with stars the others. Haskell, Elm, PureScript, Idris and Agda pair `--` with `{- -}`, and Lean 4 with `/- -/`.
- **`/* ... */`** (JavaScript). The C family's spelling, which does not nest in JavaScript where Hexagon's block comment does, and which shares nothing with the line comment. Refused with a redirect (§3.1).
- **A spacing rule beside `--`**: a space, the end of the line or more dashes required after `--`, or a space before it as well when code precedes it, with anything else refused. Each catches some of the double-minus spellings §2 lists, none can catch `x -- 1` without guessing what was meant, and no colleague language has one: Elm and Lean begin the comment at the dashes whatever stands beside them, and so do Haskell and PureScript wherever the dashes are not part of an operator symbol, which Hexagon has none of. Hexagon keeps their rule. Its cost, a double minus written together read as a comment without a report, is named in §2 with each rewrite.
- **Accepting another language's spelling alongside Hexagon's, as an alias**: two spellings for one form, against the corpus's one-spelling doctrine (Operators §1.2 is its sharpest statement); and `/* */` would keep JavaScript's non-nesting expectation alive under a form that nests.
- **Refusing only the JavaScript spellings**, leaving `(*` to an ordinary parse error: abandons the OCaml, F# and SML programmer, from the family Hexagon belongs to, at the first comment they write, for a redirect that costs nothing: `(*` is never part of a legal program (§3.1), so the redirect only improves an error that fires anyway.
- **No detection of other languages' spellings** (lex `/*` as `/` then `*`, `(*` as `(` then `*`): abandons the newcomer at the highest-traffic muscle-memory site in the language for a bewildered parse error one token later; the adjacencies are never legal, so detection is free and the Rewrite Rule demands it.
- **A deprecation window** (accept the old spellings with a redirect for a release): nothing to deprecate — the language is pre-1.0, every Hexagon source is converted in one change, and no warning tier exists.
- **OCaml's string-aware comment lexing** (a `"` inside a comment opens a string that must balance): imports escape rules into dead text and makes unpaired quotes in ordinary prose a lexing hazard; what it buys — commenting out code containing `-}` inside a string — is bought more cheaply by accepting that the comment ends there, with a local error.
- **Non-nesting block comments** (JS as-is): fails at the main job — commenting out code that contains a block comment. Nesting only adds programs that lex; Hexagon's block comment nests, as Haskell's and Elm's do.
- **No block comments at all** (option considered): rejected; region comment-out is a real workflow, editors' line-comment toggling notwithstanding, and the nested form is cheap.
- **`#` line comments** (Python/shell): `#` is spent — `#{` is reserved in strings for future `Debug` interpolation (Primitive Types §5.4), and keeping `#` free for future attribute/directive syntax is worth more than a redundant comment spelling.

The documentation opener's rejected alternatives — `{-|`, and refusing `{-|` — are `doc-comments.md` §10's.

## 8. Acceptance tests

Each row is its own source file with its own expectation; `x` is an `Int` bound to 5 where a row uses it.

| Source | Expectation |
|---|---|
| `let x = 1 -- trailing comment` | OK (x = 1); comment invisible to layout |
| `-- full-line comment`, at any column | contributes nothing to any block |
| `-------- banner --------` | one line comment |
| `let y = {- inline -} 2` | OK (y = 2) |
| `{- outer {- inner -} still outer -}` | one comment; depth returns to 0 at the end |
| `{- a -- b -} let z = 1` | OK (z = 1); `--` is text inside a block comment |
| `let s = "not a -- comment"` | `s` contains the dashes |
| `let t = "${-x}"` | OK (t = "-5"); the `{` belongs to `${`, and no comment opens |
| `{- "unclosed string with -} let z = 1` | the comment ended at the `-}` inside the quotes; z = 1 |
| `-}` | ERROR: unmatched `-}` |
| `{- opened, never closed` | ERROR at EOF: unterminated, points here |
| `{--}` | empty block comment, not documentation |
| `{-}` | ERROR at EOF: unterminated (the `}` is comment text) |
| `let r = {-1}` | ERROR at EOF: unterminated — `{-` opens a comment, and no record begins with `-` |
| `let y = x --1` | OK (y = 5): the comment begins at the dashes |
| `let y = x - -1` | OK (y = 6): `x - (-1)` |
| `let b = x **) 2` | never comment machinery: `**` munches first; parse error at `)` |
| `let a = 1 // 3` | OK (a = 1/3): `//` writes a fraction |
| `// note` | ERROR: a fraction needs a top; for a comment, write `--` |
| `/// note` | ERROR: the same; `///` is a run of slashes, and its fix is `--- note` |
| `let b = 1 // a note` | ERROR: the parser's report at `note`, with the note "for a comment, write `--`" |
| `let c = 1 // note`, no `note` in scope | ERROR: the unknown name `note`, with no comment note — `1 // note` parses as a fraction |
| `/* JS habit */` | ERROR: JavaScript block comment syntax — Hexagon block comments are `{- ... -}` |
| `*/` | ERROR: JavaScript's closer — Hexagon spells it `-}` |
| `(* OCaml habit *)` | ERROR: OCaml block comment syntax — Hexagon block comments are `{- ... -}` |
| `(** Doubles. *)` | ERROR: the same, with the documentation form `{-- ... -}` appended |
| `*)` | ERROR: OCaml's closer — Hexagon spells it `-}` |

## 9. Decisions log

| Decision | Where |
|---|---|
| `--` line, `{- -}` nested block, `{-- -}` doc; only comment forms; classic ML has no line comment and F#'s `//` is the C family's, so the set comes whole from Haskell and Elm | §1 |
| `--` begins a comment wherever a token may begin, whatever stands beside it (Elm's rule); two minus signs are written apart, and the spellings whose meaning changes are named with their rewrites | §2 |
| Block comments nest; inside one, only `{-` and `-}` count — `--` and strings are text (Haskell's rule, a chosen divergence from OCaml); comments are not lexed inside strings, and the `{` of `${` is the string's | §3 |
| `{-` opens a comment ahead of the record brace and steals no record; `{--}` empty; `{-}` unterminated | §3 |
| Unterminated / unmatched block-comment hard errors, innermost-opener reporting | §3, §5 |
| `/*` (incl. `/**`), stray `*/`, `(*` (incl. `(**`) and stray `*)` are hard errors with Rewrite Rule redirects; recovery and fixes recommended | §3.1, §5 |
| *(#1542)* `//` is the fraction operator; a `//` with nothing to its left (and a run of slashes there) is refused by the parser naming `--`, and a syntax error after a `//` on its line gains "for a comment, write `--`"; neither reads a type | §3.1, §5 |
| Comments are whitespace to layout; comment-only lines invisible; first non-comment token's column counts | §4 |
| Tab rule regulates literal leading whitespace only; tabs inside comments unregulated | §4 |
| Emitted comments use JS syntax: a line comment as `//`, a block as `/* */`, unsafe bodies re-presented as `//` runs | §6 |
| `{-- -}` is the doc comment, the only documentation form; semantics owned by `doc-comments.md`; no line form | §1, §2, §6 |
| Module docs deferred with **no** reserved spelling — the JSDoc model expresses them within `{-- -}` | §6 |
| Rejected: `//` with `(* *)`, `--` with `(* *)`, `/* */`, a spacing rule beside `--`, aliases, refusing only the JS spellings, no-detection, deprecation window, OCaml string-aware comments, non-nesting block comments, no block comments, `#` | §7 |
| Shipped-source comment doctrine (1–2 lines, purpose, manual-suitable, omit the obvious) | §12 |
| The respelling's correction record; the #171 ruling document superseded | §14 |

## 10. Edit notes to existing specs

- **Lexer & Layout §2 / §6:** the "comments" item in the owed-to-full-lexer-spec list is now resolved here; update the flag table to point at this document. *(Still owed — verified open at the #171 review, 2026-07-30.)*
- **Primitive Types §5.4:** unchanged, but this doc's §7 records that `#` remains reserved territory partly on its account.
- **Physical Lexer §7 / §8.2 / §10:** re-spelled and extended for §3.1's detection in the #171 PR. *(Applied — added 2026-07-30.)*
- **The respelling (#1538):** applied across the corpus in the same change; the ledger is §14.

## 11. Correction record — the #171 re-spelling *(added 2026-07-30)*

*(The spellings this record names were respelled again by #1538: correction record §14.)*

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

A doc comment on an exported standard-library item takes two things from `doc-comments.md` §6.2 in place of criteria 1 and 4: every such item has one, and its length is that section's *(#1526)*.

What shipped-source comments must **not** carry: history, doctrine, ruling numbers, spec cross-references, or change narration. That material has homes — the spec corpus, the decisions documents, issues, and git history — and it belongs in them. A comment may *state* a load-bearing normative fact with no code expression (e.g. "constructor order is normative"); the justification behind the fact, and the citation for it, stay in the spec — a reader who wants the why greps the corpus.

The "later manual" criterion is this section's reason for living here rather than in a style note: now that documentation comments exist (`{-- -}`, `doc-comments.md`), manual-facing comment content upgrades to them mechanically, and comments written to this standard are the ones that upgrade cleanly. The doctrine binds new shipped code immediately; the sweep bringing existing files into compliance was issue #172 (done 2026-07-31), and the upgrade sweep to doc comments is the follow-up recorded in `doc-comments.md` §14.

*(Swept 2026-07-31, issue #172: `stdlib/*.hex` and the embedded prelude are compliant. Two findings the sweep should not silently absorb. First, **Modules §5.5's header-comment house form survives this section** — the one-line ``// `Option`, `Some`, and `None` are implicitly in scope via the prelude.`` note is normative there, on stated pedagogical grounds, and is not a spec cross-reference in the sense this section bans; `Seq.hex` and `Vector.hex` keep it. A ruling, not a sweep, is what would overturn it. *(**Overturned 2026-08-01** by exactly that: James withdrew the house form, Modules §5.5 records the reasoning, and both comments are deleted. The sweep's reading was right — the convention did survive §12, and only its author could end it — so what this finding demonstrates is the boundary working, not a misjudgement.)* Second, the knowledge in a deleted `Seq.hex` comment outlived its claim and went to issue #177 rather than to the corpus: the comment recorded a layout workaround as a necessity.)*

*(#177, settled 2026-07-31.* The necessity was never real for the shape the comment described: it over-generalized defect-log finding 5, which was genuine but narrower than the comment made it — and which was itself fixed later the same day, so neither spelling is constrained now. The corpus record is that finding's correction note, and the prelude no longer depends on it either way. The general lesson belongs in this section, because this section is why the comment was read closely enough to catch it — **a shipped comment asserting an impossibility is a claim about the compiler, and nothing was checking it.** Such a claim is now written as a test or not written at all; §12's criterion 4 ("omitted entirely when the code says it already") does not license an unverified assertion about what the code *could not* say.

## 13. Correction record — the #191 activation and revocation *(added 2026-08-01)*

*(The spellings this record names were respelled by #1538, and `///` is no longer a comment at all: correction record §14.)*

Ruled in `doc-comments.md` (issue #191; James's directive, 2026-08-01): of the two forms reserved here, **`(** *)` is active** and **the `///` reservation is revoked, unspent**. Hexagon's documentation comment has one spelling — the block form; `///` has no special status of any kind, permanently: it is a `//` comment whose text begins with `/`, the lexer does not count slashes, and no future activation is contemplated (grounds — the TypeScript audience reads `///` as either nothing or a triple-slash directive, never as documentation — in `doc-comments.md` §10). This document remains the owner of the comment *forms* — lexing, nesting, layout invisibility, the JS-spelling redirects, the shipped-source doctrine — and every rule of §§2–5 holds of the doc form exactly as of the ordinary ones. Doc-comment *semantics* (recognition predicate, attachment, content, emission) are owned by `doc-comments.md`. What #191 superseded here, all annotated in place:

1. **The reservation language** — §1's table rows, §2's `///` bullet, the Status/Scope headers, §9's log rows: the `(** *)` row became "active, semantics in `doc-comments.md`"; the `///` row became the revocation.
2. **The `(**` recognition predicate tightened**: it excludes a following `*` as well as `)`, so `(***…` banners stay ordinary. A compatible refinement — before activation everything lexed as an ordinary comment, so no meaning changed (`doc-comments.md` §2.2).
3. **§6's doc-comment horizon bullet discharged** — the JSDoc payoff is collected for the activated form, into both the `.d.ts` and the readable `.js`.
4. **§8's acceptance line** `let a = 1 /// still just a comment in v1` re-annotated from time-bounded to **permanent** — the revocation makes it a standing pin that `///` attaches nothing. *(An intermediate draft of this ruling activated both forms and briefly made that line an error; James narrowed the ruling to the block form during the PR #192 review, and the line's original expectation stands.)*
5. **No new reservation made**: module-level docs are deferred *without* a reserved spelling. The design target is JSDoc recreated on Hexagon's surface (`doc-comments.md` §1), and JSDoc expresses module docs inside its one comment form by tag and position — so no delimiter is set aside, and none ever will be; `(** *)` is the entirety of Hexagon's documentation syntax. *(An intermediate draft reserved `(*!` on Rust's inner-doc model; dropped on James's direction the same day — `doc-comments.md` §9.1/§10.)*
6. **Smaller in-place revisions riding the ruling** *(recorded per README rule 5 — the delta review's finding D3)*: §12's "later manual" sentence rewritten from the anticipatory tense ("when the documentation spec activates…") to the delivered fact, with the upgrade sweep now pointed at `doc-comments.md` §14 — a supersession, recorded here rather than struck inline because the sentence's claim survived with only its tense and citations changed; §5 gained the pointer paragraph to `doc-comments.md`'s attachment errors (addition); §6's `//`-run repair gained the cross-cite to the `*\/` escape (addition).

The prior text is preserved in git history; per house rule, nothing was silently deleted.

## 14. Correction record — the respelling *(added 2026-11-13, #1538)*

Ruled on issue #1538: the comment forms are `--`, `{- -}` and `{-- -}`; `--` begins a comment wherever it stands outside a string, with no refusals; the documentation opener is `{--` followed by a character that is neither `-` nor `}`, and `{-|` is an ordinary comment; `//`, `/* */`, `(* *)` and `(** *)` are refused, each naming Hexagon's spelling. §§1–9 are restated in place. Every rule of §§3–5 about nesting, strings, layout and the unterminated and unmatched errors holds of `{- -}` as it held of `(* *)`. Beyond that substitution, the deltas are exactly these:

1. **§1** states the ground: classic ML has no line comment, and F#'s `//` is the C family's, so Hexagon takes its comments as a set from Haskell and Elm, which have both forms.
2. **§2's promise that `//` is never an operator is withdrawn**, with nothing promised in its place: `//` is a refused spelling (§3.1). The sentence that spent `//` for integer division goes with it.
3. **§2 names the double-minus spellings whose meaning changes**, with their rewrites; §8's `x --1` row now expects a comment.
4. **§3 adds** that `--` is text inside a block comment, that `{-` opens a comment ahead of the record brace, that the `{` of `${` is the string's, and that `{-}` is unterminated.
5. **§3.1 widens** from the JavaScript spellings to `//` and `(*` and a stray `*)` as well; §5 gains their rows, and its unmatched-closer row drops its closing period (Declarations Preamble §1.3).
6. **`///` is no longer a comment**: it is refused as `//` is, and the line form's absence is now stated in Doc Comments §2.3.
7. **§7** withdraws its entries for `--` and `{- -}`, which the ruling adopts; turns the `(* *)` entry into a rejection; and adds the alternatives the ruling did not choose.
8. **§8** is a table, since its sources now contain the `--` that its annotations used to be written with.

Applied elsewhere in the same change:

| Target | Edit |
|---|---|
| `doc-comments.md` | The doc form respelled throughout; §1's lineage sentence; §2.1's predicate; §2.2 gains `{---`, `{-\|` and the leading-`-` idiom; §2.3 states that there is no line form; §10's line-form and opener entries; §11's snippets |
| `lexer.md` | §7, §8.2, §8.3, §10 and §11 |
| `lexer-layout.md` | §1 and §4: a `{` token always begins a record, and `{-` is a comment opener before the parser sees a brace; §6's log |
| `operators-logic-precedence.md` | §6.2: two minus signs are written apart |
| `decisions-ml-dialect-comments-2026-07.md` | Marked superseded; its sentence calling `(* *)` the last piece of ML syntax Hexagon needed is withdrawn |
| `README.md` | Rule 3's list and the closure-document row mark the #171 document superseded |
| Examples in other specs | Hexagon examples respelled: comments become `--`, doc comments `{-- -}` |
| `notes/` | The two notes that still look forward, the v2 Money proposal and the Vector follow-ups, respelled as the specs are; promoted, adopted and superseded proposals are records of their day and keep the spellings they were written in |

Implementation is #1538's: one change flips the lexer and converts every Hexagon source together — the standard library, the playground, the Book and the Hexagon quoted in tests — because the standard library cannot compile half-converted. Its acceptance test is that the emitted JavaScript and `.d.ts` of the whole standard library come out byte-for-byte the same, since comments are emitted in JavaScript's spelling either way. The editor grammar, VS Code's comment settings, and the Book's comments section change with it; the Book warns readers from Haskell and Elm that `{-|` is an ordinary comment in Hexagon and that documentation is `{-- ... -}`.

The prior text is preserved in git history.

## 15. Correction record — `//` writes a fraction *(added 2026-11-14, #1542)*

Ruled on issue #1542: `//` writes a fraction (Operators §6.4), so it is a token, and the lexer no longer refuses it. Its comment refusals move to the parser, ruled as two: a `//` with nothing to its left is refused naming `--`, and a syntax error after a `//` on its line adds "for a comment, write `--`". The deltas:

1. **§1** names `//` as the fraction operator, refused as a comment by the parser.
2. **§3.1's table loses its `//` row**, the rationale that `/` cannot follow `/` goes with it, and the recovery and the run-of-slashes fix move to the new paragraph on the parser's two refusals.
3. **§5** replaces its `//` row with the two parser rows; the message for a `//` with nothing to its left names the fraction it is not.
4. **§7** adds the rejected alternative of keeping the lexical refusal.
5. **§8** replaces its `//` rows with a fraction, the two refusals, and the case the ruling leaves without a note: a `//` whose right side parses is a fraction.

Applied elsewhere in the same change: `lexer.md` §7, §8.1, §8.2, §10 and §11; `lexer-layout.md` §2.3, which keeps `//` out of the continuation tokens so that a line beginning with it begins an item; `operators-logic-precedence.md` §6.4. `doc-comments.md` §2.3's "refused as `//` is" stands: a run of slashes is refused as a `//` with nothing to its left.
