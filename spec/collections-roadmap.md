# Hexagon Collections Roadmap

**Status:** **Completed (July 2026)** — all five parts Decided; retained as a historical record of the plan. The part documents are authoritative; nothing here remains open. Exports live on in the stdlib listing and FFI agenda (see Part 5 §16).
**Purpose:** The Collections effort is the largest remaining spec; this cuts it into parts with recorded dependencies, so each session lands a complete document against settled ground. Update as parts land; strike entries and migrate newly-discovered debts, per the main roadmap's convention.
**Relation to the main spec roadmap:** replaces the roadmap's single "Collections" Tier-1 entry with this breakdown. The main roadmap's Tier-3 associated-types entry is re-scoped by Part 1 §6.4.

---

## Part 1 — Foundational Decisions ✅ DONE

**Document:** `collections-part1-decisions.md` (Decided, July 2026).

Fixed: the `Vector(a)` name and the `List` reservation; trie-deque representation and the complexity contract (RRB rejected for v1); the naming doctrine (modern functional, subject-first; LISP/Haskell/JS-mutation names banned); the uniform accessor pair (`[]` throws `IndexError`/`KeyError`, `get` is total and `Option`-returning; `try` prefix reserved to mean non-throwing); the hash-based key model with `Hash` as a v1 derivable-only constraint implying `Eq` (`Ord`-tree default rejected; `SortedMap`/`SortedSet` pre-registered v2); uniform `toSeq`/`fromSeq`; restricted user-implementable `Iterable` in v1 (amending Decisions Batch §6 / Loops §11.1); `++` boundaries.

Everything below is written against these decisions; none is open for re-litigation.

---

## Part 2 — `Hash` Constraint & Constraint Type-Members (prerequisite machinery) ✅ DONE

**Document:** `collections-part2-hash-and-type-members.md` (Decided, July 2026, incl. §16 correction records). Part 4's determinism fine-print question arrived pre-answered by its §2.4/§16.2: iteration order promises nothing across runs.

The grammar/constraint groundwork the later parts consume. Two halves, one document:

