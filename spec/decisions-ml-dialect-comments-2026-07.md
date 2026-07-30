# Hexagon Spec: Decisions — Block Comments Are `(* *)`

**Status:** Decided (ruling on issue #171, 2026-07-30). Fable's spec ruling under the ML-dialect doctrine (`decisions-ml-dialect-bool-2026-07.md` §1), on James's directive given in-session 2026-07-30 and recorded in the issue: `(* *)` is "the last piece of ML syntax we need to adopt to be a card-carrying ML dialect." Authoritative until consolidated into the host specs, per README authority rule 3 — this document is added to rule 3's closure-document list in this same PR; the standing is conferred there, not claimed here.
**Scope:** The delimiter re-spelling (§2); the maximal-munch audit that makes it free (§3); detection of the JavaScript spellings (§4); the documentation-comment reservation (§5); what does not change (§6); comment emission into JavaScript, including a pre-existing gap this ruling closes (§7); the shipped-source comment doctrine (§8); rejected alternatives (§9); the edit-notes ledger (§10); implementation notes (§11).
**Not in scope:** Doc-comment *semantics* — attachment, Markdown flavour, JSDoc emission — still owed to the future documentation spec; this ruling only re-spells the reservation. The sweep re-writing existing library comments to §8's doctrine (issue #172, a fresh session's task after this PR merges). `hexc`, grammar, and formatter implementation (follow-up work, §11).
**Companions:** Comments (host of the normative text; correction record §11 and doctrine §12 there), Lexer §7–§8 (token interaction), Operators §1–§2 (the ground of §3's audit), Declarations Preamble §1.1 (the Rewrite Rule, which §4 applies), `decisions-ml-dialect-bool-2026-07.md` §1 (the doctrine this rules under).

---

## 1. The ruling

> Hexagon's block comment is **`(* ... *)`** — multi-line and **nesting**, replacing `/* ... */` in every role that form had. **`(**` is reserved for documentation comments** (the block form; `///` remains the reserved line form). The JavaScript spellings **`/*` and `*/` are detected and redirected** to the Hexagon spellings under the Rewrite Rule (§4). Line comments are untouched: `//` remains the line comment, permanently not an operator.

This is the ML-dialect arc's surface completion. The doctrine's named posture is "F# with Fable" (`decisions-ml-dialect-bool-2026-07.md` §1.1), and the resulting comment inventory is F#'s exactly — `//`, `///`, nesting `(* ... *)` — plus OCaml's `(**` doc reservation. Comments §7 had rejected `(* *)` under "do not re-litigate"; per doctrine §1.2 that section remains binding and reopening it required an issue and a ruling — #171 is that procedure, and §9 disposes of the old entry's grounds one by one.

---

## 2. The re-spelling

`(*` opens a block comment and pushes depth; each `(*` inside pushes; each `*)` pops; the comment ends when depth returns to zero. Every rule Comments §3–§5 states about the old spelling holds verbatim of the new one — nesting, the string non-interaction in both directions, the innermost-opener unterminated error, the unmatched-closer error, the nesting hint. The re-spelling is a delimiter substitution, not a redesign; Comments' sections are edited in place with a correction record (§11 there) naming this document.

Two consequences of the particular characters, both benign and both recorded:

- **`(*)` is an unterminated comment**, not a three-character expression: `(*` opens, `)` is comment text. In OCaml this is a classic trap because `( * )` is the multiplication operator as a value; Hexagon has no operator-as-value syntax (§3), so no one has a reason to write `(*)` and the ordinary unterminated-comment error covers whoever does.
- **`(**)` is an empty comment** (`(*` then `*)`), the analogue of the old `/**/`, and is *not* a doc form — doc recognition, when it becomes meaningful, requires `(**` followed by at least one character that is not `)` (§5).

## 3. Why maximal munch steals nothing (the audit)

The old rejection's technical ground was the "classic collision surface with parenthesized-operator syntax." Audited at ruling time, that surface is **empty in Hexagon** — not small, empty:

- **No operator-as-value syntax exists.** Operators are never first-class and never user-defined (Operators §1.1, permanently); there is no `( * )` section form for `(*` to collide with, which is the entire OCaml/F# collision.
- **No prefix `*` exists** — the only prefix operators in the language are unary `-` (level 3) and `not` (level 8) in Operators §3's table, and `*` appears in the token inventory (Lexer §8.1) only as the infix multiplicative. The language's sole non-infix `*` is not an operator at all: the **`import * as` glob** (Modules §3.3), whose neighbours are fixed by its own grammar — `import` before, `as` after — so it can never sit adjacent to `(`, `)`, or `/`. After `(`, then, a legal program can never continue with `*`: infix `*` needs a left operand and `(` provides none. **`(*` as a comment opener therefore steals no legal program.** *(The glob caveat was the cold review's finding 1: an earlier draft claimed flatly that no non-infix `*` exists, which Modules §3.3 falsifies; the conclusion was independently re-verified with the glob accounted for.)*
- **Symmetrically for the closer:** infix `*` requires a right operand and `)` cannot be one, so `*` immediately followed by `)` never occurs in legal code. **`*)` at depth zero is pure error territory** and gets the unmatched-closer diagnostic.
- **`**` disambiguates positionally, not by rule order.** At the first `*` of `**)`, maximal munch matches `**` (both characters present) and cannot match `*)` (its second character is `*`, not `)`); so `a **) b` lexes `**` then `)` and fails in the parser like any missing operand — no comment machinery is consulted. Inside a comment the scanner is in trivia mode scanning only for `(*` and `*)`, so the `*)` in `**)` closes a level, matching OCaml.
- The same argument, run for the JS spellings, licenses §4's detection: `/` is infix-only, and `*`'s one non-infix occurrence is grammar-fixed as above, so `/*` and `*/` are never two adjacent tokens of a legal program either. Detection forfeits nothing.

This audit is the reason the re-spelling costs one PR and no deprecation path: no corpus code, no shipped `.hex` source, and no conformance snippet contained a block comment (verified at ruling time — the entire library comments with `//`), and no legal program's lexing changes.

## 4. The JavaScript spellings are detected

> Wherever a token may begin, the two-character sequences **`/*`** and **`*/`** are **hard lexical errors** naming the Hexagon spelling — never lexed as `/` then `*`. For `/*` (including `/**`): "JavaScript block comment syntax — Hexagon block comments are `(* ... *)`" and, when the opener is `/**`, the addendum "(documentation form: `(** ... *)`)". For a stray `*/`: "`*/` is JavaScript's block comment closer — Hexagon spells it `*)`; no block comment is open here."

This is the Rewrite Rule (Declarations Preamble §1.1) applied at the exact place a JavaScript author's muscle memory fires. The alternative — letting `/*` lex as two operator tokens — is strictly worse: by §3's audit the adjacency is never legal, so the user would get a bewildered parser error one token later instead of the one-substitution fixit. The lexer already owns this pattern for `!`, `&&`, and `||` (Lexer §8.2); `/*` and `*/` join that special-case family.

**Recovery (recommended, not normative):** on detecting `/*`, scan to the nearest `*/` — JavaScript's own non-nesting rule — and resume lexing after it, so one pasted JS comment produces one diagnostic rather than a cascade from its body; if no `*/` follows, the single error at the opener stands. The error itself, and its message shape, are normative (Comments §5's new rows).

`//` needs no detection: it is the same spelling in both languages, and `///` likewise lexes today as an ordinary line comment in both. The redirect surface is exactly the block forms.

## 5. The documentation reservation

The reserved doc forms are now **`///`** (line — unchanged) and **`(** ... *)`** (block — replacing `/** ... */`). Recognition, when the documentation spec lands, requires `(**` followed by at least one character that is not `)`, so `(**)` stays an ordinary empty comment (§2). In v1 both reserved forms lex as ordinary comments, exactly as before; upgrading later remains non-breaking because doc comments carry metadata, not semantics.

One sentence of Comments §6 loses its premise and is re-grounded: the old payoff for reserving *JS-shaped* doc syntax was JSDoc flow into the `.d.ts`. That payoff survives the re-spelling untouched — doc *content* flows to JSDoc regardless of the source delimiters — and under the pivoted doctrine the source spelling no longer needs to be JS-shaped to earn it. `/**` is redirected like any `/*`, with the doc-form addendum (§4).

## 6. What does not change

- **`//` line comments** — every rule of Comments §2, including "maximal munch is permanent: `//` is never an operator" and the spent integer-division spelling. The old §7 already observed that F# itself uses `//`, "so ML lineage and JS convention agree here"; that observation now carries the section.
- **Comments are whitespace to layout** — Comments §4 verbatim; only its inline example re-spells. The tab rule's jurisdiction is unchanged.
- **Strings and comments do not lex inside each other** — in both directions, deliberately *diverging from OCaml*, which lexes string literals inside comments and errors on a lone `"` in comment prose. That divergence existed before this ruling and is now recorded as chosen rather than asserted as universal (the old §3 claimed "every nesting language shares this," which OCaml falsifies; the corrected text names the divergence and keeps the rule on its actual merit: lexing strings inside comments imports escape rules into dead text and breaks on ordinary prose). New rejected-alternatives entry, §9.
- **Interpolation holes** — comment lexing still resumes inside `${...}` (Lexer §6.1); a `(* ... *)` inside a hole is expression-territory trivia as before.
- **The nesting hint** (Comments §5, row 3) — kept, re-spelled: commented-out code containing `(*` is the same hazard the row always addressed.
- **The diagnostics regime** — hard errors only; no warning tier exists to soften any row here.

## 7. Comment emission into JavaScript

Comments §6 obliges the emitter to preserve top-level comments in the readable JS. With source and target spellings now different, the obligation needs one clause it should always have had:

> Emitted comments use **JavaScript's** comment syntax and the emitted file must remain syntactically valid JS. `//` comments emit verbatim. A `(* ... *)` comment whose text does not contain the sequence `*/` emits as `/* text */` — interior `(*` / `*)` pairs are inert text to JavaScript. A body containing `*/` is re-presented as a run of `//` comments occupying whole lines. Content is preserved; presentation beyond the validity requirement is quality-of-implementation.

The second clause closes a **pre-existing gap**: a *nested* Hexagon block comment was never verbatim-emittable into JS — `/* outer /* inner */ outer */` is broken JavaScript, since JS does not nest — and the old §6 never said what the emitter should do about it. The re-spelling forced the translation question and the answer covers the old gap for free. Recorded in Comments' correction record (§11 there) as a gap closure, not a behaviour change — no emitter currently preserves block comments.

## 8. Comments in shipped Hexagon source (doctrine)

James's directive, verbatim in substance, hosted normatively as **Comments §12** and summarized here: comments in `.hex` source shipped with the compiler — the standard library and the embedded prelude — must be

1. **one or two lines long**;
2. **describing purpose or function to the developer**;
3. **suitable for a later manual**; and
4. **omitted entirely when the code says it already.**

What they must *not* be: history, doctrine, ruling numbers, spec cross-references, or change narration. That material has homes — the spec corpus, the decisions documents, issues, and git history — and it stays in them; the prohibition on spec cross-references is flat, per the directive. A load-bearing normative fact with no code expression — "constructor order is normative" — may be *stated* in its one line; the justification and the citation stay in the spec (the host text, Comments §12, governs the exact wording). The motivating specimen is `stdlib/Bool.hex` at ruling time: ~24 comment lines of doctrine and citations, all of it already recorded in the #147 closure document, in front of a three-line declaration. The doctrine is prospective for new code immediately; the sweep bringing existing files into compliance is **issue #172**, deliberately scheduled after this PR so it can re-spell any block comments in the same pass.

The "later manual" criterion is why this doctrine lives in the Comments spec rather than a style note: when the documentation spec activates `///` and `(** *)`, manual-facing comment content upgrades to doc comments mechanically. Writing comments to that standard now is what makes the upgrade mechanical then.

## 9. Rejected alternatives (do not re-litigate)

- **Keeping `/* */`** (the standing decision). Correct under the superseded doctrine; its three recorded grounds are each overtaken. *Collision surface:* empty in Hexagon — §3's audit; the ground was inherited from OCaml/F# folklore and never applied to a language with no operator-as-value and no prefix `*`. *"Reads as line noise to the JS audience":* the demoted tiebreaker, by doctrine §1.1. *"F# chose it for OCaml continuity Hexagon doesn't need":* inverted — the doctrine's named posture *is* F#'s, and continuity with the ML family is now the point. Comments §7's old entry is superseded in place with a pointer here.
- **Accepting both spellings as aliases** (`/* */` silently works). Two spellings for one form, against the corpus's one-spelling doctrine (Operators §1.2's words-only rule is its sharpest statement); and it would keep JS's non-nesting expectation alive under a form that nests, which is exactly the confusion the redirect retires.
- **No detection** — let `/*` lex as `/` then `*`. Abandons the JS author at the highest-traffic muscle-memory site in the language for a parse error one token later; the Rewrite Rule exists for precisely this case, and §3 shows detection is free.
- **A deprecation window** (accept `/* */` with a redirect *and* still lex it as a comment for a release). There is nothing to deprecate: no shipped or corpus code uses the old form (§3), the language is pre-1.0, and a warning tier does not exist.
- **OCaml's string-aware comment lexing** (a `"` in a comment opens a string that must close and balance). Imports escape rules into dead text; makes ordinary prose — `(* don't *)` survives, but `(* the "fast" path *)` only just, and an unpaired `"` errors — into a lexing hazard. The one thing it buys (commenting out code containing `*)` inside a string) is bought more cheaply by the acceptance-test rule already in place: the comment ends there, and the resulting error is local.
- **`{- -}` and `--` and `#`** — rejected for their standing reasons (Comments §7), none of which this ruling disturbs: `{` is unconditionally a record, `--` is a lexical hazard with unary minus and `x --1` remains an acceptance test, `#` remains spent on `#{` and future directives.
- **Activating doc semantics for `(**` in v1.** Still deferred with the documentation spec; this ruling moves the reservation's spelling only.

