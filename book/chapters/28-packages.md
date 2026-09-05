# Packages

The Modules chapter could say only that two modules in one package may not share a
name. It left the rest open on purpose: a module is reached by the name it declares,
so what happens when a module of that name belongs to somebody else's library? This
chapter answers that, and in doing so describes how Hexagon code is shared: what a
package is, how a program says which packages it uses, and what the compiler does with
the result.

The short version is that a package is a named set of modules, its name is a namespace
and nothing more, and a program is still compiled as one whole.

## A package is a manifest and the modules beneath it

A package is a directory holding a `hexagon.json` file, and the file names it:

```json
{
  "name": "Acme",
  "dependencies": ["Bolt", "Chroma"]
}
```

Every `.hex` file beneath that directory belongs to the package, each declaring its
module as the Modules chapter described. There is no list of modules in the manifest.
The headers are the declarations, and the tooling finds the files. Within one package
no two modules may declare the same name; the fix is a dotted name on one of them. A
directory that carries a manifest of its own is a package of its own, which is how a
workspace of several packages sits in one tree without any file belonging to two of
them.

The package name is one uppercase-start identifier, never dotted. It supplies the first
segment of every one of its modules' **full names**: `module Geometry` in `Acme` is
`Acme.Geometry`, and `module Render.Geometry` there is `Acme.Render.Geometry`. The full
name is what a qualified import writes, what an emitted file is laid out by, and what
an exception's `$hex` brand carries. A package never spells its own name inside its own
source; naming a package — or renaming it — changes no line of any module, though it
does change the emitted `$hex` brand: an unnamed project's `module Parser` brands
`"Parser"`, and a manifest `"name": "Acme"` makes that `"Acme.Parser"`. That is why a
project takes its `name` before any JavaScript consumer depends on a brand.

The standard library is a package too. Its name is `Hex`, it needs no entry under
`dependencies`, and every program depends on it. The prelude — `Option`, `Vector`, and
the rest of the modules in scope without an import — is the part of `Hex` the Modules
chapter already described; its modules' full names are `Hex.Option` and `Hex.Vector`.
No other package may be named `Hex`.

## The project is a package with no name

The package the compiler is asked to build is the **project**. Its manifest may carry
no `name` at all. A project that is never published needs none: its own modules are
reached by the names they declare, and a project never qualifies its own modules by a
package name. Inside a project named `MyApp`, `import MyApp.Geometry` is an unknown
module, and the compiler says to write `import Geometry`.

A project that will be published gives its manifest a `name`, and that name is what its
consumers write. Library and application are not different kinds of package, just as
they are not different kinds of module: the same directory can be built as a root and
installed as a dependency.

## Which modules a module can see

Inside a package, an import can name three kinds of module:

1. the package's own modules;
2. the modules of `Hex`, of which the prelude is additionally in scope without an
   import; and
3. the modules of every package the manifest lists under `dependencies`.

Nothing else. A dependency's own dependencies are invisible: if `Acme` uses `Bolt`,
your project still cannot write `import Bolt.Util` unless it lists `Bolt` itself. The
modules you cannot name may still be part of the program — `Acme`'s imports bring them
in, and the instances they declare are as global as any — but your imports do not
reach them. The visible set is decided per package, so a dependency's imports are
resolved against *its* manifest, never yours.

## Bare when unique, qualified when contested

`import Geometry` resolves when exactly one visible module is named `Geometry`. In the
common case that is all a reader ever sees. Two rules cover the rest, and both are ones
the Modules chapter already applied to ordinary names.

**Your own module wins.** If your package declares a `module Geometry` and a dependency
provides one too, the bare import means yours, silently, and the dependency's stays
reachable by its full name:

```hexagon
import Geometry              // the project's own
import Acme.Geometry as AcmeGeo
```

This is the same courtesy the prelude extends. A project may declare `module Vector`,
its imports of `Vector` mean the project's, and `Hex.Vector` names the library's. The
reason is also the same: a module added to the standard library or to a dependency can
never break a program that already had one of that name.

**Between packages, a contest is refused.** If your package has no `Geometry` and two
visible packages provide one — two dependencies, or a dependency and `Hex` — the bare
import is an error that names both spellings:

> `Geometry` is provided by `Acme` and `Hex`; write `import Acme.Geometry` or
> `import Hex.Geometry`

Nothing is ranked — not the order packages were listed, not the order they were
installed. Neither provider owns the bare spelling, so the use site says which one it
means. This is the rule the prelude reserves for two of its modules exporting one bare
name: the qualified spelling is never far away, and it never silently changes meaning
underneath you.

