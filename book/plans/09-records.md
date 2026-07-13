# Chapter Brief: Records

## Purpose

Introduce named compound data, first structurally and then nominally. Teach literals,
field access, updates, punning, destructuring, flexible field requirements, nominal
identity, constructors, and explicit structural crossing as one connected story.

## Reader outcome

The reader can construct, annotate, read, update, copy, destructure, and pass records;
can distinguish structural shape from nominal identity; can choose between `type` and
`record`; and understands row polymorphism as the name for inferred field flexibility.

## Governing specification

- `spec/products.md` §§3–4
- `spec/products.md` §5
- `spec/declarations-preamble.md`
- `spec/modules.md` §4.1 for the ordinary exported face
- `spec/pattern-matching.md` §§2.4 and 9 for record and construction punning

## Technical skeleton

1. Names make a record preferable to a tuple.
2. Literals, types, access, field order, and `{}`.
3. Inference from field access and acceptance of additional fields.
4. Closed annotations and open `...` annotations.
5. Functional update, one leading spread, and no field addition.
6. Construction punning and simple destructuring.
7. JS object and TS object-type boundary.
8. Structural versus nominal identity.
9. Constructor and nominal-preserving updates.
10. Explicit nominal-to-structural crossing with `{...value}`.
11. Parameterized and ordinarily exported nominal records.

## Examples to preserve

- A `reservation` record grows from the tuple chapter's guest/seats example.
- `guestName` accepts any record containing `guest`.
- `confirm` uses `{...reservation, confirmed: true}`.
- `record UserId = {value: Int}` provides the first nominal contrast.
- `record Point = {x: Float, y: Float}` demonstrates structural crossing.

## Audit notes

- Field order is type-insignificant; duplicate fields are errors.
- An annotation without `...` is closed.
- Updates may replace existing fields only and preserve the record type.
- Exactly one spread is permitted, and it appears first.
- Do not expose row-unification internals or use “row” in diagnostics.
- Nominal records never unify with structural records implicitly.
- `{...p, x: value}` preserves nominal identity; `{...p}` crosses to structural.
- Opacity belongs in the modules chapter, covering records and unions together.
