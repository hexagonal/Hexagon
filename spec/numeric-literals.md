# Hexagon Spec: Numeric Literals

**Status:** Decided (July 2026); §5.1 amended September 2026 for #808 — the tower is a closed list, the expected-type lift governs every spelling of a tower member call, reaches a dot call's receiver under Method Syntax §2.2's receiver rule, and is binding wherever it lands — a stand-down ends in refusal at every seat, the dot's receiver included (#821); and for #1062 — an expression's arithmetic runs at one home, chosen once for the whole expression (§5.1's expression home).
**Decision:** Roc-style polymorphic integer literals with `Int` defaulting. `1n` is monomorphic `BigInt`. Unsuffixed decimal/exponent literals are `Float`, promoted only where their expression's home is a concrete type other than `Float` (§5.1; #525, #1062); `d` literals are monomorphic `Dec` (`dec.md`).

This document is written for a future implementation session. It assumes the reader knows the existing `hexc` architecture: Algorithm J with union-find mutable type variables, level-based generalisation, constraints compiled to dictionary passing, and `honor` declarations as instance definitions.

---

## 1. Summary of the design

There are four literal forms (Dec is specified in `dec.md`):

| Syntax | Type | Elaboration |
|--------|------|-------------|
| `1`, `42`, `0` | `<a: Num> a` (polymorphic) | `fromNat(1) : α` with pending constraint `Num α` |
| `1n`, `42n` | `BigInt` (monomorphic, always) | the literal itself |
| `5d`, `5.00d` | canonical prelude `Dec` (monomorphic) | exact digits and retained decimal places |
| `1.5`, `0.0`, `1e9` | `Float` (monomorphic), promoted only where the expression's home is a concrete type other than `Float` (§5.1) | the literal itself, or the exact value its digits spell |

Key rules:

