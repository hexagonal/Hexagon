# Hexagon FFI Part 7: Hexagon Exports and TypeScript Declarations

**Status:** Decided (July 2026), revised in place after external review (Sol) before landing; §2.2 and §12.1 amended 2026-08-02 — a polymorphic non-function declaration faces as its `never` instantiation, generalizing §12.1 beyond nullary constructors — see correction record §14.1; §2.1 amended and §2.4 added 2026-08-04 — cross-module Hexagon types in faces take type-only named imports (#227) — see correction record §14.2; §6 and §11 amended — exported exceptions ship boundary guards (`.is`, `isHexError`), the one hard error this part owns (#478). Normative promotion of `spec/notes/ffi-proto-spec-questions.md` §7, plus the export-surface pieces earlier parts assigned here: the exact opaque-brand `.d.ts` form (Part 4 §12.3), stable export wrappers' emission rules (Parts 3/6), and the discharge of Modules §11.4's deferred opaque-representation question. The draft's three clarifications were confirmed in §12: generic nullary constants use the `never` instantiation; export forces stable constructor materialization; and all four opaque-faced families use one non-exported-`unique symbol` brand mechanism. Inherits: generated opaque brands for exported extern types, never re-exported foreign typings; raw identity for representation-direct functions; stable module-level wrappers where adapted signatures or receiver conventions require them, with fresh per-value adapters remaining distinct from those named callable wrappers (Part 6 §1); exported Hexagon `Unit` functions genuinely returning `undefined` (Part 6 §3.2); the `Error & {$hex: "<module>"; ...}` exception face (Exceptions §7.5, brand value per #488); constrained exports referenced but governed by Parts 8–9.
**Scope:** ESM export correspondence; the generated `.d.ts` (structure, the `Hex` namespace import, lowercase Hexagon-originated generic binders, cross-module type imports); records; unions, exported constructors, and the all-nullary representation cliff; opaque branded values — the uniform brand for `opaque` types, extern types, and extern class types; exceptions, including the nullary function-shape difference; direct exports versus stable wrappers; edit notes discharging flags in Modules, Unions, and Exceptions.
**Not in scope:** the specialization and generic-edition machinery for constrained exports (Part 8, `ffi-zero-cost-fundamental-exports.md`) and dictionary types, handles, and factories (Part 9, `ffi-part9-exported-dictionaries.md`); extern declaration syntax (Parts 4–5); calling convention (Part 6); `JsMap`/`JsSet` and `JsValue` faces (finalized by Parts 10–11).
**Companions:** Modules §4/§11 (export semantics; ESM emission; the §11.4 deferral); Unions §6 (representations, the cliff, constructor emission, `.d.ts`); Products §5.4 (record constructor erasure); Exceptions §7 (branded representation, `.d.ts`, construction sites); Part 1 §4/§8 (master table; `Hex` namespace); Part 3 §9.1 (exported `Seq` replayability); Part 6 §1/§3 (wrapper list; `Unit`); Part 8 §3.4/§6 (zero-entry-point exception; Algorithm N collisions).

---

## 1. Doctrine: export correspondence

**Hexagon's existing `export` is the sole foreign-export permission.** Every exported declaration becomes an ordinary **named** ESM export where it has a runtime term, and appears in the generated `.d.ts` where it has a public type face. There is no second `export ffi` system, no per-declaration foreign-visibility annotation, and **no automatic default export** — the compiled facade is named-exports-only, in both emitted JS and `.d.ts`.

Consequences, fixed here:

- **Unexported declarations do not exist at the boundary** (Modules §11.1): no ESM export, no `.d.ts` mention. Private aliases inside exported signatures appear as their expansion (Modules §11.4).
- **A declaration may have a type face and no runtime term** (an `opaque` type with no exported operations, an extern `type`): it appears in `.d.ts` only. The converse — a term with no useful type face — does not arise; every exported term is declared.
- **The one stated exception to export correspondence** remains Part 8 §3.4's zero-entry-point constrained export, whose doctrine record (Part 8 §17.2) is not modified here.
- **No wrapper performs general defensive validation** (Part 1 §1). Exported signatures are trusted contracts; explicit decoders keep their own checked semantics.
- **Constraint instances and dictionaries never appear in `.d.ts`** except through Parts 8–9's deliberate surfaces (Constraints §6.4; Modules §11.5).

Representation-direct values and functions export directly with **stable ESM identity**:

```hexagon
export let version: String = "1.0"
export let double(x: Int): Int = x * 2
```

```js
export const version = "1.0";
export function double(x) { return x * 2; }
```

```ts
export declare const version: string;
export declare function double(x: number): number;
```

The exported function is the emitted function — raw identity, no indirection (Part 6 §1). An exported `Unit`-returning function genuinely returns `undefined`; its `void` face is honest with no discarding needed (Part 6 §3.2).

---

## 2. The generated `.d.ts`

### 2.1 Structure

One Hexagon module emits one ESM module and one `.d.ts` (Modules §11). A generated `.d.ts` that mentions Hexagon-owned runtime types carries exactly one type-only namespace import (Part 1 §8):

```ts
import type * as Hex from "@hexagon/runtime";
```

giving the faces `Hex.Vector<a>`, `Hex.Map<k, v>`, `Hex.Set<a>`, and `Hex.Range`. The import is type-only and adds no emitted JavaScript dependency. The compiler controls the alias: it tries `Hex`, then `Hex_1`, `Hex_2`, … and takes the first candidate colliding with no top-level identifier the module's items can put in that `.d.ts`, regardless of TypeScript namespace (§2.4). Only the generated alias is renamed; user exports never are (Part 1 §10; Part 12 §11.1).

**A compiler-chosen `.d.ts` spelling takes an underscore before its numeric suffix** — the idiom the emitted JavaScript already uses (#425) — and every probe in this part counts the same way: this alias, §2.4's minted locals, §5's brands. The unsuffixed spelling is unchanged everywhere; the suffix stays collision-only, so a probe that has not had to move emits the text it always did. The underscore is single on purpose: Lexer §3.2 reserves the *leading* `__` for generated names, and Part 7's probed spellings are faces a TypeScript reader looks at, not hygiene names — `Hex__1` would echo the reserved prefix without being under it, so the doubled form is refused.

The `Hex` import is the only **namespace** import the compiler *synthesizes*: a source-level namespace import's line is the module's own, carried into the `.d.ts` where a face reaches through the alias and left out where none does (§2.4). It is not, however, the only import the compiler writes — a face mentioning a type owned by another *Hexagon module* may take a type-only **named** import of it, minted by the compiler where nothing the source wrote names that type here (§2.4; correction records §14.2, §14.3).

### 2.2 Lowercase Hexagon-originated generic binders

**All generic binders in Hexagon-originated declarations use the lowercase Hexagon convention** — `a`, `b`, `k`, `v`, matching the source type variables:

```ts
export declare function head<a>(items: Hex.Vector<a>): Option<a>;
export type Option<a> = {tag: "Some"; value: a} | {tag: "None"};
```

TypeScript is case-agnostic about binder names, so nothing is lost; what is gained is that a generated declaration visibly carries its Hexagon origin and matches the hover/diagnostic types a mixed-codebase developer sees on the Hexagon side. Declared-source binder order is preserved (it is ABI-relevant under Parts 8–9's suffix rules).

*(Amended 2026-08-02, §14.1.)* This rule presumes a declaration with somewhere to write the binders. A `declare const` whose type is not a function type has no such seat, and its quantified variables are **instantiated** rather than bound — §14.1.

### 2.3 Type faces

Per-type faces are Part 1 §4.1's table, not restated: tuples as TS tuple types, structural records as structural object types, `Nullable(a)` as `a | null | undefined`, `Array(a)` as `ReadonlyArray<a>`, `Seq(a)` as `Iterable<a>` (with the exported value stronger than its face — replayable, Part 3 §9.1), `Unit` as `void` in return position. This part adds only the declaration-generation rules for the nominal families below.

### 2.4 Cross-module Hexagon types in faces

A face may mention a nominal type owned by another Hexagon module: `Seq.hex`'s `next` returns `Option([a, Seq(a)])`, and `Option` is `Option.hex`'s. TypeScript resolves nothing by project-wide scope, so an unimported name is unbound (TS2304) — or, worse, bound by the consumer's configuration: under the default `lib` set a bare `Option` lands on `lib.dom.d.ts`'s legacy `Option` constructor, and which declaration the name means is then decided by the consumer's `lib` and `types` settings rather than by this compiler. A generated `.d.ts` therefore **names every nominal its faces mention under a spelling that file itself binds**:

```ts
import type { Option } from "./Option.js";
export declare const next: <a>(source: Iterable<a>) => Option<[a, Iterable<a>]>;
```

A face **identifies** a type and never spells one — the discipline of the `Bool`/`Seq` pins, and the reason occlusion (Modules §5.4) cannot mislead it. What the file *calls* that type is a second question, and one datum answered both until they came apart: one record is `Point` where it is declared, `LibPoint` where an import renamed it, and `Lib.Point` at a seat the source qualified, and none of those is the type's own property.

A qualifier in particular is **not a name for the type**. It names a *binding* — the import item this occurrence reached the type through — and so carries the module whose scope holds that binding as well as the local it is bound under. Two things follow, and rung 3 rests on both: a reference to a binding means nothing where the binding is not, which is why only the writing module may read one back; and a qualifier is not type information, so a pass that rewrites types has no reason to preserve it, and an occurrence's must be carried deliberately where one does. §2.3's **pinned faces are settled before the sink is asked**: in a rendered face, prelude `Bool` is `boolean` and prelude `Seq(a)` is `Iterable<a>` however the occurrence spelled them, qualified or bare, and neither imports anything. A pin governs faces and not declaration seats: `Seq.hex`'s own `.d.ts` still declares its §5 brand type under its own name. For `Seq` that declaration and the pinned face are assignable in neither direction and no generated face will ever spell the declared name — §5 and §2.3 both firing on one type, **fenced to #622**. A consumer names a `Seq` by `Iterable<a>`. What is left the declaration file resolves through one sink, which answers in this order — by identity at every rung but the third, which reads the occurrence, for the reason given there:

1. **This module declares the identity** — the **bare name**. A declaration occludes (Modules §5.4), and a module's own type is its own to spell.

2. **A source-written *named* import binds it** — that import's **local**. A source rename is respected and the faces spell the local: `import { Color as LibColor }` emits `import type { Color as LibColor }` and the faces say `LibColor`. This holds *including where the same imported name also binds a term*: `import { Point } from "./geometry"` binds both the record type and its constructor (§3), and the term half must not cost the `.d.ts` its type half — the emitted JavaScript carries the term import, the `.d.ts` carries `import type { Point }`.

3. **The occurrence is qualified through a *namespace* import's alias** (Modules §3.3) — **`Alias.Name`**, the spelling the source wrote at that seat:

   ```hexagon
   import module Lib from "./lib"
   export fun mk(p: Lib.Point): Lib.Point = p
   ```

   ```ts
   import type * as Lib from "./lib.js";
   export declare function mk(p: Lib.Point): Lib.Point;
   ```

   This rung, alone among the five, reads the **occurrence** and not only the identity. It has to: an identity does not determine a qualifier. A module may name one type two ways — qualified at one seat, and bare at another where Modules §5.1 rule 2's companion fallback puts the exported member's own name in scope — and two namespace imports of the same module under different aliases are both legal, so neither alias is *the* one. A bare occurrence is therefore not this rung's: it falls to rung 5, and each seat of the `.d.ts` says what the source said at that seat.

   **The qualifier is carried by the typed occurrence, not looked up from the syntax.** Two things follow. Every nominal in an exported face *has* such an occurrence, because the checker admits no exported binding without a complete written signature (`` exported value `c` requires a type annotation ``, and the matching refusal for a function missing a parameter or return annotation), and record fields, union payloads, exception payloads and extern rows are written too — which is what makes this rung total. And a declaration the compiler **derives** from a signature rather than rendering from one — a fundamental specialization (Parts 8–9), a constructor arrow, a stable export wrapper (Part 6 §1) — inherits the qualifiers of the scheme it was derived from, since they ride the type and survive its substitution. A signature written bare inherits bare, and its derivations fall to rung 5 with it.

   **A qualifier is readable only in the module that wrote it** — it names a binding, and a binding reference is meaningless where the binding is not. It is worse than meaningless where a type crosses a module boundary carrying one — a type alias's expansion travels with the qualifiers its *writer* used (§1) — because the importer may bind that same alias to a different module, and the face would then name a real type that is the wrong one, with nothing to report it. Rung 3 therefore answers only for a qualifier **this module itself wrote** — the alias *binding*, not its spelling. A qualifier that arrived on a type from another module is not an occurrence here however it is spelled, and falls to rung 5; that a module of its own binds an alias of the same spelling makes no difference, and is exactly the case where reading the spelling would publish another module's type under this one's name. No derived declaration loses anything: each is emitted by the module that wrote its signature.

   The prelude never reaches this rung. Its modules carry no `import` lines at all (Modules §3.4), so no prelude signature can hold a qualifier, and a prelude identity arrives at rung 4 — or through an expansion at rung 5 — bare.

4. **The prelude's type inventory** (Modules §5.5) — the entry's own name, or a probed local where this module has taken the bare spelling. The resolver publishes, per module, the prelude's importable type inventory: exported unions, records, and extern types, each with its owning member's specifier, in normative prelude order. Type aliases have no entry, because faces carry their expansion (§1, Modules §11.4).

   Occlusion takes only the bare spelling. A module whose own declaration occludes a prelude type name (Modules §5.4) renders and exports its *own* type bare, while the prelude identity stays reachable **qualified** (`Prelude.Ordering` — Modules §5.4, §6.4), so it can still appear in an exported face — and it then imports under a probed local, the bare name being the module's own:

   ```ts
   import type { Ordering as Ordering_1 } from "./Prelude.js";
   export type Ordering = "Asc" | "Desc";
   export declare const f: (x: Ordering_1) => number;
   ```

5. **No rung above answers for this occurrence** — the file **mints its own import**, `import type { Name as Local }` from the identity's home module. The local is the type's own name, so a bare occurrence stays bare; it moves only under the probe below, and against a namespace alias only where the file actually carries that alias's line. This rung is not a fallback kept for tidiness. It carries the bare occurrences rung 3 declines, and it carries a nominal this module names under no spelling whatever: faces hold a type alias's *expansion* rather than its name (§1, Modules §11.4), and an importer that binds only the alias binds nothing the expansion mentions.

   One identity can reach both rungs in one module — qualified at one seat, bare at another — and then the file carries **two** lines for it and spells it two ways: the qualified seat through the alias, and the bare seat through a minted local which the probe has moved aside, the alias's line now being present to contest it. TypeScript binds both to the same declaration.

An exported **face** cannot mention a type its owner keeps private — the checker refuses it at every carrier a face has: an `export`ed binding's signature, a type alias's target, a record's fields, a union constructor's payload, an exception's payload (Modules §4.3, `` exported binding `probe` exposes private type `Hidden`; export the type, perhaps opaquely, or keep the binding private ``, the carrier's own noun in each; an `opaque` declaration's interior has no face and is no carrier) — so no rung is ever asked for an identity its home module withholds: every nominal a face reaches is exported, perhaps opaquely, somewhere, and rung 1 in particular is never asked to answer with a name the file does not bind *(#621; correction record §14.4)*.

**The file's imports are exactly what its answers owe.** Rung 1 owes nothing: the declaration it names is one this file already carries, save in the shapes fenced above. Rungs 2 through 5 each owe the line their answer is spelled through, and a line no answer owes is not written. This is candidates-then-filter, the architecture of prelude instance evidence (#153) and the synthesized term import (#263): the resolver decides availability, emission decides what is imported, and neither is inferred from the other. Three consequences are worth stating outright:

- **An import no face reached through contributes no line**, whichever form the source wrote. The declaration file is not a transcription of the module's import list; it carries what its faces need. A module importing a companion for its *terms* — the common case, and the whole of the companion idiom — emits no declaration-side line for it, and so cannot collide on its alias; a named import whose type half no face mentions is left out on the same rule.
- **Imports are counted per answer, not per module.** A module contributing two types contributes two statements, which is ordinary ESM; the instance-evidence channel does the same on the JavaScript side. One type answered at two rungs likewise contributes two, as rung 5 records.
- **An occurrence an earlier rung answered is never minted.** That rung took it over, the same take-over the term side already performs. This reaches the prelude channel too: an inventory identity the source qualified through a namespace alias is rung 3's, so the inventory line it would otherwise owe is not written and the face reads `O.Option` rather than `Option`.

**Where the alias is contested.** Modules §5.2 makes `import module Point from "./point"` beside a declared `Point` legal — it is the companion idiom, not an accident — so rung 3's `Point.Point` can meet a top-level `Point` this same file emits. Modules §11.2 assigns emitted-name collisions to the emitter as its ordinary renaming problem; this is that problem's answer here, and it is the answer the emitted JavaScript already gives. **The alias yields the bare spelling to the declaration.** The declaration is, or may become, the module's public face; the alias is internal to the file, reaching it on its own import line and in the qualified faces that line serves, and nowhere else.

A yielding alias is **a source name stepping aside, not a spelling the compiler minted**, so it takes the collision-only suffix its emitted-JavaScript counterpart takes — `Point_1`, counting from `_1` — rather than the probe below, whose subject is names the compiler made up. Lexer §3.2's reserved prefix belongs to generated names, and this is not one.

The declaration file decides this **independently of the emitted JavaScript**, and the two may differ. They must: their collision universes are not the same — the JavaScript file binds terms, the declaration file binds types and `declare const`s — so an alias forced to move in one can sit uncontested in the other. Neither choice is observable, because an alias is exported from neither file.

**A minted local is probed like `Hex`** (§2.1): the type's own name first, then `Option_1`, `Option_2`, … against the file's top-level identifier universe (below), the settled runtime alias, and the minted locals already assigned. Only spellings the compiler minted move this way, and a user *export* never moves at all (Part 1 §10). At least three routes reach the probe today: an exported *constructor* sharing a prelude type's name — constructors are uppercase top-level `.d.ts` identifiers (§3–§4); an occluding declaration beside a qualified face of the occluded identity; and an import alias, which can spell any identifier.

**That universe is a property of the module, not of the rendering.** It is every top-level identifier the module's items *can* put in the file, and it is deliberately a superset on one axis: whether a declaration reaches the file depends on its being exported and on its kind, and re-deciding that here would be a second copy of conditions stated elsewhere. Over-claiming costs at most a moved compiler-chosen spelling; under-claiming costs a `.d.ts` that does not compile.

A **namespace alias** is the one member of the universe that is not over-claimed at all. It counts **exactly where the file carries its line** — which is to say, where some **rendered face** is answered at rung 3 through it. Criterion and reason are one sentence on purpose: an alias absent from the emitted text contests nothing in it, and counting an absent one would move a minted local aside for a name the reader cannot find, which is the failure this rung order exists to avoid.

A written dot is not enough, and three things keep one from counting: §2.3's pins, applied ahead of the sink; an earlier rung, rung 2's local outranking rung 3 at a qualified seat as much as at a bare one; and an occurrence that reaches **no rendered face** — a qualifier in an unexported binding's signature, or in a type written inside a body, spells nothing this file publishes. The rule is stated on the emitted line rather than on that list, so a rung or a pin added later cannot leave the list stale.

None of it is a rendering question. The faces a file will render are known from the module's items — its exported declarations' types, and the shape of a private union, which reaches the file though its name does not leave the module — and collecting the qualifiers those carry is a walk over them that produces no text, so the universe is complete before any spelling is chosen and the probe still runs once and early. What that walk must not become is a second, drifting copy of the conditions under which a face is rendered: where the two could disagree it errs **narrow**, since a face this walk misses costs a qualified spelling and nothing else, while one it invents moves a minted local aside for a name the file does not contain — the failure this whole criterion exists to prevent.

**Placement.** Compiler-written imports precede the module's own items: the `Hex` runtime import first (§2.1), then rung 4's in inventory order, then rung 5's ordered by home specifier and then by imported name. Rung 5 has no inventory to follow and must not fall back on first reference, for the reason the inventory rule exists — emitted text may not depend on where in the module a face happens to sit. A line rung 2 or rung 3 owes keeps its source position — it is the module's own import, not the compiler's — and is simply absent where no answer owed it. Where one identity is answered at both rung 3 and rung 5, its two lines sit in their two regions accordingly; nothing merges them.

**Reachability.** A module a face imports from is part of the emitted program even when no term reaches it: a face can name `Option` while the JavaScript touches no `Option` term, so these edges — the only ones with no JavaScript counterpart — count toward what gets emitted, or the `.d.ts` would import from a file that was never written. Rung 5 adds edges of the same kind to modules the source never imported at all, and they count identically. The edge is declaration-side only; no JavaScript import is added (a bare side-effect import is a load-order dependency the source never wrote — the #263 doctrine, unchanged).

**What never imports:** the pinned faces (prelude `Bool` as `boolean`, prelude `Seq(a)` as `Iterable<a>` — §2.3, settled ahead of the sink above, so no rung sees them), structural faces, a **type** alias's own name, and the `Hex.*` runtime types (§2.1's namespace owns those). A type alias's *expansion* is a different question, and it is rung 5's.

**Scope.** The **TypeScript faces** of the shipped `.d.ts`, and nothing else in that file: the generated `Hexagon:` face documentation renders its types on the Hexagon side, by its own renderer, and is not this section's (§2.2, Part 8). The inspection-only TypeScript preview also keeps bare names: it is one pane of text with nothing to import from (the constraint behind Part 1 §8.3 obligation 6's inline namespace), and the divergence is recorded here rather than left to be rediscovered.

---

## 3. Records

An exported non-opaque record exports its type and its constructor (Modules §4.1). Both cross:

```hexagon
export record Point = {x: Float, y: Float}
```

```ts
export type Point = {x: number; y: number};
export declare function Point(value: {x: number; y: number}): Point;
```

- The runtime constructor **may be the representation-honest identity function** — `Point` already *is* the POJO (Products §5.4). Emitter's choice; the exported function's existence and identity stability are the contract.
- JavaScript may also construct the structural object directly; the exported constructor provides the supported, discoverable shape and is what generated documentation points at.
- Inside Hexagon-emitted code, direct constructor applications still erase into object literals (Products §5.4); **export forces the constructor function to be materialized** as a module-level ESM export with stable identity. Erasure at internal call sites is unaffected.

---

## 4. Unions

An exported non-opaque union exports its type and **every constructor**, exactly as it does between Hexagon modules (Modules §3.1). The three constructor shapes follow the representation (Unions §6):

**Mixed/payload union** — payload constructors are JS functions; nullary constructors are the shared module-level constants:

```hexagon
export union Shape = Circle(radius: Float) | Point
```

```ts
export type Shape =
  | {tag: "Circle"; radius: number}
  | {tag: "Point"};

export declare function Circle(radius: number): Shape;
export declare const Point: Shape;
```

**All-nullary union** — constructors are string constants:

```hexagon
export union Color = Red | Green | Blue
```

```ts
export type Color = "Red" | "Green" | "Blue";
export declare const Red: Color;
export declare const Green: Color;
export declare const Blue: Color;
```

Rules fixed here:

- **Export forces materialization.** As with records, a payload constructor referenced only in erased direct applications must still exist as a real exported function (Unions §6.4's on-demand materialization becomes mandatory at export), with stable ESM identity. Nullary POJO constructors are already the shared constants; string constructors are the string constants.
- **Constructor return types are the union type** (`Shape`), not the narrowed member — the constructor is the supported entry point to the union, and the narrow member types remain anonymous arms of the declared alias.
- **Generic unions** emit lowercase binders (§2.2): `export declare function Some<a>(value: a): Option<a>;`.
- **Generic nullary constructors** are single shared runtime constants across all instantiations (Unions §6.1 — types erase), and their `.d.ts` face uses the `never` instantiation, which TypeScript's structural checking accepts at every use type:

  ```ts
  export declare const None: Option<never>;
  ```

  This is the review-confirmed polymorphic constant face (§12.1).

### 4.1 The ABI warning: the union representation cliff

Generated FFI documentation **must** state:

> An all-nullary union is represented as string literals. Adding the first payload-bearing constructor changes the complete union representation to tagged objects and is a breaking change for JavaScript consumers.

Hexagon callers are protected by recompilation and `match`; JavaScript consumers are not. Adding any constructor is already an exhaustiveness break for JS switches, but the first payload-bearing addition also changes the representation of every existing constructor (Unions §6.2's cliff, restated at the boundary where it bites). The emitter should additionally place a doc comment carrying this warning on each exported all-nullary union's `.d.ts` declaration; the documentation obligation is normative, the comment placement representative.

---

## 5. Opaque branded values: the uniform brand

`opaque record` and `opaque union` export **the type only**: raw fields and constructors are absent from JavaScript exports and `.d.ts`, while explicitly exported smart constructors and accessors cross as ordinary functions. The TypeScript face hides the representation behind a private `unique symbol` brand:

```hexagon
opaque record UserId = {value: Int}
export fun parse(text: String): Option(UserId) = ...
```

```ts
declare const userIdBrand: unique symbol;
export type UserId = {readonly [userIdBrand]: never};

export declare function parse(text: string): Option<UserId>;
```

**This brand form is uniform across everything Hexagon exports opaquely** — `opaque record`, `opaque union`, exported extern `type`, and exported extern class types (Part 4 §12.3; Part 5 §6.1). One mechanism, one reading: "a nominal Hexagon-governed value; obtain and use it through the exported functions."

Rules fixed here:

- **The brand is TypeScript-only.** No runtime wrapper, tag, or validation is added; the existing erased runtime value (or foreign object, for extern types) crosses out and back **by identity**. TypeScript discourages structural fabrication; untyped JavaScript remains governed by the trusted-boundary contract (Part 1 §3.1).
- **One brand symbol per exported type**, declared `declare const <name>Brand: unique symbol` and **not exported** — the symbol is unnameable outside the declaration file, which is what makes the type unforgeable in TS. The `<name>Brand` spelling is representative; per-type uniqueness within the file and stability of the *type's* name are the contract, and identifier collisions are the emitter's ordinary renaming problem: a moved brand takes §2.1's underscore suffix, `<name>Brand_1` — a brand already looks like a type, so it aliases like one — and its probes stay outside Lexer §3.2's reserved `__` prefix, a brand being a face, not a hygiene name.
- **Extern types are never re-exports of foreign typings** (Part 4 §12.3, resolved): the brand is generated even when the foreign package ships its own declarations, because the extern `type` is a nominal Hexagon contract, not an endorsement of the foreign package's structural type.
- This discharges **Modules §11.4's deferred opaque-representation question** in favor of branded types; the honest-fields interim caveat ends when this part lands (edit note, §10).

*(Note, 2026-07-28, defect 12 ruling.)* The "no runtime wrapper, tag, or validation is added" clause forbids **boundary artifacts** — things attached at the crossing. It does not forbid a type's *representation* from carrying protocol members everywhere: `Seq`'s boundary traversal method (Part 3 §9.4), like `Range`/`Map`/`Set`'s `[Symbol.iterator]`, is part of the value from construction, so the value still crosses out and back by identity, unmodified at the crossing. The identity clause is moreover now *delivered* for `Seq` in the inbound direction: a genuine `Seq` handed back at a `Seq(a)` position passes through Part 3 §2.2's door by identity rather than being re-adapted. (`Seq`'s `.d.ts` face itself remains `Iterable<a>` per §2.3 and Part 3 §9.1, not this section's brand — that carve-out predates the ruling and is unchanged.)

---

## 6. Exceptions

An exported payload exception provides its branded `Error` type (Exceptions §7.5's intersection face, unchanged) and a JS constructor function:

```hexagon
export exception ParseError(line: Int, message: String)
```

```ts
export type ParseError = Error & {
  readonly $hex: "Parser";
  readonly name: "ParseError";
  readonly line: number;
};

export declare function ParseError(
  line: number,
  message: string,
): ParseError;
```

Parameters follow declared slot order; a declared `message` slot feeds the `Error` message (Exceptions §7.1); unnamed slots face as `item1…itemN`.

**A nullary exception is value-shaped in Hexagon source but function-shaped for JavaScript consumers:**

```ts
export declare function NotFound(): NotFound;
```

Each JS call constructs a fresh branded `Error` and captures the call-site stack. Exporting one constant would capture a stale module-initialization stack and violate the fresh-nullary-exception semantics (Exceptions §7.3). This is a deliberate, documented surface difference:

> Hexagon writes `throw(NotFound)`; JavaScript writes `throw NotFound()`.

The exported constructor is an ordinary function with stable ESM identity; the brand — `$hex` carrying the declaring module's path identity (#488; Exceptions §7.1 fixes the spelling: root-relative path, injected modules by canonical name) — appears in the face deliberately (Exceptions §7.5) so JS-side construction is done correctly or not at all: the literal in the face is the exact string a JS constructor-writer copies. This discharges the constructor-export flags in Exceptions §7.5 and Unions §6.5 (edit notes, §10).

**Every exported exception also ships its guard** *(#478; Exceptions §7.6)*. The constructor function carries a property `is`, declared by function/namespace merge so the property types as a predicate and the consumer's branch narrows to the intersection face:

```ts
export declare function ParseError(line: number, message: string): ParseError;
export declare namespace ParseError {
  function is(err: unknown): err is ParseError;
}
```

At runtime the property is assigned once, beside the constructor: `ParseError.is = (err) => err != null && err.$hex === "Parser" && err.name === "ParseError";` — #488's (module, name) identity. Nullary exceptions carry the same property on their function-shaped export. The property seat spends no export name and has no collision rule — no Hexagon surface can occupy it.

A module that exports at least one exception additionally exports the stage-1 guard:

```ts
export declare function isHexError(
  err: unknown,
): err is Error & { readonly $hex: string; readonly name: string };
```

`isHexError` is a generated public **face** — deliberately outside Lexer §3.2's `__` prefix — and a fixed name, so its collision with an explicit export of the same module is the Part 8 §6.2 family's hard error (both sites named; the fix is a source rename, never a silent one). **`JsError` ships no `is` guard**: its wrapping is virtual (Exceptions §6.2), so outside that section's exotic first-class residue a JS consumer never receives a branded `"JsError"` — the foreign branch of their discrimination is `!isHexError(err)`.

**Generated `@throws` tags** *(#479)*: a documented exported declaration whose doc content carries throws manifests (``Throws `X` when <condition>.``, Doc Comments §6.1) gains a generated `@throws {X} when <condition>` line per manifest in its JSDoc block — one block, user content first, the generated-content position (Doc Comments §7.3–§7.4) — in both emitted artifacts. Documentation, not typing: nothing verifies the declaration throws what it documents.

---

## 7. Direct exports versus stable wrappers

**Export directly when the runtime value already has its declared JS representation**: primitives, `Nullable`, `Array`, genuine `Hex.Vector`/`Hex.Map`/`Hex.Set` values, records and unions, opaque erased values, exceptions, and representation-direct functions and callbacks. Direct export means the ESM binding *is* the runtime value or emitted function — raw identity, no indirection (Part 6 §1).

**Generate one stable module-level boundary wrapper only when a supported top-level signature needs adaptation or calling-convention plumbing.** The v1 occasions are exactly Part 6 §1's table:

1. an incoming `Iterable<a>` parameter declared as `Seq(a)` (the wrapper performs Part 3's crossing at each call — and each adapted value receives a **fresh per-value adapter**, Part 3 §2.1; the named callable wrapper and the per-value adapter remain distinct objects with distinct lifetimes). *(Sharpened 2026-07-28, defect 12 ruling:)* the crossing is Part 3 §2.2's **inbound door** — a genuine `Seq` argument passes by identity (§6), any other iterable is adapted freshly. Hexagon importers call the same ESM binding and therefore the same wrapper; the identity pass-through makes it semantically transparent to them, at one recognition check per `Seq`-typed argument per cross-module call. The wrapper exists only for `Seq` parameters; `Seq` **results** and `Seq` **value exports** need no wrapper — the value carries its face by representation (Part 3 §9.4);
2. exported extern receiver members, whose ESM export is Part 5 §2.3's stable convention-preserving wrapper (there is no raw property function to export);
3. a generic constrained export with trailing dictionary evidence **when ABI plumbing makes a wrapper necessary** (shape governed by Parts 8–9). If the internal function already has the public trailing-evidence ABI, it exports directly; Part 9's rule does not require an identity-only wrapper.

*(Edit note, 2026-08-02, defect 12's implementation.)* **Where occasion 1 meets a constrained export: it follows the published face.** A constrained export's face is its fundamental specializations (§8, Part 8); the trailing-evidence generic edition ships under an internal name that appears in no `.d.ts` and exists as Hexagon-to-Hexagon plumbing. So each specialization with a top-level `Seq(a)` parameter takes occasion 1's stable wrapper — those are the bindings a JavaScript caller is invited to hand an `Iterable<a>` — and the internal edition takes none: a door there would tax every cross-module Hexagon constrained call to serve a caller the published face says does not exist. JavaScript reaching the internal name is off the face entirely and stays Part 1 §3.1's territory, as it always was.

**The wrapper is allocated once with the ESM binding, not per reference or call, so its JS identity is stable** — a JS consumer storing, comparing, or deregistering the export observes one function forever. No wrapper validates its inputs (§1).

Exported extern bindings re-export per Part 4 §7; their `.d.ts` faces follow this part's rules (extern types as §5 brands, extern callables as ordinary function declarations against their declared faces).

---

## 8. Constrained exports (reference only)

An exported constrained-polymorphic declaration is governed by **Part 8** (`ffi-zero-cost-fundamental-exports.md`): unconditional dictionary-free named specializations over the closed fundamental set, plus the conditional base-name generic edition with trailing evidence under Algorithm G's trigger. Dictionary types (`Signed.Dictionary<a>`), public evidence handles, parameterized factories, and suffix ABI are governed by **Part 9** (`ffi-part9-exported-dictionaries.md`). This part adds nothing to either; it records only that:

- generated specializations and generic editions obey this part's general rules — named ESM exports, lowercase binders (§2.2), stable identity, no defensive validation;
- generated-name collisions with explicit exports are Part 8 §6.2's hard errors, not a new rule here.

---

## 9. Acceptance sketches

```hexagon
-- (a) Direct value/function exports (§1)
export let version: String = "1.0"         -- export const version; const version: string
export let double(x: Int): Int = x * 2     -- export function double; raw identity

-- (b) Record: type + identity-permitted constructor (§3)
export record Point = {x: Float, y: Float}

-- (c) Union constructors materialized at export (§4)
export union Shape = Circle(radius: Float) | Point
-- JS: export function Circle(radius) { return {tag: "Circle", radius}; }
--     export const Point = {tag: "Point"};
-- internal Circle(2.0) still erases to the literal

-- (d) All-nullary: strings + the documented cliff (§4.1)
export union Color = Red | Green | Blue    -- export const Red = "Red"; ...

-- (e) Opaque: brand only; smart constructor crosses (§5)
opaque record UserId = {value: Int}
export fun parse(text: String): Option(UserId) = ...
-- .d.ts: declare const userIdBrand: unique symbol; export type UserId = ...

-- (f) Nullary exception: function-shaped for JS (§6)
export exception NotFound
-- .d.ts: export declare function NotFound(): NotFound;
-- JS:    throw NotFound();    Hexagon:    throw(NotFound)

-- (g) Adapted signature: one stable wrapper, fresh per-value adapters (§7)
export let sum(xs: Seq(Int)): Int = ...
-- .d.ts: export declare function sum(xs: Iterable<number>): number;
-- JS consumers see one stable `sum` identity; each call adapts its argument freshly
```

---

## 10. Companion-spec discharges

- **Modules §11.4:** the deferred `opaque`-in-`.d.ts` representation is decided as generated `unique symbol` brands (§5); the honest-fields interim license has ended.
- **Products §5.4:** export is a mandatory materialization site for a record constructor, while direct internal applications still erase (§3).
- **Unions §6.4–§6.5:** export is a mandatory materialization site, and exported unions declare every constructor as a function, POJO constant, or string constant (§4).
- **Exceptions §7.5:** exported exceptions ship constructor functions; nullary exceptions are function-shaped and construct freshly per call (§6).

---

## 11. Diagnostics checklist

This part introduces **one hard error of its own** — #478's `isHexError` collision (§6), the Part 8 §6.2 family applied to a fixed generated face. Every other boundary-shape and collision error it relies on lands elsewhere:

| Situation | Owner |
|---|---|
| `isHexError` colliding with an explicit export of an exception-exporting module | **this part, §6** (Part 8 §6.2 family: hard error, both sites named, source-rename fixit) |
| generated specialization name colliding with an explicit export | Part 8 §6.2 (Algorithm N; hard error) |
| adapter-requiring type nested in an exported signature | Part 1 §5.3 |
| adapter-requiring callback signature in an exported function | Part 6 §5.4 |
| `Hex` alias collision in a generated `.d.ts` | deterministic emitter resolution, Part 1 §8 — not a user error |
| brand-identifier collision in a generated `.d.ts` | emitter renaming, §5 — not a user error |

---

## 12. Review resolutions

### 12.1 Generic nullary constructor faces use the `never` instantiation (§4)

**Confirmed:** `export declare const None: Option<never>;`. The single shared runtime constant needs one `.d.ts` type, and `never` is the instantiation TypeScript's structural checking accepts wherever any `Option<T>` is expected (the `None` arm carries no payload for variance to bite on). A per-use generic function face misdescribes the value and breaks identity idioms; `unknown` is not assignable to specific instantiations.

*(Generalized 2026-08-02, §14.1.)* The reasoning above is not about constructors: it is about a **`declare const` with nowhere to put a quantifier**. §14.1 states it as the general rule for every polymorphic non-function declaration this part generates, of which a generic nullary constructor is one case.

### 12.2 Export forces constructor materialization (§3–§4)

**Confirmed.** Export is a mandatory demand site with stable ESM identity, while internal direct applications continue to erase. This follows §1's correspondence doctrine: an exported constructor term must exist as a named ESM export.

### 12.3 One uniform brand mechanism (§5)

**Confirmed.** Opaque records, opaque unions, extern types, and extern class types all use the single non-exported-`unique symbol` form. The symbol remains private to the declaration file; the runtime representation remains untouched.

---

## 13. Decisions log (quick reference)

| Decision | Where |
|---|---|
| `export` is the sole foreign-export permission; named ESM exports only; no default exports; no `export ffi`; type-only faces legal; zero-entry-point exception stays Part 8 §3.4's | §1 |
| Representation-direct values/functions export directly with stable ESM identity; exported `Unit` functions genuinely return `undefined`; no defensive validation anywhere | §1, §7 |
| One module → one ESM module + one `.d.ts`; single type-only `import type * as Hex from "@hexagon/runtime"` where runtime types appear | §2.1 |
| All Hexagon-originated `.d.ts` generic binders are lowercase source-style (`a`, `k`, `v`); declared binder order preserved (ABI-relevant per Parts 8–9) | §2.2 |
| Records: type + constructor export; constructor may be the identity function; direct JS construction legal but the exported constructor is the supported shape | §3 |
| Unions: type + every constructor; payload constructors as functions, mixed-union nullaries as shared constants, all-nullary as string constants; constructor return types are the union type; export forces materialization | §4, §12.2 |
| Generic nullary constants face as the `never` instantiation (confirmed at review) | §4, §12.1 |
| The union representation cliff warning is a normative generated-documentation obligation (+ representative `.d.ts` doc comment) | §4.1 |
| Uniform opaque brand: non-exported `unique symbol`, brand-only type face, TS-only (no runtime artifact), identity crossing; covers opaque records/unions, extern types, extern class types; never re-exported foreign typings; discharges Modules §11.4 | §5, §12.3 |
| Exceptions: intersection face with `$hex` included; payload constructors in slot order; **nullary exceptions function-shaped for JS with fresh call-site stack** (`throw(NotFound)` vs `throw NotFound()`) | §6 |
| Boundary guards (#478): `.is` property on every exported exception constructor (function/namespace merge; predicate to the intersection face); `isHexError` per exception-exporting module; fixed face, §6.2-family collision hard error; `JsError` guardless | §6, §11 |
| Direct-vs-wrapper rule: direct wherever representation and public ABI match; one stable module-level wrapper for adapted top-level positions, exported receiver members, and constrained generic editions only when ABI plumbing requires it; wrapper identity stable (once per ESM binding); per-value adapters remain distinct | §7 |
| Constrained exports referenced only; Parts 8–9 govern; generated exports obey this part's naming/binder/identity rules; collisions stay Part 8 §6.2 | §8 |
| Companion specs discharged: Modules §11.4, Products §5.4, Unions §6.4–§6.5, Exceptions §7.5 | §10 |
| *(2026-07-28, defect 12 ruling)* Occasion 1 sharpened: the wrapper's crossing is Part 3 §2.2's inbound door (genuine `Seq` by identity); wrappers exist for `Seq` parameters only — results and value exports are honest by representation (Part 3 §9.4); §6's no-runtime-artifact clause clarified as forbidding boundary artifacts, not representation members | §6, §7 |
| *(2026-08-02, defect 12's implementation)* Occasion 1 follows the published face into constrained exports: fundamental specializations with top-level `Seq(a)` parameters take wrappers; the internal trailing-evidence edition, absent from the `.d.ts`, takes none | §7 |
| *(2026-08-02, #132)* A polymorphic **non-function** declaration faces as its `never` instantiation — quantified type variables at `never`, a quantified row tail at the empty row — because a `declare const` has no seat for the quantifier. Generalizes §12.1 from nullary constructors to every such declaration; governs the inspection preview too (the row-tail and preview halves are the implementing seat's, owed James's ruling) | §14.1 |
| *(2026-08-04, #227)* A generated `.d.ts` carries a type-only named import for every other-module Hexagon type its faces mention: a source-written import owns every name it binds (a term+type name keeps its type row), prelude-supplied types ride a resolver-published inventory filtered to what the faces reference, and generated locals are probed like `Hex`. The preview keeps bare names | §2.4, §14.2 |
| *(#574, #268, #617, #618)* A `.d.ts` names a nominal through one sink, answering in order: the module's own declaration, a named import's local, the alias a **qualified occurrence** was written through, the prelude inventory, then an import the file mints itself. The file's imports are exactly what those answers owe, so an import no face reached through emits no line; where a declaration contests a qualified alias, the alias yields the bare spelling and steps aside to `_1` as a source name, deciding independently of the emitted JavaScript | §2.4, §14.3 |
| *(#621)* The boundary rule reads every carrier an exported face has — an `export`ed binding's signature, an alias's target, a record's fields, a union constructor's payload, an exception's payload; never an `opaque` declaration's interior — one message family with the carrier's noun, a type carrier reporting at the offending mention's seat, once per type per carrier, a label at the private type's declaration; a private union contributes no shipped `.d.ts` row, the preview unchanged | §2.4, §14.4 |

---

## 14. Correction records

Recorded per house rule (`method-syntax.md` §16 precedent, `collections-part1-decisions.md` §10 form): origin, rationale, consequences with owners, rejected alternatives marked do-not-relitigate. Section numbers are stable; the body text each record amends carries a pointer to it.

### 14.1 A polymorphic non-function declaration faces as its `never` instantiation (2026-08-02, #132)

**Authority.** Two halves, and they are not equally new. The `never` instantiation itself is **§12.1's confirmed decision, enforced past the one family it was written about** — §12.1's reasoning ("a `declare const` … needs one `.d.ts` type"; "`unknown` is not assignable to specific instantiations") never depended on the value being a union constructor, and this record adds no argument to it. The **row-tail half** and the **preview's inclusion in scope** are genuinely new, and they were written by the implementing seat with the defect in hand: they are recorded here as proposed, and **owed James's ruling** — flagged rather than assumed, because no other record in this corpus treats an implementer's decision as self-ratifying.

**Origin.** `stdlib/Seq.hex` exports one polymorphic value that is not a function:

```hexagon
export let empty: Seq(a) = Seq({pull = () => None})
```

Its declaration was generated by naming the source binder, as §2.2 says to — and a `declare const` has nowhere to *bind* that name, so the emitted row referenced a type variable no declaration introduced:

```ts
export declare const empty: Iterable<a>;   // TS2304: Cannot find name 'a'.
```

One row, and the whole of `Seq`'s published face was invalid TypeScript. Every other polymorphic export in the module is function-typed, and a function type carries its own `<a>` seat, which is why nothing had caught it: `empty` was the prelude's only polymorphic non-function export.

**The rule.** Where this part generates a declaration whose type is **not a function type**, the scheme's quantified variables are **instantiated, not bound**:

- a quantified **type variable** stands at `never`;
- a quantified **row tail** stands at the empty row — it contributes no fields, and the intersection is dropped rather than written `& never`, which would collapse the whole record to `never`.

```ts
export declare const empty: Iterable<never>;
export declare const None: Option<never>;                       // §12.1, unchanged
export declare const table: Iterable<Option<never>>;            // nested, same rule
                                                                // (from `export let table: Seq(Option(a))`)
export declare const next: <a>(source: Iterable<a>) => Option<[a, Iterable<a>]>;   // function: §2.2 binds
```

**Why it is honest.** The value's type *is* ∀a. T(a), so T[`never`/a] is one of the value's types. The face therefore states a genuine instantiation and never over-describes the Hexagon value; what it gives up is re-generalization, since TypeScript will not recover the other instantiations from this one.

Whether a JavaScript consumer may nonetheless *use* the face at another instantiation is TypeScript's assignability question, not Hexagon's, and the answer is not uniform. Measured with `tsc --strict --lib es2022`, TypeScript 7.0.2:

| From `never` to a concrete instantiation | TypeScript |
|---|---|
| covariant faces — `Iterable<never>`, `Option<never>`, a union arm | accepted, and sound |
| `ReadonlySet<never>`, `ReadonlyMap<never, never>` | accepted, by TypeScript's method-parameter bivariance |
| `Array<never>` → `Array<number>`, then `.push(1)` | **accepted, and not sound** — TypeScript's own mutable-array hole, not this rule's |
| a function-typed property (`{push: (x: never) => void}`) | refused, TS2322 |

The rule is stated for the first row, which is the shape a polymorphic constant is for — a producer with nothing in it yet (`empty`, `None`).

**The unsound third row is not this rule's doing and cannot be closed by it: it belongs to the face table.** TypeScript's mutable `Array<T>` is covariant, so *no* two instantiations of it widen soundly — `Array<number>` → `Array<number | string>` then `.push("x")` is accepted just as `Array<never>` → `Array<number>` then `.push(1)` is (both verified). `never` is where the hole bites hardest, not where it comes from; the immutable spelling `ReadonlyArray<never>` → `ReadonlyArray<number>` is accepted *and* sound. So the question this rule cannot answer is **which Hexagon types get a mutable TypeScript face**, and that is Part 1 §4.1's and §2.3's. Two faces were mutable when this record was written, and neither left this rule anything to do; since #228's fix (2026-08-04, `0134ce1`) only `Node`'s remains:

- **`Array(a)`** is *decided* as `ReadonlyArray<a>` (Part 1 §4.1; §2.3; Part 2 §6.1, "no mutation surface") and the emitter wrote `Array<a>` anyway — a pre-existing divergence, filed as **#228** and fixed 2026-08-04 (`0134ce1`): the emitter now writes the decided `ReadonlyArray<a>`, which closed the row for `Array` at the right door — `never` was not the defect there, the mutable face was. The fix is pinned by real `tsc` runs (`compiler/src/conformance/array-readonly-face.test.ts`): the mutation surface is refused, and the `ReadonlyArray<never>` → `ReadonlyArray<number>` widening is accepted and sound, exercised end-to-end through an emitted polymorphic function face (a polymorphic `Array(a)`-typed *value* cannot be constructed — generic extern declarations are not part of v1 — so this rule's non-function path still has no `Array` specimen).
- **`Node(a)`** faces as `Array<a>` deliberately — the honest shape of the hidden trie node — and is compiler-internal: exporting a binding that exposes it is already a hard error, so it reaches the inspection preview and no shipped `.d.ts`. In a privileged runtime module, `let n = Node.empty()` does preview as `declare const n: Array<never>;` (verified). That is the mutable-face hole showing through an internal surface, and it is correct that the preview shows the shape the value actually has.

**The coupling, recorded at the right door: a decision to give a Hexagon type a *mutable* TypeScript face must state what its polymorphic values face as**, because one word is not enough there. Do not re-derive this from the variance of the Hexagon type: Hexagon-side variance and TypeScript-side assignability are different relations, and `Node` — a covariant row in the generalization ruling's claim table (§5.3) — is exactly the case where they part company. In particular the generalization ruling **does not** stop a variable from being generalized into a mutable face: its variance clause gates *expansive* bindings only (§4.1), so a syntactic value generalizes regardless of variance, and `export let f: {consume: (a) -> Unit} = {consume = (x) => ()}` compiles clean today to `{consume: (arg0: never) => void}`.

The fourth row is a usability limit, stated so it is not rediscovered as a defect: **a Hexagon author who wants such a value usable across instantiations at the boundary exports a function instead**, which restores the quantifier seat §2.2 uses.

`never` over the alternatives, on TypeScript's own assignability (re-verified at this ruling, `tsc --strict`, TypeScript 7.0.2): `Iterable<never>` is assignable to `Iterable<number>`; `Iterable<unknown>` is not (TS2322). This is §12.1's reason, and this record's only change to it is scope.

**Scope.** The rule governs **both** generated TypeScript artifacts: the shipped `.d.ts`, and the inspection-only TypeScript preview an interactive host shows (the Playground's declarations pane), which additionally covers *unexported* bindings and so meets un-annotated, row-polymorphic schemes the boundary itself never sees. A **constrained** polymorphic export is untouched: its face is its fundamental specializations (§8, Part 8), not one declaration.

**Consequences, with owners:**

- `renderScheme` (`compiler/src/passes/emitter/emitter.ts`) instantiates instead of naming on its non-function path; the record case drops an empty-row tail. Conformance: `compiler/src/conformance/polymorphic-value-face.test.ts`. Its `tsc` round covers what it can compile in isolation — the exported `Iterable<never>` face with a consumer that uses it at two instantiations, the preview's forms, and a negative control on the pre-fix spelling; the faces that name another module's type were text comparisons only while #227 made them unresolvable in a file of their own *(discharged 2026-08-04, §14.2 — such a face now compiles alongside its sibling declaration files, and the conformance for that lives with §2.4's)*. **What `tsc` cannot decide is the row-tail rule**: `({x: never} & never)` is perfectly good TypeScript, just wrong, so that half is pinned by the emitted text and by the mutation that produces it, not by the compiler.
- **The preview now shows the same polymorphism two ways, and that is a cost of the Scope paragraph rather than a defect.** `let field = (r) => r.x` previews as `<a, b>(r: ({ x: a } & b)) => a` while `let pair = (field, 1)` previews as `[(arg0: { x: never }) => never, number]` — one function, generic in one row and instantiated in the next, because the second binding's *type* is not a function type even though the thing inside it is. The `.d.ts` cannot meet this (an exported value must be annotated, and an annotation cannot spell an open row); only the preview can, and the alternative — leaving the preview to print unbound binders — is worse.
- **`Seq.d.ts` still does not compile, for an unrelated reason — recorded so it is not read as this ruling's failure.** Its faces name `Option`, a type owned by another Hexagon module, and a generated `.d.ts` emits no import for it (§2.1 fixes only the `Hex` namespace import). Filed as **#227**, which also carries the ruling owed on cross-module type imports *(ruled and fixed 2026-08-04 — §2.4, correction record §14.2)*. #132's issue text asserted the unbound binder was "the only error in the file"; that was true of TS2304s only, and is corrected here.
- §2.2 and §12.1 carry pointers to this record.

**Rejected alternatives (do not re-litigate):**

- **A nullary generic function face** — `export declare function empty<a>(): Iterable<a>`. It buys usability at every instantiation by lying about the value's shape: `empty` is a constant, not a factory, and JavaScript would have to call it. §12.1 rejected this for `None` on the same ground (it "misdescribes the value and breaks identity idioms"), and the emitted JavaScript would have to change with it — a wrapper at the boundary, which §7 permits only for the listed occasions.
- **The `unknown` instantiation.** Not assignable to specific instantiations (evidence above); it fails at exactly the covariant producer positions the rule exists to serve.
- **The `any` instantiation.** It would be usable everywhere, in both variances, by abandoning the check — and unlike `never` it *over*-promises, inviting a consumer to put anything into a contravariant position. The boundary's contracts are trusted but not unchecked (Part 1 §1); a face that types nothing is not a face.
- **Forbidding polymorphic non-function exports at the boundary**, requiring the author to write a nullary function (#132's option 3). It moves a TypeScript representation gap into `.hex` source, changing `Seq.empty`'s spelling for every Hexagon consumer to serve a JavaScript face that TypeScript accepts perfectly well as a constant.
- **Naming the binders anyway and adding a `type` alias to bind them** — e.g. `type Empty<a> = Iterable<a>; export declare const empty: Empty<a>;`. It relocates the unbound name without binding it; TypeScript has no rank-1 quantifier for a constant, and no arrangement of aliases invents one.

### 14.2 Cross-module Hexagon types in faces take type-only named imports (2026-08-04, #227)

**Origin.** #132's residue, recorded in §14.1: with the unbound binder fixed, `Seq.d.ts` still failed `tsc --noEmit --strict --lib es2022` on three TS2304s, because its faces name `Option` — `Option.hex`'s type — and the declaration file imported nothing. The sharper half, from the issue: under the *default* lib set the bare name does not fail but **binds**, to `lib.dom.d.ts`'s legacy `Option` constructor. A value in type position is still an error today (TS2749); a cross-module Hexagon *type* whose name matches a global type would bind silently and describe the wrong thing. Which declaration an unimported name means is decided by the consumer's `lib` and `types` settings, not by this compiler — that, not the TS2304, is the defect.

**What investigation narrowed.** The issue's scope claim — "any two-module project where one module's exported signature mentions the other's exported type will emit the same unresolvable name" — is **false as filed**, and the correction matters because it relocates the fix. A source-written `import { Color } from "./lib"` already emitted `import type { Color } from "./lib.js";`, rename included, and that face already compiled (verified on `main` at this ruling). The live routes were exactly two *(falsified below — the namespace-qualified face is a third, #268's)*:

1. **Prelude-supplied types** (Modules §5.5): `Option` and `Ordering` reach every module's scope with no import item for the `.d.ts` to render — the filed instance (`Seq.hex`), and equally any user module writing `export let o: Option(Int) = None`.
2. **A term+type name on an explicit import**: `import { Point } from "./geometry"` where `Point` is a record binds constructor *and* type; the import name's type-only marking keyed off the term's absence, so the term half silently cost the `.d.ts` the type row.

Implementation then surfaced a **third route this record had wrongly excluded** — the first draft here claimed the live routes "were exactly two", from a probe that had misspelled the namespace form and read its parse error as the form's absence. A namespace import (`import * as Lib from "./lib"` — era spelling; #565) binds the *alias*, so a face reached through `Lib.Point` is outside channel 1, and the typed tree keeps no record of the qualifier for emission to spell: the `.d.ts` imports `Lib` and then names `Point` bare. That is its own decision — the fix is the face spelling `Lib.Point`, not an import — and it was **fenced to #268**, which nothing in §2.4 then licensed or foreclosed. *(Discharged: the fence is lifted and the spelling ruled — §2.4's rung 3, recorded in §14.3.)*

The issue is corrected by comment, not by rewriting its body (the #235 precedent).

**The rule** is §2.4's, in place. Identity-keyed candidates published by the resolver, filtered at emission by what the rendered faces reference, aliases probed like `Hex`, explicit imports owning every name they bind.

**Why candidates-then-filter and not a third mechanism.** The channel shape already existed twice — prelude instance evidence (#153, `Module.preludeInstances`) and the synthesized term import (#263) — with the same division: the resolver decides availability, emission decides what is imported. A prelude type in scope but absent from every face costs nothing, which is the same property that made #153's channel free.

**Consequences, with owners:**

- `Resolved.Module` grows the prelude type inventory (built where `#seedPrelude` already walks each member's exported unions, records, and extern types), threaded through `Typed.Module` and `Core.Module` exactly as `preludeInstances` is; `Resolved.ImportName` marks type bindings independently of the term's presence, so the declaration emitter stops inferring "type" from "not a term". The declaration emitter routes nominal faces through an identity-keyed sink (the `RuntimeFaces` shape) and prepends the surviving imports after the `Hex` line. The JavaScript emitter is untouched.
- The ruling as first drafted priced no reachability edge, and implementation found the gap the hard way: a project whose only use of `Option` is a face compiled clean and emitted `import type … from "./Option.js"` beside no `Option.d.ts` — #227's own failure in a new dress. §2.4's Reachability paragraph now carries the obligation; `Emitted.Declarations.preludeTypeImports` records the edges for `compileProject`'s reachability walk, beside `preludeInstanceImports` and `preludeTermImports`.
- Conformance: `compiler/src/conformance/cross-module-type-imports.test.ts` — the emitted prelude's declaration files pass real `tsc` **as a set** (the filed acceptance: `Seq.d.ts` compiles), plus the term+type route, the explicit-prelude-import single-binding property, occlusion, and a negative control on the pre-fix spelling.
- §2.1's "exactly one type-only namespace import" is amended in place — it remains the only *namespace* import; §14.1's two expired passages carry discharge notes; Part 1 §8.3's acceptance item strikes #227 from its "may still trip" list (its scope fence already assigned the fix here and is unchanged).
- The TypeScript **preview** is out of scope and keeps bare names (§2.4 Scope); the shipped `.d.ts` is the boundary artifact, the preview is one importless pane.

**Rejected alternatives (do not re-litigate):**

- **A type-only namespace import per owning module** (`import type * as Option_ns from "./Option.js"`, faces `Option_ns.Option<a>`). Uniform, but it renames *every* cross-module face to dodge a collision that is nearly unreachable (§2.4's probe note), and the faces stop matching what a Hexagon-side reader sees — the cost §2.2 was written to avoid.
- **Re-exporting the foreign type from the mentioning module** (`export type { Option }` in `Seq.d.ts`). It changes the module's public surface: §1 fixes export correspondence to the source's `export`, and the compiler does not grow the surface the author declared.
- **Inlining the foreign face structurally** at each mention. Dies on the branded families — an opaque type's face *is* its module-private brand (§5), and two inlined copies are two incompatible brands; even for structural union faces it duplicates the declaration per consumer and detaches it from its documentation seat.
- **Riding the synthesized prelude term import** (#263's items) by adding type names to it. Its name list is a deliberate over-approximation filtered at emission — but filtered against *referenced symbols*, a term-shaped question; grafting type names onto it would re-open exactly the over-approximation #263 closed, and prelude modules that need no terms would grow import items only to carry types.

### 14.3 A `.d.ts` names a nominal through one sink, not by its declared name (#574, #268, #617, #618)

**Origin.** §2.4 stated two channels and claimed they covered the space; they did not. The declaration emitter named every nominal by `type.name` — the type's *declared* name — with no record of how the file it was writing spells that identity. That is correct for a type the module declares and for a prelude type (§2.4's own inventory), and wrong for everything else. Six failures, each verified against real `tsc --noEmit --strict`:

| Source | Emitted face | Result |
|---|---|---|
| a namespace alias beside a same-spelled declaration | `import type * as Point` beside `export type Point` | TS2440 (#574) |
| a namespace alias beside a named import of the same spelling | both lines | TS2300 twice, TS2709 (#574) |
| a face qualified through a namespace alias, nothing contesting | the bare member name | TS2304 (#268, the fence §14.2 left standing) |
| a bare face whose type is in scope only by the companion fallback (Modules §5.1 rule 2) | the alias's own name in type position | TS2709 (#268) |
| a renamed type import (`import { Shape as S }`) | the *imported* name, not the local | TS2304 (#617) |
| a face expanding a type alias to a nominal nothing here names | the bare name, no import | TS2304 (#618) |

**What investigation narrowed.** Two measurements moved the fix away from the shape the issue proposed.

The first is that the collision **cannot** be repaired by transplanting the JavaScript emitter's alias-renaming plan (Modules §11.2, #569) into this file. Take the shape where a qualified face and a same-spelled declaration meet — the fourth row crossed with the first. Renaming the alias and nothing else leaves that face unqualified and its bare name now unopposed, so `tsc` falls silent on a file describing the module's *own* type where the source said the imported one. The narrow fix converts a loud failure into a quiet one, which is the whole of why the four issues are one change.

The second is that the `import type * as Alias` line, emitted unconditionally, was **referenced by no face** — because no face qualified, which was #268. In every measured module it was text whose only effect was to cause the collisions above. That relocated the repair: the declaration file's imports are what its rendered faces owe, a rule the `Hex` line and the inventory lines already obeyed, and the namespace line simply joins them. The first two rows above dissolve under that rule alone, with no renaming at all.

**The rule** is §2.4's, in place: one sink, five rungs in order — the module's own declaration, a named import's local, a namespace alias's qualified spelling, the prelude inventory, and a minted import — with the file's imports being exactly what those answers owe. The sink is keyed by identity except at rung 3, which reads the **occurrence**, because an identity does not determine a qualifier: the companion fallback lets one type be named qualified at one seat and bare at another, and two aliases onto one module are both legal. The qualifier rides the typed type node rather than the annotation syntax, so a derived declaration — a fundamental specialization, a constructor arrow, a stable export wrapper — inherits its scheme's, and Part 9's dictionary faces will inherit theirs when they arrive. It is readable only in the module that wrote it — the alias binding, never its spelling: a type alias's expansion crosses module boundaries carrying its writer's qualifiers, and an importer that binds the same *spelling* to a different module would otherwise publish a face naming a real type that is the wrong one, silently.

**Consequences, with owners:**

- `Resolved.ImportName` carries the identity a type row binds, so the sink can answer rung 2 by lookup rather than by spelling. Rung 3 needs the **qualifier of the occurrence** to survive into the typed tree, which is the work #268 identified and the price of the per-occurrence rule; re-deriving an alias from the import items by identity is what that rule refuses. Rung 5 needs an identity to home-module map across the whole program: `compileProject` already accumulates `programNominals` dependency-first and already stores a home `path` per entry in `programOperations`, and `emitDeclarations` already takes a path-derived option, so this is an existing seam rather than a new pass.
- The declaration emitter's `renderType` loses its `?? type.name` fallbacks to the sink; **every** import line joins the use-gated set, the source-written rows with the runtime and inventory lines; `Emitted.Declarations`' reachability record extends to rung 5's edges, which reach modules the source never imported.
- A yielding alias takes `_1` and not the minted-local probe, so this change is not waiting on #619 for its own seat and #619 does not inherit one.
- A qualifier names a **binding**, not a type, so it carries the module whose scope holds it; the checker must keep an occurrence's where a pass would otherwise drop it. Two seats are real — an annotated `let` and a function's return, where unification or inference publishes the value's node rather than the annotation's — and at both **the written annotation's qualifier wins outright**: it replaces whatever the inferred node carries, because an inferred qualifier is a body's or a private helper's internal spelling choice, and publishing one as the module's face would show the author a spelling written at a seat they cannot see. Rung 3's totality fact closes this too: every exported binding has a complete written signature, so every published seat has an annotation to honour. Only the qualifier moves; handing the annotation's type back wholesale is a different change.
- Rung 3 is asked only for an alias the rendering module itself binds, and §2.3's pins are applied before the sink is consulted at all — a qualified `S.Seq(Int)` still faces as `Iterable<number>`. A prelude identity the source qualified is rung 3's rather than rung 4's, so its inventory line is not written; that is a take-over of the channel §14.2 established, in the direction §14.2 did not anticipate, and the `cross-module-type-imports` pins gain a case for it.
- The alias set the probe's universe counts is the aliases whose lines the file carries — read from the faces it will render, not from every qualifier the module wrote — and it is settled before any spelling is chosen, so the universe stays a pre-rendering quantity and an alias whose line is absent moves nothing. A written dot is not the test; §2.4 says why, and the rejected alternatives below record what counting one costs. Part 1 §8.3 obligation 2 is amended to match: the `Hex`-spelled alias forces `Hex_1` where its line is carried.
- **The JavaScript emitter is untouched.** #569's plan governs that file against that file's contestants, and §2.4 says outright that the two files decide independently.
- Conformance covers all six rows above by text *and* by real `tsc` over whole emitted sets — one file's declarations are only TypeScript together with what they import from, the lesson §14.2 already paid for.
- An uncontested, unqualified module must emit its `.d.ts` byte-identically, except where a line no face reached is now absent. Three shapes make that visible and are expected rather than findings: a prelude identity reached through a namespace alias loses its inventory line and gains a qualified face; a type-only row for a name no face mentions disappears, and a module that exports nothing and namespace-imports for terms — whose whole `.d.ts` was that one line — becomes `export {};`.
- The inspection preview is unchanged and stays on bare names (§2.4 Scope).
- The suffix idiom the probes use is #619's, not this record's; the spellings here are today's.

**Rejected alternatives (do not re-litigate):**

- **Transplanting #569's alias plan alone**, the shape the issue proposed. Refuted by measurement above: it silences a real error rather than fixing it.
- **Keying rung 3 on the identity rather than the occurrence**, so any alias that could name the type qualifies every face carrying it. Cheaper — the alias is re-derivable from the import items and the typed tree needs nothing — but measured false twice: under the companion fallback a bare source use renders `Shape.Shape`, and with two aliases onto one module one alias spells both seats. Both spell something the author did not write, which is the ground rung 3 stands on.
- **A qualifier readable wherever its type travels**, rather than only in the module that wrote it. Measured to publish a wrong face in silence: a type alias whose expansion carries one writer's `Lib` reaches an importer binding `Lib` to a different module, and the emitted face then names that other module's type with nothing to report it — the loud-into-quiet conversion this record rejects the narrow fix for, one seat over.
- **Counting an alias on a written dot rather than on an emitted line.** The two come apart wherever something settles an occurrence before rung 3 — a §2.3 pin, an earlier rung, or an occurrence in an unexported signature or a body that reaches no face at all — and each gap moves a minted local aside for a name absent from the file. Stating the criterion on the line the file carries is what keeps criterion and rationale from drifting; three earlier wordings of this clause drifted, each in a different direction.
- **Counting a gated alias in the probe's universe**, on the ground that an over-approximate universe is the cheaper invariant. Measured to defeat the rung order it sits under: a companion-fallback module, whose alias line no face owes, would push its own bare face to `Shape1` against a `Shape` the file does not contain.
- **Gating only the namespace import line**, leaving source-written type-only rows unconditional. It would leave the rule that justifies the gating with an exception at its headline, and no unreferenced type-only row does any work — a declaration file's own imports are not re-exported.
- **A minted local for every foreign nominal, never qualifying.** Uniform and simpler — one rung instead of three — but the faces stop matching what a Hexagon-side reader wrote, which is the cost §2.2 exists to avoid and the ground on which §14.2 already rejected a synthesized namespace import per owning module. Rung 3 is not that alternative: it spells the alias the *author* wrote, so the face and the source agree.
- **One alias plan shared by the emitted JavaScript and the `.d.ts`.** Their collision universes differ — terms on one side, types and `declare const`s on the other — so sharing would move a name in the declaration file to settle a collision that exists only in the JavaScript.
- **Reporting a diagnostic where a face reaches a type the file cannot name**, deferring the naming question. A legal Hexagon program would then fail to emit its declaration file, which is a worse answer than the TS2304 it replaces.
- **Settling spellings after rendering**, so the probe's universe is exact rather than a superset. It buys an occasionally-unnecessary generated suffix at the price of a second pass over every face; §2.4 states the asymmetry that decides it.

### 14.4 The boundary rule reads every exported carrier (#621)

**Origin.** Modules §4.3's private-in-public refusal was collected per **binding**, over `let`, `fun`, and extern rows alone. Four other carriers put a type into a module's exported `.d.ts` face — a type alias's target, a record's fields, a union constructor's payload, an exception's payload — and none was visited: each carried a module-private nominal into the public face with zero diagnostics, publishing a name against Modules §11.4 and §1 both, and rung 1 of §2.4's sink then answered with a name the file does not bind (`TS2304` under `tsc --noEmit --strict`, measured for all four). §2.4's satisfiability paragraph was fenced to the exported-binding route while this stood; this record removes the fence.

**What investigation widened.** The union case was not the near-miss it looked. The declaration emitter's union arm pushed the `type` row for **every** union, exported or not — only the constructors were gated — so every private union in every module was published in its shipped `.d.ts`, referenced or not, representation included: a payload-free private union reached by an exported face therefore compiled clean under `tsc` "by accident," by committing the deeper violation. The asymmetry dates to the commit that introduced unions, before the boundary rule existed. And the carrier list stops at four: exported constraints and constrained bindings emit no `.d.ts` face at all (Parts 8–9), so nothing crosses there — a private nominal in an exported constraint's *members* is a cross-module usability question, #626's and not this record's.

**The rule** is Modules §4.3's, in place: an exported face whose type mentions a private nominal is a hard error at every carrier, one message family with the carrier's own noun, reported at the offending mention's seat, once per type per carrier, first in declaration order, each diagnostic — the binding's included — carrying a secondary label at the private type's declaration. The carrier list reads the head's `export` slot value: an **`opaque` declaration is not a carrier** — its brand-only face (§5) mentions neither fields nor payloads, so a private nominal inside one leaks nothing, and hiding a private representation behind an opaque name is §4.2's intended idiom. Transparency cuts both ways — a private alias expanding to a private nominal launders nothing — and the walk that answers is the boundary check's existing one, whose signals already keep elsewhere-public types out of the refusal: `representationVisible`, stamped false on every imported copy — a locality signal proper — for records and unions; for extern types, the extern-type table's own `exported` flag, a visibility signal and, until #629 gave the arm a locality component of its own, its only one.

**Consequences, with owners:**

- The checker's boundary check visits the four carriers beside the bindings it already reads — `export`-headed items only, never `opaque` ones — reusing the walk and its locality signals; the diagnostic anchors at the field annotation, the slot annotation, or the alias's right-hand side (the carrier's whole written annotation, not a nested occurrence's sub-annotation), and dedupes per (carrier, type) at the first offending seat in declaration order, labeling the private type's declaration — the existing binding diagnostic gains the same label.
- The declaration emitter's union arm joins every other arm: a private union contributes **no** row to the *shipped* `.d.ts`. Safe exactly because the checker now refuses every face that could reach one; landing both together is what leaves no state in which a clean compile ships a broken or leaking declaration file. The runtime modules' declaration files lose their never-referenced private-union rows — four across two files, `Tree` in each plus `Root` and `Frames` — under the same move. **The inspection preview is out of scope and unchanged** (§14.3's scope note): it renders private declarations by design, unprefixed, and the union renderer's second caller — the preview's — keeps its behavior.
- §2.4's satisfiability claim is unrestricted again: every nominal in an exported face has an exported home, so every occurrence is answerable by some rung.
- Conformance covers the four carriers by refusal, the union arm by absence (no non-exported `type` row in any shipped `.d.ts`), and the stdlib and runtime modules by recompilation — the stdlib declares no private nominals and the runtime modules export no faces, so both compile unchanged.

**Rejected alternatives (do not re-litigate):**

- **Materializing a non-exported row for the reached private type** — the union arm's accident as policy. It "fixes" `tsc` by publishing the private representation, the deeper violation of Modules §11.4, and cannot answer for extern types, whose representation the compiler does not hold.
- **Auto-exporting the reached type opaquely.** Refused on §4.2's governing principle: what crosses an opaque boundary must be declared, not inferred.
