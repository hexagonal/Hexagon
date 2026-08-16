# Hexagon FFI Part 7: Hexagon Exports and TypeScript Declarations

**Status:** Decided (July 2026), revised in place after external review (Sol) before landing; §2.2 and §12.1 amended 2026-08-02 — a polymorphic non-function declaration faces as its `never` instantiation, generalizing §12.1 beyond nullary constructors — see correction record §14.1; §2.1 amended and §2.4 added 2026-08-04 — cross-module Hexagon types in faces take type-only named imports (#227) — see correction record §14.2; §6 and §11 amended — exported exceptions ship boundary guards (`.is`, `isHexError`), the one hard error this part owns (#478). Normative promotion of `spec/notes/ffi-proto-spec-questions.md` §7, plus the export-surface pieces earlier parts assigned here: the exact opaque-brand `.d.ts` form (Part 4 §12.3), stable export wrappers' emission rules (Parts 3/6), and the discharge of Modules §11.4's deferred opaque-representation question. The draft's three clarifications were confirmed in §12: generic nullary constants use the `never` instantiation; export forces stable constructor materialization; and all four opaque-faced families use one non-exported-`unique symbol` brand mechanism. Inherits: generated opaque brands for exported extern types, never re-exported foreign typings; raw identity for representation-direct functions; stable module-level wrappers where adapted signatures or receiver conventions require them, with fresh per-value adapters remaining distinct from those named callable wrappers (Part 6 §1); exported Hexagon `Unit` functions genuinely returning `undefined` (Part 6 §3.2); the `Error & {$hex: true; ...}` exception face (Exceptions §7.5); constrained exports referenced but governed by Parts 8–9.
**Scope:** ESM export correspondence; the generated `.d.ts` (structure, the `Hex` namespace import, lowercase Hexagon-originated generic binders, cross-module type imports); records; unions, exported constructors, and the all-nullary representation cliff; opaque branded values — the uniform brand for `export opaque` types, extern types, and extern class types; exceptions, including the nullary function-shape difference; direct exports versus stable wrappers; edit notes discharging flags in Modules, Unions, and Exceptions.
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

giving the faces `Hex.Vector<a>`, `Hex.Map<k, v>`, `Hex.Set<a>`, and `Hex.Range`. The import is type-only and adds no emitted JavaScript dependency. The compiler controls the alias: it tries `Hex`, then `Hex1`, `Hex2`, … and takes the first candidate colliding with no top-level identifier emitted in that `.d.ts`, regardless of TypeScript namespace. Only the generated alias is renamed; user exports never are (Part 1 §10; Part 12 §11.1).

*(Amended 2026-08-04, #227 — see §2.4 and correction record §14.2.)* The `Hex` import is the only **namespace** import the compiler *synthesizes* (source-level namespace imports are the module's own lines), but no longer the only import it synthesizes: a face that mentions a type owned by another *Hexagon module* takes a type-only **named** import of it, §2.4.

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

### 2.4 Cross-module Hexagon types in faces *(added 2026-08-04, #227)*

A face may mention a nominal type owned by another Hexagon module: `Seq.hex`'s `next` returns `Option([a, Seq(a)])`, and `Option` is `Option.hex`'s. TypeScript resolves nothing by project-wide scope, so an unimported name is unbound (TS2304) — or, worse, bound by the consumer's configuration: under the default `lib` set a bare `Option` lands on `lib.dom.d.ts`'s legacy `Option` constructor, and which declaration the name means is then decided by the consumer's `lib` and `types` settings rather than by this compiler. A generated `.d.ts` therefore **carries a type-only named import for every other-module Hexagon type its faces mention**:

```ts
import type { Option } from "./Option.js";
export declare const next: <a>(source: Iterable<a>) => Option<[a, Iterable<a>]>;
```

Two channels put such a type in scope, and each import is owned by exactly one:

1. **A source-written `import` owns every name it binds.** Its type-only rows appear in the `.d.ts` as they always have — *including when the same imported name also binds a term*, which is where the defect lived on this channel: `import { Point } from "./geometry"` binds both the record type and its constructor (§3), and the term half must not cost the `.d.ts` its type half. The emitted JavaScript carries the term import; the `.d.ts` carries `import type { Point }`. A source rename is respected, and faces spell the local: `import { Color as LibColor }` emits `import type { Color as LibColor }` and the faces say `LibColor`.

2. **Prelude-supplied types** arrive with no source import to ride (Modules §5.5). The resolver publishes, per module, the prelude's importable type inventory — exported unions, records, and extern types, each with its owning member's specifier, in normative prelude order; type aliases have no entry because faces carry their expansion (§1, Modules §11.4). Emission imports **exactly the entries whose identities the rendered faces reference** — the candidates-then-filter architecture of prelude instance evidence (#153) and the synthesized term import (#263): the resolver decides availability, emission decides what is imported, and neither is inferred from the other. An entry the source also imported explicitly is skipped — channel 1 took over its emission, the same take-over the term side already performs. One import statement per type, not per module; a member contributing two types contributes two statements, which is ordinary ESM (the instance-evidence channel does the same on the JavaScript side).

What is matched is **identity, never spelling** — the discipline of the `Bool`/`Seq` pins. A module whose own declaration occludes a prelude type name (Modules §5.4) renders and exports its *own* type bare. Occlusion takes only the bare spelling, though: the prelude identity stays reachable **qualified** (`Prelude.Ordering` — Modules §5.4, §6.4), so it can still appear in an exported face, and it then imports under a probed local, the bare name being the module's own:

```ts
import type { Ordering as Ordering1 } from "./Prelude.js";
export type Ordering = "Asc" | "Desc";
export declare const f: (x: Ordering1) => number;
```

**The generated local is probed like `Hex`** (§2.1): the type's own name first, then `Option1`, `Option2`, … against every top-level identifier emitted in that `.d.ts`, the settled runtime alias, and the generated locals already assigned; only generated spellings move, user names never (Part 1 §10). At least three routes reach the probe today: an exported *constructor* sharing a prelude type's name — constructors are uppercase top-level `.d.ts` identifiers (§3–§4); an occluding declaration beside a qualified face of the occluded identity (above); and an import alias, which can spell any identifier.

**Placement.** Compiler-written imports precede the module's own items: the `Hex` runtime import first (§2.1), then this section's imports in inventory order.

**Reachability.** A member a face imports from is part of the emitted program even when no term reaches it: a face can name `Option` while the JavaScript touches no `Option` term, so this channel's edges — the only ones with no JavaScript counterpart — count toward what gets emitted, or the `.d.ts` would import from a file that was never written. The edge is declaration-side only; no JavaScript import is added (a bare side-effect import is a load-order dependency the source never wrote — the #263 doctrine, unchanged).

**What never imports:** the pinned faces (prelude `Bool` as `boolean`, prelude `Seq(a)` as `Iterable<a>` — §2.3), structural faces, expanded aliases, and the `Hex.*` runtime types (§2.1's namespace owns those). Every import this section emits is satisfiable: an exported face cannot mention a type its owner keeps private — the checker refuses the binding (`` exported binding `probe` exposes private type `Hidden`; export the type, perhaps opaquely, or keep the binding private ``), per §1's boundary rule.

**Fenced out:** a face reached through a *namespace* alias (`Lib.Point`) is neither channel — the import binds the alias, not the member names, and the typed tree keeps no qualifier for emission to spell, so such a face still renders bare. Filed as #268 (§14.2); nothing here decides it.

**Scope.** The shipped `.d.ts`. The inspection-only TypeScript preview keeps bare names: it is one pane of text with nothing to import from (the constraint behind Part 1 §8.3 obligation 6's inline namespace), and the divergence is recorded here rather than left to be rediscovered.

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

`export opaque record` and `export opaque union` export **the type only**: raw fields and constructors are absent from JavaScript exports and `.d.ts`, while explicitly exported smart constructors and accessors cross as ordinary functions. The TypeScript face hides the representation behind a private `unique symbol` brand:

```hexagon
export opaque record UserId = {value: Int}
export fun parse(text: String): Option(UserId) = ...
```

```ts
declare const userIdBrand: unique symbol;
export type UserId = {readonly [userIdBrand]: never};

export declare function parse(text: string): Option<UserId>;
```

**This brand form is uniform across everything Hexagon exports opaquely** — `export opaque record`, `export opaque union`, exported extern `type`, and exported extern class types (Part 4 §12.3; Part 5 §6.1). One mechanism, one reading: "a nominal Hexagon-governed value; obtain and use it through the exported functions."

Rules fixed here:

- **The brand is TypeScript-only.** No runtime wrapper, tag, or validation is added; the existing erased runtime value (or foreign object, for extern types) crosses out and back **by identity**. TypeScript discourages structural fabrication; untyped JavaScript remains governed by the trusted-boundary contract (Part 1 §3.1).
- **One brand symbol per exported type**, declared `declare const <name>Brand: unique symbol` and **not exported** — the symbol is unnameable outside the declaration file, which is what makes the type unforgeable in TS. The `<name>Brand` spelling is representative; per-type uniqueness within the file and stability of the *type's* name are the contract, and identifier collisions are the emitter's ordinary renaming problem — whose probes stay outside Lexer §3.2's reserved `__` prefix, a brand being a face, not a hygiene name.
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
  readonly $hex: true;
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

The exported constructor is an ordinary function with stable ESM identity; the brand's `$hex: true` appears in the face deliberately (Exceptions §7.5) so JS-side construction is done correctly or not at all. This discharges the constructor-export flags in Exceptions §7.5 and Unions §6.5 (edit notes, §10).

**Every exported exception also ships its guard** *(#478; Exceptions §7.6)*. The constructor function carries a property `is`, declared by function/namespace merge so the property types as a predicate and the consumer's branch narrows to the intersection face:

```ts
export declare function ParseError(line: number, message: string): ParseError;
export declare namespace ParseError {
  function is(err: unknown): err is ParseError;
}
```

At runtime the property is assigned once, beside the constructor: `ParseError.is = (err) => err != null && err.$hex === true && err.name === "ParseError";`. Nullary exceptions carry the same property on their function-shaped export. The property seat spends no export name and has no collision rule — no Hexagon surface can occupy it.

A module that exports at least one exception additionally exports the stage-1 guard:

```ts
export declare function isHexError(
  err: unknown,
): err is Error & { readonly $hex: true; readonly name: string };
```

`isHexError` is a generated public **face** — deliberately outside Lexer §3.2's `__` prefix — and a fixed name, so its collision with an explicit export of the same module is the Part 8 §6.2 family's hard error (both sites named; the fix is a source rename, never a silent one). **`JsError` ships no `is` guard**: its wrapping is virtual (Exceptions §6.2), so outside that section's exotic first-class residue a JS consumer never receives a branded `"JsError"` — the foreign branch of their discrimination is `!isHexError(err)`.

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
export opaque record UserId = {value: Int}
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

Implementation then surfaced a **third route this record had wrongly excluded** — the first draft here claimed the live routes "were exactly two", from a probe that had misspelled the namespace form and read its parse error as the form's absence. A namespace import (`import * as Lib from "./lib"`) binds the *alias*, so a face reached through `Lib.Point` is outside channel 1, and the typed tree keeps no record of the qualifier for emission to spell: the `.d.ts` imports `Lib` and then names `Point` bare. That is its own decision — the fix is the face spelling `Lib.Point`, not an import — and it is **fenced to #268**, which nothing in §2.4 licenses or forecloses.

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
