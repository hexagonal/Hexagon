# V1 Specification Consolidation Plan

**Status:** Ready to execute after the FFI closeout (July 2026). This is the staged roadmap for Fable drafting and Sol promotion.

## Operating contract for Fable

Consolidation is editorial unless a pass explicitly reports a contradiction for James and Sol to decide. These rules apply to every part:

1. **One declared target per turn.** Write only that target. The sole exception is an explicitly authorized archival move in Part 7; never make opportunistic companion edits.
2. **Search before reading.** Use file headers, indexes, status lines, decisions logs, and targeted searches first. Do not reread or summarize an entire spec merely to classify it.
3. **Do not repeat the corpus.** Tables contain pointers and short labels, not copied doctrine. Handoffs report changes and blockers, not a narrative of everything inspected.
4. **No semantic cleanup by instinct.** If two live sources disagree, record the exact files/sections and stop that issue. Do not choose the nicer rule, harmonize wording, or infer a missing decision.
5. **Preserve obligations.** Grammar, typing, runtime behavior, diagnostics, emission, ABI, acceptance requirements, active debts, and load-bearing rationale may move or gain a single owner; they may not disappear.
6. **Historical material is not an authority.** Use it to detect lost obligations, never to override a promoted normative spec.
7. **Bound the output.** Prefer one compact row per finding. No duplicated examples, no essay-length review diary, and no speculative recommendations unless a genuine gap blocks consolidation.
8. **Stop at the gate.** Finish the named part and hand it back for Sol review. Do not begin the next part, update roadmaps, archive files, or commit.

Each handoff should be at most eight bullets: target written; inputs actually used; counts of files/debts/findings; contradictions or blockers; and the next gated part. A clean pass may be shorter.

## Goal

Reduce the default specification context needed by humans and coding agents without losing normative precision or the rationale that prevents settled decisions from being repeatedly reopened.

The consolidated corpus must distinguish:

1. current normative rules;
2. current cross-spec debts and deferrals;
3. concise, load-bearing decision rationale; and
4. historical drafting material.

Only the first two belong in the default reading set. Rationale is loaded when a decision is challenged or extended. Drafting history is archival.

## Non-goals

- Do not merge the whole language into one enormous document.
- Do not redesign settled language or FFI behavior during editorial consolidation.
- Do not silently discard unresolved debts, implementation obligations, diagnostics, or acceptance requirements.
- Do not preserve obsolete prose in canonical documents merely because it records the order in which decisions were made; Git already preserves textual history.

## Target structure

```text
spec/
  README.md                 canonical index and task-specific reading sets
  language.md               compact core-language overview and ownership map
  ffi.md                    FFI index and shared doctrine from Part 12
  stdlib-roadmap.md         single global ledger for stdlib-owned work
  <focused normative specs>
  notes/
    archive/                superseded roadmaps, proto-specs, reviews, handoffs
```

Focused normative specifications remain authoritative. The index documents route readers to them instead of repeating their contents.

## Staged Fable roadmap

### Part 1 — Corpus inventory

**Target:** `spec/notes/v1-spec-inventory.md` (new)

Classify every current `spec/*.md` and `spec/notes/*.md` file without modifying any of them. The target should contain only compact tables:

- file → canonical normative / canonical router or ledger / active supporting note / historical;
- recommended disposition → keep / canonicalize / supersede / archive / review;
- canonical owner for repeated doctrine;
- every active open question, deferral, stdlib debt, cross-spec edit note, diagnostic, emission duty, ABI duty, and acceptance duty that risks being lost;
- stale statuses, provisional names, answered questions, broken ownership claims, and possible contradictions;
- proposed archive candidates and the canonical home that makes each safe to archive.

Use targeted searches for `Status`, `open`, `defer`, `owed`, `next touch`, `edit note`, `TODO`, `acceptance`, `diagnostic`, `emit`, `ABI`, `stdlib`, `provisional`, `supersed`, and `histor`. Consult full bodies only to resolve a hit. Do not propose rewritten prose and do not move files. Keep the inventory below 450 lines; if the evidence does not fit, compress rows rather than adding narrative.

**Gate:** Sol confirms classifications, resolves any genuine contradictions with James, and marks archive candidates safe. No later part begins before this review.

### Part 2 — Canonical specification index

**Target:** `spec/README.md` (new)

Using the approved Part 1 inventory, create the smallest useful entry point:

- authoritative files, each named exactly once;
- a compact ownership map;
- minimal reading sets for parser, resolver/checker, emitter, modules, collections, FFI, stdlib, and documentation work;
- links to `language.md`, `ffi.md`, `spec-roadmap.md`, and `stdlib-roadmap.md` (forward links are allowed until Parts 3–4 land);
- a clear statement that `notes/archive/` is non-normative and excluded from default context.

Do not summarize language rules or reproduce component indexes. Aim for 150 lines or fewer.

### Part 3 — Core-language router

**Target:** `spec/language.md` (new)

Create a compact conceptual map of the language and route each topic to one normative owner. It may state vocabulary needed to navigate the corpus, but must not become a second specification. Include the dependency/reading order and the boundaries among syntax, name resolution, typing, runtime representation, control flow, modules, constraints, collections, and FFI. Link instead of restating rules. Aim for 180 lines or fewer.

### Part 4 — Global stdlib ledger

**Target:** `spec/stdlib-roadmap.md` (new)

Create the sole global ledger for stdlib-owned work from the approved inventory. Every row needs: proposed surface or question; source section; status (`v1 obligation`, `ship/defer decision`, or `post-v1 candidate`); semantic constraints already fixed; revisit bar if any; and eventual discharge location. Preserve the distinction between mandatory work and candidates—especially the FFI decoder family and qualified constructor homes versus `toJsMap`/`toJsSet`, projections, and set algebra. Do not design the stdlib here. Aim for 250 lines or fewer.

### Part 5 — Main roadmap closeout

**Target:** `spec/spec-roadmap.md`

Make the roadmap about remaining work only. Replace landed component detail with short completion pointers to the canonical indexes, route every stdlib item to Part 4's ledger, retain explicit language/package/v2 deferrals with their owners and revisit bars, and remove already-applied edit notes. Do not change a feature's status unless the inventory proves its canonical landing point.

### Part 6 — Focused-spec canonicalization

**Target:** exactly one existing normative spec or active guide per Fable turn, selected from the approved inventory.

Do not automatically rewrite every file. Touch only files flagged `canonicalize`, in dependency order. For each target:

- fold already-approved correction records into the owning body;
- stabilize the status line;
- remove resolved questions, promotion instructions, and applied edit notes;
- replace duplicated doctrine with an owner link;
- keep normative grammar, behavior, diagnostics, emission, ABI, and acceptance material;
- keep only short rationale that prevents likely re-litigation;
- verify examples against final names and syntax.
- preserve established section numbers and anchors unless the approved inventory explicitly schedules every inbound reference for the same change.

The handoff must identify every deletion by category and explicitly say whether semantics changed. If a contradiction is found, leave the disputed text intact and report it. Sol reviews each file before authorizing the next. Suggested dependency order: lexical/core types → declarations/modules/types → constraints/control flow → collections → FFI → active reader guides. `ffi.md` is already the model and should be touched only for a demonstrated stale reference.

### Part 7 — Historical archive

**Target:** `spec/notes/archive/README.md` plus only the exact file moves authorized after Part 1 and Part 6.

Move, do not rewrite, approved historical roadmaps, proto-specs, reviews, and handoffs into `spec/notes/archive/`. Add a brief non-normative archive header only where the existing header is ambiguous. The archive README explains that these files are drafting history, excluded from normal reading sets, and unable to override canonical specs. This part's sole companion-edit exception is mechanical updating of inbound paths affected by the authorized moves; make no wording changes while doing so. Do not delete anything in this pass; deletion can be a later, separately approved Git-history cleanup.

### Part 8 — Corpus reconciliation audit

**Target:** `spec/notes/v1-spec-consolidation-audit.md` (new)

Audit the consolidated live corpus, excluding archive contents except for link validation. Record pass/fail evidence for:

- global type, constructor, exception, constraint, function, and module naming;
- stale syntax, provisional names, statuses, answered questions, and edit notes;
- unique ownership and non-divergent repeated doctrine;
- every active debt appearing in exactly one ledger;
- diagnostics, emission duties, ABI commitments, and acceptance obligations retaining an owner;
- Markdown file/section references and advertised minimal reading sets;
- archive independence and roadmap agreement.

This is an audit report, not a repair pass. Do not edit findings elsewhere. Keep it below 300 lines.

### Part 9 — Promotion closeout

**Owner:** Sol, not Fable by default.

Sol applies approved audit fixes, performs the semantic-diff review, updates final statuses, and verifies `git diff --check`. Fable should receive a narrowly named target only if the audit exposes a substantial editorial repair suited to another bounded pass.

