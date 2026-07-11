# Hexagon Spec: Modules

**Status:** Decided (July 2026) — with a **hanging-questions** section (§12); nothing there blocks implementation of §1–§11.
**Scope:** Module identity (one module per file, no module header), the `import` declaration (named, aliased, namespace forms), the `export` modifier and `export opaque`, privacy defaults, the module-alias namespace and position-based resolution, the prelude occlusion rule (retiring the Statements §10.2 interim rule), import-collision rules, the acyclic-import rule and load order, top-level effects, instance globality and the orphan rule's operational definition of "home module," the private-in-public rule, generalisation at module level (restated), ESM emission, and edit notes to existing specs.
**Not in scope:** the `.d.ts` representation of `opaque` types (FFI spec — flagged §11.3), package/bare-specifier resolution (§12.1), re-exports (§12.2), CLI root-selection and project-configuration syntax (compiler architecture; §8.3 fixes the language-level absence of a special entry point), the prelude's inventory (stdlib listing — one constraint pre-registered here, §6.4), abstraction pedagogy (owed to a future session by agreement).
**Companions:** Constraints spec (§5.1 duplicate reporting point and §5.3 orphan rule — both discharged here; §9.3 presumption — confirmed here), Statements/Blocks/Mutability spec (§5.2/§10.2 prelude-collision question — closed here; §6 `var` confinement — restated as module doctrine here), Declarations Preamble (§7 module-level declaration inventory; §10.9 owed items — discharged here), Unions §2 (constructor qualification — discharged here), Functions §8 / Type System Overview §2.2 (generalisation at module export — anchored here), Operators §14 (`.` as module-path separator — semantics fixed here), Lexer & Layout (module top level is a block — unchanged, consumed here).

Written for a future implementation session against the existing `hexc` architecture: Algorithm J, union-find tyvars, level-based generalisation, constraints as dictionaries, layout pass, readable-JS emission with `.d.ts`.

---

## 1. Doctrine

- **A module is a file; a file is a module.** There is no `module` header declaration and no in-file submodule. A module's identity is its path; its name, where one is needed, is chosen by the *importer* (namespace alias, §3.3). One compilation unit per file, mirroring ESM exactly.
- **Everything is private unless exported.** `export` is a declaration prefix, JS-style. An unexported binding is invisible outside its file — not "discouraged," invisible: no qualified access, no reflection, no back door.
- **Modules are fences, not forges.** Modules control *name visibility only*. They do not create type identity — that is the declaration site's job (`record`/`union`, Declarations Preamble). A nominal type is the same type through every import path and alias; structural types belong to no module at all. There are no functors, no signatures, no first-class modules (§9.1 records the rejection).
- **A module cannot contain, export, or close over mutable state** — in pure Hexagon. This is not a new rule but the module-level face of three existing ones: `var` is function-body-only (Statements §6.1), there are no ref cells (§6.4), and no lambda captures a `var` (§6.2). The only module-level state is immutable `let` bindings evaluated once at load. `export` exposes values and names, never cells. (An `extern` JS module can of course hide mutation behind a function; that lives at the FFI boundary and is that spec's problem.)
- **Instances are global and unfenced.** `implement` ignores the export system entirely: an instance is visible program-wide the moment its module is in the import graph — never imported, never exported, never hidden (Constraints §5.3, preserved as demanded). Coherence is checked over the whole graph (§7).
- **Imports are acyclic, hard error.** No import cycles, ever (§8.1). This buys a deterministic topological load order, keeps the emitted ESM out of JS's cycle semantics (temporal dead zones), and matches the F# lineage.
- **JS-verbatim syntax; ESM-identity emission.** The import/export surface is deliberately JavaScript's own, and one Hexagon module emits as one ESM module with `export` mapping to `export`. Readable-JS emission is, for this feature, the identity function — the strongest argument for the design and the reason every syntax deviation was declined.

---

## 2. Module identity

- **One module per file.** File extension `.hex`. The module top level is a block (Lexer & Layout) exempt from the final-expression rule (Statements §3.1); its items are the module-level declarations (Declarations Preamble §7.1), `let`/`fun` bindings, and `Unit`-typed effect expressions (§8.2).
- **No module header.** `module Geometry` does not exist and is a parse error pointing here. A file does not know or declare its own name; naming is the importer's act. Rationale: the header is pure ceremony under one-module-per-file (the information is the path), it creates a name-vs-path drift hazard (Haskell's directory-mirroring rules exist to police exactly this), and JS-verbatim declines it anyway.
- **Module paths are string literals, relative form:** `"./geometry"`, `"../shared/util"` — extension omitted, resolved against the importing file. Bare specifiers (`"stdlib/json"`-style package paths) are reserved and currently a compile error ("package imports are not yet supported"); resolution policy is a hanging question (§12.1).
- **Nominal identity is declaration-site identity.** `Point` declared in `geometry.hex` is one type constructor everywhere it flows, under any alias. Two files each declaring `record Point` produce two unrelated types; the Declarations Preamble §7.3 duplicate rule remains per-module. Structural records and tuples are the same type in every module, need no export, cannot be hidden, and their instances remain exclusively compiler-derived — the Constraints §9.3 presumption is hereby **confirmed as decided**: "which module owns `{x: Float}`" has no answer because structural types have no home module, and nothing needs one.

