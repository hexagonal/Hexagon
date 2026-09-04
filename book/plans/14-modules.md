# Chapter Brief: Modules

## Purpose

Teach the module header and its name as identity, several modules per file with
`end module`, private-by-default declarations, the single path-free module-import
form, named exports, opaque records and unions, companion modules, acyclic loading,
top-level
effects, root execution, and the global visibility of instances.

## Reader outcome

The reader can divide a program into named modules, import one by its name or under
an alias, publish a deliberate API, hide a nominal representation, and predict module loading
and execution without looking for a special `main` function.

## Teaching order

1. A module declares its name in a header; several modules may share a file, closed
   by `end module`; paths mean nothing.
2. Private-by-default declarations and named exports.
3. The module import — one form; a bare name is a declaration, a companion fallback,
   or a `match`-arm constructor.
4. Module aliases and the companion-module idiom.
5. `opaque` for records and unions.
6. Public-signature visibility and instance globality.
7. Acyclic loading, top-level effects, and selected roots.
8. Direct ESM emission.

## Continuity constraints

- Use `let` for ordinary functions and `fun` only for recursion.
- Treat modules as namespaces and visibility fences, never first-class values or
  sources of type identity.
- Opacity hides structure, not capabilities; derived and declared instances remain
  available.
- Do not suggest a language-level `main` or module-level mutable state.
- Keep the source import/export surface visibly close to ESM.
