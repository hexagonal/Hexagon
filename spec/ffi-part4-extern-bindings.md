# Hexagon FFI Part 4: `extern` Modules and Bindings

**Status:** Decided (July 2026), revised in place after external review (Sol) before landing. Normative promotion of `spec/notes/ffi-proto-spec-questions.md` §5 — the core syntax, default-export binding, and effect-import packages — excluding the receiver-member and class material, which is Part 5's. The draft's four promotion questions were resolved in §12: unused binding imports may be elided; `extern let` asserts stability; exported extern types receive a generated opaque brand; generic extern declarations are deferred from v1.
**Scope:** The `extern from` block; named and aliased bindings and the foreign-name-first `as` order; the `fun`/`let` callable/value distinction and its targeted diagnostics; type-only `type` declarations; `default` bindings for JavaScript default exports; visibility and re-export of extern bindings; `extern import` and foreign module effects; fixed visible arity and honest nullish parameter slots; declaration-site validation.
**Not in scope:** `method`, `get`, `set`, `extern class`, and companion construction (Part 5); `extern enum` (already normative in `ffi-foreign-enums.md`); calling convention, callbacks, and arity at the call boundary (Part 6); the Hexagon-to-JavaScript export surface and exact `.d.ts` declaration mechanics (Part 7); globals, CommonJS binding forms, overloads, rest/variadic externs, and generic extern declarations (**deferred**, §11).
**Companions:** Part 1 §1/§4/§5.3 (trusted boundary, master type table, nested-adapter restriction); Part 2 (`Nullable` surface used by §9); Modules §2–§3, §8.1 (import forms, bare-specifier ban, acyclicity); Lexer Layout (block layout); Exceptions §6 (`JsError`).

---

## 1. Doctrine

Foreign bindings use JavaScript's `from "specifier"` vocabulary, TypeScript-like bodyless typed declarations, and Hexagon's existing declaration forms and layout. The surface is deliberately recognizable to anyone who reads JS module syntax and TS declaration files — the same JS-verbatim instinct that shaped Modules.

```hexagon
extern from "tiny-json"
  export type JsonValue
  export fun parse(text: String): JsonValue
  export fun stringify(value: JsonValue): String
  let VERSION as version: String
```

The block introduces **ordinary module-level Hexagon bindings**. After the declaration, an extern binding is used exactly like any other binding of the enclosing module: same typing, same visibility rules, same collision rules. Only its linkage (a foreign ESM import) and its trust status (Part 1 §1: a trusted programmer assertion, validated as a declaration and then believed) differ.

Fixed here, inherited from Part 1:

- **Extern declarations have no bodies.** They are typed assertions about a foreign implementation; every extern declaration is therefore **fully type-annotated** — there is nothing to infer from.
- **`extern` imports are leaf edges** for the Modules §8.1 acyclicity rule. Hexagon does not inspect or certify cycles internal to foreign JavaScript modules.
- **Declaration-site validation is real; call-site validation is not.** The compiler checks each extern declaration's syntax, its types, and its boundary-category legality (Part 1 §5.3 — the nested-adapter hard error applies to every extern signature). It then inserts no runtime guards. A declaration the foreign implementation does not satisfy is a contract violation with unspecified observations (Part 1 §3.1).

---

## 2. The `extern from` block

### 2.1 Specifiers

The foreign module specifier is a string literal and **may be a bare package specifier** (`"tiny-json"`, `"node:url"`). This construct is explicitly outside Hexagon-to-Hexagon import resolution, so the Modules §2 ban on bare specifiers between `.hex` modules does not apply to it. Relative specifiers addressing foreign `.js`/`.ts` files are equally legal; what the specifier must not name is another Hexagon module — Hexagon-to-Hexagon linkage is `import`'s job, and the diagnostic for an extern specifier resolving to a `.hex` source says so.

### 2.2 Block contents

An `extern from` block contains only bodyless extern declarations, one per line under ordinary layout:

- `fun` — a callable foreign export (§4);
- `let` — a non-callable foreign value export (§4);
- `type` — a nominal opaque foreign type (§5);
- `default fun` / `default let` — the JavaScript default export (§6);
- `method`, `get`, `set`, `class` — receiver members and classes, specified in Part 5;
- `enum` — per `ffi-foreign-enums.md`.

Each declaration may carry the leading `export` modifier (§7). The block form is the only v1 form; there is no single-declaration `extern fun ... from ...` shorthand.

### 2.3 Multiple blocks and emission