---

## 3. `import`

```
import { area, perimeter } from "./geometry"
import { area as circleArea } from "./circle"
import * as Geo from "./geometry"
import "./sideEffects"
```

Imports are module-level declarations; an `import` inside a function body joins the Declarations Preamble §7.1 error family. Placement within the file is free (order-insensitivity, Preamble §7.2), though the formatter will float them to the top.

### 3.1 Named imports

`import { name, ... } from "path"` binds each listed name in the importing module. An import item names an **export**, and imports it **across every namespace it is exported in**:

- `import { Point }` where `Point` is an exported `record` binds `Point` the type *and* `Point` the constructor — one item, two namespaces, matching how the declaration introduced them.
- `import { Shape }` where `Shape` is a union binds the **type only**. Constructors are separate exports with their own names: `import { Shape, Circle, Rect }`. There is no Haskell-style `Shape(..)` sugar — JS-verbatim has no such form, and the namespace import (§3.3) covers "give me everything" (rejected alternative recorded §9.4).
- `import { Ord }` where `Ord` is a constraint binds the constraint name **and its members** (`compare`) — the members are the constraint's API and arrive with it, consistent with their module-scope-term status (Constraints §2.2). Members cannot be imported severally (§12.4 records the question; presumption: never needed).
- Importing a name the module does not export: hard error, with a near-miss suggestion and a note if the name exists unexported ("`helper` exists in `./geometry` but is not exported").

### 3.2 Aliased imports

`import { area as circleArea }` binds only the alias. The alias obeys the ordinary case rules for what it names (a term import must alias to lowercase-initial, a type/constructor to uppercase-initial; violating this is a parse-adjacent error, "alias case must match what it names"). Aliasing a record's name splits nothing: `import { Point as P }` binds `P` in both namespaces.

### 3.3 Namespace imports

`import * as Geo from "./geometry"` binds the single name `Geo` as a **module alias** giving qualified access to every export: `Geo.area(...)`, and in type position `Geo.Point`, `xs: List(Geo.Shape)`. Constructors qualify the same way (`Geo.Circle(1.0)`), including in patterns (`match s` / `Geo.Circle(r) => ...`) — this discharges the Unions §2 qualification flag. Module aliases are uppercase-initial, mandatorily.

**Module aliases are not values.** `let m = Geo` is an error: "modules are not values." No passing, no returning, no storing. This is what keeps the namespace story (§5) honest and forecloses first-class modules by construction.

### 3.4 Effect imports

`import "./telemetry"` imports nothing and loads the module for its top-level effects and (more importantly) its **instances** — the idiom for pulling a module into the graph so its `implement` declarations exist (§7). Rare by design; the diagnostic for an unsatisfied constraint whose instance lives in an unimported module should suggest it (§10).

