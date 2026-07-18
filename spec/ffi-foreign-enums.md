# Hexagon Spec: Foreign Enums

**Status:** Decided (July 2026)
**Scope:** The `extern enum` declaration; its relationship to ordinary nullary unions;
foreign enum-object member binding; local constructor names and aliases; trusted direct
crossing; checked `JsValue` conversion; pattern matching; derived constraints; JavaScript
emission; TypeScript declarations; diagnostics; and ABI obligations.
**Not in scope:** General `extern` syntax beyond the form introduced here; the complete
`JsValue` accessor API; TypeScript `const enum`; bitmask/flag APIs; payload-bearing
foreign discriminated unions; or automatic discovery of JavaScript object properties.
**Companions:** Unions §§2–7 (constructor, match, derivation, and ordinary union
representation semantics); Pattern Matching (constructor patterns and exhaustiveness);
Modules (namespaces and export correspondence); Exceptions §6 (`JsValue` and
`JsError`); the bounded FFI proto-spec (`notes/ffi-proto-spec-questions.md`); and the
reader-facing JavaScript Input chapter.

This is a focused normative component of the consolidated FFI corpus indexed by
`ffi.md`. It adds one foreign-description form without otherwise reopening the
existing extern decisions.

---

## 1. Doctrine

JavaScript has no single enum runtime type. TypeScript numeric enums, TypeScript string
enums, frozen constant objects, symbol-valued objects, and singleton-instance objects
nevertheless share one useful runtime shape: a stable object whose named properties
hold the possible values.

Hexagon describes that shape with a **foreign-backed nullary union**:

```hexagon
extern from "direction"
  enum Direction =
    | Up
    | Down
    | Left
    | Right
```

Inside Hexagon, `Direction` is a closed nominal union. `Up`, `Down`, `Left`, and
`Right` are nullary constructors; ordinary constructor patterns, exhaustiveness,
reachability, derivation, and companion lookup apply. At runtime, however, each
constructor is the corresponding foreign property value rather than the ordinary
all-nullary-union string named by Unions §6.2.

This exception is explicit and boundary-local:

> An ordinary all-nullary `union` is represented by its constructor-name strings. An
> `extern enum` is represented by the stable foreign member values named in its
> declaration.

The foreign representation is already the Hexagon representation. Typed extern calls
therefore add no encoder, decoder, wrapper, copy, or recursive traversal.

`Option(a)` remains presence/absence (`Some(a) | None`). A foreign enum is a general
closed set of alternatives and is not an `Option` merely because its declaration lists
options in the English sense.

---

## 2. Declaration and names

### 2.1 Syntax

Within an `extern from` block:

```text
[export] enum ForeignTypeName [as LocalTypeName]
    [derives DeriveList] =
  [|] ForeignMemberName [as LocalConstructorName]
  [| ForeignMemberName [as LocalConstructorName]]...
```

The compact single-line form is also legal:

```hexagon
extern from "direction"
  enum Direction = Up | Down
```

The foreign type name identifies the named module export containing the enum object.
As elsewhere in `extern`, aliases are foreign-name-first:

```hexagon
extern from "keyboard"
  enum Key as Direction derives (Eq, Show) =
    | ARROW_UP as Up
    | ARROW_DOWN as Down
```

This imports `Key`, reads `Key.ARROW_UP` and `Key.ARROW_DOWN`, introduces the local
nominal type `Direction`, and introduces the local constructors `Up` and `Down`.

`enum`, like `class`, is contextual foreign-description vocabulary. It does not add an
ordinary top-level `enum` declaration to Hexagon. The body permits nullary members
only: parentheses or payload slots are a hard error with the rewrite "foreign enums
contain stable values only; use `extern type` plus explicit operations for structured
foreign values."

Foreign enum declarations are monomorphic. A type-parameter list is a hard error:
foreign member objects do not provide a representation for independently instantiated
type parameters.

### 2.2 Namespace and duplicate rules

