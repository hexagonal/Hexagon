# FFI Note: Exported Constraint Dictionaries

**Status:** Proto-spec decision note (July 2026), revised after the zero-cost fundamental-specialization decision. Not yet normative.
**Purpose:** Specify the generic JavaScript/TypeScript edition of exported constrained-polymorphic Hexagon functions and the compiler-produced evidence handles that make public non-fundamental instances usable from JS.
**Companions:** `ffi-zero-cost-primitive-exports.md`; `ffi-proto-spec-questions.md`; Constraints §5–§6; Modules §7; Functions subject-first doctrine.

---

## 1. Core distinction

Constraint dictionaries are invisible and unnameable in Hexagon source. At the JavaScript/TypeScript boundary they become compiler/runtime-produced evidence objects only where a JS caller needs the generic edition of a constrained-polymorphic export.

Three compilation regimes remain distinct:

1. **Known concrete Hexagon code:** resolve the instance statically and erase evidence. Fundamental operations emit native JavaScript where their semantics agree; known non-fundamental operations emit direct monomorphic calls.
2. **Genuinely polymorphic Hexagon code:** carry dictionaries internally as a trailing evidence suffix.
3. **JavaScript calling a generic constrained export:** pass compiler-produced dictionaries explicitly in the stable trailing suffix.

The foreign surface adds a fourth *entry-point form*, not a fourth semantic regime:

4. **JavaScript fundamental specializations:** named monomorphic exports such as `plusInt`/`plusFloat`/`plusBigInt`, with direct bodies and no dictionaries (`ffi-zero-cost-primitive-exports.md`).

The boundary never requires runtime type dispatch, prototype inspection, global instance search, JS-authored instance records, or automatic per-user-type function explosion.

---

## 2. Example: specializations plus generic edition

Hexagon:

```hexagon
export let plus<a: Num>(x: a, y: a): a = x + y
```

Fundamental entry points:

```ts
export declare function plusInt(x: number, y: number): number;
export declare function plusFloat(x: number, y: number): number;
export declare function plusBigInt(x: bigint, y: bigint): bigint;
```

When the public instance graph includes a usable non-fundamental `Num` instance, the base-name generic edition additionally appears:

```ts
export declare function plus<a>(
  x: a,
  y: a,
  num: Num.Dictionary<a>,
): a;
```

```js
export function plus(x, y, num) {
  return num.add(x, y);
}
```

Calls:

```ts
plusInt(10, 20);
plusFloat(1.5, 2.5);
plusBigInt(10n, 20n);
plus(half, third, Rat.num);
```

The generic edition is not emitted merely because a private type or internal call instantiates `plus`. Its trigger is public usable non-fundamental evidence, as fixed by the specialization note.

---

## 3. What `Constraint.Dictionary<a>` means

`Dictionary` is a TypeScript-only public type exported by the module corresponding to one Hexagon constraint. At a use site, the ordinary module namespace alias provides qualification. The types are distinct:

```ts
Num.Dictionary<a>
Eq.Dictionary<a>
Show.Dictionary<a>
```

They are not one universal dictionary type. Each describes the operation record for one constraint and one value type.

The public dictionary shape is the constraint's **completed member set**, including inherited defaulted operations. Consequently `Eq.Dictionary<a>` contains both `equals` and `notEquals` even when the originating `honor Eq<T>` declaration supplied only `equals`:

```ts
declare const eqDictionaryBrand: unique symbol;

export interface Dictionary<a> {
  readonly [eqDictionaryBrand]: a;
  readonly equals: (x: a, y: a) => boolean;
  readonly notEquals: (x: a, y: a) => boolean;
}
```

Representative `num.d.ts` declaration:

```ts
declare const numDictionaryBrand: unique symbol;

export interface Dictionary<a> {
  readonly [numDictionaryBrand]: a;
  readonly add: (x: a, y: a) => a;
  readonly subtract: (x: a, y: a) => a;
  readonly multiply: (x: a, y: a) => a;
  readonly negate: (x: a) => a;
  readonly fromInt: (value: number) => a;
}
```

Consumer/generated declaration:

```ts
import type * as Num from "@hexagon/runtime/num";

export declare function plus<a>(
  x: a,
  y: a,
  num: Num.Dictionary<a>,
): a;
```

`Num` here is a normal TypeScript/ESM namespace import alias, just as companion qualification is a normal module alias in Hexagon; it is not a global object or a special nested-type mechanism. `Dictionary` has no runtime constructor or value. `Num.int`, `Rat.num`, and dictionary factories are real module exports reached through ordinary namespace imports. The generic parameter name is lowercase because these are Hexagon-originated public ABI declarations expressed in TypeScript; the same rule applies to generated `<a>`, `<b>`, `<k>`, and `<v>` binders elsewhere.