---

## 4. `export` and `export opaque`

### 4.1 `export`

`export` prefixes a module-level declaration and exports **everything that declaration introduces**:

| Declaration | Exports |
|---|---|
| `export let x = ...` / `export fun f(...) = ...` | the term |
| `export record Point = {...}` | `Point` the type **and** `Point` the constructor (fields come with the constructor: construction, `p.x`, patterns, update) |
| `export union Shape = Circle(...) \| ...` | `Shape` the type **and** every constructor |
| `export type UserName = String` | the alias name |
| `export constraint Ord<a: Eq> = ...` | the constraint name **and** its members |
| `export exception ParseError(...)` | the exception constructor |
| `export implement ...` | **hard error** — "implementations are always visible; `export` does not apply" (§7) |
| `export import ...` | **hard error** — re-exports deferred (§12.2) |

There are **no default exports**. `export default` is a parse error ("Hexagon has named exports only"). Rejected with reasons §9.5.

### 4.2 `export opaque`

```
export opaque record Point = {x: Float, y: Float}
export opaque union Handle = FileHandle(fd: Int) | NetHandle(sock: Int)
```

`export opaque` exports the **type name only**. Everything the body introduces stays private to the home module:

- **Records:** the constructor is private (no construction outside), and — load-bearing — **fields are private too**: no `p.x`, no pattern destructuring, no `{...p, x: e}` update outside the home module. An opaque record without field privacy would be fake abstraction; outside its home module an opaque record is a black box.
- **Unions:** all constructors private — no construction, no pattern matching outside. Exhaustiveness checking is unaffected (it is checked against the declaration, and matching is impossible outside anyway).
- Inside the home module, `opaque` changes nothing: full construction, matching, field access. The home module exports smart constructors and accessors as ordinary functions — this is the intended idiom, and the companion-module pattern (§5.3) is its natural shape.
- Derived instances are unaffected: `export opaque record Point derives (Eq, Show) = ...` works — derivation happens in the home module, where nothing is hidden, and the resulting instances are global like all instances (§7). This is deliberate: opacity hides *structure*, not *capabilities*.
- `opaque` is legal **only on `record` and `union`**, and only together with `export` (`opaque` without `export` is "everything is already private; remove `opaque`"). On `type`: error — aliases are transparent by definition; "make it a `record` or single-constructor `union`" (the Declarations Preamble §4 redirect family). On `let`/`fun`/`constraint`/`exception`: parse error.

Lineage: Roc's opaque types and Haskell's export-`Point`-without-`Point(..)` idiom; the modifier spelling keeps the common case JS-shaped where an export list (Haskell/Elm) would abandon it (§9.3).

### 4.3 Private types in public signatures

An exported term whose type mentions a **private nominal type** is a hard error at the export:

> exported `parse` mentions the private type `Token`; export `Token` (possibly as `export opaque`)

Rust's private-in-public rule, same rationale: the caller could neither name nor use the type, so the export is unusable as written, and the fix is one keyword. The error names every offending type once. Details:

- An **`opaque`** type in an exported signature is fine — that is the whole point of `opaque`.
- A private **alias** in an exported signature is fine: aliases are transparent (Preamble §4), so the exported signature (and its `.d.ts`) simply uses the expansion; display stickiness (Preamble §6) yields to visibility. This discharges Preamble §10.9's "export visibility of aliases referenced by exported signatures."
- Instances are exempt (they are not exports and can mention anything; §7.4).

---

## 5. Namespaces and resolution

Hexagon now has **four namespaces**: terms, types, constraints (Constraints §2.2), and **module aliases**. Position resolves; one new collision rule exists.

### 5.1 Resolution by position

