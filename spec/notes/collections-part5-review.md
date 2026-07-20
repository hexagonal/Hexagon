# Review Note: Collections Part 5 — `Iterable` & Closeout

**Reviewer:** Sol (Codex), July 2026
**Target:** `spec/collections-part5-iterable.md`
**Companion context:** `spec/notes/ffi-exported-dictionaries.md`
**Instruction:** Revise Collections Part 5 from this review. **Do not begin the FFI specification yet.** The FFI design is still being developed; its dictionary note is context for avoiding contradictions, not a complete FFI brief.

---

## Significant findings

### 1. Move normative `Array(a)` iteration into FFI

Part 5 currently leaves `Array.toSeq` and `for x in arr` observation semantics open (live view versus snapshot), while unconditionally requiring native emission:

```js
for (const x of arr)
```

Those positions cannot coexist. Native JS array iteration has JavaScript's mutation-observation behaviour; it cannot implement snapshot semantics if FFI later chooses them.

The clean ownership split is:

**Part 5 owns:**

- the six core provided rows: `Range`, `Vector`, `Seq`, `Map`, `Set`, `String`;
- the general mechanism by which later types provide `Iterable` instances;
- a binding requirement that, if `Array(a)` ships in v1, FFI provides `Iterable<Array(a)>` with `Item = a` and `Array.toSeq`.

**FFI owns:**

- the normative `Array(a)` type and its checked-boundary semantics;
- `Iterable<Array(a)>`;
- `Array.toSeq` / `Array.fromSeq`;
- `Array.toVector` / `Vector.toArray`;
- live-view versus snapshot behaviour;
- mutation observation;
- direct native iteration versus helper/snapshot emission;
- `.d.ts` representation and deep-versus-shallow conversion.

This does **not** reopen the direction that Array should be iterable. It puts the normative row in the spec that can define its meaning coherently.

Required Part 5 changes:

- Change "exactly seven rows" to six core rows plus an FFI obligation.
- Remove `Array(a)` from the normative table here.
- Replace the current Array section with a concise FFI handoff.
- Remove unconditional native Array `for..of` emission.
- Move the Array conversion-surface decisions into the future FFI work queue rather than deciding them here.

### 2. Narrow the `.d.ts` claim to `Iterable` machinery

Part 5 currently says nothing constraint-shaped appears in `.d.ts`, and its Bag acceptance test says no instance object or other constraint material appears.

That conflicts with the recovered FFI direction in `ffi-exported-dictionaries.md`. `Bag.fromSeq`, `Bag.add`, and `Bag.count` are exported constrained-polymorphic functions (`<a: Hash>`). Under that FFI direction, JavaScript calls them with compiler-produced, nominal `Hash` dictionary evidence, and their `.d.ts` faces expose the evidence parameters.

Part 5 should say only:

> No `Iterable`, `Item`, or `Iterable` instance machinery appears in `.d.ts`. The foreign representation of other constraints on exported functions is owned by the FFI spec.

Revise the final Bag `.d.ts` acceptance test accordingly. It may assert the absence of `Iterable` machinery, but it must defer the representation of `Hash`-constrained exports to FFI.

Do not incorporate the full exported-dictionary design into Part 5. The companion FFI note exists only so Part 5 does not contradict it.

### 3. Repair the conversion-suite doctrine

Part 5 says every type in the iterable table provides `toSeq`/`fromSeq` with no exceptions, but later excludes `Range`. `Seq(a)` is also in the table without an explicit conversion pair.

The document must distinguish **iterable types** from types participating in the **collection conversion suite**.

Recommended doctrine:

- Every finite collection type provides `toSeq` / `fromSeq`.
- `String` deliberately joins that suite in Part 5.
- `Range` is iterable but is not a collection; it is exempt. A public `Range.toSeq` remains a stdlib candidate, and `Range.fromSeq` has no natural meaning.
- `Seq` is the conversion currency itself; it does not need identity wrapper functions merely to satisfy a slogan.
- `Array` conversion membership is owned by FFI, per finding 1.
- Third-party collections are expected to provide the pair as part of the Part 5 recipe.

Remove or qualify phrases such as "every type in the iterable table" and "`toSeq`/`fromSeq` everywhere."

