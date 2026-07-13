# Chapter Brief: Collections

## Purpose

Introduce `Vector(a)`, `Map(k, v)`, and `Set(a)` as persistent everyday collections
without turning the chapter into a standard-library reference. Complete the deferred
vector-pattern and user-defined-`Iterable` stories, and reconnect eager collections to
`Seq(a)` as their common conversion currency. End with only the minimum preview needed
to show that a user-defined collection can honor `Iterable`; the following chapter owns
associated types.

## Reader outcome

The reader can choose an ordinary collection, construct and update it persistently,
use asserting and total access deliberately, iterate it, match a vector, and make a
small user-defined collection iterable.

## Teaching order

1. Persistent updates preserve the old value.
2. `Vector` literals, one-based access, slices, and vector patterns.
3. `Map` construction, lookup, and upsert.
4. `Set` construction, membership, and algebra.
5. `Hash` as the honest requirement for keyed collections.
6. `Seq` conversions and unspecified hash-collection order.
7. The small `Iterable` instance for `Bag(a)`, with `type Item = a` read plainly and
   deferred immediately.
8. Runtime-owned collection values and their TypeScript faces.

## Continuity constraints

- Collections are examples of language ideas, not an API inventory.
- Preserve one-based indexing and the bracket-versus-`get` distinction.
- Keep subject-first qualified functions compatible with pipes and dot calls.
- Do not teach associated types here. Allude to the mechanism only far enough to read
  the `Bag(a)` instance, then hand it to the next chapter.
- Do not imply that `Map` or `Set` iteration is insertion, sorted, or cross-run stable.
- Do not identify persistent collections with native mutable JavaScript collections.