The brand is nominal TypeScript evidence, not general runtime validation. Runtime objects may carry a private symbol and should be frozen where practical, but ordinary fixed-arity calls remain governed by the trusted-boundary doctrine.

---

## 4. Handle ownership and names

Every lawful instance whose constraint and outer type constructor are publicly nameable receives a public foreign handle or factory. Private types and constraints produce no public handle.

### 4.1 Fundamental instances: constraint-owned

Fundamental handles live under the constraint namespace for discoverability:

```ts
Num.int
Num.float
Num.bigInt

Eq.int
Eq.string
Eq.bool

Show.int
Show.string
Show.bool
```

Representative `num.d.ts` exports:

```ts
export declare const int: Dictionary<number>;
export declare const float: Dictionary<number>;
export declare const bigInt: Dictionary<bigint>;
```

These handles remain useful even though fundamental function entry points are specialized: parameterized dictionary factories and generic editions need composable evidence.

### 4.2 User and runtime types: type-owned

Non-fundamental handles live in the public type's companion/module under the lowercase constraint name:

```ts
Rat.num
Rat.eq
Rat.show

Customer.eq
Customer.show
```

Representative `rat.d.ts` exports:

```ts
import type * as Num from "@hexagon/runtime/num";
import type * as Eq from "@hexagon/runtime/eq";
import type * as Show from "@hexagon/runtime/show";

export declare const num: Num.Dictionary<Rat>;
export declare const eq: Eq.Dictionary<Rat>;
export declare const show: Show.Dictionary<Rat>;
```

Consumer:

```ts
import * as Rat from "./rat.js";

plus(half, third, Rat.num);
```

This reflects lawful ownership and package reality: built-in evidence is discovered from the constraint module; separately compiled user packages expose evidence from the user type's home module. Packages do not mutate a central runtime or type object to attach `Rat` members. `Rat.num` is ordinary namespace-import qualification, not a property magically attached to the Rat runtime value/constructor.

A generated handle/factory name colliding with an explicit public companion export is a hard compile error. The compiler never silently renames public evidence.

---

## 5. Parameterized dictionary factories

An instance whose evidence depends on other evidence is represented by an actual factory function. The public name remains the lowercase constraint name:

```ts
Vector.show(Show.string)
Option.eq(Eq.int)
Map.show(Show.string, Show.int)
```

Representative exports from the corresponding companion modules:

```ts
// vector.d.ts
export declare function show<a>(
  element: Show.Dictionary<a>,
): Show.Dictionary<Hex.Vector<a>>;

// option.d.ts
export declare function eq<a>(
  element: Eq.Dictionary<a>,
): Eq.Dictionary<Option<a>>;

// map.d.ts
export declare function show<k, v>(
  key: Show.Dictionary<k>,
  value: Show.Dictionary<v>,
): Show.Dictionary<Hex.Map<k, v>>;
```

The compiler term “parameterized dictionary factory” describes the implementation shape; the public surface is deliberately the shorter companion operation `Vector.show(...)`. The name matches the implementation exactly: a real function accepts required dictionaries and returns the derived/composed dictionary object.

Factory argument order follows the instance head's declared type-parameter order, with each parameter's required evidence ordered by the stable constraint ordering rule (§7).

Factories may memoize by input dictionary identity, but memoization is an implementation optimization and must not change evidence semantics. Global coherence guarantees that two lawful dictionaries for the same public instance cannot disagree within one program graph.

---

## 6. Subject-first parameters and trailing evidence

Hexagon privileges the first ordinary argument as the subject: APIs are subject-first and the pipe operator inserts its value there. Constraint evidence is neither a subject nor a source argument.

The elaboration model is two-ended:

```text
pipe/source supplies from the left:  [subject] [ordinary arguments]
compiler/evidence supplies from the right:                         [evidence]
```

> Pipes elaborate at the left edge; constraint resolution elaborates at the right edge.

Source-level argument positions never move when evidence is inserted or erased. A monomorphic specialization removes only the evidence suffix.

For multiple constraints, evidence occupies a deterministic suffix ordered alphabetically by `(type-variable name, constraint name)`. Type-variable names use their canonicalized declared order for ABI stability; alpha-renaming in source must not silently change an ABI, so the normative compiler spec must encode this as type-variable ordinal plus constraint name rather than raw spelling.

Example:

```hexagon
export let inspect<a: (Eq, Show), b: Ord>(subject: a, other: b): String = ...
```

Logical generic edition:

```ts
export declare function inspect<a, b>(
  subject: a,
  other: b,
  eqA: Eq.Dictionary<a>,
  showA: Show.Dictionary<a>,
  ordB: Ord.Dictionary<b>,
): string;
```

---

## 7. Superconstraints

Superconstraint evidence is nested in the subconstraint dictionary as already directed by Constraints §6.2. A JS caller passes only the most specific required dictionary.

Conceptually:

