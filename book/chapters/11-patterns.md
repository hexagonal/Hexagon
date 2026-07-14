# Patterns

Earlier chapters have already used small patterns:

```hexagon
let (guest, seats) = reservationPair
let {name, confirmed} = reservation

match status
  Pending => "waiting"
  Dispatched(code) => code
  Delivered => "arrived"
```

These are parts of one language. A **pattern** describes the shape a value must have
and may bind names to useful pieces of that value. Patterns do not call functions or
evaluate arbitrary expressions; runtime conditions belong in guards.

A lowercase name binds the value at that position. `_` matches the same value without
giving it a name. Each name may be bound only once in a whole pattern:

```hexagon
Rectangle(width, width) // error: width is bound twice
```

Use two names and compare them in a guard when their values must be equal. Repeating a
name does not express equality.

## Structural patterns can nest

Constructor, tuple, and record patterns may contain other patterns:

```hexagon
match result
  Ok((name, seats)) => "${name}: ${seats}"
  Err({message}) => message
```

The `Ok` pattern opens a union constructor and then a tuple. The `Err` pattern opens a
constructor and then a record. Nesting follows the data's shape from the outside in.

Tuple patterns must match the tuple's arity. Record patterns are different: they are
always open and mention only the fields they need.

```hexagon
match reservation
  {confirmed: true, guest} => "Confirmed for ${guest}"
  {guest} => "Awaiting confirmation for ${guest}"
```

The second arm does not say that `guest` is the record's only field. It binds `guest`
and ignores every unmentioned field. Record patterns never write `...`; openness is
automatic in pattern position.

Punning remains the short form: `{guest}` means `{guest: guest}`. Rename a field by
writing the full slot:

```hexagon
{guest: name} => "Hello, ${name}"
```

A nominal record must cross through its constructor pattern:

```hexagon
record Point = {x: Float, y: Float}

let distanceFromOrigin(point: Point): Float =
  match point
    Point({x, y}) => (x ** 2.0 + y ** 2.0) ** 0.5
```

`Point({x, y})` is the pattern-side counterpart of constructing with `Point({...})`.
A bare `{x, y}` pattern would describe a structural record, not the nominal `Point`.

## Literals match particular values

`Int`, `String`, and `Bool` literals may appear in patterns:

```hexagon
let describeCount(count: Int): String =
  match count
    0 => "none"
    1 => "one"
    _ => "many"
```

`_` is the wildcard: it matches anything and binds nothing. Infinite sets such as
`Int` and `String` always need a wildcard or variable catch-all because a finite list
of literals cannot cover every possible value.

`Bool` is finite, so this match is complete without `_`:

```hexagon
match enabled
  true => "enabled"
  false => "disabled"
```

`Unit` also has one possible value, written `()`, and the same spelling is its pattern:

```hexagon
let finished: Unit = ()

match finished
  () => "finished"
```

That single arm is exhaustive because every `Unit` value is `()`.

Float literals are deliberately excluded from patterns. Floating-point equality has
edge cases such as `NaN` and signed zero that make a literal pattern look more exact
than it is. Bind the value and make the comparison visible in a guard instead.

## Or-patterns share one arm

Use `|` when several shapes should take the same path:

```hexagon
match status
  Pending | Dispatched(_) => "still active"
  Delivered => "complete"
```

An **or-pattern** tries its alternatives from left to right. If the alternatives bind
names, every alternative must bind the same names at compatible types:

```hexagon
match result
  Ok(message) | Err(message) => message
```

This is legal when both payloads are `String`. `Ok(value) | Err(problem)` is an error:
the arm body would not have one dependable set of names.

The `|` echoes the union declaration: a union declares “one of these shapes,” while an
or-pattern says “any of these shapes follows this arm.” It is pattern syntax, not the
Boolean operator `or`.

## As-patterns keep the whole value

Sometimes an arm needs both a component and the complete value. An **as-pattern** binds
both:

```hexagon
match status
  Dispatched(code) as travelling => logStatus(travelling, code)
  Pending | Delivered as settled => logSimpleStatus(settled)
```

