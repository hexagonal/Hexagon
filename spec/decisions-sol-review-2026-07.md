# Hexagon Spec: Decisions Batch — Sol Review Closures (July 2026)

**Status:** Decided (July 2026). Cross-cutting closure document in the Decisions Batch style: it records seven resolutions arising from the second external review (Sol), plus the edit notes their host specs need. Authoritative for everything it decides until consolidated.
**Scope:** qualified access to constraint members as ordinary idiom (A); the instance-discoverability diagnostic obligation, with the structural analysis that narrows it (B); pre-registered rejection of escape-analysis exceptions to the `var`/lambda boundary (C); acyclicity scope at the FFI boundary (D); the Rewrite Rule as stated doctrine (E); a kind-system caveat on "the type of a type" (F); a wording fix in the ranges spec (G).
**Not in scope:** the hostile-specimen constraint-library test itself (pre-registered here, executed at the stdlib-listing session); `Int` overflow and the checked build mode (already acknowledged in the corpus; Sol endorsed the existing plan; no new decision); `Eq<Float>`/`Ord<Float>` (already closed — Decisions Batch 2026-07 §1; Sol independently arrived at the chosen option); the public-story starter subset (a guide-preface note, owed to the TS-coders guide, not a spec).
**Companions:** Constraints (§1, §2.2 touched; new doctrine line), Modules (§7 gains a diagnostic obligation; §13 example (i) annotated), Statements/Blocks/Mutability (§6.2 gains a rejected alternative), FFI agenda (item 8 added), Loops/Ranges/Iteration (wording fix), Declarations Preamble (hosts the Rewrite Rule on consolidation).

Written against the existing `hexc` architecture: Algorithm J, union-find tyvars, level-based generalisation, constraints as dictionaries, whole-program compilation from an entry point, readable-JS emission with `.d.ts`.

---

## A. Qualified member access is ordinary, not apologetic

*Amends Constraints §1 (doctrine) and §2.2; sets the guide's presentation stance.*

### A.1 The decision

Add to Constraints §1 doctrine:

> **Bare member calls are the idiom whenever unambiguous; qualified access is the ordinary resolution when two in-scope constraints share a member name — a spelling, not a workaround.**

Nothing mechanical changes. Constraints §2.2 (constructor-style collision rules, qualified access via the modules machinery) and Modules §6.4 (every prelude name has a qualified home) already provide everything needed. This decision fixes the *stance*: when a user with two hash-bearing constraints writes `Hashable.hash(x)`, the language's self-presentation must not have implied they are working around a defect.

### A.2 What "qualified" means here — no new mechanism

The qualified spelling is module qualification (Modules §5), nothing constraint-specific. The companion-module idiom extends naturally: declare `constraint Hashable` in `hashable.hex`, and consumers who hit a collision write `import * as Hashable from "./hashable"` and call `Hashable.hash(x)`. For the prelude, Modules §6.4 already guarantees the qualified homes exist. No per-constraint namespace, no `Constraint.member` resolution rule, no fourth-namespace change.

### A.3 What the guide says (and doesn't)

The prelude set doesn't collide, so the guide teaches `show(x)`, `compare(a, b)`, `equals(x, y)` bare, forever, without caveat. It simply never claims bare access is a universal promise. If the collision case comes up at all in user-facing material, the framing is: "two libraries both export `hash`; qualify one, exactly as you would for any other name."

### A.4 Rejected: the stronger Sol position

Sol floated `Ord.compare(x, y)` as a form "users may commonly write," partly to visibly mark ad-hoc polymorphism. Rejected as the default idiom: it taxes the 99% case (the prelude, collision-free by design) to serve a marking function the LSP hover already performs. Recorded so the milder form is understood as a considered choice, not a compromise Sol talked us down from. The marking benefit is real and is why qualification is *available* with dignity — it is just not the daily spelling.

### A.5 Pre-registered test

