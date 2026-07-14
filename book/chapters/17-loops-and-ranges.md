# Loops and Ranges

Hexagon's primary loop reads as a direct description of iteration:

```hexagon
for number in 1..5
  print("Number ${number}")
```

The range contains `1`, `2`, `3`, `4`, and `5`. The loop binds each value to `number`
and evaluates the body once for that value.

Loops work naturally with the mutable variables introduced in the preceding chapter:

```hexagon
let sumTo(limit: Int): Int =
  var total = 0
  for number in 1..limit
    total := total + number
  total
```

The body is an ordinary block inside `sumTo`, not a callback function. It can therefore
update `total` without crossing a lambda boundary.

## A `for` loop consumes an iterable value

The general form is:

```hexagon
for pattern in source
  body
```

Hexagon evaluates `source` once, then visits its elements in order. The loop pattern is
in scope only within the body. Its names are immutable, but they may reuse familiar
names from an enclosing scope because their region is visibly attached to the loop.

The source's type determines the element type statically. A `Range` yields `Int`
values; a `String` yields one-codepoint `String` values; `Seq(a)` yields `a`. Later,
persistent collections will join the same model.

Both the body and the whole loop have type `Unit`. A body that accidentally finishes
with a useful value is rejected:

```hexagon
for number in 1..5
  number * number // error: this value would be discarded
```

Perform an effect, assign an accumulator, or explicitly pipe an intentionally ignored
result to `ignore`.

## Ranges are inclusive integer progressions

`start..end` constructs a `Range`, a lazy description of an ascending sequence of
`Int` values:

```hexagon
1..4       // 1, 2, 3, 4
first..last
range(1, 4) // the same Range as 1..4
```

Both endpoints are included. The operator binds more loosely than arithmetic, so
`1..limit + 1` ends at `limit + 1`. Ranges do not chain: `1..2..3` is an error.

An ascending range whose first value is greater than its last is empty:

```hexagon
5..1 // no elements
```

It does not silently become descending. Use the named function when direction should
be downward:

```hexagon
rangeDown(5, 1) // 5, 4, 3, 2, 1
```

The mirror rule applies: `rangeDown(1, 5)` is empty. Equal endpoints make a one-element
range in either direction.

Ranges are integer-only. There are no floating-point ranges whose repeated steps might
drift around an endpoint. A range is also a first-class value that can be stored and
passed without materializing all its elements.

## `while` tests before each iteration

Use `while` when progress is controlled by changing state rather than an iterable
source:

```hexagon
let countdown(start: Int): Unit =
  var remaining = start
  while remaining > 0
    print("${remaining}")
    remaining := remaining - 1
```

The condition must be `Bool`; Hexagon has no numeric or object truthiness. It is tested
before every iteration, so a false initial condition executes the body zero times.

Like `for`, a `while` loop and its body produce `Unit`. Hexagon has no `break` or
`continue`. Put the exit condition in the `while` header, or shape the iterable or
surrounding function so that the intended control flow is explicit.

## Loop heads use patterns

The pattern language from the Patterns chapter applies in a loop head. Suppose a function
receives a sequence of tuple values:

```hexagon
let printReservations(entries: Seq((String, Int))): Unit =
  for (guest, seats) in entries
    print("${guest}: ${seats}")
```

The tuple pattern is **irrefutable**: every element of `(String, Int)` has exactly two
positions. Record patterns and sole-constructor nominal patterns work for the same
reason.

A loop pattern must match every possible element. A refutable pattern is an error:

```hexagon
let printPresent(possibilities: Seq(Option(Int))): Unit =
  for Some(value) in possibilities
    print("${value}")
  // error: an element might be None; use match in the body
```

Use a simple binder and perform an explicit `match` when some elements need different
treatment. The loop does not silently skip failed patterns.

`Seq((String, Int))` above means a lazy sequence of tuple values. The next chapter
develops `Seq` fully; only its role as an iterable source is needed here.

## Iterability is resolved statically

Every iterable type has one element type. A `Range` produces `Int`, a `String`
produces `String`, and `Seq(a)` produces `a`. Hexagon determines that relationship
statically from the source's concrete type; it does not search at runtime for
something that happens to look iterable.

For a reusable function that consumes a sequence of values, accept `Seq(a)`. It states
the element type directly and lets each caller convert its concrete source at the
boundary:

```hexagon
let consume<a>(source: Seq(a)): Unit =
  for item in source
    item |> ignore
```

How library authors make their own types iterable is a separate, more advanced topic.
It belongs with the later collection-extension material rather than the ordinary use of
loops.

## Common loops remain common JavaScript

A syntactic range loop emits as a native counting loop:

```hexagon
for number in 1..limit
  total := total + number
```

```js
for (let number = 1; number <= limit; number++) {
  total = total + number;
}
```

The end expression is evaluated once when necessary. General iterable loops emit as
JavaScript `for...of`, while `while` remains an ordinary JavaScript `while`. A `Range`
stored as a value becomes a small iterable object only when that representation is
needed.

Loops are internal control flow and add nothing to `.d.ts` output. Their source types
still matter: `Seq(a)` crosses the TypeScript boundary as `Iterable<a>`, a topic the
next chapter can explain in context.

## Summary

- `for pattern in source` evaluates the source once and visits its elements in order;
- loop bodies and complete loops have type `Unit`;
- `start..end` and `range(start, end)` make inclusive ascending integer ranges;
- reversed ascending bounds are empty, while `rangeDown` is explicitly descending;
- `while` retests a `Bool` condition before every iteration;
- loop patterns use the ordinary pattern language and must be irrefutable;
- concrete source types determine their element types statically;
- generic iteration uses `Seq(a)` as its parameter type; and
- ranges, general iteration, and `while` emit as recognizable JavaScript loops.

Iteration has so far treated a sequence as something a loop can consume. The next
chapter examines `Seq(a)` itself: a lazy, immutable value that can be transformed and
advanced without exposing a mutable iterator.