## Post-consolidation decision queue

### JavaScript-compatible international identifiers

**Status:** Promoted early by James (July 2026), before consolidation closeout, so the
playground and compiler can exercise it. Lexer §3 is authoritative; Functions §2,
Primitive Types §1, Pattern Matching §2.1, Modules §3/§10, and FFI Part 4 §3 carry
the role-specific consequences.

Promotion fixed ECMAScript 2024 with compiler-pinned Unicode 17.0.0 `ID_Start` /
`ID_Continue` tables; exact codepoint spelling equality with no normalization;
literal bidi controls rejected; confusables left to optional tooling warnings;
and `__hex_` as the reserved, deterministically probed emitted-name prefix.

- Use the targeted ECMAScript edition's identifier-character repertoire rather than a Hexagon-specific ASCII or Unicode subset: JavaScript `ID_Start`/`ID_Continue` rules, including its allowances for `$` and `_`. Hexagon keywords remain unavailable as identifiers. Emoji such as `😊` remain invalid because JavaScript does not admit them as identifier starts.
- Classify each valid identifier by its literal first Unicode code point: **uppercase-start** versus **non-uppercase-start**. Uppercase-start identifiers serve the existing uppercase roles (types, constructors, constraints, module aliases); every other valid start serves term/binder roles. This start-class vocabulary is the sole naming doctrine.
- Caseless scripts therefore work naturally as terms (`用户`). An uppercase Latin prefix is the cultural convention, not compiler syntax, where an uppercase role is required (`T用户`, `C成功`, `M数据库`). `$name`, `_name`, and caseless-script names are non-uppercase-start.
- Identifier spellings contain the actual characters. Do not add JavaScript's `\u...` identifier escapes: they conceal role classification and modern editors can enter the characters directly. String/character escapes are unaffected.
- At an FFI declaration, the foreign JavaScript name and local Hexagon name are checked independently. A foreign name in the wrong local role requires `as` aliasing, with a Rewrite-Rule diagnostic (for example `VERSION as version` or `用户 as T用户`); the foreign export spelling is unchanged.
- Reserve the narrow emitted-name prefix `__hex_` for compiler-generated identifiers rather than reserving all underscore-prefixed names. Generated names still probe deterministically on collision with foreign or emitted names.
- The early promotion audited Lexer, declarations, pattern binder/constructor
  classification, Modules alias-case rules, FFI Part 4 alias diagnostics, emitter
  hygiene, `.d.ts` names, Monaco, and corpus-wide naming terminology. Later
  consolidation must preserve these owners rather than restoring lowercase-only text.

### Cultural uppercase prefixes and implied types

**Status:** Naming direction approved by James and propagated corpus-wide (July
2026).

Caseless scripts need an uppercase Latin first character for Hexagon's
uppercase-start roles. The cultural convention is one distinct mnemonic per role:

| Prefix | Role | Representative spelling |
| :--- | :--- | :--- |
| `T` | type | `T人`, `T花色` |
| `U` | union case | `U梅花`, `U黑桃` |
| `C` | constraint | `C显示` |
| `I` | implied type | `I元素` |
| `E` | exception | `E无效年龄` |
| `M` | module alias | `M数据库` |

Record constructors retain their type's `T` name because the type and constructor
deliberately share one identifier. Foreign-enum cases follow `U`. Type aliases,
opaque types, and extern classes follow `T`. Values, functions, parameters, fields,
constraint function members, type variables, and other term/binder roles need no
prefix; bare caseless-script identifiers already classify correctly.

These prefixes are conventions, not reserved syntax. Naturally uppercase names such
as `Person`, `Clubs`, `Show`, `Item`, and `Database` remain unchanged; in particular,
the prelude member `Item` does not become `IItem`.

The fixed terminology is **implied type**. Definition:

> An implied type is a type uniquely determined by a constraint instance's subject
> type.

For example, `Iterable<Vector(Int)>` implies `Item = Int`; the `honor` declaration
explicitly establishes that implication, after which the checker may use it. This is
not merely a type inferred from an expression. The source forms `type Item` and
`type Item = a` are unchanged.

The terminology is propagated through Collections Part 2, diagnostics, the live
spec and book, review titles, compiler diagnostics/tests, and the Lexer §3 cultural
examples. The technical word **projection** remains the name of the operation, and
**projection-bearing constraint** remains the constraint classification; the
user-facing member noun is **implied type**.

### Arbitrary-string JavaScript properties