**A. The `Hash` constraint, formal spec.**
- Declaration shape; `Eq` superconstraint; member surface (`hash : (a) -> Int`? — exact member and its codomain need deciding; note `Int`'s f64 invariant).
- **Derivable-only wording**: joins the Decisions Batch §2 derivation whitelist; users cannot write `implement Hash<T>`; the *stdlib* may bless instances for its own types (needed by Part 4 for `Hash<Vector(...)>` etc.). The wording must make the user/stdlib asymmetry precise.
- `Hash<Float>` per Decisions Batch §1.4 (activated by Part 1 §4.1); `Hash<Int>`, `Hash<String>`, `Hash<Bool>`, structural records/tuples via derivation.
- Law: `equals(a, b)` implies `hash(a) == hash(b)`; guaranteed by construction under derivable-only, stated anyway.
- Diagnostics: unsatisfied `Hash` (hint: `derives (Hash)`), attempted hand-written instance.
**B. `type` members in `constraint` / `implement` bodies.**
- The Loops §7.2 sketch, promoted: grammar for `type Elem` (declaration side) and `type Elem = a` (implement side); keyword sharing with the module-level alias, position-disambiguated (three positions, one keyword — the Rust precedent).
- Namespacing of associated-type names (constructor-rule family, type namespace); coherence slot for the member.
- The divergences from alias rules Loops §7.2 already noted: recursion unwritable, expansion/display question deferred (moot in v1 since `Elem(c)` is not referenceable — Part 1 §6.1).
- **v1 restriction enforcement points**: where the compiler rejects `Elem(c)` in type expressions and `Iterable` as a user constraint binder.
- Edit notes to: Constraints (grammar §§, whitelist), Declarations Preamble (header/keyword table), Lexer keyword list if affected.
*Depends on:* Part 1 only. *Feeds:* Parts 3, 4, 5.

---

## Part 3 — `Vector(a)` Spec ✅ DONE

**Document:** `collections-part3-vector.md` (Decided, July 2026). Also declared `IndexError`/`SliceError` and claimed String indexing; the `KeyError` payload question passed to Part 4 (resolved there: nullary).

The full type spec for the workhorse sequence.

- Type, representation reference (Part 1 §2 contract restated normatively), emission story (`@hexagon/runtime`, `.d.ts` face).
- **Literals**: `[1, 2, 3]` as `Vector` literal (presumed; confirm), empty literal typing.
- **Vector patterns**: discharge Pattern Matching §11.1 — `[]`, `[a, b]`, `[x, ..rest]` shapes; **cost story stated honestly** (`rest` is a slice of a trie, not a shared tail; slice complexity pinned); exhaustiveness/usefulness integration.
- **Indexing `[]`** for `Vector`: the Part 1 §3.3 accessor pair restated normatively — `vec[i]` throws `IndexError`, `Vector.get` returns `Option(a)`; slicing clamps (Decisions Batch §5); negative-index confirmation (presumed absent); slice syntax; read-only-position rule.
- Core end/index API surface per the Part 1 §3 doctrine (`append`, `prepend`, `first`/`last` → `Option`, `dropFirst`/`dropLast`, `get`/`set`, `size`, `isEmpty`, `toSeq`/`fromSeq`).
- `Concat<Vector>` instance (discharges Operators §7).
- Instances: `Eq<Vector(a)>` (elementwise, requires `Eq a`), `Ord<Vector(a)>` (lexicographic? — decide), `Show`, stdlib-blessed `Hash<Vector(a)>` given `Hash a` (Part 2 wording).
- Loops §5 table row (already present as `List`; rename + confirm).
- Diagnostics checklist; acceptance tests; edit notes (Pattern Matching, Operators, Loops, FFI agenda rename).
*Depends on:* Parts 1, 2 (for the `Hash<Vector>` instance wording; could land before Part 2 if that instance is deferred to Part 4 — sequencing flexibility noted).

---

## Part 4 — `Map(k, v)` & `Set(a)` Spec ✅ DONE

**Document:** `collections-part4-map-set.md` (Decided, July 2026, incl. §17.1 correction record — representative retention). `KeyError` declared nullary; boundary-conversion obligations pinned for FFI (its §10).

- HAMT representation reference and complexity table (get/set/remove O(log₃₂ n) expected; iteration O(n)).
- Signatures with `<k: Hash>` / `<a: Hash>` throughout; core surface per Part 1 §3 (Map: `empty`/`isEmpty`/`size`/`get`/`containsKey`/`set`/`remove`/`keys`/`values`/`entries`/`fromEntries`(last-wins)/`toSeq`/`fromSeq`; Set: `empty`/`singleton`/`isEmpty`/`size`/`contains`/`add`/`remove`/`union`/`intersect`/`difference`/`isSubsetOf`/`toSeq`/`fromSeq`).
- **Iteration order fine print**: deterministic-but-unspecified defined precisely (what "deterministic" promises across program runs given structural hashing; what is explicitly *not* promised — insertion order, sorted order); `for (k, v) in map` / `for x in set` table rows.
- **Map/Set literals**: leaning none — decide and record.
- **`map[k]`**: direction decided (Part 1 §3.3) — `map[k]` throws `KeyError`, `Map.get` returns `Option(v)`. This part owes the fine print: `KeyError`'s shape and message doctrine (edit note to Exceptions — `IndexError` sibling), catchability, emission.
- Instances: `Eq<Map>`/`Eq<Set>` (order-independent; define via canonical iteration or size+subset), `Show` (display order question), no `Ord` (leaning), stdlib-blessed `Hash<Set(a)>`/`Hash<Map(k,v)>` (order-independent hash — commutative combine; decide).
- **Boundary conversions** (feeds/edits FFI): `Map.toJsMap`/`fromJsMap`, `Set.toJsSet`/`fromJsSet` or FFI-spec ownership; the structural-vs-reference key-equality mismatch for object keys documented; primitive-key semantics alignment (SameValueZero) recorded as the good case.
- Diagnostics; acceptance tests; edit notes.
*Depends on:* Parts 1, 2; reads Part 3's `[]` decision.

---

## Part 5 — `Iterable` v1 + Surface Boundary & Closeout ✅ DONE

**Document:** `collections-part5-iterable.md` (Decided, July 2026, incl. §18 correction records). `Iterable<String>` decided (one-codepoint items; `String.toSeq`/`fromSeq`); `Array(a)` iteration handed to FFI as a binding obligation (its §6); combinator boundary and transients decided. **The Collections roadmap is complete.**

- **`Iterable` v1 normative spec**: the Part 1 §6.1 restricted form made formal — table-opening semantics, resolution rule (head-constructor-known lookup; unsolved-tyvar error unchanged), instance globality reliance (Modules §7), orphan-rule application, diagnostics ("`τ` is not iterable" + `toSeq` hint + "or `implement Iterable<τ>`"), emission (user `iterate` → `Seq` → JS iterable protocol per Loops §6.5).
- **The "writing your own collection" section** (Part 1 §6.5 recipe, normative, with a worked `Bag` example).
- **Collections/Stdlib-listing boundary decision**: leaning — types, representation, key model, `Iterable`, `[]`, literals, patterns live in Parts 2–5; the combinator surface (`Vector.map`/`filter`/`fold`, `Map.update`/`merge`/`mergeWith`/`filter`/`mapValues`, `Set.map`/`filter`) migrates to the Stdlib listing with the Part 1 naming doctrine binding there. Decide and record the v1 ship-list vs deferred-list split there.
- **Transients**: `withMutations`-style batching — leaning runtime-internal only (used by `fromSeq`/`fromEntries` internally, never user-facing in v1); decide and record.
- Amendment consolidation: confirm Decisions Batch §6 / Loops §11.1 / main-roadmap Tier-3 edits from Part 1 §6.4 are reflected; strike this roadmap's entries.
*Depends on:* Parts 1–4.

---

## Sequencing

**Part 2 → Part 3 → Part 4 → Part 5**, each a single session in the established workflow (lettered decision points, then the formal doc). Part 2 is small but unblocks the instance wording both type specs want. Parts 3 and 4 could swap if the `[]`-for-Map question is provisionally answered early, but 3-before-4 lets Map's `[]` decision react to Vector's settled semantics.

**Interaction with the FFI queue:** Part 1 already edits the FFI agenda (rename to `Vector`). Beyond that, either order works: the FFI session can proceed next on the updated agenda (Part 1 pins everything the boundary contracts need — representation, complexity, key model), with Part 4's boundary-conversion item coordinating with whatever FFI decides about `JsMap`/`JsSet`; or Parts 2–4 can land first. Hexagonal's call at next session.

## Debts imported from elsewhere (for completeness)

- Pattern Matching §11.1 (list→vector patterns) → Part 3.
- Operators §7 `Concat<List→Vector>` → Part 3.
- Decisions Batch §5 partiality restatement → Part 3.
- Loops §3.6 `Range` `Eq`/`Show` → **not** collections; stays with the Stdlib listing.
- Decisions Batch §1.4 `Hash<Float>` → Part 2 (activated).
- Modules §5.1 prelude qualified-home invariant → binds the Stdlib listing; Parts 3–4 must give every bare prelude collection name (if any) a companion-module home.
