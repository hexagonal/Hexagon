# Hexagon Spec: Modules

**Status:** Decided (July 2026) — with a **hanging-questions** section (§12); nothing there blocks implementation of §1–§11.
**Scope:** Module identity (one module per file, no module header), the `import` declaration (named, aliased, namespace forms), the head's visibility slot (`export`, `opaque`, or absent — #590), privacy defaults, the module-alias namespace and position-based resolution, prelude occlusion, import-collision rules, the acyclic-import rule and load order, top-level effects, instance globality, the orphan rule's operational definition of "home module," instance discoverability (§7.6), the private-in-public rule, generalisation at module level (restated), and ESM/`.d.ts` emission — including the opaque brand face (§11.4, per FFI Part 7 §5).
**Not in scope:** package/bare-specifier resolution (§12.1), re-exports (§12.2), CLI root-selection and project-configuration syntax (compiler architecture; §8.3 fixes the language-level absence of a special entry point), and the prelude's inventory (stdlib listing — one constraint pre-registered here, §6.4).
**Companions:** Constraints spec (§5.1 duplicate reporting point; §5.3 orphan rule; §9.3 structural instances), Statements/Blocks/Mutability spec (§5.2/§10.2 prelude collisions; §6 `var` confinement), Declarations Preamble (§7 declaration inventory; Rewrite Rule §1.1), Unions §2 (constructor qualification), Functions §8 (module-level generalisation), Operators §14 (`.` as module-path separator), Method Syntax §4/§8 (companion dispatch and emitted companion imports), Lexer & Layout (module top level as a block), and FFI Parts 4/7 (extern bindings and export surface).

---

## 1. Doctrine

