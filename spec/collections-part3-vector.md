# Hexagon Spec: Collections Part 3 — `Vector(a)`

**Status:** Decided (July 2026). The authoritative `Vector(a)` specification: literals, vector patterns, indexing/slicing (`[]`, `at`, `get`, `IndexError`, `SliceError`), the core API with totality decisions, the `Concat`/`Eq`/`Ord`/`Show`/`Hash`/`Iterable` instances, String indexing under the same doctrine, and emission. Written against Collections Parts 1–2, Pattern Matching, Operators §7/§14, Loops §3/§5, and Exceptions; none re-litigated.
**Scope:** As above, plus: the `at` accessor (signed, from-end addressing) and its equations; the descending-`Range` slice rule (windows have no direction) and the `SliceError` exception; the `IndexError` declaration; negative bracket-indexing rejected with reasoning; slice complexity pinned into the Part 1 table.
**Not in scope:** `Map`/`Set` (Part 4 — including `KeyError`, declared nullary there, §4.3); the normative `Iterable` spec, table-opening, and the `Bag` worked example (Part 5); the full stdlib combinator listing for `Vector` (`map`, `filter`, `fold`, `reverse`, `sort`, `insertAt`, … — `stdlib-roadmap.md`; this doc fixes the *core* surface only, §7); `Array(a)` and its copying conversions (FFI Part 2); range patterns (Pattern Matching §11.2, untouched); String *iteration* (Collections Part 5 §5 — §9 here is indexing only).
**Companions:** Collections Part 1 (representation/complexity §2 restated and extended; naming doctrine §3 applied; accessor-pair doctrine §3.3 instantiated); Collections Part 2 (`Hash<Vector(a)>` under its §4.4 wording; `Iterable` instance row); Collections Parts 4–5; Pattern Matching (§2 grammar includes the vector pattern; §11.1 routes here); Operators (§7 `Concat` doctrine; §14 bracket grammar); Loops (§3 `Range` opacity relied on; §5 table row); Exceptions (owed the `IndexError` and `SliceError` declarations, §13); Primitive Types §5 (String codepoint doctrine, bracket-indexed here); Constraints (§4.3 parameterized instances; §7 `Ord<Float>` totality); FFI Part 2 (`Array(a)` and `Vector.toArray`).

---

## 1. Doctrine

- **`Vector` is the workhorse sequence and looks like one.** Literal `[1, 2, 3]`, patterns `[x, ...rest]`, indexing `xs[i]` — the JS-shaped surface the audience expects, over the persistent trie deque Part 1 pinned.
- **Brackets assert; names answer.** `xs[i]` and `Vector.set` assert existence and throw `IndexError`; `Vector.get` answers with `Option`. `Vector.at` is the bracket's *signed* sibling — an assertion with from-end addressing, opted into by name (§5.3).
- **Windows have no direction.** A slice is a window, not a traversal; ranges are for iterating. An empty window is a valid answer (clamping); a *directed* window is a category error (`SliceError`, §6.3). Out-of-window clamps; direction throws.
- **Costs are stated, not hidden.** A rest pattern is a slice of a trie, not a shared tail; slice complexity is pinned (§4); `++` stays documented-linear (Part 1 §2.2); String indexing is O(n) and says so (§9).
- **The rest pattern spells `...`** — the TS/JS rest cognate and the Products row-tail family ("and the remainder"), never `..`, which is the range operator and means something else.

---

## 2. Literals

```
let xs = [1, 2, 3]          -- Vector(Int)
let ys = []                 -- Vector(α), generalizes
let zs = [f(a), g(b)]       -- elements are arbitrary expressions
```