Nothing forbids several `extern from` blocks naming the same specifier, in one module or many; each block simply declares more bindings against the same foreign module. Representative emission is the obvious ESM import, and the emitter may coalesce imports from one specifier:

```js
import { parse, stringify, VERSION as version } from "tiny-json";
```

Emission shape is representative, not normative; what is normative is that the emitted code is readable ESM importing the declared foreign names (Part 1 §1). If whole-program analysis proves that every binding supplied by an `extern from` block is dead, the compiler may elide that binding import entirely. Code that requires evaluation for effects uses `extern import` (§8, §12.1).

---

## 3. Named and aliased bindings

### 3.1 Foreign-name-first `as`

Named members use JavaScript's foreign-name-first alias order:

```hexagon
fun parse as parseJson(text: String): JsonValue
let VERSION as version: String
type ForeignNode as Node
```

The unaliased or right-hand name is the local Hexagon binding. This is the same order as JavaScript's `import { foreignName as localName }`, which is precisely why it is the right order for a JS-facing construct — the reader of the block and the reader of the emitted import see the names in the same positions.

### 3.2 Local names are ordinary names

The foreign JavaScript name and local Hexagon name are checked independently. The
foreign side must be an ECMAScript identifier and retains its exact export spelling;
the local side obeys ordinary Hexagon role rules: term bindings are
non-uppercase-start and type bindings uppercase-start (Lexer §3; Modules §3.2).
Duplicate local bindings collide under the ordinary module-level rules.

A consequence worth stating: a foreign export whose name violates Hexagon's local start-class rules **requires an alias**. `let VERSION: String` alone would introduce an uppercase-start term and is rejected with the named rewrite:

> foreign term `VERSION` is not a legal Hexagon term name; bind it with an alias: `let VERSION as version: String`

The same rule works in the other direction: a caseless foreign type name needs an
uppercase-start local alias, for example `type 用户 as T用户`. These are Rewrite-Rule
diagnostics; neither repair changes the foreign export spelling.

The foreign side of `as` is exempt from Hexagon *role* classification, but not from
ECMAScript identifier validity. Arbitrary-string export names, which ESM permits via
`export { x as "not an identifier" }`, are not representable in v1 (§11).

---

## 4. `fun` versus `let`

### 4.1 The strict callable/value distinction

Inside an extern block, the declaration keywords make a strict distinction:

- **`fun` declares a callable foreign export.** It always carries a parameter list and return type.
- **`let` declares a non-callable foreign value.** It carries a type annotation and never a parameter list.

The distinction follows the declared type as well as the surface punctuation: an extern `let` annotated with a function type is a callable declaration and therefore a hard error. It must be written as `fun` with the corresponding explicit parameter list (Part 6 §2.4/§12.2).

This is contextual foreign-declaration vocabulary. `fun` here means *callable* — not that Hexagon can see or cares whether the JavaScript implementation is recursive; extern declarations have no bodies, so the ordinary `fun`-enables-self-reference reading has no work to do. The trusted-boundary rule remains: declaring a non-callable JS export with `fun`, or a value with an incompatible declared type, is a programmer contract violation (Part 1 §3.1), not a reason for automatic runtime inspection.

### 4.2 Targeted diagnostics

Ordinary Hexagon permits the `let`-function habit (`let double(x: Int): Int = ...`); the extern block deliberately does not, and targeted syntax diagnostics keep the distinction visible. Both are hard errors with named rewrites, per the Rewrite Rule:

```hexagon
extern from "tiny-json"
  let parse(text: String): JsonValue
```

> extern callable declarations use `fun`; write `fun parse(text: String): JsonValue`

```hexagon
extern from "tiny-json"
  fun version: String
```

> extern `fun` declares a callable and requires a parameter list; for a foreign value, write `let version: String`

A deliberately opaque callable *object* (callable and property-bearing at once) is future specialized surface, not a reason to blur v1 `fun` and `let`.

### 4.3 First-class references

A plain extern `fun` names a foreign module-export function — not a receiver member. When its entire boundary signature is representation-direct, a first-class reference denotes the imported function object itself with no wrapper. Passing or comparing repeated references therefore observes the raw foreign function's identity.

If a supported top-level position needs boundary plumbing — canonically a foreign `Iterable<a>` result declared as `Seq(a)` — the local extern binding instead denotes **one stable module-level wrapper**. Every reference observes that same wrapper object; each call performs the required crossing operation, and each adapted value receives Part 3 §2.1's fresh per-crossing adapter. The wrapper owns no per-value memoization state. Without this qualification, detaching the raw import would bypass the declared boundary semantics.

