# Hexagon Spec: Constraints

**Status:** Decided (July 2026) — **v2**: the instance-declaration keyword is renamed `implement` → **`honor`** (decision recorded §11; propagation to-do §12). Section numbering §1–§10 is unchanged from v1 so existing cross-references from companion specs remain valid. An explicit **hanging-questions** section (§9) holds items deliberately left open; nothing in §9 blocks implementation of §1–§8.
**Scope:** The `constraint` declaration (members, subjects, superconstraints), the `honor` declaration (ground and parameterized instances, superconstraint checking, coherence, orphan rule, instance-head restriction), dictionary compilation, and the standard prelude constraints as they exist today.
**Not in scope:** derived structural instances' *semantics* (fixed in Products §2.5/§3.4 and Unions §7 — this doc owes only the mechanism, which is hanging, §9.2), the numeric-literal elaboration and defaulting machinery (Numeric Literals spec, authoritative), Eq/Ord semantics for NaN/−0 (owed here eventually; flagged §9.5), LSP display of constraints (deferred by agreement until after this spec; §9.4), modules and instance visibility (modules spec, but the orphan rule §5.3 constrains it).
**Companions:** Functions spec (§4.2 angle-bracket type parameters — this doc reuses that grammar wholesale), Numeric Literals spec (`fromInt`, defaulting, dictionary erasure), Primitive Types §7 (Show contract), Products/Unions specs (derived-instance semantics), Declarations Preamble (declaration inventory; `derives` elaboration into `honor ... = derive`).

Written for a future implementation session against the existing `hexc` architecture: Algorithm J, union-find tyvars, level-based generalisation, constraints as dictionaries, layout pass, readable-JS emission with `.d.ts`.

**Vocabulary, fixed for docs and diagnostics:** the declared obligation is a **constraint**; the declaration that discharges it is an **`honor` declaration**; the thing an `honor` declaration produces is an **instance**. The words "implement"/"implementation" are avoided in user-facing diagnostics and reference material for this mechanism — they are generic, OO-flavored, and name nothing this design has. ("Implementation" remains fine as an ordinary English word for the compiler itself.)

---

## 1. Doctrine

- **Constraints are the type of a type.** The angle-bracket binder `<a: Num>` reads uniformly everywhere it appears: "a type variable, with obligations." Scala's context bounds (`[A: Num]`) and Rust's trait bounds (`fn f<T: Num>`) are the acknowledged lineage; Hexagon follows the **Rust** reading — the dictionary is compiler plumbing, never a user-nameable or user-passable value. Scala's "reach in and grab the implicit" power is deliberately absent: it is the door to incoherence.
- **A constraint states an obligation; an `honor` declaration discharges it.** The keyword pair is a matched semantic pair, deliberately: `honor` (in its performative, commercial sense — one honors a warranty by paying out) names the constructive act of supplying the members, and every use of the keyword points the reader back at the constraint it answers. See §11 for the full naming record.
- **One grammar for binders.** `constraint`, `honor`, and function definitions all introduce type variables with the same `<var: constraintList>` form from Functions §4.2 — a single constraint, or a parenthesized conjunction `(C1, C2)`. Bare `<a>` is the unconstrained case; legal everywhere, *required* in `constraint` heads (§2), never required on functions.
- **Implication reads left to right.** `constraint Ord<a: Eq>` means "Ord implies Eq." No Haskell-style `Eq a => Ord a` with its backwards arrow, and no third meaning for `=>` (which is already the lambda and match-arm arrow).
- **Coherence is global and non-negotiable** (§5). One instance per (constraint, type constructor), enforced by an orphan rule. This is what keeps `Ord`-backed collections sound and monomorphic code dictionary-free — the readable-JS goal is downstream of coherence.
- **Angle brackets vs. parens encode a kind distinction.** Parens after an uppercase name are type parameters of a type constructor (`Option(a)`); angle brackets are constrained/introduced type variables. A constraint's subject is not a type parameter — `Ord` is not a type — so it is `Ord<a>`, never `Ord(a)`.

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

