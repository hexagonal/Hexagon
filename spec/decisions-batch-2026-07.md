# Hexagon Spec: Decisions Batch — July 2026 Closures

**Status:** Decided (July 2026). This is a **cross-cutting closure document**: it records six decisions that resolve hanging questions filed across existing specs, plus the edit notes those specs need. It is intended to be consolidated into its host specs later; until then it is authoritative for everything it decides, and supersedes the "open"/"flagged" status of every item it names.
**Scope:** `Eq`/`Ord` semantics for `NaN` and `-0` (with `Hash` consequences); derivation invocation for nominal types (`derive`); the `Ordering` union's constructor spelling; tabs in leading whitespace; indexing/slicing partiality (`IndexError` vs clamp); the implied-types spec timing (deferred to v2, with rationale recorded).
**Not in scope:** the derivation *semantics* (fixed: Products §2.5/§3.4, Unions §7); the full indexing/collections spec (this doc pre-decides only its partiality story); the implied-types design itself (Loops §7.2/§11.1 remains the sketch of record); `Hash` as a user-facing constraint (not in v1; §1.4 here constrains it if it ever ships); the modules-spec namespace question (§3 reduces its stakes, does not answer it).
**Companions:** Constraints spec (§9.2, §9.5, §9.7 closed here), Primitive Types spec (§3 promise discharged here), Lexer & Layout spec (§2 tabs flag closed here), Loops/Ranges/Iteration spec (§11.1, §11.2, §11.7 closed or advanced here), Products spec (§3.4 record-`Ord` question dissolved here), Statements/Blocks/Mutability spec (unaffected; listed because `IndexError` phrasing follows its diagnostics doctrine).

Written for a future implementation session against the existing `hexc` architecture: Algorithm J, union-find tyvars, level-based generalisation, constraints as dictionaries, layout pass, readable-JS emission with `.d.ts`.

---

## 1. `Eq<Float>` and `Ord<Float>`: SameValueZero and the consistent total order

*Closes Constraints §9.5; discharges the promise in Primitive Types §3.*

### 1.1 The decision

- **`Eq<Float>.equals` is SameValueZero**: `NaN` equals `NaN`; `+0` equals `-0`; everything else as IEEE/`===`.
- **`Ord<Float>.compare` is the total order consistent with that `Eq`**: IEEE ordering on all non-`NaN` values; `compare(+0, -0) = Equal`; all `NaN`s equal to each other; `NaN` sorts **after `+Infinity`** (greatest).
- `Eq<Int>` and `Ord<Int>` are unaffected: under the f64-integer-invariant, `NaN`, `-0`-as-distinct, and infinities are never `Int` values, so bare `===` and native `<` remain exactly correct.

### 1.2 Rationale (record this, not "JS says so")

Modern JS is internally split three ways — `===` is IEEE, `Object.is` is SameValue, `Map`/`Set`/`includes` are SameValueZero — so "match the target" underdetermines the choice. What forces it is **key coherence**: Hexagon's `Map`/`Set` are built on Immutable.js, and `Immutable.is` is documented as treating `0` and `-0` as the same value (explicitly to match ES6 `Map` key equality) while treating `NaN` as equal to itself — i.e. SameValueZero. The native JS `Map`/`Set` beneath everything are also SameValueZero. If `Eq<Float>` disagreed with the collections' key identity, `equals(k1, k2)` and "these are the same key" would diverge — precisely the incoherence the `Eq` law exists to prevent. With SameValueZero there is **no host structure left that can disagree** with Hexagon equality.

`Ord` then has no freedom: `compare(a, b) = Equal` must coincide with `equals(a, b) = true`, which fixes `+0`/`-0` as `Equal` and all `NaN`s as mutually `Equal`. The only open slot was *where* the `NaN` equivalence class sits; after-`+Infinity` follows the on-target precedent of `Float64Array.prototype.sort`, which places `NaN`s last.

