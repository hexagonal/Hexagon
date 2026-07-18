# Hexagon Spec: Constraints

**Status:** Decided (July 2026). The keyword pair is **`constraint` / `honor`** (naming record and anti-relitigation anchors: §11; remaining rename propagation: §12). Section numbering §1–§10 is stable; §9 holds resolved anchors plus two open items, none blocking §1–§8.
**Scope:** The `constraint` declaration (members, subjects, superconstraints), the `honor` declaration (ground and parameterized instances, superconstraint checking, coherence, orphan rule, instance-head restriction), the derivation mechanism (`honor C<T> = derive`, §4.5), constraint-member call style (§2.2), dictionary compilation, and the member lists of the constraints this spec owns (§7 — focused specs own the rest).
**Not in scope:** derived structural instances' *semantics* (fixed in Products §2.5/§3.4 and Unions §7; the invocation mechanism is §4.5 here), the numeric-literal elaboration and defaulting machinery (Numeric Literals spec, authoritative), `Eq<Float>`/`Ord<Float>` semantics (decided — Decisions Batch §1, en route to Primitive Types; §9.5), LSP display of constraints (open, §9.4), modules and instance visibility (Modules; the orphan rule §5.3 constrains it), `Hash`/`Iterable`/`Integral` member semantics (their focused owners, §7).
**Companions:** Functions spec (§4.2 angle-bracket type parameters — this doc reuses that grammar wholesale), Numeric Literals spec (`fromInt`, defaulting, dictionary erasure), Primitive Types §7 (Show contract), Products/Unions specs (derived-instance semantics), Declarations Preamble (declaration inventory; `derives` header sugar §2.3; alias-instance rule §4; Rewrite Rule §1.1), Collections Part 2 (`Hash`, associated type members), Method Syntax §7 (constraint members are not dot-callable), `stdlib-roadmap.md` (hostile-specimen exercise; prelude inventory).

**Vocabulary, fixed for docs and diagnostics:** the declared obligation is a **constraint**; the declaration that discharges it is an **`honor` declaration**; the thing an `honor` declaration produces is an **instance**. The words "implement"/"implementation" are avoided in user-facing diagnostics and reference material for this mechanism — they are generic, OO-flavored, and name nothing this design has. ("Implementation" remains fine as an ordinary English word for the compiler itself.)

---

## 1. Doctrine

- **Constraints are the type of a type.** The angle-bracket binder `<a: Num>` reads uniformly everywhere it appears: "a type variable, with obligations." Scala's context bounds (`[A: Num]`) and Rust's trait bounds (`fn f<T: Num>`) are the acknowledged lineage; Hexagon follows the **Rust** reading — the dictionary is compiler plumbing, never a user-nameable or user-passable value. Scala's "reach in and grab the implicit" power is deliberately absent: it is the door to incoherence.
- **A constraint states an obligation; an `honor` declaration discharges it.** The keyword pair is a matched semantic pair, deliberately: `honor` (in its performative, commercial sense — one honors a warranty by paying out) names the constructive act of supplying the members, and every use of the keyword points the reader back at the constraint it answers. See §11 for the full naming record.
- **One grammar for binders.** `constraint`, `honor`, and function definitions all introduce type variables with the same `<var: constraintList>` form from Functions §4.2 — a single constraint, or a parenthesized conjunction `(C1, C2)`. Bare `<a>` is the unconstrained case; legal everywhere, *required* in `constraint` heads (§2), never required on functions.
- **Implication reads left to right.** `constraint Ord<a: Eq>` means "Ord implies Eq." No Haskell-style `Eq a => Ord a` with its backwards arrow, and no third meaning for `=>` (which is already the lambda and match-arm arrow).
- **Coherence is global and non-negotiable** (§5). One instance per (constraint, type constructor), enforced by an orphan rule. This is what keeps `Ord`-backed collections sound and monomorphic code dictionary-free — the readable-JS goal is downstream of coherence.
- **Angle brackets vs. parens encode a kind distinction.** Parens after an uppercase-start name are type parameters of a type constructor (`Option(a)`); angle brackets are constrained/introduced type variables. A constraint's subject is not a type parameter — `Ord` is not a type — so it is `Ord<a>`, never `Ord(a)`.

---

## 2. The `constraint` declaration

```
constraint Show<a> =
  show(x: a): String

constraint Eq<a> =
  equals(x: a, y: a): Bool
  notEquals(x: a, y: a): Bool = not equals(x, y)

constraint Ord<a: Eq> =
  compare(x: a, y: a): Ordering

constraint Num<a> =
  add(x: a, y: a): a
  subtract(x: a, y: a): a
  multiply(x: a, y: a): a
  negate(x: a): a
  fromInt(n: Int): a

constraint Frac<a: Num> =
  divide(x: a, y: a): a
```

