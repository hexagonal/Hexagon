# Chapter Brief: Modules

## Purpose

Teach files as modules, private-by-default declarations, the four import forms, named
exports, opaque records and unions, companion modules, acyclic loading, top-level
effects, root execution, and the global visibility of instances.

## Reader outcome

The reader can divide a program into files, choose qualified or unqualified imports,
publish a deliberate API, hide a nominal representation, and predict module loading
and execution without looking for a special `main` function.

## Teaching order

1. One file is one module; paths supply identity.
2. Private-by-default declarations and named exports.
3. Named, aliased, namespace, and effect imports.
4. Module aliases and the companion-module idiom.
5. `export opaque` for records and unions.
6. Public-signature visibility and instance globality.
7. Acyclic loading, top-level effects, and selected roots.
8. Direct ESM emission.

## Continuity constraints

- Use `let` for ordinary functions and `fun` only for recursion.
- Treat modules as namespaces and visibility fences, never first-class values or
  sources of type identity.
- Opacity hides structure, not capabilities; derived and declared instances remain
  available.
- Do not imply a language-level `main` or module-level mutable state.
- Keep the source import/export surface visibly close to ESM.
