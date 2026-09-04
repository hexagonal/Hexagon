# Chapter Brief: Packages

## Purpose

Teach what a package is (`hexagon.json`, the modules beneath it), the package name
as the namespace supplying every module's full name, the standard library as the
package `Hex`, the project as the package being built, which modules a module can
see, resolution of a module name (bare when unique; the resolving package's own
module wins; a contest between packages is refused), the one-reading rule for a
dotted import, source distribution through npm with whole-program compilation, and
the emitted layout under package directories.

## Reader outcome

The reader can declare a package, list its dependencies, import a dependency's
module bare or by full name, predict what happens when two packages provide one
module name, publish a package to npm, and find every emitted file.

## Teaching order

1. A package is a manifest and the modules beneath it; full names; `Hex`.
2. The project is a package with no name.
3. Which modules a module can see.
4. Bare when unique, qualified when contested; the one-reading rule.
5. Packages ship source; the program is compiled whole; the later compiled stage.
6. Where the output goes.

## Continuity constraints

- A package name is a namespace and nothing more: no scope, no identity.
- Never rank a contested name; refuse and name the spellings.
- Keep the Modules chapter's vocabulary: module, home module, alias, root module.
- Do not teach a lockfile or version syntax; they are npm's.
