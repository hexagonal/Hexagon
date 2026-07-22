# Hexagon Spec: Primitive Types

**Status:** Decided (July 2026)
**Scope:** The seven primitive types: `Nat`, `Int`, `Float`, `Bool`, `String`, `BigInt`, `Unit`. Their JS representations, literal syntax, string interpolation, and the `Show` connection.
**Not in scope:** `Char` (does not exist), `Rat` (stdlib module with a focused v1 spec owed), tuples/records/unions/functions (own specs), the constraint system itself (own spec — this doc only *names* which standard constraints each type supports), 1-based indexing in general (forthcoming spec), equality semantics in depth (constraint spec).
**Companion:** the Numeric Literals spec (Nat-payload polymorphic integer literals, `fromNat`/`fromInt`, Int defaulting) — cross-referenced, not restated here.

This document is written for a future implementation session and assumes the existing `hexc` architecture: Algorithm J, level-based generalisation, constraints compiled to dictionary passing, `honor` declarations, lexer with UTF-16 column tracking, layout pass, emission of idiomatic readable JS + `.d.ts`.

---

## 1. The type table

| Type | JS Type | Literal example | Description |
| :--- | :--- | :--- | :--- |
| `Nat` | `number` | `42` | Non-negative whole numbers up to 2⁵³−1. |
| `Int` | `number` | `42` | Whole numbers within ±(2⁵³−1). f64-integer-invariant. |
| `Float` | `number` | `0.5`, `1e9` | IEEE 754 double-precision floating point. |
| `Bool` | `boolean` | `true` | Boolean values. |
| `String` | `string` | `"Hello ${name}."` | Text. Interpolating by default. |
| `BigInt` | `bigint` | `9_007_199_254_740_993n` | Whole numbers of arbitrary size. |
| `Unit` | `undefined` | `()` | The one-value type. |

**Correction to older documentation:** earlier drafts listed `Int → bigint`. This is wrong and was explicitly reversed. `Int` compiles to JS `number`.

### Nat: the non-negative refinement

`Nat` is an unboxed fundamental type represented by a JavaScript `number`. Its values
are integral and lie in `0 ... 2^53 - 1`; there is no runtime tag or wrapper. Nat is
deliberately not the default for bare literals: `let count = 3` remains `Int`, while
`let count: Nat = 3` pins the same bare literal to Nat.

Nat honors `Num`, `Eq`, `Ord`, `Show`, `Hash`, `Pow`, and `Integral`, but not `Signed`
or `Frac`. Generic addition and multiplication therefore accept Nat; subtraction and
negation do not. `Nat.fromInt : Int -> Option(Nat)` is the checked boundary conversion,
while an established Nat can widen exactly through `Num.fromNat` when another numeric
type is independently established. Nat is intended for values whose non-negativity is
the invariant—terminal counts, retry limits, page sizes, and checked parse boundaries—
not as a replacement for ordinary signed arithmetic.

### Naming conventions

Type names are uppercase-start identifiers: `Int`, `String`, `Rat`, or culturally
prefixed forms such as `T用户`. Type variables are non-uppercase-start identifiers;
the ML-family `a`, `b`, `c` spellings remain the ordinary convention, while `用户`
is equally legal. The literal first-codepoint class is how parsing distinguishes a
type name from a type variable and enables implicit generalisation without `forall`
(Lexer §3).

---

## 2. Int

**Semantics:** integers representable exactly in an f64, i.e. `|n| ≤ 2^53 − 1`. This is the *f64-integer-invariant* design: the JS representation is `number`, and the compiler + stdlib maintain the invariant that an `Int`-typed value always holds an integral f64 within safe range. There is no runtime wrapper and no runtime tag — an `Int` in emitted JS is indistinguishable from a hand-written JS integer.

**Why not BigInt** (decided, do not re-litigate without new information): ambient BigInt taxes every index and loop counter (~10× on small values in V8, no small-int fast path), `JSON.stringify` throws on bigint, `Math.*` rejects it, mixed `number`/`bigint` arithmetic throws, Immutable.js uses number indexes internally (coercion on every List op), and the emitted `.d.ts` would force `bigint` on every JS consumer. Precedents: Dart 2 retreated from arbitrary-precision int to fixed-width largely because of the web target; PureScript/Elm/ReScript/Gleam all chose `number`. Users who need arbitrary precision opt in via `BigInt` (§6).

