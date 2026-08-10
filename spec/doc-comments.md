# Hexagon Spec: Documentation Comments

**Status:** Decided (August 2026). Ruled on issue #191 (James's directive, given in-session 2026-08-01): the doc-comment block form reserved since Comments §1 — `(** ... *)` — is **active in v1**, and it is the **only** documentation form: the `///` reservation is **revoked**, not activated (§2.3, §10; James's narrowing directive, same day, during the PR #192 review round). This document is the "future documentation spec" that Comments §5/§6 and Lexer §7 have been deferring to; with it, that horizon is discharged.
**Scope:** Recognition of the doc form (§2), including the `///` revocation; content extraction and doc blocks (§3); attachment (§4); the new hard errors (§5); the content model (§6); emission as JSDoc into the readable JS and the `.d.ts` (§7); tooling surface (§8); reservations and deferrals (§9); rejected alternatives (§10).
**Not in scope:** Ordinary comment lexing, nesting, layout interaction, and the JS-spelling redirects — Comments owns all of it, unchanged. A doc *tag* language (`@param`-style), intra-doc link resolution, parameter docs, and module-level (inner) docs — deferred with revisit bars, §9. A rendered-manual pipeline (HTML docs generator) — post-v1 tooling; this spec fixes what such a tool consumes, not the tool.
**Companions:** Comments (host of the comment forms; correction record §13 there records what activation and the revocation supersede), Lexer §7 (doc trivia), Declarations Preamble §7.1 (the declaration inventory §4 quantifies over), Modules §4 (`export`; complete-signature rule §4.1.1), FFI Part 7 (the `.d.ts` §7 emits into), `decisions-ml-dialect-comments-2026-07.md` §5 (the reservation this activates and narrows).

---

## 1. The ruling

> **`(** ... *)` is the documentation comment.** A **doc block** — one or more doc comments immediately preceding a declaration — attaches to that declaration as its documentation. Documentation is **metadata, not semantics**: it changes no type, no value, no emitted *code* (changing emitted *comments* is its job — §7). It is carried to tooling, and it emits as **JSDoc** on the corresponding declarations in the generated JavaScript and `.d.ts` — the payoff Comments §6 has promised since the reservation was made. **There is no line documentation form**: `///` has no special status of any kind — it is `//` followed by comment text that begins with `/` (§2.3).

Activation is the non-breaking upgrade the reservation was designed to be: no shipped `.hex` source, conformance snippet, or corpus example contains `(**` (verified at ruling time), and a doc comment still lexes as trivia — layout, the token sequence, and every rule of Comments §2–§4 are untouched. What activation adds is recognition (§2), attachment (§4), the §5 hard errors for doc comments that document nothing, and emission (§7). The `///` revocation is even more strongly non-breaking: it makes the language do *less* than the reservation contemplated, and exactly what every `///` comment already did.

One form, whole. Documentation in Hexagon has a single spelling, in the corpus's one-spelling tradition (Operators §1.2 is its sharpest statement); a one-line doc and a ten-paragraph doc are the same form at different lengths. The spelling is OCaml's — and OCaml itself documents with `(** *)` alone, so the ML lineage is intact without a line form.

**The design target is JSDoc, recreated on Hexagon's surface** (James's directive, stated with the ruling). JSDoc has exactly one comment form; everything it can express — including specializations this spec defers, like module-level docs — is content or position *within* that form, never a new spelling. Hexagon mirrors that structure: **`(** *)` is the entirety of Hexagon's documentation syntax, and this spec reserves no further comment spellings** (§9.1). Future capability arrives as content-level rulings (tags, positions — §9.2), not as delimiters.

## 2. Recognition

### 2.1 The form

A block comment is a **doc comment** when it begins with `(**` followed by a character that is neither `)` nor `*`. Its body is scanned exactly as an ordinary block comment's — `(*` pushes depth, `*)` pops, strings are not lexed inside it — and it ends when depth returns to zero. Everything Comments §3 says about block comments (nesting, string non-interaction, the unterminated and unmatched errors, innermost-opener reporting) holds of the doc form verbatim; the doc opener differs from the ordinary opener only in what the trivia is *for*.