*(Member inventories above are illustrative of the shape; the authoritative member lists for the prelude constraints are §7. `Ordering` is the prelude union `Less | Equal | Greater`.)*

- **Head:** `constraint Name<subject>` where `Name` is uppercase-start (it lives in its own namespace — see §2.2) and the subject is exactly one type variable, non-uppercase-start, using the standard binder grammar. The subject binder is **mandatory** — this is the one position where bare `<a>` is load-bearing rather than optional.
- **Superconstraints** are the obligations on the subject: `constraint Ord<a: Eq>` requires every type honoring `Ord` to have (or derive) `Eq`. Conjunctions per the standard form: `constraint C1<a: (C2, C3)>`. Terminology, fixed for diagnostics and docs: if `Ord` implies `Eq`, then `Eq` is the **superconstraint** and `Ord` the **subconstraint**.
- **Superconstraint cycles are a hard error** at declaration (`C1<a: C2>`, `C2<a: C1>`). The superconstraint relation must be a DAG.
- **Members are fully typed function headers, optionally with a default body.** A required member omits the body: `name(params): ReturnType`. A defaulted member appends `= body`. The bodiless form remains legal only here: a constraint member is the declaration itself, not a standalone signature for some later definition. No `->` appears in source.
- A constraint body may also declare an **associated type member** as `type Name`. Its owner-scoped identity, grammar, and v1 restrictions are owned by Collections Part 2 §§5–8; it claims no module-level namespace slot.
- Member headers must mention the subject variable; annotations on member parameters/returns are **required** even when a default body is present. The subject `a` is in scope in every member; members may not introduce their own `<...>` type parameters in v1 (no polymorphic methods; flagged, not needed by any planned prelude constraint).
- Members are one per layout line (VSEP/`;` per Lexer & Layout); duplicate member names within one constraint: hard error.
- Member names are non-uppercase-start term names. They enter scope per §2.2.

### Default member bodies

- A member without a body is **required**. Every `honor` declaration must supply it.
- A member with a body is **defaulted**. An `honor` declaration may omit it and inherit the default, or supply a member of the same name to override it.
- A constraint must declare at least one required member: either a bodyless function member or an associated type member (Collections Part 2 §5). Associated type members are always required and bound exactly once; they have no default-body form. Defaults supplement an obligation; they do not create marker constraints or Haskell-style "supply either member" minimal-definition alternatives.
- A default body is checked once in the constraint's generic context against its declared return type. The constraint subject, its superconstraint operations, module-scope names, and all members of the same constraint are in scope.
- Calls from a default to another member dispatch through the completed instance. An override is therefore respected by defaults that call it. Ordinary recursion rules apply if defaults call themselves or one another; the compiler adds no separate termination analysis.
- `Eq` is the first prelude use: `equals` is required and `notEquals` defaults to `not equals(x, y)`. An override of `notEquals` is permitted for efficiency but must obey the law `notEquals(x, y) == not equals(x, y)`.
- Derivation supplies the required members fixed by the structural semantics, then inherits every defaulted member. Thus `honor Eq<Point> = derive`, `derives Eq`, and the automatic `Eq` instances for tuples and structural records generate `equals` and inherit the standard `notEquals` default.

The Haskell `Eq` design, in which equality and inequality default recursively to each other and an instance must supply either one, is deliberately not copied. It requires a separate minimal-complete-definition rule to prevent an instance from inheriting an infinite loop. Hexagon keeps one required semantic foundation (`equals`) and one overridable convenience (`notEquals`): the same optimization door, with no alternative-completeness grammar and no warning-tier trap.

### 2.1 Superconstraints and constraint-use semantics

Where a function demands `<a: Ord>`, the callee may use both `Ord` members and `Eq` members on `a` — superconstraint members are reachable through the subconstraint. Conversely a caller discharging `Ord<T>` has by construction discharged `Eq<T>` (§4.2 guarantees the instance exists). One dictionary-design consequence in §6.2.

### 2.2 Namespacing of members

Constraint members are module-scope term names (like constructors, Unions §2). Two in-scope constraints declaring the same member name: error at the point that makes it ambiguous; two constraints in one module sharing a member name: hard error at the second declaration — the same rule family as constructor names. Qualified access (`Ord.compare`) and import-driven disambiguation are the modules spec's business.

**Call style (doctrine, absorbed from the July 2026 review closures §A):**