The local type name enters the type namespace and each local constructor enters the
term/constructor namespace exactly as for an ordinary union. Existing duplicate-name,
case, import-alias, qualification, and constructor-ambiguity rules apply unchanged.

Foreign member names name JavaScript properties and follow the foreign identifier
grammar accepted elsewhere by extern member declarations. Local constructor names
must be uppercase-start. A repeated foreign member or local constructor is a compile
error.

The compiler never discovers members with `Object.keys`, `Object.values`, reverse-map
inspection, TypeScript declarations, or package analysis. The explicit list is the
closed set used by the type checker. This is required both for exhaustiveness and to
ignore the reverse numeric properties emitted by TypeScript numeric enums.

### 2.3 Export

An unprefixed declaration is private to the binding module. `export enum` exports the
local nominal type, every local constructor, and the generated conversion bindings
from §5, following the existing rule that `export` exports everything a
type-introducing declaration makes public. It does not modify the foreign package.

---

## 3. Foreign contract and initialization

The declaration is a trusted contract. It asserts that:

1. the named module export is an object or constructor object;
2. every declared member property exists when the module initializes;
3. reading each property once produces a stable value;
4. no declared value is `null` or `undefined`;
5. declared values are pairwise distinct under JavaScript `Object.is`; and
6. any foreign binding declared with this enum type produces only those member values.

The compiler reads each property exactly once during ordinary ESM initialization and
retains the result in a stable module binding:

```js
import { Direction as $Direction } from "direction";

const Up = $Direction.Up;
const Down = $Direction.Down;
```

Later mutation of `$Direction.Up` does not change the meaning of the Hexagon
constructor. A getter runs once. APIs whose members are intentionally dynamic are not
enums under this contract and must use `get`, `fun`, or an opaque foreign type.

As with `extern fun sampleCount(): Int`, ordinary typed use performs no defensive
validation. A missing, duplicate, unstable, or out-of-set member is a false foreign
declaration, not a condition silently converted to `Option`. Implementations may offer
development assertions, but they are not part of release semantics.

`null` and `undefined` members are rejected by the contract so missing properties do
not masquerade as constructors and so foreign absence continues to pass through
`Nullable(a)` rather than acquiring a second representation.

---

## 4. Typing, construction, and matching

Locally, an extern enum has the same nominal typing rules as an ordinary monomorphic
all-nullary union:

```hexagon
let initial: Direction = Up

let describe(direction: Direction): String =
  match direction
    Up => "up"
    Down => "down"
```

Constructors are values, not nullary functions. `Up()` receives the ordinary nullary
constructor diagnostic. Two extern enums listing identically named or identical-looking
foreign values remain distinct nominal types.

Exhaustiveness and reachability use the declared local constructor set. Matching
evaluates the scrutinee once and compares it with the captured member bindings using
`Object.is`:

```js
if (Object.is(direction, Up)) return "up";
if (Object.is(direction, Down)) return "down";
```

`Object.is` is normative. It handles strings, numbers, `NaN`, signed zero, symbols,
and object/singleton identity with one rule. The compiler may use a `switch` or `===`
only when it can prove the result identical for every declared member representation.

The ordinary foreign-contract rule explains the exhaustive-match edge: a foreign
function falsely declared as returning `Direction` may return an out-of-set value.
Hexagon need not add a hidden default arm to every match, just as it does not add a
safe-integer guard to every `Int` return. Use §5's explicit decoder when the source is
uncertain.

---

## 5. Direct crossing and explicit checked conversion

### 5.1 Typed extern signatures are representation-direct

An enum value crosses unchanged in both directions:

```hexagon
extern from "direction"
  enum Direction = Up | Down
  fun current(): Direction
  fun move(direction: Direction): Unit
```

`move(Up)` passes the captured `$Direction.Up` value. `current()` returns its JavaScript
value directly. Consequently, an extern enum is representation-direct inside records,
arrays, callbacks, and other representation-direct aggregates. It does not trigger the
nested-adapter restrictions that apply to `Seq(a)`.

This rule handles all common object-backed forms without representation-specific
syntax:

- TypeScript numeric and string enums;
- JavaScript string- or number-valued frozen objects;
- symbol-valued objects; and
- stable singleton instances stored on an object or class.

A JavaScript class remains an opaque foreign type when declared with `extern class`.
Using `extern enum` for its static singleton values is an explicit stronger claim that
the listed instances form the entire supported set; it exposes no constructor,
inheritance, methods, or arbitrary class instances.

### 5.2 Generated checked conversion

Every extern enum introduces two ordinary module-level conversion bindings. Their
names prefix the unchanged local type name, avoiding acronym case conversion and
allowing several enums in one binding module:

```text
fromJsDirection : JsValue -> Option(Direction)
toJsDirection   : Direction -> JsValue
```

For any local enum name `T`, the names are exactly `fromJsT` and `toJsT`.
`fromJsDirection` evaluates its input once, compares it with the captured members in
declaration order using `Object.is`, and returns the corresponding constructor in
`Some`; otherwise it returns `None`. It is the checked path for data whose foreign
producer cannot state the enum contract. `toJsDirection` is an identity widening to
opaque `JsValue`; it does not allocate or encode.

This generated closed-set membership projection intentionally returns `Option`: a miss has one meaning and needs no composable reason or path. Part 11's composable `JsValue` decoder surface instead returns `Result(_, JsConversionError)`; any other partial projection states its failure type in its owning specification (Part 12 §11.2).

These are bindings, not members on a type-valued namespace: Hexagon types are not
runtime objects, and the language does not invent a `Direction.fromJs` lookup rule.
Either generated name colliding with an explicit or generated term binding is a hard
compile error naming both origins; the binding author must rename the local enum type
or the conflicting declaration. No silent suffix is permitted.

Pairwise distinctness makes `fromJs` unambiguous. If a foreign API deliberately aliases
two names to one value, those names cannot be distinct Hexagon alternatives; declare a
single constructor or keep the carrier type (`Int`, `String`, or an opaque type) and
interpret it explicitly.

`JsValue` is the final name fixed by Part 11. It faces `unknown`, crosses by identity,
and owns the general accessor/decoder surface; those facts do not alter this enum's
membership-projection semantics.

---

## 6. Derivation

`derives` occupies the ordinary header position, after the local type name and before
`=`. The derivable set and superconstraint rules are the ordinary union rules. Their
observable semantics are representation-independent:

- `Eq` compares constructors; emission may use `Object.is` on the captured values;
- `Ord` follows declaration order, never numeric/string/object ordering;
- `Show` uses the local constructor name (`Up`), not a foreign string value or symbol
  description; and
- `Hash` hashes the declaration index, not mutable object structure or foreign numeric
  magnitude.

Payload recursion is impossible because extern enums are nullary. Explicit lawful
`honor` declarations remain possible in the enum's home binding module under the
ordinary orphan and coherence rules.

---

## 7. JavaScript and TypeScript surface

### 7.1 JavaScript emission

Member bindings are stable constants holding the foreign values. Calls and aggregates
use them directly. Matches use §4's identity tests. No enum reverse object, numeric
table, string remapping, wrapper class, or brand is created at runtime.

When public, constructors are ordinary named ESM exports whose runtime values remain
the captured foreign values. `fromJsT` is emitted as a small identity-membership chain;
`toJsT` is an identity function. The compiler may inline either operation internally
when doing so preserves ordinary value evaluation and public function identity.

### 7.2 `.d.ts`

An exported extern enum receives a nominal TypeScript face because the Hexagon
declaration promises a closed set even when the dependency's declarations widen its
properties to `string`, `number`, `symbol`, or a common class:

```ts
declare const directionBrand: unique symbol;

export type Direction = {
  readonly [directionBrand]: never;
};

export declare const Up: Direction;
export declare const Down: Direction;
export declare function fromJsDirection(value: unknown): Option<Direction>;
export declare function toJsDirection(value: Direction): unknown;
```