### 2.2 What stays ordinary

| Spelling | Status | Why |
|---|---|---|
| `(**)` | empty ordinary comment | already pinned at reservation time (Comments §3); recognition requires a character after `(**` |
| `(***`, `(****…` | ordinary comment | OCaml's rule; `(********)` rulers and decorative banners never become documentation. A doc comment whose content must *begin* with `*` writes a space first: `(** *bold* *)`. |

The reservation's recognition predicate said "at least one character that is not `)`" (Comments §3; ruling §5); activation **tightens** it by also excluding `*`. A compatible refinement — before activation everything lexed as an ordinary comment, so no meaning changes — recorded in Comments' correction record (§13 there).

### 2.3 `///` is nothing

The reservation of `///` as a future doc form (Comments §1, held through #171) is **revoked, unspent**. `///` receives no lexer handling, no recognition rule, no reserved status: it is a `//` line comment whose text happens to begin with `/`, and so is `////`, and so on. The lexer does not count slashes. The grounds are §10's rejected-alternatives entry (in brief: to Hexagon's audience `///` has no documentation meaning and an actively *conflicting* TypeScript meaning); this section exists so the revocation is recorded once, here — the rest of the corpus simply stops mentioning `///`.

## 3. Content

### 3.1 Extraction

Documentation content is the body between `(**` and its matching `*)`, processed in order:

1. one leading space after `(**` is dropped; if what remains of the opener's line is blank, that line is dropped entirely;
2. trailing whitespace (including the final newline) before `*)` is dropped;
3. **dedent**: the **longest common literal whitespace prefix** of the remaining lines — computed over their non-blank members, excluding the opener-line fragment when one exists (it begins mid-line after `(**` and carries no indentation) — is stripped from every line that participated in the computation.

So when content begins on the opener's line, that fragment is exempt and every later line dedents by the later lines' common prefix; when content begins on the next line (the multi-paragraph idiom), **all** content lines participate and dedent together — the rule's exemption is for text that physically follows `(**`, never for the first line of an indented body.

The dedent rule is what makes doc comments Markdown-safe: an indented `(** ... *)` would otherwise present every line as leading-whitespace-indented, and four spaces of accidental indentation is a Markdown code block. Interior tabs are the author's business (the tab rule regulates indentation, not comment interiors — Comments §4); the common prefix is literal, character by character.

### 3.2 Doc blocks

The doc comments preceding a declaration form one **doc block**: their contents concatenate in source order, joined by a blank line (paragraph break). Ordinary comments and blank lines may sit between doc comments and between the block and its declaration without breaking anything — they are invisible to attachment, exactly as they are invisible to layout. Whether to write one `(** *)` with paragraphs inside or several in a row is style — the formatter's business, not this spec's.

A doc block whose extracted content is empty attaches normally and contributes empty documentation; tooling treats it as absent. Not an error — an empty doc is harmless, unlike a misplaced one (§5).

## 4. Attachment

### 4.1 The rule

> A doc block attaches to the declaration whose **first token is the next code token** after the block. If the next code token does not begin a documentable declaration (§4.2) — including when there is no next code token — the doc block is a **hard error** (§5).

One rule, no special cases, and it decides every edge by itself: a doc comment before `export fun f ...` attaches to the declaration (its first token is `export`); a doc comment *between* `export` and `fun` is an error (`fun` there does not begin a declaration — it continues one); a doc comment inside an expression (`let x = (** d *) 2`) is an error; a doc comment at end of file is an error. Attachment is purely syntactic and happens in source order — module-level order-insensitivity (Declarations Preamble §7.2) reorders nothing about it.

"Code token" means a **physical** token: the layout pass's virtual tokens (VOPEN/VSEP/VCLOSE, Lexer & Layout) are invisible to attachment, exactly as doc comments are invisible to layout. A doc comment above the first `let` of an indented block therefore attaches to that `let` — the VOPEN that layout interposes does not stand between them.

### 4.2 Documentable positions

- **Module-level declarations**: `let`, `var`, `fun`; the Declarations Preamble §7.1 inventory (`record`, `union`, `type`, `constraint`, `honor`, `exception`).
- **`extern from` block items** — every item form the block admits (FFI Part 4 §2.2), because every one introduces a name: `fun` and `let` bindings, `default` bindings, `type` declarations, `enum` declarations, `class` declarations, and `method`/`get`/`set` items — the latter documentable **wherever they appear**, standalone in the block or grouped in an `extern class` (FFI Part 5 §5 governs both positions). An `extern enum`'s members are documentable like union constructors.
- **Members**: a union constructor (the doc block precedes the constructor's alternative — its leading `|`, or the constructor name where no `|` precedes); a record field; a constraint member — the `type` members among them, which Collections Part 2 §5.1 places among the ordinary members; a member implementation inside an `honor` block — the implied-type bindings (`type Item = a`) among them, which are the type members' implementations (Part 2 §5.3).
- **Block-local binders**: `let`, `var`, `fun` inside function bodies and blocks. Local docs never reach the `.d.ts` (locals are not exports); they exist for tooling (§8).

Not documentable:

- **`import` in any form**, including the effect-only `import "..."` and `extern import "..."` (FFI Part 4 §8 — it introduces no bindings). Imports introduce no API of this module; the error's message points at the module-docs deferral (§9.1), because a file-header doc above the import block is exactly that deferral's territory.
- **The `extern from` block header** — it is a container; its *items* are the documented surface. Dedicated message: §5.
- **Module-level effect statements** (Modules §8.2): an expression is not a declaration; the generic §5 error applies.

### 4.3 Leading only

A doc comment must be **leading trivia**: on its physical line, nothing but whitespace and other comments may precede it. A doc comment preceded by code on its line (`let a = 1 (** note *)`) is a hard error (§5). There is no trailing/right-attaching doc position in Hexagon — one attachment direction, one rule (rejection of OCaml's bidirectional attachment: §10). A multi-line doc comment closing mid-line before code (`(** doc *) let x = 1`) is leading — it attaches to the declaration beginning at `let` — same as Comments §4's padding rule.

## 5. Required diagnostics

| Situation | Message (shape) |
|---|---|
| Doc block not followed by a documentable declaration (§4.1) — includes EOF, expression positions, mid-declaration positions | "documentation comment does not document anything — the next code is not a declaration. Move it directly above the declaration it describes, or make it an ordinary comment (`(* ... *)`)." |
| Doc block before an `import` (including `extern import`) | as above, appending: "imports are not documentable; module-level documentation is not in v1." |
| Doc block before an `extern from` block header | "documentation attaches to the items an `extern from` block introduces, not to the block — move it above the first item inside the block, or make it an ordinary comment (`(* ... *)`)." (The generic message would be false here — the header *does* begin a declaration form — so the Rewrite Rule gets its own row.) |
| Doc comment preceded by code on its line (§4.3) | "documentation comments precede what they document — move this above the declaration on its own line, or make it an ordinary comment (`(* ... *)`)." |
| Unterminated `(**` at EOF | Comments §5's unterminated-block-comment error, unchanged (the doc form is a block comment) |

Hard errors, per house rule — there is no warning tier, so the choice is error or silence, and silence loses: a doc comment that silently attaches to nothing is documentation the author wrote and no reader will ever see. Every message names the local rewrite (the Rewrite Rule, Declarations Preamble §1.1): move it, or demote it to an ordinary comment.

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
- **Constraints and their members**: the dictionary type and its properties (FFI Part 9), when exported. A `type` member is the member with no property — an instance's choice is a type, and types are gone before the boundary — so its documentation does not cross; tooling-only (§8).
- **No seat**: `honor` blocks and their member implementations (instances are anonymous at the boundary); block-local binders (function bodies; interior comment emission is quality-of-implementation, Comments §6). Their docs are tooling-only (§8).

### 7.2 The JSDoc block

Content emits verbatim as the JSDoc body — Markdown is what TS tooling renders in JSDoc, so nothing needs translating — with exactly one sanitization: each occurrence of `*/` in doc content emits as `*\/` (the standard JSDoc escape; the emitted file must remain valid JS/TS, and this is the sequence that would end the block). Interior `(*` / `*)` pairs are inert JavaScript text and ride along. The conventional ` * ` line prefix and surrounding formatting are quality-of-implementation; the block's validity, placement, and content are normative.

(Ordinary comments face the same `*/` hazard and take the other repair — an unsafe body re-presents as a run of whole-line `//` comments, Comments §6. Doc comments cannot use that repair: a `//` run is not JSDoc, and tooling would silently drop the documentation. One emitter, two strategies, deliberately.)

**Verbatim emission makes TypeScript's tag vocabulary live at the boundary.** A doc line beginning `@deprecated` has no Hexagon meaning (§6), but the emitted JSDoc is read by TS tooling, which strikes through every downstream use site; `@internal` under `--stripInternal` removes declarations from consumers' view. Hexagon neither validates, suppresses, nor blesses this in v1: content passes through, and what boundary tooling does with it is boundary tooling's contract, not this spec's. Named here so the hole is a recorded decision rather than a surprise; the tag-language ruling (§9.2) inherits the question of whether to adopt, escape, or ignore the accidental tags.

### 7.3 Coexistence with generated documentation

The emitter already generates documentation of its own: the union representation-cliff warning (FFI Part 7 §4.1, Unions §6.2). Where a declaration carries both user documentation and generated documentation, they emit as **one** JSDoc block — user content first, generated content after a blank line — because TS tooling attaches only the immediately preceding JSDoc block, and two blocks would silently drop one. Edit note to FFI Part 7: §13.

## 8. Tooling *(non-normative)*

The language server surfaces doc content, rendered as Markdown, in hover (shipped in LSP slice 1) and completion detail — for every documentable position, including the locals and `honor` members that never reach the `.d.ts`. This is the in-repo consumer that makes local docs worth attaching. The Comments §12 doctrine was written for this moment: shipped-source comments that meet its manual-facing standard upgrade to `(** *)` mechanically; the sweep doing so is follow-up work (§14), gated on this spec, not gating it.

## 9. Reserved and deferred

### 9.1 Module-level docs, deferred — with no reserved spelling

JSDoc — the design target (§1) — has module-level documentation, and has it **without a dedicated comment syntax**: a module doc is the same `/** */` block, distinguished by a tag or its position (`@module`, `@fileoverview`; in the TS world, TSDoc's `@packageDocumentation` as a file's first block). Hexagon mirrors that structure: if module docs come, they arrive as a content/position ruling *within* `(** *)` — most plausibly alongside the tag language (§9.2) — and **no new comment spelling is reserved for them**. (An intermediate draft of this ruling reserved `(*!`, Rust's inner-doc model; dropped on James's direction — §10.) Module docs are the one documented-surface gap this spec leaves: a file's manual-facing description has no home until that ruling lands. Named cost, accepted eyes-open (the verification round's finding): a doc block in a file's head position is a **hard error** today (§5), so the eventual ruling must carve a positional exception into §4.1's "one rule, no special cases" — an exception a distinct reserved spelling would have made unnecessary, since a new delimiter carries its own attachment rule. Weighed against a standing hole in "one form, whole" (§10), the exception is the cheaper debt: it is paid once, by the ruling that needs it, if one is ever needed. Revisit bar: the first stdlib module whose manual entry needs prose that belongs to no single declaration.

### 9.2 Deferred with bars

| Deferral | Revisit bar |
|---|---|
| Tag language (`@param`-style structured fields) | field evidence that free Markdown fails a real manual need the signature doesn't cover — deprecation is the likely first case, sharpened by the fact that `@deprecated` already functions at the boundary accidentally (§7.2); the ruling must bless, escape, or suppress the passthrough |
| Intra-doc links (resolve `[Vector.map]` to a definition) | the rendered-manual pipeline — links pay when there is a target to render |
| Parameter docs (per-parameter attachment) | with the tag language; same evidence |
| Doc-content linting (dangling references, stale fences) | tooling territory; never a compiler error |

## 10. Rejected alternatives (do not re-litigate)

- **`///` as a doc form — the reservation is revoked, not activated** (James's directive, 2026-08-01, narrowing the initial both-forms draft during the #192 review). Three grounds. *Audience:* Hexagon's target reader lives in TypeScript, where documentation is JSDoc (`/** */`) and `///` is never surfaced as docs by any tooling — worse, `///` already means something else there: triple-slash directives (`/// <reference ... />`), compiler instructions, honoured only in a file's preamble — exactly where a header doc would sit, so the collision lands on the likeliest real use. To that reader `///` as docs is at best unfamiliar and at worst a false friend; the doc-comment intuition for `///` comes from C#, F#, and Rust, none of which is where this audience lives. *One-spelling doctrine:* two doc spellings for one meaning is what Operators §1.2 exists to prevent; the initial draft's "line/block pair" framing understated that both forms would carry identical semantics. *Precedent:* OCaml — the source of the `(**` spelling — documents with the block form alone, and JSDoc, the design target (§1), has one comment form for everything. F#'s `///` heritage was the counterweight and lost. Consequence: `///` has **no special status at all** — not reserved, not recognized, not counted; `//` followed by a `/` is comment text (§2.3). **The residual footgun is accepted, eyes open**: an F# author who writes `/// Doubles.` has written a legal ordinary comment that attaches nothing, and no diagnostic fires — this is *not* an exception to the silently-inert-docs rejection below, because that rejection governs Hexagon's doc form, and `///` is not one; a redirect on a legal comment would be warning-shaped, and no warning tier exists (the same ground that made §5's misplaced-doc cases *errors*). The behaviour is pinned by acceptance test (§11; Comments §8) so it stays chosen rather than accidental.
- **Trailing docs** (OCaml: a doc comment after an item can attach backward). OCaml's attachment is bidirectional and famously ambiguous — a doc comment between two items can bind to either, and odoc documents heuristics for it. One direction, one rule; a trailing annotation is an ordinary comment.
- **Silently-inert misplaced docs** (Rust pre-1.0, JS ecosystems: a dangling doc comment is just a comment). The footgun this spec's errors exist to kill: the author wrote documentation and nothing will ever show it. With no warning tier, silence was the only alternative to an error, and silence is the footgun.
- **F# XML doc comments** (`<summary>…</summary>` content). The posture is F#-with-Fable, but XML lost: the target ecosystem's doc surface (JSDoc, TS hover, Markdown renderers) is Markdown-native, and XML docs are boilerplate-heavy for the senior-TS audience.
- **A `@`-tag DSL in v1** (JSDoc/javadoc style). Duplicates the honest `.d.ts` signature by hand; drifts. §6's rationale, §9.2's bar.
- **`(***` as a doc form**. Banner and ruler lines (`(********)`) would silently become documentation. OCaml carved this out for the same reason; Hexagon inherits the carve-out.
- **Reserving an inner-doc spelling** (`(*!` / `//!`, Rust's model — an intermediate draft of this ruling reserved `(*!`). The design target settles it (§1): JSDoc expresses module docs *inside* its one comment form, by tag and position, so a second spelling buys nothing the eventual mechanism would use — and an idle reservation is not free; it is a standing hole in "one form, whole". Dropped on James's direction; §9.1 keeps the module-docs deferral without it, and records the accepted cost (the eventual ruling carves a positional exception into §4.1, which a distinct spelling would have avoided).
- **Emitting docs to the `.d.ts` only** (keep the `.js` clean). Breaks the readable-JS doctrine — the `.js` is a presentation of the source, and Comments §6 already preserves item-boundary comments there; demoting exactly the *documentation* comments would preserve the trivia and drop the substance. TS precedent emits both.
- **Doc comments as parser tokens** (attachment in the grammar). Would make a comment affect the token sequence, crossing the line Lexer §7 draws; attachment works on trivia-annotated declarations and the two errors are parse-time checks, not grammar productions.
- **Blank-line-sensitive attachment** (a blank line between doc and declaration detaches it, haiku-style). Turns invisible whitespace into a semantic switch and makes reformatting change what a doc documents; the errors in §5 catch real mistakes instead.

## 11. Acceptance tests

Each snippet is its own source file. Golden: attachment table (declaration → doc content), diagnostics, emitted JSDoc.

```
(** Doubles a number. *)
fun double(x: Int): Int = x * 2          -- attaches; .js and .d.ts (if exported) carry /** Doubles a number. */

(** Line one. *)
(** Line two. *)
export fun f(x: Int): Int = x            -- one block, content "Line one.\n\nLine two."; attaches through `export`

(** Overview paragraph.

    Indented continuation dedents.  *)
fun g(): Unit = ()                       -- content dedented; blank line preserved as paragraph break

(**
    A newline-first body: every content line
    participates in the dedent together.
*)
fun g2(): Unit = ()                      -- no opener-line fragment, so all lines strip their common prefix

(** Overview. *)
// ordinary note in between
(** Addendum. *)
fun h(): Unit = ()                       -- one doc block: "Overview.\n\nAddendum."; ordinary comment invisible

union Shape =
  (** A circle of the given radius. *)
  | Circle(radius: Float)
  (** An axis-aligned box. *)
  | Box(w: Float, h: Float)              -- constructor docs; ride materialized constructors on export

constraint Keyed<c> =
    (** The type of one key, chosen by each instance. *)
    type Key
    (** The key of `x`. *)
    keyOf(x: c): Key                     -- constraint-member docs: type members and function members alike (§4.2)

honor Keyed<Int> =
    (** An `Int` keys itself. *)
    type Key = Int
    keyOf(x) = x                         -- implied-type-binding docs; honor seats are tooling-only (§7.1)

/// not documentation
fun plain(): Unit = ()                   -- OK; `plain` carries NO docs — `///` is an ordinary `//` comment (§2.3)
(**********)                             -- ordinary comment (`(***` rule)
(**)                                     -- ordinary empty comment, unchanged
(** *bold* *)
let k = 1                                -- doc content "*bold*" (space-first idiom for leading `*`)

let a = 1 (** note *)                    -- ERROR: doc comments precede what they document (leading-only, §4.3)
(** Orphaned. *)                         -- ERROR at EOF: documents nothing (§5)
let x = (** inline? *) 2                 -- ERROR: next code token does not begin a declaration
(** Module header? *)
import Vector                            -- ERROR: imports not documentable; message names the module-docs deferral
(** The filesystem module. *)
extern from "node:fs"                    -- ERROR: docs attach to the block's items, not the block (§5's dedicated row)
  fun readFileSync(path: String): String
export (** misplaced *) fun m(): Unit = ()  -- ERROR: mid-declaration; `fun` does not begin the declaration
(*! not special *)                       -- ordinary comment; no inner-doc spelling exists or is reserved (§9.1)
```

## 12. Decisions log

| Decision | Where |
|---|---|
| `(** *)` activates in v1 as the **only** doc form; docs are metadata; one spelling | §1 |
| **The design target is JSDoc**: one comment form carries everything; future capability is content/position within it, never new delimiters; no further comment spelling is ever reserved | §1, §9.1 |
| `///` reservation **revoked, unspent** — no handling, no status; `//` then `/` is comment text; the F#-author footgun accepted eyes-open and pinned | §2.3, §10 |
| Recognition: `(**` + a character that is neither `)` nor `*` (`(***…`, `(**)` ordinary) — reservation predicate tightened | §2 |
| Content extraction: ordered procedure; dedent by longest common literal prefix, opener-line fragment exempt only when it exists | §3.1 |
| Doc blocks merge across runs; blanks and ordinary comments invisible; empty docs legal | §3.2 |
| Attachment: next-code-token-begins-declaration, one rule over physical tokens (virtual tokens invisible); leading-only; syntactic | §4 |
| Documentable: module-level inventory + every `extern from` item form (`fun`/`let`/`default`/`type`/`enum`/`class` and members; enum members like constructors) + union constructors + record fields + constraint members (`type` members among them) + honor members (implied-type bindings among them) + local binders; not `import`/`extern import`, not the `extern from` header, not module-level effects | §4.2 |
| Dangling and trailing doc comments are hard errors with Rewrite-Rule redirects; the `extern from` header gets its own message | §5 |
| Content is CommonMark, carried opaque; bare fences default to Hexagon; no tags, no link resolution in v1 | §6 |
| Emission: JSDoc in both `.js` and `.d.ts` at every corresponding seat; `*/` → `*\/`; no seat → tooling-only | §7 |
| Verbatim emission makes TS's tag vocabulary live at the boundary — recorded, neither validated nor suppressed; the tag-language ruling inherits it | §6, §7.2, §9.2 |
| User + generated docs merge into one JSDoc block, user first | §7.3 |
| Module docs deferred with a named bar and **no reserved spelling** (JSDoc expresses them within the one form) | §9.1 |
| Tag language, intra-doc links, parameter docs deferred with bars | §9.2 |
| Rejected: `///` in any doc role, inner-doc spellings (`(*!`/`//!`), trailing docs, silent danglers, XML docs, v1 tag DSL, `(***` as doc, `.d.ts`-only emission, docs-as-tokens, blank-line detachment | §10 |

## 13. Edit notes to existing specs

Applied in this ruling's PR (direct edits):

| Target | Edit |
|---|---|
| `comments.md` | §1 table: `(** *)` row becomes an active pointer here; `///` row's reservation revoked in place. §2's `///` bullet superseded (revocation); §3's `(**)` bullet gains the tightened predicate; §6's horizon bullet discharged and its `//`-run repair cross-cites §7.2's escape; §8's `/// still just a comment` line re-annotated **permanent**; §9 log updated; §12's mechanical-upgrade sentence now cites this spec; **§13 correction record** itemizing what activation and the revocation supersede. Scope header updated. |
| `lexer.md` | §7 gains the doc-trivia bullet (`(**` doc comments are distinguished trivia whose content and position are retained and delivered to the parser; recognition predicate owned here; `///` nothing); "Not in scope" line's doc-comment deferral now points at this spec. |
| `README.md` | Ownership row for `doc-comments.md`; Parser and Emitter reading sets gain it. |
| `decisions-ml-dialect-comments-2026-07.md` | §5 annotated: block reservation activated by #191, `///` reservation revoked by the same ruling; predicate tightened here. |
| Book: `chapters/05-layout.md`, `FEATURES.md`, `plans/05-layout.md`, `CONTINUITY.md` | Every reservation-era passage re-taught: `(** *)` docs active; `///` not mentioned as anything but an ordinary comment *(the plans and continuity files were the cold review's finding 6)*. |

Owed (README rule 4 — applied on next touch of the target):

- **FFI Part 7 §4.1 / §10**: the representation-cliff warning coexists with user docs per §7.3 (one JSDoc block, user content first). The warning's own text and obligation are unchanged.
- **Unions §6.2**: same coexistence note where the cliff warning's `.d.ts` placement is mentioned.
- **FFI Part 7 §2.1**: the `.d.ts` structure sketch may note JSDoc placement; no rule changes.

## 14. Implementation notes (follow-up work, not this PR)

- **hexc lexer** (`compiler/src/passes/lexer/lexer.ts`): distinguish doc trivia at the opener (§2.1's predicate); retain content and span. The existing comment-trivia channel already retains text (Comments §6's emission uses it); doc trivia adds the classification, not a new channel. **No `///` handling of any kind** — pin that with a test (a `///` comment attaches nothing and lexes as ordinary `//` trivia), so the non-handling survives future edits.
- **hexc parser**: attach doc blocks to declarations per §4; the §5 errors. Extraction and dedent (§3.1) at attachment time.
- **hexc emitter**: JSDoc emission per §7 into both artifacts; the `*/` escape; the §7.3 merge with the cliff warning.
- **TextMate grammar**: the block-doc scope already exists and is themed (`comment.block.documentation.hexagon`, `hexagon.tmLanguage.json`; coloured in both themes and Playground's map) — established at the cold review. The work is bringing the grammar to §2, and it is now **three** conformance fixes, all needing `grammar.test.ts` pins: tighten the block-doc opener to exclude a following `*` (today `(*** banner ***)` paints as documentation); **delete the line-doc rule entirely** — the grammar has a `comment.line.documentation.hexagon` rule for `///`, which under §2.3 must paint as an ordinary `//` comment (the scope's theme entries go with it); and refresh the grammar's inline annotation asserting the reservation-era predicate. The `(?!\*)` guard family from #171's notes keys on `(*` and is unaffected. *(Done 2026-08-01, issue #194: the opener is `\(\*\*(?![)*])`, the line-doc rule and its three theme entries are gone, and §2's predicate and §2.3's revocation are pinned in `grammar.test.ts`.)*
- **VS Code configuration**: `onEnterRules` already treat `(**` as the doc opener with `(**)` excluded (#171 §11); verify the continuation behaviour against §2.2's `(***` carve-out. *(Done with the grammar, #194: the openers carry the same tightened predicate — a banner no longer continues as a doc comment — and the `///` continuation rule went with the revocation.)*
- **LSP**: hover carries attached doc content as Markdown (slice 1's hover path). *(Done 2026-08-01, issue #195: hover and completion both carry it, keyed off the name a declaration introduces — recorded by the attachment alongside the target span, since an editor holds a name and §4's key is the declaration's first token. Two facts the work turned up, neither of them a change to this ruling. **Completion carries the content in the protocol's `documentation` field, not `detail`**: `detail` is a plain string beside the label, and §8's "rendered as Markdown" is only true of the other one — `detail` goes on carrying the type. And **five documentable positions have no identity in the compiler's occurrence index at all** — an `honor` member (its name is a bare string in the resolved tree), a record field (not a symbol), a `type` alias (expanded away), a constraint's `type` member and an `honor` block's implied-type binding (no occurrence walk visits an implied type's name) — so hover answers those from the documentation alone, which is the only way §8's "every documentable position" holds. Two forms introduce no single name to file a block under: a destructuring `let` is filed under *every* binder it introduces (they are ordinary symbols, but only the attachment knows which names one block covers), and an `honor` block under the constraint in its head, which is the only name it writes — so hovering that name shows the instance's documentation, and the constraint's own shows everywhere else it is written. A pattern that binds nothing at all — `let (_, _) = …` — is the one documentable position whose content reaches no reader; it names nothing to point at.)*
- **Stdlib sweep**: a follow-up issue — upgrade Comments-§12-compliant manual-facing comments to `(** *)` where the comment documents the following declaration. Not mechanical-only (each upgrade asserts "this is manual prose"); a fresh-session task after the compiler work lands.
- **Conformance**: §11's snippets as attachment/diagnostic/emission goldens, including the `///`-is-nothing pin.
