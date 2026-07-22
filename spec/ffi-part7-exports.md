# Hexagon FFI Part 7: Hexagon Exports and TypeScript Declarations

**Status:** Decided (July 2026), revised in place after external review (Sol) before landing. Normative promotion of `spec/notes/ffi-proto-spec-questions.md` §7, plus the export-surface pieces earlier parts assigned here: the exact opaque-brand `.d.ts` form (Part 4 §12.3), stable export wrappers' emission rules (Parts 3/6), and the discharge of Modules §11.4's deferred opaque-representation question. The draft's three clarifications were confirmed in §12: generic nullary constants use the `never` instantiation; export forces stable constructor materialization; and all four opaque-faced families use one non-exported-`unique symbol` brand mechanism. Inherits: generated opaque brands for exported extern types, never re-exported foreign typings; raw identity for representation-direct functions; stable module-level wrappers where adapted signatures or receiver conventions require them, with fresh per-value adapters remaining distinct from those named callable wrappers (Part 6 §1); exported Hexagon `Unit` functions genuinely returning `undefined` (Part 6 §3.2); the `Error & {$hex: true; ...}` exception face (Exceptions §7.5); constrained exports referenced but governed by Parts 8–9.
**Scope:** ESM export correspondence; the generated `.d.ts` (structure, the `Hex` namespace import, lowercase Hexagon-originated generic binders); records; unions, exported constructors, and the all-nullary representation cliff; opaque branded values — the uniform brand for `export opaque` types, extern types, and extern class types; exceptions, including the nullary function-shape difference; direct exports versus stable wrappers; edit notes discharging flags in Modules, Unions, and Exceptions.
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
export let version = "1.0"
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

### 2.2 Lowercase Hexagon-originated generic binders

**All generic binders in Hexagon-originated declarations use the lowercase Hexagon convention** — `a`, `b`, `k`, `v`, matching the source type variables:

```ts
export declare function head<a>(items: Hex.Vector<a>): Option<a>;
export type Option<a> = {tag: "Some"; value: a} | {tag: "None"};
```

TypeScript is case-agnostic about binder names, so nothing is lost; what is gained is that a generated declaration visibly carries its Hexagon origin and matches the hover/diagnostic types a mixed-codebase developer sees on the Hexagon side. Declared-source binder order is preserved (it is ABI-relevant under Parts 8–9's suffix rules).

### 2.3 Type faces

Per-type faces are Part 1 §4.1's table, not restated: tuples as TS tuple types, structural records as structural object types, `Nullable(a)` as `a | null | undefined`, `Array(a)` as `ReadonlyArray<a>`, `Seq(a)` as `Iterable<a>` (with the exported value stronger than its face — replayable, Part 3 §9.1), `Unit` as `void` in return position. This part adds only the declaration-generation rules for the nominal families below.

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
- **One brand symbol per exported type**, declared `declare const <name>Brand: unique symbol` and **not exported** — the symbol is unnameable outside the declaration file, which is what makes the type unforgeable in TS. The `<name>Brand` spelling is representative; per-type uniqueness within the file and stability of the *type's* name are the contract, and identifier collisions are the emitter's ordinary renaming problem.
- **Extern types are never re-exports of foreign typings** (Part 4 §12.3, resolved): the brand is generated even when the foreign package ships its own declarations, because the extern `type` is a nominal Hexagon contract, not an endorsement of the foreign package's structural type.
- This discharges **Modules §11.4's deferred opaque-representation question** in favor of branded types; the honest-fields interim caveat ends when this part lands (edit note, §10).

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

---

## 7. Direct exports versus stable wrappers

**Export directly when the runtime value already has its declared JS representation**: primitives, `Nullable`, `Array`, genuine `Hex.Vector`/`Hex.Map`/`Hex.Set` values, records and unions, opaque erased values, exceptions, and representation-direct functions and callbacks. Direct export means the ESM binding *is* the runtime value or emitted function — raw identity, no indirection (Part 6 §1).

**Generate one stable module-level boundary wrapper only when a supported top-level signature needs adaptation or calling-convention plumbing.** The v1 occasions are exactly Part 6 §1's table:

1. an incoming `Iterable<a>` parameter declared as `Seq(a)` (the wrapper performs Part 3's crossing at each call — and each adapted value receives a **fresh per-value adapter**, Part 3 §2.1; the named callable wrapper and the per-value adapter remain distinct objects with distinct lifetimes);
2. exported extern receiver members, whose ESM export is Part 5 §2.3's stable convention-preserving wrapper (there is no raw property function to export);
3. a generic constrained export with trailing dictionary evidence **when ABI plumbing makes a wrapper necessary** (shape governed by Parts 8–9). If the internal function already has the public trailing-evidence ABI, it exports directly; Part 9's rule does not require an identity-only wrapper.

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
export let version = "1.0"                 -- export const version; const version: string
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

This part introduces **no new hard errors**. The boundary-shape and collision errors it relies on land elsewhere:

| Situation | Owner |
|---|---|
| generated specialization name colliding with an explicit export | Part 8 §6.2 (Algorithm N; hard error) |
| adapter-requiring type nested in an exported signature | Part 1 §5.3 |
| adapter-requiring callback signature in an exported function | Part 6 §5.4 |
| `Hex` alias collision in a generated `.d.ts` | deterministic emitter resolution, Part 1 §8 — not a user error |
| brand-identifier collision in a generated `.d.ts` | emitter renaming, §5 — not a user error |

---

## 12. Review resolutions

### 12.1 Generic nullary constructor faces use the `never` instantiation (§4)

**Confirmed:** `export declare const None: Option<never>;`. The single shared runtime constant needs one `.d.ts` type, and `never` is the instantiation TypeScript's structural checking accepts wherever any `Option<T>` is expected (the `None` arm carries no payload for variance to bite on). A per-use generic function face misdescribes the value and breaks identity idioms; `unknown` is not assignable to specific instantiations.

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
| Direct-vs-wrapper rule: direct wherever representation and public ABI match; one stable module-level wrapper for adapted top-level positions, exported receiver members, and constrained generic editions only when ABI plumbing requires it; wrapper identity stable (once per ESM binding); per-value adapters remain distinct | §7 |
| Constrained exports referenced only; Parts 8–9 govern; generated exports obey this part's naming/binder/identity rules; collisions stay Part 8 §6.2 | §8 |
| Companion specs discharged: Modules §11.4, Products §5.4, Unions §6.4–§6.5, Exceptions §7.5 | §10 |
