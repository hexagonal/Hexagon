# Hexagon Spec: Modules

**Status:** Decided (July 2026; the module-identity reversal and the path-free import, September 2026 — #829) — with a **hanging-questions** section (§12); nothing there blocks implementation of §1–§11.
**Scope:** Module identity (a declared name — the `module` header, several modules per file, the `end module` closer), the `import` declaration (one form: the path-free module import, `import Geometry` and `import Geometry as Geo` — #762, #829), the head's visibility slot (`export`, `opaque`, or absent — #590), privacy defaults, the module-alias namespace and position-based resolution (the companion fallbacks in type, constraint, and term position), prelude occlusion, the module-alias collision rule, the acyclic-import rule and load order, top-level effects, instance globality, the orphan rule's operational definition of "home module," instance discoverability (§7.6), the private-in-public rule, generalisation at module level (restated), and ESM/`.d.ts` emission — including the opaque brand face (§11.4, per FFI Part 7 §5).
**Not in scope:** packages — what a package is, its manifest, the namespace a package name supplies, which modules a program can see, and how a package is distributed (`packages.md`, #829; this spec states the resolution of a module *name* in §2.3 and defers the visible set to that spec), re-exports (§12.2), CLI root-selection and project-configuration syntax (compiler architecture; §8.3 fixes the language-level absence of a special entry point), and the prelude's inventory (stdlib listing — one constraint pre-registered here, §6.4).
**Companions:** Packages spec (the visible module set, namespaces, distribution), Constraints spec (§5.1 duplicate reporting point; §5.3 orphan rule; §9.3 structural instances), Statements/Blocks/Mutability spec (§5.2/§10.2 prelude collisions; §6 `var` confinement), Declarations Preamble (§7 declaration inventory; Rewrite Rule §1.1), Unions §2 and Pattern Matching §2.2 (constructor qualification; the pattern-position constructor door, #763), Functions §8 (module-level generalisation), Operators §10 (`.` as module-path separator), Method Syntax §4/§8 (companion dispatch and emitted companion imports), Lexer & Layout (module top level as a block; `module` and `end module` as contextual head words, Lexer §4.2), and FFI Parts 4/7 (extern bindings and export surface).

---

## 1. Doctrine

- **A module is a named declaration; a file is a container** *(#829)*. Every module declares its own name in a header line, `module Geometry`, and a file holds one module or several (§2). A module's identity is that declared name, and the path of the file holding it means nothing to the language: the tooling discovers files; no import or resolution rule ever reads a path, and no diagnostic ever *identifies* a module by one — a file appears only where a reader must find text (the duplicate-module report, §2.2; the labels of §7.3). A project's tools rewrite the project's own text and no other. A rename of a name whose declaring module the project (Packages §2.5) does not hold is refused, the declaring module named by its full name (§10); the printed message says *own*. The standard library's names and a dependency's exports are the ordinary cases, unless the package declaring the name is itself the project; that a dependency's source may be compiled with the program (Packages §5.1) does not make it the project's to rewrite, and a nested package of the same workspace (Packages §2.2) is another package for this rule though its text sits in the same editor. One compilation unit per module, mirroring ESM's one-module-per-file in the emitted output (§11), not in the source.
- **Everything is private unless exported.** `export` is a declaration prefix, JS-style. An unexported binding is invisible outside its module — not "discouraged," invisible: no qualified access, no reflection, no back door.
- **Modules are fences, not forges.** Modules control *name visibility only*. They do not create type identity — that is the declaration site's job (`record`/`union`, Declarations Preamble). A nominal type is the same type through every import path and alias; structural types belong to no module at all. There are no functors, no signatures, no first-class modules (§9.1 records the rejection).
- **A module cannot contain, export, or close over mutable state** — in pure Hexagon. This is not a new rule but the module-level face of three existing ones: `var` is function-body-only (Statements §6.1), there are no ref cells (§6.4), and no lambda captures a `var` (§6.2). The only module-level state is immutable `let` bindings evaluated once at load. `export` exposes values and names, never cells. (An `extern` JS module can of course hide mutation behind a function; that lives at the FFI boundary and is that spec's problem.)
- **Instances are global and unfenced.** `honor` ignores the export system entirely: an instance is visible program-wide the moment its module is in the import graph — never imported, never exported, never hidden (Constraints §5.3). Coherence is checked over the whole graph (§7).
- **Imports are acyclic, hard error.** No import cycles, ever (§8.1). This buys a deterministic topological load order, keeps the emitted ESM out of JS's cycle semantics (temporal dead zones), and matches the F# lineage.
- **Imports bind modules by name; emission is ESM's own (#762, #829).** The *export* surface is JavaScript's own, and one Hexagon module emits as one ESM module with `export` mapping to `export`. The *import* surface is not: an `import` names a module and binds it, and nothing smaller (§3) — no path, no named items, no `as` aliases on items, no form that lifts one export into bare scope (one carve, the pattern namespace — §3) — so every name's origin is visible at its use site, a pattern's excepted, and the module system carries no import-item machinery at all (§9.11 records the rejection and what the absence buys). The one binding form is spelled `import Geometry`, optionally `import Geometry as Geo`, and it is not JavaScript's: JavaScript imports a path, Hexagon imports a name. The v1 head, `import Geo from "./geometry"`, wore JavaScript's default-import shape knowingly and was designed to shrink to this form once modules carried their own names (§9.12, §9.14); the on-ramp survives whole in emission, which remains JavaScript's own forms throughout (§11). The FFI's `extern from` block is untouched by any of this: it *declares* foreign names with their types (FFI Part 4) from a JavaScript specifier, and is no import — which is why foreign names arrive bare and Hexagon names arrive qualified, and why a string specifier appears in the one and never in the other.

---

## 2. Module identity

### 2.1 The header

Every module begins with a **header line** naming it *(#829)*:

```
module Geometry

export record Point = {x: Float, y: Float}
export fun area(r: Float): Float = ...
```

- **The header is a line, not a block opener.** The module's body follows at the file's own margin; nothing indents on the header's account, and the layout rules (Lexer & Layout) are untouched. The module top level is a block exempt from the final-expression rule (Statements §3.1); its items are the module-level declarations (Declarations Preamble §7.1), `let`/`fun` bindings, and `Unit`-typed effect expressions (§8.2).
- **The name is the module's identity.** `Geometry` above is what every importer writes (§3), what every diagnostic names, and what the orphan rule's "home module" means (§7.2). It is uppercase-start, as module aliases are (§3.1), and it may be **dotted** — `module Render.Geometry` — each segment uppercase-start; the dotted name is one name, and its segments are not modules (§2.3). The case is the convention the type and constraint namespaces keep — a module name stands beside `Point` and `Ord` — and it is a rule about case alone, since a module name may be dotted where a type's never is (§5.1). A segment that is not uppercase-start is refused at two seats, each with the same sentence and its own rewrite (§10): the import head, where §3.1 states the rewrite, and the header, below.
- **A miscased header is refused, and the reading recovers as the rewrite spells it.** At the head of a top-level item, `module geometry` is no header by the contextual-word rule above, and no lawful item either, since Hexagon has no juxtaposition; the seat is claimed for the refusal. The line is a parse error under the Rewrite Rule: "a module name is uppercase-start; write `module Geometry`" — each dot-separated segment upper-cased at its start, the dots kept, the slot `module <Name>` where upper-casing yields no lawful module name, every segment having to be uppercase-start (`module 用户`, `module _internal.util`). No header as written, then; the header the reading **recovers**. The rest of the program is read under the name the rewrite spells, `Geometry` — or, where upper-casing yields no lawful module name, under the written spelling, since there is no other and §2.2's reports are better keyed to the name on the page than to the slot. That is ordinary error recovery, of the kind Effects §9 takes for the type arrow: refused text read as its own rewrite. It is not of the corpus's other two kinds: where a refused word has a neutral value the recovery takes it (§4.2's private, §5.2's unbound alias — a refused word claims nothing), and where a recovery would only cascade it is marked and its downstream reports suppressed (Effects §4.4). A header has no neutral name, and every report the recovered header draws carries its own repair, so here the recovered name is a **declaration** for every rule that reads one — §2.2's rules over the declared name, all of them, and §2.3's resolution — and nothing downstream is suppressed. The reach is the whole reading. A refused line refuses the *program* — it is rejected fully, and no build product is owed (Declarations Preamble §1.1) — but not the reading of it, which the compiler carries on for the language server's sake; every later stage therefore reads the recovered name as it would the rewritten one: §2.2's and §2.3's name checks, §7's coherence reports ("declared in module `Geometry`"), §11's emitted filename. Whether a host writes anything from a refused program is the host's own affair. So: no headerless report follows, since the file has its header. A closer is judged against `Geometry`, and `end module geometry` draws §2.2's closer-naming error, whose rewrite reaches legal code by itself. A later header met while `Geometry` is open draws §2.2's second-header report at its own line, and a header that is itself both miscased and second draws both reports at one line, two applied edits that compose. Where the recovered name itself breaks a rule of §2.2's, that report stands beside the casing one and the casing rewrite is one repair of two: in a package that also declares `module Geometry`, the duplicate report names both files; and `module hex.util` recovers as `Hex.Util`, which the first-segment rule refuses at the same header, naming the very spelling the casing report told the author to write and its own repair, a rename — two reports, and the rename is the one that reaches legal code. An importer reads the recovered name as any declared name (§2.3): `import Geometry` resolves to it and draws nothing of its own, or is contested where another visible package declares `Geometry` too, as it would be. At the slot the reach is shorter by a seat: the written spelling is a declaration for the file's and the package's own checks and reaches no importer, since no import head can spell it (§3.1), and §2.2's duplicate report prints "rename the module" in place of its dotted hint there, no lawful dotted name being spellable — a rename is lawful and local, and it is the repair; a dotted slot name whose first segment names a package (`module Hex._internal`) draws the first-segment report beside the casing one, its rename the repair as at `hex.util`. The refused import head, by contrast, binds no alias (§5.2), the neutral value it has. The closer is never a casing seat — its name takes §2.2's rule alone — and below the top level the seat is not claimed either: §2.2's redirect exists for a header the block cannot hold, and a line that is no header even at the top level gets no tailoring, so `module geometry` in a block is the ordinary parse error.
- **Every file declares a module.** A file with no header is refused with an applied fixit inserting one: the name derived from the file's basename, its `.hex` extension dropped — each `-`, `_`, or `.`-separated segment upper-cased at its start and joined (`geometry.hex` → `module Geometry`, `search-params.hex` → `module SearchParams`); where the derivation yields no uppercase-start identifier, the fixit offers the slot, `module <Name>`. The derivation serves the fixit only: the compiler never reads the name off the path, so nothing can drift (§9.2).
- **`module` and `end` are contextual head words**, not keywords (Lexer §4.2): `module` followed by an uppercase-start name at the head of a top-level item is the header, and `end module` there is the closer (§2.2). Hexagon has no juxtaposition, so neither spelling is a term at that seat; elsewhere both remain ordinary names — `let module = 3` binds, and `SliceError(start, end)` keeps its parameter.

### 2.2 Several modules in one file

A file may hold several modules, each with its own header, and a module is closed by `end module Name`:

```
module Geometry

export record Point = {x: Float, y: Float}

end module Geometry

module Shapes

import Geometry
export fun unit(): Geometry.Point = Geometry.Point({x = 0.0, y = 0.0})

end module Shapes
```

- **The closer is required exactly where there is something to separate.** In a file holding several modules, every module but the last is closed before the next header, and the last may be. In a file holding one module the closer is optional: the module runs to the end of the file. A second header met with the module before it still open is an error at that header — "a file holding several modules closes each with `end module Geometry`" — with the applied fixit inserting the closer above the new header.
- **The closer names the module it closes.** `end module Shapes` under a `module Geometry` header is an error at the closing name, naming both. Anything after a closer that is not a header is an error: code outside a module. So is anything **above the first header**: every module begins with its header (§2.1), and an item before it belongs to none — the same error, its fixit the header moved above the item.
- **Modules sharing a file are strangers.** A module sees exactly what it imports (§3), wherever its neighbours sit: `Shapes` above imports `Geometry` although the two share a file, and would be refused without the line. File grouping is physical, and it means nothing to scope or to load order (§8.2) — moving a module between files changes what compiles in no way at all, which is the path-meaning §2.1 removes kept out of a side door (§9.15).
- **Two modules of one name in one package** are an error at the second header, naming both files: "module `Geometry` is declared twice: `render.hex` (line N) and `physics.hex` (line M)". The repair is a dotted name on one or both (`module Render.Geometry`), which makes them two modules (§2.3). Module names are compared case-insensitively for this rule alone, on the emitted filesystem's account (§11.1): `Json` and `JSON` in one package draw the same report.
- **A dotted module's first segment never names a package in the program.** A package is **in the program** when it is the project, or `Hex`, or lies in the transitive `dependencies` closure the resolver assembles from the manifests (Packages §3.1, §4.1) — a fact of the package set, fixed before any import is resolved and independent of which modules the imports reach. `module Acme.Geometry` is refused wherever a package `Acme` is in the program that compiles it — the declaring package's own name included, and `Hex` always. Two seats report it, one rule: where the declaring package *sees* the package (a listed dependency, `Hex`, or itself — Packages §3.1), the refusal is at the header, "`Acme.Geometry` begins with the name of the package `Acme`; a dotted module's first segment cannot name a package in the program; rename the module"; where it does not — a dependency `Bolt` that lists no `Acme` declares `module Acme.Tools`, and a program brings both `Bolt` and `Acme` together — the refusal is the whole-program check's, attributed to the program as §7.3's duplicate instance is — though read over the package set's every module, not §7.3's import graph (below) — and naming all three: "module `Acme.Tools` of package `Bolt` begins with the name of the package `Acme`, also in this program; drop the dependency that brings `Acme` or the one that brings `Bolt`, or combine them once `Acme` is renamed or `Bolt` renames its module" — loud at the combination, never a silent re-meaning of any import. Where the offending module is the **project's** and the package is one the project does not see — reached only through a dependency — the message reads "module `Acme.Parser` of the project begins with the name of the package `Acme`, also in this program (brought in by `Bolt`); rename the module, or drop the dependency that brings `Acme`", since an unnamed project has no package name to print and renaming a package is not among its repairs. The parenthetical names the project's **own** `dependencies` entry through which the package is reached — however long the chain — and every such entry where several reach it ("brought in by `Bolt` and `Carbide`"), the repair clause then reading "drop the dependencies that bring `Acme`"; it never names an intermediate package the project cannot act on. The same device serves every whole-program variant, with one placement: a package named in the report that is not itself an entry of the project's `dependencies` carries its bringer in a parenthetical **after the phrase that names it** — "of package `Bolt` (brought in by `Carbide`)", "the package `Acme`, also in this program (brought in by `Carbide`)" — the plural forms above serving every variant alike; every repair is worded over the project's own entries ("drop the dependency that brings `Acme`"), which at a direct entry is the package itself; a package reached by **several** of the project's entries always carries every bringer, the direct entry named as itself — "the package `Acme`, also in this program (a direct dependency, and brought in by `Carbide`)" — with the plural repair, since dropping one entry would leave the package in the program; and where one entry brings both packages named, the two repairs collapse into one — "drop the dependency that brings both `Acme` and `Bolt`" — and the "combine them" clause is dropped, since the project never combined them and cannot separate them. The mirror case — a dependency's module beginning with the **project's** own `name`, `Bolt` declaring `module MyApp.Tools` under a project named `MyApp`, which `Bolt` cannot see — takes the third form, since the project being compiled cannot be dropped: "module `MyApp.Tools` of package `Bolt` begins with the name of this project, `MyApp`; rename the project or drop its manifest `name`, drop the dependency that brings `Bolt`, or combine them once `Bolt` renames its module". The whole-program seat ranges over **every module of every package in the program, imported or not** (Packages §2.2's membership), so that adding an import can never newly refuse a program — the cost, stated: a dependency's file nobody imports can refuse a build, which is the price of a rule about names rather than about reachability. An **undotted** module is untouched: `module Json` beside a dependency `Json` is the companion idiom's plainest spelling, `import Json` resolves to the declaring package's own by §2.3, no spelling of the package's could ever be `Json` alone, and on disk `Json.js` sits beside the directory `Json/` (§11.1). What the rule buys is that a dotted spelling has **one reading** (§2.3): a written `Acme.Tools` is the package `Acme`'s module `Tools` wherever `Acme` is in the program, and a declared name otherwise, and no program holds both; the emitted layout (Packages §6) and the exception brand (Exceptions §7.1) rest on the same uniqueness.
- **A header or closer below the top level is refused.** `module` and `end module` are head words of a *top-level* item (§2.1): inside a function body or any nested block, `module Geometry` or `end module Geometry` draws "`module` and `end module` mark a module at a file's top level; a module cannot be declared or closed inside a block" (Declarations Preamble §7.1's family), and nesting one module in another is the second-header error above, since the first is still open.

### 2.3 Names, and what an importer may omit

A module's **full name** is its package's name, a dot, and its declared name: `Acme.Render.Geometry` for `module Render.Geometry` in the package `Acme`; the standard library is the package `Hex`, so the prelude's `Option` is `Hex.Option`. What a package is, what names a program can see, and how the set is assembled are the Packages spec's (Packages §2–§3); this section states only what an importer writes.

- **Only the package segment is ever omittable.** `import Geometry` resolves among the visible modules whose declared name is exactly `Geometry` — the resolving package's own, `Hex.Geometry`, `Acme.Geometry` — and never reaches `Render.Geometry`, whose declared name is longer; that module is imported as `import Render.Geometry`. No suffix of a name is ever searched, and no segment but the package's is ever supplied by the compiler.
- **The resolving package's own module wins.** Where the package resolving the import — the project, or a dependency resolving one of its own imports — declares a module of the written name, the import resolves to it, silently, and a same-named module of a visible package stays reachable by its full name (`import Hex.Geometry`) — the §5.4 occlusion rule one level up, and for the same reason: a module added to the standard library or to a dependency cannot break a program that already has one (Packages §3.2).
- **Between packages, a contested name is refused, never ranked.** Where the resolving package has no module of the written name and two visible packages provide one, the import is an error naming every full spelling: "`Geometry` is provided by `Acme` and `Hex`; write `import Acme.Geometry` or `import Hex.Geometry`" — §5.5's collided-name rule one level up (Packages §3.3).
- **A written dotted name has one reading.** Where the first segment of `import Acme.Tools` names a package **visible** to the resolving package other than itself (Packages §3.1), the import names that package's module `Tools` — its full name — and nothing else; otherwise it names a visible module whose *declared* name is `Acme.Tools`. Two refusals stand where neither answers: a first segment naming the resolving package itself is the next bullet's; and a spelling that resolves to nothing whose first segment names an **installed** Hexagon package the resolving package does not list draws Packages §7's not-a-dependency report ("`Acme` is not a dependency of this package; add `"Acme"` to `dependencies` in `hexagon.json`") rather than the unknown-module one, since the reader's repair is the manifest — **provided no module of any package in the program — the package set's every module, imported or not, the set §2.2's rule reads — has a declared name whose first segment is that package's name**. For a package in the program but unseen, §2.2 guarantees the proviso; for one installed and in no closure it must be checked, because an installed package outside the program's set is no package in the program and a declared name beginning with its name stays lawful. Where such a module exists the unknown-module report fires instead — its near misses naming the module where the resolving package can see it, the spelling most likely a miss on it — and the manifest edit is withheld in every case, because applying it would refuse that module, at its header or at the whole-program check per §2.2's two seats. The two readings never overlap, because §2.2 forbids any module in the program a dotted name beginning with a package in the program: where `Acme` is in the program no module is declared `Acme.Tools`, and where a module is so declared, no package `Acme` is in the program. The reading is fixed by the written spelling and the package set, never by inspecting candidates.
- **A package never qualifies its own modules by its own name.** `import MyApp.Geometry` inside the package `MyApp` is the unknown-module error, not a synonym for `import Geometry`: the full-name reading excludes the resolving package, and no module in the program is declared `MyApp.Geometry` while `MyApp` is a package in it (§2.2), so nothing answers. The hint names the plain form: "a package's own modules are imported by their declared names: `import Geometry`" (Packages §3.3).
- **A name no visible module bears** is the unknown-module error, naming the near misses the visible set holds — the dotted modules whose declared name ends in the written one included, since that is the miss this rule invites ("no module `Geometry`; did you mean `Render.Geometry` or `Physics.Geometry`?").
- **Nominal identity is declaration-site identity.** `Point` declared in module `Geometry` is one type constructor everywhere it flows, under any alias. Two modules each declaring `record Point` produce two unrelated types; the Declarations Preamble §7.3 duplicate rule remains per-module. Structural records and tuples are the same type in every module, need no export, cannot be hidden, and their instances remain exclusively compiler-derived: "which module owns `{x: Float}`" has no answer because structural types have no home module, and nothing needs one (Constraints §9.3).

---

## 3. `import`

```
import Geometry
import Geometry as Geo
import Acme.Geometry as AcmeGeo
```

An `import` names a **module** and binds it, and nothing smaller *(#762, #829)*. Every line above is the one form: a **module import**, whose alias gives qualified access to every export (§3.1). The head is `import`, the module's name (§2.3 says which spellings resolve), and optionally `as` and an alias. There is no path: no string, no `from` (§9.14). There is no named import: no `import { area }`, no `as` alias on an item, no form that lifts one export into the importer's bare scope — with one carve, stated where it lives: a module's **pattern namespace** holds the patterns every imported module exports, so `(n, d)rat` is bare under `import Rat` (Pattern Declarations §3.3). A pattern name is non-uppercase-start, lives in a namespace nothing else shares, and stands at one seat, the suffix, where nothing else can stand; own occludes and a contested name is refused at the use, §5.4 and §5.5 one level down. No term, type, constructor, or constraint member is ever lifted, and §9.11's reasons hold for every one of them. And there is no effect import: a module is imported for its names, never loaded for its effects (§3.3). A module's exports are reached through the alias, and a name that is wanted bare in the importer is bound by an ordinary declaration (§3.2). Every name's origin is therefore visible at its use site — a suffixed pattern's excepted, whose origin is one of the module's import lines, the type it matches naming which — and the module system carries no import-item machinery — no per-name collisions, no alias start classes, no question of which namespaces an item spans (§9.11 records the rejection and what it buys).

Imports are module-level declarations; an `import` inside a function body joins the Declarations Preamble §7.1 error family. Placement within the module is grammatically free, and the formatter will float imports to the top — but no import exemption from the reading laws exists: a module alias is a binding in the module-alias namespace (§5.1), **order-insensitive** in type and constraint position and in a pattern, and read **top-down** in term position (Functions §7.2) — with one carve at one seat: the patterns an import contributes to the pattern namespace are read **module-wide at the suffix seat, in a pattern and in an expression alike** (Pattern Declarations §3.3), the alias's own reading untouched — `Geo.area(r)` above the import that binds `Geo` is the declared-later error with the import-shaped fixit, "move the import above this use", exactly as a use of any term binding above its declaration.

### 3.1 The module import

`import Geometry` binds the single name `Geometry` as a **module alias** giving qualified access to every export: `Geometry.area(...)`, and in type position `Geometry.Point`, `xs: Vector(Geometry.Shape)`. Constructors qualify the same way (`Geometry.Circle(1.0)`), including in patterns (`match s` / `Geometry.Circle(r) => ...`) (Unions §2). Constraints too: `Geometry.Ord` in a binder (`<a: Geometry.Ord>`) and in an `honor` head (`honor Geometry.Describe<Box>` — Constraints §4.1), and a member through the alias as an ordinary term (`Geometry.compare(a, b)`) — the left side is the module alias in every case, so §5.1's "types and constraints never take `.`" is untouched: it governs what may stand *left* of the dot. Two reaches extend the alias without adding a binding, both §5.1's companion fallbacks: where the aliased module exports a type or a constraint spelled like the alias itself, the bare reference in that namespace's own position may resolve through it (rule 2), and where it exports a **constructor** spelled like the alias, the bare constructor in term position — an expression or a pattern — may resolve through it (rule 3, #763). Each answers only where the namespace has nothing.

**The alias.** Without `as`, the alias is the module's declared name's **last segment**: `import Geometry` binds `Geometry`, and `import Render.Geometry` binds `Geometry` too — the segments before it are the name's, not the importer's, and never bind (§2.3). With `as`, the alias is the written name: `import Geometry as Geo`, `import Render.Geometry as RenderGeo`. An alias is uppercase-start, mandatorily — a module's name is uppercase-start by the header rule (§2.1), so the default always qualifies, and `import Geometry as geo` is refused with the alias's rule named. The module name in the head is uppercase-start in every segment, by the same rule (§2.1). `import geometry` is a parse error at the head, before any resolution, under the Rewrite Rule: "a module name is uppercase-start; write `import Geometry`". The rewrite upper-cases each dot-separated segment at its start and keeps the dots (`import render.geometry` → `import Render.Geometry`); it keeps the alias the author wrote (`import geometry as Geo` → `import Geometry as Geo`); and where upper-casing yields no lawful module name, every segment having to be uppercase-start (`import 用户`, `import _x`, `import _internal.util`), it names the slot, `import <Name>`, the written alias kept after it (`import <Name> as Geo`). The refused head binds no alias (§5.2's neutral value), so uses below it draw their own reports as under any unbound alias. A head that trips both rules, `import geometry as geo`, draws one report and one rewrite correcting both seats: "a module name is uppercase-start; write `import Geometry as Geo`" (and `import 用户 as geo`, `import <Name> as Geo`). Two imports landing on one alias spelling — `import Render.Geometry` beside `import Physics.Geometry` — are §5.2's one collision, and `as` is its fixit.

**The head's grammar, and what is refused at it.** Three heads a JavaScript author's muscle memory produces, and one Hexagon itself wrote until #829, are refused with a rewrite under the Rewrite Rule (Declarations Preamble §1.1), each a parse error naming the module form. The path form `import Geo from "./geometry"` — v1's own head (§9.14) — draws "Hexagon imports name modules: write `import Geometry as Geo`", the module name derived from the specifier's basename as §2.1's header fixit derives it (`geometry` → `Geometry`, `search-params` → `SearchParams`) and the written alias kept where it differs from that name, dropped where it does not (`import Geometry from "./geometry"` → `import Geometry`); where the derivation yields no uppercase-start identifier, the message names the slot, `import <Name> as Geo`. The named list `import { area } from "./geometry"` draws the same sentence ending "…and reach `area` as `Geometry.area`" — its first listed item named. The namespace glob `import * as Geo from "./geometry"` draws the rewrite with the alias it wrote and no item clause. The head `import module Geo from "./geometry"` (#565's spelling) is refused the same way, its rewrite dropping the word and the path both. A targeted redirect at the exact place the habit fires, and the only positions the `*` and `{` glyphs ever stood outside an operand seat (Comments §3.1's adjacency argument simplifies accordingly).

**Module aliases are not values.** `let m = Geometry` is an error: "modules are not values." No passing, no returning, no storing. This is what keeps the namespace story (§5) honest and forecloses first-class modules by construction. A declared pattern is not a value either, and needs no sentence: it is not a term at all (Pattern Declarations §3.3).

**Two aliases onto one module** (`import Geometry` and `import Geometry as Geo` in one module) are legal and name one module; nothing is duplicated, and §5.2's one collision rule concerns two aliases of one *spelling*. An import of a prelude module is legal for the same reason — `import Hex.Option as Opt` binds a second alias onto a module already in scope under its own name (§5.5) — and binds nothing new but the alias and, the prelude seeding no pattern namespace, the module's exported patterns (Pattern Declarations §3.3).

### 3.2 What stands where the named import stood

A name that is wanted bare in the importer is bound by an ordinary declaration, which then obeys every rule an ordinary declaration obeys — occlusion (§5.4), the reading laws, export:

| Want | Spelling | What it is |
|---|---|---|
| a function or value bare | `let area = Geo.area` | a module-level binding; generalises as any binding (§6.1), so a polymorphic export stays polymorphic |
| a type bare, under the alias's own name | `import Point` | §5.1 rule 2's companion fallback — the companion idiom (§5.3), no second line |
| a type bare, under another name | `type Point = Geo.Point` | a transparent alias (§6.2): the same type, one spelling |
| a nominal record's constructor bare | `import Point` | §5.1 rule 3's companion fallback: `Point({x = 1.0, y = 2.0})`, and `Point({x, y})` in a pattern, through the alias |
| a union constructor bare, under the alias's own name | `import Tag` | §5.1 rule 3's companion fallback: `Tag(7)`, expression and pattern alike |
| a union's constructors bare in a `match` | write them bare | Pattern Matching §2.2: a bare constructor pattern resolves in the scrutinee's type where scope has nothing (#763); `Direction.North` fixes the type where the door needs it |
| a constraint | `<a: Geo.Ord>`, `honor Geo.Describe<Box>` | Constraints §4.1's qualified head; the members are `Geo.compare(a, b)` or the dot |
| a declared pattern bare | `import Rat` | the pattern namespace is filled by imports (Pattern Declarations §3.3): `(n, d)rat` in a pattern and `(6, 10)rat` in an expression, no second line. `pattern rgb = Color.rgb` renames — a contest's repair (Pattern Declarations §3.4). Never `let rat = Rat.rat`: a pattern is not a term |

Nothing else exists: no form imports a constraint's members severally or together (the presumption §12.4 once recorded is now the design), and no form binds a union constructor bare in an expression — `Direction.North` there, the OCaml and Rust idiom, save where rule 3's fallback answers a constructor spelled like its alias (#763 declined the expression-side door for v1: an expected type is present at some seats and absent at others, and a constructor that resolves at one `let` and not the next is a resolution the language refuses to ship).

### 3.3 No effect import

**A Hexagon module is imported for its names, never loaded for its effects.** There is no `import "./telemetry"` *(#762)* — no string ever follows `import` (§3.1). A pure Hexagon module cannot hold mutable state (§1), so it cannot be a registration point: what a top-level effect can do is print, or call foreign code that mutates, and the idiom for that is an exported function the importer calls — `Telemetry.init()` — which puts the effect where the reader can see it ordered. Top-level effects themselves stay legal (§8.2) and run when the module is loaded for its names, or when it is the root (§8.3): a module that exists to be *loaded* is a root module, not an import. Instances need no loading form either — naming `C<T>` brings both legal homes into the graph (§7.6). The refusal names the form the author was reaching for: "Hexagon has no effect import; a module is imported for its names — `import Telemetry` — or run as a root". An alias the module never uses is lawful, and the module loads as any import's does (§11.3): what is gone is the spelling that binds nothing, not the load.

The JavaScript side keeps its own form, `extern import "telemetry/register"` (FFI Part 4 §8): it loads a foreign module for its effects and introduces no Hexagon bindings — polyfills and registrations live there, and that is the form genuinely needed. The `extern` keyword keeps the foreign and Hexagon module graphs visibly distinct.

---

## 4. `export` and `opaque`

A module-level declaration head has **one visibility slot, with three values** *(#590)*: **absent** — everything the declaration introduces stays private; **`export`** — everything it introduces crosses (§4.1); **`opaque`** — the type name alone crosses (§4.2). The three are mutually exclusive spellings of one home-declared property, which is the syntax following the semantics §4.2 already states: the declaration is the sole authority on representation visibility, and `opaque` is that property's one written word. In particular the pair `export opaque` is refused with a required rewrite (§4.2, §10): opacity of a private thing is vacuous, so `opaque` alone already claims the crossing — the second word could never assert anything the first did not.

### 4.1 `export`

`export` prefixes a module-level declaration — and, since #700, also marks a member of a module-level `fun` block at the member's left margin (Functions §7.3) — exporting **everything that declaration or member introduces**:

| Declaration | Exports |
|---|---|
| `export let x = ...` / `export fun f(...) = ...` | the term |
| `export` at a member's left margin inside a module-level `fun` block (Functions §7.3) | that member — the one export seat below a declaration head *(#700)*; the block head itself takes no `export` (parse error, per-member advice), and an inner block's members take none (the function-local refusal above applies) |
| `export record Point = {...}` | `Point` the type **and** `Point` the constructor (the name-carried surface: construction, constructor patterns). Field access, update, and the bare copy are type-directed — they travel with the type, not the import (§4.2) |
| `export union Shape = Circle(...) \| ...` | `Shape` the type **and** every constructor |
| `export type UserName = String` | the alias name |
| `export pattern rat(top: BigInt, bottom: BigInt): Rat` … | the pattern — its matching direction and, where declared, its building direction (Pattern Declarations §2.3); the head is written in full (§4.1.1) |
| `export pattern rgb = Color.rgb` | **hard error** — an alias is a re-export, deferred (§12.2; Pattern Declarations §3.4) |
| `export constraint Ord<a: Eq> = ...` | the constraint name **and** its members |
| `export exception ParseError(...)` | the exception constructor |
| `export honor ...` | **hard error** — "instances are always visible; `export` does not apply" (§7) |
| `export import ...` | **hard error** — re-exports deferred (§12.2) |

**`export` is module-level only.** On anything below module level — a binding inside a function body, a member of an inner block's `fun` — it is a parse error: "`export` marks module-level declarations; a local binding cannot be exported" (§10).

There are **no default exports**. `export default` is a parse error ("Hexagon has named exports only"). Inside `extern from`, `export default fun`/`let` instead means “bind an incoming JavaScript default export, then expose it as an ordinary named Hexagon export”; it never creates a Hexagon default export (FFI Part 4 §6). Rejected with reasons §9.5.

#### 4.1.1 Exported term signatures are complete

Every exported term has a complete source signature. An exported value binding
writes its type annotation. An exported function annotates every parameter and
its result. If the function is constrained, it also writes every independent
constraint in explicit type-parameter binders.

Constraint lists are maximal under base-constraint entailment: they name the
strongest required constraints and do not restate their transitive bases. Thus a
function requiring `Hash` writes `<a: Hash>`, not `<a: (Eq, Hash)>`, because
`Hash` already provides `Eq`. The compiler rejects missing value, parameter, or
result annotations, inferred-but-unwritten public constraints, and redundant
base constraints.

"Every independent constraint" quantifies over constraints, not type variables.
An unconstrained type variable requires no binder: `export let id(x: a): a = x`
is a complete exported signature as written. A bare `<a>` binder remains legal
(Constraints §1) but is inert and not canonical; Functions §4.2.1 gives the full
decision procedure.

*(#834.)* **An exported `pattern` writes its head** — every component's type, the subject, and the binders its members need (Pattern Declarations §2.1, §2.3): a pattern is no term, and this rule reaches it by the same reasoning, that nothing an importer relies on is inferred across the boundary; an exported pattern with no head is refused, the head as its fixit — "an exported pattern writes its head: `pattern rat(top: BigInt, bottom: BigInt): Rat`", the slots filled from the inferred faces where inference succeeded — the types the faces carry, and the names the delegate's parameters carry where `build` is a delegation line, `c1 … cn` otherwise, since a face has types and no names (Pattern Declarations §2.1).

*(#700.)* **An exported member of a `fun` block writes its binders on the block
head.** The head's list (`fun<a: Eq>`, Functions §7.3) is the written constraint
list of every exported member that mentions the variable — maximal under
entailment, as above — and the member line itself takes no binder (Functions
§7.3). The member still annotates every parameter and its result, as any
exported function does. This is what makes an exported constrained knot
spellable directly: the head is one binder shared by placement, where two
per-member heads could never be one variable (Functions §7.4). The head's
list is published whole: a member that mentions the variable exports under
every constraint the head writes, even where its own body demands fewer —
Functions §4.2's deliberate-restriction reading; a member wanting a narrower
face of its own spells it through a non-recursive wrapper. The
completeness advice follows the spelling: when the incomplete-signature
function is a member of a recursive knot, the advice names the block-head
form — "declare the constraint on the block head: `fun<a: Eq>`" — never a
per-member binder the knot would refuse.

*(#715, #716.)* **The completeness advice spells each required constraint by
its own declaration** — Constraints §5.1.1's advised-spelling law, applied at
this rule's advice. The advised binder lists the entailment-maximal required
set, decided between the declarations themselves before any spelling is chosen
(a same-spelled shadow's bases absorb nothing — Constraints §5.1.1), and never
prints one word for two declarations: each constraint takes the spelling that
resolves here to the declaration required — bare, through an in-scope alias,
or, where the module has no spelling for it, the module-route repair with the
route clause appended (the law's tiers, Constraints §5.1.1). A local
declaration shadowing an imported scheme's same-spelled constraint therefore
routes the import rather than dropping a binder or advising the shadow —
"write `<a: (Ord, Lib.Heft)>` — `Heft` is declared in module `Lib`, and this
module binds another `Heft`; `import Lib` and spell it
`Lib.Heft`" — the clause rendering the pastable import, Pattern Matching
§7.3's own convention — and of two
distinct imported constraints sharing a spelling,
each without a resolving spelling here takes the module route, one clause per
declaring module, never the singular word that can declare at most one of
them; one the module can already spell keeps its word (the contested-group
rule, Constraints §5.1.1). A same-named pair's relative order in the advised
conjunction is the implementation's own — unspecified but stable, FFI Part 9
§6.2.1's terms — and once written it is the declared conjunction's order,
fixing slots and suffix (Constraints §6.1, §6.2). The advised signature is one
this section accepts as written — same-spelled conjunctions are declarable
through the routes above. One tier lies past the routes, the law's fourth: a
required constraint that is **not exported** — the §4.3 sealing gate — has no
spelling and no route, and the advice offers no binder at all; the report
names the gate and the real exits — "exported function `g` requires the
constraint `Gate`, declared in module `Lib` and not exported; a complete
signature cannot be written here — use the constrained operation at a
concrete type, keep `g` private, or export `Gate` from `Lib`" — §7.6's
unnameable branch. A generic export over
a gate is refused by the seal's design: that unreachability is what sealing
means. Where the advice names a module-import repair, it
joins §10's applied-edit repair family *(#577, #829)*: the clause already
names the one module, and a module import is complete without a path, so the
compiler tier itself carries the insert — no workspace search, and no
exporter count to suppress it.

This rule applies only to exports. The boundary-first convention for private
module-level functions remains a style rule: annotate parameters, infer the
result and constraints. Local functions and lambdas remain inference-friendly.

*(#355.)* The export's **own effect colour is outside this rule's remit**: a
declaration header has no outer-arrow seat, so the outer colour is inferred
from the body for exports and private bindings alike (Functions §4.1; Effects
§2). What the completeness rule already covers keeps covering it — a
function-typed parameter's written annotation carries its arrow, and that
arrow is part of the signature (`transform: a ->? b` links, `step: a -> b`
demands). Tooling renders the inferred face (Effects §10's display
obligation); the face itself is checked against the body in both directions
(Effects §4.2).

### 4.2 `opaque`

```
opaque record Point = {x: Float, y: Float}
opaque union Handle = FileHandle(fd: Int) | NetHandle(sock: Int)
```

`opaque` exports the **type name only**. Everything the body introduces stays private to the home module:

- **Records:** the constructor is private (no construction outside), and — load-bearing — **fields are private too**: no `p.x`, no pattern destructuring save through a pattern the home exports (Pattern Declarations), no `{p with x = e}` update outside the home module. An opaque record without field privacy would be fake abstraction; outside its home module an opaque record is a black box with the doors its home chose to publish.
- **Unions:** all constructors private — no construction, no constructor pattern outside; a declared pattern the home exports is the one way to match one abroad (Pattern Declarations). Exhaustiveness is checked against the declaration in the home, and abroad against the exported patterns the arms write (Pattern Declarations §4), a constructor never entering a column there.
- Inside the home module, `opaque` changes nothing: full construction, matching, field access. The home module exports smart constructors and accessors as ordinary functions — this is the intended idiom, and the companion-module pattern (§5.3) is its natural shape. **Destructuring abroad is the exported pattern's** (Pattern Declarations): `export pattern rat(top: BigInt, bottom: BigInt): Rat` publishes a view of the type without publishing its fields, and `(n, d)rat` then matches a `Rat` anywhere — bare, through the importer's pattern namespace or the expected type's door. Opacity hides structure; a pattern is a capability, and it crosses. Where a home exports patterns over an opaque type, the destructure refusal names them (Pattern Declarations §3.3).
- Derived instances are unaffected: `opaque record Point derives (Eq, Show) = ...` works — derivation happens in the home module, where nothing is hidden, and the resulting instances are global like all instances (§7). This is deliberate: opacity hides *structure*, not *capabilities*.
- `opaque` is legal **only on `record` and `union`**, and it fills the head's visibility slot by itself *(#590)*. `export opaque` — the pre-#590 spelling — is a parse error under the Rewrite Rule (Declarations Preamble §1.1): "`opaque` already exports the type name; write `opaque record Point = …`" — the rewrite is mechanical and required, the `widens` respell pattern (Constraints §4.7's refused-export fixit). On `type`: error — aliases are transparent by definition; "make it a `record` or single-constructor `union`" (the Declarations Preamble §4 redirect family). On `let`/`fun`/`constraint`/`exception`/`pattern`: parse error. The subject redirects outrank the pair refusal: `export opaque` before an unlawful subject draws the subject's redirect, never the pair rewrite — the rewrite's output would still be ill-formed, and the deeper fault leads. A redirected bare head claims no crossing: the declaration recovers as private, the slot's neutral value — a refused word claims nothing.

**Transparent representations travel with the type** *(#587)*. The complement of the rule above, and it takes no syntax: outside `opaque`, the declaration is the **sole authority** on representation visibility, and a record's fields are open **wherever the type reaches**. Type-directed access — `p.x`, `{p with x = e}`, the bare copy `{...p}` — asks only what the receiver's type is, and a type reaches modules that never spelled its name: an imported signature carries it, and its home module is in the graph by reachability of the type — the same sentence Method Syntax §4.2 states for the dot's operation set, one law with two clients. Whether the accessing module imported the declaration, in any form or at all, changes nothing: an import carries a module alias and nothing smaller (§3) — construction abroad is `Alias.Crate(…)`, or bare through §5.1 rule 3's fallback where the alias is spelled like the constructor, and a constructor pattern abroad is reached bare through Pattern Matching §2.2's door where the expected type is determined, qualified otherwise — but no import is ever the difference between a representation open and shut. A nominal record's pattern eliminator is the constructor pattern (Pattern Matching §2.4), which a module without the alias still writes — `let Crate({n}) = v`, the `let` subject typed before its pattern and the door supplying the constructor; `{...v}` remains the expression-side exit through the crossing (Products §5.3). The open-or-shut difference is written in one place by one author: `opaque`, on the declaration. Consequently there is no consumer-side or intermediary re-abstraction — no module can pass along another's type with the fields closed, and re-exports, the one vehicle such a facade could ride, stay deferred (§12.2) — and no per-signature or per-occurrence form exists; a representation has one answer, written once: transparent everywhere, or closed everywhere outside its home. Diagnostics inherit the rule: a missing-field error names the record's known fields wherever it fires (Products §3.2) — an empty field enumeration is malformed output, never a compiler sentence — and the only "representation not visible here" refusal is the opaque one above, which sends the reader to the home module.

Lineage: Roc's opaque types and Haskell's export-`Point`-without-`Point(..)` idiom; the head-keyword spelling keeps the common case JS-shaped where an export list (Haskell/Elm) would abandon it (§9.3). One cost is taken with eyes open *(#590)*: a module's exported interface reads off **two** left-margin keywords — the declarations beginning `export` plus those beginning `opaque` — where before #590 every unconditional export began `export`. The dropped word was redundant-but-always-true, unlike `widens`' dropped `export` (which would sometimes have been false, visibility being derived there — Constraints §4.7); the legibility price was judged worth the one-slot grammar, and the precedent both forms now share is the same sentence: the form claims exactly the properties the thing has.

#### 4.2.1 Variance claims on parameterized opaque types *(added 2026-08-01, #205 — closure doc `decisions-ml-dialect-generalization-2026-08.md` §6)*

A type parameter of an `opaque` declaration may carry a **variance sigil**: `+a` (covariant claim) or `-a` (contravariant claim). Grammar and its two parse errors are the Declarations Preamble's (§2.1 there); this section owns the semantics.

```hexagon
opaque record Seq(+a) = { pull: () -> Option((a, Seq(a))) }
opaque record Registry(k, +v) = ...      -- claims are per-parameter
```

- **Bare means invariant — the empty claim, and legal.** Outside the home module an unmarked parameter is treated as invariant. This is this section's own doctrine applied to the next capability: opacity hides *structure*, not *capabilities* — and every capability that crosses (`derives`, arity, now variance) crosses because the author **wrote** it. The governing principle, owned by the closure doc §6.2: **what crosses an opaque boundary must be declared, not inferred.** Inferred variance would let a private representation edit silently change *client modules'* generalization behavior — fake abstraction by another door.
- **Claims are verified in the home module**, where nothing is hidden: the compiler computes the representation's true variance (closure doc §5; recursive occurrences within the declaration's SCC contribute the computed fixpoint, constructors outside it their declared claims — closure doc §6.3) and checks each claim at the declaration. `+a` is legal iff every occurrence of `a` in the representation is covariant (computed *unused* or `+` — a phantom parameter supports any claim); `-a` iff every occurrence is contravariant (computed *unused* or `−`); bare is always legal. An unsupportable claim is a **hard error at the declaration naming a witness occurrence**: "`a` cannot be declared covariant in `Seq`: field `consume` uses `a` in argument position. Remove the `+`, or change the field" — carrying a **secondary diagnostic label at the witness occurrence's span**, which hosts render as file and line. *(Revised 2026-08-01, #205/#207: the label discharges the location requirement in full — the message names the field and the position, the label carries where. An earlier spelling wrote the location into the message text itself, `(Seq.hex:31)`; do not read it back in. No pass below the host knows a file path, and the witness is by construction in the file the reader is already looking at — a record's fields and a union's constructor slots are part of its own declaration. The witness label is required content, not garnish: the message without it does not conform.)* A later representation edit that violates a standing claim errors *here*, at the author's declaration — never downstream in a stranger's module.
- **Under-claiming is legal everywhere and forever** — it reserves the right to strengthen the representation later. There is no compiler warning for it (no warning tier, Preamble §1.1); the LSP offers a code action when a bare parameter's representation would support a claim (closure doc §8.2).
- **Declared claims are used uniformly, the home module included** — Step 2's covariance test (Functions §8.7) reads the claim, never the private representation, so a program cannot compile in its home module and fail identically-written elsewhere. The computed variance is used exactly once, for the verification above.
- Transparent types are the other half of the rule and take no syntax: their variance is **inferred** — the definition is public, so the computation leaks nothing a reader could not derive (closure doc §5.3).

### 4.3 Private types in public faces

An exported face whose type mentions a **private nominal type** is a hard error at the carrier's offending seat. The rule reads **every carrier an exported declaration has** *(#621)*: an `export`ed binding's signature, an `export`ed type alias's target, an `export`ed record's fields, an `export`ed union's constructor payloads, an `export`ed exception's payloads, and an `export`ed pattern's head — its subject and component types (Pattern Declarations §2.3) — the visibility the head (or, inside an `extern from` block, the row) writes as `export`, never an `opaque` declaration's interior (see below). One more exported face joins the family without being a carrier *(#626)*: an `export`ed **constraint's member signatures**. No carrier row of theirs rides Part 7's list — member signatures reach a declaration file only through Parts 8–9's deliberate public-evidence surfaces (Modules §11.5; Constraints §6.5) — and the face they always show is the honor-writer's and the member-caller's; the rule reads both the same.

> exported binding `parse` exposes private type `Token`; export the type, perhaps opaquely, or keep the binding private

One message family, the carrier's own noun in both seats — `` exported type alias `W` … keep the alias private ``, `` exported record `Outer` … keep the record private ``, `` exported union `U` … keep the union private ``, `` exported exception `Boom` … keep the exception private ``, `` exported constraint `Probe` … keep the constraint private ``, `` exported pattern `rat` … keep the pattern private ``. Rust's private-in-public rule, same rationale: the caller could neither name nor use the type, so the export is unusable as written, and the fix is one keyword — "perhaps opaquely" offers the second keyword, since `opaque` is itself a kind of export (§4.2). The remedy's spine holds for every private nominal the walk can find; for an extern type, whose head does not take `opaque` (§4.2), the "perhaps" is doing its honest work.

**A type carrier's diagnostic sits at the offending mention's seat** — the field's annotation, the constructor slot's annotation, the alias's right-hand side — so the eye lands on the mention the message describes (an alias on the route excepted; see below), not on a ten-field head indicted for one field's fault; a binding's stays at the binding, whose signature is one seat already. The seat is the carrier's **whole written annotation**, not the sub-annotation of a nested occurrence: a field `token: Vector(Token)` anchors at `Vector(Token)`. Each carrier names every offending type **once**: three fields of one private type draw one diagnostic, at the first offending seat in declaration order — fields in written order, constructors then their slots in written order, an exception's slots in written order, a constraint's members in written order, each member's whole written signature one seat (a binding in miniature); a carrier leaking two private types draws two, each at its own first seat. **Every diagnostic in the family — the binding's included — carries a secondary label at the private type's declaration** (`` `Token` is declared private here ``): the label sits exactly where the one-keyword fix goes, so the fix is a lookup, never a search. Details:

- **The rule is local.** The private nominals it reads are the module's **own** — a type declared in another module contributes nothing to this check, whatever its privacy at home *(#629)*. The restraint leaves nothing unguarded: every route into a consumer's face runs through some exported face of the home module — a carrier, a binding, or a constraint's member signatures *(#626)* — and every one is refused **there**, in the one module that holds the declaration the label points at and can perform the remedy the message names. The unnameability backstop stands behind that: a consumer cannot name the type, so no complete exported signature of its own (§4.1.1) could mention it regardless. No second report abroad.
- An **`opaque`** type **mentioned** in an exported face is fine — that is the whole point of `opaque`.
- An **`opaque` declaration is not a carrier.** Its fields and constructor payloads have no `.d.ts` face — FFI Part 7 §5's brand-only face mentions neither — so a private nominal may sit in either, and hiding a private representation behind an opaque name is the intended idiom (§4.2): opacity hides structure, and a structure nobody can see leaks nothing.
- A private **alias** in an exported face is fine: aliases are transparent (Preamble §4), so the exported face (and its `.d.ts`) simply uses the expansion; display stickiness (Preamble §6) yields to visibility. Transparency cuts both ways: a private alias whose *expansion* mentions a private nominal launders nothing — the expansion is the face, and the nominal in it is refused the same. The seat is still the carrier's own annotation — the one naming the alias — and the message still names the nominal the expansion reached; the alias is the route, not the fault, and takes no label of its own. The family's secondary label points, here as everywhere, at the private type's declaration — which is also what resolves the seat's spelling `Alias` against the message's `Hidden`.
- Instances are exempt (they are not exports and can mention anything; §7.4).
- An exported **constraint** is the family's seventh member, and its only non-carrier *(#626)*: no `.d.ts` row of its own rides Part 7's carrier list, and member signatures reach a declaration file only through Parts 8–9's **deliberate** surfaces — the public-evidence closure's `Constraint.Dictionary<a>` interface renders the member set with the members' boundary faces (FFI Part 9 §2.2; Modules §11.5). The refusal therefore stands on two legs. The one that never was the emitter's: the rationale above applies to a member signature verbatim — an honor abroad must produce what the signature names, a member call hands it back, and neither party can name or use the type. And the emitter's after all: wherever Part 9's surface renders the member set, a private nominal in it is exactly the #621 failure class, a published face naming what no file binds — guarded here before it can arise. A private nominal in an exported constraint's member signature is refused at the member, once per (constraint, type) at the first offending member, the label at the private type's declaration as everywhere. **Default bodies are bodies, not faces** — they stay free (a default may use its module's private bindings; Constraints §6.5), as instances are (§7.4). Without the refusal the private type would function abroad as *undeclared* opacity — nameable never, usable only through the members — which is the pattern `opaque` exists to spell honestly (§4.2); the message's "perhaps opaquely" is that exact recovery, and it preserves every lawful use of the shape. (F#'s accessibility-consistency error and OCaml's signature escape check refuse exactly this at exactly this seat; Rust diagnoses it at the same seat.)
- **A private constraint gating an export is lawful — the sealing idiom, stated deliberately** *(#626)*. A private constraint in an exported binding's signature, or as a base constraint of an exported one, crosses nothing: the constraint is the gate, not the cargo. Nothing unnameable lands in a consumer's hands — a call passes with a type the constraint's home honors, or fails instance resolution, whose diagnostic §7.6 owns (naming the declaring module where the constraint is unnameable in the reporting module) — and no consumer can honor the constraint at a new type, which is the point: the author keeps the honored set closed, and the internal-organizing pattern — constraint private, public face of plain exported functions — is the same idiom's other face. The seal's other cost stands beside the grant: no consumer can abstract over the gate either — a consumer's export requiring it cannot write a complete signature, and the completeness advice states that truth rather than a spelling that cannot exist (§4.1.1's fourth-tier report; Constraints §5.1.1) *(#715, #716)*. The family reads private nominal **types** in signatures; a constraint in a binder's constraint list is not a type mention.

---

## 5. Namespaces and resolution

Hexagon now has **five namespaces**: terms, types, constraints (Constraints §2.2), **module aliases**, and **patterns** (Pattern Declarations §3.3). Position resolves; one new collision rule exists.

### 5.1 Resolution by position

1. **`Name.` — uppercase immediately followed by `.`** resolves in the module-alias namespace **first**. Types and constraints never take `.`, so no genuine ambiguity exists; the ordering is stated so the implementation is deterministic. If no module alias `Name` exists, the error says so, mentioning the type if one exists: "`Shape` is a type, not a module; `import Geometry` and qualify through it" — the module import being the one route (§3), and the compiler naming it whole: the type's home module is known by name to the checker that reached the type, and a module import carries no path (#829; the applied edit, below). The `.` token remains the one from Operators §10 — field access and module path, resolved by what the left side names; a module alias on the left makes it a module path.
2. **`Name` in type position** resolves in the type namespace **first**. Where the type namespace has nothing for the spelling, and a module alias `Name` is visible whose module exports a type `Name`, the reference resolves to that exported type — **the companion fallback** *(#531; §5.3's idiom is what it exists for)*. The fallback answers only where resolution had already failed, and the alias still binds nothing in the type namespace: a same-spelled type declaration — or a `type` alias of the importer's own — wins outright everywhere, with no collision and no refusal. The compiler-owned boundary types (`Array`, `Nullable`, the hidden `Node` — §5.5's parenthetical) stay **last**: they answer only after declarations *and* after the companion fallback, which is §5.5's own sentence applied — no resolution claim of the compiler's outranks a user's declaration, and the companion fallback resolves to one, reached through the user's own import. Conservativity is exact everywhere but at the boundary spellings: every program that resolved without the fallback resolves identically under it, **except** where a module imported under a boundary type's name and exporting a same-spelled type now means the user's type — the reading whose absence the old resolution's own error marked as confusion (the same-name-both-sides tell, `expected Array(Int), found Array(Int)`). At `Array` and `Nullable` the exception is reachable in any module; at `Node`, only in a runtime-privileged one — the one place the spelling answers at all (intrinsics §5.2's `runtime` flag, gating the §3.3 fallback family) — because shipped runtime source holds no import lines, but a project-supplied file at a runtime injection path (intrinsics §5.2's grant) may, and the same exception applies there. (`JsMap` and `JsSet` are compiler-owned too but stand outside the carve: they answer ahead of the companion fallback, exactly as `Vector`, `Map`, and `Set` do. Through the prelude route the ordering is unobservable at all three companions, since `stdlib/JsMap.hex`/`stdlib/JsSet.hex` — like `stdlib/Array.hex` — export no type of the alias's spelling.) A visible alias whose module exports no type of the alias's own spelling adds nothing: resolution proceeds to whatever answered before it (at the boundary spellings, the boundary fallback — where it reaches), and where nothing answers, bare `Name` in type position is an error naming the working repairs (`P.Point`; realias as `import Point`; or `type Point = P.Point`). **`Alias.Name` in type position** resolves `Name` in the *exported type namespace* of the aliased module. **Constraint position carries the same fallback** *(extended in the #531 ruling)* — everywhere a bare name resolves in the constraint namespace: a binder's constraint list and an `honor` head alike. **`Name`** resolves in the constraint namespace first; where it has nothing and a module alias `Name` is visible whose module exports a constraint `Name`, the reference resolves to that exported constraint — answering, never binding, every property above holding one namespace over, and with conservativity exact and uncarved: the eleven pre-registered constraint names are always present (Constraints §5.1.1), so the fallback never fires at them, and no compiler-owned constraint fallback exists. The fallback carries **no members** — a constraint's members are reached through the alias (`D.describe(x)`) or by the dot (Constraints §2.2), so member spellings stay free everywhere, and the generalisation law's route (§5.3: to widen a member, import the module) is the only route there is. **`Alias.Name`** resolves in the aliased module's *exported constraint namespace* (§3.1).
3. **`Name` in term position** (applied or bare) resolves in the term namespace **first** — constructors, constraint members, ordinary bindings. Where the term namespace has nothing for the spelling, and a module alias `Name` is visible whose module exports a **constructor** `Name` — a nominal record's, or a union constructor spelled like the alias — the reference resolves to that constructor, in an expression and in a pattern alike: **the companion fallback in term position** *(#763)* — rule 2 one namespace over, every property stated there holding here. It answers only where resolution had already failed; it binds nothing; a same-spelled term declaration or binding wins outright, with no collision and no refusal; and conservativity is exact — no program that resolved without it resolves differently under it. It reads the module's *exported* constructor, so an opaque record's constructor (§4.2) is out of reach abroad exactly as its qualified spelling is. In an **expression** the fallback declines with §10's opaque-construction row ("`Point` is opaque outside module `Point`; use its exported functions"), never the unknown-name error: the alias names the type's home, and the reader is owed the rule, not the mechanism. In a **pattern** it declines silently to Pattern Matching §2.2's door, whose refusal is the destructure sentence at the type's noun (Pattern Matching §2.4) — the same rule, in the words of the seat that reports it. A constructor not spelled like its alias takes no fallback in an expression — `Circle(1.0)` under `import Shape` is refused naming the qualified spelling (§10) and is written `Shape.Circle(1.0)`; in a pattern, Pattern Matching §2.2's scrutinee-type door reaches it, after this fallback and after scope.
4. A module alias in **term position** other than the left of `.` — and other than rule 3's fallback, which reads a same-spelled *constructor* through it — is the "modules are not values" error (§3.1). Type and constraint positions are rule 2's to govern: the companion fallback where it answers, the boundary fallback after it (type position, at the boundary spellings — §5.5), and the refusal with its named repairs where nothing answers.
5. **A name at the suffix seat** — against the closing parenthesis of a parenthesised list, `(…)name` — resolves in the **pattern namespace**: the module's own patterns and aliases, and the exported patterns of the modules it imports, own occluding and contests refused at the use; and, in pattern position, where it has nothing, the expected type's home (Pattern Declarations §3.3). No other namespace is consulted at that seat, and the pattern namespace answers at no other.

**The applied-edit obligation for this repair family** *(#577; respelled #829)*: where a refusal in this family — rule 1's type-not-module, rule 5's suffix refusals that name an import (Pattern Declarations §3.3, §7), and the constraint seats whose rows Constraints §8 sends here — names a module import as a repair, the report carries the applied edit inserting `import Scale`, placed so the module stays well-formed and any term-position use sits below it (§3: term references read top-down; type and constraint names are order-insensitive, and a doc comment keeps its declaration). Before #829 this obligation sat with the LSP's workspace tier, because a module import carried a path the compiler tier could not know and the workspace had to find the one exporter; a module import now names a module (§3.1), the checker knows the declaring module of every type and constraint it has reached by name, and the edit is the compiler's own. Where the refused spelling is a name the module has *not* reached — an unknown type the workspace may export from several modules — the tooling names the candidates, the exported inventory driving which repairs are named, as everywhere in this family; several exporters draw no insert.

### 5.2 Collisions

- **Two module aliases with the same name** in one module: hard error at the second import line — the one collision rule an import can trip. (Two aliases onto one module under different spellings are legal, §3.1.) A refused import binds no alias, whatever refused it — nothing resolved, a contest (§2.3), or a head refused at parse (§3.1) — so a later import of the same default spelling collides with nothing.
- **Module alias vs type name, module alias vs constructor:** legal, resolved by position. This is deliberate and load-bearing: it is what makes the **companion-module idiom** — `Int` the type / `Int` the module, `Map`/`Map`, `Point`/`Point` — a *rule* rather than a prelude coincidence.
- **There are no import-item collisions.** No import puts a name smaller than a module into scope (§3, §9.11), so the import↔import and import↔local collision family has no members: what an importer wants bare, it declares (§3.2), and that declaration collides under the ordinary rules of its own namespace (Declarations Preamble §7.3). A module alias contests nothing outside the module-alias namespace. The pattern namespace (§3's carve) keeps the property from its own side: two imports exporting one pattern name collide at no import line — the contest is refused where a use meets it, and an own declaration ends it (Pattern Declarations §3.3).
- **Constructor / module-alias coexistence** (bare `Shape` is a nullary constructor, `Shape.` is a module): **legal in v1.** The Elm-strict alternative (error, force a rename) is a **v2 candidate** to be adopted if field evidence shows confusion — tightening later is easy; loosening later is a design admission. The LSP hover should disambiguate in the meantime.

### 5.3 The companion-module idiom (blessed)

The intended pattern for opaque types: the home module exports the opaque type plus functions under its own roof, and consumers import it under the type's name.

```
-- point.hex
module Point

opaque record Point = {x: Float, y: Float}
export fun make(x: Float, y: Float): Point = Point({x = x, y = y})
export fun getX(p: Point): Float = p.x

-- consumer.hex
module Consumer

import Point
let p = Point.make(1.0, 2.0)      -- Point. = module; Point in types = the type (§5.1 rule 2's companion fallback)
fun norm(p: Point): Float = ...
```

The prelude's `Int.div`, `Map.get`, `Vector.map` are this exact pattern — auto-imported companion modules, **one reading, not a special prelude device**. Two suppliers stand behind the one reading: a prelude companion's type name arrives by seeding (§5.5), a user companion's through §5.1 rule 2's companion fallback — and a transparent companion's constructor through rule 3's, so `export record Point = {x: Float, y: Float}` in module `Point` gives the consumer above `Point({x = 1.0, y = 2.0})` and the pattern `Point({x, y})` on the same one line (#763) — and the consumer file cannot tell which *(#531: before the fallback existed, the example above did not compile, and this sentence said "one mechanism" — an overclaim at exactly the type level)*.

**Companion dispatch makes this idiom load-bearing** (Method Syntax §4): a dot call `p.getX()` rewrites to the companion operation of the receiver's type, and `CompanionOf` targets **the nominal type's home module** — the declaration site, unconditionally — not the importer's alias or any import path. The idiom is therefore a resolution rule's substrate, not just a style.

**Qualified access reaches honored members** *(#304/#335 — the uniform access principle)*. `Alias.name` resolves, in order: the module's exported terms; the members of constraints the module **declares** (§3.1's existing rule — the polymorphic read, which therefore wins on a declaring module that also honors); then the members of instances the module **honors at a type it declares** — a read that denotes the widens binding wherever a `widens` declaration supplies the member (Constraints §4.7; the generalisation law below): the qualified spelling shows the operation's widest face, never the derived restriction. `Rat.add(r1, r2)` denotes the `Num<Rat>` member; `Bool.show(flag)` denotes derived `Show<Bool>`'s. The governing principle: a consumer's spelling `M.f(…)` survives `f` migrating between a plain module function and a constraint member, in either direction, with no call site changing — which also means the member→function migration may narrow a signature, and the set `M.f` addresses is the module's-own-type call sites that survive it. A module honoring one constraint at **several** of its own types makes `M.f` ambiguous and takes §5.5's refusal posture, naming each honored type and the unambiguous routes — the dot call on a value and the declaring module's qualified spelling (and the bare member call, where §5.5's set admits one); companions honor at one type, so the idiom never meets it. The honored-member binding is **qualifiable, not a bare export** (Constraints §4.6's one-exporter law — bare `show` has exactly one exporter, `Show.hex`). For a **fixed prelude companion**, "a type it declares" reads as *the primitive it companions* (Constraints §5.3: the companion is the primitive's home module), so `BigInt.gcd` denotes `Integral<BigInt>`'s member exactly as `Rat.add` denotes `Num<Rat>`'s — and the conversions ride the same read: `BigInt.fromInt` is `Signed<BigInt>`'s member, one implementation whose qualified spelling survives the migration unmoved. Transitional note *(narrowing per companion — #344; now **discharged**)*: while a primitive's companion did not yet exist as source, the compiler-wired instances supplied the same qualified member spellings against the module-less name (`Float.show(1.5)` was the standing example — §6.4's qualified-home guarantee extended to members); each companion's migration milestone (stdlib-roadmap §5.2, intrinsics §9.2) replaced that machinery with the real module and retired the primitive's wired rows in the same change. With `Float.hex` and `String.hex` landed, all five companions are source, the transitional list is empty, and the machinery itself is gone — `Float.show(1.5)` is this section's ordinary honored-member read, and the note stands as the record of how the guarantee held through the migration.

**The generalisation law** *(#541; reach stated for #544; declared form #546)*. A companion may declare a **wider face** of a constraint member it honors at its own type — the `widens` declaration, whose form Constraints §4.7 owns: `widens Pow.pow(value: Float, exponent: Float): Float = …`, a module-level term binding whose name is *derived* from the member it names and which carries no `export` modifier. The law is layer-blind: the companion may be a stdlib primitive's home or any user type's, and the constraint a prelude one or one reached through a module import (§3.1) — its reach boundary is Constraints §4.6's, which the law carves and nothing else: the carve amends the honor-claim only and never unseats an ordinary binding of the member's spelling, so the form is unavailable in the constraint's own declaring module (where the spelling is the member's exported forwarder, and a module cannot qualify through itself) — and available in every other honoring module, which reaches the constraint through a module alias and can therefore always spell the head's member path (the named constraint import, whose alias-less members once made the head unspellable, no longer exists — #762). To widen a member, import the module: the only import there is. The declaration then claims the qualified spelling — the honored-member read above names the widens binding at exactly this case — and the law is what makes that claim lawful rather than a drift hazard: **the declaration must generalise the member**. It accepts every call the member accepts, agrees with the member everywhere their domains overlap, and the member **is the declaration's restriction — derived, not written** (Constraints §4.7): the honor block accounts for it with a `member = widened` line and holds no body of its own. The signature half is **checked** at the declaration, and must widen properly — an identical signature is the ill-formed delegation pattern, not a generalisation (Constraints §4.6 states the check); the agreement half holds **by construction**, one body restricted mechanically agreeing with itself — the drift the law once bound by review is no longer writable. A same-spelled export is the ordinary rebinding refusal, unconditionally, with the rewrite into the form where the export would have passed the check. **The widens binding is qualifiable, not a bare export** — it inherits the member's visibility rule (Constraints §4.6's last bullet) and is not an exporter for §5.5's bare-name collision count, so the member spelling keeps its one exporter, the constraint's declaring module — bare where §5.5's set admits it — however many companions widen a member. Under the law the two bindings are one operation wearing two widths: the qualified spelling (and the dot call — Method Syntax §6.1) shows the widest face, the constraint member remains what the operator and a consumer's bare or qualified spelling elaborate to (within the honoring module itself, a bare use resolves to the widens binding — Constraints §4.6), and the §5.3 principle above — a consumer's spelling survives migration — holds by construction, because every call the narrower face answered is answered identically by the wider one. The standing instances are the two power doors: `Float.pow` over `Pow<Float>`'s member, `BigInt.pow` over `Pow<BigInt>`'s (Operators §6.3.1). Where no `widens` declaration exists, the qualified member spelling denotes the member itself, exactly as this section always read.

*(Ruling #125, 2026-07-28.)* The compiler-provided implementation of a companion operation is **not a third meaning of the shared name**: §5.1's resolution by position keeps exactly its two meanings, module and constructor. Intrinsic linkage is a declaration form owned by `spec/intrinsics.md`; the transitional practice of reaching an intrinsic through the companion's own public qualified name is deprecated there with a per-companion terminus (`intrinsics.md` §9). The idiom itself was examined under an explicitly widened scope and retained (`intrinsics.md` §2).

### 5.4 The prelude occlusion rule

The prelude enters every module's scope as a **distinct outermost layer**. The Head Binder Shadowing rule (Statements §5) keeps its statement for every layer the module writes itself — sequential binders never reuse a name from the module layer or any inner layer, nor one whose definition is in progress (Statements §5.1) — but the prelude layer is **shadowable at every binder position**, and shadowing it **reserves the name**:

- A **module-level** `let`/`fun` (or a module import, whose alias may occlude a prelude module's, or a constraint's member, or a type-namespace declaration such as `record Seq(a)`, or a declaration's **constructor names** — a union's, a record's, or an exception's) **may occlude a prelude name**. `fun show(x) = ...` at module level is legal; the local `show` wins unqualified **module-wide**, and the prelude's version remains reachable qualified (`String.show` etc. — §6.4 guarantees a qualified home exists). *Module-wide* is enforced by reservation: the occluding item makes the prelude's binding invisible throughout the module, and every reference — outside a shadowing `let`'s or `var`'s own RHS, the pending-clause seam (Statements §5.1) that the wrapper idiom depends on — resolves **as if the prelude did not bind the name**. A reference above the occluder therefore behaves exactly as the same shape behaves at a user-written name: the declared-later error (Functions §7.2) above a binding, a declaration, or a module import (§3's import-shaped fixit), or the legal mutual reference within a `fun` block (Functions §7.3) — never, in any case, the prelude's meaning. Outside that one RHS seam, one identifier never carries two meanings in one scope. A module import enters the *same* layer as local bindings and fights under the full ban (§5.2's one collision rule).

  Constructor occlusion reads **pattern position and value position as one scope** — Functions §7.2 already governs both. A bare constructor pattern below the occluding declaration means the module's constructor; one above it draws §7.2's pattern-position declared-later error ("move the union's declaration above this use"); a module without an occluder keeps the prelude's constructor in patterns as everywhere else. The occluded prelude constructor stays reachable **qualified in both positions**: the §3.1 forms through a module alias, and the declaring prelude module's own name for prelude constructors — `Ordering.Less`, `Option.Some(v)`, in a pattern as in an expression. (`union Flag = True | Maybe` is therefore legal and occludes `True` module-wide; every context demanding `Bool` still demands it, so a strayed `Flag` constructor is a loud type error, and `Bool.True` remains spellable in both positions.)
- A **function-local sequential binder may shadow a prelude name** — the same grant, one layer in. Statements §5.1 rule 1 exempts the prelude layer from its collision set, for all four sequential forms alike: `let`, `var`, `fun`, and `let`-destructuring (`let {show, hash} = record` is legal, its punned fields shadowing two prelude names the pattern's author never wrote). The shadowed name is **reserved for the whole enclosing block** (Statements §5.1): references outside the binder's own RHS resolve as if the prelude did not bind the name, so a use above the binder takes the declared-later error rather than the prelude's meaning — the same reservation as at module level, and the two levels must never diverge.
- **The reverse is not granted.** A sequential binder still may not reuse a name from the module's own layers — a module-level binding, a parameter, another local. The exemption is tested against the layer of the binding actually in scope, not the name's ancestry: a module that has occluded `show` has moved `show` into its module layer, and a function-local `let show` below that occluder is the ordinary rule-1 error, citing the module's own line.

**In prelude source, "the prelude layer" is the module's §5.5 visible prefix** — the only prelude layer it has. The rule is otherwise identical: stdlib modules shadow and occlude their predecessors exactly as user code shadows and occludes the full prelude, so stdlib source pasted into a user module resolves its shadowed and occluded names the same way. (The paste is not unconditionally legal — a pasted constraint declaration meets §5.1.1's refusal, and a bare reference whose prefix had one exporter can meet the full set's §5.5 ambiguity; both are loud.) `Vector.hex`'s, `Map.hex`'s, and `Set.hex`'s own `empty` declarations are this reading's prior art at module level: each is an ordinary §5.4 occlusion of the `empty` exported by an earlier prefix member.

This section owns the module/prelude boundary referenced by Statements §5.2/§10.2. Without occlusion and the shadow grant, every addition to the prelude in a future release could break a program already using that name — untenable with no warning tier to soften it. Stated at the width the rules deliver: **adding a name to the prelude cannot break a program through a binder collision.** Not "cannot break a program at all" — two channels survive by design, one of them in principle only. A bare reference to a name in §5.5's bare set that a *second* prelude member starts exporting becomes the §5.5 collided-name refusal (the use site must qualify) — a channel the closed set narrows to a second prelude exception spelled as one of the eight, which the inventory forbids; a second prelude constraint's `show` seeds nothing, the member seat being keyed to `Show.hex`'s declaration (§5.5) — and the eleven pre-registered constraint names are refused as declarations outright (Constraints §5.1.1). Both are reference- or declaration-shaped breaks with mechanical fixes named in their diagnostics; neither is a binder collision.

Two adjacent facts, so the shadow grant is not overread:

- **A wrapper captures the bare-name spelling only.** A binding over a constraint member's name — `let show = (v) => "«" ++ show(v) ++ "»"`, legal at either level, its RHS reaching the prelude through the pending-binder clause (Statements §5.1) — reroutes calls spelled `show(…)` and nothing else. Elaboration-internal dispatch keeps its own routes (Constraints §6.1): string interpolation still uses the honored `Show` instance, `+` the honored `Num`, comparison the honored `Ord`. A stray binding must not redefine `+`; the price is that wrapping is weakest at exactly the names most worth wrapping.
- **`let` wraps; `fun` recurses.** `let show = (v) => "«" ++ show(v) ++ "»"` wraps the prelude's `show` once, because a `let`'s own name is absent for reference in its own RHS (Statements §5.1). `fun show(v) = "«" ++ show(v) ++ "»"` is a self-call — a `fun` is the one-member block, its own name in scope in its own body (Functions §7.3) — and does not terminate. Same two words, opposite meanings, and no diagnostic distinguishes them; pre-existing for user-written names, reachable at prelude names wherever shadowing is.

### 5.5 The prelude is ordinary modules, in an ordered set *(added 2026-07-26)*

The prelude is a **fixed, ordered list of ordinary `.hex` modules** (canonical source under `stdlib/`) — the modules of the standard-library package `Hex` that every program sees without an import (Packages §2.4), compiled like any project module and injected into the outermost scope layer of §5.4. Each has a header like any module (`module Option`, §2.1), and its full name is `Hex.Option` (§2.3): the import `import Hex.Option as Opt` binds a second alias onto it (§3.1), and a project's own `module Option` occludes the bare name for its importers while `Hex.Option` stays reachable (§2.3). Four rules make it a set rather than a heap:

- **Ordered intra-prelude visibility.** Each prelude module implicitly sees the prelude modules **before it in the list, and only those**. Cycles are impossible by construction; the list order is normative (`Option` precedes `Seq`; `Seq` precedes the collection modules that convert to it).
- **No `import` lines in prelude source.** Prelude modules use earlier prelude names implicitly, exactly as user code does. This is deliberate pedagogy: the stdlib is read as exemplary source, and an `import Option` line at the top of a prelude module would teach every reader a false lesson about the language. *(This bullet also prescribed a **header comment** naming the implicitly-scoped prelude names — ``// `Option`, `Some`, and `None` are implicitly in scope via the prelude.`` — as the house form. **Withdrawn 2026-08-01**, James's direction, and the comments deleted with it. It restated, once per file, what this very section guarantees for every prelude module, and it named three of the prelude's names as though the rest were different. A reader who does not know that prelude names are in scope does not learn it from that list; a reader who does, reads it as noise. The no-`import` rule above is untouched — nothing about it needed a comment to hold.)*
- **A collided bare name is refused.** Two visible prelude members may export the same term name — the collection vocabulary is shared by design (Collections Part 1 §3.1: `Seq.length` and `Vector.length` are both correct spellings) — and where both spellings are in the bare set (the next rule), neither owns the bare one: a bare reference to a name that two or more *visible* members export is an error naming every qualified home (``write `Seq.empty`, `Vector.empty`, `Map.empty`, or `Set.empty` `` — four homes since `Set.hex` joined, #373) — the ML answer, where `List.map` and `Seq.map` coexist and the use site qualifies. The collision set follows visibility, so a prelude member whose visible predecessors export a name once keeps the bare spelling even while consumers must qualify it. Everything §5.4 grants is untouched: a module's own declaration occludes the whole prelude layer, collided or not — `let map = Seq.map` is how a module takes a prelude spelling bare, and it is a declaration, not an import (§3.2). Dot calls are the other unaffected spelling — dispatch is type-directed (Method Syntax §4.2) and never reads the bare-name layer, so `values.length()` needs no qualifier however many members export `length`. The rejected alternative — the seeding order silently deciding a winner — would re-mean every bare `empty` in every existing program each time a member joins the prelude: a language-wide edit made by a list order.
- **Bare seeding is by channel, and the bare set is closed** *(#742)*. Injection into the outermost layer seeds a prelude member's **module alias** (§6.4's qualified home) and its **type names** — its constraint names resolve by pre-registration, not seeding (Constraints §5.1.1) — and, in the term namespace, **nothing by default** — and in the pattern namespace nothing at all: a prelude module's patterns enter it by an explicit import of that module, as any module's do (Pattern Declarations §3.3). A prelude export reaches a consumer's bare term scope only through one of four channel rules:
  - **Functions: none.** Every prelude function is reached qualified (`Seq.map(xs, f)`, `Float.isNan(x)`, `Debug.log(value)`) or, where its first parameter is the receiver's type, by the dot (`xs.map(f)` — Method Syntax §4.2 reads the export set and never this layer). One survivor, on its own ground: `ignore` — Statements §3.2's discard diagnostic names the bare spelling as its rewrite (§3.3 declares the function), and nobody declares the word.
  - **Union constructors: the open unions only.** `Bool`, `Option`, and `Result` are the open unions; their six constructors `True`, `False`, `Some`, `None`, `Ok`, `Err` are bare in expression and pattern position alike. Every other prelude union's constructors are **qualified-only** in both positions, through the §3.1 qualified-constructor forms — `Ordering.Less`, `JsKind.Null`, `JsPathSegment.Index(3)`. A qualified-only constructor takes no bare-scope binding and counts for nothing in the collision arithmetic above; its union's home must be addressable under the union's own name (`Ordering.hex` homes `Ordering`; `Prelude.hex` homes `ignore` alone).
  - **Exception constructors: all, as a category.** A prelude exception is bare in a catch arm and in an expression (`IndexError(index, size) => …`, `JsError(e) => …`, Exceptions §5.2) and stays reachable qualified (`Map.KeyError`). The category is safe because its names are compound `…Error` words — the suffix is the qualifier — that nobody declares as a function or a value, and a same-named user exception occludes with reservation (§5.4). A future prelude exception joins bare without a ruling; the inventory keeps exception names unique across the prelude, so the collided-name rule never meets them.
  - **Constraint members: `show` only.** A member is reached by the dot where it is subject-first (`x.show()`, `a.compare(b)`, `n.mod(2)` — Method Syntax §7) and qualified always — through an honoring companion (`Int.compare(a, b)`, `Rat.fromInt(n)`) or the declaring constraint's module (`Show.show(x)`; `Num.fromNat(1)`, the polymorphic spelling of a receiver-less member). `show` alone is seeded bare — `Show.hex`'s member, seeded by that declaration's identity and not by the spelling, so a second constraint declaring a `show` seeds nothing — for teachability, and that ground is not a precedent (Constraints §2.2). A member's *in-module* spelling is untouched: an honoring module binds its members at module level (Constraints §4.6), and a module's own constraint declares its members as ordinary bindings.

  **The bare set is therefore sixteen names** — the eight exception constructors, the six open constructors, `ignore`, `show` — and it is **closed**. An addition is a design ruling argued against this section, never a listing entry; a new open union exists only by such a ruling; exceptions join by category. The test every member passes is a **conjunction**: the bare spelling is *idiomatic* — the one the language teaches and programs write — **and** the name is *not one a user would declare* for their own purposes. Either half alone admits a name this section refuses: `log` passes the first, `isSubsetOf` the second. Nothing enters for teachability alone, and a member is a member because an instance may override it, never to earn a spelling. The consequence for style is deliberate and is the design's shape: **the dot is the prelude's everyday surface and the qualified spelling its explicit and polymorphic one** (Method Syntax §1) — Rust's shape, not Haskell's — and a new stdlib module spends no bare vocabulary unless it declares an exception.

  **A bare reference to a prelude name outside the set is refused with its routes named** (§10). One message shape serves every channel, differing only in the routes it lists: a function names the dot form and every exporter's qualified spelling; a member names the dot form and the declaring module; a constructor names its qualified spelling, in a pattern as in an expression. **The routes are spelled in the program's own words**: at a call, with the call's own arguments (`map(things, f)` draws `things.map(f)`, `Seq.map(things, f)`, `Stream.map(things, f)`); at a reference that is not a call, the qualified names alone — the message invents no identifier the program does not contain, and names no import route. The dot form's receiver is the call's first argument **parenthesised wherever the grammar would otherwise misread it**: a name, an access chain, a call, or an already-delimited form (a group, an ascription) stands as written; any other shape is wrapped — `div(-7, 2)` draws `(-7).div(2)`, never `-7.div(2)`, which parses as `-(7.div(2))` and computes a different number. The parentheses are always legal, so an unforeseen shape reads wordy, never wrong. The dot form is offered only where a receiver of that shape can dispatch: a tuple, `()`, or a record literal has no companion and no dot (Method Syntax §5), so such a call takes the qualified route alone (`hash((1, 2))` draws ``write `Hash.hash((1, 2))` ``), and a vector literal takes it alone for `Eq`'s, `Ord`'s, and `Hash`'s members, whose instances at `Vector` are structural (Constraints §4.5) and carry no dot (`hash([1, 2])` draws ``write `Hash.hash([1, 2])` ``; `length([1, 2])` keeps `([1, 2]).length()`); a pipe stage is rendered as the non-call reference, since the stage's first argument is the piped subject and not in the stage's text (Operators §8); and any other receiver bound to a structural value — a name, an access chain, a call, an ascription, a wrapped expression — is beyond the resolver's sight, so its dot form may be offered and refused by the checker — the qualified route beside it is the one that works. §10's rows are exemplars of this rule, their `a`/`b` standing for whatever the program wrote. It subsumes the collided-name refusal above for every name outside the set — that rule keeps governing the set itself, where nothing collides today. The Rewrite Rule (Declarations Preamble §1.1) is discharged by the message.

  Prelude source is governed identically, its prelude layer being the visible prefix (§5.4): a prelude module reaches a predecessor's functions qualified and its own exports bare, as the module-level bindings they are.
- **Type-declaring prelude modules are nothing special.** A prelude module may declare nominal types (`Option.hex` declares `union Option(a)`; `Seq.hex` declares `opaque record Seq(a)`, Loops §6.6). Such a declaration is an **ordinary declaration in the outermost layer**, subject to §5.4's occlusion rule like any other prelude name. **The compiler holds no resolution claim that outranks user declarations** — a name resolving to compiler-internal machinery *ahead of* a user's module-level declaration is a conformance defect against this section, not a feature. (Compiler-owned types that are deliberately *not* prelude-declared — the FFI boundary types `Array`, `Nullable`, and the hidden runtime `Node` — resolve as a fallback *after* declarations **and after §5.1 rule 2's companion fallback**, never before either; the rule 2 ordering (#531) is this sentence applied, since the companion fallback resolves to a user's declaration reached through the user's own import. Pre-registered constraint *names* are governed by Constraints §5.1.1 instead: all eleven are refused as declarations outright — a declaration-form error, not a resolution that outranks one, so this section's rule is untouched — and they are not prelude names for §5.4's occlusion rule; their *member* names remain ordinary occludable terms.)

The prelude's *inventory* remains owed to the stdlib listing (§6.4's qualified-home invariant applies to every member); this section owns only the mechanism.

---

## 6. What crosses a module boundary

### 6.1 Values and generalisation

Module-level `let`/`fun` bindings generalise per the existing rules (Functions §8; value restriction). Export adds nothing to generalisation: a module-level binding has its generalised scheme whether exported or not, and import conveys the scheme unchanged. Constrained exports carry their constraints; the importer's call sites discharge them exactly as local calls would.

### 6.2 Types

Exported nominal names are reachable through a module alias — qualified, or bare by the companion fallback (§5.1) — and identity is declaration-site (§2). Exported aliases remain transparent everywhere. Type parameters, arities, and `derives` travel with the declaration since they *are* the declaration.

### 6.3 What never crosses (because it never needs to)

Structural types (no home), instances (global, §7), `var` (cannot exist at module level), dictionaries (compiler plumbing, Constraints §1).

### 6.4 Pre-registered stdlib constraint

The occlusion rule's "prelude version stays reachable qualified" only works if **every prelude name has a qualified home** — a companion module it also lives in (`Seq.map` for `map`, `String.show`/per-type homes for `show`'s instances, etc.) — and the invariant holds for every prelude name, seeded bare or not, since §5.5 makes the qualified spelling the ordinary one. The stdlib listing **must** maintain it; a prelude export with no qualified home is a spec violation there. Pre-registered now, subject-first-convention style.

### 6.5 Constraints

An exported constraint crosses as a **reference to its declaration** (identity: Constraints §5.1.1). Subject, base constraints, member schemes, defaults, and implied type members do not travel separately — they are the declaration, and every importing module sees the one declaration the home module made. Its members cross as terms (§6.1) with their constrained schemes. Instances still never cross by name (§6.3): they are global already, and an imported constraint changes nothing about where its instances may lawfully live (§7.2 — the orphan rule's "home module" reads modules, not imports).

---

## 7. Instances, coherence, and the orphan rule

### 7.1 Globality (restated, now operational)

Instances are visible program-wide once their module is in the import graph — not imported, not exported, not hidden (Constraints §5.3). `export honor` is the §4.1 error. No form loads a module for its instances alone (§3.3); §7.6 explains why none is needed.

### 7.2 "Home module," operationally

The orphan rule's home module (Constraints §5.3) is defined: **the module whose text contains the declaration** — the text between its header and its closer or the file's end (§2.2). `honor C<T>` must appear in the module declaring `C` or the module declaring `T` (parameterized heads: `T`'s outermost constructor). Two modules sharing a file are two homes, not one (§2.2 — strangers); recorded so nothing subtler is ever read into it *(respelled from "the file whose text contains" — #829)*.

### 7.3 Duplicate-instance reporting point

Same-module duplicates error at the second declaration (unchanged). Cross-module duplicates error **at whole-program check, when the second module enters the import graph**, naming both modules and both declaration sites: "duplicate instance of `Ord<String>`: declared in module `A` and in module `B`" — each with a secondary label at its declaration, which hosts render as file and line (the module names the home; the label says where the text is, since a module's file is not derivable from its name — §2). The error is attributed to the program, not to either innocent-looking module — which is precisely why the orphan rule exists to make it nearly unreachable.

### 7.4 Instances on private types

Legal and harmless: an instance on an unexported type exists globally but nothing outside can name the type to reach it. `derives` on private and `opaque` types works unchanged (§4.2). No visibility check applies to instance heads; §4.3's private-in-public rule does not extend to `honor`.

### 7.5 Whole-program coherence: acknowledged cost

Coherence and orphan checking are defined **over the whole import graph**, which `hexc` sees (whole-program compilation). The package design keeps it so *(#829)*: a package ships its source, and a program's graph — its own modules, the prelude, and every dependency module reached by import — is compiled whole, so this check runs over packages exactly as over one project's modules (Packages §5.1). The cost this section once recorded — compiled Hexagon published as plain JS loses instance metadata, and cross-package coherence would then need interface files — is the cost of the *second* distribution stage, recorded and not designed (Packages §5.2): a package that ships compiled must carry a compiler-generated interface that reproduces the whole-program selection, and until that stage exists no package ships without its source.

### 7.6 Instance discoverability

Globality (§7.1) plus the orphan rule (§7.2) make discoverability a near-non-problem in the ordinary case, with a bounded residue:

- **The ordinary case brings both legal homes along.** Source that names `C<T>` resolves `C` through the constraint's home and `T` through the type's home. With no v1 re-exports, both modules are therefore already in the import graph (or are the same module), and the one lawful instance arrives without a separate import.
- **The residual cases** are (a) a value whose nominal type is *inferred* but never named by the consuming module — its own imports need not name either home even though the wider program graph reaches them through intermediaries — and (b) isolated-file checking (an editor or tool checking one file without the whole graph), where "in the graph" is not yet well-defined.
- **The diagnostic obligation:** a missing-`C<T>` error must name the two legal homes (or the one home when they coincide) — "no `Ord<Config>` instance is in the program; it could only be declared in module `Config` (declares `Config`) or in module `Ord`" — so the fix is a lookup, never a search; a home is named by module name, a prelude home by its bare name as the reader knows it (`Ord`, not `Hex.Ord`), and where the home's declaration text is wanted a label carries file and line (§7.3). A home is **offered** as an honor seat only where the honor could be written in project source: a prelude- or compiler-supplied home is named as fact, never as repair — the discipline the Collections Part 5 §3.3 loop-head report already keeps, applied to the template at large — and when no offerable home remains (a prelude constraint whose subject is a primitive, a prelude type, or a compiler-provided one: every legal home sits outside project source), the actionable content is that the pair's honored set is closed — change the type, or go through the operations its homes export. An impossible fixit would be worse than none. The obligation reads over subjects that have a declaring module to name: a structural subject — a tuple, a function type — has no home, and its refusals keep their own messages. When the required constraint is not itself nameable in the reporting module — a private base constraint reached through an imported constraint's declaration (§6.5), or a private constraint met in an exported binding's own constraint list, the sealing idiom's gate (§4.3) — the two-home template is wrong: the subject's module is a lawful home in which the honor cannot be *written*, since the unexported constraint is reachable there by no import or alias. The diagnostic names the constraint's declaring module alone and directs the honor there; for the sealed routes that closure is the author's design, and saying where the gate lives is exactly what the stranded reader is owed.
- **The derivation fixit's composition** *(#644)*: where the required constraint is derivable (Constraints §4.5) — read by identity, never spelling (Constraints §5.1.1's pin against name-keying; the four derivable names are pre-registered and non-redeclarable, so no rival declaration can arise) — and the subject is a union or nominal record whose declaration sits in project source with a module to name, the report also carries Constraints §8's derivation fixit in its list-aware, base-complete form, **appended** after the two-home clause. The appended fixit names no module of its own: the clause it follows has just named one, which is what keeps the project-source gate non-arbitrary here. At a **derivable-only** constraint — `Hash`, whose hand-written form every user module refuses (Collections Part 2 §4.1 owns the refusal; Constraints §4.5 registers it, and the companion carve-out sits at primitives, outside this gate) — the fixit does not join the clause but **replaces** it: both homes stand, but the *form* the two-home template invites — a hand-written `honor` — is refused at each, and a home is offered only where what the reader would write there is accepted. The replacement sentence is pinned here, in both of §8's dialects and base-complete — writable for every derivable constraint, since every base of the derivable four is itself derivable: for a `Point` with no `derives` list and no `Eq`, "`Hash` instances must be derived, so the only repair is `derives (Eq, Hash)` on the declaration of `Point` in module `Main`" — the head stating §4.5's law positively, one voice with the member-block refusal's own head (Collections Part 2 §9, #647); for a `Point` whose declaration already carries `derives (Eq)`, "…the only repair is adding `Hash` to `Point`'s `derives` list in module `Main`" — and each dialect is itself base-complete, so a carried list that leaves a base absent reads "…adding `(Eq, Hash)` to `Point`'s `derives` list in module `Main`". The discipline reads one step further at `Hash`: where the subject's `Eq` instance is hand-written, derivation is itself barred (Collections Part 2 §4.3), no repair that keeps that equality exists through the type's own instances, and the report states the positive requirement and the sanctioned route in place of both clause and fixit — "`derives Hash` requires a derived `Eq`, and `Weird` declares its own — key on a wrapper type whose `Eq` and `Hash` are both derived" (Collections Part 2 §4.5; the message carries the route self-containedly, no diagnostic printing a spec citation). At a derivable-only constraint the offering law in its general form is that a home is offered only where the derivation seat exists: primitives, prelude nominals, extern types, and structural subjects have no `derives` seat to edit and draw no fixit — none reaches this bullet's gate today, and a future subject with an otherwise-offerable home and no `derives` seat (an extern type granted a declaring module) takes a closed-set report of its own — the pair's honored set is closed because the one lawful form has no seat there — never an offer; the existing closed-pair sentence's "both outside project source" clause does not describe it and cannot be reused verbatim. The unnameable branch composes with none of this, the derivable constraints being prelude-declared and always nameable.
- **The pre-1.0 LSP obligation:** when a lawful instance exists in the *workspace* but outside the current graph, the tooling must detect it and name the activating import — `import Config`, complete as written, since a module import carries no path (#829).
- **Loading a module for its instances alone is unnecessary in v1** as a consequence of the first bullet, and no form exists for it (§3.3): the activating import the LSP names is the ordinary module import, whose alias the module may then never use. Future re-exports could make a loading form wanted by separating names in scope from their instance homes (§12.2).
- **Packages do not widen the residue; future re-exports would** (§12.2). A package ships source and its modules enter the graph by import like a project's own (Packages §5.1), so a package boundary hides no home: the ordinary case's first bullet holds across packages unchanged. A facade that re-exports a type without its home module's instance context would recreate the discoverability gap, and the re-export design inherits that.

---

## 8. Loading

### 8.1 Acyclic imports

An import cycle anywhere in the graph is a **hard error** naming the cycle: "import cycle: `A` → `B` → `A`." No exceptions, including type-only cycles — a cycle is a cycle. Rationale: ESM permits cycles and they are a hazard swamp (bindings observable before initialization); F# is strictly acyclic and is the lineage; acyclicity yields the deterministic load order below and means emitted ESM never exercises JS's cycle semantics. Instances being evaluation-free (Constraints §6.3) removes the one pressure that might have argued for cycles. Mutually recursive *types* live in one module (Preamble §7.2 already grants order-insensitivity within a module); the diagnostic suggests exactly that.

### 8.2 Top-level effects and load order

Non-binding `Unit`-typed expressions are **legal at module top level** (`print("loaded")` — JS-style, per the existing block rules: Statements §3.2 polices non-`Unit` discards there exactly as in any block). Load order is fixed: **a module's imports are loaded depth-first in source order, each module exactly once, before the module's own top level runs** — ESM's order minus the cycle cases, well-defined because §8.1 bans those. Within a module, top-level items run in source order (type-namespace declarations are order-insensitive per their specs; term bindings — and value-position uses of constructors and constraint members — are read top-down, Functions §7.2; `let`s and effects run in order, with instance dictionaries emitted ahead of them all, Constraints §6.3).

### 8.3 Root modules; no special `main`

Hexagon has **no language-level entry function**. `main` is an ordinary non-uppercase-start identifier: it may be declared, exported, imported, or called, but the compiler never discovers or invokes it implicitly and assigns no special type to it.

A compiler host selects one or more **root modules**, by name (§2) — `Main`, `Tools.Migrate` — since a module has no other address. Imports determine each root's acyclic graph. Building a root emits its ordinary ESM graph; running a root means asking the target host to evaluate that emitted root module. Its imports initialize and its top-level effects run exactly per §8.1–§8.2. No wrapper call or second program-order mechanism exists.

Library versus application is therefore not a distinction in Hexagon module semantics. The same module may be imported by another module or selected as a run root. Command spelling, project-file defaults, process arguments, and exit-code policy belong to compiler/host architecture; they cannot add a mandatory `main` or implicit parameters to the root module.

---

## 9. Rejected alternatives (do not re-litigate)

1. **ML module calculus** (functors, signatures, first-class modules — OCaml/SML): Hexagon's parameterization needs are met by type parameters and constraints; readable-JS has no good functor target; the intended user has never missed them; and "modules are fences, not forges" is the simpler story that HM-plus-constraints affords. Doubly foreclosed by "module aliases are not values" (§3.1).
2. **`module` header / in-file modules** (F#, Haskell) — **REVERSED (#829)**. This entry stood from July 2026 as a binding rejection, and §2 now specifies the header. The record of why it was overturned, so a reader sees the reversal was reasoned and not forgotten: the rejection gave two substantive grounds — ceremony, because under one-module-per-file the path already carried the name; and the name-versus-path drift hazard, which Haskell polices with directory-mirroring rules — and both were grounds against a header *beside a path*. The design that replaced it has no path: the compiler never reads a module's name off its file, so the header is the sole source of the name (no ceremony, since it is the information) and there is nothing for the name to drift from (no hazard, since only one side exists). The third ground, JS-verbatim, had already been spent by #762, when the import head stopped being JavaScript's. What the reversal bought is §1's first bullet and the package design it enables (Packages): a user never thinks about a file path, a module is addressed by the name it declares wherever it lives, and the compiler tier can name a complete import repair (§5.1). What it cost is recorded honestly: a header on every module, a closer between modules that share a file (§2.2), and the corpus-wide migration of an import head that had been JavaScript-shaped.
3. **Export lists** (Haskell, Elm): maximum control, but a second export mechanism that abandons the JS shape; `opaque` covers the one abstraction need the list was wanted for.
4. **`Shape(..)` import sugar** (Haskell): the module import covers the want, and Pattern Matching §2.2's scrutinee-type door gives `match` arms their bare constructors with nothing entering scope (§9.11, #763).
5. **Default exports** (JS): the one JS feature declined — a second export kind with naming anarchy at import sites and interop pain, widely regretted in the JS ecosystem itself; named exports are the single story.
6. **Single-namespace modules** (Elm): breaks the already-shipped prelude idiom (`Int`/`Int.div`, `Map`/`Map.get`) and the companion-module pattern user libraries will want; renames like `Ints` are ceremony Camp-1 languages prove unnecessary. The narrow Elm-strict *constructor*/alias restriction alone remains a v2 candidate (§5.2).
7. **F#'s shadowing/priority stack** across modules/types/namespaces: the documented confusion; Hexagon takes Haskell's semantics under JS's syntax instead.
8. **Rust's unified path system**: drags in `::` or overloads `.` harder than needed; the five-namespace split with position resolution is smaller.
9. **Cyclic imports permitted** (ESM): §8.1.
10. **Module-level `var` / exportable cells**: was never on the table (Statements §6.4); recorded here because this is where people will look.
11. **Named imports** (JavaScript's `import { a, b as c }`; every ML's `open`, import list, or `exposing`) *(#762)*: an `import` binds a module and nothing smaller (§3). The surface was JavaScript's own until #762 and was removed for what its absence buys: every name's origin visible at its use site (a suffixed pattern's excepted, its origin one of the module's import lines — §3's one carve) — Go's discipline, and Go is content with it; the precedent is Go's, not an ML's, since every ML keeps a per-name door — and the deletion of an entire collision family that existed only to govern names an import item put into bare scope: import-item collisions (§5.2), alias start classes, the namespaces an item spans, selective member import (§12.4), and the unspellable-`widens`-head doctrine (Constraints §4.6). What replaces it is ordinary declarations and the companion fallbacks (§3.2); the one cost the removal would otherwise exact — imported union constructors qualified in every `match` arm — is paid by Pattern Matching §2.2's scrutinee-type door, not by an import form.
12. **`import module Geo from "./geometry"`** (#565's head): superseded by `import Geo from "./geometry"` (#762), itself superseded by `import Geometry as Geo` (#829, §9.14). The word was carved to say what the form does while the named form stood beside it; with one binding form left, and the path-free `import Geometry` the shape v1's head was meant to shrink to, the word would have outlived its reason — and did not live to see the shrink.
13. **Type-directed constructor resolution in expressions** (`let d: Direction = North`; OCaml's disambiguation) *(#763)*: declined for v1 — §3.2 states why; Pattern Matching §2.2 owns the pattern-side door, which rests on a guarantee expressions lack.
14. **The path-form import, `import Geo from "./geometry"`** — v1's own head, superseded *(#829)*. A path names a file, and a file is a container, not a module (§1); the head that names a module is `import Geometry as Geo` (§3.1). Kept out rather than kept beside the name form: two ways to address one module is the drift hazard §9.2 was right about, arriving from the other side. The head is refused with the rewrite (§3.1, §10), so the JavaScript author's habit — and the v1 corpus — lands on the form.
15. **Modules sharing a file see each other** (a file as an implicit scope): refused (§2.2). It would give the file a meaning — moving a module between files would change what compiles — and §1 removes the file's meaning on purpose. One line, `import Geometry`, says what the reader needs and costs what it says.
16. **Ranked or suffix-searched module resolution** — nearest package wins, or `import Geometry` reaching `Render.Geometry` by its last segment: refused (§2.3). Hexagon resolves a contested name by refusing it and naming the spellings (§5.5's rule and Constraints §5.1.1's law), never by ranking candidates or searching for one; the module namespace takes the same rule, with the one carve §5.4 already owns — the resolving package's own module over a package's, which is occlusion, not a rank between rivals.

---

## 10. Diagnostics checklist

| Situation | Error / hint |
|---|---|
| File with no `module Name` header | "every file declares its module; write `module SearchParams`" — the name derived from the basename, an applied fixit inserting the line (§2.1; the slot `module <Name>` where no uppercase-start identifier results) |
| A second `module` header while the module before it is open | "a file holding several modules closes each with `end module Geometry`" — applied fixit inserting the closer above the new header (§2.2) |
| `end module B` under `module A` | "`end module B` closes `module A`; write `end module A`" (§2.2) |
| Items after a closer that are not a header | "code outside a module: `end module Geometry` ended the module above; open another with `module Name`" (§2.2) |
| Items above the first header | "code outside a module: a module begins with its header; move `module Geometry` above this item" (§2.2) |
| A dotted module whose first segment names a package the declaring package sees (`module Acme.Geometry` under a dependency `Acme`; `module Hex.Util` anywhere; `module MyApp.X` inside `MyApp`) | at the header: "`Acme.Geometry` begins with the name of the package `Acme`; a dotted module's first segment cannot name a package in the program; rename the module" (§2.2; Packages §6) |
| A dotted module whose first segment names a package the declaring package does not see, met at the program (`Bolt` declares `module Acme.Tools`; the program holds `Acme` too) | at the whole-program check: "module `Acme.Tools` of package `Bolt` begins with the name of the package `Acme`, also in this program; drop the dependency that brings `Acme` or the one that brings `Bolt`, or combine them once `Acme` is renamed or `Bolt` renames its module" (§2.2; Packages §7) |
| Any whole-program variant naming a package that is not a direct entry of the project, or that several entries reach | the package carries its bringers after the phrase naming it — "of package `Bolt` (brought in by `Carbide`)", "the package `Acme`, also in this program (a direct dependency, and brought in by `Carbide`)", several joined with "and" — and the repairs are worded over the project's own entries, collapsing to one where one entry brings both (§2.2) |
| The same, the named package the project itself (`Bolt` declares `module MyApp.Tools` under a project named `MyApp`) | "module `MyApp.Tools` of package `Bolt` begins with the name of this project, `MyApp`; rename the project or drop its manifest `name`, drop the dependency that brings `Bolt`, or combine them once `Bolt` renames its module" (§2.2) |
| The same, the offending module the project's (`module Acme.Parser` in a project that reaches `Acme` only through `Bolt`) | "module `Acme.Parser` of the project begins with the name of the package `Acme`, also in this program (brought in by `Bolt`); rename the module, or drop the dependency that brings `Acme`" (§2.2) |
| A dotted import resolving to nothing whose first segment names an installed Hexagon package the resolving package does not list (`import Acme.Tools` where `Acme` is `Bolt`'s dependency, or installed and listed by nobody) | "`Acme` is not a dependency of this package; add `"Acme"` to `dependencies` in `hexagon.json`" — applied edit where the host can write the manifest; where a module of any package in the program, imported or not, is declared under that first segment, the unknown-module report fires instead and no edit is offered (§2.3; Packages §3.3, §3.4, §7) |
| A package qualifying its own module (`import MyApp.Geometry` inside `MyApp`) | unknown module — hint: "a package's own modules are imported by their declared names: `import Geometry`" (§2.3; Packages §3.3) |
| `module Name` or `end module Name`, the name uppercase-start, below the top level | "`module` and `end module` mark a module at a file's top level; a module cannot be declared or closed inside a block" (§2.2; Preamble §7.1's family) |
| Two modules of one name in one package (case-insensitively) | error at the second header: "module `Geometry` is declared twice: `render.hex` (line N) and `physics.hex` (line M)" — hint: "give one a dotted name, `module Render.Geometry`" — at a slot name, where no dotted name is lawful, the hint is "rename the module" instead (§2.1; §2.2) |
| Contested module name between packages | "`Geometry` is provided by `Acme` and `Hex`; write `import Acme.Geometry` or `import Hex.Geometry`" (§2.3; Packages §3.3) |
| Unknown module name | "no module `Geometry`" — near misses named, dotted modules ending in the written name included: "did you mean `Render.Geometry`?" (§2.3) |
| `export` below module level (a function-body binding; an inner `fun` block's member) | parse error: "`export` marks module-level declarations; a local binding cannot be exported" (§4.1, #700) |
| Import inside a function/block | "declarations live at module level" family (Preamble §7.1) |
| Importing an unexported name | "`helper` exists in module `Geometry` but is not exported" (or plain unknown-export + near-miss) |
| Import cycle | "import cycle: `A` → `B` → `A`"; hint: "mutually recursive declarations can share one module" |
| Two module aliases, same name | hard error at the second import line (§5.2) |
| The path form `import Geo from "./geometry"`, JavaScript's namespace head `import * as`, the named list `import { … }`, or the former head `import module` | parse error, Rewrite Rule: "Hexagon imports name modules: write `import Geometry as Geo`" for the path form (the module name derived from the specifier's basename, each separator-delimited segment upper-cased at its start and joined — `search-params` → `SearchParams`, or the slot `<Name>` where no uppercase-start identifier results; the written alias kept where it differs from the derived name, dropped where it does not); the named list's sentence ends "…and reach `area` as `Geometry.area`" (its first listed item); the glob head's rewrite keeps the alias it wrote and carries no item clause; the `module` head's rewrite drops the word and the path (§3.1, #762, #829) |
| Non-uppercase-start module alias (`import Geometry as geo`) | "a module alias is uppercase-start; write `import Geometry as Geo`" (§3.1) |
| A module name in an import head with a segment that is not uppercase-start (`import geometry`, `import Render.geometry`, `import geometry as Geo`) | parse error at the head, before resolution, Rewrite Rule: "a module name is uppercase-start; write `import Geometry`" — each dot-separated segment upper-cased at its start, the dots kept (`import Render.Geometry`); the written alias kept (`import Geometry as Geo`); the slot `import <Name>` (`import <Name> as Geo`) where upper-casing yields no lawful module name, every segment having to be uppercase-start; `import geometry as geo` draws this one report with both seats corrected, "write `import Geometry as Geo`"; the refused head binds no alias (§5.2) (§2.1, §3.1) |
| `module geometry` at the head of a top-level item — no header by the contextual-word rule, no lawful item either | parse error, Rewrite Rule: "a module name is uppercase-start; write `module Geometry`" — segments and slot as the import row; the reading recovers under the rewrite's name (the written spelling at the slot), a declaration for every rule that reads one — §2.2's, all of them, §2.3's, and every later stage's — nothing suppressed: no headerless report; §2.2's reports fire against `Geometry` as at any header, each with its own repair, a report the recovered name itself draws (duplicate, first segment: `module hex.util` → `Hex.Util`, refused) standing beside the casing one; an importer resolves to it (none can at the slot); the closer is never a casing seat; below the top level the line is the ordinary parse error (§2.1) |
| Bare constructor in an expression, neither in scope nor the alias's own spelling (`Circle(1.0)` under `import Shape`) | the unknown-name error carrying the qualified spelling where exactly one visible alias's module exports the constructor, in the program's own words: "no bare `Circle`; write `Shape.Circle(1.0)`" — several exporters name each; none, the plain unknown-name report (§3.2, §5.1 rule 3; #763) |
| Module alias used as a value | "modules are not values" |
| Module alias in type or constraint position, nothing answering (§5.1 rule 2 — the same-spelled export resolves via the companion fallback instead of erroring; the boundary spellings take the boundary fallback after it, where it reaches) | "`P` is a module alias, not a type; write `P.Point` for the type it exports, name it bare with `type Point = P.Point`, or realias as `import Point`" — the exported inventory drives which repairs are named |
| `Name.` where `Name` is a type, not a module | "`Shape` is a type, not a module; `import Geometry` and qualify through it" — the type's home named, the applied edit carried (§5.1) |
| Bare reference to a prelude function outside the bare set (§5.5, #742) | at a call, the routes are spelled with **the call's own arguments** — for `map(things, f)`: ``no bare `map`; write `things.map(f)`, `Seq.map(things, f)`, or `Stream.map(things, f)` `` — the dot form first where the function is dot-callable (its first parameter is its module's own type, Method Syntax §4.2), then **every** visible exporter's qualified spelling, in prelude order, single-homed (for `isNan(reading)`: ``no bare `isNan`; write `reading.isNan()` or `Float.isNan(reading)` ``) and multi-homed alike, with no elision; a function that is not dot-callable names the qualified spellings alone (for `fromSeq(pairs)` — first parameter `Seq`-headed, and `Seq.hex` exports no `fromSeq`: ``no bare `fromSeq`; write `String.fromSeq(pairs)`, `Vector.fromSeq(pairs)`, `Map.fromSeq(pairs)`, `Set.fromSeq(pairs)`, `Stream.fromSeq(pairs)`, `JsMap.fromSeq(pairs)`, or `JsSet.fromSeq(pairs)` ``); at a reference that is not a call, the qualified names alone (``no bare `empty`; write `Seq.empty`, `Vector.empty`, `Map.empty`, or `Set.empty` ``); the message invents no identifier the program does not contain, and never names an import route; a receiver the grammar would misread is parenthesised (for `div(-7, 2)`: ``no bare `div`; write `(-7).div(2)` or `Integral.div(-7, 2)` ``) |
| Bare reference to a prelude constraint member outside the bare set (§5.5) | ``no bare `compare`; write `a.compare(b)` or `Ord.compare(a, b)` `` — the dot form where subject-first, the declaring module always |
| Bare reference to a qualified-only prelude constructor, in an expression or a pattern (§5.5) | ``no bare `Less`; write `Ordering.Less` `` — the qualified spelling, one shape for both positions |
| Bare reference to a collided name in the bare set (§5.5) | ``the prelude name `X` is ambiguous: exported by `A` and `B`; write `A.X` or `B.X` `` — vacuous in the shipped inventory (exception names unique; the `show` seat is identity-keyed, so no second member ever enters bare scope), kept for the set |
| Function-local sequential binder reusing a module-layer or local name | existing Statements §5.1 error, unchanged — the prelude layer is exempt (§5.4) |
| Use of a prelude name above the binder, declaration, or import that shadows or occludes it — bare constructor patterns included | whatever the same shape draws at a user-written name (§5.4 reservation): the Functions §7.2 declared-later error, with each shape's own fixit — "move the union's declaration above this use" in pattern position, "move the import above this use" above an import — never the prelude's meaning |
| Qualified term reference above the import that binds its alias | "`Geo` is declared later in this block; declarations are read top-down — move the import above this use" (§3; Functions §7.2) |
| `export honor` | "instances are always visible; `export` does not apply" |
| `export default` | "Hexagon has named exports only" |
| Exported value without an annotation | "exported value `answer` requires a type annotation" |
| Exported function with missing parameter/result annotations | "exported function `f` requires a complete signature; add …" |
| Exported function with inferred but unwritten constraints | "exported function `f` must declare every constraint in its signature; write `<a: C>`" — each constraint spelled per §4.1.1's advised-spelling paragraph (#715, #716): one the module cannot spell takes the derived-alias qualified form with the route clause appended — "write `<a: (Ord, Lib.Heft)>` — `Heft` is declared in module `Lib`, and this module binds another `Heft`; `import Lib` and spell it `Lib.Heft`" — the route clause rendering the pastable import (Pattern Matching §7.3) — and a same-spelled pair routes each member the module cannot already spell, one clause per declaring module |
| Exported function requiring a constraint with no spelling and no route (the §4.3 gate; §6.5's private base) | no rewrite advised — Constraints §5.1.1's fourth tier (#715, #716): "exported function `g` requires the constraint `Gate`, declared in module `Lib` and not exported; a complete signature cannot be written here — use the constrained operation at a concrete type, keep `g` private, or export `Gate` from `Lib`" — the first exit names no call: no fact the checker holds attributes the demand to one, and a worked attribution that can name the wrong call is the Rewrite Rule's own failure |
| Exported function restating an entailed base constraint | "exported function `f` must omit base constraint `Base` from `a`; `C` already provides it" |
| `export opaque` | parse error, Rewrite Rule: "`opaque` already exports the type name; write `opaque record Point = …`" — the rewrite is required, not advisory, and echoes the user's own declaration (`opaque union Handle = …` at a union head). This row presupposes a lawful subject: a crossed head whose subject is unlawful (`export opaque let x = 1`) draws the subject's own redirect below instead — the pair's rewrite would still be ill-formed, and the subject is the fault (ruled on #590) (§4.2) |
| `opaque` on `type` | "aliases are transparent; make it a `record` or single-constructor `union`" |
| `opaque` on `let`/`fun`/`constraint`/`exception`/`pattern` | parse error: "`opaque` applies to `record` and `union` declarations" |
| `export pattern rgb = Color.rgb` | "an exported alias is a re-export; re-exports are deferred" (§12.2; Pattern Declarations §3.4) |
| `export pattern` without a head | "an exported pattern writes its head: `pattern rat(top: BigInt, bottom: BigInt): Rat`" — component names from `build`'s delegate where there is one, `c1 … cn` otherwise (§4.1.1; Pattern Declarations §2.3) |
| Opaque field access / construction outside home module | "`Point` is opaque outside module `Point`; use its exported functions" — a constructor *pattern* abroad takes Pattern Matching §2.4's destructure sentence instead |
| Private nominal type in exported face | "exported binding `parse` exposes private type `Token`; export the type, perhaps opaquely, or keep the binding private" — one family, the carrier's noun in both seats; a type carrier reports at the mention's seat, a binding at the binding, a constraint member at the member's signature, each with a label at the private type's declaration (§4.3) |
| Cross-module duplicate instance | "duplicate instance of `Ord<String>`: declared in module `A` and in module `B`" — a secondary label at each declaration, rendered as file and line by the host (§7.3) |
| Rename of a name declared by a module the project does not hold — the standard library's, a dependency's, a nested workspace package's (LSP) | refused, the **declaring** module named by its full name (§2.3) and never its file: "`compare` is declared in module `Hex.Ord`, which this project does not own"; a module that merely mentions the name is never the one named (§1; Packages §2.5) |
| Workspace instance outside the current graph (LSP) | existing Constraints §8 error + hint: "its instance is in module `X`; `import X` brings it into the program" (§7.6, §3.3) |
| An effect import, `import "./x"` — any string after `import` | parse error naming the route: "Hexagon has no effect import; a module is imported for its names — `import X` — or run as a root" (§3.3) |
| Qualified use through an alias nothing binds, in any position — `Geometry.Point` in a type, `Rat.create` in a term, a pattern's `Shape.Circle(r)` | one report at every seat: "no module alias `Rat`; `import Rat`" — the applied fixit inserting the import from the compiler tier where exactly one visible module bears the name, the resolving package's own first (§2.3, §5.1); two visible packages bearing it → §2.3's contest refusal in place of the edit, its spellings named; none → the plain unknown-name report, no module invented (§3, §13(o)) |
| Repair-family refusal naming a module the checker has reached | the message + applied fixit inserting `import Scale` above the refused use, from the compiler tier (§5.1, #829); a spelling no reached module exports → the workspace tier names the candidates, several exporters draw no insert |
| Missing `C<T>` instance | names the legal homes (§7.6; two, or one if they coincide): "…could only be declared in module `Config` (declares `Config`) or in module `Ord`" — prelude- and compiler-supplied homes stated, never offered; structural subjects keep their own messages; unnameable constraint → the declaring module alone (§7.6's unnameable branch); derivable constraint at a project-source nominal → Constraints §8's derivation fixit appended, or replacing the clause at derivable-only `Hash`; a hand-written `Eq` there → the wrapper-key report (§7.6) |
| Uppercase-start name in a binder-pattern position matching an in-scope module alias | "`Json` is a module alias; module aliases are not binders — binders are non-uppercase-start; did you mean `json`?" (near-miss hint, same family as §5.1's type-not-module; Statements §9.2 origin) |
| Qualified access to a name that is no export, declared member, or honored member | the existing "module `X` does not export `Y`" — the two member reads (§5.3) happen before it, never after |
| `Alias.name` where the module honors one constraint at several of its own types | §5.5-family refusal naming each honored type and the three unambiguous routes: the dot call on a value, the bare member call, and the declaring module's qualified spelling (§5.3) |
| Declared variance the representation does not support | hard error at the declaration naming a **witness occurrence**: "`a` cannot be declared covariant in `Seq`: field `consume` uses `a` in argument position. Remove the `+`, or change the field" — plus a **required** secondary label at the witness occurrence's span (hosts render it as file:line; the location never appears in the message text) (§4.2.1, #205/#207, message form revised 2026-08-01) |

---

## 11. Emission

1. **One module → one ESM module, named by the module.** `export` → `export`; unexported bindings → plain `const`/`function`. Privacy is enforced by the Hexagon checker; the emitted JS simply doesn't export what wasn't exported. The emitted file's name is the module's declared name *(#829)*, its dotted segments as directories — `module Render.Geometry` emits `Render/Geometry.js` and `Render/Geometry.d.ts` under the program's output root — and a source file holding several modules emits several files; the source file's own name and place appear nowhere in the output. Two modules whose names differ only in case would collide on a case-insensitive filesystem, which is why §2.2 refuses them in one package; across packages the package's own directory separates them (Packages §6). Program-scoped artifacts — `hex.d.ts`, `hex.js` (FFI Part 1 §8.3, Part 7 §1.2) — sit at the output root, and their filename probe reads the emitted filenames (Part 1 §8.3, as respelled by #829). A foreign specifier in an `extern from` or `extern import` head is copied into the emitted file verbatim, a relative one included: it is JavaScript's own and resolves from the emitted file's place (FFI Part 4 §2.1), since the language re-bases no path and the source file's place appears nowhere in the output.
2. **Resolved names, either ESM shape.** Because module aliases are not values, every `Geo.area` resolves at compile time to a specific export, and the emitter may spell the dependency as JavaScript's own namespace import — `import * as Geo from "./Geometry.js"`, the shape the module form lowers to, its specifier the emitted path from the importing file to the imported one (the source carried no path; the emitter computes one from the two modules' names — a *foreign* specifier is the one kind it never computes, copying it verbatim — §11.1) (#569: the alias's emitted local yields to a same-spelled declaration on collision and takes the collision-only suffix, from `_1`) — or as named imports (`import { area } from "./Geometry.js"`); semantics are identical either way, both lines may stand for one specifier where distinct answers need them (the namespace for the alias's qualified uses, a named import for a specialization edition or other internal plumbing — FFI Part 8; the declaration side's "Imports are counted per answer, not per module", FFI Part 7 §2.4), and the source head (§3.1) never reaches emission. A constructor the source reaches **bare** through §5.1 rule 3's fallback erases where it is applied, as every direct construction does (Products §5.4; Unions §6.4), and where it is *referenced* as a value it is bound under a local of the emitter's choosing or spelled as the qualified access on the alias's local — never called or read as though the namespace object were the export. **The emitter may likewise add a named import a resolved companion dot call requires even when the source never textually imported the companion module** (Method Syntax §8.2) — the same liberty, exercised for calls the checker resolved; and the namespace import a door-resolved pattern's home requires, where the source never imported the home (Pattern Declarations §3.3, §6) — the same liberty again, for a pattern the checker resolved; emitted-name collisions are the emitter's ordinary renaming problem.
3. **Load order** is ESM's own, valid because the graph is acyclic (§8.1). An import whose alias the body never reaches still emits — as a bare `import "./Geometry.js"` or a namespace import, the emitter's choice — because the source wrote the dependency and its load order is §8.2's; that is the one place a bare import is ever emitted for a Hexagon module (an `extern import` head emits its own, FFI Part 4 §8.1), and no bare import is ever synthesized for a module the source did not import (the named import a companion dot call requires and the namespace import a door-resolved pattern's home requires, §11.2, are a different liberty).
4. **`.d.ts`:** exported terms and types appear; private ones don't — for a private type, no line of any kind, a non-exported `type` declaration included. §4.3's face rule is what makes that possible: no exported face can mention a private nominal, so no `.d.ts` row ever needs one declared. Private aliases in exported faces appear as their expansion (§4.3). An exported opaque record or union uses FFI Part 7 §5's brand-only face: one non-exported `unique symbol` per type, with no honest fields or constructors exposed — not an exception to the sentence above, since the brand line belongs to an *exported* type. The brand is TypeScript-only; runtime representation and identity are unchanged.
5. **Instances** remain global compiler-selected declarations and are never nameable from Hexagon. At the JavaScript boundary, every instance satisfying FFI Part 9 §5's public-evidence closure forces a stable module-level handle or factory export from the instance declaration's home module, with its `Constraint.Dictionary<a>` face in `.d.ts`; this capability exists independently of current consumption. Private instances remain plumbing. Fundamental specializations are dictionary-free (FFI Part 8).

---

## 12. Hanging questions (recorded, not decided)

1. **Package resolution** — **discharged (#829)**: the Packages spec owns what a package is, its manifest and distribution, the namespace its name supplies, the visible module set, and the staged distribution design; this spec's §2.3 states what an importer writes. The question's record: bare specifiers were reserved here from July 2026 for a path-free `import Geometry` the v1 head was designed to shrink to, and the shrink happened — with the head's path dropped rather than made optional (§9.14). Cross-package coherence via interface files is stage two of distribution, recorded and not designed (Packages §5.2).
2. **Re-exports** (a form re-exporting another module's export under this module's roof; no spelling is sketched, and any landed one carries no path — §3): deferred as *source syntax*; the facade-module pattern will eventually want it; declined for v1 to keep export = declaration prefix, one rule. (FFI facade emission that re-exports extern bindings — FFI Parts 4 §7 / 7 §1 — is emitter output shape and introduces **no** Hexagon re-export syntax.) A landed design also inherits §7.6's discoverability note.
3. **Elm-strict constructor/module-alias coexistence** — v2 candidate on field evidence (§5.2).
4. **Selective import of constraint members** — **discharged (#762)**: no import binds a name smaller than a module, so the question has no seat. The record stands: presumed never needed while the named import existed; the presumption survived its first concrete probe (#544), where a door-builder wanting the constraint bare without its members was declined because the module import already carried that shape at the cost of one qualification in the honor head; §5.1 rule 2's constraint fallback (#531) then retired that cost in the companion-named case; and #762 removed the form the question was about.
5. **Formatter policy for import placement/sorting** — out of spec scope, same parking spot as all lint policy.

---

## 13. Acceptance tests (golden: resolution, diagnostics, emitted JS)

```
-- (a) Privacy default
module Geometry
export fun area(r: Float): Float = 3.14159 * r * r
fun helper(x: Float): Float = x * x          -- private
end module Geometry

module Consumer
import Geometry as Geo
Geo.helper(2.0)                              -- ERROR: module Geometry does not export helper
import { area } from "./geometry"            -- ERROR (parse): Hexagon imports name modules;
                                             --   write import Geometry and reach area as
                                             --   Geometry.area

-- (b) The companion fallbacks, both namespaces (§5.1 rules 2 and 3)
-- module Point: export record Point = {x: Float, y: Float}
--               export fun area(p: Point): Float = p.x * p.y
import Point
let p = Point({x = 1.0, y = 2.0})            -- constructor: rule 3, through the alias
fun f(q: Point): Float = q.x                 -- type: rule 2; fields visible (not opaque)
let sum = match p
    Point({x, y}) => x + y                   -- constructor pattern: rule 3 again
let area = Point.area                        -- a bare name is a declaration (§3.2)

-- (c) Opaque is a black box outside home
-- module Point: opaque record Point = {x: Float, y: Float}
--               export fun make(x: Float, y: Float): Point = Point({x = x, y = y})
-- (the pre-#590 pair is refused with the required rewrite:)
-- export opaque record Point = ...           -- ERROR: opaque already exports the
--                                            --   type name; write opaque record
--                                            --   Point = ...
import Point
let p = Point.make(1.0, 2.0)                 -- OK
p.x                                          -- ERROR: Point is opaque outside module Point
match p                                      -- ERROR: cannot destructure opaque record Point;
    Point(r) => ...                          --   use an operation exported by its home module
                                             --   (Point exports no pattern; where a home does,
                                             --   the sentence names it: "match it with (x, y)point"
                                             --   — Pattern Declarations §3.3)

-- (d) Companion idiom: alias/type/constructor coexistence
import Point
fun norm(p: Point): Float = ...              -- type position: the type (§5.1 rule 2's companion fallback)
let q = Point.make(3.0, 4.0)                 -- Point. : the module

-- (e) Prelude shadowing: granted at every level, reserved block-wide
fun show(x: Config): String = "..."          -- OK: occludes prelude show, module-wide
fun f(c) =
    let show = 1                             -- ERROR: show is the module's now (§5.4 reverse)
    ...
fun g(c) =
    let nan = 0.0                            -- OK: shadows the prelude's nan (§5.4)
    nan
fun h(c) =
    let x = isFinite(c)                      -- ERROR: isFinite is declared later in
    let isFinite = c > 0.0                   --   this block (§5.4 reservation)
    x

-- (f) The one import collision: two aliases of one spelling
import Circle as Shape
import Rect as Shape                         -- ERROR: module alias Shape already bound
import Circle
import Rect                                  -- OK: each under its own name
let area = Circle.area                       -- OK; a second `let area` is the ordinary
                                             --   duplicate-declaration error, no import rule
import Render.Geometry
import Physics.Geometry                      -- ERROR: module alias Geometry already bound;
                                             --   write import Physics.Geometry as <Alias>

-- (g) Cycle
-- module A: import B
-- module B: import A                        -- ERROR: import cycle: A → B → A

-- (h) Private-in-public
union Token = Word(s: String) | Gap          -- private
export fun parse(s: String): Vector(Token) = ...
-- ERROR: exported binding parse exposes private type Token; export the
-- type, perhaps opaquely, or keep the binding private

export record Cursor = {at: Int, token: Token}
-- ERROR (at the field annotation): exported record Cursor exposes private
-- type Token; export the type, perhaps opaquely, or keep the record private

-- (i) Instance globality: the instance rides its home into the graph (§7.6)
-- module Config: export record Config = ...; honor Ord<Config> = ...
import Config                                -- the type's home is in the graph
let sorted = Vector.sort(configs)            -- OK: Ord<Config> found, nothing else imported
import "./config"                            -- ERROR (parse): Hexagon has no effect import;
                                             --   a module is imported for its names —
                                             --   import Config — or run as a root

-- (j) Cross-module duplicate instance
-- module A: honor Show<Weird> = ...         -- (module A declares Weird: home, legal)
-- module B: honor Show<Weird> = ...         -- ERROR at program check: duplicate
                                             -- instance of Show<Weird>: declared in
                                             -- module A and in module B (labels at both)
                                             -- (module B also violates the orphan rule)

-- (k) Emission: the module form lowers to JavaScript's namespace import
import Geometry as Geo
Geo.area(2.0)
-- emits: import * as Geo from "./Geometry.js";  Geo.area(2.0);
-- (the named shape — import { area } …; area(2.0) — is equally lawful, §11.2)
-- module Tag: export union Tag = Tag(n: Int) | Other
import Tag
let t = Tag(7)                               -- rule 3 (§5.1); the application erases (Unions §6.4)
-- emits: import * as Tag from "./Tag.js";  const t = {tag: "Tag", n: 7};
--   the import line stands for the dependency the source wrote (§11.3, §8.2's load
--   order), not for any name the emitted body reads; a bare `Tag(7)` call would
--   call the namespace object and is never emitted
let mk = Tag                                 -- referenced as a value: the function
-- emits: import * as Tag from "./Tag.js";  const mk = Tag.Tag;
-- the project's module Deep.Nested: extern from "./world.js" declaring runner, and runner reached
-- emits Deep/Nested.js with: import { runner } from "./world.js";   -- verbatim: it names
--   Deep/world.js beside the emitted file — a file Hexagon does not write (FFI Part 4 §2.1;
--   the shape is representative, §2.3 there — the specifier is the pin)
-- /src/app.hex, module Main: extern from "./util", and /src/util.hex exists
                                             -- ERROR: use import for Hexagon modules; extern from is
                                             --   for foreign JavaScript — the one reading, from the
                                             --   importing file's own directory (FFI Part 4 §2.1);
                                             --   "./util.js" beside it is legal, a foreign file

-- (l) Transparent representation reaches through an un-imported home (§4.2)
-- module Crate: export record Crate = {n: Float}
-- module Mid:   import Crate
--               export fun make(value: Float): Crate = Crate({n = value})   -- rules 2 and 3
import Mid                                   -- Crate never imported here, in any form
Mid.make(1.5).n                              -- OK: fields travel with the type
Mid.make(1.5).m                              -- ERROR: Crate has fields n, not m
                                             --   (known fields named — never empty)

-- (m) Constructors not spelled like their alias
-- module Shape: export union Shape = Circle(radius: Float) | Rect(width: Float, height: Float)
import Shape
let bad = Circle(1.0)                        -- ERROR: no bare Circle; write Shape.Circle(1.0)
let c = Shape.Circle(1.0)                    -- OK
fun describe(s: Shape): String =             -- type: rule 2
    match s
        Circle(r) => "circle"                -- OK: Pattern Matching §2.2's door, the
        Rect(w, h) => "rect"                 --   scrutinee's type supplying the constructors
fun isRound(s: Shape): Bool =
    match s
        Shape.Circle(_) => True              -- the qualified pattern, unchanged
        _ => False

-- (n) The old heads and the miscased ones, refused with the rewrite
import Geo from "./geometry"                 -- ERROR (parse): Hexagon imports name modules;
                                             --   write import Geometry as Geo
import Geometry from "./geometry"            -- ERROR (parse): … write import Geometry
import module Geo from "./geometry"          -- ERROR (parse): … write import Geometry as Geo
import * as Geo from "./geometry"            -- ERROR (parse): same rewrite, the written alias
                                             --   kept; no item clause
import { area } from "./geometry"            -- ERROR (parse): … write import Geometry
                                             --   and reach area as Geometry.area
import Geometry as geo                       -- ERROR: a module alias is uppercase-start
import geometry                              -- ERROR (parse): a module name is uppercase-start;
                                             --   write import Geometry
import render.geometry                       -- ERROR (parse): … write import Render.Geometry
import Render.geometry                       -- ERROR (parse): … write import Render.Geometry
import geometry as Geo                       -- ERROR (parse): … write import Geometry as Geo
import geometry as geo                       -- ERROR (parse): … write import Geometry as Geo
import 用户 as Geo                             -- ERROR (parse): … write import <Name> as Geo
import _internal.util                        -- ERROR (parse): … write import <Name> — no lawful
                                             --   name results, so the slot, never _internal.Util

-- (o) Headers and closers (§2.1, §2.2)
-- search-params.hex, no header:
export fun parse(s: String): Vector(String) = ...
-- ERROR: every file declares its module; write module SearchParams (fixit inserts it)

module Geometry
export record Point = {x: Float, y: Float}
module Shapes                                -- ERROR: a file holding several modules closes
                                             --   each with end module Geometry (fixit
                                             --   inserts the closer above this line)

module Geometry
export record Point = {x: Float, y: Float}
end module Shapes                            -- ERROR: end module Shapes closes module
                                             --   Geometry; write end module Geometry

module Geometry
export record Point = {x: Float, y: Float}
end module Geometry
let stray = 1                                -- ERROR: code outside a module

module Geometry
export record Point = {x: Float, y: Float}
end module Geometry                          -- OK: the closer, optional in a one-module file,
                                             --   is legal there too

-- geometry.hex, header miscased:
module geometry                              -- ERROR (parse): a module name is uppercase-start;
                                             --   write module Geometry; the file is then read under
                                             --   Geometry, so no headerless report follows
export record Point = {x: Float, y: Float}
end module geometry                          -- ERROR: end module geometry closes module Geometry;
                                             --   write end module Geometry (§2.2's rule, unchanged)

-- util.hex:
module hex.util                              -- ERROR (parse): a module name is uppercase-start;
                                             --   write module Hex.Util
                                             -- ERROR: Hex.Util begins with the name of the package
                                             --   Hex; a dotted module's first segment cannot name a
                                             --   package in the program; rename the module
                                             --   (two reports at one line; the rename repairs)

-- a.hex:
module 用户                                    -- ERROR (parse): a module name is uppercase-start;
                                             --   write module <Name>
-- b.hex:
module 用户                                    -- ERROR (parse): a module name is uppercase-start;
                                             --   write module <Name>
                                             -- ERROR: module 用户 is declared twice: a.hex (line 1)
                                             --   and b.hex (line 1); rename the module (the recovered
                                             --   names collide; no dotted hint, none being lawful)

-- internal.hex:
module _internal.util                        -- ERROR (parse): a module name is uppercase-start;
                                             --   write module <Name> — the slot, never _internal.Util;
                                             --   the reading recovers under _internal.util

-- (a second file, two modules:)
module Geometry
export record Point = {x: Float, y: Float}
end module Geometry                          -- required: a second module follows (§2.2)
module Shapes
export fun unit(): Geometry.Point = ...      -- ERROR: no module alias Geometry; import Geometry
                                             --   (strangers, §2.2 — sharing a file binds nothing)
export let a: Float = Geometry.area(1.0)     -- ERROR: no module alias Geometry; import Geometry
                                             --   (the same report in term position; the applied
                                             --   edit inserts import Geometry above, §5.1)
-- (a third file, in a project depending on Acme:)
module Acme.Geometry                         -- ERROR: Acme.Geometry begins with the name of the
                                             --   package Acme; a dotted module's first segment
                                             --   cannot name a package in the program; rename the
                                             --   module (§2.2)
-- (a fourth file:)
module Json                                  -- OK beside a dependency Json: undotted (§2.2)
fun f() =
    module Inner                             -- ERROR: module and end module mark a module at a
                                             --   file's top level; a module cannot be declared
                                             --   or closed inside a block

-- (p) Names, and what an importer may omit (§2.3)
-- project: module Render.Geometry; module Physics.Geometry; package Acme: module Geometry
import Geometry                              -- OK: Acme.Geometry — the project has no module
                                             --   named exactly Geometry, and one package does
import Render.Geometry                       -- ERROR: module alias Geometry already bound —
                                             --   the default alias is the last segment; write `as`
-- project: module Geometry; package Acme: module Geometry
import Geometry                              -- OK: the project's own (§2.3), silently
import Acme.Geometry as AcmeGeo              -- OK: the package's, by its full name
-- project: none; packages Acme and Hex: module Geometry each
import Geometry                              -- ERROR: Geometry is provided by Acme and Hex;
                                             --   write import Acme.Geometry or import Hex.Geometry
import Hex.Option as Opt                     -- OK: a second alias onto a prelude module
-- project depending on Acme (module Tools) and Bolt (module Acme.Tools; Bolt lists no Acme):
                                             -- ERROR at program check: module Acme.Tools of package
                                             --   Bolt begins with the name of the package Acme, also
                                             --   in this program; drop the dependency that brings Acme
                                             --   or the one that brings Bolt, or combine them once
                                             --   Acme is renamed or Bolt renames its module (§2.2)
-- project depending on Bolt alone:
import Acme.Tools                            -- OK: Bolt's module, by its declared name — no package
                                             --   Acme is in the program, so the spelling has one
                                             --   reading (§2.3); binds Tools
import Bolt.Acme.Tools as BoltTools          -- OK: the full name; `as` because the default alias
                                             --   Tools is bound above (§5.2)
-- project named MyApp, module Geometry:
import MyApp.Geometry                        -- ERROR: no module MyApp.Geometry; a package's own
                                             --   modules are imported by their declared names:
                                             --   import Geometry
```

---

## 14. Decisions log

| Decision | Where |
|---|---|
| **A module is a named declaration; a file is a container** (#829): `module Geometry` header line, body unindented; every file declares a module (headerless refused with the derived-name fixit); several modules per file, `end module Name` required between them and optional for a lone module; sibling modules are strangers; dotted names; two of one name in a package refused (case-insensitively); the path means nothing to the language | §1, §2 |
| **Only the package segment is omittable** (#829): `import Geometry` resolves among visible modules declared exactly `Geometry`, never a dotted module by its suffix; the resolving package's own module wins silently over a package's (occlusion, §5.4 one level up); a dotted spelling has one reading — a visible package's module where its first segment names one, a declared name otherwise — because no module's dotted name begins with a package in the program (§2.2); a package never qualifies its own modules; a name two packages provide is refused naming each full spelling (§5.5 one level up); `Hex` is the standard library's package | §2.3; Packages §3 |
| **A dotted module's first segment never names a package in the program** (#829): two seats — the header where the declaring package sees the package, the whole-program check over every module of every package in the program, imported or not, where it does not — and three report variants (a dependency's module against a package; the project's module against a transitively reached package; a dependency's module against the project's own name), each rendered over the project's own `dependencies` entries; a dotted spelling therefore has one reading | §2.2, §2.3, §10 |
| **Rejected alternative §9.2 reversed** (#829), with the record of why: both substantive grounds assumed a header beside a path, and the design has no path | §9.2 |
| **Bare seeding is by channel; the bare set is closed at sixteen names** (#742): no prelude function bare but `ignore`; union constructors qualified-only but the open unions `Bool`/`Option`/`Result`; exception constructors bare as a category (the `…Error` suffix is the qualifier); constraint members qualified-only but `show`; `Ordering` homed at `Ordering.hex` so `Ordering.Less` is spellable; one refusal shape naming dot and qualified routes, never an import; selection test = idiomatic bare ∧ not a user word; additions are rulings, never listing entries | §5.5, §10 |
| Structural types have no home module; their instances are compiler-derived only | §2; Constraints §9.3 |
| **An `import` names a module and binds it, and nothing smaller** (#762, #829 — superseding #565's `import module` head and v1's path form `import Geo from "./geometry"`): `import Geometry`, `import Geometry as Geo`, `import Acme.Geometry as AcmeGeo` — no path, no `from`; the default alias is the name's last segment; the alias uppercase-start and no value; no effect import — a module is imported for its names, never loaded for its effects; no named or aliased items; every old head refused with a rewrite deriving the module name from the specifier; a bare name in the importer is a declaration (`let`, `type`), a companion fallback, or a pattern the pattern namespace holds (Pattern Declarations §3.3) | §3, §9.11–§9.16 |
| **Companion fallback in term position** (#763): bare `Name` with an empty term namespace resolves to the constructor `Name` a same-spelled visible alias's module exports — expression and pattern alike, answering only where resolution failed; the pattern-position door for every other constructor is Pattern Matching §2.2's | §5.1 rule 3, §3.2 |
| Module aliases: uppercase, not values; qualified access in term, type, constraint, and pattern position | §3.1 |
| A qualified use through an alias nothing binds draws one report in every position, "no module alias `X`; `import X`", with the compiler-tier applied edit where one visible module bears the name | §10, §13(o) |
| Module names uppercase-start as types and constraints are; a miscased import head or header refused at parse with the segment-wise rewrite (the import head keeping its alias), the slot where upper-casing yields no lawful module name, the reading recovering under the rewrite's name (the written spelling at the slot) as a declaration for every rule that reads one, a §2.2 report the recovered name itself draws standing beside the casing one — the casing rewrite one repair of two, and where the recovered name is itself refused, the rename superseding it, the closer left to §2.2's naming rule; an LSP rename of a name a module outside the project declares refused naming the declaring module | §1, §2.1, §3.1, §10 |
| `export` = declaration prefix exporting everything introduced; no default exports; no re-exports (v1) | §4.1 |
| Exported terms require complete annotations; constrained functions explicitly list maximal constraints and omit entailed bases; private module-level function guidance remains style | §4.1.1 |
| An exported `fun`-block member's binders are the block head's; the completeness advice on a knot member names the block-head spelling (#700) | §4.1.1 |
| The completeness advice spells each required constraint by its own declaration — module-routed where the module has no spelling, a contested group's unspellable members routed uniformly, no rewrite where no route exists (#715, #716) | §4.1.1; Constraints §5.1.1 |
| One head visibility slot, three values — absent / `export` / `opaque`; `export opaque` refused with the required rewrite (#590). `opaque` on `record`/`union`: type name only; fields/constructors/matching private outside home; derives unaffected; home module unaffected | §4, §4.2 |
| Transparent representation visibility travels with the type (sole-authority rule): field access, update, and the bare copy are import-insensitive; imports carry names (constructor and its pattern included); no intermediary or per-signature re-abstraction | §4.2 |
| Private-in-public: hard error for the module's **own** nominal types at every exported face — `export`ed binding signatures, alias targets, record fields, union and exception payloads, an exported pattern's head (subject and component types), constraint member signatures, never an `opaque` declaration's interior, never an elsewhere-declared type — reported once per type per carrier; a type carrier at the mention's seat, a binding at the binding, a constraint member at the member, a label at the private type's declaration; transparent aliases exempt (expansion used, and a private expansion refused the same); a private constraint *gating* an export is lawful (the sealing idiom — the gate, not the cargo) | §4.3 |
| Fourth namespace (module aliases); position-based resolution; `Name.` checks modules first; a fifth, patterns, read at the suffix seat alone (Pattern Declarations §3.3) | §5.1 |
| Collisions: duplicate module aliases error; alias-vs-type/constructor legal (companion idiom blessed); no import-item collisions exist (#762); Elm-strict restriction = v2 candidate | §5.2, §12.3 |
| A constraint is reached through its module's alias in every position — binder, `honor` head, member term — and is never imported by name (#762); members never rename at the border and are reached qualified or by the dot | §3.1, §3.2, §5.1 |
| An exported constraint crosses as a reference to its declaration (identity: Constraints §5.1.1); members cross as terms; instance globality and the orphan rule's home module (the module whose text contains the declaration) unchanged | §6.5 |
| Prelude shadowing: sequential binders, imports, and declarations — constructor names included — may shadow the prelude layer at every level, name reserved for the whole enclosing scope (references resolve as if the prelude did not bind it, patterns included); the module's own layers stay under the full ban; Head Binder rule untouched in statement | §5.4 |
| Prelude = ordered set of ordinary `.hex` modules; each sees only earlier members; no `import` lines in prelude source (the header-comment convention that accompanied that rule is **withdrawn 2026-08-01**); type-declaring members ordinary; compiler resolution never outranks declarations (boundary intrinsics = fallback only) | §5.5 |
| Every prelude name must have a qualified home (stdlib invariant, pre-registered) | §6.4 |
| Instances never exported/imported/hidden; home module = the module whose text contains the declaration (a file's second module is another home); cross-module duplicates reported at whole-program check naming both modules with labels at both sites; instances on private types legal; whole-program coherence holds across packages because packages ship source, the compiled-distribution cost deferred to stage two (Packages §5) | §7 |
| Discoverability: ordinary `C<T>` use brings both legal homes into the graph; residue = inferred-never-named types and isolated-file checking; missing-instance diagnostics name the legal homes, offering only the writable ones, and name the declaring module alone for an unnameable constraint; derivation fixit appended for derivable constraints at project-source nominals, replacing the clause at derivable-only `Hash` (wrapper-key route where a hand-written `Eq` bars derivation); pre-1.0 LSP names the activating module import; no loading form exists (§3.3); re-exports would widen the residue, packages do not — they ship source (§7.5) | §7.6 |
| Companion dispatch targets the nominal type's home module (idiom load-bearing); emitter may add companion-call named imports; a fallback-reached constructor is never called or read as though the namespace object were the export | §5.3, §11.2 |
| Imports acyclic, hard error, incl. type-only; deterministic depth-first load order; top-level `Unit` effects legal; selected root module runs through ordinary ESM evaluation; no special `main` | §8 |
| ML calculus, export lists, `(..)` sugar, default exports, single-namespace, F# priority stack, unified paths, cycles: rejected with reasons; the header rejection reversed (#829, §9.2); the path-form import, sibling-file scope, and ranked resolution rejected | §9 |
| Emission: 1:1 ESM, the emitted file named by the module (dotted segments as directories) under the output root, a source file's name appearing nowhere (#829); the module form lowers to the namespace import or named imports, one meaning, the specifier computed from the two module names — a foreign specifier, relative ones included, the one kind never computed: emitted verbatim, resolving from the emitted file's place and never the source file's (FFI Part 4 §2.1); the alias's local yields to a same-spelled declaration on collision (#569); exported opaque types use FFI Part 7's private-symbol branded `.d.ts` face | §11 |
| Hanging questions: package resolution discharged to the Packages spec (#829); re-exports, Elm-strict coexistence, formatter policy remain; selective member import discharged (#762) | §12 |
| Intrinsic linkage is a declaration (`extern from "hex:intrinsic"`), never a third resolution meaning; companion idiom retained under widened #125 scope; public-name and primitive doors deprecated per-companion | §5.3 note; `spec/intrinsics.md` |
| Variance claims on parameterized opaque exports: `+a`/`-a` declared, bare = invariant (the empty claim); verified in the home module against the representation; over-claim errors at the declaration with a witness occurrence; claims read uniformly, home module included; what crosses an opaque boundary is declared, never inferred (#205) | §4.2.1; closure doc `decisions-ml-dialect-generalization-2026-08.md` §6 |
| Over-claim witness location: carried by a required secondary diagnostic label at the witness occurrence's span, never by file:line text in the message; the message names the field and the position (2026-08-01, #205/#207) | §4.2.1, §10; closure doc §13.1 |
| Qualified access reaches honored members (#304/#335, uniform access principle): resolution order exports → declared-constraint members → members honored at the module's own type; several-own-types → §5.5-family refusal naming the three routes; member binding qualifiable but never a bare export (one-exporter law); the wired-primitive transitional route served until the companion arc completed *(discharged with the last landing, #344 — see the row below)* | §5.3, §10; Constraints §4.6 |
| **A fixed prelude companion's "own type" is its primitive** (#344): qualified access reaches instances honored at the companioned primitive (`BigInt.gcd` = `Integral<BigInt>`'s member); the transitional wired route died per companion in the fixed order and is **gone** — all five companions are source (`BigInt`, `Int`, `Nat`, `Float`, `String`, #344) | §5.3; Constraints §5.3 |
