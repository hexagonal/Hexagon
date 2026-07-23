# Derivation

Consider a coordinate that should compare and display by its two fields:

```hexagon
record Point derives (Eq, Show) = {x: Float, y: Float}
```

The `derives` clause asks Hexagon to generate lawful `Eq<Point>` and `Show<Point>`
instances. No equality or display code has to repeat the record's structure.

This compiler generation is **derivation**. It is deliberately opt-in for nominal
types. Declaring a record or union says that its name matters; Hexagon does not then
assume that all of its representation is automatically meaningful for equality,
ordering, or display.

## Two spellings have one meaning

The concise declaration above means the same as writing:

```hexagon
record Point = {x: Float, y: Float}

honor Eq<Point> = derive
honor Show<Point> = derive
```

`derive` is a special complete body for an `honor` declaration. It asks the compiler
to synthesize the members using the type's structure. The header clause is normally
clearer because it keeps the choice beside the type.

For `Eq`, derivation generates the required `equals` operation. The `notEquals`
operation then comes from the default established by the `Eq` constraint, just as it
does for a hand-written instance that supplies only `equals`.

A single capability needs no parentheses:

```hexagon
record Ticket derives Eq = {number: Int}
```

Only `Eq`, `Ord`, `Show`, and `Hash` have derivable forms. Capabilities such as `Num` and `Signed`
or `Area` require real domain decisions and must be honored with hand-written members.

## Structural values already know their structure

Tuples and structural records receive structural `Eq`, `Ord`, `Show`, and `Hash`
behavior automatically when all their components support the requested capability:

```hexagon
let samePosition = (3, 4) == (3, 4)
let sameGuest = {name: "Mira", seats: 2} == {seats: 2, name: "Mira"}
```

Neither value declares a new identity. Its type is its structure, so structural
behavior follows naturally from its components.

Nominal declarations make a stronger boundary. Even if `Point` contains only two
`Float` fields, `left == right` is an error until `Point` opts into `Eq`. That small
friction prevents an accidental representation choice from becoming a permanent
semantic promise.

## Record derivation proceeds field by field

Derived equality compares corresponding fields. Every field must have `Eq`, and all
field comparisons must succeed:

```hexagon
record Reservation derives (Eq, Show) = {
    guest: String,
    seats: Int,
    confirmed: Bool
}
```

Field order in the source does not affect equality. It does not affect derived display
either: records display fields in field-name order so the result is deterministic even
when two literals were written in different orders.

Derived `Ord` visits fields in field-name order and compares their values
lexicographically. Because `Ord` has `Eq` as a base constraint, request both:

```hexagon
record Version derives (Eq, Ord, Show) = {major: Int, minor: Int}
```

If an earlier field decides the ordering, later fields are not consulted. This is
lexicographic ordering—the same dictionary-like progression used for words and tuples.

## Union derivation respects alternatives

For a union, equality first checks the constructor and then compares its payload:

```hexagon
union Temperature derives (Eq, Show) =
    | Celsius(value: Float)
    | Fahrenheit(value: Float)
```

`Celsius(20.0)` does not equal `Fahrenheit(20.0)`, even though the payloads match. With
`Show`, the constructor remains visible: a value displays in the shape
`Celsius(20)`.

Derived union ordering follows constructor declaration order, then compares payloads
from left to right. This matters even for all-nullary unions:

```hexagon
union Priority derives (Eq, Ord, Show) = Low | Normal | High
```

Here `Low < Normal < High` because that is the declared order. The emitted values are
strings, but Hexagon does not accidentally replace declaration order with JavaScript's
alphabetical string comparison.

## Type parameters become obligations

A parameterized type can derive a capability whenever its contained types provide the
same capability:

```hexagon
record Box(a) derives (Eq, Show) = {value: a}
```

This generates the equivalent of parameterized instances: `Box(a)` has `Eq` when `a`
has `Eq`, and has `Show` when `a` has `Show`. `Box(Int)` therefore supports both;
`Box(Int -> Int)` does not support derived equality because functions have no `Eq`
instance.

The diagnostic points at the obstructing part of the shape:

```text
cannot derive Eq<Callback>: field run has type Int -> Int, which has no Eq instance
```

For a union, the same rule applies to every payload slot. One unsupported component is
enough to prevent the generated instance from being lawful.

## Hashing is derived together with equality

`Hash` supports hashed maps and sets. Its essential law is simple: values considered
equal must produce the same hash. Hexagon makes that relationship difficult to break
by allowing user `Hash` instances only through derivation:

```hexagon
record ProductCode derives (Eq, Hash) = {department: Int, item: Int}
```

`Hash` requires `Eq`, and that equality must itself be derived. A hand-written `Eq`
instance may express a non-structural meaning that a structural hash cannot safely
guess. Hexagon therefore rejects both a hand-written `Hash` member block and
`derives Hash` beside hand-written equality.

For records, the generated hash combines the field hashes. For unions, it combines the
constructor and payload hashes. The exact combining algorithm is an implementation
detail, but equal values are guaranteed equal hashes and repeated calls within one
execution are deterministic. Collections may separately randomize their internal table
placement.

## Sometimes structure is the wrong meaning

Derivation is appropriate when the representation faithfully expresses the intended
capability. Sometimes it does not:

```hexagon
record User = {
    id: Int,
    displayName: String,
    cachedGreeting: String
}
```

If identity is determined only by `id`, derived equality would make cache contents and
display changes significant. Write the decision explicitly instead:

```hexagon
honor Eq<User> =
    equals(left, right) = left.id == right.id
```

Display can need similar care. A record containing a secret token should not derive
`Show` merely because every field is displayable. A hand-written instance can redact
the secret or show only a safe public identity.

The choice is semantic, not a performance switch. A derived instance occupies the same
coherent instance slot as a hand-written one; a type cannot have both.

## Generated behavior remains ordinary code

Derivation introduces no reflection and stores no runtime description of the type.
Hexagon generates direct comparisons, display calls, and small helper functions. When
all types are concrete, the emitted JavaScript can use direct field tests and native
operations.

Nothing new appears in the `.d.ts` representation of `Point`, `Priority`, or `Box`.
TypeScript sees the same plain objects and tagged unions established earlier. Deriving
changes which Hexagon programs are accepted and which operations the compiler can
generate; it does not attach JavaScript methods to the values.

## Summary

- nominal records and unions opt into derivation with `derives`;
- `derives (Eq, Show)` expands to ordinary `honor ... = derive` declarations;
- Hexagon can derive `Eq`, `Ord`, `Show`, and `Hash`;
- structural tuples and records receive structural capabilities automatically;
- record derivation proceeds deterministically by fields;
- union equality checks constructors, and union ordering follows declaration order;
- derived hashing requires derived equality so hashed collections remain sound;
- parameterized derivation requires the capability from contained types; and
- hand-written instances are better when representation does not express meaning.

Capabilities are functions, and derived instances do not create objects with methods.
Before dot calls can build on subject-first functions owned by a type's companion
module, the next chapter explains modules, public APIs, and those companion homes.
