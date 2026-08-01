# Hexagon Spec: Documentation Comments

**Status:** Decided (August 2026). Ruled on issue #191 (James's directive, given in-session 2026-08-01): the doc-comment forms reserved since Comments §1 — `///` and `(** ... *)` — are **active in v1**. This document is the "future documentation spec" that Comments §5/§6 and Lexer §7 have been deferring to; with it, that horizon is discharged.
**Scope:** Recognition of the doc forms (§2); content extraction and doc blocks (§3); attachment (§4); the two new hard errors (§5); the content model (§6); emission as JSDoc into the readable JS and the `.d.ts` (§7); tooling surface (§8); reservations and deferrals (§9); rejected alternatives (§10).
**Not in scope:** Ordinary comment lexing, nesting, layout interaction, and the JS-spelling redirects — Comments owns all of it, unchanged. A doc *tag* language (`@param`-style), intra-doc link resolution, parameter docs, and module-level (inner) docs — deferred with revisit bars, §9. A rendered-manual pipeline (HTML docs generator) — post-v1 tooling; this spec fixes what such a tool consumes, not the tool.
**Companions:** Comments (host of the forms; correction record §13 there records what activation supersedes), Lexer §7 (doc trivia), Declarations Preamble §7.1 (the declaration inventory §4 quantifies over), Modules §4 (`export`; complete-signature rule §4.1.1), FFI Part 7 (the `.d.ts` §7 emits into), `decisions-ml-dialect-comments-2026-07.md` §5 (the reservation this activates).

---

## 1. The ruling

> The reserved forms are activated. **`/// text`** is a line documentation comment; **`(** ... *)`** is a block documentation comment. A **doc block** — one or more doc comments immediately preceding a declaration — attaches to that declaration as its documentation. Documentation is **metadata, not semantics**: it changes no type, no value, no emitted *code* (changing emitted *comments* is its job — §7). It is carried to tooling, and it emits as **JSDoc** on the corresponding declarations in the generated JavaScript and `.d.ts` — the payoff Comments §6 has promised since the reservation was made.

Activation is the non-breaking upgrade the reservation was designed to be: no shipped `.hex` source, conformance snippet, or corpus example contains `///` or `(**` (verified at ruling time), and a doc comment still lexes as trivia — layout, the token sequence, and every rule of Comments §2–§4 are untouched. What activation adds is recognition (§2), attachment (§4), two hard errors for doc comments that document nothing (§5), and emission (§7).