**Literals:** decimal digits, optional `_` separators (§8), no decimal point, no exponent, no `n` suffix. Per the Numeric Literals spec: a bare integer literal is *polymorphic* — it elaborates to `fromNat(k) : α` with constraint `Num α`, defaulting to `Int` at generalisation. The lexer range-checks the payload against 2^53 − 1 and errors with an "add `n`" fixit beyond that. **This doc does not restate that machinery; the Numeric Literals spec is authoritative for elaboration, defaulting, and codegen erasure.**

**Division:** `Int` honors `Num` and `Signed` (add/multiply plus subtract/negate/fromInt) but **not** `Frac` — there is no generic `divide` at Int (decided when `divide` was evicted from `Signed`). Integer division/modulo are the monomorphic `Int.div` / `Int.mod` with deliberately chosen (floored) semantics — see the Signed/Frac constraint notes.

**Standard constraints:** `Num`, `Signed`, `Eq`, `Ord`, `Show`.

### 2.1 Overflow policy (decided)

**v1 default: silent, contract documented.** `Int` arithmetic is exact within ±(2^53 − 1). Outside that range, results are whatever f64 arithmetic produces (silent rounding). Default operators compile to plain JS operators — `x + y` emits `x + y`, no wrapper, no check. This is the Elm/Gleam position, chosen with eyes open: it is the least safe option on the menu, taken because (a) it is the only policy compatible with the readable-JS goal at the most common expressions in the language, and (b) the safe range is ~9·10^15 — four orders of magnitude above where ordinary application values (indexes, counters, money-in-cents, millisecond timestamps) live.

**Checked stdlib variants** for call sites near the edge: `Int.checkedAdd`, `Int.checkedSub`, `Int.checkedMul : Int -> Int -> Option(Int)` (naming per the standard partiality story). Implementation: `Number.isSafeInteger` on the result — **except `checkedMul`, which must pre-check operand magnitudes**, because an oversized product rounds *before* a post-hoc check can see it (same trap as the fixed-width Rat discussion). Multiplication is also the op that overflows in practice (two ~10^8 operands suffice).

**Reserved for later:** a compiler flag (working name `--checked-int`) routing all Int operators through the checked helpers — the Rust debug/release split — arriving if/when `hexc` grows build profiles. Not v1, but **implementers: write codegen with a pluggable arithmetic-emission point** rather than hardcoding `+`, so the flag is a configuration change, not a rewrite.

