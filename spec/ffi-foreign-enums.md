# Hexagon Spec: Foreign Enums

**Status:** Decided (July 2026)
**Scope:** The `extern enum` declaration in its two forms — object-reading and literal
(§2.4); its relationship to ordinary nullary unions; foreign enum-object member binding; local constructor names and aliases; trusted direct
crossing; checked `JsValue` conversion; pattern matching; derived constraints; JavaScript
emission; TypeScript declarations; diagnostics; and ABI obligations.
**Not in scope:** General `extern` syntax beyond the forms introduced here; the complete
`JsValue` accessor API; TypeScript `const enum` beyond §8.1's rewrite; bitmask/flag APIs; payload-bearing
foreign discriminated unions; or automatic discovery of JavaScript object properties.
**Companions:** Unions §§2–7 (constructor, match, derivation, and ordinary union
representation semantics); Pattern Matching (constructor patterns and exhaustiveness);
Modules (namespaces and export correspondence); Exceptions §6 (`JsValue` and
`JsError`); the bounded FFI proto-spec (`notes/ffi-proto-spec-questions.md`); and the
reader-facing JavaScript Input chapter.

This is a focused normative component of the consolidated FFI corpus indexed by
`ffi.md`. It adds one foreign-description form, in two spellings, without otherwise
reopening the existing extern decisions.

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
union's shared constant named by Unions §6.1.

This exception is explicit and boundary-local:

> An ordinary `union` is represented by its shared constants and tagged objects
> (Unions §6). An `extern enum` is represented by the foreign values named in its
> declaration — read once from a foreign object, or written as literals (§2.4).

A second family of foreign alternatives has no object at all: a TypeScript literal
union (`"up" | "down"`, `0 | 1`, `true | false | null`) whose values are inlined at every
use, a `const enum`'s erased members, or a protocol's sentinel values. Hexagon
describes that set with the same declaration in its **literal form** (§2.4): the values
are written in the declaration and nothing is read. Both forms are the same union
inside Hexagon; they differ only in where the runtime values come from.

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

An unprefixed declaration is private to the binding module. `export enum` inside a
block, or `export extern enum` on the literal head (§2.4), exports the
local nominal type, every local constructor, and the generated conversion bindings
from §5, following the existing rule that `export` exports everything a
type-introducing declaration makes public. It does not modify the foreign package.

### 2.4 The literal form

A foreign set of values that no object holds is declared at **module scope**, outside
any `extern from` block, with each value written in place of a member name:

```hexagon
extern enum Direction = "up" as Up | "down" as Down

export extern enum Tri derives (Eq, Show) =
    | true as Yes
    | false as No
    | null as Unknown
```

```text
[export] extern enum LocalTypeName [derives DeriveList] =
  [|] Literal as LocalConstructorName
  [| Literal as LocalConstructorName]...
```