**Status:** Concrete interoperability gap recorded by James (July 2026); deliberately not a consolidation edit. The need and two-door direction are accepted for post-Part-9 design; exact surface spelling remains open.

- JavaScript property keys are not limited to identifiers: an object may lawfully contain `b["😀"] = 5` even though `😀` cannot name a JavaScript or Hexagon binding. Such an object must still cross intact as `JsValue` or an opaque extern value; Hexagon must not pretend the property is an ordinary record field or identifier.
- Candidate bracket doctrine: brackets **retrieve a value selected by a key or index and may fail; they never answer a predicate**. String-keyed property retrieval is therefore compatible with Vector/Map/JsMap access and does not reopen JsSet brackets (`contains` remains the membership operation).
- Preserve the FFI's two doors. A **trusted** arbitrary-string foreign member belongs in an `extern` declaration, with candidate foreign-name-first syntax such as `get "😀" as smile(subject: EmojiBag): Int`, emitting `subject["😀"]`. An **untrusted** object is accessed through the composable `JsValue` decoder family, with a string-keyed field combinator and `Field("😀")` conversion paths. The example spelling is illustrative, not yet grammar.
- Until that surface lands, a JavaScript shim remains the honest direct-access rewrite; arbitrary-string extern export/member names remain the explicit Part 4 deferral rather than being silently rejected as impossible JavaScript.
- The design must decide own-property versus prototype-chain lookup separately for the two doors; distinguish absence from present `undefined`; preserve single evaluation; and specify getters/proxies that throw as `JsError`, never as missing-property or conversion failure. Symbol-keyed properties are a separate question and must not be smuggled into the string-key design.
- Promotion must reconcile FFI Parts 4–5 (foreign names and `get`), Part 11 (decoder/error/path ownership), `stdlib-roadmap.md` (decoder-family surface), Operators/bracket doctrine, diagnostics, emission, and acceptance tests.

### JavaScript Symbols in v1; Hexagon atoms after v1

**Status:** V1 direction approved by James (July 2026); deliberately not a consolidation edit. Promote after Part 9 as a closure of FFI Part 5's symbol-keyed-member deferral, not as a new v1 surface.

- JavaScript `Symbol` is a foreign identity mechanism, not a Hexagon language primitive. Well-known-symbol protocols may be implemented internally where a focused boundary already requires them (`Symbol.iterator` for `Seq`/`Iterable`), without exposing general symbol operations.
- Symbol values may cross intact as `JsValue` (`JsKind.Symbol`), opaque extern values, or identity-matched members of a declared foreign enum. V1 does not reject, stringify, or structurally reinterpret them.
- V1 adds no general `JsSymbol` type, symbol constructor/registry API, symbol equality surface, or symbol-keyed/computed extern-member syntax. A JavaScript shim is the Rewrite-Rule repair for direct interaction. TypeScript `unique symbol` brands remain private declaration-file machinery and are not a runtime Symbol surface.
- Revisit only as one complete foreign-identity/computed-members design when a concrete foundational library makes a shim materially inadequate. That design must cover local versus `Symbol.for` identities, well-known symbols, realms, import/export linkage, computed member keys, `.d.ts`, diagnostics, and exceptions.
- A future **Hexagon-native quoted-name/atom facility** is a separate language question. Lisp-family `'name` traditionally quotes an identifier so it is treated as data (often an interned symbol) rather than evaluated; Hexagon may someday want comparable atom-like data, potentially under the less-confusing name `Atom`. Do not reserve `'name`, choose representation, or equate such atoms with JavaScript Symbol identity before a dedicated post-v1 design with a concrete use case.

## Completion gates

The consolidation is complete only when:

- all Markdown file and section references resolve;
- the authoritative index names every normative file exactly once;
- every active debt appears in exactly one global ledger with an owner;
- no canonical file contains a resolved question, stale promotion instruction, provisional name, or applied edit note presented as live;
- archived files are unnecessary for ordinary implementation and review tasks;
- representative compiler tasks can be answered from the advertised minimal reading sets;
- diagnostics, emission duties, ABI commitments, and acceptance requirements retain canonical owners;
- `git diff --check` passes; and
- Sol's final semantic-diff review finds no accidental language change.

## Expected outcome

The normative design remains modular, but routine context becomes substantially smaller: agents begin with `spec/README.md`, load one task-specific reading set, and consult rationale or archives only when needed. Global obligations—especially stdlib work—remain visible even when the originating component spec is not loaded.