**Rejected: int32 via `(a + b) | 0` / `Math.imul` (the PureScript/ReScript design).** Considered seriously and declined. Mechanics for the record: JS bitwise ops apply ToInt32 (truncate, then wrap two's-complement into [−2^31, 2^31)), so `| 0` coerces a result into int32 with C-style wraparound; multiplication needs `Math.imul` because int32 products can exceed 2^53 and round before `| 0` could wrap them; engines optimize the pattern heavily (it is asm.js's foundation). Genuine gains: lawful modular semantics for `Signed Int`, determinism, honest bitwise ops. Rejected because: `| 0`/`Math.imul` on every arithmetic op is codegen noise on the hottest expressions (the same disease as `0n` loop counters that killed BigInt-as-Int); and ±2^31 excludes commonplace values — millisecond timestamps (~1.7·10^12), files over 2GB, cents past $21M — that ±2^53 comfortably holds, while int32's failure mode (silent wrap to a normal-looking, often negative number) is just as silent as f64's, only four million times sooner. Deterministic wraparound mainly benefits ported native-int code (ReScript inherits OCaml's semantics; PureScript prizes the algebraic law); Hexagon has neither motivation. Gleam's JS backend faced this same choice and also went plain-number.

**Bitwise operators, forward note:** if Hexagon ever adds `<<`, `&`, `|`, etc., they must be specced as operating on the int32 projection (which is what JS provides anyway) or gated behind an explicit `Int32` type — never presented as acting on 53-bit values. v2+ concern; recorded here so it isn't invented ad hoc.

---

## 3. Float

**Semantics:** IEEE 754 binary64, i.e. exactly a JS `number`, warts included.

**Value space includes `NaN`, `Infinity`, `-Infinity`, `-0`.** There is **no literal syntax** for the special values; the stdlib provides named constants `Float.nan`, `Float.infinity` (and negation covers the rest). Comparison/equality semantics around `NaN` and `-0` are specified in the constraint (Eq/Ord) spec, not here.

**Literals:** monomorphic, always `Float` — a literal is a Float literal iff it contains a `.` or an exponent (`1.5`, `0.0`, `1e9`, `2.5e-3`). `_` separators allowed per §8. Decimal literals do **not** participate in the polymorphic literal scheme in v1 (deferred; the blocker is that `Rat`'s exact-binary `fromFloat` is not what a user writing `0.1` means — see Numeric Literals spec §7).

**Standard constraints:** `Num`, `Signed`, `Frac` (generic `divide`, lawful up to rounding), `Eq`, `Ord`, `Show`.

**Show wart, pre-registered as a decision:** `Float.show` is JS number formatting (§7 rule), so `show (0.1 + 0.2)` is `"0.30000000000000004"` and `show 1e21` is `"1e+21"`. This is the honest display of the value and matches JS-developer expectations. Accepted for v1.

---

## 4. Bool

JS `boolean`. Literals `true`, `false` (these are keywords/literals in the lexer, not library names). Emits as-is.

**Standard constraints:** `Eq`, `Ord` (`false < true`), `Show` (`"true"` / `"false"` — note: JS `String(true)` form, lowercase; if a capitalised `True`/`False` display is ever wanted, that's a Show-instance decision, not a type decision — current decision is the JS form per the §7 "toString unless stupid" rule).

Not `Signed`. No truthiness: Hexagon conditions require `Bool`; there is no implicit coercion from any other type.

---

## 5. String

**Representation:** JS `string` (UTF-16 internally, as JS mandates).

### 5.1 Indexing and length: codepoint-based, 1-based

`String.length` and all index-taking/index-returning String functions operate on **Unicode codepoints**, not UTF-16 code units. `length "𝕏y"` is 2, not 3. This is a deliberate correctness-over-speed choice: codepoint operations on a UTF-16 string are **O(n)** (implementers: iterate with the string iterator / `for..of` semantics, never `.charCodeAt` arithmetic; `.length` on the JS side is a code-unit count and must not leak through the String API).

- A later version *may* move the default to grapheme clusters (`Intl.Segmenter`); **both** codepoint and grapheme families will exist in the stdlib regardless — the open question is only which one owns the short names.
- All indexing in Hexagon is **1-based**. A forthcoming spec covers 1-based indexing globally; String conforms to it. Implementers: do not ship any 0-based index in the public String API.
- Note the deliberate contrast with the LSP layer, which uses UTF-16 code units and 0-based positions *at the protocol boundary* (per the LSP decisions). These are different domains: LSP columns are a wire-format concession; the *language's* String semantics are codepoints, 1-based. Conversion happens at the LSP boundary, nowhere else.

### 5.2 Literals: one form, interpolating, multi-line

There is exactly **one** string literal form: double-quoted `"..."`. It fully supplants JS's plain-string/template-string split — Hexagon's `"..."` has template-string powers:

- **Interpolation:** `${expr}` splices a value (§5.3).
- **Multi-line:** literal newlines are allowed inside `"..."` and are preserved.
- **No backtick syntax.** Backtick is unused by strings (free for other purposes or nothing).
- **No tagged templates in v1.** Decided; metaprogramming feature, out of scope.

**Escapes:** the JS-compatible set — `\n`, `\t`, `\r`, `\\`, `\"`, `\u{...}` (codepoint escape), plus two Hexagon-specific ones:

- `\$` — a literal dollar sign. Needed only before `{`, but legal anywhere. This defuses interpolation: `"cost: \${x}"` contains the five characters `${x}` literally. (Chosen over `\{`: escaping the *first* character of the two-character trigger matches JS's own `` \${ `` convention and JS muscle memory.)
- `\#` — a literal hash. See §5.4.

A `$` **not** followed by `{` is an ordinary character, no escape needed.

**Lexer shape:** a string literal tokenises into alternating text-chunks and interpolation holes; each hole contains a full expression re-entering the normal lexer/parser (nesting: an interpolated expression may itself contain a string literal with its own holes — the lexer needs a mode stack, standard template-literal lexing). Layout pass: interpolation holes do not participate in the indentation-layout algorithm (they're expression-level, inside a token as far as layout is concerned).

### 5.3 Interpolation elaborates via Show

`"a ${e1} b ${e2}"` elaborates to string concatenation of the text chunks with `show(e1)`, `show(e2)` — where `show : Show a => a -> String` is the display method of the `Show` constraint. Consequences the implementer must preserve:

- The constraint **propagates normally**: `fun greet name = "Hello ${name}!"` infers `greet : Show a => a -> String`, dictionary-passed like any constraint. No special machinery beyond what `fromNat` established in the Numeric Literals spec.
- Interpolating a type with **no Show instance is a compile error**. This is the feature: functions and opaque extern types don't accidentally become `"[object Object]"` or spliced source code. (An extern type may opt in with an explicit `honor Show<T>`.)
- When the interpolated type is concrete and its `show` is representational identity or `String(x)` (§7), codegen may — and should — emit a plain JS template literal `` `a ${e1} b ${e2}` `` for readability. When `show` is a real call, emit it: `` `a ${Rat_show(e1)} b` ``. Polymorphic case: `dict.show(e1)`.
- `String.show` is the identity, so interpolating a String splices it bare (no added quotes) — display semantics, not Haskell-`show` semantics. See §7.

### 5.4 `#{` is reserved

v2 may introduce a `Debug` constraint (`Debug.debug`, programmer-facing form: quoted strings, structural detail — the Rust `Display`/`Debug` split, Roc's `Inspect`) with **`#{expr}`** as its interpolation syntax. To make that non-breaking:

> **v1 lexer rule:** a bare `#{` inside a string literal is a **lex error**: "`#{` is reserved for future use; write `\#{` for a literal `#{`." A `#` not followed by `{` is an ordinary character.

Cheap now, prevents a silent meaning change later. Implementers: this is a hard error, not a warning.

**Standard constraints for String:** `Eq`, `Ord`, `Show` (identity).

**`Ord String` is codepoint-wise lexicographic, permanently** — even if grapheme-based indexing later becomes the default (§5.1). Rationale: grapheme order genuinely disagrees with codepoint order (e.g. `"a\u0301"` vs `"a\uFFFF"` sort oppositely under the two schemes), so switching Ord across versions would silently reorder users' sorted collections; and grapheme segmentation (UAX #29 / `Intl.Segmenter`) is revised with each Unicode version, so an ordering built on it changes under a browser update, which an `Ord` instance must never do. Codepoint order is eternal, and coincides with UTF-8 byte order. Grapheme mode, if it comes, changes what "position" and "length" mean — not what "less than" means.

Implementers: codepoint order is *not* JS `<` on strings, which compares UTF-16 code units — they disagree when an astral character (≥ U+10000, lead surrogates 0xD800–) meets a BMP character in U+E000–U+FFFF (codepoint-wise `"\u{10000}" > "\uFFFF"`; JS says the opposite). `String.compare` needs a codepoint-aware walk, with a fast path: use JS `<` directly when both strings are all-BMP (the overwhelmingly common case), fall back to iteration otherwise.

Human-facing sorting ("é" before "f", locale digraph rules) is **collation**, is locale-dependent, and therefore must never be `Ord` — it is a future stdlib function (`String.collate`, via `Intl.Collator`), clearly fenced off from the constraint.

---

## 6. BigInt

**Semantics:** arbitrary-precision integers. JS `bigint`, natively — no hand-rolled bignum library (decided: the engine's implementation is strictly better than anything we'd write, and the gap is only ergonomics around it, not the type).

**Literals:** decimal digits + `n` suffix: `42n`, `9_007_199_254_740_993n`. **Monomorphic, always `BigInt`** — the `n` suffix *is* the type annotation, exactly as in JS, and BigInt literals do **not** participate in the polymorphic `Num`-literal scheme (decided, with reasons recorded in Numeric Literals spec §7: a polymorphic `1n` would hollow out the suffix and force a lossy or partial `fromBigInt` into `Num`). Payload is arbitrary precision; the lexer/AST must store it losslessly (string or JS bigint), never through an f64.

**Style:** use `n` when no surrounding context pins the type (`let y = 1n`) and whenever the payload exceeds the bare-literal range. In an already BigInt-typed position, bare digits are preferred: `Rat.create(1, 3)` emits `Rat.create(1n, 3n)`.

**Conversions:** Numeric Literals §5.1 applies from established `Nat` and `Int` expressions into `BigInt`, through `Num.fromNat` and `Signed.fromInt` respectively; emission is `BigInt(value)` and is exact. There is no conversion in the other direction and no implicit conversion between `BigInt` and `Float`. Explicit stdlib conversions remain `BigInt.fromInt` (total), `BigInt.toInt` (partial, per the standard partiality story), and `BigInt.toFloat` (total, lossy, documented).

**Division:** honors `Signed` but **not** `Frac` — BigInt division is truncating-toward-zero in JS, unlawful for generic `divide`. Monomorphic `BigInt.div` / `BigInt.mod` with the **same** floored convention as `Int.div`/`Int.mod`, uniformly wrapped in codegen.

**FFI:** appears as `bigint` in emitted `.d.ts`. Known landmine, documented once in FFI docs: `JSON.stringify` throws on bigint — but only records that explicitly contain BigInt fields carry it, which is the point of keeping BigInt out of `Int`.

**Standard constraints:** `Num`, `Signed`, `Eq`, `Ord`, `Show` (note `show 1n` is `"1"` — **no** `n` suffix; this is JS `String(1n)` behaviour and is display-correct).

---

## 7. Show: the display constraint (as it touches these types)

The constraint system has its own spec; this section records only the decisions that bind the primitive types and string interpolation.

**Contract:** `show : a -> String` produces the *human-readable display form* (Rust `Display`, not Haskell `show`): `show "abc"` is `abc` — no quotes; `show 42` is `"42"`; `show 1n` is `"1"`.

**Implementation rule ("toString unless JS is stupid"):** for each instance, `show` is JS `toString`/`String(x)` **when that output is sane**, and a Hexagon-provided implementation when JS's is stupid. Concretely:

| Type | `show` compiles to | Notes |
|---|---|---|
| `Nat` | `String(x)` | sane |
| `Int` | `String(x)` | sane |
| `Float` | `String(x)` | sane-ish; wart pre-registered in §3 |
| `BigInt` | `String(x)` | sane; drops `n`, correct for display |
| `Bool` | `String(x)` | `"true"`/`"false"` |
| `String` | identity | |
| `Unit` | constant `"()"` | JS would give `"undefined"` — stupid; replaced |

"JS is stupid" cases that get replacements rather than toString: plain objects (`[object Object]`) → derived structural show for records; arrays (bracket-less comma join) → structural show for List/tuples; functions (source dump) → **no Show instance at all**. Derived structural show for records/unions/tuples is specified with the constraint system, not here.

**Not universal, by design:** functions and opaque extern types have no Show instance; `${aFunction}` is a compile error. Universality would make the constraint vacuous — the types that *lack* Show are the feature.

**v2, noted not specified:** a separate `Debug` constraint (`Debug.debug`) for programmer-facing form (quoted strings at top level, etc.), interpolated with `#{}` (§5.4). Do not build it in v1; do keep the `#{` reservation.

---

## 8. Numeric `_` separators

Underscore separators are allowed in all numeric literals (Nat/Int-payload bare literals, `Float`, `BigInt`) under **the JS rule** (decided — not Python's, which differs in exactly one corner: Python allows `0x_FF`, JS doesn't; since we emit literals into JS source, JS's rule is the only safe one, and it's Python-minus-that-corner):

- `_` must have a digit on **both** sides.
- Therefore: no leading (`_1`) or trailing (`1_`) underscore; no doubling (`1__0`); none adjacent to `.` (`1_.5`, `1._5`), to the exponent marker (`1_e5`, `1e_5`), or to the `n` suffix (`1_n`).
- Separators are for readability only: erased from the numeric value; grouping is unenforced (`1_00_00` is legal).
- Emission: literals may be emitted with or without their separators (both are valid JS); preserving them where the source had them is nicer for readable-JS but not required.

**Bases:** v1 literals are **decimal only**. Hex/binary/octal (`0xFF`, `0b1010`, `0o777`) are deferred; when added, the JS underscore rule extends to them unchanged (which sidesteps the `0x_FF` divergence permanently).

The BigInt example in §1's table, `9_007_199_254_740_993n`, exercises both features at once but they are independent: `_` is general modern-integer-literal syntax, not BigInt-specific. (That value, 2^53 + 1, is also the smallest positive integer a bare literal *cannot* express — the lexer range check from the Numeric Literals spec rejects it without the `n`.)

---

## 9. Unit

**Semantics:** the type with exactly one value. **Literal:** `()`. **JS representation:** `undefined`.

Rationale for `undefined`: a Hexagon function returning `Unit` is a JS function that returns nothing — the best possible interop story, zero ceremony in emitted code and in `.d.ts` (`void` in return position, `undefined` elsewhere).

**Role:** Unit exists chiefly for the Standard-ML-flavoured function design, where every function takes exactly one thing — a single value, a tuple, or the empty tuple `()`. That design (call syntax, tuple types, how `()` -taking functions emit) is the functions/tuples spec's job; this doc only fixes the type's existence, literal, and representation.

**Standard constraints:** `Eq` (trivially — one value), `Ord` (trivially), `Show` (`"()"`, a replaced-because-JS-is-stupid case, §7). Neither `Num` nor `Signed`.

**Implementer cautions:**
- `()` must lex/parse unambiguously against parenthesised expressions and (future) tuple syntax — `()` is the nullary case of the tuple family; coordinate with the functions/tuples spec rather than special-casing.
- `Unit`'s JS value being `undefined` must not be confused with the FFI's `Nullable(a)` boundary type (which handles JS `null`/`undefined` at extern boundaries). `Unit` is a real Hexagon type with one value; `Nullable` is a boundary-only foreign shape. They meet at the FFI but are unrelated concepts.

---

## 10. Decisions log (quick reference, with authority)

| Decision | Where decided |
|---|---|
| `Nat` = non-negative safe integer, unboxed JS `number`; honors `Num`, not `Signed`; not the default | this doc §1; Numeric Literals spec |
| `Int` = f64-integer-invariant `number`, not bigint | this doc §2; Numeric Literals spec |
| Bare int literals use a `Nat` payload and are polymorphic via `Num.fromNat`, default `Int` | Numeric Literals spec (authoritative) |
| `1n` monomorphic BigInt; suffix = annotation | Numeric Literals spec §7; this doc §6 |
| Decimal literals monomorphic Float in v1 | Numeric Literals spec; this doc §3 |
| One string form `"..."`: interpolating, multi-line, no backticks, no tags | this doc §5.2 |
| `${e}` → `show(e)`; Show is display-semantics; not universal | this doc §5.3, §7 |
| Escapes `\$` and `\#`; bare `#{` is a v1 lex error (reserved for v2 Debug) | this doc §5.2, §5.4 |
| String length/indexing: codepoints, 1-based, O(n) accepted; graphemes maybe-later | this doc §5.1 |
| `_` separators: JS rule, all numeric literals; decimal-only bases in v1 | this doc §8 |
| `Unit` = `()` = JS `undefined` | this doc §9 |
| `Float.nan` / `Float.infinity` constants; no special-value literals | this doc §3 |
| Int overflow: silent past ±2^53, plain-JS operators; checked stdlib variants; `--checked-int` reserved; int32/`\|0` rejected | this doc §2.1 |
| `Ord String` = codepoint lexicographic, permanent regardless of grapheme indexing; collation is stdlib, never Ord | this doc §5 |
| Types uppercase-start; type variables non-uppercase-start (`a b c` by convention) | this doc §1; Lexer §3 |