### 1.3 Rejected alternatives (do not re-litigate)

- **Honest IEEE `Eq`** (`NaN != NaN`, lawless reflexivity, documented): breaks key coherence with every collection layer; poisons lookups (`Map.get` could find a key that `equals` denies). The "honesty" is purchasable via ordinary functions (`Float.isNaN`, a future `Float.ieeeEquals`) without corrupting the constraint.
- **Rust's `total_cmp` verbatim**: distinguishes `-0 < +0`, which contradicts SameValueZero's `+0 = -0` and would put `compare` at war with `equals`. Rust can afford the distinction because its `PartialEq` is IEEE and `total_cmp` is a *separate* opt-in order; Hexagon has one `Eq` and one `Ord` per type and they must agree.
- **SameValue (`Object.is`) semantics**: gets `NaN` right but keeps `+0 ≠ -0`, disagreeing with `Map`/`Set`/Immutable.js key identity. Same incoherence, other axis.

### 1.4 `Hash` consequence (pre-registered constraint on a non-v1 feature)

Hexagon v1 exposes no `Hash` constraint. If one ever ships, `Hash<Float>` **must** normalise consistently with §1.1: `-0` hashes as `+0`, and all `NaN` bit patterns hash to a single value. (Immutable.js already does both internally, since its `hashCode` routes through the same `is`-consistent machinery — so the substrate imposes no obstacle.) Recorded here so the stdlib listing inherits it.

### 1.5 Emission

- `Eq<Int>` fast path: bare `===` (unchanged).
- `Eq<Float>` fast path: **not** bare `===`. Emit the SameValueZero expression

  ```js
  a === b || (Number.isNaN(a) && Number.isNaN(b))
  ```

  or a call to an on-demand prelude helper `__hex_floatEquals` (same on-demand doctrine as constructors, Unions §6.4) — implementer's choice per site, biased toward the inline expression where it stays readable. Note `+0 === -0` is already `true` in JS, so `===` needs no zero patch — only the `NaN` clause is added.
- `Ord<Float>` fast path: native `<`/`<=`/etc. remain correct **whenever neither operand can be `NaN`**; the general `compare` must implement §1.1's total order (a small prelude function; `NaN` checks first, then native comparison, `+0`/`-0` needs no special case since `<`/`>` already treat them as equal).
- `.d.ts`: unaffected; nothing constraint-shaped appears there (Constraints §6.4).

### 1.6 Doctrine note

The `Eq`/`Ord` laws (reflexivity, symmetry, transitivity; `compare`-`equals` agreement) now hold **unconditionally for `Float`**, with no asterisk. Interpolation/`Show` of `NaN` and `-0` is untouched (`show` renders what JS renders; `Show` was never law-bound to `Eq`).

---

## 2. Derivation invocation: opt-in `derive`

*Closes Constraints §9.2 (mechanism half); dissolves the Products §3.4 "does record `Ord` ship?" question.*

### 2.1 The decision

Derived instances for **nominal** types (`record`, `union`) are **opt-in**. Two spellings, one meaning:

```
-- Core form: an implement whose body is the keyword `derive`
implement Show<Point> = derive
implement Eq<Point> = derive

-- Header-clause sugar, desugaring to the above, one per listed constraint
record Point = {x: Float, y: Float} derives (Eq, Show)
union Shape = Circle(Float) | Rect(Float, Float) derives (Eq, Show, Ord)
```

