# Mutable Variables

Immutable `let` bindings remain the ordinary way to describe a calculation. Some
algorithms, however, are clearest when one local name must be updated as the algorithm
proceeds. Hexagon provides one deliberately confined tool for that job:

```hexagon
let boundedStep(start: Int, amount: Int, maximum: Int): Int =
    var current = start
    current := current + amount
    if current > maximum then current := maximum else ()
    current
```

`var` introduces a mutable local binding. `:=` changes the value held by that binding.
The function returns the final value of `current`, just as any other block returns its
final expression.

The confinement is as important as the mutation: a `var` exists only inside a
function, cannot become shared module state, and cannot be captured by another
function.

## `var` marks the changing name

A mutable declaration resembles `let`:

```hexagon
var attempts = 0
var currentName: String = initialName
```

The annotation is optional when inference already determines the type. Unlike `let`,
`var` binds exactly one name. It does not destructure:

```hexagon
var (left, right) = pair // error: var binds one name
```

Destructure immutably first, then copy the particular value that must change:

```hexagon
let (initialLeft, right) = pair
var left = initialLeft
```

A `var` is legal only within a function body. It may appear inside a nested `if`,
`match`, or `try` block belonging to that function, but not at module level. Hexagon
modules expose values and functions, never mutable cells.

Like every sequential binding, a `var` must introduce a fresh name. It does not provide
another way to rebind an existing `let`:

```hexagon
let total = calculateTotal()
var total = 0 // error: total is already bound
```

## Assignment produces `Unit`

Assignment uses `:=`, not JavaScript's `=`:

```hexagon
attempts := attempts + 1
```

The target must be a bare name introduced by `var`. The assignment changes that local
binding and produces `Unit`. It can therefore appear before another expression in a
block without violating the discarded-value rule.

If assignment is the final expression, the block itself produces `Unit`:

```hexagon
let reset(): Unit =
    var count = 3
    count := 0
```

`:=` is the loosest expression form and does not chain. `x := y := z` is rejected;
assignment produces `Unit`, not a value to feed into another assignment. Hexagon also
has no `+=` or similar compound spellings. Write the updated value explicitly:

```hexagon
count := count + 1
```

## A mutable binding keeps one type

A `var` has one monomorphic type for its whole lifetime. Its initializer and every
later assignment must agree:

```hexagon
var count = 0
count := count + 1
count := "many" // error: count has type Int
```

This remains true when the initializer's type is not immediately known. Later uses may
finish determining that type, but they cannot make one mutable binding behave as
several unrelated types. `var` never receives let-polymorphism.

The rule matches the way mutable storage must be understood: every update goes into the
same slot, so every reader of that slot must receive the same kind of value.

## Assignment does not make data mutable

Only a `var` name is assignable. Parameters, loop variables, pattern binders, and
`let`-bound names remain immutable:

```hexagon
let answer = 42
answer := 43 // error: answer was bound with let
```

Fields and tuple positions are not assignment targets either:

```hexagon
point.x := 10       // error: records are immutable
pair.item1 := "new" // error: tuples are immutable
```

Build an updated record value, and assign that whole value only when its local binding
was declared with `var`:

```hexagon
var currentPoint = startingPoint
currentPoint := {...currentPoint, x: 10}
```

There are no reference cells hiding behind `var`. Passing `currentPoint` to another
function passes its current immutable value, not a handle through which that function
can alter the binding.

## Lambdas cannot capture changing locals

A lambda may not read or assign a `var` declared outside that lambda:

```hexagon
let shifted(value: Int): Int =
    var shift = calculateShift()
    let applyShift = number => number + shift
    // error: shift is a var and cannot be used inside a lambda
    applyShift(value)
```

The boundary is a lambda, not an indented block. An `if`, `match`, `try`, or loop body
inside the same function may use the `var`; a nested function may not.

When a callback needs the current value, take an immutable snapshot:

```hexagon
let shifted(value: Int): Int =
    var shift = calculateShift()
    shift := normalizeShift(shift)
    let fixedShift = shift
    let applyShift = number => number + fixedShift
    applyShift(value)
```

The lambda captures `fixedShift`, whose value cannot later change. This makes the
moment of capture explicit and prevents a callback from observing a mutable local at
surprising times.

The same rule applies to `fun`: its body is a function body, so it cannot reach across
its boundary to an enclosing `var`.

## Mutation remains an implementation detail

The opening function has a direct JavaScript shape:

```js
const boundedStep = (start, amount, maximum) => {
  let current = start;
  current = current + amount;
  if (current > maximum) current = maximum;
  return current;
};
```

Hexagon's `var` becomes JavaScript `let`, and `:=` becomes assignment. The mapping is
honest because no closure can capture the changing binding.

Nothing mutable appears in generated `.d.ts` files. A public function exposes only its
parameters and result; callers cannot observe whether its implementation used a `var`,
immutable intermediate values, or a different algorithm entirely.

## Summary

- `var` introduces one mutable name inside a function;
- `:=` assigns to that name and produces `Unit`;
- a `var` is monomorphic and cannot change type;
- parameters, `let` names, record fields, and tuple positions remain immutable;
- records are changed by building updated values, not by assigning fields;
- a lambda cannot read or assign an enclosing `var`;
- an immutable `let` snapshot may cross that boundary; and
- local mutation emits as direct JavaScript and creates no mutable public API.

The most common reason to use a `var` is to accumulate or advance state inside a loop.
The next chapter introduces loops and the ranges and iterable values that drive them.