### 4. The “two legal homes” diagnostic names only one

Part 5 labels its user-nominal message the two-legal-homes diagnostic but only names the type's home module. The Sol-review obligation requires the compiler to identify both lawful homes under the orphan rule.

The diagnostic may still lead with the actionable home:

> `Bag(Int)` is not iterable. Define `honor<a> Iterable<Bag(a)>` in `./bag.hex`, which declares `Bag`. The only other legal home is the prelude module declaring `Iterable`. Alternatively, convert with `Bag.toSeq` or accept a `Seq(a)` parameter.

The prelude home is not user-editable, but naming it makes the stated two-home rule accurate and explains why no third module can provide the instance.

---

## Other corrections

### 5. Complete the `String.fromSeq` contract

The concatenation decision is correct. Add the remaining normative details:

- An empty sequence produces `""`.
- Elements concatenate in traversal order.
- Elements may be strings of any length.
- No Unicode normalization occurs.
- An infinite sequence diverges.
- Complexity is linear in total input/output length.
- Implementations collect chunks and join efficiently; the semantic description as a fold over `++` must not license quadratic repeated immutable concatenation.

Retain the one-sided round-trip law:

```hexagon
String.fromSeq(String.toSeq(s)) == s
```

Do not claim that `toSeq(fromSeq(xs))` preserves arbitrary input chunk boundaries.

### 6. Correct the infinite-`Seq` acceptance test

The current example throws when `n > 3` before calling `consume(4)`, so it does not consume `4`.

Correct the comment to:

> pulls 1, 2, 3, 4; consumes 1, 2, 3; throws on 4.

Also avoid making an unsettled stdlib combinator name such as `Seq.unfold` part of a golden language test. Either mark the producer as illustrative pseudocode or construct the specimen using already normative primitives.

### 7. Use the current diagnostic noun

The duplicate acceptance test says:

> duplicate implementation of Iterable\<Bag>

Current Constraints doctrine requires the noun **instance** and the verb **honor**. Use:

> duplicate instance of `Iterable<Bag>`

Historical quotations that explicitly describe superseded `implement` wording may remain when clearly labelled as historical.

### 8. Apply roadmap closeout in the landing commit

Part 5 says it performs the Collections closeout, but the actual roadmap files still say Parts 2–5 are outstanding and user-facing `Iterable` is wholly v2.

When Part 5 lands, apply its roadmap edit notes in the same commit:

- Mark Collections Parts 2–5 complete in `collections-roadmap.md` and mark the roadmap historical/completed.
- Mark Tier-1 Collections complete in `spec-roadmap.md`.
- Update the filed-spec inventory.
- Re-scope the Tier-3 entry to the remaining v2 implied-type machinery: deferred `Item(α)` goals, `Item(c)` references, implied-type obligations, and generic `Iterable` binders. Restricted user-defined concrete `Iterable` instances are v1.
- Carry the newly inherited stdlib and FFI obligations into their roadmap/agenda locations without starting the FFI spec.

Pending companion-document edits may continue to follow the house apply-on-next-touch convention, but the two roadmaps are primary navigation and should not remain knowingly false after the closeout document lands.

---

## Verdict

The core Part 5 design is sound and does not need an `Iterable` redesign. In particular, retain:

- global instance lookup by outer constructor;
- the normative `for p in e` algorithm;
- the rigid-versus-unsolved diagnostic split;
- full loop-head patterns under the irrefutability gate;
- `Iterable<String>` with one-codepoint `String` items;
- `String.toSeq` and concatenating `String.fromSeq`;
- the user-defined `Bag(a)` recipe;
- static instance resolution at loop sites;
- the collections/stdlib boundary;
- runtime-internal transients only.

Before landing, revise the specification to:

1. transfer normative Array ownership to FFI;
2. narrow the `.d.ts` claim so it does not contradict exported constraint dictionaries;
3. make the conversion-suite domain precise;
4. repair the two-home diagnostic;
5. complete the String contract and acceptance-test details;
6. apply the roadmap closeout.

After those corrections, Part 5 should be ready for a final corpus consistency pass and GitHub review.

Again: **do not start drafting the FFI specification from these notes yet.** The exported-dictionary design and the rest of the FFI surface will be developed further first, then assembled into a bounded brief.