- **A module is a file; a file is a module.** There is no `module` header declaration and no in-file submodule. A module's identity is its path; its name, where one is needed, is chosen by the *importer* (namespace alias, §3.3). One compilation unit per file, mirroring ESM exactly.
- **Everything is private unless exported.** `export` is a declaration prefix, JS-style. An unexported binding is invisible outside its file — not "discouraged," invisible: no qualified access, no reflection, no back door.
- **Modules are fences, not forges.** Modules control *name visibility only*. They do not create type identity — that is the declaration site's job (`record`/`union`, Declarations Preamble). A nominal type is the same type through every import path and alias; structural types belong to no module at all. There are no functors, no signatures, no first-class modules (§9.1 records the rejection).
- **A module cannot contain, export, or close over mutable state** — in pure Hexagon. This is not a new rule but the module-level face of three existing ones: `var` is function-body-only (Statements §6.1), there are no ref cells (§6.4), and no lambda captures a `var` (§6.2). The only module-level state is immutable `let` bindings evaluated once at load. `export` exposes values and names, never cells. (An `extern` JS module can of course hide mutation behind a function; that lives at the FFI boundary and is that spec's problem.)
- **Instances are global and unfenced.** `honor` ignores the export system entirely: an instance is visible program-wide the moment its module is in the import graph — never imported, never exported, never hidden (Constraints §5.3). Coherence is checked over the whole graph (§7).
- **Imports are acyclic, hard error.** No import cycles, ever (§8.1). This buys a deterministic topological load order, keeps the emitted ESM out of JS's cycle semantics (temporal dead zones), and matches the F# lineage.
- **JS-verbatim syntax; ESM-identity emission — one word carved (#565).** The import/export surface is deliberately JavaScript's own, and one Hexagon module emits as one ESM module with `export` mapping to `export`. Readable-JS emission is, for this feature, nearly the identity function — the strongest argument for the design, and the reason every other syntax deviation was declined. The one *spelling* deviation is the namespace form's head (default exports stay the one JS *feature* declined — §9.5): Hexagon spells it `import module Geo from "./geometry"` (§3.3), because JavaScript's `* as` costume promises a gather-the-exports namespace *object* the language deliberately does not deliver — the alias is no value (§3.3) — and the spelling should say what the form does: import the module, under a name the importer chooses. Emission is untouched: the emitted JS remains JavaScript's own forms throughout (§11.2).

---

## 2. Module identity

- **One module per file.** File extension `.hex`. The module top level is a block (Lexer & Layout) exempt from the final-expression rule (Statements §3.1); its items are the module-level declarations (Declarations Preamble §7.1), `let`/`fun` bindings, and `Unit`-typed effect expressions (§8.2).
- **No module header.** `module Geometry` does not exist and is a parse error pointing here. A file does not know or declare its own name; naming is the importer's act. Rationale: the header is pure ceremony under one-module-per-file (the information is the path), it creates a name-vs-path drift hazard (Haskell's directory-mirroring rules exist to police exactly this), and JS-verbatim declines it anyway. The `module` of `import module` (§3.3; Lexer §4.2) creates no header form: the spelling is contextual to the import head, and `module Geometry` at a declaration seat stays the parse error above.
- **Module paths are string literals, relative form:** `"./geometry"`, `"../shared/util"` — extension omitted, resolved against the importing file. Bare specifiers (`"stdlib/json"`-style package paths) are reserved for Hexagon-to-Hexagon `import` and currently a compile error ("package imports are not yet supported"); resolution policy is a hanging question (§12.1). This does not restrict foreign `extern from`, whose bare JavaScript/package specifiers are legal under FFI Part 4 §2.1.
- **Nominal identity is declaration-site identity.** `Point` declared in `geometry.hex` is one type constructor everywhere it flows, under any alias. Two files each declaring `record Point` produce two unrelated types; the Declarations Preamble §7.3 duplicate rule remains per-module. Structural records and tuples are the same type in every module, need no export, cannot be hidden, and their instances remain exclusively compiler-derived: "which module owns `{x: Float}`" has no answer because structural types have no home module, and nothing needs one (Constraints §9.3).

---

## 3. `import`

```
import { area, perimeter } from "./geometry"
import { area as circleArea } from "./circle"
import module Geo from "./geometry"
import "./sideEffects"
```

Imports are module-level declarations; an `import` inside a function body joins the Declarations Preamble §7.1 error family. Placement within the file is grammatically free, and the formatter will float imports to the top — but no import exemption from the reading laws exists: each name an import binds obeys **the same namespace split as the declaration it imports** (Preamble §7.2's straddle rule). Type-namespace bindings — a type, a constraint's name, and the module alias in type-position qualified access — are order-insensitive, usable above or below the item. Term-namespace bindings — a value, a constructor, a constraint's members, bare or qualified through the alias — are read top-down (Functions §7.2): usable only below the import item, and a reference above it is the declared-later error with the import-shaped fixit, "move the import above this use".

### 3.1 Named imports

`import { name, ... } from "path"` binds each listed name in the importing module. An import item names an **export**, and imports it **across every namespace it is exported in**:

- `import { Point }` where `Point` is an exported `record` binds `Point` the type *and* `Point` the constructor — one item, two namespaces, matching how the declaration introduced them.
- `import { Shape }` where `Shape` is a union binds the **type only**. Constructors are separate exports with their own names: `import { Shape, Circle, Rect }`. There is no Haskell-style `Shape(..)` sugar — JS-verbatim has no such form, and the namespace import (§3.3) covers "give me everything" (rejected alternative recorded §9.4).
- `import { Ord }` where `Ord` is a constraint binds the constraint name **and its members** (`compare`) — the members are the constraint's API and arrive with it, consistent with their module-scope-term status (Constraints §2.2). Members cannot be imported severally (§12.4 records the question; presumption: never needed). For collision purposes the import item is the members' declaration site: an arriving member name that collides with another module-level term — a local binding, another import, or another constraint's member — is the Constraints §2.2 hard-error family, **reported at the import item**; a prelude name is merely occluded, per §5.4. The generalisation law (§5.3) carves none of this family: a same-spelled export beside an arriving member is the same collision, the law unconsulted, because the carve never unseats an ordinary binding (Constraints §4.6 owns the boundary), reported at the export declaration with the import item standing as the prior binding and the door-builder's repair hint — the message names the namespace-import route and §5.3's law as the destination it reopens, a signpost, not a consultation. A would-be door mostly cannot even be spelled here: a `widens` head's member path is module-alias qualification only (Constraints §2.2, §4.7), and the named import binds no alias — the doctrine self-enforcing; where a namespace alias for the declaring module coexists with the named import, the spellable declaration is refused identically, with the same hint naming the named import as what must go. The door-builder reaches the constraint through a namespace import (§3.3) instead, which binds the alias alone and leaves every member spelling free.
- Importing a name the module does not export: hard error, with a near-miss suggestion and a note if the name exists unexported ("`helper` exists in `./geometry` but is not exported").

### 3.2 Aliased imports

`import { area as circleArea }` binds only the alias. The alias obeys the ordinary start-class rules for what it names (a term import must alias to non-uppercase-start, a type/constructor to uppercase-start; violating this is a parse-adjacent error, "alias start class must match what it names"). Aliasing a record's name splits nothing: `import { Point as P }` binds `P` in both namespaces.

Aliasing a constraint renames the constraint name only: `import { Describe as D }` binds `D` in the constraint namespace, and the members arrive under their declared names, as always. Members are independent module-scope terms (Constraints §2.2); they are not renamed at the border, for the same reason they are not imported severally (§12.4).

### 3.3 Namespace imports

`import module Geo from "./geometry"` binds the single name `Geo` as a **module alias** giving qualified access to every export: `Geo.area(...)`, and in type position `Geo.Point`, `xs: Vector(Geo.Shape)`. Constructors qualify the same way (`Geo.Circle(1.0)`), including in patterns (`match s` / `Geo.Circle(r) => ...`) (Unions §2). Constraints too: `Geo.Ord` in a binder (`<a: Geo.Ord>`), and a member through the alias as an ordinary term (`Geo.compare(a, b)`) — the left side is the module alias in every case, so §5.1's "types and constraints never take `.`" is untouched: it governs what may stand *left* of the dot. Module aliases are uppercase-start, mandatorily. One reach extends the alias without adding a binding: where the aliased module exports a type or a constraint spelled like the alias itself, the bare reference in that namespace's own position may resolve through it — §5.1 rule 2's companion fallback, which answers only where the namespace has nothing.

**The head's grammar (#565).** `module` here is a contextual keyword (Lexer §4.2), recognized exactly between `import` and the alias — a position where no name could ever legally stand, so recognition is total, and the spelling stays an ordinary name everywhere else (`let module = 3` binds). The alias is uppercase-start, mandatorily, as above — which settles the degenerate spelling by start class alone: `import module module` puts a non-uppercase-start name in the alias seat and is refused as any such alias would be. JavaScript's own head is **refused with a rewrite**: `import * as Geo from "./geometry"` is a parse error under the Rewrite Rule (Declarations Preamble §1.1) — "namespace imports are spelled `import module Geo from "./geometry"`" — a targeted redirect at the exact place a JavaScript author's muscle memory fires, and the only position the `*` glyph ever stood outside an operand seat (Comments §3.1's adjacency argument simplifies accordingly). The respelling touches the head alone: the form's semantics, and everything below, are unchanged.

**Module aliases are not values.** `let m = Geo` is an error: "modules are not values." No passing, no returning, no storing. This is what keeps the namespace story (§5) honest and forecloses first-class modules by construction.

### 3.4 Effect imports

`import "./telemetry"` imports nothing and loads the module for its top-level effects. It also activates any instances declared in that module (§7), although instance-only use is nearly vestigial in v1 (§7.6). Workspace-aware tooling can suggest this import when it finds a lawful instance outside the current graph (§7.6, §10).

The foreign counterpart is `extern import "telemetry/register"` (FFI Part 4 §8): it loads a JavaScript module for effects and introduces no Hexagon bindings. The `extern` keyword keeps the foreign and Hexagon module graphs visibly distinct.

---

## 4. `export` and `opaque`

A module-level declaration head has **one visibility slot, with three values** *(#590)*: **absent** — everything the declaration introduces stays private; **`export`** — everything it introduces crosses (§4.1); **`opaque`** — the type name alone crosses (§4.2). The three are mutually exclusive spellings of one home-declared property, which is the syntax following the semantics §4.2 already states: the declaration is the sole authority on representation visibility, and `opaque` is that property's one written word. In particular the pair `export opaque` is refused with a required rewrite (§4.2, §10): opacity of a private thing is vacuous, so `opaque` alone already claims the crossing — the second word could never assert anything the first did not.

### 4.1 `export`

`export` prefixes a module-level declaration and exports **everything that declaration introduces**:

| Declaration | Exports |
|---|---|
| `export let x = ...` / `export fun f(...) = ...` | the term |
| `export record Point = {...}` | `Point` the type **and** `Point` the constructor (the name-carried surface: construction, constructor patterns). Field access, update, and the bare copy are type-directed — they travel with the type, not the import (§4.2) |
| `export union Shape = Circle(...) \| ...` | `Shape` the type **and** every constructor |
| `export type UserName = String` | the alias name |
| `export constraint Ord<a: Eq> = ...` | the constraint name **and** its members |
| `export exception ParseError(...)` | the exception constructor |
| `export honor ...` | **hard error** — "instances are always visible; `export` does not apply" (§7) |
| `export import ...` | **hard error** — re-exports deferred (§12.2) |

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

- **Records:** the constructor is private (no construction outside), and — load-bearing — **fields are private too**: no `p.x`, no pattern destructuring, no `{p with x = e}` update outside the home module. An opaque record without field privacy would be fake abstraction; outside its home module an opaque record is a black box.
- **Unions:** all constructors private — no construction, no pattern matching outside. Exhaustiveness checking is unaffected (it is checked against the declaration, and matching is impossible outside anyway).
- Inside the home module, `opaque` changes nothing: full construction, matching, field access. The home module exports smart constructors and accessors as ordinary functions — this is the intended idiom, and the companion-module pattern (§5.3) is its natural shape.
- Derived instances are unaffected: `opaque record Point derives (Eq, Show) = ...` works — derivation happens in the home module, where nothing is hidden, and the resulting instances are global like all instances (§7). This is deliberate: opacity hides *structure*, not *capabilities*.
- `opaque` is legal **only on `record` and `union`**, and it fills the head's visibility slot by itself *(#590)*. `export opaque` — the pre-#590 spelling — is a parse error under the Rewrite Rule (Declarations Preamble §1.1): "`opaque` already exports the type name; write `opaque record Point = …`" — the rewrite is mechanical and required, the `widens` respell pattern (Constraints §4.7's refused-export fixit). On `type`: error — aliases are transparent by definition; "make it a `record` or single-constructor `union`" (the Declarations Preamble §4 redirect family). On `let`/`fun`/`constraint`/`exception`: parse error. The subject redirects outrank the pair refusal: `export opaque` before an unlawful subject draws the subject's redirect, never the pair rewrite — the rewrite's output would still be ill-formed, and the deeper fault leads. A redirected bare head claims no crossing: the declaration recovers as private, the slot's neutral value — a refused word claims nothing.

**Transparent representations travel with the type** *(#587)*. The complement of the rule above, and it takes no syntax: outside `opaque`, the declaration is the **sole authority** on representation visibility, and a record's fields are open **wherever the type reaches**. Type-directed access — `p.x`, `{p with x = e}`, the bare copy `{...p}` — asks only what the receiver's type is, and a type reaches modules that never spelled its name: an imported signature carries it, and its home module is in the graph by reachability of the type — the same sentence Method Syntax §4.2 states for the dot's operation set, one law with two clients. Whether the accessing module imported the declaration, in any form or at all, changes nothing: imports carry *names* (§3) — the constructor among them, so construction and constructor patterns want the name in scope like any name — but no import is ever the difference between a representation open and shut. A nominal record's pattern eliminator is the constructor pattern, name-carried like construction (Pattern Matching §2.4); in a module without the name, the destructure spelling is `let {n} = {...v}` through the crossing (Products §5.3). The open-or-shut difference is written in one place by one author: `opaque`, on the declaration. Consequently there is no consumer-side or intermediary re-abstraction — no module can pass along another's type with the fields closed, and re-exports, the one vehicle such a facade could ride, stay deferred (§12.2) — and no per-signature or per-occurrence form exists; a representation has one answer, written once: transparent everywhere, or closed everywhere outside its home. Diagnostics inherit the rule: a missing-field error names the record's known fields wherever it fires (Products §3.2) — an empty field enumeration is malformed output, never a compiler sentence — and the only "representation not visible here" refusal is the opaque one above, which sends the reader to the home module.

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

An exported face whose type mentions a **private nominal type** is a hard error at the carrier's offending seat. The rule reads **every carrier an exported declaration has** *(#621)*: an `export`ed binding's signature, an `export`ed type alias's target, an `export`ed record's fields, an `export`ed union's constructor payloads, and an `export`ed exception's payloads — the visibility the head (or, inside an `extern from` block, the row) writes as `export`, never an `opaque` declaration's interior (see below).

> exported binding `parse` exposes private type `Token`; export the type, perhaps opaquely, or keep the binding private

One message family, the carrier's own noun in both seats — `` exported type alias `W` … keep the alias private ``, `` exported record `Outer` … keep the record private ``, `` exported union `U` … keep the union private ``, `` exported exception `Boom` … keep the exception private ``. Rust's private-in-public rule, same rationale: the caller could neither name nor use the type, so the export is unusable as written, and the fix is one keyword — "perhaps opaquely" offers the second keyword, since `opaque` is itself a kind of export (§4.2). The remedy's spine holds for every private nominal the walk can find; for an extern type, whose head does not take `opaque` (§4.2), the "perhaps" is doing its honest work.

**A type carrier's diagnostic sits at the offending mention's seat** — the field's annotation, the constructor slot's annotation, the alias's right-hand side — so the eye lands on the mention the message describes (an alias on the route excepted; see below), not on a ten-field head indicted for one field's fault; a binding's stays at the binding, whose signature is one seat already. The seat is the carrier's **whole written annotation**, not the sub-annotation of a nested occurrence: a field `token: Vector(Token)` anchors at `Vector(Token)`. Each carrier names every offending type **once**: three fields of one private type draw one diagnostic, at the first offending seat in declaration order — fields in written order, constructors then their slots in written order, an exception's slots in written order; a carrier leaking two private types draws two, each at its own first seat. **Every diagnostic in the family — the binding's included — carries a secondary label at the private type's declaration** (`` `Token` is declared private here ``): the label sits exactly where the one-keyword fix goes, so the fix is a lookup, never a search. Details:

- **The rule is local.** The private nominals it reads are the module's **own** — a type declared in another module contributes nothing to this check, whatever its privacy at home *(#629)*. The restraint leaves nothing unguarded: every carrier route into a consumer's face runs through some exported carrier or binding of the home module, and that carrier is refused **there**, in the one module that holds the declaration the label points at and can perform the remedy the message names. Where no carrier route exists — an exported constraint's members, which have no `.d.ts` face and are no carrier (the last bullet below; #626) — the private type is unnameable in the consumer, so no complete exported signature (§4.1.1) can mention it. No second report abroad.
- An **`opaque`** type **mentioned** in an exported face is fine — that is the whole point of `opaque`.
- An **`opaque` declaration is not a carrier.** Its fields and constructor payloads have no `.d.ts` face — FFI Part 7 §5's brand-only face mentions neither — so a private nominal may sit in either, and hiding a private representation behind an opaque name is the intended idiom (§4.2): opacity hides structure, and a structure nobody can see leaks nothing.
- A private **alias** in an exported face is fine: aliases are transparent (Preamble §4), so the exported face (and its `.d.ts`) simply uses the expansion; display stickiness (Preamble §6) yields to visibility. Transparency cuts both ways: a private alias whose *expansion* mentions a private nominal launders nothing — the expansion is the face, and the nominal in it is refused the same. The seat is still the carrier's own annotation — the one naming the alias — and the message still names the nominal the expansion reached; the alias is the route, not the fault, and takes no label of its own. The family's secondary label points, here as everywhere, at the private type's declaration — which is also what resolves the seat's spelling `Alias` against the message's `Hidden`.
- Instances are exempt (they are not exports and can mention anything; §7.4).
- An exported **constraint** is not a carrier: its member signatures have no `.d.ts` face (FFI Parts 8–9), so nothing crosses here. Whether a private nominal in an exported constraint's members deserves its own refusal — the declaration is unhonorable outside its home module — is #626's question, not this rule's.

---

## 5. Namespaces and resolution

Hexagon now has **four namespaces**: terms, types, constraints (Constraints §2.2), and **module aliases**. Position resolves; one new collision rule exists.

### 5.1 Resolution by position

1. **`Name.` — uppercase immediately followed by `.`** resolves in the module-alias namespace **first**. Types and constraints never take `.`, so no genuine ambiguity exists; the ordering is stated so the implementation is deterministic. If no module alias `Name` exists, the error says so, mentioning the type if one exists: "`Shape` is a type, not a module; import its home module with `import module` for qualified access, or import the constructor/function you need." The `.` token remains the one from Operators §14 — field access and module path, resolved by what the left side names; a module alias on the left makes it a module path.
2. **`Name` in type position** resolves in the type namespace **first**. Where the type namespace has nothing for the spelling, and a module alias `Name` is visible whose module exports a type `Name`, the reference resolves to that exported type — **the companion fallback** *(#531; §5.3's idiom is what it exists for)*. The fallback answers only where resolution had already failed, and the alias still binds nothing in the type namespace: a same-spelled type declaration or type import wins outright everywhere, with no collision and no refusal. The compiler-owned boundary types (`Array`, `Nullable`, the hidden `Node` — §5.5's parenthetical) stay **last**: they answer only after declarations *and* after the companion fallback, which is §5.5's own sentence applied — no resolution claim of the compiler's outranks a user's declaration, and the companion fallback resolves to one, reached through the user's own import. Conservativity is exact everywhere but at the boundary spellings: every program that resolved without the fallback resolves identically under it, **except** where a module imported under a boundary type's name and exporting a same-spelled type now means the user's type — the reading whose absence the old resolution's own error marked as confusion (the same-name-both-sides tell, `expected Array(Int), found Array(Int)`). At `Array` and `Nullable` the exception is reachable in any module; at `Node`, only in a runtime-privileged one — the one place the spelling answers at all (intrinsics §5.2's `runtime` flag, gating the §3.3 fallback family) — because shipped runtime source holds no import lines, but a project-supplied file at a runtime injection path (intrinsics §5.2's grant) may, and the same exception applies there. A visible alias whose module exports no type of the alias's own spelling adds nothing: resolution proceeds to whatever answered before it (at the boundary spellings, the boundary fallback — where it reaches), and where nothing answers, bare `Name` in type position is an error naming the working repairs (`P.Point`; realias as `Point`; or `import { Point }`). **`Alias.Name` in type position** resolves `Name` in the *exported type namespace* of the aliased module. **Constraint position carries the same fallback** *(extended in the #531 ruling)* — everywhere a bare name resolves in the constraint namespace: a binder's constraint list and an `honor` head alike. **`Name`** resolves in the constraint namespace first; where it has nothing and a module alias `Name` is visible whose module exports a constraint `Name`, the reference resolves to that exported constraint — answering, never binding, every property above holding one namespace over, and with conservativity exact and uncarved: the eleven pre-registered constraint names are always present (Constraints §5.1.1), so the fallback never fires at them, and no compiler-owned constraint fallback exists. The fallback carries **no members** — the named import remains the members-carrying idiom (§3.1), member spellings stay free, and the generalisation law's own route (§5.3: to widen a member, import the module, not the constraint) is thereby made one line rather than weakened. **`Alias.Name`** resolves in the aliased module's *exported constraint namespace* (§3.3).
3. **`Name` in term position** (applied or bare) resolves in the term namespace only — constructors, constraint members, ordinary bindings.
4. A module alias in **term position** other than the left of `.` is the "modules are not values" error (§3.3). Type and constraint positions are rule 2's to govern: the companion fallback where it answers, the boundary fallback after it (type position, at the boundary spellings — §5.5), and the refusal with its named repairs where nothing answers.

### 5.2 Collisions

- **Two module aliases with the same name** in one module: hard error at the second `import module` line — the one new collision rule.
- **Module alias vs type name, module alias vs constructor:** legal, resolved by position. This is deliberate and load-bearing: it is what makes the **companion-module idiom** — `Int` the type / `Int` the module, `Map`/`Map`, `Point`/`Point` — a *rule* rather than a prelude coincidence.
- **Named-import collisions** are hard errors at the import line: importing the same name from two modules, or importing a name the module also declares (in the same namespace). You wrote both lines; the fix is qualification or an `as` alias, and the error says so. (Cross-namespace coexistence — an imported constructor beside a local type of the same name — follows the ordinary namespace rules; only same-namespace duplicates collide.)
- **Constructor / module-alias coexistence** (bare `Shape` is a nullary constructor, `Shape.` is a module): **legal in v1.** The Elm-strict alternative (error, force a rename) is a **v2 candidate** to be adopted if field evidence shows confusion — tightening later is easy; loosening later is a design admission. The LSP hover should disambiguate in the meantime.

### 5.3 The companion-module idiom (blessed)

The intended pattern for opaque types: the home module exports the opaque type plus functions under its own roof, and consumers namespace-import it under the type's name.

```
-- point.hex
opaque record Point = {x: Float, y: Float}
export fun make(x: Float, y: Float): Point = Point({x = x, y = y})
export fun getX(p: Point): Float = p.x

-- consumer
import module Point from "./point"
let p = Point.make(1.0, 2.0)      -- Point. = module; Point in types = the type (§5.1 rule 2's companion fallback)
fun norm(p: Point): Float = ...
```

The prelude's `Int.div`, `Map.get`, `Vector.map` are this exact pattern — auto-imported companion modules, **one reading, not a special prelude device**. Two suppliers stand behind the one reading: a prelude companion's type name arrives by seeding (§5.5), a user companion's through §5.1 rule 2's companion fallback — and the consumer file cannot tell which *(#531: before the fallback existed, the example above did not compile, and this sentence said "one mechanism" — an overclaim at exactly the type level)*.

**Companion dispatch makes this idiom load-bearing** (Method Syntax §4): a dot call `p.getX()` rewrites to the companion operation of the receiver's type, and `CompanionOf` targets **the nominal type's home module** — the declaration site, unconditionally — not the importer's alias or any import path. The idiom is therefore a resolution rule's substrate, not just a style.

**Qualified access reaches honored members** *(#304/#335 — the uniform access principle)*. `Alias.name` resolves, in order: the module's exported terms; the members of constraints the module **declares** (§3.3's existing rule — the polymorphic read, which therefore wins on a declaring module that also honors); then the members of instances the module **honors at a type it declares** — a read that denotes the widens binding wherever a `widens` declaration supplies the member (Constraints §4.7; the generalisation law below): the qualified spelling shows the operation's widest face, never the derived restriction. `Rat.add(r1, r2)` denotes the `Num<Rat>` member; `Bool.show(flag)` denotes derived `Show<Bool>`'s. The governing principle: a consumer's spelling `M.f(…)` survives `f` migrating between a plain module function and a constraint member, in either direction, with no call site changing — which also means the member→function migration may narrow a signature, and the set `M.f` addresses is the module's-own-type call sites that survive it. A module honoring one constraint at **several** of its own types makes `M.f` ambiguous and takes §5.5's refusal posture, naming each honored type and the three unambiguous routes — the dot call on a value, the bare member call, and the declaring module's qualified spelling; companions honor at one type, so the idiom never meets it. The honored-member binding is **qualifiable, not a bare export** (Constraints §4.6's one-exporter law — bare `show` has exactly one exporter, `Show.hex`). For a **fixed prelude companion**, "a type it declares" reads as *the primitive it companions* (Constraints §5.3: the companion is the primitive's home module), so `BigInt.gcd` denotes `Integral<BigInt>`'s member exactly as `Rat.add` denotes `Num<Rat>`'s — and the conversions ride the same read: `BigInt.fromInt` is `Signed<BigInt>`'s member, one implementation whose qualified spelling survives the migration unmoved. Transitional note *(narrowing per companion — #344; now **discharged**)*: while a primitive's companion did not yet exist as source, the compiler-wired instances supplied the same qualified member spellings against the module-less name (`Float.show(1.5)` was the standing example — §6.4's qualified-home guarantee extended to members); each companion's migration milestone (stdlib-roadmap §5.2, intrinsics §9.2) replaced that machinery with the real module and retired the primitive's wired rows in the same change. With `Float.hex` and `String.hex` landed, all five companions are source, the transitional list is empty, and the machinery itself is gone — `Float.show(1.5)` is this section's ordinary honored-member read, and the note stands as the record of how the guarantee held through the migration.

**The generalisation law** *(#541; reach stated for #544; declared form #546)*. A companion may declare a **wider face** of a constraint member it honors at its own type — the `widens` declaration, whose form Constraints §4.7 owns: `widens Pow.pow(value: Float, exponent: Float): Float = …`, a module-level term binding whose name is *derived* from the member it names and which carries no `export` modifier. The law is layer-blind: the companion may be a stdlib primitive's home or any user type's, and the constraint a prelude one or one reached through a namespace import (§3.3) — its reach boundary is Constraints §4.6's, which the law carves and nothing else: the carve amends the honor-claim only and never unseats an ordinary binding of the member's spelling, so the form is unavailable in the constraint's own declaring module (where the spelling is the member's exported forwarder, and a module cannot qualify through itself) and beside members arrived through a named constraint import (§3.1 — where the import binds no module alias, the head's member path is unspellable and the doctrine self-enforces; where a namespace alias coexists, the declaration is refused with the repair hint). To widen a member, import the module, not the constraint. The declaration then claims the qualified spelling — the honored-member read above names the widens binding at exactly this case — and the law is what makes that claim lawful rather than a drift hazard: **the declaration must generalise the member**. It accepts every call the member accepts, agrees with the member everywhere their domains overlap, and the member **is the declaration's restriction — derived, not written** (Constraints §4.7): the honor block accounts for it with a `member = widened` line and holds no body of its own. The signature half is **checked** at the declaration, and must widen properly — an identical signature is the ill-formed delegation pattern, not a generalisation (Constraints §4.6 states the check); the agreement half holds **by construction**, one body restricted mechanically agreeing with itself — the drift the law once bound by review is no longer writable. A same-spelled export is the ordinary rebinding refusal, unconditionally, with the rewrite into the form where the export would have passed the check. **The widens binding is qualifiable, not a bare export** — it inherits the member's visibility rule (Constraints §4.6's last bullet) and is not an exporter for §5.5's bare-name collision count, so the bare member spelling keeps its one exporter, the constraint's declaring module, however many companions widen a member. Under the law the two bindings are one operation wearing two widths: the qualified spelling (and the dot call — Method Syntax §6.1) shows the widest face, the constraint member remains what the operator and a consumer's bare spelling elaborate to (within the honoring module itself, a bare use resolves to the widens binding — Constraints §4.6), and the §5.3 principle above — a consumer's spelling survives migration — holds by construction, because every call the narrower face answered is answered identically by the wider one. The standing instances are the two power doors: `Float.pow` over `Pow<Float>`'s member, `BigInt.pow` over `Pow<BigInt>`'s (Operators §6.3.1). Where no `widens` declaration exists, the qualified member spelling denotes the member itself, exactly as this section always read.

*(Ruling #125, 2026-07-28.)* The compiler-provided implementation of a companion operation is **not a third meaning of the shared name**: §5.1's resolution by position keeps exactly its two meanings, module and constructor. Intrinsic linkage is a declaration form owned by `spec/intrinsics.md`; the transitional practice of reaching an intrinsic through the companion's own public qualified name is deprecated there with a per-companion terminus (`intrinsics.md` §9). The idiom itself was examined under an explicitly widened scope and retained (`intrinsics.md` §2).

### 5.4 The prelude occlusion rule

The prelude enters every module's scope as a **distinct outermost layer**. The Head Binder Shadowing rule (Statements §5) keeps its statement for every layer the module writes itself — sequential binders never reuse a name from the module layer or any inner layer, nor one whose definition is in progress (Statements §5.1) — but the prelude layer is **shadowable at every binder position**, and shadowing it **reserves the name**:

- A **module-level** `let`/`fun` (or import, or a constraint's member, or a type-namespace declaration such as `record Seq(a)`, or a declaration's **constructor names** — a union's, a record's, or an exception's) **may occlude a prelude name**. `fun show(x) = ...` at module level is legal; the local `show` wins unqualified **module-wide**, and the prelude's version remains reachable qualified (`String.show` etc. — §6.4 guarantees a qualified home exists). *Module-wide* is enforced by reservation: the occluding item makes the prelude's binding invisible throughout the module, and every reference — outside a shadowing `let`'s or `var`'s own RHS, the pending-clause seam (Statements §5.1) that the wrapper idiom depends on — resolves **as if the prelude did not bind the name**. A reference above the occluder therefore behaves exactly as the same shape behaves at a user-written name: the declared-later error (Functions §7.2) above a binding, a declaration, or an import item (§3's import-shaped fixit), or the legal mutual reference within a contiguous `fun` group (Functions §7.3) — never, in any case, the prelude's meaning. Outside that one RHS seam, one identifier never carries two meanings in one scope. Explicit imports enter the *same* layer as local bindings and fight under the full ban.

  Constructor occlusion reads **pattern position and value position as one scope** — Functions §7.2 already governs both. A bare constructor pattern below the occluding declaration means the module's constructor; one above it draws §7.2's pattern-position declared-later error ("move the union's declaration above this use"); a module without an occluder keeps the prelude's constructor in patterns as everywhere else. The occluded prelude constructor stays reachable **qualified in both positions**: the §3.3 forms through a module alias, and the declaring prelude module's own name for prelude constructors — `Prelude.Less`, `Option.Some(v)`, in a pattern as in an expression. (`union Flag = True | Maybe` is therefore legal and occludes `True` module-wide; every context demanding `Bool` still demands it, so a strayed `Flag` constructor is a loud type error, and `Bool.True` remains spellable in both positions.)
- A **function-local sequential binder may shadow a prelude name** — the same grant, one layer in. Statements §5.1 rule 1 exempts the prelude layer from its collision set, for all four sequential forms alike: `let`, `var`, `fun`, and `let`-destructuring (`let {show, hash} = record` is legal, its punned fields shadowing two prelude names the pattern's author never wrote). The shadowed name is **reserved for the whole enclosing block** (Statements §5.1): references outside the binder's own RHS resolve as if the prelude did not bind the name, so a use above the binder takes the declared-later error rather than the prelude's meaning — the same reservation as at module level, and the two levels must never diverge.
- **The reverse is not granted.** A sequential binder still may not reuse a name from the module's own layers — a module-level binding, a parameter, another local. The exemption is tested against the layer of the binding actually in scope, not the name's ancestry: a module that has occluded `show` has moved `show` into its module layer, and a function-local `let show` below that occluder is the ordinary rule-1 error, citing the module's own line.

**In prelude source, "the prelude layer" is the module's §5.5 visible prefix** — the only prelude layer it has. The rule is otherwise identical: stdlib modules shadow and occlude their predecessors exactly as user code shadows and occludes the full prelude, so stdlib source pasted into a user module resolves its shadowed and occluded names the same way. (The paste is not unconditionally legal — a pasted constraint declaration meets §5.1.1's refusal, and a bare reference whose prefix had one exporter can meet the full set's §5.5 ambiguity; both are loud.) `Vector.hex`'s, `Map.hex`'s, and `Set.hex`'s own `empty` declarations are this reading's prior art at module level: each is an ordinary §5.4 occlusion of the `empty` exported by an earlier prefix member.

This section owns the module/prelude boundary referenced by Statements §5.2/§10.2. Without occlusion and the shadow grant, every addition to the prelude in a future release could break a program already using that name — untenable with no warning tier to soften it. Stated at the width the rules deliver: **adding a name to the prelude cannot break a program through a binder collision.** Not "cannot break a program at all" — two channels survive by design. A bare reference to a name that a *second* prelude module starts exporting becomes the §5.5 collided-name refusal (the use site must qualify), and the eleven pre-registered constraint names are refused as declarations outright (Constraints §5.1.1). Both are reference- or declaration-shaped breaks with mechanical fixes named in their diagnostics; neither is a binder collision.

Two adjacent facts, so the shadow grant is not overread:

- **A wrapper captures the bare-name spelling only.** A binding over a constraint member's name — `let show = (v) => "«" ++ show(v) ++ "»"`, legal at either level, its RHS reaching the prelude through the pending-binder clause (Statements §5.1) — reroutes calls spelled `show(…)` and nothing else. Elaboration-internal dispatch keeps its own routes (Constraints §6.1): string interpolation still uses the honored `Show` instance, `+` the honored `Num`, comparison the honored `Ord`. A stray binding must not redefine `+`; the price is that wrapping is weakest at exactly the names most worth wrapping.
- **`let` wraps; `fun` recurses.** `let show = (v) => "«" ++ show(v) ++ "»"` wraps the prelude's `show` once, because a `let`'s own name is absent for reference in its own RHS (Statements §5.1). `fun show(v) = "«" ++ show(v) ++ "»"` is a self-call — a `fun`'s own name is in scope in its own body (Functions §7.3) — and does not terminate. Same two words, opposite meanings, and no diagnostic distinguishes them; pre-existing for user-written names, reachable at prelude names wherever shadowing is.

### 5.5 The prelude is ordinary modules, in an ordered set *(added 2026-07-26)*

The prelude is a **fixed, ordered list of ordinary `.hex` modules** (canonical source under `stdlib/`), compiled like any project module and injected into the outermost scope layer of §5.4. Three rules make it a set rather than a heap:

- **Ordered intra-prelude visibility.** Each prelude module implicitly sees the prelude modules **before it in the list, and only those**. Cycles are impossible by construction; the list order is normative (`Option` precedes `Seq`; `Seq` precedes the collection modules that convert to it).
- **No `import` lines in prelude source.** Prelude modules use earlier prelude names implicitly, exactly as user code does. This is deliberate pedagogy: the stdlib is read as exemplary source, and an `import module Option from "./Option"` line at the top of a prelude module would teach every reader a false lesson about the language. *(This bullet also prescribed a **header comment** naming the implicitly-scoped prelude names — ``// `Option`, `Some`, and `None` are implicitly in scope via the prelude.`` — as the house form. **Withdrawn 2026-08-01**, James's direction, and the comments deleted with it. It restated, once per file, what this very section guarantees for every prelude module, and it named three of the prelude's names as though the rest were different. A reader who does not know that prelude names are in scope does not learn it from that list; a reader who does, reads it as noise. The no-`import` rule above is untouched — nothing about it needed a comment to hold.)*
- **A collided bare name is refused.** Two visible prelude members may export the same term name — the collection vocabulary is shared by design (Collections Part 1 §3.1: `Seq.length` and `Vector.length` are both correct spellings). Neither owns the bare one: a bare reference to a name that two or more *visible* members export is an error naming every qualified home (``write `Seq.empty`, `Vector.empty`, `Map.empty`, or `Set.empty` `` — four homes since `Set.hex` joined, #373) — the ML answer, where `List.map` and `Seq.map` coexist and the use site qualifies. The collision set follows visibility, so a prelude member whose visible predecessors export a name once keeps the bare spelling even while consumers must qualify it. Everything §5.4 grants is untouched: a module's own declaration, or an explicit import of one member's term, occludes the whole prelude layer, collided or not. Dot calls are the other unaffected spelling — dispatch is type-directed (Method Syntax §4.2) and never reads the bare-name layer, so `values.length()` needs no qualifier however many members export `length`. The rejected alternative — the seeding order silently deciding a winner — would re-mean every bare `empty` in every existing program each time a member joins the prelude: a language-wide edit made by a list order.
- **Type-declaring prelude modules are nothing special.** A prelude module may declare nominal types (`Option.hex` declares `union Option(a)`; `Seq.hex` declares `opaque record Seq(a)`, Loops §6.6). Such a declaration is an **ordinary declaration in the outermost layer**, subject to §5.4's occlusion rule like any other prelude name. **The compiler holds no resolution claim that outranks user declarations** — a name resolving to compiler-internal machinery *ahead of* a user's module-level declaration is a conformance defect against this section, not a feature. (Compiler-owned types that are deliberately *not* prelude-declared — the FFI boundary types `Array`, `Nullable`, and the hidden runtime `Node` — resolve as a fallback *after* declarations **and after §5.1 rule 2's companion fallback**, never before either; the rule 2 ordering (#531) is this sentence applied, since the companion fallback resolves to a user's declaration reached through the user's own import. Pre-registered constraint *names* are governed by Constraints §5.1.1 instead: all eleven are refused as declarations outright — a declaration-form error, not a resolution that outranks one, so this section's rule is untouched — and they are not prelude names for §5.4's occlusion rule; their *member* names remain ordinary occludable terms.)

The prelude's *inventory* remains owed to the stdlib listing (§6.4's qualified-home invariant applies to every member); this section owns only the mechanism.

---

## 6. What crosses a module boundary

### 6.1 Values and generalisation

Module-level `let`/`fun` bindings generalise per the existing rules (Functions §8; value restriction). Export adds nothing to generalisation: a module-level binding has its generalised scheme whether exported or not, and import conveys the scheme unchanged. Constrained exports carry their constraints; the importer's call sites discharge them exactly as local calls would.

### 6.2 Types

Exported nominal names are importable and qualifiable; identity is declaration-site (§2). Exported aliases remain transparent everywhere. Type parameters, arities, and `derives` travel with the declaration since they *are* the declaration.

### 6.3 What never crosses (because it never needs to)

Structural types (no home), instances (global, §7), `var` (cannot exist at module level), dictionaries (compiler plumbing, Constraints §1).

### 6.4 Pre-registered stdlib constraint

The occlusion rule's "prelude version stays reachable qualified" only works if **every prelude name has a qualified home** — a companion module it also lives in (`Vector.map` for bare `map`, `String.show`/per-type homes for `show`'s instances, etc.). The stdlib listing **must** maintain this invariant; a bare-only prelude export is a spec violation there. Pre-registered now, subject-first-convention style.

### 6.5 Constraints

An exported constraint crosses as a **reference to its declaration** (identity: Constraints §5.1.1). Subject, base constraints, member schemes, defaults, and implied type members do not travel separately — they are the declaration, and every importing module sees the one declaration the home module made. Its members cross as terms (§6.1) with their constrained schemes. Instances still never cross by name (§6.3): they are global already, and an imported constraint changes nothing about where its instances may lawfully live (§7.2 — the orphan rule's "home module" reads files, not imports).

---

## 7. Instances, coherence, and the orphan rule

### 7.1 Globality (restated, now operational)

Instances are visible program-wide once their module is in the import graph — not imported, not exported, not hidden (Constraints §5.3). `export honor` is the §4.1 error. The effect-import form (§3.4) can pull an otherwise-unreferenced instance home into the graph; §7.6 explains why that use is nearly vestigial in v1.

### 7.2 "Home module," operationally

The orphan rule's home module (Constraints §5.3) is defined: **the file whose text contains the declaration.** `honor C<T>` must appear in the file declaring `C` or the file declaring `T` (parameterized heads: `T`'s outermost constructor). Trivial under one-module-per-file; recorded so nothing subtler is ever read into it.

### 7.3 Duplicate-instance reporting point

Same-module duplicates error at the second declaration (unchanged). Cross-module duplicates error **at whole-program check, when the second module enters the import graph**, naming both modules and both declaration sites: "duplicate instance of `Ord<String>`: declared in `./a.hex` (line N) and `./b.hex` (line M)." The error is attributed to the program, not to either innocent-looking file — which is precisely why the orphan rule exists to make it nearly unreachable.

### 7.4 Instances on private types

Legal and harmless: an instance on an unexported type exists globally but nothing outside can name the type to reach it. `derives` on private and `opaque` types works unchanged (§4.2). No visibility check applies to instance heads; §4.3's private-in-public rule does not extend to `honor`.

### 7.5 Whole-program coherence: acknowledged cost

Coherence and orphan checking are defined **over the whole import graph**, which `hexc` sees today (whole-program compilation). Publishing compiled Hexagon as plain JS to npm loses instance metadata; cross-*package* coherence would require interface files. Known future cost, deliberately not solved here; recorded so the package story (§12.1) inherits it.

### 7.6 Instance discoverability

Globality (§7.1) plus the orphan rule (§7.2) make discoverability a near-non-problem in the ordinary case, with a bounded residue:

- **The ordinary case brings both legal homes along.** Source that names `C<T>` resolves `C` through the constraint's home and `T` through the type's home. With no v1 re-exports, both files are therefore already in the import graph (or are the same file), and the one lawful instance arrives without a separate import.
- **The residual cases** are (a) a value whose nominal type is *inferred* but never named by the consuming module — its own imports need not name either home even though the wider program graph reaches them through intermediaries — and (b) isolated-file checking (an editor or tool checking one file without the whole graph), where "in the graph" is not yet well-defined.
- **The diagnostic obligation:** a missing-`C<T>` error must name the two legal homes (or the one home when they coincide) — "no `Ord<Config>` instance is in the program; it could only be declared in `./config` (declares `Config`) or the module declaring `Ord`" — so the fix is a lookup, never a search. When the required constraint is not itself nameable in the reporting module — a private base constraint reached through an imported constraint's declaration (§6.5) — the two-home template is wrong: the subject's module is a lawful home in which the honor cannot be *written*, since the unexported base is reachable there by no import or alias. The diagnostic names the constraint's declaring module alone and directs the honor there.
- **The pre-1.0 LSP obligation:** when a lawful instance exists in the *workspace* but outside the current graph, the tooling must detect it and name the activating import.
- **Effect-import-for-instances is nearly vestigial in v1** as a consequence of the first bullet. Future re-exports or packages can make it load-bearing by separating names in scope from their instance homes; §13(i) records the spelling without presenting it as a daily idiom.
- **Packages and future re-exports widen the residue** (§12.1–§12.2): a facade that re-exports a type without its home module's instance context, or a package boundary hiding the home, recreates the discoverability gap at larger scale. The package design inherits this alongside §7.5's coherence cost.

---

## 8. Loading

### 8.1 Acyclic imports

An import cycle anywhere in the graph is a **hard error** naming the cycle: "import cycle: `./a` → `./b` → `./a`." No exceptions, including type-only cycles — a cycle is a cycle. Rationale: ESM permits cycles and they are a hazard swamp (bindings observable before initialization); F# is strictly acyclic and is the lineage; acyclicity yields the deterministic load order below and means emitted ESM never exercises JS's cycle semantics. Instances being evaluation-free (Constraints §6.3) removes the one pressure that might have argued for cycles. Mutually recursive *types* live in one module (Preamble §7.2 already grants order-insensitivity within a module); the diagnostic suggests exactly that.

### 8.2 Top-level effects and load order

Non-binding `Unit`-typed expressions are **legal at module top level** (`print("loaded")` — JS-style, per the existing block rules: Statements §3.2 polices non-`Unit` discards there exactly as in any block). Load order is fixed: **a module's imports are loaded depth-first in source order, each module exactly once, before the module's own top level runs** — ESM's order minus the cycle cases, well-defined because §8.1 bans those. Within a module, top-level items run in source order (type-namespace declarations are order-insensitive per their specs; term bindings — and value-position uses of constructors and constraint members — are read top-down, Functions §7.2; `let`s and effects run in order, with instance dictionaries emitted ahead of them all, Constraints §6.3).

### 8.3 Root modules; no special `main`

Hexagon has **no language-level entry function**. `main` is an ordinary non-uppercase-start identifier: it may be declared, exported, imported, or called, but the compiler never discovers or invokes it implicitly and assigns no special type to it.

A compiler host selects one or more **root modules**. Imports determine each root's acyclic graph. Building a root emits its ordinary ESM graph; running a root means asking the target host to evaluate that emitted root module. Its imports initialize and its top-level effects run exactly per §8.1–§8.2. No wrapper call or second program-order mechanism exists.

Library versus application is therefore not a distinction in Hexagon module semantics. The same module may be imported by another module or selected as a run root. Command spelling, project-file defaults, process arguments, and exit-code policy belong to compiler/host architecture; they cannot add a mandatory `main` or implicit parameters to the root module.

---

## 9. Rejected alternatives (do not re-litigate)

1. **ML module calculus** (functors, signatures, first-class modules — OCaml/SML): Hexagon's parameterization needs are met by type parameters and constraints; readable-JS has no good functor target; the intended user has never missed them; and "modules are fences, not forges" is the simpler story that HM-plus-constraints affords. Doubly foreclosed by "module aliases are not values" (§3.3).
2. **`module` header / in-file modules** (F#, Haskell): ceremony plus a name-vs-path drift hazard under one-module-per-file; declined with reasons at §2.
3. **Export lists** (Haskell, Elm): maximum control, but a second export mechanism that abandons the JS shape; `opaque` covers the one abstraction need the list was wanted for.
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
| Two module aliases, same name | hard error at second `import module` |
| JavaScript's namespace head `import * as` | parse error, Rewrite Rule: "namespace imports are spelled `import module Geo from "./geometry"`" (§3.3, #565) |
| Same-namespace named-import collision (import↔import or import↔local) | hard error at the import line; hint: "qualify one, or use `import { x as y }`" |
| Module alias used as a value | "modules are not values" |
| Module alias in type or constraint position, nothing answering (§5.1 rule 2 — the same-spelled export resolves via the companion fallback instead of erroring; the boundary spellings take the boundary fallback after it, where it reaches) | "`P` is a module alias, not a type; write `P.Point` for the type it exports, name it bare with `import { Point } from "./point"`, or realias as `import module Point`" — the exported inventory drives which repairs are named |
| `Name.` where `Name` is a type, not a module | "`Shape` is a type, not a module; …" (§5.1) |
| Alias case mismatch (`import { area as Area }`) | "alias case must match what it names" |
| Bare reference to a collided prelude name (§5.5) | ``the prelude name `empty` is ambiguous: exported by `Seq`, `Vector`, `Map`, and `Set`; write `Seq.empty`, `Vector.empty`, `Map.empty`, or `Set.empty` `` — every visible home enumerated, in prelude order *(fourth home since `Set.hex`, #373)* |
| Function-local sequential binder reusing a module-layer or local name | existing Statements §5.1 error, unchanged — the prelude layer is exempt (§5.4) |
| Use of a prelude name above the binder, declaration, or import that shadows or occludes it — bare constructor patterns included | whatever the same shape draws at a user-written name (§5.4 reservation): the Functions §7.2 declared-later error, with each shape's own fixit — "move the union's declaration above this use" in pattern position, "move the import above this use" above an import — never the prelude's meaning |
| Term reference above the import that binds it | "`area` is declared later in this block; declarations are read top-down — move the import above this use" (§3; Functions §7.2) |
| `export honor` | "instances are always visible; `export` does not apply" |
| `export default` | "Hexagon has named exports only" |
| Exported value without an annotation | "exported value `answer` requires a type annotation" |
| Exported function with missing parameter/result annotations | "exported function `f` requires a complete signature; add …" |
| Exported function with inferred but unwritten constraints | "exported function `f` must declare every constraint in its signature; write `<a: C>`" |
| Exported function restating an entailed base constraint | "exported function `f` must omit base constraint `Base` from `a`; `C` already provides it" |
| `export opaque` | parse error, Rewrite Rule: "`opaque` already exports the type name; write `opaque record Point = …`" — the rewrite is required, not advisory, and echoes the user's own declaration (`opaque union Handle = …` at a union head). This row presupposes a lawful subject: a crossed head whose subject is unlawful (`export opaque let x = 1`) draws the subject's own redirect below instead — the pair's rewrite would still be ill-formed, and the subject is the fault (ruled on #590) (§4.2) |
| `opaque` on `type` | "aliases are transparent; make it a `record` or single-constructor `union`" |
| `opaque` on `let`/`fun`/`constraint`/`exception` | parse error: "`opaque` applies to `record` and `union` declarations" |
| Opaque field access / construction / match outside home module | "`Point` is opaque outside `./point`; use its exported functions" |
| Private nominal type in exported face | "exported binding `parse` exposes private type `Token`; export the type, perhaps opaquely, or keep the binding private" — one family, the carrier's noun in both seats; a type carrier reports at the mention's seat, a binding at the binding, each with a label at the private type's declaration (§4.3) |
| Cross-module duplicate instance | "duplicate instance of `Ord<String>`: `./a.hex` (line N) and `./b.hex` (line M)" (§7.3) |
| Workspace instance outside the current graph (LSP) | existing Constraints §8 error + hint: "its instance is in `./x`; add `import \"./x\"`" (§7.6) |
| Bare package specifier in Hexagon `import` | "package imports are not yet supported" (§12.1); foreign `extern from` bare specifiers are legal (FFI Part 4 §2.1) |
| Uppercase-start name in a binder-pattern position matching an in-scope module alias | "`Json` is a module alias; module aliases are not binders — binders are non-uppercase-start; did you mean `json`?" (near-miss hint, same family as §5.1's type-not-module; Statements §9.2 origin) |
| Missing `C<T>` instance | names the legal homes (§7.6; two, or one if they coincide): "…could only be declared in `./config` (declares `Config`) or the module declaring `Ord`" |
| Qualified access to a name that is no export, declared member, or honored member | the existing "module `X` does not export `Y`" — the two member reads (§5.3) happen before it, never after |
| `Alias.name` where the module honors one constraint at several of its own types | §5.5-family refusal naming each honored type and the three unambiguous routes: the dot call on a value, the bare member call, and the declaring module's qualified spelling (§5.3) |
| Declared variance the representation does not support | hard error at the declaration naming a **witness occurrence**: "`a` cannot be declared covariant in `Seq`: field `consume` uses `a` in argument position. Remove the `+`, or change the field" — plus a **required** secondary label at the witness occurrence's span (hosts render it as file:line; the location never appears in the message text) (§4.2.1, #205/#207, message form revised 2026-08-01) |

---

## 11. Emission

1. **One module → one ESM module.** `export` → `export`; unexported bindings → plain `const`/`function`. Privacy is enforced by the Hexagon checker; the emitted JS simply doesn't export what wasn't exported.
2. **Named imports always.** Because module aliases are not values, every `Geo.area` resolves at compile time to a specific export; the emitter uses named ESM imports (`import { area } from "./geometry.js"`) **even when the source used the namespace form** — tree-shakeable, readable, no runtime namespace objects. (An emitted `import * as` — JavaScript's own namespace form, a spelling that survives only in emission now that source spells the head `import module` (§3.3, #565) — is permitted where the emitter judges it more readable for heavy qualified use; semantics identical either way.) **The emitter may likewise add a named import a resolved companion dot call requires even when the source never textually imported the companion module** (Method Syntax §8.2) — the same liberty, exercised for calls the checker resolved; emitted-name collisions are the emitter's ordinary renaming problem.
3. **Load order** is ESM's own, valid because the graph is acyclic (§8.1). Effect imports emit as bare `import "./telemetry.js"`.
4. **`.d.ts`:** exported terms and types appear; private ones don't — for a private type, no line of any kind, a non-exported `type` declaration included. §4.3's face rule is what makes that possible: no exported face can mention a private nominal, so no `.d.ts` row ever needs one declared. Private aliases in exported faces appear as their expansion (§4.3). An exported opaque record or union uses FFI Part 7 §5's brand-only face: one non-exported `unique symbol` per type, with no honest fields or constructors exposed — not an exception to the sentence above, since the brand line belongs to an *exported* type. The brand is TypeScript-only; runtime representation and identity are unchanged.
5. **Instances** remain global compiler-selected declarations and are never nameable from Hexagon. At the JavaScript boundary, every instance satisfying FFI Part 9 §5's public-evidence closure forces a stable module-level handle or factory export from the instance declaration's home module, with its `Constraint.Dictionary<a>` face in `.d.ts`; this capability exists independently of current consumption. Private instances remain plumbing. Fundamental specializations are dictionary-free (FFI Part 8).

---

## 12. Hanging questions (recorded, not decided)

1. **Package resolution.** Bare specifiers reserved (§2); node_modules-style resolution, a lockfile story, and cross-package coherence via interface files (§7.5) are one connected future design — which also inherits §7.6's instance-discoverability residue, since package boundaries and facades widen it. *Needed by:* first external-library milestone.
2. **Re-exports** (`export { x } from "./m"`): deferred as *source syntax*; the facade-module pattern will eventually want it; declined for v1 to keep export = declaration prefix, one rule. (FFI facade emission that re-exports extern bindings — FFI Parts 4 §7 / 7 §1 — is emitter output shape and introduces **no** Hexagon re-export syntax.) A landed design also inherits §7.6's discoverability note.
3. **Elm-strict constructor/module-alias coexistence** — v2 candidate on field evidence (§5.2).
4. **Selective import of constraint members** — presumed never needed (§3.1); revisit only on concrete demand. The presumption survived its first concrete probe (#544): a door-builder wanting the constraint bare without its members (the complement form — members staying home) was considered and declined, because the namespace import already carries that module shape at the cost of one qualification in the honor head *(a cost since retired in the companion-named case: §5.1 rule 2's constraint fallback (#531) lets the same-spelled alias answer the bare head — the outcome this item declined a new import form for, arrived at by resolution instead; the selective-import form stays declined)*.
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
let p = Point({x = 1.0, y = 2.0})              -- constructor: imported
fun f(q: Point): Float = q.x                 -- type: imported; fields visible (not opaque)

-- (c) Opaque is a black box outside home
-- point.hex: opaque record Point = {x: Float, y: Float}
--            export fun make(x: Float, y: Float): Point = Point({x = x, y = y})
-- (the pre-#590 pair is refused with the required rewrite:)
-- export opaque record Point = ...           -- ERROR: opaque already exports the
--                                            --   type name; write opaque record
--                                            --   Point = ...
import module Point from "./point"
let p = Point.make(1.0, 2.0)                 -- OK
p.x                                          -- ERROR: Point is opaque outside ./point
match p                                      -- ERROR: same
    Point(r) => ...

-- (d) Companion idiom: alias/type/constructor coexistence
import module Point from "./point"
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

-- (f) Named-import collision
import { area } from "./circle"
import { area } from "./rect"                -- ERROR: area already imported; alias one

-- (g) Cycle
-- a.hex: import { b } from "./b"
-- b.hex: import { a } from "./a"            -- ERROR: import cycle: ./a → ./b → ./a

-- (h) Private-in-public
union Token = Word(s: String) | Gap          -- private
export fun parse(s: String): Vector(Token) = ...
-- ERROR: exported binding parse exposes private type Token; export the
-- type, perhaps opaquely, or keep the binding private

export record Cursor = {at: Int, token: Token}
-- ERROR (at the field annotation): exported record Cursor exposes private
-- type Token; export the type, perhaps opaquely, or keep the record private

-- (i) Instance globality + effect import (legal but normally redundant in v1,
--     §7.6; Config's home is one of the only legal instance homes)
-- config.hex: record Config = ...; honor Ord<Config> = ...
import "./config"                            -- no names; instance now in the graph
sort(configs)                                -- OK

-- (j) Cross-module duplicate instance
-- a.hex: honor Show<Weird> = ...        -- (a.hex declares Weird: home, legal)
-- b.hex: honor Show<Weird> = ...        -- ERROR at program check: duplicate
                                             -- instance of Show<Weird>:
                                             -- ./a.hex (line N) and ./b.hex (line M)
                                             -- (b.hex also violates the orphan rule)

-- (k) Emission: namespace form still emits named imports
import module Geo from "./geometry"
Geo.area(2.0)
-- emits: import { area } from "./geometry.js";  area(2.0);

-- (l) Transparent representation reaches through an un-imported home (§4.2)
-- crate.hex: export record Crate = {n: Float}
-- mid.hex:   import { Crate } from "./crate"
--            export fun make(value: Float): Crate = Crate({n = value})
import { make } from "./mid"                 -- Crate never imported here, in any form
make(1.5).n                                  -- OK: fields travel with the type
make(1.5).m                                  -- ERROR: Crate has fields n, not m
                                             --   (known fields named — never empty)
```

---

## 14. Decisions log

| Decision | Where |
|---|---|
| One module per file; no `module` header; path = identity; importer names | §1, §2 |
| Structural types have no home module; their instances are compiler-derived only | §2; Constraints §9.3 |
| JS-verbatim imports — named, `as` aliases, effect imports — with the namespace head respelled `import module`, the surface's one deviation (#565); items import across all exported namespaces; record import = type + constructor; union constructors imported severally | §3 |
| Module aliases: uppercase, not values; qualified access in term, type, and pattern position | §3.3 |
| `export` = declaration prefix exporting everything introduced; no default exports; no re-exports (v1) | §4.1 |
| Exported terms require complete annotations; constrained functions explicitly list maximal constraints and omit entailed bases; private module-level function guidance remains style | §4.1.1 |
| One head visibility slot, three values — absent / `export` / `opaque`; `export opaque` refused with the required rewrite (#590). `opaque` on `record`/`union`: type name only; fields/constructors/matching private outside home; derives unaffected; home module unaffected | §4, §4.2 |
| Transparent representation visibility travels with the type (sole-authority rule): field access, update, and the bare copy are import-insensitive; imports carry names (constructor and its pattern included); no intermediary or per-signature re-abstraction | §4.2 |
| Private-in-public: hard error for the module's **own** nominal types at every exported face — `export`ed binding signatures, alias targets, record fields, union and exception payloads, never an `opaque` declaration's interior, never an elsewhere-declared type — reported once per type per carrier; a type carrier at the mention's seat, a binding at the binding, a label at the private type's declaration; transparent aliases exempt (expansion used, and a private expansion refused the same) | §4.3 |
| Fourth namespace (module aliases); position-based resolution; `Name.` checks modules first | §5.1 |
| Collisions: duplicate module aliases error; alias-vs-type/constructor legal (companion idiom blessed); named-import same-namespace collisions error; Elm-strict restriction = v2 candidate | §5.2, §12.3 |
| Importing a constraint binds the name and its members; aliasing renames the constraint name only, members never rename at the border; member collisions report at the import item; namespace imports qualify constraints and members through the alias | §3.1–§3.3, §5.1 |
| An exported constraint crosses as a reference to its declaration (identity: Constraints §5.1.1); members cross as terms; instance globality and the orphan rule's file-based home unchanged | §6.5 |
| Prelude shadowing: sequential binders, imports, and declarations — constructor names included — may shadow the prelude layer at every level, name reserved for the whole enclosing scope (references resolve as if the prelude did not bind it, patterns included); the module's own layers stay under the full ban; Head Binder rule untouched in statement | §5.4 |
| Prelude = ordered set of ordinary `.hex` modules; each sees only earlier members; no `import` lines in prelude source (the header-comment convention that accompanied that rule is **withdrawn 2026-08-01**); type-declaring members ordinary; compiler resolution never outranks declarations (boundary intrinsics = fallback only) | §5.5 |
| Every prelude name must have a qualified home (stdlib invariant, pre-registered) | §6.4 |
| Instances never exported/imported/hidden; home module = containing file; cross-module duplicates reported at whole-program check naming both sites; instances on private types legal; whole-program coherence cost acknowledged | §7 |
| Discoverability: ordinary `C<T>` use brings both legal homes into the graph; residue = inferred-never-named types and isolated-file checking; missing-instance diagnostics name the legal homes; pre-1.0 LSP names the activating import; effect-import nearly vestigial; packages/re-exports widen the residue | §7.6 |
| Companion dispatch targets the nominal type's home module (idiom load-bearing); emitter may add companion-call named imports | §5.3, §11.2 |
| Imports acyclic, hard error, incl. type-only; deterministic depth-first load order; top-level `Unit` effects legal; selected root module runs through ordinary ESM evaluation; no special `main` | §8 |
| ML calculus, headers, export lists, `(..)` sugar, default exports, single-namespace, F# priority stack, unified paths, cycles: rejected with reasons | §9 |
| Emission: 1:1 ESM; named imports even for namespace form; exported opaque types use FFI Part 7's private-symbol branded `.d.ts` face | §11 |
| Five hanging questions recorded | §12 |
| Intrinsic linkage is a declaration (`extern from "hex:intrinsic"`), never a third resolution meaning; companion idiom retained under widened #125 scope; public-name and primitive doors deprecated per-companion | §5.3 note; `spec/intrinsics.md` |
| Variance claims on parameterized opaque exports: `+a`/`-a` declared, bare = invariant (the empty claim); verified in the home module against the representation; over-claim errors at the declaration with a witness occurrence; claims read uniformly, home module included; what crosses an opaque boundary is declared, never inferred (#205) | §4.2.1; closure doc `decisions-ml-dialect-generalization-2026-08.md` §6 |
| Over-claim witness location: carried by a required secondary diagnostic label at the witness occurrence's span, never by file:line text in the message; the message names the field and the position (2026-08-01, #205/#207) | §4.2.1, §10; closure doc §13.1 |
| Qualified access reaches honored members (#304/#335, uniform access principle): resolution order exports → declared-constraint members → members honored at the module's own type; several-own-types → §5.5-family refusal naming the three routes; member binding qualifiable but never a bare export (one-exporter law); the wired-primitive transitional route served until the companion arc completed *(discharged with the last landing, #344 — see the row below)* | §5.3, §10; Constraints §4.6 |
| **A fixed prelude companion's "own type" is its primitive** (#344): qualified access reaches instances honored at the companioned primitive (`BigInt.gcd` = `Integral<BigInt>`'s member); the transitional wired route died per companion in the fixed order and is **gone** — all five companions are source (`BigInt`, `Int`, `Nat`, `Float`, `String`, #344) | §5.3; Constraints §5.3 |