- The `derives (...)` clause takes the same parenthesized constraint list as multi-constraint binders (`<a: (Eq, Show)>`, Constraints §1); a single constraint may drop the parens: `derives Eq`.
- Derivable in v1: `Eq`, `Ord`, `Show` — exactly the constraints whose structural semantics are already fixed (tuples: Products §2.5; structural records: Products §3.4; unions: Unions §7). A nominal derivation is that structural semantics applied to the underlying shape. `derive` for any other constraint is a hard error (§2.5).
- A derived instance is an ordinary instance thereafter: it occupies the (constraint, constructor) coherence slot (Constraints §5.1), participates in superconstraint existence checks (deriving `Ord` requires an `Eq` instance in scope — derived or hand-written — per Constraints §4.2), and obeys the orphan rule (`derive` is only writable where a hand-written instance would be legal, §5.3 there).
- **Structural types are untouched**: tuples and structural records keep their automatic compiler-derived instances (they have no constructor name to hang an `implement` on — consistent with the Constraints §9.3 presumption, which stands).

### 2.2 Rationale

The field splits cleanly. Automatic camp: F# (structural equality/comparison on records and unions by default, opt-*out* attributes), Elm, Kotlin data classes. Opt-in camp: Haskell (`deriving`), Rust (`#[derive]`), Swift (declare conformance, compiler synthesizes), Roc (opaque types: `implements [Eq, Hash]`), OCaml (ppx).

Hexagon's primary expression-model reference (F#) is automatic; its constraint-system lineage (Rust) is opt-in. The tiebreaker is Hexagon's own recorded principle — **"nominal means you control the surface"** (Products spec). Automatic `Show` leaks representation into output as a permanent public contract; automatic `Eq` blesses structural equality even where it is meaningless for the type (caches, normalized-plus-raw pairs, anything with incidental fields). The decades of Haskell/Rust field evidence say opt-in ages better; Swift, designed with both bodies of evidence available, chose opt-in; and F#'s own ecosystem routinely reaches for `[<CustomEquality>]`/`[<NoComparison>]` opt-outs — the tell that automatic was the wrong default. Opt-in also keeps the derivation mechanism *inside* the constraint system (`derive` is an `implement` body) rather than beside it, which is the Rust-shaped move consistent with everything in the Constraints spec.

### 2.3 Rejected alternatives