## 10. Edit-notes ledger

Applied in this ruling's PR (direct edits):

| Target | Edit |
|---|---|
| `comments.md` | §§1–6, 8, 9 re-spelled in place; §3 gains §3.1 (JS-spelling detection, the §4 rules here); §5 gains the two redirect rows; §6 gains the emission-translation clause (§7 here); §7's `(* *)` entry superseded in place, new entries for the alternatives §9 rejects; new **§11 correction record** (names this document; itemizes the semantic deltas beyond re-spelling); new **§12 shipped-source doctrine** (§8 here). Scope/companions headers updated. |
| `lexer.md` | §7 bullets re-spelled; the detection bullet added. §8.2's comment-handling line becomes: `//` before `/`; `(*` and `*)` before `(` and `*`; `/*` and `*/` detected before `/` and `*`. §8.2's forbidden-run sentence adds `/*` and `*/` to the `!`/`&&`/`||` family. §10 gains the JS-redirect row (messages: Comments §5 verbatim). |
| `README.md` | Rule 3's closure-document list adds this document. Ownership map unchanged (`comments.md` still owns comment forms). |
| Book: `chapters/05-layout.md` (+ `DRAFT-3.md` rebuild), `plans/05-layout.md`, `FEATURES.md`, `CONTINUITY.md` | The comments section re-taught with the new spelling and the JS redirect; the summary bullet, plan audit notes, features list, and continuity commitment re-spelled. |