- `[e1, e2, …, en]` in expression-head position is the `Vector(a)` literal — the reading Operators §14 reserved this position for. Postfix `xs[…]` remains indexing/slicing; the lexer/parser distinguish by position exactly as Operators §14 specified.
- All elements unify to one type; a heterogeneous literal is an ordinary type error at the first offending element.
- `[]` types as `Vector(α)`. It is a syntactic value, so `let xs = []` generalizes normally (value restriction satisfied); `xs` is polymorphic until used.
- Elements are evaluated left to right (the uniform evaluation order).
- **Trailing comma is permitted** in a literal with at least one element (`[1, 2, 3,]`); `[,]` is a parse error. The JS habit, at zero cost. Record and tuple literals state the same rule (Products §3.1).
- **No spread in literal expressions.** `[x, ...ys]` as an *expression* is a parse error with a fixit: "spread is pattern syntax; write `prepend(ys, x)` or `[x] ++ ys`." Rejected alternative §11.3.
- Emission: `Vector.of(1, 2, 3)`; `[]` emits the shared `Vector.empty` constant. Readable, allocation-honest.

---

## 3. Vector patterns

The vector pattern is one form in the single pattern grammar (Pattern Matching §2), subject to every existing rule: the five positions, the one irrefutability gate, the whole-pattern duplicate check, full nesting. **Binder class is positional, never chosen by pattern syntax** (Pattern Matching §1; Statements §5): a vector pattern in a `match` arm, `catch` arm, lambda parameter, or loop head introduces **head binders**; on a `let` LHS it introduces **sequential binders** (Statements §5.4). This document owns the vector-specific forms, length-based coverage, irrefutability, costs, and emission; Pattern Matching owns everything general.

### 3.1 Forms

```
[]                          -- exactly empty
[p1, p2, …, pn]             -- exactly n elements, each matched by pi
[p1, …, pk, ...rest]        -- at least k; rest binds the remainder (a Vector)
[...init, pn]               -- at least 1; init binds all but the last
[p1, ..., pn]               -- at least 2; anonymous rest between
```

- Element slots take the **full nested grammar** — constructor patterns, tuples, records, literals, or-patterns, as-patterns, further vector patterns: `[Some(x), _, ...rest]`, `[{name}, ...]` are legal.
- **At most one rest per vector pattern**, at any position (Rust slice-pattern precedent). Two rests: hard error, "a vector pattern may contain at most one `...`". The trie deque makes any-position honest: both ends are O(1) amortized (Part 1 §2), so none of `[x, ...rest]`, `[...init, last]`, `[first, ..., last]` hides a cost cliff — the cons-list objection to left-rests does not apply to this representation and the doc says so.
- A rest may be a binder (`...rest` — binds a `Vector(a)` of the unmatched middle) or anonymous (`...`).
- **Spelling is `...`** (three dots). `..rest` or a bare `..` in a vector pattern is an error with the fixit "Hexagon spells rest patterns with `...`" — `..` is the range operator and does not appear in patterns.
- A rest binder participates in the whole-pattern duplicate check like any binder; `...` binds nothing and may not repeat (one-rest rule already forbids it).

### 3.2 Typing

`[p1, …, pn]` (with or without rest) checks against scrutinee type `Vector(t)`; each element sub-pattern checks against `t`; a rest binder gets type `Vector(t)`. Against an unknown scrutinee type, the pattern *constrains* it to `Vector(α)` — vector patterns work in lambda heads and `let` under inference like every other form (Pattern Matching §4/§6.5), subject to the gate (§3.4).

### 3.3 Exhaustiveness and reachability

Vector patterns partition **by length** (the Rust slice-pattern treatment), integrated into the one Pattern Matching §7 algorithm — no second machinery:

- Lengths are unbounded, so a match using only fixed-length vector patterns is non-exhaustive; the §7.3 witness printer renders the counterexample as a length the arms miss (e.g. `[_, _, _]`).
- `[]` + `[_, ...]` is exhaustive. `[]` + `[x]` + `[x, y, ...rest]` is exhaustive. `[...rest]` alone is exhaustive.
- Specialization: a pattern with k fixed slots and a rest covers all lengths ≥ k; a fixed pattern covers exactly its length; element sub-patterns then decompose per the existing constructor machinery. Reachability falls out of the same matrix: after `[...rest]`, everything is unreachable; `[_, _]` after `[_, ...]` is unreachable.
- Guarded arms contribute nothing to coverage, as always (Pattern Matching §3).

### 3.4 Irrefutability

