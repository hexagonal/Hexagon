# FFI Note: Zero-Cost Fundamental Specializations

**Status:** Superseded and historical (July 2026). Promoted into FFI Part 8; correction records remain in that normative target.
**Purpose:** Fix the JavaScript/TypeScript export surface of constrained-polymorphic Hexagon functions so fundamental types retain direct, dictionary-free entry points while public non-fundamental types remain usable through one generic dictionary edition.
**Companions:** `ffi-proto-spec-questions.md`; `ffi-exported-dictionaries.md`; Constraints §6; Numeric Literals §5; Primitive Types; whole-program emission doctrine.

---

## 1. Doctrine

Hexagon's zero-cost concrete-type rule extends through the JavaScript boundary:

> An exported constrained-polymorphic function generates direct monomorphic entry points for every lawful fundamental-type specialization. These entry points take no dictionaries and contain concrete emitted operations. A generic trailing-dictionary edition is added only when the compiled public instance graph contains a usable non-fundamental instance satisfying the function's constraints.

This is a hybrid surface:

```text
fundamental concrete types -> named direct specializations
public non-fundamental types -> base-name generic dictionary edition
private/internal types -> no effect on the JS export surface
```

The design deliberately accepts bounded code growth in exchange for direct primitive entry points. It is analogous in purpose—not mechanism—to runtimes that specialize generic code for value types: JavaScript lacks the required generic runtime facility, so Hexagon exposes the specializations as named ESM functions.

---

## 2. Fundamental type set

The closed fundamental set is:

```text
Int
Float
BigInt
Bool
String
Unit
```

“Fundamental” is a language category, not an inference from runtime size, representation, or current engine performance. `Date`, `Array`, `Nullable`, runtime collections, records, unions, and user types do not enter the set merely because their JS representation is small or native.

Before v1 freezes, perform one explicit inventory review of commonly used JavaScript primitive-like values. The review may add a type only by a language-design decision; it must not replace the closed set with a representation heuristic.

A specialization exists only when every constraint on the relevant type variable has a lawful instance for that fundamental type. For example:

```text
Num  -> Int, Float, BigInt
Show -> whichever members of the closed set have Show
Eq   -> whichever members of the closed set have Eq
```

---

## 3. Single-variable example

Hexagon:

```hexagon
export let plus<a: Num>(x: a, y: a): a = x + y
```

Always-generated fundamental TypeScript entry points:

```ts
export declare function plusInt(x: number, y: number): number;
export declare function plusFloat(x: number, y: number): number;
export declare function plusBigInt(x: bigint, y: bigint): bigint;
```

Representative JavaScript:

```js
export function plusInt(x, y) {
  return x + y;
}

export function plusFloat(x, y) {
  return x + y;
}

export function plusBigInt(x, y) {
  return x + y;
}
```

The specializations are direct emitted bodies, not wrappers that call the dictionary edition. The compiler may share private implementation fragments where doing so preserves the same direct observable emission, but it must not reintroduce dictionary dispatch on these entry points.

If a public non-fundamental `Num` instance exists—for example public `Rat` plus public `Rat.num`—the module additionally exports:

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

JavaScript/TypeScript calls:

```ts
plusInt(10, 20);
plusFloat(1.5, 2.5);
plusBigInt(10n, 20n);
plus(half, third, Rat.num);
```

If no public usable non-fundamental instance satisfies `Num`, the base-name dictionary edition is absent. Adding the first such public instance adds the base-name export; this is an additive ABI change.

---

## 4. Public capability, never internal call sites

Whole-program typing determines internal specializations, but private implementation choices do not reshape the foreign API.

The generic edition trigger is the **public instance graph**:

- the constraint is publicly nameable;
- the non-fundamental outer type constructor is publicly nameable;
- its lawful instance therefore receives a public dictionary handle or factory under the exported-dictionaries rules;
- the exported constrained function can consume that evidence.

A private type or an internal call to the function never causes the generic JS export to appear. Conversely, a public usable instance causes it to appear even if no Hexagon source call happens to instantiate the function at that type; JavaScript callers sit outside Hexagon call-site analysis.

