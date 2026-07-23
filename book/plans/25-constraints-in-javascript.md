# Chapter Brief: Constraints in JavaScript

## Purpose

Explain the deliberate JavaScript/TypeScript surface of exported constrained-
polymorphic functions: direct fundamental functions, the conditional generic function,
public dictionary objects, stable naming, and compatibility consequences.

## Reader outcome

The reader can predict the named concrete exports generated for fundamental types,
call a generic function with a public dictionary for a user type, find or compose
dictionary handles, and understand why private implementation choices never reshape
the foreign API.

## Teaching order

1. A constrained Hexagon export needs a deliberate foreign calling surface.
2. The closed six-type fundamental set bounds named specialization.
3. Lawful direct specializations are named from the source export and type tuple.
4. Specializations contain direct concrete operations and take no dictionaries.
5. A base-name generic function appears only when all required public dictionaries are
   obtainable and at least one belongs to a non-fundamental type.
6. Constraint-qualified dictionary types expose the completed member set.
7. Fundamental dictionary handles are constraint-owned; user/runtime handles are
   type-owned; parameterized instances become dictionary factories.
8. Dictionary parameters form a stable trailing suffix, and a base constraint
   dictionary is nested inside the more specific dictionary.
9. Public declarations and public capability—not private calls—determine the surface.
10. Generated names, dictionary shapes, and dictionary-parameter order are API and ABI.

## Continuity constraints

- Preserve subject-first source arguments and trailing dictionary parameters.
- Keep concrete specializations direct; never describe them as wrappers over the
  generic edition.
- Include all and only lawful fundamental combinations; unconstrained variables stay
  generic.
- Reserve the source base name for the conditional generic edition.
- Do not generate named specializations for unbounded user types.
- Keep dictionary objects compiler/runtime-produced, branded, and ordinarily trusted.
- Define dictionaries concretely as JavaScript objects containing constraint operations.