A vector pattern is irrefutable **iff it matches every length**: exactly the forms `[...rest]` and `[...]` (with irrefutable element sub-patterns — vacuously true, there are none). Everything else can fail on length:

```
let [x, ...rest] = xs        -- ERROR: this pattern can fail: []; use `match`
let [...all] = xs            -- OK (legal, pointless, and the checker doesn't judge)
for [k, v] in pairs ...      -- ERROR (same gate; match inside the loop instead)
```

Same uniform gate message, same witness printer (Pattern Matching §5.3).

### 3.5 The cost story, stated in the spec

**A rest binder is a slice, not a shared tail.** Binding `...rest` builds a `Vector` by trie slice — §4's pinned O(log₃₂ n), effectively O(1) amortized at either end via the origin/capacity technique. Consequences the doc states plainly: peeling `[x, ...rest]` in a recursive loop is fine (amortized O(1) per step, either end); this is *not* a cons list and `rest` shares structure with the original only as the trie happens to allow — no O(1)-tail-sharing guarantee exists or is implied. (This paragraph is the honesty Part 1 §1 promised when it refused the `List` name.)

### 3.6 Emission

Length test + indexed reads, readable:

```
-- match xs with [a, b, ...rest] => …
if (xs.size >= 2) {
    const a = xs.get(0), b = xs.get(1);
    const rest = xs.slice(2);
    …
}
```

Fixed-length patterns emit `size === n`; rest-carrying emit `size >= k`; anonymous rests emit no slice. (Runtime `get`/`slice` here are the 0-based internals; the 1-based↔0-based offset is an emission fact, invisible at the source level.)

---

## 4. Representation, complexity, and the pinned slice row

`Vector(a)` is the Part 1 §2 persistent 32-way bit-partitioned trie deque from `@hexagon/runtime`. Immutable.js is lineage and influence for this structure; Hexagon owns its runtime — nothing here is defined by reference to another library's behaviour. This doc **extends the pinned complexity table** with the row Part 1 left open:

| Operation | Bound |
|---|---|
| `slice` (any window) | **O(log₃₂ n)** |
| *(note)* end slices (`dropFirst`/`dropLast`-shaped, incl. end rests) | effectively O(1) amortized (origin/capacity) — stated as a note, not a bound |

All other rows (get/set O(log₃₂ n), both ends O(1) amortized, `++` linear) stand as pinned. The row is owed back to Part 1 §2's table (§13).

---

## 5. Indexing: `[]`, `at`, `get`, `set`, and `IndexError`

### 5.1 The bracket

- `xs[i]` with `xs : Vector(a)`, `i : Int` — **1-based**; yields the element; **throws `IndexError`** when `i < 1` or `i > size(xs)`. `xs[i]` asserts "element `i` exists" and fails loudly at the fault site.
- `[]` is **read-only** — it never appears in a write position (there is no assignment-to-index grammar in Hexagon at all; updates are `Vector.set`).
- **Negative indices are absent — decided.** `xs[-1]` throws `IndexError` like any other out-of-bounds value. Reasoning recorded in §11.1 (silent-wrap drift hazard; the `0` dead zone is one value wide under 1-based indexing; slices cannot follow coherently). The end-relative want is served by `at` (§5.3), `last`, and `dropLast`.
- Emission: monomorphic `xs[i]` emits a runtime indexed read with the bounds check that produces `IndexError`. JS returns `undefined` out of bounds, so a check exists either way; the throwing form wins on type cleanliness — `xs[i] : a` with no hole.

### 5.2 `Vector.get` — the total sibling

`Vector.get(v: Vector(a), i: Int): Option(a)` — same 1-based index, `None` out of bounds (including `i < 1`), never throws. The uniform accessor pair (Part 1 §3.3), instantiated.

### 5.3 `Vector.at` — the signed sibling

```
Vector.at : (Vector(a), Int) -> a
```