Fundamental specializations are unconditional for an exported constrained function. A JS consumer may import `plusFloat` even when no Hexagon source calls `plus` at `Float`.

---

## 5. Multiple type variables

Generate the complete lawful Cartesian product of fundamental specializations, provisionally accepting code growth.

Hexagon:

```hexagon
export let combine<a: Show, b: Eq>(x: a, y: b): String = ...
```

Representative names:

```text
combineIntInt
combineIntString
combineFloatBool
combineStringBigInt
```

Suffix order follows **declared type-variable order** (`a`, then `b`), never constraint order or parameter occurrence order. A tuple is generated only when every chosen fundamental type satisfies all constraints attached to its corresponding variable.

No arbitrary combination cap exists in the proto-spec. The implementation must measure emitted code and `.d.ts` size. A future threshold, opt-in, or alternative grouping requires field evidence and is not silently introduced by an optimizer.

Only explicitly exported constrained functions expand. User-defined types never multiply named specializations; they share the one dictionary edition.

---

## 6. Names and collisions

The specialization name is:

```text
source export name + fundamental type names in declared type-variable order
```

Examples:

```text
plus + Int               -> plusInt
combine + Int + String   -> combineIntString
```

The source base name is reserved for the generic dictionary edition when that edition exists.

A generated specialization that collides with an explicit public export is a hard compile error. Example:

```hexagon
export let plusInt(x: Int, y: Int): Int = x + y
export let plus<a: Num>(x: a, y: a): a = x + y
```

Diagnostic:

> generated specialization `plusInt` conflicts with exported `plusInt`; rename one of the exports

No silent mangling, numeric suffix, or winner-by-source-order rule is permitted for ABI names.

---

## 7. Internal emission is a separate question

Concrete Hexagon calls already specialize and erase dictionaries:

```hexagon
let answer = plus(20, 22)
```

may emit simply:

```js
const answer = 20 + 22;
```

It need not call exported `plusInt`. Export generation and internal expression optimization are distinct:

- internal known concrete calls emit the best direct code available;
- named specializations exist for external JS/TS callers;
- genuinely polymorphic internal functions carry trailing evidence;
- the public generic edition exists only under §4.

---

## 8. Relationship to dictionary handles

Fundamental specialization does not eliminate dictionaries from the runtime ecosystem. Public parameterized dictionary factories may require fundamental evidence as inputs:

```ts
Vector.show(Show.string)
Option.eq(Eq.int)
```

Therefore the runtime exposes the required fundamental handles (`Show.string`, `Eq.int`, and so on) whenever part of the public dictionary API. Those handles support composition and the generic edition; primitive named specializations remain dictionary-free.

The dictionary types and handles use Hexagon-originated lowercase type parameters in `.d.ts`:

```ts
Show.Dictionary<a>
Eq.Dictionary<a>
Num.Dictionary<a>
```

See `ffi-exported-dictionaries.md` for handle ownership, factories, branding, evidence order, and ABI.

---

## 9. ABI and implementation obligations

1. Fundamental specializations are public named ESM exports and appear in `.d.ts`.
2. Their names are deterministic under §6.
3. Adding/removing a constraint or changing the fundamental set may add/remove specializations and is an FFI ABI event.
4. Adding the first public usable non-fundamental instance may add the generic base-name edition.
5. Constraint-member changes affect the dictionary ABI but need not change specialization names.
6. Bundlers may tree-shake unused named specializations; the compiler does not depend on tree shaking for semantic correctness.
7. Source maps and generated documentation must identify each specialization's originating Hexagon declaration and type tuple.

---

## 10. Revisit bars

- Review the closed fundamental set once before v1 freeze, by language category rather than representation size.
- Revisit Cartesian-product expansion only with measured output from real exported APIs.
- Revisit naming only on demonstrated collision frequency or unusable generated identifiers.
- Never make the public surface depend on private/internal call sites.
- Never replace the generic dictionary edition with automatic per-user-type export explosion; public user instances compose through one generic edition.
