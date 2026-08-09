# Sequences

A loop consumes elements one at a time. `Seq(a)` makes that stream of elements a value
that can be passed, transformed, and consumed without first constructing a complete
collection.

```hexagon
let visibleSquares =
    1..100
    |> iterate
    |> Seq.map(number => number * number)
    |> Seq.filter(square => square < 50)
    |> Seq.take(5)
```

This code describes work. It does not immediately calculate one hundred squares or
allocate a collection containing them. `Seq` transformations produce another lazy
sequence, and elements are calculated when a consumer asks for them.

## A sequence is lazy and immutable

`Seq(a)` is a concrete standard-library type representing a sequence of `a` values. It
has three important properties:

- **lazy**: the next element may be computed only when requested;
- **immutable**: requesting an element does not change the sequence value; and
- **possibly infinite**: a sequence need not have a final element.

Laziness lets a pipeline perform only the work its consumer needs. Iterating
`visibleSquares` pulls values through `take`, `filter`, and `map` as required. Once five
results have survived the filter, later source values need not be examined.

An operation that consumes an entire sequence cannot finish on an infinite one.
Converting a sequence into a persistent collection is therefore eager and appropriate
only when the sequence is known to be finite. A loop may consume an infinite sequence
indefinitely, one element at a time.

## Transformations run when values are demanded

Callbacks in a lazy pipeline do not run merely because the pipeline was declared:

```hexagon
let squared(number: Int): Int = number * number

let squares = numbers |> Seq.map(squared)
```

Declaring `squares` computes nothing. The multiplication occurs as `squares` is
consumed. If nobody asks for an element, the callback does not run; if a consumer asks
for only two elements, only two multiplications happen — and if the sequence is
traversed twice, they happen twice. `Seq.memoize` trades memory for computing each
element at most once.

That accounting never involves the outside world, because a lazy transformation's
callback is **pure by construction**: `Seq.map` demands a pure function, and the type
checker enforces the demand. (The strict consumers — `fold`, `forEach` and their kin —
run their callback once per element, eagerly, so they are the one place an effectful
callback is honest; such a call wears a mark, which the next chapter introduces.) A
callback that printed, or read input, would make "how many times does this
run?" a question about observable behaviour, and the honest answers — on demand, per
traversal, at most once under `memoize` — are the accounting of a calculator, not of an
action. Hexagon keeps `Seq` a calculator. When the elements themselves must come from
the world, or per-element effects are the point, that is the next chapter's type; when
effects around a traversal are the point, a direct `for` loop keeps them in a block,
in order, exactly once.

The book uses representative operations such as `map`, `filter`, and `take` to explain
the idea. Their complete family belongs in library reference documentation, not in a
language chapter.

## `next` exposes a functional cursor

The fundamental operation has this type:

```text
Seq.next : Seq(a) -> Option((a, Seq(a)))
```

It returns either:

- `Some((value, rest))`, containing the next value and the successor sequence; or
- `None`, when the sequence is exhausted.

Pattern matching makes the two cases explicit:

```hexagon
let firstOrZero(numbers: Seq(Int)): Int =
    match Seq.next(numbers)
        Some((first, _)) => first
        None => 0
```

Calling `Seq.next(numbers)` does not consume `numbers`. Repeating the call at the same
sequence position observes the same next value. Continue traversal with the returned
`rest` value:

```hexagon
let firstTwo(numbers: Seq(Int)): (Int, Int) =
    match Seq.next(numbers)
        Some((first, rest)) =>
            match Seq.next(rest)
                Some((second, _)) => (first, second)
                None => (first, first)
        None => (0, 0)
```

There is no public mutable iterator with separate `moveNext` and `current` operations.
This is a **functional cursor**: advancing produces another immutable `Seq` value.

## Loops pull through the same model

A `for` loop can be understood as repeatedly asking for the next element and advancing
to the returned successor sequence. Its hidden cursor may change locally, but the
sequence values observed by the program remain immutable.

This external iteration is important. Implementing a loop through `Seq.fold` would
turn the body into a callback lambda, which could not update an enclosing `var`. A
direct loop keeps its body as a block and supports both functional traversal and the
small local accumulators introduced in the Mutable Variables chapter.

The source expression is still evaluated once. Elements are then pulled on demand,
which matters when producing an element is expensive or the sequence is long:
work not demanded is work not done.

## `Seq` is the common iteration currency

The `iterate` operation converts a value known to support iteration into a sequence:

```hexagon
let letters: Seq(String) = iterate("Hexagon")
let numbers: Seq(Int) = iterate(1..10)
```

For a `Seq`, `iterate` is the identity. For a `String`, it produces one-codepoint
strings in order. Ranges and later persistent collections provide their own static
conversions.

Collection companions use a uniform pair of names:

- `Type.toSeq(value)` exposes values for lazy iteration; and
- `Type.fromSeq(sequence)` constructs a collection eagerly.

For strings, `String.toSeq` yields codepoints and `String.fromSeq` concatenates sequence
elements without Unicode normalization. The round trip preserves the original string.
Later collection examples will use the same naming without cataloguing every possible
conversion.

Because `Seq(a)` states its element type directly, it is also the idiomatic parameter
for generic iteration:

```hexagon
let count(values: Seq(a)): Int =
    var total = 0
    for _ in values
        total := total + 1
    total
```

Callers decide how to convert their concrete source. The function itself does not need
to know how that source provides iteration.

## JavaScript iteration needs an honest adapter

At the JavaScript and TypeScript boundary, `Seq(a)` appears as `Iterable<a>`. If the
opening `visibleSquares` value is exported, its declaration has this shape:

```ts
export declare const visibleSquares: Iterable<number>;
```

General Hexagon loops can therefore emit readable JavaScript `for...of`. Internally, a
sequence may wrap JavaScript's iterable protocol.

JavaScript iterators are normally mutable and single-use, while Hexagon promises that
`Seq.next(sequence)` does not consume the supplied position. A runtime adapter must
memoize or otherwise preserve already observed positions when necessary. The exact
wrapper is an implementation detail; the observable persistence is not.

This also explains why `Seq` is preferable to exposing a mutable iterator object as a
language abstraction. JavaScript interoperation remains direct, but Hexagon code keeps
an immutable model that can be reasoned about locally.

## Summary

- `Seq(a)` is a concrete lazy, immutable sequence that may be infinite;
- transformations calculate values only when a consumer demands them;
- transformation callbacks are pure by construction — the world never sees how many
  times one runs;
- `Seq.next` returns `Some((value, rest))` or `None` without consuming the original
  sequence position;
- loops pull elements through the same external-iteration model;
- `iterate` converts a statically known iterable source to `Seq`;
- `toSeq` and `fromSeq` connect collections without requiring a library catalogue; and
- `Seq(a)` crosses the JavaScript boundary as `Iterable<a>` while retaining persistent
  Hexagon semantics.

A `Seq` computes its elements. Some element producers cannot promise that — a random
draw, a keystroke, a clock reading is drawn from the world, not computed — and for
those Hexagon has a sibling type with different rules. The next chapter introduces
`Stream`, and with it the effect spellings that keep the difference visible in the
types.