- **Positive domain: `at` is `[]`, definitionally.** For `i ≥ 1`, `at(v, i) ≡ v[i]` — an equation, not a coincidence: `[]` on a vector *is* the runtime's positive lookup, and `at`'s positive branch is the same lookup. The two cannot drift.
- **Negative domain: from-end addressing.** For `i ≤ -1`, `at(v, i) ≡ v[size(v) + i + 1]` — so `at(v, -1)` is the last element, `at(v, -size(v))` the first. Equivalent formulation for the docs: `at(v, -n) = v[size(v) - n + 1]`.
- **`at(v, 0)` always throws.** Zero is never an address in a 1-based world; the dead zone between the domains stays dead (and remains the guard rail where index drift lands first).
- `at` **throws `IndexError`** whenever the resolved position doesn't exist — it is the bracket's signed sibling, an *assertion* with from-end power, not a third total accessor (`get` remains the only total one; a total-and-signed accessor is a v2-on-field-evidence question, §12.3).
- The `IndexError` payload carries **the index as passed** (the `-4`, not the normalized position) — the payload describes what the caller said; fault-site honesty.
- Lineage, stated in the doc: JS `Array.prototype.at` (ES2022) has exactly this signed-addressing contract for exactly this audience — the name is their muscle memory. The one deliberate departure: JS `at` returns `undefined` out of range; Hexagon's throws, per the accessor doctrine (`undefined`-shaped holes are what `[]` exists to reject).
- Signed addressing is **opt-in by name**: computed indices flowing into `[]` still fail loudly when they drift negative; only a call that *says* `at` gets wraparound. This is the design's entire point (§11.1).

### 5.4 `Vector.set` — write-side assertion

`Vector.set(v: Vector(a), i: Int, x: a): Vector(a)` — persistent update at 1-based `i`; **throws `IndexError`** when `i` is out of range (a write asserts the slot exists; extending is `append`/`prepend`). No signed form and no total sibling in v1 (`trySet` stays unspent per the `try` doctrine, Part 1 §3.3). Set never extends — growing with holes (the JS array behaviour) is exactly what the check exists to prevent.

### 5.5 The `IndexError` declaration

Declared here, housed in the prelude (edit note to Exceptions, §13):

```
exception IndexError(index: Int, size: Int)
```