- **The head stands alone.** `extern from` names the module a block's declarations are
  read from; a literal enum reads nothing, so it has no `from` to sit under and is the
  FFI's one module-free `extern` head (Part 4 §2.2). A `from`-less `extern` block is not
  a spelling: the head is `extern enum`, or `extern from` with an enum read inside it. It is an ordinary declaration of
  the module it appears in: declared once, exported with the ordinary prefix
  (`export extern enum`, §2.3's rule unchanged), and reached from other modules through
  their import of that module, exactly as an `extern from` block's declarations are.
- **A literal is** a string literal, an integer literal, `true`, `false`, `null`, or
  `undefined`. An integer literal is `Int`-valued and may carry a leading `-`, which is
  part of the literal here as it is in a pattern (Pattern Matching §2.5): a member list
  contains no operators, so there is no unary minus to collide with; `-0` denotes `0`,
  so `0 as A | -0 as B` is the duplicate-value refusal, and no signed zero ever reaches
  §4's `switch`. Kinds mix freely within one declaration; the values are pairwise
  distinct under `Object.is` (§3 rule 5).
- **A plain foreign `boolean` is `Bool`** (Unions §6.2's pin) and wants no enum; the
  literal form's `true`/`false` are for a set a boolean shares with other values. Not a
  literal: a float literal — `NaN` and signed zero separate `Object.is` from `===`, and
  §4's `switch` lowering rests on their agreement — an interpolated string, or any
  expression. Refused with "a literal enum member is a string, integer, boolean, `null`
  or `undefined` literal"; a duplicate value is refused naming both members.
- **`as` is mandatory.** Every value is written. A member whose string equals its
  constructor's spelling (`"Up" as Up`) is a coincidence of the source, never a rule: no
  member is ever named by its constructor, which is the door Unions §6.2 closed.
- **Nullish members are legal in the literal form only.** The object-reading contract
  (§3 rule 4) refuses them because a read `undefined` cannot be told from a missing
  property; nothing is read here, and an API's `null` sentinel is a member of its set,
  not an absence. The contract's second reason — foreign
  absence passes through `Nullable(a)` and takes no second representation — is given up
  here knowingly: a nullish member is a value of a closed declared set, named and
  matched like any other, and the designation that follows is what keeps `Nullable(a)`
  from being asked to represent it a second time. A literal enum with a nullish member
  is a **designated nullish-absorbing type** (Part 2 §2.1, Part 11 §8): `Nullable(T) ≡
  T`, because `T`'s own value set already holds the nullish form the wrapper would add,
  exactly as `JsValue`'s does — a foreign `T | null` is received as `T` with no
  conversion, and the member is the constructor it names. At `a = T`, Part 2 §4's
  `Nullable.toOption` remains the ordinary projection and sends the nullish member to
  `None`: the caller asked which values are nullish, and the answer is honest; it is
  not the route by which a `T` is received. An enum naming one nullish value and not
  the other still absorbs;
  the unnamed one is out of set like any undeclared value (§4) — an API whose
  `undefined` means absence beside a `null` member names both (`undefined as Missing`).
- Everything else is the object-reading form's: namespaces and duplicates (§2.2 —
  a duplicate reads as a duplicate *value* here, there being no foreign member to
  repeat),
  typing and matching (§4, with the `switch` lowering stated there), crossing and the
  generated `fromJsT`/`toJsT` (§5), derivation (§6), ABI events (§7.3). Emission binds
  the literals themselves (§7.1); the `.d.ts` face is the literal union (§7.2).

*Conformance: the literal form is not yet implemented — #773.*

---

## 3. Foreign contract and initialization (object-reading form)

The declaration is a trusted contract. It asserts that:

1. the named module export is an object or constructor object;
2. every declared member property exists when the module initializes;
3. reading each property once produces a stable value;
4. no declared value is `null` or `undefined`;
5. declared values are pairwise distinct under JavaScript `Object.is`; and
6. any foreign binding declared with this enum type produces only those member values.

The literal form has no contract to read: its values are the declaration's own. Rules
5 and 6 apply to it verbatim; rules 1–4 have no seat (§2.4).

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
evaluates the scrutinee once and compares it with the member bindings (captured or
literal) using `Object.is`:

```js
if (Object.is(direction, Up)) return "up";
if (Object.is(direction, Down)) return "down";
```

`Object.is` is normative. It handles strings, numbers, `NaN`, signed zero, symbols,
and object/singleton identity with one rule. The compiler may use a `switch` or `===`
only when it can prove the result identical for every declared member representation.
The literal form is that case by construction — every member is a string, integer,
boolean or nullish literal, on which `===` agrees with `Object.is` — so a literal
enum's match lowers to a `switch` on the scrutinee — here for
`extern enum Order = "asc" as Ascending | "desc" as Descending`:

```js
switch (order) {
  case "asc": return "ascending";
  case "desc": return "descending";
}
```

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
`fromJsDirection` evaluates its input once, compares it with the declared members
(captured or literal) in declaration order using `Object.is`, and returns the corresponding constructor in
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
`=`. The derivable set and base constraint rules are the ordinary union rules. Their
observable semantics are representation-independent:

- `Eq` compares constructors; emission may use `Object.is` on the member values;
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

Member bindings are stable constants holding the foreign values — read from the enum
object, or the literals themselves in the literal form (`const Up = "up";`, with
nothing imported). Calls and aggregates use them directly. Matches use §4's identity
tests, including the `switch` §4 licenses for the literal form. No enum reverse object, numeric
table, string remapping, wrapper class, or brand is created at runtime.

When public, constructors are ordinary named ESM exports whose runtime values remain
the foreign values — captured, or the literals. `fromJsT` is emitted as a small identity-membership chain;
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

**The literal form faces as the literal union its values spell** — the values are known
exactly, so the brand's opacity has nothing to cover. What the literal face gives up is
the object-reading form's nominal distinctness (§4): two literal enums over
`"asc" | "desc"` face TypeScript as one type, and a bare `"asc"` is accepted where
either is expected — the trade a form whose values the foreign side owns makes on
purpose:

```ts
export type Direction = "up" | "down";
export type Tri = true | false | null;

export declare const Up: Direction;
export declare const Down: Direction;
export declare function fromJsDirection(value: unknown): Option<Direction>;
export declare function toJsDirection(value: Direction): unknown;
```

This is the one place Hexagon emits a union of literal types, and it is right by
Unions §6's principle: the foreign side owns the concept, and a TypeScript consumer meets it in
TypeScript's own spelling.

This surface deliberately directs typed consumers through the exported member
constants. A future enhancement may preserve precise dependency member types when
available, but compiler behavior must not depend on the presence or quality of a
third-party `.d.ts` file.

### 7.3 ABI events

The following are breaking foreign-boundary changes:

- adding, removing, reordering, or renaming a declared member;
- changing a foreign member property or local constructor alias;
- changing a member's runtime value or identity;
- changing between ordinary `union`, `extern enum`, `extern type`, and `extern class`,
  or between `extern enum`'s object-reading and literal forms; or
- changing the derived public capabilities.

Reordering is an ABI event because it changes derived `Ord` and `Hash` semantics even
when the raw values remain unchanged.

---

## 8. Exclusions and diagnostics

### 8.1 TypeScript `const enum`

A TypeScript `const enum` is normally erased and supplies no runtime object to import.
It cannot satisfy the object-reading form. Declare its inlined values with the literal
form (§2.4) — `extern enum Level = 0 as Low | 1 as High` — or publish a real
object/facade. Diagnostic when the named export is observably absent: "`Direction` has
no runtime enum object; write its values with the literal form, `extern enum Direction
= … as …`, or bind a JavaScript facade."

### 8.2 Flags and bitmasks

Bitflag APIs are not closed alternatives: `Read | Write` may be valid without being a
declared member. Bind them as `Int` or an opaque foreign type with explicit bit
operations. Documentation and diagnostics should suggest this rewrite when member
values are declared as combinable flags.

### 8.3 Alias values

Distinct declared properties with the same `Object.is` value violate §3. A compiler is
not required to check the violation at module initialization, but `fromJs` must not
pretend aliases are distinguishable. Tooling able to inspect the foreign module's
source may diagnose the problem early. That concession is the object-reading form's:
the literal form knows its values and refuses a duplicate at compile time (§2.4).

### 8.4 Literal unions without an object

A TypeScript type such as `"up" | "down"` has no runtime enum object, and an ordinary
all-nullary union does not describe it: such a union is tagged objects (Unions §6.2),
so a foreign `"up"` typed as one would satisfy no arm. Declare it with the literal
form (§2.4):

```hexagon
extern enum Direction = "up" as Up | "down" as Down
```

The object-reading form does not invent an object that the foreign module does not
export.

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
12. No regression to ordinary all-nullary unions' tagged-object ABI (Unions §6.2).
13. The literal form at module scope: string, integer, boolean and mixed members;
    private and `export extern enum` surfaces; reached abroad through the module
    import.
14. Literal-form nullish members: `null` and `undefined` as members; `Nullable(T) ≡ T`
    for such an enum; an enum naming only `null` treats an arriving `undefined` as out
    of set.
15. Literal-form match lowering to `switch`, and `fromJsT`/`toJsT` over the literals.
16. Literal-form `.d.ts`: the literal union face, no brand; constructors and conversions
    typed by the alias.
17. Literal-form diagnostics: a float literal, an expression, a missing `as`, a
    duplicate value under `Object.is`, a literal member inside an `extern from` block
    (which reads members, never writes them), and a `from`-less `extern` block.

---

## 10. Decisions log

| Decision | Result |
|---|---|
| Local semantic model | Closed nominal nullary union |
| Runtime representation | Captured foreign member values, or the declaration's own literals (§2.4) |
| Ordinary boundary crossing | Direct and trusted; no conversion |
| Match comparison | `Object.is`, subject to proven-equivalent optimization |
| Member discovery | Never automatic; explicit declaration list only |
| Uncertain input | Generated `fromJsT : JsValue -> Option(T)` binding |
| Checked-failure boundary | Generated membership projections keep `Option`; composable `JsValue` decoders use `Result(_, JsConversionError)` |
| Outbound `JsValue` | Generated identity `toJsT` binding |
| JavaScript classes | Opaque under `extern class`; singleton enum view is explicit opt-in |
| Literal form (#773) | Module-scope `extern enum T = lit as C \| …`, the FFI's one module-free `extern` head; nothing read; string, integer, boolean, `null`, `undefined` literals mixed freely, pairwise distinct; floats and expressions refused; `as` mandatory |
| Literal-form nullish members | Legal (nothing is read); the enum is a designated nullish-absorbing type, `Nullable(T) ≡ T` |
| Literal-form emission and face | Constants are the literals; match lowers to `switch`; `.d.ts` is the literal union, no brand |
| TypeScript numeric reverse map | Ignored |
| `const enum` / object-free literal unions | The literal form (§2.4, §8.1, §8.4) |
| Flags | Excluded (§8.2) |
| Ordinary union representation | Unchanged |
