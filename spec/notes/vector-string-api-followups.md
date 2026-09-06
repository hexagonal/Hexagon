# Vector API follow-ups from String design

**Status:** Proposal note. The counted-drop design below was agreed on
2026-09-06; it has not been implemented or incorporated into the normative spec.
**Scope:** A separate, accumulating mini proposal for Vector changes arising
from the String API discussion. Further items require discussion and agreement
before being added.

## 1. Counted drops from either end

Retain the existing single-element operations and add counted counterparts:

```hexagon
Vector.dropFirst(values: Vector(a)): Vector(a)
Vector.dropLast(values: Vector(a)): Vector(a)
Vector.dropFirstN(values: Vector(a), count: Int): Vector(a)
Vector.dropLastN(values: Vector(a), count: Int): Vector(a)
```

`dropFirstN` removes the first `count` elements; `dropLastN` removes the last
`count` elements. Both preserve the order of the remaining elements.

- A nonpositive count returns the input value unchanged.
- A count greater than or equal to the vector's length returns an empty vector.
- An empty input always produces an empty vector.
- These operations are pure and do not throw for negative or excessive counts.

The single-element functions delegate to their counted counterparts with `1`:

```hexagon
export let dropFirst(values: Vector(a)): Vector(a) =
    dropFirstN(values, 1)

export let dropLast(values: Vector(a)): Vector(a) =
    dropLastN(values, 1)
```

Examples of the proposed behaviour:

```hexagon
[10, 20, 30, 40].dropFirstN(2) // [30, 40]
[10, 20, 30, 40].dropLastN(2)  // [10, 20]
[10, 20].dropFirstN(0)        // [10, 20]
[10, 20].dropLastN(-3)        // [10, 20]
[10, 20].dropFirstN(2)        // []
[10, 20].dropLastN(20)        // []
[].dropFirstN(3)             // []
```

Slicing remains the operation for selecting a window between positions. Named
drops express removal from an end without requiring callers to compute slice
endpoints. The four names match the agreed String family, where the removed
units are codepoints rather than Vector elements.

The current single-element behaviour is preserved. Nonpositive counted drops
also agree with the behaviour of the existing `Seq.drop(source, count)`;
this note proposes no Seq API changes.

## 2. Follow-through when implemented

Update `stdlib/Vector.hex`, the core API and drop contracts in
`spec/collections-part3-vector.md` sections 4, 7 and 7.1, and the relevant library
documentation. Verify both ends, empty inputs, nonpositive counts, exact-length
and excessive counts, and equivalence of each single-element operation to its
counted counterpart at `1`. Preserve the existing end-slice efficiency when
refactoring the single-element operations. Section 4 gives slices an
O(log₃₂ n) bound and describes end slices as effectively O(1) amortized in a
separate note, explicitly not a bound. The counted operations' complexity must
be stated against that contract when implemented; this proposal makes no new
O(1) guarantee.

## 3. Further String-driven changes

No other Vector changes are agreed in this note yet. Add subsequent items here
as the String discussion establishes them.