Both reserved forms activate together. They are not two spellings of one form (which Operators §1.2's doctrine would forbid) but the line/block pair, exactly parallel to `//` and `(* *)` for ordinary comments: `///` for the short annotation, `(** *)` for the multi-paragraph one. The inventory is F#'s line form plus OCaml's block form — the "F# with Fable" posture's comment surface completed (`decisions-ml-dialect-comments-2026-07.md` §1).

## 2. Recognition

### 2.1 The line form

A line comment is a **doc comment** when it begins with exactly `///` — three slashes followed by a character that is not `/` (or by end of line). It runs to end of line like any line comment.

- `//// banner ////` and any longer slash run are **ordinary comments** (Rust's rule). Banner and ruler lines never become documentation by accident.
- `///` alone (end of line after three slashes) is a doc comment with empty content — legal, used as a paragraph separator inside a `///` run (§3.2).

### 2.2 The block form

A block comment is a **doc comment** when it begins with `(**` followed by a character that is neither `)` nor `*`. Its body is scanned exactly as an ordinary block comment's — `(*` pushes depth, `*)` pops, strings are not lexed inside it — and it ends when depth returns to zero. Everything Comments §3 says about block comments (nesting, string non-interaction, the unterminated and unmatched errors, innermost-opener reporting) holds of the doc form verbatim; the doc opener differs from the ordinary opener only in what the trivia is *for*.

### 2.3 What stays ordinary

| Spelling | Status | Why |
|---|---|---|
| `(**)` | empty ordinary comment | already pinned at reservation time (Comments §3); recognition requires a character after `(**` |
| `(***`, `(****…` | ordinary comment | OCaml's rule; `(********)` rulers and decorative banners never become documentation. A doc comment whose content must *begin* with `*` writes a space first: `(** *bold* *)`. |
| `////…` | ordinary comment | §2.1; same banner reasoning |
| `//!`, `(*!` | ordinary comments, **newly reserved** for inner (module-level) docs | §9.1 |

The reservation's recognition predicate said "at least one character that is not `)`" (Comments §3; ruling §5); activation **tightens** it by also excluding `*`, and adds the exactly-three rule for `///`. Both refinements are compatible with everything the reservation promised — in v1-before-activation all of these lexed as ordinary comments, so no meaning changes — and both are recorded in Comments' correction record (§13 there).

## 3. Content

### 3.1 Extraction

Documentation content is text, extracted per form:

- **Line:** everything after `///`, with **one** leading space dropped if present. (`///  two spaces` keeps one — indented Markdown constructs survive.)
- **Block:** the body between `(**` and its matching `*)`, processed in order:
  1. one leading space after `(**` is dropped; if what remains of the opener's line is blank, that line is dropped entirely;
  2. trailing whitespace (including the final newline) before `*)` is dropped;
  3. **dedent**: the **longest common literal whitespace prefix** of the remaining lines — computed over their non-blank members, excluding the opener-line fragment when one exists (it begins mid-line after `(**` and carries no indentation) — is stripped from every line that participated in the computation.

  So when content begins on the opener's line, that fragment is exempt and every later line dedents by the later lines' common prefix; when content begins on the next line (the multi-paragraph idiom), **all** content lines participate and dedent together — the rule's exemption is for text that physically follows `(**`, never for the first line of an indented body.

The dedent rule is what makes block docs Markdown-safe: an indented `(** ... *)` would otherwise present every line as leading-whitespace-indented, and four spaces of accidental indentation is a Markdown code block. Interior tabs are the author's business (the tab rule regulates indentation, not comment interiors — Comments §4); the common prefix is literal, character by character.

### 3.2 Doc blocks

The doc comments preceding a declaration form one **doc block**: their contents concatenate in source order, joined by newlines within a contiguous `///` run, and by a blank line (paragraph break) between separate runs or forms. Ordinary comments and blank lines may sit between doc comments and between the block and its declaration without breaking anything — they are invisible to attachment, exactly as they are invisible to layout. Mixing forms is legal (a `(** *)` overview followed by a `///` note concatenates); style is the formatter's business, not this spec's.

A doc block whose extracted content is empty attaches normally and contributes empty documentation; tooling treats it as absent. Not an error — an empty doc is harmless, unlike a misplaced one (§5).

## 4. Attachment

### 4.1 The rule

> A doc block attaches to the declaration whose **first token is the next code token** after the block. If the next code token does not begin a documentable declaration (§4.2) — including when there is no next code token — the doc block is a **hard error** (§5).

One rule, no special cases, and it decides every edge by itself: a doc comment before `export fun f ...` attaches to the declaration (its first token is `export`); a doc comment *between* `export` and `fun` is an error (`fun` there does not begin a declaration — it continues one); a doc comment inside an expression (`let x = (** d *) 2`) is an error; a doc comment at end of file is an error. Attachment is purely syntactic and happens in source order — module-level order-insensitivity (Declarations Preamble §7.2) reorders nothing about it.

"Code token" means a **physical** token: the layout pass's virtual tokens (VOPEN/VSEP/VCLOSE, Lexer & Layout) are invisible to attachment, exactly as doc comments are invisible to layout. A doc comment above the first `let` of an indented block therefore attaches to that `let` — the VOPEN that layout interposes does not stand between them.

### 4.2 Documentable positions

- **Module-level declarations**: `let`, `var`, `fun`; the Declarations Preamble §7.1 inventory (`record`, `union`, `type`, `constraint`, `honor`, `exception`).
- **`extern from` block items** — every item form the block admits (FFI Part 4 §2.2), because every one introduces a name: `fun` and `let` bindings, `default` bindings, `type` declarations, `enum` declarations, and `class` declarations with their `method`/`get`/`set` members. An `extern enum`'s members are documentable like union constructors.
- **Members**: a union constructor (the doc block precedes the constructor's alternative — its leading `|`, or the constructor name where no `|` precedes); a record field; a constraint member; a member implementation inside an `honor` block.
- **Block-local binders**: `let`, `var`, `fun` inside function bodies and blocks. Local docs never reach the `.d.ts` (locals are not exports); they exist for tooling (§8).

Not documentable:

- **`import` in any form**, including the effect-only `import "..."` and `extern import "..."` (FFI Part 4 §8 — it introduces no bindings). Imports introduce no API of this module; the error's message points at the module-docs deferral (§9.1), because a file-header doc above the import block is exactly what that reservation is for.
- **The `extern from` block header** — it is a container; its *items* are the documented surface. Dedicated message: §5.
- **Module-level effect statements** (Modules §8.2): an expression is not a declaration; the generic §5 error applies.

### 4.3 Leading only

A doc comment must be **leading trivia**: on its physical line, nothing but whitespace and other comments may precede it. A doc comment preceded by code on its line (`let a = 1 /// note`) is a hard error (§5). There is no trailing/right-attaching doc position in Hexagon — one attachment direction, one rule (rejection of OCaml's bidirectional attachment: §10). A multi-line block doc closing mid-line before code (`(** doc *) let x = 1`) is leading — it attaches to the declaration beginning at `let` — same as Comments §4's padding rule.

## 5. Required diagnostics

| Situation | Message (shape) |
|---|---|
| Doc block not followed by a documentable declaration (§4.1) — includes EOF, expression positions, mid-declaration positions | "documentation comment does not document anything — the next code is not a declaration. Move it directly above the declaration it describes, or make it an ordinary comment (`//` or `(* ... *)`)." |
| Doc block before an `import` (including `extern import`) | as above, appending: "imports are not documentable; module-level documentation (`//!`) is reserved but not in v1." |
| Doc block before an `extern from` block header | "documentation attaches to the items an `extern from` block introduces, not to the block — move it above the first item inside the block, or make it an ordinary comment (`//` or `(* ... *)`)." (The generic message would be false here — the header *does* begin a declaration form — so the Rewrite Rule gets its own row.) |
| Doc comment preceded by code on its line (§4.3) | "documentation comments precede what they document — move this above the declaration on its own line, or make it an ordinary comment (`//` or `(* ... *)`)." |
| Unterminated `(**` at EOF | Comments §5's unterminated-block-comment error, unchanged (the doc form is a block comment) |

Hard errors, per house rule — there is no warning tier, so the choice is error or silence, and silence loses: a doc comment that silently attaches to nothing is documentation the author wrote and no reader will ever see. Both messages name the local rewrite (the Rewrite Rule, Declarations Preamble §1.1): move it, or demote it to an ordinary comment.

## 6. Content model

Documentation content is **Markdown** (CommonMark). The compiler does not parse, validate, or transform it — content is carried opaque and emitted verbatim (§7); Markdown is the *contract with tooling*, which renders doc content as Markdown everywhere it is surfaced.

- A fenced code block with no info string defaults to Hexagon (` ``` ` = ` ```hexagon `) in every Hexagon-aware renderer; emitted JSDoc keeps the fence as written (§7.2).
- There is **no tag language**. `@param`, `@returns`, and their kin have no Hexagon meaning; a line beginning `@word` is ordinary Markdown text and passes through. Rationale: the `.d.ts` already carries every exported signature completely and honestly (Modules §4.1.1, FFI Part 7) — a hand-written `@param` row duplicates what the compiler states better, and duplicated statements drift. Deferred, not banned forever, with a revisit bar: §9.2. **But note the boundary consequence** (§7.2): "no Hexagon meaning" does not make a tag inert in the shipped artifact, because TypeScript tooling reads emitted JSDoc with its own tag vocabulary.
- There is **no intra-doc link resolution** in v1 — no OCaml `{!Vector.map}`, no Rust ``[`Vector`]``. A Markdown link is a Markdown link. Deferred: §9.2.

## 7. Emission

### 7.1 Where documentation goes

> A documented declaration emits its doc content as a **JSDoc block** (`/** ... */`) immediately preceding the corresponding declaration in **both** emitted artifacts: the readable `.js` (continuing Comments §6's preservation of item-boundary comments, in the form JavaScript tooling understands) and the generated `.d.ts` (the API surface, where every TypeScript consumer's hover reads it). Where the emitted artifact has no seat corresponding to the documented declaration, the documentation does not cross — nothing is invented to hold it.

TypeScript's own compiler behaves exactly this way (comments persist into `.js`, JSDoc into `.d.ts`), so the duplication is the ecosystem's normal, and the two artifacts serve different readers. The known seats:

- **Terms** (`let`/`fun`, exported or not, including materialized constructors): the emitted binding in `.js`; the `export declare` in `.d.ts` when exported.
- **Record fields**: the property in the emitted structural object type — JSDoc on object-type properties is where TS tooling reads field docs.
- **Union constructors**: the materialized constructor when export materializes one (FFI Part 7 §12.2). The arm of the emitted union *type* has no reliable JSDoc seat in TS tooling; constructor docs ride the constructors.
- **`type` aliases, `record`/`union` type declarations, exceptions**: the emitted type declaration in `.d.ts`.
- **Constraints and their members**: the dictionary type and its properties (FFI Part 9), when exported.
- **No seat**: `honor` blocks and their member implementations (instances are anonymous at the boundary); block-local binders (function bodies; interior comment emission is quality-of-implementation, Comments §6). Their docs are tooling-only (§8).

### 7.2 The JSDoc block

Content emits verbatim as the JSDoc body — Markdown is what TS tooling renders in JSDoc, so nothing needs translating — with exactly one sanitization: each occurrence of `*/` in doc content emits as `*\/` (the standard JSDoc escape; the emitted file must remain valid JS/TS, and this is the sequence that would end the block). Interior `(*` / `*)` pairs are inert JavaScript text and ride along. The conventional ` * ` line prefix and surrounding formatting are quality-of-implementation; the block's validity, placement, and content are normative.

(Ordinary comments face the same `*/` hazard and take the other repair — an unsafe body re-presents as a run of whole-line `//` comments, Comments §6. Doc comments cannot use that repair: a `//` run is not JSDoc, and tooling would silently drop the documentation. One emitter, two strategies, deliberately.)

**Verbatim emission makes TypeScript's tag vocabulary live at the boundary.** A doc line beginning `@deprecated` has no Hexagon meaning (§6), but the emitted JSDoc is read by TS tooling, which strikes through every downstream use site; `@internal` under `--stripInternal` removes declarations from consumers' view. Hexagon neither validates, suppresses, nor blesses this in v1: content passes through, and what boundary tooling does with it is boundary tooling's contract, not this spec's. Named here so the hole is a recorded decision rather than a surprise; the tag-language ruling (§9.2) inherits the question of whether to adopt, escape, or ignore the accidental tags.

### 7.3 Coexistence with generated documentation

The emitter already generates documentation of its own: the union representation-cliff warning (FFI Part 7 §4.1, Unions §6.2). Where a declaration carries both user documentation and generated documentation, they emit as **one** JSDoc block — user content first, generated content after a blank line — because TS tooling attaches only the immediately preceding JSDoc block, and two blocks would silently drop one. Edit note to FFI Part 7: §13.

## 8. Tooling *(non-normative)*

The language server surfaces doc content, rendered as Markdown, in hover (shipped in LSP slice 1) and completion detail — for every documentable position, including the locals and `honor` members that never reach the `.d.ts`. This is the in-repo consumer that makes local docs worth attaching. The Comments §12 doctrine was written for this moment: shipped-source comments that meet its manual-facing standard upgrade to `///` mechanically; the sweep doing so is follow-up work (§14), gated on this spec, not gating it.

## 9. Reserved and deferred

### 9.1 Inner docs, newly reserved

**`//!`** (line) and **`(*!`** (block) are **reserved for inner documentation** — docs that describe the enclosing module rather than the following declaration (Rust's form). In v1 both lex as ordinary comments, exactly as `///` did before this ruling; the reservation exists for the same reason that one did — so that activating them later changes the meaning of nothing written today, rather than retroactively converting comments that happen to start with `!`. Module docs are the one documented-surface gap this spec leaves: a file's manual-facing description has no home until the inner-doc spec lands. Revisit bar: the first stdlib module whose manual entry needs prose that belongs to no single declaration.

### 9.2 Deferred with bars

| Deferral | Revisit bar |
|---|---|
| Tag language (`@param`-style structured fields) | field evidence that free Markdown fails a real manual need the signature doesn't cover — deprecation is the likely first case, sharpened by the fact that `@deprecated` already functions at the boundary accidentally (§7.2); the ruling must bless, escape, or suppress the passthrough |
| Intra-doc links (resolve `[Vector.map]` to a definition) | the rendered-manual pipeline — links pay when there is a target to render |
| Parameter docs (per-parameter attachment) | with the tag language; same evidence |
| Doc-content linting (dangling references, stale fences) | tooling territory; never a compiler error |

## 10. Rejected alternatives (do not re-litigate)

- **Trailing docs** (OCaml: a doc comment after an item can attach backward). OCaml's attachment is bidirectional and famously ambiguous — a doc comment between two items can bind to either, and odoc documents heuristics for it. One direction, one rule; a trailing annotation is `//`.
- **Silently-inert misplaced docs** (Rust pre-1.0, JS ecosystems: a dangling doc comment is just a comment). The footgun this spec's errors exist to kill: the author wrote documentation and nothing will ever show it. With no warning tier, silence was the only alternative to an error, and silence is the footgun.
- **F# XML doc comments** (`/// <summary>…</summary>`). The posture is F#-with-Fable, but XML lost: the target ecosystem's doc surface (JSDoc, TS hover, Markdown renderers) is Markdown-native, XML docs are boilerplate-heavy for the senior-TS audience, and F#'s own tooling accepts plain-Markdown `///` content in practice.
- **A `@`-tag DSL in v1** (JSDoc/javadoc style). Duplicates the honest `.d.ts` signature by hand; drifts. §6's rationale, §9.2's bar.
- **`(***` and `////` as doc forms**. Banner and ruler lines (`(********)`, `//////////`) would silently become documentation. OCaml and Rust both carved these out for the same reason; Hexagon inherits both carve-outs.
- **Activating only one form** (`///` alone, or `(** *)` alone). The reservation promised both; the line/block pair mirrors the ordinary-comment pair; and each covers real ground the other doesn't (one-line member docs vs. multi-paragraph overviews with code examples).
- **Emitting docs to the `.d.ts` only** (keep the `.js` clean). Breaks the readable-JS doctrine — the `.js` is a presentation of the source, and Comments §6 already preserves item-boundary comments there; demoting exactly the *documentation* comments would preserve the trivia and drop the substance. TS precedent emits both.
- **Doc comments as parser tokens** (attachment in the grammar). Would make a comment affect the token sequence, crossing the line Lexer §7 draws; attachment works on trivia-annotated declarations and the two errors are parse-time checks, not grammar productions.
- **Blank-line-sensitive attachment** (a blank line between doc and declaration detaches it, haiku-style). Turns invisible whitespace into a semantic switch and makes reformatting change what a doc documents; the errors in §5 catch real mistakes instead.

## 11. Acceptance tests

Each snippet is its own source file. Golden: attachment table (declaration → doc content), diagnostics, emitted JSDoc.

```
/// Doubles a number.
fun double(x: Int): Int = x * 2          -- attaches; .js and .d.ts (if exported) carry /** Doubles a number. */

/// Line one.
/// Line two.
export fun f(x: Int): Int = x            -- one block, content "Line one.\nLine two."; attaches through `export`

(** Overview paragraph.

    Indented continuation dedents.  *)
fun g(): Unit = ()                       -- block content dedented; blank line preserved as paragraph break

(** Overview. *)
// ordinary note in between
/// Addendum.
fun h(): Unit = ()                       -- one doc block: "Overview.\n\nAddendum."; ordinary comment invisible

union Shape =
  /// A circle of the given radius.
  | Circle(radius: Float)
  /// An axis-aligned box.
  | Box(w: Float, h: Float)              -- constructor docs; ride materialized constructors on export

//// banner ////                         -- ordinary comment; attaches nothing, may dangle freely
(**********)                             -- ordinary comment (`(***` rule)
(**)                                     -- ordinary empty comment, unchanged
(** *bold* *)
let k = 1                                -- doc content "*bold*" (space-first idiom for leading `*`)

let a = 1 /// note                       -- ERROR: doc comments precede what they document (leading-only, §4.3)
/// Orphaned.                            -- ERROR at EOF: documents nothing (§5)
let x = (** inline? *) 2                 -- ERROR: next code token does not begin a declaration
/// Module header?
import Vector                            -- ERROR: imports not documentable; message names the `//!` deferral
/// The filesystem module.
extern from "node:fs"                    -- ERROR: docs attach to the block's items, not the block (§5's dedicated row)
  fun readFileSync(path: String): String
export (** misplaced *) fun m(): Unit = ()  -- ERROR: mid-declaration; `fun` does not begin the declaration
//! future inner doc                     -- ordinary comment in v1 (reserved, §9.1)
```

## 12. Decisions log

| Decision | Where |
|---|---|
| `///` and `(** *)` activate in v1; docs are metadata; both forms, one pair | §1 |
| Recognition: exactly `///` (`////…` ordinary); `(**` + non-`)`-non-`*` (`(***…`, `(**)` ordinary) — reservation predicate tightened | §2 |
| Content extraction: one-space strip (line); dedent by longest common literal prefix (block) | §3.1 |
| Doc blocks merge across forms and runs; blanks and ordinary comments invisible; empty docs legal | §3.2 |
| Attachment: next-code-token-begins-declaration, one rule; leading-only; syntactic, order-insensitivity-independent | §4 |
| Documentable: module-level inventory + every `extern from` item form (`fun`/`let`/`default`/`type`/`enum`/`class` and members; enum members like constructors) + union constructors + record fields + constraint members + honor members + local binders; not `import`/`extern import`, not the `extern from` header, not module-level effects | §4.2 |
| Dangling and trailing doc comments are hard errors with Rewrite-Rule redirects; the `extern from` header gets its own message | §5 |
| Verbatim emission makes TS's tag vocabulary live at the boundary — recorded, neither validated nor suppressed; the tag-language ruling inherits it | §6, §7.2, §9.2 |
| Content is CommonMark, carried opaque; bare fences default to Hexagon; no tags, no link resolution in v1 | §6 |
| Emission: JSDoc in both `.js` and `.d.ts` at every corresponding seat; `*/` → `*\/`; no seat → tooling-only | §7 |
| User + generated docs merge into one JSDoc block, user first | §7.3 |
| `//!` and `(*!` newly reserved for inner docs; module docs deferred with a named bar | §9.1 |
| Tag language, intra-doc links, parameter docs deferred with bars | §9.2 |
| Rejected: trailing docs, silent danglers, XML docs, v1 tag DSL, banner forms as docs, single-form activation, `.d.ts`-only emission, docs-as-tokens, blank-line detachment | §10 |

## 13. Edit notes to existing specs

Applied in this ruling's PR (direct edits):

| Target | Edit |
|---|---|
| `comments.md` | §1 table's reserved rows become active pointers here; §2's `///` bullet and §3's `(**)` bullet gain the tightened predicates; §6's horizon bullet discharged and its `//`-run repair cross-cites §7.2's escape; §8's `/// still just a comment in v1` line superseded in place (now the §4.3 error); §9 log updated; §12's mechanical-upgrade sentence now cites this spec; new **§13 correction record** itemizing what activation supersedes. Scope header updated. |
| `lexer.md` | §7 gains the doc-trivia bullet (doc comments are distinguished trivia whose content and position are retained and delivered to the parser; recognition predicates owned here); "Not in scope" line's doc-comment deferral now points at this spec. |
| `README.md` | Ownership row for `doc-comments.md`; Parser and Emitter reading sets gain it. |
| `decisions-ml-dialect-comments-2026-07.md` | §5 annotated: reservation activated by #191; predicate tightened here. |
| Book: `chapters/05-layout.md` (+ `DRAFT-3.md` rebuild), `FEATURES.md`, `plans/05-layout.md`, `CONTINUITY.md` | Every reservation-era passage re-taught as active *(the plans and continuity files were the cold review's finding 6)*. |

Owed (README rule 4 — applied on next touch of the target):

- **FFI Part 7 §4.1 / §10**: the representation-cliff warning coexists with user docs per §7.3 (one JSDoc block, user content first). The warning's own text and obligation are unchanged.
- **Unions §6.2**: same coexistence note where the cliff warning's `.d.ts` placement is mentioned.
- **FFI Part 7 §2.1**: the `.d.ts` structure sketch may note JSDoc placement; no rule changes.

## 14. Implementation notes (follow-up work, not this PR)

- **hexc lexer** (`compiler/src/passes/lexer/lexer.ts`): distinguish doc trivia at the opener (§2's predicates); retain content and span. The existing comment-trivia channel already retains text (Comments §6's emission uses it); doc trivia adds the classification, not a new channel.
- **hexc parser**: attach doc blocks to declarations per §4; the two §5 errors. Extraction and dedent (§3.1) at attachment time.
- **hexc emitter**: JSDoc emission per §7 into both artifacts; the `*/` escape; the §7.3 merge with the cliff warning.
- **TextMate grammar**: the doc scopes **already exist and are already themed** (`comment.block.documentation.hexagon` / `comment.line.documentation.hexagon`, `hexagon.tmLanguage.json`; coloured in both themes and Playground's map) — established at the cold review; an earlier draft of this bullet wrongly listed creating them as the work. The actual work is **tightening the recognition patterns to §2's predicates**, because the grammar today over-matches in exactly two ways, both now conformance bugs against §2.1/§2.3: the block-doc opener needs to exclude a following `*` as well as `)` (today `(*** banner ***)` paints as documentation) and the line-doc match needs `(?!/)` after `///` (today `//// banner` paints as documentation). The grammar's inline annotation asserting the old reservation-era predicate goes stale in the same pass, and both fixes need pinning in `grammar.test.ts` — no existing test catches either. The `(?!\*)` guard family from #171's notes keys on `(*` and is unaffected.
- **VS Code configuration**: `onEnterRules` already treat `(**` as the doc opener with `(**)` excluded (#171 §11); verify the continuation behaviour against §2.3's `(***` carve-out.
- **LSP**: hover carries attached doc content as Markdown (slice 1's hover path).
- **Stdlib sweep**: a follow-up issue — upgrade Comments-§12-compliant manual-facing comments to `///` where the comment documents the following declaration. Not mechanical-only (each upgrade asserts "this is manual prose"); a fresh-session task after the compiler work lands.
- **Conformance**: §11's snippets as attachment/diagnostic/emission goldens.