A dotted spelling has two possible readings, and the rule that keeps them apart is
small. A dotted spelling like `Acme.Geometry` is read as a package's module wherever
`Acme` is a package your module can see other than your own, and as a module's own
dotted name otherwise —
and the compiler refuses any module whose dotted name begins with the name of a package
in the program, so a spelling never has two readings at once. A dotted `module
Acme.Tools` in a project that depends on `Acme` is refused at its header; the fix is a
different first segment. An undotted `module Json` beside a dependency named `Json` is
fine, and is the companion idiom's plainest shape.

## Packages ship source, and the program is compiled whole

A Hexagon package is published to npm and installed from it, as an npm package whose
root holds `hexagon.json` and the `.hex` source. Versions, version ranges, and the
lockfile are npm's; Hexagon designs none of them. The npm name of the package —
`@acme/geometry`, say — is not read by the language and need not resemble the Hexagon
name. What npm names is a distribution; what Hexagon names is a namespace. The
compiler learns which packages are Hexagon packages from the manifests it meets, and
it looks each package's `dependencies` up from that package's own directory the way
Node finds a package — its `node_modules`, then each directory above, the nearest copy
answering — resolving each package reached in turn, outward from the project, into an
acyclic set: the packages *in the program*. A copy farther up than the one that
answered does not answer that package's lookup, and a package nobody lists enters no
program. A `dependencies` cycle is refused and named, as an import cycle is. A program
holds one copy of each package name, the project counted, and refuses to build when
two of its packages reach two copies — the nested duplicate npm installs when two
packages want two versions.

Because a package ships its source, the compiler sees a program's dependencies exactly
as it sees the program's own modules, and compiles the whole graph at once. Every rule
this book has stated over "the program" holds across packages without a footnote:
coherence still allows one instance per constraint-and-type pair over everything
reached, the orphan rule still places that instance in the constraint's home or the
type's, and a package that declares neither cannot declare the instance. The cost is
stated plainly. A build compiles its dependencies' source every time, which the tooling
can cache; a Hexagon package cannot be closed-source; and a package that also serves
JavaScript consumers ships its emitted JavaScript beside the source.

A second stage is recorded for later: a package that ships compiled JavaScript and a
compiler-generated interface, so that a consumer's build reads the interface instead of
the source. That interface would have to reproduce everything whole-program checking
decides today, which is why it is not the first stage.

A JavaScript package is never a Hexagon package. An npm package without `hexagon.json`
is reached through `extern from "pkg"`, the boundary declaration of the JavaScript
Input chapter, and it declares no Hexagon module, type, constraint, or instance.
Listing one under `dependencies` is refused with that spelling as the repair.

## Where the output goes

A program's emitted output has one root. The project's modules sit there by their
declared names, dotted segments as directories — `Geometry.js`, `Render/Geometry.js` —
and every other package's modules sit under a directory named by the package:
`Acme/Geometry.js`, and for the standard library, `Hex/Option.js`. The emitted import
from a project module at the root to the prelude is therefore `"./Hex/Option.js"`, and
from a module one level down, `"../Hex/Option.js"`. Two program-scoped files sit at the
root as well, each emitted only when the program owes it: `hex.d.ts`, the type
declarations a generated `.d.ts` refers to, and `hex.js`, which a module reaches for
when one of its own names collides with a JavaScript global the runtime uses.

Two packages' same-named modules never collide on disk, and the output is a closed
tree of relative imports: it runs from wherever it is copied, and imports nothing from
`node_modules` on Hexagon's account. A dependency's JavaScript packages keep their bare
specifiers and resolve as npm resolves them.

## Summary

- a package is a directory with a `hexagon.json` naming it and listing its Hexagon
  dependencies; the modules beneath it are found by their headers, and a nested
  manifest is a package of its own;
- the package name is one uppercase-start identifier and supplies the first segment of
  every module's full name, `Acme.Geometry`; the standard library is the package `Hex`;
- the project is the package being built, and needs a name only to be published; it
  never qualifies its own modules by that name;
- a module sees its own package, `Hex`, and its direct dependencies, and nothing
  transitively;
- a bare module name resolves when unique, the resolving package's own module wins
  silently, and a contest between packages is refused naming every full spelling —
  never ranked;
- a dotted module name may not begin with the name of a package in the program, so a
  dotted import has one reading;
- packages ship source through npm, the program is compiled whole, and coherence and
  the orphan rule hold across packages unchanged; compiled distribution with a
  generated interface is a recorded later stage;
- JavaScript packages enter through `extern from`, never through `dependencies`; and
- output is one tree: project modules at the root, every other package under its own
  directory, `Hex` included.