- **Head:** `constraint Name<subject>` where `Name` is uppercase-initial (it lives in its own namespace — see §2.2) and the subject is exactly one type variable, lowercase-initial, using the standard binder grammar. The subject binder is **mandatory** — this is the one position where bare `<a>` is load-bearing rather than optional.
- **Superconstraints** are the obligations on the subject: `constraint Ord<a: Eq>` requires every type honoring `Ord` to have (or derive) `Eq`. Conjunctions per the standard form: `constraint C1<a: (C2, C3)>`. Terminology, fixed for diagnostics and docs: if `Ord` implies `Eq`, then `Eq` is the **superconstraint** and `Ord` the **subconstraint**.
- **Superconstraint cycles are a hard error** at declaration (`C1<a: C2>`, `C2<a: C1>`). The superconstraint relation must be a DAG.
- **Members are fully typed function headers, optionally with a default body.** A required member omits the body: `name(params): ReturnType`. A defaulted member appends `= body`. The bodiless form remains legal only here: a constraint member is the declaration itself, not a standalone signature for some later definition. No `->` appears in source.
- Member headers must mention the subject variable; annotations on member parameters/returns are **required** even when a default body is present. The subject `a` is in scope in every member; members may not introduce their own `<...>` type parameters in v1 (no polymorphic methods; flagged, not needed by any planned prelude constraint).
- Members are one per layout line (VSEP/`;` per Lexer & Layout); duplicate member names within one constraint: hard error.
- Member names are lowercase-initial term names. They enter scope per §2.2.

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

---

## 3. Constrained functions (restated for closure)

Unchanged from Functions §4.2; recorded here because this spec is where a reader will look:

```
let plus<a: Num>(x: a, y: a): a = add(x, y)
let member<a: (Eq, Show)>(xs: List(a), x: a): Bool = ...
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
- **Member typing is checking, not inference.** The expected type of each member is fully determined by the constraint definition with the subject substituted; the body checks against it. Annotations on members are optional; if present they must match the expected type exactly — a *less general* annotation is an error here (unlike on free functions), because the dictionary slot's type is fixed.
- Member RHSs must be **syntactic lambdas** (directly or via header sugar) — the `fun` §7.1 rule, for the same reason: instance construction must be evaluation-free (§6.3).

### 4.2 Superconstraint obligations: checked, never restated

`honor Ord<Int>` does **not** name or restate the `Eq<Int>` instance. The compiler checks that the superconstraint instance *exists* (ground case) or *is derivable from the instance's own binders* (parameterized case, §4.3), and errors otherwise:

> cannot honor `Ord<Int>`: `Ord` requires `Eq`, and no `Eq<Int>` instance exists.

Naming instances would only make sense under multiple candidate instances, which coherence (§5) forbids; existence-checking is therefore complete.

### 4.3 Parameterized instances

```
honor<a: Show> Show<List(a)> =
  show(xs) = ...

honor<a: Eq, b: Eq> Eq<Pair(a, b)> =
  equals(p, q) = ...