1. **`Name.` — uppercase immediately followed by `.`** resolves in the module-alias namespace **first**. Types and constraints never take `.`, so no genuine ambiguity exists; the ordering is stated so the implementation is deterministic. If no module alias `Name` exists, the error says so, mentioning the type if one exists: "`Shape` is a type, not a module; import its home module with `import * as` for qualified access, or import the constructor/function you need." The `.` token remains the one from Operators §14 — field access and module path, resolved by what the left side names; a module alias on the left makes it a module path.
2. **`Name` in type position** resolves in the type namespace only. **`Alias.Name` in type position** resolves `Name` in the *exported type namespace* of the aliased module.
3. **`Name` in term position** (applied or bare) resolves in the term namespace only — constructors, constraint members, ordinary bindings.
4. A module alias in any position other than the left of `.` is the "modules are not values" error (§3.3).

### 5.2 Collisions

- **Two module aliases with the same name** in one module: hard error at the second `import * as` line — the one new collision rule.
- **Module alias vs type name, module alias vs constructor:** legal, resolved by position. This is deliberate and load-bearing: it is what makes the **companion-module idiom** — `Int` the type / `Int` the module, `Map`/`Map`, `Point`/`Point` — a *rule* rather than a prelude coincidence.
- **Named-import collisions** are hard errors at the import line: importing the same name from two modules, or importing a name the module also declares (in the same namespace). You wrote both lines; the fix is qualification or an `as` alias, and the error says so. (Cross-namespace coexistence — an imported constructor beside a local type of the same name — follows the ordinary namespace rules; only same-namespace duplicates collide.)
- **Constructor / module-alias coexistence** (bare `Shape` is a nullary constructor, `Shape.` is a module): **legal in v1.** The Elm-strict alternative (error, force a rename) is recorded as a **v2 candidate** to be adopted if field evidence shows confusion — tightening later is easy; loosening later is a design admission. The LSP hover should disambiguate in the meantime. *(Directional call recorded this session.)*

### 5.3 The companion-module idiom (blessed)

The intended pattern for opaque types: the home module exports the opaque type plus functions under its own roof, and consumers namespace-import it under the type's name.

```
-- point.hex
export opaque record Point = {x: Float, y: Float}
export fun make(x: Float, y: Float): Point = Point({x: x, y: y})
export fun getX(p: Point): Float = p.x

-- consumer
import * as Point from "./point"
let p = Point.make(1.0, 2.0)      -- Point. = module; Point in types = the type
fun norm(p: Point): Float = ...
```

The prelude's `Int.div`, `Map.get`, `List.map` are this exact pattern — auto-imported companion modules, **one mechanism, not a special prelude device**.

### 5.4 The prelude occlusion rule

The prelude enters every module's scope as a **distinct outermost layer**. The Head Binder Shadowing rule (Statements §5) is untouched in statement — sequential binders never reuse a name in their scope layer or any inner layer — but "in scope" is now layered:

- A **module-level** `let`/`fun` (or import, or declaration) **may occlude a prelude name**. `fun show(x) = ...` at module level is legal; the local `show` wins unqualified module-wide, and the prelude's version remains reachable qualified (`String.show` etc. — §6.4 guarantees a qualified home exists). Explicit imports enter the *same* layer as local bindings and fight under the full ban.
- A **function-local** binder may occlude **nothing**, prelude included: `let show = ...` inside a function in a module that has not occluded `show` remains the hard error. Inside any function body the ban is absolute and layer-blind — which is where the "refactoring bugs live in names *you* bound" rationale actually lives. You never wrote the prelude name, so a module-level occlusion changes no line of yours; a function-local one could.

This **retires** the Statements §10.2 interim rule ("enforced against function-local scopes only") in exactly this direction, and closes Statements §5.2's flag. Rationale for occlusion at all, recorded: without it, every addition to the prelude in a future release is a breaking change to any program using that name — untenable with no warning tier to soften it.

---

## 6. What crosses a module boundary

### 6.1 Values and generalisation

Module-level `let`/`fun` bindings generalise per the existing rules (Functions §8; value restriction) — "generalisation at module export" (Type System Overview §2.2) is anchored here: export adds nothing to generalisation; a module-level binding has its generalised scheme whether exported or not, and import conveys the scheme unchanged. Constrained exports carry their constraints; the importer's call sites discharge them exactly as local calls would.