The generated JavaScript names exactly match the source bindings from §5.2; collisions
are errors rather than occasions for mangling. The brand is TypeScript-only. Runtime
values remain the dependency's primitive, symbol, or object values.

This surface deliberately directs typed consumers through the exported member
constants. A future enhancement may preserve precise dependency member types when
available, but compiler behavior must not depend on the presence or quality of a
third-party `.d.ts` file.

### 7.3 ABI events

The following are breaking foreign-boundary changes:

- adding, removing, reordering, or renaming a declared member;
- changing a foreign member property or local constructor alias;
- changing a member's runtime value or identity;
- changing between ordinary `union`, `extern enum`, `extern type`, and `extern class`;
  or
- changing the derived public capabilities.

Reordering is an ABI event because it changes derived `Ord` and `Hash` semantics even
when the raw values remain unchanged.

---

## 8. Exclusions and diagnostics

### 8.1 TypeScript `const enum`

A TypeScript `const enum` is normally erased and supplies no runtime object to import.
It cannot satisfy `extern enum`. Publish a real object/facade, use a normal enum, or bind
the inlined primitive carrier and interpret it explicitly. Diagnostic when the named
export is observably absent: "`Direction` has no runtime enum object; TypeScript
`const enum` values require a JavaScript facade or an explicit primitive binding."

### 8.2 Flags and bitmasks

Bitflag APIs are not closed alternatives: `Read | Write` may be valid without being a
declared member. Bind them as `Int` or an opaque foreign type with explicit bit
operations. Documentation and diagnostics should suggest this rewrite when member
values are declared as combinable flags.

### 8.3 Alias values

Distinct declared properties with the same `Object.is` value violate §3. A compiler is
not required to check the violation at module initialization, but `fromJs` must not
pretend aliases are distinguishable. Tooling able to inspect literal declarations may
diagnose the problem early.

### 8.4 Literal unions without an object

A TypeScript type such as `"up" | "down"` has no runtime enum object. When its values
match Hexagon constructor strings, use an ordinary all-nullary union in a trusted
extern signature. When spellings differ, write an explicit primitive decoder or place
a small JavaScript enum object/facade beside the dependency. `extern enum` does not
invent an object that the foreign module does not export.

---

## 9. Acceptance tests

An implementation is not conforming until tests cover at least:

1. TypeScript-style numeric members while ignoring reverse-map properties.
2. String members whose values differ from local constructor names.
3. Symbol members and singleton object members matched by identity.
4. Foreign and local aliases in the same declaration.
5. Direct parameters, returns, callbacks, and nested `Array(Enum)` values without
   wrappers or traversal.
6. Exhaustive and non-exhaustive matches using the declared local constructor set.
7. `fromJsT` success for every member and `None` for an unrelated value.
8. `toJsT` preserving primitive value or object identity.
9. Derived `Eq`, `Ord`, `Show`, and `Hash` following §6 rather than carrier semantics.
10. Private versus `export enum` JavaScript and `.d.ts` surfaces.
11. Diagnostics for payload members, parameters, duplicate names, and attempted use of
    a missing runtime/`const enum` export.
12. No regression to ordinary all-nullary unions' constructor-name string ABI.

---

## 10. Decisions log

| Decision | Result |
|---|---|
| Local semantic model | Closed nominal nullary union |
| Runtime representation | Captured foreign member values |
| Ordinary boundary crossing | Direct and trusted; no conversion |
| Match comparison | `Object.is`, subject to proven-equivalent optimization |
| Member discovery | Never automatic; explicit declaration list only |
| Uncertain input | Generated `fromJsT : JsValue -> Option(T)` binding |
| Checked-failure boundary | Generated membership projections keep `Option`; composable `JsValue` decoders use `Result(_, JsConversionError)` |
| Outbound `JsValue` | Generated identity `toJsT` binding |
| JavaScript classes | Opaque under `extern class`; singleton enum view is explicit opt-in |
| TypeScript numeric reverse map | Ignored |
| `const enum` / flags | Excluded |
| Ordinary union representation | Unchanged |