```ts
// ord.d.ts
import type * as Eq from "@hexagon/runtime/eq";

export interface Dictionary<a> {
  readonly eq: Eq.Dictionary<a>;
  readonly compare: (x: a, y: a) => Ordering;
}
```

An `Ord.Dictionary<a>` therefore discharges both `Ord<a>` and `Eq<a>`. If a function independently declares both constraints, compiler canonicalization must avoid requesting duplicate evidence already supplied through a superconstraint; exact elaboration follows the normative Constraints/compiler rule and becomes part of the dictionary ABI.

---

## 8. Public exposure rule

Public evidence is determined by nameability, not current consumption:

1. The constraint is public.
2. The instance head's outer type constructor is public.
3. Every type/evidence component appearing in the handle or factory signature is public.
4. The lawful instance is present in the compiled program graph.

If these hold, the handle/factory appears even when no current exported generic function consumes it. This keeps public capability stable, supports separately compiled packages, and permits composition into factories required elsewhere.

Internal instances remain compiler plumbing. Their existence never reshapes a foreign module's public surface.

Because instances ignore Hexagon's ordinary `export` syntax, evidence exposure is generated from the public nameability rule rather than an `export honor` form (`export honor` remains illegal).

---

## 9. Calling convention, wrappers, and validation

The generic base-name edition uses the same trailing-evidence convention as internal polymorphic code. A stable module-level wrapper is generated only when top-level value adaptation, validation required by a named conversion, or ABI plumbing makes it necessary; otherwise the generic export may directly reuse the internal calling convention.

Fixed-arity v1 calls perform no routine evidence validation. TypeScript brands catch ordinary mistakes, and untyped JavaScript remains trusted. Diagnostics/documentation must show the required final evidence arguments and the expected handle homes.

Variadic Hexagon source functions do not exist in v1. A later rest-parameter design remains mechanically compatible with trailing evidence through a typed variadic tuple and right-edge extraction:

```ts
export declare function collect<a>(
  subject: Collection<a>,
  ...args: [...items: a[], show: Show.Dictionary<a>]
): string;
```

The emitted function would peel the statically known evidence count from the right. Runtime brand validation is recommended for that future variadic case because an omitted dictionary could otherwise consume the final ordinary rest item. This is a verified future seam, not v1 surface.

---

## 10. Cross-package ABI

Public dictionaries from separately compiled Hexagon packages are compatible only when they target a compatible Hexagon dictionary ABI/runtime version.

ABI commitments include:

- constraint member names and callable signatures;
- superconstraint slots;
- evidence ordering;
- brand identity/recognition where present;
- factory argument order;
- runtime package major compatibility.

Adding, removing, or changing a constraint member is a public dictionary-ABI event. Package metadata/interface files must eventually record the dictionary ABI/runtime version; exact package-resolution mechanics remain with the package-system spec.

Dictionary objects should be immutable/frozen. JS can still fabricate or mutate values through unsafe means; no language targeting JS can prevent deliberate boundary lies without universal validation, which Hexagon rejects for ordinary fast extern calls.

---

## 11. Diagnostics

Required diagnostic/documentation cases:

1. Missing evidence argument: show the expected `Constraint.Dictionary<a>` suffix and candidate public handles.
2. Mismatched evidence in TypeScript: nominal generic types identify the value type.
3. Generated handle/factory collision: name both the instance and explicit export; require a source export rename.
4. Public instance with an unnameable signature component: keep the handle private and explain why it cannot cross if referenced by an exported generic surface.
5. Incompatible runtime/package dictionary ABI: report both versions/packages before executing the call where metadata permits.
6. Generic edition absent because no public non-fundamental evidence exists: documentation points JS callers to the generated fundamental specializations.

---

## 12. Decisions summary

1. Fundamental JS entry points specialize and take no dictionaries; separate note owns their names/expansion.
2. The generic base-name edition appears for public usable non-fundamental evidence.
3. Dictionary types are constraint-specific and qualified: `Num.Dictionary<a>`, `Eq.Dictionary<a>`, `Show.Dictionary<a>`; their operation records contain required and inherited-default members alike.
4. All Hexagon-originated `.d.ts` binders use lowercase Hexagon convention.
5. Fundamental handles are constraint-owned (`Num.int`, `Show.string`).
6. Public non-fundamental handles/factories are type-owned and use lowercase constraint names (`Rat.num`, `Vector.show(...)`).
7. Every publicly nameable lawful instance receives a handle/factory; private instances do not.
8. Parameterized evidence is a real companion factory function.
9. Evidence is trailing; ordering is stable by type-variable ordinal then constraint name.
10. Superconstraint evidence is nested; callers pass the most specific required dictionary.
11. TypeScript branding is mandatory; routine runtime validation is not.
12. Cross-package dictionaries require a compatible runtime/dictionary ABI.
13. Variadic evidence extraction is deferred but remains mechanically compatible.