### 6.2 Types

Exported nominal names are importable and qualifiable; identity is declaration-site (§2). Exported aliases remain transparent everywhere. Type parameters, arities, and `derives` travel with the declaration since they *are* the declaration.

### 6.3 What never crosses (because it never needs to)

Structural types (no home), instances (global, §7), `var` (cannot exist at module level), dictionaries (compiler plumbing, Constraints §1).

### 6.4 Pre-registered stdlib constraint

The occlusion rule's "prelude version stays reachable qualified" only works if **every prelude name has a qualified home** — a companion module it also lives in (`List.map` for bare `map`, `String.show`/per-type homes for `show`'s instances, etc.). The stdlib listing **must** maintain this invariant; a bare-only prelude export is a spec violation there. Pre-registered now, subject-first-convention style.

---

## 7. Instances, coherence, and the orphan rule

### 7.1 Globality (restated, now operational)

Instances are visible program-wide once their module is in the import graph — not imported, not exported, not hidden (Constraints §5.3 preserved verbatim). `export implement` is the §4.1 error. The effect-import form (§3.4) exists chiefly to pull instance-bearing modules into the graph.

### 7.2 "Home module," operationally

The orphan rule's home module (Constraints §5.3) is defined: **the file whose text contains the declaration.** `implement C<T>` must appear in the file declaring `C` or the file declaring `T` (parameterized heads: `T`'s outermost constructor). Trivial under one-module-per-file; recorded so nothing subtler is ever read into it.

### 7.3 Duplicate-instance reporting point (discharging Constraints §5.1)

Same-module duplicates error at the second declaration (unchanged). Cross-module duplicates error **at whole-program check, when the second module enters the import graph**, naming both modules and both declaration sites: "duplicate implementation of `Ord<String>`: declared in `./a.hex` (line N) and `./b.hex` (line M)." The error is attributed to the program, not to either innocent-looking file — which is precisely why the orphan rule exists to make it nearly unreachable.

### 7.4 Instances on private types

Legal and harmless: an instance on an unexported type exists globally but nothing outside can name the type to reach it. `derives` on private and `opaque` types works unchanged (§4.2). No visibility check applies to instance heads; §4.3's private-in-public rule does not extend to `implement`.

### 7.5 Whole-program coherence: acknowledged cost

Coherence and orphan checking are defined **over the whole import graph**, which `hexc` sees today (whole-program compilation). Publishing compiled Hexagon as plain JS to npm loses instance metadata; cross-*package* coherence would require interface files. Known future cost, deliberately not solved here; recorded so the package story (§12.1) inherits it.

---

## 8. Loading

### 8.1 Acyclic imports

An import cycle anywhere in the graph is a **hard error** naming the cycle: "import cycle: `./a` → `./b` → `./a`." No exceptions, including type-only cycles — a cycle is a cycle. Rationale: ESM permits cycles and they are a hazard swamp (bindings observable before initialization); F# is strictly acyclic and is the lineage; acyclicity yields the deterministic load order below and means emitted ESM never exercises JS's cycle semantics. Instances being evaluation-free (Constraints §6.3) removes the one pressure that might have argued for cycles. Mutually recursive *types* live in one module (Preamble §7.2 already grants order-insensitivity within a module); the diagnostic suggests exactly that.

### 8.2 Top-level effects and load order

Non-binding `Unit`-typed expressions are **legal at module top level** (`print("loaded")` — JS-style, per the existing block rules: Statements §3.2 polices non-`Unit` discards there exactly as in any block). Load order is fixed: **a module's imports are loaded depth-first in source order, each module exactly once, before the module's own top level runs** — ESM's order minus the cycle cases, well-defined because §8.1 bans those. Within a module, top-level items run in source order (declarations and `fun`s are hoisted/order-insensitive per their specs; `let`s and effects run in order; the existing `fun`-capture-of-later-`let` rules, Functions §7.2, apply unchanged at module level).