1. **Every** integer literal (no `n` or `d` suffix, no decimal point) elaborates uniformly to a call `fromNat(lit)` at a fresh type variable `α`, with constraint `Num α`. There is no syntactic detection of "polymorphic context" — polymorphism or monomorphism is an *inference outcome*, discovered by unification, never a property of the literal's location.
2. `fromNat : Nat -> a` is a method of the `Num` constraint. Every `Num` instance must implement it. It is total and exact for all planned instances (`Nat`, `Int`, `Float`, `BigInt`, `Rat`).
3. **Defaulting:** at generalisation time, any type variable that (a) is still unresolved and (b) carries a constraint set arising *solely from literal elaboration and other defaultable constraints* (see §4) is unified with `Int` instead of being generalised. Literal type variables are therefore **never** generalised. `let x = 1` gives `x : Int`, not `x : <a: Num> a`.
4. `1n` does **not** participate in the polymorphic scheme. The `n` suffix is a type annotation, exactly as in JavaScript. There is no `fromBigInt` method in `Num` (deliberately — see §7, Rejected alternatives).
5. Unsuffixed decimal literals do not participate either: `1.5 : Float`, never polymorphic. Where the literal's expression home (§5.1) is a concrete type other than `Float`, it is promoted there from its written digits; otherwise it is the `Float` it is.
6. **Codegen guarantee:** when `α` resolves to `Int`, `Float`, or `BigInt`, the `fromNat` wrapper is erased and the literal is emitted respectively as `k`, `k.0`, or `kn`. The Float spelling deliberately preserves inferred type intent for a human reader even though `k` and `k.0` are identical JavaScript numbers. Only literals inside genuinely polymorphic (dictionary-taking) functions emit `dict.fromNat(k)`.
7. **Contextual numeric widening:** an established `Nat` may be injected through `Num<a>.fromNat`; an established `Int` may be injected through `Signed<a>.fromInt`; an established `BigInt` may be injected through `FromBigInt<a>.fromBigInt`. The target is the **expression's home** (§5.1, #1062): an expression's tower member calls — an operator, or the same member spelled bare, qualified, as a pipe stage, or by the dot (Method Syntax §1; #808) — its forms that forward a value, and its values that must share a type form one tree, a seat ends it, and its home is the seat's expected type where that is concrete, otherwise the widest type the tree's own values establish — chosen once, for the whole tree, and never a polymorphic target invented to make an expression type-check; at a seat whose type is a variable, the finished value then meets the seat as any value does. Every operation in the tree runs at the home where the home **carries the member's constraint instance**, the operands widening in — at `**`, the base alone; the exponent seat is the member's concrete `Int` parameter and never joins (§5.1, Operators §6.3) — and without the instance, at the home of its own operands (§5.1's instance gate).

---

## 2. Motivating examples (expected behaviour)

These are the acceptance tests for the design.

```
-- (a) Bare literal binding: defaulting fires.
let x = 1            -- x : Int          emits: const x = 1;

-- (b) BigInt literal: monomorphic, no elaboration.
let y = 1n           -- y : BigInt       emits: const y = 1n;

-- (c) Polymorphic function, no literals: ordinary let-polymorphism.
fun plus a b = add a b
                     -- plus : <a: Num> a -> a -> a

-- (d) Literal in a polymorphic body: stays generic via fromNat.
fun addOne x = add x 1
                     -- addOne : <a: Num> a -> a -> a's elaboration:
                     --   addOne x = add x (fromNat 1)
                     -- emits (dictionary style):
                     --   function addOne(dict, x) { return dict.add(x, dict.fromNat(1)); }

-- (e) Literal pinned by unification: fromNat erased.
fun halve x = Float.divide x 2
                     -- 2 elaborates to fromNat(2) : α, Num α
                     -- Float.divide forces α := Float
                     -- emits: function halve(x) { return x / 2.0; }
                     -- (the emitted 2 is Float's fromNat applied at compile time — see §5)

-- (f) Mixed constraints, still defaultable.
let s = toString (add 1 2)
                     -- α carries {Num α, Show α}; α unresolved at generalisation;
                     -- both constraints are defaultable ⇒ α := Int ⇒ s : String
                     -- emits: const s = Int.toString(1 + 2)  (or the folded "3", see §5)

-- (g) BigInt suffix is monomorphic; widening still needs an exact destination.
fun f x = add x 1n   -- f : BigInt -> BigInt   (1n pins the tyvar to BigInt)
add 1.5 1n           -- TYPE ERROR: Float has no FromBigInt instance.

-- (h) Explicit conversion is the escape hatch.
Rat.fromBigInt 123456789012345678901n   -- big literal into a Rat: explicit, honest

-- (i) BigInt parameter positions pin bare literals.
Rat.create(1, 3)                        -- emits: Rat.create(1n, 3n)

-- (j) An established Int widens into an independently established Signed target.
let count: Int = 3
let cost: Float = 1.50
let total = count * cost                -- Float.fromInt(count) * cost : Float

-- (k) A written face is the arithmetic's home: the operation runs at the annotated type.
let exact: Rat = count + count          -- Rat addition of two injected Ints (§5.1's lift)
let mean: Float = count / 2             -- Frac<Float> division; Int alone has no Frac
```

**BigInt spelling convention.** The `n` suffix is idiomatic when no surrounding
context pins the type (`let y = 1n`), where it is the cheapest annotation, and is
mandatory when the payload exceeds the bare-literal safe range. In an already
`BigInt`-typed position, bare digits are preferred: `Rat.create(1, 3)`. Thus examples
(h) and (i) demonstrate both halves of the convention side by side.

---

## 3. Elaboration (during inference, Algorithm J)

When the inferencer reaches an integer literal `k` (lexed token: digits, no `.`, no `n` or `d`, no exponent):

1. Allocate a fresh type variable `α` at the current level.
2. Record the constraint `Num α`, tagged with provenance `LiteralConstraint(span, k)`. Provenance is load-bearing: it is used both for defaulting eligibility (§4) and for error messages (§6).
3. The elaborated term is `App(NumMethod("fromNat", α), NatLit(k))` — i.e. the literal node in the typed AST is *already* a `fromNat` call. Do not keep a separate "maybe-polymorphic literal" node that gets rewritten later; there is exactly one representation, and the "monomorphic case" is an *optimisation on resolved types* (§5), not a different elaboration.

The literal's payload `k` is validated at lex time: it must be an exact non-negative f64 integer, i.e. `0 <= k <= 2^53 - 1`. In expression position, a bare literal outside that range is a **compile error** with a fixit suggesting the `n` suffix ("integer literal exceeds Int range; write `...n` for a BigInt, or use an explicit conversion"). Rationale: the payload is a `Nat` within the shared safe-integer range by construction, so `fromNat` never receives a value an instance cannot represent, and every instance's `fromNat` stays total *and exact*. Negative source forms remain unary `negate` applied to a non-negative literal payload. In pattern position, the range check still applies, but the repair is selected with the position's type: suggest `n` only at `BigInt`, otherwise report the range error without a replacement or conversion suggestion (Pattern Matching §2.5, #898). An invalid recovery token preserves the surrounding syntax; it never becomes a valid literal or supplies numeric inference. A literal `extern enum` member is not an expression position: its grammar excludes BigInt and conversions (Foreign Enums §2.4), so an oversized integer there receives the range error without either suggestion; recovery must not round it into a valid foreign value.

`1n` literals: elaborate directly to `BigIntLit(k)` with type `BigInt`. No type variable, no constraint. Payload is arbitrary precision (store as string or JS bigint in the AST).

Unsuffixed decimal literals: elaborate directly to `FloatLit`, type `Float`. No type variable and no constraint: a decimal literal is never polymorphic (§7). Where the literal's expression home (§5.1) is a concrete type other than `Float`, it is **promoted** there, carrying its written digits — never the parsed double, whose exact binary value is not what a writer of `0.1` means (friendly-numerics tenet 7).

### Interaction with the existing pipeline

- Constraint recording uses the same machinery as constraints introduced by calls to `Num`-constrained functions. Nothing new in `unify`. The four cases of `unify` are untouched.
- Levels: `α` is allocated at the current level like any other tyvar, so it participates in level-based generalisation checks normally. The defaulting rule (§4) runs *inside* the generalisation step, before the "escapes-current-level ⇒ generalise" decision.
- Value restriction / `var` rule: unaffected. Defaulting makes literal tyvars monomorphic, which is strictly *more* conservative than generalisation, so `var x = 1` (had it been at risk) simply gets `x : Int`, which is what the `var`-no-generalisation rule wanted anyway.

---

Dec literals carry exact written digits and a decimal-place count, never a Float
intermediate. Their type is the canonical prelude Dec nominal declaration, with
no lookup of a possibly shadowing surface name. `dec.md` §3 owns lowering,
retained places, negative forms, and literal-pattern equality; Lexer §5 owns
the grammar. They do not participate in bare-integer defaulting.

## 4. Defaulting rule

Run at generalisation time, per binding group, immediately before quantification:

> For each type variable `α` that would otherwise be quantified: if `α`'s constraint set is non-empty and every constraint on `α` is **defaultable**, unify `α := Int` (this must succeed by construction, since all defaultable constraints have an `Int` instance — assert this). Otherwise leave `α` to the ordinary generalisation path.

**Defaultable constraints (v1.1, closed list):** `Num`, `Signed`, `Eq`, `Ord`, `Show`. All five have `Int` instances in the prelude. The list is a hard-coded set in the compiler, not user-extensible. Maximally dumb on purpose: "unresolved literal var ⇒ Int, always, no negotiation." Do not import Haskell's numeric-defaulting machinery (multiple candidate types, module-local `default` declarations, the interaction with user classes); that machinery is one of Haskell's most complained-about corners, and Hexagon's rule avoids it by having exactly one candidate type and a closed constraint list.

Consequences worth asserting in tests:

- A tyvar with `{Num α}` only: defaults. (`let x = 1`)
- A tyvar with `{Num α, Show α}`: defaults. (`toString (add 1 2)`)
- A tyvar with `{Num α, SomeUserConstraint α}`: does **not** default; proceeds to ordinary generalisation if the binding form allows it, or produces an ambiguity error if it doesn't. Error message should name the non-defaultable constraint (§6).
- A tyvar with an empty constraint set: never defaults (it's not a literal var; ordinary generalisation applies).
- Defaulting is per-tyvar, not per-binding: `let pair = (1, 1.5)` defaults the first component's tyvar to `Int` independently; the `1.5` was never polymorphic.
- A **declared** type variable: never defaults — at a function binding it quantifies (`fun zero<t: Num>(): t = 0` is `<t: Num>() -> t`), and anywhere else it is left as it is.
- The **expression home** (§5.1, #1062) is not a defaulting rule and adds no candidate. It fixes a type only inside the one expression tree it is chosen for, from the seat's expected type or from a type the tree's own values establish; it never proposes a type for a variable nothing in the tree established, never outlives the tree, and leaves an integer literal whose tree establishes nothing to this rule at its binding. A decimal literal in a tree with no exact home is `Float` because a decimal literal is a `Float` (§1), not by a second candidate — ruling out the second candidate is what §7's rejection of polymorphic decimal literals keeps.

**Declared type variables** *(#1042)*. The rule is for variables inference introduced. A type variable the program *declared* — on a binder, in an annotation, or in an ascription — is the author's statement of polymorphism, and where the binding's one evaluated value is a function (Functions §8 item 2's evidence seat) that statement is representable: the variable is quantified with its constraints, and a caller chooses it. So defaulting never proposes `Int` for it, and a declared variable occurring only in a function's result — `fun widen<t: Num>(value: Nat): t = value` — is an ordinary polymorphic result. A use that supplies no type defaults at *its own* binding: `let z = zero()` is `Int`, exactly as `let z = 0` is. At a non-function value binding there is no seat, so the rule applies unchanged and rigidity refuses the proposal: `let x: a = 42` is refused (Functions §10's forced-to-a-concrete-type row; Ascription §5 words the ascription spelling). An expansive binding's declared variables are Functions §8 item 7's to decide, never this rule's. And nowhere else does this rule propose `Int` for a declared variable *(#704)*, as GHC never defaults a signature's variable: one that reaches the end of its module unquantified is a recursive knot's survivor, whose knot has already refused (Functions §10's fence — a refusal never surfaces a type the body did not demand), or one no declaration can carry, which Functions §10's unmentioned-variable and evidence rows refuse. Only a declared variable at a binding with no evidence seat — annotated (`let x: a = 42`, `let p: ((a) -> a, Int) = …`), ascribed (`let n = (42 : a)`), or escaped into one — still meets the proposal, and rigidity refuses it there.

Note the closed list means a literal used *only* under a user-defined constraint keeps `Num` in its set too (elaboration always adds `Num`), so the "solely defaultable" test correctly fails on the user constraint, not on `Num`.

> **Ordering note (#304).** Within the boundary this rule runs at, defaulting precedes Method Syntax §3.5's row fallback: a pending `DotCall` goal whose receiver settles here re-fires its head-known trigger and resolves as dispatch — `42.show()` means `Show`'s member at `Int`, exactly as bare `show(42)` does. Method Syntax §3.3/§3.5 own the sequencing; nothing about *this* rule's test or its closed list changes, and the ordering reclassifies only programs that were guaranteed errors before it (the fallback row meets the receiver's defaultable constraints, which no row can discharge).

> **Correction (2026-07-28, #135).** The v1.1 list above was a snapshot of a property, not the rule. The rule: **a constraint is defaultable exactly when its `Int` instance ships with the compiler** — membership in the builtin instance table, closed against user code. A user `honor C<Int>` never makes `C` defaultable (§7's rejection of extensible defaulting, unchanged); the set grows only when the language itself adds a prelude constraint whose `Int` instance the compiler supplies. As of this correction the set is `Num`, `Signed`, `Eq`, `Ord`, `Show`, `Pow`, `Hash`, `Integral`. The last three postdate this document, and Integral §8's diagnostics row — a bare `gcd(4, 6)` resolves to `Int` "as usual" — already depended on this reading; taking the five-name list literally would turn that row into an ambiguity error, which is how the drift surfaced (#109, then #135). This document now stops enumerating: a future prelude constraint with a compiler-shipped `Int` instance joins the set by the rule, with no amendment here. The rule box's parenthetical assertion is unchanged and has become the definition — the unification with `Int` succeeds by construction because membership *means* "has a compiler-shipped `Int` instance". Everything else in this section stands, including the guard note directly above: a user constraint still blocks defaulting, and still fails the "solely defaultable" test on itself rather than on `Num`.
>
> *(#344 — where the `Int` instances live moved; the rule did not.)* "Membership in the builtin instance table" now reads: **a pre-registered constraint whose `Int` instance the prelude supplies** — a wired row while `Int` was compiler-wired, the source `honor` block in `stdlib/Int.hex` since its companion milestone. The set is unchanged by the move, and "closed against user code" is now structural rather than merely decreed: the orphan rule (Constraints §5.3, with the companion as `Int`'s home module) leaves no site where user source could legally honor a pre-registered constraint at `Int`, so consulting the instance table for the membership test can no longer see anything user-supplied.

---

## 5. Codegen

### 5.1 Contextual widening of Nat, Int, and BigInt expressions

The checker admits three exact, evidence-directed contextual conversions. The
`FromBigInt` capability and its laws are owned by `integer-widening.md`:

```text
Γ ⊢ expression : Nat    Γ ⊢ Num<target>    target is independently established
───────────────────────────────────────────────────────────────────────────────
Γ ⊢ expression ⇑ target    elaborates as Num<target>.fromNat(expression)

Γ ⊢ expression : Int    Γ ⊢ Signed<target>    target is independently established
──────────────────────────────────────────────────────────────────────────────────
Γ ⊢ expression ⇑ target    elaborates as Signed<target>.fromInt(expression)

Γ ⊢ expression : BigInt    Γ ⊢ FromBigInt<target>    target is independently established
───────────────────────────────────────────────────────────────────────────────────────
Γ ⊢ expression ⇑ target    elaborates as FromBigInt<target>.fromBigInt(expression)
```

“Independently established” means that the target is the **expression's home** (below):
the expected type at the tree's seat — an annotation, a parameter's type, an assignment
boundary — or a type one of the tree's values establishes — a concrete operand or
argument, a branch or arm, an already-constrained type variable — a declared one included, where the body being checked can name it: one its own
declaration or an enclosing one declares, unshadowed, never a variable another member of its
knot declared (Functions §7.4 shares the members' types, not their evidence). The widening
is then a demand like any other, and its evidence must reach the body as every demand's must
(Functions §7.4's evidence bullet): a block head's variable, in a member whose type does not
mention it, is refused there. A self-recursive call's argument and an `honor` binder are not
yet delivered (#1045). An expectation is a target only as a tree's home: inside a tree it
establishes nothing of its own (Functions §4.3's ordering pin). The target is never a fresh
inference variable whose only reason to acquire `Num` would be the proposed conversion.
The substitution these tests read is the one Functions §4.3's normative elaboration
schedule built, read once per tree when its last part is in (below): within a tree the order of the
parts never decides the choice of home, though what a part received at its own turn — an
expectation the schedule had solved by then — is the schedule's residue; and across trees
the schedule is the semantics — two programs differing only in the order of sibling
expressions in different trees that share an undetermined variable may widen differently,
by design (Functions §4.3's ordering pin).

**One expression, one home** *(#1062)*. An expression's arithmetic runs at one type,
chosen once for the whole expression — never operation by operation from the inside out.

- **The tree.** An expression's **tower member calls** (below; in every spelling, a dot
  call as Method Syntax §2.2 bounds it) and its **forwarding forms** (Functions §4.3:
  grouping, a block's final expression, both branches of `if`, a `try`'s body block, and
  every arm body of `match` and `try`, catch arms included) are the **interior** of one
  tree; their subject operands and value paths are its **parts**. Two groups of parts
  share a tree with no interior node joining them: the non-lambda arguments of one call
  at the seats its callee's signature writes as one type variable (the callee's type
  known when the call is checked, Functions §4.3 — a comparison is such a call, `Eq` and
  `Ord` members sharing their subject), and the elements of one vector literal. Any
  other call is never interior: its result is a value of the tree it sits in, so a home
  never travels through a function's type. Every expression in a part that is not
  itself interior is a **value** — a variable, a literal, a field, a call's result, an
  ascription.
- **Seats end it.** An expression at a seat is the root of a tree of its own: a
  binding's right-hand side, an argument other than a sibling above, an ascription's
  expression, a lambda's body, an assignment's right-hand side, a tuple component, a
  record field, `**`'s exponent seat and a shift's count (each faced by its written
  `Int`), a condition, a scrutinee, a guard, a block's non-final item — and a dot call's
  receiver, which closes before the dot resolves, since the dot must know what its
  receiver is to know what it calls: it takes from outside only its own seat's expected
  type, as Method Syntax §2.2's receiver rule forwards it, and never the home of the tree
  around it. A non-lambda argument at a seat its callee's signature writes as a bare
  type variable is a sibling group of one where no other argument shares the variable,
  and closes with the call's other siblings.
- **The home.** Where the seat's expected type is **concrete** — it contains no type
  variable — when the tree's last part is in, it is the home: the expected-type lift
  below. The seats that supply one are an annotated binding, an ascription, a parameter's
  type, a lambda's landed result component, the `:=` right-hand side (whose expected type
  is the `var`'s), and whatever a forwarding form hands on (Functions §4.3). A seat whose
  type is a type variable supplies no home: the tree's home is chosen from its values,
  and its finished value then meets the seat as any value does — by exact unification or
  one of the three conversions, a declared variable the body can name being an
  established target (`fun widen<t: Num>(value: Nat): t = value`). Otherwise the home is
  chosen from the types the tree's values **establish**: concrete types; declared type
  variables the body can name; and an inference variable that, when the home is chosen,
  already carries — directly or through a constraint's bases — the evidence every
  fixed-integer value of the tree needs to enter it — `Num` for a `Nat`, `Signed` for an
  `Int`, `FromBigInt` for a `BigInt` — where the tree has such a value and no
  decimal-point literal; two such variables unify with one another, and the result is
  the candidate. That evidence comes from outside the tree
  or from a value's own elaboration, never from the tree's own operations. Any other
  inference variable establishes nothing, and unifies with the home. The choice runs by
  rank: an established concrete type other than `Nat`, `Int`, and `BigInt`, or a declared
  variable the body can name (`scale<a: Signed>(count: Int, value: a): a = count *
  value`); else a constrained inference variable; else the widest established of
  `BigInt`, `Int`, and `Nat` — unless a decimal-point literal is among the values, when
  the home is `Float`. A tree whose values establish two different types of
  the first rank is **conflicting**, and is refused at the second of them in source
  order. A tree whose values establish nothing is **open**: a
  decimal-point literal among them makes its home `Float`, and otherwise its values unify
  with one another exactly, as ever — integer literals then defaulting at their binding
  (§4). A tree none of whose values is numeric keeps ordinary unification in source order
  and ordinary reports.
- **Entry.** Every value reaches the home by exact unification, by the three conversions
  above, or — a decimal-point literal at a concrete home other than `Float` — by
  promotion (below), each converted once. The entry evidence is required after the home
  is chosen, never consulted to choose it. A value that reaches it by none of these
  refuses the tree, and so does a conflicting tree; the report names the value, its
  type, the home, and what gave the home (§6). Nothing in a tree enters anything but its
  home, except within a gated call (below).
- **Closing.** Every forwarding form takes the home as its type, and a sibling seat whose
  variable is still an unsolved inference variable takes the home as its solution; where
  the variable is, or has been solved to, a declared variable, each sibling meets it as a
  value meets any variable seat (`accept(value)` at `accept(item: t): t`), and where it
  has been solved to a concrete type, that type is the siblings' home. Every interior tower member call runs at the home
  where the home carries the call's constraint instance; otherwise — the **instance
  gate** — it runs at the home its own parts select by this same rule, its parts and the
  forms among them closing there, and its result enters the enclosing home as a value:
  `(n band 3) * f` (`f : Float`) runs the `band` at `Int` and the multiplication at
  `Float`. Every value votes in the enclosing choice, a gated call's included; a gated
  call whose own home lacks the instance too is the missing-instance refusal (Method
  Syntax §9 row 15).
- **Once.** The parts elaborate on Functions §4.3's normative schedule, and the home is
  chosen when the last part is in — for siblings at a call, after the call's last
  non-lambda argument and before its first lambda-literal argument, so a callback reads
  the home settled; a callback's written parameter and result types count among the
  first pass, its body never (Functions §4.3); trees that close at one moment close in
  source order. The choice
  reads the parts' types as a set, so the order of the parts never decides the home —
  what a part received at its own turn is the schedule's residue (below) — and it is
  never revisited: no part elaborates twice, and nothing is re-typed after the choice.

```hexagon
let n: Int = 3
let m: Nat = 2
let price: Dec = 2.50d

n * 1.5 * price                       // Dec: the tree's values are n, 1.5, and price
(n + 0.5) * price                     // Dec
(if c then n else 0.5) * price        // Dec: both branches are parts
price < n * 1.5                       // a Dec comparison: <'s operands are siblings
[m, n, price]                         // Vector(Dec), in any element order
let fee: Dec = if c then n else 0.5   // Dec: the seat's type is the home
n * 1.5                               // Float: nothing in the tree is exact
let y = n * 1.5                       // y : Float, for good — the binding ends the tree
y * price                             // refused: y is an established Float (tenet 7)
id(n * 1.5) * price                   // refused: id's result is a value, already Float
(n * 1.5).multiply(price)             // refused: the receiver closed at Float before the dot
price.multiply(n * 1.5)               // Dec: the argument is the receiver's sibling
```

The reason is the order it removes. Typed from the inside out, an operation settles its
type before the operation around it is seen. For integers that is harmless — an `Int`
result still widens exactly afterwards — but a decimal-point literal would pull its
operation to `Float`, and no value leaves `Float` for an exact type, so `n * 1.5 * price`
would be refused where `price * n * 1.5` compiles. The home is the expression's, not the
first operation's to settle.

It moves programs that operation-by-operation typing accepts, in three ways. An
operation runs at the wider home: `n * m * price` (`n, m : Int`) runs its first
multiplication at `Dec` rather than at `Int` with the product injected — equal wherever
the `Int` product is exact, and exact where it is not, which is the lift's own reason
(below). An unannotated variable takes its tree's home: in `fun ff(x) = x + m + n` (`m :
Nat`, `n : Int`), `x` is an `Int`, so `ff : (Int) -> Int`, and a later `useNat(x)` is
refused. And a type's partiality follows the home: `(i ** k) * f` (`f : Float`) runs the
power at `Float`, whose `pow` is total, so a negative `k` yields a reciprocal rather than
`Pow<Int>`'s `NegativeExponentError` — the move a written face makes (Method Syntax
§2.2).

The home is no second default and no search. Every candidate is an exact embedding of the
same values (friendly-numerics tenet 1), so the choice decides how exact the answer is and
which type's partiality applies, never which operation runs. It never outlives its tree
and never enters a binding, a type variable, or another tree. And no interpretation is
chosen between: the tree's shape — which calls are tower member calls, which seats share
a written variable, where the seats are — is fixed before any home is, and inferred types
choose only the home within it (friendly-numerics §4). Within a tree, the choice reads
the parts' types as a set; an expectation a part received at its own turn — a sibling
argument's parameter, solved by the schedule before it — is Functions §4.3's schedule
residue, and so is a dot receiver's (Method Syntax §2.2).

**Source ordering (exact BigInt extension).** Sibling arguments at one type variable
are one tree (above), so no leading source argument pins the shared parameter before
a later argument can establish its target — `Nat`, `Int`, and `BigInt` alike.
Common-home selection is by rank — an independently established non-Nat/Int/BigInt
numeric target, then BigInt, then Int, then Nat — and preserves an already established
expected home; entry then requires the actual conversion evidence, or refuses. Thus
BigInt/Rat comparisons work in either operand order, while BigInt/Float remains
refused. No third target is guessed and no general conversion-chain search occurs.
Generic targets need existing `FromBigInt` evidence; `Signed` alone is insufficient.
Monomorphic BigInt literals can widen in expression seats, but literal patterns
still require their exact type. See `integer-widening.md` §§4–6.

**Decimal-point literal promotion** *(#525)*. An unsuffixed decimal-point or
exponent literal is a `Float` (§3). It is the one `Float` that may meet an
exact target: where the literal's expression home (above) is a concrete type
other than `Float`, the literal takes it. Write its digits, separators removed, as `c × 10^(e − s)`:
`c` the digits with the point removed, `s` the count of digits after the point,
and `e` the written exponent (zero when there is none).

```text
ℓ : Float, a decimal-point literal with no exponent    target is the canonical Dec
────────────────────────────────────────────────────────────────────────────────
ℓ ⇑ Dec    elaborates as the `d` literal of the same digits: coefficient c, s places

ℓ : Float, a decimal-point literal    Γ ⊢ Frac<target>    Γ ⊢ FromBigInt<target>
target is concrete and is not Float
────────────────────────────────────────────────────────────────────────────────
ℓ ⇑ target    elaborates as Frac<target>.divide(fromBigInt(c), fromBigInt(10^(s − e)))
              or, where e ≥ s, as fromBigInt(c × 10^(e − s))
```

- **The written digits, never the double.** `let r: Rat = 0.1` is exactly
  `1/10`; `let x: Dec = 0.10` is `0.10` with two places.
- **A literal, never a result.** An established `Float` — a binding, a call's
  result, an operation that ran at `Float` — never reaches an exact type
  (friendly-numerics tenet 7). A promoted literal is a value of its tree, never
  a result: no operation is a literal.
- **A concrete home, never a variable.** At a type variable, declared or
  inferred, the literal stays `Float`, and a tree whose home is a declared variable
  refuses it. No literal's type is decided anywhere a
  reader cannot see, and no second defaulting candidate exists (§4, §7).
- **`Dec` by identity; every other target by what it honors.** `Dec` honors no
  `Frac`, so it is named: the canonical prelude declaration, as for `d`
  literals, whatever a module shadows. Any other target qualifies by honoring
  `Frac` and `FromBigInt` — `Rat`, and a user type that joins the tower as `Rat`
  did — and reaches the written value through its own exact injection and its
  own division, which is honest for that type: exact at `Rat`, rounded at a type
  whose division rounds.
- **Exponents.** At `Dec` an exponent is refused, because a `Dec` literal shows
  its decimal places (`dec.md` §3); the refusal spells the value in ordinary
  notation. At a `Frac` target an exponent hides nothing and is accepted:
  `let r: Rat = 1e-9` is `1/1000000000`.
- **Anywhere in the tree.** The literal's home is its whole tree's, so a decimal
  literal never settles its part of an expression at `Float` before the rest is in:
  `n * 1.5 * price` is `Dec` multiplication throughout, `(0.5 + 0.25) * price`
  promotes both literals, and `(if waived then n else 0.5) * price` promotes the
  branch. A negated literal promotes as one literal, its sign folded into the value.
  A tree with no exact home is `Float` wherever it holds a decimal-point literal:
  `n * 1.5` is `Float`, and so, for good, is `let y = n * 1.5`.
- **The tree's reach, and no further.** Among a call's arguments at one type
  variable the literal is a sibling of the others, so `Num.add(0.5, price)`,
  `price < n * 1.5`, and `h(n * 1.5, price)` at `h<t: Num>(x: t, y: t): t` meet at
  `Dec`, and the siblings' home is chosen before any lambda-literal argument is
  checked — `xs.fold(0.0, (acc, x) => acc + x)` checks its callback at `Float`. A type
  written around a container — a tuple, a record, a vector, a constructor
  application — reaches none of its components (#1066), so a literal there with no
  exact value beside it stays `Float`, as an established `Int` there stays `Int`. A
  literal whose exponent would scale it by more than 10,000 powers of ten is refused
  rather than read.
- **Not in patterns.** A literal pattern keeps Pattern Matching §2.5's exact-type
  rule; at a `Dec` scrutinee the refusal names the `d` spelling (#1054).

**The tower** *(#808)*. The tower is the closed family of constraints whose members this
section's conversions and lift serve: `Num`, `Signed`, `Frac`, `Pow`, `Integral`, and
`Bitwise` — the prelude's rungs, and no others. `Bitwise` is the one rung not rooted in
`Num` (`bitwise.md` §5.1): its members are integer algebra rather than arithmetic, and
they join so that integers meet at the wider home under `band` exactly as under `+`. `Num.fromNat` and `Signed.fromInt` own the smaller-integer conversions;
`FromBigInt.fromBigInt` supplies the third exact-source route as a conversion
capability, not an additional tower rung. A type's widenings are exactly the
capability slots it fills. `Frac` owns no conversion from `Rat` (`Float` honors `Frac`), which is friendly-numerics tenet
7's membrane stated as a missing member. `Eq` and `Ord` are not rungs: a comparison across
widths (`i < b`, `i.compare(b)`) widens because the member's seats are widening targets
like any seat, not through the lift. **The rungs are the language's own and the list is
closed.** A type — `Rat`, or a user's `Decimal` — joins the tower by honoring the rungs
lawfully (below), never by adding one; a user constraint bounded on `Num` is an ordinary
constraint outside the tower, served by the ordinary seat widening and nothing more. The
closure is what keeps Method Syntax §4.2's ownership clause finite — a collision at the
source types is then always an author's own honoring, never the existence of a constraint
elsewhere — and the tower's behaviour statable in one paragraph; a new rung is a design
ruling on the footing of a new prelude bare name (Modules §5.5). A **tower member call**
is a call of a subject-first member of a rung whose result type is the subject, in
whatever spelling — operator, bare, qualified, pipe stage, or dot; the operators are its
everyday spellings and elaborate to nothing else (Operators §1.1). The tower member
**spellings** — the names that can spell such a call — are exactly `add` and `multiply`
(`Num`), `subtract` and `negate` (`Signed`), `divide` (`Frac`), `pow` (`Pow`), and `div`,
`mod`, `quot`, `rem`, and `gcd` (`Integral`), and `bitAnd`, `bitOr`, `bitXor`, `bitNot`,
`shiftLeft`, and `shiftRight` (`Bitwise`); this list, and each spelling's rung, is what
Method Syntax §2.2's receiver rule reads.

**The expected-type lift — the written type is the arithmetic's home.** At a tower member
call — the `Num`/`Signed`/`Frac`/`Pow` operators, unary negation included; the member
spelled bare, qualified through its constraint, as a pipe stage, or by the dot (Method
Syntax §1, §7), a companion-qualified spelling being a written face, below; `Integral`'s
`div`, `mod`, `quot`, `rem`, and `gcd` included, though no operator spells them *(#808)*;
the `Bitwise` words and members included, a shift's count being its concrete `Int`
parameter as `**`'s exponent is —
whose expected type is **concrete** and carries the member's constraint instance, the
expected type **is** the operation's common type — the tree's home (above): each value
reaches it by exact unification, by the three conversions above, or — a decimal-point
literal — by promotion, and the operation's evidence is selected at it. Where a value can
reach it by none of these — a `Float` under a `Rat` face, a user type under `BigInt` — the
lift **stands down** at every tower member call whose parts hold that value, and the tree
is refused: the report is given where the tree's result meets its seat (`let total: Rat =
count * price` is refused at the binding rather than at the operation), naming the value
that declined the face — the first in source order where several do, a declared type
variable declining like any established type (no conversion takes it into a concrete face)
and, where it is first, reported in its own words at the value — and the tower member call
it is an operand of: "`price` is a `Float` and cannot enter `Rat`, so the
multiplication could not run at `Rat`" (§6). A call with one subject operand — a
negation, `bnot`, `**`'s base — stands down as a binary one does, and nothing else in the
tree reports: a form joins without a word, except where it is a dot call's receiver
(Operators §11's report, Method Syntax §2.2), and a tree holding a value already refused —
an unknown name — says nothing more. For the report alone, a stood-down call's
**kept type** is the home its own parts select by the rule above, read off their recorded
types — what Method Syntax §9 row 16's fixit ascribes, where that ascription compiles; it
decides no verdict, and no evidence is selected at it: `let x: Rat = p / q`, at a `Foo`
honoring no `Frac`, is refused for `p` alone, never for the `Frac` `Foo` lacks. A stand-down
therefore always ends in refusal, at every seat, by construction: a home is never given
up for another. The dot's
receiver is such a seat *(#821)*: the forwarded face is the receiver's expectation (Method
Syntax §2.2's receiver rule), and a receiver holding a stand-down — at its own outermost
operation, or at one a forwarding form handed the face to — is refused: at the stood-down call where the dot's claimant lies outside the spelling's rung,
at the enclosing seat where it is the rung's own member, never accepted at the type it
kept — `let n: BigInt = p.add(q).gcd(s)` at a user companion export is refused with the
three-fact report (§6; Method Syntax §9 row 16) and accepted as `(p.add(q): Foo).gcd(s)`,
the ascription being the boundary. A stand-down that could succeed would make the receiver
the one seat where the order in which the face descends into nested operands is meaning;
refusing keeps that order invisible in every verdict (Method Syntax §16.3). The
expectation reaches operands recursively — an operand seat of a lifted operation expects
the same type, a dot call's receiver included under Method Syntax §2.2's receiver rule,
which hands it the call's expectation before it elaborates when the spelling's rung is
honored at the face — so a whole arithmetic expression runs at its written type in every
spelling, `(a + b).multiply(c)` and `a.add(b).multiply(c)` as much as `(a + b) * c`. At
`**` the common type governs the **base seat only**: the exponent seat is the member's
concrete `Int` parameter (Operators §6.3), an ordinary written-`Int` seat that neither
joins the common type nor receives the outer expectation — this rule applies *into* it
independently, with `Int` as the written face, which is how the right spine of an exponent
tower runs at `Int` whatever the base's home. An expectation that is a variable is no
home: the tree's home is chosen from its values, and the finished value meets the seat as
any value does (above). A concrete face without an
operation's instance is still the tree's home, and that operation alone runs at the home
of its own parts (the instance gate, above). The distinction the lift turns on: widening a **value**
is always exact, but which *algebra an operation runs in* decides what the value is — and
the lift decides it for the written face.

```hexagon
let r: Rat = count + count    // Rat addition of two injected Ints — exact at any magnitude
let r: Rat = 1 + 2            // Rat addition already — literals are polymorphic, nothing to lift
let x: Int = n - m            // n, m : Nat — both widen; Signed<Int> subtraction, possibly negative
let mean: Float = sum / size  // sum, size : Int — Frac<Float> division; Int has no Frac and needs none here
let s = count + count         // no written face: Int addition, as ever
let whole: BigInt = count.add(count)    // the same lift, spelled by the dot — BigInt addition
let next: BigInt = count |> Num.add(1)  // and as a pipe stage — never Int addition injected after
```

A **companion**-qualified spelling of a member (`Float.multiply`, `Int.multiply`) is not a
further spelling of the open call but a **written face** of it (Modules §5.3's migration
principle keeps `Int.multiply` substitutable for a plain `Int.multiply(a: Int, b: Int):
Int`): operands widen *into* it and it lifts nothing beyond itself — `Float.multiply(count,
price)` runs at `Float`; `Int.multiply(count, price)` refuses, exactly as `let t: Int =
count * price` does.

The first line is the rule's reason. Without the lift, `count + count` runs at `Int` and
only the finished sum is injected — an exact conversion of a sum the silent-overflow
`Int` addition may already have folded past 2^53. The lift closes the asymmetry between
the first two lines: an established value follows the written face exactly as a literal
does. The third and fourth lines are the lift's own acceptances — an operation whose
operand types alone support no instance (`Nat` has no `Signed`, `Int` no `Frac`) is
well-typed exactly when a written face names an algebra that embeds them. The last line
is its boundary: a binding without an annotation has no written face, and arithmetic
happens at the type written on *its own* seat, never one written somewhere later — `let s
= count + count` then `let r: Rat = s` widens the finished `Int` value, exactly as
written. Said without faces: the *lift* works within one expression — an expected type
travels to a subexpression through the forms Functions §4.3 forwards through, and at a
tower member call the operand seats are the lift's own channel, the one §4.3 names as not
forwarding; a seat's own expected type establishes the target directly, per the list
above — and what stops it is a binding: a separate binding is a separate expression,
which has whatever type the first was given; its value still widens at its own seat, as
`let r: BigInt = s` shows, but its arithmetic has already run. The instance gate is
equally a boundary: at `let t: T = a ** b` (`a, b : Int`) for a nominal `T` honoring
`Num` and `Signed` but not `Pow`, the power runs at the home of its own parts, `Int`, and
the finished value injects, exactly as this section always read — where a stand-down, by
contrast, refuses. Under the arithmetic operators, the gate's remaining subjects are exactly such user
nominals: since `Rat` honors `Pow` (Operators §6.3), every tower face reachable by
injection carries the constraint of every operator whose operand elaboration can land at
`Nat` or `Int` — `+`, `-`, `*`, `**`, unary negation — so no in-tower written face is
ever gated out of those operators: a tower face either lifts or (where the operand
elaboration itself has no instance, as at `Int` division) refuses. The bitwise operators
are the exception by design: only `Int`, `BigInt`, and a type a program honors `Bitwise`
at carry the instance, so under a `Float`, `Rat`, or `Dec` face the operation runs at its
operands' home and the finished value injects, as at any gate. Consequences:

```hexagon
count + count       // Int; no written face, exact match, no widening
count * cost        // Float when cost : Float — the operand establishes the target
plus(count, 1.5)    // Float; selects the Float instantiation of plus
let value: Rat = count        // value widening at the annotation — exact for any Int

let scale<a: Signed>(count: Int, value: a): a = count * value
// generic body: num.multiply(fromInt(count), value), using one Signed<a> dictionary

let repeat<a: Num>(count: Nat, value: a): a = count * value
// generic body: multiply(fromNat(count), value), using Num<a> evidence

let addCount = (count: Int, value) => count + value
// inferred (Int, Int) -> Int; widening does not manufacture Num<a>
```

The source must be exactly `Nat`, `Int`, or `BigInt`, and the matching rule above is fixed. In
particular, `Int * Nat` widens the `Nat` to `Int`; it never attempts the unsafe
`Int -> Nat` direction. There is no reverse `Float -> Int` conversion, no implicit
`BigInt -> Float`, and no conversion between two unrelated numeric subjects.
A nominal target participates only when its home has explicitly supplied a lawful
`honor Num<T>`, for Int widening `honor Signed<T>`, or for BigInt widening
`honor FromBigInt<T>` (which implies both); none is derivable. This is
an evidence-directed injection, not numeric subtyping or a promotion lattice.

Emission follows the selected instance. `Nat -> Int`, `Nat -> Float`, and `Int -> Float`
erase because they use the JavaScript `number` representation; either source into
`BigInt` emits `BigInt(value)`. A concrete nominal instance emits `fromNat`, `fromInt`, or `fromBigInt`
as selected; a genuinely polymorphic target emits the corresponding dictionary call.
The source expression is evaluated exactly once and ordinary evaluation order is preserved.
A lifted operation emits the home type's operation over the injected operands —
`let r: Rat = count + count` emits `Rat`'s addition of two `Rat.fromInt` calls — each
operand converted once, in source order. For the `Num`/`Signed` operators at an erasing
home (`Float`), the lifted emission is byte-identical to the result-injected one — the
same JavaScript `+`/`-`/`*` on the same doubles. The lift's home selection is
observable exactly where the instances differ: at a wider-than-f64 home (`BigInt`,
`Rat`), where it is the exactness this rule exists for, and at `**`, where the base's
home decides the guard: `let x: Float = a ** b` selects `Pow<Float>` — total, a negative
exponent an ordinary float reciprocal power — and `let r: Rat = a ** b` selects
`Pow<Rat>` — exact at either sign — where operand-driven selection took `Pow<Int>` with
its negative-exponent throw (Operators §6.3). The exponent `b` stays an `Int` in every
one of these: only the base's algebra moves with the written face.

Conformance pins the lift owes (fixtures: `n, m : Nat`; `a, b, c, count, sum, size :
Int`; `b` value 4; `negOne : Int`, value −1): the two acceptances (`let x: Int = n - m`;
`let mean: Float = sum / size` and `let r: Rat = a / b`); one observable-exactness case
at a wider-than-f64 home (a `Rat` or `BigInt` sum whose `Int` elaboration would fold past
2^53, value-checked); the `Pow` home selections (`let x: Float = 2 ** negOne` yields
`0.5`, no guard; `let r: Rat = b ** negOne` yields exactly `1/4`, value-checked — the
negative exponent `Pow<Int>` would have thrown on; in both, the exponent seat stays `Int`
— the lift moves the base alone); the base-seat-only boundary (`let x: Float = a ** b`
leaves `b : Int` at the exponent seat — no conversion of `b` to `Float` is emitted or
permitted); the gated decline at the gate's remaining subject (`let t: T = a ** b` for a
user nominal `T` honoring `Num` and `Signed` but not `Pow` — `Int` power, result
injected); the no-face boundary (`let s = count + count` stays `Int`); and the recursion
depth (`let r: Rat = (a + b) * c` runs entirely at `Rat`). *(#808.)* Since the lift
governs every spelling (further fixtures: `big : BigInt`; `price : Float`), the spelled
rows: `let r: BigInt = a.add(c)`, `let r: BigInt = Num.add(a, c)`, `let r: BigInt = a |>
Num.add(c)`, and `let q: BigInt = Integral.div(a, c)` each run at `BigInt` (the additions
value-checked past 2^53); the operand-driven rows `a.add(big)`, `big.add(a)`,
`count.multiply(price)`, and `price.multiply(count)` accepted at the wider operand's
type; `Int.multiply(count, price)` refused as a written face; and `let d: Int =
n.subtract(m)` accepted through Method Syntax §4.2's ownership clause with both `Nat`s
injected. The receiver rule and the stand-down owe two more (#808, after #815's review):
the dot-chain recursion `let r: BigInt = a.add(b).multiply(c)` value-checked past 2^53
against `(a + b) * c` (Method Syntax §14(v)'s fixtures: `9007199254740991`, `2`, `3`);
and the stand-down's report, `let total: Rat = count * price` refused *at the binding*,
its message naming `price` as the operand that could not enter `Rat`. The receiver's own
refusal owes three more (#821): `let n: BigInt = p.add(q).gcd(s)` refused once, at the
receiver, with the three-fact report, and the same call accepted as `(p.add(q):
Foo).gcd(s)`, unannotated, through a binding, and companion-qualified (`Foo.add(p,
q).gcd(s)`, a written face); the newly refused operator receivers `(p + q).gcd(s)` and
`(i + p).gcd(s)`, which compile today; the report counts falling to one — from three at
`Num.add(p, q).gcd(s)` and the pipe stage, from two at `i.add(p).gcd(s)`; the nested
receiver `(p + (i + j)).gcd(s)` refused once by row 16, naming `p`; an `if` receiver
with one `Int` branch and one `Foo` branch refused once by Operators §11's own report at
the `if`, naming the `Foo` branch and carrying the boundary fixit, not by the receiver
rule; and `(if c then p else q).gcd(s)` accepted beside `(if c then p.add(q) else
p).gcd(s)` refused at the stood-down branch, the pair differing only in that branch, with
the reach's regression guards — the nested form, a block whose final expression is the
stood-down call (its binding-then-variable twin accepted), the `try` body, the dot chain
in a branch (whose fixit ascribes the stood-down call, the receiver's own type being
`BigInt`), and the operand `(p.add(q) + q).gcd(s)` — each refused, and `(b ** (i +
j)).gcd(b2)` accepted, the exponent seat taking no outer face, and `(if c then p.add(q)
else b).gcd(s)` refused by the `if`'s own report with no receiver fixit; and the three
claimant kinds — a companion export, an honored member of a user constraint, a
function-typed field — refused alike (Method Syntax §14(v)).

The expression home owes (#1062; fixtures `n : Int`, `m : Nat`, `price : Dec`,
`f : Float`, `c : Bool`): #1062's table row by row, each at `Dec` — `n * 1.5 * price`,
`(n + 0.5) * price`, `(if c then n else 0.5) * price`, `let fee: Dec = if c then n else
0.5`, `let fee: Dec = if c then 1 else 0.5`, and a `match` whose arms are `n` and `m`, or
`n` and `0.5`, under `: Dec`; the literal-only trees `(0.5 + 0.25) * price` and `0.5 * 2 *
price`; order-independence triples, emitting identically — `n * 1.5 * price`,
`price * n * 1.5`, `1.5 * price * n` — and pairs — `[m, n]` beside `[n, m]`, `if c then m
else n` beside `if c then n else m`, and the same two `match` arm orders, unannotated
(#824); the comparisons `price < n * 1.5`, `n * 1.5 < price`, and `price.compare(n * 1.5)`; the siblings `h(n * 1.5,
price)` and `h(price, n * 1.5)`; the schedule residue at a receiver, `h3((n * 1.5).multiply(price),
decs, 0.5)` refused beside `h3(0.5, decs, (n * 1.5).multiply(price))` accepted (`h3<t:
Num>(x: t, v: Vector(t), y: t)`, `decs : Vector(Dec)`); the declared and constrained
variables kept — `passed`'s `accept(value)`, `scale`, and `fun k5(count: Int, value) = { let
z = value + 1; count * value }` at `(Int, Int) -> Int`; the boundaries, each refused — `let y = n * 1.5` then `y *
price`, `id(n * 1.5) * price`, and `(n * 1.5).multiply(price)` with §6's receiver report —
beside `price.multiply(n * 1.5)` and `let a: Dec = (n * 1.5).multiply(price)`, accepted;
the gate `(n band 3) * f`, `band` at `Int`; the moved programs — `n * i * price` (`i :
Int`) value-checked at `Dec` where the `Int` product passes 2^53, `fun ff(x) = { let s = x
+ m + n; useNat(x) }` refused, and `(i ** k) * f` with `k` negative value-checked as a
reciprocal; the seats a face now homes, `let g: () ->
Dec = () => n` and `t := n * 1.5` at `var t: Dec`; one report for a `**` base that cannot
enter the face (#827) — row 16 at the outermost stood-down call, naming `p`, with no
repair where `Foo` honors no `Pow` and the fixit `(p.add(q) ** i: Foo)` where it does — and
beside it `(-p).gcd(s2)`, row 16 at the negation; one report per faced tree, naming its first
declining value, for `(if c then n else f) * r` under `Rat` and, under `Dec`, `(n + f) * price`,
`if c then f * 2 else price`, and a `try` whose body is `n * f` and whose arm is `price`;
`let x: Dec = if c then f else price` refused at `f` with §6's entry report; and `let x:
Rat = p / q` refused with no report of `Foo`'s missing `Frac`; the seats a face does not reach, `let a: Dec = id(n * 1.5)` refused; the
targets kept — `fun widen<t: Num>(value: Nat): t = value`, `let y: t = value`, and
`fun k(count: Int, value) = { let z = value / value; count * value }` at `<a: Frac>
(Int, a) -> a` accepted; the callback pair at `apply2<a>(x: a, g: (a) -> a)` —
`apply2(m, (v: Int) => v + n)` accepted, `apply2(m, (v) => v + n)` refused once with
§6's settled-callback report, in either argument order (ruling A2); the literal
receivers `1.5.multiply(price)`, `(1.5).multiply(price)`, and `(-1.5).multiply(price)` at
`Dec` beside `(if c then 1.5 else 2.5).multiply(price)` refused (ruling b′); and the
exclusions standing — `fun half<a: Frac>(x: a): a = x * 0.5`
refused, a decimal literal pattern at `Dec` refused (#1054), and `let p: (Dec, Dec) = (n,
0.5)` refused (#1066).

### 5.2 Literal emission

Two regimes, determined entirely by whether `α` is resolved to a concrete type at emission:

**Resolved (the overwhelmingly common case).** Erase the `fromNat` call and emit the concrete literal directly:

- `α = Nat` → emit `k` (plain JS number). `Nat.fromNat` is the identity.
- `α = Int` → emit `k` (plain JS number). `Int.fromNat` is the identity; do not emit an identity call.
- `α = Float` → emit `k.0`. `Float.fromNat` remains representationally erased — `k` and `k.0` are the same JavaScript number — while the decimal spelling preserves the inferred Hexagon type for a human reading the generated code.
- `α = BigInt` → emit `kn`. (`BigInt.fromNat` erased: the literal *is* a `BigInt` at this type, §1 rule 6 — a type fact, not a constant-folding of a value. This arises when unification pins a bare literal to BigInt via surrounding code, e.g. `add x 1` with `x : BigInt`.)
- `α = Rat` → emit the canonical-form constructor call with constant arguments, e.g. `Rat.fromNat(k)` or the direct `{top: kn, bottom: 1n}` fast-path constructor — the literal's `Rat` form, a type fact as in the `BigInt` row, not a folding of a value. Either is acceptable; the fast path is a nice-to-have.
- Any other instance type → emit `TheType.fromNat(k)` monomorphically (direct call, no dictionary).

**Non-decimal spellings.** A hexadecimal, octal, or binary literal (`bitwise.md` §8) takes the same regime and is written in its source base wherever the rows above write `k`: `0xFF` at `Int`, `0xFFn` at `BigInt`, `dict.fromNat(0xFF)` below. At `Float` it keeps its source base without the `.0` spelling, which JavaScript has no hexadecimal form of.

**Unresolved-because-polymorphic** (literal inside a function generalised over `Num a`): the dictionary parameter is already in scope under the existing `honor` compilation story; `fromNat` is one more slot in the `Num` dictionary record. Emit `dict.fromNat(k)`. No new mechanism.

This preserves the readable-JS goal: monomorphic code — nearly all code — contains direct `1`, `1.0`, and `1n` literals, with the spelling retaining the resolved fundamental type where JavaScript's representation otherwise cannot. Only genuinely generic functions show dictionary plumbing, and they already did for `add`.

**Dictionary shape change:** `Num` dictionaries gain a `fromNat` field. Every existing and future `honor Num<T>` must supply it. Prelude instances:

```
Nat.fromNat    = identity
Int.fromNat    = identity
Float.fromNat  = identity            (payload guaranteed within 2^53 by lexer, §3)
BigInt.fromNat = n => BigInt(n)
Rat.fromNat    = n => mkFast(BigInt(n), 1n)
```

All five are total and exact. This is a checked property of the design: keep it true for future instances, and document it as a law of `Num`: `fromNat` preserves zero, addition, and multiplication over Nat payloads.

`Signed` dictionaries extend `Num` through one `num` parent slot and add
`subtract`, `negate`, and `fromInt`. `fromInt` is total and exact for `Int`, `Float`,
`BigInt`, and `Rat`; for non-negative inputs it agrees with `num.fromNat`, and for
negative inputs it agrees with negating the corresponding natural magnitude.

---

## 6. Error messages

Elaboration changes the *character* of type errors involving literals, and this is where Haskell beginners bleed. Budget for special-cased reporting using the `LiteralConstraint` provenance from §3:

- When unification fails and one side traces to a literal's `α`, report it as a literal-type mismatch, not a constraint failure. Prefer: `This literal is used as Float here but as BigInt there` over `Cannot satisfy Num constraint arising from...`.
- When defaulting is blocked by a non-defaultable constraint (§4), the error must name the blocking constraint and the literal's location, and suggest an annotation: `The literal 1 at <span> has constraint MyConstraint, which prevents defaulting to Int. Add a type annotation to pin its type.`
- Never surface the name `fromNat` in an error for code the user wrote without mentioning it. The elaboration is invisible machinery; errors should speak in terms of the literal.
- *(#808.)* **When the expected-type lift stands down** (§5.1) because an operand cannot reach the face, the refusal that then fires at the consuming seat names that operand and the operation that could not run at the face — "`price` is a `Float` and cannot enter `Rat`, so the multiplication could not run at `Rat`" — so the report keeps what a refusal at the operand would have carried. Where several values decline, the first in source order is named, and where it sits inside a call that stood down on its own — `p.add(q) ** i` — the value inside that call is named, with that call's operation. The checker therefore records, at a stand-down, which operand declined and why, and carries it to the seat that refuses — a binding, an argument seat, or a dot call's receiver seat *(#821)*, where the report adds the two facts that seat alone knows: why the face reached the receiver (the spelling's rung) and the written boundary that keeps the receiver at its own type, an ascription or a separate binding (Method Syntax §9 row 16). Every stand-down ends at such a seat (§5.1), so the note is always spent.
- *(#1062.)* **When a value cannot enter its expression's home** (§5.1), the report names the value, its type, the home, and what gave the home — the seat's type ("the home `: Dec` writes") or the value that established it ("the home `price` gives this expression") — at the declining value. **When two values establish different homes** (a conflicting tree), the report names both — "`x` is a `Float` and `price` a `Dec`; an expression's arithmetic runs at one type, and neither enters the other". Each names the named door where either type has one into the other (`Dec.fromFloat(x, places)`, `price.toFloat()`; friendly-numerics tenet 7), and otherwise no conversion, there being none to name. Precedence: at a dot call's receiver, Method Syntax §9 row 16 and Operators §11's form report; under a written face, the #808 stand-down wording above wherever a tower member call stood down; otherwise these — among them a value that meets a written face with no operation between it and the seat (`let x: Dec = if c then f else price`: "`f` is a `Float` and cannot enter `Dec`, the home `: Dec` writes"), which is reported once, at the value — a gated call's result being such a value (`let x: Nat = if c then n - k else m` names `n - k`). **When a callback's body finds its call's home settled** (Functions §4.3) at a type that would have widened into the body's — "`m` settled this call's `Nat` before the callback was checked, and the callback's body returns `Int` — a callback's body chooses no type for the arguments beside it; write `(m: Int)`, or annotate the callback: `(v: Int) => …`" — the report is given once, at the body. **When a dot call's receiver closed before the dot** (Method Syntax §2.2) and a sibling then refuses it, where every value of the receiver's own tree would have entered that sibling's type, the report says so and names both repairs: "`n * 1.5` settled at `Float` before `.multiply` saw `price` — a dot call's receiver is settled on its own; write `n * 1.5 * price`, or name the home: `let a: Dec = …`". Each is decided from recorded types, for the report alone.
- *(#525.)* A decimal-point literal promoted to `Dec` with an exponent is refused with the value in ordinary notation: "a `Dec` literal is written without an exponent, so its decimal places show; write `0.0015`". A decimal-point literal *pattern* at a `Dec` scrutinee is refused with its `d` spelling: "…; a `Dec` pattern is written with the `d` suffix: `0.5d`" (Pattern Matching §2.5, #1054).
- LSP hover on a bare literal in polymorphic position should show `<a: Num> a` (matching the round-trip-consistency rule for signatures — the display is source-shaped, Functions §5.1); hover on a defaulted or pinned literal shows the concrete type.

**Settling at synthesized `Unit` obligations.** Three positions carry a `Unit` obligation the language inserts rather than the user writing it: a discarded non-final block item (Statements §3.2), a loop body (Loops §2.2; `while` identically, Loops §4), and the `then` branch of an else-less `if` (Operators §11.2). A type variable that meets such an obligation is settled to `Int` at that point, ahead of §4's generalisation-time defaulting — provided `Int` satisfies every constraint on the variable and at least one of those constraints has no `Unit` instance. The rule is stated over constraints, not provenance: a literal's variable (§3) is the common case, but a variable constrained only by use (`x + x`) settles identically, and there is no reason to give the two different reports. A **declared** type variable is excluded — an annotation pins it, so settling it would report that annotation as requiring the `Int` the settling itself invented, naming a rewrite that repairs nothing (the Rewrite Rule, Declarations Preamble §1.1).

Without settling, the variable unifies with the synthesized `Unit` structurally and *succeeds* — and the loss is not silence but the wrong voice. The literal's `Num` requirement fails at that same binding, and this section's first rule, doing exactly its job, reports it as `integer literal cannot have type Unit`: literal-voiced, correct, and the wrong position's message, naming the literal where the position should have named the discard or the missing `else`. Settling first makes the unification fail at the demand site, so the position's own report fires — the discard diagnostic, the loop-body report (Loops §10.2), or the mandatory add-an-`else` fixit (Operators §15) — with the first and last naming `Int`. This is a diagnostic-routing rule, not a second defaulting rule: the no-`Unit`-instance guard means it fires only where the binding's own requirement validation was about to fail anyway, so no accepted program's type changes, and §4 — single candidate, closed list, generalisation time — is untouched. User-written `Unit` annotations are out of scope; only the three synthesized obligations above qualify.

A branch or item whose type is *structured* — `(1, 2)`, `[1, 2]` — can never be the demanded `Unit`, so its report is certain before any settling. Its literals settle to `Int` too, by §4's rule rather than the guard above — declared variables again excepted, and named rather than numbered where they survive — so that the report names `(Int, Int)`, or `(Int, a)`, rather than leaking inference variables into a message the Rewrite Rule makes mandatory.

> **Edit note (for Operators §15, applied on next touch):** the "Else-less `if` whose `then` branch is not `Unit`" row covers a bare-literal `then` branch: the literal settles to `Int` before the `Unit` unification (Numeric Literals §6), so this row's fixit fires — naming `Int` — rather than the bind-time `integer literal cannot have type Unit` report.

> **Edit note (for Statements §3.2, applied on next touch):** the discarded-value report covers a bare-literal non-final item: the literal settles to `Int` before the `Unit` unification (Numeric Literals §6), so the discard diagnostic fires and reports the discarded type as `Int` — rather than the bind-time `integer literal cannot have type Unit` report.

---

## 7. Rejected alternatives (do not re-litigate without new information)

**Fully monomorphic literals** (`1 : Int` always). Rejected because `fun addOne x = add x 1` collapses to `Int -> Int`, forcing duplication of any generic numeric code that mentions a constant. The polymorphic scheme costs one `Num` method plus one defaulting rule and recovers Haskell/Roc ergonomics.

**Context-dependent rewriting** ("rewrite the literal to `fromNat` when it appears in a polymorphic context"). Rejected as an implementation strategy — not because the observable behaviour is wrong, but because "polymorphic context" is not syntactically detectable; it is an inference outcome. In `fun f x = add x 1`, whether the `1` is polymorphic depends on what later unification pins `x` to. The uniform elaborate-always + erase-when-resolved strategy (§3, §5) produces the behaviour the context-dependent intuition wants, with a rule that can actually be implemented in one pass.

**`1n` as a polymorphic Num literal** (elaborating via `fromBigInt : BigInt -> a` in `Num`). Rejected for two reasons. (1) It hollows out the suffix: if both `1` and `1n` are polymorphic, `n` no longer means "this is a BigInt", breaking the JS developer's correct intuition — the suffix is supposed to *be* the type annotation, as in JS. (2) It forces `fromBigInt` into `Num`, whose `Float` instance is silently lossy for values beyond 2^53 (`fromBigInt(2n**60n)` rounds without a peep). Haskell's `fromInteger` has exactly this wart; Hexagon doesn't need it because the polymorphic `Nat`-payload literal covers every exact case, and oversized literals remain monomorphic BigInt values, which can enter an independently established exact target through the separate `FromBigInt` capability. This is ordinary contextual conversion, not polymorphic literal elaboration (`integer-widening.md`).

**Haskell-style generalisation of bare literal bindings** (`let x = 1` giving `x : <a: Num> a`). Rejected: conflicts with the "no defaulting negotiation" goal, produces dictionary-abstracted values where users expect constants, and interacts badly with the value-restriction-adjacent rules already in place (`var` never generalises). Defaulting to `Int` at generalisation is strictly simpler and matches Roc.

**Haskell-style extensible defaulting** (multiple candidate types, `default` declarations). Rejected: single candidate (`Int`), closed defaultable-constraint list, no per-module configuration. See §4.

**Polymorphic decimal literals** (#525). Rejected. A decimal literal whose type a type variable decided — `x * 0.5` in `fun half<a: Frac>(x: a)` meaning whatever each caller picks — would need a new `Frac` member to build it and `Float` as a second defaulting candidate beside `Int` (§4), and its type would be decided where no reader can see it. §5.1's promotion covers the concrete targets instead. The `fromFloat` route was never open: a `Rat` `fromFloat` exists in no spelling (friendly-numerics tenet 7 — exact binary conversion would mint exactness the double never had).

**Re-homing settled operations** (#1062). Settle each operation from its operands, then retarget the finished inner operations — their evidence, widenings, and literal promotions — when a wider exact type appears further out. Rejected: it gives an expression a first reading and replaces it by a second chosen from inferred state, the re-elaboration Method Syntax §16.3 rejects. §5.1's expression home decides once instead.

**A pending decimal type** (#1062) — Rust's `{float}`: a decimal literal's operation keeps an undecided type that ordinary unification settles, defaulted to `Float` at the binding. Rejected: it is a second defaulting candidate beside `Int` (§4), it travels through type variables and across calls, and every `Int` widening into it must wait on a target not yet decided. §5.1's home is decided inside one tree, and a call's result is a value.

**Arguments as separate trees** (#1062). Every argument its own tree, even at a shared type variable. Rejected: `price < n * 1.5` would stay refused while `price < n * 2` compiles, and the sibling clauses the tree now states in one place would remain special cases.

**A receiver joined by its own home** (#1062). The dot reads the home its receiver's parts would select alone, and where that home honors the spelling's rung, joins the receiver to the enclosing tree. Rejected: it reads inferred types to choose how a part is read — the #821 leaf gate by another name (friendly-numerics §4). A dot call's receiver closes before the dot resolves, taking from outside only its seat's expected type (Method Syntax §2.2).

---

## 8. Implementation checklist

1. **Lexer:** ensure distinct token kinds for bare integers, BigInt, Float, and exact Dec literals. Range-check IntLit payload against 2^53−1; emit the fixit error otherwise. BigIntLit payload stored losslessly.
2. **Prelude / constraint defs:** add `fromNat : Nat -> a` to `Num` and `fromInt : Int -> a` to `Signed`; implement the five `Num` and four `Signed` prelude instances (§5 table); document the exact-homomorphism law.
3. **Inference:** elaborate IntLit per §3 (fresh tyvar, `Num` constraint with `LiteralConstraint` provenance, `fromNat` application node). BigIntLit/FloatLit type directly.
4. **Generalisation:** insert the defaulting pass per §4, testing membership against the compiler's own `Int` instance table — the closed defaultable set of §4's correction record, not the v1.1 five-name list *(corrected 2026-07-28, #135)*. Assert successful unification with Int.
5. **Codegen:** implement contextual Nat, Int, and BigInt widening and decimal-point literal promotion per §5.1; erase resolved literal `fromNat` per §5.2 (`k` for Nat/Int, readable `k.0` identity folding for Float, `kn` folding for BigInt, constructor call for Rat/others); dictionary slots for polymorphic cases.
6. **Diagnostics:** literal-aware unification errors, blocked-defaulting error, no `fromNat` leakage (§6).
7. **LSP:** hover types per §6; signature round-trip consistency (`<a: Num> a -> a -> a` etc.) unchanged.
8. **Tests:** the eight examples in §2 as golden tests (inferred type + emitted JS), plus the §4 consequence list, plus an error-message snapshot for (g) and the blocked-defaulting case.
