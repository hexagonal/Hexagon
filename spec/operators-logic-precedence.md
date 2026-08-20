# Hexagon Spec — Operators, Logic & Precedence

**Status:** Decided (v1), except items explicitly marked deferred.
**Scope:** The complete v1 operator inventory; the precedence and associativity table; word-based logical operators (`not`, `and`, `or`, `implies`, `iff`) and their desugarings; comparison operators, chaining, and the single-evaluation rule; arithmetic operators including `**`; the concatenation operator `++`; the pipe operator `|>`; the `if … then … else` expression (mandatory `then`; `else` omissible as `Unit` sugar, §11.2); the grammatical placement of `..`, `:=`, `=>`, `[]`, `.`, and call syntax.
**Not in scope:** Semantics of indexing/slicing (`xs[i]`, `xs[lo..hi]`) beyond precedence — owed to the collections/indexing spec. Semantics of `Range` construction — Loops, Ranges & Iteration spec is authoritative; this spec only fixes `..`'s precedence. `match` — pattern-matching spec; referenced here only as a member of the eats-to-the-right family. Constraint mechanics (dictionary passing, coherence) — Constraints spec.
**Companions:** Constraints (operator→member elaboration targets, prelude constraint listing), Primitive Types (per-type instance inventories, `Ord String`), Numeric Literals (literal elaboration under operators), Loops/Ranges/Iteration (`..` semantics, `while`/`for` condition grammar by reference), Statements/Blocks/Mutability (`:=` semantics, discard rule), Exceptions (edit note §14.2), Functions (`=>`, header sugar).

---

## 1. Overview and governing principles

### 1.1 Operators elaborate to constraint members; nothing else is overloadable

Hexagon has **no user-defined operators and no operator overloading**, permanently — this is a language identity decision, not a v1 deferral. The only extensibility an operator has is the one the constraint system already provides: each *value-level* operator is fixed sugar for a named constraint member, and a type participates in the operator by honoring the constraint. Elaboration table:

| Operator | Elaborates to | Constraint |
|---|---|---|
| `+` `*` | `add`, `multiply` | `Num` |
| `-` (binary) | `subtract` | `Signed` |
| `-` (unary) | `negate` | `Signed` |
| `/` | `divide` | `Frac` |
| `**` | `pow` | `Pow` (new — §6.3) |
| `++` | `concat` | `Concat` (new — §7) |
| `==` | `equals` | `Eq` |
| `!=` | `notEquals` | `Eq` |
| `<` `>` `<=` `>=` | `compare` | `Ord` |

Everything else in the operator inventory is a **structural form** owned by the language, not by any type: `not`/`and`/`or`/`implies`/`iff` (primitive on `Bool`, §4), `..` (builds a `Range`, Loops spec), `|>` (pre-inference syntactic rewrite, §8), `=>` (lambda), `:=` (assignment statement-expression), `.` (field access), `()` (call), `[]` (index/slice), `if/then/else` (§11). None of these consult an instance table and none can be redefined.

Consequence for the implementer: after elaboration, the type checker sees only ordinary calls (`add(x, y)`, `equals(a, b)`, `notEquals(a, b)`) plus the handful of structural node kinds. Operators do not exist in the typed AST.

### 1.2 Words for logic, symbols for algebra