### 8.3 Root modules; no special `main`

Hexagon has **no language-level entry function**. `main` is an ordinary lowercase identifier: it may be declared, exported, imported, or called, but the compiler never discovers or invokes it implicitly and assigns no special type to it.

A compiler host selects one or more **root modules**. Imports determine each root's acyclic graph. Building a root emits its ordinary ESM graph; running a root means asking the target host to evaluate that emitted root module. Its imports initialize and its top-level effects run exactly per §8.1–§8.2. No wrapper call or second program-order mechanism exists.

Library versus application is therefore not a distinction in Hexagon module semantics. The same module may be imported by another module or selected as a run root. Command spelling, project-file defaults, process arguments, and exit-code policy belong to compiler/host architecture; they cannot add a mandatory `main` or implicit parameters to the root module.

---

## 9. Rejected alternatives (do not re-litigate)

1. **ML module calculus** (functors, signatures, first-class modules — OCaml/SML): Hexagon's parameterization needs are met by type parameters and constraints; readable-JS has no good functor target; the intended user has never missed them; and "modules are fences, not forges" is the simpler story that HM-plus-constraints affords. Doubly foreclosed by "module aliases are not values" (§3.3).
2. **`module` header / in-file modules** (F#, Haskell): ceremony plus a name-vs-path drift hazard under one-module-per-file; declined with reasons at §2.
3. **Export lists** (Haskell, Elm): maximum control, but a second export mechanism that abandons the JS shape; `export opaque` covers the one abstraction need the list was wanted for.
4. **`Shape(..)` import sugar** (Haskell): not JS-shaped; namespace import covers the want; individual constructor imports are honest about what enters scope.
5. **Default exports** (JS): the one JS feature declined — a second export kind with naming anarchy at import sites and interop pain, widely regretted in the JS ecosystem itself; named exports are the single story.
6. **Single-namespace modules** (Elm): breaks the already-shipped prelude idiom (`Int`/`Int.div`, `Map`/`Map.get`) and the companion-module pattern user libraries will want; renames like `Ints` are ceremony Camp-1 languages prove unnecessary. The narrow Elm-strict *constructor*/alias restriction alone remains a v2 candidate (§5.2).
7. **F#'s shadowing/priority stack** across modules/types/namespaces: the documented confusion; Hexagon takes Haskell's semantics under JS's syntax instead.
8. **Rust's unified path system**: drags in `::` or overloads `.` harder than needed; the four-namespace split with position resolution is smaller.
9. **Cyclic imports permitted** (ESM): §8.1.
10. **Module-level `var` / exportable cells**: was never on the table (Statements §6.4); recorded here because this is where people will look.

---

## 10. Diagnostics checklist

| Situation | Error / hint |
|---|---|
| `module Name` header | parse error: "Hexagon has no module headers; a file is a module" |
| Import inside a function/block | "declarations live at module level" family (Preamble §7.1) |
| Importing an unexported name | "`helper` exists in `./geometry` but is not exported" (or plain unknown-export + near-miss) |
| Import cycle | "import cycle: `./a` → `./b` → `./a`"; hint: "mutually recursive declarations can share one module" |
| Two module aliases, same name | hard error at second `import * as` |
| Same-namespace named-import collision (import↔import or import↔local) | hard error at the import line; hint: "qualify one, or use `import { x as y }`" |
| Module alias used as a value | "modules are not values" |
| `Name.` where `Name` is a type, not a module | "`Shape` is a type, not a module; …" (§5.1) |
| Alias case mismatch (`import { area as Area }`) | "alias case must match what it names" |
| Function-local binder occluding any in-scope name incl. prelude | existing Statements §5.1 error, unchanged |
| `export implement` | "implementations are always visible; `export` does not apply" |
| `export default` | "Hexagon has named exports only" |
| `opaque` without `export` | "everything is already private; remove `opaque`" |
| `opaque` on `type` | "aliases are transparent; make it a `record` or single-constructor `union`" |
| `opaque` on `let`/`fun`/`constraint`/`exception` | parse error: "`opaque` applies to `record` and `union` declarations" |
| Opaque field access / construction / match outside home module | "`Point` is opaque outside `./point`; use its exported functions" |
| Private nominal type in exported signature | "exported `parse` mentions the private type `Token`; export `Token` (possibly as `export opaque`)" (§4.3) |
| Cross-module duplicate instance | "duplicate implementation of `Ord<String>`: `./a.hex` (line N) and `./b.hex` (line M)" (§7.3) |
| Unsatisfied constraint whose instance exists in an unimported module | existing Constraints §8 phrasing + hint: "its implementation is in `./x`; add `import \"./x\"`" |
| Bare package specifier | "package imports are not yet supported" (§12.1) |

---

## 11. Emission

1. **One module → one ESM module.** `export` → `export`; unexported bindings → plain `const`/`function`. Privacy is enforced by the Hexagon checker; the emitted JS simply doesn't export what wasn't exported.
2. **Named imports always.** Because module aliases are not values, every `Geo.area` resolves at compile time to a specific export; the emitter uses named ESM imports (`import { area } from "./geometry.js"`) **even when the source used the namespace form** — tree-shakeable, readable, no runtime namespace objects. (An emitted `import * as` is permitted where the emitter judges it more readable for heavy qualified use; semantics identical either way.)
3. **Load order** is ESM's own, valid because the graph is acyclic (§8.1). Effect imports emit as bare `import "./telemetry.js"`.
4. **`.d.ts`:** exported terms and types appear; private ones don't; private aliases in exported signatures appear as their expansion (§4.3). The **`opaque` representation in `.d.ts` is deferred to the FFI spec** *(directional call recorded this session)* — the candidates (branded types vs. honest-fields-abstraction-is-Hexagon-side-only) are that spec's first agenda item; until decided, the emitter may ship honest fields with a documented caveat.
5. **Instances** emit as module-level `const` dictionaries where materialised (Constraints §6.1), exported in JS *only* as plumbing when a genuinely-polymorphic exported function needs cross-module dictionary access — never surfaced in `.d.ts` (Constraints §6.4), never nameable from Hexagon.

---

## 12. Hanging questions (recorded, not decided)

1. **Package resolution.** Bare specifiers reserved (§2); node_modules-style resolution, a lockfile story, and cross-package coherence via interface files (§7.5) are one connected future design. *Needed by:* first external-library milestone.
2. **Re-exports** (`export { x } from "./m"`): deferred; the facade-module pattern will eventually want it; declined for v1 to keep export = declaration prefix, one rule.
3. **Elm-strict constructor/module-alias coexistence** — v2 candidate on field evidence (§5.2). *(Directional call recorded this session.)*
4. **Selective import of constraint members** — presumed never needed (§3.1); revisit only on concrete demand.
5. **Formatter policy for import placement/sorting** — out of spec scope, same parking spot as all lint policy.

---

## 13. Acceptance tests (golden: resolution, diagnostics, emitted JS)

```
-- (a) Privacy default
-- geometry.hex
export fun area(r: Float): Float = pi() * r * r
fun helper(x: Float): Float = x * x          -- private
-- consumer.hex
import { area, helper } from "./geometry"    -- ERROR: helper ... is not exported

-- (b) Record import spans namespaces
-- shapes.hex: export record Point = {x: Float, y: Float}
import { Point } from "./shapes"
let p = Point({x: 1.0, y: 2.0})              -- constructor: imported
fun f(q: Point): Float = q.x                 -- type: imported; fields visible (not opaque)

-- (c) Opaque is a black box outside home
-- point.hex: export opaque record Point = {x: Float, y: Float}
--            export fun make(x: Float, y: Float): Point = Point({x: x, y: y})
import * as Point from "./point"
let p = Point.make(1.0, 2.0)                 -- OK
p.x                                          -- ERROR: Point is opaque outside ./point
match p                                      -- ERROR: same
  Point(r) => ...

-- (d) Companion idiom: alias/type/constructor coexistence
import * as Point from "./point"
fun norm(p: Point): Float = ...              -- type position: the type
let q = Point.make(3.0, 4.0)                 -- Point. : the module

-- (e) Prelude occlusion: module-level yes, function-local no
fun show(x: Config): String = "..."          -- OK: occludes prelude show, module-wide
fun f(c) =
  let show = 1                               -- ERROR: show is already bound (§5.4)
  ...

-- (f) Named-import collision
import { area } from "./circle"
import { area } from "./rect"                -- ERROR: area already imported; alias one

-- (g) Cycle
-- a.hex: import { b } from "./b"
-- b.hex: import { a } from "./a"            -- ERROR: import cycle: ./a → ./b → ./a

-- (h) Private-in-public
union Token = Word(s: String) | Gap          -- private
export fun parse(s: String): List(Token) = ...
-- ERROR: exported parse mentions the private type Token; export Token
-- (possibly as export opaque)

-- (i) Instance globality + effect import
-- ord-instances.hex: implement Ord<Config> = ...
import "./ord-instances"                     -- no names; instance now in the graph
sort(configs)                                -- OK

-- (j) Cross-module duplicate instance
-- a.hex: implement Show<Weird> = ...        -- (a.hex declares Weird: home, legal)
-- b.hex: implement Show<Weird> = ...        -- ERROR at program check: duplicate
                                             -- implementation of Show<Weird>:
                                             -- ./a.hex (line N) and ./b.hex (line M)
                                             -- (b.hex also violates the orphan rule)

-- (k) Emission: namespace form still emits named imports
import * as Geo from "./geometry"
Geo.area(2.0)
-- emits: import { area } from "./geometry.js";  area(2.0);
```

---

## 14. Decisions log

| Decision | Where |
|---|---|
| One module per file; no `module` header; path = identity; importer names | §1, §2 |
| Structural types have no home module; Constraints §9.3 presumption confirmed decided | §2 |
| JS-verbatim imports: named, `as` aliases, `import * as`, effect imports; items import across all exported namespaces; record import = type + constructor; union constructors imported severally | §3 |
| Module aliases: uppercase, not values; qualified access in term, type, and pattern position | §3.3 |
| `export` = declaration prefix exporting everything introduced; no default exports; no re-exports (v1) | §4.1 |
| `export opaque` on `record`/`union`: type name only; fields/constructors/matching private outside home; derives unaffected; home module unaffected | §4.2 |
| Private-in-public: hard error for nominal types; transparent aliases exempt (expansion used); Preamble §10.9 discharged | §4.3 |
| Fourth namespace (module aliases); position-based resolution; `Name.` checks modules first | §5.1 |
| Collisions: duplicate module aliases error; alias-vs-type/constructor legal (companion idiom blessed); named-import same-namespace collisions error; Elm-strict restriction = v2 candidate | §5.2, §12.3 |
| Prelude occlusion: module-level bindings may occlude prelude; function-local occludes nothing; explicit imports fight; Head Binder rule untouched in statement; Statements §10.2 retired | §5.4 |
| Every prelude name must have a qualified home (stdlib invariant, pre-registered) | §6.4 |
| Instances never exported/imported/hidden; home module = containing file; cross-module duplicates reported at whole-program check naming both sites; instances on private types legal; whole-program coherence cost acknowledged | §7 |
| Imports acyclic, hard error, incl. type-only; deterministic depth-first load order; top-level `Unit` effects legal; selected root module runs through ordinary ESM evaluation; no special `main` | §8 |
| ML calculus, headers, export lists, `(..)` sugar, default exports, single-namespace, F# priority stack, unified paths, cycles: rejected with reasons | §9 |
| Emission: 1:1 ESM; named imports even for namespace form; `opaque` `.d.ts` deferred to FFI | §11 |
| Five hanging questions recorded | §12 |