- **Automatic derivation for every `record`/`union`** (F#/Elm): rejected per §2.2. Recorded consequence deliberately accepted: `==` on a fresh user record is a compile error ("`Point` has no `Eq` implementation") until the author writes `derives Eq` — one clause, once, per type. That friction is the feature.
- **Automatic with opt-out attributes** (F#'s actual design): the worst of both — the default still leaks, and the escape hatch is an attribute grammar Hexagon otherwise doesn't have.
- **`derive` as a magic top-level declaration** (`derive Eq for Point`): a second instance-introducing form competing with `implement`; rejected for grammar economy — `derive` as an `implement` body means coherence, orphan, and superconstraint checking need zero new code paths.

### 2.4 The record-`Ord` question dissolves

Products §3.4 flagged nominal-record `Ord` as "possibly droppable." Under opt-in it needs no shipping decision: nobody receives it unless they write `derives Ord`, so it is simply *available*, with the field-order-lexicographic semantics Products §3.4 already fixes. The flag is closed. (Structural-record `Ord` — the automatic kind — keeps whatever status Products §3.4 gave it; this doc does not touch structural types.)

### 2.5 Grammar and checking notes (for the implementer)

- `derive` is a **keyword valid only as the complete RHS of an `implement`** (parallel to the Constraints §4.1 lambda-literal rule: the RHS is either the member-block form or exactly `derive`). Anywhere else it is the ordinary unbound-name/parse error.
- `derives` is a **contextual keyword in declaration headers only**; it does not reserve the identifier elsewhere. It must follow the complete type body (after the record's closing `}`, after the union's final constructor).
- `implement C<T> = derive` where the *semantics* of `C`-derivation would need something a slot lacks (e.g. `Eq<T>` where a field's type has no `Eq`) is a hard error naming the offending field/slot and its type, phrased against the derivation: "cannot derive `Eq<Point>`: field `render` has type `Int -> String`, which has no `Eq` implementation."
- `derive` on a parameterized nominal type produces the expected parameterized instance (fields' instances become instance-context obligations per Constraints §4.3). The header grammar for parameterized records is the declarations-preamble spec's business; the `derives` clause rides along whatever it decides.
- Emission: identical to what the fixed structural semantics dictate — derived `Eq` on records emits fieldwise `&&` chains with the §1.5 fast paths per field type, etc. Nothing new.

### 2.6 Diagnostics

| Situation | Error / hint |
|---|---|
| `==`/`show`/`<` on a nominal type without the instance | existing Constraints §8 unsatisfied-constraint phrasing, **plus** the fixit hint: "add `derives Eq` to the declaration of `Point`, or write an `implement`" |
| `derive` for a non-derivable constraint | "`Num` cannot be derived; only `Eq`, `Ord`, and `Show` have derivable forms" (likewise for `Signed`) |
| Underivable slot/field | "cannot derive `Eq<Point>`: field `f` has type `T`, which has no `Eq` implementation" |
| `derives Ord` without `Eq` in scope | the existing missing-superconstraint error (Constraints §8), plus hint: "add `Eq` to the `derives` list" |
| `derive` outside an `implement` RHS | parse error: "`derive` is only legal as the body of an `implement`" |
| `derives` clause on an `exception` | "exceptions have no derived instances" (consistent with Exceptions §10.4's no-instances presumption) |

---

## 3. `Ordering = Less | Equal | Greater`

*Closes Constraints §9.7.*

### 3.1 The decision

The prelude union is

```
union Ordering = Less | Equal | Greater
```

`Ord.compare : (a, a) -> Ordering` (member signature unchanged; only the constructor spellings are fixed here). All-nullary union rules apply (Unions): the runtime values are the bare string literals `"Less"`, `"Equal"`, `"Greater"`; `Eq<Ordering>`/`Show<Ordering>` come via `derives (Eq, Show)` on the prelude declaration under §2.

### 3.2 Rationale and precedent

Every language with this type dodged the `Eq`-constructor/`Eq`-constraint clash by spelling, in one of two schools: Haskell's all-caps `LT | EQ | GT` (copied by Elm — notably, Haskell's namespaces would have *permitted* the collision and they avoided it anyway), or Rust's/Jane Street Base's full words `Less | Equal | Greater`. F#/OCaml-stdlib sidestep with `compare : ... -> int` — the one precedent explicitly rejected: magic negative/zero/positive integers are the thing the union exists to fix.

Rust's spelling wins for Hexagon on two counts: it dodges the collision **regardless of how the modules-spec namespace question resolves** (the question remains owed there but is no longer load-bearing — edit note §7), and under all-nullary emission the debugger shows `"Less"`/`"Equal"`/`"Greater"` rather than `"EQ"`, which is strictly better readable-JS.

### 3.3 Rejected alternatives

- `LT | EQ | GT` (Haskell/Elm): survives the collision but exports cryptic two-letter strings into emitted JS and user-visible `show` output; no offsetting benefit.
- `compare` returning `Int` (F#/OCaml): rejected as above; also forfeits exhaustiveness checking on comparison results.
- `Lt | Eq | Gt` (the draft spelling): the collision-bearing variant; the reason this question existed. Dead.

---

## 4. Tabs in leading whitespace: hard error

*Closes the Lexer & Layout §2 flag.*

### 4.1 The decision

A **tab character (U+0009) anywhere in a line's leading whitespace is a hard lexer error**. Indentation is spaces only. There is no tab-width setting, no `#indent`-style escape hatch, and consequently no documented tab size — tabs do not exist in Hexagon indentation, so the question of their width is unaskable.

- Scope of "leading whitespace": from start-of-line to the first non-whitespace character. Tabs **after** the first non-space token (interior alignment, inside string literals, in comments after code has begun) are not this rule's business. The Physical Lexer §2.2 permits interior tabs as formatter-normalized horizontal whitespace. Tabs inside string literals are ordinary characters.
- The error fires in the raw lexer, before the layout pass; the layout algorithm (Lexer & Layout §2) may therefore assume space-only columns, and the UTF-16 column-tracking scheme needs no tab-expansion case.

### 4.2 Rationale and precedent

The offside rule needs an unambiguous column for every line; a tab's column contribution is a rendering convention, not a fact. Precedent is on one side: **F# hard-errors on tabs in code** ("TABs are not allowed in F# code unless #indent \"off\" is used" — same reasoning, and Hexagon declines even the escape hatch); **Elm** rejects tabs as a syntax error; **Nim** forbids tabs; **YAML** forbids tabs in indentation. The documented rejection is **Haskell**, which permits tabs under a mandated tab-stop-of-8 — near-universally regarded as a mistake, to the point that GHC ships `-Wtabs` to steer users off its own legal syntax. **Python 3** half-fixed it (`TabError` on ambiguous mixing; pure tabs still legal) — half-measures also declined.

### 4.3 Diagnostic

| Situation | Message (shape) |
|---|---|
| Tab in leading whitespace | "tab character in indentation; Hexagon indentation uses spaces only" + fixit replacing the tab(s) with spaces (pasted code is the common source; the fixit is mandatory, width of replacement is the formatter's call — recommend the enclosing file's prevailing indent unit, else 2) |

---

## 5. Indexing and slicing partiality: the Python split

*Advances Loops §11.7; pre-decides the indexing/collections spec's partiality story. That spec, when written, restates this section and owns everything else about `[]`.*

### 5.1 The decision

- **`xs[i]` throws `IndexError`** when `i` is out of bounds (this confirms and formalises the standing leaning already recorded in Loops §11.7 and the approved `IndexError` exception).
- **`xs[lo..hi]` clamps**: the range is intersected with the collection's valid index range; out-of-range portions are silently dropped. A fully-out-of-range or empty range yields the empty collection. Never an error.
- Both are 1-based and the range end is inclusive, per global doctrine (Primitive Types §5.1, Loops §3.1).

### 5.2 Rationale: the two forms assert different things

`xs[i]` **asserts** "element `i` exists" — a wrong assertion should fail loudly at the fault site, not surface downstream as a mysterious `undefined`-shaped wrongness. (The honest framing from Loops §11.7 stands: JS returns `undefined` out of bounds, so a bounds check exists either way; throwing wins on *type* cleanliness — `xs[i] : a`, not `a`-or-hole — not on speed.) `xs[lo..hi]` **requests** "whatever falls in this window" — a short or empty window is a *valid answer*, and pagination/take-first-n idioms (`xs[1..pageSize]`) must not require a pre-guard. Clamping also composes seamlessly with the existing `lo > hi ⇒ empty range` rule (Loops §3.4) into one uniform "ranges are forgiving" story.

This is Python's actual position (indexing raises `IndexError`; slicing clamps), and the strongest single precedent precisely because it is not a compromise but the same intent-based claim. Clamp-only company: Python slices, JS `Array.prototype.slice`, Kotlin `take`/`drop`. Throw-both company: Rust (`&v[a..b]` panics), Go, Java `subList`, Swift — a principled uniformity position, rejected below.

The readable-JS clincher: a clamping slice on a JS-array-backed collection emits as **bare `xs.slice(lo - 1, hi)`** — JS `slice` already clamps, so the emission is a single native call with zero guard code. A throwing slice would wrap every slice site in bounds checks.

### 5.3 Rejected alternatives

- **Throw-both** (Rust/Go/Swift): maximal uniformity ("out of range is out of range"), rejected because it erases the assert-vs-request distinction, taxes the dominant slice idioms with guards, and costs the bare-`.slice()` emission. Recorded as the principled runner-up; revisit only with field evidence of clamp-caused bugs.
- **Clamp-both** (make `xs[i]` return... what?): incoherent without an `Option` return or an `undefined` hole; either corrupts `xs[i] : a`. Never a candidate; recorded for completeness.
- **Slice throws, index clamps**: no known precedent, no coherent rationale; listed only to mark the quadrant as examined.

### 5.4 Owed to the indexing/collections spec (unchanged by this doc)

Which types support `[]` at all; negative-index policy (presumption: no Python-style negatives — 1-based indexing already spent that cleverness budget; presumed, not decided); slice-of-`Range`-value vs slice-of-literal-`..` (grammatically identical since `Range` is first-class, Loops §11.7); interaction with Immutable.js-backed collections (their `slice` also clamps, so §5.2's emission story holds there too, modulo the 0-based offset).

---

## 6. Implied types: formally deferred to v2

*Closes Loops §11.2 (timing); reaffirms and re-motivates Loops §11.1.*

### 6.1 The decision

The implied-types spec (and therefore user-implementable `Iterable`) is **v2, on first demand** — written when the first user-defined collection type wants `for..in`, not before. Until then, `toSeq : T -> Seq(a)` conversion functions are the seam, exactly as Loops §7.1 provides, and `Seq(a)` parameters remain the generic idiom.

### 6.2 Rationale (recorded so the deferral is understood as risk management, not neglect)

Two independent reasons, either sufficient:

1. **Inference risk.** The deferred-`Elem(α)` goal mechanism is *the first feature that touches `unify`'s environs* — everything shipped so far (constraints as dictionaries, defaulting, row polymorphism for records) rides beside Algorithm J without modifying its core discipline. Leaving that known-safe area deserves a dedicated, unhurried session with the whole design in front of it, not a rider on a collections milestone.
2. **Calibration wants a specimen.** The settled core (member `type Elem`, `implement`-side `type Elem = ...`, coherence-backed table lookup) won't move, but the periphery is exactly the part a first real client would pressure-test: reference syntax (`Elem(c)` vs projection-style `c.Elem` — unknowable until real signatures are written in anger), whether implied types carry obligations (`type Elem: Show`), whether use-site equality constraints (`Iterable<Elem = Int>`-style) are ever needed or `Seq(Int)` parameters cover it, how eagerly deferred goals must force and what the annotation-required error should say, and hover/`.d.ts` display. All calibration, no design risk — and calibration without a specimen produces the wrong grammar with confidence.

### 6.3 What this does *not* reopen

The v1 compiler-known `Iterable` judgment (internal table, never leaks into signatures, unsolved iterable tyvar ⇒ annotation-required error — Loops §7) is unchanged and unblocked. The design sketch in Loops §7.2/§11.1 remains the sketch of record; this doc adds only the timing decision and its rationale. `AsyncSeq` remains a committed direction whose spec (per Loops §11.4) does **not** depend on implied types and may precede them.

---

## 7. Edit notes to existing specs

Apply on next touch of each document; until then this doc governs.

1. **Constraints §9.5** → resolved; replace with a pointer to §1 here. **§9.2** → mechanism half resolved (opt-in `derive`, §2 here); the remaining text should keep only the pointer. **§9.7** → resolved (§3 here); update the prelude listing's `Ordering` when written. **§8** diagnostics table → add the §2.6 rows.
2. **Primitive Types §3** → the promised `NaN`/`-0` treatment is §1 here; add the cross-reference and strike the promissory language. If §3 currently implies `===` is the universal `Eq<Float>` emission, correct per §1.5.
3. **Lexer & Layout §2** → replace the bracketed tabs flag with: "Tabs in leading whitespace are a hard error (Decisions Batch §4); columns are space-counted." **§5/§6** → add the §4.3 diagnostic row and a decisions-log line.
4. **Loops/Ranges/Iteration §11.2** → resolved (v2 on first demand, §6 here). **§11.7** → the partiality leaning is now decided (§5 here); the clamp-vs-throw open question inside it is closed (clamp). **§11.1** → append: "Timing: v2, on first demand — Decisions Batch §6."
5. **Products §3.4** → the "record `Ord` droppable?" flag is dissolved by opt-in derivation (§2.4 here); nominal instances now arrive only via `derives`/`implement`. Structural-record automatic instances unchanged.
6. **Unions** (derived-instances section) → nominal unions now receive derived instances via §2's opt-in forms; semantics unchanged. All-nullary prelude `Ordering` per §3.
7. **Modules spec (future)** → the constraint-name/constructor namespace question remains owed but is flagged **no longer load-bearing** (§3.2 here).
8. **Exceptions §10.4** → the no-instances presumption for `Exn` is now also enforced syntactically by §2.6's `derives`-on-`exception` error; note when confirming in the stdlib listing.
9. **Indexing/collections spec (future)** → must restate §5 as its partiality section; §5.4 lists what it still owes.
10. **Stdlib listing (future)** → `Ordering` spelling (§3); `Float` instance semantics (§1); `Hash<Float>` constraint if `Hash` ever ships (§1.4); `Range` `Eq`/`Show` (still open per Loops §3.6, untouched here).

---

## 8. Diagnostics checklist (consolidated)

| Situation | Error / hint | Section |
|---|---|---|
| Tab in leading whitespace | "tab character in indentation; Hexagon indentation uses spaces only" + space fixit | §4.3 |
| `==`/`show`/`<` on nominal type lacking instance | unsatisfied-constraint phrasing + "add `derives Eq` to the declaration of `Point`, or write an `implement`" | §2.6 |
| `derive` for non-derivable constraint | "`Num` cannot be derived; only `Eq`, `Ord`, and `Show` have derivable forms" (likewise for `Signed`) | §2.6 |
| Underivable field/slot | "cannot derive `Eq<Point>`: field `f` has type `T`, which has no `Eq` implementation" | §2.6 |
| `derives Ord` without `Eq` | missing-superconstraint error + "add `Eq` to the `derives` list" | §2.6 |
| `derive` outside `implement` RHS | "`derive` is only legal as the body of an `implement`" | §2.6 |
| `derives` on `exception` | "exceptions have no derived instances" | §2.6 |
| `xs[i]` out of bounds | runtime `IndexError` (not a diagnostic; listed for the boundary) | §5.1 |

`NaN`/`-0` and `Ordering` produce no new diagnostics; slicing produces none by design.

---

## 9. Acceptance tests (golden: inferred type, runtime value, emitted JS)

```
-- (a) SameValueZero Eq<Float>
nan() == nan()                 -- true    (nan() : Float returning NaN)
0.0 == -0.0                    -- true
1.0 == 1.0                     -- true; emits a === b || (Number.isNaN(a) && Number.isNaN(b))
                               --        (or the __hex_floatEquals helper)

-- (b) Ord<Float> total order
compare(nan(), nan())          -- Equal
compare(1.0/0.0, nan())        -- Less      (NaN after +Infinity)
compare(0.0, -0.0)             -- Equal
sort([nan(), 1.0, -0.0, 0.0/0.0, 2.0])
                               -- [1.0, 2.0, NaN, NaN]-shaped: NaNs last, stable

-- (c) Map key coherence (the reason for all of it)
let m = Map.fromList([(nan(), "a")])
Map.get(m, nan())              -- Some("a"); agrees with (b): keys that are
                               -- `equals` are the same key, always

-- (d) Int untouched
1 == 1                         -- true; emits a === b, no NaN clause

-- (e) Opt-in derivation
record Point = {x: Float, y: Float} derives (Eq, Show)
Point({x: 1.0, y: 2.0}) == Point({x: 1.0, y: 2.0})   -- true
record Blob = {x: Float}
Blob({x: 1.0}) == Blob({x: 1.0})
   -- ERROR: `Blob` has no `Eq` implementation
   --        hint: add `derives Eq` to the declaration of `Blob`

implement Ord<Point> = derive  -- OK iff Eq<Point> exists (it does, via derives)

record Handler = {f: Int -> Int} derives Eq
   -- ERROR: cannot derive `Eq<Handler>`: field `f` has type Int -> Int,
   --        which has no `Eq` implementation

-- (f) Ordering spelling and emission
compare(1, 2)                  -- Less;  runtime value the string "Less"
match compare(a, b)
  Less => ...
  Equal => ...
  Greater => ...               -- exhaustive, no wildcard needed

-- (g) Tabs
<TAB>print("hi")               -- LEX ERROR: tab character in indentation;
                               --            Hexagon indentation uses spaces only

-- (h) Index throws, slice clamps
let xs = [10, 20, 30]
xs[3]                          -- 30
xs[4]                          -- throws IndexError
xs[2..99]                      -- [20, 30];  emits xs.slice(1, 99) — native clamp
xs[5..9]                       -- []
xs[3..1]                       -- []         (empty range, Loops §3.4; same rule)
```

---

## 10. Hanging questions (recorded, not decided)

1. **Negative indices** — presumed absent (§5.4); confirm in the indexing/collections spec.
2. **`Float.ieeeEquals` / raw-IEEE escape hatches** — plausible stdlib functions for the rare caller who wants `NaN != NaN`; stdlib listing's call, nothing here depends on them.
3. **`derives` clause placement for parameterized records** — rides on the declarations-preamble spec's header grammar (§2.5); the clause's semantics are fixed here, only its position is owed there.
4. **Derivable-set growth** — future derivable constraints (a `Hash`, a `Default`?) join the §2 whitelist by amendment; the whitelist-not-open-set stance is the decision.

---

## 11. Decisions log

| Decision | Where |
|---|---|
| `Eq<Float>` = SameValueZero; rationale = key coherence with JS `Map`/`Set` and Immutable.js (`Immutable.is` documented SameValueZero), not "JS says so" | §1.1–1.2 |
| `Ord<Float>` = consistent total order: IEEE on non-NaN, `+0`/`-0` Equal, NaNs mutually Equal and after `+Infinity` (`Float64Array.sort` precedent) | §1.1–1.2 |
| Honest-IEEE `Eq`, `total_cmp`-verbatim, and SameValue all rejected with reasons | §1.3 |
| `Hash<Float>` (if ever) must normalise `-0` and NaN | §1.4 |
| `Eq<Int>` keeps bare `===`; `Eq<Float>` fast path = two-clause expression or on-demand helper | §1.5 |
| Derivation is opt-in; `implement C<T> = derive` core form; `derives (...)` header sugar | §2.1 |
| Derivable set (v1): `Eq`, `Ord`, `Show`; whitelist stance | §2.1, §10.5 |
| Derived instances are ordinary instances: coherence slot, superconstraint checks, orphan rule | §2.1 |
| F#-style automatic (and automatic-with-opt-out) rejected; "nominal means you control the surface" governs | §2.2–2.3 |
| Record-`Ord`-shipping question dissolved by opt-in | §2.4 |
| Structural types keep automatic instances; users still cannot `implement` for them | §2.1; Constraints §9.3 presumption stands |
| `Ordering = Less \| Equal \| Greater` (Rust spelling); `LT/EQ/GT` and int-returning `compare` rejected | §3 |
| Namespace question de-fanged, still owed to modules spec | §3.2, §7.7 |
| Tabs in leading whitespace: hard lexer error, no tab-width, no escape hatch; F#/Elm/Nim lineage, Haskell as documented rejection; mandatory fixit | §4 |
| `xs[i]` throws `IndexError`; `xs[lo..hi]` clamps (Python split); assert-vs-request rationale; bare-`.slice()` emission payoff; throw-both (Rust) recorded as principled runner-up | §5 |
| Implied types / user `Iterable`: v2, on first demand; inference-risk + calibration-wants-a-specimen rationale; `toSeq` remains the seam | §6 |
