# Group Review: Types and Structure

**Chapters reviewed:** Layout; Polymorphism;
Tuples; Type Aliases.

**Status:** Reviewed as a consistent drafting group. This is not the late whole-book
pedagogy pass, and chapter numbers remain provisional.

## Coherence result

The group has a clear progression from source shape to type structure:

1. layout establishes how every later multi-line body is read;
2. inference explains the type relationships already operating in the opening group;
3. tuples provide the first compound value whose shape can be inferred; and
4. aliases give recurring type shapes useful names and introduce the declaration
   family.

Each chapter gives the next one something concrete to use. Inference is taught before
the reader must interpret `(String, Int)`. Tuples exist before aliases name tuple
shapes. The declaration overview then prepares records, unions, constraints, and
exceptions without attempting to teach their semantics prematurely.

## Integrated corrections

- Replaced the technical “sibling line/item” layout vocabulary with “same indentation”
  and “same block level.”
- Made the value restriction's conceptual hinge explicit: `let` is necessary but not
  sufficient for generalization; its initializer must also be a value.
- Corrected the `chooseFirst` explanation. Its parameter types are independent; the
  unused second parameter does not have to share the first parameter's type.
- Clarified that the binding of the function-valued definition `makeIdentity` is what
  generalizes, rather than suggesting that an inner lambda generalizes by itself.
- Changed the value-restriction workaround to a **concrete** annotation, avoiding any
  implication that an annotation can override the restriction and manufacture
  polymorphism.
- Removed an editorial comment about why the tuple/argument distinction had been
  deferred and replaced it with a direct explanation of the distinction.
- Defined **arity** and **n-ary** at their first appearance in Chapter 3, then broadened
  the definition enough to support tuple positions and type-alias arguments.
- Established an index-candidate ledger so deliberately defined technical terms are
  recorded during drafting.

## Pedagogical dependency check

The sequence depends on a few intentional previews:

- The layout chapter says braces are records before records are taught. It needs only
  the negative rule—braces never delimit blocks—and identifies `{}` provisionally as
  the empty record. No record operations are required.
- The inference chapter lightly uses numeric constraints and previews `Show`. The
  examples explain the necessary relationship locally; declaration and instance
  machinery remains deferred.
- The tuple chapter mentions records as the named-field alternative. This is guidance
  about when tuples are appropriate, not an unexplained dependency on record syntax.
- The aliases chapter previews four declaration forms. Its purpose is recognition of
  their related headers; each form's meaning remains explicitly assigned to a later
  chapter.

These previews are small and directional. None currently carries the teaching burden
of a later chapter. Recheck them during the late pedagogy pass when the eventual record,
union, constraint, and exception chapters are available.

## Terminology and index check

- **Block**, **indentation**, **same-line body**, **separator**, and **comment** remain
  reader-facing; compiler terms such as virtual tokens and offside processing stay out
  of the prose.
- **Type inference**, **polymorphism**, **let-polymorphism**, **monomorphic**, **value
  restriction**, and **polymorphic recursion** are introduced around examples that
  demonstrate their meaning.
- **Tuple**, **position**, **positional access**, **destructuring**, and **arity** remain
  distinct. A tuple's positions never become an argument list implicitly.
- **Alias**, **transparent**, **type parameter**, and **type identity** consistently
  support the central distinction: an alias names a type but does not create one.
- Principal technical definitions and significant later uses are now tracked in
  `INDEX-CANDIDATES.md`.

## Example continuity

The group mostly moves away from the opening chapters' order example, as intended:

- `dishes |> rinse |> wash |> dry` returns once as a familiar layout example;
- `identity`, `useAtTwoTypes`, and `makeIdentity` form a compact inference sequence;
- `("Mira", 3)`, `minMax`, and `coordinates` give tuples several believable uses; and
- `Coordinates`, `Entry`, `UserId`, and `OrderId` teach naming versus identity.

The tuple-to-alias handoff is especially clean: `(Float, Float)` is first understood as
a value shape, then named only when repeated use gives the name a purpose. No example
silently changes type or meaning when it returns later.

## Technical surface check

- Layout, semicolon, brace, leading-tab, and nested-comment claims agree with the
  layout, comments, and July 2026 decisions specifications.
- Generalization, the value restriction, lambda-parameter monomorphism, numeric
  defaulting, and monomorphic recursive calls agree with the function and type-system
  specifications.
- Tuple arity, grouping, `Unit`, one-based `itemN`, destructuring, argument separation,
  JavaScript arrays, and TypeScript tuple output agree with the products specification.
- Alias transparency, full application, used-parameter requirement, recursion ban,
  module-level placement, declaration order, namespace duplication, JavaScript erasure,
  and `.d.ts` preservation agree with the declarations and modules specifications.
- No compiler-internal vocabulary is required to understand any of these rules.

## Deferred to later reviews

- Whether the inference chapter should be split if later constraint material makes its
  previews feel dense.
- Whether declaration-family recognition belongs here or at the beginning of the first
  nominal-type chapter.
- Whether Chapter 5 needs a small livelier callback around nested comments; its present
  contrast with JavaScript may already be sufficient.
- Final index locators, cross-references, chapter numbers, transitions, and balance of
  chapter lengths.
- The whole-book test that no use of a technical term precedes its useful definition.

## Review result

After the integrated corrections, no known technical contradiction remains in
Chapters 5–8 or between this group and Chapters 1–4. The group is coherent enough to
serve as the baseline for the next drafting group. The later pedagogy pass must still
simulate a new reader's experience across the complete manuscript rather than treating
this local result as final ordering approval.
