# Group Review: Collections and Implied Types

**Chapters reviewed:** Collections; Implied Types.

**Status:** Reviewed as a consistent drafting group after reader review. This is not
the late whole-book pedagogy pass.

## Coherence result

The pair has one clean teaching movement:

1. Collections teaches persistent `Vector`, `Map`, and `Set` values through ordinary
   use rather than an API inventory;
2. its final `Bag(a)` example shows the smallest complete user-defined `Iterable`
   instance; and
3. Implied Types immediately returns to the one deliberately unexplained line,
   `type Item = a`, and generalizes the mechanism beyond iteration.

The division is effective. A reader can use the standard collections without first
learning type-level instance machinery, while the advanced feature receives enough
space to explain its scope and deliberate limits accurately.

## Integrated corrections

- Removed **upsert** from the Collections prose, plan, continuity record, and index.
  `Map.set` still says exactly what matters: it inserts an absent key or replaces the
  value for an existing key.
- Kept the Collections treatment of `type Item = a` to one plain-English sentence and
  an immediate hand-off to Implied Types.
- Confirmed that the implied-type chapter defines the general feature with the
  two-member `Conversion` example instead of making it look like special `Iterable`
  syntax.
- Confirmed the exact-once, owner-relative, coherence, orphan, projection-ban, binder-
  ban, and erasure rules against the collections and type-member specifications.

## Pedagogical dependency check

Collections assumes persistence from record updates, `Option` and exceptions for the
two access styles, one-based indexing, patterns, loops, sequences, constraints,
derivation, and dot calls. Every dependency has already received its principal
explanation. The chapter introduces only the collection-specific consequences.

Implied Types assumes the complete constraint and instance model, concrete
iteration, home modules, coherence, and the `Bag(a)` example immediately before it.
It contrasts caller-selected parameters with instance-selected types before presenting
the grammar. Multiple members, scope, coherence, and restrictions then arrive in the
order a reader needs them.

No material needs to move earlier. The late pedagogy pass should check only whether the
Implied Types chapter needs an “advanced chapter” signpost in the final contents;
its position and internal order are already defensible.

## Terminology and index check

- **Persistent collection** is defined before the first update example and explicitly
  distinguished from storage persistence.
- `Vector`, `Map`, `Set`, `Hash`, and `Seq` retain their established meanings.
- **Implied type** receives one direct definition at the start of Chapter 21.
- The prose uses ordinary insertion/replacement language instead of teaching
  **upsert**.
- The principal implied-type and persistent-collection definitions are recorded in
  `INDEX-CANDIDATES.md`.

## Example continuity

The supplies vector carries the later liveliness direction lightly without requiring
the Arthurian story during the first draft. One-based access, persistent updates, dot
calls, vector patterns, map tuple iteration, `Hash` derivation, and `Seq` conversion all
reuse rules already established elsewhere.

`Bag(a)` is identical at the hand-off between chapters. Implied Types does not
quietly change its instance, item type, or emitted meaning. The later `Conversion`
example proves generality without contaminating the simpler collection narrative.

## Technical surface check

- Vector literals, access, signed `at`, inclusive slicing, rest patterns, and
  irrefutability agree with the vector and pattern specifications.
- Map and set construction, persistent updates, access behavior, `Hash` requirements,
  and iteration-order limits agree with the map/set and hash specifications.
- `Seq` is the finite-collection conversion currency; `toSeq` may be incremental and
  every `fromSeq` is eager.
- `Iterable` instances bind `Item` and delegate `iterate` to a `Seq`-producing
  operation; concrete loops remain statically resolved.
- Constraint type members use `type Name`; instances use `type Name = T`; every member
  is bound exactly once and belongs to its owner constraint.
- External implied-type expressions and projection-bearing constraints on unknown
  type variables remain rejected; reusable iteration consumers take `Seq(a)`.
- Implied types erase, while persistent collections retain honest runtime-owned
  JavaScript and TypeScript faces.

## Deferred to the final group

- JavaScript Input must complete the promised native `Array(a)` conversion
  and iteration story without identifying it with persistent `Vector(a)`.
- The TypeScript and constrained-export chapters must ensure that a user collection's
  ordinary public functions have honest foreign signatures even though `Iterable.Item`
  itself never appears in `.d.ts`.
- The whole-book pedagogy and liveliness passes still own pacing, callbacks, final
  cross-references, and example tone.

## Review result

After the integrated terminology correction, no known contradiction remains within
the two chapters or with Chapters 1–19. Collections stays compact and practical;
Implied Types pays off its preview immediately and states both the useful feature
and its inference boundary without pretending Hexagon supports general projection.
