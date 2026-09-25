# Hexagon Spec: Primitive Types

**Status:** Decided (July 2026)
**Scope:** The five primitive types: `Nat`, `Int`, `Float`, `String`, `BigInt`. Their JS representations, literal syntax, string interpolation, and the `Show` connection. *(Originally seven: `Bool` was reclassified as a prelude union 2026-07-29, #147 — §4 is now a pointer, §12 the correction record; `Unit` was reclassified as the empty tuple 2026-07-30, #159 — §9 is now a pointer, §13 the correction record.)*
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
| `Bool` | `boolean` | `True` | *Reclassified:* prelude union with a pinned representation (§4, #147). Row retained for the representation fact. |
| `String` | `string` | `"Hello ${name}."` | Text. Interpolating by default. |
| `BigInt` | `bigint` | `9_007_199_254_740_993n` | Whole numbers of arbitrary size. |
| `Unit` | `undefined` | `()` | *Reclassified:* the empty tuple (§9, #159). Row retained for the representation fact. |

`Dec` (`dec.md`) is also a fundamental
prelude type, introduced in the book’s Primitive Types chapter. It is an opaque
nominal record, not a compiler or JavaScript primitive, so it does not extend
the compiler-primitive inventory here. Its `d` literals and exact display are
owned by that focused specification.

**Correction to older documentation:** earlier drafts listed `Int → bigint`. This is wrong and was explicitly reversed. `Int` compiles to JS `number`.

### Nat: the non-negative refinement

`Nat` is an unboxed fundamental type represented by a JavaScript `number`. Its values
are integral and lie in `0 ... 2^53 - 1`; there is no runtime tag or wrapper. Nat is
deliberately not the default for bare literals: `let count = 3` remains `Int`, while
`let count: Nat = 3` pins the same bare literal to Nat.

Nat honors `Num`, `Eq`, `Ord`, `Show`, `Hash`, `Pow`, `Integral`, and `Real`, but not `Signed`,
`Frac`, or `Bitwise`. Generic addition and multiplication therefore accept Nat; subtraction,
negation, and the bitwise operations do not, and run on Nat values under a written `Int`
face (Numeric Literals §5.1; `bitwise.md` §5.1). `Nat.fromInt : Int -> Option(Nat)` is the checked boundary conversion
*(#344: built — an ordinary export of `stdlib/Nat.hex`, a sign check in Hexagon over its
unexported unchecked core. One consequence rode in with it: `fromInt` gained a second
exporter beside `Signed.hex`'s member, so the bare spelling is refused per Modules §5.5
in favor of the qualified homes — `Signed.fromInt` for the polymorphic member,
`Nat.fromInt` for this conversion. The corpus had zero bare uses; the same accepted
trade `Concat`'s member and `Seq.concat` made when their spellings met)*,
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

**Literals:** decimal digits, or hexadecimal (`0xFF`), octal (`0o777`), or binary (`0b1010`) digits after a lowercase prefix (Lexer §5, `bitwise.md` §8); optional `_` separators (§8), no decimal point, no exponent, no `n` or `d` suffix. Per the Numeric Literals spec: a bare integer literal is *polymorphic* — it elaborates to `fromNat(k) : α` with constraint `Num α`, defaulting to `Int` at generalisation. The lexer range-checks the payload against 2^53 − 1 and errors with an "add `n`" fixit beyond that. **This doc does not restate that machinery; the Numeric Literals spec is authoritative for elaboration, defaulting, and codegen erasure.**

**Division:** `Int` honors `Num` and `Signed` (add/multiply plus subtract/negate/fromInt) but **not** `Frac` — there is no generic `divide` at Int (decided when `divide` was evicted from `Signed`). Integer division/modulo are `Integral<Int>`'s `div`/`mod`, **Euclidean**, per the Division & Remainder spec — the owning doc; `Int.div`/`Int.mod` are those members qualified *(#344 — this sentence previously said "monomorphic" and "(floored)": it predated both the `Integral` constraint and the Euclidean ruling, and the members now live as source `honor` blocks in `stdlib/Int.hex`)*.

**Standard constraints:** `Real` (Constraints §7), `Num`, `Signed`, `Eq`, `Ord`, `Show`, `Pow` (Operators §6.3), `Hash` (Collections Part 2 §2.5), `Integral` (Integral §3), `Bitwise` (`bitwise.md`) *(corrected 2026-07-28, #137 — record in §11)*.

### 2.1 Overflow policy (decided)

**v1 default: silent, contract documented.** `Int` arithmetic is exact within ±(2^53 − 1). Outside that range, results are whatever f64 arithmetic produces (silent rounding). Default operators compile to plain JS operators — `x + y` emits `x + y`, no wrapper, no check. This is the Elm/Gleam position, chosen with eyes open: it is the least safe option on the menu, taken because (a) it is the only policy compatible with the readable-JS goal at the most common expressions in the language, and (b) the safe range is ~9·10^15 — four orders of magnitude above where ordinary application values (indexes, counters, money-in-cents, millisecond timestamps) live.

**Checked stdlib variants** for call sites near the edge: `Int.checkedAdd`, `Int.checkedSub`, `Int.checkedMul : Int -> Int -> Option(Int)` (naming per the standard partiality story). Implementation: `Number.isSafeInteger` on the result — **except `checkedMul`, which must pre-check operand magnitudes**, because an oversized product rounds *before* a post-hoc check can see it (same trap as the fixed-width Rat discussion). Multiplication is also the op that overflows in practice (two ~10^8 operands suffice).

`stdlib/Int.hex` declares `IntRangeError(message: String)` for an explicit
operation whose promised result must be an `Int` but is not representable in
the safe range. The first users are §3's five `Float` rounding exits (#919).
The exception belongs here, at the target type, and is available for a future
throwing door into `Int`; a checked conversion whose contract returns `Option`
continues to return `None` instead and does not throw it.

*(#344: built — ordinary exports of `stdlib/Int.hex`. The landed implementation pre-checks all three, not only `checkedMul` — a choice, not a necessity: a post-hoc range comparison against `limit` would also be exact for addition and subtraction in ordinary Hexagon, at the price of an out-of-range value transiting an `Int`-typed binding (sanctioned by this section's overflow contract, but a value the rest of this file never lets exist); pre-checking uniformly keeps every intermediate a true `Int`, matches the strategy `checkedMul` was already mandated, and costs nothing extra. The forms, with `limit` = 2^53 − 1, every intermediate inside the safe range: addition overflows iff `right > 0 and left > limit - right` (that difference lies in `[0, limit)`) or `right < 0 and left < negate(limit) - right` (in `(negate(limit), 0]`); subtraction is `checkedAdd(left, negate(right))`, negation being total on the symmetric range; multiplication answers `Some(0)` on a zero operand and otherwise overflows iff `abs(left) > quot(limit, abs(right))` — the integer-division form of `abs(left) * abs(right) > limit`, exact without computing the product. The observable contract is exactly as decided; only the strategy note is superseded, in the pre-check direction it already pointed.)*

**Reserved for later:** a compiler flag (working name `--checked-int`) routing all Int operators through the checked helpers — the Rust debug/release split — arriving if/when `hexc` grows build profiles. Not v1, but **implementers: write codegen with a pluggable arithmetic-emission point** rather than hardcoding `+`, so the flag is a configuration change, not a rewrite.

**Rejected: int32 via `(a + b) | 0` / `Math.imul` (the PureScript/ReScript design).** Considered seriously and declined. Mechanics for the record: JS bitwise ops apply ToInt32 (truncate, then wrap two's-complement into [−2^31, 2^31)), so `| 0` coerces a result into int32 with C-style wraparound; multiplication needs `Math.imul` because int32 products can exceed 2^53 and round before `| 0` could wrap them; engines optimize the pattern heavily (it is asm.js's foundation). Genuine gains: lawful modular semantics for `Signed Int`, determinism, honest bitwise ops. Rejected because: `| 0`/`Math.imul` on every arithmetic op is codegen noise on the hottest expressions (the same disease as `0n` loop counters that killed BigInt-as-Int); and ±2^31 excludes commonplace values — millisecond timestamps (~1.7·10^12), files over 2GB, cents past $21M — that ±2^53 comfortably holds, while int32's failure mode (silent wrap to a normal-looking, often negative number) is just as silent as f64's, only four million times sooner. Deterministic wraparound mainly benefits ported native-int code (ReScript inherits OCaml's semantics; PureScript prizes the algebraic law); Hexagon has neither motivation. Gleam's JS backend faced this same choice and also went plain-number.

**Bitwise operations:** `Int` honors `Bitwise` (`bitwise.md`). `band`, `bor`, `bxor`, `bnot`, and the named shifts compute the true integer answer on the `number` representation, the answer `BigInt` gives for the same value — never the int32 projection JavaScript's operators apply. JavaScript's 32-bit view is two named lossy conversions, `Int.toInt32` (`x | 0`) and `Int.toUint32` (`x >>> 0`) (`bitwise.md` §4.3).

---

## 3. Float

**Semantics:** IEEE 754 binary64, i.e. exactly a JS `number`, warts included.

**Value space includes `NaN`, `Infinity`, `-Infinity`, `-0`.** There is **no literal syntax** for the special values; `stdlib/Float.hex` names them instead — `Float.nan` and `Float.infinity`, with negation reaching the third (`-Float.infinity`), which is the spelling the lexer's overflow fix-it points at (Lexer §5, §10). Neither constant needs an intrinsic door: a float division is exact about these answers, so they are ordinary source.

Detection is named too, because it cannot be spelled by hand: `Float.isNan` and `Float.isFinite`. The imported idiom `x != x` is **uniformly `False`** here — `Eq<Float>` is SameValueZero, so a `NaN` equals itself (a deliberate choice, so that a float can key a hash table) — and with every partial float operation answering `NaN` rather than throwing, a caller would otherwise hold a value with no test for it. The same equality that retires the idiom implements the replacement: `Float.isNan(x)` is `x == Float.nan`. Comparison/equality semantics around `NaN` and `-0` are specified in the constraint (Eq/Ord) spec, not here.

`stdlib/Float.hex` also declares `FloatRangeError` — the range guard of the exact world's exit doors, thrown by `Rat.toFloat` (`rat.md` §6) and `BigInt.toFloat` (§6): a door's result must be finite, and nonzero when the input is nonzero. The declaration sits here, at the target type, so that any door from the exact world *can* share it; which doors carry the guard is each door's own ruling.

**Rounding into `Int`.** `Float` owns five concrete exits into the safe-integer
world; they are ordinary companion functions, not constraint members:

```hexagon
Float.floor(value: Float): Int
Float.ceil(value: Float): Int
Float.trunc(value: Float): Int
Float.round(value: Float): Int
Float.roundAway(value: Float): Int
```

`floor` returns the greatest integer no greater than `value`; `ceil` returns the
least integer no less than it; `trunc` rounds toward zero. `round` returns the
nearest integer and sends an exact halfway value to the even integer. `roundAway`
also returns the nearest integer, but sends an exact halfway value away from zero.
Thus `Float.round(2.5) == 2`, `Float.round(3.5) == 4`, and
`Float.round(-2.5) == -2`, while `Float.roundAway(2.5) == 3` and
`Float.roundAway(-2.5) == -3`. The two nearest rules differ only at an exact half:
`Float.roundAway(2.1) == 2`, because it does not always round away from zero.
Neither uses JavaScript `Math.round`'s asymmetric ties-toward-positive-infinity
convention. Float and Dec intentionally give their shortest explicit rounding
name different tie rules: `Dec.round` uses ties away and `Dec.roundEven` uses ties
to even. This is not an ambient rounding mode and does not change Float
arithmetic, conversions, or Math functions. `Float.roundEven` is removed without
an alias; existing callers must select `round` or `roundAway` by their intended
tie rule (#974).

Each operation first determines its integer-valued `Float`. If that result is
not a safe integer — exactly the host predicate `Number.isSafeInteger`, which
rejects `NaN`, both infinities, and finite results outside
`[-(2^53 - 1), 2^53 - 1]` — it throws
`IntRangeError("Float.<operation>: result does not fit in Int")`.
`IntRangeError` is declared by `stdlib/Int.hex`: the failed range belongs to the
target type, just as `FloatRangeError` belongs here and is thrown by doors in
other companions. Every successful zero result is canonical `Int` zero; the
sign bit of a floating negative zero never crosses into `Int` and cannot
reappear if that result later widens to `Float`.

These are explicit reinterpretations of the stored binary64 value, not implicit
numeric conversions and not a deferred `Int.fromFloat`: the latter would, if it
ships, accept only a `Float` already holding a safe integer and return `Option`,
where these names state how a fractional value is to be changed and throw when
the requested `Int` cannot exist. Friendly Numerics §2 tenet 7 licenses exactly
this kind of named exit from the approximate world.

**`Float.pow(value: Float, exponent: Float): Float`** is the analytic power — `exp(y·ln x)`, total, honestly IEEE with every `NaN` edge, `Float.pow(2.0, 0.5)` the nearest double to `√2`. It is the `widens` declaration over `Pow<Float>`'s member (Operators §6.3.1; Constraints §4.7; Modules §5.3's generalisation law): the operator `**` takes the member's `Int` exponent, the qualified spelling and the dot call take this door, and the member is the door's derived restriction to integer exponents, accounted for in the honor block as `pow = widened`. A fractional exponent at `**` draws the mandatory fixit pointing here.

**Literals:** monomorphic, always `Float` — an unsuffixed numeric literal is a Float literal iff it contains a `.` or an exponent (`1.5`, `0.0`, `1e9`, `2.5e-3`). `_` separators allowed per §8. Unsuffixed decimal literals do **not** participate in the polymorphic literal scheme in v1 (deferred — see Numeric Literals spec §7, #525). The deferred piece is the polymorphism, not a conversion: a `Rat` `fromFloat` exists in no spelling, ever (friendly-numerics tenet 7), so a future design must carry the written digits — `0.1` meaning `1/10` — rather than the parsed double, whose exact binary value is not what the writer meant.

**Standard constraints:** `Real` (Constraints §7), `Num`, `Signed`, `Frac` (generic `divide`, lawful up to rounding), `Eq`, `Ord`, `Show`, `Pow` (Operators §6.3), `Hash` (Collections Part 2 §2.5). Never `Integral` — permanently, so that `gcd(1.5, 2.0)` fails with the right message (Integral §3) *(corrected 2026-07-28, #137 — record in §11)*.

**Show wart, pre-registered as a decision:** `Float.show` is JS number formatting (§7 rule), so `show (0.1 + 0.2)` is `"0.30000000000000004"` and `show 1e21` is `"1e+21"`. This is the honest display of the value and matches JS-developer expectations. Accepted for v1.

---

## 4. Bool

> **Reclassified (2026-07-29, #147; correction record §12).** `Bool` is no longer a primitive. It is the prelude union
>
> ```
> union Bool derives (Eq, Ord, Show, Hash) = False | True
> ```
>
> declared alongside `Option`/`Result` (Unions §8), with its runtime representation **intrinsically pinned to JS `boolean`** — the sole exception to the union representation, an instance of Unions §6's principle (Unions §6.2). The values are the constructors `True` and `False`; the former literals `true`/`false` remain reserved words whose only role is the redirect diagnostic (Lexer §4.1). The full ruling, including the doctrine pivot that motivates it, is `decisions-ml-dialect-bool-2026-07.md`.

What this section formerly decreed, and where it went:

- **Constraints** (`Eq`, `Ord` with `False < True`, `Show`, `Hash`) are now **derived** through the standard union derivations (Unions §7) — the declaration order `False | True` reproduces the ruled ordering; no fiat rows remain.
- **Show** is the derived constructor-name form: `show True` is `"True"`. The former lowercase JS-form ruling (`String(x)`, `"true"`/`"false"`) is **superseded** — see §7's corrected table and §12.
- **Representation** (`boolean`, emits as-is, zero-cost at the FFI) survives verbatim as the §3 pin of the decisions doc; the §1 table row above records it.

Unchanged and still normative here: **not `Signed`, and no truthiness** — Hexagon conditions require `Bool`; there is no implicit coercion from any other type.

---

## 5. String

**Representation:** JS `string` (UTF-16 internally, as JS mandates). Every
JavaScript string remains representable, including one containing a lone
surrogate supplied across the boundary. Source escapes still reject surrogate
values; that lexical rule does not narrow the runtime representation.

### 5.1 Indexing and length: codepoint-based, 1-based

`String.length` and all index-taking/index-returning String functions operate on
**codepoints**, not UTF-16 code units. `length "𝕏y"` is 2, not 3. A valid
surrogate pair is one codepoint; a lone surrogate is preserved as one surrogate
codepoint, matching the JavaScript string iterator. It is not a Unicode scalar
value. This distinction lets `String.toCodepoint` reject it while exact String
operations and `String.fromSeq(String.toSeq(s))` preserve it. The full rule is
String Text Processing §1 and §9.

This is a deliberate correctness-over-speed choice: codepoint operations on a
UTF-16 string are **O(n)** (implementers: iterate with the string iterator /
`for..of` semantics, never `.charCodeAt` arithmetic; `.length` on the JS side is
a code-unit count and must not leak through the String API).

- Codepoints own ordinary indexing, iteration, and the short names permanently.
  Grapheme-cluster operations, if they ship, use explicit names (Collections
  Part 5 §5.1).
- All indexing in Hexagon is **1-based**, under Collections Part 3 §9.
  Implementers: do not ship any 0-based index in the public String API.
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

`"a ${e1} b ${e2}"` elaborates to string concatenation of the text chunks with `show(e1)`, `show(e2)` — where `show : <a: Show> a -> String` is the display method of the `Show` constraint. Consequences the implementer must preserve:

- The constraint **propagates normally**: `fun greet name = "Hello ${name}!"` infers `greet : <a: Show> a -> String`, dictionary-passed like any constraint. No special machinery beyond what `fromNat` established in the Numeric Literals spec.
- Interpolating a type with **no Show instance is a compile error**. This is the feature: functions and opaque extern types don't accidentally become `"[object Object]"` or spliced source code. (An extern type may opt in with an explicit `honor Show<T>`.)
- When the interpolated type is concrete and its `show` is representational identity or `String(x)` (§7), codegen may — and should — emit a plain JS template literal `` `a ${e1} b ${e2}` `` for readability. When `show` is a real call, emit it: `` `a ${Rat_show(e1)} b` ``. Polymorphic case: `dict.show(e1)`.
- `String.show` is the identity, so interpolating a String splices it bare (no added quotes) — display semantics, not Haskell-`show` semantics. See §7.

### 5.4 `#{` is reserved

v2 may introduce a `Debug` constraint (`Debug.debug`, programmer-facing form: quoted strings, structural detail — the Rust `Display`/`Debug` split, Roc's `Inspect`) with **`#{expr}`** as its interpolation syntax. To make that non-breaking:

> **v1 lexer rule:** a bare `#{` inside a string literal is a **lex error**: "`#{` is reserved for future use; write `\#{` for a literal `#{`." A `#` not followed by `{` is an ordinary character.

Cheap now, prevents a silent meaning change later. Implementers: this is a hard error, not a warning.

**Standard constraints for String:** `Eq`, `Ord`, `Show` (identity), `Concat` (`++` — Operators §7), `Hash` (Collections Part 2 §2.5) *(corrected 2026-07-28, #137 — record in §11)*.

**`Ord String` is codepoint-wise lexicographic, permanently.** Rationale:
grapheme order genuinely disagrees with codepoint order (e.g. `"a\u0301"` vs
`"a\uFFFF"` sort oppositely under the two schemes), so a grapheme-based order
would silently reorder users' sorted collections when segmentation data
changes. Codepoint order is stable. Grapheme operations, if they come, do not
change what “less than” means.

Implementers: codepoint order is *not* JS `<` on strings, which compares UTF-16 code units — they disagree when an astral character (≥ U+10000, lead surrogates 0xD800–) meets a BMP character in U+E000–U+FFFF (codepoint-wise `"\u{10000}" > "\uFFFF"`; JS says the opposite). `String.compare` needs a codepoint-aware walk, with a fast path: use JS `<` directly when both strings are all-BMP (the overwhelmingly common case), fall back to iteration otherwise.

Human-facing sorting ("é" before "f", locale digraph rules) is **collation**, is locale-dependent, and therefore must never be `Ord` — it is a future stdlib function (`String.collate`, via `Intl.Collator`), clearly fenced off from the constraint.

### 5.5 Text processing and Unicode data

String Text Processing is the normative owner of splitting, dropping, trimming,
literal tests, case-insensitive matching, replacement, joining, search
positions, scalar conversion, and Unicode casing/folding. Every public operation
is exported by `stdlib/String.hex`.

Unicode-sensitive behavior uses the compiler's repository-wide pinned data
version, currently Unicode 17.0.0 (Lexer §3.3). It never inherits the browser's
or Node's Unicode tables implicitly. Ordinary operations perform no Unicode
normalization.

---

## 6. BigInt

**Semantics:** arbitrary-precision integers. JS `bigint`, natively — no hand-rolled bignum library (decided: the engine's implementation is strictly better than anything we'd write, and the gap is only ergonomics around it, not the type).

**Literals:** decimal, hexadecimal, octal, or binary digits + `n` suffix: `42n`, `9_007_199_254_740_993n`, `0xFFn` (Lexer §5). **Monomorphic, always `BigInt`** — the `n` suffix *is* the type annotation, exactly as in JS, and BigInt literals do **not** participate in the polymorphic `Num`-literal scheme (decided, with reasons recorded in Numeric Literals spec §7: a polymorphic `1n` would hollow out the suffix and force a lossy or partial `fromBigInt` into `Num`). Payload is arbitrary precision; the lexer/AST must store it losslessly (string or JS bigint), never through an f64.

**Exact destination capability:** `BigInt` honors `FromBigInt` with identity
conversion. A BigInt expression may enter an independently established target
such as Rat through that target's `FromBigInt` evidence (Numeric Literals §5.1;
`integer-widening.md`). This does not make the `n` literal polymorphic or permit
implicit conversion to Float, Int, or Nat. Literal patterns still require BigInt.

**Style:** use `n` when no surrounding context pins the type (`let y = 1n`) and whenever the payload exceeds the bare-literal range. In an already BigInt-typed position, bare digits are preferred: `Rat.create(1, 3)` emits `Rat.create(1n, 3n)`.

**Conversions:** Numeric Literals §5.1 applies from established `Nat` and `Int` expressions into `BigInt`, through `Num.fromNat` and `Signed.fromInt` respectively; emission is `BigInt(value)` and is exact. There is no conversion in the other direction and no implicit conversion between `BigInt` and `Float`. Explicit stdlib conversions are provided by `stdlib/BigInt.hex` *(#344 — this sentence previously said "remain", with nothing built)*: `BigInt.fromInt : Int -> BigInt` (total — it **is** `Signed<BigInt>`'s member, reached qualified per Modules §5.3; one implementation, two spellings), `BigInt.toInt : BigInt -> Option(Int)` (partial per the standard partiality story — Unions spec, the `Option` this always meant), and `BigInt.toFloat : BigInt -> Float` — the exact world's second sanctioned exit *(#533; friendly-numerics tenet 7 — `rat.md` §6 owns the first)*. It answers the **correctly rounded nearest double** — past 2^53 that double need not be the integer asked for, and no exception attends the rounding, because rounding error is what an approximation *is* — and where the correctly rounded answer would be ±Infinity it throws `FloatRangeError` (`Float.hex`'s declaration, §3, shared rather than re-minted) with `BigInt.toFloat: value does not fit in Float`, refusing to fabricate one. The shared guard's sentence — the result must be finite, and nonzero when the input is nonzero — has only its overflow end reachable here: a nonzero integer is at least `1n` in magnitude, so the erasure end is `Rat`'s alone. Throwing `Float.hex`'s exception is what seats this companion after `Float.hex` in the prelude order (Modules §5.5's ordered visibility — a module seats after what it uses). **`BigInt.pow(value: BigInt, exponent: BigInt): BigInt`** is the `widens` declaration over `Pow<BigInt>`'s member (Operators §6.3.1; Constraints §4.7): exact power at exponents beyond `Int`'s range — a domain the host defines, and thin (`0n`/`±1n` bases answer at any non-negative exponent; elsewhere implementation limits govern as they do all `BigInt` growth) — with `exponent < 0` throwing `NegativeExponentError` at either face, the guard living once in the one body. The qualified spelling and the dot call take the door; `**` takes the member — the door's derived restriction, accounted for as `pow = widened`, whose derivation converts its `Int` exponent explicitly, JS `**` never mixing `bigint` and `number`.

**Division:** honors `Signed` but **not** `Frac` — BigInt division is truncating-toward-zero in JS, unlawful for generic `divide`. `Integral<BigInt>`'s `div`/`mod`, the **same Euclidean** convention as at `Int`, per the Division & Remainder spec *(#344 — this sentence previously said "floored" and "uniformly wrapped in codegen": the convention's name was corrected when Division & Remainder ruled Euclidean, and the wrapping is now `stdlib/BigInt.hex`'s ordinary source, the Euclidean family in Hexagon over the truncated door pair)*.

**FFI:** appears as `bigint` in emitted `.d.ts`. Known landmine, documented once in FFI docs: `JSON.stringify` throws on bigint — but only records that explicitly contain BigInt fields carry it, which is the point of keeping BigInt out of `Int`.

**Standard constraints:** `FromBigInt` (`integer-widening.md`), `Real` (Constraints §7), `Num`, `Signed`, `Eq`, `Ord`, `Show` (note `show 1n` is `"1"` — **no** `n` suffix; this is JS `String(1n)` behaviour and is display-correct), `Pow` (Operators §6.3), `Hash` (Collections Part 2 §2.5), `Integral` (Integral §3), `Bitwise` (`bitwise.md`) *(corrected 2026-07-28, #137 — record in §11)*.

---

## 7. Show: the display constraint (as it touches these types)

The constraint system has its own spec; this section records only the decisions that bind the primitive types and string interpolation.

**Contract:** `show : a -> String` produces the *human-readable display form* (Rust `Display`, not Haskell `show`): `show "abc"` is `abc` — no quotes; `show 42` is `"42"`; `show 1n` is `"1"`.

**Implementation rule ("toString unless JS is stupid"):** for each instance, `show` is JS `toString`/`String(x)` **when that output is sane**, and a Hexagon-provided implementation when JS's is stupid — **and the rule applies only to types this document owns**: a union's `Show` is the derived constructor-name form (Unions §7), which is why `Bool`'s corrected row below is not an exception to this rule but an exit from its jurisdiction *(clause added 2026-07-29, #147 — record in §12)*; likewise a tuple's — `Unit`'s included, at arity 0 — is the derived structural form (Products §2.5), computing the same `"()"` this table formerly decreed *(clause extended 2026-07-30, #159 — record in §13)*. Concretely:

| Type | `show` compiles to | Notes |
|---|---|---|
| `Nat` | `String(x)` | sane |
| `Int` | `String(x)` | sane |
| `Float` | `String(x)` | sane-ish; wart pre-registered in §3 |
| `BigInt` | `String(x)` | sane; drops `n`, correct for display |
| `Bool` | derived union `Show` | `"True"`/`"False"` — *corrected 2026-07-29, #147 (§12); formerly `String(x)`* |
| `String` | identity | |
| `Unit` | derived structural `Show` | `"()"` — *re-grounded 2026-07-30, #159 (§13): the arity-0 structural derivation (Products §2.5) computes the string this row formerly decreed (JS's `"undefined"` remains foreclosed, now by derivation rather than decree)* |

"JS is stupid" cases that get replacements rather than toString: plain objects (`[object Object]`) → derived structural show for records; arrays (bracket-less comma join) → structural show for List/tuples; functions (source dump) → **no Show instance at all**. Derived structural show for records/unions/tuples is specified with the constraint system, not here.

**Not universal, by design:** functions and opaque extern types have no Show instance; `${aFunction}` is a compile error. Universality would make the constraint vacuous — the types that *lack* Show are the feature.

**v2, noted not specified:** a separate `Debug` constraint (`Debug.debug`) for programmer-facing form (quoted strings at top level, etc.), interpolated with `#{}` (§5.4). Do not build it in v1; do keep the `#{` reservation.

---

## 8. Numeric `_` separators

Underscore separators are allowed in all numeric literals (Nat/Int-payload bare literals, `Float`, `BigInt`, and `Dec`) under **the JS rule** (decided — not Python's, which differs in exactly one corner: Python allows `0x_FF`, JS doesn't; since we emit literals into JS source, JS's rule is the only safe one, and it's Python-minus-that-corner):

- `_` must have a digit on **both** sides.
- Therefore: no leading (`_1`) or trailing (`1_`) underscore; no doubling (`1__0`); none adjacent to `.` (`1_.5`, `1._5`), to the exponent marker (`1_e5`, `1e_5`), or to the `n`/`d` suffix (`1_n`, `1_d`).
- Separators are for readability only: erased from the numeric value; grouping is unenforced (`1_00_00` is legal).
- Emission: literals may be emitted with or without their separators (both are valid JS); preserving them where the source had them is nicer for readable-JS but not required.

**Bases:** integer and BigInt literals may be hexadecimal, octal, or binary (`0xFF`, `0o777`, `0b1010`; `bitwise.md` §8), and the JS underscore rule extends to them unchanged, which sidesteps the `0x_FF` divergence permanently: `0xFF_FF` is legal, `0x_FF` is not. Float and Dec literals are decimal only.

The BigInt example in §1's table, `9_007_199_254_740_993n`, exercises both features at once but they are independent: `_` is general modern-integer-literal syntax, not BigInt-specific. (That value, 2^53 + 1, is also the smallest positive integer a bare literal *cannot* express — the lexer range check from the Numeric Literals spec rejects it without the `n`.)

---

## 9. Unit

> **Reclassified (2026-07-30, #159; correction record §13).** `Unit` is no longer a primitive. It is the **empty tuple** — the arity-0 member of the tuple family, normatively hosted at Products §2.7 — with its representation fixed by the arity-indexed tuple representation rule (Products §2.6): `undefined`, `void` in `.d.ts` return position. `()` is the empty-tuple literal and pattern; `Unit` is the type's only name — `()` is not a type expression, and `() -> T` remains Functions §5.3's zero-parameter domain. The full ruling is `decisions-ml-dialect-unit-2026-07.md`.

What this section formerly decreed, and where it went:

- **Semantics and literal** ("the type with exactly one value", `()`) survive as ordinary tuple facts at arity 0: one shape, zero components, one value.
- **Representation** (`undefined`, and the "a `Unit` function is a JS function that returns nothing" interop rationale) survives verbatim as Products §2.6's arity-0 clause; the §1 table row above records it.
- **Constraints** (`Eq`/`Ord`/`Show`/`Hash` "trivially") are now the **automatic structural instances** (Products §2.5, Constraints §4.5) at the vacuous arity — same outputs, verified at ruling time (decisions doc §5); "neither `Num` nor `Signed`" became a structural consequence rather than a decree.
- **The "nullary case of the tuple family" caution** to implementers is discharged by the reclassification itself: `()` *is* the tuple family's nullary case, officially.

Unchanged and still worth its ink here: **`Unit`'s `undefined` must not be confused with the FFI's `Nullable(a)`** boundary type. `Unit` is a real Hexagon type with one value; `Nullable` is a boundary-only foreign shape. They meet at the FFI but are unrelated concepts (FFI Part 1 §5).

---

## 10. Decisions log (quick reference, with authority)

| Decision | Where decided |
|---|---|
| `Nat` = non-negative safe integer, unboxed JS `number`; honors `Num`, not `Signed`; not the default | this doc §1; Numeric Literals spec |
| `Int` = f64-integer-invariant `number`, not bigint | this doc §2; Numeric Literals spec |
| Bare int literals use a `Nat` payload and are polymorphic via `Num.fromNat`, default `Int` | Numeric Literals spec (authoritative) |
| `1n` monomorphic BigInt; suffix = annotation | Numeric Literals spec §7; this doc §6 |
| Unsuffixed decimal literals monomorphic Float in v1; `d` selects Dec | Numeric Literals spec; this doc §3 |
| One string form `"..."`: interpolating, multi-line, no backticks, no tags | this doc §5.2 |
| `${e}` → `show(e)`; Show is display-semantics; not universal | this doc §5.3, §7 |
| Escapes `\$` and `\#`; bare `#{` is a v1 lex error (reserved for v2 Debug) | this doc §5.2, §5.4 |
| String length/indexing: codepoints, 1-based, O(n) accepted; graphemes maybe-later | this doc §5.1 |
| `_` separators: JS rule, all numeric literals; integers and BigInts also in hexadecimal, octal, and binary (`bitwise.md` §8), Float and Dec decimal only | this doc §8 |
| `Unit` = `()` = JS `undefined` | this doc §9 |
| `Float.nan` / `Float.infinity` constants and `Float.isNan` / `Float.isFinite` detectors; no special-value literals; `x != x` is uniformly `False` | this doc §3 |
| `Float.floor`/`ceil`/`trunc`/`round`/`roundAway` return `Int`; `round` uses ties to even, `roundAway` ties away from zero; unsafe results throw target-owned `IntRangeError`; zero is canonical | this doc §3; #919, #974 |
| Int overflow: silent past ±2^53, plain-JS operators; checked stdlib variants; `--checked-int` reserved; int32/`\|0` rejected | this doc §2.1 |
| `Ord String` = codepoint lexicographic, permanent regardless of grapheme indexing; collation is stdlib, never Ord | this doc §5 |
| Types uppercase-start; type variables non-uppercase-start (`a b c` by convention) | this doc §1; Lexer §3 |
| Constraint inventories refreshed for `Pow`/`Concat`/`Hash`/`Integral`; owning specs govern instance sets; enumeration retained deliberately | this doc §11 (#137); Operators §6.3, §7; Collections Part 2 §2.5; Integral §3 |
| `Bool` reclassified: prelude union `False \| True`, representation pinned to `boolean`, Show = constructor names, literals replaced by constructors with reserved-word redirect | decisions-ml-dialect-bool-2026-07.md (#147); this doc §4, §12; Unions §6.2, §8; Lexer §4.1 |
| `Unit` reclassified: the empty tuple, representation = the arity-0 clause of the tuple rule (`undefined`), constraints = automatic structural instances, `()` never a type, no observable change | decisions-ml-dialect-unit-2026-07.md (#159); this doc §9, §13; Products §2.5–§2.7 |

---

## 11. Correction record — constraint inventories (2026-07-28, #137)

> **Correction (2026-07-28, #137).** The per-type "Standard constraints" lines in §2–§6 and §9 predated four prelude constraints added after this document was decided: `Pow` (Operators §6.3), `Concat` (Operators §7), `Hash` (Collections Part 2 §2.5), and `Integral` (Integral §3). The lines are refreshed in place, each marked *(corrected 2026-07-28, #137)*; §1's Nat paragraph postdates all four and was already complete. The omissions contradicted nothing — each constraint's owning spec authoritatively recorded its own instances — but they mattered more than an ordinary gap: Numeric Literals §4's correction record (#135) defines the defaultable set by rule and stopped enumerating it, which left these inventories as the reader's nearest map of which constraints a bare literal can carry and still default.

Three standing rules accompany the refresh:

1. **Ownership is unchanged.** Which types honor a constraint is fixed by that constraint's owning spec — Constraints §7 for the original six, Operators §6.3/§7 for `Pow`/`Concat`, Collections Part 2 §2.5 for `Hash`, Integral §3 for `Integral`. Where an inventory line here and an owning spec disagree, the owning spec wins (README authority rule 1). The inventories are this document's per-type index of those decisions, nothing more.
2. **Enumeration is retained deliberately.** The alternative — citing the owning specs without naming the constraints, the move Numeric Literals §4 made under #135 — was considered and declined. §4 could stop enumerating because a *rule* generates its set ("the constraints whose `Int` instance ships with the compiler"); no rule generates a per-type inventory. The list *is* the information, and "which constraints does this type support" is precisely the question a reader opens the per-type reference to answer; citation-only would send that reader through four documents for a one-line answer.
3. **Future additions must touch this document.** A spec that grants any of §1's types an instance of a new constraint carries an edit note against the affected inventory line(s) here, applied on next touch (README authority rule 4). This is the same mechanism as every other cross-spec correction; it turns the next drift from silent into tracked debt.

---

## 12. Correction record — Bool reclassified as a prelude union (2026-07-29, #147)

> **Correction (2026-07-29, #147).** Under the ML-dialect doctrine pivot (`decisions-ml-dialect-bool-2026-07.md` §1 — James's ruling), `Bool` moved from this document's primitive set to the prelude: `union Bool derives (Eq, Ord, Show, Hash) = False | True`, with its representation intrinsically pinned to JS `boolean` (sole exception to Unions §6.2). Edits applied in place: the scope line counts six primitives; §1's table row now records only the representation fact; §4 is a pointer to the ruling plus the surviving no-truthiness clause; §7's table row shows the derived constructor-name form, superseding the lowercase `String(x)` ruling, and §7's implementation rule gained the jurisdiction clause (the toString rule governs only types this document owns; unions exit to Unions §7); §10 gained the log row.

Two standing rules accompany the reclassification:

1. **Section numbers did not move.** §4 remains "Bool" forever (house rule); its content is a pointer, not a hole. Cross-references of the form "Primitive Types §4" remain valid and now resolve to the pointer.
2. **Ownership transferred.** Bool's normative home is Unions (§6.2 for the pin, §8 for the declaration) and the decisions doc; this document retains only the representation row and the no-truthiness sentence. Where older text elsewhere in the corpus says "Primitive Types owns Bool," the decisions doc's ledger (its §6) governs the fix-on-next-touch.

---

## 13. Correction record — Unit reclassified as the empty tuple (2026-07-30, #159)

> **Correction (2026-07-30, #159).** Under the ML-dialect doctrine (`decisions-ml-dialect-bool-2026-07.md` §1), `Unit` moved from this document's primitive set to the tuple family: the empty tuple, hosted at Products §2.7, with `()` its literal and pattern, the automatic structural instances (Products §2.5, vacuous at arity 0) its constraints, and its `undefined` representation restated as the arity-0 clause of Products §2.6's arity-indexed representation rule. Edits applied in place: the scope line counts five primitives; §1's table row now records only the representation fact; §7's implementation rule extended its jurisdiction clause (tuples exit to Products §2.5, as unions exit to Unions §7) and §7's table row shows the derived structural form computing the same `"()"`; §9 is a pointer plus the surviving `Nullable` caution; §10 gained the log row. Unlike #147's reclassification, this one has **no behaviour change at all** — the derivation and the deleted decree compute identical outputs, verified per operation in the decisions doc's §5.

Two standing rules accompany the reclassification:

1. **Section numbers did not move.** §9 remains "Unit" forever (house rule); its content is a pointer, not a hole. Cross-references of the form "Primitive Types §9" remain valid and now resolve to the pointer.
2. **Ownership transferred.** `Unit`'s normative home is Products (§2.7, with §2.5/§2.6 carrying constraints and representation) and the decisions doc; this document retains only the representation row and the `Nullable` caution. Where older text elsewhere says "Primitive Types owns `Unit`," the decisions doc's ledger (its §8) governs the fix-on-next-touch.

## Real absolute value and sign

`Nat`, `Int`, `BigInt`, and `Float` honor `Real<a: (Num, Ord)>`.
`abs(value: a) -> a` preserves the input type, and `sign(value: a) -> Sign`
returns `Sign.Negative`, `Sign.Zero`, or `Sign.Positive`. Constraints §7 owns
the contract, including positive-zero normalization by `Float.abs` and
`Float.UndefinedSignError` for `Float.sign(Float.nan)`. `Rat` also honors
`Real` exactly (Rat §5). These operations use ordinary dictionary and dot-call
rules, with no additional numeric widening or result-type inference.