The stdlib-listing session inherits a **hostile-specimen exercise**: draft ten unrelated user constraints with plausibly colliding member names (`hash`, `empty`, `size`, `map`, …) and confirm that (i) the collision errors read well, (ii) the qualified resolutions read well, (iii) the guide's silence on the topic survives contact. If qualification turns out to be *constant* rather than occasional, the stronger position gets revisited there — with a specimen, per house practice.

---

## B. Instance discoverability: the scenario is narrower than feared, and the diagnostic is now an obligation

*Amends Modules §7 (new §7.6) and annotates §13 example (i).*

### B.1 The structural analysis (record this; it does most of the work)

Sol's scenario — "`show(point)` works in this project but not in this isolated file, because an apparently unrelated import activated the instance" — is far harder to reach in v1 Hexagon than in Haskell, and the corpus should say why:

1. **The orphan rule** (Constraints §5.3, Modules §7.2) confines `honor C<T>` to exactly two files: the one declaring `C` and the one declaring `T` (outermost constructor, for parameterized heads).
2. **No re-exports in v1** (Modules §12.2) means a module that *names* a type imports it from its home module directly. Naming `Point` puts `point.hex` in your graph; naming `show` puts the prelude's `Show` home in your graph. Both legal instance homes are therefore already present, and instances are global over the graph.

So for the common case — you can write the type's name — the invisible-dependency scenario is **structurally impossible**. The residual gap is real but specific: a module can manipulate values of a type it never names (`sort(getConfigs())` — inference carries `Config` through without an import). There, the instance's home module may sit outside the module's *own* import list, reachable only through the wider program graph — and removing a distant import can indeed break this file. The other residual case is Sol's literally: an isolated file compiled outside the program graph (single-file check, test harness, playground).

The corollary worth stating: **the effect-import-for-instances pattern (Modules §3.4, example (i)) is nearly vestigial in v1.** It becomes load-bearing only when re-exports or a package story widen the gap between "names in scope" and "modules in graph." Modules §13 example (i) gains a note to this effect so nobody reads it as a daily idiom.

### B.2 The obligation (new Modules §7.6)

Two tiers, split by what each layer can actually see:

- **Compiler (required, v1):** an unsatisfied constraint `C<T>` on a nominal `T` must name the two legal homes: "no instance of `Show<Config>` exists in this program; one may only be declared in `./config.hex` (which declares `Config`) or the module declaring `Show`." The compiler always knows both — if a `T` value exists in the program, `T`'s declaring module was compiled. This turns the orphan rule from a restriction into a *search space of size two*, handed to the user.
- **LSP (required before 1.0, not a compiler feature):** the language server sees the workspace, not just one program graph. For the isolated-file case it must additionally report whether an instance *exists* in a workspace file outside the current graph, and which import would activate it. Coherence-conflict prediction ("importing it would collide with…") rides along for free, since the check is the same scan.