This differs from Part 5's `method`/`get` wrappers in *why* the wrapper exists: receiver members preserve a foreign calling convention, while a plain `fun` wrapper exists only when its signature requires supported boundary plumbing. Part 6 owns calling convention generally.

### 4.4 What `let` asserts

An extern `let` asserts a foreign **value** binding. ESM bindings are live: JavaScript permits a module to reassign its own exported `let` after consumers have imported it. Hexagon `let` promises immutability, and the extern declaration extends that promise across the boundary as part of the trusted contract: a foreign module that reassigns an export declared `extern let` has violated the declaration, and affected Hexagon observations are unspecified (Part 1 §3.1). Hexagon does not re-read defensively, and the compiler remains free to treat the binding as the immutable value it was declared to be. A genuinely time-varying foreign value is declared honestly as a `fun` accessor on the JS side or a `get` receiver property (Part 5), not as `let`.

This is the reviewed reading of the trusted-boundary doctrine (§12.2), not an ESM live-read guarantee.

---

## 5. Type-only declarations

`type` declares a **nominal opaque foreign type**:

```hexagon
extern from "tiny-json"
  export type JsonValue

extern from "url-tools"
  type ForeignNode as Node
```

It has no automatically available structure, constructor, or instances. Hexagon can receive, hold, pass, store, and return values of the type; every operation on it comes from other extern declarations (or Part 5 members) that mention it. Its boundary category is representation-direct — whatever object the foreign API supplies crosses unchanged and by identity (Part 1 §4.1, "extern `type`" row). Opaque extern Promise handles (Part 1 §4.4) are this mechanism applied to a `Promise`-typed foreign value.

An extern `type` need not correspond to any exported TypeScript type in the foreign package; it names a Hexagon-side contract about values that foreign API produces and consumes. Two extern `type` declarations, even against the same foreign name in the same specifier, are distinct nominal Hexagon types — sharing a type across binding modules is done by exporting and importing the Hexagon type like any other (§7).

The `.d.ts` face of an *exported* extern type is a Hexagon-generated **opaque branded named type**. It is not a re-export of the foreign package's own typings: those typings may be absent, structurally permissive, or describe a different abstraction from the binding author's nominal contract. Part 7 owns the exact declaration form and brand machinery (§12.3).

---

## 6. Default imports

JavaScript default exports ship in v1. Inside an extern block, `default` can only identify the incoming JavaScript default export — Hexagon modules have no default exports — so the familiar modifier order is unambiguous:

```hexagon
extern from "client-library"
  default fun createClient(config: Config): Client
```

```js
import createClient from "client-library";
```

A `default` declaration's name is purely the **local** Hexagon binding — the foreign side is the unnamed default export, so there is no foreign name to alias and `default fun x as y` is ill-formed:

> `as` aliases a foreign export name; a `default` binding has none — name the binding directly: `default fun y(...)`

The binding is private by default. The ordinary leading `export` modifier makes the resulting local Hexagon binding public:

```hexagon
extern from "client-library"
  export default fun createClient(config: Config): Client
```

This does **not** create a Hexagon or emitted-JS default export. Directionally:

```text
incoming JS default export
        -> local Hexagon binding createClient
        -> named Hexagon export createClient
```

Representative emission may alias the foreign import internally:

```js
import createClient$foreign from "client-library";
export const createClient = createClient$foreign;
```

The same linkage modifier applies to values:

```hexagon
extern from "settings"
  default let settings: Settings
```

and to classes (`export default class ...`), specified in Part 5.

`export` keeps its sole Hexagon meaning throughout: expose the declaration's local binding. `default` keeps its extern-only meaning: select the unnamed JavaScript export. The contextual `export default fun` reading is preferred over the unfamiliar `default export` order.

---

## 7. Visibility and export

Extern bindings are **private unless individually prefixed with `export`** — the ordinary Hexagon default, applied per declaration inside the block. An exported extern binding is re-exported from the compiled Hexagon facade and appears in its `.d.ts`; a private one exists only inside the binding module. Representative emission for `export fun parse`:

```js
import { parse } from "tiny-json";
export { parse };
```

(Or via an internal alias, as in §6; the emitter chooses.) The intended shape for a curated binding is the familiar one from Modules §6: a binding module declares the externs, keeps the raw or awkward ones private, exports the good surface, and consumers `import * as TinyJson from "./tiny-json"` — the extern block never forces its consumers to know it is an extern block.

Exported extern bindings are ordinary Hexagon exports thereafter: importable, aliasable, namespace-qualifiable. The `.d.ts` details of the re-exported face are Part 7's.

