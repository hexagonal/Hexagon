# FFI Note: Exported Constraint Dictionaries

**Status:** Recovered design direction, not yet a normative specification.
**Purpose:** Preserve the intended treatment of constrained polymorphic Hexagon functions at the JavaScript/TypeScript boundary before the formal FFI session.

---

## 1. Core distinction

Constraint dictionaries are invisible and unnameable in **Hexagon source**, but they may be exposed as compiler-produced JavaScript objects when a JavaScript caller needs to invoke a constrained polymorphic Hexagon export.

This preserves three compilation regimes:

1. **Concrete Hexagon code:** resolve the instance statically and erase the dictionary. Primitive operations emit native JavaScript where their semantics agree; other concrete types emit direct monomorphic calls.
2. **Genuinely polymorphic Hexagon code:** pass constraint dictionaries internally, as already specified by Constraints §6.
3. **JavaScript calling a constrained polymorphic export:** make the required dictionaries explicit in the JavaScript/TypeScript signature. The caller passes compiler/runtime-produced dictionary handles.

The boundary does not require runtime type dispatch, prototype inspection, global instance search, or automatic generation of one wrapper per concrete type.

---

## 2. Example

Hexagon:

```hexagon
export fun plus<a: Num>(x: a, y: a): a =
  x + y
```

Internal emitted shape:

```js
export function plus(num, x, y) {
  return num.add(x, y);
}
```

Provisional `.d.ts` shape:

```ts
export function plus<T>(
  num: Num.Dictionary<T>,
  x: T,
  y: T,
): T;
```

JavaScript/TypeScript calls:

```ts
plus(Num.int, 10, 20);
plus(Num.float, 1.5, 2.5);
plus(Num.bigInt, 10n, 20n);
plus(Rat.num, half, third);
```

The names above are illustrative, not yet settled.

---

## 3. Concrete calls remain dictionary-free

Known primitive instances emit native operators where existing specs require them:

```hexagon
fun intPlus(x: Int, y: Int): Int = x + y
```

```js
function intPlus(x, y) {
  return x + y;
}
```

A known non-primitive type also needs no dictionary at the call site:

```hexagon
fun ratPlus(x: Rat, y: Rat): Rat = x + y
```

```js
function ratPlus(x, y) {
  return Rat.add(x, y);
}
```

The rule is **concrete versus polymorphic**, not fundamental versus non-fundamental.

---

## 4. Dictionaries come from compiled Hexagon

The intended public inputs are dictionaries produced by the Hexagon compiler or runtime, including dictionaries for public user-defined types. JavaScript callers are not expected to hand-author instance records.

A provisional nominal TypeScript face:

```ts
declare const dictionaryBrand: unique symbol;

export namespace Num {
  export interface Dictionary<T> {
    readonly [dictionaryBrand]: "Num";
    readonly add: (x: T, y: T) => T;
    readonly subtract: (x: T, y: T) => T;
    readonly multiply: (x: T, y: T) => T;
    readonly negate: (x: T) => T;
    readonly fromInt: (x: number) => T;
  }

  export const int: Dictionary<number>;
  export const float: Dictionary<number>;
  export const bigInt: Dictionary<bigint>;
}
```

The hidden `unique symbol` discourages accidental structural fabrication in TypeScript. Runtime dictionaries may additionally be frozen and privately branded. Untrusted JavaScript can always lie at an FFI boundary; the formal spec must decide whether runtime brand validation is required.

For a public user type and instance, the emitted module needs a stable dictionary handle, provisionally:

```ts
export namespace Rat {
  export const num: Num.Dictionary<Rat>;
}
```

Parameterized instances need compiler-produced dictionary factories, for example a `Show<Vector(a)>` dictionary built from `Show<a>`. Exact naming and exposure remain open.

---

## 5. Relationship to existing doctrine

This direction refines, rather than discards, two existing statements:

- "Dictionaries are never user-nameable or user-passable" remains true for **Hexagon source**. The FFI may expose generated dictionary handles to foreign callers.
- "Nothing constraint-shaped appears in `.d.ts`" remains true for ordinary monomorphic exports, but constrained polymorphic exports require an explicit FFI exception. Their generated `.d.ts` signatures expose nominal dictionary parameters because TypeScript has no native equivalent of Hexagon constraints.

Constraints §6.4 already assigns exported constrained-polymorphic functions to the FFI specification, so the formal FFI session owns this refinement.

Global coherence and the orphan rule make the design dependable: one dictionary exists per lawful `(constraint, type constructor)` instance, and its compiler-known home is predictable. Deterministic internal dictionary-parameter ordering supplies the starting point for a stable foreign ABI.

---

## 6. Questions the FFI spec must close

1. Public TypeScript naming: `Num.Dictionary<T>` or another shape.
2. Ground-handle naming and home: `Num.int`, `Int.num`, or another convention.
3. Exposure of user-type dictionaries such as `Rat.num`.
4. Representation and naming of parameterized dictionary factories.
5. Whether every public instance receives a handle, only instances needed by exported signatures do, or exposure is explicitly requested.
6. Multiple-constraint parameter ordering and its presentation in `.d.ts`.
7. Superconstraint dictionary representation at the foreign boundary.
8. TypeScript-only branding versus mandatory runtime branding and validation.
9. Whether dictionaries emitted by separately compiled Hexagon packages are mutually compatible.
10. Dictionary ABI/versioning: adding a constraint member changes the dictionary shape and may become a public compatibility event.
11. Whether dictionary parameters exactly reuse the internal calling convention or pass through a stable boundary wrapper.
12. Diagnostics and documentation for JavaScript callers who omit or mismatch dictionaries.

---

## 7. Directional preference

Prefer explicit dictionary parameters for constrained polymorphic exports over automatically generating exports such as `plusInt`, `plusFloat`, and `plusBigInt`.

Concrete wrappers remain available when a library author deliberately wants that JavaScript API, but they should be explicit Hexagon declarations rather than an automatically expanding export surface.

This design preserves Hexagon's inferred, coherent constrained polymorphism internally while allowing JavaScript and TypeScript callers to use the same generic algorithms through an honest, typed boundary.