Promoted from gesture (Sol's word, accurate) to obligation, per his request. The rationale line for the spec: *global instances are only tolerable if the compiler can always answer "then where would one live?"*

---

## C. The `var`/lambda boundary admits no escape-analysis exception

*Adds a rejected alternative to Statements/Blocks/Mutability (§6.2's family).*

Pre-registered rejection, verbatim for the host spec's rejected-alternatives section:

> **Lambdas may capture a `var` when the compiler proves the lambda does not escape** — rejected, permanently, not merely deferred. Escape analysis would make *program legality* depend on optimizer cleverness (code breaking under a compiler upgrade that got smarter, or less smart), and at the FFI boundary it would depend on foreign annotations `hexc` cannot verify (is this callback synchronous? does that library store it?). The current rule is severe but crisp: a `var` is function-body machinery, full stop; the rewrite is `for` (Statements §6.2's existing fixit). If real specimens — tree traversals, event subscription, parser callbacks, visitor APIs, sync and async foreign callbacks — prove the rule unbearable, the honest relaxations are explicit ref cells or an explicit capture annotation, both *syntactic* and therefore stable. Neither is proposed; the point of this entry is that silent escape analysis is not on that list.

The specimen list doubles as an acceptance exercise inherited by the FFI and Collections sessions: each pattern above must have a documented idiomatic form under the current rule.

---

## D. Acyclicity is a property of Hexagon source edges only

*Adds item 8 to the FFI agenda; the FFI spec inherits the paragraph.*

The Modules §8.1 prohibition applies to **import edges between `.hex` files** — not to the resolved ESM graph. Consequences, to be stated in one paragraph of the FFI spec:

- An `extern` JS module may participate in JS-internal cycles; from Hexagon's perspective every `extern` import is a leaf edge.
- Two Hexagon modules may import foreign modules whose internal dependency graphs are cyclic, including cycles that pass through each other's transitive JS dependencies.
- `hexc` does not inspect, certify, or diagnose the internal graphs of foreign packages — it realistically cannot (npm), and the deterministic-load-order guarantee (§8.2) is claimed for Hexagon modules' own top levels only. A Hexagon module's imports still complete before its top level runs; what a foreign cycle does internally is the foreign ecosystem's contract.

Added to `ffi-agenda.md` as **item 8**, phrased as a confirmation item (the answer is decided here; the FFI session writes it into the spec proper).

---

## E. The Rewrite Rule (doctrine, canonised)

*New stated invariant; consolidation home: Declarations Preamble doctrine, beside the no-warning-tier stance it completes.*

### E.1 The rule

> **Every restrictive hard error must have a local, obvious rewrite — and the diagnostic must name it.**

Hexagon has no warning tier; everything it rejects, it rejects fully. That posture is only humane if the path from any rejection to legal code is short and visible from the error site. The corpus already complies everywhere: discarded value → `ignore(...)`; recursion under `let` → `fun`; mutable callback accumulator → `for`; unavailable constructor → import/qualify; refutable binding pattern → `match`; deliberate rebinding → a new name; phantom alias parameter → `record`/`union`; recursive alias → `union`/`record`. This decision makes the pattern an obligation rather than a habit.

### E.2 Operational form

Two checklist items, binding on every future spec session:

1. Any new hard error enters its spec's **diagnostics checklist with its rewrite in the message or fixit** — a restriction whose row cannot name a local rewrite is returned to design.
2. **Where no simple rewrite exists, the restriction itself is suspect** (Sol's converse, adopted verbatim). "Restructure your program" is not a local rewrite; a restriction whose only escape is architectural gets flagged as a hanging question, not shipped as an error.

### E.3 Boundary note

"Local" means *at the error site, using constructs already in the language*. The rule does not require the rewrite to be pleasant (the `var`-in-lambda → `for` rewrite may cost real restructuring of a callback-shaped API) — it requires it to be *nameable and mechanical*. The C-entry above passes: the diagnostic can always say "use a `for` loop." Sol's framing survives intact; this note only prevents the rule being wielded against every restriction anyone finds inconvenient.

---

## F. "The type of a type" gets its asterisk

*Amends Constraints §1, first doctrine bullet.*

Append one sentence to the existing bullet:

> That phrase is informal: formally, a constraint is a **predicate over types** — a statement of required operations and laws — not a kind. Constraints never appear where types appear; `Num` has no kind, is not a first-class type-level value, and `Num` in a type position is an error.

The memorable phrase stays (it earns its keep in teaching); the sentence forecloses the three questions Sol predicts someone will eventually ask. User-facing material continues to prefer the plain form already in the corpus: *a constraint describes operations and laws required of a type.*

---

## G. Ranges: "partially configure" → "wrapped in a lambda"

*Wording fix, Loops/Ranges/Iteration.*

Hexagon has no partial application (Functions; no currying is doctrine). The ranges spec's claim that `range` can be "partially configured" is corrected to:

> `range` is a first-class function like any other; a specialised form is obtained by wrapping it in a lambda: `let fromOne = n => range(1, n)`.

No semantic change; the sentence as previously written implied a feature the language deliberately lacks.

---

## Decisions log

| Decision | Where |
|---|---|
| Bare member calls idiomatic when unambiguous; qualified access is ordinary resolution, not workaround; no new mechanism (module qualification + companion idiom) | §A.1–A.2 |
| Guide never claims bare access is universal; prelude taught bare without caveat | §A.3 |
| Stronger "qualified-as-default" position rejected with reasons; revisit only via specimen | §A.4 |
| Hostile-specimen constraint-library test pre-registered for stdlib listing | §A.5 |
| Invisible-instance scenario structurally narrowed by orphan rule + no re-exports; residual cases: unnamed-type values, isolated files | §B.1 |
| Effect-import-for-instances noted as nearly vestigial in v1 (Modules §13(i) annotated) | §B.1 |
| Unsatisfied constraint on nominal `T` must name the two legal instance homes (compiler, v1); workspace scan + activating-import suggestion (LSP, pre-1.0) | §B.2 |
| Escape-analysis exception to the `var`/lambda boundary rejected permanently; honest future relaxations would be syntactic (ref cells / capture annotation), neither proposed | §C |
| Specimen list (traversals, subscriptions, parser/visitor/foreign callbacks) inherited by FFI + Collections sessions | §C |
| Acyclicity = Hexagon source edges only; extern modules may sit in JS cycles; `hexc` never certifies foreign graphs; FFI agenda item 8 | §D |
| **The Rewrite Rule**: every restrictive hard error has a local, obvious rewrite, named in the diagnostic; no-rewrite restrictions return to design | §E.1–E.2 |
| "Local" = nameable and mechanical at the error site, not necessarily pleasant | §E.3 |
| "Type of a type" kept as informal teaching phrase with formal caveat (predicate over types; no kind; never in type position) | §F |
| `range` wording fixed: "wrapped in a lambda," never "partially configured" | §G |

---

## Edit notes to companion specs

- **constraints.md** — §1: add the §A.1 doctrine line; append the §F sentence to the first bullet. §2.2: one cross-reference line to §A (stance, no mechanism change).
- **modules.md** — new §7.6 (Instance discoverability) carrying §B.1's analysis and §B.2's two-tier obligation; §13 example (i) gains the "nearly vestigial in v1" note; §12 hanging questions: the package story (§12.1) inherits a pointer — re-exports/packages reopen the discoverability gap that v1's structure closes.
- **statements-blocks-mutability.md** — rejected alternatives: add §C's entry beside the §6.2 lambda-boundary rule.
- **ffi-agenda.md** — append item 8 (acyclicity scope), marked "decided here; spec writes the paragraph."
- **loops-ranges-iteration.md** — apply §G's wording fix at the first-class-`range` passage.
- **declarations-preamble.md** — on consolidation, host the Rewrite Rule (§E) in its doctrine, adjacent to wherever the no-warning-tier stance lands; until then this document is the rule's home.
- **hexagon-for-typescript-coders.md** — stance only (§A.3): audit that no passage promises bare member access universally; candidate preface addition (separate, non-spec task): the month-one starter subset (`let`, functions, records, unions, `match`, `List`, `Option`, `Result`, `for`, constraints).

---

## Hanging questions (recorded, not decided)

1. **Hostile-specimen outcome** (§A.5) — if collisions prove constant, the qualified-as-default position returns, at the stdlib-listing session, with evidence.
2. **LSP workspace-scan scope** (§B.2) — whole workspace vs. configured roots; performance story; owed to the tooling design, pre-1.0.
3. **Starter-subset preface** for the TS-coders guide — a writing task, not a spec question; queued with the guide's next revision.
