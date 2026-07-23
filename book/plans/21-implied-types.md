# Chapter Brief: Implied Types

## Purpose

Pay off the `Iterable.Item` preview from Collections and teach implied types as a
general constraint feature. Cover declaration, instance binding, multiple members,
scope and identity, coherence, concrete use, deliberate projection restrictions, and
runtime erasure.

## Reader outcome

The reader can declare a constraint with implied types, bind every implied type
in an `honor` instance, understand why the choice belongs to the instance, and recognize
the forms Hexagon deliberately does not permit.

## Teaching order

1. Return to `Iterable.Item` and define **implied type**.
2. Contrast caller-chosen type parameters with instance-chosen implied types.
3. Declare and honor `Iterable` for `Bag(a)`.
4. Generalize with a user constraint containing two implied types.
5. Explain owner-relative scope, repeated member names, and exact-once binding.
6. Connect the type choice to ordinary instance coherence and the orphan rule.
7. Explain the absence of external projection and of implied-type constraints on
   unknown type variables; retain `Seq(a)` as the reusable iteration idiom.
8. Show that implied types erase and add no `.d.ts` machinery.

## Continuity constraints

- Do not use numbered-version labels.
- Keep the feature general; `Iterable` motivates it but does not own the grammar.
- Use `type Name` in a constraint and `type Name = T` in an `honor` body.
- Implied-type names are owner-relative and have no module-level namespace slot.
- Every implied type is bound exactly once by an instance.
- Do not suggest external `Item(c)` projection, implied-type obligations, or generic
  `<c: Iterable>` binders.
- Keep reusable iteration APIs on `Seq(a)`.