---

## 8. `extern import` and module effects

### 8.1 The effect-only form

```hexagon
extern import "telemetry/register"
```

This introduces **no bindings** and executes the foreign module's top-level effects. It is the extern counterpart of Modules §3.4's `import "./telemetry"` and remains visibly distinct from it: `import "..."` pulls a Hexagon module into the graph (chiefly for its instances); `extern import "..."` evaluates a foreign JavaScript module for its side effects. The reader can always tell which world a specifier lives in by the keyword in front of it.

Representative emission is the identity:

```js
import "telemetry/register";
```

### 8.2 Foreign evaluation semantics

Emitted code is readable ESM, so foreign module evaluation follows JavaScript's ordinary module semantics: a foreign module is evaluated once, on first load, regardless of how many extern blocks or Hexagon modules import from it. Hexagon adds no scheduling of its own and makes no promise about foreign evaluation order beyond what the emitted ESM import graph implies.

`extern import` is the form whose **purpose** is effects and whose evaluation edge is therefore retained. An `extern from` block does not separately guarantee evaluation when none of its bindings survive whole-program compilation (§2.3, §12.1); a program that requires a foreign module's top-level effects states so with `extern import`.

---

## 9. Fixed arity and honest nullish slots

Optional/default parameters are not introduced by FFI. **V1 extern callables have fixed visible arity.** An API's explicit nullish slot is modeled honestly:

```hexagon
extern from "library"
  fun lookupRaw(
    key: String,
    fallback: Nullable(String),
  ): String
```

Callers use `Nullable.undefined` for the ordinary omitted/default JS case and `Nullable.null` when the API specifically distinguishes explicit null (Part 2). Rest parameters, overload declarations, and general optional-argument syntax remain outside this part (§11). Arity at the call boundary — exact-arity calls, extra-argument behavior for JS callers — is Part 6's.

---

## 10. What this part does not license

- **Receiver members and classes.** `method`, `get`, `set`, `class`, `new as create`, static members, and their diagnostics are Part 5's. This part fixes only that those keywords are extern-block vocabulary (§2.2).
- **Foreign enums.** `extern enum` is already normative in `ffi-foreign-enums.md` and is neither restated nor modified here.
- **Signature semantics beyond the declaration.** What each declared type means at the boundary is Part 1's table; `Nullable`/`Array` surfaces are Part 2's; `Seq` adaptation is Part 3's; callbacks and calling convention are Part 6's. An extern declaration is the syntax that puts those semantics behind a name.

---

## 11. Deferred surfaces (recorded, not designed)

Excluded from v1 and reserved; the directional preference is to defer each **until a concrete foundational library requires it**, which is the revisit bar:

1. **Globals** — binding ambient JavaScript globals not reachable through a module specifier.
2. **CommonJS-specific binding forms** — anything beyond what the emitted ESM `import` interop already provides.
3. **Overload declarations** — one foreign name, several signatures.
4. **Rest/variadic externs** — deferred together with general rest parameters.
5. **Arbitrary-string export names** (`export { x as "..." }`) — not representable by the v1 alias syntax (§3.2).
6. **Opaque callable objects** — callable-and-property-bearing foreign values, noted in §4.2.
7. **Generic extern declarations** — parameterized opaque foreign types, polymorphic extern functions, and parameterized extern classes. V1 extern declarations are monomorphic; revisit the family together on concrete library demand (§12.4).

---

## 12. Review resolutions

The draft recorded these four questions rather than inventing rules. James/Sol review accepted the recommendations below; they are normative resolutions, not remaining blockers.

### 12.1 Unused extern blocks and module effects

**Resolved: yes.** `hexc` is whole-program and entry-point driven. If every binding of an `extern from` block is dead, the emitted binding import may be elided even though this changes whether that foreign module's top-level effects run. An `extern from` block promises its bindings, not retained evaluation; programs requiring foreign effects write `extern import`, which §8 guarantees. Effect-dependence has exactly one explicit spelling.

### 12.2 Foreign reassignment of an `extern let` export

**Resolved: `extern let` is a stability assertion.** Reassignment by the foreign module violates the declaration and produces unspecified affected observations under Part 1 §3.1. Specified live-binding reads were rejected because they would make an immutable Hexagon `let` observably time-varying.

### 12.3 The `.d.ts` declaration form for exported extern types

**Resolved: emit a generated opaque brand uniformly.** An exported extern `type` appears in the facade's `.d.ts` as a Hexagon-generated opaque branded declaration, never by re-exporting the foreign package's own type. The extern declaration establishes a nominal Hexagon contract independently of whether foreign typings exist or what structure they expose. Part 7 owns the exact emitted form.