Logical operators are **English words only**: `not`, `and`, `or`, `implies`, `iff`. The symbolic forms `!`, `&&`, `||` do not exist as operators — `&&` and `||` are not tokens, and `!` is not negation *(amended for #355: `!` is now a token, the impure call mark — Effects §3, Lexer §8.1; a `!` in prefix-expression position still gets the fixit "Hexagon spells logical negation `not`", selected by the parser)*. Arithmetic and comparison stay symbolic, matching mathematics.

Lineage: Python and Lua spell logic with words as their *only* form; Pascal, Ada, and SQL established the tradition. Ruby is the cautionary precedent — it offers both `&&` and `and` *with different precedences*, a well-known bug factory. Hexagon avoids the trap by having exactly one spelling.

### 1.3 Precedence philosophy: mathematics first, JS second

Where mathematical/logical convention (as codified in Lean 4's core precedences) and JS convention conflict, **mathematics wins**; JS is followed only where it agrees or where math is silent. The two places this bites in v1:

- `not` sits *below* the comparisons (§3), as in Python and as in the mathematical reading of `¬(a = b)` — not above them as C-family `!` is.
- `-2 ** 2` is legal and means `-(2 ** 2)` (§6.2); JS makes it a `SyntaxError`.

Levels are numbered **1 = tightest** with no gaps and no reserved slots. Since operators can never be user-defined, nothing hangs on the numbers; they exist so diagnostics and documentation can say "level 9" unambiguously. Keep the table small — every level must earn its row.

---

## 2. Operator inventory (complete, v1)

**Value-level (constraint-backed):** `+` `-` `*` `/` `**` `++` `==` `!=` `<` `>` `<=` `>=` unary `-`.
**Logical:** `not` `and` `or` `implies` `iff`.
**Structural:** `.` `()` `[]` `..` `|>` `:=` `=>` `if/then/else` (`match` joins from the pattern-matching spec).

Deliberately absent (see §13 for reasoning): `%`, `^`, `&&`, `||`, `!` (bare), bitwise operators, compound assignment (`+=` etc.), any Elvis/coalescing operator, any user-definable operator.

---

## 3. The precedence table

| Level | Operators | Associativity | Category |
|---|---|---|---|
| **1** (tightest) | `.`  `f(...)`  `xs[...]` | left | Postfix |
| **2** | `**` | right | Exponentiation |
| **3** | `-` (unary) | prefix | Numeric negation |
| **4** | `*`  `/` | left | Multiplicative |
| **5** | `+`  `-`  `++` | left | Additive / concatenation |
| **6** | `..` | none (non-associative, non-chaining) | Range |
| **7** | `==` `!=` `<` `>` `<=` `>=` | chaining (§5) | Comparison |
| **8** | `not` | prefix | Logical negation |
| **9** | `and` | left | Conjunction |
| **10** | `or` | left | Disjunction |
| **11** | `implies` | right | Implication |
| **12** (loosest infix) | `iff` | left | Biconditional |
| **13** | `\|>` | left | Pipe |
| — | `=>`, `if/then/else`, `match` | eats-to-the-right (§3.2) | Prefix expression forms |
| — | `:=` | non-associative, statement-level | Assignment (§12) |

The logic tail (7–12) mirrors Lean 4's ordering exactly: comparisons above `¬` above `∧` above `∨` above `→` (right-associative) above `↔`. `implies` right-associativity is the logic convention (`a → b → c` ≡ `a → (b → c)`); `iff` left-associativity matches Lean's `↔`.

### 3.1 The `not` position (change from the early draft — do not resurrect)

`not` binds **looser than comparisons, tighter than `and`** — the Python position. Therefore:

```
not a == b        -- parses as  not (a == b)
not a < b < c     -- parses as  not (a < b and b < c)
not a and b       -- parses as  (not a) and b
```

The early draft placed `not` above the comparisons (C-family habit), making `not a == b` mean `(not a) == b` — a parse that requires `a : Bool` and is almost never what was typed, while contradicting the plain-English and mathematical reading. Rejected; recorded here so it is not re-litigated. Note the pleasant consequence: `(not a) == b` is still expressible with parens, and `a != b` remains the idiomatic spelling of "not equal."

### 3.2 Eats-to-the-right forms

`=>` (lambda), `if … then … else` (§11), and `match` are **prefix expression forms whose body extends as far right as possible** — maximal munch, ended only by a closing delimiter, a layout boundary, or end of input. They have no level number because they are not infix: they may appear (a) anywhere parenthesized, and (b) bare as the **final operand** of any infix expression, where they swallow the rest of the line.

```
1 + if c then a else b        -- 1 + (if c then a else b)
xs |> map(x => x + 1)         -- lambda is map's argument (delimited by the paren)
f(x) + match y ...            -- match is the right operand of +
x => x |> f                   -- the whole pipe is the lambda body
```

No forced parentheses when the form is rightmost — that is the point. A bare eats-right form in a *non-final* operand position is a parse error with the fixit "parenthesize the `if`/lambda/`match`."

### 3.3 `|>` vs `=>`

Pipe is the loosest infix operator, sitting just above the eats-right family. Two consequences, both intended: `xs |> map(x => x + 1)` parses the lambda inside `map`'s argument list, and `x => x |> f` parses the entire pipe as the lambda body (per §3.2 the lambda ate to the right). Everything logical pipes cleanly: `a and b |> assert` is `(a and b) |> assert`.

---

## 4. Logical operators

All five operate on `Bool` only. There is no truthiness anywhere in Hexagon; a non-`Bool` operand is an ordinary type error, and the diagnostic never suggests coercion.

### 4.1 Semantics and primitives

| Operator | Primitive? | Definition | Evaluation of operands |
|---|---|---|---|
| `not a` | yes | — | `a` always |
| `a and b` | yes | — | `a` always; `b` iff `a` is `True` |
| `a or b` | yes | — | `a` always; `b` iff `a` is `False` |
| `a implies b` | no | `not a or b` | `a` always; `b` iff `a` is `True` |
| `a iff b` | no | `equals(a, b)` on `Bool` — see §4.3 | **both, always** |

`and` and `or` are the primitive short-circuit forms and compile to JS `&&`/`||` directly. `implies` desugars *before* type checking to `not a or b` and therefore short-circuits for free: `False implies loop()` returns `True` without evaluating the right side. Emission: `!a || b`. These native emissions — with `not`'s `!` — are mandatory, and they are **licensed by `Bool`'s representation pin** (§4.5). *(Operand spellings respelled and license added 2026-07-29, #147.)*

### 4.2 Why logic is not constraint-backed

`not`/`and`/`or` could conceivably elaborate to members of some `Boolean`-algebra constraint. Rejected: short-circuit evaluation is incompatible with ordinary call semantics (a member call `and(a, b)` evaluates both arguments), and Hexagon has no by-name parameters to rescue it. Logic is structural, monomorphic on `Bool`, and emits native JS operators — which is also exactly what readable-JS wants.

### 4.3 `iff` and the death of a draft claim

The early draft defined `iff` as `(a implies b) and (b implies a)` and claimed it short-circuits. Under the single-evaluation rule (§5.4) that definition requires binding both operands to temporaries first — at which point *both operands are always evaluated* and no short-circuiting remains. The claim was false; strike it.

Given that, the honest and simpler definition wins: **`a iff b` is Boolean equality.** It elaborates to `equals(a, b)` at `Bool` and emits `a === b` — a native emission carrying the same §4.5 pin license as the rest of the family. Same truth table as the double implication, one evaluation of each operand, no temporaries, one token of output. Diagnostics and docs must describe `iff` as "true when both sides agree" and must state that both operands are always evaluated (the one member of the logic family that does not short-circuit).

### 4.4 On the length of `implies`

`implies` is the longest keyword in the family. Alternatives considered: a symbolic `==>` (rejected — the words-only rule is worth more than the keystrokes, and `==>` collides visually with `=>` at exactly the moment a reader can least afford it) and abbreviations (`imp`, `impl` — cryptic; `impl` additionally reads as Rust's implementation keyword). No natural shorter English word exists. `implies` stands; material implication is rare enough in application code that its length is a feature — it marks the interesting line.

### 4.5 `Bool` is a union; the native emissions are licensed by the representation pin (2026-07-29, #147)

Since the ML-dialect ruling, `Bool` is not a primitive: it is the prelude union `union Bool derives (Eq, Ord, Show, Hash) = False | True` (Unions §8), so this section's operands are **union-typed values**. `True`/`False` are the only value spellings; the reserved words `true`/`false` produce the Lexer §4.1 redirect. Nothing about the operators' typing changes — they remain structural forms monomorphic on `Bool` (§1.1, §4.2), and the no-truthiness rule of §4's lead-in survives verbatim.

What must be stated here is the representation dependency:

> The mandated native emissions of this section — `and` → `&&`, `or` → `||`, `not` → `!`, `implies` → `!a || b` (§4.1), `iff` → `a === b` (§4.3) — and §11's direct branch on an `if` condition (inherited by `while`, Loops §4) are legal **only because the compiler pins `Bool`'s runtime representation to the JS `boolean`** (Unions §6.2: `True` emits `true`, `False` emits `false`; full ruling `decisions-ml-dialect-bool-2026-07.md` §3). Against the unpinned all-nullary string representation, `&&` on `"False"` would be truthy nonsense. This section is a recorded dependent of the pin: any future session revisiting the pin must treat every emission named here as breaking with it.

Consequently `Bool` is the **sole exception** to Unions §1's "`match` is the only eliminator" doctrine — the five logic operators and `if`/`while` conditions eliminate a `Bool` without `match`. The carve lives at Unions §1/§8; every user-declared union remains match-only without exception. The exception is representation-blind at the source level: no field access, predicate, or cast is exposed, and no Hexagon program can observe the pinned representation from inside the language.

---

## 5. Comparison operators and chaining

### 5.1 Elaboration

`==` and `!=` elaborate through `Eq`: `equals(a, b)` and `notEquals(a, b)`. `notEquals` has the default `not equals(a, b)` but an instance may override it while preserving that law. The relational four elaborate through `Ord`'s single member `compare(x, y): Ordering`:

| Source | Elaboration |
|---|---|
| `a < b` | `compare(a, b) == Less` |
| `a > b` | `compare(a, b) == Greater` |
| `a <= b` | `compare(a, b) != Greater` |
| `a >= b` | `compare(a, b) != Less` |

*(Correction: the table's constructor names originally read `LT`/`GT` — the Haskell spelling Decisions Batch §3 rejected; corrected to the pinned `Less`/`Equal`/`Greater`. See #275.)*

The early draft's primitive-operator table (`<=` as `a < b or a == b`, etc.) is superseded by the `compare`-based story — one member, one instance obligation, derived operators total by construction, and no double evaluation of operands in the derived forms.

**Implementer note (one representation):** the elaborations above are constructor tests on the `Ordering` result — never sign tests on a number; int-returning `compare` is the rejected alternative (Decisions Batch §3). Derived and hand-written instances return the same `Ordering` values under the Unions §6.2 all-nullary representation — where derived `Ord` on an all-nullary union is declaration-index order, never JS `<` on the name-strings (Unions §7) — and a dictionary's `compare` slot holds exactly that `(a, a) -> Ordering` function (FFI Part 9 faces it so). Numeric comparators remain legal as internals; what is forbidden is a number anywhere a `compare` result is observable — a dictionary's `compare` slot, an exported face, a value user code can reach. Adapting a dictionary's `compare` into a numeric comparator for a host API (an `Array.prototype.sort` callback, say) is the consumer's own conversion and is fine.

Operands normally share one type. Numeric Literals §5.1 applies before the `Eq`/`Ord`
operation is selected: an established `Nat` may widen through `Num.fromNat`, while an
established `Int` may widen through `Signed.fromInt`, when another operand independently
establishes the matching target. Thus `count < cost` is a
Float comparison when `count : Int` and `cost : Float`; `Int` versus `Int` remains an
exact Int comparison. Non-numeric comparisons gain no coercion.

**Codegen fast path (mandatory for readable JS):** when the `Ord`/`Eq` dictionary is a known primitive (or pinned-`Bool`) instance, emit the direct JavaScript operation only when it preserves that instance's semantics. `Int`, all-BMP-safe `String` handling per Primitive Types §5, and the applicable all-nullary-union cases may use native operators directly; `Bool` — since #147 a prelude union, not a primitive — takes the native path under its representation pin (§4.5): `===` on booleans *is* the derived `Eq<Bool>`, and JS `<` on booleans agrees with derived `Ord`'s declaration order `False | True` by construction (Unions §6.2), so no declaration-index table is needed. *(Reclassified 2026-07-29, #147.)*

`Float` is the mandatory exception. `Eq<Float>` is SameValueZero (Decisions Batch §1), so bare `===` and `!==` are wrong for `NaN`. Given operands evaluated once as `x` and `y`, the fast paths are:

```js
// x == y
x === y || (Number.isNaN(x) && Number.isNaN(y))

// x != y
!(x === y || (Number.isNaN(x) && Number.isNaN(y)))
```

An on-demand helper with the same semantics is equally valid where it reads better. `Ord<Float>` may use native relational operators only when neither operand can be `NaN`; the general path uses the total `compare` fixed by Decisions Batch §1. The polymorphic case emits the dictionary call. `Ord String` remains codepoint-lexicographic with the BMP fast path — Primitive Types is authoritative.

Types without the instance simply cannot use the operator: `==` on functions is a compile error ("functions have no `Eq` instance"), and the relational four on discriminated unions are a compile error unless the union has an explicit `Ord` (the standing rule: logic must not depend on declaration order; the diagnostic is "ordering is not defined for union `Shape`").

### 5.2 Chaining

A run of comparison operators at level 7 is parsed as a **chain**, desugaring to a conjunction of pairwise comparisons with shared middle operands bound once (§5.4):

```
a < b < c          -- a < b and b < c
a <= b < c         -- a <= b and b < c
lo <= x <= hi      -- the idiom the feature exists for
a == b == c        -- a == b and b == c
```

Chains short-circuit left-to-right exactly as the desugared `and`s do.

### 5.3 Chain restrictions (decided)

- **Directional consistency.** A chain may use the *ascending family* {`<`, `<=`, `==`} or the *descending family* {`>`, `>=`, `==`} — never both. `a < b > c` is a compile error: "comparison chains cannot mix `<` and `>`; split into `a < b and b > c`." Python permits the mix; it is nearly always a bug or unreadable, and the fixit costs one `and`. `==` is a member of both families (`a < b == c` is legal and means `a < b and b == c`).
- **`!=` does not chain.** `a != b != c` does not mean "all three distinct" in any language that allows it, and everyone reads it as though it does. Compile error: "`!=` does not chain; write the pairwise comparisons explicitly." `!=` remains a perfectly ordinary non-chained binary operator.

### 5.4 Single-evaluation rule

Whenever a desugaring duplicates an operand syntactically, the compiler binds it to a hidden temporary so every source operand is **evaluated exactly once**, in left-to-right source order. Clients include comparison-chain middles and the inline `Float` SameValueZero fast path:

```
a < f() < c
-- conceptually:  let _m = f()
--                a < _m and _m < c
-- emits:         a < (_m = f()) && _m < c   — or a statement-lifted let,
--                whichever the expression context permits; readable either way
```

(`iff` left this club when it became Boolean equality — §4.3. The rule is stated generally because future desugarings inherit it.) Temporaries are invisible: never nameable, never in diagnostics, never in the `.d.ts`.

---

## 6. Arithmetic operators

### 6.1 The `Num`/`Signed`/`Frac` arithmetic family

`+` and `*` elaborate to `Num`; binary `-` to `Signed.subtract`; `/` to `Frac.divide`. Operands normally share one type after Numeric Literals §5.1 has injected an established `Nat` through `Num.fromNat` or an established `Int` through `Signed.fromInt`. `Int + Int` stays Int; `Int * Nat` widens Nat to Int; and `count * cost` is Float when `count : Int` and `cost : Float`. Nat honors Num but not Signed; Int honors both but not Frac. Operand-driven selection is the no-expectation case: where the operation's seat lands a concrete expected type carrying the operator's constraint instance, Numeric Literals §5.1's expected-type lift selects that type as the operation's home instead — `let mean: Float = sum / size` is `Frac<Float>` division of two injected `Int`s, and `let x: Int = n - m` is `Signed<Int>` subtraction of two injected `Nat`s. Numeric literals elaborate per the Numeric Literals spec. There is no `%` operator (§13).

`Float` and `Rat` both honor `Frac`, with type-owned failure and precision semantics:
Float division is native IEEE 754 division, while Rat division is exact and throws
`DivideByZeroError` for a zero divisor. `Int` and `BigInt` do not honor `Frac`; their
named division families state the quotient and remainder convention explicitly.

### 6.2 Unary minus

Level 3, elaborates to `negate`. Interactions, all decided:

- `**` binds tighter on its left: `-2 ** 2` is `-(2 ** 2)` = `-4` — the mathematical reading of −2². JS refuses to parse this (`SyntaxError`, demanding parens); Hexagon follows math, not JS, per §1.3. **Emission must therefore parenthesize:** `-(2 ** 2)`, which is legal JS.
- The *right* operand of `**` may begin with unary minus: `2 ** -3` is `2 ** (-3)` (Python's rule; the right operand of a right-associative level-2 operator parses at a level that admits prefixes).
- Adjacent to a numeric literal, `-42` is still negation applied to the literal `42` — there are no negative literals; `negate(fromNat(42))` folds at compile time for the monomorphic cases, emitting `-42`.

### 6.3 `**` — exponentiation and the `Pow` constraint

`**` is chosen over `^` (Python/JS spelling; `^` stays free and unused — better permanently absent than meaning XOR to half the audience and power to the other half).

**Right-associative, because mathematics says so:** `a ** b ** c` means `a ** (b ** c)` — a tower of exponents is read top-down, i.e. right-to-left, and left association would make the parenthesized form `(a**b)**c = a**(b·c)`, a different and less useful function. Record for the curious implementer: JS and Python happen to agree with math here, so no conflict arises — the JS divergence is only the unary-minus refusal (§6.2).

Instance selection at `**` follows §6.1's rule: operand-driven where no expectation lands, the seat's written face where one does (Numeric Literals §5.1's lift) — `let x: Float = a ** b` at `Int` operands is `Pow<Float>`'s native, total `**`, fractional results and all, where operand-driven selection is `Pow<Int>` with its negative-exponent guard.

Elaboration target — a new small prelude constraint (edit note to Constraints §7):

```
constraint Pow<a: Num> =
    pow(x: a, y: a): a
```

`pow` is not folded into `Num` (it would obligate every `Num` instance forever) nor into `Frac`. Instances:

| Instance | Semantics | Emission |
|---|---|---|
| `Nat` | non-negative exponent; exact within the safe range under Nat's ordinary overflow contract | native `**` *(#344: the source `Pow<Nat>` member in `stdlib/Nat.hex` is the raw-native door key `natPow` with nothing above it — a `Nat` exponent cannot be negative, so the guard the checked helper carried was dead by typing here; this row previously said "checked numeric `**` helper", and behaviour is unchanged because the removed guard was unreachable)* |
| `Float` | IEEE 754, JS `**` exactly (including `NaN` edges) | native `**` *(#344: the source `Pow<Float>` member in `stdlib/Float.hex` is the raw-native door key `floatPow` with nothing above it — a negative float exponent is an ordinary float operation, so no guard exists to write; behaviour unchanged)* |
| `Int` | exact for `y >= 0` within the safe range (overflow policy = ordinary Int arithmetic, Primitive Types §2.1); **`y < 0` throws `NegativeExponentError`** — a fractional result cannot be an `Int`, same species of partiality as `Int.div`'s zero check | `Int.pow(x, y)` *(#344: now the source `Pow<Int>` member in `stdlib/Int.hex` — Hexagon guard over the raw-native door key `intPow`, exactly `BigInt`'s shape in the row below; this cell previously said "helper (carries the guard)"; behaviour and message unchanged)* |
| `BigInt` | exact; `y < 0` throws `NegativeExponentError` (JS `**` on bigints throws `RangeError`; we brand our own — Exceptions edit note §14.2) | `BigInt.pow(x, y)` helper *(#344: now the source `Pow<BigInt>` member in `stdlib/BigInt.hex` — Hexagon guard over the raw-native door key `bigIntPow`; the exception's declared home is `stdlib/Pow.hex`; behaviour and message unchanged)* |
| `Rat` | **exact for integer-valued exponents of either sign** — the predicate is a canonical bottom of `1n`. A negative exponent inverts the base first, so `(2/3) ** (-2/1)` is exactly `9/4` — the case `Pow<Int>` structurally cannot serve and `Rat` serves perfectly. **A non-integer exponent throws `FractionalExponentError`** — an irrational result cannot be a `Rat`, the same species of partiality as the `Int` row's guard. `0 ** negative-integer` reaches `Rat`'s ordinary `DivideByZeroError` through the smart-construction boundary; where both conditions overlap the integrality guard is checked first (`rat.md` §4) | the source `Pow<Rat>` member in `stdlib/Rat.hex` — the integrality guard over exact `BigInt` exponentiation of the canonical top/bottom pair; `FractionalExponentError`'s declared home is `stdlib/Pow.hex`, beside `NegativeExponentError` |

The polymorphic case is the ordinary dictionary call. `pow` is also directly callable as a member, like every constraint member.

The `Rat` row moves a Haskell discipline into the runtime guard: Haskell gives `Rational` exactly integer-exponent power and splits the capability across operators to say so (`^`/`^^`, with `**` reserved to `Floating`); Hexagon's one homogeneous `pow` keeps the single spelling and lets the guard own the boundary, exactly as the `Int` row already does. The guard's predicate is statable of the operands alone — what no `Pow` instance will ever consult is the *base's* structure (perfect-power extraction, §13).

---

## 7. `++` — concatenation and the `Concat` constraint

Binary, level 5 (additive), left-associative. Elaborates to a new prelude constraint (edit note to Constraints §7):

```
constraint Concat<a> =
    concat(x: a, y: a): a
```

- **v1 instance: `String`.** Emission for the monomorphic case is JS `+` — readable and exactly right, and safe *because* Hexagon's types prevent the mixed-operand accidents that make JS `+` on strings a hazard.
- **`List(a)` instance owed to the collections spec** — the operator was chosen with lists in mind; nothing here blocks it.
- Left-associativity note for implementers: `a ++ b ++ c` as `(a ++ b) ++ c` is O(n²) if `concat` copies; the collections spec may fuse chained emission (`[...a, ...b, ...c]`). String chains fold into one `+` chain naturally.

Lineage: Haskell, Elm, PureScript, and (as `<>`/append) the broader ML family. Overloading `+` for strings was rejected: `+` is `Num.add` and `String` is not `Num`; keeping algebra and joining as separate operators is both the FP tradition and a genuine diagnostic improvement (`"a" + "b"` errors with "did you mean `++`?" — mandatory fixit, see §14.1).

`++` and `+`/`-` sharing level 5 is harmless in practice — mixing them in one expression is invariably a type error anyway — and saves a table row.

---

## 8. `|>` — the pipe

**Token from F#, semantics from ReScript** — record this loudly, since F# programmers will assume currying semantics. F#'s `x |> f` applies a curried function to its *last*-supplied argument. Hexagon has no currying; its pipe is **first-argument insertion**, a purely syntactic rewrite performed *before* type inference:

```
a |> f(b, c)      -- rewrites to  f(a, b, c)
a |> f            -- rewrites to  f(a)          (bare form: allowed)
x |> negate |> show
                  -- show(negate(x))
xs |> map(x => x + 1) |> filter(p) |> take(3)
                  -- take(filter(map(xs, x => x + 1), p), 3)
```

- Left-associative, level 13 (loosest infix — §3.3 covers the two `=>` interaction cases).
- **Desugar shape:** if the right operand is syntactically a call `E(args…)`, rewrite to `E(a, args…)`; otherwise treat the whole right operand as a callee and rewrite to `RHS(a)` (this is what makes the bare form and `a |> (x => x + 1)` work). Because the rewrite precedes inference, the type checker, constraint resolution, and dictionary insertion never know pipes exist.
- **Typing rides the rewritten application** (Functions §4.3): when the bare-form rewrite makes the callee a lambda literal — `a |> (x => …)`, `a |> match …` — that application elaborates its argument before its callee, so the lambda's parameter reads its type off `a`. This is the elaboration schedule only; the evaluation-order footnote below is unchanged.
- *(#355.)* **A pipe stage is a call, so it takes a call mark** (Effects §3). A stage with its own argument list marks that list as any call does: `x |> take!(3)` rewrites to `take!(x, 3)`. The bare form's mark stands at the end of the stage — `x |> save!` — and the rewrite carries it onto the call it builds: `save!(x)`. The stage end is one of the mark's two grammatical seats (Effects §3.2; Lexer §8.1); the checker still never knows pipes exist — it sees the rewritten, marked call.
- **Evaluation-order footnote:** the rewrite moves `a` into argument position, so JS evaluation order runs the callee expression before `a`. Observable only when the callee expression itself has effects; accepted, not worth a temporary.
- The pipe is why the stdlib convention exists: **the first parameter of every stdlib function is the subject being operated on** (ReScript/OCaml order). One data-last straggler breaks every chain it appears in. This convention is normative for the prelude and stdlib specs.
- Emission: pipes have vanished before codegen; the emitted JS is the plain nested calls. When nesting gets deep the emitter may lift intermediates to `const` locals for readability — its call.

---

## 9. `..` — precedence resolved

The Loops spec deferred `..`'s precedence here with recorded intent; that intent is now **decided as recorded**:

- **Level 6: looser than arithmetic, tighter than comparison.** `1..n+1` is `1..(n+1)`; `a*2..b*2` is `(a*2)..(b*2)`.
- **Non-associative and non-chaining:** `1..2..3` is a parse error — final phrasing (owed to Loops §10.2): "`..` does not chain; a range has exactly two endpoints."
- Comparisons apply to a `Range` value only via whatever instances `Range` has (`Ord` it has not — Loops §3.6), so the level-6/level-7 boundary almost never matters; it exists so `x in 1..10` reads unambiguously in any future syntax that combines them.

Everything else about ranges — inclusivity, emptiness, `Int`-onlyness, laziness, `range`/`rangeDown` — lives in the Loops spec and is not restated.

---

## 10. Postfix forms: `.`, call, `[]`

All level 1, left-associative, freely interleaved: `a.b[i].c(x)[1..3]`.

- `.` — field access (records, tuples' `itemN`); also the module-path separator (`Int.div`) — same token, resolved by what the left side names.
- `f(args)` — call.
- `xs[i]` — indexing; `xs[lo..hi]` — slicing (any `Range`-valued expression is legal between the brackets, not just a literal `..`). **Semantics deferred to the collections/indexing spec**; the standing decisions this table must not contradict: indexing is 1-based, out-of-bounds `xs[i]` throws `IndexError`, and whether a slice clamps or throws is that spec's open question. This spec contributes only the grammar: `[` after a primary expression is postfix indexing, never a list literal — the lexer/parser distinguish by position, and `[1..10]` in expression-head position is reserved for whatever the collections spec decides literals look like.

---

## 11. `if … then … else`

The conditional is an **expression**, this spec owns it fully, and the Loops spec's by-reference use of "the `if` condition's grammar" (for `while`) resolves here.

### 11.1 Condition

Bare expression, no required parentheses, must be `Bool` — no truthiness, and the diagnostic for a non-`Bool` condition never suggests coercion. (Parentheses are of course *allowed*; they're just parentheses.) `while` inherits exactly this, per the Loops spec's reference. The condition is consumed directly — the emitted JS branches on the `Bool` value itself (§11.4), an elimination without `match` that is **licensed by the representation pin** (§4.5; Unions §1/§8 carry the carve). *(License recorded 2026-07-29, #147.)*

### 11.2 Mandatory clauses

```
if condition then trueExpression else falseExpression
```

`then` is mandatory, always. An `if` without `then` is a parse error,
including when an indented line follows the condition. An `if` without `else`
is legal **sugar for `else ()`**: the parser inserts a unit false branch, so
every compiler representation from Parsed onward still carries both branches —
the sugar exists only in source text. The whole form then checks as usual,
which forces the `then` branch to `Unit`. An else-less `if` whose `then`
branch is not `Unit` is a type error with a mandatory fixit: *"an `if`
without `else` produces `Unit`; its `then` branch is `String` — add an
`else` branch to produce a value."* The doctrine is unchanged: every
conditional is an expression with a value on every path — the omitted
branch's value is `()`.

Dangling `else` needs no new grammar: eats-to-the-right (§3.2) makes the
inner conditional of `if c1 then if c2 then a else b` claim the `else`, so
an `else` always attaches to the nearest unmatched `then`; parenthesize the
inner conditional to override. The relaxation does not extend to `match` —
there is no implicit `Unit` arm, and exhaustiveness is untouched. (Lineage:
this is the F# rule for else-less `unit` conditionals, adopted July 2026 on
re-examination of the original strict decision; Statements §10.3 records
the reversal.)

Eats to the right (§3.2): `expr2` extends as far as possible, so `1 + if c then a else b` is `1 + (if c then a else b)` and `if c then a else b + 1` is `if c then a else (b + 1)` — the `else` arm ate the `+ 1`. Chained: `if c1 then a else if c2 then b else c` nests rightward with no special grammar. Both arms resolve to one type: exact unification wins, followed by Numeric Literals §5.1's contextual widening: established `Nat` through `Num.fromNat`, or established `Int` through `Signed.fromInt`, when the other arm independently establishes the corresponding target. A landed expected type reaches both arms as forwarding positions (Functions §4.3), where it feeds Numeric Literals §5.1's lift at an arithmetic arm; a bare-value arm still widens at the form's own seat boundary, as ever. The whole form has the resulting type.

### 11.3 Canonical formatting

When the entire conditional is short enough, keep it on one line:

```
if isTall then 5 else 6
```

Otherwise, `then` stays on the condition line and each branch is an indented block:

```
if condition then
    trueExpression
else
    falseExpression
```

This multiline spelling is the reliable canonical form regardless of branch
complexity. A formatter may collapse it only when the complete conditional fits
the configured line-width limit. A block arm's value is its final expression per
the standard block rule.

`else if` is syntactically `else` whose expression is another mandatory-`then`
conditional; there is no dedicated construct. It may appear in a one-line conditional
when the whole expression fits. In canonical multiline formatting, the nested
conditional is indented beneath `else` like every other false-branch expression.

An effect-position conditional canonically uses the else-less form:

```
if delayed then
    print("Order delayed")
```

Writing the desugared `else ()` explicitly is legal but not canonical — the
sugar exists exactly so the unit ceremony is never written. A conditional
that produces a value always writes both branches (its else-less spelling
is a type error per §11.2, not a style choice).

### 11.4 Emission

Value position: JS ternary `c ? a : b` when both arms are single expressions — the readable choice; statement-lift to `if/else` with a `let` when an arm contains statements. Statement/`Unit` position: plain JS `if`/`else if`/`else`; an else-less source conditional emits an else-less JS `if` — the inserted `()` branch is erased, never a synthetic `else`. `iff`/`implies` inside conditions emit per §4.

---

## 12. `:=` — grammatical placement

Semantics live in Statements/Blocks/Mutability (`var`-only target, `Unit`-typed, monomorphic). Grammar, fixed here: `:=` is the loosest binding form of all and **non-associative** — `x := y := z` is a parse error ("`:=` does not chain; assignment produces `Unit`"), independently of the type error it would also be. The RHS admits eats-right forms bare: `x := if c then a else b` and `f := (n) => n + 1` parse as expected. Compound assignment (`+=` and family) remains rejected per the Statements spec; the revisit bar recorded there is unchanged.

---

## 13. Rejected alternatives (do not re-litigate without new information)

| Rejection | Reasoning |
|---|---|
| `&&`, `||`, `!` | Words-only logic (§1.2). One spelling, no Ruby-style dual-precedence trap. `&&`/`||` are lex errors with fixits; `!` as *negation* gets the same `not` redirect, parser-selected since #355 made `!` the call-mark token (§1.2). |
| `not` above comparisons (early-draft position) | §3.1. `not a == b` must mean `not (a == b)`; Python/Lean position adopted. |
| `iff` as desugared double implication | §4.3. Under single-evaluation it never short-circuited anyway; Boolean equality is the same truth table with simpler everything. |
| Symbolic implication `==>` | Words-only rule; visual collision with `=>`. |
| User-defined/custom operators, operator overloading | Permanent identity decision (§1.1). Operators are fixed sugar for constraint members; extensibility lives in `honor`. |
| `%` operator | Modulo has two live conventions (floored/truncated); a symbol hides the choice, a name documents it. `Int.mod` (floored) is the way. |
| `^` for power | Means XOR to the C/JS audience, power to the math audience — unresolvable; `**` chosen, `^` permanently unused. |
| `+` overloaded for string concatenation | `+` is `Num.add`; joining is `++`/`Concat` (§7). Diagnostic fixit covers the JS habit. |
| Left-associative `**` | Math reads exponent towers right-to-left (§6.3). |
| JS's `-2 ** 2` SyntaxError | Hexagon parses it as `-(2 ** 2)`, the mathematical reading (§6.2); emission parenthesizes. |
| Direction-mixed comparison chains (`a < b > c`) | §5.3; error with split-into-`and` fixit. |
| Chaining `!=` | §5.3; `a != b != c` universally misread as "all distinct." |
| `pow` as a `Num` member | Would obligate every `Num` instance forever; separate `Pow` constraint (§6.3). |
| Perfect-power extraction for `Pow<Rat>` (succeed when an exact root exists) | Rejected permanently, in any spelling — operator or named function. Success would be a number-theoretic property of the base's prime factorization, so meaning-preserving rewrites would move the throw boundary: `(2 * 8) ** (1/2)` succeeds while `2 ** (1/2) * 8 ** (1/2)` throws twice. Algebra must commute with definedness (friendly-numerics tenet 5); the integrality guard is a statable operand predicate, a factorization is not (§6.3). |
| Bitwise operators | No v1 use case at the language level; stdlib functions if ever needed. Symbols stay free. |
| Comparison operators as four primitive members | Superseded by single `Ord.compare` (§5.1): one obligation, derived totality, no double evaluation. |

*(A certain two-character coalescing operator from the early draft was also considered and does not exist.)*

---

## 14. Edit notes to existing specs

### 14.1 Diagnostics owed elsewhere
- **Loops §10.2:** final phrasing for `1..2..3` is "`..` does not chain; a range has exactly two endpoints" (§9).
- **Loops §4:** the `while` condition grammar reference resolves to §11.1 here.

### 14.2 Exceptions spec
- Add **`NegativeExponentError`** to the exception registry (thrown by `Int.pow`/`BigInt.pow` on `y < 0`; the `**` operator reaches it through those instances). Same branding scheme (`$hex` carrying the declaring module per #488, `name` discriminant) as `IndexError`/`DivideByZeroError`. *(#344: its declared home is `stdlib/Pow.hex`.)*
- Add **`FractionalExponentError`** beside it (thrown by `Pow<Rat>`'s member on a non-integer exponent; `**` reaches it through that instance — §6.3). Same branding scheme; declared home `stdlib/Pow.hex`.

### 14.3 Constraints spec §7 (prelude listing)
- Add `Pow<a: Num>` with member `pow(x: a, y: a): a`; instances `Nat`, `Int`, `Float`, `BigInt`, `Rat` (§6.3).
- Add `Concat<a>` with member `concat(x: a, y: a): a`; instance `String` in v1, `List` owed to collections (§7).

### 14.3a Primitive Types — `Int.div`/`Int.mod` convention REOPENED (deep-dive owed before v1)

The floored convention recorded as decided in Primitive Types §2 is **downgraded to leaning**. Euclidean semantics (result always in `[0, |n|)` — Lean 4, Dart, Boute) is now a live contender on math-first grounds; floored (Knuth, Python) remains the other candidate; truncated (JS `%`) remains rejected by both camps. The deep-dive must settle: (a) floored vs Euclidean for `Int.mod`/`Int.div` and `BigInt` mirrors — they differ only when the divisor is negative; (b) whether both families ship under distinct names (Haskell `div`/`mod` + `quot`/`rem`, Elm `modBy`/`remainderBy`); (c) confirmation that no operator spelling returns with the decision (this spec's §13 `%` rejection is *not* reopened — the ambiguity survey is the reason it exists). Until the deep-dive lands, no spec may cite a specific `Int.mod` result on negative operands.
- ~~`Bool` standard constraints must include `Eq` (load-bearing for `iff` — §4.3) alongside `Show`; `Ord Bool` remains that spec's call.~~ **Discharged 2026-07-29, #147:** the fiat constraint list this note targeted (Primitive Types §4) is deleted — `Bool` is now the prelude union `union Bool derives (Eq, Ord, Show, Hash) = False | True` (Unions §8), so the `Eq` instance `iff` needs is carried by the `derives` clause itself, and `Ord` is settled by declaration order. The requirement survives; its address moved.
- §5.3's "string concatenation" of interpolation chunks may now be described as `Concat`-backed conceptually; codegen unchanged (template literals).

### 14.5 Stdlib/DESIGN conventions
- Normative: **first parameter is the subject** across the entire stdlib (§8). One straggler breaks pipes.

---

## 15. Diagnostics checklist

| Situation | Error / fixit |
|---|---|
| `!` in prefix-expression position | "Hexagon spells logical negation `not`" — parser-selected since #355 made `!` the call-mark token (Lexer §8.2/§10; a mark outside its grammatical seats gets Effects §9's mark-position error) |
| `&&` / `\|\|` | lex error: "use `and` / `or`" |
| Non-`Bool` operand to logic ops or `if`/`while` condition | ordinary type error; **never** suggest truthiness or coercion |
| `a < b > c` | "comparison chains cannot mix `<` and `>`; split into `a < b and b > c`" |
| `a != b != c` | "`!=` does not chain; write the pairwise comparisons explicitly" |
| Relational op on a union without `Ord` | "ordering is not defined for union `Shape`" |
| `==` on functions | "functions have no `Eq` instance" |
| `"a" + "b"` | type error + fixit "did you mean `++`?" (mandatory) |
| `intA / intB` | type error + fixit pointing at `Int.div` / `Int.mod` |
| `1..2..3` | "`..` does not chain; a range has exactly two endpoints" |
| Eats-right form in non-final operand position | parse error + "parenthesize the `if` / lambda / `match`" |
| `if` without `then` | parse error + "`if` requires `then`; write `if condition then` before the indented true branch" |
| Else-less `if` whose `then` branch is not `Unit` | type error + fixit "an `if` without `else` produces `Unit`; its `then` branch is `String` — add an `else` branch to produce a value" |
| `x := y := z` | "`:=` does not chain; assignment produces `Unit`" |
| `Int.pow` / `**` at `Int` with negative exponent | runtime `NegativeExponentError` |
| `**` at `Rat` with a non-integer exponent | runtime `FractionalExponentError` (§6.3; message pin `rat.md` §8) |

---

## 16. Decisions log

| Decision | Where |
|---|---|
| Operators are fixed sugar for constraint members; no user operators, no overloading, permanently | §1.1 |
| Words-only logic; `&&`/`\|\|` are lex errors with fixits; prefix-position `!` keeps the `not` redirect, parser-selected (#355 — `!` is the call-mark token) | §1.2 |
| Math-first precedence; small unnumbered-gap table, 1 = tightest, numbers non-load-bearing | §1.3, §3 |
| `not` below comparisons, above `and` (Python/Lean position; draft position rejected) | §3.1 |
| `=>`/`if`/`match` eat to the right; legal bare as final operand, parse error elsewhere | §3.2 |
| `\|>` loosest infix, just above the eats-right family | §3.3 |
| `and`/`or` primitive short-circuit → `&&`/`\|\|`; `implies` = `not a or b`, right-assoc | §4.1 |
| `iff` = Boolean equality (`equals` at `Bool` → `===`); both operands always evaluated; draft short-circuit claim struck | §4.3 |
| Relational four elaborate via single `Ord.compare`; native-operator fast path mandatory for primitives | §5.1 |
| `==` elaborates to `Eq.equals`; `!=` elaborates to defaultable `Eq.notEquals` | §1.1, §5.1 |
| Chains: directionally consistent families {`<`,`<=`,`==`} / {`>`,`>=`,`==`}; `!=` never chains | §5.3 |
| Single-evaluation rule: duplicated operands bound once, left-to-right, invisible temporaries | §5.4 |
| `**` level 2, right-assoc (math); tighter than unary minus on its left, admits it on its right; JS's `-2**2` SyntaxError not adopted, emission parenthesizes | §6.2–6.3 |
| `Pow<a: Num>` constraint includes Nat; `Int`/`BigInt` throw `NegativeExponentError` on negative exponent; `Rat` is exact at integer-valued exponents of either sign and throws `FractionalExponentError` otherwise | §6.3 |
| `++` = `Concat.concat`; level 5 with `+`; `String` in v1, `List` owed; `+` on strings rejected with fixit | §7 |
| Pipe: F# token, ReScript first-arg semantics, pre-inference rewrite; bare `a \|> f` = `f(a)`; subject-first stdlib convention normative | §8 |
| `..` level 6 (looser than arithmetic, tighter than comparison), non-assoc, non-chaining | §9 |
| Postfix `.`/call/`[]` level 1; indexing/slicing semantics deferred to collections spec | §10 |
| Every `if` requires `then`; else-less `if` = sugar for `else ()` (forces `Unit` `then` branch; F# rule, adopted July 2026 reversing the original strict decision); canonical for effect conditionals; canonical multiline form keeps `then` on the condition line and indents branches; condition = bare `Bool` expr, inherited by `while` by reference | §11 |
| `:=` loosest, non-associative, does not chain | §12 |
| `Bool` is a prelude union (#147): §4's operands are union values, `True`/`False` the only spellings; the native logic/condition emissions are licensed by the Unions §6.2 representation pin; `Bool` is the sole exception to Unions §1's match-only elimination | §4.5, §11.1 |

---

## 17. Acceptance tests (golden: parse tree, inferred type, emitted JS)

```
-- (a) Precedence tour
a < b and c or d implies e iff f
--  ((((a < b) and c) or d) implies e) iff f
--  emits: ((a < b && c) || d ? e : true) === f   — implementer may prefer
--         (!( (a<b&&c) || d ) || e) === f; either is acceptable readable JS

-- (b) not below comparisons (the fixed footgun)
not a == b                     -- not (a == b) → emits !(a === b)
not a and not b or c           -- ((not a) and (not b)) or c → (!a && !b) || c

-- (c) Chains: single evaluation, short-circuit, direction rule
1 <= f(x) <= 10                -- let _m = f(x); 1 <= _m and _m <= 10
a < b > c                      -- ERROR: mixed-direction chain (fixit: split)
a != b != c                    -- ERROR: != does not chain

-- (d) iff evaluates both sides, once each
sideA() iff sideB()            -- emits sideA() === sideB(); both effects run

-- (e) implies short-circuits
False implies loop()           -- True; loop() not evaluated → !false || loop()

-- (f) Exponentiation, the math way
2 ** 3 ** 2                    -- 2 ** (3 ** 2) = 512
-2 ** 2                        -- -(2 ** 2) = -4 → emits -(2 ** 2)
2 ** -3                        -- Float: 0.125; Int: NegativeExponentError at runtime
2 ** 10                        -- Int 1024 → emits Int.pow(2, 10)

-- (g) Concatenation
"foo" ++ "bar" ++ s            -- String → emits "foo" + "bar" + s
"a" + "b"                      -- ERROR: String is not Num; did you mean `++`?

-- (h) Pipe, including both => interaction cases
xs |> map(x => x + 1) |> take(3)     -- take(map(xs, x => x + 1), 3)
x |> negate |> show                  -- show(negate(x))
let f = x => x |> g                  -- lambda body is the whole pipe: f = x => g(x)

-- (i) Range precedence
1..n+1                         -- 1..(n + 1)
a*2..b*2                       -- (a * 2)..(b * 2)
1..2..3                        -- ERROR: `..` does not chain

-- (j) if eats right; short inline form
1 + if c then a else b         -- 1 + (if c then a else b) → 1 + (c ? a : b)
if c then a else b + 1         -- else arm is (b + 1)

-- (k) Canonical multiline form
fun clamp(x, lo, hi) =
    if x < lo then
        lo
    else
        if x > hi then
            hi
        else
            x
-- clamp : (Int, Int, Int) -> Int  (at an Int call site)

-- (l) := grammar
total := if c then a else b    -- fine; RHS is the eats-right if
x := y := z                    -- ERROR: `:=` does not chain
```