- Concrete payload (satisfies Exceptions §2's no-type-variables rule); named slots per the all-or-none rule; positional construction and catch patterns as always.
- `index` is the index as passed (§5.3); `size` is the collection's size at fault time. Sufficient for the canonical message ("index 5 out of bounds for size 3") without a `String` slot; message rendering is the reporting layer's business (Exceptions doctrine).
- `KeyError` does not copy this shape — a polymorphic key cannot be a payload (Exceptions §2 bans type variables). It is declared **nullary** in Part 4 §4.3, which owns that decision.

---

## 6. Slicing

### 6.1 Semantics

`xs[r]` with `r : Range` — any `Range`-valued expression, not just a literal `lo..hi` (Operators §14). For an **ascending** range: the window is intersected with the valid index range `1..size(xs)`; out-of-window portions are silently dropped; a fully-out-of-window or empty range yields the empty vector. 1-based, inclusive at both ends, per the global doctrine.

```
let xs = [10, 20, 30]
xs[2..3]      -- [20, 30]
xs[2..99]     -- [20, 30]        (clamped)
xs[5..9]      -- []              (fully out of window)
xs[3..1]      -- []              (empty ascending range: lo > hi)
```

- `xs[5..2]` can never error: `..` builds ascending only (Loops §3.1), so `5..2` is the *empty ascending range*, and clamping yields `[]`. Literal slices are total, always.

### 6.2 Complexity and emission

O(log₃₂ n) per §4. Emission: `xs.slice(lo - 1, hi)` — the runtime's slice clamps natively, so the ascending path is a single call with zero guard code, modulo the 0-based offset. General `Range`-valued slices go through a small runtime helper that reads the range's bounds and direction (and implements §6.3).

### 6.3 Descending ranges: `SliceError` — windows have no direction

The forced corner: `Range` is first-class and opaque with a hidden direction (Loops §3.1), so `xs[rangeDown(5, 2)]` typechecks and must mean something.

> **A descending `Range` in slice position throws `SliceError`.**

Doctrine (the design's story, stated in the doc): **ranges are for iterating; slices are windows, and windows have no direction.** An empty window is a valid answer — that is what clamping honors. A *directed* window is a category error — the caller has confused traversal with windowing — and category errors fail loudly. Reversal is explicit: `Vector.reverse(xs[2..5])` (`reverse` owed to the stdlib listing).

The exception, declared here, housed in the prelude (edit note to Exceptions, §13):

```
exception SliceError(start: Int, end: Int)
```

A distinct exception, not an `IndexError` — on payload grounds, decisively: in a descending-window slice **no index is out of bounds and no single index is wrong**; `IndexError(index, size)` cannot describe the fault without lying in a slot. `SliceError` carries the range's endpoints as the caller supplied them. (C# `Span` precedent: reversed ranges throw rather than reverse or clamp.)

**"Never an error" is scoped to magnitude: out-of-window clamps; direction throws.** The only way to reach `SliceError` is a descending `Range` value (`rangeDown` or a function returning one); no `..` literal can.

### 6.4 String slices

Per §9: same rules, codepoint windows.

---

## 7. The core API

The core surface, under the Part 1 §3 naming doctrine (subject-first, `Vector.` prefixed; bare names when imported). The full combinator set (`map`, `filter`, `fold`, `reverse`, `sort`, `contains`, `indexOf`, `insertAt`, `removeAt`, …) is ledgered in `stdlib-roadmap.md`; this doc fixes the core:

| Function | Type | Notes |
|---|---|---|
| `empty` | `Vector(a)` | the `[]` value |
| `singleton` | `a -> Vector(a)` | |
| `isEmpty` | `Vector(a) -> Bool` | |
| `size` | `Vector(a) -> Int` | O(1) |
| `append` | `(Vector(a), a) -> Vector(a)` | O(1) am. |
| `prepend` | `(Vector(a), a) -> Vector(a)` | O(1) am. |
| `first` / `last` | `Vector(a) -> Option(a)` | total (Part 1 §3.1) |
| `dropFirst` / `dropLast` | `Vector(a) -> Vector(a)` | **total: empty → empty** (§7.1) |
| `get` | `(Vector(a), Int) -> Option(a)` | §5.2 |
| `at` | `(Vector(a), Int) -> a` | §5.3, throws |
| `set` | `(Vector(a), Int, a) -> Vector(a)` | §5.4, throws |
| `toSeq` / `fromSeq` | `Vector(a) -> Seq(a)` / `Seq(a) -> Vector(a)` | §7.2 |
| `of`-style construction | — | the literal is the constructor; no public variadic `of` (emission detail, §2) |

### 7.1 `dropFirst`/`dropLast` on empty: total

`dropFirst(empty) = empty`; likewise `dropLast`. "Drop" vocabulary sits in the forgiving family with slices (Kotlin `take`/`drop` company): the name requests, it does not assert. The asserting reading would make them throw — rejected (§11.4); a caller who needs the assertion writes `xs[2..size(xs)]`… which clamps too, so genuinely assertive callers match on `[_, ...rest]` or check `isEmpty`. Consistency note the doc states: `first`/`last` answer emptiness with `None`; `dropFirst`/`dropLast` answer it with `empty`; `[1]`-the-bracket asserts. Three intents, three behaviours, all named.

### 7.2 `fromSeq` is eager

`fromSeq` materializes the whole sequence; on an infinite `Seq` it diverges. Documented in one line; not a defect — `Vector` is finite by nature, and the lazy world is `Seq`'s (Loops §6).

---

## 8. Instances

All compiler/runtime-provided (Part 2 §4.4 wording — specified normatively here, no source form):

| Instance | Given | Semantics |
|---|---|---|
| `Iterable<Vector(a)>` | — | `type Item = a`; `iterate` = `toSeq`. The Loops §5 table row. |
| `Concat<Vector(a)>` | — | `concat` = trie concatenation, **documented linear** (Part 1 §2.2). The Operators §7 instance for `Vector`. The fusion note (`a ++ b ++ c` → one multi-arg runtime concat) is an *emitter freedom*, not a semantic promise. |
| `Eq<Vector(a)>` | `Eq a` | size check, then elementwise `equals`, left to right. |
| `Ord<Vector(a)>` | `Ord a` | **lexicographic**: first unequal element decides; a proper prefix is less (`[1,2] < [1,2,0] < [1,3]`). Rust/Haskell/OCaml-unanimous semantics; total given total `Ord a` (which Hexagon's always is — `Ord<Float>` is a total order, Constraints §7). Makes vectors sortable and future-`SortedMap`-keyable. |
| `Show<Vector(a)>` | `Show a` | renders as the literal: `[1, 2, 3]`; `[]` for empty. **Literal-shaped display, not serialization**: the output is not guaranteed parseable — `Show<String>` is unquoted (Primitive Types §7), so element renderings can be ambiguous (`show(["a, b"])`). A debugging/diagnostics surface, like every `Show`. |
| `Hash<Vector(a)>` | `Hash a` | order-dependent combine over element hashes; law-consistent with the elementwise `Eq` by construction; algorithm runtime-owned per Part 2 §3.2. |

Constraint propagation is the standard parameterized-instance shape (Constraints §4.3): `Eq<Vector(Vector(Int)))>` resolves through `Eq<Vector(a)> given Eq a` twice; unsatisfied element constraints surface as ordinary unsatisfied-constraint errors at the use site.

---

## 9. String indexing

Part 1 §3.3's accessor doctrine extends to `String` here. **Unit of addressing: the Unicode codepoint** — already String's global doctrine (Primitive Types §5.1: length and indexing are codepoint-based, 1-based). The reasoning, recorded: UTF-16 code units (the JS default) rule out too many sensible characters (astral-plane letters, emoji split into surrogates); grapheme clusters are culturally defined and version-unstable; codepoints win by default. Grapheme-aware operations, if ever, are named stdlib functions, never `[]`.

- `s[i]` — the codepoint at 1-based index `i`, **as a one-codepoint `String`** (there is no `Char` type; Primitive Types is explicit). Throws `IndexError` out of bounds; same payload.
- `String.get(s, i): Option(String)` — total sibling.
- `String.at(s, i): String` — signed sibling, identical §5.3 semantics (equation included), codepoint-addressed.
- `s[lo..hi]` — clamping codepoint window; descending `Range` throws `SliceError`; identical §6 rules.
- **Cost, stated in bold in the doc: codepoint indexing is O(n)** (surrogate pairs make position a scan, not an offset). `s[i]` in a loop over `1..length(s)` is O(n²); the linear idiom is `for c in s` — a single O(n) pass yielding one-codepoint `String`s (Collections Part 5 §5) — or `String.toSeq`. The bracket is for occasional access; the doc says exactly that.
- Emission: runtime codepoint helpers (`String.hex_at(s, i)`-shaped); no native JS bracket emission — JS `s[i]` is code-unit-addressed and 0-based, wrong twice.

---

## 10. Diagnostics checklist

| Situation | Error / behaviour | § |
|---|---|---|
| Heterogeneous literal | ordinary type error at first offending element | §2 |
| `[x, ...ys]` as expression | parse error + fixit "spread is pattern syntax; write `prepend(ys, x)` or `[x] ++ ys`" | §2 |
| `[,]` | parse error | §2 |
| Two rests in one vector pattern | "a vector pattern may contain at most one `...`" | §3.1 |
| `..rest` / bare `..` in a pattern | fixit "Hexagon spells rest patterns with `...`" | §3.1 |
| Fixed-length-only match | non-exhaustive; witness prints a missed length (e.g. `[_, _, _]`) | §3.3 |
| Unreachable arm after `[...rest]` | standard reachability error | §3.3 |
| Refutable vector pattern at `let`/`for`/lambda | uniform gate error "this pattern can fail: ⟨witness⟩; use `match`" | §3.4 |
| `xs[i]` out of bounds (incl. negative, 0) | runtime `IndexError(index, size)` | §5.1 |
| `at(v, 0)` | runtime `IndexError(0, size)` | §5.3 |
| `at`/resolved negative out of range | runtime `IndexError` carrying index as passed | §5.3 |
| `set` out of range | runtime `IndexError` | §5.4 |
| Descending `Range` in slice position | runtime `SliceError(start, end)` | §6.3 |
| `s[i]` out of bounds | runtime `IndexError` (codepoint index) | §9 |

Slicing by magnitude produces nothing by design (clamps). No new *static* diagnostics beyond the pattern rows — the type system already polices `Vector(a)` vs everything else.

---

## 11. Rejected alternatives (do not re-litigate)

### 11.1 Negative bracket indexing (`xs[-1]` = from-end)

Coherent formula (`xs[-n] = xs[size - n + 1]`), rejected for `[]`: it contradicts the assert doctrine's own rationale — wrong assertions must fail *loudly at the fault site*. Wraparound converts a drifted computed index into silently plausible data from the wrong end — a famous bug class in Python — and 1-based indexing thins the guard rail to the single value `0`. Slices cannot follow coherently (clamp-before-or-after-normalize ambiguity; Python's negative slices are the cautionary tale), leaving an asymmetry inside one bracket form. The legitimate want (end-relative access) is served by **`at`** (§5.3), where signed addressing is opt-in by name and computed indices flowing into `[]` keep their loud failure. C#-style `^` sigil syntax was also considered and rejected on aesthetic grounds (the power is `at`'s; the sigil bought nothing over a name).

### 11.2 `IndexError` for descending slices

Rejected on payload grounds: no index is out of bounds and no single index is wrong; `IndexError(index, size)` cannot describe the fault without a lying slot. `SliceError(start, end)` names the actual fault. (Also considered: H1 "window semantics," descending ⇒ empty by the `lo > hi` rule — silent, total, and zero machinery, but it lets a traversal-shaped value quietly mean nothing; the category error deserves a loud answer. H2 "element-sequence semantics," reversed gather — elegant, but redefines slicing as gather, invites step-ranges, and costs the native-`.slice()` guarantee.) C# `Span` is the precedent for throwing.

### 11.3 Spread in literal expressions

`[x, ...ys, z]` as expression syntax. Rejected for v1: `++`/`prepend`/`append` cover it with explicit costs; expression spread invites building large vectors by repeated splat (quadratic by accident); the pattern/expression asymmetry (rest destructures; concat constructs) is teachable in one line. Revisit only on field evidence of real ergonomic pain.

### 11.4 Throwing `dropFirst`/`dropLast`

The asserting reading. Rejected: "drop" names a request, not an assertion (Kotlin company); the throwing want is served by matching `[_, ...rest]` or `first` + explicit handling. A throwing drop would also break the forgiving-family symmetry with slices for no diagnostic gain.

### 11.5 RRB trees, `List` naming, `Ord`-keyed maps

Part 1's rejections; listed to keep this doc's rejection index complete. Do not relitigate here either.

---

## 12. Routed elsewhere (recorded, non-blocking)

1. *(resolved)* **`KeyError` payload shape** — decided in **Part 4 §4.3**: nullary (Exceptions §2 bans polymorphic payloads). Not open.
2. **Stdlib combinator listing for `Vector`** (incl. `reverse`, needed by §6.3's explicit-reversal idiom, and `sort`, which §8's lexicographic `Ord` makes useful) → `stdlib-roadmap.md`.
3. **Total-and-signed accessor** (a `get`-shaped `at`) → v2 on field evidence only; the pair stays a pair in v1 (§5.3).
4. *(resolved)* **String iteration element type** — decided in **Collections Part 5 §5**: one-codepoint `String`, `for c in s` O(n) total. Not open.
5. *(resolved)* **Trailing-comma statement for record/tuple literals** — applied: Products §3.1 states the rule. Not open.
6. **Expression spread** → §11.3's field-evidence condition.

---

## 13. Edit notes to companion specs (unapplied only)

| Doc | Edit |
|---|---|
| **operators-logic-precedence.md** | §7 still says "`List(a)` instance owed to the collections spec" — the instance is `Concat<Vector(a)>`, specified here §8; the fusion note is confirmed as emitter freedom. §10/§14 still defer indexing/slicing semantics as "that spec's open question" — now fixed: indexing throws `IndexError`, slicing clamps by magnitude / throws `SliceError` on direction (§5/§6 here); retire the deferral language. |
| **exceptions.md** | Prelude exceptions still lack **`IndexError(index: Int, size: Int)`** and **`SliceError(start: Int, end: Int)`** (declared here §5.5/§6.3); add on next touch. |
| **collections-part1-decisions.md** | §2 complexity table still lacks the **slice row** (O(log₃₂ n); end-slice note — §4 here); add on next touch. |
| **primitive-types.md** | Still says 1-based indexing is covered by a "forthcoming spec" (header not-in-scope line; §5.1 area) — String indexing is realized here via `[]`/`at`/`get` (§9); repoint and echo the O(n) cost note. |

---

## 14. Reserved

*Anchor retained for stable inbound references. The canonical decisions of this document live in §§1–13; there is no separate decisions table.*

---

## 15. Acceptance tests

```
-- (a) Literals and inference
let xs = [1, 2, 3]                    -- Vector(Int)
let e  = []                           -- Vector(α), generalizes
let bad = [1, "a"]                    -- ERROR: type mismatch at "a"
let t  = [1, 2, 3,]                   -- OK (trailing comma)
let sp = [x, ...ys]                   -- ERROR: spread is pattern syntax;
                                      --   write `prepend(ys, x)` or `[x] ++ ys`

-- (b) Patterns: forms and nesting
match xs
    [] => 0
    [x] => x
    [x, ...rest] => x + size(rest)      -- exhaustive: [] covers 0, [x] covers 1, third covers ≥1

match pairs
    [(k, v), ...] => k                  -- nested tuple in element slot
    [] => defaultKey

match ys
    [first, ..., last] => first + last  -- middle rest
    [x] => x
    [] => 0                             -- exhaustive

-- (c) Exhaustiveness by length
match xs
    [] => 0
    [a, b] => a + b                     -- ERROR: non-exhaustive; e.g. [_] not covered

-- (d) One rest only; spelling
match xs
    [...a, ...b] => 0                   -- ERROR: at most one `...`
match xs
    [x, ..rest] => x                    -- ERROR: Hexagon spells rest patterns with `...`

-- (e) Irrefutability gate
let [x, ...rest] = xs                 -- ERROR: this pattern can fail: []; use `match`
let [...all] = xs                     -- OK

-- (f) Indexing family
xs[2]                                 -- 20 (for xs = [10,20,30])
xs[4]                                 -- throws IndexError(4, 3)
xs[-1]                                -- throws IndexError(-1, 3)
Vector.get(xs, 4)                     -- None
Vector.at(xs, 2)                      -- 20  (≡ xs[2])
Vector.at(xs, -1)                     -- 30
Vector.at(xs, 0)                      -- throws IndexError(0, 3)
Vector.set(xs, 9, 0)                  -- throws IndexError(9, 3)

-- (g) Slices: magnitude clamps, direction throws
xs[2..99]                             -- [20, 30]
xs[3..1]                              -- []       (empty ascending range)
xs[rangeDown(3, 1)]                   -- throws SliceError(3, 1)

-- (h) Drop family: total
Vector.dropFirst([])                  -- []
Vector.dropFirst([1, 2])              -- [2]

-- (i) Instances
[1, 2] == [1, 2]                      -- true          (Eq)
[1, 2] < [1, 2, 0]                    -- true          (Ord: proper prefix is less)
[1, 3] > [1, 2, 99]                   -- true          (Ord: first unequal decides)
show([1, 2])                          -- "[1, 2]"      (Show)
[1] ++ [2, 3]                         -- [1, 2, 3]     (Concat; linear, documented)
for x in [1, 2, 3]                    -- Iterable: Item = Int
    total := total + x

-- (j) String, same doctrine
let s = "héllo"
s[2]                                  -- "é"  (codepoint, 1-based)
s[9]                                  -- throws IndexError(9, 5)
String.at(s, -1)                      -- "o"
s[2..4]                               -- "éll"
s[rangeDown(4, 2)]                    -- throws SliceError(4, 2)
```