### 12.4 Type-parameterized extern declarations

**Resolved: defer the whole family from v1.** Extern declarations are monomorphic: no parameterized opaque foreign type (`type Container(a)`), polymorphic extern `fun`, or parameterized extern class. These forms pose one representation and declaration-surface question and must be designed together if a concrete foundational library clears the revisit bar.

---

## 13. Diagnostics checklist

Hard errors introduced or relied on by this part, each with its named rewrite per the Rewrite Rule:

| Situation | Diagnostic (rewrite named) | Owner |
|---|---|---|
| extern callable declared with `let` (parameter list present) | "extern callable declarations use `fun`; write `fun parse(text: String): JsonValue`" | §4.2 |
| extern `let` annotated with a function type | "extern callable declarations use `fun`; a binding of type `Int -> Int` is callable — write `fun f(x: Int): Int`" | §4.1; Part 6 §2.4 |
| extern `fun` without a parameter list | "extern `fun` declares a callable and requires a parameter list; for a foreign value, write `let version: String`" | §4.2 |
| unaliased foreign name violating Hexagon start-class rules | "bind it with an alias: `let VERSION as version: String`" | §3.2 |
| `as` alias on a `default` declaration | "a `default` binding has no foreign export name; name the binding directly" | §6 |
| extern declaration with a body | syntax error — extern declarations are bodyless typed assertions | §1 |
| missing type annotation on an extern declaration | hard error — nothing to infer from; annotate fully | §1 |
| extern specifier resolving to a Hexagon module | "use `import` for Hexagon modules; `extern from` is for foreign JavaScript" | §2.1 |
| extern binding colliding with a local binding or import | ordinary Modules §5 collision errors, unchanged | §3.2 |
| nested adapter-requiring type in an extern signature | Part 1 §5.3's hard error, applied at declaration site | §1 |
| type parameters on an extern `type`, `fun`, or class | hard error — generic extern declarations are deferred from v1 | §11, §12.4 |

---

## 14. Decisions log (quick reference)

| Decision | Where |
|---|---|
| `extern from "specifier"` block: JS `from` vocabulary, TS-like bodyless typed declarations, ordinary Hexagon layout; introduces ordinary module-level bindings | §1, §2 |
| Extern declarations are bodyless and fully annotated; declaration-site validation (incl. Part 1 §5.3), no call-site validation; extern imports are acyclicity leaf edges | §1 |
| Bare package specifiers legal (outside Hexagon-to-Hexagon resolution); a specifier must not name a Hexagon module | §2.1 |
| Block is the only v1 form; multiple blocks per specifier fine; emission may coalesce imports | §2.2, §2.3 |
| Foreign-name-first `as` (JS import order); right-hand/unaliased name is the local binding; local names obey ordinary case and collision rules; case-illegal foreign names require an alias | §3 |
| Strict `fun` = callable / `let` = value distinction; contextual vocabulary; both misuses are hard errors with named rewrites | §4.1, §4.2 |
| First-class extern `fun`: raw imported function identity for representation-direct signatures; one stable module-level wrapper when supported boundary plumbing is required; fresh per-value adapters remain per crossing | §4.3 |
| `extern let` asserts a stable value; foreign reassignment = contract violation with unspecified affected observations | §4.4, §12.2 |
| `type` declares a nominal opaque foreign type: no structure, constructor, or instances; representation-direct by identity; distinct declarations are distinct types; exported `.d.ts` face is a generated opaque brand | §5, §12.3 |
| `default fun`/`default let` binds the JS default export; private by default; `export default fun` exports a **named** Hexagon binding — never a Hexagon/emitted default export; no `as` on `default` | §6 |
| Per-declaration `export` inside the block; exported extern bindings re-exported from the facade and present in its `.d.ts` | §7 |
| `extern import "specifier"`: effect-only, no bindings; visibly distinct from Hexagon `import "./x"`; foreign evaluation follows ordinary ESM semantics | §8 |
| Fixed visible arity; explicit nullish slots modeled with `Nullable(...)` + `Nullable.undefined`/`Nullable.null`; no optional/default/rest/overloads in v1 | §9, §11 |
| Globals, CommonJS forms, overloads, rest/variadic, string export names, opaque callables deferred with a concrete-library revisit bar | §11 |
| Generic extern declarations are monomorphic in v1; parameterized types/functions/classes deferred as one family | §11, §12.4 |
