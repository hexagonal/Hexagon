# Chapter Brief: Type Aliases

## Purpose

Teach how Hexagon names existing type shapes and establish the shared visual grammar of
module-level declarations before records, unions, constraints, and exceptions receive
their own chapters.

## Reader outcome

The reader can declare and use transparent aliases, parameterize aliases, understand
full application and non-recursion, distinguish naming from nominal identity, and
recognize the common declaration header shape.

## Governing specification

- `spec/declarations-preamble.md`
- `spec/modules.md` for module-level visibility and order
- `spec/products.md` for tuple alias examples and boundary representation

## Technical skeleton

1. Naming a repeated tuple type.
2. Aliases are transparent and cost nothing at runtime.
3. Parameterized aliases and full application.
4. Alias names improve diagnostics and declarations without creating identity.
5. Restrictions: parameters must be used; aliases cannot be recursive.
6. Shared declaration header shape and module-level placement.
7. Declaration order, mutual references, and namespace collisions at a reader level.
8. JS erasure and `.d.ts` preservation.

## Examples to preserve

- `type Coordinates = (Float, Float)` names the tuple chapter's recurring shape.
- `type Entry(k, v) = (k, v)` is the canonical parameterized alias.
- `UserId` and `OrderId` demonstrate that aliases do not create distinct types.

## Audit notes

- Aliases are transparent, fully applied, non-recursive, and require every parameter to
  be used.
- Do not promise alias preservation where visibility or expansion makes it dishonest.
- Type aliases emit no JavaScript.
- `.d.ts` should preserve public useful aliases where possible.
- Declarations are module-level and order-insensitive; do not teach compiler namespaces
  in unnecessary detail.