`Dispatched(code) as travelling` binds `code` to the payload and `travelling` to the
whole `DeliveryStatus`. `as` applies loosely, so the second arm binds `settled` for
either alternative.

No value is copied. The whole value is already available, and the additional name is
just another binding.

## Guards add runtime conditions

A pattern handles shape; a guard handles a condition that must be evaluated:

```hexagon
let classifyPort(port: Int): String =
  match port
    0 => "automatic"
    value when 1 <= value <= 1023 => "privileged"
    value when 1024 <= value <= 65535 => "ordinary"
    _ => "invalid"
```

The guard follows `when` and must produce `Bool`. Pattern bindings are available inside
it. Arms are tried from top to bottom; a guard runs only after its pattern matches and
at most once for that attempt.

Guards do not contribute to exhaustiveness—not even `when true`. The compiler does not
try to prove arbitrary expressions always succeed. A later unguarded arm must cover
the remaining values.

## Exhaustiveness protects future changes

A `match` must cover every possible value. For a union, the compiler knows every
constructor. For tuples and records, it combines the shapes of their components. When
something is missing, the error gives an example pattern:

```text
match is missing cases: (None, _)
```

This is stronger than a warning. A value cannot fall silently through a match at
runtime.

Reachability is checked just as firmly. An arm after `_` is unreachable. A case already
fully covered by an earlier unguarded arm cannot be handled again. Guarded arms do not
hide later arms with the same pattern because their guards may fail.

This makes union evolution visible: adding a constructor points directly to matches
that need a decision about the new case.

## Binding positions require patterns that cannot fail

`match` exists to choose among patterns that may fail. A `let` binding or function
parameter has no alternative path, so its pattern must match every value of the known
type. Such a pattern is called **irrefutable**.

Tuple and structural-record destructuring are irrefutable when their types guarantee
the requested shape:

```hexagon
let (x, y) = coordinates
let {guest, seats} = reservation
```

`Some(value)` is refutable for `Option(a)` because the value might be `None`:

```hexagon
let Some(value) = possibleValue // error: this pattern can fail; use match
```

A constructor pattern for a single-constructor nominal record is irrefutable:

```hexagon
let Point({x, y}) = point
```

The same rule applies to function parameters. Top-level commas still separate
parameters, preserving ordinary n-ary functions:

```hexagon
(x, y) => x + y       // two parameters
((x, y)) => x + y     // one tuple-destructured parameter
{guest, seats} => "${guest}: ${seats}" // one record-destructured parameter
```

The extra parentheses in `((x, y))` matter: the outer pair is the parameter list, and
the inner pair is the tuple pattern.

## Patterns compile to ordinary tests and bindings

Pattern matching adds no runtime pattern objects. The compiler emits readable tag or
literal tests, field reads, and local `const` bindings. A simple union match commonly
becomes a JavaScript `switch`; nested shapes and guards may become direct `if` tests.

The scrutinee is evaluated once, and arms retain their written order. Structural
patterns add no hidden user-defined dispatch; literal patterns use the same equality
semantics as `==`, with the permitted literal forms compiling to direct primitive tests.
The generated code follows the same decisions the source makes visible.

This chapter covers the complete pattern language over the data introduced so far.
Later chapters add patterns where their surrounding feature becomes concrete: vector
patterns with collections, loop binding patterns with loops, and `catch` arms with
exceptions. They extend this one pattern language rather than introducing separate
dialects.

## Summary

- patterns describe static shapes and may bind names to their pieces;
- constructor, tuple, and record patterns can nest;
- record patterns are open and support punning and renaming;
- `Int`, `String`, and `Bool` literals may be patterns, `()` is the `Unit` pattern, and
  `Float` literals may not appear in patterns;
- or-pattern alternatives must bind the same names;
- as-patterns retain both a matched component and its whole value;
- guards test runtime conditions and contribute nothing to exhaustiveness;
- missing and unreachable cases are compile errors; and
- `let`, loop, and parameter patterns must be irrefutable.

Together, tuples provide positions, records provide fields, nominal declarations
provide identity, unions provide alternatives, and patterns take all those shapes
apart.
