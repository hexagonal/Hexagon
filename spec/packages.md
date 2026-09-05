# Hexagon Spec: Packages

**Status:** Decided (September 2026, #829) for the first distribution stage; the second stage is **recorded, not designed** (§5.2).
**Scope:** What a package is and how it is named; the manifest `hexagon.json`; the package name as the namespace supplying a module's full name; the set of modules a program can see and how a written module name resolves in it — bare when unique, the resolving package's own module ahead of a package's, refused when two packages contest it; per-package resolution; distribution on npm with the source shipped, each package's dependencies looked up from its own place and the `dependencies` closure acyclic; whole-program compilation across packages, so that coherence and the orphan rule are unchanged; the layout of emitted output under packages; the second stage's shape and the facts that bound it; diagnostics; conformance.
**Not in scope:** the `import` head and the module header (Modules §2–§3, which this spec relies on and does not restate); re-exports (Modules §12.2); version selection and lockfiles (npm's own, §4.2); the second stage's interface format (§5.2 says what it must reproduce and no more); registries other than npm, and any mechanism for finding a package directory beyond npm's layout, which is a host's (compiler architecture, `environment.md` §4); JavaScript-only packages, which are the FFI's (§4.4); the CLI and project-configuration surface beyond the manifest fields named here (compiler architecture).
**Companions:** Modules §1 (doctrine), §2 (module identity, names, what an importer may omit — §2.3 is the syntax half of §3 here), §3 (`import`), §5.4–§5.5 (occlusion; the prelude as ordered modules), §7 (instances, coherence, orphan rule), §11 (emission); Constraints §5.3 (orphan rule); FFI Part 4 §2.1 (foreign specifiers) and §8 (`extern import`); FFI Part 1 §8.3 and Part 7 §1.2 (program-scoped artifacts); the zero-cost exports spec §4 (the program-dependent edition trigger that bounds stage two); `spec/notes/package-constraint-interfaces-sol-2026-09.md` (a non-normative seed for stage two).

---

## 1. Doctrine

- **A package is a named set of modules, shipped as source.** Its name is one uppercase-start identifier (`Acme`), declared in its manifest (§2.1). Its modules are the `.hex` files beneath the manifest, each declaring its own module (Modules §2). Nothing else is a package: a directory of `.hex` files with no manifest is a project's own source or nothing, and an npm package with no manifest is a JavaScript package (§4.4).
- **The package name is a namespace and nothing more.** It supplies the first segment of every one of its modules' full names — `Acme.Geometry` for `module Geometry` in `Acme` — and that segment is the one an importer may omit (Modules §2.3). It creates no scope, no visibility, and no identity: a type's identity is its declaration's (Modules §2.3), an instance is global (Modules §7.1), and a module's exports are the same exports under every spelling of its name.
- **A program sees its own modules, the prelude, and the modules of its direct dependencies.** Not a dependency's dependencies (§3.1). The modules a program does not see may still be *in* it — a dependency's imports bring them into the graph, and their instances are global as everywhere — but no import of the program's own can name them.
- **A contested name is refused, never ranked** (§3.3) — with the one occlusion the language already grants: the resolving package's own module ahead of a package's (§3.2). No nearest-package rule, no first-declared rule, no search over suffixes (Modules §9.16).
- **A program is compiled whole, across every package it reaches** (§5.1). Because a package ships its source, `hexc` sees the dependency graph as it sees a project's own modules, and coherence, the orphan rule, and whole-program specialization run unchanged. The second stage, a package that ships compiled and carries a generated interface, is recorded with the facts that bound it and not designed (§5.2).
- **Distribution rides npm.** A Hexagon package is an npm package that carries `hexagon.json`; installation, versions, and the lockfile are npm's, and this spec designs none of them (§4). What a package *is* and how its directory is *found* are kept apart: the compiler reads a package as a record and validates it by the rules here, and npm's layout is the first mechanism a host supplies for finding one (§4.1) — each package's dependencies looked up from that package's own place, as Node itself looks, so that no refusal rests on a copy no package in the program reaches.

---

## 2. What a package is

### 2.1 The manifest

A package is the directory holding a `hexagon.json`, and the file names it:

```json
{
  "name": "Acme",
  "dependencies": ["Bolt", "Chroma"]
}
```

- **`name`** — the package's name: one uppercase-start identifier (Lexer §3.1's `UpperName`), not dotted. It is the namespace segment of every module the package holds (§2.3). `Hex` is reserved for the standard library (§2.4) and refused in the project's manifest; a manifest declaring it under a `node_modules` is a candidate for no name (§4.1) and answers nothing, so no program can hold a second `Hex`, and the lookup carries no mechanism for catching a published package that declares it — none is needed, since it can never be reached.
- **`dependencies`** — the names of the Hexagon packages whose modules this package's modules may import (§3.1). Each is resolved by §4.1's lookup, from this package's own directory, by the `name` each candidate's manifest declares; a listed name that lookup does not find, or that it finds at two directories with none nearer (§4.1), is refused (§7).
- **Other fields are the host's.** The manifest may carry host configuration this spec does not read, and a host may add fields of its own — an output directory, a narrower source list — none of which changes what this spec states. A manifest with no `name` is a **project** (§2.5); a manifest with no `dependencies` depends on nothing but the standard library.

### 2.2 A package's modules

Every `.hex` file beneath the manifest's directory belongs to the package — `node_modules`, the host's output directory, and any directory holding a `hexagon.json` of its own excluded: a nested manifest is a package of its own (§2.1), the ordinary shape of a workspace, and its files belong to it alone, so no file ever has two full names. Each declares its module or modules (Modules §2.1–§2.2), and module names are unique within the package, compared case-insensitively (Modules §2.2). The tooling discovers the files; nothing in the language names one. A package is free to lay its sources out as its dotted names suggest — `module Render.Geometry` at `Render/Geometry.hex` — which serves a reader and nothing else: the compiler reads no path to learn a name (Modules §1; §8.5 refuses the rule this habit resembles), a module named otherwise than its directory is not a module misplaced, and the one layout the language does prescribe is the emitted one (§6), where dotted names are directories.

### 2.3 Full names

A module's **full name** is the package's `name`, a dot, and the module's declared name: `module Render.Geometry` in `Acme` is `Acme.Render.Geometry`. The declared name may be dotted (Modules §2.1); the package segment is always exactly one, which is why a package name is not (§2.1). A module of a project with no `name` (§2.5) has its declared name as its full name — the one case with no package segment. The full name is what a qualified import writes (`import Acme.Render.Geometry`), what a contest refusal names (§3.3), what the exception brand carries (Exceptions §7.1), and what the emitted output is laid out by (§6). It is never what a module declares about itself: a package's source never spells its own name, so a package renamed in its manifest changes no line of its modules.

### 2.4 The standard library is the package `Hex`

The standard library's modules form the package `Hex`. Its **prelude** — the fixed, ordered list Modules §5.5 governs — is in scope in every module of every package without an import, under its bare names; the rest of `Hex`, when there is a rest, is imported by name like any package's module. A prelude module's full name is `Hex.Option`, `Hex.Vector`: an import `import Hex.Option as Opt` binds a second alias onto it (Modules §3.1), and where a project declares its own `module Option`, the bare name is the project's for its importers and `Hex.Option` stays reachable (§3.2). `Hex` needs no `dependencies` entry: every package depends on it, and an entry naming it is refused with the reason — "`Hex` is every package's dependency; remove the entry" (§7). Its source is kept in the repository's `stdlib/` directory, and the directory is not called `Hex`: the directory says what it holds, and `Hex` is what a program writes, a package's name coming from its manifest and never from a directory (§2.1). The whole library is `Hex`'s: the prelude, the rest, and the **runtime modules** the emitted program runs on — `Hex.Runtime.VectorTrie`, `Hex.Runtime.HashTrie`, each declared `module Runtime.<Name>` and kept under `stdlib/Runtime/` by §2.2's convention. They export nothing at the Hexagon level, so they are modules like any other with nothing to reach: `import Hex.Runtime.VectorTrie` binds an alias and any qualified use draws the ordinary does-not-export report, and no rule carves them out of §3.1's visible set. Their two compilation privileges — the `runtime` flag and the intrinsic door (`intrinsics.md` §5.2) — attach to their membership in `Hex`'s runtime list, never to a path; a project file stands in for a member only by declaring the member's name at the member's basename (`intrinsics.md` §5.2).

### 2.5 The project

The root package — the one the host compiles — is the **project**. Its manifest may carry no `name`: a project that is never published needs none, since its own modules are addressed by their declared names alone (§3.2), and a project never qualifies its own module by its own package name — `import MyApp.Geometry` inside `MyApp` is the unknown-module error, not a synonym, the project's instance of §3.3's rule for every package (and no module in the program can be *declared* `MyApp.Geometry` to answer it: Modules §2.2 forbids a dotted module beginning with any package in the program). A project that is published as a dependency of others gives its manifest a `name`, and that name is what its consumers write; no entry of the package closure may resolve it to a directory other than the project's own (§4.3). Library and application are therefore not distinct kinds of package, exactly as they are not distinct kinds of module (Modules §8.3): the same directory may be compiled as a root and installed as a dependency.

---

## 3. Visibility and resolution

### 3.1 The visible set

For a module in package `P`, the **visible modules** are:

1. the modules of `P` itself;
2. the modules of `Hex` (§2.4) — of which the prelude is additionally in scope without an import;
3. the modules of every package `P`'s manifest lists under `dependencies` (§2.1).

Nothing else. A dependency's own dependencies are invisible to `P`'s imports even though their modules may be in the program — `Acme` importing `Bolt`'s modules does not let the project write `import Bolt.Util` unless the project lists `Bolt` too. The set is **per package**: each package's imports resolve against its own visible set, so `Acme`'s `import Util` means `Acme`'s dependency's `Util` (or `Acme`'s own), never the project's, whatever the project names `Util`. A module is in the program exactly when some import reaches it from a root (Modules §8.3), and once in it, its instances are global (Modules §7.1) — visibility governs what an import may *name*, not what the program *contains*. A **package** is in the program on a different footing: it is the project, or `Hex`, or it lies in the transitive `dependencies` closure the resolver assembles from the manifests (§4.1) — a fact of the package set, fixed before any import is resolved and independent of which modules the imports reach. Modules §2.2's first-segment rule reads this set, which is what keeps it well-founded: whether `Acme` is in the program never depends on how an `import Acme.Tools` resolves.