```

- The prefix `<...>` is the standard binder grammar again — introduce variables, attach obligations — in yet another position, with identical meaning. An `honor` head's subject may then mention those variables.
- Superconstraint checking in this case: `honor<a: Ord> Ord<List(a)>` requires `Eq<List(a)>` to be derivable — i.e. an `honor ... Eq<List(_)>` exists whose own obligations are entailed by this instance's binders (`a: Ord` entails `a: Eq` via the superconstraint DAG). Entailment here is simple: walk the DAG; no backtracking search arises under §5.4.

### 4.4 What `honor` is not

- Not first-class: an instance is not a value, cannot be named, passed, or locally shadowed. (Contrast Scala; see §1.)
- Not conditional on anything but its `<...>` binders: no where-clauses, no negative constraints, no overlap resolution.
- Not open: all members supplied in one block; no splitting an instance across declarations.

---

## 5. Coherence

### 5.1 The rule

**At most one instance per (constraint, type constructor), program-wide.** A second `honor Ord<String>` anywhere in the program is a hard error at the second declaration (or at link/import time when the duplicates come from different modules — the modules spec owes the exact reporting point; the *rule* is fixed here).

Rationale, recorded so it is not re-litigated: (1) `Ord` feeds sorted collections — two `Ord<String>` instances mean a set built under one and queried under the other is silently corrupt; this is why Primitive Types §5 insists `Ord String` is permanent. (2) Dictionary selection stays trivially decidable at every call site, which is what lets monomorphic code erase dictionaries entirely (Numeric Literals §5); the readable-JS goal is downstream of coherence. (3) No modular-implicits/named-instance machinery, which is a research tarpit.

### 5.2 No local instances, no overlapping instances

No instance may be declared inside a function or block; `honor` is a module-level declaration only. No two instances may overlap (which, given §5.4, reduces to: same constraint + same outermost constructor = duplicate = error).

### 5.3 Orphan rule

An `honor C<T>` must appear in **the module that declares `C` or the module that declares `T`** (for parameterized heads: the module declaring `T`'s outermost type constructor). Otherwise two independent libraries could each honor `Show<SomeDepType>` and a downstream importer of both would hold an unresolvable conflict they didn't write. Violation is a hard error at declaration.

*(Interaction with the modules spec: this is the one place instance visibility is constrained ahead of that spec. Instances are global once their module is in the program — they are not imported, not exported, not hidden. The modules spec must preserve this.)*

### 5.4 Instance-head restriction

An instance head is **one type constructor applied to distinct type variables**: `Show<Int>`, `Show<List(a)>`, `Eq<Pair(a, b)>`. Not legal: `Show<List(Int)>` ("instances are per type constructor; this one must cover `List(a)` for all `a`"), `Eq<Pair(a, a)>` (repeated variable), instances headed by a bare type variable (`Show<a>` — "an instance must name a type"). This is (roughly) the Haskell 98 rule; it makes instance lookup a table lookup keyed on (constraint, constructor) rather than a search, keeps §4.3 entailment search-free, and closes the road to overlapping-instance resolution.

---

## 6. Compilation

### 6.1 Dictionaries

Nothing beyond what Numeric Literals §5 already assumes, now stated in general:

- A **ground instance** is a module-level record of its completed member set: supplied members plus inherited defaults. For example, `const Num_Int = { add: (x, y) => x + y, fromInt: (x) => x, ... };` is materialised only if some polymorphic use actually needs it (see erasure below).
- A **parameterized instance** is a dictionary-producing function: `const Show_List = (dictA) => ({ show: (xs) => ... });`
- A constrained function takes its dictionaries as leading parameters, one per constraint on each generalised variable, in a deterministic order (alphabetical by (variable, constraint name) — fixed so separate compilation agrees).
- **Monomorphic erasure is the norm and the point:** at a call site where the constrained variable is resolved to a concrete type, the dictionary is selected at compile time and known slots are inlined — `add` at `Int` emits `x + y`, `show` at `Int` emits `String(x)` (Primitive Types §7 table), `fromInt` at `Int` erases (Numeric Literals §5). Dictionary records and `dict.member(...)` calls appear **only** inside genuinely polymorphic functions, which already carried them.

### 6.2 Superconstraint dictionaries

A subconstraint dictionary carries its superconstraint dictionaries as slots (`Ord_Int = { eq: Eq_Int, compare: ... }`), so a function constrained `<a: Ord>` receives one dictionary and reaches `equals` as `dict.eq.equals`. Chosen over passing separate flattened dictionaries because it keeps the "one constraint = one parameter" rule stable under superconstraint changes to a constraint's definition. Slot name for a superconstraint: the constraint's name, lowercased (`eq`, `num`) — collision with a member name is impossible only by luck, so: **a member whose name equals the lowercased name of a superconstraint of the same constraint is a hard error** (obscure, cheap to check, prevents a codegen landmine).

### 6.3 Evaluation-freeness and ordering

Instance construction is evaluation-free by construction (§4.1: supplied member RHSs are syntactic lambdas, and default bodies elaborate to lambdas; a record of lambdas evaluates nothing). A default that calls another member reads that slot when the function is called, after the dictionary is complete. Instances are therefore order-independent within a module and require **no capture-set analysis** (unlike `fun`, Functions §7.2) and no initialisation-order story. Instances may reference each other freely (e.g. `Show_List` using `dictA` which might be `Show_List(Show_Int)` at some call site — composition happens at use sites, not declaration sites).

### 6.4 `.d.ts`

Constraints and instances are compile-time Hexagon discipline; **nothing constraint-shaped appears in `.d.ts`**. Exported polymorphic functions that take dictionaries are an FFI-spec problem (presumably: not directly exported, or exported at monomorphic instantiations); flagged to that spec.

---

## 7. Prelude constraints (authoritative member lists)

| Constraint | Superconstraints | Members | Notes |
|---|---|---|---|
| `Eq<a>` | — | required `equals`; defaulted `notEquals` | `notEquals(x, y) = not equals(x, y)`; NaN/−0 semantics: §9.5 |
| `Ord<a: Eq>` | `Eq` | `compare(x: a, y: a): Ordering` | `Ordering` is the prelude all-nullary union `Less \| Equal \| Greater` |
| `Show<a>` | — | `show(x: a): String` | contract per Primitive Types §7 |
| `Num<a>` | — | `add`, `subtract`, `multiply`, `negate` (all `(a, a): a` / `(a): a`), `fromInt(n: Int): a` | `fromInt` law per Numeric Literals §5; no `divide` (evicted, per Primitive Types §2) |
| `Frac<a: Num>` | `Num` | `divide(x: a, y: a): a` | lawful up to rounding (Float); exact (Rat) |

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
| Duplicate instance | hard error at second declaration, naming the first (§5.1) |
| Orphan instance | hard error: "honor `C<T>` in the module declaring `C` or the module declaring `T`" (§5.3) |
| Non-constructor or repeated-variable instance head | §5.4 messages |
| Instance head on a bare type variable | "an instance must name a type" (§5.4) |
| Superconstraint cycle | hard error at declaration (§2) |
| Duplicate member name within a constraint / across a module's constraints | hard error, constructor-rule family (§2, §2.2) |
| Member name = lowercased superconstraint name | hard error (§6.2) |
| Non-lambda member RHS in `honor` | the `fun` §7.1-style syntactic error (§4.1) |
| Unsatisfied constraint at a call site | phrased per Numeric Literals §6 where a literal is involved; otherwise "`T` has no `Ord` instance, required by `sort`" |

---

## 9. Hanging questions (recorded, not decided)

These were explicitly deferred in the design session. Each needs a decision before or during its noted milestone; none blocks implementing §1–§8.

1. **Default member bodies. Resolved.** Members with bodies are inherited defaults and may be overridden; members without bodies remain required. `Eq.notEquals` is the first use. The complete rule is in §2.
2. **Derived structural instances — mechanism.** Semantics are fixed (tuples: Products §2.5; structural records: Products §3.4; unions: Unions §7). Open: how derivation is *invoked* for nominal types — automatic for every `record`/`union`, or opt-in (`honor Show<Point> = derive` or a `deriving`-style header clause)? Automatic is ergonomic; opt-in is consistent with "nominal means you control the surface." Also open within this: whether record `Ord` ships at all (Products §3.4 flags it as droppable). *Needed by:* the moment `record`/`union` values meet `show`/`==` in user code — i.e. early. *(Since resolved in Decisions Batch 2026-07 §2 and Declarations Preamble §2.3: opt-in via header `derives`, elaborating to `honor C<Name> = derive`. Entry retained for the record.)*
3. **`honor` for structural types.** Instances are keyed on type constructors (§5.4); structural records and tuples have no constructor name. Presumption: users **cannot** write instances for structural types (their instances are exclusively compiler-derived per §9.2), which also dodges "which module owns `{x: Float}`" under the orphan rule. Presumed, not decided.
4. **LSP display of constraints.** Deferred by agreement until after this spec. The open choice: keep the Haskell-flavored display `Num a => a -> a -> a` (currently named in Numeric Literals §6) or switch hover display to source-shaped `<a: Num>(a, a): a`. Leaning source-shaped for round-trip consistency; the Numeric Literals §6 wording gets updated when this is decided. Display-only; nothing downstream.
5. **Eq/Ord semantics for `NaN` and `-0`** (promised by Primitive Types §3). IEEE `NaN ≠ NaN` breaks `Eq` reflexivity and poisons collection lookups; total-order (`compare`) treatment of `NaN`/`-0` must be pinned. Candidates: SameValueZero-style equality + a total order placing `NaN` (Rust's `total_cmp` precedent), vs. honest IEEE with documented lawlessness. *Needed by:* `Eq<Float>`/`Ord<Float>` instances — i.e. immediately upon prelude implementation; this is the most urgent item on this list. *(Since resolved: SameValueZero for `Eq<Float>`; `Ord<Float>` places NaN after +Infinity — see Decisions Batch. Entry retained for the record.)*
6. **Polymorphic constraint members** (members introducing their own type variables). Banned in v1 (§2); no planned prelude constraint needs one. Revisit only on concrete demand.
7. **`Ordering` spelling. Resolved.** The prelude union is `Ordering = Less | Equal | Greater` (Decisions Batch §3). The full-word constructors avoid the former `Eq` collision and are the final spellings.

---

## 10. Decisions log

| Decision | Where |
|---|---|
| One binder grammar everywhere: `<a: C>` / `<a: (C1, C2)>` / bare `<a>`; Rust-reading (dictionaries never user-visible) | §1 |
| `constraint Name<a>` head; subject binder mandatory; bare `<a>` load-bearing here | §2 |
| Superconstraints as subject obligations: `Ord<a: Eq>`; left-to-right implication; no `=>` spelling | §1, §2 |
| Terminology: super/subconstraint; noun for an honored constraint is **instance** | §2, preamble |
| Members = fully typed headers; bodyless members required, bodies provide overridable defaults; at least one required member; no `->` in source preserved | §2 |
| Members are module-scope terms, constructor-style collision rules | §2.2 |
| `honor C<T>` head; members are ordinary definitions, checked not inferred; lambda-literal RHS rule | §4.1 |
| Superconstraint obligations existence-checked, never restated | §4.2 |
| Parameterized instances via prefix `<...>` binders; entailment via superconstraint DAG, search-free | §4.3 |
| Global coherence: one instance per (constraint, constructor); no local/overlapping/named instances | §5.1–5.2 |
| Orphan rule (Rust-style); instances global, never imported/hidden | §5.3 |
| Instance heads: one constructor, distinct variables (H98-style) | §5.4 |
| Dictionaries: records / dictionary-functions; deterministic parameter order; monomorphic erasure | §6.1 |
| `Eq.equals` required; `Eq.notEquals` defaults to its negation and may be lawfully overridden; `!=` targets `notEquals` | §2, §7; Operators §5.1 |
| Derivation supplies required structural members, then inherits defaults; automatic structural instances do the same | §2 |
| Superconstraint dictionaries nested as slots; lowercased-name slot rule | §6.2 |
| Instances evaluation-free, order-independent, no capture analysis | §6.3 |
| Nothing constraint-shaped in `.d.ts` | §6.4 |
| Prelude member lists; `Num` has no superconstraints | §7 |
| Seven hanging questions recorded | §9 |
| **Keyword pair is `constraint` / `honor`** (v2 rename from `implement`); full bake-off recorded | §11 |

---

## 11. Rejected alternatives — the keyword pair (do not relitigate)

Decided July 2026 after a multi-round naming review. The pair is **`constraint` / `honor`**. Every serious challenger was examined; the record below exists so none is reopened without new information.

### 11.1 Why `constraint` (declaration keyword) stands

The keyword's high-traffic site is not the declaration but the **binder** — `<a: Ord>` — and its echo in diagnostics ("unsatisfied constraint `Num`"). Any candidate must read as an *obligation* in that position. `constraint` uniquely combines: (a) it is TypeScript's own name for exactly this position (`<T extends X>` is officially a *generic constraint* — the one piece of TS vocabulary that matches Hexagon's semantics rather than contradicting them); (b) C++20 lineage ("constraints and concepts" — the closest mainstream semantic match: predicates on type parameters, not value types); (c) the keyword coincides with the diagnostic noun, so declaration, binder, and error message all use one word.

**Rejected for the declaration:**

- **`interface`** — the strongest-seeming candidate and the most misleading. In every language the target audience knows (`TS`, Java, C#, Go), an `interface` is a **type of values**: usable in value positions, dynamically dispatched. Hexagon constraints are deliberately neither — `xs: List(Show)` is unwritable, and there is no existential/`dyn` escape hatch. The keyword would teach precisely the model the language rejects, and every TS user's first move would be the forbidden one. Same category of decision as banning "row" from diagnostics: the word must teach the right thing.
- **`class`** — Haskell/Lean/PureScript lineage, but the worst OO false friend of all for a TS audience; strictly more misleading than `interface`.
- **`protocol`** — Swift lineage, but Swift protocols are usable as existential types; same value-type shadow as `interface`, weaker recognition.
- **`trait`** — the only defensible rename (Rust lineage, matching Hexagon's Rust-preference doctrine; coined-word advantage). Rejected because Rust traits are also usable as types (`dyn Trait`, `impl Trait`) so it mildly over-promises, and because it forfeits the keyword-equals-diagnostic-noun coincidence for no semantic gain.
- **`concept`** — real C++20 lineage, but C++ needs two words because it has two things (anonymous `requires` constraints *and* named concepts). Hexagon has exactly one constraint-shaped thing; `concept` would be a second word with no second referent, spending the diagnostic-noun coincidence to solve a problem Hexagon doesn't have. Becomes available again only if anonymous constraint forms or constraint aliases ever exist.
- **`rule`** — a constraint is a rule only in its *laws* half; the larger half is a member vocabulary (`compare` is a name you call; rules don't have callable members). Lineage collision with rewrite rules / lint rules / Prolog clauses; loses the TS "generic constraint" resonance; "unsatisfied rule" is vaguer than "unsatisfied constraint."
- **Vocabulary-family words** (`definition`, `grammar`, `lexicon`, `signature`, …) — they describe the declaration's *contents* (a member vocabulary) rather than the *obligation*, and collapse at the binder: `<a: Ord>` must read "obligated to Ord," not "of vocabulary Ord." `signature` was the closest (ML lineage: a named set of typed member names) but collides fatally with the universal informal meaning "the type of a function," and ML signatures describe modules — value-level things — reintroducing the `interface` shadow.

### 11.2 Why `honor` (instance keyword) replaces `implement`

The instance declaration's job is **constructive**: it supplies member bodies from which the compiler builds a dictionary. Candidates from the judgment register fail this test — they assert a state the *checker* concludes, not an act the *author* performs.

`honor` passes it: in its commercial/performative sense (honoring a check, a warranty, a contract), honoring *is* doing the work. It completes a matched semantic pair — **a `constraint` states an obligation; an `honor` declaration discharges it** — which is tighter conceptual rhyme than `constraint`/`implement`, whose halves come from unrelated metaphors (logic and construction). Every `honor` in source points the reader back at the constraint it answers; `impl`/`implement` points at nothing in particular. Spelling follows the established programming-language convention of American orthography (`color`, `center`, `.minimize()`); `honour` in source is the ordinary unknown-keyword error.

**Rejected for the instance declaration:**

- **`implement`** (the v1 keyword, superseded) — its virtue was the TS `implements` cognate; its defects are that "implement"/"implementation" are maximally generic programming words, carry OO class-hierarchy connotations irrelevant here, and form no pair with `constraint` — nothing in the word recalls the obligation being answered. Deliberate contrast with Rust's `trait`/`impl`, where `impl` is register-neutral: Hexagon chooses the keyword that names the *relationship*.
- **`satisfies` / `satisfy`** — judgment-side, not constructive: a satisfied constraint is a checker's conclusion, and the block of member definitions after it would be unexplained. Sharp TS false friend: TS's actual `satisfies` operator (4.9+) means "check, *contributing nothing*" — the exact opposite half of the meaning needed. The judgment vocabulary ("satisfies," "unsatisfied," "requires") stays where it belongs: inside diagnostics.
- **`follows` / `follow`** — no lineage anywhere; faintly suggests ordering or inheritance, neither present; judgment-side.
- **`obey` / `comply` / `conform` / `abide`** — the law-register siblings of `satisfies`, all stative/judgment-side; several resist taking a body at all.
- **`fulfill`** — the strongest challenger produced by the whole review: genuinely constructive (one fulfills a contract by performing it) and an equally matched pair with `constraint`. Rejected on regional spelling instability (`fulfil`/`fulfill`/`fulfils`/`fulfills` — a permanent typo generator with no single conventional programming spelling, unlike `honor`, whose American form is entrenched via CSS and every stdlib) and on `honor` being shorter to say and type.
- **`prove` / `witness`** — semantically the *deepest* candidates (under dictionary translation an instance literally is a proof term; Lean thinks this way), rejected as audience-inappropriate: reads as intimidating or whimsical to senior TS developers, and the Curry-Howard payoff lands only for readers who didn't need the help.

### 11.3 The general finding

The declaration site is keyword-tolerant; the binder site is keyword-hostile; and the two keywords rightly live in different registers — `constraint` judgment-flavored because its home is the obligation-stating binder, `honor` performative because its only site supplies code. Any future candidate must clear both bars: read as an obligation at `<a: X>` (for the first keyword) or as a constructive act heading a block of definitions (for the second), while not importing a value-type or check-only false friend from the audience's home languages.

---

## 12. Edit notes — rename propagation (v2 to-do)

Keyword occurrences of `implement` become `honor` corpus-wide; **prose uses of "implement" as an ordinary English verb** ("implementation session," "the implementer's choice") **are untouched**. Diagnostics phrased with "implementation" as the instance-noun move to "instance." Inventory from a corpus grep, July 2026:

| Doc | What changes |
|---|---|
| **declarations-preamble.md** | §2.2 ("`implement` heads"), §2.3 elaboration (`implement Eq<Pair> = derive` → `honor Eq<Pair> = derive`, twice + prose), §4 alias-instance rule and its diagnostic ("aliases cannot carry their own implementations" → "…their own instances"; `implement C<Alias>` row in the checklist), §6 declaration inventory (`implement` → `honor` in the module-level list), Not-in-scope preamble mention. |
| **decisions-batch-2026-07.md** | §2 throughout: elaborated forms (`implement Show<Point> = derive` etc.), "`derive` is a keyword valid only as the complete RHS of an `implement`" → "…of an `honor`", the rejected-alternative "`derive Eq for Point`… competing with `implement`", "cannot derive `Eq<Point>`… has no `Eq` implementation" → "…no `Eq` instance", Roc comparison line unchanged (quotes Roc's own syntax). |
| **modules.md** | §1 doctrine ("`implement` ignores the export system"), §3 side-effect-import idiom ("its `implement` declarations"), §7 orphan-home definition (`implement C<T>` must appear…), §8 unexported-type note ("does not extend to `implement`"), §11/examples (`implement Ord<Config>`, `implement Show<Weird>` ×2 in the duplicate example). |
| **statements-blocks-mutability.md** | §1 binding inventory and §2 site table: `implement` → `honor` in both lists. |
| **loops-ranges-iteration.md** | §7.2 v2 sketch (multiple: "on the `implement` side," the three-position `type` keyword note "module level / `constraint` body / `implement` block," "user types join the table via `implement`"), §11.1 deferred-spec description (same phrases). |
| **collections-part1-decisions.md** | Not-in-scope line (`constraint`/`implement` bodies), `Hash` derivable-only wording ("cannot hand-write `implement Hash<T>`"), Iterable shape lines (`constraint Iterable` / `implement Iterable`, `implement Iterable<Bag(a)>`), third-party-collection recipe ("one `implement Iterable` instance"), diagnostics gain ("or `implement Iterable<τ>`"). |
| **collections-roadmap.md** | Part 2 heading item (`type` members in `constraint`/`implement` bodies), Hash derivable-only wording, Part 5 Iterable-v1 diagnostic ("or `implement Iterable<τ>`"). |
| **integral-constraint.md** | The sketch lines `implement Integral for Int` / `for BigInt` → `honor Integral<Int>` / `honor Integral<BigInt>` (note: also fixes the informal `for` head-form to the real grammar), and "An `implement Integral` whose members violate them" prose. |
| **numeric-literals.md** | Architecture preamble ("`implement` blocks as instance definitions" → "`honor` blocks…"), §5 ("by the existing `implement` compilation story"), dictionary-shape note ("Every existing and future `implement Num T`" → "…`honor Num<T>`" — also fixes head form). |
| **primitive-types.md** | Architecture preamble ("`implement` blocks"), §7 interpolation note ("opt in with an explicit `implement Show`" → "…explicit `honor Show<T>`"). |
| **products.md** | §1 doctrine ("keeps `implement` coherence anchored to names"), §5 nominal-record rationale ("collapses `implement Show Point` vs `implement Show Vec` coherence" — also fix to angle-bracket heads), §5 trailing note ("require explicit `implement`"). |
| **unions.md** | Not-in-scope line ("the constraint mechanism and `implement`"), §7 Eq note ("automatically or via explicit `implement`"). |
| **operators-logic-precedence.md** | Rejected-alternatives row ("extensibility lives in `implement`" → "…in `honor`"). |
| **functions.md** | §4.2 pointer ("superconstraints, `implement`") and §deferred list ("Constraints (`Num`, `implement`, …)"). |
| **type-system-overview.md** | §1 pillar 4 ("user constraints via `implement` blocks") and roadmap item 4 ("Constraints — `implement`, superconstraints, …"). |
| **lexer.md** | Discharged: the hard-keyword inventory contains `honor`, not `implement`. `honour` receives no lexical privilege; a near-miss hint remains optional. |
| **pattern-matching.md** | Check the 4 hits — believed to be prose-verb uses only; change nothing unless a keyword use surfaces. |
| **exceptions.md / division-remainder.md / comments.md** | Prose-verb uses only per grep; verify, expect no change. |
| **hexagon-for-typescript-coders.md** | 1 hit; the guide predates full constraint coverage. When constraints enter the book: `honor` gets a one-paragraph introduction leaning on the TS `implements` contrast ("where TS writes `implements`, Hexagon writes `honor` — an instance honors a constraint") and the §11.1 note that a Hexagon `constraint` is TS's *generic constraint*, never a TS `interface`. |
| **ffi-agenda.md / spec-roadmap.md** | No keyword hits in grep; verify on next touch. |
| **chatgpt-vector-map-set.md / __Hexagon_Language_early_draft.md** | Historical/imported material — leave as-is (not normative). |

Sweep rule for the edit session: grep `implement` per file; mechanically rename code-fenced and backticked keyword uses; leave prose verbs; retag any diagnostic strings using "implementation" as the instance-noun.