- **Bare constraint-member calls are the idiom when unambiguous**: `show(x)`, `compare(a, b)`, `x |> show`. Members are ordinary module-scope terms; nothing about being a constraint member demands ceremony.
- **Qualification is the ordinary collision resolution, not an apology.** When two in-scope constraints share a member name, the qualified spelling (`Ord.compare(a, b)`) resolves it through **normal module aliases** (Modules §5) — the same machinery as any other name collision. **There is no constraint-specific member namespace** and no special qualification syntax.
- **Constraint members are not reachable through dot-call syntax** (`x.show()` does not dispatch a constraint member and is not planned to — Method Syntax §7 owns that exclusion and its diagnostics).
- The revisit bar for qualified-as-default — the **hostile-specimen exercise** (ten unrelated user constraints; collision-pressure measurement) — is a stdlib-listing obligation, routed through `stdlib-roadmap.md` §2, not restated here. If collisions prove constant in practice, the qualified-as-default position returns there.

---

## 3. Constrained functions (restated for closure)

Unchanged from Functions §4.2; recorded here because this spec is where a reader will look:

```
let plus<a: Num>(x: a, y: a): a = add(x, y)
let member<a: (Eq, Show)>(xs: Vector(a), x: a): Bool = ...
```

Inference attaches constraints without annotation (`fun plus(x, y) = add(x, y)` infers the `Num` constraint from `add`'s type); the explicit `<...>` form names variables and attaches constraints for documentation and restriction. Generalisation of constrained type variables follows Functions §8 plus the Numeric Literals §4 defaulting rule, both unchanged by this spec.

---

## 4. The `honor` declaration

### 4.1 Ground instances

```
honor Show<Point> =
  show(p) = "(${p.x}, ${p.y})"

honor Ord<Int> =
  compare(x, y) = ...
```

- **Head:** `honor ConstraintName<Type>`. The subject slot that held a variable-being-introduced in `constraint` holds a concrete-type-being-supplied in `honor`. Declaration/use duality, deliberately.
- **Members are ordinary function definitions** (header sugar, or explicit-lambda form — same AST equivalence as everywhere). Every required member must be supplied exactly once. A defaulted member may be omitted or supplied once as an override. A missing required member is an error naming it; an extra or duplicate name is an error.
- An associated type member is instead supplied exactly once as `type Name = τ`; Collections Part 2 §5.3 owns its RHS scope and exactly-once rules.
- **Member typing is checking, not inference.** The expected type of each member is fully determined by the constraint definition with the subject substituted; the body checks against it. Annotations on members are optional; if present they must match the expected type exactly — a *less general* annotation is an error here (unlike on free functions), because the dictionary slot's type is fixed.
- Member RHSs must be **syntactic lambdas** (directly or via header sugar) — the `fun` §7.1 rule, for the same reason: instance construction must be evaluation-free (§6.3).

### 4.2 Superconstraint obligations: checked, never restated

`honor Ord<Int>` does **not** name or restate the `Eq<Int>` instance. The compiler checks that the superconstraint instance *exists* (ground case) or *is derivable from the instance's own binders* (parameterized case, §4.3), and errors otherwise:

> cannot honor `Ord<Int>`: `Ord` requires `Eq`, and no `Eq<Int>` instance exists.

Naming instances would only make sense under multiple candidate instances, which coherence (§5) forbids; existence-checking is therefore complete.

### 4.3 Parameterized instances

```
honor<a: Show> Show<Vector(a)> =
  show(xs) = ...

honor<a: Eq, b: Eq> Eq<Pair(a, b)> =
  equals(p, q) = ...
```

- The prefix `<...>` is the standard binder grammar again — introduce variables, attach obligations — in yet another position, with identical meaning. An `honor` head's subject may then mention those variables.
- Superconstraint checking in this case: `honor<a: Ord> Ord<Vector(a)>` requires `Eq<Vector(a)>` to be derivable — i.e. an `honor ... Eq<Vector(_)>` exists whose own obligations are entailed by this instance's binders (`a: Ord` entails `a: Eq` via the superconstraint DAG). Entailment here is simple: walk the DAG; no backtracking search arises under §5.4.

### 4.4 What `honor` is not

- Not first-class: an instance is not a value, cannot be named, passed, or locally shadowed. (Contrast Scala; see §1.)
- Not conditional on anything but its `<...>` binders: no where-clauses, no negative constraints, no overlap resolution.
- Not open: all members supplied in one block; no splitting an instance across declarations.

### 4.5 Derivation: `honor C<T> = derive`

Derived instances for **nominal** types (`record`, `union`) are **opt-in** — "nominal means you control the surface." Two spellings, one meaning:

```
honor Eq<Point> = derive              -- core form: the RHS is exactly the keyword `derive`
record Point derives (Eq, Show) = ...  -- header sugar, owned by Declarations Preamble §2.3,
                                       --   elaborating to one core-form instance per constraint
```

- **A derived instance is an ordinary instance thereafter**: it occupies the (constraint, constructor) coherence slot (§5.1), obeys the orphan rule (header sugar is necessarily in the type's home; the core form may appear in either legal home), is existence-checked for superconstraints (§4.2), supplies the required members fixed by the structural semantics (Products §2.5/§3.4; Unions §7), and inherits every defaulted member (§2) — `derives Eq` generates `equals` and inherits the standard `notEquals`.
- **`derive` is a keyword valid only as the complete RHS of an `honor`** (parallel to §4.1's lambda-literal rule); anywhere else it is a parse error with the fixit "`derive` is only legal as the body of an `honor`".
- **Derivable in v1: `Eq`, `Ord`, `Show`** (structural semantics fixed by Products/Unions) **and `Hash`** — which is *derivable-only*: `Hash` instances cannot be hand-written, and deriving `Hash<T>` additionally requires a derived `Eq<T>` (Collections Part 2 §4 owns both rules and `Hash`'s semantics).
- **Structural types are untouched and user-closed**: tuples and structural records keep their automatic compiler-derived instances — they have no constructor name to key an instance on (§5.4) and no home module for the orphan rule (Modules §2: structural types belong to no module). Users cannot write instances for them (§9.3, resolved).
- Derivation on a parameterized nominal type produces the expected parameterized instance (slot types' instances become instance-context obligations, §4.3). Emission is exactly what the structural semantics dictate; nothing new.

---

## 5. Coherence

### 5.1 The rule

**At most one instance per (constraint, type constructor), program-wide.** A second `honor Ord<String>` anywhere in the program is a hard error at the second declaration; cross-module duplicates report at whole-program check, when the second module enters the import graph, naming both declaration sites (reporting point fixed by Modules §7; the *rule* is fixed here).

Rationale, recorded so it is not re-litigated: (1) `Ord` feeds sorted collections — two `Ord<String>` instances mean a set built under one and queried under the other is silently corrupt; this is why Primitive Types §5 insists `Ord String` is permanent. (2) Dictionary selection stays trivially decidable at every call site, which is what lets monomorphic code erase dictionaries entirely (Numeric Literals §5); the readable-JS goal is downstream of coherence. (3) No modular-implicits/named-instance machinery, which is a research tarpit.

### 5.2 No local instances, no overlapping instances

No instance may be declared inside a function or block; `honor` is a module-level declaration only. No two instances may overlap (which, given §5.4, reduces to: same constraint + same outermost constructor = duplicate = error).

### 5.3 Orphan rule

An `honor C<T>` must appear in **the module that declares `C` or the module that declares `T`** (for parameterized heads: the module declaring `T`'s outermost type constructor). Otherwise two independent libraries could each honor `Show<SomeDepType>` and a downstream importer of both would hold an unresolvable conflict they didn't write. Violation is a hard error at declaration.

*(Preserved by Modules §1/§7, as demanded: instances are global once their module is in the import graph — never imported, never exported, never hidden; `export honor` is illegal.)*

### 5.4 Instance-head restriction

An instance head is **one type constructor applied to distinct type variables**: `Show<Int>`, `Show<Vector(a)>`, `Eq<Pair(a, b)>`. Not legal: `Show<Vector(Int)>` ("instances are per type constructor; this one must cover `Vector(a)` for all `a`"), `Eq<Pair(a, a)>` (repeated variable), instances headed by a bare type variable (`Show<a>` — "an instance must name a type"). This is (roughly) the Haskell 98 rule; it makes instance lookup a table lookup keyed on (constraint, constructor) rather than a search, keeps §4.3 entailment search-free, and closes the road to overlapping-instance resolution.

---

## 6. Compilation

### 6.1 Dictionaries

Nothing beyond what Numeric Literals §5 already assumes, now stated in general:

- A **ground instance** is a module-level record of its completed member set: supplied members plus inherited defaults. For example, `const Num_Int = { add: (x, y) => x + y, fromInt: (x) => x, ... };` is materialised only if some polymorphic use actually needs it (see erasure below).
- A **parameterized instance** is a dictionary-producing function: `const Show_Vector = (dictA) => ({ show: (xs) => ... });`
- A constrained function takes its dictionaries as a **trailing evidence suffix**, after every source parameter (FFI Part 9 §6). Per generalized variable, constraints transitively supplied by a more specific declared constraint are eliminated first; the remaining maximal constraints are ordered by `(type-variable ordinal, constraint name)`. Ordinals, not binder spellings, keep alpha-renaming ABI-neutral. The same convention is internal and public, so a matching generic edition can export directly.
- **Monomorphic erasure is the norm and the point:** at a call site where the constrained variable is resolved to a concrete type, the dictionary is selected at compile time and known slots are inlined — `add` at `Int` emits `x + y`, `show` at `Int` emits `String(x)` (Primitive Types §7 table), and contextual `fromInt` erases for `Int -> Float` while emitting the selected concrete conversion for other subjects (Numeric Literals §5). Dictionary records and `dict.member(...)` calls appear **only** inside genuinely polymorphic functions, which already carried them.

### 6.2 Superconstraint dictionaries

A subconstraint dictionary carries its superconstraint dictionaries as slots (`Ord_Int = { eq: Eq_Int, compare: ... }`), so a function constrained `<a: Ord>` receives one dictionary and reaches `equals` as `dict.eq.equals`. Chosen over passing separate flattened dictionaries because it keeps the "one constraint = one parameter" rule stable under superconstraint changes to a constraint's definition. Slot name for a superconstraint: the constraint's name, lowercased (`eq`, `num`) — collision with a member name is impossible only by luck, so: **a member whose name equals the lowercased name of a superconstraint of the same constraint is a hard error** (obscure, cheap to check, prevents a codegen landmine).

### 6.3 Evaluation-freeness and ordering

Instance construction is evaluation-free by construction (§4.1: supplied member RHSs are syntactic lambdas, and default bodies elaborate to lambdas; a record of lambdas evaluates nothing). A default that calls another member reads that slot when the function is called, after the dictionary is complete. Instances are therefore order-independent within a module and require **no capture-set analysis** (unlike `fun`, Functions §7.2) and no initialisation-order story. Instances may reference each other freely (e.g. `Show_Vector` using `dictA` which might be `Show_Vector(Show_Int)` at some call site — composition happens at use sites, not declaration sites).

### 6.4 `.d.ts`

Constraint and `honor` declarations have no ordinary JavaScript or `.d.ts` export face, and instances remain unnameable in Hexagon source. The JavaScript boundary has one deliberate public evidence surface (FFI Parts 8–9): a generic constrained export exposes trailing `Constraint.Dictionary<a>` parameters; public nameable instances produce generated handles/factories such as `Num.int`, `Rat.num`, and `Vector.show(...)`; dictionary interfaces carry non-exported-symbol TypeScript brands. Fundamental specializations remain dictionary-free. No other constraint machinery appears in `.d.ts`.

---

## 7. Prelude constraints owned here (member lists) — and the ones owned elsewhere

This section owns the member lists of **five** constraints. It is deliberately **not** the complete prelude-constraint inventory: focused specs own the rest (registry below), and the full inventory is the stdlib listing's (`stdlib-roadmap.md`).

| Constraint | Superconstraints | Members | Notes |
|---|---|---|---|
| `Eq<a>` | — | required `equals`; defaulted `notEquals` | `notEquals(x, y) = not equals(x, y)`; `Eq<Float>` = SameValueZero (Decisions Batch §1 → Primitive Types; §9.5) |
| `Ord<a: Eq>` | `Eq` | `compare(x: a, y: a): Ordering` | `Ordering` is the prelude all-nullary union `Less \| Equal \| Greater` |
| `Show<a>` | — | `show(x: a): String` | contract per Primitive Types §7 |
| `Num<a>` | — | `add`, `subtract`, `multiply`, `negate` (all `(a, a): a` / `(a): a`), `fromInt(n: Int): a` | `fromInt` law per Numeric Literals §5; no `divide` (evicted, per Primitive Types §2) |
| `Frac<a: Num>` | `Num` | `divide(x: a, y: a): a` | lawful up to rounding (Float); exact (Rat) |

**Owned by focused specs (registered, not restated):** `Hash` — Collections Part 2 (derivable-only; §4.5 here); `Iterable` — Collections Parts 2/5 (associated `type Item`; `iterate` member; restricted v1 user instances); `Integral` — `integral-constraint.md`. Their instances obey every rule of §§4–6 unchanged.

Whether `Num` should have superconstraints (`Eq`? `Show`?) is **decided: no** — a numeric type without decidable equality (e.g. a lazy/symbolic instance someday) shouldn't be ruled out by the arithmetic constraint, and the defaulting rule (Numeric Literals §4) never needs `Num` to imply anything. Instances that have all three simply honor all three.

Comparison/`equals` operator sugar (`==`, `<`, etc. dispatching to these members) is the **operators spec's** business; this spec fixes only the members.

---

## 8. Diagnostics checklist

Diagnostic noun policy (restated from the preamble): the noun is **instance**, the verb is **honor**; "implement"/"implementation" do not appear in this mechanism's diagnostics.

| Situation | Error / hint |
|---|---|
| Missing member in `honor` | "the `Ord<Int>` instance is missing `compare`" |
| Omitted defaulted member | accepted; the constraint body supplies it |
| Override of a defaulted member | accepted when its type matches the declared member type |
| Extra member | "`Ord` has no member `compere`" (+ near-miss suggestion) |
| Member type mismatch | ordinary type error, phrased against the constraint's declared header |
| Missing superconstraint instance | "cannot honor `Ord<Int>`: `Ord` requires `Eq`, and no `Eq<Int>` instance exists" (§4.2) |
| Duplicate instance | hard error at second declaration, naming the first (§5.1); remove one or delete the duplicate module's copy |
| Orphan instance | hard error: "honor `C<T>` in the module declaring `C` or the module declaring `T` — move this declaration there" (§5.3) |
| Non-constructor or repeated-variable instance head | §5.4 messages, each naming the general head to write (`Show<Vector(a)>`) |
| Instance head on a bare type variable | "an instance must name a type; constrain the variable at the use site instead (`<a: Show>`)" (§5.4) |
| Superconstraint cycle | hard error at declaration; remove one of the cycle's superconstraint obligations (§2) |
| Duplicate member name within a constraint / across a module's constraints | hard error, constructor-rule family; rename one member (§2, §2.2) |
| Member name = lowercased superconstraint name | hard error; rename the member (§6.2) |
| Non-lambda member RHS in `honor` | the `fun` §7.1-style syntactic error; write the member as a lambda or header-sugar definition (§4.1) |
| Unsatisfied constraint at a call site | phrased per Numeric Literals §6 where a literal is involved; otherwise "`T` has no `Ord` instance, required by `sort`" — with the derivation fixit where `Ord` is derivable: "add `derives Ord` to the declaration of `T`" (§4.5) |
| Instance for a structural type (tuple / structural record) | "instances are keyed on type constructors; tuples and structural records have compiler-derived instances only — declare a nominal `record` or `union` for a type you control" (§5.4, §9.3) |
| `honor C<Alias>` on a transparent alias | "`Meters` is an alias of `Float`; aliases cannot carry their own instances — use a `record` or a single-constructor `union`" (Declarations Preamble §4 owns) |
| `derive` for a non-derivable constraint | "`Num` cannot be derived; only `Eq`, `Ord`, `Show`, and `Hash` have derivable forms" (§4.5) |
| Underivable slot/field | "cannot derive `Eq<Point>`: field `f` has type `T`, which has no `Eq` instance" — fix the field's type or drop the derivation (§4.5) |
| `derives Ord` without `Eq` | the §4.2 missing-superconstraint error + hint: "add `Eq` to the `derives` list" (§4.5) |
| `derive` outside an `honor` RHS | parse error: "`derive` is only legal as the body of an `honor`" (§4.5) |
| Missing, extra, or duplicate associated type binding | the owner-aware diagnostics in Collections Part 2 §9; supply exactly one `type Name = τ` line for each declared associated type |
| Projection-bearing constraint on a type-variable binder | the focused error and rewrite in Collections Part 2 §9 |
| Associated type name used in a type expression | the owner-aware error in Collections Part 2 §9; v1 has no projection syntax |

---

## 9. Resolved anchors and open items (numbering preserved)

Numbers are kept because companion specs cite them; §§9.1–9.3, 9.5, 9.7 are **resolved anchors**, not live questions. §§9.4 and 9.6 remain open.

1. **Resolved — default member bodies.** Bodiless members required; bodied members inherited/overridable defaults. The complete rule: §2.
2. **Resolved — derivation invocation.** Opt-in: core form `honor C<T> = derive`; header `derives` sugar (Declarations Preamble §2.3). Mechanism: §4.5. The record-`Ord` shipping question dissolved with opt-in (nobody receives it unwritten).
3. **Resolved — no user instances for structural types.** Instances are keyed on type constructors (§5.4); structural types have no constructor name and no home module (Modules §2), so their instances are exclusively compiler-derived (§4.5). The old presumption is now the rule.
4. **Open — LSP display of constraints.** Haskell-flavored `Num a => a -> a -> a` (currently in Numeric Literals §6) vs source-shaped `<a: Num>(a, a): a`. Leaning source-shaped for round-trip consistency; Numeric Literals §6 updates when decided. Display-only; decide with LSP implementation work.
5. **Resolved — `Eq<Float>`/`Ord<Float>`.** SameValueZero equality; total order with `NaN` after `+Infinity` (Decisions Batch §1, whose eventual host is Primitive Types per the consolidation ledger).
6. **Open — polymorphic constraint members** (members introducing their own type variables). Banned in v1 (§2); no planned prelude constraint needs one. Revisit bar: concrete demand from a real constraint design.
7. **Resolved — `Ordering` spelling.** `Ordering = Less | Equal | Greater` (Decisions Batch §3); final.

---

## 10. Decisions log

| Decision | Where |
|---|---|
| One binder grammar everywhere: `<a: C>` / `<a: (C1, C2)>` / bare `<a>`; Rust-reading (dictionaries never user-visible) | §1 |
| `constraint Name<a>` head; subject binder mandatory; bare `<a>` load-bearing here | §2 |
| Superconstraints as subject obligations: `Ord<a: Eq>`; left-to-right implication; no `=>` spelling | §1, §2 |
| Terminology: super/subconstraint; noun for an honored constraint is **instance** | §2, preamble |
| Function members = fully typed headers; bodyless members required, bodies provide overridable defaults; associated type members use `type Name`; at least one required member; no `->` in function headers | §2; Collections Part 2 §§5–8 |
| Members are module-scope terms, constructor-style collision rules | §2.2 |
| `honor C<T>` head; function members are ordinary definitions, checked not inferred, with the lambda-literal RHS rule; associated types bind as `type Name = τ` | §4.1; Collections Part 2 §5.3 |
| Superconstraint obligations existence-checked, never restated | §4.2 |
| Parameterized instances via prefix `<...>` binders; entailment via superconstraint DAG, search-free | §4.3 |
| Global coherence: one instance per (constraint, constructor); no local/overlapping/named instances | §5.1–5.2 |
| Orphan rule (Rust-style); instances global, never imported/hidden | §5.3 |
| Instance heads: one constructor, distinct variables (H98-style) | §5.4 |
| Dictionaries: records / dictionary-functions; trailing maximal-evidence suffix ordered by type-variable ordinal then constraint name; monomorphic erasure | §6.1; FFI Part 9 §6–§7 |
| `Eq.equals` required; `Eq.notEquals` defaults to its negation and may be lawfully overridden; `!=` targets `notEquals` | §2, §7; Operators §5.1 |
| Derivation supplies required structural members, then inherits defaults; automatic structural instances do the same | §2 |
| Superconstraint dictionaries nested as slots; lowercased-name slot rule | §6.2 |
| Instances evaluation-free, order-independent, no capture analysis | §6.3 |
| `.d.ts` exposes only Parts 8–9's deliberate dictionary surface for generic editions and public evidence; all other constraint machinery stays absent | §6.4 |
| Prelude member lists for the five constraints owned here; `Num` has no superconstraints; `Hash`/`Iterable`/`Integral` registered to their focused owners | §7 |
| Derivation: opt-in `honor C<T> = derive`; header `derives` = Preamble sugar; derived instances are ordinary instances; derivable v1 set = `Eq`/`Ord`/`Show`/`Hash` (`Hash` derivable-only and requiring derived `Eq`, per Collections Part 2); structural instances automatic and user-closed | §4.5 |
| Call style: bare member calls idiomatic when unambiguous; qualification = ordinary module aliases (no constraint-specific namespace); members not dot-callable (Method Syntax §7); hostile-specimen bar routed to `stdlib-roadmap.md` | §2.2 |
| §9: five resolved anchors (9.1–9.3, 9.5, 9.7), two open (9.4 LSP display, 9.6 polymorphic members) | §9 |
| **Keyword pair is `constraint` / `honor`**; naming record with anti-relitigation anchors | §11 |

---

## 11. The keyword pair — naming record (do not relitigate)

The pair is **`constraint` / `honor`**. The anchors below preserve the load-bearing rationale.

### 11.1 Why `constraint`

The keyword's high-traffic site is the **binder** — `<a: Ord>` — and its diagnostic echo ("unsatisfied constraint `Num`"); any candidate must read as an *obligation* there. `constraint` is TypeScript's own name for exactly this position (a `<T extends X>` bound is officially a *generic constraint*), carries the C++20 lineage (predicates on type parameters, not value types), and coincides with the diagnostic noun — declaration, binder, and error message use one word.

**The one rejection that must stay loud — `interface`** (and its siblings `class`, `protocol`): in every language the audience knows, an `interface` is a **type of values** — usable in value positions, dynamically dispatched. Hexagon constraints are deliberately neither (`xs: Vector(Show)` is unwritable; no existential/`dyn` hatch exists). The keyword would teach precisely the model the language rejects. **`trait`** was the only defensible rename (Rust lineage) and still over-promises (`dyn Trait`/`impl Trait` are types) while forfeiting the keyword-equals-diagnostic-noun coincidence. `concept`, `rule`, and the vocabulary-family words (`signature`, …) all failed at the binder: `<a: Ord>` must read "obligated to Ord."

### 11.2 Why `honor`

The instance declaration's job is **constructive** — it supplies member bodies. Judgment-register candidates (`satisfies`, `conforms`, …) assert what the *checker* concludes, not what the *author* performs; TS's actual `satisfies` operator means "check, contributing nothing" — the exact opposite half. `honor`, in its commercial/performative sense (honoring a warranty *is* paying out), names the constructive act and completes the matched pair: **a `constraint` states an obligation; an `honor` declaration discharges it** — every `honor` in source points back at the constraint it answers, which `implement` (the superseded v1 keyword: maximally generic, OO-flavored, pairing with nothing) never did. **`fulfill`** was the strongest challenger — equally constructive and paired — rejected on regional spelling instability against `honor`'s entrenched American form. `prove`/`witness` were semantically deepest and audience-inappropriate. American spelling; `honour` is the ordinary unknown-keyword error.

### 11.3 The bar for any future candidate

The declaration site is keyword-tolerant; the binder site is keyword-hostile; the two keywords rightly live in different registers. A future candidate must read as an obligation at `<a: X>` (first keyword) or as a constructive act heading definitions (second), without importing a value-type or check-only false friend from the audience's home languages.

---

## 12. Edit notes — rename propagation (remaining live targets)

Keyword occurrences of `implement` become `honor`; **prose uses of "implement" as an ordinary English verb are untouched**; diagnostic strings using "implementation" as the instance-noun move to "instance." Applied at consolidation targets 1–3: declarations-preamble.md, statements-blocks-mutability.md, pattern-matching.md (prose-verb only, verified). `lexer.md` was already discharged (`honor` is the hard keyword; `honour` gets no privilege). Historical/superseded material (imported chats, the retired overview, archived roadmaps/notes) is excluded from propagation — it is not normative and is not edited.

Remaining live targets, applied on next touch of each:

| Doc | What changes |
|---|---|
| **decisions-batch-2026-07.md** | §2 throughout: elaborated forms (`implement Show<Point> = derive` etc.), "…RHS of an `implement`" → "…of an `honor`", "no `Eq` implementation" → "no `Eq` instance"; Roc comparison line unchanged (quotes Roc's own syntax). *(Ultimately superseded when the batch consolidates into hosts — §4.5 here already absorbs §2's mechanism.)* |
| **modules.md** | §1 doctrine, §3 idiom, §7 orphan-home definition, §8 note, §11/examples (`implement Ord<Config>`, `implement Show<Weird>` ×2). |
| **loops-ranges-iteration.md** | §7.2 v2 sketch and §11.1 deferred-spec description (keyword uses throughout). |
| **collections-part1-decisions.md** | Not-in-scope line, `Hash` derivable-only wording, `Iterable` shape lines and recipe, diagnostics hint. |
| **integral-constraint.md** | Sketch lines `implement Integral for Int`/`for BigInt` → `honor Integral<Int>`/`honor Integral<BigInt>` (also fixes the informal `for` head-form), and the members-violate prose. |
| **numeric-literals.md** | Architecture preamble, §5 compilation-story line, dictionary-shape note (`implement Num T` → `honor Num<T>`, also fixing head form). |
| **primitive-types.md** | Architecture preamble; §7 interpolation note (`implement Show` → `honor Show<T>`). |
| **products.md** | §1 doctrine line, §5 nominal-record rationale (also fix to angle-bracket heads), §5 trailing note. |
| **unions.md** | Not-in-scope line; §7 Eq note. |
| **operators-logic-precedence.md** | Rejected-alternatives row ("extensibility lives in `implement`" → "…in `honor`"). |
| **functions.md** | §4.2 pointer and deferred list. |
| **exceptions.md / division-remainder.md / comments.md** | Prose-verb uses only per grep; verify, expect no change. |
| **hexagon-for-typescript-coders.md** | When constraints enter the guide: introduce `honor` via the TS `implements` contrast ("where TS writes `implements`, Hexagon writes `honor` — an instance honors a constraint") and the §11.1 note that a Hexagon `constraint` is TS's *generic constraint*, never a TS `interface`. |

Sweep rule: grep `implement` per file; mechanically rename code-fenced/backticked keyword uses; leave prose verbs; retag instance-noun diagnostics.