### 3.2 The resolving package's own module wins

Where the package resolving an import — the project, or a dependency resolving its own — declares a module of the written name, the import resolves to it, **silently**, and a same-named module of any visible package stays reachable by its full name. The rule is Modules §5.4's occlusion one level up, and for the same reason: adding a module to the standard library or to a dependency **cannot break a program that already declares one**. The cost is Modules §5.4's too — a reader who sees `import Geometry` in a project that has its own `Geometry` module learns nothing of `Hex.Geometry`'s existence from that line, and needs no such knowledge, since the line means the same whether or not the package module exists.

### 3.3 Between packages, a contest is refused

Where the resolving package has no module of the written name and **two or more** visible packages provide one — a dependency and `Hex`, or two dependencies — the import is an error naming every full spelling, in a fixed order (the resolving package's `dependencies` order, then `Hex`): "`Geometry` is provided by `Acme` and `Hex`; write `import Acme.Geometry` or `import Hex.Geometry`". The rule is Modules §5.5's collided-name refusal one level up: neither provider owns the bare spelling, the use site qualifies, and no order of installation, declaration, or listing ever decides silently. The break this admits is the one Modules §5.4 already admits for names — a module the standard library or a dependency adds under a spelling one dependency already provides turns a working bare import into this refusal — and it is a reference-shaped break with a mechanical fix named in the message, never a silent re-meaning.

**A dotted spelling has one reading, and a package never qualifies its own modules.** Where the first segment of a written dotted name names a package visible to the resolving package other than itself, the import is that package's module by its full name; otherwise it is a visible module by its declared name. Where neither answers and the first segment names an **installed** Hexagon package the resolving package does not list, the refusal is the not-a-dependency report (§7), whose repair is the manifest, not the unknown-module one — provided no module of any package in the program — the package set's every module, imported or not (Modules §2.2) — has a declared name whose first segment is that package's name (Modules §2.3): for a package in the program but unseen Modules §2.2 guarantees it; an installed package in no closure is no package in the program, a declared name beginning with its name stays lawful, and where one exists the unknown-module report fires and the manifest edit is withheld, since applying it would refuse that module. The two never meet: Modules §2.2 forbids every module in the program a dotted name beginning with any package in the program, refusing it at the header where the declaring package sees the package and at the whole-program check where it does not (a dependency `Bolt` that lists no `Acme` may declare `module Acme.Tools` and compile alone; a program holding both `Bolt` and `Acme` in its package set — §3.1 — is refused naming the module and both packages — §7). The exclusion of the resolving package's own name is what makes a package's own modules reachable by their declared names alone: `import MyApp.Geometry` inside `MyApp` is the unknown-module error (§2.5 states it for the project, the ordinary instance), since the full-name reading excludes `MyApp` and no module in the program is declared `MyApp.Geometry` while `MyApp` is a package in it.

### 3.4 What an importer writes

Modules §2.3 and §3 own the syntax; restated here as the resolution they invoke:

| Written | Resolves to |
|---|---|
| `import Geometry` | the resolving package's own `Geometry` if it has one (§3.2); else the one visible package module declared exactly `Geometry` (§3.1); two or more → §3.3's refusal; none → unknown module, near misses named (Modules §2.3) |
| `import Render.Geometry` | the same, for the declared name `Render.Geometry`; never reached by `import Geometry` |
| `import Acme.Geometry` | `Acme`'s module `Geometry`, where `Acme` is visible (§3.1) and is not the resolving package itself (§3.3) — the full name, the one reading of the spelling |
| `import Hex.Option` | the prelude module, already in scope (§2.4); binds the alias and nothing new |
| `import Acme.Tools`, resolving to nothing, `Acme` installed but not listed by the resolving package | the not-a-dependency report (§3.3, §7): "`Acme` is not a dependency of this package; add `"Acme"` to `dependencies` in `hexagon.json`" — unless a module of any package in the program, imported or not, is declared under the segment `Acme`, when the unknown-module report fires and no edit is offered |
| `import MyApp.Geometry` inside `MyApp` | unknown module (§3.3, §2.5): a package never qualifies its own modules |

The default alias of every form is the declared name's last segment; `as` overrides it (Modules §3.1).

---

## 4. Distribution

### 4.1 npm carries it

A Hexagon package is published to and installed from **npm**, as an npm package whose root holds `hexagon.json` and the package's `.hex` source. Two things are kept apart here, deliberately. What a package **is** — a directory holding a manifest, identified by the manifest's `name` and by the directory's canonical path, validated by the rules of this spec — is the language's. How a package directory is **found** is a host's mechanism (compiler architecture, `environment.md` §4): the compiler reads packages as records — a name, a `dependencies` list, a directory, a version where one is known, the files beneath — and never reads a `node_modules` directory itself. npm's layout is the first mechanism a host supplies, and the walk the next paragraph states is the specification of that host mechanism, not of a compiler pass. What a lookup **answers with** — the candidate directories at the nearest answering level, each with its manifest's `name` and its npm version where one is declared, and the manifests it scanned and could not read — is the raw material of those records and of the reports §7 prints about installation; only a candidate that answers alone becomes a package in the set; another may supply directories later, and no rule here changes when it does. This spec designs no mechanism beyond npm's and adds no manifest field for one.

**Lookup, under npm's layout.** A package's `dependencies` are resolved **from that package's own directory** — its canonical one, links followed (§4.3) — by the walk Node itself makes for a requested name: the package's `node_modules`, then each ancestor directory's, outward to the filesystem root, an ancestor named `node_modules` skipped as Node skips it. A **level** is one `node_modules` directory, and its **package roots** are its entries, and the entries of any `@scope` entry, that hold a `hexagon.json` — nothing deeper: a nested `node_modules` is a level of another package's walk, and the nearest one for the package that holds it. npm names a directory and Hexagon names a manifest, so the walk learns the names at a level by reading the `hexagon.json` of every package root at that level, and the **nearest** level holding a manifest that declares the requested name answers. A copy at a farther level answers that lookup never: it is shadowed **for that walk**, and enters the program only where some package's own lookup answers with it — which is how a program comes to hold two (§4.3). A package no entry of the closure names enters no program, whatever its manifest says; a lookup is run for an unlisted first segment only to decide §3.3's not-a-dependency report, and it adds nothing to the package set and draws no refusal of its own: where it answers, §3.3's report is the not-a-dependency one, subject to §3.3's proviso for a module already declared under that segment; where it finds nothing, or where the requested name is declared at one level by two package roots at two canonical directories, the unknown-module report fires and no manifest edit is offered. The one place this differs from Node's rule is the one Node never meets, since npm forbids two directories of one npm name: two package roots at **one level** whose canonical directories differ (§4.3), both declaring the **requested** name, are refused where the walk resolves an entry of the closure — §4.3's installed-twice report, both directories named — because no nearest-first rule orders them. The climb is what makes a workspace's hoisted layout work: `packages/app` lists `Acme`, has no `node_modules` of its own, and the workspace root's answers; a workspace package installed as a link resolves from its real directory, which is where its own hoisted dependencies are found.

**A manifest the walk cannot use supplies no candidate and stops nothing.** The walk meets packages nobody asked for. One whose `hexagon.json` does not parse is a candidate for no name and refuses no lookup; it is named only inside the unresolvable-name report of a lookup that scanned it — "no installed package declares `"name": "Acme"`; install it, or check the name in its `hexagon.json` (`node_modules/@acme/geometry/hexagon.json` could not be read: …)" (§7) — since that is the one moment it could have been the package wanted, and where every lookup succeeds it is silent. One that parses and declares no `name` this spec will accept — a project's manifest (§2.5), linked into a `node_modules` as a workspace links it; a reserved or malformed one — is a candidate for no name too, and is named nowhere: nothing about it is broken. §2.1's `name` refusals — the reservation and the identifier shape — are the project's manifest's alone (§2.1, §7): a manifest the walk merely scans is a candidate for the name it declares and nothing more, and a candidate exists only for a name this spec accepts, so no package the lookup answers with can carry either fault. What a package the lookup answers with is checked for is its own `dependencies` (§2.1, §4.4), read over the package set and nothing wider (§4.3). An npm package with no `hexagon.json` at all is a JavaScript package (§4.4), read for nothing.

The project's `dependencies` are resolved so, and each package reached has its own resolved in turn, from its own directory, outward from the project, until the list closes; an entry resolving to a directory already in the set adds an edge and no package. A package is **installed**, for the package resolving a name, exactly when that package's lookup finds it — the sense in which Modules §2.3's not-a-dependency report reads the word. The closure is **acyclic**, as Modules §8.1 makes the import graph, on grounds of its own kind: a `dependencies` cycle is refused naming it — "dependency cycle: `Acme` → `Bolt` → `Acme`" (§7) — so that packages have one deterministic order, the closure is a set assembled outward from the project and closed, and no manifest's meaning depends on a cycle. One consequence the rule also secures, at the mutual case: two packages that listed each other would each see the other, and a cross-package instance would have two lawful homes (§5.1) — the acyclic closure leaves it one. A package listing its own `name` is the one-package cycle, found as every cycle is, by directory identity — where its lookup reaches its own directory; where a nearer copy of the name answers, the program holds two (§4.3) — and renders "dependency cycle: `Acme` → `Acme`". A project listing its own `name` is read the same way: where its lookup reaches the project's own directory it is the one-package cycle; where it finds nothing it draws §2.1's unresolvable-name refusal; and where it finds another package of that name it draws §4.3's project-name refusal, the program holding two packages of one name. The packages so reached, with the project and `Hex`, are the program's **package set** — what §3.1 calls the packages *in the program* — assembled from manifests alone before any module is parsed. The npm package's own name (`@acme/geometry`) is not read by the language and need not resemble the Hexagon name: what npm names is a distribution, and what Hexagon names is a namespace.

A package may also carry the JavaScript and `.d.ts` its author emitted, for JavaScript consumers, alongside the source; in the first stage `hexc` does not read them (§5.1). A package that carries only emitted output and no source is not a Hexagon package in the first stage (§4.4, §5.2).

### 4.2 Versions and the lockfile are npm's

This spec designs no version syntax, selection policy, or lockfile: `package.json` declares npm dependencies at whatever versions, npm resolves and locks them, and the Hexagon manifest names which of its installed npm dependencies are Hexagon dependencies. What this spec adds is one constraint on the result:

### 4.3 One copy of a package per program

A program holds **exactly one** package per Hexagon package name — the project counted among them — and the rule is read over the **package set**, §4.1's closure, and over nothing wider. Where two entries of the closure resolve one name to two directories — over records, two packages of one name at two directories in the closure — the program is refused before checking, naming both directories and the npm version each carries where its npm manifest declares one: "package `Acme` is installed twice: `node_modules/@acme/geometry` (2.1.0) and `node_modules/@bolt/tools/node_modules/@acme/geometry` (1.4.0); a program holds one copy of each Hexagon package". That is the nested-duplicate case in full: npm nests a second copy exactly when a dependency wants another version, `Bolt` finds it first from its own directory (§4.1), the project finds the root's, and the program would hold both. Two package roots at one level of a walk resolving an entry of the closure, declaring the name it seeks at two canonical directories, draw the same report (§4.1); a lookup run only to decide a diagnostic draws none. **Directory identity is the canonical path**, links followed: two links reaching one package are one copy, never two, and the report prints each directory relative to the project — climbing where the walk climbed, `../node_modules/@acme/geometry`. A copy nothing in the closure reaches is no package in the program and is refused by nothing — no lookup of a package in the closure answers with it (§4.1) — so a stray copy in an ancestor's `node_modules` cannot fail a program that never resolves to it. Where an entry of the closure resolves the **project's** own `name` (§2.5) to an installed package at a directory other than the project's own — a dependency lists a package named as the project is, or the project lists its own name and a package of that name is installed (§4.1) — the program is refused the same way, at the manifest: "this project declares `"name": "Acme"`, and `Acme` is also installed at `node_modules/@acme/geometry`; a program holds one package of each name" — without it two modules would share one full name, §2.3's spelling would stop being an address, §6 would emit one at the root and one under `Acme/`, and Exceptions §7.1's brand would stop being unique. An entry that resolves the project's name to the project's **own** canonical directory adds an edge to the package already in the set, and no package — canonical identity applied, the rule by which two links are one copy — and where the edges close a cycle the ordinary cycle rule reports it (§4.1): a workspace links the project into a sibling's `node_modules`, the project lists the sibling, and the sibling lists the project. Only edges reachable from the project enter its graph, so a link alone, into any `node_modules`, refuses nothing: a manifest nobody lists is a candidate that answers nothing (§4.1). The duplicate-name refusal above is reserved for a different canonical directory declaring the same name; no case here has a rule of its own. The refusal keeps two copies out rather than telling them apart, and says so: two copies would be two packages of one name, whose same-named nominal types are distinct declarations and whose instances may both be lawful, and a diagnostic that keeps them apart must expose the version split at every mention — a design this stage does not undertake. A later stage may admit them as distinct identities; nothing here forbids it, and nothing here relies on their absence except the spelling of full names (§2.3), which would gain a disambiguator then.

### 4.4 JavaScript-only packages are the FFI's

An npm package with no `hexagon.json` is a JavaScript package. Its modules are reached by `extern from "pkg"` (FFI Part 4 §2.1) and `extern import "pkg"` (Part 4 §8), never by `import`: the string specifier appears in the one and never in the other (Modules §1), and a JavaScript package declares no Hexagon module, type, constraint, or instance. Listing such a package under `dependencies` is refused — "`tiny-json` is not a Hexagon package: bind it with `extern from "tiny-json"`" — and a Hexagon package's manifest never lists its JavaScript dependencies, which are `package.json`'s.

---

## 5. Compilation across packages

### 5.1 Stage one: whole-program, from source

The program's graph is every module reached from its roots by import (Modules §8.3), across packages. Every one of them is source, and `hexc` compiles the graph whole, so every rule this corpus states over "the program" or "the whole import graph" holds across packages unchanged and needs no restatement — with one check read over a different set: Modules §2.2's first-segment rule reads every module of every package in the package set (§3.1, §4.1), imported or not, and is the one whole-program check that is not a graph check:

- **Coherence** (Modules §7.3): one instance per `(constraint, type)` pair over the whole graph, a duplicate reported naming both modules — in two packages as in one.
- **The orphan rule** (Modules §7.2; Constraints §5.3): `honor C<T>` lives in the module declaring `C` or the module declaring `T`. Across packages this composes through the acyclic dependency closure (§4.1): the package declaring `C` may honor at a `T` it can see, the package declaring `T` may honor at a `C` it can see, and since no two packages list each other, both cannot hold at once; a third package that depends on both owns neither and cannot declare the instance. One lawful home for a cross-package pair, and the whole-graph duplicate check stands behind it as always.
- **Discoverability** (Modules §7.6): naming `C<T>` brings both homes into the graph, in whatever packages they sit; a package boundary hides no home.
- **Specialization and emission** (the zero-cost exports spec; FFI Parts 8–9): the whole-program planning — which editions a constrained export emits, which call sites specialize — reads the whole graph, dependencies included. A dependency's module is emitted by the program's own compile, into the program's own output (§6); the emitted files a package may carry for JavaScript consumers (§4.1) are not linked against.

The cost is stated plainly: a program's build compiles its dependencies' source, every time, cacheable by the host and real; a Hexagon package cannot be closed-source; and a package that serves JavaScript consumers too ships two artifacts of one text.

### 5.2 Stage two: compiled distribution — recorded, not designed

A later stage may let a package ship **emitted JavaScript, `.d.ts`, and a compiler-generated interface** per module, and let a consumer's compile read the interfaces and link against the shipped JavaScript instead of compiling the source. It is recorded here so its shape is fixed before it is wanted and its cost is not discovered at design time:

- **The interface is generated, never written.** `honor` remains the only source declaration of an instance, and an exported function's constraints remain in its signature (Modules §4.1.1). No `export honor`, no manifest of instances, no author-written duplicate of what the checker knows.
- **The interface reproduces the whole-program selection.** For each module: its exported schemes and types, every constraint it declares, every instance it declares as a provider keyed by declaration identity (Constraints §5.1.1's law — names establish nothing across packages), every evidence selection its compiled code made, its dependency fingerprints, and the dictionary ABI version (FFI Part 9 §11). The final program's compile unions the activated interfaces, refuses a duplicate provider, verifies every recorded selection against the one active provider, and fails on a fingerprint or ABI mismatch — before linking, never at run time.
- **Source and interface are equivalent, by test.** Compiling a dependency from source and from its interface must select the same providers and accept and reject the same programs; that equivalence is the stage's release gate, and a package may not ship compiled until it holds.
- **One ABI change is forced, and is the stage's real price.** The zero-cost exports spec's Algorithm G emits a constrained export's generic dictionary edition only when the program's public instance graph contains a qualifying instance; a frozen package cannot see a consumer's instances, so a package shipping compiled must emit the generic edition **unconditionally** for every constrained export, and a consumer's calls into it lose specialization at the boundary — dictionary-passing through FFI Part 9's public evidence surface. The change is additive to the ABI (the base name is reserved for the edition already) and is taken only when the stage is.
- **Plain JavaScript is never a Hexagon package.** A package advertised as compiled Hexagon whose interface is missing or incompatible is refused before checking; `.d.ts` is not a fallback for it (§4.4).

The seed for this stage's specification is the non-normative planning note `spec/notes/package-constraint-interfaces-sol-2026-09.md`, whose identity model, activation rule, and conformance list survive into it; its physical format, file extension, and every syntax are open. Nothing in stage one is chosen to ease or to block the stage, except §4.3's one-copy rule, which the stage would revisit.

---

## 6. Emission under packages

Modules §11 owns emission; packages add the layout. The program's output root holds the **project's** modules by their declared names, dotted segments as directories (`Geometry.js`, `Render/Geometry.js`), and every other package's modules under a directory named by the package (`Acme/Geometry.js`, `Acme/Render/Geometry.js`) — the standard library included, so the prelude's `Option` emits `Hex/Option.js`; a module emitted at the output root imports it as `"./Hex/Option.js"`, one emitted a level down as `"../Hex/Option.js"`, and so on, while one prelude module's import of another is unchanged, both sitting in `Hex/` (FFI Part 1 §8.3 as amended by #829; before #829 the prelude's files were root siblings, and every pinned specifier written from outside `Hex/` moves) — the full name (§2.3) as a path, with the project's package segment elided because a project may have none (§2.5). A dependency's source directory is never written into. Program-scoped artifacts — `hex.d.ts`, `hex.js` (FFI Part 1 §8.3, Part 7 §1.2) — sit at the root, their filename probe reading the emitted filenames (Part 1 §8.3, as respelled by #829). Two packages' same-named modules therefore never collide on disk — and a project module could collide with a package's directory only by beginning with that package's name, which Modules §2.2 refuses for every package in the program — at the header where the project sees the package, at the whole-program check where the package is reached only transitively (a dependency's own `module Acme.Tools` emits under its package, `Bolt/Acme/Tools.js`, and is refused by the same rule whenever `Acme` is in the program) — and the emitted import specifiers — computed from the two modules' names (Modules §11.2) and their package directories (§6) — are relative paths within the root, so the output runs from any location and imports nothing from `node_modules` on Hexagon's account; a package's JavaScript dependencies keep their bare specifiers (FFI Part 4 §2.3) and resolve as npm resolves them, and a relative foreign specifier is copied verbatim too, resolving from the emitted file's place (FFI Part 4 §2.1) — to a file Hexagon never writes and never places. A foreign specifier is where that guarantee ends: a bare one wants npm where the output lands, and a relative one that climbs out of the root wants a file outside the tree that moves.

---

## 7. Diagnostics checklist

| Situation | Error / hint |
|---|---|
| Bare module name two or more visible packages provide | "`Geometry` is provided by `Acme` and `Hex`; write `import Acme.Geometry` or `import Hex.Geometry`" (§3.3) — in `dependencies` order, then `Hex` |
| A dotted import resolving to nothing whose first segment names an installed Hexagon package the resolving package does not list | "`Bolt` is not a dependency of this package; add `"Bolt"` to `dependencies` in `hexagon.json`" — applied edit where the host can write the manifest; where a module of any package in the program, imported or not, is declared under that first segment, the unknown-module report fires instead and no edit is offered (§3.3, §3.4) |
| A package qualifying its own module (`import MyApp.Geometry` inside `MyApp`) | unknown module — hint: "a package's own modules are imported by their declared names: `import Geometry`" (§3.3; §2.5) |
| `dependencies` names a Hexagon package the resolving package's lookup does not find | "no installed package declares `\"name\": \"Bolt\"`; install it, or check the name in its `hexagon.json`" — where the lookup scanned a manifest it could not read, the report carries it: "(`node_modules/@bolt/tools/hexagon.json` could not be read: …)"; *installed* is §4.1's sense, what this package's lookup finds, so a copy under a sibling's nested `node_modules` draws it (§2.1, §4.1) |
| `dependencies` names an npm package with no `hexagon.json` | "`tiny-json` is not a Hexagon package: bind it with `extern from \"tiny-json\"`" (§4.4) |
| A `dependencies` cycle | "dependency cycle: `Acme` → `Bolt` → `Acme`" (§4.1) |
| Two entries of the closure resolve one name to two directories, or, on a walk resolving an entry of the closure, the requested name is declared by two package roots at one level, at two canonical directories — a lookup run only to decide a diagnostic draws none | "package `Acme` is installed twice: `<dir>` (`<version>`) and `<dir>` (`<version>`); a program holds one copy of each Hexagon package" — directories canonical, printed relative to the project; the version where the npm manifest declares one (§4.1, §4.3) |
| An entry of the closure resolves the project's `name` to an installed package at a directory other than the project's own | "this project declares `\"name\": \"Acme\"`, and `Acme` is also installed at `<dir>`; a program holds one package of each name" (§4.3) |
| The project's manifest declares `"name": "Hex"` | "`Hex` is the standard library's package name" — any other manifest declaring it is a candidate for no name and draws nothing (§2.1, §2.4, §4.1) |
| A manifest lists `"Hex"` under `dependencies` | "`Hex` is every package's dependency; remove the entry" (§2.4) |
| The project's manifest carries a `name` that is not one uppercase-start identifier (`"acme"`, `"Acme.Tools"`) | "a package name is one uppercase-start identifier: write `\"Acme\"`" — a dotted spelling names the module-name form as the place for dots; any other manifest carrying one is a candidate for no name and draws nothing (§2.1, §4.1) |
| Two modules of one name in one package | Modules §2.2's report at the second header |
| A dotted module whose first segment names a package the declaring package sees | Modules §2.2's report at the header: "`Acme.Geometry` begins with the name of the package `Acme`; a dotted module's first segment cannot name a package in the program; rename the module" (§6) |
| A dependency's dotted module whose first segment names another package in the program (`Bolt` declares `module Acme.Tools`; the program holds `Acme`) | at the whole-program check: "module `Acme.Tools` of package `Bolt` begins with the name of the package `Acme`, also in this program; drop the dependency that brings `Acme` or the one that brings `Bolt`, or combine them once `Acme` is renamed or `Bolt` renames its module" (Modules §2.2) |
| A dependency's dotted module whose first segment names the project's own `name` (`Bolt` declares `module MyApp.Tools` under a project named `MyApp`) | "module `MyApp.Tools` of package `Bolt` begins with the name of this project, `MyApp`; rename the project or drop its manifest `name`, drop the dependency that brings `Bolt`, or combine them once `Bolt` renames its module" (Modules §2.2) |
| Any whole-program variant naming a package that is not a direct entry of the project, or that several entries reach | the package carries its bringers after the phrase naming it — "of package `Bolt` (brought in by `Carbide`)", "the package `Acme`, also in this program (a direct dependency, and brought in by `Carbide`)", several joined with "and" — and the repairs are worded over the project's own entries, collapsing to one where one entry brings both (Modules §2.2) |
| The project's dotted module whose first segment names a package it reaches only through a dependency | "module `Acme.Parser` of the project begins with the name of the package `Acme`, also in this program (brought in by `Bolt`); rename the module, or drop the dependency that brings `Acme`" (Modules §2.2) |
| Installed package advertised as compiled Hexagon, no source (stage one) | "`Acme` ships no Hexagon source; a Hexagon package is installed as source until compiled distribution exists" (§4.1, §5.2) |

---

## 8. Rejected alternatives (do not re-litigate)

1. **Compiled-first distribution** (a package ships emitted JavaScript plus a generated interface from the start — TypeScript's and OCaml's shape): deferred to stage two, not rejected (§5.2). Taking it first would put an interface format, its equivalence proof, and the unconditional generic edition on the path to the first package; taking source first puts nothing on that path but a manifest.
2. **Transitive visibility** (a dependency's dependencies importable by the project — Node's flat `node_modules` era): refused (§3.1). A module's imports would compile or not according to a dependency's private choices, and the project's manifest would stop describing what the project uses.
3. **Ranked resolution** (nearest package wins; the first-listed dependency wins; the project's dependency order decides): refused (§3.3) — a bare spelling that means one module today and another after `npm install` is the silent re-meaning Modules §5.5 refused for names.
4. **Refusing the resolving package's own module against a package's** (uniform refusal, no occlusion): refused (§3.2) — every addition to the standard library would then break any project that had used the name first, the exact breakage Modules §5.4 exists to make impossible.
5. **Directories as namespaces** (a module's namespace segments read off its directory — Haskell's mirroring, Java's): refused. The name-versus-path drift Modules §9.2 records would return in full; a module's name is what it declares, wherever the file sits (Modules §2.1).
6. **Package name = npm name** (`@acme/geometry` as the namespace): refused (§4.1). npm's names are lowercase, scoped, and punctuated; a namespace segment is an uppercase-start identifier that stands left of a dot in source, and the two roles are served by two names.
7. **A `hexagon.json` field listing the package's modules** (an explicit module manifest): refused (§2.2). The header is the declaration and the tooling discovers files; a second list would be the drift hazard in manifest form.
8. **Dotted package names** (`Acme.Tools` as a package): refused (§2.1). Only one segment is omittable (Modules §2.3), so the package segment must be exactly one; hierarchy lives in module names, where every segment is written.
9. **An index of every installed package** (every `node_modules` a project could reach scanned in full, nested copies included, and the one-copy rule read over the union): refused (§4.1, §4.3). It goes beyond Node's own rule — which resolves a requested name from the asker's place and reads nothing else — and it lets a stray copy in an ancestor directory refuse a program that never resolves to it; it also binds the compiler to one layout, where a lookup from each package's place is a mechanism a host supplies and can replace. The conservative reading of the one-copy rule that wanted the index — a duplicate no closure reaches refused too, on the ground that which closure reaches a copy is learned only after the names are unique — is dissolved by resolving each entry from its own package's directory: the closure assembles outward with no uniqueness needed first.

---

## 9. Acceptance tests

```
-- (a) The visible set and the contest (§3.1, §3.3)
-- project hexagon.json: {"dependencies": ["Acme"]}
-- Acme: module Geometry; module Util           Acme hexagon.json: {"name": "Acme", "dependencies": ["Bolt"]}
-- Bolt: module Util                             Bolt hexagon.json: {"name": "Bolt"}
-- both hoisted to the project's node_modules, so the project's lookup finds Bolt (§4.1)
import Geometry                              -- OK: Acme.Geometry, the one visible provider
import Util                                  -- OK: Acme.Util — Bolt is not visible to the project
import Bolt.Util                             -- ERROR: Bolt is not a dependency of this package;
                                             --   add "Bolt" to dependencies in hexagon.json
                                             --   (a refused import binds no alias — Modules §5.2)
-- Zed under the project's node_modules, listed by nobody; Acme (in the program) declares module Zed.Helper in a file nobody imports:
import Zed.Tools                             -- ERROR: no module Zed.Tools — unknown module, the
                                             --   manifest edit withheld: Acme's Zed.Helper would be
                                             --   refused were Zed in the program (§3.3)
-- inside Acme's module Geometry (Acme sees Acme, the prelude, and Bolt):
import Util                                  -- OK: Acme.Util — Acme's own module wins over
                                             --   Bolt.Util (§3.2), no contest
import Bolt.Util as BoltUtil                 -- OK: Acme lists Bolt; `as` because the default
                                             --   alias Util is bound above (Modules §5.2)

-- (b) Occlusion (§3.2)
-- project: module Vector
import Vector                                -- OK: the project's own; the prelude's Vector is
                                             --   Hex.Vector, reachable
import Hex.Vector as HexVector               -- OK

-- (c) Two packages contest (§3.3)
-- project hexagon.json: {"dependencies": ["Acme", "Chroma"]}; both declare module Color
import Color                                 -- ERROR: Color is provided by Acme and Chroma;
                                             --   write import Acme.Color or import Chroma.Color
import Chroma.Color                          -- OK

-- (d) A package does not qualify itself (§3.3, §2.5)
-- project hexagon.json: {"name": "MyApp"}; module Geometry
import MyApp.Geometry                        -- ERROR: no module MyApp.Geometry; a package's own
                                             --   modules are imported by their declared names:
                                             --   import Geometry

-- (e) Manifest refusals, and the lookup's outcomes (§2.1, §4.1, §4.3, §4.4)
-- the project's manifest: {"name": "Hex"}   -- ERROR: Hex is the standard library's package name
-- the project's manifest: {"name": "acme"}  -- ERROR: a package name is one uppercase-start identifier
-- {"dependencies": ["tiny-json"]}           -- ERROR: tiny-json is not a Hexagon package; bind it
                                             --   with extern from "tiny-json"
-- Bolt at node_modules/@bolt/tools lists Acme; Acme is at node_modules/@acme/geometry (2.1.0)
--   and again at node_modules/@bolt/tools/node_modules/@acme/geometry (1.4.0)
                                             -- ERROR: package Acme is installed twice:
                                             --   node_modules/@acme/geometry (2.1.0) and
                                             --   node_modules/@bolt/tools/node_modules/@acme/geometry (1.4.0);
                                             --   a program holds one copy of each Hexagon package
                                             --   (two entries reach two directories — §4.3)
-- node_modules/acme-a and node_modules/acme-b both declare "name": "Acme"; the project lists Acme
                                             -- ERROR: package Acme is installed twice: node_modules/acme-a
                                             --   (1.0.0) and node_modules/acme-b (1.0.0); … (one level,
                                             --   two roots, the requested name — §4.1)
-- node_modules/acme and node_modules/@acme/geometry are both links to packages/acme
                                             -- OK: one copy, at its canonical directory (§4.3)
-- Acme at node_modules/@acme/geometry, and again in an ancestor's node_modules
                                             -- OK: the nearest answers; the farther is shadowed (§4.1)
-- node_modules/acme-a and node_modules/acme-b both declare "name": "Acme"; nobody lists Acme
                                             -- OK, silent: a scanned manifest is a candidate for the name
                                             --   it declares and nothing more (§4.1); an import Acme.Tools
                                             --   in the project draws the unknown-module report, no edit —
                                             --   the diagnostic lookup refuses nothing (§4.1)
-- an ancestor's node_modules/x/hexagon.json declares "name": "Hex"; nobody lists it
                                             -- OK, silent: the name refusals are the project's manifest's;
                                             --   a scanned manifest is a candidate for the name it declares,
                                             --   and for none at Hex (§2.1, §4.1)
-- an ancestor's node_modules/@junk/x/hexagon.json is not valid JSON; every listed name resolves
                                             -- OK, silent: a manifest the walk cannot read is no
                                             --   candidate and stops nothing (§4.1)
-- the project lists Acme; nothing declares it, and node_modules/@acme/geometry/hexagon.json
--   is not valid JSON
                                             -- ERROR: no installed package declares "name": "Acme";
                                             --   install it, or check the name in its hexagon.json
                                             --   (node_modules/@acme/geometry/hexagon.json could not
                                             --   be read: Unexpected token …)
-- Acme lists Bolt, Bolt lists Acme         -- ERROR: dependency cycle: Acme → Bolt → Acme
-- Acme's manifest lists "Acme"              -- ERROR: dependency cycle: Acme → Acme
                                             --   (its lookup reaches its own directory — §4.1)
-- project {"name": "MyApp", "dependencies": ["MyApp"]}, nothing installed under that name
                                             -- ERROR: no installed package declares "name": "MyApp";
                                             --   install it, or check the name in its hexagon.json
                                             --   (its lookup reaches no directory of that name — §4.1)
-- MyApp lists Bolt; a workspace links the project MyApp into packages/bolt/node_modules; Bolt lists MyApp
                                             -- ERROR: dependency cycle: MyApp → Bolt → MyApp — the entry
                                             --   reaches the project's own directory (§4.1, §4.3)
-- {"name": "Acme"}, with a dependency listing Acme, found at node_modules/@acme/geometry
                                             -- ERROR: this project declares "name": "Acme", and Acme
                                             --   is also installed at node_modules/@acme/geometry;
                                             --   a program holds one package of each name

-- (f) Coherence and the orphan rule across packages (§5.1)
-- Acme: module Shape — export union Shape = …; honor Show<Shape> = …
-- project: module Main — import Shape; honor Show<Shape> = …
                                             -- ERROR at program check: duplicate instance of
                                             --   Show<Shape>: declared in module Shape and in
                                             --   module Main (Main also violates the orphan rule)

-- (g) Emission layout (§6)
-- project: module Main; module Render.Geometry; Acme: module Geometry
-- emits: Main.js, Render/Geometry.js, Acme/Geometry.js, hex.d.ts (when owed) at the root;
--   Main.js imports "./Acme/Geometry.js" — nothing from node_modules on Hexagon's account;
--   Render/Geometry.js imports "../Hex/Option.js" and, where owed, "../hex.js" (path-adjusted: FFI Part 1 §8.3 for the .d.ts, Part 7 §1.2 for the .js)
-- the project also declares module Deep.Nested, with extern from "./world.js", and reaches its runner:
--   Deep/Nested.js imports "./world.js" verbatim — it names Deep/world.js, which Hexagon
--   does not write (FFI Part 4 §2.1); Acme's Deep.Nested would name Acme/Deep/world.js

-- (h) One reading of a dotted spelling; the program-wide first-segment rule (§3.3; Modules §2.2)
-- project depends on Bolt; Bolt (listing no Acme) declares module Acme.Tools
import Acme.Tools                            -- OK: Bolt's module by its declared name — no package
                                             --   Acme is in the program
-- the project adds a dependency Acme (module Tools):
                                             -- ERROR at program check: module Acme.Tools of package
                                             --   Bolt begins with the name of the package Acme, also
                                             --   in this program; drop the dependency that brings Acme
                                             --   or the one that brings Bolt, or combine them once
                                             --   Acme is renamed or Bolt renames its module
-- project depends on Bolt, which depends on Acme (in the program's package set, not visible to the project):
module Acme.Parser                           -- ERROR at program check: module Acme.Parser of the
                                             --   project begins with the name of the package Acme,
                                             --   also in this program (brought in by Bolt); rename
                                             --   the module, or drop the dependency that brings Acme
-- project named MyApp depends on Bolt; Bolt declares module MyApp.Tools:
                                             -- ERROR at program check: module MyApp.Tools of package
                                             --   Bolt begins with the name of this project, MyApp;
                                             --   rename the project or drop its manifest name, drop the
                                             --   dependency that brings Bolt, or combine them once
                                             --   Bolt renames its module

-- (i) The runtime modules are members of Hex like any other (§2.4)
import Hex.Runtime.VectorTrie                -- OK: binds VectorTrie, which exports nothing
export let n: Int = VectorTrie.size          -- ERROR: module VectorTrie does not export size
```

---

## 10. Decisions log

| Decision | Where |
|---|---|
| A package is a named set of modules shipped as source; the manifest is `hexagon.json` (`name`, `dependencies`); `name` is one uppercase-start identifier; `Hex` reserved | §1, §2.1 |
| Modules are discovered beneath the manifest; no module list; full name = `Package.Declared`; a package never spells its own name in source | §2.2–§2.3 |
| A package may mirror dotted names as directories, which the language does not read; the emitted layout is the prescribed one | §2.2, §6 |
| The standard library is the package `Hex`; the prelude is in scope without import; `import Hex.Option as Opt` is a second alias; its source is kept in `stdlib/`, the directory saying what it holds; the runtime modules are `Hex.Runtime.*`, importable and export-less, their privileges keyed by list membership | §2.4 |
| The project is the root package, unnamed unless published, and never qualifies itself | §2.5 |
| Visible set = own modules + prelude + direct dependencies, per package; transitive dependencies invisible to import though present in the program | §3.1 |
| The resolving package's own module wins silently (Modules §5.4 one level up); a contest between packages is refused naming every full spelling (Modules §5.5 one level up); never ranked; a dotted spelling has one reading and a package never qualifies its own modules, resting on Modules §2.2's program-wide first-segment rule | §3.2–§3.3 |
| Distribution rides npm; versions and lockfile are npm's; the npm name is not the Hexagon name; what a package is (a record the compiler validates) is kept apart from how its directory is found (a host's mechanism, npm's layout the first); each package's `dependencies` are looked up from its own canonical directory, nearest `node_modules` first, walking up, a farther copy shadowed for that walk, a package nobody lists entering no program, the lookup for an unlisted first segment deciding one report and refusing nothing; a manifest the walk cannot use is no candidate and stops nothing, §2.1's `name` refusals the project's manifest's alone, a package the lookup answers with checked for its `dependencies` over the package set; the package set is the acyclic closure so assembled, plus the project and `Hex`; a cycle refused by name | §4.1–§4.2 |
| One copy per package name per program, read over the package set alone: two entries reaching two directories, or, on a closure entry's walk, two roots at one level declaring the name sought at two directories, refused; an entry reaching the project's own directory adds an edge and no package; identity is the canonical directory; a copy nothing reaches is refused by nothing; revisable at stage two | §4.3 |
| JavaScript-only packages are the FFI's; never listed as Hexagon dependencies | §4.4 |
| Stage one: whole-program compilation from source across packages; coherence, orphan rule, discoverability, specialization unchanged; costs stated | §5.1 |
| Stage two recorded, not designed: generated interface reproducing whole-program selection, identity-keyed; source/interface equivalence as the gate; the unconditional generic edition as the forced ABI change; the planning note under `spec/notes/` as seed | §5.2 |
| Emission: project modules at the root by declared name, dependencies under their package's directory; Hexagon's own specifiers relative only; foreign specifiers, bare and relative, verbatim, and where the output's relocatability ends; program-scoped artifacts at the root | §6 |
| Nine alternatives rejected with reasons | §8 |