Owed (README rule 4 — applied on next touch): none. No other spec, shipped source, or conformance snippet contains a block comment (§3's verification); prose mentions of "doc comment" in Unions §6.2 / FFI Part 7 §4.1 concern JSDoc in emitted `.d.ts` — JavaScript's side of the boundary — and are untouched by a Hexagon source-spelling change.

## 11. Implementation notes (follow-up work, not this PR)

- **hexc lexer** (`compiler/src/passes/lexer/lexer.ts`): re-spell the block-comment trivia scanner; add the `/*`/`*/` detection with the §4 messages and the recommended scan-to-`*/` recovery; the two existing test-pinned messages ("unmatched `` `*/` ``…", "unterminated block comment…") re-spell with their tests. Comments §5 messages remain the verbatim source of truth (Lexer §10's row).
- **TextMate grammar** (single grammar since #163, shared by the VS Code extension and the Playground): comment scopes re-spelled; the `(*`-family begin/end rules are bracket-free, so this does not interact with #162's unterminated-bracket repaint beyond the repaint any unterminated block comment already causes. The grammar's inline notes citing Comments §3 (`editors/vscode/syntaxes/hexagon.tmLanguage.json`) go stale with the spelling and update in the same pass. **Correction (2026-07-30, once #162 was built):** the "does not interact" clause understates it. #162 split every type-context bracket group into a hanging and a bounded rule, so there are now seven `\(`-based `begin`s in that area, and each needs `(?!\*)` — include order will not do, because `#type-declaration-parameters` and the `derives` rules begin matching before their `(` and would otherwise claim the `(` of a `(*` opener. A trailing `(* … *)` after an opening bracket also reads as content to the hanging classifier, demoting the group to bounded; that is the spelling-independent behaviour the grammar's `//line-bail-guard` note records, not a new cost of the respell.
- **VS Code language configuration** (`editors/vscode/language-configuration.json`): `blockComment`, the `/*` auto-closing pair, and the `/**` `onEnterRules` all encode the JS spelling — until updated, Toggle Block Comment *inserts* the now-illegal form. Its spec-citing test (`editors/vscode/src/language-configuration.test.ts`, "matches the forms spec/comments.md §1 defines") currently passes while asserting the superseded forms and must flip with the config. Implementer caveat (cold review, finding 8): a `(*` auto-closing pair interacts with the existing `(` → `)` pair — not a pure find-and-replace.
- **Emitter:** nothing until block-comment preservation is implemented; when it is, §7's translation clause governs.
- **Formatter note** (`notes/canonical-formatting-and-naming.md`, non-normative): inherits the spelling on next touch.
- **Conformance:** lex `(* (* *) *)` to trivia with correct depth; `(**)` empty; unterminated `(*` errors at the innermost opener; `*)` at depth zero errors; `/*`, `/**`, and stray `*/` produce the §4 redirects and the recommended single-diagnostic recovery; `x --1` still lexes `x - (-1)`; a `(* *)` inside `${...}` is trivia; strings still opaque to comments and vice versa.

## 12. Decisions log

| Decision | Where |
|---|---|
| Block comment is `(* ... *)`, nesting, replacing `/* ... */` in every role; line comments untouched | §1, §2 |
| Comments §7's rejection of `(* *)` reversed by issue-and-ruling procedure; grounds audited | §1, §9 |
| Collision surface audited empty: no operator-as-value, no prefix `*`/`/`; `(*`, `*)`, and the JS detections steal no legal program | §3 |
| `(*)` = unterminated comment (ordinary error); `(**)` = empty ordinary comment; `**` wins positionally in `**)` | §2, §3 |
| `/*` (incl. `/**`) and stray `*/` are hard errors with Rewrite Rule redirects; scan-to-`*/` recovery recommended | §4 |
| Doc reservations are `///` and `(** ... *)`; recognition needs a non-`)` character after `(**`; v1 lexes both as ordinary comments | §5 |
| Strings-in-comments non-lexing kept, recorded as a chosen divergence from OCaml | §6, §9 |
| Emitted comments use JS syntax; bodies containing `*/` re-present as whole-line `//` runs — closes the pre-existing nesting-emission gap | §7 |
| Shipped-source comment doctrine: 1–2 lines, purpose/function, manual-suitable, omit the obvious; no history/doctrine/spec-links; hosted as Comments §12; sweep = #172 | §8 |
| Aliases, no-detection, a deprecation window, OCaml string-aware comments: rejected | §9 |
